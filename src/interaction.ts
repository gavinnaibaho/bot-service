import {
    ApplicationCommandOptionType,
    ChannelType,
    ComponentType,
    InteractionType,
    MessageFlags,
    OverwriteType,
    PermissionFlagsBits,
    type APIApplicationCommandInteractionDataOption,
    type APIEmbed,
    type APIInteraction,
    type APIInteractionGuildMember,
} from "discord-api-types/v10";
import type { API } from "@discordjs/core";
import { hasPermission, trim } from "./tools";
import * as shopDb from "./db";
import type { DeliveryMethod, Order, OrderStatus, ShopConfig } from "./db";
import { SHOP_COMMAND_NAMES } from "./commands";
import { METHODS, METHOD_LABEL, isManual, STATUS_LABEL, enabledMethods, isMethodEnabled, methodLabel, methodPrice, orderCode, parseAmount, robux, rupiah, startOfTodayWIB, validateOrder } from "./pricing";
import {
    instructionsEmbed,
    methodFromValue,
    orderButtons,
    orderEmbed,
    orderModal,
    buyMethodPicker,
    askTicketMessage,
    BRAND_COLOR,
    gigPriceModal,
    priceListMessage,
    announceModal,
    plainMessageModal,
    announceMessage,
    rolePing,
    panelMessage,
    paymentInfoModal,
    priceEmbed,
    statsEmbed,
    testimonialModal,
    storeAnnouncement,
    vouchMessage,
    historyCompletedEmbed,
    historyTicketClosedEmbed,
    leaderboardEmbed,
    type UserLike,
    statusChannelName,
} from "./ui";

type Api = API;


// ---------- Helper ----------

/** Gambar yang di-upload lewat opsi /announce gambar, menunggu form diisi (per admin, 15 menit). */
const pendingAnnounceImages = new Map<string, { url: string; filename: string; at: number }>();
const MAX_ANNOUNCE_IMAGE = 10 * 1024 * 1024;

function isShopInteraction(i: APIInteraction): boolean {
    if (i.type === InteractionType.ApplicationCommand) return SHOP_COMMAND_NAMES.has(i.data.name);
    if (i.type === InteractionType.MessageComponent) return i.data.custom_id.startsWith("shop:");
    if (i.type === InteractionType.ModalSubmit) return i.data.custom_id.startsWith("shop_modal:");
    return false;
}

function isAdmin(member: APIInteractionGuildMember | undefined, config: ShopConfig | null): boolean {
    if (!member) return false;
    if (hasPermission(BigInt(member.permissions), PermissionFlagsBits.ManageGuild)) return true;
    return !!config?.admin_role_id && member.roles.includes(config.admin_role_id);
}

function getOption(options: APIApplicationCommandInteractionDataOption[] | undefined, name: string): any {
    return options?.find((o) => o.name === name && "value" in o) as any;
}

/** Ambil nilai input modal berbasis Label (TextInput -> value, StringSelect -> values[0]). */
function modalValues(components: any[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const outer of components) {
        const items = outer.type === ComponentType.Label ? [outer.component] : outer.components ?? [outer];
        for (const c of items) {
            if (!c?.custom_id) continue;
            if (typeof c.value === "string") out[c.custom_id] = c.value;
            else if (Array.isArray(c.values) && c.values.length) out[c.custom_id] = String(c.values[0]);
        }
    }
    return out;
}

function sanitizeChannelName(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20) || "pembeli";
}

async function logToChannel(api: Api, config: ShopConfig, embed: APIEmbed, files?: { name: string; data: Buffer }[]) {
    if (!config.log_channel_id) return;
    await api.channels.createMessage(config.log_channel_id, {
        embeds: [embed],
        allowed_mentions: { parse: [] },
        ...(files ? { files } : {}),
    } as any).catch((err: unknown) => console.log(`[shop] gagal kirim log: ${err}`));
}

async function refreshPanel(api: Api, guildId: string) {
    const config = await shopDb.getShopConfig(guildId);
    if (!config?.panel_channel_id || !config.panel_message_id) return;
    try {
        await api.channels.editMessage(config.panel_channel_id, config.panel_message_id, panelMessage(config));
    } catch (err) {
        // panel sudah dihapus / format lama tidak bisa diubah: lupakan, kirim ulang dengan /toko-panel
        console.log(`[shop] panel lama tidak bisa diperbarui: ${err}`);
        await shopDb.saveShopConfig({ ...config, panel_channel_id: null, panel_message_id: null });
    }
}

async function refreshLeaderboard(api: Api, guildId: string) {
    const config = await shopDb.getShopConfig(guildId);
    if (!config?.leaderboard_channel_id) return;
    const [entries, totals] = await Promise.all([shopDb.getLeaderboard(guildId, 10), shopDb.getGlobalTotals(guildId)]);
    const body = { embeds: [leaderboardEmbed(config.store_name, entries, totals)], allowed_mentions: { parse: [] as [] } };
    if (config.leaderboard_message_id) {
        const ok = await api.channels.editMessage(config.leaderboard_channel_id, config.leaderboard_message_id, body).then(() => true).catch(() => false);
        if (ok) return;
    }
    const msg = await api.channels.createMessage(config.leaderboard_channel_id, body).catch((err: unknown) => {
        console.log(`[shop] gagal kirim leaderboard: ${err}`);
        return null;
    });
    await shopDb.setLeaderboardMessage(guildId, msg?.id ?? null);
}

async function postToHistory(api: Api, config: ShopConfig, embed: APIEmbed) {
    const channelId = config.history_channel_id;
    if (!channelId) return;
    await api.channels.createMessage(channelId, { embeds: [embed], allowed_mentions: { parse: [] } })
        .catch((err: unknown) => console.log(`[shop] gagal kirim riwayat: ${err}`));
}

/** Kirim ulang / perbarui pesan daftar harga untuk semua metode yang punya channel. */
async function refreshPriceLists(api: Api, guildId: string, only?: DeliveryMethod) {
    const config = await shopDb.getShopConfig(guildId);
    if (!config) return;
    for (const pl of await shopDb.getPriceLists(guildId)) {
        if (only && pl.method !== only) continue;
        if (methodPrice(config, pl.method) <= 0) {
            if (pl.message_id) await api.channels.deleteMessage(pl.channel_id, pl.message_id).catch(() => null);
            await shopDb.deletePriceList(guildId, pl.method);
            continue;
        }
        const body = priceListMessage(config, pl.method);
        if (pl.message_id) {
            const ok = await api.channels.editMessage(pl.channel_id, pl.message_id, body).then(() => true).catch(() => false);
            if (ok) continue;
        }
        const msg = await api.channels.createMessage(pl.channel_id, body).catch((err: unknown) => {
            console.log(`[shop] gagal kirim daftar harga: ${err}`);
            return null;
        });
        await shopDb.savePriceList({ ...pl, message_id: msg?.id ?? null });
    }
}

/** Setelah pembayaran dikonfirmasi: kabari pembeli di tiket & catat ke log. */
async function announceConfirmed(api: Api, config: ShopConfig, updated: Order) {
    const reminder = updated.method === "login" || updated.method === "boost" ? "\n🔐 Admin akan meminta data login di tiket ini. Ingat untuk ganti password setelah selesai." : "";
    const what = updated.method === "gift" ? "item sedang diproses" : updated.method === "boost" ? "joki segera dikerjakan" : "Robux sedang diproses";
    await postOrderStatus(api, updated, `⚙️ Pembayaran diterima — ${orderCode(updated.id)}`, `<@${updated.user_id}> pembayaranmu sudah dikonfirmasi, ${what}.${reminder}`);
    await logToChannel(api, config, orderEmbed(updated, `✅ Pembayaran dikonfirmasi ${orderCode(updated.id)}`));
}

async function postOrderStatus(api: Api, order: Order, title: string, note?: string) {
    if (!order.channel_id) return;
    await api.channels.createMessage(order.channel_id, {
        content: note,
        embeds: [orderEmbed(order, title)],
        components: orderButtons(order),
        allowed_mentions: { users: [order.user_id] },
    }).catch((err: unknown) => console.log(`[shop] gagal kirim status ke tiket: ${err}`));
}

async function applyLoyaltyRoles(api: Api, guildId: string, userId: string): Promise<string[]> {
    const roles = await shopDb.getLoyaltyRoles(guildId);
    if (roles.length === 0) return [];
    const total = await shopDb.getUserTotalSpent(guildId, userId);
    const eligible = roles.filter((r) => total >= r.min_spent).map((r) => r.role_id);
    if (eligible.length === 0) return [];
    try {
        const member = await api.guilds.getMember(guildId, userId);
        const missing = eligible.filter((r) => !member.roles.includes(r));
        if (missing.length === 0) return [];
        await api.guilds.editMember(guildId, userId, { roles: [...member.roles, ...missing] }, { reason: "Role loyalitas toko Robux" });
        return missing;
    } catch (err) {
        console.log(`[shop] gagal memberi role loyalitas: ${err}`);
        return [];
    }
}

// ---------- Handler ----------

export async function handleInteraction({ data: interaction, api, applicationId }: { data: APIInteraction; api: Api; applicationId: string }) {
    {
        if (!isShopInteraction(interaction)) return;

        const guildId = interaction.guild_id;
        const member = interaction.member;
        const userId = member?.user.id ?? interaction.user?.id;
        if (!guildId || !userId) return;

        let replied = false;
        const reply = async (body: { content?: string; embeds?: APIEmbed[]; components?: any[] }, ephemeral = true) => {
            replied = true;
            return api.interactions.reply(interaction.id, interaction.token, {
                ...body,
                allowed_mentions: { parse: [] },
                flags: ephemeral ? MessageFlags.Ephemeral : undefined,
            });
        };
        const say = (content: string) => reply({ content });

        let deferred = false;
        const defer = async () => {
            deferred = true;
            replied = true;
            await api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });
        };
        const edit = (body: { content?: string; embeds?: APIEmbed[] }) =>
            api.interactions.editReply(applicationId || interaction.application_id, interaction.token, { ...body, allowed_mentions: { parse: [] } });

        try {
            const config = await shopDb.getShopConfig(guildId);
            const admin = isAdmin(member, config);

            // ===================== Slash commands =====================
            if (interaction.type === InteractionType.ApplicationCommand) {
                const data = interaction.data as any;
                const opts: APIApplicationCommandInteractionDataOption[] | undefined = data.options;

                switch (data.name) {
                    case "toko-setup": {
                        const c = config ?? shopDb.defaultConfig(guildId);
                        const v = (n: string) => getOption(opts, n)?.value;
                        if (v("role_admin") !== undefined) c.admin_role_id = v("role_admin");
                        if (v("kategori_tiket") !== undefined) c.ticket_category_id = v("kategori_tiket");
                        if (v("channel_log") !== undefined) c.log_channel_id = v("channel_log");
                        if (v("channel_testimoni") !== undefined) c.testimonial_channel_id = v("channel_testimoni");
                        if (v("gig_aktif") !== undefined) c.price_gift = v("gig_aktif") ? 1 : 0;
                        if (v("joki_aktif") !== undefined) c.boost_enabled = Boolean(v("joki_aktif"));
                        if (v("minimal_order") !== undefined) c.min_order = v("minimal_order");
                        if (v("maksimal_order") !== undefined) c.max_order = v("maksimal_order");
                        if (v("channel_pengumuman") !== undefined) c.announce_channel_id = v("channel_pengumuman");
                        if (v("ganti_nama_channel") !== undefined) c.rename_channel = Boolean(v("ganti_nama_channel"));
                        if (v("nama_toko") !== undefined) c.store_name = trim(String(v("nama_toko")).trim(), 64) || shopDb.DEFAULT_STORE_NAME;
                        if (v("role_ping") !== undefined) c.ping_role_id = v("role_ping");
                        if (v("channel_riwayat") !== undefined) c.history_channel_id = v("channel_riwayat");
                        const leaderboardChanged = v("channel_leaderboard") !== undefined && v("channel_leaderboard") !== c.leaderboard_channel_id;
                        if (leaderboardChanged) {
                            c.leaderboard_channel_id = v("channel_leaderboard");
                            c.leaderboard_message_id = null;
                        }
                        if (c.min_order > c.max_order) return say("❌ Minimal order tidak boleh lebih besar dari maksimal order.");
                        await shopDb.saveShopConfig(c);
                        await reply({
                            embeds: [{
                                title: "⚙️ Pengaturan Toko",
                                color: BRAND_COLOR,
                                description: [
                                    `**Role admin:** ${c.admin_role_id ? `<@&${c.admin_role_id}>` : "_belum (hanya yang punya Manage Server)_"}`,
                                    `**Kategori tiket:** ${c.ticket_category_id ? `<#${c.ticket_category_id}>` : "_belum (tiket dibuat tanpa kategori)_"}`,
                                    `**Log:** ${c.log_channel_id ? `<#${c.log_channel_id}>` : "_belum_"}`,
                                    `**Testimoni:** ${c.testimonial_channel_id ? `<#${c.testimonial_channel_id}>` : "_belum_"}`,
                                    ...METHODS.map((m) => `**${methodLabel(m)}:** ${isManual(m) ? (isMethodEnabled(c, m) ? "aktif (harga manual)" : "nonaktif") : methodPrice(c, m) ? `${rupiah(methodPrice(c, m))} / 100 R$` : "nonaktif — atur dengan `/setup-harga`"}`),
                                    `**Order:** ${robux(c.min_order)} – ${robux(c.max_order)}`,
                                    `**Info pembayaran:** ${c.payment_info ? "sudah diatur" : "_belum — pakai `/toko-pembayaran`_"}`,
                                    `**Nama toko:** ${c.store_name} · **Role ping:** ${c.ping_role_id ? (c.ping_role_id === guildId ? "@everyone" : `<@&${c.ping_role_id}>`) : "_tidak ada_"}`,
                                    `**Riwayat:** ${c.history_channel_id ? `<#${c.history_channel_id}>` : "_belum_"} · **Leaderboard:** ${c.leaderboard_channel_id ? `<#${c.leaderboard_channel_id}>` : "_belum_"}`,
                                    `**Status:** ${c.is_open ? "🟢 Buka" : "🔴 Tutup"} · **Pengumuman:** ${c.announce_channel_id ? `<#${c.announce_channel_id}>` : "_belum_"} · **Ganti nama channel:** ${c.rename_channel ? "ya" : "tidak"}`,
                                ].join("\n"),
                            }],
                        });
                        await refreshPanel(api, guildId);
                        await refreshPriceLists(api, guildId);
                        if (leaderboardChanged) await refreshLeaderboard(api, guildId);
                        return;
                    }

                    case "setup-harga": {
                        if (!config) return say("❌ Jalankan `/toko-setup` dulu.");
                        const method = getOption(opts, "metode")?.value as Exclude<DeliveryMethod, "gift" | "boost">;
                        const harga = Number(getOption(opts, "harga")?.value ?? 0);
                        const channelOpt = getOption(opts, "channel")?.value as string | undefined;
                        const existing = await shopDb.getPriceList(guildId, method);
                        const channelId = channelOpt ?? existing?.channel_id;
                        if (harga > 0 && !channelId) return say("❌ Pilih **channel** untuk daftar harga (wajib saat pertama kali).");

                        await defer();
                        await shopDb.setMethodPrice(guildId, method, harga);
                        const updated = (await shopDb.getShopConfig(guildId))!;

                        if (harga === 0) {
                            if (existing?.message_id) await api.channels.deleteMessage(existing.channel_id, existing.message_id).catch(() => null);
                            if (existing) await shopDb.deletePriceList(guildId, method);
                        } else if (existing && existing.channel_id === channelId && existing.message_id) {
                            await refreshPriceLists(api, guildId, method);
                        } else {
                            // channel baru: hapus daftar lama, kirim yang baru
                            if (existing?.message_id) await api.channels.deleteMessage(existing.channel_id, existing.message_id).catch(() => null);
                            const msg = await api.channels.createMessage(channelId!, priceListMessage(updated, method)).catch(() => null);
                            if (!msg) {
                                await refreshPanel(api, guildId);
                                return edit({ content: `⚠️ Harga ${METHOD_LABEL[method]} disimpan, tapi daftar harga gagal dikirim ke <#${channelId}>. Pastikan bot bisa melihat & mengirim pesan di sana.` });
                            }
                            await shopDb.savePriceList({ guild_id: guildId, method, channel_id: channelId!, message_id: msg.id });
                        }
                        await refreshPanel(api, guildId);
                        await logToChannel(api, updated, { title: "💰 Harga diubah", description: `<@${userId}>: ${METHOD_LABEL[method]} → ${harga ? `${rupiah(harga)} / 100 R$` : "nonaktif"}`, color: 0x95a5a6 });
                        return edit({
                            content: harga === 0
                                ? `🚫 ${METHOD_LABEL[method]} dinonaktifkan dan daftar harganya dihapus.`
                                : `✅ ${METHOD_LABEL[method]}: ${rupiah(harga)} / 100 R$. Daftar harga ada di <#${channelId}> dan akan otomatis diperbarui.`,
                        });
                    }

                    case "leaderboard": {
                        const [entries, totals] = await Promise.all([shopDb.getLeaderboard(guildId, 10), shopDb.getGlobalTotals(guildId)]);
                        return reply({ embeds: [leaderboardEmbed(config?.store_name ?? shopDb.DEFAULT_STORE_NAME, entries, totals)] }, false);
                    }

                    case "open":
                    case "close": {
                        if (!config) return say("❌ Jalankan `/toko-setup` dulu.");
                        const open = data.name === "open";
                        const reason = open ? null : (trim(String(getOption(opts, "alasan")?.value ?? "").trim(), 200) || null);
                        if (config.is_open === open && (open || reason === config.close_reason)) {
                            return say(open ? "Toko sudah dalam keadaan buka." : "Toko sudah dalam keadaan tutup.");
                        }
                        await shopDb.setShopOpen(guildId, open, reason);
                        const updated: ShopConfig = { ...config, is_open: open, close_reason: reason };
                        await say(open ? "🟢 Toko dibuka." : `🔴 Toko ditutup.${reason ? ` Alasan: ${reason}` : ""}`);

                        await refreshPanel(api, guildId);
                        if (updated.announce_channel_id) {
                            await api.channels.createMessage(updated.announce_channel_id, storeAnnouncement(updated, open, reason)).catch((err: unknown) => console.log(`[shop] gagal kirim pengumuman: ${err}`));
                        }
                        await logToChannel(api, updated, { title: open ? "🟢 Toko dibuka" : "🔴 Toko ditutup", description: `Oleh <@${userId}>${reason ? `\nAlasan: ${reason}` : ""}`, color: open ? 0x2ecc71 : 0xe74c3c });

                        // Ganti nama channel panel di background: Discord membatasi rename 2x per 10 menit,
                        // jadi jangan sampai menahan balasan command.
                        if (updated.rename_channel && updated.panel_channel_id) {
                            const channelId = updated.panel_channel_id;
                            (async () => {
                                const ch: any = await api.channels.get(channelId);
                                const name = statusChannelName(ch.name ?? "toko", open);
                                if (name !== ch.name) await api.channels.edit(channelId, { name }, { reason: open ? "Toko buka" : "Toko tutup" });
                            })().catch((err: unknown) => console.log(`[shop] gagal ganti nama channel: ${err}`));
                        }
                        return;
                    }

                    case "announce": {
                        const channelId = (getOption(opts, "channel")?.value as string | undefined) ?? config?.announce_channel_id;
                        if (!channelId) return say("❌ Pilih **channel**, atau atur channel pengumuman dulu lewat `/toko-setup channel_pengumuman`.");
                        const ping = (getOption(opts, "ping")?.value as string | undefined) ?? "none";
                        const roleId = (getOption(opts, "role")?.value as string | undefined) ?? "";
                        if (ping === "role" && !roleId) return say("❌ Ping **Role pilihan** butuh opsi **role** juga.");
                        if (ping === "store" && !config?.ping_role_id) return say("❌ Role ping toko belum diatur. Pakai `/toko-setup role_ping` atau pilih ping lain.");
                        const color = (getOption(opts, "warna")?.value as string | undefined) ?? "2ecc71";
                        const attId = getOption(opts, "gambar")?.value as string | undefined;
                        pendingAnnounceImages.delete(userId);
                        if (attId) {
                            const att = data.resolved?.attachments?.[attId];
                            if (!att) return say("❌ Gambar tidak terbaca, coba upload ulang.");
                            if (!(att.content_type ?? "").startsWith("image/")) return say("❌ File harus berupa gambar (PNG/JPG/GIF/WEBP).");
                            if (att.size > MAX_ANNOUNCE_IMAGE) return say("❌ Gambar terlalu besar (maks. 10 MB).");
                            pendingAnnounceImages.set(userId, { url: att.url, filename: att.filename, at: Date.now() });
                        }
                        await api.interactions.createModal(interaction.id, interaction.token, announceModal(channelId, ping, roleId, color));
                        replied = true;
                        return;
                    }

                    case "kirim-pesan": {
                        const channelId = (getOption(opts, "channel")?.value as string | undefined) ?? interaction.channel?.id;
                        if (!channelId) return say("❌ Pilih channel tujuan.");
                        await api.interactions.createModal(interaction.id, interaction.token, plainMessageModal(channelId));
                        replied = true;
                        return;
                    }

                    case "toko-pembayaran":
                        await api.interactions.createModal(interaction.id, interaction.token, paymentInfoModal(config?.payment_info ?? null));
                        replied = true;
                        return;

                    case "toko-panel": {
                        const c = config ?? shopDb.defaultConfig(guildId);
                        const msg = await api.channels.createMessage(interaction.channel!.id, panelMessage(c)).catch((err: unknown) => {
                            console.log(`[shop] gagal kirim panel: ${err}`);
                            return null;
                        });
                        if (!msg) return say("❌ Gagal mengirim panel. Pastikan bot bisa melihat & mengirim pesan di channel ini.");
                        await shopDb.saveShopConfig({ ...c, panel_channel_id: msg.channel_id, panel_message_id: msg.id });
                        return say("✅ Panel toko terkirim. Panel ini akan otomatis diperbarui saat harga atau status toko berubah.");
                    }

                    case "toko-statistik": {
                        if (!config) return say("❌ Jalankan `/toko-setup` dulu.");
                        const stats = await shopDb.getShopStats(guildId, startOfTodayWIB());
                        return reply({ embeds: [statsEmbed(stats, config)] });
                    }

                    case "pesanan": {
                        const order = await shopDb.getOrder(guildId, Number(getOption(opts, "id")?.value));
                        if (!order) return say("❌ Pesanan tidak ditemukan.");
                        const e = orderEmbed(order);
                        e.description = `Dibuat <t:${order.created_at}:f>${order.channel_id ? ` · Tiket: <#${order.channel_id}>` : ""}`;
                        return reply({ embeds: [e] });
                    }

                    case "loyalitas": {
                        const sub = opts?.[0] as any;
                        if (!sub) return;
                        const subOpts = sub.options as APIApplicationCommandInteractionDataOption[] | undefined;
                        if (sub.name === "atur") {
                            const roleId = getOption(subOpts, "role")?.value as string;
                            const min = Number(getOption(subOpts, "minimal_belanja")?.value);
                            if (roleId === guildId) return say("❌ Tidak bisa memakai role @everyone.");
                            await shopDb.setLoyaltyRole(guildId, roleId, min);
                            return say(`✅ <@&${roleId}> akan diberikan otomatis ke pembeli dengan total belanja ≥ **${rupiah(min)}** (semua layanan, termasuk GIG & Joki).\n-# Pastikan role bot berada di atas role ini dan bot punya izin Manage Roles.`);
                        }
                        if (sub.name === "hapus") {
                            const roleId = getOption(subOpts, "role")?.value as string;
                            const ok = await shopDb.deleteLoyaltyRole(guildId, roleId);
                            return say(ok ? `🗑️ <@&${roleId}> dihapus dari daftar loyalitas (role yang sudah diberikan tidak dicabut).` : "Role itu tidak ada di daftar loyalitas.");
                        }
                        const roles = await shopDb.getLoyaltyRoles(guildId);
                        return reply({
                            embeds: [{
                                title: "🏅 Role Loyalitas",
                                color: 0xf1c40f,
                                description: roles.length ? roles.map((r) => `<@&${r.role_id}> — mulai belanja ${rupiah(r.min_spent)}`).join("\n") : "_Belum ada. Tambah dengan `/loyalitas atur`._",
                            }],
                        });
                    }

                    case "harga": {
                        if (!config) return say("Toko belum dibuka.");
                        return reply({ embeds: [priceEmbed(config, Number(getOption(opts, "jumlah")?.value))] });
                    }

                    case "riwayat": {
                        const orders = await shopDb.getUserOrders(guildId, userId, 10);
                        const [totalRobux, totalSpent] = await Promise.all([shopDb.getUserTotalRobux(guildId, userId), shopDb.getUserTotalSpent(guildId, userId)]);
                        return reply({
                            embeds: [{
                                title: "🧾 Riwayat Pesanan",
                                color: BRAND_COLOR,
                                description: orders.length
                                    ? orders.map((o) => `\`${orderCode(o.id)}\` <t:${o.created_at}:d> · ${robux(o.robux)} · ${rupiah(o.price)} · ${STATUS_LABEL[o.status]}`).join("\n")
                                    : "_Kamu belum pernah memesan._",
                                footer: { text: `Total belanja: ${rupiah(totalSpent)} · Robux dibeli: ${totalRobux.toLocaleString("id-ID")} R$` },
                            }],
                        });
                    }

                }
                return;
            }

            // ===================== Tombol =====================
            if (interaction.type === InteractionType.MessageComponent) {
                const [, action, idStr] = interaction.data.custom_id.split(":");
                const orderId = Number(idStr);

                if (action === "price") {
                    if (!config) return say("Toko belum dibuka.");
                    return reply({ embeds: [priceEmbed(config, Math.max(config.min_order, 1000))], content: "Contoh untuk 1.000 R$. Pakai `/harga jumlah:` untuk angka lain." });
                }
                if (action === "buy") {
                    if (!config || enabledMethods(config).length === 0) return say("Toko belum dibuka. Tunggu admin mengatur harga, ya.");
                    if (!config.is_open) return say(`🔴 Toko sedang tutup.${config.close_reason ? `\n> ${config.close_reason}` : ""}`);
                    const open = await shopDb.getOpenOrderForUser(guildId, userId);
                    if (open) return say(`Kamu masih punya pesanan aktif ${orderCode(open.id)}${open.channel_id ? ` di <#${open.channel_id}>` : ""}. Selesaikan atau batalkan dulu.`);
                    return reply(buyMethodPicker(config));
                }
                if (action === "buym") {
                    const method = methodFromValue(idStr);
                    if (!config || !method || !isMethodEnabled(config, method)) return say("Metode ini sedang tidak tersedia.");
                    if (!config.is_open) return say(`🔴 Toko sedang tutup.${config.close_reason ? `\n> ${config.close_reason}` : ""}`);
                    const open = await shopDb.getOpenOrderForUser(guildId, userId);
                    if (open) return say(`Kamu masih punya pesanan aktif ${orderCode(open.id)}${open.channel_id ? ` di <#${open.channel_id}>` : ""}. Selesaikan atau batalkan dulu.`);
                    await api.interactions.createModal(interaction.id, interaction.token, orderModal(config, method));
                    replied = true;
                    return;
                }

                if (action === "ask") {
                    if (!config) return say("Toko belum dibuka.");
                    await defer();
                    const view = (PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.AttachFiles | PermissionFlagsBits.EmbedLinks);
                    const overwrites: any[] = [
                        { id: guildId, type: OverwriteType.Role, deny: PermissionFlagsBits.ViewChannel.toString() },
                        { id: userId, type: OverwriteType.Member, allow: view.toString() },
                        { id: applicationId, type: OverwriteType.Member, allow: (view | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageMessages).toString() },
                    ];
                    if (config.admin_role_id) overwrites.push({ id: config.admin_role_id, type: OverwriteType.Role, allow: (view | PermissionFlagsBits.ManageMessages).toString() });
                    let channel: { id: string } | null = null;
                    try {
                        channel = await api.guilds.createChannel(guildId, {
                            name: `tanya-${sanitizeChannelName(member?.user.username ?? "member")}`,
                            type: ChannelType.GuildText,
                            parent_id: config.ticket_category_id ?? undefined,
                            permission_overwrites: overwrites,
                            topic: `Tiket pertanyaan · ${userId}`,
                        }, { reason: "Tiket pertanyaan" });
                    } catch (err) {
                        console.log(`[shop] gagal membuat tiket tanya: ${err}`);
                        return edit({ content: "❌ Gagal membuat tiket. Admin perlu memberi bot izin **Manage Channels**." });
                    }
                    await api.channels.createMessage(channel.id, askTicketMessage(userId, config.admin_role_id, config.store_name));
                    await logToChannel(api, config, { title: "❓ Tiket pertanyaan dibuka", description: `<@${userId}> · <#${channel.id}>`, color: BRAND_COLOR });
                    return edit({ content: `✅ Tiket pertanyaan dibuat: <#${channel.id}>` });
                }
                if (action === "closeask") {
                    const ownerId = idStr;
                    if (!admin && userId !== ownerId) return say("❌ Kamu tidak bisa menutup tiket ini.");
                    await say("🔒 Tiket ditutup dalam 5 detik…");
                    const channelId = interaction.message.channel_id;
                    if (config) await logToChannel(api, config, { title: "🔒 Tiket pertanyaan ditutup", description: `Oleh <@${userId}>`, color: 0x95a5a6 });
                    setTimeout(() => {
                        api.channels.delete(channelId).catch((err: unknown) => console.log(`[shop] gagal hapus tiket tanya: ${err}`));
                    }, 5000);
                    return;
                }

                // --- aksi pada pesanan ---
                if (!config || !Number.isInteger(orderId)) return say("❌ Pesanan tidak valid.");
                const order = await shopDb.getOrder(guildId, orderId);
                if (!order) return say("❌ Pesanan tidak ditemukan.");
                const isBuyer = order.user_id === userId;
                const stripButtons = () => api.channels.editMessage(interaction.message.channel_id, interaction.message.id, { components: [] }).catch(() => null);
                const stale = () => say(`Status pesanan sudah berubah menjadi ${STATUS_LABEL[order.status]}.`);

                switch (action) {
                    case "verify": {
                        if (!admin) return say("❌ Hanya admin yang bisa mengonfirmasi pembayaran.");
                        if (!["menunggu_pembayaran", "menunggu_verifikasi"].includes(order.status)) return stale();
                        // GIG: admin mengisi total harga yang dibayar pembeli
                        if (isManual(order.method)) {
                            await api.interactions.createModal(interaction.id, interaction.token, gigPriceModal(order));
                            replied = true;
                            return;
                        }
                        const updated = await shopDb.confirmOrder(guildId, orderId, userId);
                        if (!updated) return stale();
                        await say("✅ Pembayaran dikonfirmasi.");
                        await stripButtons();
                        await announceConfirmed(api, config, updated);
                        return;
                    }
                    case "done": {
                        if (!admin) return say("❌ Hanya admin yang bisa menyelesaikan pesanan.");
                        await defer();
                        const done = await shopDb.completeOrder(guildId, orderId, userId);
                        if (!done) return edit({ content: `Status pesanan sudah berubah menjadi ${STATUS_LABEL[order.status]}.` });
                        await stripButtons();
                        const newRoles = await applyLoyaltyRoles(api, guildId, done.user_id);
                        const roleNote = newRoles.length ? `\n🏅 Kamu mendapat role baru: ${newRoles.map((r) => `<@&${r}>`).join(", ")}` : "";
                        await postOrderStatus(api, done, `🎉 Pesanan Selesai — ${orderCode(orderId)}`,
                            `<@${done.user_id}> ${done.method === "boost" ? "Joki sudah selesai! Jangan lupa ganti password akunmu 🔐" : done.method === "gift" ? "Item sudah dikirim!" : "Robux sudah dikirim!"} Terima kasih sudah berbelanja 🙏\nBantu kami dengan memberi testimoni lewat tombol ⭐ di bawah.${roleNote}`);
                        await logToChannel(api, config, orderEmbed(done, `🎉 Selesai ${orderCode(orderId)}`));
                        if (config.history_channel_id) {
                            const buyer: UserLike = await api.users.get(done.user_id).catch(() => ({ id: done.user_id, username: "pembeli" }));
                            const total = await shopDb.getUserTotalSpent(guildId, done.user_id);
                            await postToHistory(api, config, historyCompletedEmbed(done, buyer, member?.user ?? null, total));
                        }
                        await refreshLeaderboard(api, guildId);
                        return edit({ content: "✅ Pesanan selesai." });
                    }
                    case "cancel": {
                        const buyerCanCancel = isBuyer && ["menunggu_pembayaran", "menunggu_verifikasi"].includes(order.status);
                        if (!admin && !buyerCanCancel) {
                            return say(isBuyer ? "Pembayaranmu sudah dikonfirmasi, pembatalan hanya bisa dilakukan admin." : "❌ Kamu tidak bisa membatalkan pesanan ini.");
                        }
                        const from: OrderStatus[] = admin ? ["menunggu_pembayaran", "menunggu_verifikasi", "diproses"] : ["menunggu_pembayaran", "menunggu_verifikasi"];
                        const updated = await shopDb.transitionOrder(guildId, orderId, from, "dibatalkan", userId);
                        if (!updated) return stale();
                        await say("Pesanan dibatalkan.");
                        await stripButtons();
                        await postOrderStatus(api, updated, `❌ Dibatalkan — ${orderCode(orderId)}`, `Pesanan dibatalkan oleh <@${userId}>.${order.status === "diproses" ? " Jika kamu sudah membayar, admin akan memproses pengembalian dana." : ""}`);
                        await logToChannel(api, config, orderEmbed(updated, `❌ Dibatalkan ${orderCode(orderId)}`));
                        return;
                    }
                    case "testi": {
                        if (!isBuyer) return say("Hanya pembeli yang bisa memberi testimoni.");
                        if (order.status !== "selesai") return say("Testimoni bisa diberikan setelah pesanan selesai.");
                        if (order.testimonial_posted) return say("Terima kasih, kamu sudah memberi testimoni untuk pesanan ini 🙏");
                        if (!config.testimonial_channel_id) return say("Channel testimoni belum diatur admin.");
                        await api.interactions.createModal(interaction.id, interaction.token, testimonialModal(orderId));
                        replied = true;
                        return;
                    }
                    case "close": {
                        if (!shopDb.FINAL_STATUSES.includes(order.status)) return say("Tiket hanya bisa ditutup setelah pesanan selesai atau dibatalkan.");
                        if (!admin && !isBuyer) return say("❌ Kamu tidak bisa menutup tiket ini.");
                        if (!order.channel_id) return say("Tiket sudah ditutup.");
                        await say("🔒 Tiket ditutup dalam 5 detik…");
                        const channelId = order.channel_id;
                        await shopDb.setOrderChannel(orderId, null);
                        if (config.history_channel_id && member?.user) {
                            const ch: any = await api.channels.get(channelId).catch(() => null);
                            await postToHistory(api, config, historyTicketClosedEmbed(order, ch?.name ?? `order-${String(orderId).padStart(4, "0")}`, member.user));
                        }
                        await logToChannel(api, config, { title: `🔒 Tiket ${orderCode(orderId)} ditutup`, description: `Oleh <@${userId}>`, color: 0x95a5a6 });
                        setTimeout(() => {
                            api.channels.delete(channelId).catch((err: unknown) => console.log(`[shop] gagal hapus tiket: ${err}`));
                        }, 5000);
                        return;
                    }
                }
                return;
            }

            // ===================== Modal =====================
            if (interaction.type === InteractionType.ModalSubmit) {
                const [, kind, idStr] = interaction.data.custom_id.split(":");
                const values = modalValues(interaction.data.components as any[]);

                if (kind === "say") {
                    if (!admin) return say("❌ Hanya admin.");
                    const body = (values.body ?? "").trim().slice(0, 2000);
                    if (!body) return say("❌ Pesan kosong.");
                    const msg = await api.channels.createMessage(idStr!, { content: body, allowed_mentions: { parse: [] } }).catch((err: unknown) => {
                        console.log(`[shop] gagal kirim pesan: ${err}`);
                        return null;
                    });
                    if (!msg) return say(`❌ Gagal mengirim ke <#${idStr}>. Pastikan bot bisa melihat & mengirim pesan di sana.`);
                    if (config) await logToChannel(api, config, { title: "✉️ Pesan dikirim sebagai bot", description: `<@${userId}> di <#${idStr}>`, color: 0x95a5a6 });
                    return say(`✅ Pesan terkirim ke <#${idStr}>.`);
                }

                if (kind === "announce") {
                    if (!admin) return say("❌ Hanya admin.");
                    const [, , channelId, ping, roleRaw, colorHex] = interaction.data.custom_id.split(":");
                    const roleId = roleRaw && roleRaw !== "-" ? roleRaw : null;
                    const title = trim((values.title ?? "").trim(), 256);
                    const body = trim((values.body ?? "").trim(), 4000);
                    const imageRaw = (values.image ?? "").trim();
                    let image: string | null = null;
                    if (imageRaw) {
                        try {
                            const u = new URL(imageRaw);
                            if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
                            image = u.toString();
                        } catch {
                            return say("❌ Link gambar tidak valid. Pakai link yang diawali `https://`, atau kosongkan.");
                        }
                    }
                    let content: string | undefined;
                    let allowed: { parse?: ("everyone" | "roles" | "users")[]; roles?: string[] } = { parse: [] };
                    if (ping === "everyone") { content = "@everyone"; allowed = { parse: ["everyone"] }; }
                    else if (ping === "here") { content = "@here"; allowed = { parse: ["everyone"] }; }
                    else if (ping === "store" && config?.ping_role_id) { const rp = rolePing(guildId, config.ping_role_id); content = rp.text; allowed = rp.allowed; }
                    else if (ping === "role" && roleId) { const rp = rolePing(guildId, roleId); content = rp.text; allowed = rp.allowed; }

                    // Gambar yang di-upload lewat opsi `gambar` diunggah ulang supaya tidak kedaluwarsa.
                    let file: { name: string; data: Buffer } | undefined;
                    const pending = pendingAnnounceImages.get(userId);
                    pendingAnnounceImages.delete(userId);
                    if (pending && Date.now() - pending.at < 15 * 60 * 1000) {
                        await defer();
                        const res = await fetch(pending.url).catch(() => null);
                        if (!res?.ok) return edit({ content: "❌ Gagal mengambil gambar, coba ulangi `/announce`." });
                        const ext = (pending.filename.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
                        file = { name: `banner.${ext}`, data: Buffer.from(await res.arrayBuffer()) };
                    }
                    const done = (m: string) => (deferred ? edit({ content: m }) : say(m));

                    const store = config?.store_name ?? shopDb.DEFAULT_STORE_NAME;
                    const msg = await api.channels.createMessage(channelId!, announceMessage(store, title, body, parseInt(colorHex ?? "2ecc71", 16), image, content, allowed, file) as any).catch((err: unknown) => {
                        console.log(`[shop] gagal kirim pengumuman: ${err}`);
                        return null;
                    });
                    if (!msg) return done(`❌ Gagal mengirim ke <#${channelId}>. Pastikan bot bisa melihat & mengirim pesan${file ? " serta melampirkan file (Attach Files)" : ""} di sana${content ? " (dan punya izin **Mention Everyone** untuk ping)" : ""}.`);
                    if (config) await logToChannel(api, config, { title: "📢 Pengumuman dikirim", description: `<@${userId}> di <#${channelId}>: **${title}**`, color: 0x95a5a6 });
                    return done(`✅ Pengumuman terkirim ke <#${channelId}>.`);
                }

                if (kind === "payment") {
                    if (!admin) return say("❌ Hanya admin.");
                    const c = config ?? shopDb.defaultConfig(guildId);
                    c.payment_info = trim((values.payment_info ?? "").trim(), 1500) || null;
                    await shopDb.saveShopConfig(c);
                    return reply({ content: "✅ Info pembayaran disimpan. Pratinjau:", embeds: [{ description: c.payment_info ?? "-", color: BRAND_COLOR }] });
                }

                if (kind === "order") {
                    if (!config) return say("Toko belum dibuka.");
                    if (!config.is_open) return say(`🔴 Maaf, toko baru saja ditutup.${config.close_reason ? `\n> ${config.close_reason}` : ""}`);
                    const amount = parseAmount(values.amount ?? "");
                    const username = (values.username ?? "").trim();
                    const method = methodFromValue(idStr);
                    const extra = trim((values.note ?? "").trim(), 300);
                    const note = method === "gift"
                        ? trim(`${(values.game ?? "").trim()} — ${(values.item ?? "").trim()}`, 200)
                        : method === "boost"
                            ? `${(values.game ?? "").trim()}: ${(values.current ?? "").trim()} → ${(values.target ?? "").trim()}${extra ? `\n${extra}` : ""}`
                            : extra || null;

                    if (method === "boost") {
                        if (username.length < 2 || username.length > 60) return say("❌ Nickname / ID akun game harus 2–60 karakter.");
                    } else if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return say("❌ Username Roblox tidak valid (3–20 karakter: huruf, angka, underscore).");
                    if (!method) return say("❌ Metode pengiriman tidak valid, ulangi dari panel toko.");
                    const check = validateOrder(config, amount, method);
                    if (!check.ok) return say(`❌ ${check.error}`);

                    const open = await shopDb.getOpenOrderForUser(guildId, userId);
                    if (open) return say(`Kamu masih punya pesanan aktif ${orderCode(open.id)}${open.channel_id ? ` di <#${open.channel_id}>` : ""}.`);

                    await defer();
                    const order = await shopDb.createOrder({
                        guild_id: guildId,
                        user_id: userId,
                        robux: check.robux,
                        price: check.price,
                        stock_cost: check.stockCost,
                        method,
                        roblox_username: username,
                        note,
                    });

                    const view = (PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.AttachFiles | PermissionFlagsBits.EmbedLinks | PermissionFlagsBits.UseApplicationCommands);
                    const overwrites: any[] = [
                        { id: guildId, type: OverwriteType.Role, deny: PermissionFlagsBits.ViewChannel.toString() },
                        { id: userId, type: OverwriteType.Member, allow: view.toString() },
                        { id: applicationId, type: OverwriteType.Member, allow: (view | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageMessages).toString() },
                    ];
                    if (config.admin_role_id) overwrites.push({ id: config.admin_role_id, type: OverwriteType.Role, allow: (view | PermissionFlagsBits.ManageMessages).toString() });

                    const username_ = sanitizeChannelName(member?.user.username ?? "pembeli");
                    const prefix = order.method === "gift" ? "gig" : order.method === "boost" ? "joki" : "order";
                    let channel: { id: string } | null = null;
                    try {
                        channel = await api.guilds.createChannel(guildId, {
                            name: `${prefix}-${String(order.id).padStart(4, "0")}-${username_}`,
                            type: ChannelType.GuildText,
                            parent_id: config.ticket_category_id ?? undefined,
                            permission_overwrites: overwrites,
                            topic: (order.method === "boost"
                                ? `Pesanan ${orderCode(order.id)} · Joki ${order.note?.split("\n")[0] ?? ""} · Pembeli ${userId}`
                                : `Pesanan ${orderCode(order.id)} · ${robux(order.robux)} via ${METHOD_LABEL[order.method]}${order.method === "gift" && order.note ? ` (${order.note})` : ""} · Pembeli ${userId}`).slice(0, 1024),
                        }, { reason: `Tiket pesanan ${orderCode(order.id)}` });
                    } catch (err) {
                        console.log(`[shop] gagal membuat tiket: ${err}`);
                        await shopDb.transitionOrder(guildId, order.id, ["menunggu_pembayaran"], "dibatalkan");
                        return edit({ content: "❌ Gagal membuat tiket. Admin perlu memberi bot izin **Manage Channels** (dan akses ke kategori tiket). Pesanan dibatalkan otomatis." });
                    }

                    await shopDb.setOrderChannel(order.id, channel.id);
                    const withChannel = { ...order, channel_id: channel.id };
                    await api.channels.createMessage(channel.id, {
                        content: `Halo <@${userId}>! Terima kasih sudah memesan.${config.admin_role_id ? ` <@&${config.admin_role_id}>` : ""}`,
                        embeds: [orderEmbed(withChannel), instructionsEmbed(withChannel, config)],
                        components: orderButtons(withChannel),
                        allowed_mentions: { users: [userId], roles: config.admin_role_id ? [config.admin_role_id] : [] },
                    });
                    await logToChannel(api, config, { ...orderEmbed(withChannel, `🆕 Pesanan baru ${orderCode(order.id)}`), description: `Tiket: <#${channel.id}>` });
                    return edit({ content: `✅ Pesanan ${orderCode(order.id)} dibuat! Lanjutkan di <#${channel.id}>.` });
                }

                if (kind === "gigprice") {
                    if (!config || !admin) return say("❌ Hanya admin yang bisa mengonfirmasi pembayaran.");
                    const price = parseAmount(values.price ?? "");
                    if (!Number.isInteger(price) || price <= 0) return say("❌ Total harga harus berupa angka Rupiah, contoh `65000`.");
                    const updated = await shopDb.confirmOrder(guildId, Number(idStr), userId, price);
                    if (!updated) return say("Status pesanan sudah berubah, konfirmasi dibatalkan.");
                    await say(`✅ Pembayaran ${updated.method === "boost" ? "joki" : "GIG"} dikonfirmasi: ${rupiah(price)}.`);
                    const msg = (interaction as any).message;
                    if (msg?.id) await api.channels.editMessage(msg.channel_id, msg.id, { components: [] }).catch(() => null);
                    await announceConfirmed(api, config, updated);
                    return;
                }

                if (kind === "testi") {
                    if (!config?.testimonial_channel_id) return say("Channel testimoni belum diatur admin.");
                    const order = await shopDb.getOrder(guildId, Number(idStr));
                    if (!order || order.user_id !== userId || order.status !== "selesai") return say("❌ Pesanan tidak valid.");
                    const rating = Math.min(5, Math.max(1, parseInt(values.rating ?? "5", 10) || 5));
                    const review = trim((values.review ?? "").trim(), 500);
                    if (!(await shopDb.markTestimonialPosted(order.id))) return say("Kamu sudah memberi testimoni untuk pesanan ini 🙏");
                    const buyer: UserLike = member?.user ?? { id: userId, username: "pembeli" };
                    await api.channels.createMessage(config.testimonial_channel_id, vouchMessage(order, buyer, rating, review, config.store_name)).catch((err: unknown) => console.log(`[shop] gagal kirim testimoni: ${err}`));
                    return say("⭐ Terima kasih atas testimoninya!");
                }
            }
        } catch (err) {
            console.error(`[shop] error interaction: ${err}`);
            const msg = "❌ Terjadi kesalahan. Coba lagi atau hubungi admin.";
            if (deferred) await edit({ content: msg }).catch(() => null);
            else if (!replied) await say(msg).catch(() => null);
        }
    }
}
