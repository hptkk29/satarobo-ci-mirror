// lib/hoa-hong/cutover-kieu.ts — KIỂU dùng chung của mốc cutover. CHỈ KIỂU, không mã chạy, không import nào.
//
// Vì sao là tệp riêng: `cutover.ts` (cổng + đường ghi) import GIÁ TRỊ từ `cutover-kiem-tra.ts` (precheck), còn precheck cần kiểu `HanhDongDatMoc` để biết hành động nào đòi bằng chứng.
// Khi kiểu nằm trong `cutover.ts` thì hai tệp trỏ vào nhau ⇒ `no-circular` của depcruise (error, chặn CI — đo 11/10/2026 trên nhánh gộp). Đặt kiểu ở tệp thứ ba, ai cũng chỉ
// phụ thuộc xuống nó. `cutover.ts` vẫn xuất lại `HanhDongDatMoc` để chỗ gọi cũ không đổi.
export type HanhDongDatMoc = "DAT_LAN_DAU" | "DOI_SOM" | "DOI_MUON" | "GO";
