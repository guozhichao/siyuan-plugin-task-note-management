import { RepeatConfig } from '../components/RepeatSettingsDialog';
import { compareDateStrings } from './dateUtils';
import { i18n } from './i18n';
import { solarToLunar } from './lunarUtils';

export interface RepeatInstance {
    date: string;
    time?: string;
    endDate?: string;
    endTime?: string;
    customReminderTime?: string;
    reminderTimes?: Array<{ time: string, note?: string }>; // 提醒时间列表
    customReminderPreset?: string; // 提醒预设
    instanceId: string; // 实例标识符
    originalId: string; // 原始提醒ID
    isRepeatedInstance: boolean;
    completed?: boolean; // 添加实例级别的完成状态
}

/**
 * 将 Date 对象转换为 YYYY-MM-DD 格式的本地日期字符串
 */
function getLocalDateString(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 生成重复事件实例
 */
export function generateRepeatInstances(
    reminder: any,
    startDate: string,
    endDate: string,
    maxInstances: number = 100
): RepeatInstance[] {
    if (!reminder.repeat?.enabled || !reminder.repeat.type) {
        return [];
    }

    const instances: RepeatInstance[] = [];
    const repeatConfig = reminder.repeat;

    // 对于农历重复任务，如果没有设置 reminder.date，使用 startDate 作为起始日期
    // 对于其他类型的重复任务，必须有 reminder.date
    let currentDate: Date;
    if (reminder.date) {
        currentDate = new Date(reminder.date + 'T00:00:00');
    } else if (repeatConfig.type === 'lunar-monthly' || repeatConfig.type === 'lunar-yearly') {
        // 农历重复任务没有 startDate 时，从查询范围的开始日期开始生成
        currentDate = new Date(startDate + 'T00:00:00');
    } else {
        // 非农历重复任务必须有 startDate
        return [];
    }

    const endDateObj = new Date(endDate + 'T23:59:59');
    let instanceCount = 0;

    // 获取排除日期列表
    const excludeDates = repeatConfig.excludeDates || [];
    // 获取实例修改列表
    const instanceModifications = repeatConfig.instanceModifications || {};
    // 获取已完成实例列表
    const completedInstances = repeatConfig.completedInstances || [];

    // 检查重复结束条件
    const hasEndDate = repeatConfig.endType === 'date' && repeatConfig.endDate;
    const hasEndCount = repeatConfig.endType === 'count' && repeatConfig.endCount;
    const repeatEndDate = hasEndDate ? new Date(repeatConfig.endDate + 'T23:59:59') : null;

    while (currentDate <= endDateObj && instanceCount < maxInstances) {
        const currentDateStr = getLocalDateString(currentDate); // 使用本地日期字符串

        // 检查是否在生成范围内
        if (compareDateStrings(currentDateStr, startDate) >= 0) {
            // 检查重复结束条件
            if (hasEndDate && repeatEndDate && currentDate > repeatEndDate) {
                break;
            }
            if (hasEndCount && instanceCount >= repeatConfig.endCount) {
                break;
            }

            // 检查是否符合重复规则且不在排除列表中
            // 对于农历重复，originalDate 可以为空
            if (shouldGenerateInstance(currentDate, reminder.date || startDate, repeatConfig) &&
                !excludeDates.includes(currentDateStr)) {

                // 检查是否有针对此实例的修改
                const modification = instanceModifications[currentDateStr];

                // 检查此实例是否已完成
                const isInstanceCompleted = completedInstances.includes(currentDateStr);

                const instance: RepeatInstance = {
                    date: modification?.date || currentDateStr,
                    time: modification?.time || reminder.time,
                    endDate: modification?.endDate || (reminder.endDate && reminder.date ? addDaysToDate(modification?.date || currentDateStr, getDaysDifference(reminder.date, reminder.endDate)) : undefined),
                    endTime: modification?.endTime || reminder.endTime,
                    customReminderTime: modification?.customReminderTime || reminder.customReminderTime,
                    reminderTimes: modification?.reminderTimes !== undefined ? modification.reminderTimes : reminder.reminderTimes,
                    customReminderPreset: modification?.customReminderPreset !== undefined ? modification.customReminderPreset : reminder.customReminderPreset,
                    instanceId: `${reminder.id}_${currentDateStr}`,
                    originalId: reminder.id,
                    isRepeatedInstance: true,
                    completed: isInstanceCompleted // 设置实例级别的完成状态
                };

                instances.push(instance);
                instanceCount++;
            }
        }

        // 移动到下一个可能的日期
        currentDate = getNextDate(currentDate, repeatConfig);
    }

    return instances;
}

/**
 * 判断是否应该在指定日期生成实例
 */
function shouldGenerateInstance(currentDate: Date, originalDate: string, repeatConfig: RepeatConfig): boolean {
    const originalDateObj = new Date(originalDate + 'T00:00:00');

    switch (repeatConfig.type) {
        case 'daily':
            const daysDiff = Math.floor((currentDate.getTime() - originalDateObj.getTime()) / (24 * 60 * 60 * 1000));
            return daysDiff >= 0 && daysDiff % (repeatConfig.interval || 1) === 0;

        case 'weekly':
            // 如果设置了weekDays，检查当前日期的星期是否在指定的星期列表中
            if (repeatConfig.weekDays && repeatConfig.weekDays.length > 0) {
                return repeatConfig.weekDays.includes(currentDate.getDay()) && currentDate >= originalDateObj;
            }
            // 否则按原有逻辑：检查与原始日期的星期是否相同
            const weeksDiff = Math.floor((currentDate.getTime() - originalDateObj.getTime()) / (7 * 24 * 60 * 60 * 1000));
            const sameWeekday = currentDate.getDay() === originalDateObj.getDay();
            return weeksDiff >= 0 && weeksDiff % (repeatConfig.interval || 1) === 0 && sameWeekday;

        case 'monthly':
            // 如果设置了monthDays，检查当前日期是否在指定的日期列表中
            if (repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
                return repeatConfig.monthDays.includes(currentDate.getDate()) && currentDate >= originalDateObj;
            }
            // 否则按原有逻辑：检查与原始日期的日是否相同
            const monthsDiff = (currentDate.getFullYear() - originalDateObj.getFullYear()) * 12 +
                (currentDate.getMonth() - originalDateObj.getMonth());
            const sameDay = currentDate.getDate() === originalDateObj.getDate();
            return monthsDiff >= 0 && monthsDiff % (repeatConfig.interval || 1) === 0 && sameDay;

        case 'yearly':
            // 如果设置了months和monthDays，检查当前日期是否匹配
            if (repeatConfig.months && repeatConfig.months.length > 0 &&
                repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
                const matchMonth = repeatConfig.months.includes(currentDate.getMonth() + 1);
                const matchDay = repeatConfig.monthDays.includes(currentDate.getDate());
                return matchMonth && matchDay && currentDate >= originalDateObj;
            }
            // 否则按原有逻辑：检查与原始日期的月和日是否相同
            const yearsDiff = currentDate.getFullYear() - originalDateObj.getFullYear();
            const sameMonthDay = currentDate.getMonth() === originalDateObj.getMonth() &&
                currentDate.getDate() === originalDateObj.getDate();
            return yearsDiff >= 0 && yearsDiff % (repeatConfig.interval || 1) === 0 && sameMonthDay;

        case 'custom':
            return checkCustomRepeat(currentDate, originalDateObj, repeatConfig);

        case 'ebbinghaus':
            return checkEbbinghausRepeat(currentDate, originalDateObj, repeatConfig);

        case 'lunar-monthly':
            return checkLunarMonthlyRepeat(currentDate, originalDateObj, repeatConfig);

        case 'lunar-yearly':
            return checkLunarYearlyRepeat(currentDate, originalDateObj, repeatConfig);

        default:
            return false;
    }
}

/**
 * 检查自定义重复规则
 */
function checkCustomRepeat(currentDate: Date, originalDate: Date, repeatConfig: RepeatConfig): boolean {
    // 检查星期几
    if (repeatConfig.weekDays && repeatConfig.weekDays.length > 0) {
        if (!repeatConfig.weekDays.includes(currentDate.getDay())) {
            return false;
        }
    }

    // 检查每月的日期
    if (repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
        if (!repeatConfig.monthDays.includes(currentDate.getDate())) {
            return false;
        }
    }

    // 检查月份
    if (repeatConfig.months && repeatConfig.months.length > 0) {
        if (!repeatConfig.months.includes(currentDate.getMonth() + 1)) {
            return false;
        }
    }

    return currentDate >= originalDate;
}

/**
 * 检查艾宾浩斯重复规则
 */
function checkEbbinghausRepeat(currentDate: Date, originalDate: Date, repeatConfig: RepeatConfig): boolean {
    const daysDiff = Math.floor((currentDate.getTime() - originalDate.getTime()) / (24 * 60 * 60 * 1000));
    const pattern = repeatConfig.ebbinghausPattern || [1, 2, 4, 7, 15];

    return pattern.includes(daysDiff);
}

/**
 * 检查农历每月重复规则
 */
function checkLunarMonthlyRepeat(currentDate: Date, _originalDate: Date, repeatConfig: RepeatConfig): boolean {
    if (!repeatConfig.lunarDay) {
        return false;
    }

    try {
        const currentDateStr = getLocalDateString(currentDate);
        const lunar = solarToLunar(currentDateStr);
        return lunar.day === repeatConfig.lunarDay;
    } catch (error) {
        console.error('Error checking lunar monthly repeat:', error);
        return false;
    }
}

/**
 * 检查农历每年重复规则
 */
function checkLunarYearlyRepeat(currentDate: Date, _originalDate: Date, repeatConfig: RepeatConfig): boolean {
    if (!repeatConfig.lunarMonth || !repeatConfig.lunarDay) {
        return false;
    }

    try {
        const currentDateStr = getLocalDateString(currentDate);
        const lunar = solarToLunar(currentDateStr);
        return lunar.month === repeatConfig.lunarMonth && lunar.day === repeatConfig.lunarDay;
    } catch (error) {
        console.error('Error checking lunar yearly repeat:', error);
        return false;
    }
}

/**
 * 获取下一个检查日期
 */
function getNextDate(currentDate: Date, repeatConfig: RepeatConfig): Date {
    const nextDate = new Date(currentDate);

    switch (repeatConfig.type) {
        case 'daily':
        case 'custom':
        case 'ebbinghaus':
        case 'weekly':
        case 'monthly':
        case 'yearly':
        case 'lunar-monthly':
        case 'lunar-yearly':
            // For all types, we check daily to find the next valid date
            nextDate.setDate(nextDate.getDate() + 1);
            break;
        default:
            nextDate.setDate(nextDate.getDate() + 1);
            break;
    }

    return nextDate;
}

/**
 * 计算两个日期之间的天数差
 */
export function getDaysDifference(startDate: string, endDate: string): number {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * 给日期添加指定天数
 */
export function addDaysToDate(dateStr: string, days: number): string {
    const date = new Date(dateStr + 'T00:00:00');
    date.setDate(date.getDate() + days);
    return getLocalDateString(date); // 使用本地日期字符串
}

/**
 * 获取重复描述文本
 */
export function getRepeatDescription(repeatConfig: RepeatConfig): string {
    if (!repeatConfig.enabled) {
        return '';
    }

    let description = '';
    const interval = repeatConfig.interval || 1;

    switch (repeatConfig.type) {
        case 'daily':
            description = interval === 1 ? i18n("everyDay") : i18n("everyNDays", { n: interval.toString() });
            break;
        case 'weekly':
            if (repeatConfig.weekDays && repeatConfig.weekDays.length > 0) {
                const dayNames = [i18n("sun"), i18n("mon"), i18n("tue"), i18n("wed"), i18n("thu"), i18n("fri"), i18n("sat")];
                const days = repeatConfig.weekDays.map(d => dayNames[d]).join(',');
                description = `每周${days}`;
            } else {
                description = interval === 1 ? i18n("everyWeek") : i18n("everyNWeeks", { n: interval.toString() });
            }
            break;
        case 'monthly':
            if (repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
                description = `每月${repeatConfig.monthDays.join(',')}日`;
            } else {
                description = interval === 1 ? i18n("everyMonth") : i18n("everyNMonths", { n: interval.toString() });
            }
            break;
        case 'yearly':
            if (repeatConfig.months && repeatConfig.months.length > 0 &&
                repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
                description = `每年${repeatConfig.months[0]}月${repeatConfig.monthDays[0]}日`;
            } else {
                description = interval === 1 ? i18n("everyYear") : i18n("everyNYears", { n: interval.toString() });
            }
            break;
        case 'lunar-monthly':
            description = i18n("lunarMonthlyRepeat");
            break;
        case 'lunar-yearly':
            description = i18n("lunarYearlyRepeat");
            break;
        case 'custom':
            description = i18n("customRepeat");
            break;
        case 'ebbinghaus':
            description = i18n("ebbinghausRepeat");
            break;
    }

    // 添加结束条件
    if (repeatConfig.endType === 'date' && repeatConfig.endDate) {
        description += i18n("untilDate", { date: repeatConfig.endDate });
    } else if (repeatConfig.endType === 'count' && repeatConfig.endCount) {
        description += i18n("forNTimes", { n: repeatConfig.endCount.toString() });
    }

    return description;
}

/**
 * 检查重复事件是否已结束
 */
export function isRepeatEnded(reminder: any, currentDate: string): boolean {
    const repeatConfig = reminder.repeat;
    if (!repeatConfig?.enabled) {
        return false;
    }

    if (repeatConfig.endType === 'date' && repeatConfig.endDate) {
        return compareDateStrings(currentDate, repeatConfig.endDate) > 0;
    }

    // 对于次数限制，需要在使用时检查
    return false;
}
