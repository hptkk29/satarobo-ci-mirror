// lib/hoc-bu/bien-lai-luot-db.ts — ĐỌC sổ lượt bù của MỘT (học viên, khoá) để trả lời "vì sao còn x/y lượt?" (T16, 08/10/2026).
//
// Chỉ đọc. Nơi gọi PHẢI đã kiểm học viên thuộc phạm vi của người hỏi (action đọc dòng cần bù qua `scopedDb` + lọc Sale trước, rồi mới hỏi sổ): sổ lượt là quyền lợi
// của học viên — không lộ sang người ngoài phạm vi. Đọc bằng `db` trần vì tài khoản/bút toán không có cột cơ sở để `scopedDb` lọc.
import "server-only";
import { db } from "@/lib/db";
import type { BieuGhiLuot } from "@/lib/hoc-bu/hien-thi-thuan";

/** Số bút toán tối đa trả về (mới nhất trước). Sổ dài hơn thì nói rõ là cắt — không cắt im lặng. */
const TOI_DA = 60;

export type BienLaiLuot =
  | { coSo: false }
  | { coSo: true; so: { granted: number; held: number; consumed: number }; bieuGhi: BieuGhiLuot[]; biCat: boolean };

export async function docBienLaiLuot(p: { studentId: string; courseId: string }): Promise<BienLaiLuot> {
  const tk = await db.makeupCreditAccount.findUnique({
    where: { studentId_courseId: { studentId: p.studentId, courseId: p.courseId } },
    select: { id: true, granted: true, held: true, consumed: true },
  });
  if (!tk) return { coSo: false };
  const ds = await db.makeupCreditEntry.findMany({
    where: { accountId: tk.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TOI_DA + 1,
    select: { type: true, grantedDelta: true, heldDelta: true, consumedDelta: true, reason: true, createdAt: true },
  });
  return {
    coSo: true,
    so: { granted: tk.granted, held: tk.held, consumed: tk.consumed },
    bieuGhi: ds.slice(0, TOI_DA),
    biCat: ds.length > TOI_DA,
  };
}
