import { Dialog, showMessage } from "siyuan";
import { i18n } from "../pluginInstance";
import { autoDetectDateTimeFromTitle, getLocalDateTimeString } from "../utils/dateUtils";
import { getBlockByID, updateBindBlockAtrrs } from "../api";
import { getAllReminders, saveReminders } from "../utils/icsSubscription";

export interface HierarchicalTask {
    title: string;
    priority?: string;
    startDate?: string;
    time?: string;
    endDate?: string;
    endTime?: string;
    blockId?: string;
    level: number;
    children: HierarchicalTask[];
    completed?: boolean;
}

export interface PasteTaskDialogConfig {
    plugin: any;
    parentTask?: any;
    projectId?: string;
    customGroupId?: string;
    defaultStatus?: string;
    onSuccess?: (totalCount: number) => void;
    onError?: (error: any) => void;
    // 是否显示状态选择器（默认false）
    showStatusSelector?: boolean;
    // 是否显示分组选择器（默认false，仅当项目有自定义分组时显示）
    showGroupSelector?: boolean;
    // 项目自定义分组列表
    projectGroups?: any[];
    // 看板状态配置
    kanbanStatuses?: any[];
}

export class PasteTaskDialog {
    private config: PasteTaskDialogConfig;

    constructor(config: PasteTaskDialogConfig) {
        this.config = config;
    }

    async show() {
        const isSubtask = !!this.config.parentTask;
        const showStatusSelector = this.config.showStatusSelector && !isSubtask;
        const showGroupSelector = this.config.showGroupSelector && !isSubtask && this.config.projectGroups && this.config.projectGroups.length > 0;

        // 构建状态和分组选择器HTML
        let selectorsHtml = '';

        if (showStatusSelector || showGroupSelector) {
            selectorsHtml = `
                <div style="display: flex; gap: 12px; margin-bottom: 12px; padding: 12px; background: var(--b3-theme-surface); border-radius: 6px;">
                    ${showStatusSelector ? this.buildStatusSelectorHtml() : ''}
                    ${showGroupSelector ? this.buildGroupSelectorHtml() : ''}
                </div>
            `;
        }

        const dialog = new Dialog({
            title: isSubtask ? (i18n("pasteAsSubtasks") || "粘贴列表新建子任务") : (i18n("pasteAsTasks") || "粘贴列表新建任务"),
            content: `
                <div class="b3-dialog__content">
                    <p>${i18n("pasteInstructions") || "粘贴Markdown列表或多行文本，每行将创建一个任务。支持多层级列表自动创建父子任务。"}</p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 4px;">
                        ${i18n("supportPrioritySyntax") || "支持语法："}<code>@priority=high&startDate=2025-08-12&endDate=2025-08-30</code>
                    </p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 4px;">
                        ${i18n("supportBlockLink") || "支持块链接："}<code>[任务标题](siyuan://blocks/块ID)</code> 或 <code>((块ID '任务标题'))</code>
                    </p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 8px;">
                        ${i18n("supportHierarchy") || "支持多层级：使用缩进或多个<code>-</code>符号创建父子任务关系"}
                    </p>
                    ${selectorsHtml}
                    <textarea id="taskList" class="b3-text-field"
                        placeholder=""
                        style="width: 100%; height: 250px; resize: vertical;"></textarea>
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px;">
                        <label style="display: flex; align-items: center; cursor: pointer;">
                            <input id="autoDetectDate" type="checkbox" style="margin-right: 8px;">
                            <span>${i18n("autoDetectDateTime")}</span>
                        </label>
                        <label id="removeDateLabel" style="display: flex; align-items: center; cursor: pointer; margin-left: 20px;">
                            <input id="removeDate" type="checkbox" style="margin-right: 8px;">
                            <span>${i18n("removeDateAfterDetection")}</span>
                        </label>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">${i18n("cancel") || "取消"}</button>
                    <button class="b3-button b3-button--primary" id="createBtn">${isSubtask ? (i18n("createSubtasks") || "创建子任务") : (i18n("createTasks") || "创建任务")}</button>
                </div>
            `,
            width: "520px",
        });

        const textArea = dialog.element.querySelector('#taskList') as HTMLTextAreaElement;
        const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const createBtn = dialog.element.querySelector('#createBtn') as HTMLButtonElement;
        const autoDetectCheckbox = dialog.element.querySelector('#autoDetectDate') as HTMLInputElement;
        const removeDateCheckbox = dialog.element.querySelector('#removeDate') as HTMLInputElement;
        const removeDateLabel = dialog.element.querySelector('#removeDateLabel') as HTMLElement;

        // 初始化选中状态
        this.config.plugin.getAutoDetectDateTimeEnabled().then((enabled: boolean) => {
            autoDetectCheckbox.checked = enabled;
            updateRemoveDateVisibility();
        });
        this.config.plugin.getRemoveDateAfterDetectionEnabled().then((enabled: boolean) => {
            removeDateCheckbox.checked = enabled;
        });

        function updateRemoveDateVisibility() {
            if (autoDetectCheckbox.checked) {
                removeDateLabel.style.opacity = "1";
                removeDateLabel.style.pointerEvents = "auto";
                removeDateCheckbox.disabled = false;
            } else {
                removeDateLabel.style.opacity = "0.5";
                removeDateLabel.style.pointerEvents = "none";
                removeDateCheckbox.disabled = true;
            }
        }

        autoDetectCheckbox.addEventListener('change', () => {
            updateRemoveDateVisibility();
        });

        cancelBtn.addEventListener('click', () => dialog.destroy());

        createBtn.addEventListener('click', async () => {
            const text = textArea.value.trim();
            if (!text) {
                showMessage(i18n("contentNotEmpty") || "列表内容不能为空");
                return;
            }

            const autoDetect = autoDetectCheckbox.checked;
            const removeDate = removeDateCheckbox.checked;
            const hierarchicalTasks = this.parseHierarchicalTaskList(text, autoDetect, removeDate);

            // 获取用户选择的状态和分组
            let selectedStatus = this.config.defaultStatus;
            let selectedGroupId = this.config.customGroupId;

            if (showStatusSelector) {
                const statusSelect = dialog.element.querySelector('#pasteTaskStatus') as HTMLSelectElement;
                if (statusSelect) {
                    selectedStatus = statusSelect.value;
                }
            }

            if (showGroupSelector) {
                const groupSelect = dialog.element.querySelector('#pasteTaskGroup') as HTMLSelectElement;
                if (groupSelect) {
                    const gid = groupSelect.value;
                    selectedGroupId = gid === 'none' ? null : gid;
                }
            }

            if (hierarchicalTasks.length > 0) {
                try {
                    await this.batchCreateTasksWithHierarchy(hierarchicalTasks, selectedStatus, selectedGroupId);
                    dialog.destroy();
                    const totalTasks = this.countTotalTasks(hierarchicalTasks);
                    if (this.config.onSuccess) {
                        this.config.onSuccess(totalTasks);
                    } else {
                        showMessage(`${totalTasks} ${i18n("tasksCreated") || "个任务已创建"}`);
                    }
                } catch (error) {
                    console.error('批量创建任务失败:', error);
                    if (this.config.onError) {
                        this.config.onError(error);
                    } else {
                        showMessage(i18n("batchCreateFailed") || "批量创建任务失败");
                    }
                }
            }
        });
    }

    private parseHierarchicalTaskList(text: string, autoDetect: boolean = false, removeDate: boolean = true): HierarchicalTask[] {
        const lines = text.split('\n');
        const tasks: HierarchicalTask[] = [];
        const stack: Array<{ task: HierarchicalTask; level: number }> = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            const level = this.calculateIndentLevel(line);
            const cleanLine = line.trim();

            if (!cleanLine || (!cleanLine.startsWith('-') && level === 0 && !cleanLine.match(/^\s*-/))) {
                if (cleanLine && level === 0) {
                    const taskData = this.parseTaskLine(cleanLine, autoDetect, removeDate);
                    const task: HierarchicalTask = {
                        ...taskData,
                        level: 0,
                        children: []
                    };
                    tasks.push(task);
                    stack.length = 0;
                    stack.push({ task, level: 0 });
                }
                continue;
            }

            let levelFromDashes = 0;
            const dashPrefixMatch = cleanLine.match(/^(-{2,})\s*/);
            if (dashPrefixMatch) {
                levelFromDashes = dashPrefixMatch[1].length - 1;
            }

            const combinedLevel = level + levelFromDashes;
            const taskContent = cleanLine.replace(/^[-*+]+\s*/, '');
            if (!taskContent) continue;

            const taskData = this.parseTaskLine(taskContent, autoDetect, removeDate);
            const task: HierarchicalTask = {
                ...taskData,
                level: combinedLevel,
                children: []
            };

            while (stack.length > 0 && stack[stack.length - 1].level >= combinedLevel) {
                stack.pop();
            }

            if (stack.length === 0) {
                tasks.push(task);
            } else {
                const parent = stack[stack.length - 1].task;
                parent.children.push(task);
            }

            stack.push({ task, level: combinedLevel });
        }

        return tasks;
    }

    private calculateIndentLevel(line: string): number {
        const match = line.match(/^(\s*)/);
        if (!match) return 0;
        const indent = match[1];
        const spaces = indent.replace(/\t/g, '  ').length;
        return Math.floor(spaces / 2);
    }

    private parseTaskLine(line: string, autoDetect: boolean = false, removeDate: boolean = true): Omit<HierarchicalTask, 'level' | 'children'> {
        const paramMatch = line.match(/@(.*)$/);
        let title = line;
        let priority: string | undefined;
        let startDate: string | undefined;
        let time: string | undefined;
        let endDate: string | undefined;
        let endTime: string | undefined;
        let blockId: string | undefined;
        let completed: boolean | undefined;

        blockId = this.extractBlockIdFromText(line);

        if (blockId) {
            title = title.replace(/\[([^\]]+)\]\(siyuan:\/\/blocks\/[^)]+\)/g, '$1');
            title = title.replace(/\(\([^\s)]+\s+'([^']+)'\)\)/g, '$1');
            title = title.replace(/\(\([^\s)]+\s+"([^"]+)"\)\)/g, '$1');
            title = title.replace(/\(\([^\)]+\)\)/g, '');
        }

        const checkboxMatch = title.match(/^\s*\[\s*([ xX])\s*\]\s*/);
        if (checkboxMatch) {
            const mark = checkboxMatch[1];
            completed = (mark.toLowerCase() === 'x');
            title = title.replace(/^\s*\[\s*([ xX])\s*\]\s*/, '').trim();
        }

        const leadingCheckboxMatch = line.match(/^\s*[-*+]\s*\[\s*([ xX])\s*\]\s*(.+)$/);
        if (leadingCheckboxMatch) {
            completed = (leadingCheckboxMatch[1].toLowerCase() === 'x');
            title = leadingCheckboxMatch[2];
        }

        if (autoDetect) {
            const detected = autoDetectDateTimeFromTitle(title);
            if (detected.date || detected.endDate) {
                if (removeDate) {
                    title = detected.cleanTitle || title;
                }
                startDate = detected.date;
                time = detected.time;
                endDate = detected.endDate;
                endTime = detected.endTime;
            }
        }

        if (paramMatch) {
            title = title.replace(/@(.*)$/, '').trim();
            const paramString = paramMatch[1];
            const params = new URLSearchParams(paramString);
            priority = params.get('priority') || undefined;
            startDate = params.get('startDate') || startDate;
            endDate = params.get('endDate') || endDate;
            if (priority && !['high', 'medium', 'low', 'none'].includes(priority)) priority = 'none';
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (startDate && !dateRegex.test(startDate)) startDate = undefined;
            if (endDate && !dateRegex.test(endDate)) endDate = undefined;
        }

        return { title: title.trim() || i18n('noContentHint') || '未命名任务', priority, startDate, time, endDate, endTime, blockId, completed };
    }

    private async batchCreateTasksWithHierarchy(tasks: HierarchicalTask[], selectedStatus?: string, selectedGroupId?: string | null) {
        const reminderData = await getAllReminders(this.config.plugin, undefined, true);
        const parentTask = this.config.parentTask;
        const projectId = this.config.projectId || (parentTask ? parentTask.projectId : undefined);
        const categoryId = parentTask ? parentTask.categoryId : undefined;

        // 获取当前项目中所有任务的最大排序值
        const maxSort = Object.values(reminderData)
            .filter((r: any) => r && r.projectId === projectId && typeof r.sort === 'number')
            .reduce((max: number, task: any) => Math.max(max, task.sort || 0), 0) as number;

        let sortCounter = maxSort;

        const createTaskRecursively = async (
            task: HierarchicalTask,
            parentId?: string,
            parentPriority?: string,
            inheritedGroupId?: string
        ): Promise<string> => {
            const taskId = `rem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            sortCounter += 10;

            const inheritedPriority = (task.priority && task.priority !== 'none') ? task.priority : (parentPriority || 'none');

            // 优先使用用户选择的状态
            const statusToUse = selectedStatus !== undefined ? selectedStatus : this.config.defaultStatus;
            let kanbanStatus = 'todo';

            if (statusToUse) {
                // 自定义状态，直接使用作为 kanbanStatus
                kanbanStatus = statusToUse;
            } else {
                // 默认使用 doing
                kanbanStatus = 'doing';
            }

            const newTask: any = {
                id: taskId,
                title: task.title,
                note: '',
                priority: inheritedPriority,
                categoryId: categoryId,
                projectId: projectId,
                completed: !!task.completed,
                kanbanStatus: kanbanStatus,
                createdTime: new Date().toISOString(),
                created: getLocalDateTimeString(new Date()),
                date: task.startDate,
                time: task.time,
                endDate: task.endDate,
                endTime: task.endTime,
                sort: sortCounter,
            };

            if (parentId) {
                newTask.parentId = parentId;
            }

            if (inheritedGroupId) {
                newTask.customGroupId = inheritedGroupId;
            } else if (parentId) {
                const parent = reminderData[parentId];
                if (parent && parent.customGroupId) {
                    newTask.customGroupId = parent.customGroupId;
                }
            }

            if (task.blockId) {
                try {
                    const block = await getBlockByID(task.blockId);
                    if (block) {
                        newTask.blockId = task.blockId;
                        newTask.docId = block.root_id || task.blockId;

                        if (!task.title || task.title === i18n('noContentHint') || task.title === '未命名任务') {
                            newTask.title = block.content || block.fcontent || i18n('noContentHint') || '未命名任务';
                        }

                        if (projectId) {
                            const { addBlockProjectId } = await import('../api');
                            await addBlockProjectId(task.blockId, projectId);
                        }

                        await updateBindBlockAtrrs(task.blockId, this.config.plugin);
                    }
                } catch (error) {
                    console.error('绑定块失败:', error);
                }
            }

            reminderData[taskId] = newTask;

            if (task.children && task.children.length > 0) {
                for (const child of task.children) {
                    await createTaskRecursively(child, taskId, inheritedPriority, inheritedGroupId);
                }
            }

            return taskId;
        };

        // 使用用户选择的分组，如果没有则使用配置的分组
        const groupToUse = selectedGroupId !== undefined ? selectedGroupId : this.config.customGroupId;

        for (const task of tasks) {
            const topParentId = parentTask ? parentTask.id : undefined;
            const parentPriority = parentTask?.priority;
            await createTaskRecursively(task, topParentId, parentPriority, groupToUse);
        }

        await saveReminders(this.config.plugin, reminderData);
    }

    private countTotalTasks(tasks: HierarchicalTask[]): number {
        let count = 0;
        const countRecursively = (taskList: HierarchicalTask[]) => {
            for (const task of taskList) {
                count++;
                if (task.children && task.children.length > 0) {
                    countRecursively(task.children);
                }
            }
        };
        countRecursively(tasks);
        return count;
    }

    private extractBlockIdFromText(text: string): string | undefined {
        const markdownLinkMatch = text.match(/\[([^\]]+)\]\(siyuan:\/\/blocks\/([^)]+)\)/);
        if (markdownLinkMatch) {
            const blockId = markdownLinkMatch[2];
            if (blockId && blockId.length >= 20) return blockId;
        }

        const blockRefWithTitleMatch = text.match(/\(\(([^)\s]+)\s+['"]([^'"]+)['"]\)\)/);
        if (blockRefWithTitleMatch) {
            const blockId = blockRefWithTitleMatch[1];
            if (blockId && blockId.length >= 20) return blockId;
        }

        const simpleBlockRefMatch = text.match(/\(\(([^)]+)\)\)/);
        if (simpleBlockRefMatch) {
            const blockId = simpleBlockRefMatch[1].trim();
            if (blockId && blockId.length >= 20) return blockId;
        }

        return undefined;
    }

    private buildStatusSelectorHtml(): string {
        const kanbanStatuses = this.config.kanbanStatuses || [];
        const defaultStatus = this.config.defaultStatus || 'short_term';

        // 状态名称映射
        const statusNameMap: { [key: string]: string } = {
            'doing': '进行中',
            'long_term': '长期',
            'short_term': '短期',
            'completed': '已完成'
        };

        // 构建状态选项（排除已完成状态）
        let statusOptionsHtml = '';
        kanbanStatuses
            .filter((status: any) => status.id !== 'completed')
            .forEach((status: any) => {
                const name = status.name || statusNameMap[status.id] || status.id;
                const selected = status.id === defaultStatus ? 'selected' : '';
                statusOptionsHtml += `<option value="${status.id}" ${selected}>${status.icon || ''} ${name}</option>`;
            });

        // 如果没有配置状态，使用默认选项
        if (kanbanStatuses.length === 0) {
            statusOptionsHtml = `
                <option value="short_term" ${defaultStatus === 'short_term' ? 'selected' : ''}>短期</option>
                <option value="long_term" ${defaultStatus === 'long_term' ? 'selected' : ''}>长期</option>
                <option value="doing" ${defaultStatus === 'doing' ? 'selected' : ''}>进行中</option>
            `;
        }

        return `
            <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                <label style="font-size: 12px; color: var(--b3-theme-on-surface); white-space: nowrap;">${i18n('taskStatus') || '任务状态'}:</label>
                <select id="pasteTaskStatus" class="b3-select" style="flex: 1; min-width: 100px;">
                    ${statusOptionsHtml}
                </select>
            </div>
        `;
    }

    private buildGroupSelectorHtml(): string {
        const projectGroups = this.config.projectGroups || [];
        const defaultGroupId = this.config.customGroupId || 'none';

        // 构建分组选项
        let groupOptionsHtml = `<option value="none" ${!this.config.customGroupId ? 'selected' : ''}>${i18n('noGroup') || '无分组'}</option>`;

        projectGroups.forEach((group: any) => {
            const selected = group.id === defaultGroupId ? 'selected' : '';
            groupOptionsHtml += `<option value="${group.id}" ${selected}>${group.icon || '📋'} ${group.name}</option>`;
        });

        return `
            <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                <label style="font-size: 12px; color: var(--b3-theme-on-surface); white-space: nowrap;">${i18n('taskGroup') || '任务分组'}:</label>
                <select id="pasteTaskGroup" class="b3-select" style="flex: 1; min-width: 100px;">
                    ${groupOptionsHtml}
                </select>
            </div>
        `;
    }
}
