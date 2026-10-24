// lib/hoc-bu/phieu-tom-tat.ts — bảng 9 tiêu chí của PHIẾU nhận xét học bù thành HÀNG ĐỌC ĐƯỢC. THUẦN (dùng được ở server lẫn client).
//
// Chủ dự án chốt 09/10/2026: đánh giá có CẤU TRÚC (đánh giá chung + bảng 9 tiêu chí) ở `MakeupCaseStudent` là nguồn sự thật; PDF chỉ là đầu ra. Mọi nơi
// đọc đánh giá của lần học bù — màn case, buổi gốc ở điểm danh, cổng phụ huynh — phải cùng đọc MỘT bản ghi và cùng hiểu bảng 9 tiêu chí qua hàm này,
// thay vì mỗi nơi tự dựng câu chữ (một nơi in ra "mức 2", nơi kia in ra mô tả mức — rồi lệch nhau).
import { EVAL_CRITERIA } from "@/lib/lms/session-eval-rubric";

export type DongPhieu = { nhom: string; ten: string; muc: number; chu: string };

/** Hàng của bảng 9 tiêu chí theo thứ tự khai báo; `null` khi phiếu chưa chấm bảng (chỉ có chữ hoặc chưa có phiếu). Đầu vào là bảng ĐÃ chuẩn hoá. */
export function dongPhieu(phieu: Record<string, number> | null): DongPhieu[] | null {
  if (!phieu) return null;
  return EVAL_CRITERIA.map((c) => {
    const muc = phieu[c.id] ?? 3;
    return { nhom: c.group, ten: c.name, muc, chu: c.levels.find((l) => l.value === muc)?.text ?? "" };
  });
}
