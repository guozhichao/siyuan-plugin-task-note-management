import { Dialog, showMessage } from "siyuan";
import { t } from "../utils/i18n";
import { Project, ProjectManager } from "../utils/projectManager";
import { StatusManager } from "../utils/statusManager";

export class ProjectColorDialog {
    private dialog: Dialog;
    private projectManager: ProjectManager;
    private statusManager: StatusManager;
    private onSave: () => void;

    constructor(onSave: () => void, plugin?: any) {
        this.projectManager = ProjectManager.getInstance(plugin);
        this.statusManager = StatusManager.getInstance(plugin);
        this.onSave = onSave;
    }

    public show() {
        this.dialog = new Dialog({
            title: t("setProjectColors"),
            content: `<div class="b3-dialog__content" id="project-color-dialog-content"></div>`,
            width: "520px",
            height: "600px",
        });

        const contentEl = this.dialog.element.querySelector("#project-color-dialog-content");
        this.renderContent(contentEl);
    }

    private async renderContent(container: Element) {
        await this.projectManager.initialize();
        const projectsByStatus = this.projectManager.getProjectsGroupedByStatus();

        let content = '';
        for (const statusId in projectsByStatus) {
            const projects = projectsByStatus[statusId];
            if (projects.length > 0) {
                const status = this.statusManager.getStatusById(statusId);
                const statusName = status ? status.name : t("uncategorized");
                content += `
                    <div class="project-group">
                        <details open>
                            <summary>${statusName} (${projects.length})</summary>
                            <div class="project-list">
                                ${projects.map(p => this.renderProjectItem(p)).join('')}
                            </div>
                        </details>
                    </div>
                `;
            }
        }
        container.innerHTML = content;
        this.addEventListeners(container);
    }

    private renderProjectItem(project: Project): string {
        const color = this.projectManager.getProjectColor(project.id);
        return `
            <div class="project-item" data-project-id="${project.id}">
                <span class="project-name">${project.name}</span>
                <div class="project-color-picker">
                    <input type="color" value="${color}">
                </div>
            </div>
        `;
    }

    private addEventListeners(container: Element) {
        container.querySelectorAll('input[type="color"]').forEach(input => {
            input.addEventListener('change', async (e) => {
                const target = e.target as HTMLInputElement;
                const projectId = (target.closest('.project-item') as HTMLElement).dataset.projectId;
                await this.projectManager.setProjectColor(projectId, target.value);
                showMessage(t("colorSetSuccess"));
                this.onSave();
            });
        });
    }
}