// lib/payments/khai-da-thu.test.ts — ô "đã thu" của kế hoạch đợt: mặc định + cổng.
//
// HAI LOẠI CA, cố ý để cùng một file vì chúng khoá HAI NỬA của cùng một luật:
//
//  · `[KDT-01..08]` — HÀNH VI của hai hàm thuần. Đây là thứ ưu tiên (luật 11: test grep
//    mã nguồn là loại mong manh nhất).
//  · `[KDT-09..12]` — LƯỚI GHIM MÃ NGUỒN. Cần, vì hai luật quan trọng nhất ở đây KHÔNG
//    phải giá trị trả về mà là (a) form có gọi hàm thuần không, (b) cổng đứng TRƯỚC hay
//    SAU vòng ghi tiền. Cổng đặt sau vòng ghi vẫn xanh mọi test thuần và không bao giờ
//    nổ — đúng thứ mẫu LƯỚI GHIM sinh ra để bắt.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dotsBanDauTuTien, khaiDaThuVuotSo } from "./khai-da-thu";

/** `import.meta.url` trong cấu hình vitest của repo này KHÔNG phải URL `file://`. */
function doc(duongDan: string): string {
  return readFileSync(resolve(process.cwd(), duongDan), "utf8");
}

const TP = "app/(admin)/admin/orders/_components/order-payment-section.tsx";
const INS = "lib/orders/installments.ts";

// ═══════════════════════════════════════════════════════════════════════════════
describe("dotsBanDauTuTien — mặc định ô 'đã thu' suy từ tiền thật", () => {
  it("[KDT-01] sổ trống → một đợt bằng cả đơn, CHƯA THU", () => {
    // Đây là ca của 116/496 đơn prod. Mặc định cũ (`daThu: true`) biến mỗi lần bấm Lưu
    // trên những đơn này thành một `Payment` khống bằng ĐÚNG tổng đơn.
    expect(dotsBanDauTuTien({ totalAmount: 8_000_000, daThuTheoSo: 0 })).toEqual([
      { amount: 8_000_000, daThu: false },
    ]);
  });

  it("[KDT-02] đã thu MỘT PHẦN → hai đợt: đợt 1 = đúng số trong sổ (đã thu), đợt 2 = phần còn lại", () => {
    // Hình dạng đo được của `ORD-260913-000001`: tổng 8tr, sổ 1tr.
    expect(dotsBanDauTuTien({ totalAmount: 8_000_000, daThuTheoSo: 1_000_000 })).toEqual([
      { amount: 1_000_000, daThu: true },
      { amount: 7_000_000, daThu: false },
    ]);
  });

  it("[KDT-03] đã thu ĐÚNG TỔNG → một đợt, đã thu", () => {
    expect(dotsBanDauTuTien({ totalAmount: 8_000_000, daThuTheoSo: 8_000_000 })).toEqual([
      { amount: 8_000_000, daThu: true },
    ]);
  });

  it("[KDT-04] đã thu VƯỢT tổng → vẫn một đợt bằng tổng đơn, KHÔNG khai quá tổng", () => {
    // Kế hoạch phải cộng đúng bằng `totalAmount` (`kiemKeHoachDot`), nên phần trả vượt
    // KHÔNG được đưa vào đợt. Nó đã có ô riêng ở khối công nợ (`congNoDon.traVuot`).
    expect(dotsBanDauTuTien({ totalAmount: 8_000_000, daThuTheoSo: 9_500_000 })).toEqual([
      { amount: 8_000_000, daThu: true },
    ]);
  });

  it("[KDT-05] đơn 0đ → một đợt 0đ đã thu (không còn gì để thu, và không khoá nút Lưu)", () => {
    expect(dotsBanDauTuTien({ totalAmount: 0, daThuTheoSo: 0 })).toEqual([
      { amount: 0, daThu: true },
    ]);
  });

  it("[KDT-06] đầu vào rác không sinh tiền và không ném", () => {
    expect(dotsBanDauTuTien({ totalAmount: Number.NaN, daThuTheoSo: Number.NaN })).toEqual([
      { amount: 0, daThu: true },
    ]);
    expect(dotsBanDauTuTien({ totalAmount: 8_000_000, daThuTheoSo: -5_000_000 })).toEqual([
      { amount: 8_000_000, daThu: false },
    ]);
    // Tiền lẻ (giảm giá kiểu SỐ TIỀN sinh ra số lẻ thật — xem `chiaDotHocPhi`).
    expect(dotsBanDauTuTien({ totalAmount: 5_000_000.4, daThuTheoSo: 1_999_999.6 })).toEqual([
      { amount: 2_000_000, daThu: true },
      { amount: 3_000_000, daThu: false },
    ]);
  });

  it("[KDT-07] HAI BẤT BIẾN giữ trên mọi tổ hợp: Σ đợt = tổng đơn, và Σ đợt ĐÃ THU ≤ sổ", () => {
    // Bất biến 2 là toàn bộ lý do hàm này tồn tại: mặc định KHÔNG BAO GIỜ được khai
    // nhiều tiền hơn sổ đang có. Quét bằng bảng thay vì một ca, vì con bug gốc chỉ lộ
    // ra ở đúng một tổ hợp (`daThuTheoSo < totalAmount`).
    const tongs = [0, 1, 999, 1_000_000, 8_000_000, 10_400_000];
    const sos = [0, 1, 1_000_000, 5_200_000, 8_000_000, 99_000_000];
    for (const totalAmount of tongs) {
      for (const daThuTheoSo of sos) {
        const dots = dotsBanDauTuTien({ totalAmount, daThuTheoSo });
        const tong = dots.reduce((s, d) => s + d.amount, 0);
        const khai = dots.filter((d) => d.daThu).reduce((s, d) => s + d.amount, 0);
        expect(tong, `Σ đợt ≠ tổng đơn tại (${totalAmount}, ${daThuTheoSo})`).toBe(
          Math.max(0, Math.round(totalAmount)),
        );
        expect(
          khai,
          `khai ${khai} > sổ ${daThuTheoSo} tại tổng ${totalAmount} — mặc định đang bịa tiền`,
        ).toBeLessThanOrEqual(Math.max(0, Math.round(daThuTheoSo)));
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("khaiDaThuVuotSo — cổng ở đường ghi", () => {
  it("[KDT-08a] sổ có tiền + kế hoạch khai nhiều hơn → CHẶN, nêu đúng phần chênh", () => {
    const v = khaiDaThuVuotSo({ tienCacDotDaThu: 8_000_000, daCoTrongSo: 1_000_000 });
    expect(v.chan).toBe(true);
    expect(v.soTien).toBe(7_000_000);
    expect(v.lyDo).toContain("7.000.000đ");
  });

  it("[KDT-08b] sổ TRỐNG → CHO QUA (sale thu tiền mặt tại quầy, lần ghi đầu tiên)", () => {
    // Chặn ca này là xoá ô "đã thu" khỏi mọi đơn mới — tiền mặt không có đường ghi nào
    // khác (`PaymentAllocation.bankTransactionId` là FK bắt buộc, `BankTransaction` chỉ
    // sinh ở webhook). Cũng là ca của ~15 chỗ gọi trong bộ e2e.
    expect(khaiDaThuVuotSo({ tienCacDotDaThu: 10_000_000, daCoTrongSo: 0 })).toEqual({
      chan: false,
    });
  });

  it("[KDT-08c] khai ĐÚNG BẰNG hoặc ÍT HƠN sổ → cho qua", () => {
    expect(khaiDaThuVuotSo({ tienCacDotDaThu: 1_000_000, daCoTrongSo: 1_000_000 }).chan).toBe(false);
    expect(khaiDaThuVuotSo({ tienCacDotDaThu: 0, daCoTrongSo: 1_000_000 }).chan).toBe(false);
  });

  it("[KDT-08d] đầu vào rác KHÔNG mở cổng và KHÔNG ném", () => {
    expect(khaiDaThuVuotSo({ tienCacDotDaThu: Number.NaN, daCoTrongSo: 1_000_000 }).chan).toBe(
      false,
    );
    expect(
      khaiDaThuVuotSo({ tienCacDotDaThu: 8_000_000, daCoTrongSo: Number.NaN }).chan,
      "sổ rác phải coi như sổ trống — không chặn, để `dotsBanDauTuTien` gánh",
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LƯỚI GHIM MÃ NGUỒN — xem "Mẫu test: LƯỚI GHIM MÃ NGUỒN" trong CLAUDE.md.
// Mỗi ca dưới đây đã được CẤY LẠI LỖI và chứng minh ĐỎ trước khi khôi phục bản vá.
// ═══════════════════════════════════════════════════════════════════════════════
describe("lưới ghim — mặc định form và cổng phải NỐI ĐÚNG CHỖ", () => {
  it("[KDT-09] form dựng mặc định bằng hàm thuần, KHÔNG còn hằng 'đã thu cả đơn'", () => {
    const src = doc(TP);
    // Mã TRƯỚC bản vá (14/09/2026):
    //   return [{ amount: totalAmount, daThu: true, dueDate: "", reminderDays: 14, laCoc: false }];
    const hangCu = src.match(/amount: totalAmount, daThu: true/g) ?? [];
    expect(
      hangCu.length,
      "mặc định 'đã thu cả đơn' đã quay lại — mở đơn rồi bấm Lưu là đẻ Payment khống",
    ).toBe(0);

    const goi = src.match(/dotsBanDauTuTien\(\{ totalAmount, daThuTheoSo \}\)/g) ?? [];
    expect(goi.length, "form không còn gọi `dotsBanDauTuTien` với đủ hai tham số").toBe(1);
  });

  it("[KDT-10] cổng R-03 đứng TRƯỚC vòng ghi Payment — và đo bằng số đếm TRƯỚC vòng ghi", () => {
    const src = doc(INS);
    const iDaCo = src.indexOf("const daCoAgg = await tx.payment.aggregate(");
    const iCong = src.indexOf("khaiDaThuVuotSo({");
    const iGhi = src.indexOf("ensureOrderPaymentRecorded(tx, {");
    expect(iDaCo, "không thấy phép đếm tiền `daCoAgg`").toBeGreaterThan(-1);
    expect(iCong, "không thấy lời gọi cổng `khaiDaThuVuotSo({...})`").toBeGreaterThan(-1);
    expect(iGhi, "không thấy vòng ghi `ensureOrderPaymentRecorded(tx, {`").toBeGreaterThan(-1);

    // Đây là khẳng định quan trọng nhất của cả file: đặt cổng SAU vòng ghi thì vòng ghi
    // vừa tạo đúng phần còn thiếu ⇒ `khai === daCoTrongSo` ⇒ cổng không bao giờ nổ, và
    // mọi ca hành vi ở trên vẫn xanh.
    expect(iDaCo, "cổng đo tiền trước khi có số để đo").toBeLessThan(iCong);
    expect(iCong, "cổng nằm SAU vòng ghi Payment ⇒ nó là tautology, không phải cổng").toBeLessThan(
      iGhi,
    );

    // …và nó phải đo bằng CHÍNH `daCoAgg`, không phải một phép đếm khác.
    const doBang = src.match(/daCoTrongSo: daCoAgg\._sum\.amount \?\? 0/g) ?? [];
    expect(doBang.length, "cổng không đo bằng `daCoAgg`").toBe(1);
  });

  it("[KDT-11] recomputeOrder chỉ chạm 3 trạng thái, và lọc TRƯỚC khi ghi", () => {
    const src = doc(INS);
    // Mã TRƯỚC bản vá: `db.order.update({ where: { id: orderId }, data: {...} })` không
    // lọc trạng thái ⇒ kéo CANCELLED/REFUNDED về CONFIRMED, đẩy COMPLETED về chờ thu.
    const iLoc = src.indexOf("TRANG_THAI_RECOMPUTE_DUOC_CHAM as readonly string[]).includes(");
    const iGhi = src.indexOf("await db.order.update({");
    expect(iLoc, "không thấy phép lọc trạng thái trong recomputeOrder").toBeGreaterThan(-1);
    expect(iGhi, "không thấy câu ghi `db.order.update`").toBeGreaterThan(-1);
    expect(iLoc, "lọc trạng thái đứng SAU câu ghi ⇒ ghi rồi mới hỏi, vô dụng").toBeLessThan(iGhi);

    const khai = /TRANG_THAI_RECOMPUTE_DUOC_CHAM = \["DRAFT", "PENDING_PAYMENT", "CONFIRMED"\]/;
    expect(khai.test(src), "tập trạng thái được chạm đã đổi — đọc lại chú thích trước khi sửa").toBe(
      true,
    );
  });

  it("[KDT-12] recomputeOrder ghi OrderStatusHistory khi đổi trạng thái", () => {
    const src = doc(INS);
    const ghiSu = src.match(/db\.orderStatusHistory\.create\(\{/g) ?? [];
    expect(ghiSu.length, "recomputeOrder đổi trạng thái đơn mà không để lại dấu vết nào").toBe(1);
    // Chỉ ghi khi THẬT SỰ đổi — ghi mọi lượt là chôn dòng có nghĩa dưới nhiễu.
    expect(src).toContain("if (trangThaiMoi !== order.status) {");
  });
});
