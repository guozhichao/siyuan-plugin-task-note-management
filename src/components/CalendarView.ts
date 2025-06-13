import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { showMessage, confirm, openTab, Menu, Dialog } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID, updateBlockReminderBookmark } from "../api";
import { getLocalDateString, getLocalDateTime } from "../utils/dateUtils";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { CategoryManager, Category } from "../utils/categoryManager";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { t } from "../utils/i18n";
import { generateRepeatInstances, RepeatInstance } from "../utils/repeatUtils";

export class CalendarView {
    private container: HTMLElement;
    private calendar: Calendar;
    private plugin: any;
    private resizeObserver: ResizeObserver;
    private resizeTimeout: number;
    private categoryManager: CategoryManager; // 添加分类管理器
    private currentCategoryFilter: string = 'all'; // 当前分类过滤
    private tooltip: HTMLElement | null = null; // 添加提示框元素
    private tooltipTimeout: number | null = null; // 添加提示框超时控制
    private tooltipShowTimeout: number | null = null; // 添加提示框显示延迟控制
    private isTooltipHovered: boolean = false; // 添加提示框悬浮状态

    constructor(container: HTMLElement, plugin: any) {
        this.container = container;
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance(); // 初始化分类管理器
        this.initUI();
    }

    private async initUI() {
        // 初始化分类管理器
        await this.categoryManager.initialize();

        this.container.classList.add('reminder-calendar-view');

        // 创建工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'reminder-calendar-toolbar';
        this.container.appendChild(toolbar);

        // 视图切换按钮
        const viewGroup = document.createElement('div');
        viewGroup.className = 'reminder-calendar-view-group';
        toolbar.appendChild(viewGroup);

        const monthBtn = document.createElement('button');
        monthBtn.className = 'b3-button b3-button--outline';
        monthBtn.textContent = t("month");
        monthBtn.addEventListener('click', () => this.calendar.changeView('dayGridMonth'));
        viewGroup.appendChild(monthBtn);

        const weekBtn = document.createElement('button');
        weekBtn.className = 'b3-button b3-button--outline';
        weekBtn.textContent = t("week");
        weekBtn.addEventListener('click', () => this.calendar.changeView('timeGridWeek'));
        viewGroup.appendChild(weekBtn);

        const dayBtn = document.createElement('button');
        dayBtn.className = 'b3-button b3-button--outline';
        dayBtn.textContent = t("day");
        dayBtn.addEventListener('click', () => this.calendar.changeView('timeGridDay'));
        viewGroup.appendChild(dayBtn);

        // 添加分类过滤器
        const filterGroup = document.createElement('div');
        filterGroup.className = 'reminder-calendar-filter-group';
        toolbar.appendChild(filterGroup);

        // 分类过滤下拉框
        const categoryFilterSelect = document.createElement('select');
        categoryFilterSelect.className = 'b3-select';
        categoryFilterSelect.addEventListener('change', () => {
            this.currentCategoryFilter = categoryFilterSelect.value;
            this.refreshEvents();
        });
        filterGroup.appendChild(categoryFilterSelect);

        // 渲染分类过滤器
        await this.renderCategoryFilter(categoryFilterSelect);

        // 分类管理按钮
        const categoryManageBtn = document.createElement('button');
        categoryManageBtn.className = 'b3-button b3-button--outline';
        categoryManageBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTags"></use></svg>';
        categoryManageBtn.title = "管理分类";
        categoryManageBtn.addEventListener('click', () => {
            this.showCategoryManageDialog(categoryFilterSelect);
        });
        filterGroup.appendChild(categoryManageBtn);

        // 创建日历容器
        const calendarEl = document.createElement('div');
        calendarEl.className = 'reminder-calendar-container';
        this.container.appendChild(calendarEl);

        // 初始化日历
        this.calendar = new Calendar(calendarEl, {
            plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
            initialView: 'dayGridMonth',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: ''
            },
            editable: true,
            selectable: true,
            locale: 'zh-cn',
            eventClassNames: 'reminder-calendar-event',
            eventContent: this.renderEventContent.bind(this),
            eventClick: this.handleEventClick.bind(this),
            eventDrop: this.handleEventDrop.bind(this),
            eventResize: this.handleEventResize.bind(this),
            dateClick: this.handleDateClick.bind(this),
            events: this.getEvents.bind(this),
            dayCellClassNames: (arg) => {
                const today = new Date();
                const cellDate = arg.date;

                if (cellDate.toDateString() === today.toDateString()) {
                    return ['fc-today-custom'];
                }
                return [];
            },
            eventDidMount: (info) => {
                info.el.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.showEventContextMenu(e, info.event);
                });

                // 改进的鼠标悬浮事件监听器 - 添加延迟显示
                info.el.addEventListener('mouseenter', (e) => {
                    this.scheduleShowEventTooltip(e, info.event);
                });

                info.el.addEventListener('mouseleave', () => {
                    this.cancelScheduledTooltip();
                    this.hideEventTooltipWithDelay();
                });

                // 鼠标移动时更新提示框位置
                info.el.addEventListener('mousemove', (e) => {
                    if (this.tooltip && this.tooltip.style.display !== 'none' && this.tooltip.style.opacity === '1') {
                        this.updateTooltipPosition(e);
                    }
                });
            }
        });

        this.calendar.render();

        // 添加自定义样式
        this.addCustomStyles();

        // 监听提醒更新事件
        window.addEventListener('reminderUpdated', () => this.refreshEvents());

        // 添加窗口大小变化监听器
        this.addResizeListeners();
    }

    private async renderCategoryFilter(selectElement: HTMLSelectElement) {
        try {
            const categories = this.categoryManager.getCategories();

            selectElement.innerHTML = `
                <option value="all" ${this.currentCategoryFilter === 'all' ? 'selected' : ''}>全部分类</option>
                <option value="none" ${this.currentCategoryFilter === 'none' ? 'selected' : ''}>无分类</option>
            `;

            categories.forEach(category => {
                const optionEl = document.createElement('option');
                optionEl.value = category.id;
                optionEl.textContent = `${category.icon || ''} ${category.name}`;
                optionEl.selected = this.currentCategoryFilter === category.id;
                selectElement.appendChild(optionEl);
            });

        } catch (error) {
            console.error('渲染分类过滤器失败:', error);
            selectElement.innerHTML = '<option value="all">全部分类</option>';
        }
    }

    private showCategoryManageDialog(categoryFilterSelect: HTMLSelectElement) {
        const categoryDialog = new CategoryManageDialog(() => {
            // 分类更新后重新渲染过滤器和事件
            this.renderCategoryFilter(categoryFilterSelect);
            this.refreshEvents();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        });
        categoryDialog.show();
    }

    private addResizeListeners() {
        // 窗口大小变化监听器
        const handleResize = () => {
            this.debounceResize();
        };

        window.addEventListener('resize', handleResize);

        // 使用 ResizeObserver 监听容器大小变化
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                this.debounceResize();
            });
            this.resizeObserver.observe(this.container);
        }

        // 监听标签页切换和显示事件
        const handleVisibilityChange = () => {
            if (!document.hidden && this.isCalendarVisible()) {
                this.debounceResize();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        // 监听标签页激活事件
        const handleTabShow = () => {
            if (this.isCalendarVisible()) {
                this.debounceResize();
            }
        };

        // 使用 MutationObserver 监听容器的显示状态变化
        const mutationObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' &&
                    (mutation.attributeName === 'style' || mutation.attributeName === 'class')) {
                    if (this.isCalendarVisible()) {
                        this.debounceResize();
                    }
                }
            });
        });

        // 监听父级容器的变化
        let currentElement = this.container.parentElement;
        while (currentElement) {
            mutationObserver.observe(currentElement, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
            currentElement = currentElement.parentElement;
            // 只监听几层父级，避免监听过多元素
            if (currentElement === document.body) break;
        }

        // 清理函数
        const cleanup = () => {
            window.removeEventListener('resize', handleResize);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (this.resizeObserver) {
                this.resizeObserver.disconnect();
            }
            mutationObserver.disconnect();
            if (this.resizeTimeout) {
                clearTimeout(this.resizeTimeout);
            }
            // 清理提示框超时
            if (this.tooltipTimeout) {
                clearTimeout(this.tooltipTimeout);
            }
            // 清理提示框显示延迟超时
            if (this.tooltipShowTimeout) {
                clearTimeout(this.tooltipShowTimeout);
            }
        };

        // 将清理函数绑定到容器，以便在组件销毁时调用
        (this.container as any)._calendarCleanup = cleanup;
    }

    private debounceResize() {
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }

        this.resizeTimeout = window.setTimeout(() => {
            if (this.calendar && this.isCalendarVisible()) {
                try {
                    this.calendar.updateSize();
                    this.calendar.render();
                } catch (error) {
                    console.error('重新渲染日历失败:', error);
                }
            }
        }, 100);
    }

    private isCalendarVisible(): boolean {
        // 检查容器是否可见
        const containerRect = this.container.getBoundingClientRect();
        const isVisible = containerRect.width > 0 && containerRect.height > 0;

        // 检查容器是否在视口中或父级容器是否可见
        const style = window.getComputedStyle(this.container);
        const isDisplayed = style.display !== 'none' && style.visibility !== 'hidden';

        return isVisible && isDisplayed;
    }

    private showEventContextMenu(event: MouseEvent, calendarEvent: any) {
        // 在显示右键菜单前先隐藏提示框
        if (this.tooltip) {
            this.hideEventTooltip();
            // 清除任何待执行的提示框超时
            if (this.tooltipTimeout) {
                clearTimeout(this.tooltipTimeout);
                this.tooltipTimeout = null;
            }
            this.isTooltipHovered = false;
        }

        const menu = new Menu("calendarEventContextMenu");

        menu.addItem({
            iconHTML: "📖",
            label: t("openNote"),
            click: () => {
                this.handleEventClick({ event: calendarEvent });
            }
        });

        // 对于重复事件实例，提供特殊选项
        if (calendarEvent.extendedProps.isRepeated) {
            menu.addItem({
                iconHTML: "📝",
                label: t("modifyThisInstance"),
                click: () => {
                    this.showInstanceEditDialog(calendarEvent);
                }
            });

            menu.addItem({
                iconHTML: "📝",
                label: t("modifyAllInstances"),
                click: () => {
                    this.showTimeEditDialogForSeries(calendarEvent);
                }
            });
        } else if (calendarEvent.extendedProps.repeat?.enabled) {
            // 对于周期原始事件，提供与实例一致的选项
            menu.addItem({
                iconHTML: "📝",
                label: t("modifyThisInstance"),
                click: () => {
                    this.splitRecurringEvent(calendarEvent);
                }
            });

            menu.addItem({
                iconHTML: "📝",
                label: t("modifyAllInstances"),
                click: () => {
                    this.showTimeEditDialog(calendarEvent);
                }
            });
        } else {
            menu.addItem({
                iconHTML: "📝",
                label: t("modify"),
                click: () => {
                    this.showTimeEditDialog(calendarEvent);
                }
            });
        }

        menu.addItem({
            iconHTML: "✅",
            label: calendarEvent.extendedProps.completed ? t("markAsUncompleted") : t("markAsCompleted"),
            click: () => {
                this.toggleEventCompleted(calendarEvent);
            }
        });

        menu.addSeparator();

        // 添加优先级设置子菜单
        const priorityMenuItems = [];
        const priorities = [
            { key: 'high', label: t("high"), color: '#e74c3c', icon: '🔴' },
            { key: 'medium', label: t("medium"), color: '#f39c12', icon: '🟡' },
            { key: 'low', label: t("low"), color: '#3498db', icon: '🔵' },
            { key: 'none', label: t("none"), color: '#95a5a6', icon: '⚫' }
        ];

        priorities.forEach(priority => {
            priorityMenuItems.push({
                iconHTML: priority.icon,
                label: priority.label,
                click: () => {
                    this.setPriority(calendarEvent, priority.key);
                }
            });
        });

        menu.addItem({
            iconHTML: "🎯",
            label: t("setPriority"),
            submenu: priorityMenuItems
        });

        menu.addItem({
            iconHTML: calendarEvent.allDay ? "⏰" : "📅",
            label: calendarEvent.allDay ? t("changeToTimed") : t("changeToAllDay"),
            click: () => {
                this.toggleAllDayEvent(calendarEvent);
            }
        });

        menu.addSeparator();

        // 添加复制块引选项
        menu.addItem({
            iconHTML: "📋",
            label: "复制块引",
            click: () => {
                this.copyBlockRef(calendarEvent);
            }
        });

        menu.addSeparator();

        if (calendarEvent.extendedProps.isRepeated) {
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteThisInstance"),
                click: () => {
                    this.deleteInstanceOnly(calendarEvent);
                }
            });

            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteAllInstances"),
                click: () => {
                    this.deleteEvent(calendarEvent);
                }
            });
        } else if (calendarEvent.extendedProps.repeat?.enabled) {
            // 对于周期原始事件，提供与实例一致的删除选项
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteThisInstance"),
                click: () => {
                    this.skipFirstOccurrence(calendarEvent);
                }
            });

            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteAllInstances"),
                click: () => {
                    this.deleteEvent(calendarEvent);
                }
            });
        } else {
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteReminder"),
                click: () => {
                    this.deleteEvent(calendarEvent);
                }
            });
        }

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async showInstanceEditDialog(calendarEvent: any) {
        // 为重复事件实例显示编辑对话框
        const originalId = calendarEvent.extendedProps.originalId;
        const instanceDate = calendarEvent.extendedProps.date;

        try {
            const reminderData = await readReminderData();
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                showMessage(t("reminderDataNotExist"));
                return;
            }

            // 检查实例级别的修改（包括备注）
            const instanceModifications = originalReminder.repeat?.instanceModifications || {};
            const instanceMod = instanceModifications[instanceDate];

            // 创建实例数据，包含当前实例的特定信息
            const instanceData = {
                ...originalReminder,
                id: calendarEvent.id,
                date: calendarEvent.extendedProps.date,
                endDate: calendarEvent.extendedProps.endDate,
                time: calendarEvent.extendedProps.time,
                endTime: calendarEvent.extendedProps.endTime,
                // 修改备注逻辑：只有实例有明确的备注时才使用，否则为空
                note: instanceMod?.note || '',  // 每个实例的备注都是独立的，默认为空
                isInstance: true,
                originalId: originalId,
                instanceDate: instanceDate
            };

            const editDialog = new ReminderEditDialog(instanceData, async () => {
                await this.refreshEvents();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            });
            editDialog.show();
        } catch (error) {
            console.error('打开实例编辑对话框失败:', error);
            showMessage(t("openModifyDialogFailed"));
        }
    }

    private async deleteInstanceOnly(calendarEvent: any) {
        // 删除重复事件的单个实例
        const result = await confirm(
            t("deleteThisInstance"),
            t("confirmDeleteInstance"),
            async () => {
                try {
                    const originalId = calendarEvent.extendedProps.originalId;
                    const instanceDate = calendarEvent.extendedProps.date;

                    await this.addExcludedDate(originalId, instanceDate);

                    showMessage(t("instanceDeleted"));
                    await this.refreshEvents();
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                } catch (error) {
                    console.error('删除重复实例失败:', error);
                    showMessage(t("deleteInstanceFailed"));
                }
            }
        );
    }
    private async addExcludedDate(originalId: string, excludeDate: string) {
        // 为原始重复事件添加排除日期
        try {
            const reminderData = await readReminderData();

            if (reminderData[originalId]) {
                if (!reminderData[originalId].repeat) {
                    throw new Error('不是重复事件');
                }

                // 初始化排除日期列表
                if (!reminderData[originalId].repeat.excludeDates) {
                    reminderData[originalId].repeat.excludeDates = [];
                }

                // 添加排除日期（如果还没有的话）
                if (!reminderData[originalId].repeat.excludeDates.includes(excludeDate)) {
                    reminderData[originalId].repeat.excludeDates.push(excludeDate);
                }

                await writeReminderData(reminderData);
            } else {
                throw new Error('原始事件不存在');
            }
        } catch (error) {
            console.error('添加排除日期失败:', error);
            throw error;
        }
    }
    // 添加复制块引功能
    private async copyBlockRef(calendarEvent: any) {
        try {
            // 获取块ID
            const blockId = calendarEvent.extendedProps.blockId;

            if (!blockId) {
                showMessage("无法获取块ID");
                return;
            }

            // 获取事件标题（移除可能存在的分类图标前缀）
            let title = calendarEvent.title || t("unnamedNote");

            // 移除分类图标（如果存在）
            if (calendarEvent.extendedProps.categoryId) {
                const category = this.categoryManager.getCategoryById(calendarEvent.extendedProps.categoryId);
                if (category && category.icon) {
                    const iconPrefix = `${category.icon} `;
                    if (title.startsWith(iconPrefix)) {
                        title = title.substring(iconPrefix.length);
                    }
                }
            }

            // 生成静态锚文本块引格式
            const blockRef = `((${blockId} "${title}"))`;

            // 复制到剪贴板
            await navigator.clipboard.writeText(blockRef);
            // showMessage("块引已复制到剪贴板");

        } catch (error) {
            console.error('复制块引失败:', error);
            showMessage("复制块引失败");
        }
    }

    private async setPriority(calendarEvent: any, priority: string) {
        try {
            // 获取正确的提醒ID - 对于重复事件实例，使用原始ID
            const reminderId = calendarEvent.extendedProps.isRepeated ?
                calendarEvent.extendedProps.originalId :
                calendarEvent.id;

            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                reminderData[reminderId].priority = priority;
                await writeReminderData(reminderData);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                // 立即刷新事件显示
                await this.refreshEvents();

                const priorityNames = {
                    'high': t("high"),
                    'medium': t("medium"),
                    'low': t("low"),
                    'none': t("none")
                };
                showMessage(t("prioritySet", { priority: priorityNames[priority] }));
            }
        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage(t("setPriorityFailed"));
        }
    }

    private async deleteEvent(calendarEvent: any) {
        const reminder = calendarEvent.extendedProps;

        // 对于重复事件实例，删除的是整个系列
        if (calendarEvent.extendedProps.isRepeated) {
            const result = await confirm(
                t("deleteAllInstances"),
                t("confirmDelete", { title: calendarEvent.title }),
                () => {
                    this.performDeleteEvent(calendarEvent.extendedProps.originalId);
                }
            );
        } else {
            const result = await confirm(
                t("deleteReminder"),
                t("confirmDelete", { title: calendarEvent.title }),
                () => {
                    this.performDeleteEvent(calendarEvent.id);
                }
            );
        }
    }

    private async performDeleteEvent(reminderId: string) {
        try {
            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                const blockId = reminderData[reminderId].blockId;
                delete reminderData[reminderId];
                await writeReminderData(reminderData);

                // 更新块的书签状态
                if (blockId) {
                    await updateBlockReminderBookmark(blockId);
                }

                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                // 立即刷新事件显示
                await this.refreshEvents();

                showMessage(t("reminderDeleted"));
            } else {
                showMessage(t("reminderNotExist"));
            }
        } catch (error) {
            console.error('删除提醒失败:', error);
            showMessage(t("deleteReminderFailed"));
        }
    }

    private renderEventContent(eventInfo) {
        const wrapper = document.createElement('div');
        wrapper.className = 'reminder-calendar-event-wrapper';

        // 添加复选框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'reminder-calendar-event-checkbox';
        checkbox.checked = eventInfo.event.extendedProps.completed || false;
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            this.toggleEventCompleted(eventInfo.event);
        });

        // 添加事件内容
        const eventEl = document.createElement('div');
        eventEl.className = 'reminder-calendar-event-content';
        // 移除这里的 completed 类设置，因为现在由 FullCalendar 的 className 处理
        eventEl.innerHTML = `<div class="fc-event-title">${eventInfo.event.title}</div>`;

        if (eventInfo.event.extendedProps.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-calendar-event-note';
            noteEl.textContent = eventInfo.event.extendedProps.note;
            eventEl.appendChild(noteEl);
        }

        // 添加重复图标（如果是重复事件）
        if (eventInfo.event.extendedProps.isRepeated || eventInfo.event.extendedProps.repeat?.enabled) {
            const repeatIcon = document.createElement('div');
            repeatIcon.className = 'reminder-repeat-indicator';

            if (eventInfo.event.extendedProps.isRepeated) {
                // 重复事件实例
                repeatIcon.classList.add('instance');
                repeatIcon.innerHTML = '🔄';
                repeatIcon.title = t("repeatInstance");
            } else if (eventInfo.event.extendedProps.repeat?.enabled) {
                // 原始重复事件
                repeatIcon.classList.add('recurring');
                repeatIcon.innerHTML = '🔁';
                repeatIcon.title = t("repeatSeries");
            }

            wrapper.appendChild(repeatIcon);
        }

        wrapper.appendChild(checkbox);
        wrapper.appendChild(eventEl);

        return { domNodes: [wrapper] };
    }

    private async toggleEventCompleted(event) {
        try {
            const reminderData = await readReminderData();

            if (event.extendedProps.isRepeated) {
                // 处理重复事件实例
                const originalId = event.extendedProps.originalId;
                const instanceDate = event.extendedProps.date;

                if (reminderData[originalId]) {
                    // 初始化已完成实例列表
                    if (!reminderData[originalId].repeat) {
                        reminderData[originalId].repeat = {};
                    }
                    if (!reminderData[originalId].repeat.completedInstances) {
                        reminderData[originalId].repeat.completedInstances = [];
                    }

                    const completedInstances = reminderData[originalId].repeat.completedInstances;
                    const isCompleted = completedInstances.includes(instanceDate);

                    if (isCompleted) {
                        // 从已完成列表中移除
                        const index = completedInstances.indexOf(instanceDate);
                        if (index > -1) {
                            completedInstances.splice(index, 1);
                        }
                    } else {
                        // 添加到已完成列表
                        completedInstances.push(instanceDate);
                    }

                    await writeReminderData(reminderData);

                    // 更新块的书签状态
                    const blockId = reminderData[originalId].blockId;
                    if (blockId) {
                        await updateBlockReminderBookmark(blockId);
                    }

                    // 触发更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));

                    // 立即刷新事件显示
                    await this.refreshEvents();
                }
            } else {
                // 处理普通事件
                const reminderId = event.id;

                if (reminderData[reminderId]) {
                    const blockId = reminderData[reminderId].blockId;
                    reminderData[reminderId].completed = !reminderData[reminderId].completed;
                    await writeReminderData(reminderData);

                    // 更新块的书签状态
                    if (blockId) {
                        await updateBlockReminderBookmark(blockId);
                    }

                    // 更新事件的显示状态
                    event.setExtendedProp('completed', reminderData[reminderId].completed);

                    // 触发更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));

                    // 立即刷新事件显示
                    await this.refreshEvents();
                }
            }
        } catch (error) {
            console.error('切换事件完成状态失败:', error);
            showMessage('切换完成状态失败，请重试');
        }
    }

    private async handleEventClick(info) {
        const reminder = info.event.extendedProps;
        const blockId = reminder.blockId || info.event.id; // 兼容旧数据格式

        try {
            // 检测块是否存在
            const block = await getBlockByID(blockId);
            if (!block) {
                throw new Error('块不存在');
            }


            openTab({
                app: window.siyuan.ws.app,
                doc: {
                    id: blockId,
                    action: "cb-get-hl",
                    zoomIn: false
                },
            });
        } catch (error) {
            console.error('打开笔记失败:', error);

            // 询问用户是否删除无效的提醒
            const result = await confirm(
                t("openNoteFailedDelete"),
                t("noteBlockDeleted"),
                async () => {
                    // 删除当前提醒
                    await this.performDeleteEvent(info.event.id);
                },
                () => {
                    showMessage(t("openNoteFailed"));
                }
            );
        }
    }

    private async handleEventDrop(info) {
        const reminderId = info.event.id;
        const originalReminder = info.event.extendedProps;

        // 如果是重复事件实例，询问用户如何应用更改
        if (originalReminder.isRepeated) {
            const result = await this.askApplyToAllInstances();

            if (result === 'cancel') {
                info.revert();
                return;
            }

            if (result === 'single') {
                // 只更新当前实例
                await this.updateSingleInstance(info);
                return;
            }

            if (result === 'all') {
                // 更新此实例及所有未来实例
                await this.updateRecurringEventSeries(info);
                return;
            }
        } else {
            // 非重复事件，或重复事件的原始事件，直接更新
            await this.updateEventTime(reminderId, info, false);
        }
    }

    private async handleEventResize(info) {
        const reminderId = info.event.id;
        const originalReminder = info.event.extendedProps;

        // 如果是重复事件实例，询问用户如何应用更改
        if (originalReminder.isRepeated) {
            const result = await this.askApplyToAllInstances();

            if (result === 'cancel') {
                info.revert();
                return;
            }

            if (result === 'single') {
                // 只更新当前实例
                await this.updateSingleInstance(info);
                return;
            }

            if (result === 'all') {
                // 更新此实例及所有未来实例
                await this.updateRecurringEventSeries(info);
                return;
            }
        } else {
            // 非重复事件，或重复事件的原始事件，直接更新
            await this.updateEventTime(reminderId, info, true);
        }
    }

    private async updateRecurringEventSeries(info: any) {
        try {
            const originalId = info.event.extendedProps.originalId;
            const reminderData = await readReminderData();
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                throw new Error('Original reminder not found.');
            }

            const oldInstanceDateStr = info.oldEvent.startStr.split('T')[0];
            const originalSeriesStartDate = new Date(originalReminder.date + 'T00:00:00Z');
            const movedInstanceOriginalDate = new Date(oldInstanceDateStr + 'T00:00:00Z');

            // 如果用户拖动了系列中的第一个事件，我们将更新整个系列的开始日期
            if (originalSeriesStartDate.getTime() === movedInstanceOriginalDate.getTime()) {
                await this.updateEventTime(originalId, info, info.event.end !== info.oldEvent.end);
                return;
            }

            // 用户拖动了后续实例。我们必须"分割"系列。
            // 1. 在拖动实例原始日期的前一天结束原始系列。
            const untilDate = new Date(oldInstanceDateStr + 'T12:00:00Z'); // 使用中午以避免夏令时问题
            untilDate.setUTCDate(untilDate.getUTCDate() - 1);
            const newEndDateStr = untilDate.toISOString().split('T')[0];

            // 根据用户反馈，使用 `repeat.endDate` 而不是 `repeat.until` 来终止系列。
            if (!originalReminder.repeat) { originalReminder.repeat = {}; }
            originalReminder.repeat.endDate = newEndDateStr;

            // 2. 为新的、修改过的系列创建一个新的重复事件。
            const newReminder = JSON.parse(JSON.stringify(originalReminder));

            // 清理新提醒以开始新的生命周期。
            // 它不应从原始事件继承系列结束日期。
            delete newReminder.repeat.endDate;
            // 同时清除旧系列的实例特定数据。
            delete newReminder.repeat.excludeDates;
            delete newReminder.repeat.instanceModifications;
            delete newReminder.repeat.completedInstances;

            // 使用原始事件的blockId生成新的提醒ID
            const blockId = originalReminder.blockId || originalReminder.id;
            const newId = `${blockId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            newReminder.id = newId;

            // 3. 根据拖放信息更新这个新系列的日期/时间。
            const newStart = info.event.start;
            const newEnd = info.event.end;

            const { dateStr, timeStr } = getLocalDateTime(newStart);
            newReminder.date = dateStr; // 这是新系列的开始日期

            if (info.event.allDay) {
                delete newReminder.time;
                delete newReminder.endTime;
                delete newReminder.endDate; // 重置并在下面重新计算
            } else {
                newReminder.time = timeStr || null;
            }

            if (newEnd) {
                if (info.event.allDay) {
                    const inclusiveEnd = new Date(newEnd);
                    inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
                    const { dateStr: endDateStr } = getLocalDateTime(inclusiveEnd);
                    if (endDateStr !== newReminder.date) {
                        newReminder.endDate = endDateStr;
                    }
                } else {
                    const { dateStr: endDateStr, timeStr: endTimeStr } = getLocalDateTime(newEnd);
                    if (endDateStr !== newReminder.date) {
                        newReminder.endDate = endDateStr;
                    } else {
                        delete newReminder.endDate;
                    }
                    newReminder.endTime = endTimeStr || null;
                }
            } else {
                delete newReminder.endDate;
                delete newReminder.endTime;
            }

            // 4. 保存修改后的原始提醒和新的提醒。
            reminderData[originalId] = originalReminder;
            reminderData[newId] = newReminder;
            await writeReminderData(reminderData);

            showMessage(t("eventTimeUpdated"));
            await this.refreshEvents();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('更新重复事件系列失败:', error);
            showMessage(t("operationFailed"));
            info.revert();
        }
    }

    private async askApplyToAllInstances(): Promise<'single' | 'all' | 'cancel'> {
        return new Promise((resolve) => {
            const dialog = new Dialog({
                title: t("modifyRepeatEvent"),
                content: `
                    <div class="b3-dialog__content">
                        <div style="margin-bottom: 16px;">${t("howToApplyChanges")}</div>
                        <div class="fn__flex fn__flex-justify-center" style="gap: 8px;">
                            <button class="b3-button" id="btn-single">${t("onlyThisInstance")}</button>
                            <button class="b3-button b3-button--primary" id="btn-all">${t("allInstances")}</button>
                            <button class="b3-button b3-button--cancel" id="btn-cancel">${t("cancel")}</button>
                        </div>
                    </div>
                `,
                width: "400px",
                height: "200px"
            });

            // 等待对话框渲染完成后添加事件监听器
            setTimeout(() => {
                const singleBtn = dialog.element.querySelector('#btn-single');
                const allBtn = dialog.element.querySelector('#btn-all');
                const cancelBtn = dialog.element.querySelector('#btn-cancel');

                if (singleBtn) {
                    singleBtn.addEventListener('click', () => {
                        dialog.destroy();
                        resolve('single');
                    });
                }

                if (allBtn) {
                    allBtn.addEventListener('click', () => {
                        dialog.destroy();
                        resolve('all');
                    });
                }

                if (cancelBtn) {
                    cancelBtn.addEventListener('click', () => {
                        dialog.destroy();
                        resolve('cancel');
                    });
                }

                // 处理对话框关闭事件
                const closeBtn = dialog.element.querySelector('.b3-dialog__close');
                if (closeBtn) {
                    closeBtn.addEventListener('click', () => {
                        dialog.destroy();
                        resolve('cancel');
                    });
                }
            }, 100);
        });
    }

    private async updateSingleInstance(info) {
        try {
            const originalId = info.event.extendedProps.originalId;
            const instanceDate = info.event.extendedProps.date;
            const newStartDate = info.event.start;
            const newEndDate = info.event.end;

            // 检查是否需要重置通知状态
            const shouldResetNotified = this.shouldResetNotification(newStartDate, info.event.allDay);

            // 创建实例修改数据
            const instanceModification = {
                title: info.event.title.replace(/^🔄 /, ''), // 移除重复标识
                priority: info.event.extendedProps.priority,
                note: info.event.extendedProps.note,
                notified: shouldResetNotified ? false : info.event.extendedProps.notified
            };

            // 使用本地时间处理日期和时间
            const { dateStr: startDateStr, timeStr: startTimeStr } = getLocalDateTime(newStartDate);

            if (newEndDate) {
                if (info.event.allDay) {
                    // 全天事件：FullCalendar 的结束日期是排他的，需要减去一天
                    const endDate = new Date(newEndDate);
                    endDate.setDate(endDate.getDate() - 1);
                    const { dateStr: endDateStr } = getLocalDateTime(endDate);

                    instanceModification.date = startDateStr;
                    if (endDateStr !== startDateStr) {
                        instanceModification.endDate = endDateStr;
                    }
                } else {
                    // 定时事件
                    const { dateStr: endDateStr, timeStr: endTimeStr } = getLocalDateTime(newEndDate);

                    instanceModification.date = startDateStr;
                    if (startTimeStr) {
                        instanceModification.time = startTimeStr;
                    }

                    if (endDateStr !== startDateStr) {
                        instanceModification.endDate = endDateStr;
                        if (endTimeStr) {
                            instanceModification.endTime = endTimeStr;
                        }
                    } else {
                        if (endTimeStr) {
                            instanceModification.endTime = endTimeStr;
                        }
                    }
                }
            } else {
                // 单日事件
                instanceModification.date = startDateStr;
                if (!info.event.allDay && startTimeStr) {
                    instanceModification.time = startTimeStr;
                }
            }

            // 保存实例修改
            await this.saveInstanceModification({
                originalId,
                instanceDate,
                ...instanceModification
            });

            showMessage(t("instanceTimeUpdated"));
            await this.refreshEvents();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('更新单个实例失败:', error);
            showMessage(t("updateInstanceFailed"));
            info.revert();
        }
    }

    private async updateEventTime(reminderId: string, info, isResize: boolean) {
        try {
            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                const newStartDate = info.event.start;
                const newEndDate = info.event.end;

                // 使用本地时间处理日期和时间
                const { dateStr: startDateStr, timeStr: startTimeStr } = getLocalDateTime(newStartDate);

                // 检查是否需要重置通知状态
                const shouldResetNotified = this.shouldResetNotification(newStartDate, info.event.allDay);

                if (newEndDate) {
                    if (info.event.allDay) {
                        // 全天事件：FullCalendar 的结束日期是排他的，需要减去一天
                        const endDate = new Date(newEndDate);
                        endDate.setDate(endDate.getDate() - 1);
                        const { dateStr: endDateStr } = getLocalDateTime(endDate);

                        reminderData[reminderId].date = startDateStr;

                        if (endDateStr !== startDateStr) {
                            reminderData[reminderId].endDate = endDateStr;
                        } else {
                            delete reminderData[reminderId].endDate;
                        }

                        // 全天事件删除时间信息
                        delete reminderData[reminderId].time;
                        delete reminderData[reminderId].endTime;
                    } else {
                        // 定时事件：使用本地时间处理
                        const { dateStr: endDateStr, timeStr: endTimeStr } = getLocalDateTime(newEndDate);

                        reminderData[reminderId].date = startDateStr;

                        if (startTimeStr) {
                            reminderData[reminderId].time = startTimeStr;
                        }

                        if (endDateStr !== startDateStr) {
                            // 跨天的定时事件
                            reminderData[reminderId].endDate = endDateStr;
                            if (endTimeStr) {
                                reminderData[reminderId].endTime = endTimeStr;
                            }
                        } else {
                            // 同一天的定时事件
                            delete reminderData[reminderId].endDate;
                            if (endTimeStr) {
                                reminderData[reminderId].endTime = endTimeStr;
                            } else {
                                delete reminderData[reminderId].endTime;
                            }
                        }
                    }
                } else {
                    // 单日事件
                    reminderData[reminderId].date = startDateStr;
                    delete reminderData[reminderId].endDate;
                    delete reminderData[reminderId].endTime;

                    if (!info.event.allDay && startTimeStr) {
                        reminderData[reminderId].time = startTimeStr;
                    } else if (info.event.allDay) {
                        delete reminderData[reminderId].time;
                    }
                }

                // 重置通知状态
                if (shouldResetNotified) {
                    reminderData[reminderId].notified = false;
                }

                await writeReminderData(reminderData);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                showMessage(t("eventTimeUpdated"));

                // 立即刷新事件显示
                await this.refreshEvents();
            } else {
                throw new Error('提醒数据不存在');
            }
        } catch (error) {
            console.error(isResize ? '调整事件大小失败:' : '更新事件时间失败:', error);
            showMessage(t("operationFailed"));
            info.revert();
        }
    }

    private shouldResetNotification(newStartDate: Date, isAllDay: boolean): boolean {
        try {
            const now = new Date();

            // 对于全天事件，只比较日期；对于定时事件，比较完整的日期时间
            if (isAllDay) {
                const newDateOnly = new Date(newStartDate.getFullYear(), newStartDate.getMonth(), newStartDate.getDate());
                const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                return newDateOnly >= todayOnly;
            } else {
                return newStartDate > now;
            }
        } catch (error) {
            console.error('检查通知重置条件失败:', error);
            return false;
        }
    }

    private async saveInstanceModification(instanceData: any) {
        // 保存重复事件实例的修改
        try {
            const originalId = instanceData.originalId;
            const instanceDate = instanceData.instanceDate;

            const reminderData = await readReminderData();

            if (!reminderData[originalId]) {
                throw new Error('原始事件不存在');
            }

            // 初始化实例修改列表
            if (!reminderData[originalId].repeat.instanceModifications) {
                reminderData[originalId].repeat.instanceModifications = {};
            }

            // 保存此实例的修改数据
            reminderData[originalId].repeat.instanceModifications[instanceDate] = {
                title: instanceData.title,
                date: instanceData.date,
                endDate: instanceData.endDate,
                time: instanceData.time,
                endTime: instanceData.endTime,
                note: instanceData.note,
                priority: instanceData.priority,
                notified: instanceData.notified, // 添加通知状态
                modifiedAt: new Date().toISOString()
            };

            await writeReminderData(reminderData);

        } catch (error) {
            console.error('保存实例修改失败:', error);
            throw error;
        }
    }

    private addCustomStyles() {
        // 检查是否已经添加过样式
        if (document.querySelector('#reminder-calendar-custom-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'reminder-calendar-custom-styles';
        style.textContent = `
            .fc-today-custom {
                background-color:hsl(120, 42.90%, 95.90%) !important;
            }
            .fc-today-custom:hover {
                background-color: #e8f5e8 !important;
            }
        `;
        document.head.appendChild(style);
    }

    private async showTimeEditDialog(calendarEvent: any) {
        try {
            // 对于重复事件实例，需要使用原始ID来获取原始提醒数据
            const reminderId = calendarEvent.extendedProps.isRepeated ?
                calendarEvent.extendedProps.originalId :
                calendarEvent.id;

            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                const reminder = reminderData[reminderId];

                const editDialog = new ReminderEditDialog(reminder, async () => {
                    // 刷新日历事件
                    await this.refreshEvents();

                    // 触发全局更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                });

                editDialog.show();
            } else {
                showMessage(t("reminderDataNotExist"));
            }
        } catch (error) {
            console.error('打开修改对话框失败:', error);
            showMessage(t("openModifyDialogFailed"));
        }
    }

    private async showTimeEditDialogForSeries(calendarEvent: any) {
        try {
            // 获取原始重复事件的ID
            const originalId = calendarEvent.extendedProps.isRepeated ?
                calendarEvent.extendedProps.originalId :
                calendarEvent.id;

            const reminderData = await readReminderData();

            if (reminderData[originalId]) {
                const reminder = reminderData[originalId];

                const editDialog = new ReminderEditDialog(reminder, async () => {
                    // 刷新日历事件
                    await this.refreshEvents();

                    // 触发全局更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                });

                editDialog.show();
            } else {
                showMessage(t("reminderDataNotExist"));
            }
        } catch (error) {
            console.error('打开系列修改对话框失败:', error);
            showMessage(t("openModifyDialogFailed"));
        }
    }

    private async toggleAllDayEvent(calendarEvent: any) {
        try {
            // 获取正确的提醒ID - 对于重复事件实例，使用原始ID
            const reminderId = calendarEvent.extendedProps.isRepeated ?
                calendarEvent.extendedProps.originalId :
                calendarEvent.id;

            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                if (calendarEvent.allDay) {
                    // 从全天改为定时：添加默认时间
                    reminderData[reminderId].time = "09:00";
                    delete reminderData[reminderId].endTime;
                } else {
                    // 从定时改为全天：删除时间信息
                    delete reminderData[reminderId].time;
                    delete reminderData[reminderId].endTime;
                }

                await writeReminderData(reminderData);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                // 立即刷新事件显示
                await this.refreshEvents();

                showMessage(calendarEvent.allDay ? t("changedToTimed") : t("changedToAllDay"));
            }
        } catch (error) {
            console.error('切换全天事件失败:', error);
            showMessage(t("toggleAllDayFailed"));
        }
    }

    private handleDateClick(info) {
        // 点击日期，可以添加新的提醒
        const date = info.dateStr;
        // 这里可以打开创建提醒对话框，但需要选择一个块ID
        showMessage(t("selectBlockFirst"));
    }

    private async refreshEvents() {
        try {
            // 先获取新的事件数据
            const events = await this.getEvents();

            // 清除所有现有事件
            this.calendar.removeAllEvents();

            // 添加新事件 - 直接使用数组而不是事件源
            events.forEach(event => {
                this.calendar.addEvent(event);
            });

            // 强制重新渲染日历并更新大小
            if (this.isCalendarVisible()) {
                this.calendar.updateSize();
                this.calendar.render();
            }
        } catch (error) {
            console.error('刷新事件失败:', error);
        }
    }

    private async getEvents() {
        try {
            const reminderData = await readReminderData();
            const events = [];

            // 获取当前视图的日期范围
            let startDate, endDate;
            if (this.calendar && this.calendar.view) {
                const currentView = this.calendar.view;
                startDate = currentView.activeStart.toISOString().split('T')[0];
                endDate = currentView.activeEnd.toISOString().split('T')[0];
            } else {
                const now = new Date();
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                startDate = monthStart.toISOString().split('T')[0];
                endDate = monthEnd.toISOString().split('T')[0];
            }

            Object.values(reminderData).forEach((reminder: any) => {
                if (!reminder || typeof reminder !== 'object') return;

                // 应用分类过滤
                if (!this.passesCategoryFilter(reminder)) return;

                // 添加原始事件
                this.addEventToList(events, reminder, reminder.id, false);

                // 如果有重复设置，生成重复事件实例
                if (reminder.repeat?.enabled) {
                    const repeatInstances = generateRepeatInstances(reminder, startDate, endDate);
                    repeatInstances.forEach(instance => {
                        // 跳过与原始事件相同日期的实例
                        if (instance.date !== reminder.date) {
                            // 检查实例级别的完成状态
                            const completedInstances = reminder.repeat?.completedInstances || [];
                            const isInstanceCompleted = completedInstances.includes(instance.date);

                            // 检查实例级别的修改
                            const instanceModifications = reminder.repeat?.instanceModifications || {};
                            const instanceMod = instanceModifications[instance.date];

                            const instanceReminder = {
                                ...reminder,
                                date: instance.date,
                                endDate: instance.endDate,
                                time: instance.time,
                                endTime: instance.endTime,
                                completed: isInstanceCompleted,
                                note: instanceMod?.note || ''
                            };
                            this.addEventToList(events, instanceReminder, instance.instanceId, true, instance.originalId);
                        }
                    });
                }
            });

            return events;
        } catch (error) {
            console.error('获取事件数据失败:', error);
            showMessage(t("loadReminderDataFailed"));
            return [];
        }
    }

    private passesCategoryFilter(reminder: any): boolean {
        if (this.currentCategoryFilter === 'all') {
            return true;
        }

        if (this.currentCategoryFilter === 'none') {
            return !reminder.categoryId;
        }

        return reminder.categoryId === this.currentCategoryFilter;
    }

    private addEventToList(events: any[], reminder: any, eventId: string, isRepeated: boolean, originalId?: string) {
        const priority = reminder.priority || 'none';
        let backgroundColor, borderColor;

        // 如果有分类，使用分类颜色；否则使用优先级颜色
        if (reminder.categoryId) {
            const categoryStyle = this.categoryManager.getCategoryStyle(reminder.categoryId);
            backgroundColor = categoryStyle.backgroundColor;
            borderColor = categoryStyle.borderColor;
        } else {
            // 根据优先级设置颜色
            switch (priority) {
                case 'high':
                    backgroundColor = '#e74c3c';
                    borderColor = '#c0392b';
                    break;
                case 'medium':
                    backgroundColor = '#f39c12';
                    borderColor = '#e67e22';
                    break;
                case 'low':
                    backgroundColor = '#3498db';
                    borderColor = '#2980b9';
                    break;
                default:
                    backgroundColor = '#95a5a6';
                    borderColor = '#7f8c8d';
                    break;
            }
        }

        // 检查完成状态
        let isCompleted = false;
        if (isRepeated && originalId) {
            isCompleted = reminder.completed || false;
        } else {
            isCompleted = reminder.completed || false;
        }

        // 如果任务已完成，使用灰色
        if (isCompleted) {
            backgroundColor = '#e3e3e3';
            borderColor = '#e3e3e3';
        }

        // 重复事件使用稍微不同的样式
        if (isRepeated) {
            backgroundColor = backgroundColor + 'dd';
            borderColor = borderColor + 'dd';
        }

        // 构建 className，包含已完成状态
        const classNames = [
            `reminder-priority-${priority}`,
            isRepeated ? 'reminder-repeated' : '',
            isCompleted ? 'completed' : '' // 将 completed 类添加到 FullCalendar 事件元素上
        ].filter(Boolean).join(' ');

        let eventObj: any = {
            id: eventId,
            title: reminder.title || t("unnamedNote"), // 移除标题前的重复图标
            backgroundColor: backgroundColor,
            borderColor: borderColor,
            textColor: isCompleted ? '#999999' : '#ffffff',
            className: classNames, // 使用构建的 className
            extendedProps: {
                completed: isCompleted,
                note: reminder.note || '',
                date: reminder.date,
                endDate: reminder.endDate || null,
                time: reminder.time || null,
                endTime: reminder.endTime || null,
                priority: priority,
                categoryId: reminder.categoryId,
                blockId: reminder.blockId || reminder.id,
                isRepeated: isRepeated,
                originalId: originalId || reminder.id,
                repeat: reminder.repeat
            }
        };

        // 处理跨天事件
        if (reminder.endDate) {
            if (reminder.time && reminder.endTime) {
                eventObj.start = `${reminder.date}T${reminder.time}:00`;
                eventObj.end = `${reminder.endDate}T${reminder.endTime}:00`;
                eventObj.allDay = false;
            } else {
                eventObj.start = reminder.date;
                const endDate = new Date(reminder.endDate);
                endDate.setDate(endDate.getDate() + 1);
                eventObj.end = endDate.toISOString().split('T')[0];
                eventObj.allDay = true;

                if (reminder.time) {
                    eventObj.title = `${reminder.title || t("unnamedNote")} (${reminder.time})`;
                }
            }
        } else {
            if (reminder.time) {
                eventObj.start = `${reminder.date}T${reminder.time}:00`;
                if (reminder.endTime) {
                    eventObj.end = `${reminder.date}T${reminder.endTime}:00`;
                } else {
                    // 对于只有开始时间的提醒，设置30分钟的默认持续时间，但确保不跨天
                    const startTime = new Date(`${reminder.date}T${reminder.time}:00`);
                    const endTime = new Date(startTime);
                    endTime.setMinutes(endTime.getMinutes() + 30);

                    // 检查是否跨天，如果跨天则设置为当天23:59
                    if (endTime.getDate() !== startTime.getDate()) {
                        endTime.setDate(startTime.getDate());
                        endTime.setHours(23, 59, 0, 0);
                    }

                    const endTimeStr = endTime.toTimeString().substring(0, 5);
                    eventObj.end = `${reminder.date}T${endTimeStr}:00`;
                }
                eventObj.allDay = false;
            } else {
                eventObj.start = reminder.date;
                eventObj.allDay = true;
                eventObj.display = 'block';
            }
        }

        // 添加分类信息到标题
        if (reminder.categoryId) {
            const category = this.categoryManager.getCategoryById(reminder.categoryId);
            if (category && category.icon) {
                eventObj.title = `${category.icon} ${eventObj.title}`;
            }
        }

        events.push(eventObj);
    }

    private async showEventTooltip(event: MouseEvent, calendarEvent: any) {
        try {
            // 清除可能存在的隐藏超时
            if (this.tooltipTimeout) {
                clearTimeout(this.tooltipTimeout);
                this.tooltipTimeout = null;
            }

            // 创建提示框
            if (!this.tooltip) {
                this.tooltip = document.createElement('div');
                this.tooltip.className = 'reminder-event-tooltip';
                this.tooltip.style.cssText = `
                    position: fixed;
                    background: var(--b3-theme-surface);
                    border: 1px solid var(--b3-theme-border);
                    border-radius: 6px;
                    padding: 12px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    z-index: 9999;
                    max-width: 300px;
                    font-size: 13px;
                    line-height: 1.4;
                    opacity: 0;
                    transition: opacity 0.2s ease-in-out;
                    word-wrap: break-word;
                `;

                // 添加鼠标事件监听器
                this.tooltip.addEventListener('mouseenter', () => {
                    this.isTooltipHovered = true;
                    if (this.tooltipTimeout) {
                        clearTimeout(this.tooltipTimeout);
                        this.tooltipTimeout = null;
                    }
                });

                this.tooltip.addEventListener('mouseleave', () => {
                    this.isTooltipHovered = false;
                    this.hideEventTooltipWithDelay();
                });

                document.body.appendChild(this.tooltip);
            }

            // 显示加载状态
            this.tooltip.innerHTML = '<div style="color: var(--b3-theme-on-surface-light); font-size: 12px;">加载中...</div>';
            this.tooltip.style.display = 'block';
            this.updateTooltipPosition(event);

            // 异步获取详细信息
            const tooltipContent = await this.buildTooltipContent(calendarEvent);

            // 检查tooltip是否仍然存在（防止快速移动鼠标时的竞态条件）
            if (this.tooltip && this.tooltip.style.display !== 'none') {
                this.tooltip.innerHTML = tooltipContent;
                this.tooltip.style.opacity = '1';
            }

        } catch (error) {
            console.error('显示事件提示框失败:', error);
            this.hideEventTooltip();
        }
    }

    /**
     * 安排显示事件提示框（延迟显示）
     */
    private scheduleShowEventTooltip(event: MouseEvent, calendarEvent: any) {
        // 清除之前的延迟显示定时器
        if (this.tooltipShowTimeout) {
            clearTimeout(this.tooltipShowTimeout);
            this.tooltipShowTimeout = null;
        }

        // 清除隐藏定时器
        if (this.tooltipTimeout) {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }

        // 如果提示框已经显示，直接更新内容和位置
        if (this.tooltip && this.tooltip.style.display !== 'none') {
            this.updateTooltipPosition(event);
            this.updateTooltipContent(calendarEvent);
            return;
        }

        // 设置延迟显示（500毫秒后显示）
        this.tooltipShowTimeout = window.setTimeout(() => {
            this.showEventTooltip(event, calendarEvent);
            this.tooltipShowTimeout = null;
        }, 500);
    }

    /**
     * 取消安排的提示框显示
     */
    private cancelScheduledTooltip() {
        if (this.tooltipShowTimeout) {
            clearTimeout(this.tooltipShowTimeout);
            this.tooltipShowTimeout = null;
        }
    }

    /**
     * 更新提示框内容（用于快速切换事件时）
     */
    private async updateTooltipContent(calendarEvent: any) {
        if (!this.tooltip || this.tooltip.style.display === 'none') {
            return;
        }

        try {
            // 显示加载状态
            this.tooltip.innerHTML = '<div style="color: var(--b3-theme-on-surface-light); font-size: 12px;">加载中...</div>';

            // 异步获取详细信息
            const tooltipContent = await this.buildTooltipContent(calendarEvent);

            // 检查tooltip是否仍然存在
            if (this.tooltip && this.tooltip.style.display !== 'none') {
                this.tooltip.innerHTML = tooltipContent;
            }
        } catch (error) {
            console.error('更新提示框内容失败:', error);
            if (this.tooltip && this.tooltip.style.display !== 'none') {
                this.tooltip.innerHTML = '<div style="color: var(--b3-theme-error); font-size: 12px;">加载失败</div>';
            }
        }
    }

    private hideEventTooltip() {
        if (this.tooltip) {
            this.tooltip.style.opacity = '0';
            setTimeout(() => {
                if (this.tooltip && !this.isTooltipHovered) {
                    this.tooltip.style.display = 'none';
                }
            }, 200);
        }
    }

    private hideEventTooltipWithDelay() {
        // 延迟隐藏提示框，给用户时间移动鼠标到提示框上
        if (this.tooltipTimeout) {
            clearTimeout(this.tooltipTimeout);
        }

        this.tooltipTimeout = window.setTimeout(() => {
            if (!this.isTooltipHovered) {
                this.hideEventTooltip();
            }
        }, 200); // 200ms 延迟
    }

    private updateTooltipPosition(event: MouseEvent) {
        if (!this.tooltip) return;

        const tooltipRect = this.tooltip.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // 计算基础位置（鼠标右下方）
        let left = event.clientX + 10;
        let top = event.clientY + 10;

        // 检查右边界
        if (left + tooltipRect.width > viewportWidth) {
            left = event.clientX - tooltipRect.width - 10;
        }

        // 检查下边界
        if (top + tooltipRect.height > viewportHeight) {
            top = event.clientY - tooltipRect.height - 10;
        }

        // 确保不超出左边界和上边界
        left = Math.max(10, left);
        top = Math.max(10, top);

        this.tooltip.style.left = `${left}px`;
        this.tooltip.style.top = `${top}px`;
    }

    private async buildTooltipContent(calendarEvent: any): Promise<string> {
        const reminder = calendarEvent.extendedProps;
        const parts: string[] = [];

        try {
            // 1. 文档标题（修复：添加块级事件的父文档标题获取逻辑）
            let docTitleAdded = false;

            // 首先检查是否有明确的docId
            if (reminder.docId) {
                try {
                    const docBlock = await getBlockByID(reminder.docId);
                    if (docBlock && docBlock.content) {
                        parts.push(`<div style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px; text-align: left;">
                            <span>📄</span>
                            <span title="所属文档">${this.escapeHtml(docBlock.content)}</span>
                        </div>`);
                        docTitleAdded = true;
                    }
                } catch (error) {
                    console.warn('获取文档标题失败:', error);
                }
            }

            // 如果没有docId但有blockId，且blockId不等于docId，尝试获取块的父文档
            if (!docTitleAdded && reminder.blockId && reminder.blockId !== reminder.docId) {
                try {
                    const blockInfo = await getBlockByID(reminder.blockId);
                    if (blockInfo && blockInfo.root_id && blockInfo.root_id !== reminder.blockId) {
                        // 获取根文档的信息
                        const rootBlock = await getBlockByID(blockInfo.root_id);
                        if (rootBlock && rootBlock.content) {
                            parts.push(`<div style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px; text-align: left;">
                                <span>📄</span>
                                <span title="所属文档">${this.escapeHtml(rootBlock.content)}</span>
                            </div>`);
                            docTitleAdded = true;
                        }
                    }
                } catch (error) {
                    console.warn('获取块父文档标题失败:', error);
                }
            }

            // 2. 事项名称 - 明确设置居左显示
            let eventTitle = calendarEvent.title || t("unnamedNote");

            // 移除分类图标前缀（如果存在）
            if (reminder.categoryId) {
                const category = this.categoryManager.getCategoryById(reminder.categoryId);
                if (category && category.icon) {
                    const iconPrefix = `${category.icon} `;
                    if (eventTitle.startsWith(iconPrefix)) {
                        eventTitle = eventTitle.substring(iconPrefix.length);
                    }
                }
            }

            parts.push(`<div style="font-weight: 600; color: var(--b3-theme-on-surface); margin-bottom: 8px; font-size: 14px; text-align: left; width: 100%;">
                ${this.escapeHtml(eventTitle)}
            </div>`);

            // 3. 日期时间信息
            const dateTimeInfo = this.formatEventDateTime(reminder);
            if (dateTimeInfo) {
                parts.push(`<div style="color: var(--b3-theme-on-surface); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                    <span style="opacity: 0.7;">🕐</span>
                    <span>${dateTimeInfo}</span>
                </div>`);
            }

            // 4. 优先级信息
            if (reminder.priority && reminder.priority !== 'none') {
                const priorityInfo = this.formatPriorityInfo(reminder.priority);
                if (priorityInfo) {
                    parts.push(`<div style="color: var(--b3-theme-on-surface); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                        ${priorityInfo}
                    </div>`);
                }
            }

            // 5. 分类信息
            if (reminder.categoryId) {
                const category = this.categoryManager.getCategoryById(reminder.categoryId);
                if (category) {
                    parts.push(`<div style="color: var(--b3-theme-on-surface); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                        <span style="opacity: 0.7;">🏷️</span>
                        <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background-color: ${category.color}; border-radius: 4px; color: white; font-size: 11px;">
                            ${category.icon ? `<span style="font-size: 12px;">${category.icon}</span>` : ''}
                            <span>${this.escapeHtml(category.name)}</span>
                        </span>
                    </div>`);
                }
            }

            // 6. 重复信息
            if (reminder.isRepeated) {
                parts.push(`<div style="color: var(--b3-theme-on-surface-light); margin-bottom: 6px; display: flex; align-items: center; gap: 4px; font-size: 12px;">
                    <span>🔄</span>
                    <span>${t("repeatInstance")}</span>
                </div>`);
            } else if (reminder.repeat?.enabled) {
                const repeatDescription = this.getRepeatDescription(reminder.repeat);
                if (repeatDescription) {
                    parts.push(`<div style="color: var(--b3-theme-on-surface-light); margin-bottom: 6px; display: flex; align-items: center; gap: 4px; font-size: 12px;">
                        <span>🔁</span>
                        <span>${repeatDescription}</span>
                    </div>`);
                }
            }

            // 7. 备注信息
            if (reminder.note && reminder.note.trim()) {
                parts.push(`<div style="color: var(--b3-theme-on-surface-light); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--b3-theme-border); font-size: 12px;">
                    <div style="margin-bottom: 4px; opacity: 0.7;">备注:</div>
                    <div>${this.escapeHtml(reminder.note)}</div>
                </div>`);
            }

            // 8. 完成状态
            if (reminder.completed) {
                parts.push(`<div style="color: var(--b3-theme-success); margin-top: 6px; display: flex; align-items: center; gap: 4px; font-size: 12px;">
                    <span>✅</span>
                    <span>已完成</span>
                </div>`);
            }

            return parts.join('');

        } catch (error) {
            console.error('构建提示框内容失败:', error);
            return `<div style="color: var(--b3-theme-error);">加载详情失败</div>`;
        }
    }

    /**
     * 格式化事件日期时间信息
     */
    private formatEventDateTime(reminder: any): string {
        try {
            const today = getLocalDateString();
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = getLocalDateString(tomorrow);

            let dateStr = '';
            if (reminder.date === today) {
                dateStr = '今天';
            } else if (reminder.date === tomorrowStr) {
                dateStr = '明天';
            } else {
                const reminderDate = new Date(reminder.date + 'T00:00:00');
                dateStr = reminderDate.toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    weekday: 'short'
                });
            }

            // 处理跨天事件
            if (reminder.endDate && reminder.endDate !== reminder.date) {
                let endDateStr = '';
                if (reminder.endDate === today) {
                    endDateStr = '今天';
                } else if (reminder.endDate === tomorrowStr) {
                    endDateStr = '明天';
                } else {
                    const endReminderDate = new Date(reminder.endDate + 'T00:00:00');
                    endDateStr = endReminderDate.toLocaleDateString('zh-CN', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        weekday: 'short'
                    });
                }

                if (reminder.time || reminder.endTime) {
                    const timeStr = reminder.time ? ` ${reminder.time}` : '';
                    const endTimeStr = reminder.endTime ? ` ${reminder.endTime}` : '';
                    return `${dateStr}${timeStr} → ${endDateStr}${endTimeStr}`;
                } else {
                    return `${dateStr} → ${endDateStr}`;
                }
            }

            // 单日事件
            if (reminder.time) {
                if (reminder.endTime && reminder.endTime !== reminder.time) {
                    return `${dateStr} ${reminder.time} - ${reminder.endTime}`;
                } else {
                    return `${dateStr} ${reminder.time}`;
                }
            }

            return dateStr;

        } catch (error) {
            console.error('格式化日期时间失败:', error);
            return reminder.date || '';
        }
    }

    /**
     * 格式化优先级信息
     */
    private formatPriorityInfo(priority: string): string {
        const priorityMap = {
            'high': { label: '高优先级', icon: '🔴', color: '#e74c3c' },
            'medium': { label: '中优先级', icon: '🟡', color: '#f39c12' },
            'low': { label: '低优先级', icon: '🔵', color: '#3498db' }
        };

        const priorityInfo = priorityMap[priority];
        if (!priorityInfo) return '';

        return `<span style="opacity: 0.7;">${priorityInfo.icon}</span>
                <span style="color: ${priorityInfo.color};">${priorityInfo.label}</span>`;
    }

    /**
     * 获取重复描述
     */
    private getRepeatDescription(repeat: any): string {
        if (!repeat || !repeat.enabled) return '';

        try {
            switch (repeat.type) {
                case 'daily':
                    return repeat.interval === 1 ? '每日重复' : `每 ${repeat.interval} 天重复`;
                case 'weekly':
                    return repeat.interval === 1 ? '每周重复' : `每 ${repeat.interval} 周重复`;
                case 'monthly':
                    return repeat.interval === 1 ? '每月重复' : `每 ${repeat.interval} 月重复`;
                case 'yearly':
                    return repeat.interval === 1 ? '每年重复' : `每 ${repeat.interval} 年重复`;
                case 'custom':
                    return '自定义重复';
                case 'ebbinghaus':
                    return '艾宾浩斯重复';
                default:
                    return '重复事件';
            }
        } catch (error) {
            console.error('获取重复描述失败:', error);
            return '重复事件';
        }
    }

    /**
     * HTML转义函数
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 添加销毁方法
    destroy() {
        // 清理提示框显示延迟超时
        if (this.tooltipShowTimeout) {
            clearTimeout(this.tooltipShowTimeout);
            this.tooltipShowTimeout = null;
        }

        // 清理提示框超时
        if (this.tooltipTimeout) {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }

        // 清理提示框
        if (this.tooltip) {
            this.tooltip.remove();
            this.tooltip = null;
        }

        // 调用清理函数
        const cleanup = (this.container as any)._calendarCleanup;
        if (cleanup) {
            cleanup();
        }

        // 移除事件监听器
        window.removeEventListener('reminderUpdated', () => this.refreshEvents());

        // 销毁日历实例
        if (this.calendar) {
            this.calendar.destroy();
        }

        // 清理容器
        if (this.container) {
            this.container.innerHTML = '';
        }
    }

    /**
     * 分割重复事件系列 - 修改原始事件并创建新系列
     */
    private async splitRecurringEvent(calendarEvent: any) {
        try {
            const reminder = calendarEvent.extendedProps;
            const reminderData = await readReminderData();
            const originalReminder = reminderData[calendarEvent.id];

            if (!originalReminder || !originalReminder.repeat?.enabled) {
                showMessage(t("operationFailed"));
                return;
            }

            // 计算下一个周期日期
            const nextDate = this.calculateNextDate(originalReminder.date, originalReminder.repeat);
            if (!nextDate) {
                showMessage(t("operationFailed") + ": " + t("invalidRepeatConfig"));
                return;
            }
            const nextDateStr = getLocalDateTime(nextDate).dateStr;

            // 创建用于编辑的临时数据
            const editData = {
                ...originalReminder,
                isSplitOperation: true,
                originalId: calendarEvent.id,
                nextCycleDate: nextDateStr,
                nextCycleEndDate: originalReminder.endDate ? this.calculateEndDateForSplit(originalReminder, nextDate) : undefined
            };

            // 打开编辑对话框
            const editDialog = new ReminderEditDialog(editData, async (modifiedReminder) => {
                await this.performSplitOperation(originalReminder, modifiedReminder);
            });
            editDialog.show();

        } catch (error) {
            console.error('分割重复事件系列失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    /**
     * 执行分割操作
     */
    private async performSplitOperation(originalReminder: any, modifiedReminder: any) {
        try {
            const reminderData = await readReminderData();

            // 1. 修改原始事件为单次事件
            const singleReminder = {
                ...originalReminder,
                title: modifiedReminder.title,
                date: modifiedReminder.date,
                time: modifiedReminder.time,
                endDate: modifiedReminder.endDate,
                endTime: modifiedReminder.endTime,
                note: modifiedReminder.note,
                priority: modifiedReminder.priority,
                repeat: undefined
            };

            // 2. 创建新的重复事件系列
            const newReminder = JSON.parse(JSON.stringify(originalReminder));

            // 清理新提醒的重复历史数据
            delete newReminder.repeat.endDate;
            delete newReminder.repeat.excludeDates;
            delete newReminder.repeat.instanceModifications;
            delete newReminder.repeat.completedInstances;

            // 生成新的提醒ID
            const blockId = originalReminder.blockId || originalReminder.id;
            const newId = `${blockId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            newReminder.id = newId;

            // 3. 设置新系列从下一个周期开始
            newReminder.date = modifiedReminder.nextCycleDate;
            newReminder.endDate = modifiedReminder.nextCycleEndDate;
            newReminder.time = originalReminder.time;
            newReminder.endTime = originalReminder.endTime;
            newReminder.title = originalReminder.title;
            newReminder.note = originalReminder.note;
            newReminder.priority = originalReminder.priority;

            // 应用重复设置
            if (modifiedReminder.repeat && modifiedReminder.repeat.enabled) {
                newReminder.repeat = { ...modifiedReminder.repeat };
                delete newReminder.repeat.endDate;
            } else {
                newReminder.repeat = { ...originalReminder.repeat };
                delete newReminder.repeat.endDate;
            }

            // 4. 保存修改
            reminderData[originalReminder.id] = singleReminder;
            reminderData[newId] = newReminder;
            await writeReminderData(reminderData);

            // 5. 更新界面
            await this.refreshEvents();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
            showMessage(t("seriesSplitSuccess"));

        } catch (error) {
            console.error('执行分割重复事件系列失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    /**
     * 跳过首次发生 - 为原始事件添加排除日期
     */

    private async skipFirstOccurrence(reminder: any) {
        await confirm(
            t("deleteThisInstance"),
            t("confirmSkipFirstOccurrence"),
            async () => {
                try {
                    const reminderData = await readReminderData();
                    const originalReminder = reminderData[reminder.id];

                    if (!originalReminder || !originalReminder.repeat?.enabled) {
                        showMessage(t("operationFailed"));
                        return;
                    }

                    // 计算下一个周期的日期
                    const nextDate = this.calculateNextDate(originalReminder.date, originalReminder.repeat);
                    if (!nextDate) {
                        showMessage(t("operationFailed") + ": " + t("invalidRepeatConfig"));
                        return;
                    }

                    // 将周期事件的开始日期更新为下一个周期
                    originalReminder.date = getLocalDateString(nextDate);

                    // 如果是跨天事件，也需要更新结束日期
                    if (originalReminder.endDate) {
                        const originalStart = new Date(reminder.date + 'T12:00:00');
                        const originalEnd = new Date(originalReminder.endDate + 'T12:00:00');
                        const daysDiff = Math.floor((originalEnd.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24));

                        const newEndDate = new Date(nextDate);
                        newEndDate.setDate(newEndDate.getDate() + daysDiff);
                        originalReminder.endDate = getLocalDateString(newEndDate);
                    }

                    // 清理可能存在的首次发生相关的历史数据
                    if (originalReminder.repeat.completedInstances) {
                        const firstOccurrenceIndex = originalReminder.repeat.completedInstances.indexOf(reminder.date);
                        if (firstOccurrenceIndex > -1) {
                            originalReminder.repeat.completedInstances.splice(firstOccurrenceIndex, 1);
                        }
                    }

                    if (originalReminder.repeat.instanceModifications && originalReminder.repeat.instanceModifications[reminder.date]) {
                        delete originalReminder.repeat.instanceModifications[reminder.date];
                    }

                    if (originalReminder.repeat.excludeDates) {
                        const firstOccurrenceIndex = originalReminder.repeat.excludeDates.indexOf(reminder.date);
                        if (firstOccurrenceIndex > -1) {
                            originalReminder.repeat.excludeDates.splice(firstOccurrenceIndex, 1);
                        }
                    }

                    await writeReminderData(reminderData);
                    showMessage(t("firstOccurrenceSkipped"));
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                } catch (error) {
                    console.error('跳过首次发生失败:', error);
                    showMessage(t("operationFailed"));
                }
            }
        );
    }

    /**
     * 计算下一个周期日期
     */
    private calculateNextDate(startDateStr: string, repeat: any): Date {
        const startDate = new Date(startDateStr + 'T12:00:00');
        if (isNaN(startDate.getTime())) {
            console.error("Invalid start date for cycle calculation:", startDateStr);
            return null;
        }

        if (!repeat || !repeat.enabled) {
            return null;
        }

        switch (repeat.type) {
            case 'daily':
                return this.calculateDailyNext(startDate, repeat.interval || 1);
            case 'weekly':
                return this.calculateWeeklyNext(startDate, repeat.interval || 1);
            case 'monthly':
                return this.calculateMonthlyNext(startDate, repeat.interval || 1);
            case 'yearly':
                return this.calculateYearlyNext(startDate, repeat.interval || 1);
            default:
                console.error("Unknown repeat type:", repeat.type);
                return null;
        }
    }

    /**
     * 计算每日重复的下一个日期
     */
    private calculateDailyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setDate(nextDate.getDate() + interval);
        return nextDate;
    }

    /**
     * 计算每周重复的下一个日期
     */
    private calculateWeeklyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setDate(nextDate.getDate() + (7 * interval));
        return nextDate;
    }

    /**
     * 计算每月重复的下一个日期
     */
    private calculateMonthlyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setMonth(nextDate.getMonth() + interval);

        // 处理月份溢出
        if (nextDate.getDate() !== startDate.getDate()) {
            nextDate.setDate(0); // 设置为前一个月的最后一天
        }

        return nextDate;
    }

    /**
     * 计算每年重复的下一个日期
     */
    private calculateYearlyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setFullYear(nextDate.getFullYear() + interval);

        // 处理闰年边界情况
        if (nextDate.getDate() !== startDate.getDate()) {
            nextDate.setDate(0); // 设置为前一个月的最后一天
        }

        return nextDate;
    }

    /**
     * 计算分割时的结束日期
     */
    private calculateEndDateForSplit(originalReminder: any, nextDate: Date): string {
        if (!originalReminder.endDate) {
            return undefined;
        }

        // 计算原始事件的持续天数
        const originalStart = new Date(originalReminder.date + 'T00:00:00');
        const originalEnd = new Date(originalReminder.endDate + 'T00:00:00');
        const durationDays = Math.round((originalEnd.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24));

        // 为新系列计算结束日期
        const newEndDate = new Date(nextDate);
        newEndDate.setDate(newEndDate.getDate() + durationDays);

        return getLocalDateTime(newEndDate).dateStr;
    }
}
