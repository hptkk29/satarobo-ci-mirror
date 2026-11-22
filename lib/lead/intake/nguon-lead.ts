// lib/lead/intake/nguon-lead.ts — danh mục NGUỒN LEAD hiện trong ô "Nguồn" của
// biểu mẫu `/nhap-khach-hang`.
//
// 29/08/2026 — tách khỏi `misa-internal.ts` khi gỡ luồng MISA. Danh sách này ra đời
// từ form MISA nên id là số rời rạc (không có 5) — GIỮ NGUYÊN id: lead cũ trên PROD
// đã lưu theo bộ mã này, đánh số lại là làm hỏng dữ liệu đã có.
//
// File THUẦN: không chạm mạng/DB, client component kéo theo được.

export const NGUON_LEAD: ReadonlyArray<{ id: string; label: string }> = [
  { id: "1", label: "Nguồn từ Marketing Hội Sở từ Quảng Cáo" },
  { id: "2", label: "Nguồn Review, chia sẻ, seeding từ Trung tâm" },
  { id: "3", label: "Nguồn KH tự đến Trung Tâm" },
  { id: "4", label: "Nguồn từ phụ huynh giới thiệu" },
  { id: "6", label: "Nguồn từ sự kiện" },
  { id: "7", label: "Nguồn từ nhân viên giới thiệu" },
  { id: "8", label: "Nguồn từ Ban lãnh đạo công ty" },
  { id: "9", label: "Nguồn khác" },
  { id: "10", label: "Nguồn từ Marketing Hội Sở từ Tool quét KH" },
  { id: "11", label: "Nguồn từ Marketing Hội Sở từ Organic" },
  { id: "12", label: "Nguồn từ Marketing Hội Sở từ Seeding" },
  { id: "13", label: "Nguồn từ cộng tác viên giới thiệu" },
];
