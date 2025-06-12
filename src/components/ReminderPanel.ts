import { showMessage, confirm, Dialog, Menu, openTab } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID, updateBlockReminderBookmark } from "../api";
import { getLocalDateString, compareDateStrings, getLocalDateTime } from "../utils/dateUtils";
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
    private reminderUpdatedHandler: () => void;
    private sortConfigUpdatedHandler: (event: CustomEvent) => void;
    private closeCallback?: () => void;
    private categoryManager: CategoryManager; // 添加分类管理器

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
            const { sortMethod } = event.detail;
            if (sortMethod !== this.currentSort) {
                this.currentSort = sortMethod;
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
            this.currentSort = await loadSortConfig();
            this.updateSortButtonTitle();
        } catch (error) {
            console.error('加载排序配置失败:', error);
            this.currentSort = 'time';
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
        titleSpan.textContent = t("timeReminder");

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
            <option value="overdue">${t("overdueReminders")}</option>
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
        this.container.appendChild(this.remindersContainer);

        // 渲染分类过滤器
        this.renderCategoryFilter();

        // 初始化排序按钮标题
        this.updateSortButtonTitle();
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
            this.sortButton.title = `${t("sortBy")}: ${getSortMethodName(this.currentSort)}`;
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
                    color: var(--b3-theme-on-surface-light);
                    margin-bottom: 2px;
                    opacity: 0.8;
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
                    docTitleEl.style.color = 'var(--b3-theme-on-surface-light)';
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
                { key: 'title', label: t("sortByTitle"), icon: '📝' },
                { key: 'created', label: t("sortByCreated"), icon: '📅' }
            ];

            sortOptions.forEach(option => {
                menu.addItem({
                    iconHTML: option.icon,
                    label: option.label,
                    current: this.currentSort === option.key,
                    click: async () => {
                        try {
                            this.currentSort = option.key;
                            this.updateSortButtonTitle();
                            // 保存排序配置到文件
                            await saveSortConfig(option.key);
                            this.loadReminders();
                        } catch (error) {
                            console.error('保存排序配置失败:', error);
                            // 即使保存失败也继续执行排序
                            this.loadReminders();
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
                const maxX = window.innerWidth - 200; // 假设菜单宽度约200px
                const maxY = window.innerHeight - 150; // 假设菜单高度约150px

                menu.open({
                    x: Math.min(menuX, maxX),
                    y: Math.min(menuY, maxY)
                });
            } else {
                // 备用定位方式：使用鼠标位置
                menu.open({
                    x: event.clientX,
                    y: event.clientY
                });
            }
        } catch (error) {
            console.error('显示排序菜单失败:', error);
            const currentName = getSortMethodName(this.currentSort);
            console.log(`当前排序方式: ${currentName}`);
        }
    }

    private async loadReminders() {
        try {
            const reminderData = await readReminderData();

            if (!reminderData || typeof reminderData !== 'object') {
                this.updateReminderCounts(0, 0, 0, 0);
                this.renderReminders([]);
                return;
            }

            const today = getLocalDateString();
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = getLocalDateString(tomorrow);

            // 计算过去七天的日期范围
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7); // 改为-7，不包括今天
            const sevenDaysAgoStr = getLocalDateString(sevenDaysAgo);

            const reminders = Object.values(reminderData).filter((reminder: any) => {
                return reminder && typeof reminder === 'object' && reminder.id && reminder.date;
            });

            // 处理重复事件 - 生成重复实例
            const allReminders = [];
            const repeatInstancesMap = new Map();

            reminders.forEach((reminder: any) => {
                // 添加原始事件
                allReminders.push(reminder);

                // 如果有重复设置，生成重复事件实例
                if (reminder.repeat?.enabled) {
                    const now = new Date();
                    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
                    const startDate = monthStart.toISOString().split('T')[0];
                    const endDate = monthEnd.toISOString().split('T')[0];

                    const repeatInstances = generateRepeatInstances(reminder, startDate, endDate);
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

                            const key = `${reminder.id}_${instance.date}`;
                            if (!repeatInstancesMap.has(key) ||
                                compareDateStrings(instance.date, repeatInstancesMap.get(key).date) < 0) {
                                repeatInstancesMap.set(key, instanceReminder);
                            }
                        }
                    });
                }
            });

            // 添加去重后的重复事件实例
            repeatInstancesMap.forEach(instance => {
                allReminders.push(instance);
            });

            // 应用分类过滤
            const filteredReminders = this.applyCategoryFilter(allReminders);

            // 分类提醒 - 改进过期判断逻辑
            const overdue = filteredReminders.filter((reminder: any) => {
                if (reminder.completed) return false;

                // 对于跨天事件，以结束日期判断是否过期
                if (reminder.endDate) {
                    return compareDateStrings(reminder.endDate, today) < 0;
                } else {
                    // 对于单日事件，以开始日期判断是否过期
                    return compareDateStrings(reminder.date, today) < 0;
                }
            });

            // 今日提醒 - 改进跨天事件判断逻辑，包含过期事项
            const todayReminders = filteredReminders.filter((reminder: any) => {
                if (reminder.completed) return false;

                if (reminder.endDate) {
                    // 跨天事件：只要今天在事件的时间范围内就显示，或者事件已过期但结束日期在今天之前
                    return (compareDateStrings(reminder.date, today) <= 0 &&
                        compareDateStrings(today, reminder.endDate) <= 0) ||
                        compareDateStrings(reminder.endDate, today) < 0;
                } else {
                    // 单日事件：今天或过期的都显示在今日
                    return reminder.date === today || compareDateStrings(reminder.date, today) < 0;
                }
            });

            // 明天提醒 - 改进跨天事件判断逻辑
            const tomorrowReminders = [];
            const tomorrowInstancesMap = new Map();

            filteredReminders.forEach((reminder: any) => {
                if (reminder.completed) return;

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

            // 修改过去七天提醒的筛选逻辑
            const pastSevenDaysReminders = filteredReminders.filter((reminder: any) => {
                // 过去七天：仅包括过去7天内的提醒（不包括今天之后的）
                const reminderStartDate = reminder.date;
                const reminderEndDate = reminder.endDate || reminder.date;

                // 事件必须在过去7天到昨天之间
                return compareDateStrings(sevenDaysAgoStr, reminderStartDate) <= 0 &&
                    compareDateStrings(reminderEndDate, today) < 0;
            });

            const completed = filteredReminders.filter((reminder: any) => reminder.completed);

            this.updateReminderCounts(overdue.length, todayReminders.length, tomorrowReminders.length, completed.length);

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
                case 'completed':
                    displayReminders = completed;
                    break;
                case 'all':
                    displayReminders = pastSevenDaysReminders;  // 使用真正的过去七天筛选
                    break;
                default:
                    displayReminders = [...todayReminders, ...tomorrowReminders];
            }

            // 修改为异步处理提醒元素创建
            const createRemindersAsync = async () => {
                for (const reminder of displayReminders) {
                    const reminderEl = await this.createReminderElement(reminder, today);
                    this.remindersContainer.appendChild(reminderEl);
                }
            };

            this.remindersContainer.innerHTML = ''; // 清空容器
            createRemindersAsync().catch(error => {
                console.error('创建提醒元素失败:', error);
            });
        } catch (error) {
            console.error('加载提醒失败:', error);
            showMessage(t("loadRemindersFailed"));
        }
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

        // 计算过去七天的日期范围
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7); // 改为-7，不包括今天
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
                case 'all':
                    // 修改过去七天的筛选逻辑：仅包括过去7天内的提醒
                    const reminderStartDate = reminder.date;
                    const reminderEndDate = reminder.endDate || reminder.date;

                    // 事件必须在过去7天到昨天之间
                    return compareDateStrings(sevenDaysAgoStr, reminderStartDate) <= 0 &&
                        compareDateStrings(reminderEndDate, today) < 0;
                default:
                    return true;
            }
        });

        if (reminders.length === 0) {
            const filterNames = {
                'today': t("noTodayReminders"),
                'tomorrow': t("noTomorrowReminders"),
                'overdue': t("noOverdueReminders"),
                'completed': t("noCompletedReminders"),
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

    // 添加排序方法
    private sortReminders(reminders: any[]) {
        const sortType = this.currentSort;

        reminders.sort((a: any, b: any) => {
            switch (sortType) {
                case 'time':
                    // 按时间排序：先按日期，再按时间
                    const dateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00'));
                    const dateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00'));
                    return dateA.getTime() - dateB.getTime();

                case 'priority':
                    // 按优先级排序：高 > 中 > 低 > 无，相同优先级按时间排序
                    const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
                    const priorityA = priorityOrder[a.priority || 'none'] || 0;
                    const priorityB = priorityOrder[b.priority || 'none'] || 0;

                    if (priorityA !== priorityB) {
                        return priorityB - priorityA; // 降序：高优先级在前
                    }

                    // 相同优先级按时间排序
                    const timeDateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00'));
                    const timeDateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00'));
                    return timeDateA.getTime() - timeDateB.getTime();

                case 'title':
                    // 按标题排序
                    const titleA = (a.title || '').toLowerCase();
                    const titleB = (b.title || '').toLowerCase();
                    return titleA.localeCompare(titleB, 'zh-CN');

                case 'created':
                    // 按创建时间排序
                    const createdA = new Date(a.createdAt || '1970-01-01');
                    const createdB = new Date(b.createdAt || '1970-01-01');
                    return createdB.getTime() - createdA.getTime(); // 降序：最新创建的在前

                default:
                    return 0;
            }
        });
    }

    private async toggleReminder(reminderId: string, completed: boolean, isRepeatInstance?: boolean, instanceDate?: string) {
        try {
            const reminderData = await readReminderData();

            if (isRepeatInstance && instanceDate) {
                // 处理重复事件实例的完成状态
                // 对于重复事件实例，直接使用传入的 reminderId 作为原始ID
                const originalId = reminderId; // 这里 reminderId 应该是原始ID

                if (reminderData[originalId]) {
                    // 初始化已完成实例列表
                    if (!reminderData[originalId].repeat.completedInstances) {
                        reminderData[originalId].repeat.completedInstances = [];
                    }

                    const completedInstances = reminderData[originalId].repeat.completedInstances;

                    if (completed) {
                        // 添加到已完成列表
                        if (!completedInstances.includes(instanceDate)) {
                            completedInstances.push(instanceDate);
                        }
                    } else {
                        // 从已完成列表中移除
                        const index = completedInstances.indexOf(instanceDate);
                        if (index > -1) {
                            completedInstances.splice(index, 1);
                        }
                    }

                    await writeReminderData(reminderData);

                    // 更新块的书签状态
                    const blockId = reminderData[originalId].blockId;
                    if (blockId) {
                        await updateBlockReminderBookmark(blockId);
                    }

                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                    this.loadReminders();
                }
            } else if (reminderData[reminderId]) {
                // 处理普通事件的完成状态
                const blockId = reminderData[reminderId].blockId;
                reminderData[reminderId].completed = completed;
                await writeReminderData(reminderData);

                // 更新块的书签状态
                if (blockId) {
                    await updateBlockReminderBookmark(blockId);
                }

                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                this.loadReminders();
            }
        } catch (error) {
            console.error('切换提醒状态失败:', error);
            showMessage(t("operationFailed"));
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
                    action: "cb-get-hl",
                    zoomIn: false
                },
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
            this.openBlock(reminder.blockId || reminder.id);
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
        timeEl.textContent = timeText;
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

    /**
     * [MODIFIED] This function has been refactored to handle all reminder types
     * and provide a consistent context menu as per user request.
     */
    private showReminderContextMenu(event: MouseEvent, reminder: any) {
        const menu = new Menu("reminderContextMenu");

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

        if (reminder.isRepeatInstance) {
            // --- Menu for a REPEAT INSTANCE ---
            menu.addItem({
                iconHTML: "📋",
                label: "复制块引",
                click: () => this.copyBlockRef(reminder)
            });
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
    private startPomodoroCountUp(reminder: any) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟并且窗口仍然存在
        if (ReminderPanel.currentPomodoroTimer && ReminderPanel.currentPomodoroTimer.isWindowActive()) {
            // 显示确认对话框
            confirm(
                "替换当前番茄钟",
                `当前正在进行番茄钟任务，是否要停止当前任务并开始新的正计时番茄钟？`,
                () => {
                    // 用户确认替换
                    this.performStartPomodoroCountUp(reminder);
                },
                () => {
                    // 用户取消，不做任何操作
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

    private performStartPomodoroCountUp(reminder: any) {
        // 如果已经有活动的番茄钟，先关闭它
        if (ReminderPanel.currentPomodoroTimer) {
            try {
                ReminderPanel.currentPomodoroTimer.close();
                ReminderPanel.currentPomodoroTimer = null;
            } catch (error) {
                console.error('关闭之前的番茄钟失败:', error);
            }
        }

        const settings = this.plugin.getPomodoroSettings();
        const pomodoroTimer = new PomodoroTimer(reminder, settings, true);

        // 设置当前活动的番茄钟实例并直接切换到正计时模式
        ReminderPanel.currentPomodoroTimer = pomodoroTimer;

        pomodoroTimer.show();
        showMessage("已启动正计时番茄钟", 2000);
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
    private startPomodoro(reminder: any) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟并且窗口仍然存在
        if (ReminderPanel.currentPomodoroTimer && ReminderPanel.currentPomodoroTimer.isWindowActive()) {
            // 显示确认对话框
            confirm(
                "替换当前番茄钟",
                `当前正在进行番茄钟任务，是否要停止当前任务并开始新的番茄钟？`,
                () => {
                    // 用户确认替换
                    this.performStartPomodoro(reminder);
                },
                () => {
                    // 用户取消，不做任何操作
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

    private performStartPomodoro(reminder: any) {
        // 如果已经有活动的番茄钟，先关闭它
        if (ReminderPanel.currentPomodoroTimer) {
            try {
                ReminderPanel.currentPomodoroTimer.close();
                ReminderPanel.currentPomodoroTimer = null;
            } catch (error) {
                console.error('关闭之前的番茄钟失败:', error);
            }
        }

        const settings = this.plugin.getPomodoroSettings();
        const pomodoroTimer = new PomodoroTimer(reminder, settings);

        // 设置当前活动的番茄钟实例
        ReminderPanel.currentPomodoroTimer = pomodoroTimer;

        pomodoroTimer.show();
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

    private updateReminderCounts(overdueCount: number, todayCount: number, upcomingCount: number, completedCount: number) {
        // 更新各个标签的提醒数量
        const overdueTab = this.container.querySelector('.reminder-tab[data-filter="overdue"]');
        const todayTab = this.container.querySelector('.reminder-tab[data-filter="today"]');
        const upcomingTab = this.container.querySelector('.reminder-tab[data-filter="upcoming"]');
        const completedTab = this.container.querySelector('.reminder-tab[data-filter="completed"]');

        if (overdueTab) {
            const badge = overdueTab.querySelector('.reminder-badge');
            if (badge) {
                badge.textContent = overdueCount > 99 ? '99+' : `${overdueCount}`;
                badge.classList.toggle('hidden', overdueCount === 0);
            }
        }

        if (todayTab) {
            const badge = todayTab.querySelector('.reminder-badge');
            if (badge) {
                badge.textContent = todayCount > 99 ? '99+' : `${todayCount}`;
                badge.classList.toggle('hidden', todayCount === 0);
            }
        }

        if (upcomingTab) {
            const badge = upcomingTab.querySelector('.reminder-badge');
            if (badge) {
                badge.textContent = upcomingCount > 99 ? '99+' : `${upcomingCount}`;
                badge.classList.toggle('hidden', upcomingCount === 0);
            }
        }

        if (completedTab) {
            const badge = completedTab.querySelector('.reminder-badge');
            if (badge) {
                badge.textContent = completedCount > 99 ? '99+' : `${completedCount}`;
                badge.classList.toggle('hidden', completedCount === 0);
            }
        }
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
            const untilDate = new Date(instanceDate + 'T12:00:00Z');
            untilDate.setUTCDate(untilDate.getUTCDate() - 1);
            const newEndDateStr = untilDate.toISOString().split('T')[0];

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
}
