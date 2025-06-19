import { Dialog, showMessage } from "siyuan";
import { readProjectData, writeProjectData, getBlockByID } from "../api";
import { getLocalDateString } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { t } from "../utils/i18n";

export class ProjectDialog {
    private dialog: Dialog;
    private blockId: string;
    private categoryManager: CategoryManager;

    constructor(blockId: string) {
        this.blockId = blockId;
        this.categoryManager = CategoryManager.getInstance();
    }

    async show() {
        try {
            // 获取块信息
            const block = await getBlockByID(this.blockId);
            if (!block) {
                showMessage(t("cannotGetDocumentId"));
                return;
            }

            // 检查是否已经是项目
            const projectData = await readProjectData();
            const existingProject = projectData[this.blockId];

            this.dialog = new Dialog({
                title: existingProject ? t("edit") + t("projectNote") : t("setAsProjectNote") || "设置为项目笔记",
                content: this.generateDialogHTML(block.content, existingProject),
                width: "500px",
                height: "630px"
            });

            this.bindEvents();
        } catch (error) {
            console.error('显示项目对话框失败:', error);
            showMessage(t("openModifyDialogFailed"));
        }
    }

    private generateDialogHTML(title: string, existingProject?: any): string {
        const today = getLocalDateString();
        const categories = this.categoryManager.getCategories();

        const categoryOptions = categories.map(cat =>
            `<option value="${cat.id}" ${existingProject?.categoryId === cat.id ? 'selected' : ''}>${cat.icon ? cat.icon + ' ' : ''}${cat.name}</option>`
        ).join('');

        return `
            <div class="project-dialog">
                <div class="project-form">
                    <div class="form-group">
                        <label>${t("eventName") || "项目名称"}:</label>
                        <input type="text" id="projectTitle" class="b3-text-field" style="width: 100%;" value="${existingProject?.title || title}" placeholder="${t("pleaseEnterTitle") || "输入项目名称"}">
                    </div>
                    
                    <div class="form-group">
                        <label>${t("note") || "项目描述"}:</label>
                        <textarea id="projectNote" class="b3-text-field" rows="3" style="width: 100%;" placeholder="${t("enterReminderNote") || "输入项目描述"}">${existingProject?.note || ''}</textarea>
                    </div>
                    
                    <div class="form-group">
                        <label>${t("projectStatus") || "项目状态"}:</label>
                        <select id="projectStatus" class="b3-select">
                            <option value="active" ${(!existingProject?.status || existingProject?.status === 'active') ? 'selected' : ''}>${t("active") || "正在进行"}</option>
                            <option value="someday" ${existingProject?.status === 'someday' ? 'selected' : ''}>${t("someday") || "未来也许"}</option>
                            <option value="archived" ${existingProject?.status === 'archived' ? 'selected' : ''}>${t("archived") || "已归档"}</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>${t("priority") || "优先级"}:</label>
                        <select id="projectPriority" class="b3-select">
                            <option value="none" ${(!existingProject?.priority || existingProject?.priority === 'none') ? 'selected' : ''}>${t("noPriority") || "无"}</option>
                            <option value="low" ${existingProject?.priority === 'low' ? 'selected' : ''}>${t("lowPriority") || "低"}</option>
                            <option value="medium" ${existingProject?.priority === 'medium' ? 'selected' : ''}>${t("mediumPriority") || "中"}</option>
                            <option value="high" ${existingProject?.priority === 'high' ? 'selected' : ''}>${t("highPriority") || "高"}</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>${t("category") || "分类"}:</label>
                        <select id="projectCategory" class="b3-select">
                            <option value="" ${!existingProject?.categoryId ? 'selected' : ''}>${t("noCategory") || "无分类"}</option>
                            ${categoryOptions}
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>${t("reminderDate") || "开始日期"}:</label>
                        <input type="date" id="projectStartDate" class="b3-text-field" value="${existingProject?.startDate || today}">
                    </div>
                    
                    <div class="form-group">
                        <label>${t("endDate") || "截止日期"}:</label>
                        <input type="date" id="projectEndDate" class="b3-text-field" value="${existingProject?.endDate || ''}">
                    </div>
                </div>
                
                <div class="dialog-buttons">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">${t("cancel") || "取消"}</button>
                    <button class="b3-button b3-button--text" id="saveBtn">${t("save") || "保存"}</button>
                </div>
            </div>
            
            <style>
                .project-dialog {
                    padding: 16px;
                }
                
                .project-form {
                    margin-bottom: 16px;
                }
                
                .form-group {
                    margin-bottom: 12px;
                }
                
                .form-group label {
                    display: block;
                    margin-bottom: 4px;
                    font-weight: 500;
                }
                
                .dialog-buttons {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    padding-top: 16px;
                    border-top: 1px solid var(--b3-theme-surface-lighter);
                }
            </style>
        `;
    }

    private bindEvents() {
        const saveBtn = this.dialog.element.querySelector('#saveBtn') as HTMLButtonElement;
        const cancelBtn = this.dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;

        saveBtn?.addEventListener('click', () => {
            this.saveProject();
        });

        cancelBtn?.addEventListener('click', () => {
            this.dialog.destroy();
        });

        // 回车键保存
        this.dialog.element.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.saveProject();
            }
        });
    }

    private async saveProject() {
        try {
            const titleEl = this.dialog.element.querySelector('#projectTitle') as HTMLInputElement;
            const noteEl = this.dialog.element.querySelector('#projectNote') as HTMLTextAreaElement;
            const statusEl = this.dialog.element.querySelector('#projectStatus') as HTMLSelectElement;
            const priorityEl = this.dialog.element.querySelector('#projectPriority') as HTMLSelectElement;
            const categoryEl = this.dialog.element.querySelector('#projectCategory') as HTMLSelectElement;
            const startDateEl = this.dialog.element.querySelector('#projectStartDate') as HTMLInputElement;
            const endDateEl = this.dialog.element.querySelector('#projectEndDate') as HTMLInputElement;

            const title = titleEl.value.trim();
            if (!title) {
                showMessage(t("pleaseEnterTitle"));
                titleEl.focus();
                return;
            }

            const startDate = startDateEl.value;
            const endDate = endDateEl.value;

            // 验证日期
            if (endDate && startDate && endDate < startDate) {
                showMessage(t("endDateCannotBeEarlier"));
                endDateEl.focus();
                return;
            }

            const projectData = await readProjectData();

            const project = {
                id: this.blockId,
                blockId: this.blockId,
                title: title,
                note: noteEl.value.trim(),
                status: statusEl.value,
                priority: priorityEl.value,
                categoryId: categoryEl.value || null,
                startDate: startDate,
                endDate: endDate || null,
                // 保持向后兼容
                archived: statusEl.value === 'archived',
                createdTime: projectData[this.blockId]?.createdTime || new Date().toISOString(),
                updatedTime: new Date().toISOString()
            };

            projectData[this.blockId] = project;
            await writeProjectData(projectData);

            // 触发更新事件
            window.dispatchEvent(new CustomEvent('projectUpdated'));

            showMessage(t("reminderSaved") || "项目保存成功");
            this.dialog.destroy();

        } catch (error) {
            console.error('保存项目失败:', error);
            showMessage(t("saveReminderFailed") || "保存项目失败");
        }
    }
}
