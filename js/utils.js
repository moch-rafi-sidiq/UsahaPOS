/**
 * utils.js
 * Helper umum: format angka/tanggal, DOM, ikon, modal, toast, CSV.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

let currencyFormat = 'nospace';
let idCounter = 0;

/* ==========================================================================
   Konstanta bersama
   ========================================================================== */

export const PAYMENT_METHODS = {
  cash: { id: 'cash', label: 'Tunai', short: 'Tunai', icon: 'banknote', description: 'Pembayaran uang tunai' },
  qris: { id: 'qris', label: 'QRIS', short: 'QRIS', icon: 'qr-code', description: 'Pindai kode QR' },
  transfer: { id: 'transfer', label: 'Transfer Bank', short: 'Transfer', icon: 'transfer', description: 'Transfer antar bank' },
  card: { id: 'card', label: 'Debit/Kartu', short: 'Kartu', icon: 'credit-card', description: 'Kartu debit atau kredit' }
};

export const PAYMENT_IDS = Object.keys(PAYMENT_METHODS);

export const MOVEMENT_TYPES = {
  initial: { label: 'Stok awal', icon: 'box', tone: 'neutral' },
  in: { label: 'Stok masuk', icon: 'arrow-down', tone: 'success' },
  adjustment: { label: 'Penyesuaian', icon: 'sliders', tone: 'warning' },
  sale: { label: 'Penjualan', icon: 'cart', tone: 'info' },
  cancel: { label: 'Pengembalian', icon: 'rotate-ccw', tone: 'purple' }
};

export const TRX_STATUS = {
  completed: { label: 'Selesai', tone: 'success' },
  cancelled: { label: 'Dibatalkan', tone: 'danger' }
};

/* ==========================================================================
   Selector & DOM
   ========================================================================== */

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * Membuat elemen dengan API ringkas dan aman.
 * Gunakan atribut `text` untuk teks pengguna (bukan innerHTML).
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

function applyAttrs(node, attrs = {}) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'checked' || key === 'selected' || key === 'disabled') {
      node[key] = Boolean(value);
    } else if (key === 'value') {
      node.value = value;
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

function appendChildren(parent, children) {
  if (children === null || children === undefined) return;
  if (Array.isArray(children)) {
    children.flat(Infinity).forEach((child) => appendChildren(parent, child));
    return;
  }
  if (children instanceof Node) {
    parent.appendChild(children);
    return;
  }
  parent.appendChild(document.createTextNode(String(children)));
}

export function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function icon(name, extraClass = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${extraClass}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

export function setText(selectorOrNode, value) {
  const node = typeof selectorOrNode === 'string' ? $(selectorOrNode) : selectorOrNode;
  if (node) node.textContent = value;
}

export function debounce(fn, wait = 250) {
  let timer = null;
  return function debounced(...args) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), wait);
  };
}

export function focusFirst(container) {
  if (!container) return;
  const target = container.querySelector('[data-autofocus], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
  if (target) target.focus({ preventScroll: true });
}

/* ==========================================================================
   Angka & mata uang
   ========================================================================== */

export function setCurrencyFormat(format) {
  currencyFormat = format === 'space' ? 'space' : 'nospace';
}

export function getCurrencyFormat() {
  return currencyFormat;
}

export function formatNumber(value, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0, ...options }).format(number);
}

export function formatCurrency(value) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? Math.round(number) : 0;
  const sign = safe < 0 ? '-' : '';
  const amount = Math.abs(safe).toLocaleString('id-ID');
  return `${sign}Rp${currencyFormat === 'space' ? ' ' : ''}${amount}`;
}

export function formatCompactCurrency(value) {
  const number = Number(value) || 0;
  const abs = Math.abs(number);
  const sign = number < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    return `${sign}Rp${(abs / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  }
  if (abs >= 1_000_000) {
    return `${sign}Rp${(abs / 1_000_000).toFixed(1).replace('.', ',')} jt`;
  }
  if (abs >= 1_000) {
    return `${sign}Rp${Math.round(abs / 1_000)} rb`;
  }
  return `${sign}Rp${Math.round(abs)}`;
}

export function toNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim() !== '') {
    const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function toInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.trunc(number);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0%';
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(number)}%`;
}

/* ==========================================================================
   Tanggal & waktu (format Indonesia)
   ========================================================================== */

const dateLongFormatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
const dateShortFormatter = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const dayMonthFormatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
const weekdayFormatter = new Intl.DateTimeFormat('id-ID', { weekday: 'short' });
const timeFormatter = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
const fullFormatter = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});

export function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateLong(value) {
  const date = toDate(value);
  return date ? dateLongFormatter.format(date) : '—';
}

export function formatDateShort(value) {
  const date = toDate(value);
  return date ? dateShortFormatter.format(date) : '—';
}

export function formatDateFull(value) {
  const date = toDate(value);
  return date ? fullFormatter.format(date) : '—';
}

export function formatDayMonth(value) {
  const date = toDate(value);
  return date ? dayMonthFormatter.format(date) : '—';
}

export function formatWeekday(value) {
  const date = toDate(value);
  return date ? weekdayFormatter.format(date) : '—';
}

export function formatTime(value) {
  const date = toDate(value);
  return date ? timeFormatter.format(date).replace('.', ':') : '—';
}

export function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return '—';
  return `${dateShortFormatter.format(date)}, ${timeFormatter.format(date).replace('.', ':')}`;
}

export function formatDateTimeFull(value) {
  const date = toDate(value);
  if (!date) return '—';
  return `${fullFormatter.format(date)} • ${timeFormatter.format(date).replace('.', ':')}`;
}

export function dateKey(value = new Date()) {
  const date = toDate(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayKey() {
  return dateKey(new Date());
}

export function parseDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function startOfDay(value = new Date()) {
  const date = toDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfDay(value = new Date()) {
  const date = toDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function startOfMonth(value = new Date()) {
  const date = toDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

export function addDays(value, amount) {
  const date = toDate(value) || new Date();
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + Number(amount || 0));
  return result;
}

export function addMonths(value, amount) {
  const date = toDate(value) || new Date();
  const result = new Date(date.getTime());
  result.setMonth(result.getMonth() + Number(amount || 0));
  return result;
}

export function diffInDays(start, end) {
  const a = startOfDay(start);
  const b = startOfDay(end);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function enumerateDateKeys(startKey, endKey) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end || start > end) return [];
  const result = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 1000) {
    result.push(dateKey(cursor));
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return result;
}

/* ==========================================================================
   ID, salinan, teks
   ========================================================================== */

export function uid(prefix = 'id') {
  let random;
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    random = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  } else {
    random = `${Date.now().toString(36)}${(idCounter += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${prefix}_${random}`;
}

export function deepClone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* jatuh ke JSON */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeKey(value) {
  return normalizeWhitespace(value).toLocaleLowerCase('id-ID');
}

export function getInitials(name, fallback = 'UP') {
  const words = normalizeWhitespace(name).split(' ').filter(Boolean);
  if (!words.length) return fallback;
  const initials = words.slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase();
  return initials || fallback;
}

export function getStockStatus(product) {
  const stock = Number(product?.stock) || 0;
  const minimum = Number(product?.minStock) || 0;
  if (stock <= 0) return { key: 'out', label: 'Stok habis', tone: 'danger' };
  if (stock <= minimum) return { key: 'low', label: 'Stok menipis', tone: 'warning' };
  return { key: 'ok', label: 'Stok tersedia', tone: 'success' };
}

/* ==========================================================================
   Paginasi
   ========================================================================== */

export function paginate(items, page, pageSize) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = clamp(Number(page) || 1, 1, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);
  return {
    items: pageItems,
    total,
    totalPages,
    page: currentPage,
    start: total === 0 ? 0 : startIndex + 1,
    end: Math.min(startIndex + pageSize, total)
  };
}

export function buildPagination(totalPages, currentPage, onSelect) {
  const nav = el('nav', { class: 'pagination', 'aria-label': 'Navigasi halaman' });
  if (totalPages <= 1) return nav;

  const makeButton = (label, page, options = {}) => {
    const button = el('button', {
      type: 'button',
      'aria-label': options.ariaLabel || `Halaman ${page}`,
      ...(options.icon ? {} : { text: label }),
      disabled: Boolean(options.disabled),
      onClick: () => {
        if (!options.disabled && page !== currentPage) onSelect(page);
      }
    });
    if (options.active) {
      button.classList.add('active');
      button.setAttribute('aria-current', 'page');
    }
    if (options.icon) button.appendChild(icon(options.icon, 'icon-sm'));
    return button;
  };

  nav.appendChild(makeButton('', currentPage - 1, {
    icon: 'chevron-left',
    ariaLabel: 'Halaman sebelumnya',
    disabled: currentPage <= 1
  }));

  const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  if (currentPage <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (currentPage >= totalPages - 2) [totalPages - 1, totalPages - 2, totalPages - 3].forEach((p) => pages.add(p));
  const sorted = Array.from(pages).filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  let previous = 0;
  sorted.forEach((page) => {
    if (previous && page - previous > 1) {
      nav.appendChild(el('span', { class: 'pagination-ellipsis', text: '…', style: { padding: '0 2px', color: 'var(--gray-400)' } }));
    }
    nav.appendChild(makeButton(String(page), page, { active: page === currentPage }));
    previous = page;
  });

  nav.appendChild(makeButton('', currentPage + 1, {
    icon: 'chevron-right',
    ariaLabel: 'Halaman berikutnya',
    disabled: currentPage >= totalPages
  }));

  return nav;
}

/* ==========================================================================
   Toast
   ========================================================================== */

const TOAST_DEFAULTS = {
  success: { title: 'Berhasil', icon: 'check-circle' },
  error: { title: 'Terjadi kesalahan', icon: 'x-circle' },
  warning: { title: 'Perhatian', icon: 'alert-triangle' },
  info: { title: 'Informasi', icon: 'info' }
};

export function toast(message, type = 'success', title = '') {
  const root = $('#toast-root');
  if (!root) return;

  const safeType = TOAST_DEFAULTS[type] ? type : 'info';
  const defaults = TOAST_DEFAULTS[safeType];

  while (root.children.length >= 4) root.removeChild(root.firstElementChild);

  const closeButton = el('button', {
    class: 'toast-close',
    type: 'button',
    'aria-label': 'Tutup notifikasi'
  }, icon('x'));

  const node = el('div', { class: `toast toast-${safeType}`, role: 'status' }, [
    el('div', { class: 'toast-icon' }, icon(defaults.icon)),
    el('div', { class: 'toast-body' }, [
      el('strong', { text: title || defaults.title }),
      el('p', { text: message })
    ]),
    closeButton
  ]);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    node.classList.add('leaving');
    window.setTimeout(() => node.remove(), 180);
  };

  closeButton.addEventListener('click', remove);
  root.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  window.setTimeout(remove, safeType === 'error' ? 5600 : 4200);
}

/* ==========================================================================
   Modal & konfirmasi
   ========================================================================== */

const modalStack = [];

function updateBodyLock() {
  document.body.classList.toggle('modal-open', modalStack.length > 0);
}

function getFocusable(container) {
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((node) => node.offsetParent !== null || node === document.activeElement);
}

export function openModal(options = {}) {
  const {
    title = '',
    subtitle = '',
    content = null,
    footer = null,
    size = 'md',
    overlayClass = '',
    panelClass = '',
    showClose = true,
    closeOnBackdrop = true,
    onClose = null
  } = options;

  const previouslyFocused = document.activeElement;
  const titleId = `modal-title-${uid('m')}`;
  const overlay = el('div', {
    class: `modal-overlay ${overlayClass}`.trim(),
    role: 'presentation'
  });
  const panel = el('div', {
    class: `modal modal-${size} ${panelClass}`.trim(),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': title ? titleId : undefined,
    tabindex: '-1'
  });

  if (title || showClose) {
    const closeButton = el('button', {
      class: 'modal-close',
      type: 'button',
      'aria-label': 'Tutup dialog'
    }, icon('x'));
    const heading = el('div', { class: 'modal-heading' }, [
      el('h2', { id: titleId, text: title }),
      subtitle ? el('p', { text: subtitle }) : null
    ]);
    const header = el('div', { class: 'modal-header' }, [heading]);
    if (showClose) {
      closeButton.addEventListener('click', () => close('close'));
      header.appendChild(closeButton);
    }
    panel.appendChild(header);
  }

  if (content) {
    const body = el('div', { class: 'modal-body' });
    appendChildren(body, content);
    panel.appendChild(body);
  }

  if (footer) {
    const footerNode = footer.classList && footer.classList.contains('modal-footer')
      ? footer
      : el('div', { class: 'modal-footer' });
    if (footerNode !== footer) appendChildren(footerNode, footer);
    panel.appendChild(footerNode);
  }

  overlay.appendChild(panel);

  let closed = false;
  let handle;

  function close(reason = 'dismiss') {
    if (closed) return;
    closed = true;
    overlay.classList.remove('show');
    document.removeEventListener('keydown', onKeyDown);
    const index = modalStack.indexOf(handle);
    if (index >= 0) modalStack.splice(index, 1);
    updateBodyLock();
    window.setTimeout(() => overlay.remove(), 160);
    if (typeof onClose === 'function') onClose(reason);
    if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
      window.setTimeout(() => previouslyFocused.focus({ preventScroll: true }), 170);
    }
  }

  function onKeyDown(event) {
    if (modalStack[modalStack.length - 1] !== handle) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close('escape');
      return;
    }
    if (event.key === 'Tab') {
      const focusable = getFocusable(panel);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  handle = { overlay, panel, close };

  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay && closeOnBackdrop) close('backdrop');
  });

  document.addEventListener('keydown', onKeyDown);
  modalStack.push(handle);
  document.body.appendChild(overlay);
  updateBodyLock();

  requestAnimationFrame(() => {
    overlay.classList.add('show');
    const focusTarget = panel.querySelector('[data-autofocus]') || panel;
    focusTarget.focus({ preventScroll: true });
  });

  return handle;
}

/**
 * Dialog konfirmasi. Mengembalikan Promise<boolean>.
 */
export function confirmDialog(options = {}) {
  const {
    title = 'Konfirmasi tindakan',
    message = 'Apakah Anda yakin ingin melanjutkan?',
    details = [],
    confirmLabel = 'Ya, lanjutkan',
    cancelLabel = 'Batal',
    danger = false,
    verifyText = null,
    verifyHint = null
  } = options;

  return new Promise((resolve) => {
    let resolved = false;
    let modalRef = null;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const body = el('div');
    if (message instanceof Node) {
      body.appendChild(message);
    } else {
      body.appendChild(el('p', { class: 'confirm-copy', text: message }));
    }

    if (Array.isArray(details) && details.length) {
      const list = el('ul', {
        class: 'confirm-warning form-note warning',
        style: { flexDirection: 'column', listStyle: 'none', padding: '10px 13px' }
      });
      details.forEach((detail) => {
        list.appendChild(el('li', {
          text: detail,
          style: { display: 'flex', gap: '7px', alignItems: 'flex-start' }
        }));
      });
      body.appendChild(list);
    }

    let verifyInput = null;
    if (verifyText) {
      verifyInput = el('input', {
        class: 'input',
        type: 'text',
        autocomplete: 'off',
        placeholder: `Ketik ${verifyText}`,
        'aria-label': `Ketik ${verifyText} untuk konfirmasi`
      });
      body.appendChild(el('div', { class: 'field verify-field' }, [
        el('label', { text: `Konfirmasi dengan mengetik ${verifyText}` }),
        verifyInput,
        el('p', { class: 'field-hint', text: verifyHint || 'Tindakan ini tidak dapat dibatalkan.' })
      ]));
    }

    const cancelButton = el('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: cancelLabel
    });
    const confirmButton = el('button', {
      class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
      type: 'button',
      text: confirmLabel,
      disabled: Boolean(verifyText)
    });

    cancelButton.addEventListener('click', () => {
      finish(false);
      modalRef?.close('cancel');
    });

    confirmButton.addEventListener('click', () => {
      if (verifyText && verifyInput.value.trim() !== verifyText) return;
      finish(true);
      modalRef?.close('confirm');
    });

    if (verifyInput) {
      verifyInput.addEventListener('input', () => {
        confirmButton.disabled = verifyInput.value.trim() !== verifyText;
      });
      verifyInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !confirmButton.disabled) {
          event.preventDefault();
          finish(true);
          modalRef?.close('confirm');
        }
      });
    }

    const footer = el('div', { class: 'modal-footer' }, [cancelButton, confirmButton]);

    modalRef = openModal({
      title,
      content: body,
      footer,
      size: 'sm',
      panelClass: 'confirm-modal',
      onClose: () => finish(false)
    });

    if (verifyInput) {
      window.setTimeout(() => verifyInput.focus({ preventScroll: true }), 50);
    }
  });
}

/* ==========================================================================
   Unduhan & CSV
   ========================================================================== */

export function downloadFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text) || text.startsWith("'")) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function rowsToCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename, rows) {
  const csv = `\uFEFF${rowsToCsv(rows)}`;
  downloadFile(filename, csv, 'text/csv;charset=utf-8;');
}

/* ==========================================================================
   Event data berubah
   ========================================================================== */

export function emitDataChanged(topic = 'all') {
  document.dispatchEvent(new CustomEvent('usahapos:datachanged', { detail: { topic } }));
}

export function emitSettingsChanged() {
  document.dispatchEvent(new CustomEvent('usahapos:settingschanged'));
}
