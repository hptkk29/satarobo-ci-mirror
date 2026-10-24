// app/(admin)/admin/students/_components/ho-so/nhan-ho-so.ts — nhãn + phép tính THUẦN của
// màn "Hồ sơ học viên" (25/09/2026). Không import server, không đụng DB ⇒ client component
// dùng được và test dựng tay được (`nhan-ho-so.test.ts`).

import type { EnrollmentStatus } from "@prisma/client";
import type { PillTone } from "@/components/admin/ui/status-pill";
import { vnParts, vnYmd } from "@/lib/time/vn";
import { tinhTinhTrangHoc, type TinhTrangHocKey } from "@/lib/students/tinh-trang-hoc";

export type TrangThaiHocVien = "ACTIVE" | "PAUSED" | "GRADUATED" | "INACTIVE";

/** Nhãn + tông màu trạng thái hồ sơ — thang ngữ nghĩa của DESIGN.md §1, không mượn màu brand. */
export const NHAN_TRANG_THAI_HV: Record<TrangThaiHocVien, { nhan: string; tone: PillTone }> = {
  ACTIVE: { nhan: "Đang học", tone: "success" },
  PAUSED: { nhan: "Bảo lưu", tone: "warning" },
  GRADUATED: { nhan: "Hoàn thành", tone: "info" },
  INACTIVE: { nhan: "Nghỉ học", tone: "muted" },
};

const TONE_TINH_TRANG: Record<TinhTrangHocKey, PillTone> = {
  "dang-hoc": "success",
  "vua-hoan-thanh": "info",
  "cho-xep-lop": "warning",
  "bao-luu": "warning",
  "hoan-thanh": "info",
  "nghi-hoc": "muted",
};

/**
 * Nhãn TÌNH TRẠNG HỌC cho dải đầu hồ sơ — CÙNG hàm `tinhTinhTrangHoc` mà cột trạng thái ở
 * danh sách /students dùng, KHÔNG phải `Student.status` trần.
 *
 * Sự cố 09/10/2026 (prod, CS2-26-57AWRE): em bị gỡ khỏi lớp, ghi danh "Đã huỷ", danh sách in
 * "Chờ xếp lớp" mà dải đầu hồ sơ in "Đang học" (`ACTIVE` ⇒ "Đang học"). Hai màn nói hai điều
 * về cùng một em. `ACTIVE` chỉ có nghĩa "chưa nghỉ / chưa bảo lưu" — có ngồi lớp nào không là
 * chuyện của ghi danh.
 *
 * `trangThaiGhiDanh` = trạng thái các ghi danh CÒN SỐNG (`deletedAt = null`); không mặc định.
 */
export function nhanTinhTrangHoSo(
  status: TrangThaiHocVien,
  trangThaiGhiDanh: readonly EnrollmentStatus[],
): { nhan: string; tone: PillTone } {
  const t = tinhTinhTrangHoc({ status, enrollmentStatuses: trangThaiGhiDanh });
  return { nhan: t.label, tone: TONE_TINH_TRANG[t.key] };
}

/**
 * Nhãn ghi danh — cùng CHỮ với `/enrollments` (người dùng đi qua lại hai màn phải đọc
 * cùng một từ), tông theo DESIGN.md: "Đã rút / Đã chuyển" là kết cục bình thường của một
 * ghi danh, KHÔNG phải lỗi ⇒ muted chứ không danger; chỉ "Đã huỷ" mới là danger.
 */
export const NHAN_GHI_DANH: Record<EnrollmentStatus, { nhan: string; tone: PillTone }> = {
  PENDING: { nhan: "Chờ xếp", tone: "muted" },
  CONFIRMED: { nhan: "Đã xếp lớp", tone: "info" },
  STUDYING: { nhan: "Đang học", tone: "success" },
  // `ACTIVE` là giá trị MẶC ĐỊNH mà convert lead sinh ra (lib/enrollment-status.ts) —
  // với người đọc nó chính là "Đang học", không phải một trạng thái "cũ".
  ACTIVE: { nhan: "Đang học", tone: "success" },
  PAUSED: { nhan: "Bảo lưu", tone: "warning" },
  COMPLETED: { nhan: "Hoàn thành", tone: "info" },
  WITHDREW: { nhan: "Đã rút", tone: "muted" },
  TRANSFERRED: { nhan: "Đã chuyển lớp", tone: "muted" },
  CANCELLED: { nhan: "Đã huỷ", tone: "danger" },
};

/**
 * Ghi danh hiện ở khối "Lớp đang học" (dòng có thanh tiến độ + nút PDF). Giữ ĐÚNG bộ
 * trạng thái bản cũ của trang (`activeEnrollments`) — PAUSED cố ý nằm ngoài: em đang bảo
 * lưu không có tiến độ chạy, nó xuống bảng lịch sử với nhãn "Bảo lưu".
 */
export const GHI_DANH_DANG_HOC: readonly EnrollmentStatus[] = ["CONFIRMED", "STUDYING", "ACTIVE"];

export function laGhiDanhDangHoc(status: EnrollmentStatus): boolean {
  return GHI_DANH_DANG_HOC.includes(status);
}

/**
 * Giá trị cho `<input type="date">` ("yyyy-mm-dd") theo LỊCH VIỆT NAM.
 *
 * Bản cũ dùng `toISOString().slice(0, 10)` = ngày theo UTC. Ngày sinh nhập từ Excel lưu
 * lúc 00:00 giờ VN (= 17:00Z HÔM TRƯỚC) ⇒ form in lùi một ngày, và bấm Lưu là GHI lùi
 * thật một ngày — mỗi lần lưu lùi thêm một ngày. Ngày nhập từ form (00:00Z) đọc theo giờ
 * VN vẫn đúng ngày đó, nên đổi sang lịch VN không làm lệch dữ liệu nào đang đúng.
 */
export function ngayChoONhap(d: Date | string | null | undefined): string {
  if (d == null || d === "") return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return vnYmd(x);
}

/**
 * Tuổi tròn theo lịch VN tại thời điểm `now` (BẮT BUỘC truyền — luật 19: hàm đọc đồng hồ
 * thật là ca test hẹn giờ nổ). `null` khi không có ngày sinh / ngày sinh ở tương lai.
 */
export function tinhTuoi(dob: Date | null | undefined, now: Date): number | null {
  if (!dob || Number.isNaN(dob.getTime())) return null;
  const s = vnParts(dob);
  const n = vnParts(now);
  let tuoi = n.year - s.year;
  if (n.month < s.month || (n.month === s.month && n.day < s.day)) tuoi -= 1;
  return tuoi >= 0 ? tuoi : null;
}

/**
 * "Ngày nhập học" = ghi danh SỚM NHẤT còn sống (thay ô "Ngày đăng ký lần đầu" gõ tay —
 * chủ dự án chốt D3: con số đó suy được từ dữ liệu thật thì không bắt ai nhập tay nữa).
 */
export function ngayNhapHoc(ghiDanh: readonly { enrolledAt: Date }[]): Date | null {
  let som: Date | null = null;
  for (const g of ghiDanh) {
    if (!som || g.enrolledAt.getTime() < som.getTime()) som = g.enrolledAt;
  }
  return som;
}

/**
 * Link Facebook có được in thành thẻ `<a>` không. Giá trị đi qua `normalizeFacebookUrl`
 * lúc ghi nên đã là http(s) — đây là lớp thứ hai, vì một `href` là nơi `javascript:` chạy.
 */
export function laLinkMoDuoc(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\/[^\s]+$/i.test(url.trim());
}

/** Phần trăm đã học (0–100, làm tròn) cho thanh tiến độ; `null` khi khoá chưa có giáo trình. */
export function phanTramDaHoc(daHoc: number, tong: number): number | null {
  if (!(tong > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((daHoc / tong) * 100)));
}
