import type { ScopedDb } from "@/lib/actions/factory";
import type { DongBaoCao } from "@/lib/elearning/report-compliance";

/**
 * EL-06 — TRA DỮ LIỆU cho báo cáo R1.
 *
 * ⚠️ Phòng ban và quản lý trực tiếp lấy từ ẢNH CHỤP trên chính dòng ghi danh
 * (`snapDepartmentId`, `snapManagerUserId`), KHÔNG join sống sang `Employee`.
 * Join sống thì một lần người ta chuyển phòng ban sẽ ĐỔI HỒI TỐ mọi báo cáo cũ —
 * báo cáo tháng 6 in lại hôm nay ra một con số khác, và không ai giải thích được.
 */
export async function traDongBaoCao(
  db: ScopedDb,
  assignmentId: string,
): Promise<DongBaoCao[]> {
  const rows = await db.trnEnrollment.findMany({
    where: { assignmentId },
    select: {
      userId: true,
      status: true,
      source: true,
      progressPercent: true,
      dueAtOriginal: true,
      completedAt: true,
      pausedAt: true,
      startedAt: true,
      snapDepartmentId: true,
      snapManagerUserId: true,
    },
    orderBy: { createdAt: "asc" },
  });
  if (!rows.length) return [];

  const userIds = [
    ...new Set([
      ...rows.map((r) => r.userId),
      ...rows.map((r) => r.snapManagerUserId).filter((x): x is string => !!x),
    ]),
  ];
  const deptIds = [
    ...new Set(rows.map((r) => r.snapDepartmentId).filter((x): x is string => !!x)),
  ];

  const [users, depts] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        employee: { select: { fullName: true, employeeCode: true } },
      },
    }),
    deptIds.length
      ? db.departmentDef.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const tenNguoi = new Map<string, { ten: string; ma: string }>();
  for (const u of users as {
    id: string;
    name: string | null;
    employee: { fullName: string; employeeCode: string } | null;
  }[]) {
    tenNguoi.set(u.id, {
      // Ưu tiên tên trên hồ sơ nhân sự: `User.name` có thể là bí danh người dùng
      // tự đặt, còn báo cáo gửi BGĐ thì phải gọi đúng tên trong sổ nhân sự.
      ten: u.employee?.fullName ?? u.name ?? "(chưa rõ)",
      ma: u.employee?.employeeCode ?? "",
    });
  }
  const tenPhong = new Map((depts as { id: string; name: string }[]).map((x) => [x.id, x.name]));

  return rows.map((r) => {
    const n = tenNguoi.get(r.userId);
    return {
      userId: r.userId,
      fullName: n?.ten ?? "(chưa rõ)",
      employeeCode: n?.ma ?? "",
      departmentName: r.snapDepartmentId ? (tenPhong.get(r.snapDepartmentId) ?? null) : null,
      managerName: r.snapManagerUserId
        ? (tenNguoi.get(r.snapManagerUserId)?.ten ?? null)
        : null,
      status: r.status,
      source: r.source,
      progressPercent: r.progressPercent,
      dueAtOriginal: r.dueAtOriginal,
      completedAt: r.completedAt,
      pausedAt: r.pausedAt,
      startedAt: r.startedAt,
    };
  });
}
