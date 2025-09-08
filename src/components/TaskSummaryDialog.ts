import {Dialog, showMessage, Menu} from "siyuan";
import { t } from "../utils/i18n";
import { getLocalDateString } from "../utils/dateUtils";
import { ProjectManager } from "../utils/projectManager";
import {readReminderData} from "@/api";
import {generateRepeatInstances} from "@/utils/repeatUtils";
import {CalendarView} from "@/components/CalendarView";

export class TaskSummaryDialog {
    private calendarView: CalendarView;
    private projectManager: ProjectManager;
    private calendar: any;

    constructor(calendar?: any) {
        this.projectManager = ProjectManager.getInstance();
        this.calendar = calendar;
    }

  /**
   * 显示任务摘要弹窗
   */
  public async showTaskSummaryDialog() {
    try {
      const events = await this.getEvents();

      console.log('所有任务:', events);

      // 获取当前日历视图的日期范围
      const dateRange = this.getCurrentViewDateRange();

      console.log('当前视图的日期范围:', dateRange);

      // 过滤在当前视图范围内的任务
      const filteredEvents = this.filterEventsByDateRange(events, dateRange);

      console.log('过滤后的任务:', filteredEvents);

      // 按日期和项目分组任务
      const groupedTasks = this.groupTasksByDateAndProject(filteredEvents, dateRange);

      // 获取当前视图类型信息
      const viewInfo = this.getCurrentViewInfo();

      // 创建弹窗
      const dialog = new Dialog({
        title: `${t("taskSummary") || "任务摘要"} - ${viewInfo}`,
        content: this.generateSummaryContent(groupedTasks, dateRange),
        width: "80vw",
        height: "70vh"
      });
    } catch (error) {
      console.error('显示任务摘要失败:', error);
      showMessage(t("showSummaryFailed") || "显示摘要失败");
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
        startDate = getLocalDateString(currentView.activeStart);
        endDate = getLocalDateString(currentView.activeEnd);
      } else {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        startDate = getLocalDateString(monthStart);
        endDate = getLocalDateString(monthEnd);
      }

      for (const reminder of Object.values(reminderData) as any[]) {
        if (!reminder || typeof reminder !== 'object') continue;

        // 应用分类过滤
        if (!this.calendarView.passesCategoryFilter(reminder)) continue;

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
                note: instanceMod?.note || '',
                docTitle: reminder.docTitle // 保持文档标题
              };

              // 确保实例ID的唯一性，避免重复
              const uniqueInstanceId = `${reminder.id}_instance_${instance.date}`;
              this.addEventToList(events, instanceReminder, uniqueInstanceId, true, instance.originalId);
            }
          });
        }
      }

      return events;
    } catch (error) {
      console.error('获取事件数据失败:', error);
      showMessage(t("loadReminderDataFailed"));
      return [];
    }
  }

  addEventToList(events: any[], reminder: any, eventId: string, isRepeated: boolean, originalId?: string) {
    const priority = reminder.priority || 'none';
    let backgroundColor, borderColor;

    // 如果是快速创建的提醒（没有绑定块），使用特殊的样式
    if (reminder.isQuickReminder || !reminder.blockId) {
      backgroundColor = backgroundColor + 'aa'; // 添加透明度
      borderColor = borderColor + 'aa';
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
      title: reminder.title || t("unnamedNote"),
      backgroundColor: backgroundColor,
      borderColor: borderColor,
      textColor: isCompleted ? '#999999' : '#ffffff',
      className: classNames,
      extendedProps: {
        completed: isCompleted,
        note: reminder.note || '',
        date: reminder.date,
        endDate: reminder.endDate || null,
        time: reminder.time || null,
        endTime: reminder.endTime || null,
        priority: priority,
        categoryId: reminder.categoryId,
        projectId: reminder.projectId,
        blockId: reminder.blockId || reminder.id,
        docId: reminder.docId, // 添加docId
        docTitle: reminder.docTitle, // 添加文档标题
        isRepeated: isRepeated,
        originalId: originalId || reminder.id,
        repeat: reminder.repeat,
        isQuickReminder: reminder.isQuickReminder || false // 添加快速提醒标记
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
        eventObj.end = getLocalDateString(endDate);
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

    events.push(eventObj);
  }


  /**
   * 获取当前日历视图的日期范围
   */
  private getCurrentViewDateRange(): { start: string, end: string } {
    if (this.calendar && this.calendar.view) {
      const currentView = this.calendar.view;
      const startDate = getLocalDateString(currentView.activeStart);

      // 对于不同视图类型，计算正确的结束日期
      let endDate: string;
      if (currentView.type === 'timeGridDay') {
        // 日视图：结束日期就是开始日期（只显示当天）
        endDate = startDate;
      } else {
        // 月视图和周视图：结束日期需要减去1天，因为activeEnd是下一个周期的开始
        const actualEndDate = new Date(currentView.activeEnd.getTime() - 24 * 60 * 60 * 1000);
        endDate = getLocalDateString(actualEndDate);
      }

      return { start: startDate, end: endDate };
    } else {
      // 如果日历未初始化，返回当前月份范围
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return {
        start: getLocalDateString(monthStart),
        end: getLocalDateString(monthEnd)
      };
    }
  }

  /**
   * 根据日期范围过滤事件
   */
  private filterEventsByDateRange(events: any[], dateRange: { start: string, end: string }): any[] {
    return events.filter(event => {
      const eventDate = event.extendedProps.date;
      if (event.extendedProps.endDate) {
        // 检查事件日期范围是否与给定日期范围有重叠
        const eventStart = eventDate;
        const eventEnd = event.extendedProps.endDate;
        const rangeStart = dateRange.start;
        const rangeEnd = dateRange.end;
        
        // 如果事件开始日期在范围内，或者事件结束日期在范围内，或者事件包含整个范围
        return (eventStart >= rangeStart && eventStart <= rangeEnd) ||
               (eventEnd >= rangeStart && eventEnd <= rangeEnd) ||
               (eventStart <= rangeStart && eventEnd >= rangeEnd);
      }
      return eventDate >= dateRange.start && eventDate <= dateRange.end;
    });
  }

  /**
   * 获取当前视图信息
   */
  private getCurrentViewInfo(): string {
    if (this.calendar && this.calendar.view) {
      const currentView = this.calendar.view;
      const viewType = currentView.type;
      const startDate = currentView.activeStart;

      switch (viewType) {
        case 'dayGridMonth':
          return `${startDate.getFullYear()}年${startDate.getMonth() + 1}月`;
        case 'timeGridWeek':
          // 周视图：计算实际的结束日期
          const actualWeekEnd = new Date(currentView.activeEnd.getTime() - 24 * 60 * 60 * 1000);
          const weekStart = startDate.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
          const weekEnd = actualWeekEnd.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
          return `${weekStart} - ${weekEnd}`;
        case 'timeGridDay':
          // 日视图：只显示当天
          return startDate.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
          });
        default:
          return t("currentView") || "当前视图";
      }
    }
    return t("currentView") || "当前视图";
  }

  /**
   * 按日期和项目分组任务
   */
  private groupTasksByDateAndProject(events: any[], dateRange: { start: string; end: string; }) {
    // 检查当前是否为日视图
    const isDayView = this.calendar && this.calendar.view.type === 'timeGridDay';
    const grouped = new Map<string, Map<string, any[]>>();

    events.forEach(event => {
      const startDate = event.extendedProps.date;
      const endDate = event.extendedProps.endDate;
      const projectId = event.extendedProps.projectId || 'no-project';
      const projectName = projectId === 'no-project' ?
          (t("noProject") || "无项目") :
          this.projectManager.getProjectName(projectId) || projectId;

      const taskData = {
        title: event.originalTitle || event.title,
        completed: event.extendedProps.completed,
        priority: event.extendedProps.priority,
        time: event.extendedProps.time,
        note: event.extendedProps.note,
        docTitle: event.extendedProps.docTitle
      };

      // 如果有结束日期，说明是跨天任务，在每个相关日期都显示
      if (endDate && endDate !== startDate) {
        const start = new Date(Math.max(new Date(startDate).getTime(), new Date(dateRange.start).getTime()));
        const end = new Date(Math.min(new Date(endDate).getTime(), new Date(dateRange.end).getTime()));

        // 遍历从开始日期到结束日期的每一天
        const currentDate = new Date(start);
        while (currentDate <= end) {
          const dateStr = currentDate.toISOString().split('T')[0];

          if (!grouped.has(dateStr)) {
            grouped.set(dateStr, new Map());
          }

          const dateGroup = grouped.get(dateStr);
          if (!dateGroup.has(projectName)) {
            dateGroup.set(projectName, []);
          }

          dateGroup.get(projectName).push(taskData);

          // 移动到下一天
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else {
        // 单日任务，按原来的逻辑处理
        if (!grouped.has(startDate)) {
          grouped.set(startDate, new Map());
        }

        const dateGroup = grouped.get(startDate);
        if (!dateGroup.has(projectName)) {
          dateGroup.set(projectName, []);
        }

        dateGroup.get(projectName).push(taskData);
      }
    });

    return grouped;
  }


  /**
     * 设置日历实例
     */
    public setCalendar(calendar: any) {
        this.calendar = calendar;
    }

  setCategoryManager(calendarView: any) {
this.calendarView = calendarView;
  }

    /**
     * 生成摘要内容HTML
     */
    public generateSummaryContent(groupedTasks: Map<string, Map<string, any[]>>, dateRange?: { start: string, end: string }): string {
      let html = `
            <div class="task-summary-container">
                <div class="task-summary-header" style="
                    display: flex;
                    justify-content: flex-end;
                    margin-bottom: 16px;
                ">
                    <button class="b3-button b3-button--outline" id="more-menu-btn" style="
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        padding: 6px 12px;
                        font-size: 13px;
                    ">
                        <svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>
                    </button>
                </div>
                <div class="task-summary-content" id="summary-content">
        `;
        
        // 按日期排序
        const sortedDates = Array.from(groupedTasks.keys()).sort();
        
        // 检查当前是否为日视图
        const isDayView = this.calendar && this.calendar.view.type === 'timeGridDay';
        
        // 在日视图下，只显示当前日期的任务
        const datesToShow = isDayView && dateRange ? [dateRange.start] : sortedDates;
        
        datesToShow.forEach(date => {
            // 在日视图下，确保只处理存在的日期
            if (isDayView && !groupedTasks.has(date)) {
                return;
            }
            const dateProjects = groupedTasks.get(date);
            const dateObj = new Date(date);
            const formattedDate = dateObj.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });
            
            html += `<div class="task-date-group">`;
            html += `<h3 class="task-date-title">${formattedDate}</h3>`;
            
            // 按项目分组
            dateProjects.forEach((tasks, projectName) => {
                html += `<div class="task-project-group">`;
                html += `<h4 class="task-project-title">${projectName}</h4>`;
                html += `<ul class="task-list">`;
                
                tasks.forEach(task => {
                    const completedClass = task.completed ? 'completed' : '';
                    const priorityClass = `priority-${task.priority}`;
                    const timeStr = task.time ? ` (${task.time})` : '';
                    
                    html += `
                        <li class="task-item ${completedClass} ${priorityClass}">
                            <span class="task-checkbox">${task.completed ? '✅' : '⬜'}</span>
                            <span class="task-title">${task.title}${timeStr}</span>
                            ${task.note ? `<div class="task-note">${task.note}</div>` : ''}
                        </li>
                    `;
                });
                
                html += `</ul></div>`;
            });
            
            html += `</div>`;
        });
        
        html += `
                </div>
            </div>
            <style>
                .task-summary-container {
                    padding: 16px;
                    max-height: 60vh;
                    overflow-y: auto;
                }

                .task-date-group {
                    margin-bottom: 24px;
                }
                .task-date-title {
                    color: var(--b3-theme-primary);
                    border-bottom: 2px solid var(--b3-theme-primary);
                    padding-bottom: 8px;
                    margin-bottom: 16px;
                }
                .task-project-group {
                    margin-bottom: 16px;
                    margin-left: 16px;
                }
                .task-project-title {
                    color: var(--b3-theme-secondary);
                    margin-bottom: 8px;
                }
                .task-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }
                .task-item {
                    display: flex;
                    align-items: flex-start;
                    padding: 8px 0;
                    border-bottom: 1px solid var(--b3-border-color);
                }
                .task-item.completed {
                    opacity: 0.6;
                }
                .task-item.completed .task-title {
                    text-decoration: line-through;
                }
                .task-checkbox {
                    margin-right: 8px;
                    flex-shrink: 0;
                }
                .task-title {
                    flex: 1;
                    word-break: break-word;
                }
                .task-note {
                    font-size: 12px;
                    color: var(--b3-theme-on-surface-light);
                    margin-top: 4px;
                    margin-left: 24px;
                }
                .priority-high .task-title {
                    color: #e74c3c;
                    font-weight: bold;
                }
                .priority-medium .task-title {
                    color: #f39c12;
                }
                .priority-low .task-title {
                    color: #3498db;
                }
            </style>
        `;
        
        // 添加更多菜单功能
        setTimeout(() => {
            this.bindMoreMenuEvents(groupedTasks);
        }, 100);
        
        return html;
    }

    /**
     * 绑定更多菜单事件
     */
    private bindMoreMenuEvents(groupedTasks: Map<string, Map<string, any[]>>) {
        const moreMenuBtn = document.getElementById('more-menu-btn');
        
        if (!moreMenuBtn) return;
        
        moreMenuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showMoreMenu(e as MouseEvent, groupedTasks);
        });
    }

    /**
     * 显示更多菜单
     */
    private showMoreMenu(event: MouseEvent, groupedTasks: Map<string, Map<string, any[]>>) {
        try {
            const menu = new Menu("taskSummaryMoreMenu");

            // 添加复制富文本选项
            menu.addItem({
                icon: 'iconCopy',
                label: t("copyRichText") || "复制富文本",
                click: () => this.executeCopy('rich', groupedTasks)
            });

            // 添加复制 Markdown 选项
            menu.addItem({
                icon: 'iconCopy',
                label: t("copyAll") || "复制 Markdown",
                click: () => this.executeCopy('markdown', groupedTasks)
            });

            // 添加复制纯文本选项
            menu.addItem({
                icon: 'iconCopy',
                label: t("copyPlainText") || "复制纯文本",
                click: () => this.executeCopy('plain', groupedTasks)
            });

            // 显示菜单
            if (event.target instanceof HTMLElement) {
                const rect = event.target.getBoundingClientRect();
                menu.open({
                    x: rect.left,
                    y: rect.bottom + 4
                });
            } else {
                menu.open({
                    x: event.clientX,
                    y: event.clientY
                });
            }
        } catch (error) {
            console.error('显示更多菜单失败:', error);
        }
    }

    /**
     * 复制任务摘要到剪贴板
     */
    public copyTaskSummary(groupedTasks: Map<string, Map<string, any[]>>) {
        let text = '';

        const sortedDates = Array.from(groupedTasks.keys()).sort();

        sortedDates.forEach(date => {
            const dateProjects = groupedTasks.get(date);
            const dateObj = new Date(date);
            const formattedDate = dateObj.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });

            // 非日视图时才添加日期标题
            if (this.calendar && this.calendar.view.type !== 'timeGridDay') {
                text += `## ${formattedDate}

`;
            }

            dateProjects.forEach((tasks, projectName) => {
                text += `### ${projectName}

`;

                tasks.forEach(task => {
                    const checkbox = task.completed ? '- [x]' : '- [ ]';
                    const timeStr = task.time ? ` (${task.time})` : '';

                    text += `${checkbox} ${task.title}${timeStr}
`;
                    if (task.note) {
                        text += `  > ${task.note}
`;
                    }
                });

                text += `
`;
            });

            text += `
`;
        });

        navigator.clipboard.writeText(text).then(() => {
            showMessage(t("copiedToClipboard") || "已复制到剪贴板");
        }).catch(err => {
            console.error('复制失败:', err);
            showMessage(t("copyFailed") || "复制失败");
        });
    }

    /**
     * 复制任务摘要纯文本到剪贴板（带编号）
     */
    public copyTaskSummaryPlainText(groupedTasks: Map<string, Map<string, any[]>>) {
        let text = '';
        
        const sortedDates = Array.from(groupedTasks.keys()).sort();
        
        sortedDates.forEach(date => {
            const dateProjects = groupedTasks.get(date);
            const dateObj = new Date(date);
            const formattedDate = dateObj.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });
            
            // 非日视图时才添加日期标题
            if (this.calendar && this.calendar.view.type !== 'timeGridDay') {
                text += `${formattedDate}
${'-'.repeat(formattedDate.length)}

`;
            }
            
            dateProjects.forEach((tasks, projectName) => {
                text += `【${projectName}】
`;

                let taskNumber = 1; // 全局任务编号
                tasks.forEach(task => {
                    const timeStr = task.time ? ` (${task.time})` : '';
                    
                    text += `${taskNumber}.  ${task.title}
`;
                    taskNumber++;
                });
                
                text += `
`;
            });
            
            text += `
`;
        });
        
        navigator.clipboard.writeText(text).then(() => {
            showMessage(t("copiedToClipboard") || "已复制到剪贴板");
        }).catch(err => {
            console.error('复制失败:', err);
            showMessage(t("copyFailed") || "复制失败");
        });
    }

    /**
     * 复制任务摘要富文本到剪贴板（带编号，HTML格式）
     */
    public copyTaskSummaryRichText(groupedTasks: Map<string, Map<string, any[]>>) {
        let html = '';
        
        const sortedDates = Array.from(groupedTasks.keys()).sort();
        
        html += '<div style="font-family: Arial, sans-serif; line-height: 1.6;">';
        
        sortedDates.forEach(date => {
            const dateProjects = groupedTasks.get(date);
            const dateObj = new Date(date);
            const formattedDate = dateObj.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });
            
            // 非日视图时才添加日期标题
            if (this.calendar && this.calendar.view.type !== 'timeGridDay') {
                html += `<h2 style="color: #1976D2; margin: 20px 0 12px 0; font-size: 18px; border-bottom: 2px solid #1976D2; padding-bottom: 4px;">${formattedDate}</h2>`;
            }
            
            dateProjects.forEach((tasks, projectName) => {
                html += `<h3 style="color: #2196F3; margin: 16px 0 8px 0; font-size: 16px;">【${projectName}】</h3>`;
                html += '<ol style="margin: 0 0 16px 0; padding-left: 20px;">';

                tasks.forEach(task => {
                    // const timeStr = task.time ? ` <span style="color: #666; font-size: 12px;">(${task.time})</span>` : '';
                    
                    html += `<li style="margin: 4px 0; color: #333;">${task.title}</li>`;
                });
                
                html += '</ol>';
            });
            
            html += '<br>';
        });
        
        html += '</div>';
        
        // 创建一个临时的 ClipboardItem 来复制富文本
        const blob = new Blob([html], { type: 'text/html' });
        const clipboardItem = new ClipboardItem({ 'text/html': blob });
        
        navigator.clipboard.write([clipboardItem]).then(() => {
            showMessage(t("copiedToClipboard") || "已复制到剪贴板");
        }).catch(err => {
            console.error('富文本复制失败:', err);
            // 如果富文本复制失败，尝试复制纯文本版本
            const plainText = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
            navigator.clipboard.writeText(plainText).then(() => {
                showMessage(t("copiedToClipboard") || "已复制到剪贴板（纯文本格式）");
            }).catch(err2 => {
                console.error('纯文本复制也失败:', err2);
                showMessage(t("copyFailed") || "复制失败");
            });
        });
    }

    /**
     * 执行复制操作
     */
    public executeCopy(copyType: string, groupedTasks: Map<string, Map<string, any[]>>) {
        switch (copyType) {
            case 'rich':
                this.copyTaskSummaryRichText(groupedTasks);
                break;
            case 'markdown':
                this.copyTaskSummary(groupedTasks);
                break;
            case 'plain':
                this.copyTaskSummaryPlainText(groupedTasks);
                break;
            default:
                this.copyTaskSummaryRichText(groupedTasks);
        }
    }

}