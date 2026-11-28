// splash.js - 开屏品牌动画（微信/QQ/知乎式）：每天首次启动播放一次。
// 退出时机 = max(最短动画, 数据就绪)，硬上限 3s；0.8s 后可轻点跳过；reduced-motion 直接不播。
import { MASCOT_GLIDE } from './mascot.js';

const KEY = 'splashShownDate';
const MIN = 1400;
const CAP = 2600;
const SKIP_AFTER = 700;

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function maybeSplash(readyPromise) {
  let reduced = false;
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  const today = todayStr();
  let last = null;
  try { last = localStorage.getItem(KEY); } catch { /* ignore */ }
  if (reduced || last === today) return;
  try { localStorage.setItem(KEY, today); } catch { /* ignore */ }

  const overlay = document.createElement('div');
  overlay.className = 'splash-overlay';
  overlay.setAttribute('role', 'presentation');
  overlay.innerHTML = `
    <div class="splash-stage">
      <div class="splash-mascot">${MASCOT_GLIDE}</div>
      <div class="splash-name">我的日程</div>
      <div class="splash-rule"></div>
      <div class="splash-sub">MY SCHEDULE</div>
    </div>
    <div class="splash-skip">轻点跳过</div>
  `;
  document.body.appendChild(overlay);

  let exited = false, minDone = false, readyDone = false, skipAllowed = false;
  const exit = () => {
    if (exited) return;
    exited = true;
    overlay.classList.add('splash-out');
    setTimeout(() => overlay.remove(), 450);
  };
  const maybeExit = () => { if (minDone && readyDone) exit(); };

  setTimeout(() => { minDone = true; maybeExit(); }, MIN);
  setTimeout(exit, CAP);
  setTimeout(() => { skipAllowed = true; overlay.classList.add('splash-skippable'); }, SKIP_AFTER);
  overlay.addEventListener('click', () => { if (skipAllowed) exit(); });
  Promise.resolve(readyPromise).then(
    () => { readyDone = true; maybeExit(); },
    () => { readyDone = true; maybeExit(); },
  );
}