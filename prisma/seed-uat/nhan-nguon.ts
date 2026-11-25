// prisma/seed-uat/nhan-nguon.ts — NHÃN `Lead.source` mà bộ seed UAT được phép gieo. THUẦN (không DB, không import nào).
//
// LUẬT: mọi nhãn ở đây PHẢI nằm trong bảng 28 nhãn đã chốt (`lib/nguon/anh-xa-nhan-cu.ts`, văn bản 06/10/2026 §2). Nhãn ngoài bảng ⇒ `INVALID`,
// và `INVALID > 0` là điều kiện DỪNG của hai công cụ mà checklist UAT (docs/source-commission/09 bước 16–17) bắt người nghiệm thu chạy:
//   · `scripts/nguon/di-tru-nguon-cu-ghi.ts --apply` từ chối;
//   · trang «Chuyển sang hoa hồng mới» + `uat-nap-du-lieu.ts --dat-moc-cutover` chặn bằng `CO_INVALID_NGUON` / `DI_TRU_CHUA_SAN_SANG`.
// Đo 11/10/2026 (vòng 5): bản cũ của hai mảng này gieo 8 nhãn lạ ("Facebook Ads", "Messenger Page HO", "Zalo OA", "Sự kiện trường học", "Vãng lai", "Google",
// "Tờ rơi", "Quà tặng") ⇒ 229/320 lead INVALID ⇒ người nghiệm thu dựng DB đúng §1.4 là KHÔNG đặt được mốc cutover mà không sửa mã.
//
// Lưới: `lib/uat/nhan-seed-uat.test.ts` (`[UAT-NHAN-*]`) — mọi nhãn ở đây KHÔNG INVALID, và hai tệp seed phải dùng ĐÚNG hai mảng này.
//
// ⚠️ ĐỘ DÀI HAI MẢNG LÀ THAM SỐ CỦA BỘ SINH SỐ NGẪU NHIÊN (`pick(rng, …)` chọn theo chỉ số) — đổi số phần tử là đổi toàn bộ dữ liệu gieo phía sau
// (lead nào được gán sale nào…). Chỉ ĐỔI CHỮ, giữ nguyên số phần tử và thứ tự.

/** Nhãn nguồn của `02-crm.ts` (10 phần tử). Chú thích bên phải: nhãn CŨ → vì sao nhãn mới gần nghĩa nhất. */
export const NHAN_NGUON_CRM = [
  "Ads", //                                     ← "Facebook Ads"
  "Nguồn từ Marketing Hội Sở từ Quảng Cáo", // ← "Messenger Page HO" (Page HO do Marketing Hội sở chạy quảng cáo)
  "Giới thiệu", //                              (giữ nguyên — đã nằm trong bảng; lead loại này vào hàng chờ «thiếu người giới thiệu», đúng thực tế)
  "Nguồn KH tự đến Trung Tâm", //               ← "Vãng lai"
  "Ads", //                                     ← "Google"
  "Organic", //                                 ← "Zalo OA"
  "Tự khai thác", //                            ← "Sự kiện trường học" (Sale tự đi khai thác ở trường)
  "Website", //                                 (giữ nguyên)
  "Organic", //                                 ← "Tờ rơi"
  "quatang", //                                ← "Quà tặng" (nhãn #5 của bảng; không có người giới thiệu/affiliate ⇒ quảng cáo)
] as const;

/** Nhãn nguồn của `08-noi-lead.ts` (6 phần tử). */
export const NHAN_NGUON_NOI_LEAD = [
  "Ads", //                          ← "Facebook Ads"
  "Nguồn từ Marketing Hội Sở từ Quảng Cáo", // ← "Messenger Page HO"
  "Giới thiệu", //                   (giữ nguyên)
  "Organic", //                      ← "Zalo OA"
  "Website", //                      (giữ nguyên)
  "Tự khai thác", //                 ← "Sự kiện trường học"
] as const;
