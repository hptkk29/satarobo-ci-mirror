import { describe, expect, it } from "vitest";

import { chuanHoaChoLuu, hanLuuThang, kiemNoiDungSucKhoe, luuSucKhoeSchema, tinhHetHanSucKhoe } from "./luu-may-chu";

/**
 * [SKM] Lưu sức khoẻ lên máy chủ (HL-01) — luật THUẦN. Ngày «hôm nay» là THAM SỐ (luật 19: không đọc đồng hồ thật).
 *   [SKM-01] lược đồ strict (khoá lạ/studentId/>6 người/>3 bản/uuid sai ⇒ từ chối) · [SKM-02] kiểm số đo bằng kiemBan · [SKM-03] ngày sinh + trùng id
 *   [SKM-04] hạn lưu: mặc định 12, env hợp lệ 1–60, rác ⇒ 12 · [SKM-05] hết hạn = cuối NGÀY VN, kẹp cuối tháng · [SKM-06] chuẩn hoá bản rõ trước khi mã hoá
 */
const HOM_NAY = "2026-11-22";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const nguoi = (n: number, o: Record<string, unknown> = {}) => ({ idCucBo: ID(n), tenGoi: "Bé An", vaiTro: "Con gái", ns: "2018-05-01", gt: "nu", hoatDong: "vua", mt: false, benhNen: false, ban: [{ ngay: "2026-11-01", cao: 120, nang: 25, eo: null }], ...o });
const body = (nguoiDs: unknown[] = [nguoi(1)], extra: Record<string, unknown> = {}) => ({ dongY: { phienBan: "v1", luc: "2026-11-22T01:00:00.000Z" }, nguoi: nguoiDs, ...extra });

describe("[SKM] lưu sức khoẻ lên máy chủ — luật thuần", () => {
  it("[SKM-01] lược đồ strict", () => {
    expect(luuSucKhoeSchema.safeParse(body()).success).toBe(true);
    expect(luuSucKhoeSchema.safeParse(body([], {})).success).toBe(true); // nguoi rỗng hợp lệ
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1)], { studentId: "x" })).success).toBe(false); // khoá lạ ở gốc
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1, { studentId: "x" })])).success).toBe(false); // khoá lạ ở người
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1, { ban: [{ ngay: "2026-11-01", cao: 120, nang: 25, eo: null, ghiChu: "x" }] })])).success).toBe(false); // khoá lạ ở bản
    expect(luuSucKhoeSchema.safeParse(body(Array.from({ length: 7 }, (_, i) => nguoi(i + 1)))).success).toBe(false); // > 6 người
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1, { ban: Array.from({ length: 4 }, () => ({ ngay: "2026-11-01", cao: 120, nang: 25, eo: null })) })])).success).toBe(false); // > 3 bản
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1, { idCucBo: "khong-phai-uuid" })])).success).toBe(false);
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1, { tenGoi: "x".repeat(41) })])).success).toBe(false);
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1, { gt: "khac" })])).success).toBe(false);
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1, { hoatDong: "rat-nhieu" })])).success).toBe(false); // hoatDong chỉ it|vua|nhieu
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1, { hoatDong: undefined })])).success).toBe(false); // bắt buộc
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1, { vaiTro: "x".repeat(31) })])).success).toBe(false);
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1, { vaiTro: null })])).success).toBe(true);
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1)], { truocCapNhatLuc: "2026-11-22T01:00:00.000Z" })).success).toBe(true);
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1)], { truocCapNhatLuc: null })).success).toBe(true);
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1)], { truocCapNhatLuc: "hom-qua" })).success).toBe(false);
    expect(luuSucKhoeSchema.safeParse({ nguoi: [] }).success).toBe(false); // thiếu dongY
    expect(luuSucKhoeSchema.safeParse(body([nguoi(1, { ban: [{ ngay: "2026-11-01", cao: Number.NaN, nang: 25, eo: null }] })])).success).toBe(false);
  });

  it("[SKM-02] số đo kiểm LẠI ở máy chủ (kiemBan)", () => {
    const k = (ban: unknown) => kiemNoiDungSucKhoe(luuSucKhoeSchema.parse(body([nguoi(1, { ban: [ban] })])), HOM_NAY);
    expect(k({ ngay: "2026-11-22", cao: 120, nang: 25, eo: null })).toEqual({ ok: true }); // ngày đo = hôm nay: được
    expect(k({ ngay: "2026-11-23", cao: 120, nang: 25, eo: null })).toMatchObject({ ok: false, field: "nguoi.0.ban.0" }); // tương lai
    expect(k({ ngay: "2026-11-01", cao: 39, nang: 25, eo: null })).toMatchObject({ ok: false });
    expect(k({ ngay: "2026-11-01", cao: 120, nang: 251, eo: null })).toMatchObject({ ok: false });
    expect(k({ ngay: "2026-11-01", cao: 120, nang: 25, eo: 29 })).toMatchObject({ ok: false });
    expect(k({ ngay: "2026-11-01", cao: 120, nang: 25, eo: 70 })).toEqual({ ok: true });
  });

  it("[SKM-03] ngày sinh hợp lệ + không trùng idCucBo", () => {
    const k = (ds: unknown[]) => kiemNoiDungSucKhoe(luuSucKhoeSchema.parse(body(ds)), HOM_NAY);
    expect(k([nguoi(1, { ns: "2026-11-23" })])).toMatchObject({ ok: false, field: "nguoi.0.ns" });
    expect(k([nguoi(1, { ns: "2026-02-30" })])).toMatchObject({ ok: false, field: "nguoi.0.ns" });
    expect(k([nguoi(1, { ns: "1899-12-31" })])).toMatchObject({ ok: false, field: "nguoi.0.ns" });
    expect(k([nguoi(1), nguoi(2, { idCucBo: ID(1).toUpperCase() })])).toMatchObject({ ok: false, field: "nguoi.1.idCucBo" });
    expect(k([nguoi(1), nguoi(2)])).toEqual({ ok: true });
  });

  it("[SKM-04] hạn lưu: mặc định 12; 1–60 hợp lệ; rác ⇒ 12 (không bao giờ vô hạn)", () => {
    expect(hanLuuThang(undefined)).toBe(12);
    expect(hanLuuThang("")).toBe(12);
    expect(hanLuuThang("1")).toBe(1);
    expect(hanLuuThang("60")).toBe(60);
    for (const rac of ["0", "61", "-3", "abc", "12.5", "Infinity", "1e3"]) expect(hanLuuThang(rac)).toBe(12);
  });

  it("[SKM-05] hết hạn = hết NGÀY VN, kẹp cuối tháng", () => {
    // 2026-11-22 10:00 VN + 12 tháng ⇒ hết ngày 22/11/2027 (VN) = 2027-11-22T16:59:59.999Z
    expect(tinhHetHanSucKhoe(new Date("2026-11-22T03:00:00.000Z"), 12).toISOString()).toBe("2027-11-22T16:59:59.999Z");
    // 31/01 + 1 tháng ⇒ 28/02 (kẹp)
    expect(tinhHetHanSucKhoe(new Date("2027-01-31T03:00:00.000Z"), 1).toISOString()).toBe("2027-02-28T16:59:59.999Z");
  });

  it("[SKM-06] chuẩn hoá bản rõ: tên trống ⇒ null; không có trường ngoài lược đồ", () => {
    const b = luuSucKhoeSchema.parse(body([nguoi(1, { tenGoi: "   ", vaiTro: "  " }), nguoi(2, { tenGoi: undefined, vaiTro: undefined })], { truocCapNhatLuc: "2026-11-22T01:00:00.000Z" }));
    const r = chuanHoaChoLuu(b);
    expect(r.nguoi.map((n) => n.tenGoi)).toEqual([null, null]);
    expect(r.nguoi.map((n) => n.vaiTro)).toEqual([null, null]);
    expect(Object.keys(r).sort()).toEqual(["dongY", "nguoi", "v"]);
    expect(Object.keys(r.nguoi[0]!).sort()).toEqual(["ban", "benhNen", "gt", "hoatDong", "idCucBo", "mt", "ns", "tenGoi", "vaiTro"]);
  });
});
