import { t } from "./i18n";
import { getFile, putFile } from "../api";

export interface CustomGroup {
    id: string;
    name: string;
    color: string;
    icon?: string;
    sort: number;
}

const CUSTOM_GROUPS_FILE_PATH = 'data/storage/petal/siyuan-plugin-task-note-management/customGroups.json';

export class CustomGroupManager {
    private static instance: CustomGroupManager;
    private groups: CustomGroup[] = [];

    private constructor() { }

    public static getInstance(): CustomGroupManager {
        if (!CustomGroupManager.instance) {
            CustomGroupManager.instance = new CustomGroupManager();
        }
        return CustomGroupManager.instance;
    }

    /**
     * 初始化自定义分组数据
     */
    public async initialize(): Promise<void> {
        try {
            await this.loadGroups();
        } catch (error) {
            console.error('初始化自定义分组失败:', error);
            // 如果加载失败，使用默认分组
            await this.createDefaultGroups();
        }
    }

    /**
     * 创建默认分组
     */
    private async createDefaultGroups(): Promise<void> {
        const defaultGroups: CustomGroup[] = [
        ];

        this.groups = [...defaultGroups];
        await this.saveGroups();
    }

    /**
     * 加载分组数据
     */
    public async loadGroups(): Promise<CustomGroup[]> {
        try {
            const content = await getFile(CUSTOM_GROUPS_FILE_PATH);
            if (!content) {
                console.log('自定义分组文件不存在，创建默认分组');
                await this.createDefaultGroups();
                return this.groups;
            }

            const groupsData = typeof content === 'string' ? JSON.parse(content) : content;

            // 验证加载的数据是否为有效的分组数组
            if (Array.isArray(groupsData) && groupsData.length > 0) {
                this.groups = groupsData;
            } else {
                console.log('自定义分组数据无效，使用默认分组');
                await this.createDefaultGroups();
            }
        } catch (error) {
            console.warn('加载自定义分组文件失败，使用默认分组:', error);
            await this.createDefaultGroups();
        }

        return this.groups;
    }

    /**
     * 保存分组数据
     */
    public async saveGroups(): Promise<void> {
        try {
            const content = JSON.stringify(this.groups, null, 2);
            const blob = new Blob([content], { type: 'application/json' });
            await putFile(CUSTOM_GROUPS_FILE_PATH, false, blob);
        } catch (error) {
            console.error('保存自定义分组失败:', error);
            throw error;
        }
    }

    /**
     * 获取所有分组
     */
    public getGroups(): CustomGroup[] {
        return [...this.groups].sort((a, b) => a.sort - b.sort);
    }

    /**
     * 根据ID获取分组
     */
    public getGroupById(id: string): CustomGroup | undefined {
        return this.groups.find(group => group.id === id);
    }

    /**
     * 添加新分组
     */
    public async addGroup(group: Omit<CustomGroup, 'id' | 'sort'>): Promise<CustomGroup> {
        const maxSort = this.groups.reduce((max, g) => Math.max(max, g.sort || 0), 0);
        const newGroup: CustomGroup = {
            ...group,
            id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            sort: maxSort + 10
        };

        this.groups.push(newGroup);
        await this.saveGroups();
        return newGroup;
    }

    /**
     * 更新分组
     */
    public async updateGroup(id: string, updates: Partial<Omit<CustomGroup, 'id' | 'sort'>>): Promise<boolean> {
        const index = this.groups.findIndex(group => group.id === id);
        if (index === -1) {
            return false;
        }

        this.groups[index] = { ...this.groups[index], ...updates };
        await this.saveGroups();
        return true;
    }

    /**
     * 删除分组
     */
    public async deleteGroup(id: string): Promise<boolean> {
        const index = this.groups.findIndex(group => group.id === id);
        if (index === -1) {
            return false;
        }

        this.groups.splice(index, 1);
        await this.saveGroups();
        return true;
    }

    /**
     * 重新排序分组
     */
    public async reorderGroups(reorderedGroups: CustomGroup[]): Promise<void> {
        // 验证传入的分组数组
        if (!Array.isArray(reorderedGroups)) {
            throw new Error('重排序的分组必须是数组');
        }

        // 验证分组数量是否匹配
        if (reorderedGroups.length !== this.groups.length) {
            throw new Error('重排序的分组数量不匹配');
        }

        // 验证所有分组ID都存在
        const currentIds = new Set(this.groups.map(group => group.id));
        const reorderedIds = new Set(reorderedGroups.map(group => group.id));

        if (currentIds.size !== reorderedIds.size ||
            ![...currentIds].every(id => reorderedIds.has(id))) {
            throw new Error('重排序的分组ID不匹配');
        }

        // 更新分组顺序和排序值
        this.groups = reorderedGroups.map((group, index) => ({
            ...group,
            sort: index * 10
        }));
        await this.saveGroups();
    }

    /**
     * 获取分组的样式
     */
    public getGroupStyle(groupId: string): { backgroundColor: string; borderColor: string } {
        const group = this.getGroupById(groupId);
        if (!group) {
            return { backgroundColor: '#95a5a6', borderColor: '#7f8c8d' };
        }

        return {
            backgroundColor: group.color,
            borderColor: this.darkenColor(group.color, 10)
        };
    }

    /**
     * 加深颜色
     */
    private darkenColor(color: string, percent: number): string {
        const num = parseInt(color.replace("#", ""), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) - amt;
        const G = (num >> 8 & 0x00FF) - amt;
        const B = (num & 0x0000FF) - amt;
        return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
            (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
            (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
    }

    /**
     * 根据任务的自定义分组ID获取分组信息
     */
    public getGroupByTask(task: any): CustomGroup | undefined {
        if (!task.customGroupId) {
            return undefined;
        }
        return this.getGroupById(task.customGroupId);
    }

    /**
     * 获取项目的所有自定义分组（从项目数据中读取）
     */
    public getProjectGroups(projectId: string, projectData: any): CustomGroup[] {
        const project = projectData[projectId];
        if (!project || !project.customGroups) {
            return [];
        }
        return project.customGroups;
    }

    /**
     * 保存项目自定义分组到项目数据
     */
    public async saveProjectGroups(projectId: string, groups: CustomGroup[]): Promise<void> {
        try {
            // 这里需要读取项目数据，更新特定项目的自定义分组
            // 由于项目数据存储在不同的地方，这里返回一个需要在ProjectKanbanView中处理的结果
            const event = new CustomEvent('updateProjectCustomGroups', {
                detail: { projectId, groups }
            });
            window.dispatchEvent(event);
        } catch (error) {
            console.error('保存项目自定义分组失败:', error);
            throw error;
        }
    }
}