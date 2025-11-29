<script lang="ts">
    import { onMount } from 'svelte';
    import SettingPanel from '@/libs/components/setting-panel.svelte';
    import { t } from './utils/i18n';
    import { DEFAULT_SETTINGS, SETTINGS_FILE } from './index';
    import { lsNotebooks } from './api';

    export let plugin;

    // 使用从 index.ts 导入的默认设置
    let settings = { ...DEFAULT_SETTINGS };

    // 笔记本列表
    let notebooks: Array<{ id: string; name: string }> = [];

    interface ISettingGroup {
        name: string;
        items: ISettingItem[];
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
