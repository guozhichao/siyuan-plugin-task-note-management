import { Dialog, showMessage, Menu } from "siyuan";
import { t } from "../utils/i18n";
import { getLocalDateString, getLogicalDateString } from "../utils/dateUtils";
import { ProjectManager } from "../utils/projectManager";
import { readReminderData, readHabitData } from "@/api";
import { generateRepeatInstances } from "@/utils/repeatUtils";
import { CalendarView } from "@/components/CalendarView";
import { PomodoroRecordManager } from "@/utils/pomodoroRecord";
import { SETTINGS_FILE } from "../index";

export class TaskSummaryDialog {
  private calendarView: CalendarView;
  private projectManager: ProjectManager;
  private calendar: any;
  private plugin: any;

  private currentDialog: Dialog;
  private currentFilter: string = 'current'; // 'current', 'today', 'tomorrow', 'yesterday', 'thisWeek', 'nextWeek', 'lastWeek', 'thisMonth', 'lastMonth'
  private lastGroupedTasks: Map<string, Map<string, any[]>> | null = null;
  private lastStats: any = null;

  constructor(calendar?: any, plugin?: any) {
    this.projectManager = ProjectManager.getInstance(plugin);
    this.calendar = calendar;
    this.plugin = plugin;
  }

  private getDisplayTimeForDate(task: any, date: string): string {
    // 返回不带前后空格的时间区间字符串，例如 "(14:49-19:49)" 或 "(14:49-23:59)"，若无时间返回空字符串
    const sd = task.fullStartDate;
    const ed = task.fullEndDate;
    const st = task.time;
    const et = task.endTime;

    const wrap = (s: string) => s ? ` (${s})` : '';

    if (!sd && !ed) {
      if (st) return wrap(st + (et ? `-${et}` : ''));
      return '';
    }

    if (!ed || sd === ed) {
      if (st && et) return wrap(`${st}-${et}`);
      if (st) return wrap(st);
      return '';
    }

    // 跨天任务
    if (date === sd) {
      if (st) return wrap(`${st}-23:59`);
      return wrap('全天');
    }

    if (date === ed) {
      if (et) return wrap(`00:00-${et}`);
      return wrap('全天');
    }

    // 中间天
    return wrap('00:00-23:59');
  }

  private formatMonthDay(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  private formatRepeatLabel(repeat: any, startDate?: string): string {
    if (!repeat || !repeat.type) return '';
    const interval = repeat.interval || 1;
    switch (repeat.type) {
      case 'daily':
        return interval === 1 ? `🔄 ${t('daily') || '每天'}` : `🔄 ${t('every') || '每'}${interval}${t('days') || '天'}`;
      case 'weekly': {
        // 优先使用配置中的 weekDays
        if (repeat.weekDays && repeat.weekDays.length > 0) {
          const days = repeat.weekDays.map((d: number) => {
            const keys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            return t(keys[d]);
          }).join('、');
          return `🔄 ${t('weekly') || '每周'} (${days})`;
        }
        // 如果没有显式 weekDays，尝试从 startDate 推断单一星期几
        if (startDate) {
          try {
            const sd = new Date(startDate + 'T00:00:00');
            const d = sd.getDay();
            const keys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const dayLabel = t(keys[d]);
            return `🔄 ${t('weekly') || '每周'}${dayLabel}`;
          } catch (e) {
            // fallback
          }
        }
        return interval === 1 ? `🔄 ${t('weekly') || '每周'}` : `🔄 ${t('every') || '每'}${interval}${t('weeks') || '周'}`;
      }
      case 'monthly': {
        if (repeat.monthDays && repeat.monthDays.length > 0) {
          return `🔄 ${t('monthly') || '每月'} (${repeat.monthDays.join('、')}${t('day') || '日'})`;
        }
        return interval === 1 ? `🔄 ${t('monthly') || '每月'}` : `🔄 ${t('every') || '每'}${interval}${t('months') || '月'}`;
      }
      case 'yearly':
        return `🔄 ${t('yearly') || '每年'}`;
      case 'custom': {
        const parts: string[] = [];
        if (repeat.weekDays && repeat.weekDays.length) {
          const days = repeat.weekDays.map((d: number) => t(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][d]));
          parts.push(`${t('weekly') || '每周'}(${days.join('、')})`);
        }
        if (repeat.monthDays && repeat.monthDays.length) {
          parts.push(`${t('monthly') || '每月'}(${repeat.monthDays.join('、')}${t('day') || '日'})`);
        }
        if (repeat.months && repeat.months.length) {
          parts.push(`${t('yearly') || '每年'}(${repeat.months.join('、')}${t('month') || '月'})`);
        }
        return `🔄 ${parts.join(' ')}`;
      }
      case 'ebbinghaus':
        return `🔄 ${t('ebbinghaus') || '艾宾浩斯'}`;
      case 'lunar-monthly':
        return `🔄 ${t('lunarMonthly') || '农历每月'}`;
      case 'lunar-yearly':
        return `🔄 ${t('lunarYearly') || '农历每年'}`;
      default:
        return '';
    }
  }

  /**
   * 显示任务摘要弹窗
   */
  public async showTaskSummaryDialog() {
    try {
      this.currentFilter = 'current';

      // 创建弹窗
      this.currentDialog = new Dialog({
        title: t("taskSummary") || "任务摘要",
        content: `<div id="task-summary-dialog-container" style="height: 100%; display: flex; flex-direction: column;"></div>`,
        width: "90vw",
        height: "85vh"
      });

      this.renderSummary();
    } catch (error) {
      console.error('显示任务摘要失败:', error);
      showMessage(t("showSummaryFailed") || "显示摘要失败");
    }
  }

  private async renderSummary() {
    const container = this.currentDialog.element.querySelector('#task-summary-dialog-container') as HTMLElement;
    if (!container) return;

    container.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; height: 100%;"><svg class="ft__loading"><use xlink:href="#iconLoading"></use></svg></div>`;

    const dateRange = this.getFilterDateRange();
    const events = await this.getEventsForRange(dateRange.start, dateRange.end);

    // 过滤在当前视图范围内的任务
    const filteredEvents = this.filterEventsByDateRange(events, dateRange);

    // 按日期和项目分组任务
    const groupedTasks = this.groupTasksByDateAndProject(filteredEvents, dateRange);

    // 获取统计数据
    const stats = await this.calculateStats(dateRange.start, dateRange.end);

    // 保存上次生成的数据，供复制使用
    this.lastGroupedTasks = groupedTasks;
    this.lastStats = stats;

    container.innerHTML = this.generateSummaryContent(groupedTasks, dateRange, stats);

    this.bindSummaryEvents();
  }

  private getFilterDateRange(): { start: string, end: string, label: string } {
    if (this.currentFilter === 'current') {
      const range = this.getCurrentViewDateRange();
      return { ...range, label: this.getCurrentViewInfo() };
    }
    return this.getRange(this.currentFilter);
  }

  private async getEventsForRange(startDate: string, endDate: string) {
    try {
      const reminderData = await readReminderData();
      const events = [];

      for (const reminder of Object.values(reminderData) as any[]) {
        if (!reminder || typeof reminder !== 'object') continue;

        // 应用分类过滤
        if (this.calendarView && !this.calendarView.passesCategoryFilter(reminder)) continue;

        // 添加原始事件
        this.addEventToList(events, reminder, reminder.id, false);

        // 如果有重复设置，生成重复事件实例
        if (reminder.repeat?.enabled) {
          const repeatInstances = generateRepeatInstances(reminder, startDate, endDate);
          repeatInstances.forEach(instance => {
            // 跳过与原始事件相同日期的实例
            if (instance.date !== reminder.date) {
              const originalKey = instance.date;

              // 检查实例级别的完成状态
              const completedInstances = reminder.repeat?.completedInstances || [];
              const isInstanceCompleted = completedInstances.includes(originalKey);

              // 检查实例级别的修改
              const instanceModifications = reminder.repeat?.instanceModifications || {};
              const instanceMod = instanceModifications[originalKey];

              const instanceReminder = {
                ...reminder,
                date: instance.date,
                endDate: instance.endDate,
                time: instance.time,
                endTime: instance.endTime,
                completed: isInstanceCompleted,
                note: instanceMod?.note || '',
                docTitle: reminder.docTitle
              };

              const uniqueInstanceId = `${reminder.id}_instance_${originalKey}`;
              this.addEventToList(events, instanceReminder, uniqueInstanceId, true, reminder.id);
            }
          });
        }
      }

      return events;
    } catch (error) {
      console.error('获取事件数据失败:', error);
      return [];
    }
  }

  private async calculateStats(startDate: string, endDate: string) {
    const settings = this.plugin?.data[SETTINGS_FILE] || {};
    const reminderData = await readReminderData(); // 读取提醒数据用于层级统计

    // 1. 番茄钟统计
    const pomodoroManager = PomodoroRecordManager.getInstance();
    await pomodoroManager.initialize();

    let totalPomodoros = 0;
    let totalMinutes = 0;
    const pomodoroByDate: { [date: string]: { count: number, minutes: number, taskStats: any } } = {};

    const start = new Date(startDate);
    const end = new Date(endDate);
    const current = new Date(start);

    while (current <= end) {
      const dateStr = getLogicalDateString(current);
      const record = (pomodoroManager as any).records[dateStr];
      if (record) {
        totalPomodoros += record.workSessions || 0;
        totalMinutes += record.totalWorkTime || 0;

        // 原始统计
        const rawTaskStats: { [id: string]: { count: number, minutes: number } } = {};
        if (record.sessions) {
          record.sessions.forEach((s: any) => {
            if (s.type === 'work' && s.completed) {
              // 兼容旧数据，有些session没有eventId
              const evtId = s.eventId;
              if (evtId) {
                if (!rawTaskStats[evtId]) rawTaskStats[evtId] = { count: 0, minutes: 0 };
                rawTaskStats[evtId].count += (typeof s.count === 'number' ? s.count : 1);
                rawTaskStats[evtId].minutes += s.duration || 0;
              }
            }
          });
        }

        // 聚合统计（包含子任务数据）
        const aggregatedTaskStats: { [id: string]: { count: number, minutes: number } } = {};

        // 1. 先复制原始数据
        Object.keys(rawTaskStats).forEach(id => {
          if (!aggregatedTaskStats[id]) aggregatedTaskStats[id] = { count: 0, minutes: 0 };
          aggregatedTaskStats[id].count += rawTaskStats[id].count;
          aggregatedTaskStats[id].minutes += rawTaskStats[id].minutes;
        });

        // 2. 向上冒泡累加
        Object.keys(rawTaskStats).forEach(sourceId => {
          let currentId = sourceId;
          const statsToAdd = rawTaskStats[sourceId];

          // 防止死循环，设置最大深度
          let depth = 0;
          while (depth < 20) {
            const reminder = reminderData[currentId];
            if (!reminder || !reminder.parentId) break;

            const parentId = reminder.parentId;
            if (!aggregatedTaskStats[parentId]) aggregatedTaskStats[parentId] = { count: 0, minutes: 0 };

            aggregatedTaskStats[parentId].count += statsToAdd.count;
            aggregatedTaskStats[parentId].minutes += statsToAdd.minutes;

            currentId = parentId;
            depth++;
          }
        });

        pomodoroByDate[getLocalDateString(current)] = {
          count: record.workSessions || 0,
          minutes: record.totalWorkTime || 0,
          taskStats: aggregatedTaskStats
        };
      }
      current.setDate(current.getDate() + 1);
    }

    // 2. 习惯打卡统计
    const habitData = await readHabitData();
    let totalHabitTargetDays = 0;
    let completedHabitDays = 0;
    const habitsByDate: { [date: string]: any[] } = {};

    const habits = Object.values(habitData) as any[];

    const dateList: string[] = [];
    const tempDate = new Date(start);
    while (tempDate <= end) {
      dateList.push(getLocalDateString(tempDate));
      tempDate.setDate(tempDate.getDate() + 1);
    }

    habits.forEach(habit => {
      dateList.forEach(dateStr => {
        if (this.shouldCheckInOnDate(habit, dateStr)) {
          totalHabitTargetDays++;
          const isComplete = this.isHabitComplete(habit, dateStr);
          if (isComplete) {
            completedHabitDays++;
          }

          if (!habitsByDate[dateStr]) habitsByDate[dateStr] = [];

          // 获取当天的打卡emoji
          const checkIn = habit.checkIns?.[dateStr];
          const emojis: string[] = [];
          if (checkIn) {
            if (checkIn.entries && checkIn.entries.length > 0) {
              checkIn.entries.forEach((entry: any) => {
                if (entry.emoji) emojis.push(entry.emoji);
              });
            } else if (checkIn.status && checkIn.status.length > 0) {
              emojis.push(...checkIn.status);
            }
          }

          // 获取成功打卡的次数
          const successCount = emojis.filter(emoji => {
            const emojiConfig = habit.checkInEmojis?.find((e: any) => e.emoji === emoji);
            return emojiConfig ? (emojiConfig.countsAsSuccess !== false) : true;
          }).length;

          habitsByDate[dateStr].push({
            title: habit.title,
            completed: isComplete,
            target: habit.target || 1,
            successCount,
            emojis: emojis.slice(0, 10), // 最多显示10个
            frequencyLabel: this.getFrequencyLabel(habit)
          });
        }
      });
    });

    return {
      settings: {
        showPomodoro: settings.showPomodoroInSummary !== false,
        showHabit: settings.showHabitInSummary !== false
      },
      pomodoro: {
        totalCount: totalPomodoros,
        totalHours: (totalMinutes / 60).toFixed(1),
        byDate: pomodoroByDate
      },
      habit: {
        total: totalHabitTargetDays,
        completed: completedHabitDays,
        byDate: habitsByDate
      }
    };
  }

  private getFrequencyLabel(habit: any): string {
    const { frequency } = habit;
    if (!frequency) return t('daily');

    let label = '';
    const interval = frequency.interval || 1;

    switch (frequency.type) {
      case 'daily':
        label = interval === 1 ? t('daily') : `${t('every')}${interval}${t('days')}`;
        break;
      case 'weekly':
        if (frequency.weekdays && frequency.weekdays.length > 0) {
          const days = frequency.weekdays.map((d: number) => {
            const keys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            return t(keys[d]);
          }).join('、');
          label = `${t('weekly')} (${days})`;
        } else {
          label = interval === 1 ? t('weekly') : `${t('every')}${interval}${t('weeks')}`;
        }
        break;
      case 'monthly':
        if (frequency.monthDays && frequency.monthDays.length > 0) {
          label = `${t('monthly')} (${frequency.monthDays.join('、')}${t('day')})`;
        } else {
          label = interval === 1 ? t('monthly') : `${t('every')}${interval}${t('months')}`;
        }
        break;
      case 'yearly':
        label = t('yearly');
        break;
      default:
        label = t('daily');
    }
    return label;
  }

  private shouldCheckInOnDate(habit: any, date: string): boolean {
    if (habit.startDate > date) return false;
    if (habit.endDate && habit.endDate < date) return false;

    const { frequency } = habit;
    const checkDate = new Date(date);
    const startDate = new Date(habit.startDate);

    switch (frequency?.type) {
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
        if (frequency.months && frequency.months.length > 0) {
          if (!frequency.months.includes(checkDate.getMonth() + 1)) return false;
          if (frequency.monthDays && frequency.monthDays.length > 0) {
            return frequency.monthDays.includes(checkDate.getDate());
          }
          return checkDate.getDate() === startDate.getDate();
        }
        if (frequency.interval) {
          const yearsDiff = checkDate.getFullYear() - startDate.getFullYear();
          return yearsDiff % frequency.interval === 0 &&
            checkDate.getMonth() === startDate.getMonth() &&
            checkDate.getDate() === startDate.getDate();
        }
        return checkDate.getMonth() === startDate.getMonth() &&
          checkDate.getDate() === startDate.getDate();
    }
    return true;
  }

  private isHabitComplete(habit: any, dateStr: string): boolean {
    const checkIn = habit.checkIns?.[dateStr];
    if (!checkIn) return false;

    const emojis: string[] = [];
    if (checkIn.entries && checkIn.entries.length > 0) {
      checkIn.entries.forEach((entry: any) => {
        if (entry.emoji) emojis.push(entry.emoji);
      });
    } else if (checkIn.status && checkIn.status.length > 0) {
      emojis.push(...checkIn.status);
    }

    const successEmojis = emojis.filter(emoji => {
      const emojiConfig = habit.checkInEmojis?.find((e: any) => e.emoji === emoji);
      return emojiConfig ? (emojiConfig.countsAsSuccess !== false) : true;
    });

    return successEmojis.length >= (habit.target || 1);
  }

  private getRange(type: string): { start: string, end: string, label: string } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let start = new Date(today);
    let end = new Date(today);
    let label = '';

    switch (type) {
      case 'today':
        label = t('today');
        break;
      case 'tomorrow':
        start.setDate(today.getDate() + 1);
        end.setDate(today.getDate() + 1);
        label = t('tomorrow');
        break;
      case 'yesterday':
        start.setDate(today.getDate() - 1);
        end.setDate(today.getDate() - 1);
        label = t('yesterday');
        break;
      case 'thisWeek': {
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1);
        start.setDate(diff);
        end.setDate(diff + 6);
        label = `${t('thisWeek')} (${getLocalDateString(start)} ~ ${getLocalDateString(end)})`;
        break;
      }
      case 'nextWeek': {
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? 1 : 8);
        start.setDate(diff);
        end.setDate(diff + 6);
        label = `${t('nextWeek')} (${getLocalDateString(start)} ~ ${getLocalDateString(end)})`;
        break;
      }
      case 'lastWeek': {
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -13 : -6);
        start.setDate(diff);
        end.setDate(diff + 6);
        label = `${t('lastWeek')} (${getLocalDateString(start)} ~ ${getLocalDateString(end)})`;
        break;
      }
      case 'thisMonth':
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        label = t('thisMonth');
        break;
      case 'lastMonth':
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0);
        label = t('lastMonth');
        break;
    }
    return { start: getLocalDateString(start), end: getLocalDateString(end), label };
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
              const instanceIdStr = (instance as any).instanceId || `${reminder.id}_${instance.date}`;
              const originalKey = instanceIdStr.split('_').pop() || instance.date;

              // 检查实例级别的完成状态
              const completedInstances = reminder.repeat?.completedInstances || [];
              const isInstanceCompleted = completedInstances.includes(originalKey);

              // 检查实例级别的修改
              const instanceModifications = reminder.repeat?.instanceModifications || {};
              const instanceMod = instanceModifications[originalKey];

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

              // 确保实例ID的唯一性，避免重复 — 使用原始实例键作为 id 的后缀
              const uniqueInstanceId = `${reminder.id}_instance_${originalKey}`;
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
        dailyCompletions: reminder.dailyCompletions || {},
        date: reminder.date,
        endDate: reminder.endDate || null,
        time: reminder.time || null,
        endTime: reminder.endTime || null,
        priority: priority,
        categoryId: reminder.categoryId,
        projectId: reminder.projectId,
        blockId: reminder.blockId || reminder.id,
        parentId: reminder.parentId, // 添加父任务ID
        docId: reminder.docId, // 添加docId
        docTitle: reminder.docTitle, // 添加文档标题
        isRepeated: isRepeated,
        originalId: originalId || reminder.id,
        repeat: reminder.repeat,
        isQuickReminder: reminder.isQuickReminder || false, // 添加快速提醒标记
        estimatedPomodoroDuration: reminder.estimatedPomodoroDuration // 预计番茄时长
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
        // 对于没有日期的任务，不设置 start，这样它们可以在后续被过滤器处理
        if (reminder.date) {
          eventObj.start = reminder.date;
        }
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
    const includedEvents = events.filter(event => {
      const eventDate = event.extendedProps.date;
      // Undated events don't pass standard filter
      if (!eventDate) return false;

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

    // 2. 额外逻辑：如果父任务被包含在内，且子任务未设置日期，则也显示该子任务
    const additionalEvents: any[] = [];

    // 筛选出所有未设置日期的潜在子任务
    const undatedCandidates = events.filter(e => !e.extendedProps.date && e.extendedProps.parentId);

    if (undatedCandidates.length > 0) {
      includedEvents.forEach(parent => {
        // 使用 originalId 或 blockId 作为父任务的 ID
        const parentId = parent.extendedProps.originalId || parent.extendedProps.blockId || parent.id;
        const parentDate = parent.extendedProps.date;

        // 查找该父任务的未设置日期的子任务
        const myChildren = undatedCandidates.filter(c => c.extendedProps.parentId === parentId);

        myChildren.forEach(child => {
          // 克隆子任务对象，以免修改原始引用影响其他逻辑
          const newChild = { ...child };
          newChild.extendedProps = { ...child.extendedProps };

          // 将子任务的日期设置为父任务的日期，以便在分组时能正确归类到父任务所在日期
          newChild.extendedProps.date = parentDate;
          newChild.start = parentDate; // 保持一致性

          additionalEvents.push(newChild);
        });
      });
    }

    return [...includedEvents, ...additionalEvents];
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

      const perDateCompleted = (d: string) => {
        const dc = event.extendedProps.dailyCompletions || {};
        return (event.extendedProps.completed === true) || (dc[d] === true);
      };

      const taskData = {
        id: event.extendedProps.originalId || event.extendedProps.blockId || event.id,
        title: event.originalTitle || event.title,
        // completed will be set per-date when adding to grouped map
        completed: event.extendedProps.completed,
        priority: event.extendedProps.priority,
        time: event.extendedProps.time,
        endTime: event.extendedProps.endTime,
        fullStartDate: event.extendedProps.date,
        fullEndDate: event.extendedProps.endDate || null,
        repeat: event.extendedProps.repeat || null,
        repeatLabel: event.extendedProps.repeat ? this.formatRepeatLabel(event.extendedProps.repeat, event.extendedProps.date) : '',
        note: event.extendedProps.note,
        docTitle: event.extendedProps.docTitle,
        estimatedPomodoroDuration: event.extendedProps.estimatedPomodoroDuration,
        extendedProps: event.extendedProps, // 保留完整的 extendedProps 以便层级排序使用
        _perDateCompleted: perDateCompleted
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

          // for cross-day tasks, set completed per-date
          const item = { ...taskData };
          item.completed = typeof taskData._perDateCompleted === 'function' ? taskData._perDateCompleted(dateStr) : taskData.completed;
          dateGroup.get(projectName).push(item);

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

        // 单日任务，按原来的逻辑处理
        const item = { ...taskData };
        const dateStr = startDate;
        item.completed = typeof taskData._perDateCompleted === 'function' ? taskData._perDateCompleted(dateStr) : taskData.completed;
        dateGroup.get(projectName).push(item);
      }
    });



    // 对每个分组内的任务进行层级排序
    grouped.forEach((projectMap) => {
      projectMap.forEach((tasks, projectName) => {
        const sortedTasks = this.sortTasksByHierarchy(tasks);
        projectMap.set(projectName, sortedTasks);
      });
    });

    return grouped;
  }

  /**
   * 按层级排序任务，并计算深度
   */
  private sortTasksByHierarchy(tasks: any[]): any[] {
    if (!tasks || tasks.length === 0) return [];

    const taskMap = new Map<string, any>();
    tasks.forEach(t => taskMap.set(t.id, t));

    // 找出每个任务的子任务
    const childrenMap = new Map<string, any[]>();
    const roots: any[] = [];

    tasks.forEach(task => {
      task.depth = 0; // 初始化深度
      const parentId = task.extendedProps?.parentId; // 从 extendedProps 获取 parentId

      // 如果有父任务且父任务也在当前列表中，则是子任务
      if (parentId && taskMap.has(parentId)) {
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId).push(task);
      } else {
        // 否则视为根任务（在当前视图范围内）
        roots.push(task);
      }
    });

    const result: any[] = [];

    // 递归辅助函数，增加 completion 传递
    const traverse = (nodes: any[], depth: number, parentCompleted: boolean) => {
      nodes.forEach(node => {
        // 如果父任务已完成，子任务也包括显示为完成
        if (parentCompleted) {
          node.completed = true;
        }

        node.depth = depth;
        result.push(node);
        const children = childrenMap.get(node.id);
        if (children) {
          // 子任务按原来的顺序（通常是时间或创建顺序）排列，也可以根据需要再次排序
          traverse(children, depth + 1, node.completed);
        }
      });
    };

    traverse(roots, 0, false);
    return result;
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
  public generateSummaryContent(groupedTasks: Map<string, Map<string, any[]>>, dateRange: { start: string, end: string, label: string }, stats: any): string {
    const filters = [
      { id: 'current', label: t('currentView') || '当前视图' },
      { id: 'today', label: t('today') },
      { id: 'tomorrow', label: t('tomorrow') },
      { id: 'yesterday', label: t('yesterday') },
      { id: 'thisWeek', label: t('thisWeek') },
      { id: 'nextWeek', label: t('nextWeek') },
      { id: 'lastWeek', label: t('lastWeek') },
      { id: 'thisMonth', label: t('thisMonth') },
      { id: 'lastMonth', label: t('lastMonth') },
    ];

    // 统计任务完成/总数（按显示实例计数）
    let totalTasks = 0;
    let completedTasks = 0;
    groupedTasks.forEach((projMap) => {
      projMap.forEach((tasks) => {
        totalTasks += tasks.length;
        tasks.forEach((t: any) => { if (t.completed) completedTasks++; });
      });
    });
    const completionText = `已完成 ${completedTasks}/${totalTasks} 任务`;

    let html = `
        <div class="task-summary-wrapper" style="display: flex; flex-direction: column; height: 100%; padding: 16px;">
            <div class="task-summary-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px;">
                <div class="filter-buttons" style="display: flex; gap: 4px; flex-wrap: wrap;">
                    ${filters.map(f => `
                        <button class="b3-button ${this.currentFilter === f.id ? '' : 'b3-button--outline'}" 
                                data-filter="${f.id}" 
                                style="padding: 4px 8px; font-size: 12px;">
                            ${f.label}
                        </button>
                    `).join('')}
                </div>
                <div class="action-buttons" style="display: flex; gap: 8px;">
                    <button class="b3-button b3-button--outline" id="copy-rich-text-btn" style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 12px; height: 28px;">
                        <svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconCopy"></use></svg>
                        ${t("copyRichText") || "复制富文本"}
                    </button>
                    <button class="b3-button b3-button--outline" id="copy-markdown-btn" style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 12px; height: 28px;">
                        <svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconCopy"></use></svg>
                        ${t("copyAll") || "Markdown"}
                    </button>
                    <button class="b3-button b3-button--outline" id="copy-plain-btn" style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 12px; height: 28px;">
                        <svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconCopy"></use></svg>
                        ${t("copyPlainText") || "复制纯文本"}
                    </button>
                </div>
            </div>

            <div class="task-summary-info-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px;">
              <div class="info-card" style="padding: 12px; background: var(--b3-theme-surface); border-radius: 8px; border: 1px solid var(--b3-border-color);">
                <div style="font-size: 12px; color: var(--b3-theme-on-surface-light);">${t('currentRange') || '当前范围'}</div>
                <div style="font-size: 14px; font-weight: bold; margin-top: 4px;">${dateRange.label}</div>
              </div>
              <div class="info-card" id="task-completion-card" style="padding: 12px; background: var(--b3-theme-surface); border-radius: 8px; border: 1px solid var(--b3-border-color);">
                <div style="font-size: 12px; color: var(--b3-theme-on-surface-light);">✅ 任务完成情况</div>
                <div style="font-size: 14px; font-weight: bold; margin-top: 4px;">${completionText}</div>
              </div>
                ${stats.settings.showPomodoro ? `
                <div class="info-card" style="padding: 12px; background: var(--b3-theme-surface); border-radius: 8px; border: 1px solid var(--b3-border-color);">
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light);">🍅 ${t('pomodoroFocus') || '番茄专注'}</div>
                    <div style="font-size: 14px; font-weight: bold; margin-top: 4px;">
                        ${stats.pomodoro.totalCount} 个番茄钟，共 ${stats.pomodoro.totalHours} 小时
                    </div>
                </div>
                ` : ''}
                ${stats.settings.showHabit ? `
                <div class="info-card" style="padding: 12px; background: var(--b3-theme-surface); border-radius: 8px; border: 1px solid var(--b3-border-color);">
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light);">💪 ${t('habitCheckIn') || '习惯打卡'}</div>
                    <div style="font-size: 14px; font-weight: bold; margin-top: 4px;">
                        已完成 ${stats.habit.completed} / ${stats.habit.total} 次打卡
                    </div>
                </div>
                ` : ''}
            </div>

            <div class="task-summary-content" id="summary-content" style="flex: 1; overflow-y: auto;">
    `;

    // 获取所有涉及的日期 (任务日期 + 习惯/番茄统计日期)
    const allDates = new Set<string>();
    groupedTasks.forEach((_, date) => allDates.add(date));
    if (stats.settings.showPomodoro) Object.keys(stats.pomodoro.byDate).forEach(date => allDates.add(date));
    if (stats.settings.showHabit) Object.keys(stats.habit.byDate).forEach(date => allDates.add(date));

    // 按日期排序
    const sortedDates = Array.from(allDates).sort();



    if (sortedDates.length === 0) {
      html += `<div style="text-align: center; padding: 40px; color: var(--b3-theme-on-surface-light);">${t('noTasks') || '暂无任务'}</div>`;
    }

    sortedDates.forEach(date => {
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

      // 1. 显示番茄钟统计
      if (stats.settings.showPomodoro && stats.pomodoro.byDate[date]) {
        const pRecord = stats.pomodoro.byDate[date];
        html += `
          <div class="summary-stat-row" style="margin-bottom: 8px; font-size: 13px; color: var(--b3-theme-on-surface-light); padding-left: 16px;">
            🍅 专注：${pRecord.count} 个番茄钟 (${(pRecord.minutes / 60).toFixed(1)} 小时)
          </div>
        `;
      }

      // 2. 显示习惯打卡情况
      if (stats.settings.showHabit && stats.habit.byDate[date]) {
        const hList = stats.habit.byDate[date];
        html += `<div class="task-project-group">`;
        html += `<h4 class="task-project-title">💪 习惯打卡</h4>`;
        html += `<ul class="task-list">`;
        hList.forEach(habit => {
          // 只需要显示一个✅和⬜，代表打卡完成和打卡未完成
          const progress = habit.completed ? '✅' : '⬜';

          // 习惯打卡名称后改为：名称（频率：xxx，目标次数，今天打卡： emoji），如果今日没打卡，今日打卡改为无
          const emojiStr = habit.emojis.length > 0 ? habit.emojis.join('') : (t('noneVal') || '无');
          const completedClass = habit.completed ? 'completed' : '';

          const freqText = t('frequency') || '频率';
          const targetText = t('targetTimes') || '目标次数';
          const todayCheckInText = t('todayCheckIn') || '今天打卡';

          html += `
            <li class="task-item habit-item ${completedClass}">
              <span class="task-checkbox">${progress}</span>
              <span class="task-title">${habit.title} (${freqText}：${habit.frequencyLabel}，${targetText}：${habit.target}，${todayCheckInText}：${emojiStr})</span>
            </li>
          `;
        });
        html += `</ul></div>`;
      }

      // 3. 按项目分组显示任务
      if (dateProjects) {
        dateProjects.forEach((tasks, projectName) => {
          html += `<div class="task-project-group">`;
          html += `<h4 class="task-project-title">${projectName}</h4>`;
          html += `<ul class="task-list">`;

          tasks.forEach(task => {
            const completedClass = task.completed ? 'completed' : '';
            const priorityClass = `priority-${task.priority}`;
            let timeStr = '';
            if (task.fullEndDate && task.fullEndDate !== task.fullStartDate) {
              timeStr = ` (${this.formatMonthDay(task.fullStartDate)}-${this.formatMonthDay(task.fullEndDate)})`;
            } else {
              timeStr = this.getDisplayTimeForDate(task, date);
            }

            // 获取番茄钟统计
            let pomodoroStr = '';
            if (stats.pomodoro.byDate[date] && stats.pomodoro.byDate[date].taskStats && stats.pomodoro.byDate[date].taskStats[task.id]) {
              const tStat = stats.pomodoro.byDate[date].taskStats[task.id];
              pomodoroStr = ` (🍅 ${tStat.count} | 🕒 ${tStat.minutes}m)`;
            }

            // 预计番茄时长
            let estStr = '';
            if (task.estimatedPomodoroDuration) {
              estStr = ` <span style="color:#888; font-size:12px;">(⏲️ 预计${task.estimatedPomodoroDuration})</span>`;
            }

            // 缩进
            // 基础缩进0，每级深度增加20px
            // task-item 默认 padding 是 6px 0，我们添加 padding-left
            const indentStyle = task.depth > 0 ? `padding-left: ${task.depth * 20}px;` : '';

            html += `
                  <li class="task-item ${completedClass} ${priorityClass}" style="${indentStyle}">
                    <span class="task-checkbox">${task.completed ? '✅' : '⬜'}</span>
                    <span class="task-title">${task.title}${task.repeatLabel ? ` <span style="color:#888; font-size:12px;">(${task.repeatLabel})</span>` : ''}${timeStr}${estStr}${pomodoroStr}</span>
                    ${task.note ? `<div class="task-note">${task.note}</div>` : ''}
                  </li>
                `;
          });

          html += `</ul></div>`;
        });
      }

      html += `</div>`;
    });

    html += `
                </div>
            </div>
            <style>
                .task-date-group {
                    margin-bottom: 24px;
                }
                .task-date-title {
                    color: var(--b3-theme-primary);
                    border-bottom: 2px solid var(--b3-theme-primary);
                    padding-bottom: 8px;
                    margin-bottom: 16px;
                    font-size: 16px;
                    margin-top: 0;
                }
                .task-project-group {
                    margin-bottom: 16px;
                    margin-left: 16px;
                }
                .task-project-title {
                    color: var(--b3-theme-secondary);
                    margin-bottom: 8px;
                    font-size: 14px;
                    margin-top: 0;
                }
                .task-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }
                .task-item {
                    display: flex;
                    align-items: flex-start;
                    padding: 6px 0;
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
                    font-size: 14px;
                }
                .task-note {
                    font-size: 12px;
                    color: var(--b3-theme-on-surface-light);
                    margin-top: 2px;
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
                
                /* 重置复制按钮中 SVG 图标的 margin-right */
                .task-summary-wrapper .b3-button svg.b3-button__icon {
                    margin-right: 0;
                }
            </style>
        `;

    return html;
  }

  /**
   * 绑定摘要事件
   */
  private bindSummaryEvents() {
    const container = this.currentDialog.element.querySelector('#task-summary-dialog-container');
    if (!container) return;

    // 筛选按钮事件
    container.querySelectorAll('.filter-buttons button').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter');
        if (filter) {
          this.currentFilter = filter;
          this.renderSummary();
        }
      });
    });

    // 复制按钮事件
    const copyRichBtn = document.getElementById('copy-rich-text-btn');
    const copyMdBtn = document.getElementById('copy-markdown-btn');
    const copyPlainBtn = document.getElementById('copy-plain-btn');

    if (copyRichBtn) {
      copyRichBtn.addEventListener('click', () => this.executeCopy('rich'));
    }
    if (copyMdBtn) {
      copyMdBtn.addEventListener('click', () => this.executeCopy('markdown'));
    }
    if (copyPlainBtn) {
      copyPlainBtn.addEventListener('click', () => this.executeCopy('plain'));
    }
  }

  /**
   * 复制任务摘要到剪贴板
   */
  public copyTaskSummary(groupedTasks?: Map<string, Map<string, any[]>>, stats?: any) {
    const g = groupedTasks || this.lastGroupedTasks || new Map();
    const s = stats || this.lastStats || {};

    let text = '';

    // 合并日期来源：任务 + 番茄 + 习惯
    const allDates = new Set<string>();
    g.forEach((_, d) => allDates.add(d));
    if (s && s.pomodoro && s.pomodoro.byDate) Object.keys(s.pomodoro.byDate).forEach(d => allDates.add(d));
    if (s && s.habit && s.habit.byDate) Object.keys(s.habit.byDate).forEach(d => allDates.add(d));

    const sortedDates = Array.from(allDates).sort();

    sortedDates.forEach(date => {
      const dateProjects = g.get(date) || new Map();
      const dateObj = new Date(date);
      const formattedDate = dateObj.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      });

      // 非日视图时才添加日期标题
      if (this.calendar && this.calendar.view && this.calendar.view.type !== 'timeGridDay') {
        text += `## ${formattedDate}

`;
      }

      // 番茄钟
      if (s && s.pomodoro && s.pomodoro.byDate && s.pomodoro.byDate[date]) {
        const p = s.pomodoro.byDate[date];
        text += `🍅 专注：${p.count} 个番茄钟 (${(p.minutes / 60).toFixed(1)} 小时)
\n`;
      }

      // 习惯
      if (s && s.habit && s.habit.byDate && s.habit.byDate[date]) {
        const hlist = s.habit.byDate[date];
        text += `💪 ${t('habitCheckIn') || '习惯打卡'}\n\n`;
        hlist.forEach((h: any) => {
          const progress = h.completed ? '- [x]' : '- [ ]';
          const emojiStr = h.emojis && h.emojis.length ? h.emojis.join('') : (t('noneVal') || '无');
          text += `${progress} ${h.title} (${t('frequency') || '频率'}：${h.frequencyLabel}，${t('targetTimes') || '目标次数'}：${h.target}，${t('todayCheckIn') || '今天打卡'}：${emojiStr})\n`;
        });
        text += `\n`;
      }

      dateProjects.forEach((tasks, projectName) => {
        text += `### ${projectName}

`;

        tasks.forEach(task => {
          const checkbox = task.completed ? '- [x]' : '- [ ]';
          let timeStr = '';
          if (task.fullEndDate && task.fullEndDate !== task.fullStartDate) {
            timeStr = ` (${this.formatMonthDay(task.fullStartDate)}-${this.formatMonthDay(task.fullEndDate)})`;
          } else {
            timeStr = this.getDisplayTimeForDate(task, date);
          }
          // 获取番茄钟统计（如果有）
          let pomodoroStr = '';
          if (s && s.pomodoro && s.pomodoro.byDate && s.pomodoro.byDate[date] && s.pomodoro.byDate[date].taskStats && s.pomodoro.byDate[date].taskStats[task.id]) {
            const tStat = s.pomodoro.byDate[date].taskStats[task.id];
            pomodoroStr = ` (🍅 ${tStat.count} | 🕒 ${tStat.minutes}m)`;
          }

          // 预计番茄时长
          let estStr = '';
          if (task.estimatedPomodoroDuration) {
            estStr = ` (⏲️ 预计${task.estimatedPomodoroDuration})`;
          }

          // 缩进
          const indent = '  '.repeat(task.depth || 0);

          text += `${indent}${checkbox} ${task.title}${task.repeatLabel ? ` (${task.repeatLabel})` : ''}${timeStr}${estStr}${pomodoroStr}
`;
          if (task.note) {
            text += `${indent}  > ${task.note}
`;
          }
        });

        text += `\n`;
      });

      text += `\n`;
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
  public copyTaskSummaryPlainText(groupedTasks?: Map<string, Map<string, any[]>>, stats?: any) {
    const g = groupedTasks || this.lastGroupedTasks || new Map();
    const s = stats || this.lastStats || {};

    let text = '';

    // 合并日期来源
    const allDates = new Set<string>();
    g.forEach((_, d) => allDates.add(d));
    if (s && s.pomodoro && s.pomodoro.byDate) Object.keys(s.pomodoro.byDate).forEach(d => allDates.add(d));
    if (s && s.habit && s.habit.byDate) Object.keys(s.habit.byDate).forEach(d => allDates.add(d));

    const sortedDates = Array.from(allDates).sort();

    sortedDates.forEach(date => {
      const dateProjects = g.get(date) || new Map();
      const dateObj = new Date(date);
      const formattedDate = dateObj.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      });

      // 非日视图时才添加日期标题
      if (this.calendar && this.calendar.view && this.calendar.view.type !== 'timeGridDay') {
        text += `${formattedDate}
${'-'.repeat(formattedDate.length)}

`;
      }

      // 番茄
      if (s && s.pomodoro && s.pomodoro.byDate && s.pomodoro.byDate[date]) {
        const p = s.pomodoro.byDate[date];
        text += `🍅 专注：${p.count} 个番茄钟 (${(p.minutes / 60).toFixed(1)} 小时)\n\n`;
      }

      // 习惯
      if (s && s.habit && s.habit.byDate && s.habit.byDate[date]) {
        const hlist = s.habit.byDate[date];
        text += `💪 ${t('habitCheckIn') || '习惯打卡'}\n`;
        hlist.forEach((h: any) => {
          const progress = h.completed ? '✅' : '⬜';
          const emojiStr = h.emojis && h.emojis.length ? h.emojis.join('') : (t('noneVal') || '无');
          text += `${progress} ${h.title} (${t('frequency') || '频率'}：${h.frequencyLabel}，${t('targetTimes') || '目标次数'}：${h.target}，${t('todayCheckIn') || '今天打卡'}：${emojiStr})\n`;
        });
        text += `\n`;
      }

      dateProjects.forEach((tasks, projectName) => {
        text += `【${projectName}】\n`;


        tasks.forEach(task => {
          let timeStr = '';
          if (task.fullEndDate && task.fullEndDate !== task.fullStartDate) {
            timeStr = ` (${this.formatMonthDay(task.fullStartDate)}-${this.formatMonthDay(task.fullEndDate)})`;
          } else {
            timeStr = this.getDisplayTimeForDate(task, date);
          }

          // 番茄钟统计
          let pomodoroStr = '';
          if (s && s.pomodoro && s.pomodoro.byDate && s.pomodoro.byDate[date] && s.pomodoro.byDate[date].taskStats && s.pomodoro.byDate[date].taskStats[task.id]) {
            const tStat = s.pomodoro.byDate[date].taskStats[task.id];
            pomodoroStr = ` (🍅 ${tStat.count} | 🕒 ${tStat.minutes}m)`;
          }

          // 预计番茄时长
          let estStr = '';
          if (task.estimatedPomodoroDuration) {
            estStr = ` (⏲️ 预计${task.estimatedPomodoroDuration})`;
          }

          // 缩进
          const indent = '  '.repeat(task.depth || 0);

          const checkbox = task.completed ? '✅' : '⬜';
          text += `${indent}${checkbox} ${task.title}${task.repeatLabel ? ` (${task.repeatLabel})` : ''}${timeStr}${estStr}${pomodoroStr}\n`;
        });

        text += `\n`;
      });

      text += `\n`;
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
    const g = groupedTasks || this.lastGroupedTasks || new Map();
    const s = this.lastStats || {};

    let html = '';

    // 合并日期来源
    const allDates = new Set<string>();
    g.forEach((_, d) => allDates.add(d));
    if (s && s.pomodoro && s.pomodoro.byDate) Object.keys(s.pomodoro.byDate).forEach(d => allDates.add(d));
    if (s && s.habit && s.habit.byDate) Object.keys(s.habit.byDate).forEach(d => allDates.add(d));

    const sortedDates = Array.from(allDates).sort();

    html += '<div style="font-family: Arial, sans-serif; line-height: 1.6;">';

    sortedDates.forEach(date => {
      const dateProjects = g.get(date) || new Map();
      const dateObj = new Date(date);
      const formattedDate = dateObj.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      });

      // 非日视图时才添加日期标题
      if (this.calendar && this.calendar.view && this.calendar.view.type !== 'timeGridDay') {
        html += `<h2 style="color: #1976D2; margin: 20px 0 12px 0; font-size: 18px; border-bottom: 2px solid #1976D2; padding-bottom: 4px;">${formattedDate}</h2>`;
      }

      // 番茄
      if (s && s.pomodoro && s.pomodoro.byDate && s.pomodoro.byDate[date]) {
        const p = s.pomodoro.byDate[date];
        html += `<div style="margin-left:16px; color:#555;">🍅 专注：${p.count} 个番茄钟 (${(p.minutes / 60).toFixed(1)} 小时)</div>`;
      }

      // 习惯
      if (s && s.habit && s.habit.byDate && s.habit.byDate[date]) {
        const hlist = s.habit.byDate[date];
        html += `<div style="margin-left:16px; color:#555;">💪 习惯打卡：</div><ul>`;
        hlist.forEach((h: any) => {
          const progress = h.completed ? '✅' : '⬜';
          const emojiStr = h.emojis && h.emojis.length ? h.emojis.join('') : (t('noneVal') || '无');
          html += `<li style="margin:4px 0;">${progress} ${h.title} (${t('frequency') || '频率'}：${h.frequencyLabel}，${t('targetTimes') || '目标次数'}：${h.target}，${t('todayCheckIn') || '今天打卡'}：${emojiStr})</li>`;
        });
        html += `</ul>`;
      }

      dateProjects.forEach((tasks, projectName) => {
        html += `<h3 style="color: #2196F3; margin: 16px 0 8px 0; font-size: 16px;">【${projectName}】</h3>`;

        // 使用递归函数生成嵌套列表
        const renderTaskList = (taskList: any[], currentDepth: number = 0) => {
          if (taskList.length === 0) return '';

          let listHtml = '<ul style="margin: 4px 0; padding-left: 20px; list-style-type: none;">';

          for (let i = 0; i < taskList.length; i++) {
            const task = taskList[i];

            // 跳过已经作为子任务处理的任务
            if (task._processed) continue;

            // 只处理当前深度的任务
            if ((task.depth || 0) !== currentDepth) continue;

            let timeHtml = '';
            if (task.fullEndDate && task.fullEndDate !== task.fullStartDate) {
              timeHtml = ` <span style="color: #666; font-size: 12px;">(${this.formatMonthDay(task.fullStartDate)}-${this.formatMonthDay(task.fullEndDate)})</span>`;
            } else {
              const dt = this.getDisplayTimeForDate(task, date);
              if (dt) timeHtml = ` <span style="color: #666; font-size: 12px;">${dt.trim()}</span>`;
            }

            // 番茄钟统计
            let pomodoroHtml = '';
            if (s && s.pomodoro && s.pomodoro.byDate && s.pomodoro.byDate[date] && s.pomodoro.byDate[date].taskStats && s.pomodoro.byDate[date].taskStats[task.id]) {
              const tStat = s.pomodoro.byDate[date].taskStats[task.id];
              pomodoroHtml = ` <span style="color:#888; font-size:12px;">(🍅 ${tStat.count} | 🕒 ${tStat.minutes}m)</span>`;
            }

            // 预计番茄时长
            let estHtml = '';
            if (task.estimatedPomodoroDuration) {
              estHtml = ` <span style="color:#888; font-size:12px;">(⏲️ 预计${task.estimatedPomodoroDuration})</span>`;
            }

            const checkbox = task.completed ? '✅' : '⬜';
            listHtml += `<li style="margin: 4px 0; color: #333;">${checkbox} ${task.title}${task.repeatLabel ? ` <span style="color:#888; font-size:12px;">(${task.repeatLabel})</span>` : ''}${timeHtml}${estHtml}${pomodoroHtml}`;

            // 标记为已处理
            task._processed = true;

            // 查找并渲染子任务
            const children = taskList.filter(t => !t._processed && (t.depth || 0) === currentDepth + 1);
            if (children.length > 0) {
              listHtml += renderTaskList(taskList, currentDepth + 1);
            }

            listHtml += '</li>';
          }

          listHtml += '</ul>';
          return listHtml;
        };

        html += renderTaskList(tasks, 0);
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
  public executeCopy(copyType: string, groupedTasks?: Map<string, Map<string, any[]>>) {
    const g = groupedTasks || this.lastGroupedTasks || undefined;
    const s = this.lastStats || undefined;

    switch (copyType) {
      case 'rich':
        this.copyTaskSummaryRichText(g || new Map());
        break;
      case 'markdown':
        this.copyTaskSummary(g, s);
        break;
      case 'plain':
        this.copyTaskSummaryPlainText(g, s);
        break;
      default:
        this.copyTaskSummaryRichText(g || new Map());
    }
  }

  /**
   * 复制当前视图的富文本任务摘要
   */
  public async copyCurrentViewRichText() {
    try {
      const events = await this.getEvents();
      const dateRange = this.getCurrentViewDateRange();
      const filteredEvents = this.filterEventsByDateRange(events, dateRange);
      const groupedTasks = this.groupTasksByDateAndProject(filteredEvents, dateRange);

      this.executeCopy('rich', groupedTasks);
    } catch (error) {
      console.error('复制富文本失败:', error);
      showMessage(t("copyFailed") || "复制失败");
    }
  }

}