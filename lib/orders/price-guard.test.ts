// lib/orders/price-guard.test.ts — [CG-01] hạ đơn giá trong payload phải ĐỂ LẠI DẤU.
//
// ĐO ĐƯỢC HÔM NAY (lỗ đang mở, không phải rủi ro tương lai):
//   · `createOrderManualAction` cộng thẳng `it.unitPrice` client gửi (_actions.ts:235-238)
//   · validator chỉ đòi `unitPrice: z.number().int().min(0)` (lib/validators/order.ts:19)
//   · `needsDiscountApproval` chỉ xét `discountAmount > 0` (lib/orders/discount.ts)
//     ⇒ đơn hạ ĐƠN GIÁ không vào hàng chờ duyệt
//   · tạo đơn KHÔNG ghi AuditLog nào (prisma/schema.prisma tự ghi nhận điều này)
//   ⇒ gửi `unitPrice: 1` cho khoá 12.480.000đ thì đơn tạo thành công, tuyệt đối vô dấu.
//
// ⚠️ VÌ SAO CHỈ GHI DẤU, KHÔNG TỪ CHỐI, VÀ KHÔNG QUY THÀNH `discountAmount`:
//
//  (a) TỪ CHỐI khi giá cao hơn niêm yết là chặn đúng nghiệp vụ đang bán. Công văn
//      SR.QD.219 Điều 5.2 nhân hệ số Coach 1-1 ×2,0 / 1-2 ×1,8 / 1-4 ×1,5 — đơn Coach
//      1-1 khoá đủ ĐÚNG BẰNG 2× `Course.price`. Repo đã hiện thực đúng thế ở
//      `lib/finance/coach-pricing.ts`.
//  (b) TỪ CHỐI khi thấp hơn cũng sai: bán 1 học phần = 1/4 khoá 48 buổi.
//  (c) QUY phần lệch thành `discountAmount` là hướng NGUY HIỂM NHẤT dù trông hợp lý
//      nhất. `needsDiscountApproval` trả true với MỌI `discountAmount > 0`, mà
//      `lib/payments/sepay.ts` gặp `PENDING_APPROVAL` thì trả `MANUAL`, và ở webhook
//      cửa ghi sổ chỉ chạy khi KHÔNG tra ra đơn — ca "có đơn + giảm giá chưa duyệt"
//      chỉ ghi IntegrationLog rồi return: KHÔNG BankTransaction, KHÔNG
//      PaymentRequest/Allocation, KHÔNG Payment. Tiền vào bank, ba sổ trống.
//      Cổng đó chưa từng chạy thật trên prod; quy lệch thành giảm giá là BẬT nó lên
//      hàng loạt.
//
// Nên luật ở đây là: SO, PHÂN LOẠI, GHI DẤU. Quyết định chặn hay không là chính sách,
// và chính sách chưa chốt thì không được cài cứng vào đường tiền.
import { describe, it, expect } from "vitest";
import { soSanhGia, soatGiaDon, LECH_GIA } from "./price-guard";

describe("[CG-01] so một dòng với giá niêm yết", () => {
  it("khớp đúng → KHOP, lệch 0", () => {
    expect(soSanhGia({ giaNiemYet: 12_480_000, giaGhi: 12_480_000 })).toEqual({
      ket: "KHOP",
      lech: 0,
    });
  });

  it("hạ đơn giá xuống 1đ → THAP_HON và nói ra ĐÚNG số bị hạ", () => {
    // Đây là payload đo được hôm nay đi lọt hoàn toàn vô dấu.
    expect(soSanhGia({ giaNiemYet: 12_480_000, giaGhi: 1 })).toEqual({
      ket: "THAP_HON",
      lech: 12_479_999,
    });
  });

  it("cao hơn niêm yết → CAO_HON, KHÔNG phải lỗi (Coach 1-1 = ×2,0 theo công văn)", () => {
    expect(soSanhGia({ giaNiemYet: 12_480_000, giaGhi: 24_960_000 })).toEqual({
      ket: "CAO_HON",
      lech: 12_480_000,
    });
  });

  it("khoá chưa có giá niêm yết (Course.price là Int?) → CHUA_CO_GIA, không suy bừa", () => {
    expect(soSanhGia({ giaNiemYet: null, giaGhi: 5_000_000 })).toEqual({
      ket: "CHUA_CO_GIA",
      lech: 0,
    });
  });

  it("dung sai tha lệch làm tròn", () => {
    expect(soSanhGia({ giaNiemYet: 12_480_000, giaGhi: 12_479_000, dungSai: 1_000 }).ket).toBe(
      "KHOP",
    );
    expect(soSanhGia({ giaNiemYet: 12_480_000, giaGhi: 12_478_999, dungSai: 1_000 }).ket).toBe(
      "THAP_HON",
    );
  });

  it("số không hữu hạn / âm → coi như 0, không ném", () => {
    expect(soSanhGia({ giaNiemYet: Number.NaN, giaGhi: -5 })).toEqual({
      ket: "CHUA_CO_GIA",
      lech: 0,
    });
  });
});

describe("[CG-02] soát cả đơn — dấu vết đủ để soát lại", () => {
  it("mọi dòng khớp → không lệch, không có dòng nào phải soát", () => {
    const r = soatGiaDon([
      { itemName: "Sata5", soLuong: 1, giaGhi: 12_480_000, giaNiemYet: 12_480_000 },
    ]);
    expect(r.coLech).toBe(false);
    expect(r.tongLechThap).toBe(0);
    expect(r.dongLech).toEqual([]);
  });

  it("một dòng bị hạ giá → coLech, và dòng đó mang ĐỦ số để soát lại", () => {
    const r = soatGiaDon([
      { itemName: "Sata5", soLuong: 2, giaGhi: 1, giaNiemYet: 12_480_000 },
      { itemName: "Bút", soLuong: 1, giaGhi: 50_000, giaNiemYet: 50_000 },
    ]);
    expect(r.coLech).toBe(true);
    // Lệch nhân SỐ LƯỢNG — hạ 1đ/cái × 2 cái là hụt gấp đôi.
    expect(r.tongLechThap).toBe(24_959_998);
    expect(r.dongLech).toEqual([
      {
        itemName: "Sata5",
        ket: LECH_GIA.THAP_HON,
        giaNiemYet: 12_480_000,
        giaGhi: 1,
        soLuong: 2,
        lech: 24_959_998,
      },
    ]);
  });

  it("bán cao hơn niêm yết cũng VÀO dấu vết, nhưng KHÔNG cộng vào tổng hụt", () => {
    const r = soatGiaDon([
      { itemName: "Coach 1-1", soLuong: 1, giaGhi: 24_960_000, giaNiemYet: 12_480_000 },
    ]);
    expect(r.coLech).toBe(true);
    expect(r.tongLechThap).toBe(0);
    expect(r.dongLech[0]?.ket).toBe(LECH_GIA.CAO_HON);
  });

  it("khoá chưa có giá → vào dấu vết để người soát biết, không tính là hụt", () => {
    const r = soatGiaDon([
      { itemName: "Khoá mới", soLuong: 1, giaGhi: 3_000_000, giaNiemYet: null },
    ]);
    expect(r.coLech).toBe(true);
    expect(r.tongLechThap).toBe(0);
    expect(r.dongLech[0]?.ket).toBe(LECH_GIA.CHUA_CO_GIA);
  });

  it("đơn rỗng → không lệch, không ném", () => {
    expect(soatGiaDon([])).toEqual({ coLech: false, tongLechThap: 0, dongLech: [] });
  });
});
