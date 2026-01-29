import { showMessage, confirm, Menu, Dialog } from "siyuan";

import { refreshSql, getBlockByID, updateBindBlockAtrrs, openBlock } from "../api";
import { i18n } from "../pluginInstance";
import { getLocalDateString, getLocalDateTimeString, compareDateStrings, getLogicalDateString, getRelativeDateString } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";
import { PomodoroTimer } from "./PomodoroTimer";
import { PomodoroManager } from "../utils/pomodoroManager";
import { PomodoroRecordManager } from "../utils/pomodoroRecord"; // Add import
import { generateRepeatInstances, getRepeatDescription } from "../utils/repeatUtils";
import { getSolarDateLunarString } from "../utils/lunarUtils";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { BlockBindingDialog } from "./BlockBindingDialog";
import { getAllReminders, saveReminders } from '../utils/icsSubscription';

import { PasteTaskDialog } from "./PasteTaskDialog";

export class ProjectKanbanView {
    private container: HTMLElement;
    private plugin: any;
    private projectId: string;
    private project: any;
    private categoryManager: CategoryManager;
    private projectManager: ProjectManager;
    private currentSort: string = 'priority';
    private kanbanMode: 'status' | 'custom' = 'status';
    private currentSortOrder: 'asc' | 'desc' = 'desc';
    private doneSort: string = 'completedTime';
    private doneSortOrder: 'asc' | 'desc' = 'desc';
    private tasks: any[] = [];
    private isDragging: boolean = false;
    private draggedTask: any = null;
    private draggedElement: HTMLElement | null = null;
    // 当前正在拖拽的分组ID（用于分组管理对话框的拖拽排序）
    private draggedGroupId: string | null = null;
    // 当前显示的分组拖拽指示器（绝对定位在 container 内）
    private _groupDropIndicator: HTMLElement | null = null;
    // 拖拽时用于 setDragImage 的克隆元素（用于预览整个 group-item）
    private _groupDragImageEl: HTMLElement | null = null;
    // 自定义分组列拖拽时的指示器（列间插入指示）
    private _columnDropIndicator: HTMLElement | null = null;
    private sortButton: HTMLButtonElement;
    private doneSortButton: HTMLButtonElement;
    private isLoading: boolean = false;
    private searchKeyword: string = '';
    private searchInput: HTMLInputElement;
    private collapsedTasks: Set<string> = new Set();
    // 临时保存要在下一次渲染后恢复的父任务折叠状态
    private _preserveCollapsedTasks: Set<string> | null = null;

    // 分页：每页最多显示的顶层任务数量
    private pageSize: number = 30;
    // 存储每列当前页，key 为 status ('long_term'|'short_term'|'doing'|'completed')
    private pageIndexMap: { [status: string]: number } = { long_term: 1, short_term: 1, doing: 1, completed: 1 };

    // 自定义分组子分组折叠状态跟踪，key 为 "groupId-status" 格式
    private collapsedStatusGroups: Set<string> = new Set();
    private expandedStatusGroups: Set<string> = new Set();

    // 指示器状态跟踪
    private currentIndicatorType: 'none' | 'sort' | 'parentChild' = 'none';
    private currentIndicatorTarget: HTMLElement | null = null;
    private currentIndicatorPosition: 'top' | 'bottom' | 'middle' | null = null;

    // 全局番茄钟管理器
    private pomodoroManager = PomodoroManager.getInstance();
    private pomodoroRecordManager: PomodoroRecordManager; // Add property

    // 上一次选择的任务状态（用于记住新建任务时的默认选择）
    private lastSelectedStatus: string | null = null;
    // 上一次选择的自定义分组（用于记住新建任务时的默认分组）
    private lastSelectedCustomGroupId: string | null = null;
    // 防抖加载与滚动状态保存
    private _debounceTimer: any = null;
    private _debounceDelay: number = 250; // ms
    private _pendingLoadPromise: Promise<void> | null = null;
    private _pendingLoadResolve: (() => void) | null = null;

    // 用于临时保存滚动状态，避免界面刷新重置滚动条
    private _savedScrollState: {
        containerScrollLeft: number;
        columnScrollTopMap: { [key: string]: number };
    } | null = null;

    // 看板实例ID，用于区分事件来源
    private kanbanInstanceId: string = `kanban_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // 记录最后一次渲染的模式和项目ID，用于判断是否需要全量清空
    private _lastRenderMode: string | null = null;
    private _lastRenderedProjectId: string | null = null;

    // 缓存的任务数据
    private reminderData: any = null;

    // 标记是否已应用过默认的折叠策略（避免后续操作重复应用）
    private _defaultCollapseApplied: boolean = false;

    // 当前项目的看板状态配置
    private kanbanStatuses: import('../utils/projectManager').KanbanStatus[] = [];

    // 多选模式状态
    private isMultiSelectMode: boolean = false;
    // 选中的任务ID集合
    private selectedTaskIds: Set<string> = new Set();
    // 批量操作工具栏元素
    private batchToolbar: HTMLElement | null = null;

    constructor(container: HTMLElement, plugin: any, projectId: string) {
        this.container = container;
        this.plugin = plugin;
        this.pomodoroRecordManager = PomodoroRecordManager.getInstance(this.plugin); // Initialization
        this.projectId = projectId;
        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.projectManager = ProjectManager.getInstance(this.plugin);
        this.initializeAsync();
    }

    /**
     * 根据任务的日期和时间计算其“逻辑日期”（考虑一天起始时间设置）
     */
    private static getTaskLogicalDate(date?: string, time?: string): string {
        if (!date) return getLogicalDateString();
        if (time) {
            try {
                return getLogicalDateString(new Date(date + 'T' + time));
            } catch (e) {
                return date;
            }
        }
        return date;
    }

    // 实例包装，保持现有实例调用不变
    private getTaskLogicalDate(date?: string, time?: string): string {
        return (this.constructor as typeof ProjectKanbanView).getTaskLogicalDate(date, time);
    }

    private async createGroupDialog(container: HTMLElement) {
        const dialog = new Dialog({
            title: i18n('newGroup'),
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('groupName')}</label>
                        <input type="text" id="newGroupName" class="b3-text-field" placeholder="${i18n('pleaseEnterGroupName')}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('bindBlockId')} (${i18n('optional')})</label>
                        <input type="text" id="newGroupBlockId" class="b3-text-field" placeholder="${i18n('pleaseEnterBlockId')}" style="width: 100%;">
                        <div class="b3-label__text" style="margin-top: 4px; color: var(--b3-theme-on-surface-light);">${i18n('bindBlockIdHint')}</div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('groupColor')}</label>
                        <input type="color" id="newGroupColor" class="b3-text-field" value="#3498db" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('iconOptional')}</label>
                        <input type="text" id="newGroupIcon" class="b3-text-field" placeholder="${i18n('emojiIconExample')}" style="width: 100%;">
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="newGroupCancel">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="newGroupSave">${i18n('createGroup')}</button>
                </div>
            `,
            width: '420px'
        });

        const nameInput = dialog.element.querySelector('#newGroupName') as HTMLInputElement;
        const colorInput = dialog.element.querySelector('#newGroupColor') as HTMLInputElement;
        const iconInput = dialog.element.querySelector('#newGroupIcon') as HTMLInputElement;
        const blockIdInput = dialog.element.querySelector('#newGroupBlockId') as HTMLInputElement;
        const cancelBtn = dialog.element.querySelector('#newGroupCancel') as HTMLButtonElement;
        const saveBtn = dialog.element.querySelector('#newGroupSave') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        saveBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const color = colorInput.value;
            const icon = iconInput.value.trim();
            const blockId = blockIdInput.value.trim();

            if (!name) {
                showMessage(i18n('pleaseEnterGroupName') || '请输入分组名称');
                return;
            }

            try {
                const projectManager = this.projectManager;
                const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                const maxSort = currentGroups.reduce((max: number, g: any) => Math.max(max, g.sort || 0), 0);
                const newGroup = {
                    id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    name,
                    color,
                    icon,
                    blockId: blockId || undefined,
                    sort: maxSort + 10
                }; currentGroups.push(newGroup);
                await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                await this.loadAndDisplayGroups(container);
                this.queueLoadTasks();

                showMessage(i18n('groupCreated'));
                dialog.destroy();
            } catch (error) {
                console.error('创建分组失败:', error);
                showMessage(i18n('createGroupFailed') || '创建分组失败');
            }
        });
    }

    private async initializeAsync() {
        await this.categoryManager.initialize();
        await this.loadProject();
        await this.loadKanbanMode();
        this.initUI();
        await this.loadTasks();

        // 监听提醒更新事件（使用防抖加载以避免频繁重绘导致滚动重置）
        // 只有外部触发的事件才重新加载任务
        window.addEventListener('reminderUpdated', async (e: CustomEvent) => {
            // 如果是自己触发的更新，忽略
            if (e.detail?.source === this.kanbanInstanceId) {
                return;
            }
            // 外部触发的更新，需要刷新缓存 (但不强制读取文件，只使用插件内存缓存)
            this.reminderData = null;
            await this.getReminders(false);
            this.queueLoadTasks();
        });
    }

    private async loadProject() {
        try {
            const projectData = await this.plugin.loadProjectData();
            this.project = projectData[this.projectId];
            if (!this.project) {
                throw new Error('项目不存在');
            }
        } catch (error) {
            console.error('加载项目失败:', error);
            showMessage("加载项目失败");
        }
    }

    private async loadKanbanMode() {
        try {
            // 使用项目管理器的方法来获取看板模式
            const projectManager = this.projectManager;
            this.kanbanMode = await projectManager.getProjectKanbanMode(this.projectId);
            // 同时加载看板状态配置
            this.kanbanStatuses = await projectManager.getProjectKanbanStatuses(this.projectId);
        } catch (error) {
            console.error('加载看板模式失败:', error);
            this.kanbanMode = 'status';
            // 使用默认状态配置
            this.kanbanStatuses = this.projectManager.getDefaultKanbanStatuses();
        }
    }

    private async toggleKanbanMode() {
        try {
            const newMode = this.kanbanMode === 'status' ? 'custom' : 'status';
            this.kanbanMode = newMode;

            // 使用项目管理器保存看板模式
            await this.projectManager.setProjectKanbanMode(this.projectId, newMode);

            // 更新下拉选择框选中状态
            this.updateModeSelect();

            // 触发自定义事件来更新管理按钮显示状态
            this.container.dispatchEvent(new CustomEvent('kanbanModeChanged'));

            // 使用防抖加载并保存/恢复滚动位置
            this.captureScrollState();
            await this.queueLoadTasks();

            showMessage(`已切换到${newMode === 'status' ? '任务状态' : '自定义分组'}看板`);
        } catch (error) {
            console.error('切换看板模式失败:', error);
            showMessage('切换看板模式失败');
        }
    }

    private updateModeSelect() {
        const modeSelect = this.container.querySelector('.kanban-mode-select') as HTMLSelectElement;
        if (modeSelect) {
            // 更新选中状态
            const statusOption = modeSelect.querySelector('option[value="status"]') as HTMLOptionElement;
            const customOption = modeSelect.querySelector('option[value="custom"]') as HTMLOptionElement;

            if (statusOption && customOption) {
                statusOption.selected = this.kanbanMode === 'status';
                customOption.selected = this.kanbanMode === 'custom';
            }
        }
    }

    private async showManageGroupsDialog() {
        const dialog = new Dialog({
            title: i18n('manageCustomGroups'),
            content: `
                <div class="manage-groups-dialog">
                    <div class="b3-dialog__content">
                        <div class="groups-list" style="margin-bottom: 16px;">
                            <div class="groups-header" style="display: flex; justify-content: space-between; align-items: center;">
                                <h4 style="margin: 0;">${i18n('existingGroups')}</h4>
                                <button id="addGroupBtn" class="b3-button b3-button--small b3-button--primary">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newGroup')}
                                </button>
                            </div>
                            <div id="groupsContainer" class="groups-container" style="max-height: 300px; overflow-y: auto;">
                                <!-- 分组列表将在这里动态生成 -->
                            </div>
                        </div>

                        <div id="groupForm" class="group-form" style="display: none; padding: 16px; background: var(--b3-theme-surface-lighter); border-radius: 8px; border: 1px solid var(--b3-theme-border);">
                            <h4 id="formTitle" style="margin-top: 0;">${i18n('newGroup')}</h4>
                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n('groupName')}</label>
                                <input type="text" id="groupNameInput" class="b3-text-field" placeholder="${i18n('pleaseEnterGroupName')}" style="width: 100%;">
                            </div>
                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n('groupColor')}</label>
                                <div class="color-picker" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                                    <!-- 预设颜色选项 -->
                                </div>
                                <input type="color" id="groupColorInput" class="b3-text-field" value="#3498db" style="width: 100%; margin-top: 8px;">
                            </div>
                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n('iconOptional')}</label>
                                <input type="text" id="groupIconInput" class="b3-text-field" placeholder="${i18n('emojiIconExample')}" style="width: 100%;">
                            </div>
                            <div class="form-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
                                <button id="cancelFormBtn" class="b3-button b3-button--outline">${i18n('cancel')}</button>
                                <button id="saveGroupBtn" class="b3-button b3-button--primary">${i18n('save')}</button>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            width: "500px",
            height: "auto"
        });

        // 获取DOM元素
        const groupsContainer = dialog.element.querySelector('#groupsContainer') as HTMLElement;
        const addGroupBtn = dialog.element.querySelector('#addGroupBtn') as HTMLButtonElement;
        const groupForm = dialog.element.querySelector('#groupForm') as HTMLElement;
        const formTitle = dialog.element.querySelector('#formTitle') as HTMLElement;
        const groupNameInput = dialog.element.querySelector('#groupNameInput') as HTMLInputElement;
        const groupColorInput = dialog.element.querySelector('#groupColorInput') as HTMLInputElement;
        const groupIconInput = dialog.element.querySelector('#groupIconInput') as HTMLInputElement;
        const cancelFormBtn = dialog.element.querySelector('#cancelFormBtn') as HTMLButtonElement;
        const saveGroupBtn = dialog.element.querySelector('#saveGroupBtn') as HTMLButtonElement;
        const colorPicker = dialog.element.querySelector('.color-picker') as HTMLElement;

        let editingGroupId: string | null = null;

        // 预设颜色选项
        const presetColors = [
            '#3498db', '#e74c3c', '#2ecc71', '#f39c12',
            '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
            '#16a085', '#27ae60', '#2980b9', '#8e44ad'
        ];

        presetColors.forEach(color => {
            const colorOption = document.createElement('div');
            colorOption.className = 'color-option';
            colorOption.style.cssText = `
                width: 30px;
                height: 30px;
                border-radius: 50%;
                background-color: ${color};
                cursor: pointer;
                border: 2px solid transparent;
                transition: border-color 0.2s ease;
            `;
            colorOption.addEventListener('click', () => {
                colorPicker.querySelectorAll('.color-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                colorOption.classList.add('selected');
                groupColorInput.value = color;
            });
            colorPicker.appendChild(colorOption);
        });

        // 加载并显示现有分组
        await this.loadAndDisplayGroups(groupsContainer);

        // 新建分组按钮：改为弹出独立的创建分组对话框（而不是页面内联表单）
        addGroupBtn.addEventListener('click', async () => {
            try {
                await this.createGroupDialog(groupsContainer);
            } catch (err) {
                console.error('打开创建分组对话框失败:', err);
                showMessage(i18n('openCreateGroupFailed') || '打开创建分组对话框失败');
            }
        });

        // 取消表单
        cancelFormBtn.addEventListener('click', () => {
            groupForm.style.display = 'none';
        });

        // 保存分组
        saveGroupBtn.addEventListener('click', async () => {
            const name = groupNameInput.value.trim();
            const color = groupColorInput.value;
            const icon = groupIconInput.value.trim();

            if (!name) {
                showMessage('请输入分组名称');
                return;
            }

            try {
                // 获取当前项目的分组列表
                const { ProjectManager } = await import('../utils/projectManager');
                const projectManager = ProjectManager.getInstance(this.plugin);
                const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                let newGroup;
                if (editingGroupId) {
                    // 编辑现有分组
                    const groupIndex = currentGroups.findIndex((g: any) => g.id === editingGroupId);
                    if (groupIndex !== -1) {
                        currentGroups[groupIndex] = { ...currentGroups[groupIndex], name, color, icon };
                        newGroup = currentGroups[groupIndex];
                    }
                    showMessage(i18n('groupUpdated'));
                } else {
                    // 创建新分组
                    const maxSort = currentGroups.reduce((max: number, g: any) => Math.max(max, g.sort || 0), 0);
                    newGroup = {
                        id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                        name,
                        color,
                        icon,
                        sort: maxSort + 10
                    };
                    currentGroups.push(newGroup);
                    showMessage(i18n('groupCreated'));
                }

                // 保存到项目数据
                await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                // 刷新分组列表
                await this.loadAndDisplayGroups(groupsContainer);
                groupForm.style.display = 'none';

                // 刷新看板（使用防抖队列）
                this.queueLoadTasks();
            } catch (error) {
                console.error('保存分组失败:', error);
                showMessage(i18n('saveGroupFailed'));
            }
        });
    }

    /**
     * 显示管理任务状态对话框
     */
    private async showManageKanbanStatusesDialog() {
        const projectManager = this.projectManager;

        // 加载当前项目的状态配置
        let statuses = await projectManager.getProjectKanbanStatuses(this.projectId);

        const dialog = new Dialog({
            title: i18n('manageKanbanStatuses') || '管理任务状态',
            content: `
                <div class="manage-statuses-dialog">
                    <div class="b3-dialog__content">
                        <div class="statuses-list" style="margin-bottom: 16px;">
                            <div class="statuses-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <h4 style="margin: 0;">${i18n('existingStatuses') || '现有状态'}</h4>
                                <button id="addStatusBtn" class="b3-button b3-button--small b3-button--primary">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newStatus') || '新增状态'}
                                </button>
                            </div>
                            <div id="statusesContainer" class="statuses-container" style="max-height: 350px; overflow-y: auto;">
                                <!-- 状态列表将在这里动态生成 -->
                            </div>
                        </div>
                        <div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px;">
                            ${i18n('kanbanStatusHint') || '提示："进行中"和"已完成"为固定状态，不支持重命名和删除，但支持排序和修改颜色。'}
                        </div>
                    </div>
                </div>
            `,
            width: "480px",
            height: "auto"
        });

        const statusesContainer = dialog.element.querySelector('#statusesContainer') as HTMLElement;
        const addStatusBtn = dialog.element.querySelector('#addStatusBtn') as HTMLButtonElement;

        // 插入指示占位元素（用于显示拖拽时的插入位置） — 更细、更稳定
        const placeholder = document.createElement('div');
        placeholder.className = 'status-insert-placeholder';
        placeholder.style.cssText = `
            height: 3px;
            background: var(--b3-theme-primary);
            border-radius: 2px;
            margin: 6px 0;
            display: none;
            transition: opacity 120ms ease;
        `;
        statusesContainer.appendChild(placeholder);

        // 拖拽计数器，避免子元素触发导致闪烁
        let dragCounter = 0;
        let draggedStatusId: string | null = null;

        // 当拖入容器时增加计数
        statusesContainer.addEventListener('dragenter', (ev: DragEvent) => {
            ev.preventDefault();
            dragCounter++;
        });

        // 当拖离容器时检测是否真正离开（relatedTarget 不在容器内）
        statusesContainer.addEventListener('dragleave', (ev: DragEvent) => {
            const related = (ev as any).relatedTarget as HTMLElement | null;
            if (!related || !statusesContainer.contains(related)) {
                dragCounter = 0;
                placeholder.style.display = 'none';
            } else {
                dragCounter = Math.max(0, dragCounter - 1);
            }
        });

        // 更稳健的 dragover：根据每个项的中点计算插入位置，避免因子节点触发导致闪烁
        statusesContainer.addEventListener('dragover', (ev: DragEvent) => {
            ev.preventDefault();
            const items = Array.from(statusesContainer.querySelectorAll('.status-item')) as HTMLElement[];
            if (items.length === 0) {
                statusesContainer.appendChild(placeholder);
                placeholder.style.display = 'block';
                return;
            }

            let inserted = false;
            for (const item of items) {
                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (ev.clientY < midY) {
                    item.parentElement!.insertBefore(placeholder, item);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) {
                statusesContainer.appendChild(placeholder);
            }
            placeholder.style.display = 'block';
        });

        // 处理放下事件：根据占位符位置重新排列 statuses 数组并保存
        statusesContainer.addEventListener('drop', async (ev: DragEvent) => {
            ev.preventDefault();
            placeholder.style.display = 'none';
            dragCounter = 0;
            const data = ev.dataTransfer?.getData('text/status-id') || ev.dataTransfer?.getData('text');
            if (!data) return;
            const draggedId = data as string;

            // 计算占位符之前有多少个 status-item，用作插入索引
            let beforeCount = 0;
            for (const child of Array.from(statusesContainer.children)) {
                if (child === placeholder) break;
                const el = child as HTMLElement;
                if (el.classList && el.classList.contains('status-item')) beforeCount++;
            }
            const insertIndex = beforeCount;

            // 在原数组中移动元素
            const fromIndex = statuses.findIndex(s => s.id === draggedId);
            if (fromIndex === -1) return;
            const [moved] = statuses.splice(fromIndex, 1);
            statuses.splice(insertIndex, 0, moved);
            // 重新分配排序值
            statuses.forEach((s, i) => { s.sort = i * 10; });
            // 保存并刷新
            await projectManager.setProjectKanbanStatuses(this.projectId, statuses);
            renderStatuses();
            this.kanbanStatuses = statuses;
            this._lastRenderedProjectId = null;
            this.queueLoadTasks();
            showMessage(i18n('statusOrderSaved') || '状态顺序已保存');
        });

        // 渲染状态列表
        const renderStatuses = async () => {
            statusesContainer.innerHTML = '';

            if (statuses.length === 0) {
                statusesContainer.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6; padding: 20px;">${i18n('noStatuses') || '暂无状态'}</div>`;
                return;
            }

            statuses.forEach((status, index) => {
                const statusItem = document.createElement('div');
                statusItem.className = 'status-item';
                statusItem.dataset.statusId = status.id;
                statusItem.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    margin-bottom: 8px;
                    background: var(--b3-theme-surface-lighter);
                    border: 1px solid var(--b3-theme-border);
                    border-radius: 8px;
                    transition: all 0.2s ease;
                `;

                // 允许拖拽排序
                statusItem.draggable = true;
                statusItem.addEventListener('dragstart', (e: DragEvent) => {
                    draggedStatusId = status.id;
                    try {
                        e.dataTransfer?.setData('text/status-id', status.id);
                    } catch (err) { }
                    e.dataTransfer!.effectAllowed = 'move';
                    statusItem.classList.add('dragging');
                    // 可选：使用克隆节点作为拖动图像
                    try {
                        const dragImage = statusItem.cloneNode(true) as HTMLElement;
                        dragImage.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                        dragImage.style.transform = 'scale(0.98)';
                        dragImage.style.position = 'absolute';
                        dragImage.style.top = '-9999px';
                        document.body.appendChild(dragImage);
                        e.dataTransfer?.setDragImage(dragImage, 10, 10);
                        setTimeout(() => document.body.removeChild(dragImage), 0);
                    } catch (err) { }
                });
                statusItem.addEventListener('dragend', () => {
                    draggedStatusId = null;
                    statusItem.classList.remove('dragging');
                    placeholder.style.display = 'none';
                });

                // 拖拽手柄（所有状态都支持排序）
                const dragHandle = document.createElement('span');
                dragHandle.innerHTML = '⋮⋮';
                dragHandle.style.cssText = `
                    font-size: 14px;
                    color: var(--b3-theme-on-surface);
                    opacity: 0.6;
                    cursor: move;
                    padding: 2px 4px;
                    user-select: none;
                `;
                dragHandle.title = i18n('dragToSort') || '拖拽排序';
                statusItem.appendChild(dragHandle);

                // 颜色圆点
                const colorDot = document.createElement('span');
                colorDot.style.cssText = `
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background: ${status.color};
                    border: 2px solid var(--b3-theme-surface);
                    box-shadow: 0 0 0 1px var(--b3-theme-border);
                    flex-shrink: 0;
                `;
                statusItem.appendChild(colorDot);

                // 图标
                const iconSpan = document.createElement('span');
                iconSpan.textContent = status.icon || '';
                iconSpan.style.cssText = `
                    font-size: 16px;
                    flex-shrink: 0;
                    margin-left: 4px;
                `;
                statusItem.appendChild(iconSpan);

                // 状态名称
                const nameSpan = document.createElement('span');
                nameSpan.textContent = status.name + (status.isFixed ? ` (${i18n('fixed') || '固定'})` : '');
                nameSpan.style.cssText = `
                    flex: 1;
                    font-weight: 500;
                    color: var(--b3-theme-on-surface);
                    margin-left: 4px;
                `;
                statusItem.appendChild(nameSpan);

                // 操作按钮组
                const actionsDiv = document.createElement('div');
                actionsDiv.style.cssText = 'display: flex; gap: 4px; align-items: center;';

                // 上移按钮（所有状态都可以排序，只要不是第一个）
                if (index > 0) {
                    const moveUpBtn = document.createElement('button');
                    moveUpBtn.className = 'b3-button b3-button--text';
                    moveUpBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconUp"></use></svg>';
                    moveUpBtn.title = i18n('moveUp') || '上移';
                    moveUpBtn.style.cssText = 'padding: 2px; min-width: unset;';
                    moveUpBtn.addEventListener('click', async () => {
                        const currentIndex = statuses.findIndex(s => s.id === status.id);
                        if (currentIndex > 0) {
                            // 交换位置
                            [statuses[currentIndex], statuses[currentIndex - 1]] = [statuses[currentIndex - 1], statuses[currentIndex]];
                            // 重新分配排序值
                            statuses.forEach((s, i) => { s.sort = i * 10; });
                            // 保存
                            await projectManager.setProjectKanbanStatuses(this.projectId, statuses);
                            // 刷新列表
                            renderStatuses();
                            // 刷新看板 - 强制重新创建列
                            this.kanbanStatuses = statuses;
                            this._lastRenderedProjectId = null; // 强制重新创建列
                            this.queueLoadTasks();
                        }
                    });
                    actionsDiv.appendChild(moveUpBtn);
                }

                // 下移按钮（所有状态都可以排序，只要不是最后一个）
                if (index < statuses.length - 1) {
                    const moveDownBtn = document.createElement('button');
                    moveDownBtn.className = 'b3-button b3-button--text';
                    moveDownBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconDown"></use></svg>';
                    moveDownBtn.title = i18n('moveDown') || '下移';
                    moveDownBtn.style.cssText = 'padding: 2px; min-width: unset;';
                    moveDownBtn.addEventListener('click', async () => {
                        const currentIndex = statuses.findIndex(s => s.id === status.id);
                        if (currentIndex < statuses.length - 1) {
                            // 交换位置
                            [statuses[currentIndex], statuses[currentIndex + 1]] = [statuses[currentIndex + 1], statuses[currentIndex]];
                            // 重新分配排序值
                            statuses.forEach((s, i) => { s.sort = i * 10; });
                            // 保存
                            await projectManager.setProjectKanbanStatuses(this.projectId, statuses);
                            // 刷新列表
                            renderStatuses();
                            // 刷新看板 - 强制重新创建列
                            this.kanbanStatuses = statuses;
                            this._lastRenderedProjectId = null; // 强制重新创建列
                            this.queueLoadTasks();
                        }
                    });
                    actionsDiv.appendChild(moveDownBtn);
                }

                // 编辑按钮（所有状态都可以编辑颜色和排序，固定状态不能修改名称）
                const editBtn = document.createElement('button');
                editBtn.className = 'b3-button b3-button--text';
                editBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconEdit"></use></svg>';
                editBtn.title = status.isFixed ? (i18n('editColor') || '编辑颜色') : (i18n('edit') || '编辑');
                editBtn.style.cssText = 'padding: 2px; min-width: unset;';
                editBtn.addEventListener('click', () => showEditStatusDialog(status));
                actionsDiv.appendChild(editBtn);

                // 删除按钮（仅非固定状态可删除）
                if (!status.isFixed) {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'b3-button b3-button--text';
                    deleteBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px; color: var(--b3-theme-error);"><use xlink:href="#iconTrashcan"></use></svg>';
                    deleteBtn.title = i18n('delete') || '删除';
                    deleteBtn.style.cssText = 'padding: 2px; min-width: unset;';
                    deleteBtn.addEventListener('click', () => {
                        const confirmMsg = i18n('confirmDeleteStatus', { name: status.name }) || `确定要删除状态"${status.name}"吗？`;
                        confirm('确认删除', confirmMsg, async () => {
                            // 检查该状态下是否有任务
                            const tasksInStatus = this.tasks.filter(t => this.getTaskStatus(t) === status.id);

                            if (tasksInStatus.length > 0) {
                                // 有任务，显示选择目标状态的弹窗
                                // 排除已完成状态，因为未完成任务不应该移动到已完成
                                const otherStatuses = statuses.filter(s => s.id !== status.id && s.id !== 'completed');
                                if (otherStatuses.length === 0) {
                                    showMessage('没有其他未完成状态可以移动任务');
                                    return;
                                }

                                // 默认选择第一个非进行中的状态，如果没有则选择进行中
                                let defaultTargetStatus = otherStatuses.find(s => s.id !== 'doing');
                                if (!defaultTargetStatus) {
                                    defaultTargetStatus = otherStatuses[0];
                                }

                                // 创建选择目标状态的对话框
                                const moveDialog = new Dialog({
                                    title: `移动任务 (${tasksInStatus.length}个)`,
                                    content: `
                                        <div class="b3-dialog__content">
                                            <div class="b3-form__group">
                                                <label class="b3-form__label">选择目标状态</label>
                                                <select id="targetStatusSelect" class="b3-select" style="width: 100%;">
                                                    ${otherStatuses.map(s => `<option value="${s.id}" ${s.id === defaultTargetStatus?.id ? 'selected' : ''}>${s.icon || ''} ${s.name}</option>`).join('')}
                                                </select>
                                                <div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 4px;">
                                                    该状态下的 ${tasksInStatus.length} 个任务将被移动到选定的状态
                                                </div>
                                            </div>
                                        </div>
                                        <div class="b3-dialog__action">
                                            <button class="b3-button b3-button--cancel" id="cancelMoveBtn">取消</button>
                                            <button class="b3-button b3-button--primary" id="confirmMoveBtn">确定</button>
                                        </div>
                                    `,
                                    width: "360px",
                                    height: "auto"
                                });

                                moveDialog.element.querySelector('#cancelMoveBtn')?.addEventListener('click', () => {
                                    moveDialog.destroy();
                                });

                                moveDialog.element.querySelector('#confirmMoveBtn')?.addEventListener('click', async () => {
                                    const targetStatusSelect = moveDialog.element.querySelector('#targetStatusSelect') as HTMLSelectElement;
                                    const targetStatusId = targetStatusSelect.value;

                                    // 移动任务到目标状态 - 批量处理
                                    const tasksToUpdate = [];
                                    for (const task of tasksInStatus) {
                                        // 修改状态
                                        if (targetStatusId === 'completed') {
                                            task.kanbanStatus = 'completed';
                                            task.completed = true;
                                            task.completedTime = getLocalDateTimeString(new Date());
                                        } else if (targetStatusId === 'doing') {
                                            task.completed = false;
                                            task.completedTime = undefined;
                                            task.kanbanStatus = 'doing';
                                        } else {
                                            task.completed = false;
                                            task.completedTime = undefined;
                                            task.kanbanStatus = targetStatusId;
                                        }
                                        tasksToUpdate.push(task);
                                    }

                                    // 批量保存任务
                                    await this.saveTasks(tasksToUpdate);

                                    moveDialog.destroy();

                                    // 继续删除状态并刷新列表
                                    statuses = await this.deleteStatusAndRefresh(statuses, status.id, projectManager);
                                    renderStatuses();
                                });
                            } else {
                                // 没有任务，直接删除状态并刷新列表
                                statuses = await this.deleteStatusAndRefresh(statuses, status.id, projectManager);
                                renderStatuses();
                            }
                        });
                    });
                    actionsDiv.appendChild(deleteBtn);
                }

                statusItem.appendChild(actionsDiv);
                statusesContainer.appendChild(statusItem);
            });
        };

        // 显示编辑状态对话框
        const showEditStatusDialog = (status: import('../utils/projectManager').KanbanStatus) => {
            const isFixed = status.isFixed;
            const editDialog = new Dialog({
                title: isFixed ? (i18n('editStatusColor') || '编辑状态颜色') : (i18n('editStatus') || '编辑状态'),
                content: `
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('statusName') || '状态名称'}</label>
                            <input type="text" id="editStatusName" class="b3-text-field" value="${status.name}" style="width: 100%;" ${isFixed ? 'disabled readonly' : ''}>
                            ${isFixed ? `<div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 4px;">${i18n('fixedStatusCannotRename') || '固定状态不支持修改名称'}</div>` : ''}
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('statusIcon') || '状态图标'} <span style="font-weight: normal; color: var(--b3-theme-on-surface-light);">(${i18n('optional') || '可选'})</span></label>
                            <input type="text" id="editStatusIcon" class="b3-text-field" value="${status.icon || ''}" placeholder="${i18n('emojiIconExample') || '例如: 📋'}" style="width: 100%;">
                            <div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 4px;">${i18n('statusIconHint') || '使用 emoji 作为状态图标，留空则不显示图标'}</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('statusColor') || '状态颜色'}</label>
                            <input type="color" id="editStatusColor" class="b3-text-field" value="${status.color}" style="width: 100%; height: 40px;">
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="cancelEditBtn">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="saveEditBtn">${i18n('save')}</button>
                    </div>
                `,
                width: "360px",
                height: "auto"
            });

            const nameInput = editDialog.element.querySelector('#editStatusName') as HTMLInputElement;
            const iconInput = editDialog.element.querySelector('#editStatusIcon') as HTMLInputElement;
            const colorInput = editDialog.element.querySelector('#editStatusColor') as HTMLInputElement;

            editDialog.element.querySelector('#cancelEditBtn')?.addEventListener('click', () => {
                editDialog.destroy();
            });

            editDialog.element.querySelector('#saveEditBtn')?.addEventListener('click', async () => {
                const newName = nameInput.value.trim();
                const newIcon = iconInput.value.trim();
                const newColor = colorInput.value;

                // 固定状态不验证名称（因为不能修改）
                if (!isFixed && !newName) {
                    showMessage(i18n('pleaseEnterStatusName') || '请输入状态名称');
                    return;
                }

                // 更新状态
                const index = statuses.findIndex(s => s.id === status.id);
                if (index !== -1) {
                    // 固定状态只更新颜色和图标，不更新名称
                    if (!isFixed) {
                        statuses[index].name = newName;
                    }
                    statuses[index].icon = newIcon || undefined;
                    statuses[index].color = newColor;
                    // 保存
                    await projectManager.setProjectKanbanStatuses(this.projectId, statuses);
                    // 刷新列表
                    renderStatuses();
                    // 刷新看板 - 强制重新创建列
                    this.kanbanStatuses = statuses;
                    this._lastRenderedProjectId = null; // 强制重新创建列
                    this.queueLoadTasks();
                    showMessage(i18n('statusUpdated') || '状态已更新');
                }

                editDialog.destroy();
            });
        };

        // 显示新增状态对话框
        addStatusBtn.addEventListener('click', () => {
            const addDialog = new Dialog({
                title: i18n('newStatus') || '新增状态',
                content: `
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('statusName') || '状态名称'}</label>
                            <input type="text" id="newStatusName" class="b3-text-field" placeholder="${i18n('pleaseEnterStatusName') || '请输入状态名称'}" style="width: 100%;">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('statusIcon') || '状态图标'} <span style="font-weight: normal; color: var(--b3-theme-on-surface-light);">(${i18n('optional') || '可选'})</span></label>
                            <input type="text" id="newStatusIcon" class="b3-text-field" placeholder="${i18n('emojiIconExample') || '例如: 📋'}" style="width: 100%;">
                            <div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 4px;">${i18n('statusIconHint') || '使用 emoji 作为状态图标，留空则不显示图标'}</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('statusColor') || '状态颜色'}</label>
                            <input type="color" id="newStatusColor" class="b3-text-field" value="#3498db" style="width: 100%; height: 40px;">
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="cancelAddBtn">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="confirmAddBtn">${i18n('save')}</button>
                    </div>
                `,
                width: "360px",
                height: "auto"
            });

            const nameInput = addDialog.element.querySelector('#newStatusName') as HTMLInputElement;
            const iconInput = addDialog.element.querySelector('#newStatusIcon') as HTMLInputElement;
            const colorInput = addDialog.element.querySelector('#newStatusColor') as HTMLInputElement;

            addDialog.element.querySelector('#cancelAddBtn')?.addEventListener('click', () => {
                addDialog.destroy();
            });

            addDialog.element.querySelector('#confirmAddBtn')?.addEventListener('click', async () => {
                const name = nameInput.value.trim();
                const icon = iconInput.value.trim();
                const color = colorInput.value;

                if (!name) {
                    showMessage(i18n('pleaseEnterStatusName') || '请输入状态名称');
                    return;
                }

                // 检查是否已存在相同名称
                if (statuses.some(s => s.name === name)) {
                    showMessage(i18n('statusNameExists') || '状态名称已存在');
                    return;
                }

                // 创建新状态
                const newStatus: import('../utils/projectManager').KanbanStatus = {
                    id: projectManager.generateKanbanStatusId(),
                    name,
                    color,
                    icon: icon || undefined,
                    isFixed: false,
                    sort: statuses.length * 10
                };

                statuses.push(newStatus);
                // 保存
                await projectManager.setProjectKanbanStatuses(this.projectId, statuses);
                // 刷新列表
                renderStatuses();
                // 刷新看板 - 强制重新创建列
                this.kanbanStatuses = statuses;
                this._lastRenderedProjectId = null; // 强制重新创建列
                this.queueLoadTasks();
                showMessage(i18n('statusCreated') || '状态已创建');

                addDialog.destroy();
            });
        });

        // 初始渲染
        renderStatuses();
    }

    /**
     * 删除状态并刷新看板
     * 返回更新后的状态数组
     */
    private async deleteStatusAndRefresh(
        currentStatuses: import('../utils/projectManager').KanbanStatus[],
        statusIdToDelete: string,
        projectManager: import('../utils/projectManager').ProjectManager
    ): Promise<import('../utils/projectManager').KanbanStatus[]> {
        // 删除状态
        const updatedStatuses = currentStatuses.filter(s => s.id !== statusIdToDelete);
        // 重新分配排序值
        updatedStatuses.forEach((s, i) => { s.sort = i * 10; });
        // 保存
        await projectManager.setProjectKanbanStatuses(this.projectId, updatedStatuses);
        // 刷新看板状态
        this.kanbanStatuses = updatedStatuses;
        this._lastRenderedProjectId = null; // 强制重新创建列
        await this.queueLoadTasks();
        showMessage(i18n('statusDeleted') || '状态已删除');
        return updatedStatuses;
    }


    private async showManageTagsDialog() {
        const dialog = new Dialog({
            title: i18n('manageProjectTags'),
            content: `
                <div class="manage-tags-dialog">
                    <div class="b3-dialog__content">
                        <div class="tags-list" style="margin-bottom: 16px;">
                            <div class="tags-header" style="display: flex; justify-content: space-between; align-items: center;">
                                <h4 style="margin: 0;">${i18n('existingTags')}</h4>
                                <button id="addTagBtn" class="b3-button b3-button--small b3-button--primary">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newTag')}
                                </button>
                            </div>
                            <div id="tagsContainer" class="tags-container" style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px;">
                                <!-- 标签列表将在这里动态生成 -->
                            </div>
                        </div>
                    </div>
                </div>
            `,
            width: "600px",
            height: "auto"
        });

        const tagsContainer = dialog.element.querySelector('#tagsContainer') as HTMLElement;
        const addTagBtn = dialog.element.querySelector('#addTagBtn') as HTMLButtonElement;

        // 加载并显示现有标签
        const loadAndDisplayTags = async () => {
            try {
                const projectManager = this.projectManager;
                const projectTags = await projectManager.getProjectTags(this.projectId);

                tagsContainer.innerHTML = '';

                if (projectTags.length === 0) {
                    tagsContainer.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6; padding: 20px; width: 100%;">${i18n('noTags')}</div>`;
                    return;
                }

                projectTags.forEach((tag: { id: string, name: string, color: string }) => {
                    const tagItem = document.createElement('div');
                    tagItem.className = 'tag-item';
                    tagItem.style.cssText = `
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        padding: 6px 12px;
                        background: ${tag.color}20;
                        border: 1px solid ${tag.color};
                        border-radius: 16px;
                        font-size: 14px;
                        color: var(--b3-theme-on-surface);
                        cursor: pointer;
                    `;

                    const tagText = document.createElement('span');
                    tagText.textContent = `#${tag.name}`;
                    tagItem.appendChild(tagText);

                    // 编辑按钮
                    const editBtn = document.createElement('button');
                    editBtn.className = 'b3-button b3-button--text';
                    editBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconEdit"></use></svg>';
                    editBtn.title = i18n('edit');
                    editBtn.style.cssText = `
                        padding: 2px;
                        min-width: unset;
                        opacity: 0.6;
                    `;
                    editBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showEditTagDialog(tag);
                    });
                    tagItem.appendChild(editBtn);

                    // 删除按钮
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'b3-button b3-button--text';
                    deleteBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconClose"></use></svg>';
                    deleteBtn.title = i18n('delete');
                    deleteBtn.style.cssText = `
                        padding: 2px;
                        min-width: unset;
                        opacity: 0.6;
                    `;
                    deleteBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await deleteTag(tag.name);
                    });
                    tagItem.appendChild(deleteBtn);

                    tagsContainer.appendChild(tagItem);
                });
            } catch (error) {
                console.error('加载标签列表失败:', error);
                tagsContainer.innerHTML = '<div style="text-align: center; color: var(--b3-theme-error); padding: 20px;">加载标签失败</div>';
            }
        };

        // 删除标签
        const deleteTag = async (tagNameToDelete: string) => {
            try {
                const projectManager = this.projectManager;
                const projectTags = await projectManager.getProjectTags(this.projectId);

                const updatedTags = projectTags.filter(tag => tag.name !== tagNameToDelete);
                await projectManager.setProjectTags(this.projectId, updatedTags);

                await loadAndDisplayTags();
                showMessage(i18n('tagDeleted'));
            } catch (error) {
                console.error('删除标签失败:', error);
                showMessage(i18n('deleteTagFailed'));
            }
        };

        // 编辑标签对话框
        const showEditTagDialog = (existingTag: { id: string, name: string, color: string }) => {
            showTagEditDialog(existingTag, async (updatedTag) => {
                try {
                    const projectManager = this.projectManager;
                    const projectTags = await projectManager.getProjectTags(this.projectId);

                    const index = projectTags.findIndex(t => t.id === existingTag.id);
                    if (index !== -1) {
                        projectTags[index] = updatedTag;
                        await projectManager.setProjectTags(this.projectId, projectTags);
                        await loadAndDisplayTags();
                        showMessage(i18n('tagUpdated'));
                    }
                } catch (error) {
                    console.error('更新标签失败:', error);
                    showMessage(i18n('updateTagFailed'));
                }
            });
        };

        // 新建/编辑标签对话框
        const showTagEditDialog = (existingTag: { id: string, name: string, color: string } | null, onSave: (tag: { id: string, name: string, color: string }) => void) => {
            const isEdit = existingTag !== null;
            const defaultColor = existingTag?.color || '#3498db';
            const defaultName = existingTag?.name || '';

            const tagDialog = new Dialog({
                title: isEdit ? i18n('editTag') : i18n('newTag'),
                content: `
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('tagName')}</label>
                            <input type="text" id="tagNameInput" class="b3-text-field" placeholder="${i18n('pleaseEnterTagName')}" value="${defaultName}" style="width: 100%;">
                        </div>
                        <div class="b3-form__group" style="margin-top: 12px;">
                            <label class="b3-form__label">${i18n('tagColor')}</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="color" id="tagColorInput" value="${defaultColor}" style="width: 60px; height: 32px; border: 1px solid var(--b3-border-color); border-radius: 4px; cursor: pointer;">
                                <input type="text" id="tagColorText" class="b3-text-field" value="${defaultColor}" style="flex: 1;" readonly>
                                <div id="tagColorPreview" style="width: 80px; height: 32px; border-radius: 16px; border: 1px solid ${defaultColor}; background: ${defaultColor}20; display: flex; align-items: center; justify-content: center; font-size: 12px;">预览</div>
                            </div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="tagDialogCancel">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="tagDialogSave">${i18n('save')}</button>
                    </div>
                `,
                width: '400px'
            });

            const nameInput = tagDialog.element.querySelector('#tagNameInput') as HTMLInputElement;
            const colorInput = tagDialog.element.querySelector('#tagColorInput') as HTMLInputElement;
            const colorText = tagDialog.element.querySelector('#tagColorText') as HTMLInputElement;
            const colorPreview = tagDialog.element.querySelector('#tagColorPreview') as HTMLElement;
            const cancelBtn = tagDialog.element.querySelector('#tagDialogCancel') as HTMLButtonElement;
            const saveBtn = tagDialog.element.querySelector('#tagDialogSave') as HTMLButtonElement;

            // 颜色选择器变化
            colorInput.addEventListener('input', () => {
                const color = colorInput.value;
                colorText.value = color;
                colorPreview.style.borderColor = color;
                colorPreview.style.background = `${color}20`;
            });

            cancelBtn.addEventListener('click', () => tagDialog.destroy());

            saveBtn.addEventListener('click', async () => {
                const tagName = nameInput.value.trim();
                const tagColor = colorInput.value;

                if (!tagName) {
                    showMessage(i18n('pleaseEnterTagName'));
                    return;
                }

                // 检查标签名是否已存在（编辑时排除自己）
                if (!isEdit || tagName !== existingTag.name) {
                    const { ProjectManager } = await import('../utils/projectManager');
                    const projectManager = ProjectManager.getInstance(this.plugin);
                    const projectTags = await projectManager.getProjectTags(this.projectId);

                    if (projectTags.some(t => t.name === tagName)) {
                        showMessage(i18n('tagAlreadyExists'));
                        return;
                    }
                }

                // 生成ID（编辑时保留原ID，新建时生成新ID）
                const tagId = isEdit ? existingTag.id : `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                onSave({ id: tagId, name: tagName, color: tagColor });
                tagDialog.destroy();
            });
        };

        // 新建标签
        addTagBtn.addEventListener('click', () => {
            showTagEditDialog(null, async (newTag) => {
                try {
                    const projectManager = this.projectManager;
                    const projectTags = await projectManager.getProjectTags(this.projectId);

                    projectTags.push(newTag);
                    await projectManager.setProjectTags(this.projectId, projectTags);

                    await loadAndDisplayTags();
                    showMessage(i18n('tagCreated'));
                } catch (error) {
                    console.error('创建标签失败:', error);
                    showMessage(i18n('createTagFailed'));
                }
            });
        });

        // 初始加载标签
        await loadAndDisplayTags();
    }

    private async loadAndDisplayGroups(container: HTMLElement) {
        try {
            const projectManager = this.projectManager;
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);

            container.innerHTML = '';

            if (projectGroups.length === 0) {
                container.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6; padding: 20px;">${i18n('noCustomGroups')}</div>`;
                return;
            }

            // 按sort字段排序分组
            const sortedGroups = projectGroups.sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            // 添加拖拽排序样式
            container.style.cssText += `
                position: relative;
            `;

            sortedGroups.forEach((group: any) => {
                const groupItem = document.createElement('div');
                groupItem.className = 'group-item';
                // 标记 DOM 节点以便拖拽时可以识别并忽略自身
                groupItem.dataset.groupId = group.id;
                groupItem.style.cssText = `
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 16px;
                    margin-bottom: 8px;
                    background: var(--b3-theme-surface-lighter);
                    border: 1px solid var(--b3-theme-border);
                    border-radius: 8px;
                    transition: background-color 0.2s ease;
                    cursor: move;
                    min-height: 48px;
                `;

                const groupInfo = document.createElement('div');
                groupInfo.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex: 1;
                    min-width: 0;
                `;

                // 拖拽手柄
                const dragHandle = document.createElement('span');
                dragHandle.className = 'group-drag-handle';
                dragHandle.innerHTML = '⋮⋮';
                dragHandle.style.cssText = `
                    font-size: 14px;
                    color: var(--b3-theme-on-surface);
                    opacity: 0.6;
                    cursor: move;
                    padding: 4px 6px;
                    margin-right: 8px;
                    border-radius: 4px;
                    transition: all 0.2s ease;
                    user-select: none;
                `;
                dragHandle.title = '拖拽排序';

                // 添加悬停效果
                dragHandle.draggable = true;
                dragHandle.addEventListener('mouseenter', () => {
                    dragHandle.style.backgroundColor = 'var(--b3-theme-surface)';
                    dragHandle.style.opacity = '0.8';
                });

                dragHandle.addEventListener('mouseleave', () => {
                    dragHandle.style.backgroundColor = 'transparent';
                    dragHandle.style.opacity = '0.6';
                });

                // 在手柄上也绑定 dragstart/dragend，保证拖拽手柄触发拖拽行为
                dragHandle.addEventListener('dragstart', (e) => {
                    // 设置全局 draggedGroupId 并修改父项样式以反映拖拽
                    this.draggedGroupId = group.id;
                    groupItem.style.opacity = '0.5';
                    groupItem.style.cursor = 'grabbing';
                    if (e.dataTransfer) {
                        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', group.id); } catch (err) { }
                    }
                });

                dragHandle.addEventListener('dragend', () => {
                    this.draggedGroupId = null;
                    groupItem.style.opacity = '';
                    groupItem.style.cursor = 'move';
                    container.querySelectorAll('.group-drop-indicator').forEach(el => el.remove());
                });

                const groupIcon = document.createElement('span');
                groupIcon.textContent = group.icon || '📋';
                groupIcon.style.cssText = `
                    font-size: 18px;
                    flex-shrink: 0;
                `;

                const groupName = document.createElement('span');
                groupName.textContent = group.name;
                groupName.style.cssText = `
                    font-weight: 500;
                    color: var(--b3-theme-on-surface);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    flex: 1;
                `;
                groupName.title = group.name;

                const groupColor = document.createElement('div');
                groupColor.style.cssText = `
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background-color: ${group.color};
                    border: 2px solid var(--b3-theme-surface);
                    box-shadow: 0 0 0 1px var(--b3-theme-border);
                    flex-shrink: 0;
                `;

                groupInfo.appendChild(dragHandle);
                groupInfo.appendChild(groupIcon);
                groupInfo.appendChild(groupColor);
                groupInfo.appendChild(groupName);

                const groupActions = document.createElement('div');
                groupActions.style.cssText = `
                    display: flex;
                    gap: 8px;
                    align-items: center;
                `;

                const editBtn = document.createElement('button');
                editBtn.className = 'b3-button b3-button--small b3-button--outline';
                editBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>';
                editBtn.title = i18n('editGroup');
                editBtn.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    padding: 4px 8px;
                    font-size: 12px;
                `;
                editBtn.addEventListener('click', () => {
                    this.editGroup(group, groupItem, container);
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'b3-button b3-button--outline';
                deleteBtn.innerHTML = '<svg class="b3-button__icon" style="color: var(--b3-theme-error);"><use xlink:href="#iconTrashcan"></use></svg>';
                deleteBtn.title = i18n('deleteGroup');
                deleteBtn.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    padding: 4px 8px;
                    font-size: 12px;
                `;
                deleteBtn.addEventListener('click', () => {
                    this.deleteGroup(group.id, groupItem, container);
                });

                groupActions.appendChild(editBtn);
                groupActions.appendChild(deleteBtn);

                groupItem.appendChild(groupInfo);
                groupItem.appendChild(groupActions);

                container.appendChild(groupItem);

                // 添加悬停效果
                groupItem.addEventListener('mouseenter', () => {
                    groupItem.style.backgroundColor = 'var(--b3-theme-surface)';
                    groupItem.style.borderColor = 'var(--b3-theme-primary)';
                });

                groupItem.addEventListener('mouseleave', () => {
                    groupItem.style.backgroundColor = 'var(--b3-theme-surface-lighter)';
                    groupItem.style.borderColor = 'var(--b3-theme-border)';
                });

                // 添加拖拽排序功能
                this.addGroupDragAndDrop(groupItem, group, container);
            });

            // 容器级别的拖放支持：允许将分组拖到列表任意位置（包括末尾）
            // 只注册一次，避免重复绑定事件
            if (!container.dataset.hasDropHandlers) {
                container.dataset.hasDropHandlers = '1';

                container.addEventListener('dragover', (e) => {
                    try {
                        // 支持从 dataTransfer 或类字段回退获取被拖拽的分组 id
                        const dt = (e as DragEvent).dataTransfer;
                        if (!dt && !this.draggedGroupId) return;
                        let draggedId = '';
                        try {
                            if (dt) draggedId = dt.getData('text/plain') || '';
                        } catch (err) {
                            // dataTransfer 在某些环境可能受限，忽略错误并使用回退值
                            draggedId = '';
                        }
                        if (!draggedId) draggedId = this.draggedGroupId || '';
                        if (!draggedId) return;

                        e.preventDefault();
                        dt.dropEffect = 'move';

                        // 清除旧的临时指示器（但保留对 _groupDropIndicator 的管理，下面会重建）
                        container.querySelectorAll('.group-drop-indicator').forEach(el => el.remove());

                        // 获取子项并忽略当前被拖拽的项，防止自己影响插入位置计算
                        let children = Array.from(container.querySelectorAll('.group-item')) as HTMLElement[];
                        children = children.filter(c => (c.dataset.groupId || '') !== draggedId);

                        // 创建静态位置指示器并插入到合适位置
                        const createIndicator = (beforeEl: HTMLElement | null) => {
                            // 移除已有引用的指示器
                            if (this._groupDropIndicator && this._groupDropIndicator.parentNode) {
                                this._groupDropIndicator.parentNode.removeChild(this._groupDropIndicator);
                                this._groupDropIndicator = null;
                            }

                            const indicator = document.createElement('div');
                            indicator.className = 'group-drop-indicator';
                            indicator.style.cssText = `
                                height: 2px;
                                background-color: var(--b3-theme-primary);
                                margin: 4px 0;
                                border-radius: 2px;
                                box-shadow: 0 0 4px var(--b3-theme-primary);
                            `;
                            if (beforeEl) container.insertBefore(indicator, beforeEl);
                            else container.appendChild(indicator);

                            // 保存引用，方便 dragleave/drop 等处清理或重用
                            this._groupDropIndicator = indicator;
                        };

                        if (children.length === 0) {
                            createIndicator(null);
                            return;
                        }

                        // 根据 mouse Y 判断插入点（忽略被拖拽项）
                        const clientY = (e as DragEvent).clientY;
                        let inserted = false;
                        for (const child of children) {
                            const rect = child.getBoundingClientRect();
                            const midpoint = rect.top + rect.height / 2;
                            if (clientY < midpoint) {
                                createIndicator(child);
                                inserted = true;
                                break;
                            }
                        }

                        if (!inserted) {
                            // 放到末尾
                            createIndicator(null);
                        }
                    } catch (err) {
                        // ignore
                    }
                });

                container.addEventListener('dragleave', (e) => {
                    // 当真正离开容器时清除指示器
                    const related = (e as any).relatedTarget as Node;
                    if (!related || !container.contains(related)) {
                        container.querySelectorAll('.group-drop-indicator').forEach(el => el.remove());
                        if (this._groupDropIndicator && this._groupDropIndicator.parentNode) {
                            this._groupDropIndicator.parentNode.removeChild(this._groupDropIndicator);
                        }
                        this._groupDropIndicator = null;
                    }
                });

                container.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    container.querySelectorAll('.group-drop-indicator').forEach(el => el.remove());

                    let draggedGroupId = (e as DragEvent).dataTransfer?.getData('text/plain');
                    // 某些环境（如受限的 webview/iframe）可能无法通过 dataTransfer 传递数据，使用类字段作为回退
                    if (!draggedGroupId) draggedGroupId = this.draggedGroupId || '';
                    if (!draggedGroupId) return;

                    try {
                        const projectManager = this.projectManager;
                        const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                        const draggedIndex = currentGroups.findIndex((g: any) => g.id === draggedGroupId);
                        if (draggedIndex === -1) return;

                        // 计算插入索引（基于鼠标位置与当前子项中点比较）
                        const children = Array.from(container.querySelectorAll('.group-item')) as HTMLElement[];
                        const clientY = (e as DragEvent).clientY;
                        let insertIndex = children.length; // 默认末尾
                        for (let i = 0; i < children.length; i++) {
                            const rect = children[i].getBoundingClientRect();
                            const midpoint = rect.top + rect.height / 2;
                            if (clientY < midpoint) { insertIndex = i; break; }
                        }

                        // 从原数组移除并插入到目标位置
                        const draggedGroup = currentGroups.splice(draggedIndex, 1)[0];
                        const actualIndex = insertIndex;
                        currentGroups.splice(actualIndex, 0, draggedGroup);

                        // 重新分配排序值并保存
                        currentGroups.forEach((g: any, index: number) => { g.sort = index * 10; });
                        await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                        // 刷新界面（使用防抖队列以合并频繁变更）
                        await this.loadAndDisplayGroups(container);
                        this.queueLoadTasks();
                        showMessage('分组顺序已更新');
                    } catch (error) {
                        console.error('更新分组顺序失败:', error);
                        showMessage('更新分组顺序失败');
                    }
                });
            }
        } catch (error) {
            console.error('加载分组列表失败:', error);
            container.innerHTML = '<div style="text-align: center; color: var(--b3-theme-error); padding: 20px;">加载分组失败</div>';
        }
    }

    private async editGroup(group: any, _groupItem: HTMLElement, container: HTMLElement) {
        const dialog = new Dialog({
            title: i18n('editGroup'),
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('groupName')}</label>
                        <input type="text" id="editGroupName" class="b3-text-field" value="${group.name}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('bindBlockId')} (${i18n('optional')})</label>
                        <input type="text" id="editGroupBlockId" class="b3-text-field" value="${group.blockId || ''}" placeholder="${i18n('pleaseEnterBlockId')}" style="width: 100%;">
                        <div class="b3-label__text" style="margin-top: 4px; color: var(--b3-theme-on-surface-light);">${i18n('bindBlockIdHint')}</div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('groupColor')}</label>
                        <input type="color" id="editGroupColor" class="b3-text-field" value="${group.color}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('iconOptional')}</label>
                        <input type="text" id="editGroupIcon" class="b3-text-field" value="${group.icon || ''}" placeholder="${i18n('emojiIconExample')}" style="width: 100%;">
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="editCancelBtn">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="editSaveBtn">${i18n('save')}</button>
                </div>
            `,
            width: "400px"
        });

        const editGroupName = dialog.element.querySelector('#editGroupName') as HTMLInputElement;
        const editGroupBlockId = dialog.element.querySelector('#editGroupBlockId') as HTMLInputElement;
        const editGroupColor = dialog.element.querySelector('#editGroupColor') as HTMLInputElement;
        const editGroupIcon = dialog.element.querySelector('#editGroupIcon') as HTMLInputElement;
        const editCancelBtn = dialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const editSaveBtn = dialog.element.querySelector('#editSaveBtn') as HTMLButtonElement;

        editCancelBtn.addEventListener('click', () => dialog.destroy());

        editSaveBtn.addEventListener('click', async () => {
            const name = editGroupName.value.trim();
            const blockId = editGroupBlockId.value.trim();
            const color = editGroupColor.value;
            const icon = editGroupIcon.value.trim();

            if (!name) {
                showMessage('请输入分组名称');
                return;
            }

            try {
                // 获取当前项目的分组列表
                const projectManager = this.projectManager;
                const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                // 更新分组信息
                const groupIndex = currentGroups.findIndex((g: any) => g.id === group.id);
                if (groupIndex !== -1) {
                    currentGroups[groupIndex] = { ...currentGroups[groupIndex], name, color, icon, blockId: blockId || undefined };
                    await projectManager.setProjectCustomGroups(this.projectId, currentGroups);
                }

                // 刷新分组列表（更新对话框中的列表）
                await this.loadAndDisplayGroups(container);

                // 直接更新 Kanban DOM，避免重绘
                const columnId = `custom-group-${group.id}`;
                // kanban-column-{columnId} 是在 createCustomGroupColumn 中生成的
                const column = this.container.querySelector(`.kanban-column.kanban-column-${columnId}`) as HTMLElement;

                if (column) {
                    // 1. 更新列头背景
                    const header = column.querySelector('.kanban-column-header') as HTMLElement;
                    if (header) {
                        header.style.background = `${color}15`;
                    }

                    // 2. 更新列头标题区域（包含图标和标题）
                    // 这里的结构参考 createCustomGroupColumn 中的 titleContainer
                    // 需要找到 titleContainer，通常它是 header 的第一个子元素（包含 icon 和 h3）
                    const titleContainer = header.querySelector('div') as HTMLElement; // titleContainer 是 header 的第一个 div 子元素
                    if (titleContainer) {
                        titleContainer.innerHTML = '';

                        // 重建图标
                        const groupIconEl = document.createElement('span');
                        groupIconEl.className = 'custom-group-header-icon';
                        groupIconEl.style.cssText = `margin-right:6px;`;
                        groupIconEl.textContent = icon || '📋';
                        titleContainer.appendChild(groupIconEl);

                        // 重建标题
                        const titleEl = document.createElement('h3');
                        titleEl.textContent = name;
                        titleEl.style.cssText = `
                            margin: 0;
                            font-size: 16px;
                            font-weight: 600;
                            color: ${color};
                        `;

                        // 处理 Block ID 绑定
                        const newBlockId = blockId || undefined;
                        if (newBlockId) {
                            titleEl.dataset.type = 'a';
                            titleEl.dataset.href = `siyuan://blocks/${newBlockId}`;
                            titleEl.style.cursor = 'pointer';
                            titleEl.style.textDecoration = 'underline dotted';
                            titleEl.style.paddingBottom = '2px';
                            titleEl.title = i18n('clickToJumpToBlock');
                            titleEl.addEventListener('click', (e) => {
                                e.stopPropagation();
                                openBlock(newBlockId);
                            });
                        }

                        titleContainer.appendChild(titleEl);
                    }

                    // 3. 更新计数的背景色
                    const countEl = column.querySelector('.kanban-column-count') as HTMLElement;
                    if (countEl) {
                        countEl.style.background = color;
                    }

                    // 4. 更新子分组（进行中、短期、长期等）的样式
                    // 这些是在 renderCustomGroupColumnWithStatuses 中创建的
                    const subGroupHeaders = column.querySelectorAll('.custom-status-group-header') as NodeListOf<HTMLElement>;
                    subGroupHeaders.forEach(sh => {
                        sh.style.background = `${color}15`;
                        sh.style.border = `1px solid ${color}30`;
                    });
                }

                showMessage(i18n('groupUpdated'));
                dialog.destroy();
            } catch (error) {
                console.error('更新分组失败:', error);
                showMessage(i18n('updateGroupFailed'));
            }
        });
    }

    private async deleteGroup(groupId: string, _groupItem: HTMLElement, container: HTMLElement) {
        // 获取分组信息用于显示名称
        const projectManager = this.projectManager;
        const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
        const groupToDelete = projectGroups.find((g: any) => g.id === groupId);

        if (!groupToDelete) {
            showMessage(i18n('groupNotExist'));
            return;
        }

        // 获取其他可用的分组
        const otherGroups = projectGroups.filter((g: any) => g.id !== groupId);

        // 检查该分组下是否有任务
        const reminderData = await this.getReminders();
        const tasksInGroup = Object.values(reminderData).filter((task: any) =>
            task && task.projectId === this.projectId && task.customGroupId === groupId
        );

        const hasTasks = tasksInGroup.length > 0;

        let confirmMessage = i18n('confirmDeleteGroup', { name: groupToDelete.name });

        if (hasTasks) {
            confirmMessage += `\n\n${i18n('groupHasTasks', { count: String(tasksInGroup.length) })}`;
        }

        const dialog = new Dialog({
            title: i18n('deleteGroup'),
            content: `
                <div class="delete-group-dialog" style="padding: 16px;">
                    <div class="b3-dialog__content">
                        <p style="margin-bottom: 16px; white-space: pre-wrap;">${confirmMessage}</p>
                        ${hasTasks ? `
                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n('taskAction')}</label>
                                <div class="b3-form__group" style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
                                    <label class="b3-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                        <input type="radio" name="taskAction" value="ungroup" checked class="b3-radio">
                                        <span>${i18n('setTasksUngrouped')}</span>
                                    </label>
                                    <label class="b3-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                        <input type="radio" name="taskAction" value="delete" class="b3-radio">
                                        <span>${i18n('deleteAllTasks')}</span>
                                    </label>
                                    ${otherGroups.length > 0 ? `
                                        <div style="display: flex; flex-direction: column; gap: 4px;">
                                            <label class="b3-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                                <input type="radio" name="taskAction" value="move" class="b3-radio" id="moveActionRadio">
                                                <span>${i18n('moveTasksToOtherGroup')}</span>
                                            </label>
                                            <select id="targetGroupSelect" class="b3-select fn__flex-1" style="margin-left: 24px; visibility: hidden;">
                                                ${otherGroups.map((g: any) => `<option value="${g.id}">${g.name}</option>`).join('')}
                                            </select>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div class="b3-dialog__action" style="margin-top: 24px;">
                        <button class="b3-button b3-button--cancel" id="deleteCancelBtn">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--error" id="deleteConfirmBtn">${i18n('deleteGroup')}</button>
                    </div>
                </div>
            `,
            width: "450px"
        });

        if (hasTasks && otherGroups.length > 0) {
            const moveRadio = dialog.element.querySelector('#moveActionRadio') as HTMLInputElement;
            const targetSelect = dialog.element.querySelector('#targetGroupSelect') as HTMLSelectElement;
            const radios = dialog.element.querySelectorAll('input[name="taskAction"]');

            radios.forEach(radio => {
                radio.addEventListener('change', () => {
                    targetSelect.style.visibility = moveRadio.checked ? 'visible' : 'hidden';
                });
            });
        }

        const deleteCancelBtn = dialog.element.querySelector('#deleteCancelBtn') as HTMLButtonElement;
        const deleteConfirmBtn = dialog.element.querySelector('#deleteConfirmBtn') as HTMLButtonElement;

        deleteCancelBtn.addEventListener('click', () => dialog.destroy());

        deleteConfirmBtn.addEventListener('click', async () => {
            try {
                let taskAction: 'ungroup' | 'delete' | 'move' = 'ungroup';
                let targetGroupId: string | null = null;

                if (hasTasks) {
                    const selectedAction = dialog.element.querySelector('input[name="taskAction"]:checked') as HTMLInputElement;
                    taskAction = selectedAction.value as 'ungroup' | 'delete' | 'move';
                    if (taskAction === 'move') {
                        const targetSelect = dialog.element.querySelector('#targetGroupSelect') as HTMLSelectElement;
                        targetGroupId = targetSelect.value;
                    }
                }

                // 从项目数据中移除分组
                const updatedGroups = projectGroups.filter((g: any) => g.id !== groupId);
                await projectManager.setProjectCustomGroups(this.projectId, updatedGroups);

                // 处理分组下的任务
                if (hasTasks) {
                    if (taskAction === 'delete') {
                        // 删除所有任务
                        for (const task of tasksInGroup) {
                            const taskData = task as any;
                            delete reminderData[taskData.id];
                        }
                        showMessage(i18n('groupDeletedWithTasks', { count: String(tasksInGroup.length) }));
                    } else if (taskAction === 'move' && targetGroupId) {
                        // 转移到其他分组
                        for (const task of tasksInGroup) {
                            const taskData = task as any;
                            taskData.customGroupId = targetGroupId;
                        }
                        showMessage(i18n('groupDeletedTasksMoved', { count: String(tasksInGroup.length) }));
                    } else {
                        // 默认为 ungroup (包括 move 到无效目标或 ungroup 选项)
                        // 将任务设为未分组
                        for (const task of tasksInGroup) {
                            const taskData = task as any;
                            delete taskData.customGroupId;
                        }
                        showMessage(i18n('groupDeletedTasksUngrouped', { count: String(tasksInGroup.length) }));
                    }

                    // 保存任务数据
                    await saveReminders(this.plugin, reminderData);
                    this.dispatchReminderUpdate(true);
                } else {
                    showMessage(i18n('groupDeleted'));
                }

                // 刷新分组列表
                await this.loadAndDisplayGroups(container);

                // 强制触发看板重绘
                this._lastRenderedProjectId = null;
                // 刷新看板（使用防抖队列）
                this.queueLoadTasks();

                dialog.destroy();
            } catch (error) {
                console.error('删除分组失败:', error);
                showMessage(i18n('deleteGroupFailed'));
                dialog.destroy();
            }
        });
    }

    private initUI() {
        this.container.classList.add('project-kanban-view');
        this.container.innerHTML = '';

        // 创建工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'project-kanban-toolbar';
        this.container.appendChild(toolbar);

        // 项目标题
        const titleContainer = document.createElement('div');
        titleContainer.className = 'project-kanban-title';

        const titleEl = document.createElement('h2');
        titleEl.textContent = this.project?.title || i18n('projectKanban');
        titleEl.style.cssText = `
            margin: 0;
            font-size: 18px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        `;

        // 如果项目有关联的笔记ID，添加点击跳转功能
        if (this.project?.blockId) {
            titleEl.style.cursor = 'pointer';
            titleEl.style.textDecoration = 'underline dotted';
            titleEl.style.textDecorationStyle = 'dotted';
            titleEl.title = i18n('clickToJumpToProjectNote');
            titleEl.setAttribute('data-has-note', 'true');

            titleEl.addEventListener('click', () => {
                this.openProjectNote(this.project.blockId);
            });

            titleEl.addEventListener('mouseenter', () => {
                titleEl.style.color = 'var(--b3-theme-primary)';
            });

            titleEl.addEventListener('mouseleave', () => {
                titleEl.style.color = 'var(--b3-theme-on-background)';
            });
        }

        titleContainer.appendChild(titleEl);

        // 项目描述
        if (this.project?.note) {
            const descEl = document.createElement('div');
            descEl.className = 'project-kanban-description';
            descEl.textContent = this.project.note;
            descEl.style.cssText = `
                margin-top: 4px;
                font-size: 14px;
                color: var(--b3-theme-on-surface);
                opacity: 0.8;
            `;
            titleContainer.appendChild(descEl);
        }

        toolbar.appendChild(titleContainer);

        // 控制按钮组
        const controlsGroup = document.createElement('div');
        controlsGroup.className = 'project-kanban-controls';
        controlsGroup.style.cssText = `
            display: flex;
            align-items: center;
        `;

        // 新建任务按钮
        const addTaskBtn = document.createElement('button');
        addTaskBtn.className = 'b3-button b3-button--primary';
        addTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newTask')}`;
        addTaskBtn.addEventListener('click', () => this.showCreateTaskDialog());
        controlsGroup.appendChild(addTaskBtn);

        const pasteTaskBtn = document.createElement('button');
        pasteTaskBtn.className = 'b3-button';
        pasteTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg> ${i18n('pasteNew')}`;
        pasteTaskBtn.addEventListener('click', () => this.showPasteTaskDialog(undefined, undefined, undefined, true));
        controlsGroup.appendChild(pasteTaskBtn);

        // 排序按钮
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'b3-button b3-button--outline';
        this.sortButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        this.sortButton.addEventListener('click', (e) => this.showSortMenu(e));
        controlsGroup.appendChild(this.sortButton);

        // 搜索按钮和输入框
        const searchContainer = document.createElement('div');
        searchContainer.className = 'kanban-search-container';
        searchContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            position: relative;
        `;

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'b3-text-field search-input';
        searchInput.placeholder = i18n('searchReminders');
        searchInput.style.cssText = `
            width: 0;
            padding: 4px 0;
            border: none;
            transition: all 0.2s ease-in-out;
            opacity: 0;
            visibility: hidden;
            font-size: 14px;
            background: var(--b3-theme-surface);
            color: var(--b3-theme-on-surface);
        `;
        this.searchInput = searchInput;

        const searchBtn = document.createElement('button');
        searchBtn.className = 'b3-button b3-button--outline search-btn';
        searchBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSearch"></use></svg>';
        searchBtn.title = i18n('searchReminders');

        searchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = searchInput.style.visibility === 'hidden';
            if (isHidden) {
                searchInput.style.width = '150px';
                searchInput.style.padding = '4px 8px';
                searchInput.style.opacity = '1';
                searchInput.style.visibility = 'visible';
                searchInput.focus();
            } else {
                searchInput.style.width = '0';
                searchInput.style.padding = '4px 0';
                searchInput.style.opacity = '0';
                setTimeout(() => { searchInput.style.visibility = 'hidden'; }, 200);
                if (this.searchKeyword) {
                    this.searchKeyword = '';
                    searchInput.value = '';
                    this.queueLoadTasks();
                }
            }
        });

        searchInput.addEventListener('input', () => {
            this.searchKeyword = searchInput.value.trim();
            this.queueLoadTasks();
        });

        // 点击外部关闭搜索框（如果为空）
        document.addEventListener('click', (e) => {
            if (!searchContainer.contains(e.target as Node) && !this.searchKeyword && searchInput.style.visibility !== 'hidden') {
                searchInput.style.width = '0';
                searchInput.style.padding = '4px 0';
                searchInput.style.opacity = '0';
                setTimeout(() => { searchInput.style.visibility = 'hidden'; }, 200);
            }
        });

        searchContainer.appendChild(searchInput);
        searchContainer.appendChild(searchBtn);
        controlsGroup.appendChild(searchContainer);

        // 刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = i18n('refresh');
        refreshBtn.addEventListener('click', async () => {
            // 重新加载项目信息（包括分组信息）
            await this.loadProject();
            // 重新加载任务数据
            await this.getReminders(true);
            // 强制触发看板重绘
            this._lastRenderedProjectId = null;
            this.queueLoadTasks();
        });
        controlsGroup.appendChild(refreshBtn);

        const calendarBtn = document.createElement('button');
        calendarBtn.className = 'b3-button b3-button--outline';
        calendarBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg>';
        calendarBtn.title = '打开日历视图';
        calendarBtn.addEventListener('click', () => this.openCalendarForProject());
        controlsGroup.appendChild(calendarBtn);

        // 看板模式选择下拉框
        const modeSelectContainer = document.createElement('div');
        modeSelectContainer.className = 'kanban-mode-select-container';
        modeSelectContainer.style.cssText = `
            position: relative;
            display: inline-block;
        `;

        const modeSelect = document.createElement('select');
        modeSelect.className = 'b3-select kanban-mode-select';
        modeSelect.style.cssText = `
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 14px;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            min-width: 120px;
        `;

        // 添加选项
        const statusOption = document.createElement('option');
        statusOption.value = 'status';
        statusOption.textContent = i18n('statusKanban');
        if (this.kanbanMode === 'status') {
            statusOption.selected = true;
        }
        modeSelect.appendChild(statusOption);

        const customOption = document.createElement('option');
        customOption.value = 'custom';
        customOption.textContent = i18n('customGroupKanban');
        if (this.kanbanMode === 'custom') {
            customOption.selected = true;
        }
        modeSelect.appendChild(customOption);

        // 切换事件
        modeSelect.addEventListener('change', async () => {
            const newMode = modeSelect.value as 'status' | 'custom';
            if (newMode !== this.kanbanMode) {
                await this.toggleKanbanMode();
            }
        });

        modeSelectContainer.appendChild(modeSelect);
        controlsGroup.appendChild(modeSelectContainer);

        // 设置任务状态按钮
        const manageStatusesBtn = document.createElement('button');
        manageStatusesBtn.className = 'b3-button b3-button--outline';
        manageStatusesBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg> ${i18n('manageStatuses') || '任务状态'}`;
        manageStatusesBtn.title = i18n('manageKanbanStatuses') || '管理任务状态';
        manageStatusesBtn.addEventListener('click', () => this.showManageKanbanStatusesDialog());
        controlsGroup.appendChild(manageStatusesBtn);

        // 管理分组按钮
        const manageGroupsBtn = document.createElement('button');
        manageGroupsBtn.className = 'b3-button b3-button--outline';
        manageGroupsBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg> ${i18n('manageGroups')}`;
        manageGroupsBtn.title = i18n('manageCustomGroups');
        manageGroupsBtn.addEventListener('click', () => this.showManageGroupsDialog());
        controlsGroup.appendChild(manageGroupsBtn);

        // 管理标签按钮
        const manageTagsBtn = document.createElement('button');
        manageTagsBtn.className = 'b3-button b3-button--outline';
        manageTagsBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconTags"></use></svg> ${i18n('manageTags')}`;
        manageTagsBtn.title = i18n('manageProjectTags');
        manageTagsBtn.addEventListener('click', () => this.showManageTagsDialog());
        controlsGroup.appendChild(manageTagsBtn);

        // 多选模式按钮
        const multiSelectBtn = document.createElement('button');
        multiSelectBtn.className = 'b3-button b3-button--outline';
        multiSelectBtn.id = 'multiSelectBtn';
        multiSelectBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconCheck"></use></svg> ${i18n('batchSelect') || '批量选择'}`;
        multiSelectBtn.title = i18n('batchSelectMode') || '进入批量选择模式';
        multiSelectBtn.addEventListener('click', () => this.toggleMultiSelectMode());
        controlsGroup.appendChild(multiSelectBtn);

        toolbar.appendChild(controlsGroup);

        // 创建看板容器
        const kanbanContainer = document.createElement('div');
        kanbanContainer.className = 'project-kanban-container';
        this.container.appendChild(kanbanContainer);

        // 创建四个列：进行中、短期、长期、已完成
        this.createKanbanColumn(kanbanContainer, 'doing', i18n('doing'), '#f39c12');
        this.createKanbanColumn(kanbanContainer, 'short_term', i18n('shortTerm'), '#3498db');
        this.createKanbanColumn(kanbanContainer, 'long_term', i18n('longTerm'), '#9b59b6');
        this.createKanbanColumn(kanbanContainer, 'completed', i18n('done'), '#27ae60');

        // 添加自定义样式
        this.addCustomStyles();

        // 更新排序按钮标题
        this.updateSortButtonTitle();
        this.updateDoneSortButtonTitle();

        // 更新模式选择下拉框
        this.updateModeSelect();
    }

    private createKanbanColumn(container: HTMLElement, status: string, title: string, color: string) {
        const column = document.createElement('div');
        column.className = `kanban-column kanban-column-${status}`;
        column.dataset.status = status;

        // 列标题
        const header = document.createElement('div');
        header.className = 'kanban-column-header';
        header.style.cssText = `
            padding: 12px 16px;
            border-bottom: 1px solid var(--b3-theme-border);
            background: ${color}15;
            border-radius: 8px 8px 0 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
        `;

        const titleContainer = document.createElement('div');
        titleContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        const titleEl = document.createElement('h3');
        // 从 kanbanStatuses 获取状态图标
        const statusConfig = this.kanbanStatuses.find(s => s.id === status);
        const emoji = statusConfig?.icon || '';
        titleEl.textContent = emoji ? `${emoji}${title}` : title;
        titleEl.style.cssText = `
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: ${color};
        `;
        titleContainer.appendChild(titleEl);

        if (status === 'completed') {
            this.doneSortButton = document.createElement('button');
            this.doneSortButton.className = 'b3-button b3-button--text';
            this.doneSortButton.innerHTML = '<svg style="width: 14px; height: 14px;"><use xlink:href="#iconSort"></use></svg>';
            this.doneSortButton.title = '排序';
            this.doneSortButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showDoneSortMenu(e);
            });
            titleContainer.appendChild(this.doneSortButton);
        }

        const countEl = document.createElement('span');
        countEl.className = 'kanban-column-count';
        countEl.style.cssText = `
            background: ${color};
            color: white;
            border-radius: 12px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 500;
            min-width: 20px;
            text-align: center;
        `;

        header.appendChild(titleContainer);

        // 新建任务按钮（针对该状态列），已完成列不显示新建按钮
        const rightContainer = document.createElement('div');
        rightContainer.className = 'custom-header-right';
        rightContainer.style.cssText = 'display:flex; align-items:center; gap:8px;';
        rightContainer.appendChild(countEl);

        if (status !== 'completed') {
            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'b3-button b3-button--outline';
            addTaskBtn.style.cssText = 'margin-left:8px;';
            addTaskBtn.title = i18n('newTask');
            addTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>`;
            addTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showCreateTaskDialog(undefined, this.lastSelectedCustomGroupId, status);
            });

            rightContainer.appendChild(addTaskBtn);

            // 粘贴新建任务按钮
            const pasteTaskBtn = document.createElement('button');
            pasteTaskBtn.className = 'b3-button b3-button--outline';
            pasteTaskBtn.title = i18n('pasteNew');
            pasteTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>`;
            pasteTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showPasteTaskDialog(undefined, this.lastSelectedCustomGroupId, status, true);
            });

            rightContainer.appendChild(pasteTaskBtn);
        }

        header.appendChild(rightContainer);

        // 支持拖拽列头以排序状态
        header.draggable = true;
        header.dataset.statusId = status;
        header.addEventListener('dragstart', (e: DragEvent) => {
            try { e.dataTransfer?.setData('text/status-id', status); } catch (err) { }
            e.dataTransfer!.effectAllowed = 'move';
            header.classList.add('dragging');
        });
        header.addEventListener('dragend', () => {
            header.classList.remove('dragging');
            // 隐藏任何占位符（由容器处理）
            const ph = container.querySelector('.kanban-column-insert-placeholder') as HTMLElement | null;
            if (ph) ph.style.display = 'none';
        });

        // 列内容
        const content = document.createElement('div');
        content.className = 'kanban-column-content';
        content.style.cssText = `
            flex: 1;
            padding: 0px;
            overflow-y: auto;
            min-height: 200px;
            margin-top: 8px;
        `;

        // 添加拖拽事件
        this.addDropZoneEvents(content, status);

        column.appendChild(header);
        column.appendChild(content);

        // 分页容器（插入在列内容之后）
        const pagination = document.createElement('div');
        pagination.className = 'kanban-column-pagination';
        pagination.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 8px;
        `;

        column.appendChild(pagination);
        container.appendChild(column);

        // 仅在容器上初始化一次列拖拽处理
        if (!container.dataset.columnDragInit) {
            container.dataset.columnDragInit = '1';
            const columnPlaceholder = document.createElement('div');
            columnPlaceholder.className = 'kanban-column-insert-placeholder';
            columnPlaceholder.style.cssText = `
                width: 6px;
                background: var(--b3-theme-primary);
                border-radius: 3px;
                margin: 8px 4px;
                display: none;
                transition: opacity 120ms ease;
            `;
            container.appendChild(columnPlaceholder);

            let dragCounter = 0;

            container.addEventListener('dragenter', (ev: DragEvent) => {
                // 仅针对列头拖拽（设置了 text/status-id）处理进入计数，避免任务拖拽触发列插入占位
                const dt = ev.dataTransfer;
                const isColumnDrag = dt && ((dt.types && Array.from(dt.types).includes('text/status-id')) || !!dt.getData?.('text/status-id'));
                if (!isColumnDrag) return;
                ev.preventDefault();
                dragCounter++;
            });

            container.addEventListener('dragleave', (ev: DragEvent) => {
                const dt = ev.dataTransfer;
                const isColumnDrag = dt && ((dt.types && Array.from(dt.types).includes('text/status-id')) || !!dt.getData?.('text/status-id'));
                if (!isColumnDrag) return;
                const related = (ev as any).relatedTarget as HTMLElement | null;
                if (!related || !container.contains(related)) {
                    dragCounter = 0;
                    columnPlaceholder.style.display = 'none';
                } else {
                    dragCounter = Math.max(0, dragCounter - 1);
                }
            });

            container.addEventListener('dragover', (ev: DragEvent) => {
                // 仅在列头拖拽时显示列插入占位符；普通任务拖拽不应影响列顺序的可视提示
                const dt = ev.dataTransfer;
                const isColumnDrag = dt && ((dt.types && Array.from(dt.types).includes('text/status-id')) || !!dt.getData?.('text/status-id'));
                if (!isColumnDrag) return;
                ev.preventDefault();
                const columns = Array.from(container.querySelectorAll('.kanban-column')) as HTMLElement[];
                if (columns.length === 0) {
                    container.appendChild(columnPlaceholder);
                    columnPlaceholder.style.display = 'block';
                    return;
                }
                let inserted = false;
                for (const col of columns) {
                    const rect = col.getBoundingClientRect();
                    const midX = rect.left + rect.width / 2;
                    if (ev.clientX < midX) {
                        col.parentElement!.insertBefore(columnPlaceholder, col);
                        inserted = true;
                        break;
                    }
                }
                if (!inserted) container.appendChild(columnPlaceholder);
                columnPlaceholder.style.display = 'block';
            });

            container.addEventListener('drop', (ev: DragEvent) => {
                ev.preventDefault();
                columnPlaceholder.style.display = 'none';
                dragCounter = 0;
                const data = ev.dataTransfer?.getData('text/status-id') || ev.dataTransfer?.getData('text');
                if (!data) return;
                const draggedId = data as string;

                let beforeCount = 0;
                for (const child of Array.from(container.children)) {
                    if (child === columnPlaceholder) break;
                    const el = child as HTMLElement;
                    if (el.classList && el.classList.contains('kanban-column')) beforeCount++;
                }
                const insertIndex = beforeCount;

                const fromIndex = this.kanbanStatuses.findIndex(s => s.id === draggedId);
                if (fromIndex === -1) return;
                const [moved] = this.kanbanStatuses.splice(fromIndex, 1);
                this.kanbanStatuses.splice(insertIndex, 0, moved);
                this.kanbanStatuses.forEach((s, i) => s.sort = i * 10);

                (async () => {
                    try {
                        await this.projectManager.setProjectKanbanStatuses(this.projectId, this.kanbanStatuses);
                        this._lastRenderedProjectId = null;
                        this.queueLoadTasks();
                        showMessage(i18n('statusOrderSaved') || '状态顺序已保存');
                    } catch (err) {
                        console.error('保存状态顺序失败', err);
                    }
                })();
            });
        }

        return column;
    }

    private addDropZoneEvents(element: HTMLElement, status: string) {
        element.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedTask) {
                // 检查是否可以改变状态或解除父子关系
                // 使用 getTaskStatus 获取当前任务的实际状态
                const currentStatus = this.getTaskStatus(this.draggedTask);
                const canChangeStatus = currentStatus !== status;
                const canUnsetParent = !!this.draggedTask.parentId;

                if (canChangeStatus || canUnsetParent) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    element.classList.add('kanban-drop-zone-active');

                    // 不显示解除父任务关系的提示，让用户通过拖拽区域自然判断
                    // 移除了原来的 unsetParent 指示器显示逻辑
                }
            }
        });

        element.addEventListener('dragleave', (_e) => {
            // 使用 contains 检查离开目标区域时清除样式
            if (!element.contains((_e as any).relatedTarget as Node)) {
                element.classList.remove('kanban-drop-zone-active');
                this.updateIndicator('none', null, null);
            }
        });

        element.addEventListener('drop', async (e) => {
            // 检查批量拖拽
            const multiData = e.dataTransfer?.getData('application/vnd.siyuan.kanban-tasks');
            if (multiData) {
                e.preventDefault();
                element.classList.remove('kanban-drop-zone-active');
                this.updateIndicator('none', null, null);
                try {
                    const taskIds = JSON.parse(multiData);
                    await this.batchUpdateTasks(taskIds, { kanbanStatus: status });
                } catch (err) { console.error(err); }
                return;
            }

            if (this.isDragging && this.draggedTask) {
                e.preventDefault();
                element.classList.remove('kanban-drop-zone-active');
                this.updateIndicator('none', null, null);

                // 使用 batchUpdateTasks 处理单个任务拖拽，确保可以自动解除父子关系
                await this.batchUpdateTasks([this.draggedTask.id], { kanbanStatus: status });
            }
        });
    }

    /**
     * 为自定义分组列添加拖拽事件（设置分组）
     */
    private addCustomGroupDropZoneEvents(element: HTMLElement, groupId: string | null) {
        element.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedTask) {
                // 将 undefined 或字符串 'ungrouped' 视为 null，对比当前分组是否与目标一致
                const currentGroupRaw = (this.draggedTask.customGroupId as any);
                const currentGroup = (currentGroupRaw === undefined || currentGroupRaw === 'ungrouped') ? null : currentGroupRaw;
                const canSetGroup = currentGroup !== groupId;

                if (canSetGroup) {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    element.classList.add('kanban-drop-zone-active');
                }
            }
        });

        element.addEventListener('dragleave', (_e) => {
            // 使用 contains 检查离开目标区域时清除样式
            if (!element.contains((_e as any).relatedTarget as Node)) {
                element.classList.remove('kanban-drop-zone-active');
            }
        });

        element.addEventListener('drop', async (e) => {
            const multiData = e.dataTransfer?.getData('application/vnd.siyuan.kanban-tasks');
            if (multiData) {
                e.preventDefault();
                element.classList.remove('kanban-drop-zone-active');
                try {
                    const taskIds = JSON.parse(multiData);
                    await this.batchUpdateTasks(taskIds, { customGroupId: groupId });
                } catch (err) { console.error(err); }
                return;
            }

            if (this.isDragging && this.draggedTask) {
                e.preventDefault();
                element.classList.remove('kanban-drop-zone-active');

                // 使用 batchUpdateTasks 处理单个任务拖拽，确保可以自动解除父子关系
                await this.batchUpdateTasks([this.draggedTask.id], { customGroupId: groupId });
            }
        });
    }

    /**
     * **[新增]** 为自定义分组下的状态子分组添加拖拽事件（设置任务状态）
     * @param element 目标DOM元素
     * @param targetStatus 目标状态 ('doing', 'short_term', 'long_term')
     */
    private addStatusSubGroupDropEvents(element: HTMLElement, targetStatus: string) {
        element.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedTask) {
                // 获取当前任务的状态
                const currentStatus = this.getTaskStatus(this.draggedTask);

                // 获取目标分组ID（从DOM中提取）
                const statusGroup = element.closest('.custom-status-group') as HTMLElement;
                let targetGroupId: string | null | undefined = undefined;
                if (statusGroup && statusGroup.dataset.groupId) {
                    const groupId = statusGroup.dataset.groupId;
                    targetGroupId = groupId === 'ungrouped' ? null : groupId;
                }

                // 获取当前任务的分组ID
                const currentGroupRaw = (this.draggedTask as any).customGroupId;
                const currentGroupId = (currentGroupRaw === undefined || currentGroupRaw === 'ungrouped') ? null : currentGroupRaw;

                // 允许放置的条件：状态不同 OR 分组不同
                const statusChanged = currentStatus !== targetStatus;
                const groupChanged = targetGroupId !== undefined && currentGroupId !== targetGroupId;

                if (statusChanged || groupChanged) {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    element.classList.add('kanban-drop-zone-active');
                }
            }
        });

        element.addEventListener('dragleave', (e) => {
            // 使用 contains 检查是否真正离开目标区域
            if (!element.contains((e as any).relatedTarget as Node)) {
                element.classList.remove('kanban-drop-zone-active');
            }
        });

        element.addEventListener('drop', async (e) => {
            // 提取目标 customGroupId
            const statusGroup = element.closest('.custom-status-group') as HTMLElement;
            let targetGroupId: string | null | undefined = undefined;
            if (statusGroup && statusGroup.dataset.groupId) {
                const groupId = statusGroup.dataset.groupId;
                targetGroupId = groupId === 'ungrouped' ? null : groupId;
            }

            const multiData = e.dataTransfer?.getData('application/vnd.siyuan.kanban-tasks');
            if (multiData) {
                e.preventDefault();
                e.stopPropagation();
                element.classList.remove('kanban-drop-zone-active');
                try {
                    const taskIds = JSON.parse(multiData);
                    await this.batchUpdateTasks(taskIds, { kanbanStatus: targetStatus, customGroupId: targetGroupId });
                } catch (err) { console.error(err); }
                return;
            }

            if (this.isDragging && this.draggedTask) {
                e.preventDefault();
                // 关键：阻止事件冒泡，防止触发父级（整个自定义分组）的drop事件
                e.stopPropagation();
                element.classList.remove('kanban-drop-zone-active');

                const task = this.draggedTask;
                // use task.id for batchUpdateTasks, it handles originalId lookup internally
                const taskId = task.id;

                // 使用 batchUpdateTasks 处理单个任务拖拽，确保可以自动解除父子关系
                await this.batchUpdateTasks([taskId], { kanbanStatus: targetStatus, customGroupId: targetGroupId });
            }
        });
    }


    /**
     * 设置任务的自定义分组
     */
    private async setTaskCustomGroup(task: any, groupId: string | null) {
        try {
            // 归一化：确保 'ungrouped' 字符串也会被当作 null 处理
            if (groupId === 'ungrouped') groupId = null;
            const reminderData = await this.getReminders();
            // 支持重复实例：如果是实例，写入原始提醒的 repeat.instanceModifications[date]
            if (task.isRepeatInstance && task.originalId) {
                const instanceDate = task.date;
                const originalId = task.originalId;
                // 获取原始及其后代原始ID
                const originalIds = [originalId, ...this.getAllDescendantIds(originalId, reminderData)];
                let updatedCount = 0;

                for (const oid of originalIds) {
                    const orig = reminderData[oid];
                    if (!orig) continue;
                    if (!orig.repeat) orig.repeat = {};
                    if (!orig.repeat.instanceModifications) orig.repeat.instanceModifications = {};
                    if (!orig.repeat.instanceModifications[instanceDate]) orig.repeat.instanceModifications[instanceDate] = {};

                    const instMod = orig.repeat.instanceModifications[instanceDate];
                    if (groupId === null) {
                        if (instMod.customGroupId !== undefined) {
                            delete instMod.customGroupId;
                            updatedCount++;
                        }
                    } else {
                        if (instMod.customGroupId !== groupId) {
                            instMod.customGroupId = groupId;
                            updatedCount++;
                        }
                    }
                }

                if (updatedCount === 0) {
                    showMessage('没有需要更新的任务分组');
                    return;
                }

                await saveReminders(this.plugin, reminderData);

                this.dispatchReminderUpdate(true);

                if (groupId === null) {
                    showMessage(`已将 ${updatedCount} 个任务实例移出分组`);
                } else {
                    showMessage(`已将 ${updatedCount} 个任务实例添加到分组`);
                }

                await this.queueLoadTasks();
                return;
            }

            // 非实例情况：按原逻辑更新实际任务及其后代
            if (!reminderData[task.id]) {
                showMessage("任务不存在");
                return;
            }

            // 计算要更新的任务列表：包含当前任务及其所有后代
            const toUpdateIds = [task.id, ...this.getAllDescendantIds(task.id, reminderData)];

            let updatedCount = 0;
            toUpdateIds.forEach(id => {
                const item = reminderData[id];
                if (!item) return;
                if (groupId === null) {
                    // 明确移除分组
                    if (item.customGroupId !== undefined) {
                        delete item.customGroupId;
                        updatedCount++;
                    }
                } else {
                    if (item.customGroupId !== groupId) {
                        item.customGroupId = groupId;
                        updatedCount++;
                    }
                }
            });

            if (updatedCount === 0) {
                showMessage('没有需要更新的任务分组');
                return;
            }

            await saveReminders(this.plugin, reminderData);

            // 广播更新事件
            this.dispatchReminderUpdate(true);

            // 提示更新的任务数
            if (groupId === null) {
                showMessage(`已将 ${updatedCount} 个任务移出分组`);
            } else {
                showMessage(`已将 ${updatedCount} 个任务添加到分组`);
            }

            // 重新加载任务以更新显示（使用防抖队列）
            await this.queueLoadTasks();
        } catch (error) {
            console.error('设置任务分组失败:', error);
            showMessage("设置任务分组失败");
        }
    }

    /**
     * 切换任务的标签（添加或移除）
     * @param task 任务对象
     * @param tagId 标签ID
     */
    private async toggleTaskTag(task: any, tagId: string) {
        try {
            const reminderData = await this.getReminders();

            // 如果是重复实例，优先走实例处理逻辑；否则确保目标任务存在
            if (!(task.isRepeatInstance && task.originalId)) {
                if (!reminderData[task.id]) {
                    showMessage("任务不存在");
                    return;
                }
            }

            // 获取标签名称用于显示
            const projectManager = this.projectManager;
            const projectTags = await projectManager.getProjectTags(this.projectId);
            const tag = projectTags.find(t => t.id === tagId);
            const tagName = tag?.name || tagId;

            // 支持重复实例：如果是实例，写入原始提醒的 repeat.instanceModifications[date]
            if (task.isRepeatInstance && task.originalId) {
                const instanceDate = task.date;
                const originalId = task.originalId;
                // 获取原始及其后代原始ID
                const originalIds = [originalId, ...this.getAllDescendantIds(originalId, reminderData)];
                let updatedCount = 0;

                // 判断原始任务当前实例是否包含该标签（用于判断是添加还是移除）
                const origFirst = reminderData[originalId];
                const origInstanceMods = origFirst?.repeat?.instanceModifications || {};
                const instanceModExample = origInstanceMods[instanceDate] || {};
                const instanceTags = instanceModExample.tagIds || origFirst?.tagIds || [];
                const isAdding = instanceTags.indexOf(tagId) === -1;

                for (const oid of originalIds) {
                    const orig = reminderData[oid];
                    if (!orig) continue;
                    if (!orig.repeat) orig.repeat = {};
                    if (!orig.repeat.instanceModifications) orig.repeat.instanceModifications = {};
                    if (!orig.repeat.instanceModifications[instanceDate]) orig.repeat.instanceModifications[instanceDate] = {};

                    const instMod = orig.repeat.instanceModifications[instanceDate];
                    if (!instMod.tagIds) {
                        // 如果实例层没有定义标签，初始化为原始任务的标签副本（避免覆盖原始）
                        instMod.tagIds = Array.isArray(orig.tagIds) ? [...orig.tagIds] : [];
                    }

                    const idx = instMod.tagIds.indexOf(tagId);
                    if (isAdding) {
                        if (idx === -1) {
                            instMod.tagIds.push(tagId);
                            updatedCount++;
                        }
                    } else {
                        if (idx > -1) {
                            instMod.tagIds.splice(idx, 1);
                            updatedCount++;
                        }
                    }
                }

                if (updatedCount === 0) {
                    showMessage('没有需要更新的任务标签');
                    return;
                }

                await saveReminders(this.plugin, reminderData);
                this.dispatchReminderUpdate(true);
                if (isAdding) {
                    showMessage(`已为 ${updatedCount} 个任务实例添加标签"${tagName}"`);
                } else {
                    showMessage(`已从 ${updatedCount} 个任务实例移除标签"${tagName}"`);
                }

                await this.queueLoadTasks();
                return;
            }

            // 计算要更新的任务列表：包含当前任务及其所有后代
            const toUpdateIds = [task.id, ...this.getAllDescendantIds(task.id, reminderData)];

            // 更新所有相关任务的标签
            let updatedCount = 0;
            const currentTags = reminderData[task.id].tagIds || [];
            const tagIndex = currentTags.indexOf(tagId);
            const isAdding = tagIndex === -1;

            for (const taskId of toUpdateIds) {
                if (reminderData[taskId]) {
                    if (!reminderData[taskId].tagIds) {
                        reminderData[taskId].tagIds = [];
                    }

                    const tags = reminderData[taskId].tagIds;
                    const idx = tags.indexOf(tagId);

                    if (isAdding) {
                        // 添加标签
                        if (idx === -1) {
                            tags.push(tagId);
                            updatedCount++;
                        }
                    } else {
                        // 移除标签
                        if (idx > -1) {
                            tags.splice(idx, 1);
                            updatedCount++;
                        }
                    }
                }
            }

            await saveReminders(this.plugin, reminderData);

            // 广播更新事件
            this.dispatchReminderUpdate(true);

            // 提示更新的任务数
            if (isAdding) {
                showMessage(`已为 ${updatedCount} 个任务添加标签"${tagName}"`);
            } else {
                showMessage(`已从 ${updatedCount} 个任务移除标签"${tagName}"`);
            }

            // 重新加载任务以更新显示（使用防抖队列）
            await this.queueLoadTasks();
        } catch (error) {
            console.error('切换任务标签失败:', error);
            showMessage("设置任务标签失败");
        }
    }

    private async getReminders(forceRefresh: boolean = false): Promise<any> {
        if (forceRefresh || !this.reminderData) {
            this.reminderData = await getAllReminders(this.plugin, undefined, forceRefresh);
        }
        return this.reminderData;
    }

    private async loadTasks() {
        if (this.isLoading) {
            return;
        }

        this.isLoading = true;
        try {
            // 保存当前滚动状态，避免界面刷新时丢失滚动位置
            this.captureScrollState();

            const reminderData = await this.getReminders();
            const projectTasks = Object.values(reminderData).filter((reminder: any) => reminder && reminder.projectId === this.projectId);
            // 修复遗留：如果任务中存在 customGroupId === 'ungrouped'，视为未分组（删除该字段）
            projectTasks.forEach((t: any) => {
                if (t && t.customGroupId === 'ungrouped') {
                    delete t.customGroupId;
                }
            });
            // 为没有设置状态或状态无效的任务默认设置为 doing（进行中）
            const validStatusIds = new Set(this.kanbanStatuses.map(s => s.id));
            let hasInvalidStatus = false;
            projectTasks.forEach((t: any) => {
                if (t && !t.completed) {
                    // 检查状态是否存在且有效（属于当前项目的状态）
                    if (!t.kanbanStatus || !validStatusIds.has(t.kanbanStatus)) {
                        t.kanbanStatus = 'doing';
                        // 同步更新 reminderData 以便保存
                        if (reminderData[t.id]) {
                            reminderData[t.id].kanbanStatus = 'doing';
                        }
                        hasInvalidStatus = true;
                    }
                }
            });
            // 如果有任务状态被修正，保存到存储
            if (hasInvalidStatus) {
                saveReminders(this.plugin, reminderData).catch(err => {
                    console.error('保存任务状态修正失败:', err);
                });
            }
            const taskMap = new Map(projectTasks.map((t: any) => [t.id, { ...t }]));

            const getRootStatus = (task: any): string => {
                let current = task;
                while (current.parentId && taskMap.has(current.parentId)) {
                    current = taskMap.get(current.parentId);
                }
                return this.getTaskStatus(current);
            };

            // 处理周期事件：生成实例并筛选
            const today = getLogicalDateString();
            const allTasksWithInstances: any[] = [];

            projectTasks.forEach((reminder: any) => {
                // 对于农历重复任务，只添加符合农历日期的实例，不添加原始日期
                const isLunarRepeat = reminder.repeat?.enabled &&
                    (reminder.repeat.type === 'lunar-monthly' || reminder.repeat.type === 'lunar-yearly');

                // 修改后的逻辑：对于所有重复事件，只显示实例，不显示原始任务
                if (!reminder.repeat?.enabled) {
                    // 非周期任务，正常添加
                    allTasksWithInstances.push(reminder);
                }
                // 对于所有重复事件（农历和非农历），都不添加原始任务，只添加实例

                // 如果是周期事件，生成实例
                if (reminder.repeat?.enabled) {
                    // 智能确定时间范围，确保至少能找到下一个未来实例
                    const repeatInstances = this.generateInstancesWithFutureGuarantee(reminder, today, isLunarRepeat);

                    // 过滤实例：保留过去未完成、今天的、未来第一个未完成，以及所有已完成的实例
                    const completedInstances = reminder.repeat?.completedInstances || [];
                    const instanceModifications = reminder.repeat?.instanceModifications || {};

                    // 将实例分类为：过去未完成、今天未完成、未来未完成、未来已完成、过去已完成
                    let pastIncompleteList: any[] = [];
                    let todayIncompleteList: any[] = [];
                    let futureIncompleteList: any[] = [];
                    let futureCompletedList: any[] = [];
                    let pastCompletedList: any[] = [];

                    repeatInstances.forEach(instance => {
                        const instanceIdStr = (instance as any).instanceId || `${reminder.id}_${instance.date}`;
                        const originalKey = instanceIdStr.split('_').pop() || instance.date;
                        // 对于所有重复事件，只添加实例，不添加原始任务
                        const isInstanceCompleted = completedInstances.includes(originalKey);
                        const instanceMod = instanceModifications[originalKey];

                        const instanceTask = {
                            ...reminder,
                            id: instance.instanceId,
                            date: instance.date,
                            endDate: instance.endDate,
                            time: instance.time,
                            endTime: instance.endTime,
                            isRepeatInstance: true,
                            originalId: instance.originalId,
                            completed: isInstanceCompleted,
                            // 如果实例有修改，使用实例的值；否则使用原始值
                            note: instanceMod?.note !== undefined ? instanceMod.note : reminder.note,
                            priority: instanceMod?.priority !== undefined ? instanceMod.priority : reminder.priority,
                            categoryId: instanceMod?.categoryId !== undefined ? instanceMod.categoryId : reminder.categoryId,
                            projectId: instanceMod?.projectId !== undefined ? instanceMod.projectId : reminder.projectId,
                            customGroupId: instanceMod?.customGroupId !== undefined ? instanceMod.customGroupId : reminder.customGroupId,
                            kanbanStatus: instanceMod?.kanbanStatus !== undefined ? instanceMod.kanbanStatus : reminder.kanbanStatus,
                            // 实例层标签支持：优先使用 instanceMod 的 tagIds，否则使用原始提醒的 tagIds
                            tagIds: instanceMod?.tagIds !== undefined ? instanceMod.tagIds : reminder.tagIds,
                            // 为已完成的实例添加完成时间（用于排序）
                            completedTime: isInstanceCompleted ? getLocalDateTimeString(new Date(instance.date)) : undefined
                        };

                        // 按日期和完成状态分类（使用逻辑日期）
                        const instanceLogical = this.getTaskLogicalDate(instance.date, instance.time);
                        const dateComparison = compareDateStrings(instanceLogical, today);

                        if (dateComparison < 0) {
                            // 过去的日期
                            if (isInstanceCompleted) {
                                pastCompletedList.push(instanceTask);
                            } else {
                                pastIncompleteList.push(instanceTask);
                            }
                        } else if (dateComparison === 0) {
                            // 今天的日期（只收集未完成的）
                            if (!isInstanceCompleted) {
                                todayIncompleteList.push(instanceTask);
                            } else {
                                pastCompletedList.push(instanceTask); // 今天已完成算作过去
                            }
                        } else {
                            // 未来的日期
                            if (isInstanceCompleted) {
                                futureCompletedList.push(instanceTask);
                            } else {
                                futureIncompleteList.push(instanceTask);
                            }
                        }
                    });

                    // 添加过去的未完成实例
                    allTasksWithInstances.push(...pastIncompleteList);

                    // 添加今天的未完成实例
                    allTasksWithInstances.push(...todayIncompleteList);

                    // 添加未来的第一个未完成实例（如果存在）
                    // 这样即使有多个已完成的未来实例，也能显示下一个未完成的实例
                    if (futureIncompleteList.length > 0) {
                        // 对于所有重复事件，如果今天没有未完成实例，就添加未来第一个未完成的
                        const hasTodayIncomplete = todayIncompleteList.length > 0;
                        if (!hasTodayIncomplete) {
                            allTasksWithInstances.push(futureIncompleteList[0]);
                        }
                    }

                    // 添加所有已完成的实例（包括过去和未来的）- ProjectKanbanView需要显示已完成的实例
                    allTasksWithInstances.push(...pastCompletedList);
                    allTasksWithInstances.push(...futureCompletedList);
                }
            });

            this.tasks = await Promise.all(allTasksWithInstances.map(async (reminder: any) => {
                let status;
                if (reminder.parentId && taskMap.has(reminder.parentId)) {
                    // For ALL subtasks, their column is determined by their root parent's status
                    status = getRootStatus(reminder);
                } else {
                    // For top-level tasks, use their own status
                    status = this.getTaskStatus(reminder);
                }
                // 获取番茄钟计数（支持重复实例的单独计数）
                const pomodoroCount = await this.getReminderPomodoroCount(reminder.id, reminder, reminderData);
                const focusTime = await this.getReminderFocusTime(reminder.id, reminder, reminderData);

                let totalRepeatingPomodoroCount = 0;
                let totalRepeatingFocusTime = 0;
                if (reminder.isRepeatInstance) {
                    totalRepeatingPomodoroCount = this.pomodoroRecordManager.getRepeatingEventTotalPomodoroCount(reminder.originalId);
                    totalRepeatingFocusTime = this.pomodoroRecordManager.getRepeatingEventTotalFocusTime(reminder.originalId);
                }

                return {
                    ...reminder,
                    status: status,
                    pomodoroCount: pomodoroCount,
                    focusTime: focusTime || 0,
                    totalRepeatingPomodoroCount,
                    totalRepeatingFocusTime
                };
            }));

            // [NEW] 搜索过滤逻辑
            if (this.searchKeyword) {
                const keywords = this.searchKeyword.toLowerCase().split(/\s+/).filter(k => !!k);
                const matches = (t: any) => {
                    const title = (t.title || '').toLowerCase();
                    const note = (t.note || '').toLowerCase();
                    const combined = `${title} ${note}`;
                    return keywords.every(k => combined.includes(k));
                };

                const matchingIds = new Set<string>();
                const taskMap = new Map(this.tasks.map(t => [t.id, t]));

                this.tasks.forEach(t => {
                    if (matches(t)) {
                        // 匹配的任务及其所有祖先都需要保留，以维持层级显示
                        let current = t;
                        while (current) {
                            matchingIds.add(current.id);
                            current = current.parentId ? taskMap.get(current.parentId) : null;
                        }
                    }
                });

                this.tasks = this.tasks.filter(t => matchingIds.has(t.id));
            }

            this.sortTasks();

            // 默认折叠逻辑：
            // - 首次加载（或用户无任何折叠偏好）时，按照旧逻辑为非 doing 的父任务设置为折叠状态；
            // - 之后的加载尽量保留用户通过界面展开/折叠的偏好（即不再盲目 clear 并重新折叠已展开的父任务）；
            // - 同时移除那些已经不存在的任务 id，防止内存泄漏或过期状态。
            try {
                // 如果外部（例如 queueLoadTasks）请求在本次加载后恢复某些父任务折叠状态，优先恢复
                if (this._preserveCollapsedTasks && this._preserveCollapsedTasks.size > 0) {
                    this.collapsedTasks = new Set(this._preserveCollapsedTasks);
                    this._preserveCollapsedTasks = null;
                }
                const taskIds = new Set(this.tasks.map(t => t.id));

                // 清理 collapsedTasks 中已不存在的任务 id
                for (const id of Array.from(this.collapsedTasks)) {
                    if (!taskIds.has(id)) {
                        this.collapsedTasks.delete(id);
                    }
                }

                // 收集父任务及其子任务
                const parentMap = new Map<string, any[]>();
                this.tasks.forEach(t => {
                    if (t.parentId && taskIds.has(t.parentId)) {
                        if (!parentMap.has(t.parentId)) parentMap.set(t.parentId, []);
                        parentMap.get(t.parentId)!.push(t);
                    }
                });

                // 仅在首次加载且用户没有任何折叠偏好（collapsedTasks 为空）时，应用默认折叠策略
                if (!this._defaultCollapseApplied && this.collapsedTasks.size === 0) {
                    parentMap.forEach((_children, parentId) => {
                        const parent = this.tasks.find(p => p.id === parentId);
                        if (!parent) return;
                        // 默认折叠所有父任务
                        this.collapsedTasks.add(parentId);
                    });
                    this._defaultCollapseApplied = true;
                }
            } catch (err) {
                console.warn('设置默认折叠任务失败:', err);
            }


            // 重置分页索引，防止页码超出范围
            try {
                const counts = {
                    doing: this.tasks.filter(t => t.status === 'doing').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                    short_term: this.tasks.filter(t => t.status === 'short_term').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                    long_term: this.tasks.filter(t => t.status === 'long_term').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                    completed: this.tasks.filter(t => t.status === 'completed').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                };
                for (const status of ['doing', 'short_term', 'long_term', 'completed']) {
                    const totalTop = counts[status as keyof typeof counts] || 0;
                    const totalPages = Math.max(1, Math.ceil(totalTop / this.pageSize));
                    const current = this.pageIndexMap[status] || 1;
                    this.pageIndexMap[status] = Math.min(Math.max(1, current), totalPages);
                }
            } catch (err) {
                // ignore
            }

            this.renderKanban();
        } catch (error) {
            console.error('加载任务失败:', error);
            showMessage("加载任务失败");
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * 防抖加载任务队列：避免短时间多次触发导致界面频繁重绘和滚动位置丢失
     */
    private queueLoadTasks(): Promise<void> {
        // 如果已有挂起的 promise，则复用
        if (!this._pendingLoadPromise) {
            this._pendingLoadPromise = new Promise<void>((resolve) => { this._pendingLoadResolve = resolve; });
        }

        // 在防抖定时执行前，缓存当前父任务折叠状态，避免在短时间内新建子任务等操作导致折叠状态丢失或被重置
        try {
            this._preserveCollapsedTasks = new Set(this.collapsedTasks);
        } catch (e) {
            this._preserveCollapsedTasks = null;
        }

        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }

        this._debounceTimer = setTimeout(async () => {
            try {
                await this.loadTasks();
            } catch (e) {
                console.error('queueLoadTasks 执行 loadTasks 时出错', e);
            } finally {
                if (this._pendingLoadResolve) {
                    this._pendingLoadResolve();
                }
                this._pendingLoadPromise = null;
                this._pendingLoadResolve = null;
                this._debounceTimer = null;
            }
        }, this._debounceDelay);

        return this._pendingLoadPromise as Promise<void>;
    }

    /**
     * 保存当前水平滚动（看板容器）和每列纵向滚动位置
     */
    private captureScrollState() {
        try {
            const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement | null;
            const containerScrollLeft = kanbanContainer ? kanbanContainer.scrollLeft : this.container.scrollLeft;
            const columnScrollTopMap: { [key: string]: number } = {};

            const columns = this.container.querySelectorAll('.kanban-column');
            columns.forEach((col) => {
                const content = col.querySelector('.kanban-column-content') as HTMLElement | null;
                if (content) {
                    const htmlCol = col as HTMLElement;
                    const status = (htmlCol.getAttribute('data-status') || htmlCol.dataset.status) || (htmlCol.getAttribute('data-group-id') || htmlCol.dataset.groupId) || '';
                    const key = status ? status : `col-${Array.prototype.indexOf.call(columns, col)}`;
                    columnScrollTopMap[key] = content.scrollTop || 0;
                }
            });

            this._savedScrollState = {
                containerScrollLeft: containerScrollLeft || 0,
                columnScrollTopMap
            };
        } catch (err) {
            console.warn('保存滚动状态失败', err);
            this._savedScrollState = null;
        }
    }

    /**
     * 恢复之前保存的滚动位置
     */
    private restoreScrollState() {
        if (!this._savedScrollState) return;
        try {
            const { containerScrollLeft, columnScrollTopMap } = this._savedScrollState;
            const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement | null;
            if (kanbanContainer) {
                // 立即恢复，如果失败再使用 setTimeout
                try {
                    kanbanContainer.scrollLeft = containerScrollLeft;
                } catch (e) { /* ignore */ }

                // setTimeout to ensure layout updated (as a safety fallback)
                setTimeout(() => {
                    try {
                        kanbanContainer.scrollLeft = Math.max(0, Math.min(kanbanContainer.scrollWidth - kanbanContainer.clientWidth, containerScrollLeft));
                    } catch (e) { /* ignore */ }
                }, 0);
            } else {
                // fallback
                try { this.container.scrollLeft = containerScrollLeft; } catch (e) { /* ignore */ }
            }

            // Restore columns' vertical scroll
            Object.keys(columnScrollTopMap).forEach(key => {
                // try find by status first
                let content: HTMLElement | null = null;
                if (key.startsWith('col-')) {
                    // index-based key
                    const idx = parseInt(key.replace('col-', ''), 10);
                    const columns = this.container.querySelectorAll('.kanban-column');
                    const col = columns && columns[idx] as HTMLElement | undefined;
                    content = col ? col.querySelector('.kanban-column-content') as HTMLElement : null;
                } else {
                    // try match by data-status or data-group-id
                    content = this.container.querySelector(`.kanban-column[data-status="${key}"] .kanban-column-content`) as HTMLElement;
                    if (!content) {
                        content = this.container.querySelector(`.kanban-column[data-group-id="${key}"] .kanban-column-content`) as HTMLElement;
                    }
                }
                if (content) {
                    const top = columnScrollTopMap[key] || 0;
                    // 立即恢复垂直滚动
                    try {
                        content.scrollTop = top;
                    } catch (e) { /* ignore */ }

                    // setTimeout as fallback
                    setTimeout(() => {
                        try {
                            content.scrollTop = Math.max(0, Math.min(content.scrollHeight - content.clientHeight, top));
                        } catch (e) { /* ignore */ }
                    }, 0);
                }
            });
        } catch (err) {
            console.warn('恢复滚动状态失败', err);
        } finally {
            this._savedScrollState = null;
        }
    }

    /**
     * 获取提醒的番茄钟计数（支持重复实例的单独计数）
     * @param reminderId 提醒ID
     * @returns 番茄钟计数
     */
    private async getReminderPomodoroCount(reminderId: string, reminder?: any, reminderData?: any): Promise<number> {
        try {
            const pomodoroManager = this.pomodoroRecordManager;
            // Repeat instances should be shown as per-instance totals
            if (reminder && reminder.isRepeatInstance) {
                return await pomodoroManager.getReminderPomodoroCount(reminderId);
            }

            let hasDescendants = false;
            if (reminder && this.getAllDescendantIds) {
                try {
                    let rawData = reminderData;
                    if (!rawData) {
                        rawData = await this.getReminders();
                    }
                    const reminderMap = rawData instanceof Map ? rawData : new Map(Object.values(rawData || {}).map((r: any) => [r.id, r]));
                    hasDescendants = this.getAllDescendantIds(reminder.id, reminderMap).length > 0;
                } catch (e) {
                    hasDescendants = false;
                }
            }

            if (hasDescendants) {
                if (typeof pomodoroManager.getAggregatedReminderPomodoroCount === 'function') {
                    return await pomodoroManager.getAggregatedReminderPomodoroCount(reminderId);
                }
                return await pomodoroManager.getReminderPomodoroCount(reminderId);
            }

            const isSubtask = reminder && reminder.parentId;
            if (isSubtask) {
                return await pomodoroManager.getReminderPomodoroCount(reminderId);
            }
            // For parent: return aggregated count
            if (typeof pomodoroManager.getAggregatedReminderPomodoroCount === 'function') {
                return await pomodoroManager.getAggregatedReminderPomodoroCount(reminderId);
            }
            return await pomodoroManager.getReminderPomodoroCount(reminderId);
        } catch (error) {
            console.error('获取番茄钟计数失败:', error);
            return 0;
        }
    }

    private async getReminderFocusTime(reminderId: string, reminder?: any, reminderData?: any): Promise<number> {
        try {
            const pomodoroManager = this.pomodoroRecordManager;
            // If repeat instance, use per-event total
            if (reminder && reminder.isRepeatInstance) {
                if (!pomodoroManager['isInitialized']) await pomodoroManager.initialize();
                if (typeof pomodoroManager.getEventTotalFocusTime === 'function') {
                    return pomodoroManager.getEventTotalFocusTime(reminderId);
                }
                if (typeof pomodoroManager.getEventFocusTime === 'function') {
                    return pomodoroManager.getEventFocusTime(reminderId);
                }
                return 0;
            }

            let hasDescendants = false;
            if (reminder && this.getAllDescendantIds) {
                try {
                    let rawData = reminderData;
                    if (!rawData) {
                        rawData = await this.getReminders();
                    }
                    const reminderMap = rawData instanceof Map ? rawData : new Map(Object.values(rawData || {}).map((r: any) => [r.id, r]));
                    hasDescendants = this.getAllDescendantIds(reminder.id, reminderMap).length > 0;
                } catch (e) {
                    hasDescendants = false;
                }
            }

            if (hasDescendants) {
                if (typeof pomodoroManager.getAggregatedReminderFocusTime === 'function') {
                    return await pomodoroManager.getAggregatedReminderFocusTime(reminderId);
                }
                if (typeof pomodoroManager.getEventTotalFocusTime === 'function') {
                    if (!pomodoroManager['isInitialized']) await pomodoroManager.initialize();
                    return pomodoroManager.getEventTotalFocusTime(reminderId);
                }
            }

            // default to per-event total
            if (typeof pomodoroManager.getEventTotalFocusTime === 'function') {
                if (!pomodoroManager['isInitialized']) await pomodoroManager.initialize();
                return pomodoroManager.getEventTotalFocusTime(reminderId);
            }
            return 0;
        } catch (error) {
            console.error('获取番茄钟总专注时长失败:', error);
            return 0;
        }
    }

    /**
     * 静态方法：计算给定项目的顶级任务在 kanbanStatus 上的数量（只计顶级，即没有 parentId）
     * 使用与 getTaskStatus 相同的逻辑，包括日期自动归档到进行中的逻辑
     */
    public static countTopLevelTasksByStatus(projectId: string, reminderData: any, kanbanStatuses?: Array<{ id: string; name?: string }>): { counts: Record<string, number>; completed: number } {
        const allReminders = reminderData && typeof reminderData === 'object' ? Object.values(reminderData) : [];
        const today = getLogicalDateString();

        // Build initial counts map based on provided kanbanStatuses or fallback to legacy keys
        const counts: Record<string, number> = {};
        if (kanbanStatuses && Array.isArray(kanbanStatuses) && kanbanStatuses.length > 0) {
            kanbanStatuses.forEach(s => counts[s.id] = 0);
            if (!counts['completed']) counts['completed'] = 0;
        } else {
            counts['doing'] = 0;
            counts['short_term'] = 0;
            counts['long_term'] = 0;
            counts['completed'] = 0;
        }

        const firstNonCompletedStatus = Object.keys(counts).find(k => k !== 'completed') || null;

        const safeInc = (statusId: string | null) => {
            if (!statusId) {
                if (firstNonCompletedStatus) counts[firstNonCompletedStatus] = (counts[firstNonCompletedStatus] || 0) + 1;
                return;
            }
            if (counts.hasOwnProperty(statusId)) counts[statusId] = (counts[statusId] || 0) + 1;
            else if (firstNonCompletedStatus) counts[firstNonCompletedStatus] = (counts[firstNonCompletedStatus] || 0) + 1;
        };

        allReminders.forEach((r: any) => {
            if (!r || typeof r !== 'object') return;
            const hasParent = r.hasOwnProperty('parentId') && r.parentId !== undefined && r.parentId !== null && String(r.parentId).trim() !== '';
            if (r.projectId !== projectId || hasParent) return;

            const isCompletedFlag = !!r.completed || (r.completedTime !== undefined && r.completedTime !== null && String(r.completedTime).trim() !== '');

            if (r.repeat && r.repeat.enabled) {
                const completedInstances = r.repeat.completedInstances || [];
                const instanceModifications = r.repeat.instanceModifications || {};

                const rangeStart = r.startDate || r.date || r.createdTime?.split('T')[0] || '2020-01-01';
                const futureDate = new Date();
                futureDate.setDate(futureDate.getDate() + 365);
                const rangeEnd = getLocalDateString(futureDate);

                let repeatInstances: any[] = [];
                try {
                    repeatInstances = generateRepeatInstances(r, rangeStart, rangeEnd);
                } catch (e) {
                    console.error('生成重复实例失败', e);
                    repeatInstances = [];
                }

                let hasTodayIncomplete = false;
                const futureIncompleteList: any[] = [];

                repeatInstances.forEach((instance: any) => {
                    const instanceIdStr = (instance as any).instanceId || `${r.id}_${instance.date}`;
                    const originalKey = instanceIdStr.split('_').pop() || instance.date;
                    const isInstanceCompleted = completedInstances.includes(originalKey);
                    const instanceMod = instanceModifications[originalKey] || {};

                    const instanceLogical = this.getTaskLogicalDate(instance.date, instance.time);
                    const dateComparison = compareDateStrings(instanceLogical, today);

                    if (isInstanceCompleted) {
                        counts['completed'] = (counts['completed'] || 0) + 1;
                    } else {
                        const effectiveStatus = instanceMod.kanbanStatus || r.kanbanStatus || null;
                        if (dateComparison <= 0) {
                            // past or today -> prefer a 'doing' status if present
                            if (counts.hasOwnProperty('doing')) safeInc('doing');
                            else safeInc(effectiveStatus);
                            if (dateComparison === 0) hasTodayIncomplete = true;
                        } else {
                            futureIncompleteList.push({ ...instance, kanbanStatus: effectiveStatus });
                        }
                    }
                });

                if (!hasTodayIncomplete && futureIncompleteList.length > 0) {
                    const firstFuture = futureIncompleteList[0];
                    const eff = firstFuture.kanbanStatus || null;
                    if (eff) safeInc(eff);
                    else if (firstFuture.termType === 'long_term' && counts.hasOwnProperty('long_term')) safeInc('long_term');
                    else if (counts.hasOwnProperty('short_term')) safeInc('short_term');
                    else safeInc(null);
                }

            } else {
                if (isCompletedFlag) {
                    counts['completed'] = (counts['completed'] || 0) + 1;
                    return;
                }

                const eff = r.kanbanStatus || null;
                if (eff && eff !== 'completed') {
                    safeInc(eff);
                    return;
                }

                if (r.date) {
                    const logicalR = this.getTaskLogicalDate(r.date, r.time);
                    const dateComparison = compareDateStrings(logicalR, today);
                    if (dateComparison <= 0) {
                        if (counts.hasOwnProperty('doing')) safeInc('doing');
                        else safeInc(null);
                        return;
                    }
                }

                if (r.termType === 'long_term' && counts.hasOwnProperty('long_term')) {
                    safeInc('long_term');
                } else if (r.termType === 'doing' && counts.hasOwnProperty('doing')) {
                    safeInc('doing');
                } else if (counts.hasOwnProperty('short_term')) {
                    safeInc('short_term');
                } else {
                    safeInc(null);
                }
            }
        });

        return { counts, completed: counts['completed'] || 0 };
    }

    /**
     * 获取任务的看板状态
     * 优先使用kanbanStatus
     */
    private getTaskStatus(task: any): string {
        // 如果任务已完成，直接返回
        if (task.completed) return 'completed';

        // 优先依据任务的日期判断：如果任务设置了日期且为今天或过去，优先视为进行中
        if (task.date) {
            try {
                const today = getLogicalDateString();
                const dateComparison = compareDateStrings(this.getTaskLogicalDate(task.date, task.time), today);
                if (dateComparison <= 0) { // 今天或过去
                    return 'doing';
                }
            } catch (e) {
                // 解析错误时忽略，继续使用 kanbanStatus 或默认值
            }
        }

        // 如果有 kanbanStatus 且是有效的状态ID，使用之
        if (task.kanbanStatus && task.kanbanStatus !== 'completed') {
            const validStatus = this.kanbanStatuses.find(s => s.id === task.kanbanStatus);
            if (validStatus) return task.kanbanStatus;
        }

        // 默认返回进行中
        return 'doing';
    }

    private updateSortButtonTitle() {
        if (this.sortButton) {
            const sortNames = {
                'time': i18n('sortingTime'),
                'priority': i18n('sortingPriority'),
                'title': i18n('sortingTitle')
            };
            const orderNames = {
                'asc': i18n('ascendingOrder'),
                'desc': i18n('descendingOrder')
            };
            this.sortButton.title = `${i18n('sortBy')}: ${sortNames[this.currentSort]} (${orderNames[this.currentSortOrder]})`;
        }
    }

    private updateDoneSortButtonTitle() {
        if (this.doneSortButton) {
            const sortNames = {
                'completedTime': i18n('sortByCompletedTime'),
                'title': i18n('sortingTitle'),
                'priority': i18n('sortingPriority'),
                'time': i18n('sortBySetTime')
            };
            const orderNames = {
                'asc': i18n('ascendingOrder'),
                'desc': i18n('descendingOrder')
            };
            this.doneSortButton.title = `${i18n('sortBy')}: ${sortNames[this.doneSort] || i18n('sortByCompletedTime')} (${orderNames[this.doneSortOrder] || i18n('descendingOrder')})`;
        }
    }

    private sortTasks() {
        this.tasks.sort((a, b) => {
            let result = 0;

            switch (this.currentSort) {
                case 'priority':
                    result = this.compareByPriority(a, b);
                    break;
                case 'time':
                    result = this.compareByTime(a, b);
                    break;
                case 'title':
                    result = this.compareByTitle(a, b);
                    break;
                default:
                    result = this.compareByPriority(a, b);
            }

            // 优先级排序的结果相反
            if (this.currentSort === 'priority') {
                result = -result;
            }

            return this.currentSortOrder === 'desc' ? -result : result;
        });
    }

    private compareByPriority(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;

        // 1. 按优先级排序
        const priorityDiff = priorityB - priorityA; // 高优先级在前
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        // 2. 同优先级内按手动排序
        const sortA = a.sort || 0;
        const sortB = b.sort || 0;

        if (sortA !== sortB) {
            return sortA - sortB; // 手动排序值小的在前
        }

        // 3. 如果手动排序值也相同，按创建时间排序
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
    }

    private compareByTime(a: any, b: any): number {
        const dateA = a.date || '9999-12-31';
        const dateB = b.date || '9999-12-31';
        const timeA = a.time || '00:00';
        const timeB = b.time || '00:00';

        const datetimeA = `${dateA}T${timeA}`;
        const datetimeB = `${dateB}T${timeB}`;

        const timeCompare = datetimeA.localeCompare(datetimeB);
        if (timeCompare !== 0) {
            return timeCompare;
        }
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
    }

    private compareByTitle(a: any, b: any): number {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        const titleCompare = titleA.localeCompare(titleB, 'zh-CN');
        if (titleCompare !== 0) {
            return titleCompare;
        }
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
    }

    private compareByCompletedTime(a: any, b: any): number {
        const timeA = a.completedTime ? new Date(a.completedTime).getTime() : 0;
        const timeB = b.completedTime ? new Date(b.completedTime).getTime() : 0;
        if (timeA === timeB) {
            return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
        }
        return timeA - timeB;
    }

    private openCalendarForProject() {
        this.plugin.openCalendarTab({ projectFilter: this.projectId });
    }

    private sortDoneTasks(tasks: any[]): any[] {
        const sortedTasks = [...tasks];
        sortedTasks.sort((a, b) => {
            let result = 0;
            switch (this.doneSort) {
                case 'completedTime':
                    result = this.compareByCompletedTime(a, b);
                    break;
                case 'title':
                    result = this.compareByTitle(a, b);
                    break;
                case 'priority':
                    result = this.compareByPriority(a, b);
                    break;
                case 'time':
                    result = this.compareByTime(a, b);
                    break;
                default:
                    result = this.compareByCompletedTime(a, b);
            }

            if (this.doneSort === 'priority') {
                result = -result;
            }

            return this.doneSortOrder === 'desc' ? -result : result;
        });
        return sortedTasks;
    }

    private async renderKanban() {
        // 保存滚动位置（如果还没有被上层保存）
        if (!this._savedScrollState) this.captureScrollState();

        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (kanbanContainer) {
            // 只有在项目变了或者模式变了的时候才全量清空，避免水平滚动条跳动
            if (this._lastRenderedProjectId !== this.projectId || this._lastRenderMode !== this.kanbanMode) {
                kanbanContainer.innerHTML = '';
                this._lastRenderedProjectId = this.projectId;
                this._lastRenderMode = this.kanbanMode;
            }
        }

        if (this.kanbanMode === 'status') {
            await this.renderStatusKanban();
        } else {
            await this.renderCustomGroupKanban();
        }

        // 恢复滚动位置（如果有的话）
        this.restoreScrollState();
    }

    private async renderCustomGroupKanban() {
        // 使用项目管理器获取自定义分组
        const projectManager = this.projectManager;
        const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);

        // Sort groups by 'sort' field to ensure correct display order
        projectGroups.sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

        if (projectGroups.length === 0) {
            // 如果没有自定义分组，显示提示
            this.renderEmptyCustomGroupKanban();
            return;
        }

        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return;

        // 移除可能存在的空状态提示
        const emptyState = kanbanContainer.querySelector('.empty-custom-group-state');
        if (emptyState) {
            emptyState.remove();
        }

        // 按 kanbanStatuses 中定义的所有状态分组任务
        const statusTasks: { [status: string]: any[] } = {};
        this.kanbanStatuses.forEach(status => {
            if (status.id === 'completed') {
                // 已完成任务单独处理（按完成时间排序）
                const completed = this.tasks.filter(task => task.completed);
                completed.sort((a, b) => {
                    const timeA = a.completedTime ? new Date(a.completedTime).getTime() : 0;
                    const timeB = b.completedTime ? new Date(b.completedTime).getTime() : 0;
                    return timeB - timeA;
                });
                statusTasks[status.id] = completed;
            } else {
                // 未完成任务按状态分组
                statusTasks[status.id] = this.tasks.filter(task => !task.completed && this.getTaskStatus(task) === status.id);
            }
        });

        // 为每个自定义分组创建状态子列（使用 kanbanStatuses 中定义的所有状态）
        projectGroups.forEach((group: any) => {
            const groupStatusTasks: { [status: string]: any[] } = {};
            this.kanbanStatuses.forEach(status => {
                groupStatusTasks[status.id] = statusTasks[status.id].filter(task => task.customGroupId === group.id);
            });

            // 即使没有任务也要显示分组列
            this.renderCustomGroupColumnWithStatuses(group, groupStatusTasks);

            // 确保 DOM 顺序正确：通过重新 append 将列移动到正确的位置
            const columnId = `custom-group-${group.id}`;
            const column = kanbanContainer.querySelector(`.kanban-column-${columnId}`);
            if (column) {
                kanbanContainer.appendChild(column);
            }
        });

        // 处理未分组任务：仅在存在未分组任务时显示未分组列
        const ungroupedStatusTasks: { [status: string]: any[] } = {};
        let hasUngrouped = false;
        this.kanbanStatuses.forEach(status => {
            ungroupedStatusTasks[status.id] = statusTasks[status.id].filter(task => !task.customGroupId);
            if (ungroupedStatusTasks[status.id].length > 0) {
                hasUngrouped = true;
            }
        });

        if (hasUngrouped) {
            const ungroupedGroup = {
                id: 'ungrouped',
                name: '未分组',
                color: '#95a5a6',
                icon: '📋'
            };
            this.renderCustomGroupColumnWithStatuses(ungroupedGroup, ungroupedStatusTasks);

            // 确保未分组列在最后
            const ungroupedColumn = kanbanContainer.querySelector(`.kanban-column-custom-group-ungrouped`);
            if (ungroupedColumn) {
                kanbanContainer.appendChild(ungroupedColumn);
            }
        } else {
            // 如果没有未分组任务，移除可能存在的未分组列 DOM
            const existing = kanbanContainer.querySelector(`.kanban-column-custom-group-ungrouped`);
            if (existing && existing.parentNode) {
                existing.parentNode.removeChild(existing);
            }
        }

        // 为自定义分组列添加列级拖拽支持（可以直接拖动列头调整分组顺序）
        try {
            const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
            if (kanbanContainer && !kanbanContainer.dataset.hasColumnDropHandlers) {
                kanbanContainer.dataset.hasColumnDropHandlers = '1';

                kanbanContainer.addEventListener('dragover', (e) => {
                    try {
                        const dt = (e as DragEvent).dataTransfer;
                        if (!dt && !this.draggedGroupId) return;

                        let draggedId = '';
                        try { if (dt) draggedId = dt.getData('text/plain') || ''; } catch (err) { draggedId = ''; }
                        if (!draggedId) draggedId = this.draggedGroupId || '';
                        if (!draggedId) return;

                        e.preventDefault();
                        if (dt) dt.dropEffect = 'move';

                        // 清除已有指示器（DOM 中的）
                        if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                            this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
                            this._columnDropIndicator = null;
                        }

                        // 获取所有自定义分组列（含未分组），并过滤掉被拖拽的列
                        let columns = Array.from(kanbanContainer.querySelectorAll('.kanban-column')) as HTMLElement[];
                        columns = columns.filter(c => !!c.dataset.groupId);
                        columns = columns.filter(c => (c.dataset.groupId || '') !== draggedId);

                        const createIndicator = (beforeEl: HTMLElement | null) => {
                            const indicator = document.createElement('div');
                            indicator.className = 'column-drop-indicator';
                            indicator.style.cssText = `
                                width: 6px;
                                background-color: var(--b3-theme-primary);
                                border-radius: 3px;
                                margin: 0 6px;
                                align-self: stretch;
                            `;
                            if (beforeEl) kanbanContainer.insertBefore(indicator, beforeEl);
                            else kanbanContainer.appendChild(indicator);
                            this._columnDropIndicator = indicator;
                        };

                        if (columns.length === 0) {
                            createIndicator(null);
                            return;
                        }

                        const clientX = (e as DragEvent).clientX;
                        let inserted = false;
                        for (const col of columns) {
                            const rect = col.getBoundingClientRect();
                            const midpoint = rect.left + rect.width / 2;
                            if (clientX < midpoint) {
                                createIndicator(col);
                                inserted = true;
                                break;
                            }
                        }

                        if (!inserted) createIndicator(null);
                    } catch (err) {
                        // ignore
                    }
                });

                kanbanContainer.addEventListener('dragleave', (e) => {
                    const related = (e as any).relatedTarget as Node;
                    if (!related || !kanbanContainer.contains(related)) {
                        if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                            this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
                        }
                        this._columnDropIndicator = null;
                    }
                });

                kanbanContainer.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                        this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
                    }
                    this._columnDropIndicator = null;

                    let draggedId = (e as DragEvent).dataTransfer?.getData('text/plain') || '';
                    if (!draggedId) draggedId = this.draggedGroupId || '';
                    if (!draggedId) return;

                    try {
                        const projectManager = this.projectManager;
                        const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                        const draggedIndex = currentGroups.findIndex((g: any) => g.id === draggedId);
                        if (draggedIndex === -1) return;

                        // 基于鼠标位置计算插入索引（忽略被拖拽列）
                        let columns = Array.from(kanbanContainer.querySelectorAll('.kanban-column')) as HTMLElement[];
                        columns = columns.filter(c => !!c.dataset.groupId);
                        // 排除被拖拽的列 DOM
                        const columnsFiltered = columns.filter(c => (c.dataset.groupId || '') !== draggedId);

                        const clientX = (e as DragEvent).clientX;
                        let insertIndex = columnsFiltered.length; // 默认末尾
                        for (let i = 0; i < columnsFiltered.length; i++) {
                            const rect = columnsFiltered[i].getBoundingClientRect();
                            const midpoint = rect.left + rect.width / 2;
                            if (clientX < midpoint) { insertIndex = i; break; }
                        }

                        // 从原数组移除并插入到目标位置
                        const draggedGroup = currentGroups.splice(draggedIndex, 1)[0];
                        currentGroups.splice(insertIndex, 0, draggedGroup);

                        // 重新分配排序值并保存
                        currentGroups.forEach((g: any, index: number) => { g.sort = index * 10; });
                        await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                        // 刷新看板（使用防抖队列以避免滚动位置被重置）
                        this.queueLoadTasks();
                        showMessage('分组顺序已更新');
                    } catch (error) {
                        console.error('更新自定义分组顺序失败:', error);
                        showMessage('更新分组顺序失败');
                    }
                });
            }
        } catch (err) {
            // ignore
        }
    }

    private async renderStatusKanban() {
        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return;

        // 确保状态列存在，如果不存在才创建
        this.ensureStatusColumnsExist(kanbanContainer);

        // 按任务状态分组 - 使用kanbanStatuses中定义的所有状态
        const statusTasks: { [status: string]: any[] } = {};
        this.kanbanStatuses.forEach(status => {
            statusTasks[status.id] = this.tasks.filter(task => this.getTaskStatus(task) === status.id);
        });

        // 渲染带分组的任务（在稳定的子分组容器内）
        for (const status of this.kanbanStatuses) {
            if (status.id === 'completed') {
                const sortedDoneTasks = this.sortDoneTasks(statusTasks[status.id] || []);
                await this.renderStatusColumnWithStableGroups('completed', sortedDoneTasks);
                this.showColumn('completed');
            } else {
                await this.renderStatusColumnWithStableGroups(status.id, statusTasks[status.id] || []);
            }
        }
    }

    private ensureStatusColumnsExist(kanbanContainer: HTMLElement) {
        // 检查并创建必要的状态列 - 使用kanbanStatuses中定义的状态
        this.kanbanStatuses.forEach(status => {
            let column = kanbanContainer.querySelector(`.kanban-column-${status.id}`) as HTMLElement;
            if (!column) {
                column = this.createKanbanColumn(kanbanContainer, status.id, status.name, status.color);
            } else {
                // 更新现有列的标题和图标
                const titleEl = column.querySelector('.kanban-column-header h3') as HTMLElement;
                if (titleEl) {
                    const emoji = status.icon || '';
                    titleEl.textContent = emoji ? `${emoji}${status.name}` : status.name;
                }
                // 更新列标题颜色
                const header = column.querySelector('.kanban-column-header') as HTMLElement;
                if (header) {
                    header.style.background = `${status.color}15`;
                }
            }
            // 确保列有稳定的子分组容器结构
            this.ensureColumnHasStableGroups(column, status.id);
        });
    }

    private ensureColumnHasStableGroups(column: HTMLElement, status: string) {
        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        if (!content) return;

        // 检查是否已有稳定的分组容器
        let groupsContainer = content.querySelector('.status-column-stable-groups') as HTMLElement;
        if (!groupsContainer) {
            // 创建稳定的分组容器
            groupsContainer = document.createElement('div');
            groupsContainer.className = 'status-column-stable-groups';
            groupsContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 16px;
            `;

            // 根据状态列类型创建相应的子分组
            const groupConfigs = this.getGroupConfigsForStatus(status);

            groupConfigs.forEach(config => {
                const groupContainer = this.createStableStatusGroup(config);
                groupsContainer.appendChild(groupContainer);
            });

            // 清空内容并添加分组容器
            content.innerHTML = '';
            content.appendChild(groupsContainer);
        }
    }

    private getGroupConfigsForStatus(statusId: string): Array<{ status: string, label: string, icon: string }> {
        // 从kanbanStatuses中查找对应的状态配置
        const status = this.kanbanStatuses.find(s => s.id === statusId);
        if (!status) return [];

        // 默认图标映射（当 kanbanStatuses 中没有设置图标时使用）
        const defaultIcons: { [key: string]: string } = {
            'doing': '⏳',
            'short_term': '📋',
            'long_term': '🤔',
            'completed': '✅'
        };

        return [{
            status: statusId,
            label: status.name,
            icon: status.icon || defaultIcons[statusId] || '📋'
        }];
    }

    private createStableStatusGroup(config: { status: string, label: string, icon: string }): HTMLElement {
        const groupContainer = document.createElement('div');
        groupContainer.className = `status-stable-group status-stable-${config.status}`;
        groupContainer.dataset.status = config.status;

        // 分组任务容器
        const groupTasksContainer = document.createElement('div');
        groupTasksContainer.className = 'status-stable-group-tasks';
        groupTasksContainer.style.cssText = `
            padding-left: 8px; padding-right: 8px;
            padding-top: 8px;
            min-height: 20px;
        `;

        // 为非已完成分组添加拖放事件
        if (config.status !== 'completed') {
            this.addStatusSubGroupDropEvents(groupTasksContainer, config.status);
        }

        groupContainer.appendChild(groupTasksContainer);

        return groupContainer;
    }

    private async renderStatusColumnWithStableGroups(status: string, tasks: any[]) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (!column) return;

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const count = column.querySelector('.kanban-column-count') as HTMLElement;

        // 获取稳定的分组容器
        const groupsContainer = content.querySelector('.status-column-stable-groups') as HTMLElement;
        if (!groupsContainer) return;

        // 获取项目自定义分组
        // 注意：这里我们简化处理，如果有自定义分组，则按分组渲染；否则直接在状态子分组中渲染任务
        // 为了保持向后兼容，我们仍然支持自定义分组的显示逻辑

        // 检查是否有自定义分组
        const hasCustomGroups = await this.hasProjectCustomGroups();

        if (hasCustomGroups) {
            // 如果有自定义分组，使用原有的分组渲染逻辑
            this.renderTasksGroupedByCustomGroupInStableContainer(groupsContainer, tasks, status);
        } else {
            // 如果没有自定义分组，直接在状态子分组中渲染任务
            this.renderTasksInStableStatusGroups(groupsContainer, tasks, status);
        }

        // 更新列顶部计数
        if (count) {
            const taskMap = new Map(tasks.map(t => [t.id, t]));
            const topLevelTasks = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
            count.textContent = topLevelTasks.length.toString();
        }
    }

    private async hasProjectCustomGroups(): Promise<boolean> {
        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
            return projectGroups.length > 0;
        } catch (error) {
            console.error('检查项目分组失败:', error);
            return false;
        }
    }

    private renderTasksInStableStatusGroups(groupsContainer: HTMLElement, tasks: any[], status: string) {
        // 获取对应的状态分组容器
        const groupContainer = groupsContainer.querySelector(`.status-stable-group[data-status="${status}"]`) as HTMLElement;
        if (!groupContainer) return;

        const groupTasksContainer = groupContainer.querySelector('.status-stable-group-tasks') as HTMLElement;
        const taskCount = groupContainer.querySelector('.status-stable-group-count') as HTMLElement;

        // 清空任务容器并重新渲染任务
        // 锁定高度防止抖动
        const oldHeight = groupTasksContainer.offsetHeight;
        if (oldHeight > 0) groupTasksContainer.style.minHeight = `${oldHeight}px`;

        groupTasksContainer.innerHTML = '';
        this.renderTasksInColumn(groupTasksContainer, tasks);

        // 恢复高度
        if (oldHeight > 0) {
            requestAnimationFrame(() => {
                groupTasksContainer.style.minHeight = '';
            });
        }

        // 更新分组任务计数
        if (taskCount) {
            const taskMap = new Map(tasks.map(t => [t.id, t]));
            const topLevelTasks = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
            taskCount.textContent = topLevelTasks.length.toString();
        }
    }

    private async renderTasksGroupedByCustomGroupInStableContainer(groupsContainer: HTMLElement, tasks: any[], status: string) {
        // 获取项目自定义分组
        const projectManager = this.projectManager;
        const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
        // Sort groups by 'sort' field
        projectGroups.sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

        // 获取对应的状态分组容器
        const groupContainer = groupsContainer.querySelector(`.status-stable-group[data-status="${status}"]`) as HTMLElement;
        if (!groupContainer) return;

        const groupTasksContainer = groupContainer.querySelector('.status-stable-group-tasks') as HTMLElement;
        const taskCount = groupContainer.querySelector('.status-stable-group-count') as HTMLElement;

        // 在状态分组容器内渲染自定义分组
        // 锁定高度防止抖动
        const oldHeight = groupTasksContainer.offsetHeight;
        if (oldHeight > 0) groupTasksContainer.style.minHeight = `${oldHeight}px`;

        groupTasksContainer.innerHTML = '';

        if (projectGroups.length === 0) {
            // 如果没有自定义分组，直接渲染任务
            this.renderTasksInColumn(groupTasksContainer, tasks);
        } else {
            // 按自定义分组渲染任务组
            const groupsSubContainer = document.createElement('div');
            groupsSubContainer.className = 'status-column-groups-in-stable';
            groupsSubContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 12px;
            `;

            // 为每个自定义分组创建子容器
            const isCollapsedDefault = status === 'completed';
            projectGroups.forEach((group: any) => {
                const groupTasks = tasks.filter(task => task.customGroupId === group.id);
                if (groupTasks.length > 0) {
                    const groupSubContainer = this.createCustomGroupInStatusColumn(group, groupTasks, isCollapsedDefault, status);
                    groupsSubContainer.appendChild(groupSubContainer);
                }
            });

            // 添加未分组任务
            const ungroupedTasks = tasks.filter(task => !task.customGroupId);
            if (ungroupedTasks.length > 0) {
                const ungroupedGroup = {
                    id: 'ungrouped',
                    name: '未分组',
                    color: '#95a5a6',
                    icon: '📋'
                };
                const isCollapsedDefault = status === 'completed';
                const ungroupedContainer = this.createCustomGroupInStatusColumn(ungroupedGroup, ungroupedTasks, isCollapsedDefault, status);
                groupsSubContainer.appendChild(ungroupedContainer);
            }

            groupTasksContainer.appendChild(groupsSubContainer);
        }

        // 恢复高度
        if (oldHeight > 0) {
            requestAnimationFrame(() => {
                groupTasksContainer.style.minHeight = '';
            });
        }

        // 更新分组任务计数
        if (taskCount) {
            taskCount.textContent = tasks.length.toString();
        }
    }


    private renderEmptyCustomGroupKanban() {
        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return;

        kanbanContainer.innerHTML = `
            <div class="empty-custom-group-state" style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 300px;
                color: var(--b3-theme-on-surface);
                opacity: 0.6;
                width: 100%;
            ">
                <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
                <div style="font-size: 16px; margin-bottom: 8px;">暂无自定义分组</div>
                <div style="font-size: 14px;">请在项目设置中添加自定义分组</div>
            </div>
        `;
    }

    private renderColumn(status: string, tasks: any[]) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (!column) return;

        // If this is a configured kanban status (including custom ones), use the stable groups renderer
        // This prevents destroying the grouping structure and avoids duplicating header buttons
        if (this.kanbanStatuses && this.kanbanStatuses.find(s => s.id === status)) {
            this.ensureColumnHasStableGroups(column, status);
            this.renderStatusColumnWithStableGroups(status, tasks).catch(err => console.error('Render stable group failed:', err));
            return;
        }

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        let count = column.querySelector('.kanban-column-count') as HTMLElement;

        // 确保 header 上存在右侧容器（计数 + 新建按钮），如果列是旧的没有该按钮，则创建它
        const header = column.querySelector('.kanban-column-header') as HTMLElement;
        if (header) {
            let headerRight = header.querySelector('.custom-header-right') as HTMLElement | null;
            if (!headerRight) {
                // 如果 count 元素不存在（可能是旧列），尝试创建新的 count
                if (!count) {
                    count = document.createElement('span');
                    count.className = 'kanban-column-count';

                    // 尝试从标题获取颜色作为计数背景色
                    const titleEl = header.querySelector('h3') as HTMLElement | null;
                    const titleColor = titleEl?.style?.color || 'var(--b3-theme-primary)';

                    count.style.cssText = `
                        background: ${titleColor};
                        color: white;
                        border-radius: 12px;
                        padding: 2px 8px;
                        font-size: 12px;
                        font-weight: 500;
                        min-width: 20px;
                        text-align: center;
                    `;
                }

                headerRight = document.createElement('div');
                headerRight.className = 'custom-header-right';
                headerRight.style.cssText = 'display:flex; align-items:center; gap:8px;';
                headerRight.appendChild(count);

                // 不在已完成列显示新建按钮
                if (status !== 'completed') {
                    const addGroupTaskBtn = document.createElement('button');
                    addGroupTaskBtn.className = 'b3-button b3-button--small b3-button--primary';
                    addGroupTaskBtn.style.cssText = 'margin-left:8px;';
                    addGroupTaskBtn.title = i18n('newTask');
                    addGroupTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>`;
                    addGroupTaskBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // 直接把列的 status 作为默认状态传入（支持自定义状态 id）
                        this.showCreateTaskDialog(undefined, this.lastSelectedCustomGroupId, status);
                    });

                    headerRight.appendChild(addGroupTaskBtn);
                }
                header.appendChild(headerRight);
            }
        }

        content.innerHTML = '';

        // 为了确保父任务下显示所有后代（包括已完成的子任务），扩展传入的任务列表
        const expandedTasks = this.augmentTasksWithDescendants(tasks);
        const taskMap = new Map(expandedTasks.map(t => [t.id, t]));
        const topLevelTasks = expandedTasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
        const childTasks = expandedTasks.filter(t => t.parentId && taskMap.has(t.parentId));

        // 分页计算
        const totalTop = topLevelTasks.length;
        const totalPages = Math.max(1, Math.ceil(totalTop / this.pageSize));
        const currentPage = Math.min(Math.max(1, this.pageIndexMap[status] || 1), totalPages);

        const startIdx = (currentPage - 1) * this.pageSize;
        const endIdx = startIdx + this.pageSize;
        const pagedTopLevel = topLevelTasks.slice(startIdx, endIdx);

        const renderTaskWithChildren = (task: any, level: number) => {
            const taskEl = this.createTaskElement(task, level);
            content.appendChild(taskEl);

            const children = childTasks.filter(t => t.parentId === task.id);
            const isCollapsed = this.collapsedTasks.has(task.id);

            if (children.length > 0 && !isCollapsed) {
                children.forEach(child => renderTaskWithChildren(child, level + 1));
            }
        };

        pagedTopLevel.forEach(task => renderTaskWithChildren(task, 0));

        // 更新列顶部计数为仅统计顶层任务数量
        if (count) {
            count.textContent = totalTop.toString();
        }

        // 渲染分页控件：仅在顶层任务数量超过 pageSize 时显示分页
        const pagination = column.querySelector('.kanban-column-pagination') as HTMLElement;
        if (pagination) {
            // 如果不需要分页，则隐藏分页容器
            if (totalTop <= this.pageSize) {
                pagination.innerHTML = '';
                pagination.style.display = 'none';
            } else {
                pagination.style.display = 'flex';
                pagination.innerHTML = '';

                // 上一页按钮
                const prevBtn = document.createElement('button');
                prevBtn.className = 'b3-button b3-button--text';
                prevBtn.textContent = '上一页';
                prevBtn.disabled = currentPage <= 1;
                prevBtn.addEventListener('click', () => {
                    this.pageIndexMap[status] = Math.max(1, currentPage - 1);
                    this.queueLoadTasks();
                });
                pagination.appendChild(prevBtn);

                // 页码信息
                const pageInfo = document.createElement('div');
                pageInfo.style.cssText = 'min-width: 120px; text-align: center; font-size: 13px; color: var(--b3-theme-on-surface);';
                pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页（共 ${totalTop} 项）`;
                pagination.appendChild(pageInfo);

                // 下一页按钮
                const nextBtn = document.createElement('button');
                nextBtn.className = 'b3-button b3-button--text';
                nextBtn.textContent = '下一页';
                nextBtn.disabled = currentPage >= totalPages;
                nextBtn.addEventListener('click', () => {
                    this.pageIndexMap[status] = Math.min(totalPages, currentPage + 1);
                    this.queueLoadTasks();
                });
                pagination.appendChild(nextBtn);
            }
        }
    }

    private renderCustomGroupColumn(group: any, tasks: any[]) {
        // 按 kanbanStatuses 中定义的所有状态分组任务
        const statusTasks: { [status: string]: any[] } = {};
        this.kanbanStatuses.forEach(status => {
            if (status.id === 'completed') {
                // 已完成任务单独处理（按完成时间排序）
                const completed = tasks.filter(task => task.completed);
                completed.sort((a, b) => {
                    const timeA = a.completedTime ? new Date(a.completedTime).getTime() : 0;
                    const timeB = b.completedTime ? new Date(b.completedTime).getTime() : 0;
                    return timeB - timeA;
                });
                statusTasks[status.id] = completed;
            } else {
                // 未完成任务按状态分组
                statusTasks[status.id] = tasks.filter(task => !task.completed && this.getTaskStatus(task) === status.id);
            }
        });

        this.renderCustomGroupColumnWithStatuses(group, statusTasks);
    }

    private createCustomGroupColumn(columnId: string, group: any): HTMLElement {
        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return document.createElement('div');

        const column = document.createElement('div');
        column.className = `kanban-column kanban-column-${columnId}`;
        column.dataset.groupId = group.id;

        // 列标题
        const header = document.createElement('div');
        header.className = 'kanban-column-header';
        header.style.cssText = `
            padding: 12px 16px;
            border-bottom: 1px solid var(--b3-theme-border);
            background: ${group.color}15;
            border-radius: 8px 8px 0 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
        `;

        const titleContainer = document.createElement('div');
        titleContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        const titleEl = document.createElement('h3');
        // 显示分组的 emoji（如果有），然后显示名称
        const groupIconEl = document.createElement('span');
        groupIconEl.className = 'custom-group-header-icon';
        groupIconEl.style.cssText = `margin-right:6px;`;
        groupIconEl.textContent = group.icon || '📋';
        titleContainer.appendChild(groupIconEl);

        titleEl.textContent = group.name;
        titleEl.style.cssText = `
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: ${group.color};
        `;

        // 如果分组绑定了块ID，添加预览和跳转功能
        if (group.blockId) {
            titleEl.dataset.type = 'a';
            titleEl.dataset.href = `siyuan://blocks/${group.blockId}`;
            titleEl.style.cursor = 'pointer';
            titleEl.style.textDecoration = 'underline dotted';
            titleEl.style.paddingBottom = '2px';
            titleEl.title = i18n('clickToJumpToBlock');
            titleEl.addEventListener('click', (e) => {
                e.stopPropagation();
                openBlock(group.blockId);
            });
        }

        titleContainer.appendChild(titleEl);

        const countEl = document.createElement('span');
        countEl.className = 'kanban-column-count';
        countEl.style.cssText = `
            background: ${group.color};
            color: white;
            border-radius: 12px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 500;
            min-width: 20px;
            text-align: center;
        `;

        header.appendChild(titleContainer);

        // 新建任务按钮（对应该自定义分组）
        const addGroupTaskBtn = document.createElement('button');
        addGroupTaskBtn.className = 'b3-button b3-button--outline';
        addGroupTaskBtn.style.cssText = 'margin-left:8px;';
        addGroupTaskBtn.title = i18n('newTask');
        addGroupTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>`;
        addGroupTaskBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const gid = group.id === 'ungrouped' ? null : group.id;
            this.showCreateTaskDialog(undefined, gid);
        });

        // 粘贴新建任务按钮（对应该自定义分组）
        const pasteGroupTaskBtn = document.createElement('button');
        pasteGroupTaskBtn.className = 'b3-button b3-button--outline';
        pasteGroupTaskBtn.title = i18n('pasteNew');
        pasteGroupTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>`;
        pasteGroupTaskBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const gid = group.id === 'ungrouped' ? null : group.id;
            // 显示选择器
            this.showPasteTaskDialog(undefined, gid, undefined, true);
        });

        const headerRight = document.createElement('div');
        headerRight.className = 'custom-header-right';
        headerRight.style.cssText = 'display:flex; align-items:center; gap:8px;';
        headerRight.appendChild(countEl);
        headerRight.appendChild(addGroupTaskBtn);
        headerRight.appendChild(pasteGroupTaskBtn);

        header.appendChild(headerRight);

        // 使列头可以拖拽以调整分组顺序（直接在看板中拖动 header 调整顺序）
        header.draggable = true;
        header.dataset.groupId = group.id;

        header.addEventListener('dragstart', (e) => {
            this.draggedGroupId = group.id;
            column.style.opacity = '0.5';
            try {
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', group.id);
                }
            } catch (err) {
                // ignore
            }
        });

        header.addEventListener('dragend', () => {
            this.draggedGroupId = null;
            column.style.opacity = '';
            // 清除列插入指示器
            if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
            }
            this._columnDropIndicator = null;
        });

        // 列内容
        const content = document.createElement('div');
        content.className = 'kanban-column-content';
        content.style.cssText = `
            flex: 1;
            padding: 0px;
            overflow-y: auto;
            min-height: 200px;
            margin-top: 8px;
        `;

        column.appendChild(header);
        column.appendChild(content);

        // 为自定义分组列添加拖拽事件（设置分组）
        // 如果是未分组列，传入 null 以表示移除分组目标
        const targetGroupId = group.id === 'ungrouped' ? null : group.id;
        this.addCustomGroupDropZoneEvents(content, targetGroupId);

        kanbanContainer.appendChild(column);
        return column;
    }

    private renderUngroupedColumn(tasks: any[]) {
        const ungroupedGroup = {
            id: 'ungrouped',
            name: '未分组',
            color: '#95a5a6',
            icon: '📋'
        };
        this.renderCustomGroupColumn(ungroupedGroup, tasks);
    }

    private renderCustomGroupColumnWithStatuses(group: any, statusTasks: { [status: string]: any[] }) {
        const columnId = `custom-group-${group.id}`;
        let column = this.container.querySelector(`.kanban-column-${columnId}`) as HTMLElement;

        if (!column) {
            // 如果列不存在，创建新列
            column = this.createCustomGroupColumn(columnId, group);
        }

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const count = column.querySelector('.kanban-column-count') as HTMLElement;

        // 锁定高度防止抖动
        const oldHeight = content.offsetHeight;
        if (oldHeight > 0) content.style.minHeight = `${oldHeight}px`;

        content.innerHTML = '';

        // 创建分组容器（参考状态分组样式）
        const groupsContainer = document.createElement('div');
        groupsContainer.className = 'custom-group-status-container';
        groupsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 16px;
        `;

        // 按 kanbanStatuses 顺序创建所有状态分组
        const expandedTasksMap: { [status: string]: any[] } = {};
        const nonCompletedIncludedIds = new Set<string>();

        // 第一遍：收集所有非已完成状态的扩展任务，用于过滤已完成的重复任务
        this.kanbanStatuses.forEach(status => {
            if (status.id !== 'completed') {
                const tasks = statusTasks[status.id] || [];
                expandedTasksMap[status.id] = this.augmentTasksWithDescendants(tasks, group.id);
                expandedTasksMap[status.id].forEach(t => nonCompletedIncludedIds.add(t.id));
            }
        });

        // 第二遍：创建所有状态分组
        this.kanbanStatuses.forEach(status => {
            let tasks: any[];
            if (status.id === 'completed') {
                // 已完成任务需要过滤掉已经在其他分组中显示的任务
                const completedTasks = statusTasks[status.id] || [];
                tasks = completedTasks.filter(t => !nonCompletedIncludedIds.has(t.id));
            } else {
                tasks = expandedTasksMap[status.id] || [];
            }

            const statusGroupContainer = this.createStatusGroupInCustomColumn(
                group,
                tasks,
                status.id,
                status.name
            );
            groupsContainer.appendChild(statusGroupContainer);
        });

        content.appendChild(groupsContainer);

        // 恢复高度
        if (oldHeight > 0) {
            requestAnimationFrame(() => {
                content.style.minHeight = '';
            });
        }

        // 更新列顶部计数 — 只统计顶层（父）任务，不包括子任务
        if (count) {
            let allTasks: any[] = [];
            this.kanbanStatuses.forEach(status => {
                if (status.id === 'completed') {
                    const completedTasks = statusTasks[status.id] || [];
                    allTasks.push(...completedTasks.filter(t => !nonCompletedIncludedIds.has(t.id)));
                } else {
                    allTasks.push(...(expandedTasksMap[status.id] || []));
                }
            });
            const mapCombined = new Map(allTasks.map((t: any) => [t.id, t]));
            const topLevelCombined = allTasks.filter((t: any) => !t.parentId || !mapCombined.has(t.parentId));
            count.textContent = topLevelCombined.length.toString();
        }
    }

    private createStatusGroupInCustomColumn(group: any, tasks: any[], status: string, statusLabel: string): HTMLElement {
        const groupContainer = document.createElement('div');
        groupContainer.className = `custom-status-group custom-status-${status}`;
        groupContainer.dataset.groupId = group.id;
        groupContainer.dataset.status = status;

        // 从 kanbanStatuses 获取状态配置（颜色、图标）
        const statusConfig = this.kanbanStatuses.find(s => s.id === status);
        const statusColor = statusConfig?.color || group.color;

        // 分组标题（参考状态分组下的自定义分组样式）
        const groupHeader = document.createElement('div');
        groupHeader.className = 'custom-status-group-header';
        groupHeader.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: ${statusColor}15;
            border: 1px solid ${statusColor}30;
            border-radius: 6px;
            cursor: pointer;
            position: sticky;
            top: 0;
            z-index: 10;
        `;

        const groupTitle = document.createElement('div');
        groupTitle.className = 'custom-status-group-title';
        groupTitle.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            color: ${statusColor};
            font-size: 13px;
        `;

        const groupIcon = document.createElement('span');
        // 对于自定义分组下的状态子分组，使用不同的固定图标
        const defaultIcons: { [key: string]: string } = {
            'doing': '⏳',
            'short_term': '📋',
            'long_term': '🤔',
            'completed': '✅',
            'incomplete': '🗓'
        };
        // 优先使用 kanbanStatuses 中设置的图标，其次使用默认图标
        groupIcon.textContent = statusConfig?.icon || defaultIcons[status] || '📋';
        groupTitle.appendChild(groupIcon);

        const groupName = document.createElement('span');
        groupName.textContent = statusLabel;
        groupTitle.appendChild(groupName);

        const taskCount = document.createElement('span');
        taskCount.className = 'custom-status-group-count';
        // 所有状态分组都只显示顶层任务数量
        const taskMapLocal = new Map(tasks.map((t: any) => [t.id, t]));
        const topLevel = tasks.filter((t: any) => !t.parentId || !taskMapLocal.has(t.parentId));
        taskCount.textContent = topLevel.length.toString();
        taskCount.style.cssText = `
            background: ${statusColor};
            color: white;
            border-radius: 10px;
            padding: 2px 6px;
            font-size: 11px;
            font-weight: 500;
            min-width: 18px;
            text-align: center;
        `;

        groupHeader.appendChild(groupTitle);

        const headerRight = document.createElement('div');
        headerRight.style.cssText = 'display:flex; align-items:center; gap:8px;';
        headerRight.appendChild(taskCount);

        // 为所有非"已完成"状态添加新建按钮和粘贴新建按钮
        if (status !== 'completed') {
            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'b3-button b3-button--text';
            addTaskBtn.style.cssText = 'padding: 2px; margin-left: 4px;';
            addTaskBtn.title = i18n('newTask');
            addTaskBtn.innerHTML = `<svg style="width: 14px; height: 14px;"><use xlink:href="#iconAdd"></use></svg>`;
            addTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showCreateTaskDialog(undefined, group.id, status as any);
            });
            headerRight.appendChild(addTaskBtn);

            const pasteTaskBtn = document.createElement('button');
            pasteTaskBtn.className = 'b3-button b3-button--text';
            pasteTaskBtn.style.cssText = 'padding: 2px; margin-left: 2px;';
            pasteTaskBtn.title = i18n('pasteNew');
            pasteTaskBtn.innerHTML = `<svg style="width: 14px; height: 14px;"><use xlink:href="#iconPaste"></use></svg>`;
            pasteTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // 显示选择器
                this.showPasteTaskDialog(undefined, group.id, status as any, true);
            });
            headerRight.appendChild(pasteTaskBtn);
        }

        groupHeader.appendChild(headerRight);

        // 分组任务容器
        const groupTasksContainer = document.createElement('div');
        groupTasksContainer.className = 'custom-status-group-tasks';
        groupTasksContainer.style.cssText = `
            padding-left: 8px; padding-right: 8px;
            padding-top: 8px; /* 添加一点顶部间距 */
            min-height: 20px; /* 确保即使没有任务也有拖放区域 */
        `;

        // 为子分组添加拖放事件处理器
        this.addStatusSubGroupDropEvents(groupTasksContainer, status);


        // 折叠按钮
        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'b3-button b3-button--text custom-status-group-collapse-btn';
        collapseBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconDown"></use></svg>';
        collapseBtn.title = '折叠分组';
        collapseBtn.style.cssText = `
            padding: 2px;
            min-width: auto;
            margin-right: 4px;
        `;

        const groupKey = `${group.id}-${status}`;
        // 检查是否已有明确的折叠/展开记录
        let isCollapsed = false;
        if (this.collapsedStatusGroups.has(groupKey)) {
            isCollapsed = true;
        } else if (this.expandedStatusGroups.has(groupKey)) {
            isCollapsed = false;
        } else {
            // 没有任何记录，则使用默认值
            isCollapsed = status === 'completed';
        }

        // 设置初始显示状态
        groupTasksContainer.style.display = isCollapsed ? 'none' : 'block';
        collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
        collapseBtn.title = isCollapsed ? '展开分组' : '折叠分组';

        collapseBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            groupTasksContainer.style.display = isCollapsed ? 'none' : 'block';
            collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
            collapseBtn.title = isCollapsed ? '展开分组' : '折叠分组';

            // 更新持久化状态
            if (isCollapsed) {
                this.collapsedStatusGroups.add(groupKey);
                this.expandedStatusGroups.delete(groupKey);
            } else {
                this.collapsedStatusGroups.delete(groupKey);
                this.expandedStatusGroups.add(groupKey);
            }
        });

        groupTitle.insertBefore(collapseBtn, groupIcon);

        groupContainer.appendChild(groupHeader);

        // 渲染任务
        this.renderTasksInColumn(groupTasksContainer, tasks);

        groupContainer.appendChild(groupTasksContainer);

        return groupContainer;
    }

    private async renderStatusColumnWithGroups(status: string, tasks: any[]) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (!column) return;

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const count = column.querySelector('.kanban-column-count') as HTMLElement;

        content.innerHTML = '';

        // 获取项目自定义分组
        const { ProjectManager } = await import('../utils/projectManager');
        const projectManager = ProjectManager.getInstance(this.plugin);
        const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);

        if (projectGroups.length === 0) {
            // 如果没有自定义分组，直接渲染任务
            this.renderTasksInColumn(content, tasks);
        } else {
            // 按自定义分组渲染任务组
            this.renderTasksGroupedByCustomGroup(content, tasks, projectGroups);
        }

        // 更新列顶部计数
        if (count) {
            count.textContent = tasks.length.toString();
        }
    }

    private renderTasksInColumn(content: HTMLElement, tasks: any[]) {
        const taskMap = new Map(tasks.map(t => [t.id, t]));
        const topLevelTasks = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
        const childTasks = tasks.filter(t => t.parentId && taskMap.has(t.parentId));

        const renderTaskWithChildren = (task: any, level: number) => {
            const taskEl = this.createTaskElement(task, level);
            content.appendChild(taskEl);

            const children = childTasks.filter(t => t.parentId === task.id);
            const isCollapsed = this.collapsedTasks.has(task.id);

            if (children.length > 0 && !isCollapsed) {
                children.forEach(child => renderTaskWithChildren(child, level + 1));
            }
        };

        topLevelTasks.forEach(task => renderTaskWithChildren(task, 0));
    }

    private async renderTasksGroupedByCustomGroup(content: HTMLElement, tasks: any[], projectGroups: any[]) {
        // 创建分组容器
        const groupsContainer = document.createElement('div');
        groupsContainer.className = 'status-column-groups';
        groupsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 12px;
        `;

        // 为每个自定义分组创建子容器
        projectGroups.forEach((group: any) => {
            const groupTasks = tasks.filter(task => task.customGroupId === group.id);
            if (groupTasks.length > 0) {
                const groupContainer = this.createCustomGroupInStatusColumn(group, groupTasks, false, status);
                groupsContainer.appendChild(groupContainer);
            }
        });

        // 添加未分组任务
        const ungroupedTasks = tasks.filter(task => !task.customGroupId);
        if (ungroupedTasks.length > 0) {
            const ungroupedGroup = {
                id: 'ungrouped',
                name: '未分组',
                color: '#95a5a6',
                icon: '📋'
            };
            const ungroupedContainer = this.createCustomGroupInStatusColumn(ungroupedGroup, ungroupedTasks, false, status);
            groupsContainer.appendChild(ungroupedContainer);
        }

        content.appendChild(groupsContainer);
    }

    private createCustomGroupInStatusColumn(group: any, tasks: any[], isCollapsedDefault: boolean = false, status: string = ''): HTMLElement {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'custom-group-in-status';
        groupContainer.dataset.groupId = group.id;

        // 分组标题
        const groupHeader = document.createElement('div');
        groupHeader.className = 'custom-group-header';
        groupHeader.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: ${group.color}15;
            border: 1px solid ${group.color}30;
            border-radius: 6px;
            cursor: pointer;
            position: sticky;
            top: 0;
            z-index: 10;
        `;

        const groupTitle = document.createElement('div');
        groupTitle.className = 'custom-group-title';
        groupTitle.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            color: ${group.color};
            font-size: 13px;
        `;

        const groupIcon = document.createElement('span');
        groupIcon.textContent = group.icon || '📋';
        groupTitle.appendChild(groupIcon);

        const groupName = document.createElement('span');
        groupName.textContent = group.name;
        groupTitle.appendChild(groupName);

        const taskCount = document.createElement('span');
        taskCount.className = 'custom-group-count';
        // 在状态列中，分组徽章：只统计顶层任务数量（子任务不计入）
        // 扩展 tasks 以包含后代任务，确保已完成子任务也能显示
        const expandedTasks = this.augmentTasksWithDescendants(tasks, group.id);
        const taskMapLocal = new Map(expandedTasks.map((t: any) => [t.id, t]));
        const topLevel = expandedTasks.filter((t: any) => !t.parentId || !taskMapLocal.has(t.parentId));
        taskCount.textContent = topLevel.length.toString();
        taskCount.style.cssText = `
            background: ${group.color};
            color: white;
            border-radius: 10px;
            padding: 2px 6px;
            font-size: 11px;
            font-weight: 500;
            min-width: 18px;
            text-align: center;
        `;

        groupHeader.appendChild(groupTitle);

        // 右侧容器：任务计数 + 新建按钮 + 粘贴按钮
        const headerRight = document.createElement('div');
        headerRight.style.cssText = 'display:flex; align-items:center; gap:4px;';
        headerRight.appendChild(taskCount);

        // 非已完成状态显示新建按钮和粘贴按钮
        if (status !== 'completed') {
            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'b3-button b3-button--text';
            addTaskBtn.style.cssText = 'padding: 2px; margin-left: 2px;';
            addTaskBtn.title = i18n('newTask');
            addTaskBtn.innerHTML = `<svg style="width: 14px; height: 14px;"><use xlink:href="#iconAdd"></use></svg>`;
            addTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const gid = group.id === 'ungrouped' ? null : group.id;
                this.showCreateTaskDialog(undefined, gid, status as any);
            });
            headerRight.appendChild(addTaskBtn);

            const pasteTaskBtn = document.createElement('button');
            pasteTaskBtn.className = 'b3-button b3-button--text';
            pasteTaskBtn.style.cssText = 'padding: 2px; margin-left: 2px;';
            pasteTaskBtn.title = i18n('pasteNew');
            pasteTaskBtn.innerHTML = `<svg style="width: 14px; height: 14px;"><use xlink:href="#iconPaste"></use></svg>`;
            pasteTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const gid = group.id === 'ungrouped' ? null : group.id;
                // 显示选择器
                this.showPasteTaskDialog(undefined, gid, status as any, true);
            });
            headerRight.appendChild(pasteTaskBtn);
        }

        groupHeader.appendChild(headerRight);

        // 分组任务容器
        const groupTasksContainer = document.createElement('div');
        groupTasksContainer.className = 'custom-group-tasks';
        groupTasksContainer.style.cssText = `
            padding-left: 8px; padding-right: 8px;
            display: ${isCollapsedDefault ? 'none' : 'block'};
        `;

        // 折叠按钮
        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'b3-button b3-button--text custom-group-collapse-btn';
        collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsedDefault ? 'Right' : 'Down'}"></use></svg>`;
        collapseBtn.title = isCollapsedDefault ? '展开分组' : '折叠分组';
        collapseBtn.style.cssText = `
            padding: 2px;
            min-width: auto;
            margin-right: 4px;
        `;

        const groupKey = `${group.id}-status-mode-${status}`; // 状态模式下的唯一Key

        // 检查是否已有明确的折叠/展开记录
        let isCollapsed = false;
        if (this.collapsedStatusGroups.has(groupKey)) {
            isCollapsed = true;
        } else if (this.expandedStatusGroups.has(groupKey)) {
            isCollapsed = false;
        } else {
            // 没有记录，使用配置的默认值
            isCollapsed = isCollapsedDefault;
        }

        // 设置初始效果
        groupTasksContainer.style.display = isCollapsed ? 'none' : 'block';
        collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
        collapseBtn.title = isCollapsed ? '展开分组' : '折叠分组';

        collapseBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            groupTasksContainer.style.display = isCollapsed ? 'none' : 'block';
            collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
            collapseBtn.title = isCollapsed ? '展开分组' : '折叠分组';

            // 更新持久化状态
            if (isCollapsed) {
                this.collapsedStatusGroups.add(groupKey);
                this.expandedStatusGroups.delete(groupKey);
            } else {
                this.collapsedStatusGroups.delete(groupKey);
                this.expandedStatusGroups.add(groupKey);
            }
        });

        groupTitle.insertBefore(collapseBtn, groupIcon);

        groupContainer.appendChild(groupHeader);

        // 渲染任务（使用扩展后的任务列表）
        this.renderTasksInColumn(groupTasksContainer, expandedTasks);

        groupContainer.appendChild(groupTasksContainer);

        return groupContainer;
    }

    private showColumn(status: string) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (column) {
            column.style.display = 'flex';
        }
    }



    private createTaskElement(task: any, level: number = 0): HTMLElement {
        const taskEl = document.createElement('div');
        taskEl.className = 'kanban-task';
        if (level > 0) {
            taskEl.classList.add('is-subtask');
        }
        taskEl.draggable = !task.isSubscribed;
        if (task.isSubscribed) {
            taskEl.style.cursor = 'default';
        }
        taskEl.dataset.taskId = task.id;

        const priority = task.priority || 'none';

        // 存储任务数据到元素
        taskEl.dataset.priority = priority;

        // 添加优先级样式类
        if (priority !== 'none') {
            taskEl.classList.add(`kanban-task-priority-${priority}`);
        }

        // 设置任务颜色（根据优先级）
        let backgroundColor = '';
        let borderColor = '';
        switch (task.priority) {
            case 'high':
                backgroundColor = 'rgba(from var(--b3-card-error-background) r g b / .5)';
                borderColor = 'var(--b3-card-error-color)';
                break;
            case 'medium':
                backgroundColor = 'rgba(from var(--b3-card-warning-background) r g b / .5)';
                borderColor = 'var(--b3-card-warning-color)';
                break;
            case 'low':
                backgroundColor = 'rgba(from var(--b3-card-info-background) r g b / .7)';
                borderColor = 'var(--b3-card-info-color)';
                break;
            default:
                backgroundColor = 'rgba(from var(--b3-theme-background-light) r g b / .1)';
                borderColor = 'var(--b3-theme-background-light)';
        }

        // 设置任务元素的背景色和边框
        taskEl.style.cssText = `
            cursor: grab;
            transition: all 0.2s ease;
            position: relative;
            background-color: ${backgroundColor};
            border: 1.5px solid ${borderColor};
        `;

        if (task.completed) {
            taskEl.style.opacity = '0.5';
        }

        if (level > 0) {
            taskEl.style.marginLeft = `${level * 20}px`;
        }

        // 多选模式下添加选中状态样式
        if (this.isMultiSelectMode && this.selectedTaskIds.has(task.id)) {
            taskEl.classList.add('kanban-task-selected');
            taskEl.style.boxShadow = '0 0 0 2px var(--b3-theme-primary)';
        }

        const taskMainContainer = document.createElement('div');
        taskMainContainer.className = 'kanban-task-main';
        taskMainContainer.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: flex-start;
        `;

        // 多选复选框（仅在多选模式下显示）
        let multiSelectCheckbox: HTMLInputElement | null = null;
        if (this.isMultiSelectMode) {
            multiSelectCheckbox = document.createElement('input');
            multiSelectCheckbox.type = 'checkbox';
            multiSelectCheckbox.className = 'kanban-task-multiselect-checkbox';
            multiSelectCheckbox.checked = this.selectedTaskIds.has(task.id);
            multiSelectCheckbox.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleTaskSelection(task.id, multiSelectCheckbox!.checked);
            });
            taskMainContainer.appendChild(multiSelectCheckbox);

            // 多选模式下点击整个任务卡片切换选择
            taskEl.addEventListener('click', (e) => {
                // 如果点击的是多选复选框本身，不处理（让复选框自己的事件处理）
                if ((e.target as HTMLElement).classList.contains('kanban-task-multiselect-checkbox')) {
                    return;
                }
                // 切换选择状态
                const newSelected = !this.selectedTaskIds.has(task.id);
                this.toggleTaskSelection(task.id, newSelected);
                // 更新复选框状态
                if (multiSelectCheckbox) {
                    multiSelectCheckbox.checked = newSelected;
                }
            });
        }

        const taskIndentContainer = document.createElement('div');
        taskIndentContainer.className = 'kanban-task-indent';
        taskIndentContainer.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 0px; /* 固定宽度以便对齐 */
            flex-shrink: 0;
        `;

        // 折叠按钮
        const childTasks = this.tasks.filter(t => t.parentId === task.id);
        if (childTasks.length > 0) {
            const isCollapsed = this.collapsedTasks.has(task.id);
            const collapseBtn = document.createElement('button');
            collapseBtn.className = 'b3-button b3-button--text kanban-task-collapse-btn';
            collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
            collapseBtn.title = isCollapsed ? i18n('expandSubtasks') : i18n('collapseSubtasks');
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isCollapsed) {
                    this.collapsedTasks.delete(task.id);
                } else {
                    this.collapsedTasks.add(task.id);
                }
                this.renderKanban();
            });
            taskIndentContainer.appendChild(collapseBtn);
        }

        taskMainContainer.appendChild(taskIndentContainer);

        // 复选框（非多选模式下显示）
        if (!this.isMultiSelectMode) {
            const checkboxEl = document.createElement('input');
            checkboxEl.type = 'checkbox';
            checkboxEl.className = 'kanban-task-checkbox';
            checkboxEl.checked = task.completed;
            checkboxEl.title = '点击完成/取消完成任务';
            if (task.isSubscribed) {
                checkboxEl.disabled = true;
                checkboxEl.title = i18n("subscribedTaskReadOnly") || "订阅任务（只读）";
            } else {
                checkboxEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const completed = checkboxEl.checked;
                    this.toggleTaskCompletion(task, completed);
                });
            }
            taskMainContainer.appendChild(checkboxEl);
        }

        const taskContentContainer = document.createElement('div');
        taskContentContainer.className = 'kanban-task-content';
        taskContentContainer.style.flex = '1';
        taskContentContainer.style.overflow = 'auto';

        // 任务标题
        const titleEl = document.createElement('div');
        titleEl.className = 'kanban-task-title';

        if (task.blockId || task.docId) {
            // 如果有绑定块，标题显示为可点击的超链接
            const targetId = task.blockId || task.docId;
            titleEl.setAttribute('data-type', 'a');
            titleEl.setAttribute('data-href', `siyuan://blocks/${targetId}`);
            titleEl.style.cssText = `
                font-weight: 500;
                color: var(--b3-theme-primary);
                line-height: 1.4;
                cursor: pointer;
                text-decoration: underline dotted;
                text-decoration-style: dotted;
                transition: color 0.2s ease;
                width: fit-content;
            `;

            // 点击事件：打开块
            titleEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openBlockTab(targetId);
            });

            // 鼠标悬停效果
            titleEl.addEventListener('mouseenter', () => {
                titleEl.style.color = 'var(--b3-theme-primary-light)';
            });
            titleEl.addEventListener('mouseleave', () => {
                titleEl.style.color = 'var(--b3-theme-primary)';
            });
        } else {
            // 没有绑定块，普通标题样式
            titleEl.style.cssText = `
                font-weight: 500;
                color: var(--b3-theme-on-surface);
                line-height: 1.4;
                width: fit-content;
            `;
        }

        titleEl.textContent = task.title || i18n('noContentHint');
        titleEl.title = (task.blockId || task.docId) ? i18n('clickToOpenBoundBlock', { title: task.title || i18n('noContentHint') }) : (task.title || i18n('noContentHint'));

        // 如果有子任务，添加数量指示器
        if (childTasks.length > 0) {
            const subtaskIndicator = document.createElement('span');
            subtaskIndicator.className = 'subtask-indicator';
            subtaskIndicator.textContent = ` (${childTasks.length})`;
            subtaskIndicator.title = i18n('containsNSubtasks', { count: String(childTasks.length) });
            subtaskIndicator.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
            `;
            titleEl.appendChild(subtaskIndicator);
        }

        // 创建标题和链接的容器
        const titleContainer = document.createElement('div');
        titleContainer.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 8px;';
        titleContainer.appendChild(titleEl);

        // 添加URL链接图标作为兄弟节点
        if (task.url) {
            const urlIcon = document.createElement('a');
            urlIcon.className = 'kanban-task-url-icon';
            urlIcon.href = task.url;
            urlIcon.target = '_blank';
            urlIcon.title = i18n("openUrl") + ': ' + task.url;
            urlIcon.innerHTML = '<svg style="width: 14px; height: 14px;"><use xlink:href="#iconLink"></use></svg>';
            urlIcon.style.cssText = 'color: var(--b3-theme-primary); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; flex-shrink: 0;';
            urlIcon.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            titleContainer.appendChild(urlIcon);
        }

        taskContentContainer.appendChild(titleContainer);

        // 任务信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'kanban-task-info';
        infoEl.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        if (task.completed && task.completedTime) {
            const completedTimeEl = document.createElement('div');
            completedTimeEl.className = 'kanban-task-completed-time';
            completedTimeEl.innerHTML = `<span>✅</span><span>完成于: ${getLocalDateTimeString(new Date(task.completedTime))}</span>`;
            completedTimeEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
            `;
            infoEl.appendChild(completedTimeEl);
        }

        // 日期时间
        const hasDate = task.date || task.endDate;
        if (hasDate) {
            const dateEl = document.createElement('div');
            dateEl.className = 'kanban-task-date';
            dateEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
                flex-wrap: wrap;
            `;

            // 添加周期图标（如果是周期事件或周期实例）
            if (task.repeat?.enabled || task.isRepeatInstance) {
                const repeatIcon = document.createElement('span');
                repeatIcon.textContent = '🔄';
                repeatIcon.title = task.repeat?.enabled ? getRepeatDescription(task.repeat) : '周期事件实例';
                repeatIcon.style.cssText = 'cursor: help;';
                dateEl.appendChild(repeatIcon);
            }

            const dateText = this.formatTaskDate(task);
            let dateHtml = `<span>📅${dateText}</span>`;

            // 添加倒计时显示
            if (!task.completed) {
                const countdownInfo = this.getTaskCountdownInfo(task);
                if (countdownInfo.type !== 'none' && countdownInfo.days >= 0) {
                    let urgencyClass = 'countdown-normal';
                    if (countdownInfo.days <= 1) {
                        urgencyClass = 'countdown-urgent';
                    } else if (countdownInfo.days <= 3) {
                        urgencyClass = 'countdown-warning';
                    }

                    dateHtml += `<span class="countdown-badge ${urgencyClass}">${countdownInfo.text}</span>`;
                }
            }

            // 如果存在自定义提醒时间，按规则显示：
            // - 如果 custom 包含日期部分，则以该日期为准；否则以 task.date（或今天）为准
            // - 如果目标日期 < 今天（过去），则不显示 customReminderTime
            // - 如果目标日期 > 今天（未来），则显示日期+时间
            // - 如果目标日期 == 今天，则仅显示时间
            try {
                const customRaw = task.customReminderTime;
                if (customRaw) {
                    let s = String(customRaw).trim();
                    let datePart: string | null = null;
                    let timePart: string | null = null;

                    if (s.includes('T')) {
                        const parts = s.split('T');
                        datePart = parts[0];
                        timePart = parts[1] || null;
                    } else if (s.includes(' ')) {
                        const parts = s.split(' ');
                        // 支持两种： "YYYY-MM-DD HH:MM" 或 "HH:MM extra"
                        if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
                            datePart = parts[0];
                            timePart = parts.slice(1).join(' ') || null;
                        } else {
                            timePart = parts.slice(-1)[0] || null;
                        }
                    } else if (/^\d{2}:\d{2}$/.test(s)) {
                        timePart = s;
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
                        datePart = s;
                    } else {
                        // 兜底把整个字符串当时间处理
                        timePart = s;
                    }

                    const today = getLogicalDateString();
                    const effectiveDate = datePart || task.date || today;
                    const logicalEffective = this.getTaskLogicalDate(effectiveDate, timePart || undefined);

                    // 比较逻辑日期
                    if (effectiveDate) {
                        if (compareDateStrings(logicalEffective, today) < 0) {
                            // 过去：不显示 custom 时间
                        } else if (compareDateStrings(logicalEffective, today) === 0) {
                            if (timePart) {
                                const showTime = timePart.substring(0, 5);
                                dateHtml += `<span> ⏰${showTime}</span>`;
                            }
                        } else {
                            // 未来：显示日期 + 时间（如果有）
                            const showDate = effectiveDate;
                            const showTime = timePart ? ` ${timePart.substring(0, 5)}` : '';
                            dateHtml += `<span> ⏰${showDate}${showTime}</span>`;
                        }
                    }
                }
            } catch (e) {
                console.warn('格式化 customReminderTime 失败', e);
            }

            dateEl.innerHTML += dateHtml;
            infoEl.appendChild(dateEl);
        }

        // 优先级
        if (priority !== 'none') {
            const priorityEl = document.createElement('div');
            priorityEl.className = `kanban-task-priority priority-label-${priority}`;

            const priorityNames = {
                'high': '高优先级',
                'medium': '中优先级',
                'low': '低优先级'
            };

            priorityEl.innerHTML = `<span class="priority-dot ${priority}"></span><span>${priorityNames[priority]}</span>`;
            infoEl.appendChild(priorityEl);
        }

        // 分类（支持多分类）
        if (task.categoryId) {
            const categoryContainer = document.createElement('div');
            categoryContainer.className = 'kanban-task-categories';
            categoryContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                align-self: flex-start;
            `;

            const categoryIds = typeof task.categoryId === 'string' ? task.categoryId.split(',') : [task.categoryId];
            let hasValidCategory = false;

            categoryIds.forEach((catId: string) => {
                const id = catId.trim();
                if (!id) return;

                const category = this.categoryManager.getCategoryById(id);
                if (category) {
                    hasValidCategory = true;
                    const categoryEl = document.createElement('div');
                    categoryEl.className = 'kanban-task-category';
                    categoryEl.style.cssText = `
                        display: inline-flex;
                        align-items: center;
                        gap: 4px;
                        padding: 2px 6px;
                        background-color: ${category.color};
                        border-radius: 4px;
                        font-size: 11px;
                        color: white;
                        font-weight: 500;
                    `;

                    if (category.icon) {
                        categoryEl.innerHTML = `<span>${category.icon}</span><span>${category.name}</span>`;
                    } else {
                        categoryEl.textContent = category.name;
                    }
                    categoryContainer.appendChild(categoryEl);
                }
            });

            if (hasValidCategory) {
                infoEl.appendChild(categoryContainer);
            }
        }

        // 备注
        if (task.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'kanban-task-note';
            noteEl.textContent = task.note;
            noteEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.8;
                margin-top: 4px;
                line-height: 1.3;
                max-height: 40px;
                overflow: hidden;
                text-overflow: ellipsis;
            `;
            infoEl.appendChild(noteEl);
        }

        // 标签显示（使用标签ID）
        if (task.tagIds && task.tagIds.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'kanban-task-tags';
            tagsContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 4px;
            `;

            // 获取项目标签配置以获取颜色和名称
            (async () => {
                try {
                    const { ProjectManager } = await import('../utils/projectManager');
                    const projectManager = ProjectManager.getInstance(this.plugin);
                    const projectTags = await projectManager.getProjectTags(this.projectId);

                    // 创建标签ID到标签对象的映射
                    const tagMap = new Map(projectTags.map(t => [t.id, t]));

                    // 过滤出有效的标签ID
                    const validTagIds = task.tagIds.filter((tagId: string) => tagMap.has(tagId));

                    // 如果有无效标签，自动清理
                    if (validTagIds.length !== task.tagIds.length) {
                        const invalidCount = task.tagIds.length - validTagIds.length;

                        // 异步清理无效标签
                        (async () => {
                            try {
                                const reminderData = await this.getReminders();
                                if (reminderData[task.id]) {
                                    reminderData[task.id].tagIds = validTagIds;
                                    await saveReminders(this.plugin, reminderData);
                                }
                            } catch (error) {
                                console.error('清理无效标签失败:', error);
                            }
                        })();
                    }

                    // 显示有效标签
                    validTagIds.forEach((tagId: string) => {
                        const tag = tagMap.get(tagId);
                        if (tag) {
                            const tagEl = document.createElement('span');
                            tagEl.className = 'kanban-task-tag';
                            tagEl.style.cssText = `
                                display: inline-flex;
                                align-items: center;
                                padding: 2px 8px;
                                font-size: 11px;
                                border-radius: 12px;
                                background: ${tag.color}20;
                                border: 1px solid ${tag.color};
                                color: var(--b3-theme-on-surface);
                                font-weight: 500;
                            `;
                            tagEl.textContent = `#${tag.name}`;
                            tagEl.title = tag.name;
                            tagsContainer.appendChild(tagEl);
                        }
                    });
                } catch (error) {
                    console.error('加载标签失败:', error);
                }
            })();

            infoEl.appendChild(tagsContainer);
        }

        // 番茄钟数量 + 总专注时长 + 预计番茄时长
        if ((task.pomodoroCount && task.pomodoroCount > 0) || (typeof task.focusTime === 'number' && task.focusTime > 0) || task.estimatedPomodoroDuration || (task.totalRepeatingPomodoroCount && task.totalRepeatingPomodoroCount > 0)) {
            const pomodoroDisplay = document.createElement('div');
            pomodoroDisplay.className = 'kanban-task-pomodoro-count';
            pomodoroDisplay.style.cssText = `
                font-size: 12px;
                display: block;
                background: rgba(255, 99, 71, 0.1);
                color: rgb(255, 99, 71);
                padding: 4px 8px;
                border-radius: 4px;
                margin-top: 4px;
                width: fit-content;
            `;
            const tomatoEmojis = `🍅 ${task.pomodoroCount || 0}`;
            const focusMinutes = task.focusTime || 0;
            const formatMinutesToString = (minutes: number) => {
                const hours = Math.floor(minutes / 60);
                const mins = Math.floor(minutes % 60);
                return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
            };
            const focusText = focusMinutes > 0 ? ` ⏱ ${formatMinutesToString(focusMinutes)}` : '';
            const extraCount = '';

            // 预计番茄时长（第一行）
            const estimatedLine = task.estimatedPomodoroDuration ? `<span title='预计番茄时长'>预计: ${task.estimatedPomodoroDuration}</span>` : '';

            // 实际番茄钟数量和专注时长（第二行）
            let actualLine = '';

            if (task.isRepeatInstance) {
                const repeatingTotal = task.totalRepeatingPomodoroCount || 0;
                const repeatingFocus = task.totalRepeatingFocusTime || 0;
                const instanceCount = task.pomodoroCount || 0;

                const repeatingFocusText = repeatingFocus > 0 ? ` ⏱ ${formatMinutesToString(repeatingFocus)}` : '';
                const instanceFocusText = focusMinutes > 0 ? ` ⏱ ${formatMinutesToString(focusMinutes)}` : '';

                actualLine = `<div style="margin-top:${estimatedLine ? '6px' : '0'}">
                    <div title="系列累计番茄钟: ${repeatingTotal}">
                        <span>系列: 🍅 ${repeatingTotal}</span>
                        <span style="margin-left:8px; opacity:0.9;">${repeatingFocusText}</span>
                    </div>
                    <div title="本实例番茄钟: ${instanceCount}" style="margin-top:4px; opacity:0.95;">
                        <span>本次: 🍅 ${instanceCount}</span>
                        <span style="margin-left:8px; opacity:0.9;">${instanceFocusText}</span>
                    </div>
                 </div>`;
            } else {
                actualLine = (task.pomodoroCount > 0 || focusMinutes > 0) ? `<div style="margin-top:${estimatedLine ? '6px' : '0'}"><span title="完成的番茄钟数量: ${task.pomodoroCount}">总共：${tomatoEmojis}${extraCount}</span><span title="总专注时长: ${focusMinutes} 分钟" style="margin-left:8px; opacity:0.9;">${focusText}</span></div>` : '';
            }

            pomodoroDisplay.innerHTML = `${estimatedLine}${actualLine}`;

            infoEl.appendChild(pomodoroDisplay);
        }

        taskContentContainer.appendChild(infoEl);
        taskMainContainer.appendChild(taskContentContainer);

        // 不再单独显示绑定块信息，因为已经集成到标题中

        taskEl.appendChild(taskMainContainer);

        // 如果为父任务，计算子任务完成进度并在底部显示进度条
        const directChildren = this.tasks.filter(t => t.parentId === task.id);
        if (directChildren.length > 0) {
            const completedCount = directChildren.filter(c => c.completed).length;
            const percent = Math.round((completedCount / directChildren.length) * 100);

            const progressContainer = document.createElement('div');
            progressContainer.className = 'kanban-task-progress-container';
            progressContainer.style.cssText = `
                margin-top: 8px;
                padding: 6px 0 0 0;
                display: flex;
                align-items: center;
                gap: 8px;
            `;

            const progressBarWrap = document.createElement('div');
            progressBarWrap.className = 'kanban-task-progress-wrap';
            progressBarWrap.style.cssText = `
                flex: 1;
                background: rgba(0,0,0,0.06);
                height: 8px;
                border-radius: 6px;
                overflow: hidden;
            `;

            const progressBar = document.createElement('div');
            progressBar.className = 'kanban-task-progress-bar';
            progressBar.style.cssText = `
                width: ${percent}%;
                height: 100%;
                background: linear-gradient(90deg, #2ecc71, #27ae60);
                transition: width 0.3s ease;
            `;

            progressBarWrap.appendChild(progressBar);

            const percentLabel = document.createElement('div');
            percentLabel.className = 'kanban-task-progress-text';
            percentLabel.textContent = `${percent}%`;
            percentLabel.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.85;
                min-width: 34px;
                text-align: right;
            `;

            progressContainer.appendChild(progressBarWrap);
            progressContainer.appendChild(percentLabel);
            taskEl.appendChild(progressContainer);
        }

        // 所有任务均启用拖拽（订阅任务也支持排序）
        taskEl.draggable = true;
        this.addTaskDragEvents(taskEl, task);
        taskEl.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedElement && this.draggedElement !== taskEl) {
                const targetTask = this.getTaskFromElement(taskEl);
                if (!targetTask) return;

                const rect = taskEl.getBoundingClientRect();
                const mouseY = e.clientY;
                const taskTop = rect.top;
                const taskBottom = rect.bottom;
                const taskHeight = rect.height;

                // 定义区域：上边缘20%和下边缘20%用于排序，中间60%用于父子关系
                const sortZoneHeight = taskHeight * 0.2;
                const isInTopSortZone = mouseY <= taskTop + sortZoneHeight;
                const isInBottomSortZone = mouseY >= taskBottom - sortZoneHeight;
                const isInParentChildZone = !isInTopSortZone && !isInBottomSortZone;

                // 排序检查 (支持现有同级排序和新的成为同级排序)
                const canSort = this.canDropForSort(this.draggedTask, targetTask);
                const canBecomeSibling = this.canBecomeSiblingOf(this.draggedTask, targetTask);
                const canSetParentChild = this.canSetAsParentChild(this.draggedTask, targetTask);

                // --- [新逻辑] ---
                // 检查是否允许改变状态
                let canChangeStatus = false;
                if (this.kanbanMode === 'custom') {
                    const targetSubGroup = taskEl.closest('.custom-status-group') as HTMLElement;
                    const targetStatus = targetSubGroup?.dataset.status;

                    if (targetStatus && targetStatus !== 'completed') {
                        const draggedStatus = this.getTaskStatus(this.draggedTask);
                        if (draggedStatus !== targetStatus && !this.draggedTask.isSubscribed) {
                            canChangeStatus = true;
                        }
                    }
                }
                // --- [新逻辑结束] ---

                if ((isInTopSortZone || isInBottomSortZone)) {
                    // 排序操作
                    // [修改]：如果可以排序、成为同级 或 改变状态，则允许放置
                    if (canSort || canBecomeSibling || canChangeStatus) {
                        e.preventDefault();
                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                        const position = isInTopSortZone ? 'top' : 'bottom';
                        this.updateIndicator('sort', taskEl, position, e);
                    } else {
                        this.updateIndicator('none', null, null);
                    }
                } else if (isInParentChildZone) {
                    // 父子任务操作
                    // [修改]：如果可以设置父子 或 改变状态，则允许放置
                    if (canSetParentChild || canChangeStatus) {
                        e.preventDefault();
                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                        this.updateIndicator('parentChild', taskEl, 'middle');
                    } else {
                        this.updateIndicator('none', null, null);
                    }
                } else {
                    // 清除所有指示器
                    this.updateIndicator('none', null, null);
                }
            }
        });

        taskEl.addEventListener('dragleave', (_e) => {
            // 检查是否真的离开了目标区域
            if (!taskEl.contains((_e as any).relatedTarget as Node)) {
                this.updateIndicator('none', null, null);
            }
        });

        taskEl.addEventListener('drop', (e) => {
            if (this.isDragging && this.draggedElement && this.draggedElement !== taskEl) {
                e.preventDefault();
                e.stopPropagation(); // 阻止事件冒泡到列的 drop 区域

                const targetTask = this.getTaskFromElement(taskEl);
                if (!targetTask) {
                    this.updateIndicator('none', null, null);
                    return;
                }

                const rect = taskEl.getBoundingClientRect();
                const mouseY = e.clientY;
                const taskTop = rect.top;
                const taskBottom = rect.bottom;
                const taskHeight = rect.height;

                // 定义区域
                const sortZoneHeight = taskHeight * 0.2;
                const isInTopSortZone = mouseY <= taskTop + sortZoneHeight;
                const isInBottomSortZone = mouseY >= taskBottom - sortZoneHeight;
                const isInParentChildZone = !isInTopSortZone && !isInBottomSortZone;

                const canSort = this.canDropForSort(this.draggedTask, targetTask);
                const canBecomeSibling = this.canBecomeSiblingOf(this.draggedTask, targetTask);
                const canSetParentChild = this.canSetAsParentChild(this.draggedTask, targetTask);

                if ((isInTopSortZone || isInBottomSortZone)) {
                    if (canSort) {
                        // 执行排序
                        this.handleSortDrop(targetTask, e);
                    } else if (canBecomeSibling) {
                        // 执行成为兄弟任务并排序的操作
                        this.handleBecomeSiblingDrop(this.draggedTask, targetTask, e);
                    }
                } else if (isInParentChildZone) {
                    if (canSetParentChild) {
                        // 执行父子任务设置
                        this.handleParentChildDrop(targetTask);
                    } else if (canSort) {
                        // [Fallback] Cannot become child, but can sort (e.g. move across groups)
                        this.handleSortDrop(targetTask, e);
                    }
                }
            }
            this.updateIndicator('none', null, null);
        });

        // 添加右键菜单
        taskEl.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (task.isSubscribed) {
                this.showSubscribedTaskContextMenu(e, task);
                return;
            }
            await this.showTaskContextMenu(e, task);
        });

        // 添加悬停效果
        taskEl.addEventListener('mouseenter', () => {
            taskEl.style.transform = 'translateY(-2px)';
            taskEl.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
        });

        taskEl.addEventListener('mouseleave', () => {
            if (!this.isDragging) {
                taskEl.style.transform = 'translateY(0)';
                taskEl.style.boxShadow = 'none';
            }
        });

        return taskEl;
    }

    private formatTaskDate(task: any): string {
        const today = getLogicalDateString();
        const tomorrowStr = getRelativeDateString(1);

        // 获取当前年份
        const currentYear = new Date().getFullYear();

        // 辅助函数：格式化日期显示
        const formatDateWithYear = (dateStr: string, date: Date): string => {
            const year = date.getFullYear();
            return year !== currentYear
                ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
                : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        };

        // 辅助函数：计算过期天数
        const getExpiredDays = (targetDate: string): number => {
            return Math.ceil((new Date(today).getTime() - new Date(targetDate).getTime()) / (1000 * 60 * 60 * 24));
        };

        // 辅助函数：创建过期徽章（completed 为 true 时使用“X天前”的词语）
        const createExpiredBadge = (days: number, completed: boolean = false): string => {
            const text = completed ? i18n('daysAgo', { days: String(days) }) : i18n('overdueDays', { days: String(days) });
            return `<span class="countdown-badge countdown-normal" style="background-color: rgba(231, 76, 60, 0.15); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.3);">${text}</span>`;
        };

        // 使用逻辑日期判断（考虑一天起始时间）
        const logicalStart = this.getTaskLogicalDate(task.date, task.time);
        const logicalEnd = this.getTaskLogicalDate(task.endDate || task.date, task.endTime || task.time);

        // 如果只有截止时间，显示截止时间（基于逻辑结束日判断过期/今天/明天）
        if (!task.date && task.endDate) {
            const endDate = new Date(task.endDate);
            const endYear = endDate.getFullYear();

            // 检查是否过期（使用逻辑结束日期）
            if (compareDateStrings(logicalEnd, today) < 0) {
                const daysDiff = getExpiredDays(task.endDate);
                const dateStr = formatDateWithYear(task.endDate, endDate);
                return `${dateStr} ${createExpiredBadge(daysDiff, !!task.completed)}`;
            }

            if (logicalEnd === today) {
                return i18n('todayDeadline');
            } else if (logicalEnd === tomorrowStr) {
                return i18n('tomorrowDeadline');
            } else {
                const dateStr = formatDateWithYear(task.endDate, endDate);
                return `${dateStr} ${i18n('countdownEnd')}`;
            }
        }

        // 如果有开始时间，按逻辑日期显示
        let dateStr = '';
        if (logicalStart === today) {
            dateStr = i18n('today');
        } else if (logicalStart === tomorrowStr) {
            dateStr = i18n('tomorrow');
        } else {
            const taskDate = new Date(task.date);
            const taskYear = taskDate.getFullYear();

            // 检查是否过期（使用逻辑起始日期）
            if (compareDateStrings(logicalStart, today) < 0) {
                const formattedDate = formatDateWithYear(task.date, taskDate);
                // 如果任务有结束日期且和开始日期不同，避免在开始日期处显示过期徽章（只在结束日期处显示一次）
                if (task.endDate && task.endDate !== task.date) {
                    dateStr = formattedDate;
                } else {
                    const daysDiff = getExpiredDays(task.date);
                    dateStr = `${formattedDate} ${createExpiredBadge(daysDiff, !!task.completed)} `;
                }
            } else {
                // 如果不在今年，显示年份
                dateStr = formatDateWithYear(task.date, taskDate);
            }
        }

        // 如果是农历循环事件，添加农历日期显示
        if (task.repeat?.enabled && (task.repeat.type === 'lunar-monthly' || task.repeat.type === 'lunar-yearly')) {
            try {
                const lunarStr = getSolarDateLunarString(task.date);
                if (lunarStr) {
                    dateStr = `${dateStr} (${lunarStr})`;
                }
            } catch (error) {
                console.error('Failed to format lunar date:', error);
            }
        }

        let endDateStr = '';
        if (task.endDate && task.endDate !== task.date) {
            const taskEndDate = new Date(task.endDate);
            const endYear = taskEndDate.getFullYear();

            // 检查结束日期是否过期（使用逻辑结束日期）
            if (compareDateStrings(logicalEnd, today) < 0) {
                const daysDiff = getExpiredDays(task.endDate);
                const formattedEndDate = formatDateWithYear(task.endDate, taskEndDate);
                endDateStr = `${formattedEndDate} ${createExpiredBadge(daysDiff, !!task.completed)} `;
            } else {
                // 如果结束日期不在今年，显示年份
                endDateStr = formatDateWithYear(task.endDate, taskEndDate);
            }
        }

        if (task.time) {
            dateStr += ` ${task.time}`;
        }

        if (endDateStr) {
            // 如果有截止时间，加到截止日期后面
            if (task.endTime) {
                endDateStr += ` ${task.endTime}`;
            }
            return `${dateStr} → ${endDateStr} `;
        }

        // 如果是同一天，但是有结束时间（比如 14:00 - 16:00）
        if (task.endTime && task.endTime !== task.time) {
            return `${dateStr} - ${task.endTime}`;
        }

        return dateStr || "未设置日期";
    }

    private getTaskCountdownInfo(task: any): { text: string; days: number; type: 'start' | 'end' | 'none' } {
        // 使用逻辑日期计算天数差（考虑一天起始时间）
        const today = getLogicalDateString();

        const calcDays = (targetLogicalDate: string) => {
            const target = new Date(targetLogicalDate + 'T00:00:00');
            const base = new Date(today + 'T00:00:00');
            return Math.ceil((target.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
        };

        // 如果同时有开始日期和结束日期，则仅基于结束日期显示倒计时（避免同时显示开始和结束倒计时）
        if (task.date && task.endDate) {
            const logicalEnd = this.getTaskLogicalDate(task.endDate, task.endTime || task.time);
            const endDays = calcDays(logicalEnd);

            if (endDays >= 0) {
                return {
                    text: endDays === 0 ? i18n('todayEnd') : i18n('endsInNDays', { days: String(endDays) }),
                    days: endDays,
                    type: 'end'
                };
            }
            return { text: '', days: endDays, type: 'none' };
        }

        // 如果只有开始日期
        if (task.date) {
            const logicalStart = this.getTaskLogicalDate(task.date, task.time);
            const startDays = calcDays(logicalStart);

            // 如果还没开始
            if (startDays > 0) {
                return {
                    text: i18n('startsInNDays', { days: String(startDays) }),
                    days: startDays,
                    type: 'start'
                };
            }

            // 否则没有有效的开始倒计时，继续检查结束日期（如果存在）
            if (task.endDate) {
                const logicalEnd = this.getTaskLogicalDate(task.endDate, task.endTime || task.time);
                const endDays = calcDays(logicalEnd);

                if (endDays >= 0) {
                    return {
                        text: endDays === 0 ? i18n('todayEnd') : i18n('endsInNDays', { days: String(endDays) }),
                        days: endDays,
                        type: 'end'
                    };
                }
            }
        }

        // 只有结束日期的情况
        if (task.endDate) {
            const logicalEnd = this.getTaskLogicalDate(task.endDate, task.endTime || task.time);
            const endDays = calcDays(logicalEnd);

            if (endDays >= 0) {
                return {
                    text: endDays === 0 ? i18n('todayEnd') : i18n('endsInNDays', { days: String(endDays) }),
                    days: endDays,
                    type: 'end'
                };
            }
        }

        return { text: '', days: 0, type: 'none' };
    }

    private addTaskDragEvents(element: HTMLElement, task: any) {
        // 支持子任务拖拽到父任务上边缘解除父子关系
        element.addEventListener('dragover', (e) => {
            if (!this.isDragging || !this.draggedTask || this.draggedTask.id === task.id) return;
            // 仅允许子任务拖拽到父任务上边缘
            if (task.id === this.draggedTask.parentId) {
                const rect = element.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                if (offsetY < 16) { // 上边缘区域
                    e.preventDefault();
                    this.updateIndicator('parentChild', element, 'top', e);
                } else {
                    this.updateIndicator('none', null, null);
                }
            }
        });

        element.addEventListener('dragleave', () => {
            this.updateIndicator('none', null, null);
        });

        element.addEventListener('drop', async (e) => {
            if (!this.isDragging || !this.draggedTask || this.draggedTask.id === task.id) return;
            if (task.id === this.draggedTask.parentId) {
                const rect = element.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                if (offsetY < 16) {
                    // 解除父子关系
                    await this.unsetParentChildRelation(this.draggedTask);
                    this.clearAllIndicators();
                }
            }
        });
        element.addEventListener('dragstart', (e) => {
            this.isDragging = true;
            this.draggedTask = task;
            this.draggedElement = element;
            element.style.opacity = '0.5';
            element.style.cursor = 'grabbing';

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';

                // 支持批量拖拽
                if (this.isMultiSelectMode && this.selectedTaskIds.has(task.id)) {
                    const selectedIds = Array.from(this.selectedTaskIds);
                    e.dataTransfer.setData('application/vnd.siyuan.kanban-tasks', JSON.stringify(selectedIds));

                    // 设置拖拽样式
                    const dragIcon = document.createElement('div');
                    dragIcon.style.cssText = `
                        background: var(--b3-theme-primary);
                        color: white;
                        padding: 6px 10px;
                        border-radius: 4px;
                        font-size: 12px;
                        position: absolute;
                        top: -1000px;
                        font-weight: bold;
                        z-index: 10000;
                    `;
                    const count = selectedIds.length;
                    dragIcon.textContent = `${count} ${i18n('tasks') || '个任务'}`;
                    document.body.appendChild(dragIcon);
                    try {
                        e.dataTransfer.setDragImage(dragIcon, 0, 0);
                    } catch (err) {
                        // ignore setDragImage errors
                    }
                    setTimeout(() => dragIcon.remove(), 0);
                }

                e.dataTransfer.setData('text/html', element.outerHTML);
                // 支持拖动到日历：携带任务的最小必要信息，格式与 ReminderPanel 保持一致
                try {
                    const payload = {
                        id: task.id,
                        title: task.title || '',
                        date: task.date || null,
                        time: task.time || null,
                        endDate: task.endDate || null,
                        endTime: task.endTime || null,
                        durationMinutes: (() => {
                            try {
                                if (task.time && task.endTime) {
                                    const [sh, sm] = (task.time || '00:00').split(':').map(Number);
                                    const [eh, em] = (task.endTime || task.time || '00:00').split(':').map(Number);
                                    const s = sh * 60 + (sm || 0);
                                    const e = eh * 60 + (em || 0);
                                    return Math.max(1, e - s);
                                }
                            } catch (e) { }
                            return 60;
                        })()
                    };

                    e.dataTransfer.setData('application/x-reminder', JSON.stringify(payload));
                    // 兼容性：也设置纯文本为 id
                    e.dataTransfer.setData('text/plain', task.id);
                } catch (err) {
                    // ignore
                }
            }
        });

        element.addEventListener('dragend', () => {
            this.isDragging = false;
            this.draggedTask = null;
            this.draggedElement = null;
            element.style.opacity = '';
            element.style.cursor = 'grab';
            element.style.transform = 'translateY(0)';
            element.style.boxShadow = 'none';

            // 清理所有拖拽状态
            this.container.querySelectorAll('.kanban-drop-zone-active').forEach(el => {
                el.classList.remove('kanban-drop-zone-active');
            });
            // 清除所有指示器和状态
            this.updateIndicator('none', null, null);
        });
    }

    private showSubscribedTaskContextMenu(event: MouseEvent, task: any) {
        const menu = new Menu("subscribedTaskContextMenu");

        menu.addItem({
            iconHTML: "ℹ️",
            label: i18n("subscribedTaskReadOnly") || "订阅任务（只读）",
            disabled: true
        });
        menu.addSeparator();

        // 导航选项
        const targetId = task.blockId || task.docId;
        if (targetId) {
            menu.addItem({
                iconHTML: "📖",
                label: i18n("openNote") || "打开笔记",
                click: () => this.openBlockTab(targetId)
            });
            menu.addItem({
                iconHTML: "📋",
                label: i18n("copyBlockRef") || "复制块引用",
                click: () => this.copyBlockRef(task)
            });
        }

        menu.addSeparator();

        // 生产力工具
        menu.addItem({
            iconHTML: "🍅",
            label: i18n("startPomodoro") || "开始番茄钟",
            click: () => this.startPomodoro(task)
        });
        menu.addItem({
            iconHTML: "⏱️",
            label: i18n("startCountUp") || "开始正向计时",
            click: () => this.startPomodoroCountUp(task)
        });

        menu.open({
            x: event.clientX,
            y: event.clientY,
        });
    }

    private async showTaskContextMenu(event: MouseEvent, task: any) {
        const menu = new Menu("kanbanTaskContextMenu");

        const childTasks = this.tasks.filter(t => t.parentId === task.id);

        // 编辑任务 - 针对周期任务显示不同选项
        if (task.isRepeatInstance) {
            // 周期事件实例 - 显示修改此实例和修改所有实例
            menu.addItem({
                iconHTML: "📝",
                label: i18n('modifyThisInstance'),
                click: () => this.editInstanceReminder(task)
            });
            menu.addItem({
                iconHTML: "🔄",
                label: i18n('modifyAllInstances'),
                click: () => this.editTask(task)
            });
        } else if (task.repeat?.enabled) {
            // 原始周期事件 - 只显示编辑选项
            menu.addItem({
                iconHTML: "📝",
                label: i18n('editTask'),
                click: () => this.editTask(task)
            });
        } else {
            // 普通任务
            menu.addItem({
                iconHTML: "📝",
                label: i18n('editTask'),
                click: () => this.editTask(task)
            });
            // 绑定块功能
            if (task.blockId || task.docId) {
                menu.addItem({
                    iconHTML: "📋",
                    label: i18n('copyBlockRef'),
                    click: () => this.copyBlockRef(task)
                });
            } else {
                menu.addItem({
                    iconHTML: "🔗",
                    label: i18n('bindToBlock'),
                    click: () => this.showBindToBlockDialog(task)
                });
            }
        }

        menu.addItem({
            iconHTML: "➕",
            label: i18n('createSubtask'),
            click: () => this.showCreateTaskDialog(task)
        });

        // 粘贴新建子任务
        menu.addItem({
            iconHTML: "📋",
            label: i18n('pasteCreateSubtask'),
            click: () => this.showPasteTaskDialog(task)
        });

        // 父子任务管理
        if (task.parentId) {
            menu.addItem({
                iconHTML: "🔗",
                label: i18n('unsetParentRelation'),
                click: () => this.unsetParentChildRelation(task)
            });
        }



        menu.addSeparator();

        // 设置优先级子菜单
        const priorityMenuItems = [];
        const priorities = [
            { key: 'high', label: i18n('priorityHigh'), icon: '🔴' },
            { key: 'medium', label: i18n('priorityMedium'), icon: '🟡' },
            { key: 'low', label: i18n('priorityLow'), icon: '🔵' },
            { key: 'none', label: i18n('none'), icon: '⚫' }
        ];

        const currentPriority = task.priority || 'none';
        priorities.forEach(priority => {
            priorityMenuItems.push({
                iconHTML: priority.icon,
                label: priority.label,
                current: currentPriority === priority.key,
                click: () => this.setPriority(task, priority.key)
            });
        });

        menu.addItem({
            iconHTML: "🎯",
            label: i18n('setPriority'),
            submenu: priorityMenuItems
        });

        // 状态切换：显示“设置状态”子菜单，列出所有可用状态（优先使用项目自定义的看板状态）
        const currentStatus = this.getTaskStatus(task);

        const statuses = (this.kanbanStatuses && this.kanbanStatuses.length > 0)
            ? this.kanbanStatuses
            : this.projectManager.getDefaultKanbanStatuses();

        const statusMenuItems: any[] = [];
        statuses.forEach((s: any) => {
            statusMenuItems.push({
                iconHTML: s.icon || '',
                label: s.name || s.id,
                current: currentStatus === s.id,
                click: () => this.changeTaskStatus(task, s.id)
            });
        });

        menu.addItem({
            iconHTML: "🔀",
            label: i18n('setStatus') || '设置状态',
            submenu: statusMenuItems
        });

        // 设置分组子菜单（仅在项目有自定义分组时显示）
        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);

            if (projectGroups.length > 0) {
                const groupMenuItems = [];
                const currentGroupId = task.customGroupId;

                // 添加"移除分组"选项
                groupMenuItems.push({
                    iconHTML: "❌",
                    label: i18n('removeGroup'),
                    current: !currentGroupId,
                    // 传入 task 对象（setTaskCustomGroup 期望第一个参数为 task 对象）
                    click: () => this.setTaskCustomGroup(task, null)
                });

                // 添加所有分组选项
                projectGroups.forEach((group: any) => {
                    groupMenuItems.push({
                        iconHTML: group.icon || "📋",
                        label: group.name,
                        current: currentGroupId === group.id,
                        // 传入 task 对象（setTaskCustomGroup 期望第一个参数为 task 对象）
                        click: () => this.setTaskCustomGroup(task, group.id)
                    });
                });

                menu.addItem({
                    iconHTML: "📂",
                    label: "设置分组",
                    submenu: groupMenuItems
                });
            }
        } catch (error) {
            console.error('加载分组信息失败:', error);
        }

        // 设置标签子菜单（仅在项目有标签时显示）
        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectTags = await projectManager.getProjectTags(this.projectId);

            if (projectTags.length > 0) {
                const tagMenuItems = [];
                const currentTagIds = task.tagIds || [];

                projectTags.forEach((tag: { id: string, name: string, color: string }) => {
                    const isSelected = currentTagIds.includes(tag.id);

                    // 创建带颜色的标签HTML，固定宽度并支持省略号
                    const tagBadgeHTML = `
                        <div style="
                            display: flex;
                            align-items: center;
                            width: 100%;
                        ">
                            <span style="
                                display: inline-flex;
                                align-items: center;
                                padding: 2px 8px;
                                font-size: 11px;
                                border-radius: 12px;
                                background: ${tag.color}20;
                                border: 1px solid ${tag.color};
                                color: var(--b3-theme-on-surface);
                                font-weight: 500;
                                max-width: 150px;
                                min-width: 80px;
                                overflow: hidden;
                                text-overflow: ellipsis;
                                white-space: nowrap;
                            " title="${tag.name}">#${tag.name}</span>
                        </div>
                    `;

                    tagMenuItems.push({
                        iconHTML: isSelected ? "✓" : "",
                        label: tagBadgeHTML,
                        click: () => this.toggleTaskTag(task, tag.id)
                    });
                });

                menu.addItem({
                    iconHTML: "🏷️",
                    label: i18n('setTags'),
                    submenu: tagMenuItems
                });
            }
        } catch (error) {
            console.error('加载项目标签失败:', error);
        }




        menu.addSeparator();

        // 番茄钟
        menu.addItem({
            iconHTML: "🍅",
            label: i18n('startPomodoro'),
            click: () => this.startPomodoro(task)
        });

        menu.addItem({
            iconHTML: "⏱️",
            label: i18n('startStopwatch'),
            click: () => this.startPomodoroCountUp(task)
        });

        menu.addSeparator();

        // 删除任务 - 针对周期任务显示不同选项
        if (task.isRepeatInstance) {
            // 周期事件实例 - 显示删除此实例和删除所有实例
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n('deleteThisInstance'),
                click: () => this.deleteInstanceOnly(task)
            });
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n('deleteAllInstances'),
                click: () => this.deleteTask(task)
            });
        } else {
            // 普通任务或原始周期事件
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n('deleteTask'),
                click: () => this.deleteTask(task)
            });
        }

        // 复制子任务为多级 Markdown 列表
        if (childTasks.length > 0) {
            menu.addItem({
                iconHTML: "📋",
                label: i18n('copySubtasksAsList'),
                click: () => {
                    const childLines = this.buildMarkdownListFromChildren(task.id);
                    if (childLines && childLines.length > 0) {
                        const text = childLines.join('\n');
                        // 复制到剪贴板
                        try {
                            navigator.clipboard.writeText(text);
                            showMessage(i18n('copiedSubtasksList'));
                        } catch (err) {
                            // 备用：使用临时 textarea
                            const ta = document.createElement('textarea');
                            ta.value = text;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            showMessage(i18n('copiedSubtasksList'));
                        }
                    } else {
                        showMessage(i18n('noSubtasksToCopy'));
                    }
                }
            });
        }

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async toggleTaskCompletion(task: any, completed: boolean) {
        // 1. 乐观更新 UI (Optimistic UI Update)
        const optimisticTask = this.tasks.find(t => t.id === task.id);
        if (optimisticTask) {
            optimisticTask.completed = completed;
            if (completed) {
                // 设置一个临时的完成时间用于排序
                optimisticTask.completedTime = getLocalDateTimeString(new Date());
            } else {
                delete optimisticTask.completedTime;
            }

            // 重新渲染：统一通过防抖刷新以保证数据一致性，避免局部渲染留下旧 DOM
            // 这会在短延迟后调用 loadTasks()，并由事件广播/队列保证最终一致性。
            this.queueLoadTasks();
        }

        // 2. 后台执行保存逻辑
        (async () => {
            try {
                if (task.isRepeatInstance && task.originalId) {
                    // 对于重复实例,使用不同的完成逻辑
                    await this.toggleRepeatInstanceCompletion(task, completed);
                } else {
                    // 对于普通任务
                    const reminderData = await this.getReminders();
                    if (reminderData[task.id]) {
                        reminderData[task.id].completed = completed;
                        const affectedBlockIds = new Set<string>();
                        if (task.blockId || task.docId) {
                            affectedBlockIds.add(task.blockId || task.docId);
                        }

                        if (completed) {
                            reminderData[task.id].completedTime = getLocalDateTimeString(new Date());
                            // 父任务完成时，自动完成所有子任务
                            await this.completeAllChildTasks(task.id, reminderData, affectedBlockIds);
                        } else {
                            delete reminderData[task.id].completedTime;
                            // 取消完成父任务时，通常不自动取消子任务
                        }

                        await saveReminders(this.plugin, reminderData);

                        // 更新所有受影响块的书签状态
                        for (const bId of affectedBlockIds) {
                            try {
                                await updateBindBlockAtrrs(bId, this.plugin);
                            } catch (err) {
                                console.warn('更新块书签失败:', bId, err);
                            }
                        }

                        // 广播更新事件并刷新
                        this.dispatchReminderUpdate(true);
                        // 确保最终一致
                        this.queueLoadTasks();
                    }
                }
            } catch (error) {
                console.error('切换任务完成状态失败:', error);
                showMessage('操作失败，正在恢复...');
                this.queueLoadTasks(); // 失败回滚
            }
        })();
    }

    /**
     * 切换重复实例的完成状态
     * @param task 重复实例任务
     * @param completed 是否完成
     */
    private async toggleRepeatInstanceCompletion(task: any, completed: boolean) {
        try {
            const reminderData = await this.getReminders();
            const originalReminder = reminderData[task.originalId];

            if (!originalReminder) {
                showMessage("原始重复事件不存在");
                return;
            }

            // 初始化完成实例列表
            if (!originalReminder.repeat.completedInstances) {
                originalReminder.repeat.completedInstances = [];
            }

            const instanceDate = task.date;
            const completedInstances = originalReminder.repeat.completedInstances;

            if (completed) {
                // 添加到完成列表（如果还没有的话）
                if (!completedInstances.includes(instanceDate)) {
                    completedInstances.push(instanceDate);
                }

                // 记录完成时间
                if (!originalReminder.repeat.instanceCompletedTimes) {
                    originalReminder.repeat.instanceCompletedTimes = {};
                }
                originalReminder.repeat.instanceCompletedTimes[instanceDate] = getLocalDateTimeString(new Date());

                // 递归完成所有子任务的对应实例或本身
                await this.completeAllChildInstances(task.originalId, instanceDate, reminderData);
            } else {
                // 从完成列表中移除
                const index = completedInstances.indexOf(instanceDate);
                if (index > -1) {
                    completedInstances.splice(index, 1);
                }

                // 移除完成时间记录
                if (originalReminder.repeat.instanceCompletedTimes) {
                    delete originalReminder.repeat.instanceCompletedTimes[instanceDate];
                }
            }

            await saveReminders(this.plugin, reminderData);

            // 更新本地缓存
            const localTask = this.tasks.find(t => t.id === task.id);
            if (localTask) {
                localTask.completed = completed;
                if (completed) {
                    localTask.completedTime = originalReminder.repeat.instanceCompletedTimes?.[instanceDate];
                } else {
                    delete localTask.completedTime;
                }

                // 更新 DOM
                this.updateTaskElementDOM(localTask.id, {
                    completed,
                    completedTime: localTask.completedTime
                });
            }

            // 广播更新事件
            this.dispatchReminderUpdate(true);
        } catch (error) {
            console.error('切换重复实例完成状态失败:', error);
            showMessage('操作失败，请重试');
        }
    }

    private async changeTaskStatus(task: any, newStatus: string) {
        try {
            // 保存旧状态,用于后续的DOM移动
            const oldStatus = this.getTaskStatus(task);

            // 如果当前是通过拖拽触发的状态变更，并且任务有设置日期且该日期为今天或已过
            // 则阻止直接把它移出 "进行中"，提示用户需要修改任务时间才能移出。
            try {
                const today = getLogicalDateString();
                if (this.isDragging && task && task.date && compareDateStrings(this.getTaskLogicalDate(task.date, task.time), today) <= 0 && newStatus !== 'doing' && newStatus !== 'completed') {
                    const dialog = new Dialog({
                        title: '提示',
                        content: `
                            <div class="b3-dialog__content">
                                <p>该任务的日期为今天或已过，系统会将其自动显示在“进行中”列。</p>
                                <p>要将任务移出“进行中”，需要修改任务的日期或时间。</p>
                            </div>
                            <div class="b3-dialog__action">
                                <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                                <button class="b3-button b3-button--primary" id="editBtn">编辑任务时间</button>
                            </div>
                        `,
                        width: "420px"
                    });

                    const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
                    const editBtn = dialog.element.querySelector('#editBtn') as HTMLButtonElement;

                    cancelBtn.addEventListener('click', () => dialog.destroy());
                    editBtn.addEventListener('click', async () => {
                        dialog.destroy();
                        // 打开编辑对话框以便用户修改时间
                        await this.editTask(task);
                    });

                    return; // 中断后续状态切换
                }
            } catch (err) {
                // ignore parsing errors and continue
            }
            const reminderData = await this.getReminders();

            // 对于周期实例，使用 originalId；否则使用 task.id
            const actualTaskId = task.isRepeatInstance ? task.originalId : task.id;

            if (reminderData[actualTaskId]) {
                const affectedBlockIds = new Set<string>();
                if (task.blockId || task.docId) {
                    affectedBlockIds.add(task.blockId || task.docId);
                }

                // 如果是周期实例，需要更新实例的完成状态
                if (task.isRepeatInstance) {
                    // 处理周期实例的完成状态
                    if (newStatus === 'completed') {
                        // 标记这个特定日期的实例为已完成
                        if (!reminderData[actualTaskId].repeat) {
                            reminderData[actualTaskId].repeat = {};
                        }
                        if (!reminderData[actualTaskId].repeat.completedInstances) {
                            reminderData[actualTaskId].repeat.completedInstances = [];
                        }
                        // 添加到已完成实例列表（如果还没有）
                        if (!reminderData[actualTaskId].repeat.completedInstances.includes(task.date)) {
                            reminderData[actualTaskId].repeat.completedInstances.push(task.date);
                        }

                        // 周期实例完成时，也自动完成所有子任务的对应实例
                        await this.completeAllChildInstances(actualTaskId, task.date, reminderData, affectedBlockIds);
                    } else {
                        // 取消完成周期实例或修改其他状态（long_term, short_term, doing）
                        if (reminderData[actualTaskId].repeat?.completedInstances) {
                            const index = reminderData[actualTaskId].repeat.completedInstances.indexOf(task.date);
                            if (index > -1) {
                                reminderData[actualTaskId].repeat.completedInstances.splice(index, 1);
                            }
                        }

                        // 对于周期事件，也需要支持修改 kanbanStatus
                        // 修改的是原始周期事件的属性，会影响所有未来实例
                        if (newStatus === 'long_term' || newStatus === 'short_term') {
                            reminderData[actualTaskId].kanbanStatus = newStatus;
                        } else if (newStatus === 'doing') {
                            reminderData[actualTaskId].kanbanStatus = 'doing';
                        } else {
                            // 支持自定义 kanban status id（非 long_term/short_term/doing）
                            reminderData[actualTaskId].kanbanStatus = newStatus;
                        }
                    }
                } else {
                    // 非周期实例的正常处理
                    if (newStatus === 'completed') {
                        reminderData[actualTaskId].completed = true;
                        reminderData[actualTaskId].completedTime = getLocalDateTimeString(new Date());

                        // 父任务完成时，自动完成所有子任务
                        await this.completeAllChildTasks(actualTaskId, reminderData, affectedBlockIds);
                    } else {
                        reminderData[actualTaskId].completed = false;
                        delete reminderData[actualTaskId].completedTime;

                        // 根据新状态设置kanbanStatus
                        if (newStatus === 'doing') {
                            reminderData[actualTaskId].kanbanStatus = 'doing';
                        } else {
                            // 支持自定义 kanban status id（非 long_term/short_term/doing）
                            reminderData[actualTaskId].kanbanStatus = newStatus;
                        }
                    }
                }

                await saveReminders(this.plugin, reminderData);

                // 更新受影响块的书签状态
                for (const bId of affectedBlockIds) {
                    try {
                        await updateBindBlockAtrrs(bId, this.plugin);
                    } catch (err) {
                        console.warn('更新块书签失败:', bId, err);
                    }
                }

                // 触发更新事件（debounced 由 listener 自动处理）
                this.dispatchReminderUpdate(true);

                // 如果是拖拽操作,尝试使用智能DOM移动
                if (this.isDragging) {
                    // 更新本地缓存
                    const localTask = this.tasks.find(t => t.id === actualTaskId);
                    if (localTask) {
                        if (newStatus === 'done') {
                            localTask.completed = true;
                            localTask.completedTime = reminderData[actualTaskId].completedTime;
                        } else {
                            localTask.completed = false;
                            delete localTask.completedTime;
                            localTask.kanbanStatus = newStatus;
                        }
                    }

                    // 尝试智能移动DOM
                    const taskEl = this.container.querySelector(`[data-task-id="${actualTaskId}"]`) as HTMLElement;
                    if (taskEl) {
                        const moved = this.moveTaskCardToColumn(taskEl, oldStatus, newStatus);
                        if (moved) {
                            // 刷新任务元素以应用新的样式（如已完成状态的透明度）
                            this.refreshTaskElement(actualTaskId);
                        } else {
                            // 移动失败,重新加载
                            await this.queueLoadTasks();
                        }
                    } else {
                        // 找不到元素,重新加载
                        await this.queueLoadTasks();
                    }
                } else {
                    // 非拖拽操作,重新加载以确保正确性
                    await this.queueLoadTasks();
                }
            }
        } catch (error) {
            console.error('切换任务状态失败:', error);
            showMessage("状态切换失败");
        }
    }

    /**
     * 当父任务完成时，自动完成所有子任务
     * @param parentId 父任务ID
     * @param reminderData 任务数据
     */
    private async completeAllChildTasks(parentId: string, reminderData: any, affectedBlockIds?: Set<string>): Promise<void> {
        try {
            // 获取所有子任务ID（递归获取所有后代）
            const descendantIds = this.getAllDescendantIds(parentId, reminderData);

            if (descendantIds.length === 0) {
                return; // 没有子任务，直接返回
            }

            const currentTime = getLocalDateTimeString(new Date());
            let completedCount = 0;

            // 自动完成所有子任务
            for (const childId of descendantIds) {
                const childTask = reminderData[childId];
                if (childTask && !childTask.completed) {
                    childTask.completed = true;
                    childTask.completedTime = currentTime;
                    completedCount++;

                    // 收集需要更新的块ID
                    if (affectedBlockIds && (childTask.blockId || childTask.docId)) {
                        affectedBlockIds.add(childTask.blockId || childTask.docId);
                    }
                }
            }

            if (completedCount > 0) {
                showMessage(i18n('autoCompleteSubtasks', { count: String(completedCount) }), 2000);
            }
        } catch (error) {
            console.error('自动完成子任务失败:', error);
            // 不要阻止父任务的完成，只是记录错误
        }
    }

    /**
     * 当周期任务实例完成时，自动完成所有子任务的对应实例或子任务本身
     * @param parentId 父任务原始ID
     * @param date 实例日期
     * @param reminderData 全量任务数据
     */
    private async completeAllChildInstances(parentId: string, date: string, reminderData: any, affectedBlockIds?: Set<string>): Promise<void> {
        try {
            const descendantIds = this.getAllDescendantIds(parentId, reminderData);
            if (descendantIds.length === 0) return;

            const currentTime = getLocalDateTimeString(new Date());
            let completedCount = 0;

            for (const childId of descendantIds) {
                const childTask = reminderData[childId];
                if (!childTask) continue;

                if (childTask.repeat?.enabled) {
                    // 子任务是周期任务，完成该日期的实例
                    if (!childTask.repeat.completedInstances) {
                        childTask.repeat.completedInstances = [];
                    }
                    if (!childTask.repeat.completedInstances.includes(date)) {
                        childTask.repeat.completedInstances.push(date);

                        // 记录实例完成时间
                        if (!childTask.repeat.instanceCompletedTimes) {
                            childTask.repeat.instanceCompletedTimes = {};
                        }
                        childTask.repeat.instanceCompletedTimes[date] = currentTime;
                        completedCount++;

                        // 收集需要更新的块ID
                        if (affectedBlockIds && (childTask.blockId || childTask.docId)) {
                            affectedBlockIds.add(childTask.blockId || childTask.docId);
                        }
                    }
                } else {
                    // 子任务是普通任务，直接完成
                    if (!childTask.completed) {
                        childTask.completed = true;
                        childTask.completedTime = currentTime;
                        completedCount++;

                        // 收集需要更新的块ID
                        if (affectedBlockIds && (childTask.blockId || childTask.docId)) {
                            affectedBlockIds.add(childTask.blockId || childTask.docId);
                        }
                    }
                }
            }

            if (completedCount > 0) {
                showMessage(i18n('autoCompleteSubtasks', { count: String(completedCount) }), 2000);
            }
        } catch (error) {
            console.error('自动完成子任务实例失败:', error);
            // 不要阻止父任务的完成，只是记录错误
        }
    }

    /**
     * 递归获取所有后代任务ID
     * @param parentId 父任务ID
     * @param reminderData 任务数据
     * @returns 所有后代任务ID数组
     */
    private getAllDescendantIds(parentId: string, reminderData: any): string[] {
        const result: string[] = [];
        const visited = new Set<string>(); // 防止循环引用

        const getChildren = (currentParentId: string) => {
            if (visited.has(currentParentId)) {
                return; // avoid cycles
            }
            visited.add(currentParentId);

            // Normalize reminderData into iterable list
            let values: any[] = [];
            try {
                if (!reminderData) values = [];
                else if (reminderData instanceof Map) values = Array.from(reminderData.values());
                else if (Array.isArray(reminderData)) values = reminderData;
                else values = Object.values(reminderData);
            } catch (e) {
                values = [];
            }

            for (const task of values) {
                if (task && task.parentId === currentParentId) {
                    result.push(task.id);
                    getChildren(task.id);
                }
            }
        };

        getChildren(parentId);
        return result;
    }

    /**
     * 收集给定任务ID集合的所有后代任务ID（基于 this.tasks）
     * @param taskIds 初始任务ID集合
     */
    private collectDescendantIds(taskIds: Set<string>): Set<string> {
        const idToTask = new Map(this.tasks.map(t => [t.id, t]));
        const visited = new Set<string>();
        const result = new Set<string>();
        const stack = Array.from(taskIds);

        while (stack.length > 0) {
            const id = stack.pop();
            if (!id || visited.has(id)) continue;
            visited.add(id);
            // 查找直接子任务
            for (const t of this.tasks) {
                if (t.parentId === id && !result.has(t.id)) {
                    result.add(t.id);
                    stack.push(t.id);
                }
            }
        }
        return result;
    }

    /**
     * 扩展一组任务，使其包含所有后代任务（可能包括已完成的子任务），以便在父任务下显示
     * @param tasksParam 需要扩展的任务数组（顶层任务列表）
     */
    private augmentTasksWithDescendants(tasksParam: any[], groupId?: string | null): any[] {
        if (!tasksParam || tasksParam.length === 0) return [];
        const idToTask = new Map(this.tasks.map(t => [t.id, t]));
        const resultMap = new Map<string, any>();

        // 初始添加（包含传入的任务）
        for (const t of tasksParam) {
            resultMap.set(t.id, t);
        }

        // 收集所有顶层任务 id
        const rootIds = new Set<string>(tasksParam.map(t => t.id));
        const descIds = this.collectDescendantIds(rootIds);
        for (const dId of descIds) {
            const dt = idToTask.get(dId);
            // 仅当子任务没有被分配到另一个自定义分组或其 customGroupId 与当前 groupId 匹配时，才作为后代添加
            if (dt) {
                if (!groupId || !dt.customGroupId || dt.customGroupId === groupId) {
                    resultMap.set(dId, dt);
                }
            }
        }

        // 返回数组形式，保持原来 tasksParam 的顺序尽可能不变：先原数组，然后添加后代（按 this.tasks 的顺序）
        const result: any[] = [];
        for (const t of tasksParam) result.push(t);
        for (const t of this.tasks) {
            if (resultMap.has(t.id) && !tasksParam.find(pt => pt.id === t.id)) {
                result.push(t);
            }
        }
        return result;
    }

    private showSortMenu(event: MouseEvent) {
        if (document.querySelector('.kanban-sort-menu')) {
            return;
        }

        const menuEl = document.createElement('div');
        menuEl.className = 'kanban-sort-menu';
        menuEl.style.cssText = `
                position: absolute;
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                padding: 8px;
            z-index: 100;
                display: flex;
            flex-direction: column;
                gap: 4px;
                `;

        const sortOptions = [
            { key: 'priority', label: '优先级', icon: '🎯' },
            { key: 'time', label: '时间', icon: '🕐' },
            { key: 'title', label: '标题', icon: '📝' }
        ];

        const createOption = (option: any, order: 'asc' | 'desc') => {
            const button = document.createElement('button');
            button.className = 'b3-button b3-button--outline';
            const isActive = this.currentSort === option.key && this.currentSortOrder === order;
            button.style.cssText = `
                width: 100%;
                display: flex;
                align-items: center;
                gap: 8px;
                justify-content: flex-start;
                text-align: left;
                background-color: ${isActive ? 'var(--b3-theme-primary-lightest)' : 'transparent'};
                color: ${isActive ? 'var(--b3-theme-primary)' : 'var(--b3-theme-on-surface)'};
                `;
            // Use valid <span> tags (no stray spaces in tag names), and keep layout compact
            button.innerHTML = `
                    <span style="font-size: 16px; margin-right: 8px;">${option.icon}</span>
                    <span>${option.label} (${order === 'asc' ? i18n('ascendingOrder') : i18n('descendingOrder')})</span>
                `;
            button.addEventListener('click', () => {
                this.currentSort = option.key;
                this.currentSortOrder = order;
                this.updateSortButtonTitle();
                this.sortTasks();
                this.renderKanban();
                closeMenu();
            });
            return button;
        };

        sortOptions.forEach(option => {
            menuEl.appendChild(createOption(option, 'desc'));
            menuEl.appendChild(createOption(option, 'asc'));
        });

        document.body.appendChild(menuEl);

        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        // Remove stray whitespace before 'px' (invalid CSS) and ensure the menu stays aligned to trigger element
        menuEl.style.top = `${rect.bottom + 4}px`;
        menuEl.style.left = `${rect.right - menuEl.offsetWidth}px`;
        // Ensure a minimum width so the content doesn't wrap awkwardly
        menuEl.style.minWidth = '180px';
        // preferable box-sizing for predictable width calculations
        menuEl.style.boxSizing = 'border-box';

        // Prevent the menu from going outside the viewport
        let left = rect.right - menuEl.offsetWidth;
        let top = rect.bottom + 4;
        if (left < 4) left = 4;
        if (left + menuEl.offsetWidth > window.innerWidth - 4) left = Math.max(4, window.innerWidth - menuEl.offsetWidth - 4);
        if (top + menuEl.offsetHeight > window.innerHeight - 4) top = Math.max(4, rect.top - menuEl.offsetHeight - 4);
        menuEl.style.left = `${left}px`;
        menuEl.style.top = `${top}px`;

        const closeMenu = () => {
            menuEl.remove();
            document.removeEventListener('click', handleClickOutside);
        };

        const handleClickOutside = (e: MouseEvent) => {
            if (!menuEl.contains(e.target as Node) && e.target !== event.currentTarget) {
                closeMenu();
            }
        };

        setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    }

    private showDoneSortMenu(event: MouseEvent) {
        const menu = new Menu("kanbanDoneSortMenu");

        const addMenuItem = (label: string, sortKey: string, sortOrder: 'asc' | 'desc') => {
            menu.addItem({
                label: label,
                current: this.doneSort === sortKey && this.doneSortOrder === sortOrder,
                click: () => {
                    this.doneSort = sortKey;
                    this.doneSortOrder = sortOrder;
                    this.updateDoneSortButtonTitle();
                    this.renderKanban();
                }
            });
        };

        addMenuItem(`${i18n('sortByCompletedTime')} (${i18n('descendingOrder')})`, 'completedTime', 'desc');
        addMenuItem(`${i18n('sortByCompletedTime')} (${i18n('ascendingOrder')})`, 'completedTime', 'asc');
        menu.addSeparator();
        addMenuItem(`${i18n('sortingPriority')} (${i18n('descendingOrder')})`, 'priority', 'desc');
        addMenuItem(`${i18n('sortingPriority')} (${i18n('ascendingOrder')})`, 'priority', 'asc');
        menu.addSeparator();
        addMenuItem(`${i18n('sortBySetTime')} (${i18n('descendingOrder')})`, 'time', 'desc');
        addMenuItem(`${i18n('sortBySetTime')} (${i18n('ascendingOrder')})`, 'time', 'asc');
        menu.addSeparator();
        addMenuItem(`${i18n('sortingTitle')} (${i18n('ascendingOrder')})`, 'title', 'asc');
        addMenuItem(`${i18n('sortingTitle')} (${i18n('descendingOrder')})`, 'title', 'desc');

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    // 使用 QuickReminderDialog 创建任务
    private showCreateTaskDialog(parentTask?: any, defaultCustomGroupId?: string | null, defaultStatus?) {
        // Calculate max sort value to place new task at the end
        const maxSort = this.tasks.reduce((max, task) => Math.max(max, task.sort || 0), 0);
        const defaultSort = maxSort + 10000;

        const quickDialog = new QuickReminderDialog(
            undefined, // 项目看板创建任务默认不设置日期
            undefined, // 无初始时间
            async (savedTask: any) => {
                // 保存成功后尝试增量更新 DOM
                if (savedTask && typeof savedTask === 'object') {
                    try {
                        // 1. 更新本地缓存
                        if (this.reminderData) {
                            this.reminderData[savedTask.id] = savedTask;
                        }
                        // 确保 task 不重复添加
                        const existingIndex = this.tasks.findIndex(t => t.id === savedTask.id);

                        // 兼容性处理：新任务只有 createdAt，补齐 createdTime 以便排序
                        if (savedTask.createdAt && !savedTask.createdTime) {
                            savedTask.createdTime = savedTask.createdAt;
                        }

                        if (existingIndex >= 0) {
                            this.tasks[existingIndex] = savedTask;
                        } else {
                            this.tasks.push(savedTask);
                        }

                        // 立即排序，确保乐观更新时顺序正确
                        this.sortTasks();

                        // 2. 刷新对应列（增量渲染）
                        if (this.kanbanMode === 'custom') {
                            const group = this.project?.customGroups?.find((g: any) => g.id === savedTask.customGroupId);
                            if (group) {
                                const groupTasks = this.tasks.filter(t => t.customGroupId === group.id);
                                this.renderCustomGroupColumn(group, groupTasks);
                            } else {
                                const ungroupedTasks = this.tasks.filter(t => !t.customGroupId);
                                this.renderUngroupedColumn(ungroupedTasks);
                            }
                        } else {
                            const status = this.getTaskStatus(savedTask);
                            // 过滤出该状态列的所有任务
                            // 使用 getTaskStatus 确保逻辑一致（处理完成状态、日期自动归档、忽略自定义分组ID对列的影响）
                            const tasksInColumn = this.tasks.filter(t => this.getTaskStatus(t) === status);
                            this.renderColumn(status, tasksInColumn);
                        }

                        this.dispatchReminderUpdate(true);
                    } catch (e) {
                        console.error("增量更新新任务失败，回退到完整重载", e);
                        this.queueLoadTasks();
                    }
                } else {
                    this.queueLoadTasks();
                }
            },
            undefined, // 无时间段选项
            {
                defaultProjectId: this.projectId, // 默认项目ID
                defaultParentId: parentTask?.id, // 传递父任务ID
                defaultCategoryId: parentTask?.categoryId || this.project.categoryId, // 如果是子任务，继承父任务分类；否则使用项目分类
                defaultPriority: parentTask?.priority, // 如果是子任务，继承父任务优先级
                defaultTitle: parentTask ? '' : undefined, // 子任务不预填标题
                // 传入默认 custom group id（可能为 undefined 或 null）
                defaultCustomGroupId: parentTask?.customGroupId ?? defaultCustomGroupId,
                hideProjectSelector: true, // 隐藏项目选择器
                showKanbanStatus: 'term', // 显示任务类型选择
                // 使用上一次选择的 termType 作为默认值
                defaultStatus: defaultStatus || this.lastSelectedStatus,
                plugin: this.plugin, // 传入plugin实例
                defaultSort: defaultSort
            }
        );

        quickDialog.show();

        // 重写保存回调，保存用户选择的 status 和自定义分组
        const originalOnSaved = quickDialog['onSaved'];
        quickDialog['onSaved'] = async (savedTask: any) => {
            if (originalOnSaved) {
                originalOnSaved(savedTask);
            }

            // 保存用户选择的 status 到内存中
            try {
                const selectedStatus = quickDialog['dialog']?.element?.querySelector('#quickStatusSelector .task-status-option.selected') as HTMLElement;
                const status = selectedStatus?.getAttribute('data-status-type');
                if (status && status !== this.lastSelectedStatus) {
                    this.lastSelectedStatus = status;
                }
            } catch (error) {
                console.error('保存上一次选择的 status 失败:', error);
            }

            // 保存用户选择的自定义分组到内存中（空字符串视为 null）
            try {
                const groupEl = quickDialog['dialog']?.element?.querySelector('#quickCustomGroupSelector') as HTMLSelectElement;
                if (groupEl) {
                    const val = groupEl.value;
                    const groupId = (val === '' ? null : val);
                    if (groupId !== this.lastSelectedCustomGroupId) {
                        this.lastSelectedCustomGroupId = groupId;
                    }
                }
            } catch (error) {
                console.error('保存上一次选择的自定义分组失败:', error);
            }
        };
    }

    private async editTask(task: any) {
        try {
            // 对于周期实例，需要编辑原始周期事件
            // 注意：不能直接使用实例对象，需要从数据中读取原始事件
            let taskToEdit = task;

            if (task.isRepeatInstance && task.originalId) {
                const reminderData = await this.getReminders();
                const originalReminder = reminderData[task.originalId];
                if (!originalReminder) {
                    showMessage("原始周期事件不存在");
                    return;
                }
                // 使用原始事件对象而不是实例对象
                taskToEdit = originalReminder;
            }

            // 优化：只通过 reminderUpdated 事件触发刷新，避免重复更新
            // 事件监听器会调用 queueLoadTasks() 进行防抖刷新
            const callback = (savedTask?: any) => {
                if (savedTask) {
                    // 1. 乐观更新 UI (Optimistic UI Update)
                    const taskIndex = this.tasks.findIndex(t => t.id === savedTask.id);
                    // 兼容性处理：如果返回的任务只有 createdAt，补齐 createdTime
                    if (savedTask.createdAt && !savedTask.createdTime) {
                        savedTask.createdTime = savedTask.createdAt;
                    }

                    if (taskIndex >= 0) {
                        this.tasks[taskIndex] = savedTask;
                    } else {
                        // 理论上编辑任务不应该走到这里，但以防万一
                        this.tasks.push(savedTask);
                    }

                    // 立即重新排序（可能修改了优先级或时间）
                    this.sortTasks();

                    // 2. 统一使用防抖加载刷新以保证最终一致性
                    // 局部渲染容易导致旧 DOM 残留（特别是跨列/分组移动），使用 queueLoadTasks 可简化逻辑并保证一致性
                    this.queueLoadTasks();
                }

                this.dispatchReminderUpdate(true);
            };

            const editDialog = new QuickReminderDialog(undefined, undefined, callback, undefined, {
                mode: 'edit',
                reminder: taskToEdit,
                plugin: this.plugin,
                defaultProjectId: taskToEdit.projectId,
                defaultCustomGroupId: taskToEdit.customGroupId
            });
            editDialog.show();
        } catch (error) {
            console.error('打开编辑对话框失败:', error);
            showMessage("打开编辑对话框失败");
        }
    }

    private async showPasteTaskDialog(parentTask?: any, customGroupId?: string, defaultStatus?: string, showSelectors: boolean = false) {
        // 如果需要显示选择器，获取项目配置
        let projectGroups: any[] = [];
        let kanbanStatuses: any[] = this.kanbanStatuses;

        if (showSelectors && !parentTask) {
            try {
                projectGroups = await this.projectManager.getProjectCustomGroups(this.projectId);
            } catch (error) {
                console.error('获取项目分组失败:', error);
            }
        }

        // 如果有父任务，则默认采用父任务的状态；否则使用传入的 defaultStatus
        const effectiveDefaultStatus = parentTask ? this.getTaskStatus(parentTask) : defaultStatus;

        const dialog = new PasteTaskDialog({
            plugin: this.plugin,
            parentTask,
            projectId: this.projectId,
            customGroupId,
            defaultStatus: effectiveDefaultStatus,
            showStatusSelector: showSelectors && !parentTask, // 只在非子任务且显示选择器时显示
            showGroupSelector: showSelectors && !parentTask,  // 只在非子任务且显示选择器时显示
            projectGroups,
            kanbanStatuses,
            onSuccess: (totalCount) => {
                showMessage(`${totalCount} 个任务已创建`);
                this.reminderData = null; // 清理缓存，确保 queueLoadTasks 读取最新数据
                this.queueLoadTasks();
                this.dispatchReminderUpdate(true);
            }
        });
        dialog.show();
    }

    private async deleteTask(task: any) {
        // 对于周期实例，删除原始周期事件（所有实例）
        const taskToDelete = task.isRepeatInstance ?
            { ...task, id: task.originalId, isRepeatInstance: false } : task;

        // 先尝试读取数据以计算所有后代任务数量，用于更准确的确认提示
        let confirmMessage = task.isRepeatInstance ?
            i18n('confirmDeleteRepeat', { title: task.title }) :
            i18n('confirmDeleteTask', { title: task.title });
        try {
            const reminderDataForPreview = await this.getReminders();
            const descendantIdsPreview = this.getAllDescendantIds(taskToDelete.id, reminderDataForPreview);
            if (descendantIdsPreview.length > 0) {
                confirmMessage += `\n\n${i18n('includesNSubtasks', { count: String(descendantIdsPreview.length) })}`;
            }
        } catch (err) {
            // 无法读取数据时，仍然显示通用提示
        }

        confirm(
            i18n('deleteTask'),
            confirmMessage,
            async () => {
                // --- Optimistic UI Update ---
                try {
                    const idsToRemove = new Set<string>();

                    // 1. Identify main tasks to remove
                    if (task.isRepeatInstance) {
                        // If deleting all instances of a recurring task, find all instances in the current view
                        const originalId = task.originalId;
                        this.tasks.forEach(t => {
                            if (t.id === originalId || t.originalId === originalId) {
                                idsToRemove.add(t.id);
                            }
                        });
                    } else {
                        idsToRemove.add(taskToDelete.id);
                    }

                    // 2. Identify descendants (using local cache)
                    const initialTargets = Array.from(idsToRemove);
                    for (const parentId of initialTargets) {
                        const descendantIds = this.getAllDescendantIds(parentId, this.tasks);
                        descendantIds.forEach(id => idsToRemove.add(id));
                    }

                    // 3. Remove from DOM and local cache
                    idsToRemove.forEach(id => {
                        const el = this.container.querySelector(`[data-task-id="${id}"]`);
                        if (el) el.remove();
                    });

                    this.tasks = this.tasks.filter(t => !idsToRemove.has(t.id));

                } catch (e) {
                    console.error("Optimistic UI update failed:", e);
                }
                // -----------------------------

                try {
                    // 重读数据以确保删除时数据为最新
                    const reminderData = await this.getReminders();

                    // 获取所有后代任务ID（递归）
                    const descendantIds = this.getAllDescendantIds(taskToDelete.id, reminderData);

                    const tasksToDelete = [taskToDelete.id, ...descendantIds];
                    const boundIdsToUpdate = new Set<string>();

                    // 删除并收集需要更新的绑定块ID
                    for (const taskId of tasksToDelete) {
                        const t = reminderData[taskId];
                        if (t) {
                            // 收集绑定了块或文档的ID
                            if (t.blockId || t.docId) {
                                boundIdsToUpdate.add(t.blockId || t.docId);
                            }
                            // 删除数据项
                            delete reminderData[taskId];
                        }
                    }

                    // 先保存数据
                    await saveReminders(this.plugin, reminderData);

                    // 保存后再批量更新块的书签状态（忽略错误）
                    for (const boundId of boundIdsToUpdate) {
                        try {
                            await updateBindBlockAtrrs(boundId, this.plugin);
                        } catch (err) {
                            console.warn(`更新已删除任务属性失败: `, boundId, err);
                        }
                    }

                    // 触发更新事件
                    this.dispatchReminderUpdate(true);

                    // 重新加载任务（使用防抖队列，确保最终一致性）
                    await this.queueLoadTasks();

                    // showMessage("任务已删除");
                } catch (error) {
                    console.error('删除任务失败:', error);
                    showMessage("删除任务失败");
                    // Keep UI consistent or facilitate retry by reloading
                    await this.queueLoadTasks();
                }
            }
        );
    }

    private startPomodoro(task: any) {
        if (!this.plugin) {
            showMessage(i18n('pomodoroUnavailable'));
            return;
        }

        // 检查是否已经有活动的番茄钟
        const currentTimer = this.pomodoroManager.getCurrentPomodoroTimer();
        if (currentTimer && currentTimer.isWindowActive()) {
            const currentState = currentTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || i18n('currentPomodoroTask');
            const newTitle = task.title || i18n('newPomodoroTask');

            let confirmMessage = `${i18n('currentPomodoroTask')}："${currentTitle}"，${i18n('switchPomodoroTask')}："${newTitle}"？`;

            if (currentState.isRunning && !currentState.isPaused) {
                try {
                    this.pomodoroManager.pauseCurrentTimer();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                confirmMessage += `\n\n${i18n('switchAndInherit')}`;
            }

            confirm(
                i18n('switchPomodoroTask'),
                confirmMessage,
                () => {
                    this.performStartPomodoro(task, currentState);
                },
                () => {
                    if (currentState.isRunning && !currentState.isPaused) {
                        try {
                            this.pomodoroManager.resumeCurrentTimer();
                        } catch (error) {
                            console.error('恢复番茄钟运行失败:', error);
                        }
                    }
                }
            );
        } else {
            this.performStartPomodoro(task);
        }
    }

    private startPomodoroCountUp(task: any) {
        if (!this.plugin) {
            showMessage(i18n('pomodoroUnavailable'));
            return;
        }

        // 检查是否已经有活动的番茄钟
        const currentTimer = this.pomodoroManager.getCurrentPomodoroTimer();
        if (currentTimer && currentTimer.isWindowActive()) {
            const currentState = currentTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || i18n('currentPomodoroTask');
            const newTitle = task.title || i18n('newPomodoroTask');

            let confirmMessage = `${i18n('currentPomodoroTask')}："${currentTitle}"，${i18n('switchToStopwatch')}："${newTitle}"？`;

            if (currentState.isRunning && !currentState.isPaused) {
                try {
                    this.pomodoroManager.pauseCurrentTimer();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                confirmMessage += `\n\n${i18n('switchAndInherit')}`;
            }

            confirm(
                i18n('switchToStopwatch'),
                confirmMessage,
                () => {
                    this.performStartPomodoroCountUp(task, currentState);
                },
                () => {
                    if (currentState.isRunning && !currentState.isPaused) {
                        try {
                            this.pomodoroManager.resumeCurrentTimer();
                        } catch (error) {
                            console.error('恢复番茄钟运行失败:', error);
                        }
                    }
                }
            );
        } else {
            this.performStartPomodoroCountUp(task);
        }
    }

    private async performStartPomodoro(task: any, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟

            const reminder = {
                id: task.id,
                title: task.title,
                blockId: task.blockId,
                isRepeatInstance: false,
                originalId: task.id
            };

            if (typeof this.plugin.openPomodoroWindow === 'function') {
                await this.plugin.openPomodoroWindow(reminder, settings, false, inheritState);

                // 如果继承了状态且原来正在运行，显示继承信息
                if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                    const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                    showMessage(`已切换任务并继承${phaseText}进度`, 2000);
                }
            }
        } else {
            // 没有独立窗口，在当前窗口显示番茄钟 Dialog（默认行为）

            // 如果已经有活动的番茄钟，先关闭它
            this.pomodoroManager.closeCurrentTimer();

            const reminder = {
                id: task.id,
                title: task.title,
                blockId: task.blockId,
                isRepeatInstance: false,
                originalId: task.id
            };

            const pomodoroTimer = new PomodoroTimer(reminder, settings, false, inheritState, this.plugin);
            this.pomodoroManager.setCurrentPomodoroTimer(pomodoroTimer);
            pomodoroTimer.show();

            // 如果继承了状态且原来正在运行，显示继承信息
            if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                showMessage(`已切换任务并继承${phaseText}进度`, 2000);
            }
        }
    }

    private async performStartPomodoroCountUp(task: any, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟

            const reminder = {
                id: task.id,
                title: task.title,
                blockId: task.blockId,
                isRepeatInstance: false,
                originalId: task.id
            };

            if (typeof this.plugin.openPomodoroWindow === 'function') {
                await this.plugin.openPomodoroWindow(reminder, settings, true, inheritState);

                // 如果继承了状态且原来正在运行，显示继承信息
                if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                    const phaseText = inheritState.isWorkPhase ? i18n('workTime') : i18n('breakTime');
                    showMessage(i18n('switchToStopwatchWithInherit', { phase: phaseText }), 2000);
                } else {
                    showMessage(i18n('startStopwatchSuccess'), 2000);
                }
            }
        } else {
            // 没有独立窗口，在当前窗口显示番茄钟 Dialog（默认行为）

            // 如果已经有活动的番茄钟，先关闭它
            this.pomodoroManager.closeCurrentTimer();

            const reminder = {
                id: task.id,
                title: task.title,
                blockId: task.blockId,
                isRepeatInstance: false,
                originalId: task.id
            };

            const pomodoroTimer = new PomodoroTimer(reminder, settings, true, inheritState, this.plugin);
            this.pomodoroManager.setCurrentPomodoroTimer(pomodoroTimer);
            pomodoroTimer.show();

            // 如果继承了状态且原来正在运行，显示继承信息
            if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                showMessage(`已切换到正计时模式并继承${phaseText}进度`, 2000);
            } else {
                showMessage("已启动正计时番茄钟", 2000);
            }
        }
    }

    private addCustomStyles() {
        // 检查是否已经添加过样式
        if (document.querySelector('#project-kanban-custom-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'project-kanban-custom-styles';
        style.textContent = `
            .project-kanban-view {
                height: 100%;
                display: flex;
                flex-direction: column;
                background: var(--b3-theme-background);
            }

            .project-kanban-toolbar {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                padding: 16px 24px;
                border-bottom: 1px solid var(--b3-theme-border);
                background: var(--b3-theme-background);
                gap: 16px;
            }

            .project-kanban-title {
                width: 100%;
                border-bottom: 1px solid var(--b3-theme-border);
            }

            .project-kanban-controls {
                width: 100%;
                display: flex;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
            }

            /* 响应式布局 - 窄屏优化 */
            @media (max-width: 600px) {
                .project-kanban-toolbar {
                    flex-direction: column;
                    align-items: stretch;
                    gap: 12px;
                }

                .project-kanban-title {
                    width: 100%;
                    min-width: auto;
                }

                .project-kanban-controls {
                    width: 100%;
                    justify-content: flex-start;
                    margin-left: 0;
                    gap: 6px;
                }

                .project-kanban-controls .b3-button {
                    flex: 1;
                    min-width: 0;
                    font-size: 12px;
                    padding: 4px 8px;
                }
            }

            @media (max-width: 400px) {
                .project-kanban-toolbar {
                    padding: 8px 12px;
                }

                .project-kanban-title h2 {
                    font-size: 16px;
                }

                .project-kanban-description {
                    font-size: 12px;
                }

                .project-kanban-controls {
                    flex-direction: column;
                    gap: 4px;
                }

                .project-kanban-controls .b3-button {
                    width: 100%;
                    justify-content: center;
                }
            }

            .project-kanban-container {
                flex: 1;
                display: flex;
                gap: 16px;
                padding: 16px;
                overflow-x: auto;
                overflow-y: auto;
                min-height: 0;
                /* 水平滚动布局：每列固定宽度 */
            }

            /* 确保在极窄屏幕上也能正常显示 */
            @media (max-width: 320px) {
                .project-kanban-container {
                    padding: 8px;
                    gap: 8px;
                }
            }

            .kanban-column {
                background: var(--b3-theme-background);
                border-radius: 8px;
                border: 2px solid var(--b3-border-color);
                display: flex;
                flex-direction: column;
                min-width: 280px; /* 固定最小宽度 */
                flex: 1; /* 均匀分布宽度 */
                max-height: 100%;
            }

            .kanban-column-header {
                padding: 12px 16px;
                border-bottom: 1px solid var(--b3-theme-border);
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .kanban-column-content {
                flex: 1;
                padding: 0px;
                overflow-y: auto;
                min-height: 200px;
                /* Reserve space for scrollbar so right padding doesn't appear larger
                   when the vertical scrollbar shows up */
                scrollbar-gutter: stable both-edges;
                /* Make scrollbar thinner where supported (Firefox) */
                scrollbar-width: thin;
            }

            .kanban-column-count {
                border-radius: 12px;
                padding: 2px 8px;
                font-size: 12px;
                font-weight: 500;
                min-width: 20px;
                text-align: center;
            }

            /* 基础任务卡片样式 */
            .kanban-task {
                background: var(--b3-theme-surface-lighter);
                border: 1px solid var(--b3-theme-border);
                border-radius: 6px;
                padding: 12px;
                margin-bottom: 8px;
                cursor: grab;
                transition: all 0.2s ease;
                position: relative;
            }

            .kanban-task:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            }

            .kanban-task.dragging {
                opacity: 0.5;
                cursor: grabbing;
            }

            /* 优先级样式美化 - 使用思源主题颜色 */

            .kanban-task-priority-high:hover {
                box-shadow: 0 0 0 1px var(--b3-card-error-color), 0 4px 12px rgba(231, 76, 60, 0.25) !important;
            }


            .kanban-task-priority-medium:hover {
                box-shadow: 0 0 0 1px var(--b3-card-warning-color), 0 4px 12px rgba(243, 156, 18, 0.25) !important;
            }



            .kanban-task-priority-low:hover {
                box-shadow: 0 0 0 1px var(--b3-card-info-color), 0 4px 12px rgba(52, 152, 219, 0.25) !important;
            }

            .kanban-task-title {
                font-weight: 500;
                margin-bottom: 8px;
                color: var(--b3-theme-on-surface);
                line-height: 1.4;
            }

            .kanban-task-info {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .kanban-task-date {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
            }

            /* 优先级标签样式 - 参考 project-priority-label */
            .kanban-task-priority {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 1px 4px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: 500;
                margin-top: 2px;
                width: fit-content;
                align-self: flex-start;
            }

            .priority-label-high {
                background-color: rgba(231, 76, 60, 0.1);
                color: #e74c3c;
            }

            .priority-label-medium {
                background-color: rgba(243, 156, 18, 0.1);
                color: #f39c12;
            }

            .priority-label-low {
                background-color: rgba(52, 152, 219, 0.1);
                color: #3498db;
            }

            .priority-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
            }

            .priority-dot.high {
                background: #e74c3c;
            }

            .priority-dot.medium {
                background: #f39c12;
            }

            .priority-dot.low {
                background: #3498db;
            }

            .priority-dot.none {
                background: #95a5a6;
            }

            .kanban-task-category {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 11px;
                color: white;
                font-weight: 500;
                align-self: flex-start;
            }

            .kanban-task-note {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.8;
                margin-top: 4px;
                line-height: 1.3;
                max-height: 40px;
                overflow: hidden;
                text-overflow: ellipsis;
                padding: 4px 8px;
                background: var(--b3-theme-surface-lighter);
                border-radius: 4px;
                border: 1px solid var(--b3-border-color);
                transition: all 0.2s ease;
            }

            /* 优先级任务的备注样式 */
            .kanban-task-priority-high .kanban-task-note {
                background-color: rgba(231, 76, 60, 0.08) !important;
                border-color: rgba(231, 76, 60, 0.2) !important;
                color: var(--b3-card-error-color) !important;
            }

            .kanban-task-priority-medium .kanban-task-note {
                background-color: rgba(243, 156, 18, 0.08) !important;
                border-color: rgba(243, 156, 18, 0.2) !important;
                color: var(--b3-card-warning-color) !important;
            }

            .kanban-task-priority-low .kanban-task-note {
                background-color: rgba(52, 152, 219, 0.08) !important;
                border-color: rgba(52, 152, 219, 0.2) !important;
                color: var(--b3-card-info-color) !important;
            }

            .kanban-drop-zone-active {
                background: var(--b3-theme-primary-lightest);
                border-color: var(--b3-theme-primary);
            }

            /* 父子任务拖拽样式 */
            .parent-child-drop-target {
                border: 2px dashed var(--b3-theme-primary) !important;
                background: var(--b3-theme-primary-lightest) !important;
                transform: scale(1.02) !important;
                box-shadow: 0 4px 20px rgba(0, 123, 255, 0.3) !important;
                position: relative;
            }

            .parent-child-indicator {
                animation: fadeInUp 0.2s ease-out;
            }

            @keyframes fadeInUp {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(5px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }

            .parent-child-hint {
                display: flex;
                align-items: center;
                justify-content: center;
            }

            /* 排序拖拽提示样式 */
            .sort-hint {
                animation: fadeInRight 0.2s ease-out;
            }

            @keyframes fadeInRight {
                from {
                    opacity: 0;
                    transform: translateX(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }

            
            .task-status-selector {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
                align-items: flex-start;
            }
            .task-status-option {
                flex: 0 0 auto;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 6px 10px;
                margin: 6px 8px 0 0;
                border-radius: 20px;
                cursor: pointer;
                border: 2px solid var(--b3-theme-border);
                transition: all 0.2s ease;
                background-color: var(--b3-theme-surface);
                white-space: nowrap;
            }
            .task-status-option:hover {
                background-color: var(--b3-theme-surface-lighter);
                border-color: var(--b3-theme-primary-lighter);
            }
            .task-status-option.selected {
                font-weight: 600;
                border-color: var(--b3-theme-primary);
                background-color: var(--b3-theme-primary-lightest);
                color: var(--b3-theme-primary);
            }


            .kanban-task-block-info {
                font-size: 11px;
                color: var(--b3-theme-on-background);
                margin-top: 4px;
                opacity: 0.9;
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 2px 6px;
                background-color: var(--b3-theme-surface-lighter);
                border-radius: 4px;
                border: 1px solid var(--b3-theme-border);
                transition: all 0.2s ease;
            }

            .kanban-task-block-info:hover {
                background-color: var(--b3-theme-primary-lightest);
                border-color: var(--b3-theme-primary);
            }

            .kanban-task-block-info span[data-type="a"] {
                cursor: pointer;
                color: var(--b3-theme-primary);
                text-decoration: underline dotted;
                text-decoration-style: dotted;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                transition: color 0.2s ease;
            }

            .kanban-task-block-info span[data-type="a"]:hover {
                color: var(--b3-theme-primary-light);
            }

            .kanban-task-pomodoro-count {
                /* Styles for pomodoro count */
            }

            /* 倒计时样式 */
            .countdown-badge {
                font-size: 11px;
                padding: 2px 6px;
                border-radius: 10px;
                font-weight: 500;
                margin-left: 4px;
                display: inline-block;
            }

            .countdown-urgent {
                background-color: rgba(231, 76, 60, 0.15);
                color: #e74c3c;
                border: 1px solid rgba(231, 76, 60, 0.3);
            }

            .countdown-warning {
                background-color: rgba(243, 156, 18, 0.15);
                color: #f39c12;
                border: 1px solid rgba(243, 156, 18, 0.3);
            }

            .countdown-normal {
                background-color: rgba(46, 204, 113, 0.15);
                color: #2ecc71;
                border: 1px solid rgba(46, 204, 113, 0.3);
            }

            /* 过期任务样式 - 复用倒计时样式 */
            .countdown-badge.countdown-normal[style*="rgba(231, 76, 60"] {
                background-color: rgba(231, 76, 60, 0.15) !important;
                color: #e74c3c !important;
                border: 1px solid rgba(231, 76, 60, 0.3) !important;
            }

           .kanban-task-checkbox {
                -webkit-appearance: none;
                appearance: none;
                background-color: background-color: rgba(from var(--b3-theme-background-light) r g b / .1);
                margin: 0;
                margin-top: 5px; /* 微调对齐 */
                font: inherit;
                color: var(--b3-theme-on-surface);
                width: 1.15em;
                height: 1.15em;
                border: 0.1em solid var(--b3-theme-on-surface);
                border-radius: 0.25em;
                transform: translateY(-0.075em);
                display: grid;
                place-content: center;
                cursor: pointer;
                transition: all 0.2s ease;
                flex-shrink: 0;
            }

           .kanban-task-checkbox:hover {
                border-color: var(--b3-theme-primary);
            }

           .kanban-task-checkbox::before {
                content: "";
                width: 0.65em;
                height: 0.65em;
                transform: scale(0);
                transition: 120ms transform ease-in-out;
                box-shadow: inset 1em 1em var(--b3-theme-primary);
                transform-origin: bottom left;
                clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
            }

           .kanban-task-checkbox:checked {
                background: var(--b3-theme-primary);
                border-color: var(--b3-theme-primary);
            }

           .kanban-task-checkbox:checked::before {
                transform: scale(1);
                box-shadow: inset 1em 1em var(--b3-theme-surface);
            }

           .kanban-task-collapse-btn {
                width: 10px;
                min-width: auto;
                color: var(--b3-theme-on-surface);
                opacity: 0.6;
                display: flex;
                align-items: center;
                justify-content: center;
            }
           .kanban-task-collapse-btn .b3-button__icon {
                margin: 0;
            }
            .kanban-task-collapse-btn svg{
                height: 10px;
                width: 10px;
            }
           .kanban-task-collapse-btn:hover {
                opacity: 1;
                color: var(--b3-theme-primary);
                background: var(--b3-theme-surface-lighter);
            }

           /* 项目标题点击样式 */
           .project-kanban-title h2 {
                cursor: pointer;
                transition: color 0.2s ease;
            }
           
           .project-kanban-title h2:hover {
                color: var(--b3-theme-primary);
            }
           
           .project-kanban-title h2[data-has-note="true"] {
                text-decoration: underline dotted;
                text-decoration-style: dotted;
            }
           
           .project-kanban-title h2[data-has-note="true"]:hover {
                color: var(--b3-theme-primary);
            }
            /* 父任务子任务进度条 */
            .kanban-task-progress-container {
                margin-top: 8px;
            }

            .kanban-task-progress-wrap {
                background: rgba(0,0,0,0.06);
                height: 8px;
                border-radius: 6px;
                overflow: hidden;
            }

            .kanban-task-progress-bar {
                height: 100%;
                background: linear-gradient(90deg, #2ecc71, #27ae60);
                transition: width 0.3s ease;
                border-radius: 6px 0 0 6px;
            }

            .kanban-task-progress-text {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.9;
                min-width: 34px;
                text-align: right;
            }

            /* 自定义分组样式 */
            .custom-group-in-status {
                background: var(--b3-theme-background);
                border-radius: 8px;
                border: 1px solid var(--b3-border-color);
            }

            .custom-group-header {
                user-select: none;
                position: sticky;
                top: 0;
                z-index: 10;
                margin-bottom: 6px;
            }

            .custom-group-header:hover {
                background: var(--b3-theme-primary-lightest) !important;
            }

            .custom-group-title {
                font-weight: 600 !important;
            }

            .custom-group-collapse-btn {
                width: 16px;
                height: 16px;
                min-width: auto;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.7;
                transition: opacity 0.2s ease;
            }

            .custom-group-collapse-btn:hover {
                opacity: 1;
            }

            .custom-group-collapse-btn svg {
                width: 12px;
                height: 12px;
            }

            .custom-group-tasks {
                transition: all 0.3s ease;
            }

            .status-column-groups {
                padding: 4px;
            }

            /* 自定义分组状态容器样式 */
            .custom-group-status-container {
                padding: 4px;
            }

            .custom-status-group {
                background: var(--b3-theme-background);
                border-radius: 8px;
                border: 1px solid var(--b3-border-color);
            }

            .custom-status-group-header {
                user-select: none;
                position: sticky;
                top: 0;
                z-index: 10;
            }

            .custom-status-group-header:hover {
                background: var(--b3-theme-primary-lightest) !important;
            }

            .custom-status-group-title {
                font-weight: 600 !important;
            }

            .custom-status-group-collapse-btn {
                width: 16px;
                height: 16px;
                min-width: auto;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.7;
                transition: opacity 0.2s ease;
            }

            .custom-status-group-collapse-btn:hover {
                opacity: 1;
            }

            .custom-status-group-collapse-btn svg {
                width: 12px;
                height: 12px;
            }

            .custom-status-group-tasks {
                transition: all 0.3s ease;
            }

            /* 分组管理对话框样式 */
            .manage-groups-dialog .groups-container {
                border: 1px solid var(--b3-theme-border);
                border-radius: 4px;
                background: var(--b3-theme-surface);
            }

            .group-item:hover {
                background: var(--b3-theme-primary-lightest) !important;
            }

            .color-option {
                position: relative;
            }

            .color-option.selected {
                border-color: var(--b3-theme-primary) !important;
                box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest);
            }

            .color-option:hover {
                transform: scale(1.1);
            }

            .group-form {
                animation: slideIn 0.3s ease-out;
            }

            @keyframes slideIn {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            /* 删除分组对话框样式 */
            .delete-group-dialog .b3-radio {
                margin-top: 8px;
            }

            .delete-group-dialog .b3-radio label {
                display: flex;
                align-items: center;
                margin-bottom: 8px;
                cursor: pointer;
            }

            .delete-group-dialog .b3-radio__mark {
                margin-right: 8px;
            }

            /* 看板模式选择下拉框样式 */
            .kanban-mode-select {
                background: var(--b3-theme-surface) !important;
                border: 1px solid var(--b3-theme-border) !important;
                border-radius: 4px !important;
                padding: 6px 8px !important;
                font-size: 14px !important;
                color: var(--b3-theme-on-surface) !important;
                cursor: pointer !important;
                min-width: 140px !important;
                transition: all 0.2s ease !important;
            }

            .kanban-mode-select:hover {
                border-color: var(--b3-theme-primary) !important;
                background: var(--b3-theme-primary-lightest) !important;
            }

            .kanban-mode-select:focus {
                outline: none !important;
                border-color: var(--b3-theme-primary) !important;
                box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest) !important;
            }

            .kanban-mode-select option {
                background: var(--b3-theme-surface) !important;
                color: var(--b3-theme-on-surface) !important;
                padding: 4px 8px !important;
            }

            /* ==================== 批量多选样式 ==================== */

            /* 多选复选框样式 - 圆形 */
            .kanban-task-multiselect-checkbox {
                width: 20px !important;
                height: 20px !important;
                cursor: pointer !important;
                flex-shrink: 0 !important;
                margin-top: 2px !important;
                border-radius: 50% !important;
                border: 2px solid var(--b3-theme-primary) !important;
                background: var(--b3-theme-background) !important;
                appearance: none !important;
                -webkit-appearance: none !important;
                position: relative !important;
                transition: all 0.2s ease !important;
            }

            /* 选中状态 */
            .kanban-task-multiselect-checkbox:checked {
                background: var(--b3-theme-primary) !important;
            }

            /* 选中时的对勾图标 */
            .kanban-task-multiselect-checkbox:checked::after {
                content: '' !important;
                position: absolute !important;
                left: 5px !important;
                top: 2px !important;
                width: 6px !important;
                height: 10px !important;
                border: solid white !important;
                border-width: 0 2px 2px 0 !important;
                transform: rotate(45deg) !important;
            }

            .kanban-task-multiselect-checkbox:hover {
                transform: scale(1.1);
                box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest) !important;
            }

            /* 选中状态的任务卡片 */
            .kanban-task-selected {
                box-shadow: 0 0 0 2px var(--b3-theme-primary) !important;
                border-color: var(--b3-theme-primary) !important;
            }

            .kanban-task-selected:hover {
                box-shadow: 0 0 0 3px var(--b3-theme-primary), 0 4px 12px rgba(0, 0, 0, 0.15) !important;
            }

            /* 批量操作工具栏 */
            .kanban-batch-toolbar {
                animation: batchToolbarSlideUp 0.3s ease-out;
            }

            @keyframes batchToolbarSlideUp {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }

            .kanban-batch-toolbar .batch-toolbar-count {
                font-weight: 600;
                color: var(--b3-theme-primary);
                min-width: 100px;
                white-space: nowrap;
            }

            /* 多选模式下的任务卡片悬停效果 */
            .kanban-task:has(.kanban-task-multiselect-checkbox):hover {
                background-color: var(--b3-theme-surface) !important;
            }

            /* 响应式：批量工具栏在窄屏下的适配 */
            @media (max-width: 768px) {
                .kanban-batch-toolbar {
                    min-width: auto !important;
                    width: 95vw !important;
                    padding: 10px 12px !important;
                    gap: 8px !important;
                    flex-wrap: wrap !important;
                }

                .kanban-batch-toolbar .batch-toolbar-count {
                    width: 100%;
                    text-align: center;
                    margin-bottom: 4px;
                }

                .kanban-batch-toolbar > div:nth-child(2) {
                    display: none;
                }

                .kanban-batch-toolbar > div:nth-child(3) {
                    width: 100%;
                    justify-content: center;
                    margin: 4px 0;
                }

                .kanban-batch-toolbar > div:last-child {
                    width: 100%;
                    justify-content: center;
                    margin-left: 0 !important;
                }
            }
            `;
        document.head.appendChild(style);
    }
    private renderCategorySelector(container: HTMLElement, defaultCategoryId?: string) {
        container.innerHTML = '';
        const categories = this.categoryManager.getCategories();

        const noCategoryEl = document.createElement('div');
        noCategoryEl.className = 'category-option';
        noCategoryEl.setAttribute('data-category', '');
        noCategoryEl.innerHTML = `<span>无分类</span>`;
        if (!defaultCategoryId) {
            noCategoryEl.classList.add('selected');
        }
        container.appendChild(noCategoryEl);

        categories.forEach(category => {
            const categoryEl = document.createElement('div');
            categoryEl.className = 'category-option';
            categoryEl.setAttribute('data-category', category.id);
            categoryEl.style.backgroundColor = category.color;
            categoryEl.innerHTML = `<span>${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
            if (category.id === defaultCategoryId) {
                categoryEl.classList.add('selected');
            }
            container.appendChild(categoryEl);
        });

        container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option') as HTMLElement;
            if (option) {
                container.querySelectorAll('.category-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });
    }

    // 设置任务优先级
    private async setPriority(task: any, priority: string) {
        // 1. 乐观更新内存数据和 DOM
        const optimisticTask = this.tasks.find(t => t.id === task.id);
        if (optimisticTask) {
            optimisticTask.priority = priority;
        }

        const taskEl = this.container.querySelector(`.kanban-task[data-task-id="${task.id}"]`) as HTMLElement;
        if (taskEl) {
            // 更新 CSS 类
            taskEl.classList.remove('kanban-task-priority-high', 'kanban-task-priority-medium', 'kanban-task-priority-low');
            if (priority !== 'none') {
                taskEl.classList.add(`kanban-task-priority-${priority}`);
            }

            // 更新背景和边框
            let backgroundColor = '';
            let borderColor = '';
            switch (priority) {
                case 'high':
                    backgroundColor = 'rgba(from var(--b3-card-error-background) r g b / .5)';
                    borderColor = 'var(--b3-card-error-color)';
                    break;
                case 'medium':
                    backgroundColor = 'rgba(from var(--b3-card-warning-background) r g b / .5)';
                    borderColor = 'var(--b3-card-warning-color)';
                    break;
                case 'low':
                    backgroundColor = 'rgba(from var(--b3-card-info-background) r g b / .7)';
                    borderColor = 'var(--b3-card-info-color)';
                    break;
                default:
                    backgroundColor = 'rgba(from var(--b3-theme-background-light) r g b / .1)';
                    borderColor = 'var(--b3-theme-background-light)';
            }
            taskEl.style.backgroundColor = backgroundColor;
            taskEl.style.borderColor = borderColor;

            // 更新优先级标签
            let priorityEl = taskEl.querySelector('.kanban-task-priority') as HTMLElement;
            if (priority === 'none') {
                if (priorityEl) priorityEl.remove();
            } else {
                if (!priorityEl) {
                    priorityEl = document.createElement('div');
                    priorityEl.className = 'kanban-task-priority';
                    const infoEl = taskEl.querySelector('.kanban-task-info');
                    if (infoEl) infoEl.appendChild(priorityEl);
                }
                const priorityNames = {
                    'high': '高优先级',
                    'medium': '中优先级',
                    'low': '低优先级'
                };
                priorityEl.className = `kanban-task-priority priority-label-${priority}`;
                priorityEl.innerHTML = `<span class="priority-dot ${priority}"></span><span>${priorityNames[priority]}</span>`;
            }
        }

        // 2. 后台保存数据
        try {
            const reminderData = await this.getReminders();

            // 如果是重复实例，修改实例的优先级
            if (task.isRepeatInstance && task.originalId) {
                const originalReminder = reminderData[task.originalId];
                if (!originalReminder) {
                    // 如果原始任务丢失，可能需要回滚 UI（此处略，仅提示）
                    console.error("原始任务不存在，无法保存优先级");
                    return;
                }

                // 初始化实例修改结构
                if (!originalReminder.repeat) {
                    originalReminder.repeat = {};
                }
                if (!originalReminder.repeat.instanceModifications) {
                    originalReminder.repeat.instanceModifications = {};
                }
                if (!originalReminder.repeat.instanceModifications[task.date]) {
                    originalReminder.repeat.instanceModifications[task.date] = {};
                }

                // 设置实例的优先级
                originalReminder.repeat.instanceModifications[task.date].priority = priority;

                await saveReminders(this.plugin, reminderData);
            } else {
                // 普通任务或原始重复事件，直接修改
                if (reminderData[task.id]) {
                    reminderData[task.id].priority = priority;

                    // 如果是重复事件，清除所有实例的优先级覆盖（因为修改主任务通常意味着重置/统一优先级，或者看具体需求，这里保持原有逻辑）
                    if (reminderData[task.id].repeat?.enabled && reminderData[task.id].repeat?.instanceModifications) {
                        const modifications = reminderData[task.id].repeat.instanceModifications;
                        Object.keys(modifications).forEach(date => {
                            if (modifications[date].priority !== undefined) {
                                delete modifications[date].priority;
                            }
                        });
                    }

                    await saveReminders(this.plugin, reminderData);
                } else {
                    // 任务不存在
                    return;
                }
            }
            // 防抖加载
            this.queueLoadTasks();
            // 保存成功后，分发更新事件（通知其他视图），但不请求重新加载当前视图（因为已经乐观更新了）
            this.dispatchReminderUpdate(true);

        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage("设置优先级失败，正在恢复...");
            // 如果失败，强制重载以恢复正确状态
            await this.queueLoadTasks();
        }
    }

    // 复制块引用
    private async copyBlockRef(task: any) {
        try {
            const blockId = task.blockId;
            if (!blockId) {
                showMessage("无法获取块ID");
                return;
            }

            const title = task.title || "未命名任务";
            const blockRef = `((${blockId} "${title}"))`;

            await navigator.clipboard.writeText(blockRef);
            showMessage("块引用已复制到剪贴板");
        } catch (error) {
            console.error('复制块引用失败:', error);
            showMessage("复制块引用失败");
        }
    }

    // 显示绑定到块的对话框（支持绑定现有块或创建新文档并绑定）
    private showBindToBlockDialog(reminder: any) {
        const blockBindingDialog = new BlockBindingDialog(this.plugin, async (blockId: string) => {
            try {
                await this.bindReminderToBlock(reminder, blockId);
                showMessage(i18n("reminderBoundToBlock"));
                this.queueLoadTasks();
            } catch (error) {
                console.error('绑定提醒到块失败:', error);
                showMessage(i18n("bindToBlockFailed"));
            }
        }, {
            defaultTab: 'bind',
            defaultParentId: reminder.parentId,
            defaultProjectId: this.projectId, // 使用当前项目ID
            defaultCustomGroupId: reminder.customGroupId,
            reminder: reminder
        });
        blockBindingDialog.show();
    }



    /**
     * 将提醒绑定到指定的块（adapted from ReminderPanel）
     */
    private async bindReminderToBlock(reminder: any, blockId: string) {
        // 1. 乐观更新内存数据和 DOM
        const optimisticTask = this.tasks.find(t => t.id === reminder.id);
        if (optimisticTask) {
            optimisticTask.blockId = blockId;
        }

        const taskEl = this.container.querySelector(`.kanban-task[data-task-id="${reminder.id}"]`) as HTMLElement;
        if (taskEl) {
            const titleEl = taskEl.querySelector('.kanban-task-title') as HTMLElement;
            if (titleEl) {
                // 直接更新样式和行为，避免全量重绘导致的闪烁
                titleEl.style.color = 'var(--b3-theme-primary)';
                titleEl.style.textDecoration = 'underline dotted';
                titleEl.style.cursor = 'pointer';
                titleEl.title = i18n('clickToOpenBoundBlock', { title: reminder.title || i18n('noContentHint') });

                const newTitleEl = titleEl.cloneNode(true) as HTMLElement;
                newTitleEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openBlockTab(blockId);
                });
                titleEl.parentNode?.replaceChild(newTitleEl, titleEl);
            }
        }

        try {
            let reminderData = await this.getReminders();
            let reminderId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;

            if (reminderData[reminderId]) {
                // 获取块信息
                await refreshSql();

                const block = await getBlockByID(blockId);
                if (!block) {
                    throw new Error('目标块不存在');
                }

                // 更新提醒数据
                reminderData[reminderId].blockId = blockId;
                reminderData[reminderId].docId = block.root_id || blockId;
                reminderData[reminderId].isQuickReminder = false; // 移除快速提醒标记

                await saveReminders(this.plugin, reminderData);

                // 将绑定的块添加项目ID属性 custom-task-projectId
                const projectId = reminderData[reminderId].projectId;
                if (projectId) {
                    const { addBlockProjectId } = await import('../api');
                    await addBlockProjectId(blockId, projectId);
                    console.debug('ProjectKanbanView: bindReminderToBlock - 已为块设置项目ID', blockId, projectId);
                }

                // 更新块的书签状态（添加⏰书签）
                await updateBindBlockAtrrs(blockId, this.plugin);
                // 防抖加载
                this.queueLoadTasks();
                // 触发更新事件
                this.dispatchReminderUpdate(true);


            } else {
                throw new Error('提醒不存在');
            }
        } catch (error) {
            console.error('绑定提醒到块失败:', error);
            // 失败时回滚/刷新
            this.queueLoadTasks();
            throw error;
        }
    }


    /**
     * 打开块标签页
     * @param blockId 块ID
     */
    private async openBlockTab(blockId: string) {
        try {
            openBlock(blockId);
        } catch (error) {
            console.error('打开块失败:', error);

            // 询问用户是否删除无效的绑定
            await confirm(
                "打开块失败",
                "绑定的块可能已被删除，是否解除绑定？",
                async () => {
                    // 解除任务的块绑定
                    await this.unbindTaskFromBlock(blockId);
                },
                () => {
                    showMessage("打开块失败");
                }
            );
        }
    }

    /**
     * 打开项目笔记
     * @param blockId 项目笔记的块ID
     */
    private async openProjectNote(blockId: string) {
        try {
            openBlock(blockId);
        } catch (error) {
            console.error('打开项目笔记失败:', error);
            showMessage("打开项目笔记失败");
        }
    }

    /**
     * 解除任务与块的绑定
     * @param blockId 块ID
     */
    private async unbindTaskFromBlock(blockId: string) {
        try {
            const reminderData = await this.getReminders();
            let unboundCount = 0;

            // 找到所有绑定到该块的任务并解除绑定
            Object.keys(reminderData).forEach(taskId => {
                const task = reminderData[taskId];
                if (task && task.blockId === blockId) {
                    delete task.blockId;
                    delete task.docId;
                    unboundCount++;
                }
            });

            if (unboundCount > 0) {
                await saveReminders(this.plugin, reminderData);

                // 触发更新事件
                this.dispatchReminderUpdate(true);

                showMessage(`已解除 ${unboundCount} 个任务的块绑定`);
                await this.queueLoadTasks();
            } else {
                showMessage("未找到相关的任务绑定");
            }
        } catch (error) {
            console.error('解除块绑定失败:', error);
            showMessage("解除块绑定失败");
        }
    }

    /**
     * Get task object from a task element, with customGroupId extracted from DOM
     */
    private getTaskFromElement(element: HTMLElement): any {
        const taskId = element.dataset.taskId;
        if (!taskId) return null;

        // Find the task in our tasks array
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return null;

        // Clone the task to avoid modifying the original
        const taskCopy = { ...task };

        // Extract customGroupId from DOM structure
        // Look for the closest custom-status-group element first
        const statusGroup = element.closest('.custom-status-group') as HTMLElement;
        if (statusGroup && statusGroup.dataset.groupId) {
            // In custom mode with status sub-groups
            const groupId = statusGroup.dataset.groupId;
            taskCopy.customGroupId = groupId === 'ungrouped' ? undefined : groupId;
        } else {
            // Look for the closest kanban-column element
            const column = element.closest('.kanban-column') as HTMLElement;
            if (column && column.dataset.groupId) {
                const groupId = column.dataset.groupId;
                taskCopy.customGroupId = groupId === 'ungrouped' ? undefined : groupId;
            }
        }

        return taskCopy;
    }

    private canDropForSort(draggedTask: any, targetTask: any): boolean {
        if (!draggedTask || !targetTask) return false;

        // 情况1：同级顶层任务之间排序
        if (!draggedTask.parentId && !targetTask.parentId) {
            // 允许跨优先级拖拽，后续在 reorderTasks 中会自动更新优先级
            return true;
        }

        // 情况2：子任务之间排序（同一个父任务下）
        if (draggedTask.parentId && targetTask.parentId) {
            return draggedTask.parentId === targetTask.parentId;
        }

        // 情况3：不允许顶层任务与子任务之间排序
        return false;
    }

    /**
     * Checks if a dragged task can become a sibling of a target task.
     * This is true if the target is a subtask and the dragged task is not an ancestor of the target.
     * @param draggedTask The task being dragged
     * @param targetTask The drop target task
     * @returns boolean
     */
    private canBecomeSiblingOf(draggedTask: any, targetTask: any): boolean {
        if (!draggedTask || !targetTask) return false;

        // Target task must be a subtask to define a sibling context.
        if (!targetTask.parentId) return false;

        // Dragged task cannot be the same as the target task.
        if (draggedTask.id === targetTask.id) return false;

        // Dragged task cannot be the parent of the target task.
        if (draggedTask.id === targetTask.parentId) return false;

        // If dragged task is already a sibling, this case is handled by canDropForSort.
        if (draggedTask.parentId === targetTask.parentId) return false;

        // To prevent circular dependencies, the dragged task cannot be an ancestor of the target task.
        if (this.isDescendant(targetTask, draggedTask)) return false;

        return true;
    }

    /**
     * 检查是否可以设置父子任务关系
     * @param draggedTask 被拖拽的任务
     * @param targetTask 目标任务（潜在的父任务）
     * @returns 是否可以设置为父子关系
     */
    private canSetAsParentChild(draggedTask: any, targetTask: any): boolean {
        if (!draggedTask || !targetTask) return false;

        // 不能将任务拖拽到自己身上
        if (draggedTask.id === targetTask.id) return false;

        // 订阅任务不支持设置父子关系
        if (draggedTask.isSubscribed || targetTask.isSubscribed) return false;

        // 如果两个任务都是子任务且属于同一个父任务，不显示父子关系提示
        // （应该显示排序提示）
        if (draggedTask.parentId && targetTask.parentId &&
            draggedTask.parentId === targetTask.parentId) {
            return false;
        }

        // 不能将父任务拖拽到自己的子任务上（防止循环依赖）
        if (this.isDescendant(targetTask, draggedTask)) return false;

        // 不能将任务拖拽到已经是其父任务的任务上
        if (draggedTask.parentId === targetTask.id) return false;

        return true;
    }

    /**
     * 检查 potential_child 是否是 potential_parent 的后代
     * @param potentialChild 潜在的子任务
     * @param potentialParent 潜在的父任务
     * @returns 是否是后代关系
     */
    private isDescendant(potentialChild: any, potentialParent: any): boolean {
        if (!potentialChild || !potentialParent) return false;

        let currentTask = potentialChild;
        const visited = new Set(); // 防止无限循环

        while (currentTask && currentTask.parentId && !visited.has(currentTask.id)) {
            visited.add(currentTask.id);

            if (currentTask.parentId === potentialParent.id) {
                return true;
            }

            // 查找父任务
            currentTask = this.tasks.find(t => t.id === currentTask.parentId);
        }

        return false;
    }

    /**
     * 统一的指示器更新方法，避免频繁的DOM操作导致闪烁
     * @param type 指示器类型
     * @param target 目标元素
     * @param position 位置
     * @param event 可选的拖拽事件
     */
    private updateIndicator(
        type: 'none' | 'sort' | 'parentChild',
        target: HTMLElement | null,
        position: 'top' | 'bottom' | 'middle' | null,
        event?: DragEvent
    ) {
        // 检查是否需要更新
        const needsUpdate = this.currentIndicatorType !== type ||
            this.currentIndicatorTarget !== target ||
            this.currentIndicatorPosition !== position;

        if (!needsUpdate) {
            return; // 状态没有改变，不需要更新
        }

        // 清除现有的所有指示器
        this.clearAllIndicators();

        // 更新状态
        this.currentIndicatorType = type;
        this.currentIndicatorTarget = target;
        this.currentIndicatorPosition = position;

        // 显示新的指示器
        switch (type) {
            case 'sort':
                if (target && event) {
                    this.createSortIndicator(target, event);
                }
                break;
            case 'parentChild':
                if (target && position === 'top') {
                    this.createParentChildIndicator(target, 'top');
                } else if (target) {
                    this.createParentChildIndicator(target);
                }
                break;
            case 'none':
            default:
                // 已经清除了所有指示器，无需额外操作
                break;
        }
    }

    /**
     * 清除所有指示器
     */
    private clearAllIndicators() {
        // 移除排序指示器
        this.container.querySelectorAll('.drop-indicator').forEach(indicator => indicator.remove());

        // 移除父子关系指示器
        this.container.querySelectorAll('.parent-child-indicator').forEach(indicator => indicator.remove());
        this.container.querySelectorAll('.parent-child-drop-target').forEach(el => {
            el.classList.remove('parent-child-drop-target');
        });

        // 重置position样式
        this.container.querySelectorAll('.kanban-task').forEach((el: HTMLElement) => {
            if (el.style.position === 'relative') {
                el.style.position = '';
            }
        });
    }

    /**
     * 创建排序指示器
     * @param element 目标元素
     * @param event 拖拽事件
     */
    private createSortIndicator(element: HTMLElement, event: DragEvent) {
        const rect = element.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        indicator.style.cssText = `
            position: absolute;
            left: 0;
            right: 0;
            height: 2px;
            background-color: var(--b3-theme-primary);
            z-index: 1000;
            pointer-events: none;
            box-shadow: 0 0 4px var(--b3-theme-primary);
        `;

        element.style.position = 'relative';

        if (event.clientY < midpoint) {
            indicator.style.top = '-1px';
        } else {
            indicator.style.bottom = '-1px';
        }

        // 不再添加排序提示文字，只显示蓝色指示线
        element.appendChild(indicator);
    }

    /**
     * 创建父子任务指示器
     * @param element 目标元素
     */
    /**
     * 创建父子任务指示器，支持指定位置
     */
    private createParentChildIndicator(element: HTMLElement, _position: 'top' | 'middle' = 'middle') {
        element.classList.add('parent-child-drop-target');

    }

    /**
     * 处理父子任务拖拽放置
     * @param targetTask 目标任务（将成为父任务）
     */
    private async handleParentChildDrop(targetTask: any) {
        if (!this.draggedTask) return;

        try {
            await this.setParentChildRelation(this.draggedTask, targetTask);
            showMessage(`"${this.draggedTask.title}" 已设置为 "${targetTask.title}" 的子任务`);
        } catch (error) {
            // showMessage("设置父子任务关系失败");
        }
    }

    /**
     * 设置任务的父子关系
     * @param childTask 子任务
     * @param parentTask 父任务
     */
    private async setParentChildRelation(childTask: any, parentTask: any) {
        try {
            const reminderData = await this.getReminders();

            if (!reminderData[childTask.id]) {
                throw new Error("子任务不存在");
            }

            if (!reminderData[parentTask.id]) {
                throw new Error("父任务不存在");
            }

            // 设置子任务的父任务ID
            reminderData[childTask.id].parentId = parentTask.id;

            // 子任务继承父任务的状态和分组
            const parentInDb = reminderData[parentTask.id];
            const childInDb = reminderData[childTask.id];
            const parentStatus = this.getTaskStatus(parentInDb);

            // 1. 继承状态
            if (parentStatus === 'completed') {
                if (!childInDb.completed) {
                    childInDb.kanbanStatus = 'completed';
                    childInDb.completed = true;
                    childInDb.completedTime = getLocalDateTimeString(new Date());
                }
            } else {
                // 如果父任务未完成，子任务跟随父任务状态，并重置完成状态
                childInDb.kanbanStatus = parentStatus;
                if (childInDb.completed) {
                    childInDb.completed = false;
                    delete childInDb.completedTime;
                }
            }

            // 2. 继承分组
            if (childInDb.customGroupId !== parentInDb.customGroupId) {
                if (parentInDb.customGroupId === undefined) {
                    delete childInDb.customGroupId;
                } else {
                    childInDb.customGroupId = parentInDb.customGroupId;
                }
            }

            await saveReminders(this.plugin, reminderData);

            // 更新本地缓存
            const localChild = this.tasks.find(t => t.id === childTask.id);
            if (localChild) {
                localChild.parentId = parentTask.id;
                // 同步本地缓存状态
                if (parentStatus === 'completed') {
                    localChild.kanbanStatus = 'completed';
                    localChild.completed = true;
                    localChild.completedTime = getLocalDateTimeString(new Date());
                } else {
                    localChild.kanbanStatus = parentStatus;
                    localChild.completed = false;
                    delete localChild.completedTime;
                }
                // 同步本地缓存分组
                localChild.customGroupId = parentInDb.customGroupId;
            }

            this.dispatchReminderUpdate(true);

            // 父子关系改变会影响任务层级显示,需要重新加载
            // 但只在拖拽操作时使用防抖,避免频繁重载
            await this.queueLoadTasks();
        } catch (error) {
            console.error('设置父子关系失败:', error);
            throw error;
        }
    }

    /**
     * 解除任务的父子关系
     * @param childTask 子任务
     */
    private async unsetParentChildRelation(childTask: any) {
        try {
            const reminderData = await this.getReminders();

            if (!reminderData[childTask.id]) {
                throw new Error("任务不存在");
            }

            if (!childTask.parentId) {
                return; // 没有父任务，不需要解除关系
            }

            // 查找父任务的标题用于提示
            const parentTask = reminderData[childTask.parentId];
            const parentTitle = parentTask ? parentTask.title : '未知任务';

            // 移除父任务ID
            delete reminderData[childTask.id].parentId;

            await saveReminders(this.plugin, reminderData);

            // 更新本地缓存
            const localTask = this.tasks.find(t => t.id === childTask.id);
            if (localTask) {
                delete localTask.parentId;
            }

            this.dispatchReminderUpdate(true);

            showMessage(`"${childTask.title}" 已从 "${parentTitle}" 中独立出来`);

            // 解除父子关系会影响任务层级显示,需要重新加载
            // 使用防抖避免频繁重载
            await this.queueLoadTasks();
        } catch (error) {
            console.error('解除父子关系失败:', error);
            showMessage("解除父子关系失败");
        }
    }

    private async handleSortDrop(targetTask: any, event: DragEvent) {
        if (!this.draggedTask) return;

        try {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = event.clientY < midpoint;

            // 如果是订阅任务且试图改变状态（KanbanStatus），则由于只读限制应阻止（除了同状态内的排序）
            // 但如果 reorderTasks 中处理了这些逻辑，我们直接调用

            // Optimistic UI update: 直接在 DOM 层面移动元素，无需等待后台保存
            this.reorderTasksDOM(this.draggedTask.id, targetTask.id, insertBefore);

            await this.reorderTasks(this.draggedTask, targetTask, insertBefore);

        } catch (error) {
            console.error('处理拖放排序失败:', error);
            showMessage(i18n("sortUpdateFailed") || "排序更新失败");
        }
    }

    /**
     * Handles the drop event for making a task a sibling of another and sorting it.
     * @param draggedTask The task that was dragged
     * @param targetTask The task that was the drop target
     * @param event The drop event
     */
    private async handleBecomeSiblingDrop(draggedTask: any, targetTask: any, event: DragEvent) {
        if (!draggedTask || !targetTask || !targetTask.parentId) return;

        try {
            const reminderData = await this.getReminders();
            const draggedTaskInDb = reminderData[draggedTask.id];
            if (!draggedTaskInDb) {
                throw new Error("Dragged task not found in data");
            }

            const newParentId = targetTask.parentId;
            const parentTaskInDb = reminderData[newParentId];
            if (!parentTaskInDb) {
                throw new Error("Parent task not found in data");
            }

            // 1. Set parentId for the dragged task
            draggedTaskInDb.parentId = newParentId;

            // 如果父任务属于某个自定义分组，则将被拖拽任务的 customGroupId 同步为父任务的分组
            try {
                const parentGroup = parentTaskInDb.customGroupId === undefined ? null : parentTaskInDb.customGroupId;
                if (parentGroup === null) {
                    delete draggedTaskInDb.customGroupId;
                } else {
                    draggedTaskInDb.customGroupId = parentGroup;
                }
            } catch (err) {
                // 忽略分组同步错误，继续执行父子关系设置
            }

            // 2. A sub-task inherits the status of its parent (or more accurately, its root parent)
            const parentStatus = this.getTaskStatus(parentTaskInDb);
            if (!draggedTaskInDb.completed) {
                if (parentStatus === 'doing') {
                    draggedTaskInDb.kanbanStatus = 'doing';
                } else if (parentStatus === 'long_term' || parentStatus === 'short_term') {
                    // 继承父任务的长期/短期状态
                    draggedTaskInDb.kanbanStatus = parentStatus;
                } else {
                    // 其他状态默认设为进行中
                    draggedTaskInDb.kanbanStatus = 'doing';
                }
            }

            // 3. Reorder siblings
            // Get all new siblings, EXCEPT the dragged task itself
            const siblingTasks = Object.values(reminderData)
                .filter((r: any) => r && r.parentId === newParentId && r.id !== draggedTask.id)
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            // Determine insertion point
            // Use event.target instead of event.currentTarget to avoid null reference
            const targetElement = event.target as HTMLElement;
            if (!targetElement) {
                throw new Error("Event target is null");
            }

            // Find the task element that contains the target
            let taskElement = targetElement.closest('.kanban-task') as HTMLElement;
            if (!taskElement) {
                throw new Error("Could not find task element");
            }

            const rect = taskElement.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = event.clientY < midpoint;

            const targetIndex = siblingTasks.findIndex((t: any) => t.id === targetTask.id);
            const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

            // Insert the dragged task into the siblings list
            siblingTasks.splice(insertIndex, 0, draggedTaskInDb);

            // Re-assign sort values
            siblingTasks.forEach((task: any, index: number) => {
                reminderData[task.id].sort = index * 10;
            });

            await saveReminders(this.plugin, reminderData);

            // 更新本地缓存的 sort 值，避免编辑时使用旧值
            siblingTasks.forEach((task: any) => {
                const localTask = this.tasks.find(t => t.id === task.id);
                if (localTask) {
                    localTask.sort = task.sort;
                }
            });

            this.dispatchReminderUpdate(true);

        } catch (error) {
            console.error('Failed to set task as sibling and sort:', error);
            showMessage("移动任务失败");
        }
    }

    private async reorderTasks(draggedTask: any, targetTask: any, insertBefore: boolean) {
        try {
            const reminderData = await this.getReminders();

            const draggedId = draggedTask.id;
            const targetId = targetTask.id;

            const draggedTaskInDb = reminderData[draggedId];
            const targetTaskInDb = reminderData[targetId];

            if (!draggedTaskInDb || !targetTaskInDb) {
                throw new Error("Task not found in data");
            }

            const oldStatus = this.getTaskStatus(draggedTaskInDb);
            const newStatus = this.getTaskStatus(targetTaskInDb);

            // 如果当前为自定义分组看板模式，且目标任务所在分组与被拖拽任务不同，
            // 则将被拖拽任务移动到目标任务的分组（上下放置时也应修改分组）并在该分组内重新排序
            // 如果当前为自定义分组看板模式，且目标任务所在分组与被拖拽任务不同，
            // 则将被拖拽任务移动到目标任务的分组（上下放置时也应修改分组）并在该分组内重新排序
            if (this.kanbanMode === 'custom') {
                // ... (existing code for custom mode) ... 
                const draggedGroup = draggedTaskInDb.customGroupId === undefined ? null : draggedTaskInDb.customGroupId;

                // CRITICAL FIX: Use the customGroupId from the targetTask parameter (which was extracted from DOM)
                // instead of from the database, because the DOM reflects the actual drop location
                const actualTargetGroup = targetTask.customGroupId === undefined ? null : targetTask.customGroupId;

                // 1. Update Group if different
                if (draggedGroup !== actualTargetGroup) {
                    if (actualTargetGroup === null) {
                        delete reminderData[draggedId].customGroupId;
                    } else {
                        reminderData[draggedId].customGroupId = actualTargetGroup;
                    }
                }

                // 2. Update Status if different
                if (oldStatus !== newStatus) {
                    if (newStatus === 'completed') {
                        draggedTaskInDb.completed = true;
                        draggedTaskInDb.completedTime = getLocalDateTimeString(new Date());
                    } else {
                        draggedTaskInDb.completed = false;
                        delete draggedTaskInDb.completedTime;

                        // Update kanbanStatus based on newStatus
                        if (newStatus === 'long_term' || newStatus === 'short_term') {
                            draggedTaskInDb.kanbanStatus = newStatus;
                        } else if (newStatus === 'doing') {
                            draggedTaskInDb.kanbanStatus = 'doing';
                        }
                    }
                }

                // ... (priority update and sorting logic for custom mode) ...
                const oldPriority = draggedTaskInDb.priority || 'none';
                const targetPriority = targetTaskInDb.priority || 'none';
                let newPriority = oldPriority;

                if (oldPriority !== targetPriority) {
                    newPriority = targetPriority;
                    draggedTaskInDb.priority = newPriority;
                }

                let sourceList: any[] = [];
                // Source list cleanup - filter by BOTH group AND status
                if (draggedGroup !== actualTargetGroup || oldStatus !== newStatus || oldPriority !== newPriority) {
                    sourceList = Object.values(reminderData)
                        .filter((r: any) => r && r.projectId === this.projectId && !r.parentId)
                        .filter((r: any) => {
                            const rGroup = (r.customGroupId === undefined) ? null : r.customGroupId;
                            return rGroup === draggedGroup;
                        })
                        .filter((r: any) => {
                            // Filter by status as well
                            const rStatus = this.getTaskStatus(r);
                            return rStatus === oldStatus;
                        })
                        .filter((r: any) => r.id !== draggedId) // Exclude the dragged task
                        .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                    sourceList.forEach((t: any, index: number) => {
                        reminderData[t.id].sort = index * 10;
                    });
                    // update local cache for source list
                    sourceList.forEach((task: any) => {
                        const localTask = this.tasks.find(t => t.id === task.id);
                        if (localTask) localTask.sort = task.sort;
                    });
                }

                // Target list update - filter by BOTH group AND status
                const targetList = Object.values(reminderData)
                    .filter((r: any) => r && r.projectId === this.projectId && !r.parentId)
                    .filter((r: any) => {
                        const rGroup = (r.customGroupId === undefined) ? null : r.customGroupId;
                        return rGroup === actualTargetGroup;  // Use actualTargetGroup here too!
                    })
                    .filter((r: any) => {
                        // Filter by status as well (using the NEW status after update)
                        const rStatus = this.getTaskStatus(r);
                        return rStatus === newStatus;
                    })
                    .filter((r: any) => r.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                const targetIndex = targetList.findIndex((t: any) => t.id === targetId);
                const insertIndex = insertBefore ? targetIndex : (targetIndex === -1 ? targetList.length : targetIndex + 1);

                targetList.splice(insertIndex, 0, reminderData[draggedId]);

                targetList.forEach((task: any, index: number) => {
                    reminderData[task.id].sort = index * 10;
                });

                await saveReminders(this.plugin, reminderData);

                // Update local cache for ALL tasks involved (to keep status/priority/sort in sync)
                [...sourceList, ...targetList].forEach((task: any) => {
                    const localTask = this.tasks.find(t => t.id === task.id);
                    if (localTask) {
                        localTask.sort = task.sort;
                        localTask.priority = task.priority;
                        localTask.kanbanStatus = task.kanbanStatus;
                        localTask.customGroupId = task.customGroupId;
                        localTask.completed = task.completed;
                        localTask.completedTime = task.completedTime;
                    }
                });

                // Optimistic DOM update
                const domUpdated = this.reorderTasksDOM(draggedId, targetId, insertBefore);

                // Refresh the dragged task's visual appearance to reflect changes in priority/status
                if (domUpdated) {
                    this.refreshTaskElement(draggedId);
                } else {
                    await this.queueLoadTasks();
                }

                this.dispatchReminderUpdate(true);
                return;
            }

            // --- Fallback (Status Mode) Logic ---

            // 0. Update Custom Group if different (Enhanced Fallback)
            const draggedGroup = draggedTaskInDb.customGroupId === undefined ? null : draggedTaskInDb.customGroupId;
            const targetGroup = targetTaskInDb.customGroupId === undefined ? null : targetTaskInDb.customGroupId;
            if (draggedGroup !== targetGroup) {
                if (targetGroup === null) {
                    delete reminderData[draggedId].customGroupId;
                } else {
                    reminderData[draggedId].customGroupId = targetGroup;
                }
            }

            // ... (subtask check logic unchanged) ...
            const isSubtaskReorder = draggedTaskInDb.parentId && targetTaskInDb.parentId &&
                draggedTaskInDb.parentId === targetTaskInDb.parentId;

            if (isSubtaskReorder) {
                // ... (subtask existing logic) ...
                const parentId = draggedTaskInDb.parentId;
                const siblingTasks = Object.values(reminderData)
                    .filter((r: any) => r && r.parentId === parentId && r.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                const targetIndex = siblingTasks.findIndex((t: any) => t.id === targetId);
                const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

                siblingTasks.splice(insertIndex, 0, draggedTaskInDb);
                siblingTasks.forEach((task: any, index: number) => {
                    reminderData[task.id].sort = index * 10;
                });
                await saveReminders(this.plugin, reminderData);
                siblingTasks.forEach((task: any) => {
                    const localTask = this.tasks.find(t => t.id === task.id);
                    if (localTask) localTask.sort = task.sort;
                });
                const domUpdated = this.reorderTasksDOM(draggedId, targetId, insertBefore);
                if (!domUpdated) await this.queueLoadTasks();
                this.dispatchReminderUpdate(true);
                return;
            }

            // ... (top level logic) ...
            const oldPriority = draggedTaskInDb.priority || 'none';
            const targetPriority = targetTaskInDb.priority || 'none';
            let newPriority = oldPriority;

            if (oldPriority !== targetPriority) {
                newPriority = targetPriority;
                draggedTaskInDb.priority = newPriority;
            }

            // --- Update status of dragged task (Enhanced) ---
            if (oldStatus !== newStatus) {
                if (newStatus === 'completed') {
                    draggedTaskInDb.completed = true;
                    draggedTaskInDb.completedTime = getLocalDateTimeString(new Date());
                } else {
                    draggedTaskInDb.completed = false;
                    delete draggedTaskInDb.completedTime;

                    // Update kanbanStatus based on newStatus
                    if (newStatus === 'long_term' || newStatus === 'short_term') {
                        draggedTaskInDb.kanbanStatus = newStatus;
                    } else if (newStatus === 'doing') {
                        draggedTaskInDb.kanbanStatus = 'doing';
                    }
                }
            }

            let sourceList: any[] = [];
            // --- Reorder source list ---
            if (oldStatus !== newStatus || oldPriority !== newPriority) {
                sourceList = Object.values(reminderData)
                    .filter((r: any) => r && r.projectId === this.projectId && !r.parentId && this.getTaskStatus(r) === oldStatus && (r.priority || 'none') === oldPriority && r.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                sourceList.forEach((task: any, index: number) => {
                    reminderData[task.id].sort = index * 10;
                });
                // update local cache for source
                sourceList.forEach((task: any) => {
                    const localTask = this.tasks.find(t => t.id === task.id);
                    if (localTask) localTask.sort = task.sort;
                });
            }

            // --- Reorder target list ---
            const targetList = Object.values(reminderData)
                .filter((r: any) => r && r.projectId === this.projectId && !r.parentId && this.getTaskStatus(r) === newStatus && (r.priority || 'none') === newPriority && r.id !== draggedId)
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            const targetIndex = targetList.findIndex((t: any) => t.id === targetId);
            const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

            targetList.splice(insertIndex, 0, draggedTaskInDb);
            targetList.forEach((task: any, index: number) => {
                reminderData[task.id].sort = index * 10;
            });
            await saveReminders(this.plugin, reminderData);

            // Update local cache for ALL tasks involved
            [...sourceList, ...targetList].forEach((task: any) => {
                const localTask = this.tasks.find(t => t.id === task.id);
                if (localTask) {
                    localTask.sort = task.sort;
                    localTask.priority = task.priority;
                    localTask.kanbanStatus = task.kanbanStatus;
                    localTask.customGroupId = task.customGroupId;
                    localTask.completed = task.completed;
                    localTask.completedTime = task.completedTime;
                }
            });

            // 尝试直接更新DOM,失败时才重新加载
            const domUpdated = this.reorderTasksDOM(draggedId, targetId, insertBefore);
            if (domUpdated) {
                // Refresh the dragged task's visual appearance
                this.refreshTaskElement(draggedId);
            } else {
                await this.queueLoadTasks();
            }

            this.dispatchReminderUpdate(true);

        } catch (error) {
            console.error('重新排序任务失败:', error);
            throw error;
        }
    }

    /**
     * 递归收集指定父任务的所有直接子任务和后代，保持原有的任务顺序。
     * 返回一个按层级组织的节点数组，节点包含 task 对象和 level。
     */
    private collectChildrenRecursively(parentId: string): Array<{ task: any; level: number }> {
        const result: Array<{ task: any; level: number }> = [];

        const children = this.tasks.filter(t => t.parentId === parentId);

        const walk = (items: any[], level: number) => {
            for (const it of items) {
                result.push({ task: it, level });
                const sub = this.tasks.filter(t => t.parentId === it.id);
                if (sub && sub.length > 0) {
                    walk(sub, level + 1);
                }
            }
        };

        walk(children, 0);
        return result;
    }

    /**
     * 编辑周期任务的单个实例
     */
    private async editInstanceReminder(task: any) {
        try {
            const reminderData = await this.getReminders();
            const originalReminder = reminderData[task.originalId];

            if (!originalReminder) {
                showMessage("原始周期事件不存在");
                return;
            }

            // 从 instanceId (格式: originalId_YYYY-MM-DD) 中提取原始生成日期
            const originalInstanceDate = task.id ? task.id.split('_').pop() : task.date;

            // 检查实例级别的修改（包括备注）
            const instanceModifications = originalReminder.repeat?.instanceModifications || {};
            const instanceMod = instanceModifications[originalInstanceDate];

            // 创建实例数据，包含当前实例的特定信息
            const instanceData = {
                ...originalReminder,
                id: task.id,
                date: task.date,
                endDate: task.endDate,
                time: task.time,
                endTime: task.endTime,
                note: instanceMod?.note || originalReminder.note || '',  // 复用原始事件备注，实例修改优先
                isInstance: true,
                originalId: task.originalId,
                instanceDate: originalInstanceDate  // 使用原始生成日期而非当前显示日期
            };

            // 优化：只通过 reminderUpdated 事件触发刷新，避免重复更新
            // 事件监听器会调用 queueLoadTasks() 进行防抖刷新
            const callback = () => {
                this.dispatchReminderUpdate(true);
            };

            const editDialog = new QuickReminderDialog(
                undefined,
                undefined,
                callback,
                undefined,
                {
                    mode: 'edit',
                    reminder: instanceData,
                    plugin: this.plugin,
                    isInstanceEdit: true
                }
            );
            editDialog.show();
        } catch (error) {
            console.error('打开实例编辑对话框失败:', error);
            showMessage("打开编辑对话框失败");
        }
    }

    /**
     * 删除周期任务的单个实例
     */
    private async deleteInstanceOnly(task: any) {
        await confirm(
            i18n('deleteThisInstance'),
            i18n('confirmDeleteInstanceOf', { title: task.title, date: task.date }),
            async () => {
                // --- Optimistic UI Update ---
                try {
                    const el = this.container.querySelector(`[data-task-id="${task.id}"]`);
                    if (el) el.remove();
                    this.tasks = this.tasks.filter(t => t.id !== task.id);
                } catch (e) {
                    console.error("Optimistic UI update failed (instance):", e);
                }
                // -----------------------------

                try {
                    const originalId = task.originalId;
                    const instanceDate = task.date;

                    await this.addExcludedDate(originalId, instanceDate);

                    // 如果该实例绑定了块或文档，更新块属性（忽略错误）
                    if (task.blockId || task.docId) {
                        try {
                            await updateBindBlockAtrrs(task.blockId || task.docId, this.plugin);
                        } catch (err) {
                            console.warn('更新已删除实例的块书签失败:', err);
                        }
                    }

                    showMessage("实例已删除");
                    await this.queueLoadTasks();
                    this.dispatchReminderUpdate(true);
                } catch (error) {
                    console.error('删除周期实例失败:', error);
                    showMessage("删除实例失败");
                    await this.queueLoadTasks();
                }
            }
        );
    }

    /**
     * 为原始周期事件添加排除日期
     */
    private async addExcludedDate(originalId: string, excludeDate: string) {
        try {
            const reminderData = await this.getReminders();

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

                await saveReminders(this.plugin, reminderData);
            } else {
                throw new Error('原始事件不存在');
            }
        } catch (error) {
            console.error('添加排除日期失败:', error);
            throw error;
        }
    }

    /**
     * 智能生成重复任务实例，确保至少能找到下一个未来实例
     * @param reminder 提醒任务对象
     * @param today 今天的日期字符串
     * @param isLunarRepeat 是否是农历重复
     * @returns 生成的实例数组
     */
    private generateInstancesWithFutureGuarantee(reminder: any, today: string, isLunarRepeat: boolean): any[] {
        // 根据重复类型确定初始范围
        let monthsToAdd = 2; // 默认范围

        if (isLunarRepeat) {
            monthsToAdd = 14; // 农历重复需要更长范围
        } else if (reminder.repeat.type === 'yearly') {
            monthsToAdd = 14; // 年度重复初始范围为14个月
        } else if (reminder.repeat.type === 'monthly') {
            monthsToAdd = 3; // 月度重复使用3个月
        }

        let repeatInstances: any[] = [];
        let hasUncompletedFutureInstance = false;
        const maxAttempts = 5; // 最多尝试5次扩展
        let attempts = 0;

        // 获取已完成实例列表
        const completedInstances = reminder.repeat?.completedInstances || [];

        while (!hasUncompletedFutureInstance && attempts < maxAttempts) {
            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setMonth(monthStart.getMonth() - 1);

            const monthEnd = new Date();
            monthEnd.setMonth(monthEnd.getMonth() + monthsToAdd);
            monthEnd.setDate(0);

            const startDate = getLocalDateString(monthStart);
            const endDate = getLocalDateString(monthEnd);

            // 生成实例，使用足够大的 maxInstances 以确保生成所有实例
            const maxInstances = monthsToAdd * 50; // 根据范围动态调整
            repeatInstances = generateRepeatInstances(reminder, startDate, endDate, maxInstances);

            // 检查是否有未完成的未来实例（关键修复：不仅要是未来的，还要是未完成的）
            hasUncompletedFutureInstance = repeatInstances.some(instance => {
                const instanceIdStr = (instance as any).instanceId || `${reminder.id}_${instance.date}`;
                const originalKey = instanceIdStr.split('_').pop() || instance.date;
                const instanceLogical = this.getTaskLogicalDate(instance.date, instance.time);
                return compareDateStrings(instanceLogical, today) > 0 && !completedInstances.includes(originalKey);
            });

            if (!hasUncompletedFutureInstance) {
                // 如果没有找到未完成的未来实例，扩展范围
                if (reminder.repeat.type === 'yearly') {
                    monthsToAdd += 12; // 年度重复每次增加12个月
                } else if (isLunarRepeat) {
                    monthsToAdd += 12; // 农历重复每次增加12个月
                } else {
                    monthsToAdd += 6; // 其他类型每次增加6个月
                }
                attempts++;
            }
        }

        return repeatInstances;
    }

    /**
     * 根据父任务ID生成多级 Markdown 列表文本数组，每行为一行 Markdown。
     * 对于绑定块的任务，使用 siyuan://blocks/<id> 格式的链接。
     */
    private buildMarkdownListFromChildren(parentId: string): string[] {
        const nodes = this.collectChildrenRecursively(parentId);
        if (!nodes || nodes.length === 0) return [];

        const lines: string[] = [];
        for (const node of nodes) {
            const indent = '  '.repeat(node.level);
            const t = node.task;
            let title = t.title || '未命名任务';
            if (t.blockId || t.docId) {
                // 使用思源块链接
                const targetId = t.blockId || t.docId;
                title = `[${title}](siyuan://blocks/${targetId})`;
            }
            lines.push(`${indent}- ${title}`);
        }
        return lines;
    }

    /**
     * 为分组项添加拖拽排序功能
     */
    private addGroupDragAndDrop(groupItem: HTMLElement, group: any, container: HTMLElement) {
        // 使用和 CategoryManageDialog 一致的拖拽处理模式：通过类名指示上/下插入位置
        groupItem.draggable = true;

        groupItem.addEventListener('dragstart', (e) => {
            this.draggedGroupId = group.id;
            groupItem.classList.add('dragging');

            // 创建可作为拖拽预览的克隆元素并放置到 body，用作 setDragImage
            try {
                const clone = groupItem.cloneNode(true) as HTMLElement;
                clone.style.position = 'absolute';
                clone.style.top = '-9999px';
                clone.style.left = '-9999px';
                clone.style.width = `${groupItem.getBoundingClientRect().width}px`;
                clone.style.boxShadow = '0 6px 20px rgba(0,0,0,0.2)';
                document.body.appendChild(clone);
                this._groupDragImageEl = clone;

                if (e.dataTransfer) {
                    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', group.id); e.dataTransfer.setDragImage(clone, 10, 10); } catch (err) { }
                }
            } catch (err) {
                // ignore
            }
        });

        groupItem.addEventListener('dragend', () => {
            groupItem.classList.remove('dragging');
            this.draggedGroupId = null;

            // 清理所有项的拖拽相关样式
            container.querySelectorAll('.group-item').forEach((el) => {
                el.classList.remove('drag-over-top', 'drag-over-bottom');
            });

            // 清理 drag image clone
            if (this._groupDragImageEl && this._groupDragImageEl.parentNode) {
                this._groupDragImageEl.parentNode.removeChild(this._groupDragImageEl);
            }
            this._groupDragImageEl = null;

            // 清理容器级指示器
            if (this._groupDropIndicator && this._groupDropIndicator.parentNode) {
                this._groupDropIndicator.parentNode.removeChild(this._groupDropIndicator);
            }
            this._groupDropIndicator = null;
        });

        groupItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } catch (err) { }

            // 使用容器级绝对定位的指示器来显示插入位置（跨项一致）
            if (this.draggedGroupId && this.draggedGroupId !== group.id) {
                const rect = groupItem.getBoundingClientRect();
                const mouseY = (e as DragEvent).clientY;
                const insertTop = mouseY < rect.top + rect.height / 2;

                // 创建或更新指示器
                if (!this._groupDropIndicator) {
                    const ind = document.createElement('div');
                    ind.className = 'group-drop-indicator';
                    ind.style.position = 'absolute';
                    ind.style.height = '3px';
                    ind.style.backgroundColor = 'var(--b3-theme-primary)';
                    ind.style.boxShadow = '0 0 8px var(--b3-theme-primary)';
                    ind.style.zIndex = '2000';
                    ind.style.pointerEvents = 'none';
                    container.appendChild(ind);
                    this._groupDropIndicator = ind;
                }

                const indicator = this._groupDropIndicator!;
                // 计算指示器相对于 container 的位置
                const containerRect = container.getBoundingClientRect();
                if (insertTop) {
                    indicator.style.width = `${rect.width}px`;
                    indicator.style.left = `${rect.left - containerRect.left}px`;
                    indicator.style.top = `${rect.top - containerRect.top - 2}px`;
                } else {
                    indicator.style.width = `${rect.width}px`;
                    indicator.style.left = `${rect.left - containerRect.left}px`;
                    indicator.style.top = `${rect.bottom - containerRect.top}px`;
                }
            }
        });

        groupItem.addEventListener('dragleave', (e) => {
            // 仅当鼠标真正离开元素时才清除样式
            const rect = groupItem.getBoundingClientRect();
            const x = (e as DragEvent).clientX;
            const y = (e as DragEvent).clientY;
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                groupItem.classList.remove('drag-over-top', 'drag-over-bottom');
            }
        });

        groupItem.addEventListener('drop', async (e) => {
            e.preventDefault();
            groupItem.classList.remove('drag-over-top', 'drag-over-bottom');

            // 支持 dataTransfer 或 class 字段回退
            let draggedId = (e as DragEvent).dataTransfer?.getData('text/plain') || this.draggedGroupId;
            if (!draggedId || draggedId === group.id) return;

            try {
                const { ProjectManager } = await import('../utils/projectManager');
                const projectManager = ProjectManager.getInstance(this.plugin);
                const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                const draggedIndex = currentGroups.findIndex((g: any) => g.id === draggedId);
                const targetIndex = currentGroups.findIndex((g: any) => g.id === group.id);
                if (draggedIndex === -1 || targetIndex === -1) return;

                const rect = groupItem.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                const insertBefore = (e as DragEvent).clientY < midPoint;

                const draggedGroup = currentGroups.splice(draggedIndex, 1)[0];
                const actualTargetIndex = insertBefore ? targetIndex : targetIndex + 1;
                currentGroups.splice(actualTargetIndex, 0, draggedGroup);

                // 重新分配 sort 并保存
                currentGroups.forEach((g: any, index: number) => { g.sort = index * 10; });
                await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                // 清理绝对定位的插入指示器（如存在）
                if (this._groupDropIndicator && this._groupDropIndicator.parentNode) {
                    this._groupDropIndicator.parentNode.removeChild(this._groupDropIndicator);
                }
                this._groupDropIndicator = null;

                // 刷新 UI（使用防抖队列）
                await this.loadAndDisplayGroups(container);
                this.queueLoadTasks();
                showMessage('分组顺序已更新');
            } catch (error) {
                console.error('更新分组顺序失败:', error);
                showMessage('更新分组顺序失败');
            }
        });
    }

    /**
     * 触发reminderUpdated事件，带源标识
     * @param skipSelfUpdate 是否跳过自己的更新（默认true）
     */
    private dispatchReminderUpdate(skipSelfUpdate: boolean = true) {
        window.dispatchEvent(new CustomEvent('reminderUpdated', {
            detail: {
                source: skipSelfUpdate ? this.kanbanInstanceId : null,
                projectId: this.projectId
            }
        }));
    }



    /**
     * 更新任务DOM元素
     * @param taskId 任务ID
     * @param updates 更新的字段
     */
    private updateTaskElementDOM(taskId: string, updates: Partial<any>) {
        const taskEl = this.container.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement;
        if (!taskEl) {
            // 如果找不到DOM元素，可能需要重新渲染
            console.warn('找不到任务DOM元素，将重新渲染看板:', taskId);
            this.queueLoadTasks();
            return;
        }

        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        // 根据更新内容选择性更新 DOM
        if ('title' in updates) {
            const titleEl = taskEl.querySelector('.kanban-task-title');
            if (titleEl) {
                // 保留子任务数量指示器
                const subtaskIndicator = titleEl.querySelector('.subtask-indicator');
                titleEl.textContent = task.title || i18n('noContentHint');
                if (subtaskIndicator) {
                    titleEl.appendChild(subtaskIndicator);
                }
            }
        }

        if ('completed' in updates) {
            const checkbox = taskEl.querySelector('.kanban-task-checkbox') as HTMLInputElement;
            if (checkbox) checkbox.checked = task.completed;
            taskEl.style.opacity = task.completed ? '0.5' : '1';

            // 更新完成时间显示
            const infoEl = taskEl.querySelector('.kanban-task-info') as HTMLElement;
            if (infoEl) {
                let completedTimeEl = infoEl.querySelector('.kanban-task-completed-time') as HTMLElement;
                if (task.completed && task.completedTime) {
                    if (!completedTimeEl) {
                        completedTimeEl = document.createElement('div');
                        completedTimeEl.className = 'kanban-task-completed-time';
                        completedTimeEl.style.cssText = `
                            font-size: 12px;
                            color: var(--b3-theme-on-surface);
                            opacity: 0.7;
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            margin-bottom: 4px;
                        `;
                        infoEl.insertBefore(completedTimeEl, infoEl.firstChild);
                    }
                    completedTimeEl.innerHTML = `<span>✅</span><span>完成于: ${getLocalDateTimeString(new Date(task.completedTime))}</span>`;
                } else if (completedTimeEl) {
                    completedTimeEl.remove();
                }
            }
        }

        if ('priority' in updates) {
            // 移除旧的优先级类
            taskEl.className = taskEl.className.replace(/kanban-task-priority-\w+/g, '');
            if (task.priority && task.priority !== 'none') {
                taskEl.classList.add(`kanban-task-priority-${task.priority}`);
            }

            // 更新优先级背景色和边框
            let backgroundColor = '';
            let borderColor = '';
            switch (task.priority) {
                case 'high':
                    backgroundColor = 'rgba(from var(--b3-card-error-background) r g b / .5)';
                    borderColor = 'var(--b3-card-error-color)';
                    break;
                case 'medium':
                    backgroundColor = 'rgba(from var(--b3-card-warning-background) r g b / .5)';
                    borderColor = 'var(--b3-card-warning-color)';
                    break;
                case 'low':
                    backgroundColor = 'rgba(from var(--b3-card-info-background) r g b / .7)';
                    borderColor = 'var(--b3-card-info-color)';
                    break;
                default:
                    backgroundColor = 'rgba(from var(--b3-theme-background-light) r g b / .1)';
                    borderColor = 'var(--b3-theme-background-light)';
            }
            taskEl.style.backgroundColor = backgroundColor;
            taskEl.style.borderColor = borderColor;
        }

        // 如果状态改变，智能移动任务卡片到新列
        if ('kanbanStatus' in updates || 'completed' in updates || 'date' in updates) {
            const newStatus = this.getTaskStatus(task);
            // 尝试从最近的带 data-status 的祖先元素获取当前状态，兼容自定义分组模式下的子状态容器
            const statusAncestor = taskEl.closest('[data-status]') as HTMLElement | null;
            const currentStatus = statusAncestor?.dataset.status || null;

            if (currentStatus !== newStatus) {
                // 尝试智能移动任务卡片
                const moved = this.moveTaskCardToColumn(taskEl, currentStatus, newStatus);
                if (!moved) {
                    // 如果移动失败，才重新渲染
                    this.queueLoadTasks();
                }
            }
        }
    }

    /**
     * 智能移动任务卡片到新列
     * @param taskEl 任务DOM元素
     * @param fromStatus 原状态
     * @param toStatus 目标状态
     * @returns 是否成功移动
     */
    private moveTaskCardToColumn(taskEl: HTMLElement, fromStatus: string | null | undefined, toStatus: string): boolean {
        try {
            let targetContent: HTMLElement | null = null;
            let targetColumn: HTMLElement | null = null;
            const targetStatus = (toStatus === 'done' || toStatus === 'completed') ? 'completed' : toStatus;

            if (this.kanbanMode === 'custom') {
                // 自定义分组模式：在当前分组内移动到对应的状态子分组 (使用 completed)
                const groupColumn = taskEl.closest('.kanban-column') as HTMLElement;
                if (!groupColumn) {
                    console.warn('找不到任务所属的分组列');
                    return false;
                }

                targetColumn = groupColumn.querySelector(`.custom-status-${targetStatus}`) as HTMLElement;
                if (!targetColumn) {
                    console.warn('找不到目标状态分组:', targetStatus);
                    return false;
                }
                targetContent = targetColumn.querySelector('.custom-status-group-tasks') as HTMLElement;
            } else {
                // 状态模式：使用 completed

                targetColumn = this.container.querySelector(`.kanban-column-${targetStatus}`) as HTMLElement;
                if (!targetColumn) {
                    console.warn('找不到目标列:', targetStatus);
                    return false;
                }

                // 状态模式下，如果启用了自定义分组，需要找到具体的子容器
                const statusGroupTasks = targetColumn.querySelector(`.status-stable-group[data-status="${targetStatus}"] .status-stable-group-tasks`) as HTMLElement;
                if (statusGroupTasks) {
                    // 尝试根据任务的 groupId 找容器
                    const groupId = taskEl.dataset.groupId || (this.draggedTask?.customGroupId) || 'ungrouped';
                    const customGroupContainer = statusGroupTasks.querySelector(`.custom-group-in-status[data-group-id="${groupId}"] .custom-group-tasks`) as HTMLElement;

                    if (customGroupContainer) {
                        targetContent = customGroupContainer;
                    } else {
                        // 如果没找到具体的自定义分组容器（可能该组在目标列当前为空），
                        // 返回 false 以触发 queueLoadTasks 进行全量重新渲染，确保生成正确的分组结构
                        return false;
                    }
                } else {
                    targetContent = targetColumn.querySelector('.kanban-column-content') as HTMLElement;
                }
            }

            if (!targetContent) {
                console.warn('找不到目标内容区域');
                return false;
            }

            // 移除当前位置的任务卡片
            taskEl.remove();

            // 插入到目标容器 (已完成状态按时间倒序排列)
            if (targetStatus === 'completed') {
                const existingTasks = Array.from(targetContent.querySelectorAll('.kanban-task')) as HTMLElement[];
                const currentTask = this.tasks.find(t => t.id === taskEl.dataset.taskId);

                const insertBeforeTask = existingTasks.find(el => {
                    const elId = el.dataset.taskId;
                    const elTask = this.tasks.find(t => t.id === elId);
                    if (!elTask || !elTask.completed || !elTask.completedTime) return false;
                    if (!currentTask || !currentTask.completedTime) return false;

                    const timeCurrent = new Date(currentTask.completedTime).getTime();
                    const timeEl = new Date(elTask.completedTime).getTime();
                    return timeCurrent > timeEl; // 倒序：新的在前
                });

                if (insertBeforeTask) {
                    targetContent.insertBefore(taskEl, insertBeforeTask);
                } else {
                    targetContent.appendChild(taskEl);
                }
            } else {
                targetContent.appendChild(taskEl);
            }

            // 更新列的任务计数
            if (this.kanbanMode === 'custom') {
                try {
                    // 在自定义分组模式下，更新具体分组下的子状态计数（如果存在）
                    const sourceGroupColumn = (taskEl as HTMLElement).closest('.kanban-column') as HTMLElement | null;
                    const targetGroupColumn = (targetContent as HTMLElement).closest('.kanban-column') as HTMLElement | null;

                    const adjustCount = (col: HTMLElement | null, statusKey: string, delta: number) => {
                        if (!col) return;
                        const countEl = col.querySelector(`.custom-status-${statusKey} .custom-status-group-count`) as HTMLElement | null;
                        if (countEl) {
                            const cur = parseInt(countEl.textContent || '0', 10);
                            countEl.textContent = Math.max(0, cur + delta).toString();
                        } else {
                            // fallback: 更新列顶部计数
                            const topCountEl = col.querySelector('.kanban-column-count') as HTMLElement | null;
                            if (topCountEl) {
                                const cur = parseInt(topCountEl.textContent || '0', 10);
                                topCountEl.textContent = Math.max(0, cur + delta).toString();
                            }
                        }
                    };

                    if (fromStatus) adjustCount(sourceGroupColumn, fromStatus, -1);
                    adjustCount(targetGroupColumn, toStatus, 1);
                } catch (e) {
                    // 如果出错，回退到通用的列计数更新
                    if (fromStatus) this.updateColumnCount(fromStatus, -1);
                    this.updateColumnCount(toStatus, 1);
                }
            } else {
                if (fromStatus) {
                    this.updateColumnCount(fromStatus, -1);
                }
                this.updateColumnCount(toStatus, 1);
            }

            return true;
        } catch (error) {
            console.error('移动任务卡片失败:', error);
            return false;
        }
    }

    /**
     * 更新列的任务计数
     * @param status 列状态
     * @param delta 变化量
     */
    private updateColumnCount(status: string, delta: number) {
        try {
            const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
            if (!column) return;

            const countEl = column.querySelector('.kanban-column-count') as HTMLElement;
            if (!countEl) return;

            const currentCount = parseInt(countEl.textContent || '0', 10);
            const newCount = Math.max(0, currentCount + delta);
            countEl.textContent = newCount.toString();
        } catch (error) {
            console.error('更新列计数失败:', error);
        }
    }

    /**
     * 刷新单个任务元素的显示（不重绘整列）
     * @param taskId 任务ID
     */
    private refreshTaskElement(taskId: string) {
        try {
            const oldEl = this.container.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement;
            if (!oldEl) return;

            const task = this.tasks.find(t => t.id === taskId);
            if (!task) return;

            const level = parseInt(oldEl.dataset.level || '0', 10);
            const newEl = this.createTaskElement(task, level);

            oldEl.replaceWith(newEl);
        } catch (error) {
            console.error('刷新任务元素失败:', error);
        }
    }

    /**
     * 拖拽排序后直接更新DOM,避免重新加载
     * @param draggedTaskId 被拖拽的任务ID
     * @param targetTaskId 目标任务ID
     * @param insertBefore 是否插入到目标任务之前
     * @returns 是否成功更新DOM
     */
    private reorderTasksDOM(draggedTaskId: string, targetTaskId: string, insertBefore: boolean): boolean {
        try {
            // 1. 找到被拖拽的任务元素
            const draggedEl = this.container.querySelector(`[data-task-id="${draggedTaskId}"]`) as HTMLElement;
            if (!draggedEl) {
                console.warn('找不到被拖拽的任务元素:', draggedTaskId);
                return false;
            }

            // 2. 找到目标任务元素
            const targetEl = this.container.querySelector(`[data-task-id="${targetTaskId}"]`) as HTMLElement;
            if (!targetEl) {
                console.warn('找不到目标任务元素:', targetTaskId);
                return false;
            }

            // 3. 获取父容器
            const parentContainer = targetEl.parentElement;
            if (!parentContainer) {
                console.warn('找不到父容器');
                return false;
            }

            // 4. 移除被拖拽的元素
            draggedEl.remove();

            // 5. 插入到正确位置
            if (insertBefore) {
                parentContainer.insertBefore(draggedEl, targetEl);
            } else {
                // 插入到目标元素之后
                const nextSibling = targetEl.nextSibling;
                if (nextSibling) {
                    parentContainer.insertBefore(draggedEl, nextSibling);
                } else {
                    parentContainer.appendChild(draggedEl);
                }
            }

            return true;
        } catch (error) {
            console.error('DOM重排失败:', error);
            return false;
        }
    }

    // ==================== 批量多选功能 ====================



    /**
     * 批量保存任务
     */
    private async saveTasks(tasks: any[]): Promise<void> {
        try {
            let reminderData = await this.getReminders();

            for (const task of tasks) {
                reminderData[task.id] = {
                    ...reminderData[task.id],
                    ...task,
                    projectId: this.projectId,
                    updatedAt: new Date().toISOString()
                };
            }

            await saveReminders(this.plugin, reminderData);

            // 触发更新事件
            this.dispatchReminderUpdate(true);
        } catch (error) {
            console.error('批量保存任务失败:', error);
            throw error;
        }
    }

    /**
     * 切换多选模式
     */
    private toggleMultiSelectMode(): void {
        this.isMultiSelectMode = !this.isMultiSelectMode;

        if (!this.isMultiSelectMode) {
            // 退出多选模式时清空选择
            this.selectedTaskIds.clear();
            this.hideBatchToolbar();
        }

        // 更新多选按钮状态
        const multiSelectBtn = this.container.querySelector('#multiSelectBtn') as HTMLButtonElement;
        if (multiSelectBtn) {
            if (this.isMultiSelectMode) {
                multiSelectBtn.classList.add('b3-button--primary');
                multiSelectBtn.classList.remove('b3-button--outline');
                multiSelectBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg> ${i18n('exitBatchSelect') || '退出选择'}`;
            } else {
                multiSelectBtn.classList.remove('b3-button--primary');
                multiSelectBtn.classList.add('b3-button--outline');
                multiSelectBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconCheck"></use></svg> ${i18n('batchSelect') || '批量选择'}`;
            }
        }

        // 重新渲染看板以显示/隐藏多选复选框
        this.renderKanban();

        // 无论是否选中任务，只要开启多选模式就显示工具栏
        this.updateBatchToolbar();

        showMessage(this.isMultiSelectMode ? (i18n('batchSelectModeOn') || '已进入批量选择模式') : (i18n('batchSelectModeOff') || '已退出批量选择模式'));
    }

    /**
     * 切换任务选中状态
     */
    private toggleTaskSelection(taskId: string, selected: boolean): void {
        if (selected) {
            this.selectedTaskIds.add(taskId);
        } else {
            this.selectedTaskIds.delete(taskId);
        }

        // 更新任务卡片样式
        const taskEl = this.container.querySelector(`.kanban-task[data-task-id="${taskId}"]`) as HTMLElement;
        if (taskEl) {
            if (selected) {
                taskEl.classList.add('kanban-task-selected');
                taskEl.style.boxShadow = '0 0 0 2px var(--b3-theme-primary)';
            } else {
                taskEl.classList.remove('kanban-task-selected');
                taskEl.style.boxShadow = '';
            }
        }

        // 更新批量工具栏
        this.updateBatchToolbar();
    }

    /**
     * 显示/更新批量操作工具栏
     */
    private updateBatchToolbar(): void {
        const selectedCount = this.selectedTaskIds.size;

        if (!this.isMultiSelectMode) {
            this.hideBatchToolbar();
            return;
        }

        if (!this.batchToolbar) {
            this.createBatchToolbar();
        }

        // 更新计数显示
        const countEl = this.batchToolbar?.querySelector('.batch-toolbar-count') as HTMLElement;
        if (countEl) {
            countEl.textContent = `${selectedCount} ${i18n('tasksSelected') || '个任务已选择'}`;
        }

        // 更新操作按钮的禁用状态
        const actionButtons = this.batchToolbar?.querySelectorAll('.b3-button--small:not(.b3-button--text)');
        if (actionButtons) {
            actionButtons.forEach(btn => {
                const button = btn as HTMLButtonElement;
                if (selectedCount === 0) {
                    button.disabled = true;
                    button.style.opacity = '0.5';
                    button.style.cursor = 'not-allowed';
                } else {
                    button.disabled = false;
                    button.style.opacity = '1';
                    button.style.cursor = 'pointer';
                }
            });
        }
    }

    /**
     * 创建批量操作工具栏
     */
    private createBatchToolbar(): void {
        this.batchToolbar = document.createElement('div');
        this.batchToolbar.className = 'kanban-batch-toolbar';
        this.batchToolbar.style.cssText = `
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--b3-theme-background);
            border: 1px solid var(--b3-theme-border);
            border-radius: 8px;
            padding: 12px 20px;
            display: flex;
            align-items: center;
            gap: 16px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            z-index: 1000;
            min-width: 400px;
            max-width: 80vw;
        `;

        // 选择计数
        const countEl = document.createElement('span');
        countEl.className = 'batch-toolbar-count';
        countEl.style.cssText = `
            font-weight: 600;
            color: var(--b3-theme-primary);
            min-width: 100px;
        `;
        countEl.textContent = `0 ${i18n('tasksSelected') || '个任务已选择'}`;
        this.batchToolbar.appendChild(countEl);

        // 分隔线
        const divider = document.createElement('div');
        divider.style.cssText = `
            width: 1px;
            height: 24px;
            background: var(--b3-theme-border);
        `;
        this.batchToolbar.appendChild(divider);

        // 按钮组
        const buttonsGroup = document.createElement('div');
        buttonsGroup.style.cssText = `
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        `;

        // 设置日期按钮
        const setDateBtn = document.createElement('button');
        setDateBtn.className = 'b3-button b3-button--outline b3-button--small';
        setDateBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg> ${i18n('setDate') || '设置日期'}`;
        setDateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.batchSetDate();
        });
        buttonsGroup.appendChild(setDateBtn);

        // 设置状态按钮
        const setStatusBtn = document.createElement('button');
        setStatusBtn.className = 'b3-button b3-button--outline b3-button--small';
        setStatusBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg> ${i18n('setStatus') || '设置状态'}`;
        setStatusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.batchSetStatus();
        });
        buttonsGroup.appendChild(setStatusBtn);

        // 设置分组按钮
        const setGroupBtn = document.createElement('button');
        setGroupBtn.className = 'b3-button b3-button--outline b3-button--small';
        setGroupBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconFolder"></use></svg> ${i18n('setGroup') || '设置分组'}`;
        setGroupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.batchSetGroup();
        });
        buttonsGroup.appendChild(setGroupBtn);

        // 设置优先级按钮
        const setPriorityBtn = document.createElement('button');
        setPriorityBtn.className = 'b3-button b3-button--outline b3-button--small';
        setPriorityBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconOrderedList"></use></svg> ${i18n('setPriority') || '设置优先级'}`;
        setPriorityBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.batchSetPriority();
        });
        buttonsGroup.appendChild(setPriorityBtn);

        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'b3-button b3-button--outline b3-button--small';
        deleteBtn.style.color = 'var(--b3-card-error-color)';
        deleteBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg> ${i18n('delete') || '删除'}`;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.batchDelete();
        });
        buttonsGroup.appendChild(deleteBtn);

        this.batchToolbar.appendChild(buttonsGroup);

        // 右侧：全选和取消按钮
        const rightGroup = document.createElement('div');
        rightGroup.style.cssText = `
            display: flex;
            gap: 8px;
            margin-left: auto;
        `;

        // 全选按钮
        const selectAllBtn = document.createElement('button');
        selectAllBtn.className = 'b3-button b3-button--text b3-button--small';
        selectAllBtn.textContent = i18n('selectAll') || '全选';
        selectAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectAllTasks();
        });
        rightGroup.appendChild(selectAllBtn);

        // 全选未完成按钮
        const selectUnfinishedBtn = document.createElement('button');
        selectUnfinishedBtn.className = 'b3-button b3-button--text b3-button--small';
        selectUnfinishedBtn.textContent = i18n('selectAllUnfinished') || '全选未完成';
        selectUnfinishedBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectAllUnfinishedTasks();
        });
        rightGroup.appendChild(selectUnfinishedBtn);

        // 取消选择按钮
        const clearBtn = document.createElement('button');
        clearBtn.className = 'b3-button b3-button--text b3-button--small';
        clearBtn.textContent = i18n('clearSelection') || '取消选择';
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearSelection();
        });
        rightGroup.appendChild(clearBtn);

        this.batchToolbar.appendChild(rightGroup);

        // 添加到容器
        this.container.appendChild(this.batchToolbar);
    }

    /**
     * 隐藏批量操作工具栏
     */
    private hideBatchToolbar(): void {
        if (this.batchToolbar) {
            this.batchToolbar.remove();
            this.batchToolbar = null;
        }
    }

    /**
     * 选择所有任务
     */
    private selectAllTasks(): void {
        this.tasks.forEach(task => {
            this.selectedTaskIds.add(task.id);
        });
        this.renderKanban();
        this.updateBatchToolbar();
    }

    /**
     * 选择所有未完成的任务
     */
    private selectAllUnfinishedTasks(): void {
        this.selectedTaskIds.clear();
        this.tasks.forEach(task => {
            if (!task.completed) {
                this.selectedTaskIds.add(task.id);
            }
        });
        this.renderKanban();
        this.updateBatchToolbar();
    }

    /**
     * 清空选择
     */
    private clearSelection(): void {
        this.selectedTaskIds.clear();
        this.renderKanban();
        this.updateBatchToolbar();
    }

    /**
     * 批量设置日期
     */
    private async batchSetDate(): Promise<void> {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        // 创建日期选择对话框
        const dialog = new Dialog({
            title: i18n('batchSetDate') || '批量设置日期',
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('selectDate') || '选择日期'}</label>
                        <input type="date" id="batchDateInput" class="b3-text-field" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('clearDate') || '清空日期'}</label>
                        <input type="checkbox" id="clearDateCheck" style="margin-left: 8px;">
                        <span style="color: var(--b3-theme-on-surface-light); font-size: 12px;">${i18n('clearDateHint') || '勾选后将清空所选任务的日期'}</span>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="batchDateCancel">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="batchDateConfirm">${i18n('confirm')}</button>
                </div>
            `,
            width: '360px'
        });

        const dateInput = dialog.element.querySelector('#batchDateInput') as HTMLInputElement;
        const clearCheck = dialog.element.querySelector('#clearDateCheck') as HTMLInputElement;
        const cancelBtn = dialog.element.querySelector('#batchDateCancel') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#batchDateConfirm') as HTMLButtonElement;

        // 设置今天为默认日期
        dateInput.value = new Date().toISOString().split('T')[0];

        clearCheck.addEventListener('change', () => {
            dateInput.disabled = clearCheck.checked;
        });

        cancelBtn.addEventListener('click', () => dialog.destroy());

        confirmBtn.addEventListener('click', async () => {
            const clearDate = clearCheck.checked;
            const dateValue = dateInput.value;

            if (!clearDate && !dateValue) {
                showMessage(i18n('pleaseSelectDate') || '请选择日期');
                return;
            }

            dialog.destroy();

            try {
                let successCount = 0;
                const tasksToUpdate = [];

                for (const taskId of selectedIds) {
                    const task = this.tasks.find(t => t.id === taskId);
                    if (task) {
                        task.date = clearDate ? undefined : dateValue;
                        tasksToUpdate.push(task);
                        successCount++;
                    }
                }

                // 批量保存任务
                await this.saveTasks(tasksToUpdate);
                showMessage(i18n('batchUpdateSuccess', { count: String(successCount) }) || `成功更新 ${successCount} 个任务`);
                this.queueLoadTasks();
            } catch (error) {
                console.error('批量设置日期失败:', error);
                showMessage(i18n('batchUpdateFailed') || '批量更新失败');
            }
        });
    }

    /**
     * 批量设置状态
     */
    private async batchSetStatus(): Promise<void> {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        // 获取可用的状态列表（kanbanStatuses 已包含已完成状态）
        const statuses = this.kanbanStatuses.length > 0 ? this.kanbanStatuses : this.projectManager.getDefaultKanbanStatuses();

        const statusOptions = statuses.map(s =>
            `<option value="${s.id}">${s.icon ? s.icon + ' ' : ''}${s.name}</option>`
        ).join('');

        const dialog = new Dialog({
            title: i18n('batchSetStatus') || '批量设置状态',
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('selectStatus') || '选择状态'}</label>
                        <select id="batchStatusSelect" class="b3-select" style="width: 100%;">
                            ${statusOptions}
                        </select>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="batchStatusCancel">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="batchStatusConfirm">${i18n('confirm')}</button>
                </div>
            `,
            width: '320px'
        });

        const statusSelect = dialog.element.querySelector('#batchStatusSelect') as HTMLSelectElement;
        const cancelBtn = dialog.element.querySelector('#batchStatusCancel') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#batchStatusConfirm') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        confirmBtn.addEventListener('click', async () => {
            const newStatus = statusSelect.value;
            dialog.destroy();

            try {
                let successCount = 0;
                const tasksToUpdate = [];
                const blocksToUpdate = [];

                for (const taskId of selectedIds) {
                    const task = this.tasks.find(t => t.id === taskId);
                    if (task) {
                        const wasCompleted = task.completed;
                        // 修改状态
                        if (newStatus === 'completed') {
                            task.kanbanStatus = 'completed';
                            task.completed = true;
                            task.completedTime = getLocalDateTimeString(new Date());
                        } else if (newStatus === 'doing') {
                            task.completed = false;
                            task.completedTime = undefined;
                            task.kanbanStatus = 'doing';
                        } else {
                            // 其他状态（长期、短期、自定义状态）
                            task.completed = false;
                            task.completedTime = undefined;
                            task.kanbanStatus = newStatus;
                        }

                        tasksToUpdate.push(task);

                        // 如果有绑定块且完成状态变化，记录
                        if ((task.blockId || task.docId) && wasCompleted !== task.completed) {
                            blocksToUpdate.push(task.blockId || task.docId);
                        }

                        successCount++;
                    }
                }

                // 批量保存任务
                await this.saveTasks(tasksToUpdate);

                // 更新任务
                this.queueLoadTasks();
                showMessage(i18n('batchUpdateSuccess', { count: String(successCount) }) || `成功更新 ${successCount} 个任务`);
                // 批量更新绑定块属性
                for (const blockId of blocksToUpdate) {
                    await updateBindBlockAtrrs(blockId, this.plugin);
                }
            } catch (error) {
                console.error('批量设置状态失败:', error);
                showMessage(i18n('batchUpdateFailed') || '批量更新失败');
            }
        });
    }



    /**
     * 批量更新任务属性 (用于拖拽)
     */
    private async batchUpdateTasks(taskIds: string[], updates: { kanbanStatus?: string, customGroupId?: string | null }) {
        try {
            const reminderData = await this.getReminders();
            const blocksToUpdate = new Set<string>();
            let hasChanges = false;
            let updatedCount = 0;

            for (const taskId of taskIds) {
                const uiTask = this.tasks.find(t => t.id === taskId);
                if (!uiTask) continue;

                // 确定DB中的ID（兼容重复实例）
                const dbId = uiTask.isRepeatInstance ? uiTask.originalId : uiTask.id;
                const taskInDb = reminderData[dbId];
                if (!taskInDb) continue;

                let taskChanged = false;

                // 1. Status Update
                if (updates.kanbanStatus) {
                    const newStatus = updates.kanbanStatus;

                    if (uiTask.isRepeatInstance) {
                        const date = uiTask.date;
                        if (newStatus === 'completed') {
                            if (!taskInDb.repeat) taskInDb.repeat = {};
                            if (!taskInDb.repeat.completedInstances) taskInDb.repeat.completedInstances = [];
                            if (!taskInDb.repeat.completedInstances.includes(date)) {
                                taskInDb.repeat.completedInstances.push(date);
                                taskChanged = true;
                            }
                        } else {
                            if (taskInDb.repeat?.completedInstances) {
                                const idx = taskInDb.repeat.completedInstances.indexOf(date);
                                if (idx > -1) {
                                    taskInDb.repeat.completedInstances.splice(idx, 1);
                                    taskChanged = true;
                                }
                            }
                            // 如果不是 completed，更新主任务状态
                            if (taskInDb.kanbanStatus !== newStatus) {
                                taskInDb.kanbanStatus = newStatus === 'doing' ? 'doing' : newStatus;
                                taskChanged = true;
                            }
                        }
                    } else {
                        // Standard Task
                        if (newStatus === 'completed') {
                            if (!taskInDb.completed) {
                                taskInDb.completed = true;
                                taskInDb.completedTime = getLocalDateTimeString(new Date());
                                taskInDb.kanbanStatus = 'completed';
                                taskChanged = true;
                            }
                        } else {
                            if (taskInDb.completed || taskInDb.kanbanStatus !== newStatus) {
                                taskInDb.completed = false;
                                delete taskInDb.completedTime;
                                taskInDb.kanbanStatus = newStatus === 'doing' ? 'doing' : newStatus;
                                taskChanged = true;
                            }
                        }
                    }
                }

                // 2. Group Update
                if (updates.customGroupId !== undefined) {
                    const newGroup = updates.customGroupId;

                    if (uiTask.isRepeatInstance) {
                        const date = uiTask.date;
                        if (!taskInDb.repeat) taskInDb.repeat = {};
                        if (!taskInDb.repeat.instanceModifications) taskInDb.repeat.instanceModifications = {};
                        if (!taskInDb.repeat.instanceModifications[date]) taskInDb.repeat.instanceModifications[date] = {};

                        const instMod = taskInDb.repeat.instanceModifications[date];
                        if (instMod.customGroupId !== newGroup) {
                            if (newGroup === null) delete instMod.customGroupId;
                            else instMod.customGroupId = newGroup;
                            taskChanged = true;
                        }
                    } else {
                        if (taskInDb.customGroupId !== newGroup) {
                            if (newGroup === null) delete taskInDb.customGroupId;
                            else taskInDb.customGroupId = newGroup;
                            taskChanged = true;
                        }
                    }
                }

                // 3. Parent Detachment (如果移动了状态或分组，且有父任务，则解除父子关系)
                if ((updates.kanbanStatus || updates.customGroupId !== undefined) && taskInDb.parentId) {
                    delete taskInDb.parentId;
                    taskChanged = true;
                }

                if (taskChanged) {
                    hasChanges = true;
                    updatedCount++;
                    if (taskInDb.blockId || taskInDb.docId) {
                        blocksToUpdate.add(taskInDb.blockId || taskInDb.docId);
                    }
                }
            }

            if (hasChanges) {
                await saveReminders(this.plugin, reminderData);
                this.dispatchReminderUpdate(true);
                await this.queueLoadTasks(); // Full reload
                showMessage(i18n('batchUpdateSuccess', { count: String(updatedCount) }) || `成功更新 ${updatedCount} 个任务`);

                for (const blockId of blocksToUpdate) {
                    try {
                        await updateBindBlockAtrrs(blockId, this.plugin);
                    } catch (err) { console.warn(err); }
                }
            }

        } catch (e) {
            console.error("Batch update failed", e);
            showMessage("Batch update failed");
        }
    }

    /**
     * 批量设置分组
     */
    private async batchSetGroup(): Promise<void> {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const groups = await projectManager.getProjectCustomGroups(this.projectId);

            const groupOptions = [
                `<option value="">${i18n('noGroup') || '无分组'}</option>`,
                ...groups.map(g => `<option value="${g.id}">${g.icon || '📋'} ${g.name}</option>`)
            ].join('');

            const dialog = new Dialog({
                title: i18n('batchSetGroup') || '批量设置分组',
                content: `
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('selectGroup') || '选择分组'}</label>
                            <select id="batchGroupSelect" class="b3-select" style="width: 100%;">
                                ${groupOptions}
                            </select>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="batchGroupCancel">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="batchGroupConfirm">${i18n('confirm')}</button>
                    </div>
                `,
                width: '320px'
            });

            const groupSelect = dialog.element.querySelector('#batchGroupSelect') as HTMLSelectElement;
            const cancelBtn = dialog.element.querySelector('#batchGroupCancel') as HTMLButtonElement;
            const confirmBtn = dialog.element.querySelector('#batchGroupConfirm') as HTMLButtonElement;

            cancelBtn.addEventListener('click', () => dialog.destroy());

            confirmBtn.addEventListener('click', async () => {
                const groupId = groupSelect.value || null;
                dialog.destroy();

                try {
                    let successCount = 0;
                    const tasksToUpdate = [];

                    for (const taskId of selectedIds) {
                        const task = this.tasks.find(t => t.id === taskId);
                        if (task) {
                            task.customGroupId = groupId;
                            tasksToUpdate.push(task);
                            successCount++;
                        }
                    }

                    // 批量保存任务
                    await this.saveTasks(tasksToUpdate);
                    showMessage(i18n('batchUpdateSuccess', { count: String(successCount) }) || `成功更新 ${successCount} 个任务`);
                    this.queueLoadTasks();
                } catch (error) {
                    console.error('批量设置分组失败:', error);
                    showMessage(i18n('batchUpdateFailed') || '批量更新失败');
                }
            });
        } catch (error) {
            console.error('获取分组列表失败:', error);
            showMessage(i18n('loadGroupsFailed') || '加载分组失败');
        }
    }

    /**
     * 批量设置优先级
     */
    private async batchSetPriority(): Promise<void> {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        const priorities = [
            { id: 'none', name: i18n('noPriority') || '无优先级', icon: '' },
            { id: 'low', name: i18n('lowPriority') || '低优先级', icon: '🔵' },
            { id: 'medium', name: i18n('mediumPriority') || '中优先级', icon: '🟡' },
            { id: 'high', name: i18n('highPriority') || '高优先级', icon: '🔴' }
        ];

        const priorityOptions = priorities.map(p =>
            `<option value="${p.id}">${p.icon} ${p.name}</option>`
        ).join('');

        const dialog = new Dialog({
            title: i18n('batchSetPriority') || '批量设置优先级',
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('selectPriority') || '选择优先级'}</label>
                        <select id="batchPrioritySelect" class="b3-select" style="width: 100%;">
                            ${priorityOptions}
                        </select>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="batchPriorityCancel">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="batchPriorityConfirm">${i18n('confirm')}</button>
                </div>
            `,
            width: '320px'
        });

        const prioritySelect = dialog.element.querySelector('#batchPrioritySelect') as HTMLSelectElement;
        const cancelBtn = dialog.element.querySelector('#batchPriorityCancel') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#batchPriorityConfirm') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        confirmBtn.addEventListener('click', async () => {
            const newPriority = prioritySelect.value;
            dialog.destroy();

            try {
                let successCount = 0;
                const tasksToUpdate = [];

                for (const taskId of selectedIds) {
                    const task = this.tasks.find(t => t.id === taskId);
                    if (task) {
                        task.priority = newPriority;
                        tasksToUpdate.push(task);
                        successCount++;
                    }
                }

                // 批量保存任务
                await this.saveTasks(tasksToUpdate);
                showMessage(i18n('batchUpdateSuccess', { count: String(successCount) }) || `成功更新 ${successCount} 个任务`);
                this.queueLoadTasks();
            } catch (error) {
                console.error('批量设置优先级失败:', error);
                showMessage(i18n('batchUpdateFailed') || '批量更新失败');
            }
        });
    }

    /**
     * 批量删除任务
     */
    private batchDelete(): void {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        // 确认对话框 - 思源 confirm 使用回调方式
        confirm(
            i18n('confirmBatchDelete') || '确认批量删除',
            i18n('confirmBatchDeleteMessage', { count: String(selectedIds.length) }) || `确定要删除选中的 ${selectedIds.length} 个任务吗？此操作不可恢复。`,
            async () => {
                try {
                    await this.deleteTasksByIds(selectedIds);

                    // 清空选择
                    this.selectedTaskIds.clear();

                    showMessage(i18n('batchDeleteSuccess', { count: String(selectedIds.length) }) || `成功删除 ${selectedIds.length} 个任务`);
                } catch (error) {
                    console.error('批量删除失败:', error);
                    showMessage(i18n('batchDeleteFailed') || '批量删除失败');
                }
            }
        );
    }


    /**
     * 批量删除任务
     */
    private async deleteTasksByIds(taskIds: string[]): Promise<void> {
        let reminderData = await this.getReminders();
        const boundIds: string[] = [];

        // 收集所有要删除的任务ID，包括子任务
        const allTaskIdsToDelete = new Set<string>();

        const collectTasksToDelete = (ids: string[]) => {
            for (const id of ids) {
                if (allTaskIdsToDelete.has(id)) continue;
                allTaskIdsToDelete.add(id);

                // 递归收集子任务
                const children = this.tasks.filter(t => t.parentId === id);
                collectTasksToDelete(children.map(t => t.id));
            }
        };

        collectTasksToDelete(taskIds);

        // 从提醒数据中删除，并收集绑定块ID
        for (const taskId of allTaskIdsToDelete) {
            if (reminderData[taskId]) {
                const boundId = reminderData[taskId].blockId || reminderData[taskId].docId;
                if (boundId) {
                    boundIds.push(boundId);
                }
                delete reminderData[taskId];
            }
        }

        // 保存更新后的提醒数据
        await saveReminders(this.plugin, reminderData);



        // 从 this.tasks 中移除
        this.tasks = this.tasks.filter(t => !allTaskIdsToDelete.has(t.id));
        this.queueLoadTasks();

        // 触发更新事件
        this.dispatchReminderUpdate(true);

        // 更新绑定块属性
        for (const boundId of boundIds) {
            try {
                await updateBindBlockAtrrs(boundId, this.plugin);
            } catch (e) {
                /* ignore */
            }
        }
    }

}
