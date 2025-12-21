<script lang="ts">
    import { onMount } from 'svelte';
    import SettingPanel from '@/libs/components/setting-panel.svelte';
    import { t } from './utils/i18n';
    import * as ics from 'ics';
    import { lunarToSolar, solarToLunar } from './utils/lunarUtils';
    import {
        DEFAULT_SETTINGS,
        SETTINGS_FILE,
        PROJECT_DATA_FILE,
        CATEGORIES_DATA_FILE,
        REMINDER_DATA_FILE,
        HABIT_DATA_FILE,
        NOTIFY_DATA_FILE,
        POMODORO_RECORD_DATA_FILE,
        HABIT_GROUP_DATA_FILE,
        STATUSES_DATA_FILE,
    } from './index';
    import { lsNotebooks, pushErrMsg, pushMsg, removeFile, putFile } from './api';
    import { Constants } from 'siyuan';

    export let plugin;

    // 使用从 index.ts 导入的默认设置
    let settings = { ...DEFAULT_SETTINGS };

    // 笔记本列表
    let notebooks: Array<{ id: string; name: string }> = [];

    interface ISettingGroup {
        name: string;
        items: ISettingItem[];
    }

    export const useShell = async (cmd: 'showItemInFolder' | 'openPath', filePath: string) => {
        try {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd,
                filePath: filePath,
            });
        } catch (error) {
            await pushErrMsg('当前客户端不支持打开插件数据文件夹');
        }
    };

    // 导出 ICS 的通用函数
    async function exportIcsFile(normalizeForXiaomi: boolean, openFolder: boolean = true) {
        try {
            const dataDir =
                window.siyuan.config.system.dataDir +
                '/storage/petal/siyuan-plugin-task-note-management';
            const reminders = (await plugin.loadData(REMINDER_DATA_FILE)) || {};
            const fs = window.require && window.require('fs');
            const pathMod = window.require && window.require('path');

            if (!fs) {
                await pushErrMsg('当前环境不支持文件写入');
                return;
            }

            // 辅助函数：解析日期为 [year, month, day]
            function parseDateArray(dateStr: string): [number, number, number] | null {
                if (!dateStr || typeof dateStr !== 'string') return null;
                const parts = dateStr.split('-').map(n => parseInt(n, 10));
                if (parts.length !== 3 || parts.some(isNaN)) return null;
                return [parts[0], parts[1], parts[2]];
            }

            // 辅助函数：解析时间为 [hour, minute]
            function parseTimeArray(timeStr: string): [number, number] | null {
                if (!timeStr || typeof timeStr !== 'string') return null;
                const parts = timeStr.split(':').map(n => parseInt(n, 10));
                if (parts.length < 2 || parts.some(isNaN)) return null;
                return [parts[0], parts[1]];
            }

            const events: any[] = [];

            function buildRRuleFromRepeat(repeat: any, startDateStr: string) {
                if (!repeat || !repeat.enabled) return null;
                const parts: string[] = [];
                const type = repeat.type || 'daily';
                switch (type) {
                    case 'daily':
                        parts.push('FREQ=DAILY');
                        break;
                    case 'weekly':
                        parts.push('FREQ=WEEKLY');
                        if (Array.isArray(repeat.weekDays) && repeat.weekDays.length) {
                            const map = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
                            const byday = repeat.weekDays
                                .map((d: number) => map[d])
                                .filter(Boolean)
                                .join(',');
                            if (byday) parts.push(`BYDAY=${byday}`);
                        }
                        break;
                    case 'monthly':
                        parts.push('FREQ=MONTHLY');
                        if (Array.isArray(repeat.monthDays) && repeat.monthDays.length) {
                            parts.push(`BYMONTHDAY=${repeat.monthDays.join(',')}`);
                        }
                        break;
                    case 'yearly':
                        parts.push('FREQ=YEARLY');
                        break;
                    case 'custom':
                        parts.push('FREQ=DAILY');
                        if (Array.isArray(repeat.weekDays) && repeat.weekDays.length) {
                            const map = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
                            const byday = repeat.weekDays
                                .map((d: number) => map[d])
                                .filter(Boolean)
                                .join(',');
                            if (byday) parts.push(`BYDAY=${byday}`);
                        }
                        if (Array.isArray(repeat.monthDays) && repeat.monthDays.length) {
                            parts.push(`BYMONTHDAY=${repeat.monthDays.join(',')}`);
                        }
                        if (Array.isArray(repeat.months) && repeat.months.length) {
                            parts.push(`BYMONTH=${repeat.months.join(',')}`);
                        }
                        break;
                    default:
                        parts.push('FREQ=DAILY');
                }

                if (repeat.interval && repeat.interval > 1) {
                    parts.push(`INTERVAL=${repeat.interval}`);
                }

                if (repeat.endType === 'count' && repeat.endCount) {
                    parts.push(`COUNT=${repeat.endCount}`);
                } else if (repeat.endType === 'date' && repeat.endDate) {
                    try {
                        const dt = new Date(repeat.endDate + 'T23:59:59');
                        const until = `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}T${String(dt.getUTCHours()).padStart(2, '0')}${String(dt.getUTCMinutes()).padStart(2, '0')}${String(dt.getUTCSeconds()).padStart(2, '0')}Z`;
                        parts.push(`UNTIL=${until}`);
                    } catch (e) {
                        console.warn('构建 UNTIL 失败', e);
                    }
                }

                return parts.join(';');
            }

            const reminderMap: { [id: string]: any } = reminders;
            const rootIds = Object.keys(reminderMap).filter(i => !reminderMap[i].parentId);

            for (const id of rootIds) {
                const r = reminderMap[id];
                if (!r.date) continue;

                const title = r.title || '无标题';
                let description = r.note || '';

                try {
                    const children = Object.keys(reminderMap)
                        .map(k => reminderMap[k])
                        .filter((item: any) => item.parentId === id);
                    for (const child of children) {
                        try {
                            const childTitle = child.title || '无标题子任务';
                            const childNote = child.note || '';
                            const childHasTime = !!(child.time || child.date);

                            if (childHasTime) {
                                const childStartDateArray = parseDateArray(child.date || r.date);
                                if (!childStartDateArray) continue;
                                const childStartTimeArray = child.time
                                    ? parseTimeArray(child.time)
                                    : null;
                                const childEndDateArray = child.endDate
                                    ? parseDateArray(child.endDate)
                                    : childStartDateArray;
                                const childEndTimeArray = child.endTime
                                    ? parseTimeArray(child.endTime)
                                    : null;

                                const childEvent: any = {
                                    uid: `${child.id || ''}-${child.date || ''}${child.time ? '-' + child.time.replace(/:/g, '') : ''}@siyuan`,
                                    title: childTitle,
                                    description: childNote,
                                    status: child.completed ? 'CONFIRMED' : 'TENTATIVE',
                                };

                                if (childStartTimeArray) {
                                    childEvent.start = [
                                        ...childStartDateArray,
                                        ...childStartTimeArray,
                                    ];
                                    if (childEndTimeArray && childEndDateArray) {
                                        childEvent.end = [
                                            ...childEndDateArray,
                                            ...childEndTimeArray,
                                        ];
                                    } else {
                                        childEvent.duration = { hours: 1 };
                                    }
                                } else {
                                    childEvent.start = childStartDateArray;
                                    const nextDay = new Date(
                                        childStartDateArray[0],
                                        childStartDateArray[1] - 1,
                                        childStartDateArray[2]
                                    );
                                    nextDay.setDate(nextDay.getDate() + 1);
                                    childEvent.end = [
                                        nextDay.getFullYear(),
                                        nextDay.getMonth() + 1,
                                        nextDay.getDate(),
                                    ];
                                }

                                if (child.createdAt) {
                                    const created = new Date(child.createdAt);
                                    childEvent.created = [
                                        created.getUTCFullYear(),
                                        created.getUTCMonth() + 1,
                                        created.getUTCDate(),
                                        created.getUTCHours(),
                                        created.getUTCMinutes(),
                                        created.getUTCSeconds(),
                                    ];
                                }

                                if (!child.completed && childStartTimeArray) {
                                    childEvent.alarms = [
                                        {
                                            action: 'display',
                                            description: childTitle,
                                            trigger: { before: true, minutes: 15 },
                                        },
                                    ];
                                }

                                if (child.repeat && child.repeat.enabled) {
                                    try {
                                        const childRrule = buildRRuleFromRepeat(
                                            child.repeat,
                                            child.date || r.date
                                        );
                                        if (childRrule) {
                                            childEvent.recurrenceRule = childRrule;
                                            if (childStartTimeArray) {
                                                if (!childEndTimeArray) {
                                                    delete childEvent.end;
                                                    childEvent.duration = { hours: 1 };
                                                } else {
                                                    const sh = childStartTimeArray[0];
                                                    const sm = childStartTimeArray[1];
                                                    const eh = childEndTimeArray[0];
                                                    const em = childEndTimeArray[1];
                                                    let dh = eh - sh;
                                                    let dm = em - sm;
                                                    if (dm < 0) {
                                                        dh -= 1;
                                                        dm += 60;
                                                    }
                                                    if (dh <= 0 && dm <= 0) {
                                                        childEvent.duration = { hours: 1 };
                                                        delete childEvent.end;
                                                    } else {
                                                        const dur: any = {};
                                                        if (dh > 0) dur.hours = dh;
                                                        if (dm > 0) dur.minutes = dm;
                                                        childEvent.duration = dur;
                                                        delete childEvent.end;
                                                    }
                                                }
                                            } else {
                                                childEvent.duration = { days: 1 };
                                                delete childEvent.end;
                                            }
                                        }
                                    } catch (e) {
                                        console.warn('构建子任务 RRULE 失败', e, child);
                                    }
                                }

                                events.push(childEvent);
                            } else {
                                const prefix = '\n- ';
                                description += `${prefix}${childTitle}${childNote ? '：' + childNote : ''}`;
                            }
                        } catch (ce) {
                            console.error('处理子任务失败:', ce, child);
                        }
                    }
                } catch (e) {
                    console.warn('处理子任务出错', e);
                }

                const startDateArray = parseDateArray(r.date);
                if (!startDateArray) continue;
                const startTimeArray = r.time ? parseTimeArray(r.time) : null;
                const endDateArray = r.endDate ? parseDateArray(r.endDate) : startDateArray;
                const endTimeArray = r.endTime ? parseTimeArray(r.endTime) : null;

                const event: any = {
                    uid: `${id}-${r.date}${r.time ? '-' + r.time.replace(/:/g, '') : ''}@siyuan`,
                    title: title,
                    description: description,
                    status: r.completed ? 'CONFIRMED' : 'TENTATIVE',
                };

                if (startTimeArray) {
                    event.start = [...startDateArray, ...startTimeArray];
                    if (endTimeArray && endDateArray) {
                        event.end = [...endDateArray, ...endTimeArray];
                    } else {
                        event.duration = { hours: 1 };
                    }
                } else {
                    event.start = startDateArray;
                    if (
                        endDateArray &&
                        (endDateArray[0] !== startDateArray[0] ||
                            endDateArray[1] !== startDateArray[1] ||
                            endDateArray[2] !== startDateArray[2])
                    ) {
                        const endDate = new Date(
                            endDateArray[0],
                            endDateArray[1] - 1,
                            endDateArray[2]
                        );
                        endDate.setDate(endDate.getDate() + 1);
                        event.end = [
                            endDate.getFullYear(),
                            endDate.getMonth() + 1,
                            endDate.getDate(),
                        ];
                    } else {
                        const nextDay = new Date(
                            startDateArray[0],
                            startDateArray[1] - 1,
                            startDateArray[2]
                        );
                        nextDay.setDate(nextDay.getDate() + 1);
                        event.end = [
                            nextDay.getFullYear(),
                            nextDay.getMonth() + 1,
                            nextDay.getDate(),
                        ];
                    }
                }

                if (r.createdAt) {
                    const created = new Date(r.createdAt);
                    event.created = [
                        created.getUTCFullYear(),
                        created.getUTCMonth() + 1,
                        created.getUTCDate(),
                        created.getUTCHours(),
                        created.getUTCMinutes(),
                        created.getUTCSeconds(),
                    ];
                }

                if (!r.completed && startTimeArray) {
                    event.alarms = [
                        {
                            action: 'display',
                            description: title,
                            trigger: { before: true, minutes: 15 },
                        },
                    ];
                }

                if (r.repeat && r.repeat.enabled) {
                    // 特殊处理：农历年事件，生成今年和明年两个普通事件
                    if (r.repeat.type === 'lunar-yearly') {
                        try {
                            const lunarMonth = r.repeat.lunarMonth;
                            const lunarDay = r.repeat.lunarDay;
                            const isLeap = !!r.repeat.isLeapMonth;
                            const nowYear = new Date().getFullYear();
                            for (let offset = 0; offset < 2; offset++) {
                                const y = nowYear + offset;
                                const solar = lunarToSolar(y, lunarMonth, lunarDay, isLeap);
                                if (!solar) continue;
                                const occDateArr = parseDateArray(solar);
                                if (!occDateArr) continue;

                                const occEvent: any = {
                                    uid: `${id}-${solar}@siyuan`,
                                    title: title,
                                    description: description,
                                    status: r.completed ? 'CONFIRMED' : 'TENTATIVE',
                                };

                                if (startTimeArray) {
                                    occEvent.start = [...occDateArr, ...startTimeArray];
                                    if (endTimeArray) {
                                        occEvent.end = [
                                            ...parseDateArray(r.endDate || solar)!,
                                            ...endTimeArray,
                                        ];
                                    } else {
                                        occEvent.duration = { hours: 1 };
                                    }
                                } else {
                                    occEvent.start = occDateArr;
                                    const nextDay = new Date(
                                        occDateArr[0],
                                        occDateArr[1] - 1,
                                        occDateArr[2]
                                    );
                                    nextDay.setDate(nextDay.getDate() + 1);
                                    occEvent.end = [
                                        nextDay.getFullYear(),
                                        nextDay.getMonth() + 1,
                                        nextDay.getDate(),
                                    ];
                                }

                                if (r.createdAt) {
                                    const created = new Date(r.createdAt);
                                    occEvent.created = [
                                        created.getUTCFullYear(),
                                        created.getUTCMonth() + 1,
                                        created.getUTCDate(),
                                        created.getUTCHours(),
                                        created.getUTCMinutes(),
                                        created.getUTCSeconds(),
                                    ];
                                }

                                if (!r.completed && startTimeArray) {
                                    occEvent.alarms = [
                                        {
                                            action: 'display',
                                            description: title,
                                            trigger: { before: true, minutes: 15 },
                                        },
                                    ];
                                }

                                events.push(occEvent);
                            }
                            // 已经为 lunar-yearly 展开为独立事件，跳过后续的 RRULE 处理与基础事件
                            continue;
                        } catch (e) {
                            console.warn('处理农历重复事件失败', e, r);
                        }
                    }

                    // 农历每月:在当前年和下一年范围内遍历每天,匹配农历日并生成独立事件
                    if (r.repeat.type === 'lunar-monthly') {
                        try {
                            const lunarDay = r.repeat.lunarDay;
                            if (!lunarDay) {
                                console.warn('lunar-monthly 缺少 lunarDay', r);
                            } else {
                                const nowYear = new Date().getFullYear();
                                const startDate = new Date(nowYear, 0, 1);
                                const endDate = new Date(nowYear + 1, 11, 31);
                                for (
                                    let d = new Date(startDate);
                                    d <= endDate;
                                    d.setDate(d.getDate() + 1)
                                ) {
                                    const year = d.getFullYear();
                                    const month = (d.getMonth() + 1).toString().padStart(2, '0');
                                    const day = d.getDate().toString().padStart(2, '0');
                                    const solarStr = `${year}-${month}-${day}`;
                                    try {
                                        const lunar = solarToLunar(solarStr);
                                        if (lunar && lunar.day === lunarDay) {
                                            const occDateArr = parseDateArray(solarStr);
                                            if (!occDateArr) continue;
                                            const occEvent: any = {
                                                uid: `${id}-${solarStr}@siyuan`,
                                                title: title,
                                                description: description,
                                                status: r.completed ? 'CONFIRMED' : 'TENTATIVE',
                                            };

                                            if (startTimeArray) {
                                                occEvent.start = [...occDateArr, ...startTimeArray];
                                                if (endTimeArray) {
                                                    occEvent.end = [
                                                        ...parseDateArray(r.endDate || solarStr)!,
                                                        ...endTimeArray,
                                                    ];
                                                } else {
                                                    occEvent.duration = { hours: 1 };
                                                }
                                            } else {
                                                occEvent.start = occDateArr;
                                                const nextDay = new Date(
                                                    occDateArr[0],
                                                    occDateArr[1] - 1,
                                                    occDateArr[2]
                                                );
                                                nextDay.setDate(nextDay.getDate() + 1);
                                                occEvent.end = [
                                                    nextDay.getFullYear(),
                                                    nextDay.getMonth() + 1,
                                                    nextDay.getDate(),
                                                ];
                                            }

                                            if (r.createdAt) {
                                                const created = new Date(r.createdAt);
                                                occEvent.created = [
                                                    created.getUTCFullYear(),
                                                    created.getUTCMonth() + 1,
                                                    created.getUTCDate(),
                                                    created.getUTCHours(),
                                                    created.getUTCMinutes(),
                                                    created.getUTCSeconds(),
                                                ];
                                            }

                                            if (!r.completed && startTimeArray) {
                                                occEvent.alarms = [
                                                    {
                                                        action: 'display',
                                                        description: title,
                                                        trigger: { before: true, minutes: 15 },
                                                    },
                                                ];
                                            }

                                            events.push(occEvent);
                                        }
                                    } catch (le) {
                                        // ignore conversion errors for specific dates
                                    }
                                }
                            }
                            // 已展开为独立事件,跳过后续 RRULE 与基础事件
                            continue;
                        } catch (e) {
                            console.warn('处理农历每月事件失败', e, r);
                        }
                    }

                    // 处理其他重复类型的 RRULE
                    try {
                        const rrule = buildRRuleFromRepeat(r.repeat, r.date);
                        if (rrule) {
                            event.recurrenceRule = rrule;
                            if (startTimeArray) {
                                if (!endTimeArray) {
                                    delete event.end;
                                    event.duration = { hours: 1 };
                                } else {
                                    const sh = startTimeArray[0];
                                    const sm = startTimeArray[1];
                                    const eh = endTimeArray[0];
                                    const em = endTimeArray[1];
                                    let dh = eh - sh;
                                    let dm = em - sm;
                                    if (dm < 0) {
                                        dh -= 1;
                                        dm += 60;
                                    }
                                    if (dh <= 0 && dm <= 0) {
                                        event.duration = { hours: 1 };
                                        delete event.end;
                                    } else {
                                        const dur: any = {};
                                        if (dh > 0) dur.hours = dh;
                                        if (dm > 0) dur.minutes = dm;
                                        event.duration = dur;
                                        delete event.end;
                                    }
                                }
                            } else {
                                event.duration = { days: 1 };
                                delete event.end;
                            }
                        }
                    } catch (e) {
                        console.warn('构建 RRULE 失败', e, r);
                    }
                }

                events.push(event);
            }

            const { error, value } = ics.createEvents(events, {
                productId: 'siyuan-plugin-task-note-management',
                method: 'PUBLISH',
                calName: '思源提醒',
            });

            if (error) {
                console.error('ICS 生成失败:', error);
                await pushErrMsg('ICS 生成失败: ' + error.message);
                return;
            }

            let normalized = value as string;
            try {
                if (typeof normalized === 'string' && normalizeForXiaomi) {
                    normalized = normalized.replace(/DURATION:P(\d+)DT/g, 'DURATION:P$1D');
                }
            } catch (e) {
                console.warn('ICS 替换 DURATION 失败', e);
            }

            fs.mkdirSync(dataDir, { recursive: true });
            const outPath = pathMod
                ? pathMod.join(dataDir, 'reminders.ics')
                : dataDir + '/reminders.ics';
            fs.writeFileSync(outPath, normalized, 'utf8');
            if (openFolder) {
                await useShell('showItemInFolder', outPath);
            }
            await pushMsg(`ICS 文件已生成: ${outPath} (共 ${events.length} 个事件)`);
        } catch (err) {
            console.error('导出 ICS 失败:', err);
            await pushErrMsg('导出 ICS 失败');
        }
    }

    // 上传ICS到云端
    async function uploadIcsToCloud() {
        try {
            if (!settings.icsBlockId) {
                await pushErrMsg('请先设置ICS块ID');
                return;
            }

            const fs = window.require && window.require('fs');
            const pathMod = window.require && window.require('path');
            if (!fs) {
                await pushErrMsg('当前环境不支持文件读取');
                return;
            }

            // 1. 调用 exportIcsFile 生成 reminders.ics (不打开文件夹)
            const isXiaomiFormat = settings.icsFormat === 'xiaomi';
            await exportIcsFile(isXiaomiFormat, false);

            // 2. 读取生成的 reminders.ics 文件
            const dataDir =
                window.siyuan.config.system.dataDir +
                '/storage/petal/siyuan-plugin-task-note-management';
            const icsPath = pathMod
                ? pathMod.join(dataDir, 'reminders.ics')
                : dataDir + '/reminders.ics';

            if (!fs.existsSync(icsPath)) {
                await pushErrMsg('reminders.ics 文件不存在，请先生成 ICS 文件');
                return;
            }

            const icsContent = fs.readFileSync(icsPath, 'utf8');

            // 3. 从块内容中提取 ICS 链接
            const { getBlockKramdown } = await import('./api');
            const blockData = await getBlockKramdown(settings.icsBlockId);
            const kramdown = blockData.kramdown;

            // 匹配 [reminders.ics](assets/reminders-xxx.ics) 格式
            const linkMatch = kramdown.match(
                /\[reminders\.ics\]\((assets\/reminders-[^)]+\.ics)\)/
            );

            let assetPath: string;
            if (linkMatch && linkMatch[1]) {
                // 使用现有链接
                assetPath = `data/${linkMatch[1]}`;
            } else {
                // 如果没有找到链接，创建新的
                const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, -5);
                const filename = `reminders-${timestamp}-${window.Lute.NewNodeID()}.ics`;
                assetPath = `data/assets/${filename}`;
            }

            // 4. 使用 putFile 上传到 assets
            const blob = new Blob([icsContent], { type: 'text/calendar' });
            await putFile(assetPath, false, blob);

            // 5. 调用 API 的 uploadIcsToCloud 触发云端同步
            const { uploadIcsToCloud: uploadApi } = await import('./api');
            await uploadApi(settings.icsBlockId);

            // 构建云端链接
            const userId = window.siyuan?.user?.userId || '';
            if (userId) {
                const filename = assetPath.replace('data/assets/', '');
                const fullUrl = `https://assets.b3logfile.com/siyuan/${userId}/assets/${filename}`;
                settings.icsCloudUrl = fullUrl;
                await plugin.saveData(SETTINGS_FILE, settings);
                updateGroupItems();
            }
        } catch (err) {
            console.error('上传ICS到云端失败:', err);
            await pushErrMsg('上传ICS到云端失败: ' + (err.message || err));
        }
    }

    // 定义设置分组
    let groups: ISettingGroup[] = [
        {
            name: t('sidebarSettings'),
            items: [
                {
                    key: 'enableReminderDock',
                    value: settings.enableReminderDock,
                    type: 'checkbox',
                    title: t('enableReminderDock'),
                    description: t('enableReminderDockDesc'),
                },
                {
                    key: 'enableProjectDock',
                    value: settings.enableProjectDock,
                    type: 'checkbox',
                    title: t('enableProjectDock'),
                    description: t('enableProjectDockDesc'),
                },
                {
                    key: 'enableHabitDock',
                    value: settings.enableHabitDock,
                    type: 'checkbox',
                    title: t('enableHabitDock'),
                    description: t('enableHabitDockDesc'),
                },
                {
                    key: 'enableDockBadge',
                    value: settings.enableDockBadge,
                    type: 'checkbox',
                    title: t('enableDockBadge'),
                    description: t('enableDockBadgeDesc'),
                },
                {
                    key: 'enableReminderDockBadge',
                    value: settings.enableReminderDockBadge,
                    type: 'checkbox',
                    title: t('enableReminderDockBadge'),
                    description: t('enableReminderDockBadgeDesc'),
                },
                {
                    key: 'enableProjectDockBadge',
                    value: settings.enableProjectDockBadge,
                    type: 'checkbox',
                    title: t('enableProjectDockBadge'),
                    description: t('enableProjectDockBadgeDesc'),
                },
                {
                    key: 'enableHabitDockBadge',
                    value: settings.enableHabitDockBadge,
                    type: 'checkbox',
                    title: t('enableHabitDockBadge'),
                    description: t('enableHabitDockBadgeDesc'),
                },
            ],
        },
        {
            name: t('notificationReminder'),
            items: [
                {
                    key: 'notificationSound',
                    value: settings.notificationSound,
                    type: 'textinput',
                    title: t('notificationSoundSetting'),
                    description: t('notificationSoundDesc'),
                },
                {
                    key: 'reminderSystemNotification',
                    value: settings.reminderSystemNotification,
                    type: 'checkbox',
                    title: t('reminderSystemNotification'),
                    description: t('reminderSystemNotificationDesc'),
                },
                {
                    key: 'dailyNotificationTime',
                    value: settings.dailyNotificationTime,
                    type: 'textinput',
                    placeholder: '09:00',
                    title: t('dailyNotificationTime'),
                    description: t('dailyNotificationTimeDesc'),
                },
                {
                    key: 'dailyNotificationEnabled',
                    value: settings.dailyNotificationEnabled,
                    type: 'checkbox',
                    title: t('dailyNotificationEnabled'),
                    description: t('dailyNotificationEnabledDesc'),
                },
                {
                    key: 'autoDetectDateTime',
                    value: settings.autoDetectDateTime,
                    type: 'checkbox',
                    title: t('autoDetectDateTime'),
                    description: t('autoDetectDateTimeDesc'),
                },
            ],
        },
        {
            name: t('calendarSettings'),
            items: [
                {
                    key: 'weekStartDay',
                    // For select UI, use string values so they match option keys in the DOM
                    value: String(settings.weekStartDay),
                    type: 'select',
                    title: t('weekStartDay'),
                    description: t('weekStartDayDesc'),
                    options: {
                        0: t('sunday'),
                        1: t('monday'),
                        2: t('tuesday'),
                        3: t('wednesday'),
                        4: t('thursday'),
                        5: t('friday'),
                        6: t('saturday'),
                    },
                },
            ],
        },
        {
            name: '✅' + t('timeReminder'),
            items: [
                {
                    key: 'newDocNotebook',
                    value: settings.newDocNotebook,
                    type: 'select',
                    title: t('newDocNotebook'),
                    description: t('newDocNotebookDesc'),
                    options: notebooks.reduce(
                        (acc, notebook) => {
                            acc[notebook.id] = notebook.name;
                            return acc;
                        },
                        {} as { [key: string]: string }
                    ),
                },
                {
                    key: 'newDocPath',
                    value: settings.newDocPath,
                    type: 'textinput',
                    title: t('newDocPath'),
                    description: t('newDocPathDesc'),
                },
            ],
        },
        {
            name: t('pomodoroSettings'),
            items: [
                {
                    key: 'pomodoroHint',
                    value: '',
                    type: 'hint',
                    title: t('pomodoroHintTitle'),
                    description: t('pomodoroHintDesc'),
                },
                {
                    key: 'pomodoroWorkDuration',
                    value: settings.pomodoroWorkDuration,
                    type: 'number',
                    title: t('pomodoroWorkDuration'),
                    description: t('pomodoroWorkDurationDesc'),
                },
                {
                    key: 'pomodoroBreakDuration',
                    value: settings.pomodoroBreakDuration,
                    type: 'number',
                    title: t('pomodoroBreakDuration'),
                    description: t('pomodoroBreakDurationDesc'),
                },
                {
                    key: 'pomodoroLongBreakDuration',
                    value: settings.pomodoroLongBreakDuration,
                    type: 'number',
                    title: t('pomodoroLongBreakDuration'),
                    description: t('pomodoroLongBreakDurationDesc'),
                },
                {
                    key: 'pomodoroLongBreakInterval',
                    value: settings.pomodoroLongBreakInterval,
                    type: 'number',
                    title: t('pomodoroLongBreakInterval'),
                    description: t('pomodoroLongBreakIntervalDesc'),
                },
                {
                    key: 'pomodoroAutoMode',
                    value: settings.pomodoroAutoMode,
                    type: 'checkbox',
                    title: t('pomodoroAutoMode'),
                    description: t('pomodoroAutoModeDesc'),
                },
                {
                    key: 'pomodoroSystemNotification',
                    value: settings.pomodoroSystemNotification,
                    type: 'checkbox',
                    title: t('pomodoroSystemNotification'),
                    description: t('pomodoroSystemNotificationDesc'),
                },
                {
                    key: 'dailyFocusGoal',
                    value: settings.dailyFocusGoal,
                    type: 'number',
                    title: t('dailyFocusGoal'),
                    description: t('dailyFocusGoalDesc'),
                },
                {
                    key: 'backgroundVolume',
                    value: settings.backgroundVolume,
                    type: 'slider',
                    title: t('backgroundVolume'),
                    description: t('backgroundVolumeDesc'),
                    slider: {
                        min: 0,
                        max: 1,
                        step: 0.1,
                    },
                },
                {
                    key: 'pomodoroWorkSound',
                    value: settings.pomodoroWorkSound,
                    type: 'textinput',
                    title: t('pomodoroWorkSound'),
                    description: t('pomodoroWorkSoundDesc'),
                },
                {
                    key: 'pomodoroBreakSound',
                    value: settings.pomodoroBreakSound,
                    type: 'textinput',
                    title: t('pomodoroBreakSound'),
                    description: t('pomodoroBreakSoundDesc'),
                },
                {
                    key: 'pomodoroLongBreakSound',
                    value: settings.pomodoroLongBreakSound,
                    type: 'textinput',
                    title: t('pomodoroLongBreakSound'),
                    description: t('pomodoroLongBreakSoundDesc'),
                },
                {
                    key: 'pomodoroWorkEndSound',
                    value: settings.pomodoroWorkEndSound,
                    type: 'textinput',
                    title: t('pomodoroWorkEndSound'),
                    description: t('pomodoroWorkEndSoundDesc'),
                },
                {
                    key: 'pomodoroBreakEndSound',
                    value: settings.pomodoroBreakEndSound,
                    type: 'textinput',
                    title: t('pomodoroBreakEndSound'),
                    description: t('pomodoroBreakEndSoundDesc'),
                },
            ],
        },
        {
            name: t('randomNotificationSettings'),
            items: [
                {
                    key: 'randomNotificationEnabled',
                    value: settings.randomNotificationEnabled,
                    type: 'checkbox',
                    title: t('randomNotificationEnabled'),
                    description: t('randomNotificationEnabledDesc'),
                },
                {
                    key: 'randomNotificationSystemNotification',
                    value: settings.randomNotificationSystemNotification,
                    type: 'checkbox',
                    title: t('randomNotificationSystemNotification'),
                    description: t('randomNotificationSystemNotificationDesc'),
                },
                {
                    key: 'randomNotificationMinInterval',
                    value: settings.randomNotificationMinInterval,
                    type: 'number',
                    title: t('randomNotificationMinInterval'),
                    description: t('randomNotificationMinIntervalDesc'),
                },
                {
                    key: 'randomNotificationMaxInterval',
                    value: settings.randomNotificationMaxInterval,
                    type: 'number',
                    title: t('randomNotificationMaxInterval'),
                    description: t('randomNotificationMaxIntervalDesc'),
                },
                {
                    key: 'randomNotificationBreakDuration',
                    value: settings.randomNotificationBreakDuration,
                    type: 'number',
                    title: t('randomNotificationBreakDuration'),
                    description: t('randomNotificationBreakDurationDesc'),
                },
                {
                    key: 'randomNotificationSounds',
                    value: settings.randomNotificationSounds,
                    type: 'textinput',
                    title: t('randomNotificationSounds'),
                    description: t('randomNotificationSoundsDesc'),
                },
                {
                    key: 'randomNotificationEndSound',
                    value: settings.randomNotificationEndSound,
                    type: 'textinput',
                    title: t('randomNotificationEndSound'),
                    description: t('randomNotificationEndSoundDesc'),
                },
            ],
        },
        {
            name: '📁' + t('dataStorageLocation'),
            items: [
                {
                    key: 'dataStorageInfo',
                    value: 'data/storage/petal/siyuan-plugin-task-note-management',
                    type: 'hint',
                    title: t('dataStorageLocationTitle'),
                    description: t('dataStorageLocationDesc'),
                },
                {
                    key: 'openDataFolder',
                    value: '',
                    type: 'button',
                    title: '打开数据文件夹',
                    description: '',
                    button: {
                        label: '打开数据文件夹',
                        callback: async () => {
                            const path =
                                window.siyuan.config.system.dataDir +
                                '/storage/petal/siyuan-plugin-task-note-management';
                            await useShell('openPath', path);
                        },
                    },
                },
                {
                    key: 'deletePluginData',
                    value: '',
                    type: 'button',
                    title: '删除插件数据',
                    description: '删除所有插件数据文件，此操作不可逆',
                    button: {
                        label: '删除数据',
                        callback: async () => {
                            const confirmed = confirm('确定要删除所有插件数据吗？此操作不可逆！');
                            if (confirmed) {
                                const dataDir =
                                    'data/storage/petal/siyuan-plugin-task-note-management/';
                                const files = [
                                    SETTINGS_FILE,
                                    PROJECT_DATA_FILE,
                                    CATEGORIES_DATA_FILE,
                                    REMINDER_DATA_FILE,
                                    HABIT_DATA_FILE,
                                    NOTIFY_DATA_FILE,
                                    POMODORO_RECORD_DATA_FILE,
                                    HABIT_GROUP_DATA_FILE,
                                    STATUSES_DATA_FILE,
                                ];
                                let successCount = 0;
                                for (const file of files) {
                                    try {
                                        await removeFile(dataDir + file);
                                        successCount++;
                                    } catch (e) {
                                        console.error('删除文件失败:', file, e);
                                    }
                                }
                                pushErrMsg(`数据删除完成，已删除 ${successCount} 个文件`);
                                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                            }
                        },
                    },
                },
            ],
        },
        {
            name: '⬆️导出',
            items: [
                {
                    key: 'exportIcs',
                    value: '',
                    type: 'button',
                    title: '导出 ICS 文件',
                    description:
                        '将提醒导出为标准 ICS 日历文件，可导入到 Outlook、Google Calendar 等日历应用',
                    button: {
                        label: '生成 ICS',
                        callback: async () => {
                            await exportIcsFile(false);
                        },
                    },
                },
                {
                    key: 'exportIcsXiaomi',
                    value: '',
                    type: 'button',
                    title: '导出 ICS 文件（小米兼容）',
                    description: '生成适配小米日历的 ICS（将 DURATION:P1DT 替换为 DURATION:P1D）',
                    button: {
                        label: '生成 ICS（小米）',
                        callback: async () => {
                            await exportIcsFile(true);
                        },
                    },
                },
                {
                    key: 'icsFormat',
                    value: settings.icsFormat,
                    type: 'select',
                    title: 'ICS 格式',
                    description: '选择ICS文件的格式',
                    options: {
                        normal: '常规 ICS',
                        xiaomi: '小米兼容',
                    },
                },
                {
                    key: 'icsBlockId',
                    value: settings.icsBlockId,
                    type: 'textinput',
                    title: 'ICS 云端同步块ID',
                    description:
                        '输入包含ICS文件的块ID，用于云端同步(调用思源API，需要开通思源会员）。生成ICS后拖入块中，复制块ID粘贴此处',
                },
                {
                    key: 'icsSyncInterval',
                    value: settings.icsSyncInterval,
                    type: 'select',
                    title: 'ICS 同步间隔',
                    description: '设置自动同步ICS文件到云端的频率',
                    options: {
                        daily: '每天',
                        hourly: '每小时',
                    },
                },
                {
                    key: 'icsCloudUrl',
                    value: settings.icsCloudUrl,
                    type: 'textinput',
                    title: 'ICS 云端链接',
                    description: '上传成功后自动生成的云端链接',
                    disabled: true,
                },
                {
                    key: 'uploadIcsToCloud',
                    value: '',
                    type: 'button',
                    title: '生成并上传 ICS 到云端',
                    description: '生成ICS文件并立即上传到思源云端',
                    button: {
                        label: '生成并上传',
                        callback: async () => {
                            await uploadIcsToCloud();
                        },
                    },
                },
            ],
        },
        {
            name: '❤️用爱发电',
            items: [
                {
                    key: 'donateInfo',
                    value: '',
                    type: 'hint',
                    title: '用爱发电',
                    description: `
                        项目 GitHub 地址: <a href="https://github.com/achuan-2/siyuan-plugin-task-note-management">https://github.com/achuan-2/siyuan-plugin-task-note-management</a>
                        <p style="margin-top:12px;">如果喜欢我的插件，欢迎给GitHub仓库点star和微信赞赏，这会激励我继续完善此插件和开发新插件。</p>

                        <p style="margin-top:12px;">维护插件费时费力，个人时间和精力有限，开源只是分享，不等于我要浪费我的时间免费帮用户实现ta需要的功能，</p>

                        <p style="margin-top:12px;">我需要的功能我会慢慢改进（打赏可以催更），有些我觉得可以改进、但是现阶段不必要的功能需要打赏才改进（会标注打赏标签和需要打赏金额），而不需要的功能、实现很麻烦的功能会直接关闭issue不考虑实现，我没实现的功能欢迎有大佬来pr</p>

                        <p style="margin-top:12px;">累积赞赏50元的朋友如果想加我微信，可以在赞赏的时候备注微信号，或者发邮件到<a href="mailto:achuan-2@outlook.com">achuan-2@outlook.com</a>来进行好友申请</p>

                        <div style="margin-top:12px;">
                            <img src="plugins/siyuan-plugin-task-note-management/assets/donate.png" alt="donate" style="max-width:260px; height:auto; border:1px solid var(--b3-border-color);"/>
                        </div>
                    `,
                },
            ],
        },
    ];

    let focusGroup = groups[0].name;

    interface ChangeEvent {
        group: string;
        key: string;
        value: any;
    }

    const onChanged = ({ detail }: CustomEvent<ChangeEvent>) => {
        console.log(detail.key, detail.value);
        const setting = settings[detail.key];
        if (setting !== undefined) {
            // 如果是weekStartDay，将字符串转为数字
            if (detail.key === 'weekStartDay' && typeof detail.value === 'string') {
                const parsed = parseInt(detail.value, 10);
                settings[detail.key] = isNaN(parsed) ? DEFAULT_SETTINGS.weekStartDay : parsed;
            } else if (detail.key === 'dailyNotificationTime') {
                // 允许用户输入 HH:MM，也兼容数字（小时）或单个小时字符串
                let v = detail.value;
                if (typeof v === 'number') {
                    const h = Math.max(0, Math.min(23, Math.floor(v)));
                    v = (h < 10 ? '0' : '') + h.toString() + ':00';
                } else if (typeof v === 'string') {
                    const m = v.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
                    if (m) {
                        const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
                        const min = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10) || 0));
                        v =
                            (h < 10 ? '0' : '') +
                            h.toString() +
                            ':' +
                            (min < 10 ? '0' : '') +
                            min.toString();
                    } else {
                        // 如果无法解析，回退到默认
                        v = DEFAULT_SETTINGS.dailyNotificationTime;
                    }
                }
                settings[detail.key] = v;
            } else {
                settings[detail.key] = detail.value;
            }

            // 当块ID改变时，尝试从该块中解析已上传的文件名并自动生成云端链接
            if (detail.key === 'icsBlockId' && detail.value) {
                (async () => {
                    try {
                        const { getBlockByID } = await import('./api');
                        const block = await getBlockByID(String(detail.value));
                        let filename: string | null = null;
                        const content =
                            (block && (block.content || block.html || block.text)) || '';
                        if (typeof content === 'string') {
                            const m1 = content.match(
                                /https?:\/\/assets\.b3logfile\.com\/siyuan\/[^\/]+\/assets\/([^"\)\]\s<>']+\.ics)/i
                            );
                            const m2 =
                                content.match(/data\/assets\/([^"\)\]\s<>']+\.ics)/i) ||
                                content.match(/assets\/([^"\)\]\s<>']+\.ics)/i);
                            const found = m1 || m2;
                            if (found && found[1]) {
                                filename = found[1];
                            }
                        }

                        // 回退到基于时间戳的文件名（保守策略）
                        if (!filename) {
                            const timestamp = new Date()
                                .toISOString()
                                .replace(/[:.]/g, '')
                                .slice(0, -5);
                            filename = `reminders-${timestamp}-kxg4mps.ics`;
                        }

                        const userId = window.siyuan?.user?.userId || '';
                        if (userId && filename) {
                            settings.icsCloudUrl = `https://assets.b3logfile.com/siyuan/${userId}/assets/${filename}`;
                        }
                    } catch (err) {
                        // 出错时保持原有行为：使用时间戳文件名
                        const timestamp = new Date()
                            .toISOString()
                            .replace(/[:.]/g, '')
                            .slice(0, -5);
                        const filename = `reminders-${timestamp}-kxg4mps.ics`;
                        const userId = window.siyuan?.user?.userId || '';
                        if (userId)
                            settings.icsCloudUrl = `https://assets.b3logfile.com/siyuan/${userId}/assets/${filename}`;
                    }
                })();
            }

            saveSettings();
            // 确保 UI 中 select 等值显示被刷新
            updateGroupItems();
        }
    };

    async function saveSettings() {
        await plugin.saveData(SETTINGS_FILE, settings);
        // 通知其他组件（如日历视图）设置项已更新
        try {
            window.dispatchEvent(new CustomEvent('reminderSettingsUpdated'));
        } catch (err) {
            console.warn('Dispatch settings updated event failed:', err);
        }
    }

    onMount(() => {
        // 执行异步加载
        (async () => {
            await loadNotebooks();
            await runload();
        })();

        // 监听外部设置变更事件，重新加载设置并刷新 UI
        const settingsUpdateHandler = async () => {
            const loadedSettings = await plugin.loadSettings();
            settings = { ...loadedSettings };
            // 确保 weekStartDay 在加载后是数字（可能以字符串形式保存）
            if (typeof settings.weekStartDay === 'string') {
                const parsed = parseInt(settings.weekStartDay, 10);
                settings.weekStartDay = isNaN(parsed) ? DEFAULT_SETTINGS.weekStartDay : parsed;
            }
            updateGroupItems();
        };
        window.addEventListener('reminderSettingsUpdated', settingsUpdateHandler);

        // 在组件销毁时移除监听
        return () => {
            window.removeEventListener('reminderSettingsUpdated', settingsUpdateHandler);
        };
    });

    async function loadNotebooks() {
        try {
            const result = await lsNotebooks();
            notebooks = result.notebooks.map(notebook => ({
                id: notebook.id,
                name: notebook.name,
            }));
        } catch (error) {
            console.error('加载笔记本列表失败:', error);
            notebooks = [];
        }
    }

    async function runload() {
        const loadedSettings = await plugin.loadSettings();
        settings = { ...loadedSettings };
        // 确保 weekStartDay 在加载后是数字（可能以字符串形式保存）
        if (typeof settings.weekStartDay === 'string') {
            const parsed = parseInt(settings.weekStartDay, 10);
            settings.weekStartDay = isNaN(parsed) ? DEFAULT_SETTINGS.weekStartDay : parsed;
        }
        updateGroupItems();
        // 确保设置已保存（可能包含新的默认值）
        await saveSettings();
        console.debug('加载配置文件完成');
    }

    function updateGroupItems() {
        groups = groups.map(group => ({
            ...group,
            items: group.items.map(item => {
                const updatedItem = {
                    ...item,
                    value: (() => {
                        const v = settings[item.key] ?? item.value;
                        // If this is a select input, use string representation for UI matching
                        if (item.type === 'select') {
                            return typeof v === 'string' ? v : String(v);
                        }
                        return v;
                    })(),
                };

                // 为笔记本选择器更新选项
                if (item.key === 'newDocNotebook') {
                    updatedItem.options = notebooks.reduce(
                        (acc, notebook) => {
                            acc[notebook.id] = notebook.name;
                            return acc;
                        },
                        {} as { [key: string]: string }
                    );
                }

                return updatedItem;
            }),
        }));
    }

    $: currentGroup = groups.find(group => group.name === focusGroup);
</script>

<div class="fn__flex-1 fn__flex config__panel">
    <ul class="b3-tab-bar b3-list b3-list--background">
        {#each groups as group}
            <li
                data-name="editor"
                class:b3-list-item--focus={group.name === focusGroup}
                class="b3-list-item"
                on:click={() => {
                    focusGroup = group.name;
                }}
                on:keydown={() => {}}
            >
                <span>{group.name}</span>
            </li>
        {/each}
    </ul>
    <div class="config__tab-wrap">
        <SettingPanel
            group={currentGroup?.name || ''}
            settingItems={currentGroup?.items || []}
            display={true}
            on:changed={onChanged}
        />
    </div>
</div>

<style lang="scss">
    .config__panel {
        height: 100%;
        display: flex;
        flex-direction: row;
        overflow: hidden;
    }
    .config__panel > .b3-tab-bar {
        width: 170px;
    }

    .config__tab-wrap {
        flex: 1;
        height: 100%;
        overflow: auto;
        padding: 2px;
    }
</style>
