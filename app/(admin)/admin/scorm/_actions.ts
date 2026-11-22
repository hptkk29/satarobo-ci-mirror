"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { writeAudit } from "@/lib/audit/audit-log";
import { publishEvent } from "@/lib/events/publish";
import { getR2Client, getR2Bucket, deleteR2Prefix } from "@/lib/storage/r2-client";
import { onScormUploaded } from "@/lib/events/handlers/scorm-ingest";
import { publishAndSwapLessonMaterial } from "@/lib/scorm/publish";
import { isScormEnabled } from "@/lib/flags";

// =============================================================================
// Pipeline SCORM/giáo án (admin/Đào tạo) — 1 giáo án/buổi, đẩy mới = thay cũ.
//   createScormPackage  → tạo row UPLOADING + presign PUT zip lên R2.
//   confirmUpload       → PROCESSING + emit scorm.uploaded (job giải nén consume).
//   processScormNow     → chạy giải nén NGAY (best-effort) để giáo án hiện liền,
//                         không phải chờ cron; cron vẫn là fallback (handler idempotent).
//                         Khi xong: tự PHÁT HÀNH + ĐẶT ĐANG DÙNG + XOÁ giáo án cũ của buổi.
//   deleteScormPackage  → gỡ hẳn 1 giáo án (DB cascade attempts/log + xoá asset R2).
// Mọi action: auth + can(training:manage) + isScormEnabled (gate kép).
// =============================================================================

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const PRESIGN_TTL_SEC = 3600; // 1h — zip SCORM có thể lớn, cho thời gian upload rộng.

async function gate(): Promise<
  | { ok: true; userId: string; name: string; sdb: ReturnType<typeof scopedDb> }
  | { ok: false; error: string }
> {
  if (!isScormEnabled()) return { ok: false, error: "Tính năng SCORM đang tắt" };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("training:manage"))) return { ok: false, error: "Không có quyền" };
  // ScormPackage/Lesson không center-scoped → scopedDb pass-through (đúng rule R6-F1,
  // không import @/lib/db trần). Quyền đã chặn ở training:manage.
  const sdb = scopedDb(await resolveActor(session.user.id));
  return {
    ok: true,
    userId: session.user.id,
    name: session.user.name ?? session.user.email ?? "—",
    sdb,
  };
}

/**
 * T5.1 — `name` KHÔNG còn nhập tay (đã bỏ ô "tên gói"/"tên giáo án" ở cả 2 form).
 * Optional ở đây để tương thích ngược; server tự sinh qua buildPackageName khi trống.
 * Cột ScormPackage.name vẫn NOT NULL → luôn phải có giá trị.
 */
const createInputSchema = z.object({
  lessonId: z.string().min(1, "Thiếu buổi học"),
  name: z.string().trim().max(200).optional(),
  fileName: z.string().trim().min(1, "Thiếu tên tệp"),
  mimeType: z.string().trim().min(1, "Thiếu kiểu tệp"),
  sizeBytes: z.number().int().positive("Kích thước tệp không hợp lệ"),
  // Loại giáo án: SCORM (.zip) hoặc PDF (.pdf). Mặc định SCORM (tương thích ngược).
  kind: z.enum(["SCORM", "PDF"]).default("SCORM"),
});

/**
 * T5.1 (THUẦN) — tên gói tự sinh: ưu tiên "Buổi {order} — {title}", lùi về tên tệp
 * (bỏ đuôi), cuối cùng "Giáo án". Cắt 200 ký tự cho khớp cột. Không bao giờ trả rỗng.
 * KHÔNG export: file "use server" chỉ được export hàm async.
 */
function buildPackageName(input: {
  lessonOrder?: number | null;
  lessonTitle?: string | null;
  fileName: string;
}): string {
  const title = input.lessonTitle?.trim();
  const fromLesson =
    input.lessonOrder != null && title
      ? `Buổi ${input.lessonOrder} — ${title}`
      : title || null;
  const fromFile = input.fileName.replace(/\.[^.]+$/, "").trim();
  return (fromLesson || fromFile || "Giáo án").slice(0, 200);
}

/**
 * Tạo bản ghi ScormPackage trạng thái UPLOADING + presign PUT để browser upload
 * trực tiếp file lên R2. kind=SCORM → source.zip (giải nén sau); kind=PDF → source.pdf
 * (phát hành thẳng ở confirmUpload). Version tăng dần theo buổi (bản mới không động bản cũ).
 */
export async function createScormPackage(
  input: unknown,
): Promise<Result<{ id: string; uploadUrl: string; uploadKey: string; expiresIn: number }>> {
  const g = await gate();
  if (!g.ok) return g;

  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { lessonId, fileName, mimeType, sizeBytes, kind } = parsed.data;

  // Khớp loại file với kind (chặn nhầm .zip vào PDF & ngược lại).
  const lower = fileName.toLowerCase();
  if (kind === "PDF" && !(lower.endsWith(".pdf") || mimeType.includes("pdf"))) {
    return { ok: false, error: "Giáo án PDF cần tệp .pdf" };
  }
  if (kind === "SCORM" && !(lower.endsWith(".zip") || mimeType.includes("zip"))) {
    return { ok: false, error: "Gói SCORM cần tệp .zip" };
  }

  const lesson = await g.sdb.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, order: true, title: true },
  });
  if (!lesson) return { ok: false, error: "Không tìm thấy buổi học" };

  // T5.1 — tên gói do server đặt (form không còn ô nhập). Client cũ vẫn gửi `name`
  // thì tôn trọng, để không vỡ tương thích ngược.
  const name =
    parsed.data.name?.trim() ||
    buildPackageName({ lessonOrder: lesson.order, lessonTitle: lesson.title, fileName });

  const last = await g.sdb.scormPackage.findFirst({
    where: { lessonId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;

  // storagePrefix/uploadKey phụ thuộc id → tạo row rồi cập nhật.
  const created = await g.sdb.scormPackage.create({
    data: {
      lessonId,
      name,
      kind,
      version,
      sizeBytes,
      status: "UPLOADING",
      storagePrefix: "pending",
      uploadedById: g.userId,
    },
    select: { id: true },
  });
  const storagePrefix = `scorm/${created.id}/`;
  const uploadKey = `${storagePrefix}${kind === "PDF" ? "source.pdf" : "source.zip"}`;
  await g.sdb.scormPackage.update({
    where: { id: created.id },
    data: { storagePrefix, uploadKey },
  });

  let uploadUrl: string;
  try {
    const command = new PutObjectCommand({
      Bucket: getR2Bucket(),
      Key: uploadKey,
      ContentType: mimeType,
    });
    uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: PRESIGN_TTL_SEC });
  } catch {
    // Dọn row mồ côi nếu không ký được URL.
    await g.sdb.scormPackage.delete({ where: { id: created.id } }).catch(() => {});
    return { ok: false, error: "Không tạo được liên kết upload" };
  }

  await writeAudit({
    actor: { id: g.userId, name: g.name },
    module: "scorm",
    entityType: "ScormPackage",
    entityId: created.id,
    action: "CREATE",
    newValues: { name, lessonId, version, sizeBytes, kind },
  });
  revalidatePath("/admin/scorm");
  return { ok: true, data: { id: created.id, uploadUrl, uploadKey, expiresIn: PRESIGN_TTL_SEC } };
}

/**
 * Xác nhận browser đã PUT xong file.
 *   • PDF → phát hành THẲNG (không giải nén): set launchUrl="source.pdf" + publish + thay
 *     bản cũ. Giáo án hiện ngay, không chờ cron.
 *   • SCORM → PROCESSING + phát scorm.uploaded để job giải nén xử lý (idempotent dedupeKey).
 */
export async function confirmUpload(packageId: string): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  if (!packageId) return { ok: false, error: "Thiếu mã gói" };

  const pkg = await g.sdb.scormPackage.findUnique({
    where: { id: packageId },
    select: { id: true, kind: true, lessonId: true, status: true, uploadKey: true, storagePrefix: true },
  });
  if (!pkg) return { ok: false, error: "Không tìm thấy gói" };
  if (pkg.status !== "UPLOADING" && pkg.status !== "FAILED") {
    return { ok: false, error: "Gói không ở trạng thái chờ upload" };
  }
  if (!pkg.uploadKey) return { ok: false, error: "Gói chưa có tệp upload" };

  if (pkg.kind === "PDF") {
    // PDF không có bước giải nén để bắt lỗi như SCORM → PHẢI xác nhận file thật sự đã
    // lên R2 trước khi phát hành. publishAndSwap sẽ XOÁ giáo án cũ; nếu PUT lỗi/thiếu
    // mà vẫn publish → mất bản cũ + giáo án mới 404. Thiếu/rỗng → FAILED, giữ bản cũ.
    try {
      const head = await getR2Client().send(
        new HeadObjectCommand({ Bucket: getR2Bucket(), Key: pkg.uploadKey }),
      );
      if (!head.ContentLength || head.ContentLength <= 0) throw new Error("empty");
    } catch {
      await g.sdb.scormPackage.update({
        where: { id: packageId },
        data: { status: "FAILED", error: "Tệp PDF chưa upload xong" },
      });
      revalidatePath("/admin/scorm");
      return { ok: false, error: "Tệp PDF chưa upload xong — thử đẩy lại" };
    }
    // PDF: launch chính là file PDF; phát hành + thay bản cũ ngay.
    await publishAndSwapLessonMaterial(packageId, pkg.lessonId, {
      launchUrl: "source.pdf",
      scormVersion: null,
    });
    revalidatePath("/admin/scorm");
    return { ok: true };
  }

  await g.sdb.scormPackage.update({
    where: { id: packageId },
    data: { status: "PROCESSING", error: null },
  });
  await publishEvent(
    "scorm.uploaded",
    { packageId, uploadKey: pkg.uploadKey, storagePrefix: pkg.storagePrefix },
    { dedupeKey: `scorm.uploaded:${packageId}` },
  );
  revalidatePath("/admin/scorm");
  return { ok: true };
}

/**
 * Chạy giải nén NGAY cho 1 gói (gọi ngay sau confirmUpload) để giáo án hiện liền,
 * khỏi chờ cron. Handler idempotent + resume-safe → cron vẫn là fallback nếu request
 * hết giờ. Khi xong, handler tự PHÁT HÀNH + ĐẶT ĐANG DÙNG + XOÁ giáo án cũ của buổi.
 * Trả ok kể cả khi giải nén lỗi/treo — UI đọc trạng thái gói thực tế qua refresh/poll.
 */
export async function processScormNow(packageId: string): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  if (!packageId) return { ok: false, error: "Thiếu mã gói" };

  const pkg = await g.sdb.scormPackage.findUnique({
    where: { id: packageId },
    select: { id: true, kind: true },
  });
  if (!pkg) return { ok: false, error: "Không tìm thấy gói" };
  // PDF đã phát hành ở confirmUpload — không có gì để giải nén.
  if (pkg.kind !== "SCORM") return { ok: true };

  try {
    await onScormUploaded({
      id: `inline:${packageId}`,
      type: "scorm.uploaded",
      payload: { packageId },
    });
  } catch {
    // Lỗi hạ tầng (R2/timeout) — bỏ qua: event vẫn PENDING, cron sẽ giải nén lại.
  }
  revalidatePath("/admin/scorm");
  return { ok: true };
}

/**
 * Gỡ hẳn 1 giáo án khỏi buổi: xoá row (DB cascade ScormAttempt/AccessLog) + xoá asset
 * R2. Dùng cho: dọn bản FAILED, hoặc bỏ giáo án mà không thay bản mới. Không cần reason
 * (mỗi buổi chỉ 1 giáo án — không có khái niệm "bản đang dùng" để truy vết đổi bản).
 */
export async function deleteScormPackage(packageId: string): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  if (!packageId) return { ok: false, error: "Thiếu mã gói" };

  const pkg = await g.sdb.scormPackage.findUnique({
    where: { id: packageId },
    select: { id: true, name: true, lessonId: true, storagePrefix: true, status: true },
  });
  if (!pkg) return { ok: false, error: "Không tìm thấy gói" };

  await g.sdb.scormPackage.delete({ where: { id: packageId } });
  try {
    await deleteR2Prefix(pkg.storagePrefix);
  } catch {
    // R2 lỗi → chỉ để lại rác, không chặn xoá DB.
  }
  await writeAudit({
    actor: { id: g.userId, name: g.name },
    module: "scorm",
    entityType: "ScormPackage",
    entityId: packageId,
    action: "DELETE",
    oldValues: { name: pkg.name, lessonId: pkg.lessonId, status: pkg.status },
  });
  revalidatePath("/admin/scorm");
  return { ok: true };
}
