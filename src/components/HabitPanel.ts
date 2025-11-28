import { showMessage, Dialog, Menu, confirm } from "siyuan";
import { readHabitData, writeHabitData, getBlockByID, getBlockDOM, openBlock } from "../api";
import { getLocalDateString, getLocalDateTimeString } from "../utils/dateUtils";
import { HabitGroupManager } from "../utils/habitGroupManager";
import { HabitCalendarDialog } from "./HabitCalendarDialog";
import { HabitEditDialog } from "./HabitEditDialog";
import { HabitStatsDialog } from "./HabitStatsDialog";
import { HabitGroupManageDialog } from "./HabitGroupManageDialog";
import { HabitCheckInEmojiDialog } from "./HabitCheckInEmojiDialog";
import { HabitHistoryDialog } from "./HabitHistoryDialog";

export interface HabitCheckInEmoji {
    emoji: string;
    meaning: string;
    // 当打卡该emoji时，是否在每次打卡时弹窗输入备注
    promptNote?: boolean;
    // value removed: now emoji only has emoji and meaning
}

export interface Habit {
    id: string;
    title: string;
    blockId?: string; // 绑定的块ID
    target: number; // 每次打卡需要打卡x次
    frequency: {
        type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
        interval?: number; // 重复间隔，比如每x天
        weekdays?: number[]; // 重复星期 (0-6, 0=周日)
        monthDays?: number[]; // 重复日期 (1-31)
    };
    startDate: string;
    endDate?: string;
    reminderTime?: string; // 提醒时间
    groupId?: string; // 分组ID
    priority?: 'high' | 'medium' | 'low' | 'none';
    checkInEmojis: HabitCheckInEmoji[]; // 打卡emoji配置
    checkIns: { // 打卡记录
        [date: string]: {
            count: number; // 当天打卡次数
            status: string[]; // 打卡状态emoji数组（兼容旧格式）
            timestamp: string; // 最后打卡时间
            entries?: { emoji: string; timestamp: string; note?: string }[]; // 每次单独打卡记录
        };
    };
    totalCheckIns: number; // 总打卡次数（保留历史数据，已不在主面板显示）
    createdAt: string;
    updatedAt: string;
}

export class HabitPanel {
    private container: HTMLElement;
    private habitsContainer: HTMLElement;
    private filterSelect: HTMLSelectElement;
    private groupFilterButton: HTMLButtonElement;
    private currentTab: string = 'today';
    private selectedGroups: string[] = [];
    // 排序选项
    private sortKey: 'priority' | 'title' = 'priority';
    private sortOrder: 'desc' | 'asc' = 'desc';
    private groupManager: HabitGroupManager;
    private habitUpdatedHandler: () => void;
    private collapsedGroups: Set<string> = new Set();

    constructor(container: HTMLElement) {
        this.container = container;
        this.groupManager = HabitGroupManager.getInstance();

        this.habitUpdatedHandler = () => {
            this.loadHabits();
        };

        this.initializeAsync();
    }

    private async initializeAsync() {
        await this.groupManager.initialize();
        await this.loadCollapseStates();

        this.initUI();
        this.loadHabits();

        window.addEventListener('habitUpdated', this.habitUpdatedHandler);
    }

    public destroy() {
        this.saveCollapseStates();
        if (this.habitUpdatedHandler) {
            window.removeEventListener('habitUpdated', this.habitUpdatedHandler);
        }
    }

    private async loadCollapseStates() {
        try {
            const states = localStorage.getItem('habit-panel-collapse-states');
            if (states) {
                this.collapsedGroups = new Set(JSON.parse(states));
            }
        } catch (error) {
            console.warn('加载折叠状态失败:', error);
        }
    }

    private saveCollapseStates() {
        try {
            localStorage.setItem('habit-panel-collapse-states',
                JSON.stringify(Array.from(this.collapsedGroups)));
        } catch (error) {
            console.warn('保存折叠状态失败:', error);
        }
    }

    private initUI() {
        this.container.classList.add('habit-panel');
        this.container.innerHTML = '';

        // 标题部分
        const header = document.createElement('div');
        header.className = 'habit-header';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'habit-title';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'habit-icon';
        iconSpan.textContent = '✅';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = "习惯打卡";

        titleContainer.appendChild(iconSpan);
        titleContainer.appendChild(titleSpan);

        // 按钮容器
        const actionContainer = document.createElement('div');
        actionContainer.className = 'habit-panel__actions';
        actionContainer.style.cssText = 'display:flex; justify-content:flex-start; gap:8px; margin-bottom:8px;';

        // 新建习惯按钮
        const newHabitBtn = document.createElement('button');
        newHabitBtn.className = 'b3-button b3-button--outline';
        newHabitBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>';
        newHabitBtn.title = "新建习惯";
        newHabitBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showNewHabitDialog();
        });
        actionContainer.appendChild(newHabitBtn);

        // 打卡日历按钮
        const calendarBtn = document.createElement('button');
        calendarBtn.className = 'b3-button b3-button--outline';
        calendarBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg>';
        calendarBtn.title = "打卡日历";
        calendarBtn.addEventListener('click', () => {
            this.showCalendarView();
        });
        actionContainer.appendChild(calendarBtn);

        // 分组管理按钮
        const groupManageBtn = document.createElement('button');
        groupManageBtn.className = 'b3-button b3-button--outline';
        groupManageBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTags"></use></svg>';
        groupManageBtn.title = "分组管理";
        groupManageBtn.addEventListener('click', () => {
            this.showGroupManageDialog();
        });
        actionContainer.appendChild(groupManageBtn);

        // 刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = "刷新";
        refreshBtn.addEventListener('click', () => {
            this.loadHabits();
        });
        actionContainer.appendChild(refreshBtn);

        header.appendChild(titleContainer);
        header.appendChild(actionContainer);

        // 筛选控件
        const controls = document.createElement('div');
        controls.className = 'habit-controls';
        controls.style.cssText = 'display: flex; gap: 8px; width: 100%;';

        // 时间筛选
        this.filterSelect = document.createElement('select');
        this.filterSelect.className = 'b3-select';
        this.filterSelect.style.cssText = 'flex: 1; min-width: 0;';
        this.filterSelect.innerHTML = `
            <option value="today" selected>今日待打卡</option>
            <option value="tomorrow">明日习惯</option>
            <option value="all">所有习惯</option>
            <option value="todayCompleted">今日已打卡</option>
            <option value="yesterdayCompleted">昨日已打卡</option>
        `;
        this.filterSelect.addEventListener('change', () => {
            this.currentTab = this.filterSelect.value;
            this.loadHabits();
        });
        controls.appendChild(this.filterSelect);

        // 分组筛选按钮
        this.groupFilterButton = document.createElement('button');
        this.groupFilterButton.className = 'b3-button b3-button--outline';
        this.groupFilterButton.style.cssText = `
            display: inline-block;
            max-width: 200px;
            box-sizing: border-box;
            padding: 0 8px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            vertical-align: middle;
            text-align: left;
        `;
        this.groupFilterButton.textContent = "分组筛选";
        this.groupFilterButton.addEventListener('click', () => this.showGroupSelectDialog());
        controls.appendChild(this.groupFilterButton);

        // 排序选择器
        const sortSelect = document.createElement('select');
        sortSelect.className = 'b3-select';
        sortSelect.style.cssText = 'width: 160px;';
        sortSelect.innerHTML = `
            <option value="priority_desc">优先级 ↓</option>
            <option value="priority_asc">优先级 ↑</option>
            <option value="title_asc">标题 A-Z</option>
            <option value="title_desc">标题 Z-A</option>
        `;
        sortSelect.value = `${this.sortKey}_${this.sortOrder}`;
        sortSelect.addEventListener('change', (e) => {
            const v = (e.target as HTMLSelectElement).value.split('_');
            this.sortKey = v[0] === 'title' ? 'title' : 'priority';
            this.sortOrder = v[1] === 'asc' ? 'asc' : 'desc';
            this.loadHabits();
        });
        controls.appendChild(sortSelect);

        header.appendChild(controls);
        this.container.appendChild(header);

        // 习惯列表容器
        this.habitsContainer = document.createElement('div');
        this.habitsContainer.className = 'habit-list';
        this.habitsContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        `;
        this.container.appendChild(this.habitsContainer);

        this.updateGroupFilterButtonText();
    }

    private updateGroupFilterButtonText() {
        if (!this.groupFilterButton) return;

        if (this.selectedGroups.length === 0 || this.selectedGroups.includes('all')) {
            this.groupFilterButton.textContent = "分组筛选";
        } else {
            const names = this.selectedGroups.map(id => {
                if (id === 'none') return "无分组";
                const group = this.groupManager.getGroupById(id);
                return group ? group.name : id;
            });
            this.groupFilterButton.textContent = names.join(', ');
        }
    }

    private async loadHabits() {
        try {
            const habitData = await readHabitData();
            const habits: Habit[] = Object.values(habitData || {});

            // 应用筛选
            let filteredHabits = this.applyFilter(habits);
            filteredHabits = this.applyGroupFilter(filteredHabits);

            this.renderHabits(filteredHabits);
        } catch (error) {
            console.error('加载习惯失败:', error);
            this.habitsContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--b3-theme-error);">加载习惯失败</div>';
        }
    }

    private applyFilter(habits: Habit[]): Habit[] {
        const today = getLocalDateString();
        const tomorrow = getLocalDateString(new Date(Date.now() + 86400000));
        const yesterday = getLocalDateString(new Date(Date.now() - 86400000));

        switch (this.currentTab) {
            case 'today':
                return habits.filter(h => this.shouldShowToday(h, today));
            case 'tomorrow':
                return habits.filter(h => this.shouldShowOnDate(h, tomorrow));
            case 'todayCompleted':
                return habits.filter(h => this.isCompletedOnDate(h, today));
            case 'yesterdayCompleted':
                return habits.filter(h => this.isCompletedOnDate(h, yesterday));
            case 'all':
            default:
                return habits;
        }
    }

    private shouldShowToday(habit: Habit, today: string): boolean {
        // 检查是否在有效期内
        if (habit.startDate > today) return false;
        if (habit.endDate && habit.endDate < today) return false;

        // 检查今天是否应该打卡
        if (!this.shouldCheckInOnDate(habit, today)) return false;

        // 检查今天是否已完成
        return !this.isCompletedOnDate(habit, today);
    }

    private shouldShowOnDate(habit: Habit, date: string): boolean {
        if (habit.startDate > date) return false;
        if (habit.endDate && habit.endDate < date) return false;
        return this.shouldCheckInOnDate(habit, date);
    }

    private shouldCheckInOnDate(habit: Habit, date: string): boolean {
        const { frequency } = habit;
        const checkDate = new Date(date);
        const startDate = new Date(habit.startDate);

        switch (frequency.type) {
            case 'daily':
                if (frequency.interval) {
                    const daysDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / 86400000);
                    return daysDiff % frequency.interval === 0;
                }
                return true;

            case 'weekly':
                if (frequency.weekdays && frequency.weekdays.length > 0) {
                    return frequency.weekdays.includes(checkDate.getDay());
                }
                if (frequency.interval) {
                    const weeksDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / (86400000 * 7));
                    return weeksDiff % frequency.interval === 0 && checkDate.getDay() === startDate.getDay();
                }
                return checkDate.getDay() === startDate.getDay();

            case 'monthly':
                if (frequency.monthDays && frequency.monthDays.length > 0) {
                    return frequency.monthDays.includes(checkDate.getDate());
                }
                if (frequency.interval) {
                    const monthsDiff = (checkDate.getFullYear() - startDate.getFullYear()) * 12 +
                        (checkDate.getMonth() - startDate.getMonth());
                    return monthsDiff % frequency.interval === 0 && checkDate.getDate() === startDate.getDate();
                }
                return checkDate.getDate() === startDate.getDate();

            case 'yearly':
                if (frequency.interval) {
                    const yearsDiff = checkDate.getFullYear() - startDate.getFullYear();
                    return yearsDiff % frequency.interval === 0 &&
                        checkDate.getMonth() === startDate.getMonth() &&
                        checkDate.getDate() === startDate.getDate();
                }
                return checkDate.getMonth() === startDate.getMonth() &&
                    checkDate.getDate() === startDate.getDate();

            case 'custom':
                // 自定义频率：如果设置了周重复则按周判断，如果设置了月重复则按月判断；默认返回true
                if (frequency.weekdays && frequency.weekdays.length > 0) {
                    return frequency.weekdays.includes(checkDate.getDay());
                }
                if (frequency.monthDays && frequency.monthDays.length > 0) {
                    return frequency.monthDays.includes(checkDate.getDate());
                }
                return true;

            default:
                return true;
        }
    }

    private isCompletedOnDate(habit: Habit, date: string): boolean {
        const checkIn = habit.checkIns?.[date];
        if (!checkIn) return false;
        return checkIn.count >= habit.target;
    }

    private applyGroupFilter(habits: Habit[]): Habit[] {
        if (this.selectedGroups.length === 0 || this.selectedGroups.includes('all')) {
            return habits;
        }

        return habits.filter(habit => {
            const groupId = habit.groupId || 'none';
            return this.selectedGroups.includes(groupId);
        });
    }

    private renderHabits(habits: Habit[]) {
        this.habitsContainer.innerHTML = '';

        // 如果没有习惯，根据当前 tab 决定是否继续渲染已打卡区
        if (habits.length === 0) {
            if (this.currentTab !== 'today') {
                this.habitsContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--b3-theme-on-surface-light);">暂无习惯</div>';
                return;
            }
            // 否则（today 且主区无待打卡习惯）继续渲染已打卡区
        }

        // 按分组分类
        const groupedHabits = new Map<string, Habit[]>();
        habits.forEach(habit => {
            const groupId = habit.groupId || 'none';
            if (!groupedHabits.has(groupId)) {
                groupedHabits.set(groupId, []);
            }
            groupedHabits.get(groupId)!.push(habit);
        });

        // 记录主区已渲染的习惯ID，防止已打卡区重复渲染
        const renderedIds = new Set<string>();

        // 渲染每个分组
        const sortedGroups = this.groupManager.getAllGroups();

        // 先渲染有分组的习惯，按顺序
        sortedGroups.forEach(group => {
            if (groupedHabits.has(group.id)) {
                const groupHabits = groupedHabits.get(group.id)!;
                groupHabits.forEach(h => renderedIds.add(h.id));
                this.renderGroup(group.id, groupHabits);
                groupedHabits.delete(group.id);
            }
        });

        // 最后渲染无分组的习惯 (groupId === 'none')
        if (groupedHabits.has('none')) {
            const groupHabits = groupedHabits.get('none')!;
            groupHabits.forEach(h => renderedIds.add(h.id));
            this.renderGroup('none', groupHabits);
            groupedHabits.delete('none');
        }

        // 如果还有其他未渲染的分组（理论上不应该有，除非有脏数据），也渲染出来
        groupedHabits.forEach((groupHabits, groupId) => {
            groupHabits.forEach(h => renderedIds.add(h.id));
            this.renderGroup(groupId, groupHabits);
        });

        // 如果是今日待打卡，在下方显示已打卡习惯（排除已在主区渲染的习惯）
        if (this.currentTab === 'today') {
            this.renderCompletedHabitsSection(renderedIds);
        }
    }

    private renderGroup(groupId: string, habits: Habit[]) {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'habit-group';
        groupContainer.style.cssText = 'margin-bottom: 16px;';

        // 分组头部
        const groupHeader = document.createElement('div');
        groupHeader.className = 'habit-group__header';
        groupHeader.style.cssText = `
            display: flex;
            align-items: center;
            padding: 8px;
            background: var(--b3-theme-surface);
            border-radius: 4px;
            cursor: pointer;
            margin-bottom: 8px;
        `;

        const group = groupId === 'none' ? null : this.groupManager.getGroupById(groupId);
        const groupName = group ? group.name : '无分组';
        const isCollapsed = this.collapsedGroups.has(groupId);

        const collapseIcon = document.createElement('span');
        collapseIcon.textContent = isCollapsed ? '▶' : '▼';
        collapseIcon.style.cssText = 'margin-right: 8px; font-size: 12px;';

        const groupTitle = document.createElement('span');
        groupTitle.textContent = `${groupName} (${habits.length})`;
        groupTitle.style.cssText = 'flex: 1; font-weight: bold;';

        groupHeader.appendChild(collapseIcon);
        groupHeader.appendChild(groupTitle);

        groupHeader.addEventListener('click', () => {
            if (this.collapsedGroups.has(groupId)) {
                this.collapsedGroups.delete(groupId);
            } else {
                this.collapsedGroups.add(groupId);
            }
            this.loadHabits();
        });

        groupContainer.appendChild(groupHeader);

        // 分组内容
        if (!isCollapsed) {
            const groupContent = document.createElement('div');
            groupContent.className = 'habit-group__content';

            // 对分组内的习惯进行排序
            const sortedHabits = this.sortHabitsInGroup(habits);
            sortedHabits.forEach(habit => {
                const habitCard = this.createHabitCard(habit);
                groupContent.appendChild(habitCard);
            });

            groupContainer.appendChild(groupContent);
        }

        this.habitsContainer.appendChild(groupContainer);
    }

    private sortHabitsInGroup(habits: Habit[]): Habit[] {
        const priorityVal = (p?: string) => {
            switch (p) {
                case 'high': return 3;
                case 'medium': return 2;
                case 'low': return 1;
                default: return 0;
            }
        };

        const compare = (a: Habit, b: Habit) => {
            if (this.sortKey === 'priority') {
                const pa = priorityVal(a.priority);
                const pb = priorityVal(b.priority);
                if (pa !== pb) return pa - pb;
                // fallback by title
                return (a.title || '').localeCompare(b.title || '', 'zh-CN', { sensitivity: 'base' });
            }
            // title
            const res = (a.title || '').localeCompare(b.title || '', 'zh-CN', { sensitivity: 'base' });
            if (res !== 0) return res;
            // fallback by priority
            return priorityVal(a.priority) - priorityVal(b.priority);
        };

        const copy = [...habits];
        copy.sort((a, b) => {
            const r = compare(a, b);
            return this.sortOrder === 'asc' ? r : -r;
        });
        return copy;
    }

    private createHabitCard(habit: Habit): HTMLElement {
        const card = document.createElement('div');
        card.className = 'habit-card';
        card.style.cssText = `
            background: var(--b3-theme-background);
            border: 1px solid var(--b3-theme-surface-lighter);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.2s;
        `;

        card.addEventListener('mouseenter', () => {
            card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
            card.style.borderColor = 'var(--b3-theme-primary)';
        });

        card.addEventListener('mouseleave', () => {
            card.style.boxShadow = 'none';
            card.style.borderColor = 'var(--b3-theme-surface-lighter)';
        });

        // 标题和优先级
        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';

        const priorityIcon = this.getPriorityIcon(habit.priority);
        if (priorityIcon) {
            const priority = document.createElement('span');
            priority.textContent = priorityIcon;
            priority.style.fontSize = '16px';
            titleRow.appendChild(priority);
        }

        const title = document.createElement('div');
        title.textContent = habit.title;
        title.style.cssText = 'flex: 1; font-weight: bold; font-size: 14px;';
        titleRow.appendChild(title);

        // 如果绑定了块，显示链接图标并支持悬浮预览与点击打开
        if (habit.blockId) {
            const blockIcon = document.createElement('span');
            blockIcon.className = 'habit-block-icon';
            blockIcon.textContent = '🔗';
            blockIcon.title = '打开绑定块/文档';
            blockIcon.style.cssText = 'cursor:pointer; margin-left: 6px; font-size: 14px;';

            // 点击打开块
            blockIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    openBlock(habit.blockId!);
                } catch (err) {
                    console.error('打开块失败:', err);
                    showMessage('打开块失败', 3000, 'error');
                }
            });

            // 悬浮预览 (延迟加载)
            let tooltipEl: HTMLElement | null = null;
            const showTooltip = async (ev: MouseEvent) => {
                try {
                    if (tooltipEl) return;
                    tooltipEl = document.createElement('div');
                    tooltipEl.className = 'habit-block-tooltip';
                    tooltipEl.style.cssText = `
                        position: fixed;
                        z-index: 9999;
                        max-width: 360px;
                        background: var(--b3-theme-surface);
                        color: var(--b3-theme-on-surface);
                        border: 1px solid var(--b3-theme-surface-lighter);
                        border-radius: 6px;
                        padding: 8px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.12);
                        font-size: 12px;
                    `;
                    document.body.appendChild(tooltipEl);

                    // 计算位置
                    const x = ev.clientX + 12;
                    const y = ev.clientY + 12;
                    tooltipEl.style.left = x + 'px';
                    tooltipEl.style.top = y + 'px';

                    // 加载块内容并显示
                    const preview = await this.getBlockPreview(habit.blockId!);
                    tooltipEl.innerHTML = `<div style="font-weight:bold; margin-bottom:6px">绑定块</div><div>${preview}</div>`;
                } catch (e) {
                    console.warn('加载块预览失败', e);
                }
            };

            const hideTooltip = () => {
                if (tooltipEl && tooltipEl.parentElement) {
                    tooltipEl.parentElement.removeChild(tooltipEl);
                }
                tooltipEl = null;
            };

            blockIcon.addEventListener('mouseenter', (ev) => showTooltip(ev as MouseEvent));
            blockIcon.addEventListener('mouseleave', hideTooltip);

            titleRow.appendChild(blockIcon);
        }

        card.appendChild(titleRow);

        // 打卡信息
        const today = getLocalDateString();
        const checkIn = habit.checkIns?.[today];
        const currentCount = checkIn?.count || 0;
        const targetCount = habit.target;

        const progressRow = document.createElement('div');
        progressRow.style.cssText = 'margin-bottom: 8px;';

        if (targetCount > 1) {
            // 显示进度条
            const progressText = document.createElement('div');
            progressText.textContent = `今日进度: ${currentCount}/${targetCount}`;
            progressText.style.cssText = 'font-size: 12px; margin-bottom: 4px; color: var(--b3-theme-on-surface-light);';
            progressRow.appendChild(progressText);

            const progressBar = document.createElement('div');
            progressBar.style.cssText = `
                width: 100%;
                height: 6px;
                background: var(--b3-theme-surface);
                border-radius: 3px;
                overflow: hidden;
            `;

            const progressFill = document.createElement('div');
            const percentage = Math.min(100, (currentCount / targetCount) * 100);
            progressFill.style.cssText = `
                width: ${percentage}%;
                height: 100%;
                background: var(--b3-theme-primary);
                transition: width 0.3s;
            `;
            progressBar.appendChild(progressFill);
            progressRow.appendChild(progressBar);
        } else {
            const progressText = document.createElement('div');
            progressText.textContent = `今日: ${currentCount >= targetCount ? '已完成' : '未完成'}`;
            progressText.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light);';
            progressRow.appendChild(progressText);
        }

        card.appendChild(progressRow);

        // 频率信息
        const frequencyText = this.getFrequencyText(habit.frequency);
        const frequency = document.createElement('div');
        frequency.textContent = `频率: ${frequencyText}`;
        frequency.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;';
        card.appendChild(frequency);

        // 时间范围
        const timeRange = document.createElement('div');
        timeRange.textContent = `时间: ${habit.startDate}${habit.endDate ? ' ~ ' + habit.endDate : ' 起'}`;
        timeRange.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;';
        card.appendChild(timeRange);

        // 提醒时间
        if (habit.reminderTime) {
            const reminder = document.createElement('div');
            reminder.textContent = `提醒: ${habit.reminderTime}`;
            reminder.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;';
            card.appendChild(reminder);
        }

        // 坚持打卡天数（显示打卡天数，替换累计打卡次数）
        const checkInDaysCount = Object.keys(habit.checkIns || {}).length;
        const checkInDaysEl = document.createElement('div');
        checkInDaysEl.textContent = `坚持打卡: ${checkInDaysCount} 天`;
        checkInDaysEl.style.cssText = 'font-size: 12px; color: var(--b3-theme-primary); font-weight: bold;';
        card.appendChild(checkInDaysEl);

        // 今日打卡 emoji（只显示当天的）
        if (checkIn && ((checkIn.entries && checkIn.entries.length > 0) || (checkIn.status && checkIn.status.length > 0))) {
            const emojiRow = document.createElement('div');
            emojiRow.style.cssText = 'margin-top:8px; display:flex; gap:6px; align-items:center;';

            const emojiLabel = document.createElement('span');
            emojiLabel.textContent = '今日打卡:';
            emojiLabel.style.cssText = 'font-size:12px; color: var(--b3-theme-on-surface-light); margin-right:6px;';
            emojiRow.appendChild(emojiLabel);

            // Only show today's entries, and display emoji icons (preserve order). Support both "entries" (new) and "status" (legacy).
            const emojis: string[] = [];
            if (checkIn.entries && checkIn.entries.length > 0) {
                checkIn.entries.forEach(entry => emojis.push(entry.emoji));
            } else if (checkIn.status && checkIn.status.length > 0) {
                // status may contain repeated emojis; keep the order
                checkIn.status.forEach(s => emojis.push(s));
            }

            emojis.forEach((emojiStr) => {
                const emojiEl = document.createElement('span');
                emojiEl.textContent = emojiStr;
                emojiEl.title = emojiStr;
                emojiEl.style.cssText = 'font-size: 18px; line-height: 1;';
                emojiRow.appendChild(emojiEl);
            });

            card.appendChild(emojiRow);
        }

        // 右键菜单
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showHabitContextMenu(e, habit);
        });

        return card;
    }

    private getPriorityIcon(priority?: string): string {
        switch (priority) {
            case 'high': return '🔴';
            case 'medium': return '🟡';
            case 'low': return '🟢';
            default: return '';
        }
    }

    private getFrequencyText(frequency: Habit['frequency']): string {
        const { type, interval, weekdays, monthDays } = frequency;

        switch (type) {
            case 'daily':
                return interval ? `每${interval}天` : '每天';
            case 'weekly':
                if (weekdays && weekdays.length > 0) {
                    const days = weekdays.map(d => ['日', '一', '二', '三', '四', '五', '六'][d]).join(',');
                    return `每周${days}`;
                }
                return interval ? `每${interval}周` : '每周';
            case 'monthly':
                if (monthDays && monthDays.length > 0) {
                    return `每月${monthDays.join(',')}日`;
                }
                return interval ? `每${interval}月` : '每月';
            case 'yearly':
                return interval ? `每${interval}年` : '每年';
            case 'custom':
                return '自定义';
            default:
                return '每天';
        }
    }

    private async getBlockPreview(blockId: string): Promise<string> {
        try {
            const block = await getBlockByID(blockId);
            if (!block) return '块不存在';
            if (block.type === 'd') {
                return block.content || '';
            }
            try {
                const domString = await getBlockDOM(blockId);
                const parser = new DOMParser();
                const dom = parser.parseFromString(domString.dom, 'text/html');
                const element = dom.querySelector('div[data-type="NodeParagraph"]');
                if (element) {
                    const attrElement = element.querySelector('div.protyle-attr');
                    if (attrElement) attrElement.remove();
                }
                const snippet = element ? (element.textContent || '') : (block.fcontent || block.content || '');
                return (snippet || '').trim().slice(0, 300);
            } catch (err) {
                return (block.fcontent || block.content || '').slice(0, 300);
            }
        } catch (error) {
            console.error('获取块预览失败', error);
            return '获取块信息失败';
        }
    }

    private async renderCompletedHabitsSection(excludeIds?: Set<string>) {
        const today = getLocalDateString();
        const habitData = await readHabitData();
        const habits: Habit[] = Object.values(habitData || {});

        let completedHabits = habits.filter(h => this.isCompletedOnDate(h, today));

        // 排除已经在主区渲染的习惯，防止重复
        if (excludeIds && excludeIds.size > 0) {
            completedHabits = completedHabits.filter(h => !excludeIds.has(h.id));
        }

        // 如果没有已打卡习惯，移除已有的已打卡区并返回
        if (completedHabits.length === 0) {
            const existing = this.habitsContainer.querySelector('.habit-completed-section');
            if (existing) existing.remove();
            return;
        }

        // 移除已有的已打卡区（防止重复追加）
        const existingSection = this.habitsContainer.querySelector('.habit-completed-section');
        if (existingSection) {
            existingSection.remove();
        }

        const separator = document.createElement('div');
        separator.className = 'habit-completed-section';
        separator.style.cssText = `
            margin: 16px 0;
            border-top: 2px dashed var(--b3-theme-surface-lighter);
            padding-top: 16px;
        `;

        const completedTitle = document.createElement('div');
        completedTitle.textContent = `今日已打卡 (${completedHabits.length})`;
        completedTitle.style.cssText = `
            font-weight: bold;
            margin-bottom: 12px;
            color: var(--b3-theme-on-surface);
        `;

        separator.appendChild(completedTitle);

        const sortedCompleted = this.sortHabitsInGroup(completedHabits);
        sortedCompleted.forEach(habit => {
            const habitCard = this.createHabitCard(habit);
            habitCard.style.opacity = '0.7';
            separator.appendChild(habitCard);
        });

        this.habitsContainer.appendChild(separator);
    }

    private showHabitContextMenu(event: MouseEvent, habit: Habit) {
        const menu = new Menu("habitContextMenu");

        // 打卡选项
        menu.addItem({
            label: "打卡",
            icon: "iconCheck",
            submenu: this.createCheckInSubmenu(habit)
        });

        menu.addSeparator();

        // 查看统计
        menu.addItem({
            label: "查看统计",
            icon: "iconChart",
            click: () => {
                this.showHabitStats(habit);
            }
        });

        // 历史打卡管理
        menu.addItem({
            label: "管理历史打卡",
            icon: "iconClock",
            click: () => {
                this.showHabitHistory(habit);
            }
        });

        // 编辑习惯
        menu.addItem({
            label: "编辑习惯",
            icon: "iconEdit",
            click: () => {
                this.showEditHabitDialog(habit);
            }
        });

        // 打开绑定块（如果存在）
        if (habit.blockId) {
            menu.addItem({
                label: "打开绑定块",
                icon: "iconOpen",
                click: () => {
                    try {
                        openBlock(habit.blockId!);
                    } catch (err) {
                        console.error('打开块失败', err);
                        showMessage('打开块失败', 3000, 'error');
                    }
                }
            });
        }

        // 删除习惯
        menu.addItem({
            label: "删除习惯",
            icon: "iconTrashcan",
            click: () => {
                confirm(
                    "确认删除",
                    `确定要删除习惯"${habit.title}"吗？`,
                    () => {
                        this.deleteHabit(habit.id);
                    }
                );
            }
        });

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private createCheckInSubmenu(habit: Habit): any[] {
        const submenu: any[] = [];

        // 添加默认的打卡emoji选项
        habit.checkInEmojis.forEach(emojiConfig => {
            submenu.push({
                label: `${emojiConfig.emoji} ${emojiConfig.meaning}`,
                click: () => {
                    this.checkInHabit(habit, emojiConfig);
                }
            });
        });

        // 添加编辑emoji选项
        submenu.push({
            type: 'separator'
        });

        submenu.push({
            label: "编辑打卡选项",
            icon: "iconEdit",
            click: () => {
                this.showEditCheckInEmojis(habit);
            }
        });

        return submenu;
    }

    private async checkInHabit(habit: Habit, emojiConfig: HabitCheckInEmoji) {
        try {
            const today = getLocalDateString();
            const now = getLocalDateTimeString(new Date());

            if (!habit.checkIns) {
                habit.checkIns = {};
            }

            if (!habit.checkIns[today]) {
                habit.checkIns[today] = {
                    count: 0,
                    status: [],
                    timestamp: now,
                    entries: []
                };
            }

            const checkIn = habit.checkIns[today];
            // 询问备注（如果配置了 promptNote）
            let note: string | undefined = undefined;
            if (emojiConfig.promptNote) {
                // 弹窗输入备注 —— 使用标准 dialog footer（.b3-dialog__action）放置按钮以保证样式与位置正确
                let resolveFn: (() => void) | null = null;
                const promise = new Promise<void>((resolve) => { resolveFn = resolve; });
                const inputDialog = new Dialog({
                    title: '输入打卡备注',
                    content: `<div class="b3-dialog__content"><div class="ft__breakword" style="padding:12px"><textarea id=\"__habits_note_input\" style=\"width:100%;height:120px;box-sizing:border-box;resize:vertical;\"></textarea></div></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">取消</button><div class="fn__space"></div><button class="b3-button b3-button--text" id="__habits_note_confirm">保存</button></div>`,
                    width: '520px',
                    height: '260px',
                    destroyCallback: () => {
                        if (resolveFn) resolveFn();
                    }
                });

                const inputEl = inputDialog.element.querySelector('#__habits_note_input') as HTMLTextAreaElement;
                const cancelBtn = inputDialog.element.querySelector('.b3-button.b3-button--cancel') as HTMLButtonElement;
                const okBtn = inputDialog.element.querySelector('#__habits_note_confirm') as HTMLButtonElement;

                // 点击保存时取值, 点击取消则无备注
                okBtn.addEventListener('click', () => {
                    note = inputEl.value.trim();
                    inputDialog.destroy();
                });
                cancelBtn.addEventListener('click', () => {
                    note = undefined;
                    inputDialog.destroy();
                });

                // 等待用户点击保存或取消或直接关闭对话框
                await promise;
            }

            // Append an entry for this check-in
            checkIn.entries = checkIn.entries || [];
            checkIn.entries.push({ emoji: emojiConfig.emoji, timestamp: now, note });
            // Keep status/count/timestamp fields in sync for backward compatibility
            checkIn.count = (checkIn.count || 0) + 1;
            checkIn.status = (checkIn.status || []).concat([emojiConfig.emoji]);
            checkIn.timestamp = now;

            habit.totalCheckIns = (habit.totalCheckIns || 0) + 1;
            habit.updatedAt = now;

            await this.saveHabit(habit);
            showMessage(`打卡成功！${emojiConfig.emoji}` + (note ? ` - ${note}` : ''));
            this.loadHabits();
        } catch (error) {
            console.error('打卡失败:', error);
            showMessage('打卡失败', 3000, 'error');
        }
    }

    private async saveHabit(habit: Habit) {
        const habitData = await readHabitData();
        habitData[habit.id] = habit;
        await writeHabitData(habitData);
        window.dispatchEvent(new CustomEvent('habitUpdated'));
    }

    private async deleteHabit(habitId: string) {
        try {
            const habitData = await readHabitData();
            delete habitData[habitId];
            await writeHabitData(habitData);
            showMessage('删除成功');
            this.loadHabits();
            window.dispatchEvent(new CustomEvent('habitUpdated'));
        } catch (error) {
            console.error('删除习惯失败:', error);
            showMessage('删除失败', 3000, 'error');
        }
    }

    private showNewHabitDialog() {
        const dialog = new HabitEditDialog(null, async (habit) => {
            await this.saveHabit(habit);
            this.loadHabits();
        });
        dialog.show();
    }

    private showEditHabitDialog(habit: Habit) {
        const dialog = new HabitEditDialog(habit, async (updatedHabit) => {
            await this.saveHabit(updatedHabit);
            this.loadHabits();
        });
        dialog.show();
    }

    private showCalendarView() {
        const dialog = new HabitCalendarDialog();
        dialog.show();
    }

    private showHabitStats(habit: Habit) {
        const dialog = new HabitStatsDialog(habit);
        dialog.show();
    }

    private showHabitHistory(habit: Habit) {
        const dialog = new HabitHistoryDialog(habit, async (updatedHabit) => {
            await this.saveHabit(updatedHabit);
            this.loadHabits();
        });
        dialog.show();
    }

    private showGroupManageDialog() {
        const dialog = new HabitGroupManageDialog(() => {
            this.updateGroupFilterButtonText();
            this.loadHabits();
        });
        dialog.show();
    }

    private showGroupSelectDialog() {
        const dialog = new Dialog({
            title: "选择分组",
            content: '<div id="groupSelectContainer"></div>',
            width: "400px",
            height: "500px"
        });

        const container = dialog.element.querySelector('#groupSelectContainer') as HTMLElement;
        if (!container) return;

        container.style.cssText = 'padding: 16px;';

        // 全部分组选项
        const allOption = this.createGroupCheckbox('all', '全部分组', this.selectedGroups.includes('all'));
        container.appendChild(allOption);

        // 无分组选项
        const noneOption = this.createGroupCheckbox('none', '无分组', this.selectedGroups.includes('none'));
        container.appendChild(noneOption);

        // 其他分组
        const groups = this.groupManager.getAllGroups();
        groups.forEach(group => {
            const option = this.createGroupCheckbox(group.id, group.name, this.selectedGroups.includes(group.id));
            container.appendChild(option);
        });

        // 确认按钮
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'b3-button b3-button--primary';
        confirmBtn.textContent = '确定';
        confirmBtn.style.cssText = 'margin-top: 16px; width: 100%;';
        confirmBtn.addEventListener('click', () => {
            this.updateGroupFilterButtonText();
            this.loadHabits();
            dialog.destroy();
        });
        container.appendChild(confirmBtn);
    }

    private createGroupCheckbox(id: string, name: string, checked: boolean): HTMLElement {
        const label = document.createElement('label');
        label.style.cssText = 'display: flex; align-items: center; padding: 8px; cursor: pointer;';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.style.cssText = 'margin-right: 8px;';

        checkbox.addEventListener('change', () => {
            if (id === 'all') {
                if (checkbox.checked) {
                    this.selectedGroups = ['all'];
                } else {
                    this.selectedGroups = [];
                }
            } else {
                if (checkbox.checked) {
                    this.selectedGroups = this.selectedGroups.filter(g => g !== 'all');
                    if (!this.selectedGroups.includes(id)) {
                        this.selectedGroups.push(id);
                    }
                } else {
                    this.selectedGroups = this.selectedGroups.filter(g => g !== id);
                }
            }
        });

        const text = document.createElement('span');
        text.textContent = name;

        label.appendChild(checkbox);
        label.appendChild(text);

        return label;
    }

    private showEditCheckInEmojis(habit: Habit) {
        const dialog = new HabitCheckInEmojiDialog(habit, async (emojis) => {
            // 更新习惯的打卡emoji配置
            habit.checkInEmojis = emojis;
            habit.updatedAt = getLocalDateTimeString(new Date());

            // 保存到数据库
            await this.saveHabit(habit);

            // 刷新显示
            this.loadHabits();
        });
        dialog.show();
    }
}
