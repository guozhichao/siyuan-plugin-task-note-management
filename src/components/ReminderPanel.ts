import { showMessage, confirm, Dialog, Menu } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID } from "../api";
import { getLocalDateString, compareDateStrings } from "../utils/dateUtils";

export class ReminderPanel {
    private container: HTMLElement;
    private remindersContainer: HTMLElement;
    private filterSelect: HTMLSelectElement;
    private plugin: any;
    private currentTab: string = 'all'; // 当前选中的标签

    constructor(container: HTMLElement, plugin?: any) {
        this.container = container;
        this.plugin = plugin;
        this.initUI();
        this.loadReminders();

        // 监听提醒更新事件
        window.addEventListener('reminderUpdated', () => {
            this.loadReminders();
        });
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
        titleSpan.textContent = '时间提醒';

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
            calendarBtn.title = '日历视图';
            calendarBtn.addEventListener('click', () => {
                this.plugin.openCalendarTab();
            });
            actionContainer.appendChild(calendarBtn);
        }

        // 添加刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = '刷新';
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
            <option value="today">今日提醒</option>
            <option value="future">未来提醒</option>
            <option value="overdue">过期提醒</option>
            <option value="completed">已完成</option>
            <option value="all">全部提醒</option>
        `;
        this.filterSelect.addEventListener('change', () => {
            this.currentTab = this.filterSelect.value; // 更新当前选中的标签
            this.loadReminders();
        });

        controls.appendChild(this.filterSelect);
        header.appendChild(controls);
        this.container.appendChild(header);

        // 提醒列表容器
        this.remindersContainer = document.createElement('div');
        this.remindersContainer.className = 'reminder-list';
        this.container.appendChild(this.remindersContainer);
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
            const reminders = Object.values(reminderData).filter((reminder: any) => {
                return reminder && typeof reminder === 'object' && reminder.id && reminder.date;
            });

            // 分类提醒 - 正确处理过期跨天提醒
            const overdue = reminders.filter((reminder: any) => {
                if (reminder.completed) return false;

                // 对于跨天事件，检查结束日期是否过期
                if (reminder.endDate) {
                    return compareDateStrings(reminder.endDate, today) < 0;
                } else {
                    // 单日事件过期
                    return compareDateStrings(reminder.date, today) < 0;
                }
            });

            const todayReminders = reminders.filter((reminder: any) => {
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

            const upcoming = reminders.filter((reminder: any) => {
                if (reminder.completed) return false;

                // 对于跨天事件，检查开始日期是否在未来
                if (reminder.endDate) {
                    return compareDateStrings(reminder.date, today) > 0;
                } else {
                    return compareDateStrings(reminder.date, today) > 0;
                }
            });

            const completed = reminders.filter((reminder: any) => reminder.completed);

            this.updateReminderCounts(overdue.length, todayReminders.length, upcoming.length, completed.length);

            // 根据当前选中的标签显示对应的提醒
            let displayReminders = [];
            switch (this.currentTab) {
                case 'overdue':
                    displayReminders = overdue;
                    break;
                case 'today':
                    displayReminders = todayReminders; // 包含过期提醒
                    break;
                case 'future':
                    displayReminders = upcoming;
                    break;
                case 'completed':
                    displayReminders = completed;
                    break;
                case 'all':
                default:
                    displayReminders = [...todayReminders, ...upcoming];
            }

            this.renderReminders(displayReminders);
        } catch (error) {
            console.error('加载提醒失败:', error);
            showMessage('加载提醒失败');
        }
    }

    private renderReminders(reminderData: any) {
        if (!reminderData || typeof reminderData !== 'object') {
            this.remindersContainer.innerHTML = '<div class="reminder-empty">暂无提醒事项</div>';
            return;
        }

        const filter = this.filterSelect.value;
        const today = getLocalDateString();
        const reminders = Object.values(reminderData).filter((reminder: any) => {
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
                case 'future':
                    if (reminder.completed) return false;
                    if (reminder.endDate) {
                        return compareDateStrings(reminder.date, today) > 0;
                    }
                    return compareDateStrings(reminder.date, today) > 0;
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
                'today': '今日',
                'future': '未来',
                'overdue': '过期',
                'completed': '已完成',
                'all': ''
            };
            this.remindersContainer.innerHTML = `<div class="reminder-empty">暂无${filterNames[filter]}提醒事项</div>`;
            return;
        }

        // 按日期和时间排序
        reminders.sort((a: any, b: any) => {
            const dateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00'));
            const dateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00'));
            return dateA.getTime() - dateB.getTime();
        });

        this.remindersContainer.innerHTML = '';

        reminders.forEach((reminder: any) => {
            const reminderEl = this.createReminderElement(reminder, today);
            this.remindersContainer.appendChild(reminderEl);
        });

        // 更新标题中的徽章
        this.updateBadge(reminderData, today);
    }

    private async toggleReminder(reminderId: string, completed: boolean) {
        try {
            const reminderData = await readReminderData();
            if (reminderData[reminderId]) {
                reminderData[reminderId].completed = completed;
                await writeReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                this.loadReminders();
            }
        } catch (error) {
            console.error('切换提醒状态失败:', error);
            showMessage('操作失败，请重试');
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
            } else {
                throw new Error('无法获取块信息');
            }
        } catch (error) {
            console.error('打开块失败:', error);

            // 询问用户是否删除无效的提醒
            const result = await confirm(
                "打开笔记失败",
                "该笔记块可能已被删除，是否删除相关的提醒？",
                async () => {
                    // 查找并删除相关提醒
                    await this.deleteRemindersByBlockId(blockId);
                },
                () => {
                    showMessage('打开笔记失败，该块可能已被删除');
                }
            );
        }
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
                showMessage(`已删除 ${deletedCount} 个相关提醒`);
                this.loadReminders();
            } else {
                showMessage('未找到相关提醒');
            }
        } catch (error) {
            console.error('删除相关提醒失败:', error);
            showMessage('删除相关提醒失败');
        }
    }

    private createReminderElement(reminder: any, today: string): HTMLElement {
        const isOverdue = compareDateStrings(reminder.date, today) < 0 && !reminder.completed;
        const isSpanningDays = reminder.endDate && reminder.endDate !== reminder.date;

        const reminderEl = document.createElement('div');
        reminderEl.className = `reminder-item ${isOverdue ? 'reminder-item--overdue' : ''} ${isSpanningDays ? 'reminder-item--spanning' : ''}`;

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
        checkbox.checked = reminder.completed || false;
        checkbox.addEventListener('change', () => {
            this.toggleReminder(reminder.id, checkbox.checked);
        });

        // 信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'reminder-item__info';

        // 标题 - 使用blockId来跳转
        const titleEl = document.createElement('a');
        titleEl.className = 'reminder-item__title';
        titleEl.textContent = reminder.title || '未命名笔记';
        titleEl.href = '#';
        titleEl.addEventListener('click', (e) => {
            e.preventDefault();
            this.openBlock(reminder.blockId || reminder.id); // 兼容旧数据格式
        });

        // 时间信息 - 支持跨天显示和点击编辑
        const timeEl = document.createElement('div');
        timeEl.className = 'reminder-item__time';
        const timeText = this.formatReminderTime(reminder.date, reminder.time, today, reminder.endDate);
        timeEl.textContent = timeText;
        timeEl.style.cursor = 'pointer';
        timeEl.title = '点击修改时间';

        // 添加时间点击编辑事件
        timeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showTimeEditDialog(reminder);
        });

        if (isSpanningDays) {
            const spanLabel = document.createElement('span');
            spanLabel.className = 'reminder-span-label';
            spanLabel.textContent = '跨天';
            timeEl.appendChild(spanLabel);
        }

        if (isOverdue) {
            const overdueLabel = document.createElement('span');
            overdueLabel.className = 'reminder-overdue-label';
            overdueLabel.textContent = '已过期';
            timeEl.appendChild(overdueLabel);
        }

        infoEl.appendChild(titleEl);
        infoEl.appendChild(timeEl);

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

    private showReminderContextMenu(event: MouseEvent, reminder: any) {
        const menu = new Menu("reminderContextMenu");

        menu.addItem({
            iconHTML: "📝",
            label: "修改时间",
            click: () => {
                this.showTimeEditDialog(reminder);
            }
        });

        menu.addSeparator();

        menu.addItem({
            iconHTML: "🗑️",
            label: "删除提醒",
            click: () => {
                this.deleteReminder(reminder);
            }
        });

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async deleteReminder(reminder: any) {
        const result = await confirm(
            "删除提醒",
            `确定要删除提醒"${reminder.title}"吗？此操作无法撤销。`,
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
                this.loadReminders();

                showMessage('提醒已删除');
            } else {
                showMessage('提醒不存在');
            }
        } catch (error) {
            console.error('删除提醒失败:', error);
            showMessage('删除提醒失败，请重试');
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
            dateStr = '今天';
        } else if (date === tomorrowStr) {
            dateStr = '明天';
        } else if (compareDateStrings(date, today) < 0) {
            // 过期日期显示
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
                endDateStr = '今天';
            } else if (endDate === tomorrowStr) {
                endDateStr = '明天';
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

    private async showTimeEditDialog(reminder: any) {
        const dialog = new Dialog({
            title: "修改提醒时间",
            content: `
                <div class="time-edit-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">开始日期</label>
                            <input type="date" id="editReminderDate" class="b3-text-field" value="${reminder.date}" required>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">结束日期（可选）</label>
                            <input type="date" id="editReminderEndDate" class="b3-text-field" value="${reminder.endDate || ''}" placeholder="留空表示单日事件">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">提醒时间</label>
                            <input type="time" id="editReminderTime" class="b3-text-field" value="${reminder.time || ''}">
                            <div class="b3-form__desc">留空表示全天提醒</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-checkbox">
                                <input type="checkbox" id="editNoSpecificTime" ${!reminder.time ? 'checked' : ''}>
                                <span class="b3-checkbox__graphic"></span>
                                <span class="b3-checkbox__label">全天提醒</span>
                            </label>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">备注</label>
                            <textarea id="editReminderNote" class="b3-text-field" placeholder="输入提醒备注..." rows="3">${reminder.note || ''}</textarea>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="editCancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="editConfirmBtn">保存</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "380px"
        });

        // 绑定事件处理逻辑
        const cancelBtn = dialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#editConfirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#editReminderTime') as HTMLInputElement;
        const startDateInput = dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#editReminderNote') as HTMLTextAreaElement;

        cancelBtn.addEventListener('click', () => {
            dialog.destroy();
        });

        confirmBtn.addEventListener('click', async () => {
            await this.saveTimeEdit(reminder.id, dialog);
        });

        noTimeCheckbox.addEventListener('change', () => {
            timeInput.disabled = noTimeCheckbox.checked;
            if (noTimeCheckbox.checked) {
                timeInput.value = '';
            }
        });

        startDateInput.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage('结束日期已自动调整为开始日期');
            }

            endDateInput.min = startDate;
        });

        endDateInput.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage('结束日期不能早于开始日期');
            }
        });
    }

    private async saveTimeEdit(reminderId: string, dialog: any) {
        const dateInput = dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#editReminderTime') as HTMLInputElement;
        const noTimeCheckbox = dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#editReminderNote') as HTMLTextAreaElement;

        const date = dateInput.value;
        const endDate = endDateInput.value;
        const time = noTimeCheckbox.checked ? undefined : timeInput.value;
        const note = noteInput.value.trim() || undefined;

        if (!date) {
            showMessage('请选择提醒日期');
            return;
        }

        if (endDate && endDate < date) {
            showMessage('结束日期不能早于开始日期');
            return;
        }

        try {
            const reminderData = await readReminderData();
            if (reminderData[reminderId]) {
                reminderData[reminderId].date = date;
                reminderData[reminderId].time = time;
                reminderData[reminderId].note = note;

                if (endDate && endDate !== date) {
                    reminderData[reminderId].endDate = endDate;
                } else {
                    delete reminderData[reminderId].endDate;
                }

                await writeReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                this.loadReminders();

                const isSpanning = endDate && endDate !== date;
                const timeStr = time ? ` ${time}` : '';
                const dateStr = isSpanning ? `${date} → ${endDate}${timeStr}` : `${date}${timeStr}`;
                showMessage(`提醒时间已更新为: ${dateStr}`);

                dialog.destroy();
            }
        } catch (error) {
            console.error('保存时间修改失败:', error);
            showMessage('保存失败，请重试');
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

    private updateBadge(reminderData: any, today: string) {
        // 不再显示徽章，保持方法为空以维持兼容性
        // 原有的"完成/总共"徽章显示逻辑已移除
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
