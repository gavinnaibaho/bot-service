import { test, expect } from "bun:test";
process.env.DATABASE_URL = "sqlite://:memory:";

test("alur toko: harga, order, status, buka-tutup, loyalitas, statistik", async () => {
const s = await import("../src/db");
const p = await import("../src/pricing");
await s.initDb();
await s.initDb(); // idempotent
const assert = (c: any, m: string) => { expect(Boolean(c), m).toBe(true); };

// pricing
assert(p.methodFromValue === undefined, "helper ui tidak di-import di tes");
assert(p.priceFor(1000, 12500) === 125000, "harga 1000 R$ @12.500/100");
assert(p.parseAmount("1.000") === 1000 && p.parseAmount("1k") === 1000 && p.parseAmount("2,5k") === 2500 && p.parseAmount("500 robux") === 500 && Number.isNaN(p.parseAmount("abc")), "parseAmount");
const sod = p.startOfTodayWIB(Date.UTC(2026,10,8,20,0)); // 9 Nov 03:00 WIB
assert(sod === Date.UTC(2026,10,8,17,0)/1000, "awal hari WIB");

const G = "111111111111111111";
const U = "222222222222222222";
const cfg = s.defaultConfig(G);
cfg.price_gift = 13000; cfg.price_group = 11000; cfg.price_username = 0; cfg.price_login = 9000; cfg.admin_role_id = "333333333333333333";
await s.saveShopConfig(cfg);
const got = await s.getShopConfig(G);
assert(got!.admin_role_id === "333333333333333333" && got!.price_group === 11000, "simpan/ambil config, ID tidak terpotong");

assert(JSON.stringify(p.enabledMethods(got!)) === JSON.stringify(["gift", "group", "login", "boost"]), "metode dengan harga 0 disembunyikan");
assert(!p.validateOrder(got!, 1000, "username").ok, "metode nonaktif ditolak");
assert((p.validateOrder(got!, 1000, "login") as any).price === 90000, "harga via login");
let v = p.validateOrder(got!, 500000, "gift");
assert(v.ok && v.price === 0, "GIG tidak dibatasi min/maks dan harganya 0 (dihitung admin)");
v = p.validateOrder(got!, 50, "gift");
assert(v.ok, "GIG boleh di bawah minimal order");
assert(p.methodPrice(got!, "gift") === 0, "GIG tidak punya tarif per 100");
assert(p.priceFor(500, 15500) === 77500 && p.priceFor(5000, 15500) === 775000, "daftar harga 15.500/100");
assert(p.rupiahList(15500) === "Rp 15.500", "format Rp dengan spasi");
assert(!p.validateOrder(got!, 50, "group").ok, "di bawah minimal");

const o = await s.createOrder({ guild_id: G, user_id: U, robux: 1000, price: 0, stock_cost: 1000, method: "gift", roblox_username: "builderman", note: "Blox Fruits - 2x Mastery" });
assert(o.id === 1 && o.status === "menunggu_pembayaran" && o.method === "gift" && o.note === "Blox Fruits - 2x Mastery", "buat order dengan catatan");
assert((await s.getOpenOrderForUser(G, U))?.id === 1, "order aktif terdeteksi");
await s.setOrderChannel(o.id, "444444444444444444");
assert((await s.getOrderByChannel("444444444444444444"))?.id === 1, "cari order dari channel");
assert(await s.transitionOrder(G, 1, ["diproses"], "selesai") === null, "transisi ilegal ditolak");
assert(await s.completeOrder(G, 1, "a") === null, "tidak bisa selesai sebelum diproses");
assert((await s.transitionOrder(G, 1, ["menunggu_pembayaran"], "menunggu_verifikasi"))?.status === "menunggu_verifikasi", "-> menunggu_verifikasi");
const confirmed = await s.confirmOrder(G, 1, "555", 130000);
assert(confirmed?.status === "diproses" && confirmed?.handled_by === "555" && confirmed?.price === 130000, "konfirmasi GIG dengan harga manual");
assert(await s.confirmOrder(G, 1, "555", 1) === null, "klik ganda ditolak");
const done = await s.completeOrder(G, 1, "555");
assert(done?.status === "selesai" && done?.handled_by === "555", "selesai");
assert(await s.completeOrder(G, 1, "555") === null, "selesai dua kali ditolak");
assert((await s.getOpenOrderForUser(G, U)) === null, "tidak ada order aktif lagi");
assert(await s.markTestimonialPosted(1) === true && await s.markTestimonialPosted(1) === false, "testimoni sekali saja");
assert(await s.getUserTotalRobux(G, U) === 1000, "total robux user");

await s.createOrder({ guild_id: G, user_id: U, robux: 300, price: 33000, stock_cost: 300, method: "group", roblox_username: "builderman", note: null });
assert((await s.transitionOrder(G, 2, ["menunggu_pembayaran"], "dibatalkan"))?.status === "dibatalkan", "batal");

await s.setLoyaltyRole(G, "666", 500); await s.setLoyaltyRole(G, "777", 5000); await s.setLoyaltyRole(G, "666", 800);
const roles = await s.getLoyaltyRoles(G);
assert(roles.length === 2 && roles[0]!.min_spent === 800, "loyalitas upsert & urut");
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
const big = await s.createOrder({ guild_id: G, user_id: U2, robux: 2000, price: 260000, stock_cost: 2000, method: "login", roblox_username: "pembeli2", note: null });
await s.transitionOrder(G, big.id, ["menunggu_pembayaran"], "diproses", "555");
await s.completeOrder(G, big.id, "555");
const lb = await s.getLeaderboard(G, 10);
assert(lb.length === 2 && lb[0]!.user_id === U2 && lb[0]!.spent === 260000 && lb[1]!.spent === 130000, "leaderboard urut berdasarkan total belanja");
const totals = await s.getGlobalTotals(G);
assert(totals.customers === 2 && totals.spending === 390000 && totals.orders === 2, "total customer & spending (pesanan batal tidak dihitung)");
assert(await s.getUserTotalSpent(G, U) === 130000, "total belanja per user");

// daftar harga per metode
await s.setMethodPrice(G, "username", 15500);
assert((await s.getShopConfig(G))!.price_username === 15500, "setMethodPrice username");
await s.savePriceList({ guild_id: G, method: "username", channel_id: "c1", message_id: "m1" });
await s.savePriceList({ guild_id: G, method: "username", channel_id: "c2", message_id: "m2" });
const pls = await s.getPriceLists(G);
assert(pls.length === 1 && pls[0]!.channel_id === "c2" && (await s.getPriceList(G, "username"))!.message_id === "m2", "simpan/ganti daftar harga");
await s.deletePriceList(G, "username");
assert((await s.getPriceList(G, "username")) === null, "hapus daftar harga");
assert(s.defaultConfig("x").price_gift === 1, "GIG aktif secara default");

// joki / boosting
const cj = (await s.getShopConfig(G))!;
assert(cj.boost_enabled === true && p.isMethodEnabled(cj, "boost"), "joki aktif secara default");
const vj = p.validateOrder(cj, NaN, "boost");
assert(vj.ok && vj.robux === 0 && vj.price === 0, "joki tidak butuh jumlah Robux, harga manual");
assert(p.isManual("boost") && p.isManual("gift") && !p.isManual("login"), "metode manual");
const U3 = "444444444444444445";
const joki = await s.createOrder({ guild_id: G, user_id: U3, robux: 0, price: 0, stock_cost: 0, method: "boost", roblox_username: "Gavin#1234", note: "Mobile Legends: Epic III → Mythic" });
assert(joki.method === "boost" && joki.roblox_username === "Gavin#1234", "buat order joki");
const jc = await s.confirmOrder(G, joki.id, "555", 250000);
assert(jc?.price === 250000 && jc?.status === "diproses", "konfirmasi joki dengan harga manual");
await s.completeOrder(G, joki.id, "555");
assert((await s.getGlobalTotals(G)).spending === 390000 + 250000, "pendapatan joki masuk statistik & leaderboard");
await s.saveShopConfig({ ...cj, boost_enabled: false });
assert(!p.isMethodEnabled((await s.getShopConfig(G))!, "boost"), "joki bisa dinonaktifkan");

// reset pesanan: nomor mulai dari 1 lagi, pengaturan tetap
const removed = await s.resetOrders(G);
assert(removed > 0 && (await s.getGlobalTotals(G)).orders === 0, "reset hapus semua pesanan");
const fresh = await s.createOrder({ guild_id: G, user_id: U, robux: 100, price: 15500, stock_cost: 100, method: "username", roblox_username: "builderman", note: null });
assert(fresh.id === 1, "nomor pesanan kembali ke #0001");
assert((await s.getShopConfig(G))!.store_name === "Aminari Store", "pengaturan toko tidak ikut terhapus");

// middleman (rekber)
const mm = await s.createMiddleman({ guild_id: G, opener_id: U, partner_id: "777", opener_side: "pembeli", item: "Akun Blox Fruits", deal: "Rp150.000", note: null });
assert(mm.id === 1 && mm.status === "aktif", "buat tiket middleman #MM-0001");
const pr = s.middlemanParties(mm);
assert(pr.buyer === U && pr.seller === "777", "penjual/pembeli sesuai pilihan");
assert((await s.getActiveMiddlemanForUser(G, U)) === null, "tanpa channel belum dihitung aktif");
await s.setMiddlemanChannel(mm.id, "c-mm");
assert((await s.getActiveMiddlemanForUser(G, U))?.id === mm.id, "satu tiket middleman aktif per member");
assert((await s.finishMiddleman(G, mm.id, "selesai", "555"))?.status === "selesai", "middleman selesai");
assert((await s.finishMiddleman(G, mm.id, "dibatalkan", "555")) === null, "status final tidak bisa diubah lagi");
await s.saveMiddlemanConfig({ guild_id: G, fee: "5%", panel_channel_id: "p", panel_message_id: "m" });
assert((await s.getMiddlemanConfig(G)).fee === "5%", "biaya middleman tersimpan");
});

test("deskripsi command maks. 100 karakter (batas Discord)", async () => {
    const { shopCommandsPayload } = await import("../src/commands");
    const walk = (items: any[]): string[] => items.flatMap((c) => [
        ...(c.description && c.description.length > 100 ? [`${c.name}: ${c.description.length}`] : []),
        ...(c.name?.length > 32 ? [`nama ${c.name}`] : []),
        ...walk(c.options ?? []),
        ...(c.choices ?? []).filter((x: any) => x.name.length > 100).map((x: any) => `choice ${x.name}`),
    ]);
    expect(walk(shopCommandsPayload as any[])).toEqual([]);
});

test("tarif GIG lewat /setup-harga", async () => {
    const s = await import("../src/db");
    const p = await import("../src/pricing");
    const G = "gig-guild";
    await s.saveShopConfig(s.defaultConfig(G));
    let c = (await s.getShopConfig(G))!;
    const manual = p.validateOrder(c, 450, "gift");
    expect(manual.ok && manual.price).toBe(0); // tanpa tarif: harga manual
    await s.setMethodPrice(G, "gift", 15500);
    c = (await s.getShopConfig(G))!;
    expect(c.price_gig).toBe(15500);
    expect(p.isMethodEnabled(c, "gift")).toBe(true);
    const priced = p.validateOrder(c, 450, "gift");
    expect(priced.ok && priced.price).toBe(69750);
    const tiny = p.validateOrder(c, 5, "gift"); // GIG tidak kena minimal order
    expect(tiny.ok).toBe(true);
    await s.setMethodPrice(G, "gift", 0);
    c = (await s.getShopConfig(G))!;
    expect(p.isMethodEnabled(c, "gift")).toBe(true); // 0 = kembali manual, bukan nonaktif
});

test("kalkulator", async () => {
    const p = await import("../src/pricing");
    expect(p.calculate(1499, 94)).toBe(140906);
    expect(p.calculate(439, 155)).toBe(68045);
    expect(p.calculate(3, 155.5)).toBe(467); // 466,5 dibulatkan ke atas
});

test("gambar QRIS tersimpan di database", async () => {
    const s = await import("../src/db");
    const G = "qris-guild";
    expect(await s.getQris(G)).toBeNull();
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    await s.setQris(G, { name: "qris.png", data });
    const got = await s.getQris(G);
    expect(got?.name).toBe("qris.png");
    expect(got?.data.equals(data)).toBe(true);
    await s.setQris(G, null);
    expect(await s.getQris(G)).toBeNull();
});
