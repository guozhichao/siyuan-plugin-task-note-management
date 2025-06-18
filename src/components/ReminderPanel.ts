import { showMessage, confirm, Dialog, Menu, openTab } from "siyuan";
import { readReminderData, writeReminderData, sql, updateBlock, getBlockKramdown, getBlockByID, updateBlockReminderBookmark } from "../api";
import { getLocalDateString, compareDateStrings, getLocalDateTime, getLocalDateTimeString } from "../utils/dateUtils";
import { loadSortConfig, saveSortConfig, getSortMethodName } from "../utils/sortConfig";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { CategoryManager, Category } from "../utils/categoryManager";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { t } from "../utils/i18n";
import { generateRepeatInstances, getRepeatDescription } from "../utils/repeatUtils";
import { PomodoroTimer } from "./PomodoroTimer";

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

    // 添加静态变量来跟踪当前活动的番茄钟
    private static currentPomodoroTimer: PomodoroTimer | null = null;

    constructor(container: HTMLElement, plugin?: any, closeCallback?: () => void) {
        this.container = container;
        this.plugin = plugin;
        this.closeCallback = closeCallback;
        this.categoryManager = CategoryManager.getInstance(); // 初始化分类管理器

        // 创建事件处理器
        this.reminderUpdatedHandler = () => {
            this.loadReminders();
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

        // 监听提醒更新事件
        window.addEventListener('reminderUpdated', this.reminderUpdatedHandler);
        // 监听排序配置更新事件
        window.addEventListener('sortConfigUpdated', this.sortConfigUpdatedHandler);
    }

    // 添加销毁方法以清理事件监听器
    public destroy() {
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

        // 添加右侧按钮容器
        const actionContainer = document.createElement('div');
        actionContainer.className = 'reminder-panel__actions';
        actionContainer.style.marginLeft = 'auto';

        // 添加分类管理按钮
        const categoryManageBtn = document.createElement('button');
        categoryManageBtn.className = 'b3-button b3-button--outline';
        categoryManageBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTags"></use></svg>';
        categoryManageBtn.title = "管理分类";
        categoryManageBtn.addEventListener('click', () => {
            this.showCategoryManageDialog();
        });
        actionContainer.appendChild(categoryManageBtn);

        // 添加日历视图按钮
        if (this.plugin) {
            const calendarBtn = document.createElement('button');
            calendarBtn.className = 'b3-button b3-button--outline';
            calendarBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg>';
            calendarBtn.title = t("calendarView");
            calendarBtn.addEventListener('click', () => {
                this.plugin.openCalendarTab();
            });
            actionContainer.appendChild(calendarBtn);
        }

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

        // 添加刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = t("refresh");
        refreshBtn.addEventListener('click', () => {
            this.loadReminders();
        });
        actionContainer.appendChild(refreshBtn);

        titleContainer.appendChild(actionContainer);

        header.appendChild(titleContainer);

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
            <option value="todayCompleted">${t("todayCompletedReminders")}</option>
            <option value="completed">${t("completedReminders")}</option>
            <option value="all">${t("past7Reminders")}</option>
        `;
        this.filterSelect.addEventListener('change', () => {
            this.currentTab = this.filterSelect.value;
            this.loadReminders();
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
        console.log('应用排序方式:', sortType, sortOrder, '提醒数量:', reminders.length);

        // 特殊处理已完成相关的筛选器
        const isCompletedFilter = this.currentTab === 'completed' || this.currentTab === 'todayCompleted';
        const isPast7Filter = this.currentTab === 'all';

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

            // 对于已完成相关的筛选器，默认按完成时间降序排序
            if (isCompletedFilter || (isPast7Filter && a.completed && b.completed)) {
                result = this.compareByCompletedTime(a, b);
                if (result !== 0) {
                    return result; // 直接返回完成时间比较结果，不需要考虑升降序
                }
            }

            // 应用用户选择的排序方式
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
                    console.warn('未知的排序类型:', sortType, '默认使用时间排序');
                    result = this.compareByTime(a, b);
            }

            // 优先级升降序的结果相反
            if (sortType === 'priority') {
                result = -result;
            }

            // 应用升降序
            return sortOrder === 'desc' ? -result : result;
        });

        console.log('排序完成，排序方式:', sortType, sortOrder);
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
                <option value="all" ${this.currentCategoryFilter === 'all' ? 'selected' : ''}>全部分类</option>
                <option value="none" ${this.currentCategoryFilter === 'none' ? 'selected' : ''}>无分类</option>
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
            this.categoryFilterSelect.innerHTML = '<option value="all">全部分类</option>';
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
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                `;

                // 添加文档图标
                const docIcon = document.createElement('span');
                docIcon.innerHTML = '📄';
                docIcon.style.fontSize = '10px';

                // 添加文档标题文本
                const docTitleText = document.createElement('span');
                docTitleText.textContent = docBlock.content;
                docTitleText.title = `所属文档: ${docBlock.content}`;

                // 点击事件：打开文档
                docTitleEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openBlock(docId);
                });

                // 鼠标悬停效果
                docTitleEl.addEventListener('mouseenter', () => {
                    docTitleEl.style.color = 'var(--b3-theme-primary)';
                });
                docTitleEl.addEventListener('mouseleave', () => {
                    docTitleEl.style.color = 'var(--b3-theme-on-background)';
                });

                docTitleEl.appendChild(docIcon);
                docTitleEl.appendChild(docTitleText);

                // 将文档标题插入到容器的最前面
                container.insertBefore(docTitleEl, container.firstChild);
            }
        } catch (error) {
            console.warn('获取文档标题失败:', error);
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
                            await this.loadReminders();
                            console.log('排序已更新为:', option.key, 'asc');
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
                            await this.loadReminders();
                            console.log('排序已更新为:', option.key, 'desc');
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
            console.log(`当前排序方式: ${currentName}`);
        }
    }

    private async loadReminders() {
        try {
            const reminderData = await readReminderData();

            if (!reminderData || typeof reminderData !== 'object') {
                this.updateReminderCounts(0, 0, 0, 0, 0, 0);
                this.renderReminders([]);
                return;
            }

            const today = getLocalDateString();
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = getLocalDateString(tomorrow);

            // 计算未来7天的日期范围
            const future7Days = new Date();
            future7Days.setDate(future7Days.getDate() + 7);
            const future7DaysStr = getLocalDateString(future7Days);

            // 计算过去七天的日期范围
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const sevenDaysAgoStr = getLocalDateString(sevenDaysAgo);

            const reminders = Object.values(reminderData).filter((reminder: any) => {
                return reminder && typeof reminder === 'object' && reminder.id && reminder.date;
            });

            // 处理重复事件 - 生成重复实例，但确保每个原始事件只显示一次最近的实例
            const allReminders = [];
            const repeatInstancesMap = new Map();
            const processedOriginalIds = new Set(); // 跟踪已处理的原始事件

            reminders.forEach((reminder: any) => {
                // 添加原始事件
                allReminders.push(reminder);

                // 如果有重复设置，生成重复事件实例
                if (reminder.repeat?.enabled) {
                    processedOriginalIds.add(reminder.id);

                    const now = new Date();
                    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
                    const startDate = getLocalDateString(monthStart);
                    const endDate = getLocalDateString(monthEnd);

                    const repeatInstances = generateRepeatInstances(reminder, startDate, endDate);

                    // 为每个原始事件只保留一个最近的未来实例
                    let nearestFutureInstance = null;
                    let nearestFutureDate = null;

                    repeatInstances.forEach(instance => {
                        // 跳过与原始事件相同日期的实例
                        if (instance.date !== reminder.date) {
                            // 检查实例级别的完成状态
                            const completedInstances = reminder.repeat?.completedInstances || [];
                            const isInstanceCompleted = completedInstances.includes(instance.date);

                            // 检查实例级别的修改（包括备注）
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
                                note: instanceMod?.note || ''
                            };

                            // 只在未来7天筛选中使用去重逻辑
                            if (this.currentTab === 'future7') {
                                // 只保留未来的实例，并选择最近的一个
                                if (compareDateStrings(instance.date, today) > 0) {
                                    if (!nearestFutureInstance ||
                                        compareDateStrings(instance.date, nearestFutureDate) < 0) {
                                        nearestFutureInstance = instanceReminder;
                                        nearestFutureDate = instance.date;
                                    }
                                }
                            } else {
                                // 其他筛选保持原有逻辑
                                const key = `${reminder.id}_${instance.date}`;
                                if (!repeatInstancesMap.has(key) ||
                                    compareDateStrings(instance.date, repeatInstancesMap.get(key).date) < 0) {
                                    repeatInstancesMap.set(key, instanceReminder);
                                }
                            }
                        }
                    });

                    // 如果是未来7天筛选且找到了最近的未来实例，添加它
                    if (this.currentTab === 'future7' && nearestFutureInstance) {
                        const key = `${reminder.id}_future`;
                        repeatInstancesMap.set(key, nearestFutureInstance);
                    }
                }
            });

            // 添加去重后的重复事件实例
            repeatInstancesMap.forEach(instance => {
                allReminders.push(instance);
            });

            // 应用分类过滤
            const filteredReminders = this.applyCategoryFilter(allReminders);

            // 辅助函数：检查提醒是否有效完成（包括跨天事件的今日已完成）
            const isEffectivelyCompleted = (reminder: any) => {
                // 如果提醒本身已完成，返回true
                if (reminder.completed) return true;

                // 检查跨天事件的今日已完成状态
                if (reminder.endDate && reminder.endDate !== reminder.date) {
                    // 确保今天在事件的时间范围内
                    const isInRange = compareDateStrings(reminder.date, today) <= 0 &&
                        compareDateStrings(today, reminder.endDate) <= 0;

                    if (isInRange) {
                        return this.isSpanningEventTodayCompleted(reminder);
                    }
                }

                return false;
            };

            // 分类提醒 - 改进过期判断逻辑
            const overdue = filteredReminders.filter((reminder: any) => {
                if (isEffectivelyCompleted(reminder)) return false;

                // 对于跨天事件，以结束日期判断是否过期
                if (reminder.endDate) {
                    return compareDateStrings(reminder.endDate, today) < 0;
                } else {
                    // 对于单日事件，以开始日期判断是否过期
                    return compareDateStrings(reminder.date, today) < 0;
                }
            });

            // 今日提醒 - 改进跨天事件判断逻辑，包含过期事项，但排除已标记"今日已完成"的跨天事件
            const todayReminders = filteredReminders.filter((reminder: any) => {
                if (isEffectivelyCompleted(reminder)) return false;

                if (reminder.endDate) {
                    // 跨天事件：只要今天在事件的时间范围内就显示，或者事件已过期但结束日期在今天之前
                    const inRange = (compareDateStrings(reminder.date, today) <= 0 &&
                        compareDateStrings(today, reminder.endDate) <= 0) ||
                        compareDateStrings(reminder.endDate, today) < 0;

                    return inRange;
                } else {
                    // 单日事件：今天或过期的都显示在今日
                    return reminder.date === today || compareDateStrings(reminder.date, today) < 0;
                }
            });

            // 明天提醒 - 改进跨天事件判断逻辑
            const tomorrowReminders = [];
            const tomorrowInstancesMap = new Map();

            filteredReminders.forEach((reminder: any) => {
                if (isEffectivelyCompleted(reminder)) return;

                let isTomorrow = false;
                if (reminder.endDate) {
                    // 跨天事件：明天在事件的时间范围内
                    isTomorrow = compareDateStrings(reminder.date, tomorrowStr) <= 0 &&
                        compareDateStrings(tomorrowStr, reminder.endDate) <= 0;
                } else {
                    // 单日事件：明天的事件
                    isTomorrow = reminder.date === tomorrowStr;
                }

                if (isTomorrow) {
                    if (reminder.isRepeatInstance) {
                        const originalId = reminder.originalId;
                        if (!tomorrowInstancesMap.has(originalId) ||
                            compareDateStrings(reminder.date, tomorrowInstancesMap.get(originalId).date) < 0) {
                            tomorrowInstancesMap.set(originalId, reminder);
                        }
                    } else {
                        tomorrowReminders.push(reminder);
                    }
                }
            });

            tomorrowInstancesMap.forEach(instance => {
                tomorrowReminders.push(instance);
            });

            // 未来7天提醒 - 修改筛选逻辑，包括明天
            const future7DaysReminders = [];
            const future7InstancesMap = new Map();

            filteredReminders.forEach((reminder: any) => {
                if (isEffectivelyCompleted(reminder)) return;

                let isFuture7Days = false;
                const reminderStartDate = reminder.date;
                const reminderEndDate = reminder.endDate || reminder.date;

                // 修改：事件必须在明天到未来7天之间（包括明天）
                if (reminder.endDate) {
                    // 跨天事件：事件范围与未来7天有交集
                    isFuture7Days = compareDateStrings(reminderStartDate, future7DaysStr) <= 0 &&
                        compareDateStrings(tomorrowStr, reminderEndDate) <= 0;
                } else {
                    // 单日事件：在明天到未来7天之间（包括明天）
                    isFuture7Days = compareDateStrings(tomorrowStr, reminderStartDate) <= 0 &&
                        compareDateStrings(reminderStartDate, future7DaysStr) <= 0;
                }

                if (isFuture7Days) {
                    if (reminder.isRepeatInstance) {
                        const originalId = reminder.originalId;
                        // 对于重复事件实例，只保留最近的一个
                        if (!future7InstancesMap.has(originalId) ||
                            compareDateStrings(reminder.date, future7InstancesMap.get(originalId).date) < 0) {
                            future7InstancesMap.set(originalId, reminder);
                        }
                    } else {
                        future7DaysReminders.push(reminder);
                    }
                }
            });

            future7InstancesMap.forEach(instance => {
                future7DaysReminders.push(instance);
            });

            // 修改过去七天提醒的筛选逻辑
            const pastSevenDaysReminders = filteredReminders.filter((reminder: any) => {
                // 过去七天：仅包括过去7天内的提醒（不包括今天之后的）
                const reminderStartDate = reminder.date;
                const reminderEndDate = reminder.endDate || reminder.date;

                // 事件必须在过去7天到昨天之间
                return compareDateStrings(sevenDaysAgoStr, reminderStartDate) <= 0 &&
                    compareDateStrings(reminderEndDate, today) < 0;
            });

            // 已完成提醒 - 包括标准完成和跨天事件的今日已完成
            const completed = filteredReminders.filter((reminder: any) => isEffectivelyCompleted(reminder));

            // 今日已完成 - 筛选今天完成的任务，包括跨天事件的今日已完成
            const todayCompleted = filteredReminders.filter((reminder: any) => {
                // 检查标准完成状态
                if (reminder.completed) {
                    // 对于跨天事件，如果今天在事件范围内且已完成，则显示
                    if (reminder.endDate) {
                        return compareDateStrings(reminder.date, today) <= 0 &&
                            compareDateStrings(today, reminder.endDate) <= 0;
                    } else {
                        // 对于单日事件，事件日期是今天且已完成
                        return reminder.date === today;
                    }
                }

                // 检查跨天事件的今日已完成状态
                if (reminder.endDate && reminder.endDate !== reminder.date) {
                    // 确保今天在事件的时间范围内
                    const isInRange = compareDateStrings(reminder.date, today) <= 0 &&
                        compareDateStrings(today, reminder.endDate) <= 0;

                    if (isInRange) {
                        return this.isSpanningEventTodayCompleted(reminder);
                    }
                }

                return false;
            });

            this.updateReminderCounts(overdue.length, todayReminders.length, tomorrowReminders.length, future7DaysReminders.length, completed.length, todayCompleted.length);

            // 根据当前选中的标签显示对应的提醒
            let displayReminders = [];
            switch (this.currentTab) {
                case 'overdue':
                    displayReminders = overdue;
                    break;
                case 'today':
                    displayReminders = todayReminders;
                    break;
                case 'tomorrow':
                    displayReminders = tomorrowReminders;
                    break;
                case 'future7':
                    displayReminders = future7DaysReminders;
                    break;
                case 'completed':
                    displayReminders = completed;
                    break;
                case 'todayCompleted':
                    displayReminders = todayCompleted;
                    break;
                case 'all':
                    displayReminders = pastSevenDaysReminders;
                    break;
                default:
                    displayReminders = [...todayReminders, ...tomorrowReminders];
            }

            // 应用排序 - 确保在显示前排序
            this.sortReminders(displayReminders);

            // 缓存当前提醒列表
            this.currentRemindersCache = [...displayReminders];

            // 修改为异步处理提醒元素创建
            const createRemindersAsync = async () => {
                this.remindersContainer.innerHTML = ''; // 先清空容器

                for (const reminder of displayReminders) {
                    const reminderEl = await this.createReminderElement(reminder, today);
                    this.remindersContainer.appendChild(reminderEl);
                }

            };

            await createRemindersAsync();

        } catch (error) {
            console.error('加载提醒失败:', error);
            showMessage(t("loadRemindersFailed"));
         }
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
        if (!reminderData || typeof reminderData !== 'object') {
            this.remindersContainer.innerHTML = `<div class="reminder-empty">${t("noReminders")}</div>`;
            return;
        }

        const filter = this.filterSelect.value;
        const today = getLocalDateString();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = getLocalDateString(tomorrow);

        // 计算未来7天的日期范围
        const future7Days = new Date();
        future7Days.setDate(future7Days.getDate() + 7);
        const future7DaysStr = getLocalDateString(future7Days);

        // 计算过去七天的日期范围
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const sevenDaysAgoStr = getLocalDateString(sevenDaysAgo);

        const reminders = Array.isArray(reminderData) ? reminderData : Object.values(reminderData).filter((reminder: any) => {
            if (!reminder || typeof reminder !== 'object' || !reminder.id) return false;

            switch (filter) {
                case 'today':
                    if (reminder.completed) return false;
                    if (reminder.endDate) {
                        // 跨天事件：今天在事件的时间范围内，或者事件已过期
                        return (compareDateStrings(reminder.date, today) <= 0 &&
                            compareDateStrings(today, reminder.endDate) <= 0) ||
                            compareDateStrings(reminder.endDate, today) < 0;
                    } else {
                        // 单日事件：今日或过期
                        return reminder.date === today || compareDateStrings(reminder.date, today) < 0;
                    }
                case 'tomorrow':
                    if (reminder.completed) return false;
                    if (reminder.endDate) {
                        // 跨天事件：明天在事件的时间范围内
                        return compareDateStrings(reminder.date, tomorrowStr) <= 0 &&
                            compareDateStrings(tomorrowStr, reminder.endDate) <= 0;
                    } else {
                        // 单日事件：明天的事件
                        return reminder.date === tomorrowStr;
                    }
                case 'future7':
                    if (reminder.completed) return false;

                    const reminderStartDate = reminder.date;
                    const reminderEndDate = reminder.endDate || reminder.date;

                    if (reminder.endDate) {
                        // 跨天事件：事件范围与未来7天有交集
                        return compareDateStrings(reminderStartDate, future7DaysStr) <= 0 &&
                            compareDateStrings(tomorrowStr, reminderEndDate) <= 0;
                    } else {
                        // 单日事件：在明天到未来7天之间（包括明天）
                        return compareDateStrings(tomorrowStr, reminderStartDate) <= 0 &&
                            compareDateStrings(reminderStartDate, future7DaysStr) <= 0;
                    }
                case 'overdue':
                    if (reminder.completed) return false;
                    if (reminder.endDate) {
                        // 跨天事件：结束日期已过期
                        return compareDateStrings(reminder.endDate, today) < 0;
                    } else {
                        // 单日事件：开始日期已过期
                        return compareDateStrings(reminder.date, today) < 0;
                    }
                case 'completed':
                    return reminder.completed;
                case 'todayCompleted':
                    if (!reminder.completed) return false;
                    // 对于跨天事件，如果今天在事件范围内且已完成，则显示
                    if (reminder.endDate) {
                        return compareDateStrings(reminder.date, today) <= 0 &&
                            compareDateStrings(today, reminder.endDate) <= 0;
                    } else {
                        // 对于单日事件，事件日期是今天且已完成
                        return reminder.date === today;
                    }
                case 'all':
                    // 修改过去七天的筛选逻辑：仅包括过去7天内的提醒
                    const reminderStartDate2 = reminder.date;
                    const reminderEndDate2 = reminder.endDate || reminder.date;

                    // 事件必须在过去7天到昨天之间
                    return compareDateStrings(sevenDaysAgoStr, reminderStartDate2) <= 0 &&
                        compareDateStrings(reminderEndDate2, today) < 0;
                default:
                    return true;
            }
        });

        if (reminders.length === 0) {
            const filterNames = {
                'today': t("noTodayReminders"),
                'tomorrow': t("noTomorrowReminders"),
                'future7': t("noFuture7Reminders"),
                'overdue': t("noOverdueReminders"),
                'completed': t("noCompletedReminders"),
                'todayCompleted': "今日暂无已完成任务",
                'all': t("noPast7Reminders")
            };
            this.remindersContainer.innerHTML = `<div class="reminder-empty">${filterNames[filter] || t("noReminders")}</div>`;
            return;
        }

        // 应用排序
        this.sortReminders(reminders);

        this.remindersContainer.innerHTML = '';

        reminders.forEach((reminder: any) => {
            const reminderEl = this.createReminderElement(reminder, today);
            this.remindersContainer.appendChild(reminderEl);
        });

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

        // 如果都有完成时间，按完成时间降序排序（最近完成的在前）
        if (completedTimeA && completedTimeB) {
            const timeA = new Date(completedTimeA).getTime();
            const timeB = new Date(completedTimeB).getTime();
            return timeB - timeA; // 降序：最近的在前
        }

        // 如果只有一个有完成时间，有完成时间的在前
        if (completedTimeA && !completedTimeB) return -1;
        if (!completedTimeA && completedTimeB) return 1;

        // 如果都没有完成时间，按设置的时间降序排序
        const dateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00'));
        const dateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00'));
        return dateB.getTime() - dateA.getTime(); // 降序：最近的在前
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
                // 处理重复事件实例的完成状态
                const originalId = reminderId; // 这里 reminderId 应该是原始ID

                if (reminderData[originalId]) {
                    // 初始化已完成实例列表和完成时间记录
                    if (!reminderData[originalId].repeat.completedInstances) {
                        reminderData[originalId].repeat.completedInstances = [];
                    }
                    if (!reminderData[originalId].repeat.completedTimes) {
                        reminderData[originalId].repeat.completedTimes = {};
                    }

                    const completedInstances = reminderData[originalId].repeat.completedInstances;
                    const completedTimes = reminderData[originalId].repeat.completedTimes;

                    if (completed) {
                        // 添加到已完成列表并记录完成时间
                        if (!completedInstances.includes(instanceDate)) {
                            completedInstances.push(instanceDate);
                        }
                        completedTimes[instanceDate] = getLocalDateTimeString(new Date());
                    } else {
                        // 从已完成列表中移除并删除完成时间
                        const index = completedInstances.indexOf(instanceDate);
                        if (index > -1) {
                            completedInstances.splice(index, 1);
                        }
                        delete completedTimes[instanceDate];
                    }

                    await writeReminderData(reminderData);

                    // 更新块的书签状态
                    const blockId = reminderData[originalId].blockId;
                    if (blockId) {
                        await updateBlockReminderBookmark(blockId);
                        // 完成时自动处理任务列表
                        if (completed) {
                            await this.handleTaskListCompletion(blockId);
                        }
                        else {
                            await this.handleTaskListCompletionCancel(blockId);
                        }
                    }

                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                    this.loadReminders();
                }
            } else if (reminderData[reminderId]) {
                // 处理普通事件的完成状态
                const blockId = reminderData[reminderId].blockId;
                reminderData[reminderId].completed = completed;

                // 记录或清除完成时间
                if (completed) {
                    reminderData[reminderId].completedTime = getLocalDateTimeString(new Date());
                } else {
                    delete reminderData[reminderId].completedTime;
                }

                await writeReminderData(reminderData);

                // 更新块的书签状态
                if (blockId) {
                    await updateBlockReminderBookmark(blockId);
                    // 完成时自动处理任务列表
                    if (completed) {
                        await this.handleTaskListCompletion(blockId);
                    }
                    else {
                        await this.handleTaskListCompletionCancel(blockId);
                    }
                }

                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                this.loadReminders();
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
            console.log('获取块的 kramdown 内容:', blockId, kramdown);
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

    private async openBlock(blockId: string) {
        try {
            // 检测块是否存在
            const block = await getBlockByID(blockId);
            if (!block) {
                throw new Error('块不存在');
            }

            openTab({
                app: window.siyuan.ws.app,
                doc: {
                    id: blockId,
                    action: ["cb-get-focus","cb-get-hl"]
                },
                keepCursor: false,
                removeCurrentTab: false
            });
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

    private formatReminderTime(date: string, time?: string, today?: string, endDate?: string): string {
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

            const timeStr = time ? ` ${time}` : '';
            return `${dateStr} → ${endDateStr}${timeStr}`;
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

    private createReminderElement(reminder: any, today: string): HTMLElement {
        // 改进过期判断逻辑
        let isOverdue = false;
        if (!reminder.completed) {
            if (reminder.endDate) {
                // 跨天事件：以结束日期判断是否过期
                isOverdue = compareDateStrings(reminder.endDate, today) < 0;
            } else {
                // 单日事件：以开始日期判断是否过期
                isOverdue = compareDateStrings(reminder.date, today) < 0;
            }
        }

        const isSpanningDays = reminder.endDate && reminder.endDate !== reminder.date;
        const priority = reminder.priority || 'none';

        const reminderEl = document.createElement('div');
        reminderEl.className = `reminder-item ${isOverdue ? 'reminder-item--overdue' : ''} ${isSpanningDays ? 'reminder-item--spanning' : ''} reminder-priority-${priority}`;

        // 存储提醒数据到元素
        reminderEl.dataset.reminderId = reminder.id;
        reminderEl.dataset.priority = priority;

        // 在优先级排序模式下添加拖拽功能
        if (this.currentSort === 'priority') {
            this.addDragFunctionality(reminderEl, reminder);
        }

        // 添加右键菜单支持
        reminderEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showReminderContextMenu(e, reminder);
        });

        const contentEl = document.createElement('div');
        contentEl.className = 'reminder-item__content';

        // 复选框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';

        // 正确设置复选框状态
        if (reminder.isRepeatInstance) {
            // 对于重复事件实例，使用实例级别的完成状态
            checkbox.checked = reminder.completed || false;
        } else {
            // 对于普通事件，使用事件本身的完成状态
            checkbox.checked = reminder.completed || false;
        }

        checkbox.addEventListener('change', () => {
            if (reminder.isRepeatInstance) {
                // 对于重复事件实例，使用原始ID和实例日期
                this.toggleReminder(reminder.originalId, checkbox.checked, true, reminder.date);
            } else {
                // 对于普通事件，使用原有逻辑
                this.toggleReminder(reminder.id, checkbox.checked);
            }
        });

        // 信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'reminder-item__info';

        // 标题容器
        const titleContainer = document.createElement('div');
        titleContainer.className = 'reminder-item__title-container';

        // 检查是否需要显示文档标题
        if (reminder.docId && reminder.blockId !== reminder.docId) {
            // 异步获取并显示文档标题
            this.addDocumentTitle(titleContainer, reminder.docId);
        }

        // 标题
        const titleEl = document.createElement('a');
        titleEl.className = 'reminder-item__title';
        titleEl.textContent = reminder.title || t("unnamedNote");
        titleEl.href = '#';
        titleEl.addEventListener('click', (e) => {
            e.preventDefault();
            // 如果存在docId
            if (reminder.docId) {
                // 打开文档
                this.openBlock(reminder.docId);
                // 需要等待500ms
                setTimeout(() => {
                    // 打开块
                    this.openBlock(reminder.blockId || reminder.id);
                }, 500);
            } else {
                this.openBlock(reminder.blockId || reminder.id);
            }
        });

        titleContainer.appendChild(titleEl);

        // 时间信息容器
        const timeContainer = document.createElement('div');
        timeContainer.className = 'reminder-item__time-container';
        timeContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        // 添加重复图标
        if (reminder.repeat?.enabled || reminder.isRepeatInstance) {
            const repeatIcon = document.createElement('span');
            repeatIcon.className = 'reminder-repeat-icon';
            repeatIcon.textContent = '🔄';
            repeatIcon.title = reminder.repeat?.enabled ?
                getRepeatDescription(reminder.repeat) :
                t("repeatInstance");
            repeatIcon.style.cssText = `
                font-size: 12px;
                opacity: 0.7;
                flex-shrink: 0;
            `;
            timeContainer.appendChild(repeatIcon);
        }

        // 时间信息
        const timeEl = document.createElement('div');
        timeEl.className = 'reminder-item__time';
        const timeText = this.formatReminderTime(reminder.date, reminder.time, today, reminder.endDate);
        timeEl.textContent = '🕐' + timeText;
        timeEl.style.cursor = 'pointer';
        timeEl.title = t("clickToModifyTime");

        // 添加优先级标签
        if (priority !== 'none') {
            const priorityLabel = document.createElement('span');
            priorityLabel.className = `reminder-priority-label ${priority}`;
            const priorityNames = {
                'high': t("highPriority"),
                'medium': t("mediumPriority"),
                'low': t("lowPriority")
            };
            priorityLabel.innerHTML = `<div class="priority-dot ${priority}"></div>${priorityNames[priority]}`;
            timeEl.appendChild(priorityLabel);
        }

        // 添加时间点击编辑事件
        timeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            // 对于重复事件实例，编辑原始事件
            if (reminder.isRepeatInstance) {
                this.editOriginalReminder(reminder.originalId);
            } else {
                this.showTimeEditDialog(reminder);
            }
        });

        if (isOverdue) {
            const overdueLabel = document.createElement('span');
            overdueLabel.className = 'reminder-overdue-label';
            overdueLabel.textContent = t("overdue");
            timeEl.appendChild(overdueLabel);
        }

        timeContainer.appendChild(timeEl);

        // 添加完成时间显示
        if (reminder.completed) {
            const completedTimeEl = document.createElement('div');
            completedTimeEl.className = 'reminder-completed-time';
            completedTimeEl.style.cssText = `
                font-size: 11px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                margin-top: 2px;
                display: flex;
                align-items: center;
                gap: 4px;
            `;

            // 获取完成时间
            let completedTime = null;
            if (reminder.isRepeatInstance) {
                // 重复事件实例的完成时间
                const originalReminder = this.getOriginalReminder(reminder.originalId);
                if (originalReminder && originalReminder.repeat?.completedTimes) {
                    completedTime = originalReminder.repeat.completedTimes[reminder.date];
                }
            } else {
                // 普通事件的完成时间
                completedTime = reminder.completedTime;
            }

            if (completedTime) {
                const completedIcon = document.createElement('span');
                completedIcon.textContent = '✅';
                completedIcon.style.cssText = 'font-size: 10px;';

                const completedText = document.createElement('span');
                completedText.textContent = `完成于${this.formatCompletedTime(completedTime)}`;

                completedTimeEl.appendChild(completedIcon);
                completedTimeEl.appendChild(completedText);
                timeContainer.appendChild(completedTimeEl);
            }
        }

        infoEl.appendChild(titleContainer);
        infoEl.appendChild(timeContainer);

        // 优化分类显示 - 确保emoji正确显示
        if (reminder.categoryId) {
            const category = this.categoryManager.getCategoryById(reminder.categoryId);
            if (category) {
                const categoryContainer = document.createElement('div');
                categoryContainer.className = 'reminder-item__category-container';
                categoryContainer.style.cssText = `
                    margin-top: 4px;
                `;

                const categoryEl = document.createElement('div');
                categoryEl.className = 'reminder-category-tag';
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

                // 分别处理emoji和名称
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

        // 添加番茄数量显示（在分类后）
        const targetReminder = reminder.isRepeatInstance ?
            (this.getOriginalReminder(reminder.originalId) || reminder) :
            reminder;

        if (targetReminder.pomodoroCount && targetReminder.pomodoroCount > 0) {
            const pomodoroDisplay = document.createElement('div');
            pomodoroDisplay.className = 'reminder-pomodoro-count';
            pomodoroDisplay.style.cssText = `
                font-size: 12px;
                display: inline-flex;
                align-items: center;
                gap: 2px;
                margin-top: 2px;
            `;

            // 生成番茄emoji
            const tomatoEmojis = '🍅'.repeat(Math.min(targetReminder.pomodoroCount, 5));
            const extraCount = targetReminder.pomodoroCount > 5 ? `+${targetReminder.pomodoroCount - 5}` : '';

            pomodoroDisplay.innerHTML = `
                <span title="完成的番茄钟数量: ${targetReminder.pomodoroCount}">${tomatoEmojis}${extraCount}</span>
            `;

            infoEl.appendChild(pomodoroDisplay);
        }

        // 备注
        if (reminder.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-item__note';
            noteEl.textContent = reminder.note;
            infoEl.appendChild(noteEl);
        }

        contentEl.appendChild(checkbox);
        contentEl.appendChild(infoEl);
        reminderEl.appendChild(contentEl);

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

        element.addEventListener('dragend', (e) => {
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

        element.addEventListener('dragleave', (e) => {
            this.hideDropIndicator();
        });
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
    // 添加缓存当前提醒列表
    private currentRemindersCache: any[] = [];

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


    /**
     * [MODIFIED] This function has been refactored to handle all reminder types
     * and provide a consistent context menu as per user request.
     */
    private showReminderContextMenu(event: MouseEvent, reminder: any) {
        const menu = new Menu("reminderContextMenu");
        const today = getLocalDateString();
        const isSpanningDays = reminder.endDate && reminder.endDate !== reminder.date;

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

        if (reminder.isRepeatInstance) {
            // --- Menu for a REPEAT INSTANCE ---
            menu.addItem({
                iconHTML: "📋",
                label: "复制块引",
                click: () => this.copyBlockRef(reminder)
            });

            // 为跨天的重复事件实例添加"今日已完成"选项
            if (isSpanningInToday && !reminder.completed) {
                const isTodayCompleted = this.isSpanningEventTodayCompleted(reminder);
                menu.addItem({
                    iconHTML: isTodayCompleted ? "🔄" : "✅",
                    label: isTodayCompleted ? "取消今日已完成" : "今日已完成",
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
                label: "设置分类",
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
                label: "开始番茄钟",
                click: () => this.startPomodoro(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: "开始正计时",
                click: () => this.startPomodoroCountUp(reminder)
            });

        } else if (reminder.repeat?.enabled) {
            // --- Menu for the ORIGINAL RECURRING EVENT ---
            menu.addItem({
                iconHTML: "📋",
                label: "复制块引用",
                click: () => this.copyBlockRef(reminder)
            });

            // 为跨天的重复事件添加"今日已完成"选项
            if (isSpanningInToday && !reminder.completed) {
                const isTodayCompleted = this.isSpanningEventTodayCompleted(reminder);
                menu.addItem({
                    iconHTML: isTodayCompleted ? "🔄" : "✅",
                    label: isTodayCompleted ? "取消今日已完成" : "今日已完成",
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
                label: "设置分类",
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
                label: "开始番茄钟",
                click: () => this.startPomodoro(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: "开始正计时",
                click: () => this.startPomodoroCountUp(reminder)
            });

        } else {
            // --- Menu for a SIMPLE, NON-RECURRING EVENT ---
            menu.addItem({
                iconHTML: "📋",
                label: "复制块引用",
                click: () => this.copyBlockRef(reminder)
            });

            // 为跨天的普通事件添加"今日已完成"选项
            if (isSpanningInToday && !reminder.completed) {
                const isTodayCompleted = this.isSpanningEventTodayCompleted(reminder);
                menu.addItem({
                    iconHTML: isTodayCompleted ? "🔄" : "✅",
                    label: isTodayCompleted ? "取消今日已完成" : "今日已完成",
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
                label: "设置分类",
                submenu: createCategoryMenuItems()
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🍅",
                label: "开始番茄钟",
                click: () => this.startPomodoro(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: "开始正计时",
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
            showMessage("已标记今日已完成");
            this.loadReminders();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            // 通知插件更新徽章
            if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                this.plugin.updateBadges();
            }
        } catch (error) {
            console.error('标记今日已完成失败:', error);
            showMessage("操作失败");
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
            showMessage("已取消今日已完成");
            this.loadReminders();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            // 通知插件更新徽章
            if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                this.plugin.updateBadges();
            }
        } catch (error) {
            console.error('取消今日已完成失败:', error);
            showMessage("操作失败");
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
        console.log('结果', settings);
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

                confirmMessage += `\n\n选择"确定"将继承当前进度继续计时。`;
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
        await confirm(
            t("deleteReminder"),
            t("confirmDelete", { title: reminder.title }),
            () => {
                this.performDeleteReminder(reminder.id);
            }
        );
    }

    private async performDeleteReminder(reminderId: string) {
        try {
            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                const blockId = reminderData[reminderId].blockId;
                delete reminderData[reminderId];
                await writeReminderData(reminderData);

                // 更新块的书签状态
                if (blockId) {
                    await updateBlockReminderBookmark(blockId);
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
        console.log('提醒数量统计:', {
            overdue: overdueCount,
            today: todayCount,
            tomorrow: tomorrowCount,
            future7: future7Count,
            completed: completedCount,
            todayCompleted: todayCompletedCount
        });
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

    private renderReminderItem(reminder: any): string {
        const today = getLocalDateString(); // 使用本地日期
        const isOverdue = compareDateStrings(reminder.date, today) < 0;
        const isToday = reminder.date === today;

        let dateClass = '';
        let dateLabel = '';

        if (isOverdue) {
            dateClass = 'overdue';
            dateLabel = '已过期';
        } else if (isToday) {
            dateClass = 'today';
            dateLabel = '今天';
        } else {
            dateClass = 'upcoming';
            dateLabel = '未来';
        }

        const timeDisplay = reminder.time ? ` ${reminder.time}` : '';
        const noteDisplay = reminder.note ? `<div class="reminder-note">${reminder.note}</div>` : '';

        return `
            <div class="reminder-item ${reminder.completed ? 'completed' : ''}" data-id="${reminder.id}">
                <div class="reminder-main">
                    <label class="reminder-checkbox">
                        <input type="checkbox" ${reminder.completed ? 'checked' : ''}>
                        <span class="checkmark"></span>
                    </label>
                    <div class="reminder-content">
                        <div class="reminder-title">${reminder.title || '未命名笔记'}</div>
                        <div class="reminder-date ${dateClass}">
                            <span class="date-label">${dateLabel}</span>
                            ${reminder.date}${timeDisplay}
                        </div>
                        ${noteDisplay}
                    </div>
                </div>
                <div class="reminder-actions">
                    <button class="reminder-edit-btn" title="编辑">✏️</button>
                    <button class="reminder-delete-btn" title="删除">🗑️</button>
                    <button class="reminder-open-btn" title="打开笔记">📖</button>
                </div>
            </div>
        `;
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
}


