import type { PrismaClient } from "@prisma/client";
import { GetObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { docRange, rangeChoR2 } from "./range-http";
import { isElearningOnlineEnabled } from "@/lib/flags";
import { rateLimit } from "@/lib/rate-limit";
import { ipChoRateLimit } from "@/lib/security/client-ip";
import { getOnlineVideoBucket } from "@/lib/storage/online-video-storage";
import { getR2Client } from "@/lib/storage/r2-client";
import { capVePhatHocThu, dtoVePhat, httpPhat, kiemVePhat, type MaLoiPhat } from "./video-phat";

/**
 * E-LEARNING ONLINE — LỚP HTTP của PHÁT VIDEO (V8.44): route handler chỉ gọi hàm ở đây để test được không cần dựng Next.
 *
 *  · `xuLyCapVeHocThu` — cấp vé cho bài học thử, KHÔNG đăng nhập; giới hạn tần suất theo IP; phản hồi `no-store`.
 *  · `xuLyPhat` — PROXY phát video: vé (query `ve`) → `kiemVePhat` (hỏi lại quyền ở MỖI lượt) → R2 (`HeadObject` + `GetObject` có `Range`) → truyền DÒNG.
 *    Không bao giờ nạp cả tệp vào RAM, không bao giờ redirect/ký URL R2, không URL công khai: byte đi qua máy chủ này hoặc không đi đâu cả.
 *
 * Mọi phản hồi `Cache-Control: no-store` (quyền đổi theo thời gian; một proxy giữ cache sẽ phát tiếp sau khi vé/quyền đã hết).
 * Cờ `ELEARNING_ONLINE_ENABLED` tắt ⇒ 404 trống (như chưa có API).
 */

const KHONG_LUU = { "Cache-Control": "no-store" } as const;
const TOI_DA_DO_DAI_VE = 1200;

const THONG_BAO: Readonly<Record<string, string>> = {
  VE_SAI_DINH_DANG: "Vé phát không hợp lệ.",
  VE_SAI_CHU_KY: "Vé phát không hợp lệ.",
  VE_HET_HAN: "Vé phát đã hết hạn. Hãy xin vé mới.",
  VE_PHIEN_BAN_CU: "Khoá học vừa được cập nhật. Hãy xin vé mới.",
  VE_KHONG_KHOP_QUYEN: "Vé phát không còn khớp quyền học.",
  KHONG_CO_QUYEN: "Học viên chưa có quyền học khoá này.",
  DA_THU_HOI: "Quyền học khoá này đã bị thu hồi.",
  HET_HAN: "Quyền học khoá này đã hết hạn.",
  KHOA_CHUA_PHAT_HANH: "Khoá học chưa sẵn sàng.",
  BAI_KHONG_TON_TAI: "Không tìm thấy bài học.",
  BAI_DA_AN: "Không tìm thấy bài học.",
  BAI_CHUA_MO: "Bài học này chưa mở.",
  DA_HOAN_THANH_KHONG_XEM_LAI: "Bài học này đã hoàn thành và không xem lại.",
  CAI_DAT_KHONG_HOP_LE: "Khoá học đang được cấu hình lại.",
  BAI_KHONG_PHAI_VIDEO: "Bài này không phải video.",
  CHUA_CO_VIDEO: "Bài này chưa có video.",
  KHOA_VIDEO_KHONG_HOP_LE: "Video chưa sẵn sàng.",
  KHO_VIDEO_CHUA_CAU_HINH: "Kho video chưa sẵn sàng.",
  KHONG_TIM_THAY: "Không tìm thấy video.",
};

const loi = (ma: MaLoiPhat | "KHONG_TIM_THAY" | "THAM_SO_KHONG_HOP_LE" | "KHO_VIDEO_LOI", status?: number, thongBao?: string) =>
  fail(ma, thongBao ?? THONG_BAO[ma] ?? "Không phát được video.", { status: status ?? httpPhat(ma), headers: KHONG_LUU });
const tat = () => new Response(null, { status: 404, headers: KHONG_LUU });

export type DepsPhat = {
  /** Chỉ để test: thay máy khách R2 (chỉ cần `send`). Mặc định `getR2Client()`. */
  s3?: Pick<S3Client, "send">;
  now?: Date;
  db?: PrismaClient;
};

/** `POST …/khoa/:slug/hoc-thu/:bai/video-ticket` — cấp vé phát bài học thử. Không đăng nhập. */
export async function xuLyCapVeHocThu(req: Request, slug: string, bai: string, deps: DepsPhat = {}): Promise<Response> {
  if (!isElearningOnlineEnabled()) return tat();
  if (!/^[a-z0-9-]{1,120}$/.test(slug) || !/^[A-Za-z0-9_-]{1,64}$/.test(bai)) return loi("KHONG_TIM_THAY");
  const gh = await rateLimit({ key: `onl-video-ck:${ipChoRateLimit(req.headers)}`, max: 60, windowMs: 60_000 });
  if (!gh.success) {
    return fail("RATE_LIMITED", "Quá nhiều yêu cầu. Vui lòng thử lại sau.", {
      status: 429,
      headers: { ...KHONG_LUU, "Retry-After": String(Math.max(1, Math.ceil((gh.resetAt - Date.now()) / 1000))) },
    });
  }
  const r = await capVePhatHocThu(deps.db ?? db, { slug, lessonStableId: bai, now: deps.now ?? new Date() });
  if (!r.ok) return loi(r.ma);
  return ok(dtoVePhat(r), { headers: KHONG_LUU });
}

const laKhongTonTai = (e: unknown): boolean => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return x?.name === "NotFound" || x?.name === "NoSuchKey" || x?.$metadata?.httpStatusCode === 404;
};

/**
 * `GET|HEAD /api/public/elearning-online/video/phat?ve=…` — phát video (Range). Thứ tự cổng: cờ → vé → quyền/học thử LÚC NÀY → khoá hợp chính sách → bucket → R2.
 * Vé sai/hết hạn/quyền thu hồi ⇒ chưa chạm R2.
 */
export async function xuLyPhat(req: Request, deps: DepsPhat = {}): Promise<Response> {
  if (!isElearningOnlineEnabled()) return tat();
  const phuongThuc = req.method.toUpperCase();
  if (phuongThuc !== "GET" && phuongThuc !== "HEAD") return new Response(null, { status: 405, headers: { ...KHONG_LUU, Allow: "GET, HEAD" } });
  const ve = new URL(req.url).searchParams.get("ve");
  if (!ve || ve.length > TOI_DA_DO_DAI_VE) return loi("THAM_SO_KHONG_HOP_LE", 400, "Thiếu vé phát.");

  const kq = await kiemVePhat(deps.db ?? db, ve, deps.now ?? new Date());
  if (!kq.ok) return loi(kq.ma);
  return phatKhoaVideo(req, kq, deps);
}

/**
 * Phần STREAM dùng chung cho MỌI đường phát (vé trả phí/học thử công khai ở trên; vé học thử GẮN TÀI KHOẢN của Mobile — `lib/mobile-api/dich-vu/free-mode.ts`).
 * Người gọi đã kiểm XONG quyền/vé và đưa vào khoá R2 đã qua danh sách trắng + `Content-Type` suy từ đuôi khoá. Không kiểm quyền ở đây (cố ý: một nơi quyết quyền cho mỗi đường).
 */
export async function phatKhoaVideo(req: Request, kq: { khoa: string; contentType: string }, deps: DepsPhat = {}): Promise<Response> {
  const phuongThuc = req.method.toUpperCase();
  let bucket: string;
  try {
    bucket = getOnlineVideoBucket();
  } catch {
    // Thiếu/sai cấu hình ⇒ 503; KHÔNG rơi về bucket nào khác.
    return loi("KHO_VIDEO_CHUA_CAU_HINH");
  }
  const s3 = deps.s3 ?? getR2Client();

  // Dung lượng thật bằng HeadObject (KHÔNG `GetObject Range 0-0`: luồng bỏ dở giữ một khe kết nối — xem `app/api/elearning/media/[...khoa]/route.ts`).
  let coTep: number;
  try {
    const dau = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: kq.khoa }), { abortSignal: req.signal });
    coTep = Number(dau.ContentLength ?? 0);
  } catch (e) {
    if (laKhongTonTai(e)) return loi("KHONG_TIM_THAY");
    return loi("KHO_VIDEO_LOI", 502, "Kho video đang lỗi. Vui lòng thử lại.");
  }

  const r = docRange(req.headers.get("range"), coTep);
  if (r.loai === "khong-thoa-man") return new Response(null, { status: 416, headers: { "Content-Range": r.contentRange, ...KHONG_LUU } });

  const dauRa: Record<string, string> = {
    "Content-Type": kq.contentType, // suy từ ĐUÔI khoá đã qua danh sách trắng, không tin metadata R2
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Length": String(r.loai === "mot-phan" ? r.contentLength : coTep),
    ...(r.loai === "mot-phan" ? { "Content-Range": r.contentRange } : {}),
  };
  const status = r.loai === "mot-phan" ? 206 : 200;
  if (phuongThuc === "HEAD") return new Response(null, { status, headers: dauRa });

  let doc;
  try {
    doc = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: kq.khoa, ...(r.loai === "mot-phan" ? { Range: rangeChoR2(r.start, r.end) } : {}) }), { abortSignal: req.signal });
  } catch (e) {
    if (laKhongTonTai(e)) return loi("KHONG_TIM_THAY");
    return loi("KHO_VIDEO_LOI", 502, "Kho video đang lỗi. Vui lòng thử lại.");
  }
  if (!doc.Body) return loi("KHONG_TIM_THAY");
  // ⚠️ `transformToWebStream()`, KHÔNG `transformToByteArray()` — video hàng trăm MB không được vào RAM.
  const body = (doc.Body as { transformToWebStream: () => ReadableStream }).transformToWebStream();
  return new Response(body, { status, headers: dauRa });
}
