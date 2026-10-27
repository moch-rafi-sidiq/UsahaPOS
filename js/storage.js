/**
 * storage.js
 * Satu pintu untuk penyimpanan LocalStorage, validasi struktur, data demo,
 * ekspor/impor, serta operasi tulis yang aman (rollback).
 */

import { dateKey, deepClone, normalizeKey, normalizeWhitespace, setCurrencyFormat, uid } from './utils.js';
import { createDemoData } from './demo-data.js';

export const STORAGE_PREFIX = 'usahapos:v1:';
export const STORAGE_VERSION = 1;
export const BACKUP_FORMAT = 'usahapos-backup';

export const STORAGE_KEYS = {
  categories: `${STORAGE_PREFIX}categories`,
  products: `${STORAGE_PREFIX}products`,
  transactions: `${STORAGE_PREFIX}transactions`,
  movements: `${STORAGE_PREFIX}stock_movements`,
  settings: `${STORAGE_PREFIX}settings`,
  meta: `${STORAGE_PREFIX}meta`
};

export const DATA_KEYS = [
  STORAGE_KEYS.categories,
  STORAGE_KEYS.products,
  STORAGE_KEYS.transactions,
  STORAGE_KEYS.movements,
  STORAGE_KEYS.settings
];

export const DEFAULT_SETTINGS = Object.freeze({
  businessName: 'UsahaPOS',
  ownerName: '',
  address: '',
  phone: '',
  receiptMessage: 'Terima kasih atas kunjungan Anda!',
  currencyFormat: 'nospace',
  defaultMinStock: 5
});

export const DEMO_SETTINGS = Object.freeze({
  businessName: 'Warung Sumber Rejeki',
  ownerName: 'Sari',
  address: 'Jl. Melati No. 12, Bandung',
  phone: '0812-3456-7890',
  receiptMessage: 'Terima kasih sudah berbelanja. Sampai jumpa lagi!',
  currencyFormat: 'nospace',
  defaultMinStock: 5
});

const DEFAULT_CATEGORY_DEFS = [
  { id: 'cat_makanan', name: 'Makanan' },
  { id: 'cat_minuman', name: 'Minuman' },
  { id: 'cat_sembako', name: 'Sembako' },
  { id: 'cat_perlengkapan', name: 'Perlengkapan' },
  { id: 'cat_lainnya', name: 'Lainnya' }
];

export const FALLBACK_CATEGORY_NAME = 'Lainnya';

export class StorageError extends Error {
  constructor(message, code = 'storage_error', details = null) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.details = details;
  }
}

/* ==========================================================================
   Dasar-dasar akses LocalStorage
   ========================================================================== */

export function isStorageAvailable() {
  try {
    const testKey = `${STORAGE_PREFIX}__test__`;
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function requireStorage() {
  if (!isStorageAvailable()) {
    throw new StorageError(
      'Penyimpanan lokal (LocalStorage) tidak tersedia atau diblokir. Aplikasi tidak dapat menyimpan data.',
      'storage_unavailable'
    );
  }
}

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    throw new StorageError('Gagal membaca penyimpanan lokal. Periksa pengaturan privasi browser.', 'storage_read_failed');
  }
}

function writeRaw(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    const message = error && (error.name === 'QuotaExceededError' || error.code === 22)
      ? 'Penyimpanan browser penuh. Ekspor data lalu hapus sebagian data lama.'
      : 'Gagal menyimpan data ke penyimpanan lokal browser.';
    throw new StorageError(message, 'storage_write_failed', error);
  }
}

function readJSON(key, fallback) {
  const raw = readRaw(key);
  if (raw === null || raw === undefined) return deepClone(fallback);
  try {
    return JSON.parse(raw);
  } catch {
    throw new StorageError(`Data pada penyimpanan (${key.replace(STORAGE_PREFIX, '')}) rusak dan tidak dapat dibaca.`, 'storage_corrupt');
  }
}

function writeJSON(key, value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new StorageError('Data tidak dapat diubah menjadi JSON yang valid.', 'serialize_failed');
  }
  writeRaw(key, serialized);
}

function readCollection(key) {
  const value = readJSON(key, []);
  if (!Array.isArray(value)) {
    throw new StorageError('Struktur data pada penyimpanan tidak valid (seharusnya berupa daftar).', 'storage_shape_invalid');
  }
  return value;
}

function writeCollection(key, value) {
  if (!Array.isArray(value)) {
    throw new StorageError('Gagal menyimpan: data harus berupa daftar.', 'invalid_collection');
  }
  writeJSON(key, value);
}

function nowIso() {
  return new Date().toISOString();
}

/* ==========================================================================
   Pembaca & penulis per koleksi
   ========================================================================== */

export function getCategories() {
  return readCollection(STORAGE_KEYS.categories);
}

export function saveCategories(categories) {
  writeCollection(STORAGE_KEYS.categories, categories);
}

export function getProducts() {
  return readCollection(STORAGE_KEYS.products);
}

export function saveProducts(products) {
  writeCollection(STORAGE_KEYS.products, products);
}

export function getTransactions() {
  return readCollection(STORAGE_KEYS.transactions);
}

export function saveTransactions(transactions) {
  writeCollection(STORAGE_KEYS.transactions, transactions);
}

export function getMovements() {
  return readCollection(STORAGE_KEYS.movements);
}

export function saveMovements(movements) {
  writeCollection(STORAGE_KEYS.movements, movements);
}

export function getSettings() {
  const raw = readJSON(STORAGE_KEYS.settings, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS };
  }
  return normalizeSettingsObject(raw);
}

export function saveSettings(settings) {
  const normalized = normalizeSettingsObject(settings);
  writeJSON(STORAGE_KEYS.settings, normalized);
  setCurrencyFormat(normalized.currencyFormat);
  return normalized;
}

export function getMeta() {
  const raw = readJSON(STORAGE_KEYS.meta, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      initialized: false,
      schemaVersion: STORAGE_VERSION,
      createdAt: null,
      updatedAt: null,
      demoSeeded: false,
      demo: null
    };
  }
  return {
    initialized: raw.initialized === true,
    schemaVersion: Number(raw.schemaVersion) || STORAGE_VERSION,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    demoSeeded: raw.demoSeeded === true,
    demo: raw.demo && typeof raw.demo === 'object' ? raw.demo : null,
    lastImportAt: raw.lastImportAt || null,
    lastResetAt: raw.lastResetAt || null,
    lastDemoRemovedAt: raw.lastDemoRemovedAt || null
  };
}

export function saveMeta(meta) {
  writeJSON(STORAGE_KEYS.meta, {
    initialized: meta.initialized === true,
    schemaVersion: STORAGE_VERSION,
    createdAt: meta.createdAt || nowIso(),
    updatedAt: nowIso(),
    demoSeeded: meta.demoSeeded === true,
    demo: meta.demo || null,
    lastImportAt: meta.lastImportAt || null,
    lastResetAt: meta.lastResetAt || null,
    lastDemoRemovedAt: meta.lastDemoRemovedAt || null
  });
}

export function isDemoActive() {
  const meta = getMeta();
  return meta.demoSeeded && Boolean(meta.demo);
}

function normalizeSettingsObject(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const cleanString = (value, fallback = '') => (typeof value === 'string' ? value : fallback);
  const businessName = normalizeWhitespace(cleanString(source.businessName, DEFAULT_SETTINGS.businessName));
  const defaultMinStock = Number(source.defaultMinStock);
  return {
    businessName: businessName || DEFAULT_SETTINGS.businessName,
    ownerName: normalizeWhitespace(cleanString(source.ownerName, DEFAULT_SETTINGS.ownerName)),
    address: normalizeWhitespace(cleanString(source.address, DEFAULT_SETTINGS.address)),
    phone: normalizeWhitespace(cleanString(source.phone, DEFAULT_SETTINGS.phone)),
    receiptMessage: cleanString(source.receiptMessage, DEFAULT_SETTINGS.receiptMessage).trim(),
    currencyFormat: source.currencyFormat === 'space' ? 'space' : 'nospace',
    defaultMinStock: Number.isInteger(defaultMinStock) && defaultMinStock >= 0 ? defaultMinStock : DEFAULT_SETTINGS.defaultMinStock
  };
}

/* ==========================================================================
   Operasi atomik (rollback jika penyimpanan gagal)
   ========================================================================== */

export function createSnapshot() {
  const snapshot = {};
  Object.values(STORAGE_KEYS).forEach((key) => {
    try {
      snapshot[key] = localStorage.getItem(key);
    } catch {
      snapshot[key] = null;
    }
  });
  return snapshot;
}

export function restoreSnapshot(snapshot) {
  let restoreFailed = false;
  Object.entries(snapshot || {}).forEach(([key, raw]) => {
    try {
      if (raw === null) localStorage.removeItem(key);
      else localStorage.setItem(key, raw);
    } catch {
      restoreFailed = true;
    }
  });
  return !restoreFailed;
}

/**
 * Menjalankan serangkaian perubahan. Jika satu penulisan gagal,
 * seluruh data dikembalikan ke kondisi sebelum operasi.
 */
export function runAtomic(operation) {
  requireStorage();
  const snapshot = createSnapshot();
  try {
    return operation();
  } catch (error) {
    const restored = restoreSnapshot(snapshot);
    if (!restored) {
      error.message = `${error.message} Pemulihan data otomatis juga gagal — segera ekspor data yang masih dapat dibaca.`;
    }
    throw error;
  }
}

/* ==========================================================================
   Inisialisasi & data demo
   ========================================================================== */

function makeDefaultCategories() {
  const timestamp = nowIso();
  return DEFAULT_CATEGORY_DEFS.map((category) => ({
    id: category.id,
    name: category.name,
    createdAt: timestamp,
    updatedAt: timestamp
  }));
}

export function findFallbackCategory(categories) {
  const list = Array.isArray(categories) ? categories : [];
  return list.find((category) => normalizeKey(category.name) === normalizeKey(FALLBACK_CATEGORY_NAME)) || null;
}

export function ensureFallbackCategory(categories) {
  const list = Array.isArray(categories) ? categories : [];
  const existing = findFallbackCategory(list);
  if (existing) return { categories: list, fallbackId: existing.id, created: false };
  let fallbackId = 'cat_lainnya';
  const ids = new Set(list.map((category) => category.id));
  if (ids.has(fallbackId)) fallbackId = uid('cat');
  const timestamp = nowIso();
  const fallback = { id: fallbackId, name: FALLBACK_CATEGORY_NAME, createdAt: timestamp, updatedAt: timestamp };
  return { categories: [...list, fallback], fallbackId, created: true };
}

function backupCorruptedKey(key, raw, warnings) {
  try {
    const suffix = key.replace(STORAGE_PREFIX, '');
    const backupKey = `${STORAGE_PREFIX}corrupt:${suffix}:${Date.now()}`;
    localStorage.setItem(backupKey, raw);
    warnings.push(`Data "${suffix}" rusak. Salinan mentah disimpan di penyimpanan browser (${backupKey}).`);
  } catch {
    warnings.push(`Data "${key.replace(STORAGE_PREFIX, '')}" rusak dan tidak dapat dibaca.`);
  }
}

/**
 * Menyiapkan penyimpanan tanpa menimpa data yang sudah ada.
 * Data demo hanya dibuat bila penyimpanan benar-benar masih kosong.
 */
export function initStorage() {
  requireStorage();
  const warnings = [];
  let hadCorruption = false;

  // Hitung data yang sudah ada sebelum proses perbaikan apa pun.
  const hadAnyData = Object.values(STORAGE_KEYS).some((key) => {
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  });

  // Periksa JSON rusak dan buat cadangan mentah sebelum mengganti.
  Object.values(STORAGE_KEYS).forEach((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return;
    try {
      JSON.parse(raw);
    } catch {
      hadCorruption = true;
      backupCorruptedKey(key, raw, warnings);
      localStorage.removeItem(key);
    }
  });

  const existingMeta = getMeta();
  const canSeedDemo = !hadAnyData && !existingMeta.initialized && !hadCorruption;

  let seeded = false;
  if (canSeedDemo) {
    const demo = createDemoData();
    runAtomic(() => {
      saveCategories(demo.categories);
      saveProducts(demo.products);
      saveTransactions(demo.transactions);
      saveMovements(demo.movements);
      saveSettings(DEMO_SETTINGS);
      saveMeta({
        initialized: true,
        createdAt: nowIso(),
        demoSeeded: true,
        demo: demo.demoMeta
      });
    });
    seeded = true;
  } else {
    initializeCollections(existingMeta, warnings);
    if (!existingMeta.initialized) {
      saveMeta({
        ...existingMeta,
        initialized: true,
        createdAt: existingMeta.createdAt || nowIso(),
        demoSeeded: existingMeta.demoSeeded === true,
        demo: existingMeta.demo || null
      });
    }
  }

  // Pastikan pengaturan & format mata uang sinkron.
  const settings = getSettings();
  setCurrencyFormat(settings.currencyFormat);

  return {
    seeded,
    warnings,
    hadCorruption,
    settings,
    meta: getMeta()
  };
}

function initializeCollections(existingMeta, warnings) {
  // Kategori: buat default jika kosong, pastikan ada kategori "Lainnya".
  let categories = getCategories();
  if (!categories.length) {
    categories = makeDefaultCategories();
  }
  const fallbackResult = ensureFallbackCategory(categories);
  if (fallbackResult.created || !getRawSafe(STORAGE_KEYS.categories)) {
    saveCategories(fallbackResult.categories);
  }

  // Daftar lain: buat kosong hanya jika key belum pernah ada.
  if (getRawSafe(STORAGE_KEYS.products) === null) saveProducts([]);
  if (getRawSafe(STORAGE_KEYS.transactions) === null) saveTransactions([]);
  if (getRawSafe(STORAGE_KEYS.movements) === null) saveMovements([]);

  // Pengaturan: lengkapi field yang hilang tanpa menimpa nilai pengguna.
  const rawSettings = getRawSafe(STORAGE_KEYS.settings);
  if (rawSettings === null) {
    saveSettings({ ...DEFAULT_SETTINGS });
  } else {
    const settings = getSettings();
    const merged = normalizeSettingsObject({ ...DEFAULT_SETTINGS, ...settings });
    saveSettings(merged);
  }

  if (!existingMeta.initialized && !getRawSafe(STORAGE_KEYS.meta) && warnings.length) {
    warnings.push('Aplikasi dimulai tanpa data demo karena ada data yang tidak dapat dibaca.');
  }
}

function getRawSafe(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Muat data demo. Hanya diizinkan jika belum ada produk/transaksi.
 * `keepSettings` mempertahankan identitas usaha yang sudah diisi pengguna.
 */
export function seedDemoData(options = {}) {
  const { keepSettings = false, force = false } = options;
  requireStorage();
  const products = getProducts();
  const transactions = getTransactions();
  if (!force && (products.length > 0 || transactions.length > 0)) {
    throw new StorageError(
      'Data demo hanya dapat dimuat saat belum ada produk dan transaksi. Reset data terlebih dahulu.',
      'demo_not_empty'
    );
  }

  const demo = createDemoData();
  const currentSettings = getSettings();
  const currentMeta = getMeta();

  runAtomic(() => {
    saveCategories(demo.categories);
    saveProducts(demo.products);
    saveTransactions(demo.transactions);
    saveMovements(demo.movements);
    if (!keepSettings) saveSettings({ ...DEMO_SETTINGS });
    saveMeta({
      ...currentMeta,
      initialized: true,
      createdAt: currentMeta.createdAt || nowIso(),
      demoSeeded: true,
      demo: demo.demoMeta
    });
  });

  if (keepSettings) saveSettings(currentSettings);
  return getMeta();
}

/**
 * Hapus seluruh data demo yang masih dilacak.
 * Produk demo yang sudah dipakai transaksi pengguna dipertahankan.
 */
export function clearDemoData() {
  requireStorage();
  const meta = getMeta();
  if (!meta.demoSeeded || !meta.demo) {
    return { removedProducts: 0, removedTransactions: 0, removedMovements: 0, keptProducts: 0 };
  }

  const demo = meta.demo;
  const demoProductIds = new Set(Array.isArray(demo.productIds) ? demo.productIds : []);
  const demoTransactionIds = new Set(Array.isArray(demo.transactionIds) ? demo.transactionIds : []);
  const demoMovementIds = new Set(Array.isArray(demo.movementIds) ? demo.movementIds : []);

  return runAtomic(() => {
    let products = getProducts();
    let transactions = getTransactions();
    let movements = getMovements();

    const removedTransactions = transactions.filter((transaction) => demoTransactionIds.has(transaction.id)).length;
    transactions = transactions.filter((transaction) => !demoTransactionIds.has(transaction.id));

    const referencedProductIds = new Set();
    transactions.forEach((transaction) => {
      (transaction.items || []).forEach((item) => {
        if (item.productId) referencedProductIds.add(item.productId);
      });
    });

    const productsToRemove = new Set(
      Array.from(demoProductIds).filter((productId) => !referencedProductIds.has(productId))
    );
    const keptProducts = demoProductIds.size - productsToRemove.size;

    products = products.filter((product) => !productsToRemove.has(product.id));

    const removedMovements = movements.filter((movement) => demoMovementIds.has(movement.id)).length;
    movements = movements.filter((movement) => {
      if (productsToRemove.has(movement.productId)) return false;
      if (demoMovementIds.has(movement.id) && (movement.type === 'sale' || movement.type === 'cancel')) return false;
      return true;
    });

    saveProducts(products);
    saveTransactions(transactions);
    saveMovements(movements);

    saveMeta({
      ...meta,
      demoSeeded: false,
      demo: null,
      lastDemoRemovedAt: nowIso()
    });

    return {
      removedProducts: productsToRemove.size,
      removedTransactions,
      removedMovements,
      keptProducts
    };
  });
}

/**
 * Reset seluruh data ke kondisi awal tanpa data demo.
 */
export function resetAllData() {
  requireStorage();
  const previousMeta = getMeta();
  return runAtomic(() => {
    const timestamp = nowIso();
    saveCategories(makeDefaultCategories());
    saveProducts([]);
    saveTransactions([]);
    saveMovements([]);
    saveSettings({ ...DEFAULT_SETTINGS });
    saveMeta({
      initialized: true,
      createdAt: timestamp,
      demoSeeded: false,
      demo: null,
      lastResetAt: timestamp,
      lastImportAt: previousMeta.lastImportAt || null
    });
    setCurrencyFormat(DEFAULT_SETTINGS.currencyFormat);
    return true;
  });
}

/* ==========================================================================
   Nomor transaksi & ringkasan penyimpanan
   ========================================================================== */

export function generateTransactionNumber(date = new Date(), existingTransactions = null) {
  const key = dateKey(date);
  const prefix = `TRX-${key.replace(/-/g, '')}-`;
  const transactions = Array.isArray(existingTransactions) ? existingTransactions : getTransactions();
  let maxSequence = 0;
  const used = new Set();

  transactions.forEach((transaction) => {
    const number = typeof transaction.number === 'string' ? transaction.number : '';
    used.add(number);
    if (number.startsWith(prefix)) {
      const sequence = Number(number.slice(prefix.length));
      if (Number.isFinite(sequence) && sequence > maxSequence) maxSequence = sequence;
    }
  });

  let next = maxSequence + 1;
  let candidate = `${prefix}${String(next).padStart(4, '0')}`;
  while (used.has(candidate)) {
    next += 1;
    candidate = `${prefix}${String(next).padStart(4, '0')}`;
  }
  return candidate;
}

export function getDataSummary() {
  let characters = 0;
  Object.values(STORAGE_KEYS).forEach((key) => {
    try {
      characters += (localStorage.getItem(key) || '').length;
    } catch {
      /* abaikan */
    }
  });
  return {
    products: getProducts().length,
    categories: getCategories().length,
    transactions: getTransactions().length,
    movements: getMovements().length,
    bytes: characters * 2,
    kilobytes: Math.round((characters * 2) / 1024 * 10) / 10
  };
}

/* ==========================================================================
   Ekspor
   ========================================================================== */

export function exportBackup() {
  return {
    format: BACKUP_FORMAT,
    version: STORAGE_VERSION,
    app: 'UsahaPOS',
    exportedAt: nowIso(),
    data: {
      categories: getCategories(),
      products: getProducts(),
      transactions: getTransactions(),
      movements: getMovements(),
      settings: getSettings()
    }
  };
}

/* ==========================================================================
   Validasi berkas impor
   ========================================================================== */

const MAX_VALIDATION_ERRORS = 20;
const VALID_PAYMENT_METHODS = new Set(['cash', 'qris', 'transfer', 'card']);
const VALID_TRANSACTION_STATUSES = new Set(['completed', 'cancelled']);
const VALID_MOVEMENT_TYPES = new Set(['initial', 'in', 'adjustment', 'sale', 'cancel']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function addError(errors, message) {
  if (errors.length < MAX_VALIDATION_ERRORS) errors.push(message);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIntegerAtLeast(value, minimum) {
  return Number.isInteger(value) && value >= minimum;
}

function validTimestamp(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function normalizeTimestamp(value, fallback) {
  return validTimestamp(value) ? new Date(value).toISOString() : fallback;
}

function validateCategoriesInput(raw, errors, now) {
  if (!Array.isArray(raw)) {
    addError(errors, 'Daftar kategori tidak ditemukan atau bukan berupa array.');
    return [];
  }

  const categories = [];
  const usedIds = new Set();
  const usedNames = new Set();

  raw.forEach((entry, index) => {
    const label = `Kategori #${index + 1}`;
    if (!isPlainObject(entry)) {
      addError(errors, `${label} bukan objek yang valid.`);
      return;
    }
    const id = isNonEmptyString(entry.id) ? entry.id.trim() : '';
    const name = normalizeWhitespace(entry.name);
    if (!id) {
      addError(errors, `${label} tidak memiliki ID.`);
      return;
    }
    if (!name) {
      addError(errors, `${label} tidak memiliki nama.`);
      return;
    }
    if (usedIds.has(id)) {
      addError(errors, `${label} memiliki ID ganda (${id}).`);
      return;
    }
    const nameKey = normalizeKey(name);
    if (usedNames.has(nameKey)) {
      addError(errors, `Nama kategori "${name}" muncul lebih dari sekali.`);
      return;
    }
    usedIds.add(id);
    usedNames.add(nameKey);
    categories.push({
      id,
      name,
      createdAt: normalizeTimestamp(entry.createdAt, now),
      updatedAt: normalizeTimestamp(entry.updatedAt, now)
    });
  });

  return categories;
}

function validateProductsInput(raw, categories, errors, now) {
  if (!Array.isArray(raw)) {
    addError(errors, 'Daftar produk tidak ditemukan atau bukan berupa array.');
    return [];
  }

  const categoryIds = new Set(categories.map((category) => category.id));
  const products = [];
  const usedIds = new Set();
  const usedSkus = new Set();
  const usedNames = new Set();

  raw.forEach((entry, index) => {
    const label = `Produk #${index + 1}`;
    if (!isPlainObject(entry)) {
      addError(errors, `${label} bukan objek yang valid.`);
      return;
    }
    const id = isNonEmptyString(entry.id) ? entry.id.trim() : '';
    const sku = isNonEmptyString(entry.sku) ? entry.sku.trim() : '';
    const name = normalizeWhitespace(entry.name);
    const categoryId = isNonEmptyString(entry.categoryId) ? entry.categoryId.trim() : '';

    if (!id) addError(errors, `${label} tidak memiliki ID.`);
    if (!sku) addError(errors, `${label} (${name || 'tanpa nama'}) tidak memiliki SKU.`);
    if (!name) addError(errors, `${label} tidak memiliki nama.`);
    if (!categoryId) {
      addError(errors, `${label} (${name || 'tanpa nama'}) tidak memiliki kategori.`);
    } else if (!categoryIds.has(categoryId)) {
      addError(errors, `${label} (${name || 'tanpa nama'}) merujuk kategori yang tidak ada.`);
    }
    if (!id || !sku || !name || !categoryId || !categoryIds.has(categoryId)) return;

    if (usedIds.has(id)) {
      addError(errors, `${label} memiliki ID ganda (${id}).`);
      return;
    }
    const skuKey = normalizeKey(sku);
    if (usedSkus.has(skuKey)) {
      addError(errors, `SKU "${sku}" muncul lebih dari sekali.`);
      return;
    }
    const nameKey = `${categoryId}::${normalizeKey(name)}`;
    if (usedNames.has(nameKey)) {
      addError(errors, `Produk "${name}" muncul lebih dari sekali pada kategori yang sama.`);
      return;
    }

    const costPrice = entry.costPrice;
    const sellPrice = entry.sellPrice;
    const stock = entry.stock;
    const minStock = entry.minStock;

    if (!isIntegerAtLeast(costPrice, 0)) addError(errors, `Harga modal produk "${name}" harus bilangan bulat nonnegatif.`);
    if (!isIntegerAtLeast(sellPrice, 0)) addError(errors, `Harga jual produk "${name}" harus bilangan bulat nonnegatif.`);
    if (!isIntegerAtLeast(stock, 0)) addError(errors, `Stok produk "${name}" harus bilangan bulat nonnegatif.`);
    if (!isIntegerAtLeast(minStock, 0)) addError(errors, `Batas minimum stok produk "${name}" harus bilangan bulat nonnegatif.`);

    if (
      !isIntegerAtLeast(costPrice, 0) ||
      !isIntegerAtLeast(sellPrice, 0) ||
      !isIntegerAtLeast(stock, 0) ||
      !isIntegerAtLeast(minStock, 0)
    ) return;

    usedIds.add(id);
    usedSkus.add(skuKey);
    usedNames.add(nameKey);

    const createdAt = normalizeTimestamp(entry.createdAt, now);
    products.push({
      id,
      sku,
      name,
      categoryId,
      costPrice,
      sellPrice,
      stock,
      minStock,
      active: entry.active !== false,
      createdAt,
      updatedAt: normalizeTimestamp(entry.updatedAt, createdAt)
    });
  });

  return products;
}

function validateTransactionItems(rawItems, transactionLabel, errors) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    addError(errors, `${transactionLabel} tidak memiliki rincian barang.`);
    return null;
  }

  const items = [];
  let valid = true;

  rawItems.forEach((entry, index) => {
    const label = `${transactionLabel}, item #${index + 1}`;
    if (!isPlainObject(entry)) {
      addError(errors, `${label} bukan objek yang valid.`);
      valid = false;
      return;
    }
    const name = normalizeWhitespace(entry.name);
    const qty = entry.qty;
    const unitPrice = entry.unitPrice;
    const costPrice = entry.costPrice;
    const subtotal = entry.subtotal;

    if (!name) {
      addError(errors, `${label} tidak memiliki nama produk.`);
      valid = false;
    }
    if (!isIntegerAtLeast(qty, 1)) {
      addError(errors, `${label} memiliki jumlah yang tidak valid.`);
      valid = false;
    }
    if (!isIntegerAtLeast(unitPrice, 0)) {
      addError(errors, `${label} memiliki harga satuan yang tidak valid.`);
      valid = false;
    }
    if (!isIntegerAtLeast(costPrice, 0)) {
      addError(errors, `${label} memiliki harga modal yang tidak valid.`);
      valid = false;
    }
    if (!isIntegerAtLeast(subtotal, 0)) {
      addError(errors, `${label} memiliki subtotal yang tidak valid.`);
      valid = false;
    }
    if (isIntegerAtLeast(qty, 1) && isIntegerAtLeast(unitPrice, 0) && isIntegerAtLeast(subtotal, 0) && subtotal !== qty * unitPrice) {
      addError(errors, `${label} memiliki subtotal yang tidak sesuai (${qty} × ${unitPrice}).`);
      valid = false;
    }

    if (!valid) return;

    items.push({
      productId: isNonEmptyString(entry.productId) ? entry.productId.trim() : null,
      sku: typeof entry.sku === 'string' ? entry.sku.trim() : '',
      name,
      categoryName: normalizeWhitespace(entry.categoryName) || 'Tanpa Kategori',
      unitPrice,
      costPrice,
      qty,
      subtotal
    });
  });

  return valid ? items : null;
}

function validateTransactionsInput(raw, errors) {
  if (!Array.isArray(raw)) {
    addError(errors, 'Daftar transaksi tidak ditemukan atau bukan berupa array.');
    return [];
  }

  const transactions = [];
  const usedIds = new Set();
  const usedNumbers = new Set();

  raw.forEach((entry, index) => {
    const label = `Transaksi #${index + 1}`;
    if (!isPlainObject(entry)) {
      addError(errors, `${label} bukan objek yang valid.`);
      return;
    }

    const id = isNonEmptyString(entry.id) ? entry.id.trim() : '';
    const number = isNonEmptyString(entry.number) ? entry.number.trim() : '';
    const status = entry.status;
    const method = entry.paymentMethod;
    const createdAt = entry.createdAt;

    if (!id) addError(errors, `${label} tidak memiliki ID.`);
    if (!number) addError(errors, `${label} tidak memiliki nomor transaksi.`);
    if (!validTimestamp(createdAt)) addError(errors, `${label} memiliki tanggal yang tidak valid.`);
    if (!VALID_TRANSACTION_STATUSES.has(status)) addError(errors, `${label} memiliki status yang tidak dikenal.`);
    if (!VALID_PAYMENT_METHODS.has(method)) addError(errors, `${label} memiliki metode pembayaran yang tidak dikenal.`);
    if (!id || !number || !VALID_TRANSACTION_STATUSES.has(status) || !VALID_PAYMENT_METHODS.has(method) || !validTimestamp(createdAt)) {
      return;
    }
    if (usedIds.has(id)) {
      addError(errors, `${label} memiliki ID ganda (${id}).`);
      return;
    }
    if (usedNumbers.has(number)) {
      addError(errors, `Nomor transaksi "${number}" muncul lebih dari sekali.`);
      return;
    }

    const items = validateTransactionItems(entry.items, label, errors);
    if (!items) return;

    const itemSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const itemCount = items.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = entry.subtotal;
    const discount = entry.discount;
    const total = entry.total;

    if (!isIntegerAtLeast(subtotal, 0) || subtotal !== itemSubtotal) {
      addError(errors, `${label} memiliki subtotal transaksi yang tidak sesuai rincian barang.`);
      return;
    }
    if (!isIntegerAtLeast(discount, 0) || discount > subtotal) {
      addError(errors, `${label} memiliki diskon yang tidak valid.`);
      return;
    }
    if (!isIntegerAtLeast(total, 0) || total !== subtotal - discount) {
      addError(errors, `${label} memiliki total yang tidak sesuai.`);
      return;
    }
    if (entry.itemCount !== undefined && entry.itemCount !== itemCount) {
      addError(errors, `${label} memiliki jumlah item yang tidak sesuai rincian.`);
      return;
    }

    let cashReceived = null;
    let change = 0;
    if (method === 'cash') {
      if (!isIntegerAtLeast(entry.cashReceived, total)) {
        addError(errors, `${label} memiliki uang tunai diterima yang kurang dari total.`);
        return;
      }
      cashReceived = entry.cashReceived;
      change = cashReceived - total;
      if (entry.change !== undefined && entry.change !== change) {
        addError(errors, `${label} memiliki nominal kembalian yang tidak sesuai.`);
        return;
      }
    }

    usedIds.add(id);
    usedNumbers.add(number);

    transactions.push({
      id,
      number,
      createdAt: new Date(createdAt).toISOString(),
      status,
      items,
      itemCount,
      subtotal,
      discount,
      total,
      paymentMethod: method,
      cashReceived,
      change,
      cancelledAt: status === 'cancelled' && validTimestamp(entry.cancelledAt)
        ? new Date(entry.cancelledAt).toISOString()
        : null
    });
  });

  return transactions;
}

function validateMovementsInput(raw, products, errors) {
  if (!Array.isArray(raw)) {
    addError(errors, 'Riwayat pergerakan stok tidak ditemukan atau bukan berupa array.');
    return [];
  }

  const productIds = new Set(products.map((product) => product.id));
  const movements = [];
  const usedIds = new Set();

  raw.forEach((entry, index) => {
    const label = `Pergerakan stok #${index + 1}`;
    if (!isPlainObject(entry)) {
      addError(errors, `${label} bukan objek yang valid.`);
      return;
    }
    const id = isNonEmptyString(entry.id) ? entry.id.trim() : '';
    const productId = isNonEmptyString(entry.productId) ? entry.productId.trim() : '';
    const type = entry.type;
    const change = entry.change;
    const stockBefore = entry.stockBefore;
    const stockAfter = entry.stockAfter;

    if (!id) addError(errors, `${label} tidak memiliki ID.`);
    if (!productId) addError(errors, `${label} tidak memiliki ID produk.`);
    else if (!productIds.has(productId)) addError(errors, `${label} merujuk produk yang tidak ada.`);
    if (!VALID_MOVEMENT_TYPES.has(type)) addError(errors, `${label} memiliki jenis yang tidak dikenal.`);
    if (!Number.isInteger(change)) addError(errors, `${label} memiliki jumlah perubahan yang tidak valid.`);
    if (!isIntegerAtLeast(stockBefore, 0)) addError(errors, `${label} memiliki stok sebelum yang tidak valid.`);
    if (!isIntegerAtLeast(stockAfter, 0)) addError(errors, `${label} memiliki stok sesudah yang tidak valid.`);
    if (!validTimestamp(entry.createdAt)) addError(errors, `${label} memiliki tanggal yang tidak valid.`);
    if (Number.isInteger(change) && Number.isInteger(stockBefore) && Number.isInteger(stockAfter) && stockAfter !== stockBefore + change) {
      addError(errors, `${label} memiliki riwayat stok yang tidak konsisten.`);
    }

    if (usedIds.has(id)) {
      addError(errors, `${label} memiliki ID ganda (${id}).`);
      return;
    }
    if (
      !id ||
      !productId ||
      !productIds.has(productId) ||
      !VALID_MOVEMENT_TYPES.has(type) ||
      !Number.isInteger(change) ||
      !isIntegerAtLeast(stockBefore, 0) ||
      !isIntegerAtLeast(stockAfter, 0) ||
      !validTimestamp(entry.createdAt) ||
      stockAfter !== stockBefore + change
    ) {
      return;
    }

    usedIds.add(id);
    movements.push({
      id,
      productId,
      productName: normalizeWhitespace(entry.productName) || 'Produk',
      type,
      change,
      stockBefore,
      stockAfter,
      reason: normalizeWhitespace(entry.reason) || 'Tanpa keterangan',
      referenceId: isNonEmptyString(entry.referenceId) ? entry.referenceId.trim() : null,
      referenceNumber: isNonEmptyString(entry.referenceNumber) ? entry.referenceNumber.trim() : null,
      createdAt: new Date(entry.createdAt).toISOString()
    });
  });

  return movements;
}

function validateSettingsInput(raw, errors) {
  if (raw === undefined || raw === null) return { ...DEFAULT_SETTINGS };
  if (!isPlainObject(raw)) {
    addError(errors, 'Pengaturan bukan objek yang valid.');
    return { ...DEFAULT_SETTINGS };
  }

  const stringFields = ['businessName', 'ownerName', 'address', 'phone', 'receiptMessage'];
  stringFields.forEach((field) => {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') {
      addError(errors, `Pengaturan "${field}" harus berupa teks.`);
    }
  });
  if (raw.currencyFormat !== undefined && raw.currencyFormat !== 'nospace' && raw.currencyFormat !== 'space') {
    addError(errors, 'Format mata uang pada pengaturan tidak dikenal.');
  }
  if (raw.defaultMinStock !== undefined && !isIntegerAtLeast(raw.defaultMinStock, 0)) {
    addError(errors, 'Batas minimum stok default harus bilangan bulat nonnegatif.');
  }

  return normalizeSettingsObject({ ...DEFAULT_SETTINGS, ...raw });
}

/**
 * Validasi struktur berkas backup. Tidak menyentuh LocalStorage.
 */
export function validateBackup(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['Isi file bukan objek JSON backup UsahaPOS.'], data: null, summary: null };
  }
  if (payload.format !== BACKUP_FORMAT) {
    addError(errors, 'Format file tidak dikenali. Gunakan file ekspor JSON dari UsahaPOS.');
  }
  const version = Number(payload.version);
  if (!Number.isInteger(version) || version < 1) {
    addError(errors, 'Versi format data tidak valid.');
  } else if (version > STORAGE_VERSION) {
    addError(errors, `Versi file (${version}) lebih baru dari versi aplikasi ini (${STORAGE_VERSION}).`);
  }
  if (!isPlainObject(payload.data)) {
    addError(errors, 'Bagian "data" tidak ditemukan pada file backup.');
    return { ok: false, errors, data: null, summary: null };
  }

  const now = nowIso();
  const categories = validateCategoriesInput(payload.data.categories, errors, now);
  const products = validateProductsInput(payload.data.products, categories, errors, now);
  const transactions = validateTransactionsInput(payload.data.transactions, errors);
  const movements = validateMovementsInput(payload.data.movements, products, errors);
  const settings = validateSettingsInput(payload.data.settings, errors);

  const summary = {
    categories: categories.length,
    products: products.length,
    transactions: transactions.length,
    movements: movements.length,
    exportedAt: payload.exportedAt || null,
    version
  };

  if (errors.length > 0) {
    return { ok: false, errors, data: null, summary };
  }

  return {
    ok: true,
    errors: [],
    data: { categories, products, transactions, movements, settings },
    summary
  };
}

/* ==========================================================================
   Impor data
   ========================================================================== */

export function importBackup(payload, mode = 'merge') {
  requireStorage();
  const validation = validateBackup(payload);
  if (!validation.ok) {
    throw new StorageError('File impor tidak valid. Data lama tidak diubah.', 'import_invalid', validation.errors);
  }
  const incoming = validation.data;
  const importMode = mode === 'replace' ? 'replace' : 'merge';
  const currentMeta = getMeta();

  if (importMode === 'replace') {
    return runAtomic(() => {
      let categories = incoming.categories;
      if (!categories.length) {
        categories = makeDefaultCategories();
      } else {
        const ensured = ensureFallbackCategory(categories);
        categories = ensured.categories;
      }

      saveCategories(categories);
      saveProducts(incoming.products);
      saveTransactions(incoming.transactions);
      saveMovements(incoming.movements);
      const settings = saveSettings(incoming.settings);
      saveMeta({
        initialized: true,
        createdAt: currentMeta.createdAt || nowIso(),
        demoSeeded: false,
        demo: null,
        lastImportAt: nowIso(),
        lastResetAt: currentMeta.lastResetAt || null
      });

      return {
        mode: 'replace',
        added: {
          categories: categories.length,
          products: incoming.products.length,
          transactions: incoming.transactions.length,
          movements: incoming.movements.length
        },
        skipped: { categories: 0, products: 0, transactions: 0, movements: 0 },
        settings
      };
    });
  }

  // Mode gabung
  return runAtomic(() => {
    const counts = {
      categories: 0,
      products: 0,
      transactions: 0,
      movements: 0
    };
    const skipped = {
      categories: 0,
      products: 0,
      transactions: 0,
      movements: 0
    };

    const categories = getCategories();
    const categoryByName = new Map(categories.map((category) => [normalizeKey(category.name), category]));
    const usedCategoryIds = new Set(categories.map((category) => category.id));
    const categoryMap = new Map();

    incoming.categories.forEach((category) => {
      const existing = categoryByName.get(normalizeKey(category.name));
      if (existing) {
        categoryMap.set(category.id, existing.id);
        skipped.categories += 1;
        return;
      }
      let id = category.id;
      if (usedCategoryIds.has(id)) id = uid('cat');
      const newCategory = { ...category, id };
      categories.push(newCategory);
      usedCategoryIds.add(id);
      categoryByName.set(normalizeKey(newCategory.name), newCategory);
      categoryMap.set(category.id, id);
      counts.categories += 1;
    });

    const fallback = ensureFallbackCategory(categories);
    const categoriesToSave = fallback.categories;
    if (fallback.created) counts.categories += 1;
    const fallbackId = fallback.fallbackId;

    const products = getProducts();
    const productBySku = new Map(products.map((product) => [normalizeKey(product.sku), product]));
    const productByNameCategory = new Map(
      products.map((product) => [`${product.categoryId}::${normalizeKey(product.name)}`, product])
    );
    const usedProductIds = new Set(products.map((product) => product.id));
    const productMap = new Map();

    incoming.products.forEach((product) => {
      const targetCategoryId = categoryMap.get(product.categoryId) || fallbackId;
      const skuKey = normalizeKey(product.sku);
      const sameSku = productBySku.get(skuKey);
      if (sameSku) {
        productMap.set(product.id, sameSku.id);
        skipped.products += 1;
        return;
      }
      const nameKey = `${targetCategoryId}::${normalizeKey(product.name)}`;
      const sameName = productByNameCategory.get(nameKey);
      if (sameName) {
        productMap.set(product.id, sameName.id);
        skipped.products += 1;
        return;
      }
      let id = product.id;
      if (usedProductIds.has(id)) id = uid('prd');
      const newProduct = { ...product, id, categoryId: targetCategoryId };
      products.push(newProduct);
      usedProductIds.add(id);
      productBySku.set(skuKey, newProduct);
      productByNameCategory.set(nameKey, newProduct);
      productMap.set(product.id, id);
      counts.products += 1;
    });

    const transactions = getTransactions();
    const existingTransactionIds = new Set(transactions.map((transaction) => transaction.id));
    const existingTransactionNumbers = new Set(transactions.map((transaction) => transaction.number));
    const transactionMap = new Map();
    const skippedTransactionIds = new Set();

    incoming.transactions.forEach((transaction) => {
      if (existingTransactionNumbers.has(transaction.number)) {
        skippedTransactionIds.add(transaction.id);
        skipped.transactions += 1;
        return;
      }
      let id = transaction.id;
      if (existingTransactionIds.has(id)) id = uid('trx');
      const items = transaction.items.map((item) => {
        const mappedProductId = item.productId && productMap.has(item.productId)
          ? productMap.get(item.productId)
          : item.productId;
        return { ...item, productId: mappedProductId };
      });
      const newTransaction = { ...transaction, id, items };
      transactions.push(newTransaction);
      existingTransactionIds.add(id);
      existingTransactionNumbers.add(newTransaction.number);
      transactionMap.set(transaction.id, id);
      counts.transactions += 1;
    });

    const movements = getMovements();
    const existingMovementIds = new Set(movements.map((movement) => movement.id));
    const finalProductIds = new Set(products.map((product) => product.id));

    incoming.movements.forEach((movement) => {
      if (existingMovementIds.has(movement.id)) {
        skipped.movements += 1;
        return;
      }
      if (movement.referenceId && skippedTransactionIds.has(movement.referenceId)) {
        skipped.movements += 1;
        return;
      }
      const mappedProductId = productMap.get(movement.productId) || movement.productId;
      if (!finalProductIds.has(mappedProductId)) {
        skipped.movements += 1;
        return;
      }
      const mappedReferenceId = movement.referenceId && transactionMap.has(movement.referenceId)
        ? transactionMap.get(movement.referenceId)
        : movement.referenceId;
      const newMovement = {
        ...movement,
        productId: mappedProductId,
        referenceId: mappedReferenceId || null
      };
      movements.push(newMovement);
      existingMovementIds.add(newMovement.id);
      counts.movements += 1;
    });

    saveCategories(categoriesToSave);
    saveProducts(products);
    saveTransactions(transactions);
    saveMovements(movements);
    saveMeta({
      ...currentMeta,
      initialized: true,
      createdAt: currentMeta.createdAt || nowIso(),
      lastImportAt: nowIso()
    });

    return {
      mode: 'merge',
      added: counts,
      skipped,
      settings: getSettings(),
      settingsKept: true
    };
  });
}

