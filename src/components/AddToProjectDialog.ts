import { Dialog, showMessage } from "siyuan";
import { readProjectData, getBlockByID, writeReminderData, updateBlockReminderBookmark, readReminderData } from "../api";
import { t } from "../utils/i18n";

const STORAGE_NAME = "recentlyAddedProjects";

export class AddToProjectDialog {
    private dialog: Dialog;
    private plugin: any; // Using any to avoid circular dependency issues
    private blockIds: string[];
    private projects: any[];
    private recentProjectIds: string[] = [];
    private searchInput: HTMLInputElement;
    private projectListElement: HTMLElement;

    constructor(plugin: any, blockIds: string[]) {
        this.plugin = plugin;
        this.blockIds = blockIds;
    }

    public async show() {
        await this.loadRecentProjects();
        await this.loadProjects();

        const content = this.createDialogElement();

        this.dialog = new Dialog({
            title: t("addToProject"),
            content: `<div class="add-to-project-dialog">${content}</div>`,
            width: "520px",
            destroyCallback: () => {}
        });

        this.searchInput = this.dialog.element.querySelector("#project-search-input");
        this.projectListElement = this.dialog.element.querySelector(".project-list");

        this.renderProjectList(this.projects);
        this.bindEvents();
    }

    private async loadProjects() {
        const projectData = await readProjectData();
        this.projects = Object.values(projectData).filter((p: any) => p && p.status !== 'archived');
    }

    private async loadRecentProjects() {
        const data = await this.plugin.loadData(STORAGE_NAME);
        if (Array.isArray(data)) {
            this.recentProjectIds = data;
        }
    }

    private async saveRecentProjects(projectId: string) {
        const updatedRecent = [projectId, ...this.recentProjectIds.filter(id => id !== projectId)];
        this.recentProjectIds = updatedRecent.slice(0, 10);
        await this.plugin.saveData(STORAGE_NAME, this.recentProjectIds);
    }

    private createDialogElement(): string {
        return `
            <div class="b3-dialog__content">
                <div class="b3-form__group">
                    <input type="search" id="project-search-input" class="b3-text-field" placeholder="${t('searchProjectPlaceholder')}">
                </div>
                <div class="fn__hr"></div>
                <div class="project-list" style="overflow-y: auto; max-height: 300px; min-height: 100px;"></div>
            </div>
        `;
    }

    private renderProjectList(projects: any[]) {
        this.projectListElement.innerHTML = '';

        const renderList = (list: any[], header?: string) => {
            if (list.length > 0) {
                if (header) {
                    const headerEl = document.createElement('div');
                    headerEl.className = 'b3-list-item b3-list-item--hide-action';
                    headerEl.style.opacity = '0.7';
                    headerEl.textContent = header;
                    this.projectListElement.appendChild(headerEl);
                }
                list.forEach(p => {
                    this.projectListElement.appendChild(this.createProjectItem(p));
                });
            }
        };

        const recentProjects = this.recentProjectIds
            .map(id => this.projects.find(p => p.id === id))
            .filter(p => p && projects.some(proj => proj.id === p.id)); // Only show recents that are in the current filtered list

        const otherProjects = projects.filter(p => !this.recentProjectIds.includes(p.id));

        if (this.searchInput.value.trim() === '') {
            renderList(recentProjects, t('recentProjects'));
            if (recentProjects.length > 0 && otherProjects.length > 0) {
                const separator = document.createElement('div');
                separator.className = 'fn__hr';
                this.projectListElement.appendChild(separator);
            }
            renderList(otherProjects, t('allProjects'));
        } else {
            renderList(projects);
        }
    }

    private createProjectItem(project: any): HTMLElement {
        const item = document.createElement('div');
        item.className = 'b3-list-item';
        item.dataset.projectId = project.id;
        item.innerHTML = `<span class="b3-list-item__text">${project.title}</span>`;
        item.addEventListener('click', () => this.handleProjectSelect(project.id));
        return item;
    }

    private bindEvents() {
        this.searchInput.addEventListener('input', () => {
            const searchTerm = this.searchInput.value.toLowerCase();
            const filteredProjects = this.projects.filter(p => p.title.toLowerCase().includes(searchTerm));
            this.renderProjectList(filteredProjects);
        });
    }

    private async handleProjectSelect(projectId: string) {
        try {
            const reminderData = await readReminderData();
            const blocks = [];
            for (const blockId of this.blockIds) {
                const block = await getBlockByID(blockId);
                if (block) {
                    blocks.push(block);
                }
            }

            for (const block of blocks) {
                const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                const newTask = {
                    id: taskId,
                    title: block.content || '未命名任务',
                    note: '',
                    priority: 'none',
                    projectId: projectId,
                    blockId: block.id,
                    docId: block.root_id,
                    completed: false,
                    kanbanStatus: 'todo',
                    createdTime: new Date().toISOString(),
                };
                reminderData[taskId] = newTask;
                await updateBlockReminderBookmark(block.id);
            }

            await writeReminderData(reminderData);
            await this.saveRecentProjects(projectId);

            showMessage(t('addedToProjectSuccess', { count: this.blockIds.length.toString() }));
            this.dialog.destroy();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
            window.dispatchEvent(new CustomEvent('projectUpdated'));

        } catch (error) {
            console.error('Failed to add to project:', error);
            showMessage(t('addedToProjectFailed'), 3000, "error");
        }
    }
}