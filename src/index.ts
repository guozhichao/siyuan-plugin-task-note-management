import {
    Plugin,
    getActiveEditor,
    showMessage,
    confirm,
    Dialog,
    Menu,
    openTab,
    openWindow,
    adaptHotkey,
    getFrontend,
    getBackend,
} from "siyuan";
import "./index.scss";

import { QuickReminderDialog } from "./components/QuickReminderDialog";
import { ReminderPanel } from "./components/ReminderPanel";
import { HabitPanel } from "./components/HabitPanel";
import { BatchReminderDialog } from "./components/BatchReminderDialog";
import { ensureReminderDataFile, updateBlockReminderBookmark, ensureProjectDataFile, ensureHabitDataFile, ensureHabitGroupDataFile } from "./api";
import { CalendarView } from "./components/CalendarView";
import { EisenhowerMatrixView } from "./components/EisenhowerMatrixView";
import { CategoryManager } from "./utils/categoryManager";
import { getLocalDateString, getLocalTimeString, compareDateStrings } from "./utils/dateUtils";
import { t, setPluginInstance } from "./utils/i18n";
import { RepeatConfig } from "./components/RepeatSettingsDialog";
import { SettingUtils } from "./libs/setting-utils";
import { PomodoroRecordManager } from "./utils/pomodoroRecord";
import { RepeatSettingsDialog } from "./components/RepeatSettingsDialog";
import { NotificationDialog } from "./components/NotificationDialog";
import { DocumentReminderDialog } from "./components/DocumentReminderDialog";
import { ProjectDialog } from "./components/ProjectDialog";
import { ProjectPanel } from "./components/ProjectPanel";
import { ProjectKanbanView } from "./components/ProjectKanbanView";
import { AddToProjectDialog } from "./components/AddToProjectDialog";
import { PomodoroManager } from "./utils/pomodoroManager";
import SettingPanelComponent from "./SettingPanel.svelte";

export const SETTINGS_FILE = "reminder-settings.json";
const TAB_TYPE = "reminder_calendar_tab";
const EISENHOWER_TAB_TYPE = "reminder_eisenhower_tab";
export const PROJECT_KANBAN_TAB_TYPE = "project_kanban_tab";
const POMODORO_TAB_TYPE = "pomodoro_timer_tab";
export const STORAGE_NAME = "siyuan-plugin-task-note-management";
const BROADCAST_CHANNEL_NAME = "siyuan-plugin-task-note-management-pomodoro";


// 默认设置
export const DEFAULT_SETTINGS = {
    notificationSound: '/plugins/siyuan-plugin-task-note-management/audios/notify.mp3',
    backgroundVolume: 0.5,
    pomodoroWorkDuration: 25,
    pomodoroBreakDuration: 5,
    pomodoroLongBreakDuration: 30,
    pomodoroLongBreakInterval: 4,
    pomodoroAutoMode: false,
    pomodoroWorkSound: '/plugins/siyuan-plugin-task-note-management/audios/background_music.mp3',
    pomodoroBreakSound: '/plugins/siyuan-plugin-task-note-management/audios/relax_background.mp3',
    pomodoroLongBreakSound: '/plugins/siyuan-plugin-task-note-management/audios/relax_background.mp3',
    pomodoroWorkEndSound: '/plugins/siyuan-plugin-task-note-management/audios/work_end.mp3',
    pomodoroBreakEndSound: '/plugins/siyuan-plugin-task-note-management/audios/end_music.mp3',
    pomodoroSystemNotification: true, // 新增：番茄结束后系统弹窗
    reminderSystemNotification: true, // 新增：事件到期提醒系统弹窗
    // 支持 HH:MM 格式，例如 '09:00'，向后兼容旧的数字（如 8 -> '08:00'）
    dailyNotificationTime: '08:00', // 新增：每日通知时间，默认08:00
    dailyNotificationEnabled: true, // 新增：是否启用每日统一通知
    randomNotificationEnabled: false,
    randomNotificationMinInterval: 3,
    randomNotificationMaxInterval: 10,
    randomNotificationBreakDuration: 10,
    randomNotificationSounds: '/plugins/siyuan-plugin-task-note-management/audios/random_start.mp3',
    randomNotificationEndSound: '/plugins/siyuan-plugin-task-note-management/audios/random_end.mp3',
    randomNotificationSystemNotification: true, // 新增：随机提示音系统通知
    dailyFocusGoal: 6,
    autoDetectDateTime: false, // 新增：是否自动识别日期时间
    newDocNotebook: '', // 新增：新建文档的笔记本ID
    newDocPath: '/{{now | date "2006-01-02"}}/', // 新增：新建文档的路径模板，支持sprig语法
    weekStartDay: 1, // 新增：周视图的一周开始日 (0=周日, 1=周一，默认周一)
};

export default class ReminderPlugin extends Plugin {
    private dockPanel: HTMLElement;
    private reminderPanel: ReminderPanel;
    private topBarElement: HTMLElement;
    private dockElement: HTMLElement;
    private tabViews: Map<string, any> = new Map(); // 存储所有Tab视图实例（日历、四象限、项目看板、番茄钟等）
    private categoryManager: CategoryManager;
    private settingUtils: SettingUtils;
    private chronoParser: any;
    private batchReminderDialog: BatchReminderDialog;
    private audioEnabled: boolean = false;
    private preloadedAudio: HTMLAudioElement | null = null;
    // Guard to prevent overlapping notification sounds
    private isPlayingNotificationSound: boolean = false;
    private projectPanel: ProjectPanel;
    private projectDockElement: HTMLElement;
    // Set used to track blocks currently being processed to avoid duplicate work and race conditions
    private processingBlockButtons: Set<string> = new Set();

    // 广播通信相关
    private windowId: string;
    private websocket: WebSocket | null = null;
    private reconnectInterval = 3000;
    private reconnectTimer: number | null = null;
    private otherWindowIds: Set<string> = new Set();
    private pomodoroWindowId: string | null = null; // 存储番茄钟独立窗口的ID

    async onload() {
        await this.loadData(STORAGE_NAME);

        // 添加自定义图标
        this.addIcons(`
            <symbol id="iconProject" viewBox="0 0 1024 1024">
<path d="M775 536.2 456.8 536.2c-26 0-47-21-47-47 0-26 21-47 47-47l318.2 0c26 0 47 21 47 47C822 515.2 800.8 536.2 775 536.2L775 536.2z" p-id="4506"></path><path d="M775 722.2 456.8 722.2c-26 0-47-21-47-47s21-47 47-47l318.2 0c26 0 47 21 47 47S800.8 722.2 775 722.2L775 722.2z" p-id="4507"></path><path d="M991 875.8 991 281.4c0-72.2-65.8-65.4-65.8-65.4s-392.8 0.4-371.8 0c-22.4 0.4-33.8-11.8-33.8-11.8s-15.6-27-43.8-69.4c-29.4-44.6-63.6-37.4-63.6-37.4L123 97.4C42.8 97.4 42 174.6 42 174.6L42 872c0 86 65 75.4 65 75.4l824.2 0C1000.8 947.4 991 875.8 991 875.8L991 875.8zM932 840.6c0 26.6-21.4 48-48 48L149 888.6c-26.6 0-48-21.4-48-48L101 343c0-26.6 21.4-48 48-48L884 295c26.6 0 48 21.4 48 48L932 840.6 932 840.6z" p-id="4508"></path><path d="M282.2 489.2m-50.2 0a25.1 25.1 0 1 0 100.4 0 25.1 25.1 0 1 0-100.4 0Z" p-id="4509"></path><path d="M282.2 675.2m-50.2 0a25.1 25.1 0 1 0 100.4 0 25.1 25.1 0 1 0-100.4 0Z" p-id="4510"></path>
            </symbol>
        `);

        this.addIcons(`
            <symbol id="iconGrid" viewBox="0 0 1024 1024">
            <path d="M513.088 64c10.56 0 19.456 7.04 21.76 16.448l0.64 4.864-0.064 405.312h403.2c11.84 0 21.376 10.048 21.376 22.4 0 10.624-7.04 19.52-16.448 21.824l-4.864 0.64-403.264-0.064v403.2a21.888 21.888 0 0 1-22.4 21.376 22.208 22.208 0 0 1-21.76-16.448l-0.64-4.864V535.424H85.312A21.888 21.888 0 0 1 64 513.088c0-10.56 7.04-19.456 16.448-21.76l4.864-0.64h405.312V85.312c0-11.776 10.048-21.312 22.4-21.312z m317.952 522.688c29.952 0 54.272 26.752 54.272 59.712v179.2c0 32.96-24.32 59.712-54.272 59.712h-190.08c-29.952 0-54.272-26.752-54.272-59.712v-179.2c0-32.96 24.32-59.712 54.272-59.712h190.08z m-448 0c29.952 0 54.272 26.752 54.272 59.712v179.2c0 32.96-24.32 59.712-54.272 59.712h-190.08c-29.952 0-54.272-26.752-54.272-59.712v-179.2c0-32.96 24.32-59.712 54.272-59.712h190.08z m448 59.712h-190.08v179.2h190.08v-179.2z m-448 0h-190.08v179.2h190.08v-179.2z m448-507.712c29.952 0 54.272 26.752 54.272 59.712v179.2c0 32.96-24.32 59.712-54.272 59.712h-190.08c-29.952 0-54.272-26.752-54.272-59.712V198.4c0-32.96 24.32-59.712 54.272-59.712h190.08z m-448 0c29.952 0 54.272 26.752 54.272 59.712v179.2c0 32.96-24.32 59.712-54.272 59.712h-190.08c-29.952 0-54.272-26.752-54.272-59.712V198.4c0-32.96 24.32-59.712 54.272-59.712h190.08z m448 59.712h-190.08v179.2h190.08V198.4z m-448 0h-190.08v179.2h190.08V198.4z" p-id="6019"></path>
            </symbol>
        `);
        setPluginInstance(this);


        // 添加dock栏和顶栏按钮
        this.initializeUI();

        await ensureReminderDataFile();

        // 初始化习惯数据文件
        await ensureHabitDataFile();

        // 初始化习惯分组数据文件
        await ensureHabitGroupDataFile();

        try {
            const { ensureNotifyDataFile } = await import("./api");
            await ensureNotifyDataFile();
        } catch (error) {
            console.warn('初始化通知记录文件失败:', error);
        }

        const pomodoroRecordManager = PomodoroRecordManager.getInstance();
        await pomodoroRecordManager.initialize();

        this.categoryManager = CategoryManager.getInstance();
        await this.categoryManager.initialize();


        // 添加用户交互监听器来启用音频
        this.enableAudioOnUserInteraction();

        // 初始化系统通知权限
        this.initSystemNotificationPermission();

        // 初始化广播通信
        await this.initBroadcastChannel();

        // 监听文档树右键菜单事件
        this.eventBus.on('open-menu-doctree', this.handleDocumentTreeMenu.bind(this));
    }

    private enableAudioOnUserInteraction() {
        const enableAudio = async () => {
            if (this.audioEnabled) return;

            try {
                // 预加载音频文件
                const soundPath = await this.getNotificationSound();
                if (soundPath) {
                    this.preloadedAudio = new Audio(soundPath);
                    this.preloadedAudio.volume = 0; // 很小的音量进行预加载
                    await this.preloadedAudio.play();
                    this.preloadedAudio.pause();
                    this.preloadedAudio.currentTime = 0;
                    // 在预加载音频上设置 ended 处理，确保状态能被正确重置
                    this.preloadedAudio.onended = () => {
                        this.isPlayingNotificationSound = false;
                    };
                    this.preloadedAudio.volume = 1; // 恢复正常音量
                    this.audioEnabled = true;
                    console.log('音频播放已启用');
                }
            } catch (error) {
                console.warn('音频预加载失败，将使用静音模式:', error);
                this.audioEnabled = false;
            }
        };

        // 监听多种用户交互事件
        const events = ['click', 'touchstart', 'keydown'];
        const handleUserInteraction = () => {
            enableAudio();
            // 移除事件监听器，只需要启用一次
            events.forEach(event => {
                document.removeEventListener(event, handleUserInteraction);
            });
        };

        events.forEach(event => {
            document.addEventListener(event, handleUserInteraction, { once: true });
        });
    }



    // 重写 openSetting 方法
    async openSetting() {
        let dialog = new Dialog({
            title: t("settingsPanel"),
            content: `<div id="SettingPanel" style="height: 100%;"></div>`,
            width: "800px",
            height: "700px",
            destroyCallback: (options) => {
                pannel.$destroy();
            }
        });

        let pannel = new SettingPanelComponent({
            target: dialog.element.querySelector("#SettingPanel"),
            props: {
                plugin: this
            }
        });
    }

    // 加载设置的封装函数
    async loadSettings() {
        const data = await this.loadData(SETTINGS_FILE) || {};
        // 合并默认设置和用户设置，确保所有设置项都有值
        const settings = { ...DEFAULT_SETTINGS, ...data };
        // 确保 weekStartDay 在加载后是数字（可能以字符串形式保存）
        if (typeof settings.weekStartDay === 'string') {
            const parsed = parseInt(settings.weekStartDay, 10);
            settings.weekStartDay = isNaN(parsed) ? DEFAULT_SETTINGS.weekStartDay : parsed;
        }
        // 兼容旧设置中使用数字 hour 的情况，将其转换为 HH:MM 格式字符串
        if (typeof settings.dailyNotificationTime === 'number') {
            const hours = Math.max(0, Math.min(23, Math.floor(settings.dailyNotificationTime)));
            settings.dailyNotificationTime = (hours < 10 ? '0' : '') + hours.toString() + ':00';
        }
        if (typeof settings.dailyNotificationTime === 'string') {
            // Normalize formats like '8' -> '08:00', '8:5' -> '08:05'
            const raw = settings.dailyNotificationTime;
            const m = raw.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
            if (m) {
                const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
                const min = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10) || 0));
                settings.dailyNotificationTime = (h < 10 ? '0' : '') + h.toString() + ':' + (min < 10 ? '0' : '') + min.toString();
            } else {
                // 如果无法解析，则回退到默认字符串
                settings.dailyNotificationTime = DEFAULT_SETTINGS.dailyNotificationTime as any;
            }
        }
        return settings;
    }

    // 获取番茄钟设置
    async getPomodoroSettings() {
        const settings = await this.loadSettings();
        return {
            workDuration: settings.pomodoroWorkDuration,
            breakDuration: settings.pomodoroBreakDuration,
            longBreakDuration: settings.pomodoroLongBreakDuration,
            longBreakInterval: Math.max(1, settings.pomodoroLongBreakInterval),
            autoMode: settings.pomodoroAutoMode,
            workSound: settings.pomodoroWorkSound,
            breakSound: settings.pomodoroBreakSound,
            longBreakSound: settings.pomodoroLongBreakSound,
            workEndSound: settings.pomodoroWorkEndSound,
            breakEndSound: settings.pomodoroBreakEndSound,
            backgroundVolume: Math.max(0, Math.min(1, settings.backgroundVolume)),
            systemNotification: settings.pomodoroSystemNotification, // 新增
            randomNotificationEnabled: settings.randomNotificationEnabled,
            randomNotificationMinInterval: Math.max(1, settings.randomNotificationMinInterval),
            randomNotificationMaxInterval: Math.max(1, settings.randomNotificationMaxInterval),
            randomNotificationBreakDuration: Math.max(1, settings.randomNotificationBreakDuration),
            randomNotificationSounds: settings.randomNotificationSounds,
            randomNotificationEndSound: settings.randomNotificationEndSound,
            randomNotificationSystemNotification: settings.randomNotificationSystemNotification, // 新增
            dailyFocusGoal: settings.dailyFocusGoal
        };
    }

    // 获取提醒系统弹窗设置
    async getReminderSystemNotificationEnabled(): Promise<boolean> {
        const settings = await this.loadSettings();
        return settings.reminderSystemNotification !== false;
    }

    // 获取通知声音设置
    async getNotificationSound(): Promise<string> {
        const settings = await this.loadSettings();
        return settings.notificationSound || DEFAULT_SETTINGS.notificationSound;
    }

    // 播放通知声音
    async playNotificationSound() {
        try {
            const soundPath = await this.getNotificationSound();
            if (!soundPath) {
                console.log('通知声音路径为空，静音模式');
                return;
            }

            if (!this.audioEnabled) {
                console.log('音频未启用，需要用户交互后才能播放声音');
                return;
            }
            // 如果已经在播放提示音，则避免重复播放
            if (this.isPlayingNotificationSound) {
                console.debug('playNotificationSound - already playing, skip');
                return;
            }
            // 优先使用预加载的音频
            if (this.preloadedAudio && this.preloadedAudio.src.includes(soundPath)) {
                try {
                    this.isPlayingNotificationSound = true;
                    this.preloadedAudio.currentTime = 0;
                    await this.preloadedAudio.play();
                    // 尝试监听 ended 事件以便清理状态
                    this.preloadedAudio.onended = () => {
                        this.isPlayingNotificationSound = false;
                    };
                    // 作为保险，10s后强制清除播放状态，防止意外情况导致状态未被清除
                    setTimeout(() => { this.isPlayingNotificationSound = false; }, 10000);
                    return;
                } catch (error) {
                    console.warn('预加载音频播放失败，尝试创建新音频:', error);
                }
            }

            // 如果预加载音频不可用，创建新的音频实例
            // 创建新的音频实例并播放
            const audio = new Audio(soundPath);
            audio.volume = 1;
            this.isPlayingNotificationSound = true;
            audio.addEventListener('ended', () => {
                this.isPlayingNotificationSound = false;
            });
            // 10s超时清理防止某些浏览器/环境不触发 ended
            const clearTimer = setTimeout(() => {
                this.isPlayingNotificationSound = false;
            }, 10000);
            try {
                await audio.play();
            } finally {
                clearTimeout(clearTimer);
            }

        } catch (error) {
            // 不再显示错误消息，只记录到控制台
            console.warn('播放通知声音失败 (这是正常的，如果用户未交互):', error.name);

            // 如果是权限错误，提示用户
            if (error.name === 'NotAllowedError') {
                console.log('提示：点击页面任意位置后，音频通知将自动启用');
            }
        }
    }
    private initializeUI() {
        // 添加顶栏按钮
        // this.topBarElement = this.addTopBar({
        //     icon: "iconClock",
        //     title: t("timeReminder"),
        //     position: "left",
        //     callback: () => this.openReminderFloatPanel()
        // });
        // 创建项目管理 Dock 面板
        this.addDock({
            config: {
                position: "LeftTop",
                size: { width: 300, height: 0 },
                icon: "iconProject",
                title: t("projectDockTitle"),
                hotkey: ""
            },
            data: {
                text: "This is my custom dock"
            },
            resize() {
            },
            update() {
            },
            type: "project_dock",
            init: (dock) => {
                this.projectDockElement = dock.element;
                this.projectPanel = new ProjectPanel(dock.element, this);

            }
        });
        // 创建 Dock 面板
        this.addDock({
            config: {
                position: "LeftTop",
                size: { width: 300, height: 0 },
                icon: "iconClock",
                title: t("dockPanelTitle"),
                hotkey: ""
            },
            data: {
                text: "This is my custom dock"
            },
            resize() {
            },
            update() {
            },
            type: "reminder_dock",
            init: (dock) => {
                this.reminderPanel = new ReminderPanel(dock.element, this);
            }
        });

        // 创建习惯打卡 Dock 面板
        this.addDock({
            config: {
                position: "LeftTop",
                size: { width: 300, height: 0 },
                icon: "iconCheck",
                title: "习惯打卡",
                hotkey: ""
            },
            data: {
                text: "Habit tracking dock"
            },
            resize() {
            },
            update() {
            },
            type: "habit_dock",
            init: (dock) => {
                new HabitPanel(dock.element, this);
            }
        });



        // 注册日历视图标签页
        this.addTab({
            type: TAB_TYPE,
            init: ((tab) => {
                const calendarView = new CalendarView(tab.element, this, tab.data);
                // 保存实例引用用于清理
                this.tabViews.set(tab.id, calendarView);
            }) as any
        });

        // 注册四象限视图标签页
        this.addTab({
            type: EISENHOWER_TAB_TYPE,
            init: ((tab) => {
                const eisenhowerView = new EisenhowerMatrixView(tab.element, this);
                // 保存实例引用用于清理
                this.tabViews.set(tab.id, eisenhowerView);
                // 初始化视图
                eisenhowerView.initialize();
            }) as any
        });

        // 注册项目看板标签页
        this.addTab({
            type: PROJECT_KANBAN_TAB_TYPE,
            init: ((tab) => {
                // 从tab数据中获取projectId
                const projectId = tab.data?.projectId;
                if (!projectId) {
                    console.error('项目看板Tab缺少projectId');
                    tab.element.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--b3-theme-error);">错误：缺少项目ID</div>';
                    return;
                }

                const projectKanbanView = new ProjectKanbanView(tab.element, this, projectId);
                // 保存实例引用用于清理
                this.tabViews.set(tab.id, projectKanbanView);
            }) as any
        });

        // 注册番茄钟标签页
        this.addTab({
            type: POMODORO_TAB_TYPE,
            init: ((tab) => {
                const reminder = tab.data?.reminder;
                const settings = tab.data?.settings;
                const isCountUp = tab.data?.isCountUp || false;
                const inheritState = tab.data?.inheritState;
                const isStandaloneWindow = tab.data?.isStandaloneWindow || false;

                if (!reminder || !settings) {
                    console.error('番茄钟Tab缺少必要数据');
                    tab.element.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--b3-theme-error);">错误：缺少番茄钟数据</div>';
                    return;
                }

                console.log('番茄钟Tab初始化', {
                    isStandaloneWindow,
                    windowId: this.windowId,
                    tabId: tab.id
                });

                // 动态导入PomodoroTimer避免循环依赖
                import("./components/PomodoroTimer").then(({ PomodoroTimer }) => {
                    const pomodoroTimer = new PomodoroTimer(reminder, settings, isCountUp, inheritState, this, tab.element);

                    // 使用统一的tabId格式保存番茄钟实例引用
                    const standardTabId = this.name + POMODORO_TAB_TYPE;
                    this.tabViews.set(standardTabId, pomodoroTimer);

                    console.log('番茄钟实例已保存到tabViews, key:', standardTabId);

                    // 如果这是一个独立窗口，延迟通知其他窗口（确保广播通道已建立）
                    if (isStandaloneWindow) {
                        console.log('番茄钟在独立窗口中打开，延迟通知其他窗口...');

                        // 延迟发送，确保广播通道已建立
                        setTimeout(() => {
                            console.log('发送番茄钟窗口打开通知', this.windowId);
                            this.broadcastMessage("pomodoro_window_opened", {
                                windowId: this.windowId
                            }, true);  // 强制发送
                        }, 500);
                    }
                });
            }) as any,
            destroy: (() => {
                // 当番茄钟Tab关闭时，清除标记并通知其他窗口
                console.log('番茄钟Tab销毁');

                // 清理tabViews中的引用
                const standardTabId = this.name + POMODORO_TAB_TYPE;
                if (this.tabViews.has(standardTabId)) {
                    console.log('清理tabViews中的番茄钟实例, key:', standardTabId);
                    this.tabViews.delete(standardTabId);
                }

                if (this.pomodoroWindowId === this.windowId) {
                    console.log('清除番茄钟窗口标记');
                    this.pomodoroWindowId = null;
                    // 通知其他窗口番茄钟窗口已关闭
                    this.broadcastMessage("pomodoro_window_closed", {
                        windowId: this.windowId
                    }, true);
                }
            }) as any
        });

        // 文档块标添加菜单
        this.eventBus.on('click-editortitleicon', this.handleDocumentMenu.bind(this));

        // 块菜单添加菜单
        this.eventBus.on('click-blockicon', this.handleBlockMenu.bind(this));

        // 定期检查提醒
        this.startReminderCheck();

        // 初始化顶栏徽章和停靠栏徽章
        this.updateBadges();
        this.updateProjectBadges();
        this.updateHabitBadges();

        // 延迟一些时间后再次更新徽章，确保停靠栏已渲染
        setTimeout(() => {
            this.updateBadges();
            this.updateProjectBadges();
            this.updateHabitBadges();
        }, 2000);

        // 监听提醒更新事件，更新徽章
        window.addEventListener('reminderUpdated', () => {
            this.updateBadges();
            this.addBreadcrumbButtonsToExistingProtyles();
            const currentProtyle = getActiveEditor(false)?.protyle;
            // 500ms之后调用
            setTimeout(() => {
                this.addBlockProjectButtonsToProtyle(currentProtyle);
            }, 500);
        });

        // 监听项目更新事件，更新项目徽章并重新扫描protyle块按钮
        window.addEventListener('projectUpdated', () => {
            this.updateProjectBadges();
            this.addBreadcrumbButtonsToExistingProtyles();
        });

        // 监听习惯更新事件，更新习惯徽章
        window.addEventListener('habitUpdated', () => {
            this.updateHabitBadges();
        });
    }

    async onLayoutReady() {
        // 初始化批量设置对话框（确保在UI初始化时创建）
        this.batchReminderDialog = new BatchReminderDialog(this);



        // 注册快捷键
        this.registerCommands();

        // 在布局准备就绪后监听protyle切换事件
        // 注册 switch-protyle 事件处理：仅在此事件中调用 addBlockProjectButtonsToProtyle
        this.eventBus.on('switch-protyle', (e) => {
            // 延迟添加按钮，确保protyle完全切换完成
            setTimeout(() => {
                // 保持原有面包屑按钮初始化
                this.addBreadcrumbReminderButton(e.detail.protyle);
                // 将块按钮逻辑限定为 switch-protyle 事件中调用
                this.addBlockProjectButtonsToProtyle(e.detail.protyle);
            }, 500);
        });
        this.eventBus.on('loaded-protyle-dynamic', (e) => {
            // 延迟添加按钮，确保protyle完全加载完成
            setTimeout(() => {
                this.addBlockProjectButtonsToProtyle(e.detail.protyle);
            }, 500);
        });
        this.eventBus.on('loaded-protyle-static', (e) => {
            // 延迟添加按钮，确保protyle完全加载完成
            setTimeout(() => {

                this.addBlockProjectButtonsToProtyle(e.detail.protyle);
            }, 500);
        });
        // 为当前已存在的protyle添加按钮
        this.addBreadcrumbButtonsToExistingProtyles();
    }

    private addBreadcrumbButtonsToExistingProtyles() {
        // 查找所有现有的protyle并添加按钮
        document.querySelectorAll('.protyle').forEach(protyleElement => {
            // 尝试从元素中获取protyle实例
            const protyle = (protyleElement as any).protyle;
            if (protyle) {
                this.addBreadcrumbReminderButton(protyle);
                this.addBlockProjectButtonsToProtyle(protyle);
            }
        });
    }

    private openReminderFloatPanel() {
        // 创建悬浮窗口
        const dialog = new Dialog({
            title: t("timeReminder"),
            content: '<div id="floatReminderPanel" style="height: 600px;"></div>',
            width: "400px",
            height: "600px",
            destroyCallback: () => {
                // 悬浮窗口关闭时清理
            }
        });

        // 在悬浮窗口中创建提醒面板
        const floatContainer = dialog.element.querySelector('#floatReminderPanel') as HTMLElement;
        if (floatContainer) {
            // 传递关闭对话框的回调函数
            new ReminderPanel(floatContainer, this, () => {
                dialog.destroy();
            });
        }
    }

    private async updateBadges() {
        try {
            const { readReminderData } = await import("./api");
            const { generateRepeatInstances } = await import("./utils/repeatUtils");
            const reminderData = await readReminderData();

            if (!reminderData || typeof reminderData !== 'object') {
                this.setTopBarBadge(0);
                this.setDockBadge(0);
                return;
            }

            const today = getLocalDateString();
            let uncompletedCount = 0;

            Object.values(reminderData).forEach((reminder: any) => {
                if (!reminder || typeof reminder !== 'object' || reminder.completed) {
                    return;
                }

                // 处理非重复事件
                if (!reminder.repeat?.enabled) {
                    let shouldCount = false;
                    if (reminder.endDate) {
                        shouldCount = (compareDateStrings(reminder.date, today) <= 0 &&
                            compareDateStrings(today, reminder.endDate) <= 0) ||
                            compareDateStrings(reminder.endDate, today) < 0;

                        // 检查跨天事件是否已标记"今日已完成"
                        if (shouldCount && reminder.dailyCompletions && reminder.dailyCompletions[today]) {
                            shouldCount = false;
                        }
                    } else {
                        shouldCount = reminder.date === today || compareDateStrings(reminder.date, today) < 0;
                    }

                    if (shouldCount) {
                        uncompletedCount++;
                    }
                } else {
                    // 处理重复事件：生成今日的所有重复实例
                    const instances = generateRepeatInstances(reminder, today, today);

                    // 统计未完成的实例数量
                    instances.forEach(instance => {
                        if (!instance.completed) {
                            // 检查重复事件实例是否已标记"今日已完成"（用于跨天重复事件）
                            if (reminder.dailyCompletions && reminder.dailyCompletions[instance.date]) {
                                return; // 跳过已标记今日已完成的跨天重复事件实例
                            }
                            uncompletedCount++;
                        }
                    });
                }
            });

            this.setTopBarBadge(uncompletedCount);
            this.setDockBadge(uncompletedCount);
        } catch (error) {
            console.error('更新徽章失败:', error);
            this.setTopBarBadge(0);
            this.setDockBadge(0);
        }
    }


    private async updateProjectBadges() {
        try {
            const { readProjectData } = await import("./api");
            const projectData = await readProjectData();

            if (!projectData || typeof projectData !== 'object') {
                this.setProjectDockBadge(0);
                return;
            }

            // 统计正在进行的项目数量
            let activeCount = 0;
            Object.values(projectData).forEach((project: any) => {
                if (project && typeof project === 'object') {
                    // 数据迁移：处理旧的 archived 字段
                    const status = project.status || (project.archived ? 'archived' : 'active');
                    if (status === 'active') {
                        activeCount++;
                    }
                }
            });

            this.setProjectDockBadge(activeCount);
        } catch (error) {
            console.error('更新项目徽章失败:', error);
            this.setProjectDockBadge(0);
        }
    }

    private setTopBarBadge(count: number) {
        if (!this.topBarElement) return;

        // 移除现有徽章
        const existingBadge = this.topBarElement.querySelector('.reminder-badge');
        if (existingBadge) {
            existingBadge.remove();
        }

        // 如果计数大于0，添加徽章
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'reminder-badge';
            badge.textContent = count.toString();
            badge.style.cssText = `
                position: absolute;
                top: -2px;
                right: -2px;
                background: var(--b3-theme-error);
                color: white;
                border-radius: 50%;
                min-width: 16px;
                height: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                font-weight: bold;
                line-height: 1;
                z-index: 1;
            `;

            // 确保父元素有相对定位
            this.topBarElement.style.position = 'relative';
            this.topBarElement.appendChild(badge);
        }
    }

    // 等待元素渲染完成后执行的函数
    private whenElementExist(selector: string | (() => Element | null)): Promise<Element> {
        return new Promise(resolve => {
            const checkForElement = () => {
                let element = null;
                if (typeof selector === 'function') {
                    element = selector();
                } else {
                    element = document.querySelector(selector);
                }
                if (element) {
                    resolve(element);
                } else {
                    // 如果元素不存在，等浏览器再次重绘，递归调用checkForElement，直到元素出现
                    requestAnimationFrame(checkForElement);
                }
            };
            checkForElement();
        });
    }

    private async setDockBadge(count: number) {
        try {
            // 等待停靠栏图标出现
            const dockIcon = await this.whenElementExist('.dock__item[data-type="siyuan-plugin-task-note-managementreminder_dock"]') as HTMLElement;

            // 移除现有徽章
            const existingBadge = dockIcon.querySelector('.reminder-dock-badge');
            if (existingBadge) {
                existingBadge.remove();
            }

            // 如果计数大于0，添加徽章
            if (count > 0) {
                const badge = document.createElement('span');
                badge.className = 'reminder-dock-badge';
                badge.textContent = count.toString();
                badge.style.cssText = `
                    position: absolute;
                    top: 2px;
                    right: 2px;
                    background: var(--b3-theme-error);
                    color: white;
                    border-radius: 50%;
                    min-width: 14px;
                    height: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: bold;
                    line-height: 1;
                    z-index: 1;
                    pointer-events: none;
                `;

                // 确保父元素有相对定位
                dockIcon.style.position = 'relative';
                dockIcon.appendChild(badge);
            }
        } catch (error) {
            console.warn('设置停靠栏徽章失败:', error);
            // 如果等待超时或出错，尝试传统方法作为后备
            this.setDockBadgeFallback(count);
        }
    }

    private setDockBadgeFallback(count: number) {
        // 查找停靠栏图标（传统方法作为后备）
        const dockIcon = document.querySelector('.dock__item[data-type="siyuan-plugin-task-note-managementreminder_dock"]');
        if (!dockIcon) return;

        // 移除现有徽章
        const existingBadge = dockIcon.querySelector('.reminder-dock-badge');
        if (existingBadge) {
            existingBadge.remove();
        }

        // 如果计数大于0，添加徽章
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'reminder-dock-badge';
            badge.textContent = count.toString();
            badge.style.cssText = `
                position: absolute;
                top: 2px;
                right: 2px;
                background: var(--b3-theme-error);
                color: white;
                border-radius: 50%;
                min-width: 14px;
                height: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                font-weight: bold;
                line-height: 1;
                z-index: 1;
                pointer-events: none;
            `;

            // 确保父元素有相对定位
            (dockIcon as HTMLElement).style.position = 'relative';
            dockIcon.appendChild(badge);
        }
    }

    private async setProjectDockBadge(count: number) {
        try {
            // 等待项目停靠栏图标出现
            const dockIcon = await this.whenElementExist('.dock__item[data-type="siyuan-plugin-task-note-managementproject_dock"]') as HTMLElement;

            // 移除现有徽章
            const existingBadge = dockIcon.querySelector('.project-dock-badge');
            if (existingBadge) {
                existingBadge.remove();
            }

            // 如果计数大于0，添加徽章
            if (count > 0) {
                const badge = document.createElement('span');
                badge.className = 'project-dock-badge';
                badge.textContent = count.toString();
                badge.style.cssText = `
                    position: absolute;
                    top: 2px;
                    right: 2px;
                    background:#2c6a2e;
                    color: white;
                    border-radius: 50%;
                    min-width: 14px;
                    height: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: bold;
                    line-height: 1;
                    z-index: 1;
                    pointer-events: none;
                `;

                // 确保父元素有相对定位
                dockIcon.style.position = 'relative';
                dockIcon.appendChild(badge);
            }
        } catch (error) {
            console.warn('设置项目停靠栏徽章失败:', error);
            // 如果等待超时或出错，尝试传统方法作为后备
            this.setProjectDockBadgeFallback(count);
        }
    }

    private setProjectDockBadgeFallback(count: number) {
        // 查找项目停靠栏图标（传统方法作为后备）
        const dockIcon = document.querySelector('.dock__item[data-type="siyuan-plugin-task-note-managementproject_dock"]');
        if (!dockIcon) return;

        // 移除现有徽章
        const existingBadge = dockIcon.querySelector('.project-dock-badge');
        if (existingBadge) {
            existingBadge.remove();
        }

        // 如果计数大于0，添加徽章
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'project-dock-badge';
            badge.textContent = count.toString();
            badge.style.cssText = `
                position: absolute;
                top: 2px;
                right: 2px;
                background: var(--b3-theme-error);
                color: white;
                border-radius: 50%;
                min-width: 14px;
                height: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                font-weight: bold;
                line-height: 1;
                z-index: 1;
                pointer-events: none;
            `;

            // 确保父元素有相对定位
            (dockIcon as HTMLElement).style.position = 'relative';
            dockIcon.appendChild(badge);
        }
    }

    private async updateHabitBadges() {
        try {
            const { readHabitData } = await import("./api");
            const habitData = await readHabitData();

            if (!habitData || typeof habitData !== 'object') {
                this.setHabitDockBadge(0);
                return;
            }

            const today = getLocalDateString();
            let pendingCount = 0;

            Object.values(habitData).forEach((habit: any) => {
                if (!habit || typeof habit !== 'object') {
                    return;
                }

                // 检查是否在有效期内
                if (habit.startDate > today) return;
                if (habit.endDate && habit.endDate < today) return;

                // 检查今天是否应该打卡
                if (!this.shouldCheckInOnDate(habit, today)) return;

                // 检查今天是否已完成
                const checkIn = habit.checkIns?.[today];
                const currentCount = checkIn?.count || 0;
                const targetCount = habit.target || 1;

                if (currentCount < targetCount) {
                    pendingCount++;
                }
            });

            this.setHabitDockBadge(pendingCount);
        } catch (error) {
            console.error('更新习惯徽章失败:', error);
            this.setHabitDockBadge(0);
        }
    }

    private shouldCheckInOnDate(habit: any, date: string): boolean {
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

    private async setHabitDockBadge(count: number) {
        try {
            // 等待习惯停靠栏图标出现
            const dockIcon = await this.whenElementExist('.dock__item[data-type="siyuan-plugin-task-note-managementhabit_dock"]') as HTMLElement;

            // 移除现有徽章
            const existingBadge = dockIcon.querySelector('.habit-dock-badge');
            if (existingBadge) {
                existingBadge.remove();
            }

            // 如果计数大于0，添加徽章
            if (count > 0) {
                const badge = document.createElement('span');
                badge.className = 'habit-dock-badge';
                badge.textContent = count.toString();
                badge.style.cssText = `
                    position: absolute;
                    top: 2px;
                    right: 2px;
                    background: var(--b3-theme-primary);
                    color: white;
                    border-radius: 50%;
                    min-width: 14px;
                    height: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: bold;
                    line-height: 1;
                    z-index: 1;
                    pointer-events: none;
                `;

                // 确保父元素有相对定位
                dockIcon.style.position = 'relative';
                dockIcon.appendChild(badge);
            }
        } catch (error) {
            console.warn('设置习惯停靠栏徽章失败:', error);
            // 如果等待超时或出错，尝试传统方法作为后备
            this.setHabitDockBadgeFallback(count);
        }
    }

    private setHabitDockBadgeFallback(count: number) {
        // 查找习惯停靠栏图标（传统方法作为后备）
        const dockIcon = document.querySelector('.dock__item[data-type="siyuan-plugin-task-note-managementhabit_dock"]');
        if (!dockIcon) return;

        // 移除现有徽章
        const existingBadge = dockIcon.querySelector('.habit-dock-badge');
        if (existingBadge) {
            existingBadge.remove();
        }

        // 如果计数大于0，添加徽章
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'habit-dock-badge';
            badge.textContent = count.toString();
            badge.style.cssText = `
                position: absolute;
                top: 2px;
                right: 2px;
                background: var(--b3-theme-primary);
                color: white;
                border-radius: 50%;
                min-width: 14px;
                height: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                font-weight: bold;
                line-height: 1;
                z-index: 1;
                pointer-events: none;
            `;

            // 确保父元素有相对定位
            (dockIcon as HTMLElement).style.position = 'relative';
            dockIcon.appendChild(badge);
        }
    }

    // 获取自动识别日期时间设置

    private handleDocumentTreeMenu({ detail }) {
        const elements = detail.elements;
        if (!elements || !elements.length) {
            return;
        }
        console.log(t("handleDocumentTreeMenuLog"), elements);
        // 获取所有选中的文档ID
        const documentIds = Array.from(elements)
            .map((element: Element) => element.getAttribute("data-node-id"))
            .filter((id: string | null): id is string => id !== null);

        if (!documentIds.length) return;

        // 第一个选中的文档（用于项目笔记设置和查看文档提醒）
        const firstDocumentId = documentIds[0];

        // 添加分隔符
        detail.menu.addSeparator();

        // 添加设置时间提醒菜单项
        detail.menu.addItem({
            iconHTML: "⏰",
            label: documentIds.length > 1 ?
                t("batchSetReminderBlocks", { count: documentIds.length.toString() }) :
                t("setTimeReminder"),
            click: async () => {
                if (documentIds.length > 1) {
                    // 确保 batchReminderDialog 已初始化
                    if (!this.batchReminderDialog) {
                        this.batchReminderDialog = new BatchReminderDialog(this);
                    }
                    // 多选文档使用批量设置对话框
                    this.batchReminderDialog.show(documentIds);
                } else {
                    // 单选文档使用普通设置对话框，使用设置中的自动检测配置
                    const autoDetect = await this.getAutoDetectDateTimeEnabled();
                    // 如果文档本身是一个项目，传入该项目ID作为默认项目
                    try {
                        const { readProjectData } = await import("./api");
                        const projectData = await readProjectData();
                        const projectId = projectData && projectData[firstDocumentId] ? projectData[firstDocumentId].blockId || projectData[firstDocumentId].id : undefined;
                        const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                            blockId: firstDocumentId,
                            autoDetectDateTime: autoDetect,
                            defaultProjectId: projectId,
                            mode: 'block',
                            plugin: this
                        });
                        dialog.show();
                    } catch (err) {
                        const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                            blockId: firstDocumentId,
                            autoDetectDateTime: autoDetect,
                            mode: 'block'
                        });
                        dialog.show();
                    }
                }
            }
        });

        // 添加查看文档所有提醒菜单项（只处理第一个选中的文档）
        if (documentIds.length === 1) {
            detail.menu.addItem({
                iconHTML: "📋",
                label: t("viewDocumentAllReminders"),
                click: () => {
                    const documentReminderDialog = new DocumentReminderDialog(documentIds[0]);
                    documentReminderDialog.show();
                }
            });
        }


        // 添加设置为项目笔记菜单项（只处理第一个选中的文档）
        detail.menu.addItem({
            iconHTML: "📂",
            label: t("projectManagement"),
            click: async () => {
                const { readProjectData } = await import("./api");
                const projectData = await readProjectData();
                const isProject = projectData && projectData.hasOwnProperty(firstDocumentId);
                if (isProject) {
                    // 打开项目看板
                    this.openProjectKanbanTab(
                        projectData[firstDocumentId].blockId,
                        projectData[firstDocumentId].title
                    );
                } else {
                    // 循环传递所有id
                    for (const docId of documentIds) {
                        const dialog = new ProjectDialog(docId);
                        dialog.show();
                    }
                }
            }
        });
    }
    private handleDocumentMenu({ detail }) {
        const documentId = detail.protyle.block.rootID;

        detail.menu.addItem({
            iconHTML: "⏰",
            label: t("setTimeReminder"),
            click: async () => {
                if (documentId) {
                    const autoDetect = await this.getAutoDetectDateTimeEnabled();
                    try {
                        const { readProjectData } = await import("./api");
                        const projectData = await readProjectData();
                        const projectId = projectData && projectData[documentId] ? projectData[documentId].blockId || projectData[documentId].id : undefined;
                        const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                            blockId: documentId,
                            autoDetectDateTime: autoDetect,
                            defaultProjectId: projectId,
                            mode: 'block',
                            plugin: this
                        });
                        dialog.show();
                    } catch (err) {
                        const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                            blockId: documentId,
                            autoDetectDateTime: autoDetect,
                            mode: 'block',
                            plugin: this
                        });
                        dialog.show();
                    }
                }
            }
        });

        // 添加文档提醒查看功能
        detail.menu.addItem({
            iconHTML: "📋",
            label: t("documentReminderManagement"),
            click: () => {
                if (documentId) {
                    const documentReminderDialog = new DocumentReminderDialog(documentId);
                    documentReminderDialog.show();
                }
            }
        });

        // 添加项目笔记设置功能
        detail.menu.addItem({
            iconHTML: "📂",
            label: t("projectManagement"),
            click: async () => {
                if (documentId) {
                    const { readProjectData } = await import("./api");
                    const projectData = await readProjectData();
                    const isProject = projectData && projectData.hasOwnProperty(documentId);

                    if (isProject) {
                        // 打开项目看板
                        this.openProjectKanbanTab(
                            projectData[documentId].blockId,
                            projectData[documentId].title
                        );
                    } else {
                        const dialog = new ProjectDialog(documentId);
                        dialog.show();
                    }
                }
            }
        });


    }

    private handleBlockMenu({ detail }) {
        detail.menu.addItem({
            iconHTML: "⏰",
            label: detail.blockElements.length > 1 ? t("batchSetReminderBlocks", { count: detail.blockElements.length.toString() }) : t("setTimeReminder"),
            click: async () => {
                if (detail.blockElements && detail.blockElements.length > 0) {
                    const blockIds = detail.blockElements
                        .map(el => el.getAttribute("data-node-id"))
                        .filter(id => id);

                    if (blockIds.length > 0) {
                        await this.handleMultipleBlocks(blockIds);
                    }
                }
            }
        });


    }

    private async handleMultipleBlocks(blockIds: string[]) {
        if (blockIds.length === 1) {
            // 单个块时使用普通对话框，应用自动检测设置
            const autoDetect = await this.getAutoDetectDateTimeEnabled();
            try {
                const { readProjectData } = await import("./api");
                // blockIds[0] 所在文档是否为项目（需要读取块以确定根文档ID）
                const { getBlockByID } = await import("./api");
                const block = await getBlockByID(blockIds[0]);
                const docId = block?.root_id || blockIds[0];
                const projectData = await readProjectData();
                const projectId = projectData && projectData[docId] ? projectData[docId].blockId || projectData[docId].id : undefined;
                const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                    blockId: blockIds[0],
                    autoDetectDateTime: autoDetect,
                    defaultProjectId: projectId,
                    mode: 'block',
                    plugin: this
                });
                dialog.show();
            } catch (err) {
                const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                    blockId: blockIds[0],
                    autoDetectDateTime: autoDetect,
                    mode: 'block',
                    plugin: this
                });
                dialog.show();
            }
        } else {
            // 确保 batchReminderDialog 已初始化
            if (!this.batchReminderDialog) {
                this.batchReminderDialog = new BatchReminderDialog(this);
            }

            // 使用新的批量设置组件
            await this.batchReminderDialog.show(blockIds);
        }
    }

    private startReminderCheck() {
        // 每30s检查一次提醒
        setInterval(() => {
            this.checkReminders();
        }, 30000);

        // 启动时立即检查一次
        setTimeout(() => {
            this.checkReminders();
        }, 5000);
    }

    private async checkReminders() {
        try {
            const { readReminderData, writeReminderData, hasNotifiedToday, markNotifiedToday } = await import("./api");
            const { generateRepeatInstances } = await import("./utils/repeatUtils");
            let reminderData = await readReminderData();

            // 检查数据是否有效，如果数据被损坏（包含错误信息），重新初始化
            if (!reminderData || typeof reminderData !== 'object' ||
                reminderData.hasOwnProperty('code') || reminderData.hasOwnProperty('msg')) {
                console.warn('检测到损坏的提醒数据，重新初始化:', reminderData);
                reminderData = {};
                await writeReminderData(reminderData);
                return;
            }

            const today = getLocalDateString();
                    const currentTime = getLocalTimeString();
                    const currentTimeNumber = this.timeStringToNumber(currentTime);

            // 获取用户设置的每日通知时间（HH:MM）并解析为数字（HHMM）以便比较
            const dailyNotificationTime = await this.getDailyNotificationTime();
            const dailyNotificationTimeNumber = this.timeStringToNumber(dailyNotificationTime);

            // 检查单个时间提醒（不受每日通知时间限制）
            await this.checkTimeReminders(reminderData, today, currentTime);

            // 检查习惯提醒（当有习惯在今日设置了 reminderTime 时，也应触发提醒）
            try {
                await this.checkHabitReminders(today, currentTime);
            } catch (err) {
                console.warn('检查习惯提醒失败:', err);
            }

            // 只在设置的时间后进行全天事项的每日汇总提醒检查
            if (currentTimeNumber < dailyNotificationTimeNumber) {
                return;
            }

            // 检查是否启用了每日统一通知
            const dailyNotificationEnabled = await this.getDailyNotificationEnabled();
            if (!dailyNotificationEnabled) {
                return;
            }

            // 检查今天是否已经提醒过全天事件
            let hasNotifiedDailyToday = false;
            try {
                hasNotifiedDailyToday = await hasNotifiedToday(today);
            } catch (error) {
                console.warn('检查每日通知状态失败，可能是首次初始化:', error);
                try {
                    const { ensureNotifyDataFile } = await import("./api");
                    await ensureNotifyDataFile();
                    hasNotifiedDailyToday = await hasNotifiedToday(today);
                } catch (initError) {
                    console.warn('初始化通知记录文件失败:', initError);
                    hasNotifiedDailyToday = false;
                }
            }

            // 如果今天已经提醒过全天事件，则不再提醒
            if (hasNotifiedDailyToday) {
                return;
            }

            // 处理重复事件 - 生成重复实例
            const allReminders = [];
            const repeatInstancesMap = new Map();

            Object.values(reminderData).forEach((reminder: any) => {
                // 验证 reminder 对象是否有效
                if (!reminder || typeof reminder !== 'object') {
                    console.warn('无效的提醒项:', reminder);
                    return;
                }

                // 检查必要的属性
                if (typeof reminder.completed !== 'boolean' || !reminder.id) {
                    console.warn('提醒项缺少必要属性:', reminder);
                    return;
                }

                // 对于重复事件，不再添加原始事件（避免与生成的实例产生重复并错误识别为过期）
                if (!reminder.repeat?.enabled) {
                    allReminders.push(reminder);
                }

                // 如果有重复设置，生成重复事件实例
                if (reminder.repeat?.enabled) {
                    const repeatInstances = generateRepeatInstances(reminder, today, today);
                    repeatInstances.forEach(instance => {
                        // 为生成的实例创建独立的呈现对象（包含 instance 级别的修改）
                        // 检查实例级别的完成状态
                        const completedInstances = reminder.repeat?.completedInstances || [];
                        let isInstanceCompleted = completedInstances.includes(instance.date);

                        // 检查实例级别的修改（包括备注、优先级、分类等）
                        const instanceModifications = reminder.repeat?.instanceModifications || {};
                        const instanceMod = instanceModifications[instance.date];

                        // 如果原始任务在每日完成记录中标记了今天已完成（跨天标记），则该实例应视为已完成
                        if (!isInstanceCompleted && reminder.dailyCompletions && reminder.dailyCompletions[instance.date]) {
                            isInstanceCompleted = true;
                        }

                        const instanceReminder = {
                            ...reminder,
                            id: instance.instanceId,
                            date: instance.date,
                            endDate: instance.endDate,
                            customReminderTime: instance.customReminderTime || reminder.customReminderTime,
                            time: instance.time,
                            endTime: instance.endTime,
                            isRepeatInstance: true,
                            originalId: instance.originalId,
                            completed: isInstanceCompleted,
                            note: instanceMod?.note || reminder.note,
                            priority: instanceMod?.priority !== undefined ? instanceMod.priority : reminder.priority,
                            categoryId: instanceMod?.categoryId !== undefined ? instanceMod.categoryId : reminder.categoryId,
                            projectId: instanceMod?.projectId !== undefined ? instanceMod.projectId : reminder.projectId
                        };

                        const key = `${reminder.id}_${instance.date}`;
                        if (!repeatInstancesMap.has(key) ||
                            compareDateStrings(instance.date, repeatInstancesMap.get(key).date) < 0) {
                            repeatInstancesMap.set(key, instanceReminder);
                        }
                    });
                }
            });

            // 添加去重后的重复事件实例
            repeatInstancesMap.forEach(instance => {
                allReminders.push(instance);
            });

            // 筛选今日提醒 - 进行分类和排序
            const todayReminders = allReminders.filter((reminder: any) => {
                if (reminder.completed) return false;

                // 如果是跨天事件并且已经标记了今日已完成，则不加入今日提醒
                // 对非重复事件直接检查 dailyCompletions；重复实例在生成时已处理并设置 completed
                if (reminder.endDate && reminder.dailyCompletions && reminder.dailyCompletions[today]) {
                    return false;
                }

                if (reminder.endDate) {
                    // 跨天事件：只要今天在事件的时间范围内就显示，或者事件已过期但结束日期在今天之前
                    return (compareDateStrings(reminder.date, today) <= 0 &&
                        compareDateStrings(today, reminder.endDate) <= 0) ||
                        compareDateStrings(reminder.endDate, today) < 0;
                } else {
                    // 单日事件：今天或过期的都显示在今日
                    return reminder.date === today || compareDateStrings(reminder.date, today) < 0;
                }
            });

            // 收集需要提醒的今日事项
            const remindersToShow: any[] = [];

            todayReminders.forEach((reminder: any) => {
                // 获取分类信息
                let categoryInfo = {};
                if (reminder.categoryId) {
                    const category = this.categoryManager.getCategoryById(reminder.categoryId);
                    if (category) {
                        categoryInfo = {
                            categoryName: category.name,
                            categoryColor: category.color,
                            categoryIcon: category.icon
                        };
                    }
                }

                // 判断是否全天事件
                const isAllDay = !reminder.time || reminder.time === '';

                // 构建完整的提醒信息
                const dt = this.extractDateAndTime(reminder.time || reminder.customReminderTime);
                const displayTime = dt?.time || reminder.time || reminder.customReminderTime;
                const reminderInfo = {
                    id: reminder.id,
                    blockId: reminder.blockId,
                    title: reminder.title || t("unnamedNote"),
                    note: reminder.note,
                    priority: reminder.priority || 'none',
                    categoryId: reminder.categoryId,
                    time: displayTime,
                    date: reminder.date,
                    endDate: reminder.endDate,
                    isAllDay: isAllDay,
                    isOverdue: reminder.endDate ?
                        compareDateStrings(reminder.endDate, today) < 0 :
                        compareDateStrings(reminder.date, today) < 0,
                    ...categoryInfo
                };

                remindersToShow.push(reminderInfo);
            });

            // 显示今日提醒 - 进行分类和排序
            if (remindersToShow.length > 0) {
                // 对提醒事件进行分类
                const overdueReminders = remindersToShow.filter(r => r.isOverdue);
                const todayTimedReminders = remindersToShow.filter(r => !r.isOverdue && !r.isAllDay && r.time);
                const todayNoTimeReminders = remindersToShow.filter(r => !r.isOverdue && !r.isAllDay && !r.time);
                const todayAllDayReminders = remindersToShow.filter(r => !r.isOverdue && r.isAllDay);

                // 对每个分类内部排序
                // 过期事件：按日期排序（最早的在前）
                overdueReminders.sort((a, b) => {
                    const dateCompare = a.date.localeCompare(b.date);
                    if (dateCompare !== 0) return dateCompare;
                    // 同一天的按时间排序
                    return (a.time || '').localeCompare(b.time || '');
                });

                // 今日有时间事件：按时间排序
                todayTimedReminders.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

                // 今日无时间事件：按标题排序
                todayNoTimeReminders.sort((a, b) => a.title.localeCompare(b.title));

                // 全天事件：按标题排序
                todayAllDayReminders.sort((a, b) => a.title.localeCompare(b.title));

                // 合并排序后的数组：过期 -> 有时间 -> 无时间 -> 全天
                const sortedReminders = [
                    ...overdueReminders,
                    ...todayTimedReminders,
                    ...todayNoTimeReminders,
                    ...todayAllDayReminders
                ];

                // 播放通知声音
                await this.playNotificationSound();

                // 始终显示思源内部通知对话框
                NotificationDialog.showAllDayReminders(sortedReminders);

                // 检查是否启用系统弹窗通知
                const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();

                // 如果启用了系统弹窗，同时也显示系统通知
                if (systemNotificationEnabled) {
                    const totalCount = sortedReminders.length;
                    const title = '📅 ' + t("dailyRemindersNotification") + ` (${totalCount})`;

                    // 创建任务列表 - 直接显示所有任务
                    let taskList = ``;

                    // 显示前2个任务
                    sortedReminders.slice(0, 2).forEach(reminder => {
                        let timeText = '';
                        // 使用仅时间部分进行提示文本显示
                        const parsed = this.extractDateAndTime(reminder.customReminderTime || reminder.time || reminder.time);
                        if (parsed && parsed.time) {
                            timeText = ` ⏰${parsed.time}`;
                        } else if (reminder.time) {
                            timeText = ` ${reminder.time}`;
                        }
                        const categoryText = (reminder as any).categoryName ? ` [${(reminder as any).categoryName}]` : '';
                        const overdueIcon = reminder.isOverdue ? '⚠️ ' : '';
                        taskList += `${overdueIcon}• ${reminder.title}${timeText}${categoryText}\n`;
                    });

                    // 如果任务超过2个，显示省略信息
                    if (sortedReminders.length > 2) {
                        taskList += `... ${t("moreItems", { count: (sortedReminders.length - 2).toString() })}\n`;
                    }

                    const message = taskList.trim();

                    this.showReminderSystemNotification(title, message);
                }

                // 标记今天已提醒 - 添加错误处理
                if (remindersToShow.length > 0) {
                    try {
                        await markNotifiedToday(today);
                    } catch (error) {
                        console.warn('标记每日通知状态失败:', error);
                        // 标记失败不影响主要功能，只记录警告
                    }
                }
            }

            // 更新徽章
            this.updateBadges();

        } catch (error) {
            console.error("检查提醒失败:", error);
        }
    }

    // 检查单个时间提醒
    private async checkTimeReminders(reminderData: any, today: string, currentTime: string) {
        try {
            const { writeReminderData } = await import("./api");
            const { generateRepeatInstances } = await import("./utils/repeatUtils");
            let dataChanged = false;

            for (const [reminderId, reminder] of Object.entries(reminderData)) {
                if (!reminder || typeof reminder !== 'object') continue;

                const reminderObj = reminder as any;

                // 跳过已完成或没有时间的提醒
                if (reminderObj.completed) continue;

                // 处理普通提醒
                if (!reminderObj.repeat?.enabled) {
                    // 普通（非重复）提醒：按字段分别处理 time 和 customReminderTime，并独立记录两者的已提醒状态

                    // 计算任务的起止范围（用于跨天提醒）
                    const startDate = reminderObj.date || today;
                    const endDate = reminderObj.endDate || reminderObj.date || startDate;
                    const inDateRange = startDate <= today && today <= endDate;

                    // 检查 time 提醒（支持跨天：如果 today 在 startDate..endDate 范围内，则每天在该时间提醒）
                    if (reminderObj.time && inDateRange) {
                        if (this.shouldNotifyNow(reminderObj, today, currentTime, 'time', true)) {
                            console.debug('checkTimeReminders - triggering time reminder', { id: reminderObj.id, date: reminderObj.date, time: reminderObj.time });
                            await this.showTimeReminder(reminderObj, 'time');
                            if (!reminderObj.notifiedTime) reminderObj.notifiedTime = true;
                            dataChanged = true;
                        }
                    }

                    // 检查 customReminderTime 提醒（对于跨天任务也应在每一天生效，直到 endDate 过期）
                    if (reminderObj.customReminderTime) {
                        // 如果 customReminderTime 带有具体日期（YYYY-MM-DD），则仅在该日期触发；否则按 inDateRange 检查
                        const parsedCustom = this.extractDateAndTime(reminderObj.customReminderTime);
                        const customHasDate = !!parsedCustom.date;
                        const shouldCheckRange = customHasDate ? (parsedCustom.date === today) : inDateRange;
                        if (shouldCheckRange) {
                            if (this.shouldNotifyNow(reminderObj, today, currentTime, 'customReminderTime', true)) {
                                console.debug('checkTimeReminders - triggering customReminderTime reminder', { id: reminderObj.id, date: reminderObj.date, customReminderTime: reminderObj.customReminderTime });
                                await this.showTimeReminder(reminderObj, 'customReminderTime');
                                if (!reminderObj.notifiedCustomTime) reminderObj.notifiedCustomTime = true;
                                dataChanged = true;
                            }
                        }
                    }

                    // 更新总体的 notified 标志（仅在非重复任务上使用），只有在所有应被提醒的时间都已提醒且都已过时，才设为 true
                    const overallChanged = this.updateOverallNotifiedFlag(reminderObj, today, currentTime);
                    if (overallChanged) dataChanged = true;
                } else {
                    // 处理重复提醒
                    const instances = generateRepeatInstances(reminderObj, today, today);

                    for (const instance of instances) {
                        // 检查实例是否需要提醒（对于重复实例，不依赖 reminderObj 的 notified 字段，而使用 repeat.notifiedInstances 去重）
                        // 时间提醒
                        if (instance.time && this.shouldNotifyNow(instance, today, currentTime, 'time', false)) {
                            const notifiedInstances = reminderObj.repeat?.notifiedInstances || [];
                            const instanceKey = `${instance.date}_${instance.time}`;
                            if (!notifiedInstances.includes(instanceKey)) {
                                console.debug('checkTimeReminders - triggering repeat instance time reminder', { id: instance.id, date: instance.date, time: instance.time });
                                await this.showTimeReminder(instance, 'time');
                                if (!reminderObj.repeat) reminderObj.repeat = {};
                                if (!reminderObj.repeat.notifiedInstances) reminderObj.repeat.notifiedInstances = [];
                                reminderObj.repeat.notifiedInstances.push(instanceKey);
                                dataChanged = true;
                            }
                        }

                        // customReminderTime 实例提醒
                        if (instance.customReminderTime) {
                            const parsedCustomInst = this.extractDateAndTime(instance.customReminderTime);
                            if (parsedCustomInst.date && parsedCustomInst.date !== instance.date) {
                                // customReminderTime 指定了不同日期，不在此实例触发
                            } else {
                                if (this.shouldNotifyNow(instance, today, currentTime, 'customReminderTime', false)) {
                                    const notifiedInstances = reminderObj.repeat?.notifiedInstances || [];
                                    const instanceKey = `${instance.date}_${instance.customReminderTime}`;
                                    if (!notifiedInstances.includes(instanceKey)) {
                                        console.debug('checkTimeReminders - triggering repeat instance customReminderTime reminder', { id: instance.id, date: instance.date, customReminderTime: instance.customReminderTime });
                                        await this.showTimeReminder(instance, 'customReminderTime');
                                        if (!reminderObj.repeat) reminderObj.repeat = {};
                                        if (!reminderObj.repeat.notifiedInstances) reminderObj.repeat.notifiedInstances = [];
                                        reminderObj.repeat.notifiedInstances.push(instanceKey);
                                        dataChanged = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 如果数据有变化，保存到文件
            if (dataChanged) {
                await writeReminderData(reminderData);
            }

        } catch (error) {
            console.error('检查时间提醒失败:', error);
        }
    }

    // 判断是否应该现在提醒
    private shouldNotifyNow(reminder: any, today: string, currentTime: string, timeField: 'time' | 'customReminderTime' = 'time', checkNotified: boolean = true): boolean {
        // 不在此处强制检查日期，调用方负责判断提醒是否在当天或范围内。

        // 必须有时间字段
        if (!reminder[timeField]) return false;

        // 如果需要检查已提醒标志，则基于字段级别进行判断（time / customReminderTime）
        if (checkNotified) {
            if (timeField === 'time' && reminder.notifiedTime) return false;
            if (timeField === 'customReminderTime' && reminder.notifiedCustomTime) return false;
        }

        // 比较当前时间和提醒时间（支持带日期的自定义提醒）
        const rawReminderTime = reminder[timeField];
        const parsed = this.extractDateAndTime(rawReminderTime);

        // 如果提醒时间包含日期并且不是今天，则不触发
        if (parsed.date && parsed.date !== today) {
            console.debug('shouldNotifyNow - date does not match today, skip', parsed.date, 'today:', today, 'id:', reminder.id, 'field:', timeField);
            return false;
        }

        // 如果没有有效的 time 部分（比如只有日期，或解析失败），则视为非时间提醒，不触发此函数
        if (!parsed.time) {
            console.debug('shouldNotifyNow - no valid time component, skip', rawReminderTime, 'id:', reminder.id);
            return false;
        }

        const currentTimeNumber = this.timeStringToNumber(currentTime);
        const reminderTimeNumber = this.timeStringToNumber(rawReminderTime);
        // 当前时间必须达到或超过提醒时间
        const shouldNotify = currentTimeNumber >= reminderTimeNumber;
        if (shouldNotify) {
            console.debug('shouldNotifyNow - trigger:', timeField, 'reminderId:', reminder.id, 'currentTime:', currentTime, 'reminderTime:', reminder[timeField]);
        }
        return shouldNotify;
    }

    /**
     * 更新非重复任务的总体 notified 标志。
     * 规则：
     * - 如果有 time 和 customReminderTime，只有两者都已被对应标记为已提醒（notifiedTime/notifiedCustomTime）且两者时间都已过时，才将 notified 设为 true。
     * - 如果只有其中一个时间存在，则以该字段的已提醒状态为准（并确保该时间已过去）。
     * - 对于跨多天任务（有 endDate），只有当 endDate 是过去时间时，才允许设置 notified 为 true。
     * 返回是否发生了变更（用于持久化判断）。
     */
    private updateOverallNotifiedFlag(reminder: any, today: string, currentTime: string): boolean {
        const prev = !!reminder.notified;

        // 对于跨多天任务，只有当 endDate 是过去时间时，才允许设置 notified
        if (reminder.endDate && compareDateStrings(reminder.endDate, today) >= 0) {
            reminder.notified = false;
            return prev !== false;
        }

        const hasTime = !!reminder.time;
        const hasCustom = !!reminder.customReminderTime;

        const currentNum = this.timeStringToNumber(currentTime);

        let now = false;

        const checkPassed = (field: string | null): boolean => {
            if (!field) return false;
            const raw = reminder[field];
            const parsed = this.extractDateAndTime(raw);
            const fieldTimeNum = this.timeStringToNumber(raw || '00:00');
            // 如果带日期
            if (parsed.date) {
                const dateCompare = compareDateStrings(parsed.date, today);
                if (dateCompare < 0) return true; // 已过
                if (dateCompare > 0) return false; // 未来
                // 等于今天，按时间比较
                return currentNum >= fieldTimeNum;
            }
            // 不带日期，按时间比较
            return currentNum >= fieldTimeNum;
        };

        if (hasTime && hasCustom) {
            const timeNum = this.timeStringToNumber(reminder.time || '00:00');
            const customNum = this.timeStringToNumber(reminder.customReminderTime || '00:00');
            const timeNotified = !!reminder.notifiedTime;
            const customNotified = !!reminder.notifiedCustomTime;
            if (timeNotified && customNotified && checkPassed('time') && checkPassed('customReminderTime')) {
                now = true;
            } else {
                now = false;
            }
        } else if (hasTime) {
            const timeNum = this.timeStringToNumber(reminder.time || '00:00');
            const timePassed = checkPassed('time');
            now = !!reminder.notifiedTime && timePassed;
        } else if (hasCustom) {
            const customPassed = checkPassed('customReminderTime');
            now = !!reminder.notifiedCustomTime && customPassed;
        } else {
            now = false;
        }

        reminder.notified = now;
        return prev !== now;
    }

    // 时间字符串转换为数字便于比较 (HH:MM -> HHMM)
    private extractDateAndTime(value?: string): { date?: string | null, time?: string | null } {
        if (!value || typeof value !== 'string') return { date: null, time: null };
        if (value.includes('T')) {
            const [datePart, timePart] = value.split('T');
            if (!timePart) return { date: datePart, time: null };
            const time = timePart.split(':').slice(0, 2).join(':');
            return { date: datePart, time };
        }
        if (value.includes(' ')) {
            const [datePart, timePart] = value.split(' ');
            const time = (timePart || '').split(':').slice(0, 2).join(':') || null;
            return { date: datePart, time };
        }
        if (value.split(':').length >= 2) {
            return { date: null, time: value.split(':').slice(0, 2).join(':') };
        }
        return { date: null, time: null };
    }

    // 时间字符串转换为数字便于比较 (HH:MM -> HHMM)，支持带日期的字符串
    private timeStringToNumber(timeString: string): number {
        if (!timeString) return 0;
        const { time } = this.extractDateAndTime(timeString) || { time: null };
        if (!time) return 0;
        const parts = time.split(':');
        if (parts.length < 2) return 0;
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        if (isNaN(hours) || isNaN(minutes)) return 0;
        return hours * 100 + minutes;
    }

    /**
     * 检查习惯是否在给定日期应该打卡（基于 HabitPanel 的实现复制）
     */
    private shouldCheckHabitOnDate(habit: any, date: string): boolean {
        const frequency = habit.frequency || { type: 'daily' };
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

    private isHabitCompletedOnDate(habit: any, date: string): boolean {
        const checkIn = habit.checkIns?.[date];
        if (!checkIn) return false;
        return (checkIn.count || 0) >= (habit.target || 1);
    }

    // 检查习惯的时间提醒并触发通知
    private async checkHabitReminders(today: string, currentTime: string) {
        try {
            const { readHabitData, hasHabitNotified, markHabitNotified } = await import('./api');

            const habitData = await readHabitData();
            if (!habitData || typeof habitData !== 'object') return;

            const currentNum = this.timeStringToNumber(currentTime);
            let playSoundOnce = false;

            for (const habit of Object.values(habitData) as any[]) {
                try {
                    if (!habit || typeof habit !== 'object') continue;

                    // 需要设置 reminderTime 才会被触发
                    if (!habit.reminderTime) continue;

                    // 如果不在起止日期内，跳过
                    if (habit.startDate && habit.startDate > today) continue;
                    if (habit.endDate && habit.endDate < today) continue;

                    // 频率检查
                    if (!this.shouldCheckHabitOnDate(habit, today)) continue;

                    // 如果今日已经打卡完成，则不再提醒
                    if (this.isHabitCompletedOnDate(habit, today)) continue;

                    const parsed = this.extractDateAndTime(habit.reminderTime);
                    if (parsed.date && parsed.date !== today) continue;
                    const habitTimeNum = this.timeStringToNumber(habit.reminderTime);
                    if (habitTimeNum === 0) continue; // 无法解析的时间

                    // 需要现在到或超过提醒时间
                    if (currentNum < habitTimeNum) continue;

                    const alreadyNotified = await hasHabitNotified(habit.id, today);
                    if (alreadyNotified) continue;

                    // 触发通知（仅第一次触发时播放音效）
                    if (!playSoundOnce) {
                        await this.playNotificationSound();
                        playSoundOnce = true;
                    }

                    // 构建提醒信息并显示内部通知对话框
                    const reminderInfo = {
                        id: habit.id,
                        blockId: habit.blockId || '',
                        title: habit.title || t('unnamedNote'),
                        note: habit.note || '',
                        priority: habit.priority || 'none',
                        categoryId: habit.groupId || undefined,
                        time: parsed.time || habit.reminderTime,
                        date: today,
                        isAllDay: false
                    };

                    // 显示思源内部通知
                    NotificationDialog.show(reminderInfo as any);

                    // 显示系统弹窗（如果启用）
                    const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();
                    if (systemNotificationEnabled) {
                        const title = `⏰ ${t('habitReminder')}: ${reminderInfo.title}`;
                        const message = `${reminderInfo.time}`.trim();
                        this.showReminderSystemNotification(title, message, reminderInfo);
                    }

                    // 标记已通知，避免重复通知
                    try {
                        await markHabitNotified(habit.id, today);
                    } catch (err) {
                        console.warn('标记习惯通知失败', habit.id, today, err);
                    }
                } catch (err) {
                    console.warn('处理单个习惯时出错', err);
                }
            }
        } catch (error) {
            console.error('检查习惯提醒失败:', error);
        }
    }
    // 显示时间提醒
    private async showTimeReminder(reminder: any, triggerField: 'time' | 'customReminderTime' = 'time') {
        try {
            // 播放通知声音
            await this.playNotificationSound();

            // 获取分类信息
            let categoryInfo = {};
            if (reminder.categoryId) {
                const category = this.categoryManager.getCategoryById(reminder.categoryId);
                if (category) {
                    categoryInfo = {
                        categoryName: category.name,
                        categoryColor: category.color,
                        categoryIcon: category.icon
                    };
                }
            }

            const rawChosenTime = (triggerField === 'customReminderTime') ? reminder.customReminderTime : reminder.time;
            const displayChosen = this.extractDateAndTime(rawChosenTime)?.time || rawChosenTime || reminder.time || reminder.customReminderTime;
            const reminderInfo = {
                id: reminder.id,
                blockId: reminder.blockId,
                title: reminder.title || t("unnamedNote"),
                note: reminder.note,
                priority: reminder.priority || 'none',
                categoryId: reminder.categoryId,
                // 使用仅时间部分用于显示，若无则回退到原始字段
                time: displayChosen || reminder.time || reminder.customReminderTime,
                date: reminder.date,
                endDate: reminder.endDate,
                isAllDay: false,
                isOverdue: false,
                ...categoryInfo
            };

            // 始终显示思源内部通知对话框
            // 记录触发字段，方便调试与后续显示一致性处理
            try { (reminderInfo as any)._triggerField = triggerField; } catch (e) { }
            console.debug('showTimeReminder - triggering internal dialog', {
                id: reminderInfo.id,
                triggerField,
                chosenTime: reminderInfo.time,
                date: reminderInfo.date
            });
            NotificationDialog.show(reminderInfo);

            // 检查是否启用系统弹窗通知
            const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();

            // 如果启用了系统弹窗，同时也显示系统通知
            if (systemNotificationEnabled) {
                const title = '⏰ ' + t("timeReminderNotification");
                const categoryText = (categoryInfo as any).categoryName ? ` [${(categoryInfo as any).categoryName}]` : '';
                let timeText = '';
                if (displayChosen) {
                    timeText = ` ⏰${displayChosen}`;
                } else if (triggerField === 'time' && reminder.time) {
                    const dt = this.extractDateAndTime(reminder.time);
                    timeText = ` ${dt.time || reminder.time}`;
                } else if (reminder.customReminderTime) {
                    const dt = this.extractDateAndTime(reminder.customReminderTime);
                    timeText = ` ⏰${dt.time || reminder.customReminderTime}`;
                }
                const message = `${reminderInfo.title}${categoryText}${timeText}`;

                this.showReminderSystemNotification(title, message, reminderInfo);
            }

        } catch (error) {
            console.error('显示时间提醒失败:', error);
        }
    }

    /**
     * 显示系统弹窗通知（参考番茄钟的实现）
     * @param title 通知标题
     * @param message 通知消息
     * @param reminderInfo 提醒信息（可选，用于点击跳转）
     */
    private showReminderSystemNotification(title: string, message: string, reminderInfo?: any) {
        try {
            if ('Notification' in window && Notification.permission === 'granted') {
                // 使用浏览器通知
                const notification = new Notification(title, {
                    body: message,
                    requireInteraction: true,
                    silent: false, // 使用我们自己的音频
                });

                // 点击通知时的处理
                notification.onclick = () => {
                    window.focus();
                    notification.close();

                    // 如果有提醒信息，跳转到相关块
                    if (reminderInfo && reminderInfo.blockId) {
                        try {
                            import("./api").then(({ openBlock }) => {
                                openBlock(reminderInfo.blockId);
                            });
                        } catch (error) {
                            console.warn('跳转到块失败:', error);
                        }
                    }
                };


            } else if ('Notification' in window && Notification.permission === 'default') {
                // 请求通知权限
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        // 权限获取成功，递归调用显示通知
                        this.showReminderSystemNotification(title, message, reminderInfo);
                    }
                });
            }
        } catch (error) {
            console.warn('显示系统弹窗失败:', error);
        }
    }

    // 打开日历视图标签页
    openCalendarTab(data?: { projectFilter?: string }) {
        const isMobile = getFrontend().endsWith('mobile');

        if (isMobile) {
            // 手机端：使用Dialog打开日历视图
            const dialog = new Dialog({
                title: t("calendarView"),
                content: '<div id="mobileCalendarContainer" style="height: 100%; width: 100%;"></div>',
                width: "95vw",
                height: "90vh",
                destroyCallback: () => {
                    // 清理日历视图实例
                    const calendarContainer = dialog.element.querySelector('#mobileCalendarContainer') as HTMLElement;
                    if (calendarContainer && (calendarContainer as any)._calendarView) {
                        const calendarView = (calendarContainer as any)._calendarView;
                        if (typeof calendarView.destroy === 'function') {
                            calendarView.destroy();
                        }
                    }
                }
            });

            // 在Dialog中创建日历视图
            const calendarContainer = dialog.element.querySelector('#mobileCalendarContainer') as HTMLElement;
            if (calendarContainer) {
                const calendarView = new CalendarView(calendarContainer, this, data);
                // 保存实例引用用于清理
                (calendarContainer as any)._calendarView = calendarView;
            }
        } else {
            // 桌面端：使用Tab打开日历视图
            openTab({
                app: this.app,
                custom:
                {
                    title: t("calendarView"),
                    icon: 'iconCalendar',
                    id: this.name + TAB_TYPE,
                    data: data || {}
                }
            });
        }
    }

    // 打开项目看板标签页
    openProjectKanbanTab(projectId: string, projectTitle: string) {
        const isMobile = getFrontend().endsWith('mobile');

        if (isMobile) {
            // 手机端：使用Dialog打开项目看板
            const dialog = new Dialog({
                title: projectTitle,
                content: '<div id="mobileProjectKanbanContainer" style="height: 100%; width: 100%;"></div>',
                width: "95vw",
                height: "90vh",
                destroyCallback: () => {
                    // 清理项目看板实例
                    const kanbanContainer = dialog.element.querySelector('#mobileProjectKanbanContainer') as HTMLElement;
                    if (kanbanContainer && (kanbanContainer as any)._projectKanbanView) {
                        const projectKanbanView = (kanbanContainer as any)._projectKanbanView;
                        if (typeof projectKanbanView.destroy === 'function') {
                            projectKanbanView.destroy();
                        }
                    }
                }
            });

            // 在Dialog中创建项目看板
            const kanbanContainer = dialog.element.querySelector('#mobileProjectKanbanContainer') as HTMLElement;
            if (kanbanContainer) {
                const projectKanbanView = new ProjectKanbanView(kanbanContainer, this, projectId);
                // 保存实例引用用于清理
                (kanbanContainer as any)._projectKanbanView = projectKanbanView;
            }
        } else {
            // 桌面端：使用Tab打开项目看板
            openTab({
                app: this.app,
                custom: {
                    title: projectTitle,
                    icon: "iconProject",
                    id: this.name + PROJECT_KANBAN_TAB_TYPE,
                    data: {
                        projectId: projectId,
                        projectTitle: projectTitle
                    }
                }
            });
        }
    }

    // 打开四象限矩阵标签页
    openEisenhowerMatrixTab() {
        const isMobile = getFrontend().endsWith('mobile');

        if (isMobile) {
            // 手机端：使用Dialog打开四象限矩阵
            const dialog = new Dialog({
                title: t("eisenhowerMatrix"),
                content: '<div id="mobileEisenhowerContainer" style="height: 100%; width: 100%;"></div>',
                width: "95vw",
                height: "90vh",
                destroyCallback: () => {
                    // 清理四象限矩阵实例
                    const eisenhowerContainer = dialog.element.querySelector('#mobileEisenhowerContainer') as HTMLElement;
                    if (eisenhowerContainer && (eisenhowerContainer as any)._eisenhowerView) {
                        const eisenhowerView = (eisenhowerContainer as any)._eisenhowerView;
                        if (typeof eisenhowerView.destroy === 'function') {
                            eisenhowerView.destroy();
                        }
                    }
                }
            });

            // 在Dialog中创建四象限矩阵视图
            const eisenhowerContainer = dialog.element.querySelector('#mobileEisenhowerContainer') as HTMLElement;
            if (eisenhowerContainer) {
                const eisenhowerView = new EisenhowerMatrixView(eisenhowerContainer, this);
                // 保存实例引用用于清理
                (eisenhowerContainer as any)._eisenhowerView = eisenhowerView;
                // 初始化视图
                eisenhowerView.initialize();
            }
        } else {
            // 桌面端：使用Tab打开四象限矩阵
            openTab({
                app: this.app,
                custom: {
                    title: t("eisenhowerMatrix"),
                    icon: "iconGrid",
                    id: this.name + EISENHOWER_TAB_TYPE,
                    data: {}
                }
            });
        }
    }

    private async addBreadcrumbReminderButton(protyle: any) {
        if (!protyle || !protyle.element) return;

        const breadcrumb = protyle.element.querySelector('.protyle-breadcrumb');
        if (!breadcrumb) return;

        // 查找文档按钮
        const docButton = breadcrumb.querySelector('button[data-type="doc"]');
        if (!docButton) return;


        // --- Project Button ---
        const documentId = protyle.block?.rootID;
        if (!documentId) return;

        const { readProjectData } = await import("./api");
        const projectData = await readProjectData();
        const isProject = projectData && projectData.hasOwnProperty(documentId);

        const existingProjectButton = breadcrumb.querySelector('.project-breadcrumb-btn');
        if (isProject) {
            if (!existingProjectButton) {
                const projectBtn = document.createElement('button');
                projectBtn.className = 'project-breadcrumb-btn block__icon fn__flex-center ariaLabel';
                projectBtn.setAttribute('aria-label', t("projectManagement"));
                projectBtn.innerHTML = `<svg class="b3-list-item__graphic"><use xlink:href="#iconProject"></use></svg>`;
                projectBtn.style.cssText = `
                    margin-right: 4px;
                    padding: 4px;
                    border: none;
                    background: transparent;
                    cursor: pointer;
                    border-radius: 4px;
                    color: var(--b3-theme-on-background);
                    opacity: 0.7;
                    transition: all 0.2s ease;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 24px;
                    height: 24px;
                `;

                projectBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openProjectKanbanTab(
                        projectData[documentId].blockId,
                        projectData[documentId].title
                    );
                });
                breadcrumb.insertBefore(projectBtn, docButton);
            }
        } else {
            if (existingProjectButton) {
                existingProjectButton.remove();
            }
        }

    }

    /**
     * 在当前 protyle 的每个块旁边（protyle-attr）添加项目打开按钮
     */
    private async addBlockProjectButtonsToProtyle(protyle: any) {
        try {
            if (!protyle || !protyle.element) return;
            // 仅扫描那些具有自定义项目属性的节点，避免遍历所有块导致性能问题
            const projectSelector = [
                'div[data-node-id][custom-task-projectid]',
                '.protyle-wysiwyg[custom-task-projectid]',
            ].join(',');
            // allBlocks 为只包含带有 custom-task-projectid 的块（或与之关联的块）
            const allBlocks = protyle.element.querySelectorAll(projectSelector);

            // 提前扫描包含 custom-task-projectid 的块（仅支持两种渲染方式）
            // - 普通块的 div[data-node-id] 元素上的属性
            // - 文档的 .protyle-wysiwyg 元素上的属性（文档级别）
            const blocksWithProjectAttrSet = new Set<string>();
            const blockAttrMap = new Map<string, string>();
            // 预扫描具有 custom-task-projectid 的节点，并构建块 ID 与原始属性映射
            try {
                const nodes = protyle.element.querySelectorAll(projectSelector);
                nodes.forEach(n => {
                    const el = n as Element;
                    // 确定块ID（优先使用 data-node-id；若为 .protyle-wysiwyg，尝试查找最近的 data-node-id）
                    // 首先尝试读取当前节点自身的 data-node-id
                    let id = el.getAttribute('data-node-id') || null;
                    // 如果节点是 protyle-wysiwyg，但没有 data-node-id，则尝试通过其前一个兄弟节点 .protyle-top 的 .protyle-title 获取 data-node-id
                    if (!id && el.classList && el.classList.contains('protyle-wysiwyg')) {
                        const prev = el.previousElementSibling as Element | null;
                        if (prev && prev.classList && prev.classList.contains('protyle-top')) {
                            const titleEl = prev.querySelector('.protyle-title') as Element | null;
                            if (titleEl) {
                                id = titleEl.getAttribute('data-node-id') || titleEl.closest('[data-node-id]')?.getAttribute('data-node-id') || null;
                            }
                        }
                    }
                    // 如果仍然没有，回退到查找祖先带 data-node-id 的元素
                    if (!id) {
                        id = el.closest('[data-node-id]')?.getAttribute('data-node-id') || null;
                    }
                    if (!id) return;

                    // 获取原始属性值
                    const rawAttr = el.getAttribute('custom-task-projectid');
                    if (!rawAttr) return;

                    blocksWithProjectAttrSet.add(id);
                    blockAttrMap.set(id, rawAttr);
                });
            } catch (err) {
                console.debug('addBlockProjectButtonsToProtyle - scanning for project attrs failed', err);
            }
            // 移除在 DOM 中已存在但当前未设置属性的旧按钮（处理属性已删除的场景）
            try {
                const existingButtonsGlobal = protyle.element.querySelectorAll('.block-project-btn');
                existingButtonsGlobal.forEach(btn => {
                    // 优先使用按钮上的 data-block-id（由本函数创建时设置），其次回退到查找最近的 [data-node-id]
                    const bidFromDataset = (btn as HTMLElement).dataset.blockId || null;
                    const blockEl = btn.closest('[data-node-id]');
                    const bidFromDom = blockEl ? blockEl.getAttribute('data-node-id') : null;
                    const bid = bidFromDataset || bidFromDom;

                    // 如果无法解析出关联的 block id 或该 block id 当前不再含有 custom-task-projectid，则移除该按钮
                    if (!bid || !blocksWithProjectAttrSet.has(bid)) {
                        try { btn.remove(); } catch (err) { }
                    }
                });
            } catch (err) {
                console.debug('addBlockProjectButtonsToProtyle - remove obsolete project buttons failed', err);
            }
            if (!allBlocks || allBlocks.length === 0) {
                // 没有检测到任何带属性的块，已在全局中清理旧按钮，直接返回
                return;
            }


            // 动态导入 readProjectData 一次，避免在循环里重复导入
            const { readProjectData } = await import('./api');

            // 遍历可见的块元素
            // 如果allBlocks由projectSelector构建，则其中的元素可能是 protyle-wysiwyg（document-level attr）或具体块
            for (const node of Array.from(allBlocks) as Element[]) {
                // 尝试解析块ID（优先使用 node 自身的 data-node-id，如果没有则查找最近的父块）
                // 尝试按优先级获取块ID：元素自身的 data-node-id -> 如果为 protyle-wysiwyg，查找前一个兄弟节点的 protyle-title 的 data-node-id -> 最近的祖先 [data-node-id]
                let blockId = node.getAttribute('data-node-id') || null;
                if (!blockId && node.classList && node.classList.contains('protyle-wysiwyg')) {
                    const prev = node.previousElementSibling as Element | null;
                    if (prev && prev.classList && prev.classList.contains('protyle-top')) {
                        const titleEl = prev.querySelector('.protyle-title') as Element | null;
                        if (titleEl) {
                            blockId = titleEl.getAttribute('data-node-id') || titleEl.closest('[data-node-id]')?.getAttribute('data-node-id') || null;
                        }
                    }
                }
                if (!blockId) {
                    blockId = node.closest('[data-node-id]')?.getAttribute('data-node-id') || null;
                }
                if (!blockId) continue;

                // 如果此 block 正在处理，跳过避免重复添加
                if (this.processingBlockButtons.has(blockId)) {
                    console.debug('addBlockProjectButtonsToProtyle - block is already processing, skipping', blockId);
                    continue;
                }

                // 标记为正在处理，确保后续并发调用被跳过
                this.processingBlockButtons.add(blockId);
                try {

                    // 查找实际的块元素（在某些情况下 node 可能是 protyle-wysiwyg）
                    const blockEl = protyle.element.querySelector('[data-node-id="' + blockId + '"]') as Element | null;
                    if (!blockEl) {
                        // 如果无法定位具体块元素，则跳过
                        this.processingBlockButtons.delete(blockId);
                        continue;
                    }

                    // 获取现有按钮（支持多项目）
                    const existingButtons = Array.from(blockEl.querySelectorAll('.block-project-btn')) as HTMLElement[];
                    // 如果该块没有 project attr 并且也没有已存在的 project btn，则跳过，减少DOM处理
                    // 如果块没有project属性且没有现有按钮，则跳过
                    if (!blocksWithProjectAttrSet.has(blockId) && existingButtons.length === 0) {
                        this.processingBlockButtons.delete(blockId);
                        continue;
                    }

                    // 通过 DOM 获取块的 projectId（仅支持两种渲染方式）
                    // 取值优先级： pre-scanned map -> dom data-* 属性 -> 自定义属性
                    const projectIdsFromAttr: string[] = [];
                    const rawAttr = blockAttrMap.get(blockId) || (blockEl as HTMLElement).getAttribute('custom-task-projectid');
                    if (rawAttr) {
                        const spl = String(rawAttr).split(',').map(s => s.trim()).filter(s => s);
                        projectIdsFromAttr.push(...spl);
                    }
                    let projectIds: string[] = Array.isArray(projectIdsFromAttr) ? projectIdsFromAttr : [];
                    // 如果没有找到 projectIds，则保持空数组（不使用 API 或 reminderData 回退）
                    // 调试日志：帮助定位为何某些块没有按钮显示
                    console.debug('addBlockProjectButtonsToProtyle - blockId:', blockId, 'detectedProjectIds:', projectIds, 'existingBtnCount:', existingButtons.length);

                    // 如果没有projectId而存在旧按钮，移除按钮
                    // 如果没有projectId则移除所有按钮（不要回退到 reminderData）
                    if (!projectIds || projectIds.length === 0) {
                        // 没有任何项目关联，移除所有按钮
                        existingButtons.forEach(btn => btn.remove());
                        continue;
                    }
                    // 现在 projectIds 包含要显示的项目ID数组
                    const desiredIds = Array.from(new Set(projectIds));

                    // 移除不在 desiredIds 中的现有按钮
                    existingButtons.forEach(btn => {
                        const pid = btn.dataset.projectId;
                        // 如果没有 projectId (旧的按钮)，直接移除
                        if (!pid) {
                            btn.remove();
                            return;
                        }
                        // 如果按钮不在现在需要显示的 desiredIds 中，移除
                        if (!desiredIds.includes(pid)) {
                            btn.remove();
                        }
                    });

                    // 去重：如果某个 pid 存在多个按钮实例，只保留第一个，其余移除
                    const dedupeMap: Record<string, HTMLElement[]> = {};
                    const currentButtons = Array.from(blockEl.querySelectorAll('.block-project-btn')) as HTMLElement[];
                    currentButtons.forEach(btn => {
                        const pid = btn.dataset.projectId || '';
                        if (!pid) return;
                        if (!dedupeMap[pid]) dedupeMap[pid] = [];
                        dedupeMap[pid].push(btn);
                    });
                    Object.keys(dedupeMap).forEach(pid => {
                        const group = dedupeMap[pid];
                        if (group.length > 1) {
                            // 保留第一个，删除后续的
                            for (let i = 1; i < group.length; i++) {
                                try { group[i].remove(); } catch (err) { }
                            }
                        }
                    });

                    // 寻找属性容器：区分 文档级（protyle-wysiwyg）与普通块
                    // - 普通块：优先使用块内的 `div.protyle-attr`
                    // - 文档级：将按钮添加到 protyle 顶部标题区域的 `.protyle-title.protyle-wysiwyg--attr` 的 `protyle-attr`（如存在）
                    let container: HTMLElement | null = null;

                    const isDocumentLevelNode = node.classList && node.classList.contains('protyle-wysiwyg');

                    if (isDocumentLevelNode) {
                        // 文档级属性：尝试在 protyle 顶部 title 的特殊类中插入
                        try {
                            const protyleRoot = (protyle && protyle.element) ? protyle.element as HTMLElement : null;
                            if (protyleRoot) {
                                // 优先匹配带有 protyle-wysiwyg--attr 标识的 title（用于 document-level attr 的 UI）
                                const titleElement = protyleRoot.querySelector('.protyle-top .protyle-title.protyle-wysiwyg--attr') as HTMLElement
                                    || protyleRoot.querySelector('.protyle-top .protyle-title') as HTMLElement | null;
                                if (titleElement) {
                                    container = titleElement.querySelector('div.protyle-attr') as HTMLElement | null
                                        || titleElement;
                                }
                            }
                        } catch (err) {
                            console.debug('addBlockProjectButtonsToProtyle - find document title container failed', err);
                        }
                    } else {
                        // 普通块：优先使用块内部的 protyle-attr，其次尝试 title 区域，最后回退到首个子元素
                        const attrElement = blockEl.querySelector('div.protyle-attr') as HTMLElement | null;
                        if (attrElement) {
                            container = attrElement;
                        } else {
                            const titleElement = blockEl.querySelector('.protyle-title') as HTMLElement | null;
                            if (titleElement) {
                                container = titleElement;
                            } else {
                                container = blockEl.firstElementChild as HTMLElement | null;
                            }
                        }
                    }

                    // 创建新的按钮（为每个新 projectId）
                    for (const pid of desiredIds) {
                        // 只在当前 block 范围内检查是否已有相同 pid 的按钮，允许 protyle 中不同块均有同一 project 的按钮
                        if (protyle.element.querySelector('.block-project-btn[data-project-id="' + pid + '"][data-block-id="' + blockId + '"]')) {
                            console.debug('addBlockProjectButtonsToProtyle - existing button found for this block, skipping create', pid, blockId);
                            continue;
                        }
                        const btn = document.createElement('button');
                        btn.className = 'block-project-btn block__icon fn__flex-center ariaLabel';
                        btn.setAttribute('aria-label', '打开项目看板');
                        btn.style.cssText = `
                        margin-left: 6px;
                        padding: 2px;
                        border: none;
                        background: transparent;
                        cursor: pointer;
                        border-radius: 3px;
                        color: var(--b3-theme-on-background);
                        opacity: 0.85;
                        transition: all 0.12s ease;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        width: 22px;
                        height: 22px;
                    `;
                        btn.innerHTML = `<svg class="b3-list-item__graphic" style="width:14px;height:14px"><use xlink:href="#iconProject"></use></svg>`;
                        btn.className = 'block-project-btn block__icon fn__flex-center ariaLabel';
                        btn.setAttribute('aria-label', '打开项目看板');
                        btn.style.cssText = `
                    margin-left: 6px;
                    padding: 2px;
                    border: none;
                    background: transparent;
                    cursor: pointer;
                    border-radius: 3px;
                    color: var(--b3-theme-on-background);
                    opacity: 0.85;
                    transition: all 0.12s ease;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 22px;
                    height: 22px;
                `;
                        btn.innerHTML = `<svg class="b3-list-item__graphic" style="width:14px;height:14px"><use xlink:href="#iconProject"></use></svg>`;

                        // 点击事件：打开项目看板
                        btn.addEventListener('click', async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            try {
                                const projectData = await readProjectData();
                                const project = projectData[pid];
                                const title = project ? project.title : pid;
                                this.openProjectKanbanTab(pid, title);
                            } catch (error) {
                                console.error('打开项目看板失败:', error);
                                this.openProjectKanbanTab(pid, pid);
                            }
                        });
                        // 设置data绑定，方便后续判断（同时绑定所属 block id）
                        btn.dataset.projectId = pid;
                        btn.dataset.blockId = blockId;
                        btn.title = t('openProjectKanban');
                        btn.title = t('openProjectKanban');

                        // 将按钮插入到合适的容器（文档级 / 普通块均已选择好 container）
                        if (container) {
                            container.appendChild(btn);
                        } else {
                            // 如果容器为空则直接将按钮追加到整个块元素后（最后回退）
                            blockEl.appendChild(btn);
                        }
                        console.debug('addBlockProjectButtonsToProtyle - button created for blockId:', blockId, 'projectId:', pid);
                    }
                }
                finally {
                    // 确保在任何路径都移除处理标志
                    this.processingBlockButtons.delete(blockId);
                }
            }
        } catch (error) {
            console.error('为块添加项目按钮失败:', error);
        }
    }


    /**
     * 注册快捷键命令
     */
    private registerCommands() {
        // 快捷键：设置当前文档为任务
        this.addCommand({
            langKey: "shortcutSetDocumentAsTask",
            hotkey: "",
            editorCallback: async (protyle: any) => {
                // 获取当前文档ID
                const documentId = protyle?.block?.rootID;
                if (documentId) {
                    const autoDetect = await this.getAutoDetectDateTimeEnabled();
                    try {
                        const { readProjectData } = await import("./api");
                        const projectData = await readProjectData();
                        const projectId = projectData && projectData[documentId] ? projectData[documentId].blockId || projectData[documentId].id : undefined;
                        const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                            blockId: documentId,
                            autoDetectDateTime: autoDetect,
                            defaultProjectId: projectId,
                            mode: 'block',
                            plugin: this
                        });
                        dialog.show();
                    } catch (err) {
                        const dialog = new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                            blockId: documentId,
                            autoDetectDateTime: autoDetect,
                            mode: 'block',
                            plugin: this
                        });
                        dialog.show();
                    }
                }
            },
            callback: () => {
                showMessage(t("selectBlockFirst"), 3000, "info");
            }
        });

        // 快捷键：设置当前块为任务
        this.addCommand({
            langKey: "shortcutSetBlockAsTask",
            hotkey: "",
            editorCallback: async (protyle: any) => {
                // 通过 protyle.element 获取编辑器元素，然后查找选中的块
                if (!protyle || !protyle.element) {
                    showMessage(t("selectBlockFirst"), 3000, "info");
                    return;
                }

                const selectedBlocks = protyle.element.querySelectorAll('.protyle-wysiwyg--select');

                if (selectedBlocks && selectedBlocks.length > 0) {
                    // 获取所有选中块的 ID
                    const blockIds = Array.from(selectedBlocks)
                        .map((el: Element) => el.getAttribute('data-node-id'))
                        .filter((id: string | null): id is string => id !== null);

                    if (blockIds.length > 0) {
                        await this.handleMultipleBlocks(blockIds);
                    } else {
                        showMessage(t("selectBlockFirst"), 3000, "info");
                    }
                } else {
                    // 如果没有选中块，获取当前光标所在的块
                    const currentBlock = protyle.element.querySelector('.protyle-wysiwyg [data-node-id].protyle-wysiwyg--hl');
                    if (currentBlock) {
                        const blockId = currentBlock.getAttribute('data-node-id');
                        if (blockId) {
                            await this.handleMultipleBlocks([blockId]);
                            return;
                        }
                    }
                    showMessage(t("selectBlockFirst"), 3000, "info");
                }
            },
            callback: () => {
                showMessage(t("selectBlockFirst"), 3000, "info");
            }
        });

        // 快捷键：设置项目管理
        this.addCommand({
            langKey: "shortcutProjectManagement",
            hotkey: "",
            editorCallback: async (protyle: any) => {
                const documentId = protyle?.block?.rootID;
                if (documentId) {
                    const { readProjectData } = await import("./api");
                    const projectData = await readProjectData();
                    const isProject = projectData && projectData.hasOwnProperty(documentId);

                    if (isProject) {
                        // 打开项目看板
                        this.openProjectKanbanTab(
                            projectData[documentId].blockId,
                            projectData[documentId].title
                        );
                    } else {
                        const dialog = new ProjectDialog(documentId);
                        dialog.show();
                    }
                }
            },
            callback: () => {
                showMessage(t("selectBlockFirst"), 3000, "info");
            }
        });


    }

    onunload() {
        console.log("Reminder Plugin unloaded");

        // 清理广播通信
        this.cleanupBroadcastChannel();

        // 清理音频资源
        if (this.preloadedAudio) {
            this.preloadedAudio.pause();
            this.preloadedAudio = null;
        }

        // 清理全局番茄钟管理器
        const pomodoroManager = PomodoroManager.getInstance();
        pomodoroManager.cleanup();

        // 清理所有Tab视图实例
        this.tabViews.forEach((view) => {
            if (view && typeof view.destroy === 'function') {
                view.destroy();
            }
        });
        this.tabViews.clear();

        // 清理项目面板实例
        if (this.projectPanel && typeof this.projectPanel.destroy === 'function') {
            this.projectPanel.destroy();
        }

        // 清理所有面包屑和块按钮
        document.querySelectorAll('.view-reminder-breadcrumb-btn, .project-breadcrumb-btn, .block-project-btn').forEach(btn => {
            btn.remove();
        });

        // 断开所有protyle的MutationObserver
        document.querySelectorAll('.protyle').forEach(protyleElement => {
            const wysiwyg = protyleElement.querySelector('.protyle-wysiwyg');
            if (wysiwyg && (wysiwyg as any).__projectObserver) {
                try {
                    (wysiwyg as any).__projectObserver.disconnect();
                } catch (err) { }
                delete (wysiwyg as any).__projectObserver;
            }
        });
    }    /**
     * 初始化系统通知权限
     */
    private async initSystemNotificationPermission() {
        try {
            if ('Notification' in window) {
                if (Notification.permission === 'default') {
                    // 在用户交互时请求权限
                    const enableNotification = async () => {
                        const permission = await Notification.requestPermission();
                        if (permission === 'granted') {
                            console.log('系统通知权限已获取');
                        } else {
                            console.log('系统通知权限被拒绝');
                        }

                        // 移除事件监听器
                        document.removeEventListener('click', enableNotification);
                        document.removeEventListener('touchstart', enableNotification);
                        document.removeEventListener('keydown', enableNotification);
                    };

                    // 监听用户交互事件来请求权限（只触发一次）
                    document.addEventListener('click', enableNotification, { once: true });
                    document.addEventListener('touchstart', enableNotification, { once: true });
                    document.addEventListener('keydown', enableNotification, { once: true });
                }
            }
        } catch (error) {
            console.warn('初始化系统通知权限失败:', error);
        }
    }

    // 获取每日通知时间设置
    async getDailyNotificationTime(): Promise<string> {
        const settings = await this.loadSettings();
        let time = settings.dailyNotificationTime;
        // 如果是数字形式的旧配置，转换为 HH:MM 字符串
        if (typeof time === 'number') {
            const h = Math.max(0, Math.min(23, Math.floor(time)));
            time = (h < 10 ? '0' : '') + h + ':00';
        }
        // 如果不是字符串或格式不正确，使用默认
        if (typeof time !== 'string') {
            time = DEFAULT_SETTINGS.dailyNotificationTime as any;
        }
        // 规范化为 HH:MM
        const m = (time as string).match(/^(\d{1,2})(?::(\d{1,2}))?$/);
        if (m) {
            const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
            const min = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10) || 0));
            return (h < 10 ? '0' : '') + h.toString() + ':' + (min < 10 ? '0' : '') + min.toString();
        }
        return DEFAULT_SETTINGS.dailyNotificationTime as any;
    }

    // 获取每日通知启用状态
    async getDailyNotificationEnabled(): Promise<boolean> {
        const settings = await this.loadSettings();
        return settings.dailyNotificationEnabled !== false;
    }

    // 获取自动识别日期时间设置
    async getAutoDetectDateTimeEnabled(): Promise<boolean> {
        const settings = await this.loadSettings();
        return settings.autoDetectDateTime !== false;
    }

    /**
     * 打开番茄钟独立窗口
     * @param reminder 提醒对象
     * @param settings 番茄钟设置
     * @param isCountUp 是否正计时模式
     * @param inheritState 继承的状态
     */
    async openPomodoroWindow(reminder: any, settings: any, isCountUp: boolean, inheritState?: any) {
        try {
            // 先检查是否已有独立窗口
            if (this.pomodoroWindowId) {
                console.log('检测到已存在番茄钟独立窗口，尝试更新状态...', this.pomodoroWindowId);

                // 通过广播更新已有窗口的番茄钟状态
                // 如果没有提供inheritState，设置标志让独立窗口继承自己当前的状态
                this.broadcastMessage("pomodoro_update", {
                    reminder,
                    settings,
                    isCountUp,
                    inheritState,
                    shouldInheritCurrentState: !inheritState  // 如果没有提供inheritState，则应该继承当前状态
                });

                showMessage(t('pomodoroWindowUpdated') || '已更新独立窗口中的番茄钟', 2000);
                return;
            }

            // 如果没有独立窗口，则打开新窗口
            console.log('没有检测到独立窗口，准备打开新窗口...');
            const tabId = this.name + POMODORO_TAB_TYPE;

            // 创建tab
            const tab = openTab({
                app: this.app,
                custom: {
                    icon: 'iconClock',
                    title: reminder?.title || t('pomodoroTimer') || '番茄钟',
                    id: tabId,
                    data: {
                        reminder: reminder,
                        settings: settings,
                        isCountUp: isCountUp,
                        inheritState: inheritState,
                        isStandaloneWindow: true  // 标记这是一个独立窗口
                    }
                },
            });

            // 在新窗口中打开tab
            openWindow({
                height: 230,
                width: 240,
                tab: await tab,
            });

            console.log('新窗口已打开');

        } catch (error) {
            console.error('打开独立窗口失败:', error);
            showMessage(t('openWindowFailed') || '打开窗口失败', 2000);
        }
    }

    // ================================ 广播通信相关方法 ================================

    /**
     * 初始化广播通信
     */
    private async initBroadcastChannel() {
        // 生成当前窗口的唯一标识符
        this.windowId = BROADCAST_CHANNEL_NAME + "-" + window.Lute.NewNodeID();

        // 订阅广播频道
        await this.subscribeToBroadcastChannel();

        console.log('Broadcast Channel has been initialized, Window ID:', this.windowId);

        // 发送初始化消息到其他窗口（用于发现其他窗口）
        this.broadcastMessage("window_online", {
            windowId: this.windowId,
            timestamp: Date.now(),
        }, true);

        // 等待一小段时间，让其他窗口响应
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log('广播通道初始化完成，已发现窗口数:', this.otherWindowIds.size);

        // 监听页面卸载事件，确保窗口关闭时发送下线通知
        window.addEventListener("beforeunload", () => {
            this.sendOfflineNotification();
        });
    }

    /**
     * 订阅广播频道
     */
    private async subscribeToBroadcastChannel(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // 构建 WebSocket URL
                const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
                const wsUrl = `${protocol}//${window.location.host}/ws/broadcast?channel=${encodeURIComponent(BROADCAST_CHANNEL_NAME)}`;

                // 创建 WebSocket 连接
                this.websocket = new WebSocket(wsUrl);

                // 监听连接打开
                this.websocket.onopen = () => {
                    console.log("Broadcast channel connected");
                    this.clearReconnectTimer();
                    resolve();
                };

                // 监听消息
                this.websocket.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleBroadcastMessage(data);
                    } catch (error) {
                        console.error("Failed to parse broadcast message:", error);
                    }
                };

                // 监听连接错误
                this.websocket.onerror = (error) => {
                    console.error("Broadcast channel connection error:", error);
                    this.scheduleReconnect();
                    reject(error);
                };

                // 监听连接关闭
                this.websocket.onclose = (event) => {
                    console.log("Broadcast channel connection closed:", event.code, event.reason);
                    this.scheduleReconnect();
                };

            } catch (error) {
                console.error("Failed to subscribe to broadcast channel:", error);
                this.scheduleReconnect();
                reject(error);
            }
        });
    }

    /**
     * 安排重连
     */
    private scheduleReconnect() {
        this.clearReconnectTimer();
        this.reconnectTimer = window.setTimeout(() => {
            console.log("Attempting to reconnect to broadcast channel...");
            this.subscribeToBroadcastChannel().catch(error => {
                console.error("Failed to reconnect to broadcast channel:", error);
            });
        }, this.reconnectInterval);
    }

    /**
     * 清除重连定时器
     */
    private clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * 处理窗口下线通知
     */
    private handleWindowOffline(windowId: string) {
        console.log("收到窗口下线通知:", windowId);
        this.otherWindowIds.delete(windowId);

        // 如果是番茄钟窗口下线，清除标记
        if (this.pomodoroWindowId === windowId) {
            console.log("番茄钟窗口下线，清除标记:", windowId);
            this.pomodoroWindowId = null;
        }

        console.log("窗口下线处理完成，当前其他窗口数:", this.otherWindowIds.size, "番茄钟窗口ID:", this.pomodoroWindowId);
    }

    /**
     * 发送窗口下线通知
     */
    private sendOfflineNotification() {
        try {
            this.broadcastMessage("window_offline", {
                windowId: this.windowId,
                timestamp: Date.now(),
            }, true);
        } catch (error) {
            console.error("Failed to send offline notification:", error);
        }
    }

    /**
     * 清理广播频道连接
     */
    private cleanupBroadcastChannel() {
        // 发送窗口下线通知
        this.sendOfflineNotification();

        this.clearReconnectTimer();

        // 清理窗口跟踪数据
        this.otherWindowIds.clear();
        this.pomodoroWindowId = null;

        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
    }

    /**
     * 处理来自其他窗口的广播消息
     */
    private async handleBroadcastMessage(data: any) {
        console.log("Received broadcast message:", data);

        // 忽略来自当前窗口的消息
        if (data.windowId === this.windowId) {
            console.log("Ignoring message from current window:", data.windowId);
            return;
        }

        // 记录其他窗口 ID
        this.otherWindowIds.add(data.windowId);

        switch (data.type) {
            case "window_online":
                console.log("New window detected:", data.windowId);
                // 向新上线的窗口发送反馈，告知自己的存在
                this.broadcastMessage("window_online_feedback", {
                    windowId: this.windowId,
                    timestamp: Date.now(),
                });
                // 如果当前窗口是番茄钟窗口，告知新窗口
                if (this.tabViews.has(this.name + POMODORO_TAB_TYPE)) {
                    this.broadcastMessage("pomodoro_window_opened", {
                        windowId: this.windowId
                    });
                }
                break;
            case "window_online_feedback":
                console.log("Received online feedback from:", data.windowId);
                this.otherWindowIds.add(data.windowId);
                break;
            case "window_offline":
                this.handleWindowOffline(data.windowId);
                break;
            case "pomodoro_window_opened":
                // 记录番茄钟窗口ID
                console.log("收到番茄钟窗口打开通知，窗口ID:", data.windowId);
                this.pomodoroWindowId = data.windowId;
                console.log("Pomodoro window opened in another window:", data.windowId);
                break;
            case "pomodoro_window_closed":
                // 清除番茄钟窗口ID
                if (this.pomodoroWindowId === data.windowId) {
                    console.log("番茄钟窗口已关闭，清除标记:", data.windowId);
                    this.pomodoroWindowId = null;
                }
                break;
            case "pomodoro_update":
                // 如果当前是番茄钟独立窗口，更新番茄钟状态
                console.log("收到番茄钟更新请求");
                await this.updatePomodoroState(data);
                break;
            default:
                console.log("Unknown broadcast message type:", data.type);
        }
    }

    /**
     * 更新番茄钟状态（在独立窗口中）
     */
    private async updatePomodoroState(data: any) {
        try {
            const { reminder, settings, isCountUp, inheritState, shouldInheritCurrentState } = data;

            console.log('尝试更新番茄钟状态:', {
                reminder: reminder?.title,
                isCountUp,
                hasInheritState: !!inheritState,
                shouldInheritCurrentState: !!shouldInheritCurrentState
            });

            // 查找当前窗口的番茄钟Tab
            const tabId = this.name + POMODORO_TAB_TYPE;
            console.log('查找番茄钟Tab, ID:', tabId);
            console.log('当前tabViews:', Array.from(this.tabViews.keys()));

            const pomodoroView = this.tabViews.get(tabId);

            if (pomodoroView) {
                console.log('找到番茄钟视图，类型:', pomodoroView.constructor.name);

                // 如果需要继承当前状态，先获取当前状态
                let finalInheritState = inheritState;
                if (shouldInheritCurrentState && typeof pomodoroView.getCurrentState === 'function') {
                    console.log('需要继承当前状态，调用 getCurrentState()');
                    finalInheritState = pomodoroView.getCurrentState();
                    console.log('获取到的当前状态:', {
                        isRunning: finalInheritState.isRunning,
                        isWorkPhase: finalInheritState.isWorkPhase,
                        timeElapsed: finalInheritState.timeElapsed,
                        timeLeft: finalInheritState.timeLeft,
                        completedPomodoros: finalInheritState.completedPomodoros
                    });
                } else if (inheritState) {
                    console.log('使用提供的 inheritState');
                } else {
                    console.log('没有继承状态，将重置番茄钟');
                }

                if (typeof pomodoroView.updateState === 'function') {
                    // 如果番茄钟视图有更新状态的方法，调用它
                    console.log('调用updateState方法，finalInheritState:', !!finalInheritState);
                    await pomodoroView.updateState(reminder, settings, isCountUp, finalInheritState);
                    console.log('✓ 番茄钟状态已成功更新');
                } else {
                    console.warn('番茄钟视图不支持updateState方法，尝试重新创建');
                    // 如果视图不支持更新，销毁并重建
                    if (typeof pomodoroView.destroy === 'function') {
                        pomodoroView.destroy();
                    }
                    this.tabViews.delete(tabId);

                    // 重新创建番茄钟
                    await this.recreatePomodoroTimer(tabId, reminder, settings, isCountUp, finalInheritState);
                }
            } else {
                // 如果没有现有的番茄钟视图，尝试创建新的
                console.log('未找到番茄钟视图，尝试创建新的');
                await this.recreatePomodoroTimer(tabId, reminder, settings, isCountUp, inheritState);
            }
        } catch (error) {
            console.error('更新番茄钟状态失败:', error);
            showMessage('更新番茄钟失败，请检查控制台', 3000);
        }
    }

    /**
     * 重新创建番茄钟计时器
     */
    private async recreatePomodoroTimer(
        tabId: string,
        reminder: any,
        settings: any,
        isCountUp: boolean,
        inheritState?: any
    ) {
        try {
            console.log('开始重新创建番茄钟');

            // 动态导入PomodoroTimer
            const { PomodoroTimer } = await import("./components/PomodoroTimer");

            // 查找番茄钟容器
            const container = document.querySelector(`[data-id="${tabId}"]`) as HTMLElement;
            if (!container) {
                console.error('未找到番茄钟容器, tabId:', tabId);
                // 尝试其他方式查找容器
                const allContainers = document.querySelectorAll('[data-type="' + POMODORO_TAB_TYPE + '"]');
                console.log('找到的所有番茄钟类型容器:', allContainers.length);

                if (allContainers.length > 0) {
                    const targetContainer = allContainers[0] as HTMLElement;
                    console.log('使用第一个找到的容器');

                    // 清空容器
                    targetContainer.innerHTML = '';

                    // 创建新的番茄钟实例
                    const pomodoroTimer = new PomodoroTimer(
                        reminder,
                        settings,
                        isCountUp,
                        inheritState,
                        this,
                        targetContainer
                    );

                    this.tabViews.set(tabId, pomodoroTimer);
                    console.log('✓ 番茄钟已成功重新创建（使用备用容器）');
                } else {
                    console.error('完全找不到番茄钟容器');
                }
                return;
            }

            console.log('找到番茄钟容器');

            // 清空容器
            container.innerHTML = '';

            // 创建新的番茄钟实例
            const pomodoroTimer = new PomodoroTimer(
                reminder,
                settings,
                isCountUp,
                inheritState,
                this,
                container
            );

            this.tabViews.set(tabId, pomodoroTimer);
            console.log('✓ 番茄钟已成功重新创建');
        } catch (error) {
            console.error('重新创建番茄钟失败:', error);
            throw error;
        }
    }

    /**
     * 发送广播消息到其他窗口
     */
    private broadcastMessage(type: string, data: any = {}, force = false) {
        // 如果不是强制发送且不存在其他窗口，则跳过广播
        if (!force && this.otherWindowIds.size === 0) {
            console.log("跳过广播（无其他窗口）:", type, "force:", force, "otherWindows:", this.otherWindowIds.size);
            return;
        }

        const message = {
            type,
            windowId: this.windowId,
            timestamp: Date.now(),
            ...data
        };

        // 通过 WebSocket 连接发送消息
        this.postBroadcastMessage(JSON.stringify(message));
        console.log("发送跨窗口消息:", type, "windowId:", this.windowId, "otherWindows:", this.otherWindowIds.size);
    }

    /**
     * 通过 WebSocket 连接发送广播消息
     */
    private postBroadcastMessage(message: string) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(message);
        } else {
            console.error("WebSocket connection is not ready, cannot send message");
        }
    }

}
