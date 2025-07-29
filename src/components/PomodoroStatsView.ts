import { Dialog } from "siyuan";
import { PomodoroRecordManager, PomodoroSession } from "../utils/pomodoroRecord";
import { t } from "../utils/i18n";
import { getLocalDateString } from "../utils/dateUtils";
import * as echarts from 'echarts';
import { formatDate } from "@fullcalendar/core";

export class PomodoroStatsView {
    private dialog: Dialog;
    private recordManager: PomodoroRecordManager;
    private currentView: 'overview' | 'details' | 'records' | 'trends' | 'timeline' | 'heatmap' = 'overview';
    private currentTimeRange: 'today' | 'week' | 'month' | 'year' = 'today';
    private currentYear: number = new Date().getFullYear();
    private currentWeekOffset: number = 0; // 周偏移量，0表示本周，-1表示上周，1表示下周
    private currentMonthOffset: number = 0; // 月偏移量，0表示本月，-1表示上月，1表示下月
    private currentYearOffset: number = 0; // 年偏移量，0表示今年，-1表示去年，1表示明年

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
        const dateRangeText = this.getCurrentDateRangeText();
        return `
            <div class="details-container">
                <div class="details-header">
                    <div class="details-title">
                        <h3>📈 ${t("focusDetails")}</h3>
                        ${dateRangeText ? `<span class="date-range-text">${dateRangeText}</span>` : ''}
                    </div>
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
                        <div class="nav-arrows">
                            <button class="nav-arrow" data-action="prev">◀</button>
                            <button class="nav-arrow" data-action="next">▶</button>
                        </div>
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
        const dateRangeText = this.getCurrentDateRangeText();
        return `
            <div class="trends-container">
                <div class="trends-header">
                    <div class="trends-title">
                        <h3>📉 ${t("focusTrends")}</h3>
                        ${dateRangeText ? `<span class="date-range-text">${dateRangeText}</span>` : ''}
                    </div>
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
        const dateRangeText = this.getCurrentDateRangeText();
        return `
            <div class="timeline-container">
                <div class="timeline-header">
                    <div class="timeline-title">
                        <h3>⏰ ${t("focusTimeline")}</h3>
                        ${dateRangeText ? `<span class="date-range-text">${dateRangeText}</span>` : ''}
                    </div>
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
            </div>
        `;
    }

    private renderRecentTrend(): string {
        const last7Days = this.getLast7DaysData();
        const maxTime = Math.max(...last7Days.map(d => d.value));
        const minHeight = 3; // 最小高度15%，确保可见性
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
                        height = minHeight;
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

        // 生成唯一的图表ID
        const chartId = `pie-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        return `
            <div class="category-chart">
                <div id="${chartId}" class="echarts-pie-chart" style="width: 100%; height: 400px;"></div>
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
        const minHeight = 3; // 最小高度15%，确保可见性
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
                            height = minHeight;
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
        // 生成唯一的图表ID
        const chartId = `timeline-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        return `
            <div class="timeline-echarts-container">
                <div id="${chartId}" class="echarts-timeline-chart" style="width: 100%; height: 600px;"></div>
            </div>
        `;
    }

    private renderHeatmapChart(): string {
        // 生成唯一的图表ID
        const chartId = `heatmap-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        return `
            <div class="heatmap-echarts-container">
                <div id="${chartId}" class="echarts-heatmap-chart" style="width: 100%; height: 500px;"></div>
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
        
        // 根据当前时间范围和偏移量获取会话数据
        switch (this.currentTimeRange) {
            case 'today':
                sessions = this.getTodaySessionsWithOffset();
                break;
            case 'week':
                sessions = this.getWeekSessionsWithOffset();
                break;
            case 'month':
                sessions = this.getMonthSessionsWithOffset();
                break;
            case 'year':
                sessions = this.getYearSessionsWithOffset();
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

    private getTodaySessionsWithOffset(): PomodoroSession[] {
        const today = new Date();
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + this.currentWeekOffset); // 复用weekOffset作为日偏移
        const dateStr = getLocalDateString(targetDate);
        return this.recordManager.getDateSessions(dateStr);
    }

    private getWeekSessionsWithOffset(): PomodoroSession[] {
        const sessions = [];
        const today = new Date();
        
        // 计算目标周的开始日期（星期一）
        const startOfWeek = new Date(today);
        const dayOfWeek = today.getDay();
        // 计算到星期一的偏移量：如果是星期日(0)，则偏移-6；否则偏移1-dayOfWeek
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startOfWeek.setDate(today.getDate() + mondayOffset + (this.currentWeekOffset * 7));
        
        for (let i = 0; i < 7; i++) {
            const date = new Date(startOfWeek);
            date.setDate(startOfWeek.getDate() + i);
            const dateStr = getLocalDateString(date);
            sessions.push(...this.recordManager.getDateSessions(dateStr));
        }
        
        return sessions;
    }

    private getMonthSessionsWithOffset(): PomodoroSession[] {
        const sessions = [];
        const today = new Date();
        
        // 计算目标月份
        const targetDate = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, 1);
        const daysInMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
        
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(targetDate.getFullYear(), targetDate.getMonth(), day);
            const dateStr = getLocalDateString(date);
            sessions.push(...this.recordManager.getDateSessions(dateStr));
        }
        
        return sessions;
    }

    private getYearSessionsWithOffset(): PomodoroSession[] {
        const sessions = [];
        const today = new Date();
        const targetYear = today.getFullYear() + this.currentYearOffset;
        
        // 获取整年的数据
        for (let month = 0; month < 12; month++) {
            const daysInMonth = new Date(targetYear, month + 1, 0).getDate();
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(targetYear, month, day);
                const dateStr = getLocalDateString(date);
                sessions.push(...this.recordManager.getDateSessions(dateStr));
            }
        }
        
        return sessions;
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
                return this.getWeeklyTrendsData();
            case 'month':
                return this.getMonthlyTrendsData();
            case 'year':
                return this.getYearlyTrendsData();
            default:
                return this.getWeeklyTrendsData();
        }
    }

    private getWeeklyTrendsData(): Array<{label: string, value: number}> {
        const data = [];
        const today = new Date();
        
        // 计算目标周的开始日期（星期一）
        const startOfWeek = new Date(today);
        const dayOfWeek = today.getDay();
        // 计算到星期一的偏移量：如果是星期日(0)，则偏移-6；否则偏移1-dayOfWeek
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startOfWeek.setDate(today.getDate() + mondayOffset + (this.currentWeekOffset * 7));
        
        for (let i = 0; i < 7; i++) {
            const date = new Date(startOfWeek);
            date.setDate(startOfWeek.getDate() + i);
            const dateStr = getLocalDateString(date);
            const sessions = this.recordManager.getDateSessions(dateStr);
            const value = sessions
                .filter(s => s.type === 'work')
                .reduce((sum, s) => sum + s.duration, 0);
            
            data.push({
                label: date.toLocaleDateString('zh-CN', { weekday: 'short' }),
                value
            });
        }
        
        return data;
    }

    private getMonthlyTrendsData(): Array<{label: string, value: number}> {
        // 实现月度趋势数据获取
        const data = [];
        const today = new Date();
        
        // 计算目标月份
        const targetDate = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, 1);
        const daysInMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
        
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(targetDate.getFullYear(), targetDate.getMonth(), day);
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
        const today = new Date();
        const targetYear = today.getFullYear() + this.currentYearOffset;
        
        months.forEach((month, index) => {
            let monthlyTime = 0;
            const daysInMonth = new Date(targetYear, index + 1, 0).getDate();
            
            // 计算该月的总专注时间
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(targetYear, index, day);
                const dateStr = getLocalDateString(date);
                const sessions = this.recordManager.getDateSessions(dateStr);
                monthlyTime += sessions
                    .filter(s => s.type === 'work')
                    .reduce((sum, s) => sum + s.duration, 0);
            }
            
            data.push({
                label: month,
                value: monthlyTime
            });
        });
        
        return data;
    }

    private getTimelineData(): Array<{date: string, sessions: Array<{type: string, title: string, duration: number, startPercent: number, widthPercent: number}>}> {
        // 实现时间线数据获取
        const data = [];
        const today = new Date();
        
        // 根据当前时间范围和偏移量计算数据
        switch (this.currentTimeRange) {
            case 'week':
                // 显示指定周的7天（从星期一开始）
                const startOfWeek = new Date(today);
                const dayOfWeek = today.getDay();
                // 计算到星期一的偏移量：如果是星期日(0)，则偏移-6；否则偏移1-dayOfWeek
                const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                startOfWeek.setDate(today.getDate() + mondayOffset + (this.currentWeekOffset * 7));
                
                for (let i = 0; i < 7; i++) {
                    const date = new Date(startOfWeek);
                    date.setDate(startOfWeek.getDate() + i);
                    data.push(this.getTimelineDataForDate(date));
                }
                break;
                
            case 'month':
                // 显示指定月的最近7天或全月（这里简化为最近7天）
                const targetMonth = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, today.getDate());
                for (let i = 6; i >= 0; i--) {
                    const date = new Date(targetMonth);
                    date.setDate(targetMonth.getDate() - i);
                    data.push(this.getTimelineDataForDate(date));
                }
                break;
                
            case 'year':
                // 显示指定年的最近7天
                const targetYear = new Date(today.getFullYear() + this.currentYearOffset, today.getMonth(), today.getDate());
                for (let i = 6; i >= 0; i--) {
                    const date = new Date(targetYear);
                    date.setDate(targetYear.getDate() - i);
                    data.push(this.getTimelineDataForDate(date));
                }
                break;
                
            default:
                // 默认显示最近7天
                for (let i = 6; i >= 0; i--) {
                    const date = new Date(today);
                    date.setDate(today.getDate() - i);
                    data.push(this.getTimelineDataForDate(date));
                }
        }
        
        return data;
    }

    private getTimelineDataForDate(date: Date): {date: string, sessions: Array<{type: string, title: string, duration: number, startPercent: number, widthPercent: number}>} {
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
        
        return {
            date: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
            sessions: timelineSessions
        };
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

    private getCurrentDateRangeText(): string {
        const today = new Date();
        
        switch (this.currentTimeRange) {
            case 'today':
                const targetDate = new Date(today);
                targetDate.setDate(today.getDate() + this.currentWeekOffset); // 复用weekOffset作为日偏移
                return targetDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
                
            case 'week':
                const startOfWeek = new Date(today);
                const dayOfWeek = today.getDay();
                // 计算到星期一的偏移量：如果是星期日(0)，则偏移-6；否则偏移1-dayOfWeek
                const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                startOfWeek.setDate(today.getDate() + mondayOffset + (this.currentWeekOffset * 7));
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(startOfWeek.getDate() + 6);
                
                return `${startOfWeek.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;
                
            case 'month':
                const targetMonth = new Date(today.getFullYear(), today.getMonth() + this.currentMonthOffset, 1);
                return `${targetMonth.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}`;
                
            case 'year':
                const targetYear = today.getFullYear() + this.currentYearOffset;
                return `${targetYear}年`;
                
            default:
                return '';
        }
    }

    public show() {
        this.dialog.element.addEventListener('click', this.handleClick.bind(this));
        this.updateContent();
    }

    private initPieChart(chartId: string) {
        // 延迟执行以确保DOM元素已渲染
        setTimeout(() => {
            const chartElement = this.dialog.element.querySelector(`#${chartId}`) as HTMLElement;
            if (!chartElement) {
                console.warn('Chart element not found:', chartId);
                return;
            }

            const stats = this.getTaskCategoryStats();
            const total = Object.values(stats).reduce((sum: number, value: any) => sum + value.time, 0);
            
            if (total === 0) return;

            // 初始化echarts实例
            const chart = echarts.init(chartElement);
            
            // 准备数据
            const data = Object.entries(stats).map(([category, data]: [string, any], index) => ({
                name: category,
                value: data.time,
                count: data.count,
                itemStyle: {
                    color: this.getTaskColor(index)
                }
            }));

            // 配置选项
            const option = {
                title: {
                    text: '',
                    left: 'center',
                    top: 20,
                    textStyle: {
                        fontSize: 16,
                        fontWeight: 'bold'
                    }
                },
                tooltip: {
                    trigger: 'item',
                    formatter: (params: any) => {
                        const percentage = ((params.value / total) * 100).toFixed(1);
                        const timeStr = this.recordManager.formatTime(params.value);
                        const countStr = data.find(d => d.name === params.name)?.count || 0;
                        return `
                            <div style="padding: 8px;">
                                <div style="margin-bottom: 4px;">
                                    <span style="display: inline-block; width: 10px; height: 10px; background-color: ${params.color}; border-radius: 50%; margin-right: 8px;"></span>
                                    <strong>${params.name}</strong>
                                </div>
                                <div style="margin-bottom: 2px;">专注时间: ${timeStr}</div>
                                <div style="margin-bottom: 2px;">完成番茄钟: ${countStr}个</div>
                                <div>占比: ${percentage}%</div>
                            </div>
                        `;
                    }
                },
                legend: {
                    orient: 'horizontal',
                    show: false,
                    left: 'center',
                    bottom: '5%',
                    formatter: (name: string) => {
                        const item = data.find(d => d.name === name);
                        if (item) {
                            const timeStr = this.recordManager.formatTime(item.value);
                            return `${name} (${timeStr})`;
                        }
                        return name;
                    }
                },
                series: [
                    {
                        name: t("focusTime"),
                        type: 'pie',
                        radius: ['40%', '70%'],
                        center: ['50%', '45%'],
                        avoidLabelOverlap: false,
                        label: {
                            show: true,
                            position: 'outside',
                            formatter: (params: any) => {
                                const percentage = ((params.value / total) * 100).toFixed(1);
                                return `${params.name}\n${percentage}%`;
                            }
                        },
                        emphasis: {
                            label: {
                                show: true,
                                fontSize: 14,
                                fontWeight: 'bold'
                            },
                            itemStyle: {
                                shadowBlur: 10,
                                shadowOffsetX: 0,
                                shadowColor: 'rgba(0, 0, 0, 0.5)'
                            }
                        },
                        labelLine: {
                            show: true
                        },
                        data: data
                    }
                ]
            };

            // 设置配置项并渲染图表
            chart.setOption(option);

            // 响应式调整
            const resizeObserver = new ResizeObserver(() => {
                chart.resize();
            });
            resizeObserver.observe(chartElement);

            // 存储chart实例以便后续清理
            (chartElement as any).__echartsInstance = chart;
            (chartElement as any).__resizeObserver = resizeObserver;
        }, 100);
    }

    private initHeatmapChart(chartId: string) {
        // 延迟执行以确保DOM元素已渲染
        setTimeout(() => {
            const chartElement = this.dialog.element.querySelector(`#${chartId}`) as HTMLElement;
            if (!chartElement) {
                console.warn('Heatmap chart element not found:', chartId);
                return;
            }

            const heatmapData = this.getHeatmapData(this.currentYear);
            
            if (heatmapData.length === 0) {
                chartElement.innerHTML = `<div class="no-data" style="text-align: center; padding: 50px;">${t("noData")}</div>`;
                return;
            }

            // 初始化echarts实例
            const chart = echarts.init(chartElement);
            
            // 准备热力图数据
            const startDate = new Date(this.currentYear, 0, 1);
            const endDate = new Date(this.currentYear, 11, 31);
            
            // 计算一年中的所有日期
            const dateList = [];
            const dataList = [];
            
            for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
                const localDateStr = getLocalDateString(date);
                
                // 查找对应的数据
                const dayData = heatmapData.find(d => d.date === localDateStr);
                const time = dayData ? dayData.time : 0;
                
                dateList.push(localDateStr);
                dataList.push([localDateStr, time]);
            }

            // 计算最大值用于颜色映射
            const maxValue = Math.max(...dataList.map(d => d[1] as number));
            
            // 配置选项
            const option = {
                title: {
                    text: `${this.currentYear}年专注时间热力图`,
                    left: 'center',
                    top: 10,
                    textStyle: {
                        fontSize: 16,
                        fontWeight: 'bold'
                    }
                },
                tooltip: {
                    position: 'top',
                    formatter: (params: any) => {
                        const date = new Date(params.data[0]);
                        const dateStr = date.toLocaleDateString('zh-CN', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });
                        const time = params.data[1];
                        const timeStr = this.recordManager.formatTime(time);
                        return `${dateStr}<br/>专注时间: ${timeStr}`;
                    }
                },
                visualMap: {
                    min: 0,
                    max: maxValue || 600, // 默认最大值10小时
                    type: 'piecewise',
                    orient: 'horizontal',
                    calculable: true,    // 允许交互（点击色块切换）
                    left: 'center',
                    bottom: 20,
                    pieces: [
                        { min: 0, max: 0, color: '#ebedf0', label: '无' },
                        { min: 1, max: 60, color: '#7bc96f', label: '1小时内' },
                        { min: 61, max: 120, color: '#c6e48b', label: '1-2小时' },
                        { min: 121, max: 240, color: '#60d377ff', label: '2-4小时' },
                        { min: 241, max: 360, color: '#2da344ff', label: '4-6小时' },
                        { min: 361, max: 480, color: '#196127', label: '6-8小时' },
                        { min: 481, color: '#003500', label: '8小时以上' }
                    ],
                    textStyle: {
                        fontSize: 12
                    }
                },
                calendar: {
                    top: 60,
                    left: 50,
                    right: 50,
                    bottom: 80,
                    cellSize: ['auto', 4],
                    range: this.currentYear,
                    itemStyle: {
                        borderWidth: 0.5,
                        borderColor: '#fff'
                    },
                    yearLabel: { show: false },
                    monthLabel: {
                        nameMap: ['1月', '2月', '3月', '4月', '5月', '6月',
                                 '7月', '8月', '9月', '10月', '11月', '12月'],
                        fontSize: 12
                    },
                    dayLabel: {
                        nameMap: ['日', '一', '二', '三', '四', '五', '六'],
                        fontSize: 12
                    }
                },
                series: [{
                    type: 'heatmap',
                    coordinateSystem: 'calendar',
                    data: dataList
                }]
            };

            // 设置配置项并渲染图表
            chart.setOption(option);

            // 响应式调整
            const resizeObserver = new ResizeObserver(() => {
                chart.resize();
            });
            resizeObserver.observe(chartElement);

            // 存储chart实例以便后续清理
            (chartElement as any).__echartsInstance = chart;
            (chartElement as any).__resizeObserver = resizeObserver;
        }, 100);
    }

    private initTimelineChart(chartId: string) {
        // 延迟执行以确保DOM元素已渲染
        setTimeout(() => {
            const chartElement = this.dialog.element.querySelector(`#${chartId}`) as HTMLElement;
            if (!chartElement) {
                console.warn('Timeline chart element not found:', chartId);
                return;
            }

            const timelineData = this.getTimelineData();
            
            if (timelineData.length === 0) {
                chartElement.innerHTML = `<div class="no-data" style="text-align: center; padding: 50px;">${t("noData")}</div>`;
                return;
            }

            // 初始化echarts实例
            const chart = echarts.init(chartElement);
            
            // 准备时间线数据
            const dates = timelineData.map(d => d.date);
            const series = [];
            
            // 为每种类型的会话创建一个系列
            const sessionTypes = ['work', 'shortBreak', 'longBreak'];
            const typeNames = {
                'work': '专注时间',
                'shortBreak': '短休息',
                'longBreak': '长休息'
            };
            const typeColors = {
                'work': '#FF6B6B',
                'shortBreak': '#4CAF50',
                'longBreak': '#2196F3'
            };
            
            sessionTypes.forEach(type => {
                const data = [];
                
                timelineData.forEach((dayData, dayIndex) => {
                    dayData.sessions.forEach(session => {
                        if (session.type === type) {
                            // 计算开始时间和结束时间（以小时为单位）
                            const startHour = session.startPercent / 100 * 24;
                            const endHour = startHour + (session.widthPercent / 100 * 24);
                            
                            data.push([
                                startHour,  // x轴：开始时间
                                dayIndex,   // y轴：日期索引
                                endHour,    // 结束时间
                                session.title,
                                session.duration
                            ]);
                        }
                    });
                });
                
                if (data.length > 0) {
                    series.push({
                        name: typeNames[type],
                        type: 'custom',
                        renderItem: (params, api) => {
                            const start = api.value(0);
                            const end = api.value(2);
                            const y = api.coord([0, api.value(1)])[1];
                            const startX = api.coord([start, 0])[0];
                            const endX = api.coord([end, 0])[0];
                            const height = 20;
                            
                            return {
                                type: 'rect',
                                shape: {
                                    x: startX,
                                    y: y - height / 2,
                                    width: endX - startX,
                                    height: height
                                },
                                style: {
                                    fill: typeColors[type],
                                    opacity: 0.8
                                }
                            };
                        },
                        data: data,
                        tooltip: {
                            formatter: (params) => {
                                const start = Math.floor(params.value[0]);
                                const startMin = Math.round((params.value[0] - start) * 60);
                                const duration = params.value[4];
                                const title = params.value[3];
                                const startTime = `${start.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`;
                                return `${title}<br/>开始时间: ${startTime}<br/>持续时间: ${duration}分钟`;
                            }
                        }
                    });
                }
            });
            
            // 配置选项
            const option = {
                title: {
                    text: '专注时间线',
                    left: 'center',
                    top: 10,
                    textStyle: {
                        fontSize: 16,
                        fontWeight: 'bold'
                    }
                },
                tooltip: {
                    trigger: 'item'
                },

                grid: {
                    left: 80,
                    right: 50,
                    top: 80,
                    bottom: 50
                },
                xAxis: {
                    type: 'value',
                    min: 0,
                    max: 24,
                    interval: 2,
                    axisLabel: {
                        formatter: (value) => {
                            return `${value.toString().padStart(2, '0')}:00`;
                        }
                    },
                    name: '时间',
                    nameLocation: 'middle',
                    nameGap: 30
                },
                yAxis: {
                    type: 'category',
                    data: dates,
                    name: '',
                    nameLocation: 'middle',
                    nameGap: 50,
                    axisLabel: {
                        interval: 0
                    }
                },
                series: series
            };

            // 设置配置项并渲染图表
            chart.setOption(option);

            // 响应式调整
            const resizeObserver = new ResizeObserver(() => {
                chart.resize();
            });
            resizeObserver.observe(chartElement);

            // 存储chart实例以便后续清理
            (chartElement as any).__echartsInstance = chart;
            (chartElement as any).__resizeObserver = resizeObserver;
        }, 100);
    }

    private getTaskColor(index: number): string {
        const colors = [
            '#FF6B6B', '#4CAF50', '#2196F3', '#FF9800', '#9C27B0',
            '#00BCD4', '#795548', '#607D8B', '#E91E63', '#3F51B5',
            '#009688', '#8BC34A', '#CDDC39', '#FFC107', '#FF5722'
        ];
        return colors[index % colors.length];
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
            if (range) {
                this.currentTimeRange = range;
                // 重置偏移量到当前时间段
                this.currentWeekOffset = 0;
                this.currentMonthOffset = 0;
                this.currentYearOffset = 0;
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
                this.navigatePrevious();
                break;
            case 'next':
                this.navigateNext();
                break;
        }
    }

    private navigatePrevious() {
        switch (this.currentTimeRange) {
            case 'week':
                this.currentWeekOffset--;
                break;
            case 'month':
                this.currentMonthOffset--;
                break;
            case 'year':
                this.currentYearOffset--;
                break;
        }
        this.updateContent();
    }

    private navigateNext() {
        switch (this.currentTimeRange) {
            case 'week':
                this.currentWeekOffset++;
                break;
            case 'month':
                this.currentMonthOffset++;
                break;
            case 'year':
                this.currentYearOffset++;
                break;
        }
        this.updateContent();
    }

    private updateContent() {
        // 清理之前的echarts实例
        this.cleanupCharts();
        
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

        // 如果当前是详情视图，初始化饼图
        if (this.currentView === 'details') {
            const chartElement = this.dialog.element.querySelector('.echarts-pie-chart') as HTMLElement;
            if (chartElement) {
                this.initPieChart(chartElement.id);
            }
        }
        
        // 如果当前是热力图视图，初始化热力图
        if (this.currentView === 'heatmap') {
            const heatmapElement = this.dialog.element.querySelector('.echarts-heatmap-chart') as HTMLElement;
            if (heatmapElement) {
                this.initHeatmapChart(heatmapElement.id);
            }
        }
        
        // 如果当前是时间线视图，初始化时间线图表
        if (this.currentView === 'timeline') {
            const timelineElement = this.dialog.element.querySelector('.echarts-timeline-chart') as HTMLElement;
            if (timelineElement) {
                this.initTimelineChart(timelineElement.id);
            }
        }
    }

    private cleanupCharts() {
        // 清理所有echarts实例
        this.dialog.element.querySelectorAll('.echarts-pie-chart, .echarts-heatmap-chart, .echarts-timeline-chart').forEach(element => {
            const chartElement = element as any;
            if (chartElement.__echartsInstance) {
                chartElement.__echartsInstance.dispose();
                chartElement.__echartsInstance = null;
            }
            if (chartElement.__resizeObserver) {
                chartElement.__resizeObserver.disconnect();
                chartElement.__resizeObserver = null;
            }
        });
    }
}