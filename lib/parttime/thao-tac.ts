// lib/parttime/thao-tac.ts — lõi cho server action của hai màn phân công. Action tự `auth()` + hỏi quyền ở cơ sở
// trả về từ đây; file này chỉ tra cơ sở của mục tiêu và mở giao dịch (app/(admin|teacher) không được nhập `@/lib/db`).
import "server-only";
import type { Prisma, WorkSourceType } from "@prisma/client";
import { db } from "@/lib/db";
import { docBuoi } from "./phan-cong-db";

export type Nguon = { sourceType: WorkSourceType; sourceId: string };

/** Cơ sở của buổi (để hỏi quyền đúng chỗ) — null nếu không thấy buổi. */
export async function coSoCuaNguon(n: Nguon): Promise<string | null> {
  return (await db.$transaction((tx) => docBuoi(tx, n)))?.centerId ?? null;
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
