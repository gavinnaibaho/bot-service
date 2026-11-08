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
import type { Order, OrderStatus, ShopConfig } from "./db";
import { SHOP_COMMAND_NAMES } from "./commands";
import { METHODS, METHOD_LABEL, STATUS_LABEL, enabledMethods, methodLabel, methodPrice, orderCode, parseAmount, robux, rupiah, startOfTodayWIB, validateOrder } from "./pricing";
import {
    instructionsEmbed,
    methodFromValue,
    orderButtons,
    orderEmbed,
    orderModal,
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
    } catch {
        // panel sudah dihapus: lupakan
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
    const total = await shopDb.getUserTotalRobux(guildId, userId);
    const eligible = roles.filter((r) => total >= r.min_robux).map((r) => r.role_id);
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
                        if (v("harga_gig") !== undefined) c.price_gift = v("harga_gig");
                        if (v("harga_username") !== undefined) c.price_username = v("harga_username");
                        if (v("harga_login") !== undefined) c.price_login = v("harga_login");
                        if (v("harga_grup") !== undefined) c.price_group = v("harga_grup");
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
                                color: 0x00b06f,
                                description: [
                                    `**Role admin:** ${c.admin_role_id ? `<@&${c.admin_role_id}>` : "_belum (hanya yang punya Manage Server)_"}`,
                                    `**Kategori tiket:** ${c.ticket_category_id ? `<#${c.ticket_category_id}>` : "_belum (tiket dibuat tanpa kategori)_"}`,
                                    `**Log:** ${c.log_channel_id ? `<#${c.log_channel_id}>` : "_belum_"}`,
                                    `**Testimoni:** ${c.testimonial_channel_id ? `<#${c.testimonial_channel_id}>` : "_belum_"}`,
                                    ...METHODS.map((m) => `**${methodLabel(m)}:** ${methodPrice(c, m) ? `${rupiah(methodPrice(c, m))} / 100 R$` : "nonaktif"}`),
                                    `**Order:** ${robux(c.min_order)} – ${robux(c.max_order)}`,
                                    `**Info pembayaran:** ${c.payment_info ? "sudah diatur" : "_belum — pakai `/toko-pembayaran`_"}`,
                                    `**Nama toko:** ${c.store_name} · **Role ping:** ${c.ping_role_id ? `<@&${c.ping_role_id}>` : "_tidak ada_"}`,
                                    `**Riwayat:** ${c.history_channel_id ? `<#${c.history_channel_id}>` : "_belum_"} · **Leaderboard:** ${c.leaderboard_channel_id ? `<#${c.leaderboard_channel_id}>` : "_belum_"}`,
                                    `**Status:** ${c.is_open ? "🟢 Buka" : "🔴 Tutup"} · **Pengumuman:** ${c.announce_channel_id ? `<#${c.announce_channel_id}>` : "_belum_"} · **Ganti nama channel:** ${c.rename_channel ? "ya" : "tidak"}`,
                                ].join("\n"),
                            }],
                        });
                        await refreshPanel(api, guildId);
                        if (leaderboardChanged) await refreshLeaderboard(api, guildId);
                        return;
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

                    case "toko-pembayaran":
                        await api.interactions.createModal(interaction.id, interaction.token, paymentInfoModal(config?.payment_info ?? null));
                        replied = true;
                        return;

                    case "toko-panel": {
                        const c = config ?? shopDb.defaultConfig(guildId);
                        const msg = await api.channels.createMessage(interaction.channel!.id, panelMessage(c)).catch(() => null);
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
                            const min = Number(getOption(subOpts, "minimal_robux")?.value);
                            if (roleId === guildId) return say("❌ Tidak bisa memakai role @everyone.");
                            await shopDb.setLoyaltyRole(guildId, roleId, min);
                            return say(`✅ <@&${roleId}> akan diberikan ke pembeli dengan total pembelian ≥ **${robux(min)}**.\n-# Pastikan role bot berada di atas role ini dan bot punya izin Manage Roles.`);
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
                                description: roles.length ? roles.map((r) => `<@&${r.role_id}> — mulai ${robux(r.min_robux)}`).join("\n") : "_Belum ada. Tambah dengan `/loyalitas atur`._",
                            }],
                        });
                    }

                    case "harga": {
                        if (!config) return say("Toko belum dibuka.");
                        return reply({ embeds: [priceEmbed(config, Number(getOption(opts, "jumlah")?.value))] });
                    }

                    case "riwayat": {
                        const orders = await shopDb.getUserOrders(guildId, userId, 10);
                        const total = await shopDb.getUserTotalRobux(guildId, userId);
                        return reply({
                            embeds: [{
                                title: "🧾 Riwayat Pesanan",
                                color: 0x00b06f,
                                description: orders.length
                                    ? orders.map((o) => `\`${orderCode(o.id)}\` <t:${o.created_at}:d> · ${robux(o.robux)} · ${rupiah(o.price)} · ${STATUS_LABEL[o.status]}`).join("\n")
                                    : "_Kamu belum pernah memesan._",
                                footer: { text: `Total Robux dibeli: ${total.toLocaleString("id-ID")} R$` },
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
                    await api.interactions.createModal(interaction.id, interaction.token, orderModal(config));
                    replied = true;
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
                        const updated = await shopDb.transitionOrder(guildId, orderId, ["menunggu_pembayaran", "menunggu_verifikasi"], "diproses", userId);
                        if (!updated) return stale();
                        await say("✅ Pembayaran dikonfirmasi.");
                        await stripButtons();
                        const reminder = updated.method === "login" ? "\n🔐 Admin akan meminta data login di tiket ini. Ingat untuk ganti password setelah selesai." : "";
                        await postOrderStatus(api, updated, `⚙️ Pembayaran diterima — ${orderCode(orderId)}`, `<@${updated.user_id}> pembayaranmu sudah dikonfirmasi, Robux sedang diproses.${reminder}`);
                        await logToChannel(api, config, orderEmbed(updated, `✅ Pembayaran dikonfirmasi ${orderCode(orderId)}`));
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
                            `<@${done.user_id}> Robux sudah dikirim! Terima kasih sudah berbelanja 🙏\nBantu kami dengan memberi testimoni lewat tombol ⭐ di bawah.${roleNote}`);
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

                if (kind === "payment") {
                    if (!admin) return say("❌ Hanya admin.");
                    const c = config ?? shopDb.defaultConfig(guildId);
                    c.payment_info = trim((values.payment_info ?? "").trim(), 1500) || null;
                    await shopDb.saveShopConfig(c);
                    return reply({ content: "✅ Info pembayaran disimpan. Pratinjau:", embeds: [{ description: c.payment_info ?? "-", color: 0x00b06f }] });
                }

                if (kind === "order") {
                    if (!config) return say("Toko belum dibuka.");
                    if (!config.is_open) return say(`🔴 Maaf, toko baru saja ditutup.${config.close_reason ? `\n> ${config.close_reason}` : ""}`);
                    const amount = parseAmount(values.amount ?? "");
                    const username = (values.username ?? "").trim();
                    const method = methodFromValue(values.method);
                    const note = trim((values.note ?? "").trim(), 200) || null;

                    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return say("❌ Username Roblox tidak valid (3–20 karakter: huruf, angka, underscore).");
                    if (!method) return say("❌ Pilih metode pengiriman.");
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
                    let channel: { id: string } | null = null;
                    try {
                        channel = await api.guilds.createChannel(guildId, {
                            name: `order-${String(order.id).padStart(4, "0")}-${username_}`,
                            type: ChannelType.GuildText,
                            parent_id: config.ticket_category_id ?? undefined,
                            permission_overwrites: overwrites,
                            topic: `Pesanan ${orderCode(order.id)} · ${robux(order.robux)} via ${METHOD_LABEL[order.method]} · Pembeli ${userId}`,
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
