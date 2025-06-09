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
                    <input type="text" id="reminderTitle" value="${this.reminder.title || ''}" readonly>
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
        const dateInput = this.dialog.querySelector('#reminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.querySelector('#reminderEndDate') as HTMLInputElement;
        const timeInput = this.dialog.querySelector('#reminderTime') as HTMLInputElement;
        const noteInput = this.dialog.querySelector('#reminderNote') as HTMLTextAreaElement;

        const date = dateInput.value;
        const endDate = endDateInput.value;
        const time = timeInput.value;
        const note = noteInput.value;

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
                title: this.reminder.title,
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
}
