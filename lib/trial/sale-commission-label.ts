// lib/trial/sale-commission-label.ts — nhãn hoa hồng của bảng trải nghiệm site Sale.
//
// ⚠️ FILE NÀY CỐ Ý KHÔNG IMPORT GÌ. Nó được một Client Component đọc lúc chạy
// (`app/(sale)/sale/trial/_components/trial-list.tsx`), nên nếu để chung trong
// `sale-roster.ts` thì cả `scopedDb` + Prisma bị kéo vào gói gửi xuống trình duyệt —
// `import type` cũ được xoá lúc biên dịch nên không có chuyện đó, `import` thật thì có.
// Thêm bất kỳ import server nào vào đây là tái lập đúng cái bẫy ấy.

/**
 * Nhãn hoa hồng đứng cạnh trạng thái "Đã nhập học" ở bảng trải nghiệm site Sale.
 * `null` = con chưa nhập học ⇒ chưa có gì để nói về hoa hồng.
 *
 * ⚠️ VÌ SAO VẪN KHÔNG IN "+4%" (hay bất kỳ con số nào) — LÝ DO ĐÃ ĐỔI 27/08/2026
 *
 * Trước 27/08 nhãn là "chưa tính" vì hệ thống **chưa từng sinh một dòng hoa hồng nào
 * cho Sale**: `setStatementLines` không được gọi từ chỗ nào trong sản phẩm. Nay đường
 * đó đã nối (`lib/crm/commission-run.ts`), nên câu "chưa tính" thành nói sai.
 *
 * Nhưng con số vẫn KHÔNG in được ở đây, vì lý do mới và sâu hơn:
 *
 *   1. Hoa hồng tính trên **TIỀN ĐÃ THU trong tháng**, không phải trên giá trị hợp
 *      đồng. Con ký 20 triệu mà mới đóng 5 triệu thì hoa hồng là 4% × 5 triệu. In
 *      "+4%" cạnh trạng thái nhập học là gợi ý sai rằng cứ nhập học là được 4% trọn gói.
 *   2. Số chỉ chốt được khi **kế toán chốt kỳ**, và còn có thể bị **trừ lại** nếu phụ
 *      huynh hoàn tiền ở tháng sau. Một con số in ra hôm nay có thể sai vào tháng sau.
 *
 * (Tầng `TRIAL_TEACHER` ở `lib/crm/trial-teacher-commission.ts` in được "+1% HH" ở
 * site GV vì nó tính trên học phí của TỪNG ghi danh ngay lúc convert — khác hẳn. Chép
 * nhãn đó sang đây là nói sai cả người hưởng lẫn cách tính.)
 *
 * Nên nhãn nói đúng cơ chế thật, không nói một con số.
 */
export function nhanHoaHongSale(enrolled: boolean): { nhan: string; lyDo: string } | null {
  if (!enrolled) return null;
  return {
    nhan: "Hoa hồng: chốt cuối kỳ",
    lyDo:
      "Hoa hồng của tư vấn viên tính trên số tiền phụ huynh THỰC SỰ đã đóng trong " +
      "tháng, không phải trên giá trị hợp đồng — đóng làm nhiều đợt thì ăn dần theo " +
      "từng đợt. Kế toán chốt kỳ hằng tháng, và nếu có hoàn tiền thì phần tương ứng " +
      "bị trừ lại ở kỳ hoàn. Xem số chính thức ở bảng kê hoa hồng theo kỳ.",
  };
}
