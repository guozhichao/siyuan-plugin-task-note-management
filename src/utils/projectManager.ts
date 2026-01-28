import { getFile, putFile, removeFile } from '../api';
import { StatusManager } from './statusManager';

export interface Project {
    id: string;
    name: string;
    status: string;
    color?: string;
    kanbanMode?: 'status' | 'custom';
    customGroups?: any[];
    blockId?: string;
}

/**
 * 看板状态配置
 */
export interface KanbanStatus {
    id: string;           // 状态ID: 'doing', 'short_term', 'long_term', 'completed' 或自定义ID
    name: string;         // 显示名称
    color: string;        // 状态颜色
    isFixed: boolean;     // 是否固定不可删除（doing和completed为固定）
    isDefault: boolean;   // 是否为系统默认状态
    sort: number;         // 排序权重
}

export class ProjectManager {
    private static instance: ProjectManager;
    private plugin: any;
    private projects: Project[] = [];
    private projectColors: { [key: string]: string } = {};
    private statusManager: StatusManager;

    private constructor(plugin: any) {
        this.plugin = plugin;
        this.statusManager = StatusManager.getInstance(this.plugin);
    }

    public static getInstance(plugin?: any): ProjectManager {
        if (!ProjectManager.instance) {
            if (!plugin) {
                throw new Error('ProjectManager需要plugin实例进行初始化');
            }
            ProjectManager.instance = new ProjectManager(plugin);
        }
        return ProjectManager.instance;
    }

    async initialize() {
        await this.statusManager.initialize();
        await this.loadProjects();
    }

    public async setProjectColor(projectId: string, color: string) {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                projectData[projectId].color = color;
                await this.plugin.saveProjectData(projectData);
            }
            this.projectColors[projectId] = color;
            // 触发项目颜色更新事件，通知日历视图等组件更新颜色缓存
            window.dispatchEvent(new CustomEvent('projectColorUpdated'));
        } catch (error) {
            console.error('Failed to set project color:', error);
            throw error;
        }
    }

    public getProjectColor(projectId: string): string {
        if (!projectId) {
            return '#cccccc'; // 默认颜色
        }
        return this.projectColors[projectId] || this.generateColorFromId(projectId);
    }

    private generateColorFromId(id: string): string {
        if (!id || typeof id !== 'string') {
            return '#cccccc'; // 默认颜色
        }
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = id.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00FFFFFF)
            .toString(16)
            .toUpperCase();
        return "#" + "00000".substring(0, 6 - c.length) + c;
    }

    public async loadProjects() {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData && typeof projectData === 'object') {

                const projectEntries = Object.entries(projectData).filter(([key]) => !key.startsWith('_'));
                this.projects = projectEntries
                    .map(([id, project]: [string, any]) => ({
                        id: id,
                        name: project.title || '未命名项目',
                        status: project.status || 'doing',
                        color: project.color,
                        blockId: project.blockId
                    }));

                // 从项目中提取颜色到 projectColors
                this.projectColors = {};
                projectEntries.forEach(([id, project]: [string, any]) => {
                    if (project.color) {
                        this.projectColors[id] = project.color;
                    }
                });
            } else {
                this.projects = [];
                this.projectColors = {};
            }
        } catch (error) {
            console.error('Failed to load projects:', error);
            this.projects = [];
            this.projectColors = {};
        }
    }

    public getProjectsGroupedByStatus(): { [key: string]: Project[] } {
        const statuses = this.statusManager.getStatuses();
        const grouped: { [key: string]: Project[] } = {};

        statuses.forEach(status => {
            grouped[status.id] = [];
        });

        this.projects.forEach(project => {
            const status = project.status || 'active';
            if (grouped[status]) {
                grouped[status].push(project);
            } else {
                // Handle projects with statuses that may no longer exist
                if (!grouped.hasOwnProperty('uncategorized')) {
                    grouped['uncategorized'] = [];
                }
                grouped['uncategorized'].push(project);
            }
        });

        // Sort statuses to ensure archived is last
        const sortedGrouped: { [key: string]: Project[] } = {};
        const activeStatuses = statuses.filter(s => !s.isArchived);
        const archivedStatuses = statuses.filter(s => s.isArchived);

        activeStatuses.forEach(status => {
            if (grouped[status.id]?.length > 0) {
                sortedGrouped[status.id] = grouped[status.id];
            }
        });

        archivedStatuses.forEach(status => {
            if (grouped[status.id]?.length > 0) {
                sortedGrouped[status.id] = grouped[status.id];
            }
        });

        if (grouped['uncategorized']?.length > 0) {
            sortedGrouped['uncategorized'] = grouped['uncategorized'];
        }

        return sortedGrouped;
    }

    public getProjectById(id: string): Project | undefined {
        return this.projects.find(p => p.id === id);
    }

    public getProjectName(id: string): string | undefined {
        const project = this.getProjectById(id);
        return project?.name;
    }

    public getStatusManager(): StatusManager {
        return this.statusManager;
    }

    /**
     * 获取项目的看板模式
     */
    public async getProjectKanbanMode(projectId: string): Promise<'status' | 'custom'> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[projectId];
            return project?.kanbanMode || 'status';
        } catch (error) {
            console.error('获取项目看板模式失败:', error);
            return 'status';
        }
    }

    /**
     * 设置项目的看板模式
     */
    public async setProjectKanbanMode(projectId: string, mode: 'status' | 'custom'): Promise<void> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                projectData[projectId].kanbanMode = mode;
                await this.plugin.saveProjectData(projectData);
            }
        } catch (error) {
            console.error('设置项目看板模式失败:', error);
            throw error;
        }
    }

    /**
     * 获取项目的自定义分组
     */
    public async getProjectCustomGroups(projectId: string): Promise<any[]> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[projectId];
            return project?.customGroups || [];
        } catch (error) {
            console.error('获取项目自定义分组失败:', error);
            return [];
        }
    }

    /**
     * 设置项目的自定义分组
     */
    public async setProjectCustomGroups(projectId: string, groups: any[]): Promise<void> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                projectData[projectId].customGroups = groups;
                await this.plugin.saveProjectData(projectData);
            }
        } catch (error) {
            console.error('设置项目自定义分组失败:', error);
            throw error;
        }
    }



    /**
     * 获取项目的标签列表
     */
    public async getProjectTags(projectId: string): Promise<Array<{ id: string, name: string, color: string }>> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[projectId];
            const tags = project?.tags || [];

            // 兼容旧数据格式
            if (tags.length > 0) {
                // 情况1: 字符串数组 -> 转换为带ID的对象数组
                if (typeof tags[0] === 'string') {
                    const convertedTags = tags.map((tag: string) => ({
                        id: this.generateTagId(),
                        name: tag,
                        color: '#3498db'
                    }));
                    // 自动保存转换后的数据
                    await this.setProjectTags(projectId, convertedTags);
                    return convertedTags;
                }

                // 情况2: 对象数组但没有ID -> 添加ID
                if (!tags[0].id) {
                    const tagsWithId = tags.map((tag: any) => ({
                        id: this.generateTagId(),
                        name: tag.name,
                        color: tag.color || '#3498db'
                    }));
                    // 自动保存添加ID后的数据
                    await this.setProjectTags(projectId, tagsWithId);
                    return tagsWithId;
                }
            }

            return tags;
        } catch (error) {
            console.error('获取项目标签失败:', error);
            return [];
        }
    }

    /**
     * 设置项目的标签列表
     */
    public async setProjectTags(projectId: string, tags: Array<{ id: string, name: string, color: string }>): Promise<void> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                projectData[projectId].tags = tags;
                await this.plugin.saveProjectData(projectData);
            }
        } catch (error) {
            console.error('设置项目标签失败:', error);
            throw error;
        }
    }

    /**
     * 生成唯一的标签ID
     */
    private generateTagId(): string {
        return `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 获取项目的默认看板状态配置
     * 固定状态：doing(进行中), completed(已完成)
     * 默认可自定义状态：short_term(短期), long_term(长期)
     */
    public getDefaultKanbanStatuses(): KanbanStatus[] {
        return [
            {
                id: 'doing',
                name: '进行中',
                color: '#e74c3c',
                isFixed: true,
                isDefault: true,
                sort: 0
            },
            {
                id: 'short_term',
                name: '短期',
                color: '#3498db',
                isFixed: false,
                isDefault: true,
                sort: 10
            },
            {
                id: 'long_term',
                name: '长期',
                color: '#9b59b6',
                isFixed: false,
                isDefault: true,
                sort: 20
            },
            {
                id: 'completed',
                name: '已完成',
                color: '#27ae60',
                isFixed: true,
                isDefault: true,
                sort: 100
            }
        ];
    }

    /**
     * 获取项目的看板状态配置
     * 如果没有自定义配置，返回默认配置
     */
    public async getProjectKanbanStatuses(projectId: string): Promise<KanbanStatus[]> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[projectId];
            const customStatuses = project?.kanbanStatuses;

            // 如果有自定义配置，合并默认固定状态和自定义状态
            if (customStatuses && Array.isArray(customStatuses) && customStatuses.length > 0) {
                const defaults = this.getDefaultKanbanStatuses();
                // 确保固定状态存在且不能被覆盖
                const fixedStatuses = defaults.filter(s => s.isFixed);
                // 合并自定义状态，但排除固定状态的ID以避免冲突
                const customNonFixed = customStatuses.filter(s => !s.isFixed);
                return [...fixedStatuses, ...customNonFixed].sort((a, b) => a.sort - b.sort);
            }

            // 返回默认配置
            return this.getDefaultKanbanStatuses();
        } catch (error) {
            console.error('获取项目看板状态失败:', error);
            return this.getDefaultKanbanStatuses();
        }
    }

    /**
     * 设置项目的看板状态配置
     * 只允许修改非固定状态
     */
    public async setProjectKanbanStatuses(projectId: string, statuses: KanbanStatus[]): Promise<void> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                // 过滤掉固定状态，只保存自定义状态
                const customStatuses = statuses.filter(s => !s.isFixed);
                projectData[projectId].kanbanStatuses = customStatuses;
                await this.plugin.saveProjectData(projectData);
            }
        } catch (error) {
            console.error('设置项目看板状态失败:', error);
            throw error;
        }
    }

    /**
     * 生成自定义看板状态ID
     */
    public generateKanbanStatusId(): string {
        return `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}