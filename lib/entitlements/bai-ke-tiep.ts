// lib/entitlements/bai-ke-tiep.ts — "BÀI KẾ TIẾP CỦA LỚP": học viên vào lớp bây giờ sẽ học bài nào trước. THUẦN.
//
// 🔴 CHƯA CÓ NƠI NÀO GỌI. Đây là nguồn DUY NHẤT cho nhánh cờ BẬT của xếp lớp (chú thích ở `dich-vu.ts` từng gọi
// nó là "hàm duy nhất" khi chưa hề tồn tại). Bản đọc DB (một câu cho nhiều lớp) là việc của PR sau.
//
// Hôm nay có BA cách đếm "lớp đang ở bài mấy", lệch nhau:
//   · `demBuoiDaQua`           — đếm buổi `date ≤ now`, KỂ CẢ buổi huỷ;
//   · `layUngVienLop` (bảo lưu) — buổi sống sớm nhất `date ≥ đầu ngày VN`, lấy `plan.order + 1`;
//   · tham số N của `tinhPhamViHoc`.
// Nghỉ-lùi ngày 27/09 làm cách đếm theo NGÀY lệch cả lớp. Hàm này theo cách thứ hai — đếm theo LỘ TRÌNH — và
// phải khớp từng điểm với `lib/bao-luu/phuc-hoc-db.ts: layUngVienLop` (cùng một câu hỏi, hai câu trả lời là bug):
//   1. loại buổi `CANCELLED` (và CHỈ loại nó — buổi hôm nay đã `COMPLETED` vẫn được tính, giống bản bảo lưu;
//      muốn đổi thì đổi CẢ HAI chỗ);
//   2. giữ buổi `date ≥ vnStartOfDay(now)` — mốc là ĐẦU NGÀY VN, không phải giờ hiện tại;
//   3. lấy buổi sớm nhất, rồi `soBuoiTheoLoTrinh({ planOrder, lessonOrder })`.
//
// ⚠️ Buổi sớm nhất mà chưa ghim giáo trình ⇒ `null`. KHÔNG nhảy sang buổi sau có số bài: trả bài của buổi thứ ba cho
// một học viên sẽ học buổi thứ nhất là trả SAI bài mà không báo lỗi. Người gọi phải hiểu `null` là "chưa suy được".
//
// ⚠️ `now` BẮT BUỘC, không mặc định `new Date()`: hàm thuần không đọc đồng hồ (luật 19).
import { soBuoiTheoLoTrinh } from "@/lib/lms/session-order";
import { vnStartOfDay } from "@/lib/time/vn";

export interface BuoiCuaLop {
  readonly date: Date;
  /** `ClassSession.status`: SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED. */
  readonly status: string;
  /** `ClassSessionPlan.order` (0-based). */
  readonly planOrder: number | null;
  /** `Lesson.order` (1-based). */
  readonly lessonOrder: number | null;
}

/** Bài kế tiếp (1-based) của lớp, hoặc `null` nếu lớp hết buổi hoặc buổi sớm nhất chưa ghim giáo trình. */
export function baiKeTiepCuaLop(buoi: readonly BuoiCuaLop[], now: Date): number | null {
  const moc = vnStartOfDay(now).getTime();
  const conLai = buoi.filter((b) => b.status !== "CANCELLED" && b.date.getTime() >= moc);
  if (conLai.length === 0) return null;

  const somNhat = Math.min(...conLai.map((b) => b.date.getTime()));
  // Nhiều buổi CÙNG thời điểm: kết quả không được phụ thuộc thứ tự đầu vào. Có buổi nào chưa ghim ⇒ chưa suy được.
  const bai = conLai
    .filter((b) => b.date.getTime() === somNhat)
    .map((b) => soBuoiTheoLoTrinh({ planOrder: b.planOrder, lessonOrder: b.lessonOrder }));
  if (bai.some((n) => n === null)) return null;
  return Math.min(...(bai as number[]));
}
