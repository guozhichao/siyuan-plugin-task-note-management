import { showMessage } from "siyuan";
import { writeReminderData, readReminderData } from "../api";
import { getLocalDateString } from "../utils/dateUtils";

export class ReminderEditDialog {
    private dialog: HTMLElement;
    private reminder: any;
    private onSave: () => void;

    constructor(reminder: any, onSave: () => void) {
        this.reminder = reminder;
        this.onSave = onSave;
        this.createDialog();
    }

    private createDialog() {
        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'reminder-dialog-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.close();
            }
        });

        // 创建对话框
        this.dialog = document.createElement('div');
        this.dialog.className = 'reminder-edit-dialog';

        // 对话框内容
        this.dialog.innerHTML = `
            <div class="reminder-dialog-header">
                <h3>编辑提醒</h3>
                <button class="reminder-dialog-close">&times;</button>
            </div>
            <div class="reminder-dialog-content">
                <div class="reminder-form-group">
                    <label>标题</label>
                    <input type="text" id="reminderTitle" value="${this.reminder.title || ''}" placeholder="请输入提醒标题">
                </div>
                <div class="reminder-form-group">
                    <label>开始日期</label>
                    <input type="date" id="reminderDate" value="${this.reminder.date}">
                </div>
                <div class="reminder-form-group">
                    <label>
                        结束日期
                        <span class="reminder-form-hint">留空表示单日事件</span>
                    </label>
                    <div class="reminder-enddate-container">
                        <span class="reminder-arrow">→</span>
                        <input type="date" id="reminderEndDate" value="${this.reminder.endDate || ''}" placeholder="不设置跨天">
                    </div>
                </div>
                <div class="reminder-form-group">
                    <label>时间</label>
                    <input type="time" id="reminderTime" value="${this.reminder.time || ''}">
                </div>
                <div class="reminder-form-group">
                    <label>备注</label>
                    <textarea id="reminderNote" rows="3">${this.reminder.note || ''}</textarea>
                </div>
            </div>
            <div class="reminder-dialog-footer">
                <button class="b3-button b3-button--outline" id="cancelBtn">取消</button>
                <button class="b3-button b3-button--text" id="saveBtn">创建新提醒</button>
            </div>
        `;

        overlay.appendChild(this.dialog);
        document.body.appendChild(overlay);

        // 绑定事件
        this.bindEvents();

        // 聚焦到日期输入框
        const dateInput = this.dialog.querySelector('#reminderDate') as HTMLInputElement;
        if (dateInput) {
            dateInput.focus();
        }
    }

    private bindEvents() {
        // 关闭按钮
        const closeBtn = this.dialog.querySelector('.reminder-dialog-close');
        const cancelBtn = this.dialog.querySelector('#cancelBtn');

        closeBtn?.addEventListener('click', () => this.close());
        cancelBtn?.addEventListener('click', () => this.close());

        // 保存按钮
        const saveBtn = this.dialog.querySelector('#saveBtn');
        saveBtn?.addEventListener('click', () => this.save());

        // 结束日期验证
        const startDateInput = this.dialog.querySelector('#reminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.querySelector('#reminderEndDate') as HTMLInputElement;

        startDateInput?.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage('结束日期不能早于开始日期');
            }
        });

        endDateInput?.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage('结束日期不能早于开始日期');
            }
        });

        // 按 ESC 关闭
        document.addEventListener('keydown', this.handleKeyDown);
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            this.close();
        }
    };

    private async save() {
        const titleInput = this.dialog.querySelector('#reminderTitle') as HTMLInputElement;
        const dateInput = this.dialog.querySelector('#reminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.querySelector('#reminderEndDate') as HTMLInputElement;
        const timeInput = this.dialog.querySelector('#reminderTime') as HTMLInputElement;
        const noteInput = this.dialog.querySelector('#reminderNote') as HTMLTextAreaElement;

        const title = titleInput.value.trim();
        const date = dateInput.value;
        const endDate = endDateInput.value;
        const time = timeInput.value;
        const note = noteInput.value;

        if (!title) {
            showMessage('请输入提醒标题');
            return;
        }

        if (!date) {
            showMessage('请选择日期');
            return;
        }

        if (endDate && endDate < date) {
            showMessage('结束日期不能早于开始日期');
            return;
        }

        try {
            const reminderData = await readReminderData();

            // 生成新的提醒ID
            const blockId = this.reminder.blockId || this.reminder.id; // 兼容旧数据格式
            const newReminderId = `${blockId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // 创建新的提醒
            const newReminder = {
                id: newReminderId,
                blockId: blockId,
                title: title, // 使用用户输入的标题
                date: date,
                completed: false,
                createdAt: new Date().toISOString()
            };

            if (endDate && endDate !== date) {
                newReminder.endDate = endDate;
            }

            if (time) {
                newReminder.time = time;
            }

            if (note) {
                newReminder.note = note;
            }

            // 添加新提醒到数据中
            reminderData[newReminderId] = newReminder;

            await writeReminderData(reminderData);

            const isSpanning = endDate && endDate !== date;
            const timeStr = time ? ` ${time}` : '';
            const dateStr = isSpanning ? `${date} → ${endDate}${timeStr}` : `${date}${timeStr}`;
            showMessage(`已创建新提醒: ${dateStr}`);

            window.dispatchEvent(new CustomEvent('reminderUpdated'));
            this.onSave();
            this.close();
        } catch (error) {
            console.error('创建新提醒失败:', error);
            showMessage('创建新提醒失败，请重试');
        }
    }

    private close() {
        document.removeEventListener('keydown', this.handleKeyDown);
        const overlay = this.dialog.parentElement;
        if (overlay) {
            document.body.removeChild(overlay);
        }
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

    private showTimeEditDialog(reminder: any) {
        const dialog = new Dialog({
            title: "修改提醒",
            content: `
                <div class="time-edit-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">标题</label>
                            <input type="text" id="editReminderTitle" class="b3-text-field" value="${reminder.title || ''}" placeholder="请输入提醒标题">
                        </div>
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
            height: "450px"
        });

        // 绑定事件
        const cancelBtn = dialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#editConfirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#editReminderTime') as HTMLInputElement;
        const startDateInput = dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;

        cancelBtn.addEventListener('click', () => {
            dialog.destroy();
        });

        confirmBtn.addEventListener('click', async () => {
            await this.saveEdit(reminder.id, dialog);
        });

        noTimeCheckbox.addEventListener('change', () => {
            timeInput.disabled = noTimeCheckbox.checked;
            if (noTimeCheckbox.checked) {
                timeInput.value = '';
            }
        });

        // 日期验证
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

    private async saveEdit(reminderId: string, dialog: Dialog) {
        const titleInput = dialog.element.querySelector('#editReminderTitle') as HTMLInputElement;
        const dateInput = dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#editReminderTime') as HTMLInputElement;
        const noTimeCheckbox = dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#editReminderNote') as HTMLTextAreaElement;

        const title = titleInput.value.trim();
        const date = dateInput.value;
        const endDate = endDateInput.value;
        const time = noTimeCheckbox.checked ? undefined : timeInput.value;
        const note = noteInput.value.trim() || undefined;

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
            if (reminderData[reminderId]) {
                reminderData[reminderId].title = title;
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
                await this.loadExistingReminder();

                const isSpanning = endDate && endDate !== date;
                const timeStr = time ? ` ${time}` : '';
                const dateStr = isSpanning ? `${date} → ${endDate}${timeStr}` : `${date}${timeStr}`;
                showMessage(`提醒已更新: ${dateStr}`);

                dialog.destroy();
            }
        } catch (error) {
            console.error('保存修改失败:', error);
            showMessage('保存失败，请重试');
        }
    }
}
