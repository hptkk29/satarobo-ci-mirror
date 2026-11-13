// Ca [NK-*] — MỘT khoản thu đến từ giao dịch nào, và còn lại bao nhiêu tiền thật.
//
// Hai câu hỏi này là nền của cả module hoá đơn (docs/ke-toan-hoa-don/PLAN.md §2.1 + §3.1):
// hàng chờ, cách gom "lần thu", cổng xác nhận và báo cáo đo GĐ 0 đều đọc chúng. Định nghĩa
// nằm ở MỘT chỗ để báo cáo đo prod và màn hình không thể trả lời khác nhau.
//
// Chuỗi marker trong fixture dựng bằng CHÍNH hàm sinh marker của đường ghi thật
// (`gatewayMarker`, `markerGanTay`, `markerTach`, `markerChuyen`…), không gõ tay: đường ghi
// đổi hình dạng chuỗi thì ca ở đây đỏ theo, thay vì xanh trên một chuỗi không còn ai ghi ra.
import { describe, it, expect } from "vitest";
import {
  AUTO_ORDER_CONFIRM_MARKER,
  BACKFILL_PAYMENT_MARKER,
  dauDongSheet,
  gatewayMarker,
  installmentMarker,
} from "@/lib/finance/payment-markers";
import { markerChuyen, markerGanTay, markerTach, markerWebhook } from "@/lib/finance/ghi-tien-don";
import { nguonGiaoDich, soTienRong, type DongSo } from "./nguon-khoan";

describe("[NK-01] nguonGiaoDich — đọc marker ra giao dịch ngân hàng", () => {
  it("webhook: tách được provider + mã giao dịch, provider về chữ THƯỜNG như marker ghi", () => {
    const note = `Thu tự động ${gatewayMarker("SEPAY", "FT24268123456")}`;
    expect(nguonGiaoDich(note)).toEqual({
      loai: "WEBHOOK",
      provider: "sepay",
      providerTxnId: "FT24268123456",
    });
  });

  it("webhook: marker của đường gỡ gắn (`markerWebhook`) cùng hình dạng với marker cổng", () => {
    // Hai hàm sinh cùng một chuỗi ở hai tệp — ca này khoá rằng parser đọc được CẢ HAI.
    expect(nguonGiaoDich(markerWebhook("PAYOS", "123456789"))).toEqual({
      loai: "WEBHOOK",
      provider: "payos",
      providerTxnId: "123456789",
    });
  });

  it("gắn tay theo con: trả id của BẢNG BankTransaction", () => {
    const note = `Gắn tay giao dịch SEPAY FT24 ${markerGanTay("cm_bt_1")}`;
    expect(nguonGiaoDich(note)).toEqual({ loai: "GAN_TAY", bankTransactionId: "cm_bt_1" });
  });

  it("phần TÁCH chép note gốc ⇒ vẫn trỏ về giao dịch gốc", () => {
    // tachKhoanChoCon: `${khoan.note} ${markerTach(id)}` — marker ngân hàng đi theo sang phần.
    const note = `${gatewayMarker("SEPAY", "FT999")} ${markerTach("cm_goc")}`;
    expect(nguonGiaoDich(note)).toEqual({ loai: "WEBHOOK", provider: "sepay", providerTxnId: "FT999" });
  });

  it("lời khai theo đơn / theo đợt KHÔNG phải giao dịch — cả hai marker", () => {
    expect(nguonGiaoDich(AUTO_ORDER_CONFIRM_MARKER)).toEqual({ loai: "LOI_KHAI" });
    expect(nguonGiaoDich(installmentMarker(2))).toEqual({ loai: "LOI_KHAI" });
    // Lookahead `order-`: marker lời khai KHÔNG được đọc thành provider "order-installment".
    expect(nguonGiaoDich(installmentMarker(12))).not.toHaveProperty("provider");
  });

  it("nhập lịch sử thắng mọi họ khác — dòng sheet mang cả dấu sheet lẫn backfill", () => {
    expect(nguonGiaoDich(`${BACKFILL_PAYMENT_MARKER} ${dauDongSheet("HP 2025", 12)}`)).toEqual({
      loai: "LICH_SU",
    });
    expect(nguonGiaoDich(dauDongSheet("HP", 3))).toEqual({ loai: "LICH_SU" });
  });

  it("nhập lịch sử thắng CẢ marker ngân hàng đứng cùng chuỗi (khoá THỨ TỰ xét)", () => {
    // Phép cấy 25/09 (đảo nhánh LỊCH SỬ xuống sau WEBHOOK) để 15/15 ca XANH — không ca nào
    // dựng note mang cả hai họ. Ca này bịt đúng lỗ đó: tiền lịch sử đã xuất hoá đơn ngoài hệ
    // thống thì không được đọc thành một giao dịch mới chờ xuất.
    expect(nguonGiaoDich(`${BACKFILL_PAYMENT_MARKER} ${gatewayMarker("SEPAY", "FT1")}`)).toEqual({
      loai: "LICH_SU",
    });
    expect(nguonGiaoDich(`${dauDongSheet("HP", 7)} ${markerGanTay("cm_bt_9")}`)).toEqual({ loai: "LICH_SU" });
  });

  it("chuyển nội bộ giữa hai bé", () => {
    expect(nguonGiaoDich(`Nhận từ bé khác cùng đơn — lý do ${markerChuyen("cm_c")}`)).toEqual({
      loai: "CHUYEN_NOI_BO",
    });
  });

  it("không marker / note trống / null ⇒ KHONG (tiền mặt, ghi tay)", () => {
    expect(nguonGiaoDich("PH đóng tiền mặt tại quầy")).toEqual({ loai: "KHONG" });
    expect(nguonGiaoDich("")).toEqual({ loai: "KHONG" });
    expect(nguonGiaoDich(null)).toEqual({ loai: "KHONG" });
  });
});

describe("[NK-02] soTienRong — tiền thật còn lại sau mọi bút toán trỏ về khoản", () => {
  const khoan = (id: string, amount: number, adjustmentOfId: string | null = null, xoa = false): DongSo => ({
    id,
    amount,
    adjustmentOfId,
    deletedAt: xoa ? new Date("2026-09-20T00:00:00Z") : null,
  });

  it("khoản không bị ai trỏ vào ⇒ giữ nguyên số", () => {
    expect(soTienRong([khoan("a", 3_000_000)]).get("a")).toBe(3_000_000);
  });

  it("TÁCH: gốc bị đảo trọn ⇒ gốc = 0, các phần giữ số của mình (Σ = 1× chứ không 2×)", () => {
    const rong = soTienRong([
      khoan("goc", 6_000_000),
      khoan("dao", -6_000_000, "goc"),
      khoan("p1", 3_500_000),
      khoan("p2", 2_500_000),
    ]);
    expect(rong.get("goc")).toBe(0);
    expect((rong.get("goc") ?? 0) + (rong.get("p1") ?? 0) + (rong.get("p2") ?? 0)).toBe(6_000_000);
  });

  it("HOÀN một phần: dòng hoàn là số ÂM trỏ về gốc ⇒ gốc còn phần chưa hoàn", () => {
    expect(soTienRong([khoan("g", 5_000_000), khoan("h", -2_000_000, "g")]).get("g")).toBe(3_000_000);
  });

  it("ĐIỀU CHỈNH một phần (delta dương lẫn âm) cộng dồn, không loại oan khoản", () => {
    const rong = soTienRong([
      khoan("g", 4_000_000),
      khoan("d1", -500_000, "g"),
      khoan("d2", 200_000, "g"),
    ]);
    expect(rong.get("g")).toBe(3_700_000);
  });

  it("dòng trỏ vào đã XOÁ MỀM thì không trừ", () => {
    expect(soTienRong([khoan("g", 1_000_000), khoan("x", -1_000_000, "g", true)]).get("g")).toBe(1_000_000);
  });

  it("thứ tự dòng không đổi kết quả (dòng đảo đứng TRƯỚC gốc)", () => {
    expect(soTienRong([khoan("dao", -700_000, "goc"), khoan("goc", 700_000)]).get("goc")).toBe(0);
  });

  it("dòng trỏ về một gốc KHÔNG có trong danh sách thì không tạo khoá ma", () => {
    const rong = soTienRong([khoan("dao", -1, "khong-co")]);
    expect(rong.has("khong-co")).toBe(false);
  });
});
