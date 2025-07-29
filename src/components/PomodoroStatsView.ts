import { Dialog } from "siyuan";
import { PomodoroRecordManager, PomodoroSession } from "../utils/pomodoroRecord";
import { t } from "../utils/i18n";
import { getLocalDateString } from "../utils/dateUtils";

export class PomodoroStatsView {
    private dialog: Dialog;
    private recordManager: PomodoroRecordManager;
    private currentView: 'overview' | 'details' | 'records' | 'trends' | 'timeline' | 'heatmap' = 'overview';
    private currentTimeRange: 'today' | 'week' | 'month' | 'year' = 'today';
    private currentYear: number = new Date().getFullYear();

    constructor() {
        this.recordManager = PomodoroRecordManager.getInstance();
        this.createDialog();
    }

    private createDialog() {
        this.dialog = new Dialog({
            title: "🍅 " + t("pomodoroStats"),
            content: this.createContent(),
            width: "90vw",
            height: "85vh",
            destroyCallback: () => {
                // 清理资源
            }
        });
    }

    private createContent(): string {
        return `
            <div class="pomodoro-stats-view">
                <!-- 导航标签 -->
                <div class="stats-nav">
                    <button class="nav-btn ${this.currentView === 'overview' ? 'active' : ''}" data-view="overview">
                        📊 ${t("overview")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'details' ? 'active' : ''}" data-view="details">
                        📈 ${t("focusDetails")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'records' ? 'active' : ''}" data-view="records">
                        📝 ${t("focusRecords")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'trends' ? 'active' : ''}" data-view="trends">
                        📉 ${t("focusTrends")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'timeline' ? 'active' : ''}" data-view="timeline">
                        ⏰ ${t("focusTimeline")}
                    </button>
                    <button class="nav-btn ${this.currentView === 'heatmap' ? 'active' : ''}" data-view="heatmap">
                        🔥 ${t("yearlyHeatmap")}
                    </button>
                </div>

                <!-- 内容区域 -->
                <div class="stats-content">
                    ${this.renderCurrentView()}
                </div>
            </div>
        `;
    }

    private renderCurrentView(): string {
        switch (this.currentView) {
            case 'overview':
                return this.renderOverview();
            case 'details':
                return this.renderDetails();
            case 'records':
                return this.renderRecords();
            case 'trends':
                return this.renderTrends();
            case 'timeline':
                return this.renderTimeline();
            case 'heatmap':
                return this.renderHeatmap();
            default:
                return this.renderOverview();
        }
    }

    private renderOverview(): string {
        const todayTime = this.recordManager.getTodayFocusTime();
        const weekTime = this.recordManager.getWeekFocusTime();
        const totalTime = this.calculateTotalFocusTime();

        return `
            <div class="overview-container">
                <div class="overview-cards">
                    <div class="overview-card today">
                        <div class="card-icon">🌅</div>
                        <div class="card-content">
                            <div class="card-title">${t("todayFocus")}</div>
                            <div class="card-value">${this.recordManager.formatTime(todayTime)}</div>
                            <div class="card-subtitle">${this.getTodayPomodoroCount()}个番茄钟</div>
                        </div>
                    </div>
                    
                    <div class="overview-card week">
                        <div class="card-icon">📅</div>
                        <div class="card-content">
                            <div class="card-title">${t("weekFocus")}</div>
                            <div class="card-value">${this.recordManager.formatTime(weekTime)}</div>
                            <div class="card-subtitle">${this.getWeekPomodoroCount()}个番茄钟</div>
                        </div>
                    </div>
                    
                    <div class="overview-card total">
                        <div class="card-icon">🏆</div>
                        <div class="card-content">
                            <div class="card-title">${t("totalFocus")}</div>
                            <div class="card-value">${this.recordManager.formatTime(totalTime)}</div>
                            <div class="card-subtitle">${this.getTotalPomodoroCount()}个番茄钟</div>
                        </div>
                    </div>
                </div>

                <!-- 今日专注进度 -->
                <div class="today-progress">
                    <h3>📈 ${t("todayProgress")}</h3>
                    ${this.renderTodayProgress()}
                </div>

                <!-- 最近7天趋势 -->
                <div class="recent-trend">
                    <h3>📊 ${t("recentTrend")}</h3>
                    ${this.renderRecentTrend()}
                </div>
            </div>
        `;
    }

    private renderDetails(): string {
        return `
            <div class="details-container">
                <div class="details-header">
                    <h3>📈 ${t("focusDetails")}</h3>
                    <div class="time-range-selector">
                        <button class="range-btn ${this.currentTimeRange === 'today' ? 'active' : ''}" data-range="today">
                            ${t("today")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'week' ? 'active' : ''}" data-range="week">
                            ${t("week")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'month' ? 'active' : ''}" data-range="month">
                            ${t("month")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'year' ? 'active' : ''}" data-range="year">
                            ${t("year")}
                        </button>
                    </div>
                </div>
                
                <div class="details-content">
                    ${this.renderTaskCategoryChart()}
                </div>
            </div>
        `;
    }

    private renderRecords(): string {
        const recentSessions = this.getRecentSessions(7);
        
        return `
            <div class="records-container">
                <div class="records-header">
                    <h3>📝 ${t("focusRecords")}</h3>
                    <div class="records-subtitle">${t("recent7DaysFocus")}</div>
                </div>
                
                <div class="records-list">
                    ${recentSessions.map(session => this.renderSessionRecord(session)).join('')}
                </div>
            </div>
        `;
    }

    private renderTrends(): string {
        return `
            <div class="trends-container">
                <div class="trends-header">
                    <h3>📉 ${t("focusTrends")}</h3>
                    <div class="time-range-selector">
                        <button class="range-btn ${this.currentTimeRange === 'week' ? 'active' : ''}" data-range="week">
                            ${t("thisWeek")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'month' ? 'active' : ''}" data-range="month">
                            ${t("thisMonth")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'year' ? 'active' : ''}" data-range="year">
                            ${t("thisYear")}
                        </button>
                        <div class="nav-arrows">
                            <button class="nav-arrow" data-action="prev">◀</button>
                            <button class="nav-arrow" data-action="next">▶</button>
                        </div>
                    </div>
                </div>
                
                <div class="trends-chart">
                    ${this.renderTrendsChart()}
                </div>
            </div>
        `;
    }

    private renderTimeline(): string {
        return `
            <div class="timeline-container">
                <div class="timeline-header">
                    <h3>⏰ ${t("focusTimeline")}</h3>
                    <div class="time-range-selector">
                        <button class="range-btn ${this.currentTimeRange === 'week' ? 'active' : ''}" data-range="week">
                            ${t("thisWeek")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'month' ? 'active' : ''}" data-range="month">
                            ${t("thisMonth")}
                        </button>
                        <button class="range-btn ${this.currentTimeRange === 'year' ? 'active' : ''}" data-range="year">
                            ${t("thisYear")}
                        </button>
                        <div class="nav-arrows">
                            <button class="nav-arrow" data-action="prev">◀</button>
                            <button class="nav-arrow" data-action="next">▶</button>
                        </div>
                    </div>
                </div>
                
                <div class="timeline-chart">
                    ${this.renderTimelineChart()}
                </div>
            </div>
        `;
    }

    private renderHeatmap(): string {
        return `
            <div class="heatmap-container">
                <div class="heatmap-header">
                    <h3>🔥 ${t("yearlyHeatmap")}</h3>
                    <div class="year-selector">
                        <button class="nav-arrow" data-action="prev-year">◀</button>
                        <span class="current-year">${this.currentYear}</span>
                        <button class="nav-arrow" data-action="next-year">▶</button>
                    </div>
                </div>
                
                <div class="heatmap-chart">
                    ${this.renderHeatmapChart()}
                </div>
                
                <div class="heatmap-legend">
                    <span>${t("less")}</span>
                    <div class="legend-colors">
                        <div class="legend-color level-0"></div>
                        <div class="legend-color level-1"></div>
                        <div class="legend-color level-2"></div>
                        <div class="legend-color level-3"></div>
                        <div class="legend-color level-4"></div>
                    </div>
                    <span>${t("more")}</span>
                </div>
            </div>
        `;
    }

    private renderTodayProgress(): string {
        const todayTime = this.recordManager.getTodayFocusTime();
        const todaySessions = this.recordManager.getTodaySessions();
        const workSessions = todaySessions.filter(s => s.type === 'work' && s.completed);
        
        return `
            <div class="progress-info">
                <div class="progress-item">
                    <span class="progress-label">${t("completedPomodoros")}</span>
                    <span class="progress-value">${workSessions.length}</span>
                </div>
                <div class="progress-item">
                    <span class="progress-label">${t("focusTime")}</span>
                    <span class="progress-value">${this.recordManager.formatTime(todayTime)}</span>
                </div>
                <div class="progress-item">
                    <span class="progress-label">${t("averageSession")}</span>
                    <span class="progress-value">${workSessions.length > 0 ? Math.round(todayTime / workSessions.length) : 0}${t("minutes")}</span>
                </div>
            </div>
        `;
    }

    private renderRecentTrend(): string {
        const last7Days = this.getLast7DaysData();
        const maxTime = Math.max(...last7Days.map(d => d.value));
        const minHeight = 15; // 最小高度15%，确保可见性
        const maxHeight = 85; // 最大高度85%，留出空间显示标签
        
        return `
            <div class="trend-chart">
                ${last7Days.map(day => {
                    let height;
                    if (maxTime === 0) {
                        // 所有数据都为0时，显示最小高度
                        height = minHeight;
                    } else if (day.value === 0) {
                        // 当前数据为0时，显示更小的高度以区分
                        height = 5;
                    } else {
                        // 按比例计算高度，确保在最小和最大高度之间
                        const ratio = day.value / maxTime;
                        height = minHeight + (maxHeight - minHeight) * ratio;
                    }
                    
                    return `
                        <div class="trend-day">
                            <div class="trend-bar" style="height: ${height}%"></div>
                            <div class="trend-label">${day.label}</div>
                            <div class="trend-value">${this.recordManager.formatTime(day.value)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    private renderTaskCategoryChart(): string {
        const stats = this.getTaskCategoryStats();
        const total = Object.values(stats).reduce((sum: number, value: any) => sum + value.time, 0);
        
        if (total === 0) {
            return `<div class="no-data">${t("noData")}</div>`;
        }

        return `
            <div class="category-chart">
                <div class="pie-chart">
                    ${Object.entries(stats).map(([category, data]: [string, any]) => {
                        const percentage = (data.time / total) * 100;
                        return `
                            <div class="pie-segment" style="--percentage: ${percentage}%">
                                <span class="segment-label">${category}</span>
                                <span class="segment-value">${percentage.toFixed(1)}%</span>
                            </div>
                        `;
                    }).join('')}
                </div>
                
                <div class="category-legend">
                    ${Object.entries(stats).map(([category, data]: [string, any]) => `
                        <div class="legend-item">
                            <div class="legend-color"></div>
                            <span class="legend-text">${category}</span>
                            <span class="legend-time">${this.recordManager.formatTime(data.time)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    private renderSessionRecord(session: PomodoroSession): string {
        const date = new Date(session.startTime);
        const dateStr = date.toLocaleDateString('zh-CN');
        const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        
        return `
            <div class="record-item ${session.type}">
                <div class="record-icon">
                    ${session.type === 'work' ? '🍅' : (session.type === 'longBreak' ? '🧘' : '☕')}
                </div>
                <div class="record-content">
                    <div class="record-title">${session.eventTitle}</div>
                    <div class="record-meta">
                        <span class="record-date">${dateStr}</span>
                        <span class="record-time">${timeStr}</span>
                        <span class="record-duration">${session.duration}${t("minutes")}</span>
                        ${session.completed ? '<span class="record-completed">✅</span>' : '<span class="record-incomplete">⏸</span>'}
                    </div>
                </div>
            </div>
        `;
    }

    private renderTrendsChart(): string {
        const data = this.getTrendsData();
        const maxValue = Math.max(...data.map(d => d.value));
        const minHeight = 15; // 最小高度15%，确保可见性
        const maxHeight = 85; // 最大高度85%，留出空间显示标签
        
        return `
            <div class="trends-chart-container">
                <div class="chart-bars">
                    ${data.map(item => {
                        let height;
                        if (maxValue === 0) {
                            // 所有数据都为0时，显示最小高度
                            height = minHeight;
                        } else if (item.value === 0) {
                            // 当前数据为0时，显示更小的高度以区分
                            height = 5;
                        } else {
                            // 按比例计算高度，确保在最小和最大高度之间
                            const ratio = item.value / maxValue;
                            height = minHeight + (maxHeight - minHeight) * ratio;
                        }
                        
                        return `
                            <div class="chart-bar-container">
                                <div class="chart-bar" style="height: ${height}%"></div>
                                <div class="chart-label">${item.label}</div>
                                <div class="chart-value">${this.recordManager.formatTime(item.value)}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    private renderTimelineChart(): string {
        const timelineData = this.getTimelineData();
        
        return `
            <div class="timeline-chart-container">
                ${timelineData.map(day => `
                    <div class="timeline-day">
                        <div class="timeline-date">${day.date}</div>
                        <div class="timeline-sessions">
                            ${day.sessions.map(session => `
                                <div class="timeline-session ${session.type}" 
                                     style="left: ${session.startPercent}%; width: ${session.widthPercent}%"
                                     title="${session.title} (${session.duration}${t("minutes")})">
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    private renderHeatmapChart(): string {
        const heatmapData = this.getHeatmapData(this.currentYear);
        const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
        
        return `
            <div class="heatmap-grid">
                <div class="heatmap-months">
                    ${months.map(month => `<div class="month-label">${month}</div>`).join('')}
                </div>
                <div class="heatmap-days">
                    ${heatmapData.map(day => `
                        <div class="heatmap-day level-${day.level}" 
                             title="${day.date}: ${this.recordManager.formatTime(day.time)}"
                             data-date="${day.date}">
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // 数据获取方法
    private calculateTotalFocusTime(): number {
        // 获取所有记录的总专注时间
        let totalTime = 0;
        const allRecords = (this.recordManager as any).records || {};
        
        Object.values(allRecords).forEach((record: any) => {
            if (record && record.totalWorkTime) {
                totalTime += record.totalWorkTime;
            }
        });
        
        return totalTime;
    }

    private getTodayPomodoroCount(): number {
        const todaySessions = this.recordManager.getTodaySessions();
        return todaySessions.filter(s => s.type === 'work' && s.completed).length;
    }

    private getWeekPomodoroCount(): number {
        const weekSessions = this.recordManager.getWeekSessions();
        return weekSessions.filter(s => s.type === 'work' && s.completed).length;
    }

    private getTotalPomodoroCount(): number {
        // 获取所有记录的总番茄钟数量
        let totalCount = 0;
        const allRecords = (this.recordManager as any).records || {};
        
        Object.values(allRecords).forEach((record: any) => {
            if (record && record.workSessions) {
                totalCount += record.workSessions;
            }
        });
        
        return totalCount;
    }

    private getLast7DaysData(): Array<{label: string, value: number}> {
        const data = [];
        const today = new Date();
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateStr = getLocalDateString(date);
            const sessions = this.recordManager.getDateSessions(dateStr);
            const value = sessions
                .filter(s => s.type === 'work')
                .reduce((sum, s) => sum + s.duration, 0);
            
            data.push({
                label: i === 0 ? t("today") : date.toLocaleDateString('zh-CN', { weekday: 'short' }),
                value
            });
        }
        
        return data;
    }

    private getTaskCategoryStats(): Record<string, {time: number, count: number}> {
        let sessions: PomodoroSession[] = [];
        
        // 根据当前时间范围获取会话数据
        switch (this.currentTimeRange) {
            case 'today':
                sessions = this.recordManager.getTodaySessions();
                break;
            case 'week':
                sessions = this.recordManager.getWeekSessions();
                break;
            case 'month':
                sessions = this.getRecentSessions(30);
                break;
            case 'year':
                sessions = this.getRecentSessions(365);
                break;
            default:
                sessions = this.recordManager.getTodaySessions();
        }
        
        const stats: Record<string, {time: number, count: number}> = {};
        
        sessions.filter(s => s.type === 'work').forEach(session => {
            const category = session.eventTitle || t("uncategorized");
            if (!stats[category]) {
                stats[category] = { time: 0, count: 0 };
            }
            stats[category].time += session.duration;
            if (session.completed) {
                stats[category].count++;
            }
        });
        
        return stats;
    }

    private getRecentSessions(days: number): PomodoroSession[] {
        const sessions = [];
        const today = new Date();
        
        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateStr = getLocalDateString(date);
            sessions.push(...this.recordManager.getDateSessions(dateStr));
        }
        
        return sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    }

    private getTrendsData(): Array<{label: string, value: number}> {
        // 根据当前时间范围返回趋势数据
        switch (this.currentTimeRange) {
            case 'week':
                return this.getLast7DaysData();
            case 'month':
                return this.getMonthlyTrendsData();
            case 'year':
                return this.getYearlyTrendsData();
            default:
                return this.getLast7DaysData();
        }
    }

    private getMonthlyTrendsData(): Array<{label: string, value: number}> {
        // 实现月度趋势数据获取
        const data = [];
        const today = new Date();
        const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(today.getFullYear(), today.getMonth(), day);
            const dateStr = getLocalDateString(date);
            const sessions = this.recordManager.getDateSessions(dateStr);
            const time = sessions
                .filter(s => s.type === 'work')
                .reduce((sum, s) => sum + s.duration, 0);
            
            data.push({
                label: day.toString(),
                value: time
            });
        }
        
        return data;
    }

    private getYearlyTrendsData(): Array<{label: string, value: number}> {
        // 实现年度趋势数据获取
        const data = [];
        const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
        
        months.forEach((month, index) => {
            // 这里需要实现获取每月数据的逻辑
            data.push({
                label: month,
                value: Math.random() * 1000 // 临时数据
            });
        });
        
        return data;
    }

    private getTimelineData(): Array<{date: string, sessions: Array<{type: string, title: string, duration: number, startPercent: number, widthPercent: number}>}> {
        // 实现时间线数据获取
        const data = [];
        const today = new Date();
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateStr = getLocalDateString(date);
            const sessions = this.recordManager.getDateSessions(dateStr);
            
            const timelineSessions = sessions.map(session => {
                const startTime = new Date(session.startTime);
                const startPercent = (startTime.getHours() * 60 + startTime.getMinutes()) / (24 * 60) * 100;
                const widthPercent = session.duration / (24 * 60) * 100;
                
                return {
                    type: session.type,
                    title: session.eventTitle,
                    duration: session.duration,
                    startPercent,
                    widthPercent
                };
            });
            
            data.push({
                date: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
                sessions: timelineSessions
            });
        }
        
        return data;
    }

    private getHeatmapData(year: number): Array<{date: string, time: number, level: number}> {
        const data = [];
        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31);
        
        for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
            const dateStr = getLocalDateString(date);
            const sessions = this.recordManager.getDateSessions(dateStr);
            const time = sessions
                .filter(s => s.type === 'work')
                .reduce((sum, s) => sum + s.duration, 0);
            
            // 根据时间计算热力图等级 (0-4)
            let level = 0;
            if (time > 0) level = 1;
            if (time > 60) level = 2;
            if (time > 120) level = 3;
            if (time > 240) level = 4;
            
            data.push({
                date: dateStr,
                time,
                level
            });
        }
        
        return data;
    }

    private getEventColor(index: number): string {
        const colors = ['#FF6B6B', '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#00BCD4', '#795548', '#607D8B'];
        return colors[index % colors.length];
    }

    public show() {
        this.dialog.element.addEventListener('click', this.handleClick.bind(this));
        this.updateContent();
    }

    private handleClick(event: Event) {
        const target = event.target as HTMLElement;
        
        if (target.classList.contains('nav-btn')) {
            const view = target.dataset.view as any;
            if (view && view !== this.currentView) {
                this.currentView = view;
                this.updateContent();
            }
        }
        
        if (target.classList.contains('range-btn')) {
            const range = target.dataset.range as any;
            if (range && range !== this.currentTimeRange) {
                this.currentTimeRange = range;
                this.updateContent();
            }
        }
        
        if (target.classList.contains('nav-arrow')) {
            const action = target.dataset.action;
            this.handleNavigation(action);
        }
    }

    private handleNavigation(action: string) {
        switch (action) {
            case 'prev-year':
                this.currentYear--;
                this.updateContent();
                break;
            case 'next-year':
                this.currentYear++;
                this.updateContent();
                break;
            case 'prev':
            case 'next':
                // 实现时间范围导航
                this.updateContent();
                break;
        }
    }

    private updateContent() {
        const contentElement = this.dialog.element.querySelector('.stats-content');
        if (contentElement) {
            contentElement.innerHTML = this.renderCurrentView();
        }
        
        // 更新导航按钮状态
        this.dialog.element.querySelectorAll('.nav-btn').forEach(btn => {
            const element = btn as HTMLElement;
            element.classList.toggle('active', element.dataset.view === this.currentView);
        });
        
        // 更新时间范围按钮状态
        this.dialog.element.querySelectorAll('.range-btn').forEach(btn => {
            const element = btn as HTMLElement;
            element.classList.toggle('active', element.dataset.range === this.currentTimeRange);
        });
    }
}