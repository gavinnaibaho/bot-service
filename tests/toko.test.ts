import { test, expect } from "bun:test";
process.env.DATABASE_URL = "sqlite://:memory:";

test("alur toko: harga, order, status, buka-tutup, loyalitas, statistik", async () => {
const s = await import("../src/db");
const p = await import("../src/pricing");
await s.initDb();
await s.initDb(); // idempotent
const assert = (c: any, m: string) => { expect(Boolean(c), m).toBe(true); };

// pricing
assert(p.gamepassPriceFor(1000) === 1429, "gamepass 1000 -> 1429");
assert(p.gamepassPriceFor(700) === 1000, "gamepass 700 -> 1000");
for (let x = 1; x < 20000; x++) { const g = p.gamepassPriceFor(x); if (Math.floor(g*7/10) < x || Math.floor((g-1)*7/10) >= x) { assert(false, "gamepass min for "+x); } }
assert(true, "gamepass harga minimal benar untuk 1..20000");
assert(p.priceFor(1000, 12500) === 125000, "harga 1000 R$ @12.500/100");
assert(p.parseAmount("1.000") === 1000 && p.parseAmount("1k") === 1000 && p.parseAmount("2,5k") === 2500 && p.parseAmount("500 robux") === 500 && Number.isNaN(p.parseAmount("abc")), "parseAmount");
const sod = p.startOfTodayWIB(Date.UTC(2026,10,8,20,0)); // 9 Nov 03:00 WIB
assert(sod === Date.UTC(2026,10,8,17,0)/1000, "awal hari WIB");

const G = "111111111111111111";
const U = "222222222222222222";
const cfg = s.defaultConfig(G);
cfg.price_gamepass = 13000; cfg.price_group = 11000; cfg.admin_role_id = "333333333333333333";
await s.saveShopConfig(cfg);
const got = await s.getShopConfig(G);
assert(got!.admin_role_id === "333333333333333333" && got!.price_group === 11000, "simpan/ambil config, ID tidak terpotong");

let v = p.validateOrder(got!, 50000, "gamepass");
assert(v.ok, "order besar tidak dibatasi stok");
v = p.validateOrder(got!, 1000, "gamepass");
assert(v.ok && v.stockCost === 1429 && v.price === 130000, "validasi 1000 gamepass");
assert(!p.validateOrder(got!, 50, "group").ok, "di bawah minimal");

const o = await s.createOrder({ guild_id: G, user_id: U, robux: 1000, price: 130000, stock_cost: 1429, method: "gamepass", roblox_username: "builderman", gamepass_link: null });
assert(o.id === 1 && o.status === "menunggu_pembayaran", "buat order");
assert((await s.getOpenOrderForUser(G, U))?.id === 1, "order aktif terdeteksi");
await s.setOrderChannel(o.id, "444444444444444444");
assert((await s.getOrderByChannel("444444444444444444"))?.id === 1, "cari order dari channel");
assert(await s.transitionOrder(G, 1, ["diproses"], "selesai") === null, "transisi ilegal ditolak");
assert(await s.completeOrder(G, 1, "a") === null, "tidak bisa selesai sebelum diproses");
assert((await s.transitionOrder(G, 1, ["menunggu_pembayaran"], "menunggu_verifikasi"))?.status === "menunggu_verifikasi", "-> menunggu_verifikasi");
assert((await s.transitionOrder(G, 1, ["menunggu_pembayaran","menunggu_verifikasi"], "diproses", "555"))?.handled_by === "555", "-> diproses");
assert(await s.transitionOrder(G, 1, ["menunggu_pembayaran","menunggu_verifikasi"], "diproses", "555") === null, "klik ganda ditolak");
const done = await s.completeOrder(G, 1, "555");
assert(done?.status === "selesai" && done?.handled_by === "555", "selesai");
assert(await s.completeOrder(G, 1, "555") === null, "selesai dua kali ditolak");
assert((await s.getOpenOrderForUser(G, U)) === null, "tidak ada order aktif lagi");
assert(await s.markTestimonialPosted(1) === true && await s.markTestimonialPosted(1) === false, "testimoni sekali saja");
assert(await s.getUserTotalRobux(G, U) === 1000, "total robux user");

await s.createOrder({ guild_id: G, user_id: U, robux: 300, price: 33000, stock_cost: 300, method: "group", roblox_username: "builderman", gamepass_link: null });
assert((await s.transitionOrder(G, 2, ["menunggu_pembayaran"], "dibatalkan"))?.status === "dibatalkan", "batal");

await s.setLoyaltyRole(G, "666", 500); await s.setLoyaltyRole(G, "777", 5000); await s.setLoyaltyRole(G, "666", 800);
const roles = await s.getLoyaltyRoles(G);
assert(roles.length === 2 && roles[0]!.min_robux === 800, "loyalitas upsert & urut");
assert(await s.deleteLoyaltyRole(G, "777") && !(await s.deleteLoyaltyRole(G, "777")), "hapus loyalitas");

const st = await s.getShopStats(G, p.startOfTodayWIB());
assert(st.totalOrders === 2 && st.completed === 1 && st.revenueAll === 130000 && st.revenueToday === 130000 && st.robuxAll === 1000, "statistik");
assert(st.topBuyers[0]!.user_id === U && st.recent.length === 2, "top buyer & recent");

const before = await s.getShopConfig(G);
assert(before!.is_open === true && before!.rename_channel === true, "default toko buka");
await s.setShopOpen(G, false, "Istirahat, buka jam 19.00");
const closed = await s.getShopConfig(G);
assert(!closed!.is_open && closed!.close_reason === "Istirahat, buka jam 19.00", "toko ditutup dengan alasan");
await s.setShopOpen(G, true, "abaikan");
const reopened = await s.getShopConfig(G);
assert(reopened!.is_open && reopened!.close_reason === null, "toko dibuka, alasan dihapus");
await s.saveShopConfig({ ...reopened!, announce_channel_id: "888888888888888888", rename_channel: false });
const saved = await s.getShopConfig(G);
assert(saved!.announce_channel_id === "888888888888888888" && saved!.rename_channel === false, "simpan pengaturan pengumuman");

assert(saved!.store_name === "Toko Robux", "nama toko default");
await s.saveShopConfig({ ...saved!, store_name: "Aminari Store", ping_role_id: "999", history_channel_id: "777", leaderboard_channel_id: "666" });
const named = await s.getShopConfig(G);
assert(named!.store_name === "Aminari Store" && named!.ping_role_id === "999" && named!.history_channel_id === "777", "simpan nama toko, role ping, riwayat");
await s.setLeaderboardMessage(G, "12345");
assert((await s.getShopConfig(G))!.leaderboard_message_id === "12345", "simpan id pesan leaderboard");

// pembeli kedua dengan belanja lebih besar
const U2 = "333333333333333334";
const big = await s.createOrder({ guild_id: G, user_id: U2, robux: 2000, price: 260000, stock_cost: 2858, method: "gamepass", roblox_username: "pembeli2", gamepass_link: null });
await s.transitionOrder(G, big.id, ["menunggu_pembayaran"], "diproses", "555");
await s.completeOrder(G, big.id, "555");
const lb = await s.getLeaderboard(G, 10);
assert(lb.length === 2 && lb[0]!.user_id === U2 && lb[0]!.spent === 260000 && lb[1]!.spent === 130000, "leaderboard urut berdasarkan total belanja");
const totals = await s.getGlobalTotals(G);
assert(totals.customers === 2 && totals.spending === 390000 && totals.orders === 2, "total customer & spending (pesanan batal tidak dihitung)");
assert(await s.getUserTotalSpent(G, U) === 130000, "total belanja per user");
});
