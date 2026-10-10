import { db } from "@/lib/db";
import type { Prisma, PrismaClient } from "@prisma/client";

// =============================================================================
// CODEGEN — mã định danh CS<n>.<LOAI>.<YY>.<seq> (Phase T0.2)
// Tất cả mã có năm 2 chữ số; seq reset theo năm (năm nằm trong Counter key).
// Counter atomic: upsert + increment (an toàn race condition).
// =============================================================================

type DbClient = PrismaClient | Prisma.TransactionClient;

/** 2 chữ số cuối năm hiện tại, vd 2026 -> "26". */
export function yy(date = new Date()): string {
  return String(date.getFullYear() % 100).padStart(2, "0");
}

/** Sanitize course/center code: bỏ ký tự không phải chữ-số, in hoa (SATA_3 -> SATA3). */
function sanitize(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Atomic increment + trả về seq tiếp theo cho `key`.
 * Dùng upsert: nếu chưa có key thì tạo (lastValue=1), nếu có thì increment.
 */
export async function nextSeq(key: string, client: DbClient = db): Promise<number> {
  const row = await client.counter.upsert({
    where: { key },
    create: { key, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
    select: { lastValue: true },
  });
  return row.lastValue;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** CS1.HV.26.001 — học viên (seq 3 số). */
export async function genStudentCode(centerCode: string, client: DbClient = db): Promise<string> {
  const cc = sanitize(centerCode);
  const y = yy();
  const seq = await nextSeq(`HV:${cc}:${y}`, client);
  return `${cc}.HV.${y}.${pad(seq, 3)}`;
}

// ─── R7-05 — mã học viên v2: CS1-26-AB3K9P (charset không nhập nhằng, ngẫu nhiên) ──
/** Charset bỏ ký tự dễ nhầm: I, L, O, 0, 1. */
export const STUDENT_CODE_V2_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Thân mã ngẫu nhiên 6 ký tự (THUẦN — inject `rand` để test). */
export function randomStudentCodeBody(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += STUDENT_CODE_V2_CHARSET[Math.floor(rand() * STUDENT_CODE_V2_CHARSET.length)];
  }
  return s;
}

/** Định dạng mã v2 `${CS}-${YY}-${body}` (THUẦN). */
export function formatStudentCodeV2(centerCode: string, body: string, date = new Date()): string {
  return `${sanitize(centerCode)}-${yy(date)}-${body}`;
}

/** Sinh mã HV v2 duy nhất (retry khi đụng unique — C9). */
export async function genStudentCodeV2(
  centerCode: string,
  client: DbClient = db,
  opts?: { rand?: () => number; maxRetries?: number },
): Promise<string> {
  const rand = opts?.rand ?? Math.random;
  const maxRetries = opts?.maxRetries ?? 10;
  for (let i = 0; i < maxRetries; i++) {
    const code = formatStudentCodeV2(centerCode, randomStudentCodeBody(rand));
    const existing = await client.student.findUnique({
      where: { studentCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new Error("Không sinh được mã học viên duy nhất sau nhiều lần thử");
}

/** CS1.NV.26.001 — nhân viên (seq 3 số). */
export async function genEmployeeCode(centerCode: string, client: DbClient = db): Promise<string> {
  const cc = sanitize(centerCode);
  const y = yy();
  const seq = await nextSeq(`NV:${cc}:${y}`, client);
  return `${cc}.NV.${y}.${pad(seq, 3)}`;
}

/** CS1.LOP.26.001 — nhóm lớp cố định (seq 3 số). */
export async function genClassGroupCode(centerCode: string, client: DbClient = db): Promise<string> {
  const cc = sanitize(centerCode);
  const y = yy();
  const seq = await nextSeq(`LOP:${cc}:${y}`, client);
  return `${cc}.LOP.${y}.${pad(seq, 3)}`;
}

/** CS1.SATA3.26.001 — lớp học theo khoá (seq 3 số, key gồm courseCode). */
export async function genClassCode(
  centerCode: string,
  courseCode: string,
  client: DbClient = db,
): Promise<string> {
  const cc = sanitize(centerCode);
  const course = sanitize(courseCode);
  const y = yy();
  const seq = await nextSeq(`CLS:${cc}:${course}:${y}`, client);
  return `${cc}.${course}.${y}.${pad(seq, 3)}`;
}

// ─── Generic 4-digit-seq generators ──────────────────────────────────────────

async function gen4(
  prefix: string,
  centerCode: string,
  client: DbClient,
): Promise<string> {
  const cc = sanitize(centerCode);
  const y = yy();
  const seq = await nextSeq(`${prefix}:${cc}:${y}`, client);
  return `${cc}.${prefix}.${y}.${pad(seq, 4)}`;
}

/** CS1.LD.26.0001 — lead. */
export const genLeadCode = (centerCode: string, client: DbClient = db) =>
  gen4("LD", centerCode, client);

/** CS1.INV.26.0001 — invoice. */
export const genInvoiceCode = (centerCode: string, client: DbClient = db) =>
  gen4("INV", centerCode, client);

/** CS1.PAY.26.0001 — payment. */
export const genPaymentCode = (centerCode: string, client: DbClient = db) =>
  gen4("PAY", centerCode, client);

/** CS1.ENR.26.0001 — enrollment. */
export const genEnrollmentCode = (centerCode: string, client: DbClient = db) =>
  gen4("ENR", centerCode, client);

/** CS1.TRF.26.0001 — transfer. */
export const genTransferCode = (centerCode: string, client: DbClient = db) =>
  gen4("TRF", centerCode, client);

/** CS1.REQ.26.0001 — parent request. */
export const genRequestCode = (centerCode: string, client: DbClient = db) =>
  gen4("REQ", centerCode, client);
