import { showMessage, Dialog } from "siyuan";
import { readReminderData, writeReminderData } from "../api";
import { CategoryManager, Category } from "../utils/categoryManager";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { t } from "../utils/i18n";
import { RepeatSettingsDialog, RepeatConfig } from "./RepeatSettingsDialog";
import { getRepeatDescription } from "../utils/repeatUtils";
import * as chrono from 'chrono-node'; // 导入chrono-node

export class ReminderEditDialog {
    private dialog: Dialog;
    private reminder: any;
    private onSaved?: (modifiedReminder?: any) => void;
    private repeatConfig: RepeatConfig;
    private categoryManager: CategoryManager; // 添加分类管理器
    private chronoParser: any; // chrono解析器实例

    constructor(reminder: any, onSaved?: (modifiedReminder?: any) => void) {
        this.reminder = reminder;
        this.onSaved = onSaved;
        this.categoryManager = CategoryManager.getInstance(); // 初始化分类管理器

        // 初始化重复配置
        this.repeatConfig = reminder.repeat || {
            enabled: false,
            type: 'daily',
            interval: 1,
            endType: 'never'
        };

        // 初始化chrono解析器，配置中文支持
        this.chronoParser = chrono.zh.casual.clone();
        this.setupChronoParser();
    }

    // 设置chrono解析器
    private setupChronoParser() {
        // 添加更多中文时间表达式支持
        const customPatterns = [
            // 今天、明天、后天等
            /今天|今日/i,
            /明天|明日/i,
            /后天/i,
            /大后天/i,
            // 周几
            /下?周[一二三四五六日天]/i,
            /下?星期[一二三四五六日天]/i,
            // 月份日期
            /(\d{1,2})月(\d{1,2})[日号]/i,
            // 时间
            /(\d{1,2})[点时](\d{1,2})?[分]?/i,
            // 相对时间
            /(\d+)天[后以]后/i,
            /(\d+)小时[后以]后/i,
        ];

        // 配置chrono选项
        this.chronoParser.option = {
            ...this.chronoParser.option,
            forwardDate: true // 优先解析未来日期
        };
    }

    // 解析自然语言日期时间
    private parseNaturalDateTime(text: string): { date?: string; time?: string; hasTime?: boolean } {
        try {
            const results = this.chronoParser.parse(text, new Date(), { forwardDate: false });

            if (results.length === 0) {
                return {};
            }

            const result = results[0];
            const parsedDate = result.start.date();

            // 格式化日期
            const date = parsedDate.toISOString().split('T')[0];

            // 检查是否包含时间信息
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

    // 从标题自动识别日期时间
    private autoDetectDateTimeFromTitle(title: string): { date?: string; time?: string; hasTime?: boolean; cleanTitle?: string } {
        const parseResult = this.parseNaturalDateTime(title);

        if (!parseResult.date) {
            return { cleanTitle: title };
        }

        // 尝试从标题中移除已识别的时间表达式
        let cleanTitle = title;
        const timeExpressions = [
            /今天|今日/gi,
            /明天|明日/gi,
            /后天/gi,
            /大后天/gi,
            /下?周[一二三四五六日天]/gi,
            /下?星期[一二三四五六日天]/gi,
            /\d{1,2}月\d{1,2}[日号]/gi,
            /\d{1,2}[点时]\d{0,2}[分]?/gi,
            /\d+天[后以]后/gi,
            /\d+小时[后以]后/gi,
        ];

        timeExpressions.forEach(pattern => {
            cleanTitle = cleanTitle.replace(pattern, '').trim();
        });

        // 清理多余的空格和标点
        cleanTitle = cleanTitle.replace(/\s+/g, ' ').replace(/^[，。、\s]+|[，。、\s]+$/g, '');

        return {
            ...parseResult,
            cleanTitle: cleanTitle || title // 如果清理后为空，则保持原标题
        };
    }

    // 显示自然语言输入对话框
    private showNaturalLanguageDialog() {
        const nlDialog = new Dialog({
            title: "✨ 智能日期识别",
            content: `
                <div class="nl-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">输入自然语言描述</label>
                            <input type="text" id="editNlInput" class="b3-text-field" placeholder="例如：明天下午3点、下周五、3天后等" style="width: 100%;" autofocus>
                            <div class="b3-form__desc">支持中文自然语言，如：今天、明天、下周一、3月15日、下午2点等</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">识别结果预览</label>
                            <div id="editNlPreview" class="nl-preview">请输入日期时间描述</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="editNlCancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="editNlConfirmBtn" disabled>应用</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "300px"
        });

        const nlInput = nlDialog.element.querySelector('#editNlInput') as HTMLInputElement;
        const nlPreview = nlDialog.element.querySelector('#editNlPreview') as HTMLElement;
        const nlCancelBtn = nlDialog.element.querySelector('#editNlCancelBtn') as HTMLButtonElement;
        const nlConfirmBtn = nlDialog.element.querySelector('#editNlConfirmBtn') as HTMLButtonElement;

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

            currentParseResult = this.parseNaturalDateTime(text);

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
                this.applyNaturalLanguageResult(currentParseResult);
                nlDialog.destroy();
            }
        });

        nlCancelBtn.addEventListener('click', () => {
            nlDialog.destroy();
        });

        nlConfirmBtn.addEventListener('click', () => {
            this.applyNaturalLanguageResult(currentParseResult);
            nlDialog.destroy();
        });

        // 自动聚焦输入框
        setTimeout(() => {
            nlInput.focus();
        }, 100);
    }

    // 应用自然语言识别结果
    private applyNaturalLanguageResult(result: { date?: string; time?: string; hasTime?: boolean }) {
        if (!result.date) return;

        const dateInput = this.dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#editReminderTime') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;

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

        // 触发日期变化事件以更新结束日期限制
        dateInput.dispatchEvent(new Event('change'));

        showMessage(`✨ 已识别并设置：${new Date(result.date + 'T00:00:00').toLocaleDateString('zh-CN')}${result.time ? ` ${result.time}` : ''}`);
    }

    public async show() {
        // 初始化分类管理器
        await this.categoryManager.initialize();

        this.dialog = new Dialog({
            title: this.reminder.isInstance ? t("modifyInstance") :
                this.reminder.isSplitOperation ? t("modifyAndSplit") : t("modifyEvent"),
            content: this.createDialogContent(),
            width: "500px",
            height: "730px" // 增加高度以容纳分类选择器
        });

        this.bindEvents();
        await this.renderCategorySelector(); // 渲染分类选择器
    }

    private createDialogContent(): string {
        return `
            <div class="time-edit-dialog">
                <div class="b3-dialog__content">
                    ${this.reminder.isInstance ? `
                        <div class="b3-form__group">
                            <div class="b3-form__desc" style="color: var(--b3-theme-primary);">
                                ${t("editingInstanceDesc")}
                            </div>
                        </div>
                    ` : ''}
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("eventTitle")}</label>
                        <div class="title-input-container" style="display: flex; gap: 8px;">
                            <input type="text" id="editReminderTitle" class="b3-text-field" value="${this.reminder.title || ''}" placeholder="${t("enterReminderTitle")}" style="flex: 1;" >
                            <button type="button" id="editNlBtn" class="b3-button b3-button--outline" title="✨ 智能日期识别">
                                ✨
                            </button>
                        </div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">事件分类
                            <button type="button" id="editManageCategoriesBtn" class="b3-button b3-button--outline" title="管理分类">
                                <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
                            </button>
                        </label>
                        <div class="category-selector" id="editCategorySelector" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;">
                            <!-- 分类选择器将在这里渲染 -->
                        </div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("priority")}</label>
                        <div class="priority-selector" id="editPrioritySelector">
                            <div class="priority-option ${this.reminder.priority === 'high' ? 'selected' : ''}" data-priority="high">
                                <div class="priority-dot high"></div>
                                <span>${t("highPriority")}</span>
                            </div>
                            <div class="priority-option ${this.reminder.priority === 'medium' ? 'selected' : ''}" data-priority="medium">
                                <div class="priority-dot medium"></div>
                                <span>${t("mediumPriority")}</span>
                            </div>
                            <div class="priority-option ${this.reminder.priority === 'low' ? 'selected' : ''}" data-priority="low">
                                <div class="priority-dot low"></div>
                                <span>${t("lowPriority")}</span>
                            </div>
                            <div class="priority-option ${(!this.reminder.priority || this.reminder.priority === 'none') ? 'selected' : ''}" data-priority="none">
                                <div class="priority-dot none"></div>
                                <span>${t("noPriority")}</span>
                            </div>
                        </div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderDate")}</label>
                        <input type="date" id="editReminderDate" class="b3-text-field" value="${this.reminder.date}" required>
                        <span class="reminder-arrow">→</span>
                        <input type="date" id="editReminderEndDate" class="b3-text-field" value="${this.reminder.endDate || ''}" placeholder="${t("endDateOptional")}">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderTime")}</label>
                        <input type="time" id="editReminderTime" class="b3-text-field" value="${this.reminder.time || ''}">
                        <div class="b3-form__desc">${t("noTimeDescLeaveEmpty")}</div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-checkbox">
                            <input type="checkbox" id="editNoSpecificTime" ${!this.reminder.time ? 'checked' : ''}>
                            <span class="b3-checkbox__graphic"></span>
                            <span class="b3-checkbox__label">${t("allDayReminder")}</span>
                        </label>
                    </div>
                    
                    ${!this.reminder.isInstance ? `
                    <!-- 重复设置只在非实例修改时显示 -->
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("repeatSettings")}</label>
                        <div class="repeat-setting-container">
                            <button type="button" id="editRepeatSettingsBtn" class="b3-button b3-button--outline" style="width: 100%;">
                                <span id="editRepeatDescription">${this.repeatConfig.enabled ? getRepeatDescription(this.repeatConfig) : t("noRepeat")}</span>
                                <svg class="b3-button__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
                            </button>
                        </div>
                    </div>
                    ` : ''}
                    
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t("reminderNote")}</label>
                        <textarea id="editReminderNote" class="b3-text-field" placeholder="${t("enterReminderNote")}" rows="3" style="width: 100%;resize: vertical; min-height: 60px;">${this.reminder.note || ''}</textarea>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="editCancelBtn">${t("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="editConfirmBtn">
                        ${this.reminder.isSplitOperation ? t("splitAndSave") : t("save")}
                    </button>
                </div>
            </div>
        `;
    }

    private async renderCategorySelector() {
        const categorySelector = this.dialog.element.querySelector('#editCategorySelector') as HTMLElement;
        if (!categorySelector) return;

        try {
            const categories = this.categoryManager.getCategories();

            // 清空并重新构建，使用横向布局
            categorySelector.innerHTML = '';

            // 添加无分类选项
            const noCategoryEl = document.createElement('div');
            noCategoryEl.className = `category-option ${!this.reminder.categoryId ? 'selected' : ''}`;
            noCategoryEl.setAttribute('data-category', '');
            noCategoryEl.innerHTML = `<span>无分类</span>`;
            categorySelector.appendChild(noCategoryEl);

            // 添加所有分类选项
            categories.forEach(category => {
                const categoryEl = document.createElement('div');
                categoryEl.className = `category-option ${this.reminder.categoryId === category.id ? 'selected' : ''}`;
                categoryEl.setAttribute('data-category', category.id);
                categoryEl.style.backgroundColor = category.color;
                categoryEl.innerHTML = `<span>${category.icon || ''} ${category.name}</span>`;
                categorySelector.appendChild(categoryEl);
            });

        } catch (error) {
            console.error('渲染分类选择器失败:', error);
            categorySelector.innerHTML = '<div class="category-error">加载分类失败</div>';
        }
    }

    private bindEvents() {
        const cancelBtn = this.dialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const confirmBtn = this.dialog.element.querySelector('#editConfirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#editReminderTime') as HTMLInputElement;
        const startDateInput = this.dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        const prioritySelector = this.dialog.element.querySelector('#editPrioritySelector') as HTMLElement;
        const categorySelector = this.dialog.element.querySelector('#editCategorySelector') as HTMLElement;
        const editManageCategoriesBtn = this.dialog.element.querySelector('#editManageCategoriesBtn') as HTMLButtonElement;
        const editNlBtn = this.dialog.element.querySelector('#editNlBtn') as HTMLButtonElement;

        // 优先级选择事件
        prioritySelector.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.priority-option') as HTMLElement;
            if (option) {
                prioritySelector.querySelectorAll('.priority-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 分类选择事件 - 增强选中效果
        categorySelector.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option') as HTMLElement;
            if (option) {
                // 移除所有选中状态
                categorySelector.querySelectorAll('.category-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                // 添加选中状态
                option.classList.add('selected');

                // 添加点击反馈动画
                option.style.transform = 'scale(0.9)';
                setTimeout(() => {
                    option.style.transform = '';
                }, 150);
            }
        });

        cancelBtn.addEventListener('click', () => {
            this.dialog.destroy();
        });

        confirmBtn.addEventListener('click', async () => {
            await this.saveTimeEdit();
        });

        noTimeCheckbox.addEventListener('change', () => {
            timeInput.disabled = noTimeCheckbox.checked;
            if (noTimeCheckbox.checked) {
                timeInput.value = '';
            }
        });

        startDateInput.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage(t("endDateAdjusted"));
            }

            endDateInput.min = startDate;
        });

        endDateInput.addEventListener('change', () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (endDate && endDate < startDate) {
                endDateInput.value = startDate;
                showMessage(t("endDateCannotBeEarlier"));
            }
        });

        // 管理分类按钮事件
        editManageCategoriesBtn?.addEventListener('click', () => {
            this.showCategoryManageDialog();
        });

        // 重复设置按钮
        const editRepeatSettingsBtn = this.dialog.element.querySelector('#editRepeatSettingsBtn') as HTMLButtonElement;
        editRepeatSettingsBtn?.addEventListener('click', () => {
            this.showRepeatSettingsDialog();
        });

        // 自然语言识别按钮
        editNlBtn?.addEventListener('click', () => {
            this.showNaturalLanguageDialog();
        });
    }

    private showRepeatSettingsDialog() {
        const repeatDialog = new RepeatSettingsDialog(this.repeatConfig, (config: RepeatConfig) => {
            this.repeatConfig = config;
            this.updateRepeatDescription();
        });
        repeatDialog.show();
    }

    private updateRepeatDescription() {
        const repeatDescription = this.dialog.element.querySelector('#editRepeatDescription') as HTMLElement;
        if (repeatDescription) {
            const description = this.repeatConfig.enabled ? getRepeatDescription(this.repeatConfig) : t("noRepeat");
            repeatDescription.textContent = description;
        }
    }

    private async saveTimeEdit() {
        const titleInput = this.dialog.element.querySelector('#editReminderTitle') as HTMLInputElement;
        const dateInput = this.dialog.element.querySelector('#editReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#editReminderEndDate') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#editReminderTime') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#editNoSpecificTime') as HTMLInputElement;
        const noteInput = this.dialog.element.querySelector('#editReminderNote') as HTMLTextAreaElement;
        const selectedPriority = this.dialog.element.querySelector('#editPrioritySelector .priority-option.selected') as HTMLElement;
        const selectedCategory = this.dialog.element.querySelector('#editCategorySelector .category-option.selected') as HTMLElement;

        const title = titleInput.value.trim();
        const date = dateInput.value;
        const endDate = endDateInput.value;
        const time = noTimeCheckbox.checked ? undefined : timeInput.value;
        const note = noteInput.value.trim() || undefined;
        const priority = selectedPriority?.getAttribute('data-priority') || 'none';
        const categoryId = selectedCategory?.getAttribute('data-category') || undefined;

        if (!title) {
            showMessage(t("pleaseEnterTitle"));
            return;
        }

        if (!date) {
            showMessage(t("pleaseSelectDate"));
            return;
        }

        if (endDate && endDate < date) {
            showMessage(t("endDateCannotBeEarlier"));
            return;
        }

        // 检查新的日期时间是否在未来，如果是则重置通知状态
        const shouldResetNotified = this.shouldResetNotification(date, time);

        try {
            if (this.reminder.isSplitOperation) {
                // 分割操作 - 构建修改后的数据并通过回调传递
                const modifiedReminder = {
                    ...this.reminder,
                    title: title,
                    date: date,
                    endDate: endDate,
                    time: time,
                    note: note,
                    priority: priority,
                    categoryId: categoryId, // 添加分类ID
                    repeat: this.repeatConfig.enabled ? this.repeatConfig : undefined,
                    notified: shouldResetNotified ? false : this.reminder.notified
                };

                // 调用分割回调
                if (this.onSaved) {
                    await this.onSaved(modifiedReminder);
                }

                this.dialog.destroy();
                return;
            }

            if (this.reminder.isInstance) {
                // 保存重复事件实例的修改
                await this.saveInstanceModification({
                    originalId: this.reminder.originalId,
                    instanceDate: this.reminder.instanceDate,
                    title: title,
                    date: date,
                    endDate: endDate,
                    time: time,
                    endTime: this.reminder.endTime,
                    note: note,
                    priority: priority,
                    categoryId: categoryId, // 添加分类ID
                    notified: shouldResetNotified ? false : this.reminder.notified
                });
            } else {
                // 保存普通事件或重复事件系列的修改
                const reminderData = await readReminderData();
                if (reminderData[this.reminder.id]) {
                    reminderData[this.reminder.id].title = title;
                    reminderData[this.reminder.id].date = date;
                    reminderData[this.reminder.id].time = time;
                    reminderData[this.reminder.id].note = note;
                    reminderData[this.reminder.id].priority = priority;
                    reminderData[this.reminder.id].categoryId = categoryId; // 添加分类ID
                    reminderData[this.reminder.id].repeat = this.repeatConfig.enabled ? this.repeatConfig : undefined;

                    // 重置通知状态
                    if (shouldResetNotified) {
                        reminderData[this.reminder.id].notified = false;
                    }

                    if (endDate && endDate !== date) {
                        reminderData[this.reminder.id].endDate = endDate;
                    } else {
                        delete reminderData[this.reminder.id].endDate;
                    }

                    await writeReminderData(reminderData);
                }
            }

            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            // 显示保存成功消息
            const isSpanning = endDate && endDate !== date;
            const timeStr = time ? ` ${time}` : '';
            const dateStr = isSpanning ? `${date} → ${endDate}${timeStr}` : `${date}${timeStr}`;
            let successMessage = this.reminder.isInstance ? t("instanceModified") : t("reminderUpdated");
            successMessage += `: ${dateStr}`;

            if (!this.reminder.isInstance && this.repeatConfig.enabled) {
                successMessage += `，${getRepeatDescription(this.repeatConfig)}`;
            }

            // 添加分类信息到成功消息
            if (categoryId) {
                const category = this.categoryManager.getCategoryById(categoryId);
                if (category) {
                    successMessage += `，分类：${category.name}`;
                }
            }

            showMessage(successMessage);

            // 调用保存回调（不传递参数，表示正常保存）
            if (this.onSaved) {
                this.onSaved();
            }

            this.dialog.destroy();
        } catch (error) {
            console.error('保存修改失败:', error);
            showMessage(t("saveReminderFailed"));
        }
    }

    private shouldResetNotification(date: string, time?: string): boolean {
        try {
            const now = new Date();
            const newDateTime = new Date(`${date}T${time || '00:00:00'}`);

            // 如果新的日期时间在当前时间之后，应该重置通知状态
            return newDateTime > now;
        } catch (error) {
            console.error('检查通知重置条件失败:', error);
            return false;
        }
    }

    private async saveInstanceModification(instanceData: any) {
        // 保存重复事件实例的修改
        try {
            const originalId = instanceData.originalId;
            const instanceDate = instanceData.instanceDate;

            const reminderData = await readReminderData();

            if (!reminderData[originalId]) {
                throw new Error('原始事件不存在');
            }

            // 初始化实例修改列表
            if (!reminderData[originalId].repeat) {
                reminderData[originalId].repeat = {};
            }
            if (!reminderData[originalId].repeat.instanceModifications) {
                reminderData[originalId].repeat.instanceModifications = {};
            }

            // 保存此实例的修改数据（包括分类）
            reminderData[originalId].repeat.instanceModifications[instanceDate] = {
                title: instanceData.title,
                date: instanceData.date,
                endDate: instanceData.endDate,
                time: instanceData.time,
                endTime: instanceData.endTime,
                note: instanceData.note,
                priority: instanceData.priority,
                categoryId: instanceData.categoryId, // 添加分类ID
                notified: instanceData.notified, // 添加通知状态
                modifiedAt: new Date().toISOString()
            };

            await writeReminderData(reminderData);

        } catch (error) {
            console.error('保存实例修改失败:', error);
            throw error;
        }
    }

    private showCategoryManageDialog() {
        const categoryDialog = new CategoryManageDialog(() => {
            // 分类更新后重新渲染分类选择器
            this.renderCategorySelector();
            // 触发全局提醒更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        });
        categoryDialog.show();
    }
}
