import { Dialog, showMessage, confirm } from "siyuan";
import { CategoryManager, Category } from "../utils/categoryManager";
import { t } from "../utils/i18n";

export class CategoryManageDialog {
    private dialog: Dialog;
    private categoryManager: CategoryManager;
    private onUpdated?: () => void;
    private draggedElement: HTMLElement | null = null;
    private draggedCategory: Category | null = null;
    private plugin?: any;

    constructor(plugin?: any, onUpdated?: () => void) {
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.onUpdated = onUpdated;
    }

    public show() {
        this.dialog = new Dialog({
            title: t("categoryManagement"),
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
                            ${t("addCategory")}
                        </button>
                        <button class="b3-button b3-button--outline" id="resetCategoriesBtn">
                            <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                            ${t("resetToDefault")}
                        </button>
                    </div>
                    <div class="category-drag-hint">
                        <span>💡 ${t("dragHint")}</span>
                    </div>
                    <div class="categories-list" id="categoriesList">
                        <!-- 分类列表将在这里渲染 -->
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--primary" id="closeBtn">${t("save")}</button>
                </div>
            </div>
            <style>
                .category-manage-dialog {
                    max-height: 580px;
                }
                
                .category-drag-hint {
                    padding: 8px 16px;
                    background: rgba(52, 152, 219, 0.1);
                    border-radius: 4px;
                    margin-bottom: 12px;
                    font-size: 12px;
                    color: #666;
                    text-align: center;
                }
                
                .categories-list {
                    max-height: 400px;
                    overflow-y: auto;
                }
                
                .category-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 16px;
                    margin-bottom: 8px;
                    background: var(--b3-theme-surface);
                    border: 1px solid var(--b3-border-color);
                    border-radius: 6px;
                    cursor: grab;
                    transition: all 0.2s ease;
                    position: relative;
                }
                
                .category-item:hover {
                    background: var(--b3-theme-surface-lighter);
                    transform: translateY(-1px);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                
                .category-item.dragging {
                    opacity: 0.6;
                    cursor: grabbing;
                    transform: rotate(2deg);
                    z-index: 1000;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                }
                
                .category-item.drag-over-top {
                    border-top: 3px solid #3498db;
                    box-shadow: 0 -2px 0 rgba(52, 152, 219, 0.3);
                }
                
                .category-item.drag-over-bottom {
                    border-bottom: 3px solid #3498db;
                    box-shadow: 0 2px 0 rgba(52, 152, 219, 0.3);
                }
                
                .category-drag-handle {
                    cursor: grab;
                    padding: 4px;
                    color: #999;
                    display: flex;
                    align-items: center;
                    margin-right: 12px;
                    transition: color 0.2s ease;
                }
                
                .category-drag-handle:hover {
                    color: #3498db;
                }
                
                .category-drag-handle::before {
                    content: "⋮⋮";
                    font-size: 16px;
                    line-height: 1;
                }
                
                .category-info {
                    display: flex;
                    align-items: center;
                    flex: 1;
                }
                
                .category-visual {
                    display: flex;
                    align-items: center;
                    margin-right: 12px;
                }
                
                .category-icon {
                    font-size: 16px;
                    margin-right: 6px;
                }
                
                .category-color-preview {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    margin-right: 8px;
                }
                
                .category-actions {
                    display: flex;
                    gap: 4px;
                }
            </style>
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
            console.error(t("loadCategoriesFailed"), error);
            categoriesList.innerHTML = `<div class="category-error">${t("loadCategoriesFailed")}</div>`;
        }
    }

    private createCategoryElement(category: Category): HTMLElement {
        const categoryEl = document.createElement('div');
        categoryEl.className = 'category-item';
        categoryEl.draggable = true;
        categoryEl.dataset.categoryId = category.id;
        categoryEl.innerHTML = `
            <div class="category-drag-handle" title="拖拽排序"></div>
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

        // 绑定拖拽事件
        this.bindDragEvents(categoryEl, category);

        // 绑定操作事件
        const editBtn = categoryEl.querySelector('[data-action="edit"]') as HTMLButtonElement;
        const deleteBtn = categoryEl.querySelector('[data-action="delete"]') as HTMLButtonElement;

        editBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showEditCategoryDialog(category);
        });

        deleteBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteCategory(category);
        });

        return categoryEl;
    }

    private bindDragEvents(element: HTMLElement, category: Category) {
        element.addEventListener('dragstart', (e) => {
            this.draggedElement = element;
            this.draggedCategory = category;
            element.classList.add('dragging');

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', element.outerHTML);
            }
        });

        element.addEventListener('dragend', () => {
            element.classList.remove('dragging');
            this.draggedElement = null;
            this.draggedCategory = null;

            // 清除所有拖拽状态
            const allItems = this.dialog.element.querySelectorAll('.category-item');
            allItems.forEach(item => {
                item.classList.remove('drag-over-top', 'drag-over-bottom');
            });
        });

        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }

            if (this.draggedElement && this.draggedElement !== element) {
                // 清除之前的拖拽状态
                element.classList.remove('drag-over-top', 'drag-over-bottom');

                // 获取鼠标相对于元素的位置
                const rect = element.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                const mouseY = e.clientY;

                // 根据鼠标位置决定是在上方还是下方插入
                if (mouseY < midPoint) {
                    element.classList.add('drag-over-top');
                } else {
                    element.classList.add('drag-over-bottom');
                }
            }
        });

        element.addEventListener('dragleave', (e) => {
            // 只有当鼠标真正离开元素时才清除样式
            const rect = element.getBoundingClientRect();
            const x = e.clientX;
            const y = e.clientY;

            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                element.classList.remove('drag-over-top', 'drag-over-bottom');
            }
        });

        element.addEventListener('drop', async (e) => {
            e.preventDefault();
            element.classList.remove('drag-over-top', 'drag-over-bottom');

            if (this.draggedElement && this.draggedCategory && this.draggedElement !== element) {
                // 判断是在上方还是下方插入
                const rect = element.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                const mouseY = e.clientY;
                const insertBefore = mouseY < midPoint;

                await this.handleCategoryReorder(this.draggedCategory, category, insertBefore);
            }
        });
    }

    private async handleCategoryReorder(draggedCategory: Category, targetCategory: Category, insertBefore: boolean = false) {
        try {
            const categories = await this.categoryManager.loadCategories();

            // 找到拖拽项和目标项的索引
            const draggedIndex = categories.findIndex(c => c.id === draggedCategory.id);
            const targetIndex = categories.findIndex(c => c.id === targetCategory.id);

            if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
                return;
            }

            // 重新排序数组
            const reorderedCategories = [...categories];
            const [removed] = reorderedCategories.splice(draggedIndex, 1);

            // 计算插入位置
            let insertIndex = targetIndex;
            if (draggedIndex < targetIndex) {
                insertIndex = targetIndex; // 由于已经移除了拖拽项，索引不需要调整
            }

            if (insertBefore) {
                reorderedCategories.splice(insertIndex, 0, removed);
            } else {
                reorderedCategories.splice(insertIndex + 1, 0, removed);
            }

            // 保存新的排序
            await this.categoryManager.reorderCategories(reorderedCategories);

            // 重新渲染
            this.renderCategories();

            showMessage("分类排序已更新");
        } catch (error) {
            console.error('重新排序分类失败:', error);
            showMessage("排序更新失败，请重试");
        }
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
            t("deleteCategory"),
            t("confirmDeleteCategory", { name: category.name }),
            async () => {
                try {
                    await this.categoryManager.deleteCategory(category.id);
                    showMessage(t("categoryDeleted"));
                    this.renderCategories();
                } catch (error) {
                    console.error(t("deleteCategoryFailed"), error);
                    showMessage(t("deleteCategoryFailed"));
                }
            }
        );
    }

    private async resetCategories() {
        await confirm(
            t("resetCategories"),
            t("confirmResetCategories"),
            async () => {
                try {
                    await this.categoryManager.resetToDefault();
                    showMessage(t("categoriesReset"));
                    this.renderCategories();
                } catch (error) {
                    console.error(t("resetCategoriesFailed"), error);
                    showMessage(t("resetCategoriesFailed"));
                }
            }
        );
    }
}
