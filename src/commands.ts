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
        description: "Atur toko Robux: role admin, kategori tiket, channel log & testimoni, harga",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
        options: [
            { type: ApplicationCommandOptionType.Role, name: "role_admin", description: "Role yang boleh memproses order" },
            { type: ApplicationCommandOptionType.Channel, name: "kategori_tiket", description: "Kategori tempat channel tiket dibuat", channel_types: [ChannelType.GuildCategory] },
            { type: ApplicationCommandOptionType.Channel, name: "channel_log", description: "Channel log transaksi (khusus admin)", channel_types: [ChannelType.GuildText] },
            { type: ApplicationCommandOptionType.Channel, name: "channel_testimoni", description: "Channel publik untuk vouch/testimoni", channel_types: [ChannelType.GuildText] },
            { type: ApplicationCommandOptionType.Integer, name: "harga_gig", description: "Harga Rupiah per 100 Robux via Gift In Game (0 = nonaktif)", min_value: 0 },
            { type: ApplicationCommandOptionType.Integer, name: "harga_grup", description: "Harga Rupiah per 100 Robux via Group Payout (0 = nonaktif)", min_value: 0 },
            { type: ApplicationCommandOptionType.Integer, name: "harga_username", description: "Harga Rupiah per 100 Robux via Username (0 = nonaktif)", min_value: 0 },
            { type: ApplicationCommandOptionType.Integer, name: "harga_login", description: "Harga Rupiah per 100 Robux via Login (0 = nonaktif)", min_value: 0 },
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
        description: "Atur role loyalitas berdasarkan total Robux yang dibeli",
        type: ApplicationCommandType.ChatInput,
        default_member_permissions: ADMIN,
        ...guildOnly,
        options: [
            {
                type: ApplicationCommandOptionType.Subcommand, name: "atur", description: "Tambah/ubah role loyalitas",
                options: [
                    { type: ApplicationCommandOptionType.Role, name: "role", description: "Role yang diberikan", required: true },
                    { type: ApplicationCommandOptionType.Integer, name: "minimal_robux", description: "Total Robux minimal untuk dapat role ini", required: true, min_value: 1 },
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
