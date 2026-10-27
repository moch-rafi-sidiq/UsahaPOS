/**
 * categories.js
 * Manajemen kategori produk, termasuk pemindahan produk ke kategori
 * "Lainnya" secara aman saat kategori dihapus.
 */

import {
  $,
  confirmDialog,
  debounce,
  el,
  icon,
  normalizeKey,
  normalizeWhitespace,
  openModal,
  toast,
  uid
} from './utils.js';
import {
  FALLBACK_CATEGORY_NAME,
  ensureFallbackCategory,
  findFallbackCategory,
  getCategories,
  getProducts,
  runAtomic,
  saveCategories,
  saveProducts
} from './storage.js';

const state = { search: '' };

const debouncedSearch = debounce(() => rerender({ focusSearch: true }), 220);

function rerender(options = {}) {
  const container = $('#page-content');
  if (!container) return;
  renderCategoriesPage(container);
  if (options.focusSearch) {
    const input = $('#category-search');
    if (input) {
      input.focus({ preventScroll: true });
      const length = input.value.length;
      input.setSelectionRange(length, length);
    }
  }
}

function setFieldError(fieldNode, message) {
  fieldNode.classList.add('invalid');
  const error = fieldNode.querySelector('.field-error');
  if (error) error.textContent = message;
}

function clearFieldError(fieldNode) {
  fieldNode.classList.remove('invalid');
  const error = fieldNode.querySelector('.field-error');
  if (error) error.textContent = '';
}

function openCategoryForm(categoryId = null) {
  const categories = getCategories();
  const category = categoryId ? categories.find((item) => item.id === categoryId) : null;
  if (categoryId && !category) {
    toast('Kategori tidak ditemukan.', 'error');
    rerender();
    return;
  }

  const formId = `category-form-${Date.now()}`;
  const nameInput = el('input', {
    class: 'input',
    id: `${formId}-name`,
    type: 'text',
    maxlength: '40',
    placeholder: 'Nama kategori',
    value: category?.name || '',
    autocomplete: 'off',
    'data-autofocus': 'true'
  });
  const field = el('div', { class: 'field' }, [
    el('label', { for: `${formId}-name` }, ['Nama Kategori', el('span', { class: 'required', text: ' *' })]),
    nameInput,
    el('p', { class: 'field-hint', text: 'Gunakan nama singkat yang mudah dipahami, misalnya Minuman atau Sembako.' }),
    el('p', { class: 'field-error' })
  ]);
  const form = el('form', { class: 'form', id: formId, novalidate: true }, [
    el('div', { class: 'form-grid' }, field)
  ]);
  const info = el('div', { class: 'form-note', style: { margin: '0 20px 18px' } }, [
    icon('info'),
    'Nama kategori tidak boleh sama (perbedaan huruf besar/kecil tidak dihitung).'
  ]);
  const body = el('div', {}, [form, info]);

  const cancelButton = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Batal' });
  const saveLabel = el('span', { text: category ? 'Simpan Perubahan' : 'Tambah Kategori' });
  const saveButton = el('button', { class: 'btn btn-primary', type: 'submit', form: formId }, [icon('save'), saveLabel]);
  const footer = el('div', { class: 'modal-footer' }, [cancelButton, saveButton]);

  const modal = openModal({
    title: category ? 'Edit Kategori' : 'Tambah Kategori',
    subtitle: category ? 'Perbarui nama kategori' : 'Buat kelompok produk baru',
    content: body,
    footer,
    size: 'sm'
  });

  cancelButton.addEventListener('click', () => modal.close('cancel'));

  let submitting = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submitting) return;
    clearFieldError(field);

    const name = normalizeWhitespace(nameInput.value);
    if (!name) {
      setFieldError(field, 'Nama kategori wajib diisi.');
      nameInput.focus();
      return;
    }
    if (name.length > 40) {
      setFieldError(field, 'Nama kategori maksimal 40 karakter.');
      nameInput.focus();
      return;
    }

    submitting = true;
    saveButton.disabled = true;
    saveLabel.textContent = 'Menyimpan…';

    try {
      runAtomic(() => {
        const categories = getCategories();
        const duplicate = categories.find(
          (item) => item.id !== category?.id && normalizeKey(item.name) === normalizeKey(name)
        );
        if (duplicate) {
          throw new Error(`Kategori "${duplicate.name}" sudah ada. Gunakan nama lain.`);
        }

        const timestamp = new Date().toISOString();
        if (category) {
          const index = categories.findIndex((item) => item.id === category.id);
          if (index < 0) throw new Error('Kategori tidak ditemukan.');
          categories[index] = {
            ...categories[index],
            name,
            updatedAt: timestamp
          };
        } else {
          categories.push({
            id: uid('cat'),
            name,
            createdAt: timestamp,
            updatedAt: timestamp
          });
        }
        saveCategories(categories);
      });

      modal.close('saved');
      toast(category ? 'Kategori berhasil diperbarui.' : 'Kategori baru berhasil ditambahkan.', 'success');
      rerender();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Kategori gagal disimpan.', 'error');
      submitting = false;
      saveButton.disabled = false;
      saveLabel.textContent = category ? 'Simpan Perubahan' : 'Tambah Kategori';
    }
  });
}

function deleteCategory(categoryId) {
  const categories = getCategories();
  const category = categories.find((item) => item.id === categoryId);
  if (!category) {
    toast('Kategori tidak ditemukan.', 'error');
    rerender();
    return;
  }

  if (normalizeKey(category.name) === normalizeKey(FALLBACK_CATEGORY_NAME)) {
    toast('Kategori "Lainnya" adalah kategori default dan tidak dapat dihapus.', 'warning');
    return;
  }

  const productCount = getProducts().filter((product) => product.categoryId === categoryId).length;

  confirmDialog({
    title: 'Hapus kategori?',
    message: `Kategori "${category.name}" akan dihapus.`,
    details: [
      productCount > 0
        ? `${productCount} produk pada kategori ini akan dipindahkan ke kategori "Lainnya". Produk tidak dihapus.`
        : 'Tidak ada produk pada kategori ini.',
      'Tindakan ini tidak dapat dibatalkan.'
    ],
    confirmLabel: 'Hapus Kategori',
    danger: true
  }).then((confirmed) => {
    if (!confirmed) return;

    try {
      let movedProducts = 0;
      runAtomic(() => {
        const currentCategories = getCategories();
        const current = currentCategories.find((item) => item.id === categoryId);
        if (!current) throw new Error('Kategori sudah tidak ada.');
        if (normalizeKey(current.name) === normalizeKey(FALLBACK_CATEGORY_NAME)) {
          throw new Error('Kategori default tidak dapat dihapus.');
        }

        const ensured = ensureFallbackCategory(currentCategories);
        const fallbackId = ensured.fallbackId;
        const nextCategories = ensured.categories.filter((item) => item.id !== categoryId);

        const products = getProducts();
        const timestamp = new Date().toISOString();
        const nextProducts = products.map((product) => {
          if (product.categoryId !== categoryId) return product;
          movedProducts += 1;
          return { ...product, categoryId: fallbackId, updatedAt: timestamp };
        });

        saveCategories(nextCategories);
        saveProducts(nextProducts);
      });

      toast(
        movedProducts > 0
          ? `Kategori dihapus. ${movedProducts} produk dipindahkan ke "Lainnya".`
          : 'Kategori berhasil dihapus.',
        'success'
      );
      rerender();
    } catch (error) {
      toast(error.message || 'Kategori gagal dihapus.', 'error');
    }
  });
}

function buildCategoryCard(category, count, isFallback) {
  const deleteButton = el('button', {
    class: 'icon-btn danger',
    type: 'button',
    title: isFallback ? 'Kategori default tidak dapat dihapus' : 'Hapus kategori',
    'aria-label': `Hapus kategori ${category.name}`,
    disabled: isFallback,
    onClick: () => deleteCategory(category.id)
  }, icon('trash'));

  const editButton = el('button', {
    class: 'icon-btn',
    type: 'button',
    title: isFallback ? 'Kategori default tidak dapat diubah' : 'Edit kategori',
    'aria-label': `Edit kategori ${category.name}`,
    disabled: isFallback,
    onClick: () => openCategoryForm(category.id)
  }, icon('pencil'));

  return el('div', { class: `category-card ${isFallback ? 'is-default' : ''}`.trim() }, [
    el('div', { class: 'category-card-top' }, [
      el('span', { class: 'category-icon' }, icon(isFallback ? 'tag' : 'tags')),
      el('div', { class: 'category-copy' }, [
        el('strong', { text: category.name }),
        el('span', { text: count > 0 ? `${count} produk` : 'Belum ada produk' })
      ])
    ]),
    el('div', { class: 'category-card-foot' }, [
      isFallback
        ? el('span', { class: 'badge badge-neutral', text: 'Default sistem' })
        : el('span', { class: 'badge badge-info', text: `${count} produk` }),
      el('div', { class: 'category-card-actions' }, [editButton, deleteButton])
    ])
  ]);
}

export function renderCategoriesPage(container) {
  const products = getProducts();
  const categories = getCategories().slice().sort((a, b) => {
    const aFallback = normalizeKey(a.name) === normalizeKey(FALLBACK_CATEGORY_NAME);
    const bFallback = normalizeKey(b.name) === normalizeKey(FALLBACK_CATEGORY_NAME);
    if (aFallback && !bFallback) return 1;
    if (!aFallback && bFallback) return -1;
    return a.name.localeCompare(b.name, 'id-ID');
  });
  const productsByCategory = new Map();
  products.forEach((product) => {
    productsByCategory.set(product.categoryId, (productsByCategory.get(product.categoryId) || 0) + 1);
  });

  const fallback = findFallbackCategory(categories);

  const search = normalizeKey(state.search);
  const filtered = search
    ? categories.filter((category) => normalizeKey(category.name).includes(search))
    : categories;

  const searchInput = el('input', {
    class: 'input',
    id: 'category-search',
    type: 'search',
    placeholder: 'Cari kategori…',
    value: state.search,
    autocomplete: 'off'
  });
  searchInput.addEventListener('input', (event) => {
    state.search = event.target.value;
    debouncedSearch();
  });

  const toolbar = el('div', { class: 'filter-bar' }, [
    el('div', { class: 'search-box' }, [icon('search'), searchInput]),
    el('span', { class: 'filter-label', text: `${categories.length} kategori • ${products.length} produk` }),
    state.search
      ? el('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        onClick: () => {
          state.search = '';
          rerender();
        }
      }, [icon('rotate-ccw'), 'Reset'])
      : null
  ]);

  const pageHead = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-head-copy' }, [
      el('h2', { text: 'Kategori Produk' }),
      el('p', { text: 'Kelompokkan produk agar lebih mudah dicari dan dikelola. Kategori default "Lainnya" selalu tersedia.' })
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        onClick: () => openCategoryForm()
      }, [icon('plus'), 'Tambah Kategori'])
    ])
  ]);

  container.appendChild(pageHead);

  const card = el('div', { class: 'card' }, [toolbar]);

  if (!filtered.length) {
    const noCategories = categories.length === 0;
    card.appendChild(el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-icon' }, icon(noCategories ? 'tags' : 'search')),
      el('h4', { text: noCategories ? 'Belum ada kategori' : 'Kategori tidak ditemukan' }),
      el('p', {
        text: noCategories
          ? 'Tambahkan kategori untuk mengelompokkan produk Anda.'
          : 'Coba kata kunci lain atau reset pencarian.'
      }),
      noCategories
        ? el('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openCategoryForm() }, [icon('plus'), 'Tambah Kategori'])
        : el('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          onClick: () => {
            state.search = '';
            rerender();
          }
        }, [icon('rotate-ccw'), 'Reset pencarian'])
    ]));
  } else {
    card.appendChild(el('div', { class: 'category-grid' }, filtered.map((category) => (
      buildCategoryCard(
        category,
        productsByCategory.get(category.id) || 0,
        fallback?.id === category.id
      )
    ))));
  }

  container.appendChild(card);
}
