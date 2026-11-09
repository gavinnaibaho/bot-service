# 🛒 Toko Robux Bot

Bot Discord untuk melayani jual-beli Robux di server: tiket order, pembayaran manual, buka/tutup toko, vouch, riwayat transaksi, leaderboard, role loyalitas, dan statistik penjualan. Semua tampilan dalam Bahasa Indonesia.

Bot ini **berdiri sendiri**. Untuk keamanan anti-spam, jalankan bot [Honeypot](https://github.com/RiskyMH/honeypot) secara terpisah.

## Fitur

| Fitur | Keterangan |
|---|---|
| 🟢🔴 Buka/tutup | `/open` dan `/close [alasan]` secara manual. Pengumuman OPEN/CLOSE otomatis (ping role saat buka), tombol Beli nonaktif saat tutup, dan nama channel panel berganti 🟢/🔴 |
| 🛒 Order Center | Panel bergaya profesional: status buka/tutup, daftar layanan (Robux & Layanan Lain), alur pemesanan, catatan keamanan, dan tombol langsung per layanan + **❓ Tanya**. Layanan nonaktif dicoret dan tombolnya bertanda **(Tidak Tersedia)**; saat toko tutup semua tombol order nonaktif. Otomatis diperbarui |
| ❓ Tiket Tanya | Tombol Tanya membuat tiket pertanyaan privat (pembeli + admin) yang bisa ditutup kapan saja |
| 🎫 Tiket order | Setiap pesanan membuat channel privat (pembeli + admin) |
| 🚚 4 metode | 🔐 **Via Login**, 👤 **Via Send Username**, 👥 **Group Payout** (harga tetap per 100 R$) dan 🎁 **Gift In Game / GIG** (harga dihitung manual oleh admin) |
| 💰 Daftar harga | `/setup-harga` mengatur harga satu metode dan mengirim daftar harga (`⏣ 100 Robux — Rp 15.500` … `⏣ 5.000 Robux`) ke channel pilihan. Daftar otomatis diperbarui saat harga diubah |
| 🏆 Joki / Boosting | Form: nama game, rank/level sekarang, target, nickname/ID akun, catatan. Harga & estimasi waktu dihitung admin, diisi saat konfirmasi bayar. Aktif/nonaktif lewat `/toko-setup joki_aktif` |
| 🎁 Order GIG | Form khusus: nama map/game, nama item, jumlah Robux, username. Saat konfirmasi bayar, admin mengisi total harga secara manual |
| 💳 Bayar manual | Pembeli kirim foto bukti transfer langsung di chat tiket, admin cek lalu klik **Konfirmasi Bayar** |
| 🧮 Kalkulator | `/harga jumlah:1000` menampilkan harga semua metode berharga tetap |
| 🏅 Loyalitas | Role otomatis berdasarkan total belanja (Rupiah) dari semua layanan, termasuk GIG & Joki. Contoh: `@Customer` mulai Rp1 |
| 💎 Vouch | Setelah selesai, pembeli kirim rating + ulasan; tampil sebagai **NEW VOUCH** lengkap dengan avatar, nominal, dan status |
| ⭐ Riwayat transaksi | Channel publik berisi **Transaksi selesai** (pembeli, jenis order, nominal, total transaksi pembeli, admin yang memproses) dan **Tiket Ditutup** |
| 🏆 Leaderboard | Top 10 pembeli berdasarkan total belanja + jumlah customer & total spending. Pesan di channel leaderboard otomatis diperbarui setiap transaksi selesai; bisa juga dilihat dengan `/leaderboard` |
| 📊 Panel admin | `/toko-statistik`: pendapatan hari ini/7/30 hari, pesanan tertunda, top pembeli |
| 📢 Pengumuman | `/announce`: form judul, isi, dan gambar; pilih channel, warna, dan ping (@everyone, @here, role ping toko, atau role lain) |
| 🎨 Warna toko | Semua pesan bot (panel, tiket, log, vouch, riwayat, leaderboard, pengumuman) memakai satu warna yang sama. Atur dengan `/toko-setup warna:#FF8FC7` |
| 📝 Log | Semua kejadian (order baru, konfirmasi, selesai, batal, buka/tutup) dicatat ke channel log |

## Alur pesanan

```
Pembeli klik 🛒 Order Sekarang → pilih layanan → isi form
        (GIG: map/game, item, jumlah Robux, username | Joki: game, rank sekarang → target, akun, catatan | lainnya: jumlah, username, catatan)
        ↓
Bot membuat tiket #order-0001-nama  →  ⏳ Menunggu pembayaran
        ↓  pembeli transfer & kirim foto bukti di chat tiket
        ↓  admin cek bukti, klik ✅ Konfirmasi Bayar
⚙️ Diproses  (admin mengirim Robux/item sesuai metode; untuk GIG admin mengisi total harga saat konfirmasi)
        ↓  admin: Robux Terkirim (Selesai)
✅ Selesai  →  riwayat transaksi, leaderboard diperbarui, role loyalitas, tombol ⭐ Testimoni & 🔒 Tutup Tiket (admin)
```

Tiket pesanan hanya bisa **dibatalkan dan ditutup oleh admin**. Satu pembeli hanya boleh punya satu pesanan aktif dan satu tiket Tanya yang terbuka (tiket Tanya bisa ditutup sendiri oleh pembeli).

## Perintah

**Admin** (butuh izin *Manage Server*; tombol di tiket juga bisa dipakai role admin toko)

| Perintah | Fungsi |
|---|---|
| `/toko-setup` | Role admin, kategori tiket, channel log & testimoni, GIG & Joki aktif/nonaktif, min/maks order. Juga nama toko, role ping, channel pengumuman, riwayat, leaderboard, dan pilihan ganti nama channel. Opsi yang tidak diisi tetap seperti sebelumnya |
| `/setup-harga metode harga channel` | Atur harga per 100 R$ untuk Via Login / Via Send Username / Group Payout dan kirim daftar harganya ke channel. `harga:0` = nonaktifkan metode & hapus daftarnya |
| `/open` | Buka toko |
| `/close alasan` | Tutup toko (alasan opsional). Tiket yang sedang berjalan tetap bisa diproses |
| `/announce [channel] [ping] [role] [warna] [gambar]` | Kirim pengumuman penting lewat form. Opsi `gambar` untuk upload banner langsung. Channel default = channel pengumuman toko |
| `/kirim-pesan [channel]` | Kirim pesan teks biasa atas nama bot (tanpa embed), maks. 2000 karakter |
| `/toko-pembayaran` | Isi info pembayaran (rekening, e-wallet, link QRIS) |
| `/toko-panel` | Kirim panel toko ke channel saat ini |
| `/toko-statistik` | Panel admin |
| `/pesanan id` | Detail pesanan |
| `/loyalitas atur\|hapus\|daftar` | Kelola role loyalitas |

**Member**: `/harga`, `/riwayat`, `/leaderboard`.

## Setup

1. **Buat aplikasi bot baru** di [Discord Developer Portal](https://discord.com/developers/applications) (terpisah dari bot honeypot). Salin token-nya. Tidak perlu mengaktifkan privileged intent apa pun.
2. **Invite bot** (ganti `CLIENT_ID` dengan Application ID):
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=268692496
   ```
   Izin: Manage Channels, Manage Roles, View Channels, Send Messages, Manage Messages, Embed Links, Attach Files, Read Message History, Mention Everyone (untuk ping @everyone/@here di `/announce`).
3. **Jalankan** (butuh [Bun](https://bun.sh) v1.2+):
   ```bash
   cp .env.example .env   # isi DISCORD_TOKEN, dan GUILD_ID supaya command langsung muncul
   bun install
   bun start
   ```
   Atau dengan Docker: `docker compose up -d --build`.
4. **Di server**:
   - Buat kategori `🎫 TIKET` dan role `Admin Toko`.
   - `/toko-setup role_admin:@Admin Toko kategori_tiket:🎫 TIKET channel_log:#log-toko channel_testimoni:#testimoni minimal_order:100 maksimal_order:20000`
   - `/toko-pembayaran`, lalu isi rekening/e-wallet/QRIS.
   - `/setup-harga metode:Via Send Username harga:15500 channel:#pricelist` (ulangi untuk Via Login dan Group Payout)
   - `/toko-setup nama_toko:Nama Toko Kamu role_ping:@Member channel_pengumuman:#announcement channel_riwayat:#history-transaksi channel_leaderboard:#leaderboard`
   - (opsional) `/loyalitas atur role:@Customer minimal_belanja:1` (dan misalnya `@Sultan minimal_belanja:1000000`)
   - Di channel toko: `/toko-panel`
5. **Taruh role bot di atas** role-role loyalitas (Server Settings → Roles).

## Struktur kode

```
src/
  index.ts        koneksi Discord & pendaftaran command
  interaction.ts  semua logika command, tombol, dan form
  commands.ts     definisi slash command
  ui.ts           embed, tombol, modal
  pricing.ts      perhitungan harga & daftar metode
  db.ts           database (SQLite default) + migration
  tools.ts        helper kecil
tests/
  toko.test.ts    tes alur database & harga (bun test)
```

## Catatan

- Bukti pembayaran cukup dikirim sebagai foto biasa di chat tiket. Bot tidak membaca isi pesan, jadi tidak butuh Message Content Intent. Kalau bukti kurang jelas, admin cukup membalas di tiket.
- Metode **Via Login**: form tidak pernah meminta password. Data login dikirim pembeli langsung di tiket privat, dan tiket mengingatkan pembeli untuk mengganti password setelah selesai. Bot tidak menyimpan isi chat tiket.
- Discord membatasi ganti nama channel sekitar 2 kali per 10 menit. Kalau `/open` dan `/close` dipakai berulang dalam waktu singkat, nama channel akan menyusul belakangan. Status toko dan panel tetap langsung berubah. Matikan dengan `/toko-setup ganti_nama_channel:False` jika tidak perlu.
- "Hari ini" di statistik dihitung dalam WIB.
- Database default `toko.sqlite`. Bisa diganti ke PostgreSQL lewat `DATABASE_URL`.
- ⚠️ Jual-beli Robux di luar jalur resmi Roblox berisiko melanggar Terms of Use Roblox. Pertimbangkan risikonya untuk akunmu dan akun pembeli.
