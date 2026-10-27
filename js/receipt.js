/**
 * receipt.js
 * Menampilkan struk transaksi dan menyediakan aksi cetak, transaksi baru,
 * serta membuka detail transaksi.
 */

import {
  PAYMENT_METHODS,
  el,
  formatCurrency,
  formatDateTime,
  formatNumber,
  icon,
  openModal
} from './utils.js';
import { getSettings } from './storage.js';
import { navigate } from './router.js';

function receiptMetaRow(label, value) {
  return el('div', { class: 'receipt-meta' }, [
    el('span', { text: label }),
    el('span', { text: value })
  ]);
}

function buildReceipt(transaction) {
  const settings = getSettings();
  const method = PAYMENT_METHODS[transaction.paymentMethod] || PAYMENT_METHODS.cash;
  const cancelled = transaction.status === 'cancelled';
  const items = Array.isArray(transaction.items) ? transaction.items : [];

  const head = el('div', { class: 'receipt-head' }, [
    el('h3', { text: settings.businessName || 'UsahaPOS' }),
    settings.address ? el('p', { text: settings.address }) : null,
    settings.phone ? el('p', { text: settings.phone }) : null
  ]);

  const meta = el('div', {}, [
    receiptMetaRow('No. Transaksi', transaction.number),
    receiptMetaRow('Waktu', formatDateTime(transaction.createdAt)),
    receiptMetaRow('Status', cancelled ? 'DIBATALKAN' : 'Selesai')
  ]);

  const itemsBlock = el('div', { class: 'receipt-items' });
  items.forEach((item) => {
    itemsBlock.appendChild(el('div', {}, [
      el('div', { class: 'receipt-item-name', text: item.name }),
      el('div', { class: 'receipt-item-row' }, [
        el('span', { text: `${formatNumber(item.qty)} × ${formatCurrency(item.unitPrice)}` }),
        el('span', { text: formatCurrency(item.subtotal) })
      ])
    ]));
  });

  const totals = el('div', { class: 'receipt-totals' }, [
    el('div', { class: 'receipt-total-row' }, [
      el('span', { text: 'Subtotal' }),
      el('span', { text: formatCurrency(transaction.subtotal) })
    ]),
    transaction.discount > 0
      ? el('div', { class: 'receipt-total-row' }, [
        el('span', { text: 'Diskon' }),
        el('span', { text: `− ${formatCurrency(transaction.discount)}` })
      ])
      : null,
    el('div', { class: 'receipt-total-row grand' }, [
      el('span', { text: 'TOTAL' }),
      el('span', { text: formatCurrency(transaction.total) })
    ]),
    el('div', { class: 'receipt-total-row' }, [
      el('span', { text: 'Metode' }),
      el('span', { text: method.label })
    ]),
    transaction.paymentMethod === 'cash'
      ? el('div', {}, [
        el('div', { class: 'receipt-total-row' }, [
          el('span', { text: 'Tunai diterima' }),
          el('span', { text: formatCurrency(transaction.cashReceived) })
        ]),
        el('div', { class: 'receipt-total-row' }, [
          el('span', { text: 'Kembalian' }),
          el('span', { text: formatCurrency(transaction.change) })
        ])
      ])
      : null
  ]);

  return el('div', { class: 'receipt', id: 'print-receipt' }, [
    head,
    el('hr', { class: 'receipt-divider' }),
    meta,
    el('hr', { class: 'receipt-divider' }),
    itemsBlock,
    el('hr', { class: 'receipt-divider' }),
    totals,
    cancelled ? el('div', { class: 'receipt-stamp', text: 'Transaksi Dibatalkan' }) : null,
    el('p', { class: 'receipt-message', text: settings.receiptMessage || 'Terima kasih atas kunjungan Anda!' }),
    el('p', { class: 'receipt-thanks', text: 'Struk dibuat oleh UsahaPOS' })
  ]);
}

/**
 * Buka struk. `context` = 'sale' untuk struk setelah pembayaran,
 * atau 'reprint' untuk cetak ulang dari riwayat.
 */
export function openReceipt(transaction, options = {}) {
  if (!transaction) return;
  const context = options.context === 'reprint' ? 'reprint' : 'sale';
  const cancelled = transaction.status === 'cancelled';

  const content = el('div', {}, [
    context === 'sale' && !cancelled
      ? el('div', {
        class: 'form-note',
        style: { marginBottom: '14px', justifyContent: 'center' }
      }, [icon('check-circle'), 'Transaksi berhasil disimpan. Stok sudah diperbarui.'])
      : null,
    buildReceipt(transaction),
    el('p', {
      class: 'receipt-actions-note',
      text: 'Gunakan tombol Cetak Struk untuk membuka dialog cetak browser. Percetakan tetap dilakukan melalui perangkat Anda.'
    })
  ]);

  const detailButton = el('button', {
    class: 'btn btn-ghost',
    type: 'button'
  }, [icon('eye'), 'Lihat Detail']);
  const newButton = el('button', {
    class: 'btn btn-secondary',
    type: 'button'
  }, [icon('cart'), 'Transaksi Baru']);
  const printButton = el('button', {
    class: 'btn btn-primary',
    type: 'button'
  }, [icon('printer'), 'Cetak Struk']);

  const footer = el('div', { class: 'modal-footer spread' }, [
    el('div', { class: 'footer-left' }, [detailButton]),
    el('div', { class: 'footer-left', style: { marginLeft: 'auto', marginRight: '0' } }, [newButton, printButton])
  ]);

  const modal = openModal({
    title: context === 'sale' && !cancelled ? 'Transaksi Berhasil' : (cancelled ? 'Struk Dibatalkan' : 'Struk Transaksi'),
    subtitle: `${transaction.number} • ${formatDateTime(transaction.createdAt)}`,
    content,
    footer,
    size: 'sm',
    overlayClass: 'receipt-overlay',
    panelClass: 'receipt-modal',
    closeOnBackdrop: false
  });

  printButton.addEventListener('click', () => {
    window.print();
  });

  newButton.addEventListener('click', () => {
    modal.close('new-transaction');
    document.dispatchEvent(new CustomEvent('usahapos:newtransaction'));
    navigate('cashier', { focusSearch: true });
  });

  detailButton.addEventListener('click', () => {
    modal.close('detail');
    navigate('transactions', { openId: transaction.id });
  });

  return modal;
}
