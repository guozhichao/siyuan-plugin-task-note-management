import { readReminderData, writeReminderData } from "../api";
import { ProjectManager } from "../utils/projectManager";
import { CategoryManager } from "../utils/categoryManager";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { showMessage, confirm, openTab, Menu } from "siyuan";
import { t } from "../utils/i18n";
import { getLocalDateString } from "../utils/dateUtils";

interface QuadrantTask {
    id: string;
    title: string;
    priority: 'high' | 'medium' | 'low' | 'none';
    isUrgent: boolean;
    projectId?: string;
    projectName?: string;
    completed: boolean;
    date: string;
    time?: string;
    note?: string;
    blockId?: string;
    extendedProps: any;
    quadrant?: 'important-urgent' | 'important-not-urgent' | 'not-important-urgent' | 'not-important-not-urgent';
}

interface Quadrant {
    key: string;
    title: string;
    description: string;
    color: string;
    tasks: QuadrantTask[];
}

export class EisenhowerMatrixView {
    private container: HTMLElement;
    private plugin: any;
    private projectManager: ProjectManager;
    private categoryManager: CategoryManager;
    private quadrants: Quadrant[];
    private allTasks: QuadrantTask[] = [];

    constructor(container: HTMLElement, plugin: any) {
        this.container = container;
        this.plugin = plugin;
        this.projectManager = ProjectManager.getInstance();
        this.categoryManager = CategoryManager.getInstance();
        this.initQuadrants();
    }

    private initQuadrants() {
        this.quadrants = [
            {
                key: 'important-urgent',
                title: '🔥重要且紧急',
                description: '立即处理的任务',
                color: '#e74c3c',
                tasks: []
            },
            {
                key: 'important-not-urgent',
                title: '📅重要不紧急',
                description: '计划处理的任务',
                color: '#3498db',
                tasks: []
            },
            {
                key: 'not-important-urgent',
                title: '⏰不重要但紧急',
                description: '可以委托的任务',
                color: '#f39c12',
                tasks: []
            },
            {
                key: 'not-important-not-urgent',
                title: '🌱不重要不紧急',
                description: '可以删除的任务',
                color: '#95a5a6',
                tasks: []
            }
        ];
    }

    async initialize() {
        await this.projectManager.initialize();
        await this.categoryManager.initialize();
        this.setupUI();
        await this.loadTasks();
        this.renderMatrix();
        this.setupEventListeners();
    }

    private setupUI() {
        this.container.innerHTML = '';
        this.container.className = 'eisenhower-matrix-view';

        // 添加标题和切换按钮
        const headerEl = document.createElement('div');
        headerEl.className = 'matrix-header';
        headerEl.innerHTML = `
            <h2>${t("eisenhowerMatrix")}</h2>
            <button class="b3-button b3-button--outline switch-to-calendar-btn" title="${t("calendarView")}">
                <svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg>
                ${t("calendarView")}
            </button>
        `;
        this.container.appendChild(headerEl);

        // 创建四象限网格
        const matrixGrid = document.createElement('div');
        matrixGrid.className = 'matrix-grid';
        
        this.quadrants.forEach(quadrant => {
            const quadrantEl = this.createQuadrantElement(quadrant);
            matrixGrid.appendChild(quadrantEl);
        });

        this.container.appendChild(matrixGrid);

        // 添加样式
        this.addStyles();
    }

    private createQuadrantElement(quadrant: Quadrant): HTMLElement {
        const quadrantEl = document.createElement('div');
        quadrantEl.className = `quadrant quadrant-${quadrant.key}`;
        quadrantEl.setAttribute('data-quadrant', quadrant.key);

        const header = document.createElement('div');
        header.className = 'quadrant-header';
        header.innerHTML = `
            <div class="quadrant-title" style="color: ${quadrant.color}">${quadrant.title}</div>
            <button class="b3-button b3-button--outline add-task-btn" data-quadrant="${quadrant.key}">
                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                ${t("newTask")}
            </button>
        `;

        const content = document.createElement('div');
        content.className = 'quadrant-content';
        content.setAttribute('data-quadrant-content', quadrant.key);

        // 设置为可放置区域
        content.setAttribute('data-drop-zone', 'true');

        quadrantEl.appendChild(header);
        quadrantEl.appendChild(content);

        return quadrantEl;
    }

    private async loadTasks() {
        try {
            const reminderData = await readReminderData();
            this.allTasks = [];

            for (const [id, reminder] of Object.entries(reminderData as any)) {
                if (!reminder || typeof reminder !== 'object') continue;

                // 跳过已完成的任务
                if (reminder.completed) continue;

                // 判断重要性
                const isImportant = reminder.priority === 'high' || reminder.priority === 'medium';
                
                // 判断紧急性
                const isUrgent = this.isTaskUrgent(reminder);

                // 确定象限
                let quadrant: QuadrantTask['quadrant'];
                if (isImportant && isUrgent) {
                    quadrant = 'important-urgent';
                } else if (isImportant && !isUrgent) {
                    quadrant = 'important-not-urgent';
                } else if (!isImportant && isUrgent) {
                    quadrant = 'not-important-urgent';
                } else {
                    quadrant = 'not-important-not-urgent';
                }

                // 如果有手动设置的象限属性，则使用手动设置
                if (reminder.quadrant && this.isValidQuadrant(reminder.quadrant)) {
                    quadrant = reminder.quadrant;
                }

                // 获取项目信息
                let projectName = '';
                if (reminder.projectId) {
                    const project = this.projectManager.getProjectById(reminder.projectId);
                    projectName = project ? project.name : '';
                }

                const task: QuadrantTask = {
                    id,
                    title: reminder.title || t('unnamedNote'),
                    priority: reminder.priority || 'none',
                    isUrgent,
                    projectId: reminder.projectId,
                    projectName,
                    completed: reminder.completed || false,
                    date: reminder.date,
                    time: reminder.time,
                    note: reminder.note,
                    blockId: reminder.blockId,
                    extendedProps: reminder,
                    quadrant
                };

                this.allTasks.push(task);
            }

            // 按象限分组任务
            this.groupTasksByQuadrant();
        } catch (error) {
            console.error('加载任务失败:', error);
            showMessage(t('loadTasksFailed'));
        }
    }

    private isTaskUrgent(reminder: any): boolean {
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const taskDate = new Date(reminder.date);
        
        // 过期、今天、明天的任务认为是紧急的
        return taskDate <= tomorrow;
    }

    private isValidQuadrant(quadrant: string): quadrant is QuadrantTask['quadrant'] {
        return ['important-urgent', 'important-not-urgent', 'not-important-urgent', 'not-important-not-urgent'].includes(quadrant);
    }

    private groupTasksByQuadrant() {
        // 清空现有任务
        this.quadrants.forEach(q => q.tasks = []);

        // 按象限分组
        this.allTasks.forEach(task => {
            const quadrant = this.quadrants.find(q => q.key === task.quadrant);
            if (quadrant) {
                quadrant.tasks.push(task);
            }
        });

        // 在每个象限内按项目分组
        this.quadrants.forEach(quadrant => {
            const groupedTasks = this.groupTasksByProject(quadrant.tasks);
            quadrant.tasks = groupedTasks;
        });
    }

    private groupTasksByProject(tasks: QuadrantTask[]): QuadrantTask[] {
        const grouped = new Map<string, QuadrantTask[]>();
        
        tasks.forEach(task => {
            const projectKey = task.projectId || 'no-project';
            if (!grouped.has(projectKey)) {
                grouped.set(projectKey, []);
            }
            grouped.get(projectKey)!.push(task);
        });

        // 转换为数组并保持顺序
        const result: QuadrantTask[] = [];
        
        // 先添加有项目的任务
        const sortedProjects = Array.from(grouped.entries())
            .filter(([key]) => key !== 'no-project')
            .sort((a, b) => (a[1][0].projectName || '').localeCompare(b[1][0].projectName || ''));

        sortedProjects.forEach(([projectId, tasks]) => {
            result.push(...tasks);
        });

        // 添加无项目的任务
        if (grouped.has('no-project')) {
            result.push(...grouped.get('no-project')!);
        }

        return result;
    }

    private renderMatrix() {
        this.quadrants.forEach(quadrant => {
            const contentEl = this.container.querySelector(`[data-quadrant-content="${quadrant.key}"]`) as HTMLElement;
            if (!contentEl) return;

            contentEl.innerHTML = '';

            if (quadrant.tasks.length === 0) {
                const emptyEl = document.createElement('div');
                emptyEl.className = 'empty-quadrant';
                emptyEl.textContent = t('noTasksInQuadrant');
                contentEl.appendChild(emptyEl);
                return;
            }

            // 按项目分组显示
            const projectGroups = new Map<string, QuadrantTask[]>();
            quadrant.tasks.forEach(task => {
                const projectKey = task.projectId || 'no-project';
                if (!projectGroups.has(projectKey)) {
                    projectGroups.set(projectKey, []);
                }
                projectGroups.get(projectKey)!.push(task);
            });

            projectGroups.forEach((tasks, projectKey) => {
                const projectGroup = document.createElement('div');
                projectGroup.className = 'project-group';

                const projectHeader = document.createElement('div');
                projectHeader.className = 'project-header';
                if (projectKey !== 'no-project') {
                    projectHeader.textContent = tasks[0].projectName || t('noProject');
                } else {
                    projectHeader.textContent = t('noProject');
                }
                projectGroup.appendChild(projectHeader);

                tasks.forEach(task => {
                    const taskEl = this.createTaskElement(task);
                    projectGroup.appendChild(taskEl);
                });

                contentEl.appendChild(projectGroup);
            });
        });
    }

    private createTaskElement(task: QuadrantTask): HTMLElement {
        const taskEl = document.createElement('div');
        taskEl.className = `task-item ${task.completed ? 'completed' : ''}`;
        taskEl.setAttribute('data-task-id', task.id);
        taskEl.setAttribute('draggable', 'true');

        // 设置任务颜色（根据优先级）
        let color = '';
        switch (task.priority) {
            case 'high':
                color = '#e74c3c';
                break;
            case 'medium':
                color = '#f39c12';
                break;
            case 'low':
                color = '#3498db';
                break;
            default:
                color = '#95a5a6';
        }

        taskEl.innerHTML = `
            <div class="task-content">
                <div class="task-checkbox">
                    <input type="checkbox" ${task.completed ? 'checked' : ''}>
                </div>
                <div class="task-info">
                    <div class="task-title" style="border-left-color: ${color}">${this.escapeHtml(task.title)}</div>
                    <div class="task-meta">
                        ${task.date ? `<span class="task-date">📅 ${task.date}</span>` : ''}
                        ${task.time ? `<span class="task-time">🕐 ${task.time}</span>` : ''}
                    </div>
                </div>
            </div>
        `;

        // 添加事件监听
        taskEl.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).type !== 'checkbox') {
                this.handleTaskClick(task);
            }
        });

        taskEl.querySelector('input[type="checkbox"]')!.addEventListener('change', (e) => {
            this.toggleTaskCompletion(task, (e.target as HTMLInputElement).checked);
        });

        // 拖拽事件
        taskEl.addEventListener('dragstart', (e) => {
            e.dataTransfer!.setData('text/plain', task.id);
            taskEl.classList.add('dragging');
        });

        taskEl.addEventListener('dragend', () => {
            taskEl.classList.remove('dragging');
        });

        return taskEl;
    }

    private setupEventListeners() {
        // 拖拽放置区域
        const dropZones = this.container.querySelectorAll('[data-drop-zone="true"]');
        dropZones.forEach(zone => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                zone.classList.add('drag-over');
            });

            zone.addEventListener('dragleave', () => {
                zone.classList.remove('drag-over');
            });

            zone.addEventListener('drop', async (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                
                const taskId = e.dataTransfer!.getData('text/plain');
                const quadrantKey = zone.getAttribute('data-quadrant-content');
                
                if (taskId && quadrantKey) {
                    await this.moveTaskToQuadrant(taskId, quadrantKey as QuadrantTask['quadrant']);
                }
            });
        });

        // 新建任务按钮
        const newTaskButtons = this.container.querySelectorAll('.add-task-btn');
        newTaskButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const quadrant = btn.getAttribute('data-quadrant');
                this.createNewTask(quadrant as QuadrantTask['quadrant']);
            });
        });

        // 日历视图切换按钮
        const switchToCalendarBtn = this.container.querySelector('.switch-to-calendar-btn');
        if (switchToCalendarBtn) {
            switchToCalendarBtn.addEventListener('click', () => {
                this.switchToCalendarView();
            });
        }

        // 监听任务更新事件
        window.addEventListener('reminderUpdated', () => {
            this.refresh();
        });
    }

    private async moveTaskToQuadrant(taskId: string, newQuadrant: QuadrantTask['quadrant']) {
        try {
            const reminderData = await readReminderData();
            
            if (reminderData[taskId]) {
                reminderData[taskId].quadrant = newQuadrant;
                await writeReminderData(reminderData);
                
                await this.refresh();
                showMessage(t('taskMovedToQuadrant'));
            }
        } catch (error) {
            console.error('移动任务失败:', error);
            showMessage(t('moveTaskFailed'));
        }
    }

    private async createNewTask(quadrant: QuadrantTask['quadrant']) {
        const today = getLocalDateString();
        const defaultTask = {
            title: '',
            date: today,
            priority: 'medium',
            quadrant: quadrant
        };

        const dialog = new QuickReminderDialog(today, null, async () => {
            await this.refresh();
        });
        
        // 设置默认象限
        (dialog as any).defaultQuadrant = quadrant;
        dialog.show();
    }

    private async toggleTaskCompletion(task: QuadrantTask, completed: boolean) {
        try {
            const reminderData = await readReminderData();
            
            if (reminderData[task.id]) {
                reminderData[task.id].completed = completed;
                await writeReminderData(reminderData);
                
                await this.refresh();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            }
        } catch (error) {
            console.error('更新任务状态失败:', error);
            showMessage(t('updateTaskStatusFailed'));
        }
    }

    private handleTaskClick(task: QuadrantTask) {
        if (task.blockId) {
            // 打开关联的文档
            const { openBlock } = require('../api');
            openBlock(task.blockId);
        } else {
            // 编辑任务
            const editDialog = new ReminderEditDialog(task.extendedProps, async () => {
                await this.refresh();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            });
            editDialog.show();
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    private addStyles() {
        if (document.querySelector('#eisenhower-matrix-styles')) return;

        const style = document.createElement('style');
        style.id = 'eisenhower-matrix-styles';
        style.textContent = `
            .eisenhower-matrix-view {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                display: flex;
                flex-direction: column;
                background: var(--b3-theme-background);
                color: var(--b3-theme-on-background);
                overflow: hidden;
            }

            .matrix-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px;
                border-bottom: 1px solid var(--b3-theme-border);
                background: var(--b3-theme-background);
                flex-shrink: 0;
            }

            .matrix-header h2 {
                margin: 0;
                font-size: 20px;
                font-weight: 600;
            }

            .switch-to-calendar-btn {
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 4px 8px;
                font-size: 12px;
            }

            .matrix-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                grid-template-rows: 1fr 1fr;
                gap: 2px;
                flex: 1;
                padding: 8px;
                overflow: hidden;
                min-height: 0;
            }

            .quadrant {
                background: var(--b3-theme-surface);
                border: 3px solid;
                border-radius: 8px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                position: relative;
            }

            .quadrant-important-urgent {
                border-color: #e74c3c;
            }

            .quadrant-important-not-urgent {
                border-color: #3498db;
            }

            .quadrant-not-important-urgent {
                border-color: #f39c12;
            }

            .quadrant-not-important-not-urgent {
                border-color: #95a5a6;
            }

            .quadrant-header {
                padding: 8px 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-shrink: 0;
                border-bottom: 1px solid var(--b3-theme-border);
            }

            .quadrant-title {
                font-size: 14px;
                font-weight: 600;
                margin: 0;
            }

            .add-task-btn {
                padding: 4px 8px !important;
                font-size: 12px !important;
                align-self: center;
            }

            .quadrant-content {
                flex: 1;
                padding: 8px;
                overflow-y: auto;
                min-height: 0;
            }

            .quadrant-content[data-drop-zone="true"] {
                transition: background-color 0.2s;
            }

            .quadrant-content.drag-over {
                background-color: var(--b3-theme-primary-lightest) !important;
            }

            .empty-quadrant {
                text-align: center;
                color: var(--b3-theme-on-surface-light);
                font-style: italic;
                padding: 40px 20px;
            }

            .project-group {
                margin-bottom: 16px;
            }

            .project-header {
                font-weight: 600;
                font-size: 14px;
                color: var(--b3-theme-on-surface);
                margin-bottom: 8px;
                padding: 4px 8px;
                background: var(--b3-theme-surface-lighter);
                border-radius: 4px;
            }

            .task-item {
                background: var(--b3-theme-background);
                border: 1px solid var(--b3-theme-border);
                border-radius: 4px;
                margin-bottom: 4px;
                padding: 8px;
                cursor: pointer;
                transition: all 0.2s;
                user-select: none;
            }

            .task-item:hover {
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                transform: translateY(-1px);
            }

            .task-item.dragging {
                opacity: 0.5;
                transform: rotate(5deg);
            }

            .task-item.completed {
                opacity: 0.6;
            }

            .task-item.completed .task-title {
                text-decoration: line-through;
            }

            .task-content {
                display: flex;
                align-items: flex-start;
                gap: 8px;
            }

            .task-checkbox {
                margin-top: 2px;
            }

            .task-info {
                flex: 1;
                min-width: 0;
            }

            .task-title {
                font-size: 14px;
                margin-bottom: 4px;
                border-left: 3px solid;
                padding-left: 8px;
                word-break: break-word;
            }

            .task-meta {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                font-size: 12px;
                color: var(--b3-theme-on-surface-light);
            }

            .task-date, .task-time {
                display: flex;
                align-items: center;
                gap: 2px;
            }

            @media (max-width: 768px) {
                .matrix-grid {
                    grid-template-columns: 1fr;
                    grid-template-rows: repeat(4, 1fr);
                }

                .quadrant-header {
                    padding: 6px 10px;
                }

                .quadrant-title {
                    font-size: 13px;
                }

                .add-task-btn {
                    padding: 2px 6px !important;
                    font-size: 11px !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    async refresh() {
        await this.loadTasks();
        this.renderMatrix();
    }

    destroy() {
        // 清理事件监听器
        window.removeEventListener('reminderUpdated', this.refresh);
        
        // 清理样式
        const style = document.querySelector('#eisenhower-matrix-styles');
        if (style) {
            style.remove();
        }
    }
}