// mascot.js - 原创角色「小飞」：蓝白折纸飞机，内联 SVG，无外部资源
// 只出现在：开屏、首页页眉、空状态、成功 toast
const INK = '#253247';
const BLUE = '#2878D0';
const FOLD = '#DCEEFF';
const NOSE = '#FFC857';

function wrap(inner, viewBox = '0 0 96 96', cls = 'mascot') {
  return `<svg class="${cls}" viewBox="${viewBox}" fill="none" role="img" aria-hidden="true">${inner}</svg>`;
}

const PLANE = `
  <path d="M8 45 L86 15 L64 80 L43 57 Z" fill="${FOLD}" stroke="${BLUE}" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M43 57 L86 15" stroke="${BLUE}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M43 57 L43 73 L53 63" fill="#FFFFFF" stroke="${BLUE}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M86 15 L70 33 L80 36 Z" fill="${NOSE}" stroke="${BLUE}" stroke-width="1.8" stroke-linejoin="round"/>
  <circle cx="53" cy="44" r="2.6" fill="${INK}"/>
  <circle cx="63" cy="39" r="2.6" fill="${INK}"/>
  <path d="M55 51 q4 3.2 8 -0.6" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
`;

const TRAIL = `
  <path d="M14 66 q-4 4 -8 5" stroke="${BLUE}" stroke-width="2.2" stroke-linecap="round" opacity=".45"/>
  <path d="M18 74 q-5 3 -10 3.5" stroke="${BLUE}" stroke-width="2.2" stroke-linecap="round" opacity=".3"/>
`;

// 滑翔：开屏、首页页眉
export const MASCOT_GLIDE = wrap(`${TRAIL}${PLANE}`, '0 0 96 96', 'mascot mascot-md');

// 趴在纸边：空状态
export const MASCOT_PEEK = wrap(`
  <g transform="rotate(-4 48 40)">${PLANE}</g>
  <path d="M10 80 H86" stroke="#CFDEED" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M32 80 v6 M66 80 v6" stroke="#BFDCFA" stroke-width="2.2" stroke-linecap="round"/>
`, '0 0 96 96', 'mascot mascot-lg');

// 成功 toast 里的小尺寸标记
export const MASCOT_MARK = wrap(`
  <path d="M3 15.5 L28 5 L20.5 26 L13.5 18.5 Z" fill="${FOLD}" stroke="${BLUE}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M13.5 18.5 L28 5" stroke="${BLUE}" stroke-width="2" stroke-linecap="round"/>
  <circle cx="17.6" cy="14.6" r="1.5" fill="${INK}"/>
  <circle cx="21.6" cy="12.8" r="1.5" fill="${INK}"/>
  <path d="M28 5 L22.5 11 L26 12 L28 5 Z" fill="${NOSE}" stroke="${BLUE}" stroke-width="1.4" stroke-linejoin="round"/>
`, '0 0 32 32', 'brand-mark');

export function mascotEmpty(text, subtext, pose = MASCOT_PEEK) {
  return `<div class="empty-mascot">${pose}<div class="empty-state-card">
    <div class="empty-text">${text}</div>${subtext ? `<div class="empty-subtext">${subtext}</div>` : ''}
  </div></div>`;
}
