const ICAL = require('ical.js');
const fs = require('fs');

const icsPath = 'D:\\Notes\\Siyuan\\Achuan-2\\data\\storage\\petal\\siyuan-plugin-task-note-management\\reminders.ics';

try {
    const data = fs.readFileSync(icsPath, 'utf8');
    const parser = new ICAL.ComponentParser();

    // Manual line-by-line or component-by-component parsing to find the error
    const jcalData = ICAL.parse(data);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents('vevent');

    console.log(`找到 ${vevents.length} 个事件。`);

    vevents.forEach((event, i) => {
        try {
            const summary = event.getFirstPropertyValue('summary');
            const start = event.getFirstPropertyValue('dtstart');
            const end = event.getFirstPropertyValue('dtend');
            // Testing if accessing these throws
            start.toJSDate();
            if (end) end.toJSDate();
        } catch (e) {
            console.log(`❌ 事件 #${i + 1} 解析失败: ${event.getFirstPropertyValue('summary')}`);
            console.log('原始内容:', event.toString());
            throw e;
        }
    });

    console.log('✅ 全部解析成功！');
} catch (err) {
    console.error('❌ 解析错误:', err.message);
    if (err.stack) {
        const lines = err.stack.split('\n');
        console.log(lines.slice(0, 5).join('\n'));
    }
}
