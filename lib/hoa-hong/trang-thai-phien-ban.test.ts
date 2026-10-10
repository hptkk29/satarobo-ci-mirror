// @vitest-environment node
// [NHH-FE-TT-*] — NHÃN TRẠNG THÁI của phiên bản chính sách: một chỗ ánh xạ (status DB + ngày) → chữ + tông.
// Điểm dễ sai: ACTIVE KHÔNG đồng nghĩa "đang áp dụng" — bản kích hoạt nhưng chưa tới ngày là "Chờ hiệu lực", bản đã quá
// ngày kết thúc là "Hết hiệu lực". Màu không được là nghĩa duy nhất (luôn có chữ).
import { describe, expect, it } from "vitest";
import { trangThaiPhienBanHienThi } from "./trang-thai-phien-ban";

const NOW = new Date("2026-10-08T03:00:00.000Z");
const d = (iso: string) => new Date(iso);
const tt = (status: string, from: string, to: string | null = null) =>
  trangThaiPhienBanHienThi({ status: status as never, effectiveFrom: d(from), effectiveTo: to ? d(to) : null }, NOW);

describe("[NHH-FE-TT-01] trangThaiPhienBanHienThi", () => {
  it("DRAFT ⇒ Nháp (muted), bất kể ngày", () => {
    expect(tt("DRAFT", "2026-01-01T00:00:00Z")).toMatchObject({ khoa: "NHAP", nhan: "Nháp", tone: "muted" });
    expect(tt("DRAFT", "2027-01-01T00:00:00Z")).toMatchObject({ khoa: "NHAP" });
  });

  it("ACTIVE đã tới ngày, chưa kết thúc ⇒ Đang áp dụng (success)", () => {
    expect(tt("ACTIVE", "2026-10-01T00:00:00Z")).toMatchObject({ khoa: "DANG_AP_DUNG", nhan: "Đang áp dụng", tone: "success" });
    expect(tt("ACTIVE", "2026-10-01T00:00:00Z", "2026-12-31T17:00:00Z")).toMatchObject({ khoa: "DANG_AP_DUNG" });
  });

  it("ACTIVE chưa tới ngày ⇒ Chờ hiệu lực (info) — KHÔNG phải đang áp dụng", () => {
    expect(tt("ACTIVE", "2026-10-09T00:00:00Z")).toMatchObject({ khoa: "CHO_HIEU_LUC", nhan: "Chờ hiệu lực", tone: "info" });
  });

  it("ACTIVE mà effectiveTo đã qua (chưa ai đóng) ⇒ Hết hiệu lực; đúng tại biên mở effectiveTo = now cũng là hết", () => {
    expect(tt("ACTIVE", "2026-01-01T00:00:00Z", "2026-10-01T00:00:00Z")).toMatchObject({ khoa: "HET_HIEU_LUC" });
    expect(tt("ACTIVE", "2026-01-01T00:00:00Z", "2026-10-08T03:00:00Z")).toMatchObject({ khoa: "HET_HIEU_LUC" });
  });

  it("SUPERSEDED / EXPIRED / CANCELLED có nhãn riêng; huỷ là danger, còn lại muted", () => {
    expect(tt("SUPERSEDED", "2026-01-01T00:00:00Z")).toMatchObject({ khoa: "DA_THAY_THE", nhan: "Đã thay thế", tone: "muted" });
    expect(tt("EXPIRED", "2026-01-01T00:00:00Z")).toMatchObject({ khoa: "HET_HIEU_LUC", nhan: "Hết hiệu lực", tone: "muted" });
    expect(tt("CANCELLED", "2026-01-01T00:00:00Z")).toMatchObject({ khoa: "DA_HUY", nhan: "Đã huỷ", tone: "danger" });
  });

  it("mọi nhãn đều có chữ (không chỉ màu)", () => {
    for (const s of ["DRAFT", "ACTIVE", "SUPERSEDED", "EXPIRED", "CANCELLED"]) expect(tt(s, "2026-01-01T00:00:00Z").nhan.length).toBeGreaterThan(2);
  });
});
