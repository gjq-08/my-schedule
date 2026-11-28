// test-first-run.mjs - v3.0 阶段2：首次导入 / 快照兜底 / 导入后零网络
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k),
};

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}
async function expectError(name, fn, code, status) {
  try { await fn(); check(name, false, 'no throw'); }
  catch (e) { check(name, e.code === code && e.status === status, `got ${e.code}/${e.status}`); }
}

const { ApiError } = await import('./web/js/errors.js');
const s = await import('./web/js/store.js');
const fr = await import('./web/js/first-run.js');

// 仓库展示版 CLOUD_IMPORT_BASE 为空串，云端地址拼出来就是相对路径
const boot = (h) => handlers['/bootstrap'] = h;
const mig = (h) => handlers['/migration'] = h;
const snap = (h) => handlers['js/seed-data.json'] = h;

const bootData = () => ({
  semesters: [{ id: 's1', name: '秋', start_monday: '2026-09-07', total_weeks: 19 }],
  holidays: [{ id: 'h1', date: '2026-10-01', name: '国庆' }],
  courses: Array.from({ length: 37 }, (_, i) => ({ id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, name: `课${i}`, weekday: (i % 7) + 1, start_period: 1, end_period: 2, week_start: 1, week_end: 18, parity: 'all', teacher: null, location: null, color: null, note: null })),
  exceptions: [], activities: [], tags: [],
  settings: { sound: true, vibrate: false, notify: true },
});
const migData = () => ({
  payload: {
    todos: [{ id: 't1', title: '物理实验' }, { id: 't2', title: '数学作业' }],
    countdowns: [{ id: 'c1', title: '四级' }],
    reminderSettings: { todo: { sound: true, vibrate: true, notify: true }, activity: { sound: true, vibrate: true, notify: true } },
  },
  uploaded_at: '2026-11-22T14:39:24.546+00:00',
});

// fetch 桩：按 URL 路由，支持抛错型桩，记录调用次数
let calls = [];
let handlers = {};
globalThis.fetch = async (url) => {
  calls.push(String(url));
  const h = handlers[String(url)];
  if (typeof h === 'function') return h();
  if (!h) return { ok: false, status: 404, async text() { return 'not found'; }, async json() { throw new SyntaxError('nope'); } };
  return h;
};
const jsonResponse = (obj, status = 200) => ({
  ok: status < 400,
  status,
  async text() { return JSON.stringify(obj); },
  async json() { return JSON.parse(JSON.stringify(obj)); },
});

function resetStubs() {
  calls = [];
  ls.clear();
  handlers = {};
}

// === 1. 云端导入成功 ===
resetStubs();
{
  boot(jsonResponse(bootData()));
  mig(jsonResponse(migData()));
  const res = await fr.importFromCloud();
  check('来源 cloud', res.source === 'cloud');
  check('counts 正确', res.counts.courses === 37 && res.counts.todos === 2 && res.counts.countdowns === 1, JSON.stringify(res.counts));
  check('appData 已写入', s.isReady() === true);
  const all = s.getAll();
  check('课程落地', all.courses.length === 37 && all.settings.vibrate === false && all.settings.notify === true);
  check('待办落地', JSON.parse(ls.get('todos')).length === 2);
  check('倒计日落地上', JSON.parse(ls.get('countdowns'))[0].title === '四级');
  check('提醒开关落地', JSON.parse(ls.get('reminderSettings')).todo.notify === true);
  check('meta 记录导入时间', !isNaN(Date.parse(s.getMeta().importedAt)));
  check('恰好两次请求', calls.length === 2, calls.join(','));
}

// === 2. 暂存为空 ===
resetStubs();
{
  boot(jsonResponse(bootData()));
  mig(jsonResponse({ payload: null, uploaded_at: null }));
  const res = await fr.importFromCloud();
  check('空暂存 counts 为 0', res.counts.todos === 0 && res.counts.countdowns === 0);
  check('空暂存写回空数组', JSON.parse(ls.get('todos')).length === 0);
  check('空暂存不动提醒开关', localStorage.getItem('reminderSettings') === null);
}

// === 3. 暂存字段异常（脏数据不阻断导入）===
resetStubs();
{
  boot(jsonResponse(bootData()));
  mig(jsonResponse({ payload: { todos: 'oops', countdowns: null, reminderSettings: [1] } }));
  const res = await fr.importFromCloud();
  check('脏 todos 归零', res.counts.todos === 0 && res.counts.countdowns === 0);
  check('数组型 reminderSettings 不写回', localStorage.getItem('reminderSettings') === null);
}

// === 4. 失败路径 ===
resetStubs();
{
  handlers["/bootstrap"] = () => { throw new TypeError('fetch failed'); };
  mig(jsonResponse(migData()));
  await expectError('请求未送达 network_error', fr.importFromCloud, 'network_error', 0);

  resetStubs();
  boot(jsonResponse({ error: 'database_request_failed' }, 503));
  mig(jsonResponse(migData()));
  await expectError('503 透出状态码', fr.importFromCloud, 'database_request_failed', 503);

  resetStubs();
  handlers["/bootstrap"] = { ok: true, status: 200, async text() { return '<!DOCTYPE html><html>...</html>'; } };
  mig(jsonResponse(migData()));
  await expectError('网关返回 HTML 页 invalid_response', fr.importFromCloud, 'invalid_response', 200);

  resetStubs();
  boot(jsonResponse(bootData()));
  handlers["/migration"] = { ok: true, status: 200, async text() { return '<html>'; } };
  await expectError('暂存非 JSON 也报错', fr.importFromCloud, 'invalid_response', 200);
}

// === 5. 快照兜底 ===
resetStubs();
{
  ls.set('todos', JSON.stringify([{ id: 'keep' }]));
  snap(jsonResponse(bootData()));
  const res = await fr.importFromSnapshot();
  check('来源 snapshot', res.source === 'snapshot');
  check('快照 counts 复用本机待办', res.counts.todos === 1 && res.counts.courses === 37);
  check('快照不覆盖待办', JSON.parse(ls.get('todos'))[0].id === 'keep');
  check('快照数据可读', s.getAll().courses.length === 37);

  // 演示快照自带 todos/countdowns
  resetStubs();
  snap(jsonResponse({ ...bootData(), todos: [{ id: 'd1' }, { id: 'd2' }], countdowns: [{ id: 'dc1' }] }));
  const seeded = await fr.importFromSnapshot();
  check('自带待办的快照会写入 localStorage', JSON.parse(ls.get('todos')).length === 2);
  check('自带倒计日的快照会写入 localStorage', JSON.parse(ls.get('countdowns'))[0].id === 'dc1');
  check('自带数据的快照 counts 取自快照', seeded.counts.todos === 2 && seeded.counts.countdowns === 1, JSON.stringify(seeded.counts));

  resetStubs();
  snap({ ok: false, status: 404, async text() { return 'nope'; } });
  await expectError('快照缺失 snapshot_missing', fr.importFromSnapshot, 'snapshot_missing', 404);
}

// === 6. 导入后全程零网络（门面回归）===
resetStubs();
{
  snap(jsonResponse(bootData()));
  const api = await import('./web/js/api.js');
  await api.fetchBootstrap();
  const before = calls.length;
  check('未配置云端时首启读快照', calls.slice(-1)[0] === 'js/seed-data.json', calls.join(','));
  const data = await api.fetchBootstrap();
  check('二次 bootstrap 不再联网', calls.length === before && data.courses.length === 37);

  const created = await api.createCourse({ name: '离线新增', weekday: 2, start_period: 3, end_period: 4, week_start: 1, week_end: 16, parity: 'odd' });
  check('createCourse 走本地', created.id.length === 36);
  const list = await api.fetchCourses();
  check('fetchCourses 含新增', list.length === 38 && list.some(c => c.name === '离线新增'));
  await api.updateCourse(created.id, { name: '离线改名', weekday: 2, start_period: 3, end_period: 4, week_start: 1, week_end: 16, parity: 'odd' });
  check('updateCourse 生效', (await api.fetchCourses()).some(c => c.name === '离线改名'));
  await api.deleteCourse(created.id);
  check('deleteCourse 生效', (await api.fetchCourses()).length === 37);
  const st = await api.updateSettings({ sound: false, vibrate: false, notify: false });
  check('updateSettings 走本地', st.notify === false);
  check('门面 CRUD 零请求', calls.length === before, `extra: ${calls.slice(before).join(',')}`);
  const tags = await api.createTag({ name: '离线标签', color: '#4A9FE8' });
  const act = await api.createActivity({ title: '离线活动', date: '2026-12-01', all_day: true, tag_id: tags.id });
  await api.deleteTag(tags.id);
  check('删标签级联在门面下同样生效', (await api.fetchActivities()).find(a => a.id === act.id).tag_id === null);
  check('导出符号齐全', typeof api.describeApiError === 'function' && api.ApiError === ApiError);
}

// === 7. 云端导入失败时的错误文案 ===
{
  resetStubs();
  handlers["/bootstrap"] = () => { throw new TypeError('fetch failed'); };
  mig(jsonResponse({ payload: null }));
  try {
    await fr.importFromCloud();
    check('云端不可达时抛错', false, 'no throw');
  } catch (e) {
    check('云端不可达时抛错', e.code === 'network_error');
    check('文案可操作', (await import('./web/js/api.js')).describeApiError(e).includes('连不上服务器'));
  }
}

// === 8. 首启入口按配置分流 ===
{
  resetStubs();
  check('未配置云端时 isCloudImportEnabled 为假', fr.isCloudImportEnabled() === false);
  snap(jsonResponse(bootData()));
  boot(jsonResponse(bootData()));
  mig(jsonResponse(migData()));
  const res = await fr.importOnFirstRun();
  check('首启走快照分支', res.source === 'snapshot');
  check('首启未碰云端', calls.every(c => c === 'js/seed-data.json'), calls.join(','));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);