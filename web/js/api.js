// api.js - 后端 API 请求封装

const API_BASE = '/functions/v1/app';

class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function requestJson(path, options = {}) {
  const { method = 'GET', body = null } = options;
  const url = `${API_BASE}${path}`;
  const init = {
    method,
    headers: { 'Accept': 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(url, init);
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (!resp.ok) throw new ApiError('network_error', resp.status);
    throw new ApiError('invalid_response', resp.status);
  }
  if (!resp.ok) {
    const code = data?.error || 'unknown_error';
    throw new ApiError(code, resp.status);
  }
  return data;
}

// Bootstrap: 获取所有初始数据
export async function fetchBootstrap() {
  return requestJson('/bootstrap');
}

// Courses
export async function fetchCourses() {
  return requestJson('/courses');
}

export async function createCourse(course) {
  return requestJson('/courses', { method: 'POST', body: course });
}

export async function updateCourse(id, course) {
  return requestJson(`/courses/${id}`, { method: 'PUT', body: course });
}

export async function deleteCourse(id) {
  return requestJson(`/courses/${id}`, { method: 'DELETE' });
}

// Course Exceptions
export async function fetchExceptions() {
  return requestJson('/exceptions');
}

export async function createException(exc) {
  return requestJson('/exceptions', { method: 'POST', body: exc });
}

export async function deleteException(id) {
  return requestJson(`/exceptions/${id}`, { method: 'DELETE' });
}

// Activities
export async function fetchActivities() {
  return requestJson('/activities');
}

export async function createActivity(act) {
  return requestJson('/activities', { method: 'POST', body: act });
}

export async function updateActivity(id, act) {
  return requestJson(`/activities/${id}`, { method: 'PUT', body: act });
}

export async function deleteActivity(id) {
  return requestJson(`/activities/${id}`, { method: 'DELETE' });
}

// Tags
export async function fetchTags() {
  return requestJson('/tags');
}

export async function createTag(tag) {
  return requestJson('/tags', { method: 'POST', body: tag });
}

export async function deleteTag(id) {
  return requestJson(`/tags/${id}`, { method: 'DELETE' });
}

// Settings
export async function fetchSettings() {
  return requestJson('/settings');
}

export async function updateSettings(settings) {
  return requestJson('/settings', { method: 'PUT', body: settings });
}

export { ApiError };
