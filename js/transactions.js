/**
 * transactions.js
 * Riwayat transaksi, detail, cetak ulang, serta pembatalan transaksi yang
 * mengembalikan stok secara atomik dan hanya satu kali.
 */

import {
  PAYMENT_METHODS,
  TRX_STATUS,
  buildPagination,
  confirmDialog,
  dateKey,
  debounce,
  el,
  emitDataChanged,
  formatCurrency,
  formatDateShort,
  formatDateTimeFull,
  formatNumber,
  formatTime,
  icon,
  normalizeKey,
  openModal,
  paginate,
  toast,
  uid
} from './utils.js';
import {
  getMovements,
  getProducts,
  getTransactions,
  runAtomic,
  saveMovements,
  saveProducts,
  saveTransactions
} from './storage.js';
import {
  getTransactionCogs,
  getTransactionItemCount,
  getTransactionProfit
} from './calculations.js';
import { openReceipt } from './receipt.js';
import { navigate } from './router.js';

const DEFAULT_FILTERS = {
  search: '',
  startDate: '',
  endDate: '',
  paymentMethod: 'all',
  status: 'all',
  sort: 'newest',
  page: 1,
  pageSize: 10
};

const state = { ...DEFAULT_FILTERS };

function paymentMethodOf(transaction) {
  return PAYMENT_METHODS[transaction.paymentMethod] || {
    label: transaction.paymentMethod || 'Tidak diketahui',
    short: transaction.paymentMethod || '—',
    icon: 'wallet'
  };
}

function statusMetaOf(transaction) {
  return TRX_STATUS[transaction.status] || {
    label: transaction.status || 'Tidak diketahui',
    tone: 'neutral'
  };
}

function statusBadge(transaction) {
  const meta = statusMetaOf(transaction);
  return el('span', { class: `badge badge-${meta.tone}` }, [
    el('span', { class: 'dot' }),
    meta.label
  ]);
}

function getFilteredTransactions() {
  const search = normalizeKey(state.search);
  const rows = getTransactions()
    .filter((transaction) => {
      if (state.paymentMethod !== 'all' && transaction.paymentMethod !== state.paymentMethod) return false;
      if (state.status !== 'all' && transaction.status !== state.status) return false;

      if (state.startDate || state.endDate) {
        const key = dateKey(transaction.createdAt);
        if (!key) return false;
        if (state.startDate && key < state.startDate) return false;
        if (state.endDate && key > state.endDate) return false;
      }

      if (search) {
        const method = paymentMethodOf(transaction).label;
        const items = (transaction.items || [])
          .map((item) => `${item.name} ${item.sku || ''}`)
          .join(' ');
        const haystack = normalizeKey(`${transaction.number} ${method} ${items}`);
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

  const time = (transaction) => {
    const value = new Date(transaction.createdAt).getTime();
    return Number.isFinite(value) ? value : 0;
  };

  rows.sort((a, b) => {
    switch (state.sort) {
      case 'oldest':
        return time(a) - time(b);
      case 'total-desc':
        return (Number(b.total) || 0) - (Number(a.total) || 0);
      case 'total-asc':
        return (Number(a.total) || 0) - (Number(b.total) || 0);
      case 'newest':
      default:
        return time(b) - time(a);
    }
  });

  return rows;
}

/**
 * Membatalkan transaksi. Seluruh stok dikembalikan di dalam satu snapshot:
 * bila salah satu penulisan gagal, transaksi tetap berstatus selesai dan stok
 * tidak berubah.
 */
function cancelTransactionAtomic(transactionId) {
  const timestamp = new Date().toISOString();
  let cancelled = null;

  runAtomic(() => {
    const transactions = getTransactions();
    const index = transactions.findIndex((transaction) => transaction.id === transactionId);
    if (index < 0) {
      throw new Error('Transaksi tidak ditemukan.');
    }

    const transaction = transactions[index];
    if (transaction.status === 'cancelled') {
      throw new Error('Transaksi ini sudah dibatalkan sebelumnya.');
    }
    if (transaction.status !== 'completed') {
      throw new Error('Status transaksi tidak dapat dibatalkan.');
    }
    if (!Array.isArray(transaction.items) || transaction.items.length === 0) {
      throw new Error('Transaksi tidak memiliki item yang dapat dikembalikan.');
    }

    const products = getProducts().map((product) => ({ ...product }));
    const movements = [];
    const referenceNumber = transaction.number;

    transaction.items.forEach((item) => {
      const qty = Number(item.qty);
      if (!Number.isInteger(qty) || qty < 1) {
        throw new Error(`Jumlah item "${item.name || 'produk'}" pada transaksi tidak valid.`);
      }

      const productIndex = products.findIndex((product) => product.id === item.productId);
      if (productIndex < 0) {
        throw new Error(
          `Produk "${item.name || item.productId}" sudah tidak ada. Pembatalan dibatalkan agar stok tetap konsisten.`
        );
      }

      const product = products[productIndex];
      const stockBefore = Math.max(0, Math.floor(Number(product.stock) || 0));
      const stockAfter = stockBefore + qty;

      products[productIndex] = {
        ...product,
        stock: stockAfter,
        updatedAt: timestamp
      };

      movements.push({
        id: uid('mov'),
        productId: product.id,
        productName: product.name,
        type: 'cancel',
        change: qty,
        stockBefore,
        stockAfter,
        reason: `Pembatalan ${referenceNumber}`,
        referenceId: transaction.id,
        referenceNumber,
        createdAt: timestamp
      });
    });

    const updated = {
      ...transaction,
      status: 'cancelled',
      cancelledAt: timestamp
    };
    transactions[index] = updated;

    saveProducts(products);
    saveTransactions(transactions);
    saveMovements([...movements, ...getMovements()]);
    cancelled = updated;
  });

  if (!cancelled) {
    throw new Error('Transaksi gagal dibatalkan. Data lama telah dipulihkan.');
  }

  emitDataChanged('transactions');
  return cancelled;
}

function requestCancellation(transactionId, onSuccess) {
  const transaction = getTransactions().find((row) => row.id === transactionId);
  if (!transaction) {
    toast('Transaksi tidak ditemukan.', 'error');
    return;
  }
  if (transaction.status !== 'completed') {
    toast('Transaksi ini sudah dibatalkan.', 'info');
    return;
  }

  const itemCount = getTransactionItemCount(transaction);
  confirmDialog({
    title: 'Batalkan transaksi?',
    message: `Transaksi ${transaction.number} senilai ${formatCurrency(transaction.total)} akan ditandai sebagai dibatalkan.`,
    details: [
      `${formatNumber(itemCount)} item akan dikembalikan ke stok produk terkait.`,
      'Transaksi tetap tersimpan sebagai riwayat dengan status Dibatalkan.',
      'Omzet dan laba pada laporan akan dihitung ulang tanpa transaksi ini.'
    ],
    confirmLabel: 'Batalkan Transaksi',
    danger: true
  }).then((confirmed) => {
    if (!confirmed) return;
    try {
      const updated = cancelTransactionAtomic(transactionId);
      toast(`Transaksi ${updated.number} dibatalkan dan stok sudah dikembalikan.`, 'success');
      if (typeof onSuccess === 'function') onSuccess(updated);
    } catch (error) {
      console.error(error);
      toast(error.message || 'Transaksi gagal dibatalkan. Stok tidak diubah.', 'error');
    }
  });
}

function detailMeta(label, iconName, value) {
  return el('div', { class: 'detail-meta' }, [
    el('span', {}, [icon(iconName), label]),
    typeof value === 'string' || typeof value === 'number'
      ? el('strong', { text: String(value) })
      : el('strong', {}, value)
  ]);
}

function openTransactionDetail(transactionId, onChanged) {
  const transaction = getTransactions().find((row) => row.id === transactionId);
  if (!transaction) {
    toast('Transaksi tidak ditemukan.', 'warning');
    return;
  }

  const method = paymentMethodOf(transaction);
  const isCancelled = transaction.status === 'cancelled';
  const items = Array.isArray(transaction.items) ? transaction.items : [];
  const cogs = getTransactionCogs(transaction);
  const profit = getTransactionProfit(transaction);

  const metaGrid = el('div', { class: 'detail-meta-grid' }, [
    detailMeta('Waktu transaksi', 'calendar', formatDateTimeFull(transaction.createdAt)),
    detailMeta('Metode pembayaran', method.icon, method.label),
    detailMeta('Jumlah item', 'cart', `${formatNumber(getTransactionItemCount(transaction))} item`),
    el('div', { class: 'detail-meta' }, [
      el('span', {}, [icon('info'), 'Status']),
      el('strong', {}, statusBadge(transaction))
    ])
  ]);

  const tbody = el('tbody');
  items.forEach((item) => {
    tbody.appendChild(el('tr', {}, [
      el('td', {}, [
        el('span', { class: 'cell-main', text: item.name || 'Produk' }),
        el('span', { class: 'cell-sub', text: item.sku || 'Tanpa SKU' })
      ]),
      el('td', { class: 'num', text: formatCurrency(item.unitPrice) }),
      el('td', { class: 'num', text: formatNumber(item.qty) }),
      el('td', { class: 'num', text: formatCurrency(item.subtotal) })
    ]));
  });

  const itemsBlock = el('div', { class: 'detail-items' },
    el('div', { class: 'table-wrap' }, el('table', {
      class: 'table',
      style: { minWidth: '520px' }
    }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Produk' }),
        el('th', { class: 'num', text: 'Harga' }),
        el('th', { class: 'num', text: 'Qty' }),
        el('th', { class: 'num', text: 'Subtotal' })
      ])),
      tbody
    ]))
  );

  const totals = el('div', { class: 'detail-totals' }, [
    el('div', { class: 'detail-total-row' }, [
      el('span', { text: 'Subtotal' }),
      el('strong', { text: formatCurrency(transaction.subtotal) })
    ]),
    Number(transaction.discount) > 0
      ? el('div', { class: 'detail-total-row' }, [
        el('span', { text: 'Diskon' }),
        el('strong', { text: `- ${formatCurrency(transaction.discount)}` })
      ])
      : null,
    el('div', { class: 'detail-total-row grand' }, [
      el('span', { text: 'Total' }),
      el('strong', { text: formatCurrency(transaction.total) })
    ]),
    transaction.paymentMethod === 'cash'
      ? el('div', { class: 'detail-total-row' }, [
        el('span', { text: 'Tunai diterima' }),
        el('strong', { text: formatCurrency(transaction.cashReceived) })
      ])
      : null,
    transaction.paymentMethod === 'cash'
      ? el('div', { class: 'detail-total-row' }, [
        el('span', { text: 'Kembalian' }),
        el('strong', { text: formatCurrency(transaction.change) })
      ])
      : null
  ]);

  const profitNote = !isCancelled
    ? el('div', { class: 'form-note', style: { marginTop: '14px' } }, [
      icon('trending-up'),
      `HPP ${formatCurrency(cogs)} • Laba kotor ${formatCurrency(profit)}. Laba dihitung dari harga modal pada snapshot transaksi.`
    ])
    : null;

  const cancelledNote = isCancelled
    ? el('div', { class: 'cancel-note' }, [
      icon('alert-triangle'),
      el('div', {}, [
        el('strong', { text: 'Transaksi dibatalkan' }),
        el('p', {
          style: { margin: '3px 0 0' },
          text: `Dibatalkan pada ${formatDateTimeFull(transaction.cancelledAt) || 'waktu yang tidak tercatat'}. Stok item sudah dikembalikan dan transaksi tidak dihitung dalam laporan penjualan.`
        })
      ])
    ])
    : null;

  const content = el('div', {}, [
    metaGrid,
    itemsBlock,
    totals,
    profitNote,
    cancelledNote
  ]);

  const closeButton = el('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: 'Tutup'
  });
  const printButton = el('button', {
    class: 'btn btn-ghost',
    type: 'button'
  }, [icon('printer'), isCancelled ? 'Cetak Struk Dibatalkan' : 'Cetak Ulang']);
  const cancelButton = !isCancelled
    ? el('button', {
      class: 'btn btn-danger-soft',
      type: 'button'
    }, [icon('x-circle'), 'Batalkan Transaksi'])
    : null;

  const modal = openModal({
    title: 'Detail Transaksi',
    subtitle: `${transaction.number} • ${formatDateShort(transaction.createdAt)}`,
    content,
    footer: el('div', { class: 'modal-footer' }, [
      closeButton,
      printButton,
      cancelButton
    ]),
    size: 'lg'
  });

  closeButton.addEventListener('click', () => modal.close('close'));

  printButton.addEventListener('click', () => {
    const latest = getTransactions().find((row) => row.id === transaction.id) || transaction;
    modal.close('print');
    window.setTimeout(() => {
      openReceipt(latest, { context: 'reprint' });
    }, 170);
  });

  if (cancelButton) {
    cancelButton.addEventListener('click', () => {
      requestCancellation(transaction.id, () => {
        modal.close('cancelled');
        if (typeof onChanged === 'function') onChanged();
      });
    });
  }

  return modal;
}

function buildTable(refreshTable, clearFilters) {
  const rows = getFilteredTransactions();
  const pagination = paginate(rows, state.page, state.pageSize);
  state.page = pagination.page;

  if (!rows.length) {
    const hasAnyTransactions = getTransactions().length > 0;
    return el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-icon' }, icon(hasAnyTransactions ? 'search' : 'receipt')),
      el('h4', {
        text: hasAnyTransactions ? 'Tidak ada transaksi yang cocok' : 'Belum ada transaksi'
      }),
      el('p', {
        text: hasAnyTransactions
          ? 'Coba ubah kata kunci, rentang tanggal, metode pembayaran, atau status transaksi.'
          : 'Transaksi yang berhasil dibayar di halaman Kasir akan muncul di sini.'
      }),
      hasAnyTransactions
        ? el('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          onClick: clearFilters
        }, [icon('refresh'), 'Reset Filter'])
        : el('button', {
          class: 'btn btn-primary btn-sm',
          type: 'button',
          onClick: () => navigate('cashier')
        }, [icon('cart'), 'Buka Kasir'])
    ]);
  }

  const tbody = el('tbody');
  pagination.items.forEach((transaction) => {
    const method = paymentMethodOf(transaction);
    const itemCount = getTransactionItemCount(transaction);
    const cancelled = transaction.status === 'cancelled';

    const actions = [
      el('button', {
        class: 'icon-btn',
        type: 'button',
        title: 'Lihat detail',
        'aria-label': `Lihat detail transaksi ${transaction.number}`,
        onClick: () => openTransactionDetail(transaction.id, refreshTable)
      }, icon('eye')),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        title: cancelled ? 'Cetak struk dibatalkan' : 'Cetak ulang struk',
        'aria-label': `Cetak struk ${transaction.number}`,
        onClick: () => openReceipt(transaction, { context: 'reprint' })
      }, icon('printer'))
    ];

    if (!cancelled) {
      actions.push(el('button', {
        class: 'icon-btn danger',
        type: 'button',
        title: 'Batalkan transaksi',
        'aria-label': `Batalkan transaksi ${transaction.number}`,
        onClick: () => requestCancellation(transaction.id, refreshTable)
      }, icon('x-circle')));
    }

    tbody.appendChild(el('tr', {}, [
      el('td', {}, el('div', { class: 'transaction-number' }, [
        transaction.number,
        el('small', { text: formatTime(transaction.createdAt) })
      ])),
      el('td', {}, el('div', {}, [
        el('span', { class: 'cell-main', text: formatDateShort(transaction.createdAt) }),
        el('span', { class: 'cell-sub', text: formatTime(transaction.createdAt) })
      ])),
      el('td', { class: 'num', text: formatNumber(itemCount) }),
      el('td', { class: 'num' }, [
        el('span', { class: 'cell-main', text: formatCurrency(transaction.total) }),
        Number(transaction.discount) > 0
          ? el('span', { class: 'cell-sub', text: `Diskon ${formatCurrency(transaction.discount)}` })
          : null
      ]),
      el('td', {}, el('div', { class: 'inline-meta' }, [icon(method.icon), method.short || method.label])),
      el('td', {}, [
        statusBadge(transaction),
        cancelled && transaction.cancelledAt
          ? el('span', { class: 'cell-sub', text: formatDateShort(transaction.cancelledAt) })
          : null
      ]),
      el('td', { class: 'actions-col' }, el('div', { class: 'actions' }, actions))
    ]));
  });

  const footer = el('div', { class: 'table-footer' }, [
    el('span', {
      text: `Menampilkan ${formatNumber(pagination.start)}–${formatNumber(pagination.end)} dari ${formatNumber(pagination.total)} transaksi`
    }),
    buildPagination(pagination.totalPages, pagination.page, (page) => {
      state.page = page;
      refreshTable();
    })
  ]);

  return el('div', {}, [
    el('div', { class: 'table-wrap' }, el('table', {
      class: 'table',
      style: { minWidth: '860px' }
    }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Nomor Transaksi' }),
        el('th', { text: 'Waktu' }),
        el('th', { class: 'num', text: 'Item' }),
        el('th', { class: 'num', text: 'Total' }),
        el('th', { text: 'Pembayaran' }),
        el('th', { text: 'Status' }),
        el('th', { class: 'actions-col', text: 'Aksi' })
      ])),
      tbody
    ])),
    footer
  ]);
}

export function renderTransactionsPage(container, params = {}) {
  let tableHost = null;
  let searchInput = null;
  let startInput = null;
  let endInput = null;

  const refreshTable = () => {
    if (!tableHost) return;
    tableHost.replaceChildren(buildTable(refreshTable, clearFilters));
  };

  let debouncedSearch = null;

  const clearFilters = () => {
    Object.assign(state, DEFAULT_FILTERS);
    if (searchInput) searchInput.value = '';
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    const methodSelect = container.querySelector('#transaction-method-filter');
    const statusSelect = container.querySelector('#transaction-status-filter');
    const sortSelect = container.querySelector('#transaction-sort');
    if (methodSelect) methodSelect.value = 'all';
    if (statusSelect) statusSelect.value = 'all';
    if (sortSelect) sortSelect.value = 'newest';
    refreshTable();
  };

  const pageHead = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-head-copy' }, [
      el('h2', { text: 'Riwayat Transaksi' }),
      el('p', { text: 'Telusuri transaksi, buka detail struk, cetak ulang, atau batalkan penjualan dengan aman.' })
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        onClick: () => navigate('cashier')
      }, [icon('plus'), 'Transaksi Baru'])
    ])
  ]);

  searchInput = el('input', {
    class: 'input',
    id: 'transaction-search',
    type: 'search',
    placeholder: 'Cari nomor transaksi atau produk…',
    value: state.search,
    autocomplete: 'off',
    'aria-label': 'Cari transaksi'
  });

  debouncedSearch = debounce(() => {
    state.search = searchInput.value;
    state.page = 1;
    refreshTable();
  }, 220);

  searchInput.addEventListener('input', debouncedSearch);

  startInput = el('input', {
    class: 'input',
    id: 'transaction-start-date',
    type: 'date',
    value: state.startDate,
    'aria-label': 'Tanggal mulai transaksi'
  });
  endInput = el('input', {
    class: 'input',
    id: 'transaction-end-date',
    type: 'date',
    value: state.endDate,
    'aria-label': 'Tanggal akhir transaksi'
  });

  const handleDateChange = (which, input) => {
    const value = input.value;
    const nextStart = which === 'start' ? value : state.startDate;
    const nextEnd = which === 'end' ? value : state.endDate;

    if (nextStart && nextEnd && nextStart > nextEnd) {
      toast('Tanggal mulai tidak boleh melewati tanggal akhir.', 'warning');
      input.value = which === 'start' ? state.startDate : state.endDate;
      return;
    }

    state[which === 'start' ? 'startDate' : 'endDate'] = value;
    state.page = 1;
    refreshTable();
  };

  startInput.addEventListener('change', () => handleDateChange('start', startInput));
  endInput.addEventListener('change', () => handleDateChange('end', endInput));

  const methodSelect = el('select', {
    class: 'select',
    id: 'transaction-method-filter',
    'aria-label': 'Filter metode pembayaran'
  }, [
    el('option', { value: 'all', text: 'Semua metode', selected: state.paymentMethod === 'all' }),
    ...Object.values(PAYMENT_METHODS).map((method) => el('option', {
      value: method.id,
      text: method.label,
      selected: state.paymentMethod === method.id
    }))
  ]);
  methodSelect.addEventListener('change', () => {
    state.paymentMethod = methodSelect.value;
    state.page = 1;
    refreshTable();
  });

  const statusSelect = el('select', {
    class: 'select',
    id: 'transaction-status-filter',
    'aria-label': 'Filter status transaksi'
  }, [
    el('option', { value: 'all', text: 'Semua status', selected: state.status === 'all' }),
    el('option', { value: 'completed', text: 'Selesai', selected: state.status === 'completed' }),
    el('option', { value: 'cancelled', text: 'Dibatalkan', selected: state.status === 'cancelled' })
  ]);
  statusSelect.addEventListener('change', () => {
    state.status = statusSelect.value;
    state.page = 1;
    refreshTable();
  });

  const sortSelect = el('select', {
    class: 'select',
    id: 'transaction-sort',
    'aria-label': 'Urutkan transaksi'
  }, [
    el('option', { value: 'newest', text: 'Terbaru', selected: state.sort === 'newest' }),
    el('option', { value: 'oldest', text: 'Terlama', selected: state.sort === 'oldest' }),
    el('option', { value: 'total-desc', text: 'Total tertinggi', selected: state.sort === 'total-desc' }),
    el('option', { value: 'total-asc', text: 'Total terendah', selected: state.sort === 'total-asc' })
  ]);
  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
    state.page = 1;
    refreshTable();
  });

  const resetButton = el('button', {
    class: 'btn btn-ghost btn-sm',
    type: 'button',
    onClick: clearFilters
  }, [icon('refresh'), 'Reset']);

  const filterCard = el('div', { class: 'card' }, [
    el('div', { class: 'transaction-filters' }, [
      el('div', { class: 'filter-row' }, [
        el('div', { class: 'search-box' }, [icon('search'), searchInput]),
        el('label', { class: 'date-field' }, [
          el('span', { text: 'Dari' }),
          startInput
        ]),
        el('label', { class: 'date-field' }, [
          el('span', { text: 'Sampai' }),
          endInput
        ]),
        el('span', { class: 'filter-divider' }),
        resetButton
      ]),
      el('div', { class: 'filter-row' }, [
        methodSelect,
        statusSelect,
        sortSelect
      ])
    ]),
    tableHost = el('div')
  ]);

  container.append(pageHead, filterCard);
  refreshTable();

  if (params.openId) {
    const exists = getTransactions().some((transaction) => transaction.id === params.openId);
    if (exists) {
      window.setTimeout(() => openTransactionDetail(params.openId, refreshTable), 0);
    } else {
      toast('Transaksi yang ditautkan tidak ditemukan.', 'warning');
    }
  }
}
