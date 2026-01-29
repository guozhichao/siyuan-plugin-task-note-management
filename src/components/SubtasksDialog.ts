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
        this.subtasks = Object.values(reminderData).filter((r: any) => r.parentId === this.parentId);
        this.subtasks.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    }

    private renderSubtasks() {
        const listEl = this.dialog.element.querySelector("#subtasksList") as HTMLElement;
        if (!listEl) return;

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

        const dialog = new QuickReminderDialog(undefined, undefined, async () => {
            await this.loadSubtasks();
            this.renderSubtasks();
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
        if (reminderData[id]) {
            reminderData[id].completed = completed;
            if (completed) {
                reminderData[id].completedTime = new Date().toISOString();
            } else {
                delete reminderData[id].completedTime;
            }
            await this.plugin.saveReminderData(reminderData);
            await this.loadSubtasks();
            this.renderSubtasks();
        }
    }

    private async deleteSubtask(id: string) {
        const reminderData = await this.plugin.loadReminderData() || {};
        const task = reminderData[id];
        if (!task) return;

        // Count subtasks of this task
        const childrenCount = Object.values(reminderData).filter((r: any) => r.parentId === id).length;
        let confirmMsg = i18n("confirmDeleteTask", { title: task.title }) || `确定要删除任务 "${task.title}" 吗？此操作不可撤销。`;
        if (childrenCount > 0) {
            confirmMsg += `\n${i18n("includesNSubtasks", { count: childrenCount.toString() }) || `此任务包含 ${childrenCount} 个子任务，它们也将被一并删除。`}`;
        }

        // Use native confirm or siyuan confirm if available
        if (confirm(confirmMsg)) {
            // Recursive delete
            const deleteRecursive = (targetId: string) => {
                const children = Object.values(reminderData).filter((r: any) => r.parentId === targetId);
                children.forEach((child: any) => deleteRecursive(child.id));
                delete reminderData[targetId];
            };

            deleteRecursive(id);
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
            item.style.opacity = "0.5";
        });

        item.addEventListener("dragend", () => {
            item.style.opacity = "1";
            const listEl = this.dialog.element.querySelector("#subtasksList") as HTMLElement;
            listEl.querySelectorAll(".subtask-item").forEach(el => (el as HTMLElement).style.borderTop = "");
        });

        item.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
            const draggingId = this.getDraggingId(e);
            if (draggingId && draggingId !== item.getAttribute("data-id")) {
                item.style.borderTop = "2px solid var(--b3-theme-primary)";
            }
        });

        item.addEventListener("dragleave", () => {
            item.style.borderTop = "";
        });

        item.addEventListener("drop", async (e) => {
            e.preventDefault();
            item.style.borderTop = "";
            const draggingId = e.dataTransfer?.getData("text/plain");
            const targetId = item.getAttribute("data-id");

            if (draggingId && targetId && draggingId !== targetId) {
                await this.reorderSubtasks(draggingId, targetId);
            }
        });
    }

    private getDraggingId(e: DragEvent): string | null {
        // DataTransfer is sometimes not available in dragover in some browsers/environments
        // but for Siyuan/Electron it should be fine.
        return e.dataTransfer?.getData("text/plain") || null;
    }

    private async reorderSubtasks(draggingId: string, targetId: string) {
        const draggingIndex = this.subtasks.findIndex(t => t.id === draggingId);
        const targetIndex = this.subtasks.findIndex(t => t.id === targetId);

        if (draggingIndex === -1 || targetIndex === -1) return;

        const [draggingTask] = this.subtasks.splice(draggingIndex, 1);
        this.subtasks.splice(targetIndex, 0, draggingTask);

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
        showMessage(i18n("sortUpdated") || "排序已更新");
    }
}
