// test-store.mjs - v3.0 阶段2：本地存储层校验与级联语义用例（对齐 functions/handler.mjs）
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const s = await import('./web/js/store.js');
const { ApiError } = await import('./web/js/errors.js');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}
function expectFail(name, fn, code) {
  try { fn(); check(name, false, 'no throw'); }
  catch (e) { check(name, e instanceof ApiError && e.code === code, `got ${e.code}`); }
}

function reset(data) {
  store.clear();
  if (data) store.set('appData', JSON.stringify(data));
  else {
    store.set('appData', JSON.stringify({ semesters: [], holidays: [], courses: [], exceptions: [], activities: [], tags: [], settings: { sound: true, vibrate: true, notify: false } }));
  }
}

const validCourse = { name: '高等数学', teacher: '王老师', location: 'A101', weekday: 1, start_period: 1, end_period: 2, week_start: 1, week_end: 18, parity: 'all' };
const uuid_re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// === 课程校验（与 handler.mjs 逐条对齐）===
reset();
{
  const c = s.createCourse(validCourse);
  check('createCourse 返回 uuid', uuid_re.test(c.id));
  check('createCourse 保留字段', c.name === '高等数学' && c.weekday === 1 && c.parity === 'all');
  check('listCourses 含新行', s.listCourses().length === 1);
  expectFail('空 name 拒绝', () => s.createCourse({ ...validCourse, name: '' }), 'invalid_name');
  expectFail('weekday 8 拒绝', () => s.createCourse({ ...validCourse, weekday: 8 }), 'invalid_weekday');
  expectFail('weekday 非整数拒绝', () => s.createCourse({ ...validCourse, weekday: 1.5 }), 'invalid_weekday');
  expectFail('start_period 0 拒绝', () => s.createCourse({ ...validCourse, start_period: 0 }), 'invalid_start_period');
  expectFail('end_period 15 拒绝', () => s.createCourse({ ...validCourse, end_period: 15 }), 'invalid_end_period');
  expectFail('节次倒挂拒绝', () => s.createCourse({ ...validCourse, start_period: 5, end_period: 3 }), 'invalid_period_range');
  expectFail('week_end 31 拒绝', () => s.createCourse({ ...validCourse, week_end: 31 }), 'invalid_week_end');
  expectFail('周次倒挂拒绝', () => s.createCourse({ ...validCourse, week_start: 10, week_end: 5 }), 'invalid_week_range');
  expectFail('parity 非法拒绝', () => s.createCourse({ ...validCourse, parity: 'odd_week' }), 'invalid_parity');
  expectFail('body 非对象拒绝', () => s.createCourse(null), 'invalid_body');
}

// 截断长度
reset();
{
  const c = s.createCourse({ ...validCourse, name: 'n'.repeat(150), teacher: 't'.repeat(80), location: 'l'.repeat(150), color: 'c'.repeat(30), note: 'x'.repeat(600) });
  check('name 截断 100', c.name.length === 100);
  check('teacher 截断 50', c.teacher.length === 50);
  check('location 截断 100', c.location.length === 100);
  check('color 截断 20', c.color.length === 20);
  check('note 截断 500', c.note.length === 500);
  const n = s.createCourse({ name: '无可选字段', weekday: 4, start_period: 1, end_period: 1, week_start: 1, week_end: 8, parity: 'odd' });
  check('可选字段缺省为 null', n.teacher === null && n.location === null && n.color === null && n.note === null);
}

// 更新与排序
reset();
{
  const a = s.createCourse({ ...validCourse, name: '周三课', weekday: 3, start_period: 5, end_period: 6 });
  const b = s.createCourse({ ...validCourse, name: '周一晚课', weekday: 1, start_period: 11, end_period: 12 });
  const order = s.listCourses().map(c => c.name);
  check('按 weekday+start_period 排序', JSON.stringify(order) === JSON.stringify(['周一晚课', '周三课']), order.join(','));
  const upd = s.updateCourse(a.id, { ...validCourse, name: '改名了', weekday: 2 });
  check('updateCourse 保留 id', upd.id === a.id && upd.name === '改名了' && upd.weekday === 2);
  expectFail('update 不存在 404', () => s.updateCourse('00000000-0000-0000-0000-000000000000', validCourse), 'not_found');
  expectFail('delete 不存在 404', () => s.deleteCourse('00000000-0000-0000-0000-000000000000'), 'not_found');
}

// 级联删除调课
reset();
{
  const c = s.createCourse(validCourse);
  s.createException({ course_id: c.id, type: 'cancel', orig_date: '2026-11-25' });
  s.createException({ course_id: c.id, type: 'cancel', orig_date: '2026-11-26' });
  check('删除前 2 条调课', s.listExceptions().length === 2);
  s.deleteCourse(c.id);
  check('删课程级联删调课', s.listExceptions().length === 0 && s.listCourses().length === 0);
}

// === 调课校验 ===
reset();
{
  const c = s.createCourse(validCourse);
  const e = s.createException({ course_id: c.id, type: 'cancel', orig_date: '2026-11-25' });
  check('cancel 建立', uuid_re.test(e.id) && e.orig_date === '2026-11-25' && e.new_date === null);
  expectFail('course_id 非 uuid', () => s.createException({ course_id: 'abc', type: 'cancel', orig_date: '2026-11-25' }), 'invalid_course_id');
  expectFail('type 非法', () => s.createException({ course_id: c.id, type: 'skip', orig_date: '2026-11-25' }), 'invalid_type');
  expectFail('cancel 缺 orig_date', () => s.createException({ course_id: c.id, type: 'cancel' }), 'invalid_orig_date');
  expectFail('cancel 日期格式错', () => s.createException({ course_id: c.id, type: 'cancel', orig_date: '2026/11/25' }), 'invalid_orig_date');
  expectFail('move 缺 new_date', () => s.createException({ course_id: c.id, type: 'move', orig_date: '2026-11-25', new_start_period: 1, new_end_period: 2 }), 'invalid_new_date');
  expectFail('move 缺节次', () => s.createException({ course_id: c.id, type: 'move', orig_date: '2026-11-25', new_date: '2026-11-26' }), 'invalid_new_start_period');
  expectFail('add 缺 new_date', () => s.createException({ course_id: c.id, type: 'add', new_start_period: 1, new_end_period: 2 }), 'invalid_new_date');
  const mv = s.createException({ course_id: c.id, type: 'move', orig_date: '2026-11-25', new_date: '2026-11-26', new_start_period: 3, new_end_period: 4, new_location: 'B202' });
  check('move 全字段', mv.new_start_period === 3 && mv.new_location === 'B202');
  expectFail('deleteException 不存在', () => s.deleteException('00000000-0000-0000-0000-000000000000'), 'not_found');
  s.deleteException(e.id);
  check('deleteException 生效', s.listExceptions().length === 1);
}

// === 活动校验 ===
reset();
{
  const a = s.createActivity({ title: '组会', date: '2026-11-23', start_time: '14:00', end_time: '15:30', all_day: false });
  check('活动建立', uuid_re.test(a.id) && a.date === '2026-11-23' && a.remind_minutes === null);
  expectFail('空 title', () => s.createActivity({ title: '', date: '2026-11-23', all_day: false }), 'invalid_title');
  expectFail('日期格式', () => s.createActivity({ title: 'x', date: '2026-11-3', all_day: false }), 'invalid_date');
  expectFail('all_day 必须布尔', () => s.createActivity({ title: 'x', date: '2026-11-23', all_day: 'yes' }), 'invalid_all_day');
  expectFail('时间格式', () => s.createActivity({ title: 'x', date: '2026-11-23', all_day: false, start_time: '9:00' }), 'invalid_start_time');
  expectFail('end_time 格式', () => s.createActivity({ title: 'x', date: '2026-11-23', all_day: false, end_time: '9:00' }), 'invalid_end_time');
  expectFail('remind 非法值', () => s.createActivity({ title: 'x', date: '2026-11-23', all_day: false, remind_minutes: 10 }), 'invalid_remind_minutes');
  expectFail('tag_id 非 uuid', () => s.createActivity({ title: 'x', date: '2026-11-23', all_day: false, tag_id: 'tag1' }), 'invalid_tag_id');
  for (const m of [5, 15, 30, 60]) {
    check(`remind ${m} 通过`, s.createActivity({ title: `r${m}`, date: '2026-11-23', all_day: false, remind_minutes: m }).remind_minutes === m);
  }
  reset();
  const trunc = s.createActivity({ title: 't'.repeat(250), date: '2026-11-23', all_day: false, location: 'l'.repeat(150), note: 'n'.repeat(1200) });
  check('活动截断 200/100/1000', trunc.title.length === 200 && trunc.location.length === 100 && trunc.note.length === 1000);
}

reset();
{
  s.createActivity({ title: '晚', date: '2026-11-24', start_time: '19:00', all_day: false });
  s.createActivity({ title: '早', date: '2026-11-23', all_day: true });
  s.createActivity({ title: '下午', date: '2026-11-24', start_time: '14:00', all_day: false });
  const order = s.listActivities().map(a => a.title);
  check('按 date+start_time 排序', JSON.stringify(order) === JSON.stringify(['早', '下午', '晚']), order.join(','));
  const upd = s.updateActivity(s.listActivities()[0].id, { title: '改名', date: '2026-11-24', all_day: true });
  check('updateActivity 保留 id', upd.title === '改名' && upd.start_time === null);
  expectFail('update 不存在', () => s.updateActivity('00000000-0000-0000-0000-000000000000', { title: 'x', date: '2026-11-23', all_day: true }), 'not_found');
}

// === 标签 ===
reset();
{
  const t = s.createTag({ name: '学习', color: '#4A9FE8' });
  check('标签建立', uuid_re.test(t.id) && t.name === '学习');
  expectFail('缺 color', () => s.createTag({ name: 'x' }), 'invalid_color');
  expectFail('缺 name', () => s.createTag({ color: '#fff' }), 'invalid_name');
  s.createActivity({ title: '带标签', date: '2026-11-23', all_day: true, tag_id: t.id });
  check('活动绑定标签', s.listActivities()[0].tag_id === t.id);
  s.deleteTag(t.id);
  check('删标签置空活动 tag_id', s.listActivities()[0].tag_id === null && s.listTags().length === 0);
  expectFail('deleteTag 不存在', () => s.deleteTag('00000000-0000-0000-0000-000000000000'), 'not_found');
}

// === 设置 ===
reset();
{
  check('默认设置', s.getSettings().sound === true && s.getSettings().notify === false);
  const st = s.updateSettings({ sound: false, vibrate: true, notify: true });
  check('设置更新', st.sound === false && st.notify === true);
  expectFail('非布尔拒绝', () => s.updateSettings({ sound: 'yes', vibrate: true, notify: false }), 'invalid_settings');
  expectFail('缺字段拒绝', () => s.updateSettings({ sound: true }), 'invalid_settings');
}

// === 读取与初始化 ===
{
  store.clear();
  check('无 appData 时未就绪', s.isReady() === false);
  store.set('appData', '{ broken json');
  check('损坏 JSON 视为未就绪', s.isReady() === false);
  store.set('appData', JSON.stringify({ courses: [] }));
  check('缺集合时容错为空数据', s.isReady() === true);
  const partial = s.getAll();
  check('缺集合读回时补默认', Array.isArray(partial.semesters) && partial.semesters.length === 0 && partial.settings.notify === false);

  s.importAll({
    semesters: [{ id: 'a', name: '春', start_monday: '2027-03-01', total_weeks: 18 }, { id: 'b', name: '秋', start_monday: '2026-09-07', total_weeks: 19 }],
    holidays: [{ id: 'h2', date: '2026-10-01', name: '国庆' }, { id: 'h1', date: '2026-09-25', name: '中秋' }],
    courses: [], exceptions: [], activities: [], tags: [],
  }, { source: 'cloud', importedAt: '2026-11-22T00:00:00Z', counts: { courses: 0 } });
  check('导入后就绪', s.isReady() === true);
  const all = s.getAll();
  check('学期按 start_monday 排序', all.semesters[0].name === '秋');
  check('节假日按 date 排序', all.holidays[0].name === '中秋');
  check('导入时缺省集合补齐', Array.isArray(all.activities) && all.settings.notify === false);
  check('meta 记录来源', s.getMeta().source === 'cloud');
  store.delete('appData');
  expectFail('getAll 未初始化时报错', () => s.getAll(), 'local_data_missing');
}

// === 持久化（写入即落 localStorage）===
reset();
{
  const c = s.createCourse(validCourse);
  const raw = JSON.parse(store.get('appData'));
  check('写入即时持久化', raw.courses.length === 1 && raw.courses[0].id === c.id);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);