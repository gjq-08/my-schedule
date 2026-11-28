// pages/settings.js - 分组式设置：首页模块入口 + 二级设置页
// 运行时数据一律读存储；config 的 PERIOD_TIMES 仅作"恢复默认"模板。
import { PERIOD_TIMES, MAX_PERIOD } from '../config.js';
import { escapeHtml, showToast, showConfirm, Modal } from '../ui.js';
import { createSemester, updateSemester, deleteSemester, updatePeriodTimes } from '../api.js';
import { playReminderSound } from '../audio.js';
import { loadData } from '../app.js';
import { getMeta, getSemesters, getPeriodTimes, listCourses } from '../store.js';
import { importFromCloud, isCloudImportEnabled } from '../first-run.js';
import { exportBackup, readBackupFile, previewCounts, applyBackup } from '../backup.js';
import { isWidgetNative, getWidgetStatus, syncWidgetsNow, requestExactAlarmFromWidget } from '../widget-snapshot.js';
import {
  isNative,
  requestReminderSync,
  requestNativePermission,
  openExactAlarmSetting,
  scheduleTestNotification,
  getDiagnostics,
  describeChannel,
  channelMuteReason,
  openAppSettings,
} from '../native-notify.js';
import { ICON_BELL, ICON_CALENDAR, ICON_CLOCK, ICON_ARCHIVE, ICON_WIDGETS, ICON_DOWNLOAD, ICON_LINK, ICON_CHEVRON } from '../icons.js';
import { checkForUpdates, getCurrentVersion, isUpdateNative } from '../update.js';

const SETTINGS_MODULES = [
  { key: 'semesters', group: '学习安排', title: '学期管理', desc: '课程按哪个学期、第几周显示', icon: ICON_CALENDAR },
  { key: 'periods', group: '学习安排', title: '作息时间表', desc: '课表时间轴与当前课程判断', icon: ICON_CLOCK },
  { key: 'reminders', group: '提醒通知', title: '提醒设置', desc: '权限、铃声、振动与测试', icon: ICON_BELL },
  { key: 'backup', group: '数据与桌面', title: '数据备份', desc: '换机前导出，恢复时覆盖导入', icon: ICON_ARCHIVE },
  { key: 'widgets', group: '数据与桌面', title: '桌面小组件', desc: '添加到桌面并保持刷新', icon: ICON_WIDGETS },
  { key: 'contact', group: '关于', title: '联系我们', desc: 'GitHub 主页与问题反馈', icon: ICON_LINK },
  { key: 'update', group: '关于', title: '软件更新', desc: '版本检查与覆盖安装', icon: ICON_DOWNLOAD },
];

function getReminderSettings() {
  const stored = localStorage.getItem('reminderSettings');
  if (stored) { try { return JSON.parse(stored); } catch { /* 损坏则用默认 */ } }
  return {
    activity: { sound: true, vibrate: true, notify: false },
    todo: { sound: true, vibrate: true, notify: false },
  };
}

function saveReminderSettings(settings) {
  localStorage.setItem('reminderSettings', JSON.stringify(settings));
}

function row(label, value) {
  return `<div class="settings-row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;
}

function settingsGuide(title, intro, steps = []) {
  return `
    <div class="settings-guide">
      <div class="settings-guide-title">${title}</div>
      ${intro ? `<p class="settings-guide-text">${intro}</p>` : ''}
      ${steps.length ? `<ol class="settings-steps">${steps.map((step, i) => `
        <li><span class="settings-step-index">${i + 1}</span><span>${step}</span></li>
      `).join('')}</ol>` : ''}
    </div>
  `;
}

async function openExternalUrl(url) {
  const bridge = window.Capacitor?.Plugins?.SystemBridge;
  if (bridge?.openUrl) {
    await bridge.openUrl({ url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

function homeHtml() {
  const groups = [...new Set(SETTINGS_MODULES.map(m => m.group))];
  return groups.map(group => `
    <section class="settings-group">
      <div class="settings-group-label">${group}</div>
      <div class="settings-card">
        ${SETTINGS_MODULES.filter(m => m.group === group).map(m => `
          <button type="button" class="settings-entry" data-module="${m.key}">
            <span class="settings-entry-icon">${m.icon}</span>
            <span class="settings-entry-text">
              <span class="settings-entry-title">${m.title}</span>
              <span class="settings-entry-desc">${m.desc}</span>
            </span>
            <span class="settings-entry-chevron">${ICON_CHEVRON}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `).join('');
}

export async function openSettingsModal(data) {
  const modal = new Modal('设置', '<div class="settings-host"></div>', { fullscreen: true });
  modal.show();
  const body = modal.getContent();
  body.classList.add('settings-modal-body');
  const host = body.querySelector('.settings-host');
  const renderers = {
    semesters: renderSemesters,
    periods: renderPeriods,
    reminders: renderReminders,
    backup: renderBackup,
    widgets: renderWidgets,
    contact: renderContact,
    update: renderUpdate,
  };

  function animate(el, dir) {
    if (!el || !dir) return;
    el.classList.add(dir === 'back' ? 'settings-anim-back' : 'settings-anim-forward');
  }

  function showHome(dir = 'none') {
    modal.setHeader('设置');
    host.innerHTML = `<div class="settings-home">${homeHtml()}</div>`;
    host.querySelectorAll('[data-module]').forEach(btn => {
      btn.addEventListener('click', () => showModule(btn.dataset.module));
    });
    animate(host.firstElementChild, dir);
    body.scrollTop = 0;
  }

  function showModule(key, dir = 'forward') {
    const mod = SETTINGS_MODULES.find(m => m.key === key);
    if (!mod) return;
    modal.setHeader(mod.title, () => showHome('back'));
    host.innerHTML = `<div class="settings-page" data-page="${key}"></div>`;
    const page = host.firstElementChild;
    animate(page, dir);
    body.scrollTop = 0;
    renderers[key](page);
  }

  // ===== 学期管理 =====
  function renderSemesters(page) {
    const sems = getSemesters();
    const courses = listCourses();
    page.innerHTML = `
      <div class="settings-section">
        ${settingsGuide('学期怎么设置', '学期决定课程属于哪一段时间，也决定课表能翻到第几周。', [
          '学期名称按校历填写，例如「2026-2027 学年秋季学期」。',
          '第 1 周周一选择该学期第一周的周一，不是第一次上课的日期。',
          '总周数按校历填写，决定课表最多显示到第几周。',
        ])}
      </div>
      <div class="settings-section">
        <div class="section-title">已有学期</div>
        <div id="semester-list">
          ${sems.length ? sems.map(s => {
            const count = courses.filter(c => c.semester_id === s.id).length;
            return `<div class="semester-item">
              <div class="semester-info">
                <div class="semester-name">${escapeHtml(s.name)}</div>
                <div class="semester-meta">${s.start_monday} 起 · 共 ${s.total_weeks} 周 · ${count} 门课程</div>
              </div>
              <div class="semester-actions">
                <button class="btn btn-secondary btn-sm" data-edit="${s.id}">编辑</button>
                <button class="btn btn-danger btn-sm" data-del="${s.id}">删除</button>
              </div>
            </div>`;
          }).join('') : '<div class="settings-empty">还没有学期，点下方按钮新建一个。</div>'}
        </div>
        <button class="btn btn-primary btn-sm settings-full-btn" id="add-semester-btn">+ 新建学期</button>
      </div>
    `;
    page.querySelector('#add-semester-btn').addEventListener('click', () => openSemesterForm(null));
    page.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openSemesterForm(sems.find(s => s.id === btn.dataset.edit)));
    });
    page.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = sems.find(x => x.id === btn.dataset.del);
        const count = courses.filter(c => c.semester_id === s.id).length;
        showConfirm(`删除「${s.name}」会同时删除该学期下的 ${count} 门课程及其调课记录，确定吗？`, async () => {
          try {
            await deleteSemester(s.id);
            showToast('已删除学期', 'success');
            renderSemesters(page);
            loadData();
          } catch (err) { showToast('删除失败：' + (err.code || err.message || '未知错误'), 'error'); }
        });
      });
    });
  }

  function openSemesterForm(sem) {
    const isEdit = !!sem;
    const form = new Modal(isEdit ? '编辑学期' : '新建学期', `
      <form id="semester-form">
        <div class="form-group">
          <label class="form-label">学期名称 *</label>
          <input class="form-input" name="name" required maxlength="100" value="${escapeHtml(sem?.name || '')}" placeholder="如 2026-2027 学年秋季学期">
        </div>
        <div class="form-group">
          <label class="form-label">第 1 周周一 *</label>
          <input class="form-input" type="date" name="start_monday" required value="${sem?.start_monday || ''}">
          <p class="settings-hint">若选的不是周一，会自动对齐到该周周一。</p>
        </div>
        <div class="form-group">
          <label class="form-label">总周数 *</label>
          <input class="form-input" type="number" name="total_weeks" min="1" max="30" required value="${sem?.total_weeks || 19}">
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%">保存</button>
      </form>
    `);
    form.show();
    form.getContent().querySelector('#semester-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        name: fd.get('name').trim(),
        start_monday: fd.get('start_monday'),
        total_weeks: parseInt(fd.get('total_weeks'), 10),
      };
      try {
        if (isEdit) await updateSemester(sem.id, payload);
        else await createSemester(payload);
        form.close();
        showToast('已保存学期', 'success');
        renderSemesters(host.querySelector('[data-page="semesters"]'));
        loadData();
      } catch (err) {
        showToast('保存失败：' + describeSemesterError(err), 'error');
      }
    });
  }

  function describeSemesterError(err) {
    const code = err?.code;
    if (code === 'invalid_name') return '请填写学期名称';
    if (code === 'invalid_start_monday') return '请选择有效的起始日期';
    if (code === 'invalid_total_weeks') return '总周数需为 1–30 的整数';
    return code || err?.message || '未知错误';
  }

  // ===== 作息时间表 =====
  function renderPeriods(page) {
    const pt = getPeriodTimes();
    let rows = '';
    for (let p = 1; p <= MAX_PERIOD; p++) {
      const slot = pt[p] || PERIOD_TIMES[p];
      rows += `<div class="period-row">
        <span class="period-num">第${p}节</span>
        <input type="time" class="form-input period-start" data-p="${p}" value="${slot.start}" aria-label="第${p}节开始">
        <span class="period-sep">—</span>
        <input type="time" class="form-input period-end" data-p="${p}" value="${slot.end}" aria-label="第${p}节结束">
      </div>`;
    }
    page.innerHTML = `
      <div class="settings-section">
        ${settingsGuide('作息怎么填', '这里只决定课表时间轴、上课时间和「当前课程」判断，不会改动课程本身。', [
          '按学校作息表填写每一节的开始和结束时间。',
          '修改后自动保存，课表时间轴和当前时间指示线会立即更新。',
          '如果作息暂时不确定，可先保留默认值，之后随时再来修改。',
        ])}
      </div>
      <div class="settings-section">
        <div class="section-title">每节课时间</div>
        <div id="period-rows">${rows}</div>
        <div class="settings-period-footer">
          <button class="btn btn-secondary btn-sm" id="reset-periods-btn">恢复默认</button>
          <span class="settings-save-state" id="period-save-state">修改后自动保存</span>
        </div>
      </div>
    `;
    const stateEl = page.querySelector('#period-save-state');
    const markState = (text, saved = false) => {
      stateEl.textContent = text;
      stateEl.classList.toggle('saved', saved);
    };
    let timer = null;
    page.querySelectorAll('#period-rows input[type="time"]').forEach(input => {
      input.addEventListener('change', () => {
        markState('保存中…');
        clearTimeout(timer);
        timer = setTimeout(() => savePeriods(page), 350);
      });
    });
    page.querySelector('#reset-periods-btn').addEventListener('click', () => {
      showConfirm('恢复为北航默认作息时间表？当前自定义时间将被覆盖。', async () => {
        try {
          await updatePeriodTimes({ ...PERIOD_TIMES });
          showToast('已恢复默认', 'success');
          renderPeriods(host.querySelector('[data-page="periods"]'));
          loadData();
        } catch (err) { showToast('恢复失败：' + (err.code || '未知错误'), 'error'); }
      });
    });
  }

  async function savePeriods(page) {
    const map = {};
    for (let p = 1; p <= MAX_PERIOD; p++) {
      const start = page.querySelector(`.period-start[data-p="${p}"]`).value;
      const end = page.querySelector(`.period-end[data-p="${p}"]`).value;
      if (!start || !end) {
        showToast(`第${p}节时间不能为空`, 'error');
        markPeriodState(page, '有未保存的修改', false);
        return;
      }
      if (start >= end) {
        showToast(`第${p}节：开始时间必须早于结束时间`, 'error');
        markPeriodState(page, '有未保存的修改', false);
        return;
      }
      map[p] = { start, end };
    }
    try {
      await updatePeriodTimes(map);
      const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      markPeriodState(page, `已自动保存 ${time}`, true);
      loadData();
      // 重叠仅提示，不阻断（允许特殊作息）
      for (let p = 1; p < MAX_PERIOD; p++) {
        if (map[p].end > map[p + 1].start) {
          showToast(`注意：第${p}节与第${p + 1}节时间有重叠`, 'info');
          break;
        }
      }
    } catch (err) {
      const code = err?.code;
      showToast('保存失败：' + (code === 'invalid_period_range' ? '开始时间必须早于结束时间' : code === 'invalid_period_time' ? '时间格式需为 HH:MM' : code || '未知错误'), 'error');
      markPeriodState(page, '有未保存的修改', false);
    }
  }

  function markPeriodState(page, text, saved) {
    const el = page.querySelector('#period-save-state');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('saved', saved);
  }

  // ===== 提醒设置 =====
  function renderReminders(page) {
    const rs = getReminderSettings();
    page.innerHTML = `
      <div class="settings-section">
        <div class="section-title">通知状态</div>
        <p class="settings-hint">提醒不弹时，先检查通知权限、自启动和电池限制。</p>
        <div id="notify-status-rows"></div>
        <div class="settings-actions">
          <button class="btn btn-secondary btn-sm" id="authorize-notify-btn">授权通知</button>
          ${isNative() ? '<button class="btn btn-secondary btn-sm" id="open-app-settings-btn">打开应用设置</button>' : ''}
        </div>
      </div>
      <div class="settings-section">
        <div class="section-title">提醒方式</div>
        <div class="settings-subgroup-title">日程提醒</div>
        ${reminderToggle('activity', 'sound', '铃声', rs.activity.sound)}
        ${reminderToggle('activity', 'vibrate', '振动', rs.activity.vibrate)}
        ${reminderToggle('activity', 'notify', '系统通知', rs.activity.notify)}
        <div class="settings-subgroup-title">待办提醒</div>
        ${reminderToggle('todo', 'sound', '铃声', rs.todo.sound)}
        ${reminderToggle('todo', 'vibrate', '振动', rs.todo.vibrate)}
        ${reminderToggle('todo', 'notify', '系统通知', rs.todo.notify)}
      </div>
      <div class="settings-section">
        <div class="section-title">测试</div>
        <div class="settings-actions">
          <button class="btn btn-secondary btn-sm" id="test-sound-btn">试听铃声</button>
          <button class="btn btn-secondary btn-sm" id="test-delay-btn">测试定时</button>
        </div>
        <p class="settings-hint">测试定时会交给系统闹钟，约 15 秒后弹出。</p>
      </div>
      <details class="settings-details">
        <summary>高级诊断</summary>
        <div id="notify-diag-rows"></div>
      </details>
    `;
    function updateReminderSetting(type, field, value) {
      const settings = getReminderSettings();
      if (!settings[type]) settings[type] = { sound: true, vibrate: true, notify: false };
      settings[type][field] = value;
      saveReminderSettings(settings);
      requestReminderSync();
    }
    ['activity', 'todo'].forEach(type => {
      ['sound', 'vibrate', 'notify'].forEach(field => {
        page.querySelector(`#${type}-${field}`)?.addEventListener('change', (e) => updateReminderSetting(type, field, e.target.checked));
      });
    });

    async function renderNotifyStatus() {
      const holder = page.querySelector('#notify-status-rows');
      const diagHolder = page.querySelector('#notify-diag-rows');
      if (!holder || !diagHolder) return;
      const summary = [];
      const detail = [];
      if (isNative()) {
        const diag = await getDiagnostics();
        const num = v => (typeof v === 'number' ? `${v} 条` : `读取失败：${v}`);
        const display = diag.permission;
        summary.push(row('通知权限', display === 'granted' ? '已授权' : display === 'denied' ? '已关闭' : `待授权（${display}）`));
        summary.push(row('系统通知', diag.enabled === true ? '已开启' : diag.enabled === false ? '已关闭' : `读取失败：${diag.enabled}`));
        if (diag.exactAlarm && diag.exactAlarm !== 'granted') {
          summary.push(row('精确闹钟', '未允许，提醒可能延迟'));
        } else if (diag.exactAlarm === 'granted') {
          summary.push(row('精确闹钟', '已允许'));
        }
        const muted = channelMuteReason(diag.channelDetail);
        if (muted) summary.push(row('通知渠道', '需要检查，展开下方诊断查看'));

        detail.push(row('运行环境', 'App（原生通知）'));
        detail.push(row('已排定提醒', num(diag.pending)));
        detail.push(row('当前正在显示', num(diag.delivered)));
        detail.push(row('通知渠道', num(diag.channels)));
        if (diag.channelSupport === false) {
          detail.push(row('系统记录的渠道', 'Android 7 及以下无渠道，铃声由系统通知设置决定'));
        } else {
          detail.push(row('系统记录的渠道', describeChannel(diag.channelDetail)));
          if (muted) {
            detail.push(`<div class="settings-row"><span class="value">渠道目前${escapeHtml(muted)}。渠道建立后 App 无法改回，只能到系统通知设置里恢复。</span></div>`);
          }
        }
        const last = diag.lastSync;
        if (last?.at) detail.push(row('上次同步', `${last.scheduled}/${last.requested} 条${last.truncated ? '（已截断）' : ''} · ${new Date(last.at).toLocaleTimeString()}`));
        const err = diag.lastError || last?.error;
        if (err) detail.push(row('最近错误', String(err)));
        if (diag.exactAlarm && diag.exactAlarm !== 'granted') {
          detail.push(`<div class="settings-row"><button class="btn btn-secondary btn-sm" id="exact-alarm-btn">去开启精确闹钟</button></div>`);
        }

        if (!muted) {
          detail.push(`<div class="settings-row"><span class="value">到点不弹或没有声音时，在应用设置里允许自启动，并把电池优化设为「无限制」。</span></div>`);
        }
      } else {
        summary.push(row('浏览器通知', 'Notification' in window
          ? (Notification.permission === 'granted' ? '已授权' : '未授权')
          : '浏览器不支持'));
        detail.push(row('运行环境', '浏览器（网页版提醒）'));
      }
      holder.innerHTML = summary.join('');
      diagHolder.innerHTML = detail.join('');
      diagHolder.querySelector('#exact-alarm-btn')?.addEventListener('click', async () => {
        showToast('即将跳转系统设置；返回后本 App 会重新同步提醒', 'info');
        try { await openExactAlarmSetting(); } catch { showToast('跳转失败，请在系统设置中手动开启', 'error'); }
      });
      const delayBtn = page.querySelector('#test-delay-btn');
      if (delayBtn) delayBtn.style.display = isNative() ? '' : 'none';
    }
    renderNotifyStatus();

    page.querySelector('#open-app-settings-btn')?.addEventListener('click', async () => {
      const ok = await openAppSettings();
      if (!ok) showToast('无法打开应用设置，请到系统设置中手动打开', 'error');
    });

    page.querySelector('#authorize-notify-btn')?.addEventListener('click', async () => {
      if (isNative()) {
        const perm = await requestNativePermission();
        if (perm?.display === 'granted') { showToast('通知权限已授权', 'success'); requestReminderSync(); }
        else showToast('通知权限被拒绝，将使用应用内横幅提醒', 'error');
        renderNotifyStatus();
        return;
      }
      if (!('Notification' in window)) { showToast('浏览器不支持通知', 'error'); return; }
      const perm = await Notification.requestPermission();
      showToast(perm === 'granted' ? '通知权限已授权' : '通知权限被拒绝', perm === 'granted' ? 'success' : 'error');
      renderNotifyStatus();
    });

    async function runNativeTest(delayMs) {
      const res = await scheduleTestNotification({ delayMs });
      if (!res.ok) showToast(`测试失败：${res.error || '未知原因'}`, 'error');
      else if (res.mode === 'immediate') showToast('已发出测试通知，可展开「高级诊断」查看渠道状态', 'success');
      else showToast(`已交给系统闹钟，${Math.round(delayMs / 1000)} 秒后应弹出`, 'info');
      renderNotifyStatus();
    }
    page.querySelector('#test-sound-btn')?.addEventListener('click', async () => {
      if (isNative()) { await runNativeTest(0); return; }
      playReminderSound();
    });
    page.querySelector('#test-delay-btn')?.addEventListener('click', async () => { await runNativeTest(15000); });
  }

  function reminderToggle(type, field, label, checked) {
    return `<div class="settings-row">
      <span class="label">${label}</span>
      <label class="switch">
        <input type="checkbox" id="${type}-${field}" ${checked ? 'checked' : ''}>
        <span class="switch-track"></span>
        <span class="switch-thumb"></span>
      </label>
    </div>`;
  }

  // ===== 数据备份 =====
  function renderBackup(page) {
    page.innerHTML = `
      <div class="settings-section">
        ${settingsGuide('备份与恢复怎么用', '备份文件包含课程、日程、待办、倒计日和提醒设置，适合换机或重装前保存。', [
          '先点「导出备份」，把 JSON 文件保存到网盘或手机文件里。',
          '新手机安装 App 后点「导入备份」，选择刚才的文件。',
          '导入会覆盖本机现有数据，操作前请先确认文件来源。',
        ])}
      </div>
      <div class="settings-section">
        <div class="section-title">数据状态</div>
        <div id="data-status-rows"></div>
      </div>
      <div class="settings-section">
        <div class="section-title">导出与导入</div>
        <p class="settings-hint">导出不会清空本机数据；导入会覆盖本机全部数据，且不可撤销。</p>
        <div class="settings-actions">
          <button class="btn btn-primary btn-sm" id="export-backup-btn">导出备份</button>
          <button class="btn btn-secondary btn-sm" id="import-backup-btn">导入备份</button>
        </div>
        <input type="file" id="backup-file-input" accept=".json,application/json" style="display:none">
      </div>
    `;
    renderDataStatus(page);

    page.querySelector('#export-backup-btn').addEventListener('click', async () => {
      const res = await exportBackup();
      if (res.ok) showToast(res.mode === 'native' ? '已生成备份，请选择保存位置' : '备份文件已开始下载', 'success');
      else if (res.cancelled) showToast('已取消导出', 'info');
      else showToast('导出失败：' + (res.error || '未知错误'), 'error');
    });

    const fileInput = page.querySelector('#backup-file-input');
    page.querySelector('#import-backup-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      let payload;
      try { payload = await readBackupFile(file); }
      catch (err) { showToast('导入失败：' + (err.message || err), 'error'); return; }
      confirmImport(payload, page);
    });
  }

  function confirmImport(payload, page) {
    const c = previewCounts(payload);
    const preview = new Modal('确认导入备份', `
      <p class="settings-hint">导入将<strong>覆盖</strong>本机当前全部数据，且不可撤销。建议先导出当前备份。文件包含：</p>
      <div class="backup-preview">
        ${row('学期', `${c.semesters} 个`)}
        ${row('课程', `${c.courses} 门`)}
        ${row('调课记录', `${c.exceptions} 条`)}
        ${row('日程', `${c.activities} 项`)}
        ${row('标签', `${c.tags} 个`)}
        ${row('待办', `${c.todos} 项`)}
        ${row('倒计日', `${c.countdowns} 个`)}
      </div>
      <div style="display:flex;gap:8px;margin-top:18px">
        <button class="btn btn-danger" id="confirm-import-btn" style="flex:1">覆盖导入</button>
        <button class="btn btn-secondary" id="cancel-import-btn" style="flex:1">取消</button>
      </div>
    `);
    preview.show();
    preview.getContent().querySelector('#cancel-import-btn').addEventListener('click', () => preview.close());
    preview.getContent().querySelector('#confirm-import-btn').addEventListener('click', () => {
      try {
        applyBackup(payload);
        preview.close();
        showToast('导入完成，数据已覆盖', 'success');
        renderBackup(page);
        loadData();
      } catch (err) {
        showToast('导入失败：' + (err.message || err), 'error');
      }
    });
  }

  function renderDataStatus(page) {
    const holder = page.querySelector('#data-status-rows');
    if (!holder) return;
    const meta = getMeta();
    if (meta?.counts) {
      const c = meta.counts;
      holder.innerHTML = [
        row('存储位置', '手机本地（无需联网）'),
        row('数据来源', meta.source === 'cloud' ? '云端导入' : meta.source === 'backup' ? '备份导入' : (isCloudImportEnabled() ? '内置快照' : '内置初始数据')),
        row('已导入', `课程 ${c.courses} · 调课 ${c.exceptions} · 活动 ${c.activities} · 待办 ${c.todos} · 倒计日 ${c.countdowns}`),
        row('导入时间', new Date(meta.importedAt).toLocaleString()),
        ...(isCloudImportEnabled() ? [`<div class="settings-row"><button class="btn btn-secondary btn-sm" id="reimport-btn">从云端重新导入</button></div>`] : []),
      ].join('');
    } else {
      holder.innerHTML = row('存储位置', '手机本地（尚未导入数据）');
    }
    holder.querySelector('#reimport-btn')?.addEventListener('click', () => {
      showConfirm('重新导入将覆盖本机当前的全部日程数据，确定吗？', async () => {
        try {
          const res = await importFromCloud();
          const c = res.counts;
          showToast(`已导入：课程 ${c.courses} · 活动 ${c.activities} · 待办 ${c.todos} · 倒计日 ${c.countdowns}`, 'success');
          renderDataStatus(page);
          loadData();
        } catch (err) { showToast(`导入失败：${err?.message || err}`, 'error'); }
      });
    });
  }

  // ===== 桌面小组件 =====
  async function renderWidgets(page) {
    const native = isWidgetNative();
    page.innerHTML = `
      <div class="settings-section">
        ${settingsGuide('添加教程', '把小组件放到桌面后，不打开 App 也能看到今天的安排。', [
          '回到手机桌面，长按空白处，选择「小组件」。',
          '搜索「我的日程」，或在小部件列表里找到它。',
          '把「下一项安排」「今日概览」「今日待办」或「最近倒计日」拖到桌面。',
        ])}
        <div class="settings-feature-list">
          <div class="settings-feature-row">
            <span class="settings-feature-name">下一项安排</span>
            <span class="settings-feature-desc">最近一节课或日程，随时间自动切换</span>
          </div>
          <div class="settings-feature-row">
            <span class="settings-feature-name">今日概览</span>
            <span class="settings-feature-desc">今天的时间线，进行中的安排高亮</span>
          </div>
          <div class="settings-feature-row">
            <span class="settings-feature-name">今日待办</span>
            <span class="settings-feature-desc">逾期、今日和每日重复待办，可直接勾选</span>
          </div>
          <div class="settings-feature-row">
            <span class="settings-feature-name">最近倒计日</span>
            <span class="settings-feature-desc">只显示距离最近的一个倒计日</span>
          </div>
        </div>
        ${native ? '' : '<div class="settings-hint">网页版没有桌面小组件，安装 App 后即可使用。</div>'}
      </div>
      <div class="settings-section">
        <div class="section-title">刷新与状态</div>
        <p class="settings-hint">如果下一项切换或待办到期不够准时，允许「闹钟和提醒」后可提升刷新精度。</p>
        <div id="widget-status-rows"></div>
      </div>
    `;
    const holder = page.querySelector('#widget-status-rows');
    if (!native) {
      holder.innerHTML = [
        row('运行环境', '浏览器（网页版）'),
        row('桌面小组件', '仅 App 支持'),
      ].join('');
      return;
    }
    const st = await getWidgetStatus();
    if (!st) {
      holder.innerHTML = row('小组件状态', '读取失败');
      return;
    }
    const rows = [];
    rows.push(row('刷新精度', st.exact ? '精准（到分钟）' : '30 分钟（可提升）'));
    if (!st.exact) {
      rows.push(`<div class="settings-row"><span class="value">允许「闹钟和提醒」后，下一项切换与待办到期可准时刷新。</span></div>
        <div class="settings-row"><button class="btn btn-secondary btn-sm" id="widget-exact-btn">去开启精准刷新</button></div>`);
    }
    rows.push(row('已放置组件', `${st.widgets} 个`));
    if (st.snapshotAt) rows.push(row('上次同步', new Date(st.snapshotAt).toLocaleString()));
    rows.push(`<div class="settings-row"><button class="btn btn-secondary btn-sm" id="widget-sync-btn">立即同步小组件</button></div>`);
    holder.innerHTML = rows.join('');
    holder.querySelector('#widget-exact-btn')?.addEventListener('click', async () => {
      const ok = await requestExactAlarmFromWidget();
      if (!ok) showToast('跳转失败，请在系统设置中允许「闹钟和提醒」', 'error');
      else setTimeout(() => renderWidgets(page), 1500);
    });
    holder.querySelector('#widget-sync-btn')?.addEventListener('click', async () => {
      await syncWidgetsNow();
      showToast('小组件已同步', 'success');
      renderWidgets(page);
    });
  }

  // ===== 联系我们 =====
  function renderContact(page) {
    page.innerHTML = `
      <div class="settings-section">
        ${settingsGuide('联系与反馈', '遇到问题、发现异常或有功能建议，可以在 GitHub 找到我。')}
      </div>
      <div class="settings-section">
        <div class="section-title">GitHub</div>
        <div class="contact-card">
          <span class="contact-icon">${ICON_LINK}</span>
          <div class="contact-info">
            <span class="contact-name">gjq-08</span>
            <span class="contact-url">github.com/gjq-08</span>
          </div>
        </div>
        <div class="settings-actions">
          <button class="btn btn-primary btn-sm" id="open-github-btn">打开 GitHub 主页</button>
        </div>
        <p class="settings-hint">反馈问题时，建议附上手机系统版本、App 版本和复现步骤。</p>
      </div>
    `;
    page.querySelector('#open-github-btn')?.addEventListener('click', async () => {
      try {
        await openExternalUrl('https://github.com/gjq-08');
      } catch {
        showToast('无法打开浏览器，请手动访问 github.com/gjq-08', 'error');
      }
    });
  }

  // ===== 软件更新 =====
  async function renderUpdate(page) {
    const native = isUpdateNative();
    page.innerHTML = `
      <div class="settings-section">
        ${settingsGuide('更新流程', native
          ? 'App 启动时会每天自动检查一次，也可以在这里手动检查。'
          : '网页版会直接加载最新页面，不需要安装 APK。', native ? [
            '发现新版本后点「下载更新」，等待安装包下载并校验完成。',
            '第一次安装时，系统可能要求允许「我的日程」安装应用，授权后返回继续。',
            '在系统安装界面确认覆盖安装，课表、日程和待办数据会保留。',
          ] : [])}
      </div>
      <div class="settings-section">
        <div class="section-title">版本信息</div>
        <div id="update-version-rows">${row('当前版本', '读取中…')}</div>
      </div>
      <div class="settings-section">
        <div class="section-title">检查更新</div>
        <p class="settings-hint">${native
          ? '当前版本不低于线上版本时不会重复提示；下载失败可直接重试。'
          : '网页版无需检查 APK 更新。'}</p>
        <div class="settings-actions">
          <button class="btn btn-primary btn-sm" id="check-update-btn" ${native ? '' : 'disabled'}>检查更新</button>
        </div>
      </div>
    `;
    const version = await getCurrentVersion();
    const rows = page.querySelector('#update-version-rows');
    if (rows) rows.innerHTML = row('当前版本', `v${version.versionName}${native ? `（版本号 ${version.versionCode}）` : ''}`);
    page.querySelector('#check-update-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '检查中…';
      await checkForUpdates({ manual: true });
      btn.disabled = false;
      btn.textContent = '检查更新';
    });
  }

  showHome('none');
}
