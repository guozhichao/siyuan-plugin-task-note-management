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

    private async loadRecords() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const content = await getFile('/data/storage/petal/siyuan-plugin-task-reminder/pomodoro_record.json');
            // 检查返回的内容是否是有效的记录数据
            if (content && typeof content === 'object' && !content.code) {
                this.records = content;
            } else if (content && typeof content === 'string' && !content.includes('"code"')) {
                this.records = JSON.parse(content);
            } else {
                // 如果返回的是错误对象或包含错误信息，则初始化为空记录
                console.log('番茄钟记录文件不存在或格式错误，初始化空记录');
                this.records = {};
            }
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
                totalBreakTime: 0
            };
        }
    }

    async recordWorkSession(workMinutes: number) {
        // 确保已初始化
        if (!this.isInitialized) {
            await this.initialize();
        }

        const today = this.getToday();
        this.ensureTodayRecord(today);

        console.log('记录工作会话前:', JSON.stringify(this.records[today]));

        // 直接在内存中累加数据，不重新加载文件
        this.records[today].workSessions += 1;
        this.records[today].totalWorkTime += workMinutes;

        console.log('记录工作会话后:', JSON.stringify(this.records[today]));

        await this.saveRecords();
    }

    async recordBreakSession(breakMinutes: number) {
        // 确保已初始化
        if (!this.isInitialized) {
            await this.initialize();
        }

        const today = this.getToday();
        this.ensureTodayRecord(today);

        console.log('记录休息会话前:', JSON.stringify(this.records[today]));

        // 直接在内存中累加数据，不重新加载文件
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
}
