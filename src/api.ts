/**
 * Copyright (c) 2023 frostime. All rights reserved.
 * https://github.com/frostime/sy-plugin-template-vite
 * 
 * See API Document in [API.md](https://github.com/siyuan-note/siyuan/blob/master/API.md)
 * API 文档见 [API_zh_CN.md](https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md)
 */

import { fetchPost, fetchSyncPost, IWebSocketData,openTab,Constants } from "siyuan";

import { getFrontend, openMobileFileById} from 'siyuan';
export async function request(url: string, data: any) {
    let response: IWebSocketData = await fetchSyncPost(url, data);
    let res = response.code === 0 ? response.data : null;
    return res;
}

// **************************************** Noteboook ****************************************
export async function refreshSql() {
    return fetchSyncPost('/api/sqlite/flushTransaction');
}

export async function lsNotebooks(): Promise<IReslsNotebooks> {
    let url = '/api/notebook/lsNotebooks';
    return request(url, '');
}


export async function openNotebook(notebook: NotebookId) {
    let url = '/api/notebook/openNotebook';
    return request(url, { notebook: notebook });
}


export async function closeNotebook(notebook: NotebookId) {
    let url = '/api/notebook/closeNotebook';
    return request(url, { notebook: notebook });
}


export async function renameNotebook(notebook: NotebookId, name: string) {
    let url = '/api/notebook/renameNotebook';
    return request(url, { notebook: notebook, name: name });
}


export async function createNotebook(name: string): Promise<Notebook> {
    let url = '/api/notebook/createNotebook';
    return request(url, { name: name });
}


export async function removeNotebook(notebook: NotebookId) {
    let url = '/api/notebook/removeNotebook';
    return request(url, { notebook: notebook });
}


export async function getNotebookConf(notebook: NotebookId): Promise<IResGetNotebookConf> {
    let data = { notebook: notebook };
    let url = '/api/notebook/getNotebookConf';
    return request(url, data);
}


export async function setNotebookConf(notebook: NotebookId, conf: NotebookConf): Promise<NotebookConf> {
    let data = { notebook: notebook, conf: conf };
    let url = '/api/notebook/setNotebookConf';
    return request(url, data);
}


// **************************************** File Tree ****************************************

export async function getDoc(id: BlockId) {
    let data = {
        id: id
    };
    let url = '/api/filetree/getDoc';
    return request(url, data);
}


export async function createDocWithMd(notebook: NotebookId, path: string, markdown: string): Promise<DocumentId> {
    let data = {
        notebook: notebook,
        path: path,
        markdown: markdown,
    };
    let url = '/api/filetree/createDocWithMd';
    return request(url, data);
}


export async function renameDoc(notebook: NotebookId, path: string, title: string): Promise<DocumentId> {
    let data = {
        doc: notebook,
        path: path,
        title: title
    };
    let url = '/api/filetree/renameDoc';
    return request(url, data);
}

export async function renameDocByID(id: string, title: string): Promise<DocumentId> {
    let data = {
        id: id,
        title: title
    };
    let url = '/api/filetree/renameDocByID';
    return request(url, data);
}


export async function removeDoc(notebook: NotebookId, path: string) {
    let data = {
        notebook: notebook,
        path: path,
    };
    let url = '/api/filetree/removeDoc';
    return request(url, data);
}


export async function moveDocs(fromPaths: string[], toNotebook: NotebookId, toPath: string) {
    let data = {
        fromPaths: fromPaths,
        toNotebook: toNotebook,
        toPath: toPath
    };
    let url = '/api/filetree/moveDocs';
    return request(url, data);
}

export async function moveDocsByID(fromIDs: string[], toID: string) {
    let data = {
        fromIDs: fromIDs,
        toID: toID
    };
    let url = '/api/filetree/moveDocsByID';
    return request(url, data);
}


export async function getHPathByPath(notebook: NotebookId, path: string): Promise<string> {
    let data = {
        notebook: notebook,
        path: path
    };
    let url = '/api/filetree/getHPathByPath';
    return request(url, data);
}


export async function getHPathByID(id: BlockId): Promise<string> {
    let data = {
        id: id
    };
    let url = '/api/filetree/getHPathByID';
    return request(url, data);
}


export async function getIDsByHPath(notebook: NotebookId, path: string): Promise<BlockId[]> {
    let data = {
        notebook: notebook,
        path: path
    };
    let url = '/api/filetree/getIDsByHPath';
    return request(url, data);
}

// **************************************** Asset Files ****************************************

export async function upload(assetsDirPath: string, files: any[]): Promise<IResUpload> {
    let form = new FormData();
    form.append('assetsDirPath', assetsDirPath);
    for (let file of files) {
        form.append('file[]', file);
    }
    let url = '/api/asset/upload';
    return request(url, form);
}

// **************************************** Block ****************************************
type DataType = "markdown" | "dom";
export async function insertBlock(
    dataType: DataType, data: string,
    nextID?: BlockId, previousID?: BlockId, parentID?: BlockId
): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        nextID: nextID,
        previousID: previousID,
        parentID: parentID
    }
    let url = '/api/block/insertBlock';
    return request(url, payload);
}


export async function prependBlock(dataType: DataType, data: string, parentID: BlockId | DocumentId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        parentID: parentID
    }
    let url = '/api/block/prependBlock';
    return request(url, payload);
}


export async function appendBlock(dataType: DataType, data: string, parentID: BlockId | DocumentId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        parentID: parentID
    }
    let url = '/api/block/appendBlock';
    return request(url, payload);
}


export async function updateBlock(dataType: DataType, data: string, id: BlockId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        id: id
    }
    let url = '/api/block/updateBlock';
    return request(url, payload);
}


export async function deleteBlock(id: BlockId): Promise<IResdoOperations[]> {
    let data = {
        id: id
    }
    let url = '/api/block/deleteBlock';
    return request(url, data);
}


export async function moveBlock(id: BlockId, previousID?: PreviousID, parentID?: ParentID): Promise<IResdoOperations[]> {
    let data = {
        id: id,
        previousID: previousID,
        parentID: parentID
    }
    let url = '/api/block/moveBlock';
    return request(url, data);
}


export async function foldBlock(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/foldBlock';
    return request(url, data);
}


export async function unfoldBlock(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/unfoldBlock';
    return request(url, data);
}


export async function getBlockKramdown(id: BlockId, mode: string = 'md'): Promise<IResGetBlockKramdown> {
    let data = {
        id: id,
        mode: mode
    }
    let url = '/api/block/getBlockKramdown';
    return request(url, data);
}
export async function getBlockDOM(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/getBlockDOM';
    return request(url, data);
}

export async function getChildBlocks(id: BlockId): Promise<IResGetChildBlock[]> {
    let data = {
        id: id
    }
    let url = '/api/block/getChildBlocks';
    return request(url, data);
}

export async function transferBlockRef(fromID: BlockId, toID: BlockId, refIDs: BlockId[]) {
    let data = {
        fromID: fromID,
        toID: toID,
        refIDs: refIDs
    }
    let url = '/api/block/transferBlockRef';
    return request(url, data);
}

// **************************************** Attributes ****************************************
export async function setBlockAttrs(id: BlockId, attrs: { [key: string]: string }) {
    let data = {
        id: id,
        attrs: attrs
    }
    let url = '/api/attr/setBlockAttrs';
    return request(url, data);
}


export async function getBlockAttrs(id: BlockId): Promise<{ [key: string]: string }> {
    let data = {
        id: id
    }
    let url = '/api/attr/getBlockAttrs';
    return request(url, data);
}

// **************************************** SQL ****************************************

export async function sql(sql: string): Promise<any[]> {
    let sqldata = {
        stmt: sql,
    };
    let url = '/api/query/sql';
    return request(url, sqldata);
}

export async function getBlockByID(blockId: string): Promise<Block> {
    let sqlScript = `select * from blocks where id ='${blockId}'`;
    let data = await sql(sqlScript);
    return data[0];
}

export async function openBlock(blockId: string) {
    // 检测块是否存在
    const block = await getBlockByID(blockId);
    if (!block) {
        throw new Error('块不存在');
    }
    // 判断是否是移动端
    const isMobile = getFrontend().endsWith('mobile');
    if (isMobile) {
        // 如果是mobile，直接打开块
        openMobileFileById(window.siyuan.ws.app, blockId);
        return;
    }
    // 判断块的类型
    const isDoc = block.type === 'd';
    if (isDoc) { 
        openTab({
            app: window.siyuan.ws.app,
            doc: {
                id: blockId,
                action: ["cb-get-focus","cb-get-scroll"]
            },
            keepCursor: false,
            removeCurrentTab: false
        });
    } else{
        openTab({
            app: window.siyuan.ws.app,
            doc: {
                id: blockId,
                action: ["cb-get-focus", "cb-get-context", "cb-get-hl"]
            },
            keepCursor: false,
            removeCurrentTab: false
        });
        
        }
}

// **************************************** Template ****************************************

export async function render(id: DocumentId, path: string): Promise<IResGetTemplates> {
    let data = {
        id: id,
        path: path
    }
    let url = '/api/template/render';
    return request(url, data);
}


export async function renderSprig(template: string): Promise<string> {
    let url = '/api/template/renderSprig';
    return request(url, { template: template });
}


// **************************************** File ****************************************



export async function getFile(path: string): Promise<any> {
    let data = {
        path: path
    }
    let url = '/api/file/getFile';
    return new Promise((resolve, _) => {
        fetchPost(url, data, (content: any) => {
            resolve(content)
        });
    });
}


/**
 * fetchPost will secretly convert data into json, this func merely return Blob
 * @param endpoint 
 * @returns 
 */
export const getFileBlob = async (path: string): Promise<Blob | null> => {
    const endpoint = '/api/file/getFile'
    let response = await fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
            path: path
        })
    });
    if (!response.ok) {
        return null;
    }
    let data = await response.blob();
    return data;
}


export async function putFile(path: string, isDir: boolean, file: any) {
    let form = new FormData();
    form.append('path', path);
    form.append('isDir', isDir.toString());
    // Copyright (c) 2023, terwer.
    // https://github.com/terwer/siyuan-plugin-importer/blob/v1.4.1/src/api/kernel-api.ts
    form.append('modTime', Date.now().toString());
    form.append('file', file);
    let url = '/api/file/putFile';
    return request(url, form);
}

export async function removeFile(path: string) {
    let data = {
        path: path
    }
    let url = '/api/file/removeFile';
    return request(url, data);
}



export async function readDir(path: string): Promise<IResReadDir> {
    let data = {
        path: path
    }
    let url = '/api/file/readDir';
    return request(url, data);
}


// **************************************** Export ****************************************

export async function exportMdContent(id: DocumentId): Promise<IResExportMdContent> {
    let data = {
        id: id
    }
    let url = '/api/export/exportMdContent';
    return request(url, data);
}

export async function exportResources(paths: string[], name: string): Promise<IResExportResources> {
    let data = {
        paths: paths,
        name: name
    }
    let url = '/api/export/exportResources';
    return request(url, data);
}

// **************************************** Convert ****************************************

export type PandocArgs = string;
export async function pandoc(args: PandocArgs[]) {
    let data = {
        args: args
    }
    let url = '/api/convert/pandoc';
    return request(url, data);
}

// **************************************** Notification ****************************************

// /api/notification/pushMsg
// {
//     "msg": "test",
//     "timeout": 7000
//   }
export async function pushMsg(msg: string, timeout: number = 7000) {
    let payload = {
        msg: msg,
        timeout: timeout
    };
    let url = "/api/notification/pushMsg";
    return request(url, payload);
}

export async function pushErrMsg(msg: string, timeout: number = 7000) {
    let payload = {
        msg: msg,
        timeout: timeout
    };
    let url = "/api/notification/pushErrMsg";
    return request(url, payload);
}

// **************************************** Network ****************************************
export async function forwardProxy(
    url: string, method: string = 'GET', payload: any = {},
    headers: any[] = [], timeout: number = 7000, contentType: string = "text/html"
): Promise<IResForwardProxy> {
    let data = {
        url: url,
        method: method,
        timeout: timeout,
        contentType: contentType,
        headers: headers,
        payload: payload
    }
    let url1 = '/api/network/forwardProxy';
    return request(url1, data);
}


// **************************************** System ****************************************

export async function bootProgress(): Promise<IResBootProgress> {
    return request('/api/system/bootProgress', {});
}

export async function version(): Promise<string> {
    return request('/api/system/version', {});
}

export async function currentTime(): Promise<number> {
    return request('/api/system/currentTime', {});
}

// **************************************** Reminder API ****************************************

export async function writeReminderData(data: any): Promise<any> {
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    return putFile('data/storage/petal/siyuan-plugin-task-note-management/reminder.json', false, blob);
}

export async function readReminderData(): Promise<any> {
    try {
        const content = await getFile('data/storage/petal/siyuan-plugin-task-note-management/reminder.json');
        if (!content || content?.code === 404) {
            await writeReminderData({});
            return {};
        }
        return typeof content === 'string' ? JSON.parse(content) : content;
    } catch (error) {
        console.log('reminder.json文件不存在，返回空对象');
        return {};
    }
}

export async function ensureReminderDataFile(): Promise<void> {
    try {
        await readReminderData();
    } catch (error) {
        // 如果文件不存在，创建空的提醒数据文件
        console.log('创建初始提醒数据文件');
        await writeReminderData({});
    }
}

// **************************************** Notification Record API ****************************************

const NOTIFY_FILE_PATH = "/data/storage/petal/siyuan-plugin-task-note-management/notify.json";

// 读取通知记录数据
export async function readNotifyData(): Promise<Record<string, boolean>> {
    try {
        const content = await getFile(NOTIFY_FILE_PATH);
        if (!content || content?.code === 404) {
            return {};
        }
        return typeof content === 'string' ? JSON.parse(content) : content;
    } catch (error) {
        console.warn('读取通知记录文件失败:', error);
        return {};
    }
}

// 写入通知记录数据
export async function writeNotifyData(data: Record<string, boolean>): Promise<void> {
    try {
        const content = JSON.stringify(data, null, 2);
        const blob = new Blob([content], { type: 'application/json' });
        await putFile(NOTIFY_FILE_PATH, false, blob);
    } catch (error) {
        console.error('写入通知记录文件失败:', error);
        throw error;
    }
}

// 确保通知记录文件存在
export async function ensureNotifyDataFile(): Promise<void> {
    try {
        // 尝试读取文件
        await readNotifyData();
    } catch (error) {
        console.log('通知记录文件不存在，创建新文件');
        try {
            await writeNotifyData({});
        } catch (writeError) {
            console.error('创建通知记录文件失败:', writeError);
        }
    }
}

// 检查某日期是否已提醒过全天事件
export async function hasNotifiedToday(date: string): Promise<boolean> {
    try {
        const notifyData = await readNotifyData();
        return notifyData[date] === true;
    } catch (error) {
        console.warn('检查通知记录失败:', error);
        return false;
    }
}

// 标记某日期已提醒全天事件
export async function markNotifiedToday(date: string): Promise<void> {
    try {
        const notifyData = await readNotifyData();
        notifyData[date] = true;
        await writeNotifyData(notifyData);
    } catch (error) {
        console.error('标记通知记录失败:', error);
    }
}

// **************************************** Bookmark Management ****************************************

/**
 * 设置块的书签
 * @param blockId 块ID
 * @param bookmark 书签内容，如 "⏰"
 */
export async function setBlockBookmark(blockId: string, bookmark: string): Promise<any> {
    const data = {
        id: blockId,
        attrs: {
            bookmark: bookmark
        }
    };
    return request('/api/attr/setBlockAttrs', data);
}

/**
 * 移除块的书签
 * @param blockId 块ID
 */
export async function setBlockDone(blockId: string): Promise<any> {
    // 检测块是否存在
    const block = await getBlockByID(blockId);
    if (!block) {
        return;
    }
    const data = {
        id: blockId,
        attrs: {
            "bookmark": "✅",
            "custom-task-done": formatDate(new Date())

        }
    };
    return request('/api/attr/setBlockAttrs', data);
}
export async function removeBlockBookmark(blockId: string): Promise<any> {
    // 检测块是否存在
    const block = await getBlockByID(blockId);
    if (!block) {
        return;
    }
    const data = {
        id: blockId,
        attrs: {
            "bookmark": "",

        }
    };
    return request('/api/attr/setBlockAttrs', data);
}
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // 月份从0开始，需+1
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
}
/**
 * 检查并更新块的提醒书签状态
 * @param blockId 块ID
 */
export async function updateBlockReminderBookmark(blockId: string): Promise<void> {
    try {
        const reminderData = await readReminderData();

        // 查找该块的所有提醒
        const blockReminders = Object.values(reminderData).filter((reminder: any) =>
            reminder && reminder.blockId === blockId
        );

        // 如果没有提醒，移除书签
        if (blockReminders.length === 0) {
            await removeBlockBookmark(blockId);
            return;
        }

        // 检查提醒状态
        const hasIncompleteReminders = blockReminders.some((reminder: any) => !reminder.completed);
        const allCompleted = blockReminders.length > 0 && blockReminders.every((reminder: any) => reminder.completed);

        if (allCompleted) {
            // 如果所有提醒都已完成，标记块为完成
            await setBlockDone(blockId);
        } else if (hasIncompleteReminders) {
            // 如果有未完成的提醒，确保有⏰书签
            await setBlockBookmark(blockId, "⏰");
        } else {
            // 其他情况，移除书签
            await removeBlockBookmark(blockId);
        }
    } catch (error) {
        console.error('更新块提醒书签失败:', error);
    }
}

// **************************************** Project Management API ****************************************

export async function writeProjectData(data: any): Promise<any> {
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    return putFile('data/storage/petal/siyuan-plugin-task-note-management/project.json', false, blob);
}

export async function readProjectData(): Promise<any> {
    try {
        const content = await getFile('data/storage/petal/siyuan-plugin-task-note-management/project.json');
        if (!content || content?.code === 404) {
            await writeProjectData({});
            return {};
        }
        return typeof content === 'string' ? JSON.parse(content) : content;
    } catch (error) {
        console.log('project.json文件不存在，返回空对象');
        return {};
    }
}

export async function ensureProjectDataFile(): Promise<void> {
    try {
        await readProjectData();
    } catch (error) {
        // 如果文件不存在，创建空的项目数据文件
        console.log('创建初始项目数据文件');
        await writeProjectData({});
    }
}



// **************************************** Riff (闪卡) ****************************************

export async function addRiffCards(blockIDs: string[], deckID: string = Constants.QUICK_DECK_ID): Promise<any> {
    let data = {
        deckID: deckID,
        blockIDs: blockIDs
    };
    let url = '/api/riff/addRiffCards';
    return request(url, data);
}

export async function removeRiffCards(blockIDs: string[], deckID: string = Constants.QUICK_DECK_ID): Promise<any> {
    let data = {
        deckID: deckID,
        blockIDs: blockIDs
    };
    let url = '/api/riff/removeRiffCards';
    return request(url, data);
}

export async function getRiffDecks(): Promise<any> {
    let url = '/api/riff/getRiffDecks';
    return request(url, {});
}

export async function createRiffDeck(name: string): Promise<any> {
    let data = {
        name: name
    };
    let url = '/api/riff/createRiffDeck';
    return request(url, data);
}

export async function removeRiffDeck(deckID: string): Promise<any> {
    let data = {
        deckID: deckID
    };
    let url = '/api/riff/removeRiffDeck';
    return request(url, data);
}

export async function renameRiffDeck(deckID: string, name: string): Promise<any> {
    let data = {
        deckID: deckID,
        name: name
    };
    let url = '/api/riff/renameRiffDeck';
    return request(url, data);
}

export async function getRiffCards(deckID: string): Promise<any> {
    let data = {
        deckID: deckID
    };
    let url = '/api/riff/getRiffCards';
    return request(url, data);
}

