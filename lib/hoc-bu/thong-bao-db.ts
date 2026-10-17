// lib/hoc-bu/thong-bao-db.ts — NỬA ĐỌC + GHI của thông báo học bù (T13, 08/10/2026). Luật nói gì, ai nhận, khoá ra sao: `thong-bao-thuan.ts`.
//
// Đọc bằng `db` trần có chủ đích: đây là đường HỆ THỐNG (consumer của outbox / cron), không có người dùng nào đứng sau để áp phạm vi cơ sở. Phạm vi nằm ở
// chỗ CHỌN NGƯỜI NHẬN (Sale của học viên đó, quản lý của cơ sở đó, giáo viên của case đó), không ở chỗ đọc dữ liệu.
import "server-only";
import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { quanLyCoSo } from "@/lib/notifications/nguoi-nhan-phia-sale";
import { vnYmd } from "@/lib/time/vn";
import type { TinNhan } from "@/lib/hoc-bu/thong-bao-thuan";

export type MucDeBao = { lessonId: string | null; tenBai: string; result: "PLANNED" | "COMPLETED" | "NOT_COMPLETED" | "RELEASED"; danhGia: string | null };
export type BeDeBao = {
  id: string;
  studentId: string;
  tenBe: string;
  attendanceStatus: "PENDING" | "PRESENT" | "ABSENT" | "REMOVED";
  nhanXetChung: string | null;
  muc: MucDeBao[];
};
export type CaseDeBao = {
  id: string;
  centerId: string;
  status: string;
  ymd: string;
  startTime: string;
  endTime: string;
  teacherId: string;
  tenGv: string | null;
  tenPhong: string | null;
  tenBaiCase: string[];
  be: BeDeBao[];
};

/** Đọc MỘT case với bé + mục + tên bài. Trả null khi case không còn. */
export async function docCaseDeBao(caseId: string): Promise<CaseDeBao | null> {
  const c = await db.makeupCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      centerId: true,
      status: true,
      date: true,
      startTime: true,
      endTime: true,
      teacherId: true,
      roomId: true,
      lessonId: true,
      lessons: { select: { lessonId: true }, orderBy: { order: "asc" } },
      participants: {
        select: {
          id: true,
          studentId: true,
          attendanceStatus: true,
          generalComment: true,
          student: { select: { name: true } },
          items: {
            select: { lessonId: true, result: true, teacherEvaluation: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!c) return null;
  // Tên bài: một câu cho mọi id (case / mục chỉ mang `lessonId` trần).
  const baiIds = [...new Set([c.lessonId, ...c.lessons.map((l) => l.lessonId), ...c.participants.flatMap((b) => b.items.map((m) => m.lessonId))].filter((x): x is string => !!x))];
  const tenBai = new Map((await db.lesson.findMany({ where: { id: { in: baiIds } }, select: { id: true, title: true } })).map((l) => [l.id, l.title]));
  const tenBaiCua = (id: string | null): string => (id ? tenBai.get(id) : undefined) ?? "buổi học";
  const [gv, phong] = await Promise.all([
    db.user.findUnique({ where: { id: c.teacherId }, select: { name: true } }),
    c.roomId ? db.room.findUnique({ where: { id: c.roomId }, select: { name: true } }) : Promise.resolve(null),
  ]);
  return {
    id: c.id,
    centerId: c.centerId,
    status: c.status,
    ymd: vnYmdCuaNgayDb(c.date),
    startTime: c.startTime,
    endTime: c.endTime,
    teacherId: c.teacherId,
    tenGv: gv?.name ?? null,
    tenPhong: phong?.name ?? null,
    tenBaiCase: c.lessons.length > 0 ? c.lessons.map((l) => tenBaiCua(l.lessonId)) : [tenBaiCua(c.lessonId)],
    be: c.participants.map((b) => ({
      id: b.id,
      studentId: b.studentId,
      tenBe: b.student.name,
      attendanceStatus: b.attendanceStatus,
      nhanXetChung: b.generalComment,
      muc: b.items.map((m) => ({ lessonId: m.lessonId, tenBai: tenBaiCua(m.lessonId), result: m.result, danhGia: m.teacherEvaluation })),
    })),
  };
}

/** Cột `@db.Date` đọc ra là nửa đêm UTC của ngày VN — lấy phần ngày UTC, đừng đổi múi giờ (sẽ lệch ngày). */
const vnYmdCuaNgayDb = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Sale của học viên = đúng định nghĩa của màn học bù (`hocVienCuaSale`): Sale ghi trên ghi danh còn sống; chưa gán thì Sale của phiếu lead.
 * Không có ai ⇒ quản lý cơ sở (để việc không rơi vào khoảng trống). Chỉ tài khoản còn hoạt động.
 */
export async function nguoiNhanSaleCuaHocVien(studentId: string, centerId: string | null): Promise<string[]> {
  const s = await db.student.findUnique({
    where: { id: studentId },
    select: {
      enrollments: { where: { deletedAt: null, saleId: { not: null } }, select: { saleId: true } },
      lead: { select: { assignedToId: true } },
    },
  });
  const ung = [...new Set([...(s?.enrollments.map((e) => e.saleId!) ?? []), ...(s?.lead?.assignedToId ? [s.lead.assignedToId] : [])])];
  const hoatDong = ung.length
    ? (await db.user.findMany({ where: { id: { in: ung }, isActive: true, deletedAt: null }, select: { id: true } })).map((u) => u.id)
    : [];
  if (hoatDong.length > 0) return hoatDong;
  return centerId ? quanLyCoSo(centerId) : [];
}

/** Thông báo cổng phụ huynh (feed của học viên). Khoá trùng ⇒ cập nhật nội dung chứ không tạo thêm. */
export async function baoPhuHuynh(p: { studentId: string; centerId: string | null; dedupeKey: string; tin: TinNhan }): Promise<void> {
  await db.notification.upsert({
    where: { dedupeKey: p.dedupeKey },
    create: {
      title: p.tin.tieuDe,
      body: p.tin.noiDung,
      audience: "STUDENT",
      studentId: p.studentId,
      centerId: p.centerId,
      createdByName: "Hệ thống",
      dedupeKey: p.dedupeKey,
    },
    update: { title: p.tin.tieuDe, body: p.tin.noiDung },
  });
}

/** Chuông nhân sự. Đường admin clean-URL `/hoc-bu` — giáo viên được `teacherHref` đổi sang `/teacher/hoc-bu`. */
export async function baoNhanSu(p: { userIds: readonly string[]; dedupeKey: string; tin: TinNhan; entityId: string }): Promise<void> {
  if (p.userIds.length === 0) return;
  await notifyStaff({
    userIds: p.userIds,
    dedupeKey: p.dedupeKey,
    title: p.tin.tieuDe,
    body: p.tin.noiDung,
    href: "/hoc-bu",
    entityId: p.entityId,
  });
}

export { vnYmd };
