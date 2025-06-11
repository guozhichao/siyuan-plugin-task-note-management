import { putFile, getFile } from "../api";

// 单个番茄钟会话记录
export interface PomodoroSession {
    id: string; // 会话唯一ID
    type: 'work' | 'shortBreak' | 'longBreak'; // 会话类型
    eventId: string; // 关联的事件ID
    eventTitle: string; // 事件标题
    startTime: string; // 开始时间 ISO 字符串
    endTime: string; // 结束时间 ISO 字符串
    duration: number; // 实际持续时间（分钟）
    plannedDuration: number; // 计划持续时间（分钟）
    completed: boolean; // 是否完成（未中途停止）
}

export interface PomodoroRecord {
    date: string; // YYYY-MM-DD
    workSessions: number; // 完成的工作番茄数
    totalWorkTime: number; // 总工作时间（分钟）
    totalBreakTime: number; // 总休息时间（分钟）
    sessions: PomodoroSession[]; // 详细的会话记录
}

export class PomodoroRecordManager {
    private static instance: PomodoroRecordManager;
    private records: { [date: string]: PomodoroRecord } = {};
    private isLoading: boolean = false;
    private isSaving: boolean = false;
    private isInitialized: boolean = false;

    static getInstance(): PomodoroRecordManager {
        if (!PomodoroRecordManager.instance) {
            PomodoroRecordManager.instance = new PomodoroRecordManager();
        }
        return PomodoroRecordManager.instance;
    }

    async initialize() {
        if (this.isInitialized) return;
        await this.loadRecords();
        this.isInitialized = true;
    }

    private generateSessionId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    private async loadRecords() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const content = await getFile('/data/storage/petal/siyuan-plugin-task-reminder/pomodoro_record.json');
            // 检查返回的内容是否是有效的记录数据
            if (content && typeof content === 'object' && !content.code) {
                this.records = content;
            } else if (content && typeof content === 'string' && !content.includes('"code"')) {
                const parsedContent = JSON.parse(content);
                this.records = parsedContent;
            } else {
                // 如果返回的是错误对象或包含错误信息，则初始化为空记录
                console.log('番茄钟记录文件不存在或格式错误，初始化空记录');
                this.records = {};
            }

            // 确保每个日期记录都有 sessions 数组
            Object.keys(this.records).forEach(date => {
                if (!this.records[date].sessions) {
                    this.records[date].sessions = [];
                }
            });
        } catch (error) {
            console.log('番茄钟记录文件不存在，初始化空记录');
            this.records = {};
        } finally {
            this.isLoading = false;
        }
    }

    private async saveRecords() {
        if (this.isSaving) {
            console.log('正在保存中，跳过本次保存请求');
            return;
        }

        this.isSaving = true;

        try {
            const content = JSON.stringify(this.records, null, 2);
            const blob = new Blob([content], { type: 'application/json' });
            await putFile('/data/storage/petal/siyuan-plugin-task-reminder/pomodoro_record.json', false, blob);
        } catch (error) {
            console.error('保存番茄钟记录失败:', error);
            // 如果保存失败，可能是目录不存在，尝试创建目录后再保存
            try {
                const content = JSON.stringify(this.records, null, 2);
                const blob = new Blob([content], { type: 'application/json' });
                await putFile('/data/storage/petal/siyuan-plugin-task-reminder/pomodoro_record.json', true, blob);
            } catch (retryError) {
                console.error('重试保存番茄钟记录仍然失败:', retryError);
            }
        } finally {
            this.isSaving = false;
        }
    }

    private getToday(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private ensureTodayRecord(today: string) {
        if (!this.records[today]) {
            this.records[today] = {
                date: today,
                workSessions: 0,
                totalWorkTime: 0,
                totalBreakTime: 0,
                sessions: []
            };
        }
        // 确保 sessions 数组存在
        if (!this.records[today].sessions) {
            this.records[today].sessions = [];
        }
    }

    async recordWorkSession(workMinutes: number, eventId: string = '', eventTitle: string = '番茄专注', plannedDuration: number = 25, completed: boolean = true) {
        // 确保已初始化
        if (!this.isInitialized) {
            await this.initialize();
        }

        const today = this.getToday();
        this.ensureTodayRecord(today);

        console.log('记录工作会话前:', JSON.stringify(this.records[today]));

        // 创建详细的会话记录
        const session: PomodoroSession = {
            id: this.generateSessionId(),
            type: 'work',
            eventId,
            eventTitle,
            startTime: new Date(Date.now() - workMinutes * 60000).toISOString(),
            endTime: new Date().toISOString(),
            duration: workMinutes,
            plannedDuration,
            completed
        };

        // 添加到会话记录
        this.records[today].sessions.push(session);

        // 更新统计数据
        if (completed) {
            this.records[today].workSessions += 1;
        }
        this.records[today].totalWorkTime += workMinutes;

        console.log('记录工作会话后:', JSON.stringify(this.records[today]));

        await this.saveRecords();
    }

    async recordBreakSession(breakMinutes: number, eventId: string = '', eventTitle: string = '休息时间', plannedDuration: number = 5, isLongBreak: boolean = false, completed: boolean = true) {
        // 确保已初始化
        if (!this.isInitialized) {
            await this.initialize();
        }

        const today = this.getToday();
        this.ensureTodayRecord(today);

        console.log('记录休息会话前:', JSON.stringify(this.records[today]));

        // 创建详细的会话记录
        const session: PomodoroSession = {
            id: this.generateSessionId(),
            type: isLongBreak ? 'longBreak' : 'shortBreak',
            eventId,
            eventTitle: isLongBreak ? '长时休息' : '短时休息',
            startTime: new Date(Date.now() - breakMinutes * 60000).toISOString(),
            endTime: new Date().toISOString(),
            duration: breakMinutes,
            plannedDuration,
            completed
        };

        // 添加到会话记录
        this.records[today].sessions.push(session);

        // 更新统计数据
        this.records[today].totalBreakTime += breakMinutes;

        console.log('记录休息会话后:', JSON.stringify(this.records[today]));

        await this.saveRecords();
    }

    getTodayFocusTime(): number {
        const today = this.getToday();
        return this.records[today]?.totalWorkTime || 0;
    }

    getWeekFocusTime(): number {
        const today = new Date();
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay()); // 本周开始（周日）

        let totalMinutes = 0;
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            totalMinutes += this.records[dateStr]?.totalWorkTime || 0;
        }

        return totalMinutes;
    }

    /**
     * 获取指定提醒的番茄数量
     */
    async getReminderPomodoroCount(reminderId: string): Promise<number> {
        try {
            const { readReminderData } = await import("../api");
            const reminderData = await readReminderData();

            if (reminderData && reminderData[reminderId]) {
                return reminderData[reminderId].pomodoroCount || 0;
            }

            return 0;
        } catch (error) {
            console.error('获取提醒番茄数量失败:', error);
            return 0;
        }
    }

    /**
     * 获取今日所有提醒的总番茄数
     */
    async getTodayTotalPomodoroCount(): Promise<number> {
        try {
            const { readReminderData } = await import("../api");
            const reminderData = await readReminderData();

            if (!reminderData) return 0;

            const today = new Date().toISOString().split('T')[0];
            let totalCount = 0;

            Object.values(reminderData).forEach((reminder: any) => {
                if (reminder && reminder.date === today && reminder.pomodoroCount) {
                    totalCount += reminder.pomodoroCount;
                }
            });

            return totalCount;
        } catch (error) {
            console.error('获取今日总番茄数失败:', error);
            return 0;
        }
    }

    formatTime(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;

        if (hours > 0) {
            return `${hours}h ${mins}m`;
        } else {
            return `${mins}m`;
        }
    }

    /**
     * 手动刷新数据（仅在需要时调用）
     */
    async refreshData() {
        if (this.isSaving || this.isLoading) {
            console.log('正在进行文件操作，跳过刷新');
            return;
        }
        await this.loadRecords();
    }

    /**
     * 获取指定日期的会话记录
     */
    getDateSessions(date: string): PomodoroSession[] {
        return this.records[date]?.sessions || [];
    }

    /**
     * 获取今日的会话记录
     */
    getTodaySessions(): PomodoroSession[] {
        const today = this.getToday();
        return this.getDateSessions(today);
    }

    /**
     * 获取指定事件的番茄钟数量
     */
    getEventPomodoroCount(eventId: string, date?: string): number {
        const targetDate = date || this.getToday();
        const sessions = this.getDateSessions(targetDate);
        
        return sessions.filter(session => 
            session.eventId === eventId && 
            session.type === 'work' && 
            session.completed
        ).length;
    }

    /**
     * 获取指定事件的总专注时间
     */
    getEventFocusTime(eventId: string, date?: string): number {
        const targetDate = date || this.getToday();
        const sessions = this.getDateSessions(targetDate);
        
        return sessions
            .filter(session => session.eventId === eventId && session.type === 'work')
            .reduce((total, session) => total + session.duration, 0);
    }

    /**
     * 获取日期范围内的会话记录
     */
    getDateRangeSessions(startDate: string, endDate: string): PomodoroSession[] {
        const sessions: PomodoroSession[] = [];
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        for (const date in this.records) {
            const recordDate = new Date(date);
            if (recordDate >= start && recordDate <= end) {
                sessions.push(...this.records[date].sessions);
            }
        }
        
        return sessions.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }

    /**
     * 获取本周的会话记录
     */
    getWeekSessions(): PomodoroSession[] {
        const today = new Date();
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        weekStart.setHours(0, 0, 0, 0);
        
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        
        return this.getDateRangeSessions(
            weekStart.toISOString().split('T')[0],
            weekEnd.toISOString().split('T')[0]
        );
    }

    /**
     * 获取统计信息
     */
    getStatistics(startDate?: string, endDate?: string) {
        let sessions: PomodoroSession[];
        
        if (startDate && endDate) {
            sessions = this.getDateRangeSessions(startDate, endDate);
        } else {
            sessions = this.getTodaySessions();
        }

        const workSessions = sessions.filter(s => s.type === 'work' && s.completed);
        const breakSessions = sessions.filter(s => s.type !== 'work');
        
        // 按事件分组统计
        const eventStats = new Map<string, {
            eventTitle: string;
            pomodoroCount: number;
            totalWorkTime: number;
            totalBreakTime: number;
        }>();

        sessions.forEach(session => {
            if (!eventStats.has(session.eventId)) {
                eventStats.set(session.eventId, {
                    eventTitle: session.eventTitle,
                    pomodoroCount: 0,
                    totalWorkTime: 0,
                    totalBreakTime: 0
                });
            }

            const stats = eventStats.get(session.eventId);
            if (session.type === 'work') {
                if (session.completed) {
                    stats.pomodoroCount++;
                }
                stats.totalWorkTime += session.duration;
            } else {
                stats.totalBreakTime += session.duration;
            }
        });

        return {
            totalWorkSessions: workSessions.length,
            totalWorkTime: workSessions.reduce((sum, s) => sum + s.duration, 0),
            totalBreakTime: breakSessions.reduce((sum, s) => sum + s.duration, 0),
            eventStats: Object.fromEntries(eventStats),
            sessions
        };
    }
}
