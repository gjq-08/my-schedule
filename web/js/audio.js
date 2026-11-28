// audio.js - 提醒铃声（WebAudio 合成，无需外部文件）

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// 播放一段简短的提示铃声
export function playReminderSound() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    // 三声短促的提示音
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, now + i * 0.3);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.3 + 0.2);
      osc.start(now + i * 0.3);
      osc.stop(now + i * 0.3 + 0.25);
    }
  } catch {
    // 静默失败：音频不是关键功能
  }
}

// 振动
export function vibrate(pattern = [200, 100, 200]) {
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}
