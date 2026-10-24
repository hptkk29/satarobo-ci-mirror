// lib/crm/dedupe.ts — R7-05 §8.4: dedupe parent (email + phone, 3 nhánh) + student
// (parent + tên chuẩn hoá + DOB). Logic phân loại THUẦN (test được); lookup DB tách riêng.
import { db } from "@/lib/db";
import type { Prisma, PrismaClient } from "@prisma/client";
import { canonicalPhone, phoneVariants } from "@/lib/phone";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Chuẩn hoá tên: trim + gộp khoảng trắng + casefold. THUẦN. */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Chuẩn hoá SĐT → canonical `84XXXXXXXXX`. THUẦN.
 * AUTH-SĐT P1 — trước đây chỉ giữ chữ số nên `0905…` và `84905…` là 2 khoá khác
 * nhau, tức dedupe phụ huynh bỏ sót đúng những cặp trùng thật.
 */
export function normalizePhone(s: string | null | undefined): string {
  return canonicalPhone(s) ?? (s ?? "").replace(/\D/g, "");
}

export type ParentMatch =
  | { kind: "none" }
  | { kind: "reuse"; userId: string }
  | { kind: "conflict"; parentAId: string; parentBId: string };

/**
 * 3 nhánh dedupe parent (THUẦN — SRS §8.4):
 * - không khớp → none (tạo mới).
 * - chỉ 1 trong 2 khớp, hoặc cả 2 khớp CÙNG 1 hồ sơ → reuse.
 * - email∈A & phone∈B (KHÁC nhau) → conflict (khoá convert, Admin xử lý).
 */
export function classifyParentMatch(
  byEmailId: string | null,
  byPhoneId: string | null,
): ParentMatch {
  if (!byEmailId && !byPhoneId) return { kind: "none" };
  if (byEmailId && byPhoneId) {
    return byEmailId === byPhoneId
      ? { kind: "reuse", userId: byEmailId }
      : { kind: "conflict", parentAId: byEmailId, parentBId: byPhoneId };
  }
  return { kind: "reuse", userId: (byEmailId ?? byPhoneId) as string };
}

/**
 * Tìm parent theo email (`User.email`) + phone.
 *
 * AUTH-SĐT P5 — nhánh phone tra **HAI nguồn, theo thứ tự ưu tiên**:
 *   1. `User.phone` (canonical, @unique) — sau P5 đây là khoá ĐỊNH DANH thật của
 *      tài khoản phụ huynh, nên nó thắng;
 *   2. `Student.parentPhone → parentUserId` — nguồn cũ, giữ lại vì phần lớn hồ sơ
 *      tạo trước P5 có `User.phone = null` (convert lead cũ không ghi cột này).
 * Bỏ bước 1 thì phụ huynh cấp tài khoản bằng SĐT (đường `lib/parents/provision.ts`)
 * sẽ vô hình với dedupe ⇒ convert lại đẻ tài khoản thứ hai trùng số, và `@unique`
 * chặn ở tận đường ghi bằng một lỗi P2002 khó hiểu thay vì "reuse".
 */
export async function findParentMatch(
  input: { email?: string | null; phone?: string | null },
  client: DbClient = db,
): Promise<ParentMatch> {
  const email = (input.email ?? "").trim().toLowerCase();
  const canonical = canonicalPhone(input.phone);
  // AUTH-SĐT P1 — tra cả dạng canonical mới lẫn `0…` cũ (xem `phoneVariants`).
  const variants = phoneVariants(input.phone);
  const [byEmail, byPhoneUser, byPhoneStudent] = await Promise.all([
    email ? client.user.findFirst({ where: { email }, select: { id: true } }) : null,
    canonical
      ? client.user.findFirst({
          where: { phone: canonical, deletedAt: null },
          select: { id: true },
        })
      : null,
    variants.length
      ? client.student.findFirst({
          where: {
            parentPhone: { in: variants },
            parentUserId: { not: null },
            deletedAt: null,
          },
          select: { parentUserId: true },
        })
      : null,
  ]);
  const byPhoneId = byPhoneUser?.id ?? byPhoneStudent?.parentUserId ?? null;
  return classifyParentMatch(byEmail?.id ?? null, byPhoneId);
}

/** So khớp 1 student ứng viên với student cũ (THUẦN): cùng tên chuẩn hoá + DOB. */
export function studentMatches(
  a: { name: string; dob: Date | null },
  b: { name: string; dob: Date | null },
): boolean {
  if (normalizeName(a.name) !== normalizeName(b.name)) return false;
  const ad = a.dob?.toISOString().slice(0, 10) ?? null;
  const bd = b.dob?.toISOString().slice(0, 10) ?? null;
  return ad === bd;
}

/**
 * Tìm student trùng CÙNG PARENT (chỉ same-parent — §6): tên chuẩn hoá + DOB.
 * Trả về studentId cũ để chỉ tạo Enrollment mới (AC4). null = không trùng.
 */
export async function findExistingStudent(
  input: { parentUserId: string; name: string; dob: Date | null },
  client: DbClient = db,
): Promise<string | null> {
  if (!input.parentUserId) return null;
  const candidates = await client.student.findMany({
    where: { parentUserId: input.parentUserId, deletedAt: null },
    select: { id: true, name: true, dateOfBirth: true },
  });
  const hit = candidates.find((c) =>
    studentMatches({ name: input.name, dob: input.dob }, { name: c.name, dob: c.dateOfBirth }),
  );
  return hit?.id ?? null;
}
