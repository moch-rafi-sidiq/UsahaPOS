/**
 * products.js
 * Manajemen produk: daftar, pencarian, filter, formulir CRUD, detail,
 * aktivasi/nonaktivasi, dan aturan penghapusan yang menjaga riwayat.
 */

import {
  $,
  buildPagination,
  confirmDialog,
  debounce,
  el,
  formatCurrency,
  formatDateShort,
  formatDateTime,
  formatNumber,
  formatPercent,
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
  getSettings,
  getTransactions,
  runAtomic,
  saveMovements,
  saveProducts
} from './storage.js';
import { navigate } from './router.js';

const state = {
  search: '',
  categoryId: 'all',
  stockFilter: 'all',
  statusFilter: 'all',
  sort: 'name-asc',
  page: 1,
  pageSize: 8
};

let initialized = false;

const debouncedSearch = debounce(() => {
  rerender({ focusSearch: true });
}, 220);

function rerender(options = {}) {
  const container = $('#page-content');
  if (!container) return;
  renderProductsPage(container, {});
  if (options.focusSearch) {
    const input = $('#product-search');
    if (input) {
      input.focus({ preventScroll: true });
      const length = input.value.length;
      input.setSelectionRange(length, length);
    }
  }
}

function setPage(page) {
  state.page = page;
  rerender();
  const card = $('#products-table-card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function categoryName(categories, categoryId) {
  return categories.find((category) => category.id === categoryId)?.name || 'Tanpa Kategori';
}

function matchesStockFilter(product, filter) {
  const status = getStockStatus(product).key;
  if (filter === 'available') return status !== 'out';
  if (filter === 'low') return status === 'low' || status === 'out';
  if (filter === 'out') return status === 'out';
  return true;
}

function getFilteredProducts(products, categories) {
  const search = normalizeKey(state.search);
  return products
    .filter((product) => {
      if (search) {
        const haystack = `${product.name} ${product.sku}`.toLocaleLowerCase('id-ID');
        if (!haystack.includes(search)) return false;
      }
      if (state.categoryId !== 'all' && product.categoryId !== state.categoryId) return false;
      if (!matchesStockFilter(product, state.stockFilter)) return false;
      if (state.statusFilter === 'active' && product.active === false) return false;
      if (state.statusFilter === 'inactive' && product.active !== false) return false;
      return true;
    })
    .sort((a, b) => {
      switch (state.sort) {
        case 'name-desc':
          return b.name.localeCompare(a.name, 'id-ID');
        case 'price-asc':
          return Number(a.sellPrice) - Number(b.sellPrice);
        case 'price-desc':
          return Number(b.sellPrice) - Number(a.sellPrice);
        case 'stock-asc':
          return Number(a.stock) - Number(b.stock);
        case 'stock-desc':
          return Number(b.stock) - Number(a.stock);
        case 'newest':
          return new Date(b.createdAt) - new Date(a.createdAt);
        case 'oldest':
          return new Date(a.createdAt) - new Date(b.createdAt);
        case 'name-asc':
        default:
          return a.name.localeCompare(b.name, 'id-ID');
      }
    });
}

function hasActiveFilters() {
  return Boolean(
    state.search ||
    state.categoryId !== 'all' ||
    state.stockFilter !== 'all' ||
    state.statusFilter !== 'all' ||
    state.sort !== 'name-asc'
  );
}

function resetFilters() {
  state.search = '';
  state.categoryId = 'all';
  state.stockFilter = 'all';
  state.statusFilter = 'all';
  state.sort = 'name-asc';
  state.page = 1;
  rerender();
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
  if (!fieldNode) return;
  fieldNode.classList.add('invalid');
  const error = fieldNode.querySelector('.field-error');
  if (error) error.textContent = message;
}

function clearFieldErrors(form) {
  form.querySelectorAll('.field.invalid').forEach((node) => {
    node.classList.remove('invalid');
    const error = node.querySelector('.field-error');
    if (error) error.textContent = '';
  });
}

function parseNonNegativeInteger(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const number = Number(raw);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0) return null;
  return number;
}

function openProductForm(productId = null) {
  const categories = getCategories();
  const settings = getSettings();
  if (!categories.length) {
    toast('Buat kategori terlebih dahulu sebelum menambah produk.', 'warning');
    navigate('categories');
    return;
  }

  const product = productId ? getProducts().find((item) => item.id === productId) : null;
  if (productId && !product) {
    toast('Produk tidak ditemukan. Mungkin sudah dihapus.', 'error');
    rerender();
    return;
  }

  const formId = `product-form-${Date.now()}`;
  const skuInput = el('input', {
    class: 'input',
    id: `${formId}-sku`,
    type: 'text',
    maxlength: '32',
    placeholder: 'Contoh: MNM-001',
    value: product?.sku || '',
    autocomplete: 'off'
  });
  const nameInput = el('input', {
    class: 'input',
    id: `${formId}-name`,
    type: 'text',
    maxlength: '100',
    placeholder: 'Nama produk',
    value: product?.name || ''
  });
  const categorySelect = el('select', { class: 'select', id: `${formId}-category` },
    categories.map((category) => el('option', {
      value: category.id,
      text: category.name,
      selected: category.id === product?.categoryId
    }))
  );
  const costInput = el('input', {
    class: 'input',
    id: `${formId}-cost`,
    type: 'number',
    min: '0',
    step: '1',
    inputmode: 'numeric',
    value: product ? String(product.costPrice) : '',
    placeholder: '0'
  });
  const sellInput = el('input', {
    class: 'input',
    id: `${formId}-sell`,
    type: 'number',
    min: '0',
    step: '1',
    inputmode: 'numeric',
    value: product ? String(product.sellPrice) : '',
    placeholder: '0'
  });
  const stockInput = el('input', {
    class: 'input',
    id: `${formId}-stock`,
    type: 'number',
    min: '0',
    step: '1',
    inputmode: 'numeric',
    value: product ? String(product.stock) : '0'
  });
  const minStockInput = el('input', {
    class: 'input',
    id: `${formId}-min-stock`,
    type: 'number',
    min: '0',
    step: '1',
    inputmode: 'numeric',
    value: product ? String(product.minStock) : String(settings.defaultMinStock)
  });
  const activeInput = el('input', {
    type: 'checkbox',
    checked: product ? product.active !== false : true
  });

  const skuField = field({
    id: `${formId}-sku`,
    label: 'SKU / Kode Produk',
    required: true,
    control: skuInput,
    hint: 'Harus unik. Gunakan kode singkat yang mudah dicari.'
  });
  const nameField = field({
    id: `${formId}-name`,
    label: 'Nama Produk',
    required: true,
    control: nameInput,
    full: true
  });
  const categoryField = field({
    id: `${formId}-category`,
    label: 'Kategori',
    required: true,
    control: categorySelect
  });
  const costField = field({
    id: `${formId}-cost`,
    label: 'Harga Modal (Rp)',
    required: true,
    control: costInput,
    hint: 'Dipakai untuk menghitung estimasi laba kotor.'
  });
  const sellField = field({
    id: `${formId}-sell`,
    label: 'Harga Jual (Rp)',
    required: true,
    control: sellInput
  });
  const stockField = field({
    id: `${formId}-stock`,
    label: product ? 'Stok Saat Ini' : 'Stok Awal',
    required: true,
    control: stockInput,
    hint: product
      ? 'Perubahan stok akan dicatat sebagai penyesuaian pada riwayat stok.'
      : 'Stok awal juga akan dicatat pada riwayat pergerakan stok.'
  });
  const minStockField = field({
    id: `${formId}-min-stock`,
    label: 'Batas Minimum Stok',
    required: true,
    control: minStockInput,
    hint: 'Produk ditandai menipis jika stok berada pada atau di bawah nilai ini.'
  });
  const activeField = el('div', { class: 'field full' }, [
    el('span', { class: 'field-label', text: 'Status Produk' }),
    el('label', { class: 'switch' }, [
      activeInput,
      el('span', { class: 'switch-track' }),
      el('span', { class: 'switch-label', text: 'Aktif dan dapat dijual di kasir' })
    ])
  ]);

  const form = el('form', {
    class: 'form',
    id: formId,
    novalidate: true
  }, [
    el('div', { class: 'form-grid' }, [
      skuField,
      categoryField,
      nameField,
      costField,
      sellField,
      stockField,
      minStockField,
      activeField
    ])
  ]);

  const cancelButton = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Batal' });
  const saveLabel = el('span', { text: product ? 'Simpan Perubahan' : 'Simpan Produk' });
  const saveButton = el('button', {
    class: 'btn btn-primary',
    type: 'submit',
    form: formId
  }, [icon('save'), saveLabel]);

  const footer = el('div', { class: 'modal-footer' }, [cancelButton, saveButton]);
  const modal = openModal({
    title: product ? 'Edit Produk' : 'Tambah Produk',
    subtitle: product ? `Perbarui informasi ${product.name}` : 'Lengkapi data produk baru',
    content: form,
    footer,
    size: 'lg'
  });

  cancelButton.addEventListener('click', () => modal.close('cancel'));

  let submitting = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submitting) return;
    clearFieldErrors(form);

    const sku = normalizeWhitespace(skuInput.value);
    const name = normalizeWhitespace(nameInput.value);
    const categoryId = categorySelect.value;
    const costPrice = parseNonNegativeInteger(costInput.value);
    const sellPrice = parseNonNegativeInteger(sellInput.value);
    const stock = parseNonNegativeInteger(stockInput.value);
    const minStock = parseNonNegativeInteger(minStockInput.value);
    const active = activeInput.checked;

    let firstInvalid = null;
    if (!sku) {
      setFieldError(skuField, 'SKU wajib diisi.');
      firstInvalid = firstInvalid || skuInput;
    }
    if (!name) {
      setFieldError(nameField, 'Nama produk wajib diisi.');
      firstInvalid = firstInvalid || nameInput;
    }
    if (!categoryId) {
      setFieldError(categoryField, 'Pilih kategori produk.');
      firstInvalid = firstInvalid || categorySelect;
    }
    if (costPrice === null) {
      setFieldError(costField, 'Harga modal harus bilangan bulat nonnegatif.');
      firstInvalid = firstInvalid || costInput;
    }
    if (sellPrice === null) {
      setFieldError(sellField, 'Harga jual harus bilangan bulat nonnegatif.');
      firstInvalid = firstInvalid || sellInput;
    }
    if (stock === null) {
      setFieldError(stockField, 'Stok harus bilangan bulat nonnegatif.');
      firstInvalid = firstInvalid || stockInput;
    }
    if (minStock === null) {
      setFieldError(minStockField, 'Batas minimum stok harus bilangan bulat nonnegatif.');
      firstInvalid = firstInvalid || minStockInput;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    submitting = true;
    saveButton.disabled = true;
    saveLabel.textContent = 'Menyimpan…';

    const now = new Date().toISOString();
    try {
      runAtomic(() => {
        const products = getProducts();
        const duplicateSku = products.find(
          (item) => item.id !== product?.id && normalizeKey(item.sku) === normalizeKey(sku)
        );
        if (duplicateSku) {
          throw new Error(`SKU "${sku}" sudah digunakan oleh ${duplicateSku.name}.`);
        }
        const duplicateName = products.find(
          (item) => item.id !== product?.id &&
            item.categoryId === categoryId &&
            normalizeKey(item.name) === normalizeKey(name)
        );
        if (duplicateName) {
          throw new Error(`Produk dengan nama "${name}" sudah ada pada kategori ini.`);
        }

        let movements = getMovements();
        const timestamp = now;

        if (product) {
          const index = products.findIndex((item) => item.id === product.id);
          if (index < 0) throw new Error('Produk tidak ditemukan. Mungkin sudah dihapus.');
          const current = products[index];
          const previousStock = Number(current.stock) || 0;
          const updated = {
            ...current,
            sku,
            name,
            categoryId,
            costPrice,
            sellPrice,
            stock,
            minStock,
            active,
            updatedAt: timestamp
          };
          products[index] = updated;

          if (stock !== previousStock) {
            movements = [
              {
                id: uid('mov'),
                productId: updated.id,
                productName: updated.name,
                type: 'adjustment',
                change: stock - previousStock,
                stockBefore: previousStock,
                stockAfter: stock,
                reason: 'Penyesuaian stok melalui edit produk',
                referenceId: null,
                referenceNumber: null,
                createdAt: timestamp
              },
              ...movements
            ];
          }
        } else {
          const newProduct = {
            id: uid('prd'),
            sku,
            name,
            categoryId,
            costPrice,
            sellPrice,
            stock,
            minStock,
            active,
            createdAt: timestamp,
            updatedAt: timestamp
          };
          products.push(newProduct);
          movements = [
            {
              id: uid('mov'),
              productId: newProduct.id,
              productName: newProduct.name,
              type: 'initial',
              change: stock,
              stockBefore: 0,
              stockAfter: stock,
              reason: 'Stok awal saat produk dibuat',
              referenceId: null,
              referenceNumber: null,
              createdAt: timestamp
            },
            ...movements
          ];
        }

        saveProducts(products);
        saveMovements(movements);
      });

      modal.close('saved');
      toast(product ? 'Perubahan produk berhasil disimpan.' : 'Produk baru berhasil ditambahkan.', 'success');
      rerender();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Produk gagal disimpan.', 'error');
      submitting = false;
      saveButton.disabled = false;
      saveLabel.textContent = product ? 'Simpan Perubahan' : 'Simpan Produk';
    }
  });
}

function openProductDetail(productId) {
  const product = getProducts().find((item) => item.id === productId);
  if (!product) {
    toast('Produk tidak ditemukan.', 'error');
    rerender();
    return;
  }
  const categories = getCategories();
  const status = getStockStatus(product);
  const margin = Number(product.sellPrice) - Number(product.costPrice);
  const marginPercent = Number(product.sellPrice) > 0 ? (margin / Number(product.sellPrice)) * 100 : 0;

  const content = el('div', {}, [
    el('div', { class: 'product-detail-grid' }, [
      el('div', { class: 'detail-block' }, [
        el('span', { text: 'SKU' }),
        el('strong', { text: product.sku })
      ]),
      el('div', { class: 'detail-block' }, [
        el('span', { text: 'Kategori' }),
        el('strong', { text: categoryName(categories, product.categoryId) })
      ]),
      el('div', { class: 'detail-block' }, [
        el('span', { text: 'Harga jual' }),
        el('strong', { class: 'large', text: formatCurrency(product.sellPrice) }),
        el('small', { text: `Modal ${formatCurrency(product.costPrice)}` })
      ]),
      el('div', { class: 'detail-block' }, [
        el('span', { text: 'Margin per unit' }),
        el('strong', { text: `${formatCurrency(margin)} (${formatPercent(marginPercent)})` })
      ]),
      el('div', { class: 'detail-block' }, [
        el('span', { text: 'Stok saat ini' }),
        el('strong', { class: 'large', text: `${formatNumber(product.stock)} unit` }),
        el('span', { class: `badge badge-${status.tone}`, text: status.label, style: { width: 'fit-content', marginTop: '4px' } })
      ]),
      el('div', { class: 'detail-block' }, [
        el('span', { text: 'Batas minimum stok' }),
        el('strong', { text: `${formatNumber(product.minStock)} unit` })
      ]),
      el('div', { class: 'detail-block' }, [
        el('span', { text: 'Status produk' }),
        el('span', {
          class: `badge ${product.active !== false ? 'badge-success' : 'badge-neutral'}`,
          text: product.active !== false ? 'Aktif' : 'Nonaktif',
          style: { width: 'fit-content' }
        })
      ]),
      el('div', { class: 'detail-block' }, [
        el('span', { text: 'Terakhir diperbarui' }),
        el('strong', { text: formatDateTime(product.updatedAt) })
      ]),
      el('div', { class: 'detail-block full' }, [
        el('span', { text: 'Dibuat pada' }),
        el('strong', { text: formatDateTime(product.createdAt) }),
        el('small', { text: `ID produk: ${product.id}` })
      ])
    ]),
    el('div', { class: 'form-note', style: { marginTop: '14px' } }, [
      icon('info'),
      'Data historis transaksi menggunakan snapshot saat transaksi terjadi, sehingga perubahan harga tidak mengubah riwayat.'
    ])
  ]);

  const closeButton = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Tutup' });
  const historyButton = el('button', {
    class: 'btn btn-ghost',
    type: 'button'
  }, [icon('clock'), 'Riwayat Stok']);
  const editButton = el('button', {
    class: 'btn btn-primary',
    type: 'button'
  }, [icon('pencil'), 'Edit Produk']);

  const footer = el('div', { class: 'modal-footer spread' }, [
    el('div', { class: 'footer-left' }, [historyButton]),
    el('div', { class: 'footer-left', style: { marginLeft: 'auto', marginRight: '0' } }, [closeButton, editButton])
  ]);

  const modal = openModal({
    title: product.name,
    subtitle: `${product.sku} • ${categoryName(categories, product.categoryId)}`,
    content,
    footer,
    size: 'md'
  });

  closeButton.addEventListener('click', () => modal.close('close'));
  historyButton.addEventListener('click', () => {
    modal.close('history');
    navigate('inventory', { productId: product.id });
  });
  editButton.addEventListener('click', () => {
    modal.close('edit');
    openProductForm(product.id);
  });
  return { modal };
}

function activateProduct(productId, active) {
  try {
    runAtomic(() => {
      const products = getProducts();
      const index = products.findIndex((product) => product.id === productId);
      if (index < 0) throw new Error('Produk tidak ditemukan.');
      products[index] = { ...products[index], active, updatedAt: new Date().toISOString() };
      saveProducts(products);
    });
    toast(active ? 'Produk diaktifkan dan dapat dijual kembali.' : 'Produk dinonaktifkan. Riwayat transaksi tetap tersimpan.', 'success');
  } catch (error) {
    toast(error.message || 'Status produk gagal diubah.', 'error');
  }
  rerender();
}

function openDeactivateDialog(productId) {
  const product = getProducts().find((item) => item.id === productId);
  if (!product) return;

  const content = el('div', {}, [
    el('p', { class: 'confirm-copy' }, [
      'Produk ',
      el('strong', { text: `"${product.name}"` }),
      ' sudah digunakan dalam transaksi, sehingga tidak boleh dihapus permanen agar riwayat penjualan tetap utuh.'
    ]),
    el('div', { class: 'form-note warning confirm-warning' }, [
      icon('alert-triangle'),
      'Anda dapat menonaktifkannya. Produk nonaktif tidak muncul sebagai pilihan di kasir, tetapi tetap tersimpan untuk laporan dan riwayat.'
    ])
  ]);

  const closeButton = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Tutup' });
  const deactivateButton = el('button', {
    class: 'btn btn-danger-soft',
    type: 'button',
    disabled: product.active === false
  }, [icon('power'), product.active === false ? 'Sudah Nonaktif' : 'Nonaktifkan Produk']);

  const footer = el('div', { class: 'modal-footer' }, [closeButton, deactivateButton]);
  const modal = openModal({
    title: 'Produk tidak dapat dihapus',
    subtitle: 'Riwayat transaksi harus dipertahankan',
    content,
    footer,
    size: 'sm'
  });

  closeButton.addEventListener('click', () => modal.close('close'));
  deactivateButton.addEventListener('click', () => {
    modal.close('deactivate');
    activateProduct(product.id, false);
  });
}

function deleteProduct(productId) {
  const product = getProducts().find((item) => item.id === productId);
  if (!product) {
    toast('Produk tidak ditemukan.', 'error');
    rerender();
    return;
  }

  const usedInTransactions = getTransactions().some((transaction) =>
    (transaction.items || []).some((item) => item.productId === productId)
  );
  if (usedInTransactions) {
    openDeactivateDialog(productId);
    return;
  }

  confirmDialog({
    title: 'Hapus produk?',
    message: `Produk "${product.name}" beserta riwayat pergerakan stoknya akan dihapus permanen.`,
    details: ['Tindakan ini tidak dapat dibatalkan.'],
    confirmLabel: 'Hapus Produk',
    danger: true
  }).then((confirmed) => {
    if (!confirmed) return;
    try {
      runAtomic(() => {
        const products = getProducts();
        const exists = products.some((item) => item.id === productId);
        if (!exists) throw new Error('Produk sudah tidak ada.');
        const hasHistory = getTransactions().some((transaction) =>
          (transaction.items || []).some((item) => item.productId === productId)
        );
        if (hasHistory) {
          throw new Error('Produk sudah digunakan pada transaksi dan tidak dapat dihapus.');
        }
        saveProducts(products.filter((item) => item.id !== productId));
        saveMovements(getMovements().filter((movement) => movement.productId !== productId));
      });
      toast('Produk berhasil dihapus.', 'success');
      rerender();
    } catch (error) {
      toast(error.message || 'Produk gagal dihapus.', 'error');
    }
  });
}

function buildToolbar(categories, products) {
  const searchInput = el('input', {
    class: 'input',
    id: 'product-search',
    type: 'search',
    placeholder: 'Cari nama atau SKU produk…',
    value: state.search,
    autocomplete: 'off'
  });
  searchInput.addEventListener('input', (event) => {
    state.search = event.target.value;
    state.page = 1;
    debouncedSearch();
  });

  const categorySelect = el('select', { class: 'select select-sm', 'aria-label': 'Filter kategori' }, [
    el('option', { value: 'all', text: 'Semua kategori', selected: state.categoryId === 'all' }),
    ...categories.map((category) => el('option', {
      value: category.id,
      text: category.name,
      selected: state.categoryId === category.id
    }))
  ]);
  categorySelect.addEventListener('change', (event) => {
    state.categoryId = event.target.value;
    state.page = 1;
    rerender();
  });

  const stockSelect = el('select', { class: 'select select-sm', 'aria-label': 'Filter status stok' }, [
    el('option', { value: 'all', text: 'Semua stok', selected: state.stockFilter === 'all' }),
    el('option', { value: 'available', text: 'Stok tersedia', selected: state.stockFilter === 'available' }),
    el('option', { value: 'low', text: 'Menipis / habis', selected: state.stockFilter === 'low' }),
    el('option', { value: 'out', text: 'Stok habis', selected: state.stockFilter === 'out' })
  ]);
  stockSelect.addEventListener('change', (event) => {
    state.stockFilter = event.target.value;
    state.page = 1;
    rerender();
  });

  const statusSelect = el('select', { class: 'select select-sm', 'aria-label': 'Filter status produk' }, [
    el('option', { value: 'all', text: 'Semua status', selected: state.statusFilter === 'all' }),
    el('option', { value: 'active', text: 'Aktif', selected: state.statusFilter === 'active' }),
    el('option', { value: 'inactive', text: 'Nonaktif', selected: state.statusFilter === 'inactive' })
  ]);
  statusSelect.addEventListener('change', (event) => {
    state.statusFilter = event.target.value;
    state.page = 1;
    rerender();
  });

  const sortSelect = el('select', { class: 'select select-sm', 'aria-label': 'Urutkan produk' }, [
    el('option', { value: 'name-asc', text: 'Nama A–Z', selected: state.sort === 'name-asc' }),
    el('option', { value: 'name-desc', text: 'Nama Z–A', selected: state.sort === 'name-desc' }),
    el('option', { value: 'price-asc', text: 'Harga terendah', selected: state.sort === 'price-asc' }),
    el('option', { value: 'price-desc', text: 'Harga tertinggi', selected: state.sort === 'price-desc' }),
    el('option', { value: 'stock-asc', text: 'Stok tersedikit', selected: state.sort === 'stock-asc' }),
    el('option', { value: 'stock-desc', text: 'Stok terbanyak', selected: state.sort === 'stock-desc' }),
    el('option', { value: 'newest', text: 'Terbaru dibuat', selected: state.sort === 'newest' }),
    el('option', { value: 'oldest', text: 'Terlama dibuat', selected: state.sort === 'oldest' })
  ]);
  sortSelect.addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.page = 1;
    rerender();
  });

  const toolbar = el('div', { class: 'filter-bar' }, [
    el('div', { class: 'search-box' }, [icon('search'), searchInput]),
    el('span', { class: 'filter-label', text: `${formatNumber(products.length)} produk` }),
    categorySelect,
    stockSelect,
    statusSelect,
    sortSelect
  ]);

  if (hasActiveFilters()) {
    toolbar.appendChild(el('button', {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      onClick: resetFilters
    }, [icon('rotate-ccw'), 'Reset']));
  }

  return toolbar;
}

function buildTable(products, categories, pagination) {
  const tbody = el('tbody');

  products.forEach((product) => {
    const stock = getStockStatus(product);
    const margin = Number(product.sellPrice) - Number(product.costPrice);
    const marginPercent = Number(product.sellPrice) > 0 ? (margin / Number(product.sellPrice)) * 100 : 0;

    const activeToggle = el('input', {
      type: 'checkbox',
      checked: product.active !== false,
      'aria-label': `Aktifkan ${product.name}`,
      onChange: (event) => {
        activateProduct(product.id, event.target.checked);
      }
    });

    const row = el('tr', {}, [
      el('td', {}, el('div', { class: 'product-name-cell' }, [
        el('span', { class: 'product-thumb', text: getInitials(product.name, 'P').slice(0, 2) }),
        el('div', {}, [
          el('span', { class: 'cell-main', text: product.name }),
          el('span', { class: 'cell-sub', text: product.sku })
        ])
      ])),
      el('td', {}, el('span', { class: 'badge badge-neutral', text: categoryName(categories, product.categoryId) })),
      el('td', { class: 'num' }, [
        el('span', { class: 'cell-main', text: formatCurrency(product.sellPrice) }),
        el('span', { class: 'margin-text', text: `Margin ${formatCurrency(margin)} (${formatPercent(marginPercent)})` })
      ]),
      el('td', {}, el('div', { class: 'stock-cell' }, [
        el('strong', { text: formatNumber(product.stock) }),
        el('span', { class: `badge badge-${stock.tone}`, text: stock.key === 'out' ? 'Habis' : stock.key === 'low' ? 'Menipis' : 'Aman' }),
        el('small', { text: `min ${formatNumber(product.minStock)}` })
      ])),
      el('td', {}, el('div', { class: 'status-switch-cell' }, [
        el('label', { class: 'switch' }, [
          activeToggle,
          el('span', { class: 'switch-track' })
        ]),
        el('span', { class: 'switch-label', text: product.active !== false ? 'Aktif' : 'Nonaktif' })
      ])),
      el('td', { class: 'nowrap' }, el('span', { class: 'cell-sub', text: formatDateShort(product.updatedAt) })),
      el('td', { class: 'actions-col' }, el('div', { class: 'actions' }, [
        el('button', {
          class: 'icon-btn',
          type: 'button',
          title: 'Lihat detail',
          'aria-label': `Lihat detail ${product.name}`,
          onClick: () => openProductDetail(product.id)
        }, icon('eye')),
        el('button', {
          class: 'icon-btn',
          type: 'button',
          title: 'Edit produk',
          'aria-label': `Edit ${product.name}`,
          onClick: () => openProductForm(product.id)
        }, icon('pencil')),
        el('button', {
          class: 'icon-btn danger',
          type: 'button',
          title: 'Hapus produk',
          'aria-label': `Hapus ${product.name}`,
          onClick: () => deleteProduct(product.id)
        }, icon('trash'))
      ]))
    ]);
    tbody.appendChild(row);
  });

  const footer = el('div', { class: 'table-footer' }, [
    el('span', {
      text: pagination.total === 0
        ? 'Tidak ada produk yang cocok'
        : `Menampilkan ${formatNumber(pagination.start)}–${formatNumber(pagination.end)} dari ${formatNumber(pagination.total)} produk`
    }),
    buildPagination(pagination.totalPages, pagination.page, setPage)
  ]);

  return el('div', { class: 'card', id: 'products-table-card' }, [
    el('div', { class: 'table-wrap' }, el('table', { class: 'table', style: { minWidth: '920px' } }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Produk' }),
        el('th', { text: 'Kategori' }),
        el('th', { class: 'num', text: 'Harga Jual' }),
        el('th', { text: 'Stok' }),
        el('th', { text: 'Status' }),
        el('th', { text: 'Diperbarui' }),
        el('th', { class: 'actions-col', text: 'Aksi' })
      ])),
      tbody
    ])),
    footer
  ]);
}

function buildEmptyState(hasProducts) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-icon' }, icon(hasProducts ? 'search' : 'package')),
      el('h4', { text: hasProducts ? 'Tidak ada produk yang cocok' : 'Belum ada produk' }),
      el('p', {
        text: hasProducts
          ? 'Coba ubah kata kunci atau reset filter untuk melihat produk lainnya.'
          : 'Tambahkan produk pertama Anda agar transaksi kasir dapat dilakukan.'
      }),
      hasProducts
        ? el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: resetFilters }, [icon('rotate-ccw'), 'Reset filter'])
        : el('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openProductForm() }, [icon('plus'), 'Tambah Produk'])
    ])
  ]);
}

export function renderProductsPage(container, params = {}) {
  if (!initialized) {
    initialized = true;
  }

  const products = getProducts();
  const categories = getCategories();

  if (state.categoryId !== 'all' && !categories.some((category) => category.id === state.categoryId)) {
    state.categoryId = 'all';
  }

  const filtered = getFilteredProducts(products, categories);
  const pagination = paginate(filtered, state.page, state.pageSize);
  state.page = pagination.page;

  const pageHead = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-head-copy' }, [
      el('h2', { text: 'Katalog Produk' }),
      el('p', { text: 'Kelola nama, harga, kategori, dan status produk yang dijual di kasir.' })
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        onClick: () => openProductForm()
      }, [icon('plus'), 'Tambah Produk'])
    ])
  ]);

  container.appendChild(pageHead);

  if (!products.length) {
    container.appendChild(buildEmptyState(false));
    return;
  }

  container.appendChild(buildToolbar(categories, filtered));

  if (!pagination.items.length) {
    container.appendChild(buildEmptyState(true));
    return;
  }

  container.appendChild(buildTable(pagination.items, categories, pagination));

  const openProductId = params?.openProductId;
  if (openProductId) {
    openProductDetail(openProductId);
  }
}
