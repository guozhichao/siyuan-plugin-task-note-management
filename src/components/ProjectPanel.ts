import { showMessage, confirm, Menu, openTab, Dialog } from "siyuan";
import { PROJECT_KANBAN_TAB_TYPE } from '../index'
import { PomodoroStatsView } from "./PomodoroStatsView";

// 添加四象限面板常量
const EISENHOWER_TAB_TYPE = "reminder_eisenhower_tab";
import { readProjectData, writeProjectData, getBlockByID, openBlock, readReminderData } from "../api";
import { getLocalDateString, compareDateStrings } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { StatusManager } from "../utils/statusManager";
import { ProjectDialog } from "./ProjectDialog";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { StatusManageDialog } from "./StatusManageDialog";
import { t } from "../utils/i18n";


export class ProjectPanel {
    private container: HTMLElement;
    private projectsContainer: HTMLElement;
    private filterSelect: HTMLSelectElement;
    private categoryFilterSelect: HTMLSelectElement;
    private sortButton: HTMLButtonElement;
    private plugin: any;
    private currentTab: string = 'active';
    private currentCategoryFilter: string = 'all';
    private currentSort: string = 'priority';
    private currentSortOrder: 'asc' | 'desc' = 'desc';
    private categoryManager: CategoryManager;
    private statusManager: StatusManager;
    private projectUpdatedHandler: () => void;
    private reminderUpdatedHandler: () => void;
    // 添加拖拽相关属性
    private isDragging: boolean = false;
    private draggedElement: HTMLElement | null = null;
    private draggedProject: any = null;
    private currentProjectsCache: any[] = [];
    // 保存每个状态分组的折叠状态（key = statusId, value = boolean; true=collapsed）
    private groupCollapsedState: Record<string, boolean> = {};
    // 缓存提醒数据，避免为每个项目重复读取
    private reminderDataCache: any = null;

    constructor(container: HTMLElement, plugin?: any) {
        this.container = container;
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance();
        this.statusManager = StatusManager.getInstance();

        this.projectUpdatedHandler = () => {
            this.loadProjects();
        };

        this.reminderUpdatedHandler = () => {
            // 清空提醒缓存并重新加载计数
            this.reminderDataCache = null;
            // 重新渲染当前已加载的项目计数
            // 如果项目已渲染，则触发一次重新加载以刷新计数显示
            this.loadProjects();
        };

        this.initializeAsync();
    }

    private async initializeAsync() {
        await this.categoryManager.initialize();
        await this.statusManager.initialize();
        this.initUI();
        this.loadProjects();

        // 监听项目更新事件
        window.addEventListener('projectUpdated', this.projectUpdatedHandler);
        // 监听提醒更新事件，更新计数缓存
        window.addEventListener('reminderUpdated', this.reminderUpdatedHandler);
    }

    public destroy() {
        if (this.projectUpdatedHandler) {
            window.removeEventListener('projectUpdated', this.projectUpdatedHandler);
        }
        if (this.reminderUpdatedHandler) {
            window.removeEventListener('reminderUpdated', this.reminderUpdatedHandler);
        }
    }

    private initUI() {
        this.container.classList.add('project-panel');
        this.container.innerHTML = '';

        // 标题部分
        const header = document.createElement('div');
        header.className = 'project-header';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'project-title';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'project-icon';
        iconSpan.textContent = '📁';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = t("projectManagement") || "项目管理";

        titleContainer.appendChild(iconSpan);
        titleContainer.appendChild(titleSpan);

        // 添加右侧按钮容器
        const actionContainer = document.createElement('div');
        actionContainer.className = 'project-panel__actions';
        actionContainer.style.marginLeft = 'auto';

        // 添加创建项目按钮
        const createProjectBtn = document.createElement('button');
        createProjectBtn.className = 'b3-button b3-button--outline';
        createProjectBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>';
        createProjectBtn.title = t("createProject") || "创建项目";
        createProjectBtn.addEventListener('click', () => {
            this.createQuickProject();
        });
        actionContainer.appendChild(createProjectBtn);

        // 添加排序按钮
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'b3-button b3-button--outline';
        this.sortButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        this.sortButton.title = t("sortBy") || "排序";
        this.sortButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showSortMenu(e);
        });
        actionContainer.appendChild(this.sortButton);

        // 添加日历视图按钮
        if (this.plugin) {
            const calendarBtn = document.createElement('button');
            calendarBtn.className = 'b3-button b3-button--outline';
            calendarBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg>';
            calendarBtn.title = t("calendarView") || "日历视图";
            calendarBtn.addEventListener('click', () => {
                this.plugin.openCalendarTab();
            });
            actionContainer.appendChild(calendarBtn);

            // 添加四象限面板按钮（放在日历按钮旁边）
            const eisenhowerBtn = document.createElement('button');
            eisenhowerBtn.className = 'b3-button b3-button--outline';
            eisenhowerBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconGrid"></use></svg>';
            eisenhowerBtn.title = t("eisenhowerMatrix") || "四象限面板";
            eisenhowerBtn.addEventListener('click', () => {
                this.openEisenhowerMatrix();
            });
            actionContainer.appendChild(eisenhowerBtn);

            // 添加番茄钟看板按钮
            const pomodoroStatsBtn = document.createElement('button');
            pomodoroStatsBtn.className = 'b3-button b3-button--outline';
            pomodoroStatsBtn.innerHTML = '🍅';
            pomodoroStatsBtn.title = t("pomodoroStats") || "番茄钟统计";
            pomodoroStatsBtn.addEventListener('click', () => {
                this.showPomodoroStatsView();
            });
            actionContainer.appendChild(pomodoroStatsBtn);
        }

        // 添加更多按钮（放在最右边）
        const moreBtn = document.createElement('button');
        moreBtn.className = 'b3-button b3-button--outline';
        moreBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>';
        moreBtn.title = t("more") || "更多";
        moreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showMoreMenu(e);
        });
        actionContainer.appendChild(moreBtn);

        titleContainer.appendChild(actionContainer);
        header.appendChild(titleContainer);

        // 把按钮容器移到标题下方，确保标题独占一行，按钮右对齐
        const actionRow = document.createElement('div');
        actionRow.className = 'project-header__actions-row';
        // 使用 flex 布局使按钮靠右
        actionRow.style.cssText = `display:flex; justify-content:flex-start; margin-bottom:8px; gap:8px;`;
        // 将 actionContainer 中的按钮移动到 actionRow
        while (actionContainer.firstChild) {
            // 由于 actionContainer 可能包含样式 marginLeft:auto，我们直接把子节点移动
            actionRow.appendChild(actionContainer.firstChild);
        }

        header.appendChild(actionRow);

        // 筛选控件
        const controls = document.createElement('div');
        controls.className = 'project-controls';
        controls.style.cssText = `
            display: flex;
            gap: 8px;
            width: 100%;
        `;

        // 状态筛选
        this.filterSelect = document.createElement('select');
        this.filterSelect.className = 'b3-select';
        this.filterSelect.style.cssText = `
            flex: 1;
            min-width: 0;
        `;
        this.renderStatusFilter();
        this.filterSelect.addEventListener('change', () => {
            this.currentTab = this.filterSelect.value;
            this.loadProjects();
        });
        controls.appendChild(this.filterSelect);

        // 分类筛选
        this.categoryFilterSelect = document.createElement('select');
        this.categoryFilterSelect.className = 'b3-select';
        this.categoryFilterSelect.style.cssText = `
            flex: 1;
            min-width: 0;
        `;
        this.categoryFilterSelect.addEventListener('change', () => {
            this.currentCategoryFilter = this.categoryFilterSelect.value;
            this.loadProjects();
        });
        controls.appendChild(this.categoryFilterSelect);

        header.appendChild(controls);
        this.container.appendChild(header);

        // 项目列表容器
        this.projectsContainer = document.createElement('div');
        this.projectsContainer.className = 'project-list';
        this.container.appendChild(this.projectsContainer);

        // 渲染分类过滤器
        this.renderCategoryFilter();
        this.updateSortButtonTitle();
    }

    private async renderStatusFilter() {
        if (!this.filterSelect) return;

        try {
            const statuses = this.statusManager.getStatuses();

            this.filterSelect.innerHTML = `<option value="all">${t("allProjects") || "全部项目"}</option>`;

            statuses.forEach(status => {
                const optionEl = document.createElement('option');
                optionEl.value = status.id;
                const displayText = status.icon ? `${status.icon} ${status.name}` : status.name;
                optionEl.textContent = displayText;
                optionEl.selected = this.currentTab === status.id;
                this.filterSelect.appendChild(optionEl);
            });

        } catch (error) {
            console.error('渲染状态过滤器失败:', error);
            this.filterSelect.innerHTML = `<option value="all">${t("allProjects") || "全部项目"}</option>`;
        }
    }

    private async renderCategoryFilter() {
        if (!this.categoryFilterSelect) return;

        try {
            const categories = this.categoryManager.getCategories();

            this.categoryFilterSelect.innerHTML = `
                <option value="all" ${this.currentCategoryFilter === 'all' ? 'selected' : ''}>${t("allCategories") || "全部分类"}</option>
                <option value="none" ${this.currentCategoryFilter === 'none' ? 'selected' : ''}>${t("noCategory") || "无分类"}</option>
            `;

            categories.forEach(category => {
                const optionEl = document.createElement('option');
                optionEl.value = category.id;
                const displayText = category.icon ? `${category.icon} ${category.name}` : category.name;
                optionEl.textContent = displayText;
                optionEl.selected = this.currentCategoryFilter === category.id;
                this.categoryFilterSelect.appendChild(optionEl);
            });

        } catch (error) {
            console.error('渲染分类过滤器失败:', error);
            this.categoryFilterSelect.innerHTML = `<option value="all">${t("allCategories") || "全部分类"}</option>`;
        }
    }

    private updateSortButtonTitle() {
        if (this.sortButton) {
            const sortNames = {
                'time': t("sortByTime") || '时间',
                'priority': t("sortByPriority") || '优先级',
                'title': t("sortByTitle") || '标题'
            };
            const orderNames = {
                'asc': t("ascending") || '升序',
                'desc': t("descending") || '降序'
            };
            this.sortButton.title = `${t("sortBy") || "排序"}: ${sortNames[this.currentSort]} (${orderNames[this.currentSortOrder]})`;
        }
    }

    private showSortMenu(event: MouseEvent) {
        try {
            const menu = new Menu("projectSortMenu");

            const sortOptions = [
                { key: 'time', label: t("sortByTime") || '时间', icon: '🕐' },
                { key: 'priority', label: t("sortByPriority") || '优先级', icon: '🎯' },
                { key: 'title', label: t("sortByTitle") || '标题', icon: '📝' }
            ];

            sortOptions.forEach(option => {
                // 升序
                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (${t("ascending") || "升序"}↑)`,
                    current: this.currentSort === option.key && this.currentSortOrder === 'asc',
                    click: () => {
                        this.currentSort = option.key;
                        this.currentSortOrder = 'asc';
                        this.updateSortButtonTitle();
                        this.loadProjects();
                    }
                });

                // 降序
                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (${t("descending") || "降序"}↓)`,
                    current: this.currentSort === option.key && this.currentSortOrder === 'desc',
                    click: () => {
                        this.currentSort = option.key;
                        this.currentSortOrder = 'desc';
                        this.updateSortButtonTitle();
                        this.loadProjects();
                    }
                });
            });

            if (this.sortButton) {
                const rect = this.sortButton.getBoundingClientRect();
                const menuX = rect.left;
                const menuY = rect.bottom + 4;

                const maxX = window.innerWidth - 200;
                const maxY = window.innerHeight - 200;

                menu.open({
                    x: Math.min(menuX, maxX),
                    y: Math.min(menuY, maxY)
                });
            } else {
                menu.open({
                    x: event.clientX,
                    y: event.clientY
                });
            }
        } catch (error) {
            console.error('显示排序菜单失败:', error);
        }
    }

    private async loadProjects() {
        try {
            const projectData = await readProjectData();

            if (!projectData || typeof projectData !== 'object') {
                this.renderProjects([]);
                return;
            }

            // 迁移旧数据：将 archived 字段转换为 status 字段
            let dataChanged = false;
            const projects = Object.values(projectData).filter((project: any) => {
                if (project && typeof project === 'object' && project.id) {
                    // 数据迁移：将旧的 archived 字段转换为新的 status 字段
                    if (!project.status && project.hasOwnProperty('archived')) {
                        project.status = project.archived ? 'archived' : 'active';
                        dataChanged = true;
                    } else if (!project.status) {
                        project.status = 'active';
                        dataChanged = true;
                    }
                    return true;
                }
                return false;
            });

            // 如果有数据迁移，保存更新
            if (dataChanged) {
                await writeProjectData(projectData);
            }

            // 应用分类过滤
            const filteredProjects = this.applyCategoryFilter(projects);

            // 分类项目
            let displayProjects = [];
            if (this.currentTab === 'all') {
                displayProjects = filteredProjects;
            } else {
                displayProjects = filteredProjects.filter((project: any) => project.status === this.currentTab);
            }

            // 应用排序
            this.sortProjects(displayProjects);

            // 预先读取提醒数据缓存，用于计算每个项目的任务计数
            try {
                this.reminderDataCache = await readReminderData();
            } catch (err) {
                console.warn('读取提醒数据失败，计数将异步回退：', err);
                this.reminderDataCache = null;
            }

            // 渲染项目
            this.renderProjects(displayProjects);

        } catch (error) {
            console.error('加载项目失败:', error);
            showMessage("加载项目失败");
        }
    }

    private applyCategoryFilter(projects: any[]): any[] {
        if (this.currentCategoryFilter === 'all') {
            return projects;
        }

        return projects.filter(project => {
            if (this.currentCategoryFilter === 'none') {
                return !project.categoryId;
            }
            return project.categoryId === this.currentCategoryFilter;
        });
    }


    private sortProjects(projects: any[]) {
        const sortType = this.currentSort;
        const sortOrder = this.currentSortOrder;

        projects.sort((a: any, b: any) => {
            let result = 0;

            switch (sortType) {
                case 'time':
                    result = this.compareByTime(a, b);
                    break;
                case 'priority':
                    result = this.compareByPriorityWithManualSort(a, b);
                    break;
                case 'title':
                    result = this.compareByTitle(a, b);
                    break;
                default:
                    result = this.compareByTime(a, b);
            }

            // 优先级排序的结果相反
            if (sortType === 'priority') {
                result = -result;
            }

            return sortOrder === 'desc' ? -result : result;
        });
    }

    // 新增：优先级排序与手动排序结合
    private compareByPriorityWithManualSort(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;

        // 首先按优先级排序
        const priorityDiff = priorityB - priorityA;
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        // 同优先级内按手动排序
        const sortA = a.sort || 0;
        const sortB = b.sort || 0;

        if (sortA !== sortB) {
            return sortA - sortB; // 手动排序值小的在前
        }

        // 如果手动排序值也相同，按时间排序
        return this.compareByTime(a, b);
    }

    private compareByTime(a: any, b: any): number {
        const dateA = a.startDate || a.createdTime || '';
        const dateB = b.startDate || b.createdTime || '';
        return dateA.localeCompare(dateB);
    }

    // ...existing code...

    private compareByTitle(a: any, b: any): number {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        return titleA.localeCompare(titleB, 'zh-CN');
    }

    private renderProjects(projects: any[]) {
        // 如果没有项目则显示空提示
        if (!projects || projects.length === 0) {
            // 当在 "all" 标签下，排除归档后可能为空
            if (this.currentTab === 'all') {
                this.projectsContainer.innerHTML = `<div class="project-empty">${t("noProjects") || '暂无项目'}</div>`;
            } else {
                const status = this.statusManager.getStatusById(this.currentTab);
                const statusName = status ? status.name : t("allProjects");
                const emptyText = t("noProjectsInStatus")?.replace("${status}", statusName) || `暂无“${statusName}”状态的项目`;
                this.projectsContainer.innerHTML = `<div class="project-empty">${emptyText}</div>`;
            }
            // 清空缓存
            this.currentProjectsCache = [];
            return;
        }

        // 缓存当前项目列表
        this.currentProjectsCache = [...projects];

        // 如果 currentTab 为 'all'，则按状态分组并排除 archived
        if (this.currentTab === 'all') {
            // 按状态分组
            const groups: Record<string, any[]> = {};
            projects.forEach(p => {
                const st = p.status || 'active';
                // 跳过归档状态
                if (st === 'archived') return;
                if (!groups[st]) groups[st] = [];
                groups[st].push(p);
            });

            // 清空容器
            this.projectsContainer.innerHTML = '';

            // 获取按状态显示顺序（先使用 statusManager 中的顺序）
            const statuses = this.statusManager.getStatuses();

            // 先渲染非 statusManager 中定义的状态
            const rendered = new Set<string>();

            statuses.forEach(status => {
                const sid = status.id;
                if (groups[sid] && groups[sid].length > 0) {
                    rendered.add(sid);
                    const groupEl = this.createStatusGroupElement(status, groups[sid]);
                    this.projectsContainer.appendChild(groupEl);
                }
            });

            // 剩余自定义状态
            Object.keys(groups).forEach(sid => {
                if (rendered.has(sid)) return;
                const statusInfo = this.statusManager.getStatusById(sid) || { id: sid, name: sid, icon: '' };
                const groupEl = this.createStatusGroupElement(statusInfo, groups[sid]);
                this.projectsContainer.appendChild(groupEl);
            });

            return;
        }

        // 非 'all' 标签，直接渲染列表（同之前逻辑）
        this.projectsContainer.innerHTML = '';
        projects.forEach((project: any) => {
            const projectEl = this.createProjectElement(project);
            this.projectsContainer.appendChild(projectEl);
        });
    }

    private createProjectElement(project: any): HTMLElement {
        const today = getLocalDateString();
        const isOverdue = project.endDate && compareDateStrings(project.endDate, today) < 0;
        const priority = project.priority || 'none';
        const status = project.status || 'active';

        const projectEl = document.createElement('div');
        projectEl.className = `project-item ${isOverdue ? 'project-item--overdue' : ''} project-item--${status} project-priority-${priority}`;

        // 存储项目数据到元素
        projectEl.dataset.projectId = project.id;
        projectEl.dataset.priority = priority;

        // 在优先级排序模式下添加拖拽功能
        if (this.currentSort === 'priority') {
            this.addDragFunctionality(projectEl, project);
        }

        // 添加右键菜单支持
        projectEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showProjectContextMenu(e, project);
        });

         // 添加左键点击事件，点击后打开项目看板
        projectEl.addEventListener('click', (e) => {
            // 防止事件冒泡
            e.stopPropagation();
            // 打开项目看板
            this.openProjectKanban(project);
        });

        const contentEl = document.createElement('div');
        contentEl.className = 'project-item__content';

        // 信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'project-item__info';

        // 标题
        const titleEl = document.createElement('span');
        titleEl.className = 'project-item__title';
        titleEl.textContent = project.title || t("unnamedNote") || '未命名项目';

        if (project.blockId) {
            titleEl.setAttribute('data-type', 'a');
            titleEl.setAttribute('data-href', `siyuan://blocks/${project.blockId}`);
            titleEl.style.cssText = `
                cursor: pointer;
                color: var(--b3-theme-primary);
                text-decoration: underline;
                font-weight: 500;
            `;
            titleEl.addEventListener('click', (e) => {
                e.preventDefault();
                this.openProject(project.blockId);
            });
        } else {
            titleEl.style.cssText = `
                font-weight: 500;
            `;
        }

        // 时间信息容器
        const timeContainer = document.createElement('div');
        timeContainer.className = 'project-item__time-container';
        timeContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 4px;
            flex-wrap: wrap;
        `;

        // 添加倒计时或已开始天数显示 - 只为非已归档的项目显示
        if (status !== 'archived') {
            if (project.endDate) {
                // 有结束日期，显示倒计时
                const countdownEl = this.createCountdownElement(project.endDate, today);
                timeContainer.appendChild(countdownEl);
            } else if (project.startDate) {
                // 只有开始日期，显示已开始天数
                const startedEl = this.createStartedElement(project.startDate, today);
                timeContainer.appendChild(startedEl);
            }
        }

        // 时间信息
        const timeEl = document.createElement('div');
        timeEl.className = 'project-item__time';
        timeEl.textContent = this.formatProjectTime(project.startDate, project.endDate, today);
        timeContainer.appendChild(timeEl);




        // 添加优先级标签
        if (priority !== 'none') {
            const priorityLabel = document.createElement('span');
            priorityLabel.className = `project-priority-label ${priority}`;
            const priorityNames = {
                'high': t("highPriority") || '高优先级',
                'medium': t("mediumPriority") || '中优先级',
                'low': t("lowPriority") || '低优先级'
            };
            priorityLabel.innerHTML = `<div class="priority-dot ${priority}"></div>${priorityNames[priority]}`;
            timeContainer.appendChild(priorityLabel);
        }

        infoEl.appendChild(titleEl);
        infoEl.appendChild(timeContainer);

        // 添加状态标签
        const statusLabel = document.createElement('div');
        statusLabel.className = `project-status-label project-status-${status}`;
        const statusInfo = this.statusManager.getStatusById(status);
        statusLabel.textContent = statusInfo ? `${statusInfo.icon || ''} ${statusInfo.name}` : (t("unknownStatus") || '未知状态');
        infoEl.appendChild(statusLabel);

        // 添加项目下顶级任务计数（todo/doing/done）
        const countsContainer = document.createElement('div');
        countsContainer.className = 'project-item__counts';
        countsContainer.style.cssText = `display:flex; gap:8px; margin-top:6px; align-items:center;`;

        const todoCountEl = document.createElement('span');
        todoCountEl.className = 'project-count project-count--todo';
        todoCountEl.textContent = '待办: ...';
        countsContainer.appendChild(todoCountEl);

        const doingCountEl = document.createElement('span');
        doingCountEl.className = 'project-count project-count--doing';
        doingCountEl.textContent = '进行中: ...';
        countsContainer.appendChild(doingCountEl);

        const doneCountEl = document.createElement('span');
        doneCountEl.className = 'project-count project-count--done';
        doneCountEl.textContent = '已完成: ...';
        countsContainer.appendChild(doneCountEl);

        infoEl.appendChild(countsContainer);

        // 添加项目进度条（参考 ProjectKanbanView 样式）
        const progressWrapper = document.createElement('div');
        progressWrapper.className = 'project-progress-wrapper';
        progressWrapper.style.cssText = `
            margin-top: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        const progressBarOuter = document.createElement('div');
        progressBarOuter.className = 'project-progress-outer';
        progressBarOuter.style.cssText = `
            flex: 1;
            height: 8px;
            background: rgba(0,0,0,0.06);
            border-radius: 6px;
            overflow: hidden;
        `;

        const progressBarInner = document.createElement('div');
        progressBarInner.className = 'project-progress-inner';
        progressBarInner.style.cssText = `
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #28a745, #7bd389);
            border-radius: 6px;
            transition: width 0.3s ease;
        `;

        progressBarOuter.appendChild(progressBarInner);

        const progressText = document.createElement('div');
        progressText.className = 'project-progress-text';
        progressText.style.cssText = `
            font-size: 12px;
            color: var(--b3-theme-on-surface);
            text-align: right;
        `;

        progressWrapper.appendChild(progressBarOuter);
        progressWrapper.appendChild(progressText);

        infoEl.appendChild(progressWrapper);

        // 异步填充计数（使用缓存或实时读取），并同时更新进度条
        this.fillProjectTopLevelCounts(project.id, todoCountEl, doingCountEl, doneCountEl, progressBarInner, progressText).catch(err => {
            console.warn('填充项目任务计数失败:', err);
        });
        // 分类显示
        if (project.categoryId) {
            const category = this.categoryManager.getCategoryById(project.categoryId);
            if (category) {
                const categoryContainer = document.createElement('div');
                categoryContainer.className = 'project-item__category-container';
                categoryContainer.style.cssText = `
                    margin-top: 4px;
                `;

                const categoryEl = document.createElement('div');
                categoryEl.className = 'project-category-tag';
                categoryEl.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 2px 6px;
                    background-color: ${category.color};
                    border: 1px solid ${category.color}40;
                    border-radius: 5px;
                    font-size: 11px;
                    color: #fff;
                `;

                if (category.icon) {
                    const iconSpan = document.createElement('span');
                    iconSpan.textContent = category.icon;
                    iconSpan.style.cssText = `
                        font-size: 12px;
                        line-height: 1;
                    `;
                    categoryEl.appendChild(iconSpan);
                }

                const nameSpan = document.createElement('span');
                nameSpan.textContent = category.name;
                nameSpan.style.cssText = `
                    font-size: 11px;
                    font-weight: 500;
                `;
                categoryEl.appendChild(nameSpan);

                categoryContainer.appendChild(categoryEl);
                infoEl.appendChild(categoryContainer);
            }
        }

        // 描述
        if (project.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'project-item__note';
            noteEl.textContent = project.note;
            infoEl.appendChild(noteEl);
        }

        contentEl.appendChild(infoEl);
        projectEl.appendChild(contentEl);

        return projectEl;
    }

    /**
     * 填充某个项目的顶级任务计数到三个元素
     */
    private async fillProjectTopLevelCounts(projectId: string, todoEl: HTMLElement, doingEl: HTMLElement, doneEl: HTMLElement, progressBarInner?: HTMLElement | null, progressText?: HTMLElement | null) {
        try {
            let reminderData = this.reminderDataCache;
            if (!reminderData) {
                reminderData = await readReminderData();
                this.reminderDataCache = reminderData;
            }

            const counts = this.countTopLevelKanbanStatus(projectId, reminderData);

            todoEl.textContent = `${t("todo") || '待办'}: ${counts.todo}`;
            doingEl.textContent = `${t("doing") || '进行中'}: ${counts.doing}`;
            doneEl.textContent = `${t("done") || '已完成'}: ${counts.done}`;

            // 计算进度： done / (todo + doing + done)
            if (progressBarInner && progressText) {
                const total = counts.todo + counts.doing + counts.done;
                const percent = total === 0 ? 0 : Math.round((counts.done / total) * 100);
                progressBarInner.style.width = `${percent}%`;
                progressText.textContent = `${percent}%`;
            }
        } catch (error) {
            console.error('获取项目顶级任务计数失败:', error);
            todoEl.textContent = `${t("todo") || '待办'}: ?`;
            doingEl.textContent = `${t("doing") || '进行中'}: ?`;
            doneEl.textContent = `${t("done") || '已完成'}: ?`;
            if (progressBarInner && progressText) {
                progressBarInner.style.width = `0%`;
                progressText.textContent = `0%`;
            }
        }
    }

    /**
     * 计算给定项目的顶级任务在 kanbanStatus 上的数量（只计顶级，即没有 parentId）
     */
    private countTopLevelKanbanStatus(projectId: string, reminderData: any): { todo: number; doing: number; done: number } {
        const allReminders = reminderData && typeof reminderData === 'object' ? Object.values(reminderData) : [];
        let todo = 0, doing = 0, done = 0;

        allReminders.forEach((r: any) => {
            if (!r || typeof r !== 'object') return;
            // 仅统计属于该 project 且为顶级任务（parentId 严格为 undefined/null/空字符串认为是顶级）
            const hasParent = r.hasOwnProperty('parentId') && r.parentId !== undefined && r.parentId !== null && String(r.parentId).trim() !== '';
            if (r.projectId === projectId && !hasParent) {
                // 已完成优先判断：completed 字段或 completedTime 存在
                const isCompleted = !!r.completed || (r.completedTime !== undefined && r.completedTime !== null && String(r.completedTime).trim() !== '');
                if (isCompleted) {
                    done += 1;
                    return;
                }

                const status = (r.kanbanStatus || '').toString();
                if (status === 'doing') doing += 1;
                else todo += 1;
            }
        });

        return { todo, doing, done };
    }
    // 新增：添加拖拽功能
    private addDragFunctionality(element: HTMLElement, project: any) {
        element.draggable = true;
        element.style.cursor = 'grab';

        element.addEventListener('dragstart', (e) => {
            this.isDragging = true;
            this.draggedElement = element;
            this.draggedProject = project;
            element.style.opacity = '0.5';
            element.style.cursor = 'grabbing';

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', element.outerHTML);
            }
        });

        element.addEventListener('dragend', () => {
            this.isDragging = false;
            this.draggedElement = null;
            this.draggedProject = null;
            element.style.opacity = '';
            element.style.cursor = 'grab';
        });

        element.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedElement !== element) {
                e.preventDefault();

                const targetProject = this.getProjectFromElement(element);
                // 只允许同优先级内的拖拽
                if (targetProject && this.canDropHere(this.draggedProject, targetProject)) {
                    e.dataTransfer.dropEffect = 'move';
                    this.showDropIndicator(element, e);
                }
            }
        });

        element.addEventListener('drop', (e) => {
            if (this.isDragging && this.draggedElement !== element) {
                e.preventDefault();

                const targetProject = this.getProjectFromElement(element);
                if (targetProject && this.canDropHere(this.draggedProject, targetProject)) {
                    this.handleDrop(this.draggedProject, targetProject, e);
                }
            }
            this.hideDropIndicator();
        });

        element.addEventListener('dragleave', () => {
            this.hideDropIndicator();
        });
    }

    // 新增：从元素获取项目数据
    private getProjectFromElement(element: HTMLElement): any {
        const projectId = element.dataset.projectId;
        if (!projectId) return null;

        // 从当前显示的项目列表中查找
        return this.currentProjectsCache.find(p => p.id === projectId);
    }

    // 新增：检查是否可以放置
    private canDropHere(draggedProject: any, targetProject: any): boolean {
        const draggedPriority = draggedProject.priority || 'none';
        const targetPriority = targetProject.priority || 'none';

        // 只允许同优先级内的拖拽
        return draggedPriority === targetPriority;
    }

    // 新增：显示拖放指示器
    private showDropIndicator(element: HTMLElement, event: DragEvent) {
        this.hideDropIndicator(); // 先清除之前的指示器

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

        if (event.clientY < midpoint) {
            // 插入到目标元素之前
            indicator.style.top = '0';
            element.style.position = 'relative';
            element.insertBefore(indicator, element.firstChild);
        } else {
            // 插入到目标元素之后
            indicator.style.bottom = '0';
            element.style.position = 'relative';
            element.appendChild(indicator);
        }
    }

    // 新增：隐藏拖放指示器
    private hideDropIndicator() {
        const indicators = document.querySelectorAll('.drop-indicator');
        indicators.forEach(indicator => indicator.remove());
    }

    // 新增：处理拖放
    private async handleDrop(draggedProject: any, targetProject: any, event: DragEvent) {
        try {
            const rect = (event.target as HTMLElement).getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = event.clientY < midpoint;

            await this.reorderProjects(draggedProject, targetProject, insertBefore);

            showMessage("排序已更新");
            this.loadProjects(); // 重新加载以应用新排序

        } catch (error) {
            console.error('处理拖放失败:', error);
            showMessage("排序更新失败");
        }
    }

    // 新增：重新排序项目
    private async reorderProjects(draggedProject: any, targetProject: any, insertBefore: boolean) {
        try {
            const projectData = await readProjectData();

            // 获取同优先级的所有项目
            const samePriorityProjects = Object.values(projectData)
                .filter((p: any) => (p.priority || 'none') === (draggedProject.priority || 'none'))
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            // 移除被拖拽的项目
            const filteredProjects = samePriorityProjects.filter((p: any) => p.id !== draggedProject.id);

            // 找到目标位置
            const targetIndex = filteredProjects.findIndex((p: any) => p.id === targetProject.id);
            const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

            // 插入被拖拽的项目
            filteredProjects.splice(insertIndex, 0, draggedProject);

            // 重新分配排序值
            filteredProjects.forEach((project: any, index: number) => {
                if (projectData[project.id]) {
                    projectData[project.id].sort = index * 10; // 使用10的倍数便于后续插入
                    projectData[project.id].updatedTime = new Date().toISOString();
                }
            });

            await writeProjectData(projectData);
            window.dispatchEvent(new CustomEvent('projectUpdated'));

        } catch (error) {
            console.error('重新排序项目失败:', error);
            throw error;
        }
    }

    // 新增：创建倒计时元素
    private createCountdownElement(endDate: string, today: string): HTMLElement {
        const countdownEl = document.createElement('div');
        countdownEl.className = 'project-countdown';

        // 检查是否有结束日期
        if (endDate) {
            // 有结束日期，显示倒计时
            const daysDiff = this.calculateDaysDifference(endDate, today);
            const isOverdue = daysDiff < 0;

            if (isOverdue) {
                const overdueDays = Math.abs(daysDiff);
                countdownEl.style.cssText = `
                    color: var(--b3-font-color1);
                    font-size: 12px;
                    font-weight: 500;
                    background: var(--b3-font-background1);
                    border: 1px solid var(--b3-font-color1);
                    border-radius: 4px;
                    padding: 2px 6px;
                `;
                countdownEl.textContent = t("overdueDays").replace("${days}", overdueDays.toString()) || `已过期${overdueDays}天`;
            } else if (daysDiff === 0) {
                countdownEl.style.cssText = `
                    color: var(--b3-font-color2);
                    font-size: 12px;
                    font-weight: 500;
                    background: var(--b3-font-background2);
                    border: 1px solid var(--b3-font-color2);
                    border-radius: 4px;
                    padding: 2px 6px;
                `;
                countdownEl.textContent = t("dueToday") || '今天截止';
            } else {
                countdownEl.style.cssText = `
                    color: var(--b3-font-color4);
                    font-size: 12px;
                    font-weight: 500;
                    background: var(--b3-font-background4);
                    border: 1px solid var(--b3-font-color4);
                    border-radius: 4px;
                    padding: 2px 6px;
                `;
                countdownEl.textContent = t("daysRemaining").replace("${days}", daysDiff.toString()) || `还剩${daysDiff}天`;
            }
        } else {
            // 没有结束日期，但有开始日期时，显示已开始天数
            // 注意：这里需要从调用处传入 startDate
            countdownEl.style.cssText = `
                color:var(--b3-font-color11);
                font-size: 12px;
                font-weight: 500;
                background: var(--b3-font-background11);
                border: 1px solid rgba(55, 66, 250, 0.3);
                border-radius: 4px;
                padding: 2px 6px;
            `;
            countdownEl.textContent = t("projectStarted") || '项目已开始';
        }

        return countdownEl;
    }

    // 新增：计算日期差值
    private calculateDaysDifference(endDate: string, today: string): number {
        const end = new Date(endDate + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        const diffTime = end.getTime() - todayDate.getTime();
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    private formatProjectTime(startDate: string, endDate?: string, today?: string): string {
        if (!today) {
            today = getLocalDateString();
        }

        let timeStr = '';

        if (startDate) {
            const start = new Date(startDate + 'T00:00:00');
            const startStr = start.toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric'
            });
            timeStr = `📅 ${startStr}`;
        }

        if (endDate) {
            const end = new Date(endDate + 'T00:00:00');
            const endStr = end.toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric'
            });
            timeStr += ` → ${endStr}`;
        }

        return timeStr || '📅 无日期';
    }

    // 新增：创建已开始天数元素
    private createStartedElement(startDate: string, today: string): HTMLElement {
        const startedEl = document.createElement('div');
        startedEl.className = 'project-started';

        const daysDiff = this.calculateDaysDifference(today, startDate);

        if (daysDiff < 0) {
            // 开始日期在未来
            const futureDays = Math.abs(daysDiff);
            startedEl.style.cssText = `
                color:var(--b3-font-color2);
                font-size: 12px;
                font-weight: 500;
                background: var(--b3-font-background2);
                border: 1px solid var(--b3-font-color2);
                border-radius: 4px;
                padding: 2px 6px;
            `;
            startedEl.textContent = t("startInDays").replace("${days}", futureDays.toString()) || `${futureDays}天后开始`;
        } else if (daysDiff === 0) {
            // 今天开始
            startedEl.style.cssText = `
                color:  var(--b3-font-color4);
                font-size: 12px;
                font-weight: 500;
                background: var(--b3-font-background4);
                border: 1px solid var(--b3-font-color4);
                border-radius: 4px;
                padding: 2px 6px;
            `;
            startedEl.textContent = t("startToday") || '今天开始';
        } else {
            // 已经开始
            startedEl.style.cssText = `
                color: var(--b3-font-color11);
                font-size: 12px;
                font-weight: 500;
                background: var(--b3-font-background11);
                border: 1px solid var(--b3-font-color11);
                border-radius: 4px;
                padding: 2px 6px;
            `;
            startedEl.textContent = t("startedDays").replace("${days}", daysDiff.toString()) || `已开始${daysDiff}天`;
        }

        return startedEl;
    }

    private showProjectContextMenu(event: MouseEvent, project: any) {
        const menu = new Menu("projectContextMenu");

        if (project.blockId) {
            // 打开项目看板
            menu.addItem({
                iconHTML: "📋",
                label: "打开项目看板",
                click: () => this.openProjectKanban(project)
            });

            menu.addSeparator();

            // 复制块引用
            menu.addItem({
                iconHTML: "📋",
                label: t("copyBlockRef") || "复制块引用",
                click: () => this.copyProjectRef(project)
            });
        } else {
            // 绑定到块
            menu.addItem({
                iconHTML: "🔗",
                label: t("bindToBlock") || "绑定到块",
                click: () => this.showBindToBlockDialog(project)
            });
        }

        // 编辑项目
        menu.addItem({
            iconHTML: "📝",
            label: t("edit") || "编辑项目",
            click: () => this.editProject(project)
        });

        // 设置优先级子菜单
        const createPriorityMenuItems = () => {
            const priorities = [
                { key: 'high', label: t("highPriority") || '高', icon: '🔴' },
                { key: 'medium', label: t("mediumPriority") || '中', icon: '🟡' },
                { key: 'low', label: t("lowPriority") || '低', icon: '🔵' },
                { key: 'none', label: t("noPriority") || '无', icon: '⚫' }
            ];

            const currentPriority = project.priority || 'none';

            return priorities.map(priority => ({
                iconHTML: priority.icon,
                label: priority.label,
                current: currentPriority === priority.key,
                click: () => {
                    this.setPriority(project.id, priority.key);
                }
            }));
        };

        menu.addItem({
            iconHTML: "🎯",
            label: t("setPriority") || "设置优先级",
            submenu: createPriorityMenuItems()
        });

        // 设置分类子菜单
        const createCategoryMenuItems = () => {
            const categories = this.categoryManager.getCategories();
            const currentCategoryId = project.categoryId;

            const menuItems = [];

            menuItems.push({
                iconHTML: "❌",
                label: t("noCategory") || "无分类",
                current: !currentCategoryId,
                click: () => {
                    this.setCategory(project.id, null);
                }
            });

            categories.forEach(category => {
                menuItems.push({
                    iconHTML: category.icon || "📁",
                    label: category.name,
                    current: currentCategoryId === category.id,
                    click: () => {
                        this.setCategory(project.id, category.id);
                    }
                });
            });

            return menuItems;
        };

        menu.addItem({
            iconHTML: "🏷️",
            label: t("setCategory") || "设置分类",
            submenu: createCategoryMenuItems()
        });

        // 设置状态子菜单
        const createStatusMenuItems = () => {
            const statuses = this.statusManager.getStatuses();
            const currentStatus = project.status || 'active';

            return statuses.map(status => ({
                iconHTML: status.icon || '📝',
                label: status.name,
                current: currentStatus === status.id,
                click: () => {
                    this.setStatus(project.id, status.id);
                }
            }));
        };

        menu.addItem({
            iconHTML: "📊",
            label: t("setStatus") || "设置状态",
            submenu: createStatusMenuItems()
        });

        menu.addSeparator();

        // 删除项目
        menu.addItem({
            iconHTML: "🗑️",
            label: "删除项目",
            click: () => this.deleteProject(project)
        });

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async copyProjectRef(project: any) {
        try {
            const blockId = project.blockId || project.id;
            const title = project.title || t("unnamedNote") || '未命名项目';
            const blockRef = `((${blockId} "${title}"))`;
            await navigator.clipboard.writeText(blockRef);
            showMessage(t("copyBlockRef") + t("success") || "块引用已复制到剪贴板");
        } catch (error) {
            console.error('复制块引失败:', error);
            showMessage(t("copyBlockRef") + t("operationFailed") || "复制块引失败");
        }
    }

    private editProject(project: any) {
        const dialog = new ProjectDialog(project.id);
        dialog.show();
    }

    private async setPriority(projectId: string, priority: string) {
        try {
            const projectData = await readProjectData();
            if (projectData[projectId]) {
                projectData[projectId].priority = priority;
                projectData[projectId].updatedTime = new Date().toISOString();
                await writeProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                this.loadProjects();
                showMessage(t("priorityUpdated") || "优先级更新成功");
            } else {
                showMessage(t("projectNotExist") || "项目不存在");
            }
        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage(t("setPriorityFailed") || "操作失败");
        }
    }

    private async setCategory(projectId: string, categoryId: string | null) {
        try {
            const projectData = await readProjectData();
            if (projectData[projectId]) {
                projectData[projectId].categoryId = categoryId;
                projectData[projectId].updatedTime = new Date().toISOString();
                await writeProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                this.loadProjects();

                const categoryName = categoryId ?
                    this.categoryManager.getCategoryById(categoryId)?.name || t("unknownCategory") || "未知分类" :
                    t("noCategory") || "无分类";
                showMessage(`${t("setCategory") || "已设置分类为"}：${categoryName}`);
            } else {
                showMessage(t("projectNotExist") || "项目不存在");
            }
        } catch (error) {
            console.error('设置分类失败:', error);
            showMessage(t("setCategoryFailed") || "操作失败");
        }
    }

    private async setStatus(projectId: string, status: string) {
        try {
            const projectData = await readProjectData();
            if (projectData[projectId]) {
                projectData[projectId].status = status;
                // 保持向后兼容
                projectData[projectId].archived = status === 'archived';
                projectData[projectId].updatedTime = new Date().toISOString();
                await writeProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                this.loadProjects();

                const statusInfo = this.statusManager.getStatusById(status);
                const statusName = statusInfo ? statusInfo.name : t("unknown");
                showMessage(`${t("setStatus") || "已设置状态为"}：${statusName}`);
            } else {
                showMessage(t("projectNotExist") || "项目不存在");
            }
        } catch (error) {
            console.error('设置状态失败:', error);
            showMessage(t("setStatusFailed") || "操作失败");
        }
    }

    private async deleteProject(project: any) {
        await confirm(
            "删除项目",
            `${t("confirmDelete")?.replace("${title}", project.title) || `确定要删除项目"${project.title}"吗？`}`,
            async () => {
                try {
                    const projectData = await readProjectData();
                    if (projectData[project.id]) {
                        delete projectData[project.id];
                        await writeProjectData(projectData);
                        window.dispatchEvent(new CustomEvent('projectUpdated'));
                        this.loadProjects();
                        showMessage(t("projectDeleted") || "项目删除成功");
                    } else {
                        showMessage(t("projectNotExist") || "项目不存在");
                    }
                } catch (error) {
                    console.error('删除项目失败:', error);
                    showMessage(t("deleteProjectFailed") || "删除项目失败");
                }
            }
        );
    }

    private async openProject(blockId: string) {
        try {

            openBlock(blockId);
        } catch (error) {
            console.error('打开项目失败:', error);
            confirm(
                t("openNoteFailed") || "打开项目失败",
                t("noteBlockDeleted") || "项目文档可能已被删除，是否删除相关的项目记录？",
                async () => {
                    await this.deleteProjectByBlockId(blockId);
                },
                () => {
                    showMessage(t("openNoteFailedDelete") || "打开项目失败");
                }
            );
        }
    }

    private async deleteProjectByBlockId(blockId: string) {
        try {
            const projectData = await readProjectData();
            if (projectData[blockId]) {
                delete projectData[blockId];
                await writeProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                showMessage(t("deletedRelatedReminders") || "相关项目记录已删除");
                this.loadProjects();
            } else {
                showMessage(t("projectNotExist") || "项目记录不存在");
            }
        } catch (error) {
            console.error('删除项目记录失败:', error);
            showMessage(t("deleteProjectFailed") || "删除项目记录失败");
        }
    }

    private showCategoryManageDialog() {
        const categoryDialog = new CategoryManageDialog(() => {
            // 分类更新后重新渲染过滤器和项目列表
            this.renderCategoryFilter();
            this.loadProjects();
            window.dispatchEvent(new CustomEvent('projectUpdated'));
        });
        categoryDialog.show();
    }

    private showStatusManageDialog() {
        const statusDialog = new StatusManageDialog(() => {
            // 状态更新后重新渲染过滤器和项目列表
            this.renderStatusFilter();
            this.loadProjects();
            window.dispatchEvent(new CustomEvent('projectUpdated'));
        });
        statusDialog.show();
    }

    private openProjectKanban(project: any) {
        try {
            // console.log("test")
            // 打开项目看板Tab
            openTab({
                app: this.plugin?.app,
                custom: {
                    icon: "iconProject",
                    title: `${project.title || '项目看板'} - 看板`,
                    data: {
                        projectId: project.id,
                        projectTitle: project.title
                    },
                    id: this.plugin.name + PROJECT_KANBAN_TAB_TYPE,
                }
            });
        } catch (error) {
            console.error('打开项目看板失败:', error);
            showMessage("打开项目看板失败");
        }
    }

    private createQuickProject() {
        const dialog = new ProjectDialog();
        dialog.show();
    }

    private showBindToBlockDialog(project: any) {
        const dialog = new Dialog({
            title: t("bindToBlock"),
            content: `<div class="b3-dialog__content">
                        <input id="blockIdInput" class="b3-text-field fn__block" placeholder="${t("pleaseEnterBlockID") || "请输入块ID"}">
                      </div>
                      <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel">${t("cancel") || "取消"}</button><div class="fn__space"></div>
                        <button class="b3-button b3-button--primary">${t("confirm") || "确定"}</button>
                      </div>`,
            width: "520px",
        });

        const input = dialog.element.querySelector('#blockIdInput') as HTMLInputElement;
        const cancelBtn = dialog.element.querySelector('.b3-button--cancel');
        const confirmBtn = dialog.element.querySelector('.b3-button--primary');

        cancelBtn?.addEventListener('click', () => {
            dialog.destroy();
        });

        if (confirmBtn) {
            confirmBtn.addEventListener('click', async () => {
                const blockId = input.value.trim();
                if (blockId) {
                    try {
                        const targetBlock = await getBlockByID(blockId);
                        if (targetBlock) {
                            await this.bindProjectToBlock(project, blockId);
                            showMessage(t("bindSuccess") || "绑定成功");
                            dialog.destroy();
                        } else {
                            showMessage(t("blockNotFound") || "未找到块");
                        }
                    } catch (error) {
                        showMessage(t("bindFailed") || "绑定失败");
                        console.error(error);
                    }
                }
            });
        }
    }

    private async bindProjectToBlock(project: any, blockId: string) {
        try {
            const projectData = await readProjectData();
            if (projectData[project.id]) {
                projectData[project.id].blockId = blockId;
                await writeProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                this.loadProjects();
            }
        } catch (error) {
            console.error('绑定项目到块失败:', error);
            throw error;
        }
    }

    // 新增：打开四象限面板
    private openEisenhowerMatrix() {
        try {
            if (this.plugin) {
                openTab({
                    app: this.plugin.app,
                    custom: {
                        title: t("eisenhowerMatrix") || "四象限面板",
                        icon: "iconGrid",
                        id: this.plugin.name + EISENHOWER_TAB_TYPE,
                        data: {}
                    }
                });
            } else {
                showMessage("插件实例不可用");
            }
        } catch (error) {
            console.error('打开四象限面板失败:', error);
            showMessage("打开四象限面板失败");
        }
    }

    // 新增：显示更多菜单
    private showMoreMenu(event: MouseEvent) {
        try {
            const menu = new Menu("projectMoreMenu");

            // 添加刷新
            menu.addItem({
                icon: 'iconRefresh',
                label: t("refresh") || "刷新",
                click: () => this.loadProjects()
            });

            // 添加分类管理
            menu.addItem({
                icon: 'iconTags',
                label: t("manageCategories") || "管理分类",
                click: () => {
                    this.showCategoryManageDialog();
                }
            });

            // 添加状态管理
            menu.addItem({
                icon: 'iconSettings',
                label: t("manageStatuses") || "管理状态",
                click: () => {
                    this.showStatusManageDialog();
                }
            });

            // 获取按钮位置并显示菜单
            const target = event.target as HTMLElement;
            const button = target.closest('button');
            if (button) {
                const rect = button.getBoundingClientRect();
                const menuX = rect.left;
                const menuY = rect.bottom + 4;

                const maxX = window.innerWidth - 200;
                const maxY = window.innerHeight - 200;

                menu.open({
                    x: Math.min(menuX, maxX),
                    y: Math.min(menuY, maxY)
                });
            } else {
                menu.open({
                    x: event.clientX,
                    y: event.clientY
                });
            }
        } catch (error) {
            console.error('显示更多菜单失败:', error);
        }
    }

    /**
     * 显示番茄钟统计视图
     */
    private showPomodoroStatsView() {
        try {
            const statsView = new PomodoroStatsView();
            statsView.show();
        } catch (error) {
            console.error('打开番茄钟统计视图失败:', error);
            showMessage("打开番茄钟统计视图失败");
        }
    }

    /**
     * 创建按状态分组的 DOM 元素，包含标题行（支持折叠/展开）和项目列表容器
     */
    private createStatusGroupElement(status: any, projects: any[]): HTMLElement {
        const statusId = status.id || 'unknown';
        const statusName = status.name || statusId;
        const statusIcon = status.icon || '';

        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'project-group';
        groupWrapper.dataset.statusId = statusId;

        const header = document.createElement('div');
        header.className = 'project-group__header';
        // make header sticky so it stays at top while scrolling within the panel
        // compute top offset based on the main header height to avoid overlapping

        header.style.cssText = `display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 6px;   z-index:3; background: var(--b3-surface, #fff); border-bottom: 1px solid rgba(0,0,0,0.04);`;

        const left = document.createElement('div');
        left.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'project-group__icon';
        iconSpan.textContent = statusIcon;
        left.appendChild(iconSpan);

        const titleSpan = document.createElement('span');
        titleSpan.className = 'project-group__title';
        titleSpan.textContent = `${statusName} (${projects.length})`;
        left.appendChild(titleSpan);

        header.appendChild(left);

        const right = document.createElement('div');
        right.style.cssText = 'display:flex; align-items:center; gap:8px;';

        // toggle button as chevron icon on the right
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'b3-button b3-button--tiny b3-button--outline project-group__toggle';
        toggleBtn.title = this.groupCollapsedState[statusId] ? '展开该分组' : '折叠该分组';
        toggleBtn.style.display = 'inline-flex';
        toggleBtn.style.alignItems = 'center';
        toggleBtn.style.justifyContent = 'center';
        toggleBtn.style.width = '28px';
        toggleBtn.style.height = '28px';
        toggleBtn.style.padding = '0';

        toggleBtn.innerHTML = `<svg class="project-group__toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

        // initial rotation based on collapsed state
        const collapsed = !!this.groupCollapsedState[statusId];
        const iconEl = toggleBtn.querySelector('.project-group__toggle-icon') as HTMLElement;
        if (iconEl) iconEl.style.transform = collapsed ? 'rotate(-180deg)' : 'rotate(0deg)';

        right.appendChild(toggleBtn);

        header.appendChild(right);

        groupWrapper.appendChild(header);

        const listContainer = document.createElement('div');
        listContainer.className = 'project-group__list';
        listContainer.style.cssText = 'display:flex; flex-direction:column; gap:6px; padding:6px;';

        // 根据折叠状态决定是否隐藏
        if (collapsed) {
            listContainer.style.display = 'none';
        }

        projects.forEach((project: any) => {
            const projectEl = this.createProjectElement(project);
            listContainer.appendChild(projectEl);
        });

        toggleBtn.addEventListener('click', () => {
            const isCollapsedNow = !!this.groupCollapsedState[statusId];
            this.groupCollapsedState[statusId] = !isCollapsedNow;

            if (this.groupCollapsedState[statusId]) {
                listContainer.style.display = 'none';
                if (iconEl) iconEl.style.transform = 'rotate(-180deg)';
                toggleBtn.title = '展开该分组';
            } else {
                listContainer.style.display = 'flex';
                if (iconEl) iconEl.style.transform = 'rotate(0deg)';
                toggleBtn.title = '折叠该分组';
            }
        });

        groupWrapper.appendChild(listContainer);

        return groupWrapper;
    }
}
