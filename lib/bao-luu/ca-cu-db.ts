import type { PrismaClient } from "@prisma/client";
import { phanLoaiCaCu, type CaCu, type CaCuTho } from "@/lib/bao-luu/ca-cu";

// lib/bao-luu/ca-cu-db.ts — ĐỌC các ca bảo lưu cũ chưa có hồ sơ. CHỈ ĐỌC: không ghi gì ở file này (lưới `[BL7-CC-RO]` quét nguồn).
// Nhận `client` làm tham số để script chạy ngoài Next dùng được client riêng (`scripts/_script-db.ts`).
// ⚠️ KHÔNG qua `scopedDb`: báo cáo vận hành toàn hệ thống; màn nào dùng lại phải tự giới hạn tầm nhìn.

type Client = Pick<PrismaClient, "enrollment" | "studentReserve" | "enrollmentAuditLog">;

export async function docCaCuChuaCoHoSo(client: Client, p: { maxMonths: number; now: Date }): Promise<CaCu[]> {
  const paused = await client.enrollment.findMany({
    where: { status: "PAUSED", deletedAt: null },
    select: {
      id: true,
      studentId: true,
      centerId: true,
      updatedAt: true,
      student: { select: { name: true, centerId: true } },
      class: { select: { name: true, centerId: true } },
      course: { select: { name: true } },
    },
    orderBy: { id: "asc" },
  });
  if (paused.length === 0) return [];

  const studentIds = [...new Set(paused.map((e) => e.studentId))];
  const [hoSo, nhatKy] = await Promise.all([
    client.studentReserve.findMany({
      where: { studentId: { in: studentIds }, isActive: true, endedAt: null },
      select: { studentId: true, enrollmentId: true },
    }),
    client.enrollmentAuditLog.groupBy({
      by: ["enrollmentId"],
      where: { enrollmentId: { in: paused.map((e) => e.id) }, toStatus: "PAUSED" },
      _max: { createdAt: true },
    }),
  ]);
  const ngayPaused = new Map(nhatKy.map((n) => [n.enrollmentId, n._max.createdAt]));

  const tho: CaCuTho[] = paused.map((e) => ({
    enrollmentId: e.id,
    studentId: e.studentId,
    studentName: e.student.name,
    centerId: e.centerId ?? e.class.centerId ?? e.student.centerId ?? null,
    tenKhoa: e.course.name,
    tenLop: e.class.name,
    pausedTheoNhatKy: ngayPaused.get(e.id) ?? null,
    capNhatLuc: e.updatedAt,
  }));
  return phanLoaiCaCu({ ca: tho, hoSoConHieuLuc: hoSo, maxMonths: p.maxMonths, now: p.now });
}
