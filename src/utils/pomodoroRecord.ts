import { putFile, getFile } from "../api";

export interface PomodoroRecord {
    date: string; // YYYY-MM-DD
    workSessions: number; // 完成的工作番茄数
    totalWorkTime: number; // 总工作时间（分钟）
    totalBreakTime: number; // 总休息时间（分钟）
}

export class PomodoroRecordManager {
    private static instance: PomodoroRecordManager;
    private records: { [date: string]: PomodoroRecord } = {};

    static getInstance(): PomodoroRecordManager {
        if (!PomodoroRecordManager.instance) {
            PomodoroRecordManager.instance = new PomodoroRecordManager();
        }
        return PomodoroRecordManager.instance;
    }

    async initialize() {
        await this.loadRecords();
    }

    private async loadRecords() {
        try {
            const content = await getFile('data/storage/petal/siyuan-plugin-reminder/pomodoro_record.json');
            if (content) {
                this.records = typeof content === 'string' ? JSON.parse(content) : content;
            }
        } catch (error) {
            console.log('番茄钟记录文件不存在，初始化空记录');
            this.records = {};
        }
    }

    private async saveRecords() {
        try {
            const content = JSON.stringify(this.records, null, 2);
            const blob = new Blob([content], { type: 'application/json' });
            await putFile('data/storage/petal/siyuan-plugin-reminder/pomodoro_record.json', false, blob);
        } catch (error) {
            console.error('保存番茄钟记录失败:', error);
        }
    }

    async recordWorkSession(workMinutes: number) {
        const today = new Date().toISOString().split('T')[0];

        if (!this.records[today]) {
            this.records[today] = {
                date: today,
                workSessions: 0,
                totalWorkTime: 0,
                totalBreakTime: 0
            };
        }

        this.records[today].workSessions++;
        this.records[today].totalWorkTime += workMinutes;

        await this.saveRecords();
    }

    async recordBreakSession(breakMinutes: number) {
        const today = new Date().toISOString().split('T')[0];

        if (!this.records[today]) {
            this.records[today] = {
                date: today,
                workSessions: 0,
                totalWorkTime: 0,
                totalBreakTime: 0
            };
        }

        this.records[today].totalBreakTime += breakMinutes;

        await this.saveRecords();
    }

    getTodayFocusTime(): number {
        const today = new Date().toISOString().split('T')[0];
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

    formatTime(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;

        if (hours > 0) {
            return `${hours}h ${mins}m`;
        } else {
            return `${mins}m`;
        }
    }
}
