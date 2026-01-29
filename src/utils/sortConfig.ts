import { Plugin } from "siyuan";
import { i18n } from "./i18n";


export interface SortConfig {
    method: string;
    order: 'asc' | 'desc';
}

export async function loadSortConfig(plugin: Plugin): Promise<SortConfig> {
    try {
        const settings = await (plugin as any).loadSettings();


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
        'time': i18n("sortByTime"),
        'priority': i18n("sortByPriority"),
        'title': i18n("sortByTitle"),
        'created': i18n("sortByCreated")
    };

    const orderNames = {
        'asc': i18n("ascending"),
        'desc': i18n("descending")
    };

    const methodName = methodNames[method] || i18n("sortByTime");
    const orderName = orderNames[order] || i18n("ascending");

    return `${methodName}(${orderName})`;
}
