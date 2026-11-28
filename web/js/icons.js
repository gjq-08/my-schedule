// icons.js - 统一线性图标：24 网格、1.75 描边、currentColor
const svg = (paths, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${paths}</svg>`;

export const ICON_HOME = svg('<path d="M3.5 10.5 12 3l8.5 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-5.5h5V20"/>');
export const ICON_CALENDAR = svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3.5v3M16 3.5v3M3.5 10h17"/>');
export const ICON_CLOCK = svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>');
export const ICON_AGENDA = svg('<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.5" cy="6.5" r="1.1"/><circle cx="4.5" cy="12" r="1.1"/><circle cx="4.5" cy="17.5" r="1.1"/>');
export const ICON_CHECK_SQUARE = svg('<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8 12.5l2.6 2.6L16 9.5"/>');
export const ICON_HOURGLASS = svg('<path d="M7 3.5h10M7 20.5h10"/><path d="M8 3.5v3.2l4 4.3 4-4.3V3.5"/><path d="M8 20.5v-3.2l4-4.3 4 4.3v3.2"/>');
export const ICON_BELL = svg('<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 3H4l2-3z"/><path d="M10 21h4"/>');
export const ICON_EDIT = svg('<path d="M4 20l1-4L17 4l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/>');
export const ICON_TRASH = svg('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>');
export const ICON_GEAR = svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>');
export const ICON_ARCHIVE = svg('<rect x="3" y="4" width="18" height="5" rx="2"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>');
export const ICON_WIDGETS = svg('<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>');
export const ICON_CHEVRON = svg('<path d="M9 6l6 6-6 6"/>');
export const ICON_BACK = svg('<path d="M15 18l-6-6 6-6"/>');
export const ICON_CHEVRON_DOWN = svg('<path d="M6 9l6 6 6-6"/>');
export const ICON_PLUS = svg('<path d="M12 5v14M5 12h14"/>');
export const ICON_MAP_PIN = svg('<path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10z"/><circle cx="12" cy="11" r="2.2"/>');
export const ICON_REPEAT = svg('<path d="M4 11a7 7 0 0 1 12.4-4.5L19 9"/><path d="M19 4v5h-5"/><path d="M20 13a7 7 0 0 1-12.4 4.5L5 15"/><path d="M5 20v-5h5"/>');
export const ICON_CHECK = svg('<path d="M5 12.5l4.5 4.5L19 7"/>');
export const ICON_DOWNLOAD = svg('<path d="M12 4v10"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/>');
export const ICON_UPLOAD = svg('<path d="M12 15V5"/><path d="M7.5 9.5 12 5l4.5 4.5"/><path d="M5 19h14"/>');
export const ICON_X = svg('<path d="M6 6l12 12M18 6 6 18"/>');
export const ICON_GRID = svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>');
export const ICON_LIST = svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>');
export const ICON_LINK = svg('<path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3"/>');

// 顶栏品牌标记：极简几何，与角色「小飞」区分，避免每页都出现卡通形象
export const LOGO_MARK = `<svg class="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <rect x="2.5" y="2.5" width="27" height="27" rx="9" fill="currentColor" opacity="0.13"/>
  <rect x="2.5" y="2.5" width="27" height="27" rx="9" stroke="currentColor" stroke-width="2"/>
  <path d="M9.8 16.6l3.9 3.9 8.6-9.2" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
