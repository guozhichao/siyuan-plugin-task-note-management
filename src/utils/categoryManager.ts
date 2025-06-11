import { t } from "./i18n";
import { getFile, putFile } from "../api";

export interface Category {
    id: string;
    name: string;
    color: string;
    icon?: string;
}

const DEFAULT_CATEGORIES: Category[] = [
    { id: 'work', name: '工作', color: '#e74c3c', icon: '🎯' },
    { id: 'study', name: '学习', color: '#3498db', icon: '📖' },
    { id: 'life', name: '生活', color: '#27ae60', icon: '☘️' }
];

const CATEGORIES_FILE_PATH = 'data/storage/petal/siyuan-plugin-task-note-management/categories.json';

export class CategoryManager {
    private static instance: CategoryManager;
    private categories: Category[] = [];

    private constructor() { }

    public static getInstance(): CategoryManager {
        if (!CategoryManager.instance) {
            CategoryManager.instance = new CategoryManager();
        }
        return CategoryManager.instance;
    }

    /**
     * 初始化分类数据
     */
    public async initialize(): Promise<void> {
        try {
            await this.loadCategories();
        } catch (error) {
            console.error('初始化分类失败:', error);
            // 如果加载失败，使用默认分类
            this.categories = [...DEFAULT_CATEGORIES];
            await this.saveCategories();
        }
    }

    /**
     * 加载分类数据
     */
    public async loadCategories(): Promise<Category[]> {
        try {
            const content = await getFile(CATEGORIES_FILE_PATH);
            if (!content) {
                console.log('分类文件不存在，创建默认分类');
                this.categories = [...DEFAULT_CATEGORIES];
                await this.saveCategories();
                return this.categories;
            }

            const categoriesData = typeof content === 'string' ? JSON.parse(content) : content;

            // 验证加载的数据是否为有效的分类数组
            if (Array.isArray(categoriesData) && categoriesData.length > 0) {
                this.categories = categoriesData;
            } else {
                console.log('分类数据无效，使用默认分类');
                this.categories = [...DEFAULT_CATEGORIES];
                await this.saveCategories();
            }
        } catch (error) {
            console.warn('加载分类文件失败，使用默认分类:', error);
            this.categories = [...DEFAULT_CATEGORIES];
            await this.saveCategories();
        }

        return this.categories;
    }

    /**
     * 保存分类数据
     */
    public async saveCategories(): Promise<void> {
        try {
            const content = JSON.stringify(this.categories, null, 2);
            const blob = new Blob([content], { type: 'application/json' });
            await putFile(CATEGORIES_FILE_PATH, false, blob);
        } catch (error) {
            console.error('保存分类失败:', error);
            throw error;
        }
    }

    /**
     * 获取所有分类
     */
    public getCategories(): Category[] {
        return [...this.categories];
    }

    /**
     * 根据ID获取分类
     */
    public getCategoryById(id: string): Category | undefined {
        return this.categories.find(cat => cat.id === id);
    }

    /**
     * 添加新分类
     */
    public async addCategory(category: Omit<Category, 'id'>): Promise<Category> {
        const newCategory: Category = {
            ...category,
            id: `category_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        };

        this.categories.push(newCategory);
        await this.saveCategories();
        return newCategory;
    }

    /**
     * 更新分类
     */
    public async updateCategory(id: string, updates: Partial<Omit<Category, 'id'>>): Promise<boolean> {
        const index = this.categories.findIndex(cat => cat.id === id);
        if (index === -1) {
            return false;
        }

        this.categories[index] = { ...this.categories[index], ...updates };
        await this.saveCategories();
        return true;
    }

    /**
     * 删除分类
     */
    public async deleteCategory(id: string): Promise<boolean> {
        const index = this.categories.findIndex(cat => cat.id === id);
        if (index === -1) {
            return false;
        }

        this.categories.splice(index, 1);
        await this.saveCategories();
        return true;
    }

    /**
     * 重置为默认分类
     */
    public async resetToDefault(): Promise<void> {
        this.categories = [...DEFAULT_CATEGORIES];
        await this.saveCategories();
    }

    /**
     * 获取分类的样式
     */
    public getCategoryStyle(categoryId: string): { backgroundColor: string; borderColor: string } {
        const category = this.getCategoryById(categoryId);
        if (!category) {
            return { backgroundColor: '#95a5a6', borderColor: '#7f8c8d' };
        }

        return {
            backgroundColor: category.color,
            borderColor: this.darkenColor(category.color, 10)
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
}
