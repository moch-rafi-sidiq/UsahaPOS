# UsahaPOS — Sistem Kasir UMKM

Aplikasi kasir (POS) sederhana untuk usaha mikro, kecil, dan menengah yang berjalan sepenuhnya di browser. UsahaPOS dibuat dengan HTML5, CSS3, dan JavaScript murni tanpa framework, tanpa server, dan tanpa koneksi internet setelah halaman dimuat.

**Demo online:** <https://moch-rafi-sidiq.github.io/UsahaPOS/>

## Fitur

- **Dashboard** — ringkasan omzet hari ini, laba kotor, jumlah transaksi, produk aktif, peringatan stok, grafik 7 hari, transaksi terbaru, dan produk terlaris.
- **Kasir** — katalog produk dengan pencarian dan filter kategori, keranjang, pengaturan jumlah, diskon nominal, pembayaran tunai/QRIS/transfer/kartu, hitung kembalian, validasi stok, dan struk.
- **Produk** — tambah, ubah, lihat detail, aktif/nonaktif, pencarian, filter, pengurutan, dan pagination. Produk yang sudah dipakai transaksi tidak dapat dihapus; gunakan nonaktifkan agar riwayat tetap utuh.
- **Kategori** — CRUD kategori dan pemindahan produk ke kategori `Lainnya` saat kategori dihapus. Kategori `Lainnya` dilindungi sebagai kategori cadangan.
- **Stok Barang** — ringkasan stok, filter stok menipis/habis, penambahan dan pengurangan stok manual, riwayat pergerakan stok, serta pencatatan stok sebelum dan sesudah perubahan.
- **Transaksi** — riwayat transaksi, pencarian, filter tanggal/metode/status, pengurutan, detail transaksi, cetak ulang struk, dan pembatalan transaksi.
- **Pembatalan aman** — stok dikembalikan tepat satu kali, transaksi tetap tersimpan dengan status Dibatalkan, dan transaksi tersebut tidak dihitung dalam omzet, laba, maupun laporan.
- **Laporan** — periode hari ini, 7 hari, 30 hari, bulan ini, bulan lalu, atau rentang kustom; ringkasan omzet, diskon, HPP, laba kotor, komposisi metode pembayaran, rekap harian, dan produk terlaris.
- **Ekspor CSV** — rekap harian dengan UTF-8 BOM, kolom konsisten, dan perlindungan formula injection.
- **Pengaturan** — identitas usaha, pesan struk, format Rupiah, batas minimum stok default, ringkasan penyimpanan, ekspor/impor backup JSON, muat/hapus data demo, dan reset total.
- **Responsif** — sidebar drawer di perangkat kecil, tabel yang dapat digulir, serta keranjang kasir yang dapat dibuka di ponsel.

## Menjalankan Secara Lokal

Aplikasi menggunakan ES modules, sehingga **tidak dapat dibuka langsung dengan `file://`**. Gunakan web server lokal.

### Opsi 1 — VS Code Live Server

1. Buka folder proyek ini di VS Code.
2. Pasang ekstensi **Live Server**.
3. Klik kanan `index.html`, lalu pilih **Open with Live Server**.

### Opsi 2 — Python

```bash
python -m http.server 4173
```

Buka <http://localhost:4173/> di browser.

### Opsi 3 — Node.js

```bash
npx serve .
```

Tidak ada proses build, dependensi npm, atau konfigurasi tambahan yang diperlukan.

## Struktur Proyek

```text
UsahaPOS/
├── index.html
├── css/
│   ├── style.css
│   ├── responsive.css
│   └── print.css
└── js/
    ├── app.js            # Inisialisasi aplikasi dan navigasi
    ├── router.js         # Hash router
    ├── storage.js        # Skema LocalStorage, snapshot, impor/ekspor
    ├── demo-data.js      # Data demo yang konsisten
    ├── utils.js          # Helper DOM, format, modal, CSV
    ├── calculations.js   # Perhitungan keranjang, laporan, dashboard
    ├── dashboard.js
    ├── cashier.js
    ├── receipt.js
    ├── products.js
    ├── categories.js
    ├── inventory.js
    ├── transactions.js
    ├── reports.js
    └── settings.js
```

## Data dan LocalStorage

Semua data disimpan di **LocalStorage browser** milik pengunjung. Tidak ada backend, akun, atau sinkronisasi antarbrowser/perangkat.

Kunci penyimpanan memakai prefiks `usahapos:v1:`:

| Kunci | Isi |
| --- | --- |
| `usahapos:v1:categories` | Kategori produk |
| `usahapos:v1:products` | Produk dan stok terkini |
| `usahapos:v1:transactions` | Transaksi beserta snapshot item |
| `usahapos:v1:stock_movements` | Riwayat pergerakan stok |
| `usahapos:v1:settings` | Identitas usaha dan preferensi |
| `usahapos:v1:meta` | Metadata inisialisasi, demo, dan impor |

Data demo hanya ditanam **satu kali** saat LocalStorage masih kosong dan belum pernah diinisialisasi. Memuat ulang halaman tidak akan menambahkan data demo berulang kali. Reset total tidak memuat data demo kembali secara otomatis; data demo dapat dimuat manual dari halaman **Pengaturan** ketika belum ada produk/transaksi.

Snapshot transaksi menyimpan nama produk, SKU, kategori, harga jual, harga modal, jumlah, dan subtotal pada saat transaksi. Karena itu, perubahan harga produk setelah transaksi tidak mengubah laporan lama. Laba kotor dihitung dari **total setelah diskon dikurangi HPP snapshot**.

Penulisan transaksi dan pembatalan memakai mekanisme snapshot/rollback multi-key. Jika penyimpanan gagal di tengah proses, data dikembalikan ke kondisi sebelumnya; keranjang tidak dikosongkan dan aplikasi tidak menampilkan klaim berhasil.

## Backup, Impor, dan Reset

- **Ekspor cadangan** mengunduh file JSON berisi kategori, produk, transaksi, pergerakan stok, dan pengaturan.
- **Impor** memvalidasi struktur file terlebih dahulu. Tersedia dua mode:
  - **Gabungkan** — menambahkan data baru, melewati produk/transaksi duplikat, dan mempertahankan pengaturan saat ini.
  - **Ganti seluruh data** — mengganti seluruh data dengan isi file dan meminta konfirmasi ketik `GANTI`.
- **Reset seluruh data** menghapus semua data dari browser dan meminta konfirmasi ketik `RESET`.
- **Hapus data demo** hanya menghapus data milik demo. Produk demo yang masih dipakai transaksi pengguna akan dipertahankan.

## Cetak Struk

Struk menggunakan dialog cetak browser (`window.print()`), sehingga hasil akhir bergantung pada pengaturan printer, ukuran kertas, margin, dan opsi “Print backgrounds” pada browser. Aplikasi tidak dapat memastikan bahwa dokumen benar-benar keluar dari printer.

## Batasan

- Data terikat pada browser dan perangkat yang digunakan. Membuka situs dari browser lain akan menampilkan data kosong atau data demo baru.
- Menghapus data situs, menggunakan mode privat, atau membersihkan penyimpanan browser akan menghapus data. Unduh backup secara rutin.
- Kapasitas LocalStorage umumnya sekitar 5 MB per origin browser.
- Aplikasi tidak memverifikasi pembayaran QRIS, transfer bank, atau kartu. Metode non-tunai hanya dicatat sebagai pilihan pembayaran.
- Tidak ada autentikasi, hak akses pengguna, atau sinkronisasi multi-perangkat.
- Laporan CSV berisi rekap harian, bukan rincian setiap item transaksi.
- Format struk mengikuti dialog cetak browser, bukan driver printer khusus.

## Skenario Uji Manual

1. **Kasir:** tambah beberapa produk, ubah jumlah, beri diskon, bayar tunai dengan uang lebih, pastikan kembalian dan struk benar, lalu cek stok berkurang.
2. **Stok:** tambah/kurangi stok dari halaman Stok Barang, cek riwayat pergerakan, dan pastikan stok tidak dapat menjadi negatif.
3. **Transaksi & laporan:** batalkan transaksi, cek stok kembali satu kali, dan pastikan omzet/laba laporan tidak lagi memuat transaksi batal.
4. **Backup:** ekspor JSON, reset data, lalu impor kembali menggunakan mode ganti; bandingkan jumlah data.
5. **Isolasi data:** muat ulang halaman setelah reset dan pastikan data demo tidak muncul otomatis.
6. **Responsif:** uji sidebar, tabel, kasir, dan keranjang pada lebar 390 px, 768 px, dan desktop.

## Deployment

Situs ini diterbitkan melalui **GitHub Pages** dari branch `main`, folder root. Setiap perubahan yang di-push ke `main` akan diterbitkan ulang secara otomatis.

URL: <https://moch-rafi-sidiq.github.io/UsahaPOS/>

## Teknologi

- HTML5 semantik
- CSS3 (custom properties, grid, flexbox, media queries, print stylesheet)
- JavaScript ES modules
- LocalStorage API
- SVG sprite lokal untuk ikon
- Tanpa framework, tanpa CDN, dan tanpa dependensi runtime
