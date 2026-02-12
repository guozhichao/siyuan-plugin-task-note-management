const ics = require('ics');
const fs = require('fs');

// 创建全天事件
const event = [{
    start: [2026, 2, 15], // 年、月、日 (月份从1开始)
    end: [2026, 2, 16], // 全天事件持续一天
    title: '全天事件示例',
    description: '这是一个全天事件的描述',
    location: '活动地点',

}, {
    start: [2026, 2, 15, 9, 0], // 年、月、日、小时、分钟
    end: [2026, 2, 15, 10, 0], // 年、月、日、小时、分钟
    title: '定时事件示例',
    description: '这是一个定时事件的描述',
    location: '会议室',
},
// 多天事件
{
    start: [2026, 2, 15], // 年、月、日 (月份从1开始)
    end: [2026, 2, 17], // 多天事件持续三天
    title: '多天事件示例',
    description: '这是一个多天事件的描述',
    location: '活动地点',
}
];

// 生成 ICS 文件内容
ics.createEvents(event, (error, value) => {
    if (error) {
        console.log('创建事件失败:', error);
        return;
    }

    // 保存到文件
    fs.writeFileSync('全天和定时事件.ics', value);
    console.log('✅ 事件已成功创建并保存到 event.ics');
    console.log('\n文件内容预览:');
    console.log(value);
});
