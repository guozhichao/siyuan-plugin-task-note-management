import { showMessage, confirm, Dialog, Menu } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID } from "../api";
import { getLocalDateString, compareDateStrings, getLocalDateTime } from "../utils/dateUtils";
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
                    current: currentPriority === priority.key, // Visually indicate the current priority
                    click: () => {
                        // For instances, priority is set on the original event.
                        const targetId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;
                        this.setPriority(targetId, priority.key);
                    }
                });
            });
            return menuItems;
        };

        if (reminder.isRepeatInstance) {
            // --- Menu for a REPEAT INSTANCE ---
            menu.addItem({
                iconHTML: "📝",
                label: t("modifyThisInstance"),
                click: () => this.editInstanceReminder(reminder)
            });
            menu.addItem({
                iconHTML: "📝",
                label: t("modifyAllInstances"), // This will split the series
                click: () => this.editInstanceAsNewSeries(reminder)
            });
            menu.addItem({
                iconHTML: "🎯",
                label: t("setPriority"),
                submenu: createPriorityMenuItems()
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

        } else if (reminder.repeat?.enabled) {
            // --- Menu for the ORIGINAL RECURRING EVENT (User Request) ---
            // This logic has been completely updated based on the new request.
            menu.addItem({
                iconHTML: "📝",
                label: t("modifyThisInstance"), // "修改并分割系列"
                click: () => this.splitRecurringReminder(reminder)
            });
            menu.addItem({
                iconHTML: "📝",
                label: t("modifyAllInstances"), // Edits the entire series template
                click: () => this.showTimeEditDialog(reminder)
            });
            menu.addItem({
                iconHTML: "🎯",
                label: t("setPriority"),
                submenu: createPriorityMenuItems()
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteThisInstance"), // "跳过首次发生"
                click: () => this.skipFirstOccurrence(reminder)
            });
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteAllInstances"), // Deletes the entire series
                click: () => this.deleteReminder(reminder)
            });

        } else {
            // --- Menu for a SIMPLE, NON-RECURRING EVENT ---
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
            menu.addSeparator();
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

            // 1. Calculate the next occurrence date
            const nextDate = this.calculateNextDate(originalReminder.date, originalReminder.repeat);
            if (!nextDate) {
                showMessage(t("operationFailed") + ": " + t("invalidRepeatConfig"));
                return;
            }
            const nextDateStr = getLocalDateString(nextDate);

            // 2. Duplicate the reminder to create a new series
            const newReminder = JSON.parse(JSON.stringify(originalReminder));
            const blockId = newReminder.blockId || newReminder.id;
            newReminder.id = `${blockId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            newReminder.date = nextDateStr;

            // Also shift endDate if it exists
            if (newReminder.endDate && originalReminder.date) {
                try {
                    const duration = new Date(newReminder.endDate).getTime() - new Date(originalReminder.date).getTime();
                    if (!isNaN(duration)) {
                        const newEndDate = new Date(nextDate.getTime() + duration);
                        newReminder.endDate = getLocalDateString(newEndDate);
                    }
                } catch (e) { /* ignore date parsing errors */ }
            }

            // 3. End the original series on its start date
            originalReminder.repeat.endDate = originalReminder.date;

            // 4. Save changes
            reminderData[originalReminder.id] = originalReminder;
            reminderData[newReminder.id] = newReminder;
            await writeReminderData(reminderData);


            this.loadReminders();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('分割重复事件系列失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    /**
     * [NEW] Skips the first occurrence of a recurring series by moving its start date to the next cycle.
     * @param reminder The original recurring reminder to modify.
     */
    private async skipFirstOccurrence(reminder: any) {
        await confirm(
            t("deleteThisInstance"),
            t("confirmDeleteInstance"),
            async () => {
                try {
                    const reminderData = await readReminderData();
                    const originalReminder = reminderData[reminder.id];
                    if (!originalReminder || !originalReminder.repeat?.enabled) {
                        showMessage(t("operationFailed"));
                        return;
                    }

                    // 1. Calculate next occurrence date
                    const nextDate = this.calculateNextDate(originalReminder.date, originalReminder.repeat);
                    if (!nextDate) {
                        showMessage(t("operationFailed") + ": " + t("invalidRepeatConfig"));
                        return;
                    }
                    const nextDateStr = getLocalDateString(nextDate);

                    // Also calculate the duration for shifting endDate
                    let duration = 0;
                    if (originalReminder.endDate && originalReminder.date) {
                        try {
                            const d = new Date(originalReminder.endDate).getTime() - new Date(originalReminder.date).getTime();
                            if (!isNaN(d)) duration = d;
                        } catch (e) { /* ignore date parsing errors */ }
                    }

                    // 2. Update the start date of the original reminder
                    originalReminder.date = nextDateStr;

                    // 3. Update the end date if it exists
                    if (originalReminder.endDate) {
                        const newEndDate = new Date(nextDate.getTime() + duration);
                        originalReminder.endDate = getLocalDateString(newEndDate);
                    }

                    // 4. Save changes
                    reminderData[originalReminder.id] = originalReminder;
                    await writeReminderData(reminderData);
                    this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                } catch (error) {
                    console.error('跳过第一次事件失败:', error);
                    showMessage(t("operationFailed"));
                }
            }
        );
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
}
