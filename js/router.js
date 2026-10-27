/**
 * router.js
 * Navigasi antarhalaman tanpa memuat ulang dokumen, dengan dukungan hash
 * sehingga halaman terakhir tetap terbuka saat refresh.
 */

import { $, $$, el, icon } from './utils.js';

const routes = new Map();
let currentRouteName = null;
let currentParams = {};
let currentRender = null;

export function registerRoute(name, config) {
  if (!name || typeof config?.render !== 'function') {
    throw new Error(`Rute "${name}" tidak valid.`);
  }
  routes.set(name, {
    title: config.title || name,
    subtitle: config.subtitle || '',
    render: config.render
  });
}

function parseHashRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim();
  return raw || null;
}

function setActiveNav(name) {
  $$('.nav-link[data-route]').forEach((link) => {
    const isActive = link.dataset.route === name;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function closeMobileSidebar() {
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  const toggle = $('#menu-toggle');
  sidebar?.classList.remove('open');
  backdrop?.classList.remove('show');
  toggle?.setAttribute('aria-expanded', 'false');
}

function setHeader(title, subtitle) {
  const titleNode = $('#page-title');
  const subtitleNode = $('#page-subtitle');
  if (titleNode) titleNode.textContent = title;
  if (subtitleNode) subtitleNode.textContent = subtitle;
  document.title = `${title} — UsahaPOS`;
}

function renderFatalError(container, error, retry) {
  const detail = error && error.message ? error.message : 'Terjadi kesalahan yang tidak diketahui.';
  container.replaceChildren(
    el('div', { class: 'card' }, el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-icon' }, icon('alert-triangle')),
      el('h4', { text: 'Halaman gagal dimuat' }),
      el('p', { text: detail }),
      el('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        onClick: retry
      }, [icon('refresh'), 'Muat ulang halaman'])
    ]))
  );
  console.error('UsahaPOS — gagal merender halaman:', error);
}

export function navigate(name, params = {}, options = {}) {
  const targetName = routes.has(name) ? name : 'dashboard';
  const route = routes.get(targetName);
  if (!route) return;

  currentRouteName = targetName;
  currentParams = params && typeof params === 'object' ? { ...params } : {};
  currentRender = { route, params: currentParams };

  if (options.updateHash !== false) {
    const hash = `#/${targetName}`;
    if (window.location.hash !== hash) {
      try {
        window.history.pushState({ route: targetName }, '', hash);
      } catch {
        window.location.hash = hash;
      }
    }
  }

  setActiveNav(targetName);
  setHeader(route.title, route.subtitle);

  const container = $('#page-content');
  if (!container) return;
  container.replaceChildren();

  try {
    route.render(container, currentParams);
  } catch (error) {
    renderFatalError(container, error, () => refreshCurrentRoute());
  }

  closeMobileSidebar();
  window.scrollTo(0, 0);
}

export function refreshCurrentRoute() {
  if (!currentRender) return;
  const { route, params } = currentRender;
  const container = $('#page-content');
  if (!container) return;
  container.replaceChildren();
  try {
    route.render(container, { ...params });
  } catch (error) {
    renderFatalError(container, error, () => refreshCurrentRoute());
  }
}

export function getCurrentRoute() {
  return { name: currentRouteName, params: { ...currentParams } };
}

export function initRouter(fallback = 'dashboard') {
  const hashRoute = parseHashRoute();
  const initial = hashRoute && routes.has(hashRoute) ? hashRoute : fallback;
  navigate(initial, {}, { updateHash: false });

  const handleLocation = () => {
    const name = parseHashRoute();
    if (name && routes.has(name) && name !== currentRouteName) {
      navigate(name, {}, { updateHash: false });
    }
  };

  window.addEventListener('popstate', handleLocation);
  window.addEventListener('hashchange', handleLocation);
}
