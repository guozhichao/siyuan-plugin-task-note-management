import { showMessage } from "siyuan";
import { t } from "../utils/i18n";
import { getLocalDateString } from "./dateUtils";
import { ProjectManager } from "./projectManager";

export class TaskSummaryManager {
    private projectManager: ProjectManager;
    private calendar: any;

    constructor(calendar?: any) {
        this.projectManager = ProjectManager.getInstance();
        this.calendar = calendar;
    }

    /**
     * 设置日历实例
     */
    public setCalendar(calendar: any) {
        this.calendar = calendar;
    }

    /**
     * 生成摘要内容HTML
     */
    public generateSummaryContent(groupedTasks: Map<string, Map<string, any[]>>, dateRange?: { start: string, end: string }): string {
        let html = `
            <div class="task-summary-container">
                <div class="task-summary-header">
                    <div class="copy-dropdown-container" style="position: relative; display: inline-block;">
                        <button class="copy-dropdown-btn" id="copy-dropdown-btn" style="
                            background: #4A90E2;
                            color: white;
                            border: none;
                            border-radius: 6px;
                            padding: 8px 16px;
                            font-size: 13px;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            transition: background-color 0.2s ease;
                            box-shadow: 0 2px 4px rgba(74, 144, 226, 0.2);
                        ">
                            <svg style="width: 14px; height: 14px;"><use xlink:href="#iconCopy"></use></svg>
                            <span id="copy-main-text">${t("copyRichText") || "复制富文本"}</span>
                            <svg style="width: 12px; height: 12px; margin-left: 4px;"><use xlink:href="#iconDown"></use></svg>
                        </button>
                        <div class="copy-dropdown-menu" id="copy-dropdown-menu" style="
                            display: none;
                            position: absolute;
                            top: calc(100% + 4px);
                            right: 0;
                            z-index: 1000;
                            min-width: 180px;
                            background: white;
                            border-radius: 8px;
                            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                            padding: 4px 0;
                            border: 1px solid #e1e5e9;
                        ">
                            <div class="copy-menu-item" data-copy-type="rich" style="
                                padding: 10px 16px;
                                cursor: pointer;
                                font-size: 13px;
                                color: #333;
                                display: flex;
                                align-items: center;
                                gap: 10px;
                                transition: background-color 0.2s ease;
                            ">
                                <svg style="width: 14px; height: 14px; color: #666;"><use xlink:href="#iconCopy"></use></svg>
                                ${t("copyRichText") || "复制富文本"}
                            </div>
                            <div class="copy-menu-item" data-copy-type="markdown" style="
                                padding: 10px 16px;
                                cursor: pointer;
                                font-size: 13px;
                                color: #333;
                                display: flex;
                                align-items: center;
                                gap: 10px;
                                transition: background-color 0.2s ease;
                            ">
                                <svg style="width: 14px; height: 14px; color: #666;"><use xlink:href="#iconCopy"></use></svg>
                                ${t("copyAll") || "复制 Markdown"}
                            </div>
                            <div class="copy-menu-item" data-copy-type="plain" style="
                                padding: 10px 16px;
                                cursor: pointer;
                                font-size: 13px;
                                color: #333;
                                display: flex;
                                align-items: center;
                                gap: 10px;
                                transition: background-color 0.2s ease;
                            ">
                                <svg style="width: 14px; height: 14px; color: #666;"><use xlink:href="#iconCopy"></use></svg>
                                ${t("copyPlainText") || "复制纯文本"}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="task-summary-content" id="summary-content">
        `;
        
        // 按日期排序
        const sortedDates = Array.from(groupedTasks.keys()).sort();
        
        // 检查当前是否为日视图
        const isDayView = this.calendar && this.calendar.view.type === 'timeGridDay';
        
        // 在日视图下，只显示当前日期的任务
        const datesToShow = isDayView && dateRange ? [dateRange.start] : sortedDates;
        
        datesToShow.forEach(date => {
            // 在日视图下，确保只处理存在的日期
            if (isDayView && !groupedTasks.has(date)) {
                return;
            }
            const dateProjects = groupedTasks.get(date);
            const dateObj = new Date(date);
            const formattedDate = dateObj.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });
            
            html += `<div class="task-date-group">`;
            html += `<h3 class="task-date-title">${formattedDate}</h3>`;
            
            // 按项目分组
            dateProjects.forEach((tasks, projectName) => {
                html += `<div class="task-project-group">`;
                html += `<h4 class="task-project-title">${projectName}</h4>`;
                html += `<ul class="task-list">`;
                
                tasks.forEach(task => {
                    const completedClass = task.completed ? 'completed' : '';
                    const priorityClass = `priority-${task.priority}`;
                    const timeStr = task.time ? ` (${task.time})` : '';
                    
                    html += `
                        <li class="task-item ${completedClass} ${priorityClass}">
                            <span class="task-checkbox">${task.completed ? '✅' : '⬜'}</span>
                            <span class="task-title">${task.title}${timeStr}</span>
                            ${task.note ? `<div class="task-note">${task.note}</div>` : ''}
                        </li>
                    `;
                });
                
                html += `</ul></div>`;
            });
            
            html += `</div>`;
        });
        
        html += `
                </div>
            </div>
            <style>
                .task-summary-container {
                    padding: 16px;
                    max-height: 60vh;
                    overflow-y: auto;
                }
                .task-summary-header {
                    margin-bottom: 16px;
                    text-align: right;
                }
                .task-date-group {
                    margin-bottom: 24px;
                }
                .task-date-title {
                    color: var(--b3-theme-primary);
                    border-bottom: 2px solid var(--b3-theme-primary);
                    padding-bottom: 8px;
                    margin-bottom: 16px;
                }
                .task-project-group {
                    margin-bottom: 16px;
                    margin-left: 16px;
                }
                .task-project-title {
                    color: var(--b3-theme-secondary);
                    margin-bottom: 8px;
                }
                .task-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }
                .task-item {
                    display: flex;
                    align-items: flex-start;
                    padding: 8px 0;
                    border-bottom: 1px solid var(--b3-border-color);
                }
                .task-item.completed {
                    opacity: 0.6;
                }
                .task-item.completed .task-title {
                    text-decoration: line-through;
                }
                .task-checkbox {
                    margin-right: 8px;
                    flex-shrink: 0;
                }
                .task-title {
                    flex: 1;
                    word-break: break-word;
                }
                .task-note {
                    font-size: 12px;
                    color: var(--b3-theme-on-surface-light);
                    margin-top: 4px;
                    margin-left: 24px;
                }
                .priority-high .task-title {
                    color: #e74c3c;
                    font-weight: bold;
                }
                .priority-medium .task-title {
                    color: #f39c12;
                }
                .priority-low .task-title {
                    color: #3498db;
                }
            </style>
        `;
        
        // 添加复制功能
        setTimeout(() => {
            this.bindCopyEvents(groupedTasks);
        }, 100);
        
        return html;
    }

    /**
     * 绑定复制事件
     */
    private bindCopyEvents(groupedTasks: Map<string, Map<string, any[]>>) {
        // 复制下拉按钮功能
        const copyDropdownBtn = document.getElementById('copy-dropdown-btn');
        const copyDropdownMenu = document.getElementById('copy-dropdown-menu');
        
        if (!copyDropdownBtn || !copyDropdownMenu) return;
        
        // 按钮悬停效果
        copyDropdownBtn.addEventListener('mouseenter', () => {
            copyDropdownBtn.style.backgroundColor = '#3A7BD5';
        });
        copyDropdownBtn.addEventListener('mouseleave', () => {
            copyDropdownBtn.style.backgroundColor = '#4A90E2';
        });
        
        copyDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = copyDropdownMenu.style.display !== 'none';
            if (isVisible) {
                copyDropdownMenu.style.display = 'none';
            } else {
                copyDropdownMenu.style.display = 'block';
                // 如果点击的是主按钮区域（不是下拉箭头），直接执行复制
                const rect = copyDropdownBtn.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const buttonWidth = rect.width;
                // 如果点击位置在按钮左侧80%的区域，执行富文本复制
                if (clickX < buttonWidth * 0.8) {
                    this.executeCopy('rich', groupedTasks);
                    copyDropdownMenu.style.display = 'none';
                }
            }
        });
        
        // 点击其他地方关闭下拉菜单
        document.addEventListener('click', () => {
            copyDropdownMenu.style.display = 'none';
        });
        
        // 下拉菜单项点击事件
        const menuItems = copyDropdownMenu.querySelectorAll('.copy-menu-item');
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const copyType = (e.currentTarget as HTMLElement).getAttribute('data-copy-type');
                if (copyType) {
                    // 执行对应类型的复制，不改变按钮文本
                    this.executeCopy(copyType, groupedTasks);
                    // 关闭下拉菜单
                    copyDropdownMenu.style.display = 'none';
                }
            });
            
            // 菜单项悬停效果
            item.addEventListener('mouseenter', () => {
                (item as HTMLElement).style.backgroundColor = '#f5f7fa';
            });
            item.addEventListener('mouseleave', () => {
                (item as HTMLElement).style.backgroundColor = '';
            });
        });
    }

    /**
     * 复制任务摘要到剪贴板
     */
    public copyTaskSummary(groupedTasks: Map<string, Map<string, any[]>>) {
        let text = '';

        const sortedDates = Array.from(groupedTasks.keys()).sort();

        sortedDates.forEach(date => {
            const dateProjects = groupedTasks.get(date);
            const dateObj = new Date(date);
            const formattedDate = dateObj.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });

            // 非日视图时才添加日期标题
            if (this.calendar && this.calendar.view.type !== 'timeGridDay') {
                text += `## ${formattedDate}

`;
            }

            dateProjects.forEach((tasks, projectName) => {
                text += `### ${projectName}

`;

                tasks.forEach(task => {
                    const checkbox = task.completed ? '- [x]' : '- [ ]';
                    const timeStr = task.time ? ` (${task.time})` : '';

                    text += `${checkbox} ${task.title}${timeStr}
`;
                    if (task.note) {
                        text += `  > ${task.note}
`;
                    }
                });

                text += `
`;
            });

            text += `
`;
        });

        navigator.clipboard.writeText(text).then(() => {
            showMessage(t("copiedToClipboard") || "已复制到剪贴板");
        }).catch(err => {
            console.error('复制失败:', err);
            showMessage(t("copyFailed") || "复制失败");
        });
    }

    /**
     * 复制任务摘要纯文本到剪贴板（带编号）
     */
    public copyTaskSummaryPlainText(groupedTasks: Map<string, Map<string, any[]>>) {
        let text = '';
        
        const sortedDates = Array.from(groupedTasks.keys()).sort();
        
        sortedDates.forEach(date => {
            const dateProjects = groupedTasks.get(date);
            const dateObj = new Date(date);
            const formattedDate = dateObj.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });
            
            // 非日视图时才添加日期标题
            if (this.calendar && this.calendar.view.type !== 'timeGridDay') {
                text += `${formattedDate}
${'-'.repeat(formattedDate.length)}

`;
            }
            
            dateProjects.forEach((tasks, projectName) => {
                text += `【${projectName}】
`;

                let taskNumber = 1; // 全局任务编号
                tasks.forEach(task => {
                    const timeStr = task.time ? ` (${task.time})` : '';
                    
                    text += `${taskNumber}.  ${task.title}
`;
                    taskNumber++;
                });
                
                text += `
`;
            });
            
            text += `
`;
        });
        
        navigator.clipboard.writeText(text).then(() => {
            showMessage(t("copiedToClipboard") || "已复制到剪贴板");
        }).catch(err => {
            console.error('复制失败:', err);
            showMessage(t("copyFailed") || "复制失败");
        });
    }

    /**
     * 复制任务摘要富文本到剪贴板（带编号，HTML格式）
     */
    public copyTaskSummaryRichText(groupedTasks: Map<string, Map<string, any[]>>) {
        let html = '';
        
        const sortedDates = Array.from(groupedTasks.keys()).sort();
        
        html += '<div style="font-family: Arial, sans-serif; line-height: 1.6;">';
        
        sortedDates.forEach(date => {
            const dateProjects = groupedTasks.get(date);
            const dateObj = new Date(date);
            const formattedDate = dateObj.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });
            
            // 非日视图时才添加日期标题
            if (this.calendar && this.calendar.view.type !== 'timeGridDay') {
                html += `<h2 style="color: #1976D2; margin: 20px 0 12px 0; font-size: 18px; border-bottom: 2px solid #1976D2; padding-bottom: 4px;">${formattedDate}</h2>`;
            }
            
            dateProjects.forEach((tasks, projectName) => {
                html += `<h3 style="color: #2196F3; margin: 16px 0 8px 0; font-size: 16px;">【${projectName}】</h3>`;
                html += '<ol style="margin: 0 0 16px 0; padding-left: 20px;">';

                tasks.forEach(task => {
                    const timeStr = task.time ? ` <span style="color: #666; font-size: 12px;">(${task.time})</span>` : '';
                    
                    html += `<li style="margin: 4px 0; color: #333;">${task.title}${timeStr}</li>`;
                });
                
                html += '</ol>';
            });
            
            html += '<br>';
        });
        
        html += '</div>';
        
        // 创建一个临时的 ClipboardItem 来复制富文本
        const blob = new Blob([html], { type: 'text/html' });
        const clipboardItem = new ClipboardItem({ 'text/html': blob });
        
        navigator.clipboard.write([clipboardItem]).then(() => {
            showMessage(t("copiedToClipboard") || "已复制到剪贴板");
        }).catch(err => {
            console.error('富文本复制失败:', err);
            // 如果富文本复制失败，尝试复制纯文本版本
            const plainText = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
            navigator.clipboard.writeText(plainText).then(() => {
                showMessage(t("copiedToClipboard") || "已复制到剪贴板（纯文本格式）");
            }).catch(err2 => {
                console.error('纯文本复制也失败:', err2);
                showMessage(t("copyFailed") || "复制失败");
            });
        });
    }

    /**
     * 执行复制操作
     */
    public executeCopy(copyType: string, groupedTasks: Map<string, Map<string, any[]>>) {
        switch (copyType) {
            case 'rich':
                this.copyTaskSummaryRichText(groupedTasks);
                break;
            case 'markdown':
                this.copyTaskSummary(groupedTasks);
                break;
            case 'plain':
                this.copyTaskSummaryPlainText(groupedTasks);
                break;
            default:
                this.copyTaskSummaryRichText(groupedTasks);
        }
    }
}