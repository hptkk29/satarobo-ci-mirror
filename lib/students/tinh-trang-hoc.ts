// lib/students/tinh-trang-hoc.ts — "TÌNH TRẠNG HỌC" hiển thị ở danh sách học viên.
//
// ⚠️ KHÁC `Student.status`, và khác có chủ đích. Đọc kỹ trước khi sửa.
//
// `Student.status` trả lời "em còn là học viên của trung tâm không"
// (ACTIVE / PAUSED / GRADUATED / INACTIVE) — nó KHÔNG biết em đang ngồi lớp nào.
// Cột này trả lời "em đang ở đâu trong việc học", suy từ chính các ghi danh.
//
// VÌ SAO PHẢI CÓ (22/09/2026): sau khi vá "hoàn thành lớp kéo theo học viên"
// (`completeClassAction`), ghi danh chuyển sang COMPLETED ⇒ em hết lớp đang học.
// Màn `/admin/students` khi đó in badge **"Đang học"** (vì `Student.status` vẫn ACTIVE,
// và đúng là không nên đổi — xem dưới) trong khi em nằm ở tab **"Chờ xếp lớp"**.
// Hai chữ chỏi nhau trên cùng một dòng, và cả hai đều không nói được điều người dùng
// cần biết: **em vừa học xong khoá**.
//
// VÌ SAO KHÔNG ghi thẳng `Student.status = GRADUATED` (chủ dự án chốt 22/09):
//   · Hai tab "Đang học" và "Chờ xếp lớp" đều khoá cứng `status: "ACTIVE"`
//     (`lifecycle.ts`). Đặt GRADUATED mà quên lật ngược khi em đăng ký khoá mới là
//     em **biến mất khỏi cả hai tab vĩnh viễn**, không lỗi nào báo.
//   · Đường lật ngược ấy phải cắm vào **11 chỗ tạo ghi danh / 8 file** — quên một chỗ
//     là một nhóm học viên tàng hình.
//   · Và về nghiệp vụ: em học xong Sata 3 để lên Sata 4 vẫn là học viên của trung tâm,
//     gọi là "tốt nghiệp" là sai. GRADUATED để dành cho người vận hành đặt tay.
//
// File này KHÔNG import `@/lib/db` (chỉ import KIỂU từ @prisma/client) nên client
// component dùng được — đừng chuyển nó sang `lifecycle.ts`, bên đó kéo Prisma vào bundle.
import type { EnrollmentStatus, StudentStatus } from "@prisma/client";
import { STUDYING_ENROLLMENT_STATUSES } from "@/lib/enrollment-status";

/** Ghi danh đã ĐĂNG KÝ nhưng chưa vào học — em đang chờ giáo vụ xếp lớp. */
export const CHO_XEP_ENROLLMENT_STATUSES: EnrollmentStatus[] = ["PENDING", "CONFIRMED"];

export type TinhTrangHocKey =
  | "dang-hoc"
  | "vua-hoan-thanh"
  | "cho-xep-lop"
  | "bao-luu"
  | "nghi-hoc"
  | "hoan-thanh";

export type TinhTrangHoc = {
  key: TinhTrangHocKey;
  label: string;
  /** Lớp Tailwind, dùng token `.admin-scope` — khớp bảng màu cũ của trang. */
  color: string;
};

const CHIP: Record<TinhTrangHocKey, { label: string; color: string }> = {
  "dang-hoc": { label: "Đang học", color: "bg-state-success-soft text-state-success-ink" },
  "vua-hoan-thanh": {
    label: "Hoàn thành khoá",
    color: "bg-state-info-soft text-state-info-ink",
  },
  "cho-xep-lop": { label: "Chờ xếp lớp", color: "bg-state-warning-soft text-state-warning-ink" },
  "bao-luu": { label: "Bảo lưu", color: "bg-state-warning-soft text-state-warning-ink" },
  "hoan-thanh": { label: "Hoàn thành", color: "bg-state-info-soft text-state-info-ink" },
  "nghi-hoc": { label: "Nghỉ học", color: "bg-muted text-muted-foreground" },
};

/**
 * Tình trạng học để HIỂN THỊ.
 *
 * Chỉ trạng thái `ACTIVE` mới được chia nhỏ — ba ca dưới đây. Các trạng thái còn lại
 * là quyết định của người vận hành (bảo lưu / nghỉ hẳn / đặt tay "Hoàn thành") nên giữ
 * nguyên nghĩa cũ, không suy diễn đè lên.
 *
 * Thứ tự xét KHÔNG đổi được:
 *   1. còn lớp đang học          → "Đang học"       (kể cả vừa xong một khoá khác)
 *   2. đã xong khoá, chưa đăng ký→ "Hoàn thành khoá" (nhóm Sale cần gọi bán khoá tiếp)
 *   3. còn lại                   → "Chờ xếp lớp"
 *
 * ⚠️ Ca (1) phải đứng TRƯỚC (2): em học Sata 2 song song, vừa xong Sata 1, thì vẫn là
 * "Đang học" — đảo thứ tự là em đang ngồi lớp bị gắn nhãn đã xong.
 * ⚠️ Ca (2) đòi KHÔNG có ghi danh `PENDING/CONFIRMED`: đã đăng ký khoá tiếp thì việc
 * cần làm là XẾP LỚP, không phải gọi bán — nên em đó thuộc ca (3).
 *
 * `enrollmentStatuses` là trạng thái của các ghi danh CÒN SỐNG (`deletedAt = null`).
 * Truyền cả ghi danh đã xoá mềm vào là đếm nhầm — đó là lý do tham số này không có
 * giá trị mặc định.
 */
export function tinhTinhTrangHoc(input: {
  status: StudentStatus;
  enrollmentStatuses: readonly EnrollmentStatus[];
}): TinhTrangHoc {
  const { status, enrollmentStatuses } = input;

  if (status === "PAUSED") return { key: "bao-luu", ...CHIP["bao-luu"] };
  if (status === "INACTIVE") return { key: "nghi-hoc", ...CHIP["nghi-hoc"] };
  if (status === "GRADUATED") return { key: "hoan-thanh", ...CHIP["hoan-thanh"] };

  const coLopDangHoc = enrollmentStatuses.some((s) => STUDYING_ENROLLMENT_STATUSES.includes(s));
  if (coLopDangHoc) return { key: "dang-hoc", ...CHIP["dang-hoc"] };

  const daXongKhoa = enrollmentStatuses.includes("COMPLETED");
  const dangChoXep = enrollmentStatuses.some((s) => CHO_XEP_ENROLLMENT_STATUSES.includes(s));
  if (daXongKhoa && !dangChoXep) return { key: "vua-hoan-thanh", ...CHIP["vua-hoan-thanh"] };

  return { key: "cho-xep-lop", ...CHIP["cho-xep-lop"] };
}
