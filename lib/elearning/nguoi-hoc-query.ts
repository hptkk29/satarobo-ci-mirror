import type { ScopedDb } from "@/lib/actions/factory";
import { db as dbGoc } from "@/lib/db";
import { locCoSoLuotHoc, type PhamViCoSo } from "@/lib/elearning/report-scope";
import type { DongNguoiHoc } from "@/lib/elearning/nguoi-hoc";

/**
 * P7 — TRA DỮ LIỆU cho "Người học". Cùng khuôn với `traDongBaoCao` (R1): lượt học đọc qua `scopedDb` + `locCoSoLuotHoc(coSo)` BẮT BUỘC (luật 7 — `PhamViCoSo`
 * không có mặc định). Tên/phòng/khoá/lượt giao chỉ được tra theo id rút ra từ lượt học ĐÃ giới hạn cơ sở — không nhận id thô từ thanh địa chỉ.
 *
 * ⚠️ Phòng ban + vai trò lấy từ ẢNH CHỤP trên dòng ghi danh (`snapDepartmentId`, `snapJobTitle`), không join sống sang `Employee` (đổi phòng ban không được
 * đổi hồi tố báo cáo cũ) — như R1.
 * ⚠️ Trần `TRAN_LUOT_HOC`: quét có giới hạn rõ ràng và BÁO khi cắt (`biCat`), không im lặng bỏ bớt.
 */
export const TRAN_LUOT_HOC = 5000;

export type KetQuaNguoiHoc = { dong: DongNguoiHoc[]; biCat: boolean };

const CHON = {
  id: true,
  userId: true,
  courseId: true,
  assignmentId: true,
  centerId: true,
  status: true,
  source: true,
  progressPercent: true,
  dueAt: true,
  dueAtOriginal: true,
  completedAt: true,
  pausedAt: true,
  startedAt: true,
  snapDepartmentId: true,
  snapManagerUserId: true,
  snapJobTitle: true,
  assignment: { select: { title: true, isMandatory: true } },
} as const;

async function lamGiau(sdb: ScopedDb, rows: Array<{
  id: string; userId: string; courseId: string; assignmentId: string | null; centerId: string; status: string; source: string; progressPercent: number;
  dueAt: Date | null; dueAtOriginal: Date | null; completedAt: Date | null; pausedAt: Date | null; startedAt: Date | null;
  snapDepartmentId: string | null; snapManagerUserId: string | null; snapJobTitle: string; assignment: { title: string; isMandatory: boolean } | null;
}>): Promise<DongNguoiHoc[]> {
  if (rows.length === 0) return [];
  const userIds = [...new Set([...rows.map((r) => r.userId), ...rows.map((r) => r.snapManagerUserId).filter((x): x is string => !!x)])];
  const deptIds = [...new Set(rows.map((r) => r.snapDepartmentId).filter((x): x is string => !!x))];
  const courseIds = [...new Set(rows.map((r) => r.courseId))];
  const centerIds = [...new Set(rows.map((r) => r.centerId))];
  const [users, depts, courses, centers] = await Promise.all([
    sdb.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, employee: { select: { fullName: true, employeeCode: true } } } }),
    deptIds.length ? sdb.departmentDef.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }) : Promise.resolve([] as { id: string; name: string }[]),
    dbGoc.trnCourse.findMany({ where: { id: { in: courseIds } }, select: { id: true, title: true } }),
    // Mã cơ sở chỉ tra theo id RÚT RA từ lượt học đã giới hạn cơ sở — không nhận id thô.
    dbGoc.center.findMany({ where: { id: { in: centerIds } }, select: { id: true, code: true } }),
  ]);
  const maCoSo = new Map(centers.map((c) => [c.id, c.code]));
  const tenNguoi = new Map<string, { ten: string; ma: string }>();
  for (const u of users as { id: string; name: string | null; employee: { fullName: string; employeeCode: string } | null }[]) {
    tenNguoi.set(u.id, { ten: u.employee?.fullName ?? u.name ?? "(chưa rõ)", ma: u.employee?.employeeCode ?? "" });
  }
  const tenPhong = new Map((depts as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  const tenKhoa = new Map(courses.map((c) => [c.id, c.title]));
  return rows.map((r) => ({
    enrollmentId: r.id,
    userId: r.userId,
    fullName: tenNguoi.get(r.userId)?.ten ?? "(chưa rõ)",
    employeeCode: tenNguoi.get(r.userId)?.ma ?? "",
    departmentName: r.snapDepartmentId ? (tenPhong.get(r.snapDepartmentId) ?? null) : null,
    managerName: r.snapManagerUserId ? (tenNguoi.get(r.snapManagerUserId)?.ten ?? null) : null,
    status: r.status,
    source: r.source,
    progressPercent: r.progressPercent,
    dueAtOriginal: r.dueAtOriginal,
    dueAt: r.dueAt,
    completedAt: r.completedAt,
    pausedAt: r.pausedAt,
    startedAt: r.startedAt,
    courseId: r.courseId,
    courseTitle: tenKhoa.get(r.courseId) ?? "(khoá đã xoá)",
    assignmentId: r.assignmentId,
    assignmentTitle: r.assignment?.title ?? null,
    isMandatory: r.assignment?.isMandatory ?? false,
    jobTitle: r.snapJobTitle,
    centerId: r.centerId,
    coSoMa: maCoSo.get(r.centerId) ?? "",
  }));
}

/** MỌI lượt học trong tầm nhìn (mới → cũ), cắt ở `TRAN_LUOT_HOC` và báo `biCat`. */
export async function traNguoiHoc(sdb: ScopedDb, coSo: PhamViCoSo): Promise<KetQuaNguoiHoc> {
  const rows = await sdb.trnEnrollment.findMany({
    where: { ...locCoSoLuotHoc(coSo) },
    select: CHON,
    orderBy: { createdAt: "desc" },
    take: TRAN_LUOT_HOC + 1,
  });
  const biCat = rows.length > TRAN_LUOT_HOC;
  return { dong: await lamGiau(sdb, rows.slice(0, TRAN_LUOT_HOC) as never), biCat };
}

/** Lượt học trong tầm nhìn của MỘT TẬP người (cho thao tác hàng loạt). Id không có lượt nào trong tầm nhìn đơn giản không xuất hiện. */
export async function traNguoiHocTheoId(sdb: ScopedDb, coSo: PhamViCoSo, userIds: readonly string[]): Promise<DongNguoiHoc[]> {
  if (userIds.length === 0) return [];
  const rows = await sdb.trnEnrollment.findMany({
    where: { userId: { in: [...userIds] }, ...locCoSoLuotHoc(coSo) },
    select: CHON,
    orderBy: { createdAt: "desc" },
    take: TRAN_LUOT_HOC,
  });
  return lamGiau(sdb, rows as never);
}

export type HoSoNguoiHoc = { vaoLam: Date | null; quanLy: string | null; coVideoMo: number };

export type ChungNhanNguoiHoc = { id: string; certCode: string; khoa: string; validUntil: Date | null; status: string };

/**
 * MỘT người: `null` nếu người đó KHÔNG có lượt học nào trong tầm nhìn — "không có" và "ngoài tầm nhìn" không được phân biệt ra ngoài
 * (không lộ nhân viên ở cơ sở khác có tồn tại).
 */
export async function traMotNguoiHoc(sdb: ScopedDb, coSo: PhamViCoSo, userId: string): Promise<{ dong: DongNguoiHoc[]; chungNhan: ChungNhanNguoiHoc[]; hoSo: HoSoNguoiHoc } | null> {
  const rows = await sdb.trnEnrollment.findMany({
    where: { userId, ...locCoSoLuotHoc(coSo) },
    select: CHON,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  if (rows.length === 0) return null;
  const dong = await lamGiau(sdb, rows as never);
  // Chứng nhận chỉ của CÁC LƯỢT trong tầm nhìn (qua enrollmentId) — không đọc chứng nhận của lượt ở cơ sở khác.
  const cn = await dbGoc.trnCertificate.findMany({
    where: { userId, enrollmentId: { in: rows.map((r) => r.id) } },
    select: { id: true, certCode: true, courseId: true, validUntil: true, status: true },
    orderBy: { issuedAt: "desc" },
  });
  const tenKhoa = new Map(dong.map((d) => [d.courseId, d.courseTitle]));
  // Ngày vào làm = `Employee.joinedAt` của CHÍNH người này (id đã nằm trong tầm nhìn vì có lượt học trong phạm vi).
  // Cờ video = số cờ đang MỞ gắn với các lượt học TRONG tầm nhìn (cờ không gắn lượt học thì không đếm — không lộ ngoài phạm vi).
  const [nv, coVideoMo] = await Promise.all([
    dbGoc.user.findUnique({ where: { id: userId }, select: { employee: { select: { joinedAt: true } } } }),
    dbGoc.trnWatchFlag.count({ where: { userId, status: "OPEN", enrollmentId: { in: rows.map((r) => r.id) } } }),
  ]);
  const hoSo: HoSoNguoiHoc = { vaoLam: nv?.employee?.joinedAt ?? null, quanLy: dong[0]?.managerName ?? null, coVideoMo };
  return { dong, hoSo, chungNhan: cn.map((c) => ({ id: c.id, certCode: c.certCode, khoa: tenKhoa.get(c.courseId) ?? "", validUntil: c.validUntil, status: c.status })) };
}

/** Số chứng nhận CÒN HIỆU LỰC của từng người (cột "Chứng nhận" ở danh sách), chỉ cho id đã nằm trong tầm nhìn. */
export async function demChungNhanHopLe(userIds: readonly string[], coSo: PhamViCoSo): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  // Chỉ đếm chứng nhận của lượt học TRONG tầm nhìn (quan hệ `enrollment`) — cùng phạm vi cơ sở với danh sách, không lộ số của cơ sở khác.
  const g = await dbGoc.trnCertificate.groupBy({ by: ["userId"], where: { userId: { in: [...userIds] }, status: "VALID", enrollment: { ...locCoSoLuotHoc(coSo) } }, _count: { _all: true } });
  return new Map(g.map((x) => [x.userId, x._count._all]));
}

/** Giờ + phút (giờ VN) của lần nhắc gần nhất HÔM NAY cho từng người; người chưa được nhắc hôm nay không có mặt trong Map. */
export async function nhacHocHomNay(userIds: readonly string[], now: Date): Promise<Map<string, Date>> {
  if (userIds.length === 0) return new Map();
  const dau = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now)}T00:00:00+07:00`);
  const rows = await dbGoc.auditLog.findMany({
    where: { module: "elearning", entityType: "User", action: "REMIND", entityId: { in: [...userIds] }, createdAt: { gte: dau } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, createdAt: true },
  });
  const m = new Map<string, Date>();
  for (const r of rows) if (!m.has(r.entityId)) m.set(r.entityId, r.createdAt);
  return m;
}
