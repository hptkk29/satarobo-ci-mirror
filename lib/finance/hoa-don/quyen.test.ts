// Ca [HDQ-*] — "người này có phải KẾ TOÁN của cơ sở giữ đơn không".
//
// Vì sao không dùng `checkPermission("payments:confirm", { centerId })`: quyền này seed GLOBAL, và
// nhánh GLOBAL của `can()` trả true KHÔNG nhìn target (lib/auth/can.ts). Ở local/CI (v1) target bị
// bỏ qua hẳn. Còn tầm nhìn của `scopedDb` là PHÉP HỢP theo tiền tố `payments:` — nên một người vừa
// là CENTER_ACCOUNTANT@CS1 vừa là CENTER_SALES_CSM@CS2 (`payments:record`) THẤY hoá đơn CS2 và qua
// được `checkPermission("payments:confirm")` trần. PLAN §9: mọi đường GHI + tải bản NHÁP phải hỏi
// tập cơ sở của ĐÚNG quyền `payments:confirm`.
import { describe, it, expect } from "vitest";
import { coQuyenKeToanTaiCoSo, coQuyenKeToanVoiGhiDanh, duocTaiBanHoaDon, phamViKeToan, QUYEN_KE_TOAN_HOA_DON } from "./quyen";

type Actor = Parameters<typeof coQuyenKeToanTaiCoSo>[0];
const quyen = (action: string, centerScope: "ALL" | string[] | null) => ({
  action,
  scopeType: "GLOBAL" as const,
  orgUnitId: "ou",
  roleCode: "X",
  centerScope,
});
const actor = (o: Partial<Actor> = {}): Actor => ({
  isSuperAdmin: false,
  grantsAllow: new Set<string>(),
  permissions: [],
  ...o,
});

describe("[HDQ-01] tập cơ sở theo ĐÚNG quyền payments:confirm", () => {
  it("khoá quyền là payments:confirm (không tạo quyền mới ⇒ không phải seed)", () => {
    expect(QUYEN_KE_TOAN_HOA_DON).toBe("payments:confirm");
  });

  it("kế toán CS1 + sale CS2 (kiêm) ⇒ CS1 có, CS2 KHÔNG", () => {
    const a = actor({
      permissions: [quyen("payments:confirm", ["cs1"]), quyen("payments:record", ["cs2"])],
    });
    expect(coQuyenKeToanTaiCoSo(a, "cs1")).toBe(true);
    expect(coQuyenKeToanTaiCoSo(a, "cs2")).toBe(false);
  });

  it("kế toán Hội sở (centerScope ALL) ⇒ mọi cơ sở", () => {
    const a = actor({ permissions: [quyen("payments:confirm", "ALL")] });
    expect(coQuyenKeToanTaiCoSo(a, "cs2")).toBe(true);
  });

  it("SUPER_ADMIN ⇒ mọi cơ sở", () => {
    expect(coQuyenKeToanTaiCoSo(actor({ isSuperAdmin: true }), "cs9")).toBe(true);
  });

  it("đơn KHÔNG có cơ sở ⇒ false, kể cả kế toán Hội sở (hoá đơn đặt centerId NOT NULL)", () => {
    const a = actor({ permissions: [quyen("payments:confirm", "ALL")] });
    expect(coQuyenKeToanTaiCoSo(a, null)).toBe(false);
  });

  it("không giữ quyền nào / vai quan hệ (centerScope null) ⇒ false", () => {
    expect(coQuyenKeToanTaiCoSo(actor(), "cs1")).toBe(false);
    expect(coQuyenKeToanTaiCoSo(actor({ permissions: [quyen("payments:confirm", null)] }), "cs1")).toBe(false);
  });
});

describe("[HDQ-01b] phamViKeToan — tập cơ sở cho BỘ LỌC của màn hoá đơn, cùng nguồn với cổng ghi", () => {
  it("kế toán CS1 + sale CS2 (kiêm) ⇒ chỉ CS1 (ô lọc không bày CS2)", () => {
    const a = actor({ permissions: [quyen("payments:confirm", ["cs1"]), quyen("payments:record", ["cs2"])] });
    expect(phamViKeToan(a)).toEqual(["cs1"]);
  });

  it("không giữ payments:confirm ⇒ [] (fail-closed); kế toán Hội sở ⇒ ALL", () => {
    expect(phamViKeToan(actor({ permissions: [quyen("payments:record", ["cs2"])] }))).toEqual([]);
    expect(phamViKeToan(actor({ permissions: [quyen("payments:confirm", "ALL")] }))).toBe("ALL");
  });
});

describe("[HDQ-02] duocTaiBanHoaDon — MỘT luật cho route tải về và nút tải trên trang đơn", () => {
  it("kế toán của cơ sở giữ hoá đơn ⇒ tải MỌI bản (nháp, đã xác nhận, bị thay)", () => {
    for (const trangThai of ["NHAP", "DA_XAC_NHAN", "THAY_THE", "KHONG_XUAT"]) {
      expect(duocTaiBanHoaDon({ keToanCoSo: true, xemPii: false, trangThai }), trangThai).toBe(true);
    }
  });

  it("người có orders:view-pii ⇒ CHỈ bản ĐÃ XÁC NHẬN", () => {
    expect(duocTaiBanHoaDon({ keToanCoSo: false, xemPii: true, trangThai: "DA_XAC_NHAN" })).toBe(true);
    for (const trangThai of ["NHAP", "THAY_THE", "KHONG_XUAT"]) {
      expect(duocTaiBanHoaDon({ keToanCoSo: false, xemPii: true, trangThai }), trangThai).toBe(false);
    }
  });

  it("không giữ quyền nào ⇒ không bản nào, kể cả bản đã xác nhận", () => {
    expect(duocTaiBanHoaDon({ keToanCoSo: false, xemPii: false, trangThai: "DA_XAC_NHAN" })).toBe(false);
  });
});

describe("[KHGD-Q] GĐ 8b — ghi danh đích của phép gắn có trong phạm vi kế toán không", () => {
  it("[KHGD-Q1] kế toán Hội sở (ALL) ⇒ mọi cơ sở, KỂ CẢ ghi danh chưa gán cơ sở", () => {
    const a = actor({ permissions: [quyen("payments:confirm", "ALL")] });
    expect(coQuyenKeToanVoiGhiDanh(a, "cs2")).toBe(true);
    expect(coQuyenKeToanVoiGhiDanh(a, null)).toBe(true);
  });

  it("[KHGD-Q2] kế toán CS1 ⇒ CS1 có, CS2 KHÔNG, ghi danh chưa gán cơ sở KHÔNG (fail-closed)", () => {
    const a = actor({ permissions: [quyen("payments:confirm", ["cs1"])] });
    expect(coQuyenKeToanVoiGhiDanh(a, "cs1")).toBe(true);
    expect(coQuyenKeToanVoiGhiDanh(a, "cs2")).toBe(false);
    expect(coQuyenKeToanVoiGhiDanh(a, null)).toBe(false);
  });

  it("[KHGD-Q3] chỉ có payments:record ở CS1 (sale) ⇒ không cơ sở nào", () => {
    const a = actor({ permissions: [quyen("payments:record", ["cs1"])] });
    expect(coQuyenKeToanVoiGhiDanh(a, "cs1")).toBe(false);
  });
});
