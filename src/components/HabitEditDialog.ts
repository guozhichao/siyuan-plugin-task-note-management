import { Dialog, showMessage } from "siyuan";
import { getBlockByID, getBlockDOM } from "../api";
import { Habit } from "./HabitPanel";
import { getLocalDateTimeString, getLocalDateString } from "../utils/dateUtils";
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

        // Ensure the container has two children: content and action areas.
        // contentDiv will hold the scrollable form content, actionDiv will hold the action buttons.
        let contentDiv = container.querySelector('.b3-dialog__content') as HTMLElement;
        let actionDiv = container.querySelector('.b3-dialog__action') as HTMLElement;
        if (!contentDiv) {
            contentDiv = document.createElement('div');
            contentDiv.className = 'b3-dialog__content';
            container.appendChild(contentDiv);
        }
        if (!actionDiv) {
            actionDiv = document.createElement('div');
            actionDiv.className = 'b3-dialog__action';
            container.appendChild(actionDiv);
        }

        // delegate the rendering of the form inside the contentDiv and the action area
        this.renderForm(contentDiv, isNew, actionDiv);
    }

    private renderForm(container: HTMLElement, isNew: boolean, actionContainer?: HTMLElement) {
        // the container here is the content area
        container.style.cssText = 'padding: 20px; overflow-y: auto; height: calc(100% - 56px);';
        // 设置class
        container.className = 'b3-dialog__content';
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

        // 绑定块输入（可选）
        const blockGroup = document.createElement('div');
        blockGroup.style.cssText = 'display:flex; flex-direction: column; gap:4px;';

        const blockLabel = document.createElement('label');
        blockLabel.textContent = '绑定块（可选）';
        blockLabel.style.cssText = 'font-weight: bold; font-size: 14px;';

        const blockInputRow = document.createElement('div');
        blockInputRow.style.cssText = 'display:flex; gap:8px; align-items:center;';

        const blockInput = document.createElement('input');
        blockInput.type = 'text';
        blockInput.name = 'blockId';
        blockInput.id = 'habitBlockInput';
        blockInput.className = 'b3-text-field';
        blockInput.placeholder = '块或文档 ID（例如：(()) 或 siyuan://blocks/ID）';
        blockInput.value = this.habit?.blockId || '';
        blockInput.style.cssText = 'flex: 1;';

        const pasteBtn = document.createElement('button');
        pasteBtn.type = 'button';
        pasteBtn.className = 'b3-button b3-button--outline';
        pasteBtn.title = '粘贴块引用';
        pasteBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'b3-button b3-button--outline';
        clearBtn.title = '清除';
        clearBtn.textContent = '清除';

        blockInputRow.appendChild(blockInput);
        blockInputRow.appendChild(pasteBtn);
        blockInputRow.appendChild(clearBtn);

        const blockPreview = document.createElement('div');
        blockPreview.id = 'habitBlockPreview';
        blockPreview.style.cssText = 'font-size:12px; color:var(--b3-theme-on-surface-light); padding-top:6px;';

        blockGroup.appendChild(blockLabel);
        blockGroup.appendChild(blockInputRow);
        blockGroup.appendChild(blockPreview);
        form.appendChild(blockGroup);

        // initial preview if editing and block exists
        if (blockInput.value) {
            this.updatePreviewForBlock(blockInput.value, blockPreview).catch(err => console.warn('初始化块预览失败', err));
        }

        // 优先级
        const priorityGroup = this.createPriorityGroup();
        form.appendChild(priorityGroup);

        // 按钮
        // 创建按钮组，不再作为表单内部直接的子元素；它将被放在 actionContainer（dialog action）中
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

        // Don't append buttonGroup to the form. It'll be appended to the actionContainer (sibling)

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleSubmit(form, isNew);
        });

        // 绑定块按钮事件
        pasteBtn.addEventListener('click', async () => {
            try {
                const clipboardText = await navigator.clipboard.readText();
                if (!clipboardText) return;

                const blockRefRegex = /\(\(([\w\-]+)\s+'(.*)'\)\)/;
                const blockLinkRegex = /\[(.*)\]\(siyuan:\/\/blocks\/([\w\-]+)\)/;

                let blockId: string | undefined;

                const refMatch = clipboardText.match(blockRefRegex);
                if (refMatch) {
                    blockId = refMatch[1];
                } else {
                    const linkMatch = clipboardText.match(blockLinkRegex);
                    if (linkMatch) {
                        blockId = linkMatch[2];
                    }
                }

                if (blockId) {
                    blockInput.value = blockId;
                    await this.updatePreviewForBlock(blockId, blockPreview);
                    showMessage('已粘贴块引用');
                } else {
                    showMessage('粘贴内容不是块引用/链接', 3000, 'error');
                }
            } catch (error) {
                console.error('读取剪贴板失败:', error);
                showMessage('读取剪贴板失败', 3000, 'error');
            }
        });


        // 清除绑定
        clearBtn.addEventListener('click', () => {
            blockInput.value = '';
            blockPreview.textContent = '';
        });

        // 输入更改时更新预览（简单实现）并尝试自动将引用格式规范化为纯 id
        let isAutoSettingInput = false;
        blockInput.addEventListener('input', async () => {
            const raw = blockInput.value?.trim();
            if (!raw) {
                blockPreview.textContent = '';
                return;
            }
            const id = this.extractBlockId(raw);
            if (!id) {
                blockPreview.textContent = '';
                return;
            }
            // 如果文本是引用或链接格式，则规范化为纯 id，以便保存时不会保存冗余内容
            if (!isAutoSettingInput && raw !== id && (raw.includes("((") || raw.includes('siyuan://blocks/') || raw.includes(']('))) {
                try {
                    isAutoSettingInput = true;
                    blockInput.value = id;
                } finally {
                    // 使用 setTimeout 以避免阻塞和循环触发
                    setTimeout(() => { isAutoSettingInput = false; }, 0);
                }
            }
            await this.updatePreviewForBlock(id, blockPreview);
        });

        container.appendChild(form);

        // insert the action container area and fill with buttons
        if (actionContainer) {
            // ensure actionContainer has proper padding/separation
            actionContainer.style.cssText = 'display:flex; justify-content: flex-end; padding: 12px 20px; border-top: 1px solid rgba(0,0,0,0.04);';
            // append buttons to actionContainer and keep buttonGroup as wrapper
            actionContainer.appendChild(buttonGroup);
        }

        // If save is outside the form, trigger submit programmatically
        saveBtn.addEventListener('click', () => {
            // prefer modern API requestSubmit
            if ((form as any).requestSubmit) {
                (form as any).requestSubmit();
            } else {
                // fallback
                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            }
        });
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

        const rawBlockVal = (formData.get('blockId') as string) || undefined;
        const parsedBlockId = rawBlockVal ? (this.extractBlockId(rawBlockVal) || rawBlockVal) : undefined;

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
            blockId: parsedBlockId || undefined,
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
        // 保留已有的 hasNotify 值（编辑时），避免覆盖已有记录
        if (this.habit && this.habit.hasNotify) {
            // 复制一份，避免引用同一对象
            habit.hasNotify = { ...this.habit.hasNotify };
        }

        // 如果是修改已有习惯，并且提醒时间被修改为新的值，且新的提醒时间晚于当前时间，则重置当天 hasNotify 为 false，方便再次提醒
        if (this.habit && this.habit.reminderTime !== habit.reminderTime && habit.reminderTime) {
            try {
                const newTime = habit.reminderTime; // 格式: HH:mm
                const parts = newTime.split(':');
                if (parts.length >= 2) {
                    const hour = parseInt(parts[0], 10);
                    const minute = parseInt(parts[1], 10);
                    if (!isNaN(hour) && !isNaN(minute)) {
                        const now = new Date();
                        const todayAtReminder = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
                        // 仅当新的提醒时间是今天并且在当前时间之后，且旧有的 hasNotify 为 true 时，才重置为 false
                        if (todayAtReminder.getTime() > now.getTime()) {
                            const todayStr = getLocalDateString();
                            // 只有当原来记录为 true 的情况下才把它复位为 false，避免误修改其他默认/未设置值
                            if (this.habit.hasNotify && this.habit.hasNotify[todayStr] === true) {
                                habit.hasNotify = habit.hasNotify || {};
                                habit.hasNotify[todayStr] = false;
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('判断提醒时间是否晚于当前时间失败', err);
            }
        }

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

    private async updatePreviewForBlock(blockId: string, previewEl: HTMLElement) {
        try {
            const block = await getBlockByID(blockId);
            if (!block) {
                previewEl.textContent = '块不存在';
                return;
            }

            let snippet = '';
            if (block.type === 'd') {
                snippet = block.content || '';
            } else {
                try {
                    const domString = await getBlockDOM(blockId);
                    const parser = new DOMParser();
                    const dom = parser.parseFromString(domString.dom, 'text/html');
                    const element = dom.querySelector('div[data-type="NodeParagraph"]');
                    if (element) {
                        const attrElement = element.querySelector('div.protyle-attr');
                        if (attrElement) attrElement.remove();
                    }
                    snippet = (element ? (element.textContent || '') : (block.fcontent || block.content || '')) || '';
                } catch (e) {
                    snippet = block.fcontent || block.content || '';
                }
            }

            previewEl.textContent = snippet ? snippet.trim().slice(0, 200) : '';
        } catch (err) {
            console.error('获取块预览失败:', err);
            previewEl.textContent = '获取块信息失败';
        }
    }

    private extractBlockId(raw: string): string | null {
        if (!raw) return null;
        const blockRefRegex = /\(\(([\w\-]+)\s+'(.*)'\)\)/;
        const blockLinkRegex = /\[(.*)\]\(siyuan:\/\/blocks\/([\w\-]+)\)/;
        const match1 = raw.match(blockRefRegex);
        if (match1) return match1[1];
        const match2 = raw.match(blockLinkRegex);
        if (match2) return match2[2];
        const urlRegex = /siyuan:\/\/blocks\/([\w\-]+)/;
        const match3 = raw.match(urlRegex);
        if (match3) return match3[1];
        const idRegex = /^([a-zA-Z0-9\-]{5,})$/;
        if (idRegex.test(raw)) return raw;
        return null;
    }
}
