import { describe, expect, it } from "vitest";

import { kiemTaiKhoanNhanDonOnline } from "./tai-khoan-nhan";

/**
 * [TKN] Tiền Online chỉ được tính khi về ĐÚNG tài khoản nhận đã chụp vào đơn (V8.33).
 *   [TKN-01] đơn không có bản chụp ⇒ không kiểm (Offline/đơn cũ giữ nguyên) · [TKN-02] đúng tài khoản (so chữ số) ⇒ ok · [TKN-03] VA trùng ⇒ ok
 *   [TKN-04] tài khoản KHÁC ⇒ giữ lại, lý do KHÔNG lộ số đầy đủ · [TKN-05] thiếu số ⇒ giữ lại (fail-closed) · [TKN-06] bản chụp hỏng ⇒ giữ lại
 */
const SNAP = { phienBan: 1, configId: "c1", mode: "TEST", memoPrefix: "SR", nganHang: { ma: "970436", ten: "VCB" }, soTaiKhoan: "0011 004 123 456", tenTaiKhoan: "CTY SATAROBO", phapNhan: { id: "le1", tenPhapLy: "Cty SataRobo", maSoThue: "0402301783" }, chupLuc: "2026-11-22T00:00:00.000Z" };

describe("[TKN] kiemTaiKhoanNhanDonOnline", () => {
  it("[TKN-01] không bản chụp (null/undefined) ⇒ ok, bất kể số tài khoản webhook", () => {
    expect(kiemTaiKhoanNhanDonOnline(null, "999")).toEqual({ ok: true });
    expect(kiemTaiKhoanNhanDonOnline(undefined, null)).toEqual({ ok: true });
  });
  it("[TKN-02] trùng tài khoản (bỏ khoảng trắng/dấu) ⇒ ok", () => {
    expect(kiemTaiKhoanNhanDonOnline(SNAP, "0011004123456")).toEqual({ ok: true });
    expect(kiemTaiKhoanNhanDonOnline(SNAP, "0011-004-123-456")).toEqual({ ok: true });
  });
  it("[TKN-03] chỉ VA trùng ⇒ ok", () => {
    expect(kiemTaiKhoanNhanDonOnline(SNAP, "9999", "0011004123456")).toEqual({ ok: true });
  });
  it("[TKN-04] tài khoản KHÁC ⇒ giữ lại; lý do che số (chỉ 4 số cuối)", () => {
    const r = kiemTaiKhoanNhanDonOnline(SNAP, "1234567890123");
    expect(r).toMatchObject({ ok: false, ma: "SAI_TAI_KHOAN" });
    if (!r.ok) {
      expect(r.lyDo).not.toContain("1234567890123");
      expect(r.lyDo).not.toContain("0011004123456");
      expect(r.lyDo).toContain("3456");
    }
  });
  it("[TKN-05] thiếu cả tài khoản lẫn VA ⇒ giữ lại (fail-closed)", () => {
    expect(kiemTaiKhoanNhanDonOnline(SNAP, null, null)).toMatchObject({ ok: false, ma: "THIEU_TAI_KHOAN" });
    expect(kiemTaiKhoanNhanDonOnline(SNAP, "  ", "")).toMatchObject({ ok: false, ma: "THIEU_TAI_KHOAN" });
  });
  it("[TKN-06] bản chụp có nhưng KHÔNG đọc được ⇒ giữ lại (không tự coi là ok)", () => {
    expect(kiemTaiKhoanNhanDonOnline({ phienBan: 9 }, "0011004123456")).toMatchObject({ ok: false });
    expect(kiemTaiKhoanNhanDonOnline("rac", "0011004123456")).toMatchObject({ ok: false });
  });
});
