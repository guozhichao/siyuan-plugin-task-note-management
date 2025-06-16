import { Dialog, showMessage } from "siyuan";
import { t } from "../utils/i18n";
import { ensureReminderDataFile, updateBlockReminderBookmark } from "../api";
import { getRepeatDescription } from "../utils/repeatUtils";
import { getLocalDateString, getLocalTimeString } from "../utils/dateUtils";
import { RepeatConfig, RepeatSettingsDialog } from "./RepeatSettingsDialog";
import { NotificationDialog } from "./NotificationDialog";
import * as chrono from 'chrono-node';

export interface BlockDetail {
    blockId: string;
    content: string;
    docId?: string;
    date?: string;
    time?: string;
    hasTime?: boolean;
    cleanTitle?: string;
    selectedDate?: string;
    selectedTime?: string;
    priority?: string;
    categoryId?: string;
    note?: string;
}

export interface AutoDetectResult {
    blockId: string;
    content: string;
    date?: string;
    time?: string;
    hasTime?: boolean;
    cleanTitle?: string;
}

export class BatchReminderDialog {
    private plugin: any;
    private chronoParser: any;

    constructor(plugin: any) {
        this.plugin = plugin;
        // 初始化chrono解析器，配置中文支持
        this.chronoParser = chrono.zh.casual.clone();
        this.setupChronoParser();
    }

    // 添加chrono解析器配置方法
    private setupChronoParser() {
        // 配置chrono选项
        this.chronoParser.option = {
            ...this.chronoParser.option,
            forwardDate: false
        };

        // 添加自定义解析器来处理紧凑日期格式
        this.chronoParser.refiners.push({
            refine: (context, results) => {
                results.forEach(result => {
                    const text = result.text;

                    // 处理YYYYMMDD格式
                    const compactMatch = text.match(/^(\d{8})$/);
                    if (compactMatch) {
                        const dateStr = compactMatch[1];
                        const year = parseInt(dateStr.substring(0, 4));
                        const month = parseInt(dateStr.substring(4, 6));
                        const day = parseInt(dateStr.substring(6, 8));

                        // 验证日期有效性
                        if (this.isValidDate(year, month, day)) {
                            result.start.assign('year', year);
                            result.start.assign('month', month);
                            result.start.assign('day', day);
                        }
                    }
                });

                return results;
            }
        });
    }

    // 添加日期有效性验证方法
    private isValidDate(year: number, month: number, day: number): boolean {
        if (year < 1900 || year > 2100) return false;
        if (month < 1 || month > 12) return false;
        if (day < 1 || day > 31) return false;

        const date = new Date(year, month - 1, day);
        return date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day;
    }

    async show(blockIds: string[]) {
        if (blockIds.length === 1) {
            const { ReminderDialog } = await import("./ReminderDialog");
            const dialog = new ReminderDialog(blockIds[0]);
            dialog.show();
        } else {
            // 直接显示智能批量设置
            this.showSmartBatchDialog(blockIds);
        }
    }

    private async showSmartBatchDialog(blockIds: string[]) {
        const autoDetectedData = await this.autoDetectBatchDateTime(blockIds);
        const smartBatchDialog = new SmartBatchDialog(this.plugin, blockIds, autoDetectedData);
        smartBatchDialog.show();
    }

    async autoDetectBatchDateTime(blockIds: string[]): Promise<AutoDetectResult[]> {
        const results = [];

        for (const blockId of blockIds) {
            try {
                const { getBlockByID } = await import("../api");
                const block = await getBlockByID(blockId);

                if (block) {
                    const autoDetected = this.autoDetectDateTimeFromTitle(block.content);
                    results.push({
                        blockId,
                        content: block.content,
                        ...autoDetected
                    });
                }
            } catch (error) {
                console.error(`获取块 ${blockId} 失败:`, error);
                results.push({
                    blockId,
                    content: '无法获取块内容',
                    cleanTitle: '无法获取块内容'
                });
            }
        }

        return results;
    }

    private async getBlockDetails(blockIds: string[]): Promise<BlockDetail[]> {
        const details = [];

        for (const blockId of blockIds) {
            try {
                const { getBlockByID } = await import("../api");
                const block = await getBlockByID(blockId);

                if (block) {
                    const autoDetected = this.autoDetectDateTimeFromTitle(block.content);
                    details.push({
                        blockId,
                        content: block.content,
                        docId: block.root_id || blockId,
                        ...autoDetected,
                        selectedDate: autoDetected.date || getLocalDateString(),
                        selectedTime: autoDetected.time || '',
                        hasTime: autoDetected.hasTime || false,
                        priority: 'none',
                        categoryId: '',
                        note: ''
                    });
                }
            } catch (error) {
                console.error(`获取块 ${blockId} 详情失败:`, error);
            }
        }

        return details;
    }

    private autoDetectDateTimeFromTitle(title: string): { date?: string; time?: string; hasTime?: boolean; cleanTitle?: string } {
        const parseResult = this.parseNaturalDateTime(title);

        if (!parseResult.date) {
            return { cleanTitle: title };
        }

        let cleanTitle = title;
        const timeExpressions = [
            /今天|今日/gi,
            /明天|明日/gi,
            /后天/gi,
            /大后天/gi,
            /下?周[一二三四五六日天]/gi,
            /下?星期[一二三四五六日天]/gi,
            /\d+天[后以]后/gi,
            /\d+小时[后以]后/gi,
        ];

        timeExpressions.forEach(pattern => {
            cleanTitle = cleanTitle.replace(pattern, '').trim();
        });

        cleanTitle = cleanTitle.replace(/\s+/g, ' ').replace(/^[，。、\s]+|[，。、\s]+$/g, '');

        return {
            ...parseResult,
            cleanTitle: cleanTitle || title
        };
    }

    private parseNaturalDateTime(text: string): { date?: string; time?: string; hasTime?: boolean } {
        try {
            const results = this.chronoParser.parse(text, new Date(), { forwardDate: false });

            if (results.length === 0) {
                return {};
            }

            const result = results[0];
            const parsedDate = result.start.date();

            const date = parsedDate.toISOString().split('T')[0];
            const hasTime = result.start.isCertain('hour') && result.start.isCertain('minute');
            let time = undefined;

            if (hasTime) {
                const hours = parsedDate.getHours().toString().padStart(2, '0');
                const minutes = parsedDate.getMinutes().toString().padStart(2, '0');
                time = `${hours}:${minutes}`;
            }

            return { date, time, hasTime };
        } catch (error) {
            console.error('解析自然语言日期时间失败:', error);
            return {};
        }
    }
}

class SmartBatchDialog {
    private plugin: any;
    private blockIds: string[];
    private autoDetectedData: AutoDetectResult[];
    private blockSettings: Map<string, BlockSetting> = new Map();

    constructor(plugin: any, blockIds: string[], autoDetectedData: AutoDetectResult[]) {
        this.plugin = plugin;
        this.blockIds = blockIds;
        this.autoDetectedData = autoDetectedData;

        // 初始化每个块的设置
        this.initializeBlockSettings();
    }

    private initializeBlockSettings() {
        this.autoDetectedData.forEach(data => {
            this.blockSettings.set(data.blockId, {
                blockId: data.blockId,
                content: data.content,
                cleanTitle: data.cleanTitle || data.content,
                date: data.date || getLocalDateString(),
                time: data.time || '',
                hasTime: data.hasTime || false,
                priority: 'none',
                categoryId: '',
                note: '',
                repeatConfig: {
                    enabled: false,
                    type: 'daily',
                    interval: 1,
                    endType: 'never'
                }
            });
        });
    }

    show() {
        const dialog = new Dialog({
            title: `✨ 智能批量设置 (${this.blockIds.length}个块)`,
            content: this.buildSmartBatchContent(),
            width: "700px",
            height: "700px"
        });

        this.renderBlockList(dialog);
        this.bindSmartBatchEvents(dialog);
    }

    private buildSmartBatchContent(): string {
        return `
            <div class="smart-batch-dialog">
                <div class="b3-dialog__content">
                    <div class="fn__hr"></div>
                    
                    <!-- 批量操作面板 -->
                    <div class="batch-operations-panel">
                        <div class="batch-operations-header">
                            <h3>🚀 批量操作</h3>
                            <div class="batch-toggle">
                                <button type="button" id="batchToggleBtn" class="b3-button b3-button--outline">
                                    <span>展开</span>
                                    <svg class="b3-button__icon toggle-icon"><use xlink:href="#iconDown"></use></svg>
                                </button>
                            </div>
                        </div>
                        <div class="batch-operations-content" id="batchOperationsContent" style="display: none;">
                            <div class="batch-operation-row">
                                <div class="batch-operation-item">
                                    <label class="b3-form__label">批量设置分类</label>
                                    <div class="batch-category-container">
                                        <div class="category-selector-compact" id="batchCategorySelector">
                                            <!-- 分类选择器将在这里渲染 -->
                                        </div>
                                        <button type="button" id="batchApplyCategoryBtn" class="b3-button b3-button--primary" disabled>
                                            应用到全部
                                        </button>
                                    </div>
                                </div>
                                <div class="batch-operation-item">
                                    <label class="b3-form__label">批量设置优先级</label>
                                    <div class="batch-priority-container">
                                        <div class="priority-selector-compact" id="batchPrioritySelector">
                                            <div class="priority-option-compact" data-priority="high">
                                                <div class="priority-dot high"></div>
                                                <span>高</span>
                                            </div>
                                            <div class="priority-option-compact" data-priority="medium">
                                                <div class="priority-dot medium"></div>
                                                <span>中</span>
                                            </div>
                                            <div class="priority-option-compact" data-priority="low">
                                                <div class="priority-dot low"></div>
                                                <span>低</span>
                                            </div>
                                            <div class="priority-option-compact" data-priority="none">
                                                <div class="priority-dot none"></div>
                                                <span>无</span>
                                            </div>
                                        </div>
                                        <button type="button" id="batchApplyPriorityBtn" class="b3-button b3-button--primary" disabled>
                                            应用到全部
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="batch-operation-row">
                                <div class="batch-operation-item full-width">
                                    <label class="b3-form__label">批量设置日期</label>
                                    <div class="batch-date-container">
                                        <input type="date" id="batchDateInput" class="b3-text-field" value="${getLocalDateString()}">
                                        <button type="button" id="batchApplyDateBtn" class="b3-button b3-button--primary">
                                            应用日期到全部
                                        </button>
                                        <button type="button" id="batchNlDateBtn" class="b3-button b3-button--outline" title="智能日期识别">
                                            ✨
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="fn__hr"></div>
                    
                    <div class="block-list-header">
                        <div class="list-summary">
                            <span class="summary-text">共 ${this.blockIds.length} 个块，其中 ${this.autoDetectedData.filter(d => d.date).length} 个已自动识别日期</span>
                        </div>
                        <div class="list-actions">
                            <button type="button" id="selectAllBtn" class="b3-button b3-button--outline">
                                全选
                            </button>
                            <button type="button" id="deselectAllBtn" class="b3-button b3-button--outline">
                                取消全选
                            </button>
                        </div>
                    </div>
                    <div class="block-list-container" id="blockListContainer">
                        <!-- 块列表将在这里渲染 -->
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="smartBatchCancelBtn">${t("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="smartBatchConfirmBtn">批量设置提醒</button>
                </div>
            </div>
        `;
    }

    private renderBlockList(dialog: Dialog) {
        const container = dialog.element.querySelector('#blockListContainer') as HTMLElement;
        if (!container) return;

        const listHtml = this.autoDetectedData.map(data => {
            const setting = this.blockSettings.get(data.blockId);
            const dateStatus = data.date ? '✅' : '❌';
            const dateDisplay = setting?.date ? new Date(setting.date + 'T00:00:00').toLocaleDateString('zh-CN') : '未设置';
            const timeDisplay = setting?.hasTime && setting.time ? setting.time : '全天';

            // 获取分类和优先级显示
            const categoryDisplay = this.getCategoryDisplay(setting?.categoryId);
            const priorityDisplay = this.getPriorityDisplay(setting?.priority);

            return `
                <div class="block-item" data-block-id="${data.blockId}">
                    <div class="block-checkbox">
                        <label class="b3-checkbox">
                            <input type="checkbox" class="block-select-checkbox" data-block-id="${data.blockId}" checked>
                            <span class="b3-checkbox__graphic"></span>
                        </label>
                    </div>
                    <div class="block-info">
                        <div class="block-status">${dateStatus}</div>
                        <div class="block-content">
                            <div class="block-title">${setting?.cleanTitle || data.content}</div>
                            <div class="block-meta">
                                <div class="block-datetime">
                                    <span class="block-date">${dateDisplay}</span>
                                    <span class="block-time">${timeDisplay}</span>
                                </div>
                                <div class="block-attributes">
                                    <span class="block-category">${categoryDisplay}</span>
                                    <span class="block-priority">${priorityDisplay}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="block-actions">
                        <button type="button" class="b3-button b3-button--outline block-edit-btn" data-block-id="${data.blockId}">
                            ⚙️ 设置
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="block-list">
                ${listHtml}
            </div>
        `;
    }

    private getCategoryDisplay(categoryId?: string): string {
        if (!categoryId) return '📂 无分类';

        try {
            const categories = this.plugin.categoryManager.getCategories();
            const category = categories.find(c => c.id === categoryId);
            if (category) {
                return `<span style="background-color: ${category.color}; padding: 2px 6px; border-radius: 3px; font-size: 12px;">${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
            }
        } catch (error) {
            console.error('获取分类显示失败:', error);
        }

        return '📂 无分类';
    }

    private getPriorityDisplay(priority?: string): string {
        const priorityMap = {
            'high': '<span class="priority-badge high">🔴 高</span>',
            'medium': '<span class="priority-badge medium">🟡 中</span>',
            'low': '<span class="priority-badge low">🟢 低</span>',
            'none': '<span class="priority-badge none">⚪ 无</span>'
        };

        return priorityMap[priority as keyof typeof priorityMap] || priorityMap.none;
    }

    private bindSmartBatchEvents(dialog: Dialog) {
        const cancelBtn = dialog.element.querySelector('#smartBatchCancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#smartBatchConfirmBtn') as HTMLButtonElement;
        const container = dialog.element.querySelector('#blockListContainer') as HTMLElement;

        // 批量操作相关元素
        const batchToggleBtn = dialog.element.querySelector('#batchToggleBtn') as HTMLButtonElement;
        const batchOperationsContent = dialog.element.querySelector('#batchOperationsContent') as HTMLElement;
        const batchApplyCategoryBtn = dialog.element.querySelector('#batchApplyCategoryBtn') as HTMLButtonElement;
        const batchApplyPriorityBtn = dialog.element.querySelector('#batchApplyPriorityBtn') as HTMLButtonElement;
        const batchApplyDateBtn = dialog.element.querySelector('#batchApplyDateBtn') as HTMLButtonElement;
        const batchNlDateBtn = dialog.element.querySelector('#batchNlDateBtn') as HTMLButtonElement;
        const selectAllBtn = dialog.element.querySelector('#selectAllBtn') as HTMLButtonElement;
        const deselectAllBtn = dialog.element.querySelector('#deselectAllBtn') as HTMLButtonElement;

        // 渲染批量分类选择器
        this.renderBatchCategorySelector(dialog);

        // 批量操作面板切换
        batchToggleBtn?.addEventListener('click', () => {
            const isVisible = batchOperationsContent.style.display !== 'none';
            batchOperationsContent.style.display = isVisible ? 'none' : 'block';
            const toggleIcon = batchToggleBtn.querySelector('.toggle-icon use');
            const toggleText = batchToggleBtn.querySelector('span');
            if (toggleIcon && toggleText) {
                toggleIcon.setAttribute('xlink:href', isVisible ? '#iconDown' : '#iconUp');
                toggleText.textContent = isVisible ? '展开' : '收起';
            }
        });

        // 全选/取消全选
        selectAllBtn?.addEventListener('click', () => {
            const checkboxes = dialog.element.querySelectorAll('.block-select-checkbox') as NodeListOf<HTMLInputElement>;
            checkboxes.forEach(checkbox => checkbox.checked = true);
        });

        deselectAllBtn?.addEventListener('click', () => {
            const checkboxes = dialog.element.querySelectorAll('.block-select-checkbox') as NodeListOf<HTMLInputElement>;
            checkboxes.forEach(checkbox => checkbox.checked = false);
        });

        // 批量分类选择
        const batchCategorySelector = dialog.element.querySelector('#batchCategorySelector') as HTMLElement;
        batchCategorySelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option-compact') as HTMLElement;
            if (option) {
                batchCategorySelector.querySelectorAll('.category-option-compact').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                batchApplyCategoryBtn.disabled = false;
            }
        });

        // 批量优先级选择
        const batchPrioritySelector = dialog.element.querySelector('#batchPrioritySelector') as HTMLElement;
        batchPrioritySelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.priority-option-compact') as HTMLElement;
            if (option) {
                batchPrioritySelector.querySelectorAll('.priority-option-compact').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                batchApplyPriorityBtn.disabled = false;
            }
        });

        // 批量应用分类
        batchApplyCategoryBtn?.addEventListener('click', () => {
            this.batchApplyCategory(dialog);
        });

        // 批量应用优先级
        batchApplyPriorityBtn?.addEventListener('click', () => {
            this.batchApplyPriority(dialog);
        });

        // 批量应用日期
        batchApplyDateBtn?.addEventListener('click', () => {
            this.batchApplyDate(dialog);
        });

        // 批量智能日期识别
        batchNlDateBtn?.addEventListener('click', () => {
            this.showBatchNaturalLanguageDialog(dialog);
        });

        // 取消按钮
        cancelBtn?.addEventListener('click', () => {
            dialog.destroy();
        });

        // 确认按钮
        confirmBtn?.addEventListener('click', () => {
            this.saveBatchReminders(dialog);
        });

        // 设置按钮事件
        container?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const editBtn = target.closest('.block-edit-btn') as HTMLElement;
            if (editBtn) {
                const blockId = editBtn.getAttribute('data-block-id');
                if (blockId) {
                    this.showBlockEditDialog(dialog, blockId);
                }
            }
        });
    }
    private showBatchNaturalLanguageDialog(dialog: Dialog) {
        const nlDialog = new Dialog({
            title: "✨ 批量智能日期识别",
            content: `
                <div class="nl-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">输入自然语言描述</label>
                            <input type="text" id="batchNlInput" class="b3-text-field" placeholder="例如：明天下午3点、下周五、3天后等" style="width: 100%;" autofocus>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">识别结果预览</label>
                            <div id="batchNlPreview" class="nl-preview">请输入日期时间描述</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">应用范围</label>
                            <div id="batchNlScope" class="nl-scope">将应用到所有选中的块</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="batchNlCancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="batchNlConfirmBtn" disabled>批量应用</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "350px"
        });

        this.bindBatchNaturalLanguageEvents(nlDialog, dialog);
    }
    private bindBatchNaturalLanguageEvents(nlDialog: Dialog, parentDialog: Dialog) {
        const nlInput = nlDialog.element.querySelector('#batchNlInput') as HTMLInputElement;
        const nlPreview = nlDialog.element.querySelector('#batchNlPreview') as HTMLElement;
        const nlScope = nlDialog.element.querySelector('#batchNlScope') as HTMLElement;
        const nlCancelBtn = nlDialog.element.querySelector('#batchNlCancelBtn') as HTMLButtonElement;
        const nlConfirmBtn = nlDialog.element.querySelector('#batchNlConfirmBtn') as HTMLButtonElement;

        const selectedCount = this.getSelectedBlockIds(parentDialog).length;
        nlScope.textContent = `将应用到 ${selectedCount} 个选中的块`;

        let currentParseResult: { date?: string; time?: string; hasTime?: boolean } = {};

        // 实时解析输入
        const updatePreview = () => {
            const text = nlInput.value.trim();
            if (!text) {
                nlPreview.textContent = '请输入日期时间描述';
                nlPreview.className = 'nl-preview';
                nlConfirmBtn.disabled = true;
                return;
            }

            const batchDialog = new BatchReminderDialog(this.plugin);
            currentParseResult = (batchDialog as any).parseNaturalDateTime(text);

            if (currentParseResult.date) {
                const dateStr = new Date(currentParseResult.date + 'T00:00:00').toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'long'
                });

                let previewText = `📅 ${dateStr}`;
                if (currentParseResult.time) {
                    previewText += ` ⏰ ${currentParseResult.time}`;
                }

                nlPreview.textContent = previewText;
                nlPreview.className = 'nl-preview nl-preview--success';
                nlConfirmBtn.disabled = selectedCount === 0;
            } else {
                nlPreview.textContent = '❌ 无法识别日期时间，请尝试其他表达方式';
                nlPreview.className = 'nl-preview nl-preview--error';
                nlConfirmBtn.disabled = true;
            }
        };

        nlInput.addEventListener('input', updatePreview);
        nlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !nlConfirmBtn.disabled) {
                this.applyBatchNaturalLanguageResult(parentDialog, currentParseResult);
                nlDialog.destroy();
            }
        });

        nlCancelBtn.addEventListener('click', () => {
            nlDialog.destroy();
        });

        nlConfirmBtn.addEventListener('click', () => {
            this.applyBatchNaturalLanguageResult(parentDialog, currentParseResult);
            nlDialog.destroy();
        });

        setTimeout(() => {
            nlInput.focus();
        }, 100);
    }
    private applyBatchNaturalLanguageResult(dialog: Dialog, result: { date?: string; time?: string; hasTime?: boolean }) {
        if (!result.date) return;

        const selectedBlocks = this.getSelectedBlockIds(dialog);
        if (selectedBlocks.length === 0) {
            showMessage('请先选择要应用的块');
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.date = result.date!;
                if (result.hasTime && result.time) {
                    setting.time = result.time;
                    setting.hasTime = true;
                } else {
                    setting.time = '';
                    setting.hasTime = false;
                }
            }
        });

        this.updateBlockListDisplay(dialog);

        const dateStr = new Date(result.date + 'T00:00:00').toLocaleDateString('zh-CN');
        showMessage(`✨ 已为 ${selectedBlocks.length} 个块设置日期时间：${dateStr}${result.time ? ` ${result.time}` : ''}`);
    }
    private getSelectedBlockIds(dialog: Dialog): string[] {
        const checkboxes = dialog.element.querySelectorAll('.block-select-checkbox:checked') as NodeListOf<HTMLInputElement>;
        return Array.from(checkboxes).map(checkbox => checkbox.getAttribute('data-block-id')).filter(Boolean) as string[];
    }

    private updateBlockListDisplay(dialog: Dialog) {
        // 重新渲染块列表以反映更新
        this.renderBlockList(dialog);
        // 重新绑定事件（只绑定块相关的事件）
        this.bindBlockListEvents(dialog);
    }

    private bindBlockListEvents(dialog: Dialog) {
        const container = dialog.element.querySelector('#blockListContainer') as HTMLElement;

        // 设置按钮事件
        container?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const editBtn = target.closest('.block-edit-btn') as HTMLElement;
            if (editBtn) {
                const blockId = editBtn.getAttribute('data-block-id');
                if (blockId) {
                    this.showBlockEditDialog(dialog, blockId);
                }
            }
        });
    }
    private showBlockEditDialog(parentDialog: Dialog, blockId: string) {
        const setting = this.blockSettings.get(blockId);
        if (!setting) return;

        const blockEditDialog = new BlockEditDialog(this.plugin, setting, (updatedSetting: BlockSetting) => {
            this.blockSettings.set(blockId, updatedSetting);
            this.updateBlockDisplay(parentDialog, blockId);
        });

        blockEditDialog.show();
    }

    private async renderBatchCategorySelector(dialog: Dialog) {
        const categorySelector = dialog.element.querySelector('#batchCategorySelector') as HTMLElement;
        if (!categorySelector) return;

        try {
            const categories = this.plugin.categoryManager.getCategories();

            categorySelector.innerHTML = '';

            const noCategoryEl = document.createElement('div');
            noCategoryEl.className = 'category-option-compact';
            noCategoryEl.setAttribute('data-category', '');
            noCategoryEl.innerHTML = `<span>无分类</span>`;
            categorySelector.appendChild(noCategoryEl);

            categories.forEach(category => {
                const categoryEl = document.createElement('div');
                categoryEl.className = 'category-option-compact';
                categoryEl.setAttribute('data-category', category.id);
                categoryEl.style.backgroundColor = category.color;
                categoryEl.innerHTML = `<span>${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
                categorySelector.appendChild(categoryEl);
            });

        } catch (error) {
            console.error('渲染批量分类选择器失败:', error);
            categorySelector.innerHTML = '<div class="category-error">加载分类失败</div>';
        }
    }

    private batchApplyCategory(dialog: Dialog) {
        const selectedCategory = dialog.element.querySelector('#batchCategorySelector .category-option-compact.selected') as HTMLElement;
        if (!selectedCategory) return;

        const categoryId = selectedCategory.getAttribute('data-category') || '';
        const selectedBlocks = this.getSelectedBlockIds(dialog);

        if (selectedBlocks.length === 0) {
            showMessage('请先选择要应用的块');
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.categoryId = categoryId;
            }
        });

        this.updateBlockListDisplay(dialog);
        showMessage(`✅ 已为 ${selectedBlocks.length} 个块设置分类`);
    }

    private batchApplyPriority(dialog: Dialog) {
        const selectedPriority = dialog.element.querySelector('#batchPrioritySelector .priority-option-compact.selected') as HTMLElement;
        if (!selectedPriority) return;

        const priority = selectedPriority.getAttribute('data-priority') || 'none';
        const selectedBlocks = this.getSelectedBlockIds(dialog);

        if (selectedBlocks.length === 0) {
            showMessage('请先选择要应用的块');
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.priority = priority;
            }
        });

        this.updateBlockListDisplay(dialog);
        showMessage(`✅ 已为 ${selectedBlocks.length} 个块设置优先级`);
    }

    private batchApplyDate(dialog: Dialog) {
        const dateInput = dialog.element.querySelector('#batchDateInput') as HTMLInputElement;
        if (!dateInput.value) {
            showMessage('请先选择日期');
            return;
        }

        const selectedBlocks = this.getSelectedBlockIds(dialog);
        if (selectedBlocks.length === 0) {
            showMessage('请先选择要应用的块');
            return;
        }

        selectedBlocks.forEach(blockId => {
            const setting = this.blockSettings.get(blockId);
            if (setting) {
                setting.date = dateInput.value;
            }
        });

        this.updateBlockListDisplay(dialog);
        showMessage(`✅ 已为 ${selectedBlocks.length} 个块设置日期`);
    }

    private updateBlockDisplay(dialog: Dialog, blockId: string) {
        const setting = this.blockSettings.get(blockId);
        if (!setting) return;

        const blockItem = dialog.element.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement;
        if (!blockItem) return;

        const dateDisplay = setting.date ? new Date(setting.date + 'T00:00:00').toLocaleDateString('zh-CN') : '未设置';
        const timeDisplay = setting.hasTime && setting.time ? setting.time : '全天';

        const blockDate = blockItem.querySelector('.block-date') as HTMLElement;
        const blockTime = blockItem.querySelector('.block-time') as HTMLElement;

        if (blockDate) blockDate.textContent = dateDisplay;
        if (blockTime) blockTime.textContent = timeDisplay;
    }

    private async saveBatchReminders(dialog: Dialog) {
        try {
            const { readReminderData, writeReminderData } = await import("../api");
            const reminderData = await readReminderData();

            let successCount = 0;
            let failureCount = 0;
            const successfulBlockIds: string[] = [];

            for (const [blockId, setting] of this.blockSettings) {
                try {
                    if (!setting.date) {
                        failureCount++;
                        continue;
                    }

                    const reminderId = `${blockId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                    const reminder = {
                        id: reminderId,
                        blockId: blockId,
                        docId: blockId,
                        title: setting.cleanTitle,
                        date: setting.date,
                        completed: false,
                        priority: setting.priority,
                        categoryId: setting.categoryId || undefined,
                        pomodoroCount: 0,
                        createdAt: new Date().toISOString(),
                        repeat: setting.repeatConfig?.enabled ? setting.repeatConfig : undefined
                    };

                    if (setting.hasTime && setting.time) {
                        reminder.time = setting.time;
                    }

                    if (setting.note) {
                        reminder.note = setting.note;
                    }

                    reminderData[reminderId] = reminder;
                    successCount++;
                    successfulBlockIds.push(blockId);
                } catch (error) {
                    console.error(`设置块 ${blockId} 提醒失败:`, error);
                    failureCount++;
                }
            }

            await writeReminderData(reminderData);

            // 为所有成功创建提醒的块添加书签
            for (const blockId of successfulBlockIds) {
                try {
                    await updateBlockReminderBookmark(blockId);
                } catch (error) {
                    console.error(`更新块 ${blockId} 书签失败:`, error);
                }
            }

            if (successCount > 0) {
                showMessage(`✨ 批量设置完成！成功：${successCount}个${failureCount > 0 ? `，失败：${failureCount}个` : ''}`);
            } else {
                showMessage(t("batchSetFailed"));
            }

            dialog.destroy();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('保存批量提醒失败:', error);
            showMessage(t("batchSaveFailed"));
        }
    }
}

interface BlockSetting {
    blockId: string;
    content: string;
    cleanTitle: string;
    date: string;
    time: string;
    hasTime: boolean;
    priority: string;
    categoryId: string;
    note: string;
    repeatConfig: RepeatConfig;
}

class BlockEditDialog {
    private plugin: any;
    private setting: BlockSetting;
    private onSave: (setting: BlockSetting) => void;

    constructor(plugin: any, setting: BlockSetting, onSave: (setting: BlockSetting) => void) {
        this.plugin = plugin;
        this.setting = { ...setting }; // 创建副本
        this.onSave = onSave;
    }

    show() {
        const dialog = new Dialog({
            title: `⚙️ 设置提醒 - ${this.setting.cleanTitle}`,
            content: this.buildEditContent(),
            width: "500px",
            height: "650px"
        });

        this.renderCategorySelector(dialog);
        this.updateRepeatDescription(dialog);
        this.bindEditEvents(dialog);
    }

    private buildEditContent(): string {
        const currentTime = getLocalTimeString();

        return `
            <div class="block-edit-dialog">
                <div class="b3-dialog__content">
                    <div class="fn__hr"></div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">块内容</label>
                        <div class="block-content-display">${this.setting.content}</div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderDate")}</label>
                        <div class="title-input-container" style="display: flex; gap: 8px;">
                            <input type="date" id="editDate" class="b3-text-field" value="${this.setting.date}" style="flex: 1;">
                            <button type="button" id="editNlBtn" class="b3-button b3-button--outline" title="✨ 智能日期识别">
                                ✨
                            </button>
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">事件分类</label>
                        <div class="category-selector" id="editCategorySelector">
                            <!-- 分类选择器将在这里渲染 -->
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("priority")}</label>
                        <div class="priority-selector" id="editPrioritySelector">
                            <div class="priority-option ${this.setting.priority === 'high' ? 'selected' : ''}" data-priority="high">
                                <div class="priority-dot high"></div>
                                <span>${t("highPriority")}</span>
                            </div>
                            <div class="priority-option ${this.setting.priority === 'medium' ? 'selected' : ''}" data-priority="medium">
                                <div class="priority-dot medium"></div>
                                <span>${t("mediumPriority")}</span>
                            </div>
                            <div class="priority-option ${this.setting.priority === 'low' ? 'selected' : ''}" data-priority="low">
                                <div class="priority-dot low"></div>
                                <span>${t("lowPriority")}</span>
                            </div>
                            <div class="priority-option ${this.setting.priority === 'none' ? 'selected' : ''}" data-priority="none">
                                <div class="priority-dot none"></div>
                                <span>${t("noPriority")}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderTimeOptional")}</label>
                        <input type="time" id="editTime" class="b3-text-field" value="${this.setting.time}" ${!this.setting.hasTime ? 'disabled' : ''}>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-checkbox">
                            <input type="checkbox" id="editNoSpecificTime" ${!this.setting.hasTime ? 'checked' : ''}>
                            <span class="b3-checkbox__graphic"></span>
                            <span class="b3-checkbox__label">${t("noSpecificTime")}</span>
                        </label>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("repeatSettings")}</label>
                        <div class="repeat-setting-container">
                            <button type="button" id="editRepeatSettingsBtn" class="b3-button b3-button--outline" style="width: 100%;">
                                <span id="editRepeatDescription">${t("noRepeat")}</span>
                                <svg class="b3-button__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
                            </button>
                        </div>
                    </div>
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderNoteOptional")}</label>
                        <textarea id="editReminderNote" class="b3-text-field" placeholder="${t("enterReminderNote")}" rows="3" style="resize: vertical; min-height: 60px;width: 100%;">${this.setting.note}</textarea>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="editCancelBtn">${t("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="editSaveBtn">保存设置</button>
                </div>
            </div>
        `;
    }

    private async renderCategorySelector(dialog: Dialog) {
        const categorySelector = dialog.element.querySelector('#editCategorySelector') as HTMLElement;
        if (!categorySelector) return;

        try {
            const categories = this.plugin.categoryManager.getCategories();

            categorySelector.innerHTML = '';

            const noCategoryEl = document.createElement('div');
            noCategoryEl.className = `category-option ${!this.setting.categoryId ? 'selected' : ''}`;
            noCategoryEl.setAttribute('data-category', '');
            noCategoryEl.innerHTML = `<span>无分类</span>`;
            categorySelector.appendChild(noCategoryEl);

            categories.forEach(category => {
                const categoryEl = document.createElement('div');
                categoryEl.className = `category-option ${this.setting.categoryId === category.id ? 'selected' : ''}`;
                categoryEl.setAttribute('data-category', category.id);
                categoryEl.style.backgroundColor = category.color;
                categoryEl.innerHTML = `<span>${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
                categorySelector.appendChild(categoryEl);
            });

        } catch (error) {
            console.error('渲染分类选择器失败:', error);
            categorySelector.innerHTML = '<div class="category-error">加载分类失败</div>';
        }
    }

    private updateRepeatDescription(dialog: Dialog) {
        const repeatDescription = dialog.element.querySelector('#editRepeatDescription') as HTMLElement;
        if (repeatDescription) {
            const description = this.setting.repeatConfig?.enabled ? getRepeatDescription(this.setting.repeatConfig) : t("noRepeat");
            repeatDescription.textContent = description;
        }
    }

    private bindEditEvents(dialog: Dialog) {
        const cancelBtn = dialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const saveBtn = dialog.element.querySelector('#editSaveBtn') as HTMLButtonElement;
        const dateInput = dialog.element.querySelector('#editDate') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#editTime') as HTMLInputElement;
        const noTimeCheckbox = dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#editReminderNote') as HTMLTextAreaElement;
        const prioritySelector = dialog.element.querySelector('#editPrioritySelector') as HTMLElement;
        const categorySelector = dialog.element.querySelector('#editCategorySelector') as HTMLElement;
        const repeatSettingsBtn = dialog.element.querySelector('#editRepeatSettingsBtn') as HTMLButtonElement;
        const nlBtn = dialog.element.querySelector('#editNlBtn') as HTMLButtonElement;

        // 优先级选择事件
        prioritySelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.priority-option') as HTMLElement;
            if (option) {
                prioritySelector.querySelectorAll('.priority-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 分类选择事件
        categorySelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option') as HTMLElement;
            if (option) {
                categorySelector.querySelectorAll('.category-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 无时间复选框
        noTimeCheckbox?.addEventListener('change', () => {
            timeInput.disabled = noTimeCheckbox.checked;
            if (noTimeCheckbox.checked) {
                timeInput.value = '';
            }
        });

        // 重复设置按钮
        repeatSettingsBtn?.addEventListener('click', () => {
            const repeatDialog = new RepeatSettingsDialog(this.setting.repeatConfig, (config: RepeatConfig) => {
                this.setting.repeatConfig = config;
                this.updateRepeatDescription(dialog);
            });
            repeatDialog.show();
        });

        // 智能日期识别按钮
        nlBtn?.addEventListener('click', () => {
            this.showNaturalLanguageDialog(dialog);
        });

        // 取消按钮
        cancelBtn?.addEventListener('click', () => {
            dialog.destroy();
        });

        // 保存按钮
        saveBtn?.addEventListener('click', () => {
            this.saveBlockSetting(dialog);
        });
    }

    private showNaturalLanguageDialog(parentDialog: Dialog) {
        const nlDialog = new Dialog({
            title: "✨ 智能日期识别",
            content: `
                <div class="nl-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">输入自然语言描述</label>
                            <input type="text" id="blockNlInput" class="b3-text-field" placeholder="例如：明天下午3点、下周五、3天后等" style="width: 100%;" autofocus>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">识别结果预览</label>
                            <div id="blockNlPreview" class="nl-preview">请输入日期时间描述</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="blockNlCancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="blockNlConfirmBtn" disabled>应用</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "300px"
        });

        this.bindNaturalLanguageEvents(nlDialog, parentDialog);
    }

    private bindNaturalLanguageEvents(nlDialog: Dialog, parentDialog: Dialog) {
        const nlInput = nlDialog.element.querySelector('#blockNlInput') as HTMLInputElement;
        const nlPreview = nlDialog.element.querySelector('#blockNlPreview') as HTMLElement;
        const nlCancelBtn = nlDialog.element.querySelector('#blockNlCancelBtn') as HTMLButtonElement;
        const nlConfirmBtn = nlDialog.element.querySelector('#blockNlConfirmBtn') as HTMLButtonElement;

        let currentParseResult: { date?: string; time?: string; hasTime?: boolean } = {};

        // 实时解析输入
        const updatePreview = () => {
            const text = nlInput.value.trim();
            if (!text) {
                nlPreview.textContent = '请输入日期时间描述';
                nlPreview.className = 'nl-preview';
                nlConfirmBtn.disabled = true;
                return;
            }

            // 使用BatchReminderDialog的解析方法
            const batchDialog = new BatchReminderDialog(this.plugin);
            currentParseResult = (batchDialog as any).parseNaturalDateTime(text);

            if (currentParseResult.date) {
                const dateStr = new Date(currentParseResult.date + 'T00:00:00').toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'long'
                });

                let previewText = `📅 ${dateStr}`;
                if (currentParseResult.time) {
                    previewText += ` ⏰ ${currentParseResult.time}`;
                }

                nlPreview.textContent = previewText;
                nlPreview.className = 'nl-preview nl-preview--success';
                nlConfirmBtn.disabled = false;
            } else {
                nlPreview.textContent = '❌ 无法识别日期时间，请尝试其他表达方式';
                nlPreview.className = 'nl-preview nl-preview--error';
                nlConfirmBtn.disabled = true;
            }
        };

        // 绑定事件
        nlInput.addEventListener('input', updatePreview);
        nlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !nlConfirmBtn.disabled) {
                this.applyNaturalLanguageResult(parentDialog, currentParseResult);
                nlDialog.destroy();
            }
        });

        nlCancelBtn.addEventListener('click', () => {
            nlDialog.destroy();
        });

        nlConfirmBtn.addEventListener('click', () => {
            this.applyNaturalLanguageResult(parentDialog, currentParseResult);
            nlDialog.destroy();
        });

        // 自动聚焦输入框
        setTimeout(() => {
            nlInput.focus();
        }, 100);
    }

    private applyNaturalLanguageResult(dialog: Dialog, result: { date?: string; time?: string; hasTime?: boolean }) {
        if (!result.date) return;

        const dateInput = dialog.element.querySelector('#editDate') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#editTime') as HTMLInputElement;
        const noTimeCheckbox = dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;

        // 设置日期
        dateInput.value = result.date;

        // 设置时间
        if (result.hasTime && result.time) {
            timeInput.value = result.time;
            noTimeCheckbox.checked = false;
            timeInput.disabled = false;
        } else {
            noTimeCheckbox.checked = true;
            timeInput.disabled = true;
            timeInput.value = '';
        }

        showMessage(`✨ 已设置日期时间：${new Date(result.date + 'T00:00:00').toLocaleDateString('zh-CN')}${result.time ? ` ${result.time}` : ''}`);
    }

    private saveBlockSetting(dialog: Dialog) {
        const dateInput = dialog.element.querySelector('#editDate') as HTMLInputElement;
        const timeInput = dialog.element.querySelector('#editTime') as HTMLInputElement;
        const noTimeCheckbox = dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#editReminderNote') as HTMLTextAreaElement;
        const selectedPriority = dialog.element.querySelector('#editPrioritySelector .priority-option.selected') as HTMLElement;
        const selectedCategory = dialog.element.querySelector('#editCategorySelector .category-option.selected') as HTMLElement;

        if (!dateInput.value) {
            showMessage(t("pleaseSelectDate"));
            return;
        }

        // 更新设置
        this.setting.date = dateInput.value;
        this.setting.time = noTimeCheckbox.checked ? '' : timeInput.value;
        this.setting.hasTime = !noTimeCheckbox.checked && !!timeInput.value;
        this.setting.note = noteInput.value.trim();
        this.setting.priority = selectedPriority?.getAttribute('data-priority') || 'none';
        this.setting.categoryId = selectedCategory?.getAttribute('data-category') || '';

        // 调用保存回调
        this.onSave(this.setting);

        showMessage('✅ 设置已保存');
        dialog.destroy();
    }
}