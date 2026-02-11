import { Dialog, showMessage } from "siyuan";
import { } from "../api";
import { i18n } from "../pluginInstance";
import { QuickReminderDialog } from "./QuickReminderDialog";

export class SubtasksDialog {
    private dialog: Dialog;
    private parentId: string;
    private plugin: any;
    private subtasks: any[] = [];
    private onUpdate?: () => void;
    private draggingId: string | null = null;

    constructor(parentId: string, plugin: any, onUpdate?: () => void) {
        this.parentId = parentId;
        this.plugin = plugin;
        this.onUpdate = onUpdate;
    }

    public async show() {
        await this.loadSubtasks();

        this.dialog = new Dialog({
            title: i18n("subtasks") || "子任务",
            content: `
                <div class="subtasks-dialog" style="padding: 16px; display: flex; flex-direction: column; gap: 16px; max-height: 80vh;">
                    <div id="subtasksList" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; min-height: 100px;">
                        <!-- 子任务列表 -->
                    </div>
                    <div class="subtasks-actions" style="display: flex; gap: 8px; justify-content: flex-end; padding-top: 8px; border-top: 1px solid var(--b3-border-color);">
                        <button id="addSubtaskBtn" class="b3-button b3-button--primary">
                            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                            ${i18n("createSubtask") || "创建子任务"}
                        </button>
                    </div>
                </div>
            `,
            width: "500px",
            destroyCallback: () => {
                if (this.onUpdate) this.onUpdate();
            }
        });

        this.renderSubtasks();
        this.bindEvents();
    }

    private async loadSubtasks() {
        const reminderData = await this.plugin.loadReminderData() || {};

        // 解析可能存在的实例信息 (id_YYYY-MM-DD)
        let targetParentId = this.parentId;
        let instanceDate: string | undefined;

        const lastUnderscoreIndex = this.parentId.lastIndexOf('_');
        if (lastUnderscoreIndex !== -1) {
            const potentialDate = this.parentId.substring(lastUnderscoreIndex + 1);
            if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                targetParentId = this.parentId.substring(0, lastUnderscoreIndex);
                instanceDate = potentialDate;
            }
        }

        // 1. 获取直接以 this.parentId 为父任务的任务（可能是真正的实例子任务或普通子任务）
        const directChildren = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === this.parentId);

        // 2. 如果是实例视图，则尝试从模板中获取 ghost 子任务
        let ghostChildren: any[] = [];
        if (instanceDate && targetParentId !== this.parentId) {
            const templateChildren = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === targetParentId);
            ghostChildren = templateChildren.map(child => {
                const ghostId = `${child.id}_${instanceDate}`;
                // 检查此实例是否已完成
                const isCompleted = child.repeat?.completedInstances?.includes(instanceDate) || false;

                // 查找针对此子任务实例的修改（如果存在）
                const instanceMod = child.repeat?.instanceModifications?.[instanceDate] || {};

                return {
                    ...child,
                    ...instanceMod,
                    id: ghostId,
                    parentId: this.parentId, // 链接到当前实例父任务
                    isRepeatInstance: true,
                    originalId: child.id,
                    completed: isCompleted,
                    title: instanceMod.title || child.title || '(无标题)',
                };
            });
        }

        // 合并数据，避免重复（如果已存在真实的实例子任务，则以真实子任务优先）
        const combined = [...directChildren];
        ghostChildren.forEach(ghost => {
            if (!combined.some(r => r.id === ghost.id)) {
                combined.push(ghost);
            }
        });

        this.subtasks = combined;
        this.subtasks.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    }

    private renderSubtasks() {
        const listEl = this.dialog.element.querySelector("#subtasksList") as HTMLElement;
        if (!listEl) return;

        // 添加拖拽指示器样式（添加到 dialog 的容器中，避免被 innerHTML 覆盖）
        const dialogContent = this.dialog.element.querySelector(".subtasks-dialog") || this.dialog.element;
        if (!dialogContent.querySelector("#subtask-drag-styles")) {
            const styleEl = document.createElement("style");
            styleEl.id = "subtask-drag-styles";
            styleEl.textContent = `
                .subtask-item {
                    position: relative;
                }
                .subtask-item.drag-indicator-top::before,
                .subtask-item.drag-indicator-bottom::after {
                    content: "";
                    position: absolute;
                    left: 0;
                    right: 0;
                    height: 3px;
                    background: var(--b3-theme-primary);
                    border-radius: 2px;
                    z-index: 10;
                    box-shadow: 0 0 4px var(--b3-theme-primary);
                }
                .subtask-item.drag-indicator-top::before {
                    top: -2px;
                }
                .subtask-item.drag-indicator-bottom::after {
                    bottom: -2px;
                }
                .subtask-item.drag-indicator-top {
                    transform: translateY(2px);
                }
                .subtask-item.drag-indicator-bottom {
                    transform: translateY(-2px);
                }
                .subtask-item.dragging {
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                }
            `;
            dialogContent.appendChild(styleEl);
        }

        if (this.subtasks.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 20px;">${i18n("noSubtasks") || "暂无子任务"}</div>`;
            return;
        }

        listEl.innerHTML = this.subtasks.map(task => {
            const priorityIcon = this.getPriorityIcon(task.priority);
            return `
            <div class="subtask-item" data-id="${task.id}" draggable="true" style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--b3-theme-surface); border: 1px solid var(--b3-theme-border); border-radius: 4px; cursor: move; transition: all 0.2s;">
                <div class="subtask-drag-handle" style="cursor: move; opacity: 0.5;">⋮⋮</div>
                <input type="checkbox" ${task.completed ? 'checked' : ''} class="subtask-checkbox" style="margin: 0;">
                <div class="subtask-title" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; ${task.completed ? 'text-decoration: line-through; opacity: 0.6;' : ''}">
                    ${priorityIcon} ${task.title}
                </div>
                <div class="subtask-ops" style="display: flex; gap: 4px; opacity: 0.6;">
                    <button class="b3-button b3-button--outline b3-button--small edit-subtask-btn" title="${i18n("edit")}" style="padding: 4px;">
                        <svg class="b3-button__icon" style="width: 12px; height: 12px;"><use xlink:href="#iconEdit"></use></svg>
                    </button>
                    <button class="b3-button b3-button--outline b3-button--small delete-subtask-btn" title="${i18n("delete")}" style="padding: 4px;">
                        <svg class="b3-button__icon" style="width: 12px; height: 12px;"><use xlink:href="#iconTrashcan"></use></svg>
                    </button>
                </div>
            </div>
        `;
        }).join("");

        // Bind events for each item
        listEl.querySelectorAll(".subtask-item").forEach(item => {
            const id = item.getAttribute("data-id");
            const task = this.subtasks.find(t => t.id === id);

            item.querySelector(".subtask-checkbox")?.addEventListener("change", (e) => {
                this.toggleSubtask(id, (e.target as HTMLInputElement).checked);
            });

            item.querySelector(".edit-subtask-btn")?.addEventListener("click", (e) => {
                e.stopPropagation();
                this.editSubtask(task);
            });

            item.querySelector(".delete-subtask-btn")?.addEventListener("click", (e) => {
                e.stopPropagation();
                this.deleteSubtask(id);
            });

            // Hover effect for ops
            item.addEventListener("mouseenter", () => {
                (item.querySelector(".subtask-ops") as HTMLElement).style.opacity = "1";
                (item as HTMLElement).style.borderColor = "var(--b3-theme-primary)";
            });
            item.addEventListener("mouseleave", () => {
                (item.querySelector(".subtask-ops") as HTMLElement).style.opacity = "0.6";
                (item as HTMLElement).style.borderColor = "var(--b3-theme-border)";
            });

            this.addDragAndDrop(item as HTMLElement);
        });
    }

    private getPriorityIcon(priority: string): string {
        switch (priority) {
            case 'high': return '🔴';
            case 'medium': return '🟡';
            case 'low': return '🟢';
            default: return '⚪';
        }
    }

    private bindEvents() {
        this.dialog.element.querySelector("#addSubtaskBtn")?.addEventListener("click", () => {
            this.addSubtask();
        });
    }

    private async addSubtask() {
        const reminderData = await this.plugin.loadReminderData() || {};
        const parentTask = reminderData[this.parentId];

        const dialog = new QuickReminderDialog(undefined, undefined, async (newReminder) => {
            // 如果有新创建的任务数据，直接添加到本地数组（乐观更新）
            if (newReminder && newReminder.parentId === this.parentId) {
                // 检查是否已存在（避免重复添加）
                const exists = this.subtasks.some(t => t.id === newReminder.id);
                if (!exists) {
                    this.subtasks.push(newReminder);
                    this.subtasks.sort((a, b) => (a.sort || 0) - (b.sort || 0));
                    this.renderSubtasks();
                }
            }
            // 延迟重新加载以确保数据已保存到存储
            setTimeout(async () => {
                await this.loadSubtasks();
                this.renderSubtasks();
            }, 100);
        }, undefined, {
            mode: 'quick',
            defaultParentId: this.parentId,
            defaultProjectId: parentTask?.projectId,
            defaultCategoryId: parentTask?.categoryId,
            plugin: this.plugin
        });
        dialog.show();
    }

    private async editSubtask(task: any) {
        const dialog = new QuickReminderDialog(undefined, undefined, async () => {
            await this.loadSubtasks();
            this.renderSubtasks();
        }, undefined, {
            mode: 'edit',
            reminder: task,
            plugin: this.plugin
        });
        dialog.show();
    }

    private async toggleSubtask(id: string, completed: boolean) {
        const reminderData = await this.plugin.loadReminderData() || {};

        // 解析 ID，判断是否为实例
        let targetId = id;
        let date: string | undefined;
        const lastUnderscoreIndex = id.lastIndexOf('_');
        if (lastUnderscoreIndex !== -1) {
            const potentialDate = id.substring(lastUnderscoreIndex + 1);
            if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                targetId = id.substring(0, lastUnderscoreIndex);
                date = potentialDate;
            }
        }

        const task = reminderData[targetId];
        if (!task) return;

        if (date) {
            // 重复实例逻辑：将完成状态记录在 repeat 对象中
            if (!task.repeat) task.repeat = {};
            if (!task.repeat.completedInstances) task.repeat.completedInstances = [];
            if (!task.repeat.completedTimes) task.repeat.completedTimes = {};

            if (completed) {
                if (!task.repeat.completedInstances.includes(date)) {
                    task.repeat.completedInstances.push(date);
                }
                task.repeat.completedTimes[date] = new Date().toISOString();
            } else {
                const idx = task.repeat.completedInstances.indexOf(date);
                if (idx > -1) {
                    task.repeat.completedInstances.splice(idx, 1);
                }
                delete task.repeat.completedTimes[date];
            }
        } else {
            // 普通任务逻辑
            task.completed = completed;
            if (completed) {
                task.completedTime = new Date().toISOString();
            } else {
                delete task.completedTime;
            }
        }

        await this.plugin.saveReminderData(reminderData);
        await this.loadSubtasks();
        this.renderSubtasks();
    }

    private async deleteSubtask(id: string) {
        const reminderData = await this.plugin.loadReminderData() || {};

        // 解析 ID
        let targetId = id;
        let date: string | undefined;
        const lastUnderscoreIndex = id.lastIndexOf('_');
        if (lastUnderscoreIndex !== -1) {
            const potentialDate = id.substring(lastUnderscoreIndex + 1);
            if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                targetId = id.substring(0, lastUnderscoreIndex);
                date = potentialDate;
            }
        }

        const task = reminderData[targetId];
        if (!task) return;

        if (date) {
            // 如果是删除 ghost 实例，询问用户是删除整个模板还是仅在此日期隐藏？
            // 这里为了简化流程，默认删除整个模板任务。
            const confirmMsg = `确定要删除此子任务的原始模板吗？\n删除后所有日期的该子任务都将消失。\n\n任务标题: ${task.title}`;
            if (!confirm(confirmMsg)) return;
        }

        // Count subtasks of this task
        const childrenCount = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === targetId).length;
        let confirmMsg = i18n("confirmDeleteTask", { title: task.title }) || `确定要删除任务 "${task.title}" 吗？此操作不可撤销。`;
        if (childrenCount > 0) {
            confirmMsg += `\n${i18n("includesNSubtasks", { count: childrenCount.toString() }) || `此任务包含 ${childrenCount} 个子任务，它们也将被一并删除。`}`;
        }

        // Use native confirm or siyuan confirm if available
        if (confirm(confirmMsg)) {
            // Recursive delete
            const deleteRecursive = (idToDelete: string) => {
                const children = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === idToDelete);
                children.forEach((child: any) => deleteRecursive(child.id));
                delete reminderData[idToDelete];
            };

            deleteRecursive(targetId);
            await this.plugin.saveReminderData(reminderData);
            await this.loadSubtasks();
            this.renderSubtasks();
            showMessage(i18n("deleteSuccess"));
        }
    }

    private addDragAndDrop(item: HTMLElement) {
        item.addEventListener("dragstart", (e) => {
            const id = item.getAttribute("data-id");
            if (e.dataTransfer && id) {
                e.dataTransfer.setData("text/plain", id);
                e.dataTransfer.effectAllowed = "move";
            }
            this.draggingId = id;
            item.style.opacity = "0.5";
            item.classList.add("dragging");
        });

        item.addEventListener("dragend", () => {
            this.draggingId = null;
            item.style.opacity = "1";
            item.classList.remove("dragging");
            this.clearAllDragIndicators();
        });

        item.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
            
            const targetId = item.getAttribute("data-id");
            
            if (this.draggingId && targetId && this.draggingId !== targetId) {
                // 根据鼠标位置判断是显示上方还是下方指示器
                const rect = item.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                const isUpperHalf = offsetY < rect.height / 2;
                
                this.showDragIndicator(item, isUpperHalf ? 'top' : 'bottom');
            }
        });

        item.addEventListener("dragleave", (e) => {
            // 只有当真正离开元素时才清除指示器
            const rect = item.getBoundingClientRect();
            const x = e.clientX;
            const y = e.clientY;
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                this.clearDragIndicator(item);
            }
        });

        item.addEventListener("drop", async (e) => {
            e.preventDefault();
            
            const draggingId = e.dataTransfer?.getData("text/plain");
            const targetId = item.getAttribute("data-id");
            
            if (draggingId && targetId && draggingId !== targetId) {
                // 根据鼠标位置决定插入到目标上方还是下方
                const rect = item.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                const insertBefore = offsetY < rect.height / 2;
                
                await this.reorderSubtasks(draggingId, targetId, insertBefore);
            }
            
            this.clearAllDragIndicators();
        });
    }

    private showDragIndicator(item: HTMLElement, position: 'top' | 'bottom') {
        // 先清除所有指示器
        this.clearAllDragIndicators();
        
        // 添加对应的指示器类
        if (position === 'top') {
            item.classList.add("drag-indicator-top");
        } else {
            item.classList.add("drag-indicator-bottom");
        }
    }

    private clearDragIndicator(item: HTMLElement) {
        item.classList.remove("drag-indicator-top", "drag-indicator-bottom");
    }

    private clearAllDragIndicators() {
        const listEl = this.dialog.element?.querySelector("#subtasksList") as HTMLElement;
        if (listEl) {
            listEl.querySelectorAll(".subtask-item").forEach(el => {
                el.classList.remove("drag-indicator-top", "drag-indicator-bottom");
            });
        }
    }

    private getDraggingId(e: DragEvent): string | null {
        // DataTransfer is sometimes not available in dragover in some browsers/environments
        // but for Siyuan/Electron it should be fine.
        return e.dataTransfer?.getData("text/plain") || null;
    }

    private async reorderSubtasks(draggingId: string, targetId: string, insertBefore: boolean = true) {
        const draggingIndex = this.subtasks.findIndex(t => t.id === draggingId);
        let targetIndex = this.subtasks.findIndex(t => t.id === targetId);

        if (draggingIndex === -1 || targetIndex === -1) return;

        // 如果插入到目标下方，调整目标索引
        if (!insertBefore) {
            targetIndex += 1;
        }

        // 如果拖拽项在目标项之前，且要插入到目标之后，需要调整索引
        if (draggingIndex < targetIndex) {
            targetIndex -= 1;
        }

        const [movedTask] = this.subtasks.splice(draggingIndex, 1);
        this.subtasks.splice(targetIndex, 0, movedTask);

        const reminderData = await this.plugin.loadReminderData() || {};
        // Update sort values in reminderData
        this.subtasks.forEach((task: any, index: number) => {
            const sortVal = index * 10;
            task.sort = sortVal;
            if (reminderData[task.id]) {
                reminderData[task.id].sort = sortVal;
            }
        });

        await this.plugin.saveReminderData(reminderData);
        this.renderSubtasks();
        
        // 触发更新事件通知其他组件
        if (movedTask?.projectId) {
            window.dispatchEvent(new CustomEvent('reminderUpdated', {
                detail: {
                    projectId: movedTask.projectId
                }
            }));
        }
        
        showMessage(i18n("sortUpdated") || "排序已更新");
    }
}
