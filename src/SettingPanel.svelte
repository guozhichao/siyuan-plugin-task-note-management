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
    let notebooks: Array<{id: string, name: string}> = [];

    interface ISettingGroup {
        name: string;
        items: ISettingItem[];
    }

    // 定义设置分组
    let groups: ISettingGroup[] = [
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
                    type: 'number',
                    title: t('dailyNotificationTime'),
                    description: t('dailyNotificationTimeDesc'),
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
            name: '✅'+t('timeReminder'),
            items: [
                                {
                    key: 'newDocNotebook',
                    value: settings.newDocNotebook,
                    type: 'select',
                    title: t('newDocNotebook'),
                    description: t('newDocNotebookDesc'),
                    options: notebooks.reduce((acc, notebook) => {
                        acc[notebook.id] = notebook.name;
                        return acc;
                    }, {} as {[key: string]: string})
                },
                {
                    key: 'newDocPath',
                    value: settings.newDocPath,
                    type: 'textinput',
                    title: t('newDocPath'),
                    description: t('newDocPathDesc'),
                },
            ]
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
            name: '📁'+t('dataStorageLocation'),
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
            settings[detail.key] = detail.value;
            saveSettings();
        }
    };

    async function saveSettings() {
        await plugin.saveData(SETTINGS_FILE, settings);
    }

    onMount(async () => {
        await loadNotebooks();
        await runload();
    });

    async function loadNotebooks() {
        try {
            const result = await lsNotebooks();
            notebooks = result.notebooks.map(notebook => ({
                id: notebook.id,
                name: notebook.name
            }));
        } catch (error) {
            console.error('加载笔记本列表失败:', error);
            notebooks = [];
        }
    }

    async function runload() {
        const loadedSettings = await plugin.loadSettings();
        settings = { ...loadedSettings };
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
                    value: settings[item.key] ?? item.value,
                };
                
                // 为笔记本选择器更新选项
                if (item.key === 'newDocNotebook') {
                    updatedItem.options = notebooks.reduce((acc, notebook) => {
                        acc[notebook.id] = notebook.name;
                        return acc;
                    }, {} as {[key: string]: string});
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
                <span class="b3-list-item__text">{group.name}</span>
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
