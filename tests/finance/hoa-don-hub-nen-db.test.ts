// Ca [HHN-DB-*] — NỀN DỮ LIỆU INVOICE HUB (đợt 2, lát S4) TRÊN POSTGRES THẬT: các khoá mà mã S7/S8/S9… sẽ DỰA VÀO.
//
// Chạy:  DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/finance/hoa-don-hub-nen-db.test.ts
//        (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET; DB phải là `satarobo_test` / `ci_test`)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id. Mỗi ca tự dựng lại fixture ⇒ xanh khi chạy MỘT MÌNH.
//
// Vì sao phải đo ở DB (luật 14, mẫu `pos-gd1-schema.test.ts`): Prisma 5.22 `migrate diff` KHÔNG in chỉ mục từng phần lẫn CHECK ⇒ kiểm
// drift "0 dòng" không chứng minh chúng tồn tại; lưới `[HHN-04]` chỉ chứng minh câu SQL còn nằm trong tệp. Một `WHERE` viết sai vẫn khớp
// regex mà không chặn gì — bộ này đo HÀNH VI, và mọi ca "KHÔNG được" đều kèm đối chứng dương ("khác thì ĐƯỢC").
//
// Đồng hồ ĐÓNG BĂNG (luật 19): mọi mốc thời gian là hằng tuyệt đối, không `new Date()`.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

if (!RUN_DB_TESTS) console.warn(`[HHN-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-hhn-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`; // không ánh xạ OrgUnit ⇒ ghi kép để trống orgUnitId, không ném
const OU1 = `${T}ou1`;
const LE = `${T}le`;
const DON1 = `${T}don1`;
const DON2 = `${T}don2`;
const HD1 = `${T}hd1`;
const HD2 = `${T}hd2`;
const PN = `${T}pn`; // phapNhanMa của chính sách fixture
const NGAY = new Date("2026-11-01T00:00:00Z");
const LUC = new Date("2026-11-01T03:15:00Z");
const HET = new Date("2026-11-01T07:15:00Z");

const BAY_BANG = [
  "HoaDonNghiaVu",
  "HoaDonDong",
  "HoaDonGiaoDichNhaCungCap",
  "HoaDonLenhKy",
  "HoaDonNgoaiLe",
  "HoaDonYeuCauNguoiMua",
  "HoaDonChinhSach",
] as const;

async function don() {
  const theoId = { where: { id: { startsWith: T } } };
  await db.hoaDonNghiaVu.deleteMany(theoId);
  await db.hoaDonNgoaiLe.deleteMany(theoId);
  await db.hoaDonYeuCauNguoiMua.deleteMany(theoId);
  await db.hoaDonLenhKy.deleteMany(theoId);
  await db.hoaDonDong.deleteMany(theoId);
  await db.hoaDonGiaoDichNhaCungCap.deleteMany(theoId);
  await db.hoaDonChinhSach.deleteMany(theoId);
  await db.hoaDonDienTu.deleteMany(theoId);
  await db.cauHinhHoaDonCoSo.deleteMany(theoId);
  await db.orderItem.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.order.deleteMany(theoId);
  await db.orgUnit.deleteMany({ where: { id: OU1 } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
  await db.legalEntity.deleteMany(theoId);
}

async function dungFixture() {
  await don();
  for (const [id, ten] of [
    [CS1, "CS1 fixture Hub"],
    [CS2, "CS2 fixture Hub"],
  ] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "211 Nguyễn Hữu Thọ" } });
  }
  // CS1 có đơn vị ⇒ ghi kép phải tự điền orgUnitId; CS2 cố ý KHÔNG có ⇒ để trống, không ném.
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "Đơn vị fixture Hub", centerId: CS1 } });
  await db.legalEntity.create({ data: { id: LE, taxCode: `${T}mst`, legalName: "Pháp nhân fixture Hub" } });
  for (const [id, coSo, ma, sdt] of [
    [DON1, CS1, "ORD-269971-000001", "0328545221"],
    [DON2, CS2, "ORD-269971-000002", "0905123451"],
  ] as const) {
    await db.order.create({
      data: {
        id,
        code: ma,
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: "Phụ huynh fixture Hub",
        customerPhone: sdt,
        totalAmount: 6_732_000,
        centerId: coSo,
      },
    });
  }
  for (const [id, donId, coSo] of [
    [HD1, DON1, CS1],
    [HD2, DON2, CS2],
  ] as const) {
    await db.hoaDonDienTu.create({ data: { id, orderId: donId, centerId: coSo, trangThai: "DA_XAC_NHAN", tongTien: 3_000_000, taoBoiId: `${T}kt` } });
  }
}

// ── Bộ dựng dòng cho từng bảng ───────────────────────────────────────────────────────────────────────────────────
type Cho<M> = Partial<M>;
function nv(id: string, o: Cho<Prisma.HoaDonNghiaVuUncheckedCreateInput> = {}) {
  return db.hoaDonNghiaVu.create({
    data: {
      id: `${T}${id}`,
      centerId: CS1,
      orderId: DON1,
      nguonLoai: "PAYMENT",
      nguonId: `${T}pay-${id}`,
      loai: "THU_TIEN",
      trangThai: "CHO_XUAT",
      ngayPhatSinh: NGAY,
      soTienSnapshot: 3_000_000,
      sourceHash: "h",
      ...o,
    },
  });
}
function dong(id: string, o: Cho<Prisma.HoaDonDongUncheckedCreateInput> = {}) {
  return db.hoaDonDong.create({
    data: {
      id: `${T}${id}`,
      hoaDonId: HD1,
      centerId: CS1,
      stt: 1,
      ten: "Học phí Sata 3",
      donViTinh: "khoá",
      soLuong: "1",
      donGia: "1851851.851852",
      thanhTien: 1_851_852,
      vatTreatment: "RATE_8",
      kieuGia: "DA_GOM_THUE",
      tienThue: 148_148,
      congTien: 2_000_000,
      thueSnapshot: { mappingId: "m" },
      ...o,
    },
  });
}
function gd(id: string, o: Cho<Prisma.HoaDonGiaoDichNhaCungCapUncheckedCreateInput> = {}) {
  return db.hoaDonGiaoDichNhaCungCap.create({
    data: {
      id: `${T}${id}`,
      hoaDonId: HD1,
      centerId: CS1,
      phapNhanMst: "0402301783",
      nhaCungCapMa: "MISA_MEINVOICE",
      moiTruong: "gia-lap",
      loaiLuot: "PHAT_HANH",
      luotThu: 1,
      ketQua: "DA_PHAT_HANH",
      batDauLuc: LUC,
      ...o,
    },
  });
}
function lk(id: string, o: Cho<Prisma.HoaDonLenhKyUncheckedCreateInput> = {}) {
  return db.hoaDonLenhKy.create({
    data: { id: `${T}${id}`, hoaDonId: HD1, centerId: CS1, phuongThuc: "HSM_NHA_CUNG_CAP", nguoiYeuCauId: `${T}kt`, duLieuCanKyHash: "sha", ...o },
  });
}
function nl(id: string, o: Cho<Prisma.HoaDonNgoaiLeUncheckedCreateInput> = {}) {
  return db.hoaDonNgoaiLe.create({
    data: { id: `${T}${id}`, centerId: CS1, loai: "NGHI_TRUNG", muc: "CAN_XU_LY", dedupeKey: `${T}dk`, ...o },
  });
}
function yc(id: string, o: Cho<Prisma.HoaDonYeuCauNguoiMuaUncheckedCreateInput> = {}) {
  return db.hoaDonYeuCauNguoiMua.create({
    data: {
      id: `${T}${id}`,
      centerId: CS1,
      orderId: DON1,
      tokenHash: `${T}th-${id}`,
      hetHanLuc: HET,
      giaTriGocHash: { ten: "h" },
      taoBoiId: `${T}sale`,
      ...o,
    },
  });
}
function cs(id: string, o: Cho<Prisma.HoaDonChinhSachUncheckedCreateInput> = {}) {
  return db.hoaDonChinhSach.create({
    data: { id: `${T}${id}`, phapNhanMa: PN, phienBan: 1, hieuLucTu: NGAY, noiDung: { thoiDiemLap: "DO_KE_TOAN_CHOT" }, nguoiTaoId: `${T}maker`, ...o },
  });
}

/** Mã lỗi Prisma — `null` nếu lời hứa KHÔNG bị từ chối. */
async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Prisma.PrismaClientKnownRequestError ? e.code : String(e);
  }
}
/** Toàn văn lỗi — để hỏi TÊN ràng buộc CHECK/FK (Prisma không có mã riêng cho CHECK; RESTRICT ném 23001, không dịch thành P2003). */
async function loiDayDu(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Actor cấp CƠ SỞ — đúng hình dạng `getModelVisibleCenterIds` đọc (quyền `payments:*` neo ở cơ sở; KHÔNG super admin, KHÔNG HO). */
function actorCoSo(centerId: string): Actor {
  return {
    userId: `${T}ketoan-cs`,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: [centerId] }],
    visibleCenterIds: [centerId],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}
/** Actor LAI — có một vai neo ở Hội sở (`isHoLevel: true`) nhưng quyền `payments:*` chỉ phủ MỘT cơ sở. */
function actorLai(centerId: string): Actor {
  return { ...actorCoSo(centerId), userId: `${T}ketoan-lai`, isHoLevel: true } as unknown as Actor;
}
/** Actor Hội sở — `isSuperAdmin: false` (super admin đi đường BYPASS, không chứng minh được gì): tầm nhìn ALL đến từ `centerScope: "ALL"`. */
function actorHoiSo(): Actor {
  return {
    userId: `${T}ketoan-ho`,
    isSuperAdmin: false,
    isHoLevel: true,
    orgRoles: [],
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ho", roleCode: "HO_ACCOUNTANT", centerScope: "ALL" }],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

describe.skipIf(!RUN_DB_TESTS)("[HHN-DB] nền dữ liệu Invoice Hub — Postgres thật", () => {
  beforeAll(async () => {
    const r = await db.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
    console.info(`[HHN-DB] đang đo trên database: ${r[0]!.current_database}`);
  });
  beforeEach(dungFixture);
  afterAll(don);

  // ─── (a) RLS ─────────────────────────────────────────────────────────────────────────────────────────────────────
  it("[HHN-DB-01] RLS BẬT (không FORCE) trên cả BẢY bảng mới", async () => {
    const r = await db.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relkind = 'r' AND relname IN ('HoaDonNghiaVu','HoaDonDong','HoaDonGiaoDichNhaCungCap','HoaDonLenhKy','HoaDonNgoaiLe','HoaDonYeuCauNguoiMua','HoaDonChinhSach')
      ORDER BY relname`;
    expect(r.map((x) => x.relname)).toEqual([...BAY_BANG].sort());
    for (const x of r) {
      expect(x.relrowsecurity, `${x.relname} thiếu RLS`).toBe(true);
      expect(x.relforcerowsecurity, `${x.relname} không được FORCE`).toBe(false);
    }
  });

  // ─── (b) HoaDonNghiaVu ───────────────────────────────────────────────────────────────────────────────────────────
  it("[HHN-DB-02] UNIQUE(nguonLoai, nguonId): cùng một khoản KHÔNG đẻ hai nghĩa vụ", async () => {
    await nv("a", { nguonId: `${T}pay-x` });
    expect(await maLoi(nv("b", { nguonId: `${T}pay-x` }))).toBe("P2002");
    // đối chứng dương: khác nguonId ĐƯỢC; cùng nguonId nhưng khác nguonLoai (BILLING vs PAYMENT) ĐƯỢC
    expect(await maLoi(nv("c", { nguonId: `${T}pay-y` }))).toBeNull();
    expect(await maLoi(nv("d", { nguonId: `${T}pay-x`, nguonLoai: "BILLING" }))).toBeNull();
    expect(await db.hoaDonNghiaVu.count({ where: { id: { startsWith: T } } })).toBe(3);
  });

  it("[HHN-DB-03] CHECK: CHO_QUYET ⇒ lyDoCho có chữ (NULL và chuỗi trắng đều bị chặn, cả INSERT lẫn UPDATE)", async () => {
    expect(await loiDayDu(nv("a", { trangThai: "CHO_QUYET" }))).toMatch(/HoaDonNghiaVu_cho_quyet_ly_do_check/);
    expect(await loiDayDu(nv("b", { trangThai: "CHO_QUYET", lyDoCho: "   " }))).toMatch(/HoaDonNghiaVu_cho_quyet_ly_do_check/);
    expect(await db.hoaDonNghiaVu.count({ where: { id: { startsWith: T } } })).toBe(0);
    // đối chứng dương: có lý do ⇒ ĐƯỢC; trạng thái khác không cần lý do ⇒ ĐƯỢC
    expect(await maLoi(nv("c", { trangThai: "CHO_QUYET", lyDoCho: "NGHI_TRUNG" }))).toBeNull();
    expect(await maLoi(nv("d", { trangThai: "CHO_XUAT" }))).toBeNull();
    // đường UPDATE: đẩy một dòng đang CHO_XUAT sang CHO_QUYET mà không kèm lý do ⇒ bị chặn; kèm lý do ⇒ qua
    expect(await loiDayDu(db.hoaDonNghiaVu.update({ where: { id: `${T}d` }, data: { trangThai: "CHO_QUYET" } }))).toMatch(
      /HoaDonNghiaVu_cho_quyet_ly_do_check/,
    );
    expect(await maLoi(db.hoaDonNghiaVu.update({ where: { id: `${T}d` }, data: { trangThai: "CHO_QUYET", lyDoCho: "TIEN_THUA" } }))).toBeNull();
  });

  it("[HHN-DB-04] điều chỉnh = nghĩa vụ MỚI trỏ về cũ (tự tham chiếu NO ACTION): không xoá được nghĩa vụ gốc còn bị trỏ tới", async () => {
    await nv("goc");
    await nv("dc", { nghiaVuGocId: `${T}goc`, loai: "DIEU_CHINH_GIAM", nguonId: `${T}pay-dc` });
    expect(await maLoi(db.hoaDonNghiaVu.delete({ where: { id: `${T}goc` } }))).toBe("P2003");
    expect(await db.hoaDonNghiaVu.count({ where: { id: `${T}goc` } })).toBe(1);
    // đối chứng dương: xoá bản điều chỉnh trước rồi xoá gốc ĐƯỢC
    await db.hoaDonNghiaVu.delete({ where: { id: `${T}dc` } });
    expect(await maLoi(db.hoaDonNghiaVu.delete({ where: { id: `${T}goc` } }))).toBeNull();
  });

  // ─── (d) chỉ mục từng phần ───────────────────────────────────────────────────────────────────────────────────────
  it("[HHN-DB-05] bốn chỉ mục TỪNG PHẦN TỒN TẠI trên DB và mang đúng điều kiện WHERE", async () => {
    const r = await db.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN ('HoaDonLenhKy_hoaDonId_song_key','HoaDonNgoaiLe_dedupeKey_mo_key','HoaDonYeuCauNguoiMua_orderId_mo_key','HoaDonChinhSach_phapNhanMa_phienBan_chung_key')`;
    const theoTen = new Map(r.map((x) => [x.indexname, x.indexdef]));
    expect(theoTen.size).toBe(4);
    for (const [ten, def] of theoTen) {
      expect(def, ten).toMatch(/^CREATE UNIQUE INDEX/);
      expect(def, ten).toMatch(/WHERE/);
    }
    expect(theoTen.get("HoaDonLenhKy_hoaDonId_song_key")).toMatch(/'CHO_KY'/);
    expect(theoTen.get("HoaDonLenhKy_hoaDonId_song_key")).toMatch(/'DANG_KY'/);
    expect(theoTen.get("HoaDonLenhKy_hoaDonId_song_key")).not.toMatch(/'DA_KY'/);
    expect(theoTen.get("HoaDonNgoaiLe_dedupeKey_mo_key")).toMatch(/'MO'/);
    expect(theoTen.get("HoaDonNgoaiLe_dedupeKey_mo_key")).toMatch(/'DANG_XU_LY'/);
    expect(theoTen.get("HoaDonNgoaiLe_dedupeKey_mo_key")).not.toMatch(/'DA_XU_LY'/);
    expect(theoTen.get("HoaDonYeuCauNguoiMua_orderId_mo_key")).toMatch(/'DANG_MO'/);
    expect(theoTen.get("HoaDonChinhSach_phapNhanMa_phienBan_chung_key")).toMatch(/"centerId" IS NULL/);
  });

  it("[HHN-DB-06] HoaDonLenhKy: MỘT lệnh SỐNG mỗi hoá đơn; đóng/huỷ rồi tạo lại được (đối chứng dương)", async () => {
    await lk("a"); // CHO_KY
    expect(await maLoi(lk("b"))).toBe("P2002"); // hai lệnh sống
    expect(await maLoi(lk("b2", { trangThai: "DANG_KY" }))).toBe("P2002"); // DANG_KY cũng là sống
    // đối chứng dương: hoá đơn KHÁC độc lập; lệnh đã đóng không giữ chỗ
    expect(await maLoi(lk("c", { hoaDonId: HD2, centerId: CS2 }))).toBeNull();
    for (const t of ["DA_KY", "LOI_KY", "HET_HAN", "HUY"]) expect(await maLoi(lk(`dong-${t}`, { trangThai: t })), t).toBeNull();
    // đóng lệnh sống rồi tạo lệnh mới ĐƯỢC
    await db.hoaDonLenhKy.update({ where: { id: `${T}a` }, data: { trangThai: "DA_KY" } });
    expect(await maLoi(lk("moi"))).toBeNull();
    // đường UPDATE: mở lại một lệnh đã đóng khi đang có lệnh sống khác ⇒ chặn
    expect(await maLoi(db.hoaDonLenhKy.update({ where: { id: `${T}dong-HUY` }, data: { trangThai: "CHO_KY" } }))).toBe("P2002");
    // CHECK trạng thái
    expect(await loiDayDu(lk("xau", { trangThai: "KY_LOI_LA" }))).toMatch(/HoaDonLenhKy_trang_thai_check/);
  });

  it("[HHN-DB-07] HoaDonNgoaiLe: dedupeKey chỉ duy nhất khi MO/DANG_XU_LY; đóng rồi tạo lại được; bỏ qua cần lý do ≥ 10 ký tự", async () => {
    await nl("a"); // MO
    expect(await maLoi(nl("b"))).toBe("P2002");
    expect(await maLoi(nl("b2", { trangThai: "DANG_XU_LY" }))).toBe("P2002");
    // đối chứng dương: khoá khác ĐƯỢC; dòng ĐÃ ĐÓNG không giữ chỗ nên nhiều dòng đóng cùng khoá ĐƯỢC
    expect(await maLoi(nl("c", { dedupeKey: `${T}dk2` }))).toBeNull();
    expect(await maLoi(nl("d1", { trangThai: "DA_XU_LY" }))).toBeNull();
    expect(await maLoi(nl("d2", { trangThai: "DA_XU_LY" }))).toBeNull();
    // đóng cái đang mở rồi scanner tạo lại được
    await db.hoaDonNgoaiLe.update({ where: { id: `${T}a` }, data: { trangThai: "DA_XU_LY" } });
    expect(await maLoi(nl("moi"))).toBeNull();
    // bỏ qua ⇒ lý do ≥ 10 ký tự
    expect(await loiDayDu(nl("e1", { trangThai: "BO_QUA_CO_LY_DO", dedupeKey: `${T}e1` }))).toMatch(/HoaDonNgoaiLe_ly_do_xu_ly_check/);
    expect(await loiDayDu(nl("e2", { trangThai: "BO_QUA_CO_LY_DO", dedupeKey: `${T}e2`, lyDoXuLy: "ngắn" }))).toMatch(/HoaDonNgoaiLe_ly_do_xu_ly_check/);
    expect(await loiDayDu(nl("e3", { trangThai: "BO_QUA_CO_LY_DO", dedupeKey: `${T}e3`, lyDoXuLy: "          " }))).toMatch(/HoaDonNgoaiLe_ly_do_xu_ly_check/);
    expect(await maLoi(nl("e4", { trangThai: "BO_QUA_CO_LY_DO", dedupeKey: `${T}e4`, lyDoXuLy: "Đã xác nhận với kế toán" }))).toBeNull();
    expect(await loiDayDu(nl("xau", { trangThai: "LA", dedupeKey: `${T}xau` }))).toMatch(/HoaDonNgoaiLe_trang_thai_check/);
  });

  it("[HHN-DB-08] HoaDonYeuCauNguoiMua: mỗi đơn tối đa MỘT yêu cầu DANG_MO; tokenHash duy nhất; bộ đếm không âm", async () => {
    await yc("a");
    expect(await maLoi(yc("b"))).toBe("P2002"); // cùng đơn, cùng DANG_MO
    // đối chứng dương: đơn khác độc lập; yêu cầu đã thu hồi/hết hạn không giữ chỗ; cấp lại sau khi thu hồi ĐƯỢC
    expect(await maLoi(yc("c", { orderId: DON2, centerId: CS2 }))).toBeNull();
    for (const t of ["DA_GUI", "DA_AP_DUNG", "TU_CHOI", "HET_HAN", "THU_HOI"]) expect(await maLoi(yc(`d-${t}`, { trangThai: t })), t).toBeNull();
    await db.hoaDonYeuCauNguoiMua.update({ where: { id: `${T}a` }, data: { trangThai: "THU_HOI" } });
    expect(await maLoi(yc("moi"))).toBeNull();
    // tokenHash @unique (khác đơn vẫn không được trùng token)
    expect(await maLoi(yc("t1", { orderId: DON2, centerId: CS2, tokenHash: `${T}th-a`, trangThai: "HET_HAN" }))).toBe("P2002");
    expect(await loiDayDu(yc("n1", { trangThai: "THU_HOI", soLanSai: -1 }))).toMatch(/HoaDonYeuCauNguoiMua_so_lan_check/);
    expect(await loiDayDu(yc("n2", { trangThai: "THU_HOI", soLanMo: -1 }))).toMatch(/HoaDonYeuCauNguoiMua_so_lan_check/);
    expect(await loiDayDu(yc("n3", { trangThai: "BA_DAO" }))).toMatch(/HoaDonYeuCauNguoiMua_trang_thai_check/);
  });

  it("[HHN-DB-09] HoaDonYeuCauNguoiMua: KHÔNG có cột CCCD/giấy tờ, và hetHanLuc KHÔNG có default trong DB (TTL do ứng dụng tính)", async () => {
    const cot = await db.$queryRaw<{ column_name: string; column_default: string | null; is_nullable: string }[]>`
      SELECT column_name, column_default, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'HoaDonYeuCauNguoiMua'`;
    expect(cot.length).toBeGreaterThan(15);
    const cam = /cccd|cmnd|can_?cuoc|giay_?to|passport|national|identity|idnumber/i;
    for (const c of cot) expect(c.column_name, `cột ${c.column_name}`).not.toMatch(cam);
    const het = cot.find((c) => c.column_name === "hetHanLuc")!;
    expect(het.column_default).toBeNull();
    expect(het.is_nullable).toBe("NO");
    // hành vi: INSERT thô thiếu hetHanLuc ⇒ DB từ chối (không có "mặc định 7 ngày" ngầm)
    const e = await loiDayDu(
      db.$executeRaw`INSERT INTO "HoaDonYeuCauNguoiMua" ("id","centerId","orderId","tokenHash","giaTriGocHash","taoBoiId","updatedAt")
                     VALUES (${`${T}raw`}, ${CS1}, ${DON1}, ${`${T}th-raw`}, '{}'::jsonb, ${`${T}sale`}, ${LUC})`,
    );
    // 23502 = not_null_violation (Postgres không nêu tên cột trong thông điệp của câu thô — nên đối chứng dương bên dưới là phần chứng minh
    // đúng cột `hetHanLuc` là thủ phạm: cùng câu, chỉ thêm hetHanLuc ⇒ qua).
    expect(e).toMatch(/23502/);
    const ok = await loiDayDu(
      db.$executeRaw`INSERT INTO "HoaDonYeuCauNguoiMua" ("id","centerId","orderId","tokenHash","hetHanLuc","giaTriGocHash","taoBoiId","updatedAt")
                     VALUES (${`${T}raw`}, ${CS1}, ${DON1}, ${`${T}th-raw`}, ${HET}, '{}'::jsonb, ${`${T}sale`}, ${LUC})`,
    );
    expect(ok).toBeNull();
  });

  // ─── (e) HoaDonChinhSach ─────────────────────────────────────────────────────────────────────────────────────────
  it("[HHN-DB-10] HoaDonChinhSach: HIEU_LUC cần nguoiDuyetId (KHÔNG đòi khác nguoiTaoId — luật đó thả 02/11/2026) — cả INSERT lẫn UPDATE", async () => {
    const MC = /HoaDonChinhSach_nguoi_duyet_check/;
    expect(await loiDayDu(cs("a", { trangThai: "HIEU_LUC" }))).toMatch(MC); // không có người duyệt
    expect(await db.hoaDonChinhSach.count({ where: { id: { startsWith: T } } })).toBe(0);
    // luật cũ ĐÃ THẢ: tên CHECK cũ không còn trong DB, và người duyệt = người tạo qua được
    const conCheckCu = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'HoaDonChinhSach_maker_checker_check'`;
    expect(conCheckCu[0]!.n).toBe(0);
    expect(await maLoi(cs("b", { trangThai: "HIEU_LUC", nguoiDuyetId: `${T}maker`, phienBan: 2 }))).toBeNull(); // tự duyệt
    // đối chứng dương
    expect(await maLoi(cs("c", { trangThai: "HIEU_LUC", nguoiDuyetId: `${T}checker`, phienBan: 3 }))).toBeNull();
    // các trạng thái KHÁC không cần người duyệt
    expect(await maLoi(cs("d1", { trangThai: "NHAP", phienBan: 11 }))).toBeNull();
    expect(await maLoi(cs("d2", { trangThai: "CHO_DUYET", phienBan: 12 }))).toBeNull();
    expect(await maLoi(cs("d3", { trangThai: "TU_CHOI", phienBan: 13 }))).toBeNull();
    // đường UPDATE (duyệt trong thực tế là một lượt UPDATE): CHO_DUYET → HIEU_LUC mà không ghi người duyệt ⇒ chặn
    expect(await loiDayDu(db.hoaDonChinhSach.update({ where: { id: `${T}d2` }, data: { trangThai: "HIEU_LUC" } }))).toMatch(MC);
    expect((await db.hoaDonChinhSach.findUniqueOrThrow({ where: { id: `${T}d2` } })).trangThai).toBe("CHO_DUYET"); // không bị đổi
    expect(await maLoi(db.hoaDonChinhSach.update({ where: { id: `${T}d2` }, data: { trangThai: "HIEU_LUC", nguoiDuyetId: `${T}checker` } }))).toBeNull();
  });

  it("[HHN-DB-11] HoaDonChinhSach: UNIQUE(phapNhanMa, centerId, phienBan) — kể cả nhánh DÙNG CHUNG (centerId NULL)", async () => {
    await cs("cs1-v1", { centerId: CS1 });
    expect(await maLoi(cs("cs1-v1b", { centerId: CS1 }))).toBe("P2002"); // cùng pháp nhân + cơ sở + phiên bản
    await cs("chung-v1", { centerId: null });
    // Postgres coi NULL là khác nhau: nếu CHỈ có @@unique thì dòng dưới LỌT. Chỉ mục từng phần (centerId IS NULL) chặn nó.
    expect(await maLoi(cs("chung-v1b", { centerId: null }))).toBe("P2002");
    // đối chứng dương
    expect(await maLoi(cs("chung-v2", { centerId: null, phienBan: 2 }))).toBeNull(); // phiên bản khác
    expect(await maLoi(cs("cs2-v1", { centerId: CS2 }))).toBeNull(); // cơ sở khác cùng phiên bản
    expect(await maLoi(cs("pn2-chung-v1", { centerId: null, phapNhanMa: `${PN}-2` }))).toBeNull(); // pháp nhân khác
    // bản của CS1 và bản dùng chung CÙNG phiên bản sống chung được (hai phạm vi khác nhau)
    expect(await db.hoaDonChinhSach.count({ where: { phapNhanMa: PN, phienBan: 1 } })).toBe(3);
  });

  it("[HHN-DB-12] HoaDonChinhSach: phienBan ≥ 1; hieuLucDen NULL (mở) hoặc ≥ hieuLucTu (khoảng ĐÓNG, một ngày vẫn hợp lệ)", async () => {
    expect(await loiDayDu(cs("a", { phienBan: 0 }))).toMatch(/HoaDonChinhSach_phien_ban_check/);
    expect(await loiDayDu(cs("b", { hieuLucDen: new Date("2026-10-31T00:00:00Z") }))).toMatch(/HoaDonChinhSach_khoang_ngay_check/);
    expect(await maLoi(cs("c", { phienBan: 5, hieuLucDen: NGAY }))).toBeNull(); // đúng một ngày
    expect(await maLoi(cs("d", { phienBan: 6, hieuLucDen: null }))).toBeNull(); // mở
  });

  // ─── (f) CÁCH LY cơ sở bằng scopedDb ─────────────────────────────────────────────────────────────────────────────
  type Doc = {
    findMany: (a: unknown) => Promise<{ id: string }[]>;
    findFirst: (a: unknown) => Promise<{ id: string } | null>;
    findUnique: (a: unknown) => Promise<{ id: string } | null>;
    count: (a: unknown) => Promise<number>;
  };
  const DUNG: Record<(typeof BAY_BANG)[number], (cuaCs: "1" | "2") => Promise<unknown>> = {
    HoaDonNghiaVu: (c) => nv(`iso-nv-${c}`, c === "1" ? {} : { centerId: CS2, orderId: DON2 }),
    HoaDonDong: (c) => dong(`iso-dong-${c}`, c === "1" ? {} : { hoaDonId: HD2, centerId: CS2 }),
    HoaDonGiaoDichNhaCungCap: (c) => gd(`iso-gd-${c}`, c === "1" ? {} : { hoaDonId: HD2, centerId: CS2 }),
    HoaDonLenhKy: (c) => lk(`iso-lk-${c}`, c === "1" ? {} : { hoaDonId: HD2, centerId: CS2 }),
    HoaDonNgoaiLe: (c) => nl(`iso-nl-${c}`, c === "1" ? { dedupeKey: `${T}iso1` } : { centerId: CS2, dedupeKey: `${T}iso2` }),
    HoaDonYeuCauNguoiMua: (c) => yc(`iso-yc-${c}`, c === "1" ? {} : { orderId: DON2, centerId: CS2 }),
    HoaDonChinhSach: (c) => cs(`iso-cs-${c}`, { centerId: c === "1" ? CS1 : CS2 }),
  };
  const TEN_DELEGATE: Record<(typeof BAY_BANG)[number], string> = {
    HoaDonNghiaVu: "hoaDonNghiaVu",
    HoaDonDong: "hoaDonDong",
    HoaDonGiaoDichNhaCungCap: "hoaDonGiaoDichNhaCungCap",
    HoaDonLenhKy: "hoaDonLenhKy",
    HoaDonNgoaiLe: "hoaDonNgoaiLe",
    HoaDonYeuCauNguoiMua: "hoaDonYeuCauNguoiMua",
    HoaDonChinhSach: "hoaDonChinhSach",
  };
  const TIEN_TO: Record<(typeof BAY_BANG)[number], string> = {
    HoaDonNghiaVu: "nv",
    HoaDonDong: "dong",
    HoaDonGiaoDichNhaCungCap: "gd",
    HoaDonLenhKy: "lk",
    HoaDonNgoaiLe: "nl",
    HoaDonYeuCauNguoiMua: "yc",
    HoaDonChinhSach: "cs",
  };
  const DE = (s: ReturnType<typeof scopedDb>, bang: (typeof BAY_BANG)[number]) =>
    (s as unknown as Record<string, Doc>)[TEN_DELEGATE[bang]]!;
  const idCuaToi = { where: { id: { startsWith: T } }, select: { id: true } };

  it.each([...BAY_BANG])(
    "[HHN-DB-13] %s: actor CS1 KHÔNG thấy dòng CS2 (findMany · findFirst · findUnique · count); actor CS2 thấy CS2; HO thấy CẢ HAI",
    async (bang) => {
      await DUNG[bang]("1");
      await DUNG[bang]("2");
      const id1 = `${T}iso-${TIEN_TO[bang]}`; // id của hai dòng: `${id1}-1` (CS1) · `${id1}-2` (CS2)

      const s1 = scopedDb(actorCoSo(CS1));
      const thay1 = (await DE(s1, bang).findMany(idCuaToi)).map((x) => x.id);
      expect(thay1, `${bang}: CS1 phải thấy đúng dòng của mình`).toEqual([`${id1}-1`]);
      expect(await DE(s1, bang).findFirst({ where: { id: `${id1}-2` } }), `${bang}: CS1 KHÔNG được thấy dòng CS2`).toBeNull();
      expect(await DE(s1, bang).findUnique({ where: { id: `${id1}-2` } }), `${bang}: IDOR findUnique`).toBeNull();
      expect(await DE(s1, bang).count({ where: { id: `${id1}-2` } }), `${bang}: count CS2 qua CS1`).toBe(0);
      expect(await DE(s1, bang).findUnique({ where: { id: `${id1}-1` } }), `${bang}: đối chứng dương — dòng của chính CS1`).not.toBeNull();

      const s2 = scopedDb(actorCoSo(CS2));
      expect((await DE(s2, bang).findMany(idCuaToi)).map((x) => x.id)).toEqual([`${id1}-2`]);

      // Actor LAI: neo một vai ở Hội sở (isHoLevel) NHƯNG quyền tiền chỉ ở CS1. Thiếu `getModelPrefixes` thì tầm nhìn rơi về
      // `isHoLevel ? ALL` và người này đọc Hub của CS2 — đây là ca mà prefix `payments:` sinh ra để chặn (lỗi #04).
      const slai = scopedDb(actorLai(CS1));
      expect((await DE(slai, bang).findMany(idCuaToi)).map((x) => x.id), `${bang}: actor lai (HO + payments chỉ CS1) KHÔNG được thấy CS2`).toEqual([`${id1}-1`]);

      const sho = scopedDb(actorHoiSo());
      expect((await DE(sho, bang).findMany(idCuaToi)).map((x) => x.id).sort()).toEqual([`${id1}-1`, `${id1}-2`]);
      expect(await DE(sho, bang).count({ where: { id: { startsWith: T } } })).toBe(2);
    },
  );

  it("[HHN-DB-14] HoaDonChinhSach: actor CS1 thấy dòng CS1 + dòng DÙNG CHUNG (NULL) nhưng KHÔNG thấy CS2; không khai NULL_IS_GLOBAL thì dòng chung tàng hình", async () => {
    await cs("v-cs1", { centerId: CS1, phienBan: 1 });
    await cs("v-cs2", { centerId: CS2, phienBan: 2 });
    await cs("v-chung", { centerId: null, phienBan: 3 });
    const s1 = scopedDb(actorCoSo(CS1));
    expect((await s1.hoaDonChinhSach.findMany({ where: { id: { startsWith: T } }, select: { id: true }, orderBy: { id: "asc" } })).map((x) => x.id)).toEqual([
      `${T}v-chung`,
      `${T}v-cs1`,
    ]);
    expect(await s1.hoaDonChinhSach.findUnique({ where: { id: `${T}v-chung` } })).not.toBeNull();
    expect(await s1.hoaDonChinhSach.findUnique({ where: { id: `${T}v-cs2` } })).toBeNull();
    // đối chứng: bảy bảng còn lại KHÔNG có nhánh NULL — dòng centerId NULL không tồn tại (NOT NULL), nên không có gì "dùng chung" để lộ
    const cot = await db.$queryRaw<{ table_name: string; is_nullable: string }[]>`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND column_name='centerId'
        AND table_name IN ('HoaDonNghiaVu','HoaDonDong','HoaDonGiaoDichNhaCungCap','HoaDonLenhKy','HoaDonNgoaiLe','HoaDonYeuCauNguoiMua','HoaDonChinhSach')
      ORDER BY table_name`;
    const nullable = cot.filter((c) => c.is_nullable === "YES").map((c) => c.table_name);
    expect(nullable).toEqual(["HoaDonChinhSach"]);
    expect(cot).toHaveLength(7);
  });

  it("[HHN-DB-15] ghi kép centerId → orgUnitId tự chạy (CS1 có đơn vị), CS2 không đơn vị ⇒ để trống không ném; chính sách dùng chung (centerId NULL) KHÔNG bị điền", async () => {
    const a = await nv("kep-1");
    expect(a.orgUnitId).toBe(OU1);
    const b = await nv("kep-2", { centerId: CS2, orderId: DON2, nguonId: `${T}pay-kep2` });
    expect(b.orgUnitId).toBeNull();
    const chung = await cs("kep-chung", { centerId: null });
    expect(chung.orgUnitId).toBeNull();
    expect((await cs("kep-cs1", { centerId: CS1, phienBan: 9 })).orgUnitId).toBe(OU1);
  });

  // ─── (g) HoaDonDienTu.khoaChongTrung + cột mới nullable ─────────────────────────────────────────────────────────
  it("[HHN-DB-16] HoaDonDienTu.khoaChongTrung @unique: nhiều dòng NULL ĐƯỢC; trùng giá trị thật bị chặn; khác giá trị ĐƯỢC", async () => {
    // HD1/HD2 của fixture đều NULL ⇒ đã có hai dòng NULL cùng tồn tại
    expect((await db.hoaDonDienTu.findMany({ where: { id: { in: [HD1, HD2] } } })).map((h) => h.khoaChongTrung)).toEqual([null, null]);
    expect(await maLoi(db.hoaDonDienTu.create({ data: { id: `${T}hd3`, orderId: DON1, centerId: CS1, trangThai: "NHAP", tongTien: 1, taoBoiId: `${T}kt` } }))).toBeNull();
    await db.hoaDonDienTu.update({ where: { id: HD1 }, data: { khoaChongTrung: `${T}ref-1` } });
    expect(await maLoi(db.hoaDonDienTu.update({ where: { id: HD2 }, data: { khoaChongTrung: `${T}ref-1` } }))).toBe("P2002");
    expect(await maLoi(db.hoaDonDienTu.update({ where: { id: HD2 }, data: { khoaChongTrung: `${T}ref-2` } }))).toBeNull();
  });

  it("[HHN-DB-17] cột mới trên HoaDonDienTu + CauHinhHoaDonCoSo: ĐÚNG 8 + 8 cột, TẤT CẢ nullable (không NOT NULL, không default) — CHỈ THÊM", async () => {
    const MONG: Record<string, string[]> = {
      HoaDonDienTu: ["legalEntityId", "nhaCungCapMa", "nhaCungCapMoiTruong", "khoaChongTrung", "chinhSachPhienBan", "kichHoatBoi", "thamChieuLoai", "hoaDonGocId"],
      CauHinhHoaDonCoSo: ["legalEntityId", "nhaCungCapMa", "moiTruongNcc", "loaiHoaDon", "phuongThucKy", "khoaBiMat", "chungThuHetHan", "cheDoHub"],
    };
    for (const [bang, cacCot] of Object.entries(MONG)) {
      const r = await db.$queryRaw<{ column_name: string; is_nullable: string; column_default: string | null }[]>`
        SELECT column_name, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema='public' AND table_name = ${bang} AND column_name = ANY(${cacCot})`;
      expect(r.map((x) => x.column_name).sort(), bang).toEqual([...cacCot].sort());
      for (const c of r) {
        expect(c.is_nullable, `${bang}.${c.column_name}`).toBe("YES");
        expect(c.column_default, `${bang}.${c.column_name}`).toBeNull();
      }
    }
    // hành vi: dòng hoá đơn kiểu CŨ (không khai cột mới) vẫn tạo được, mọi cột mới là NULL — hành vi hiện tại KHÔNG đổi
    const h = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD1 } });
    for (const k of MONG.HoaDonDienTu!) expect((h as Record<string, unknown>)[k], k).toBeNull();
  });

  it("[HHN-DB-18] HoaDonDienTu.hoaDonGocId tự tham chiếu NO ACTION: bản điều chỉnh trỏ về gốc, không xoá được gốc khi còn bị trỏ", async () => {
    await db.hoaDonDienTu.create({
      data: { id: `${T}hd-dc`, orderId: DON1, centerId: CS1, trangThai: "NHAP", tongTien: 1, taoBoiId: `${T}kt`, hoaDonGocId: HD1, thamChieuLoai: "DIEU_CHINH_GIAM" },
    });
    expect(await maLoi(db.hoaDonDienTu.delete({ where: { id: HD1 } }))).toBe("P2003");
    await db.hoaDonDienTu.delete({ where: { id: `${T}hd-dc` } });
    expect(await maLoi(db.hoaDonDienTu.delete({ where: { id: HD1 } }))).toBeNull();
  });

  // ─── (i) khoá ngoại & vòng đời bản ghi ───────────────────────────────────────────────────────────────────────────
  it("[HHN-DB-19] hoá đơn mất ⇒ dòng + lệnh ký đi theo (Cascade); nhật ký NCC và nghĩa vụ SỐNG SÓT với hoaDonId = NULL nhưng VẪN giữ centerId", async () => {
    await dong("fk-dong");
    await lk("fk-lk");
    await gd("fk-gd");
    await nv("fk-nv", { hoaDonId: HD1 });
    await db.hoaDonDienTu.delete({ where: { id: HD1 } });
    expect(await db.hoaDonDong.count({ where: { id: `${T}fk-dong` } })).toBe(0);
    expect(await db.hoaDonLenhKy.count({ where: { id: `${T}fk-lk` } })).toBe(0);
    const g = await db.hoaDonGiaoDichNhaCungCap.findUniqueOrThrow({ where: { id: `${T}fk-gd` } });
    expect(g.hoaDonId).toBeNull();
    expect(g.centerId).toBe(CS1); // bản ghi sống sót vẫn thuộc đúng cơ sở ⇒ cách ly được dù cha biến mất
    expect(g.phapNhanMst).toBe("0402301783");
    const n = await db.hoaDonNghiaVu.findUniqueOrThrow({ where: { id: `${T}fk-nv` } });
    expect(n.hoaDonId).toBeNull();
    // và bản ghi mồ côi VẪN bị scopedDb cách ly theo cơ sở
    expect(await scopedDb(actorCoSo(CS2)).hoaDonGiaoDichNhaCungCap.findUnique({ where: { id: `${T}fk-gd` } })).toBeNull();
    expect(await scopedDb(actorCoSo(CS1)).hoaDonGiaoDichNhaCungCap.findUnique({ where: { id: `${T}fk-gd` } })).not.toBeNull();
  });

  it("[HHN-DB-20] khoá ngoại RESTRICT: MỖI khoá Hub → Order / OrderItem / LegalEntity bị chặn ĐÚNG TÊN, đo cô lập từng khoá", async () => {
    // Vì sao phải CÔ LẬP: một cha có nhiều bảng con RESTRICT thì Postgres báo khoá nào vi phạm trước, tuỳ thứ tự trigger ⇒ regex rộng
    // (`_orderId_fkey`) xanh dù khoá Hub bị đổi thành CASCADE, vì khoá của OrderItem/HoaDonDienTu/Payment… cũng khớp. Mỗi ca dưới đây
    // dựng một cha RIÊNG mang ĐÚNG MỘT con, khẳng định TÊN khoá ĐẦY ĐỦ, rồi gỡ con và xoá cha để chứng minh đó là con DUY NHẤT chặn.
    // RESTRICT ném 23001 (restrict_violation) — Prisma 5.22 KHÔNG dịch thành P2003 ⇒ hỏi TÊN khoá ngoại trong thông điệp.

    // (1) OrderItem ← HoaDonNghiaVu.orderItemId
    await db.orderItem.create({ data: { id: `${T}oi`, orderId: DON1, type: "PRODUCT", itemName: "Kit", quantity: 1, unitPrice: 1, totalPrice: 1 } });
    await nv("rs", { orderItemId: `${T}oi` });
    expect(await loiDayDu(db.orderItem.delete({ where: { id: `${T}oi` } }))).toMatch(/HoaDonNghiaVu_orderItemId_fkey/);
    expect(await db.orderItem.count({ where: { id: `${T}oi` } })).toBe(1);
    await db.hoaDonNghiaVu.delete({ where: { id: `${T}rs` } });
    expect(await loiDayDu(db.orderItem.delete({ where: { id: `${T}oi` } }))).toBeNull(); // đối chứng dương: hết con thì xoá được

    // (2) Order ← mỗi bảng Hub trỏ tới đơn, MỖI bảng một đơn riêng (đơn mới không có OrderItem/HoaDonDienTu/Payment nào)
    const theoDon: [string, (donId: string) => Promise<unknown>][] = [
      ["HoaDonNghiaVu_orderId_fkey", (donId) => nv("rd-nv", { orderId: donId, nguonId: `${T}pay-rd-nv` })],
      ["HoaDonYeuCauNguoiMua_orderId_fkey", (donId) => yc("rd-yc", { orderId: donId })],
    ];
    for (const [tenKhoa, taoCon] of theoDon) {
      const donId = `${T}don-${tenKhoa}`;
      await db.order.create({
        data: {
          id: donId,
          code: `ORD-269971-${tenKhoa.length}${tenKhoa.slice(6, 9)}`,
          type: "COURSE",
          status: "PENDING_PAYMENT",
          customerName: "Phụ huynh fixture Hub",
          customerPhone: `09${String(tenKhoa.length).padStart(8, "0")}`,
          totalAmount: 1,
          centerId: CS1,
        },
      });
      await taoCon(donId);
      expect(await loiDayDu(db.order.delete({ where: { id: donId } })), tenKhoa).toContain(tenKhoa);
      expect(await db.order.count({ where: { id: donId } }), tenKhoa).toBe(1);
      await db.hoaDonNghiaVu.deleteMany({ where: { orderId: donId } });
      await db.hoaDonYeuCauNguoiMua.deleteMany({ where: { orderId: donId } });
      expect(await loiDayDu(db.order.delete({ where: { id: donId } })), `${tenKhoa} — hết con`).toBeNull();
    }

    // (3) LegalEntity ← từng bảng Hub trỏ tới pháp nhân, MỖI bảng một pháp nhân riêng
    const theoPhapNhan: [string, (leId: string) => Promise<unknown>][] = [
      ["HoaDonNghiaVu_legalEntityId_fkey", (leId) => nv("le-nv", { legalEntityId: leId, nguonId: `${T}pay-le-nv` })],
      ["HoaDonChinhSach_legalEntityId_fkey", (leId) => cs("le-cs", { legalEntityId: leId })],
      ["HoaDonDienTu_legalEntityId_fkey", (leId) => db.hoaDonDienTu.update({ where: { id: HD1 }, data: { legalEntityId: leId } })],
      [
        "CauHinhHoaDonCoSo_legalEntityId_fkey",
        (leId) =>
          db.cauHinhHoaDonCoSo.create({
            data: {
              id: `${T}le-ch`,
              centerId: CS1,
              phapNhanMa: PN,
              kyHieu: "1C26MAI",
              hieuLucTu: NGAY,
              hieuLucDen: new Date("2026-12-31T00:00:00Z"),
              taoBoiId: `${T}kt`,
              capNhatBoiId: `${T}kt`,
              legalEntityId: leId,
            },
          }),
      ],
    ];
    let k = 0;
    for (const [tenKhoa, taoCon] of theoPhapNhan) {
      const leId = `${T}le-${k++}`;
      await db.legalEntity.create({ data: { id: leId, taxCode: `${T}mst-${leId}`, legalName: "Pháp nhân fixture Hub (cô lập)" } });
      await taoCon(leId);
      expect(await loiDayDu(db.legalEntity.delete({ where: { id: leId } })), tenKhoa).toContain(tenKhoa);
      expect(await db.legalEntity.count({ where: { id: leId } }), tenKhoa).toBe(1);
      // gỡ con DUY NHẤT rồi xoá cha: chứng minh khoá vừa đo là khoá chặn (không có khoá thứ hai nào che)
      await db.hoaDonNghiaVu.deleteMany({ where: { legalEntityId: leId } });
      await db.hoaDonChinhSach.deleteMany({ where: { legalEntityId: leId } });
      await db.cauHinhHoaDonCoSo.deleteMany({ where: { legalEntityId: leId } });
      await db.hoaDonDienTu.updateMany({ where: { legalEntityId: leId }, data: { legalEntityId: null } });
      expect(await loiDayDu(db.legalEntity.delete({ where: { id: leId } })), `${tenKhoa} — hết con`).toBeNull();
    }

    // khoá ngoại sang đơn KHÔNG tồn tại ⇒ cũng bị chặn
    expect(await maLoi(nv("rs2", { orderId: `${T}khong-co`, nguonId: `${T}pay-rs2` }))).toBe("P2003");
  });

  // ─── (l)(m) nhật ký nhà cung cấp + dòng hoá đơn ─────────────────────────────────────────────────────────────────
  it("[HHN-DB-21] HoaDonGiaoDichNhaCungCap: UNIQUE(hoaDonId, loaiLuot, luotThu); hoaDonId NULL không bị ràng; CHECK kết quả + ≤ 300 ký tự", async () => {
    await gd("a");
    expect(await maLoi(gd("b"))).toBe("P2002"); // hai lượt cron chồng nhau va ở đây (FEN-08)
    // đối chứng dương: lượt thứ 2 / loại lượt khác / hoá đơn khác ĐƯỢC
    expect(await maLoi(gd("c", { luotThu: 2 }))).toBeNull();
    expect(await maLoi(gd("d", { loaiLuot: "TRA_CUU" }))).toBeNull();
    expect(await maLoi(gd("e", { hoaDonId: HD2, centerId: CS2 }))).toBeNull();
    // hoaDonId NULL: NULL khác nhau ⇒ nhiều lượt giống hệt vẫn ghi được (chủ ý: nhật ký sống sót khi cha mất; khoá chống trùng nằm ở khoaChongTrung)
    expect(await maLoi(gd("f1", { hoaDonId: null }))).toBeNull();
    expect(await maLoi(gd("f2", { hoaDonId: null }))).toBeNull();
    expect(await loiDayDu(gd("x1", { ketQua: "THANH_CONG", luotThu: 9 }))).toMatch(/HoaDonGiaoDichNhaCungCap_ket_qua_check/);
    expect(await loiDayDu(gd("x2", { thongDiepDaChe: "a".repeat(301), luotThu: 10 }))).toMatch(/HoaDonGiaoDichNhaCungCap_thong_diep_check/);
    expect(await maLoi(gd("x3", { thongDiepDaChe: "a".repeat(300), luotThu: 11 }))).toBeNull();
    for (const k of ["DA_PHAT_HANH", "TU_CHOI", "KHONG_RO", "CHUA_CO", "LOI_KY_THUAT"]) {
      expect(await maLoi(gd(`kq-${k}`, { ketQua: k, hoaDonId: null })), k).toBeNull();
    }
  });

  it("[HHN-DB-22] HoaDonDong: UNIQUE(hoaDonId, stt); đơn giá giữ phần lẻ 6 chữ số (MISA in 1.851.851,85); thuế suất NULL được (KCT)", async () => {
    const a = await dong("a");
    expect(a.donGia.toString()).toBe("1851851.851852");
    expect(a.soLuong.toString()).toBe("1");
    expect(await maLoi(dong("b"))).toBe("P2002");
    expect(await maLoi(dong("c", { stt: 2, vatTreatment: "KCT", thueSuat: null, tienThue: 0 }))).toBeNull(); // đối chứng dương
    expect(await maLoi(dong("d", { hoaDonId: HD2, centerId: CS2 }))).toBeNull(); // hoá đơn khác cùng stt ĐƯỢC
    const c = await db.hoaDonDong.findUniqueOrThrow({ where: { id: `${T}c` } });
    expect(c.thueSuat).toBeNull();
    expect(c.vatTreatment).toBe("KCT");
  });
});
