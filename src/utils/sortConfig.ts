import { Plugin } from "siyuan";
import { t } from "./i18n";
import { getFile, removeFile } from "../api";

const SORT_CONFIG_FILE = 'data/storage/petal/siyuan-plugin-task-note-management/sort_config.json';

export interface SortConfig {
    method: string;
    order: 'asc' | 'desc';
}

export async function loadSortConfig(plugin: Plugin): Promise<SortConfig> {
    try {
        const settings = await (plugin as any).loadSettings();

        // 检查是否存在旧的 sort_config.json 文件，如果存在则导入并删除
        try {
            const oldSortContent = await getFile(SORT_CONFIG_FILE);
            if (oldSortContent && oldSortContent.code !== 404) {
                const oldSort = typeof oldSortContent === 'string' ? JSON.parse(oldSortContent) : oldSortContent;
                if (oldSort && typeof oldSort === 'object') {
                    // 合并旧排序配置到新的 settings
                    if (oldSort.method) settings.sortMethod = oldSort.method;
                    if (oldSort.order) settings.sortOrder = oldSort.order;
                    await (plugin as any).saveSettings(settings);
                    // 删除旧文件
                    await removeFile(SORT_CONFIG_FILE);
                    console.log('成功导入并删除旧的 sort_config.json 文件');
                }
            }
        } catch (error) {
            // 如果文件不存在或其他错误，忽略
            console.log('旧的 sort_config.json 文件不存在或已处理');
        }

        return {
            method: settings.sortMethod || 'time',
            order: settings.sortOrder || 'asc'
        };
    } catch (error) {
        console.log('加载排序配置失败，使用默认配置:', error);
        return { method: 'time', order: 'asc' };
    }
}

export async function saveSortConfig(plugin: Plugin, method: string, order: 'asc' | 'desc' = 'asc'): Promise<void> {
    try {
        const settings = await (plugin as any).loadSettings();
        settings.sortMethod = method;
        settings.sortOrder = order;
        await (plugin as any).saveSettings(settings);

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
