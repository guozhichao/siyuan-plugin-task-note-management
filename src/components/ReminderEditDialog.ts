import { showMessage, Dialog } from "siyuan";
import { readReminderData, writeReminderData } from "../api";

export class ReminderEditDialog {
    private dialog: Dialog;
    private reminder: any;
    private onSaved?: () => void;

    constructor(reminder: any, onSaved?: () => void) {
        this.reminder = reminder;
        this.onSaved = onSaved;
    }

    public show() {
        this.dialog = new Dialog({
            title: "修改事件",
            content: this.createDialogContent(),
            width: "400px",
            height: "650px"
        });

        this.bindEvents();
    }

    private createDialogContent(): string {
        return `
            <div class="time-edit-dialog">
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">标题</label>
                        <input type="text" id="editReminderTitle" class="b3-text-field" value="${this.reminder.title || ''}" placeholder="请输入提醒标题">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">优先级</label>
                        <div class="priority-selector" id="editPrioritySelector">
                            <div class="priority-option ${this.reminder.priority === 'high' ? 'selected' : ''}" data-priority="high">
                                <div class="priority-dot high"></div>
                                <span>高</span>
                            </div>
                            <div class="priority-option ${this.reminder.priority === 'medium' ? 'selected' : ''}" data-priority="medium">
                                <div class="priority-dot medium"></div>
                                <span>中</span>
                            </div>
                            <div class="priority-option ${this.reminder.priority === 'low' ? 'selected' : ''}" data-priority="low">
                                <div class="priority-dot low"></div>
                                <span>低</span>
                            </div>
                            <div class="priority-option ${(!this.reminder.priority || this.reminder.priority === 'none') ? 'selected' : ''}" data-priority="none">
                                <div class="priority-dot none"></div>
                                <span>无</span>
                            </div>
                        </div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">开始日期</label>
                        <input type="date" id="editReminderDate" class="b3-text-field" value="${this.reminder.date}" required>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">结束日期（可选）</label>
                        <input type="date" id="editReminderEndDate" class="b3-text-field" value="${this.reminder.endDate || ''}" placeholder="留空表示单日事件">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">提醒时间</label>
                        <input type="time" id="editReminderTime" class="b3-text-field" value="${this.reminder.time || ''}">
                        <div class="b3-form__desc">留空表示全天提醒</div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-checkbox">
                            <input type="checkbox" id="editNoSpecificTime" ${!this.reminder.time ? 'checked' : ''}>
                            <span class="b3-checkbox__graphic"></span>
                            <span class="b3-checkbox__label">全天提醒</span>
                        </label>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">备注</label>
                        <textarea id="editReminderNote" class="b3-text-field" placeholder="输入提醒备注..." rows="3" style="width: 100%;resize: vertical; min-height: 60px;">${this.reminder.note || ''}</textarea>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="editCancelBtn">取消</button>
                    <button class="b3-button b3-button--primary" id="editConfirmBtn">保存</button>
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
            showMessage('请输入提醒标题');
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
            if (reminderData[this.reminder.id]) {
                reminderData[this.reminder.id].title = title;
                reminderData[this.reminder.id].date = date;
                reminderData[this.reminder.id].time = time;
                reminderData[this.reminder.id].note = note;
                reminderData[this.reminder.id].priority = priority;

                if (endDate && endDate !== date) {
                    reminderData[this.reminder.id].endDate = endDate;
                } else {
                    delete reminderData[this.reminder.id].endDate;
                }

                await writeReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                const isSpanning = endDate && endDate !== date;
                const timeStr = time ? ` ${time}` : '';
                const dateStr = isSpanning ? `${date} → ${endDate}${timeStr}` : `${date}${timeStr}`;
                showMessage(`提醒已更新: ${dateStr}`);

                // 调用保存回调
                if (this.onSaved) {
                    this.onSaved();
                }

                this.dialog.destroy();
            }
        } catch (error) {
            console.error('保存修改失败:', error);
            showMessage('保存失败，请重试');
        }
    }
}
