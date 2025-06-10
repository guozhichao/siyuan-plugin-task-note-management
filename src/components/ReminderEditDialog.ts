import { showMessage, Dialog } from "siyuan";
import { readReminderData, writeReminderData } from "../api";
import { t } from "../utils/i18n";
import { RepeatSettingsDialog, RepeatConfig } from "./RepeatSettingsDialog";
import { getRepeatDescription } from "../utils/repeatUtils";

export class ReminderEditDialog {
    private dialog: Dialog;
    private reminder: any;
    private onSaved?: () => void;
    private repeatConfig: RepeatConfig; // 添加重复配置

    constructor(reminder: any, onSaved?: () => void) {
        this.reminder = reminder;
        this.onSaved = onSaved;

        // 初始化重复配置
        this.repeatConfig = reminder.repeat || {
            enabled: false,
            type: 'daily',
            interval: 1,
            endType: 'never'
        };
    }

    public show() {
        this.dialog = new Dialog({
            title: t("modifyEvent"),
            content: this.createDialogContent(),
            width: "400px",
            height: "600px"
        });

        this.bindEvents();
    }

    private createDialogContent(): string {
        return `
            <div class="time-edit-dialog">
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("eventTitle")}</label>
                        <input type="text" id="editReminderTitle" class="b3-text-field" value="${this.reminder.title || ''}" placeholder="${t("enterReminderTitle")}">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("priority")}</label>
                        <div class="priority-selector" id="editPrioritySelector">
                            <div class="priority-option ${this.reminder.priority === 'high' ? 'selected' : ''}" data-priority="high">
                                <div class="priority-dot high"></div>
                                <span>${t("highPriority")}</span>
                            </div>
                            <div class="priority-option ${this.reminder.priority === 'medium' ? 'selected' : ''}" data-priority="medium">
                                <div class="priority-dot medium"></div>
                                <span>${t("mediumPriority")}</span>
                            </div>
                            <div class="priority-option ${this.reminder.priority === 'low' ? 'selected' : ''}" data-priority="low">
                                <div class="priority-dot low"></div>
                                <span>${t("lowPriority")}</span>
                            </div>
                            <div class="priority-option ${(!this.reminder.priority || this.reminder.priority === 'none') ? 'selected' : ''}" data-priority="none">
                                <div class="priority-dot none"></div>
                                <span>${t("noPriority")}</span>
                            </div>
                        </div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderDate")}</label>
                        <input type="date" id="editReminderDate" class="b3-text-field" value="${this.reminder.date}" required>
                        <span class="reminder-arrow">→</span>
                        <input type="date" id="editReminderEndDate" class="b3-text-field" value="${this.reminder.endDate || ''}" placeholder="${t("endDateOptional")}">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderTime")}</label>
                        <input type="time" id="editReminderTime" class="b3-text-field" value="${this.reminder.time || ''}">
                        <div class="b3-form__desc">${t("noTimeDescLeaveEmpty")}</div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-checkbox">
                            <input type="checkbox" id="editNoSpecificTime" ${!this.reminder.time ? 'checked' : ''}>
                            <span class="b3-checkbox__graphic"></span>
                            <span class="b3-checkbox__label">${t("allDayReminder")}</span>
                        </label>
                    </div>
                    
                    <!-- 添加重复设置 -->
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("repeatSettings")}</label>
                        <div class="repeat-setting-container">
                            <button type="button" id="editRepeatSettingsBtn" class="b3-button b3-button--outline" style="width: 100%;">
                                <span id="editRepeatDescription">${this.repeatConfig.enabled ? getRepeatDescription(this.repeatConfig) : t("noRepeat")}</span>
                                <svg class="b3-button__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
                            </button>
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderNote")}</label>
                        <textarea id="editReminderNote" class="b3-text-field" placeholder="${t("enterReminderNote")}" rows="3" style="width: 100%;resize: vertical; min-height: 60px;">${this.reminder.note || ''}</textarea>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="editCancelBtn">${t("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="editConfirmBtn">${t("save")}</button>
                </div>
            </div>
        `;
    }

    private bindEvents() {
        const cancelBtn = this.dialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const confirmBtn = this.dialog.element.querySelector('#editConfirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#editReminderTime') as HTMLInputElement;
        const startDateInput = this.dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        const prioritySelector = this.dialog.element.querySelector('#editPrioritySelector') as HTMLElement;

        // 优先级选择事件
        prioritySelector.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.priority-option') as HTMLElement;
            if (option) {
                prioritySelector.querySelectorAll('.priority-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        cancelBtn.addEventListener('click', () => {
            this.dialog.destroy();
        });

        confirmBtn.addEventListener('click', async () => {
            await this.saveTimeEdit();
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
                showMessage(t("endDateAdjusted"));
            }

            endDateInput.min = startDate;
        });

        endDateInput.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage(t("endDateCannotBeEarlier"));
            }
        });

        // 重复设置按钮
        const editRepeatSettingsBtn = this.dialog.element.querySelector('#editRepeatSettingsBtn') as HTMLButtonElement;
        editRepeatSettingsBtn?.addEventListener('click', () => {
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
        const repeatDescription = this.dialog.element.querySelector('#editRepeatDescription') as HTMLElement;
        if (repeatDescription) {
            const description = this.repeatConfig.enabled ? getRepeatDescription(this.repeatConfig) : t("noRepeat");
            repeatDescription.textContent = description;
        }
    }

    private async saveTimeEdit() {
        const titleInput = this.dialog.element.querySelector('#editReminderTitle') as HTMLInputElement;
        const dateInput = this.dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#editReminderTime') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const noteInput = this.dialog.element.querySelector('#editReminderNote') as HTMLTextAreaElement;
        const selectedPriority = this.dialog.element.querySelector('#editPrioritySelector .priority-option.selected') as HTMLElement;

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
            if (reminderData[this.reminder.id]) {
                reminderData[this.reminder.id].title = title;
                reminderData[this.reminder.id].date = date;
                reminderData[this.reminder.id].time = time;
                reminderData[this.reminder.id].note = note;
                reminderData[this.reminder.id].priority = priority;
                reminderData[this.reminder.id].repeat = this.repeatConfig.enabled ? this.repeatConfig : undefined; // 保存重复配置

                if (endDate && endDate !== date) {
                    reminderData[this.reminder.id].endDate = endDate;
                } else {
                    delete reminderData[this.reminder.id].endDate;
                }

                await writeReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                // 显示保存成功消息，包含重复信息
                const isSpanning = endDate && endDate !== date;
                const timeStr = time ? ` ${time}` : '';
                const dateStr = isSpanning ? `${date} → ${endDate}${timeStr}` : `${date}${timeStr}`;
                let successMessage = t("reminderUpdated") + `: ${dateStr}`;

                if (this.repeatConfig.enabled) {
                    successMessage += `，${getRepeatDescription(this.repeatConfig)}`;
                }

                showMessage(successMessage);

                // 调用保存回调
                if (this.onSaved) {
                    this.onSaved();
                }

                this.dialog.destroy();
            }
        } catch (error) {
            console.error('保存修改失败:', error);
            showMessage(t("saveReminderFailed"));
        }
    }
}
