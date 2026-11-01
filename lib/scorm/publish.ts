// lib/scorm/publish.ts — phát hành 1 giáo án/buổi + thay (xoá) bản cũ ("safe swap").
// Dùng chung cho SCORM (sau khi giải nén xong) và PDF (ngay sau khi upload).
import { db } from "@/lib/db";
import { deleteR2Prefix } from "@/lib/storage/r2-client";

export type PublishData = {
  /** Đường dẫn launch tương đối trong prefix: SCORM "res/index.html", PDF "source.pdf". */
  launchUrl: string;
  scormVersion?: "SCORM_12" | "SCORM_2004" | null;
  sizeBytes?: number | null;
  fileCount?: number | null;
};

/**
 * Đặt gói `packageId` thành giáo án ĐANG DÙNG của buổi: PUBLISHED + isActiveForLesson,
 * đồng thời XOÁ các bản cũ KHÔNG còn đang xử lý (DB cascade ScormAttempt/AccessLog) +
 * asset R2 của chúng. "Safe swap": chỉ dọn bản cũ SAU khi bản mới đã sẵn sàng; chỉ xoá
 * bản notIn UPLOADING/PROCESSING → bảo vệ bản đang đẩy dở (2 người cùng đẩy 1 buổi).
 * partial-unique (1 active/buổi) an toàn: bản cũ bị xoá TRƯỚC khi bật active (cùng tx).
 */
export async function publishAndSwapLessonMaterial(
  packageId: string,
  lessonId: string,
  data: PublishData,
): Promise<void> {
  const olds = await db.scormPackage.findMany({
    where: {
      lessonId,
      NOT: { id: packageId },
      status: { notIn: ["UPLOADING", "PROCESSING"] },
    },
    select: { id: true, storagePrefix: true },
  });

  await db.$transaction(async (tx) => {
    if (olds.length > 0) {
      await tx.scormPackage.deleteMany({ where: { id: { in: olds.map((o) => o.id) } } });
    }
    await tx.scormPackage.update({
      where: { id: packageId },
      data: {
        status: "PUBLISHED",
        isActiveForLesson: true,
        error: null,
        launchUrl: data.launchUrl,
        ...(data.scormVersion !== undefined ? { scormVersion: data.scormVersion } : {}),
        ...(data.sizeBytes !== undefined ? { sizeBytes: data.sizeBytes } : {}),
        ...(data.fileCount !== undefined ? { fileCount: data.fileCount } : {}),
      },
    });
  });

  // Dọn asset R2 của bản cũ (best-effort — lỗi chỉ để lại rác, KHÔNG chặn phát hành).
  for (const o of olds) {
    try {
      await deleteR2Prefix(o.storagePrefix);
    } catch {
      /* orphan storage */
    }
  }
}
