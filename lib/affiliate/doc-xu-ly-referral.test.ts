// @vitest-environment node
/**
 * [DXR-*] — phần THUẦN của đọc xử lý tay referral: điều kiện tìm phiếu khách theo quyền, đọc `detail` của sự kiện (AFF-L3b).
 * (Phần chạm DB — cách ly cơ sở, che PII thật — ở `tests/hoa-hong/affiliate-referral-xem-tay.spec.ts` [RXT-DB-18].)
 *
 *   [DXR-01] q ngắn (< 3 ký tự) ⇒ không điều kiện nào
 *   [DXR-02] CHỈ có quyền xử lý (không xem khách): chỉ tìm được theo MÃ / id trần — KHÔNG theo tên, KHÔNG theo SĐT
 *   [DXR-03] xem khách: thêm tên; SĐT vẫn KHÔNG (ô tìm SĐT không gác quyền là rò gián tiếp)
 *   [DXR-04] xem PII: thêm SĐT (mọi dạng 0… / 84… / +84…); xem PII mà KHÔNG xem khách ⇒ vẫn không (bất biến một chỗ)
 *   [DXR-05] `docChiTietSuKien`: chỉ giữ khoá đã biết; rác ⇒ mặc định an toàn
 */
import { describe, expect, it } from "vitest";
import { chuanQuyenTimPhieu, docChiTietSuKien, dungDieuKienTimPhieu } from "./doc-xu-ly-referral";

const MA = "a1B2c3";
const ID = "cmv5zyq8s00tj91orjtzbazpp";
const PHONE = "0907555123";
const K0 = { xemKhach: false, xemPii: false };
const K1 = { xemKhach: true, xemPii: false };
const K2 = { xemKhach: true, xemPii: true };

const coCot = (dk: ReturnType<typeof dungDieuKienTimPhieu>, cot: "id" | "parentName" | "phone") => dk.some((x) => cot in x);

describe("[DXR-01] q ngắn", () => {
  it("rỗng / 1–2 ký tự / toàn khoảng trắng ⇒ không điều kiện, với mọi quyền", () => {
    for (const q of ["", "a", "ab", "   ", " ab "]) for (const k of [K0, K1, K2]) expect(dungDieuKienTimPhieu(q, k), `"${q}"`).toEqual([]);
  });
});

describe("[DXR-02] chỉ có quyền xử lý (không xem khách)", () => {
  it("mã 6 ký tự ⇒ khớp đuôi id (không phân biệt hoa thường); id trần ⇒ khớp đúng id", () => {
    expect(dungDieuKienTimPhieu(MA, K0)).toEqual([{ id: { endsWith: "a1b2c3" } }]);
    expect(dungDieuKienTimPhieu(MA.toUpperCase(), K0)).toEqual([{ id: { endsWith: "a1b2c3" } }]);
    expect(dungDieuKienTimPhieu(ID, K0)).toEqual([{ id: ID }]);
  });
  it("tên và SĐT KHÔNG tìm được: không điều kiện parentName / phone", () => {
    expect(dungDieuKienTimPhieu("Nguyễn Thị", K0)).toEqual([]);
    expect(dungDieuKienTimPhieu(PHONE, K0)).toEqual([]);
    expect(dungDieuKienTimPhieu("+84907555123", K0)).toEqual([]);
  });
});

describe("[DXR-03] xem khách (không PII)", () => {
  it("có điều kiện tên; SĐT vẫn KHÔNG", () => {
    const ten = dungDieuKienTimPhieu("Nguyễn Thị", K1);
    expect(coCot(ten, "parentName")).toBe(true);
    expect(coCot(ten, "phone")).toBe(false);
    const sdt = dungDieuKienTimPhieu(PHONE, K1);
    expect(coCot(sdt, "phone")).toBe(false);
    expect(coCot(sdt, "parentName")).toBe(true); // chuỗi số vẫn có thể là một phần tên — nhưng KHÔNG dò được SĐT
  });
});

describe("[DXR-04] xem PII", () => {
  it("SĐT mọi dạng ⇒ điều kiện theo ba dạng lưu (0…, 84…, +84…)", () => {
    for (const q of [PHONE, "84907555123", "+84907555123", "0907 555 123"]) {
      const dk = dungDieuKienTimPhieu(q, K2);
      const p = dk.find((x) => "phone" in x) as { phone: { in: string[] } } | undefined;
      expect(p, q).toBeDefined();
      expect(p!.phone.in).toEqual(expect.arrayContaining(["84907555123", PHONE, "+84907555123"]));
    }
  });
  it("xem PII mà KHÔNG xem khách ⇒ KHÔNG tìm được SĐT (một bất biến, một chỗ)", () => {
    const k = { xemKhach: false, xemPii: true };
    expect(chuanQuyenTimPhieu(k)).toEqual({ xemKhach: false, xemPii: false });
    expect(coCot(dungDieuKienTimPhieu(PHONE, k), "phone")).toBe(false);
  });
  it("chuỗi không phải SĐT ⇒ không điều kiện phone dù có quyền", () => {
    expect(coCot(dungDieuKienTimPhieu("Nguyễn Thị", K2), "phone")).toBe(false);
  });
});

describe("[DXR-05] docChiTietSuKien", () => {
  it("giữ đúng khoá đã biết", () => {
    expect(docChiTietSuKien({ ghiNguon: "TAO_MOI", tuDuyet: true, khacLa: "x", soDienThoai: "0907" })).toEqual({ ghiNguon: "TAO_MOI", tuDuyet: true });
    expect(docChiTietSuKien({ ghiNguon: "DE_NHOM_CHO" })).toEqual({ ghiNguon: "DE_NHOM_CHO", tuDuyet: false });
    expect(docChiTietSuKien({ ghiNguon: "DA_DUNG_NGUOI", tuDuyet: false })).toEqual({ ghiNguon: "DA_DUNG_NGUOI", tuDuyet: false });
  });
  it("rác ⇒ mặc định an toàn (không ném)", () => {
    for (const x of [null, undefined, 5, "x", [], { ghiNguon: "LA" }, { tuDuyet: "true" }]) {
      expect(docChiTietSuKien(x), JSON.stringify(x)).toEqual({ ghiNguon: null, tuDuyet: false });
    }
  });
});
