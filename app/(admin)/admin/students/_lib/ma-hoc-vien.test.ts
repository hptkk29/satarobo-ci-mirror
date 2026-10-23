/**
 * Ca [MHV-*] — chỉ Quản trị tối cao (`students:change-code`) đặt / đổi mã học viên [26/09/2026].
 * Chủ dự án: "mã học viên không được chỉnh sửa, chỉ admin được chỉnh".
 */
import { describe, expect, it } from "vitest";
import { LOI_DOI_MA_HOC_VIEN, quyetDinhMaHocVien } from "./ma-hoc-vien";

describe("quyetDinhMaHocVien", () => {
  it("[MHV-01] SỬA, không có quyền, mã KHÁC mã đang lưu ⇒ TỪ CHỐI (nói rõ, không lặng lẽ bỏ)", () => {
    expect(
      quyetDinhMaHocVien({ cheDo: "sua", maGui: "CS1.HV.9999", maHienTai: "CS1.HV.0001", duocDoiMa: false }),
    ).toEqual({ ok: false, loi: LOI_DOI_MA_HOC_VIEN });
  });

  it("[MHV-02] SỬA, không có quyền, gửi lại ĐÚNG mã đang lưu ⇒ cho qua nhưng không ghi mã", () => {
    expect(
      quyetDinhMaHocVien({ cheDo: "sua", maGui: " CS1.HV.0001 ", maHienTai: "CS1.HV.0001", duocDoiMa: false }),
    ).toEqual({ ok: true, ma: undefined });
  });

  it("[MHV-03] TẠO, không có quyền ⇒ bỏ mã gửi lên (hệ thống tự sinh)", () => {
    expect(
      quyetDinhMaHocVien({ cheDo: "tao", maGui: "TU-DAT", maHienTai: null, duocDoiMa: false }),
    ).toEqual({ ok: true, ma: undefined });
  });

  it("[MHV-04] đối chứng dương: CÓ quyền ⇒ giữ đúng mã gửi lên, cả tạo lẫn sửa", () => {
    expect(
      quyetDinhMaHocVien({ cheDo: "sua", maGui: "CS1.HV.9999", maHienTai: "CS1.HV.0001", duocDoiMa: true }),
    ).toEqual({ ok: true, ma: "CS1.HV.9999" });
    expect(
      quyetDinhMaHocVien({ cheDo: "tao", maGui: "TU-DAT", maHienTai: null, duocDoiMa: true }),
    ).toEqual({ ok: true, ma: "TU-DAT" });
  });
});
