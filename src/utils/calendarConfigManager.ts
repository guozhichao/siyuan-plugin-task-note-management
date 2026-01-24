import { Plugin } from "siyuan";
import { getFile, removeFile } from "../api";
import { SETTINGS_FILE } from "../index";

const CALENDAR_CONFIG_FILE = 'data/storage/petal/siyuan-plugin-task-note-management/calendar-config.json';

export interface CalendarConfig {
    colorBy: 'category' | 'priority' | 'project';
    viewMode: 'multiMonthYear' | 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'dayGridWeek' | 'dayGridDay' | 'listDay' | 'listWeek' | 'listMonth' | 'listYear' | 'timeGridMultiDays7' | 'dayGridMultiDays7' | 'listMultiDays7';
    viewType: 'timeline' | 'kanban' | 'list';
    showLunar: boolean;
    showPomodoro: boolean;
}

export class CalendarConfigManager {
    private static instance: CalendarConfigManager;
    private config: CalendarConfig;
    private plugin: Plugin;

    private constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.config = {
            colorBy: 'priority', // 默认按优先级上色
            viewMode: 'timeGridWeek', // 默认周视图
            viewType: 'timeline', // 默认视图类型
            showLunar: true, // 默认显示农历
            showPomodoro: true // 默认显示番茄专注时间
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
            const settings = await this.plugin.loadData(SETTINGS_FILE) || {};
            settings.calendarColorBy = this.config.colorBy;
            settings.calendarViewMode = this.config.viewMode;
            settings.calendarViewType = this.config.viewType;
            settings.calendarShowLunar = this.config.showLunar;
            settings.calendarShowPomodoro = this.config.showPomodoro;
            await this.plugin.saveData(SETTINGS_FILE, settings);
        } catch (error) {
            console.error('Failed to save calendar config:', error);
            throw error;
        }
    }

    private async loadConfig() {
        try {
            const settings = await this.plugin.loadData(SETTINGS_FILE) || {};

            // 检查是否存在旧的 calendar-config.json 文件，如果存在则导入并删除
            try {
                const oldCalendarContent = await getFile(CALENDAR_CONFIG_FILE);
                if (oldCalendarContent && oldCalendarContent.code !== 404) {
                    const oldCalendar = typeof oldCalendarContent === 'string' ? JSON.parse(oldCalendarContent) : oldCalendarContent;
                    if (oldCalendar && typeof oldCalendar === 'object') {
                        // 合并旧日历配置到新的 settings
                        if (oldCalendar.colorBy) settings.calendarColorBy = oldCalendar.colorBy;
                        if (oldCalendar.viewMode) settings.calendarViewMode = oldCalendar.viewMode;
                        await this.plugin.saveData(SETTINGS_FILE, settings);
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
                colorBy: settings.calendarColorBy || 'priority',
                viewMode: settings.calendarViewMode || 'timeGridWeek',
                viewType: settings.calendarViewType || 'timeline',
                showLunar: settings.calendarShowLunar !== false, // 默认为 true
                showPomodoro: settings.calendarShowPomodoro !== false // 默认为 true
            };
        } catch (error) {
            console.warn('Failed to load calendar config, using defaults:', error);
            this.config = {
                colorBy: 'priority',
                viewMode: 'timeGridWeek',
                viewType: 'timeline',
                showLunar: true,
                showPomodoro: true
            };
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

    public async setViewMode(viewMode: 'multiMonthYear' | 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'dayGridWeek' | 'dayGridDay' | 'listDay' | 'listWeek' | 'listMonth' | 'listYear' | 'timeGridMultiDays7' | 'dayGridMultiDays7' | 'listMultiDays7') {
        this.config.viewMode = viewMode;
        await this.saveConfig();
    }

    public getViewMode(): 'multiMonthYear' | 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'dayGridWeek' | 'dayGridDay' | 'listDay' | 'listWeek' | 'listMonth' | 'listYear' | 'timeGridMultiDays7' | 'dayGridMultiDays7' | 'listMultiDays7' {
        return this.config.viewMode;
    }

    public async setViewType(viewType: 'timeline' | 'kanban' | 'list') {
        this.config.viewType = viewType;
        await this.saveConfig();
    }

    public getViewType(): 'timeline' | 'kanban' | 'list' {
        return this.config.viewType;
    }

    public async setShowLunar(showLunar: boolean) {
        this.config.showLunar = showLunar;
        await this.saveConfig();
    }

    public getShowLunar(): boolean {
        return this.config.showLunar;
    }

    public async setShowPomodoro(showPomodoro: boolean) {
        this.config.showPomodoro = showPomodoro;
        await this.saveConfig();
    }

    public getShowPomodoro(): boolean {
        return this.config.showPomodoro;
    }

    public getConfig(): CalendarConfig {
        return { ...this.config };
    }
}