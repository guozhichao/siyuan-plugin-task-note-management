import { showMessage, Dialog, Menu, confirm } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID } from "../api";
import { getLocalDateString, getLocalTimeString, compareDateStrings } from "../utils/dateUtils";
import { loadSortConfig, saveSortConfig, getSortMethodName } from "../utils/sortConfig";
import { ReminderEditDialog } from "./ReminderEditDialog";

export class ReminderDialog {
    private blockId: string;
    private dialog: Dialog;
    private blockContent: string = '';
    private reminderUpdatedHandler: () => void;
    private currentSort: string = 'time';
    private sortConfigUpdatedHandler: (event: CustomEvent) => void;

    constructor(blockId: string) {
        this.blockId = blockId;

        // 创建事件处理器
        this.reminderUpdatedHandler = () => {
            // 重新加载现有提醒列表
            this.loadExistingReminder();
        };

        this.sortConfigUpdatedHandler = (event: CustomEvent) => {
            const { sortMethod } = event.detail;
            if (sortMethod !== this.currentSort) {
                this.currentSort = sortMethod;
                this.loadExistingReminder(); // 重新排序现有提醒
            }
        };

        // 加载排序配置
        this.loadSortConfig();
    }

    // 加载排序配置
    private async loadSortConfig() {
        try {
            this.currentSort = await loadSortConfig();
        } catch (error) {
            console.error('加载排序配置失败:', error);
            this.currentSort = 'time';
        }
    }

    async show() {
        // 检测块是否存在
        try {
            const block = await getBlockByID(this.blockId);
            if (!block) {
                showMessage('选择的笔记块不存在，无法创建提醒');
                return;
            }
            this.blockContent = block?.content || '未命名笔记';
        } catch (error) {
            console.error('获取块内容失败:', error);
            showMessage('无法获取笔记内容，可能该块已被删除');
            return;
        }

        const today = getLocalDateString();
        const currentTime = getLocalTimeString();

        this.dialog = new Dialog({
            title: "设置时间提醒",
            content: `
                <div class="reminder-dialog">
                    <div class="b3-dialog__content">
                        <div class="fn__hr"></div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">事件标题</label>
                            <input type="text" id="reminderTitle" class="b3-text-field" value="${this.blockContent}" placeholder="请输入事件标题">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">优先级</label>
                            <div class="priority-selector" id="prioritySelector">
                                <div class="priority-option" data-priority="high">
                                    <div class="priority-dot high"></div>
                                    <span>高</span>
                                </div>
                                <div class="priority-option" data-priority="medium">
                                    <div class="priority-dot medium"></div>
                                    <span>中</span>
                                </div>
                                <div class="priority-option" data-priority="low">
                                    <div class="priority-dot low"></div>
                                    <span>低</span>
                                </div>
                                <div class="priority-option selected" data-priority="none">
                                    <div class="priority-dot none"></div>
                                    <span>无</span>
                                </div>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">提醒日期</label>
                            <div class="reminder-date-container">
                                <input type="date" id="reminderDate" class="b3-text-field" value="${today}" required>
                                <span class="reminder-arrow">→</span>
                                <input type="date" id="reminderEndDate" class="b3-text-field reminder-end-date" placeholder="结束日期（可选）" title="设置跨天事件的结束日期，留空表示单日事件">
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">提醒时间（可选）</label>
                            <input type="time" id="reminderTime" class="b3-text-field" value="${currentTime}">
                            <div class="b3-form__desc">不设置时间则全天提醒</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-checkbox">
                                <input type="checkbox" id="noSpecificTime">
                                <span class="b3-checkbox__graphic"></span>
                                <span class="b3-checkbox__label">不设置具体时间</span>
                            </label>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">备注（可选）</label>
                            <textarea id="reminderNote" class="b3-text-field" placeholder="输入提醒备注..." rows="3" style="width: 100%;resize: vertical; min-height: 60px;"></textarea>
                        </div>
                        
                        <!-- 添加现有提醒显示区域 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">现有提醒</label>
                            <div id="existingReminders" class="existing-reminders-container"></div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="confirmBtn">确定</button>
                    </div>
                </div>
            `,
            width: "450px",
            height: "700px"
        });

        this.bindEvents();
        await this.loadExistingReminder();

        // 监听提醒更新事件
        window.addEventListener('reminderUpdated', this.reminderUpdatedHandler);
        // 监听排序配置更新事件
        window.addEventListener('sortConfigUpdated', this.sortConfigUpdatedHandler);
    }

    private bindEvents() {
        const cancelBtn = this.dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const confirmBtn = this.dialog.element.querySelector('#confirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#noSpecificTime') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#reminderTime') as HTMLInputElement;
        const startDateInput = this.dialog.element.querySelector('#reminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#reminderEndDate') as HTMLInputElement;
        const prioritySelector = this.dialog.element.querySelector('#prioritySelector') as HTMLElement;

        // 优先级选择事件
        prioritySelector.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.priority-option') as HTMLElement;
            if (option) {
                prioritySelector.querySelectorAll('.priority-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 取消按钮
        cancelBtn?.addEventListener('click', () => {
            this.cleanup();
            this.dialog.destroy();
        });

        // 确定按钮
        confirmBtn?.addEventListener('click', () => {
            this.saveReminder();
        });

        // 时间复选框
        noTimeCheckbox?.addEventListener('change', () => {
            timeInput.disabled = noTimeCheckbox.checked;
            if (noTimeCheckbox.checked) {
                timeInput.value = '';
            }
        });

        // 日期验证
        startDateInput?.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            // 如果结束日期已设置且早于开始日期，自动调整
            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage('结束日期已自动调整为开始日期');
            }

            // 设置结束日期的最小值
            endDateInput.min = startDate;
        });

        // 结束日期验证
        endDateInput?.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage('结束日期不能早于开始日期');
            }
        });
    }

    private async saveReminder() {
        const titleInput = this.dialog.element.querySelector('#reminderTitle') as HTMLInputElement;
        const dateInput = this.dialog.element.querySelector('#reminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#reminderEndDate') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#reminderTime') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#noSpecificTime') as HTMLInputElement;
        const noteInput = this.dialog.element.querySelector('#reminderNote') as HTMLTextAreaElement;
        const selectedPriority = this.dialog.element.querySelector('#prioritySelector .priority-option.selected') as HTMLElement;

        const title = titleInput.value.trim();
        const date = dateInput.value;
        const endDate = endDateInput.value;
        const time = noTimeCheckbox.checked ? undefined : timeInput.value;
        const note = noteInput.value.trim() || undefined;
        const priority = selectedPriority?.getAttribute('data-priority') || 'none';

        if (!title) {
            showMessage('请输入事件标题');
            return;
        }

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

            const reminderId = `${this.blockId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const reminder = {
                id: reminderId,
                blockId: this.blockId,
                title: title, // 使用用户输入的标题
                date: date,
                completed: false,
                priority: priority,
                createdAt: new Date().toISOString()
            };

            if (endDate && endDate !== date) {
                reminder.endDate = endDate;
            }

            if (time) {
                reminder.time = time;
            }

            if (note) {
                reminder.note = note;
            }

            reminderData[reminderId] = reminder;
            await writeReminderData(reminderData);

            if (endDate && endDate !== date) {
                showMessage(`已设置跨天提醒：${date} → ${endDate}${time ? ` ${time}` : ''}`);
            } else {
                showMessage(`已设置提醒：${date}${time ? ` ${time}` : ''}`);
            }

            // 触发更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            this.cleanup();
            this.dialog.destroy();
        } catch (error) {
            console.error('保存提醒失败:', error);
            showMessage('保存提醒失败，请重试');
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

    private async loadReminders() {
        // 由于 ReminderDialog 主要用于设置提醒，这里可以是空实现
        // 或者触发全局的提醒更新事件
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
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

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                await this.loadExistingReminder();

                showMessage('提醒已删除');
            } else {
                showMessage('提醒不存在');
            }
        } catch (error) {
            console.error('删除提醒失败:', error);
            showMessage('删除提醒失败，请重试');
        }
    }

    private showTimeEditDialog(reminder: any) {
        const editDialog = new ReminderEditDialog(reminder, () => {
            this.loadExistingReminder();
        });
        editDialog.show();
    }

    private async loadExistingReminder() {
        try {
            const reminderData = await readReminderData();
            const blockReminders = Object.values(reminderData).filter((reminder: any) =>
                reminder && reminder.blockId === this.blockId
            );

            const container = this.dialog.element.querySelector('#existingReminders') as HTMLElement;

            if (blockReminders.length > 0 && container) {
                const today = getLocalDateString();
                container.innerHTML = '';

                // 应用当前排序方式
                this.sortReminders(blockReminders);

                blockReminders.forEach((reminder: any) => {
                    const reminderEl = this.createReminderElement(reminder, today);
                    container.appendChild(reminderEl);
                });
            } else if (container) {
                container.innerHTML = '<div class="reminder-empty">暂无现有提醒</div>';
            }
        } catch (error) {
            console.error('加载现有提醒失败:', error);
        }
    }

    private createReminderElement(reminder: any, today: string): HTMLElement {
        const element = document.createElement('div');
        element.className = 'reminder-item reminder-item--compact';
        element.setAttribute('data-id', reminder.id);

        // 添加右键菜单支持
        element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showReminderContextMenu(e, reminder);
        });

        // 标题
        const titleEl = document.createElement('div');
        titleEl.className = 'reminder-item__title';
        titleEl.textContent = reminder.title;
        element.appendChild(titleEl);

        // 时间信息 - 添加点击编辑功能
        const timeEl = document.createElement('div');
        timeEl.className = 'reminder-item__time';
        const timeText = this.formatReminderTime(reminder.date, reminder.time, today, reminder.endDate);
        timeEl.textContent = timeText;
        timeEl.style.cursor = 'pointer';
        timeEl.style.color = 'var(--b3-theme-primary)';
        timeEl.title = '点击修改时间';

        // 添加时间点击编辑事件
        timeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showTimeEditDialog(reminder);
        });

        element.appendChild(timeEl);

        // 如果有备注，显示备注
        if (reminder.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-item__note';
            noteEl.textContent = reminder.note;
            element.appendChild(noteEl);
        }

        return element;
    }

    private showReminderContextMenu(event: MouseEvent, reminder: any) {
        const menu = new Menu("reminderDialogContextMenu");

        menu.addItem({
            iconHTML: "📝",
            label: "修改",
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

    // 添加清理方法
    private cleanup() {
        if (this.reminderUpdatedHandler) {
            window.removeEventListener('reminderUpdated', this.reminderUpdatedHandler);
        }
        if (this.sortConfigUpdatedHandler) {
            window.removeEventListener('sortConfigUpdated', this.sortConfigUpdatedHandler);
        }
    }
}
