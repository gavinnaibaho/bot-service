import { SQL } from "bun";

export const db = new SQL(process.env.DATABASE_URL || "sqlite://toko.sqlite");

// ID Discord disimpan sebagai TEXT supaya tidak kehilangan presisi (snowflake > Number.MAX_SAFE_INTEGER).

export type DeliveryMethod = "gift" | "group" | "username" | "login" | "boost";
const DELIVERY_METHODS: DeliveryMethod[] = ["gift", "group", "username", "login", "boost"];

export type OrderStatus =
    | "menunggu_pembayaran"
    | "menunggu_verifikasi"
    | "diproses"
    | "selesai"
    | "dibatalkan";

export const FINAL_STATUSES: OrderStatus[] = ["selesai", "dibatalkan"];

export type ShopConfig = {
    guild_id: string;
    admin_role_id: string | null;
    ticket_category_id: string | null;
    log_channel_id: string | null;
    testimonial_channel_id: string | null;
    // Harga Rupiah per 100 Robux tiap metode (0 = metode nonaktif)
    price_gift: number;
    price_group: number;
    price_username: number;
    price_login: number;
    boost_enabled: boolean; // terima order joki/boosting (harga manual)
    min_order: number;
    max_order: number;
    payment_info: string | null;
    panel_channel_id: string | null;
    panel_message_id: string | null;
    is_open: boolean;
    close_reason: string | null;
    announce_channel_id: string | null; // channel pengumuman buka/tutup
    rename_channel: boolean;            // ganti nama channel panel jadi 🟢/🔴
    store_name: string;                 // nama toko di pengumuman, vouch, dll.
    ping_role_id: string | null;        // role yang di-ping saat toko buka
    history_channel_id: string | null;  // channel publik riwayat transaksi
    leaderboard_channel_id: string | null;
    leaderboard_message_id: string | null;
};

export type Order = {
    id: number;
    guild_id: string;
    user_id: string;
    robux: number;
    price: number;
    stock_cost: number;
    method: DeliveryMethod;
    roblox_username: string;
    note: string | null; // catatan pembeli (mis. nama game & item untuk Gift In Game); kolom DB: gamepass_link
    status: OrderStatus;
    channel_id: string | null;
    handled_by: string | null;
    testimonial_posted: boolean;
    created_at: number;
    updated_at: number;
};

/** min_spent = total belanja minimal dalam Rupiah (kolom DB: min_robux). */
export type LoyaltyRole = { guild_id: string; role_id: string; min_spent: number };

const now = () => Math.floor(Date.now() / 1000);

export const DEFAULT_STORE_NAME = "Toko Robux";

async function migrationV1(tx: SQL, autoincrementSyntax: any) {
    await tx`
CREATE TABLE IF NOT EXISTS shop_config (
  guild_id VARCHAR(20) PRIMARY KEY,
  admin_role_id VARCHAR(20),
  ticket_category_id VARCHAR(20),
  log_channel_id VARCHAR(20),
  testimonial_channel_id VARCHAR(20),
  price_gamepass INTEGER NOT NULL DEFAULT 0,
  price_group INTEGER NOT NULL DEFAULT 0,
  min_order INTEGER NOT NULL DEFAULT 100,
  max_order INTEGER NOT NULL DEFAULT 100000,
  stock INTEGER NOT NULL DEFAULT 0,
  payment_info TEXT,
  panel_channel_id VARCHAR(20),
  panel_message_id VARCHAR(20)
)`;
    await tx`
CREATE TABLE IF NOT EXISTS shop_orders (
  id INTEGER PRIMARY KEY ${autoincrementSyntax},
  guild_id VARCHAR(20) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  robux INTEGER NOT NULL,
  price INTEGER NOT NULL,
  stock_cost INTEGER NOT NULL, -- Robux yang dikeluarkan penjual (arsip)
  method VARCHAR(16) NOT NULL,
  roblox_username VARCHAR(64) NOT NULL,
  gamepass_link TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'menunggu_pembayaran',
  channel_id VARCHAR(20),
  handled_by VARCHAR(20),
  testimonial_posted INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
)`;
    await tx`
CREATE TABLE IF NOT EXISTS shop_loyalty_roles (
  guild_id VARCHAR(20) NOT NULL,
  role_id VARCHAR(20) NOT NULL,
  min_robux INTEGER NOT NULL,
  PRIMARY KEY (guild_id, role_id)
)`;
    await tx`CREATE INDEX IF NOT EXISTS idx_shop_orders_guild ON shop_orders(guild_id, created_at)`;
    await tx`CREATE INDEX IF NOT EXISTS idx_shop_orders_user ON shop_orders(guild_id, user_id)`;
    await tx`CREATE INDEX IF NOT EXISTS idx_shop_orders_channel ON shop_orders(channel_id)`;
}

const migrations: { version: number; name: string; up: (tx: SQL) => Promise<void> }[] = [
    {
        version: 1,
        name: "tabel toko",
        up: (tx) => migrationV1(tx,
            db.options.adapter === "sqlite" ? db`AUTOINCREMENT`
                : db.options.adapter === "postgres" ? db`GENERATED ALWAYS AS IDENTITY`
                    : db`AUTO_INCREMENT`),
    },
    {
        version: 2,
        name: "status buka/tutup toko",
        up: async (tx) => {
            await tx`ALTER TABLE shop_config ADD COLUMN is_open INTEGER NOT NULL DEFAULT 1`;
            await tx`ALTER TABLE shop_config ADD COLUMN close_reason TEXT`;
            await tx`ALTER TABLE shop_config ADD COLUMN announce_channel_id VARCHAR(20)`;
            await tx`ALTER TABLE shop_config ADD COLUMN rename_channel INTEGER NOT NULL DEFAULT 1`;
        },
    },
    {
        version: 3,
        name: "nama toko, ping, riwayat, leaderboard",
        up: async (tx) => {
            await tx`ALTER TABLE shop_config ADD COLUMN store_name VARCHAR(64)`;
            await tx`ALTER TABLE shop_config ADD COLUMN ping_role_id VARCHAR(20)`;
            await tx`ALTER TABLE shop_config ADD COLUMN history_channel_id VARCHAR(20)`;
            await tx`ALTER TABLE shop_config ADD COLUMN leaderboard_channel_id VARCHAR(20)`;
            await tx`ALTER TABLE shop_config ADD COLUMN leaderboard_message_id VARCHAR(20)`;
        },
    },
    {
        version: 4,
        name: "metode gift, username, login",
        up: async (tx) => {
            await tx`ALTER TABLE shop_config ADD COLUMN price_gift INTEGER NOT NULL DEFAULT 0`;
            await tx`ALTER TABLE shop_config ADD COLUMN price_username INTEGER NOT NULL DEFAULT 0`;
            await tx`ALTER TABLE shop_config ADD COLUMN price_login INTEGER NOT NULL DEFAULT 0`;
        },
    },
    {
        version: 5,
        name: "daftar harga per metode",
        up: async (tx) => {
            await tx`
CREATE TABLE IF NOT EXISTS shop_pricelists (
  guild_id VARCHAR(20) NOT NULL,
  method VARCHAR(16) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,
  message_id VARCHAR(20),
  PRIMARY KEY (guild_id, method)
)`;
            // GIG aktif secara default (price_gift dipakai sebagai penanda aktif)
            await tx`UPDATE shop_config SET price_gift = 1`;
        },
    },
    {
        version: 6,
        name: "joki / boosting",
        up: async (tx) => {
            await tx`ALTER TABLE shop_config ADD COLUMN boost_enabled INTEGER NOT NULL DEFAULT 1`;
        },
    },
    {
        version: 7,
        name: "loyalitas berdasarkan total belanja",
        up: async (tx) => {
            // Ambang lama dalam Robux tidak bisa dipakai sebagai Rupiah: atur ulang dengan /loyalitas atur.
            await tx`DELETE FROM shop_loyalty_roles`;
        },
    },
];

export async function initDb() {
    if (db.options.adapter === "sqlite") {
        await db`PRAGMA journal_mode = WAL;`.catch(() => null);
        await db`PRAGMA busy_timeout = 5000;`.catch(() => null);
    }
    await db`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, executed_at BIGINT)`;
    const applied: { version: number }[] = await db`SELECT version FROM _migrations`;
    const done = new Set(applied.map((r) => Number(r.version)));
    for (const m of migrations) {
        if (done.has(m.version)) continue;
        await db.begin(async (tx) => {
            await m.up(tx);
            await tx`INSERT INTO _migrations (version, name, executed_at) VALUES (${m.version}, ${m.name}, ${now()})`;
        });
        console.log(`[db] migration ${m.version} (${m.name}) diterapkan`);
    }
}

// ---------- Config ----------

function parseConfig(row: any): ShopConfig {
    return {
        guild_id: String(row.guild_id),
        admin_role_id: row.admin_role_id ?? null,
        ticket_category_id: row.ticket_category_id ?? null,
        log_channel_id: row.log_channel_id ?? null,
        testimonial_channel_id: row.testimonial_channel_id ?? null,
        price_gift: Number(row.price_gift ?? 0),
        price_group: Number(row.price_group ?? 0),
        price_username: Number(row.price_username ?? 0),
        price_login: Number(row.price_login ?? 0),
        boost_enabled: row.boost_enabled === undefined || row.boost_enabled === null ? true : Boolean(Number(row.boost_enabled)),
        min_order: Number(row.min_order ?? 100),
        max_order: Number(row.max_order ?? 100000),
        payment_info: row.payment_info ?? null,
        panel_channel_id: row.panel_channel_id ?? null,
        panel_message_id: row.panel_message_id ?? null,
        is_open: row.is_open === undefined || row.is_open === null ? true : Boolean(Number(row.is_open)),
        close_reason: row.close_reason ?? null,
        announce_channel_id: row.announce_channel_id ?? null,
        rename_channel: row.rename_channel === undefined || row.rename_channel === null ? true : Boolean(Number(row.rename_channel)),
        store_name: row.store_name || DEFAULT_STORE_NAME,
        ping_role_id: row.ping_role_id ?? null,
        history_channel_id: row.history_channel_id ?? null,
        leaderboard_channel_id: row.leaderboard_channel_id ?? null,
        leaderboard_message_id: row.leaderboard_message_id ?? null,
    };
}

export function defaultConfig(guild_id: string): ShopConfig {
    return {
        guild_id,
        admin_role_id: null,
        ticket_category_id: null,
        log_channel_id: null,
        testimonial_channel_id: null,
        price_gift: 1, // GIG aktif secara default
        price_group: 0,
        price_username: 0,
        price_login: 0,
        boost_enabled: true,
        min_order: 100,
        max_order: 100000,
        payment_info: null,
        panel_channel_id: null,
        panel_message_id: null,
        is_open: true,
        close_reason: null,
        announce_channel_id: null,
        rename_channel: true,
        store_name: DEFAULT_STORE_NAME,
        ping_role_id: null,
        history_channel_id: null,
        leaderboard_channel_id: null,
        leaderboard_message_id: null,
    };
}

export async function getShopConfig(guild_id: string): Promise<ShopConfig | null> {
    const [row] = await db`SELECT * FROM shop_config WHERE guild_id = ${guild_id}`;
    return row ? parseConfig(row) : null;
}

export async function saveShopConfig(c: ShopConfig) {
    await db`
    INSERT INTO shop_config (guild_id, admin_role_id, ticket_category_id, log_channel_id, testimonial_channel_id,
      price_gift, price_group, price_username, price_login, boost_enabled, min_order, max_order, payment_info, panel_channel_id, panel_message_id,
      is_open, close_reason, announce_channel_id, rename_channel,
      store_name, ping_role_id, history_channel_id, leaderboard_channel_id, leaderboard_message_id)
    VALUES (${c.guild_id}, ${c.admin_role_id}, ${c.ticket_category_id}, ${c.log_channel_id}, ${c.testimonial_channel_id},
      ${c.price_gift}, ${c.price_group}, ${c.price_username}, ${c.price_login}, ${c.boost_enabled ? 1 : 0}, ${c.min_order}, ${c.max_order}, ${c.payment_info},
      ${c.panel_channel_id}, ${c.panel_message_id},
      ${c.is_open ? 1 : 0}, ${c.close_reason}, ${c.announce_channel_id}, ${c.rename_channel ? 1 : 0},
      ${c.store_name}, ${c.ping_role_id}, ${c.history_channel_id}, ${c.leaderboard_channel_id}, ${c.leaderboard_message_id})
    ON CONFLICT(guild_id) DO UPDATE SET
      admin_role_id=excluded.admin_role_id,
      ticket_category_id=excluded.ticket_category_id,
      log_channel_id=excluded.log_channel_id,
      testimonial_channel_id=excluded.testimonial_channel_id,
      price_gift=excluded.price_gift,
      price_username=excluded.price_username,
      price_login=excluded.price_login,
      boost_enabled=excluded.boost_enabled,
      price_group=excluded.price_group,
      min_order=excluded.min_order,
      max_order=excluded.max_order,
      payment_info=excluded.payment_info,
      panel_channel_id=excluded.panel_channel_id,
      panel_message_id=excluded.panel_message_id,
      is_open=excluded.is_open,
      close_reason=excluded.close_reason,
      announce_channel_id=excluded.announce_channel_id,
      rename_channel=excluded.rename_channel,
      store_name=excluded.store_name,
      ping_role_id=excluded.ping_role_id,
      history_channel_id=excluded.history_channel_id,
      leaderboard_channel_id=excluded.leaderboard_channel_id,
      leaderboard_message_id=excluded.leaderboard_message_id
  `;
}

/** Set status buka/tutup toko. */
export async function setShopOpen(guild_id: string, open: boolean, reason: string | null) {
    await db`UPDATE shop_config SET is_open = ${open ? 1 : 0}, close_reason = ${open ? null : reason} WHERE guild_id = ${guild_id}`;
}

// ---------- Orders ----------

function parseOrder(row: any): Order {
    return {
        id: Number(row.id),
        guild_id: String(row.guild_id),
        user_id: String(row.user_id),
        robux: Number(row.robux),
        price: Number(row.price),
        stock_cost: Number(row.stock_cost),
        method: DELIVERY_METHODS.includes(row.method) ? row.method : "group",
        roblox_username: row.roblox_username,
        note: row.gamepass_link ?? null,
        status: row.status,
        channel_id: row.channel_id ?? null,
        handled_by: row.handled_by ?? null,
        testimonial_posted: Boolean(Number(row.testimonial_posted)),
        created_at: Number(row.created_at),
        updated_at: Number(row.updated_at),
    };
}

export async function createOrder(o: Pick<Order, "guild_id" | "user_id" | "robux" | "price" | "stock_cost" | "method" | "roblox_username" | "note">): Promise<Order> {
    const t = now();
    const [row] = await db`
    INSERT INTO shop_orders (guild_id, user_id, robux, price, stock_cost, method, roblox_username, gamepass_link, status, created_at, updated_at)
    VALUES (${o.guild_id}, ${o.user_id}, ${o.robux}, ${o.price}, ${o.stock_cost}, ${o.method}, ${o.roblox_username}, ${o.note}, 'menunggu_pembayaran', ${t}, ${t})
    RETURNING *`;
    return parseOrder(row);
}

export async function getOrder(guild_id: string, id: number): Promise<Order | null> {
    const [row] = await db`SELECT * FROM shop_orders WHERE guild_id = ${guild_id} AND id = ${id}`;
    return row ? parseOrder(row) : null;
}

export async function getOrderByChannel(channel_id: string): Promise<Order | null> {
    const [row] = await db`SELECT * FROM shop_orders WHERE channel_id = ${channel_id} ORDER BY id DESC LIMIT 1`;
    return row ? parseOrder(row) : null;
}

export async function getOpenOrderForUser(guild_id: string, user_id: string): Promise<Order | null> {
    const [row] = await db`
    SELECT * FROM shop_orders
    WHERE guild_id = ${guild_id} AND user_id = ${user_id} AND status NOT IN ('selesai', 'dibatalkan')
    ORDER BY id DESC LIMIT 1`;
    return row ? parseOrder(row) : null;
}

export async function setOrderChannel(id: number, channel_id: string | null) {
    await db`UPDATE shop_orders SET channel_id = ${channel_id}, updated_at = ${now()} WHERE id = ${id}`;
}

/**
 * Pindah status hanya jika status sekarang termasuk `from` (mencegah klik ganda / balapan antar admin).
 * Mengembalikan order terbaru jika berhasil, atau null jika status sudah berubah.
 */
export async function transitionOrder(guild_id: string, id: number, from: OrderStatus[], to: OrderStatus, handled_by?: string): Promise<Order | null> {
    return db.begin(async (tx) => {
        const [row] = await tx`SELECT status FROM shop_orders WHERE guild_id = ${guild_id} AND id = ${id}`;
        if (!row || !from.includes(row.status)) return null;
        if (handled_by) {
            await tx`UPDATE shop_orders SET status = ${to}, handled_by = ${handled_by}, updated_at = ${now()} WHERE id = ${id}`;
        } else {
            await tx`UPDATE shop_orders SET status = ${to}, updated_at = ${now()} WHERE id = ${id}`;
        }
        const [updated] = await tx`SELECT * FROM shop_orders WHERE id = ${id}`;
        return parseOrder(updated);
    });
}

export async function setOrderNote(id: number, note: string | null) {
    await db`UPDATE shop_orders SET gamepass_link = ${note}, updated_at = ${now()} WHERE id = ${id}`;
}

/**
 * Konfirmasi pembayaran: menunggu_pembayaran -> diproses.
 * `price` diisi untuk GIG (harga dihitung manual oleh admin saat konfirmasi).
 */
export async function confirmOrder(guild_id: string, id: number, handled_by: string, price?: number): Promise<Order | null> {
    return db.begin(async (tx) => {
        const [row] = await tx`SELECT status FROM shop_orders WHERE guild_id = ${guild_id} AND id = ${id}`;
        if (!row || !["menunggu_pembayaran", "menunggu_verifikasi"].includes(row.status)) return null;
        if (price !== undefined) {
            await tx`UPDATE shop_orders SET status = 'diproses', handled_by = ${handled_by}, price = ${price}, updated_at = ${now()} WHERE id = ${id}`;
        } else {
            await tx`UPDATE shop_orders SET status = 'diproses', handled_by = ${handled_by}, updated_at = ${now()} WHERE id = ${id}`;
        }
        const [updated] = await tx`SELECT * FROM shop_orders WHERE id = ${id}`;
        return parseOrder(updated);
    });
}

/** Tandai selesai (hanya dari status diproses). */
export async function completeOrder(guild_id: string, id: number, handled_by: string): Promise<Order | null> {
    return transitionOrder(guild_id, id, ["diproses"], "selesai", handled_by);
}

/** Tandai testimoni sudah dikirim; false jika sudah pernah. */
export async function markTestimonialPosted(id: number): Promise<boolean> {
    return db.begin(async (tx) => {
        const [row] = await tx`SELECT testimonial_posted FROM shop_orders WHERE id = ${id}`;
        if (!row || Number(row.testimonial_posted) === 1) return false;
        await tx`UPDATE shop_orders SET testimonial_posted = 1 WHERE id = ${id}`;
        return true;
    });
}

export async function getUserOrders(guild_id: string, user_id: string, limit = 10): Promise<Order[]> {
    const rows = await db`SELECT * FROM shop_orders WHERE guild_id = ${guild_id} AND user_id = ${user_id} ORDER BY id DESC LIMIT ${limit}`;
    return rows.map(parseOrder);
}

export async function getUserTotalRobux(guild_id: string, user_id: string): Promise<number> {
    const [row] = await db`SELECT COALESCE(SUM(robux), 0) AS total FROM shop_orders WHERE guild_id = ${guild_id} AND user_id = ${user_id} AND status = 'selesai'`;
    return Number(row?.total ?? 0);
}

// ---------- Statistik ----------

export type ShopStats = {
    totalOrders: number;
    completed: number;
    revenueAll: number;
    robuxAll: number;
    revenueToday: number;
    revenue7d: number;
    revenue30d: number;
    ordersToday: number;
    pending: Record<"menunggu_pembayaran" | "menunggu_verifikasi" | "diproses", number>;
    topBuyers: { user_id: string; robux: number; spent: number }[];
    recent: Order[];
};

export async function getShopStats(guild_id: string, todayStart: number): Promise<ShopStats> {
    const d7 = now() - 7 * 86400;
    const d30 = now() - 30 * 86400;
    const [[agg], statusRows, topRows, recentRows] = await Promise.all([
        db`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(CASE WHEN status = 'selesai' THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN status = 'selesai' THEN price ELSE 0 END), 0) AS revenue_all,
        COALESCE(SUM(CASE WHEN status = 'selesai' THEN robux ELSE 0 END), 0) AS robux_all,
        COALESCE(SUM(CASE WHEN status = 'selesai' AND updated_at >= ${todayStart} THEN price ELSE 0 END), 0) AS revenue_today,
        COALESCE(SUM(CASE WHEN status = 'selesai' AND updated_at >= ${d7} THEN price ELSE 0 END), 0) AS revenue_7d,
        COALESCE(SUM(CASE WHEN status = 'selesai' AND updated_at >= ${d30} THEN price ELSE 0 END), 0) AS revenue_30d,
        COALESCE(SUM(CASE WHEN created_at >= ${todayStart} THEN 1 ELSE 0 END), 0) AS orders_today
      FROM shop_orders WHERE guild_id = ${guild_id}`,
        db`SELECT status, COUNT(*) AS n FROM shop_orders WHERE guild_id = ${guild_id} AND status IN ('menunggu_pembayaran', 'menunggu_verifikasi', 'diproses') GROUP BY status`,
        db`SELECT user_id, SUM(robux) AS robux, SUM(price) AS spent FROM shop_orders WHERE guild_id = ${guild_id} AND status = 'selesai' GROUP BY user_id ORDER BY SUM(robux) DESC LIMIT 5`,
        db`SELECT * FROM shop_orders WHERE guild_id = ${guild_id} ORDER BY id DESC LIMIT 5`,
    ]);
    const pending = { menunggu_pembayaran: 0, menunggu_verifikasi: 0, diproses: 0 };
    for (const r of statusRows) (pending as any)[r.status] = Number(r.n);
    return {
        totalOrders: Number(agg.total_orders),
        completed: Number(agg.completed),
        revenueAll: Number(agg.revenue_all),
        robuxAll: Number(agg.robux_all),
        revenueToday: Number(agg.revenue_today),
        revenue7d: Number(agg.revenue_7d),
        revenue30d: Number(agg.revenue_30d),
        ordersToday: Number(agg.orders_today),
        pending,
        topBuyers: topRows.map((r: any) => ({ user_id: String(r.user_id), robux: Number(r.robux), spent: Number(r.spent) })),
        recent: recentRows.map(parseOrder),
    };
}

// ---------- Leaderboard ----------

export type LeaderboardEntry = { user_id: string; spent: number; robux: number; orders: number };

/** Top pembeli berdasarkan total belanja (Rupiah) dari pesanan selesai. */
export async function getLeaderboard(guild_id: string, limit = 10): Promise<LeaderboardEntry[]> {
    const rows = await db`
    SELECT user_id, SUM(price) AS spent, SUM(robux) AS robux, COUNT(*) AS orders
    FROM shop_orders WHERE guild_id = ${guild_id} AND status = 'selesai'
    GROUP BY user_id ORDER BY SUM(price) DESC, MIN(updated_at) ASC LIMIT ${limit}`;
    return rows.map((r: any) => ({ user_id: String(r.user_id), spent: Number(r.spent), robux: Number(r.robux), orders: Number(r.orders) }));
}

/** Jumlah pelanggan unik & total belanja seluruh pesanan selesai. */
export async function getGlobalTotals(guild_id: string): Promise<{ customers: number; spending: number; orders: number }> {
    const [row] = await db`
    SELECT COUNT(DISTINCT user_id) AS customers, COALESCE(SUM(price), 0) AS spending, COUNT(*) AS orders
    FROM shop_orders WHERE guild_id = ${guild_id} AND status = 'selesai'`;
    return { customers: Number(row?.customers ?? 0), spending: Number(row?.spending ?? 0), orders: Number(row?.orders ?? 0) };
}

export async function getUserTotalSpent(guild_id: string, user_id: string): Promise<number> {
    const [row] = await db`SELECT COALESCE(SUM(price), 0) AS total FROM shop_orders WHERE guild_id = ${guild_id} AND user_id = ${user_id} AND status = 'selesai'`;
    return Number(row?.total ?? 0);
}

export async function setLeaderboardMessage(guild_id: string, message_id: string | null) {
    await db`UPDATE shop_config SET leaderboard_message_id = ${message_id} WHERE guild_id = ${guild_id}`;
}

// ---------- Daftar harga ----------

export type PriceList = { guild_id: string; method: DeliveryMethod; channel_id: string; message_id: string | null };

export async function getPriceLists(guild_id: string): Promise<PriceList[]> {
    const rows = await db`SELECT * FROM shop_pricelists WHERE guild_id = ${guild_id}`;
    return rows.map((r: any) => ({ guild_id: String(r.guild_id), method: r.method, channel_id: String(r.channel_id), message_id: r.message_id ?? null }));
}

export async function getPriceList(guild_id: string, method: DeliveryMethod): Promise<PriceList | null> {
    const [r] = await db`SELECT * FROM shop_pricelists WHERE guild_id = ${guild_id} AND method = ${method}`;
    return r ? { guild_id: String(r.guild_id), method: r.method, channel_id: String(r.channel_id), message_id: r.message_id ?? null } : null;
}

export async function savePriceList(p: PriceList) {
    await db`
    INSERT INTO shop_pricelists (guild_id, method, channel_id, message_id) VALUES (${p.guild_id}, ${p.method}, ${p.channel_id}, ${p.message_id})
    ON CONFLICT(guild_id, method) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`;
}

export async function deletePriceList(guild_id: string, method: DeliveryMethod) {
    await db`DELETE FROM shop_pricelists WHERE guild_id = ${guild_id} AND method = ${method}`;
}

/** Ubah tarif satu metode (Rupiah per 100 Robux). */
export async function setMethodPrice(guild_id: string, method: Exclude<DeliveryMethod, "gift" | "boost">, price: number) {
    if (method === "login") await db`UPDATE shop_config SET price_login = ${price} WHERE guild_id = ${guild_id}`;
    else if (method === "username") await db`UPDATE shop_config SET price_username = ${price} WHERE guild_id = ${guild_id}`;
    else await db`UPDATE shop_config SET price_group = ${price} WHERE guild_id = ${guild_id}`;
}

// ---------- Loyalitas ----------

export async function getLoyaltyRoles(guild_id: string): Promise<LoyaltyRole[]> {
    const rows = await db`SELECT * FROM shop_loyalty_roles WHERE guild_id = ${guild_id} ORDER BY min_robux ASC`;
    return rows.map((r: any) => ({ guild_id: String(r.guild_id), role_id: String(r.role_id), min_spent: Number(r.min_robux) }));
}

export async function setLoyaltyRole(guild_id: string, role_id: string, min_spent: number) {
    await db`
    INSERT INTO shop_loyalty_roles (guild_id, role_id, min_robux) VALUES (${guild_id}, ${role_id}, ${min_spent})
    ON CONFLICT(guild_id, role_id) DO UPDATE SET min_robux = excluded.min_robux`;
}

export async function deleteLoyaltyRole(guild_id: string, role_id: string): Promise<boolean> {
    const [row] = await db`SELECT 1 AS x FROM shop_loyalty_roles WHERE guild_id = ${guild_id} AND role_id = ${role_id}`;
    if (!row) return false;
    await db`DELETE FROM shop_loyalty_roles WHERE guild_id = ${guild_id} AND role_id = ${role_id}`;
    return true;
}
