// lib/validators/huy-phieu-the.test.ts — đầu vào của `huyPhieuTheAction` (Việc 4 · 09/10/2026).
//
// `xacNhanKhachChuaQuet` BẮT BUỘC, không mặc định (luật 7 + docs/luat-doc-so-va-ket-luan.md "tham số có mặc định NGUY HIỂM
// thì bỏ mặc định"): một mặc định `false` mà không ai truyền là nút xác nhận mạnh chết câm; một mặc định `true` là bỏ
// xác nhận. Thiếu ⇒ lỗi, để `tsc` + zod cùng bắt.
import { describe, expect, it } from "vitest";
import { GHI_CHU_HUY_TOI_DA, GHI_CHU_KHAC_TOI_THIEU, MA_LY_DO_HUY_PHIEU_THE } from "@/lib/payments/pos/huy-phieu-the-cau";
import { huyPhieuTheSchema } from "./huy-phieu-the";

const OK = { orderId: "ord_1", intentId: "int_1", lyDo: "MO_NHAM", xacNhanKhachChuaQuet: false } as const;

describe("[HN4-11] huyPhieuTheSchema", () => {
  it("đầu vào hợp lệ tối thiểu qua; ghi chú được trim và có thể vắng", () => {
    const r = huyPhieuTheSchema.safeParse(OK);
    expect(r.success).toBe(true);
    const g = huyPhieuTheSchema.safeParse({ ...OK, ghiChu: "  khách đổi ý  " });
    expect(g.success && g.data.ghiChu).toBe("khách đổi ý");
  });

  it("mỗi lý do hợp lệ qua; lý do lạ / thiếu bị chặn với câu tiếng Việt", () => {
    for (const lyDo of MA_LY_DO_HUY_PHIEU_THE) {
      expect(huyPhieuTheSchema.safeParse({ ...OK, lyDo, ghiChu: "ghi chú đủ dài" }).success, lyDo).toBe(true);
    }
    const la = huyPhieuTheSchema.safeParse({ ...OK, lyDo: "TUY_Y" });
    expect(la.success).toBe(false);
    const thieu = huyPhieuTheSchema.safeParse({ orderId: "o", intentId: "i", xacNhanKhachChuaQuet: false });
    expect(thieu.success).toBe(false);
    if (!thieu.success) expect(thieu.error.issues[0]?.message).toBe("Chọn lý do huỷ phiếu thẻ");
    if (!la.success) expect(la.error.issues[0]?.message).toBe("Chọn lý do huỷ phiếu thẻ");
  });

  it("'Khác' BẮT BUỘC có ghi chú (≥ 3 ký tự sau trim); các lý do khác không bắt buộc", () => {
    expect(huyPhieuTheSchema.safeParse({ ...OK, lyDo: "KHAC" }).success).toBe(false);
    expect(huyPhieuTheSchema.safeParse({ ...OK, lyDo: "KHAC", ghiChu: "  " }).success).toBe(false);
    expect(huyPhieuTheSchema.safeParse({ ...OK, lyDo: "KHAC", ghiChu: "ab" }).success).toBe(false);
    expect(huyPhieuTheSchema.safeParse({ ...OK, lyDo: "KHAC", ghiChu: "abc" }).success, "đúng biên 3 ký tự").toBe(true);
    expect(GHI_CHU_KHAC_TOI_THIEU).toBe(3);
    expect(huyPhieuTheSchema.safeParse({ ...OK, lyDo: "KHACH_DOI_CACH_TRA" }).success).toBe(true);
    const loi = huyPhieuTheSchema.safeParse({ ...OK, lyDo: "KHAC" });
    if (!loi.success) {
      expect(loi.error.issues[0]?.path).toEqual(["ghiChu"]);
      expect(loi.error.issues[0]?.message).toBe("Chọn “Khác” thì ghi chú lý do (ít nhất 3 ký tự)");
    }
  });

  it("ghi chú tối đa 200 ký tự (biên: 200 qua, 201 chặn)", () => {
    expect(huyPhieuTheSchema.safeParse({ ...OK, ghiChu: "a".repeat(GHI_CHU_HUY_TOI_DA) }).success).toBe(true);
    const qua = huyPhieuTheSchema.safeParse({ ...OK, ghiChu: "a".repeat(GHI_CHU_HUY_TOI_DA + 1) });
    expect(qua.success).toBe(false);
    if (!qua.success) expect(qua.error.issues[0]?.message).toBe("Ghi chú tối đa 200 ký tự");
  });

  it("`xacNhanKhachChuaQuet` BẮT BUỘC và phải là boolean thật (chuỗi 'true', số 1, vắng ⇒ chặn)", () => {
    const { xacNhanKhachChuaQuet: _bo, ...thieu } = OK;
    expect(huyPhieuTheSchema.safeParse(thieu).success).toBe(false);
    expect(huyPhieuTheSchema.safeParse({ ...OK, xacNhanKhachChuaQuet: "true" }).success).toBe(false);
    expect(huyPhieuTheSchema.safeParse({ ...OK, xacNhanKhachChuaQuet: 1 }).success).toBe(false);
    expect(huyPhieuTheSchema.safeParse({ ...OK, xacNhanKhachChuaQuet: true }).success).toBe(true);
    expect(huyPhieuTheSchema.safeParse({ ...OK, xacNhanKhachChuaQuet: null }).success).toBe(false);
  });

  it("mã đơn / mã phiếu: trim, không rỗng, ≤ 64 ký tự (khuôn ba action thu thẻ)", () => {
    expect(huyPhieuTheSchema.safeParse({ ...OK, orderId: "   " }).success).toBe(false);
    expect(huyPhieuTheSchema.safeParse({ ...OK, intentId: "" }).success).toBe(false);
    expect(huyPhieuTheSchema.safeParse({ ...OK, intentId: "x".repeat(65) }).success).toBe(false);
    const r = huyPhieuTheSchema.safeParse({ ...OK, orderId: "  o1  " });
    expect(r.success && r.data.orderId).toBe("o1");
  });

  it("khoá lạ bị bỏ (không lọt vào dữ liệu đã parse)", () => {
    const r = huyPhieuTheSchema.safeParse({ ...OK, intentIdKhac: "int_2", hack: 1 });
    expect(r.success).toBe(true);
    if (r.success) expect(Object.keys(r.data).sort()).toEqual(["intentId", "lyDo", "orderId", "xacNhanKhachChuaQuet"]);
  });
});
