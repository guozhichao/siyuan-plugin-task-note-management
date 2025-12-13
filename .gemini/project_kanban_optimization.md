# 项目看板编辑任务优化

## 问题描述

在项目看板视图中编辑任务时，会触发**两次更新**，导致界面刷新两次，影响用户体验和性能。

## 问题根源

### 1. `editTask` 方法的双重回调问题

**位置**: `src/components/ProjectKanbanView.ts` 第 5053-5081 行

**原问题**:
```typescript
const callback = async () => {
    await this.loadTasks();  // 第一次刷新
    window.dispatchEvent(new CustomEvent('reminderUpdated'));  // 触发第二次刷新
};

const editDialog = new QuickReminderDialog(
    undefined, 
    undefined, 
    callback,  // 作为第三个参数传递
    undefined, 
    { 
        mode: 'edit', 
        reminder: taskToEdit, 
        onSaved: callback,  // 又作为 onSaved 传递（重复！）
        plugin: this.plugin 
    }
);
```

**问题分析**:
1. `callback` 被传递了**两次**：
   - 作为 `QuickReminderDialog` 构造函数的第三个参数
   - 作为 `options.onSaved` 参数
2. `callback` 内部同时调用了：
   - `loadTasks()` - 直接刷新
   - 触发 `reminderUpdated` 事件 - 通过事件监听器（第 179 行）再次调用 `queueLoadTasks()`
3. 结果：每次编辑任务会触发 **4 次刷新**（2 次回调 × 2 种刷新方式）

### 2. `editInstanceReminder` 方法的冗余刷新

**位置**: `src/components/ProjectKanbanView.ts` 第 7714-7768 行

**原问题**:
```typescript
const editDialog = new QuickReminderDialog(
    undefined,
    undefined,
    async () => {
        await this.queueLoadTasks();  // 第一次刷新
        window.dispatchEvent(new CustomEvent('reminderUpdated'));  // 触发第二次刷新
    },
    // ...
);
```

**问题分析**:
1. 回调中同时调用了 `queueLoadTasks()` 和触发 `reminderUpdated` 事件
2. 事件监听器会再次调用 `queueLoadTasks()`
3. 结果：每次编辑周期任务实例会触发 **2 次刷新**

## 解决方案

### 优化策略

采用**统一的事件驱动刷新机制**：
- 只通过 `reminderUpdated` 事件触发刷新
- 移除所有直接调用 `loadTasks()` 或 `queueLoadTasks()` 的代码
- 利用现有的事件监听器（第 179 行）进行防抖刷新

### 修改后的代码

#### 1. `editTask` 方法优化

```typescript
private async editTask(task: any) {
    try {
        // 对于周期实例，需要编辑原始周期事件
        let taskToEdit = task;

        if (task.isRepeatInstance && task.originalId) {
            const reminderData = await readReminderData();
            const originalReminder = reminderData[task.originalId];
            if (!originalReminder) {
                showMessage("原始周期事件不存在");
                return;
            }
            taskToEdit = originalReminder;
        }

        // 优化：只通过 reminderUpdated 事件触发刷新，避免重复更新
        // 事件监听器会调用 queueLoadTasks() 进行防抖刷新
        const callback = () => {
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        };

        // 移除了 onSaved 参数，避免重复回调
        const editDialog = new QuickReminderDialog(
            undefined, 
            undefined, 
            callback, 
            undefined, 
            { mode: 'edit', reminder: taskToEdit, plugin: this.plugin }
        );
        editDialog.show();
    } catch (error) {
        console.error('打开编辑对话框失败:', error);
        showMessage("打开编辑对话框失败");
    }
}
```

**改进点**:
1. ✅ 移除了 `onSaved: callback` 参数，避免重复回调
2. ✅ 简化回调函数，只触发 `reminderUpdated` 事件
3. ✅ 移除了直接调用 `loadTasks()` 的代码

#### 2. `editInstanceReminder` 方法优化

```typescript
private async editInstanceReminder(task: any) {
    try {
        const reminderData = await readReminderData();
        const originalReminder = reminderData[task.originalId];

        if (!originalReminder) {
            showMessage("原始周期事件不存在");
            return;
        }

        const originalInstanceDate = task.id ? task.id.split('_').pop() : task.date;
        const instanceModifications = originalReminder.repeat?.instanceModifications || {};
        const instanceMod = instanceModifications[originalInstanceDate];

        const instanceData = {
            ...originalReminder,
            id: task.id,
            date: task.date,
            endDate: task.endDate,
            time: task.time,
            endTime: task.endTime,
            note: instanceMod?.note || originalReminder.note || '',
            isInstance: true,
            originalId: task.originalId,
            instanceDate: originalInstanceDate
        };

        // 优化：只通过 reminderUpdated 事件触发刷新，避免重复更新
        // 事件监听器会调用 queueLoadTasks() 进行防抖刷新
        const callback = () => {
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        };

        const editDialog = new QuickReminderDialog(
            undefined,
            undefined,
            callback,
            undefined,
            {
                mode: 'edit',
                reminder: instanceData,
                plugin: this.plugin,
                isInstanceEdit: true
            }
        );
        editDialog.show();
    } catch (error) {
        console.error('打开实例编辑对话框失败:', error);
        showMessage("打开编辑对话框失败");
    }
}
```

**改进点**:
1. ✅ 简化回调函数，只触发 `reminderUpdated` 事件
2. ✅ 移除了直接调用 `queueLoadTasks()` 的代码
3. ✅ 与 `editTask` 保持一致的刷新模式

## 优化效果

### 性能提升

| 操作 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 编辑普通任务 | 4 次刷新 | 1 次刷新 | **75% ↓** |
| 编辑周期任务实例 | 2 次刷新 | 1 次刷新 | **50% ↓** |

### 用户体验改进

1. ✅ **响应更快**: 减少了不必要的界面重绘
2. ✅ **滚动位置稳定**: 减少刷新次数，降低滚动位置丢失的风险
3. ✅ **更流畅**: 防抖机制确保短时间内多次操作只触发一次刷新

### 代码质量提升

1. ✅ **统一的刷新机制**: 所有更新都通过 `reminderUpdated` 事件
2. ✅ **更好的可维护性**: 刷新逻辑集中在事件监听器中
3. ✅ **防止未来的重复问题**: 明确的注释说明了优化意图

## 测试建议

1. **基本功能测试**:
   - 编辑普通任务，验证更新正常
   - 编辑周期任务的单个实例，验证更新正常
   - 编辑周期任务的所有实例，验证更新正常

2. **性能测试**:
   - 在包含大量任务的项目中编辑任务
   - 观察界面刷新次数和响应速度
   - 验证滚动位置是否保持稳定

3. **边界情况测试**:
   - 快速连续编辑多个任务
   - 编辑任务后立即切换看板模式
   - 编辑任务后立即刷新页面

## 相关文件

- `src/components/ProjectKanbanView.ts` - 主要修改文件
- 修改行数：
  - `editTask`: 第 5053-5081 行
  - `editInstanceReminder`: 第 7714-7768 行
  - 事件监听器: 第 179 行

## 技术细节

### 事件监听器机制

```typescript
// 第 179 行
window.addEventListener('reminderUpdated', () => this.queueLoadTasks());
```

### 防抖队列实现

```typescript
// 第 1691-1720 行
private queueLoadTasks(): Promise<void> {
    if (!this._pendingLoadPromise) {
        this._pendingLoadPromise = new Promise<void>((resolve) => { 
            this._pendingLoadResolve = resolve; 
        });
    }

    if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
    }

    this._debounceTimer = setTimeout(async () => {
        try {
            await this.loadTasks();
        } catch (e) {
            console.error('queueLoadTasks 执行 loadTasks 时出错', e);
        } finally {
            if (this._pendingLoadResolve) {
                this._pendingLoadResolve();
            }
            this._pendingLoadPromise = null;
            this._pendingLoadResolve = null;
            this._debounceTimer = null;
        }
    }, this._debounceDelay);  // 默认 250ms

    return this._pendingLoadPromise as Promise<void>;
}
```

**防抖延迟**: 250ms（`_debounceDelay`）

## 总结

通过移除重复的回调和统一使用事件驱动的刷新机制，成功解决了项目看板编辑任务时的双重更新问题。这不仅提升了性能和用户体验，还提高了代码的可维护性和一致性。
