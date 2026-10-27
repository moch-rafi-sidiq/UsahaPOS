/**
 * cashier.js
 * Modul kasir: katalog produk, keranjang, diskon, pembayaran, dan
 * penyimpanan transaksi yang aman (stok tidak berkurang dua kali).
 */

import {
  $,
  $$,
  PAYMENT_METHODS,
  confirmDialog,
  el,
  emitDataChanged,
  formatCurrency,
  formatNumber,
  getStockStatus,
  icon,
  normalizeKey,
  openModal,
  toast,
  uid
} from './utils.js';
import { calcCartTotals } from './calculations.js';
import {
  generateTransactionNumber,
  getCategories,
  getMovements,
  getProducts,
  getTransactions,
  runAtomic,
  saveMovements,
  saveProducts,
  saveTransactions
} from './storage.js';
import { navigate } from './router.js';
import { openReceipt } from './receipt.js';

const state = {
  search: '',
  categoryId: 'all',
  cart: [],
  discount: '',
  mobileCartOpen: false
};

let processingPayment = false;

document.addEventListener('usahapos:newtransaction', () => {
  state.cart = [];
  state.discount = '';
  state.mobileCartOpen = false;
  processingPayment = false;
});

function parseDiscount(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { value: 0, valid: true, message: '' };
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) {
    return { value: 0, valid: false, message: 'Diskon harus berupa angka nonnegatif.' };
  }
  if (!Number.isInteger(number)) {
    return { value: Math.floor(number), valid: false, message: 'Diskon harus bilangan bulat Rupiah.' };
  }
  return { value: number, valid: true, message: '' };
}

function reconcileCart(notify = false) {
  const products = getProducts();
  const map = new Map(products.map((product) => [product.id, product]));
  let changed = false;

  state.cart = state.cart.filter((line) => {
    const product = map.get(line.productId);
    if (!product || product.active === false || Number(product.stock) <= 0) {
      changed = true;
      return false;
    }
    const stock = Math.max(0, Math.floor(Number(product.stock) || 0));
    if (line.qty > stock) {
      line.qty = stock;
      changed = true;
    }
    if (!Number.isInteger(line.qty) || line.qty < 1) {
      changed = true;
      return false;
    }
    return true;
  });

  if (!state.cart.length) state.discount = '';
  if (changed && notify) {
    toast('Keranjang disesuaikan dengan stok dan status produk terbaru.', 'info');
  }
  return changed;
}

function getLiveLines() {
  const products = getProducts();
  const map = new Map(products.map((product) => [product.id, product]));
  return state.cart
    .map((line) => ({ line, product: map.get(line.productId) }))
    .filter((entry) => Boolean(entry.product));
}

function getSummaryData() {
  const entries = getLiveLines();
  const items = entries.map(({ line, product }) => ({
    unitPrice: Number(product.sellPrice) || 0,
    qty: line.qty
  }));
  const discount = parseDiscount(state.discount);
  const totals = calcCartTotals(items, discount.value);
  let discountMessage = discount.message;
  if (!discountMessage && totals.discountExceeds) {
    discountMessage = `Diskon tidak boleh melebihi subtotal ${formatCurrency(totals.subtotal)}.`;
  }
  return {
    entries,
    items,
    totals,
    discount,
    discountMessage,
    canPay: entries.length > 0 && !discountMessage
  };
}

function categoryMap() {
  return new Map(getCategories().map((category) => [category.id, category.name]));
}

function openMobileCart() {
  state.mobileCartOpen = true;
  $('#cashier-cart')?.classList.add('open');
  $('#cart-backdrop')?.classList.add('show');
}

function closeMobileCart() {
  state.mobileCartOpen = false;
  $('#cashier-cart')?.classList.remove('open');
  $('#cart-backdrop')?.classList.remove('show');
}

function addToCart(productId) {
  const product = getProducts().find((item) => item.id === productId);
  if (!product) {
    toast('Produk tidak ditemukan. Muat ulang daftar produk.', 'error');
    renderProductGrid();
    return;
  }
  if (product.active === false) {
    toast('Produk ini sedang nonaktif dan tidak dapat dijual.', 'warning');
    return;
  }
  const stock = Math.max(0, Math.floor(Number(product.stock) || 0));
  if (stock <= 0) {
    toast(`Stok ${product.name} habis.`, 'warning');
    return;
  }

  const line = state.cart.find((item) => item.productId === productId);
  if (line) {
    if (line.qty >= stock) {
      toast(`Stok ${product.name} hanya ${formatNumber(stock)} unit.`, 'warning');
      return;
    }
    line.qty += 1;
  } else {
    state.cart.push({ productId, qty: 1 });
  }
  renderCart();
}

function changeQuantity(productId, delta) {
  const line = state.cart.find((item) => item.productId === productId);
  if (!line) return;
  const product = getProducts().find((item) => item.id === productId);
  if (!product) {
    toast('Produk tidak ditemukan.', 'error');
    renderCart();
    return;
  }
  const stock = Math.max(0, Math.floor(Number(product.stock) || 0));
  const next = line.qty + delta;
  if (next < 1) return;
  if (next > stock) {
    toast(`Stok ${product.name} hanya ${formatNumber(stock)} unit.`, 'warning');
    return;
  }
  line.qty = next;
  renderCart();
}

function removeCartItem(productId) {
  state.cart = state.cart.filter((line) => line.productId !== productId);
  if (!state.cart.length) state.discount = '';
  renderCart();
}

function clearCart() {
  if (!state.cart.length) return;
  const totalQty = state.cart.reduce((sum, line) => sum + line.qty, 0);
  confirmDialog({
    title: 'Kosongkan keranjang?',
    message: 'Semua produk pada keranjang akan dihapus.',
    details: [`Keranjang saat ini berisi ${formatNumber(totalQty)} item.`],
    confirmLabel: 'Kosongkan',
    danger: true
  }).then((confirmed) => {
    if (!confirmed) return;
    state.cart = [];
    state.discount = '';
    renderCart();
    toast('Keranjang dikosongkan.', 'info');
  });
}

function buildProductCard(product, cartQty, categories) {
  const stock = getStockStatus(product);
  const stockCount = Math.max(0, Math.floor(Number(product.stock) || 0));
  const disabled = product.active === false || stockCount <= 0;
  const categoryName = categories.get(product.categoryId) || 'Tanpa Kategori';

  const card = el('button', {
    class: `product-card ${stockCount <= 0 ? 'is-out' : ''}`.trim(),
    type: 'button',
    disabled,
    'aria-label': `${product.name}, ${formatCurrency(product.sellPrice)}, stok ${formatNumber(stockCount)}${cartQty ? `, ${cartQty} di keranjang` : ''}`,
    onClick: () => addToCart(product.id)
  }, [
    el('div', { class: 'product-card-top' }, [
      el('span', { class: 'product-card-category', text: categoryName }),
      el('span', { class: 'product-add-mark' }, icon(stockCount > 0 ? 'plus' : 'alert-circle'))
    ]),
    el('span', { class: 'product-card-name', text: product.name }),
    el('span', { class: 'product-card-price', text: formatCurrency(product.sellPrice) }),
    el('div', { class: 'product-card-meta' }, [
      el('span', {
        class: `stock-pill ${stock.key === 'low' ? 'low' : stock.key === 'out' ? 'out' : ''}`.trim()
      }, [
        el('span', { class: `status-dot ${stock.key === 'low' ? 'amber' : stock.key === 'out' ? 'red' : 'green'}` }),
        stockCount > 0 ? `${formatNumber(stockCount)} tersedia` : 'Stok habis'
      ]),
      el('span', { class: 'cell-sub', style: { margin: '0' }, text: cartQty > 0 ? `${formatNumber(cartQty)} di keranjang` : product.sku })
    ])
  ]);
  return card;
}

function renderProductGrid() {
  const grid = $('#cashier-product-grid');
  const result = $('#cashier-result');
  if (!grid) return;

  const products = getProducts();
  const categories = categoryMap();
  const activeProducts = products.filter((product) => product.active !== false);
  if (state.categoryId !== 'all' && !categories.has(state.categoryId)) {
    state.categoryId = 'all';
  }

  const search = normalizeKey(state.search);
  const filtered = activeProducts
    .filter((product) => {
      if (state.categoryId !== 'all' && product.categoryId !== state.categoryId) return false;
      if (search) {
        const haystack = `${product.name} ${product.sku}`.toLocaleLowerCase('id-ID');
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'id-ID'));

  if (result) result.textContent = `${formatNumber(filtered.length)} produk`;

  $$('.category-chips .chip[data-category-id]').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.categoryId === state.categoryId);
  });

  grid.replaceChildren();

  if (!filtered.length) {
    const noProductsAtAll = activeProducts.length === 0;
    grid.appendChild(el('div', {
      class: 'card',
      style: { gridColumn: '1 / -1' }
    }, el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-icon' }, icon(noProductsAtAll ? 'package' : 'search')),
      el('h4', { text: noProductsAtAll ? 'Belum ada produk aktif' : 'Produk tidak ditemukan' }),
      el('p', {
        text: noProductsAtAll
          ? 'Tambahkan produk atau aktifkan produk terlebih dahulu agar dapat dijual di kasir.'
          : 'Coba kata kunci lain atau pilih kategori yang berbeda.'
      }),
      noProductsAtAll
        ? el('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          onClick: () => navigate('products')
        }, [icon('package'), 'Kelola Produk'])
        : el('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          onClick: () => {
            state.search = '';
            state.categoryId = 'all';
            const input = $('#cashier-search');
            if (input) input.value = '';
            $$('.category-chips .chip[data-category-id]').forEach((chip) => {
              chip.classList.toggle('active', chip.dataset.categoryId === 'all');
            });
            renderProductGrid();
          }
        }, [icon('rotate-ccw'), 'Reset pencarian'])
    ])));
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach((product) => {
    const cartLine = state.cart.find((line) => line.productId === product.id);
    fragment.appendChild(buildProductCard(product, cartLine?.qty || 0, categories));
  });
  grid.appendChild(fragment);
}

function renderCart() {
  const itemsContainer = $('#cart-items');
  const summaryContainer = $('#cart-summary');
  if (!itemsContainer || !summaryContainer) return;

  const summary = getSummaryData();
  const totalQty = summary.entries.reduce((sum, entry) => sum + entry.line.qty, 0);

  const countBadge = $('#cart-count');
  if (countBadge) countBadge.textContent = formatNumber(totalQty);

  const clearButton = $('#cart-clear');
  if (clearButton) clearButton.disabled = !summary.entries.length;

  const mobileCount = $('#cart-mobile-count');
  if (mobileCount) mobileCount.textContent = totalQty > 0 ? `${formatNumber(totalQty)} item` : 'Keranjang kosong';

  const mobileTotal = $('#cart-mobile-total');
  if (mobileTotal) mobileTotal.textContent = formatCurrency(summary.totals.total);

  const mobileOpen = $('#cart-mobile-open');
  if (mobileOpen) mobileOpen.disabled = !summary.entries.length;

  itemsContainer.replaceChildren();
  summaryContainer.replaceChildren();

  if (!summary.entries.length) {
    itemsContainer.appendChild(el('div', { class: 'cart-empty' }, [
      el('div', { class: 'empty-icon' }, icon('shopping-bag')),
      el('h4', { text: 'Keranjang masih kosong' }),
      el('p', { text: 'Klik produk di sebelah kiri untuk menambahkannya ke keranjang.' })
    ]));
    return;
  }

  summary.entries.forEach(({ line, product }) => {
    const stock = Math.max(0, Math.floor(Number(product.stock) || 0));
    const subtotal = (Number(product.sellPrice) || 0) * line.qty;

    const minusButton = el('button', {
      type: 'button',
      'aria-label': `Kurangi jumlah ${product.name}`,
      disabled: line.qty <= 1,
      onClick: () => changeQuantity(product.id, -1)
    }, icon('minus'));
    const plusButton = el('button', {
      type: 'button',
      'aria-label': `Tambah jumlah ${product.name}`,
      disabled: line.qty >= stock,
      onClick: () => changeQuantity(product.id, 1)
    }, icon('plus'));

    itemsContainer.appendChild(el('div', { class: 'cart-item' }, [
      el('div', { class: 'cart-item-top' }, [
        el('div', { class: 'cart-item-copy' }, [
          el('strong', { text: product.name }),
          el('span', { text: `${formatCurrency(product.sellPrice)} • stok ${formatNumber(stock)}` })
        ]),
        el('span', { class: 'cart-item-subtotal', text: formatCurrency(subtotal) })
      ]),
      el('div', { class: 'cart-item-bottom' }, [
        el('div', { class: 'qty-control' }, [
          minusButton,
          el('span', { text: formatNumber(line.qty) }),
          plusButton
        ]),
        el('button', {
          class: 'cart-item-remove',
          type: 'button',
          title: 'Hapus item',
          'aria-label': `Hapus ${product.name} dari keranjang`,
          onClick: () => removeCartItem(product.id)
        }, icon('trash'))
      ])
    ]));
  });

  const discountInput = el('input', {
    class: 'input discount-input',
    id: 'cart-discount',
    type: 'number',
    min: '0',
    step: '1',
    inputmode: 'numeric',
    placeholder: '0',
    value: state.discount,
    'aria-label': 'Diskon transaksi dalam Rupiah'
  });
  discountInput.addEventListener('input', (event) => {
    state.discount = event.target.value;
    updateCartTotalsUI();
  });

  const discountError = el('p', {
    class: `discount-error ${summary.discountMessage ? 'show' : ''}`.trim(),
    id: 'cart-discount-error',
    text: summary.discountMessage || ''
  });

  const payLabel = el('span', {
    id: 'cart-pay-label',
    text: `Bayar • ${formatCurrency(summary.totals.total)}`
  });
  const payButton = el('button', {
    class: 'btn btn-primary btn-block',
    type: 'button',
    id: 'cart-pay',
    disabled: !summary.canPay,
    onClick: handlePayClick
  }, [icon('wallet'), payLabel]);

  summaryContainer.append(
    el('div', { class: 'summary-row' }, [
      el('span', { text: 'Subtotal' }),
      el('strong', { id: 'cart-subtotal-value', text: formatCurrency(summary.totals.subtotal) })
    ]),
    el('div', { class: 'discount-row' }, [
      el('label', { for: 'cart-discount', text: 'Diskon' }),
      el('div', { class: 'input-prefix' }, [
        el('span', { text: 'Rp' }),
        discountInput
      ])
    ]),
    discountError,
    el('div', { class: 'summary-total' }, [
      el('span', { text: 'Total' }),
      el('strong', { id: 'cart-total-value', text: formatCurrency(summary.totals.total) })
    ]),
    payButton,
    el('p', { class: 'cart-hint', text: 'Diskon berupa nominal Rupiah. Tidak ada pajak otomatis.' })
  );

  updateCartTotalsUI();
}

function updateCartTotalsUI() {
  const summary = getSummaryData();
  const subtotalNode = $('#cart-subtotal-value');
  const totalNode = $('#cart-total-value');
  const errorNode = $('#cart-discount-error');
  const payButton = $('#cart-pay');
  const payLabel = $('#cart-pay-label');
  const mobileTotal = $('#cart-mobile-total');

  if (subtotalNode) subtotalNode.textContent = formatCurrency(summary.totals.subtotal);
  if (totalNode) totalNode.textContent = formatCurrency(summary.totals.total);
  if (mobileTotal) mobileTotal.textContent = formatCurrency(summary.totals.total);
  if (errorNode) {
    errorNode.textContent = summary.discountMessage || '';
    errorNode.classList.toggle('show', Boolean(summary.discountMessage));
  }
  if (payButton) {
    payButton.disabled = !summary.canPay;
    payLabel.textContent = `Bayar • ${formatCurrency(summary.totals.total)}`;
  }
}

function handlePayClick() {
  if (reconcileCart(true)) renderCart();
  const summary = getSummaryData();
  if (!summary.entries.length) {
    toast('Tambahkan produk ke keranjang terlebih dahulu.', 'warning');
    return;
  }
  if (summary.discountMessage) {
    toast(summary.discountMessage, 'error');
    $('#cart-discount')?.focus();
    return;
  }
  closeMobileCart();
  openPaymentModal(summary);
}

function openPaymentModal(summary) {
  const total = summary.totals.total;
  let selectedMethod = 'cash';
  let cashValue = total === 0 ? '0' : '';

  const cashInput = el('input', {
    class: 'input cash-input',
    id: 'payment-cash-input',
    type: 'number',
    min: '0',
    step: '1',
    inputmode: 'numeric',
    placeholder: '0',
    value: cashValue,
    'aria-label': 'Nominal uang tunai diterima',
    'data-autofocus': 'true'
  });

  const changeBox = el('div', { class: 'change-box' });
  const noncashNote = el('div', { class: 'payment-note' }, [
    icon('info'),
    'Metode non-tunai hanya dicatat sebagai pilihan pembayaran. UsahaPOS tidak memverifikasi pembayaran melalui penyedia QRIS, bank, atau kartu.'
  ]);
  const cashSection = el('div', { class: 'payment-section' }, [
    el('p', { class: 'payment-section-title', text: 'Uang Diterima' }),
    el('div', { class: 'input-prefix cash-input-row' }, [
      el('span', { text: 'Rp' }),
      cashInput
    ]),
    el('div', { class: 'quick-cash' }),
    changeBox
  ]);

  const quickContainer = cashSection.querySelector('.quick-cash');
  const quickCandidates = [{ label: 'Uang pas', value: total }];
  [10_000, 20_000, 50_000, 100_000].forEach((step) => {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total && !quickCandidates.some((candidate) => candidate.value === rounded)) {
      quickCandidates.push({ label: formatCurrency(rounded), value: rounded });
    }
  });
  quickCandidates.slice(0, 5).forEach((candidate) => {
    quickContainer.appendChild(el('button', {
      type: 'button',
      text: candidate.label,
      onClick: () => {
        cashInput.value = String(candidate.value);
        updateCashUI();
      }
    }));
  });

  const methodButtons = new Map();
  const methodGrid = el('div', { class: 'payment-methods', role: 'radiogroup', 'aria-label': 'Metode pembayaran' });
  Object.values(PAYMENT_METHODS).forEach((method) => {
    const button = el('button', {
      class: 'pay-method',
      type: 'button',
      role: 'radio',
      'aria-checked': method.id === selectedMethod ? 'true' : 'false',
      onClick: () => {
        selectedMethod = method.id;
        updateMethodUI();
        updateCashUI();
      }
    }, [
      el('span', { class: 'pay-method-icon' }, icon(method.icon)),
      el('span', { class: 'pay-method-copy' }, [
        el('strong', { text: method.label }),
        el('small', { text: method.description })
      ])
    ]);
    if (method.id === selectedMethod) button.classList.add('active');
    methodButtons.set(method.id, button);
    methodGrid.appendChild(button);
  });

  const content = el('div', {}, [
    el('div', { class: 'payment-total' }, [
      el('span', { text: 'Total pembayaran' }),
      el('strong', { text: formatCurrency(total) })
    ]),
    summary.totals.discount > 0
      ? el('div', { class: 'summary-row', style: { marginTop: '8px' } }, [
        el('span', { text: 'Subtotal setelah diskon' }),
        el('strong', { text: `${formatCurrency(summary.totals.subtotal)} − ${formatCurrency(summary.totals.discount)}` })
      ])
      : null,
    el('div', { class: 'payment-section' }, [
      el('p', { class: 'payment-section-title', text: 'Metode Pembayaran' }),
      methodGrid
    ]),
    cashSection,
    noncashNote
  ]);

  const cancelButton = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Batal' });
  const finishLabel = el('span', { text: 'Selesaikan Pembayaran' });
  const finishButton = el('button', { class: 'btn btn-primary', type: 'button' }, [icon('check'), finishLabel]);
  const footer = el('div', { class: 'modal-footer' }, [cancelButton, finishButton]);

  const modal = openModal({
    title: 'Pembayaran',
    subtitle: 'Periksa total dan pilih metode pembayaran',
    content,
    footer,
    size: 'md',
    closeOnBackdrop: false
  });

  function readCash() {
    const raw = cashInput.value.trim();
    if (!raw) return { value: 0, valid: true, entered: false };
    const number = Number(raw);
    if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0) {
      return { value: 0, valid: false, entered: true };
    }
    return { value: number, valid: true, entered: true };
  }

  function updateChangeBox() {
    const cash = readCash();
    changeBox.className = 'change-box';
    changeBox.replaceChildren();

    if (!cash.entered) {
      changeBox.append(
        el('span', { text: 'Masukkan nominal uang diterima' }),
        el('strong', { text: '—' })
      );
      return;
    }
    if (!cash.valid) {
      changeBox.classList.add('short');
      changeBox.append(
        el('span', { text: 'Nominal tidak valid' }),
        el('strong', { text: '—' })
      );
      return;
    }
    if (cash.value < total) {
      changeBox.classList.add('short');
      changeBox.append(
        el('span', { text: 'Uang masih kurang' }),
        el('strong', { text: formatCurrency(total - cash.value) })
      );
      return;
    }
    changeBox.classList.add('ok');
    changeBox.append(
      el('span', { text: 'Kembalian' }),
      el('strong', { text: formatCurrency(cash.value - total) })
    );
  }

  function updateCashUI() {
    cashValue = cashInput.value;
    if (selectedMethod === 'cash') {
      cashSection.hidden = false;
      noncashNote.hidden = true;
      updateChangeBox();
      const cash = readCash();
      finishButton.disabled = !cash.valid || cash.value < total;
    } else {
      cashSection.hidden = true;
      noncashNote.hidden = false;
      finishButton.disabled = false;
    }
    if (processingPayment) finishButton.disabled = true;
  }

  function updateMethodUI() {
    methodButtons.forEach((button, methodId) => {
      const active = methodId === selectedMethod;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  cashInput.addEventListener('input', updateCashUI);
  cashInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !finishButton.disabled) {
      event.preventDefault();
      finishButton.click();
    }
  });

  cancelButton.addEventListener('click', () => modal.close('cancel'));

  finishButton.addEventListener('click', () => {
    if (processingPayment) return;
    const cash = readCash();
    if (selectedMethod === 'cash' && (!cash.valid || cash.value < total)) return;

    processingPayment = true;
    finishButton.disabled = true;
    finishLabel.textContent = 'Memproses…';

    try {
      const transaction = completeSale({
        paymentMethod: selectedMethod,
        cashReceived: selectedMethod === 'cash' ? cash.value : null
      });
      processingPayment = false;
      modal.close('paid');
      renderCart();
      renderProductGrid();
      closeMobileCart();
      openReceipt(transaction, { context: 'sale' });
    } catch (error) {
      console.error(error);
      processingPayment = false;
      toast(error.message || 'Transaksi gagal disimpan. Keranjang tidak diubah.', 'error');
      finishLabel.textContent = 'Selesaikan Pembayaran';
      updateCashUI();
    }
  });

  updateCashUI();
}

/**
 * Menyimpan transaksi secara atomik. Keranjang baru dikosongkan setelah
 * seluruh data berhasil ditulis.
 */
function completeSale({ paymentMethod, cashReceived }) {
  const discount = parseDiscount(state.discount);
  if (!discount.valid) {
    throw new Error(discount.message);
  }
  if (!state.cart.length) {
    throw new Error('Keranjang kosong. Tambahkan produk terlebih dahulu.');
  }
  if (!PAYMENT_METHODS[paymentMethod]) {
    throw new Error('Metode pembayaran tidak valid.');
  }

  const timestamp = new Date().toISOString();
  let savedTransaction = null;

  runAtomic(() => {
    const products = getProducts().map((product) => ({ ...product }));
    const categories = getCategories();
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
    const items = [];
    const movementsToAdd = [];
    const cartSnapshot = state.cart.map((line) => ({ ...line }));

    cartSnapshot.forEach((line) => {
      const index = products.findIndex((product) => product.id === line.productId);
      if (index < 0) {
        throw new Error('Salah satu produk di keranjang sudah tidak tersedia.');
      }
      const product = products[index];
      if (product.active === false) {
        throw new Error(`Produk "${product.name}" sedang nonaktif dan tidak dapat dijual.`);
      }
      const qty = Number(line.qty);
      if (!Number.isInteger(qty) || qty < 1) {
        throw new Error(`Jumlah produk "${product.name}" tidak valid.`);
      }
      const stockBefore = Math.max(0, Math.floor(Number(product.stock) || 0));
      if (stockBefore < qty) {
        throw new Error(`Stok "${product.name}" tidak mencukupi. Tersedia ${formatNumber(stockBefore)} unit.`);
      }
      const unitPrice = Number(product.sellPrice) || 0;
      const costPrice = Number(product.costPrice) || 0;
      const subtotal = unitPrice * qty;
      const stockAfter = stockBefore - qty;

      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        categoryName: categoryNames.get(product.categoryId) || 'Tanpa Kategori',
        unitPrice,
        costPrice,
        qty,
        subtotal
      });

      products[index] = {
        ...product,
        stock: stockAfter,
        updatedAt: timestamp
      };

      movementsToAdd.push({
        productId: product.id,
        productName: product.name,
        type: 'sale',
        change: -qty,
        stockBefore,
        stockAfter,
        reason: '',
        createdAt: timestamp
      });
    });

    const totals = calcCartTotals(items, discount.value);
    if (totals.discountExceeds) {
      throw new Error(`Diskon melebihi subtotal ${formatCurrency(totals.subtotal)}.`);
    }
    if (items.length === 0) {
      throw new Error('Transaksi tidak memiliki item.');
    }

    let change = 0;
    let received = null;
    if (paymentMethod === 'cash') {
      if (!Number.isInteger(cashReceived) || cashReceived < totals.total) {
        throw new Error('Nominal uang tunai belum mencukupi total pembayaran.');
      }
      received = cashReceived;
      change = received - totals.total;
    }

    const transactions = getTransactions();
    const number = generateTransactionNumber(new Date(timestamp), transactions);
    const transaction = {
      id: uid('trx'),
      number,
      createdAt: timestamp,
      status: 'completed',
      items,
      itemCount: totals.itemCount,
      subtotal: totals.subtotal,
      discount: totals.discount,
      total: totals.total,
      paymentMethod,
      cashReceived: received,
      change,
      cancelledAt: null
    };

    const movements = getMovements();
    const newMovements = movementsToAdd.map((movement) => ({
      id: uid('mov'),
      productId: movement.productId,
      productName: movement.productName,
      type: movement.type,
      change: movement.change,
      stockBefore: movement.stockBefore,
      stockAfter: movement.stockAfter,
      reason: `Penjualan ${number}`,
      referenceId: transaction.id,
      referenceNumber: number,
      createdAt: movement.createdAt
    }));

    saveProducts(products);
    saveTransactions([transaction, ...transactions]);
    saveMovements([...newMovements, ...movements]);
    savedTransaction = transaction;
  });

  if (!savedTransaction) {
    throw new Error('Transaksi gagal disimpan. Data lama telah dipulihkan.');
  }

  state.cart = [];
  state.discount = '';
  emitDataChanged('transactions');
  return savedTransaction;
}

export function renderCashierPage(container, params = {}) {
  const reconciled = reconcileCart(false);
  const products = getProducts();
  const categories = getCategories();
  const activeProducts = products.filter((product) => product.active !== false);
  const activeNames = new Map(categories.map((category) => [category.id, category.name]));

  if (reconciled) {
    toast('Keranjang disesuaikan dengan stok terbaru.', 'info');
  }
  if (state.categoryId !== 'all' && !activeNames.has(state.categoryId)) {
    state.categoryId = 'all';
  }

  const pageHead = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-head-copy' }, [
      el('h2', { text: 'Transaksi Penjualan' }),
      el('p', { text: 'Pilih produk, atur jumlah, lalu selesaikan pembayaran. Stok diperbarui otomatis setelah transaksi berhasil.' })
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('span', { class: 'badge badge-info', text: `${formatNumber(activeProducts.length)} produk aktif` })
    ])
  ]);

  const searchInput = el('input', {
    class: 'input',
    id: 'cashier-search',
    type: 'search',
    placeholder: 'Cari produk berdasarkan nama atau SKU…',
    value: state.search,
    autocomplete: 'off'
  });
  searchInput.addEventListener('input', (event) => {
    state.search = event.target.value;
    renderProductGrid();
  });

  const activeByCategory = new Map();
  activeProducts.forEach((product) => {
    activeByCategory.set(product.categoryId, (activeByCategory.get(product.categoryId) || 0) + 1);
  });

  const chips = el('div', { class: 'category-chips', role: 'group', 'aria-label': 'Filter kategori produk' });
  const allChip = el('button', {
    class: `chip ${state.categoryId === 'all' ? 'active' : ''}`.trim(),
    type: 'button',
    dataset: { categoryId: 'all' }
  }, ['Semua', el('span', { class: 'chip-count', text: formatNumber(activeProducts.length) })]);
  allChip.addEventListener('click', () => {
    state.categoryId = 'all';
    renderProductGrid();
  });
  chips.appendChild(allChip);

  categories.forEach((category) => {
    const count = activeByCategory.get(category.id) || 0;
    const chip = el('button', {
      class: `chip ${state.categoryId === category.id ? 'active' : ''}`.trim(),
      type: 'button',
      dataset: { categoryId: category.id }
    }, [category.name, el('span', { class: 'chip-count', text: formatNumber(count) })]);
    chip.addEventListener('click', () => {
      state.categoryId = category.id;
      renderProductGrid();
    });
    chips.appendChild(chip);
  });

  const toolbar = el('div', { class: 'cashier-toolbar' }, [
    el('div', { class: 'cashier-search-row' }, [
      el('div', { class: 'search-box' }, [icon('search'), searchInput]),
      el('span', { class: 'cashier-result-count', id: 'cashier-result', text: '0 produk' })
    ]),
    chips
  ]);

  const grid = el('div', { class: 'product-grid', id: 'cashier-product-grid' });

  const productColumn = el('div', { class: 'cashier-products' }, [toolbar, grid]);

  const clearButton = el('button', {
    class: 'icon-btn',
    type: 'button',
    id: 'cart-clear',
    title: 'Kosongkan keranjang',
    'aria-label': 'Kosongkan keranjang',
    disabled: true
  }, icon('trash'));
  clearButton.addEventListener('click', clearCart);

  const closeButton = el('button', {
    class: 'icon-btn cart-close-mobile',
    type: 'button',
    id: 'cart-close',
    title: 'Tutup keranjang',
    'aria-label': 'Tutup keranjang'
  }, icon('x'));
  closeButton.addEventListener('click', closeMobileCart);

  const cartPanel = el('aside', {
    class: 'cart-panel',
    id: 'cashier-cart',
    'aria-label': 'Keranjang belanja'
  }, [
    el('div', { class: 'cart-head' }, [
      icon('cart'),
      el('h3', { text: 'Keranjang' }),
      el('span', { class: 'cart-count', id: 'cart-count', text: '0' }),
      el('div', { class: 'cart-head-actions' }, [clearButton, closeButton])
    ]),
    el('div', { class: 'cart-items', id: 'cart-items' }),
    el('div', { class: 'cart-summary', id: 'cart-summary' })
  ]);

  const cartColumn = el('div', { class: 'cashier-cart' }, [cartPanel]);

  const backdrop = el('button', {
    class: 'cart-backdrop',
    id: 'cart-backdrop',
    type: 'button',
    'aria-label': 'Tutup keranjang',
    tabindex: '-1'
  });
  backdrop.addEventListener('click', closeMobileCart);

  const mobileOpen = el('button', {
    class: 'btn btn-primary',
    type: 'button',
    id: 'cart-mobile-open',
    disabled: true
  }, [icon('cart'), 'Lihat Keranjang']);
  mobileOpen.addEventListener('click', openMobileCart);

  const mobileBar = el('div', { class: 'cart-mobile-bar' }, [
    el('div', { class: 'cart-mobile-info' }, [
      el('span', {}, [icon('shopping-bag'), el('span', { id: 'cart-mobile-count', text: 'Keranjang kosong' })]),
      el('strong', { id: 'cart-mobile-total', text: formatCurrency(0) })
    ]),
    mobileOpen
  ]);

  const wrapper = el('div', { class: 'cashier-page-wrap' }, [
    pageHead,
    el('div', { class: 'cashier-layout' }, [productColumn, cartColumn]),
    backdrop,
    mobileBar
  ]);

  container.appendChild(wrapper);
  renderCart();
  renderProductGrid();

  if (params.focusSearch) {
    window.setTimeout(() => searchInput.focus({ preventScroll: true }), 60);
  }
}
