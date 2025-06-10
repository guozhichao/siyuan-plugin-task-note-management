import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { showMessage, confirm, openTab, Menu, Dialog } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID } from "../api";
import { getLocalDateTime } from "../utils/dateUtils";

export class CalendarView {
    private container: HTMLElement;
    private calendar: Calendar;
    private plugin: any;

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
        monthBtn.textContent = '月';
        monthBtn.addEventListener('click', () => this.calendar.changeView('dayGridMonth'));
        viewGroup.appendChild(monthBtn);

        const weekBtn = document.createElement('button');
        weekBtn.className = 'b3-button b3-button--outline';
        weekBtn.textContent = '周';
        weekBtn.addEventListener('click', () => this.calendar.changeView('timeGridWeek'));
        viewGroup.appendChild(weekBtn);

        const dayBtn = document.createElement('button');
        dayBtn.className = 'b3-button b3-button--outline';
        dayBtn.textContent = '日';
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
            events: await this.getEvents(),
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

        // 监听提醒更新事件
        window.addEventListener('reminderUpdated', this.refreshEvents.bind(this));
    }

    private showEventContextMenu(event: MouseEvent, calendarEvent: any) {
        const menu = new Menu("calendarEventContextMenu");

        menu.addItem({
            iconHTML: "📖",
            label: "打开笔记",
            click: () => {
                this.handleEventClick({ event: calendarEvent });
            }
        });

        menu.addItem({
            iconHTML: "✅",
            label: calendarEvent.extendedProps.completed ? "标记为未完成" : "标记为已完成",
            click: () => {
                this.toggleEventCompleted(calendarEvent);
            }
        });

        menu.addSeparator();

        menu.addItem({
            iconHTML: calendarEvent.allDay ? "⏰" : "📅",
            label: calendarEvent.allDay ? "修改为定时事件" : "修改为全天事件",
            click: () => {
                this.toggleAllDayEvent(calendarEvent);
            }
        });

        menu.addItem({
            iconHTML: "📝",
            label: "修改",
            click: () => {
                this.showTimeEditDialog(calendarEvent);
            }
        });

        menu.addSeparator();

        menu.addItem({
            iconHTML: "🗑️",
            label: "删除提醒",
            click: () => {
                this.deleteEvent(calendarEvent);
            }
        });

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async deleteEvent(calendarEvent: any) {
        const reminder = calendarEvent.extendedProps;
        const result = await confirm(
            "删除提醒",
            `确定要删除提醒"${calendarEvent.title}"吗？此操作无法撤销。`,
            () => {
                this.performDeleteEvent(calendarEvent.id);
            }
        );
    }

    private async performDeleteEvent(reminderId: string) {
        try {
            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                delete reminderData[reminderId];
                await writeReminderData(reminderData);

                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                await this.refreshEvents();

                showMessage('提醒已删除');
            } else {
                showMessage('提醒不存在');
            }
        } catch (error) {
            console.error('删除提醒失败:', error);
            showMessage('删除提醒失败，请重试');
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
            const reminderId = event.id;
            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                reminderData[reminderId].completed = !reminderData[reminderId].completed;
                await writeReminderData(reminderData);

                event.setExtendedProp('completed', reminderData[reminderId].completed);
                
                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
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
                "打开笔记失败",
                "该笔记块可能已被删除，是否删除相关的提醒？",
                async () => {
                    // 删除当前提醒
                    await this.performDeleteEvent(info.event.id);
                },
                () => {
                    showMessage('打开笔记失败，该块可能已被删除');
                }
            );
        }
    }

    private async handleEventDrop(info) {
        const reminderId = info.event.id;
        const originalReminder = info.event.extendedProps;

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
                
                showMessage('已更新事件时间');
                await this.refreshEvents();
            } else {
                throw new Error('提醒数据不存在');
            }
        } catch (error) {
            console.error('更新事件时间失败:', error);
            showMessage('更新事件时间失败，请重试');
            info.revert();
        }
    }

    private async handleEventResize(info) {
        const reminderId = info.event.id;
        const originalReminder = info.event.extendedProps;

        try {
            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                const newStartDate = info.event.start;
                const newEndDate = info.event.end;

                if (newEndDate) {
                    if (info.event.allDay) {
                        // 全天事件：FullCalendar 的结束日期是排他的，需要减去一天
                        const { dateStr: startDateStr } = getLocalDateTime(newStartDate);
                        const { dateStr: endDateStr } = getLocalDateTime(new Date(newEndDate.getTime() - 24 * 60 * 60 * 1000));

                        reminderData[reminderId].date = startDateStr;

                        if (endDateStr !== startDateStr) {
                            reminderData[reminderId].endDate = endDateStr;
                            // 全天事件删除时间信息
                            delete reminderData[reminderId].time;
                            delete reminderData[reminderId].endTime;
                        } else {
                            delete reminderData[reminderId].endDate;
                            delete reminderData[reminderId].endTime;
                        }
                    } else {
                        // 定时事件：处理开始和结束时间
                        const { dateStr: startDateStr, timeStr: startTimeStr } = getLocalDateTime(newStartDate);
                        const { dateStr: endDateStr, timeStr: endTimeStr } = getLocalDateTime(newEndDate);

                        reminderData[reminderId].date = startDateStr;

                        if (startTimeStr) {
                            reminderData[reminderId].time = startTimeStr;
                        }

                        // 保存结束时间信息
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
                            }
                        }
                    }
                } else {
                    // 没有结束日期的情况
                    const { dateStr: startDateStr, timeStr } = getLocalDateTime(newStartDate);
                    reminderData[reminderId].date = startDateStr;
                    delete reminderData[reminderId].endDate;
                    delete reminderData[reminderId].endTime;

                    if (!info.event.allDay && timeStr) {
                        reminderData[reminderId].time = timeStr;
                    } else if (info.event.allDay) {
                        delete reminderData[reminderId].time;
                    }
                }

                await writeReminderData(reminderData);
                
                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                
                showMessage('已更新事件时间');
                await this.refreshEvents();
            } else {
                throw new Error('提醒数据不存在');
            }
        } catch (error) {
            console.error('调整事件大小失败:', error);
            showMessage('调整事件大小失败，请重试');
            info.revert();
        }
    }

    private handleDateClick(info) {
        // 点击日期，可以添加新的提醒
        const date = info.dateStr;
        // 这里可以打开创建提醒对话框，但需要选择一个块ID
        showMessage('请先在文档中选择一个块，然后为其创建提醒');
    }

    private async getEvents() {
        try {
            const reminderData = await readReminderData();
            const events = [];

            Object.values(reminderData).forEach((reminder: any) => {
                if (!reminder || typeof reminder !== 'object') return;

                let eventObj: any = {
                    id: reminder.id,
                    title: reminder.title || '未命名笔记',
                    backgroundColor: reminder.completed ? '#e3e3e3' : undefined,
                    borderColor: reminder.completed ? '#e3e3e3' : undefined,
                    textColor: reminder.completed ? '#999999' : undefined,
                    extendedProps: {
                        completed: reminder.completed || false,
                        note: reminder.note || '',
                        date: reminder.date,
                        endDate: reminder.endDate || null,
                        time: reminder.time || null,
                        endTime: reminder.endTime || null,
                        blockId: reminder.blockId || reminder.id // 兼容旧数据格式
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
                            eventObj.title = `${reminder.title || '未命名笔记'} (${reminder.time})`;
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

                events.push(eventObj);
            });

            return events;
        } catch (error) {
            console.error('获取事件数据失败:', error);
            showMessage('加载提醒数据失败');
            return [];
        }
    }

    private async refreshEvents() {
        try {
            const events = await this.getEvents();

            // 清除所有现有事件
            this.calendar.removeAllEvents();

            // 添加新事件
            this.calendar.addEventSource(events);

            // 强制重新渲染日历
            this.calendar.render();
        } catch (error) {
            console.error('刷新事件失败:', error);
        }
    }

    private async toggleAllDayEvent(calendarEvent: any) {
        try {
            const reminderId = calendarEvent.id;
            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                const isCurrentlyAllDay = calendarEvent.allDay;

                if (isCurrentlyAllDay) {
                    // 修改为定时事件，设置默认时间
                    reminderData[reminderId].time = "09:00";
                    delete reminderData[reminderId].endTime;
                } else {
                    // 修改为全天事件，删除时间信息
                    delete reminderData[reminderId].time;
                    delete reminderData[reminderId].endTime;
                }

                await writeReminderData(reminderData);
                
                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                
                await this.refreshEvents();

                showMessage(isCurrentlyAllDay ? '已修改为定时事件' : '已修改为全天事件');
            }
        } catch (error) {
            console.error('切换全天事件失败:', error);
            showMessage('切换失败，请重试');
        }
    }

    private async showTimeEditDialog(calendarEvent: any) {
        const reminder = calendarEvent.extendedProps;

        const dialog = new Dialog({
            title: "修改提醒",
            content: `
                <div class="time-edit-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">标题</label>
                            <input type="text" id="editReminderTitle" class="b3-text-field" value="${calendarEvent.title || ''}" placeholder="请输入提醒标题">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">开始日期</label>
                            <input type="date" id="editReminderDate" class="b3-text-field" value="${reminder.date}" required>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">结束日期（可选）</label>
                            <input type="date" id="editReminderEndDate" class="b3-text-field" value="${reminder.endDate || ''}" placeholder="留空表示单日事件">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">提醒时间</label>
                            <input type="time" id="editReminderTime" class="b3-text-field" value="${reminder.time || ''}">
                            <div class="b3-form__desc">留空表示全天提醒</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-checkbox">
                                <input type="checkbox" id="editNoSpecificTime" ${!reminder.time ? 'checked' : ''}>
                                <span class="b3-checkbox__graphic"></span>
                                <span class="b3-checkbox__label">全天提醒</span>
                            </label>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">备注</label>
                            <textarea id="editReminderNote" class="b3-text-field" placeholder="输入提醒备注..." rows="3">${reminder.note || ''}</textarea>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="editCancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="editConfirmBtn">保存</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "450px"
        });

        // 绑定事件处理逻辑
        const cancelBtn = dialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#editConfirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#editReminderTime') as HTMLInputElement;
        const startDateInput = dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#editReminderNote') as HTMLTextAreaElement;

        cancelBtn.addEventListener('click', () => {
            dialog.destroy();
        });

        confirmBtn.addEventListener('click', async () => {
            await this.saveTimeEdit(calendarEvent.id, dialog);
        });

        noTimeCheckbox.addEventListener('change', () => {
            timeInput.disabled = noTimeCheckbox.checked;
            if (noTimeCheckbox.checked) {
                timeInput.value = '';
            }
        });

        startDateInput.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage('结束日期已自动调整为开始日期');
            }

            endDateInput.min = startDate;
        });

        endDateInput.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage('结束日期不能早于开始日期');
            }
        });
    }

    private async saveTimeEdit(reminderId: string, dialog: any) {
        const titleInput = dialog.element.querySelector('#editReminderTitle') as HTMLInputElement;
        const dateInput = dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#editReminderTime') as HTMLInputElement;
        const noTimeCheckbox = dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#editReminderNote') as HTMLTextAreaElement;

        const title = titleInput.value.trim();
        const date = dateInput.value;
        const endDate = endDateInput.value;
        const time = noTimeCheckbox.checked ? undefined : timeInput.value;
        const note = noteInput.value.trim() || undefined;

        if (!title) {
            showMessage('请输入提醒标题');
            return;
        }

        if (!date) {
            showMessage('请选择提醒日期');
            return;
        }

        if (endDate && endDate < date) {
            showMessage('结束日期不能早于开始日期');
            return;
        }

        try {
            const reminderData = await readReminderData();
            if (reminderData[reminderId]) {
                reminderData[reminderId].title = title;
                reminderData[reminderId].date = date;
                reminderData[reminderId].time = time;
                reminderData[reminderId].note = note;

                if (endDate && endDate !== date) {
                    reminderData[reminderId].endDate = endDate;
                } else {
                    delete reminderData[reminderId].endDate;
                }

                await writeReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                await this.refreshEvents();

                const isSpanning = endDate && endDate !== date;
                const timeStr = time ? ` ${time}` : '';
                const dateStr = isSpanning ? `${date} → ${endDate}${timeStr}` : `${date}${timeStr}`;
                showMessage(`提醒已更新: ${dateStr}`);

                dialog.destroy();
            }
        } catch (error) {
            console.error('保存修改失败:', error);
            showMessage('保存失败，请重试');
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
}
