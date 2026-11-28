import type { Prisma, PrismaClient } from "@prisma/client";
import { docCaiDatHocTap } from "./cai-dat-hoc-tap";
import { tinhTienDoKhoa, type BaiTrongBan, type TienDoBai, type TienDoKhoa } from "./tien-do";

/**
 * E-LEARNING ONLINE — ĐỌC TIẾN ĐỘ KHOÁ (tách khỏi `hoc-tap.ts` ngày 25/11/2026, KHÔNG đổi hành vi).
 *
 * Lý do tách: `quyen-hoc-db.ts` cần `docTienDoKhoaTheoQuyen` (kiểm tiên quyết C13) trong khi `hoc-tap.ts` đã import `kiemTraTruyCapNoiDungDb` từ `quyen-hoc-db.ts` ⇒ vòng
 * hoc-tap → quyen-hoc-db → hoc-tap (dependency-cruiser `no-circular` đỏ). Cả hai nay cùng import module THỨ BA này; `hoc-tap.ts` re-export để các nơi gọi cũ không đổi.
 * Module này KHÔNG import `hoc-tap` hay `quyen-hoc-db` — giữ như vậy.
 */

/** Máy khách DB dùng được cả trong giao dịch (`$transaction`) — cho các hàm ĐỌC tiến độ gọi từ trong giao dịch chấm điểm. */
export type Cli = PrismaClient | Prisma.TransactionClient;

export async function docBanChayChoTienDo(db: Cli, courseId: string) {
  const khoa = await db.onlCourse.findUniqueOrThrow({ where: { id: courseId }, select: { publishedVersionId: true } });
  const ban = await db.onlCourseVersion.findUniqueOrThrow({
    where: { id: khoa.publishedVersionId! },
    select: {
      number: true,
      settingsJson: true,
      chapters: { select: { id: true, stableId: true, orderIndex: true, hidden: true, title: true } },
      lessons: { select: { stableId: true, chapterId: true, kind: true, required: true, hidden: true, orderIndex: true, title: true, durationSec: true } },
    },
  });
  const cd = docCaiDatHocTap(ban.settingsJson);
  if (!cd.ok) throw new Error("Cài đặt học tập của bản đang chạy không hợp lệ");
  const chuong = new Map(ban.chapters.map((c) => [c.id, c]));
  const cay: (BaiTrongBan & { title: string; durationSec: number | null; chapterTitle: string })[] = [...ban.lessons]
    .sort((a, b) => (chuong.get(a.chapterId)?.orderIndex ?? 0) - (chuong.get(b.chapterId)?.orderIndex ?? 0) || a.orderIndex - b.orderIndex)
    .map((b, i) => ({
      stableId: b.stableId,
      chapterStableId: chuong.get(b.chapterId)?.stableId ?? "",
      kind: b.kind,
      required: b.required,
      hidden: b.hidden || !!chuong.get(b.chapterId)?.hidden,
      thuTu: i,
      thuTuChuong: chuong.get(b.chapterId)?.orderIndex ?? 0,
      title: b.title,
      durationSec: b.durationSec,
      chapterTitle: chuong.get(b.chapterId)?.title ?? "",
    }));
  return { cay, caiDat: cd.caiDat, soBan: ban.number };
}

export async function docTienDoKhoaTheoQuyen(db: Cli, entitlementId: string, courseId: string): Promise<TienDoKhoa> {
  const [{ cay, caiDat }, dong] = await Promise.all([docBanChayChoTienDo(db, courseId), db.onlLessonProgress.findMany({ where: { entitlementId }, select: { lessonStableId: true, status: true } })]);
  const td: TienDoBai = Object.fromEntries(dong.map((d) => [d.lessonStableId, d.status]));
  return tinhTienDoKhoa(cay, td, caiDat);
}
