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
    METHOD_LABEL,
    STATUS_COLOR,
    STATUS_LABEL,
    enabledMethods,
    gamepassPriceFor,
    orderCode,
    priceFor,
    robux,
    rupiah,
} from "./pricing";

const BRAND_COLOR = 0x00b06f;

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

export function panelMessage(config: ShopConfig) {
    const methods = enabledMethods(config);
    const lines: string[] = [];
    if (methods.includes("gamepass")) lines.push(`🎟️ **Gamepass:** ${rupiah(config.price_gamepass)} / 100 R$`);
    if (methods.includes("group")) lines.push(`👥 **Group Payout:** ${rupiah(config.price_group)} / 100 R$`);
    if (lines.length === 0) lines.push("_Harga belum diatur oleh admin._");

    const status = config.is_open
        ? "🟢 **TOKO BUKA**"
        : `🔴 **TOKO TUTUP**${config.close_reason ? `\n> ${config.close_reason}` : ""}`;

    const embed: APIEmbed = {
        title: "🛒 Toko Robux",
        description:
            `${status}\n\n` +
            "Beli Robux dengan aman lewat tiket pribadi.\n\n" +
            lines.join("\n") +
            `\n\n📏 **Order:** ${robux(config.min_order)} – ${robux(config.max_order)}`,
        color: config.is_open ? BRAND_COLOR : 0xe74c3c,
        footer: { text: config.is_open ? "Klik 🛒 Beli Robux untuk membuat pesanan" : "Toko sedang tutup, pantau pengumuman untuk jam buka" },
    };
    const buy = button("shop:buy", config.is_open ? "Beli Robux" : "Toko Tutup", config.is_open ? ButtonStyle.Success : ButtonStyle.Secondary, config.is_open ? "🛒" : "🔴");
    if (!config.is_open) buy.disabled = true;
    return {
        embeds: [embed],
        components: [
            row(
                buy,
                button("shop:price", "Cek Harga", ButtonStyle.Secondary, "🧮"),
            ),
        ],
        allowed_mentions: { parse: [] },
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

/** Pengumuman toko buka/tutup. Saat buka, role ping (mis. @Member) ikut di-mention. */
export function storeAnnouncement(config: ShopConfig, open: boolean, reason: string | null) {
    const store = config.store_name;
    const orderField = config.panel_channel_id ? [{ name: "Order di", value: `<#${config.panel_channel_id}>`, inline: false }] : [];
    const updateField = { name: "📅 Update", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false };
    if (open) {
        return {
            content: `${config.ping_role_id ? `<@&${config.ping_role_id}> ` : ""}🔔 **${store} sudah OPEN!**`,
            embeds: [{
                title: `🟢 ${store} OPEN!`,
                description: `✅ **${store} sekarang BUKA!**\nSilakan lakukan order Robux kamu sekarang!\n\n📌 Klik **🛒 Beli Robux** di panel toko, ya!`,
                fields: [...orderField, updateField],
                color: 0x2ecc71,
                footer: { text: `${store} • Trusted Robux Seller` },
                timestamp: new Date().toISOString(),
            }] as APIEmbed[],
            allowed_mentions: config.ping_role_id ? { roles: [config.ping_role_id] } : { parse: [] as [] },
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
            { name: "Jenis order", value: `🎮 ${robux(order.robux)} via ${METHOD_LABEL[order.method]}`, inline: false },
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
                `▫️ **Order :** 🎮 ${robux(order.robux)} via ${METHOD_LABEL[order.method]}`,
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
    const methods = enabledMethods(config);
    const fields = methods.map((m) => {
        const price = priceFor(amount, m === "gamepass" ? config.price_gamepass : config.price_group);
        const extra = m === "gamepass" ? `\nBuat gamepass seharga **${robux(gamepassPriceFor(amount))}** (potongan Roblox 30%)` : "";
        return { name: METHOD_LABEL[m], value: `**${rupiah(price)}**${extra}`, inline: false };
    });
    const warnings: string[] = [];
    if (amount < config.min_order) warnings.push(`⚠️ Di bawah minimal order (${robux(config.min_order)}).`);
    if (amount > config.max_order) warnings.push(`⚠️ Di atas maksimal order (${robux(config.max_order)}).`);
    return {
        title: `🧮 Harga untuk ${robux(amount)}`,
        description: methods.length === 0 ? "Harga belum diatur oleh admin." : warnings.join("\n") || undefined,
        fields,
        color: BRAND_COLOR,
    };
}

// ---------- Modal ----------

export function orderModal(config: ShopConfig): APIModalInteractionResponseCallbackData {
    const methods = enabledMethods(config);
    return {
        title: "Beli Robux",
        custom_id: "shop_modal:order",
        components: [
            {
                type: ComponentType.Label,
                label: "Jumlah Robux",
                description: `Robux bersih yang kamu terima (${robux(config.min_order)} – ${robux(config.max_order)})`,
                component: { type: ComponentType.TextInput, custom_id: "amount", style: TextInputStyle.Short, placeholder: "contoh: 1000", min_length: 1, max_length: 10, required: true },
            },
            {
                type: ComponentType.Label,
                label: "Username Roblox",
                component: { type: ComponentType.TextInput, custom_id: "username", style: TextInputStyle.Short, placeholder: "username kamu (bukan display name)", min_length: 3, max_length: 20, required: true },
            },
            {
                type: ComponentType.Label,
                label: "Metode Pengiriman",
                component: {
                    type: ComponentType.StringSelect,
                    custom_id: "method",
                    min_values: 1,
                    max_values: 1,
                    required: true,
                    options: methods.map((m, i) => ({
                        label: METHOD_LABEL[m],
                        value: m,
                        description: m === "gamepass"
                            ? `${rupiah(config.price_gamepass)} / 100 R$ — kamu buat gamepass, kami beli`
                            : `${rupiah(config.price_group)} / 100 R$ — dikirim lewat grup Roblox`,
                        default: i === 0,
                    })),
                },
            },
            ...(methods.includes("gamepass") ? [{
                type: ComponentType.Label as const,
                label: "Link Gamepass (opsional)",
                description: "Khusus metode gamepass. Bisa dikirim nanti dengan /gamepass di tiket.",
                component: { type: ComponentType.TextInput as const, custom_id: "gamepass", style: TextInputStyle.Short, placeholder: "https://www.roblox.com/game-pass/...", max_length: 300, required: false },
            }] : []),
        ],
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
        { name: "Username Roblox", value: `\`${order.roblox_username}\``, inline: true },
        { name: "Metode", value: METHOD_LABEL[order.method], inline: true },
        { name: "Jumlah", value: robux(order.robux), inline: true },
        { name: "Total Bayar", value: `**${rupiah(order.price)}**`, inline: true },
        { name: "Status", value: STATUS_LABEL[order.status], inline: true },
    ];
    if (order.method === "gamepass") {
        fields.push({ name: "Harga Gamepass", value: robux(gamepassPriceFor(order.robux)), inline: true });
        fields.push({ name: "Link Gamepass", value: order.gamepass_link ?? "_belum dikirim — gunakan `/gamepass`_", inline: false });
    }
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
    steps.push(`**1. Bayar ${rupiah(order.price)}** ke salah satu metode di bawah.`);
    steps.push("**2. Kirim bukti** dengan perintah `/bukti` di channel ini.");
    if (order.method === "gamepass") {
        steps.push(
            `**3. Buat gamepass** di salah satu game milikmu seharga **${robux(gamepassPriceFor(order.robux))}** ` +
            `(Roblox memotong 30%, jadi kamu menerima ${robux(order.robux)}). Kirim linknya dengan \`/gamepass\`.`,
        );
        steps.push("ℹ️ Robux dari gamepass biasanya masuk sebagai **Pending** selama beberapa hari sebelum bisa dipakai (aturan Roblox).");
    } else {
        steps.push("**3. Pastikan kamu sudah bergabung ke grup Roblox toko** dan memenuhi syarat payout dari Roblox. Tanya admin jika belum tahu grupnya.");
    }
    steps.push("**4. Tunggu admin** memverifikasi dan mengirim Robux.");
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
        case "menunggu_verifikasi":
            return [row(
                button(`shop:verify:${id}`, "Terima Pembayaran", ButtonStyle.Success, "✅"),
                button(`shop:reject:${id}`, "Tolak Bukti", ButtonStyle.Secondary, "↩️"),
                button(`shop:cancel:${id}`, "Batalkan", ButtonStyle.Danger, "✖️"),
            )];
        case "diproses":
            return [row(
                button(`shop:done:${id}`, "Robux Terkirim (Selesai)", ButtonStyle.Success, "🎉"),
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
                value: `⏳ Menunggu bayar: **${stats.pending.menunggu_pembayaran}**\n🔎 Menunggu verifikasi: **${stats.pending.menunggu_verifikasi}**\n⚙️ Diproses: **${stats.pending.diproses}**`,
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
    return v === "gamepass" || v === "group" ? v : null;
}
