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
import { ensureReminderDataFile, updateBlockReminderBookmark } from "./api";
import { CalendarView } from "./components/CalendarView";
import { CategoryManager } from "./utils/categoryManager";
import { getLocalDateString, getLocalTimeString, compareDateStrings } from "./utils/dateUtils";
import { t, setPluginInstance } from "./utils/i18n";
import { RepeatConfig } from "./components/RepeatSettingsDialog";
import { getRepeatDescription } from "./utils/repeatUtils";
import { SettingUtils } from "./libs/setting-utils";
import { PomodoroRecordManager } from "./utils/pomodoroRecord";
import { RepeatSettingsDialog } from "./components/RepeatSettingsDialog";
import { NotificationDialog } from "./components/NotificationDialog";
const STORAGE_NAME = "reminder-config";
const SETTINGS_NAME = "reminder-settings";
const TAB_TYPE = "reminder_calendar_tab";

export default class ReminderPlugin extends Plugin {
    private dockPanel: HTMLElement;
    private reminderPanel: ReminderPanel;
    private topBarElement: HTMLElement;
    private dockElement: HTMLElement;
    private calendarViews: Map<string, any> = new Map();
    private categoryManager: CategoryManager;
    private settingUtils: SettingUtils; // 添加设置工具

    async onload() {
        console.log("Reminder Plugin loaded");

        // 设置插件实例引用
        setPluginInstance(this);

        // 初始化设置
        this.initSettings();

        // 确保提醒数据文件存在
        await ensureReminderDataFile();

        // 确保通知记录文件存在
        try {
            const { ensureNotifyDataFile } = await import("./api");
            await ensureNotifyDataFile();
        } catch (error) {
            console.warn('初始化通知记录文件失败:', error);
        }

        // 初始化番茄钟记录管理器
        const pomodoroRecordManager = PomodoroRecordManager.getInstance();
        await pomodoroRecordManager.initialize();

        // 初始化分类管理器
        this.categoryManager = CategoryManager.getInstance();
        await this.categoryManager.initialize();

        // 直接初始化，不再需要延迟
        this.initializeUI();
    }

    private initSettings() {
        this.settingUtils = new SettingUtils({
            plugin: this,
            name: SETTINGS_NAME,
            width: "600px",
            height: "400px"
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
            value: "",
            type: "textinput",
            title: "工作时背景音（可选）",
            description: "设置工作时播放的背景音文件路径，留空则静音"
        });

        // 短时休息背景音设置
        this.settingUtils.addItem({
            key: "pomodoroBreakSound",
            value: "",
            type: "textinput",
            title: "休息背景音（可选）",
            description: "设置休息时播放的背景音文件路径，留空则静音"
        });



        // 结束提示音设置
        this.settingUtils.addItem({
            key: "pomodoroEndSound",
            value: "",
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
            longBreakSound: this.settingUtils.get("pomodoroBreakSound") || "",
            endSound: this.settingUtils.get("pomodoroEndSound") || ""
        };
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
    }

    private handleBlockMenu({ detail }) {
        // 添加提醒菜单项
        detail.menu.addItem({
            iconHTML: "⏰",
            label: detail.blockElements.length > 1 ? t("batchSetReminderBlocks", { count: detail.blockElements.length.toString() }) : t("setTimeReminder"),
            click: () => {
                if (detail.blockElements && detail.blockElements.length > 0) {
                    // 获取所有选中块的ID
                    const blockIds = detail.blockElements
                        .map(el => el.getAttribute("data-node-id"))
                        .filter(id => id); // 过滤掉空值

                    if (blockIds.length > 0) {
                        this.handleMultipleBlocks(blockIds);
                    }
                }
            }
        });
    }

    private async handleMultipleBlocks(blockIds: string[]) {
        if (blockIds.length === 1) {
            // 单个块直接打开对话框
            const dialog = new ReminderDialog(blockIds[0]);
            dialog.show();
        } else {
            // 多个块显示批量设置对话框
            this.showBatchReminderDialog(blockIds);
        }
    }

    private showBatchReminderDialog(blockIds: string[]) {
        const today = getLocalDateString();
        const currentTime = getLocalTimeString();

        // 初始化重复配置
        let batchRepeatConfig: RepeatConfig = {
            enabled: false,
            type: 'daily',
            interval: 1,
            endType: 'never'
        };

        const dialog = new Dialog({
            title: t("batchSetReminderBlocks", { count: blockIds.length.toString() }),
            content: `
                <div class="batch-reminder-dialog">
                    <div class="b3-dialog__content">
                        <div class="fn__hr"></div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">事件分类</label>
                            <div class="category-selector" id="batchCategorySelector">
                                <!-- 分类选择器将在这里渲染 -->
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("priority")}</label>
                            <div class="priority-selector" id="batchPrioritySelector">
                                <div class="priority-option" data-priority="high">
                                    <div class="priority-dot high"></div>
                                    <span>${t("highPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="medium">
                                    <div class="priority-dot medium"></div>
                                    <span>${t("mediumPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="low">
                                    <div class="priority-dot low"></div>
                                    <span>${t("lowPriority")}</span>
                                </div>
                                <div class="priority-option selected" data-priority="none">
                                    <div class="priority-dot none"></div>
                                    <span>${t("noPriority")}</span>
                                </div>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderDate")}</label>
                            <div class="reminder-date-container">
                                <input type="date" id="batchReminderDate" class="b3-text-field" value="${today}" required>
                                <span class="reminder-arrow">→</span>
                                <input type="date" id="batchReminderEndDate" class="b3-text-field reminder-end-date" placeholder="${t("endDateOptional")}" title="${t("spanningEventDesc")}">
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderTimeOptional")}</label>
                            <input type="time" id="batchReminderTime" class="b3-text-field" value="${currentTime}">
                            <div class="b3-form__desc">${t("noTimeDesc")}</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-checkbox">
                                <input type="checkbox" id="batchNoSpecificTime">
                                <span class="b3-checkbox__graphic"></span>
                                <span class="b3-checkbox__label">${t("noSpecificTime")}</span>
                            </label>
                        </div>
                        
                        <!-- 添加重复设置 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("repeatSettings")}</label>
                            <div class="repeat-setting-container">
                                <button type="button" id="batchRepeatSettingsBtn" class="b3-button b3-button--outline" style="width: 100%;">
                                    <span id="batchRepeatDescription">${t("noRepeat")}</span>
                                    <svg class="b3-button__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
                                </button>
                            </div>
                        </div>
                        
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderNoteOptional")}</label>
                            <textarea id="batchReminderNote" class="b3-text-field" placeholder="${t("enterReminderNote")}" rows="3" style="resize: vertical; min-height: 60px;width: 100%;"></textarea>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="batchCancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="batchConfirmBtn">${t("batchSet")}</button>
                    </div>
                </div>
            `,
            width: "450px",
            height: "750px" // 增加高度以容纳分类选择器
        });

        // 渲染分类选择器
        this.renderBatchCategorySelector(dialog);

        // 绑定事件
        const cancelBtn = dialog.element.querySelector('#batchCancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#batchConfirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = dialog.element.querySelector('#batchNoSpecificTime') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#batchReminderTime') as HTMLInputElement;
        const startDateInput = dialog.element.querySelector('#batchReminderDate') as HTMLInputElement;
        const endDateInput = dialog.element.querySelector('#batchReminderEndDate') as HTMLInputElement;
        const prioritySelector = dialog.element.querySelector('#batchPrioritySelector') as HTMLElement;
        const categorySelector = dialog.element.querySelector('#batchCategorySelector') as HTMLElement;
        const batchRepeatSettingsBtn = dialog.element.querySelector('#batchRepeatSettingsBtn') as HTMLButtonElement;

        // 优先级选择事件
        prioritySelector.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.priority-option') as HTMLElement;
            if (option) {
                prioritySelector.querySelectorAll('.priority-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 分类选择事件
        categorySelector.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option') as HTMLElement;
            if (option) {
                categorySelector.querySelectorAll('.category-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 重复设置按钮
        batchRepeatSettingsBtn?.addEventListener('click', () => {

            const repeatDialog = new RepeatSettingsDialog(batchRepeatConfig, (config: RepeatConfig) => {
                batchRepeatConfig = config;
                updateBatchRepeatDescription();
            });
            repeatDialog.show();
        });

        const updateBatchRepeatDescription = () => {
            const repeatDescription = dialog.element.querySelector('#batchRepeatDescription') as HTMLElement;
            if (repeatDescription) {
                const description = batchRepeatConfig.enabled ? getRepeatDescription(batchRepeatConfig) : t("noRepeat");
                repeatDescription.textContent = description;
            }
        };

        cancelBtn.addEventListener('click', () => {
            dialog.destroy();
        });

        confirmBtn.addEventListener('click', async () => {
            await this.saveBatchReminders(blockIds, dialog, batchRepeatConfig);
        });

        noTimeCheckbox.addEventListener('change', () => {
            timeInput.disabled = noTimeCheckbox.checked;
            if (noTimeCheckbox.checked) {
                timeInput.value = '';
            }
        });

        // 日期验证
        startDateInput?.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage(t("endDateAdjusted"));
            }

            endDateInput.min = startDate;
        });

        endDateInput?.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage(t("endDateCannotBeEarlier"));
            }
        });
    }

    private async renderBatchCategorySelector(dialog: Dialog) {
        const categorySelector = dialog.element.querySelector('#batchCategorySelector') as HTMLElement;
        if (!categorySelector) return;

        try {
            const categories = this.categoryManager.getCategories();

            categorySelector.innerHTML = `
                <div class="category-option selected" data-category="">
                    <div class="category-dot none"></div>
                    <span>无分类</span>
                </div>
            `;

            categories.forEach(category => {
                const categoryEl = document.createElement('div');
                categoryEl.className = 'category-option';
                categoryEl.setAttribute('data-category', category.id);
                categoryEl.innerHTML = `
                    <div class="category-dot" style="background-color: ${category.color};"></div>
                    <span>${category.icon || ''} ${category.name}</span>
                `;
                categorySelector.appendChild(categoryEl);
            });

        } catch (error) {
            console.error('渲染批量分类选择器失败:', error);
            categorySelector.innerHTML = '<div class="category-error">加载分类失败</div>';
        }
    }

    private async saveBatchReminders(blockIds: string[], dialog: Dialog, repeatConfig?: RepeatConfig) {
        const dateInput = dialog.element.querySelector('#batchReminderDate') as HTMLInputElement;
        const endDateInput = dialog.element.querySelector('#batchReminderEndDate') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#batchReminderTime') as HTMLInputElement;
        const noTimeCheckbox = dialog.element.querySelector('#batchNoSpecificTime') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#batchReminderNote') as HTMLTextAreaElement;
        const selectedPriority = dialog.element.querySelector('#batchPrioritySelector .priority-option.selected') as HTMLElement;
        const selectedCategory = dialog.element.querySelector('#batchCategorySelector .category-option.selected') as HTMLElement;

        const date = dateInput.value;
        const endDate = endDateInput.value;
        const time = noTimeCheckbox.checked ? undefined : timeInput.value;
        const note = noteInput.value.trim() || undefined;
        const priority = selectedPriority?.getAttribute('data-priority') || 'none';
        const categoryId = selectedCategory?.getAttribute('data-category') || undefined;

        if (!date) {
            showMessage(t("pleaseSelectDate"));
            return;
        }

        if (endDate && endDate < date) {
            showMessage(t("endDateCannotBeEarlier"));
            return;
        }

        try {
            const { readReminderData, writeReminderData, getBlockByID } = await import("./api");
            const reminderData = await readReminderData();

            let successCount = 0;
            let failureCount = 0;
            const successfulBlockIds: string[] = [];

            for (const blockId of blockIds) {
                try {
                    const block = await getBlockByID(blockId);
                    if (block) {
                        const reminderId = `${blockId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        const reminder = {
                            id: reminderId,
                            blockId: blockId,
                            title: block.content || t("unnamedNote"),
                            date: date,
                            completed: false,
                            priority: priority,
                            categoryId: categoryId, // 添加分类ID
                            pomodoroCount: 0, // 初始化番茄数量
                            createdAt: new Date().toISOString(),
                            repeat: repeatConfig?.enabled ? repeatConfig : undefined
                        };

                        if (endDate && endDate !== date) {
                            reminder.endDate = endDate;
                        }

                        if (time) {
                            reminder.time = time;
                        }

                        if (note) {
                            reminder.note = note;
                        }

                        reminderData[reminderId] = reminder;
                        successCount++;
                        successfulBlockIds.push(blockId);
                    } else {
                        failureCount++;
                    }
                } catch (error) {
                    console.error(`设置块 ${blockId} 提醒失败:`, error);
                    failureCount++;
                }
            }

            await writeReminderData(reminderData);

            // 为所有成功创建提醒的块添加书签
            for (const blockId of successfulBlockIds) {
                try {
                    await updateBlockReminderBookmark(blockId);
                } catch (error) {
                    console.error(`更新块 ${blockId} 书签失败:`, error);
                }
            }

            if (successCount > 0) {
                const isSpanning = endDate && endDate !== date;
                const timeStr = time ? ` ${time}` : '';
                const dateStr = isSpanning ? `${date} → ${endDate}${timeStr}` : `${date}${timeStr}`;
                const spanningText = isSpanning ? t("spanning") : '';
                const failureText = failureCount > 0 ? t("batchFailure", { count: failureCount.toString() }) : '';
                const repeatText = repeatConfig?.enabled ? `，${getRepeatDescription(repeatConfig)}` : '';

                let categoryText = '';
                if (categoryId) {
                    const category = this.categoryManager.getCategoryById(categoryId);
                    if (category) {
                        categoryText = `，分类：${category.name}`;
                    }
                }

                showMessage(t("batchSuccess", {
                    count: successCount.toString(),
                    spanning: spanningText,
                    date: dateStr,
                    failure: failureText
                }) + repeatText + categoryText);
            } else {
                showMessage(t("batchSetFailed"));
            }

            dialog.destroy();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('批量保存提醒失败:', error);
            showMessage(t("batchSaveFailed"));
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

            // 只在6点后进行提醒检查
            if (currentHour < 6) {
                return;
            }

            // 检查今天是否已经提醒过 - 添加错误处理
            let hasNotifiedDailyToday = false;
            try {
                hasNotifiedDailyToday = await hasNotifiedToday(today);
            } catch (error) {
                console.warn('检查每日通知状态失败，可能是首次初始化:', error);
                // 如果读取失败，尝试初始化通知记录文件
                try {
                    const { ensureNotifyDataFile } = await import("./api");
                    await ensureNotifyDataFile();
                    hasNotifiedDailyToday = await hasNotifiedToday(today);
                } catch (initError) {
                    console.warn('初始化通知记录文件失败:', initError);
                    // 如果初始化也失败，则假设今天未通知过，继续执行
                    hasNotifiedDailyToday = false;
                }
            }

            // 如果今天已经提醒过，则不再提醒
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
        if (existingButton) return;

        // 查找文档按钮
        const docButton = breadcrumb.querySelector('button[data-type="doc"]');
        if (!docButton) return;

        // 创建提醒按钮
        const reminderBtn = document.createElement('button');
        reminderBtn.className = 'reminder-breadcrumb-btn block__icon fn__flex-center ariaLabel';
        reminderBtn.setAttribute('aria-label', t("setDocumentReminder"));
        reminderBtn.innerHTML = `
            <svg class="b3-list-item__graphic"><use xlink:href="#iconClock"></use></svg>
        `;

        // 设置按钮样式
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


        // 点击事件
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

        // 在文档按钮前面插入提醒按钮
        breadcrumb.insertBefore(reminderBtn, docButton);
    }

    onunload() {
        console.log("Reminder Plugin unloaded");

        // 清理所有日历视图实例
        this.calendarViews.forEach((calendarView) => {
            if (calendarView && typeof calendarView.destroy === 'function') {
                calendarView.destroy();
            }
        });
        this.calendarViews.clear();

        // 清理所有面包屑按钮
        document.querySelectorAll('.reminder-breadcrumb-btn').forEach(btn => {
            btn.remove();
        });
    }
}
