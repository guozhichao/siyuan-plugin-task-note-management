import { showMessage, confirm, Menu, Dialog } from "siyuan";

import { readReminderData, writeReminderData, readProjectData, getBlockByID, updateBlockReminderBookmark } from "../api";
import { getLocalDateString, getLocalDateTime, getLocalDateTimeString } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { PomodoroTimer } from "./PomodoroTimer";
import { t } from "../utils/i18n";

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
        kanbanContainer.style.cssText = `
            display: flex;
            gap: 16px;
            padding: 16px;
            height: calc(100% - 80px);
            overflow-x: auto;
        `;
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
        column.style.cssText = `
            flex: 1;
            min-width: 300px;
            background: var(--b3-theme-surface);
            border-radius: 8px;
            border: 1px solid var(--b3-theme-border);
            display: flex;
            flex-direction: column;
            max-height: 100%;
        `;

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
        return priorityB - priorityA; // 高优先级在前
    }

    private compareByTime(a: any, b: any): number {
        const dateA = a.date || '9999-12-31';
        const dateB = b.date || '9999-12-31';
        const timeA = a.time || '23:59';
        const timeB = b.time || '23:59';
        
        const datetimeA = `${dateA}T${timeA}`;
        const datetimeB = `${dateB}T${timeB}`;
        
        return datetimeA.localeCompare(datetimeB);
    }

    private compareByTitle(a: any, b: any): number {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        return titleA.localeCompare(titleB, 'zh-CN');
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
        titleEl.textContent = task.title || '未命名任务';
        titleEl.style.cssText = `
            font-weight: 500;
            margin-bottom: 8px;
            color: var(--b3-theme-on-surface);
            line-height: 1.4;
        `;

        // 任务信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'kanban-task-info';
        infoEl.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        // 日期时间
        if (task.date) {
            const dateEl = document.createElement('div');
            dateEl.className = 'kanban-task-date';
            dateEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
            `;
            
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
            const taskDate = new Date(task.date + 'T00:00:00');
            dateStr = taskDate.toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric'
            });
        }

        if (task.time) {
            return `${dateStr} ${task.time}`;
        }

        return dateStr;
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

                showMessage(`任务已移动到${newStatus === 'todo' ? '待办' : newStatus === 'doing' ? '进行中' : '已完成'}`);
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
                <div class="create-task-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">任务标题 *</label>
                            <input type="text" id="taskTitle" class="b3-text-field" placeholder="请输入任务标题" style="width: 100%;">
                        </div>
                        
                        <div class="b3-form__group">
                            <label class="b3-form__label">任务描述</label>
                            <textarea id="taskNote" class="b3-text-field" placeholder="请输入任务描述" style="width: 100%; height: 80px; resize: vertical;"></textarea>
                        </div>
                        
                        <div style="display: flex; gap: 16px;">
                            <div class="b3-form__group" style="flex: 1;">
                                <label class="b3-form__label">日期</label>
                                <input type="date" id="taskDate" class="b3-text-field" style="width: 100%;">
                            </div>
                            
                            <div class="b3-form__group" style="flex: 1;">
                                <label class="b3-form__label">时间</label>
                                <input type="time" id="taskTime" class="b3-text-field" style="width: 100%;">
                            </div>
                        </div>
                        
                        <div class="b3-form__group">
                            <label class="b3-form__label">优先级</label>
                            <select id="taskPriority" class="b3-select" style="width: 100%;">
                                <option value="none">无优先级</option>
                                <option value="low">低优先级</option>
                                <option value="medium">中优先级</option>
                                <option value="high">高优先级</option>
                            </select>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="createBtn">创建任务</button>
                    </div>
                </div>
            `,
            width: "500px",
            height: "400px"
        });

        const titleInput = dialog.element.querySelector('#taskTitle') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#taskNote') as HTMLTextAreaElement;
        const dateInput = dialog.element.querySelector('#taskDate') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#taskTime') as HTMLInputElement;
        const prioritySelect = dialog.element.querySelector('#taskPriority') as HTMLSelectElement;
        const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const createBtn = dialog.element.querySelector('#createBtn') as HTMLButtonElement;

        // 设置默认优先级
        prioritySelect.value = 'medium';

        cancelBtn.addEventListener('click', () => dialog.destroy());

        createBtn.addEventListener('click', async () => {
            const title = titleInput.value.trim();
            if (!title) {
                showMessage("请输入任务标题");
                return;
            }

            try {
                await this.createTask({
                    title,
                    note: noteInput.value.trim(),
                    date: dateInput.value,
                    time: timeInput.value,
                    priority: prioritySelect.value
                });

                dialog.destroy();
                showMessage("任务创建成功");
            } catch (error) {
                console.error('创建任务失败:', error);
                showMessage("创建任务失败");
            }
        });

        // 设置默认日期为今天
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
    }

    private async createTask(taskData: any) {
        try {
            const reminderData = await readReminderData();
            
            // 生成新的任务ID
            const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            
            // 创建任务对象
            const newTask = {
                id: taskId,
                title: taskData.title,
                note: taskData.note || '',
                date: taskData.date,
                time: taskData.time || undefined,
                priority: taskData.priority || 'none',
                projectId: this.projectId, // 关联项目ID
                completed: false,
                kanbanStatus: 'todo', // 默认状态为待办
                createdTime: new Date().toISOString(),
                categoryId: undefined // 可以后续添加分类支持
            };

            // 保存到reminder数据中
            reminderData[taskId] = newTask;
            await writeReminderData(reminderData);

            // 触发更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            // 重新加载任务
            await this.loadTasks();

        } catch (error) {
            console.error('创建任务失败:', error);
            throw error;
        }
    }

    private async editTask(task: any) {
        const editDialog = new ReminderEditDialog(task, async () => {
            await this.loadTasks();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        });
        editDialog.show();
    }

    private async deleteTask(task: any) {
        const result = await confirm(
            "删除任务",
            `确定要删除任务"${task.title}"吗？`,
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
                gap: 16px;
                padding: 16px;
                overflow-x: auto;
                min-height: 0;
            }

            .kanban-column {
                flex: 1;
                min-width: 300px;
                background: var(--b3-theme-surface);
                border-radius: 8px;
                border: 1px solid var(--b3-theme-border);
                display: flex;
                flex-direction: column;
                max-height: 100%;
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

            .create-task-dialog .b3-form__group {
                margin-bottom: 16px;
            }

            .create-task-dialog .b3-form__label {
                display: block;
                margin-bottom: 4px;
                font-weight: 500;
                color: var(--b3-theme-on-surface);
            }

            .create-task-dialog .b3-text-field {
                width: 100%;
                padding: 8px 12px;
                border: 1px solid var(--b3-theme-border);
                border-radius: 4px;
                background: var(--b3-theme-surface);
                color: var(--b3-theme-on-surface);
            }

            .create-task-dialog .b3-select {
                width: 100%;
                padding: 8px 12px;
                border: 1px solid var(--b3-theme-border);
                border-radius: 4px;
                background: var(--b3-theme-surface);
                color: var(--b3-theme-on-surface);
            }
        `;
        document.head.appendChild(style);
    }
}