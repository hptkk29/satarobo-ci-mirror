// lib/validators/portal-submission.ts — vá bảo mật: PH nộp bài tập qua portal.
//
// Trước đây submitAssignment (app/(portal)/portal/bai-tap/actions.ts) nhận input THÔ
// không zod — PH (tài khoản ít tin cậy nhất) có thể gọi thẳng server action với
// fileUrl="javascript:…" hoặc URL phishing → lưu nguyên vào AssignmentSubmissionFile
// → GV/admin mở màn chấm bấm link là dính (stored XSS/phishing nhắm người chấm).
//
// Khoá 2 lớp:
//   (1) Schema như attachmentSchema của GV (fileName ≤ 255, fileSize > 0 và ≤ trần
//       upload-config, textAnswer ≤ 10k ký tự).
//   (2) fileUrl BẮT BUỘC thuộc kho R2 của app: prefix `${R2_PUBLIC_URL}/uploads/`
//       (portal presign chỉ cấp key `uploads/submissions/…` — api/portal/upload-url).
//       ⚠️ z.string().url() KHÔNG đủ: `new URL("javascript:alert(1)")` là URL hợp lệ.
//       Prefix kết thúc bằng "/" nên chặn luôn trick host (`cdn.x.local@evil.com`,
//       `cdn.x.localx`).
//
// Builder nhận r2PublicUrl làm THAM SỐ (thuần, test không cần env). Thiếu env →
// fail-closed: mọi file bị từ chối (nộp text-only vẫn được).
import { z } from "zod";
import { UPLOAD_CONFIG } from "@/lib/storage/upload-config";
import { TRAN_DO_DAI_DAP_AN } from "@/lib/assignments/lam-bai";

export const PORTAL_SUBMISSION_MAX_TEXT = 10_000;
export const PORTAL_SUBMISSION_MAX_FILES = 10;
/** Trần size = max(image, document) — portal chỉ presign 2 loại này (upload-url). */
export const PORTAL_SUBMISSION_MAX_FILE_SIZE = Math.max(
  UPLOAD_CONFIG.image.maxSize,
  UPLOAD_CONFIG.document.maxSize,
);

/** Trần video nộp bài — khớp `PORTAL_VIDEO_MAX_BYTES` ở app/api/portal/upload-url/route.ts (12/11/2026). */
export const PORTAL_SUBMISSION_MAX_VIDEO_SIZE = 120 * 1024 * 1024;

/** Số câu trả lời tối đa mỗi lần nộp — khớp trần `take` khi đọc câu hỏi của bài (learning.ts / actions.ts). */
export const PORTAL_SUBMISSION_MAX_ANSWERS = 100;

const chuoiDapAn = z.string().max(TRAN_DO_DAI_DAP_AN, "Câu trả lời quá dài");
/**
 * Đáp án MỘT câu (hình dạng = `DapAn` ở lib/assignments/lam-bai.ts). Schema chỉ kiểm HÌNH DẠNG + trần kích thước; việc đáp án có hợp lệ với
 * LOẠI của câu đó (chỉ số trong khoảng, đúng số chỗ trống…) do `kiemDapAn` ở server kiểm sau khi đọc câu hỏi từ DB.
 */
export const dapAnSchema = z.discriminatedUnion("k", [
  z.object({ k: z.literal("single"), i: z.number().int() }),
  z.object({ k: z.literal("multiple"), i: z.array(z.number().int()).max(20) }),
  z.object({ k: z.literal("boolean"), v: z.boolean() }),
  z.object({ k: z.literal("fill"), t: z.array(chuoiDapAn).max(20) }),
  z.object({ k: z.literal("text"), t: chuoiDapAn }),
  z.object({ k: z.literal("matching"), r: z.array(chuoiDapAn).max(20) }),
  z.object({ k: z.literal("ordering"), o: z.array(chuoiDapAn).max(20) }),
]);

/** Chuẩn hoá R2_PUBLIC_URL như r2-client (tự thêm https:// nếu thiếu, bỏ / cuối). */
export function normalizeR2PublicUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return withScheme.replace(/\/+$/, "");
}

/** Schema nộp bài của PH — truyền process.env.R2_PUBLIC_URL ở call-site thật. */
export function buildPortalSubmissionSchema(r2PublicUrl: string | null | undefined) {
  const base = normalizeR2PublicUrl(r2PublicUrl);
  const uploadsPrefix = base ? `${base}/uploads/` : null;

  const fileSchema = z.object({
    fileUrl: z
      .string()
      .max(2000, "URL tệp quá dài")
      .url("URL tệp không hợp lệ")
      .refine(
        (u) => uploadsPrefix !== null && u.startsWith(uploadsPrefix),
        "Tệp phải được tải lên qua hệ thống",
      ),
    fileName: z.string().trim().min(1, "Thiếu tên tệp").max(255, "Tên tệp quá dài"),
    fileSize: z
      .number()
      .int("Kích thước tệp không hợp lệ")
      .positive("Kích thước tệp không hợp lệ")
      .max(PORTAL_SUBMISSION_MAX_VIDEO_SIZE, "Tệp vượt quá giới hạn cho phép")
      .nullable()
      .optional(),
    mimeType: z.string().max(100).nullable().optional(),
  }).refine(
    // Trần RIÊNG theo loại: chỉ VIDEO được lớn tới 120MB; ảnh/tài liệu giữ trần cũ (max(image, document)).
    (f) => f.fileSize == null || (f.mimeType ?? "").startsWith("video/") || f.fileSize <= PORTAL_SUBMISSION_MAX_FILE_SIZE,
    { message: "Tệp vượt quá giới hạn cho phép", path: ["fileSize"] },
  );

  return z.object({
    assignmentId: z.string().min(1, "Thiếu mã bài tập"),
    textAnswer: z
      .string()
      .max(PORTAL_SUBMISSION_MAX_TEXT, `Nội dung tối đa ${PORTAL_SUBMISSION_MAX_TEXT} ký tự`)
      .nullable()
      .optional(),
    files: z
      .array(fileSchema)
      .max(PORTAL_SUBMISSION_MAX_FILES, `Tối đa ${PORTAL_SUBMISSION_MAX_FILES} tệp`)
      .optional(),
    /** Câu trả lời TỪNG CÂU của bài nhiều câu hỏi (26/11/2026). Bài không có câu hỏi thì bỏ trống. */
    answers: z
      .array(z.object({ questionId: z.string().min(1).max(100), dapAn: dapAnSchema }))
      .max(PORTAL_SUBMISSION_MAX_ANSWERS, "Quá nhiều câu trả lời")
      .optional(),
  });
}

export type PortalSubmissionInput = z.infer<ReturnType<typeof buildPortalSubmissionSchema>>;
