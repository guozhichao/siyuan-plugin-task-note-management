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
import { ensureReminderDataFile } from "./api";
import { CalendarView } from "./components/CalendarView";
import { getLocalDateString, getLocalTimeString, compareDateStrings } from "./utils/dateUtils";
import { t, setPluginInstance } from "./utils/i18n";
import { RepeatConfig } from "./components/RepeatSettingsDialog";
import { getRepeatDescription } from "./utils/repeatUtils";

const STORAGE_NAME = "reminder-config";
const TAB_TYPE = "reminder_calendar_tab";

export default class ReminderPlugin extends Plugin {
    private dockPanel: HTMLElement;
    private reminderPanel: ReminderPanel;
    private topBarElement: HTMLElement;
    private dockElement: HTMLElement;
    private calendarViews: Map<string, any> = new Map();

    async onload() {
        console.log("Reminder Plugin loaded");

        // 设置插件实例引用，使i18n工具能够访问插件的i18n数据
        setPluginInstance(this);

        // 确保提醒数据文件存在
        await ensureReminderDataFile();

        // 直接初始化，不再需要延迟
        this.initializeUI();
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
                    // 处理重复事件 - 生成今天的实例并检查是否完成
                    const instances = generateRepeatInstances(reminder, today, today);
                    instances.forEach(instance => {
                        if (!instance.completed) {
                            uncompletedCount++;
                        }
                    });

                    // 如果今天是原始事件日期且未完成，也要计算
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
        const dockIcon = document.querySelector('.dock__item[data-type="siyuna-plugin-reminderreminder_dock"]');
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
                            <textarea id="batchReminderNote" class="b3-text-field" placeholder="${t("enterReminderNote")}" rows="3" style="resize: vertical; min-height: 60px;"></textarea>
                        </div>
                        <div class="b3-form__group">
                            <div class="b3-form__desc">${t("batchSetReminderDesc", { count: blockIds.length.toString() })}</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="batchCancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="batchConfirmBtn">${t("batchSet")}</button>
                    </div>
                </div>
            `,
            width: "450px",
            height: "530px"
        });

        // 绑定事件
        const cancelBtn = dialog.element.querySelector('#batchCancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#batchConfirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = dialog.element.querySelector('#batchNoSpecificTime') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#batchReminderTime') as HTMLInputElement;
        const startDateInput = dialog.element.querySelector('#batchReminderDate') as HTMLInputElement;
        const endDateInput = dialog.element.querySelector('#batchReminderEndDate') as HTMLInputElement;
        const prioritySelector = dialog.element.querySelector('#batchPrioritySelector') as HTMLElement;
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

        // 重复设置按钮
        batchRepeatSettingsBtn?.addEventListener('click', () => {
            const { RepeatSettingsDialog } = require("./components/RepeatSettingsDialog");
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

    private async saveBatchReminders(blockIds: string[], dialog: Dialog, repeatConfig?: RepeatConfig) {
        const dateInput = dialog.element.querySelector('#batchReminderDate') as HTMLInputElement;
        const endDateInput = dialog.element.querySelector('#batchReminderEndDate') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#batchReminderTime') as HTMLInputElement;
        const noTimeCheckbox = dialog.element.querySelector('#batchNoSpecificTime') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#batchReminderNote') as HTMLTextAreaElement;
        const selectedPriority = dialog.element.querySelector('#batchPrioritySelector .priority-option.selected') as HTMLElement;

        const date = dateInput.value;
        const endDate = endDateInput.value;
        const time = noTimeCheckbox.checked ? undefined : timeInput.value;
        const note = noteInput.value.trim() || undefined;
        const priority = selectedPriority?.getAttribute('data-priority') || 'none';

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
                            createdAt: new Date().toISOString(),
                            repeat: repeatConfig?.enabled ? repeatConfig : undefined // 添加重复配置
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
                    } else {
                        failureCount++;
                    }
                } catch (error) {
                    console.error(`设置块 ${blockId} 提醒失败:`, error);
                    failureCount++;
                }
            }

            await writeReminderData(reminderData);

            if (successCount > 0) {
                const isSpanning = endDate && endDate !== date;
                const timeStr = time ? ` ${time}` : '';
                const dateStr = isSpanning ? `${date} → ${endDate}${timeStr}` : `${date}${timeStr}`;
                const spanningText = isSpanning ? t("spanning") : '';
                const failureText = failureCount > 0 ? t("batchFailure", { count: failureCount.toString() }) : '';
                const repeatText = repeatConfig?.enabled ? `，${getRepeatDescription(repeatConfig)}` : '';

                showMessage(t("batchSuccess", {
                    count: successCount.toString(),
                    spanning: spanningText,
                    date: dateStr,
                    failure: failureText
                }) + repeatText);
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
        // 每分钟检查一次提醒
        setInterval(() => {
            this.checkReminders();
        }, 60000);

        // 启动时立即检查一次
        setTimeout(() => {
            this.checkReminders();
        }, 5000);
    }

    private async checkReminders() {
        try {
            const { readReminderData, writeReminderData } = await import("./api");
            let reminderData = await readReminderData();

            // 检查数据是否有效，如果数据被损坏（包含错误信息），重新初始化
            if (!reminderData || typeof reminderData !== 'object' ||
                reminderData.hasOwnProperty('code') || reminderData.hasOwnProperty('msg')) {
                console.warn('检测到损坏的提醒数据，重新初始化:', reminderData);
                reminderData = {};
                await writeReminderData(reminderData);
                return;
            }

            const today = getLocalDateString(); // 使用本地日期
            const currentTime = getLocalTimeString(); // 使用本地时间
            let hasUpdates = false;

            // 检查 reminderData 的每个值是否有效
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

                if (reminder.completed) return;

                const isToday = reminder.date === today;
                const shouldRemind = isToday && (!reminder.time || reminder.time <= currentTime);

                if (shouldRemind && !reminder.notified) {
                    const noteText = reminder.note ? t("noteText", { note: reminder.note }) : '';
                    showMessage(t("reminderNotification", {
                        title: reminder.title || t("unnamedNote"),
                        note: noteText
                    }), 5000);
                    reminder.notified = true;
                    hasUpdates = true;
                }
            });

            // 更新通知状态和徽章
            if (hasUpdates) {
                await writeReminderData(reminderData);
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
