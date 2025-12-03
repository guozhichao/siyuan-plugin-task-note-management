import { Plugin } from "siyuan";
import { getFile, removeFile } from "../api";

const CALENDAR_CONFIG_FILE = 'data/storage/petal/siyuan-plugin-task-note-management/calendar-config.json';

export interface CalendarConfig {
    colorBy: 'category' | 'priority' | 'project';
    viewMode: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';
}

export class CalendarConfigManager {
    private static instance: CalendarConfigManager;
    private config: CalendarConfig;
    private plugin: Plugin;

    private constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.config = {
            colorBy: 'project', // 默认按项目上色
            viewMode: 'timeGridWeek' // 默认周视图
        };
    }

    public static getInstance(plugin: Plugin): CalendarConfigManager {
        if (!CalendarConfigManager.instance) {
            CalendarConfigManager.instance = new CalendarConfigManager(plugin);
        }
        return CalendarConfigManager.instance;
    }

    async initialize() {
        await this.loadConfig();
    }

    private async saveConfig() {
        try {
            const settings = await this.plugin.loadData('reminder-settings.json') || {};
            settings.calendarColorBy = this.config.colorBy;
            settings.calendarViewMode = this.config.viewMode;
            await this.plugin.saveData('reminder-settings.json', settings);
        } catch (error) {
            console.error('Failed to save calendar config:', error);
            throw error;
        }
    }

    private async loadConfig() {
        try {
            const settings = await this.plugin.loadData('reminder-settings.json') || {};

            // 检查是否存在旧的 calendar-config.json 文件，如果存在则导入并删除
            try {
                const oldCalendarContent = await getFile(CALENDAR_CONFIG_FILE);
                if (oldCalendarContent && oldCalendarContent.code !== 404) {
                    const oldCalendar = typeof oldCalendarContent === 'string' ? JSON.parse(oldCalendarContent) : oldCalendarContent;
                    if (oldCalendar && typeof oldCalendar === 'object') {
                        // 合并旧日历配置到新的 settings
                        if (oldCalendar.colorBy) settings.calendarColorBy = oldCalendar.colorBy;
                        if (oldCalendar.viewMode) settings.calendarViewMode = oldCalendar.viewMode;
                        await this.plugin.saveData('reminder-settings.json', settings);
                        // 删除旧文件
                        await removeFile(CALENDAR_CONFIG_FILE);
                        console.log('成功导入并删除旧的 calendar-config.json 文件');
                    }
                }
            } catch (error) {
                // 如果文件不存在或其他错误，忽略
                console.log('旧的 calendar-config.json 文件不存在或已处理');
            }

            this.config = {
                colorBy: settings.calendarColorBy || 'project',
                viewMode: settings.calendarViewMode || 'timeGridWeek'
            };
        } catch (error) {
            console.warn('Failed to load calendar config, using defaults:', error);
            this.config = { colorBy: 'project', viewMode: 'timeGridWeek' };
            try {
                await this.saveConfig();
            } catch (saveError) {
                console.error('Failed to create initial calendar config:', saveError);
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