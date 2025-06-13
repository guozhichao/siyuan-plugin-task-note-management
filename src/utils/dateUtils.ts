/**
 * 获取本地日期字符串（YYYY-MM-DD格式）
 * 解决时区问题，确保在东八区正确显示日期
 */
export function getLocalDateString(date?: Date): string {
    const d = date || new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 获取本地时间字符串（HH:MM格式）
 */
export function getLocalTimeString(date?: Date): string {
    const d = date || new Date();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

export function getLocalDateTimeString(date?: Date): string {
    const d = date || new Date();

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * 从Date对象获取本地日期时间
 */
export function getLocalDateTime(date: Date): { dateStr: string; timeStr: string } {
    return {
        dateStr: getLocalDateString(date),
        timeStr: getLocalTimeString(date)
    };
}

/**
 * 比较两个日期字符串（YYYY-MM-DD格式）
 * 返回值：-1表示date1早于date2，0表示相等，1表示date1晚于date2
 */
export function compareDateStrings(date1: string, date2: string): number {
    if (date1 < date2) return -1;
    if (date1 > date2) return 1;
    return 0;
}
