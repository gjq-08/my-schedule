// test-migration.mjs - v3.0 阶段1：/migration 路由与 CORS 的 mock 用例
import { handleApp } from './functions/handler.mjs';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

const MIGRATION_ID = '00000000-0000-0000-0000-000000000002';

function mockSupabase({ row = null, fail = false } = {}) {
  const state = { row, upserts: [] };
  const chain = (op) => {
    const c = {
      select: () => c,
      eq: () => c,
      order: () => c,
      not: () => c,
      maybeSingle: async () => fail ? { data: null, error: { message: 'boom' } } : { data: state.row, error: null },
      single: async () => fail ? { data: null, error: { message: 'boom' } } : { data: state.row, error: null },
      upsert: async (vals) => {
        state.upserts.push(vals);
        if (fail) return { data: null, error: { message: 'boom' } };
        state.row = vals;
        return { data: vals, error: null };
      },
      then: (resolve) => resolve(fail ? { data: null, error: { message: 'boom' } } : { data: [], error: null }),
    };
    return c;
  };
  return { state, from: () => chain() };
}

const req = (path, method = 'GET', body) => new Request(`https://site.example/functions/v1/app${path}`, {
  method,
  headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
});

const run = (path, method, body, db) => handleApp({ request: req(path, method, body), supabase: db || mockSupabase() });

// 1. OPTIONS 预检
{
  const r = await run('/migration', 'OPTIONS');
  check('OPTIONS /migration 204', r.status === 204);
  check('OPTIONS /migration ACAO *', r.headers.get('access-control-allow-origin') === '*');
  check('OPTIONS 允许 PUT', (r.headers.get('access-control-allow-methods') || '').includes('PUT'));
  const b = await run('/bootstrap', 'OPTIONS');
  check('OPTIONS /bootstrap 204', b.status === 204);
  const c = await run('/courses', 'OPTIONS');
  check('OPTIONS /courses 不放行(404)', c.status === 404);
}

// 2. GET 空
{
  const r = await run('/migration');
  const d = await r.json();
  check('GET 空 payload null', r.status === 200 && d.payload === null && d.uploaded_at === null);
  check('GET 带 CORS', r.headers.get('access-control-allow-origin') === '*');
}

// 3. PUT 正常 + 回读
{
  const db = mockSupabase();
  const payload = { todos: [{ id: 't1', title: '写作业' }], countdowns: [{ id: 'c1', title: '四级' }], reminderSettings: { activity: { sound: true } } };
  const r = await run('/migration', 'PUT', payload, db);
  const d = await r.json();
  check('PUT ok', r.status === 200 && d.ok === true);
  check('PUT counts', d.counts.todos === 1 && d.counts.countdowns === 1);
  check('PUT 固定 id', db.state.upserts[0]?.id === MIGRATION_ID);
  check('PUT uploaded_at ISO', !isNaN(Date.parse(d.uploaded_at)));
  const g = await run('/migration', 'GET', undefined, db);
  const gd = await g.json();
  check('回读 payload 一致', JSON.stringify(gd.payload) === JSON.stringify(payload));
}

// 4. PUT 缺省键补默认
{
  const db = mockSupabase();
  const r = await run('/migration', 'PUT', { todos: [] }, db);
  const d = await r.json();
  const stored = db.state.upserts[0].payload;
  check('缺省 countdowns 补 []', r.status === 200 && Array.isArray(stored.countdowns) && stored.countdowns.length === 0);
  check('缺省 reminderSettings 补 null', stored.reminderSettings === null && d.counts.countdowns === 0);
}

// 5. 校验拒绝
{
  const bad1 = await run('/migration', 'PUT', 'not json');
  check('非 JSON 400', bad1.status === 400 && (await bad1.json()).error === 'invalid_body');
  const bad2 = await run('/migration', 'PUT', [1, 2]);
  check('数组 body 400', bad2.status === 400);
  const bad3 = await run('/migration', 'PUT', { todos: 'x' });
  check('todos 非数组 400', bad3.status === 400 && (await bad3.json()).error === 'invalid_todos');
  const bad4 = await run('/migration', 'PUT', { countdowns: {} });
  check('countdowns 非数组 400', bad4.status === 400 && (await bad4.json()).error === 'invalid_countdowns');
  const bad5 = await run('/migration', 'PUT', { reminderSettings: [] });
  check('reminderSettings 数组 400', bad5.status === 400 && (await bad5.json()).error === 'invalid_reminder_settings');
}

// 6. 超大 payload
{
  const big = { todos: [{ id: 'x', note: 'a'.repeat(2 * 1024 * 1024) }] };
  const r = await run('/migration', 'PUT', big);
  check('超 2MB 413', r.status === 413 && (await r.json()).error === 'payload_too_large');
}

// 7. 数据库错误
{
  const db = mockSupabase({ fail: true });
  const g = await run('/migration', 'GET', undefined, db);
  check('GET db 失败 503', g.status === 503 && g.headers.get('access-control-allow-origin') === '*');
  const p = await run('/migration', 'PUT', { todos: [] }, db);
  check('PUT db 失败 503', p.status === 503);
}

// 8. 覆盖语义（第二次 PUT 替换）
{
  const db = mockSupabase();
  await run('/migration', 'PUT', { todos: [{ id: 1 }, { id: 2 }] }, db);
  await run('/migration', 'PUT', { todos: [{ id: 3 }] }, db);
  const g = await run('/migration', 'GET', undefined, db);
  const d = await g.json();
  check('第二次 PUT 覆盖', d.payload.todos.length === 1 && d.payload.todos[0].id === 3);
}

// 9. bootstrap 带 CORS
{
  const db = mockSupabase();
  const r = await run('/bootstrap');
  check('bootstrap 200 + CORS', r.status === 200 && r.headers.get('access-control-allow-origin') === '*');
  const d = await r.json();
  check('bootstrap 七键齐全', ['semesters', 'holidays', 'courses', 'exceptions', 'activities', 'tags', 'settings'].every(k => k in d));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);