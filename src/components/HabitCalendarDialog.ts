import { Dialog } from "siyuan";
import { readHabitData } from "../api";
import { Habit } from "./HabitPanel";

export class HabitCalendarDialog {
    private dialog: Dialog;
    private currentView: 'week' | 'month' = 'week';
    private currentDate: Date = new Date();

    show() {
        this.dialog = new Dialog({
            title: "打卡日历",
            content: '<div id="habitCalendarContainer"></div>',
            width: "900px",
            height: "700px"
        });

        const container = this.dialog.element.querySelector('#habitCalendarContainer') as HTMLElement;
        if (!container) return;

        // 禁止内容编辑
        container.contentEditable = 'false';

        this.renderCalendar(container);
    }

    private async renderCalendar(container: HTMLElement) {
        container.innerHTML = ''; // 清空容器以避免累积内容
        container.className = 'habit-calendar-container';

        // 工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'habit-calendar-toolbar';

        // 视图切换 - 滑动开关样式
        const viewToggle = document.createElement('div');
        viewToggle.className = 'habit-calendar-view-toggle';

        const weekBtn = document.createElement('button');
        weekBtn.className = this.currentView === 'week' ? 'view-toggle-btn active' : 'view-toggle-btn';
        weekBtn.textContent = '周视图';
        weekBtn.addEventListener('click', () => {
            this.currentView = 'week';
            this.renderCalendar(container);
        });

        const monthBtn = document.createElement('button');
        monthBtn.className = this.currentView === 'month' ? 'view-toggle-btn active' : 'view-toggle-btn';
        monthBtn.textContent = '月视图';
        monthBtn.addEventListener('click', () => {
            this.currentView = 'month';
            this.renderCalendar(container);
        });

        viewToggle.appendChild(weekBtn);
        viewToggle.appendChild(monthBtn);

        toolbar.appendChild(viewToggle);

        // 导航按钮
        const navigation = document.createElement('div');
        navigation.className = 'habit-calendar-navigation';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'b3-button';
        prevBtn.textContent = '◀';
        prevBtn.addEventListener('click', () => {
            if (this.currentView === 'week') {
                this.currentDate.setDate(this.currentDate.getDate() - 7);
            } else {
                this.currentDate.setMonth(this.currentDate.getMonth() - 1);
            }
            this.renderCalendar(container);
        });

        const todayBtn = document.createElement('button');
        todayBtn.className = 'b3-button';
        todayBtn.textContent = '今天';
        todayBtn.addEventListener('click', () => {
            this.currentDate = new Date();
            this.renderCalendar(container);
        });

        const nextBtn = document.createElement('button');
        nextBtn.className = 'b3-button';
        nextBtn.textContent = '▶';
        nextBtn.addEventListener('click', () => {
            if (this.currentView === 'week') {
                this.currentDate.setDate(this.currentDate.getDate() + 7);
            } else {
                this.currentDate.setMonth(this.currentDate.getMonth() + 1);
            }
            this.renderCalendar(container);
        });

        const dateLabel = document.createElement('span');
        dateLabel.className = 'habit-calendar-date-label';
        dateLabel.textContent = this.getDateRangeLabel();

        navigation.appendChild(prevBtn);
        navigation.appendChild(todayBtn);
        navigation.appendChild(dateLabel);
        navigation.appendChild(nextBtn);

        toolbar.appendChild(viewToggle);
        toolbar.appendChild(navigation);

        container.appendChild(toolbar);

        // 日历内容
        const calendarContent = document.createElement('div');
        calendarContent.className = 'habit-calendar-content';

        const habitData = await readHabitData();
        const habits: Habit[] = Object.values(habitData || {});

        if (this.currentView === 'week') {
            this.renderWeekView(calendarContent, habits);
        } else {
            this.renderMonthView(calendarContent, habits);
        }

        container.appendChild(calendarContent);
    }

    private getDateRangeLabel(): string {
        if (this.currentView === 'week') {
            const weekStart = new Date(this.currentDate);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            return `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月${weekStart.getDate()}日 - ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;
        } else {
            return `${this.currentDate.getFullYear()}年${this.currentDate.getMonth() + 1}月`;
        }
    }

    private renderWeekView(container: HTMLElement, habits: Habit[]) {
        const grid = document.createElement('div');
        grid.className = 'habit-calendar-grid week-view';
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = '150px repeat(7, 1fr)';
        grid.style.gap = '8px';

        // 表头
        const habitHeader = document.createElement('div');
        habitHeader.className = 'grid-header habit-header';
        habitHeader.contentEditable = 'false';
        habitHeader.textContent = '习惯';
        grid.appendChild(habitHeader);

        const weekStart = new Date(this.currentDate);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());

        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
            const th = document.createElement('div');
            th.className = 'grid-header date-header';
            th.contentEditable = 'false';
            th.textContent = `${['日', '一', '二', '三', '四', '五', '六'][i]} ${date.getMonth() + 1}/${date.getDate()}`;
            grid.appendChild(th);
        }

        // 表体
        habits.forEach(habit => {
            const nameCell = document.createElement('div');
            nameCell.className = 'grid-cell habit-name-cell';
            nameCell.contentEditable = 'false';
            nameCell.textContent = habit.title;
            grid.appendChild(nameCell);

            for (let i = 0; i < 7; i++) {
                const date = new Date(weekStart);
                date.setDate(date.getDate() + i);
                const dateStr = date.toISOString().split('T')[0];

                const cell = document.createElement('div');
                cell.className = 'grid-cell date-cell';
                cell.contentEditable = 'false';

                const checkIn = habit.checkIns?.[dateStr];
                if (checkIn && checkIn.status && checkIn.status.length > 0) {
                    const badge = document.createElement('div');
                    badge.className = 'date-badge';

                    const statuses = checkIn.status.filter(Boolean);

                    // 根据emoji数量添加不同的class
                    if (statuses.length >= 7) {
                        badge.classList.add('count-many');
                    } else if (statuses.length >= 4) {
                        badge.classList.add(`count-${statuses.length}`);
                    } else if (statuses.length >= 2) {
                        badge.classList.add(`count-${statuses.length}`);
                    }

                    // 兼容旧逻辑
                    if (statuses.length > 1) {
                        badge.classList.add('multi');
                    }

                    // 显示所有emoji
                    statuses.forEach(s => {
                        const span = document.createElement('span');
                        span.className = 'emoji';
                        span.textContent = s;
                        badge.appendChild(span);
                    });
                    cell.appendChild(badge);
                } else {
                    cell.classList.add('empty');
                    // 空状态也可以有一个占位圆圈
                    const emptyBadge = document.createElement('div');
                    emptyBadge.className = 'date-badge empty-badge';
                    cell.appendChild(emptyBadge);
                }

                grid.appendChild(cell);
            }
        });

        container.appendChild(grid);
    }

    private renderMonthView(container: HTMLElement, habits: Habit[]) {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const grid = document.createElement('div');
        grid.className = 'habit-calendar-grid month-view';
        grid.style.display = 'grid';
        // 增加最小宽度到60px以容纳多个emoji
        grid.style.gridTemplateColumns = `150px repeat(${daysInMonth}, minmax(60px, 1fr))`;
        grid.style.gap = '8px';

        // 表头
        const habitHeader = document.createElement('div');
        habitHeader.className = 'grid-header habit-header';
        habitHeader.contentEditable = 'false';
        habitHeader.textContent = '习惯';
        grid.appendChild(habitHeader);

        for (let day = 1; day <= daysInMonth; day++) {
            const th = document.createElement('div');
            th.className = 'grid-header date-header';
            th.contentEditable = 'false';
            th.textContent = String(day);
            grid.appendChild(th);
        }

        // 表体
        habits.forEach(habit => {
            const nameCell = document.createElement('div');
            nameCell.className = 'grid-cell habit-name-cell';
            nameCell.contentEditable = 'false';
            nameCell.textContent = habit.title;
            grid.appendChild(nameCell);

            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                const dateStr = date.toISOString().split('T')[0];

                const cell = document.createElement('div');
                cell.className = 'grid-cell date-cell';
                cell.contentEditable = 'false';

                const checkIn = habit.checkIns?.[dateStr];
                if (checkIn && checkIn.status && checkIn.status.length > 0) {
                    const badge = document.createElement('div');
                    badge.className = 'date-badge';

                    const statuses = checkIn.status.filter(Boolean);

                    // 根据emoji数量添加不同的class
                    if (statuses.length >= 7) {
                        badge.classList.add('count-many');
                    } else if (statuses.length >= 4) {
                        badge.classList.add(`count-${statuses.length}`);
                    } else if (statuses.length >= 2) {
                        badge.classList.add(`count-${statuses.length}`);
                    }

                    // 兼容旧逻辑
                    if (statuses.length > 1) {
                        badge.classList.add('multi');
                    }

                    // 显示所有emoji
                    statuses.forEach(s => {
                        const span = document.createElement('span');
                        span.className = 'emoji';
                        span.textContent = s;
                        badge.appendChild(span);
                    });
                    cell.appendChild(badge);
                } else {
                    cell.classList.add('empty');
                    const emptyBadge = document.createElement('div');
                    emptyBadge.className = 'date-badge empty-badge';
                    cell.appendChild(emptyBadge);
                }

                grid.appendChild(cell);
            }
        });

        container.appendChild(grid);
    }
}
