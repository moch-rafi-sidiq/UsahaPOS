/**
 * demo-data.js
 * Membuat data demo yang konsisten (produk, transaksi, dan pergerakan stok).
 * Hanya dipakai saat penyimpanan masih kosong atau pengguna meminta data demo.
 */

import { addDays, dateKey, startOfDay } from './utils.js';

const DAY = 86_400_000;

function atTime(baseDate, hours, minutes) {
  const date = new Date(baseDate.getTime());
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function roundUp(value, step = 10_000) {
  if (value <= 0) return 0;
  return Math.ceil(value / step) * step;
}

const CATEGORIES = [
  { id: 'cat_demo_makanan', name: 'Makanan' },
  { id: 'cat_demo_minuman', name: 'Minuman' },
  { id: 'cat_demo_sembako', name: 'Sembako' },
  { id: 'cat_demo_perlengkapan', name: 'Perlengkapan' },
  { id: 'cat_demo_lainnya', name: 'Lainnya' }
];

const PRODUCT_BLUEPRINTS = [
  { id: 'prd_demo_air', sku: 'MNM-001', name: 'Air Mineral 600 ml', categoryId: 'cat_demo_minuman', costPrice: 2500, sellPrice: 4000, initialStock: 20, minStock: 12 },
  { id: 'prd_demo_kopi', sku: 'MNM-002', name: 'Kopi Susu', categoryId: 'cat_demo_minuman', costPrice: 6000, sellPrice: 10000, initialStock: 14, minStock: 10 },
  { id: 'prd_demo_teh', sku: 'MNM-003', name: 'Teh Botol', categoryId: 'cat_demo_minuman', costPrice: 3500, sellPrice: 5000, initialStock: 20, minStock: 10 },
  { id: 'prd_demo_mi', sku: 'MKN-001', name: 'Mi Instan', categoryId: 'cat_demo_makanan', costPrice: 2800, sellPrice: 4000, initialStock: 30, minStock: 15 },
  { id: 'prd_demo_roti', sku: 'MKN-002', name: 'Roti Cokelat', categoryId: 'cat_demo_makanan', costPrice: 5000, sellPrice: 8000, initialStock: 10, minStock: 8 },
  { id: 'prd_demo_keripik', sku: 'MKN-003', name: 'Keripik Kentang', categoryId: 'cat_demo_makanan', costPrice: 7000, sellPrice: 11000, initialStock: 8, minStock: 6 },
  { id: 'prd_demo_biskuit', sku: 'MKN-004', name: 'Biskuit', categoryId: 'cat_demo_makanan', costPrice: 6000, sellPrice: 9000, initialStock: 12, minStock: 6 },
  { id: 'prd_demo_gula', sku: 'SBK-001', name: 'Gula Pasir 1 kg', categoryId: 'cat_demo_sembako', costPrice: 13000, sellPrice: 16000, initialStock: 10, minStock: 5 },
  { id: 'prd_demo_sabun', sku: 'PRL-001', name: 'Sabun Mandi', categoryId: 'cat_demo_perlengkapan', costPrice: 3500, sellPrice: 5000, initialStock: 12, minStock: 8 },
  { id: 'prd_demo_telur', sku: 'SBK-002', name: 'Telur Ayam 1 kg', categoryId: 'cat_demo_sembako', costPrice: 24000, sellPrice: 29000, initialStock: 8, minStock: 4 }
];

/**
 * Skenario transaksi demo. `dayOffset` 0 = hari ini.
 * Produk diambil dari blueprint, sehingga snapshot harga konsisten.
 */
const TRANSACTION_BLUEPRINTS = [
  { dayOffset: -6, hour: 9, minute: 20, method: 'cash', items: [['prd_demo_mi', 2], ['prd_demo_teh', 1]] },
  { dayOffset: -5, hour: 10, minute: 5, method: 'qris', items: [['prd_demo_kopi', 2], ['prd_demo_roti', 1]] },
  { dayOffset: -4, hour: 8, minute: 40, method: 'cash', items: [['prd_demo_air', 3], ['prd_demo_keripik', 1]] },
  { dayOffset: -4, hour: 15, minute: 15, method: 'transfer', items: [['prd_demo_gula', 1], ['prd_demo_telur', 1]] },
  { dayOffset: -3, hour: 11, minute: 30, method: 'cash', discount: 1000, items: [['prd_demo_mi', 3], ['prd_demo_teh', 2], ['prd_demo_biskuit', 1]] },
  { dayOffset: -2, hour: 9, minute: 10, method: 'qris', items: [['prd_demo_kopi', 1], ['prd_demo_roti', 2]] },
  { dayOffset: -2, hour: 16, minute: 45, method: 'cash', items: [['prd_demo_air', 2], ['prd_demo_sabun', 1]] },
  { dayOffset: -1, hour: 13, minute: 20, method: 'card', items: [['prd_demo_keripik', 2], ['prd_demo_biskuit', 2], ['prd_demo_teh', 1]] },
  { dayOffset: 0, relativeMinutes: 95, method: 'cash', items: [['prd_demo_air', 2], ['prd_demo_kopi', 1]] },
  { dayOffset: 0, relativeMinutes: 20, method: 'qris', discount: 1000, items: [['prd_demo_mi', 2], ['prd_demo_gula', 1]] }
];

export function createDemoData(now = new Date()) {
  const today = startOfDay(now);
  const createdDate = addDays(today, -14);
  const createdAt = atTime(createdDate, 8, 0).toISOString();
  const updatedAt = createdAt;

  const categories = CATEGORIES.map((category) => ({
    id: category.id,
    name: category.name,
    createdAt,
    updatedAt
  }));

  const products = PRODUCT_BLUEPRINTS.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    categoryId: product.categoryId,
    costPrice: product.costPrice,
    sellPrice: product.sellPrice,
    stock: product.initialStock,
    minStock: product.minStock,
    active: true,
    createdAt,
    updatedAt
  }));

  const productById = new Map(products.map((product) => [product.id, product]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const movementIds = [];
  const movements = [];
  const runningStock = new Map();

  // Catat stok awal setiap produk.
  products.forEach((product) => {
    const movement = {
      id: `mov_demo_init_${product.id.replace('prd_demo_', '')}`,
      productId: product.id,
      productName: product.name,
      type: 'initial',
      change: product.stock,
      stockBefore: 0,
      stockAfter: product.stock,
      reason: 'Stok awal data demo',
      referenceId: null,
      referenceNumber: null,
      createdAt
    };
    runningStock.set(product.id, product.stock);
    movements.push(movement);
    movementIds.push(movement.id);
  });

  const specs = TRANSACTION_BLUEPRINTS.map((spec) => {
    let date;
    if (spec.dayOffset === 0 && Number.isFinite(spec.relativeMinutes)) {
      date = new Date(now.getTime() - spec.relativeMinutes * 60_000);
      if (dateKey(date) !== dateKey(now)) {
        date = new Date(now.getTime() - Math.max(1, Math.floor((now.getTime() - startOfDay(now).getTime()) / 2000)) * 1000);
      }
    } else {
      date = atTime(addDays(today, spec.dayOffset), spec.hour || 10, spec.minute || 0);
    }
    return { ...spec, date };
  }).sort((a, b) => a.date - b.date);

  const sequenceByDate = new Map();
  const transactionIds = [];
  const transactions = [];

  specs.forEach((spec, specIndex) => {
    const key = dateKey(spec.date);
    const sequence = (sequenceByDate.get(key) || 0) + 1;
    sequenceByDate.set(key, sequence);
    const number = `TRX-${key.replace(/-/g, '')}-${String(sequence).padStart(4, '0')}`;

    const items = spec.items.map(([productId, qty]) => {
      const product = productById.get(productId);
      const category = categoryById.get(product.categoryId);
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        categoryName: category ? category.name : 'Tanpa Kategori',
        unitPrice: product.sellPrice,
        costPrice: product.costPrice,
        qty,
        subtotal: product.sellPrice * qty
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const discount = Math.min(Math.max(0, Number(spec.discount) || 0), subtotal);
    const total = Math.max(0, subtotal - discount);
    const itemCount = items.reduce((sum, item) => sum + item.qty, 0);
    const cashReceived = spec.method === 'cash' ? Math.max(total, roundUp(total)) : null;
    const change = spec.method === 'cash' ? cashReceived - total : 0;
    const transaction = {
      id: `trx_demo_${String(specIndex + 1).padStart(2, '0')}`,
      number,
      createdAt: spec.date.toISOString(),
      status: 'completed',
      items,
      itemCount,
      subtotal,
      discount,
      total,
      paymentMethod: spec.method,
      cashReceived,
      change,
      cancelledAt: null
    };

    transactions.push(transaction);
    transactionIds.push(transaction.id);

    items.forEach((item, itemIndex) => {
      const product = productById.get(item.productId);
      const before = runningStock.get(item.productId);
      const after = before - item.qty;
      runningStock.set(item.productId, after);

      const movement = {
        id: `mov_demo_sale_${specIndex + 1}_${itemIndex + 1}`,
        productId: item.productId,
        productName: item.name,
        type: 'sale',
        change: -item.qty,
        stockBefore: before,
        stockAfter: after,
        reason: `Penjualan ${number}`,
        referenceId: transaction.id,
        referenceNumber: number,
        createdAt: transaction.createdAt
      };
      movements.push(movement);
      movementIds.push(movement.id);

      if (after < 0) {
        throw new Error(`Data demo tidak konsisten: stok ${product.name} menjadi negatif.`);
      }
    });
  });

  // Stok akhir mengikuti transaksi demo.
  products.forEach((product) => {
    product.stock = runningStock.get(product.id);
    product.updatedAt = updatedAt;
  });

  return {
    categories,
    products,
    transactions,
    movements,
    demoMeta: {
      seededAt: now.toISOString(),
      productIds: products.map((product) => product.id),
      categoryIds: categories.map((category) => category.id),
      transactionIds,
      movementIds
    }
  };
}
