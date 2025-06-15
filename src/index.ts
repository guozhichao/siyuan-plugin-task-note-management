import {
    Plugin,
    showMessage,
    confirm,
    Dialog,
    Menu,
    openTab,
    adaptHotkey,
    getFrontend,
    getBackend,
    IModel,
    IMenuItemOption
} from "siyuan";
import "./index.scss";
import { ReminderDialog } from "./components/ReminderDialog";
import { ReminderPanel } from "./components/ReminderPanel";
import { BatchReminderDialog } from "./components/BatchReminderDialog";
import { ensureReminderDataFile, updateBlockReminderBookmark, ensureProjectDataFile } from "./api";
import { CalendarView } from "./components/CalendarView";
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
const STORAGE_NAME = "reminder-config";
const SETTINGS_NAME = "reminder-settings";
const TAB_TYPE = "reminder_calendar_tab";
import * as chrono from 'chrono-node';

export default class ReminderPlugin extends Plugin {
    private dockPanel: HTMLElement;
    private reminderPanel: ReminderPanel;
    private topBarElement: HTMLElement;
    private dockElement: HTMLElement;
    private calendarViews: Map<string, any> = new Map();
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
        this.chronoParser = chrono.zh.casual.clone();

        setPluginInstance(this);
        this.initSettings();

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

        // 初始化批量设置对话框
        this.batchReminderDialog = new BatchReminderDialog(this);

        this.initializeUI();

        // 添加用户交互监听器来启用音频
        this.enableAudioOnUserInteraction();
    }

    private enableAudioOnUserInteraction() {
        const enableAudio = async () => {
            if (this.audioEnabled) return;

            try {
                // 预加载音频文件
                const soundPath = this.getNotificationSound();
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

    private initSettings() {
        this.settingUtils = new SettingUtils({
            plugin: this,
            name: SETTINGS_NAME,
            width: "600px",
            height: "700px"
        });




        // 通知提醒声音设置
        this.settingUtils.addItem({
            key: "notificationSound",
            value: "/plugins/siyuan-plugin-task-note-management/audios/notify.mp3",
            type: "textinput",
            title: "通知提醒声音",
            description: "设置事项提醒时播放的声音文件路径，留空则静音"
        });

        // 番茄钟工作时长设置
        this.settingUtils.addItem({
            key: "pomodoroWorkDuration",
            value: 25,
            type: "number",
            title: "番茄钟工作时长（分钟）",
            description: "设置番茄钟工作阶段的时长，默认25分钟"
        });

        // 番茄钟休息时长设置
        this.settingUtils.addItem({
            key: "pomodoroBreakDuration",
            value: 5,
            type: "number",
            title: "番茄钟短时休息时长（分钟）",
            description: "设置番茄钟短时休息阶段的时长，默认5分钟"
        });
        // 番茄钟长时休息时长设置
        this.settingUtils.addItem({
            key: "pomodoroLongBreakDuration",
            value: 30,
            type: "number",
            title: "番茄钟长时休息时长（分钟）",
            description: "设置番茄钟长时休息阶段的时长，默认30分钟"
        });
        // 工作时背景音设置
        this.settingUtils.addItem({
            key: "pomodoroWorkSound",
            value: "/plugins/siyuan-plugin-task-note-management/audios/background_music.mp3",
            type: "textinput",
            title: "番茄工作时背景音（可选）",
            description: "设置工作时播放的背景音文件路径，留空则静音"
        });

        // 短时休息背景音设置
        this.settingUtils.addItem({
            key: "pomodoroBreakSound",
            value: "/plugins/siyuan-plugin-task-note-management/audios/background_music.mp3",
            type: "textinput",
            title: "番茄休息背景音（可选）",
            description: "设置休息时播放的背景音文件路径，留空则静音"
        });
        // 长时休息背景音设置
        this.settingUtils.addItem({
            key: "pomodoroLongBreakSound",
            value: "/plugins/siyuan-plugin-task-note-management/audios/background_music.mp3",
            type: "textinput",
            title: "番茄长时休息背景音（可选）",
            description: "设置长时休息时播放的背景音文件路径，留空则静音"
        });

        // 结束提示音设置
        this.settingUtils.addItem({
            key: "pomodoroEndSound",
            value: "/plugins/siyuan-plugin-task-note-management/audios/end_music.mp3",
            type: "textinput",
            title: "结束提示音（可选）",
            description: "设置番茄钟结束时的提示音文件路径，留空则静音"
        });

        // 加载设置
        this.settingUtils.load();
    }

    // 获取番茄钟设置
    getPomodoroSettings() {
        return {
            workDuration: this.settingUtils.get("pomodoroWorkDuration") || 25,
            breakDuration: this.settingUtils.get("pomodoroBreakDuration") || 5,
            longBreakDuration: this.settingUtils.get("pomodoroLongBreakDuration") || 30,
            workSound: this.settingUtils.get("pomodoroWorkSound") || "",
            breakSound: this.settingUtils.get("pomodoroBreakSound") || "",
            longBreakSound: this.settingUtils.get("pomodoroLongBreakSound") || "",
            endSound: this.settingUtils.get("pomodoroEndSound") || ""
        };
    }
    // 获取通知声音设置
    getNotificationSound(): string {
        return this.settingUtils.get("notificationSound") || "/plugins/siyuan-plugin-task-note-management/audios/notify.mp3";
    }

    // 播放通知声音
    async playNotificationSound() {
        try {
            const soundPath = this.getNotificationSound();
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

        // 创建 Dock 面板
        this.addDock({
            config: {
                position: "LeftTop",
                size: { width: 300, height: 400 },
                icon: "iconClock",
                title: t("timeReminder"),
                hotkey: "⌥⌘R"
            },
            data: {},
            type: "reminder_dock",
            init: (dock) => {
                this.dockPanel = dock.element;
                this.dockElement = dock.element.parentElement; // 获取 dock 容器
                this.reminderPanel = new ReminderPanel(this.dockPanel, this);
            }
        });

        // 创建项目管理 Dock 面板
        this.addDock({
            config: {
                position: "LeftTop",
                size: { width: 300, height: 400 },
                icon: "iconFile",
                title: "项目笔记",
                hotkey: "⌥⌘P"
            },
            data: {},
            type: "project_dock",
            init: (dock) => {
                this.projectDockElement = dock.element;
                this.projectPanel = new ProjectPanel(dock.element, this);
            }
        });

        // 注册日历视图标签页
        this.addTab({
            type: TAB_TYPE,
            init: (tab) => {
                const calendarView = new CalendarView(tab.element, this);
                // 保存实例引用用于清理
                this.calendarViews.set(tab.id, calendarView);
            }
        });

        // 文档块标添加菜单
        this.eventBus.on('click-editortitleicon', this.handleDocumentMenu.bind(this));

        // 块菜单添加菜单
        this.eventBus.on('click-blockicon', this.handleBlockMenu.bind(this));

        // 定期检查提醒
        this.startReminderCheck();

        // 初始化顶栏徽章和停靠栏徽章
        this.updateBadges();

        // 监听提醒更新事件，更新徽章
        window.addEventListener('reminderUpdated', () => {
            this.updateBadges();
        });
    }

    async onLayoutReady() {
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
            content: '<div id="floatReminderPanel" style="height: 400px;"></div>',
            width: "350px",
            height: "450px",
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
                    } else {
                        shouldCount = reminder.date === today || compareDateStrings(reminder.date, today) < 0;
                    }

                    if (shouldCount) {
                        uncompletedCount++;
                    }
                } else {
                    // 处理重复事件
                    const instances = generateRepeatInstances(reminder, today, today);
                    instances.forEach(instance => {
                        if (!instance.completed) {
                            uncompletedCount++;
                        }
                    });

                    if (reminder.date === today && !reminder.completed) {
                        const completedInstances = reminder.repeat.completedInstances || [];
                        if (!completedInstances.includes(today)) {
                            uncompletedCount++;
                        }
                    }
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

    private async updateTopBarBadge() {
        // 保持向后兼容
        await this.updateBadges();
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

    private setDockBadge(count: number) {

        // 查找停靠栏图标
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
            dockIcon.style.position = 'relative';
            dockIcon.appendChild(badge);
        }
    }

    private handleDocumentMenu({ detail }) {
        const documentId = detail.protyle.block.rootID;

        detail.menu.addItem({
            iconHTML: "⏰",
            label: t("setTimeReminder"),
            click: () => {
                if (documentId) {
                    const dialog = new ReminderDialog(documentId);
                    dialog.show();
                }
            }
        });

        // 添加文档提醒查看功能
        detail.menu.addItem({
            iconHTML: "📋",
            label: "查看文档所有提醒",
            click: () => {
                if (documentId) {
                    const documentReminderDialog = new DocumentReminderDialog(documentId);
                    documentReminderDialog.show();
                }
            }
        });

        // 添加项目笔记设置功能
        detail.menu.addItem({
            iconHTML: "⏰",
            label: "设置为项目笔记",
            click: () => {
                if (documentId) {
                    const dialog = new ProjectDialog(documentId);
                    dialog.show();
                }
            }
        });
    }

    private handleBlockMenu({ detail }) {
        detail.menu.addItem({
            iconHTML: "⏰",
            label: detail.blockElements.length > 1 ? t("batchSetReminderBlocks", { count: detail.blockElements.length.toString() }) : t("setTimeReminder"),
            click: () => {
                if (detail.blockElements && detail.blockElements.length > 0) {
                    const blockIds = detail.blockElements
                        .map(el => el.getAttribute("data-node-id"))
                        .filter(id => id);

                    if (blockIds.length > 0) {
                        this.handleMultipleBlocks(blockIds);
                    }
                }
            }
        });
    }
    private async handleMultipleBlocks(blockIds: string[]) {
        // 使用新的批量设置组件
        await this.batchReminderDialog.show(blockIds);
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

            // 只在6点后进行提醒检查
            if (currentHour < 6) {
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

                // 统一显示今日事项
                NotificationDialog.showAllDayReminders(sortedReminders);

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
    }

    // 显示时间提醒
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

            // 显示单个提醒
            NotificationDialog.show(reminderInfo);

        } catch (error) {
            console.error('显示时间提醒失败:', error);
        }
    }

    // 打开日历视图标签页
    openCalendarTab() {
        openTab({
            app: this.app,
            custom: {
                title: t("calendarView"),
                icon: 'iconCalendar',
                id: this.name + TAB_TYPE,
                data: {}
            }
        });
    }

    private addBreadcrumbReminderButton(protyle: any) {
        if (!protyle || !protyle.element) return;

        const breadcrumb = protyle.element.querySelector('.protyle-breadcrumb');
        if (!breadcrumb) return;

        // 检查是否已经添加过按钮
        const existingButton = breadcrumb.querySelector('.reminder-breadcrumb-btn');
        const existingViewButton = breadcrumb.querySelector('.view-reminder-breadcrumb-btn');
        if (existingButton && existingViewButton) return;

        // 查找文档按钮
        const docButton = breadcrumb.querySelector('button[data-type="doc"]');
        if (!docButton) return;

        // 创建提醒按钮（如果不存在）
        if (!existingButton) {
            const reminderBtn = document.createElement('button');
            reminderBtn.className = 'reminder-breadcrumb-btn block__icon fn__flex-center ariaLabel';
            reminderBtn.setAttribute('aria-label', t("setDocumentReminder"));
            reminderBtn.innerHTML = `
                <svg class="b3-list-item__graphic"><use xlink:href="#iconClock"></use></svg>
            `;

            reminderBtn.style.cssText = `
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

            reminderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const documentId = protyle.block?.rootID;
                if (documentId) {
                    const dialog = new ReminderDialog(documentId);
                    dialog.show();
                } else {
                    showMessage(t("cannotGetDocumentId"));
                }
            });

            breadcrumb.insertBefore(reminderBtn, docButton);
        }

        // 创建查看提醒按钮（如果不存在）
        if (!existingViewButton) {
            const viewReminderBtn = document.createElement('button');
            viewReminderBtn.className = 'view-reminder-breadcrumb-btn block__icon fn__flex-center ariaLabel';
            viewReminderBtn.setAttribute('aria-label', "查看文档所有提醒");
            viewReminderBtn.innerHTML = `
                <svg class="b3-list-item__graphic"><use xlink:href="#iconCheck"></use></svg>
            `;

            viewReminderBtn.style.cssText = `
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

            viewReminderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const documentId = protyle.block?.rootID;
                if (documentId) {
                    const documentReminderDialog = new DocumentReminderDialog(documentId);
                    documentReminderDialog.show();
                } else {
                    showMessage(t("cannotGetDocumentId"));
                }
            });

            breadcrumb.insertBefore(viewReminderBtn, docButton);
        }
    }

    onunload() {
        console.log("Reminder Plugin unloaded");

        // 清理音频资源
        if (this.preloadedAudio) {
            this.preloadedAudio.pause();
            this.preloadedAudio = null;
        }

        // 清理所有日历视图实例
        this.calendarViews.forEach((calendarView) => {
            if (calendarView && typeof calendarView.destroy === 'function') {
                calendarView.destroy();
            }
        });
        this.calendarViews.clear();

        // 清理所有面包屑按钮
        document.querySelectorAll('.reminder-breadcrumb-btn, .view-reminder-breadcrumb-btn').forEach(btn => {
            btn.remove();
        });
    }
}
