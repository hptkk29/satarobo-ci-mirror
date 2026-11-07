// Ca [QND-*] — SCANNER BÓNG NGHĨA VỤ HOÁ ĐƠN (Invoice Hub S8) TRÊN POSTGRES THẬT.
//
// Chạy:  DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/finance/hoa-don-quet-db.test.ts
//        (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET; DB phải là `satarobo_test` / `ci_test`)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng + tự dọn theo tiền tố id; mỗi ca dựng lại ⇒ xanh khi chạy MỘT MÌNH.
//
// Luật thuần (kế hoạch, lô, thông báo) đã có test riêng. Thứ CHỈ đo được ở DB thật: bảng chiếu GHI đúng cơ sở, chạy lại không đổi gì,
// hai lượt chạy chồng nhau hội tụ về MỘT kết quả, scanner KHÔNG đụng sổ tiền / hoá đơn, cờ TẮT không chạm bảng nào, lượt bị dừng / lỗi giữa
// chừng thì lượt sau hội tụ về cùng trạng thái, và chuông chỉ tới đúng người giữ quyền Ở CƠ SỞ ĐÓ.
// Mọi ca "KHÔNG được" kèm đối chứng dương. Đồng hồ ĐÓNG BĂNG (luật 19): mọi mốc là hằng tuyệt đối, `now` được truyền vào.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ notify: vi.fn(async (_p: { userIds: readonly string[]; dedupeKey: string; title: string; body: string; href?: string | null }) => 1) }));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notify }));

import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { SALE_STATUS_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { seedUser } from "../e2e/_helpers/seed";
import { chayQuetBong, chonDonCanQuet, docUngVienQuet, quetCacDon } from "@/lib/finance/hoa-don/quet-nghia-vu-db";
import { baoNgoaiLeTucThoi } from "@/lib/finance/hoa-don/ngoai-le-tuc-thoi-db";

if (!RUN_DB_TESTS) console.warn(`[QND] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-qnd-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU_HO = `${T}ou-ho`;
const OU1 = `${T}ou1`;
const OU2 = `${T}ou2`;
const DON1 = `${T}don1`; // CS1
const DON2 = `${T}don2`; // CS2
const P1 = `${T}p1`; // DON1 · tiền mặt 8.976.000 · CS1
const P2 = `${T}p2`; // DON1 · tiền mặt 4.488.000 · CS1
const P3 = `${T}p3`; // DON2 · tiền mặt 6.732.000 · CS2
const P4 = `${T}p4`; // DON1 · tiền mặt 3.000.000 · nhưng thu Ở CS2 (khác cơ sở của đơn)
const HD1 = `${T}hd1`;
const VAI = `${T}vai`;
const NOW = new Date("2026-11-02T03:00:00Z"); // 10:00 giờ VN
const NGAY_THU = new Date("2026-10-30T03:00:00Z");
// 18:30Z = 01:30 sáng NGÀY SAU theo giờ VN — hình dạng thật của khoản thu khuya; đọc theo UTC sẽ ra sai ngày.
const NGAY_THU_KHUYA = new Date("2026-10-30T18:30:00Z");
const MOI_CAP_NHAT = new Date("2026-11-02T01:00:00Z"); // trong cửa sổ 72 giờ của NOW
const CU = new Date("2026-10-01T00:00:00Z"); // ngoài cửa sổ
const luon = () => true;
const DA_GHI = SALE_STATUS_DA_GHI_NHAN[0]!;

const BANG_TIEN = ["order", "payment", "hoaDonDienTu", "hoaDonKhoan", "paymentRequest", "paymentAllocation"] as const;

async function don() {
  const theoId = { where: { id: { startsWith: T } } };
  await db.hoaDonNgoaiLe.deleteMany({ where: { OR: [{ orderId: { startsWith: T } }, { centerId: { in: [CS1, CS2] } }] } });
  await db.hoaDonNghiaVu.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.hoaDonKhoan.deleteMany({ where: { hoaDonId: { startsWith: T } } });
  await db.hoaDonDienTu.deleteMany(theoId);
  await db.payment.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.order.deleteMany(theoId);
  const nguoi = await db.user.findMany({ where: { email: { endsWith: `@${T}test` } }, select: { id: true } });
  await db.userOrgRole.deleteMany({ where: { OR: [{ userId: { in: nguoi.map((u) => u.id) } }, { roleId: VAI }] } });
  await db.rolePermission.deleteMany({ where: { roleId: VAI } });
  await db.roleDef.deleteMany({ where: { id: VAI } });
  await db.user.deleteMany({ where: { id: { in: nguoi.map((u) => u.id) } } });
  await db.centerSetting.deleteMany({ where: { orgUnitId: { in: [OU1, OU2] } } });
  await db.orgUnit.deleteMany({ where: { id: { in: [OU1, OU2] } } });
  await db.orgUnit.deleteMany({ where: { id: OU_HO } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.hubThiDiem"] } } });
}

/** `thiDiem` = mức TOÀN HỆ THỐNG của `hoaDon.hubThiDiem` (true ⇒ mọi cơ sở tham gia; ca [QND-13] đặt false rồi bật RIÊNG từng cơ sở). */
async function batCo(man: boolean, quet: boolean, thiDiem = true) {
  for (const [key, v] of [["billing.hoaDonEnabled", man], ["hoaDon.hubQuet", quet], ["hoaDon.hubThiDiem", thiDiem]] as const) {
    await db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v }, update: { valueJson: v } });
  }
}

const tienMat = (id: string, orderId: string, amount: number, centerId: string | null, o: { updatedAt?: Date; paidDate?: Date } = {}) =>
  db.payment.create({
    data: {
      id,
      orderId,
      amount,
      method: "CASH",
      paidDate: o.paidDate ?? NGAY_THU,
      saleStatus: DA_GHI,
      accountantStatus: "PENDING",
      recordedById: `${T}sale`,
      centerId,
      updatedAt: o.updatedAt ?? MOI_CAP_NHAT,
    },
  });

async function dungFixture() {
  await don();
  await batCo(true, true);
  for (const [id, ten] of [[CS1, "CS1 QND"], [CS2, "CS2 QND"]] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "x" } });
  }
  await db.orgUnit.create({ data: { id: OU_HO, type: "HO", code: `${T}HO`, name: "HO QND", path: `/${T}ho/`, depth: 0 } });
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "ĐV CS1 QND", centerId: CS1, parentId: OU_HO, path: `/${T}ho/${T}ou1/`, depth: 1 } });
  await db.orgUnit.create({ data: { id: OU2, type: "CENTER", code: `${T}OU2`, name: "ĐV CS2 QND", centerId: CS2, parentId: OU_HO, path: `/${T}ho/${T}ou2/`, depth: 1 } });
  for (const [id, coSo, ma, sdt] of [[DON1, CS1, "ORD-269972-000001", "0328545331"], [DON2, CS2, "ORD-269972-000002", "0905123461"]] as const) {
    await db.order.create({
      data: { id, code: ma, type: "COURSE", status: "CONFIRMED", customerName: "Phụ huynh QND", customerPhone: sdt, totalAmount: 13_464_000, centerId: coSo },
    });
  }
  await tienMat(P1, DON1, 8_976_000, CS1);
  await tienMat(P2, DON1, 4_488_000, CS1, { paidDate: NGAY_THU_KHUYA });
  await tienMat(P3, DON2, 6_732_000, CS2);
}

/** Ảnh chụp các bảng TIỀN + hoá đơn (kể cả updatedAt): bằng nhau trước/sau ⇒ scanner không ghi gì vào đó. */
async function anhChupTien() {
  const ra: Record<string, unknown> = {};
  for (const b of BANG_TIEN) {
    const dl = (db as unknown as Record<string, { findMany: (a?: unknown) => Promise<unknown[]> }>)[b]!;
    const rows = await dl.findMany();
    // Chỉ giữ dòng MANG DẤU của bộ này (mọi bảng fixture đều có id/khoá trỏ về tiền tố), sắp theo chuỗi để so ổn định.
    ra[b] = rows.map((r) => JSON.stringify(r)).filter((x) => x.includes(T)).sort();
  }
  return ra;
}

/** Bảng chiếu của các đơn fixture, bỏ nhịp tim + mốc sửa (đổi mỗi lượt) — dùng so "không đổi gì". */
async function bangChieu() {
  const rows = await db.hoaDonNghiaVu.findMany({ where: { orderId: { startsWith: T } }, orderBy: [{ nguonLoai: "asc" }, { nguonId: "asc" }] });
  return rows.map(({ quetLanCuoiLuc: _q, updatedAt: _u, createdAt: _c, id: _i, ...r }) => r);
}
const ngoaiLe = () => db.hoaDonNgoaiLe.findMany({ where: { orderId: { startsWith: T } }, orderBy: { dedupeKey: "asc" } });
const quet = (orderIds: string[], o: { now?: Date; conThoiGian?: () => boolean; coSo?: string[] } = {}) =>
  quetCacDon({ orderIds, now: o.now ?? NOW, conThoiGian: o.conThoiGian ?? luon, coSoDuocQuet: new Set(o.coSo ?? [CS1, CS2]) });

beforeEach(async () => {
  if (!RUN_DB_TESTS) return;
  h.notify.mockClear();
  await dungFixture();
});
afterAll(async () => {
  if (RUN_DB_TESTS) await don();
});

const chay = RUN_DB_TESTS ? describe : describe.skip;

chay("[QND-01] lượt đầu: bảng chiếu ghi ĐÚNG cơ sở, ĐÚNG số tiền, ĐÚNG ngày", () => {
  it("mỗi khoản thu ⇒ MỘT dòng, mang cơ sở của ĐƠN, số ròng, ngày thu lịch VN; orgUnitId tự điền; pháp nhân để trống (fail-closed)", async () => {
    const kq = await quet([DON1, DON2]);
    expect(kq.loiDon).toBe(0);
    const rows = await db.hoaDonNghiaVu.findMany({ where: { orderId: { startsWith: T } }, orderBy: { nguonId: "asc" } });
    expect(rows.map((r) => r.nguonId)).toEqual([P1, P2, P3]);
    const theo = new Map(rows.map((r) => [r.nguonId, r]));
    expect(theo.get(P1)).toMatchObject({ centerId: CS1, orgUnitId: OU1, orderId: DON1, nguonLoai: "PAYMENT", loai: "THU_TIEN", trangThai: "CHO_XUAT", soTienSnapshot: 8_976_000, legalEntityId: null, hoaDonId: null, phienBan: 1 });
    expect(theo.get(P2)).toMatchObject({ centerId: CS1, soTienSnapshot: 4_488_000 });
    expect(theo.get(P3)).toMatchObject({ centerId: CS2, orgUnitId: OU2, orderId: DON2, soTienSnapshot: 6_732_000 });
    // 03:00Z ngày 30/10 = 10:00 giờ VN cùng ngày — cột @db.Date đọc ở nửa đêm UTC.
    expect(theo.get(P1)!.ngayPhatSinh.toISOString().slice(0, 10)).toBe("2026-10-30");
    // Thu khuya (18:30Z) là 01:30 ngày 31 theo giờ VN: ngày phát sinh theo lịch VN, không phải UTC.
    expect(theo.get(P2)!.ngayPhatSinh.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(theo.get(P1)!.sourceHash).toMatch(/^[0-9a-f]{32}$/);
    expect(kq.tao).toBe(3);
  });

  it("[QND-01b] cô lập cơ sở: quét RIÊNG đơn CS2 thì dòng CS1 không được tạo / sửa (đối chứng: quét CS1 mới có)", async () => {
    await quet([DON2]);
    expect((await db.hoaDonNghiaVu.findMany({ where: { orderId: DON1 } })).length).toBe(0);
    expect((await db.hoaDonNghiaVu.findMany({ where: { orderId: DON2 } })).length).toBe(1);
    await quet([DON1]);
    expect((await db.hoaDonNghiaVu.findMany({ where: { orderId: DON1 } })).length).toBe(2);
    expect((await db.hoaDonNghiaVu.findMany({ where: { orderId: { startsWith: T }, centerId: CS1 } })).every((r) => r.orderId === DON1)).toBe(true);
    expect((await db.hoaDonNghiaVu.findMany({ where: { orderId: { startsWith: T }, centerId: CS2 } })).every((r) => r.orderId === DON2)).toBe(true);
  });
});

chay("[QND-02] IDEMPOTENT: chạy lại bao nhiêu lần cũng cùng kết quả", () => {
  it("lượt hai không tạo / sửa / mở / đóng gì; phienBan giữ nguyên; chỉ nhịp tim đổi", async () => {
    await tienMat(P4, DON1, 3_000_000, CS2); // gây một ngoại lệ để idempotent phủ cả ngoại lệ
    const k1 = await quet([DON1, DON2]);
    expect(k1.tao).toBe(4);
    const truocChieu = await bangChieu();
    const truocNl = (await ngoaiLe()).map((n) => ({ ...n, updatedAt: null }));
    const k2 = await quet([DON1, DON2], { now: new Date("2026-11-02T03:10:00Z") });
    expect(k2).toMatchObject({ tao: 0, capNhat: 0, ngoaiLeMo: 0, ngoaiLeDong: 0, loiDon: 0 });
    expect(await bangChieu()).toEqual(truocChieu);
    expect((await ngoaiLe()).map((n) => ({ ...n, updatedAt: null }))).toEqual(truocNl);
    // Nhịp tim ĐÃ đi (đối chứng: lượt hai có chạy thật, không phải bị bỏ qua).
    const tim = await db.hoaDonNghiaVu.findMany({ where: { orderId: DON1 }, select: { quetLanCuoiLuc: true } });
    expect(tim.every((r) => r.quetLanCuoiLuc.toISOString() === "2026-11-02T03:10:00.000Z")).toBe(true);
  });

  it("[QND-02b] bảng chiếu KHÔNG phải sổ tiền: sửa số tiền của khoản CHƯA gắn hoá đơn ⇒ lượt sau cập nhật ảnh chụp + băm + tăng phienBan", async () => {
    await quet([DON1]);
    const cu = await db.hoaDonNghiaVu.findUniqueOrThrow({ where: { nguonLoai_nguonId: { nguonLoai: "PAYMENT", nguonId: P2 } } });
    await db.payment.update({ where: { id: P2 }, data: { amount: 4_000_000 } });
    const kq = await quet([DON1]);
    expect(kq.capNhat).toBe(1);
    const moi = await db.hoaDonNghiaVu.findUniqueOrThrow({ where: { nguonLoai_nguonId: { nguonLoai: "PAYMENT", nguonId: P2 } } });
    expect(moi.soTienSnapshot).toBe(4_000_000);
    expect(moi.sourceHash).not.toBe(cu.sourceHash);
    expect(moi.phienBan).toBe(cu.phienBan + 1);
  });
});

chay("[QND-03] ĐỒNG THỜI: nhiều lượt chạy chồng nhau hội tụ về MỘT kết quả", () => {
  it("ba lượt song song trên cùng tập đơn ⇒ không lỗi, không dòng trùng, không ngoại lệ trùng, đúng số dòng", async () => {
    await tienMat(P4, DON1, 3_000_000, CS2);
    const ra = await Promise.all([quet([DON1, DON2]), quet([DON1, DON2]), quet([DON1, DON2])]);
    expect(ra.map((r) => r.loiDon)).toEqual([0, 0, 0]);
    const rows = await db.hoaDonNghiaVu.findMany({ where: { orderId: { startsWith: T } } });
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => `${r.nguonLoai}:${r.nguonId}`)).size).toBe(4);
    const nl = await ngoaiLe();
    expect(new Set(nl.map((n) => n.dedupeKey)).size).toBe(nl.length);
    // Tổng số tạo của 3 lượt = số dòng thật (không lượt nào "tạo" mà thực ra bị bỏ qua mà vẫn đếm).
    expect(ra.reduce((s, r) => s + r.tao, 0)).toBe(4);
    // Kết quả giống hệt MỘT lượt chạy sạch.
    const chung = await bangChieu();
    await dungFixture();
    await tienMat(P4, DON1, 3_000_000, CS2);
    await quet([DON1, DON2]);
    expect(await bangChieu()).toEqual(chung);
  });
});

chay("[QND-04] KHÔNG chạm sổ tiền, đơn, hoá đơn", () => {
  it("trước/sau một lượt quét (có ngoại lệ, có cập nhật) các bảng Order·Payment·HoaDonDienTu·HoaDonKhoan·PaymentRequest·PaymentAllocation y hệt từng byte", async () => {
    await tienMat(P4, DON1, 3_000_000, CS2);
    await db.hoaDonDienTu.create({ data: { id: HD1, orderId: DON2, centerId: CS2, trangThai: "DA_XAC_NHAN", tongTien: 6_732_000, taoBoiId: `${T}kt`, xacNhanLuc: new Date("2026-11-01T01:00:00Z") } });
    await db.hoaDonKhoan.create({ data: { hoaDonId: HD1, paymentId: P3, soTien: 6_732_000, hieuLuc: true } });
    const truoc = await anhChupTien();
    expect((truoc.payment as string[]).some((x) => x.includes(P1))).toBe(true); // ảnh chụp không rỗng — đừng để so hai thứ rỗng
    expect((truoc.hoaDonKhoan as string[]).length).toBeGreaterThan(0);
    await quet([DON1, DON2]);
    await quet([DON1, DON2], { now: new Date("2026-11-02T03:10:00Z") });
    expect(await anhChupTien()).toEqual(truoc);
    // Đối chứng dương: scanner THẬT SỰ đã ghi (bảng chiếu có dòng) — ảnh chụp bằng nhau không phải vì nó không làm gì.
    expect(await db.hoaDonNghiaVu.count({ where: { orderId: { startsWith: T } } })).toBe(4);
  });
});

chay("[QND-05] chiếu trạng thái theo hoá đơn, không sửa số tiền của dòng đã xuất", () => {
  it("khoản đã nằm trong hoá đơn DA_XAC_NHAN ⇒ dòng DA_XUAT + hoaDonId; sau đó số ròng đổi ⇒ dòng KHÔNG đổi ảnh chụp", async () => {
    await db.hoaDonDienTu.create({ data: { id: HD1, orderId: DON2, centerId: CS2, trangThai: "DA_XAC_NHAN", tongTien: 6_732_000, taoBoiId: `${T}kt`, xacNhanLuc: new Date("2026-11-01T01:00:00Z"), kyHieu: "1C26TSR", soHoaDon: "127" } });
    await db.hoaDonKhoan.create({ data: { hoaDonId: HD1, paymentId: P3, soTien: 6_732_000, hieuLuc: true } });
    await quet([DON2]);
    const r = await db.hoaDonNghiaVu.findUniqueOrThrow({ where: { nguonLoai_nguonId: { nguonLoai: "PAYMENT", nguonId: P3 } } });
    expect(r).toMatchObject({ trangThai: "DA_XUAT", hoaDonId: HD1, soTienSnapshot: 6_732_000 });
    // Hoàn tiền sau xuất: một dòng ÂM trỏ về khoản gốc, tạo SAU mốc xác nhận ⇒ nghĩa vụ điều chỉnh MỚI + ngoại lệ KHẨN; dòng gốc giữ nguyên.
    await db.payment.create({
      data: { id: `${T}p5`, orderId: DON2, amount: -1_234_567, method: "CASH", paidDate: new Date("2026-11-02T01:30:00Z"), saleStatus: DA_GHI, accountantStatus: "CONFIRMED", centerId: CS2, adjustmentOfId: P3, updatedAt: MOI_CAP_NHAT, createdAt: new Date("2026-11-02T01:30:00Z") },
    });
    await quet([DON2]);
    const goc = await db.hoaDonNghiaVu.findUniqueOrThrow({ where: { nguonLoai_nguonId: { nguonLoai: "PAYMENT", nguonId: P3 } } });
    expect(goc).toMatchObject({ trangThai: "DA_XUAT", soTienSnapshot: 6_732_000, hoaDonId: HD1, phienBan: r.phienBan });
    const dc = await db.hoaDonNghiaVu.findUniqueOrThrow({ where: { nguonLoai_nguonId: { nguonLoai: "PAYMENT", nguonId: `${T}p5` } } });
    expect(dc).toMatchObject({ loai: "DIEU_CHINH_GIAM", trangThai: "CHO_QUYET", lyDoCho: "DIEU_CHINH_CHUA_CHOT", soTienSnapshot: 1_234_567, nghiaVuGocId: goc.id, hoaDonId: HD1 });
    expect((await ngoaiLe()).map((n) => [n.loai, n.muc])).toContainEqual(["HOAN_TIEN_SAU_XUAT", "KHAN"]);
  });

  it("hoá đơn bị THAY THẾ (khoản nhả hieuLuc=false) ⇒ dòng quay về CHO_XUAT, hoaDonId null", async () => {
    await db.hoaDonDienTu.create({ data: { id: HD1, orderId: DON2, centerId: CS2, trangThai: "DA_XAC_NHAN", tongTien: 6_732_000, taoBoiId: `${T}kt`, xacNhanLuc: new Date("2026-11-01T01:00:00Z") } });
    await db.hoaDonKhoan.create({ data: { hoaDonId: HD1, paymentId: P3, soTien: 6_732_000, hieuLuc: true } });
    await quet([DON2]);
    await db.hoaDonDienTu.update({ where: { id: HD1 }, data: { trangThai: "THAY_THE", huyLuc: new Date("2026-11-02T02:00:00Z"), huyBoiId: `${T}kt`, huyLyDo: "Thay thế hoá đơn sai thông tin người mua" } });
    await db.hoaDonKhoan.update({ where: { hoaDonId_paymentId: { hoaDonId: HD1, paymentId: P3 } }, data: { hieuLuc: false } });
    await quet([DON2]);
    expect(await db.hoaDonNghiaVu.findUniqueOrThrow({ where: { nguonLoai_nguonId: { nguonLoai: "PAYMENT", nguonId: P3 } } })).toMatchObject({ trangThai: "CHO_XUAT", hoaDonId: null });
  });
});

chay("[QND-06] nguồn biến mất", () => {
  it("khoản CHƯA xuất bị xoá mềm ⇒ dòng MAT_NGUON, không ngoại lệ; đối chứng: khoản còn thì dòng còn CHO_XUAT", async () => {
    await quet([DON1]);
    await db.payment.update({ where: { id: P2 }, data: { deletedAt: new Date("2026-11-02T02:00:00Z") } });
    await quet([DON1]);
    const theo = new Map((await db.hoaDonNghiaVu.findMany({ where: { orderId: DON1 } })).map((r) => [r.nguonId, r]));
    expect(theo.get(P2)).toMatchObject({ trangThai: "MAT_NGUON", lyDoCho: "NGUON_MAT" });
    expect(theo.get(P1)).toMatchObject({ trangThai: "CHO_XUAT" });
    expect((await ngoaiLe()).map((n) => n.loai)).not.toContain("NGUON_MAT");
  });

  it("khoản ĐÃ có hoá đơn mà bị xoá mềm ⇒ dòng KHÔNG sửa, ngoại lệ NGUON_MAT mức KHẨN gắn hoá đơn", async () => {
    await db.hoaDonDienTu.create({ data: { id: HD1, orderId: DON2, centerId: CS2, trangThai: "DA_XAC_NHAN", tongTien: 6_732_000, taoBoiId: `${T}kt`, xacNhanLuc: new Date("2026-11-01T01:00:00Z") } });
    await db.hoaDonKhoan.create({ data: { hoaDonId: HD1, paymentId: P3, soTien: 6_732_000, hieuLuc: true } });
    await quet([DON2]);
    await db.payment.update({ where: { id: P3 }, data: { deletedAt: new Date("2026-11-02T02:00:00Z") } });
    await quet([DON2]);
    expect(await db.hoaDonNghiaVu.findUniqueOrThrow({ where: { nguonLoai_nguonId: { nguonLoai: "PAYMENT", nguonId: P3 } } })).toMatchObject({ trangThai: "DA_XUAT", hoaDonId: HD1 });
    const nl = await ngoaiLe();
    expect(nl).toHaveLength(1);
    expect(nl[0]).toMatchObject({ loai: "NGUON_MAT", muc: "KHAN", centerId: CS2, hoaDonId: HD1, orderId: DON2, trangThai: "MO" });
  });
});

chay("[QND-07] khoản thu ở cơ sở KHÁC với đơn", () => {
  it("scanner không đề xuất: dòng CHO_QUYET / KHOAN_KHAC_CO_SO + ngoại lệ PHAP_NHAN_KHAC_NOI_NHAN_TIEN thuộc cơ sở của ĐƠN; khoản cùng cơ sở không bị ảnh hưởng", async () => {
    await tienMat(P4, DON1, 3_000_000, CS2);
    await quet([DON1]);
    const theo = new Map((await db.hoaDonNghiaVu.findMany({ where: { orderId: DON1 } })).map((r) => [r.nguonId, r]));
    expect(theo.get(P4)).toMatchObject({ trangThai: "CHO_QUYET", lyDoCho: "KHOAN_KHAC_CO_SO", centerId: CS1 });
    expect(theo.get(P1)).toMatchObject({ trangThai: "CHO_XUAT", lyDoCho: null });
    const nl = await ngoaiLe();
    expect(nl).toHaveLength(1);
    expect(nl[0]).toMatchObject({ loai: "PHAP_NHAN_KHAC_NOI_NHAN_TIEN", muc: "CAN_XU_LY", centerId: CS1, orderId: DON1, trangThai: "MO", dedupeKey: `PHAP_NHAN_KHAC_NOI_NHAN_TIEN:PAYMENT:${P4}` });
    expect(nl[0]!.nghiaVuId).toBe(theo.get(P4)!.id);
  });

  it("[QND-07d] kế toán BỎ QUA có lý do ⇒ nguyên nhân còn vẫn KHÔNG mở lại; ĐÃ XỬ LÝ mà nguyên nhân còn ⇒ mở lại (đối chứng)", async () => {
    await tienMat(P4, DON1, 3_000_000, CS2);
    await quet([DON1]);
    const key = `PHAP_NHAN_KHAC_NOI_NHAN_TIEN:PAYMENT:${P4}`;
    await db.hoaDonNgoaiLe.updateMany({ where: { dedupeKey: key }, data: { trangThai: "BO_QUA_CO_LY_DO", nguoiXuLyId: `${T}kt`, lyDoXuLy: "Khoản thu hộ đã được kế toán Hội sở xác nhận" } });
    await quet([DON1], { now: new Date("2026-11-02T03:10:00Z") });
    expect((await ngoaiLe()).map((n) => n.trangThai)).toEqual(["BO_QUA_CO_LY_DO"]);
    // Cùng lượt có việc ghi KHÁC (số ròng của một khoản đổi) ⇒ giao dịch ghi thật sự mở; lớp lập-lại-dưới-khoá cũng phải biết khoá đã bỏ qua.
    await db.payment.update({ where: { id: P1 }, data: { amount: 8_000_000 } });
    const k = await quet([DON1], { now: new Date("2026-11-02T03:15:00Z") });
    expect(k.capNhat).toBe(1);
    expect((await ngoaiLe()).map((n) => n.trangThai)).toEqual(["BO_QUA_CO_LY_DO"]);
    // Đối chứng: cùng tình huống nhưng người ta chọn "đã xử lý" (không phải bỏ qua) ⇒ nguyên nhân còn thì mở lại một ngoại lệ MỚI.
    await db.hoaDonNgoaiLe.updateMany({ where: { dedupeKey: key }, data: { trangThai: "DA_XU_LY", lyDoXuLy: "Đã xử lý" } });
    await quet([DON1], { now: new Date("2026-11-02T03:20:00Z") });
    expect((await ngoaiLe()).map((n) => n.trangThai).sort()).toEqual(["DA_XU_LY", "MO"]);
  });

  it("[QND-07c] khoản thu CHƯA có cơ sở (centerId NULL, dữ liệu cũ) KHÔNG bị coi là 'khác cơ sở' — không đoán; đối chứng: khoản ghi cơ sở khác thì bị", async () => {
    await tienMat(P4, DON1, 3_000_000, null);
    await quet([DON1]);
    expect(await db.hoaDonNghiaVu.findUniqueOrThrow({ where: { nguonLoai_nguonId: { nguonLoai: "PAYMENT", nguonId: P4 } } })).toMatchObject({ trangThai: "CHO_XUAT", lyDoCho: null });
    expect(await ngoaiLe()).toEqual([]);
    await db.payment.update({ where: { id: P4 }, data: { centerId: CS2 } });
    await quet([DON1]);
    expect(await db.hoaDonNghiaVu.findUniqueOrThrow({ where: { nguonLoai_nguonId: { nguonLoai: "PAYMENT", nguonId: P4 } } })).toMatchObject({ trangThai: "CHO_QUYET", lyDoCho: "KHOAN_KHAC_CO_SO" });
  });

  it("hết điều kiện (khoản được sửa về đúng cơ sở) ⇒ TỰ ĐÓNG ngoại lệ, dòng về CHO_XUAT; ngoại lệ DANG_XU_LY thì KHÔNG bị đóng", async () => {
    await tienMat(P4, DON1, 3_000_000, CS2);
    await quet([DON1]);
    await db.hoaDonNgoaiLe.updateMany({ where: { orderId: DON1 }, data: { trangThai: "DANG_XU_LY", nguoiXuLyId: `${T}kt` } });
    await db.payment.update({ where: { id: P4 }, data: { centerId: CS1 } });
    await quet([DON1]);
    expect((await ngoaiLe())[0]!.trangThai).toBe("DANG_XU_LY"); // có người đang làm: scanner không đóng thay
    expect(await db.hoaDonNghiaVu.findUniqueOrThrow({ where: { nguonLoai_nguonId: { nguonLoai: "PAYMENT", nguonId: P4 } } })).toMatchObject({ trangThai: "CHO_XUAT", lyDoCho: null });
    // Đối chứng: cùng tình huống nhưng ngoại lệ còn MO ⇒ được tự đóng.
    await db.hoaDonNgoaiLe.updateMany({ where: { orderId: DON1 }, data: { trangThai: "MO", nguoiXuLyId: null } });
    await quet([DON1]);
    const nl = (await ngoaiLe())[0]!;
    expect(nl.trangThai).toBe("DA_XU_LY");
    expect(nl.lyDoXuLy).toBeTruthy();
    expect(nl.nguoiXuLyId).toBeNull();
  });
});

chay("[QND-08] LỖI và DỪNG giữa chừng: lượt sau hội tụ", () => {
  it("dữ liệu chiếu sai cơ sở của MỘT đơn ⇒ đơn đó lỗi (đếm loiDon), đơn kia vẫn xong; sửa dữ liệu rồi chạy lại ⇒ hội tụ", async () => {
    await db.hoaDonNghiaVu.create({
      data: { id: `${T}nv-sai`, centerId: CS2, orderId: DON1, nguonLoai: "PAYMENT", nguonId: P1, loai: "THU_TIEN", trangThai: "CHO_XUAT", ngayPhatSinh: new Date("2026-10-30T00:00:00Z"), soTienSnapshot: 8_976_000, sourceHash: "x" },
    });
    const k1 = await quet([DON1, DON2]);
    expect(k1.loiDon).toBe(1);
    expect(await db.hoaDonNghiaVu.count({ where: { orderId: DON2 } })).toBe(1); // đơn lành vẫn được ghi
    expect(await db.hoaDonNghiaVu.count({ where: { orderId: DON1, id: { not: `${T}nv-sai` } } })).toBe(0); // đơn lỗi: không ghi nửa chừng
    await db.hoaDonNghiaVu.deleteMany({ where: { id: `${T}nv-sai` } });
    const k2 = await quet([DON1, DON2]);
    expect(k2.loiDon).toBe(0);
    const hoiTu = await bangChieu();
    await dungFixture();
    await quet([DON1, DON2]);
    expect(await bangChieu()).toEqual(hoiTu);
  });

  it("hết thời gian giữa lô ⇒ dừng sớm (dungSom), không đơn nào ghi dở; lượt sau làm nốt và kết quả = một lượt chạy sạch", async () => {
    let con = 1;
    const k1 = await quet([DON1, DON2], { conThoiGian: () => con-- > 0 });
    expect(k1.dungSom).toBe(true);
    expect(k1.don).toBe(1);
    const dangDo = await db.hoaDonNghiaVu.count({ where: { orderId: { startsWith: T } } });
    expect(dangDo === 2 || dangDo === 1).toBe(true); // chỉ MỘT đơn được xong, đơn kia chưa đụng
    const k2 = await quet([DON1, DON2]);
    expect(k2.dungSom).toBe(false);
    const hoiTu = await bangChieu();
    await dungFixture();
    await quet([DON1, DON2]);
    expect(await bangChieu()).toEqual(hoiTu);
  });

  it("giao dịch ghi bị ngắt (mất kết nối) ⇒ KHÔNG ghi nửa đơn; lượt sau hội tụ", async () => {
    const that = db.$transaction.bind(db);
    const spy = vi.spyOn(db, "$transaction").mockImplementationOnce((async () => {
      throw new Error("mất kết nối giả lập");
    }) as never);
    const k1 = await quet([DON1, DON2]);
    spy.mockRestore();
    expect(that).toBeTypeOf("function");
    expect(k1.loiDon).toBe(1);
    const k2 = await quet([DON1, DON2]);
    expect(k2.loiDon).toBe(0);
    expect(await db.hoaDonNghiaVu.count({ where: { orderId: { startsWith: T } } })).toBe(3);
  });
});

chay("[QND-09] cờ TẮT ⇒ không chạm bảng nào của Hub", () => {
  it("tắt scanner HOẶC tắt màn ⇒ chayQuetBong trả null, 0 dòng, 0 chuông; đối chứng: bật cả hai thì chạy", async () => {
    for (const [man, qt] of [[true, false], [false, true], [false, false]] as const) {
      await batCo(man, qt);
      expect(await chayQuetBong({ now: NOW, conThoiGian: luon })).toBeNull();
      expect(await db.hoaDonNghiaVu.count({ where: { orderId: { startsWith: T } } })).toBe(0);
      expect(await db.hoaDonNgoaiLe.count({ where: { orderId: { startsWith: T } } })).toBe(0);
    }
    expect(h.notify).not.toHaveBeenCalled();
    await batCo(true, true);
    const kq = await chayQuetBong({ now: NOW, conThoiGian: luon });
    expect(kq).not.toBeNull();
    expect(await db.hoaDonNghiaVu.count({ where: { orderId: { startsWith: T } } })).toBeGreaterThan(0);
  });
});

chay("[QND-10] chọn lô đơn — KIỂM TỪNG TẦNG (chonDonCanQuet gộp ba tầng nên tầng này che tầng kia)", () => {
  it("tầng thay đổi: biên cửa sổ 72 giờ — 71h59' trước ⇒ CÓ, 72h01' trước ⇒ KHÔNG (đối chứng cùng đơn, cùng ca)", async () => {
    await db.payment.updateMany({ where: { orderId: DON1 }, data: { updatedAt: new Date("2026-10-30T03:01:00Z") } }); // NOW − 71h59'
    await db.payment.updateMany({ where: { orderId: DON2 }, data: { updatedAt: new Date("2026-10-30T02:59:00Z") } }); // NOW − 72h01'
    const u = await docUngVienQuet(NOW, [CS1, CS2]);
    expect(u.thayDoi).toContain(DON1);
    expect(u.thayDoi).not.toContain(DON2);
  });

  it("tầng thay đổi: HOÁ ĐƠN đổi trong cửa sổ cũng kéo đơn vào (khoản thì đã cũ); khoản bị XOÁ MỀM trong cửa sổ vẫn kéo đơn vào", async () => {
    await db.payment.updateMany({ where: { orderId: { startsWith: T } }, data: { updatedAt: CU } });
    expect((await docUngVienQuet(NOW, [CS1, CS2])).thayDoi).not.toContain(DON2);
    await db.hoaDonDienTu.create({ data: { id: HD1, orderId: DON2, centerId: CS2, trangThai: "NHAP", tongTien: 6_732_000, taoBoiId: `${T}kt`, updatedAt: MOI_CAP_NHAT } });
    expect((await docUngVienQuet(NOW, [CS1, CS2])).thayDoi).toContain(DON2);
    await db.payment.update({ where: { id: P1 }, data: { deletedAt: new Date("2026-11-02T02:00:00Z"), updatedAt: MOI_CAP_NHAT } });
    expect((await docUngVienQuet(NOW, [CS1, CS2])).thayDoi).toContain(DON1);
  });

  it("tầng chưa ổn định: dòng CHO_XUAT quá 60 phút chưa quét ⇒ CÓ; vừa quét 1 phút trước ⇒ KHÔNG", async () => {
    await db.payment.updateMany({ where: { orderId: { startsWith: T } }, data: { updatedAt: CU } });
    await quet([DON1, DON2]);
    await db.hoaDonNghiaVu.updateMany({ where: { orderId: DON1 }, data: { quetLanCuoiLuc: new Date("2026-11-02T01:59:00Z") } }); // NOW − 61'
    await db.hoaDonNghiaVu.updateMany({ where: { orderId: DON2 }, data: { quetLanCuoiLuc: new Date("2026-11-02T02:59:00Z") } }); // NOW − 1'
    const u = await docUngVienQuet(NOW, [CS1, CS2]);
    expect(u.chuaOnDinh).toContain(DON1);
    expect(u.chuaOnDinh).not.toContain(DON2);
  });

  it("tầng chưa ổn định: dòng ĐÃ ỔN ĐỊNH (DA_XUAT) quá hạn kiểm lại thì KHÔNG vào tầng này (đối chứng của ca trên)", async () => {
    await db.payment.updateMany({ where: { orderId: { startsWith: T } }, data: { updatedAt: CU } });
    await db.hoaDonDienTu.create({ data: { id: HD1, orderId: DON2, centerId: CS2, trangThai: "DA_XAC_NHAN", tongTien: 6_732_000, taoBoiId: `${T}kt`, xacNhanLuc: new Date("2026-11-01T01:00:00Z"), updatedAt: CU } });
    await db.hoaDonKhoan.create({ data: { hoaDonId: HD1, paymentId: P3, soTien: 6_732_000, hieuLuc: true } });
    await quet([DON1, DON2]);
    await db.hoaDonNghiaVu.updateMany({ where: { orderId: { startsWith: T } }, data: { quetLanCuoiLuc: new Date("2026-11-02T00:00:00Z") } });
    const u = await docUngVienQuet(NOW, [CS1, CS2]);
    expect(u.chuaOnDinh).toContain(DON1); // CHO_XUAT
    expect(u.chuaOnDinh).not.toContain(DON2); // DA_XUAT
  });

  it("tầng quét vòng: đơn có khoản mà CHƯA có dòng chiếu nào ⇒ CÓ dù khoản đã cũ; quét xong (đã có dòng) ⇒ rơi sang vòng quét mọi đơn", async () => {
    await db.payment.updateMany({ where: { orderId: { startsWith: T } }, data: { updatedAt: CU } });
    const truoc = await docUngVienQuet(NOW, [CS1, CS2]);
    expect(truoc.quetVong).toEqual(expect.arrayContaining([DON1, DON2]));
    expect(truoc.thayDoi).not.toContain(DON1);
    await quet([DON1, DON2]);
    const sau = await docUngVienQuet(NOW, [CS1, CS2]);
    // Khi KHÔNG còn đơn nào chưa có dòng, tầng này quét vòng mọi đơn có khoản (để phát hiện trôi) — đơn vừa quét vẫn nằm trong danh sách vòng.
    if (sau.quetVong.length > 0) expect(new Set(sau.quetVong).size).toBe(sau.quetVong.length);
  });

  it("chonDonCanQuet gộp: đơn mới đổi đứng ĐẦU, không trùng, trong trần 60", async () => {
    await db.payment.updateMany({ where: { orderId: DON2 }, data: { updatedAt: CU } });
    const ds = await chonDonCanQuet(NOW, [CS1, CS2]);
    expect(ds.length).toBeLessThanOrEqual(60);
    expect(new Set(ds).size).toBe(ds.length);
    expect(ds).toContain(DON1);
    expect(ds.indexOf(DON1)).toBeLessThan(40); // thuộc phần dành cho tầng thay đổi — không bị đẩy ra ngoài lô
  });
});

chay("[QND-11] chuông ngoại lệ: đúng người, đúng cơ sở, không PII", () => {
  async function lapNguoi(ten: string, orgUnitId: string) {
    const u = await seedUser({ email: `${ten}@${T}test`, role: "TEACHER", name: ten });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId, roleId: VAI, grantedById: u.id } });
    return u.id;
  }

  it("ngoại lệ ở CS1 chỉ báo người giữ payments:confirm ở CS1 (và Hội sở cha); kế toán CS2 KHÔNG nhận bản CS1 — đối chứng: CS2 có ngoại lệ thì họ nhận", async () => {
    await db.roleDef.create({ data: { id: VAI, code: `${T}vai`, name: "Kế toán QND" } });
    await db.rolePermission.create({ data: { roleId: VAI, action: "payments:confirm", scopeType: "GLOBAL" } });
    const ktCs1 = await lapNguoi("kt-cs1", OU1);
    const ktCs2 = await lapNguoi("kt-cs2", OU2);
    const ktHo = await lapNguoi("kt-ho", OU_HO);
    await tienMat(P4, DON1, 3_000_000, CS2); // ngoại lệ ở CS1 (đơn của CS1)
    await chayQuetBong({ now: NOW, conThoiGian: luon });
    const goi = h.notify.mock.calls.map((c) => c[0]).filter((p) => p.dedupeKey.includes(CS1) || p.dedupeKey.includes(CS2));
    const cs1 = goi.filter((p) => p.dedupeKey.includes(`:${CS1}:`));
    expect(cs1).toHaveLength(1);
    expect([...cs1[0]!.userIds].sort()).toEqual([ktCs1, ktHo].sort());
    expect(cs1[0]!.userIds).not.toContain(ktCs2);
    expect(goi.filter((p) => p.dedupeKey.includes(`:${CS2}:`))).toHaveLength(0);
    expect(`${cs1[0]!.title} ${cs1[0]!.body}`).not.toMatch(/\d{6,}|@|ORD-|0328545331/);
    expect(cs1[0]!.href).toBe("/payments/hoa-don/canh-bao");
    // Đối chứng dương: ngoại lệ ở CS2 ⇒ kế toán CS2 nhận, kế toán CS1 không.
    h.notify.mockClear();
    await tienMat(`${T}p6`, DON2, 1_000_000, CS1);
    await chayQuetBong({ now: new Date("2026-11-02T03:10:00Z"), conThoiGian: luon });
    const cs2 = h.notify.mock.calls.map((c) => c[0]).filter((p) => p.dedupeKey.includes(`:${CS2}:`));
    expect(cs2).toHaveLength(1);
    expect([...cs2[0]!.userIds].sort()).toEqual([ktCs2, ktHo].sort());
    expect(cs2[0]!.userIds).not.toContain(ktCs1);
    // Lượt hai còn ngoại lệ CS1 trong cửa sổ chuông ⇒ bản CS1 được gửi lại, VẪN đúng người của CS1 (thứ tự hai cơ sở trong lượt không được làm lệch người nhận).
    const cs1Lai = h.notify.mock.calls.map((c) => c[0]).filter((p) => p.dedupeKey.includes(`:${CS1}:`));
    expect(cs1Lai).toHaveLength(1);
    expect([...cs1Lai[0]!.userIds].sort()).toEqual([ktCs1, ktHo].sort());
    expect(cs1Lai[0]!.userIds).not.toContain(ktCs2);
    expect(cs1Lai[0]!.dedupeKey).toBe(cs1[0]!.dedupeKey); // cùng khoá + cùng nội dung ⇒ hệ thông báo không rung lại
  });

  it("không ngoại lệ mới ⇒ không chuông (đối chứng của ca trên)", async () => {
    await db.roleDef.create({ data: { id: VAI, code: `${T}vai`, name: "Kế toán QND" } });
    await db.rolePermission.create({ data: { roleId: VAI, action: "payments:confirm", scopeType: "GLOBAL" } });
    await lapNguoi("kt-cs1", OU1);
    await chayQuetBong({ now: NOW, conThoiGian: luon });
    expect(h.notify.mock.calls.map((c) => c[0]).filter((p) => p.dedupeKey.includes(T))).toHaveLength(0);
  });

  it("lỗi gửi chuông KHÔNG làm hỏng lượt quét (dòng + ngoại lệ vẫn được ghi, kết quả báo loiThongBao)", async () => {
    await db.roleDef.create({ data: { id: VAI, code: `${T}vai`, name: "Kế toán QND" } });
    await db.rolePermission.create({ data: { roleId: VAI, action: "payments:confirm", scopeType: "GLOBAL" } });
    await lapNguoi("kt-cs1", OU1);
    await tienMat(P4, DON1, 3_000_000, CS2);
    h.notify.mockRejectedValueOnce(new Error("hệ thông báo chết"));
    const kq = await chayQuetBong({ now: NOW, conThoiGian: luon });
    expect(kq).not.toBeNull();
    expect(kq!.loiThongBao).toBeGreaterThanOrEqual(1);
    expect(await db.hoaDonNghiaVu.count({ where: { orderId: DON1 } })).toBe(3);
    expect(await db.hoaDonNgoaiLe.count({ where: { orderId: DON1 } })).toBe(1);
  });
});

chay("[QND-12] ngoại lệ do đường phát hành báo TỨC THỜI không bị scanner đóng / sửa", () => {
  it("TU_CHOI_NHA_CUNG_CAP (đường tức thời) vẫn MỞ sau nhiều lượt quét — scanner chỉ tự đóng loại do chính nó sinh; đối chứng: ngoại lệ của scanner hết điều kiện thì ĐƯỢC đóng", async () => {
    await db.hoaDonDienTu.create({ data: { id: HD1, orderId: DON2, centerId: CS2, trangThai: "LOI_PHAT_HANH", tongTien: 6_732_000, taoBoiId: `${T}kt` } });
    expect((await baoNgoaiLeTucThoi({ hoaDonId: HD1, loai: "TU_CHOI_NHA_CUNG_CAP", khoa: "ref-1", now: NOW })).ket).toBe("TAO");
    // Một ngoại lệ DO SCANNER sinh, sẵn ở đơn đó, không còn điều kiện nào giữ nó ⇒ lượt quét phải đóng nó (đối chứng dương của việc "đóng").
    await db.hoaDonNgoaiLe.create({
      data: { id: `${T}nl-scanner`, centerId: CS2, orderId: DON2, loai: "TIEN_THUA", muc: "CAN_XU_LY", trangThai: "MO", dedupeKey: `TIEN_THUA:${T}khong-con-dieu-kien` },
    });
    await quet([DON2]);
    await quet([DON2], { now: new Date("2026-11-02T03:10:00Z") });
    const nl = await db.hoaDonNgoaiLe.findMany({ where: { orderId: DON2 }, orderBy: { loai: "asc" } });
    const tuChoi = nl.find((x) => x.loai === "TU_CHOI_NHA_CUNG_CAP");
    expect(tuChoi).toMatchObject({ trangThai: "MO", lyDoXuLy: null, hoaDonId: HD1 });
    expect(nl.find((x) => x.id === `${T}nl-scanner`)).toMatchObject({ trangThai: "DA_XU_LY" });
  });
});

chay("[QND-13] thí điểm THEO CƠ SỞ: scanner chỉ quét, ghi và báo cơ sở đã được bật", () => {
  const batRieng = (orgUnitId: string, value = true) =>
    db.centerSetting.upsert({ where: { orgUnitId_key: { orgUnitId, key: "hoaDon.hubThiDiem" } }, create: { orgUnitId, key: "hoaDon.hubThiDiem", valueJson: value }, update: { valueJson: value } });
  async function lapNguoi(ten: string, orgUnitId: string) {
    const u = await seedUser({ email: `${ten}@${T}test`, role: "TEACHER", name: ten });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId, roleId: VAI, grantedById: u.id } });
    return u.id;
  }
  const dongTheoDon = (orderId: string) => db.hoaDonNghiaVu.count({ where: { orderId } });
  const goiCuaBoNay = () => h.notify.mock.calls.map((c) => c[0]).filter((p) => p.dedupeKey.includes(T));

  it("mức toàn hệ TẮT + chỉ CS1 bật riêng ⇒ chỉ đơn CS1 có dòng chiếu / ngoại lệ / chuông; CS2 KHÔNG có gì; đối chứng: bật thêm CS2 ⇒ đơn CS2 cũng được quét", async () => {
    await db.roleDef.create({ data: { id: VAI, code: `${T}vai`, name: "Kế toán QND" } });
    await db.rolePermission.create({ data: { roleId: VAI, action: "payments:confirm", scopeType: "GLOBAL" } });
    const ktCs1 = await lapNguoi("kt-cs1", OU1);
    const ktCs2 = await lapNguoi("kt-cs2", OU2);
    await tienMat(P4, DON1, 3_000_000, CS2); // ngoại lệ ở CS1
    await tienMat(`${T}p6`, DON2, 1_000_000, CS1); // ngoại lệ ở CS2 nếu CS2 được quét
    await batCo(true, true, false);
    await batRieng(OU1);
    const kq = await chayQuetBong({ now: NOW, conThoiGian: luon });
    expect(kq).not.toBeNull();
    expect(await dongTheoDon(DON1)).toBeGreaterThan(0);
    expect(await dongTheoDon(DON2)).toBe(0);
    const nl = await db.hoaDonNgoaiLe.findMany({ where: { orderId: { startsWith: T } } });
    expect(nl.length).toBeGreaterThan(0);
    expect([...new Set(nl.map((x) => x.centerId))]).toEqual([CS1]);
    const goi = goiCuaBoNay();
    expect(goi.length).toBeGreaterThan(0);
    for (const p of goi) {
      expect(p.dedupeKey).toContain(CS1);
      expect(p.userIds).toContain(ktCs1);
      expect(p.userIds).not.toContain(ktCs2);
    }
    await batRieng(OU2);
    h.notify.mockClear();
    await chayQuetBong({ now: new Date("2026-11-02T03:10:00Z"), conThoiGian: luon });
    expect(await dongTheoDon(DON2)).toBeGreaterThan(0);
    expect(new Set((await db.hoaDonNgoaiLe.findMany({ where: { orderId: { startsWith: T } } })).map((x) => x.centerId))).toEqual(new Set([CS1, CS2]));
  });

  it("công tắc tổng BẬT nhưng CHƯA cơ sở nào bật thí điểm ⇒ chayQuetBong trả null và KHÔNG chạm bảng nào của Hub; đối chứng: bật một cơ sở ⇒ chạy", async () => {
    await batCo(true, true, false);
    expect(await chayQuetBong({ now: NOW, conThoiGian: luon })).toBeNull();
    expect(await db.hoaDonNghiaVu.count({ where: { orderId: { startsWith: T } } })).toBe(0);
    expect(await db.hoaDonNgoaiLe.count({ where: { orderId: { startsWith: T } } })).toBe(0);
    await batRieng(OU1);
    expect(await chayQuetBong({ now: NOW, conThoiGian: luon })).not.toBeNull();
    expect(await dongTheoDon(DON1)).toBeGreaterThan(0);
  });

  it("lớp thứ hai: `quetCacDon` với tập cơ sở KHÔNG chứa cơ sở của đơn thì không nạp, không ghi; đối chứng: đưa đủ tập thì ghi", async () => {
    await quet([DON1, DON2], { coSo: [CS2] });
    expect(await dongTheoDon(DON1)).toBe(0);
    expect(await dongTheoDon(DON2)).toBeGreaterThan(0);
    await quet([DON1, DON2], { coSo: [] });
    expect(await dongTheoDon(DON1)).toBe(0);
    await quet([DON1], { coSo: [CS1] });
    expect(await dongTheoDon(DON1)).toBeGreaterThan(0);
  });

  it("lô ứng viên chỉ gồm đơn của cơ sở được bật (lớp thứ nhất) — cả đường khoản thu, hoá đơn và đơn chưa có dòng chiếu", async () => {
    await db.hoaDonDienTu.create({ data: { id: HD1, orderId: DON2, centerId: CS2, trangThai: "NHAP", tongTien: 6_732_000, taoBoiId: `${T}kt`, updatedAt: MOI_CAP_NHAT } });
    const u = await docUngVienQuet(NOW, [CS1]);
    const tatCa = [...u.thayDoi, ...u.chuaOnDinh, ...u.quetVong];
    expect(tatCa).toContain(DON1);
    expect(tatCa).not.toContain(DON2);
    const u2 = await docUngVienQuet(NOW, [CS1, CS2]);
    expect([...u2.thayDoi, ...u2.chuaOnDinh, ...u2.quetVong]).toContain(DON2);
  });
});
