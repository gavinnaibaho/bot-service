// Voice sementara (Join to Create): member masuk ke channel "➕ Buat Voice",
// bot membuat voice milik dia, lalu pemilik mengatur batas orang, private/public, dll. lewat panel.
import type { API } from "@discordjs/core";
import {
    ButtonStyle,
    ChannelType,
    ComponentType,
    InteractionType,
    MessageFlags,
    OverwriteType,
    PermissionFlagsBits,
    TextInputStyle,
    type APIInteraction,
    type APIGuildChannel,
    type APIOverwrite,
    type GatewayGuildCreateDispatchData,
    type GatewayVoiceState,
} from "discord-api-types/v10";
import * as db from "./db";
import { brandColor } from "./ui";
import { hasPermission, trim } from "./tools";

const CONNECT = PermissionFlagsBits.Connect;
const VIEW = PermissionFlagsBits.ViewChannel;

// ---------- Siapa ada di voice mana (dari gateway) ----------

/** guild -> (user -> voice channel) */
const voiceStates = new Map<string, Map<string, string>>();
/** Member yang sedang dibuatkan voice, supaya tidak dobel saat event datang beruntun. */
const creating = new Set<string>();

function statesOf(guildId: string) {
    let m = voiceStates.get(guildId);
    if (!m) voiceStates.set(guildId, (m = new Map()));
    return m;
}

function membersIn(guildId: string, channelId: string): string[] {
    const out: string[] = [];
    for (const [user, ch] of statesOf(guildId)) if (ch === channelId) out.push(user);
    return out;
}

// ---------- Izin channel ----------

const bits = (s: string | undefined) => BigInt(s ?? "0");
const ow = (id: string, type: OverwriteType, allow: bigint, deny: bigint): APIOverwrite => ({ id, type, allow: String(allow), deny: String(deny) });

/** Izin role mengikuti kategori induk; saat private, semua role (termasuk @everyone) tidak bisa Connect. */
function roleOverwrites(parent: APIOverwrite[], guildId: string, locked: boolean): APIOverwrite[] {
    const roles = parent.filter((o) => o.type === OverwriteType.Role).map((o) => ({ ...o }));
    if (!locked) return roles;
    let everyone = roles.find((o) => o.id === guildId);
    if (!everyone) roles.push((everyone = ow(guildId, OverwriteType.Role, 0n, 0n)));
    return roles.map((o) => {
        const allow = bits(o.allow) & ~CONNECT;
        const deny = o.id === guildId ? bits(o.deny) | CONNECT : bits(o.deny);
        return ow(o.id, OverwriteType.Role, allow, deny);
    });
}

function isLocked(channel: APIGuildChannel<any>, guildId: string): boolean {
    const everyone = channel.permission_overwrites?.find((o) => o.id === guildId);
    return !!everyone && (bits(everyone.deny) & CONNECT) === CONNECT;
}

async function parentOverwrites(api: API, channel: APIGuildChannel<any>): Promise<APIOverwrite[]> {
    if (!channel.parent_id) return [];
    const parent = (await api.channels.get(channel.parent_id).catch(() => null)) as APIGuildChannel<any> | null;
    return parent?.permission_overwrites ?? [];
}

/** Ubah izin satu member di voice (gabung dengan izin member lain yang sudah ada). */
function withMember(list: APIOverwrite[], userId: string, allowAdd: bigint, denyAdd: bigint): APIOverwrite[] {
    const others = list.filter((o) => !(o.type === OverwriteType.Member && o.id === userId));
    const cur = list.find((o) => o.type === OverwriteType.Member && o.id === userId);
    const allow = (bits(cur?.allow) & ~denyAdd) | allowAdd;
    const deny = (bits(cur?.deny) & ~allowAdd) | denyAdd;
    return [...others, ow(userId, OverwriteType.Member, allow, deny)];
}

async function setOverwrites(api: API, channelId: string, overwrites: APIOverwrite[], reason: string) {
    await api.channels.edit(channelId, { permission_overwrites: overwrites } as any, { reason });
}

// ---------- Panel pengaturan ----------

/** Panel voice: hanya tombol berwarna. Tombol Kunci/Buka mengikuti status voice. */
function panelComponents(ch: Partial<APIGuildChannel<any>>, _ownerId: string, guildId: string) {
    const locked = isLocked(ch as any, guildId);
    const btn = (id: string, label: string, style = ButtonStyle.Secondary) => ({ type: ComponentType.Button, custom_id: `vc:${id}`, label, style });
    return [
        { type: ComponentType.ActionRow, components: [btn("limit", "Batas"), locked ? btn("unlock", "Buka") : btn("lock", "Kunci"), btn("permit", "Izinkan", ButtonStyle.Success), btn("kick", "Kick", ButtonStyle.Danger)] },
        { type: ComponentType.ActionRow, components: [btn("rename", "Ganti Nama"), btn("claim", "Klaim", ButtonStyle.Primary)] },
    ];
}

/** Perbarui panel yang sudah ada (tanpa mengirim ulang flag Components V2). */
async function refreshPanel(api: API, channelId: string, messageId: string | undefined, ownerId: string, guildId: string, _override?: { name?: string }) {
    if (!messageId) return;
    const ch = (await api.channels.get(channelId).catch(() => null)) as APIGuildChannel<any> | null;
    if (!ch) return;
    await api.channels.editMessage(channelId, messageId, { components: panelComponents(ch, ownerId, guildId), allowed_mentions: { parse: [] } } as any)
        .catch((err) => console.log(`[voice] gagal memperbarui panel: ${err}`));
}

function userPickerModal(customId: string, title: string, label: string) {
    return {
        title,
        custom_id: customId,
        components: [{
            type: ComponentType.Label,
            label,
            component: { type: ComponentType.UserSelect, custom_id: "users", min_values: 1, max_values: 10, required: true },
        }],
    } as any;
}

function textModal(customId: string, title: string, label: string, placeholder: string, max: number, value?: string) {
    return {
        title,
        custom_id: customId,
        components: [{
            type: ComponentType.Label,
            label,
            component: { type: ComponentType.TextInput, custom_id: "value", style: TextInputStyle.Short, placeholder, max_length: max, required: true, value },
        }],
    } as any;
}

/** Ambil nilai dari modal: teks (value) atau pilihan user (values[]). */
function modalField(components: any[], id: string): string[] {
    for (const outer of components) {
        const items = outer.type === ComponentType.Label ? [outer.component] : outer.components ?? [outer];
        for (const c of items) {
            if (c?.custom_id !== id) continue;
            if (Array.isArray(c.values)) return c.values.map(String);
            if (typeof c.value === "string") return [c.value];
        }
    }
    return [];
}

// ---------- Gateway: buat & hapus voice ----------

export function onGuildCreate(api: API, data: GatewayGuildCreateDispatchData | any) {
    const map = statesOf(data.id);
    map.clear();
    for (const vs of data.voice_states ?? []) if (vs.channel_id) map.set(vs.user_id, vs.channel_id);
    // Bersihkan voice sementara yang kosong / sudah dihapus selama bot offline.
    void (async () => {
        const existing = new Set((data.channels ?? []).map((c) => c.id));
        for (const v of await db.listTempVoices(data.id)) {
            if (!existing.has(v.channel_id)) await db.removeTempVoice(v.channel_id);
            else if (membersIn(data.id, v.channel_id).length === 0) await deleteTempVoice(api, v.channel_id);
        }
    })().catch((err) => console.log(`[voice] gagal membersihkan voice lama: ${err}`));
}

export async function onVoiceStateUpdate(api: API, vs: GatewayVoiceState) {
    const guildId = vs.guild_id;
    if (!guildId) return;
    const map = statesOf(guildId);
    const prev = map.get(vs.user_id) ?? null;
    if (vs.channel_id) map.set(vs.user_id, vs.channel_id);
    else map.delete(vs.user_id);

    // Keluar dari voice sementara → hapus kalau kosong.
    if (prev && prev !== vs.channel_id && membersIn(guildId, prev).length === 0) {
        const temp = await db.getTempVoice(prev);
        if (temp) await deleteTempVoice(api, prev);
    }

    // Masuk ke "➕ Buat Voice" → buatkan voice.
    if (!vs.channel_id || vs.channel_id === prev) return;
    const config = await db.getTempVoiceConfig(guildId);
    if (!config || vs.channel_id !== config.create_channel_id) return;
    if (vs.member?.user?.bot) return;
    if (creating.has(vs.user_id)) return;
    creating.add(vs.user_id);
    try {
        await createFor(api, guildId, vs, config);
    } catch (err) {
        console.log(`[voice] gagal membuat voice: ${err}`);
    } finally {
        creating.delete(vs.user_id);
    }
}

async function createFor(api: API, guildId: string, vs: GatewayVoiceState, config: db.TempVoiceConfig) {
    // Sudah punya voice? Pindahkan ke sana saja.
    const owned = await db.getTempVoiceByOwner(guildId, vs.user_id);
    if (owned) {
        const ok = await api.guilds.editMember(guildId, vs.user_id, { channel_id: owned.channel_id }).then(() => true).catch(() => false);
        if (ok) return;
        await db.removeTempVoice(owned.channel_id); // channel lama sudah tidak ada
    }

    const trigger = (await api.channels.get(config.create_channel_id)) as APIGuildChannel<any>;
    const parentId = config.category_id ?? trigger.parent_id ?? undefined;
    const parent = parentId ? ((await api.channels.get(parentId).catch(() => null)) as APIGuildChannel<any> | null) : null;
    const m = vs.member;
    const display = m?.nick ?? m?.user?.global_name ?? m?.user?.username ?? "Member";
    const overwrites = withMember(roleOverwrites(parent?.permission_overwrites ?? [], guildId, false), vs.user_id, VIEW | CONNECT, 0n);

    const channel = await api.guilds.createChannel(guildId, {
        name: trim(`🎧 ${display}`, 100),
        type: ChannelType.GuildVoice,
        parent_id: parentId,
        permission_overwrites: overwrites,
        user_limit: 0,
    } as any, { reason: `Voice sementara untuk ${display}` });

    await db.addTempVoice({ channel_id: channel.id, guild_id: guildId, owner_id: vs.user_id, created_at: Math.floor(Date.now() / 1000) });
    const moved = await api.guilds.editMember(guildId, vs.user_id, { channel_id: channel.id }).then(() => true).catch(() => false);
    if (!moved) {
        await deleteTempVoice(api, channel.id);
        return;
    }
    const created = (await api.channels.get(channel.id).catch(() => null)) as APIGuildChannel<any> | null;
    await api.channels.createMessage(channel.id, {
        components: panelComponents(created ?? { permission_overwrites: overwrites } as any, vs.user_id, guildId),
        allowed_mentions: { parse: [] },
    } as any).catch((err) => console.log(`[voice] gagal kirim panel: ${err}`));
}

async function deleteTempVoice(api: API, channelId: string) {
    await db.removeTempVoice(channelId);
    await api.channels.delete(channelId, { reason: "Voice sementara kosong" }).catch(() => null);
}

// ---------- Interaction ----------

/** Mengembalikan true kalau interaction ini milik fitur voice (sudah ditangani). */
export async function handleVoiceInteraction(api: API, interaction: APIInteraction): Promise<boolean> {
    const isCommand = interaction.type === InteractionType.ApplicationCommand && interaction.data.name === "voice-setup";
    const isButton = interaction.type === InteractionType.MessageComponent && interaction.data.custom_id.startsWith("vc:");
    const isModal = interaction.type === InteractionType.ModalSubmit && interaction.data.custom_id.startsWith("vc_modal:");
    if (!isCommand && !isButton && !isModal) return false;

    const guildId = interaction.guild_id;
    const member = interaction.member;
    const userId = member?.user.id;
    if (!guildId || !member || !userId) return true;
    const say = (content: string) =>
        api.interactions.reply(interaction.id, interaction.token, { content, flags: MessageFlags.Ephemeral, allowed_mentions: { parse: [] } });
    const isStaff = hasPermission(BigInt(member.permissions), PermissionFlagsBits.ManageChannels);

    try {
        // /voice-setup
        if (isCommand) {
            if (!hasPermission(BigInt(member.permissions), PermissionFlagsBits.ManageGuild)) return void (await say("❌ Hanya admin.")), true;
            const opts = (interaction.data as any).options as any[] | undefined;
            const get = (n: string) => opts?.find((o) => o.name === n)?.value;
            if (get("nonaktif") === true) {
                await db.setTempVoiceConfig(null, guildId);
                await say("🔕 Fitur Join to Create dimatikan. Voice yang sedang dipakai tetap berjalan sampai kosong.");
                return true;
            }
            const channelId = get("channel") as string | undefined;
            if (!channelId) {
                const c = await db.getTempVoiceConfig(guildId);
                await say(c ? `🎧 Join to Create aktif di <#${c.create_channel_id}>${c.category_id ? `, voice baru dibuat di kategori <#${c.category_id}>` : ""}.` : "Join to Create belum diatur. Pakai `/voice-setup channel:<voice channel>`.");
                return true;
            }
            const categoryId = (get("kategori") as string | undefined) ?? null;
            await db.setTempVoiceConfig({ guild_id: guildId, create_channel_id: channelId, category_id: categoryId }, guildId);
            await say(`✅ Join to Create aktif. Member yang masuk ke <#${channelId}> otomatis dibuatkan voice sendiri${categoryId ? ` di kategori <#${categoryId}>` : " di kategori yang sama"}.\n-# Pastikan bot punya izin **Manage Channels**, **Manage Roles**, dan **Move Members**.`);
            return true;
        }

        const parts = (interaction.data as any).custom_id.split(":");
        const action = parts[1] as string;
        const channelId = isModal ? parts[2] : interaction.channel?.id;
        if (!channelId) return true;
        const temp = await db.getTempVoice(channelId);
        if (!temp) return void (await say("❌ Voice ini bukan voice sementara atau sudah dihapus.")), true;
        const isOwner = temp.owner_id === userId;

        // Klaim boleh oleh siapa saja yang ada di voice, kalau pemilik sudah keluar.
        if (action === "claim") {
            if (isOwner) return void (await say("Kamu sudah pemilik voice ini.")), true;
            const here = membersIn(guildId, channelId);
            if (here.includes(temp.owner_id)) return void (await say(`Pemilik (<@${temp.owner_id}>) masih ada di voice.`)), true;
            if (!here.includes(userId) && !isStaff) return void (await say("❌ Masuk ke voice ini dulu untuk mengklaimnya.")), true;
            const ch = (await api.channels.get(channelId)) as APIGuildChannel<any>;
            await setOverwrites(api, channelId, withMember(ch.permission_overwrites ?? [], userId, VIEW | CONNECT, 0n), "Klaim voice");
            await db.setTempVoiceOwner(channelId, userId);
            await api.interactions.updateMessage(interaction.id, interaction.token, { components: panelComponents({ ...ch, permission_overwrites: withMember(ch.permission_overwrites ?? [], userId, VIEW | CONNECT, 0n) }, userId, guildId), allowed_mentions: { parse: [] } } as any);
            return true;
        }

        if (!isOwner && !isStaff) return void (await say(`❌ Hanya pemilik voice (<@${temp.owner_id}>) yang bisa mengatur.`)), true;

        // Tombol yang membuka form
        if (isButton) {
            const modal = (m: any) => api.interactions.createModal(interaction.id, interaction.token, m);
            if (action === "limit") return void (await modal(textModal(`vc_modal:limit:${channelId}`, "Batas Orang", "Maksimal orang (0 = tanpa batas)", "contoh: 5", 2))), true;
            if (action === "rename") return void (await modal(textModal(`vc_modal:rename:${channelId}`, "Ganti Nama Voice", "Nama baru", "contoh: Mabar Blox Fruits", 90))), true;
            if (action === "permit") return void (await modal(userPickerModal(`vc_modal:permit:${channelId}`, "Izinkan Masuk", "Pilih orang yang boleh masuk"))), true;
            if (action === "kick") return void (await modal(userPickerModal(`vc_modal:kick:${channelId}`, "Kick dari Voice", "Pilih orang yang dikeluarkan"))), true;
            if (action === "lock" || action === "unlock") {
                const ch = (await api.channels.get(channelId)) as APIGuildChannel<any>;
                const locked = action === "lock";
                if (isLocked(ch, guildId) === locked) {
                    await api.interactions.updateMessage(interaction.id, interaction.token, { components: panelComponents(ch, temp.owner_id, guildId), allowed_mentions: { parse: [] } } as any);
                    return true;
                }
                const members = (ch.permission_overwrites ?? []).filter((o) => o.type === OverwriteType.Member);
                const roles = roleOverwrites(await parentOverwrites(api, ch), guildId, locked);
                const next = [...roles, ...members];
                await setOverwrites(api, channelId, next, locked ? "Voice private" : "Voice public");
                await api.interactions.updateMessage(interaction.id, interaction.token, { components: panelComponents({ ...ch, permission_overwrites: next }, temp.owner_id, guildId), allowed_mentions: { parse: [] } } as any);
                return true;
            }
            return true;
        }

        // Form disubmit
        const comps = (interaction.data as any).components as any[];
        const panelId = (interaction as any).message?.id as string | undefined;
        if (action === "limit") {
            const n = Number((modalField(comps, "value")[0] ?? "").trim());
            if (!Number.isInteger(n) || n < 0 || n > 99) return void (await say("❌ Isi angka 0 sampai 99 (0 = tanpa batas).")), true;
            await api.channels.edit(channelId, { user_limit: n } as any, { reason: "Batas voice" });
            await say(n ? `Batas voice: **${n} orang**.` : "Batas voice dihapus (tanpa batas).");
            await refreshPanel(api, channelId, panelId, temp.owner_id, guildId);
            return true;
        }
        if (action === "rename") {
            const name = trim((modalField(comps, "value")[0] ?? "").trim(), 90);
            if (!name) return void (await say("❌ Nama tidak boleh kosong.")), true;
            await say(`Nama voice diganti menjadi **${name}**.\n-# Discord membatasi ganti nama 2× per 10 menit; kalau terlalu sering, nama baru menyusul.`);
            await refreshPanel(api, channelId, panelId, temp.owner_id, guildId, { name });
            api.channels.edit(channelId, { name: `🎧 ${name}` } as any, { reason: "Ganti nama voice" }).catch((err) => console.log(`[voice] gagal ganti nama: ${err}`));
            return true;
        }
        if (action === "permit" || action === "kick") {
            const ids = modalField(comps, "users").filter((id) => id !== temp.owner_id);
            if (!ids.length) return void (await say("❌ Pilih orang lain selain pemilik voice.")), true;
            const ch = (await api.channels.get(channelId)) as APIGuildChannel<any>;
            let list = ch.permission_overwrites ?? [];
            for (const id of ids) list = action === "permit" ? withMember(list, id, VIEW | CONNECT, 0n) : withMember(list, id, 0n, CONNECT);
            await setOverwrites(api, channelId, list, action === "permit" ? "Izinkan masuk voice" : "Kick dari voice");
            if (action === "kick") {
                const here = new Set(membersIn(guildId, channelId));
                for (const id of ids) if (here.has(id)) await api.guilds.editMember(guildId, id, { channel_id: null }, { reason: "Kick dari voice" }).catch(() => null);
            }
            const names = ids.map((id) => `<@${id}>`).join(", ");
            await say(action === "permit" ? `${names} sekarang bisa masuk voice ini.` : `${names} dikeluarkan dan tidak bisa masuk lagi ke voice ini.`);
            return true;
        }
        return true;
    } catch (err) {
        console.log(`[voice] error: ${err}`);
        await say(`❌ Gagal: pastikan bot punya izin **Manage Channels**, **Manage Roles**, dan **Move Members**.\n-# ${String(err).slice(0, 150)}`).catch(() => null);
        return true;
    }
}

/** Untuk tes. */
export const __test = { roleOverwrites, withMember, isLocked, membersIn, statesOf };
