// lib/parttime/thao-tac.ts — lõi cho server action của hai màn phân công. Action tự `auth()` + hỏi quyền ở cơ sở
// trả về từ đây; file này chỉ tra cơ sở của mục tiêu và mở giao dịch (app/(admin|teacher) không được nhập `@/lib/db`).
import "server-only";
import type { Prisma, WorkSourceType } from "@prisma/client";
import { db } from "@/lib/db";
import { vnYmd } from "@/lib/time/vn";
import { docBuoi } from "./phan-cong-db";
import { laBuoiDaQua } from "./sua-buoi-da-qua";

export type Nguon = { sourceType: WorkSourceType; sourceId: string };

/** Cơ sở của buổi (để hỏi quyền đúng chỗ) — null nếu không thấy buổi. */
export async function coSoCuaNguon(n: Nguon): Promise<string | null> {
  return (await db.$transaction((tx) => docBuoi(tx, n)))?.centerId ?? null;
}

/**
 * Buổi ĐÃ QUA (đã chốt, hoặc ngày trước hôm nay giờ VN)? — ba thao tác phân công thường từ chối buổi đã qua và chỉ đường sang
 * "Sửa buổi đã qua" (bắt buộc lý do, có nhật ký đối soát). Chủ dự án 20/10/2026.
 */
export async function laBuoiDaQuaCua(n: Nguon | { assignmentId: string }): Promise<boolean> {
  const nguon = "assignmentId" in n ? await db.sessionStaffAssignment.findUnique({ where: { id: n.assignmentId }, select: { sourceType: true, sourceId: true } }) : n;
  if (!nguon) return false;
  const b = await db.$transaction((tx) => docBuoi(tx, nguon));
  return !!b && laBuoiDaQua(b, vnYmd(new Date()));
}

export async function coSoCuaPhanCong(id: string): Promise<string | null> {
  return (await db.sessionStaffAssignment.findUnique({ where: { id }, select: { centerId: true } }))?.centerId ?? null;
}

export async function coSoCuaTruc(id: string): Promise<string | null> {
  return (await db.operationsDutyAssignment.findUnique({ where: { id }, select: { centerId: true } }))?.centerId ?? null;
}

export async function coSoCuaDieuChinh(id: string): Promise<string | null> {
  return (await db.compensationAdjustment.findUnique({ where: { id }, select: { centerId: true } }))?.centerId ?? null;
}

export async function coSoCuaLop(classId: string): Promise<string | null> {
  return (await db.class.findUnique({ where: { id: classId }, select: { centerId: true } }))?.centerId ?? null;
}

/** Một giao dịch cho một thao tác — từ chối trong callback phải `throw` hoặc trả kết quả TRƯỚC phép ghi đầu tiên. */
export function trongGiaoDich<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(fn);
}
