import {
    ButtonStyle,
    ComponentType,
    TextInputStyle,
    type APIActionRowComponent,
    type APIButtonComponent,
    type APIEmbed,
    type APIModalInteractionResponseCallbackData,
} from "discord-api-types/v10";
import type { DeliveryMethod, Order, ShopConfig, ShopStats } from "./db";
import {
    METHODS,
    METHOD_EMOJI,
    METHOD_HINT,
    METHOD_LABEL,
    STATUS_COLOR,
    STATUS_LABEL,
    PRICED_METHODS,
    isManual,
    PRICE_TIERS,
    enabledMethods,
    isMethodEnabled,
    methodLabel,
    methodPrice,
    rupiahList,
    orderCode,
    priceFor,
    robux,
    rupiah,
} from "./pricing";

/** Warna utama toko (merah muda, senada dengan foto profil bot). */
export const BRAND_COLOR = 0xff8fc7;

type Row = APIActionRowComponent<APIButtonComponent>;

const button = (custom_id: string, label: string, style: ButtonStyle, emoji?: string): APIButtonComponent => ({
    type: ComponentType.Button,
    custom_id,
    label,
    style,
    ...(emoji ? { emoji: { name: emoji } } : {}),
});

const row = (...components: APIButtonComponent[]): Row => ({ type: ComponentType.ActionRow, components });

// ---------- Panel toko ----------

/** Label tombol tiap layanan di panel. */
const PANEL_BUTTON: Record<DeliveryMethod, string> = {
    username: "Robux · Via Username",
    login: "Robux · Via Login",
    group: "Robux · Group Payout",
    gift: "Gift In Game",
    boost: "Joki / Boosting",
};
/** Urutan tampil di panel. */
const PANEL_ORDER: DeliveryMethod[] = ["username", "login", "group", "gift", "boost"];

/** Flag pesan Components V2 (kotak dengan pemisah & tombol di dalamnya). */
const IS_COMPONENTS_V2 = 1 << 15;
const text = (content: string) => ({ type: 10, content });
const divider = (big = false) => ({ type: 14, divider: true, spacing: big ? 2 : 1 });

/**
 * Panel Order Center (Components V2): satu kotak berwarna dengan judul besar,
 * garis pemisah, daftar layanan, alur pemesanan, dan tombol di dalam kotak.
 */
export function panelMessage(config: ShopConfig) {
    const store = config.store_name;
    const mark = (m: DeliveryMethod, t: string) => isMethodEnabled(config, m) ? t : `~~${t}~~`;

    const status = config.is_open
        ? "🟢 **Status:** Buka — pesanan diproses hari ini"
        : `🔴 **Status:** Tutup${config.close_reason ? ` — ${config.close_reason}` : ""}`;

    const buttons = PANEL_ORDER.map((m) => {
        const available = isMethodEnabled(config, m);
        const b = button(
            `shop:buym:${m}`,
            available ? PANEL_BUTTON[m] : `${PANEL_BUTTON[m]} (Tidak Tersedia)`,
            available ? ButtonStyle.Primary : ButtonStyle.Secondary,
            METHOD_EMOJI[m],
        );
        if (!available || !config.is_open) b.disabled = true;
        return b;
    });
    buttons.push(button("shop:ask", "Tanya", ButtonStyle.Secondary, "❓"));
    const rows: Row[] = [];
    for (let k = 0; k < buttons.length; k += 3) rows.push(row(...buttons.slice(k, k + 3)));

    const container = {
        type: 17,
        accent_color: config.is_open ? BRAND_COLOR : 0xe74c3c,
        components: [
            text(`# 🍀 ${store}\n**Layanan Top Up Robux & Jasa Game**`),
            divider(),
            text(`${status}\n\nSilakan pilih layanan melalui tombol di bawah. Setiap pesanan diproses melalui tiket pribadi antara pembeli dan admin.`),
            text(
                "**📋 Layanan Tersedia**\n" +
                [
                    `👤 ${mark("username", "**Robux Via Username** — Transfer Robux langsung")}`,
                    `🔐 ${mark("login", "**Robux Via Login** — Top up melalui login akun")}`,
                    `👥 ${mark("group", "**Robux Group Payout** — Dikirim lewat payout grup")}`,
                    `🎁 ${mark("gift", "**Gift In Game** — Beli item di dalam game")}`,
                    `🏆 ${mark("boost", "**Joki / Boosting** — Naikkan rank / level game")}`,
                    "❓ **Tanya** — Pertanyaan seputar jual beli & Robux",
                ].map((l) => `> ${l}`).join("\n"),
            ),
            text(
                "**🧾 Alur Pemesanan**\n" +
                "`1` Pilih layanan dan isi formulir\n`2` Lakukan pembayaran sesuai instruksi di tiket\n`3` Kirim bukti transfer di tiket\n`4` Pesanan diproses oleh admin",
            ),
            text("⚠️ Layanan yang dicoret sedang **tidak tersedia**. Admin tidak pernah meminta pembayaran atau data akun melalui DM."),
            divider(),
            ...rows,
            text(`-# ${store} • Pesanan diproses melalui tiket`),
        ],
    };

    return { components: [container], flags: IS_COMPONENTS_V2, allowed_mentions: { parse: [] as [] } } as any;
}

/** Pesan pembuka tiket pertanyaan. */
export function askTicketMessage(userId: string, adminRoleId: string | null, store: string) {
    return {
        content: `Halo <@${userId}>!${adminRoleId ? ` <@&${adminRoleId}>` : ""}`,
        embeds: [{
            title: "❓ Tiket Pertanyaan",
            description: `Silakan tulis pertanyaanmu seputar jual beli & Robux di sini. Admin ${store} akan segera membalas.\n\nKalau sudah selesai, klik **🔒 Tutup Tiket**.`,
            color: BRAND_COLOR,
        }] as APIEmbed[],
        components: [row(button(`shop:closeask:${userId}`, "Tutup Tiket", ButtonStyle.Secondary, "🔒"))],
        allowed_mentions: { users: [userId], roles: adminRoleId ? [adminRoleId] : [] },
    };
}

export type UserLike = { id: string; username: string; global_name?: string | null; avatar?: string | null };

export function avatarUrl(user: UserLike, size = 128): string {
    if (user.avatar) {
        const ext = user.avatar.startsWith("a_") ? "gif" : "png";
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
    }
    return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
}

const displayName = (u: UserLike) => u.global_name || u.username;

/**
 * Mention untuk role ping. Role @everyone punya ID yang sama dengan server,
 * dan harus ditulis "@everyone" (bukan <@&id>) supaya benar-benar mem-ping.
 */
export function rolePing(guildId: string, roleId: string | null) {
    if (!roleId) return { text: "", allowed: { parse: [] as ("everyone" | "roles" | "users")[] } as { parse?: ("everyone" | "roles" | "users")[]; roles?: string[] } };
    if (roleId === guildId) return { text: "@everyone", allowed: { parse: ["everyone"] as ("everyone" | "roles" | "users")[] } };
    return { text: `<@&${roleId}>`, allowed: { roles: [roleId] } as { parse?: ("everyone" | "roles" | "users")[]; roles?: string[] } };
}

/** Pengumuman toko buka/tutup. Saat buka, role ping (mis. @Member) ikut di-mention. */
export function storeAnnouncement(config: ShopConfig, open: boolean, reason: string | null) {
    const ping = rolePing(config.guild_id, config.ping_role_id);
    const store = config.store_name;
    const orderField = config.panel_channel_id ? [{ name: "Order di", value: `<#${config.panel_channel_id}>`, inline: false }] : [];
    const updateField = { name: "📅 Update", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false };
    if (open) {
        return {
            content: `${ping.text ? `${ping.text} ` : ""}🔔 **${store} sudah OPEN!**`,
            embeds: [{
                title: `🟢 ${store} OPEN!`,
                description: `✅ **${store} sekarang BUKA!**\nSilakan lakukan order Robux kamu sekarang!\n\n📌 Klik **🛒 Beli Robux** di panel toko, ya!`,
                fields: [...orderField, updateField],
                color: 0x2ecc71,
                footer: { text: `${store} • Trusted Robux Seller` },
                timestamp: new Date().toISOString(),
            }] as APIEmbed[],
            allowed_mentions: ping.allowed,
        };
    }
    return {
        content: `🔕 ${store} sudah **CLOSE**. Sampai jumpa besok!`,
        embeds: [{
            title: `🔴 ${store} CLOSE!`,
            description: `❌ **${store} sudah TUTUP!**\n${reason ? `> ${reason}\n` : ""}\nTerima kasih sudah berbelanja! 🙏\nPesanan yang sedang berjalan tetap akan diproses.`,
            fields: [...orderField, updateField],
            color: 0xe74c3c,
            footer: { text: `${store} • Trusted Robux Seller` },
            timestamp: new Date().toISOString(),
        }] as APIEmbed[],
        allowed_mentions: { parse: [] as [] },
    };
}

/** Riwayat publik: transaksi selesai. */
export function historyCompletedEmbed(order: Order, buyer: UserLike, admin: UserLike | null, userTotalSpent: number): APIEmbed {
    return {
        author: { name: displayName(buyer), icon_url: avatarUrl(buyer, 64) },
        title: "Transaksi selesai",
        description: "✅ **Pesanan berhasil dikirim**",
        thumbnail: { url: avatarUrl(buyer) },
        fields: [
            { name: "Pembeli", value: `<@${buyer.id}>\n\`${buyer.username}\``, inline: false },
            { name: "Jenis order", value: orderSummary(order), inline: false },
            { name: "Nominal", value: `**${rupiah(order.price)}**`, inline: true },
            { name: "Total transaksi", value: rupiah(userTotalSpent), inline: true },
        ],
        color: 0x2ecc71,
        footer: { text: `${orderCode(order.id)}${admin ? ` • Diproses oleh ${admin.username}` : ""}` },
        timestamp: new Date().toISOString(),
    };
}

/** Riwayat publik: tiket ditutup. */
export function historyTicketClosedEmbed(order: Order, channelName: string, closer: UserLike): APIEmbed {
    return {
        author: { name: displayName(closer), icon_url: avatarUrl(closer, 64) },
        title: "🔒 Tiket Ditutup",
        fields: [
            { name: "Channel", value: `#${channelName}`, inline: false },
            { name: "Jenis", value: order.status === "selesai" ? "Order (selesai)" : "Order (dibatalkan)", inline: true },
            { name: "Pesanan", value: orderCode(order.id), inline: true },
            { name: "Ditutup oleh", value: `<@${closer.id}>`, inline: false },
        ],
        color: 0xe74c3c,
        timestamp: new Date().toISOString(),
    };
}

/** Vouch / testimoni bergaya "NEW VOUCH". */
export function vouchMessage(order: Order, buyer: UserLike, rating: number, review: string, store: string) {
    const line = "━━━━━━━━━━━━━━━━━━━━";
    return {
        content: "💎 **NEW VOUCH** 💎",
        embeds: [{
            author: { name: displayName(buyer), icon_url: avatarUrl(buyer, 64) },
            thumbnail: { url: avatarUrl(buyer) },
            description: [
                `✅ **${rating} / 5** ${"⭐".repeat(rating)}`,
                line,
                `▫️ **Pembeli :** <@${buyer.id}>`,
                `▫️ **Order :** ${orderSummary(order)}`,
                `▫️ **Nominal :** ${rupiah(order.price)}`,
                `▫️ **Status :** Selesai ✅`,
                line,
                "",
                `💬 **Ulasan :** *"${review.replace(/"/g, "'")}"*`,
            ].join("\n"),
            color: 0xf1c40f,
            footer: { text: `Terima kasih telah berbelanja di ${store}` },
            timestamp: new Date().toISOString(),
        }] as APIEmbed[],
        allowed_mentions: { parse: [] as [] },
    };
}

/** Leaderboard top pembeli berdasarkan total belanja. */
export function leaderboardEmbed(store: string, entries: { user_id: string; spent: number }[], totals: { customers: number; spending: number }): APIEmbed {
    const medals = ["🥇", "🥈", "🥉"];
    const lines = entries.map((e, i) => `${medals[i] ?? `\`${String(i + 1).padStart(2, " ")}.\``} <@${e.user_id}> — **${rupiah(e.spent)}**`);
    return {
        title: "🏆 LEADERBOARD — TOP 10 BUYER",
        description: (lines.length ? lines.join("\n") : "_Belum ada transaksi selesai._") +
            `\n\n👑 **STATISTIK TOKO**\n👥 Customer : **${totals.customers.toLocaleString("id-ID")}**\n💰 Total Spending : **${rupiah(totals.spending)}**`,
        color: 0xf1c40f,
        footer: { text: `${store} • Otomatis terupdate setiap transaksi selesai` },
        timestamp: new Date().toISOString(),
    };
}

/** Nama channel dengan prefix status. "🟢・toko" / "🔴・toko". */
export function statusChannelName(current: string, open: boolean): string {
    const base = current.replace(/^(🟢|🔴)(・|-|_)?/u, "") || "toko";
    return `${open ? "🟢" : "🔴"}・${base}`.slice(0, 100);
}

// ---------- Kalkulator ----------

export function priceEmbed(config: ShopConfig, amount: number): APIEmbed {
    const methods = enabledMethods(config).filter((m) => !isManual(m));
    const fields = methods.map((m) => {
        const price = priceFor(amount, methodPrice(config, m));
        return { name: methodLabel(m), value: `**${rupiah(price)}**`, inline: true };
    });
    if (isMethodEnabled(config, "gift")) fields.push({ name: methodLabel("gift"), value: "Harga dihitung admin sesuai item", inline: false });
    if (isMethodEnabled(config, "boost")) fields.push({ name: methodLabel("boost"), value: "Harga dihitung admin sesuai game & target rank", inline: false });
    const warnings: string[] = [];
    if (amount < config.min_order) warnings.push(`⚠️ Di bawah minimal order (${robux(config.min_order)}).`);
    if (amount > config.max_order) warnings.push(`⚠️ Di atas maksimal order (${robux(config.max_order)}).`);
    return {
        title: `🧮 Harga untuk ${robux(amount)}`,
        description: fields.length === 0 ? "Harga belum diatur oleh admin." : warnings.join("\n") || undefined,
        fields,
        color: BRAND_COLOR,
    };
}

// ---------- Modal ----------

/** Balasan tombol "Beli Robux": pilih metode dulu, lalu form sesuai metode. */
export function buyMethodPicker(config: ShopConfig) {
    const methods = enabledMethods(config);
    const lines = methods.map((m) => isManual(m)
        ? `${METHOD_EMOJI[m]} **${METHOD_LABEL[m]}**: ${METHOD_HINT[m]}`
        : `${METHOD_EMOJI[m]} **${METHOD_LABEL[m]}**: ${rupiah(methodPrice(config, m))} / 100 R$ · ${METHOD_HINT[m]}`);
    const buttons = methods.map((m) => button(`shop:buym:${m}`, METHOD_LABEL[m], isManual(m) ? ButtonStyle.Primary : ButtonStyle.Success, METHOD_EMOJI[m]));
    const rows: Row[] = [];
    for (let i = 0; i < buttons.length; i += 5) rows.push(row(...buttons.slice(i, i + 5)));
    return {
        embeds: [{ title: "🛒 Pilih Layanan", description: lines.join("\n"), color: BRAND_COLOR }] as APIEmbed[],
        components: rows,
    };
}

export function orderModal(config: ShopConfig, method: DeliveryMethod): APIModalInteractionResponseCallbackData {
    const usernameField = {
        type: ComponentType.Label as const,
        label: "Username Roblox",
        component: { type: ComponentType.TextInput as const, custom_id: "username", style: TextInputStyle.Short, placeholder: "username kamu (bukan display name)", min_length: 3, max_length: 20, required: true },
    };
    if (method === "boost") {
        return {
            title: "Order Joki / Boosting",
            custom_id: "shop_modal:order:boost",
            components: [
                {
                    type: ComponentType.Label,
                    label: "Nama Game",
                    component: { type: ComponentType.TextInput, custom_id: "game", style: TextInputStyle.Short, placeholder: "contoh: Mobile Legends / Valorant / Blox Fruits", min_length: 2, max_length: 60, required: true },
                },
                {
                    type: ComponentType.Label,
                    label: "Rank / Level Sekarang",
                    component: { type: ComponentType.TextInput, custom_id: "current", style: TextInputStyle.Short, placeholder: "contoh: Epic III", min_length: 1, max_length: 60, required: true },
                },
                {
                    type: ComponentType.Label,
                    label: "Target Rank / Level",
                    component: { type: ComponentType.TextInput, custom_id: "target", style: TextInputStyle.Short, placeholder: "contoh: Mythic", min_length: 1, max_length: 60, required: true },
                },
                {
                    type: ComponentType.Label,
                    label: "Nickname / ID Akun Game",
                    description: "Jangan tulis password di sini. Data login diminta admin di tiket.",
                    component: { type: ComponentType.TextInput, custom_id: "username", style: TextInputStyle.Short, placeholder: "contoh: Gavin#1234 / ID 12345678", min_length: 2, max_length: 60, required: true },
                },
                {
                    type: ComponentType.Label,
                    label: "Catatan (opsional)",
                    component: { type: ComponentType.TextInput, custom_id: "note", style: TextInputStyle.Paragraph, placeholder: "server/region, hero/role, jadwal main, permintaan khusus…", max_length: 300, required: false },
                },
            ],
        };
    }
    if (method === "gift") {
        return {
            title: "Order Gift In Game (GIG)",
            custom_id: "shop_modal:order:gift",
            components: [
                {
                    type: ComponentType.Label,
                    label: "Nama Map / Game",
                    component: { type: ComponentType.TextInput, custom_id: "game", style: TextInputStyle.Short, placeholder: "contoh: Blox Fruits", min_length: 2, max_length: 80, required: true },
                },
                {
                    type: ComponentType.Label,
                    label: "Nama Item",
                    component: { type: ComponentType.TextInput, custom_id: "item", style: TextInputStyle.Short, placeholder: "contoh: Gamepass 2x Mastery", min_length: 2, max_length: 100, required: true },
                },
                {
                    type: ComponentType.Label,
                    label: "Jumlah Robux",
                    description: "Harga item dalam Robux (lihat di dalam game)",
                    component: { type: ComponentType.TextInput, custom_id: "amount", style: TextInputStyle.Short, placeholder: "contoh: 450", min_length: 1, max_length: 10, required: true },
                },
                usernameField,
            ],
        };
    }
    return {
        title: `Beli Robux · ${METHOD_LABEL[method]}`.slice(0, 45),
        custom_id: `shop_modal:order:${method}`,
        components: [
            {
                type: ComponentType.Label,
                label: "Jumlah Robux",
                description: `${rupiah(methodPrice(config, method))} / 100 R$ · min ${robux(config.min_order)}, maks ${robux(config.max_order)}`.slice(0, 100),
                component: { type: ComponentType.TextInput, custom_id: "amount", style: TextInputStyle.Short, placeholder: "contoh: 1000", min_length: 1, max_length: 10, required: true },
            },
            usernameField,
            {
                type: ComponentType.Label,
                label: "Catatan (opsional)",
                component: { type: ComponentType.TextInput, custom_id: "note", style: TextInputStyle.Short, placeholder: "info tambahan untuk admin", max_length: 200, required: false },
            },
        ],
    };
}

/** Modal admin untuk mengisi total harga GIG saat konfirmasi pembayaran. */
export function gigPriceModal(order: Order): APIModalInteractionResponseCallbackData {
    return {
        title: `Konfirmasi ${order.method === "boost" ? "Joki" : "GIG"} ${orderCode(order.id)}`,
        custom_id: `shop_modal:gigprice:${order.id}`,
        components: [
            {
                type: ComponentType.Label,
                label: "Total harga yang dibayar (Rupiah)",
                description: (order.method === "boost" ? `${order.note ?? "Joki"}` : `${order.note ?? "GIG"} · ${robux(order.robux)}`).slice(0, 100),
                component: {
                    type: ComponentType.TextInput, custom_id: "price", style: TextInputStyle.Short, placeholder: "contoh: 65000",
                    value: order.price > 0 ? String(order.price) : undefined, min_length: 1, max_length: 12, required: true,
                },
            },
        ],
    };
}

/** Daftar harga satu metode, format: "⏣ 100 Robux — Rp 15.500". */
export function priceListMessage(config: ShopConfig, method: DeliveryMethod) {
    const per100 = methodPrice(config, method);
    const tiers = PRICE_TIERS.filter((t) => t >= config.min_order && t <= config.max_order);
    const lines = (tiers.length ? tiers : PRICE_TIERS).map((t) => `⏣ ${t.toLocaleString("id-ID")} Robux — ${rupiahList(priceFor(t, per100))}`);
    return {
        embeds: [{
            title: `${METHOD_EMOJI[method]} ${METHOD_LABEL[method]}`,
            description: lines.join("\n") + "\n\n-# Jumlah lain? Cek dengan `/harga`. Order lewat panel toko 🛒",
            color: BRAND_COLOR,
            footer: { text: `${config.store_name} • Harga dapat berubah sewaktu-waktu` },
            timestamp: new Date().toISOString(),
        }] as APIEmbed[],
        allowed_mentions: { parse: [] as [] },
    };
}

/** Ringkasan order untuk vouch & riwayat. */
export function orderSummary(order: Order): string {
    if (order.method === "gift") return `🎁 GIG Roblox${order.note ? ` · ${order.note}` : ""} (${robux(order.robux)})`;
    if (order.method === "boost") return `🏆 Joki${order.note ? ` · ${order.note.split("\n")[0]}` : ""}`;
    return `🎮 ${robux(order.robux)} via ${METHOD_LABEL[order.method]}`;
}

/** Form pengumuman. Pengaturan channel/ping/warna dibawa lewat custom_id. */
export function announceModal(channelId: string, ping: string, roleId: string, color: string): APIModalInteractionResponseCallbackData {
    return {
        title: "Kirim Pengumuman",
        custom_id: `shop_modal:announce:${channelId}:${ping}:${roleId || "-"}:${color}`,
        components: [
            {
                type: ComponentType.Label,
                label: "Judul",
                component: { type: ComponentType.TextInput, custom_id: "title", style: TextInputStyle.Short, placeholder: "contoh: 📢 Update Harga Robux", max_length: 200, required: true },
            },
            {
                type: ComponentType.Label,
                label: "Isi pengumuman",
                description: "Mendukung format Discord: **tebal**, *miring*, > kutipan, emoji, link",
                component: { type: ComponentType.TextInput, custom_id: "body", style: TextInputStyle.Paragraph, placeholder: "Tulis pengumuman di sini…", max_length: 4000, required: true },
            },
            {
                type: ComponentType.Label,
                label: "Link gambar (opsional)",
                description: "URL gambar/banner yang tampil besar di bawah pengumuman",
                component: { type: ComponentType.TextInput, custom_id: "image", style: TextInputStyle.Short, placeholder: "https://...png", max_length: 500, required: false },
            },
        ],
    };
}

export function announceMessage(store: string, title: string, body: string, color: number, image: string | null, pingContent: string | undefined, allowed: { parse?: ("everyone" | "roles" | "users")[]; roles?: string[] }) {
    return {
        content: pingContent,
        embeds: [{
            title,
            description: body,
            color,
            ...(image ? { image: { url: image } } : {}),
            footer: { text: `${store} • Pengumuman` },
            timestamp: new Date().toISOString(),
        }] as APIEmbed[],
        allowed_mentions: allowed,
    };
}

export function paymentInfoModal(current: string | null): APIModalInteractionResponseCallbackData {
    return {
        title: "Info Pembayaran",
        custom_id: "shop_modal:payment",
        components: [
            {
                type: ComponentType.Label,
                label: "Cara pembayaran",
                description: "Ditampilkan ke pembeli di setiap tiket. Contoh: rekening, e-wallet, link gambar QRIS.",
                component: {
                    type: ComponentType.TextInput,
                    custom_id: "payment_info",
                    style: TextInputStyle.Paragraph,
                    placeholder: "BCA 1234567890 a.n. Nama\nDANA 08xxxxxxxxxx a.n. Nama\nQRIS: https://...",
                    value: current ?? undefined,
                    max_length: 1500,
                    required: true,
                },
            },
        ],
    };
}

export function testimonialModal(orderId: number): APIModalInteractionResponseCallbackData {
    return {
        title: `Testimoni Pesanan ${orderCode(orderId)}`,
        custom_id: `shop_modal:testi:${orderId}`,
        components: [
            {
                type: ComponentType.Label,
                label: "Rating",
                component: {
                    type: ComponentType.StringSelect,
                    custom_id: "rating",
                    min_values: 1,
                    max_values: 1,
                    required: true,
                    options: [5, 4, 3, 2, 1].map((n) => ({ label: "⭐".repeat(n), value: String(n), default: n === 5 })),
                },
            },
            {
                type: ComponentType.Label,
                label: "Ulasan",
                component: { type: ComponentType.TextInput, custom_id: "review", style: TextInputStyle.Paragraph, placeholder: "Ceritakan pengalaman belanja kamu", min_length: 3, max_length: 500, required: true },
            },
        ],
    };
}

// ---------- Tiket & pesanan ----------

export function orderEmbed(order: Order, title?: string): APIEmbed {
    const fields = [
        { name: "Pembeli", value: `<@${order.user_id}>`, inline: true },
        { name: order.method === "boost" ? "Akun Game" : "Username Roblox", value: `\`${order.roblox_username}\``, inline: true },
        { name: "Metode", value: methodLabel(order.method), inline: true },
        order.method === "boost"
            ? { name: "Layanan", value: "Joki rank / level", inline: true }
            : { name: "Jumlah", value: robux(order.robux), inline: true },
        { name: "Total Bayar", value: order.price > 0 ? `**${rupiah(order.price)}**` : "_dihitung admin_", inline: true },
        { name: "Status", value: STATUS_LABEL[order.status], inline: true },
    ];
    if (order.note) fields.push({ name: order.method === "gift" ? "Map / Item" : order.method === "boost" ? "Detail Joki" : "Catatan", value: order.note.slice(0, 1024), inline: false });
    if (order.handled_by) fields.push({ name: "Ditangani oleh", value: `<@${order.handled_by}>`, inline: true });
    return {
        title: title ?? `Pesanan ${orderCode(order.id)}`,
        color: STATUS_COLOR[order.status],
        fields,
        timestamp: new Date(order.updated_at * 1000).toISOString(),
    };
}

export function instructionsEmbed(order: Order, config: ShopConfig): APIEmbed {
    const steps: string[] = [];
    if (order.method === "boost") {
        steps.push("**1. Tunggu admin menghitung harga & estimasi waktu** joki kamu dan menyebutkannya di tiket ini.");
        steps.push("**2. Bayar sesuai total dari admin**, lalu kirim foto bukti transfer di chat tiket ini.");
    } else if (order.method === "gift") {
        steps.push("**1. Tunggu admin menghitung harga** item kamu dan menyebutkan totalnya di tiket ini.");
        steps.push("**2. Bayar sesuai total dari admin**, lalu kirim foto bukti transfer di chat tiket ini.");
    } else {
        steps.push(`**1. Bayar ${rupiah(order.price)}** ke salah satu metode di bawah.`);
        steps.push("**2. Kirim foto bukti transfer** langsung di chat tiket ini.");
    }
    switch (order.method) {
        case "boost":
            steps.push(
                "**3. Admin akan meminta data login akun game di tiket ini.**\n" +
                "🔐 Kirim **hanya di tiket ini**, jangan pernah di channel lain atau ke DM siapa pun yang mengaku admin.\n" +
                "🎮 **Jangan login/main di akun itu** selama proses joki supaya tidak bentrok.\n" +
                "🔐 **Segera ganti password** setelah joki selesai.",
            );
            break;
        case "gift":
            steps.push("**3. Admin akan mengirim item** sebagai gift ke akun Roblox kamu di dalam map/game tersebut. Pastikan nama map, item, dan username sudah benar.");
            break;
        case "group":
            steps.push("**3. Pastikan kamu sudah bergabung ke grup Roblox toko** dan memenuhi syarat payout dari Roblox. Tanya admin jika belum tahu grupnya.");
            break;
        case "username":
            steps.push(`**3. Pastikan username Roblox kamu benar** (\`${order.roblox_username}\`). Admin hanya butuh username, tidak perlu password.`);
            break;
        case "login":
            steps.push(
                "**3. Admin akan meminta data login di tiket ini.**\n" +
                "🔐 Kirim **hanya di tiket ini**, jangan pernah di channel lain atau ke DM siapa pun yang mengaku admin.\n" +
                "🔐 Matikan 2-Step Verification sementara jika diminta admin.\n" +
                "🔐 **Segera ganti password** setelah pesanan selesai.",
            );
            break;
    }
    steps.push(order.method === "boost"
        ? "**4. Tunggu admin** mengecek bukti, menekan **Konfirmasi Bayar**, lalu mengerjakan joki. Progres akan dikabari di tiket ini."
        : "**4. Tunggu admin** mengecek bukti, menekan **Konfirmasi Bayar**, lalu mengirim Robux.");
    return {
        title: "📋 Cara Menyelesaikan Pesanan",
        description: steps.join("\n") + `\n\n💳 **Pembayaran**\n${config.payment_info ?? "_Admin belum mengatur info pembayaran. Tunggu admin di tiket ini._"}`,
        color: BRAND_COLOR,
        footer: { text: "Jangan transfer ke nomor selain yang tertera di atas. Admin tidak pernah DM duluan." },
    };
}

/** Tombol sesuai status pesanan. */
export function orderButtons(order: Order): Row[] {
    const id = order.id;
    switch (order.status) {
        case "menunggu_pembayaran":
            return [row(
                button(`shop:verify:${id}`, "Konfirmasi Bayar (Admin)", ButtonStyle.Success, "✅"),
                button(`shop:cancel:${id}`, "Batalkan", ButtonStyle.Danger, "✖️"),
            )];
        case "menunggu_verifikasi": // status lama, diperlakukan sama seperti menunggu pembayaran
            return [row(
                button(`shop:verify:${id}`, "Konfirmasi Bayar (Admin)", ButtonStyle.Success, "✅"),
                button(`shop:cancel:${id}`, "Batalkan", ButtonStyle.Danger, "✖️"),
            )];
        case "diproses":
            return [row(
                button(`shop:done:${id}`, order.method === "boost" ? "Joki Selesai" : "Robux Terkirim (Selesai)", ButtonStyle.Success, "🎉"),
                button(`shop:cancel:${id}`, "Batalkan (Admin)", ButtonStyle.Danger, "✖️"),
            )];
        case "selesai":
            return [row(
                button(`shop:testi:${id}`, "Beri Testimoni", ButtonStyle.Primary, "⭐"),
                button(`shop:close:${id}`, "Tutup Tiket", ButtonStyle.Secondary, "🔒"),
            )];
        case "dibatalkan":
            return [row(button(`shop:close:${id}`, "Tutup Tiket", ButtonStyle.Secondary, "🔒"))];
    }
}

// ---------- Statistik ----------

export function statsEmbed(stats: ShopStats, config: ShopConfig): APIEmbed {
    const top = stats.topBuyers.length
        ? stats.topBuyers.map((b, i) => `${i + 1}. <@${b.user_id}> — ${robux(b.robux)} (${rupiah(b.spent)})`).join("\n")
        : "_Belum ada_";
    const recent = stats.recent.length
        ? stats.recent.map((o) => `\`${orderCode(o.id)}\` <@${o.user_id}> ${robux(o.robux)} · ${STATUS_LABEL[o.status]}`).join("\n")
        : "_Belum ada_";
    return {
        title: "📊 Statistik Toko",
        color: BRAND_COLOR,
        fields: [
            { name: "Pendapatan hari ini", value: rupiah(stats.revenueToday), inline: true },
            { name: "7 hari", value: rupiah(stats.revenue7d), inline: true },
            { name: "30 hari", value: rupiah(stats.revenue30d), inline: true },
            { name: "Total pendapatan", value: rupiah(stats.revenueAll), inline: true },
            { name: "Robux terjual", value: robux(stats.robuxAll), inline: true },
            { name: "Pesanan", value: `${stats.completed} selesai dari ${stats.totalOrders} total\n${stats.ordersToday} pesanan baru hari ini`, inline: false },
            {
                name: "Perlu ditangani",
                value: `⏳ Menunggu bayar/konfirmasi: **${stats.pending.menunggu_pembayaran + stats.pending.menunggu_verifikasi}**\n⚙️ Diproses: **${stats.pending.diproses}**`,
                inline: false,
            },
            { name: "🏆 Top pembeli", value: top, inline: false },
            { name: "🕒 Pesanan terbaru", value: recent, inline: false },
        ],
        footer: { text: "Hari dihitung dalam WIB" },
        timestamp: new Date().toISOString(),
    };
}

export function methodFromValue(v: string | undefined): DeliveryMethod | null {
    return (METHODS as string[]).includes(v ?? "") ? (v as DeliveryMethod) : null;
}
