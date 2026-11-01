// lib/nguon/nguon-ca-file-ghi-chu.ts — câu GHI CHÚ về «MỘT FILE = MỘT nguồn + MỘT người giới thiệu» (chủ dự án chốt 28/10/2026).
//
// THUẦN, không import gì: màn nhập (`components/admin/nguon-hoa-hong/nguon-ca-file.tsx`, in đậm dưới ô «Nguồn của cả file») và sheet hướng dẫn của file mẫu
// (`lib/lead/template.ts` → `patchGuideSheet`) cùng đọc MỘT chuỗi này, để hai nơi không bao giờ nói hai câu khác nhau.
// Cột «Mã NV giới thiệu» đã bỏ hẳn; người giới thiệu do ô chọn nguồn quyết, một người cho cả file.
export const GHI_CHU_MOT_FILE_MOT_NGUON =
  "Mỗi file chỉ có MỘT nguồn và MỘT người giới thiệu cho tất cả các dòng. Khách của người giới thiệu khác nhau ⇒ chia thành các file riêng, mỗi file một người.";
