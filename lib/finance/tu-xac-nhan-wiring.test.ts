// [TXW-*] — LƯỚI GHIM MÃ NGUỒN: phép "người ghi khoản = người xem" chỉ có MỘT nguồn, và mọi nơi quyết/vẽ dùng nó.
//
// ── VÌ SAO LÀ LƯỚI ĐỌC MÃ ────────────────────────────────────────────────────────────────────────
// Hai thứ test hành vi KHÔNG chứng minh được:
//   (1) `fetchPaymentRows` (Server Action của màn Thanh toán) truyền ĐÚNG người xem vào `laNguoiGhiKhoan` —
//       quên truyền hay truyền nhầm là một GIÁ TRỊ SAI chứ không phải thiếu tham số (`tsc` không thấy), và
//       hàm đó chạm DB nên không dựng được trong test thuần;
//   (2) cả năm nơi từng chép tay `recordedById === <người>` đều đi qua cùng một hàm. Chép lại phép so ở một chỗ
//       là để lõi xác nhận và nút ✓ lệch nhau lần nữa — đúng sự cố F1.
//
// ⚠️ Lưới ghim mã nguồn là loại MONG MANH NHẤT (luật 11): BỎ CHÚ THÍCH trước khi quét (các khối chú thích giải
// thích bản vá chứa đúng chuỗi đang tìm), neo vào BIỂU THỨC chứ không neo vào chỗ xuống dòng, đếm SỐ LẦN khớp.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Bỏ chú thích DÒNG trước, rồi chú thích KHỐI (thứ tự có nghĩa — xem `cho-convert-van-tu-choi-duoc.test.ts`). */
function boChuThich(s: string): string {
  return s.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
function doc(duongDan: string): string {
  return boChuThich(readFileSync(resolve(process.cwd(), duongDan), "utf8"));
}
function dem(s: string, re: RegExp): number {
  return s.match(re)?.length ?? 0;
}

// [tên nơi, đường dẫn, số lời gọi]. Action ở màn Thanh toán gọi HAI lần: cổng sớm của `confirmPaymentAction` và cờ
// `laNguoiGhi` của từng dòng (xem [TXW-03] / [TXW-04]).
const NAM_NOI: ReadonlyArray<readonly [string, string, number]> = [
  ["lõi xác nhận", "lib/finance/payment.ts", 1],
  ["action ở màn Thanh toán", "app/(admin)/admin/payments/_actions.ts", 2],
  ["xác nhận hàng loạt nhập liệu", "lib/finance/backfill-confirm.ts", 1],
  ["bước chốt hoá đơn", "lib/finance/hoa-don/chot-hoa-don.ts", 1],
  ["hàng chờ hoá đơn", "lib/finance/hoa-don/dong-hang-cho.ts", 1],
];

describe("[TXW] AC5 — một vị từ, mọi nơi cùng gọi", () => {
  for (const [ten, duongDan, soLoiGoi] of NAM_NOI) {
    it(`[TXW-01] ${ten}: gọi laNguoiGhiKhoan( và KHÔNG còn phép so recordedById tay`, () => {
      const ma = doc(duongDan);
      expect(dem(ma, /\blaNguoiGhiKhoan\(/g), `${duongDan} phải gọi laNguoiGhiKhoan( ĐÚNG ${soLoiGoi} lần`).toBe(soLoiGoi);
      expect(ma, `${duongDan}: import laNguoiGhiKhoan từ lib/finance/tu-xac-nhan`).toMatch(
        /import \{[^}]*\blaNguoiGhiKhoan\b[^}]*\} from "@\/lib\/finance\/tu-xac-nhan"/,
      );
      // Phép so tay `recordedById === …` / `… === recordedById` (kể cả `.recordedById`) là cách chép lại luật.
      expect(dem(ma, /recordedById\s*===|===\s*[\w.]*recordedById/g), `${duongDan}: còn phép so recordedById viết tay`).toBe(0);
    });
  }

  it("[TXW-02] lõi xác nhận: cổng ĐỨNG TRƯỚC phép ghi đầu tiên và NÉM TU_XAC_NHAN (luật rollback)", () => {
    const ma = doc("lib/finance/payment.ts");
    const cong = ma.indexOf('laNguoiGhiKhoan(p.recordedById, params.confirmedById)');
    expect(cong, "mất cổng AC5 ở xacNhanKhoanTrongTx").toBeGreaterThan(-1);
    const dong = ma.slice(cong, ma.indexOf(";", cong) + 1);
    expect(dong).toContain('throw new LoiXacNhanKhoan("TU_XAC_NHAN")');
    // Mọi cổng đứng TRƯỚC phép ghi đầu tiên: từ đầu hàm tới cổng AC5 không có phép ghi nào.
    const dauHam = ma.indexOf("export async function xacNhanKhoanTrongTx");
    expect(dauHam).toBeGreaterThan(-1);
    expect(dauHam).toBeLessThan(cong);
    expect(ma.slice(dauHam, cong), "có phép ghi đứng trước cổng AC5").not.toMatch(/\.(updateMany|update|create|createMany|delete|deleteMany)\(/);
    // Và phép ghi CONFIRMED nằm SAU cổng.
    const ghi = ma.indexOf("confirmedAt: params.now", cong);
    expect(ghi, "không tìm thấy phép ghi CONFIRMED sau cổng").toBeGreaterThan(cong);
  });

  it("[TXW-03] action: cổng sớm của confirmPaymentAction dùng CÙNG hàm và CÙNG câu từ chối", () => {
    const ma = doc("app/(admin)/admin/payments/_actions.ts");
    expect(ma).toContain("laNguoiGhiKhoan(scope.recordedById, scope.uid)");
    expect(ma).toContain("error: CAU_TU_XAC_NHAN");
  });

  it("[TXW-04] màn Thanh toán: cờ laNguoiGhi do MÁY CHỦ tính cho từng dòng, so với NGƯỜI XEM (userId của phiên)", () => {
    const ma = doc("app/(admin)/admin/payments/_actions.ts");
    // Cả hai đường đọc (`queryPayments` · `revealPaymentsPii`) đều đi qua `fetchPaymentRows(session.user.id, …)`.
    expect(ma).toContain("laNguoiGhi: laNguoiGhiKhoan(p.recordedById, userId)");
    expect(dem(ma, /fetchPaymentRows\(session\.user\.id,/g), "cả hai nơi gọi phải truyền id người xem từ phiên").toBe(2);
    // KHÔNG đẩy id người ghi xuống trình duyệt: DTO chỉ có cờ + tên người thu.
    expect(ma, "PaymentListRow không được mang recordedById").not.toMatch(/^\s*recordedById\s*:\s*(string|p\.)/m);
  });

  it("[TXW-05] giao diện: nút ✓ rẽ theo p.laNguoiGhi, và không tự suy người ghi ở client", () => {
    const ma = doc("app/(admin)/admin/payments/_components/payments-client.tsx");
    expect(dem(ma, /p\.laNguoiGhi\s*\?/g), "nhánh vẽ 'Cần người khác xác nhận' rẽ theo p.laNguoiGhi — đúng 1 chỗ").toBe(1);
    expect(ma).toContain("Cần người khác xác nhận");
    expect(ma, "client không được tự so người ghi").not.toMatch(/recordedById/);
  });
});
