import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getR2Client } from "@/lib/storage/r2-client";
import { getSigningSecret } from "@/lib/security/signing-key";

/**
 * KHO TỆP RIÊNG cho API di động (bài nộp, câu nộp sản phẩm). Ba bảo đảm:
 *  1. RIÊNG: bucket `R2_MOBILE_UPLOAD_BUCKET_NAME` KHÔNG BAO GIỜ trùng `R2_BUCKET_NAME` (bucket công khai qua CDN) — thiếu/trùng ⇒ ném `KhoRiengChuaCauHinh` ⇒ 503.
 *     KHÔNG fallback sang bucket công khai, KHÔNG URL công khai: tải xuống chỉ qua URL KÝ ngắn hạn.
 *  2. KHÔNG tin lời khai: máy chủ HEAD đối tượng (cỡ + loại thật) và đọc vài byte đầu để nhận dạng định dạng TRƯỚC khi cho gắn vào bài (`kiemNoiDung`).
 *  3. Cô lập khi thử: bộ điều hợp LOCAL (thư mục đĩa, chỉ khi `MOBILE_UPLOAD_LOCAL_DIR` đặt VÀ không phải production) cho bộ test/HTTP cục bộ, không đụng R2.
 * Chưa có hạ tầng quét mã độc ⇒ ghi blocker B-UPLOAD-SCAN (không giả vờ có).
 */
export class KhoRiengChuaCauHinh extends Error {
  constructor(m: string) {
    super(m);
    this.name = "KhoRiengChuaCauHinh";
  }
}

export type DauTep = { size: number; contentType: string | null };
export interface KhoTepRieng {
  readonly ten: string;
  kyPut(key: string, contentType: string, ttlGiay: number): Promise<{ url: string; headers: Record<string, string> }>;
  dau(key: string): Promise<DauTep | null>;
  docByteDau(key: string, n: number): Promise<Uint8Array | null>;
  kyGet(key: string, ttlGiay: number, tenTep?: string): Promise<string | null>;
  xoa(key: string): Promise<void>;
}

// ── R2 ──
export function bucketRieng(): string {
  const b = (process.env.R2_MOBILE_UPLOAD_BUCKET_NAME ?? "").trim();
  if (!b) throw new KhoRiengChuaCauHinh("R2_MOBILE_UPLOAD_BUCKET_NAME chưa đặt — tệp nộp bài cần bucket R2 RIÊNG (không gắn custom domain).");
  const congKhai = (process.env.R2_BUCKET_NAME ?? "").trim();
  if (congKhai && b === congKhai) throw new KhoRiengChuaCauHinh("R2_MOBILE_UPLOAD_BUCKET_NAME đang trùng bucket công khai (R2_BUCKET_NAME) — tệp sẽ tải được vô danh qua CDN.");
  return b;
}

const kyGetR2 = async (key: string, ttl: number, ten?: string) =>
  getSignedUrl(getR2Client(), new GetObjectCommand({ Bucket: bucketRieng(), Key: key, ...(ten ? { ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(ten)}` } : {}) }), { expiresIn: ttl });

export const khoR2: KhoTepRieng = {
  ten: "r2-rieng",
  async kyPut(key, contentType, ttl) {
    const url = await getSignedUrl(getR2Client(), new PutObjectCommand({ Bucket: bucketRieng(), Key: key, ContentType: contentType }), { expiresIn: ttl });
    return { url, headers: { "Content-Type": contentType } };
  },
  async dau(key) {
    try {
      const r = await getR2Client().send(new HeadObjectCommand({ Bucket: bucketRieng(), Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType ?? null };
    } catch (e) {
      const ma = (e as { name?: string; $metadata?: { httpStatusCode?: number } }) ?? {};
      if (ma.name === "NotFound" || ma.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  },
  async docByteDau(key, n) {
    try {
      const r = await getR2Client().send(new GetObjectCommand({ Bucket: bucketRieng(), Key: key, Range: `bytes=0-${n - 1}` }));
      return (await r.Body?.transformToByteArray()) ?? null;
    } catch {
      return null;
    }
  },
  kyGet: (key, ttl, ten) => kyGetR2(key, ttl, ten).catch(() => null),
  async xoa(key) {
    await getR2Client().send(new DeleteObjectCommand({ Bucket: bucketRieng(), Key: key }));
  },
};

// ── LOCAL (chỉ thử nghiệm) ──
const thuMucLocal = (): string | null => (process.env.NODE_ENV !== "production" && process.env.MOBILE_UPLOAD_LOCAL_DIR?.trim()) || null;
const duongDan = (dir: string, key: string): string => {
  const p = path.resolve(dir, ...key.split("/"));
  if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error("khoá ra ngoài thư mục kho");
  return p;
};
/** Chữ ký của URL local: khớp (hành động, khoá, hết hạn, loại) — dùng ở tuyến dev-kho. */
export const kyUrlLocal = (act: "put" | "get", key: string, hetHan: number, loai: string): string => createHmac("sha256", getSigningSecret()).update(`kho-local|${act}|${key}|${hetHan}|${loai}`).digest("hex");
export function kiemUrlLocal(act: "put" | "get", key: string, hetHan: number, loai: string, chuKy: string): boolean {
  if (!Number.isFinite(hetHan) || hetHan < Date.now()) return false;
  const a = Buffer.from(kyUrlLocal(act, key, hetHan, loai));
  const b = Buffer.from(chuKy);
  return a.length === b.length && timingSafeEqual(a, b);
}
const goc = (): string => (process.env.MOBILE_UPLOAD_LOCAL_BASE?.trim() || "http://127.0.0.1:3217").replace(/\/$/, "");

export const khoLocal: KhoTepRieng = {
  ten: "local",
  async kyPut(key, contentType, ttl) {
    const e = Date.now() + ttl * 1000;
    return { url: `${goc()}/api/dev-kho/${key}?act=put&e=${e}&c=${encodeURIComponent(contentType)}&s=${kyUrlLocal("put", key, e, contentType)}`, headers: { "Content-Type": contentType } };
  },
  async dau(key) {
    const dir = thuMucLocal();
    if (!dir) return null;
    try {
      const st = await fs.stat(duongDan(dir, key));
      const meta = JSON.parse(await fs.readFile(duongDan(dir, key) + ".meta", "utf8")) as { contentType?: string };
      return { size: st.size, contentType: meta.contentType ?? null };
    } catch {
      return null;
    }
  },
  async docByteDau(key, n) {
    const dir = thuMucLocal();
    if (!dir) return null;
    try {
      const fh = await fs.open(duongDan(dir, key), "r");
      try {
        const buf = Buffer.alloc(n);
        const { bytesRead } = await fh.read(buf, 0, n, 0);
        return new Uint8Array(buf.subarray(0, bytesRead));
      } finally {
        await fh.close();
      }
    } catch {
      return null;
    }
  },
  async kyGet(key, ttl) {
    const e = Date.now() + ttl * 1000;
    return `${goc()}/api/dev-kho/${key}?act=get&e=${e}&c=-&s=${kyUrlLocal("get", key, e, "-")}`;
  },
  async xoa(key) {
    const dir = thuMucLocal();
    if (!dir) return;
    await fs.rm(duongDan(dir, key), { force: true });
    await fs.rm(duongDan(dir, key) + ".meta", { force: true });
  },
};
/** Ghi tệp vào kho local (tuyến dev-kho gọi). Trả cỡ đã ghi. */
export async function ghiKhoLocal(key: string, loai: string, du: Uint8Array): Promise<number> {
  const dir = thuMucLocal();
  if (!dir) throw new KhoRiengChuaCauHinh("kho local đang tắt");
  const p = duongDan(dir, key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, du);
  await fs.writeFile(p + ".meta", JSON.stringify({ contentType: loai }));
  return du.byteLength;
}
export async function docKhoLocal(key: string): Promise<{ du: Buffer; contentType: string | null } | null> {
  const dir = thuMucLocal();
  if (!dir) return null;
  try {
    const meta = JSON.parse(await fs.readFile(duongDan(dir, key) + ".meta", "utf8")) as { contentType?: string };
    return { du: await fs.readFile(duongDan(dir, key)), contentType: meta.contentType ?? null };
  } catch {
    return null;
  }
}
export const khoLocalDangBat = (): boolean => thuMucLocal() !== null;

// ── chọn kho ──
let ghiDe: KhoTepRieng | null = null;
/** Cho bộ test: thay kho bằng bản giả trong bộ nhớ. `null` = bỏ ghi đè. */
export function datKhoTepRieng(k: KhoTepRieng | null): void {
  ghiDe = k;
}
/** Kho đang dùng; không có kho nào cấu hình ⇒ `null` (caller trả 503 — fail-closed, KHÔNG rơi về bucket công khai). */
export function layKhoTepRieng(): KhoTepRieng | null {
  if (ghiDe) return ghiDe;
  if (khoLocalDangBat()) return khoLocal;
  try {
    bucketRieng();
    return process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY ? khoR2 : null;
  } catch {
    return null;
  }
}

// ── nhận dạng nội dung (không tin loại khai báo) ──
const bat = (b: Uint8Array, vt: number, ...x: number[]) => x.every((v, i) => b[vt + i] === v);
const chuoiAt = (b: Uint8Array, vt: number, s: string) => s.split("").every((c, i) => b[vt + i] === c.charCodeAt(0));
/** `true` nếu vài byte đầu PHÙ HỢP định dạng khai báo. Loại văn bản (txt/csv): không có NUL. Loại lạ ⇒ false (không nhận). */
export function kiemNoiDung(mime: string, b: Uint8Array): boolean {
  if (b.length < 4) return false;
  switch (mime) {
    case "image/jpeg": return bat(b, 0, 0xff, 0xd8, 0xff);
    case "image/png": return bat(b, 0, 0x89, 0x50, 0x4e, 0x47);
    case "image/gif": return chuoiAt(b, 0, "GIF8");
    case "image/webp": return chuoiAt(b, 0, "RIFF") && chuoiAt(b, 8, "WEBP");
    case "application/pdf": return chuoiAt(b, 0, "%PDF");
    case "video/mp4": case "video/quicktime": return chuoiAt(b, 4, "ftyp");
    case "video/webm": return bat(b, 0, 0x1a, 0x45, 0xdf, 0xa3);
    case "video/x-msvideo": return chuoiAt(b, 0, "RIFF") && chuoiAt(b, 8, "AVI ");
    case "application/msword": case "application/vnd.ms-excel": case "application/vnd.ms-powerpoint": return bat(b, 0, 0xd0, 0xcf, 0x11, 0xe0);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation": return chuoiAt(b, 0, "PK");
    case "text/plain": case "text/csv": return !b.includes(0);
    default: return false;
  }
}

/** Khoá đối tượng XÁC ĐỊNH theo (phụ huynh, khoá gửi lại, mục đích, phạm vi) — gửi lại cùng khoá ⇒ cùng khoá ⇒ không đẻ vé trùng. Không chứa tên tệp. */
export function khoaDoiTuong(o: { parentUserId: string; studentId: string; khoaGuiLai: string; mucDich: string; phamVi: string; duoi: string }): string {
  const h = createHash("sha256").update(`${o.parentUserId}|${o.khoaGuiLai}|${o.mucDich}|${o.phamVi}`).digest("hex").slice(0, 32);
  return `mobile/${o.mucDich}/${o.studentId}/${h}${o.duoi}`;
}
