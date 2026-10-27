/**
 * calculations.js
 * Fungsi perhitungan murni: keranjang, ringkasan transaksi, laporan, stok.
 */

import {
  dateKey,
  enumerateDateKeys,
  formatDateShort,
  formatDayMonth,
  formatWeekday,
  getStockStatus,
  startOfDay,
  addDays
} from './utils.js';

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function isCompleted(transaction) {
  return transaction && transaction.status === 'completed';
}

export function getItemCogs(item) {
  return numeric(item.costPrice) * numeric(item.qty);
}

export function getTransactionCogs(transaction) {
  return (transaction.items || []).reduce((sum, item) => sum + getItemCogs(item), 0);
}

export function getTransactionItemCount(transaction) {
  if (Number.isFinite(Number(transaction.itemCount))) return Number(transaction.itemCount);
  return (transaction.items || []).reduce((sum, item) => sum + numeric(item.qty), 0);
}

export function getTransactionProfit(transaction) {
  return numeric(transaction.total) - getTransactionCogs(transaction);
}

/**
 * Hitung ringkasan keranjang. Diskon yang melebihi subtotal dilaporkan
 * melalui `discountExceeds` agar UI dapat menolak pembayaran.
 */
export function calcCartTotals(items, discountValue = 0) {
  const list = Array.isArray(items) ? items : [];
  const subtotal = list.reduce((sum, item) => sum + numeric(item.unitPrice) * numeric(item.qty), 0);
  const itemCount = list.reduce((sum, item) => sum + numeric(item.qty), 0);
  const requestedDiscount = Math.max(0, Math.round(numeric(discountValue)));
  const discount = Math.min(requestedDiscount, subtotal);
  const total = Math.max(0, subtotal - discount);
  return {
    subtotal,
    requestedDiscount,
    discount,
    total,
    itemCount,
    discountExceeds: requestedDiscount > subtotal
  };
}

export function summarizeTransactions(transactions) {
  const completed = (transactions || []).filter(isCompleted);
  let revenue = 0;
  let discountTotal = 0;
  let itemCount = 0;
  let cogs = 0;

  completed.forEach((transaction) => {
    revenue += numeric(transaction.total);
    discountTotal += numeric(transaction.discount);
    itemCount += getTransactionItemCount(transaction);
    cogs += getTransactionCogs(transaction);
  });

  return {
    revenue,
    discountTotal,
    itemCount,
    cogs,
    grossProfit: revenue - cogs,
    transactionCount: completed.length
  };
}

export function getTransactionsInRange(transactions, startKey, endKey, options = {}) {
  const { includeCancelled = false } = options;
  return (transactions || []).filter((transaction) => {
    if (!includeCancelled && !isCompleted(transaction)) return false;
    if (!startKey || !endKey) return true;
    const key = dateKey(transaction.createdAt);
    return key >= startKey && key <= endKey;
  });
}

export function getTodayTransactions(transactions, date = new Date()) {
  const key = dateKey(date);
  return (transactions || []).filter((transaction) => isCompleted(transaction) && dateKey(transaction.createdAt) === key);
}

export function getActiveProducts(products) {
  return (products || []).filter((product) => product.active !== false);
}

export function getLowStockProducts(products, options = {}) {
  const { includeInactive = false } = options;
  return (products || [])
    .filter((product) => includeInactive || product.active !== false)
    .filter((product) => {
      const status = getStockStatus(product);
      return status.key === 'low' || status.key === 'out';
    })
    .sort((a, b) => {
      const stockA = numeric(a.stock);
      const stockB = numeric(b.stock);
      if (stockA !== stockB) return stockA - stockB;
      return String(a.name).localeCompare(String(b.name), 'id-ID');
    });
}

export function getPaymentBreakdown(transactions) {
  const completed = (transactions || []).filter(isCompleted);
  const totalRevenue = completed.reduce((sum, transaction) => sum + numeric(transaction.total), 0);
  const methods = ['cash', 'qris', 'transfer', 'card'];
  const breakdown = methods.map((method) => {
    const rows = completed.filter((transaction) => transaction.paymentMethod === method);
    const revenue = rows.reduce((sum, transaction) => sum + numeric(transaction.total), 0);
    return {
      method,
      count: rows.length,
      revenue,
      share: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0
    };
  });
  return { breakdown, totalRevenue };
}

export function getTopProducts(transactions, limit = 5) {
  const completed = (transactions || []).filter(isCompleted);
  const map = new Map();

  completed.forEach((transaction) => {
    (transaction.items || []).forEach((item) => {
      const key = item.productId || item.sku || item.name;
      if (!map.has(key)) {
        map.set(key, {
          productId: item.productId || null,
          name: item.name || 'Produk',
          sku: item.sku || '—',
          qty: 0,
          revenue: 0,
          cogs: 0,
          transactions: 0
        });
      }
      const entry = map.get(key);
      entry.qty += numeric(item.qty);
      entry.revenue += numeric(item.subtotal, numeric(item.unitPrice) * numeric(item.qty));
      entry.cogs += getItemCogs(item);
      entry.transactions += 1;
    });
  });

  return Array.from(map.values())
    .map((entry) => ({ ...entry, profit: entry.revenue - entry.cogs }))
    .sort((a, b) => {
      if (b.qty !== a.qty) return b.qty - a.qty;
      return b.revenue - a.revenue;
    })
    .slice(0, limit);
}

export function getSalesSeries(transactions, days = 7, endDate = new Date()) {
  const completed = (transactions || []).filter(isCompleted);
  const safeDays = Math.max(1, Math.min(366, Math.floor(days) || 7));
  const end = startOfDay(endDate);
  const series = [];

  for (let index = safeDays - 1; index >= 0; index -= 1) {
    const date = addDays(end, -index);
    const key = dateKey(date);
    const rows = completed.filter((transaction) => dateKey(transaction.createdAt) === key);
    series.push({
      key,
      date,
      weekday: formatWeekday(date),
      label: formatDayMonth(date),
      fullLabel: formatDateShort(date),
      revenue: rows.reduce((sum, transaction) => sum + numeric(transaction.total), 0),
      transactionCount: rows.length,
      itemCount: rows.reduce((sum, transaction) => sum + getTransactionItemCount(transaction), 0)
    });
  }

  return series;
}

export function buildDailyRows(transactions, startKey, endKey) {
  const completed = getTransactionsInRange(transactions, startKey, endKey);
  const grouped = new Map();

  completed.forEach((transaction) => {
    const key = dateKey(transaction.createdAt);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(transaction);
  });

  const keys = enumerateDateKeys(startKey, endKey).reverse();
  return keys.map((key) => {
    const rows = grouped.get(key) || [];
    const summary = summarizeTransactions(rows);
    return {
      key,
      label: formatDateShort(key),
      transactions: summary.transactionCount,
      items: summary.itemCount,
      revenue: summary.revenue,
      discount: summary.discountTotal,
      cogs: summary.cogs,
      grossProfit: summary.grossProfit
    };
  });
}

export function buildReport(transactions, startKey, endKey) {
  const filtered = getTransactionsInRange(transactions, startKey, endKey);
  const summary = summarizeTransactions(filtered);
  const dailyRows = buildDailyRows(transactions, startKey, endKey);
  const topProducts = getTopProducts(filtered, 10);
  const { breakdown } = getPaymentBreakdown(filtered);
  return {
    transactions: filtered,
    summary,
    dailyRows,
    topProducts,
    paymentBreakdown: breakdown
  };
}

export function getDashboardData(transactions, products, date = new Date()) {
  const todayTransactions = getTodayTransactions(transactions, date);
  const todaySummary = summarizeTransactions(todayTransactions);
  const activeProducts = getActiveProducts(products);
  const lowStock = getLowStockProducts(products);
  const series = getSalesSeries(transactions, 7, date);
  const recentTransactions = (transactions || [])
    .filter(isCompleted)
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);
  const bestSellers = getTopProducts(transactions, 5);

  return {
    todaySummary,
    activeProductCount: activeProducts.length,
    lowStockProducts: lowStock,
    lowStockCount: lowStock.length,
    series,
    recentTransactions,
    bestSellers
  };
}
