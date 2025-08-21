import { showMessage, confirm, Menu, Dialog } from "siyuan";

import { readReminderData, writeReminderData, readProjectData, getBlockByID, updateBlockReminderBookmark, openBlock } from "../api";
import { getLocalDateString, getLocalDateTime, getLocalDateTimeString } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { PomodoroTimer } from "./PomodoroTimer";
import { t } from "../utils/i18n";
import { ReminderDialog } from "./ReminderDialog";
import { CategoryManageDialog } from "./CategoryManageDialog";

export class ProjectKanbanView {
    private container: HTMLElement;
    private plugin: any;
    private projectId: string;
    private project: any;
    private categoryManager: CategoryManager;
    private currentSort: string = 'priority';
    private currentSortOrder: 'asc' | 'desc' = 'desc';
    private showDone: boolean = true;
    private tasks: any[] = [];
    private isDragging: boolean = false;
    private draggedTask: any = null;
    private draggedElement: HTMLElement | null = null;

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
        const sortBtn = document.createElement('button');
        sortBtn.className = 'b3-button b3-button--outline';
        sortBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        sortBtn.title = '排序';
        sortBtn.addEventListener('click', (e) => this.showSortMenu(e));
        controlsGroup.appendChild(sortBtn);

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

        const titleEl = document.createElement('h3');
        titleEl.textContent = title;
        titleEl.style.cssText = `
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: ${color};
        `;

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

        header.appendChild(titleEl);
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
            if (this.isDragging) {
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
                this.moveTaskToStatus(this.draggedTask, status);
            }
        });
    }

    private async loadTasks() {
        try {
            const reminderData = await readReminderData();
            this.tasks = Object.values(reminderData)
                .filter((reminder: any) => reminder && reminder.projectId === this.projectId)
                .map((reminder: any) => ({
                    ...reminder,
                    status: this.getTaskStatus(reminder)
                }));

            this.sortTasks();
            this.renderKanban();
        } catch (error) {
            console.error('加载任务失败:', error);
            showMessage("加载任务失败");
        }
    }

    private getTaskStatus(task: any): string {
        if (task.completed) return 'done';
        if (task.kanbanStatus === 'doing') return 'doing';
        return 'todo';
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

            return this.currentSortOrder === 'desc' ? -result : result;
        });
    }

    private compareByPriority(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;
        if (priorityA !== priorityB) {
            return priorityB - priorityA; // 高优先级在前
        }
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

    private renderKanban() {
        const todoTasks = this.tasks.filter(task => task.status === 'todo');
        const doingTasks = this.tasks.filter(task => task.status === 'doing');
        const doneTasks = this.tasks.filter(task => task.status === 'done');

        this.renderColumn('todo', todoTasks);
        this.renderColumn('doing', doingTasks);
        
        if (this.showDone) {
            this.renderColumn('done', doneTasks);
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

        tasks.forEach(task => {
            const taskEl = this.createTaskElement(task);
            content.appendChild(taskEl);
        });
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

    private createTaskElement(task: any): HTMLElement {
        const taskEl = document.createElement('div');
        taskEl.className = 'kanban-task';
        taskEl.draggable = true;
        taskEl.dataset.taskId = task.id;

        const priority = task.priority || 'none';
        const priorityColors = {
            'high': '#e74c3c',
            'medium': '#f39c12',
            'low': '#3498db',
            'none': '#95a5a6'
        };

        taskEl.style.cssText = `
            background: var(--b3-theme-surface-lighter);
            border: 1px solid var(--b3-theme-border);
            border-left: 4px solid ${priorityColors[priority]};
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 8px;
            cursor: grab;
            transition: all 0.2s ease;
            position: relative;
        `;

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
            `;
        }
        
        titleEl.textContent = task.title || '未命名任务';
        titleEl.title = task.blockId ? `点击打开绑定块: ${task.title || '未命名任务'}` : (task.title || '未命名任务');

        // 任务信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'kanban-task-info';
        infoEl.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        // 日期时间
        const hasDate = task.date || task.endDate;
        if (hasDate) {
            const dateEl = document.createElement('div');
            dateEl.className = 'kanban-task-date';
            
            const dateText = this.formatTaskDate(task);
            dateEl.innerHTML = `<span>📅</span><span>${dateText}</span>`;
            infoEl.appendChild(dateEl);
        }

        // 优先级
        if (priority !== 'none') {
            const priorityEl = document.createElement('div');
            priorityEl.className = 'kanban-task-priority';
            priorityEl.style.cssText = `
                font-size: 11px;
                color: ${priorityColors[priority]};
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 4px;
            `;
            
            const priorityIcons = {
                'high': '🔴',
                'medium': '🟡',
                'low': '🔵'
            };
            
            const priorityNames = {
                'high': '高优先级',
                'medium': '中优先级',
                'low': '低优先级'
            };
            
            priorityEl.innerHTML = `<span>${priorityIcons[priority]}</span><span>${priorityNames[priority]}</span>`;
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

        // 不再单独显示绑定块信息，因为已经集成到标题中

        taskEl.appendChild(titleEl);
        taskEl.appendChild(infoEl);

        // 添加拖拽事件
        this.addTaskDragEvents(taskEl, task);

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
        });
    }

    private async moveTaskToStatus(task: any, newStatus: string) {
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

                // showMessage(`任务已移动到${newStatus === 'todo' ? '待办' : newStatus === 'doing' ? '进行中' : '已完成'}`);
            }
        } catch (error) {
            console.error('移动任务失败:', error);
            showMessage("移动任务失败");
        }
    }

    private showTaskContextMenu(event: MouseEvent, task: any) {
        const menu = new Menu("kanbanTaskContextMenu");

        // 编辑任务
        menu.addItem({
            iconHTML: "📝",
            label: "编辑任务",
            click: () => this.editTask(task)
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
                click: () => this.moveTaskToStatus(task, 'todo')
            });
        }

        if (currentStatus !== 'doing') {
            menu.addItem({
                iconHTML: "⚡",
                label: "移动到进行中",
                click: () => this.moveTaskToStatus(task, 'doing')
            });
        }

        if (currentStatus !== 'done') {
            menu.addItem({
                iconHTML: "✅",
                label: "标记为完成",
                click: () => this.moveTaskToStatus(task, 'done')
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

    private showSortMenu(event: MouseEvent) {
        const menu = new Menu("kanbanSortMenu");

        const sortOptions = [
            { key: 'priority', label: '优先级', icon: '🎯' },
            { key: 'time', label: '时间', icon: '🕐' },
            { key: 'title', label: '标题', icon: '📝' }
        ];

        sortOptions.forEach(option => {
            menu.addItem({
                iconHTML: option.icon,
                label: `${option.label} (升序)`,
                current: this.currentSort === option.key && this.currentSortOrder === 'asc',
                click: () => {
                    this.currentSort = option.key;
                    this.currentSortOrder = 'asc';
                    this.sortTasks();
                    this.renderKanban();
                }
            });

            menu.addItem({
                iconHTML: option.icon,
                label: `${option.label} (降序)`,
                current: this.currentSort === option.key && this.currentSortOrder === 'desc',
                click: () => {
                    this.currentSort = option.key;
                    this.currentSortOrder = 'desc';
                    this.sortTasks();
                    this.renderKanban();
                }
            });
        });

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private showCreateTaskDialog() {
        const dialog = new Dialog({
            title: "新建任务",
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
            });

            dialog.destroy();
        });

    }

    private async createTask(taskData: any) {
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
                    <textarea id="taskList" class="b3-text-field" style="width: 100%; height: 200px; resize: vertical;"></textarea>
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
                await this.batchCreateTasks(lines);
                dialog.destroy();
                showMessage(`${lines.length} 个任务已创建`);
            }
        });
    }

    private async batchCreateTasks(titles: string[]) {
        const reminderData = await readReminderData();
        const categoryId = this.project.categoryId; // 继承项目分类

        for (const title of titles) {
            const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            const newTask = {
                id: taskId,
                title: title,
                note: '',
                priority: 'none', // 默认无优先级
                categoryId: categoryId,
                projectId: this.projectId,
                completed: false,
                kanbanStatus: 'todo',
                createdTime: new Date().toISOString(),
            };
            reminderData[taskId] = newTask;
        }

        await writeReminderData(reminderData);
        await this.loadTasks();
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    }

    private async deleteTask(task: any) {
        confirm(
            "删除任务",
            `确定要删除任务 "${task.title}" 吗？此操作不可撤销。`,
            async () => {
                try {
                    const reminderData = await readReminderData();
                    
                    if (reminderData[task.id]) {
                        delete reminderData[task.id];
                        await writeReminderData(reminderData);

                        // 触发更新事件
                        window.dispatchEvent(new CustomEvent('reminderUpdated'));

                        // 重新加载任务
                        await this.loadTasks();

                        showMessage("任务已删除");
                    }
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

            .kanban-task-priority {
                font-size: 11px;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 4px;
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
            .priority-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
            }
            .priority-dot.high { background-color: #e74c3c; }
            .priority-dot.medium { background-color: #f39c12; }
            .priority-dot.low { background-color: #3498db; }
            .priority-dot.none { background-color: #95a5a6; }
            
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
     * 异步添加绑定块信息显示
     * @param container 信息容器元素
     * @param task 任务对象
     */
    private async addBlockInfo(container: HTMLElement, task: any) {
        try {
            if (!task.blockId) return;

            const block = await getBlockByID(task.blockId);
            if (block && block.content) {
                // 创建绑定块信息元素
                const blockInfoEl = document.createElement('div');
                blockInfoEl.className = 'kanban-task-block-info';
                blockInfoEl.style.cssText = `
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
                `;

                // 添加块图标
                const blockIcon = document.createElement('span');
                blockIcon.innerHTML = '🔗';
                blockIcon.style.fontSize = '10px';

                // 创建支持悬浮预览的块标题链接
                const blockTitleLink = document.createElement('span');
                blockTitleLink.setAttribute('data-type', 'a');
                blockTitleLink.setAttribute('data-href', `siyuan://blocks/${task.blockId}`);
                blockTitleLink.textContent = block.content.length > 30 ?
                    block.content.substring(0, 30) + '...' :
                    block.content;
                blockTitleLink.title = `绑定块: ${block.content}`;
                blockTitleLink.style.cssText = `
                    cursor: pointer;
                    color: var(--b3-theme-primary);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                `;

                // 点击事件：打开块
                blockTitleLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openBlockTab(task.blockId);
                });

                // 鼠标悬停效果
                blockTitleLink.addEventListener('mouseenter', () => {
                    blockTitleLink.style.color = 'var(--b3-theme-primary-light)';
                });
                blockTitleLink.addEventListener('mouseleave', () => {
                    blockTitleLink.style.color = 'var(--b3-theme-primary)';
                });

                blockInfoEl.appendChild(blockIcon);
                blockInfoEl.appendChild(blockTitleLink);

                // 将绑定块信息添加到容器
                container.appendChild(blockInfoEl);
            }
        } catch (error) {
            console.warn('获取绑定块信息失败:', error);
            // 静默失败，不影响主要功能
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
}