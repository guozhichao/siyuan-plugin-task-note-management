import { showMessage, confirm, Dialog, Menu } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID } from "../api";
import { getLocalDateString, compareDateStrings } from "../utils/dateUtils";
import { loadSortConfig, saveSortConfig, getSortMethodName } from "../utils/sortConfig";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { t } from "../utils/i18n";
import { generateRepeatInstances, getRepeatDescription } from "../utils/repeatUtils";

export class ReminderPanel {
    private container: HTMLElement;
    private remindersContainer: HTMLElement;
    private filterSelect: HTMLSelectElement;
    private sortButton: HTMLButtonElement;
    private plugin: any;
    private currentTab: string = 'today'; // 修改默认选项为 'today'
    private currentSort: string = 'time';
    private reminderUpdatedHandler: () => void;
    private sortConfigUpdatedHandler: (event: CustomEvent) => void;
    private closeCallback?: () => void; // 添加关闭回调

    constructor(container: HTMLElement, plugin?: any, closeCallback?: () => void) {
        this.container = container;
        this.plugin = plugin;
        this.closeCallback = closeCallback; // 存储关闭回调

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

        this.filterSelect = document.createElement('select');
        this.filterSelect.className = 'b3-select';
        this.filterSelect.innerHTML = `
            <option value="today" selected>${t("todayReminders")}</option>
            <option value="tomorrow">${t("tomorrowReminders")}</option>
            <option value="overdue">${t("overdueReminders")}</option>
            <option value="completed">${t("completedReminders")}</option>
            <option value="all">${t("allReminders")}</option>
        `;
        this.filterSelect.addEventListener('change', () => {
            this.currentTab = this.filterSelect.value;
            this.loadReminders();
        });

        controls.appendChild(this.filterSelect);
        header.appendChild(controls);
        this.container.appendChild(header);

        // 提醒列表容器
        this.remindersContainer = document.createElement('div');
        this.remindersContainer.className = 'reminder-list';
        this.container.appendChild(this.remindersContainer);

        // 初始化排序按钮标题
        this.updateSortButtonTitle();
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

    // 更新排序按钮的提示文本
    private updateSortButtonTitle() {
        if (this.sortButton) {
            this.sortButton.title = `${t("sortBy")}: ${getSortMethodName(this.currentSort)}`;
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

            const today = getLocalDateString(); // 使用本地日期
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = getLocalDateString(tomorrow);

            const reminders = Object.values(reminderData).filter((reminder: any) => {
                return reminder && typeof reminder === 'object' && reminder.id && reminder.date;
            });

            // 处理重复事件 - 生成重复实例
            const allReminders = [];
            const repeatInstancesMap = new Map(); // 用于去重重复事件实例

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
                                completed: isInstanceCompleted, // 使用实例级别的完成状态
                                // 修改备注逻辑：只有实例有明确的备注时才使用，否则为空
                                note: instanceMod?.note || ''  // 每个实例的备注都是独立的，默认为空
                            };

                            // 对于明天的提醒，只保留最近的一个实例
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

            // 分类提醒 - 正确处理过期跨天提醒
            const overdue = allReminders.filter((reminder: any) => {
                if (reminder.completed) return false;

                // 对于跨天事件，检查结束日期是否过期
                if (reminder.endDate) {
                    return compareDateStrings(reminder.endDate, today) < 0;
                } else {
                    // 单日事件过期
                    return compareDateStrings(reminder.date, today) < 0;
                }
            });

            const todayReminders = allReminders.filter((reminder: any) => {
                if (reminder.completed) return false;

                // 包含过期提醒、今日提醒和包含今天的跨天事件
                if (reminder.endDate) {
                    // 跨天事件：包含今天或已过期
                    return (compareDateStrings(reminder.date, today) <= 0 &&
                        compareDateStrings(today, reminder.endDate) <= 0) ||
                        compareDateStrings(reminder.endDate, today) < 0;
                }
                // 单日事件：今日或过期
                return reminder.date === today || compareDateStrings(reminder.date, today) < 0;
            });

            // 明天提醒：只包含明天的提醒，重复事件只显示最近的实例
            const tomorrowReminders = [];
            const tomorrowInstancesMap = new Map();

            allReminders.forEach((reminder: any) => {
                if (reminder.completed) return;

                let isTomorrow = false;
                if (reminder.endDate) {
                    // 跨天事件：开始日期是明天
                    isTomorrow = reminder.date === tomorrowStr;
                } else {
                    // 单日事件：日期是明天
                    isTomorrow = reminder.date === tomorrowStr;
                }

                if (isTomorrow) {
                    if (reminder.isRepeatInstance) {
                        // 对于重复事件实例，只保留原始事件ID的最近实例
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

            // 添加去重后的明天重复事件实例
            tomorrowInstancesMap.forEach(instance => {
                tomorrowReminders.push(instance);
            });

            const completed = allReminders.filter((reminder: any) => reminder.completed);

            this.updateReminderCounts(overdue.length, todayReminders.length, tomorrowReminders.length, completed.length);

            // 根据当前选中的标签显示对应的提醒
            let displayReminders = [];
            switch (this.currentTab) {
                case 'overdue':
                    displayReminders = overdue;
                    break;
                case 'today':
                    displayReminders = todayReminders; // 包含过期提醒
                    break;
                case 'tomorrow':
                    displayReminders = tomorrowReminders;
                    break;
                case 'completed':
                    displayReminders = completed;
                    break;
                case 'all':
                default:
                    displayReminders = [...todayReminders, ...tomorrowReminders];
            }

            this.renderReminders(displayReminders);
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

        const reminders = Array.isArray(reminderData) ? reminderData : Object.values(reminderData).filter((reminder: any) => {
            if (!reminder || typeof reminder !== 'object' || !reminder.id) return false;

            switch (filter) {
                case 'today':
                    if (reminder.completed) return false;
                    // 包含过期提醒和今日提醒
                    if (reminder.endDate) {
                        // 跨天事件：包含今天或已过期
                        return (compareDateStrings(reminder.date, today) <= 0 &&
                            compareDateStrings(today, reminder.endDate) <= 0) ||
                            compareDateStrings(reminder.endDate, today) < 0;
                    }
                    // 单日事件：今日或过期
                    return reminder.date === today || compareDateStrings(reminder.date, today) < 0;
                case 'tomorrow':
                    if (reminder.completed) return false;
                    if (reminder.endDate) {
                        return reminder.date === tomorrowStr;
                    }
                    return reminder.date === tomorrowStr;
                case 'overdue':
                    if (reminder.completed) return false;
                    if (reminder.endDate) {
                        return compareDateStrings(reminder.endDate, today) < 0;
                    } else {
                        return compareDateStrings(reminder.date, today) < 0;
                    }
                case 'completed':
                    return reminder.completed;
                case 'all':
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
                'all': t("noAllReminders")
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
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                    this.loadReminders();
                }
            } else if (reminderData[reminderId]) {
                // 处理普通事件的完成状态
                reminderData[reminderId].completed = completed;
                await writeReminderData(reminderData);
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

            const response = await fetch('/api/block/getBlockBreadcrumb', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    id: blockId
                })
            });

            if (response.ok) {
                window.open(`siyuan://blocks/${blockId}`, '_self');

                // 跳转成功后，如果是悬浮面板，自动关闭对话框
                if (this.closeCallback) {
                    // 延迟关闭，确保跳转操作完成
                    setTimeout(() => {
                        this.closeCallback();
                    }, 100);
                }
            } else {
                throw new Error('无法获取块信息');
            }
        } catch (error) {
            console.error('打开块失败:', error);

            // 询问用户是否删除无效的提醒
            const result = await confirm(
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
        const isOverdue = compareDateStrings(reminder.date, today) < 0 && !reminder.completed;
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

        // 复选框 - 修复完成状态检查
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

        // 标题容器 - 只包含标题
        const titleContainer = document.createElement('div');
        titleContainer.className = 'reminder-item__title-container';

        // 标题 - 使用blockId来跳转
        const titleEl = document.createElement('a');
        titleEl.className = 'reminder-item__title';
        titleEl.textContent = reminder.title || t("unnamedNote");
        titleEl.href = '#';
        titleEl.addEventListener('click', (e) => {
            e.preventDefault();
            this.openBlock(reminder.blockId || reminder.id); // 兼容旧数据格式
        });

        titleContainer.appendChild(titleEl);

        // 时间信息容器 - 包含重复图标和时间
        const timeContainer = document.createElement('div');
        timeContainer.className = 'reminder-item__time-container';
        timeContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        // 添加重复图标（放在时间前面）
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

        // 时间信息 - 支持跨天显示和点击编辑
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
                // 获取原始事件数据
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

    private showReminderContextMenu(event: MouseEvent, reminder: any) {
        const menu = new Menu("reminderContextMenu");

        // 对于重复事件实例，提供不同的选项
        if (reminder.isRepeatInstance) {
            menu.addItem({
                iconHTML: "📝",
                label: t("modifyThisInstance"),
                click: () => {
                    this.editInstanceReminder(reminder);
                }
            });

            menu.addItem({
                iconHTML: "📝",
                label: t("modifyAllInstances"),
                click: () => {
                    this.editOriginalReminder(reminder.originalId);
                }
            });
        } else {
            menu.addItem({
                iconHTML: "📝",
                label: t("modify"),
                click: () => {
                    this.showTimeEditDialog(reminder);
                }
            });
        }

        // 添加优先级设置子菜单
        const priorityMenuItems = [];
        const priorities = [
            { key: 'high', label: t("high"), color: '#e74c3c', icon: '🔴' },
            { key: 'medium', label: t("medium"), color: '#f39c12', icon: '🟡' },
            { key: 'low', label: t("low"), color: '#3498db', icon: '🔵' },
            { key: 'none', label: t("none"), color: '#95a5a6', icon: '⚫' }
        ];

        priorities.forEach(priority => {
            priorityMenuItems.push({
                iconHTML: priority.icon,
                label: priority.label,
                click: () => {
                    // 对于重复事件实例，设置原始事件的优先级
                    const targetId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;
                    this.setPriority(targetId, priority.key);
                }
            });
        });

        menu.addItem({
            iconHTML: "🎯",
            label: t("setPriority"),
            submenu: priorityMenuItems
        });

        menu.addSeparator();

        if (reminder.isRepeatInstance) {
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteThisInstance"),
                click: () => {
                    this.deleteInstanceOnly(reminder);
                }
            });

            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteAllInstances"),
                click: () => {
                    this.deleteOriginalReminder(reminder.originalId);
                }
            });
        } else {
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteReminder"),
                click: () => {
                    this.deleteReminder(reminder);
                }
            });
        }

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
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

            // 创建实例数据，包含当前实例的特定信息
            const instanceData = {
                ...originalReminder,
                id: reminder.id,
                date: reminder.date,
                endDate: reminder.endDate,
                time: reminder.time,
                endTime: reminder.endTime,
                note: reminder.note, // 使用实例级别的备注
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
        const result = await confirm(
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

    private async deleteReminder(reminder: any) {
        const result = await confirm(
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
                delete reminderData[reminderId];
                await writeReminderData(reminderData);
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
}
