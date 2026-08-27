# Arsip Digital Biddokkes Polda Sulteng

Aplikasi web statis untuk mengelola arsip surat Biddokkes (Bidang Kedokteran dan
Kesehatan) Polda Sulawesi Tengah: kategori arsip, sampul/map surat, indeks A-Z,
dan pencarian.

## Struktur file

```
biddokkes-arsip/
├── index.html   # struktur halaman
├── styles.css   # seluruh gaya tampilan
└── script.js    # seluruh logika aplikasi (data, render, form)
```

Tiga file ini saling terhubung lewat tag `<link rel="stylesheet" href="styles.css">`
dan `<script src="script.js"></script>` di dalam `index.html`. Susunan file harus
tetap berada dalam satu folder yang sama agar tautannya tetap berfungsi.

## Cara menjalankan secara lokal

Karena ini murni HTML/CSS/JS (tanpa proses build), cukup buka `index.html`
langsung di browser, atau jalankan server statis sederhana, misalnya:

```bash
cd biddokkes-arsip
python3 -m http.server 8080
# lalu buka http://localhost:8080
```

**Penting:** buka aplikasinya di **browser sungguhan** (Chrome, Firefox, Edge)
— jangan lewat panel pratinjau bawaan VS Code (mis. ekstensi "Live Preview"
atau "Simple Browser"). Panel pratinjau semacam itu membatasi kemampuan
unduh/unggah berkas, sehingga fitur **Ekspor data** (unduh backup) dan
**unggah berkas hasil scan** bisa gagal atau berperilaku aneh (mis. isinya
malah tampil di dalam tab VS Code, bukan terunduh ke folder Downloads).
Kalau memakai Laragon, cukup akses lewat alamatnya langsung di browser
(`http://biddokkes-arsip.test` atau `http://localhost/...`), bukan dari
dalam VS Code.

## Cara hosting

Aplikasi ini bisa dihosting di layanan hosting statis apa pun, misalnya:

- **Netlify / Vercel**: drag-and-drop folder `biddokkes-arsip` (atau hubungkan
  ke repo Git yang berisi ketiga file ini).
- **GitHub Pages**: unggah ketiga file ke sebuah repository, aktifkan GitHub
  Pages dari branch tersebut.
- **Hosting/cPanel biasa**: unggah ketiga file via FTP/File Manager ke folder
  `public_html` (atau subfolder), pastikan `index.html` ada di root folder
  yang diarahkan domain/subdomain.

Tidak diperlukan konfigurasi server khusus (tidak ada backend/database di
sisi server) — semua logika berjalan di browser (client-side).

## Penyimpanan data

Aplikasi ini otomatis mendeteksi lingkungan tempatnya berjalan:

- **Dibuka sebagai artifact di Claude** → data disimpan lewat `window.storage`
  (dibagikan antar pengguna yang membuka artifact yang sama).
- **Dibuka mandiri** (langsung dari file, VS Code + Live Server, atau setelah
  dihosting) → otomatis beralih memakai `localStorage` bawaan browser, tanpa
  perlu ubah kode apa pun.

Catatan penting soal `localStorage`: data tersimpan **per browser/perangkat**,
tidak dibagikan antar pengguna atau antar perangkat. Ini cukup untuk uji coba
atau penggunaan satu komputer, tapi **untuk penggunaan resmi oleh banyak staf
Biddokkes, sebaiknya diganti ke penyimpanan terpusat**, misalnya:

- **Backend + database sendiri** (mis. Node.js/PHP + MySQL/PostgreSQL) — paling
  sesuai untuk arsip resmi karena bisa diberi hak akses, log perubahan, dan
  backup.
- **Firebase Firestore / Supabase** — cepat disiapkan tanpa membangun backend
  dari nol.

Beri tahu jika ingin dibantu menyambungkan ke salah satu opsi di atas.

## Halaman pembuka & login

Saat aplikasi dibuka, tampil animasi logo Biddokkes yang kemudian beralih ke
halaman **"Masuk ke Arsip Digital Biddokkes"**. Login memakai **Google
Identity Services** — jadi ini login Google sungguhan (bukan simulasi),
tapi butuh Anda mendaftarkan aplikasi ini ke Google Cloud Console dulu agar
tombolnya aktif:

1. Buka [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Buat project (kalau belum ada), lalu klik **Create Credentials → OAuth
   client ID**.
3. Pilih tipe **Web application**.
4. Di bagian **Authorized JavaScript origins**, tambahkan alamat tempat
   aplikasi ini dijalankan, misalnya:
   - `http://localhost` (kalau diakses lewat `http://localhost/biddokkes-arsip/`)
   - `http://biddokkes-arsip.test` (kalau memakai Auto Virtual Host Laragon)
5. Setelah dibuat, salin **Client ID** yang muncul (bentuknya
   `xxxxx.apps.googleusercontent.com`).
6. Buka `script.js`, cari baris berikut di dekat bagian atas:
   ```js
   const GOOGLE_CLIENT_ID = 'GANTI_DENGAN_CLIENT_ID_ANDA.apps.googleusercontent.com';
   ```
   Ganti dengan Client ID Anda, simpan.
7. Muat ulang halaman — tombol Google asli ("Continue with Google") akan
   otomatis muncul dan admin bisa masuk memakai akun Google sungguhan
   (nama, email, dan foto profil akan tampil di pojok kanan atas).

Selama Client ID belum diisi, aplikasi otomatis menampilkan tombol cadangan
bergaya Google (murni tampilan, tanpa verifikasi identitas nyata) supaya
Anda tetap bisa mencoba aplikasinya.

Catatan keamanan: verifikasi yang dilakukan saat ini murni di sisi browser
(client-side). Untuk keamanan tingkat produksi (memastikan token benar-benar
sah dan membatasi siapa saja yang boleh masuk), sebaiknya token yang
dihasilkan Google diverifikasi ulang di backend sebelum akses diberikan.
Beri tahu kalau ingin dibantu menyiapkan verifikasi backend tersebut.

## Unggah berkas hasil scan

Saat aplikasi dijalankan mandiri (Laragon, VS Code Live Server, atau hosting
sendiri), form "Tambah surat" menampilkan area unggah berkas (PDF/JPG/PNG,
maksimal 20 MB). Berkas disimpan lewat **IndexedDB** milik browser — jadi
tidak perlu server/database tambahan untuk fitur ini.

Yang perlu diperhatikan:
- Berkas tersimpan **per browser & per komputer**. Kalau dibuka dari komputer
  atau browser lain, berkas yang sebelumnya diunggah tidak akan terlihat
  (metadata suratnya tetap ada kalau memakai penyimpanan terpusat, tapi
  berkasnya tidak ikut pindah).
- Saat dijalankan sebagai artifact di Claude, area unggah berkas otomatis
  disembunyikan (hanya metadata teks yang bisa diisi), karena artifact Claude
  tidak mengizinkan aplikasi menyimpan berkas biner di browser.
- Untuk penggunaan resmi dengan banyak staf yang perlu mengakses berkas yang
  sama, unggahan perlu dipindahkan ke server (mis. folder di server + path-nya
  disimpan di database), bukan IndexedDB. Beri tahu kalau ingin dibantu
  membangun versi tersebut.
