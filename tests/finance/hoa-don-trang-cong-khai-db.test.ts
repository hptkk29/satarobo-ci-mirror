// Ca [TCC-*] — TRANG CÔNG KHAI "thông tin người mua hoá đơn" (Invoice Hub đợt 2, S11, phía phụ huynh) TRÊN POSTGRES THẬT.
//
// Chạy:  DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/finance/hoa-don-trang-cong-khai-db.test.ts
// Không gọi `resetDb()`: fixture tự dựng + tự dọn theo tiền tố `fx-tcc-`; mỗi ca dựng lại ⇒ xanh khi chạy MỘT MÌNH. Các khoá `SystemSetting` bộ này đụng tới được CHỤP và PHỤC HỒI (không xoá hộ).
// Đi hết đường THẬT: `taoYeuCau` (nhân viên) → bộ điều phối của trang (`xuLyMoTrang`) → Server Action THẬT `guiThongTinNguoiMuaAction`. Chỉ giả hai thứ chạm ngoài: header của request
// (`next/headers`) và Upstash rate-limit (không gọi mạng). Mọi ca "KHÔNG được" kèm đối chứng dương. Đồng hồ ĐÓNG BĂNG (luật 19): `vi.setSystemTime` cho `Date` — action đọc `new Date()`.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ choQua: { value: true } }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => (k.toLowerCase() === "x-forwarded-for" ? "203.0.113.50" : null) }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ success: h.choQua.value, remaining: 1, resetAt: 0 }) }));

import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { huyYeuCau, taoYeuCau, type KetQuaTao } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-db";
import { xuLyMoTrang } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-cong-khai";
import { phuThuocThat } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-cong-khai-db";
import { ghepMaLienKet, sinhToken } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-token";
import { guiThongTinNguoiMuaAction } from "@/app/(public)/thong-tin-hoa-don/[ma]/_actions";
import { PHIEN_BAN_DIEU_KHOAN } from "@/app/(public)/thong-tin-hoa-don/[ma]/_hang-so";

if (!RUN_DB_TESTS) console.warn(`[TCC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-tcc-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU_HO = `${T}ou-ho`;
const OU1 = `${T}ou1`;
const OU2 = `${T}ou2`;
const DON1 = `${T}don1`; // CS1
const DON2 = `${T}don2`; // CS1 (yêu cầu thứ hai — chỉ mục từng phần: mỗi đơn một yêu cầu mở)
const DON3 = `${T}don3`; // CS2
const NOW = new Date("2026-11-02T03:00:00.000Z");
const phut = (n: number) => new Date(NOW.getTime() + n * 60_000);
const KHOA_CO = ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.hubThiDiem", "hoaDon.hubNguoiMua"] as const;

// Giá trị riêng để quét rò rỉ (audit / log KHÔNG được chứa giá trị ô).
const TEN_PH = "Nguyễn Thị Phụ Huynh TCCX";
const DIA_CHI_PH = "114 Hoàng Diệu TCCX, Đà Nẵng";
const EMAIL_PH = "ph.tccx@example.com";
const MST_DN = "0401234567";
// CCCD ba/mẹ BẮT BUỘC với cá nhân (luật 02/11/2026) — thiếu nó thì MỌI ca gửi biểu mẫu cá nhân dưới đây ra lỗi dữ liệu thay vì đi vào nhánh mình muốn thử.
const CCCD_PH = "079000000001";
const FORM_CA_NHAN = { loai: "CA_NHAN", ten: TEN_PH, diaChi: DIA_CHI_PH, email: EMAIL_PH, maSoThue: "", cccd: CCCD_PH, dongY: true };
// Doanh nghiệp: email nhận hoá đơn BẮT BUỘC (luật 02/11/2026).
const FORM_DN = { loai: "DOANH_NGHIEP", ten: "Công ty TNHH TCCX", diaChi: "211 Nguyễn Hữu Thọ TCCX", email: "ketoan.tccx@example.com", maSoThue: MST_DN, dongY: true };

const actorCo = (userId: string, quyen: { action: string; centerScope: "ALL" | string[] }[]): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: quyen.some((q) => q.centerScope === "ALL"),
    orgRoles: [],
    permissions: quyen.map((q) => ({ action: q.action, scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: q.centerScope })),
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;
const KT = actorCo(`${T}kt`, [{ action: "payments:confirm", centerScope: "ALL" }]);
const ng = { id: KT.userId, name: "Kế toán TCC" };

const tbl = () => db.hoaDonYeuCauNguoiMua;
const hang = (id: string) => tbl().findUniqueOrThrow({ where: { id } });
const lichSu = (id: string) => db.auditLog.findMany({ where: { entityType: "HoaDonYeuCauNguoiMua", entityId: id }, orderBy: { createdAt: "asc" } });

let anhChupCo: { key: string; valueJson: unknown }[] = [];
// ⚠️ Cờ riêng, KHÔNG suy từ `anhChupCo.length`: nếu cả bốn khoá chưa tồn tại thì ảnh chụp đầu là `[]`, và "rỗng ⇒ chụp lại" sẽ chụp NHẦM các giá trị fixture ở ca sau rồi "phục hồi" chúng thành bật.
let daChup = false;

async function batCo(o: { man?: boolean; quet?: boolean; thiDiem?: boolean; nguoiMua?: boolean } = {}) {
  const gt: [string, boolean][] = [
    ["billing.hoaDonEnabled", o.man ?? true],
    ["hoaDon.hubQuet", o.quet ?? true],
    ["hoaDon.hubThiDiem", o.thiDiem ?? true],
    ["hoaDon.hubNguoiMua", o.nguoiMua ?? true],
  ];
  for (const [key, v] of gt) await db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v }, update: { valueJson: v } });
}
const batRieng = (orgUnitId: string, value = true) =>
  db.centerSetting.upsert({ where: { orgUnitId_key: { orgUnitId, key: "hoaDon.hubThiDiem" } }, create: { orgUnitId, key: "hoaDon.hubThiDiem", valueJson: value }, update: { valueJson: value } });

async function don() {
  const ids = (await tbl().findMany({ where: { OR: [{ orderId: { startsWith: T } }, { id: { startsWith: T } }] }, select: { id: true } })).map((x) => x.id);
  await db.auditLog.deleteMany({ where: { entityType: "HoaDonYeuCauNguoiMua", entityId: { in: ids } } });
  await tbl().deleteMany({ where: { OR: [{ orderId: { startsWith: T } }, { id: { startsWith: T } }] } });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  await db.centerSetting.deleteMany({ where: { orgUnitId: { in: [OU1, OU2] } } });
  await db.orgUnit.deleteMany({ where: { id: { in: [OU1, OU2] } } });
  await db.orgUnit.deleteMany({ where: { id: OU_HO } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}
async function phucHoiCo() {
  for (const k of KHOA_CO) {
    const cu = anhChupCo.find((x) => x.key === k);
    if (cu) await db.systemSetting.update({ where: { key: k }, data: { valueJson: cu.valueJson as never } });
    else await db.systemSetting.deleteMany({ where: { key: k } });
  }
}

async function dungFixture() {
  await don();
  await batCo();
  for (const [id, ten] of [[CS1, "CS1 TCC"], [CS2, "CS2 TCC"]] as const) await db.center.create({ data: { id, name: ten, slug: id, address: "x" } });
  await db.orgUnit.create({ data: { id: OU_HO, type: "HO", code: `${T}HO`, name: "HO TCC", path: `/${T}ho/`, depth: 0 } });
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "ĐV CS1 TCC", centerId: CS1, parentId: OU_HO, path: `/${T}ho/${T}ou1/`, depth: 1 } });
  await db.orgUnit.create({ data: { id: OU2, type: "CENTER", code: `${T}OU2`, name: "ĐV CS2 TCC", centerId: CS2, parentId: OU_HO, path: `/${T}ho/${T}ou2/`, depth: 1 } });
  for (const [id, coSo, ma] of [[DON1, CS1, "ORD-269973-000001"], [DON2, CS1, "ORD-269973-000002"], [DON3, CS2, "ORD-269973-000003"]] as const) {
    await db.order.create({
      data: { id, code: ma, type: "COURSE", status: "CONFIRMED", customerName: "Khách hàng TCC", customerPhone: "0328545331", totalAmount: 5_000_000, centerId: coSo, invoiceBuyerName: "Tên gốc TCC", invoiceEmail: "goc.tcc@example.com" },
    });
  }
}

async function tao(orderId = DON1): Promise<Extract<KetQuaTao, { ok: true }>> {
  const r = await taoYeuCau({ actor: KT, nguoi: ng, orderId, phamVi: "DON", ttlPhut: 240, now: NOW });
  if (!r.ok) throw new Error(`Dựng fixture thất bại: ${r.ma} — ${r.error}`);
  return r;
}
const mo = (ma: string, o: { now?: Date; laBot?: boolean } = {}) => xuLyMoTrang({ ma, ip: "203.0.113.50", laBot: o.laBot ?? false, now: o.now ?? NOW }, phuThuocThat());
const gui = (ma: string, form: unknown) => guiThongTinNguoiMuaAction(ma, form);
const maSaiToken = (id: string, seed = 5) => ghepMaLienKet(id, sinhToken(() => Buffer.alloc(32, seed)));

beforeEach(async () => {
  h.choQua.value = true;
  if (!RUN_DB_TESTS) return;
  if (!daChup) {
    anhChupCo = (await db.systemSetting.findMany({ where: { key: { in: [...KHOA_CO] } }, select: { key: true, valueJson: true } })) as typeof anhChupCo;
    daChup = true;
  }
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await dungFixture();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  if (!RUN_DB_TESTS) return;
  await don();
  await phucHoiCo();
});

const chay = RUN_DB_TESTS ? describe : describe.skip;

chay("[TCC-01] đường đầy đủ: nhân viên tạo → phụ huynh mở bằng mã → gửi qua ACTION → mở lại thấy điền sẵn", () => {
  it("dữ liệu vào ĐÚNG ô, nguồn PHU_HUYNH, ghi đồng ý kèm phiên bản điều khoản; trạng thái vẫn DANG_MO; mở lại thấy giá trị đã điền", async () => {
    const t = await tao();
    // [03/11/2026] Mở lần đầu: ĐIỀN SẴN từ đơn (đơn gốc có tên người mua, email, SĐT khách) — loại mặc định CÁ NHÂN, không CCCD.
    const m1 = await mo(t.maLienKet);
    expect(m1).toEqual({ kieu: "FORM", o: { loai: "CA_NHAN", ten: "Tên gốc TCC", email: "goc.tcc@example.com", sdt: "0328545331" }, hocVienThem: [] }); // đơn chưa khai em nào thêm ⇒ danh sách rỗng
    expect((await hang(t.id)).soLanMo).toBe(1);

    expect(await gui(t.maLienKet, FORM_CA_NHAN)).toEqual({ ok: true });
    const r = await hang(t.id);
    expect(r).toMatchObject({ trangThai: "DANG_MO", guiLuc: NOW, donY: { phienBanDieuKhoan: PHIEN_BAN_DIEU_KHOAN, luc: NOW.toISOString() } });
    const o = (r.duLieuGui as { o: Record<string, { giaTri: string; nguon: string }> }).o;
    expect(o).toMatchObject({
      loai: { giaTri: "CA_NHAN", nguon: "PHU_HUYNH" },
      ten: { giaTri: TEN_PH, nguon: "PHU_HUYNH" },
      diaChi: { giaTri: DIA_CHI_PH, nguon: "PHU_HUYNH" },
      email: { giaTri: EMAIL_PH, nguon: "PHU_HUYNH" },
    });
    expect(Object.keys(o).sort()).toEqual(["cccd", "diaChi", "email", "loai", "ten"]); // cá nhân: có CCCD ba/mẹ, KHÔNG có maSoThue

    // Mở lại: điền sẵn các ô thường, KHÔNG BAO GIỜ điền sẵn CCCD (lộ liên kết không được lộ CCCD).
    // Điền sẵn đọc từ ĐƠN (PH gửi xong là vào đơn): giá trị PH vừa gửi; SĐT khách vẫn còn; CCCD thì KHÔNG bao giờ điền sẵn.
    const m2 = await mo(t.maLienKet, { now: phut(1) });
    expect(m2).toEqual({ kieu: "FORM", o: { loai: "CA_NHAN", ten: TEN_PH, diaChi: DIA_CHI_PH, email: EMAIL_PH, sdt: "0328545331" }, hocVienThem: [] });
    expect(JSON.stringify(m2)).not.toContain(CCCD_PH);
    expect((await lichSu(t.id)).map((a) => a.action)).toEqual(["TAO_YEU_CAU_NGUOI_MUA", "PHU_HUYNH_GUI_THONG_TIN_NGUOI_MUA"]);
  });

  it("doanh nghiệp: MST đi vào ô maSoThue; cá nhân gửi kèm MST rác ⇒ MST KHÔNG được lưu", async () => {
    const dn = await tao(DON1);
    expect(await gui(dn.maLienKet, FORM_DN)).toEqual({ ok: true });
    expect(((await hang(dn.id)).duLieuGui as { o: Record<string, { giaTri: string }> }).o.maSoThue?.giaTri).toBe(MST_DN);

    const cn = await tao(DON3);
    expect(await gui(cn.maLienKet, { ...FORM_CA_NHAN, maSoThue: "0401234567" })).toEqual({ ok: true });
    expect("maSoThue" in ((await hang(cn.id)).duLieuGui as { o: object }).o).toBe(false);
  });

  it("Sale sửa ĐƠN trước ⇒ trang điền sẵn giá trị của Sale (CHỈ giá trị, không nguồn); PH sửa tên ⇒ ô đó vào đơn (ai ghi sau thắng) và ô PH không đụng thì GIỮ giá trị Sale", async () => {
    const t = await tao();
    await db.order.update({ where: { id: DON1 }, data: { invoiceBuyerName: "Tên Sale sửa TCCX", customerAddress: "Địa chỉ Sale TCCX, Đà Nẵng" } });
    const m = await mo(t.maLienKet, { now: phut(1) });
    expect(m).toMatchObject({ kieu: "FORM", o: { ten: "Tên Sale sửa TCCX", diaChi: "Địa chỉ Sale TCCX, Đà Nẵng" } });
    expect(JSON.stringify(m)).not.toMatch(/SALE_NHAP_THAY|nguon/);
    const banDau = (m as { o: Record<string, string> }).o;
    // PH chỉ sửa tên và gõ CCCD (bắt buộc); địa chỉ giữ nguyên bản điền sẵn.
    expect(await gui(t.maLienKet, { ...FORM_CA_NHAN, ...banDau, ten: TEN_PH, banDau })).toEqual({ ok: true });
    expect(await db.order.findUniqueOrThrow({ where: { id: DON1 } })).toMatchObject({ invoiceBuyerName: TEN_PH, customerAddress: "Địa chỉ Sale TCCX, Đà Nẵng", customerCccd: CCCD_PH });
    const o = ((await hang(t.id)).duLieuGui as { o: Record<string, { giaTri: string; nguon: string }> }).o;
    expect(o.ten).toMatchObject({ giaTri: TEN_PH, nguon: "PHU_HUYNH" });
  });
});

chay("[TCC-02] token THÔ không xuất hiện ở DB, audit, hay log", () => {
  it("quét mọi cột của yêu cầu + mọi dòng audit + mọi lời gọi console: không có token thô, không có mã liên kết, không có giá trị ô trong audit/log", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const t = await tao();
    await mo(t.maLienKet);
    await gui(t.maLienKet, FORM_CA_NHAN);
    await mo(maSaiToken(t.id)); // một lần token sai để đi nhánh khoá
    const r = await hang(t.id);
    const dau = JSON.stringify(r);
    expect(dau).not.toContain(t.token);
    expect(dau).not.toContain(t.maLienKet);
    expect(r.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const audit = JSON.stringify(await lichSu(t.id));
    expect(audit).not.toContain(t.token);
    for (const giaTri of [TEN_PH, DIA_CHI_PH, EMAIL_PH]) expect(audit).not.toContain(giaTri);
    const log = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(log).not.toContain(t.token);
    for (const giaTri of [TEN_PH, DIA_CHI_PH, EMAIL_PH]) expect(log).not.toContain(giaTri);
    // đối chứng dương: dữ liệu CÓ nằm trong cột duLieuGui (bộ quét có nhìn đúng chỗ) và audit CÓ dòng
    expect(dau).toContain(TEN_PH);
    expect((await lichSu(t.id)).length).toBeGreaterThanOrEqual(2);
    spies.forEach((s) => s.mockRestore());
  });
});

chay("[TCC-03] CỜ: tắt ⇒ không ghi gì (kể cả bộ đếm), cùng câu với liên kết sai; bật theo CƠ SỞ", () => {
  it("cờ riêng luồng TẮT ⇒ mở: «không còn hiệu lực», soLanMo/soLanSai giữ 0, không audit mới; gửi: không ghi dữ liệu; đối chứng: bật lại ⇒ cùng liên kết dùng được", async () => {
    const t = await tao();
    await batCo({ nguoiMua: false });
    const gocAudit = (await lichSu(t.id)).length;
    const tat = await mo(t.maLienKet);
    expect(tat).toMatchObject({ kieu: "KHONG_CON_HIEU_LUC" });
    expect(await gui(t.maLienKet, FORM_CA_NHAN)).toMatchObject({ ok: false, kieu: "KHONG_CON_HIEU_LUC" });
    expect(await mo(maSaiToken(t.id))).toMatchObject({ kieu: "KHONG_CON_HIEU_LUC" }); // token sai khi cờ tắt: cũng KHÔNG đếm
    const r = await hang(t.id);
    expect(r).toMatchObject({ soLanMo: 0, soLanSai: 0, duLieuGui: null, guiLuc: null, donY: null, khoaDen: null });
    expect((await lichSu(t.id)).length).toBe(gocAudit);
    // câu của cờ TẮT = câu của mã sai hình dạng = câu của id lạ
    expect(await mo("rac")).toEqual(tat);
    expect(await mo(ghepMaLienKet("id-khong-ton-tai-0001", sinhToken(() => Buffer.alloc(32, 3))))).toEqual(tat);
    await batCo({ nguoiMua: true });
    expect((await mo(t.maLienKet, { now: phut(1) })).kieu).toBe("FORM");
    expect(await gui(t.maLienKet, FORM_CA_NHAN)).toEqual({ ok: true });
  });

  it("thí điểm THEO CƠ SỞ: mức toàn hệ TẮT + chỉ CS1 bật riêng ⇒ yêu cầu CS1 dùng được, yêu cầu CS2 KHÔNG và không bị ghi gì; đối chứng: bật thêm CS2 ⇒ dùng được", async () => {
    await batCo({ thiDiem: false });
    await batRieng(OU1);
    const a = await tao(DON1); // CS1
    const b = await tao(DON3); // CS2
    expect((await mo(a.maLienKet)).kieu).toBe("FORM");
    expect(await gui(a.maLienKet, FORM_CA_NHAN)).toEqual({ ok: true });
    expect(await mo(b.maLienKet)).toMatchObject({ kieu: "KHONG_CON_HIEU_LUC" });
    expect(await gui(b.maLienKet, FORM_CA_NHAN)).toMatchObject({ ok: false, kieu: "KHONG_CON_HIEU_LUC" });
    expect(await hang(b.id)).toMatchObject({ soLanMo: 0, duLieuGui: null });
    await batRieng(OU2);
    expect((await mo(b.maLienKet, { now: phut(1) })).kieu).toBe("FORM");
  });

  it("công tắc tổng của màn hoá đơn TẮT ⇒ cũng không dùng được (cờ con không đứng một mình)", async () => {
    const t = await tao();
    await batCo({ man: false });
    expect(await mo(t.maLienKet)).toMatchObject({ kieu: "KHONG_CON_HIEU_LUC" });
    expect((await hang(t.id)).soLanMo).toBe(0);
    await batCo({ man: true });
    expect((await mo(t.maLienKet, { now: phut(1) })).kieu).toBe("FORM");
  });
});

chay("[TCC-04] chống đoán: token sai đếm + khoá ở DB; khoá ra đúng thông điệp; không phân biệt đúng/sai/hết hạn", () => {
  it("5 lần token sai ⇒ khoá; token ĐÚNG khi đang khoá ⇒ «tạm khoá» (mở lẫn gửi, không ghi gì); token SAI khi đang khoá vẫn «không còn hiệu lực»; hết khoá ⇒ dùng lại được", async () => {
    const t = await tao();
    for (let i = 0; i < 5; i++) expect(await mo(maSaiToken(t.id, 10 + i))).toMatchObject({ kieu: "KHONG_CON_HIEU_LUC" });
    const r = await hang(t.id);
    expect(r.soLanSai).toBe(5);
    expect(r.khoaDen).not.toBeNull();
    expect(await mo(t.maLienKet)).toMatchObject({ kieu: "KHOA" });
    expect(await gui(t.maLienKet, FORM_CA_NHAN)).toMatchObject({ ok: false, kieu: "KHOA" });
    expect((await hang(t.id)).duLieuGui).toBeNull();
    expect(await mo(maSaiToken(t.id, 99))).toMatchObject({ kieu: "KHONG_CON_HIEU_LUC" });
    // hết khoá (15 phút mặc định) ⇒ cùng liên kết đúng dùng lại được
    expect((await mo(t.maLienKet, { now: phut(16) })).kieu).toBe("FORM");
    expect((await lichSu(t.id)).map((a) => a.action)).toContain("KHOA_YEU_CAU_NGUOI_MUA");
  });

  it("id của yêu cầu A + token của yêu cầu B ⇒ không hợp lệ, A đếm sai, B nguyên vẹn; đối chứng: mã đúng của B dùng được", async () => {
    const a = await tao(DON1);
    const b = await tao(DON3);
    const cheo = ghepMaLienKet(a.id, b.token);
    expect(await mo(cheo)).toMatchObject({ kieu: "KHONG_CON_HIEU_LUC" });
    expect(await gui(cheo, FORM_CA_NHAN)).toMatchObject({ ok: false, kieu: "KHONG_CON_HIEU_LUC" });
    expect(await hang(a.id)).toMatchObject({ soLanSai: 2, duLieuGui: null });
    expect(await hang(b.id)).toMatchObject({ soLanSai: 0, duLieuGui: null });
    expect(await gui(b.maLienKet, FORM_CA_NHAN)).toEqual({ ok: true });
  });

  it("hết hạn / đã đóng / bị huỷ ⇒ CÙNG MỘT thông điệp với mã sai; không ghi dữ liệu", async () => {
    const hetHan = await tao(DON1);
    const huy = await tao(DON3);
    expect(await huyYeuCau({ actor: KT, nguoi: ng, id: huy.id, lyDo: "Huỷ để thử TCC", now: NOW })).toEqual({ ok: true });
    const sai = await mo(maSaiToken(hetHan.id));
    expect(await mo(hetHan.maLienKet, { now: phut(241) })).toEqual(sai); // quá 240 phút
    expect(await mo(huy.maLienKet)).toEqual(sai);
    vi.setSystemTime(phut(241));
    expect(await gui(hetHan.maLienKet, FORM_CA_NHAN)).toMatchObject({ ok: false, kieu: "KHONG_CON_HIEU_LUC" });
    vi.setSystemTime(NOW);
    expect(await gui(huy.maLienKet, FORM_CA_NHAN)).toMatchObject({ ok: false, kieu: "KHONG_CON_HIEU_LUC" });
    expect((await hang(hetHan.id)).duLieuGui).toBeNull();
    expect((await hang(huy.id)).duLieuGui).toBeNull();
    // đối chứng dương: ngay trước hạn vẫn mở được
    expect((await mo(hetHan.maLienKet, { now: phut(239) })).kieu).toBe("FORM");
  });
});

chay("[TCC-05] biểu mẫu sai ⇒ không ghi; rate-limit + bot ⇒ không chạm DB", () => {
  it("doanh nghiệp thiếu MST / thiếu đồng ý / thiếu tên ⇒ lỗi theo ô, cột duLieuGui vẫn NULL; đối chứng: sửa đúng ⇒ ghi", async () => {
    const t = await tao();
    expect(await gui(t.maLienKet, { ...FORM_DN, maSoThue: "" })).toMatchObject({ ok: false, kieu: "DU_LIEU", loi: { theoO: { maSoThue: expect.any(String) } } });
    expect(await gui(t.maLienKet, { ...FORM_CA_NHAN, dongY: false })).toMatchObject({ ok: false, kieu: "DU_LIEU", loi: { dongY: expect.any(String) } });
    expect(await gui(t.maLienKet, { ...FORM_CA_NHAN, ten: "" })).toMatchObject({ ok: false, kieu: "DU_LIEU", loi: { theoO: { ten: expect.any(String) } } });
    expect(await hang(t.id)).toMatchObject({ duLieuGui: null, guiLuc: null, donY: null });
    expect(await gui(t.maLienKet, FORM_DN)).toEqual({ ok: true });
  });

  it("ô lạ gửi lẻn vào ⇒ không xuất hiện ở bất kỳ cột nào; CCCD ba/mẹ (ô HỢP LỆ từ 02/11) chỉ nằm trong `duLieuGui`, KHÔNG ở nhật ký", async () => {
    const t = await tao();
    expect(await gui(t.maLienKet, { ...FORM_CA_NHAN, soCanCuoc: "079000000002", centerId: CS2, orderId: DON3 })).toEqual({ ok: true });
    const r = await hang(t.id);
    const audit = JSON.stringify(await lichSu(t.id));
    expect(JSON.stringify(r) + audit).not.toMatch(/079000000002|soCanCuoc/i);
    expect(JSON.stringify(r.duLieuGui)).toContain(CCCD_PH); // đối chứng dương: CCCD hợp lệ được lưu ở đúng một chỗ
    expect(audit).not.toContain(CCCD_PH);
    expect(r).toMatchObject({ centerId: CS1, orderId: DON1 });
  });

  it("vượt hạn mức ⇒ «quá nhanh», KHÔNG đọc/ghi yêu cầu (soLanMo giữ nguyên); đối chứng: còn hạn ⇒ mở", async () => {
    const t = await tao();
    h.choQua.value = false;
    expect(await mo(t.maLienKet)).toMatchObject({ kieu: "QUA_NHANH" });
    expect(await gui(t.maLienKet, FORM_CA_NHAN)).toMatchObject({ ok: false, kieu: "QUA_NHANH" });
    expect(await hang(t.id)).toMatchObject({ soLanMo: 0, duLieuGui: null });
    h.choQua.value = true;
    expect((await mo(t.maLienKet)).kieu).toBe("FORM");
    expect((await hang(t.id)).soLanMo).toBe(1);
  });

  it("bot xem trước link ⇒ KHÔNG ăn lượt mở; đối chứng: người mở ⇒ soLanMo tăng", async () => {
    const t = await tao();
    expect(await mo(t.maLienKet, { laBot: true })).toMatchObject({ kieu: "KHONG_CON_HIEU_LUC" });
    expect((await hang(t.id)).soLanMo).toBe(0);
    expect((await mo(t.maLienKet)).kieu).toBe("FORM");
    expect((await hang(t.id)).soLanMo).toBe(1);
  });

  it("vượt số lần mở (mặc định 30) ⇒ «không còn hiệu lực» (cùng câu); gửi KHÔNG tính vào số lần mở", async () => {
    const t = await tao();
    await tbl().update({ where: { id: t.id }, data: { soLanMo: 30 } });
    expect(await mo(t.maLienKet)).toMatchObject({ kieu: "KHONG_CON_HIEU_LUC" });
    expect(await gui(t.maLienKet, FORM_CA_NHAN)).toEqual({ ok: true }); // gửi vẫn được khi đã hết lượt MỞ
    expect((await hang(t.id)).soLanMo).toBe(30);
  });
});

chay("[TCC-06] đường công khai chỉ chạm bảng yêu cầu, ĐƠN (đúng các cột PH đổi) và audit: tiền và hoá đơn KHÔNG đổi", () => {
  it("mở + token sai ⇒ đơn y hệt; gửi nguyên bản điền sẵn + CCCD ⇒ chỉ cột CCCD của đơn đổi; số dòng Payment/HoaDonDienTu trước = sau", async () => {
    const t = await tao();
    const anh = async () => ({
      don: await db.order.findUniqueOrThrow({ where: { id: DON1 } }),
      thu: await db.payment.count({ where: { orderId: { startsWith: T } } }),
      hoaDon: await db.hoaDonDienTu.count({ where: { orderId: { startsWith: T } } }),
    });
    const truoc = await anh();
    expect(truoc.don.invoiceBuyerName).toBe("Tên gốc TCC"); // đối chứng: ảnh chụp có nhìn vào đơn thật
    const m = await mo(t.maLienKet);
    await mo(maSaiToken(t.id));
    expect((await anh()).don).toEqual(truoc.don); // mở / đoán sai KHÔNG đụng đơn
    const banDau = (m as { o: Record<string, string> }).o;
    expect(await gui(t.maLienKet, { ...FORM_CA_NHAN, ...banDau, banDau })).toEqual({ ok: true });
    const sau = await anh();
    const khac = (Object.keys(sau.don) as (keyof typeof sau.don)[]).filter((k) => JSON.stringify(sau.don[k]) !== JSON.stringify(truoc.don[k])).sort();
    expect(khac).toEqual(["customerAddress", "customerCccd", "updatedAt"]); // địa chỉ + CCCD: hai ô PH THẬT SỰ điền thêm (đơn gốc chưa có địa chỉ); tên + email giữ nguyên vì PH không đổi
    expect(sau.thu).toBe(truoc.thu);
    expect(sau.hoaDon).toBe(truoc.hoaDon);
  });
});
