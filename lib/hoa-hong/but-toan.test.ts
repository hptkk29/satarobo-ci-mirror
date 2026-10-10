// @vitest-environment node
/**
 * [NHH-COM-13] / [NHH-COM-01b] — phân loại bút toán `Payment` (04 §4.1) và mốc thời gian/cơ sở của nó (04 §1 `mocCuaButToan`).
 * Cùng với `chu-so-huu` [NHH-PER-03*]. THUẦN.
 */
import { describe, it, expect } from "vitest";

import { loaiButToan, mocCuaButToan, type HangButToan } from "./but-toan";
import { chuSoHuuButToan, thangThuocSoMoi, type KyCu } from "./chu-so-huu";
import { TRANG_THAI_THUC_THU } from "@/lib/finance/thuc-thu";

// Trạng thái "đã xác nhận" lấy từ hằng của trục A — không gõ tay (lưới `truc-a` cấm chép điều kiện ở nơi khác).
const DA_XAC_NHAN = TRANG_THAI_THUC_THU[0];

const D = (s: string) => new Date(s);

function hang(p: Partial<HangButToan> = {}): HangButToan {
  return {
    id: "pay-1",
    amount: 10_000_000,
    method: "cash",
    note: null,
    paidDate: D("2026-10-12T03:00:00.000Z"),
    confirmedAt: D("2026-10-13T03:00:00.000Z"),
    accountantStatus: DA_XAC_NHAN,
    paymentType: "PAYMENT",
    adjustmentOfId: null,
    orderId: "o1",
    orderItemId: null,
    enrollmentId: null,
    centerId: "cs1",
    adjustmentOf: null,
    order: { centerId: "cs-don", lead: { centerId: "cs-lead" } },
    ...p,
  };
}

describe("[NHH-COM-13] loaiButToan — bốn loại (04 §4.1)", () => {
  it("THU: số dương CONFIRMED, kể cả ADJUSTMENT delta DƯƠNG của adjustPayment", () => {
    expect(loaiButToan(hang())).toBe("THU");
    expect(loaiButToan(hang({ paymentType: "ADJUSTMENT", amount: 500_000, adjustmentOfId: "pay-0" }))).toBe("THU");
  });

  it("DAO_CO_GOC: số âm có adjustmentOfId — hoàn (REFUNDED), chi hoàn, điều chỉnh giảm, đảo do gỡ gắn", () => {
    expect(loaiButToan(hang({ amount: -4_000_000, accountantStatus: "REFUNDED", adjustmentOfId: "pay-0" }))).toBe("DAO_CO_GOC");
    expect(loaiButToan(hang({ amount: -1, paymentType: "ADJUSTMENT", adjustmentOfId: "pay-0" }))).toBe("DAO_CO_GOC");
  });

  it("CHUYEN_NOI_BO: method chuyen-noi-bo + marker [chuyen:<id>] — CẢ HAI vế (−X không gốc, +X là PAYMENT)", () => {
    const vaoCho = hang({ amount: -2_000_000, method: "chuyen-noi-bo", paymentType: "ADJUSTMENT", note: "đổi bé [chuyen:abc123]" });
    const vaoNhan = hang({ amount: 2_000_000, method: "chuyen-noi-bo", note: "đổi bé [chuyen:abc123]" });
    expect(loaiButToan(vaoCho)).toBe("CHUYEN_NOI_BO");
    expect(loaiButToan(vaoNhan)).toBe("CHUYEN_NOI_BO");
  });

  it("cấy: method chuyen-noi-bo mà KHÔNG có marker ⇒ không phải chuyển nội bộ (khoản âm không gốc ⇒ AM_KHONG_GOC)", () => {
    expect(loaiButToan(hang({ amount: -5, method: "chuyen-noi-bo", note: "không marker" }))).toBe("AM_KHONG_GOC");
    expect(loaiButToan(hang({ amount: 5, method: "chuyen-noi-bo", note: "không marker" }))).toBe("THU");
  });

  it("AM_KHONG_GOC: số âm không gốc, không phải chuyển nội bộ", () => {
    expect(loaiButToan(hang({ amount: -7, adjustmentOfId: null }))).toBe("AM_KHONG_GOC");
  });

  it("số 0 ⇒ ném (không phải bút toán)", () => {
    expect(() => loaiButToan(hang({ amount: 0 }))).toThrow();
  });
});

describe("mocCuaButToan — cơ sở · ngày gốc · ngày phụ trách (04 §1)", () => {
  it("cơ sở: Payment.centerId → order.centerId → lead.centerId; thiếu cả ba ⇒ null", () => {
    expect(mocCuaButToan(hang()).centerId).toBe("cs1");
    expect(mocCuaButToan(hang({ centerId: null })).centerId).toBe("cs-don");
    expect(mocCuaButToan(hang({ centerId: null, order: { centerId: null, lead: { centerId: "cs-lead" } } })).centerId).toBe("cs-lead");
    expect(mocCuaButToan(hang({ centerId: null, order: { centerId: null, lead: null } })).centerId).toBeNull();
    expect(mocCuaButToan(hang({ centerId: null, order: null })).centerId).toBeNull();
  });

  it("khoản THU thường: rateDate = paidDate; assigneeDate = confirmedAt (hoặc paidDate nếu chưa có)", () => {
    const m = mocCuaButToan(hang());
    expect(m.rateDate).toEqual(D("2026-10-12T03:00:00.000Z"));
    expect(m.assigneeDate).toEqual(D("2026-10-13T03:00:00.000Z"));
    expect(m.refundOfPaymentId).toBeNull();
    expect(mocCuaButToan(hang({ confirmedAt: null })).assigneeDate).toEqual(D("2026-10-12T03:00:00.000Z"));
  });

  it("khoản HOÀN: rateDate = ngày GỐC (đòi lại đúng tỉ lệ đã trả); assigneeDate = confirmedAt của GỐC, không phải lúc bấm hoàn", () => {
    const m = mocCuaButToan(
      hang({
        amount: -4_000_000,
        accountantStatus: "REFUNDED",
        adjustmentOfId: "pay-0",
        paidDate: D("2026-11-20T03:00:00.000Z"),
        confirmedAt: D("2026-11-20T03:00:00.000Z"),
        adjustmentOf: { id: "pay-0", paidDate: D("2026-10-12T03:00:00.000Z"), confirmedAt: D("2026-10-13T03:00:00.000Z"), centerId: "cs1" },
      }),
    );
    expect(m.rateDate).toEqual(D("2026-10-12T03:00:00.000Z"));
    expect(m.assigneeDate).toEqual(D("2026-10-13T03:00:00.000Z"));
    expect(m.refundOfPaymentId).toBe("pay-0");
    expect(m.paidDate).toEqual(D("2026-11-20T03:00:00.000Z")); // kỳ đi theo ngày HOÀN
  });

  it("ADJUSTMENT có gốc: assigneeDate theo GỐC (adjustPayment đặt confirmedAt = now — lấy mốc đó là đổi chủ sau lưng)", () => {
    const m = mocCuaButToan(
      hang({
        paymentType: "ADJUSTMENT",
        amount: 500_000,
        adjustmentOfId: "pay-0",
        paidDate: D("2026-07-05T03:00:00.000Z"),
        confirmedAt: D("2026-10-01T03:00:00.000Z"),
        adjustmentOf: { id: "pay-0", paidDate: D("2026-07-05T03:00:00.000Z"), confirmedAt: D("2026-07-06T03:00:00.000Z"), centerId: "cs1" },
      }),
    );
    expect(m.assigneeDate).toEqual(D("2026-07-06T03:00:00.000Z"));
    expect(m.rateDate).toEqual(D("2026-07-05T03:00:00.000Z"));
  });
});

describe("[NHH-PER-03] chuSoHuuButToan — bút toán này thuộc engine CŨ hay MỚI (04 §3.1)", () => {
  const kyCuLa = (m: Record<string, KyCu>) => (ky: string) => m[ky] ?? null;
  const ctx = (m: Record<string, KyCu> = {}) => ({ kyCutover: "2026-10", kyCu: kyCuLa(m) });
  const bt = (iso: string, id = "p1") => ({ id, paidDate: D(iso) });

  it("kỳ tự nhiên ≥ mốc ⇒ MỚI, bất kể kỳ cũ", () => {
    expect(chuSoHuuButToan(bt("2026-10-15T03:00:00.000Z"), ctx())).toBe("MOI");
    expect(chuSoHuuButToan(bt("2026-12-01T03:00:00.000Z"), ctx({ "2026-12": { trangThai: "APPROVED", manifest: new Set() } }))).toBe("MOI");
  });

  it("kỳ < mốc: không có bảng kê / DRAFT / REOPENED ⇒ CŨ (lần chốt lại kế tiếp của engine cũ sẽ thấy nó)", () => {
    const b = bt("2026-09-10T03:00:00.000Z");
    expect(chuSoHuuButToan(b, ctx())).toBe("CU");
    expect(chuSoHuuButToan(b, ctx({ "2026-09": { trangThai: "DRAFT", manifest: null } }))).toBe("CU");
    expect(chuSoHuuButToan(b, ctx({ "2026-09": { trangThai: "REOPENED", manifest: null } }))).toBe("CU");
  });

  it("kỳ < mốc, APPROVED: có trong manifest ⇒ CŨ; KHÔNG có (đến muộn) ⇒ MỚI; manifest = null ⇒ giữ MANUAL_REVIEW_REQUIRED", () => {
    const b = bt("2026-09-10T03:00:00.000Z", "p-trong");
    expect(chuSoHuuButToan(b, ctx({ "2026-09": { trangThai: "APPROVED", manifest: new Set(["p-trong"]) } }))).toBe("CU");
    expect(chuSoHuuButToan({ ...b, id: "p-muon" }, ctx({ "2026-09": { trangThai: "APPROVED", manifest: new Set(["p-trong"]) } }))).toBe("MOI");
    expect(chuSoHuuButToan(b, ctx({ "2026-09": { trangThai: "APPROVED", manifest: null } }))).toEqual({ giu: "MANUAL_REVIEW_REQUIRED" });
  });

  it("[NHH-COM-14] biên kỳ theo GIỜ VN: 23:30 +07 ngày cuối tháng 9 vẫn là kỳ 09; 00:30 +07 ngày 01/10 là kỳ 10", () => {
    // 2026-09-30 23:30 +07 = 16:30Z ; 2026-10-01 00:30 +07 = 17:30Z ngày 30/9
    expect(chuSoHuuButToan(bt("2026-09-30T16:30:00.000Z"), ctx())).toBe("CU");
    expect(chuSoHuuButToan(bt("2026-09-30T17:30:00.000Z"), ctx())).toBe("MOI");
  });

  it("thangThuocSoMoi: k ≥ mốc HOẶC đã có dòng sổ mới trong tháng k (vế hai giữ đúng kể cả khi mốc bị SQL tay)", () => {
    expect(thangThuocSoMoi("2026-10", { kyCutover: "2026-10", coDongSoMoi: false })).toBe(true);
    expect(thangThuocSoMoi("2026-09", { kyCutover: "2026-10", coDongSoMoi: false })).toBe(false);
    expect(thangThuocSoMoi("2026-09", { kyCutover: "2026-10", coDongSoMoi: true })).toBe(true);
    expect(thangThuocSoMoi("2026-09", { kyCutover: null, coDongSoMoi: true })).toBe(true);
    expect(thangThuocSoMoi("2026-12", { kyCutover: null, coDongSoMoi: false })).toBe(false);
  });
});
