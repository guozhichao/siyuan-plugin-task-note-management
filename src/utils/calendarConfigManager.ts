import { getFile, putFile } from '../api';

const CALENDAR_CONFIG_FILE = 'data/storage/petal/siyuan-plugin-task-note-management/calendar-config.json';

export interface CalendarConfig {
    colorBy: 'category' | 'priority' | 'project';
    viewMode: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';
}

export class CalendarConfigManager {
    private static instance: CalendarConfigManager;
    private config: CalendarConfig;

    private constructor() {
        this.config = {
            colorBy: 'project', // 默认按项目上色
            viewMode: 'timeGridWeek' // 默认周视图
        };
    }

    public static getInstance(): CalendarConfigManager {
        if (!CalendarConfigManager.instance) {
            CalendarConfigManager.instance = new CalendarConfigManager();
        }
        return CalendarConfigManager.instance;
    }

    async initialize() {
        await this.loadConfig();
    }

    private async saveConfig() {
        try {
            const content = JSON.stringify(this.config, null, 2);
            const blob = new Blob([content], { type: 'application/json' });
            const response = await putFile(CALENDAR_CONFIG_FILE, false, blob);

            if (response && typeof response === 'object' && 'code' in response && response.code !== 0) {
                console.error('Failed to save calendar config - API error:', response);
                throw new Error(`API error: ${response.msg || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to save calendar config:', error);
            throw error;
        }
    }

    private async loadConfig() {
        try {
            const content = await getFile(CALENDAR_CONFIG_FILE);
            if (content) {
                const parsed = typeof content === 'string' ? JSON.parse(content) : content;

                // 检查解析的内容是否包含错误响应，如果是则忽略
                if (parsed && typeof parsed === 'object' && 'code' in parsed && 'msg' in parsed) {
                    console.warn('Calendar config file contains error response, using defaults');
                    this.config = { colorBy: 'project', viewMode: 'timeGridWeek' };
                    await this.saveConfig();
                } else {
                    this.config = {
                        colorBy: parsed?.colorBy || 'project',
                        viewMode: parsed?.viewMode || 'timeGridWeek'
                    };
                }
            } else {
                this.config = { colorBy: 'project', viewMode: 'timeGridWeek' };
                await this.saveConfig();
            }
        } catch (error) {
            console.warn('Failed to load calendar config, using defaults:', error);
            this.config = { colorBy: 'project', viewMode: 'timeGridWeek' };
            try {
                await this.saveConfig();
            } catch (saveError) {
                console.error('Failed to create initial calendar config file:', saveError);
            }
        }
    }

    public async setColorBy(colorBy: 'category' | 'priority' | 'project') {
        this.config.colorBy = colorBy;
        await this.saveConfig();
    }

    public getColorBy(): 'category' | 'priority' | 'project' {
        return this.config.colorBy;
    }

    public async setViewMode(viewMode: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay') {
        this.config.viewMode = viewMode;
        await this.saveConfig();
    }

    public getViewMode(): 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' {
        return this.config.viewMode;
    }

    public getConfig(): CalendarConfig {
        return { ...this.config };
    }
}