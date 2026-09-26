// handler.mjs - 完整后端 API
const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" },
});

const uuid_re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const date_re = /^\d{4}-\d{2}-\d{2}$/;
const time_re = /^\d{2}:\d{2}$/;

function extractPath(url) {
  const full = new URL(url).pathname;
  // Try standard format first
  const idx = full.indexOf("/functions/v1/app");
  if (idx !== -1) return full.slice(idx + "/functions/v1/app".length) || "/";
  // Handle internal routing: /app-{deploymentId}/path
  const appMatch = full.match(/^\/app-[a-f0-9]+(\/.*)?$/);
  if (appMatch) return appMatch[1] || "/";
  return "/";
}

async function readJson(request) {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validateUuid(id) {
  return typeof id === "string" && uuid_re.test(id);
}

export async function handleApp({ request, supabase }) {
  const path = extractPath(request.url);
  const method = request.method;
  try {
    // Health check
    if (path === "/health" && method === "GET") {
      return json({ status: "ok" });
    }

    // Bootstrap: all data at once
    if (path === "/bootstrap" && method === "GET") {
      return await handleBootstrap(supabase);
    }

    // Courses CRUD
    if (path === "/courses" && method === "GET") return await handleListCourses(supabase);
    if (path === "/courses" && method === "POST") return await handleCreateCourse(request, supabase);
    const courseMatch = path.match(/^\/courses\/([^/]+)$/);
    if (courseMatch) {
      const id = courseMatch[1];
      if (!validateUuid(id)) return json({ error: "invalid_id" }, 400);
      if (method === "PUT") return await handleUpdateCourse(id, request, supabase);
      if (method === "DELETE") return await handleDeleteCourse(id, supabase);
    }

    // Exceptions CRUD
    if (path === "/exceptions" && method === "GET") return await handleListExceptions(supabase);
    if (path === "/exceptions" && method === "POST") return await handleCreateException(request, supabase);
    const excMatch = path.match(/^\/exceptions\/([^/]+)$/);
    if (excMatch) {
      const id = excMatch[1];
      if (!validateUuid(id)) return json({ error: "invalid_id" }, 400);
      if (method === "DELETE") return await handleDeleteException(id, supabase);
    }

    // Activities CRUD
    if (path === "/activities" && method === "GET") return await handleListActivities(supabase);
    if (path === "/activities" && method === "POST") return await handleCreateActivity(request, supabase);
    const actMatch = path.match(/^\/activities\/([^/]+)$/);
    if (actMatch) {
      const id = actMatch[1];
      if (!validateUuid(id)) return json({ error: "invalid_id" }, 400);
      if (method === "PUT") return await handleUpdateActivity(id, request, supabase);
      if (method === "DELETE") return await handleDeleteActivity(id, supabase);
    }

    // Tags CRUD
    if (path === "/tags" && method === "GET") return await handleListTags(supabase);
    if (path === "/tags" && method === "POST") return await handleCreateTag(request, supabase);
    const tagMatch = path.match(/^\/tags\/([^/]+)$/);
    if (tagMatch) {
      const id = tagMatch[1];
      if (!validateUuid(id)) return json({ error: "invalid_id" }, 400);
      if (method === "DELETE") return await handleDeleteTag(id, supabase);
    }

    // Settings
    if (path === "/settings" && method === "GET") return await handleGetSettings(supabase);
    if (path === "/settings" && method === "PUT") return await handleUpdateSettings(request, supabase);

    // Seed endpoint (for initial data population)
    if (path === "/seed" && method === "POST") return await handleSeed(request, supabase);

    return json({ error: "not_found" }, 404);
  } catch (err) {
    return json({ error: "internal_error" }, 503);
  }
}

// === Bootstrap ===
async function handleBootstrap(supabase) {
  const [semesters, holidays, courses, exceptions, activities, tags, settings] = await Promise.all([
    supabase.from("semesters").select("id,name,start_monday,total_weeks").order("start_monday"),
    supabase.from("holidays").select("id,date,name").order("date"),
    supabase.from("courses").select("*").order("weekday"),
    supabase.from("course_exceptions").select("*"),
    supabase.from("activities").select("*").order("date"),
    supabase.from("tags").select("*").order("name"),
    handleGetSettingsRaw(supabase),
  ]);

  if (semesters.error || holidays.error || courses.error || exceptions.error || activities.error || tags.error) {
    return json({ error: "database_request_failed" }, 503);
  }

  return json({
    semesters: semesters.data || [],
    holidays: holidays.data || [],
    courses: courses.data || [],
    exceptions: exceptions.data || [],
    activities: activities.data || [],
    tags: tags.data || [],
    settings: settings,
  });
}

// === Courses ===
async function handleListCourses(supabase) {
  const { data, error } = await supabase.from("courses").select("*").order("weekday").order("start_period");
  if (error) return json({ error: "database_request_failed" }, 503);
  return json(data || []);
}

async function handleCreateCourse(request, supabase) {
  const body = await readJson(request);
  if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);

  const { name, teacher, location, weekday, start_period, end_period, week_start, week_end, parity, color, note } = body;
  if (!name || typeof name !== "string") return json({ error: "invalid_name" }, 400);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return json({ error: "invalid_weekday" }, 400);
  if (!Number.isInteger(start_period) || start_period < 1 || start_period > 14) return json({ error: "invalid_start_period" }, 400);
  if (!Number.isInteger(end_period) || end_period < 1 || end_period > 14) return json({ error: "invalid_end_period" }, 400);
  if (start_period > end_period) return json({ error: "invalid_period_range" }, 400);
  if (!Number.isInteger(week_start) || week_start < 1 || week_start > 30) return json({ error: "invalid_week_start" }, 400);
  if (!Number.isInteger(week_end) || week_end < 1 || week_end > 30) return json({ error: "invalid_week_end" }, 400);
  if (week_start > week_end) return json({ error: "invalid_week_range" }, 400);
  if (!["all", "odd", "even"].includes(parity)) return json({ error: "invalid_parity" }, 400);

  const id = crypto.randomUUID();
  const { data, error } = await supabase.from("courses").insert({
    id, name: name.slice(0, 100), teacher: teacher?.slice(0, 50) || null,
    location: location?.slice(0, 100) || null, weekday, start_period, end_period,
    week_start, week_end, parity, color: color?.slice(0, 20) || null,
    note: note?.slice(0, 500) || null,
  }).select("*").single();

  if (error) return json({ error: "database_request_failed" }, 503);
  return json(data, 201);
}

async function handleUpdateCourse(id, request, supabase) {
  const body = await readJson(request);
  if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);

  const { name, teacher, location, weekday, start_period, end_period, week_start, week_end, parity, color, note } = body;
  if (!name || typeof name !== "string") return json({ error: "invalid_name" }, 400);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return json({ error: "invalid_weekday" }, 400);
  if (!Number.isInteger(start_period) || start_period < 1 || start_period > 14) return json({ error: "invalid_start_period" }, 400);
  if (!Number.isInteger(end_period) || end_period < 1 || end_period > 14) return json({ error: "invalid_end_period" }, 400);
  if (start_period > end_period) return json({ error: "invalid_period_range" }, 400);
  if (!Number.isInteger(week_start) || week_start < 1 || week_start > 30) return json({ error: "invalid_week_start" }, 400);
  if (!Number.isInteger(week_end) || week_end < 1 || week_end > 30) return json({ error: "invalid_week_end" }, 400);
  if (week_start > week_end) return json({ error: "invalid_week_range" }, 400);
  if (!["all", "odd", "even"].includes(parity)) return json({ error: "invalid_parity" }, 400);

  const { data, error } = await supabase.from("courses").update({
    name: name.slice(0, 100), teacher: teacher?.slice(0, 50) || null,
    location: location?.slice(0, 100) || null, weekday, start_period, end_period,
    week_start, week_end, parity, color: color?.slice(0, 20) || null,
    note: note?.slice(0, 500) || null,
  }).eq("id", id).select("*").maybeSingle();

  if (error) return json({ error: "database_request_failed" }, 503);
  if (!data) return json({ error: "not_found" }, 404);
  return json(data);
}

async function handleDeleteCourse(id, supabase) {
  const { data, error } = await supabase.from("courses").delete().eq("id", id).select("id").maybeSingle();
  if (error) return json({ error: "database_request_failed" }, 503);
  if (!data) return json({ error: "not_found" }, 404);
  // Also delete related exceptions
  await supabase.from("course_exceptions").delete().eq("course_id", id);
  return json({ ok: true });
}

// === Exceptions ===
async function handleListExceptions(supabase) {
  const { data, error } = await supabase.from("course_exceptions").select("*").order("orig_date");
  if (error) return json({ error: "database_request_failed" }, 503);
  return json(data || []);
}

async function handleCreateException(request, supabase) {
  const body = await readJson(request);
  if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);

  const { course_id, type, orig_date, new_date, new_start_period, new_end_period, new_location } = body;
  if (!validateUuid(course_id)) return json({ error: "invalid_course_id" }, 400);
  if (!["cancel", "move", "add"].includes(type)) return json({ error: "invalid_type" }, 400);

  if (type === "cancel") {
    if (!orig_date || !date_re.test(orig_date)) return json({ error: "invalid_orig_date" }, 400);
  }
  if (type === "move") {
    if (!orig_date || !date_re.test(orig_date)) return json({ error: "invalid_orig_date" }, 400);
    if (!new_date || !date_re.test(new_date)) return json({ error: "invalid_new_date" }, 400);
    if (!Number.isInteger(new_start_period) || new_start_period < 1 || new_start_period > 14) return json({ error: "invalid_new_start_period" }, 400);
    if (!Number.isInteger(new_end_period) || new_end_period < 1 || new_end_period > 14) return json({ error: "invalid_new_end_period" }, 400);
  }
  if (type === "add") {
    if (!new_date || !date_re.test(new_date)) return json({ error: "invalid_new_date" }, 400);
    if (!Number.isInteger(new_start_period) || new_start_period < 1 || new_start_period > 14) return json({ error: "invalid_new_start_period" }, 400);
    if (!Number.isInteger(new_end_period) || new_end_period < 1 || new_end_period > 14) return json({ error: "invalid_new_end_period" }, 400);
  }

  const id = crypto.randomUUID();
  const { data, error } = await supabase.from("course_exceptions").insert({
    id, course_id, type,
    orig_date: orig_date || null,
    new_date: new_date || null,
    new_start_period: new_start_period || null,
    new_end_period: new_end_period || null,
    new_location: new_location?.slice(0, 100) || null,
  }).select("*").single();

  if (error) return json({ error: "database_request_failed" }, 503);
  return json(data, 201);
}

async function handleDeleteException(id, supabase) {
  const { data, error } = await supabase.from("course_exceptions").delete().eq("id", id).select("id").maybeSingle();
  if (error) return json({ error: "database_request_failed" }, 503);
  if (!data) return json({ error: "not_found" }, 404);
  return json({ ok: true });
}

// === Activities ===
async function handleListActivities(supabase) {
  const { data, error } = await supabase.from("activities").select("*").order("date").order("start_time");
  if (error) return json({ error: "database_request_failed" }, 503);
  return json(data || []);
}

async function handleCreateActivity(request, supabase) {
  const body = await readJson(request);
  if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);

  const { title, date, start_time, end_time, all_day, location, tag_id, note, remind_minutes } = body;
  if (!title || typeof title !== "string") return json({ error: "invalid_title" }, 400);
  if (!date || !date_re.test(date)) return json({ error: "invalid_date" }, 400);
  if (typeof all_day !== "boolean") return json({ error: "invalid_all_day" }, 400);
  if (!all_day && start_time && !time_re.test(start_time)) return json({ error: "invalid_start_time" }, 400);
  if (end_time && !time_re.test(end_time)) return json({ error: "invalid_end_time" }, 400);
  if (tag_id !== null && tag_id !== undefined && !validateUuid(tag_id)) return json({ error: "invalid_tag_id" }, 400);
  if (remind_minutes !== null && remind_minutes !== undefined && ![5, 15, 30, 60].includes(remind_minutes)) return json({ error: "invalid_remind_minutes" }, 400);

  const id = crypto.randomUUID();
  const { data, error } = await supabase.from("activities").insert({
    id, title: title.slice(0, 200), date, start_time: start_time || null,
    end_time: end_time || null, all_day, location: location?.slice(0, 100) || null,
    tag_id: tag_id || null, note: note?.slice(0, 1000) || null,
    remind_minutes: remind_minutes ?? null,
  }).select("*").single();

  if (error) return json({ error: "database_request_failed" }, 503);
  return json(data, 201);
}

async function handleUpdateActivity(id, request, supabase) {
  const body = await readJson(request);
  if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);

  const { title, date, start_time, end_time, all_day, location, tag_id, note, remind_minutes } = body;
  if (!title || typeof title !== "string") return json({ error: "invalid_title" }, 400);
  if (!date || !date_re.test(date)) return json({ error: "invalid_date" }, 400);
  if (typeof all_day !== "boolean") return json({ error: "invalid_all_day" }, 400);
  if (!all_day && start_time && !time_re.test(start_time)) return json({ error: "invalid_start_time" }, 400);
  if (end_time && !time_re.test(end_time)) return json({ error: "invalid_end_time" }, 400);
  if (tag_id !== null && tag_id !== undefined && !validateUuid(tag_id)) return json({ error: "invalid_tag_id" }, 400);
  if (remind_minutes !== null && remind_minutes !== undefined && ![5, 15, 30, 60].includes(remind_minutes)) return json({ error: "invalid_remind_minutes" }, 400);

  const { data, error } = await supabase.from("activities").update({
    title: title.slice(0, 200), date, start_time: start_time || null,
    end_time: end_time || null, all_day, location: location?.slice(0, 100) || null,
    tag_id: tag_id || null, note: note?.slice(0, 1000) || null,
    remind_minutes: remind_minutes ?? null,
  }).eq("id", id).select("*").maybeSingle();

  if (error) return json({ error: "database_request_failed" }, 503);
  if (!data) return json({ error: "not_found" }, 404);
  return json(data);
}

async function handleDeleteActivity(id, supabase) {
  const { data, error } = await supabase.from("activities").delete().eq("id", id).select("id").maybeSingle();
  if (error) return json({ error: "database_request_failed" }, 503);
  if (!data) return json({ error: "not_found" }, 404);
  return json({ ok: true });
}

// === Tags ===
async function handleListTags(supabase) {
  const { data, error } = await supabase.from("tags").select("*").order("name");
  if (error) return json({ error: "database_request_failed" }, 503);
  return json(data || []);
}

async function handleCreateTag(request, supabase) {
  const body = await readJson(request);
  if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);

  const { name, color } = body;
  if (!name || typeof name !== "string") return json({ error: "invalid_name" }, 400);
  if (!color || typeof color !== "string") return json({ error: "invalid_color" }, 400);

  const id = crypto.randomUUID();
  const { data, error } = await supabase.from("tags").insert({
    id, name: name.slice(0, 50), color: color.slice(0, 20),
  }).select("*").single();

  if (error) return json({ error: "database_request_failed" }, 503);
  return json(data, 201);
}

async function handleDeleteTag(id, supabase) {
  const { data, error } = await supabase.from("tags").delete().eq("id", id).select("id").maybeSingle();
  if (error) return json({ error: "database_request_failed" }, 503);
  if (!data) return json({ error: "not_found" }, 404);
  // Nullify tag_id in activities
  await supabase.from("activities").update({ tag_id: null }).eq("tag_id", id);
  return json({ ok: true });
}

// === Settings ===
const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

async function handleGetSettingsRaw(supabase) {
  const { data, error } = await supabase.from("settings").select("*").eq("id", SETTINGS_ID).maybeSingle();
  if (error) return { sound: true, vibrate: true, notify: false };
  if (!data) return { sound: true, vibrate: true, notify: false };
  return { sound: data.sound, vibrate: data.vibrate, notify: data.notify };
}

async function handleGetSettings(supabase) {
  const settings = await handleGetSettingsRaw(supabase);
  return json(settings);
}

async function handleUpdateSettings(request, supabase) {
  const body = await readJson(request);
  if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);

  const { sound, vibrate, notify } = body;
  if (typeof sound !== "boolean" || typeof vibrate !== "boolean" || typeof notify !== "boolean") {
    return json({ error: "invalid_settings" }, 400);
  }

  // Upsert
  const { data, error } = await supabase.from("settings").upsert({
    id: SETTINGS_ID, sound, vibrate, notify,
  }).select("*").single();

  if (error) return json({ error: "database_request_failed" }, 503);
  return json({ sound: data.sound, vibrate: data.vibrate, notify: data.notify });
}

// === Seed ===
async function handleSeed(request, supabase) {
  const body = await readJson(request);
  if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);
  if (body.confirm !== true) return json({ error: "confirmation_required" }, 400);

  const results = {};

  // Seed semesters
  if (body.semesters && Array.isArray(body.semesters)) {
    if (body.replace_semesters === true) {
      const { error: delErr } = await supabase.from("semesters").delete().not("id", "is", null);
      if (delErr) return json({ error: "seed_clear_semesters_failed", detail: delErr.message }, 503);
    }
    const rows = body.semesters.map(s => ({
      id: crypto.randomUUID(), name: s.name, start_monday: s.start_monday, total_weeks: s.total_weeks,
    }));
    if (rows.length > 0) {
      const { error } = await supabase.from("semesters").insert(rows);
      if (error) return json({ error: "seed_semesters_failed", detail: error.message }, 503);
      results.semesters = rows.length;
    }
  }

  // Seed holidays
  if (body.holidays && Array.isArray(body.holidays)) {
    const rows = body.holidays.map(h => ({
      id: crypto.randomUUID(), date: h.date, name: h.name,
    }));
    if (rows.length > 0) {
      const { error } = await supabase.from("holidays").insert(rows);
      if (error) return json({ error: "seed_holidays_failed", detail: error.message }, 503);
      results.holidays = rows.length;
    }
  }

  // Seed courses
  if (body.courses && Array.isArray(body.courses)) {
    if (body.clear_courses === true) {
      const { error: excErr } = await supabase.from("course_exceptions").delete().not("id", "is", null);
      if (excErr) return json({ error: "seed_clear_exceptions_failed", detail: excErr.message }, 503);
      const { error: delErr } = await supabase.from("courses").delete().not("id", "is", null);
      if (delErr) return json({ error: "seed_clear_courses_failed", detail: delErr.message }, 503);
      results.cleared_courses = true;
    }
    const rows = body.courses.map(c => ({
      id: crypto.randomUUID(), name: c.name, teacher: c.teacher, location: c.location || null,
      weekday: c.weekday, start_period: c.start_period, end_period: c.end_period,
      week_start: c.week_start, week_end: c.week_end, parity: c.parity,
      color: c.color || null, note: c.note || null,
    }));
    if (rows.length > 0) {
      const { error } = await supabase.from("courses").insert(rows);
      if (error) return json({ error: "seed_courses_failed", detail: error.message }, 503);
      results.courses = rows.length;
    }
  }

  // Seed settings
  const { error: settingsError } = await supabase.from("settings").upsert({
    id: SETTINGS_ID, sound: true, vibrate: true, notify: false,
  });
  if (settingsError) return json({ error: "seed_settings_failed" }, 503);
  results.settings = 1;

  return json({ ok: true, results });
}
