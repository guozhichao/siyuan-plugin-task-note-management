import { Dialog } from "siyuan";
import { Habit } from "./HabitPanel";

export class HabitStatsDialog {
    private dialog: Dialog;
    private habit: Habit;
    private currentMonthDate: Date = new Date();

    constructor(habit: Habit) {
        this.habit = habit;
    }

    show() {
        this.dialog = new Dialog({
            title: `${this.habit.title} - 统计信息`,
            content: '<div id="habitStatsContainer"></div>',
            width: "800px",
            height: "600px"
        });

        const container = this.dialog.element.querySelector('#habitStatsContainer') as HTMLElement;
        if (!container) return;

        this.currentMonthDate = new Date();
        this.renderStats(container);
    }

    private renderStats(container: HTMLElement) {
        container.style.cssText = 'padding: 20px; overflow-y: auto; height: 100%;';

        // 注意：月份切换工具栏已移动到 renderMonthlyView 内部以便只在月度视图显示

        // 统计摘要
        const summary = document.createElement('div');
        summary.style.cssText = 'margin-bottom: 24px;';

        const totalCheckIns = this.habit.totalCheckIns || 0;
        const checkInDays = Object.keys(this.habit.checkIns || {}).length;

        summary.innerHTML = `
            <h3 style="margin-bottom: 12px;">打卡统计</h3>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
                <div style="padding: 16px; background: var(--b3-theme-surface); border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: var(--b3-theme-primary);">${totalCheckIns}</div>
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-top: 4px;">总打卡次数</div>
                </div>
                <div style="padding: 16px; background: var(--b3-theme-surface); border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: var(--b3-theme-primary);">${checkInDays}</div>
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-top: 4px;">打卡天数</div>
                </div>
                <div style="padding: 16px; background: var(--b3-theme-surface); border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: var(--b3-theme-primary);">${this.calculateStreak()}</div>
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-top: 4px;">连续打卡天数</div>
                </div>
            </div>
        `;

        container.appendChild(summary);

        // Emoji统计
        const emojiStats = this.calculateEmojiStats();
        if (emojiStats.length > 0) {
            const emojiSection = document.createElement('div');
            emojiSection.style.cssText = 'margin-bottom: 24px;';

            const emojiTitle = document.createElement('h3');
            emojiTitle.textContent = '打卡状态分布';
            emojiTitle.style.marginBottom = '12px';
            emojiSection.appendChild(emojiTitle);

            const emojiGrid = document.createElement('div');
            emojiGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px;';

            emojiStats.forEach(stat => {
                const card = document.createElement('div');
                card.style.cssText = 'padding: 12px; background: var(--b3-theme-surface); border-radius: 8px; text-align: center;';
                card.innerHTML = `
                    <div style="font-size: 32px; margin-bottom: 8px;">${stat.emoji}</div>
                    <div style="font-size: 14px; font-weight: bold;">${stat.count}次</div>
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light);">${stat.percentage.toFixed(1)}%</div>
                `;
                emojiGrid.appendChild(card);
            });

            emojiSection.appendChild(emojiGrid);
            container.appendChild(emojiSection);
        }

        // 月度视图
        const monthlyContainer = document.createElement('div');
        container.appendChild(monthlyContainer);
        this.renderMonthlyView(monthlyContainer);

        // 年度视图
        this.renderYearlyView(container);
    }

    private calculateStreak(): number {
        if (!this.habit.checkIns || Object.keys(this.habit.checkIns).length === 0) {
            return 0;
        }

        const dates = Object.keys(this.habit.checkIns).sort().reverse();
        const today = new Date().toISOString().split('T')[0];

        let streak = 0;
        let currentDate = new Date(today);

        for (const dateStr of dates) {
            const checkDate = new Date(dateStr);
            const dayDiff = Math.floor((currentDate.getTime() - checkDate.getTime()) / (1000 * 60 * 60 * 24));

            if (dayDiff === streak) {
                streak++;
            } else if (dayDiff > streak) {
                break;
            }
        }

        return streak;
    }

    private calculateEmojiStats(): Array<{ emoji: string; count: number; percentage: number }> {
        const emojiCount: Record<string, number> = {};
        let total = 0;

        Object.values(this.habit.checkIns || {}).forEach(checkIn => {
            (checkIn.status || []).forEach(emoji => {
                emojiCount[emoji] = (emojiCount[emoji] || 0) + 1;
                total++;
            });
        });

        return Object.entries(emojiCount).map(([emoji, count]) => ({
            emoji,
            count,
            percentage: total === 0 ? 0 : (count / total) * 100
        })).sort((a, b) => b.count - a.count);
    }

    private renderMonthlyView(container: HTMLElement) {
        container.innerHTML = '';
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom: 24px;';

        // 月视图工具栏（只在月度视图显示）
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:8px; justify-content:center;';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'b3-button';
        prevBtn.textContent = '◀';
        prevBtn.addEventListener('click', () => {
            this.currentMonthDate.setMonth(this.currentMonthDate.getMonth() - 1);
            this.renderMonthlyView(container);
        });

        const todayBtn = document.createElement('button');
        todayBtn.className = 'b3-button';
        todayBtn.textContent = '今天';
        todayBtn.addEventListener('click', () => {
            this.currentMonthDate = new Date();
            this.renderMonthlyView(container);
        });

        const nextBtn = document.createElement('button');
        nextBtn.className = 'b3-button';
        nextBtn.textContent = '▶';
        nextBtn.addEventListener('click', () => {
            this.currentMonthDate.setMonth(this.currentMonthDate.getMonth() + 1);
            this.renderMonthlyView(container);
        });

        const dateLabel = document.createElement('span');
        dateLabel.style.cssText = 'font-weight:bold; margin-left:8px;';
        dateLabel.textContent = this.getMonthLabel();

        toolbar.appendChild(prevBtn);
        toolbar.appendChild(todayBtn);
        toolbar.appendChild(nextBtn);
        toolbar.appendChild(dateLabel);

        const title = document.createElement('h3');
        title.textContent = '月度打卡视图';
        title.style.cssText = 'margin:0;';

        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;';
        titleRow.appendChild(title);
        titleRow.appendChild(toolbar);
        section.appendChild(titleRow);

        const monthGrid = document.createElement('div');
        monthGrid.style.cssText = 'display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;';

        // 获取当前月份的所有日期
        const now = this.currentMonthDate || new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = date.toISOString().split('T')[0];
            const checkIn = this.habit.checkIns?.[dateStr];

            const dayCell = document.createElement('div');
            dayCell.style.cssText = `
                aspect-ratio: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                font-size: 12px;
                background: ${checkIn ? 'var(--b3-theme-primary-lighter)' : 'var(--b3-theme-surface)'};
                border: 1px solid var(--b3-theme-surface-lighter);
            `;

            // 显示日期以及状态 emoji（支持多行、自动缩放字体）
            const contentWrap = document.createElement('div');
            contentWrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; width:100%; height:100%; padding:6px; box-sizing:border-box; overflow:hidden;';

            const dateSpan = document.createElement('div');
            dateSpan.textContent = String(day);
            dateSpan.style.cssText = 'font-size:12px; color: var(--b3-theme-on-surface-light); width:100%; text-align:center;';
            contentWrap.appendChild(dateSpan);

            if (checkIn && checkIn.status && checkIn.status.length > 0) {
                const statuses = checkIn.status.filter(Boolean);
                const count = statuses.length;
                // 根据 emoji 数量计算字体大小
                let fontSize = 18;
                if (count > 12) fontSize = 10;
                else if (count > 8) fontSize = 12;
                else if (count > 4) fontSize = 14;
                else fontSize = 18;

                const emojiContainer = document.createElement('div');
                emojiContainer.style.cssText = `display:flex; flex-wrap:wrap; gap:2px; justify-content:center; align-items:center; width:100%;`;

                statuses.forEach(s => {
                    const span = document.createElement('span');
                    span.textContent = s;
                    span.title = s;
                    span.style.cssText = `font-size:${fontSize}px; line-height:1;`; // 自动换行
                    emojiContainer.appendChild(span);
                });

                contentWrap.appendChild(emojiContainer);
                dayCell.title = `${day}日: ${statuses.join(' ')}`;
            } else {
                const emptyPlaceholder = document.createElement('div');
                emptyPlaceholder.style.cssText = 'width:12px; height:12px; border-radius:50%; background:var(--b3-theme-surface); margin-top:4px;';
                contentWrap.appendChild(emptyPlaceholder);
            }

            dayCell.appendChild(contentWrap);

            monthGrid.appendChild(dayCell);
        }

        section.appendChild(monthGrid);
        container.appendChild(section);
    }

    private getMonthLabel(): string {
        const now = this.currentMonthDate || new Date();
        return `${now.getFullYear()}年${now.getMonth() + 1}月`;
    }

    private renderYearlyView(container: HTMLElement) {
        const section = document.createElement('div');

        const title = document.createElement('h3');
        title.textContent = '年度打卡视图';
        title.style.marginBottom = '12px';
        section.appendChild(title);

        const yearGrid = document.createElement('div');
        yearGrid.style.cssText = 'display: grid; grid-template-columns: repeat(12, 1fr); gap: 8px;';

        const now = this.currentMonthDate || new Date();
        const year = now.getFullYear();

        for (let month = 0; month < 12; month++) {
            const monthCard = document.createElement('div');
            monthCard.style.cssText = 'padding: 8px; background: var(--b3-theme-surface); border-radius: 4px;';

            const monthName = document.createElement('div');
            monthName.textContent = `${month + 1}月`;
            monthName.style.cssText = 'font-size: 12px; font-weight: bold; margin-bottom: 4px; text-align: center;';
            monthCard.appendChild(monthName);

            const daysInMonth = new Date(year, month + 1, 0).getDate();
            let checkInCount = 0;

            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                const dateStr = date.toISOString().split('T')[0];
                if (this.habit.checkIns?.[dateStr]) {
                    checkInCount++;
                }
            }

            const countDiv = document.createElement('div');
            countDiv.textContent = `${checkInCount}天`;
            countDiv.style.cssText = 'font-size: 16px; font-weight: bold; text-align: center; color: var(--b3-theme-primary);';
            monthCard.appendChild(countDiv);

            yearGrid.appendChild(monthCard);
        }

        section.appendChild(yearGrid);
        container.appendChild(section);
    }
}
