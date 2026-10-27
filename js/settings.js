/**
 * settings.js
 * Pengaturan identitas usaha, format tampilan, cadangan data, impor,
 * pengelolaan data demo, dan reset seluruh data.
 */

import {
  confirmDialog,
  dateKey,
  downloadFile,
  el,
  emitDataChanged,
  emitSettingsChanged,
  formatDateTime,
  formatNumber,
  icon,
  normalizeWhitespace,
  openModal,
  setCurrencyFormat,
  toast
} from './utils.js';
import {
  clearDemoData,
  exportBackup,
  getDataSummary,
  getProducts,
  getSettings,
  getTransactions,
  importBackup,
  isDemoActive,
  resetAllData,
  saveSettings,
  seedDemoData,
  validateBackup
} from './storage.js';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const ESTIMATED_STORAGE_BYTES = 5 * 1024 * 1024;

function settingsSection({ iconName, tone = '', title, subtitle, body }) {
  return el('section', { class: 'card settings-section' }, el('div', { class: 'card-body' }, [
    el('div', { class: 'settings-section-head' }, [
      el('span', { class: `settings-icon ${tone}`.trim() }, icon(iconName)),
      el('div', { class: 'settings-head-copy' }, [
        el('h3', { text: title }),
        el('p', { text: subtitle })
      ])
    ]),
    body
  ]));
}

function createField({ key, label, control, hint = '', full = false, required = false }) {
  const errorId = `${control.id}-error`;
  control.setAttribute('aria-describedby', errorId);
  const error = el('p', { class: 'field-error', id: errorId });
  const node = el('div', { class: `field ${full ? 'full' : ''}`.trim() }, [
    el('label', { for: control.id }, [
      label,
      required ? el('span', { class: 'required', text: ' *' }) : null
    ]),
    control,
    hint ? el('p', { class: 'field-hint', text: hint }) : null,
    error
  ]);
  return { key, node, control, error };
}

function setFieldError(field, message = '') {
  field.node.classList.toggle('invalid', Boolean(message));
  field.error.textContent = message;
  field.control.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function buildIdentitySection(refresh) {
  const settings = getSettings();
  const fields = {};

  const businessInput = el('input', {
    class: 'input',
    id: 'settings-business-name',
    type: 'text',
    value: settings.businessName || '',
    maxlength: '80',
    autocomplete: 'organization',
    'data-autofocus': true
  });
  const ownerInput = el('input', {
    class: 'input',
    id: 'settings-owner-name',
    type: 'text',
    value: settings.ownerName || '',
    maxlength: '80',
    autocomplete: 'name'
  });
  const phoneInput = el('input', {
    class: 'input',
    id: 'settings-phone',
    type: 'tel',
    value: settings.phone || '',
    maxlength: '30',
    autocomplete: 'tel'
  });
  const addressInput = el('textarea', {
    class: 'textarea',
    id: 'settings-address',
    rows: '2',
    maxlength: '160'
  });
  addressInput.value = settings.address || '';
  const receiptInput = el('textarea', {
    class: 'textarea',
    id: 'settings-receipt-message',
    rows: '2',
    maxlength: '160'
  });
  receiptInput.value = settings.receiptMessage || '';
  const minStockInput = el('input', {
    class: 'input',
    id: 'settings-default-min-stock',
    type: 'number',
    min: '0',
    max: '100000',
    step: '1',
    value: String(settings.defaultMinStock ?? 5)
  });

  fields.businessName = createField({
    key: 'businessName',
    label: 'Nama usaha',
    control: businessInput,
    hint: 'Nama ini tampil di header dan struk.',
    required: true
  });
  fields.ownerName = createField({
    key: 'ownerName',
    label: 'Nama pemilik',
    control: ownerInput,
    hint: 'Opsional, ditampilkan sebagai identitas pengelola.'
  });
  fields.phone = createField({
    key: 'phone',
    label: 'Nomor telepon',
    control: phoneInput,
    hint: 'Opsional, tercetak pada struk.'
  });
  fields.address = createField({
    key: 'address',
    label: 'Alamat usaha',
    control: addressInput,
    full: true,
    hint: 'Opsional, tercetak pada struk.'
  });
  fields.receiptMessage = createField({
    key: 'receiptMessage',
    label: 'Pesan pada struk',
    control: receiptInput,
    full: true,
    hint: 'Contoh: Terima kasih telah berbelanja.'
  });
  fields.defaultMinStock = createField({
    key: 'defaultMinStock',
    label: 'Batas minimum stok default',
    control: minStockInput,
    hint: 'Dipakai sebagai nilai awal saat menambahkan produk baru.'
  });

  const currencyCards = el('div', { class: 'radio-cards' }, [
    el('label', { class: 'radio-card' }, [
      el('input', {
        type: 'radio',
        name: 'currencyFormat',
        value: 'nospace',
        checked: settings.currencyFormat !== 'space'
      }),
      el('span', {}, [
        el('strong', { text: 'Tanpa spasi' }),
        el('small', { text: 'Contoh: Rp10.000' })
      ])
    ]),
    el('label', { class: 'radio-card' }, [
      el('input', {
        type: 'radio',
        name: 'currencyFormat',
        value: 'space',
        checked: settings.currencyFormat === 'space'
      }),
      el('span', {}, [
        el('strong', { text: 'Dengan spasi' }),
        el('small', { text: 'Contoh: Rp 10.000' })
      ])
    ])
  ]);

  const currencyField = el('div', { class: 'field full' }, [
    el('span', { class: 'field-label', text: 'Format mata uang' }),
    currencyCards,
    el('p', { class: 'field-hint', text: 'Berlaku pada katalog, keranjang, struk, dan laporan.' })
  ]);

  const saveButton = el('button', {
    class: 'btn btn-primary',
    type: 'submit'
  }, [icon('save'), 'Simpan Pengaturan']);

  const form = el('form', {
    id: 'settings-business-form',
    novalidate: true
  }, [
    el('div', { class: 'form-grid' }, [
      fields.businessName.node,
      fields.ownerName.node,
      fields.phone.node,
      fields.address.node,
      fields.receiptMessage.node,
      el('div', { class: 'form-section full', style: { gridColumn: '1 / -1' } }, [
        el('div', { class: 'form-section-title' }, [icon('sliders'), 'Tampilan & stok']),
        el('div', { class: 'form-grid' }, [
          fields.defaultMinStock.node,
          currencyField
        ])
      ])
    ]),
    el('div', { class: 'settings-save-row' }, [
      el('p', { text: 'Pengaturan disimpan di browser ini. Perubahan langsung dipakai pada transaksi dan struk berikutnya.' }),
      saveButton
    ])
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    Object.values(fields).forEach((field) => setFieldError(field, ''));

    const businessName = normalizeWhitespace(businessInput.value);
    const ownerName = normalizeWhitespace(ownerInput.value);
    const phone = normalizeWhitespace(phoneInput.value);
    const address = normalizeWhitespace(addressInput.value);
    const receiptMessage = receiptInput.value.trim();
    const minStockRaw = minStockInput.value.trim();
    const minStock = Number(minStockRaw);

    if (!businessName) {
      setFieldError(fields.businessName, 'Nama usaha wajib diisi.');
    } else if (businessName.length > 80) {
      setFieldError(fields.businessName, 'Nama usaha maksimal 80 karakter.');
    }
    if (ownerName.length > 80) {
      setFieldError(fields.ownerName, 'Nama pemilik maksimal 80 karakter.');
    }
    if (phone.length > 30) {
      setFieldError(fields.phone, 'Nomor telepon maksimal 30 karakter.');
    }
    if (address.length > 160) {
      setFieldError(fields.address, 'Alamat maksimal 160 karakter.');
    }
    if (receiptMessage.length > 160) {
      setFieldError(fields.receiptMessage, 'Pesan struk maksimal 160 karakter.');
    }
    if (!minStockRaw || !Number.isInteger(minStock) || minStock < 0 || minStock > 100000) {
      setFieldError(fields.defaultMinStock, 'Isi bilangan bulat antara 0 dan 100.000.');
    }

    const firstInvalid = Object.values(fields).find((field) => field.node.classList.contains('invalid'));
    if (firstInvalid) {
      toast('Periksa kembali isian yang ditandai merah.', 'warning');
      firstInvalid.control.focus();
      return;
    }

    const currencyFormat = form.querySelector('input[name="currencyFormat"]:checked')?.value || 'nospace';

    try {
      const saved = saveSettings({
        businessName,
        ownerName,
        phone,
        address,
        receiptMessage,
        defaultMinStock: minStock,
        currencyFormat
      });
      setCurrencyFormat(saved.currencyFormat);
      businessInput.value = saved.businessName;
      ownerInput.value = saved.ownerName;
      phoneInput.value = saved.phone;
      addressInput.value = saved.address;
      receiptInput.value = saved.receiptMessage;
      minStockInput.value = String(saved.defaultMinStock);
      form.querySelectorAll('input[name="currencyFormat"]').forEach((input) => {
        input.checked = input.value === saved.currencyFormat;
      });
      emitSettingsChanged();
      emitDataChanged('settings');
      toast('Identitas dan preferensi usaha berhasil disimpan.', 'success');
      refresh();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Pengaturan gagal disimpan.', 'error');
    }
  });

  return settingsSection({
    iconName: 'store',
    tone: 'blue',
    title: 'Identitas usaha',
    subtitle: 'Lengkapi informasi yang tampil pada header, struk, dan laporan.',
    body: form
  });
}

function openImportError(title, message, details = []) {
  const content = el('div', {}, [
    el('div', { class: 'form-note danger' }, [icon('alert-triangle'), message]),
    details.length
      ? el('ul', { class: 'error-list' }, details.map((detail) => el('li', { text: detail })))
      : null
  ]);
  const closeButton = el('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: 'Tutup'
  });
  const modal = openModal({
    title,
    content,
    footer: el('div', { class: 'modal-footer' }, closeButton),
    size: 'sm'
  });
  closeButton.addEventListener('click', () => modal.close('close'));
}

function importResultMessage(result) {
  const added = result.added || {};
  const skipped = result.skipped || {};
  if (result.mode === 'replace') {
    return `Data diganti: ${formatNumber(added.categories)} kategori, ${formatNumber(added.products)} produk, ${formatNumber(added.transactions)} transaksi, dan ${formatNumber(added.movements)} pergerakan stok.`;
  }
  const skippedTotal = (skipped.products || 0) + (skipped.transactions || 0) + (skipped.movements || 0);
  return `Impor selesai. Ditambahkan ${formatNumber(added.products)} produk, ${formatNumber(added.transactions)} transaksi, dan ${formatNumber(added.movements)} pergerakan stok.${skippedTotal ? ` ${formatNumber(skippedTotal)} data duplikat dilewati.` : ''}`;
}

function openImportPreview({ payload, validation, filename, refresh }) {
  const fileMeta = el('div', { class: 'import-file-meta' }, [
    el('strong', { text: filename }),
    el('span', {
      style: { display: 'block', marginTop: '3px' },
      text: validation.summary?.exportedAt
        ? `Diekspor ${formatDateTime(validation.summary.exportedAt)} • versi ${validation.summary.version}`
        : 'Tanggal ekspor tidak tercatat pada file ini.'
    })
  ]);

  if (!validation.ok) {
    const content = el('div', {}, [
      fileMeta,
      el('div', { class: 'form-note danger', style: { marginTop: '12px' } }, [
        icon('alert-triangle'),
        'File tidak dapat diimpor. Data lama tidak akan diubah.'
      ]),
      el('ul', { class: 'error-list' }, validation.errors.map((error) => el('li', { text: error })))
    ]);
    const closeButton = el('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: 'Tutup'
    });
    const modal = openModal({
      title: 'File impor tidak valid',
      subtitle: filename,
      content,
      footer: el('div', { class: 'modal-footer' }, closeButton),
      size: 'md'
    });
    closeButton.addEventListener('click', () => modal.close('close'));
    return;
  }

  const summary = validation.summary;
  const summaryGrid = el('div', { class: 'import-summary-grid' }, [
    ['Kategori', summary.categories],
    ['Produk', summary.products],
    ['Transaksi', summary.transactions],
    ['Pergerakan stok', summary.movements]
  ].map(([label, value]) => el('div', { class: 'import-summary-item' }, [
    el('span', { text: label }),
    el('strong', { text: formatNumber(value) })
  ])));

  const mergeRadio = el('input', {
    type: 'radio',
    name: 'import-mode',
    value: 'merge',
    checked: true
  });
  const replaceRadio = el('input', {
    type: 'radio',
    name: 'import-mode',
    value: 'replace'
  });

  const replaceNote = el('div', {
    class: 'form-note warning',
    style: { display: 'none', marginTop: '12px' }
  }, [
    icon('alert-triangle'),
    'Mode ganti akan menghapus seluruh data yang sedang tersimpan, lalu memakai isi file. Pengaturan dari file juga akan diterapkan.'
  ]);

  const modeWrap = el('div', { class: 'import-mode' }, [
    el('label', { class: 'radio-card' }, [
      mergeRadio,
      el('span', {}, [
        el('strong', { text: 'Gabungkan data (disarankan)' }),
        el('small', { text: 'Data baru ditambahkan. Produk dengan SKU sama dan transaksi dengan nomor sama dilewati. Pengaturan saat ini dipertahankan.' })
      ])
    ]),
    el('label', { class: 'radio-card' }, [
      replaceRadio,
      el('span', {}, [
        el('strong', { text: 'Ganti seluruh data' }),
        el('small', { text: 'Semua data saat ini diganti dengan isi file. Cocok untuk memulihkan cadangan penuh.' })
      ])
    ]),
    replaceNote
  ]);

  const modeInputs = [mergeRadio, replaceRadio];
  modeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      replaceNote.style.display = replaceRadio.checked ? 'flex' : 'none';
    });
  });

  const cancelButton = el('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: 'Batal'
  });
  const importButton = el('button', {
    class: 'btn btn-primary',
    type: 'button'
  }, [icon('upload'), 'Impor Data']);

  const content = el('div', {}, [
    fileMeta,
    el('div', { class: 'form-note', style: { marginTop: '12px' } }, [
      icon('check-circle'),
      'File backup valid. Periksa ringkasan berikut sebelum melanjutkan.'
    ]),
    summaryGrid,
    modeWrap
  ]);

  const modal = openModal({
    title: 'Pratinjau impor data',
    subtitle: filename,
    content,
    footer: el('div', { class: 'modal-footer' }, [cancelButton, importButton]),
    size: 'md'
  });

  cancelButton.addEventListener('click', () => modal.close('cancel'));

  let busy = false;

  importButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true;

    const mode = replaceRadio.checked ? 'replace' : 'merge';
    if (mode === 'replace') {
      const confirmed = await confirmDialog({
        title: 'Ganti seluruh data?',
        message: 'Seluruh produk, kategori, transaksi, pergerakan stok, dan pengaturan saat ini akan diganti dengan isi file.',
        details: [
          'Tindakan ini tidak dapat dibatalkan setelah dijalankan.',
          'Unduh cadangan data saat ini terlebih dahulu bila masih diperlukan.'
        ],
        confirmLabel: 'Ganti Semua Data',
        danger: true,
        verifyText: 'GANTI',
        verifyHint: 'Ketik GANTI dengan huruf kapital untuk melanjutkan.'
      });
      if (!confirmed) {
        busy = false;
        return;
      }
    }

    importButton.disabled = true;
    importButton.replaceChildren(icon('clock'), document.createTextNode('Mengimpor…'));

    try {
      const result = importBackup(payload, mode);
      const currentSettings = getSettings();
      setCurrencyFormat(currentSettings.currencyFormat);
      busy = false;
      modal.close('imported');
      emitDataChanged('all');
      emitSettingsChanged();
      refresh();
      toast(importResultMessage(result), 'success', 'Impor selesai');
    } catch (error) {
      console.error(error);
      busy = false;
      importButton.disabled = false;
      importButton.replaceChildren(icon('upload'), document.createTextNode('Impor Data'));
      const details = Array.isArray(error.details) ? error.details : [];
      toast(details[0] || error.message || 'Impor gagal. Data lama tidak diubah.', 'error');
    }
  });
}

function buildDataSection(refresh) {
  const summary = getDataSummary();
  const usagePercent = Math.max(0, Math.min(100, (summary.bytes / ESTIMATED_STORAGE_BYTES) * 100));

  const note = el('div', { class: 'settings-note' }, [
    icon('alert-triangle'),
    'Semua data tersimpan di LocalStorage browser ini, bukan di server. Menghapus data situs, memakai mode privat, atau berpindah browser dapat menghilangkan data. Unduh cadangan secara berkala.'
  ]);

  const summaryGrid = el('div', { class: 'import-summary-grid' }, [
    ['Produk', summary.products],
    ['Kategori', summary.categories],
    ['Transaksi', summary.transactions],
    ['Pergerakan stok', summary.movements]
  ].map(([label, value]) => el('div', { class: 'import-summary-item' }, [
    el('span', { text: label }),
    el('strong', { text: formatNumber(value) })
  ])));

  const storageUsage = el('div', { class: 'storage-usage' }, [
    el('div', { class: 'storage-usage-head' }, [
      el('span', { text: 'Perkiraan penggunaan penyimpanan' }),
      el('strong', { text: `${formatNumber(summary.kilobytes)} KB` })
    ]),
    el('div', {
      class: 'storage-meter',
      role: 'progressbar',
      'aria-label': 'Perkiraan penggunaan LocalStorage',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(Math.round(usagePercent))
    }, el('div', { style: { width: `${Math.max(usagePercent, summary.bytes > 0 ? 1 : 0)}%` } })),
    el('p', {
      class: 'field-hint',
      style: { marginTop: '6px' },
      text: 'Kapasitas LocalStorage umumnya sekitar 5 MB per browser.'
    })
  ]);

  const exportButton = el('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    onClick: () => {
      try {
        const backup = exportBackup();
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const filename = `usahapos-backup-${dateKey(now)}-${time}.json`;
        downloadFile(filename, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
        toast('Berkas cadangan JSON dibuat dan diunduh melalui browser Anda.', 'success', 'Ekspor data');
      } catch (error) {
        console.error(error);
        toast(error.message || 'Berkas cadangan gagal dibuat.', 'error');
      }
    }
  }, [icon('download'), 'Unduh Backup']);

  const fileInput = el('input', {
    class: 'visually-hidden',
    id: 'settings-import-file',
    type: 'file',
    accept: '.json,application/json'
  });
  const importButton = el('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    onClick: () => fileInput.click()
  }, [icon('upload'), 'Pilih File JSON']);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      openImportError(
        'Berkas terlalu besar',
        'Ukuran berkas melebihi batas 10 MB. Pilih berkas cadangan UsahaPOS yang lebih kecil.'
      );
      return;
    }

    let payload;
    try {
      const text = await file.text();
      payload = JSON.parse(text);
    } catch (error) {
      openImportError(
        'JSON tidak dapat dibaca',
        'Berkas yang dipilih bukan JSON yang valid. Data lama tidak diubah.'
      );
      return;
    }

    let validation;
    try {
      validation = validateBackup(payload);
    } catch (error) {
      console.error(error);
      openImportError(
        'Validasi gagal',
        error.message || 'Berkas tidak dapat divalidasi. Data lama tidak diubah.'
      );
      return;
    }

    openImportPreview({ payload, validation, filename: file.name, refresh });
  });

  const actions = el('div', { class: 'settings-data-grid' }, [
    el('div', { class: 'data-action' }, [
      el('span', { class: 'data-action-icon' }, icon('download')),
      el('div', { class: 'data-action-copy' }, [
        el('strong', { text: 'Ekspor cadangan' }),
        el('p', { text: 'Unduh seluruh produk, transaksi, pergerakan stok, dan pengaturan dalam satu file JSON.' }),
        exportButton
      ])
    ]),
    el('div', { class: 'data-action' }, [
      el('span', { class: 'data-action-icon' }, icon('upload')),
      el('div', { class: 'data-action-copy' }, [
        el('strong', { text: 'Impor cadangan' }),
        el('p', { text: 'Pulihkan data dari file backup UsahaPOS. Anda dapat menggabungkan atau mengganti data.' }),
        importButton
      ])
    ])
  ]);

  return settingsSection({
    iconName: 'database',
    tone: 'green',
    title: 'Data & cadangan',
    subtitle: 'Pantau penggunaan penyimpanan, ekspor cadangan, atau pulihkan data dari file.',
    body: el('div', {}, [note, summaryGrid, storageUsage, actions, fileInput])
  });
}

function buildDemoAndResetSection(refresh) {
  const demoActive = isDemoActive();
  const products = getProducts();
  const transactions = getTransactions();
  const hasBusinessData = products.length > 0 || transactions.length > 0;

  const status = el('div', { class: `demo-status ${demoActive ? 'active' : ''}`.trim() }, [
    el('span', { class: `status-dot ${demoActive ? 'green' : ''}`.trim() }),
    demoActive
      ? 'Data demo aktif. Produk dan transaksi contoh dapat dihapus kapan saja.'
      : 'Data demo tidak aktif. Aplikasi memakai data usaha Anda sendiri.'
  ]);

  const loadButton = el('button', {
    class: 'btn btn-secondary',
    type: 'button'
  }, [icon('database'), 'Muat Data Demo']);

  loadButton.addEventListener('click', () => {
    if (hasBusinessData) {
      toast(
        'Data demo hanya dapat dimuat saat belum ada produk dan transaksi. Reset semua data terlebih dahulu.',
        'warning'
      );
      return;
    }
    confirmDialog({
      title: 'Muat data demo?',
      message: 'Produk, kategori, transaksi, dan pergerakan stok contoh akan dimuat ke aplikasi.',
      details: [
        'Data demo membantu mencoba seluruh fitur tanpa membuat data dari awal.',
        'Identitas dan pengaturan usaha Anda saat ini akan dipertahankan.'
      ],
      confirmLabel: 'Muat Data Demo'
    }).then((confirmed) => {
      if (!confirmed) return;
      try {
        seedDemoData({ keepSettings: true });
        setCurrencyFormat(getSettings().currencyFormat);
        emitDataChanged('all');
        refresh();
        toast('Data demo berhasil dimuat.', 'success');
      } catch (error) {
        console.error(error);
        toast(error.message || 'Data demo gagal dimuat.', 'error');
      }
    });
  });

  const removeButton = demoActive
    ? el('button', {
      class: 'btn btn-danger-soft',
      type: 'button',
      onClick: () => {
        confirmDialog({
          title: 'Hapus data demo?',
          message: 'Transaksi dan pergerakan stok demo akan dihapus dari aplikasi.',
          details: [
            'Produk demo yang belum dipakai pada data Anda akan dihapus.',
            'Produk demo yang masih direferensikan transaksi Anda akan dipertahankan.'
          ],
          confirmLabel: 'Hapus Data Demo',
          danger: true
        }).then((confirmed) => {
          if (!confirmed) return;
          try {
            const result = clearDemoData();
            emitDataChanged('all');
            refresh();
            toast(
              `Data demo dihapus: ${formatNumber(result.removedProducts)} produk, ${formatNumber(result.removedTransactions)} transaksi, ${formatNumber(result.removedMovements)} pergerakan stok.`,
              'success'
            );
          } catch (error) {
            console.error(error);
            toast(error.message || 'Data demo gagal dihapus.', 'error');
          }
        });
      }
    }, [icon('trash'), 'Hapus Data Demo'])
    : null;

  const demoActions = el('div', { class: 'settings-actions' }, [loadButton, removeButton]);

  const resetButton = el('button', {
    class: 'btn btn-danger',
    type: 'button'
  }, [icon('rotate-ccw'), 'Reset Semua Data']);

  resetButton.addEventListener('click', () => {
    confirmDialog({
      title: 'Reset seluruh data?',
      message: 'Semua data usaha akan dihapus permanen dari browser ini.',
      details: [
        'Produk, kategori, transaksi, pergerakan stok, dan pengaturan akan dikembalikan ke kondisi awal.',
        'Data demo juga tidak akan dimuat ulang otomatis.',
        'Tindakan ini tidak dapat dibatalkan. Unduh cadangan terlebih dahulu bila perlu.'
      ],
      confirmLabel: 'Reset Semua Data',
      danger: true,
      verifyText: 'RESET',
      verifyHint: 'Ketik RESET dengan huruf kapital untuk melanjutkan.'
    }).then((confirmed) => {
      if (!confirmed) return;
      try {
        resetAllData();
        setCurrencyFormat(getSettings().currencyFormat);
        emitDataChanged('all');
        emitSettingsChanged();
        refresh();
        toast('Seluruh data telah direset. Aplikasi kembali ke kondisi awal tanpa data demo.', 'success');
      } catch (error) {
        console.error(error);
        toast(error.message || 'Data gagal direset. Tidak ada perubahan yang disimpan.', 'error');
      }
    });
  });

  const dangerZone = el('div', { class: 'danger-zone' }, [
    el('div', { class: 'danger-zone-head' }, [icon('alert-triangle'), 'Zona berbahaya']),
    el('div', { class: 'danger-zone-body' }, [
      el('p', {
        text: 'Reset menghapus seluruh data di browser ini dan tidak memuat data demo kembali secara otomatis. Unduh cadangan sebelum melanjutkan.'
      }),
      resetButton
    ])
  ]);

  const description = el('p', {
    style: { fontSize: '11.5px', color: 'var(--gray-500)', lineHeight: '1.55', marginBottom: '12px' },
    text: 'Gunakan data demo untuk melihat contoh transaksi dan laporan. Data demo hanya dimuat saat belum ada produk atau transaksi sehingga tidak menimpa data usaha Anda.'
  });

  return settingsSection({
    iconName: 'database',
    tone: 'amber',
    title: 'Data demo & reset',
    subtitle: 'Muat contoh data untuk mencoba aplikasi, atau bersihkan seluruh data secara permanen.',
    body: el('div', {}, [
      status,
      description,
      demoActions,
      el('div', { class: 'divider' }),
      dangerZone
    ])
  });
}

export function renderSettingsPage(container) {
  container.replaceChildren();
  const refresh = () => {
    try {
      renderSettingsPage(container);
    } catch (error) {
      console.error('UsahaPOS — pengaturan gagal dimuat ulang:', error);
    }
  };

  const pageHead = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-head-copy' }, [
      el('h2', { text: 'Pengaturan' }),
      el('p', { text: 'Atur identitas usaha, preferensi tampilan, dan kelola data yang tersimpan di browser ini.' })
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('span', { class: 'badge badge-neutral' }, [icon('hard-drive'), 'Penyimpanan lokal'])
    ])
  ]);

  const layout = el('div', { class: 'settings-layout' }, [
    buildIdentitySection(refresh),
    buildDataSection(refresh),
    buildDemoAndResetSection(refresh)
  ]);

  container.append(pageHead, layout);
}
