import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { showMessage, confirm, openTab, Menu, Dialog } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID } from "../api";
import { getLocalDateTime } from "../utils/dateUtils";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { t } from "../utils/i18n";
import { generateRepeatInstances, RepeatInstance } from "../utils/repeatUtils";

export class CalendarView {
    private container: HTMLElement;
    private calendar: Calendar;
    private plugin: any;
    private resizeObserver: ResizeObserver;
    private resizeTimeout: number;

    constructor(container: HTMLElement, plugin: any) {
        this.container = container;
        this.plugin = plugin;
        this.initUI();
    }

    private async initUI() {
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
                right: '' // 我们使用自定义按钮来切换视图
            },
            editable: true, // 允许拖动事件
            selectable: true,
            locale: 'zh-cn',
            eventClassNames: 'reminder-calendar-event',
            eventContent: this.renderEventContent.bind(this),
            eventClick: this.handleEventClick.bind(this),
            eventDrop: this.handleEventDrop.bind(this),
            eventResize: this.handleEventResize.bind(this),
            dateClick: this.handleDateClick.bind(this),
            events: this.getEvents.bind(this), // 使用bind方法绑定上下文
            // 设置今天的背景颜色为淡绿色
            dayCellClassNames: (arg) => {
                const today = new Date();
                const cellDate = arg.date;

                if (cellDate.toDateString() === today.toDateString()) {
                    return ['fc-today-custom'];
                }
                return [];
            },
            // 添加右键菜单支持
            eventDidMount: (info) => {
                info.el.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.showEventContextMenu(e, info.event);
                });
            }
        });

        this.calendar.render();

        // 添加自定义样式
        this.addCustomStyles();

        // 监听提醒更新事件 - 确保在所有方法定义后再绑定
        window.addEventListener('reminderUpdated', () => this.refreshEvents());

        // 添加窗口大小变化监听器
        this.addResizeListeners();
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
                delete reminderData[reminderId];
                await writeReminderData(reminderData);

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
        if (eventInfo.event.extendedProps.completed) {
            eventEl.classList.add('completed');
        }
        eventEl.innerHTML = `<div class="fc-event-title">${eventInfo.event.title}</div>`;

        if (eventInfo.event.extendedProps.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-calendar-event-note';
            noteEl.textContent = eventInfo.event.extendedProps.note;
            eventEl.appendChild(noteEl);
        }

        wrapper.appendChild(checkbox);
        wrapper.appendChild(eventEl);

        return { domNodes: [wrapper] };
    }

    private async toggleEventCompleted(event) {
        try {
            // 获取正确的提醒ID - 对于重复事件实例，使用原始ID
            const reminderId = event.extendedProps.isRepeated ?
                event.extendedProps.originalId :
                event.id;

            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                reminderData[reminderId].completed = !reminderData[reminderId].completed;
                await writeReminderData(reminderData);

                // 更新事件的显示状态
                event.setExtendedProp('completed', reminderData[reminderId].completed);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                // 立即刷新事件显示以更新所有重复实例
                await this.refreshEvents();
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

            window.open(`siyuan://blocks/${blockId}`, '_self');
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

        // 如果是重复事件实例，询问用户是否应用于所有实例
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

            // 如果选择 'all'，继续使用原始ID更新所有实例
            const originalId = originalReminder.originalId;
            await this.updateEventTime(originalId, info, false);
        } else {
            // 非重复事件，直接更新
            await this.updateEventTime(reminderId, info, false);
        }
    }

    private async handleEventResize(info) {
        const reminderId = info.event.id;
        const originalReminder = info.event.extendedProps;

        // 如果是重复事件实例，询问用户是否应用于所有实例
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

            // 如果选择 'all'，继续使用原始ID更新所有实例
            const originalId = originalReminder.originalId;
            await this.updateEventTime(originalId, info, true);
        } else {
            // 非重复事件，直接更新
            await this.updateEventTime(reminderId, info, true);
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

            // 创建实例修改数据
            const instanceModification = {
                title: info.event.title.replace(/^🔄 /, ''), // 移除重复标识
                priority: info.event.extendedProps.priority,
                note: info.event.extendedProps.note
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

            // 获取当前视图的日期范围，添加安全检查
            let startDate, endDate;
            if (this.calendar && this.calendar.view) {
                const currentView = this.calendar.view;
                startDate = currentView.activeStart.toISOString().split('T')[0];
                endDate = currentView.activeEnd.toISOString().split('T')[0];
            } else {
                // 如果calendar还没有初始化，使用默认范围
                const now = new Date();
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                startDate = monthStart.toISOString().split('T')[0];
                endDate = monthEnd.toISOString().split('T')[0];
            }

            Object.values(reminderData).forEach((reminder: any) => {
                if (!reminder || typeof reminder !== 'object') return;

                // 添加原始事件
                this.addEventToList(events, reminder, reminder.id, false);

                // 如果有重复设置，生成重复事件实例
                if (reminder.repeat?.enabled) {
                    const repeatInstances = generateRepeatInstances(reminder, startDate, endDate);
                    repeatInstances.forEach(instance => {
                        // 跳过与原始事件相同日期的实例
                        if (instance.date !== reminder.date) {
                            const instanceReminder = {
                                ...reminder,
                                date: instance.date,
                                endDate: instance.endDate,
                                time: instance.time,
                                endTime: instance.endTime
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

    private addEventToList(events: any[], reminder: any, eventId: string, isRepeated: boolean, originalId?: string) {
        const priority = reminder.priority || 'none';
        let backgroundColor, borderColor;

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

        // 如果任务已完成，使用灰色
        if (reminder.completed) {
            backgroundColor = '#e3e3e3';
            borderColor = '#e3e3e3';
        }

        // 重复事件使用稍微不同的样式
        if (isRepeated) {
            backgroundColor = backgroundColor + 'dd'; // 添加透明度
            borderColor = borderColor + 'dd';
        }

        let eventObj: any = {
            id: eventId,
            title: reminder.title || t("unnamedNote"),
            backgroundColor: backgroundColor,
            borderColor: borderColor,
            textColor: reminder.completed ? '#999999' : '#ffffff',
            className: `reminder-priority-${priority} ${isRepeated ? 'reminder-repeated' : ''}`,
            extendedProps: {
                completed: reminder.completed || false,
                note: reminder.note || '',
                date: reminder.date,
                endDate: reminder.endDate || null,
                time: reminder.time || null,
                endTime: reminder.endTime || null,
                priority: priority,
                blockId: reminder.blockId || reminder.id,
                isRepeated: isRepeated,
                originalId: originalId || reminder.id,
                repeat: reminder.repeat
            }
        };

        // 处理跨天事件
        if (reminder.endDate) {
            // 跨天事件
            if (reminder.time && reminder.endTime) {
                // 跨天定时事件
                eventObj.start = `${reminder.date}T${reminder.time}:00`;
                eventObj.end = `${reminder.endDate}T${reminder.endTime}:00`;
                eventObj.allDay = false;
            } else {
                // 跨天全天事件
                eventObj.start = reminder.date;
                // FullCalendar 需要结束日期为下一天才能正确显示跨天事件
                const endDate = new Date(reminder.endDate);
                endDate.setDate(endDate.getDate() + 1);
                eventObj.end = endDate.toISOString().split('T')[0];
                eventObj.allDay = true;

                // 如果有时间信息，在标题中显示
                if (reminder.time) {
                    eventObj.title = `${reminder.title || t("unnamedNote")} (${reminder.time})`;
                }
            }
        } else {
            // 单日事件
            if (reminder.time) {
                eventObj.start = `${reminder.date}T${reminder.time}:00`;
                // 如果有结束时间，设置结束时间
                if (reminder.endTime) {
                    eventObj.end = `${reminder.date}T${reminder.endTime}:00`;
                }
                eventObj.allDay = false;
            } else {
                eventObj.start = reminder.date;
                eventObj.allDay = true;
                eventObj.display = 'block';
            }
        }

        // 为重复事件添加图标标识
        if (isRepeated) {
            // 如果是重复事件实例，添加实例标识
            eventObj.title = '🔄 ' + eventObj.title;
        } else if (reminder.repeat?.enabled) {
            // 如果是原始重复事件，添加重复标识
            eventObj.title = '🔁 ' + eventObj.title;
        }

        events.push(eventObj);
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

            // 创建实例数据，包含当前实例的特定信息
            const instanceData = {
                ...originalReminder,
                id: calendarEvent.id,
                date: calendarEvent.extendedProps.date,
                endDate: calendarEvent.extendedProps.endDate,
                time: calendarEvent.extendedProps.time,
                endTime: calendarEvent.extendedProps.endTime,
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

    // 添加销毁方法
    destroy() {
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
}
