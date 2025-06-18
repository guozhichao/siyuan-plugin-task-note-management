<script lang="ts">
    import { onMount } from 'svelte';
    import SettingPanel from '@/libs/components/setting-panel.svelte';
    import { DEFAULT_SETTINGS, SETTINGS_FILE } from './index';

    export let plugin;


    // 使用从 index.ts 导入的默认设置
    let settings = { ...DEFAULT_SETTINGS };

    interface ISettingGroup {
        name: string;
        items: ISettingItem[];
    }

    // 定义设置分组
    let groups: ISettingGroup[] = [
        {
            name: '📢通知提醒',
            items: [
                {
                    key: 'notificationSound',
                    value: settings.notificationSound,
                    type: 'textinput',
                    title: '通知提醒声音',
                    description: '设置事项提醒时播放的声音文件路径，留空则静音',
                },
            ],
        },
        {
            name: '🍅番茄钟设置',
            items: [
                {
                    key: 'pomodoroWorkDuration',
                    value: settings.pomodoroWorkDuration,
                    type: 'number',
                    title: '番茄钟工作时长（分钟）',
                    description: '设置番茄钟工作阶段的时长，默认25分钟',
                },
                {
                    key: 'pomodoroBreakDuration',
                    value: settings.pomodoroBreakDuration,
                    type: 'number',
                    title: '番茄钟短时休息时长（分钟）',
                    description: '设置番茄钟短时休息阶段的时长，默认5分钟',
                },
                {
                    key: 'pomodoroLongBreakDuration',
                    value: settings.pomodoroLongBreakDuration,
                    type: 'number',
                    title: '番茄钟长时休息时长（分钟）',
                    description: '设置番茄钟长时休息阶段的时长，默认30分钟',
                },
                {
                    key: 'pomodoroLongBreakInterval',
                    value: settings.pomodoroLongBreakInterval,
                    type: 'number',
                    title: '自动进入长休息模式',
                    description: '设置连续工作几个番茄钟后自动进入长休息模式，默认4个番茄钟',
                },
                {
                    key: 'pomodoroAutoMode',
                    value: settings.pomodoroAutoMode,
                    type: 'checkbox',
                    title: '自动番茄钟模式',
                    description:
                        '（仅用于倒计时番茄）启用后，工作计时结束自动进入休息计时，休息结束自动开始工作计时，并根据设定的间隔自动进入长休息模式',
                },
                {
                    key: 'backgroundVolume',
                    value: settings.backgroundVolume,
                    type: 'slider',
                    title: '番茄钟背景音音量',
                    description: '设置番茄钟背景音的音量大小，范围0-1',
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
                    title: '番茄工作时背景音（可选）',
                    description: '设置工作时播放的背景音文件路径，留空则静音',
                },
                {
                    key: 'pomodoroBreakSound',
                    value: settings.pomodoroBreakSound,
                    type: 'textinput',
                    title: '番茄休息背景音（可选）',
                    description: '设置休息时播放的背景音文件路径，留空则静音',
                },
                {
                    key: 'pomodoroLongBreakSound',
                    value: settings.pomodoroLongBreakSound,
                    type: 'textinput',
                    title: '番茄长时休息背景音（可选）',
                    description: '设置长时休息时播放的背景音文件路径，留空则静音',
                },
                {
                    key: 'pomodoroWorkEndSound',
                    value: settings.pomodoroWorkEndSound,
                    type: 'textinput',
                    title: '工作结束提示音（可选）',
                    description: '设置番茄钟工作阶段结束时的提示音文件路径，留空则静音',
                },
                {
                    key: 'pomodoroBreakEndSound',
                    value: settings.pomodoroBreakEndSound,
                    type: 'textinput',
                    title: '休息结束提示音（可选）',
                    description: '设置番茄钟休息阶段结束时的提示音文件路径，留空则静音',
                },
            ],
        },
        {
            name: '🎲随机提示音',
            items: [
                {
                    key: 'randomNotificationEnabled',
                    value: settings.randomNotificationEnabled,
                    type: 'checkbox',
                    title: '启用随机提示音',
                    description:
                        '在番茄钟运行时每隔一定时间随机播放提示音，播放提示音后进行微休息，利用间隔效应和随机奖励，提高专注和工作效率。<a href="https://www.bilibili.com/video/BV1naLozQEBq">视频介绍</a>',
                },
                {
                    key: 'randomNotificationMinInterval',
                    value: settings.randomNotificationMinInterval,
                    type: 'number',
                    title: '随机提示音最小间隔（分钟）',
                    description: '设置随机提示音播放的最小间隔时间，默认3分钟',
                },
                {
                    key: 'randomNotificationMaxInterval',
                    value: settings.randomNotificationMaxInterval,
                    type: 'number',
                    title: '随机提示音最大间隔（分钟）',
                    description: '设置随机提示音播放的最大间隔时间，默认5分钟',
                },
                {
                    key: 'randomNotificationBreakDuration',
                    value: settings.randomNotificationBreakDuration,
                    type: 'number',
                    title: '微休息时间（秒）',
                    description: '随机提示音播放后的微休息时间，在此时间后播放结束提示音，默认10秒',
                },
                {
                    key: 'randomNotificationSounds',
                    value: settings.randomNotificationSounds,
                    type: 'textinput',
                    title: '随机提示音开始声音',
                    description: '设置番茄钟运行时随机提示音的文件路径，留空则不启用',
                },
                {
                    key: 'randomNotificationEndSound',
                    value: settings.randomNotificationEndSound,
                    type: 'textinput',
                    title: '随机提示音结束声音',
                    description: '设置随机提示音播放结束后的提示音文件路径，留空则不播放',
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
        await runload();
    });

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
            items: group.items.map(item => ({
                ...item,
                value: settings[item.key] ?? item.value,
            })),
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
