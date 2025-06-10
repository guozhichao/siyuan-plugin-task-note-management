import { showMessage, Dialog, Menu, confirm } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID } from "../api";
import { getLocalDateString, getLocalTimeString, compareDateStrings } from "../utils/dateUtils";
import { loadSortConfig, saveSortConfig, getSortMethodName } from "../utils/sortConfig";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { RepeatSettingsDialog, RepeatConfig } from "./RepeatSettingsDialog";
import { t } from "../utils/i18n";
import { getRepeatDescription } from "../utils/repeatUtils";

export class ReminderDialog {
    private blockId: string;
    private dialog: Dialog;
    private blockContent: string = '';
    private reminderUpdatedHandler: () => void;
    private currentSort: string = 'time';
    private sortConfigUpdatedHandler: (event: CustomEvent) => void;
    private repeatConfig: RepeatConfig; // 添加重复配置

    constructor(blockId: string) {
        this.blockId = blockId;

        // 初始化重复配置
        this.repeatConfig = {
            enabled: false,
            type: 'daily',
            interval: 1,
            endType: 'never'
        };

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
                showMessage(t("blockNotExist"));
                return;
            }
            this.blockContent = block?.content || t("unnamedNote");
        } catch (error) {
            console.error('获取块内容失败:', error);
            showMessage(t("cannotGetNoteContent"));
            return;
        }

        const today = getLocalDateString();
        const currentTime = getLocalTimeString();

        this.dialog = new Dialog({
            title: t("setTimeReminder"),
            content: `
                <div class="reminder-dialog">
                    <div class="b3-dialog__content">
                        <div class="fn__hr"></div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("eventTitle")}</label>
                            <input type="text" id="reminderTitle" class="b3-text-field" value="${this.blockContent}" placeholder="${t("enterReminderTitle")}">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("priority")}</label>
                            <div class="priority-selector" id="prioritySelector">
                                <div class="priority-option" data-priority="high">
                                    <div class="priority-dot high"></div>
                                    <span>${t("highPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="medium">
                                    <div class="priority-dot medium"></div>
                                    <span>${t("mediumPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="low">
                                    <div class="priority-dot low"></div>
                                    <span>${t("lowPriority")}</span>
                                </div>
                                <div class="priority-option selected" data-priority="none">
                                    <div class="priority-dot none"></div>
                                    <span>${t("noPriority")}</span>
                                </div>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderDate")}</label>
                            <div class="reminder-date-container">
                                <input type="date" id="reminderDate" class="b3-text-field" value="${today}" required>
                                <span class="reminder-arrow">→</span>
                                <input type="date" id="reminderEndDate" class="b3-text-field reminder-end-date" placeholder="${t("endDateOptional")}" title="${t("spanningEventDesc")}">
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderTimeOptional")}</label>
                            <input type="time" id="reminderTime" class="b3-text-field" value="${currentTime}">
                            <div class="b3-form__desc">${t("noTimeDesc")}</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-checkbox">
                                <input type="checkbox" id="noSpecificTime">
                                <span class="b3-checkbox__graphic"></span>
                                <span class="b3-checkbox__label">${t("noSpecificTime")}</span>
                            </label>
                        </div>
                        
                        <!-- 添加重复设置 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("repeatSettings")}</label>
                            <div class="repeat-setting-container">
                                <button type="button" id="repeatSettingsBtn" class="b3-button b3-button--outline" style="width: 100%;">
                                    <span id="repeatDescription">${t("noRepeat")}</span>
                                    <svg class="b3-button__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
                                </button>
                            </div>
                        </div>
                        
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderNoteOptional")}</label>
                            <textarea id="reminderNote" class="b3-text-field" placeholder="${t("enterReminderNote")}" rows="3" style="width: 100%;resize: vertical; min-height: 60px;"></textarea>
                        </div>
                        
                        <!-- 添加现有提醒显示区域 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("existingReminders")}</label>
                            <div id="existingReminders" class="existing-reminders-container"></div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="cancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="confirmBtn">${t("save")}</button>
                    </div>
                </div>
            `,
            width: "450px",
            height: "750px"
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
        const repeatSettingsBtn = this.dialog.element.querySelector('#repeatSettingsBtn') as HTMLButtonElement;

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
                showMessage(t("endDateAdjusted"));
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
                showMessage(t("endDateCannotBeEarlier"));
            }
        });

        // 重复设置按钮
        repeatSettingsBtn?.addEventListener('click', () => {
            this.showRepeatSettingsDialog();
        });
    }

    private showRepeatSettingsDialog() {
        const repeatDialog = new RepeatSettingsDialog(this.repeatConfig, (config: RepeatConfig) => {
            this.repeatConfig = config;
            this.updateRepeatDescription();
        });
        repeatDialog.show();
    }

    private updateRepeatDescription() {
        const repeatDescription = this.dialog.element.querySelector('#repeatDescription') as HTMLElement;
        if (repeatDescription) {
            const description = this.repeatConfig.enabled ? getRepeatDescription(this.repeatConfig) : t("noRepeat");
            repeatDescription.textContent = description;
        }
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
            showMessage(t("pleaseEnterTitle"));
            return;
        }

        if (!date) {
            showMessage(t("pleaseSelectDate"));
            return;
        }

        if (endDate && endDate < date) {
            showMessage(t("endDateCannotBeEarlier"));
            return;
        }

        try {
            const reminderData = await readReminderData();

            const reminderId = `${this.blockId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const reminder = {
                id: reminderId,
                blockId: this.blockId,
                title: title,
                date: date,
                completed: false,
                priority: priority,
                createdAt: new Date().toISOString(),
                repeat: this.repeatConfig.enabled ? this.repeatConfig : undefined // 添加重复配置
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

            // 显示保存成功消息，包含重复信息
            let successMessage = t("reminderSaved");
            if (endDate && endDate !== date) {
                successMessage += `：${date} → ${endDate}${time ? ` ${time}` : ''}`;
            } else {
                successMessage += `：${date}${time ? ` ${time}` : ''}`;
            }

            if (this.repeatConfig.enabled) {
                successMessage += `，${getRepeatDescription(this.repeatConfig)}`;
            }

            showMessage(successMessage);

            // 触发更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            this.cleanup();
            this.dialog.destroy();
        } catch (error) {
            console.error('保存提醒失败:', error);
            showMessage(t("saveReminderFailed"));
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

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                await this.loadExistingReminder();

                showMessage(t("reminderDeleted"));
            } else {
                showMessage(t("reminderNotExist"));
            }
        } catch (error) {
            console.error('删除提醒失败:', error);
            showMessage(t("deleteReminderFailed"));
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
                container.innerHTML = `<div class="reminder-empty">${t("noExistingReminders")}</div>`;
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
        timeEl.title = t("clickToModifyTime");

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
            label: t("modify"),
            click: () => {
                this.showTimeEditDialog(reminder);
            }
        });

        menu.addSeparator();

        menu.addItem({
            iconHTML: "🗑️",
            label: t("deleteReminder"),
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
