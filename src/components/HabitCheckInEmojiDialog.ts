import "emoji-picker-element";
import { Dialog, showMessage } from "siyuan";
import { Habit, HabitCheckInEmoji } from "./HabitPanel";
export class HabitCheckInEmojiDialog {
    private dialog: Dialog;
    private habit: Habit;
    private onSave: (emojis: HabitCheckInEmoji[]) => Promise<void>;
    private emojis: HabitCheckInEmoji[];

    constructor(habit: Habit, onSave: (emojis: HabitCheckInEmoji[]) => Promise<void>) {
        this.habit = habit;
        this.onSave = onSave;
        // 深拷贝现有的emoji配置
        this.emojis = JSON.parse(JSON.stringify(habit.checkInEmojis || []));

        // 如果没有配置,使用默认值
        if (this.emojis.length === 0) {
            this.emojis = [
                { emoji: '✅', meaning: '完成', promptNote: false },
                { emoji: '❌', meaning: '未完成', promptNote: false },
                { emoji: '⭕️', meaning: '部分完成', promptNote: false }
            ];
        }
    }

    show() {
        this.dialog = new Dialog({
            title: `编辑打卡选项 - ${this.habit.title}`,
            content: '<div id="checkInEmojiContainer"></div>',
            width: "600px",
            height: "600px"
        });

        const container = this.dialog.element.querySelector('#checkInEmojiContainer') as HTMLElement;
        if (!container) return;

        this.renderEmojiList(container);
    }

    private renderEmojiList(container: HTMLElement) {
        container.innerHTML = '';
        container.style.cssText = 'padding: 20px; display: flex; flex-direction: column; height: 100%;';

        // 说明文字
        const description = document.createElement('div');
        description.style.cssText = `
            margin-bottom: 20px; 
            padding: 16px 20px; 
            background: linear-gradient(135deg, var(--b3-theme-primary-lightest) 0%, var(--b3-theme-surface) 100%);
            border-radius: 12px; 
            font-size: 13px; 
            color: var(--b3-theme-on-surface);
            border-left: 4px solid var(--b3-theme-primary);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        `;
        description.innerHTML = `
            <div style="margin-bottom: 8px; font-size: 14px; font-weight: 600; color: var(--b3-theme-primary);"><strong>✨ 打卡选项说明</strong></div>
            <div style="margin-bottom: 4px; opacity: 0.9;">• <strong>Emoji 圆圈</strong>: 点击圆圈选择打卡时显示的图标</div>
            <div style="opacity: 0.9;">• <strong>含义说明</strong>: 为该打卡选项添加描述文字</div>
            `;
        container.appendChild(description);

        // Emoji列表 - 使用列表布局
        const listContainer = document.createElement('div');
        listContainer.style.cssText = `
            flex: 1; 
            overflow-y: auto; 
            margin-bottom: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 4px;
        `;

        this.emojis.forEach((emojiConfig, index) => {
            const item = this.createEmojiItem(emojiConfig, index);
            listContainer.appendChild(item);
        });

        container.appendChild(listContainer);

        // 底部按钮
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 8px; justify-content: space-between;';

        // 添加新选项按钮
        const addBtn = document.createElement('button');
        addBtn.className = 'b3-button b3-button--outline';
        addBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> 添加选项';
        addBtn.addEventListener('click', () => {
            this.addEmoji();
        });

        // 右侧按钮组
        const rightButtons = document.createElement('div');
        rightButtons.style.cssText = 'display: flex; gap: 8px;';

        const resetBtn = document.createElement('button');
        resetBtn.className = 'b3-button';
        resetBtn.textContent = '恢复默认';
        resetBtn.addEventListener('click', () => {
            this.resetToDefault();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'b3-button';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => {
            this.dialog.destroy();
        });

        const saveBtn = document.createElement('button');
        saveBtn.className = 'b3-button b3-button--primary';
        saveBtn.textContent = '保存';
        saveBtn.addEventListener('click', async () => {
            await this.handleSave();
        });

        rightButtons.appendChild(resetBtn);
        rightButtons.appendChild(cancelBtn);
        rightButtons.appendChild(saveBtn);

        buttonContainer.appendChild(addBtn);
        buttonContainer.appendChild(rightButtons);

        container.appendChild(buttonContainer);
    }

    private createEmojiItem(emojiConfig: HabitCheckInEmoji, index: number): HTMLElement {
        const item = document.createElement('div');
        item.style.cssText = `
            display: flex;
            flex-direction: row;
            align-items: center;
            padding: 12px 16px;
            background: var(--b3-theme-surface);
            border-radius: 12px;
            border: 1px solid var(--b3-theme-surface-lighter);
            position: relative;
            transition: all 0.2s ease;
            gap: 16px;
        `;

        // 添加悬停效果
        item.addEventListener('mouseenter', () => {
            item.style.borderColor = 'var(--b3-theme-primary-lighter)';
            item.style.backgroundColor = 'var(--b3-theme-surface-light)';
        });

        item.addEventListener('mouseleave', () => {
            item.style.borderColor = 'var(--b3-theme-surface-lighter)';
            item.style.backgroundColor = 'var(--b3-theme-surface)';
        });

        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'b3-button b3-button--text';
        deleteBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>';
        deleteBtn.title = '删除';
        deleteBtn.style.cssText = `
            padding: 6px;
            width: 32px;
            height: 32px;
            border-radius: 6px;
            opacity: 0.6;
            transition: all 0.2s;
            flex-shrink: 0;
            color: var(--b3-theme-on-surface-light);
            margin-left: auto;
        `;

        // 至少保留一个选项
        if (this.emojis.length <= 1) {
            deleteBtn.disabled = true;
            deleteBtn.style.opacity = '0.3';
            deleteBtn.style.cursor = 'not-allowed';
        } else {
            deleteBtn.addEventListener('mouseenter', () => {
                deleteBtn.style.opacity = '1';
                deleteBtn.style.background = 'var(--b3-theme-error-lighter)';
                deleteBtn.style.color = 'var(--b3-theme-error)';
            });

            deleteBtn.addEventListener('mouseleave', () => {
                deleteBtn.style.opacity = '0.6';
                deleteBtn.style.background = 'transparent';
                deleteBtn.style.color = 'var(--b3-theme-on-surface-light)';
            });
        }

        deleteBtn.addEventListener('click', () => {
            if (this.emojis.length > 1) {
                this.deleteEmoji(index);
            }
        });

        // Emoji选择器容器
        const emojiContainer = document.createElement('div');
        emojiContainer.style.cssText = 'position: relative;';

        // 当前emoji显示
        const emojiCircle = document.createElement('div');
        emojiCircle.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--b3-theme-surface-lighter);
            border: 2px solid var(--b3-theme-primary-lighter);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            cursor: pointer;
            transition: all 0.2s;
            flex-shrink: 0;
            user-select: none;
        `;

        emojiCircle.textContent = emojiConfig.emoji;

        emojiCircle.addEventListener('mouseenter', () => {
            emojiCircle.style.transform = 'scale(1.1)';
            emojiCircle.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
        });

        emojiCircle.addEventListener('mouseleave', () => {
            emojiCircle.style.transform = 'scale(1)';
            emojiCircle.style.boxShadow = 'none';
        });

        emojiCircle.addEventListener('click', () => {
            picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
        });

        // Emoji picker
        const picker = document.createElement('emoji-picker') as any;
        picker.style.cssText = 'position: absolute; top: 100%; left: 0; z-index: 1000; display: none; width: 320px; height: 400px; margin-top: 8px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); border-radius: 12px;';
        picker.locale = 'zh';
        picker.addEventListener('emoji-click', (event: any) => {
            const selectedEmoji = event.detail.emoji.unicode;
            emojiCircle.textContent = selectedEmoji;
            this.emojis[index].emoji = selectedEmoji;
            picker.style.display = 'none';
        });

        // 点击外部关闭picker
        const closePickerHandler = (e: MouseEvent) => {
            if (!emojiContainer.contains(e.target as Node)) {
                picker.style.display = 'none';
            }
        };
        document.addEventListener('click', closePickerHandler);

        emojiContainer.appendChild(emojiCircle);
        emojiContainer.appendChild(picker);

        // 含义输入
        const meaningInput = document.createElement('input');
        meaningInput.type = 'text';
        meaningInput.className = 'b3-text-field';
        meaningInput.value = emojiConfig.meaning;
        meaningInput.placeholder = '输入含义说明...';
        meaningInput.style.cssText = `
            flex: 1;
            padding: 8px 12px;
            border-radius: 6px;
            border: 1px solid transparent;
            background: transparent;
            font-size: 14px;
            transition: all 0.2s;
        `;

        meaningInput.addEventListener('mouseenter', () => {
            if (document.activeElement !== meaningInput) {
                meaningInput.style.border = '1px solid var(--b3-theme-surface-lighter)';
            }
        });

        meaningInput.addEventListener('mouseleave', () => {
            if (document.activeElement !== meaningInput) {
                meaningInput.style.border = '1px solid transparent';
            }
        });

        meaningInput.addEventListener('focus', () => {
            meaningInput.style.borderColor = 'var(--b3-theme-primary)';
            meaningInput.style.background = 'var(--b3-theme-background)';
        });

        meaningInput.addEventListener('blur', () => {
            meaningInput.style.borderColor = 'transparent';
            meaningInput.style.background = 'transparent';
        });

        meaningInput.addEventListener('input', (e) => {
            this.emojis[index].meaning = (e.target as HTMLInputElement).value;
        });

        // 如果该选项需要在打卡时弹窗备注
        const promptNoteWrap = document.createElement('label');
        promptNoteWrap.style.cssText = 'display:flex; align-items:center; gap:8px; margin-left:8px;';
        const promptNoteCheckbox = document.createElement('input');
        promptNoteCheckbox.type = 'checkbox';
        promptNoteCheckbox.checked = !!emojiConfig.promptNote;
        promptNoteCheckbox.addEventListener('change', () => {
            this.emojis[index].promptNote = (promptNoteCheckbox as HTMLInputElement).checked;
        });
        const promptNoteText = document.createElement('span');
        promptNoteText.textContent = '打卡时询问备注';
        promptNoteText.style.cssText = 'font-size: 12px; color:var(--b3-theme-on-surface-light);';
        promptNoteWrap.appendChild(promptNoteCheckbox);
        promptNoteWrap.appendChild(promptNoteText);

        // 把 promptNote 插入到 item，放在含义输入后面
        item.appendChild(emojiContainer);
        item.appendChild(meaningInput);
        item.appendChild(promptNoteWrap);
        item.appendChild(deleteBtn);

        return item;
    }

    private addEmoji() {
        // 添加新的emoji选项
        this.emojis.push({
            emoji: '⭐',
            meaning: '新选项',
            promptNote: false
        });

        // 重新渲染列表
        const container = this.dialog.element.querySelector('#checkInEmojiContainer') as HTMLElement;
        if (container) {
            this.renderEmojiList(container);
        }
    }

    private deleteEmoji(index: number) {
        if (this.emojis.length <= 1) {
            showMessage('至少需要保留一个打卡选项', 3000, 'error');
            return;
        }

        this.emojis.splice(index, 1);

        // 重新渲染列表
        const container = this.dialog.element.querySelector('#checkInEmojiContainer') as HTMLElement;
        if (container) {
            this.renderEmojiList(container);
        }
    }

    private resetToDefault() {
        this.emojis = [
            { emoji: '✅', meaning: '完成', promptNote: false },
            { emoji: '❌', meaning: '未完成', promptNote: false },
            { emoji: '⭕️', meaning: '部分完成', promptNote: false }
        ];

        // 重新渲染列表
        const container = this.dialog.element.querySelector('#checkInEmojiContainer') as HTMLElement;
        if (container) {
            this.renderEmojiList(container);
        }

        showMessage('已恢复默认设置');
    }

    private async handleSave() {
        // 验证数据
        for (let i = 0; i < this.emojis.length; i++) {
            const emoji = this.emojis[i];

            if (!emoji.emoji || emoji.emoji.trim() === '') {
                showMessage(`第${i + 1}个选项的Emoji不能为空`, 3000, 'error');
                return;
            }

            if (!emoji.meaning || emoji.meaning.trim() === '') {
                showMessage(`第${i + 1}个选项的含义不能为空`, 3000, 'error');
                return;
            }

            // no statistical value validation required anymore

            // 去除首尾空格
            emoji.emoji = emoji.emoji.trim();
            emoji.meaning = emoji.meaning.trim();
        }

        // 检查是否有重复的emoji
        const emojiSet = new Set(this.emojis.map(e => e.emoji));
        if (emojiSet.size !== this.emojis.length) {
            showMessage('存在重复的Emoji,请修改', 3000, 'error');
            return;
        }

        try {
            await this.onSave(this.emojis);
            showMessage('保存成功');
            this.dialog.destroy();
        } catch (error) {
            console.error('保存打卡选项失败:', error);
            showMessage('保存失败', 3000, 'error');
        }
    }
}
