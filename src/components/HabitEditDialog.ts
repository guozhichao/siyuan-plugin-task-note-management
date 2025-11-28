import { Dialog, showMessage } from "siyuan";
import { Habit } from "./HabitPanel";
import { getLocalDateTimeString } from "../utils/dateUtils";
import { HabitGroupManager } from "../utils/habitGroupManager";

export class HabitEditDialog {
    private dialog: Dialog;
    private habit: Habit | null;
    private onSave: (habit: Habit) => Promise<void>;

    constructor(habit: Habit | null, onSave: (habit: Habit) => Promise<void>) {
        this.habit = habit;
        this.onSave = onSave;
    }

    show() {
        const isNew = !this.habit;
        const title = isNew ? "新建习惯" : "编辑习惯";

        this.dialog = new Dialog({
            title,
            content: '<div id="habitEditContainer"></div>',
            width: "600px",
            height: "700px"
        });

        const container = this.dialog.element.querySelector('#habitEditContainer') as HTMLElement;
        if (!container) return;

        this.renderForm(container, isNew);
    }

    private renderForm(container: HTMLElement, isNew: boolean) {
        container.style.cssText = 'padding: 20px; overflow-y: auto; height: 100%;';

        const form = document.createElement('form');
        form.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';

        // 习惯标题
        const titleGroup = this.createFormGroup('习惯标题', 'text', 'title', this.habit?.title || '');
        form.appendChild(titleGroup);

        // 打卡目标
        const targetGroup = this.createFormGroup('打卡目标（每次需打卡次数）', 'number', 'target', String(this.habit?.target || 1));
        form.appendChild(targetGroup);

        // 频率选择
        const frequencyGroup = this.createFrequencyGroup();
        form.appendChild(frequencyGroup);

        // 开始日期
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        const startDateGroup = this.createFormGroup('开始日期', 'date', 'startDate', this.habit?.startDate || today);
        form.appendChild(startDateGroup);

        // 结束日期
        const endDateGroup = this.createFormGroup('结束日期（可选）', 'date', 'endDate', this.habit?.endDate || '');
        form.appendChild(endDateGroup);

        // 提醒时间
        const reminderGroup = this.createFormGroup('提醒时间（可选）', 'time', 'reminderTime', this.habit?.reminderTime || '');
        form.appendChild(reminderGroup);

        // 分组选择
        const groupSelect = this.createGroupSelect();
        form.appendChild(groupSelect);

        // 优先级
        const priorityGroup = this.createPriorityGroup();
        form.appendChild(priorityGroup);

        // 按钮
        const buttonGroup = document.createElement('div');
        buttonGroup.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'b3-button';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => this.dialog.destroy());

        const saveBtn = document.createElement('button');
        saveBtn.type = 'submit';
        saveBtn.className = 'b3-button b3-button--primary';
        saveBtn.textContent = '保存';

        buttonGroup.appendChild(cancelBtn);
        buttonGroup.appendChild(saveBtn);

        form.appendChild(buttonGroup);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleSubmit(form, isNew);
        });

        container.appendChild(form);
    }

    private createFormGroup(label: string, type: string, name: string, value: string): HTMLElement {
        const group = document.createElement('div');
        group.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';

        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        labelEl.style.cssText = 'font-weight: bold; font-size: 14px;';

        const input = document.createElement('input');
        input.type = type;
        input.name = name;
        input.value = value;
        input.className = 'b3-text-field';
        if (type === 'number') {
            input.min = '1';
        }

        group.appendChild(labelEl);
        group.appendChild(input);

        return group;
    }

    private createFrequencyGroup(): HTMLElement {
        const group = document.createElement('div');
        group.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

        const label = document.createElement('label');
        label.textContent = '频率';
        label.style.cssText = 'font-weight: bold; font-size: 14px;';

        const select = document.createElement('select');
        select.name = 'frequencyType';
        select.className = 'b3-select';
        select.innerHTML = `
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
            <option value="yearly">每年</option>
            <option value="custom">自定义</option>
        `;

        if (this.habit?.frequency) {
            select.value = this.habit.frequency.type;
        }

        // 辅助容器：显示间隔输入、周/日选择
        const helperContainer = document.createElement('div');
        helperContainer.style.cssText = 'display:flex; flex-direction: column; gap: 8px;';

        // 间隔输入（例如每x天、每x周、每x月）
        const intervalContainer = document.createElement('div');
        intervalContainer.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const intervalLabel = document.createElement('label');
        intervalLabel.textContent = '间隔';
        intervalLabel.style.cssText = 'min-width: 48px;';

        const intervalInput = document.createElement('input');
        intervalInput.type = 'number';
        intervalInput.min = '1';
        intervalInput.name = 'interval';
        intervalInput.value = this.habit?.frequency?.interval ? String(this.habit.frequency.interval) : '1';
        intervalInput.className = 'b3-text-field';
        intervalInput.style.cssText = 'width: 80px;';

        const intervalSuffix = document.createElement('span');
        intervalSuffix.textContent = '天';

        intervalContainer.appendChild(intervalLabel);
        intervalContainer.appendChild(intervalInput);
        intervalContainer.appendChild(intervalSuffix);

        // 自定义模式选择（按周/按月）
        const customModeContainer = document.createElement('div');
        customModeContainer.style.cssText = 'display:flex; align-items:center; gap:8px;';
        customModeContainer.style.display = 'none';

        const customModeLabel = document.createElement('label');
        customModeLabel.textContent = '自定义方式';
        customModeLabel.style.cssText = 'min-width: 64px;';

        const customModeSelect = document.createElement('select');
        customModeSelect.name = 'customMode';
        customModeSelect.className = 'b3-select';
        customModeSelect.innerHTML = `
            <option value="weekdays">按星期</option>
            <option value="monthDays">按每月日期</option>
        `;

        customModeContainer.appendChild(customModeLabel);
        customModeContainer.appendChild(customModeSelect);

        // 依据已有习惯数据恢复自定义模式
        if (this.habit?.frequency?.weekdays && this.habit.frequency.weekdays.length > 0) {
            customModeSelect.value = 'weekdays';
        } else if (this.habit?.frequency?.monthDays && this.habit.frequency.monthDays.length > 0) {
            customModeSelect.value = 'monthDays';
        }

        // 星期选择器
        const weekdaysContainer = document.createElement('div');
        weekdaysContainer.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap;';
        weekdaysContainer.style.display = 'none';
        const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
        for (let i = 0; i < 7; i++) {
            const cbLabel = document.createElement('label');
            cbLabel.style.cssText = 'display:flex; align-items:center; gap:4px;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.name = 'weekday';
            cb.value = String(i);
            cb.checked = this.habit?.frequency?.weekdays ? this.habit.frequency.weekdays.includes(i) : false;
            cbLabel.appendChild(cb);
            const span = document.createElement('span');
            span.textContent = `周${weekdayNames[i]}`;
            cbLabel.appendChild(span);
            weekdaysContainer.appendChild(cbLabel);
        }

        // 月日期选择器 1..31
        const monthDaysContainer = document.createElement('div');
        monthDaysContainer.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap;';
        monthDaysContainer.style.display = 'none';
        for (let d = 1; d <= 31; d++) {
            const cbLabel = document.createElement('label');
            cbLabel.style.cssText = 'display:flex; align-items:center; gap:4px;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.name = 'monthDay';
            cb.value = String(d);
            cb.checked = this.habit?.frequency?.monthDays ? this.habit.frequency.monthDays.includes(d) : false;
            cbLabel.appendChild(cb);
            const span = document.createElement('span');
            span.textContent = `${d}日`;
            cbLabel.appendChild(span);
            monthDaysContainer.appendChild(cbLabel);
        }

        helperContainer.appendChild(intervalContainer);
        helperContainer.appendChild(customModeContainer);
        helperContainer.appendChild(weekdaysContainer);
        helperContainer.appendChild(monthDaysContainer);

        group.appendChild(label);
        group.appendChild(select);
        group.appendChild(helperContainer);

        // 事件：根据频率类型显示不同的选择项
        const updateHelperUI = () => {
            const type = select.value;
            if (type === 'daily') {
                intervalContainer.style.display = 'flex';
                intervalSuffix.textContent = '天';
                customModeContainer.style.display = 'none';
                weekdaysContainer.style.display = 'none';
                monthDaysContainer.style.display = 'none';
            } else if (type === 'weekly') {
                intervalContainer.style.display = 'flex';
                intervalSuffix.textContent = '周';
                customModeContainer.style.display = 'none';
                weekdaysContainer.style.display = 'flex';
                monthDaysContainer.style.display = 'none';
            } else if (type === 'monthly') {
                intervalContainer.style.display = 'flex';
                intervalSuffix.textContent = '月';
                customModeContainer.style.display = 'none';
                weekdaysContainer.style.display = 'none';
                monthDaysContainer.style.display = 'flex';
            } else if (type === 'yearly') {
                intervalContainer.style.display = 'flex';
                intervalSuffix.textContent = '年';
                customModeContainer.style.display = 'none';
                weekdaysContainer.style.display = 'none';
                monthDaysContainer.style.display = 'none';
            } else if (type === 'custom') {
                // 自定义：允许切换星期/每月日期
                intervalContainer.style.display = 'none';
                customModeContainer.style.display = 'flex';
                if (customModeSelect.value === 'weekdays') {
                    weekdaysContainer.style.display = 'flex';
                    monthDaysContainer.style.display = 'none';
                } else {
                    weekdaysContainer.style.display = 'none';
                    monthDaysContainer.style.display = 'flex';
                }
            }
        };

        // 初始化显示
        updateHelperUI();

        // 恢复已有习惯的 interval
        if (this.habit?.frequency?.interval) {
            intervalInput.value = String(this.habit.frequency.interval);
        }

        select.addEventListener('change', () => updateHelperUI());
        customModeSelect.addEventListener('change', () => updateHelperUI());

        return group;
    }

    private createPriorityGroup(): HTMLElement {
        const group = document.createElement('div');
        group.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';

        const label = document.createElement('label');
        label.textContent = '优先级';
        label.style.cssText = 'font-weight: bold; font-size: 14px;';

        const select = document.createElement('select');
        select.name = 'priority';
        select.className = 'b3-select';
        select.innerHTML = `
            <option value="none">无</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
        `;

        if (this.habit?.priority) {
            select.value = this.habit.priority;
        }

        group.appendChild(label);
        group.appendChild(select);

        return group;
    }

    private createGroupSelect(): HTMLElement {
        const group = document.createElement('div');
        group.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';

        const label = document.createElement('label');
        label.textContent = '分组';
        label.style.cssText = 'font-weight: bold; font-size: 14px;';

        const select = document.createElement('select');
        select.name = 'groupId';
        select.className = 'b3-select';

        // Add "No Group" option
        const noGroupOption = document.createElement('option');
        noGroupOption.value = 'none';
        noGroupOption.textContent = '无分组';
        select.appendChild(noGroupOption);

        // Add existing groups
        const groups = HabitGroupManager.getInstance().getAllGroups();
        groups.forEach(g => {
            const option = document.createElement('option');
            option.value = g.id;
            option.textContent = g.name;
            select.appendChild(option);
        });

        if (this.habit?.groupId) {
            select.value = this.habit.groupId;
        }

        group.appendChild(label);
        group.appendChild(select);

        return group;
    }

    private async handleSubmit(form: HTMLFormElement, isNew: boolean) {
        const formData = new FormData(form);

        const title = formData.get('title') as string;
        if (!title || title.trim() === '') {
            showMessage('请输入习惯标题', 3000, 'error');
            return;
        }

        const startDate = formData.get('startDate') as string;
        if (!startDate) {
            showMessage('请选择开始日期', 3000, 'error');
            return;
        }

        const now = getLocalDateTimeString(new Date());

        const frequencyType = formData.get('frequencyType') as any || 'daily';
        const intervalStr = formData.get('interval') as string;
        const interval = intervalStr ? parseInt(intervalStr) : undefined;

        // collect weekdays/monthDays from form
        const weekdays: number[] = [];
        const monthDays: number[] = [];
        const weekdayChecks = form.querySelectorAll('input[name="weekday"]') as NodeListOf<HTMLInputElement>;
        weekdayChecks.forEach(cb => { if (cb.checked) weekdays.push(parseInt(cb.value)); });
        const monthDayChecks = form.querySelectorAll('input[name="monthDay"]') as NodeListOf<HTMLInputElement>;
        monthDayChecks.forEach(cb => { if (cb.checked) monthDays.push(parseInt(cb.value)); });

        const habit: Habit = {
            id: this.habit?.id || `habit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: title.trim(),
            target: parseInt(formData.get('target') as string) || 1,
            frequency: {
                type: frequencyType
            },
            startDate,
            endDate: formData.get('endDate') as string || undefined,
            reminderTime: formData.get('reminderTime') as string || undefined,
            priority: formData.get('priority') as any || 'none',
            groupId: formData.get('groupId') as string === 'none' ? undefined : formData.get('groupId') as string,
            checkInEmojis: this.habit?.checkInEmojis || [
                { emoji: '✅', meaning: '完成', promptNote: false },
                { emoji: '❌', meaning: '未完成', promptNote: false },
                { emoji: '⭕️', meaning: '部分完成', promptNote: false }
            ],
            checkIns: this.habit?.checkIns || {},
            totalCheckIns: this.habit?.totalCheckIns || 0,
            createdAt: this.habit?.createdAt || now,
            updatedAt: now
        };

        // set frequency details
        if (frequencyType === 'daily' || frequencyType === 'yearly') {
            if (interval && interval > 1) habit.frequency.interval = interval;
        }

        if (frequencyType === 'weekly') {
            if (weekdays && weekdays.length > 0) {
                habit.frequency.weekdays = weekdays.sort((a, b) => a - b);
            } else if (interval && interval > 1) {
                habit.frequency.interval = interval;
            }
        }

        if (frequencyType === 'monthly') {
            if (monthDays && monthDays.length > 0) {
                habit.frequency.monthDays = monthDays.sort((a, b) => a - b);
            } else if (interval && interval > 1) {
                habit.frequency.interval = interval;
            }
        }

        if (frequencyType === 'custom') {
            // prefer weekdays if selected, otherwise monthDays; default keep empty
            if (weekdays && weekdays.length > 0) {
                habit.frequency.weekdays = weekdays.sort((a, b) => a - b);
            }
            if (monthDays && monthDays.length > 0) {
                habit.frequency.monthDays = monthDays.sort((a, b) => a - b);
            }
        }

        try {
            await this.onSave(habit);
            showMessage(isNew ? '创建成功' : '保存成功');
            this.dialog.destroy();
        } catch (error) {
            console.error('保存习惯失败:', error);
            showMessage('保存失败', 3000, 'error');
        }
    }
}
