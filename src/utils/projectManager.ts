import { getFile, putFile, readProjectData } from '../api';
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
            const content = JSON.stringify(this.projectColors, null, 2);
            const blob = new Blob([content], { type: 'application/json' });
            const response = await putFile(PROJECT_COLOR_CONFIG_FILE, false, blob);

            // 检查响应是否包含错误信息
            if (response && typeof response === 'object' && 'code' in response && response.code !== 0) {
                console.error('Failed to save project colors - API error:', response);
                throw new Error(`API error: ${response.msg || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to save project colors:', error);
            throw error;
        }
    }

    private async loadProjectColors() {
        try {
            const content = await getFile(PROJECT_COLOR_CONFIG_FILE);
            if (content) {
                const parsed = typeof content === 'string' ? JSON.parse(content) : content;

                // 检查解析的内容是否包含错误响应，如果是则忽略
                if (parsed && typeof parsed === 'object' && 'code' in parsed && 'msg' in parsed) {
                    console.warn('Project colors file contains error response, resetting to empty');
                    this.projectColors = {};
                    // 清理损坏的文件并重新保存
                    await this.saveProjectColors();
                } else {
                    this.projectColors = parsed || {};
                }
            } else {
                this.projectColors = {};
            }
        } catch (error) {
            console.warn('Failed to load project colors, using defaults:', error);
            this.projectColors = {};
            // 尝试重新创建文件
            try {
                await this.saveProjectColors();
            } catch (saveError) {
                console.error('Failed to create initial project colors file:', saveError);
            }
        }
    }

    public async setProjectColor(projectId: string, color: string) {
        this.projectColors[projectId] = color;
        await this.saveProjectColors();
    }

    public getProjectColor(projectId: string): string {
        return this.projectColors[projectId] || this.generateColorFromId(projectId);
    }

    private generateColorFromId(id: string): string {
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
                this.projects = Object.values(projectData).map((p: any) => ({
                    id: p.id,
                    name: p.title,
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