import "server-only";
import { db } from "@/lib/db";
import { luotConHieuLuc } from "@/lib/bao-luu/dang-bao-luu";

// lib/bao-luu/roster-db.ts — phần chạm DB của "buổi này nằm trong khoảng bảo lưu của học viên không" (BR-09). PHIÊN 4.
//
// Dùng cho những nơi KHÔNG dựng danh sách lớp mà phải xét từng BUỔI đã có: đếm vắng, chuyên cần, nhu cầu học bù. Buổi nằm trong khoảng
// bảo lưu (kể cả khoảng LÙI NGÀY của BR-09) thì "không tính vắng, không trừ hạn mức bù".
//
// ⚠️ `db` TRẦN là đúng ở đây (cùng lý do `dang-bao-luu-db.ts`): đây là phép TRỪ khỏi số vắng của phụ huynh; một cổng bị lọc theo tầm nhìn
// của người xem sẽ coi khoảng bảo lưu ngoài tầm nhìn là không tồn tại và tính vắng nhầm cho đúng em đang được miễn.

export type KhoangBaoLuu = { startedAt: Date; endedAt: Date | null; isActive: boolean };

/**
 * Các khoảng bảo lưu ĐỜI MỚI của từng ghi danh (mọi hồ sơ đã duyệt, kể cả đã kết thúc — để hỏi về QUÁ KHỨ). Ghi danh không có hồ sơ
 * thì KHÔNG có khoá trong Map ⇒ người gọi có đường nhanh "không ai bảo lưu" mà không đổi hành vi cũ.
 */
export async function docKhoangBaoLuu(enrollmentIds: readonly string[]): Promise<Map<string, KhoangBaoLuu[]>> {
  const out = new Map<string, KhoangBaoLuu[]>();
  if (enrollmentIds.length === 0) return out;
  const rows = await db.studentReserve.findMany({
    where: { enrollmentId: { in: [...new Set(enrollmentIds)] }, approvedAt: { not: null } },
    select: { enrollmentId: true, startedAt: true, endedAt: true, isActive: true },
  });
  for (const r of rows) {
    if (!r.enrollmentId) continue;
    const a = out.get(r.enrollmentId) ?? [];
    a.push({ startedAt: r.startedAt, endedAt: r.endedAt, isActive: r.isActive });
    out.set(r.enrollmentId, a);
  }
  return out;
}

/** Ngày `ngay` có nằm trong một khoảng bảo lưu nào không. `khoang` `undefined` (ghi danh không hồ sơ) ⇒ `false`. */
export function ngayTrongKhoangBaoLuu(ngay: Date, khoang: readonly KhoangBaoLuu[] | undefined): boolean {
  return !!khoang && khoang.some((k) => luotConHieuLuc(k, ngay));
}

/** Học viên × lớp có nằm trong khoảng bảo lưu (theo quy chế) tại `ngay` không — một câu cho một buổi. */
export async function daBaoLuuTaiBuoi(p: { studentId: string; classId: string; ngay: Date }): Promise<boolean> {
  const hs = await db.studentReserve.findFirst({
    where: {
      studentId: p.studentId,
      enrollment: { classId: p.classId },
      approvedAt: { not: null },
      startedAt: { lte: p.ngay },
      OR: [{ isActive: true, endedAt: null }, { endedAt: { gt: p.ngay } }],
    },
    select: { id: true },
  });
  return hs !== null;
}

/**
 * Khoảng bảo lưu của MỘT học viên, gom theo LỚP (mỗi hồ sơ gắn một ghi danh ⇒ một lớp). Cho chỗ đã có buổi (`classId` + `date`) mà
 * chưa có `enrollmentId` — danh sách buổi vắng, v.v. Học viên không có hồ sơ đời mới ⇒ Map rỗng.
 */
export async function docKhoangBaoLuuTheoLop(studentId: string): Promise<Map<string, KhoangBaoLuu[]>> {
  const rows = await db.studentReserve.findMany({
    where: { studentId, approvedAt: { not: null }, enrollmentId: { not: null } },
    select: { startedAt: true, endedAt: true, isActive: true, enrollment: { select: { classId: true } } },
  });
  const out = new Map<string, KhoangBaoLuu[]>();
  for (const r of rows) {
    const classId = r.enrollment?.classId;
    if (!classId) continue;
    const a = out.get(classId) ?? [];
    a.push({ startedAt: r.startedAt, endedAt: r.endedAt, isActive: r.isActive });
    out.set(classId, a);
  }
  return out;
}
