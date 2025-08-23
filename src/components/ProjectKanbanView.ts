import { showMessage, confirm, Menu, Dialog } from "siyuan";

import { readReminderData, writeReminderData, readProjectData, getBlockByID, updateBlockReminderBookmark, openBlock } from "../api";
import { getLocalDateString, getLocalDateTimeString } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { PomodoroTimer } from "./PomodoroTimer";
import { CategoryManageDialog } from "./CategoryManageDialog";

export class ProjectKanbanView {
    private container: HTMLElement;
    private plugin: any;
    private projectId: string;
    private project: any;
    private categoryManager: CategoryManager;
    private currentSort: string = 'priority';
    private currentSortOrder: 'asc' | 'desc' = 'desc';
    private doneSort: string = 'completedTime';
    private doneSortOrder: 'asc' | 'desc' = 'desc';
    private showDone: boolean = true; // 改为默认显示已完成任务
    private tasks: any[] = [];
    private isDragging: boolean = false;
    private draggedTask: any = null;
    private draggedElement: HTMLElement | null = null;
    private sortButton: HTMLButtonElement;
    private doneSortButton: HTMLButtonElement;
    private isLoading: boolean = false;
    private collapsedTasks: Set<string> = new Set();

    // 添加静态变量来跟踪当前活动的番茄钟
    private static currentPomodoroTimer: PomodoroTimer | null = null;

    constructor(container: HTMLElement, plugin: any, projectId: string) {
        this.container = container;
        this.plugin = plugin;
        this.projectId = projectId;
        this.categoryManager = CategoryManager.getInstance();
        this.initializeAsync();
    }

    private async initializeAsync() {
        await this.categoryManager.initialize();
        await this.loadProject();
        this.initUI();
        await this.loadTasks();

        // 监听提醒更新事件
        window.addEventListener('reminderUpdated', () => this.loadTasks());
    }

    private async loadProject() {
        try {
            const projectData = await readProjectData();
            this.project = projectData[this.projectId];
            if (!this.project) {
                throw new Error('项目不存在');
            }
        } catch (error) {
            console.error('加载项目失败:', error);
            showMessage("加载项目失败");
        }
    }

    private initUI() {
        this.container.classList.add('project-kanban-view');
        this.container.innerHTML = '';

        // 创建工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'project-kanban-toolbar';
        this.container.appendChild(toolbar);

        // 项目标题
        const titleContainer = document.createElement('div');
        titleContainer.className = 'project-kanban-title';

        const titleEl = document.createElement('h2');
        titleEl.textContent = this.project?.title || '项目看板';
        titleEl.style.cssText = `
            margin: 0;
            font-size: 18px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        `;
        titleContainer.appendChild(titleEl);

        // 项目描述
        if (this.project?.note) {
            const descEl = document.createElement('div');
            descEl.className = 'project-kanban-description';
            descEl.textContent = this.project.note;
            descEl.style.cssText = `
                margin-top: 4px;
                font-size: 14px;
                color: var(--b3-theme-on-surface);
                opacity: 0.8;
            `;
            titleContainer.appendChild(descEl);
        }

        toolbar.appendChild(titleContainer);

        // 控制按钮组
        const controlsGroup = document.createElement('div');
        controlsGroup.className = 'project-kanban-controls';
        controlsGroup.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            margin-left: auto;
        `;

        // 新建任务按钮
        const addTaskBtn = document.createElement('button');
        addTaskBtn.className = 'b3-button b3-button--primary';
        addTaskBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> 新建任务';
        addTaskBtn.addEventListener('click', () => this.showCreateTaskDialog());
        controlsGroup.appendChild(addTaskBtn);

        const pasteTaskBtn = document.createElement('button');
        pasteTaskBtn.className = 'b3-button';
        pasteTaskBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg> 粘贴列表';
        pasteTaskBtn.addEventListener('click', () => this.showPasteTaskDialog());
        controlsGroup.appendChild(pasteTaskBtn);

        // 显示/隐藏已完成任务
        const toggleDoneBtn = document.createElement('button');
        toggleDoneBtn.className = 'b3-button b3-button--outline';
        toggleDoneBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconEye"></use></svg> ${this.showDone ? '隐藏已完成' : '显示已完成'}`;
        toggleDoneBtn.addEventListener('click', () => {
            this.showDone = !this.showDone;
            toggleDoneBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconEye"></use></svg> ${this.showDone ? '隐藏已完成' : '显示已完成'}`;
            this.renderKanban();
        });
        controlsGroup.appendChild(toggleDoneBtn);

        // 排序按钮
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'b3-button b3-button--outline';
        this.sortButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        this.sortButton.addEventListener('click', (e) => this.showSortMenu(e));
        controlsGroup.appendChild(this.sortButton);

        // 刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = '刷新';
        refreshBtn.addEventListener('click', () => this.loadTasks());
        controlsGroup.appendChild(refreshBtn);

        toolbar.appendChild(controlsGroup);

        // 创建看板容器
        const kanbanContainer = document.createElement('div');
        kanbanContainer.className = 'project-kanban-container';
        this.container.appendChild(kanbanContainer);

        // 创建三个列
        this.createKanbanColumn(kanbanContainer, 'todo', '待办', '#6c757d');
        this.createKanbanColumn(kanbanContainer, 'doing', '进行中', '#007bff');
        this.createKanbanColumn(kanbanContainer, 'done', '已完成', '#28a745');

        // 添加自定义样式
        this.addCustomStyles();

        // 更新排序按钮标题
        this.updateSortButtonTitle();
        this.updateDoneSortButtonTitle();
    }

    private createKanbanColumn(container: HTMLElement, status: string, title: string, color: string) {
        const column = document.createElement('div');
        column.className = `kanban-column kanban-column-${status}`;
        column.dataset.status = status;

        // 列标题
        const header = document.createElement('div');
        header.className = 'kanban-column-header';
        header.style.cssText = `
            padding: 12px 16px;
            border-bottom: 1px solid var(--b3-theme-border);
            background: ${color}15;
            border-radius: 8px 8px 0 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
        `;

        const titleContainer = document.createElement('div');
        titleContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        const titleEl = document.createElement('h3');
        titleEl.textContent = title;
        titleEl.style.cssText = `
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: ${color};
        `;
        titleContainer.appendChild(titleEl);

        if (status === 'done') {
            this.doneSortButton = document.createElement('button');
            this.doneSortButton.className = 'b3-button b3-button--text';
            this.doneSortButton.innerHTML = '<svg style="width: 14px; height: 14px;"><use xlink:href="#iconSort"></use></svg>';
            this.doneSortButton.title = '排序';
            this.doneSortButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showDoneSortMenu(e);
            });
            titleContainer.appendChild(this.doneSortButton);
        }

        const countEl = document.createElement('span');
        countEl.className = 'kanban-column-count';
        countEl.style.cssText = `
            background: ${color};
            color: white;
            border-radius: 12px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 500;
            min-width: 20px;
            text-align: center;
        `;

        header.appendChild(titleContainer);
        header.appendChild(countEl);

        // 列内容
        const content = document.createElement('div');
        content.className = 'kanban-column-content';
        content.style.cssText = `
            flex: 1;
            padding: 8px;
            overflow-y: auto;
            min-height: 200px;
        `;

        // 添加拖拽事件
        this.addDropZoneEvents(content, status);

        column.appendChild(header);
        column.appendChild(content);
        container.appendChild(column);
    }

    private addDropZoneEvents(element: HTMLElement, status: string) {
        element.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedTask && this.draggedTask.status !== status) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                element.classList.add('kanban-drop-zone-active');
            }
        });

        element.addEventListener('dragleave', (e) => {
            if (!element.contains(e.relatedTarget as Node)) {
                element.classList.remove('kanban-drop-zone-active');
            }
        });

        element.addEventListener('drop', (e) => {
            if (this.isDragging && this.draggedTask) {
                e.preventDefault();
                element.classList.remove('kanban-drop-zone-active');
                this.changeTaskStatus(this.draggedTask, status);
            }
        });
    }

    private async loadTasks() {
        if (this.isLoading) {
            console.log('任务正在加载中，跳过本次加载请求');
            return;
        }

        this.isLoading = true;
        try {
            const reminderData = await readReminderData();
            const projectTasks = Object.values(reminderData).filter((reminder: any) => reminder && reminder.projectId === this.projectId);
            const taskMap = new Map(projectTasks.map((t: any) => [t.id, { ...t }]));

            const getRootStatus = (task: any): string => {
                let current = task;
                while (current.parentId && taskMap.has(current.parentId)) {
                    current = taskMap.get(current.parentId);
                }
                return this.getTaskStatus(current);
            };

            this.tasks = projectTasks.map((reminder: any) => {
                let status;
                if (reminder.parentId && taskMap.has(reminder.parentId)) {
                    // For ALL subtasks, their column is determined by their root parent's status
                    status = getRootStatus(reminder);
                } else {
                    // For top-level tasks, use their own status
                    status = this.getTaskStatus(reminder);
                }
                return {
                    ...reminder,
                    status: status
                };
            });

            this.sortTasks();

            console.log('任务加载完成');
            console.log('任务排序方式:', this.currentSort, this.currentSortOrder);

            this.renderKanban();
        } catch (error) {
            console.error('加载任务失败:', error);
            showMessage("加载任务失败");
        } finally {
            this.isLoading = false;
        }
    }

    private getTaskStatus(task: any): string {
        if (task.completed) return 'done';
        if (task.kanbanStatus === 'doing') return 'doing';
        return 'todo';
    }

    private updateSortButtonTitle() {
        if (this.sortButton) {
            const sortNames = {
                'time': '时间',
                'priority': '优先级',
                'title': '标题'
            };
            const orderNames = {
                'asc': '升序',
                'desc': '降序'
            };
            this.sortButton.title = `排序: ${sortNames[this.currentSort]} (${orderNames[this.currentSortOrder]})`;
        }
    }

    private updateDoneSortButtonTitle() {
        if (this.doneSortButton) {
            const sortNames = {
                'completedTime': '完成时间',
                'title': '标题',
                'priority': '优先级',
                'time': '设定时间'
            };
            const orderNames = {
                'asc': '升序',
                'desc': '降序'
            };
            this.doneSortButton.title = `排序: ${sortNames[this.doneSort] || '完成时间'} (${orderNames[this.doneSortOrder] || '降序'})`;
        }
    }

    private sortTasks() {
        this.tasks.sort((a, b) => {
            let result = 0;

            switch (this.currentSort) {
                case 'priority':
                    result = this.compareByPriority(a, b);
                    break;
                case 'time':
                    result = this.compareByTime(a, b);
                    break;
                case 'title':
                    result = this.compareByTitle(a, b);
                    break;
                default:
                    result = this.compareByPriority(a, b);
            }

            // 优先级排序的结果相反
            if (this.currentSort === 'priority') {
                result = -result;
            }

            return this.currentSortOrder === 'desc' ? -result : result;
        });
    }

    private compareByPriority(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;

        // 1. 按优先级排序
        const priorityDiff = priorityB - priorityA; // 高优先级在前
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        // 2. 同优先级内按手动排序
        const sortA = a.sort || 0;
        const sortB = b.sort || 0;

        if (sortA !== sortB) {
            return sortA - sortB; // 手动排序值小的在前
        }

        // 3. 如果手动排序值也相同，按创建时间排序
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
    }

    private compareByTime(a: any, b: any): number {
        const dateA = a.date || '9999-12-31';
        const dateB = b.date || '9999-12-31';
        const timeA = a.time || '00:00';
        const timeB = b.time || '00:00';

        const datetimeA = `${dateA}T${timeA}`;
        const datetimeB = `${dateB}T${timeB}`;

        const timeCompare = datetimeA.localeCompare(datetimeB);
        if (timeCompare !== 0) {
            return timeCompare;
        }
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
    }

    private compareByTitle(a: any, b: any): number {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        const titleCompare = titleA.localeCompare(titleB, 'zh-CN');
        if (titleCompare !== 0) {
            return titleCompare;
        }
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
    }

    private compareByCompletedTime(a: any, b: any): number {
        const timeA = a.completedTime ? new Date(a.completedTime).getTime() : 0;
        const timeB = b.completedTime ? new Date(b.completedTime).getTime() : 0;
        if (timeA === timeB) {
            return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
        }
        return timeA - timeB;
    }

    private sortDoneTasks(tasks: any[]): any[] {
        const sortedTasks = [...tasks];
        sortedTasks.sort((a, b) => {
            let result = 0;
            switch (this.doneSort) {
                case 'completedTime':
                    result = this.compareByCompletedTime(a, b);
                    break;
                case 'title':
                    result = this.compareByTitle(a, b);
                    break;
                case 'priority':
                    result = this.compareByPriority(a, b);
                    break;
                case 'time':
                    result = this.compareByTime(a, b);
                    break;
                default:
                    result = this.compareByCompletedTime(a, b);
            }

            if (this.doneSort === 'priority') {
                result = -result;
            }

            return this.doneSortOrder === 'desc' ? -result : result;
        });
        return sortedTasks;
    }

    private renderKanban() {
        const todoTasks = this.tasks.filter(task => task.status === 'todo');
        const doingTasks = this.tasks.filter(task => task.status === 'doing');
        const doneTasks = this.tasks.filter(task => task.status === 'done');

        this.renderColumn('todo', todoTasks);
        this.renderColumn('doing', doingTasks);

        if (this.showDone) {
            const sortedDoneTasks = this.sortDoneTasks(doneTasks);
            this.renderColumn('done', sortedDoneTasks);
            this.showColumn('done');
        } else {
            this.hideColumn('done');
        }
    }

    private renderColumn(status: string, tasks: any[]) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (!column) return;

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const count = column.querySelector('.kanban-column-count') as HTMLElement;

        content.innerHTML = '';
        count.textContent = tasks.length.toString();

        const taskMap = new Map(tasks.map(t => [t.id, t]));
        const topLevelTasks = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
        const childTasks = tasks.filter(t => t.parentId && taskMap.has(t.parentId));

        const renderTaskWithChildren = (task: any, level: number) => {
            const taskEl = this.createTaskElement(task, level);
            content.appendChild(taskEl);

            const children = childTasks.filter(t => t.parentId === task.id);
            const isCollapsed = this.collapsedTasks.has(task.id);

            if (children.length > 0 && !isCollapsed) {
                children.forEach(child => renderTaskWithChildren(child, level + 1));
            }
        };

        topLevelTasks.forEach(task => renderTaskWithChildren(task, 0));
    }

    private showColumn(status: string) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (column) {
            column.style.display = 'flex';
        }
    }

    private hideColumn(status: string) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (column) {
            column.style.display = 'none';
        }
    }

    private createTaskElement(task: any, level: number = 0): HTMLElement {
        const taskEl = document.createElement('div');
        taskEl.className = 'kanban-task';
        if (level > 0) {
            taskEl.classList.add('is-subtask');
        }
        taskEl.draggable = true;
        taskEl.dataset.taskId = task.id;

        const priority = task.priority || 'none';

        // 存储任务数据到元素
        taskEl.dataset.priority = priority;

        // 添加优先级样式类
        if (priority !== 'none') {
            taskEl.classList.add(`kanban-task-priority-${priority}`);
        }

        taskEl.style.cssText = `
            cursor: grab;
            transition: all 0.2s ease;
            position: relative;
        `;

        if (task.completed) {
            taskEl.style.opacity = '0.5';
        }

        if (level > 0) {
            taskEl.style.marginLeft = `${level * 20}px`;
        }

        const taskMainContainer = document.createElement('div');
        taskMainContainer.className = 'kanban-task-main';
        taskMainContainer.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: flex-start;
        `;

        const taskIndentContainer = document.createElement('div');
        taskIndentContainer.className = 'kanban-task-indent';
        taskIndentContainer.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 0px; /* 固定宽度以便对齐 */
            flex-shrink: 0;
        `;

        // 折叠按钮
        const childTasks = this.tasks.filter(t => t.parentId === task.id);
        if (childTasks.length > 0) {
            const isCollapsed = this.collapsedTasks.has(task.id);
            const collapseBtn = document.createElement('button');
            collapseBtn.className = 'b3-button b3-button--text kanban-task-collapse-btn';
            collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
            collapseBtn.title = isCollapsed ? '展开子任务' : '折叠子任务';
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isCollapsed) {
                    this.collapsedTasks.delete(task.id);
                } else {
                    this.collapsedTasks.add(task.id);
                }
                this.renderKanban();
            });
            taskIndentContainer.appendChild(collapseBtn);
        }

        taskMainContainer.appendChild(taskIndentContainer);

        // 复选框
        const checkboxEl = document.createElement('input');
        checkboxEl.type = 'checkbox';
        checkboxEl.className = 'kanban-task-checkbox';
        checkboxEl.checked = task.completed;
        checkboxEl.title = '点击完成/取消完成任务';
        checkboxEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const newStatus = checkboxEl.checked ? 'done' : 'todo';
            this.changeTaskStatus(task, newStatus);
        });
        taskMainContainer.appendChild(checkboxEl);

        const taskContentContainer = document.createElement('div');
        taskContentContainer.className = 'kanban-task-content';
        taskContentContainer.style.flex = '1';

        // 任务标题
        const titleEl = document.createElement('div');
        titleEl.className = 'kanban-task-title';

        if (task.blockId) {
            // 如果有绑定块，标题显示为可点击的超链接
            titleEl.setAttribute('data-type', 'a');
            titleEl.setAttribute('data-href', `siyuan://blocks/${task.blockId}`);
            titleEl.style.cssText = `
                font-weight: 500;
                margin-bottom: 8px;
                color: var(--b3-theme-primary);
                line-height: 1.4;
                cursor: pointer;
                text-decoration: underline;
                text-decoration-style: dotted;
                transition: color 0.2s ease;
                width: fit-content;
            `;

            // 点击事件：打开块
            titleEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openBlockTab(task.blockId);
            });

            // 鼠标悬停效果
            titleEl.addEventListener('mouseenter', () => {
                titleEl.style.color = 'var(--b3-theme-primary-light)';
            });
            titleEl.addEventListener('mouseleave', () => {
                titleEl.style.color = 'var(--b3-theme-primary)';
            });
        } else {
            // 没有绑定块，普通标题样式
            titleEl.style.cssText = `
                font-weight: 500;
                margin-bottom: 8px;
                color: var(--b3-theme-on-surface);
                line-height: 1.4;
                width: fit-content;
            `;
        }

        titleEl.textContent = task.title || '未命名任务';
        titleEl.title = task.blockId ? `点击打开绑定块: ${task.title || '未命名任务'}` : (task.title || '未命名任务');

        // 如果有子任务，添加数量指示器
        if (childTasks.length > 0) {
            const subtaskIndicator = document.createElement('span');
            subtaskIndicator.className = 'subtask-indicator';
            subtaskIndicator.textContent = ` (${childTasks.length})`;
            subtaskIndicator.title = `包含 ${childTasks.length} 个子任务`;
            subtaskIndicator.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
            `;
            titleEl.appendChild(subtaskIndicator);
        }

        taskContentContainer.appendChild(titleEl);

        // 任务信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'kanban-task-info';
        infoEl.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        if (task.completed && task.completedTime) {
            const completedTimeEl = document.createElement('div');
            completedTimeEl.className = 'kanban-task-completed-time';
            completedTimeEl.innerHTML = `<span>✅</span><span>完成于: ${getLocalDateTimeString(new Date(task.completedTime))}</span>`;
            completedTimeEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
            `;
            infoEl.appendChild(completedTimeEl);
        }

        // 日期时间
        const hasDate = task.date || task.endDate;
        if (hasDate) {
            const dateEl = document.createElement('div');
            dateEl.className = 'kanban-task-date';
            dateEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
                flex-wrap: wrap;
            `;

            const dateText = this.formatTaskDate(task);
            let dateHtml = `<span>📅</span><span>${dateText}</span>`;
            
            // 添加倒计时显示
            if (!task.completed) {
                const countdownInfo = this.getTaskCountdownInfo(task);
                if (countdownInfo.type !== 'none' && countdownInfo.days >= 0) {
                    let urgencyClass = 'countdown-normal';
                    if (countdownInfo.days <= 1) {
                        urgencyClass = 'countdown-urgent';
                    } else if (countdownInfo.days <= 3) {
                        urgencyClass = 'countdown-warning';
                    }
                    
                    const prefix = countdownInfo.type === 'start' ? '剩' : '';
                    dateHtml += `<span class="countdown-badge ${urgencyClass}">${prefix}${countdownInfo.text}</span>`;
                }
            }
            
            dateEl.innerHTML = dateHtml;
            infoEl.appendChild(dateEl);
        }

        // 优先级
        if (priority !== 'none') {
            const priorityEl = document.createElement('div');
            priorityEl.className = `kanban-task-priority priority-label-${priority}`;

            const priorityNames = {
                'high': '高优先级',
                'medium': '中优先级',
                'low': '低优先级'
            };

            priorityEl.innerHTML = `<span class="priority-dot ${priority}"></span><span>${priorityNames[priority]}</span>`;
            infoEl.appendChild(priorityEl);
        }

        // 分类
        if (task.categoryId) {
            const category = this.categoryManager.getCategoryById(task.categoryId);
            if (category) {
                const categoryEl = document.createElement('div');
                categoryEl.className = 'kanban-task-category';
                categoryEl.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 2px 6px;
                    background-color: ${category.color};
                    border-radius: 4px;
                    font-size: 11px;
                    color: white;
                    font-weight: 500;
                    align-self: flex-start;
                `;

                if (category.icon) {
                    categoryEl.innerHTML = `<span>${category.icon}</span><span>${category.name}</span>`;
                } else {
                    categoryEl.textContent = category.name;
                }
                infoEl.appendChild(categoryEl);
            }
        }

        // 备注
        if (task.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'kanban-task-note';
            noteEl.textContent = task.note;
            noteEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.8;
                margin-top: 4px;
                line-height: 1.3;
                max-height: 40px;
                overflow: hidden;
                text-overflow: ellipsis;
            `;
            infoEl.appendChild(noteEl);
        }

        // 番茄钟数量
        if (task.pomodoroCount && task.pomodoroCount > 0) {
            const pomodoroDisplay = document.createElement('div');
            pomodoroDisplay.className = 'kanban-task-pomodoro-count';
            pomodoroDisplay.style.cssText = `
                font-size: 12px;
                display: inline-flex;
                align-items: center;
                gap: 2px;
                margin-top: 4px;
            `;

            const tomatoEmojis = '🍅'.repeat(Math.min(task.pomodoroCount, 5));
            const extraCount = task.pomodoroCount > 5 ? `+${task.pomodoroCount - 5}` : '';

            pomodoroDisplay.innerHTML = `
                <span title="完成的番茄钟数量: ${task.pomodoroCount}">${tomatoEmojis}${extraCount}</span>
            `;

            infoEl.appendChild(pomodoroDisplay);
        }

        taskContentContainer.appendChild(infoEl);
        taskMainContainer.appendChild(taskContentContainer);

        // 不再单独显示绑定块信息，因为已经集成到标题中

        taskEl.appendChild(taskMainContainer);

        // 添加拖拽事件（状态切换）
        this.addTaskDragEvents(taskEl, task);

        // 如果是优先级排序，则添加同级拖拽排序功能
        if (this.currentSort === 'priority') {
            taskEl.addEventListener('dragover', (e) => {
                if (this.isDragging && this.draggedElement && this.draggedElement !== taskEl) {
                    const targetTask = this.getTaskFromElement(taskEl);
                    if (targetTask && this.canDropForSort(this.draggedTask, targetTask)) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        this.showDropIndicator(taskEl, e);
                    }
                }
            });

            taskEl.addEventListener('dragleave', () => {
                this.hideDropIndicator();
            });

            taskEl.addEventListener('drop', (e) => {
                if (this.isDragging && this.draggedElement && this.draggedElement !== taskEl) {
                    e.preventDefault();
                    e.stopPropagation(); // 阻止事件冒泡到列的 drop 区域
                    const targetTask = this.getTaskFromElement(taskEl);
                    if (targetTask && this.canDropForSort(this.draggedTask, targetTask)) {
                        this.handleSortDrop(targetTask, e);
                    }
                }
                this.hideDropIndicator();
            });
        }

        // 添加右键菜单
        taskEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showTaskContextMenu(e, task);
        });

        // 添加悬停效果
        taskEl.addEventListener('mouseenter', () => {
            taskEl.style.transform = 'translateY(-2px)';
            taskEl.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
        });

        taskEl.addEventListener('mouseleave', () => {
            if (!this.isDragging) {
                taskEl.style.transform = 'translateY(0)';
                taskEl.style.boxShadow = 'none';
            }
        });

        return taskEl;
    }

    private formatTaskDate(task: any): string {
        const today = getLocalDateString();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = getLocalDateString(tomorrow);

        // 如果只有截止时间，显示截止时间
        if (!task.date && task.endDate) {
            const endDate = new Date(task.endDate);
            if (task.endDate === today) {
                return '今天截止';
            } else if (task.endDate === tomorrowStr) {
                return '明天截止';
            } else {
                return endDate.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' 截止';
            }
        }

        // 如果有开始时间，按原逻辑显示
        let dateStr = '';
        if (task.date === today) {
            dateStr = '今天';
        } else if (task.date === tomorrowStr) {
            dateStr = '明天';
        } else {
            const taskDate = new Date(task.date);
            dateStr = taskDate.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        }

        let endDateStr = '';
        if (task.endDate && task.endDate !== task.date) {
            const taskEndDate = new Date(task.endDate);
            endDateStr = taskEndDate.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        }

        if (endDateStr) {
            return `${dateStr} → ${endDateStr}`;
        }

        if (task.time) {
            return `${dateStr} ${task.time}`;
        }

        return dateStr || "未设置日期";
    }

    private getDaysUntilDate(targetDate: string): number {
        if (!targetDate) return 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const target = new Date(targetDate);
        target.setHours(0, 0, 0, 0);
        const diffTime = target.getTime() - today.getTime();
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    private getTaskCountdownInfo(task: any): { text: string; days: number; type: 'start' | 'end' | 'none' } {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 如果有开始日期
        if (task.date) {
            const startDate = new Date(task.date);
            startDate.setHours(0, 0, 0, 0);
            const startDays = Math.ceil((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            // 如果还没开始
            if (startDays > 0) {
                return {
                    text: startDays === 1 ? '明天开始' : `${startDays}天后开始`,
                    days: startDays,
                    type: 'start'
                };
            }

            // 如果已经开始且有结束日期
            if (task.endDate) {
                const endDate = new Date(task.endDate);
                endDate.setHours(0, 0, 0, 0);
                const endDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                if (endDays >= 0) {
                    return {
                        text: endDays === 0 ? '今天截止' : `${endDays}天截止`,
                        days: endDays,
                        type: 'end'
                    };
                }
            }
        }
        // 只有结束日期的情况
        else if (task.endDate) {
            const endDate = new Date(task.endDate);
            endDate.setHours(0, 0, 0, 0);
            const endDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            if (endDays >= 0) {
                return {
                    text: endDays === 0 ? '今天截止' : `${endDays}天截止`,
                    days: endDays,
                    type: 'end'
                };
            }
        }

        return { text: '', days: 0, type: 'none' };
    }

    private addTaskDragEvents(element: HTMLElement, task: any) {
        element.addEventListener('dragstart', (e) => {
            this.isDragging = true;
            this.draggedTask = task;
            this.draggedElement = element;
            element.style.opacity = '0.5';
            element.style.cursor = 'grabbing';

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', element.outerHTML);
            }
        });

        element.addEventListener('dragend', () => {
            this.isDragging = false;
            this.draggedTask = null;
            this.draggedElement = null;
            element.style.opacity = '';
            element.style.cursor = 'grab';
            element.style.transform = 'translateY(0)';
            element.style.boxShadow = 'none';

            // 清理所有拖拽状态
            this.container.querySelectorAll('.kanban-drop-zone-active').forEach(el => {
                el.classList.remove('kanban-drop-zone-active');
            });
            this.hideDropIndicator();
        });
    }

    private showTaskContextMenu(event: MouseEvent, task: any) {
        const menu = new Menu("kanbanTaskContextMenu");

        // 编辑任务
        menu.addItem({
            iconHTML: "📝",
            label: "编辑任务",
            click: () => this.editTask(task)
        });

        menu.addItem({
            iconHTML: "➕",
            label: "创建子任务",
            click: () => this.showCreateTaskDialog(task)
        });

        menu.addSeparator();

        // 设置优先级子菜单
        const priorityMenuItems = [];
        const priorities = [
            { key: 'high', label: '高优先级', icon: '🔴' },
            { key: 'medium', label: '中优先级', icon: '🟡' },
            { key: 'low', label: '低优先级', icon: '🔵' },
            { key: 'none', label: '无优先级', icon: '⚫' }
        ];

        const currentPriority = task.priority || 'none';
        priorities.forEach(priority => {
            priorityMenuItems.push({
                iconHTML: priority.icon,
                label: priority.label,
                current: currentPriority === priority.key,
                click: () => this.setPriority(task.id, priority.key)
            });
        });

        menu.addItem({
            iconHTML: "🎯",
            label: "设置优先级",
            submenu: priorityMenuItems
        });

        // 绑定块功能
        if (task.blockId) {
            menu.addItem({
                iconHTML: "📋",
                label: "复制块引用",
                click: () => this.copyBlockRef(task)
            });
        } else {
            menu.addItem({
                iconHTML: "🔗",
                label: "绑定到块",
                click: () => this.showBindToBlockDialog(task)
            });
        }

        menu.addSeparator();

        // 状态切换
        const currentStatus = this.getTaskStatus(task);

        if (currentStatus !== 'todo') {
            menu.addItem({
                iconHTML: "📋",
                label: "移动到待办",
                click: () => this.changeTaskStatus(task, 'todo')
            });
        }

        if (currentStatus !== 'doing') {
            menu.addItem({
                iconHTML: "⚡",
                label: "移动到进行中",
                click: () => this.changeTaskStatus(task, 'doing')
            });
        }

        if (currentStatus !== 'done') {
            menu.addItem({
                iconHTML: "✅",
                label: "标记为完成",
                click: () => this.changeTaskStatus(task, 'done')
            });
        }

        menu.addSeparator();

        // 番茄钟
        menu.addItem({
            iconHTML: "🍅",
            label: "开始番茄钟",
            click: () => this.startPomodoro(task)
        });

        menu.addItem({
            iconHTML: "⏱️",
            label: "开始正计时",
            click: () => this.startPomodoroCountUp(task)
        });

        menu.addSeparator();

        // 删除任务
        menu.addItem({
            iconHTML: "🗑️",
            label: "删除任务",
            click: () => this.deleteTask(task)
        });

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async changeTaskStatus(task: any, newStatus: string) {
        try {
            const reminderData = await readReminderData();

            if (reminderData[task.id]) {
                // 更新任务状态
                if (newStatus === 'done') {
                    reminderData[task.id].completed = true;
                    reminderData[task.id].completedTime = getLocalDateTimeString(new Date());
                } else {
                    reminderData[task.id].completed = false;
                    delete reminderData[task.id].completedTime;
                    reminderData[task.id].kanbanStatus = newStatus;
                }

                await writeReminderData(reminderData);

                // 更新块的书签状态
                if (task.blockId) {
                    await updateBlockReminderBookmark(task.blockId);
                }

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                // 重新加载任务
                await this.loadTasks();
            }
        } catch (error) {
            console.error('切换任务状态失败:', error);
            showMessage("状态切换失败");
        }
    }

    private showSortMenu(event: MouseEvent) {
        if (document.querySelector('.kanban-sort-menu')) {
            return;
        }

        const menuEl = document.createElement('div');
        menuEl.className = 'kanban-sort-menu';
        menuEl.style.cssText = `
            position: absolute;
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            padding: 8px;
            z-index: 100;
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        const sortOptions = [
            { key: 'priority', label: '优先级', icon: '🎯' },
            { key: 'time', label: '时间', icon: '🕐' },
            { key: 'title', label: '标题', icon: '📝' }
        ];

        const createOption = (option: any, order: 'asc' | 'desc') => {
            const button = document.createElement('button');
            button.className = 'b3-button b3-button--outline';
            const isActive = this.currentSort === option.key && this.currentSortOrder === order;
            button.style.cssText = `
                width: 100%;
                justify-content: flex-start;
                text-align: left;
                background-color: ${isActive ? 'var(--b3-theme-primary-lightest)' : 'transparent'};
                color: ${isActive ? 'var(--b3-theme-primary)' : 'var(--b3-theme-on-surface)'};
            `;
            button.innerHTML = `
                <span style="font-size: 16px; margin-right: 8px;">${option.icon}</span>
                <span>${option.label} (${order === 'asc' ? '升序' : '降序'})</span>
            `;
            button.addEventListener('click', () => {
                this.currentSort = option.key;
                this.currentSortOrder = order;
                this.updateSortButtonTitle();
                this.sortTasks();
                this.renderKanban();
                closeMenu();
            });
            return button;
        };

        sortOptions.forEach(option => {
            menuEl.appendChild(createOption(option, 'desc'));
            menuEl.appendChild(createOption(option, 'asc'));
        });

        document.body.appendChild(menuEl);

        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        menuEl.style.top = `${rect.bottom + 4}px`;
        menuEl.style.left = `${rect.right - menuEl.offsetWidth}px`;

        const closeMenu = () => {
            menuEl.remove();
            document.removeEventListener('click', handleClickOutside);
        };

        const handleClickOutside = (e: MouseEvent) => {
            if (!menuEl.contains(e.target as Node) && e.target !== event.currentTarget) {
                closeMenu();
            }
        };

        setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    }

    private showDoneSortMenu(event: MouseEvent) {
        const menu = new Menu("kanbanDoneSortMenu");

        const addMenuItem = (label: string, sortKey: string, sortOrder: 'asc' | 'desc') => {
            menu.addItem({
                label: label,
                current: this.doneSort === sortKey && this.doneSortOrder === sortOrder,
                click: () => {
                    this.doneSort = sortKey;
                    this.doneSortOrder = sortOrder;
                    this.updateDoneSortButtonTitle();
                    this.renderKanban();
                }
            });
        };

        addMenuItem('完成时间 (降序)', 'completedTime', 'desc');
        addMenuItem('完成时间 (升序)', 'completedTime', 'asc');
        menu.addSeparator();
        addMenuItem('优先级 (高到低)', 'priority', 'desc');
        addMenuItem('优先级 (低到高)', 'priority', 'asc');
        menu.addSeparator();
        addMenuItem('设定时间 (降序)', 'time', 'desc');
        addMenuItem('设定时间 (升序)', 'time', 'asc');
        menu.addSeparator();
        addMenuItem('标题 (升序)', 'title', 'asc');
        addMenuItem('标题 (降序)', 'title', 'desc');

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private showCreateTaskDialog(parentTask?: any) {
        const dialog = new Dialog({
            title: parentTask ? `为 "${parentTask.title}" 创建子任务` : "新建任务",
            content: `
                <div class="reminder-dialog" style="padding-bottom: 0;">
                    <div class="b3-dialog__content" style="padding-bottom: 0;">
                        <div class="b3-form__group">
                            <label class="b3-form__label">任务标题</label>
                            <input type="text" id="taskTitle" class="b3-text-field" placeholder="请输入任务标题" required>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">分类
                                <button type="button" id="manageCategoriesBtn" class="b3-button b3-button--outline" title="管理分类" style="margin-left: 8px; vertical-align: middle;">
                                    <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
                                </button>
                            </label>
                            <div class="category-selector" id="categorySelector" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;"></div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">优先级</label>
                            <div class="priority-selector" id="prioritySelector">
                                <div class="priority-option" data-priority="high"><div class="priority-dot high"></div><span>高</span></div>
                                <div class="priority-option" data-priority="medium"><div class="priority-dot medium"></div><span>中</span></div>
                                <div class="priority-option" data-priority="low"><div class="priority-dot low"></div><span>低</span></div>
                                <div class="priority-option selected" data-priority="none"><div class="priority-dot none"></div><span>无</span></div>
                            </div>
                        </div>
                         <div class="b3-form__group">
                            <label class="b3-form__label">任务日期</label>
                            <div class="reminder-date-container">
                                <input type="date" id="taskStartDate" class="b3-text-field" title="开始日期">
                                <span class="reminder-arrow">→</span>
                                <input type="date" id="taskEndDate" class="b3-text-field" title="结束日期">
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">绑定块 (可选)</label>
                            <div class="b3-form__desc">输入块ID将任务绑定到指定块</div>
                            <input type="text" id="taskBlockId" class="b3-text-field" placeholder="请输入块ID (可选)" style="width: 100%; margin-top: 8px;">
                            <div id="blockPreview" class="block-content-preview" style="
                                display: none;
                                padding: 8px;
                                background-color: var(--b3-theme-surface-lighter);
                                border-radius: 4px;
                                border: 1px solid var(--b3-theme-border);
                                max-height: 60px;
                                overflow-y: auto;
                                font-size: 12px;
                                color: var(--b3-theme-on-surface);
                                margin-top: 8px;
                            "></div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">备注</label>
                            <textarea id="taskNote" class="b3-text-field" placeholder="请输入任务备注" rows="2" style="width: 100%;resize: vertical; min-height: 60px;"></textarea>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="createBtn">创建</button>
                    </div>
                </div>`,
            width: "500px",
            height: "650px"
        });

        const titleInput = dialog.element.querySelector('#taskTitle') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#taskNote') as HTMLTextAreaElement;
        const startDateInput = dialog.element.querySelector('#taskStartDate') as HTMLInputElement;
        const endDateInput = dialog.element.querySelector('#taskEndDate') as HTMLInputElement;
        const prioritySelector = dialog.element.querySelector('#prioritySelector') as HTMLElement;
        const categorySelector = dialog.element.querySelector('#categorySelector') as HTMLElement;
        const manageCategoriesBtn = dialog.element.querySelector('#manageCategoriesBtn') as HTMLButtonElement;
        const blockIdInput = dialog.element.querySelector('#taskBlockId') as HTMLInputElement;
        const blockPreview = dialog.element.querySelector('#blockPreview') as HTMLElement;
        const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const createBtn = dialog.element.querySelector('#createBtn') as HTMLButtonElement;

        // 渲染并绑定分类选择器
        this.renderCategorySelector(categorySelector, this.project.categoryId);

        // 绑定优先级选择事件
        prioritySelector.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.priority-option') as HTMLElement;
            if (option) {
                prioritySelector.querySelectorAll('.priority-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 管理分类按钮事件
        manageCategoriesBtn.addEventListener('click', () => {
            new CategoryManageDialog(() => {
                this.renderCategorySelector(categorySelector, this.project.categoryId);
            }).show();
        });

        // 监听块ID输入变化
        blockIdInput.addEventListener('input', async () => {
            const blockId = blockIdInput.value.trim();
            if (blockId.length >= 20) { // 块ID通常是20位字符
                try {
                    const block = await getBlockByID(blockId);
                    if (block) {
                        const blockContent = block.content || block.fcontent || '未命名块';
                        blockPreview.textContent = `预览: ${blockContent}`;
                        blockPreview.style.display = 'block';
                    } else {
                        blockPreview.style.display = 'none';
                    }
                } catch (error) {
                    blockPreview.style.display = 'none';
                }
            } else {
                blockPreview.style.display = 'none';
            }
        });

        cancelBtn.addEventListener('click', () => dialog.destroy());

        // 如果是创建子任务，预填父任务信息
        if (parentTask) {
            // 预选分类
            const categoryOption = categorySelector.querySelector(`.category-option[data-category="${parentTask.categoryId || ''}"]`) as HTMLElement;
            if (categoryOption) {
                categorySelector.querySelectorAll('.category-option').forEach(opt => opt.classList.remove('selected'));
                categoryOption.classList.add('selected');
            }

            // 预选优先级
            const priorityOption = prioritySelector.querySelector(`.priority-option[data-priority="${parentTask.priority || 'none'}"]`) as HTMLElement;
            if (priorityOption) {
                prioritySelector.querySelectorAll('.priority-option').forEach(opt => opt.classList.remove('selected'));
                priorityOption.classList.add('selected');
            }
        }

        createBtn.addEventListener('click', async () => {
            const title = titleInput.value.trim();
            if (!title) {
                showMessage("请输入任务标题");
                return;
            }

            const selectedPriority = prioritySelector.querySelector('.priority-option.selected') as HTMLElement;
            const priority = selectedPriority?.getAttribute('data-priority') || 'none';

            const selectedCategory = categorySelector.querySelector('.category-option.selected') as HTMLElement;
            const categoryId = selectedCategory?.getAttribute('data-category') || undefined;

            const blockId = blockIdInput.value.trim() || undefined;

            await this.createTask({
                title: title,
                note: noteInput.value.trim(),
                date: startDateInput.value,
                endDate: endDateInput.value,
                priority: priority,
                categoryId: categoryId,
                blockId: blockId
            }, parentTask);

            dialog.destroy();
        });

    }

    private async createTask(taskData: any, parentTask?: any) {
        const reminderData = await readReminderData();
        const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        const newTask: any = {
            id: taskId,
            title: taskData.title,
            note: taskData.note || '',
            date: taskData.date || undefined,
            endDate: taskData.endDate || undefined,
            priority: taskData.priority || 'none',
            categoryId: taskData.categoryId,
            projectId: this.projectId,
            completed: false,
            kanbanStatus: 'todo',
            createdTime: new Date().toISOString(),
        };

        // 如果是子任务，添加 parentId
        if (parentTask) {
            newTask.parentId = parentTask.id;
            // 子任务继承父任务的状态
            if (parentTask.status === 'doing') {
                newTask.kanbanStatus = 'doing';
            }
        }

        // 如果提供了块ID，添加绑定信息
        if (taskData.blockId) {
            try {
                const block = await getBlockByID(taskData.blockId);
                if (block) {
                    newTask.blockId = taskData.blockId;
                    newTask.docId = block.root_id || taskData.blockId;

                    // 更新块的书签状态
                    await updateBlockReminderBookmark(taskData.blockId);
                }
            } catch (error) {
                console.error('绑定块失败:', error);
                showMessage("警告：块绑定失败，但任务已创建");
            }
        }

        reminderData[taskId] = newTask;
        await writeReminderData(reminderData);

        showMessage("任务创建成功");
        await this.loadTasks();
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    }

    private async editTask(task: any) {
        const editDialog = new ReminderEditDialog(task, async () => {
            await this.loadTasks();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        });
        editDialog.show();
    }

    private showPasteTaskDialog() {
        const dialog = new Dialog({
            title: "粘贴列表新建任务",
            content: `
                <div class="b3-dialog__content">
                    <p class="b3-typography">粘贴Markdown列表或多行文本，每行将创建一个任务。</p>
                    <p class="b3-typography" style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 4px;">
                        支持语法：<code>@priority=high&startDate=2025-08-12&endDate=2025-08-30</code>
                    </p>
                    <p class="b3-typography" style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 8px;">
                        支持块链接：<code>[任务标题](siyuan://blocks/块ID)</code> 或 <code>((块ID '任务标题'))</code>
                    </p>
                    <textarea id="taskList" class="b3-text-field"
                        placeholder="示例：
完成项目文档 @priority=high&startDate=2025-08-12&endDate=2025-08-15
准备会议材料 @priority=medium&startDate=2025-08-13
[思源笔记插件开发丨任务笔记管理插件](siyuan://blocks/20250610000808-3vqwuh3)
((20250610000808-3vqwuh3 '思源笔记插件开发丨任务笔记管理插件'))
学习新技术 @priority=low"
                        style="width: 100%; height: 200px; resize: vertical;"></textarea>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                    <button class="b3-button b3-button--primary" id="createBtn">创建任务</button>
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
                showMessage("列表内容不能为空");
                return;
            }

            const lines = text.split('\n').map(line => {
                // 移除Markdown列表标记
                return line.replace(/^-\s*/, '').trim();
            }).filter(line => line.length > 0);

            if (lines.length > 0) {
                await this.batchCreateTasksWithParams(lines);
                dialog.destroy();
                showMessage(`${lines.length} 个任务已创建`);
            }
        });
    }

    private async batchCreateTasksWithParams(lines: string[]) {
        const reminderData = await readReminderData();
        const categoryId = this.project.categoryId; // 继承项目分类

        // 获取当前项目中所有任务的最大排序值
        const maxSort = Object.values(reminderData)
            .filter((r: any) => r && r.projectId === this.projectId && typeof r.sort === 'number')
            .reduce((max: number, task: any) => Math.max(max, task.sort || 0), 0) as number;

        for (const [index, line] of lines.entries()) {
            const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

            // 解析任务参数
            const taskData = this.parseTaskLine(line);

            const newTask: any = {
                id: taskId,
                title: taskData.title,
                note: '',
                priority: taskData.priority || 'none',
                categoryId: categoryId,
                projectId: this.projectId,
                completed: false,
                kanbanStatus: 'todo',
                createdTime: new Date().toISOString(),
                date: taskData.startDate,
                endDate: taskData.endDate,
                sort: maxSort + (index + 1) * 10, // 按顺序分配排序值
            };

            // 如果解析出了块ID，尝试绑定块
            if (taskData.blockId) {
                try {
                    const block = await getBlockByID(taskData.blockId);
                    if (block) {
                        newTask.blockId = taskData.blockId;
                        newTask.docId = block.root_id || taskData.blockId;

                        // 如果任务标题为空或者是默认标题，使用块内容作为标题
                        if (!taskData.title || taskData.title === '未命名任务') {
                            newTask.title = block.content || block.fcontent || '未命名任务';
                        }

                        // 更新块的书签状态
                        await updateBlockReminderBookmark(taskData.blockId);
                    }
                } catch (error) {
                    console.error('绑定块失败:', error);
                    // 绑定失败不影响任务创建，继续创建任务
                }
            }

            reminderData[taskId] = newTask;
        }

        await writeReminderData(reminderData);
        await this.loadTasks();
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    }

    private parseTaskLine(line: string): { title: string; priority?: string; startDate?: string; endDate?: string; blockId?: string } {
        // 查找参数部分 @priority=high&startDate=2025-08-12&endDate=2025-08-30
        const paramMatch = line.match(/@(.+)$/);
        let title = line;
        let priority: string | undefined;
        let startDate: string | undefined;
        let endDate: string | undefined;
        let blockId: string | undefined;

        // 检查是否包含思源块链接或块引用
        blockId = this.extractBlockIdFromText(line);

        // 如果找到了块链接，从标题中移除链接部分
        if (blockId) {
            // 移除 Markdown 链接格式 [标题](siyuan://blocks/blockId)
            title = title.replace(/\[([^\]]+)\]\(siyuan:\/\/blocks\/[^)]+\)/g, '$1');
            // 移除块引用格式 ((blockId '标题'))
            title = title.replace(/\(\([^)]+\s+'([^']+)'\)\)/g, '$1');
            // 移除块引用格式 ((blockId "标题"))
            title = title.replace(/\(\([^)]+\s+"([^"]+)"\)\)/g, '$1');
            // 移除简单块引用格式 ((blockId))
            title = title.replace(/\(\([^)]+\)\)/g, '');
        }

        if (paramMatch) {
            // 移除参数部分，获取纯标题
            title = title.replace(/@(.+)$/, '').trim();

            // 解析参数
            const paramString = paramMatch[1];
            const params = new URLSearchParams(paramString);

            priority = params.get('priority') || undefined;
            startDate = params.get('startDate') || undefined;
            endDate = params.get('endDate') || undefined;

            // 验证优先级值
            if (priority && !['high', 'medium', 'low', 'none'].includes(priority)) {
                priority = 'none';
            }

            // 验证日期格式 (YYYY-MM-DD)
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (startDate && !dateRegex.test(startDate)) {
                startDate = undefined;
            }
            if (endDate && !dateRegex.test(endDate)) {
                endDate = undefined;
            }
        }

        return {
            title: title.trim() || '未命名任务',
            priority,
            startDate,
            endDate,
            blockId
        };
    }

    /**
     * 从文本中提取思源块ID
     * 支持以下格式：
     * 1. Markdown链接：[标题](siyuan://blocks/blockId)
     * 2. 块引用：((blockId '标题')) 或 ((blockId "标题"))
     * 3. 简单块引用：((blockId))
     */
    private extractBlockIdFromText(text: string): string | undefined {
        // 匹配 Markdown 链接格式：[标题](siyuan://blocks/blockId)
        const markdownLinkMatch = text.match(/\[([^\]]+)\]\(siyuan:\/\/blocks\/([^)]+)\)/);
        if (markdownLinkMatch) {
            const blockId = markdownLinkMatch[2];
            // 验证块ID格式（通常是20位字符）
            if (blockId && blockId.length >= 20) {
                return blockId;
            }
        }

        // 匹配块引用格式：((blockId '标题')) 或 ((blockId "标题"))
        const blockRefWithTitleMatch = text.match(/\(\(([^)\s]+)\s+['"]([^'"]+)['"]\)\)/);
        if (blockRefWithTitleMatch) {
            const blockId = blockRefWithTitleMatch[1];
            if (blockId && blockId.length >= 20) {
                return blockId;
            }
        }

        // 匹配简单块引用格式：((blockId))
        const simpleBlockRefMatch = text.match(/\(\(([^)]+)\)\)/);
        if (simpleBlockRefMatch) {
            const blockId = simpleBlockRefMatch[1].trim();
            if (blockId && blockId.length >= 20) {
                return blockId;
            }
        }

        return undefined;
    }

    private async deleteTask(task: any) {
        const childTasks = this.tasks.filter(t => t.parentId === task.id);
        let confirmMessage = `确定要删除任务 "${task.title}" 吗？此操作不可撤销。`;

        if (childTasks.length > 0) {
            confirmMessage += `\n\n此任务包含 ${childTasks.length} 个子任务，它们也将被一并删除。`;
        }

        confirm(
            "删除任务",
            confirmMessage,
            async () => {
                try {
                    const reminderData = await readReminderData();

                    const tasksToDelete = [task.id, ...childTasks.map(t => t.id)];

                    tasksToDelete.forEach(taskId => {
                        if (reminderData[taskId]) {
                            delete reminderData[taskId];
                        }
                    });

                    await writeReminderData(reminderData);

                    // 触发更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));

                    // 重新加载任务
                    await this.loadTasks();

                    showMessage("任务已删除");
                } catch (error) {
                    console.error('删除任务失败:', error);
                    showMessage("删除任务失败");
                }
            }
        );
    }

    private startPomodoro(task: any) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟
        if (ProjectKanbanView.currentPomodoroTimer && ProjectKanbanView.currentPomodoroTimer.isWindowActive()) {
            const currentState = ProjectKanbanView.currentPomodoroTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = task.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新任务："${newTitle}"？`;

            if (currentState.isRunning && !currentState.isPaused) {
                try {
                    ProjectKanbanView.currentPomodoroTimer.pauseFromExternal();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                confirmMessage += `\n\n选择"确定"将继承当前进度继续计时。`;
            }

            confirm(
                "切换番茄钟任务",
                confirmMessage,
                () => {
                    this.performStartPomodoro(task, currentState);
                },
                () => {
                    if (currentState.isRunning && !currentState.isPaused) {
                        try {
                            ProjectKanbanView.currentPomodoroTimer.resumeFromExternal();
                        } catch (error) {
                            console.error('恢复番茄钟运行失败:', error);
                        }
                    }
                }
            );
        } else {
            if (ProjectKanbanView.currentPomodoroTimer && !ProjectKanbanView.currentPomodoroTimer.isWindowActive()) {
                ProjectKanbanView.currentPomodoroTimer = null;
            }
            this.performStartPomodoro(task);
        }
    }

    private startPomodoroCountUp(task: any) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟
        if (ProjectKanbanView.currentPomodoroTimer && ProjectKanbanView.currentPomodoroTimer.isWindowActive()) {
            const currentState = ProjectKanbanView.currentPomodoroTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = task.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新的正计时任务："${newTitle}"？`;

            if (currentState.isRunning && !currentState.isPaused) {
                try {
                    ProjectKanbanView.currentPomodoroTimer.pauseFromExternal();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                confirmMessage += `\n\n选择"确定"将继承当前进度继续计时。`;
            }

            confirm(
                "切换到正计时番茄钟",
                confirmMessage,
                () => {
                    this.performStartPomodoroCountUp(task, currentState);
                },
                () => {
                    if (currentState.isRunning && !currentState.isPaused) {
                        try {
                            ProjectKanbanView.currentPomodoroTimer.resumeFromExternal();
                        } catch (error) {
                            console.error('恢复番茄钟运行失败:', error);
                        }
                    }
                }
            );
        } else {
            if (ProjectKanbanView.currentPomodoroTimer && !ProjectKanbanView.currentPomodoroTimer.isWindowActive()) {
                ProjectKanbanView.currentPomodoroTimer = null;
            }
            this.performStartPomodoroCountUp(task);
        }
    }

    private async performStartPomodoro(task: any, inheritState?: any) {
        if (ProjectKanbanView.currentPomodoroTimer) {
            try {
                ProjectKanbanView.currentPomodoroTimer.close();
                ProjectKanbanView.currentPomodoroTimer = null;
            } catch (error) {
                console.error('关闭之前的番茄钟失败:', error);
            }
        }

        const settings = await this.plugin.getPomodoroSettings();

        const reminder = {
            id: task.id,
            title: task.title,
            blockId: task.blockId,
            isRepeatInstance: false,
            originalId: task.id
        };

        const pomodoroTimer = new PomodoroTimer(reminder, settings, false, inheritState);
        ProjectKanbanView.currentPomodoroTimer = pomodoroTimer;
        pomodoroTimer.show();

        if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
            const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
            showMessage(`已切换任务并继承${phaseText}进度`, 2000);
        }
    }

    private async performStartPomodoroCountUp(task: any, inheritState?: any) {
        if (ProjectKanbanView.currentPomodoroTimer) {
            try {
                ProjectKanbanView.currentPomodoroTimer.close();
                ProjectKanbanView.currentPomodoroTimer = null;
            } catch (error) {
                console.error('关闭之前的番茄钟失败:', error);
            }
        }

        const settings = await this.plugin.getPomodoroSettings();

        const reminder = {
            id: task.id,
            title: task.title,
            blockId: task.blockId,
            isRepeatInstance: false,
            originalId: task.id
        };

        const pomodoroTimer = new PomodoroTimer(reminder, settings, true, inheritState);
        ProjectKanbanView.currentPomodoroTimer = pomodoroTimer;
        pomodoroTimer.show();

        if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
            const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
            showMessage(`已切换到正计时模式并继承${phaseText}进度`, 2000);
        } else {
            showMessage("已启动正计时番茄钟", 2000);
        }
    }

    private addCustomStyles() {
        // 检查是否已经添加过样式
        if (document.querySelector('#project-kanban-custom-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'project-kanban-custom-styles';
        style.textContent = `
            .project-kanban-view {
                height: 100%;
                display: flex;
                flex-direction: column;
                background: var(--b3-theme-background);
            }

            .project-kanban-toolbar {
                display: flex;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid var(--b3-theme-border);
                background: var(--b3-theme-surface);
                gap: 16px;
            }

            .project-kanban-title {
                flex: 1;
            }

            .project-kanban-controls {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .project-kanban-container {
                flex: 1;
                display: flex;
                flex-wrap: wrap;
                gap: 16px;
                padding: 16px;
                overflow-y: auto;
                min-height: 0;
            }

            .kanban-column {
                flex: 1 1 300px;
                min-width: 280px;
                background: var(--b3-theme-surface);
                border-radius: 8px;
                border: 1px solid var(--b3-theme-border);
                display: flex;
                flex-direction: column;
                max-height: 100%;
                max-width: 100%;
            }

            .kanban-column-header {
                padding: 12px 16px;
                border-bottom: 1px solid var(--b3-theme-border);
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .kanban-column-content {
                flex: 1;
                padding: 8px;
                overflow-y: auto;
                min-height: 200px;
            }

            .kanban-column-count {
                border-radius: 12px;
                padding: 2px 8px;
                font-size: 12px;
                font-weight: 500;
                min-width: 20px;
                text-align: center;
            }

            /* 基础任务卡片样式 */
            .kanban-task {
                background: var(--b3-theme-surface-lighter);
                border: 1px solid var(--b3-theme-border);
                border-radius: 6px;
                padding: 12px;
                margin-bottom: 8px;
                cursor: grab;
                transition: all 0.2s ease;
                position: relative;
            }

            .kanban-task:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            }

            .kanban-task.dragging {
                opacity: 0.5;
                cursor: grabbing;
            }

            /* 优先级样式 - 参考 project-reminder.scss */
            .kanban-task-priority-high {
                border-left: 4px solid var(--b3-card-error-color) !important;
                background-color: var(--b3-card-error-background) !important;
            }

            .kanban-task-priority-high .kanban-task-note {
                border: 2px solid var(--b3-card-error-color) !important;
                color: var(--b3-card-error-color) !important;
                background-color: var(--b3-card-error-background) !important;
            }

            .kanban-task-priority-medium {
                border-left: 4px solid var(--b3-card-warning-color) !important;
                background-color: var(--b3-card-warning-background) !important;
            }

            .kanban-task-priority-medium .kanban-task-note {
                color: var(--b3-card-warning-color) !important;
                background-color: var(--b3-card-warning-background) !important;
                border: 2px solid var(--b3-card-warning-color) !important;
            }

            .kanban-task-priority-low {
                border-left: 4px solid var(--b3-card-info-color) !important;
                background-color: var(--b3-card-info-background) !important;
            }

            .kanban-task-priority-low .kanban-task-note {
                color: var(--b3-card-info-color) !important;
                background-color: var(--b3-card-info-background) !important;
                border: 2px solid var(--b3-card-info-color) !important;
            }

            .kanban-task-title {
                font-weight: 500;
                margin-bottom: 8px;
                color: var(--b3-theme-on-surface);
                line-height: 1.4;
            }

            .kanban-task-info {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .kanban-task-date {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
            }

            /* 优先级标签样式 - 参考 project-priority-label */
            .kanban-task-priority {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 1px 4px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: 500;
                margin-top: 2px;
                width: fit-content;
                align-self: flex-start;
            }

            .priority-label-high {
                background-color: rgba(231, 76, 60, 0.1);
                color: #e74c3c;
            }

            .priority-label-medium {
                background-color: rgba(243, 156, 18, 0.1);
                color: #f39c12;
            }

            .priority-label-low {
                background-color: rgba(52, 152, 219, 0.1);
                color: #3498db;
            }

            .priority-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
            }

            .priority-dot.high {
                background: #e74c3c;
            }

            .priority-dot.medium {
                background: #f39c12;
            }

            .priority-dot.low {
                background: #3498db;
            }

            .priority-dot.none {
                background: #95a5a6;
            }

            .kanban-task-category {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 11px;
                color: white;
                font-weight: 500;
                align-self: flex-start;
            }

            .kanban-task-note {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.8;
                margin-top: 4px;
                line-height: 1.3;
                max-height: 40px;
                overflow: hidden;
                text-overflow: ellipsis;
                padding: 4px 8px;
                background: var(--b3-theme-surface-lighter);
                border-radius: 4px;
                border: 2px solid var(--b3-border-color);
            }

            .kanban-drop-zone-active {
                background: var(--b3-theme-primary-lightest);
                border-color: var(--b3-theme-primary);
            }

            .reminder-dialog .b3-form__group {
                margin-bottom: 16px;
            }
            .reminder-dialog .b3-form__label {
                display: block;
                margin-bottom: 8px;
                font-weight: 500;
            }
            .priority-selector {
                display: flex;
                gap: 8px;
            }
            .priority-option {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 12px;
                border-radius: 16px;
                cursor: pointer;
                border: 1px solid var(--b3-theme-border);
                transition: all 0.2s ease;
            }
            .priority-option:hover {
                background-color: var(--b3-theme-surface-lighter);
            }
            .priority-option.selected {
                font-weight: 600;
                border-color: var(--b3-theme-primary);
                background-color: var(--b3-theme-primary-lightest);
                color: var(--b3-theme-primary);
            }
            .priority-option .priority-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
            }
            .priority-option .priority-dot.high { background-color: #e74c3c; }
            .priority-option .priority-dot.medium { background-color: #f39c12; }
            .priority-option .priority-dot.low { background-color: #3498db; }
            .priority-option .priority-dot.none { background-color: #95a5a6; }
            
            .category-selector .category-option {
                padding: 4px 10px;
                border-radius: 14px;
                cursor: pointer;
                transition: transform 0.15s ease;
                border: 1px solid transparent;
                color: white;
            }
            .category-selector .category-option.selected {
                transform: scale(1.05);
                box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest);
                font-weight: bold;
            }
            .category-selector .category-option[data-category=""] {
                background-color: var(--b3-theme-surface-lighter);
                color: var(--b3-theme-on-surface);
            }
            .reminder-date-container {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .reminder-date-container .b3-text-field {
                flex: 1;
            }
            .reminder-arrow {
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
            }

            .kanban-task-block-info {
                font-size: 11px;
                color: var(--b3-theme-on-background);
                margin-top: 4px;
                opacity: 0.9;
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 2px 6px;
                background-color: var(--b3-theme-surface-lighter);
                border-radius: 4px;
                border: 1px solid var(--b3-theme-border);
                transition: all 0.2s ease;
            }

            .kanban-task-block-info:hover {
                background-color: var(--b3-theme-primary-lightest);
                border-color: var(--b3-theme-primary);
            }

            .kanban-task-block-info span[data-type="a"] {
                cursor: pointer;
                color: var(--b3-theme-primary);
                text-decoration: underline;
                text-decoration-style: dotted;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                transition: color 0.2s ease;
            }

            .kanban-task-block-info span[data-type="a"]:hover {
                color: var(--b3-theme-primary-light);
            }

            .kanban-task-pomodoro-count {
                /* Styles for pomodoro count */
            }

            /* 倒计时样式 */
            .countdown-badge {
                font-size: 11px;
                padding: 2px 6px;
                border-radius: 10px;
                font-weight: 500;
                margin-left: 4px;
            }

            .countdown-urgent {
                background-color: rgba(231, 76, 60, 0.15);
                color: #e74c3c;
                border: 1px solid rgba(231, 76, 60, 0.3);
            }

            .countdown-warning {
                background-color: rgba(243, 156, 18, 0.15);
                color: #f39c12;
                border: 1px solid rgba(243, 156, 18, 0.3);
            }

            .countdown-normal {
                background-color: rgba(46, 204, 113, 0.15);
                color: #2ecc71;
                border: 1px solid rgba(46, 204, 113, 0.3);
            }

           .kanban-task-checkbox {
               -webkit-appearance: none;
               appearance: none;
               background-color: var(--b3-theme-surface);
               margin: 0;
               margin-top: 5px; /* 微调对齐 */
               font: inherit;
               color: var(--b3-theme-on-surface);
               width: 1.15em;
               height: 1.15em;
               border: 0.1em solid var(--b3-theme-on-surface);
               border-radius: 0.25em;
               transform: translateY(-0.075em);
               display: grid;
               place-content: center;
               cursor: pointer;
               transition: all 0.2s ease;
               flex-shrink: 0;
           }

           .kanban-task-checkbox:hover {
               border-color: var(--b3-theme-primary);
           }

           .kanban-task-checkbox::before {
               content: "";
               width: 0.65em;
               height: 0.65em;
               transform: scale(0);
               transition: 120ms transform ease-in-out;
               box-shadow: inset 1em 1em var(--b3-theme-primary);
               transform-origin: bottom left;
               clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
           }

           .kanban-task-checkbox:checked {
               background: var(--b3-theme-primary);
               border-color: var(--b3-theme-primary);
           }

           .kanban-task-checkbox:checked::before {
               transform: scale(1);
               box-shadow: inset 1em 1em var(--b3-theme-surface);
           }

           .kanban-task-collapse-btn {
               width: 10px;
               min-width: auto;
               color: var(--b3-theme-on-surface);
               opacity: 0.6;
               display: flex;
               align-items: center;
               justify-content: center;
           }
           .kanban-task-collapse-btn .b3-button__icon {
                margin: 0;
            }
            .kanban-task-collapse-btn svg{
                height: 10px;
                width: 10px;
            }
           .kanban-task-collapse-btn:hover {
               opacity: 1;
               color: var(--b3-theme-primary);
               background: var(--b3-theme-surface-lighter);
           }
        `;
        document.head.appendChild(style);
    }
    private renderCategorySelector(container: HTMLElement, defaultCategoryId?: string) {
        container.innerHTML = '';
        const categories = this.categoryManager.getCategories();

        const noCategoryEl = document.createElement('div');
        noCategoryEl.className = 'category-option';
        noCategoryEl.setAttribute('data-category', '');
        noCategoryEl.innerHTML = `<span>无分类</span>`;
        if (!defaultCategoryId) {
            noCategoryEl.classList.add('selected');
        }
        container.appendChild(noCategoryEl);

        categories.forEach(category => {
            const categoryEl = document.createElement('div');
            categoryEl.className = 'category-option';
            categoryEl.setAttribute('data-category', category.id);
            categoryEl.style.backgroundColor = category.color;
            categoryEl.innerHTML = `<span>${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
            if (category.id === defaultCategoryId) {
                categoryEl.classList.add('selected');
            }
            container.appendChild(categoryEl);
        });

        container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option') as HTMLElement;
            if (option) {
                container.querySelectorAll('.category-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });
    }

    // 设置任务优先级
    private async setPriority(taskId: string, priority: string) {
        try {
            const reminderData = await readReminderData();
            if (reminderData[taskId]) {
                reminderData[taskId].priority = priority;
                await writeReminderData(reminderData);

                showMessage("优先级已更新");
                await this.loadTasks();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            } else {
                showMessage("任务不存在");
            }
        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage("设置优先级失败");
        }
    }

    // 复制块引用
    private async copyBlockRef(task: any) {
        try {
            const blockId = task.blockId;
            if (!blockId) {
                showMessage("无法获取块ID");
                return;
            }

            const title = task.title || "未命名任务";
            const blockRef = `((${blockId} "${title}"))`;

            await navigator.clipboard.writeText(blockRef);
            showMessage("块引用已复制到剪贴板");
        } catch (error) {
            console.error('复制块引用失败:', error);
            showMessage("复制块引用失败");
        }
    }

    // 显示绑定到块的对话框
    private showBindToBlockDialog(task: any) {
        const dialog = new Dialog({
            title: "绑定任务到块",
            content: `
                <div class="bind-to-block-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">块ID</label>
                            <div class="b3-form__desc">请输入要绑定的块ID</div>
                            <input type="text" id="blockIdInput" class="b3-text-field" placeholder="请输入块ID" style="width: 100%; margin-top: 8px;">
                        </div>
                        <div class="b3-form__group" id="selectedBlockInfo" style="display: none;">
                            <label class="b3-form__label">块信息预览</label>
                            <div id="blockContent" class="block-content-preview" style="
                                padding: 8px;
                                background-color: var(--b3-theme-surface-lighter);
                                border-radius: 4px;
                                border: 1px solid var(--b3-theme-border);
                                max-height: 100px;
                                overflow-y: auto;
                                font-size: 12px;
                                color: var(--b3-theme-on-surface);
                            "></div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="bindCancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="bindConfirmBtn">绑定</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "300px"
        });

        const blockIdInput = dialog.element.querySelector('#blockIdInput') as HTMLInputElement;
        const selectedBlockInfo = dialog.element.querySelector('#selectedBlockInfo') as HTMLElement;
        const blockContentEl = dialog.element.querySelector('#blockContent') as HTMLElement;
        const cancelBtn = dialog.element.querySelector('#bindCancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#bindConfirmBtn') as HTMLButtonElement;

        // 监听块ID输入变化
        blockIdInput.addEventListener('input', async () => {
            const blockId = blockIdInput.value.trim();
            if (blockId.length >= 20) { // 块ID通常是20位字符
                try {
                    const block = await getBlockByID(blockId);
                    if (block) {
                        const blockContent = block.content || block.fcontent || '未命名块';
                        blockContentEl.textContent = blockContent;
                        selectedBlockInfo.style.display = 'block';
                    } else {
                        selectedBlockInfo.style.display = 'none';
                    }
                } catch (error) {
                    selectedBlockInfo.style.display = 'none';
                }
            } else {
                selectedBlockInfo.style.display = 'none';
            }
        });

        // 取消按钮
        cancelBtn.addEventListener('click', () => {
            dialog.destroy();
        });

        // 确认按钮
        confirmBtn.addEventListener('click', async () => {
            const blockId = blockIdInput.value.trim();
            if (!blockId) {
                showMessage('请输入块ID');
                return;
            }

            try {
                await this.bindTaskToBlock(task, blockId);
                showMessage("任务已绑定到块");
                dialog.destroy();
                await this.loadTasks();
            } catch (error) {
                console.error('绑定任务到块失败:', error);
                showMessage("绑定失败");
            }
        });

        // 自动聚焦输入框
        setTimeout(() => {
            blockIdInput.focus();
        }, 100);
    }

    // 将任务绑定到指定的块
    private async bindTaskToBlock(task: any, blockId: string) {
        try {
            const reminderData = await readReminderData();

            if (reminderData[task.id]) {
                // 获取块信息
                const block = await getBlockByID(blockId);
                if (!block) {
                    throw new Error('目标块不存在');
                }

                // 更新任务数据
                reminderData[task.id].blockId = blockId;
                reminderData[task.id].docId = block.root_id || blockId;

                await writeReminderData(reminderData);

                // 更新块的书签状态
                await updateBlockReminderBookmark(blockId);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            } else {
                throw new Error('任务不存在');
            }
        } catch (error) {
            console.error('绑定任务到块失败:', error);
            throw error;
        }
    }


    /**
     * 打开块标签页
     * @param blockId 块ID
     */
    private async openBlockTab(blockId: string) {
        try {
            openBlock(blockId);
        } catch (error) {
            console.error('打开块失败:', error);

            // 询问用户是否删除无效的绑定
            await confirm(
                "打开块失败",
                "绑定的块可能已被删除，是否解除绑定？",
                async () => {
                    // 解除任务的块绑定
                    await this.unbindTaskFromBlock(blockId);
                },
                () => {
                    showMessage("打开块失败");
                }
            );
        }
    }

    /**
     * 解除任务与块的绑定
     * @param blockId 块ID
     */
    private async unbindTaskFromBlock(blockId: string) {
        try {
            const reminderData = await readReminderData();
            let unboundCount = 0;

            // 找到所有绑定到该块的任务并解除绑定
            Object.keys(reminderData).forEach(taskId => {
                const task = reminderData[taskId];
                if (task && task.blockId === blockId) {
                    delete task.blockId;
                    delete task.docId;
                    unboundCount++;
                }
            });

            if (unboundCount > 0) {
                await writeReminderData(reminderData);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                showMessage(`已解除 ${unboundCount} 个任务的块绑定`);
                await this.loadTasks();
            } else {
                showMessage("未找到相关的任务绑定");
            }
        } catch (error) {
            console.error('解除块绑定失败:', error);
            showMessage("解除块绑定失败");
        }
    }

    private getTaskFromElement(element: HTMLElement): any {
        const taskId = element.dataset.taskId;
        if (!taskId) return null;
        return this.tasks.find(t => t.id === taskId);
    }

    private canDropForSort(draggedTask: any, targetTask: any): boolean {
        if (!draggedTask || !targetTask) return false;
        // 只允许在相同优先级内拖动
        const draggedPriority = draggedTask.priority || 'none';
        const targetPriority = targetTask.priority || 'none';
        return draggedPriority === targetPriority;
    }

    private showDropIndicator(element: HTMLElement, event: DragEvent) {
        this.hideDropIndicator(); // 清除之前的指示器

        const rect = element.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        indicator.style.cssText = `
            position: absolute;
            left: 0;
            right: 0;
            height: 2px;
            background-color: var(--b3-theme-primary);
            z-index: 1000;
            pointer-events: none;
        `;

        element.style.position = 'relative'; // 确保父元素是定位的

        if (event.clientY < midpoint) {
            // 插入到目标元素之前
            indicator.style.top = '-1px';
        } else {
            // 插入到目标元素之后
            indicator.style.bottom = '-1px';
        }
        element.appendChild(indicator);
    }

    private hideDropIndicator() {
        this.container.querySelectorAll('.drop-indicator').forEach(indicator => indicator.remove());
        this.container.querySelectorAll('.kanban-task').forEach((el: HTMLElement) => {
            if (el.style.position === 'relative') {
                el.style.position = '';
            }
        });
    }

    private async handleSortDrop(targetTask: any, event: DragEvent) {
        if (!this.draggedTask) return;

        try {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = event.clientY < midpoint;

            await this.reorderTasks(this.draggedTask, targetTask, insertBefore);

            showMessage("排序已更新");
            // 重新加载由 reorderTasks 中派发的 'reminderUpdated' 事件触发，此处无需重复调用
        } catch (error) {
            console.error('处理拖放排序失败:', error);
            showMessage("排序更新失败");
        }
    }

    private async reorderTasks(draggedTask: any, targetTask: any, insertBefore: boolean) {
        try {
            const reminderData = await readReminderData();

            const draggedId = draggedTask.id;
            const targetId = targetTask.id;

            const draggedTaskInDb = reminderData[draggedId];
            const targetTaskInDb = reminderData[targetId];

            if (!draggedTaskInDb || !targetTaskInDb) {
                throw new Error("Task not found in data");
            }

            const oldStatus = this.getTaskStatus(draggedTaskInDb);
            const newStatus = this.getTaskStatus(targetTaskInDb);
            const priority = draggedTaskInDb.priority || 'none';

            // --- Update status of dragged task ---
            if (oldStatus !== newStatus) {
                if (newStatus === 'done') {
                    draggedTaskInDb.completed = true;
                    draggedTaskInDb.completedTime = getLocalDateTimeString(new Date());
                } else {
                    draggedTaskInDb.completed = false;
                    delete draggedTaskInDb.completedTime;
                    draggedTaskInDb.kanbanStatus = newStatus;
                }
            }

            // --- Reorder source list (if status changed) ---
            if (oldStatus !== newStatus) {
                const sourceList = Object.values(reminderData)
                    .filter((r: any) => r && r.projectId === this.projectId && this.getTaskStatus(r) === oldStatus && (r.priority || 'none') === priority && r.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                sourceList.forEach((task: any, index: number) => {
                    reminderData[task.id].sort = index * 10;
                });
            }

            // --- Reorder target list ---
            const targetList = Object.values(reminderData)
                .filter((r: any) => r && r.projectId === this.projectId && this.getTaskStatus(r) === newStatus && (r.priority || 'none') === priority && r.id !== draggedId)
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            const targetIndex = targetList.findIndex((t: any) => t.id === targetId);
            const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

            targetList.splice(insertIndex, 0, draggedTaskInDb);

            targetList.forEach((task: any, index: number) => {
                reminderData[task.id].sort = index * 10;
            });

            await writeReminderData(reminderData);
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('重新排序任务失败:', error);
            throw error;
        }
    }
}