// lib/working-hours/service.ts — tầng ĐỌC DB cho giờ làm việc (Q-C, 19/08/2026).
//
// Lõi tính toán nằm ở `./rules.ts` (thuần, test không cần Postgres). File này chỉ lo truy
// vấn + ghép, để phần dễ sai nhất (múi giờ, biên mở/đóng, rơi bậc) test được bằng Vitest.
//
// ─── `WorkingHourRule` KHÔNG vào `SCOPED_MODELS` của lib/db-scope.ts ───────────────────
// Không phải vì "nó là config", mà vì lý do CƠ HỌC: `scopedDb` inject `where.centerId IN
// (...)`, còn bảng này KHÔNG CÓ cột `centerId` (luật Nền Hệ thống #3: bảng mới dùng
// `orgUnitId`, không thêm `centerId` mới). Đưa vào `SCOPED_MODELS` là ném lỗi Prisma
// "Unknown argument centerId" ngay truy vấn đầu tiên.
// Cũng KHÔNG khai vào `SCOPE_EXEMPT`: tập đó tự mô tả là "model CÓ centerId nhưng KHÔNG
// scope", thêm một model không có cột vào đó là làm hỏng chính bất biến khiến nó tồn tại
// (`RoleDef` — cũng không có centerId — vốn đã không nằm ở đâu cả, xem
// tests/e2e/a0/scoped-db-select.spec.ts:105).
// ⇒ Hệ quả PHẢI NHỚ khi làm màn quản trị (việc 2/2): **không có lưới an toàn tầng truy vấn**.
// Mọi Server Action ghi giờ làm việc phải tự kiểm quyền theo `orgUnitId` mục tiêu qua
// `can()`, y như `Holiday`/`WorkShiftConfig` — nếu không, quản lý CS1 sửa được giờ CS2.
// (Bẫy ngược lại của Holiday — nằm trong `SCOPED_MODELS` mà không nằm trong
// `NULL_IS_GLOBAL_MODELS` nên dòng toàn hệ thống tàng hình với người cấp cơ sở — ở đây
// KHÔNG tái diễn: dòng chung mang sentinel `"*"`, không mang NULL, nên đọc luôn thấy.)
//
// Đường đọc dùng `db` trần là ĐÚNG chỗ: file nằm trong `lib/`, không phải
// `app/(admin|portal|teacher)/**` nên không vướng ESLint cổng DB.

import "server-only";
import { db } from "@/lib/db";
import {
  WILDCARD,
  resolveWorkingHourWeek,
  type WorkingHourRuleRow,
  type WorkingHourWeek,
} from "./rules";

/**
 * Bảng giờ làm việc áp dụng cho một (đơn vị, vai).
 *
 * Thứ tự tra, rơi dần TỪNG THỨ một (đơn vị có thể chỉ khai riêng Thứ Bảy):
 *   1. (orgUnit, role) → 2. (orgUnit, "*") → 3. ("*", role) → 4. ("*", "*")
 *   → 5. `DEFAULT_WORKING_HOUR_WEEK` (lưới cuối khi DB trống — không phải nơi chỉnh giờ).
 *
 * `orgUnitId = null` (chưa biết đơn vị, vd job chạy nền) → chỉ còn bậc 3/4/5.
 * `roleCode` bỏ trống → chỉ còn bậc 2/4/5. Truyền vai vào ngay từ bây giờ dù DB chưa có
 * dòng theo vai nào: chiều đó đã có sẵn trong schema để "sau này các vai có giờ khác nhau"
 * chỉ là thêm DỮ LIỆU, và chỗ gọi không phải sửa lại chữ ký hàm lúc đó.
 */
export async function getWorkingHourWeek(
  orgUnitId: string | null,
  roleCode?: string | null,
): Promise<WorkingHourWeek> {
  const org = orgUnitId ?? WILDCARD;
  const role = roleCode ?? WILDCARD;

  // MỘT truy vấn cho cả 4 bậc rồi lọc trong bộ nhớ: 4 lần round-trip DB để lấy tối đa 28
  // dòng cấu hình là đắt vô ích, và tra tuần tự còn dễ viết sai thứ tự rơi bậc.
  const rows = await db.workingHourRule.findMany({
    where: {
      orgUnitId: org === WILDCARD ? WILDCARD : { in: [org, WILDCARD] },
      roleCode: role === WILDCARD ? WILDCARD : { in: [role, WILDCARD] },
    },
    select: {
      orgUnitId: true,
      roleCode: true,
      weekday: true,
      openTime: true,
      closeTime: true,
      isClosed: true,
    },
  });

  const typed: WorkingHourRuleRow[] = rows;
  return resolveWorkingHourWeek(typed, org, role);
}

export type { WorkingHourWeek };
