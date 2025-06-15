import { showMessage, confirm, Menu, openTab } from "siyuan";
import { readProjectData, writeProjectData, getBlockByID } from "../api";
import { getLocalDateString, compareDateStrings } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { ProjectDialog } from "./ProjectDialog";
import { t } from "../utils/i18n";

export class ProjectPanel {
    private container: HTMLElement;
    private projectsContainer: HTMLElement;
    private filterSelect: HTMLSelectElement;
    private categoryFilterSelect: HTMLSelectElement;
    private sortButton: HTMLButtonElement;
    private plugin: any;
    private currentTab: string = 'active';
    private currentCategoryFilter: string = 'all';
    private currentSort: string = 'time';
    private currentSortOrder: 'asc' | 'desc' = 'desc';
    private categoryManager: CategoryManager;
    private projectUpdatedHandler: () => void;

    constructor(container: HTMLElement, plugin?: any) {
        this.container = container;
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance();

        this.projectUpdatedHandler = () => {
            this.loadProjects();
        };

        this.initializeAsync();
    }

    private async initializeAsync() {
        await this.categoryManager.initialize();
        this.initUI();
        this.loadProjects();

        // 监听项目更新事件
        window.addEventListener('projectUpdated', this.projectUpdatedHandler);
    }

    public destroy() {
        if (this.projectUpdatedHandler) {
            window.removeEventListener('projectUpdated', this.projectUpdatedHandler);
        }
    }

    private initUI() {
        this.container.classList.add('project-panel');
        this.container.innerHTML = '';

        // 标题部分
        const header = document.createElement('div');
        header.className = 'project-header';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'project-title';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'project-icon';
        iconSpan.textContent = '📁';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = '项目管理';

        titleContainer.appendChild(iconSpan);
        titleContainer.appendChild(titleSpan);

        // 添加右侧按钮容器
        const actionContainer = document.createElement('div');
        actionContainer.className = 'project-panel__actions';
        actionContainer.style.marginLeft = 'auto';

        // 添加排序按钮
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'b3-button b3-button--outline';
        this.sortButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        this.sortButton.title = "排序";
        this.sortButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showSortMenu(e);
        });
        actionContainer.appendChild(this.sortButton);

        // 添加刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = "刷新";
        refreshBtn.addEventListener('click', () => {
            this.loadProjects();
        });
        actionContainer.appendChild(refreshBtn);

        titleContainer.appendChild(actionContainer);
        header.appendChild(titleContainer);

        // 筛选控件
        const controls = document.createElement('div');
        controls.className = 'project-controls';
        controls.style.cssText = `
            display: flex;
            gap: 8px;
            width: 100%;
        `;

        // 状态筛选
        this.filterSelect = document.createElement('select');
        this.filterSelect.className = 'b3-select';
        this.filterSelect.style.cssText = `
            flex: 1;
            min-width: 0;
        `;
        this.filterSelect.innerHTML = `
            <option value="active" selected>正在进行</option>
            <option value="someday">未来也许</option>
            <option value="archived">已归档</option>
            <option value="all">全部项目</option>
        `;
        this.filterSelect.addEventListener('change', () => {
            this.currentTab = this.filterSelect.value;
            this.loadProjects();
        });
        controls.appendChild(this.filterSelect);

        // 分类筛选
        this.categoryFilterSelect = document.createElement('select');
        this.categoryFilterSelect.className = 'b3-select';
        this.categoryFilterSelect.style.cssText = `
            flex: 1;
            min-width: 0;
        `;
        this.categoryFilterSelect.addEventListener('change', () => {
            this.currentCategoryFilter = this.categoryFilterSelect.value;
            this.loadProjects();
        });
        controls.appendChild(this.categoryFilterSelect);

        header.appendChild(controls);
        this.container.appendChild(header);

        // 项目列表容器
        this.projectsContainer = document.createElement('div');
        this.projectsContainer.className = 'project-list';
        this.container.appendChild(this.projectsContainer);

        // 渲染分类过滤器
        this.renderCategoryFilter();
        this.updateSortButtonTitle();
    }

    private async renderCategoryFilter() {
        if (!this.categoryFilterSelect) return;

        try {
            const categories = this.categoryManager.getCategories();

            this.categoryFilterSelect.innerHTML = `
                <option value="all" ${this.currentCategoryFilter === 'all' ? 'selected' : ''}>全部分类</option>
                <option value="none" ${this.currentCategoryFilter === 'none' ? 'selected' : ''}>无分类</option>
            `;

            categories.forEach(category => {
                const optionEl = document.createElement('option');
                optionEl.value = category.id;
                const displayText = category.icon ? `${category.icon} ${category.name}` : category.name;
                optionEl.textContent = displayText;
                optionEl.selected = this.currentCategoryFilter === category.id;
                this.categoryFilterSelect.appendChild(optionEl);
            });

        } catch (error) {
            console.error('渲染分类过滤器失败:', error);
            this.categoryFilterSelect.innerHTML = '<option value="all">全部分类</option>';
        }
    }

    private updateSortButtonTitle() {
        if (this.sortButton) {
            const sortNames = {
                'time': '时间',
                'priority': '优先级',
                'title': '标题'
            };
            const orderNames = {
                'asc': '升序',
                'desc': '降序'
            };
            this.sortButton.title = `排序: ${sortNames[this.currentSort]} (${orderNames[this.currentSortOrder]})`;
        }
    }

    private showSortMenu(event: MouseEvent) {
        try {
            const menu = new Menu("projectSortMenu");

            const sortOptions = [
                { key: 'time', label: '时间', icon: '🕐' },
                { key: 'priority', label: '优先级', icon: '🎯' },
                { key: 'title', label: '标题', icon: '📝' }
            ];

            sortOptions.forEach(option => {
                // 为每个排序方式添加升序和降序选项
                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (升序↑)`,
                    current: this.currentSort === option.key && this.currentSortOrder === 'asc',
                    click: () => {
                        this.currentSort = option.key;
                        this.currentSortOrder = 'asc';
                        this.updateSortButtonTitle();
                        this.loadProjects();
                    }
                });

                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (降序↓)`,
                    current: this.currentSort === option.key && this.currentSortOrder === 'desc',
                    click: () => {
                        this.currentSort = option.key;
                        this.currentSortOrder = 'desc';
                        this.updateSortButtonTitle();
                        this.loadProjects();
                    }
                });
            });

            if (this.sortButton) {
                const rect = this.sortButton.getBoundingClientRect();
                const menuX = rect.left;
                const menuY = rect.bottom + 4;

                const maxX = window.innerWidth - 200;
                const maxY = window.innerHeight - 200;

                menu.open({
                    x: Math.min(menuX, maxX),
                    y: Math.min(menuY, maxY)
                });
            } else {
                menu.open({
                    x: event.clientX,
                    y: event.clientY
                });
            }
        } catch (error) {
            console.error('显示排序菜单失败:', error);
        }
    }

    private async loadProjects() {
        try {
            const projectData = await readProjectData();

            if (!projectData || typeof projectData !== 'object') {
                this.renderProjects([]);
                return;
            }

            // 迁移旧数据：将 archived 字段转换为 status 字段
            let dataChanged = false;
            const projects = Object.values(projectData).filter((project: any) => {
                if (project && typeof project === 'object' && project.id) {
                    // 数据迁移：将旧的 archived 字段转换为新的 status 字段
                    if (!project.status && project.hasOwnProperty('archived')) {
                        project.status = project.archived ? 'archived' : 'active';
                        dataChanged = true;
                    } else if (!project.status) {
                        project.status = 'active';
                        dataChanged = true;
                    }
                    return true;
                }
                return false;
            });

            // 如果有数据迁移，保存更新
            if (dataChanged) {
                await writeProjectData(projectData);
            }

            // 应用分类过滤
            const filteredProjects = this.applyCategoryFilter(projects);

            // 分类项目
            let displayProjects = [];
            switch (this.currentTab) {
                case 'active':
                    displayProjects = filteredProjects.filter((project: any) => project.status === 'active');
                    break;
                case 'someday':
                    displayProjects = filteredProjects.filter((project: any) => project.status === 'someday');
                    break;
                case 'archived':
                    displayProjects = filteredProjects.filter((project: any) => project.status === 'archived');
                    break;
                case 'all':
                    displayProjects = filteredProjects;
                    break;
                default:
                    displayProjects = filteredProjects.filter((project: any) => project.status === 'active');
            }

            // 应用排序
            this.sortProjects(displayProjects);

            // 渲染项目
            this.renderProjects(displayProjects);

        } catch (error) {
            console.error('加载项目失败:', error);
            showMessage("加载项目失败");
        }
    }

    private applyCategoryFilter(projects: any[]): any[] {
        if (this.currentCategoryFilter === 'all') {
            return projects;
        }

        return projects.filter(project => {
            if (this.currentCategoryFilter === 'none') {
                return !project.categoryId;
            }
            return project.categoryId === this.currentCategoryFilter;
        });
    }

    private sortProjects(projects: any[]) {
        const sortType = this.currentSort;
        const sortOrder = this.currentSortOrder;

        projects.sort((a: any, b: any) => {
            let result = 0;

            switch (sortType) {
                case 'time':
                    result = this.compareByTime(a, b);
                    break;
                case 'priority':
                    result = this.compareByPriority(a, b);
                    break;
                case 'title':
                    result = this.compareByTitle(a, b);
                    break;
                default:
                    result = this.compareByTime(a, b);
            }

            return sortOrder === 'desc' ? -result : result;
        });
    }

    private compareByTime(a: any, b: any): number {
        const dateA = a.startDate || a.createdTime || '';
        const dateB = b.startDate || b.createdTime || '';
        return dateA.localeCompare(dateB);
    }

    private compareByPriority(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;
        return priorityB - priorityA;
    }

    private compareByTitle(a: any, b: any): number {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        return titleA.localeCompare(titleB, 'zh-CN');
    }

    private renderProjects(projects: any[]) {
        if (projects.length === 0) {
            const filterNames = {
                'active': '暂无正在进行的项目',
                'someday': '暂无未来也许的项目',
                'archived': '暂无已归档的项目',
                'all': '暂无项目'
            };
            this.projectsContainer.innerHTML = `<div class="project-empty">${filterNames[this.currentTab] || '暂无项目'}</div>`;
            return;
        }

        this.projectsContainer.innerHTML = '';

        projects.forEach((project: any) => {
            const projectEl = this.createProjectElement(project);
            this.projectsContainer.appendChild(projectEl);
        });
    }

    private createProjectElement(project: any): HTMLElement {
        const today = getLocalDateString();
        const isOverdue = project.endDate && compareDateStrings(project.endDate, today) < 0;
        const priority = project.priority || 'none';
        const status = project.status || 'active';

        const projectEl = document.createElement('div');
        projectEl.className = `project-item ${isOverdue ? 'project-item--overdue' : ''} project-item--${status} project-priority-${priority}`;

        // 添加右键菜单支持
        projectEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showProjectContextMenu(e, project);
        });

        const contentEl = document.createElement('div');
        contentEl.className = 'project-item__content';

        // 信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'project-item__info';

        // 标题
        const titleEl = document.createElement('a');
        titleEl.className = 'project-item__title';
        titleEl.textContent = project.title || '未命名项目';
        titleEl.href = '#';
        titleEl.addEventListener('click', (e) => {
            e.preventDefault();
            this.openProject(project.blockId || project.id);
        });

        // 时间信息容器
        const timeContainer = document.createElement('div');
        timeContainer.className = 'project-item__time-container';
        timeContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            margin-top: 4px;
        `;

        // 时间信息
        const timeEl = document.createElement('div');
        timeEl.className = 'project-item__time';
        timeEl.textContent = this.formatProjectTime(project.startDate, project.endDate, today);

        // 添加优先级标签
        if (priority !== 'none') {
            const priorityLabel = document.createElement('span');
            priorityLabel.className = `project-priority-label ${priority}`;
            const priorityNames = {
                'high': '高优先级',
                'medium': '中优先级',
                'low': '低优先级'
            };
            priorityLabel.innerHTML = `<div class="priority-dot ${priority}"></div>${priorityNames[priority]}`;
            timeEl.appendChild(priorityLabel);
        }

        if (isOverdue && status === 'active') {
            const overdueLabel = document.createElement('span');
            overdueLabel.className = 'project-overdue-label';
            overdueLabel.textContent = '已过期';
            timeEl.appendChild(overdueLabel);
        }

        
        
        timeContainer.appendChild(timeEl);
        
        infoEl.appendChild(titleEl);
        infoEl.appendChild(timeContainer);
        
        // 添加状态标签
        const statusLabel = document.createElement('div');
        statusLabel.className = `project-status-label project-status-${status}`;
        const statusNames = {
            'active': '▶️进行中',
            'someday': '💭未来也许',
            'archived': '📥已归档'
        };
        statusLabel.textContent = statusNames[status] || '未知状态';
        infoEl.appendChild(statusLabel);
        // 分类显示
        if (project.categoryId) {
            const category = this.categoryManager.getCategoryById(project.categoryId);
            if (category) {
                const categoryContainer = document.createElement('div');
                categoryContainer.className = 'project-item__category-container';
                categoryContainer.style.cssText = `
                    margin-top: 4px;
                `;

                const categoryEl = document.createElement('div');
                categoryEl.className = 'project-category-tag';
                categoryEl.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 2px 6px;
                    background-color: ${category.color};
                    border: 1px solid ${category.color}40;
                    border-radius: 5px;
                    font-size: 11px;
                    color: #fff;
                `;

                if (category.icon) {
                    const iconSpan = document.createElement('span');
                    iconSpan.textContent = category.icon;
                    iconSpan.style.cssText = `
                        font-size: 12px;
                        line-height: 1;
                    `;
                    categoryEl.appendChild(iconSpan);
                }

                const nameSpan = document.createElement('span');
                nameSpan.textContent = category.name;
                nameSpan.style.cssText = `
                    font-size: 11px;
                    font-weight: 500;
                `;
                categoryEl.appendChild(nameSpan);

                categoryContainer.appendChild(categoryEl);
                infoEl.appendChild(categoryContainer);
            }
        }

        // 描述
        if (project.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'project-item__note';
            noteEl.textContent = project.note;
            infoEl.appendChild(noteEl);
        }

        contentEl.appendChild(infoEl);
        projectEl.appendChild(contentEl);

        return projectEl;
    }

    private formatProjectTime(startDate: string, endDate?: string, today?: string): string {
        if (!today) {
            today = getLocalDateString();
        }

        let timeStr = '';

        if (startDate) {
            const start = new Date(startDate + 'T00:00:00');
            const startStr = start.toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric'
            });
            timeStr = `📅 ${startStr}`;
        }

        if (endDate) {
            const end = new Date(endDate + 'T00:00:00');
            const endStr = end.toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric'
            });
            timeStr += ` → ${endStr}`;
        }

        return timeStr || '📅 无日期';
    }

    private showProjectContextMenu(event: MouseEvent, project: any) {
        const menu = new Menu("projectContextMenu");

        // 复制块引用
        menu.addItem({
            iconHTML: "📋",
            label: "复制块引用",
            click: () => this.copyProjectRef(project)
        });

        // 编辑项目
        menu.addItem({
            iconHTML: "📝",
            label: "编辑项目",
            click: () => this.editProject(project)
        });

        // 设置优先级子菜单
        const createPriorityMenuItems = () => {
            const priorities = [
                { key: 'high', label: '高', icon: '🔴' },
                { key: 'medium', label: '中', icon: '🟡' },
                { key: 'low', label: '低', icon: '🔵' },
                { key: 'none', label: '无', icon: '⚫' }
            ];

            const currentPriority = project.priority || 'none';

            return priorities.map(priority => ({
                iconHTML: priority.icon,
                label: priority.label,
                current: currentPriority === priority.key,
                click: () => {
                    this.setPriority(project.id, priority.key);
                }
            }));
        };

        menu.addItem({
            iconHTML: "🎯",
            label: "设置优先级",
            submenu: createPriorityMenuItems()
        });

        // 设置分类子菜单
        const createCategoryMenuItems = () => {
            const categories = this.categoryManager.getCategories();
            const currentCategoryId = project.categoryId;

            const menuItems = [];

            menuItems.push({
                iconHTML: "❌",
                label: "无分类",
                current: !currentCategoryId,
                click: () => {
                    this.setCategory(project.id, null);
                }
            });

            categories.forEach(category => {
                menuItems.push({
                    iconHTML: category.icon || "📁",
                    label: category.name,
                    current: currentCategoryId === category.id,
                    click: () => {
                        this.setCategory(project.id, category.id);
                    }
                });
            });

            return menuItems;
        };

        menu.addItem({
            iconHTML: "🏷️",
            label: "设置分类",
            submenu: createCategoryMenuItems()
        });

        // 设置状态子菜单
        const createStatusMenuItems = () => {
            const statuses = [
                { key: 'active', label: '正在进行', icon: '▶️' },
                { key: 'someday', label: '未来也许', icon: '💭' },
                { key: 'archived', label: '已归档', icon: '📥' }
            ];

            const currentStatus = project.status || 'active';

            return statuses.map(status => ({
                iconHTML: status.icon,
                label: status.label,
                current: currentStatus === status.key,
                click: () => {
                    this.setStatus(project.id, status.key);
                }
            }));
        };

        menu.addItem({
            iconHTML: "📊",
            label: "设置状态",
            submenu: createStatusMenuItems()
        });

        menu.addSeparator();

        // 删除项目
        menu.addItem({
            iconHTML: "🗑️",
            label: "删除项目",
            click: () => this.deleteProject(project)
        });

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async copyProjectRef(project: any) {
        try {
            const blockId = project.blockId || project.id;
            const title = project.title || '未命名项目';
            const blockRef = `((${blockId} "${title}"))`;
            await navigator.clipboard.writeText(blockRef);
            showMessage("块引用已复制到剪贴板");
        } catch (error) {
            console.error('复制块引失败:', error);
            showMessage("复制块引失败");
        }
    }

    private editProject(project: any) {
        const dialog = new ProjectDialog(project.id);
        dialog.show();
    }

    private async setPriority(projectId: string, priority: string) {
        try {
            const projectData = await readProjectData();
            if (projectData[projectId]) {
                projectData[projectId].priority = priority;
                projectData[projectId].updatedTime = new Date().toISOString();
                await writeProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                this.loadProjects();
                showMessage("优先级更新成功");
            } else {
                showMessage("项目不存在");
            }
        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage("操作失败");
        }
    }

    private async setCategory(projectId: string, categoryId: string | null) {
        try {
            const projectData = await readProjectData();
            if (projectData[projectId]) {
                projectData[projectId].categoryId = categoryId;
                projectData[projectId].updatedTime = new Date().toISOString();
                await writeProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                this.loadProjects();

                const categoryName = categoryId ?
                    this.categoryManager.getCategoryById(categoryId)?.name || "未知分类" :
                    "无分类";
                showMessage(`已设置分类为：${categoryName}`);
            } else {
                showMessage("项目不存在");
            }
        } catch (error) {
            console.error('设置分类失败:', error);
            showMessage("操作失败");
        }
    }

    private async setStatus(projectId: string, status: string) {
        try {
            const projectData = await readProjectData();
            if (projectData[projectId]) {
                projectData[projectId].status = status;
                // 保持向后兼容
                projectData[projectId].archived = status === 'archived';
                projectData[projectId].updatedTime = new Date().toISOString();
                await writeProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                this.loadProjects();

                const statusNames = {
                    'active': '正在进行',
                    'someday': '未来也许',
                    'archived': '已归档'
                };
                showMessage(`已设置状态为：${statusNames[status]}`);
            } else {
                showMessage("项目不存在");
            }
        } catch (error) {
            console.error('设置状态失败:', error);
            showMessage("操作失败");
        }
    }

    private async deleteProject(project: any) {
        await confirm(
            "删除项目",
            `确定要删除项目"${project.title}"吗？`,
            async () => {
                try {
                    const projectData = await readProjectData();
                    if (projectData[project.id]) {
                        delete projectData[project.id];
                        await writeProjectData(projectData);
                        window.dispatchEvent(new CustomEvent('projectUpdated'));
                        this.loadProjects();
                        showMessage("项目删除成功");
                    } else {
                        showMessage("项目不存在");
                    }
                } catch (error) {
                    console.error('删除项目失败:', error);
                    showMessage("删除项目失败");
                }
            }
        );
    }

    private async openProject(blockId: string) {
        try {
            const block = await getBlockByID(blockId);
            if (!block) {
                throw new Error('项目不存在');
            }

            openTab({
                app: window.siyuan.ws.app,
                doc: {
                    id: blockId,
                    action: "cb-get-hl"
                },
            });
        } catch (error) {
            console.error('打开项目失败:', error);
            confirm(
                "打开项目失败",
                "项目文档可能已被删除，是否删除相关的项目记录？",
                async () => {
                    await this.deleteProjectByBlockId(blockId);
                },
                () => {
                    showMessage("打开项目失败");
                }
            );
        }
    }

    private async deleteProjectByBlockId(blockId: string) {
        try {
            const projectData = await readProjectData();
            if (projectData[blockId]) {
                delete projectData[blockId];
                await writeProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                showMessage("相关项目记录已删除");
                this.loadProjects();
            } else {
                showMessage("项目记录不存在");
            }
        } catch (error) {
            console.error('删除项目记录失败:', error);
            showMessage("删除项目记录失败");
        }
    }
}
