import type { ScopedDb } from "@/lib/actions/factory";
import {
  cacLuatToWhere,
  luatLocSchema,
  type TuyChonLoc,
} from "@/lib/elearning/assignment-rule";
import { gopTapNguoiHoc, type NguoiTrongTap, type TapNguoiHoc } from "@/lib/elearning/audience";

/**
 * EL-05 — TRA TẬP NGƯỜI HỌC TỪ DB rồi giao cho `gopTapNguoiHoc` phân nhóm.
 *
 * Tệp này là phần KHÔNG thuần của cỗ máy giao bài; mọi quyết định "ai nhận bài"
 * nằm ở hàm thuần bên `audience.ts`. Ở đây chỉ có ba việc: nạp dữ liệu phụ trợ mà
 * bộ lọc cần, chạy truy vấn, và chọn đúng bộ cột.
 *
 * ⚠️ `db` phải là `scopedDb(actor)` KHÔNG bypass. Cách ly cơ sở ở đây làm đúng
 * việc của nó: người cấp cơ sở chỉ giao được cho người của cơ sở mình, còn Đào tạo
 * (cấp Hội sở) thì `isHoLevel` ⇒ không inject filter ⇒ THẤY CẢ người chưa có
 * `centerId` — đúng nhóm mà luật 6 bắt phải nêu đích danh. Nói cách khác: không
 * cần bypass để thi hành luật 6, và thêm bypass vào đây là mở một lỗ cách ly
 * không đổi lại được gì.
 */

/** Bộ cột dùng cho xem trước — KHÔNG lấy lương, SĐT, CCCD (không việc gì cần). */
const CHON = {
  id: true,
  employeeCode: true,
  fullName: true,
  jobTitle: true,
  centerId: true,
  orgUnitId: true,
  departmentId: true,
  managerId: true,
  joinedAt: true,
  userAccount: { select: { id: true } },
} as const;

type HangEmployee = {
  id: string;
  employeeCode: string;
  fullName: string;
  jobTitle: string;
  centerId: string | null;
  orgUnitId: string | null;
  departmentId: string | null;
  managerId: string | null;
  joinedAt: Date | null;
  userAccount: { id: string } | null;
};

const doiHang = (e: HangEmployee): NguoiTrongTap => ({
  employeeId: e.id,
  userId: e.userAccount?.id ?? null,
  employeeCode: e.employeeCode,
  fullName: e.fullName,
  jobTitle: e.jobTitle,
  centerId: e.centerId,
  orgUnitId: e.orgUnitId,
  departmentId: e.departmentId,
  managerId: e.managerId,
  joinedAt: e.joinedAt,
});

export async function traTapNguoiHoc(
  db: ScopedDb,
  input: {
    luat: unknown[];
    mode: "STATIC" | "DYNAMIC";
    now: Date;
    themTayUserId: string[];
    loaiTruUserId: string[];
  },
): Promise<TapNguoiHoc> {
  const opts: TuyChonLoc = { mode: input.mode, now: input.now };

  // ── Dữ liệu phụ trợ mà bộ lọc cần trước khi dựng được `where` ─────────────
  const dungChucDanh = input.luat.some(
    (l) => luatLocSchema.safeParse(l).data?.jobTitle !== undefined,
  );
  if (dungChucDanh) {
    // `jobTitle` là chuỗi tự do: phải nạp danh sách CÓ THẬT để nở nhãn đã chọn ra
    // đủ biến thể hoa/thường/khoảng trắng, nếu không người bị sót không hề biết.
    const ds = await db.employee.findMany({
      select: { jobTitle: true },
      distinct: ["jobTitle"],
    });
    opts.chucDanhCoThat = ds.map((x: { jobTitle: string }) => x.jobTitle);
  }

  const canKhoa = input.luat
    .map((l) => luatLocSchema.safeParse(l).data?.courseCompleted?.courseId)
    .filter((x): x is string => Boolean(x));
  if (canKhoa.length) {
    // `TrnEnrollment.userId` là cột trần (không có quan hệ Prisma sang `User`) nên
    // phải tra riêng — xem ghi chú `daHoanThanh` bên `assignment-rule.ts`.
    const rows = await db.trnEnrollment.findMany({
      where: {
        courseId: { in: canKhoa },
        status: { in: ["COMPLETED", "COMPLETED_LATE"] },
      },
      select: { courseId: true, userId: true },
    });
    const map: Record<string, string[]> = {};
    for (const c of canKhoa) map[c] = [];
    for (const r of rows as { courseId: string; userId: string }[]) {
      map[r.courseId]?.push(r.userId);
    }
    opts.daHoanThanh = map;
  }

  const theoLuat = (await db.employee.findMany({
    where: cacLuatToWhere(input.luat, opts),
    select: CHON,
  })) as HangEmployee[];

  // Người thêm tay tra RIÊNG, không nhét vào `where` của luật: họ được chọn đích
  // danh nên không phải qua bộ lọc — nhưng vẫn phải qua luật 6 (xem `audience.ts`).
  const themTay = input.themTayUserId.length
    ? ((await db.employee.findMany({
        where: { userAccount: { id: { in: input.themTayUserId } } },
        select: CHON,
      })) as HangEmployee[])
    : [];

  return gopTapNguoiHoc({
    theoLuat: theoLuat.map(doiHang),
    themTay: themTay.map(doiHang),
    loaiTruUserId: input.loaiTruUserId,
  });
}
