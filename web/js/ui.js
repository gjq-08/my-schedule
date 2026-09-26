// ui.js - 通用 UI 组件：toast、确认框、骨架屏、模态框

// Toast 通知
let toastTimer = null;
export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// 确认对话框
export function showConfirm(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <p class="confirm-message">${escapeHtml(message)}</p>
      <div class="confirm-actions">
        <button class="btn btn-secondary" data-action="cancel">取消</button>
        <button class="btn btn-danger" data-action="confirm">确认</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (action === 'confirm') {
      overlay.remove();
      onConfirm();
    } else if (action === 'cancel' || e.target === overlay) {
      overlay.remove();
    }
  });
}

// 骨架屏
export function showSkeleton(container, rows = 3) {
  container.innerHTML = '';
  for (let i = 0; i < rows; i++) {
    const row = document.createElement('div');
    row.className = 'skeleton-row';
    row.innerHTML = `
      <div class="skeleton-block" style="width: ${60 + Math.random() * 30}%"></div>
      <div class="skeleton-block" style="width: ${30 + Math.random() * 20}%"></div>
    `;
    container.appendChild(row);
  }
}

// HTML 转义
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 模态框基类
export class Modal {
  constructor(title, contentHtml, options = {}) {
    this.title = title;
    this.contentHtml = contentHtml;
    this.options = options;
    this.overlay = null;
  }

  show() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    const isMobile = window.innerWidth < 768;
    const positionClass = isMobile ? 'modal-sheet' : 'modal-center';

    this.overlay.innerHTML = `
      <div class="modal ${positionClass}">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(this.title)}</h3>
          <button class="modal-close" aria-label="关闭">&times;</button>
        </div>
        <div class="modal-body">
          ${this.contentHtml}
        </div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay || e.target.classList.contains('modal-close')) {
        this.close();
      }
    });

    document.addEventListener('keydown', this._escHandler = (e) => {
      if (e.key === 'Escape') this.close();
    });

    return this.overlay.querySelector('.modal-body');
  }

  close() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
  }

  getContent() {
    return this.overlay?.querySelector('.modal-body');
  }
}

// 错误横幅
export function showErrorBanner(message, onRetry) {
  let banner = document.getElementById('error-banner');
  if (banner) banner.remove();

  banner = document.createElement('div');
  banner.id = 'error-banner';
  banner.className = 'error-banner';
  banner.innerHTML = `
    <span class="error-text">${escapeHtml(message)}</span>
    ${onRetry ? '<button class="btn-retry">重试</button>' : ''}
  `;
  if (onRetry) {
    banner.querySelector('.btn-retry').addEventListener('click', () => {
      banner.remove();
      onRetry();
    });
  }
  const topBar = document.getElementById('top-bar');
  topBar?.after(banner);
}

export function hideErrorBanner() {
  const banner = document.getElementById('error-banner');
  if (banner) banner.remove();
}
