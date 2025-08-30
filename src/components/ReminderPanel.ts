import { showMessage, confirm, Dialog, Menu, openTab } from "siyuan";
import { readReminderData, writeReminderData, sql, updateBlock, getBlockKramdown, getBlockByID, updateBlockReminderBookmark, openBlock, createDocWithMd, renderSprig, readProjectData } from "../api";
import { getLocalDateString, compareDateStrings, getLocalDateTime, getLocalDateTimeString } from "../utils/dateUtils";
import { loadSortConfig, saveSortConfig, getSortMethodName } from "../utils/sortConfig";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { CategoryManager, Category } from "../utils/categoryManager";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { t } from "../utils/i18n";
import { generateRepeatInstances, getRepeatDescription } from "../utils/repeatUtils";
import { PomodoroTimer } from "./PomodoroTimer";
import { PomodoroStatsView } from "./PomodoroStatsView";
import { EisenhowerMatrixView } from "./EisenhowerMatrixView";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { PROJECT_KANBAN_TAB_TYPE } from "../index";

// 添加四象限面板常量
const EISENHOWER_TAB_TYPE = "reminder_eisenhower_tab";

export class ReminderPanel {
    private container: HTMLElement;
    private remindersContainer: HTMLElement;
    private filterSelect: HTMLSelectElement;
    private categoryFilterSelect: HTMLSelectElement; // 添加分类过滤选择器
    private sortButton: HTMLButtonElement;
    private plugin: any;
    private currentTab: string = 'today';
    private currentCategoryFilter: string = 'all'; // 添加当前分类过滤
    private currentSort: string = 'time';
    private currentSortOrder: 'asc' | 'desc' = 'asc';
    private reminderUpdatedHandler: () => void;
    private sortConfigUpdatedHandler: (event: CustomEvent) => void;
    private closeCallback?: () => void;
    private categoryManager: CategoryManager; // 添加分类管理器
    private isDragging: boolean = false;
    private draggedElement: HTMLElement | null = null;
    private draggedReminder: any = null;
    private collapsedTasks: Set<string> = new Set(); // 管理任务的折叠状态
    // 记录用户手动展开的任务（优先于默认折叠）
    private userExpandedTasks: Set<string> = new Set();

    // 添加静态变量来跟踪当前活动的番茄钟
    private static currentPomodoroTimer: PomodoroTimer | null = null;
    private currentRemindersCache: any[] = [];
    private isLoading: boolean = false;
    private loadTimeoutId: number | null = null;

    // 分页相关状态
    private currentPage: number = 1;
    private itemsPerPage: number = 30;
    private isPaginationEnabled: boolean = true; // 是否启用分页
    private totalPages: number = 1;
    private totalItems: number = 0;

    constructor(container: HTMLElement, plugin?: any, closeCallback?: () => void) {
        this.container = container;
        this.plugin = plugin;
        this.closeCallback = closeCallback;
        this.categoryManager = CategoryManager.getInstance(); // 初始化分类管理器

        // 创建事件处理器
        this.reminderUpdatedHandler = () => {
            // 防抖处理，避免短时间内的多次更新
            if (this.loadTimeoutId) {
                clearTimeout(this.loadTimeoutId);
            }
            this.loadTimeoutId = window.setTimeout(() => {
                if (!this.isLoading) {
                    this.loadReminders();
                }
                this.loadTimeoutId = null;
            }, 100);
        };

        this.sortConfigUpdatedHandler = (event: CustomEvent) => {
            const { method, order } = event.detail;
            if (method !== this.currentSort || order !== this.currentSortOrder) {
                this.currentSort = method;
                this.currentSortOrder = order;
                this.updateSortButtonTitle();
                this.loadReminders();
            }
        };

        this.initializeAsync();
    }

    private async initializeAsync() {
        // 初始化分类管理器
        await this.categoryManager.initialize();

        this.initUI();
        this.loadSortConfig();
        this.loadReminders();

        // 确保对话框样式已加载
        this.addReminderDialogStyles();

        // 监听提醒更新事件
        window.addEventListener('reminderUpdated', this.reminderUpdatedHandler);
        // 监听排序配置更新事件
        window.addEventListener('sortConfigUpdated', this.sortConfigUpdatedHandler);
    }

    // 添加销毁方法以清理事件监听器
    public destroy() {
        // 清理定时器
        if (this.loadTimeoutId) {
            clearTimeout(this.loadTimeoutId);
            this.loadTimeoutId = null;
        }

        if (this.reminderUpdatedHandler) {
            window.removeEventListener('reminderUpdated', this.reminderUpdatedHandler);
        }
        if (this.sortConfigUpdatedHandler) {
            window.removeEventListener('sortConfigUpdated', this.sortConfigUpdatedHandler);
        }

        // 清理当前番茄钟实例
        ReminderPanel.clearCurrentPomodoroTimer();
    }

    // 加载排序配置
    private async loadSortConfig() {
        try {
            const config = await loadSortConfig();
            this.currentSort = config.method;
            this.currentSortOrder = config.order;
            this.updateSortButtonTitle();
        } catch (error) {
            console.error('加载排序配置失败:', error);
            this.currentSort = 'time';
            this.currentSortOrder = 'asc';
        }
    }

    private initUI() {
        this.container.classList.add('reminder-panel');
        this.container.innerHTML = '';

        // 标题部分
        const header = document.createElement('div');
        header.className = 'reminder-header';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'reminder-title';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'reminder-icon';
        iconSpan.textContent = '⏰';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = "任务管理";

        titleContainer.appendChild(iconSpan);
        titleContainer.appendChild(titleSpan);

        // 添加右侧按钮容器（单独一行，将在标题下方显示）
        const actionContainer = document.createElement('div');
        actionContainer.className = 'reminder-panel__actions';
        // 在单独一行时使用 flex 右对齐
        actionContainer.style.cssText = 'display:flex; justify-content:flex-start; gap:8px; margin-bottom:8px;';

        // 添加新建任务按钮
        const newTaskBtn = document.createElement('button');
        newTaskBtn.className = 'b3-button b3-button--outline';
        newTaskBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>';
        newTaskBtn.title = t("newTask") || "新建任务";
        newTaskBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showNewTaskDialog();
        });
        actionContainer.appendChild(newTaskBtn);

        // 添加排序按钮
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'b3-button b3-button--outline';
        this.sortButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        this.sortButton.title = t("sortBy");
        this.sortButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showSortMenu(e);
        });
        actionContainer.appendChild(this.sortButton);

        // 添加日历视图按钮和番茄钟统计按钮放在一起
        if (this.plugin) {
            const calendarBtn = document.createElement('button');
            calendarBtn.className = 'b3-button b3-button--outline';
            calendarBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg>';
            calendarBtn.title = t("calendarView");
            calendarBtn.addEventListener('click', () => {
                this.plugin.openCalendarTab();
            });
            actionContainer.appendChild(calendarBtn);

            // 添加四象限面板按钮
            const eisenhowerBtn = document.createElement('button');
            eisenhowerBtn.className = 'b3-button b3-button--outline';
            eisenhowerBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconGrid"></use></svg>';
            eisenhowerBtn.title = t("eisenhowerMatrix") || "四象限面板";
            eisenhowerBtn.addEventListener('click', () => {
                this.openEisenhowerMatrix();
            });
            actionContainer.appendChild(eisenhowerBtn);

            // 添加番茄钟统计按钮
            const pomodoroStatsBtn = document.createElement('button');
            pomodoroStatsBtn.className = 'b3-button b3-button--outline';
            pomodoroStatsBtn.innerHTML = '🍅';
            pomodoroStatsBtn.title = t("pomodoroStats");
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

        // 标题单独一行
        header.appendChild(titleContainer);
        // 按钮单独一行，置于标题下方并右对齐
        header.appendChild(actionContainer);

        // 筛选控件
        const controls = document.createElement('div');
        controls.className = 'reminder-controls';
        controls.style.cssText = `
            display: flex;
            gap: 8px;
            width: 100%;
        `;

        // 时间筛选
        this.filterSelect = document.createElement('select');
        this.filterSelect.className = 'b3-select';
        this.filterSelect.style.cssText = `
            flex: 1;
            min-width: 0;
        `;
        this.filterSelect.innerHTML = `
            <option value="today" selected>${t("todayReminders")}</option>
            <option value="tomorrow">${t("tomorrowReminders")}</option>
            <option value="future7">${t("future7Reminders")}</option>
            <option value="overdue">${t("overdueReminders")}</option>
            <option value="all">${t("past7Reminders")}</option>
            <option value="todayCompleted">${t("todayCompletedReminders")}</option>
            <option value="completed">${t("completedReminders")}</option>
        `;
        this.filterSelect.addEventListener('change', () => {
            this.currentTab = this.filterSelect.value;
            // 切换筛选时清理防抖，清空当前缓存并强制刷新，避免从 "completed" 切换到 "todayCompleted" 时不更新的问题
            if (this.loadTimeoutId) {
                clearTimeout(this.loadTimeoutId);
                this.loadTimeoutId = null;
            }
            this.currentRemindersCache = [];
            // 重置分页状态
            this.currentPage = 1;
            this.totalPages = 1;
            this.totalItems = 0;
            // 强制刷新，允许在 isLoading 为 true 时也能覆盖加载（例如快速切换时）
            this.loadReminders(true);
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
            // 重置分页状态
            this.currentPage = 1;
            this.totalPages = 1;
            this.totalItems = 0;
            this.loadReminders();
        });
        controls.appendChild(this.categoryFilterSelect);

        header.appendChild(controls);
        this.container.appendChild(header);

        // 提醒列表容器
        this.remindersContainer = document.createElement('div');
        this.remindersContainer.className = 'reminder-list';
        // 添加拖拽相关样式
        this.remindersContainer.style.position = 'relative';
        this.container.appendChild(this.remindersContainer);

        // 渲染分类过滤器
        this.renderCategoryFilter();

        // 初始化排序按钮标题
        this.updateSortButtonTitle();
    }
    // 修改排序方法以支持手动排序
    private sortReminders(reminders: any[]) {
        const sortType = this.currentSort;
        const sortOrder = this.currentSortOrder;
        // console.log('应用排序方式:', sortType, sortOrder, '提醒数量:', reminders.length);

        // 特殊处理已完成相关的筛选器
        const isCompletedFilter = this.currentTab === 'completed' || this.currentTab === 'todayCompleted';
        const isPast7Filter = this.currentTab === 'all';

        // 如果当前视图是“今日已完成”或“全部已完成”，始终按完成时间降序显示
        // 不受用户选择的排序方式（如按优先级）影响，也不受升降序切换影响
        if (isCompletedFilter) {
            reminders.sort((a: any, b: any) => {
                // 直接使用 compareByCompletedTime 的结果作为最终排序依据
                // 这确保了无日期但有完成时间的任务不会回退到日期排序
                let result = this.compareByCompletedTime(a, b);



                // compareByCompletedTime 已返回降序的基础结果，直接返回（不再受 sortOrder 影响）
                return result;
            });

            return;
        }

        reminders.sort((a: any, b: any) => {
            let result = 0;

            // 对于"过去七天"筛选器，未完成事项优先显示
            if (isPast7Filter) {
                const aCompleted = a.completed || false;
                const bCompleted = b.completed || false;

                if (aCompleted !== bCompleted) {
                    return aCompleted ? 1 : -1; // 未完成的排在前面
                }
            }

            // 应用用户选择的排序方式
            switch (sortType) {
                case 'time':
                    // 对于已完成相关的筛选器，如果都是已完成状态，优先按完成时间排序
                    if ((isCompletedFilter || (isPast7Filter && a.completed && b.completed)) &&
                        a.completed && b.completed) {
                        result = this.compareByCompletedTime(a, b);
                        // 如果完成时间相同，再按设置时间排序
                        if (result === 0) {
                            result = this.compareByTime(a, b);
                        }
                    } else {
                        result = this.compareByTime(a, b);
                    }
                    break;

                case 'priority':
                    result = this.compareByPriorityWithManualSort(a, b);
                    break;

                case 'title':
                    result = this.compareByTitle(a, b);
                    break;

                default:
                    console.warn('未知的排序类型:', sortType, '默认使用时间排序');
                    result = this.compareByTime(a, b);
            }

            // 在已完成视图中，优先展示子任务（子任务靠前），以满足父未完成时只展示子任务的需求
            if (isCompletedFilter) {
                const aIsChild = !!a.parentId;
                const bIsChild = !!b.parentId;
                if (aIsChild && !bIsChild) return -1; // 子任务在前
                if (!aIsChild && bIsChild) return 1;
            }

            // 优先级升降序的结果相反
            if (sortType === 'priority') {
                result = -result;
            }

            // 应用升降序
            return sortOrder === 'desc' ? -result : result;
        });

        // console.log('排序完成，排序方式:', sortType, sortOrder);
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

    private async renderCategoryFilter() {
        if (!this.categoryFilterSelect) return;

        try {
            const categories = this.categoryManager.getCategories();

            this.categoryFilterSelect.innerHTML = `
                <option value="all" ${this.currentCategoryFilter === 'all' ? 'selected' : ''}>${t("allCategories")}</option>
                <option value="none" ${this.currentCategoryFilter === 'none' ? 'selected' : ''}>${t("noCategory")}</option>
            `;

            categories.forEach(category => {
                const optionEl = document.createElement('option');
                optionEl.value = category.id;
                // 优化：确保emoji和名称都正确显示
                const displayText = category.icon ? `${category.icon} ${category.name}` : category.name;
                optionEl.textContent = displayText;
                optionEl.selected = this.currentCategoryFilter === category.id;
                this.categoryFilterSelect.appendChild(optionEl);
            });

        } catch (error) {
            console.error('渲染分类过滤器失败:', error);
            this.categoryFilterSelect.innerHTML = `<option value="all">${t("allCategories")}</option>`;
        }
    }

    private showCategoryManageDialog() {
        const categoryDialog = new CategoryManageDialog(() => {
            // 分类更新后重新渲染过滤器和提醒列表
            this.renderCategoryFilter();
            this.loadReminders();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        });
        categoryDialog.show();
    }



    // 更新排序按钮的提示文本
    private updateSortButtonTitle() {
        if (this.sortButton) {
            this.sortButton.title = `${t("sortBy")}: ${getSortMethodName(this.currentSort, this.currentSortOrder)}`;
        }
    }




    /**
     * 异步添加文档标题显示
     * @param container 标题容器元素
     * @param docId 文档ID
     */
    private async addDocumentTitle(container: HTMLElement, docId: string) {
        try {
            const docBlock = await getBlockByID(docId);
            if (docBlock && docBlock.content) {
                // 创建文档标题元素
                const docTitleEl = document.createElement('div');
                docTitleEl.className = 'reminder-item__doc-title';
                docTitleEl.style.cssText = `
                    font-size: 11px;
                    color: var(--b3-theme-on-background);
                    margin-bottom: 2px;
                    opacity: 1;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                `;

                // 添加文档图标
                const docIcon = document.createElement('span');
                docIcon.innerHTML = '📄';
                docIcon.style.fontSize = '10px';

                // 创建支持悬浮预览的文档标题链接
                const docTitleLink = document.createElement('span');
                docTitleLink.setAttribute('data-type', 'a');
                docTitleLink.setAttribute('data-href', `siyuan://blocks/${docId}`);
                docTitleLink.textContent = docBlock.content;
                docTitleLink.title = `所属文档: ${docBlock.content}`;
                docTitleLink.style.cssText = `
                    cursor: pointer;
                    color: var(--b3-theme-on-background);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                `;

                // 点击事件：打开文档
                docTitleEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openBlockTab(docId);
                });

                // 鼠标悬停效果
                docTitleLink.addEventListener('mouseenter', () => {
                    docTitleLink.style.color = 'var(--b3-theme-primary)';
                });
                docTitleLink.addEventListener('mouseleave', () => {
                    docTitleLink.style.color = 'var(--b3-theme-on-background)';
                });

                docTitleEl.appendChild(docIcon);
                docTitleEl.appendChild(docTitleLink);

                // 将文档标题插入到容器的最前面
                container.insertBefore(docTitleEl, container.firstChild);
            }
        } catch (error) {
            console.warn('获取文档标题失败:', error);
            // 静默失败，不影响主要功能
        }
    }

    /**
     * 异步添加项目信息显示
     * @param container 信息容器元素
     * @param projectId 项目ID
     */
    private async addProjectInfo(container: HTMLElement, projectId: string) {
        try {
            const projectData = await readProjectData();
            const project = projectData[projectId];

            if (project && project.title) {
                // 创建项目信息元素
                const projectEl = document.createElement('div');
                projectEl.className = 'reminder-item__project';
                projectEl.style.cssText = `
                    font-size: 11px;
                    color: var(--b3-theme-on-background);
                    margin-top: 4px;
                    opacity: 0.8;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                `;

                // 添加项目图标
                const projectIcon = document.createElement('span');
                projectIcon.textContent = '📂';
                projectIcon.style.fontSize = '12px';

                // 创建项目标题链接
                const projectLink = document.createElement('span');
                projectLink.textContent = project.title;
                projectLink.title = `所属项目: ${project.title}`;
                projectLink.style.cssText = `
                    cursor: pointer;
                    color: var(--b3-theme-on-background);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                `;

                // 点击事件：打开项目看板
                projectEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openProjectKanban(projectId);
                });

                // 鼠标悬停效果
                projectLink.addEventListener('mouseenter', () => {
                    projectLink.style.color = 'var(--b3-theme-primary)';
                });
                projectLink.addEventListener('mouseleave', () => {
                    projectLink.style.color = 'var(--b3-theme-on-background)';
                });

                projectEl.appendChild(projectIcon);
                projectEl.appendChild(projectLink);

                // 将项目信息添加到容器底部
                container.appendChild(projectEl);
            }
        } catch (error) {
            console.warn('获取项目信息失败:', error);
            // 静默失败，不影响主要功能
        }
    }



    private applyCategoryFilter(reminders: any[]): any[] {
        if (this.currentCategoryFilter === 'all') {
            return reminders;
        }

        return reminders.filter(reminder => {
            if (this.currentCategoryFilter === 'none') {
                return !reminder.categoryId;
            }
            return reminder.categoryId === this.currentCategoryFilter;
        });
    }


    // 修复排序菜单方法
    private showSortMenu(event: MouseEvent) {
        try {
            const menu = new Menu("reminderSortMenu");

            const sortOptions = [
                { key: 'time', label: t("sortByTime"), icon: '🕐' },
                { key: 'priority', label: t("sortByPriority"), icon: '🎯' },
                { key: 'title', label: t("sortByTitle"), icon: '📝' }
            ];

            sortOptions.forEach(option => {
                // 为每个排序方式添加升序和降序选项
                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (${t("ascending")}↓)`,
                    current: this.currentSort === option.key && this.currentSortOrder === 'asc',
                    click: async () => {
                        try {
                            this.currentSort = option.key;
                            this.currentSortOrder = 'asc';
                            this.updateSortButtonTitle();
                            await saveSortConfig(option.key, 'asc');
                            // 重置分页状态
                            this.currentPage = 1;
                            this.totalPages = 1;
                            this.totalItems = 0;
                            await this.loadReminders();
                            // console.log('排序已更新为:', option.key, 'asc');
                        } catch (error) {
                            console.error('保存排序配置失败:', error);
                            await this.loadReminders();
                        }
                    }
                });

                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (${t("descending")}↑)`,
                    current: this.currentSort === option.key && this.currentSortOrder === 'desc',
                    click: async () => {
                        try {
                            this.currentSort = option.key;
                            this.currentSortOrder = 'desc';
                            this.updateSortButtonTitle();
                            await saveSortConfig(option.key, 'desc');
                            // 重置分页状态
                            this.currentPage = 1;
                            this.totalPages = 1;
                            this.totalItems = 0;
                            await this.loadReminders();
                            // console.log('排序已更新为:', option.key, 'desc');
                        } catch (error) {
                            console.error('保存排序配置失败:', error);
                            await this.loadReminders();
                        }
                    }
                });
            });

            // 使用按钮的位置信息来定位菜单
            if (this.sortButton) {
                const rect = this.sortButton.getBoundingClientRect();
                const menuX = rect.left;
                const menuY = rect.bottom + 4;

                // 确保菜单在可视区域内
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
            const currentName = getSortMethodName(this.currentSort, this.currentSortOrder);
            // console.log(`当前排序方式: ${currentName}`);
        }
    }
    /**
     * 获取给定提醒的所有后代 id（深度优先）
     */
    private getAllDescendantIds(id: string, reminderMap: Map<string, any>): string[] {
        const result: string[] = [];
        const stack = [id];
        const visited = new Set<string>(); // 防止循环引用
        visited.add(id);

        while (stack.length > 0) {
            const curId = stack.pop()!;
            for (const r of reminderMap.values()) {
                if (r.parentId === curId && !visited.has(r.id)) {
                    result.push(r.id);
                    stack.push(r.id);
                    visited.add(r.id);
                }
            }
        }
        return result;
    }

    /**
     * 当父任务完成时，自动完成所有子任务
     * @param parentId 父任务ID
     * @param reminderData 任务数据
     */
    private async completeAllChildTasks(parentId: string, reminderData: any): Promise<void> {
        try {
            // 构建任务映射
            const reminderMap = new Map<string, any>();
            Object.values(reminderData).forEach((reminder: any) => {
                if (reminder && reminder.id) {
                    reminderMap.set(reminder.id, reminder);
                }
            });

            // 获取所有后代任务ID
            const descendantIds = this.getAllDescendantIds(parentId, reminderMap);

            if (descendantIds.length === 0) {
                return; // 没有子任务，直接返回
            }

            const currentTime = getLocalDateTimeString(new Date());
            let completedCount = 0;

            // 自动完成所有子任务
            for (const childId of descendantIds) {
                const childReminder = reminderData[childId];
                if (childReminder && !childReminder.completed) {
                    childReminder.completed = true;
                    childReminder.completedTime = currentTime;
                    completedCount++;

                    // 如果子任务有绑定块，也需要处理任务列表完成
                    if (childReminder.blockId) {
                        try {
                            await updateBlockReminderBookmark(childReminder.blockId);
                            await this.handleTaskListCompletion(childReminder.blockId);
                        } catch (error) {
                            console.warn(`处理子任务 ${childId} 的块更新失败:`, error);
                        }
                    }
                }
            }

            if (completedCount > 0) {
                // console.log(`父任务 ${parentId} 完成时，自动完成了 ${completedCount} 个子任务`);
                showMessage(`已自动完成 ${completedCount} 个子任务`, 2000);

                // 局部更新已完成的子任务的DOM显示（避免刷新整个面板）
                for (const childId of descendantIds) {
                    const childReminder = reminderData[childId];
                    if (childReminder) {
                        // 更新当前缓存并DOM
                        this.updateReminderElement(childId, childReminder);
                    }
                }

                // 更新父任务的进度显示
                this.updateParentProgress(parentId);
            }
        } catch (error) {
            console.error('自动完成子任务失败:', error);
            // 不要阻止父任务的完成，只是记录错误
        }
    }

    /**
     * 局部更新单个提醒的 DOM 显示（如果该提醒当前正在显示）
     * @param reminderId 原始或实例的提醒 id
     * @param updatedReminder 可选，包含最新数据的提醒对象
     * @param instanceDate 可选，对于重复实例传入实例日期
     */
    private updateReminderElement(reminderId: string, updatedReminder?: any, instanceDate?: string) {
        try {
            // 从当前显示的提醒缓存中找到目标提醒
            const displayed = this.getDisplayedReminders();
            const target = displayed.find(r => r.id === reminderId || (r.originalId === reminderId && instanceDate && r.date === instanceDate) || r.id === `${reminderId}_${instanceDate}`);

            if (!target) {
                return; // 目标未在当前面板中显示，无需更新
            }

            // 使用传入的 updatedReminder 更新缓存，并使用最新缓存对象继续后续更新，避免使用已失效的引用
            const cacheIndex = this.currentRemindersCache.findIndex(r => r.id === target.id);
            if (cacheIndex > -1 && updatedReminder) {
                this.currentRemindersCache[cacheIndex] = { ...this.currentRemindersCache[cacheIndex], ...updatedReminder };
            }

            // 重新读取最新的缓存对象（优先使用缓存中的最新条目）
            const latest = cacheIndex > -1 ? this.currentRemindersCache[cacheIndex] : target;

            const el = this.remindersContainer.querySelector(`[data-reminder-id="${latest.id}"]`) as HTMLElement | null;
            if (!el) return;

            // 更新复选框状态
            const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            if (checkbox) {
                let completedVal = false;
                if (updatedReminder && typeof updatedReminder.completed !== 'undefined') {
                    completedVal = !!updatedReminder.completed;
                } else if (updatedReminder && updatedReminder.repeat && updatedReminder.repeat.completedInstances && instanceDate) {
                    completedVal = updatedReminder.repeat.completedInstances.includes(instanceDate);
                } else {
                    completedVal = !!latest.completed;
                }
                checkbox.checked = completedVal;
            }

            // 更新透明度与完成时间显示
            let isCompleted = false;
            if (updatedReminder && typeof updatedReminder.completed !== 'undefined') {
                isCompleted = !!updatedReminder.completed;
            } else {
                isCompleted = !!latest.completed;
            }
            if (isCompleted) {
                el.style.opacity = '0.5';
                // 更新/添加完成时间元素
                const infoEl = el.querySelector('.reminder-item__info') as HTMLElement | null;
                if (infoEl) {
                    // 移除原有完成时间显示
                    const old = infoEl.querySelector('.reminder-item__completed-time');
                    if (old) old.remove();

                    // 获取完成时间：优先使用 updatedReminder 中的记录，其次使用最新缓存对象
                    let completedTimeStr: string | null = null;
                    if (updatedReminder && updatedReminder.completedTime) {
                        completedTimeStr = updatedReminder.completedTime;
                    } else if (latest && latest.completedTime) {
                        completedTimeStr = latest.completedTime;
                    } else {
                        completedTimeStr = this.getCompletedTime(updatedReminder || latest);
                    }
                    if (completedTimeStr) {
                        const completedEl = document.createElement('div');
                        completedEl.className = 'reminder-item__completed-time';
                        completedEl.textContent = `✅ ${this.formatCompletedTime(completedTimeStr)}`;
                        completedEl.style.cssText = 'font-size:12px;  margin-top:6px; opacity:0.95;';
                        infoEl.appendChild(completedEl);
                    }
                }
            } else {
                el.style.opacity = '';
                const infoEl = el.querySelector('.reminder-item__info') as HTMLElement | null;
                if (infoEl) {
                    const old = infoEl.querySelector('.reminder-item__completed-time');
                    if (old) old.remove();
                }
            }

        } catch (error) {
            console.error('局部更新提醒元素失败:', error);
        }
    }

    /**
     * 更新父任务底部的进度条显示（如果父任务当前显示）
     * @param parentId 父任务ID
     */
    private updateParentProgress(parentId: string) {
        try {
            const parentEl = this.remindersContainer.querySelector(`[data-reminder-id="${parentId}"]`) as HTMLElement | null;
            if (!parentEl) return;

            // 计算直接子任务
            const directChildren = this.currentRemindersCache.filter(r => r.parentId === parentId);
            if (!directChildren || directChildren.length === 0) {
                // 移除进度条（如果存在）
                const progressContainer = parentEl.querySelector('.reminder-progress-container');
                if (progressContainer) progressContainer.remove();
                return;
            }

            const completedCount = directChildren.filter(c => c.completed).length;
            const percent = Math.round((completedCount / directChildren.length) * 100);

            let progressContainer = parentEl.querySelector('.reminder-progress-container') as HTMLElement | null;
            if (!progressContainer) {
                // 创建新的进度条结构
                progressContainer = document.createElement('div');
                progressContainer.className = 'reminder-progress-container';

                const progressWrap = document.createElement('div');
                progressWrap.className = 'reminder-progress-wrap';

                const progressBar = document.createElement('div');
                progressBar.className = 'reminder-progress-bar';
                progressBar.style.width = `${percent}%`;

                progressWrap.appendChild(progressBar);

                const percentLabel = document.createElement('div');
                percentLabel.className = 'reminder-progress-text';
                percentLabel.textContent = `${percent}%`;

                progressContainer.appendChild(progressWrap);
                progressContainer.appendChild(percentLabel);

                parentEl.appendChild(progressContainer);
            } else {
                const bar = progressContainer.querySelector('.reminder-progress-bar') as HTMLElement | null;
                const label = progressContainer.querySelector('.reminder-progress-text') as HTMLElement | null;
                if (bar) bar.style.width = `${percent}%`;
                if (label) label.textContent = `${percent}%`;
            }
        } catch (error) {
            console.error('更新父任务进度失败:', error);
        }
    }

    /**
     * 获取给定提醒的所有祖先 id（从直接父到最顶层）
     */
    private getAllAncestorIds(id: string, reminderMap: Map<string, any>): string[] {
        const result: string[] = [];
        let current = reminderMap.get(id);
        // console.log(`获取任务 ${id} 的祖先, 当前任务:`, current);

        while (current && current.parentId) {
            // console.log(`找到父任务: ${current.parentId}`);
            if (result.includes(current.parentId)) {
                // console.log(`检测到循环引用，停止查找`);
                break; // 防止循环引用
            }
            result.push(current.parentId);
            current = reminderMap.get(current.parentId);
            // console.log(`父任务详情:`, current);
        }

        // console.log(`任务 ${id} 的所有祖先:`, result);
        return result;
    }

    /**
     * 从当前缓存获取所有后代 id
     */
    private getDescendantIdsFromCache(parentId: string): string[] {
        const reminderMap = new Map<string, any>();
        this.currentRemindersCache.forEach((r: any) => reminderMap.set(r.id, r));
        return this.getAllDescendantIds(parentId, reminderMap);
    }

    /**
     * 隐藏指定父任务的所有后代 DOM 元素（不刷新数据）
     */
    private hideAllDescendants(parentId: string) {
        try {
            const descendantIds = this.getDescendantIdsFromCache(parentId);
            for (const id of descendantIds) {
                const el = this.remindersContainer.querySelector(`[data-reminder-id="${id}"]`) as HTMLElement | null;
                if (el) el.style.display = 'none';
            }
        } catch (e) {
            console.error('hideAllDescendants failed', e);
        }
    }

    /**
     * 展示指定父任务的直接子项，并递归展示那些用户已手动展开的子树
     */
    private showChildrenRecursively(parentId: string) {
        try {
            const children = this.currentRemindersCache.filter(r => r.parentId === parentId).sort((a, b) => (a.sort || 0) - (b.sort || 0));
            for (const child of children) {
                const el = this.remindersContainer.querySelector(`[data-reminder-id="${child.id}"]`) as HTMLElement | null;
                if (el) el.style.display = '';
                // 如果用户手动展开了该 child，则继续展示其子项
                if (this.userExpandedTasks.has(child.id)) {
                    this.showChildrenRecursively(child.id);
                }
            }
        } catch (e) {
            console.error('showChildrenRecursively failed', e);
        }
    }


    private async loadReminders(force: boolean = false) {
        // 防止重复加载，但当传入 force 时强制重新加载
        if (this.isLoading && !force) {
            // console.log('任务正在加载中，跳过本次加载请求');
            return;
        }

        // 如果强制刷新，重置正在加载标志以允许覆盖进行中的加载
        if (force) {
            this.isLoading = false;
        }

        this.isLoading = true;
        try {
            const reminderData = await readReminderData();
            if (!reminderData || typeof reminderData !== 'object') {
                this.updateReminderCounts(0, 0, 0, 0, 0, 0);
                this.renderReminders([]);
                return;
            }

            const today = getLocalDateString();
            const allRemindersWithInstances = this.generateAllRemindersWithInstances(reminderData, today);

            // 构造 map 便于查找父子关系
            const reminderMap = new Map<string, any>();
            allRemindersWithInstances.forEach(r => reminderMap.set(r.id, r));

            // 1. 应用分类过滤
            const categoryFilteredReminders = this.applyCategoryFilter(allRemindersWithInstances);

            // 2. 根据当前Tab（日期/状态）进行筛选，得到直接匹配的提醒
            const directlyMatchingReminders = this.filterRemindersByTab(categoryFilteredReminders, today);

            // 3. 实现父/子驱动逻辑
            const idsToRender = new Set<string>();

            // 添加所有直接匹配的提醒
            directlyMatchingReminders.forEach(r => idsToRender.add(r.id));

            // 父任务驱动: 如果父任务匹配，其所有后代都应显示
            for (const parent of directlyMatchingReminders) {
                const descendants = this.getAllDescendantIds(parent.id, reminderMap);
                descendants.forEach(id => idsToRender.add(id));
            }

            // 子任务驱动: 如果子任务匹配，其所有祖先都应显示
            // 但是对于已完成的视图（completed / todayCompleted），仅当祖先也已完成时才显示祖先（父任务未完成时只展示子任务）
            const isCompletedView = this.currentTab === 'completed' || this.currentTab === 'todayCompleted';
            for (const child of directlyMatchingReminders) {
                const ancestors = this.getAllAncestorIds(child.id, reminderMap);
                ancestors.forEach(ancestorId => {
                    if (!isCompletedView) {
                        idsToRender.add(ancestorId);
                    } else {
                        const anc = reminderMap.get(ancestorId);
                        // 仅当祖先被标记为完成或其跨天事件在今日被标记为已完成时添加
                        if (anc) {
                            const ancCompleted = !!anc.completed || this.isSpanningEventTodayCompleted(anc);
                            if (ancCompleted) {
                                idsToRender.add(ancestorId);
                            }
                        }
                    }
                });
            }


            // 4. 组装最终要显示的提醒列表（所有被标记为需要渲染的提醒）
            // 修改：从所有提醒中筛选，而不是从分类过滤后的提醒中筛选
            // 这样可以确保祖先任务即使不满足分类筛选也能显示
            let displayReminders = allRemindersWithInstances.filter(r => idsToRender.has(r.id));

            this.sortReminders(displayReminders);
            this.currentRemindersCache = [...displayReminders];

            // 分页逻辑：计算总数和总页数
            this.totalItems = displayReminders.length;
            this.totalPages = Math.ceil(this.totalItems / this.itemsPerPage);

            // 如果启用了分页且有多个页面，则进行分页截断
            let truncatedTotal = 0;
            if (this.isPaginationEnabled && this.totalPages > 1) {
                const startIndex = (this.currentPage - 1) * this.itemsPerPage;
                const endIndex = startIndex + this.itemsPerPage;
                const originalLength = displayReminders.length;

                displayReminders = displayReminders.slice(startIndex, endIndex);
                truncatedTotal = originalLength - displayReminders.length;

                // 更新缓存为当前页的条目
                this.currentRemindersCache = [...displayReminders];
            }

            // 5. 清理之前的内容并渲染新内容
            this.remindersContainer.innerHTML = '';
            const topLevelReminders = displayReminders.filter(r => !r.parentId || !displayReminders.some(p => p.id === r.parentId));

            if (topLevelReminders.length === 0) {
                this.remindersContainer.innerHTML = `<div class="reminder-empty">${t("noReminders")}</div>`;
                return;
            }

            // 现在改为总是渲染子节点 DOM，但根据祖先折叠状态设置 display，这样我们可以通过 DOM 层级局部隐藏/显示
            const renderReminderWithChildren = async (reminder: any, level: number, ancestorHidden: boolean = false) => {
                const reminderEl = await this.createReminderElement(reminder, today, level, displayReminders);
                // 如果任一祖先被折叠，则当前节点初始隐藏
                if (ancestorHidden) {
                    reminderEl.style.display = 'none';
                }
                this.remindersContainer.appendChild(reminderEl);

                // 先计算子任务列表并判断是否存在子任务
                const children = displayReminders
                    .filter(r => r.parentId === reminder.id)
                    .sort((a, b) => (a.sort || 0) - (b.sort || 0)); // 子任务也需要排序
                const hasChildren = children.length > 0;

                // 决定当前任务是否折叠：优先考虑用户手动展开，其次是collapsedTasks集合，
                // 如果都没有，则使用默认行为：父任务默认折叠（如果有子任务）
                let isCollapsed: boolean;
                if (this.userExpandedTasks.has(reminder.id)) {
                    isCollapsed = false;
                } else if (this.collapsedTasks.has(reminder.id)) {
                    isCollapsed = true;
                } else {
                    // 默认：如果为父任务且有子任务，则折叠；否则不折叠
                    isCollapsed = hasChildren;
                }

                // 递归渲染所有子任务，支持任意深度；子项的 ancestorHidden 为 ancestorHidden || isCollapsed
                for (const child of children) {
                    await renderReminderWithChildren(child, level + 1, ancestorHidden || isCollapsed);
                }
            };

            for (const top of topLevelReminders) {
                await renderReminderWithChildren(top, 0);
            }

            // 总是先移除旧的分页控件，确保切换筛选条件时能正确隐藏
            const existingControls = this.container.querySelector('.reminder-pagination-controls');
            if (existingControls) {
                existingControls.remove();
            }

            // 如果有被截断的项，添加分页提示
            if (truncatedTotal > 0 || (this.isPaginationEnabled && this.totalPages > 1)) {
                this.renderPaginationControls(truncatedTotal);
            }

        } catch (error) {
            console.error('加载提醒失败:', error);
            showMessage(t("loadRemindersFailed"));
        } finally {
            this.isLoading = false;
        }
    }
    /**
     * 检查指定任务是否有子任务
     */
    private hasChildren(reminderId: string, reminderData: any): boolean {
        return Object.values(reminderData).some((reminder: any) =>
            reminder && reminder.parentId === reminderId
        );
    }

    private generateAllRemindersWithInstances(reminderData: any, today: string): any[] {
        const reminders = Object.values(reminderData).filter((reminder: any) => {
            const shouldInclude = reminder && typeof reminder === 'object' && reminder.id &&
                (reminder.date || reminder.parentId || this.hasChildren(reminder.id, reminderData) || reminder.completed);

            if (reminder && reminder.id) {
                // console.log(`任务 ${reminder.id} (${reminder.title}):`, {
                //     hasDate: !!reminder.date,
                //     hasParentId: !!reminder.parentId,
                //     hasChildren: this.hasChildren(reminder.id, reminderData),
                //     completed: reminder.completed,
                //     shouldInclude
                // });
            }

            return shouldInclude;
        });

        // console.log(`生成的所有任务数量: ${reminders.length}`);
        const allReminders = [];
        const repeatInstancesMap = new Map();

        reminders.forEach((reminder: any) => {
            allReminders.push(reminder);

            if (reminder.repeat?.enabled) {
                const now = new Date();
                const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const monthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
                const startDate = getLocalDateString(monthStart);
                const endDate = getLocalDateString(monthEnd);

                const repeatInstances = generateRepeatInstances(reminder, startDate, endDate);

                repeatInstances.forEach(instance => {
                    if (instance.date !== reminder.date) {
                        const completedInstances = reminder.repeat?.completedInstances || [];
                        const isInstanceCompleted = completedInstances.includes(instance.date);
                        const instanceModifications = reminder.repeat?.instanceModifications || {};
                        const instanceMod = instanceModifications[instance.date];

                        const instanceReminder = {
                            ...reminder,
                            id: instance.instanceId,
                            date: instance.date,
                            endDate: instance.endDate,
                            time: instance.time,
                            endTime: instance.endTime,
                            isRepeatInstance: true,
                            originalId: instance.originalId,
                            completed: isInstanceCompleted,
                            note: instanceMod?.note || reminder.note
                        };
                        const key = `${reminder.id}_${instance.date}`;
                        if (!repeatInstancesMap.has(key)) {
                            repeatInstancesMap.set(key, instanceReminder);
                        }
                    }
                });
            }
        });

        repeatInstancesMap.forEach(instance => allReminders.push(instance));
        return allReminders;
    }

    private filterRemindersByTab(reminders: any[], today: string): any[] {
        const tomorrow = getLocalDateString(new Date(Date.now() + 86400000));
        const future7Days = getLocalDateString(new Date(Date.now() + 7 * 86400000));
        const sevenDaysAgo = getLocalDateString(new Date(Date.now() - 7 * 86400000));

        const isEffectivelyCompleted = (reminder: any) => {
            // 如果任务已标记为完成，直接返回 true
            if (reminder.completed) return true;

            // 如果是跨天事件且今天在范围内，检查是否今天已完成
            if (reminder.endDate && compareDateStrings(reminder.date, today) <= 0 && compareDateStrings(today, reminder.endDate) <= 0) {
                return this.isSpanningEventTodayCompleted(reminder);
            }

            // 其他情况返回 false
            return false;
        };

        switch (this.currentTab) {
            case 'overdue':
                return reminders.filter(r => !isEffectivelyCompleted(r) && r.date && compareDateStrings(r.endDate || r.date, today) < 0);
            case 'today':
                return reminders.filter(r => {
                    if (isEffectivelyCompleted(r) || !r.date) return false;
                    const startDate = r.date;
                    const endDate = r.endDate || r.date;
                    return (compareDateStrings(startDate, today) <= 0 && compareDateStrings(today, endDate) <= 0) || compareDateStrings(endDate, today) < 0;
                });
            case 'tomorrow':
                return reminders.filter(r => {
                    if (isEffectivelyCompleted(r) || !r.date) return false;
                    const startDate = r.date;
                    const endDate = r.endDate || r.date;
                    return compareDateStrings(startDate, tomorrow) <= 0 && compareDateStrings(tomorrow, endDate) <= 0;
                });
            case 'future7':
                return reminders.filter(r => {
                    if (isEffectivelyCompleted(r) || !r.date) return false;
                    const startDate = r.date;
                    const endDate = r.endDate || r.date;
                    return compareDateStrings(tomorrow, startDate) <= 0 && compareDateStrings(startDate, future7Days) <= 0;
                });
            case 'completed':
                return reminders.filter(r => isEffectivelyCompleted(r));
            case 'todayCompleted':
                return reminders.filter(r => {
                    // 已标记为完成的：如果其日期范围包含今日，或其原始日期是今日，或其完成时间（completedTime）在今日，则视为今日已完成
                    if (r.completed) {
                        try {
                            const completedTime = this.getCompletedTime(r);
                            if (completedTime) {
                                const completedDate = completedTime.split(' ')[0];
                                if (completedDate === today) return true;
                            }
                        } catch (e) {
                            // ignore and fallback to date checks
                        }

                        return (r.endDate && compareDateStrings(r.date, today) <= 0 && compareDateStrings(today, r.endDate) <= 0) || r.date === today;
                    }

                    // 未直接标记为完成的（可能为跨天事件的今日已完成标记）
                    return r.endDate && this.isSpanningEventTodayCompleted(r) && compareDateStrings(r.date, today) <= 0 && compareDateStrings(today, r.endDate) <= 0;
                });
            case 'all': // Past 7 days
                return reminders.filter(r => r.date && compareDateStrings(sevenDaysAgo, r.date) <= 0 && compareDateStrings(r.endDate || r.date, today) < 0);
            default:
                return [];
        }
    }

    /**
     * 检查提醒是否是今天完成的
     * @param reminder 提醒对象
     * @param today 今天的日期字符串
     * @returns 是否是今天完成的
     */
    private isTodayCompleted(reminder: any, today: string): boolean {
        // 已标记为完成的：如果其日期范围包含今日，或其原始日期是今日，或其完成时间（completedTime）在今日，则视为今日已完成
        if (reminder.completed) {
            try {
                const completedTime = this.getCompletedTime(reminder);
                if (completedTime) {
                    const completedDate = completedTime.split(' ')[0];
                    if (completedDate === today) return true;
                }
            } catch (e) {
                // ignore and fallback to date checks
            }

            return (reminder.endDate && compareDateStrings(reminder.date, today) <= 0 && compareDateStrings(today, reminder.endDate) <= 0) || reminder.date === today;
        }

        // 未直接标记为完成的（可能为跨天事件的今日已完成标记）
        return reminder.endDate && this.isSpanningEventTodayCompleted(reminder) && compareDateStrings(reminder.date, today) <= 0 && compareDateStrings(today, reminder.endDate) <= 0;
    }

    /**
     * 检查跨天事件是否已标记"今日已完成"
     * @param reminder 提醒对象
     * @returns 是否已标记今日已完成
     */
    private isSpanningEventTodayCompleted(reminder: any): boolean {
        const today = getLocalDateString();

        if (reminder.isRepeatInstance) {
            // 重复事件实例：检查原始事件的每日完成记录
            const originalReminder = this.getOriginalReminder(reminder.originalId);
            if (originalReminder && originalReminder.dailyCompletions) {
                return originalReminder.dailyCompletions[today] === true;
            }
        } else {
            // 普通事件：检查事件的每日完成记录
            return reminder.dailyCompletions && reminder.dailyCompletions[today] === true;
        }

        return false;
    }

    private renderReminders(reminderData: any) {
        // This function is now largely superseded by the new loadReminders logic.
        // It can be kept as a fallback or for simpler views if needed, but for now, we clear the container if no data.
        if (!reminderData || (Array.isArray(reminderData) && reminderData.length === 0)) {
            const filterNames = {
                'today': t("noTodayReminders"),
                'tomorrow': t("noTomorrowReminders"),
                'future7': t("noFuture7Reminders"),
                'overdue': t("noOverdueReminders"),
                'completed': t("noCompletedReminders"),
                'todayCompleted': "今日暂无已完成任务",
                'all': t("noPast7Reminders")
            };
            this.remindersContainer.innerHTML = `<div class="reminder-empty">${filterNames[this.currentTab] || t("noReminders")}</div>`;
            return;
        }
    }
    private originalRemindersCache: { [id: string]: any } = {};
    private async editOriginalReminder(originalId: string) {
        try {
            const reminderData = await readReminderData();
            const originalReminder = reminderData[originalId];

            if (originalReminder) {
                this.showTimeEditDialog(originalReminder);
            } else {
                showMessage(t("reminderDataNotExist"));
            }
        } catch (error) {
            console.error('获取原始提醒失败:', error);
            showMessage(t("openModifyDialogFailed"));
        }
    }
    /**
     * 获取原始提醒数据（用于重复事件实例）
     */
    private getOriginalReminder(originalId: string): any {
        try {
            // 这里需要从缓存中获取原始提醒数据
            // 为了性能考虑，我们可以在loadReminders时缓存这些数据
            return this.originalRemindersCache?.[originalId] || null;
        } catch (error) {
            console.error('获取原始提醒失败:', error);
            return null;
        }
    }


    // 新增：按完成时间比较
    private compareByCompletedTime(a: any, b: any): number {
        // 获取完成时间
        const completedTimeA = this.getCompletedTime(a);
        const completedTimeB = this.getCompletedTime(b);

        // 如果都有完成时间，按完成时间比较（默认降序：最近完成的在前）
        if (completedTimeA && completedTimeB) {
            const timeA = new Date(completedTimeA).getTime();
            const timeB = new Date(completedTimeB).getTime();
            return timeB - timeA; // 返回基础比较结果，升降序由调用方处理
        }

        // 如果只有一个有完成时间，有完成时间的在前
        if (completedTimeA && !completedTimeB) return -1;
        if (!completedTimeA && completedTimeB) return 1;

        // 如果都没有完成时间，则按以下优先级排序：
        // 1. 有日期的任务优先于无日期的任务
        // 2. 同等情况下，按日期时间排序
        const hasDateA = !!(a.date);
        const hasDateB = !!(b.date);

        if (hasDateA && !hasDateB) return -1; // 有日期的排在前面
        if (!hasDateA && hasDateB) return 1;  // 无日期的排在后面

        // 都有日期或都没有日期的情况下，按日期时间排序
        if (hasDateA && hasDateB) {
            const dateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00')).getTime();
            const dateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00')).getTime();
            return dateA - dateB; // 较早的日期排在前面
        }

        // 都没有日期，按创建时间或其他标识符排序
        // 使用任务ID作为最后排序依据（ID通常包含时间戳）
        return (a.id || '').localeCompare(b.id || '');
    }

    // 新增：获取完成时间的辅助方法
    private getCompletedTime(reminder: any): string | null {
        if (reminder.isRepeatInstance) {
            // 重复事件实例的完成时间
            const originalReminder = this.getOriginalReminder(reminder.originalId);
            if (originalReminder && originalReminder.repeat?.completedTimes) {
                return originalReminder.repeat.completedTimes[reminder.date] || null;
            }
        } else {
            // 普通事件的完成时间
            return reminder.completedTime || null;
        }
        return null;
    }
    // 按时间比较（考虑跨天事件和优先级）
    private compareByTime(a: any, b: any): number {
        const dateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00'));
        const dateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00'));

        // 首先按日期时间排序
        const timeDiff = dateA.getTime() - dateB.getTime();
        if (timeDiff !== 0) {
            return timeDiff;
        }

        // 时间相同时，考虑跨天事件和全天事件的优先级
        const isSpanningA = a.endDate && a.endDate !== a.date;
        const isSpanningB = b.endDate && b.endDate !== b.date;
        const isAllDayA = !a.time;
        const isAllDayB = !b.time;

        // 跨天事件 > 有时间的单日事件 > 全天事件
        if (isSpanningA && !isSpanningB) return -1;
        if (!isSpanningA && isSpanningB) return 1;

        if (!isSpanningA && !isSpanningB) {
            // 都不是跨天事件，有时间的优先于全天事件
            if (!isAllDayA && isAllDayB) return -1;
            if (isAllDayA && !isAllDayB) return 1;
        }

        // 时间相同且类型相同时，按优先级排序
        return this.compareByPriorityValue(a, b);
    }

    // 按优先级比较（优先级相同时按时间）
    private compareByPriority(a: any, b: any): number {
        const priorityDiff = this.compareByPriorityValue(a, b);
        if (priorityDiff !== 0) {
            return priorityDiff;
        }
        // 优先级相同时按时间排序
        return this.compareByTime(a, b);
    }

    // 优先级数值比较
    private compareByPriorityValue(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;
        return priorityB - priorityA; // 高优先级在前
    }

    // 按标题比较
    private compareByTitle(a: any, b: any): number {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        return titleA.localeCompare(titleB, 'zh-CN');
    }

    private async toggleReminder(reminderId: string, completed: boolean, isRepeatInstance?: boolean, instanceDate?: string) {
        try {
            const reminderData = await readReminderData();

            if (isRepeatInstance && instanceDate) {
                // reminderId 是原始提醒的 id
                const originalId = reminderId;
                const original = reminderData[originalId];
                if (!original) return;

                // 初始化结构
                if (!original.repeat) original.repeat = {};
                if (!original.repeat.completedInstances) original.repeat.completedInstances = [];
                if (!original.repeat.completedTimes) original.repeat.completedTimes = {};

                const completedInstances = original.repeat.completedInstances;
                const completedTimes = original.repeat.completedTimes;

                if (completed) {
                    if (!completedInstances.includes(instanceDate)) completedInstances.push(instanceDate);
                    completedTimes[instanceDate] = getLocalDateTimeString(new Date());

                    // 如果需要，自动完成子任务（局部更新内部会处理DOM）
                    await this.completeAllChildTasks(originalId, reminderData);
                } else {
                    const idx = completedInstances.indexOf(instanceDate);
                    if (idx > -1) completedInstances.splice(idx, 1);
                    delete completedTimes[instanceDate];
                }

                await writeReminderData(reminderData);

                // 更新块书签与任务列表状态
                const blockId = original.blockId;
                if (blockId) {
                    await updateBlockReminderBookmark(blockId);
                    if (completed) await this.handleTaskListCompletion(blockId);
                    else await this.handleTaskListCompletionCancel(blockId);
                }

                // 局部更新：更新实例与父任务进度
                this.updateReminderElement(originalId, original, instanceDate);
                if (original.parentId) this.updateParentProgress(original.parentId);

                // 更新徽章
                if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                    this.plugin.updateBadges();
                }

                return;
            }

            // 非重复事件
            const reminder = reminderData[reminderId];
            if (!reminder) return;

            reminder.completed = completed;
            if (completed) {
                reminder.completedTime = getLocalDateTimeString(new Date());
                // 自动完成子任务（局部更新内部会处理DOM）
                await this.completeAllChildTasks(reminderId, reminderData);
            } else {
                delete reminder.completedTime;
            }

            await writeReminderData(reminderData);

            // 更新块书签与任务列表状态
            if (reminder.blockId) {
                await updateBlockReminderBookmark(reminder.blockId);
                if (completed) await this.handleTaskListCompletion(reminder.blockId);
                else await this.handleTaskListCompletionCancel(reminder.blockId);
            }

            // 局部更新：更新当前提醒元素和其父任务进度
            this.updateReminderElement(reminderId, reminder);
            if (reminder.parentId) this.updateParentProgress(reminder.parentId);

            if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                this.plugin.updateBadges();
            }

        } catch (error) {
            console.error('切换提醒状态失败:', error);
            showMessage(t("operationFailed"));
        }
    }
    /**
     * 处理任务列表的自动完成取消功能
     * 当完成时间提醒事项时，检测是否为待办事项列表，如果是则自动打勾
     * @param blockId 块ID
     */
    private async handleTaskListCompletionCancel(blockId: string) {
        try {
            // 1. 检测块是否为待办事项列表
            const isTaskList = await this.isTaskListBlock(blockId);
            if (!isTaskList) {
                return; // 不是待办事项列表，不需要处理
            }

            // 2. 获取块的 kramdown 内容
            const kramdown = (await getBlockKramdown(blockId)).kramdown;
            if (!kramdown) {
                console.warn('无法获取块的 kramdown 内容:', blockId);
                return;
            }
            // 3. 使用正则表达式匹配待办事项格式: ^- {: xxx}[X]
            const taskPattern = /^-\s*\{:[^}]*\}\[X\]/gm;

            // 检查是否包含完成的待办项
            const hasCompletedTasks = taskPattern.test(kramdown);
            if (!hasCompletedTasks) {
                return; // 没有完成的待办项，不需要处理
            }

            // 4. 将 ^- {: xxx}[x] 替换为 ^- {: xxx}[ ]
            // 重置正则表达式的 lastIndex
            taskPattern.lastIndex = 0;
            const updatedKramdown = kramdown.replace(
                /^(-\s*\{:[^}]*\})\[X\]/gm,
                '$1[ ]'
            );


            // 5. 更新块内容
            await this.updateBlockWithKramdown(blockId, updatedKramdown);


        } catch (error) {
            console.error('处理任务列表完成状态失败:', error);
            // 静默处理错误，不影响主要功能
        }
    }
    /**
     * 处理任务列表的自动完成功能
     * 当完成时间提醒事项时，检测是否为待办事项列表，如果是则自动打勾
     * @param blockId 块ID
     */
    private async handleTaskListCompletion(blockId: string) {
        try {
            // 1. 检测块是否为待办事项列表
            const isTaskList = await this.isTaskListBlock(blockId);
            if (!isTaskList) {
                return; // 不是待办事项列表，不需要处理
            }

            // 2. 获取块的 kramdown 内容
            const kramdown = (await getBlockKramdown(blockId)).kramdown;
            if (!kramdown) {
                console.warn('无法获取块的 kramdown 内容:', blockId);
                return;
            }

            // 3. 使用正则表达式匹配待办事项格式: ^- {: xxx}[ ]
            const taskPattern = /^-\s*\{:[^}]*\}\[\s*\]/gm;

            // 检查是否包含未完成的待办项
            const hasUncompletedTasks = taskPattern.test(kramdown);

            if (!hasUncompletedTasks) {
                return; // 没有未完成的待办项，不需要处理
            }

            // 4. 将 ^- {: xxx}[ ] 替换为 ^- {: xxx}[x]
            // 重置正则表达式的 lastIndex
            taskPattern.lastIndex = 0;
            const updatedKramdown = kramdown.replace(
                /^(-\s*\{:[^}]*\})\[\s*\]/gm,
                '$1[X]'
            );


            // 5. 更新块内容
            await this.updateBlockWithKramdown(blockId, updatedKramdown);


        } catch (error) {
            console.error('处理任务列表完成状态失败:', error);
            // 静默处理错误，不影响主要功能
        }
    }
    /**
     * 检测块是否为待办事项列表
     * @param blockId 块ID
     * @returns 是否为待办事项列表
     */
    private async isTaskListBlock(blockId: string): Promise<boolean> {
        try {
            // 使用 SQL 查询检测块类型
            const sqlQuery = `SELECT type, subtype FROM blocks WHERE id = '${blockId}'`;
            const result = await sql(sqlQuery);

            if (result && result.length > 0) {
                const block = result[0];
                // 检查是否为待办事项列表：type='i' and subtype='t'
                return block.type === 'i' && block.subtype === 't';
            }

            return false;
        } catch (error) {
            console.error('检测任务列表块失败:', error);
            return false;
        }
    }

    /**
     * 使用 kramdown 更新块内容
     * @param blockId 块ID
     * @param kramdown kramdown 内容
     */
    private async updateBlockWithKramdown(blockId: string, kramdown: string) {
        try {
            const updateData = {
                dataType: "markdown",
                data: kramdown,
                id: blockId
            };

            // 使用 updateBlock API 更新块
            const response = await fetch('/api/block/updateBlock', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updateData)
            });

            if (!response.ok) {
                throw new Error(`更新块失败: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            if (result.code !== 0) {
                throw new Error(`更新块失败: ${result.msg || '未知错误'}`);
            }

        } catch (error) {
            console.error('更新块内容失败:', error);
            throw error;
        }
    }

    private async openBlockTab(blockId: string) {
        try {
            openBlock(blockId);

        } catch (error) {
            console.error('打开块失败:', error);

            // 询问用户是否删除无效的提醒
            await confirm(
                t("openNoteFailedDelete"),
                t("noteBlockDeleted"),
                async () => {
                    // 查找并删除相关提醒
                    await this.deleteRemindersByBlockId(blockId);
                },
                () => {
                    showMessage(t("openNoteFailed"));
                }
            );
        }
    }

    private formatReminderTime(date: string, time?: string, today?: string, endDate?: string, endTime?: string): string {
        if (!today) {
            today = getLocalDateString();
        }

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = getLocalDateString(tomorrow);

        let dateStr = '';
        if (date === today) {
            dateStr = t("today");
        } else if (date === tomorrowStr) {
            dateStr = t("tomorrow");
        } else if (compareDateStrings(date, today) < 0) {
            // 过期日期也显示为相对时间
            const reminderDate = new Date(date + 'T00:00:00');
            dateStr = reminderDate.toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric'
            });
        } else {
            const reminderDate = new Date(date + 'T00:00:00');
            dateStr = reminderDate.toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric'
            });
        }

        // 处理跨天事件
        if (endDate && endDate !== date) {
            let endDateStr = '';
            if (endDate === today) {
                endDateStr = t("today");
            } else if (endDate === tomorrowStr) {
                endDateStr = t("tomorrow");
            } else if (compareDateStrings(endDate, today) < 0) {
                const endReminderDate = new Date(endDate + 'T00:00:00');
                endDateStr = endReminderDate.toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric'
                });
            } else {
                const endReminderDate = new Date(endDate + 'T00:00:00');
                endDateStr = endReminderDate.toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric'
                });
            }

            // 跨天事件：显示开始日期 开始时间 - 结束日期 结束时间
            const startTimeStr = time ? ` ${time}` : '';
            const endTimeStr = endTime ? ` ${endTime}` : '';
            return `${dateStr}${startTimeStr} → ${endDateStr}${endTimeStr}`;
        }

        // 处理当天时间段事件（有结束时间但没有结束日期）
        if (endTime && endTime !== time) {
            // 当天时间段：显示开始时间 - 结束时间
            const startTimeStr = time || '';
            return `${dateStr} ${startTimeStr} - ${endTime}`;
        }

        return time ? `${dateStr} ${time}` : dateStr;
    }

    private async deleteRemindersByBlockId(blockId: string) {
        try {
            const reminderData = await readReminderData();
            let deletedCount = 0;

            // 找到所有相关的提醒并删除
            Object.keys(reminderData).forEach(reminderId => {
                const reminder = reminderData[reminderId];
                if (reminder && (reminder.blockId === blockId || reminder.id === blockId)) {
                    delete reminderData[reminderId];
                    deletedCount++;
                }
            });

            if (deletedCount > 0) {
                await writeReminderData(reminderData);

                // 更新块的书签状态（应该会移除书签，因为没有提醒了）
                await updateBlockReminderBookmark(blockId);

                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                showMessage(t("deletedRelatedReminders", { count: deletedCount.toString() }));
                this.loadReminders();
            } else {
                showMessage(t("noRelatedReminders"));
            }
        } catch (error) {
            console.error('删除相关提醒失败:', error);
            showMessage(t("deleteRelatedRemindersFailed"));
        }
    }

    private async createReminderElement(reminder: any, today: string, level: number = 0, allVisibleReminders: any[] = []): Promise<HTMLElement> {
        // 改进过期判断逻辑
        let isOverdue = false;
        if (!reminder.completed && reminder.date) {
            if (reminder.endDate) {
                isOverdue = compareDateStrings(reminder.endDate, today) < 0;
            } else {
                isOverdue = compareDateStrings(reminder.date, today) < 0;
            }
        }

        const isSpanningDays = reminder.endDate && reminder.endDate !== reminder.date;
        const priority = reminder.priority || 'none';
        const hasChildren = allVisibleReminders.some(r => r.parentId === reminder.id);
        // 决定当前任务是否折叠：优先考虑用户手动展开，其次是collapsedTasks集合，
        // 如果都没有，则使用默认行为：父任务默认折叠（如果有子任务）
        let isCollapsed: boolean;
        if (this.userExpandedTasks.has(reminder.id)) {
            isCollapsed = false;
        } else if (this.collapsedTasks.has(reminder.id)) {
            isCollapsed = true;
        } else {
            isCollapsed = hasChildren;
        }

        // 计算子任务的层级深度，用于显示层级指示
        let maxChildDepth = 0;
        if (hasChildren) {
            const calculateDepth = (id: string, currentDepth: number): number => {
                const children = allVisibleReminders.filter(r => r.parentId === id);
                if (children.length === 0) return currentDepth;

                let maxDepth = currentDepth;
                for (const child of children) {
                    const childDepth = calculateDepth(child.id, currentDepth + 1);
                    maxDepth = Math.max(maxDepth, childDepth);
                }
                return maxDepth;
            };
            maxChildDepth = calculateDepth(reminder.id, 0);
        }

        const reminderEl = document.createElement('div');
        reminderEl.className = `reminder-item ${isOverdue ? 'reminder-item--overdue' : ''} ${isSpanningDays ? 'reminder-item--spanning' : ''} reminder-priority-${priority}`;

        // 子任务缩进：使用margin-left让整个任务块缩进，包括背景色
        if (level > 0) {
            reminderEl.style.marginLeft = `${level * 20}px`;
            // reminderEl.style.width = `calc(100% - ${level * 20}px)`;
            // 为子任务添加层级数据属性，用于CSS样式
            reminderEl.setAttribute('data-level', level.toString());
        }

        // 为有深层子任务的父任务添加额外的视觉提示
        if (hasChildren && maxChildDepth > 1) {
            reminderEl.setAttribute('data-has-deep-children', maxChildDepth.toString());
            reminderEl.classList.add('reminder-item--has-deep-children');
        }

        // ... 优先级背景色和边框设置 ...
        let backgroundColor = '';
        let borderColor = '';
        switch (priority) {
            case 'high':
                backgroundColor = 'var(--b3-card-error-background)';
                borderColor = 'var(--b3-card-error-color)';
                break;
            case 'medium':
                backgroundColor = 'var(--b3-card-warning-background)';
                borderColor = 'var(--b3-card-warning-color)';
                break;
            case 'low':
                backgroundColor = 'var(--b3-card-info-background)';
                borderColor = 'var(--b3-card-info-color)';
                break;
            default:
                backgroundColor = 'var(--b3-theme-surface-lighter)';
                borderColor = 'var(--b3-theme-surface-lighter)';
        }
        reminderEl.style.backgroundColor = backgroundColor;
        reminderEl.style.border = `2px solid ${borderColor}`;



        reminderEl.dataset.reminderId = reminder.id;
        reminderEl.dataset.priority = priority;

        if (this.currentSort === 'priority') {
            this.addDragFunctionality(reminderEl, reminder);
        }

        reminderEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showReminderContextMenu(e, reminder);
        });

        const contentEl = document.createElement('div');
        contentEl.className = 'reminder-item__content';

        // 折叠按钮和复选框容器
        const leftControls = document.createElement('div');
        leftControls.className = 'reminder-item__left-controls';
        // 复选框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = reminder.completed || false;
        checkbox.addEventListener('change', () => {
            if (reminder.isRepeatInstance) {
                this.toggleReminder(reminder.originalId, checkbox.checked, true, reminder.date);
            } else {
                this.toggleReminder(reminder.id, checkbox.checked);
            }
        });


        leftControls.appendChild(checkbox);
        // 折叠按钮
        if (hasChildren) {
            const collapseBtn = document.createElement('button');
            collapseBtn.className = 'b3-button b3-button--text collapse-btn';
            collapseBtn.innerHTML = isCollapsed ? '<svg><use xlink:href="#iconRight"></use></svg>' : '<svg><use xlink:href="#iconDown"></use></svg>';
            collapseBtn.title = isCollapsed ? t("expand") : t("collapse");
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();

                // 切换折叠状态并仅在 DOM 上操作，避免重新渲染整个面板
                if (this.userExpandedTasks.has(reminder.id)) {
                    // 已由用户展开 -> 切换为折叠
                    this.userExpandedTasks.delete(reminder.id);
                    this.collapsedTasks.add(reminder.id);
                    // 隐藏后代
                    this.hideAllDescendants(reminder.id);
                    // 更新按钮图标与标题
                    collapseBtn.innerHTML = '<svg><use xlink:href="#iconRight"></use></svg>';
                    collapseBtn.title = t("expand");
                } else if (this.collapsedTasks.has(reminder.id)) {
                    // 当前是折叠 -> 展开
                    this.collapsedTasks.delete(reminder.id);
                    this.userExpandedTasks.add(reminder.id);
                    this.showChildrenRecursively(reminder.id);
                    collapseBtn.innerHTML = '<svg><use xlink:href="#iconDown"></use></svg>';
                    collapseBtn.title = t("collapse");
                } else {
                    // 两者都没有：依据默认（父默认折叠）决定切换方向
                    if (hasChildren) {
                        // 默认折叠 -> 展开
                        this.userExpandedTasks.add(reminder.id);
                        this.showChildrenRecursively(reminder.id);
                        collapseBtn.innerHTML = '<svg><use xlink:href="#iconDown"></use></svg>';
                        collapseBtn.title = t("collapse");
                    } else {
                        // 无子节点，标记为折叠是一种罕见情况，仅更新集合
                        this.collapsedTasks.add(reminder.id);
                        collapseBtn.innerHTML = '<svg><use xlink:href="#iconRight"></use></svg>';
                        collapseBtn.title = t("expand");
                    }
                }
            });
            leftControls.appendChild(collapseBtn);
        } else {
            // 占位符以对齐
            const spacer = document.createElement('div');
            spacer.className = 'collapse-spacer';
            leftControls.appendChild(spacer);
        }


        // 信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'reminder-item__info';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'reminder-item__title-container';

        if (reminder.docId && reminder.blockId !== reminder.docId) {
            this.addDocumentTitle(titleContainer, reminder.docId);
        }

        const titleEl = document.createElement('span');
        titleEl.className = 'reminder-item__title';

        if (reminder.blockId) {
            titleEl.setAttribute('data-type', 'a');
            titleEl.setAttribute('data-href', `siyuan://blocks/${reminder.blockId}`);
            titleEl.style.cssText = `cursor: pointer; color: var(--b3-theme-primary); text-decoration: underline; text-decoration-style: dotted; font-weight: 500;`;
            titleEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openBlockTab(reminder.blockId);
            });
        } else {
            titleEl.style.cssText = `font-weight: 500; color: var(--b3-theme-on-surface);`;
        }

        titleEl.textContent = reminder.title || t("unnamedNote");
        titleEl.title = reminder.blockId ? `点击打开绑定块: ${reminder.title || t("unnamedNote")}` : (reminder.title || t("unnamedNote"));
        titleContainer.appendChild(titleEl);

        const timeContainer = document.createElement('div');
        timeContainer.className = 'reminder-item__time-container';
        timeContainer.style.cssText = `display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap;`;

        if (reminder.repeat?.enabled || reminder.isRepeatInstance) {
            const repeatIcon = document.createElement('span');
            repeatIcon.className = 'reminder-repeat-icon';
            repeatIcon.textContent = '🔄';
            repeatIcon.title = reminder.repeat?.enabled ? getRepeatDescription(reminder.repeat) : t("repeatInstance");
            timeContainer.appendChild(repeatIcon);
        }

        // 只显示有日期的任务的时间信息
        if (reminder.date) {
            const timeEl = document.createElement('div');
            timeEl.className = 'reminder-item__time';
            const timeText = this.formatReminderTime(reminder.date, reminder.time, today, reminder.endDate, reminder.endTime);
            timeEl.textContent = '🕐' + timeText;
            timeEl.style.cursor = 'pointer';
            timeEl.title = t("clickToModifyTime");
            timeEl.addEventListener('click', (e) => {
                e.stopPropagation();
                if (reminder.isRepeatInstance) {
                    this.editOriginalReminder(reminder.originalId);
                } else {
                    this.showTimeEditDialog(reminder);
                }
            });
            timeContainer.appendChild(timeEl);

            const countdownEl = this.createReminderCountdownElement(reminder, today);
            if (countdownEl) {
                timeContainer.appendChild(countdownEl);
            }
        }

        // 添加番茄钟计数显示
        const pomodoroCount = await this.getReminderPomodoroCount(reminder.id);
        if (pomodoroCount && pomodoroCount > 0) {
            const pomodoroDisplay = document.createElement('div');
            pomodoroDisplay.className = 'reminder-item__pomodoro-count';
            pomodoroDisplay.style.cssText = `
                font-size: 12px;
                display: inline-flex;
                align-items: center;
                gap: 2px;
                margin-top: 4px;
            `;

            const tomatoEmojis = '🍅'.repeat(Math.min(pomodoroCount, 5));
            const extraCount = pomodoroCount > 5 ? `+${pomodoroCount - 5}` : '';

            pomodoroDisplay.innerHTML = `
                <span title="完成的番茄钟数量: ${pomodoroCount}">${tomatoEmojis}${extraCount}</span>
            `;

            timeContainer.appendChild(pomodoroDisplay);
        }

        // ... 优先级标签、完成时间、分类、番茄钟等 ...
        // (The rest of the element creation logic remains the same)
        infoEl.appendChild(titleContainer);
        infoEl.appendChild(timeContainer);

        // 已完成任务显示透明度并显示完成时间
        if (reminder.completed) {
            // 设置整体透明度为 0.5
            try {
                reminderEl.style.opacity = '0.5';
            } catch (e) {
                // ignore style errors
            }

            // 获取完成时间（支持重复实例）并显示
            const completedTimeStr = this.getCompletedTime(reminder);
            if (completedTimeStr) {
                const completedEl = document.createElement('div');
                completedEl.className = 'reminder-item__completed-time';
                completedEl.textContent = `✅ ${this.formatCompletedTime(completedTimeStr)}`;
                completedEl.style.cssText = 'font-size:12px;  margin-top:6px; opacity:0.95;';
                infoEl.appendChild(completedEl);
            }
        }

        if (reminder.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-item__note';
            noteEl.textContent = reminder.note;
            infoEl.appendChild(noteEl);
        }

        // 添加项目信息显示
        if (reminder.projectId) {
            await this.addProjectInfo(infoEl, reminder.projectId);
        }

        contentEl.appendChild(leftControls);
        contentEl.appendChild(infoEl);
        reminderEl.appendChild(contentEl);

        // 如果为父任务，计算直接子任务完成进度并在底部显示进度条
        if (hasChildren) {
            const directChildren = allVisibleReminders.filter(r => r.parentId === reminder.id);
            const completedCount = directChildren.filter(c => c.completed).length;
            const percent = Math.round((completedCount / directChildren.length) * 100);

            const progressContainer = document.createElement('div');
            progressContainer.className = 'reminder-progress-container';

            const progressWrap = document.createElement('div');
            progressWrap.className = 'reminder-progress-wrap';

            const progressBar = document.createElement('div');
            progressBar.className = 'reminder-progress-bar';
            progressBar.style.width = `${percent}%`;

            progressWrap.appendChild(progressBar);

            const percentLabel = document.createElement('div');
            percentLabel.className = 'reminder-progress-text';
            percentLabel.textContent = `${percent}%`;

            progressContainer.appendChild(progressWrap);
            progressContainer.appendChild(percentLabel);

            reminderEl.appendChild(progressContainer);
        }

        return reminderEl;
    }
    // 新增：添加拖拽功能
    private addDragFunctionality(element: HTMLElement, reminder: any) {
        element.draggable = true;
        element.style.cursor = 'grab';

        element.addEventListener('dragstart', (e) => {
            this.isDragging = true;
            this.draggedElement = element;
            this.draggedReminder = reminder;
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
            this.draggedReminder = null;
            element.style.opacity = '';
            element.style.cursor = 'grab';
        });

        element.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedElement !== element) {
                e.preventDefault();

                const targetReminder = this.getReminderFromElement(element);
                // 只允许同优先级内的拖拽
                if (targetReminder && this.canDropHere(this.draggedReminder, targetReminder)) {
                    e.dataTransfer.dropEffect = 'move';
                    this.showDropIndicator(element, e);
                }
            }
        });

        element.addEventListener('drop', (e) => {
            if (this.isDragging && this.draggedElement !== element) {
                e.preventDefault();

                const targetReminder = this.getReminderFromElement(element);
                if (targetReminder && this.canDropHere(this.draggedReminder, targetReminder)) {
                    this.handleDrop(this.draggedReminder, targetReminder, e);
                }
            }
            this.hideDropIndicator();
        });

        element.addEventListener('dragleave', () => {
            this.hideDropIndicator();
        });
    }

    // 新增：创建提醒倒计时元素 - 改进以支持过期显示
    private createReminderCountdownElement(reminder: any, today: string): HTMLElement | null {
        // 判断提醒的目标日期
        let targetDate: string;
        let isOverdueEvent = false;

        if (reminder.endDate && reminder.endDate !== reminder.date) {
            // 跨天事件：检查今天是否在事件范围内
            const isInRange = compareDateStrings(reminder.date, today) <= 0 &&
                compareDateStrings(today, reminder.endDate) <= 0;

            if (isInRange) {
                // 今天在事件范围内，显示到结束日期的倒计时
                targetDate = reminder.endDate;
            } else if (compareDateStrings(reminder.date, today) > 0) {
                // 事件还未开始，显示到开始日期的倒计时
                targetDate = reminder.date;
            } else {
                // 事件已结束，显示过期天数（仅对未完成事件）
                if (!reminder.completed) {
                    targetDate = reminder.endDate;
                    isOverdueEvent = true;
                } else {
                    return null;
                }
            }
        } else {
            // 单日事件
            if (compareDateStrings(reminder.date, today) > 0) {
                // 未来日期，显示倒计时
                targetDate = reminder.date;
            } else if (compareDateStrings(reminder.date, today) < 0) {
                // 过去日期，显示过期天数（仅对未完成事件）
                if (!reminder.completed) {
                    targetDate = reminder.date;
                    isOverdueEvent = true;
                } else {
                    return null;
                }
            } else {
                // 今天的事件，不显示倒计时
                return null;
            }
        }

        const daysDiff = this.calculateReminderDaysDifference(targetDate, today);

        // 对于未来事件，daysDiff > 0；对于过期事件，daysDiff < 0
        if (daysDiff === 0) {
            return null;
        }

        const countdownEl = document.createElement('div');
        countdownEl.className = 'reminder-countdown';

        // 根据是否过期设置不同的样式和文本
        if (isOverdueEvent || daysDiff < 0) {
            // 过期事件：红色样式
            countdownEl.style.cssText = `
                color: var(--b3-font-color1);
                font-size: 12px;
                font-weight: 500;
                background: var(--b3-font-background1);
                border: 1px solid var(--b3-font-color1);
                border-radius: 4px;
                padding: 2px 6px;
                flex-shrink: 0;
            `;

            const overdueDays = Math.abs(daysDiff);
            countdownEl.textContent = overdueDays === 1 ?
                t("overdueBySingleDay") :
                t("overdueByDays", { days: overdueDays.toString() });
        } else {
            // 未来事件：绿色样式
            countdownEl.style.cssText = `
                color: var(--b3-font-color4);
                font-size: 12px;
                font-weight: 500;
                background: var(--b3-font-background4);
                border: 1px solid var(--b3-font-color4);
                border-radius: 4px;
                padding: 2px 6px;
                flex-shrink: 0;
            `;

            // 根据是否为跨天事件显示不同的文案
            if (reminder.endDate && reminder.endDate !== reminder.date) {
                const isInRange = compareDateStrings(reminder.date, today) <= 0 &&
                    compareDateStrings(today, reminder.endDate) <= 0;

                if (isInRange) {
                    countdownEl.textContent = daysDiff === 1 ?
                        "还剩1天" :
                        `还剩${daysDiff}天`;
                } else {
                    countdownEl.textContent = daysDiff === 1 ?
                        "还有1天开始" :
                        `还有${daysDiff}天开始`;
                }
            } else {
                countdownEl.textContent = daysDiff === 1 ?
                    t("daysLeftSingle") :
                    t("daysLeftPlural", { days: daysDiff.toString() });
            }
        }

        return countdownEl;
    }

    // 新增：计算提醒日期差值 - 改进以支持负值（过期天数）
    private calculateReminderDaysDifference(targetDate: string, today: string): number {
        const target = new Date(targetDate + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        const diffTime = target.getTime() - todayDate.getTime();
        // 返回实际天数差值，负数表示过期，正数表示未来
        return Math.round(diffTime / (1000 * 60 * 60 * 24));
    }


    // 新增：从元素获取提醒数据
    private getReminderFromElement(element: HTMLElement): any {
        const reminderId = element.dataset.reminderId;
        if (!reminderId) return null;

        // 从当前显示的提醒列表中查找
        const displayedReminders = this.getDisplayedReminders();
        return displayedReminders.find(r => r.id === reminderId);
    }

    // 新增：获取当前显示的提醒列表
    private getDisplayedReminders(): any[] {
        const reminderElements = Array.from(this.remindersContainer.querySelectorAll('.reminder-item'));
        return reminderElements.map(el => {
            const reminderId = (el as HTMLElement).dataset.reminderId;
            return this.currentRemindersCache.find(r => r.id === reminderId);
        }).filter(Boolean);
    }

    // 新增：检查是否可以放置
    private canDropHere(draggedReminder: any, targetReminder: any): boolean {
        const draggedPriority = draggedReminder.priority || 'none';
        const targetPriority = targetReminder.priority || 'none';

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
    private async handleDrop(draggedReminder: any, targetReminder: any, event: DragEvent) {
        try {
            const rect = (event.target as HTMLElement).getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = event.clientY < midpoint;

            await this.reorderReminders(draggedReminder, targetReminder, insertBefore);

            showMessage("排序已更新");
            this.loadReminders(); // 重新加载以应用新排序

        } catch (error) {
            console.error('处理拖放失败:', error);
            showMessage("排序更新失败");
        }
    }

    // 新增：重新排序提醒
    private async reorderReminders(draggedReminder: any, targetReminder: any, insertBefore: boolean) {
        try {
            const reminderData = await readReminderData();

            // 获取同优先级的所有提醒
            const samePriorityReminders = Object.values(reminderData)
                .filter((r: any) => (r.priority || 'none') === (draggedReminder.priority || 'none'))
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            // 移除被拖拽的提醒
            const filteredReminders = samePriorityReminders.filter((r: any) => r.id !== draggedReminder.id);

            // 找到目标位置
            const targetIndex = filteredReminders.findIndex((r: any) => r.id === targetReminder.id);
            const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

            // 插入被拖拽的提醒
            filteredReminders.splice(insertIndex, 0, draggedReminder);

            // 重新分配排序值
            filteredReminders.forEach((reminder: any, index: number) => {
                if (reminderData[reminder.id]) {
                    reminderData[reminder.id].sort = index * 10; // 使用10的倍数便于后续插入
                }
            });

            await writeReminderData(reminderData);
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('重新排序提醒失败:', error);
            throw error;
        }
    }

    /**
     * 格式化完成时间显示
     * @param completedTime 完成时间字符串
     * @returns 格式化的时间显示
     */
    private formatCompletedTime(completedTime: string): string {
        try {
            const today = getLocalDateString();
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = getLocalDateString(yesterday);

            // 解析完成时间
            const completedDate = new Date(completedTime);
            const completedDateStr = getLocalDateString(completedDate);

            const timeStr = completedDate.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
            });

            if (completedDateStr === today) {
                return `今天 ${timeStr}`;
            } else if (completedDateStr === yesterdayStr) {
                return `昨天 ${timeStr}`;
            } else {
                const dateStr = completedDate.toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric'
                });
                return `${dateStr} ${timeStr}`;
            }
        } catch (error) {
            console.error('格式化完成时间失败:', error);
            return completedTime;
        }
    }

    private showReminderContextMenu(event: MouseEvent, reminder: any) {
        const menu = new Menu("reminderContextMenu");
        const today = getLocalDateString();
        const isSpanningDays = reminder.endDate && reminder.endDate !== reminder.date;

        // 判断是否为重复/循环任务或重复实例
        const isRecurring = reminder.isRepeatInstance || (reminder.repeat && reminder.repeat.enabled);

        // --- 创建子任务 ---
        if (!isRecurring) {
            menu.addItem({
                iconHTML: "➕",
                label: "创建子任务",
                click: () => this.showCreateSubtaskDialog(reminder)
            });
            // 粘贴新建子任务（参考 ProjectKanbanView 的实现）
            menu.addItem({
                iconHTML: "📋",
                label: "粘贴新建子任务",
                click: () => this.showPasteSubtaskDialog(reminder)
            });
        } else {
            menu.addItem({
                iconHTML: "➕",
                label: "创建子任务 (循环任务禁用)",
                disabled: true,
            });
        }
        menu.addSeparator();

        // Helper to create priority submenu items, to avoid code repetition.
        const createPriorityMenuItems = () => {
            const menuItems = [];
            const priorities = [
                { key: 'high', label: t("high"), icon: '🔴' },
                { key: 'medium', label: t("medium"), icon: '🟡' },
                { key: 'low', label: t("low"), icon: '🔵' },
                { key: 'none', label: t("none"), icon: '⚫' }
            ];

            const currentPriority = reminder.priority || 'none';

            priorities.forEach(priority => {
                menuItems.push({
                    iconHTML: priority.icon,
                    label: priority.label,
                    current: currentPriority === priority.key,
                    click: () => {
                        const targetId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;
                        this.setPriority(targetId, priority.key);
                    }
                });
            });
            return menuItems;
        };

        // 优化分类子菜单项创建 - 确保emoji正确显示
        const createCategoryMenuItems = () => {
            const menuItems = [];
            const categories = this.categoryManager.getCategories();
            const currentCategoryId = reminder.categoryId;

            // Add "无分类" option
            menuItems.push({
                iconHTML: "❌",
                label: "无分类",
                current: !currentCategoryId,
                click: () => {
                    const targetId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;
                    this.setCategory(targetId, null);
                }
            });

            // Add existing categories with proper emoji display
            categories.forEach(category => {
                menuItems.push({
                    iconHTML: category.icon || "📁",
                    label: category.name,
                    current: currentCategoryId === category.id,
                    click: () => {
                        const targetId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;
                        this.setCategory(targetId, category.id);
                    }
                });
            });

            return menuItems;
        };

        // 检查是否为跨天事件且在今日任务中
        const isSpanningInToday = isSpanningDays &&
            compareDateStrings(reminder.date, today) <= 0 &&
            compareDateStrings(today, reminder.endDate) <= 0;

        // 检查是否为未绑定的快速事件
        // const isUnboundQuickReminder = (reminder.isQuickReminder || reminder.id.startsWith('quick')) && !reminder.blockId;

        // 添加项目管理选项（仅当任务有projectId时显示）
        if (reminder.projectId) {
            menu.addItem({
                icon: "iconGrid",
                label: "打开项目看板",
                click: () => this.openProjectKanban(reminder.projectId)
            });
            menu.addSeparator();
        }

        if (reminder.isRepeatInstance) {
            // --- Menu for a REPEAT INSTANCE ---
            // 只对已绑定块的事件显示复制块引用
            if (reminder.blockId) {
                menu.addItem({
                    iconHTML: "📋",
                    label: t("copyBlockRef"),
                    click: () => this.copyBlockRef(reminder)
                });
            } else {
                // 未绑定块的事件显示绑定块选项
                menu.addItem({
                    iconHTML: "🔗",
                    label: t("bindToBlock"),
                    click: () => this.showBindToBlockDialog(reminder)
                });
            }

            // 为跨天的重复事件实例添加"今日已完成"选项
            if (isSpanningInToday && !reminder.completed) {
                const isTodayCompleted = this.isSpanningEventTodayCompleted(reminder);
                menu.addItem({
                    iconHTML: isTodayCompleted ? "🔄" : "✅",
                    label: isTodayCompleted ? t("unmarkTodayCompleted") : t("markTodayCompleted"),
                    click: () => {
                        if (isTodayCompleted) {
                            this.unmarkSpanningEventTodayCompleted(reminder);
                        } else {
                            this.markSpanningEventTodayCompleted(reminder);
                        }
                    }
                });
                menu.addSeparator();
            }

            menu.addItem({
                iconHTML: "📝",
                label: t("modifyThisInstance"),
                click: () => this.editInstanceReminder(reminder)
            });
            menu.addItem({
                iconHTML: "📝",
                label: t("modifyAllInstances"),
                click: () => this.editInstanceAsNewSeries(reminder)
            });
            menu.addItem({
                iconHTML: "🎯",
                label: t("setPriority"),
                submenu: createPriorityMenuItems()
            });
            menu.addItem({
                iconHTML: "🏷️",
                label: t("setCategory"),
                submenu: createCategoryMenuItems()
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteThisInstance"),
                click: () => this.deleteInstanceOnly(reminder)
            });
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteAllInstances"),
                click: () => this.deleteOriginalReminder(reminder.originalId)
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🍅",
                label: t("startPomodoro"),
                click: () => this.startPomodoro(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: t("startCountUp"),
                click: () => this.startPomodoroCountUp(reminder)
            });

        } else if (reminder.repeat?.enabled) {
            // --- Menu for the ORIGINAL RECURRING EVENT ---
            // 只对已绑定块的事件显示复制块引用
            if (reminder.blockId) {
                menu.addItem({
                    iconHTML: "📋",
                    label: t("copyBlockRef"),
                    click: () => this.copyBlockRef(reminder)
                });
            } else {
                // 未绑定块的事件显示绑定块选项
                menu.addItem({
                    iconHTML: "🔗",
                    label: t("bindToBlock"),
                    click: () => this.showBindToBlockDialog(reminder)
                });
            }

            // 为跨天的重复事件添加"今日已完成"选项
            if (isSpanningInToday && !reminder.completed) {
                const isTodayCompleted = this.isSpanningEventTodayCompleted(reminder);
                menu.addItem({
                    iconHTML: isTodayCompleted ? "🔄" : "✅",
                    label: isTodayCompleted ? t("unmarkTodayCompleted") : t("markTodayCompleted"),
                    click: () => {
                        if (isTodayCompleted) {
                            this.unmarkSpanningEventTodayCompleted(reminder);
                        } else {
                            this.markSpanningEventTodayCompleted(reminder);
                        }
                    }
                });
                menu.addSeparator();
            }

            menu.addItem({
                iconHTML: "📝",
                label: t("modifyThisInstance"),
                click: () => this.splitRecurringReminder(reminder)
            });
            menu.addItem({
                iconHTML: "📝",
                label: t("modifyAllInstances"),
                click: () => this.showTimeEditDialog(reminder)
            });
            menu.addItem({
                iconHTML: "🎯",
                label: t("setPriority"),
                submenu: createPriorityMenuItems()
            });
            menu.addItem({
                iconHTML: "🏷️",
                label: t("setCategory"),
                submenu: createCategoryMenuItems()
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteThisInstance"),
                click: () => this.skipFirstOccurrence(reminder)
            });
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteAllInstances"),
                click: () => this.deleteReminder(reminder)
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🍅",
                label: t("startPomodoro"),
                click: () => this.startPomodoro(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: t("startCountUp"),
                click: () => this.startPomodoroCountUp(reminder)
            });

        } else {
            // --- Menu for a SIMPLE, NON-RECURRING EVENT ---
            // 只对已绑定块的事件显示复制块引用
            if (reminder.blockId) {
                menu.addItem({
                    iconHTML: "📋",
                    label: t("copyBlockRef"),
                    click: () => this.copyBlockRef(reminder)
                });
            } else {
                // 未绑定块的事件显示绑定块选项
                menu.addItem({
                    iconHTML: "🔗",
                    label: t("bindToBlock"),
                    click: () => this.showBindToBlockDialog(reminder)
                });
            }

            // 为跨天的普通事件添加"今日已完成"选项
            if (isSpanningInToday && !reminder.completed) {
                const isTodayCompleted = this.isSpanningEventTodayCompleted(reminder);
                menu.addItem({
                    iconHTML: isTodayCompleted ? "🔄" : "✅",
                    label: isTodayCompleted ? t("unmarkTodayCompleted") : t("markTodayCompleted"),
                    click: () => {
                        if (isTodayCompleted) {
                            this.unmarkSpanningEventTodayCompleted(reminder);
                        } else {
                            this.markSpanningEventTodayCompleted(reminder);
                        }
                    }
                });
                menu.addSeparator();
            }

            menu.addItem({
                iconHTML: "📝",
                label: t("modify"),
                click: () => this.showTimeEditDialog(reminder)
            });
            menu.addItem({
                iconHTML: "🎯",
                label: t("setPriority"),
                submenu: createPriorityMenuItems()
            });
            menu.addItem({
                iconHTML: "🏷️",
                label: t("setCategory"),
                submenu: createCategoryMenuItems()
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🍅",
                label: t("startPomodoro"),
                click: () => this.startPomodoro(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: t("startCountUp"),
                click: () => this.startPomodoroCountUp(reminder)
            });
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteReminder"),
                click: () => this.deleteReminder(reminder)
            });
        }

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private startPomodoro(reminder: any) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟并且窗口仍然存在
        if (ReminderPanel.currentPomodoroTimer && ReminderPanel.currentPomodoroTimer.isWindowActive()) {
            // 获取当前番茄钟的状态
            const currentState = ReminderPanel.currentPomodoroTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = reminder.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新任务："${newTitle}"？`;

            // 如果当前番茄钟正在运行，先暂停并询问是否继承时间
            if (currentState.isRunning && !currentState.isPaused) {
                // 先暂停当前番茄钟
                try {
                    ReminderPanel.currentPomodoroTimer.pauseFromExternal();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                const timeDisplay = currentState.isWorkPhase ?
                    `工作时间 ${Math.floor(currentState.timeElapsed / 60)}:${(currentState.timeElapsed % 60).toString().padStart(2, '0')}` :
                    `休息时间 ${Math.floor(currentState.timeLeft / 60)}:${(currentState.timeLeft % 60).toString().padStart(2, '0')}`;

                confirmMessage += `\n\n\n选择"确定"将继承当前进度继续计时。`;
            }

            // 显示确认对话框
            confirm(
                "切换番茄钟任务",
                confirmMessage,
                () => {
                    // 用户确认替换，传递当前状态
                    this.performStartPomodoro(reminder, currentState);
                },
                () => {
                    // 用户取消，尝试恢复原番茄钟的运行状态
                    if (currentState.isRunning && !currentState.isPaused) {
                        try {
                            ReminderPanel.currentPomodoroTimer.resumeFromExternal();
                        } catch (error) {
                            console.error('恢复番茄钟运行失败:', error);
                        }
                    }
                }
            );
        } else {
            // 没有活动番茄钟或窗口已关闭，清理引用并直接启动
            if (ReminderPanel.currentPomodoroTimer && !ReminderPanel.currentPomodoroTimer.isWindowActive()) {
                ReminderPanel.currentPomodoroTimer = null;
            }
            this.performStartPomodoro(reminder);
        }
    }



    /**
     * 标记跨天事件"今日已完成"
     * @param reminder 提醒对象
     */
    private async markSpanningEventTodayCompleted(reminder: any) {
        try {
            const today = getLocalDateString();
            const reminderData = await readReminderData();

            if (reminder.isRepeatInstance) {
                // 重复事件实例：更新原始事件的每日完成记录
                const originalId = reminder.originalId;
                if (reminderData[originalId]) {
                    if (!reminderData[originalId].dailyCompletions) {
                        reminderData[originalId].dailyCompletions = {};
                    }
                    reminderData[originalId].dailyCompletions[today] = true;
                }
            } else {
                // 普通事件：更新事件的每日完成记录
                if (reminderData[reminder.id]) {
                    if (!reminderData[reminder.id].dailyCompletions) {
                        reminderData[reminder.id].dailyCompletions = {};
                    }
                    reminderData[reminder.id].dailyCompletions[today] = true;
                }
            }

            await writeReminderData(reminderData);
            showMessage(t("markedTodayCompleted"));

            // 局部更新：更新该提醒显示及其父项进度（如果显示）
            if (reminder.isRepeatInstance) {
                this.updateReminderElement(reminder.originalId, reminder, getLocalDateString());
                if (reminder.parentId) this.updateParentProgress(reminder.parentId);
            } else {
                this.updateReminderElement(reminder.id, reminder);
                if (reminder.parentId) this.updateParentProgress(reminder.parentId);
            }

            // 通知插件更新徽章
            if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                this.plugin.updateBadges();
            }
        } catch (error) {
            console.error('标记今日已完成失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    /**
     * 取消标记跨天事件"今日已完成"
     * @param reminder 提醒对象
     */
    private async unmarkSpanningEventTodayCompleted(reminder: any) {
        try {
            const today = getLocalDateString();
            const reminderData = await readReminderData();

            if (reminder.isRepeatInstance) {
                // 重复事件实例：更新原始事件的每日完成记录
                const originalId = reminder.originalId;
                if (reminderData[originalId] && reminderData[originalId].dailyCompletions) {
                    delete reminderData[originalId].dailyCompletions[today];
                }
            } else {
                // 普通事件：更新事件的每日完成记录
                if (reminderData[reminder.id] && reminderData[reminder.id].dailyCompletions) {
                    delete reminderData[reminder.id].dailyCompletions[today];
                }
            }

            await writeReminderData(reminderData);
            showMessage(t("unmarkedTodayCompleted"));

            // 局部更新：更新该提醒显示及其父项进度（如果显示）
            if (reminder.isRepeatInstance) {
                this.updateReminderElement(reminder.originalId, reminder, getLocalDateString());
                if (reminder.parentId) this.updateParentProgress(reminder.parentId);
            } else {
                this.updateReminderElement(reminder.id, reminder);
                if (reminder.parentId) this.updateParentProgress(reminder.parentId);
            }

            // 通知插件更新徽章
            if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                this.plugin.updateBadges();
            }
        } catch (error) {
            console.error('取消今日已完成失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    private async performStartPomodoro(reminder: any, inheritState?: any) {
        // 如果已经有活动的番茄钟，先关闭它
        if (ReminderPanel.currentPomodoroTimer) {
            try {
                ReminderPanel.currentPomodoroTimer.close();
                ReminderPanel.currentPomodoroTimer = null;
            } catch (error) {
                console.error('关闭之前的番茄钟失败:', error);
            }
        }

        const settings = await this.plugin.getPomodoroSettings();
        const pomodoroTimer = new PomodoroTimer(reminder, settings, false, inheritState);

        // 设置当前活动的番茄钟实例
        ReminderPanel.currentPomodoroTimer = pomodoroTimer;

        pomodoroTimer.show();

        // 如果继承了状态且原来正在运行，显示继承信息
        if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
            const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
            showMessage(`已切换任务并继承${phaseText}进度`, 2000);
        }
    }

    private startPomodoroCountUp(reminder: any) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟并且窗口仍然存在
        if (ReminderPanel.currentPomodoroTimer && ReminderPanel.currentPomodoroTimer.isWindowActive()) {
            // 获取当前番茄钟的状态
            const currentState = ReminderPanel.currentPomodoroTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = reminder.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新的正计时任务："${newTitle}"？`;

            // 如果当前番茄钟正在运行，先暂停并询问是否继承时间
            if (currentState.isRunning && !currentState.isPaused) {
                // 先暂停当前番茄钟
                try {
                    ReminderPanel.currentPomodoroTimer.pauseFromExternal();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                const timeDisplay = currentState.isWorkPhase ?
                    `工作时间 ${Math.floor(currentState.timeElapsed / 60)}:${(currentState.timeElapsed % 60).toString().padStart(2, '0')}` :
                    `休息时间 ${Math.floor(currentState.timeLeft / 60)}:${(currentState.timeLeft % 60).toString().padStart(2, '0')}`;

                confirmMessage += `\n\n\n选择"确定"将继承当前进度继续计时。`;
            }



            // 显示确认对话框
            confirm(
                "切换到正计时番茄钟",
                confirmMessage,
                () => {
                    // 用户确认替换，传递当前状态
                    this.performStartPomodoroCountUp(reminder, currentState);
                },
                () => {
                    // 用户取消，尝试恢复番茄钟的运行状态
                    if (currentState.isRunning && !currentState.isPaused) {
                        try {
                            ReminderPanel.currentPomodoroTimer.resumeFromExternal();
                        } catch (error) {
                            console.error('恢复番茄钟运行失败:', error);
                        }
                    }
                }
            );
        } else {
            // 没有活动番茄钟或窗口已关闭，清理引用并直接启动
            if (ReminderPanel.currentPomodoroTimer && !ReminderPanel.currentPomodoroTimer.isWindowActive()) {
                ReminderPanel.currentPomodoroTimer = null;
            }
            this.performStartPomodoroCountUp(reminder);
        }
    }

    private async performStartPomodoroCountUp(reminder: any, inheritState?: any) {
        // 如果已经有活动的番茄钟，先关闭它
        if (ReminderPanel.currentPomodoroTimer) {
            try {
                ReminderPanel.currentPomodoroTimer.close();
                ReminderPanel.currentPomodoroTimer = null;
            } catch (error) {
                console.error('关闭之前的番茄钟失败:', error);
            }
        }

        const settings = await this.plugin.getPomodoroSettings();
        const pomodoroTimer = new PomodoroTimer(reminder, settings, true, inheritState);

        // 设置当前活动的番茄钟实例并直接切换到正计时模式
        ReminderPanel.currentPomodoroTimer = pomodoroTimer;

        pomodoroTimer.show();

        // 如果继承了状态且原来正在运行，显示继承信息
        if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
            const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
            showMessage(`已切换到正计时模式并继承${phaseText}进度`, 2000);
        } else {
            showMessage("已启动正计时番茄钟", 2000);
        }
    }


    // 添加静态方法获取当前番茄钟实例
    public static getCurrentPomodoroTimer(): PomodoroTimer | null {
        return ReminderPanel.currentPomodoroTimer;
    }

    // 添加静态方法清理当前番茄钟实例

    // 添加静态方法清理当前番茄钟实例
    public static clearCurrentPomodoroTimer(): void {
        if (ReminderPanel.currentPomodoroTimer) {
            try {
                // 检查窗口是否仍然活动，如果不活动则直接清理引用
                if (!ReminderPanel.currentPomodoroTimer.isWindowActive()) {
                    ReminderPanel.currentPomodoroTimer = null;
                    return;
                }
                ReminderPanel.currentPomodoroTimer.destroy();
            } catch (error) {
                console.error('清理番茄钟实例失败:', error);
            }
            ReminderPanel.currentPomodoroTimer = null;
        }
    }

    /**
     * [NEW] Calculates the next occurrence date based on the repeat settings.
     * @param startDateStr The starting date string (YYYY-MM-DD).
     * @param repeat The repeat configuration object from RepeatConfig.
     * @returns A Date object for the next occurrence.
     */
    private calculateNextDate(startDateStr: string, repeat: any): Date {
        const startDate = new Date(startDateStr + 'T12:00:00');
        if (isNaN(startDate.getTime())) {
            console.error("Invalid start date for cycle calculation:", startDateStr);
            return null;
        }

        if (!repeat || !repeat.enabled) {
            return null;
        }

        switch (repeat.type) {
            case 'daily':
                return this.calculateDailyNext(startDate, repeat.interval || 1);

            case 'weekly':
                return this.calculateWeeklyNext(startDate, repeat.interval || 1);

            case 'monthly':
                return this.calculateMonthlyNext(startDate, repeat.interval || 1);

            case 'yearly':
                return this.calculateYearlyNext(startDate, repeat.interval || 1);

            case 'custom':
                return this.calculateCustomNext(startDate, repeat);

            case 'ebbinghaus':
                return this.calculateEbbinghausNext(startDate, repeat.ebbinghausPattern || [1, 2, 4, 7, 15]);

            default:
                console.error("Unknown repeat type:", repeat.type);
                return null;
        }
    }

    /**
     * Calculate next daily occurrence
     */
    private calculateDailyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setDate(nextDate.getDate() + interval);
        return nextDate;
    }

    /**
     * Calculate next weekly occurrence
     */
    private calculateWeeklyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setDate(nextDate.getDate() + (7 * interval));
        return nextDate;
    }

    /**
     * Calculate next monthly occurrence
     */
    private calculateMonthlyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setMonth(nextDate.getMonth() + interval);

        // Handle month overflow (e.g., Jan 31 + 1 month should be Feb 28/29, not Mar 3)
        if (nextDate.getDate() !== startDate.getDate()) {
            nextDate.setDate(0); // Set to last day of previous month
        }

        return nextDate;
    }

    /**
     * Calculate next yearly occurrence
     */
    private calculateYearlyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setFullYear(nextDate.getFullYear() + interval);

        // Handle leap year edge case (Feb 29 -> Feb 28)
        if (nextDate.getDate() !== startDate.getDate()) {
            nextDate.setDate(0); // Set to last day of previous month
        }

        return nextDate;
    }

    /**
     * Calculate next custom occurrence
     */
    private calculateCustomNext(startDate: Date, repeat: any): Date {
        // For custom repeats, use the first available option
        // Priority: weekDays > monthDays > months

        if (repeat.weekDays && repeat.weekDays.length > 0) {
            return this.calculateNextWeekday(startDate, repeat.weekDays);
        }

        if (repeat.monthDays && repeat.monthDays.length > 0) {
            return this.calculateNextMonthday(startDate, repeat.monthDays);
        }

        if (repeat.months && repeat.months.length > 0) {
            return this.calculateNextMonth(startDate, repeat.months);
        }

        // Fallback to daily if no custom options
        return this.calculateDailyNext(startDate, 1);
    }

    /**
     * Calculate next occurrence based on weekdays
     */
    private calculateNextWeekday(startDate: Date, weekDays: number[]): Date {
        const nextDate = new Date(startDate);
        const currentWeekday = nextDate.getDay();

        // Sort weekdays and find next one
        const sortedWeekdays = [...weekDays].sort((a, b) => a - b);

        // Find next weekday in the same week
        let nextWeekday = sortedWeekdays.find(day => day > currentWeekday);

        if (nextWeekday !== undefined) {
            // Next occurrence is this week
            const daysToAdd = nextWeekday - currentWeekday;
            nextDate.setDate(nextDate.getDate() + daysToAdd);
        } else {
            // Next occurrence is next week, use first weekday
            const daysToAdd = 7 - currentWeekday + sortedWeekdays[0];
            nextDate.setDate(nextDate.getDate() + daysToAdd);
        }

        return nextDate;
    }

    /**
     * Calculate next occurrence based on month days
     */
    private calculateNextMonthday(startDate: Date, monthDays: number[]): Date {
        const nextDate = new Date(startDate);
        const currentDay = nextDate.getDate();

        // Sort month days and find next one
        const sortedDays = [...monthDays].sort((a, b) => a - b);

        // Find next day in the same month
        let nextDay = sortedDays.find(day => day > currentDay);

        if (nextDay !== undefined) {
            // Check if the day exists in current month
            const tempDate = new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDay);
            if (tempDate.getMonth() === nextDate.getMonth()) {
                nextDate.setDate(nextDay);
                return nextDate;
            }
        }

        // Next occurrence is next month, use first day
        nextDate.setMonth(nextDate.getMonth() + 1);
        const firstDay = sortedDays[0];

        // Ensure the day exists in the target month
        const lastDayOfMonth = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
        nextDate.setDate(Math.min(firstDay, lastDayOfMonth));

        return nextDate;
    }

    /**
     * Calculate next occurrence based on months
     */
    private calculateNextMonth(startDate: Date, months: number[]): Date {
        const nextDate = new Date(startDate);
        const currentMonth = nextDate.getMonth() + 1; // Convert to 1-based

        // Sort months and find next one
        const sortedMonths = [...months].sort((a, b) => a - b);

        // Find next month in the same year
        let nextMonth = sortedMonths.find(month => month > currentMonth);

        if (nextMonth !== undefined) {
            // Next occurrence is this year
            nextDate.setMonth(nextMonth - 1); // Convert back to 0-based
        } else {
            // Next occurrence is next year, use first month
            nextDate.setFullYear(nextDate.getFullYear() + 1);
            nextDate.setMonth(sortedMonths[0] - 1); // Convert back to 0-based
        }

        // Handle day overflow for months with fewer days
        const lastDayOfMonth = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
        if (nextDate.getDate() > lastDayOfMonth) {
            nextDate.setDate(lastDayOfMonth);
        }

        return nextDate;
    }

    /**
     * Calculate next ebbinghaus occurrence
     */
    private calculateEbbinghausNext(startDate: Date, pattern: number[]): Date {
        // For ebbinghaus, we need to track which step we're on
        // This is a simplified version - in practice, you'd need to track state
        const nextDate = new Date(startDate);

        // Use the first interval in the pattern as default
        const firstInterval = pattern[0] || 1;
        nextDate.setDate(nextDate.getDate() + firstInterval);

        return nextDate;
    }

    private async deleteReminder(reminder: any) {
        try {
            const reminderData = await readReminderData();
            let hasDescendants = false;
            if (reminderData) {
                // 快速判断是否存在子任务（深度优先）
                const reminderMap = new Map<string, any>();
                Object.values(reminderData).forEach((r: any) => { if (r && r.id) reminderMap.set(r.id, r); });
                const stack = [reminder.id];
                const visited = new Set<string>();
                visited.add(reminder.id);
                while (stack.length > 0) {
                    const cur = stack.pop()!;
                    for (const r of reminderMap.values()) {
                        if (r.parentId === cur && !visited.has(r.id)) {
                            hasDescendants = true;
                            stack.length = 0; // break outer loop
                            break;
                        }
                    }
                }
            }

            const extra = hasDescendants ? '（包括子任务）' : '';

            await confirm(
                t("deleteReminder"),
                `${t("confirmDelete", { title: reminder.title })}${extra}`,
                () => {
                    this.performDeleteReminder(reminder.id);
                }
            );
        } catch (error) {
            // 回退到默认提示
            await confirm(
                t("deleteReminder"),
                t("confirmDelete", { title: reminder.title }),
                () => {
                    this.performDeleteReminder(reminder.id);
                }
            );
        }
    }

    private async performDeleteReminder(reminderId: string) {
        try {
            const reminderData = await readReminderData();

            if (!reminderData[reminderId]) {
                showMessage(t("reminderNotExist"));
                return;
            }

            // 构建提醒映射以便查找子任务
            const reminderMap = new Map<string, any>();
            Object.values(reminderData).forEach((r: any) => {
                if (r && r.id) reminderMap.set(r.id, r);
            });

            // 获取所有后代 id（递归）
            const descendantIds: string[] = [];
            const stack = [reminderId];
            const visited = new Set<string>();
            visited.add(reminderId);
            while (stack.length > 0) {
                const cur = stack.pop()!;
                for (const r of reminderMap.values()) {
                    if (r.parentId === cur && !visited.has(r.id)) {
                        descendantIds.push(r.id);
                        stack.push(r.id);
                        visited.add(r.id);
                    }
                }
            }

            // 收集要删除的 id（包括自身）
            const toDelete = new Set<string>([reminderId, ...descendantIds]);

            // 收集受影响的 blockId 以便之后更新书签
            const affectedBlockIds = new Set<string>();

            // 如果存在重复实例/原始提醒的特殊处理：删除时也应删除实例或原始记录（这里统一按 id 匹配）
            let deletedCount = 0;
            for (const id of Array.from(toDelete)) {
                const rem = reminderData[id];
                if (rem) {
                    if (rem.blockId) affectedBlockIds.add(rem.blockId);
                    delete reminderData[id];
                    deletedCount++;
                }
                // 还要删除可能是重复实例（形式为 `${originalId}_${date}`）的条目
                // 例如：如果删除原始提醒，则删除其实例; 如果删除实例则删除对应实例条目
                // 遍历所有 keys 查找以 id 开头的实例形式
                for (const key of Object.keys(reminderData)) {
                    if (toDelete.has(key)) continue; // 已处理
                    // 匹配 instance id pattern: startsWith(`${id}_`)
                    if (key.startsWith(id + '_')) {
                        const inst = reminderData[key];
                        if (inst && inst.blockId) affectedBlockIds.add(inst.blockId);
                        delete reminderData[key];
                        deletedCount++;
                    }
                }
            }

            if (deletedCount > 0) {
                await writeReminderData(reminderData);

                // 更新受影响的块的书签状态
                for (const bId of affectedBlockIds) {
                    try {
                        await updateBlockReminderBookmark(bId);
                    } catch (e) {
                        console.warn('更新块书签失败:', bId, e);
                    }
                }

                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                showMessage(t("reminderDeleted"));
                this.loadReminders();
            } else {
                showMessage(t("reminderNotExist"));
            }
        } catch (error) {
            console.error('删除提醒失败:', error);
            showMessage(t("deleteReminderFailed"));
        }
    }

    private updateReminderCounts(overdueCount: number, todayCount: number, tomorrowCount: number, future7Count: number, completedCount: number, todayCompletedCount: number) {
        // 更新各个标签的提醒数量 - 添加未来7天和今日已完成的数量更新
        // 这里可以根据需要添加UI更新逻辑
        // console.log('提醒数量统计:', {
        //     overdue: overdueCount,
        //     today: todayCount,
        //     tomorrow: tomorrowCount,
        //     future7: future7Count,
        //     completed: completedCount,
        //     todayCompleted: todayCompletedCount
        // });
    }

    private async setPriority(reminderId: string, priority: string) {
        try {
            const reminderData = await readReminderData();
            if (reminderData[reminderId]) {
                reminderData[reminderId].priority = priority;
                await writeReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                this.loadReminders();
                showMessage(t("priorityUpdated"));
            } else {
                showMessage(t("reminderNotExist"));
            }
        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    private async setCategory(reminderId: string, categoryId: string | null) {
        try {
            const reminderData = await readReminderData();
            if (reminderData[reminderId]) {
                reminderData[reminderId].categoryId = categoryId;
                await writeReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                this.loadReminders();

                // 获取分类名称用于提示
                const categoryName = categoryId ?
                    this.categoryManager.getCategoryById(categoryId)?.name || "未知分类" :
                    "无分类";
                showMessage(`已设置分类为：${categoryName}`);
            } else {
                showMessage(t("reminderNotExist"));
            }
        } catch (error) {
            console.error('设置分类失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    /**
     * [NEW] Ends the current recurring series and starts a new one from the next cycle.
     * @param reminder The original recurring reminder to split.
     */
    private async splitRecurringReminder(reminder: any) {
        try {
            const reminderData = await readReminderData();
            const originalReminder = reminderData[reminder.id];
            if (!originalReminder || !originalReminder.repeat?.enabled) {
                showMessage(t("operationFailed"));
                return;
            }

            // 计算原始事件的下一个周期日期
            const nextDate = this.calculateNextDate(originalReminder.date, originalReminder.repeat);
            if (!nextDate) {
                showMessage(t("operationFailed") + ": " + t("invalidRepeatConfig"));
                return;
            }
            const nextDateStr = getLocalDateString(nextDate);

            // 创建用于编辑的临时数据，用于修改原始事件（第一次发生）
            const editData = {
                ...originalReminder,
                // 保持原始事件的日期和时间，用户可以修改这个单次事件
                // 保持原始ID用于识别这是分割操作
                isSplitOperation: true,
                originalId: reminder.id,
                nextCycleDate: nextDateStr, // 保存下一个周期日期，用于创建新系列
            };

            // 打开编辑对话框
            const editDialog = new ReminderEditDialog(editData, async (modifiedReminder) => {
                // 编辑完成后执行分割逻辑
                await this.performSplitOperation(originalReminder, modifiedReminder);
            });
            editDialog.show();

        } catch (error) {
            console.error('开始分割重复事件系列失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    /**
     * [MODIFIED] Performs the actual split operation after user edits the reminder
     * @param originalReminder The original recurring reminder
     * @param modifiedReminder The modified reminder data from edit dialog
     */
    private async performSplitOperation(originalReminder: any, modifiedReminder: any) {
        try {
            const reminderData = await readReminderData();

            // 1. 修改原始事件为单次事件（应用用户的修改）
            const singleReminder = {
                ...originalReminder,
                // 应用用户修改的数据到单次事件
                title: modifiedReminder.title,
                date: modifiedReminder.date,
                time: modifiedReminder.time,
                endDate: modifiedReminder.endDate,
                endTime: modifiedReminder.endTime,
                note: modifiedReminder.note,
                priority: modifiedReminder.priority,
                // 移除重复设置，变成单次事件
                repeat: undefined
            };

            // 2. 创建新的重复事件系列，保持原始时间设置
            const newReminder = JSON.parse(JSON.stringify(originalReminder));

            // 清理新提醒的重复历史数据
            delete newReminder.repeat.endDate;
            delete newReminder.repeat.excludeDates;
            delete newReminder.repeat.instanceModifications;
            delete newReminder.repeat.completedInstances;

            // 生成新的提醒ID
            const blockId = originalReminder.blockId || originalReminder.id;
            const newId = `${blockId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            newReminder.id = newId;

            // 3. 设置新系列从下一个周期开始，保持原始时间设置
            newReminder.date = modifiedReminder.nextCycleDate;
            newReminder.endDate = modifiedReminder.nextCycleEndDate;
            // 保持原始的时间设置，不应用用户修改
            newReminder.time = originalReminder.time;
            newReminder.endTime = originalReminder.endTime;
            newReminder.title = originalReminder.title;
            newReminder.note = originalReminder.note;
            newReminder.priority = originalReminder.priority;

            // 如果用户修改了重复设置，应用到新系列
            if (modifiedReminder.repeat && modifiedReminder.repeat.enabled) {
                newReminder.repeat = { ...modifiedReminder.repeat };
                // 确保新系列没有结束日期限制
                delete newReminder.repeat.endDate;
            } else {
                // 如果用户禁用了重复，保持原始重复设置
                newReminder.repeat = { ...originalReminder.repeat };
                delete newReminder.repeat.endDate;
            }

            // 4. 保存修改
            reminderData[originalReminder.id] = singleReminder;
            reminderData[newId] = newReminder;
            await writeReminderData(reminderData);

            // 5. 更新界面
            this.loadReminders();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
            showMessage(t("seriesSplitSuccess"));

        } catch (error) {
            console.error('执行分割重复事件系列失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    // 新增：将实例作为新系列编辑（分割系列）
    private async editInstanceAsNewSeries(reminder: any) {
        try {
            const originalId = reminder.originalId;
            const instanceDate = reminder.date;

            const reminderData = await readReminderData();
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                showMessage(t("reminderDataNotExist"));
                return;
            }

            // 1. 在当前实例日期的前一天结束原始系列
            // 计算原始系列应该结束的日期（当前实例的前一天）
            const untilDate = new Date(instanceDate);
            untilDate.setDate(untilDate.getDate() - 1);
            const newEndDateStr = getLocalDateString(untilDate);

            // 更新原始系列的结束日期
            if (!originalReminder.repeat) {
                originalReminder.repeat = {};
            }
            originalReminder.repeat.endDate = newEndDateStr;

            // 2. 创建新的重复事件系列
            const newReminder = JSON.parse(JSON.stringify(originalReminder));

            // 清理新提醒
            delete newReminder.repeat.endDate;
            delete newReminder.repeat.excludeDates;
            delete newReminder.repeat.instanceModifications;
            delete newReminder.repeat.completedInstances;

            // 生成新的提醒ID
            const blockId = originalReminder.blockId || originalReminder.id;
            const newId = `${blockId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            newReminder.id = newId;

            // 3. 设置新系列的开始日期为当前实例日期
            newReminder.date = instanceDate;
            newReminder.endDate = reminder.endDate;
            newReminder.time = reminder.time;
            newReminder.endTime = reminder.endTime;

            // 4. 保存修改
            reminderData[originalId] = originalReminder;
            reminderData[newId] = newReminder;
            await writeReminderData(reminderData);

            // 5. 打开编辑对话框编辑新系列
            const editDialog = new ReminderEditDialog(newReminder, async () => {
                this.loadReminders();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            });
            editDialog.show();

        } catch (error) {
            console.error('分割重复事件系列失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    // 新增：编辑重复事件实例
    private async editInstanceReminder(reminder: any) {
        try {
            const reminderData = await readReminderData();
            const originalReminder = reminderData[reminder.originalId];

            if (!originalReminder) {
                showMessage(t("reminderDataNotExist"));
                return;
            }

            // 检查实例级别的修改（包括备注）
            const instanceModifications = originalReminder.repeat?.instanceModifications || {};
            const instanceMod = instanceModifications[reminder.date];

            // 创建实例数据，包含当前实例的特定信息
            const instanceData = {
                ...originalReminder,
                id: reminder.id,
                date: reminder.date,
                endDate: reminder.endDate,
                time: reminder.time,
                endTime: reminder.endTime,
                // 修改备注逻辑：只有实例有明确的备注时才使用，否则为空
                note: instanceMod?.note || '',  // 每个实例的备注都是独立的，默认为空
                isInstance: true,
                originalId: reminder.originalId,
                instanceDate: reminder.date

            };

            const editDialog = new ReminderEditDialog(instanceData, async () => {
                this.loadReminders();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            });
            editDialog.show();
        } catch (error) {
            console.error('打开实例编辑对话框失败:', error);
            showMessage(t("openModifyDialogFailed"));
        }
    }

    // 新增：删除单个重复事件实例
    private async deleteInstanceOnly(reminder: any) {
        await confirm(
            t("deleteThisInstance"),
            t("confirmDeleteInstance"),
            async () => {
                try {
                    const originalId = reminder.originalId;
                    const instanceDate = reminder.date;

                    await this.addExcludedDate(originalId, instanceDate);

                    showMessage(t("instanceDeleted"));
                    this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                } catch (error) {
                    console.error('删除重复实例失败:', error);
                    showMessage(t("deleteInstanceFailed"));
                }
            }
        );
    }

    // 新增：为原始重复事件添加排除日期
    private async addExcludedDate(originalId: string, excludeDate: string) {
        try {
            const reminderData = await readReminderData();

            if (reminderData[originalId]) {
                if (!reminderData[originalId].repeat) {
                    throw new Error('不是重复事件');
                }

                // 初始化排除日期列表
                if (!reminderData[originalId].repeat.excludeDates) {
                    reminderData[originalId].repeat.excludeDates = [];
                }

                // 添加排除日期（如果还没有的话）
                if (!reminderData[originalId].repeat.excludeDates.includes(excludeDate)) {
                    reminderData[originalId].repeat.excludeDates.push(excludeDate);
                }

                await writeReminderData(reminderData);
            } else {
                throw new Error('原始事件不存在');
            }
        } catch (error) {
            console.error('添加排除日期失败:', error);
            throw error;
        }
    }

    private async showTimeEditDialog(reminder: any) {
        const editDialog = new ReminderEditDialog(reminder, () => {
            this.loadReminders();
        });
        editDialog.show();
    }

    private async deleteOriginalReminder(originalId: string) {
        try {
            const reminderData = await readReminderData();
            const originalReminder = reminderData[originalId];

            if (originalReminder) {
                this.deleteReminder(originalReminder);
            } else {
                showMessage(t("reminderDataNotExist"));
            }
        } catch (error) {
            console.error('获取原始提醒失败:', error);
            showMessage(t("deleteReminderFailed"));
        }
    }

    /**
     * [MODIFIED] Skip the first occurrence of a recurring reminder
     * This method advances the start date of the recurring reminder to the next cycle
     * @param reminder The original recurring reminder
     */
    private async skipFirstOccurrence(reminder: any) {
        await confirm(
            t("deleteThisInstance"),
            t("confirmSkipFirstOccurrence"),
            async () => {
                try {
                    const reminderData = await readReminderData();
                    const originalReminder = reminderData[reminder.id];

                    if (!originalReminder || !originalReminder.repeat?.enabled) {
                        showMessage(t("operationFailed"));
                        return;
                    }

                    // 计算下一个周期的日期
                    const nextDate = this.calculateNextDate(originalReminder.date, originalReminder.repeat);
                    if (!nextDate) {
                        showMessage(t("operationFailed") + ": " + t("invalidRepeatConfig"));
                        return;
                    }

                    // 将周期事件的开始日期更新为下一个周期
                    originalReminder.date = getLocalDateString(nextDate);

                    // 如果是跨天事件，也需要更新结束日期
                    if (originalReminder.endDate) {
                        const originalStartDate = new Date(reminder.date + 'T12:00:00');
                        const originalEndDate = new Date(originalReminder.endDate + 'T12:00:00');
                        const daysDiff = Math.floor((originalEndDate.getTime() - originalStartDate.getTime()) / (1000 * 60 * 60 * 24));

                        const newEndDate = new Date(nextDate);
                        newEndDate.setDate(newEndDate.getDate() + daysDiff);
                        originalReminder.endDate = getLocalDateString(newEndDate);
                    }

                    // 清理可能存在的首次发生相关的历史数据
                    if (originalReminder.repeat.completedInstances) {
                        const firstOccurrenceIndex = originalReminder.repeat.completedInstances.indexOf(reminder.date);
                        if (firstOccurrenceIndex > -1) {
                            originalReminder.repeat.completedInstances.splice(firstOccurrenceIndex, 1);
                        }
                    }

                    if (originalReminder.repeat.instanceModifications && originalReminder.repeat.instanceModifications[reminder.date]) {
                        delete originalReminder.repeat.instanceModifications[reminder.date];
                    }

                    if (originalReminder.repeat.excludeDates) {
                        const firstOccurrenceIndex = originalReminder.repeat.excludeDates.indexOf(reminder.date);
                        if (firstOccurrenceIndex > -1) {
                            originalReminder.repeat.excludeDates.splice(firstOccurrenceIndex, 1);
                        }
                    }

                    await writeReminderData(reminderData);
                    showMessage(t("firstOccurrenceSkipped"));
                    this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                } catch (error) {
                    console.error('跳过首次发生失败:', error);
                    showMessage(t("operationFailed"));
                }
            }
        );
    }
    private async copyBlockRef(reminder: any) {
        try {
            // 获取块ID（对于重复事件实例，使用原始事件的blockId）
            const blockId = reminder.blockId || (reminder.isRepeatInstance ?
                await this.getOriginalBlockId(reminder.originalId) :
                reminder.id);

            if (!blockId) {
                showMessage("无法获取块ID");
                return;
            }

            // 获取事件标题
            const title = reminder.title || t("unnamedNote");

            // 生成静态锚文本块引格式
            const blockRef = `((${blockId} "${title}"))`;

            // 复制到剪贴板
            await navigator.clipboard.writeText(blockRef);

        } catch (error) {
            console.error('复制块引失败:', error);
            showMessage("复制块引失败");
        }
    }
    // 获取原始事件的blockId
    private async getOriginalBlockId(originalId: string): Promise<string | null> {
        try {
            const reminderData = await readReminderData();
            const originalReminder = reminderData[originalId];
            return originalReminder?.blockId || originalId;
        } catch (error) {
            console.error('获取原始块ID失败:', error);
            return null;
        }
    }

    /**
     * 显示绑定到块的对话框
     */
    private showBindToBlockDialog(reminder: any) {
        const dialog = new Dialog({
            title: t("bindReminderToBlock"),
            content: `
                <div class="bind-to-block-dialog">
                    <div class="b3-dialog__content">
                        <div class="mode-toggle" style="margin-bottom: 16px;">
                            <button id="bindExistingBtn" class="b3-button b3-button--outline mode-btn active" style="margin-right: 8px;">
                                绑定现有块
                            </button>
                            <button id="createNewBtn" class="b3-button b3-button--outline mode-btn">
                                ${t("createNewDocument")}
                            </button>
                        </div>

                        <div id="bindExistingPanel" class="mode-panel">
                            <div class="b3-form__group">
                                <label class="b3-form__label">输入块ID</label>
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

                        <div id="createNewPanel" class="mode-panel" style="display: none;">
                            <div class="b3-form__group">
                                <label class="b3-form__label">文档标题</label>
                                <input type="text" id="docTitleInput" class="b3-text-field" placeholder="请输入文档标题" style="width: 100%; margin-top: 8px;">
                            </div>
                            <div class="b3-form__group">
                                <label class="b3-form__label">文档内容（可选）</label>
                                <textarea id="docContentInput" class="b3-text-field" placeholder="请输入文档内容" style="width: 100%; margin-top: 8px; min-height: 80px; resize: vertical;"></textarea>
                            </div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="bindCancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="bindConfirmBtn">${t("bindToBlock")}</button>
                    </div>
                </div>
            `,
            width: "500px",
            height: "400px"
        });

        // 获取DOM元素
        const bindExistingBtn = dialog.element.querySelector('#bindExistingBtn') as HTMLButtonElement;
        const createNewBtn = dialog.element.querySelector('#createNewBtn') as HTMLButtonElement;
        const bindExistingPanel = dialog.element.querySelector('#bindExistingPanel') as HTMLElement;
        const createNewPanel = dialog.element.querySelector('#createNewPanel') as HTMLElement;

        const blockIdInput = dialog.element.querySelector('#blockIdInput') as HTMLInputElement;
        const selectedBlockInfo = dialog.element.querySelector('#selectedBlockInfo') as HTMLElement;
        const blockContentEl = dialog.element.querySelector('#blockContent') as HTMLElement;

        const docTitleInput = dialog.element.querySelector('#docTitleInput') as HTMLInputElement;
        const docContentInput = dialog.element.querySelector('#docContentInput') as HTMLTextAreaElement;

        const cancelBtn = dialog.element.querySelector('#bindCancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#bindConfirmBtn') as HTMLButtonElement;

        let currentMode = 'existing';

        // 模式切换事件
        bindExistingBtn.addEventListener('click', () => {
            currentMode = 'existing';
            bindExistingBtn.classList.add('active');
            createNewBtn.classList.remove('active');
            bindExistingPanel.style.display = 'block';
            createNewPanel.style.display = 'none';
            confirmBtn.textContent = t("bindToBlock");
        });

        createNewBtn.addEventListener('click', () => {
            currentMode = 'create';
            createNewBtn.classList.add('active');
            bindExistingBtn.classList.remove('active');
            createNewPanel.style.display = 'block';
            bindExistingPanel.style.display = 'none';
            confirmBtn.textContent = t("createDocumentAndBind");

            // 自动填充标题
            if (!docTitleInput.value && reminder.title) {
                docTitleInput.value = reminder.title;
            }
        });

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
            if (currentMode === 'existing') {
                // 绑定现有块模式
                const blockId = blockIdInput.value.trim();
                if (!blockId) {
                    showMessage('请输入块ID');
                    return;
                }

                try {
                    await this.bindReminderToBlock(reminder, blockId);
                    showMessage(t("reminderBoundToBlock"));
                    dialog.destroy();
                    this.loadReminders();
                } catch (error) {
                    console.error('绑定提醒到块失败:', error);
                    showMessage(t("bindToBlockFailed"));
                }
            } else {
                // 创建新文档模式
                const title = docTitleInput.value.trim();
                const content = docContentInput.value.trim();

                if (!title) {
                    showMessage(t("pleaseEnterTitle"));
                    return;
                }

                try {
                    await this.createDocumentAndBind(reminder, title, content);
                    showMessage(t("documentCreatedAndBound"));
                    dialog.destroy();
                    this.loadReminders();
                } catch (error) {
                    console.error('创建文档并绑定失败:', error);
                    showMessage(t("createDocumentFailed"));
                }
            }
        });

        // 自动聚焦输入框
        setTimeout(() => {
            if (currentMode === 'existing') {
                blockIdInput.focus();
            } else {
                docTitleInput.focus();
            }
        }, 100);
    }

    private showCreateSubtaskDialog(parentReminder: any) {
        const dialog = new Dialog({
            title: `为 "${parentReminder.title}" 创建子任务`,
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
            height: "620px"
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

        // 确保样式已加载
        this.addReminderDialogStyles();

        // 渲染并绑定分类选择器
        this.renderCategorySelector(categorySelector);

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
                this.renderCategorySelector(categorySelector);
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

        // 预填父任务信息
        if (parentReminder) {
            // 预选分类
            const categoryOption = categorySelector.querySelector(`.category-option[data-category="${parentReminder.categoryId || ''}"]`) as HTMLElement;
            if (categoryOption) {
                categorySelector.querySelectorAll('.category-option').forEach(opt => opt.classList.remove('selected'));
                categoryOption.classList.add('selected');
            }

            // 预选优先级
            const priorityOption = prioritySelector.querySelector(`.priority-option[data-priority="${parentReminder.priority || 'none'}"]`) as HTMLElement;
            if (priorityOption) {
                prioritySelector.querySelectorAll('.priority-option').forEach(opt => opt.classList.remove('selected'));
                priorityOption.classList.add('selected');
            }
        }

        createBtn.addEventListener('click', async () => {
            const title = titleInput.value.trim();
            if (!title) {
                showMessage("请输入任务标题");
                titleInput.focus();
                return;
            }

            // 禁用按钮防止重复提交
            createBtn.disabled = true;
            createBtn.textContent = "创建中...";

            try {
                const selectedPriority = prioritySelector.querySelector('.priority-option.selected') as HTMLElement;
                const priority = selectedPriority?.getAttribute('data-priority') || 'none';

                const selectedCategory = categorySelector.querySelector('.category-option.selected') as HTMLElement;
                const categoryId = selectedCategory?.getAttribute('data-category') || undefined;

                // 子任务继承父任务的项目ID
                const projectId = parentReminder.projectId || undefined;

                const blockId = blockIdInput.value.trim() || undefined;

                await this.createSubtask({
                    title: title,
                    note: noteInput.value.trim(),
                    date: startDateInput.value,
                    endDate: endDateInput.value,
                    priority: priority,
                    categoryId: categoryId,
                    projectId: projectId,
                    blockId: blockId
                }, parentReminder);

                showMessage("子任务创建成功");
                dialog.destroy();
            } catch (error) {
                console.error('创建子任务失败:', error);
                showMessage("创建子任务失败");
                // 恢复按钮状态
                createBtn.disabled = false;
                createBtn.textContent = "创建";
            }
        });

        // 自动聚焦标题输入框
        setTimeout(() => {
            titleInput.focus();
        }, 100);
    }

    private showPasteSubtaskDialog(parentReminder: any) {
        const dialog = new Dialog({
            title: "粘贴列表新建子任务",
            content: `
                <div class="b3-dialog__content">
                    <p class="b3-typography">粘贴Markdown列表或多行文本，每行将创建一个子任务。支持多层级列表自动创建父子任务。</p>
                    <textarea id="taskList" class="b3-text-field" placeholder="示例：\n- 需求文档\n  - 功能列表\n  - 接口设计\n- 测试用例" style="width:100%; height:220px; resize:vertical;"></textarea>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                    <button class="b3-button b3-button--primary" id="createBtn">创建子任务</button>
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

            const hierarchicalTasks = this.parseHierarchicalTaskList(text);

            if (hierarchicalTasks.length > 0) {
                await this.batchCreateSubtasksWithHierarchy(hierarchicalTasks, parentReminder.id);
                dialog.destroy();
                const totalTasks = this.countTotalTasks(hierarchicalTasks);
                showMessage(`${totalTasks} 个子任务已创建`);
            }
        });
    }

    // 复用 ProjectKanbanView 的解析方法，适配为在 ReminderPanel 创建子任务
    private parseHierarchicalTaskList(text: string): any[] {
        const lines = text.split('\n');
        const tasks: any[] = [];
        const stack: Array<{ task: any; level: number }> = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            const level = this.calculateIndentLevel(line);
            const cleanLine = line.trim();

            if (!cleanLine || (!cleanLine.startsWith('-') && level === 0 && !cleanLine.match(/^\s*-/))) {
                if (cleanLine && level === 0) {
                    const taskData = this.parseTaskLine(cleanLine);
                    const task = { ...taskData, level: 0, children: [] };
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

            const taskData = this.parseTaskLine(taskContent);
            const task = { ...taskData, level: combinedLevel, children: [] };

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

    private parseTaskLine(line: string): { title: string; priority?: string; startDate?: string; endDate?: string; blockId?: string; completed?: boolean } {
        const paramMatch = line.match(/@(.*)$/);
        let title = line;
        let priority: string | undefined;
        let startDate: string | undefined;
        let endDate: string | undefined;
        let blockId: string | undefined;
        let completed: boolean | undefined;

        blockId = this.extractBlockIdFromText(line);

        if (blockId) {
            title = title.replace(/\[([^\]]+)\]\(siyuan:\/\/blocks\/[^)]+\)/g, '$1');
            title = title.replace(/\(\([^\s)]+\s+'([^']+)'\)\)/g, '$1');
            title = title.replace(/\(\([^\s)]+\s+"([^\"]+)"\)\)/g, '$1');
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

        if (paramMatch) {
            title = title.replace(/@(.*)$/, '').trim();
            const paramString = paramMatch[1];
            const params = new URLSearchParams(paramString);
            priority = params.get('priority') || undefined;
            startDate = params.get('startDate') || undefined;
            endDate = params.get('endDate') || undefined;
            if (priority && !['high', 'medium', 'low', 'none'].includes(priority)) priority = 'none';
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (startDate && !dateRegex.test(startDate)) startDate = undefined;
            if (endDate && !dateRegex.test(endDate)) endDate = undefined;
        }

        return { title: title.trim() || '未命名任务', priority, startDate, endDate, blockId, completed };
    }

    private async batchCreateSubtasksWithHierarchy(tasks: any[], parentIdForAllTopLevel: string) {
        const reminderData = await readReminderData();

        // 获取项目ID从父任务
        const parent = reminderData[parentIdForAllTopLevel];
        const projectId = parent ? parent.projectId : undefined;

        // 获取当前最大 sort
        const maxSort = Object.values(reminderData)
            .filter((r: any) => r && r.projectId === projectId && typeof r.sort === 'number')
            .reduce((max: number, task: any) => Math.max(max, task.sort || 0), 0) as number;

        let sortCounter = maxSort;

        const createRecursively = async (task: any, parentId?: string) => {
            const taskId = `rem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            sortCounter += 10;

            const newSubtask: any = {
                id: taskId,
                title: task.title,
                note: '',
                date: task.startDate || undefined,
                endDate: task.endDate || undefined,
                priority: task.priority === 'none' ? undefined : task.priority,
                categoryId: parent ? parent.categoryId : undefined,
                projectId: projectId,
                parentId: parentId || parentIdForAllTopLevel,
                completed: !!task.completed,
                created: getLocalDateTimeString(new Date()),
                sort: sortCounter
            };

            if (task.blockId) {
                try {
                    const block = await getBlockByID(task.blockId);
                    if (block) {
                        newSubtask.blockId = task.blockId;
                        newSubtask.docId = block.root_id || task.blockId;
                        if (!task.title || task.title === '未命名任务') {
                            newSubtask.title = block.content || block.fcontent || '未命名任务';
                        }
                        await updateBlockReminderBookmark(task.blockId);
                    }
                } catch (err) {
                    console.warn('绑定块失败:', err);
                }
            }

            reminderData[taskId] = newSubtask;

            if (task.children && task.children.length > 0) {
                for (const child of task.children) {
                    await createRecursively(child, taskId);
                }
            }
        };

        for (const t of tasks) {
            await createRecursively(t, undefined);
        }

        await writeReminderData(reminderData);
        await this.loadReminders();
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    }

    private countTotalTasks(tasks: any[]): number {
        let count = 0;
        const countRecursively = (list: any[]) => {
            for (const t of list) {
                count++;
                if (t.children && t.children.length > 0) countRecursively(t.children);
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

        const blockRefWithTitleMatch = text.match(/\(\(([^)\s]+)\s+['"]([^'\"]+)['"]\)\)/);
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

    private async createSubtask(taskData: any, parentReminder: any) {
        const reminderData = await readReminderData();
        const taskId = `rem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        const newSubtask: any = {
            id: taskId,
            title: taskData.title,
            note: taskData.note || '',
            date: taskData.date || undefined,
            endDate: taskData.endDate || undefined,
            priority: taskData.priority === 'none' ? undefined : taskData.priority,
            categoryId: taskData.categoryId,
            projectId: taskData.projectId, // 添加项目ID
            parentId: parentReminder.id,
            completed: false,
            created: getLocalDateTimeString(),
            sort: 0
        };

        // 如果提供了块ID，添加绑定信息
        if (taskData.blockId) {
            try {
                const block = await getBlockByID(taskData.blockId);
                if (block) {
                    newSubtask.blockId = taskData.blockId;
                    newSubtask.docId = block.root_id || taskData.blockId;

                    // 更新块的书签状态
                    await updateBlockReminderBookmark(taskData.blockId);
                }
            } catch (error) {
                console.error('绑定块失败:', error);
                showMessage("警告：块绑定失败，但任务已创建");
            }
        }

        reminderData[taskId] = newSubtask;
        await writeReminderData(reminderData);

        window.dispatchEvent(new CustomEvent('reminderUpdated'));
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

    private addReminderDialogStyles() {
        // 检查是否已经添加过样式
        if (document.querySelector('#reminder-dialog-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'reminder-dialog-styles';
        style.textContent = `
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
            /* 父任务子任务进度条样式 */
            .reminder-progress-container {
                margin-top: 8px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .reminder-progress-wrap {
                flex: 1;
                background: rgba(0,0,0,0.06);
                height: 8px;
                border-radius: 6px;
                overflow: hidden;
            }
            .reminder-progress-bar {
                height: 100%;
                background: linear-gradient(90deg, #2ecc71, #27ae60);
                transition: width 0.3s ease;
                border-radius: 6px 0 0 6px;
            }
            .reminder-progress-text {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.9;
                min-width: 34px;
                text-align: right;
            }

            /* 分页控件样式 */
            .reminder-pagination-controls {
                margin-top: 8px;
            }
            .reminder-pagination-controls .b3-button {
                min-width: 32px;
                height: 32px;
                padding: 0 8px;
                font-size: 14px;
            }
            .reminder-pagination-controls .b3-button:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 创建文档并绑定提醒
     */
    private async createDocumentAndBind(reminder: any, title: string, content: string): Promise<string> {
        try {
            // 获取插件设置
            const settings = await this.plugin.loadSettings();
            const notebook = settings.newDocNotebook;
            const pathTemplate = settings.newDocPath || '/{{now | date "2006/200601"}}/';

            if (!notebook) {
                throw new Error(t("pleaseConfigureNotebook"));
            }

            // 导入API函数
            const { renderSprig, createDocWithMd } = await import("../api");

            // 渲染路径模板
            let renderedPath: string;
            try {
                // 需要检测pathTemplate是否以/结尾，如果不是，则添加/
                if (!pathTemplate.endsWith('/')) {
                    renderedPath += pathTemplate + '/';
                } else {
                    renderedPath = pathTemplate;
                }
                renderedPath = await renderSprig(renderedPath + title);
            } catch (error) {
                console.error('渲染路径模板失败:', error);
                throw new Error(t("renderPathFailed"));
            }

            // 准备文档内容
            const docContent = content;

            // 创建文档
            const docId = await createDocWithMd(notebook, renderedPath, docContent);

            // 绑定提醒到新创建的文档
            await this.bindReminderToBlock(reminder, docId);

            return docId;
        } catch (error) {
            console.error('创建文档并绑定失败:', error);
            throw error;
        }
    }

    /**
     * 将提醒绑定到指定的块
     */
    private async bindReminderToBlock(reminder: any, blockId: string) {
        try {
            const reminderData = await readReminderData();
            const reminderId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;

            if (reminderData[reminderId]) {
                // 获取块信息
                const block = await getBlockByID(blockId);
                if (!block) {
                    throw new Error('目标块不存在');
                }

                // 更新提醒数据
                reminderData[reminderId].blockId = blockId;
                reminderData[reminderId].docId = block.root_id || blockId;
                reminderData[reminderId].isQuickReminder = false; // 移除快速提醒标记

                await writeReminderData(reminderData);

                // 更新块的书签状态
                await updateBlockReminderBookmark(blockId);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            } else {
                throw new Error('提醒不存在');
            }
        } catch (error) {
            console.error('绑定提醒到块失败:', error);
            throw error;
        }
    }

    /**
     * 打开项目看板
     * @param projectId 项目ID
     */
    private async openProjectKanban(projectId: string) {
        try {
            // 获取项目数据以获取项目标题
            const projectData = await readProjectData();

            if (!projectData || !projectData[projectId]) {
                showMessage("项目不存在");
                return;
            }

            const project = projectData[projectId];

            // 使用openTab打开项目看板
            openTab({
                app: this.plugin.app,
                custom: {
                    title: project.title,
                    icon: "iconProject",
                    id: this.plugin.name + PROJECT_KANBAN_TAB_TYPE,
                    data: {
                        projectId: project.blockId,
                        projectTitle: project.title
                    }
                }
            });
        } catch (error) {
            console.error('打开项目看板失败:', error);
            showMessage("打开项目看板失败");
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
     * 打开四象限面板
     */
    private openEisenhowerMatrix() {
        try {
            // 使用openTab打开四象限面板
            openTab({
                app: this.plugin.app,
                custom: {
                    title: t("eisenhowerMatrix") || "四象限面板",
                    icon: "iconGrid",
                    id: this.plugin.name + EISENHOWER_TAB_TYPE
                }
            });
        } catch (error) {
            console.error('打开四象限面板失败:', error);
            showMessage("打开四象限面板失败");
        }
    }

    /**
     * 显示新建任务对话框
     */
    private showNewTaskDialog() {
        try {
            const today = getLocalDateString();
            const quickDialog = new QuickReminderDialog(
                today, // 初始日期为今天
                undefined, // 不指定初始时间
                () => {
                    // 保存回调：刷新提醒列表
                    this.loadReminders();
                }
            );
            quickDialog.show();
        } catch (error) {
            console.error('显示新建任务对话框失败:', error);
            showMessage("打开新建任务对话框失败");
        }
    }

    /**
     * 显示更多菜单
     */
    private showMoreMenu(event: MouseEvent) {
        try {
            const menu = new Menu("reminderMoreMenu");

            // 添加刷新
            menu.addItem({
                icon: 'iconRefresh',
                label: t("refresh") || "刷新",
                click: () => this.loadReminders()
            });

            // 添加分类管理
            menu.addItem({
                icon: 'iconTags',
                label: t("manageCategories") || "管理分类",
                click: () => this.showCategoryManageDialog()
            });

            // 显示菜单
            if (event.target instanceof HTMLElement) {
                const rect = event.target.getBoundingClientRect();
                menu.open({
                    x: rect.left,
                    y: rect.bottom + 4
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
     * 渲染分页控件
     */
    private renderPaginationControls(truncatedTotal: number) {
        // 移除现有的分页控件
        const existingControls = this.container.querySelector('.reminder-pagination-controls');
        if (existingControls) {
            existingControls.remove();
        }

        // 如果没有分页需求，直接返回
        if (this.totalPages <= 1 && truncatedTotal === 0) {
            return;
        }

        // 创建分页控件容器
        const paginationContainer = document.createElement('div');
        paginationContainer.className = 'reminder-pagination-controls';
        paginationContainer.style.cssText = `
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 12px;
            padding: 12px;
            border-top: 1px solid var(--b3-theme-border);
            background: var(--b3-theme-surface);
        `;

        // 分页信息
        const pageInfo = document.createElement('span');
        pageInfo.style.cssText = `
            font-size: 14px;
            color: var(--b3-theme-on-surface);
            opacity: 0.8;
        `;

        if (this.isPaginationEnabled && this.totalPages > 1) {
            // 上一页按钮
            const prevBtn = document.createElement('button');
            prevBtn.className = 'b3-button b3-button--outline';
            prevBtn.innerHTML = '‹';
            prevBtn.disabled = this.currentPage <= 1;
            prevBtn.onclick = () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.loadReminders();
                }
            };

            // 下一页按钮
            const nextBtn = document.createElement('button');
            nextBtn.className = 'b3-button b3-button--outline';
            nextBtn.innerHTML = '›';
            nextBtn.disabled = this.currentPage >= this.totalPages;
            nextBtn.onclick = () => {
                if (this.currentPage < this.totalPages) {
                    this.currentPage++;
                    this.loadReminders();
                }
            };

            // 页码信息
            pageInfo.textContent = `第 ${this.currentPage} 页，共 ${this.totalPages} 页 (${this.totalItems} 条)`;

            paginationContainer.appendChild(prevBtn);
            paginationContainer.appendChild(pageInfo);
            paginationContainer.appendChild(nextBtn);
        } else if (truncatedTotal > 0) {
            // 非分页模式下的截断提示
            pageInfo.textContent = `已展示 ${this.currentRemindersCache.length} 条，还隐藏 ${truncatedTotal} 条`;
            paginationContainer.appendChild(pageInfo);
        } else {
            // 没有截断时的信息
            pageInfo.textContent = `共 ${this.totalItems} 条`;
            paginationContainer.appendChild(pageInfo);
        }

        // 将分页控件添加到容器底部
        this.container.appendChild(paginationContainer);
    }

    /**
     * 获取提醒的番茄钟计数
     */
    private async getReminderPomodoroCount(reminderId: string): Promise<number> {
        try {
            const { PomodoroRecordManager } = await import("../utils/pomodoroRecord");
            const pomodoroManager = PomodoroRecordManager.getInstance();
            return await pomodoroManager.getReminderPomodoroCount(reminderId);
        } catch (error) {
            console.error('获取番茄钟计数失败:', error);
            return 0;
        }
    }
}