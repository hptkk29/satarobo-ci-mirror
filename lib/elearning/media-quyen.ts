import "server-only";

import { db } from "@/lib/db";
import type { BaiHienHanh } from "@/lib/elearning/media-quyen-rule";

/**
 * Đọc trạng thái HIỆN HÀNH của bài + ghi danh của người cầm vé, bằng MỘT câu (một lượt đi-về mỗi lượt xin media — trình phát xin
 * Range hàng chục lần mỗi bài, nên không thể là hai câu nối đuôi).
 *
 * `NULL` khi bài không tồn tại, đã xoá, hoặc khoá chứa nó đã xoá. `coGhiDanh` = còn ít nhất một ghi danh KHÔNG bị thu hồi của
 * người này vào khoá chứa bài (cùng điều kiện với trang học: `status !== "REVOKED"`).
 */
export async function docQuyenMedia(
  userId: string,
  lessonId: string,
): Promise<{ bai: BaiHienHanh; coGhiDanh: boolean } | null> {
  const [r] = await db.$queryRaw<
    {
      mediaRevision: number;
      videoKey: string | null;
      videoKey360: string | null;
      captionKey: string | null;
      audioKey: string | null;
      coGhiDanh: boolean;
    }[]
  >`
    SELECT l."mediaRevision", l."videoKey", l."videoKey360", l."captionKey", l."audioKey",
      EXISTS (
        SELECT 1 FROM "TrnEnrollment" e
        WHERE e."userId" = ${userId} AND e."courseId" = m."courseId" AND e."status" <> 'REVOKED'
      ) AS "coGhiDanh"
    FROM "TrnLesson" l
    JOIN "TrnModule" m ON m."id" = l."moduleId"
    JOIN "TrnCourse" c ON c."id" = m."courseId" AND c."deletedAt" IS NULL
    WHERE l."id" = ${lessonId} AND l."deletedAt" IS NULL`;
  if (!r) return null;
  return {
    bai: {
      mediaRevision: r.mediaRevision,
      videoKey: r.videoKey,
      videoKey360: r.videoKey360,
      captionKey: r.captionKey,
      audioKey: r.audioKey,
    },
    coGhiDanh: r.coGhiDanh,
  };
}
