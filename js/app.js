/**
 * app.js
 * Titik masuk aplikasi: inisialisasi penyimpanan, pendaftaran rute,
 * navigasi, pembaruan identitas usaha, dan penanganan galat awal.
 */

import {
  $,
  $$,
  el,
  formatDateFull,
  getInitials,
  icon,
  setCurrencyFormat,
  toast
} from './utils.js';
import {
  getSettings,
  initStorage
} from './storage.js';
import { initRouter, navigate, registerRoute } from './router.js';
import { renderDashboard } from './dashboard.js';
import { renderCashierPage } from './cashier.js';
import { renderProductsPage } from './products.js';
import { renderCategoriesPage } from './categories.js';
import { renderInventoryPage } from './inventory.js';
import { renderTransactionsPage } from './transactions.js';
import { renderReportsPage } from './reports.js';
import { renderSettingsPage } from './settings.js';

let sidebarOpen = false;

function setSidebar(open) {
  sidebarOpen = Boolean(open);
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  const toggle = $('#menu-toggle');
  sidebar?.classList.toggle('open', sidebarOpen);
  backdrop?.classList.toggle('show', sidebarOpen);
  if (toggle) {
    toggle.setAttribute('aria-expanded', sidebarOpen ? 'true' : 'false');
    toggle.setAttribute('aria-label', sidebarOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi');
  }
}

function updateBusinessChrome() {
  let settings;
  try {
    settings = getSettings();
  } catch (error) {
    console.error('UsahaPOS — gagal membaca pengaturan:', error);
    return;
  }

  const name = settings.businessName || 'UsahaPOS';
  const owner = settings.ownerName || 'Pemilik usaha';
  const nameNode = $('#business-name');
  const ownerNode = $('#business-owner');
  const initialsNode = $('#business-initials');
  const chip = $('#business-chip');

  if (nameNode) nameNode.textContent = name;
  if (ownerNode) ownerNode.textContent = owner;
  if (initialsNode) initialsNode.textContent = getInitials(name);
  if (chip) chip.setAttribute('aria-label', `Buka pengaturan usaha ${name}`);
  setCurrencyFormat(settings.currencyFormat);
}

function updateTopbarDate() {
  const node = $('#topbar-date-text');
  if (node) node.textContent = formatDateFull(new Date());
}

function registerNavigation() {
  $$('.nav-link[data-route]').forEach((button) => {
    button.addEventListener('click', () => {
      const route = button.dataset.route;
      if (route) navigate(route);
    });
  });

  const menuToggle = $('#menu-toggle');
  menuToggle?.addEventListener('click', () => setSidebar(!sidebarOpen));

  const backdrop = $('#sidebar-backdrop');
  backdrop?.addEventListener('click', () => setSidebar(false));

  const businessChip = $('#business-chip');
  businessChip?.addEventListener('click', () => navigate('settings'));

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !sidebarOpen) return;
    if (document.body.classList.contains('modal-open')) return;
    setSidebar(false);
    menuToggle?.focus({ preventScroll: true });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024 && sidebarOpen) setSidebar(false);
  });

  document.addEventListener('usahapos:settingschanged', updateBusinessChrome);
  document.addEventListener('usahapos:datachanged', (event) => {
    if (event.detail?.topic === 'settings') updateBusinessChrome();
  });
}

function registerRoutes() {
  registerRoute('dashboard', {
    title: 'Dashboard',
    subtitle: 'Ringkasan kondisi usaha',
    render: renderDashboard
  });
  registerRoute('cashier', {
    title: 'Kasir',
    subtitle: 'Proses penjualan dan pembayaran',
    render: renderCashierPage
  });
  registerRoute('products', {
    title: 'Produk',
    subtitle: 'Kelola katalog, harga, dan status produk',
    render: renderProductsPage
  });
  registerRoute('categories', {
    title: 'Kategori',
    subtitle: 'Kelompokkan produk usaha',
    render: renderCategoriesPage
  });
  registerRoute('inventory', {
    title: 'Stok Barang',
    subtitle: 'Pantau persediaan dan pergerakan stok',
    render: renderInventoryPage
  });
  registerRoute('transactions', {
    title: 'Transaksi',
    subtitle: 'Riwayat penjualan, struk, dan pembatalan',
    render: renderTransactionsPage
  });
  registerRoute('reports', {
    title: 'Laporan',
    subtitle: 'Analisis penjualan, laba, dan produk terlaris',
    render: renderReportsPage
  });
  registerRoute('settings', {
    title: 'Pengaturan',
    subtitle: 'Identitas usaha, data lokal, dan cadangan',
    render: renderSettingsPage
  });
}

function showInitializationError(error) {
  const container = $('#page-content');
  if (!container) return;

  const message = error && error.message
    ? error.message
    : 'Aplikasi tidak dapat menyiapkan penyimpanan lokal.';

  container.replaceChildren(
    el('div', { class: 'card', style: { maxWidth: '660px', margin: '40px auto' } },
      el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-icon' }, icon('alert-triangle')),
        el('h4', { text: 'Aplikasi tidak dapat dijalankan' }),
        el('p', { text: message }),
        el('p', {
          style: { fontSize: '11.5px', color: 'var(--gray-500)', lineHeight: '1.6' },
          text: 'Pastikan browser tidak memblokir LocalStorage (misalnya mode privat ketat), lalu muat ulang halaman. Aplikasi ini memerlukan JavaScript dan penyimpanan lokal untuk berjalan.'
        }),
        el('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          onClick: () => window.location.reload()
        }, [icon('refresh'), 'Muat Ulang'])
      ]))
  );
  console.error('UsahaPOS — inisialisasi gagal:', error);
}

function initialize() {
  registerRoutes();
  registerNavigation();
  updateTopbarDate();
  window.setInterval(updateTopbarDate, 60_000);

  let initResult;
  try {
    initResult = initStorage();
  } catch (error) {
    showInitializationError(error);
    return;
  }

  updateBusinessChrome();
  initRouter('dashboard');

  const warnings = Array.isArray(initResult.warnings) ? initResult.warnings : [];
  if (warnings.length) {
    toast(
      warnings.length === 1
        ? warnings[0]
        : `${warnings[0]} (${warnings.length} peringatan penyimpanan ditemukan.)`,
      'warning',
      'Peringatan data'
    );
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}
