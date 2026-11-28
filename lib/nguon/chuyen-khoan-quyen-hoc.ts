/**
 * lib/nguon/chuyen-khoan-quyen-hoc.ts — P7-B: ĐỌC «quyền học» (bảng StudyEntitlement) cho vân tay, ảnh chụp bất biến và báo cáo của lệnh chuyển khoản/giá.
 *
 * VÌ SAO CÓ TỆP NÀY. Bảng `StudyEntitlement` thuộc tính năng «quyền học», chưa nằm trong schema `main` / PROD (đo 28/10/2026: PROD có 362 migration, không có bảng này).
 * Lõi P7-B coi quyền học là thứ lệnh này KHÔNG ĐƯỢC ĐỘNG TỚI (vân tay đổi nếu nó đổi · ảnh chụp bất biến trước = sau · báo cáo số buổi). Đó là một lưới an toàn, không phải luật nghiệp vụ
 * của việc chuyển khoản: lệnh không đọc quyền học để QUYẾT ĐỊNH chuyển hay không, và không ghi nó.
 *
 * LUẬT CỦA TỆP NÀY — KHÔNG phải «nuốt lỗi P2021»:
 *   1. Bảng có mặt  ⇒ đọc ĐẦY ĐỦ như cũ (`to_jsonb` cả hàng, sắp theo id) — vân tay/ảnh chụp bắt mọi đổi dù chỉ một cột.
 *   2. Bảng vắng mặt ⇒ trả `coBang: false` + 0 hàng, và `coBang` đi VÀO vân tay + ảnh chụp + báo cáo. «Không có bảng» là một SỰ THẬT được ký, không phải số 0 im lặng.
 *      Hệ quả: nếu bảng xuất hiện giữa lần chạy thử và lần ghi (migration chạy xen vào) thì vân tay đổi ⇒ cổng từ chối ⇒ phải chạy thử lại.
 *   3. Chỉ có `to_regclass` quyết định «vắng/có». MỌI lỗi khác (thiếu quyền SELECT, mất kết nối, cột đổi tên) vẫn NÉM — kiểm quyền SELECT ở các script chạy khi bảng có mặt.
 *   4. Chỉ ĐỌC. Không INSERT/UPDATE/DELETE bảng này ở bất kỳ đâu trong lõi P7-B (lưới `[CKQH-*]`).
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type Khach = PrismaClient | Prisma.TransactionClient;

/** Có bảng quyền học trong schema đang nối không. Chỉ `to_regclass`; không bắt lỗi nào. */
export async function coBangQuyenHoc(c: Khach): Promise<boolean> {
  const r = await c.$queryRaw<{ co: boolean }[]>`SELECT to_regclass('public."StudyEntitlement"') IS NOT NULL AS co`;
  return r[0]?.co === true;
}

export type HangQuyenHocDayDu = Record<string, unknown> & { id: string; enrollmentId: string | null };
export type QuyenHocDayDu = { coBang: boolean; hang: HangQuyenHocDayDu[] };

/** Mọi hàng quyền học của các ghi danh đã cho — MỌI cột (qua `to_jsonb`), sắp theo id. Bảng vắng ⇒ `{ coBang: false, hang: [] }`. */
export async function docQuyenHocDayDu(c: Khach, enrollmentIds: readonly string[]): Promise<QuyenHocDayDu> {
  if (!(await coBangQuyenHoc(c))) return { coBang: false, hang: [] };
  const ids = [...enrollmentIds];
  const r = await c.$queryRaw<{ j: HangQuyenHocDayDu }[]>`
    SELECT to_jsonb(t) AS j FROM "public"."StudyEntitlement" t WHERE t."enrollmentId" = ANY(${ids}::text[]) ORDER BY t."id" ASC`;
  return { coBang: true, hang: r.map((x) => x.j) };
}

export type HangQuyenHocTomTat = { enrollmentId: string | null; purchaseSessions: number; consumedSessions: number };
export type QuyenHocTomTat = { coBang: boolean; hang: HangQuyenHocTomTat[] };

/** Số buổi mua / đã dùng của các ghi danh đã cho (cho báo cáo BEFORE/AFTER). Bảng vắng ⇒ `{ coBang: false, hang: [] }`. */
export async function docQuyenHocTomTat(c: Khach, enrollmentIds: readonly string[]): Promise<QuyenHocTomTat> {
  if (!(await coBangQuyenHoc(c))) return { coBang: false, hang: [] };
  const ids = [...enrollmentIds];
  const hang = await c.$queryRaw<HangQuyenHocTomTat[]>`
    SELECT "enrollmentId", "purchaseSessions", "consumedSessions" FROM "public"."StudyEntitlement" WHERE "enrollmentId" = ANY(${ids}::text[]) ORDER BY "id" ASC`;
  return { coBang: true, hang };
}

/**
 * Dùng cho kiểm quyền của script: bảng có mặt ⇒ user PHẢI có SELECT trên nó (thiếu ⇒ script dừng, như mọi bảng khác); bảng vắng ⇒ không có gì để kiểm quyền.
 * `selectDuoc` là `null` khi bảng vắng.
 */
export async function kiemQuyenDocQuyenHoc(c: Khach): Promise<{ coBang: boolean; selectDuoc: boolean | null }> {
  if (!(await coBangQuyenHoc(c))) return { coBang: false, selectDuoc: null };
  const r = await c.$queryRaw<{ ok: boolean | null }[]>`SELECT has_table_privilege(current_user, 'public."StudyEntitlement"', 'SELECT') AS ok`;
  return { coBang: true, selectDuoc: r[0]?.ok === true };
}
