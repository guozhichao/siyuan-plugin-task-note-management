import { getFile, putFile } from "../api";

const SORT_CONFIG_PATH = 'data/storage/petal/siyuan-plugin-reminder/sort_methods.json';

interface SortConfig {
    currentSort: string;
    lastUpdated: string;
}

export async function loadSortConfig(): Promise<string> {
    try {
        const content = await getFile(SORT_CONFIG_PATH);
        if (!content) {
            return 'time';
        }

        const config: SortConfig = typeof content === 'string' ? JSON.parse(content) : content;
        return config.currentSort || 'time';
    } catch (error) {
        console.log('加载排序配置失败，使用默认配置:', error);
        return 'time';
    }
}

export async function saveSortConfig(sortMethod: string): Promise<void> {
    try {
        const config: SortConfig = {
            currentSort: sortMethod,
            lastUpdated: new Date().toISOString()
        };

        const content = JSON.stringify(config, null, 2);
        const blob = new Blob([content], { type: 'application/json' });

        await putFile(SORT_CONFIG_PATH, false, blob);

        console.log('排序配置保存成功:', sortMethod);

        // 触发排序配置更新事件
        window.dispatchEvent(new CustomEvent('sortConfigUpdated', {
            detail: { sortMethod }
        }));
    } catch (error) {
        console.error('保存排序配置失败:', error);
        // 即使保存失败，仍然触发事件以保持界面同步
        window.dispatchEvent(new CustomEvent('sortConfigUpdated', {
            detail: { sortMethod }
        }));
    }
}

export function getSortMethodName(sortMethod: string): string {
    const sortNames = {
        'time': '按时间排序',
        'priority': '按优先级排序',
        'title': '按标题排序',
        'created': '按创建时间排序'
    };
    return sortNames[sortMethod] || '按时间排序';
}
