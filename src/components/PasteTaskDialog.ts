import { Dialog, showMessage } from "siyuan";
import { t } from "../utils/i18n";
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
    defaultTermType?: string;
    onSuccess?: (totalCount: number) => void;
    onError?: (error: any) => void;
}

export class PasteTaskDialog {
    private config: PasteTaskDialogConfig;

    constructor(config: PasteTaskDialogConfig) {
        this.config = config;
    }

    show() {
        const isSubtask = !!this.config.parentTask;
        const dialog = new Dialog({
            title: isSubtask ? (t("pasteAsSubtasks") || "粘贴列表新建子任务") : (t("pasteAsTasks") || "粘贴列表新建任务"),
            content: `
                <div class="b3-dialog__content">
                    <p>${t("pasteInstructions") || "粘贴Markdown列表或多行文本，每行将创建一个任务。支持多层级列表自动创建父子任务。"}</p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 4px;">
                        ${t("supportPrioritySyntax") || "支持语法："}<code>@priority=high&startDate=2025-08-12&endDate=2025-08-30</code>
                    </p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 4px;">
                        ${t("supportBlockLink") || "支持块链接："}<code>[任务标题](siyuan://blocks/块ID)</code> 或 <code>((块ID '任务标题'))</code>
                    </p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 8px;">
                        ${t("supportHierarchy") || "支持多层级：使用缩进或多个<code>-</code>符号创建父子任务关系"}
                    </p>
                    <textarea id="taskList" class="b3-text-field"
                        placeholder=""
                        style="width: 100%; height: 250px; resize: vertical;"></textarea>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">${t("cancel") || "取消"}</button>
                    <button class="b3-button b3-button--primary" id="createBtn">${isSubtask ? (t("createSubtasks") || "创建子任务") : (t("createTasks") || "创建任务")}</button>
                </div>
            `,
            width: "500px",
        });

        const textArea = dialog.element.querySelector('#taskList') as HTMLTextAreaElement;
        const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const createBtn = dialog.element.querySelector('#createBtn') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        createBtn.addEventListener('click', async () => {
            const text = textArea.value.trim();
            if (!text) {
                showMessage(t("contentNotEmpty") || "列表内容不能为空");
                return;
            }

            const autoDetect = await this.config.plugin.getAutoDetectDateTimeEnabled();
            const hierarchicalTasks = this.parseHierarchicalTaskList(text, autoDetect);

            if (hierarchicalTasks.length > 0) {
                try {
                    await this.batchCreateTasksWithHierarchy(hierarchicalTasks);
                    dialog.destroy();
                    const totalTasks = this.countTotalTasks(hierarchicalTasks);
                    if (this.config.onSuccess) {
                        this.config.onSuccess(totalTasks);
                    } else {
                        showMessage(`${totalTasks} ${t("tasksCreated") || "个任务已创建"}`);
                    }
                } catch (error) {
                    console.error('批量创建任务失败:', error);
                    if (this.config.onError) {
                        this.config.onError(error);
                    } else {
                        showMessage(t("batchCreateFailed") || "批量创建任务失败");
                    }
                }
            }
        });
    }

    private parseHierarchicalTaskList(text: string, autoDetect: boolean = false): HierarchicalTask[] {
        const lines = text.split('\n');
        const tasks: HierarchicalTask[] = [];
        const stack: Array<{ task: HierarchicalTask; level: number }> = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            const level = this.calculateIndentLevel(line);
            const cleanLine = line.trim();

            if (!cleanLine || (!cleanLine.startsWith('-') && level === 0 && !cleanLine.match(/^\s*-/))) {
                if (cleanLine && level === 0) {
                    const taskData = this.parseTaskLine(cleanLine, autoDetect);
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

            const taskData = this.parseTaskLine(taskContent, autoDetect);
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

    private parseTaskLine(line: string, autoDetect: boolean = false): Omit<HierarchicalTask, 'level' | 'children'> {
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
                title = detected.cleanTitle || title;
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

        return { title: title.trim() || t('noContentHint') || '未命名任务', priority, startDate, time, endDate, endTime, blockId, completed };
    }

    private async batchCreateTasksWithHierarchy(tasks: HierarchicalTask[]) {
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

            const newTask: any = {
                id: taskId,
                title: task.title,
                note: '',
                priority: inheritedPriority,
                categoryId: categoryId,
                projectId: projectId,
                completed: !!task.completed,
                kanbanStatus: 'todo',
                termType: this.config.defaultTermType || 'short_term',
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

                        if (!task.title || task.title === t('noContentHint') || task.title === '未命名任务') {
                            newTask.title = block.content || block.fcontent || t('noContentHint') || '未命名任务';
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

        for (const task of tasks) {
            const topParentId = parentTask ? parentTask.id : undefined;
            const parentPriority = parentTask?.priority;
            await createTaskRecursively(task, topParentId, parentPriority, this.config.customGroupId);
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
}
