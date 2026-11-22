// Ca [NLX-*] — XỬ LÝ NGOẠI LỆ HOÁ ĐƠN (Invoice Hub S12): máy trạng thái, lý do, nút nào được vẽ. THUẦN.
// Luật 12: nút chỉ hiện khi bấm được, và nút + action + dịch vụ cùng hỏi MỘT vị từ.
import { describe, expect, it } from "vitest";
import { LOAI_NGOAI_LE_CUA_SCANNER } from "./quet-nghia-vu-ke-hoach";
import {
  GOI_Y_XU_LY,
  NHAN_LOAI_NGOAI_LE,
  NHAN_MUC_NGOAI_LE,
  NHAN_TRANG_THAI_NGOAI_LE,
  TOI_THIEU_LY_DO_XU_LY,
  chuyenNgoaiLe,
  coSoHopLe,
  dinhDangThoiDiemVN,
  hanhDongNgoaiLeChoPhep,
  kiemLyDoXuLy,
  hrefNgoaiLe,
  locDanhSachNgoaiLe,
  type HanhDongNgoaiLe,
} from "./ngoai-le-xu-ly";

type Actor = Parameters<typeof hanhDongNgoaiLeChoPhep>[0];
const keToanCoSo = (...coSo: string[]): Actor =>
  ({ isSuperAdmin: false, isHoLevel: false, grantsAllow: new Set<string>(), permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: coSo }] }) as unknown as Actor;
const keToanHoSo = (): Actor =>
  ({ isSuperAdmin: false, isHoLevel: true, grantsAllow: new Set<string>(), permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ho", roleCode: "HO_ACCOUNTANT", centerScope: "ALL" }] }) as unknown as Actor;
const khongQuyen = (): Actor => ({ isSuperAdmin: false, isHoLevel: false, grantsAllow: new Set<string>(), permissions: [] }) as unknown as Actor;

describe("[NLX-01] máy trạng thái", () => {
  const ok = (tu: string, hd: HanhDongNgoaiLe) => chuyenNgoaiLe(tu, hd);

  it("MO → NHAN_XU_LY → DANG_XU_LY; MO/DANG_XU_LY → DA_XU_LY; MO/DANG_XU_LY → BO_QUA_CO_LY_DO", () => {
    expect(ok("MO", "NHAN_XU_LY")).toEqual({ ok: true, den: "DANG_XU_LY" });
    expect(ok("MO", "DA_XU_LY")).toEqual({ ok: true, den: "DA_XU_LY" });
    expect(ok("DANG_XU_LY", "DA_XU_LY")).toEqual({ ok: true, den: "DA_XU_LY" });
    expect(ok("MO", "BO_QUA")).toEqual({ ok: true, den: "BO_QUA_CO_LY_DO" });
    expect(ok("DANG_XU_LY", "BO_QUA")).toEqual({ ok: true, den: "BO_QUA_CO_LY_DO" });
  });

  it("ĐỐI CHỨNG ÂM: đã nhận rồi không nhận lại; trạng thái cuối (DA_XU_LY / BO_QUA_CO_LY_DO) không đi đâu nữa; trạng thái lạ bị từ chối", () => {
    expect(ok("DANG_XU_LY", "NHAN_XU_LY").ok).toBe(false);
    for (const cuoi of ["DA_XU_LY", "BO_QUA_CO_LY_DO"]) {
      for (const hd of ["NHAN_XU_LY", "DA_XU_LY", "BO_QUA"] as const) {
        const r = ok(cuoi, hd);
        expect(r.ok, `${cuoi}+${hd}`).toBe(false);
        if (!r.ok) expect(r.lyDo).toMatch(/đã (đóng|kết thúc)|không còn/i);
      }
    }
    const la = ok("XYZ", "DA_XU_LY");
    expect(la.ok).toBe(false);
  });
});

describe("[NLX-02] lý do xử lý", () => {
  it("ĐÃ XỬ LÝ và BỎ QUA đòi lý do ≥ 10 ký tự SAU khi cắt khoảng trắng; NHẬN XỬ LÝ không đòi", () => {
    expect(TOI_THIEU_LY_DO_XU_LY).toBe(10);
    for (const hd of ["DA_XU_LY", "BO_QUA"] as const) {
      expect(kiemLyDoXuLy(hd, ""), hd).not.toBeNull();
      expect(kiemLyDoXuLy(hd, "   ngắn    "), hd).not.toBeNull(); // 4 ký tự thật
      expect(kiemLyDoXuLy(hd, "123456789"), hd).not.toBeNull(); // 9
      expect(kiemLyDoXuLy(hd, "1234567890"), hd).toBeNull(); // 10
      expect(kiemLyDoXuLy(hd, "  Đã soát với kế toán trưởng  "), hd).toBeNull();
    }
    expect(kiemLyDoXuLy("NHAN_XU_LY", "")).toBeNull();
  });
});

describe("[NLX-03] nút nào được vẽ (cùng vị từ với cổng)", () => {
  it("kế toán ĐÚNG cơ sở: ngoại lệ MO có đủ ba nút; DANG_XU_LY mất nút nhận; trạng thái cuối không nút nào", () => {
    const a = keToanCoSo("cs1");
    expect(hanhDongNgoaiLeChoPhep(a, { trangThai: "MO", centerId: "cs1" })).toMatchObject({ nhan: true, daXuLy: true, boQua: true, lyDoKhong: null });
    expect(hanhDongNgoaiLeChoPhep(a, { trangThai: "DANG_XU_LY", centerId: "cs1" })).toMatchObject({ nhan: false, daXuLy: true, boQua: true });
    for (const cuoi of ["DA_XU_LY", "BO_QUA_CO_LY_DO"]) {
      expect(hanhDongNgoaiLeChoPhep(a, { trangThai: cuoi, centerId: "cs1" })).toMatchObject({ nhan: false, daXuLy: false, boQua: false });
    }
  });

  it("kế toán cơ sở KHÁC không có nút nào và được NÓI vì sao; đối chứng dương: Hội sở có nút ở mọi cơ sở", () => {
    const a = keToanCoSo("cs1");
    const r = hanhDongNgoaiLeChoPhep(a, { trangThai: "MO", centerId: "cs2" });
    expect(r).toMatchObject({ nhan: false, daXuLy: false, boQua: false });
    expect(r.lyDoKhong).toMatch(/cơ sở/);
    for (const cs of ["cs1", "cs2", "cs9"]) expect(hanhDongNgoaiLeChoPhep(keToanHoSo(), { trangThai: "MO", centerId: cs }).boQua).toBe(true);
  });

  it("không có quyền kế toán ⇒ không nút (kể cả cơ sở của mình)", () => {
    expect(hanhDongNgoaiLeChoPhep(khongQuyen(), { trangThai: "MO", centerId: "cs1" })).toMatchObject({ nhan: false, daXuLy: false, boQua: false });
  });
});

describe("[NLX-04] nhãn cho người vận hành", () => {
  it("MỌI loại ngoại lệ scanner sinh ra đều có nhãn + gợi ý xử lý bằng tiếng Việt thường; không lộ mã kỹ thuật làm nhãn", () => {
    for (const loai of LOAI_NGOAI_LE_CUA_SCANNER) {
      expect(NHAN_LOAI_NGOAI_LE[loai], loai).toBeTruthy();
      expect(GOI_Y_XU_LY[loai], loai).toBeTruthy();
      expect(NHAN_LOAI_NGOAI_LE[loai], loai).not.toMatch(/^[A-Z_]+$/);
    }
  });
  it("đủ nhãn mức + trạng thái; hàm lọc có mặc định AN TOÀN (đang mở) và bỏ giá trị lạ", () => {
    expect(Object.keys(NHAN_MUC_NGOAI_LE).sort()).toEqual(["CAN_XU_LY", "KHAN", "THONG_TIN"]);
    expect(Object.keys(NHAN_TRANG_THAI_NGOAI_LE).sort()).toEqual(["BO_QUA_CO_LY_DO", "DANG_XU_LY", "DA_XU_LY", "MO"]);
    expect(locDanhSachNgoaiLe({})).toEqual({ nhom: "DANG_MO", muc: null, loai: null, trang: 1 });
    expect(locDanhSachNgoaiLe({ nlNhom: "DA_DONG", nlMuc: "KHAN", nlLoai: "NGHI_TRUNG", nlTrang: "3" })).toEqual({ nhom: "DA_DONG", muc: "KHAN", loai: "NGHI_TRUNG", trang: 3 });
    expect(locDanhSachNgoaiLe({ nlNhom: "'; drop", nlMuc: "XX", nlLoai: "../", nlTrang: "-5" })).toEqual({ nhom: "DANG_MO", muc: null, loai: null, trang: 1 });
    expect(locDanhSachNgoaiLe({ nlTrang: "abc" }).trang).toBe(1);
  });
});

describe("[NLX-05] hrefNgoaiLe — đổi bộ lọc khu ngoại lệ mà GIỮ mọi tham số khác của tab", () => {
  const goc = { coSo: "cs1", thang: "2026-11", ngan: "lech", nlNhom: "DANG_MO", nlTrang: "3" };

  it("giữ coSo/thang/ngan; đổi nhóm thì quay về trang 1; null gỡ khoá; luôn về đúng tab Cảnh báo", () => {
    const u = new URL(hrefNgoaiLe(goc, { nlNhom: "DA_DONG" }), "http://x");
    expect(u.pathname).toBe("/payments/hoa-don/canh-bao");
    expect(Object.fromEntries(u.searchParams)).toEqual({ coSo: "cs1", thang: "2026-11", ngan: "lech", nlNhom: "DA_DONG" });
    expect(new URL(hrefNgoaiLe(goc, { nlMuc: "KHAN" }), "http://x").searchParams.has("nlTrang")).toBe(false);
    expect(new URL(hrefNgoaiLe({ ...goc, nlMuc: "KHAN" }, { nlMuc: null }), "http://x").searchParams.has("nlMuc")).toBe(false);
  });

  it("đổi TRANG thì giữ nguyên bộ lọc; bỏ giá trị rỗng/undefined; mã hoá ký tự lạ; không có gì ⇒ không dấu ?", () => {
    const u = new URL(hrefNgoaiLe({ ...goc, nlMuc: "KHAN" }, { nlTrang: "4" }), "http://x");
    expect(u.searchParams.get("nlTrang")).toBe("4");
    expect(u.searchParams.get("nlMuc")).toBe("KHAN");
    expect(hrefNgoaiLe({ coSo: undefined, thang: "" }, {})).toBe("/payments/hoa-don/canh-bao");
    expect(new URL(hrefNgoaiLe({ coSo: "a&b=c" }, {}), "http://x").searchParams.get("coSo")).toBe("a&b=c");
  });
});

describe("[NLX-06] coSoHopLe", () => {
  it("trong phạm vi ⇒ giữ; ngoài phạm vi / rỗng ⇒ null; Hội sở nhận mọi cơ sở", () => {
    expect(coSoHopLe(keToanCoSo("cs1"), "cs1")).toBe("cs1");
    expect(coSoHopLe(keToanCoSo("cs1"), "cs2")).toBeNull();
    expect(coSoHopLe(keToanCoSo("cs1"), "  ")).toBeNull();
    expect(coSoHopLe(keToanCoSo("cs1"), undefined)).toBeNull();
    expect(coSoHopLe(khongQuyen(), "cs1")).toBeNull();
    expect(coSoHopLe(keToanHoSo(), "cs9")).toBe("cs9");
  });
});

describe("[NLX-07] dinhDangThoiDiemVN", () => {
  it("theo giờ VN chứ không theo múi giờ máy chủ: 18:30Z là 01:30 NGÀY SAU; giữa trưa; qua năm", () => {
    expect(dinhDangThoiDiemVN(new Date("2026-10-30T18:30:00Z"))).toBe("31/10/2026 01:30");
    expect(dinhDangThoiDiemVN(new Date("2026-11-02T05:05:00Z"))).toBe("02/11/2026 12:05");
    expect(dinhDangThoiDiemVN(new Date("2026-12-31T17:00:00Z"))).toBe("01/01/2027 00:00");
  });
});
