/**
 * inventory.js
 * Pemantauan stok, penambahan/pengurangan stok manual, dan riwayat
 * pergerakan stok dengan pencatatan sebelum/sesudah perubahan.
 */

import {
  $,
  MOVEMENT_TYPES,
  buildPagination,
  debounce,
  el,
  formatCurrency,
  formatDateShort,
  formatDateTime,
  formatNumber,
  getInitials,
  getStockStatus,
  icon,
  normalizeKey,
  normalizeWhitespace,
  openModal,
  paginate,
  toast,
  uid
} from './utils.js';
import {
  getCategories,
  getMovements,
  getProducts,
  runAtomic,
  saveMovements,
  saveProducts
} from './storage.js';
import { navigate } from './router.js';

const state = {
  tab: 'stock',
  stockSearch: '',
  stockCategory: 'all',
  stockFilter: 'all',
  stockPage: 1,
  stockPageSize: 10,
  movementSearch: '',
  movementType: 'all',
  movementProductId: 'all',
  movementPage: 1,
  movementPageSize: 12
};

const debouncedStockSearch = debounce(() => rerender({ focus: 'stock' }), 220);
const debouncedMovementSearch = debounce(() => rerender({ focus: 'movement' }), 220);

function rerender(options = {}) {
  const container = $('#page-content');
  if (!container) return;
  renderInventoryPage(container);
  if (options.focus) {
    const input = $(options.focus === 'stock' ? '#stock-search' : '#movement-search');
    if (input) {
      input.focus({ preventScroll: true });
      const length = input.value.length;
      input.setSelectionRange(length, length);
    }
  }
}

function categoryName(categories, categoryId) {
  return categories.find((category) => category.id === categoryId)?.name || 'Tanpa Kategori';
}

function matchesStock(product, filter) {
  const status = getStockStatus(product).key;
  if (filter === 'low') return status === 'low' || status === 'out';
  if (filter === 'out') return status === 'out';
  if (filter === 'available') return status !== 'out';
  return true;
}

function field({ id, label, required = false, hint = '', control, full = false }) {
  const labelNode = el('label', { for: id }, [label]);
  if (required) labelNode.appendChild(el('span', { class: 'required', text: ' *' }));
  return el('div', { class: `field ${full ? 'full' : ''}`.trim() }, [
    labelNode,
    control,
    hint ? el('p', { class: 'field-hint', text: hint }) : null,
    el('p', { class: 'field-error' })
  ]);
}

function setFieldError(fieldNode, message) {
  fieldNode.classList.add('invalid');
  const error = fieldNode.querySelector('.field-error');
  if (error) error.textContent = message;
}

function clearErrors(form) {
  form.querySelectorAll('.field.invalid').forEach((fieldNode) => {
    fieldNode.classList.remove('invalid');
    const error = fieldNode.querySelector('.field-error');
    if (error) error.textContent = '';
  });
}

function parsePositiveInteger(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const number = Number(raw);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number <= 0) return null;
  return number;
}

function openStockModal(mode, presetProductId = null) {
  const products = getProducts().slice().sort((a, b) => a.name.localeCompare(b.name, 'id-ID'));
  if (!products.length) {
    toast('Tambahkan produk terlebih dahulu sebelum mengelola stok.', 'warning');
    navigate('products');
    return;
  }

  const isAdd = mode === 'add';
  const selectedId = presetProductId && products.some((product) => product.id === presetProductId)
    ? presetProductId
    : products[0].id;

  const productSelect = el('select', { class: 'select', id: `stock-product-${Date.now()}` },
    products.map((product) => el('option', {
      value: product.id,
      text: `${product.name}${product.active === false ? ' (nonaktif)' : ''}`,
      selected: product.id === selectedId
    }))
  );
  const quantityInput = el('input', {
    class: 'input',
    id: 'stock-quantity',
    type: 'number',
    min: '1',
    step: '1',
    inputmode: 'numeric',
    placeholder: '0',
    'data-autofocus': 'true'
  });
  const reasonInput = el('input', {
    class: 'input',
    id: 'stock-reason',
    type: 'text',
    maxlength: '140',
    value: isAdd ? 'Stok masuk' : '',
    placeholder: isAdd ? 'Contoh: Pembelian dari supplier' : 'Contoh: Barang rusak / kadaluarsa'
  });

  const stockHint = el('p', { class: 'field-hint' });
  const updateHint = () => {
    const product = getProducts().find((item) => item.id === productSelect.value);
    if (!product) {
      stockHint.textContent = 'Produk tidak ditemukan.';
      return;
    }
    stockHint.textContent = `Stok saat ini: ${formatNumber(product.stock)} unit • minimum ${formatNumber(product.minStock)} unit.`;
  };
  productSelect.addEventListener('change', updateHint);
  updateHint();

  const productField = field({
    id: productSelect.id,
    label: 'Produk',
    required: true,
    control: productSelect,
    hint: stockHint.textContent,
    full: true
  });
  // Gunakan node hint yang diperbarui agar teks dinamis tetap sinkron.
  const hintNode = productField.querySelector('.field-hint');
  if (hintNode) {
    hintNode.textContent = stockHint.textContent;
    productSelect.addEventListener('change', () => {
      stockHint.textContent = '';
      const product = getProducts().find((item) => item.id === productSelect.value);
      hintNode.textContent = product
        ? `Stok saat ini: ${formatNumber(product.stock)} unit • minimum ${formatNumber(product.minStock)} unit.`
        : 'Produk tidak ditemukan.';
    });
  }

  const quantityField = field({
    id: quantityInput.id,
    label: isAdd ? 'Jumlah Stok Masuk' : 'Jumlah Pengurangan',
    required: true,
    control: quantityInput
  });
  const reasonField = field({
    id: reasonInput.id,
    label: 'Alasan / Keterangan',
    required: !isAdd,
    control: reasonInput,
    hint: isAdd
      ? 'Opsional. Catatan ini akan muncul pada riwayat stok.'
      : 'Wajib diisi agar pengurangan stok dapat ditelusuri.',
    full: true
  });

  const formId = `stock-form-${Date.now()}`;
  const form = el('form', { class: 'form', id: formId, novalidate: true }, [
    el('div', { class: 'form-grid' }, [productField, quantityField, reasonField])
  ]);

  const note = el('div', { class: 'form-note', style: { margin: '0 20px 18px' } }, [
    icon('info'),
    isAdd
      ? 'Penambahan stok akan dicatat pada riwayat pergerakan stok.'
      : 'Stok tidak boleh menjadi negatif. Pengurangan akan dicatat sebagai penyesuaian stok.'
  ]);
  const body = el('div', {}, [form, note]);

  const cancelButton = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Batal' });
  const saveLabel = el('span', { text: isAdd ? 'Tambah Stok' : 'Kurangi Stok' });
  const saveButton = el('button', {
    class: `btn ${isAdd ? 'btn-primary' : 'btn-danger'}`,
    type: 'submit',
    form: formId
  }, [icon(isAdd ? 'plus' : 'minus'), saveLabel]);
  const footer = el('div', { class: 'modal-footer' }, [cancelButton, saveButton]);

  const modal = openModal({
    title: isAdd ? 'Tambah Stok' : 'Kurangi Stok',
    subtitle: isAdd ? 'Catat barang masuk ke persediaan' : 'Catat pengurangan stok manual',
    content: body,
    footer,
    size: 'md'
  });

  cancelButton.addEventListener('click', () => modal.close('cancel'));

  let submitting = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submitting) return;
    clearErrors(form);

    const productId = productSelect.value;
    const quantity = parsePositiveInteger(quantityInput.value);
    const reason = normalizeWhitespace(reasonInput.value);

    let firstInvalid = null;
    if (!productId) {
      setFieldError(productField, 'Pilih produk.');
      firstInvalid = firstInvalid || productSelect;
    }
    if (quantity === null) {
      setFieldError(quantityField, 'Jumlah harus bilangan bulat lebih dari 0.');
      firstInvalid = firstInvalid || quantityInput;
    }
    if (!isAdd && !reason) {
      setFieldError(reasonField, 'Alasan pengurangan stok wajib diisi.');
      firstInvalid = firstInvalid || reasonInput;
    }
    if (reason.length > 140) {
      setFieldError(reasonField, 'Alasan maksimal 140 karakter.');
      firstInvalid = firstInvalid || reasonInput;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    submitting = true;
    saveButton.disabled = true;
    saveLabel.textContent = 'Menyimpan…';

    try {
      runAtomic(() => {
        const productsNow = getProducts();
        const index = productsNow.findIndex((product) => product.id === productId);
        if (index < 0) throw new Error('Produk tidak ditemukan. Mungkin sudah dihapus.');
        const current = productsNow[index];
        const stockBefore = Number(current.stock) || 0;
        const change = isAdd ? quantity : -quantity;
        const stockAfter = stockBefore + change;
        if (stockAfter < 0) {
          throw new Error(`Stok ${current.name} hanya ${stockBefore} unit. Pengurangan tidak boleh melebihi stok.`);
        }

        const timestamp = new Date().toISOString();
        productsNow[index] = {
          ...current,
          stock: stockAfter,
          updatedAt: timestamp
        };
        const movements = getMovements();
        movements.unshift({
          id: uid('mov'),
          productId: current.id,
          productName: current.name,
          type: isAdd ? 'in' : 'adjustment',
          change,
          stockBefore,
          stockAfter,
          reason: reason || (isAdd ? 'Stok masuk' : 'Penyesuaian stok manual'),
          referenceId: null,
          referenceNumber: null,
          createdAt: timestamp
        });

        saveProducts(productsNow);
        saveMovements(movements);
      });

      modal.close('saved');
      toast(isAdd ? 'Stok berhasil ditambahkan.' : 'Stok berhasil dikurangi.', 'success');
      rerender();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Perubahan stok gagal disimpan.', 'error');
      submitting = false;
      saveButton.disabled = false;
      saveLabel.textContent = isAdd ? 'Tambah Stok' : 'Kurangi Stok';
    }
  });
}

function openProductHistory(productId) {
  const product = getProducts().find((item) => item.id === productId);
  if (!product) {
    toast('Produk tidak ditemukan.', 'error');
    return;
  }
  const status = getStockStatus(product);
  const movements = getMovements()
    .filter((movement) => movement.productId === productId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const summary = el('div', { class: 'history-summary' }, [
    el('span', { class: 'product-thumb', text: getInitials(product.name, 'P').slice(0, 2) }),
    el('div', { class: 'history-summary-copy' }, [
      el('strong', { text: product.name }),
      el('span', { text: `${product.sku} • minimum ${formatNumber(product.minStock)} unit` })
    ]),
    el('div', { class: 'history-summary-value' }, [
      el('strong', { text: formatNumber(product.stock) }),
      el('span', { text: 'unit tersedia' })
    ])
  ]);

  const content = el('div', {}, [summary]);

  if (!movements.length) {
    content.appendChild(el('div', { class: 'empty-state compact' }, [
      el('div', { class: 'empty-icon' }, icon('clock')),
      el('h4', { text: 'Belum ada pergerakan stok' }),
      el('p', { text: 'Pergerakan akan muncul setelah stok ditambah, dikurangi, atau terjual.' })
    ]));
  } else {
    const shown = movements.slice(0, 100);
    const tbody = el('tbody');
    shown.forEach((movement) => {
      const type = MOVEMENT_TYPES[movement.type] || { label: movement.type, tone: 'neutral' };
      tbody.appendChild(el('tr', {}, [
        el('td', { class: 'nowrap' }, el('span', { class: 'cell-main', text: formatDateTime(movement.createdAt) })),
        el('td', {}, el('span', { class: `badge badge-${type.tone}`, text: type.label })),
        el('td', { class: 'num' }, el('span', {
          class: `movement-amount ${movement.change >= 0 ? 'positive' : 'negative'}`,
          text: `${movement.change >= 0 ? '+' : ''}${formatNumber(movement.change)}`
        })),
        el('td', { class: 'nowrap' }, el('span', {
          class: 'stock-flow',
          text: `${formatNumber(movement.stockBefore)} → ${formatNumber(movement.stockAfter)}`
        })),
        el('td', {}, el('span', { class: 'cell-sub', text: movement.reason || '—' }))
      ]));
    });
    content.appendChild(el('div', { class: 'detail-items' }, el('div', { class: 'table-wrap' }, el('table', { class: 'table' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Waktu' }),
        el('th', { text: 'Jenis' }),
        el('th', { class: 'num', text: 'Perubahan' }),
        el('th', { text: 'Stok' }),
        el('th', { text: 'Keterangan' })
      ])),
      tbody
    ]))));
    if (movements.length > shown.length) {
      content.appendChild(el('p', { class: 'inline-meta', style: { marginTop: '10px' }, text: `Menampilkan 100 pergerakan terbaru dari ${formatNumber(movements.length)}.` }));
    }
  }

  content.appendChild(el('div', { class: 'form-note', style: { marginTop: '14px' } }, [
    icon('info'),
    `Status stok saat ini: ${status.label.toLowerCase()}. Stok tidak dapat menjadi negatif.`
  ]));

  const closeButton = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Tutup' });
  const footer = el('div', { class: 'modal-footer' }, [closeButton]);
  const modal = openModal({
    title: 'Riwayat Stok',
    subtitle: product.name,
    content,
    footer,
    size: 'lg'
  });
  closeButton.addEventListener('click', () => modal.close('close'));
}

function buildSummary(products) {
  const active = products.filter((product) => product.active !== false);
  const low = active.filter((product) => getStockStatus(product).key === 'low').length;
  const out = active.filter((product) => getStockStatus(product).key === 'out').length;
  const totalUnits = active.reduce((sum, product) => sum + (Number(product.stock) || 0), 0);
  const stockValue = active.reduce((sum, product) => sum + (Number(product.stock) || 0) * (Number(product.costPrice) || 0), 0);

  const card = (label, value, iconName, color, foot) => el('div', { class: 'stat-card' }, [
    el('div', { class: 'stat-top' }, [
      el('span', { class: 'stat-label', text: label }),
      el('span', { class: `stat-icon ${color}` }, icon(iconName))
    ]),
    el('div', { class: 'stat-value', text: value }),
    foot ? el('div', { class: 'stat-foot', text: foot }) : null
  ]);

  return el('div', { class: 'stats-grid' }, [
    card('Produk aktif', formatNumber(active.length), 'package', 'blue', `${formatNumber(products.length)} produk terdaftar`),
    card('Stok menipis', formatNumber(low), 'alert-triangle', 'amber', low ? 'Perlu segera ditambah' : 'Tidak ada'),
    card('Stok habis', formatNumber(out), 'x-circle', 'red', out ? 'Segera lakukan restock' : 'Tidak ada'),
    card('Total unit stok', formatNumber(totalUnits), 'layers', 'green', 'Dari produk aktif'),
    card('Nilai stok (modal)', formatCurrency(stockValue), 'coins', 'purple', 'Estimasi berdasarkan harga modal')
  ]);
}

function buildStockToolbar(categories) {
  const searchInput = el('input', {
    class: 'input',
    id: 'stock-search',
    type: 'search',
    placeholder: 'Cari nama atau SKU…',
    value: state.stockSearch,
    autocomplete: 'off'
  });
  searchInput.addEventListener('input', (event) => {
    state.stockSearch = event.target.value;
    state.stockPage = 1;
    debouncedStockSearch();
  });

  const categorySelect = el('select', { class: 'select select-sm', 'aria-label': 'Filter kategori' }, [
    el('option', { value: 'all', text: 'Semua kategori', selected: state.stockCategory === 'all' }),
    ...categories.map((category) => el('option', {
      value: category.id,
      text: category.name,
      selected: state.stockCategory === category.id
    }))
  ]);
  categorySelect.addEventListener('change', (event) => {
    state.stockCategory = event.target.value;
    state.stockPage = 1;
    rerender();
  });

  const statusSelect = el('select', { class: 'select select-sm', 'aria-label': 'Filter status stok' }, [
    el('option', { value: 'all', text: 'Semua stok', selected: state.stockFilter === 'all' }),
    el('option', { value: 'low', text: 'Menipis / habis', selected: state.stockFilter === 'low' }),
    el('option', { value: 'out', text: 'Stok habis', selected: state.stockFilter === 'out' }),
    el('option', { value: 'available', text: 'Stok tersedia', selected: state.stockFilter === 'available' })
  ]);
  statusSelect.addEventListener('change', (event) => {
    state.stockFilter = event.target.value;
    state.stockPage = 1;
    rerender();
  });

  const hasFilter = state.stockSearch || state.stockCategory !== 'all' || state.stockFilter !== 'all';
  const toolbar = el('div', { class: 'filter-bar' }, [
    el('div', { class: 'search-box' }, [icon('search'), searchInput]),
    categorySelect,
    statusSelect
  ]);
  if (hasFilter) {
    toolbar.appendChild(el('button', {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      onClick: () => {
        state.stockSearch = '';
        state.stockCategory = 'all';
        state.stockFilter = 'all';
        state.stockPage = 1;
        rerender();
      }
    }, [icon('rotate-ccw'), 'Reset']));
  }
  return toolbar;
}

function buildStockTab(products, categories) {
  const search = normalizeKey(state.stockSearch);
  const filtered = products
    .filter((product) => {
      if (search) {
        const haystack = `${product.name} ${product.sku}`.toLocaleLowerCase('id-ID');
        if (!haystack.includes(search)) return false;
      }
      if (state.stockCategory !== 'all' && product.categoryId !== state.stockCategory) return false;
      if (!matchesStock(product, state.stockFilter)) return false;
      return true;
    })
    .sort((a, b) => {
      const stockA = Number(a.stock) || 0;
      const stockB = Number(b.stock) || 0;
      if (stockA !== stockB) return stockA - stockB;
      return a.name.localeCompare(b.name, 'id-ID');
    });

  const pagination = paginate(filtered, state.stockPage, state.stockPageSize);
  state.stockPage = pagination.page;

  const fragment = el('div', {}, [buildStockToolbar(categories)]);

  if (!pagination.items.length) {
    const noProductsAtAll = products.length === 0;
    const hasFilter = state.stockSearch || state.stockCategory !== 'all' || state.stockFilter !== 'all';
    fragment.appendChild(el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-icon' }, icon(noProductsAtAll ? 'package' : 'search')),
      el('h4', { text: noProductsAtAll ? 'Belum ada produk' : 'Produk tidak ditemukan' }),
      el('p', {
        text: noProductsAtAll
          ? 'Tambahkan produk terlebih dahulu untuk mulai memantau persediaan.'
          : 'Tidak ada produk yang cocok dengan pencarian atau filter stok saat ini.'
      }),
      hasFilter
        ? el('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          onClick: () => {
            state.stockSearch = '';
            state.stockCategory = 'all';
            state.stockFilter = 'all';
            state.stockPage = 1;
            rerender();
          }
        }, [icon('rotate-ccw'), 'Reset Filter'])
        : null
    ]));
    return fragment;
  }

  fragment.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'table', style: { minWidth: '880px' } }, [
    el('thead', {}, el('tr', {}, [
      el('th', { text: 'Produk' }),
      el('th', { text: 'Kategori' }),
      el('th', { text: 'Stok' }),
      el('th', { text: 'Minimum' }),
      el('th', { text: 'Status' }),
      el('th', { text: 'Nilai Modal' }),
      el('th', { class: 'actions-col', text: 'Aksi' })
    ])),
    el('tbody', {}, pagination.items.map((product) => {
      const stock = getStockStatus(product);
      return el('tr', {}, [
        el('td', {}, el('div', { class: 'product-name-cell' }, [
          el('span', { class: 'product-thumb', text: getInitials(product.name, 'P').slice(0, 2) }),
          el('div', {}, [
            el('span', { class: 'cell-main', text: product.name }),
            el('span', { class: 'cell-sub', text: product.active === false ? `${product.sku} • Nonaktif` : product.sku })
          ])
        ])),
        el('td', {}, el('span', { class: 'badge badge-neutral', text: categoryName(categories, product.categoryId) })),
        el('td', {}, el('div', { class: 'stock-cell' }, [
          el('strong', { text: formatNumber(product.stock) }),
          el('small', { text: 'unit' })
        ])),
        el('td', {}, el('span', { class: 'cell-sub', text: `${formatNumber(product.minStock)} unit` })),
        el('td', {}, el('span', { class: `badge badge-${stock.tone}`, text: stock.label })),
        el('td', { class: 'num' }, el('span', { class: 'cell-main', text: formatCurrency((Number(product.stock) || 0) * (Number(product.costPrice) || 0)) })),
        el('td', { class: 'actions-col' }, el('div', { class: 'actions' }, [
          el('button', {
            class: 'icon-btn',
            type: 'button',
            title: 'Tambah stok',
            'aria-label': `Tambah stok ${product.name}`,
            onClick: () => openStockModal('add', product.id)
          }, icon('plus')),
          el('button', {
            class: 'icon-btn danger',
            type: 'button',
            title: 'Kurangi stok',
            'aria-label': `Kurangi stok ${product.name}`,
            onClick: () => openStockModal('reduce', product.id)
          }, icon('minus')),
          el('button', {
            class: 'icon-btn',
            type: 'button',
            title: 'Riwayat stok',
            'aria-label': `Riwayat stok ${product.name}`,
            onClick: () => openProductHistory(product.id)
          }, icon('clock'))
        ]))
      ]);
    }))
  ])));

  fragment.appendChild(el('div', { class: 'table-footer' }, [
    el('span', {
      text: `Menampilkan ${formatNumber(pagination.start)}–${formatNumber(pagination.end)} dari ${formatNumber(pagination.total)} produk`
    }),
    buildPagination(pagination.totalPages, pagination.page, (page) => {
      state.stockPage = page;
      rerender();
    })
  ]));

  return fragment;
}

function buildMovementToolbar(products) {
  const searchInput = el('input', {
    class: 'input',
    id: 'movement-search',
    type: 'search',
    placeholder: 'Cari produk, alasan, atau nomor transaksi…',
    value: state.movementSearch,
    autocomplete: 'off'
  });
  searchInput.addEventListener('input', (event) => {
    state.movementSearch = event.target.value;
    state.movementPage = 1;
    debouncedMovementSearch();
  });

  const typeSelect = el('select', { class: 'select select-sm', 'aria-label': 'Filter jenis pergerakan' }, [
    el('option', { value: 'all', text: 'Semua jenis', selected: state.movementType === 'all' }),
    ...Object.entries(MOVEMENT_TYPES).map(([key, type]) => el('option', {
      value: key,
      text: type.label,
      selected: state.movementType === key
    }))
  ]);
  typeSelect.addEventListener('change', (event) => {
    state.movementType = event.target.value;
    state.movementPage = 1;
    rerender();
  });

  const sortedProducts = products.slice().sort((a, b) => a.name.localeCompare(b.name, 'id-ID'));
  const productSelect = el('select', { class: 'select select-sm', 'aria-label': 'Filter produk' }, [
    el('option', { value: 'all', text: 'Semua produk', selected: state.movementProductId === 'all' }),
    ...sortedProducts.map((product) => el('option', {
      value: product.id,
      text: product.name,
      selected: state.movementProductId === product.id
    }))
  ]);
  productSelect.addEventListener('change', (event) => {
    state.movementProductId = event.target.value;
    state.movementPage = 1;
    rerender();
  });

  const hasFilter = state.movementSearch || state.movementType !== 'all' || state.movementProductId !== 'all';
  const toolbar = el('div', { class: 'filter-bar' }, [
    el('div', { class: 'search-box' }, [icon('search'), searchInput]),
    typeSelect,
    productSelect
  ]);
  if (hasFilter) {
    toolbar.appendChild(el('button', {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      onClick: () => {
        state.movementSearch = '';
        state.movementType = 'all';
        state.movementProductId = 'all';
        state.movementPage = 1;
        rerender();
      }
    }, [icon('rotate-ccw'), 'Reset']));
  }
  return toolbar;
}

function buildMovementTab(products) {
  const search = normalizeKey(state.movementSearch);
  const filtered = getMovements()
    .filter((movement) => {
      if (state.movementType !== 'all' && movement.type !== state.movementType) return false;
      if (state.movementProductId !== 'all' && movement.productId !== state.movementProductId) return false;
      if (search) {
        const haystack = `${movement.productName} ${movement.reason} ${movement.referenceNumber || ''}`.toLocaleLowerCase('id-ID');
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const pagination = paginate(filtered, state.movementPage, state.movementPageSize);
  state.movementPage = pagination.page;

  const tbody = el('tbody');
  pagination.items.forEach((movement) => {
    const type = MOVEMENT_TYPES[movement.type] || { label: movement.type, tone: 'neutral' };
    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'nowrap' }, el('span', { class: 'cell-main', text: formatDateTime(movement.createdAt) })),
      el('td', {}, [
        el('span', { class: 'cell-main', text: movement.productName }),
        el('span', { class: 'cell-sub', text: movement.referenceNumber || 'Tanpa referensi' })
      ]),
      el('td', {}, el('span', { class: `badge badge-${type.tone}`, text: type.label })),
      el('td', { class: 'num' }, el('span', {
        class: `movement-amount ${movement.change >= 0 ? 'positive' : 'negative'}`,
        text: `${movement.change >= 0 ? '+' : ''}${formatNumber(movement.change)}`
      })),
      el('td', { class: 'nowrap' }, el('span', {
        class: 'stock-flow',
        text: `${formatNumber(movement.stockBefore)} → ${formatNumber(movement.stockAfter)}`
      })),
      el('td', {}, el('span', { class: 'cell-sub', text: movement.reason || '—' }))
    ]));
  });

  const fragment = el('div', {}, [
    buildMovementToolbar(products),
    pagination.items.length
      ? el('div', { class: 'table-wrap' }, el('table', { class: 'table', style: { minWidth: '840px' } }, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Waktu' }),
          el('th', { text: 'Produk' }),
          el('th', { text: 'Jenis' }),
          el('th', { class: 'num', text: 'Perubahan' }),
          el('th', { text: 'Stok' }),
          el('th', { text: 'Keterangan' })
        ])),
        tbody
      ]))
      : el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-icon' }, icon('clock')),
        el('h4', { text: 'Belum ada pergerakan stok' }),
        el('p', { text: 'Riwayat akan muncul setelah ada stok awal, penjualan, atau penyesuaian stok.' })
      ]),
    pagination.total > 0
      ? el('div', { class: 'table-footer' }, [
        el('span', {
          text: `Menampilkan ${formatNumber(pagination.start)}–${formatNumber(pagination.end)} dari ${formatNumber(pagination.total)} pergerakan`
        }),
        buildPagination(pagination.totalPages, pagination.page, (page) => {
          state.movementPage = page;
          rerender();
        })
      ])
      : null
  ]);

  return fragment;
}

export function renderInventoryPage(container, params = {}) {
  const products = getProducts();
  const categories = getCategories();

  if (params.stockFilter) {
    state.tab = 'stock';
    state.stockFilter = ['low', 'out', 'available', 'all'].includes(params.stockFilter) ? params.stockFilter : 'all';
    state.stockPage = 1;
  }
  if (params.productId) {
    const exists = products.some((product) => product.id === params.productId);
    if (exists) {
      state.tab = 'movements';
      state.movementProductId = params.productId;
      state.movementPage = 1;
    }
  }

  if (state.stockCategory !== 'all' && !categories.some((category) => category.id === state.stockCategory)) {
    state.stockCategory = 'all';
  }
  if (state.movementProductId !== 'all' && !products.some((product) => product.id === state.movementProductId)) {
    state.movementProductId = 'all';
  }

  const pageHead = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-head-copy' }, [
      el('h2', { text: 'Persediaan Barang' }),
      el('p', { text: 'Pantau stok, catat barang masuk, dan telusuri setiap penyesuaian stok.' })
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', {
        class: 'btn btn-secondary',
        type: 'button',
        disabled: products.length === 0,
        onClick: () => openStockModal('reduce')
      }, [icon('minus'), 'Kurangi Stok']),
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        disabled: products.length === 0,
        onClick: () => openStockModal('add')
      }, [icon('plus'), 'Tambah Stok'])
    ])
  ]);

  container.appendChild(pageHead);
  container.appendChild(buildSummary(products));

  const tabs = el('div', { class: 'tabs' }, [
    el('button', {
      class: `tab-btn ${state.tab === 'stock' ? 'active' : ''}`.trim(),
      type: 'button',
      onClick: () => {
        state.tab = 'stock';
        rerender();
      }
    }, [icon('layers'), 'Stok Produk']),
    el('button', {
      class: `tab-btn ${state.tab === 'movements' ? 'active' : ''}`.trim(),
      type: 'button',
      onClick: () => {
        state.tab = 'movements';
        rerender();
      }
    }, [icon('clock'), 'Riwayat Pergerakan'])
  ]);

  const body = state.tab === 'stock'
    ? buildStockTab(products, categories)
    : buildMovementTab(products);

  container.appendChild(el('section', { class: 'card' }, [tabs, body]));
}
