import {
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ApplicationIntegrationType,
    ChannelType,
    InteractionContextType,
    PermissionFlagsBits,
    type RESTPutAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";

const ADMIN = PermissionFlagsBits.ManageGuild.toString();
const guildOnly = {
    integration_types: [ApplicationIntegrationType.GuildInstall],
    contexts: [InteractionContextType.Guild],
};

export const shopCommandsPayload: RESTPutAPIApplicationCommandsJSONBody = [
    // ---------- Admin ----------
    {
        name: "toko-setup",
        description: "Atur toko Robux: role admin, kategori tiket, channel log, testimoni, riwayat, dll.",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
        options: [
            { type: ApplicationCommandOptionType.Role, name: "role_admin", description: "Role yang boleh memproses order" },
            { type: ApplicationCommandOptionType.Channel, name: "kategori_tiket", description: "Kategori tempat channel tiket dibuat", channel_types: [ChannelType.GuildCategory] },
            { type: ApplicationCommandOptionType.Channel, name: "channel_log", description: "Channel log transaksi (khusus admin)", channel_types: [ChannelType.GuildText] },
            { type: ApplicationCommandOptionType.Channel, name: "channel_testimoni", description: "Channel publik untuk vouch/testimoni", channel_types: [ChannelType.GuildText] },
            { type: ApplicationCommandOptionType.String, name: "warna", description: "Warna semua pesan bot (kode hex), contoh #FF8FC7", min_length: 6, max_length: 7 },
            { type: ApplicationCommandOptionType.Boolean, name: "joki_aktif", description: "Terima order Joki / Boosting rank? Harga dihitung manual oleh admin" },
            { type: ApplicationCommandOptionType.Boolean, name: "gig_aktif", description: "Terima order Gift In Game (GIG)? Harga GIG dihitung manual oleh admin" },
            { type: ApplicationCommandOptionType.Integer, name: "minimal_order", description: "Minimal Robux per order", min_value: 1 },
            { type: ApplicationCommandOptionType.Integer, name: "maksimal_order", description: "Maksimal Robux per order", min_value: 1 },
            { type: ApplicationCommandOptionType.Channel, name: "channel_pengumuman", description: "Channel untuk pengumuman toko buka/tutup", channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
            { type: ApplicationCommandOptionType.String, name: "nama_toko", description: "Nama toko yang tampil di pengumuman, vouch, dan riwayat", max_length: 64 },
            { type: ApplicationCommandOptionType.Role, name: "role_ping", description: "Role yang di-ping saat toko buka (misalnya @Member)" },
            { type: ApplicationCommandOptionType.Channel, name: "channel_riwayat", description: "Channel publik riwayat transaksi selesai & tiket ditutup", channel_types: [ChannelType.GuildText] },
            { type: ApplicationCommandOptionType.Channel, name: "channel_leaderboard", description: "Channel leaderboard top pembeli (otomatis diperbarui)", channel_types: [ChannelType.GuildText] },
            { type: ApplicationCommandOptionType.Boolean, name: "ganti_nama_channel", description: "Ganti nama channel panel jadi 🟢/🔴 saat buka/tutup (default: ya)" },
        ],
    },
    {
        name: "open",
        description: "Buka toko (tombol Beli aktif kembali)",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
    },
    {
        name: "close",
        description: "Tutup toko sementara (pesanan yang sedang berjalan tetap bisa diproses)",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
        options: [
            { type: ApplicationCommandOptionType.String, name: "alasan", description: "contoh: Istirahat, buka lagi jam 19.00 WIB", max_length: 200 },
        ],
    },
    {
        name: "setup-harga",
        description: "Atur harga per 100 Robux untuk satu metode dan kirim daftar harganya ke channel",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
        options: [
            {
                type: ApplicationCommandOptionType.String, name: "metode", description: "Metode pengiriman", required: true,
                choices: [
                    { name: "Via Login", value: "login" },
                    { name: "Via Send Username", value: "username" },
                    { name: "Group Payout", value: "group" },
                    { name: "Gift In Game (GIG)", value: "gift" },
                ],
            },
            { type: ApplicationCommandOptionType.Integer, name: "harga", description: "Harga Rupiah per 100 Robux, contoh 15500 (0 = nonaktif; untuk GIG 0 = harga manual)", required: true, min_value: 0 },
            { type: ApplicationCommandOptionType.Channel, name: "channel", description: "Channel tempat daftar harga dikirim (wajib saat pertama kali)", channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
        ],
    },
    {
        name: "announce",
        description: "Kirim pengumuman penting ke channel (judul, isi, gambar, ping)",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
        options: [
            { type: ApplicationCommandOptionType.Channel, name: "channel", description: "Channel tujuan (default: channel pengumuman toko)", channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
            {
                type: ApplicationCommandOptionType.String, name: "ping", description: "Siapa yang di-ping (default: tidak ada)",
                choices: [
                    { name: "Tidak ada", value: "none" },
                    { name: "@everyone", value: "everyone" },
                    { name: "@here", value: "here" },
                    { name: "Role ping toko (dari /toko-setup)", value: "store" },
                    { name: "Role pilihan (isi opsi role)", value: "role" },
                ],
            },
            { type: ApplicationCommandOptionType.Role, name: "role", description: "Role yang di-ping jika ping = Role pilihan" },
            {
                type: ApplicationCommandOptionType.String, name: "warna", description: "Warna garis embed (default: warna toko)",
                choices: [
                    { name: "Pink muda", value: "ff8fc7" },
                    { name: "Hijau", value: "2ecc71" },
                    { name: "Merah (penting/peringatan)", value: "e74c3c" },
                    { name: "Kuning", value: "f1c40f" },
                    { name: "Biru", value: "3498db" },
                    { name: "Ungu", value: "9b59b6" },
                ],
            },
            { type: ApplicationCommandOptionType.Attachment, name: "gambar", description: "Upload gambar/banner yang tampil besar di pengumuman" },
        ],
    },
    {
        name: "kirim-pesan",
        description: "Kirim pesan teks biasa atas nama bot (tanpa kotak embed)",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
        options: [
            { type: ApplicationCommandOptionType.Channel, name: "channel", description: "Channel tujuan (default: channel ini)", channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
        ],
    },
    {
        name: "toko-reset-tiket",
        description: "Hapus SEMUA data pesanan & mulai nomor pesanan dari #0001 (pengaturan toko tetap)",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
        options: [
            { type: ApplicationCommandOptionType.String, name: "konfirmasi", description: "Ketik RESET untuk melanjutkan", required: true, max_length: 10 },
        ],
    },
    {
        name: "status-channel",
        description: "Hubungkan channel (mis. voice di SERVER STATS) supaya namanya otomatis 🟢/🔴 sesuai layanan",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
        options: [
            {
                type: ApplicationCommandOptionType.Subcommand, name: "atur", description: "Hubungkan channel ke status toko / layanan",
                options: [
                    {
                        type: ApplicationCommandOptionType.String, name: "layanan", description: "Status yang ditampilkan channel ini", required: true,
                        choices: [
                            { name: "Toko (OPEN / CLOSE)", value: "toko" },
                            { name: "Robux Via Username", value: "username" },
                            { name: "Robux Via Login", value: "login" },
                            { name: "Group Payout", value: "group" },
                            { name: "Gift In Game", value: "gift" },
                            { name: "Joki / Boosting", value: "boost" },
                        ],
                    },
                    { type: ApplicationCommandOptionType.Channel, name: "channel", description: "Channel yang namanya diganti otomatis", required: true, channel_types: [ChannelType.GuildVoice, ChannelType.GuildText, ChannelType.GuildStageVoice, ChannelType.GuildAnnouncement] },
                ],
            },
            {
                type: ApplicationCommandOptionType.Subcommand, name: "hapus", description: "Lepas channel status",
                options: [
                    {
                        type: ApplicationCommandOptionType.String, name: "layanan", description: "Status yang dilepas", required: true,
                        choices: [
                            { name: "Toko (OPEN / CLOSE)", value: "toko" },
                            { name: "Robux Via Username", value: "username" },
                            { name: "Robux Via Login", value: "login" },
                            { name: "Group Payout", value: "group" },
                            { name: "Gift In Game", value: "gift" },
                            { name: "Joki / Boosting", value: "boost" },
                        ],
                    },
                ],
            },
            { type: ApplicationCommandOptionType.Subcommand, name: "daftar", description: "Lihat channel status yang terhubung" },
        ],
    },
    {
        name: "toko-pembayaran",
        description: "Atur info pembayaran (rekening, e-wallet, link QRIS) yang ditampilkan di tiket",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
    },
    {
        name: "toko-panel",
        description: "Kirim panel toko (tombol Beli / Cek Harga) ke channel ini",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
    },
    {
        name: "middleman-panel",
        description: "Kirim panel tiket middleman (rekber) ke channel ini",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
        options: [
            {
                name: "biaya",
                description: "Biaya jasa middleman, contoh: 5% (min. Rp5.000)",
                type: ApplicationCommandOptionType.String,
                max_length: 200,
                required: false,
            },
        ],
    },
    {
        name: "toko-statistik",
        description: "Panel admin: statistik penjualan & order terbaru",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
    },
    {
        name: "pesanan",
        description: "Lihat detail sebuah pesanan",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
        options: [
            { type: ApplicationCommandOptionType.Integer, name: "id", description: "Nomor pesanan (tanpa #)", required: true, min_value: 1 },
        ],
    },
    {
        name: "loyalitas",
        description: "Atur role loyalitas berdasarkan total belanja (Rupiah)",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
        options: [
            {
                type: ApplicationCommandOptionType.Subcommand, name: "atur", description: "Tambah/ubah role loyalitas",
                options: [
                    { type: ApplicationCommandOptionType.Role, name: "role", description: "Role yang diberikan", required: true },
                    { type: ApplicationCommandOptionType.Integer, name: "minimal_belanja", description: "Total belanja minimal (Rupiah) untuk dapat role ini, contoh 1 atau 1000000", required: true, min_value: 1 },
                ],
            },
            {
                type: ApplicationCommandOptionType.Subcommand, name: "hapus", description: "Hapus role loyalitas",
                options: [
                    { type: ApplicationCommandOptionType.Role, name: "role", description: "Role yang dihapus dari daftar", required: true },
                ],
            },
            { type: ApplicationCommandOptionType.Subcommand, name: "daftar", description: "Lihat semua role loyalitas" },
        ],
    },

    // ---------- Member ----------
    {
        name: "harga",
        description: "Hitung harga Robux",
        type: ApplicationCommandType.ChatInput,
        ...guildOnly,
        options: [
            { type: ApplicationCommandOptionType.Integer, name: "jumlah", description: "Jumlah Robux yang ingin kamu terima", required: true, min_value: 1 },
        ],
    },
    {
        name: "kalkulator",
        description: "Hitung harga Robux per layanan (hasilnya terlihat di channel)",
        type: ApplicationCommandType.ChatInput,
        ...guildOnly,
        options: [
            {
                type: ApplicationCommandOptionType.String, name: "layanan", description: "Layanan Robux", required: true,
                choices: [
                    { name: "Via Send Username", value: "username" },
                    { name: "Via Login", value: "login" },
                    { name: "Group Payout", value: "group" },
                    { name: "Gift In Game (GIG)", value: "gift" },
                ],
            },
            { type: ApplicationCommandOptionType.Integer, name: "jumlah", description: "Jumlah Robux, contoh 1499", required: true, min_value: 1, max_value: 10_000_000 },
            { type: ApplicationCommandOptionType.Number, name: "rate", description: "Rate custom Rupiah per 1 Robux, contoh 94 (kosongkan = rate toko)", min_value: 0.01, max_value: 100_000 },
        ],
    },
    {
        name: "leaderboard",
        description: "Lihat top 10 pembeli",
        type: ApplicationCommandType.ChatInput,
        ...guildOnly,
    },
    {
        name: "riwayat",
        description: "Lihat riwayat pesanan kamu",
        type: ApplicationCommandType.ChatInput,
        ...guildOnly,
    },
];

export const SHOP_COMMAND_NAMES = new Set(shopCommandsPayload.map((c) => c.name));
