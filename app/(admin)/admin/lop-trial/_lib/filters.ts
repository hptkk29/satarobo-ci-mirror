// app/(admin)/admin/lop-trial/_lib/filters.ts — GĐ2.
//
// Hàm THUẦN dựng mệnh đề `where`. Tách khỏi queries.ts có chủ đích: file này chỉ
// import TYPE từ Prisma (bị xoá lúc biên dịch) nên vitest chạy được mà không cần
// Postgres, đúng quy ước của lib/reports/lead.ts.
import type { Prisma } from "@prisma/client";

export const BOOKING_STATUS_VALUES = [
  "SCHEDULED",
  "CONFIRMED",
  "ATTENDED",
  "MISSED",
  "POSTPONED",
  "ENROLLED",
  "REJECTED",
] as const;

/** Buổi hẹn coi là "đã xong" — mặc định ẩn cho đỡ nhiễu danh sách việc đang làm. */
const BOOKING_TERMINAL = ["ENROLLED", "REJECTED"] as const;

/** Lead đã rời phễu tư vấn thì buổi hẹn cũ của họ không còn là việc đang làm.
 *  GĐ5 — bốn giá trị cũ gộp còn hai: ENROLLED+REGISTERED → DA_DANG_KY (một bậc duy
 *  nhất cho "đã đăng ký"), LOST+DUPLICATE → DA_MAT (bản ghi trùng nay bị chặn ngay lúc
 *  tạo nên không còn là một bậc phễu). Tập lead bị ẩn KHÔNG đổi, chỉ gọn tên lại. */
const BOOKING_LEAD_EXCLUDED = ["DA_DANG_KY", "DA_MAT"] as const;

/** Bộ lọc danh sách lớp — tham số `status` trên URL. */
export type LocLop = "dang-mo" | "da-dong" | "da-huy" | "all";

/**
 * Đọc `status` trên URL thành bộ lọc. Giá trị cũ (`OPEN`/`RUNNING`/`COMPLETED`/
 * `CANCELLED` — chip trước 23/09) vẫn hiểu được, để link đã lưu không gãy; rác ⇒ mặc định.
 */
export function docLocLop(status: string | undefined): LocLop {
  switch (status) {
    case "all":
      return "all";
    case "da-dong":
    case "COMPLETED":
      return "da-dong";
    case "da-huy":
    case "CANCELLED":
      return "da-huy";
    default:
      return "dang-mo";
  }
}

/**
 * `where` cho danh sách lớp trải nghiệm — CÙNG luật với `trangThaiLop`
 * (`lib/trial/trang-thai-lop.ts`): lớp theo khung có ngày đã QUA là "Đã đóng" dù cột
 * `status` vẫn OPEN; lớp cũ chỉ đóng khi `COMPLETED`. Ca `[TTL-LOC]` canh hai bản khớp.
 *
 * @param homNay mốc UTC 00:00 của hôm nay theo lịch VN — BẮT BUỘC (luật 7/19): đọc đồng
 *   hồ ở đây là hàm lọc không test được và lệch múi giờ tiến trình.
 * `q` → tìm theo tên hoặc mã lớp, cộng dồn với bộ lọc (AND).
 */
export function buildClassListWhere(
  status: string | undefined,
  q: string | undefined,
  homNay: Date,
): Prisma.TrialClassV2WhereInput {
  const and: Prisma.TrialClassV2WhereInput[] = [];
  const loc = docLocLop(status);
  if (loc === "dang-mo") {
    and.push({ status: { notIn: ["COMPLETED", "CANCELLED"] } });
    and.push({ OR: [{ theoKhung: false }, { startDate: null }, { startDate: { gte: homNay } }] });
  } else if (loc === "da-dong") {
    and.push({ status: { not: "CANCELLED" } });
    and.push({ OR: [{ status: "COMPLETED" }, { theoKhung: true, startDate: { lt: homNay } }] });
  } else if (loc === "da-huy") {
    and.push({ status: "CANCELLED" });
  }

  const term = (q ?? "").trim();
  if (term) {
    and.push({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { code: { contains: term, mode: "insensitive" } },
      ],
    });
  }
  return and.length > 0 ? { AND: and } : {};
}

/**
 * `where` cho danh sách buổi hẹn học thử (V1). Chép nguyên luật lọc của màn cũ:
 * luôn ẩn lead đã xoá mềm (soft-delete không cascade nên buổi cũ vẫn còn);
 * chế độ mặc định ẩn thêm buổi đã xong VÀ lead đã rời phễu;
 * giáo viên thuần chỉ thấy buổi của mình.
 */
export function buildBookingListWhere(
  status: string | undefined,
  opts: { ownTeacherId?: string | null; q?: string; canSearchPhone?: boolean },
): Prisma.TrialClassWhereInput {
  const where: Prisma.TrialClassWhereInput = { lead: { deletedAt: null } };

  if (status === "all") {
    // "Tất cả" — chỉ còn ràng buộc lead chưa xoá mềm.
  } else if (status && (BOOKING_STATUS_VALUES as readonly string[]).includes(status)) {
    where.status = status as (typeof BOOKING_STATUS_VALUES)[number];
  } else {
    where.status = { notIn: [...BOOKING_TERMINAL] };
    where.lead = {
      deletedAt: null,
      status: { notIn: [...BOOKING_LEAD_EXCLUDED] },
    };
  }

  if (opts.ownTeacherId) where.teacherId = opts.ownTeacherId;

  const term = (opts.q ?? "").trim();
  if (term) {
    where.lead = {
      ...(where.lead as Prisma.LeadWhereInput),
      OR: [
        { parentName: { contains: term, mode: "insensitive" } },
        // ⚠️ S-1 (26/08/2026) — cổng này KHÔNG phải trang trí, và nó ĐÃ RƠI MẤT một lần
        // khi hợp nhất `main` → `test` ngày 16/09 (bản `main` quét SĐT vô điều kiện vì
        // nhánh đó chưa từng có chốt S-1). Ô tìm là đường rò GIÁN TIẾP: nó không in số ra
        // màn hình, nhưng ai gõ đủ số cũng biết số đó là khách nào. Che cột SĐT mà để ô
        // tìm quét cột đó thì việc che chỉ còn là hình thức. Vai vào được màn này gồm cả
        // Quản lý cơ sở (mất `leads:view-pii` ở Q9 rồi được trả lại 30/08), Giáo viên và
        // Đào tạo. Mặc định `false` — quên truyền cờ thì mất tính năng tìm, KHÔNG mất dữ
        // liệu cá nhân. Khoá bằng `lib/lead/lead-pii-callsites.test.ts`.
        ...(opts.canSearchPhone === true ? [{ phone: { contains: term } }] : []),
        { children: { some: { fullName: { contains: term, mode: "insensitive" } } } },
      ],
    };
  }
  return where;
}

/**
 * "YYYY-MM-DD" (ngày VN) → mốc UTC 00:00 để ghi vào cột `@db.Date`.
 *
 * KHÔNG dùng `new Date("2026-09-05")` vì hàm đó đọc múi giờ tiến trình: Vercel chạy
 * UTC còn máy dev +07, kết quả lệch một ngày. Cũng KHÔNG dùng `vnDateAt` — hàm đó trả
 * mốc 17:00 UTC hôm trước, đúng cho GIỜ chứ không đúng cho cột chỉ mang nghĩa NGÀY.
 */
export function ngayVnSangUtc(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}
