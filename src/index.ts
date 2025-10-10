import {
    Plugin,
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
import { ReminderDialog } from "./components/ReminderDialog";
import { ReminderPanel } from "./components/ReminderPanel";
import { BatchReminderDialog } from "./components/BatchReminderDialog";
import { ensureReminderDataFile, updateBlockReminderBookmark, ensureProjectDataFile } from "./api";
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
    dailyNotificationTime: 8, // 新增：每日通知时间，默认8点
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
    private projectPanel: ProjectPanel;
    private projectDockElement: HTMLElement;

    async onload() {
        console.log("Reminder Plugin loaded");
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


        await ensureReminderDataFile();

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

            // 优先使用预加载的音频
            if (this.preloadedAudio && this.preloadedAudio.src.includes(soundPath)) {
                try {
                    this.preloadedAudio.currentTime = 0;
                    await this.preloadedAudio.play();
                    return;
                } catch (error) {
                    console.warn('预加载音频播放失败，尝试创建新音频:', error);
                }
            }

            // 如果预加载音频不可用，创建新的音频实例
            const audio = new Audio(soundPath);
            audio.volume = 1;
            await audio.play();

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
        this.topBarElement = this.addTopBar({
            icon: "iconClock",
            title: t("timeReminder"),
            position: "left",
            callback: () => this.openReminderFloatPanel()
        });
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



        // 注册日历视图标签页
        this.addTab({
            type: TAB_TYPE,
            init: ((tab) => {
                const calendarView = new CalendarView(tab.element, this);
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

                if (!reminder || !settings) {
                    console.error('番茄钟Tab缺少必要数据');
                    tab.element.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--b3-theme-error);">错误：缺少番茄钟数据</div>';
                    return;
                }

                // 动态导入PomodoroTimer避免循环依赖
                import("./components/PomodoroTimer").then(({ PomodoroTimer }) => {
                    const pomodoroTimer = new PomodoroTimer(reminder, settings, isCountUp, inheritState, this, tab.element);
                    // 保存番茄钟实例引用用于清理
                    this.tabViews.set(tab.id, pomodoroTimer);
                });
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

        // 延迟一些时间后再次更新徽章，确保停靠栏已渲染
        setTimeout(() => {
            this.updateBadges();
            this.updateProjectBadges();
        }, 2000);

        // 监听提醒更新事件，更新徽章
        window.addEventListener('reminderUpdated', () => {
            this.updateBadges();
        });

        // 监听项目更新事件，更新项目徽章
        window.addEventListener('projectUpdated', () => {
            this.updateProjectBadges();
        });
    }

    async onLayoutReady() {
        // 初始化批量设置对话框（确保在UI初始化时创建）
        this.batchReminderDialog = new BatchReminderDialog(this);

        // 添加dock栏和顶栏按钮
        this.initializeUI();

        // 注册快捷键
        this.registerCommands();

        // 在布局准备就绪后监听protyle切换事件
        this.eventBus.on('switch-protyle', (e) => {
            // 延迟添加按钮，确保protyle完全切换完成
            setTimeout(() => {
                this.addBreadcrumbReminderButton(e.detail.protyle);
            }, 100);
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
                        const dialog = new ReminderDialog(firstDocumentId, autoDetect, projectId);
                        dialog.show();
                    } catch (err) {
                        const dialog = new ReminderDialog(firstDocumentId, autoDetect);
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
                        const dialog = new ReminderDialog(documentId, autoDetect, projectId);
                        dialog.show();
                    } catch (err) {
                        const dialog = new ReminderDialog(documentId, autoDetect);
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
                const dialog = new ReminderDialog(blockIds[0], autoDetect, projectId);
                dialog.show();
            } catch (err) {
                const dialog = new ReminderDialog(blockIds[0], autoDetect);
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
            const currentHour = parseInt(currentTime.split(':')[0]);

            // 获取用户设置的每日通知时间
            const dailyNotificationHour = await this.getDailyNotificationTime();

            // 只在设置的时间后进行提醒检查
            if (currentHour < dailyNotificationHour) {
                return;
            }

            // 检查单个时间提醒
            await this.checkTimeReminders(reminderData, today, currentTime);

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
                if (typeof reminder.completed !== 'boolean' || !reminder.date || !reminder.id) {
                    console.warn('提醒项缺少必要属性:', reminder);
                    return;
                }

                // 添加原始事件
                allReminders.push(reminder);

                // 如果有重复设置，生成重复事件实例
                if (reminder.repeat?.enabled) {
                    const repeatInstances = generateRepeatInstances(reminder, today, today);
                    repeatInstances.forEach(instance => {
                        // 跳过与原始事件相同日期的实例
                        if (instance.date !== reminder.date) {
                            // 检查实例级别的完成状态
                            const completedInstances = reminder.repeat?.completedInstances || [];
                            const isInstanceCompleted = completedInstances.includes(instance.date);

                            // 检查实例级别的修改（包括备注）
                            const instanceModifications = reminder.repeat?.instanceModifications || {};
                            const instanceMod = instanceModifications[instance.date];

                            const instanceReminder = {
                                ...reminder,
                                id: instance.instanceId,
                                date: instance.date,
                                endDate: instance.endDate,
                                time: instance.time,
                                endTime: instance.endTime,
                                isRepeatInstance: true,
                                originalId: instance.originalId,
                                completed: isInstanceCompleted,
                                note: instanceMod?.note || ''
                            };

                            const key = `${reminder.id}_${instance.date}`;
                            if (!repeatInstancesMap.has(key) ||
                                compareDateStrings(instance.date, repeatInstancesMap.get(key).date) < 0) {
                                repeatInstancesMap.set(key, instanceReminder);
                            }
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
                const reminderInfo = {
                    id: reminder.id,
                    blockId: reminder.blockId,
                    title: reminder.title || t("unnamedNote"),
                    note: reminder.note,
                    priority: reminder.priority || 'none',
                    categoryId: reminder.categoryId,
                    time: reminder.time,
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

                // 检查是否启用系统弹窗通知
                const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();

                // 仅在系统弹窗未启用时显示思源笔记消息弹窗
                if (!systemNotificationEnabled) {
                    NotificationDialog.showAllDayReminders(sortedReminders);
                }
                if (systemNotificationEnabled) {
                    const totalCount = sortedReminders.length;
                    const title = '📅 ' + t("dailyRemindersNotification") + ` (${totalCount})`;

                    // 创建任务列表 - 直接显示所有任务
                    let taskList = ``;

                    // 显示前2个任务
                    sortedReminders.slice(0, 2).forEach(reminder => {
                        const timeText = reminder.time ? ` ${reminder.time}` : '';
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
                if (reminderObj.completed || !reminderObj.time) continue;

                // 处理普通提醒
                if (!reminderObj.repeat?.enabled) {
                    if (this.shouldNotifyNow(reminderObj, today, currentTime)) {
                        await this.showTimeReminder(reminderObj);
                        // 标记为已提醒
                        reminderObj.notified = true;
                        dataChanged = true;
                    }
                } else {
                    // 处理重复提醒
                    const instances = generateRepeatInstances(reminderObj, today, today);

                    for (const instance of instances) {
                        // 检查实例是否需要提醒
                        if (this.shouldNotifyNow(instance, today, currentTime)) {
                            // 检查实例级别是否已提醒
                            const notifiedInstances = reminderObj.repeat?.notifiedInstances || [];
                            const instanceKey = `${instance.date}_${instance.time}`;

                            if (!notifiedInstances.includes(instanceKey)) {
                                await this.showTimeReminder(instance);

                                // 标记实例已提醒
                                if (!reminderObj.repeat) reminderObj.repeat = {};
                                if (!reminderObj.repeat.notifiedInstances) reminderObj.repeat.notifiedInstances = [];
                                reminderObj.repeat.notifiedInstances.push(instanceKey);
                                dataChanged = true;
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
    private shouldNotifyNow(reminder: any, today: string, currentTime: string): boolean {
        // 必须是今天的事件
        if (reminder.date !== today) return false;

        // 必须有时间
        if (!reminder.time) return false;

        // 已经提醒过了
        if (reminder.notified) return false;

        // 比较当前时间和提醒时间
        const reminderTime = reminder.time;
        const currentTimeNumber = this.timeStringToNumber(currentTime);
        const reminderTimeNumber = this.timeStringToNumber(reminderTime);

        // 当前时间必须达到或超过提醒时间
        return currentTimeNumber >= reminderTimeNumber;
    }

    // 时间字符串转换为数字便于比较 (HH:MM -> HHMM)
    private timeStringToNumber(timeString: string): number {
        if (!timeString) return 0;
        const parts = timeString.split(':');
        if (parts.length !== 2) return 0;
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        return hours * 100 + minutes;
    }    // 显示时间提醒
    private async showTimeReminder(reminder: any) {
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

            const reminderInfo = {
                id: reminder.id,
                blockId: reminder.blockId,
                title: reminder.title || t("unnamedNote"),
                note: reminder.note,
                priority: reminder.priority || 'none',
                categoryId: reminder.categoryId,
                time: reminder.time,
                date: reminder.date,
                endDate: reminder.endDate,
                isAllDay: false,
                isOverdue: false,
                ...categoryInfo
            };

            // 检查是否启用系统弹窗通知
            const systemNotificationEnabled = await this.getReminderSystemNotificationEnabled();

            // 仅在系统弹窗未启用时显示思源笔记消息弹窗
            if (!systemNotificationEnabled) {
                NotificationDialog.show(reminderInfo);
            }

            if (systemNotificationEnabled) {
                const title = '⏰ ' + t("timeReminderNotification");
                const categoryText = (categoryInfo as any).categoryName ? ` [${(categoryInfo as any).categoryName}]` : '';
                const timeText = reminder.time ? ` ${reminder.time}` : '';
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
    openCalendarTab() {
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
                const calendarView = new CalendarView(calendarContainer, this);
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
                    data: {}
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
                        const dialog = new ReminderDialog(documentId, autoDetect, projectId);
                        dialog.show();
                    } catch (err) {
                        const dialog = new ReminderDialog(documentId, autoDetect);
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

        // 清理所有面包屑按钮
        document.querySelectorAll('.view-reminder-breadcrumb-btn, .project-breadcrumb-btn').forEach(btn => {
            btn.remove();
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
    async getDailyNotificationTime(): Promise<number> {
        const settings = await this.loadSettings();
        const time = settings.dailyNotificationTime;
        // 确保时间在0-24范围内
        return Math.max(0, Math.min(24, typeof time === 'number' ? time : DEFAULT_SETTINGS.dailyNotificationTime));
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
            // 创建tab ID，每个番茄钟实例使用唯一ID
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
                        inheritState: inheritState
                    }
                },
            });

            // 在新窗口中打开tab
            openWindow({
                height: 230,
                width: 240,
                tab: await tab,
            });

            showMessage(t('openedInNewWindow') || '已在新窗口中打开', 2000);
        } catch (error) {
            console.error('打开独立窗口失败:', error);
            showMessage(t('openWindowFailed') || '打开窗口失败', 2000);
        }
    }

}
