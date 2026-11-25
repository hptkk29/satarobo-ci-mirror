// lib/scorm/ingest.ts — R7-11: guard/validate THUẦN cho gói SCORM (KHÔNG gọi R2).
// Dùng cho job giải nén: chặn entry nguy hiểm, giới hạn size/số lượng, chuẩn hoá
// thư mục gốc đơn, ghép launch path. Mọi hàm pure → test bằng Vitest fixtures.

/** 1 entry trong zip (đường dẫn nội bộ + kích thước byte). */
export type ZipEntry = { path: string; size: number };

export type ValidateOptions = {
  /** Tổng byte tối đa (mặc định 200MB). */
  maxBytes?: number;
  /** Số entry tối đa (mặc định 2000). */
  maxEntries?: number;
  /** Ghi đè whitelist phần mở rộng (lowercase, không có dấu chấm). */
  allowedExtensions?: ReadonlySet<string>;
};

export type ValidateResult = {
  ok: boolean;
  error?: string;
  totalBytes: number;
  count: number;
};

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024; // 200MB
const DEFAULT_MAX_ENTRIES = 2000;

/** Phần mở rộng cho phép trong gói SCORM (nội dung web tĩnh + media + font). */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  "html",
  "htm",
  "js",
  "css",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "mp3",
  "mp4",
  "webm",
  "ogg",
  "xml",
  "json",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  // Tệp đóng gói SCORM hợp lệ (schema/icon/cursor/text) — tĩnh, vô hại.
  "xsd",
  "dtd",
  "ico",
  "cur",
  "txt",
  "vtt",
]);

/** Entry thư mục (kết thúc bằng "/") — bỏ qua kiểm tra extension. */
function isDirEntry(path: string): boolean {
  return path.endsWith("/");
}

/** Path traversal / absolute / Windows drive → KHÔNG an toàn. */
function isUnsafePath(path: string): boolean {
  if (!path) return true;
  // Chuẩn hoá backslash → "/" để bắt cả "..\\.." kiểu Windows.
  const norm = path.replace(/\\/g, "/");
  if (norm.startsWith("/")) return true; // absolute POSIX
  if (/^[a-zA-Z]:/.test(norm)) return true; // ổ đĩa Windows "C:..."
  // Bất kỳ segment nào là ".." → traversal.
  if (norm.split("/").some((seg) => seg === "..")) return true;
  return false;
}

function extensionOf(path: string): string | null {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null; // không có ext hoặc dotfile
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Kiểm tra danh sách entry trước khi giải nén lên R2.
 * Thứ tự lỗi: số lượng → path traversal → extension → size.
 */
export function validateZipEntries(
  entries: ZipEntry[],
  opts?: ValidateOptions,
): ValidateResult {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const allowed = opts?.allowedExtensions ?? ALLOWED_EXTENSIONS;

  const count = entries.length;
  let totalBytes = 0;
  for (const e of entries) totalBytes += e.size > 0 ? e.size : 0;

  if (count > maxEntries) {
    return {
      ok: false,
      error: `Gói vượt giới hạn số tệp: ${count} > ${maxEntries}`,
      totalBytes,
      count,
    };
  }

  for (const e of entries) {
    if (isUnsafePath(e.path)) {
      return {
        ok: false,
        error: `Đường dẫn không an toàn (path traversal/absolute): "${e.path}"`,
        totalBytes,
        count,
      };
    }
  }

  for (const e of entries) {
    if (isDirEntry(e.path)) continue;
    const ext = extensionOf(e.path);
    if (!ext || !allowed.has(ext)) {
      return {
        ok: false,
        error: `Định dạng tệp không cho phép: "${e.path}"`,
        totalBytes,
        count,
      };
    }
  }

  if (totalBytes > maxBytes) {
    return {
      ok: false,
      error: `Gói vượt giới hạn dung lượng: ${totalBytes} > ${maxBytes} byte`,
      totalBytes,
      count,
    };
  }

  return { ok: true, totalBytes, count };
}

/**
 * Phát hiện thư mục gốc đơn (vd zip lồng "package/…") → trả prefix để strip
 * (vd "package/"). Nhiều gốc / có tệp ở gốc → "".
 */
export function normalizeRootPrefix(paths: string[]): string {
  const cleaned = paths
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => p.length > 0);
  if (cleaned.length === 0) return "";

  let root: string | null = null;
  for (const p of cleaned) {
    const slash = p.indexOf("/");
    // Tệp/thư mục nằm thẳng ở gốc (không có "/" ngoài cùng) → không phải gốc đơn.
    if (slash <= 0) return "";
    const seg = p.slice(0, slash);
    if (root === null) root = seg;
    else if (root !== seg) return "";
  }
  return root ? `${root}/` : "";
}

/**
 * Ghép launchUrl (tương đối so với manifest) sau khi đã strip thư mục gốc.
 * Bỏ "./" và "/" đầu; nếu launchUrl còn dính rootPrefix thì cắt đi.
 */
export function resolveLaunchPath(
  launchUrl: string,
  rootPrefix: string,
): string {
  let u = launchUrl.replace(/\\/g, "/").trim();
  u = u.replace(/^\.\//, ""); // "./index.html" → "index.html"
  u = u.replace(/^\/+/, ""); // bỏ "/" đầu
  if (rootPrefix && u.startsWith(rootPrefix)) {
    u = u.slice(rootPrefix.length);
  }
  return u;
}
