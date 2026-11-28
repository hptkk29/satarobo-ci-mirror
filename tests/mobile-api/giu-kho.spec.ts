import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { doiSoatKho, giuKho, nhaGiuKho, quetHetHan, tieuThuGiuKho, traKho } from "@/lib/inventory/giu-kho";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { assertTestDb } from "../e2e/_helpers/seed";

/**
 * [GK-DB] GIỮ KHO HÀNG ONLINE (Commerce v2 · P0-B) — Postgres THẬT, giao dịch THẬT, đồng thời THẬT.
 * Bất biến kiểm: không bao giờ bán/giữ quá tồn; hết hạn là vị từ; worker chạy trùng vô hại; thanh toán đến muộn được kiểm lại; mọi bước idempotent.
 *   [GK-01] giữ cơ bản + idempotent + validation + sản phẩm không bán Online (không ghi gì)
 *   [GK-02] đơn nhiều sản phẩm: cả đơn hoặc không gì cả
 *   [GK-03] hai khách mua SUẤT CUỐI song song ⇒ đúng một thắng
 *   [GK-04] 100 checkout đồng thời trên 40 hàng ⇒ đúng 40 thắng, 0 lỗi hạ tầng, không âm, không giữ quá tồn
 *   [GK-05] đơn nhiều sản phẩm khoá lộn thứ tự, đồng thời ⇒ không deadlock
 *   [GK-06] hết hạn: vị từ trả hàng ngay; worker dọn; chạy trùng/song song vô hại; KHÔNG xoá đơn/dòng
 *   [GK-07] thanh toán đến MUỘN: còn hàng ⇒ bán (muộn=true); đã hết ⇒ HET_HANG + không ghi gì
 *   [GK-08] tiêu thụ idempotent (webhook lặp, 5 lần song song ⇒ đúng một lần trừ + một ProductMovement SALE)
 *   [GK-09] huỷ đơn nhả giữ kho; không chạm dòng đã bán
 *   [GK-10] nhận hàng trả: cộng lại đúng một lần; dòng chưa bán không trả được
 *   [GK-11] đối soát: sạch ⇒ 0 lỗi; cố ý làm hỏng ⇒ bắt đúng loại lỗi
 *   [GK-12] hết hàng khi tồn thực bị điều chỉnh dưới phần đang giữ ⇒ tiêu thụ báo HET_HANG, KHÔNG âm tồn
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "gk842-";
const NOW = new Date("2026-11-24T10:00:00.000Z");
const phut = (n: number) => new Date(NOW.getTime() + n * 60_000);
const NGUOI = { id: null, ten: "kiểm thử" };
const TX = { timeout: 60_000, maxWait: 120_000 } as const;

let seq = 0;
async function sanPham(ton: number, dacBiet: { sellOnline?: boolean; status?: "ACTIVE" | "DRAFT" } = {}) {
  seq++;
  return (await db.product.create({ data: { sku: `${NS}sku-${Date.now()}-${seq}`, name: `${NS}sp-${seq}`, category: "KIT_ROBOT", status: dacBiet.status ?? "ACTIVE", salePrice: 100_000, stockOnHand: ton, sellOnline: dacBiet.sellOnline ?? true }, select: { id: true } })).id;
}
/** Một đơn Online với n dòng hàng; trả id các dòng. */
async function don(n: number, productId: string, soLuong = 1): Promise<string[]> {
  seq++;
  const o = await db.order.create({ data: { code: `${NS}ORD-${Date.now()}-${seq}`, type: "ONLINE", status: "PENDING_PAYMENT", customerName: `${NS}khách`, customerPhone: "0900000000", subtotal: 0, totalAmount: 0 } as never, select: { id: true } });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await db.orderItem.create({ data: { orderId: o.id, type: "PRODUCT", productId, itemName: `${NS}dòng`, quantity: soLuong, unitPrice: 100_000, totalPrice: 100_000 * soLuong } as never, select: { id: true } })).id);
  return ids;
}
const giu = (dong: Array<{ orderItemId: string; productId: string; soLuong: number }>, now = NOW, ttl = 15) => db.$transaction((tx) => giuKho(tx, { dong, now, ttlPhut: ttl }), TX);
const ton = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id }, select: { stockOnHand: true } })).stockOnHand;
const trangThai = async (orderItemId: string) => (await db.productReservation.findUnique({ where: { orderItemId }, select: { status: true } }))?.status ?? null;
const tieuThu = (orderItemId: string, now = NOW) => db.$transaction((tx) => tieuThuGiuKho(tx, { orderItemId, now, nguoi: NGUOI }), TX);

async function don_() {
  const sps = await db.product.findMany({ where: { sku: { startsWith: NS } }, select: { id: true } });
  const pids = sps.map((p) => p.id);
  const orders = await db.order.findMany({ where: { code: { startsWith: NS } }, select: { id: true } });
  const oids = orders.map((o) => o.id);
  await db.productReservation.deleteMany({ where: { productId: { in: pids } } });
  await db.productMovement.deleteMany({ where: { OR: [{ productId: { in: pids } }, { orderId: { in: oids } }] } });
  await db.orderItem.deleteMany({ where: { orderId: { in: oids } } });
  await db.order.deleteMany({ where: { id: { in: oids } } });
  await db.product.deleteMany({ where: { id: { in: pids } } });
}

describe.skipIf(!RUN)("[GK-DB] giữ kho hàng Online — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await don_();
  }, 120_000);
  afterAll(async () => {
    await don_();
  }, 120_000);

  it("[GK-01] giữ cơ bản, idempotent, validation, không bán Online", async () => {
    const p = await sanPham(10);
    const [d1] = await don(1, p, 3);
    const r = await giu([{ orderItemId: d1!, productId: p, soLuong: 3 }]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error();
    expect(r.hanGiuLuc.getTime()).toBe(phut(15).getTime());
    expect(await ton(p)).toBe(10); // giữ KHÔNG đổi tồn thực
    expect((await doiSoatKho(db, { now: NOW, productId: p })).sanPham[0]).toMatchObject({ tonThuc: 10, dangGiuHieuLuc: 3, khaDung: 7 });
    const lai = await giu([{ orderItemId: d1!, productId: p, soLuong: 3 }], phut(5));
    expect(lai).toMatchObject({ ok: true }); // idempotent: trả đúng hạn cũ
    if (lai.ok) expect(lai.hanGiuLuc.getTime()).toBe(phut(15).getTime());
    expect((await doiSoatKho(db, { now: NOW, productId: p })).sanPham[0]!.dangGiuHieuLuc).toBe(3); // không giữ thêm
    // validation
    const [d2] = await don(1, p);
    for (const [moTa, dong, ttl] of [["ttl 0", [{ orderItemId: d2!, productId: p, soLuong: 1 }], 0], ["ttl quá lớn", [{ orderItemId: d2!, productId: p, soLuong: 1 }], 1441], ["số lượng 0", [{ orderItemId: d2!, productId: p, soLuong: 0 }], 15], ["số lượng lẻ", [{ orderItemId: d2!, productId: p, soLuong: 1.5 }], 15], ["trùng dòng", [{ orderItemId: d2!, productId: p, soLuong: 1 }, { orderItemId: d2!, productId: p, soLuong: 1 }], 15], ["rỗng", [], 15]] as const) {
      expect(await giu([...dong], NOW, ttl), moTa).toMatchObject({ ok: false, ma: "VALIDATION" });
    }
    // không bán Online / nháp / không tồn tại
    const tat = await sanPham(5, { sellOnline: false });
    const nhap = await sanPham(5, { status: "DRAFT" });
    const [d3] = await don(1, tat);
    expect(await giu([{ orderItemId: d3!, productId: tat, soLuong: 1 }])).toMatchObject({ ok: false, ma: "KHONG_BAN_ONLINE" });
    expect(await giu([{ orderItemId: d3!, productId: nhap, soLuong: 1 }])).toMatchObject({ ok: false, ma: "KHONG_BAN_ONLINE" });
    expect(await giu([{ orderItemId: d3!, productId: "khong-co-that", soLuong: 1 }])).toMatchObject({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await db.productReservation.count({ where: { orderItemId: d3 } })).toBe(0);
  });

  it("[GK-02] đơn nhiều sản phẩm: cả đơn hoặc không gì cả", async () => {
    const a = await sanPham(5);
    const b = await sanPham(1);
    const [da] = await don(1, a, 2);
    const [db1] = await don(1, b, 2);
    const r = await giu([{ orderItemId: da!, productId: a, soLuong: 2 }, { orderItemId: db1!, productId: b, soLuong: 2 }]);
    expect(r).toMatchObject({ ok: false, ma: "HET_HANG", thieu: [{ productId: b, yeuCau: 2, conLai: 1 }] });
    expect(await db.productReservation.count({ where: { orderItemId: { in: [da!, db1!] } } })).toBe(0); // A đủ nhưng KHÔNG bị giữ
    // hai dòng cùng sản phẩm cộng dồn
    const c = await sanPham(3);
    const [dc1, dc2] = await don(2, c);
    expect(await giu([{ orderItemId: dc1!, productId: c, soLuong: 2 }, { orderItemId: dc2!, productId: c, soLuong: 2 }])).toMatchObject({ ok: false, ma: "HET_HANG", thieu: [{ productId: c, yeuCau: 4, conLai: 3 }] });
  });

  it("[GK-03] hai khách mua SUẤT CUỐI song song ⇒ đúng một thắng", async () => {
    const p = await sanPham(1);
    const [x] = await don(1, p);
    const [y] = await don(1, p);
    const kq = await Promise.all([giu([{ orderItemId: x!, productId: p, soLuong: 1 }]), giu([{ orderItemId: y!, productId: p, soLuong: 1 }])]);
    expect(kq.filter((r) => r.ok)).toHaveLength(1);
    expect(kq.filter((r) => !r.ok && r.ma === "HET_HANG")).toHaveLength(1);
    expect((await doiSoatKho(db, { now: NOW, productId: p })).sanPham[0]).toMatchObject({ dangGiuHieuLuc: 1, khaDung: 0 });
  });

  it("[GK-04] 100 checkout đồng thời trên 40 hàng ⇒ đúng 40 thắng; 0 lỗi hạ tầng; không âm; không giữ quá tồn", async () => {
    const p = await sanPham(40);
    const dong = await don(100, p);
    const kq = await Promise.all(dong.map((id) => giu([{ orderItemId: id, productId: p, soLuong: 1 }]).then((r) => (r.ok ? "OK" : r.ma), (e: unknown) => `LOI_HA_TANG:${e instanceof Error ? e.message.slice(0, 80) : String(e)}`)));
    const dem = (k: string) => kq.filter((x) => x === k).length;
    expect(kq.filter((x) => x.startsWith("LOI_HA_TANG")), "lỗi hạ tầng (pool/timeout) KHÔNG phải từ chối do kho").toEqual([]);
    expect(dem("OK")).toBe(40);
    expect(dem("HET_HANG")).toBe(60);
    const dg = await db.productReservation.aggregate({ where: { productId: p, status: "ACTIVE" }, _sum: { quantity: true } });
    expect(dg._sum.quantity).toBe(40);
    expect(await ton(p)).toBe(40);
  }, 180_000);

  it("[GK-05] đơn nhiều sản phẩm khoá lộn thứ tự, đồng thời ⇒ không deadlock", async () => {
    const a = await sanPham(100);
    const b = await sanPham(100);
    const c = await sanPham(100);
    const dsA = await don(30, a);
    const dsB = await don(30, b);
    const dsC = await don(30, c);
    const kq = await Promise.all(Array.from({ length: 30 }, (_, i) => {
      const dong = [{ orderItemId: dsA[i]!, productId: a, soLuong: 1 }, { orderItemId: dsB[i]!, productId: b, soLuong: 1 }, { orderItemId: dsC[i]!, productId: c, soLuong: 1 }];
      if (i % 2 === 1) dong.reverse();
      if (i % 3 === 2) dong.push(dong.shift()!);
      return giu(dong).then((r) => (r.ok ? "OK" : r.ma), (e: unknown) => `LOI:${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
    }));
    expect(kq.filter((x) => x.startsWith("LOI"))).toEqual([]);
    expect(kq.every((x) => x === "OK")).toBe(true);
  }, 120_000);

  it("[GK-06] hết hạn = vị từ; worker dọn; chạy trùng/song song vô hại; KHÔNG xoá đơn/dòng", async () => {
    const p = await sanPham(2);
    const [x, y, z] = await don(3, p);
    expect(await giu([{ orderItemId: x!, productId: p, soLuong: 2 }])).toMatchObject({ ok: true });
    expect(await giu([{ orderItemId: y!, productId: p, soLuong: 1 }], phut(5))).toMatchObject({ ok: false, ma: "HET_HANG" });
    // 16 phút sau: vị từ nhả hàng NGAY, dù worker chưa chạy (trạng thái vẫn ACTIVE)
    expect(await trangThai(x!)).toBe("ACTIVE");
    expect(await giu([{ orderItemId: y!, productId: p, soLuong: 2 }], phut(16))).toMatchObject({ ok: true });
    // worker: hai lần song song + một lần nữa ⇒ tổng đúng số dòng quá hạn, không lỗi
    const quaHan = await db.productReservation.count({ where: { status: "ACTIVE", expiresAt: { lte: phut(16) } } }); // worker quét TOÀN CỤC (gồm giữ kho của các ca khác)
    expect(quaHan).toBeGreaterThanOrEqual(1);
    const [n1, n2] = await Promise.all([quetHetHan(db, { now: phut(16) }), quetHetHan(db, { now: phut(16) })]);
    expect(n1 + n2).toBe(quaHan); // song song: mỗi dòng được dọn đúng MỘT lần
    expect(await quetHetHan(db, { now: phut(16) })).toBe(0);
    expect(await trangThai(x!)).toBe("EXPIRED");
    expect(await trangThai(y!)).toBe("ACTIVE");
    // KHÔNG xoá đơn/dòng
    expect(await db.orderItem.count({ where: { id: { in: [x!, y!, z!] } } })).toBe(3);
    expect((await db.order.count({ where: { items: { some: { id: x! } } } }))).toBe(1);
  });

  it("[GK-07] thanh toán đến MUỘN: còn hàng ⇒ bán; đã hết ⇒ HET_HANG và không ghi gì", async () => {
    const p = await sanPham(3);
    const [x, y] = await don(2, p, 2);
    expect(await giu([{ orderItemId: x!, productId: p, soLuong: 2 }])).toMatchObject({ ok: true });
    // hết hạn; khách khác KHÔNG kịp lấy ⇒ thanh toán muộn vẫn được bán
    const muon = await tieuThu(x!, phut(40));
    expect(muon).toMatchObject({ ok: true, daXong: false, muon: true });
    expect(await ton(p)).toBe(1);
    expect(await trangThai(x!)).toBe("CONSUMED");
    // dòng y: giữ rồi hết hạn; một khách khác lấy MẤT phần còn lại ⇒ y đến muộn phải bị từ chối
    expect(await giu([{ orderItemId: y!, productId: p, soLuong: 1 }], phut(50))).toMatchObject({ ok: true });
    const [z] = await don(1, p);
    expect(await giu([{ orderItemId: z!, productId: p, soLuong: 1 }], phut(70))).toMatchObject({ ok: true }); // y đã hết hạn lúc 65 ⇒ z lấy được tồn cuối
    const truocTon = await ton(p);
    const tre = await tieuThu(y!, phut(80));
    expect(tre).toMatchObject({ ok: false, ma: "HET_HANG", canXuLyTay: true });
    expect(await ton(p)).toBe(truocTon); // không ghi gì
    expect(await trangThai(y!)).toBe("ACTIVE");
    expect(await db.productMovement.count({ where: { productId: p, type: "SALE" } })).toBe(1);
  });

  it("[GK-08] tiêu thụ idempotent: webhook lặp / 5 lần song song ⇒ đúng một lần trừ + một SALE", async () => {
    const p = await sanPham(10);
    const [x] = await don(1, p, 4);
    await giu([{ orderItemId: x!, productId: p, soLuong: 4 }]);
    const kq = await Promise.all(Array.from({ length: 5 }, () => tieuThu(x!, phut(3))));
    expect(kq.every((r) => r.ok)).toBe(true);
    expect(kq.filter((r) => r.ok && !r.daXong)).toHaveLength(1);
    expect(await ton(p)).toBe(6);
    expect(await db.productMovement.count({ where: { productId: p, type: "SALE" } })).toBe(1);
    const mv = await db.productMovement.findFirstOrThrow({ where: { productId: p, type: "SALE" }, select: { quantity: true, stockBeforeMovement: true, stockAfterMovement: true } });
    expect(mv).toEqual({ quantity: -4, stockBeforeMovement: 10, stockAfterMovement: 6 });
    expect(await tieuThu(x!, phut(9))).toMatchObject({ ok: true, daXong: true });
    expect(await ton(p)).toBe(6);
    expect(await tieuThu("dong-khong-co-giu-kho")).toMatchObject({ ok: false, ma: "KHONG_CO_GIU_KHO" });
  });

  it("[GK-09] huỷ đơn nhả giữ kho; không chạm dòng đã bán", async () => {
    const p = await sanPham(5);
    const [x, y] = await don(2, p, 2);
    await giu([{ orderItemId: x!, productId: p, soLuong: 2 }, { orderItemId: y!, productId: p, soLuong: 2 }]);
    await tieuThu(y!, phut(2)); // y đã bán
    expect(await db.$transaction((tx) => nhaGiuKho(tx, { orderItemIds: [x!, y!], lyDo: "HUY_DON", now: phut(3) }))).toBe(1); // chỉ x
    expect(await trangThai(x!)).toBe("RELEASED");
    expect(await trangThai(y!)).toBe("CONSUMED");
    expect(await db.$transaction((tx) => nhaGiuKho(tx, { orderItemIds: [x!, y!], lyDo: "HUY_DON", now: phut(4) }))).toBe(0); // lặp
    expect((await doiSoatKho(db, { now: phut(5), productId: p })).sanPham[0]).toMatchObject({ tonThuc: 3, dangGiuHieuLuc: 0, khaDung: 3 });
  });

  it("[GK-10] nhận hàng trả cộng lại đúng một lần; dòng chưa bán không trả được", async () => {
    const p = await sanPham(5);
    const [x, y] = await don(2, p, 2);
    await giu([{ orderItemId: x!, productId: p, soLuong: 2 }]);
    await tieuThu(x!, phut(1));
    expect(await db.$transaction((tx) => traKho(tx, { orderItemId: y!, now: phut(2), nguoi: NGUOI, lyDo: "x" }))).toMatchObject({ ok: false, ma: "KHONG_CO_GIU_KHO" });
    await giu([{ orderItemId: y!, productId: p, soLuong: 1 }]);
    expect(await db.$transaction((tx) => traKho(tx, { orderItemId: y!, now: phut(2), nguoi: NGUOI, lyDo: "x" }))).toMatchObject({ ok: false, ma: "DA_XU_LY" });
    const kq = await Promise.all([1, 2, 3].map(() => db.$transaction((tx) => traKho(tx, { orderItemId: x!, now: phut(3), nguoi: NGUOI, lyDo: "Khách trả hàng" }), TX)));
    expect(kq.filter((r) => r.ok && r.daTra)).toHaveLength(1);
    expect(await ton(p)).toBe(5);
    expect(await trangThai(x!)).toBe("RETURNED");
    expect(await db.productMovement.count({ where: { productId: p, type: "RETURN" } })).toBe(1);
    expect(await tieuThu(x!, phut(9))).toMatchObject({ ok: true, daXong: true }); // đã trả không bán lại được
    expect(await ton(p)).toBe(5);
  });

  it("[GK-11] đối soát: sạch ⇒ 0 lỗi; cố ý làm hỏng ⇒ bắt đúng loại lỗi", async () => {
    const p = await sanPham(10);
    const [x, y] = await don(2, p, 2);
    await giu([{ orderItemId: x!, productId: p, soLuong: 2 }, { orderItemId: y!, productId: p, soLuong: 2 }]);
    await tieuThu(x!, phut(1));
    const sach = await doiSoatKho(db, { now: phut(2), productId: p });
    expect(sach.loi).toEqual([]);
    expect(sach.sanPham[0]).toMatchObject({ tonThuc: 8, dangGiuHieuLuc: 2, khaDung: 6, daBanOnline: 2 });
    // làm hỏng 1: xoá sổ SALE
    await db.productMovement.deleteMany({ where: { productId: p, type: "SALE" } });
    expect((await doiSoatKho(db, { now: phut(2), productId: p })).loi.map((l) => l.loai)).toContain("BAN_THIEU_SO");
    // làm hỏng 2: điều chỉnh tồn xuống dưới phần đang giữ
    await db.product.update({ where: { id: p }, data: { stockOnHand: 1 } });
    expect((await doiSoatKho(db, { now: phut(2), productId: p })).loi.map((l) => l.loai)).toContain("GIU_VUOT_TON");
    // làm hỏng 3: quá hạn chưa quét
    const q = (await doiSoatKho(db, { now: phut(30), productId: p })).loi.map((l) => l.loai);
    expect(q).toContain("DANG_GIU_QUA_HAN_CHUA_QUET");
    await db.product.update({ where: { id: p }, data: { stockOnHand: -1 } });
    expect((await doiSoatKho(db, { now: phut(2), productId: p })).loi.map((l) => l.loai)).toContain("AM_TON");
  });

  it("[GK-13] giữ LẠI đơn khi một dòng còn hiệu lực và dòng kia đã nhả: phần đang giữ của chính đơn không bị tính hai lần", async () => {
    const p = await sanPham(4);
    const [x, y] = await don(2, p, 2);
    expect(await giu([{ orderItemId: x!, productId: p, soLuong: 2 }, { orderItemId: y!, productId: p, soLuong: 2 }])).toMatchObject({ ok: true });
    await db.$transaction((tx) => nhaGiuKho(tx, { orderItemIds: [y!], lyDo: "GO_DONG", now: phut(2) }));
    // thử lại cả đơn: x còn ACTIVE (2), y đã RELEASED ⇒ cần 4 ≤ tồn 4, KHÔNG được báo thiếu vì tính x hai lần
    const lai = await giu([{ orderItemId: x!, productId: p, soLuong: 2 }, { orderItemId: y!, productId: p, soLuong: 2 }], phut(3));
    expect(lai).toMatchObject({ ok: true });
    expect((await doiSoatKho(db, { now: phut(3), productId: p })).sanPham[0]).toMatchObject({ dangGiuHieuLuc: 4, khaDung: 0 });
  });

  it("[GK-12] tồn thực bị điều chỉnh dưới phần đang giữ ⇒ tiêu thụ báo HET_HANG, KHÔNG âm tồn", async () => {
    const p = await sanPham(5);
    const [x] = await don(1, p, 3);
    await giu([{ orderItemId: x!, productId: p, soLuong: 3 }]);
    await db.product.update({ where: { id: p }, data: { stockOnHand: 1 } }); // nhân viên kiểm kho, điều chỉnh xuống
    expect(await tieuThu(x!, phut(2))).toMatchObject({ ok: false, ma: "HET_HANG", canXuLyTay: true });
    expect(await ton(p)).toBe(1);
    expect(await trangThai(x!)).toBe("ACTIVE");
  });
});
