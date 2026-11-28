// api.js - v3.0 起为本地存储门面（PRD §23.2）
// 对外函数名、参数与返回形状与云端版完全一致，页面模块无需改动。
import { ApiError } from './errors.js';
import * as store from './store.js';
import { importOnFirstRun } from './first-run.js';

export { ApiError };

// 首屏：本地无数据时先做一次导入（云端或内置快照），之后全部走本地
export async function fetchBootstrap() {
  if (!store.isReady()) {
    await importOnFirstRun();
  }
  return store.getAll();
}

// Courses
export async function fetchCourses() {
  return store.listCourses();
}

export async function createCourse(course) {
  return store.createCourse(course);
}

export async function updateCourse(id, course) {
  return store.updateCourse(id, course);
}

export async function deleteCourse(id) {
  return store.deleteCourse(id);
}

// Course Exceptions
export async function fetchExceptions() {
  return store.listExceptions();
}

export async function createException(exc) {
  return store.createException(exc);
}

export async function deleteException(id) {
  return store.deleteException(id);
}

// Activities
export async function fetchActivities() {
  return store.listActivities();
}

export async function createActivity(act) {
  return store.createActivity(act);
}

export async function updateActivity(id, act) {
  return store.updateActivity(id, act);
}

export async function deleteActivity(id) {
  return store.deleteActivity(id);
}

// Tags
export async function fetchTags() {
  return store.listTags();
}

export async function createTag(tag) {
  return store.createTag(tag);
}

export async function deleteTag(id) {
  return store.deleteTag(id);
}

// Settings
export async function fetchSettings() {
  return store.getSettings();
}

export async function updateSettings(settings) {
  return store.updateSettings(settings);
}

// Semesters
export async function fetchSemesters() {
  return store.getSemesters();
}

export async function createSemester(sem) {
  return store.createSemester(sem);
}

export async function updateSemester(id, sem) {
  return store.updateSemester(id, sem);
}

export async function deleteSemester(id) {
  return store.deleteSemester(id);
}

// Period times（作息时间表）
export async function fetchPeriodTimes() {
  return store.getPeriodTimes();
}

export async function updatePeriodTimes(map) {
  return store.updatePeriodTimes(map);
}

// 把错误码翻译成用户能照着做的一句话
export function describeApiError(err) {
  if (!(err instanceof ApiError)) return '加载失败，请检查网络';
  if (err.code === 'network_error' && err.status === 0) return '连不上服务器（网络或域名解析失败），请稍后重试';
  if (err.code === 'invalid_response') return `服务器返回了非数据内容（HTTP ${err.status}），请稍后重试`;
  if (err.code === 'snapshot_missing') return '内置数据不可用，请联网从云端导入';
  if (err.status >= 500) return `服务器暂时不可用（HTTP ${err.status}），通常几十秒内恢复`;
  if (err.status === 403) return '请求被网关拒绝（403）';
  if (err.status) return `请求失败（HTTP ${err.status}：${err.code}）`;
  return `加载失败：${err.code}`;
}