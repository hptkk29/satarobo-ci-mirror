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
 * Khớp LỎNG theo tên + ngày sinh (THUẦN) — dùng khi đã có SĐT phụ huynh làm khoá chính.
 *
 * Khác `studentMatches` ở đúng một chỗ: ngày sinh chỉ là MÂU THUẪN khi CẢ HAI bên có và khác
 * nhau. Một bên để trống thì không phản bác được gì — hồ sơ nhập tay thường chưa có ngày sinh
 * (đo 28/10/2026: cặp trùng thật chỉ khác nhau đúng ở chỗ này nên khớp chặt không bắt được).
 */
export function studentMatchesLoose(
  a: { name: string; dob: Date | null },
  b: { name: string; dob: Date | null },
): boolean {
  if (normalizeName(a.name) !== normalizeName(b.name)) return false;
  if (!a.dob || !b.dob) return true;
  return a.dob.toISOString().slice(0, 10) === b.dob.toISOString().slice(0, 10);
}

/**
 * Chọn học viên trùng trong danh sách ứng viên cùng SĐT phụ huynh (THUẦN).
 *
 * Chỉ trả khi ĐÚNG MỘT ứng viên khớp. Hai ứng viên trở lên thì không đoán — rơi về hành vi cũ
 * (tạo hồ sơ mới) tốt hơn là gộp nhầm ghi danh vào người sai.
 */
export function chonHocVienTrungTheoSdt(
  candidates: { id: string; name: string; dateOfBirth: Date | null }[],
  input: { name: string; dob: Date | null },
): string | null {
  const khop = candidates.filter((c) =>
    studentMatchesLoose(input, { name: c.name, dob: c.dateOfBirth }),
  );
  return khop.length === 1 ? khop[0]!.id : null;
}

/**
 * Tìm student trùng để DÙNG LẠI khi chốt lead (chỉ tạo Enrollment mới — AC4). null = không trùng.
 *
 * Hai lớp, theo thứ tự:
 *  1. CÙNG PARENT (§6): cùng tài khoản phụ huynh + tên chuẩn hoá + DOB — như cũ.
 *  2. CHƯA CÓ TÀI KHOẢN PHỤ HUYNH: cùng SĐT phụ huynh (mọi dạng `0…`/`84…`) + cùng cơ sở + tên
 *     (xem `chonHocVienTrungTheoSdt`).
 *
 * Lớp 2 tồn tại vì sự cố 06/09/2026: Sale tạo tay học viên (chưa có tài khoản phụ huynh), sáu
 * phút sau lead được chốt — lớp 1 chỉ tìm theo `parentUserId` nên không thấy hồ sơ nhập tay và
 * sinh hồ sơ thứ hai cho cùng một bé. `parentPhone` và `centerId` BẮT BUỘC khai (có thể `null`)
 * để `tsc` liệt kê mọi chỗ gọi: quên truyền là lỗ cũ mở lại, mà không test nào đỏ.
 */
export async function findExistingStudent(
  input: {
    parentUserId: string;
    name: string;
    dob: Date | null;
    parentPhone: string | null;
    centerId: string | null;
  },
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
  if (hit) return hit.id;

  const bienThe = input.parentPhone ? phoneVariants(input.parentPhone) : [];
  if (bienThe.length === 0) return null;
  const chuaCoTk = await client.student.findMany({
    where: {
      parentUserId: null,
      deletedAt: null,
      parentPhone: { in: bienThe },
      ...(input.centerId ? { centerId: input.centerId } : {}),
    },
    select: { id: true, name: true, dateOfBirth: true },
  });
  return chonHocVienTrungTheoSdt(chuaCoTk, { name: input.name, dob: input.dob });
}

/**
 * Thêm học viên BẰNG TAY: đã có hồ sơ cùng tên + cùng SĐT phụ huynh chưa? Trả mã hồ sơ đó.
 *
 * Quét TOÀN HỆ THỐNG (không giới hạn cơ sở, không đòi tài khoản phụ huynh): người tạo tay không
 * biết hồ sơ đã có ở đâu, và đó chính là lúc sinh ra bản sao.
 */
export async function timHocVienTrungKhiTaoTay(
  input: { name: string; parentPhone: string | null; dob: Date | null },
  client: DbClient = db,
): Promise<{ id: string; studentCode: string | null } | null> {
  const bienThe = input.parentPhone ? phoneVariants(input.parentPhone) : [];
  if (bienThe.length === 0) return null;
  const ungVien = await client.student.findMany({
    where: { deletedAt: null, parentPhone: { in: bienThe } },
    select: { id: true, name: true, dateOfBirth: true, studentCode: true },
  });
  const hit = ungVien.find((c) =>
    studentMatchesLoose(
      { name: input.name, dob: input.dob },
      { name: c.name, dob: c.dateOfBirth },
    ),
  );
  return hit ? { id: hit.id, studentCode: hit.studentCode } : null;
}
