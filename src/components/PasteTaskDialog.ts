import { Dialog, showMessage } from "siyuan";
import { i18n } from "../pluginInstance";
import { autoDetectDateTimeFromTitle, getLocalDateTimeString } from "../utils/dateUtils";
import { getBlockByID, updateBindBlockAtrrs, addBlockProjectId } from "../api";
import { getAllReminders, saveReminders } from "../utils/icsSubscription";
import LoadingDialog from './LoadingDialog.svelte';

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
    // 项目里程碑列表（未分组时的里程碑）
    projectMilestones?: any[];
    // 看板状态配置
    kanbanStatuses?: any[];
    // 临时模式：不保存到数据库，通过 onTasksCreated 回调返回任务数组
    isTempMode?: boolean;
    // 临时模式回调，参数为创建的任务数组
    onTasksCreated?: (tasks: any[]) => void;
}

export class PasteTaskDialog {
    private config: PasteTaskDialogConfig;
    private loadingDialog: Dialog | null = null;

    constructor(config: PasteTaskDialogConfig) {
        this.config = config;
    }

    async show() {
        const isSubtask = !!this.config.parentTask;
        const showStatusSelector = this.config.showStatusSelector && !isSubtask;
        const showGroupSelector = this.config.showGroupSelector && !isSubtask && this.config.projectGroups && this.config.projectGroups.length > 0;

        // 允许显示里程碑选择器，如果有分组或项目有里程碑
        const hasMilestones = (this.config.projectMilestones && this.config.projectMilestones.length > 0) ||
            (this.config.projectGroups && this.config.projectGroups.some(g => g.milestones && g.milestones.length > 0));
        const showMilestoneSelector = !isSubtask && hasMilestones;

        // 构建状态和分组选择器HTML
        let selectorsHtml = '';

        if (showStatusSelector || showGroupSelector || showMilestoneSelector) {
            selectorsHtml = `
                <div style="display: flex; gap: 12px; margin-bottom: 12px; padding: 12px; background: var(--b3-theme-surface); border-radius: 6px; flex-wrap: wrap;">
                    ${showStatusSelector ? this.buildStatusSelectorHtml() : ''}
                    ${showGroupSelector ? this.buildGroupSelectorHtml() : ''}
                    ${showMilestoneSelector ? this.buildMilestoneSelectorHtml() : ''}
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
                        ${i18n("supportBlockLink") || "支持绑定块："}<code>[任务标题](siyuan://blocks/块ID)</code> 或 <code>((块ID '任务标题'))</code>
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
        const groupSelect = dialog.element.querySelector('#pasteTaskGroup') as HTMLSelectElement;
        const milestoneSelect = dialog.element.querySelector('#pasteTaskMilestone') as HTMLSelectElement;
        const milestoneContainer = dialog.element.querySelector('#pasteTaskMilestoneContainer') as HTMLElement;

        // 监听分组变更，更新里程碑选项
        if (groupSelect && milestoneSelect) {
            groupSelect.addEventListener('change', () => {
                const selectedGroupId = groupSelect.value === 'none' ? undefined : groupSelect.value;
                const milestones = this.getMilestonesForGroup(selectedGroupId || 'none');

                if (milestoneContainer) {
                    if (milestones.length > 0) {
                        milestoneContainer.style.display = 'flex';
                        const optionsHtml = this.getMilestoneOptionsHtml(selectedGroupId || 'none');
                        milestoneSelect.innerHTML = optionsHtml;
                    } else {
                        milestoneContainer.style.display = 'none';
                        milestoneSelect.value = ''; // 清空选择
                    }
                } else {
                    // Fallback if container not found but elements exist (shouldn't happen with current logic)
                    const optionsHtml = this.getMilestoneOptionsHtml(selectedGroupId || 'none');
                    milestoneSelect.innerHTML = optionsHtml;
                }
            });
        }

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
            // 防止重复点击
            if ((createBtn as HTMLButtonElement).disabled) return;

            const text = textArea.value.trim();
            if (!text) {
                showMessage(i18n("contentNotEmpty") || "列表内容不能为空");
                return;
            }

            // 禁用按钮并显示加载中文本
            (createBtn as HTMLButtonElement).disabled = true;
            const originalCreateHtml = createBtn.innerHTML;
            createBtn.innerHTML = i18n('creating') || '创建中...';

            // 显示加载对话框
            this.showLoadingDialog("创建任务中...");

            const autoDetect = autoDetectCheckbox.checked;
            const removeDate = removeDateCheckbox.checked;
            const hierarchicalTasks = this.parseHierarchicalTaskList(text, autoDetect, removeDate);

            // 获取用户选择的状态和分组
            let selectedStatus = this.config.defaultStatus;
            let selectedGroupId = this.config.customGroupId;
            let selectedMilestoneId: string | undefined = undefined;

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

            if (showMilestoneSelector) {
                const milestoneSelect = dialog.element.querySelector('#pasteTaskMilestone') as HTMLSelectElement;
                if (milestoneSelect) {
                    selectedMilestoneId = milestoneSelect.value || undefined;
                }
            }

            if (hierarchicalTasks.length > 0) {
                try {
                    const createdTasks = await this.batchCreateTasksWithHierarchy(hierarchicalTasks, selectedStatus, selectedGroupId, selectedMilestoneId);
                    dialog.destroy();
                    const totalTasks = this.countTotalTasks(hierarchicalTasks);
                    
                    // 临时模式：通过回调返回创建的任务
                    if (this.config.isTempMode && this.config.onTasksCreated) {
                        this.config.onTasksCreated(createdTasks);
                    }
                    
                    if (this.config.onSuccess) {
                        this.config.onSuccess(totalTasks);
                    } else if (!this.config.isTempMode) {
                        showMessage(`${totalTasks} ${i18n("tasksCreated") || "个任务已创建"}`);
                    }
                } catch (error) {
                    console.error('批量创建任务失败:', error);
                    if (this.config.onError) {
                        this.config.onError(error);
                    } else {
                        showMessage(i18n("batchCreateFailed") || "批量创建任务失败");
                    }
                } finally {
                    // 关闭加载对话框
                    this.closeLoadingDialog();
                    // 如果对话框还存在，恢复按钮状态
                    try {
                        (createBtn as HTMLButtonElement).disabled = false;
                        createBtn.innerHTML = originalCreateHtml;
                    } catch (e) {
                        // ignore
                    }
                }
            } else {
                // 无任务时恢复按钮
                (createBtn as HTMLButtonElement).disabled = false;
                createBtn.innerHTML = originalCreateHtml;
                // 关闭加载对话框
                this.closeLoadingDialog();
            }
        });
    }

    private showLoadingDialog(message: string) {
        if (this.loadingDialog) {
            this.loadingDialog.destroy();
        }
        this.loadingDialog = new Dialog({
            title: "Processing",
            content: `<div id="loadingDialogContent"></div>`,
            width: "350px",
            height: "230px",
            disableClose: true,
            destroyCallback: null
        });

        const loadingComponent = new LoadingDialog({
            target: this.loadingDialog.element.querySelector('#loadingDialogContent'),
            props: {
                message: message
            }
        });
    }

    private closeLoadingDialog() {
        if (this.loadingDialog) {
            this.loadingDialog.destroy();
            this.loadingDialog = null;
        }
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

    private async batchCreateTasksWithHierarchy(tasks: HierarchicalTask[], selectedStatus?: string, selectedGroupId?: string | null, selectedMilestoneId?: string): Promise<any[]> {
        const parentTask = this.config.parentTask;
        const projectId = this.config.projectId || (parentTask ? parentTask.projectId : undefined);
        const categoryId = parentTask ? parentTask.categoryId : undefined;

        // 临时模式下不需要从数据库读取
        const reminderData = this.config.isTempMode ? {} : await getAllReminders(this.config.plugin, undefined, true);

        // 获取当前项目中所有任务的最大排序值
        const maxSort = this.config.isTempMode ? 0 : Object.values(reminderData)
            .filter((r: any) => r && r.projectId === projectId && typeof r.sort === 'number')
            .reduce((max: number, task: any) => Math.max(max, task.sort || 0), 0) as number;

        let sortCounter = maxSort;
        const createdTasks: any[] = [];
        const boundBlockIds = new Set<string>();

        const createTaskRecursively = async (
            task: HierarchicalTask,
            parentId?: string,
            parentPriority?: string,
            inheritedGroupId?: string
        ): Promise<string> => {
            const taskId = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

            if (selectedMilestoneId) {
                newTask.milestoneId = selectedMilestoneId;
            }

            if (parentId) {
                newTask.parentId = parentId;
            }

            if (inheritedGroupId) {
                newTask.customGroupId = inheritedGroupId;
            } else if (parentId && !this.config.isTempMode) {
                const parent = reminderData[parentId];
                if (parent && parent.customGroupId) {
                    newTask.customGroupId = parent.customGroupId;
                }
            }

            // 临时模式标记
            if (this.config.isTempMode) {
                newTask.isTempSubtask = true;
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

                        if (projectId && !this.config.isTempMode) {
                            await addBlockProjectId(task.blockId, projectId);
                        }

                        boundBlockIds.add(task.blockId);
                    }
                } catch (error) {
                    console.error('绑定块失败:', error);
                }
            }

            reminderData[taskId] = newTask;
            createdTasks.push(newTask);

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

        // 临时模式下不保存到数据库，通过回调返回
        if (!this.config.isTempMode) {
            await saveReminders(this.config.plugin, reminderData);

            // 更新块属性
            for (const blockId of boundBlockIds) {
                try {
                    await updateBindBlockAtrrs(blockId, this.config.plugin);
                } catch (error) {
                    console.error(`更新块 ${blockId} 属性失败:`, error);
                }
            }
        }

        return createdTasks;
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

    private buildMilestoneSelectorHtml(): string {
        // 初始构建HTML，选项将由JS根据当前选中的分组动态填充
        // 这里可以预填充默认选项（基于 config.customGroupId）
        const initialGroupId = this.config.customGroupId || 'none';
        const milestones = this.getMilestonesForGroup(initialGroupId);
        const optionsHtml = this.getMilestoneOptionsHtml(initialGroupId);

        // 如果当前分组没有里程碑，则初始隐藏
        const displayStyle = milestones.length > 0 ? 'flex' : 'none';

        return `
            <div id="pasteTaskMilestoneContainer" style="display: ${displayStyle}; align-items: center; gap: 6px; flex: 1;">
                <label style="font-size: 12px; color: var(--b3-theme-on-surface); white-space: nowrap;">${i18n('milestone') || '里程碑'}:</label>
                <select id="pasteTaskMilestone" class="b3-select" style="flex: 1; min-width: 100px;">
                    ${optionsHtml}
                </select>
            </div>
        `;
    }

    private getMilestonesForGroup(groupId: string): any[] {
        let milestones: any[] = [];
        if (groupId === 'none' || !groupId) {
            milestones = this.config.projectMilestones || [];
        } else {
            const group = this.config.projectGroups?.find(g => g.id === groupId);
            milestones = group?.milestones || [];
        }

        // 过滤掉已归档的里程碑
        return milestones.filter(m => !m.archived);
    }

    private getMilestoneOptionsHtml(groupId: string): string {
        const milestones = this.getMilestonesForGroup(groupId);
        let html = `<option value="">${i18n('noMilestone') || '无里程碑'}</option>`;
        milestones.forEach(m => {
            html += `<option value="${m.id}">${m.icon ? m.icon + ' ' : ''}${m.name}</option>`;
        });
        return html;
    }
}
