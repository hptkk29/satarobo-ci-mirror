// app/api/scorm/asset/[...path]/route.ts — R7-12: resolver tài nguyên SCORM/PDF (RIÊNG TƯ).
// Tài liệu bài giảng là tài liệu NỘI BỘ CÔNG TY — KHÔNG public ra ngoài. Vì vậy KHÔNG
// redirect sang URL public; thay vào đó PROXY luồng byte từ R2 qua chính app (cùng origin,
// có đăng nhập). Xác vé (HMAC TTL 10p, buộc packageId+session+userId). Vé lấy từ query ?t
// (hop đầu index.html/source.pdf) HOẶC cookie (asset con relative bị mất query) → set cookie
// ở hop đầu. Same-origin ⇒ asset con SCORM resolve đúng + window.API hoạt động lại.
// Vé sai/hết hạn/IDOR/user không khớp (PARENT/HV/chia sẻ link) → 403. Path traversal → 403.
//
// ── 12/10/2026 — TỐI ƯU TẢI TRÊN MẠNG YẾU (log Caddy VPS, 19 sự kiện / 10 ngày, TOÀN BỘ ở host giaovien, 0 ở admin) ──
// Phần lớn là `video1.mp4` bị trình duyệt HUỶ giữa chừng (`H3_REQUEST_CANCELLED`) và `player.js` bị client ngắt. Gói thật nặng
// ~31MB (lớn nhất 150MB), ~400–570 tệp. Đường cũ: không hỗ trợ Range ⇒ mỗi lần trình duyệt huỷ/tua video là tải LẠI cả tệp;
// nạp nguyên tệp vào RAM mới trả byte đầu; tra DB mỗi tệp; gọi R2 không hạn chờ (treo ⇒ quay hoài, lỗi nào cũng thành 404).
//   1. URL mang MÃ GÓI (`/api/scorm/asset/<packageId>/…`): cả 50 gói đều launch `res/index.html`, URL asset con trùng nhau giữa
//      các gói mà cache là `private, max-age=3600` ⇒ mở bài A rồi bài B có thể ăn tệp của A. Cookie vé cũng theo gói (path).
//   2. Hỗ trợ `Range` (một khoảng) chuyển thẳng cho R2 ⇒ video xin từng khoảng, tua không tải lại cả tệp.
//   3. Prefix R2 đi kèm vé (đã ký) ⇒ không tra DB mỗi tệp. Vé cũ không có prefix ⇒ vẫn tra DB.
//   4. Tệp nhỏ (≤ NGUONG_DEM) nạp RAM để NHẢ socket R2 ngay; tệp lớn truyền dòng. Mọi hàng rào chạy TRƯỚC `GetObject`
//      (return sớm sau GetObject = rò socket — xem chú thích ở `app/api/elearning/media/[...khoa]/route.ts`).
//   5. Gọi R2 có HẠN CHỜ (tới khi có header) và lỗi được PHÂN LOẠI: 404 / 304 / 416 / 502 / 504 — không nuốt hết thành 404.
//   6. Gia hạn vé trượt (có trần): cookie + vé chỉ sống 10 phút nên asset nạp trễ sau phút thứ 10 ăn 403 giữa buổi dạy.
//   7. ĐỆM ĐĨA (lib/scorm/dem-dia.ts): đo thật từ VPS — 396/419 tệp của một gói ≤ 200KB và MỖI tệp lấy từ R2 mất ~270ms. Tệp đã
//      nằm trên đĩa thì phục vụ ở đây (vài ms, có Range + 304), trượt thì lấy R2 như trên rồi ghi xuống đĩa và kích hoạt LÀM NÓNG
//      cả gói. Đệm nằm SAU mọi hàng rào (vé · phiên · mã gói · traversal) — không có đường vào riêng.
// KHÔNG đổi: `Cache-Control: private, max-age=3600` cho asset con (test EL-10 ghi rõ cache sống lâu hơn vé là lỗi đã biết —
// không kéo dài thêm), không public, không CDN.
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isScormEnabled } from "@/lib/flags";
import {
  SCORM_COOKIE_VE,
  SCORM_COOKIE_VE_CU,
  cookiePathChoGoi,
  rangeChuyenTiep,
  tachDuongDanAsset,
} from "@/lib/scorm/asset-url";
import { docRange } from "@/lib/elearning/range";
import { docMetaDem, docToanBoDem, ghiDemTuBytes, lamNongGoi, moLuongDem, type MetaDem } from "@/lib/scorm/dem-dia";
import { giaHanScormTicket, verifyScormTicket } from "@/lib/scorm/ticket";
import { getR2Client, getR2Bucket } from "@/lib/storage/r2-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tệp ≤ ngưỡng này nạp vào RAM (nhả socket R2 ngay); lớn hơn thì truyền dòng. */
export const NGUONG_DEM_BYTE = 2 * 1024 * 1024;
/** Chờ R2 trả HEADER tối đa bao lâu — SDK không có hạn chờ mặc định, treo là quay hoài. */
export const HAN_CHO_R2_MS = 15_000;
/** Asset con: cache riêng tư của trình duyệt (GIỮ NGUYÊN giá trị cũ — xem đầu file). */
const CACHE_ASSET_CON = "private, max-age=3600";

/** Segment nguy hiểm: rỗng, ".", "..", backslash, NUL → traversal/absolute. */
function isUnsafeSegments(segs: string[]): boolean {
  if (segs.length === 0) return true;
  for (const s of segs) {
    if (!s || s === "." || s === "..") return true;
    if (s.includes("\\") || s.includes("\0") || s.startsWith("/")) return true;
  }
  return false;
}

type LoiR2 = { name?: string; $metadata?: { httpStatusCode?: number } };

/** Gọi R2 với hạn chờ tới khi có header. Thân (luồng) KHÔNG bị hạn chờ cắt. */
async function layTuR2(lenh: GetObjectCommand) {
  const ctl = new AbortController();
  const hen = setTimeout(() => ctl.abort(), HAN_CHO_R2_MS);
  try {
    return await getR2Client().send(lenh, { abortSignal: ctl.signal });
  } finally {
    clearTimeout(hen);
  }
}

function trangThaiTuLoiR2(e: unknown): number {
  const err = (e ?? {}) as LoiR2;
  const ma = err.$metadata?.httpStatusCode;
  if (err.name === "AbortError" || err.name === "TimeoutError") return 504;
  if (err.name === "NotModified" || ma === 304) return 304;
  if (err.name === "NoSuchKey" || err.name === "NotFound" || ma === 404) return 404;
  if (err.name === "InvalidRange" || ma === 416) return 416;
  return 502;
}

type NguCanhVe = { queryToken: string | null; token: string; payload: NonNullable<ReturnType<typeof verifyScormTicket>["payload"]> };

/** Đặt cookie vé THEO GÓI: hop đầu (có ?t) hoặc khi vé sắp hết và còn trong trần gia hạn. */
function datCookieVe(res: NextResponse, v: NguCanhVe): void {
  const veMoi = v.queryToken ? v.token : giaHanScormTicket(v.payload);
  if (!veMoi) return;
  res.cookies.set(SCORM_COOKIE_VE, veMoi, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: cookiePathChoGoi(v.payload.packageId),
    maxAge: 600,
  });
}

/** Phục vụ từ ĐĨA: ETag/304, Range (206/416), tệp nhỏ nạp RAM, lớn truyền dòng. */
async function phucVuTuDia(req: NextRequest, key: string, meta: MetaDem, v: NguCanhVe): Promise<NextResponse> {
  const cache = v.queryToken ? "private, no-store" : CACHE_ASSET_CON;
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && meta.etag && (ifNoneMatch === meta.etag || ifNoneMatch === "*")) {
    const r304 = new NextResponse(null, { status: 304, headers: { "Cache-Control": cache, ETag: meta.etag } });
    datCookieVe(r304, v);
    return r304;
  }
  const kq = docRange(req.headers.get("range"), meta.size);
  if (kq.loai === "khong-thoa-man") {
    return new NextResponse(null, { status: 416, headers: { "Content-Range": kq.contentRange } });
  }
  const headers: Record<string, string> = {
    "Content-Type": meta.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": cache,
  };
  if (meta.etag) headers.ETag = meta.etag;
  if (meta.lastModified) headers["Last-Modified"] = meta.lastModified;

  let res: NextResponse;
  if (kq.loai === "mot-phan") {
    headers["Content-Range"] = kq.contentRange;
    headers["Content-Length"] = String(kq.contentLength);
    const luong = Readable.toWeb(moLuongDem(key, { start: kq.start, end: kq.end })) as unknown as ReadableStream;
    res = new NextResponse(luong, { status: 206, headers });
  } else if (meta.size <= NGUONG_DEM_BYTE) {
    headers["Content-Length"] = String(meta.size);
    res = new NextResponse(new Uint8Array(await docToanBoDem(key)), { status: 200, headers });
  } else {
    headers["Content-Length"] = String(meta.size);
    res = new NextResponse(Readable.toWeb(moLuongDem(key)) as unknown as ReadableStream, { status: 200, headers });
  }
  datCookieVe(res, v);
  return res;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  if (!isScormEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  // 1. Vé: query ?t (hop đầu) hoặc cookie theo gói (asset con relative — đã mất query), rồi cookie cũ cho vé đang bay.
  const queryToken = req.nextUrl.searchParams.get("t");
  const token =
    queryToken ??
    req.cookies.get(SCORM_COOKIE_VE)?.value ??
    req.cookies.get(SCORM_COOKIE_VE_CU)?.value ??
    "";
  const v = verifyScormTicket(token);
  if (!v.ok || !v.payload) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const payload = v.payload;

  // 2. Buộc vé theo user đăng nhập — chặn chia sẻ link + PARENT/HV.
  const session = await auth();
  if (!session?.user || session.user.id !== payload.userId) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // 3. Path traversal guard + mã gói trong URL phải KHỚP vé (đường dẫn kiểu cũ không có mã gói vẫn được — vé đang bay).
  const { path } = await ctx.params;
  if (isUnsafeSegments(path)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const { maGoiTrongUrl, rel } = tachDuongDanAsset(path);
  if (maGoiTrongUrl !== null && maGoiTrongUrl !== payload.packageId) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (rel.length === 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  // 4. Key R2 = storagePrefix gói (theo VÉ, không theo URL) + path → chống IDOR sang gói khác.
  //    Prefix đã được ký trong vé mới; vé cũ rơi về tra DB.
  let storagePrefix = payload.prefix ?? null;
  if (!storagePrefix) {
    const pkg = await db.scormPackage.findUnique({
      where: { id: payload.packageId },
      select: { storagePrefix: true },
    });
    if (!pkg) {
      return new NextResponse("Not found", { status: 404 });
    }
    storagePrefix = pkg.storagePrefix;
  }
  const prefix = storagePrefix.endsWith("/") ? storagePrefix : `${storagePrefix}/`;
  const key = `${prefix}${rel.join("/")}`;
  const nguCanh: NguCanhVe = { queryToken, token, payload };

  // 4b. ĐỆM ĐĨA: có sẵn thì phục vụ ngay (không chạm R2). Mọi hàng rào ở trên đã chạy.
  const meta = await docMetaDem(key);
  if (meta) return phucVuTuDia(req, key, meta, nguCanh);

  // 5. Điều kiện + Range chuyển thẳng cho R2 (một khoảng hợp lệ; còn lại trả cả tệp).
  const range = rangeChuyenTiep(req.headers.get("range"));
  const ifNoneMatch = req.headers.get("if-none-match");

  try {
    const obj = await layTuR2(
      new GetObjectCommand({
        Bucket: getR2Bucket(),
        Key: key,
        ...(range ? { Range: range } : {}),
        ...(ifNoneMatch && !range ? { IfNoneMatch: ifNoneMatch } : {}),
      }),
    );
    if (!obj.Body) {
      return new NextResponse("Not found", { status: 404 });
    }

    const dai = Number(obj.ContentLength ?? 0);
    const laKhoang = Boolean(range && obj.ContentRange);
    const headers: Record<string, string> = {
      "Content-Type": obj.ContentType ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      // Hop đầu mang vé trên URL: đừng để trình duyệt/proxy giữ bản có vé. Asset con: cache riêng tư như cũ.
      "Cache-Control": queryToken ? "private, no-store" : CACHE_ASSET_CON,
    };
    if (obj.ETag) headers.ETag = obj.ETag;
    if (obj.LastModified) headers["Last-Modified"] = obj.LastModified.toUTCString();
    if (laKhoang) headers["Content-Range"] = String(obj.ContentRange);

    // Tệp nhỏ & không phải khoảng: nạp RAM ⇒ socket R2 được trả ngay. Còn lại truyền dòng (video lớn, khoảng).
    let body: BodyInit;
    if (!laKhoang && dai > 0 && dai <= NGUONG_DEM_BYTE) {
      const bytes = await obj.Body.transformToByteArray();
      headers["Content-Length"] = String(bytes.length);
      body = Buffer.from(bytes);
      // Ghi xuống đĩa SAU khi đã có byte (không chặn phản hồi, không ném).
      void ghiDemTuBytes(key, bytes, {
        contentType: obj.ContentType ?? "application/octet-stream",
        etag: obj.ETag ?? null,
        lastModified: obj.LastModified ? obj.LastModified.toUTCString() : null,
      });
    } else {
      if (dai > 0) headers["Content-Length"] = String(dai);
      body = (obj.Body as { transformToWebStream: () => ReadableStream }).transformToWebStream();
    }

    const res = new NextResponse(body, { status: laKhoang ? 206 : 200, headers });

    // Cookie vé THEO GÓI (hop đầu / sắp hết vé). Cookie cũ không ghi nữa.
    datCookieVe(res, nguCanh);
    // Trượt đệm: kích hoạt LÀM NÓNG cả gói ở nền (tệp lớn/video + các tệp chưa có) — lượt sau phục vụ từ đĩa.
    void lamNongGoi(prefix);
    return res;
  } catch (e) {
    const ma = trangThaiTuLoiR2(e);
    if (ma === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: { "Cache-Control": queryToken ? "private, no-store" : CACHE_ASSET_CON },
      });
    }
    if (ma === 416) {
      return new NextResponse(null, { status: 416 });
    }
    if (ma >= 500) {
      // Lỗi hạ tầng (R2 chậm/ngắt) — ghi lại để thấy được, và ĐỪNG giả làm 404 (client sẽ không thử lại).
      const err = (e ?? {}) as LoiR2;
      console.error("[scorm-asset] R2 lỗi", { ma, ten: err.name, key });
    }
    return new NextResponse(ma === 404 ? "Not found" : "Upstream error", { status: ma });
  }
}
