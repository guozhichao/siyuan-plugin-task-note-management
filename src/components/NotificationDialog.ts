import { t } from "../utils/i18n";
import { openTab } from "siyuan";

interface ReminderInfo {
    id: string;
    blockId: string;
    title: string;
    note?: string;
    priority: string;
    categoryId?: string;
    categoryName?: string;
    categoryColor?: string;
    categoryIcon?: string;
    time?: string;
    date: string;
    endDate?: string;
}

export class NotificationDialog {
    private element: HTMLElement;
    private static instances: NotificationDialog[] = [];
    private static readonly MAX_NOTIFICATIONS = 5;
    private reminderInfo: ReminderInfo;

    constructor(reminderInfo: ReminderInfo) {
        this.reminderInfo = reminderInfo;
        this.createElement();
        this.show();
        NotificationDialog.instances.push(this);

        // 限制同时显示的通知数量
        if (NotificationDialog.instances.length > NotificationDialog.MAX_NOTIFICATIONS) {
            const oldestNotification = NotificationDialog.instances.shift();
            if (oldestNotification) {
                oldestNotification.destroy();
            }
        }
    }

    private createElement() {
        this.element = document.createElement('div');
        this.element.className = 'reminder-notification';

        const { title, note, priority, categoryName, categoryColor, categoryIcon, time, date, endDate } = this.reminderInfo;

        const priorityClass = priority !== 'none' ? `priority-${priority}` : '';
        const priorityDot = priority !== 'none' ? `<div class="notification-priority-dot ${priority}"></div>` : '';

        // 构建时间显示
        let timeDisplay = '';
        if (time) {
            timeDisplay = endDate && endDate !== date ?
                `${date} → ${endDate} ${time}` :
                `${date} ${time}`;
        } else {
            timeDisplay = endDate && endDate !== date ?
                `${date} → ${endDate}` :
                `${date}`;
        }

        // 构建分类显示
        let categoryDisplay = '';
        if (categoryName) {
            const icon = categoryIcon ? `${categoryIcon} ` : '';
            categoryDisplay = `
                <div class="notification-category">
                    <div class="category-dot" style="background-color: ${categoryColor || '#666'};"></div>
                    <span>${icon}${categoryName}</span>
                </div>
            `;
        }

        // 构建优先级显示
        let priorityDisplay = '';
        if (priority !== 'none') {
            const priorityText = priority === 'high' ? t("highPriority") :
                priority === 'medium' ? t("mediumPriority") :
                    priority === 'low' ? t("lowPriority") : '';
            priorityDisplay = `
                <div class="notification-priority">
                    <div class="priority-dot ${priority}"></div>
                    <span>${priorityText}</span>
                </div>
            `;
        }

        this.element.innerHTML = `
            <div class="notification-content ${priorityClass}">
                <div class="notification-header">
                    <div class="notification-icon">
                        <svg><use xlink:href="#iconClock"></use></svg>
                    </div>
                    <div class="notification-title-container">
                        <div class="notification-title" data-block-id="${this.reminderInfo.blockId}">${this.escapeHtml(title)}</div>
                        <div class="notification-time">${timeDisplay}</div>
                    </div>
                    <button class="notification-close" aria-label="${t('close')}">
                        <svg><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                
                <div class="notification-meta">
                    ${priorityDisplay}
                    ${categoryDisplay}
                </div>
                
                ${note ? `<div class="notification-note">${this.escapeHtml(note)}</div>` : ''}
            </div>
        `;

        // 添加样式
        this.addStyles();

        // 绑定关闭事件
        const closeBtn = this.element.querySelector('.notification-close') as HTMLButtonElement;
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.destroy();
        });

        // 绑定标题点击跳转事件
        const titleElement = this.element.querySelector('.notification-title') as HTMLElement;
        titleElement.addEventListener('click', (e) => {
            e.stopPropagation();
            this.jumpToBlock();
        });

        // 设置标题为可点击样式
        titleElement.style.cursor = 'pointer';
        titleElement.style.textDecoration = 'underline';
        titleElement.style.color = 'var(--b3-theme-primary)';
    }

    private addStyles() {
        if (document.querySelector('#reminder-notification-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'reminder-notification-styles';
        styles.textContent = `
            .reminder-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                min-width: 320px;
                max-width: 420px;
                z-index: 10000;
                animation: slideInRight 0.3s ease-out;
                margin-bottom: 10px;
            }

            .notification-content {
                background: var(--b3-theme-background);
                border: 1px solid var(--b3-theme-border);
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                padding: 12px;
                transition: all 0.2s ease;
            }

            .notification-content:hover {
                box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
                transform: translateY(-1px);
            }

            .notification-content.priority-high {
                border-left: 4px solid var(--b3-card-error-color) !important;
                background-color: var(--b3-card-error-background) !important;
            }

            .notification-content.priority-medium {
                border-left: 4px solid var(--b3-card-warning-color) !important;
                background-color: var(--b3-card-warning-background) !important;
            }

            .notification-content.priority-low {
                border-left: 4px solid var(--b3-card-info-color) !important;
                background-color: var(--b3-card-info-background) !important;
            }

            .notification-header {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                margin-bottom: 8px;
            }

            .notification-icon {
                flex-shrink: 0;
                color: var(--b3-theme-primary);
                margin-top: 2px;
            }

            .notification-icon svg {
                width: 16px;
                height: 16px;
            }

            .notification-title-container {
                flex: 1;
                min-width: 0;
            }

            .notification-title {
                font-weight: 500;
                color: var(--b3-theme-primary);
                word-break: break-word;
                line-height: 1.4;
                margin-bottom: 4px;
                cursor: pointer;
                text-decoration: underline;
                transition: color 0.2s ease;
            }

            .notification-title:hover {
                color: var(--b3-theme-primary-light);
            }

            .notification-time {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                line-height: 1.3;
            }

            .notification-close {
                flex-shrink: 0;
                background: none;
                border: none;
                cursor: pointer;
                padding: 2px;
                border-radius: 4px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                transition: all 0.2s ease;
            }

            .notification-close:hover {
                opacity: 1;
                background: var(--b3-theme-surface-lighter);
            }

            .notification-close svg {
                width: 14px;
                height: 14px;
            }

            .notification-meta {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 8px;
                flex-wrap: wrap;
            }

            .notification-priority {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
                color: var(--b3-theme-on-surface);
            }

            .notification-priority .priority-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                flex-shrink: 0;
            }

            .notification-priority .priority-dot.high {
                background-color: var(--b3-card-error-color);
            }

            .notification-priority .priority-dot.medium {
                background-color: var(--b3-card-warning-color);
            }

            .notification-priority .priority-dot.low {
                background-color: var(--b3-card-info-color);
            }

            .notification-category {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
                color: var(--b3-theme-on-surface);
            }

            .notification-category .category-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
            }

            .notification-note {
                color: var(--b3-theme-on-surface);
                font-size: 12px;
                line-height: 1.4;
                margin-top: 8px;
                padding: 8px;
                background: var(--b3-theme-surface);
                border-radius: 4px;
                word-break: break-word;
                border-left: 3px solid var(--b3-theme-primary-lighter);
            }

            /* 优先级对应的备注样式 */
            .notification-content.priority-high .notification-note {
                color: var(--b3-card-error-color) !important;
                background-color: rgba(var(--b3-card-error-color-rgb), 0.1) !important;
                border-left-color: var(--b3-card-error-color) !important;
            }

            .notification-content.priority-medium .notification-note {
                color: var(--b3-card-warning-color) !important;
                background-color: rgba(var(--b3-card-warning-color-rgb), 0.1) !important;
                border-left-color: var(--b3-card-warning-color) !important;
            }

            .notification-content.priority-low .notification-note {
                color: var(--b3-card-info-color) !important;
                background-color: rgba(var(--b3-card-info-color-rgb), 0.1) !important;
                border-left-color: var(--b3-card-info-color) !important;
            }

            @keyframes slideInRight {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }

            @keyframes slideOutRight {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }

            .reminder-notification.closing {
                animation: slideOutRight 0.3s ease-in;
            }

            /* 多个通知时的堆叠效果 */
            .reminder-notification:nth-last-child(2) {
                transform: translateX(-5px) scale(0.98);
                opacity: 0.9;
            }

            .reminder-notification:nth-last-child(3) {
                transform: translateX(-10px) scale(0.96);
                opacity: 0.8;
            }

            .reminder-notification:nth-last-child(4) {
                transform: translateX(-15px) scale(0.94);
                opacity: 0.7;
            }

            .reminder-notification:nth-last-child(n+5) {
                transform: translateX(-20px) scale(0.92);
                opacity: 0.6;
            }
        `;
        document.head.appendChild(styles);
    }

    private async jumpToBlock() {
        try {
            // 跳转到指定块
            openTab({
                app: window.siyuan?.ws?.app,
                doc: {
                    id: this.reminderInfo.blockId,
                    action: "cb-get-hl",
                    zoomIn: false
                },
            });

            // 关闭通知
            this.destroy();
        } catch (error) {
            console.error('跳转到块失败:', error);
        }
    }

    private show() {
        document.body.appendChild(this.element);

        // 调整已存在通知的位置
        this.updateNotificationPositions();
    }

    private updateNotificationPositions() {
        const notifications = document.querySelectorAll('.reminder-notification');
        notifications.forEach((notification, index) => {
            const element = notification as HTMLElement;
            element.style.bottom = `${20 + index * 100}px`; // 增加间距以容纳更多信息
        });
    }

    private destroy() {
        const index = NotificationDialog.instances.indexOf(this);
        if (index > -1) {
            NotificationDialog.instances.splice(index, 1);
        }

        this.element.classList.add('closing');
        setTimeout(() => {
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
            // 重新调整剩余通知的位置
            this.updateNotificationPositions();
        }, 300);
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 静态方法：显示通知
    static show(reminderInfo: ReminderInfo) {
        return new NotificationDialog(reminderInfo);
    }

    // 静态方法：清除所有通知
    static clearAll() {
        NotificationDialog.instances.forEach(instance => instance.destroy());
        NotificationDialog.instances = [];
    }
}
