import type { Honor, Employee } from "@prisma/client";
import { ngayVaoLamHopLe } from "@/lib/hr/ngay-vao-lam";
import { vnParts } from "@/lib/time/vn";

// Honor với employee được include (luôn dùng cho public reads sau Phase 4.7)
export type HonorWithEmployee = Honor & {
  employee: Pick<
    Employee,
    "id" | "fullName" | "jobTitle" | "avatarUrl" | "joinedAt"
  > | null;
};

/**
 * Số năm gắn bó tính từ `Employee.joinedAt` — NGÀY LÀM VIỆC CHÍNH THỨC (chốt 08/09/2026;
 * ngày thử việc là thứ khác và hiện chưa có chỗ lưu).
 *
 * ⚠️ 08/09/2026 — BỎ phép chia "30 ngày = 1 tháng". Bản cũ tính
 * `(now - joinedAt) / 30ngày / 12`, tức một "năm" chỉ dài 360 ngày ⇒ thổi phồng ~1,4%
 * và ở mốc dài thì lệch hẳn một năm. Nay đếm bằng LỊCH: đủ ngày kỷ niệm mới cộng năm.
 *
 * ⚠️ Trả `null` chứ KHÔNG trả 0 khi thiếu dữ liệu. Số 0 trông như một sự thật ("vào làm
 * chưa tới một năm"); ô trống thì không giả vờ biết. Nơi hiển thị phải ẨN HẲN dòng đó.
 *
 * Dùng lịch VN (`vnParts`) chứ không phải giờ máy — Vercel chạy UTC.
 */
export function computeYears(
  joinedAt: Date | null | undefined,
  now: Date = new Date(),
): number | null {
  // Cổng dùng chung: loại mốc Unix 1970 (NULL bị ghi thành 0) và giá trị không hợp lệ.
  const d = ngayVaoLamHopLe(joinedAt);
  if (!d) return null;
  if (d.getTime() > now.getTime()) return null; // ngày vào làm ở tương lai → không đoán

  const a = vnParts(d);
  const b = vnParts(now);
  let nam = b.year - a.year;
  const chuaToiKyNiem =
    b.month < a.month || (b.month === a.month && b.day < a.day);
  if (chuaToiKyNiem) nam -= 1;
  return nam < 0 ? null : nam;
}

// View data normalized — luôn ưu tiên: snapshot (Honor.*AtTime) → Employee → old Honor field.
// Khi drop old fields ở Phase 4.7.1, fallback cuối tự nhiên rơi.
export function getHonorView(honor: HonorWithEmployee) {
  const fullName =
    honor.employee?.fullName ?? honor.fullName ?? "Nhân sự ẩn danh";
  const jobTitle =
    honor.jobTitleAtTime ?? honor.employee?.jobTitle ?? honor.jobTitle ?? "";
  const avatarUrl = honor.employee?.avatarUrl ?? honor.avatarUrl ?? null;
  const years =
    honor.yearsAtTime ??
    computeYears(honor.employee?.joinedAt) ??
    honor.yearsAtCompany ??
    null;

  return { fullName, jobTitle, avatarUrl, years };
}
