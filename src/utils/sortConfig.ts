import { getFile, putFile } from "../api";
import { t } from "./i18n";

export interface SortConfig {
    method: string;
    order: 'asc' | 'desc';
}

const SORT_CONFIG_PATH = 'data/storage/petal/siyuan-plugin-task-note-management/sort_config.json';

interface SortConfigData {
    currentSort: string;
    order: 'asc' | 'desc';
    lastUpdated: string;
}

export async function loadSortConfig(): Promise<SortConfig> {
    try {
        const content = await getFile(SORT_CONFIG_PATH);
        if (!content) {
            return { method: 'time', order: 'asc' };
        }

        const config: SortConfigData = typeof content === 'string' ? JSON.parse(content) : content;
        return {
            method: config.currentSort || 'time',
            order: config.order || 'asc'
        };
    } catch (error) {
        console.log('加载排序配置失败，使用默认配置:', error);
        return { method: 'time', order: 'asc' };
    }
}

export async function saveSortConfig(method: string, order: 'asc' | 'desc' = 'asc'): Promise<void> {
    try {
        const config: SortConfigData = {
            currentSort: method,
            order: order,
            lastUpdated: new Date().toLocaleDateString()
        };

        const content = JSON.stringify(config, null, 2);
        const blob = new Blob([content], { type: 'application/json' });

        await putFile(SORT_CONFIG_PATH, false, blob);

        console.log('排序配置保存成功:', { method, order });

        // 触发排序配置更新事件
        window.dispatchEvent(new CustomEvent('sortConfigUpdated', {
            detail: { method, order }
        }));
    } catch (error) {
        console.error('保存排序配置失败:', error);
        // 即使保存失败，仍然触发事件以保持界面同步
        window.dispatchEvent(new CustomEvent('sortConfigUpdated', {
            detail: { method, order }
        }));
    }
}

export function getSortMethodName(method: string, order: 'asc' | 'desc' = 'asc'): string {
    const methodNames = {
        'time': t("sortByTime"),
        'priority': t("sortByPriority"),
        'title': t("sortByTitle"),
        'created': t("sortByCreated")
    };

    const orderNames = {
        'asc': t("ascending"),
        'desc': t("descending")
    };

    const methodName = methodNames[method] || t("sortByTime");
    const orderName = orderNames[order] || t("ascending");

    return `${methodName}(${orderName})`;
}
