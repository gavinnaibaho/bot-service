# 🍀 Bum Service — Bot Toko Bum Store

Bot Discord untuk server **MARDY BUM / Bum Store**: jual-beli Robux, Gift In Game, Joki / Boosting, dan Middleman (rekber) lewat tiket. Semua tampilan dalam Bahasa Indonesia.

Bot ini berdiri sendiri. Keamanan anti-spam ditangani bot terpisah, **Bum Security** ([Honeypot](https://github.com/RiskyMH/honeypot)).

---

## Daftar Isi

1. [Ringkasan command](#ringkasan-command)
2. [Command admin](#command-admin)
3. [Command member](#command-member)
4. [Tombol di panel & tiket](#tombol-di-panel--tiket)
5. [Alur pesanan](#alur-pesanan)
6. [Setup](#setup)
7. [Catatan](#catatan)

---

## Ringkasan command

Ada **20 slash command**: 15 khusus admin dan 5 untuk semua member.

| Command | Siapa | Fungsi singkat |
|---|---|---|
| `/toko-setup` | Admin | Pengaturan dasar toko |
| `/setup-harga` | Admin | Atur harga per 100 Robux & kirim daftar harga |
| `/open` | Admin | Buka toko |
| `/close` | Admin | Tutup toko |
| `/toko-panel` | Admin | Kirim panel order |
| `/middleman-panel` | Admin | Kirim panel middleman |
| `/toko-set-pembayaran` | Admin | Atur QRIS & rekening / e-wallet |
| `/status-channel` | Admin | Channel status otomatis 🟢/🔴 |
| `/announce` | Admin | Kirim pengumuman |
| `/kirim-pesan` | Admin | Kirim pesan teks atas nama bot |
| `/loyalitas` | Admin | Kelola role loyalitas |
| `/toko-statistik` | Admin | Statistik penjualan |
| `/pesanan` | Admin | Detail satu pesanan |
| `/toko-hapus-pembeli` | Admin | Hapus data satu pembeli |
| `/toko-reset-tiket` | Admin | Hapus semua data pesanan |
| `/toko-pembayaran` | Semua | Tampilkan metode pembayaran |
| `/harga` | Semua | Cek harga semua layanan |
| `/kalkulator` | Semua | Hitung harga satu layanan |
| `/riwayat` | Semua | Riwayat pesanan (admin: bisa lihat pembeli lain) |
| `/leaderboard` | Semua | Top 10 pembeli |

> Command admin hanya muncul untuk akun dengan izin **Manage Server**. Tombol admin di tiket juga bisa dipakai role yang diatur di `role_admin`.

---

## Command admin

### Pengaturan toko

#### `/toko-setup`
Pengaturan dasar toko. Semua opsi bersifat opsional, opsi yang tidak diisi tetap memakai nilai sebelumnya.

| Opsi | Fungsi |
|---|---|
| `role_admin` | Role yang boleh memproses order & memakai tombol admin di tiket |
| `kategori_tiket` | Kategori tempat channel tiket order, tanya, dan middleman dibuat |
| `channel_log` | Channel log khusus admin (order baru, konfirmasi, selesai, batal, buka/tutup, dll.) |
| `channel_testimoni` | Channel publik untuk vouch dari pembeli |
| `channel_pengumuman` | Channel tempat pengumuman OPEN / CLOSE dikirim |
| `channel_riwayat` | Channel publik riwayat transaksi selesai & tiket ditutup |
| `channel_leaderboard` | Channel leaderboard top pembeli, diperbarui otomatis |
| `nama_toko` | Nama toko di panel, pengumuman, vouch, riwayat |
| `role_ping` | Role yang di-ping saat toko buka |
| `warna` | Warna garis semua pesan bot, kode hex (contoh `#FF8FC7`) |
| `gig_aktif` | Aktifkan / matikan layanan Gift In Game |
| `joki_aktif` | Aktifkan / matikan layanan Joki / Boosting |
| `minimal_order` / `maksimal_order` | Batas Robux per order (tidak berlaku untuk GIG & Joki) |
| `ganti_nama_channel` | Ganti nama channel panel jadi 🟢/🔴 saat buka/tutup |

#### `/setup-harga metode harga [channel]`
Atur harga per **100 Robux** untuk satu layanan, lalu kirim daftar harga ke channel:

```
⏣ 100 Robux — Rp 15.500
⏣ 200 Robux — Rp 31.000
…
⏣ 5.000 Robux — Rp 775.000
```

- `metode`: Via Login, Via Send Username, Group Payout, atau Gift In Game (GIG).
- Daftar harga otomatis diperbarui setiap harga diubah.
- `harga:0` mematikan layanan itu dan menghapus daftar harganya.
- Khusus GIG, `harga:0` mengembalikan GIG ke **harga manual**: admin mengisi total saat konfirmasi bayar. GIG tetap aktif. Untuk mematikan GIG, pakai `/toko-setup gig_aktif:False`.

#### `/toko-set-pembayaran [qris] [lainnya] [hapus_qris] [hapus_lainnya]`
Atur metode pembayaran tanpa form.

| Opsi | Fungsi |
|---|---|
| `qris` | Upload gambar QRIS. Disimpan di database, jadi tidak kedaluwarsa |
| `lainnya` | Rekening / e-wallet, dipisah titik koma. Contoh: `BCA 1234567890 a.n. Gavin; DANA 08xxxx a.n. Gavin` |
| `hapus_qris` | Hapus gambar QRIS |
| `hapus_lainnya` | Hapus daftar rekening / e-wallet |

Opsi yang tidak diisi tidak berubah. Tanpa opsi apa pun, bot hanya menampilkan pengaturan saat ini. QRIS dan daftar rekening otomatis tampil di setiap tiket order & middleman.

#### `/status-channel atur | hapus | daftar`
Hubungkan channel (misalnya voice channel di kategori SERVER STATS) supaya namanya otomatis berganti sesuai status:

```
🟢 ┃ BUM STORE ┃ OPEN        🔴 ┃ BUM STORE ┃ CLOSE
🟢 ┃ ROBUX USERNAME          🔴 ┃ ROBUX USERNAME
```

- `atur layanan channel`: pilih Toko (OPEN / CLOSE), Robux Via Username, Robux Via Login, Group Payout, Gift In Game, atau Joki / Boosting.
- `hapus layanan`: lepas channel dari status otomatis.
- `daftar`: lihat channel yang terhubung.

Layanan dianggap tersedia hanya jika toko buka **dan** layanannya aktif.

### Buka / tutup & panel

#### `/open`
Buka toko:
- tombol order di panel aktif lagi
- panel dikirim ulang dengan status 🟢 Buka
- pengumuman OPEN dikirim ke channel pengumuman dengan ping `role_ping`
- channel status berubah 🟢

#### `/close [alasan]`
Tutup toko:
- semua tombol order nonaktif
- panel dikirim ulang dengan status 🔴 Tutup
- pengumuman CLOSE dikirim
- channel status berubah 🔴

Tiket yang sedang berjalan tetap bisa diproses.

#### `/toko-panel`
Kirim panel order ke channel saat ini. Panel lama dihapus otomatis. Isinya: status toko, daftar layanan (yang nonaktif dicoret), alur pemesanan, dan tombol per layanan + **❓ Tanya**.

#### `/middleman-panel [biaya]`
Kirim panel tiket middleman (rekber) ke channel saat ini. Opsi `biaya` menampilkan tarif jasa, contoh `5% (min. Rp5.000)`. Panel lama dihapus otomatis.

### Pengumuman & pesan

#### `/announce [channel] [ping] [role] [warna] [gambar]`
Membuka form pengumuman (judul, isi, link gambar).

| Opsi | Fungsi |
|---|---|
| `channel` | Tujuan. Default: channel pengumuman toko |
| `ping` | Tidak ada, @everyone, @here, role ping toko, atau role pilihan |
| `role` | Role yang di-ping kalau `ping` = Role pilihan |
| `warna` | Pink muda (default), Hijau, Merah, Kuning, Biru, Ungu |
| `gambar` | Upload banner langsung |

#### `/kirim-pesan [channel]`
Kirim pesan teks biasa atas nama bot, tanpa kotak embed, maksimal 2.000 karakter. Cocok untuk rules dan FAQ.

### Loyalitas

#### `/loyalitas atur | hapus | daftar | sinkron`
Role otomatis berdasarkan **total belanja dalam Rupiah** (semua layanan, termasuk GIG & Joki).

| Subcommand | Fungsi |
|---|---|
| `atur role minimal_belanja` | Daftarkan role, misalnya `role:@💵 · ᴇᴀʀɴᴇʀ minimal_belanja:100000` |
| `hapus role` | Hapus role dari daftar (role yang sudah diberikan tidak dicabut) |
| `daftar` | Lihat semua role loyalitas & batasnya |
| `sinkron` | Cek ulang semua customer dan beri role yang belum mereka punya |

Role dicek setiap admin menekan tombol **Selesai** di tiket. Pakai `sinkron` setelah menambah role baru atau memperbaiki posisi role bot.

> Role bot (**Bum**) harus berada **di atas semua role loyalitas** dan punya izin **Manage Roles**, atau role gagal diberikan.

### Data & statistik

#### `/toko-statistik`
Panel admin: pendapatan hari ini, 7 hari, dan 30 hari (WIB), jumlah pesanan tertunda, dan top pembeli.

#### `/pesanan id`
Detail satu pesanan berdasarkan nomornya (tanpa `#`), termasuk waktu dibuat dan link tiketnya.

#### `/toko-hapus-pembeli pembeli konfirmasi:HAPUS`
Hapus semua pesanan satu pembeli dari data, misalnya akun percobaan:
- hilang dari leaderboard, statistik, dan `/riwayat`
- role loyalitasnya dicabut
- ditolak kalau pembeli masih punya pesanan aktif
- pesan lama di channel vouch / riwayat tidak ikut terhapus

#### `/toko-reset-tiket konfirmasi:RESET`
Hapus **semua** data pesanan dan mulai nomor pesanan dari `#0001` lagi. Pengaturan toko, harga, dan role loyalitas tetap. Ditolak kalau masih ada pesanan aktif. **Tidak bisa dibatalkan.**

---

## Command member

#### `/toko-pembayaran`
Tampilkan metode pembayaran toko di channel, sebagai pesan biasa tanpa kotak:

```
💳 Metode Pembayaran
📷 QRIS — scan gambar di bawah

BCA 1234567890 a.n. Gavin
DANA 08xxxx a.n. Gavin
-# Bum Store • Pastikan nama penerima sesuai sebelum transfer
(gambar QRIS)
```

#### `/harga jumlah`
Hitung harga sejumlah Robux untuk **semua** layanan yang aktif. Hanya terlihat oleh pemakai.

#### `/kalkulator layanan jumlah [rate]`
Hitung harga **satu** layanan. Hasilnya terlihat di channel, cocok dipakai admin di tiket.

```
/kalkulator layanan:Via Send Username jumlah:3500
```
```
🍀 Bum Store · Via Send Username
───────────────
⏣ 3.500 Robux × Rp155
───────────────
Total: Rp542.500
```

- `layanan`: Via Send Username, Via Login, Group Payout, Gift In Game (GIG).
- `rate` (opsional): Rupiah per 1 Robux, misalnya `94`. Kalau kosong, bot memakai rate toko dari `/setup-harga`.

#### `/riwayat [pembeli]`
- **Member**: 10 pesanan terakhir milik sendiri, total belanja, dan total Robux yang pernah dibeli.
- **Admin**: isi `pembeli:@user` untuk melihat riwayat pembeli lain.

Hanya terlihat oleh pemakai.

#### `/leaderboard`
Top 10 pembeli berdasarkan total belanja, plus jumlah customer dan total spending toko.

---

## Tombol di panel & tiket

| Tombol | Lokasi | Siapa | Fungsi |
|---|---|---|---|
| Robux · Via Username / Via Login / Group Payout, Gift In Game, Joki / Boosting | Panel toko | Member | Buka form order lalu buat tiket. Nonaktif saat toko tutup atau layanan dimatikan |
| ❓ Tanya | Panel toko | Member | Buat tiket pertanyaan (satu per member) |
| Tutup Tiket | Tiket tanya | Pemilik / admin | Tutup tiket pertanyaan |
| ✅ Konfirmasi Bayar (Admin) | Tiket order | Admin | Tandai pembayaran diterima. GIG tanpa tarif & Joki: admin isi total harga |
| Robux Terkirim (Selesai) / Joki Selesai | Tiket order | Admin | Selesaikan pesanan: riwayat, leaderboard, role loyalitas diperbarui |
| ✖️ Batalkan (Admin) | Tiket order | Admin | Batalkan pesanan |
| 🔒 Tutup Tiket (Admin) | Tiket order | Admin | Tutup tiket setelah selesai / batal |
| ⭐ Beri Testimoni | Tiket order | Pembeli | Kirim rating & ulasan ke channel vouch |
| 🤝 Buka Tiket Middleman | Panel middleman | Member | Isi form rekber, bot buat tiket `#mm-` untuk kedua pihak + admin |
| ✅ Transaksi Selesai / ✖️ Batalkan (Admin) | Tiket middleman | Admin | Tandai rekber selesai (tercatat di riwayat) atau batal |
| 🔒 Tutup Tiket (Admin) | Tiket middleman | Admin | Tutup tiket middleman |

Member **tidak bisa** membatalkan atau menutup tiket order sendiri. Satu member hanya bisa punya satu pesanan aktif, satu tiket tanya, dan satu tiket middleman aktif.

---

## Alur pesanan

```
Member klik tombol layanan di panel → isi form
   (Robux: jumlah, username, catatan | GIG: map/game, item, jumlah Robux, username
    | Joki: game, rank sekarang → target, akun, catatan)
        ↓
Bot membuat tiket #order-0001-nama  →  ⏳ Menunggu pembayaran
   (tiket berisi total harga, QRIS, dan daftar rekening)
        ↓  pembeli transfer & kirim foto bukti di chat tiket
        ↓  admin cek bukti → ✅ Konfirmasi Bayar
⚙️ Diproses  (admin mengirim Robux / item / mengerjakan joki)
        ↓  admin → Robux Terkirim (Selesai)
✅ Selesai  →  riwayat transaksi, leaderboard, role loyalitas, tombol ⭐ Testimoni & 🔒 Tutup Tiket
```

---

## Setup

1. **Buat aplikasi bot** di [Discord Developer Portal](https://discord.com/developers/applications), terpisah dari bot honeypot. Salin token-nya. Tidak perlu privileged intent.
2. **Invite bot** (ganti `CLIENT_ID` dengan Application ID):
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=268692496
   ```
   Izin: Manage Channels, Manage Roles, View Channels, Send Messages, Manage Messages, Embed Links, Attach Files, Read Message History, Mention Everyone.
3. **Jalankan** (butuh [Bun](https://bun.sh) v1.2+):
   ```bash
   cp .env.example .env   # isi DISCORD_TOKEN dan GUILD_ID
   bun install
   bun start
   ```
   Di Wispbyte: egg Bun, Main File `src/index.ts`, Auto Update aktif. File `.env` hanya ada di hosting, **jangan** di-upload ke GitHub.
4. **Di server**, urutan setup:
   ```
   /toko-setup role_admin:@Admin kategori_tiket:TICKETING channel_log:#ticket-logs channel_testimoni:#vouch
   /toko-setup nama_toko:Bum Store role_ping:@Notif channel_pengumuman:#announcement channel_riwayat:#transaction-history channel_leaderboard:#leaderboard
   /toko-set-pembayaran qris:<gambar> lainnya:BCA 123 a.n. Nama; DANA 08xx a.n. Nama
   /setup-harga metode:Via Send Username harga:15500 channel:#robux-username
   /setup-harga metode:Via Login harga:... channel:#robux-instant
   /setup-harga metode:Group Payout harga:... channel:#robux-community-payout
   /setup-harga metode:Gift In Game (GIG) harga:... channel:#robux-gift-in-game
   /loyalitas atur role:@💵 · ᴇᴀʀɴᴇʀ minimal_belanja:100000   (ulangi untuk tiap tingkat)
   /status-channel atur layanan:Toko channel:<voice channel>   (ulangi untuk tiap layanan)
   /toko-panel            ← di #ticket-order
   /middleman-panel       ← di #ticket-middleman
   ```
5. **Server Settings → Roles**: taruh role **Bum** di atas semua role loyalitas.

---

## Catatan

- Bukti pembayaran cukup dikirim sebagai foto di chat tiket. Bot tidak membaca isi pesan, jadi tidak butuh Message Content Intent.
- Form **Via Login** dan **Joki** tidak pernah meminta password. Data login dikirim pembeli langsung di tiket privat.
- Discord membatasi ganti nama channel sekitar 2 kali per 10 menit. Kalau `/open` dan `/close` dipakai berulang dalam waktu singkat, nama channel status akan menyusul belakangan.
- "Hari ini" di statistik dihitung dalam WIB.
- Database default `toko.sqlite`. Bisa diganti ke PostgreSQL lewat `DATABASE_URL`.
- Jangan mengedit kode langsung di hosting. Ubah lewat GitHub, lalu restart bot (Auto Update akan menarik kode terbaru).
- ⚠️ Jual-beli Robux di luar jalur resmi Roblox berisiko melanggar Terms of Use Roblox.

### Struktur kode

```
src/
  index.ts        koneksi Discord & pendaftaran command
  interaction.ts  logika command, tombol, dan form
  commands.ts     definisi slash command
  ui.ts           embed, tombol, panel, modal
  pricing.ts      perhitungan harga & kalkulator
  db.ts           database (SQLite default) + migration
tests/
  toko.test.ts    tes alur database & harga (bun test)
```
