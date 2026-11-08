import type { DeliveryMethod, OrderStatus, ShopConfig } from "./db";

/** Urutan metode pengiriman seperti tampil di form & panel. */
export const METHODS: DeliveryMethod[] = ["gift", "group", "username", "login"];

export const METHOD_LABEL: Record<DeliveryMethod, string> = {
    gift: "Gift In Game",
    group: "Group Payout",
    username: "Via Send Username",
    login: "Via Login",
};

export const METHOD_EMOJI: Record<DeliveryMethod, string> = {
    gift: "🎁",
    group: "👥",
    username: "👤",
    login: "🔐",
};

/** Keterangan singkat di pilihan form (maks. 100 karakter termasuk harga). */
export const METHOD_HINT: Record<DeliveryMethod, string> = {
    gift: "Item di dalam map/game, harga dihitung admin",
    group: "Dikirim lewat payout grup Roblox",
    username: "Cukup pakai username Roblox",
    login: "Admin login ke akunmu untuk top up",
};

/** Metode dengan harga tetap per 100 Robux (punya daftar harga). GIG tidak termasuk. */
export const PRICED_METHODS: DeliveryMethod[] = ["login", "username", "group"];

/** Jumlah Robux yang ditampilkan di daftar harga. */
export const PRICE_TIERS = [100, 200, 300, 400, 500, 1000, 2000, 3000, 4000, 5000];

/** Robux yang dikeluarkan penjual untuk satu order (arsip). */
export function stockCostFor(robux: number, _method?: DeliveryMethod): number {
    return robux;
}

/** Harga Rupiah untuk `robux` dengan tarif per 100 Robux (dibulatkan ke atas). */
export function priceFor(robux: number, pricePer100: number): number {
    return Math.ceil((robux * pricePer100) / 100);
}

/** Tarif per 100 Robux. GIG selalu 0 karena harganya dihitung manual oleh admin. */
export function methodPrice(config: ShopConfig, method: DeliveryMethod): number {
    switch (method) {
        case "gift": return 0;
        case "group": return config.price_group;
        case "username": return config.price_username;
        case "login": return config.price_login;
    }
}

/** GIG aktif/nonaktif disimpan di kolom price_gift sebagai penanda (1 = aktif). */
export function isMethodEnabled(config: ShopConfig, method: DeliveryMethod): boolean {
    return method === "gift" ? config.price_gift > 0 : methodPrice(config, method) > 0;
}

/** Metode yang aktif, urut seperti METHODS. */
export function enabledMethods(config: ShopConfig): DeliveryMethod[] {
    return METHODS.filter((m) => isMethodEnabled(config, m));
}

/** Format "Rp 15.500" (dengan spasi) untuk daftar harga. */
export function rupiahList(n: number): string {
    return "Rp " + Math.round(n).toLocaleString("id-ID");
}

export function methodLabel(m: DeliveryMethod): string {
    return `${METHOD_EMOJI[m]} ${METHOD_LABEL[m]}`;
}

export function rupiah(n: number): string {
    return "Rp" + Math.round(n).toLocaleString("id-ID");
}

export function robux(n: number): string {
    return n.toLocaleString("id-ID") + " R$";
}

export function orderCode(id: number): string {
    return "#" + String(id).padStart(4, "0");
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
    menunggu_pembayaran: "⏳ Menunggu pembayaran",
    menunggu_verifikasi: "🔎 Menunggu verifikasi admin",
    diproses: "⚙️ Sedang diproses",
    selesai: "✅ Selesai",
    dibatalkan: "❌ Dibatalkan",
};

export const STATUS_COLOR: Record<OrderStatus, number> = {
    menunggu_pembayaran: 0xf1c40f,
    menunggu_verifikasi: 0x3498db,
    diproses: 0x9b59b6,
    selesai: 0x2ecc71,
    dibatalkan: 0xe74c3c,
};

/** Awal hari ini (00:00 WIB, UTC+7) dalam detik unix. */
export function startOfTodayWIB(nowMs = Date.now()): number {
    const offset = 7 * 3600 * 1000;
    const local = nowMs + offset;
    const startLocal = local - (local % 86_400_000);
    return Math.floor((startLocal - offset) / 1000);
}

export type ValidationResult =
    | { ok: true; robux: number; price: number; stockCost: number }
    | { ok: false; error: string };

export function validateOrder(config: ShopConfig, amount: number, method: DeliveryMethod): ValidationResult {
    if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: "Jumlah Robux harus berupa angka bulat positif." };
    if (!isMethodEnabled(config, method)) return { ok: false, error: `Metode ${METHOD_LABEL[method]} sedang tidak tersedia.` };
    // GIG: harga item berubah-ubah, dihitung manual oleh admin; batas min/maks tidak berlaku.
    if (method === "gift") return { ok: true, robux: amount, price: 0, stockCost: amount };
    if (amount < config.min_order) return { ok: false, error: `Minimal order ${robux(config.min_order)}.` };
    if (amount > config.max_order) return { ok: false, error: `Maksimal order ${robux(config.max_order)}.` };
    const stockCost = stockCostFor(amount);
    return { ok: true, robux: amount, price: priceFor(amount, methodPrice(config, method)), stockCost };
}

/** Ambil angka dari input seperti "1.000", "1000 robux", "1k". */
export function parseAmount(input: string): number {
    const s = input.trim().toLowerCase().replace(/\s|r\$|robux/g, "");
    const k = s.match(/^(\d+(?:[.,]\d+)?)k$/);
    if (k) return Math.round(parseFloat(k[1]!.replace(",", ".")) * 1000);
    const digits = s.replace(/[.,]/g, "");
    if (!/^\d+$/.test(digits)) return NaN;
    return parseInt(digits, 10);
}
