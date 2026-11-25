// Ca [NLD-*] — XỬ LÝ NGOẠI LỆ HOÁ ĐƠN (Invoice Hub S12) TRÊN POSTGRES THẬT: đọc theo phạm vi cơ sở, ghi có điều kiện + audit cùng giao dịch, cách ly cơ sở.
//
// Chạy:  DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/finance/hoa-don-ngoai-le-db.test.ts
// Không gọi `resetDb()`: fixture tự dựng + tự dọn theo tiền tố; mỗi ca dựng lại ⇒ xanh khi chạy MỘT MÌNH. Mọi ca "KHÔNG được" kèm đối chứng dương. Đồng hồ không đọc.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docDanhSachNgoaiLe, docTomTatNghiaVu, xuLyNgoaiLe } from "@/lib/finance/hoa-don/ngoai-le-db";
import { locDanhSachNgoaiLe } from "@/lib/finance/hoa-don/ngoai-le-xu-ly";

if (!RUN_DB_TESTS) console.warn(`[NLD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-nld-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const DON1 = `${T}don1`;
const DON2 = `${T}don2`;
const NL1 = `${T}nl1`; // CS1 · NGHI_TRUNG · MO · CAN_XU_LY
const NL2 = `${T}nl2`; // CS1 · NGUON_MAT · MO · KHAN
const NL3 = `${T}nl3`; // CS2 · TIEN_THUA · MO
const NL4 = `${T}nl4`; // CS1 · TIEN_THUA · DA_XU_LY
const LY_DO = "Đã soát cùng kế toán trưởng";

const keToanCoSo = (userId: string, centerId: string): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: [centerId] }],
    visibleCenterIds: [centerId],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;
const keToanHoSo = (userId: string): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: true,
    orgRoles: [],
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ho", roleCode: "HO_ACCOUNTANT", centerScope: "ALL" }],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;
/** Kế toán CS1 KIÊM sale CS2: tầm nhìn `scopedDb` phủ cả hai cơ sở, nhưng phạm vi KẾ TOÁN chỉ CS1 — tách được lớp cổng kế toán khỏi lớp tầm nhìn. */
const keToanCs1KiemSaleCs2 = (userId: string): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [
      { action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: [CS1] },
      { action: "payments:record", scopeType: "GLOBAL", orgUnitId: "ou2", roleCode: "CENTER_SALES_CSM", centerScope: [CS2] },
    ],
    visibleCenterIds: [CS1, CS2],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;

/** Có TẦM NHÌN CS1 qua quyền khác (sale) nhưng KHÔNG phải kế toán: scopedDb cho thấy, cổng kế toán phải chặn. */
const saleCs1 = (userId: string): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [{ action: "payments:record", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_SALES_CSM", centerScope: [CS1] }],
    visibleCenterIds: [CS1],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;

async function don() {
  await db.hoaDonNghiaVu.deleteMany({ where: { id: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { entityType: "HoaDonNgoaiLe", entityId: { startsWith: T } } });
  await db.hoaDonNgoaiLe.deleteMany({ where: { id: { startsWith: T } } });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

const ngoaiLe = (id: string, centerId: string, orderId: string, loai: string, muc: string, trangThai = "MO", o: Record<string, unknown> = {}) =>
  db.hoaDonNgoaiLe.create({
    data: { id, centerId, orderId, loai, muc, trangThai, dedupeKey: `${loai}:${id}`, createdAt: new Date("2026-11-02T01:00:00Z"), ...o },
  });

async function dungFixture() {
  await don();
  for (const [id, ten] of [[CS1, "Cơ sở một NLD"], [CS2, "Cơ sở hai NLD"]] as const) await db.center.create({ data: { id, name: ten, slug: id, address: "x" } });
  for (const [id, ma, coSo] of [[DON1, "ORD-269973-000001", CS1], [DON2, "ORD-269973-000002", CS2]] as const) {
    await db.order.create({ data: { id, code: ma, type: "COURSE", status: "CONFIRMED", customerName: "Phụ huynh NLD", customerPhone: "0328545441", totalAmount: 1_000_000, centerId: coSo } });
  }
  await ngoaiLe(NL1, CS1, DON1, "NGHI_TRUNG", "CAN_XU_LY");
  await ngoaiLe(NL2, CS1, DON1, "NGUON_MAT", "KHAN");
  await ngoaiLe(NL3, CS2, DON2, "TIEN_THUA", "CAN_XU_LY");
  await ngoaiLe(NL4, CS1, DON1, "TIEN_THUA", "CAN_XU_LY", "DA_XU_LY", { nguoiXuLyId: `${T}kt`, lyDoXuLy: "Đã xử lý xong" });
  // Nghĩa vụ hoá đơn do scanner ghi (cho `docTomTatNghiaVu`): CS1 = 2 chờ xuất + 1 đã xuất; CS2 = 1 đang xử lý.
  const nv = (id: string, centerId: string, orderId: string, trangThai: string, quet: string) =>
    db.hoaDonNghiaVu.create({
      data: { id, centerId, orderId, nguonLoai: "PAYMENT", nguonId: `${T}pay-${id}`, loai: "THU_TIEN", trangThai: trangThai as "CHO_XUAT", ngayPhatSinh: new Date("2026-10-01"), soTienSnapshot: 1_000_000, sourceHash: `h-${id}`, quetLanCuoiLuc: new Date(quet) },
    });
  await nv(`${T}nv1`, CS1, DON1, "CHO_XUAT", "2026-11-02T01:00:00Z");
  await nv(`${T}nv2`, CS1, DON1, "CHO_XUAT", "2026-11-02T03:00:00Z");
  await nv(`${T}nv3`, CS1, DON1, "DA_XUAT", "2026-11-02T02:00:00Z");
  await nv(`${T}nv4`, CS2, DON2, "DANG_XU_LY", "2026-11-02T04:00:00Z");
}

beforeEach(async () => {
  if (RUN_DB_TESTS) await dungFixture();
});
afterAll(async () => {
  if (RUN_DB_TESTS) await don();
});

const chay = RUN_DB_TESTS ? describe : describe.skip;
const loc = (sp: Parameters<typeof locDanhSachNgoaiLe>[0] = {}) => locDanhSachNgoaiLe(sp);

chay("[NLD-00] TÓM TẮT nghĩa vụ hoá đơn (scanner đã ghi) — cùng phạm vi kế toán với danh sách ngoại lệ", () => {
  it("kế toán CS1: đếm ĐÚNG nghĩa vụ CS1 theo trạng thái + lần quét gần nhất; KHÔNG đếm CS2 (đối chứng ÂM của cách ly cơ sở); Hội sở thấy cả hai", async () => {
    const a = await docTomTatNghiaVu(keToanCoSo(`${T}kt1`, CS1), { coSoId: null });
    expect(a).toEqual({ tong: 3, theoTrangThai: { CHO_XUAT: 2, DA_XUAT: 1 }, quetLanCuoiLuc: "2026-11-02T03:00:00.000Z" });
    expect(a.theoTrangThai.DANG_XU_LY).toBeUndefined(); // của CS2
    const ho = await docTomTatNghiaVu(keToanHoSo(`${T}ho`), { coSoId: null });
    expect(ho.theoTrangThai).toMatchObject({ CHO_XUAT: 2, DA_XUAT: 1, DANG_XU_LY: 1 });
    expect(ho.quetLanCuoiLuc).toBe("2026-11-02T04:00:00.000Z");
  });
  it("lọc cơ sở: trong phạm vi ⇒ thu hẹp; NGOÀI phạm vi ⇒ rỗng chứ không rơi về «tất cả»", async () => {
    expect((await docTomTatNghiaVu(keToanHoSo(`${T}ho`), { coSoId: CS2 })).tong).toBe(1);
    expect(await docTomTatNghiaVu(keToanCoSo(`${T}kt1`, CS1), { coSoId: CS2 })).toEqual({ tong: 0, theoTrangThai: {}, quetLanCuoiLuc: null });
  });
  it("người chỉ có TẦM NHÌN CS1 qua quyền sale (không phải kế toán) ⇒ rỗng — cổng kế toán, không phải tầm nhìn; kế toán CS1 kiêm sale CS2 ⇒ chỉ CS1", async () => {
    expect((await docTomTatNghiaVu(saleCs1(`${T}sale`), { coSoId: null })).tong).toBe(0);
    expect((await docTomTatNghiaVu(keToanCs1KiemSaleCs2(`${T}kt1`), { coSoId: null })).tong).toBe(3);
    expect((await docTomTatNghiaVu(keToanCs1KiemSaleCs2(`${T}kt1`), { coSoId: CS2 })).tong).toBe(0);
  });
  it("kết quả chỉ là SỐ ĐẾM + giờ: không id đơn, không số tiền, không tên khách", async () => {
    const j = JSON.stringify(await docTomTatNghiaVu(keToanHoSo(`${T}ho`), { coSoId: null }));
    for (const x of [DON1, DON2, "1000000", "Phụ huynh NLD", "0328545441"]) expect(j, x).not.toContain(x);
  });
});

chay("[NLD-01] ĐỌC theo phạm vi cơ sở", () => {
  it("kế toán CS1 thấy ngoại lệ CS1 (đang mở) và KHÔNG thấy CS2; đối chứng: Hội sở thấy cả hai", async () => {
    const a = await docDanhSachNgoaiLe(keToanCoSo(`${T}kt1`, CS1), loc(), { coSoId: null });
    expect(a.dong.map((d) => d.id).sort()).toEqual([NL1, NL2].sort());
    const ho = await docDanhSachNgoaiLe(keToanHoSo(`${T}ho`), loc(), { coSoId: null });
    expect(ho.dong.map((d) => d.id)).toEqual(expect.arrayContaining([NL1, NL2, NL3]));
  });

  it("người chỉ có TẦM NHÌN CS1 qua quyền khác (sale) mà KHÔNG phải kế toán ⇒ rỗng (cổng kế toán, không phải tầm nhìn); đối chứng: kế toán CS1 thấy", async () => {
    const sale = await docDanhSachNgoaiLe(saleCs1(`${T}sale`), loc(), { coSoId: null });
    expect(sale.dong).toEqual([]);
    expect(sale.tong).toBe(0);
    expect((await docDanhSachNgoaiLe(keToanCoSo(`${T}kt1`, CS1), loc(), { coSoId: null })).dong.length).toBeGreaterThan(0);
  });

  it("lọc cơ sở (?coSo=): trong phạm vi ⇒ thu hẹp; NGOÀI phạm vi ⇒ rỗng chứ không rơi về 'tất cả'", async () => {
    const ho = keToanHoSo(`${T}ho`);
    expect((await docDanhSachNgoaiLe(ho, loc(), { coSoId: CS2 })).dong.map((d) => d.id)).toEqual([NL3]);
    const kt1 = keToanCoSo(`${T}kt1`, CS1);
    expect((await docDanhSachNgoaiLe(kt1, loc(), { coSoId: CS2 })).dong).toEqual([]);
    expect((await docDanhSachNgoaiLe(kt1, loc(), { coSoId: CS1 })).dong.length).toBe(2);
  });

  it("kế toán CS1 kiêm sale CS2: KHÔNG thấy ngoại lệ CS2 dù tầm nhìn có; `?coSo=CS2` cũng rỗng (cổng kế toán, không phải tầm nhìn); không lọc ⇒ chỉ CS1", async () => {
    const a = keToanCs1KiemSaleCs2(`${T}kt1`);
    expect((await docDanhSachNgoaiLe(a, loc(), { coSoId: CS2 })).dong).toEqual([]);
    expect((await docDanhSachNgoaiLe(a, loc(), { coSoId: null })).dong.map((d) => d.id).sort()).toEqual([NL1, NL2].sort());
    expect((await docDanhSachNgoaiLe(a, loc(), { coSoId: CS1 })).dong.length).toBe(2);
  });

  it("nhóm: 'đang mở' vs 'đã đóng'; đếm theo nhóm trong phạm vi; bộ lọc mức / loại; nút theo quyền từng dòng", async () => {
    const kt1 = keToanCoSo(`${T}kt1`, CS1);
    const mo = await docDanhSachNgoaiLe(kt1, loc(), { coSoId: null });
    expect(mo.dem).toMatchObject({ dangMo: 2, daDong: 1, khan: 1 });
    const dong = await docDanhSachNgoaiLe(kt1, loc({ nlNhom: "DA_DONG" }), { coSoId: null });
    expect(dong.dong.map((d) => d.id)).toEqual([NL4]);
    expect(dong.dong[0]!.hanhDong).toMatchObject({ nhan: false, daXuLy: false, boQua: false });
    expect((await docDanhSachNgoaiLe(kt1, loc({ nlMuc: "KHAN" }), { coSoId: null })).dong.map((d) => d.id)).toEqual([NL2]);
    expect((await docDanhSachNgoaiLe(kt1, loc({ nlLoai: "NGHI_TRUNG" }), { coSoId: null })).dong.map((d) => d.id)).toEqual([NL1]);
    expect(mo.dong[0]!.hanhDong.boQua).toBe(true);
    expect(mo.dong[0]).toMatchObject({ maDon: "ORD-269973-000001", tenCoSo: "Cơ sở một NLD" });
  });

  it("phân trang: tổng đúng, trang vượt cuối ⇒ rỗng nhưng không ném", async () => {
    const ho = keToanHoSo(`${T}ho`);
    const kq = await docDanhSachNgoaiLe(ho, loc({ nlTrang: "99" }), { coSoId: null });
    expect(kq.dong).toEqual([]);
    expect(kq.tong).toBeGreaterThanOrEqual(3);
    expect(kq.soTrang).toBeGreaterThanOrEqual(1);
  });
});

chay("[NLD-02] GHI: máy trạng thái, lý do, audit, cách ly", () => {
  it("nhận xử lý: MO → DANG_XU_LY, ghi người nhận, một dòng audit old/new; nhận lần hai bị từ chối (đối chứng: lần đầu được)", async () => {
    const kt1 = keToanCoSo(`${T}kt1`, CS1);
    const r = await xuLyNgoaiLe({ actor: kt1, ten: "Kế toán 1", id: NL1, hanhDong: "NHAN_XU_LY", lyDo: "" });
    expect(r).toMatchObject({ ok: true, trangThai: "DANG_XU_LY" });
    expect(await db.hoaDonNgoaiLe.findUniqueOrThrow({ where: { id: NL1 } })).toMatchObject({ trangThai: "DANG_XU_LY", nguoiXuLyId: `${T}kt1` });
    const au = await db.auditLog.findMany({ where: { entityType: "HoaDonNgoaiLe", entityId: NL1 } });
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ action: "NHAN_XU_LY_NGOAI_LE_HOA_DON", actorId: `${T}kt1` });
    expect(au[0]!.oldValues).toMatchObject({ trangThai: "MO" });
    expect(au[0]!.newValues).toMatchObject({ trangThai: "DANG_XU_LY" });
    const lai = await xuLyNgoaiLe({ actor: kt1, ten: "Kế toán 1", id: NL1, hanhDong: "NHAN_XU_LY", lyDo: "" });
    expect(lai).toMatchObject({ ok: false });
    expect(await db.auditLog.count({ where: { entityType: "HoaDonNgoaiLe", entityId: NL1 } })).toBe(1); // từ chối KHÔNG để lại dấu
  });

  it("đã xử lý / bỏ qua cần lý do ≥ 10 ký tự: ngắn ⇒ từ chối, DB không đổi, không audit; đủ ⇒ ghi lý do + người xử lý", async () => {
    const kt1 = keToanCoSo(`${T}kt1`, CS1);
    for (const hd of ["DA_XU_LY", "BO_QUA"] as const) {
      const ngan = await xuLyNgoaiLe({ actor: kt1, ten: "KT", id: NL1, hanhDong: hd, lyDo: "ngắn" });
      expect(ngan).toMatchObject({ ok: false, ma: "LY_DO" });
    }
    expect((await db.hoaDonNgoaiLe.findUniqueOrThrow({ where: { id: NL1 } })).trangThai).toBe("MO");
    expect(await db.auditLog.count({ where: { entityType: "HoaDonNgoaiLe", entityId: NL1 } })).toBe(0);
    expect(await xuLyNgoaiLe({ actor: kt1, ten: "KT", id: NL1, hanhDong: "BO_QUA", lyDo: LY_DO })).toMatchObject({ ok: true, trangThai: "BO_QUA_CO_LY_DO" });
    expect(await db.hoaDonNgoaiLe.findUniqueOrThrow({ where: { id: NL1 } })).toMatchObject({ trangThai: "BO_QUA_CO_LY_DO", lyDoXuLy: LY_DO, nguoiXuLyId: `${T}kt1` });
    expect(await xuLyNgoaiLe({ actor: kt1, ten: "KT", id: NL2, hanhDong: "DA_XU_LY", lyDo: LY_DO })).toMatchObject({ ok: true, trangThai: "DA_XU_LY" });
  });

  it("trạng thái cuối không đi tiếp: ngoại lệ đã đóng bị từ chối mọi thao tác", async () => {
    const kt1 = keToanCoSo(`${T}kt1`, CS1);
    for (const hd of ["NHAN_XU_LY", "DA_XU_LY", "BO_QUA"] as const) {
      expect(await xuLyNgoaiLe({ actor: kt1, ten: "KT", id: NL4, hanhDong: hd, lyDo: LY_DO }), hd).toMatchObject({ ok: false });
    }
    expect((await db.hoaDonNgoaiLe.findUniqueOrThrow({ where: { id: NL4 } })).lyDoXuLy).toBe("Đã xử lý xong");
  });

  it("CÁCH LY CƠ SỞ khi ghi: kế toán CS1 không xử lý được ngoại lệ CS2 ('không tìm thấy', DB không đổi); người chỉ có tầm nhìn (sale) cũng không; đối chứng: Hội sở và đúng cơ sở được", async () => {
    const kt1 = keToanCoSo(`${T}kt1`, CS1);
    const khac = await xuLyNgoaiLe({ actor: kt1, ten: "KT", id: NL3, hanhDong: "BO_QUA", lyDo: LY_DO });
    expect(khac).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(await xuLyNgoaiLe({ actor: saleCs1(`${T}sale`), ten: "Sale", id: NL1, hanhDong: "NHAN_XU_LY", lyDo: "" })).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(await db.hoaDonNgoaiLe.findMany({ where: { id: { in: [NL1, NL3] } }, select: { trangThai: true } })).toEqual([{ trangThai: "MO" }, { trangThai: "MO" }]);
    expect(await db.auditLog.count({ where: { entityType: "HoaDonNgoaiLe", entityId: { startsWith: T } } })).toBe(0);
    expect(await xuLyNgoaiLe({ actor: keToanHoSo(`${T}ho`), ten: "HO", id: NL3, hanhDong: "BO_QUA", lyDo: LY_DO })).toMatchObject({ ok: true });
    expect(await xuLyNgoaiLe({ actor: kt1, ten: "KT", id: NL1, hanhDong: "NHAN_XU_LY", lyDo: "" })).toMatchObject({ ok: true });
  });

  it("ĐUA: hai kế toán cùng 'nhận xử lý' MỘT ngoại lệ ⇒ đúng một thành công, một dòng audit, người nhận là người thắng", async () => {
    const a = keToanCoSo(`${T}kt1`, CS1);
    const b = keToanCoSo(`${T}kt2`, CS1);
    const kq = await Promise.all([
      xuLyNgoaiLe({ actor: a, ten: "A", id: NL1, hanhDong: "NHAN_XU_LY", lyDo: "" }),
      xuLyNgoaiLe({ actor: b, ten: "B", id: NL1, hanhDong: "NHAN_XU_LY", lyDo: "" }),
    ]);
    expect(kq.filter((r) => r.ok)).toHaveLength(1);
    expect(kq.filter((r) => !r.ok)).toHaveLength(1);
    const dong = await db.hoaDonNgoaiLe.findUniqueOrThrow({ where: { id: NL1 } });
    const thang = kq[0]!.ok ? `${T}kt1` : `${T}kt2`;
    expect(dong.nguoiXuLyId).toBe(thang);
    expect(await db.auditLog.count({ where: { entityType: "HoaDonNgoaiLe", entityId: NL1 } })).toBe(1);
  });

  it("id không tồn tại ⇒ 'không tìm thấy', không ném", async () => {
    expect(await xuLyNgoaiLe({ actor: keToanHoSo(`${T}ho`), ten: "HO", id: `${T}khong-co`, hanhDong: "NHAN_XU_LY", lyDo: "" })).toMatchObject({ ok: false, ma: "KHONG_THAY" });
  });
});
