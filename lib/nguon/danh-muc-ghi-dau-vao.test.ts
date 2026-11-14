// @vitest-environment node
/**
 * [DMV-*] — LUẬT GHI danh mục nguồn, phần THUẦN (`danh-muc-ghi-dau-vao.ts`). SPEC "nguồn động" 09/10/2026 §4.
 *
 *   [DMV-01] chuẩn hoá `code` + các mã bị cấm (MANUAL*, UNKNOWN, ngoài [A-Z0-9_], độ dài)
 *   [DMV-02] schema tạo: trùng sau chuẩn hoá cùng một mã; trường lạ bị từ chối; cửa sổ/hiệu lực sai bị chặn
 *   [DMV-03] cổng sửa: nguồn hệ thống chỉ sửa trường được phép; UNKNOWN khoá commissionEnabled
 *   [DMV-04] cổng sửa: nguồn ĐÃ DÙNG khoá code/referrerRequirement/requiresNote; nguồn CHƯA dùng thì đổi được
 *   [DMV-05] đổi nhạy cảm cần lý do ≥ 10 ký tự; đổi tên/mô tả/thứ tự thì không; gửi lại giá trị cũ không phải là đổi
 *   [DMV-06] bảng chuyển trạng thái: hệ thống không lưu trữ, UNKNOWN đứng yên, DRAFT không quay lại, lý do cho chuyển nhạy cảm
 *   [DMV-07] `nguonChonDuoc`: biên hiệu lực (bắt đầu ĐÓNG, kết thúc MỞ), status, selectable
 */
import { describe, expect, it } from "vitest";
import {
  chuanHoaCode,
  kiemCode,
  kiemDoiTrangThai,
  kiemSuaNguon,
  canQuyenKichHoat,
  canQuyenKichHoatGanPage,
  CAU_THIEU_QUYEN_GAN_PAGE,
  CAU_THIEU_QUYEN_KICH_HOAT,
  chanTatHoaHongNguon,
  loiLyDoGanPage,
  nguonDangDinhTienTheoRule,
  chanBoChuNguon,
  chanNguonHoatDongKhongChu,
  lamHongDichMacDinh,
  NHAN_TRUONG_SUA,
  nguonChonDuoc,
  suaNguonSchema,
  tenHanhDongSua,
  tenHanhDongTrangThai,
  taoNguonSchema,
  TAT_CA_TRUONG_SUA,
  truongBiKhoa,
  chuyenTrangThaiDuoc,
  type GiaTriNguon,
  type NguonDeSua,
  type TruongSua,
} from "./danh-muc-ghi-dau-vao";

const TAO_DU = {
  code: "tiktok_ads",
  name: "TikTok Ads",
  sourceType: "MARKETING",
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  sortOrder: 120,
  trangThai: "ACTIVE",
  attributionWindowDays: null,
  commissionEnabled: true,
  ownerOrgUnitId: null,
  ownerEmployeeId: null,
  effectiveFrom: null,
  effectiveTo: null,
} as const;

const HIEN_TAI: GiaTriNguon = {
  code: "TIKTOK_ADS",
  name: "TikTok Ads",
  description: null,
  sourceType: "MARKETING",
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  sortOrder: 120,
  attributionWindowDays: null,
  commissionEnabled: true,
  ownerOrgUnitId: null,
  ownerEmployeeId: null,
  effectiveFrom: null,
  effectiveTo: null,
};
const TUY: NguonDeSua = { code: "TIKTOK_ADS", isSystem: false, daDung: false, status: "ACTIVE" };
const HE_THONG: NguonDeSua = { code: "PAID_ADS", isSystem: true, daDung: true, status: "ACTIVE" };
const UNKNOWN: NguonDeSua = { code: "UNKNOWN", isSystem: true, daDung: true, status: "ACTIVE" };
const LY_DO = "Chủ dự án chốt ngày 09/10";

describe("[DMV-01] code", () => {
  it("chuẩn hoá: trim + HOA", () => {
    expect(chuanHoaCode("  paid_ads  ")).toBe("PAID_ADS");
  });
  it.each([
    ["AB", "ngắn"],
    ["A".repeat(41), "dài"],
    ["PAID ADS", "khoảng trắng giữa"],
    ["PAID-ADS", "gạch ngang"],
    ["QUẢNG_CÁO", "có dấu"],
    ["MANUAL_REVIEW", "tiền tố MANUAL"],
    ["MANUALX", "tiền tố MANUAL"],
    ["UNKNOWN", "mã nguồn hệ thống"],
  ])("từ chối %s (%s)", (code) => {
    expect(kiemCode(chuanHoaCode(code))).not.toBeNull();
  });
  it.each(["TIKTOK_ADS", "ABC", "NGUON_2026", "A".repeat(40), "MAN_UAL"])("chấp nhận %s", (code) => {
    expect(kiemCode(code)).toBeNull();
  });
});

describe("[DMV-02] schema tạo", () => {
  it("hợp lệ ⇒ code đã chuẩn hoá HOA; mô tả để trống ⇒ null", () => {
    const r = taoNguonSchema.safeParse({ ...TAO_DU, code: " tiktok_ads ", description: "   " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.code).toBe("TIKTOK_ADS");
      expect(r.data.description).toBeNull();
    }
  });
  it("mã chữ thường và mã chữ hoa sau chuẩn hoá là CÙNG một mã", () => {
    const a = taoNguonSchema.parse({ ...TAO_DU, code: "paid_ads" });
    const b = taoNguonSchema.parse({ ...TAO_DU, code: " PAID_ADS " });
    expect(a.code).toBe(b.code);
  });
  it("mã MANUAL* / UNKNOWN bị chặn ở schema, lỗi gắn đúng ô `code`", () => {
    for (const code of ["manual_review", "unknown"]) {
      const r = taoNguonSchema.safeParse({ ...TAO_DU, code });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "code")).toBe(true);
    }
  });
  it("loại SYSTEM không chọn được cho nguồn do admin tạo; trường lạ bị từ chối (strict)", () => {
    expect(taoNguonSchema.safeParse({ ...TAO_DU, sourceType: "SYSTEM" }).success).toBe(false);
    expect(taoNguonSchema.safeParse({ ...TAO_DU, isSystem: true }).success).toBe(false);
  });
  it("trạng thái ban đầu chỉ DRAFT|ACTIVE và KHÔNG có mặc định", () => {
    expect(taoNguonSchema.safeParse({ ...TAO_DU, trangThai: "ARCHIVED" }).success).toBe(false);
    const { trangThai: _bo, ...thieu } = TAO_DU;
    expect(taoNguonSchema.safeParse(thieu).success).toBe(false);
  });
  it("cửa sổ ghi công: nguyên dương, ≤ 3650; 0, âm, số lẻ bị chặn; null = dùng mặc định", () => {
    for (const bad of [0, -5, 1.5, 3651]) expect(taoNguonSchema.safeParse({ ...TAO_DU, attributionWindowDays: bad }).success, String(bad)).toBe(false);
    expect(taoNguonSchema.safeParse({ ...TAO_DU, attributionWindowDays: 60 }).success).toBe(true);
    expect(taoNguonSchema.safeParse({ ...TAO_DU, attributionWindowDays: null }).success).toBe(true);
  });
  it("hiệu lực: hết hạn phải SAU bắt đầu (bằng nhau cũng bị chặn); thiếu một đầu là mở", () => {
    const tu = "2026-11-01T00:00:00.000Z";
    expect(taoNguonSchema.safeParse({ ...TAO_DU, effectiveFrom: tu, effectiveTo: tu }).success).toBe(false);
    expect(taoNguonSchema.safeParse({ ...TAO_DU, effectiveFrom: tu, effectiveTo: "2026-10-01T00:00:00.000Z" }).success).toBe(false);
    expect(taoNguonSchema.safeParse({ ...TAO_DU, effectiveFrom: tu, effectiveTo: "2026-12-01T00:00:00.000Z" }).success).toBe(true);
    expect(taoNguonSchema.safeParse({ ...TAO_DU, effectiveFrom: tu, effectiveTo: null }).success).toBe(true); // thiếu một đầu = mở
    const { effectiveTo: _bo, ...thieuDen } = TAO_DU;
    expect(taoNguonSchema.safeParse({ ...thieuDen, effectiveFrom: tu }).success).toBe(false); // effectiveTo là trường BẮT BUỘC khai (null = mở) — không ngầm định
  });
  it("tên: 2–120 ký tự sau trim", () => {
    expect(taoNguonSchema.safeParse({ ...TAO_DU, name: " a " }).success).toBe(false);
    expect(taoNguonSchema.safeParse({ ...TAO_DU, name: "x".repeat(121) }).success).toBe(false);
  });
});

describe("[DMV-03] sửa nguồn HỆ THỐNG", () => {
  it("chỉ sửa tên · mô tả · thứ tự · cửa sổ · commissionEnabled · phụ trách", () => {
    for (const patch of [{ name: "Quảng cáo trả phí" }, { sortOrder: 5 }, { attributionWindowDays: 45 }, { commissionEnabled: false }, { ownerEmployeeId: "e1" }]) {
      const r = kiemSuaNguon({ nguon: HE_THONG, hienTai: { ...HIEN_TAI, code: "PAID_ADS" }, patch: suaNguonSchema.parse(patch), lyDo: LY_DO });
      expect(r.ok, JSON.stringify(patch)).toBe(true);
    }
  });
  it.each([
    [{ code: "PAID_ADS_2" }, "code"],
    [{ referrerRequirement: "PARENT" }, "referrerRequirement"],
    [{ requiresNote: true }, "requiresNote"],
    [{ selectable: false }, "selectable"],
    [{ sourceType: "OTHER" }, "sourceType"],
    [{ effectiveTo: new Date("2030-01-01T00:00:00Z") }, "effectiveTo"],
  ])("từ chối sửa %j trên nguồn hệ thống", (patch, truong) => {
    const r = kiemSuaNguon({ nguon: HE_THONG, hienTai: { ...HIEN_TAI, code: "PAID_ADS" }, patch: suaNguonSchema.parse(patch), lyDo: LY_DO });
    expect(r).toMatchObject({ ok: false, truong });
  });
  it("UNKNOWN khoá commissionEnabled (engine không bao giờ trả hoa hồng nguồn cho UNKNOWN) nhưng vẫn sửa được tên", () => {
    const hien = { ...HIEN_TAI, code: "UNKNOWN", commissionEnabled: false, selectable: false, sourceType: "SYSTEM" as const };
    expect(kiemSuaNguon({ nguon: UNKNOWN, hienTai: hien, patch: { commissionEnabled: true }, lyDo: LY_DO })).toMatchObject({ ok: false, truong: "commissionEnabled" });
    expect(kiemSuaNguon({ nguon: UNKNOWN, hienTai: hien, patch: { name: "Không rõ" }, lyDo: null }).ok).toBe(true);
  });
  // Siết 09/10 (Q2): UNKNOWN chỉ sửa được TÊN · MÔ TẢ · THỨ TỰ. Cửa sổ ghi công và người/đơn vị phụ trách của «không rõ nguồn» là vô nghĩa (engine không trả hoa hồng theo nguồn cho
  // nó) — để sửa được là ô nói dối, và người phụ trách gắn vào UNKNOWN còn chặn xoá nhân sự (FK Restrict) mà chẳng mang tiền gì.
  it("[DMV-03b] UNKNOWN KHOÁ cửa sổ ghi công · người phụ trách · đơn vị phụ trách (đúng ô, lý do nói UNKNOWN); tên · mô tả · thứ tự vẫn sửa được", () => {
    const hien = { ...HIEN_TAI, code: "UNKNOWN", commissionEnabled: false, selectable: false, sourceType: "SYSTEM" as const };
    for (const [patch, truong] of [
      [{ attributionWindowDays: 30 }, "attributionWindowDays"],
      [{ ownerEmployeeId: "emp-x" }, "ownerEmployeeId"],
      [{ ownerOrgUnitId: "ou-x" }, "ownerOrgUnitId"],
    ] as const) {
      const r = kiemSuaNguon({ nguon: UNKNOWN, hienTai: hien, patch: suaNguonSchema.parse(patch), lyDo: LY_DO });
      expect(r, truong).toMatchObject({ ok: false, truong });
      expect(r.ok === false && r.loi, truong).toMatch(/UNKNOWN/);
    }
    for (const patch of [{ name: "Không rõ nguồn" }, { description: "Hệ thống gán" }, { sortOrder: 5 }]) {
      expect(kiemSuaNguon({ nguon: UNKNOWN, hienTai: hien, patch: suaNguonSchema.parse(patch), lyDo: null }).ok, JSON.stringify(patch)).toBe(true);
    }
  });
  it("[DMV-03c] ĐỐI CHỨNG DƯƠNG: nguồn hệ thống KHÁC (PAID_ADS) vẫn sửa được cửa sổ · chủ · đơn vị · hoa hồng — cái khoá chỉ dành cho UNKNOWN, không phải cho cả nhóm hệ thống", () => {
    for (const patch of [{ attributionWindowDays: 30 }, { ownerEmployeeId: "emp-x" }, { ownerOrgUnitId: "ou-x" }, { commissionEnabled: false }]) {
      const r = kiemSuaNguon({ nguon: HE_THONG, hienTai: { ...HIEN_TAI, code: "PAID_ADS", commissionEnabled: true }, patch: suaNguonSchema.parse(patch), lyDo: LY_DO });
      expect(r.ok, JSON.stringify(patch)).toBe(true);
    }
  });
});

describe("[DMV-04] đã dùng ⇒ khoá", () => {
  const DA_DUNG: NguonDeSua = { ...TUY, daDung: true };
  it.each([
    [{ code: "TIKTOK_2" }, "code"],
    [{ referrerRequirement: "EMPLOYEE" }, "referrerRequirement"],
    [{ requiresNote: true }, "requiresNote"],
  ])("nguồn đã dùng từ chối %j", (patch, truong) => {
    expect(kiemSuaNguon({ nguon: DA_DUNG, hienTai: HIEN_TAI, patch: suaNguonSchema.parse(patch), lyDo: LY_DO })).toMatchObject({ ok: false, truong });
  });
  it("cùng các thay đổi đó trên nguồn CHƯA dùng ⇒ được (đối chứng dương)", () => {
    for (const patch of [{ code: "TIKTOK_2" }, { referrerRequirement: "EMPLOYEE" }, { requiresNote: true }]) {
      expect(kiemSuaNguon({ nguon: TUY, hienTai: HIEN_TAI, patch: suaNguonSchema.parse(patch), lyDo: LY_DO }).ok, JSON.stringify(patch)).toBe(true);
    }
  });
  it("nguồn đã dùng vẫn đổi được tên, cửa sổ, commissionEnabled, phụ trách", () => {
    for (const patch of [{ name: "Tên mới" }, { attributionWindowDays: 30 }, { commissionEnabled: false }, { ownerEmployeeId: "e9" }]) {
      expect(kiemSuaNguon({ nguon: DA_DUNG, hienTai: HIEN_TAI, patch: suaNguonSchema.parse(patch), lyDo: LY_DO }).ok, JSON.stringify(patch)).toBe(true);
    }
  });
  it("code mới sai dạng bị chặn ngay cả khi nguồn chưa dùng", () => {
    expect(kiemSuaNguon({ nguon: TUY, hienTai: HIEN_TAI, patch: { code: "MANUAL_X" }, lyDo: LY_DO })).toMatchObject({ ok: false, truong: "code" });
  });
});

describe("[DMV-05] lý do cho đổi nhạy cảm", () => {
  it("đổi cửa sổ/commissionEnabled/phụ trách/hiệu lực/selectable thiếu lý do ⇒ chặn, lỗi gắn ô lyDo", () => {
    for (const patch of [{ attributionWindowDays: 30 }, { commissionEnabled: false }, { ownerEmployeeId: "e9" }, { effectiveTo: new Date("2030-01-01T00:00:00Z") }, { selectable: false }]) {
      expect(kiemSuaNguon({ nguon: TUY, hienTai: HIEN_TAI, patch, lyDo: null }), JSON.stringify(patch)).toMatchObject({ ok: false, truong: "lyDo" });
      expect(kiemSuaNguon({ nguon: TUY, hienTai: HIEN_TAI, patch, lyDo: "ngắn" })).toMatchObject({ ok: false, truong: "lyDo" });
      expect(kiemSuaNguon({ nguon: TUY, hienTai: HIEN_TAI, patch, lyDo: LY_DO }).ok).toBe(true);
    }
  });
  it("lý do toàn khoảng trắng không tính", () => {
    expect(kiemSuaNguon({ nguon: TUY, hienTai: HIEN_TAI, patch: { commissionEnabled: false }, lyDo: "           " })).toMatchObject({ ok: false, truong: "lyDo" });
  });
  it("đổi tên · mô tả · thứ tự KHÔNG cần lý do", () => {
    const r = kiemSuaNguon({ nguon: TUY, hienTai: HIEN_TAI, patch: { name: "TikTok", description: "x", sortOrder: 7 }, lyDo: null });
    expect(r).toMatchObject({ ok: true, nhayCam: false });
  });
  it("gửi lại GIÁ TRỊ CŨ không phải là đổi: không lý do, không trường đổi, kể cả với nguồn đã dùng", () => {
    const r = kiemSuaNguon({ nguon: { ...TUY, daDung: true }, hienTai: HIEN_TAI, patch: { code: "TIKTOK_ADS", referrerRequirement: "NONE", commissionEnabled: true, effectiveFrom: null }, lyDo: null });
    expect(r).toEqual({ ok: true, truongDoi: [], nhayCam: false });
  });
  it("ngày so theo THỜI ĐIỂM, không theo tham chiếu đối tượng", () => {
    const d = new Date("2030-01-01T00:00:00Z");
    const r = kiemSuaNguon({ nguon: TUY, hienTai: { ...HIEN_TAI, effectiveTo: new Date(d.getTime()) }, patch: { effectiveTo: new Date(d.getTime()) }, lyDo: null });
    expect(r).toMatchObject({ ok: true, truongDoi: [] });
  });
  it("hiệu lực sau sửa vẫn phải hợp lệ: đặt effectiveTo ≤ effectiveFrom CÓ SẴN bị chặn", () => {
    const r = kiemSuaNguon({
      nguon: TUY,
      hienTai: { ...HIEN_TAI, effectiveFrom: new Date("2026-11-01T00:00:00Z") },
      patch: { effectiveTo: new Date("2026-10-01T00:00:00Z") },
      lyDo: LY_DO,
    });
    expect(r).toMatchObject({ ok: false, truong: "effectiveTo" });
  });
});

describe("[DMV-06] đổi trạng thái", () => {
  const nguon = (status: NguonDeSua["status"], ghi: Partial<NguonDeSua> = {}) => ({ code: "TIKTOK_ADS", isSystem: false, status, ...ghi });
  it("kích hoạt BẢN NHÁP không cần lý do; mọi chuyển khác cần", () => {
    expect(kiemDoiTrangThai({ nguon: nguon("DRAFT"), den: "ACTIVE", lyDo: null })).toEqual({ ok: true, nhayCam: false });
    for (const [tu, den] of [["ACTIVE", "INACTIVE"], ["INACTIVE", "ACTIVE"], ["ACTIVE", "ARCHIVED"], ["INACTIVE", "ARCHIVED"], ["ARCHIVED", "INACTIVE"], ["DRAFT", "ARCHIVED"]] as const) {
      expect(kiemDoiTrangThai({ nguon: nguon(tu), den, lyDo: null }), `${tu}→${den}`).toMatchObject({ ok: false, truong: "lyDo" });
      expect(kiemDoiTrangThai({ nguon: nguon(tu), den, lyDo: LY_DO }), `${tu}→${den}`).toMatchObject({ ok: true });
    }
  });
  it("DRAFT không quay lại; ARCHIVED không nhảy thẳng sang ACTIVE; cùng trạng thái bị từ chối", () => {
    expect(kiemDoiTrangThai({ nguon: nguon("ACTIVE"), den: "DRAFT", lyDo: LY_DO })).toMatchObject({ ok: false, truong: "trangThai" });
    expect(kiemDoiTrangThai({ nguon: nguon("ARCHIVED"), den: "ACTIVE", lyDo: LY_DO })).toMatchObject({ ok: false, truong: "trangThai" });
    expect(kiemDoiTrangThai({ nguon: nguon("ACTIVE"), den: "ACTIVE", lyDo: LY_DO })).toMatchObject({ ok: false, truong: "trangThai" });
  });
  it("nguồn HỆ THỐNG không lưu trữ được, nhưng ngừng/mở lại được; UNKNOWN đứng yên", () => {
    expect(kiemDoiTrangThai({ nguon: nguon("ACTIVE", { code: "PAID_ADS", isSystem: true }), den: "ARCHIVED", lyDo: LY_DO })).toMatchObject({ ok: false, truong: "trangThai" });
    expect(kiemDoiTrangThai({ nguon: nguon("INACTIVE", { code: "PAID_ADS", isSystem: true }), den: "ARCHIVED", lyDo: LY_DO })).toMatchObject({ ok: false });
    expect(kiemDoiTrangThai({ nguon: nguon("ACTIVE", { code: "PAID_ADS", isSystem: true }), den: "INACTIVE", lyDo: LY_DO }).ok).toBe(true);
    for (const den of ["INACTIVE", "ARCHIVED", "DRAFT"] as const) {
      expect(kiemDoiTrangThai({ nguon: nguon("ACTIVE", { code: "UNKNOWN", isSystem: true }), den, lyDo: LY_DO }), den).toMatchObject({ ok: false, truong: "trangThai" });
    }
  });
  it("[DMV-06b] nguồn là ĐÍCH MẶC ĐỊNH của quy nguồn: rời ACTIVE · tắt selectable · BẤT KỲ hạn hiệu lực nào (kể cả tương lai) ⇒ chặn; không phải đích / vẫn hợp lệ ⇒ qua", () => {
    // Cấy: chỉ chặn `den`/`selectableMoi` như bản cũ (bỏ vế hieuLucMoi) ⇒ ba ca hiệu lực dưới đây lọt (đỏ).
    const NOW = new Date("2026-10-09T03:00:00.000Z");
    const dich = new Set(["EMPLOYEE_REFERRAL", "PAID_ADS", "PAGE_NGUON"]);
    const base = { code: "PAID_ADS", dichMacDinh: dich, now: NOW };
    expect(lamHongDichMacDinh({ ...base, den: "INACTIVE" })).toMatchObject({ truong: "trangThai" });
    expect(lamHongDichMacDinh({ ...base, den: "ARCHIVED" })).toMatchObject({ truong: "trangThai" });
    expect(lamHongDichMacDinh({ ...base, selectableMoi: false })).toMatchObject({ truong: "selectable" });
    // hạn trong QUÁ KHỨ, hôm nay và TƯƠNG LAI đều là quả bom hẹn giờ
    for (const ngay of ["2026-10-01T00:00:00.000Z", "2026-10-09T03:00:00.000Z", "2027-01-01T00:00:00.000Z"]) {
      expect(lamHongDichMacDinh({ ...base, hieuLucMoi: { effectiveFrom: null, effectiveTo: new Date(ngay) } }), ngay).toMatchObject({ truong: "effectiveTo" });
    }
    expect(lamHongDichMacDinh({ ...base, hieuLucMoi: { effectiveFrom: new Date("2026-10-10T00:00:00.000Z"), effectiveTo: null } })).toMatchObject({ truong: "effectiveFrom" });
    // đích do Page / cấu hình trỏ tới cũng được bảo vệ
    expect(lamHongDichMacDinh({ ...base, code: "PAGE_NGUON", den: "INACTIVE" })).toMatchObject({ truong: "trangThai" });
    // đối chứng dương: vẫn ACTIVE · bật chọn · hiệu lực mở (không hạn, bắt đầu ở quá khứ) · không đổi gì
    expect(lamHongDichMacDinh({ ...base, den: "ACTIVE" })).toBeNull();
    expect(lamHongDichMacDinh({ ...base, selectableMoi: true })).toBeNull();
    expect(lamHongDichMacDinh({ ...base, hieuLucMoi: { effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null } })).toBeNull();
    expect(lamHongDichMacDinh({ ...base })).toBeNull();
    // không phải đích ⇒ mọi thứ đều được (nguồn do admin tạo, không ai dùng làm đích)
    expect(lamHongDichMacDinh({ ...base, code: "TIKTOK_ADS", den: "INACTIVE", hieuLucMoi: { effectiveFrom: null, effectiveTo: new Date("2026-10-01T00:00:00.000Z") } })).toBeNull();
  });
  it("[DMV-08] đổi người nhận tiền (chủ nguồn · tham gia hoa hồng · cửa sổ) của nguồn ĐANG DÍNH TIỀN cần quyền kích hoạt; tên/mô tả/thứ tự và nguồn chưa dính tiền thì không", () => {
    // Cấy: bỏ vế `(chinhSachDangChay || daCoDongSo)` ⇒ ca nguồn chưa dính tiền đòi quyền oan (đỏ); bỏ vế `some(...)` ⇒ đổi tên cũng đòi (đỏ).
    const dinh = { chinhSachDangChay: true, daCoDongSo: false, dangDinhTienTheoRule: false };
    for (const k of ["ownerEmployeeId", "commissionEnabled", "attributionWindowDays"] as const) {
      expect(canQuyenKichHoat({ truongDoi: [k], ...dinh }), k).toBe(true);
      expect(canQuyenKichHoat({ truongDoi: [k], chinhSachDangChay: false, daCoDongSo: true, dangDinhTienTheoRule: false }), `${k}+sổ`).toBe(true);
      expect(canQuyenKichHoat({ truongDoi: [k], chinhSachDangChay: false, daCoDongSo: false, dangDinhTienTheoRule: false }), `${k} chưa dính tiền`).toBe(false);
    }
    for (const k of ["name", "description", "sortOrder", "ownerOrgUnitId", "sourceType"] as const) {
      expect(canQuyenKichHoat({ truongDoi: [k], ...dinh, dangDinhTienTheoRule: true }), k).toBe(false);
    }
    expect(canQuyenKichHoat({ truongDoi: ["name", "ownerEmployeeId"], ...dinh })).toBe(true);
    expect(canQuyenKichHoat({ truongDoi: [], ...dinh })).toBe(false);
  });
  it("[DMV-08b] đổi KHẢ NĂNG NHẬN LEAD (trạng thái · chọn được · hiệu lực) của nguồn có chính sách/chủ-hưởng-theo-rule cũng cần quyền kích hoạt; nguồn không dính rule thì không; `daCoDongSo` KHÔNG kéo theo (chỉ ảnh hưởng lead mới)", () => {
    // Cấy: bỏ `TRUONG_DOI_KHA_NANG_NHAN_LEAD` khỏi `canQuyenKichHoat` ⇒ ngừng/lưu trữ nguồn đang có chính sách ACTIVE không đòi quyền (đỏ); thêm `|| p.daCoDongSo` vào vế này ⇒ ca «có sổ, không rule» đòi oan (đỏ).
    for (const k of ["status", "selectable", "effectiveFrom", "effectiveTo"] as const) {
      expect(canQuyenKichHoat({ truongDoi: [k], chinhSachDangChay: false, daCoDongSo: false, dangDinhTienTheoRule: true }), k).toBe(true);
      expect(canQuyenKichHoat({ truongDoi: [k], chinhSachDangChay: false, daCoDongSo: false, dangDinhTienTheoRule: false }), `${k} không rule`).toBe(false);
      expect(canQuyenKichHoat({ truongDoi: [k], chinhSachDangChay: true, daCoDongSo: true, dangDinhTienTheoRule: false }), `${k} có sổ/chính sách chung nhưng không rule riêng`).toBe(false);
    }
  });
  it("[DMV-08c] `nguonDangDinhTienTheoRule`: chính sách RIÊNG đang ACTIVE, hoặc nguồn CÓ CHỦ mà rule SOURCE_OWNER đang chạy trên nó; thiếu cả hai thì không", () => {
    // Cấy: đổi `||` thành `&&` ⇒ nguồn chỉ có chính sách riêng (không chủ) lọt qua (đỏ); bỏ vế `coChu` ⇒ nguồn không chủ + rule chung bị đòi oan (đỏ).
    expect(nguonDangDinhTienTheoRule({ chinhSachRieng: true, coChu: false, ruleChuChay: false })).toBe(true);
    expect(nguonDangDinhTienTheoRule({ chinhSachRieng: false, coChu: true, ruleChuChay: true })).toBe(true);
    expect(nguonDangDinhTienTheoRule({ chinhSachRieng: false, coChu: true, ruleChuChay: false })).toBe(false);
    expect(nguonDangDinhTienTheoRule({ chinhSachRieng: false, coChu: false, ruleChuChay: true })).toBe(false);
    expect(nguonDangDinhTienTheoRule({ chinhSachRieng: false, coChu: false, ruleChuChay: false })).toBe(false);
  });
  it("[DMV-11] gán Page → nguồn: cần quyền kích hoạt khi nguồn CŨ hoặc MỚI dính tiền theo rule; lý do ≥ 10 ký tự cho mọi lượt ĐỔI (một lượt không đổi gì thì không hỏi lý do ở hàm ghi)", () => {
    // Cấy: bỏ vế `nguonCu` ⇒ dời Page ra khỏi nguồn dính tiền không đòi quyền (đỏ); bỏ vế `nguonMoi` ⇒ dời Page vào nguồn dính tiền không đòi quyền (đỏ).
    expect(canQuyenKichHoatGanPage({ nguonCu: true, nguonMoi: false })).toBe(true);
    expect(canQuyenKichHoatGanPage({ nguonCu: false, nguonMoi: true })).toBe(true);
    expect(canQuyenKichHoatGanPage({ nguonCu: true, nguonMoi: true })).toBe(true);
    expect(canQuyenKichHoatGanPage({ nguonCu: false, nguonMoi: false })).toBe(false);
    expect(loiLyDoGanPage(null)).toContain("10 ký tự");
    expect(loiLyDoGanPage("ngắn quá")).toContain("10 ký tự");
    expect(loiLyDoGanPage("x".repeat(10))).toBeNull();
    expect(loiLyDoGanPage("x".repeat(9))).not.toBeNull();
    expect(loiLyDoGanPage(`  ${"x".repeat(9)}  `), "khoảng trắng không được tính").not.toBeNull();
  });
  it("[DMV-12] TẮT `commissionEnabled` của nguồn có chính sách riêng chứa dòng THU HÚT ⇒ CHẶN (1% biến mất im lặng); chính sách chỉ gồm dòng EXCLUDE, bật cờ, hay không đụng cờ ⇒ qua", () => {
    // Cấy: bỏ vế `commissionEnabledMoi !== false` ⇒ BẬT cờ cũng bị chặn (đỏ); bỏ vế `coDongThuHutRieng` ⇒ nguồn chỉ có EXCLUDE bị chặn oan (đỏ); bỏ vế `includes("commissionEnabled")` ⇒ sửa tên cũng bị chặn (đỏ).
    const c = chanTatHoaHongNguon({ truongDoi: ["commissionEnabled"], commissionEnabledMoi: false, coDongThuHutRieng: true });
    expect(c).toMatchObject({ truong: "commissionEnabled" });
    expect(c?.loi).toContain("thu hút");
    expect(c?.loi).toContain("Chính sách hoa hồng");
    expect(chanTatHoaHongNguon({ truongDoi: ["commissionEnabled"], commissionEnabledMoi: false, coDongThuHutRieng: false })).toBeNull();
    expect(chanTatHoaHongNguon({ truongDoi: ["commissionEnabled"], commissionEnabledMoi: true, coDongThuHutRieng: true })).toBeNull();
    expect(chanTatHoaHongNguon({ truongDoi: ["name"], commissionEnabledMoi: undefined, coDongThuHutRieng: true })).toBeNull();
    expect(chanTatHoaHongNguon({ truongDoi: [], commissionEnabledMoi: false, coDongThuHutRieng: true })).toBeNull();
  });
  it("[DMV-13] một câu «thiếu quyền kích hoạt» cho cả máy chủ lẫn biểu mẫu, nêu ĐỦ các việc đụng tiền (kể cả trạng thái)", () => {
    for (const w of ["commission_policies:activate", "người phụ trách", "trạng thái", "chọn được"]) expect(CAU_THIEU_QUYEN_KICH_HOAT).toContain(w);
    // câu riêng cho Page nói về việc ĐỔI NGUỒN CỦA PAGE (không liệt kê trường của nguồn), vẫn nêu tên khoá
    for (const w of ["commission_policies:activate", "nguồn của Page", "lead mới"]) expect(CAU_THIEU_QUYEN_GAN_PAGE).toContain(w);
    expect(CAU_THIEU_QUYEN_GAN_PAGE).not.toContain("cửa sổ ghi công");
  });
  it("[DMV-09] bỏ trống người phụ trách (null) của nguồn đang có rule SOURCE_OWNER chạy ⇒ CHẶN (hold vĩnh viễn); đổi sang người khác / nguồn không có rule / không đụng ô này ⇒ qua", () => {
    // Cấy: bỏ vế `p.ownerMoi !== null` ⇒ đổi sang người khác cũng bị chặn oan (đỏ); bỏ vế `ruleChuNguonDangChay` ⇒ nguồn không có rule bị chặn oan (đỏ);
    // bỏ vế `includes("ownerEmployeeId")` ⇒ sửa tên cũng bị chặn khi owner cũ đã null (đỏ).
    const co = chanBoChuNguon({ truongDoi: ["ownerEmployeeId"], ownerMoi: null, ruleChuNguonDangChay: true });
    expect(co).toMatchObject({ truong: "ownerEmployeeId" });
    expect(co?.loi).toContain("người phụ trách");
    expect(co?.loi).toContain("hàng chờ");
    expect(chanBoChuNguon({ truongDoi: ["name", "ownerEmployeeId"], ownerMoi: null, ruleChuNguonDangChay: true })).not.toBeNull();
    // đối chứng dương: ba vế, bỏ mỗi vế một lần thì qua
    expect(chanBoChuNguon({ truongDoi: ["ownerEmployeeId"], ownerMoi: "E2", ruleChuNguonDangChay: true })).toBeNull();
    expect(chanBoChuNguon({ truongDoi: ["ownerEmployeeId"], ownerMoi: null, ruleChuNguonDangChay: false })).toBeNull();
    expect(chanBoChuNguon({ truongDoi: ["name"], ownerMoi: null, ruleChuNguonDangChay: true })).toBeNull();
    expect(chanBoChuNguon({ truongDoi: [], ownerMoi: null, ruleChuNguonDangChay: true })).toBeNull();
  });
  it("[DMV-10] nguồn HOẠT ĐỘNG mà không có người phụ trách khi rule SOURCE_OWNER đang chạy ⇒ CHẶN ở cả TẠO lẫn KÍCH HOẠT (cùng hold vĩnh viễn như bỏ trống chủ); Nháp / có người / không có rule ⇒ qua", () => {
    // Cấy: bỏ vế `trangThaiSau === "ACTIVE"` ⇒ tạo Nháp cũng bị chặn oan (đỏ); bỏ vế `ruleChuNguonDangChay` ⇒ nguồn không có rule bị chặn oan (đỏ); bỏ vế `ownerSau === null` ⇒ nguồn có người cũng bị chặn (đỏ).
    const tao = chanNguonHoatDongKhongChu({ viec: "tao", trangThaiSau: "ACTIVE", ownerSau: null, ruleChuNguonDangChay: true });
    expect(tao).toMatchObject({ truong: "ownerEmployeeId" });
    expect(tao?.loi).toContain("người phụ trách");
    expect(tao?.loi).toContain("hàng chờ");
    const kichHoat = chanNguonHoatDongKhongChu({ viec: "kich-hoat", trangThaiSau: "ACTIVE", ownerSau: null, ruleChuNguonDangChay: true });
    expect(kichHoat).toMatchObject({ truong: "trangThai" });
    expect(kichHoat?.loi).toContain("trước khi kích hoạt");
    // đối chứng dương: bỏ từng vế một thì qua
    expect(chanNguonHoatDongKhongChu({ viec: "tao", trangThaiSau: "DRAFT", ownerSau: null, ruleChuNguonDangChay: true })).toBeNull();
    expect(chanNguonHoatDongKhongChu({ viec: "tao", trangThaiSau: "ACTIVE", ownerSau: "E1", ruleChuNguonDangChay: true })).toBeNull();
    expect(chanNguonHoatDongKhongChu({ viec: "tao", trangThaiSau: "ACTIVE", ownerSau: null, ruleChuNguonDangChay: false })).toBeNull();
    expect(chanNguonHoatDongKhongChu({ viec: "kich-hoat", trangThaiSau: "INACTIVE", ownerSau: null, ruleChuNguonDangChay: true })).toBeNull();
  });
  it("tên hành động audit: đúng việc người đọc nhật ký quan tâm", () => {
    expect(tenHanhDongSua(["attributionWindowDays"])).toBe("NGUON_DOI_CUA_SO");
    expect(tenHanhDongSua(["ownerEmployeeId"])).toBe("NGUON_DOI_PHU_TRACH");
    expect(tenHanhDongSua(["ownerEmployeeId", "ownerOrgUnitId"])).toBe("NGUON_DOI_PHU_TRACH");
    expect(tenHanhDongSua(["commissionEnabled"])).toBe("NGUON_DOI_HOA_HONG");
    expect(tenHanhDongSua(["commissionEnabled", "name"])).toBe("NGUON_SUA");
    expect(tenHanhDongSua(["name"])).toBe("NGUON_SUA");
    expect(tenHanhDongTrangThai("DRAFT", "ACTIVE")).toBe("NGUON_KICH_HOAT");
    expect(tenHanhDongTrangThai("INACTIVE", "ACTIVE")).toBe("NGUON_MO_LAI");
    expect(tenHanhDongTrangThai("ACTIVE", "INACTIVE")).toBe("NGUON_NGUNG");
    expect(tenHanhDongTrangThai("ACTIVE", "ARCHIVED")).toBe("NGUON_LUU_TRU");
    expect(tenHanhDongTrangThai("ARCHIVED", "INACTIVE")).toBe("NGUON_KHOI_PHUC");
  });
});

describe("[DMV-07] nguonChonDuoc", () => {
  const NOW = new Date("2026-11-20T03:00:00.000Z");
  const g = (ghi: Partial<Parameters<typeof nguonChonDuoc>[0]> = {}) => ({ status: "ACTIVE", selectable: true, effectiveFrom: null, effectiveTo: null, ...ghi });
  it("ACTIVE ∧ selectable ∧ không hạn ⇒ chọn được", () => {
    expect(nguonChonDuoc(g(), NOW)).toBe(true);
  });
  it.each([["DRAFT"], ["INACTIVE"], ["ARCHIVED"]])("trạng thái %s ⇒ không chọn được", (status) => {
    expect(nguonChonDuoc(g({ status }), NOW)).toBe(false);
  });
  it("selectable=false (UNKNOWN) ⇒ không", () => {
    expect(nguonChonDuoc(g({ selectable: false }), NOW)).toBe(false);
  });
  it("biên: bắt đầu ĐÓNG (đúng lúc bắt đầu là chọn được), kết thúc MỞ (đúng lúc kết thúc là hết)", () => {
    expect(nguonChonDuoc(g({ effectiveFrom: NOW }), NOW)).toBe(true);
    expect(nguonChonDuoc(g({ effectiveFrom: new Date(NOW.getTime() + 1) }), NOW)).toBe(false);
    expect(nguonChonDuoc(g({ effectiveTo: NOW }), NOW)).toBe(false);
    expect(nguonChonDuoc(g({ effectiveTo: new Date(NOW.getTime() + 1) }), NOW)).toBe(true);
  });
});

describe("[DMV-08b] câu lý do khoá nói bằng NHÃN TIẾNG VIỆT, không lộ tên trường nội bộ", () => {
  it("mọi trường bị khoá của nguồn hệ thống / đã dùng: lý do không chứa tên trường (code, sourceType, referrerRequirement…) mà chứa nhãn", () => {
    for (const nguon of [
      { code: "PAID_ADS", isSystem: true, daDung: true },
      { code: "TIKTOK_ADS", isSystem: false, daDung: true },
    ]) {
      for (const { truong, lyDo } of truongBiKhoa(nguon)) {
        expect(lyDo, `${nguon.code}/${truong}`).not.toContain(`«${truong}»`);
        if (nguon.isSystem) expect(lyDo, `${nguon.code}/${truong}`).toContain(`«${NHAN_TRUONG_SUA[truong]}»`);
      }
    }
  });
  it("mọi trường có nhãn riêng, không rỗng, không trùng nhau", () => {
    const nhan = TAT_CA_TRUONG_SUA.map((k) => NHAN_TRUONG_SUA[k]);
    expect(nhan.every((x) => x.trim() !== "")).toBe(true);
    expect(new Set(nhan).size).toBe(TAT_CA_TRUONG_SUA.length);
  });
});

describe("[DMV-08] truongBiKhoa: giao diện và cổng ghi cùng MỘT nguồn khoá (luật 12)", () => {
  const khoa = (nguon: Pick<NguonDeSua, "code" | "isSystem" | "daDung">) => truongBiKhoa(nguon).map((x) => x.truong);
  it("nguồn tuỳ chỉnh CHƯA dùng: không trường nào bị khoá", () => {
    expect(khoa({ code: "TIKTOK_ADS", isSystem: false, daDung: false })).toEqual([]);
  });
  it("nguồn tuỳ chỉnh ĐÃ dùng: khoá đúng mã · yêu cầu người giới thiệu · bắt buộc giải trình", () => {
    expect(khoa({ code: "TIKTOK_ADS", isSystem: false, daDung: true }).sort()).toEqual(["code", "referrerRequirement", "requiresNote"]);
  });
  it("nguồn hệ thống: chỉ 7 trường được sửa; mọi trường còn lại khoá. UNKNOWN chỉ còn 3 (tên · mô tả · thứ tự)", () => {
    const mo = ["name", "description", "sortOrder", "attributionWindowDays", "commissionEnabled", "ownerOrgUnitId", "ownerEmployeeId"];
    const heThong = khoa({ code: "PAID_ADS", isSystem: true, daDung: true });
    expect(TAT_CA_TRUONG_SUA.filter((k) => !heThong.includes(k)).sort()).toEqual([...mo].sort());
    const unknown = khoa({ code: "UNKNOWN", isSystem: true, daDung: true });
    expect(TAT_CA_TRUONG_SUA.filter((k) => !unknown.includes(k)).sort()).toEqual(["description", "name", "sortOrder"]);
  });
  it("lý do ô khoá TRÙNG chữ với lỗi mà cổng ghi trả cho đúng trường đó (một câu cho cả hai nơi)", () => {
    for (const nguon of [
      { code: "TIKTOK_ADS", isSystem: false, daDung: true },
      { code: "PAID_ADS", isSystem: true, daDung: true },
      { code: "UNKNOWN", isSystem: true, daDung: true },
    ]) {
      for (const { truong, lyDo } of truongBiKhoa(nguon)) {
        const mauDoi: Partial<Record<TruongSua, unknown>> = {
          code: "DOI_MA_XYZ",
          sourceType: "OTHER",
          referrerRequirement: "PARENT",
          requiresNote: true,
          selectable: false,
          effectiveFrom: new Date("2030-01-01T00:00:00Z"),
          effectiveTo: new Date("2031-01-01T00:00:00Z"),
          name: "Tên khác",
          description: "mô tả khác",
          sortOrder: 1,
          attributionWindowDays: 7,
          commissionEnabled: true,
          ownerOrgUnitId: "ou-x",
          ownerEmployeeId: "emp-x",
        };
        const hien = { ...HIEN_TAI, code: nguon.code, commissionEnabled: false, selectable: true };
        const r = kiemSuaNguon({ nguon: { ...nguon, status: "ACTIVE" }, hienTai: hien, patch: { [truong]: mauDoi[truong] } as never, lyDo: LY_DO });
        expect(r, `${nguon.code}.${truong}`).toMatchObject({ ok: false, loi: lyDo, truong });
      }
    }
  });
});

describe("[DMV-09] chuyenTrangThaiDuoc: nút chuyển trạng thái vẽ từ CHÍNH cổng ghi", () => {
  const dich = (code: string, isSystem: boolean, status: NguonDeSua["status"]) => chuyenTrangThaiDuoc({ code, isSystem, status }).sort();
  it("nguồn tuỳ chỉnh: DRAFT→ACTIVE|ARCHIVED · ACTIVE→INACTIVE|ARCHIVED · INACTIVE→ACTIVE|ARCHIVED · ARCHIVED→INACTIVE", () => {
    expect(dich("X_ADS", false, "DRAFT")).toEqual(["ACTIVE", "ARCHIVED"]);
    expect(dich("X_ADS", false, "ACTIVE")).toEqual(["ARCHIVED", "INACTIVE"]);
    expect(dich("X_ADS", false, "INACTIVE")).toEqual(["ACTIVE", "ARCHIVED"]);
    expect(dich("X_ADS", false, "ARCHIVED")).toEqual(["INACTIVE"]);
  });
  it("nguồn hệ thống: không có ARCHIVED; UNKNOWN không có gì cả", () => {
    expect(dich("PAID_ADS", true, "ACTIVE")).toEqual(["INACTIVE"]);
    expect(dich("PAID_ADS", true, "INACTIVE")).toEqual(["ACTIVE"]);
    expect(dich("UNKNOWN", true, "ACTIVE")).toEqual([]);
  });
});
