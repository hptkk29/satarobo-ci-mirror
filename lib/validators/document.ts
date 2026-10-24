import { z } from "zod";

export const DocumentTypeEnum = z.enum([
  "PDF",
  "IMAGE",
  "VIDEO",
  "SLIDE",
  "WORKSHEET",
  "AUDIO",
  "OTHER",
]);

const nullableStr = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    return s.length > 0 ? s : null;
  });

const tagsClean = z
  .array(z.string())
  .default([])
  .transform((arr) =>
    Array.from(
      new Set(
        arr
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    ),
  );

export const documentSchema = z.object({
  documentCode: nullableStr,
  title: z.string().trim().min(1, "Tiêu đề bắt buộc").max(200),
  description: nullableStr,
  fileUrl: z.string().trim().min(1, "Chưa có file (cần upload trước)"),
  fileName: z.string().trim().min(1, "Thiếu tên file"),
  fileSize: z.coerce.number().int().min(1, "File size phải > 0"),
  mimeType: nullableStr,
  lessonId: nullableStr,
  isPublic: z.coerce.boolean().default(false),
  tags: tagsClean,
  notes: nullableStr,
});

export type DocumentInput = z.infer<typeof documentSchema>;

// Auto-detect DocumentType from MIME type.
export function detectDocumentType(
  mime: string | null,
): z.infer<typeof DocumentTypeEnum> {
  if (!mime) return "OTHER";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "SLIDE";
  if (
    mime.includes("word") ||
    mime.includes("excel") ||
    mime.includes("sheet") ||
    mime === "text/plain" ||
    mime === "text/csv"
  ) {
    return "WORKSHEET";
  }
  return "OTHER";
}
