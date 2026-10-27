/**
 * reports.js
 * Laporan penjualan per periode: ringkasan omzet, diskon, HPP, laba kotor,
 * komposisi pembayaran, rekap harian, produk terlaris, dan ekspor CSV.
 */

import {
  PAYMENT_METHODS,
  addDays,
  dateKey,
  diffInDays,
  downloadCsv,
  el,
  formatCurrency,
  formatDateLong,
  formatNumber,
  formatPercent,
  icon,
  parseDateKey,
  toast
} from './utils.js';
import {
  getTransactions
} from './storage.js';
import {
  buildReport,
  getPaymentBreakdown,
  getTransactionsInRange
} from './calculations.js';

const MAX_RANGE_DAYS = 366;

const state = {
  preset: '7d',
  customStart: '',
  customEnd: ''
};

const PRESETS = [
  { id: 'today', label: 'Hari ini' },
  { id: '7d', label: '7 hari terakhir' },
  { id: '30d', label: '30 hari terakhir' },
  { id: 'this-month', label: 'Bulan ini' },
  { id: 'last-month', label: 'Bulan lalu' },
  { id: 'custom', label: 'Kustom' }
];

function presetRange(preset, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endKey = dateKey(today);

  switch (preset) {
    case 'today':
      return { startKey: endKey, endKey };
    case '30d':
      return { startKey: dateKey(addDays(today, -29)), endKey };
    case 'this-month':
      return {
        startKey: dateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
        endKey
      };
    case 'last-month':
      return {
        startKey: dateKey(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        endKey: dateKey(new Date(today.getFullYear(), today.getMonth(), 0))
      };
    case '7d':
    default:
      return { startKey: dateKey(addDays(today, -6)), endKey };
  }
}

function resolveRange() {
  if (state.preset === 'custom' && state.customStart && state.customEnd) {
    return { startKey: state.customStart, endKey: state.customEnd };
  }
  return presetRange(state.preset);
}

function periodText(startKey, endKey) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end) return 'Periode tidak valid';
  if (startKey === endKey) return formatDateLong(start);
  return `${formatDateLong(start)} – ${formatDateLong(end)}`;
}

function sectionCard({ title, subtitle, action = null, body, flush = false }) {
  const card = el('section', { class: 'card' });
  const head = el('div', { class: 'section-head' }, [
    el('div', { class: 'section-head-copy' }, [
      el('h3', { text: title }),
      subtitle ? el('p', { text: subtitle }) : null
    ])
  ]);
  if (action) head.appendChild(el('div', { class: 'section-head-actions' }, action));
  card.appendChild(head);
  if (flush) card.appendChild(body);
  else card.appendChild(el('div', { class: 'card-body' }, body));
  return card;
}

function buildSummaryCards(report, cancelledCount) {
  const average = report.summary.transactionCount
    ? report.summary.revenue / report.summary.transactionCount
    : 0;

  const card = (label, value, iconName, foot) => el('div', { class: 'report-summary-card' }, [
    el('span', {}, [icon(iconName), label]),
    el('strong', { text: value }),
    el('small', { text: foot })
  ]);

  return el('div', { class: 'report-summary-grid' }, [
    card(
      'Omzet penjualan',
      formatCurrency(report.summary.revenue),
      'coins',
      report.summary.transactionCount ? `Rata-rata ${formatCurrency(average)}` : 'Belum ada omzet'
    ),
    card(
      'Transaksi selesai',
      formatNumber(report.summary.transactionCount),
      'receipt',
      cancelledCount
        ? `${formatNumber(cancelledCount)} dibatalkan, tidak dihitung`
        : 'Tidak ada transaksi dibatalkan'
    ),
    card(
      'Item terjual',
      formatNumber(report.summary.itemCount),
      'shopping-bag',
      'Jumlah unit pada transaksi selesai'
    ),
    card(
      'Total diskon',
      formatCurrency(report.summary.discountTotal),
      'percent',
      'Potongan yang diberikan ke pelanggan'
    ),
    card(
      'Laba kotor',
      formatCurrency(report.summary.grossProfit),
      'trending-up',
      `HPP ${formatCurrency(report.summary.cogs)} • belum termasuk biaya operasional`
    )
  ]);
}

function buildPaymentBreakdown(report) {
  const { breakdown, totalRevenue } = getPaymentBreakdown(report.transactions);
  const body = el('div', { class: 'payment-breakdown' });

  breakdown.forEach((row) => {
    const method = PAYMENT_METHODS[row.method] || {
      label: row.method,
      icon: 'wallet'
    };
    const progress = el('div', {
      class: 'progress-track',
      role: 'progressbar',
      'aria-label': `Porsi omzet ${method.label}`,
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(Math.round(row.share))
    }, el('div', {
      class: 'progress-bar',
      style: { width: `${Math.max(0, Math.min(100, row.share))}%` }
    }));

    body.appendChild(el('div', { class: 'payment-row' }, [
      el('div', { class: 'payment-row-head' }, [
        el('span', { class: 'payment-row-label' }, [icon(method.icon), method.label]),
        el('span', { class: 'payment-row-value' }, [
          el('strong', { text: formatCurrency(row.revenue) }),
          el('span', { text: `${formatNumber(row.count)} transaksi • ${formatPercent(row.share)}` })
        ])
      ]),
      progress
    ]));
  });

  if (!totalRevenue) {
    body.appendChild(el('p', {
      class: 'report-empty-note',
      text: 'Belum ada penerimaan pada periode ini.'
    }));
  } else {
    body.appendChild(el('div', {
      class: 'summary-row',
      style: { borderTop: '1px solid var(--gray-200)', marginTop: '2px', paddingTop: '11px' }
    }, [
      el('span', { text: 'Total penerimaan' }),
      el('strong', { text: formatCurrency(totalRevenue) })
    ]));
  }

  return sectionCard({
    title: 'Metode pembayaran',
    subtitle: 'Komposisi omzet berdasarkan metode pembayaran',
    body
  });
}

function buildDailyTable(report) {
  const tbody = el('tbody');
  report.dailyRows.forEach((row) => {
    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'nowrap', text: row.label }),
      el('td', { class: 'num', text: formatNumber(row.transactions) }),
      el('td', { class: 'num', text: formatNumber(row.items) }),
      el('td', { class: 'num', text: formatCurrency(row.revenue) }),
      el('td', { class: 'num', text: formatCurrency(row.discount) }),
      el('td', { class: 'num', text: formatCurrency(row.cogs) }),
      el('td', { class: 'num', text: formatCurrency(row.grossProfit) })
    ]));
  });

  const tfoot = el('tfoot', {}, el('tr', {}, [
    el('td', { text: 'Total periode' }),
    el('td', { class: 'num', text: formatNumber(report.summary.transactionCount) }),
    el('td', { class: 'num', text: formatNumber(report.summary.itemCount) }),
    el('td', { class: 'num', text: formatCurrency(report.summary.revenue) }),
    el('td', { class: 'num', text: formatCurrency(report.summary.discountTotal) }),
    el('td', { class: 'num', text: formatCurrency(report.summary.cogs) }),
    el('td', { class: 'num', text: formatCurrency(report.summary.grossProfit) })
  ]));

  const table = el('div', { class: 'table-wrap' }, el('table', {
    class: 'table',
    style: { minWidth: '760px' }
  }, [
    el('thead', {}, el('tr', {}, [
      el('th', { text: 'Tanggal' }),
      el('th', { class: 'num', text: 'Transaksi' }),
      el('th', { class: 'num', text: 'Item' }),
      el('th', { class: 'num', text: 'Omzet' }),
      el('th', { class: 'num', text: 'Diskon' }),
      el('th', { class: 'num', text: 'HPP' }),
      el('th', { class: 'num', text: 'Laba Kotor' })
    ])),
    tbody,
    tfoot
  ]));

  return sectionCard({
    title: 'Rekap harian',
    subtitle: 'Omzet setelah diskon dan laba kotor berdasarkan snapshot HPP',
    action: el('span', { class: 'badge badge-info', text: `${formatNumber(report.dailyRows.length)} hari` }),
    body: table,
    flush: true
  });
}

function buildTopProducts(report) {
  if (!report.topProducts.length) {
    return sectionCard({
      title: 'Produk terlaris',
      subtitle: 'Berdasarkan jumlah unit terjual pada periode ini',
      body: el('div', { class: 'empty-state compact' }, [
        el('div', { class: 'empty-icon' }, icon('package')),
        el('h4', { text: 'Belum ada produk terjual' }),
        el('p', { text: 'Produk terlaris akan muncul setelah ada transaksi selesai pada periode ini.' })
      ]),
      flush: true
    });
  }

  const tbody = el('tbody');
  report.topProducts.forEach((product, index) => {
    tbody.appendChild(el('tr', {}, [
      el('td', {}, el('div', { class: 'top-product-cell' }, [
        el('span', { class: `rank-badge ${index === 0 ? 'top' : ''}`.trim(), text: String(index + 1) }),
        el('div', {}, [
          el('span', { class: 'cell-main', text: product.name }),
          el('span', { class: 'cell-sub', text: product.sku || 'Tanpa SKU' })
        ])
      ])),
      el('td', { class: 'num', text: formatNumber(product.qty) }),
      el('td', { class: 'num', text: formatCurrency(product.revenue) }),
      el('td', { class: 'num', text: formatCurrency(product.cogs) }),
      el('td', { class: 'num', text: formatCurrency(product.profit) })
    ]));
  });

  return sectionCard({
    title: 'Produk terlaris',
    subtitle: 'Laba produk dihitung sebelum alokasi diskon tingkat transaksi',
    action: el('span', { class: 'badge badge-neutral', text: '10 teratas' }),
    body: el('div', { class: 'table-wrap report-table' }, el('table', {
      class: 'table',
      style: { minWidth: '680px' }
    }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Produk' }),
        el('th', { class: 'num', text: 'Qty Terjual' }),
        el('th', { class: 'num', text: 'Omzet Item' }),
        el('th', { class: 'num', text: 'HPP Item' }),
        el('th', { class: 'num', text: 'Laba Kotor Item' })
      ])),
      tbody
    ])),
    flush: true
  });
}

function exportDailyCsv(report, startKey, endKey) {
  const rows = [
    ['Tanggal', 'Transaksi', 'Item Terjual', 'Omzet', 'Diskon', 'HPP', 'Laba Kotor'],
    ...report.dailyRows.map((row) => [
      row.key,
      row.transactions,
      row.items,
      row.revenue,
      row.discount,
      row.cogs,
      row.grossProfit
    ])
  ];

  const filename = `laporan-usahapos-${startKey.replace(/-/g, '')}-${endKey.replace(/-/g, '')}.csv`;
  downloadCsv(filename, rows);
  toast('File CSV laporan dibuat dan diunduh melalui browser Anda.', 'success', 'Ekspor CSV');
}

function buildFilterCard(range, rerender) {
  const applyButton = el('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button'
  }, [icon('filter'), 'Terapkan']);

  const startInput = el('input', {
    class: 'input',
    id: 'report-start-date',
    type: 'date',
    value: range.startKey,
    'aria-label': 'Tanggal mulai laporan'
  });
  const endInput = el('input', {
    class: 'input',
    id: 'report-end-date',
    type: 'date',
    value: range.endKey,
    'aria-label': 'Tanggal akhir laporan'
  });

  applyButton.addEventListener('click', () => {
    const startKey = startInput.value;
    const endKey = endInput.value;
    if (!startKey || !endKey) {
      toast('Isi tanggal mulai dan tanggal akhir laporan.', 'warning');
      return;
    }
    if (startKey > endKey) {
      toast('Tanggal mulai tidak boleh melewati tanggal akhir.', 'warning');
      return;
    }

    const start = parseDateKey(startKey);
    const end = parseDateKey(endKey);
    if (!start || !end) {
      toast('Format tanggal laporan tidak valid.', 'error');
      return;
    }
    if (diffInDays(start, end) + 1 > MAX_RANGE_DAYS) {
      toast(`Rentang laporan maksimal ${MAX_RANGE_DAYS} hari. Pilih periode yang lebih singkat.`, 'warning');
      return;
    }

    state.preset = 'custom';
    state.customStart = startKey;
    state.customEnd = endKey;
    rerender();
  });

  const chips = el('div', { class: 'preset-chips' });
  PRESETS.forEach((preset) => {
    const chip = el('button', {
      class: `preset-chip ${state.preset === preset.id ? 'active' : ''}`.trim(),
      type: 'button',
      'aria-pressed': state.preset === preset.id ? 'true' : 'false',
      text: preset.label
    });
    chip.addEventListener('click', () => {
      if (preset.id === 'custom') {
        state.customStart = range.startKey;
        state.customEnd = range.endKey;
      }
      state.preset = preset.id;
      rerender();
    });
    chips.appendChild(chip);
  });

  return el('div', { class: 'card report-filter-card' }, [
    chips,
    el('span', { class: 'filter-divider' }),
    el('div', { class: 'custom-range' }, [
      el('label', { class: 'date-field' }, [
        el('span', { text: 'Dari' }),
        startInput
      ]),
      el('label', { class: 'date-field' }, [
        el('span', { text: 'Sampai' }),
        endInput
      ]),
      applyButton
    ]),
    el('div', {
      class: 'period-label',
      style: { flexBasis: '100%', whiteSpace: 'normal', marginTop: '2px' }
    }, [
      icon('calendar'),
      `Periode laporan: ${periodText(range.startKey, range.endKey)}`
    ])
  ]);
}

export function renderReportsPage(container) {
  container.replaceChildren();

  const range = resolveRange();
  const transactions = getTransactions();
  const report = buildReport(transactions, range.startKey, range.endKey);
  const periodTransactions = getTransactionsInRange(
    transactions,
    range.startKey,
    range.endKey,
    { includeCancelled: true }
  );
  const cancelledCount = periodTransactions.filter((transaction) => transaction.status === 'cancelled').length;

  const rerender = () => renderReportsPage(container);

  const exportButton = el('button', {
    class: 'btn btn-secondary',
    type: 'button',
    onClick: () => exportDailyCsv(report, range.startKey, range.endKey)
  }, [icon('download'), 'Ekspor CSV']);

  const pageHead = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-head-copy' }, [
      el('h2', { text: 'Laporan Penjualan' }),
      el('p', { text: 'Pantau omzet, laba kotor, metode pembayaran, dan produk terlaris untuk periode yang dipilih.' })
    ]),
    el('div', { class: 'page-head-actions' }, [exportButton])
  ]);

  const filterCard = buildFilterCard(range, rerender);
  const summaryCards = buildSummaryCards(report, cancelledCount);

  const reportGrid = el('div', { class: 'report-grid' }, [
    buildDailyTable(report),
    buildPaymentBreakdown(report)
  ]);

  container.append(
    pageHead,
    filterCard,
    summaryCards,
    reportGrid,
    buildTopProducts(report)
  );
}
