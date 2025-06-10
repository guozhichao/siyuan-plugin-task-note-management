import { Dialog, showMessage, confirm } from "siyuan";
import { CategoryManager, Category } from "../utils/categoryManager";
import { t } from "../utils/i18n";

export class CategoryManageDialog {
    private dialog: Dialog;
    private categoryManager: CategoryManager;
    private onUpdated?: () => void;

    constructor(onUpdated?: () => void) {
        this.categoryManager = CategoryManager.getInstance();
        this.onUpdated = onUpdated;
    }

    public show() {
        this.dialog = new Dialog({
            title: "管理事件分类",
            content: this.createDialogContent(),
            width: "500px",
            height: "600px"
        });

        this.bindEvents();
        this.renderCategories();
    }

    private createDialogContent(): string {
        return `
            <div class="category-manage-dialog">
                <div class="b3-dialog__content">
                    <div class="category-toolbar">
                        <button class="b3-button b3-button--primary" id="addCategoryBtn">
                            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                            添加分类
                        </button>
                        <button class="b3-button b3-button--outline" id="resetCategoriesBtn">
                            <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                            重置默认
                        </button>
                    </div>
                    <div class="categories-list" id="categoriesList">
                        <!-- 分类列表将在这里渲染 -->
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--primary" id="closeBtn">${t("save")}</button>
                </div>
            </div>
        `;
    }

    private bindEvents() {
        const addCategoryBtn = this.dialog.element.querySelector('#addCategoryBtn') as HTMLButtonElement;
        const resetCategoriesBtn = this.dialog.element.querySelector('#resetCategoriesBtn') as HTMLButtonElement;
        const closeBtn = this.dialog.element.querySelector('#closeBtn') as HTMLButtonElement;

        addCategoryBtn?.addEventListener('click', () => {
            this.showAddCategoryDialog();
        });

        resetCategoriesBtn?.addEventListener('click', () => {
            this.resetCategories();
        });

        closeBtn?.addEventListener('click', () => {
            if (this.onUpdated) {
                this.onUpdated();
            }
            this.dialog.destroy();
        });
    }

    private async renderCategories() {
        const categoriesList = this.dialog.element.querySelector('#categoriesList') as HTMLElement;
        if (!categoriesList) return;

        try {
            const categories = await this.categoryManager.loadCategories();
            categoriesList.innerHTML = '';

            categories.forEach(category => {
                const categoryEl = this.createCategoryElement(category);
                categoriesList.appendChild(categoryEl);
            });
        } catch (error) {
            console.error('渲染分类列表失败:', error);
            categoriesList.innerHTML = '<div class="category-error">加载分类失败</div>';
        }
    }

    private createCategoryElement(category: Category): HTMLElement {
        const categoryEl = document.createElement('div');
        categoryEl.className = 'category-item';
        categoryEl.innerHTML = `
            <div class="category-info">
                <div class="category-visual">
                    <div class="category-icon" style="background-color: ${category.color};">
                        ${category.icon || '📁'}
                    </div>
                    <div class="category-color-preview" style="background-color: ${category.color};"></div>
                </div>
                <div class="category-name">${category.name}</div>
            </div>
            <div class="category-actions">
                <button class="b3-button b3-button--outline category-edit-btn" data-action="edit" data-id="${category.id}" title="编辑分类">
                    <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                </button>
                <button class="b3-button b3-button--outline category-delete-btn" data-action="delete" data-id="${category.id}" title="删除分类">
                    <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                </button>
            </div>
        `;

        // 绑定操作事件
        const editBtn = categoryEl.querySelector('[data-action="edit"]') as HTMLButtonElement;
        const deleteBtn = categoryEl.querySelector('[data-action="delete"]') as HTMLButtonElement;

        editBtn?.addEventListener('click', () => {
            this.showEditCategoryDialog(category);
        });

        deleteBtn?.addEventListener('click', () => {
            this.deleteCategory(category);
        });

        return categoryEl;
    }

    private showAddCategoryDialog() {
        this.showCategoryEditDialog();
    }

    private showEditCategoryDialog(category: Category) {
        this.showCategoryEditDialog(category);
    }

    private showCategoryEditDialog(category?: Category) {
        const isEdit = !!category;
        const editDialog = new Dialog({
            title: isEdit ? "编辑分类" : "添加分类",
            content: `
                <div class="category-edit-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">分类名称</label>
                            <input type="text" id="categoryName" class="b3-text-field" value="${category?.name || ''}" placeholder="请输入分类名称">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">分类颜色</label>
                            <input type="color" id="categoryColor" class="b3-text-field" value="${category?.color || '#3498db'}">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">分类图标</label>
                            <input type="text" id="categoryIcon" class="b3-text-field" value="${category?.icon || ''}" placeholder="请输入emoji图标 (可选)">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">预览</label>
                            <div class="category-preview">
                                <div class="category-dot" id="previewDot" style="background-color: ${category?.color || '#3498db'};"></div>
                                <span id="previewIcon">${category?.icon || '📁'}</span>
                                <span id="previewName">${category?.name || '新分类'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="editCancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="editConfirmBtn">${t("save")}</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "350px"
        });

        // 绑定预览更新事件
        const nameInput = editDialog.element.querySelector('#categoryName') as HTMLInputElement;
        const colorInput = editDialog.element.querySelector('#categoryColor') as HTMLInputElement;
        const iconInput = editDialog.element.querySelector('#categoryIcon') as HTMLInputElement;
        const previewDot = editDialog.element.querySelector('#previewDot') as HTMLElement;
        const previewIcon = editDialog.element.querySelector('#previewIcon') as HTMLElement;
        const previewName = editDialog.element.querySelector('#previewName') as HTMLElement;

        const updatePreview = () => {
            const name = nameInput.value || '新分类';
            const color = colorInput.value;
            const icon = iconInput.value || '📁';

            previewDot.style.backgroundColor = color;
            previewIcon.textContent = icon;
            previewName.textContent = name;
        };

        nameInput.addEventListener('input', updatePreview);
        colorInput.addEventListener('input', updatePreview);
        iconInput.addEventListener('input', updatePreview);

        // 绑定保存和取消事件
        const cancelBtn = editDialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const confirmBtn = editDialog.element.querySelector('#editConfirmBtn') as HTMLButtonElement;

        cancelBtn?.addEventListener('click', () => {
            editDialog.destroy();
        });

        confirmBtn?.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const color = colorInput.value;
            const icon = iconInput.value.trim();

            if (!name) {
                showMessage("请输入分类名称");
                return;
            }

            try {
                if (isEdit && category) {
                    await this.categoryManager.updateCategory(category.id, { name, color, icon });
                    showMessage("分类已更新");
                } else {
                    await this.categoryManager.addCategory({ name, color, icon });
                    showMessage("分类已添加");
                }

                editDialog.destroy();
                this.renderCategories();
            } catch (error) {
                console.error('保存分类失败:', error);
                showMessage("保存分类失败，请重试");
            }
        });
    }

    private async deleteCategory(category: Category) {
        await confirm(
            "删除分类",
            `确定要删除分类"${category.name}"吗？此操作无法撤销。`,
            async () => {
                try {
                    await this.categoryManager.deleteCategory(category.id);
                    showMessage("分类已删除");
                    this.renderCategories();
                } catch (error) {
                    console.error('删除分类失败:', error);
                    showMessage("删除分类失败，请重试");
                }
            }
        );
    }

    private async resetCategories() {
        await confirm(
            "重置分类",
            "确定要重置为默认分类吗？这将删除所有自定义分类。",
            async () => {
                try {
                    await this.categoryManager.resetToDefault();
                    showMessage("已重置为默认分类");
                    this.renderCategories();
                } catch (error) {
                    console.error('重置分类失败:', error);
                    showMessage("重置分类失败，请重试");
                }
            }
        );
    }
}
