import { getFile, putFile, readProjectData, writeProjectData, removeFile } from '../api';
import { StatusManager } from './statusManager';

const PROJECT_COLOR_CONFIG_FILE = 'data/storage/petal/siyuan-plugin-task-note-management/project_colors.json';

export interface Project {
    id: string;
    name: string;
    status: string;
    color?: string;
    kanbanMode?: 'status' | 'custom';
    customGroups?: any[];
}

export class ProjectManager {
    private static instance: ProjectManager;
    private projects: Project[] = [];
    private projectColors: { [key: string]: string } = {};
    private statusManager: StatusManager;

    private constructor() {
        this.statusManager = StatusManager.getInstance();
    }

    public static getInstance(): ProjectManager {
        if (!ProjectManager.instance) {
            ProjectManager.instance = new ProjectManager();
        }
        return ProjectManager.instance;
    }

    async initialize() {
        await this.statusManager.initialize();
        await this.loadProjectColors();
        await this.loadProjects();
    }

    private async saveProjectColors() {
        try {
            const projectData = await readProjectData();
            projectData._colors = this.projectColors;
            await writeProjectData(projectData);
        } catch (error) {
            console.error('Failed to save project colors:', error);
            throw error;
        }
    }

    private async loadProjectColors() {
        try {
            const projectData = await readProjectData();
            this.projectColors = projectData._colors || {};

            // 检查是否存在旧的 project_colors.json 文件，如果存在则导入并删除
            try {
                const oldColorsContent = await getFile(PROJECT_COLOR_CONFIG_FILE);
                if (oldColorsContent && oldColorsContent.code !== 404) {
                    const oldColors = typeof oldColorsContent === 'string' ? JSON.parse(oldColorsContent) : oldColorsContent;
                    if (oldColors && typeof oldColors === 'object') {
                        // 合并旧颜色数据到新的 projectData._colors
                        Object.assign(this.projectColors, oldColors);
                        projectData._colors = this.projectColors;
                        await writeProjectData(projectData);
                        // 删除旧文件
                        await removeFile(PROJECT_COLOR_CONFIG_FILE);
                        console.log('成功导入并删除旧的 project_colors.json 文件');
                    }
                }
            } catch (error) {
                // 如果文件不存在或其他错误，忽略
                console.log('旧的 project_colors.json 文件不存在或已处理');
            }
        } catch (error) {
            console.warn('Failed to load project colors, using defaults:', error);
            this.projectColors = {};
        }
    }

    public async setProjectColor(projectId: string, color: string) {
        this.projectColors[projectId] = color;
        await this.saveProjectColors();
    }

    public getProjectColor(projectId: string): string {
        if (!projectId) {
            return '#cccccc'; // 默认颜色
        }
        return this.projectColors[projectId] || this.generateColorFromId(projectId);
    }

    private generateColorFromId(id: string): string {
        if (!id) {
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
            const projectData = await readProjectData();
            if (projectData && typeof projectData === 'object') {
                this.projects = Object.values(projectData)
                    .filter((p: any) => p && p.id) // 过滤掉无效的项目
                    .map((p: any) => ({
                        id: p.id,
                        name: p.title || '未命名项目',
                        status: p.status || 'doing'
                    }));
            } else {
                this.projects = [];
            }
        } catch (error) {
            console.error('Failed to load projects:', error);
            this.projects = [];
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
            const projectData = await readProjectData();
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
            const projectData = await readProjectData();
            if (projectData[projectId]) {
                projectData[projectId].kanbanMode = mode;
                // 保存项目数据（这里需要调用API保存）
                const { writeProjectData } = await import('../api');
                await writeProjectData(projectData);
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
            const projectData = await readProjectData();
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
            const projectData = await readProjectData();
            if (projectData[projectId]) {
                projectData[projectId].customGroups = groups;
                // 保存项目数据（这里需要调用API保存）
                const { writeProjectData } = await import('../api');
                await writeProjectData(projectData);
            }
        } catch (error) {
            console.error('设置项目自定义分组失败:', error);
            throw error;
        }
    }
}