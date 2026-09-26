// pages/settings.js - 设置弹层
import { SEMESTERS_SEED } from '../config.js';
import { escapeHtml, showToast, Modal } from '../ui.js';
import { updateSettings } from '../api.js';
import { playReminderSound } from '../audio.js';
import { loadData } from '../app.js';

function getReminderSettings() {
  const stored = localStorage.getItem('reminderSettings');
  if (stored) return JSON.parse(stored);
  return {
    course: { sound: true, vibrate: true, notify: false },
    activity: { sound: true, vibrate: true, notify: false },
    todo: { sound: true, vibrate: true, notify: false },
  };
}

function saveReminderSettings(settings) {
  localStorage.setItem('reminderSettings', JSON.stringify(settings));
}

export async function openSettingsModal(data) {
  const reminderSettings = getReminderSettings();

  const modal = new Modal('设置', `
    <div class="settings-section">
      <div class="section-title">课程提醒</div>
      <div class="settings-row">
        <span class="label">铃声</span>
        <label class="form-check">
          <input type="checkbox" id="course-sound" ${reminderSettings.course.sound ? 'checked' : ''}>
        </label>
      </div>
      <div class="settings-row">
        <span class="label">振动</span>
        <label class="form-check">
          <input type="checkbox" id="course-vibrate" ${reminderSettings.course.vibrate ? 'checked' : ''}>
        </label>
      </div>
      <div class="settings-row">
        <span class="label">系统通知</span>
        <label class="form-check">
          <input type="checkbox" id="course-notify" ${reminderSettings.course.notify ? 'checked' : ''}>
        </label>
      </div>
    </div>
    <div class="settings-section">
      <div class="section-title">日程提醒</div>
      <div class="settings-row">
        <span class="label">铃声</span>
        <label class="form-check">
          <input type="checkbox" id="activity-sound" ${reminderSettings.activity.sound ? 'checked' : ''}>
        </label>
      </div>
      <div class="settings-row">
        <span class="label">振动</span>
        <label class="form-check">
          <input type="checkbox" id="activity-vibrate" ${reminderSettings.activity.vibrate ? 'checked' : ''}>
        </label>
      </div>
      <div class="settings-row">
        <span class="label">系统通知</span>
        <label class="form-check">
          <input type="checkbox" id="activity-notify" ${reminderSettings.activity.notify ? 'checked' : ''}>
        </label>
      </div>
    </div>
    <div class="settings-section">
      <div class="section-title">待办提醒</div>
      <div class="settings-row">
        <span class="label">铃声</span>
        <label class="form-check">
          <input type="checkbox" id="todo-sound" ${reminderSettings.todo.sound ? 'checked' : ''}>
        </label>
      </div>
      <div class="settings-row">
        <span class="label">振动</span>
        <label class="form-check">
          <input type="checkbox" id="todo-vibrate" ${reminderSettings.todo.vibrate ? 'checked' : ''}>
        </label>
      </div>
      <div class="settings-row">
        <span class="label">系统通知</span>
        <label class="form-check">
          <input type="checkbox" id="todo-notify" ${reminderSettings.todo.notify ? 'checked' : ''}>
        </label>
      </div>
    </div>
    <div class="settings-section">
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-secondary btn-sm" id="authorize-notify-btn">授权权限</button>
        <button class="btn btn-secondary btn-sm" id="test-sound-btn">试听铃声</button>
      </div>
    </div>
    <div class="settings-section">
      <div class="section-title">学期信息</div>
      ${SEMESTERS_SEED.map(s => `
        <div class="settings-row">
          <span class="label">${escapeHtml(s.name)}</span>
          <span class="value">${s.start_monday} 起 ${s.total_weeks} 周</span>
        </div>
      `).join('')}
    </div>
  `);
  modal.show();

  const body = modal.getContent();

  function updateReminderSetting(type, field, value) {
    const settings = getReminderSettings();
    settings[type][field] = value;
    saveReminderSettings(settings);
  }

  body.querySelector('#course-sound')?.addEventListener('change', (e) => updateReminderSetting('course', 'sound', e.target.checked));
  body.querySelector('#course-vibrate')?.addEventListener('change', (e) => updateReminderSetting('course', 'vibrate', e.target.checked));
  body.querySelector('#course-notify')?.addEventListener('change', (e) => updateReminderSetting('course', 'notify', e.target.checked));

  body.querySelector('#activity-sound')?.addEventListener('change', (e) => updateReminderSetting('activity', 'sound', e.target.checked));
  body.querySelector('#activity-vibrate')?.addEventListener('change', (e) => updateReminderSetting('activity', 'vibrate', e.target.checked));
  body.querySelector('#activity-notify')?.addEventListener('change', (e) => updateReminderSetting('activity', 'notify', e.target.checked));

  body.querySelector('#todo-sound')?.addEventListener('change', (e) => updateReminderSetting('todo', 'sound', e.target.checked));
  body.querySelector('#todo-vibrate')?.addEventListener('change', (e) => updateReminderSetting('todo', 'vibrate', e.target.checked));
  body.querySelector('#todo-notify')?.addEventListener('change', (e) => updateReminderSetting('todo', 'notify', e.target.checked));

  body.querySelector('#authorize-notify-btn')?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('浏览器不支持通知', 'error');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      showToast('通知权限已授权', 'success');
    } else {
      showToast('通知权限被拒绝', 'error');
    }
  });

  body.querySelector('#test-sound-btn')?.addEventListener('click', () => {
    playReminderSound();
  });
}
