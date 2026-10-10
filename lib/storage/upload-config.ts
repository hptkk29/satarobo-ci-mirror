export type UploadCategory = "image" | "document" | "video" | "audio" | "archive";

export interface CategoryConfig {
  folder: string;
  maxSize: number;
  allowedMimes: string[];
  allowedExtensions: string[];
  description: string;
}

export const UPLOAD_CONFIG: Record<UploadCategory, CategoryConfig> = {
  image: {
    folder: "uploads/images",
    maxSize: 10 * 1024 * 1024,
    // SVG cố tình KHÔNG cho phép: file lưu R2 public + serve inline theo Content-Type,
    // một SVG chứa <script> sẽ chạy JS trên origin CDN (stored XSS). Xem SEC-H03.
    allowedMimes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".webp", ".gif"],
    description: "Ảnh (JPG/PNG/WEBP/GIF, tối đa 10MB)",
  },
  document: {
    folder: "uploads/documents",
    maxSize: 20 * 1024 * 1024,
    allowedMimes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "text/csv",
    ],
    allowedExtensions: [
      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      ".txt",
      ".csv",
    ],
    description: "Tài liệu (PDF/Word/Excel/PowerPoint/TXT/CSV, tối đa 20MB)",
  },
  video: {
    folder: "uploads/videos",
    maxSize: 500 * 1024 * 1024,
    allowedMimes: [
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-msvideo",
    ],
    allowedExtensions: [".mp4", ".webm", ".mov", ".avi"],
    description: "Video (MP4/WEBM/MOV/AVI, tối đa 500MB)",
  },
  audio: {
    folder: "uploads/audio",
    maxSize: 50 * 1024 * 1024,
    allowedMimes: [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/ogg",
      "audio/webm",
      "audio/m4a",
      "audio/x-m4a",
    ],
    allowedExtensions: [".mp3", ".wav", ".ogg", ".m4a", ".webm"],
    description: "Audio (MP3/WAV/OGG/M4A, tối đa 50MB)",
  },
  archive: {
    folder: "uploads/archives",
    maxSize: 1024 * 1024 * 1024,
    allowedMimes: [
      "application/zip",
      "application/x-zip-compressed",
      "application/x-rar-compressed",
      "application/x-7z-compressed",
    ],
    allowedExtensions: [".zip", ".rar", ".7z"],
    description: "Archive (ZIP/RAR/7Z, tối đa 1GB — dùng cho SCORM packages)",
  },
};

export function detectCategory(mime: string): UploadCategory | null {
  for (const [cat, config] of Object.entries(UPLOAD_CONFIG) as [
    UploadCategory,
    CategoryConfig,
  ][]) {
    if (config.allowedMimes.includes(mime)) return cat;
  }
  return null;
}

export function validateFile(
  category: UploadCategory,
  filename: string,
  mime: string,
  sizeBytes: number,
): string | null {
  const config = UPLOAD_CONFIG[category];
  if (!config) return `Category không hợp lệ: ${category}`;

  if (sizeBytes > config.maxSize) {
    const mb = (config.maxSize / 1024 / 1024).toFixed(0);
    return `File quá lớn. Giới hạn: ${mb}MB`;
  }

  if (!config.allowedMimes.includes(mime)) {
    return `MIME type không hợp lệ: ${mime}. ${config.description}`;
  }

  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext || !config.allowedExtensions.includes(ext)) {
    return `Đuôi file không hợp lệ: ${ext}. ${config.description}`;
  }

  return null;
}
