// test-portal.mjs - v4.0 教务导入：周次区间、学期对齐、课程转换用例（纯函数）
const s = await import('./web/js/portal.js');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- weeksToRuns ---
check('连续周次→一段 all', eq(s.weeksToRuns([1, 2, 3, 4]), [{ start: 1, end: 4, parity: 'all' }]));
check('奇数周→单周段', eq(s.weeksToRuns([1, 3, 5, 7]), [{ start: 1, end: 7, parity: 'odd' }]));
check('偶数周→双周段', eq(s.weeksToRuns([2, 4, 6]), [{ start: 2, end: 6, parity: 'even' }]));
check('连续后接单双周', eq(s.weeksToRuns([1, 2, 3, 5, 7]), [
  { start: 1, end: 3, parity: 'all' },
  { start: 5, end: 7, parity: 'odd' },
]));
check('零散单周分开', eq(s.weeksToRuns([4, 9]), [
  { start: 4, end: 4, parity: 'all' },
  { start: 9, end: 9, parity: 'all' },
]));
check('重复与越界周次被清理', eq(s.weeksToRuns([1, 1, 2, 0, 31]), [{ start: 1, end: 2, parity: 'all' }]));
check('空周次返回空', eq(s.weeksToRuns([]), []));

// --- matchSemester ---
const sems = [
  { id: 'a', name: '2026-2027 学年秋季学期', start_monday: '2026-09-07', total_weeks: 19 },
  { id: 'b', name: '2026-2027 学年春季学期', start_monday: '2027-03-01', total_weeks: 18 },
  { id: 'c', name: '2025-2026 学年春季学期', start_monday: '2026-02-23', total_weeks: 18 },
];
check('termCode 学年季次精确匹配',
  s.matchSemester({ code: '2026-2027-2', name: '2026-2027学年春季学期', startMonday: '2027-03-01' }, sems)?.id === 'b');
check('termCode 秋季匹配',
  s.matchSemester({ code: '2026-2027-1', name: '2026-2027学年秋季学期', startMonday: '2026-09-07' }, sems)?.id === 'a');
check('termCode 不匹配时不误中',
  s.matchSemester({ code: '2024-2025-1', name: '2024-2025学年秋季学期', startMonday: '2024-09-02' }, sems) === null);
check('起始周一相近兜底',
  s.matchSemester({ code: 'X', name: '某学期', startMonday: '2026-09-09' }, sems)?.id === 'a');
check('无匹配返回 null（将新建）',
  s.matchSemester({ code: '2023-2024-1', name: '2023-2024学年秋季学期', startMonday: '2023-09-04' }, sems) === null);
check('天大学期名+代码可对齐',
  s.matchSemester({ code: '2026-2027-2', name: '2026-2027学年第二学期', startMonday: '2027-03-01' }, sems)?.id === 'b');

// --- prepareImport ---
const periodTimes = { 1: { start: '08:00', end: '08:45' }, 2: { start: '08:50', end: '09:35' } };
const payload = {
  term: { code: '2026-2027-1', name: '2026-2027学年秋季学期', startMonday: '2026-09-07', totalWeeks: 18 },
  courses: [
    { name: '高等数学', teacher: '王老师', position: 'A101', day: 1, startSection: 1, endSection: 2, weeks: [1, 2, 3, 4, 6, 8] },
    { name: '高等数学', teacher: '王老师', position: 'A101', day: 1, startSection: 1, endSection: 2, weeks: [1, 2, 3, 4, 6, 8] },
    { name: '大学物理', teacher: '李老师', position: 'B202', day: 3, startSection: 3, endSection: 4, weeks: [1, 3, 5, 7] },
  ],
  sectionTimes: [{ section: 1, start: '08:00', end: '08:45' }, { section: 2, start: '08:50', end: '09:35' }],
  skipped: 1,
};

const p1 = s.prepareImport(payload, { semesters: sems, periodTimes });
check('已有学期命中，不新建', !!p1.target.sem && p1.target.sem.id === 'a');
check('课程去重后 2 条高数运行', p1.result.courses.filter(c => c.name === '高等数学').length === 2);
check('周次区间与单双周正确',
  eq(p1.result.courses.filter(c => c.name === '高等数学').map(c => [c.week_start, c.week_end, c.parity]),
    [[1, 4, 'all'], [6, 8, 'even']]));
check('教师在教师字段、教室在 location',
  p1.result.courses[0].teacher === '王老师' && p1.result.courses[0].location === 'A101');
check('作息一致时不提示', !p1.result.warnings.some(w => w.includes('作息')));
check('跳过条数进 warning', p1.result.warnings.some(w => w.includes('已跳过')));
check('格式标签为 buaa', p1.result.format === 'buaa');

const newPayload = {
  term: { code: '2023-2024-1', name: '2023-2024学年秋季学期', startMonday: '2023-09-04', totalWeeks: 16 },
  courses: [{ name: '线性代数', teacher: '赵老师', position: 'C301', day: 2, startSection: 5, endSection: 6, weeks: [16, 17, 2] }],
};
const p2 = s.prepareImport(newPayload, { semesters: sems, periodTimes });
check('无匹配学期→返回待建 spec', p2.target.spec?.name === '2023-2024学年秋季学期'
  && p2.target.spec.start_monday === '2023-09-04' && p2.target.spec.total_weeks === 16);
check('超出学期周次被忽略并提示',
  p2.result.courses.length === 2
  && p2.result.courses.every(c => c.week_start >= 2 && c.week_end <= 16)
  && p2.result.warnings.some(w => w.includes('超出学期范围')));

const p3 = s.prepareImport({ term: newPayload.term, courses: [{ name: 'X', day: 1, startSection: 1, weeks: [99] }] },
  { semesters: sems, periodTimes });
check('全部周次越界→错误', !!p3.error);

const p4 = s.prepareImport({ term: { code: '2023-2024-1', name: '新', totalWeeks: 16 }, courses: newPayload.courses },
  { semesters: sems, periodTimes });
check('待建学期缺起始日→错误', p4.error === 'NO_START');

const p5 = s.prepareImport({
  term: payload.term,
  courses: payload.courses,
  sectionTimes: [{ section: 1, start: '08:10', end: '08:55' }, { section: 2, start: '08:50', end: '09:35' }],
}, { semesters: sems, periodTimes });
check('作息不一致→提示', p5.result.warnings.some(w => w.includes('作息')));

const p6 = s.prepareImport({
  term: { code: '2026-2027-1', name: '2026-2027学年第一学期', startMonday: '2026-09-07', totalWeeks: 18 },
  courses: [{ name: '概率论', day: 2, startSection: 1, endSection: 2, weeks: [1, 2] }],
  source: 'tju',
  estimatedStart: true,
}, { semesters: sems, periodTimes });
check('天大格式标签', p6.result.format === 'tju');
check('天大估算开学日→提示', p6.result.warnings.some(w => w.includes('估算')));

// --- TJU semester calendar ---
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
globalThis.window = {};
const tju = require('./web/js/adapters/tju.js');
check('天大适配器导出学期解析函数', typeof tju.parseSemesterCalendar === 'function');
const calendarRaw = 'var semesterJson={"semesters":{"y0":[{"id":295,"schoolYear":"2026-2027","name":"1"},{"id":278,"schoolYear":"2026-2027","name":"2"}],"y1":[{"id":260,"schoolYear":"2025-2026","name":"1"}]}};';
const calendarTerms = tju.parseSemesterCalendar?.(calendarRaw) || [];
check('天大学期日历解析出学年与学期', calendarTerms.length === 3
  && calendarTerms.some(t => t.id === '295' && t.name === '2026-2027学年第一学期'));
check('天大学期日历按学年与季次排序', calendarTerms[0]?.id === '278' && calendarTerms[1]?.id === '295'
  && calendarTerms[2]?.id === '260');
const originalFetch = globalThis.fetch;
const calendarCalls = [];
globalThis.fetch = async (url, options) => {
  calendarCalls.push({ url: String(url), options });
  return new Response(calendarRaw, { status: 200 });
};
let calendarLoaded = null;
try {
  calendarLoaded = await tju.loadSemesterList?.();
} finally {
  globalThis.fetch = originalFetch;
}
check('天大优先请求 dataQuery 学期日历', calendarCalls.length === 1
  && calendarCalls[0].url.endsWith('/eams/dataQuery.action')
  && calendarCalls[0].options?.method === 'POST'
  && calendarCalls[0].options?.body === 'dataType=semesterCalendar');
check('天大学期日历接口可用', calendarLoaded?.length === 3 && calendarLoaded[0].id === '278');
check('天大学期日历标记当前学期', calendarLoaded?.some(t => t.id === '295' && t.current));
check('天大学期日历忽略重复与损坏条目', (tju.parseSemesterCalendar?.('{id:1,schoolYear:"2026-2027",name:"1"}{id:1,schoolYear:"2026-2027",name:"1"}{id:"x",schoolYear:"2026-2027",name:"1"}') || []).length === 1);

// --- TJU TaskActivity schedule parsing ---
function bits53(weeks) {
  return Array.from({ length: 53 }, (_, i) => weeks.includes(i + 1) ? '1' : '0').join('');
}
function activityBlock(teacher, code, name, room, weeks, indexes) {
  return `
var teachers = [{ id: 1, name: "${teacher}", lab: false }];
var actTeachers = [{ id: 1, name: "${teacher}", lab: false }];
var assistant = [];
var assistantName = "";
var actTeacherId = [];
var actTeacherName = [];
for (var i = 0; i < actTeachers.length; i++) {
  actTeacherId.push(actTeachers[i].id);
  actTeacherName.push(actTeachers[i].name);
}
activity = new TaskActivity(actTeacherId.join(','), actTeacherName.join(','), "${code}", "${name}", "8866", "${room}", "${bits53(weeks)}", null, "", assistantName, "", "", "");
${indexes.map(([day, section]) => `index = ${day} * unitCount + ${section};\ntable0.activities[index][table0.activities[index].length] = activity;`).join('\n')}
`;
}
const tjuScheduleHtml = activityBlock('张三', '2030323(04815)', '高等数学', '50楼A124', [4, 5, 6, 7, 8, 9, 10, 11], [[0, 0], [0, 1]])
  + activityBlock('李四', '2100196(04806)', '大学物理', '31楼251', [5, 7, 9, 11, 13, 15, 17, 19], [[1, 4], [1, 5]])
  + activityBlock('王五', '2082113(04444)', '线性代数', '45楼B404', [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], [[1, 2], [1, 3]]);

const tjuParsed = tju.parseTaskActivities?.(tjuScheduleHtml);
check('天大活动按每门课独立解析', tjuParsed?.courses?.length === 3);
check('天大节次取本课自己的星期与节次',
  tjuParsed?.courses?.some(c => c.name === '高等数学' && c.day === 1 && c.startSection === 1 && c.endSection === 2)
  && tjuParsed?.courses?.some(c => c.name === '大学物理' && c.day === 2 && c.startSection === 5 && c.endSection === 6)
  && tjuParsed?.courses?.some(c => c.name === '线性代数' && c.day === 2 && c.startSection === 3 && c.endSection === 4)
  && !tjuParsed?.courses?.some(c => c.startSection === 1 && c.endSection === 10));
check('天大教师与教室不再串课',
  tjuParsed?.courses?.some(c => c.name === '高等数学' && c.teacher === '张三' && c.position === '50楼A124')
  && tjuParsed?.courses?.some(c => c.name === '大学物理' && c.teacher === '李四' && c.position === '31楼251')
  && tjuParsed?.courses?.some(c => c.name === '线性代数' && c.teacher === '王五' && c.position === '45楼B404'));
check('天大周次按位图解析', eq(tjuParsed?.courses?.find(c => c.name === '大学物理')?.weeks || [], [5, 7, 9, 11, 13, 15, 17, 19]));
check('天大学期周数取实际最大周次', tjuParsed?.totalWeeks === 19);
const bridgeMessages = [];
window.__portalNative = { postMessage: json => bridgeMessages.push(JSON.parse(json)) };
const indexMock = '<script>bg.form.addInput(form,"ids","123456");</script>';
globalThis.fetch = async url => {
  const target = String(url);
  if (target.endsWith('/eams/dataQuery.action')) return new Response(calendarRaw, { status: 200 });
  if (target.includes('innerIndex')) return new Response(indexMock, { status: 200 });
  if (target.includes('index.action')) return new Response(indexMock, { status: 200 });
  return new Response('', { status: 404 });
};
try {
  tju.start();
  await new Promise(resolve => setImmediate(resolve));
} finally {
  globalThis.fetch = originalFetch;
}
check('天大完整流程能弹出学期选择而非报无学期', bridgeMessages.some(m => m.action === 'chooseTerm')
  && !bridgeMessages.some(m => m.action === 'toast' && m.text.includes('未返回学期列表')));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
