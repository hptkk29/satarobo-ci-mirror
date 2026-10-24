// @vitest-environment node
/**
 * [NCS-*] — NGUỒN trong ô chọn của trình soạn chính sách: trạng thái hiện cho người soạn + chọn sẵn từ `?nguon=` (E2a, 09/10/2026). THUẦN.
 *
 *   [NCS-01] trạng thái: ACTIVE trong khoảng ⇒ hoạt động; ACTIVE ngoài khoảng ⇒ chưa hiệu lực / hết hạn (BIÊN: bắt đầu ĐÓNG, kết thúc MỞ); Nháp · Ngừng · Lưu trữ theo `status`
 *   [NCS-02] «qua cổng hoạt động» = ĐÚNG điều kiện của guardrail (`status = ACTIVE`): nguồn ngoài khoảng hiệu lực VẪN kích hoạt được chính sách — chỉ NÓI ra, không chặn
 *   [NCS-03] `?nguon=`: chọn sẵn chỉ khi mã có trong danh sách ∧ qua cổng; UNKNOWN · mã lạ · rỗng · Nháp · Ngừng · Lưu trữ ⇒ null (đối chứng dương: nguồn hoạt động ⇒ chọn)
 */
import { describe, expect, it } from "vitest";

import { khoaTrangThaiNguon, nguonChonSanTuMa, nguonQuaCongHoatDong, type KhoaTrangThaiNguon, type NguonSoan } from "./nguon-cho-soan";

const NOW = new Date("2026-10-09T03:00:00.000Z");
const NGAY = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("[NCS-01] khoaTrangThaiNguon", () => {
  const act = (effectiveFrom: Date | null, effectiveTo: Date | null) => khoaTrangThaiNguon({ status: "ACTIVE", effectiveFrom, effectiveTo }, NOW);

  it("ACTIVE không khoảng ⇒ HOAT_DONG; trong khoảng ⇒ HOAT_DONG", () => {
    expect(act(null, null)).toBe("HOAT_DONG");
    expect(act(NGAY("2026-09-01"), NGAY("2026-12-01"))).toBe("HOAT_DONG");
  });

  it("ACTIVE ngoài khoảng: chưa tới ⇒ CHUA_HIEU_LUC; đã qua ⇒ HET_HAN", () => {
    expect(act(NGAY("2026-11-01"), null)).toBe("CHUA_HIEU_LUC");
    expect(act(NGAY("2026-01-01"), NGAY("2026-09-30"))).toBe("HET_HAN");
  });

  it("BIÊN: đúng lúc bắt đầu ⇒ hoạt động (đóng); đúng lúc kết thúc ⇒ HẾT HẠN (mở)", () => {
    expect(act(NOW, null)).toBe("HOAT_DONG");
    expect(act(null, NOW)).toBe("HET_HAN");
    expect(act(null, new Date(NOW.getTime() + 1))).toBe("HOAT_DONG");
  });

  it("trạng thái khác ACTIVE đi theo `status`, kể cả khi khoảng hiệu lực trông hợp lệ", () => {
    const k = (status: "DRAFT" | "INACTIVE" | "ARCHIVED") => khoaTrangThaiNguon({ status, effectiveFrom: null, effectiveTo: null }, NOW);
    expect(k("DRAFT")).toBe("NHAP");
    expect(k("INACTIVE")).toBe("NGUNG");
    expect(k("ARCHIVED")).toBe("LUU_TRU");
  });
});

describe("[NCS-02] nguonQuaCongHoatDong = điều kiện của guardrail", () => {
  it("ba khoá của ACTIVE qua; Nháp · Ngừng · Lưu trữ không", () => {
    const qua: KhoaTrangThaiNguon[] = ["HOAT_DONG", "CHUA_HIEU_LUC", "HET_HAN"];
    const khong: KhoaTrangThaiNguon[] = ["NHAP", "NGUNG", "LUU_TRU"];
    for (const k of qua) expect(nguonQuaCongHoatDong(k), k).toBe(true);
    for (const k of khong) expect(nguonQuaCongHoatDong(k), k).toBe(false);
  });
});

describe("[NCS-03] nguonChonSanTuMa (?nguon=)", () => {
  const n = (code: string, trangThai: KhoaTrangThaiNguon): NguonSoan => ({
    id: `id-${code}`,
    code,
    name: `Nguồn ${code}`,
    coHoaHong: true,
    trangThai,
    hieuLucTu: null,
    hieuLucDen: null,
    coNguoiPhuTrach: false,
    referrerRequirement: "NONE",
  });
  const ds = [n("TIKTOK_SHOP", "HOAT_DONG"), n("EXPO_2026", "HET_HAN"), n("CU", "NGUNG"), n("MOI", "NHAP"), n("XUA", "LUU_TRU"), n("UNKNOWN", "HOAT_DONG")];

  it("đối chứng dương: nguồn hoạt động (và hết hạn chọn — vẫn kích hoạt được) ⇒ chọn sẵn đúng nguồn", () => {
    expect(nguonChonSanTuMa("TIKTOK_SHOP", ds)?.id).toBe("id-TIKTOK_SHOP");
    expect(nguonChonSanTuMa(" TIKTOK_SHOP ", ds)?.id).toBe("id-TIKTOK_SHOP");
    expect(nguonChonSanTuMa("EXPO_2026", ds)?.id).toBe("id-EXPO_2026");
  });

  it("UNKNOWN ⇒ null kể cả khi danh sách (sai) có chứa nó; mã lạ · rỗng · null · undefined ⇒ null", () => {
    expect(nguonChonSanTuMa("UNKNOWN", ds)).toBeNull();
    for (const ma of ["KHONG_CO", "", "   ", null, undefined]) expect(nguonChonSanTuMa(ma, ds), String(ma)).toBeNull();
  });

  it("Nháp · Ngừng · Lưu trữ ⇒ null (chọn sẵn một nguồn mà Kích hoạt sẽ bị chặn là đặt bẫy)", () => {
    for (const ma of ["MOI", "CU", "XUA"]) expect(nguonChonSanTuMa(ma, ds), ma).toBeNull();
  });
});
