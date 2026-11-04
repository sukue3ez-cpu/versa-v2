# Versa Virtual Broker — Vercel frontend + Google Sheets database

Paket ini memisahkan hosting tampilan ke Vercel, sementara backend dan database tetap di Google Apps Script + Google Sheets.

## Struktur
- `Index.html`: tampilan website yang di-host Vercel.
- `api/gas.js`: Vercel serverless proxy untuk meneruskan permintaan ke Apps Script.
- `Code.gs`: backend Apps Script dan endpoint JSON `doPost`.
- `vercel.json`: konfigurasi hosting Vercel.

## A. Siapkan Google Sheets dan Apps Script
1. Buka project Apps Script yang terhubung ke spreadsheet.
2. Ganti isi `Code.gs` dengan `Code.gs` dari paket ini.
3. Pertahankan file `Index` lama jika masih ingin membuka tampilan lama dari Apps Script; frontend Vercel memakai `Index.html` miliknya sendiri.
4. Di **Project Settings → Script Properties**, pastikan sudah ada:
   - `SPREADSHEET_ID` = ID spreadsheet
   - `OWNER_EMAIL` = email owner
   - `OWNER_PASSWORD` = password owner yang kuat dan unik
5. Jalankan `setupDatabase()` sekali dari editor dan berikan izin.
6. Klik **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Salin URL Web App yang berakhir dengan `/exec`.

## B. Upload ke GitHub
1. Buat repository GitHub baru, misalnya `versa-virtual-broker`.
2. Upload semua isi folder paket ini ke root repository. Pastikan `api/gas.js` berada di folder `api`.
3. Jangan mengunggah file rahasia atau password.

## C. Deploy ke Vercel
1. Buka https://vercel.com/ dan login dengan GitHub.
2. Pilih **Add New → Project**, lalu import repository tadi.
3. Pada **Environment Variables**, tambahkan:
   - Name: `GAS_WEB_APP_URL`
   - Value: URL Apps Script `/exec` yang disalin pada langkah A.
4. Klik **Deploy**.
5. Setelah selesai, buka domain `.vercel.app` yang diberikan Vercel.

## D. Jika Apps Script diperbarui
Setiap kali mengubah `Code.gs`, buat deployment versi baru:
**Deploy → Manage deployments → Edit → New version → Deploy**.
Jika URL `/exec` berubah, perbarui `GAS_WEB_APP_URL` di Vercel lalu redeploy.

## Pemeriksaan jika error
- `GAS_WEB_APP_URL belum diatur`: environment variable belum dibuat atau salah nama.
- `Apps Script tidak mengembalikan JSON`: pastikan URL berakhir `/exec`, deployment Web App aktif, dan aksesnya sesuai.
- `Aksi API tidak diizinkan`: nama fungsi frontend tidak masuk daftar izin di `doPost`.
- Error spreadsheet: periksa `SPREADSHEET_ID` di Script Properties dan izin akses spreadsheet untuk akun pemilik Apps Script.

## Batasan dan keamanan
Ini tetap portal demo/pencatatan, bukan broker resmi, bukan payment gateway, dan tidak memproses uang sungguhan. Jangan gunakan untuk menerima deposit atau melakukan penarikan nyata. Jangan simpan kredensial broker sungguhan. Batasi akses spreadsheet hanya untuk pemilik. Sebelum dipakai publik, lakukan audit keamanan, rate limiting, perlindungan penyalahgunaan registrasi, dan pengujian hak akses.


## Pembaruan deposit & withdraw (SIMULASI)
- Deposit: nomor pembayaran tidak ditampilkan sebelum tombol Konfirmasi. Setelah konfirmasi, aplikasi menampilkan instruksi placeholder simulasi atas nama Kamsih; tidak ada rekening/nomor aktif atau pembayaran sungguhan.
- Member dapat mengunggah gambar bukti simulasi (JPG/PNG/WEBP, maks. sekitar 1,3 MB). File disimpan di folder Google Drive privat milik owner; owner melihat tautan pada daftar deposit.
- Status deposit berubah dari `awaiting_proof` menjadi `pending` setelah bukti diunggah.
- Withdraw: tab Withdraw berada di samping Deposit. Minimal Rp160.000, maksimal saldo akun IDR yang tersedia. Owner dapat menyetujui/menolak; persetujuan hanya mengurangi saldo simulasi.
- Jalankan `setupDatabase()` lagi setelah memperbarui `Code.gs`; kolom bukti dan sheet Withdrawals akan ditambahkan tanpa menghapus data lama.
- Setelah mengubah `Code.gs`, deploy Apps Script sebagai versi baru. Push `Index.html` ke GitHub agar Vercel ikut memperbarui tampilan.

Catatan: fitur-fitur ini adalah alur simulasi/pencatatan, bukan payment gateway, bukan layanan broker resmi, dan tidak mengirim atau menerima uang sungguhan.
