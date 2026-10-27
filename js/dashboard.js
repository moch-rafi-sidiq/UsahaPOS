/**
 * dashboard.js
 * Ringkasan usaha: statistik hari ini, grafik 7 hari, transaksi terbaru,
 * produk terlaris, dan peringatan stok.
 */

import {
  PAYMENT_METHODS,
  formatCompactCurrency,
  formatCurrency,
  formatDateFull,
  formatDateTime,
  formatNumber,
  getInitials,
  el,
  icon
} from './utils.js';
import { getCategories, getMeta, getProducts, getSettings, getTransactions } from './storage.js';
import { getDashboardData } from './calculations.js';
import { navigate } from './router.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  });
  return node;
}

function statCard({ label, value, iconName, color, foot, onClick }) {
  const tag = onClick ? 'button' : 'div';
  const attrs = {
    class: 'stat-card',
    ...(onClick ? { type: 'button', onClick } : {})
  };
  const node = el(tag, attrs, [
    el('div', { class: 'stat-top' }, [
      el('span', { class: 'stat-label', text: label }),
      el('span', { class: `stat-icon ${color}` }, icon(iconName))
    ]),
    el('div', { class: 'stat-value', text: value }),
    foot ? el('div', { class: 'stat-foot', text: foot }) : null
  ]);
  return node;
}

function sectionCard({ title, subtitle, action, body, flush = false }) {
  const card = el('section', { class: 'card' });
  const head = el('div', { class: 'section-head' }, [
    el('div', { class: 'section-head-copy' }, [
      el('h3', { text: title }),
      subtitle ? el('p', { text: subtitle }) : null
    ])
  ]);
  if (action) {
    head.appendChild(el('div', { class: 'section-head-actions' }, action));
  }
  card.appendChild(head);
  if (flush) card.appendChild(body);
  else card.appendChild(el('div', { class: 'card-body' }, body));
  return card;
}

function emptyState({ iconName = 'inbox', title, message, actionLabel, onAction, compact = false }) {
  return el('div', { class: `empty-state ${compact ? 'compact' : ''}`.trim() }, [
    el('div', { class: 'empty-icon' }, icon(iconName)),
    el('h4', { text: title }),
    el('p', { text: message }),
    actionLabel && onAction
      ? el('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: onAction }, [icon('cart'), actionLabel])
      : null
  ]);
}

function buildDemoBanner() {
  return el('div', { class: 'demo-banner', role: 'note' }, [
    icon('info'),
    el('div', { class: 'demo-banner-copy' }, [
      el('strong', { text: 'Data demo sedang aktif. ' }),
      el('span', { text: 'Produk dan transaksi contoh disediakan agar aplikasi langsung terlihat hidup. Hapus data demo kapan saja melalui Pengaturan.' })
    ]),
    el('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      onClick: () => navigate('settings')
    }, 'Kelola Data')
  ]);
}

function niceAxis(maxValue) {
  if (!maxValue || maxValue <= 0) return { max: 10_000, step: 2_500 };
  const roughStep = maxValue / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  let nice = 1;
  if (normalized > 1 && normalized <= 2) nice = 2;
  else if (normalized > 2 && normalized <= 2.5) nice = 2.5;
  else if (normalized > 2.5 && normalized <= 5) nice = 5;
  else if (normalized > 5) nice = 10;
  let step = nice * magnitude;
  let max = Math.ceil(maxValue / step) * step;
  let ticks = Math.round(max / step);
  while (ticks > 5) {
    step *= 2;
    max = Math.ceil(maxValue / step) * step;
    ticks = Math.round(max / step);
  }
  return { max, step };
}

function buildSalesChart(series) {
  const totalRevenue = series.reduce((sum, point) => sum + point.revenue, 0);
  if (totalRevenue <= 0) {
    return el('div', { class: 'chart-wrap' }, [
      emptyState({
        iconName: 'chart',
        title: 'Belum ada penjualan',
        message: 'Grafik akan terisi otomatis setelah transaksi pertama berhasil disimpan.',
        actionLabel: 'Mulai Transaksi',
        onAction: () => navigate('cashier')
      })
    ]);
  }

  const width = 720;
  const height = 268;
  const padding = { top: 22, right: 14, bottom: 44, left: 58 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxRevenue = Math.max(...series.map((point) => point.revenue));
  const { max: axisMax, step } = niceAxis(maxRevenue);
  const svg = svgEl('svg', {
    class: 'sales-chart',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Grafik penjualan tujuh hari terakhir'
  });

  const gridCount = Math.round(axisMax / step);
  for (let index = 0; index <= gridCount; index += 1) {
    const value = index * step;
    const y = padding.top + plotHeight - (value / axisMax) * plotHeight;
    svg.appendChild(svgEl('line', {
      class: 'grid-line',
      x1: padding.left,
      x2: width - padding.right,
      y1: y,
      y2: y
    }));
    const label = svgEl('text', {
      class: 'axis-label',
      x: padding.left - 8,
      y: y + 3,
      'text-anchor': 'end'
    });
    label.textContent = formatCompactCurrency(value);
    svg.appendChild(label);
  }

  const slot = plotWidth / series.length;
  const barWidth = Math.min(36, slot * 0.44);

  series.forEach((point, index) => {
    const centerX = padding.left + slot * index + slot / 2;
    const barHeight = point.revenue > 0
      ? Math.max(3, (point.revenue / axisMax) * plotHeight)
      : 0;
    const barY = padding.top + plotHeight - barHeight;

    const group = svgEl('g', { class: 'bar-group' });
    const title = svgEl('title');
    title.textContent = `${point.fullLabel}: ${formatCurrency(point.revenue)} • ${formatNumber(point.transactionCount)} transaksi`;
    group.appendChild(title);

    if (barHeight > 0) {
      group.appendChild(svgEl('rect', {
        class: `bar ${index === series.length - 1 ? 'today' : ''}`.trim(),
        x: centerX - barWidth / 2,
        y: barY,
        width: barWidth,
        height: barHeight,
        rx: 4
      }));
      const valueLabel = svgEl('text', {
        class: 'value-label',
        x: centerX,
        y: barY - 7
      });
      valueLabel.textContent = point.revenue > 0 ? formatCompactCurrency(point.revenue).replace('Rp', '') : '';
      group.appendChild(valueLabel);
    }

    const weekdayLabel = svgEl('text', {
      class: 'axis-label',
      x: centerX,
      y: height - 23,
      'text-anchor': 'middle'
    });
    weekdayLabel.textContent = point.weekday;
    group.appendChild(weekdayLabel);

    const dateLabel = svgEl('text', {
      class: 'axis-label',
      x: centerX,
      y: height - 10,
      'text-anchor': 'middle'
    });
    dateLabel.textContent = point.label;
    group.appendChild(dateLabel);

    svg.appendChild(group);
  });

  return el('div', { class: 'chart-wrap' }, svg);
}

function buildRecentTransactions(transactions) {
  if (!transactions.length) {
    return el('div', { class: 'card-body', style: { padding: '0' } }, emptyState({
      iconName: 'receipt',
      title: 'Belum ada transaksi',
      message: 'Transaksi yang berhasil diselesaikan akan muncul di sini.',
      actionLabel: 'Buka Kasir',
      onAction: () => navigate('cashier')
    }));
  }

  const tbody = el('tbody');
  transactions.forEach((transaction) => {
    const method = PAYMENT_METHODS[transaction.paymentMethod] || PAYMENT_METHODS.cash;
    const row = el('tr', {
      class: 'row-clickable',
      tabindex: '0',
      'aria-label': `Buka transaksi ${transaction.number}`,
      onClick: () => navigate('transactions', { openId: transaction.id }),
      onKeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigate('transactions', { openId: transaction.id });
        }
      }
    }, [
      el('td', {}, el('span', { class: 'transaction-number', text: transaction.number })),
      el('td', { class: 'nowrap' }, el('span', { class: 'cell-main', text: formatDateTime(transaction.createdAt) })),
      el('td', { class: 'nowrap' }, el('span', { class: 'cell-sub', text: `${formatNumber(transaction.itemCount)} item` })),
      el('td', { class: 'num' }, el('span', { class: 'cell-main', text: formatCurrency(transaction.total) })),
      el('td', { class: 'nowrap' }, el('span', { class: 'payment-inline' }, [icon(method.icon), method.short]))
    ]);
    tbody.appendChild(row);
  });

  return el('div', { class: 'table-wrap' }, el('table', { class: 'table recent-table' }, [
    el('thead', {}, el('tr', {}, [
      el('th', { text: 'Nomor' }),
      el('th', { text: 'Waktu' }),
      el('th', { text: 'Item' }),
      el('th', { class: 'num', text: 'Total' }),
      el('th', { text: 'Metode' })
    ])),
    tbody
  ]));
}

function buildBestSellers(bestSellers) {
  if (!bestSellers.length) {
    return el('div', { style: { padding: '0' } }, emptyState({
      iconName: 'trending-up',
      title: 'Belum ada produk terjual',
      message: 'Produk terlaris dihitung otomatis dari transaksi berhasil.',
      compact: true
    }));
  }

  return el('div', { class: 'best-seller-list' }, bestSellers.map((product, index) => (
    el('div', { class: 'best-seller-item' }, [
      el('span', { class: `rank-badge ${index === 0 ? 'top' : ''}`.trim(), text: `#${index + 1}` }),
      el('div', { class: 'best-seller-copy' }, [
        el('strong', { text: product.name }),
        el('span', { text: `${formatNumber(product.qty)} terjual` })
      ]),
      el('div', { class: 'best-seller-value' }, [
        el('strong', { text: formatCurrency(product.revenue) }),
        el('span', { text: 'penjualan' })
      ])
    ])
  )));
}

function buildStockAlerts(products) {
  if (!products.length) {
    return el('div', { style: { padding: '0' } }, emptyState({
      iconName: 'check-circle',
      title: 'Semua stok aman',
      message: 'Tidak ada produk yang berada pada atau di bawah batas minimum stok.',
      compact: true
    }));
  }

  const items = products.slice(0, 5).map((product) => {
    return el('div', { class: 'stock-alert-item' }, [
      el('span', { class: 'product-thumb', text: getInitials(product.name, 'P').slice(0, 2) }),
      el('div', { class: 'stock-alert-copy' }, [
        el('strong', { text: product.name }),
        el('span', { text: `${product.sku} • minimum ${formatNumber(product.minStock)}` })
      ]),
      el('div', { class: 'stock-alert-level' }, [
        el('strong', { text: `${formatNumber(product.stock)} tersisa` }),
        el('span', { text: product.stock <= 0 ? 'Habis' : 'Menipis' })
      ]),
      el('button', {
        class: 'icon-btn bordered',
        type: 'button',
        'aria-label': `Buka detail ${product.name}`,
        title: 'Lihat detail produk',
        onClick: () => navigate('products', { openProductId: product.id })
      }, icon('eye'))
    ]);
  });

  if (products.length > 5) {
    items.push(el('div', { style: { padding: '10px 18px' } }, el('button', {
      class: 'text-link',
      type: 'button',
      onClick: () => navigate('inventory', { stockFilter: 'low' })
    }, [`Lihat semua (${products.length})`, icon('arrow-right')])));
  }

  return el('div', { class: 'stock-alert-list' }, items);
}

export function renderDashboard(container) {
  const transactions = getTransactions();
  const products = getProducts();
  const categories = getCategories();
  const settings = getSettings();
  const meta = getMeta();
  const data = getDashboardData(transactions, products);

  const inactiveProducts = products.filter((product) => product.active === false).length;
  const averageTransaction = data.todaySummary.transactionCount > 0
    ? Math.round(data.todaySummary.revenue / data.todaySummary.transactionCount)
    : 0;
  const sevenDayRevenue = data.series.reduce((sum, point) => sum + point.revenue, 0);

  const wrapper = el('div', { class: 'dashboard-page' });
  if (meta.demoSeeded) wrapper.appendChild(buildDemoBanner());

  wrapper.appendChild(el('div', { class: 'page-head' }, [
    el('div', { class: 'page-head-copy' }, [
      el('h2', { text: `Ringkasan ${settings.businessName}` }),
      el('p', { text: formatDateFull(new Date()) })
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        onClick: () => navigate('cashier')
      }, [icon('cart'), 'Buka Kasir'])
    ])
  ]));

  wrapper.appendChild(el('div', { class: 'stats-grid' }, [
    statCard({
      label: 'Omzet hari ini',
      value: formatCurrency(data.todaySummary.revenue),
      iconName: 'wallet',
      color: 'blue',
      foot: `${formatNumber(data.todaySummary.transactionCount)} transaksi berhasil`
    }),
    statCard({
      label: 'Transaksi hari ini',
      value: formatNumber(data.todaySummary.transactionCount),
      iconName: 'receipt',
      color: 'green',
      foot: averageTransaction ? `Rata-rata ${formatCurrency(averageTransaction)}` : 'Belum ada transaksi'
    }),
    statCard({
      label: 'Estimasi laba kotor',
      value: formatCurrency(data.todaySummary.grossProfit),
      iconName: 'trending-up',
      color: 'purple',
      foot: 'Belum termasuk biaya operasional'
    }),
    statCard({
      label: 'Produk aktif',
      value: formatNumber(data.activeProductCount),
      iconName: 'package',
      color: 'amber',
      foot: `${formatNumber(products.length)} produk • ${formatNumber(inactiveProducts)} nonaktif`,
      onClick: () => navigate('products')
    }),
    statCard({
      label: 'Stok menipis',
      value: formatNumber(data.lowStockCount),
      iconName: 'alert-triangle',
      color: 'red',
      foot: data.lowStockCount ? 'Perlu segera ditambah' : 'Semua stok aman',
      onClick: () => navigate('inventory', { stockFilter: 'low' })
    })
  ]));

  const chartCard = sectionCard({
    title: 'Penjualan 7 hari terakhir',
    subtitle: 'Total omzet transaksi berhasil per hari',
    action: el('span', { class: 'badge badge-info', text: formatCurrency(sevenDayRevenue) }),
    body: buildSalesChart(data.series),
    flush: false
  });
  chartCard.classList.add('chart-card');
  const chartBody = chartCard.querySelector('.card-body');
  if (chartBody && chartBody.querySelector('.chart-wrap svg')) {
    chartBody.appendChild(el('div', { class: 'chart-footnote' }, [
      el('span', { class: 'legend-dot' }),
      'Omzet dihitung dari transaksi berstatus selesai.'
    ]));
  }

  const stockCard = sectionCard({
    title: 'Peringatan stok',
    subtitle: data.lowStockCount
      ? `${formatNumber(data.lowStockCount)} produk perlu perhatian`
      : 'Tidak ada peringatan',
    action: el('button', {
      class: 'text-link',
      type: 'button',
      onClick: () => navigate('inventory', { stockFilter: 'low' })
    }, ['Kelola stok', icon('arrow-right')]),
    body: buildStockAlerts(data.lowStockProducts),
    flush: true
  });

  wrapper.appendChild(el('div', { class: 'dashboard-grid' }, [chartCard, stockCard]));

  const recentCard = sectionCard({
    title: 'Transaksi terbaru',
    subtitle: 'Lima transaksi berhasil terakhir',
    action: el('button', {
      class: 'text-link',
      type: 'button',
      onClick: () => navigate('transactions')
    }, ['Lihat semua', icon('arrow-right')]),
    body: buildRecentTransactions(data.recentTransactions),
    flush: true
  });

  const bestCard = sectionCard({
    title: 'Produk terlaris',
    subtitle: 'Berdasarkan kuantitas terjual',
    action: el('button', {
      class: 'text-link',
      type: 'button',
      onClick: () => navigate('reports')
    }, ['Lihat laporan', icon('arrow-right')]),
    body: buildBestSellers(data.bestSellers),
    flush: true
  });

  wrapper.appendChild(el('div', { class: 'dashboard-grid equal' }, [recentCard, bestCard]));

  const categoryNote = categories.length
    ? `${formatNumber(categories.length)} kategori`
    : 'Belum ada kategori';
  wrapper.appendChild(el('p', {
    class: 'inline-meta',
    style: { justifyContent: 'flex-end', marginTop: '2px' },
    text: `${categoryNote} • Data dihitung langsung dari penyimpanan lokal`
  }));

  container.appendChild(wrapper);
}
