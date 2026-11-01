// app/api/scorm/asset/[...path]/route.ts — R7-12: resolver tài nguyên SCORM/PDF (RIÊNG TƯ).
// Tài liệu bài giảng là tài liệu NỘI BỘ CÔNG TY — KHÔNG public ra ngoài. Vì vậy KHÔNG redirect sang URL public; thay vào đó
// PROXY luồng byte từ R2 qua chính app (cùng origin, có đăng nhập). Xác vé (HMAC TTL 10p, buộc packageId+session+userId). Vé lấy
// từ query ?t (hop đầu index.html/source.pdf) HOẶC cookie (asset con relative bị mất query) → set cookie ở hop đầu. Same-origin ⇒
// asset con SCORM resolve đúng + window.API hoạt động lại. Vé sai/hết hạn/IDOR/user không khớp (PARENT/HV/chia sẻ link) → 403.
// Path traversal → 403.
//
// ── 12/10/2026 — TỐI ƯU TẢI TRÊN MẠNG YẾU (log Caddy VPS, 19 sự kiện / 10 ngày, TOÀN BỘ ở host giaovien, 0 ở admin) ──
// Phần lớn là `video1.mp4` bị trình duyệt HUỶ giữa chừng (`H3_REQUEST_CANCELLED`) và `player.js` bị client ngắt. Gói thật nặng
// ~31MB (lớn nhất 150MB), ~400–570 tệp. Đường cũ: không hỗ trợ Range ⇒ mỗi lần trình duyệt huỷ/tua video là tải LẠI cả tệp;
// nạp nguyên tệp vào RAM mới trả byte đầu; tra DB mỗi tệp; gọi R2 không hạn chờ (treo ⇒ quay hoài, lỗi nào cũng thành 404).
//   1. URL mang MÃ GÓI (`/api/scorm/asset/<packageId>/…`): cả 50 gói đều launch `res/index.html`, URL asset con trùng nhau giữa
//      các gói mà cache là `private, max-age=3600` ⇒ mở bài A rồi bài B có thể ăn tệp của A. Cookie vé cũng theo gói (path).
//   2. Hỗ trợ `Range` (một khoảng) chuyển thẳng cho R2 ⇒ video xin từng khoảng, tua không tải lại cả tệp.
//   3. Prefix R2 đi kèm vé (đã ký) ⇒ không tra DB mỗi tệp. Vé cũ không có prefix ⇒ vẫn tra DB.
//   4. Tệp nhỏ (≤ NGUONG_DEM_BYTE) nạp RAM để NHẢ socket R2 ngay; tệp lớn truyền dòng. Mọi hàng rào chạy TRƯỚC `GetObject`
//      (return sớm sau GetObject = rò socket — xem chú thích ở `app/api/elearning/media/[...khoa]/route.ts`).
//   5. Gọi R2 có HẠN CHỜ (tới khi có header) và lỗi được PHÂN LOẠI: 404 / 304 / 416 / 502 / 504 — không nuốt hết thành 404.
//   6. Gia hạn vé trượt (có trần): cookie + vé chỉ sống 10 phút nên asset nạp trễ sau phút thứ 10 ăn 403 giữa buổi dạy.
//   7. ĐỆM ĐĨA (lib/scorm/dem-dia.ts): đo thật từ VPS — 396/419 tệp của một gói ≤ 200KB và MỖI tệp lấy từ R2 mất ~270ms. Tệp đã
//      nằm trên đĩa thì phục vụ ở đây (vài ms, có Range + 304), trượt thì lấy R2 như trên rồi ghi xuống đĩa và kích hoạt LÀM NÓNG
//      cả gói. Đệm nằm SAU mọi hàng rào (vé · phiên · mã gói · traversal · đường dẫn nội bộ) — không có đường vào riêng.
//
// ── 24/10/2026 — VÁ NỐT (đo prod: 602 lượt mở/30 ngày, 37% bị mở lại < 10 phút vì treo) ──
//   8. `source.zip` / `_src/` CÙNG prefix với nội dung phục vụ (zip gốc tới ~94MB, không bị xoá sau giải nén): trước đây mọi GV có vé
//      tải được zip gốc, trái ràng buộc "GV không tải được file nguồn". Nay `laDuongDanNoiBo` ⇒ 404, chạy SAU kiểm vé/mã gói và
//      TRƯỚC đệm đĩa/R2. Không xoá file, không sửa dữ liệu — chặn ở route.
//   9. Client ngắt (trình duyệt huỷ video) ⇒ HUỶ luồng R2 / đóng fd đĩa NGAY (`boLuongNode`: cancel + req.signal), có backpressure
//      thật (không đọc nhanh hơn client nhận), thân đứng im quá HAN_TREO_THAN_MS thì cắt thay vì treo vô hạn.
//  10. `HEAD` tường minh (Next gọi GET rồi vứt thân ⇒ kéo cả video từ R2 chỉ để lấy header): nay chỉ HeadObject / đọc meta đĩa.
//  11. `If-Range` (trình duyệt tiếp tục tải dở), `If-None-Match` dạng danh sách/yếu, Cache-Control đi qua MỘT chính sách
//      (`chinhSachCache`: URL kiểu cũ không mã gói KHÔNG được cache — nó trùng nhau giữa các gói).
//  12. Mở fd đĩa TRƯỚC khi gửi header (`moLuongDemAnToan`): tệp vừa bị dọn đệm xoá thì rơi về R2 thay vì gửi 200 rồi đứt giữa thân.
//  13. Log có cấu trúc (packageId, khoá tương đối, mã, tên lỗi, thời lượng; nén dòng lặp) cho 403/404/5xx/R2 chậm — KHÔNG in vé/cookie.
// KHÔNG đổi: không public, không CDN, `private, max-age=3600` cho asset con kiểu mới (test EL-10 ghi rõ cache sống lâu hơn vé là lỗi
// đã biết — không kéo dài thêm).
//
// ── 24/10/2026 (vòng 2, sau benchmark) ──
//  14. GỘP LƯỢT TRƯỢT ĐỆM theo khoá (`taiTepNhoDungChung`, lib/scorm/dem-dia.ts): lượt mở nguội 7,3 s và 10 GV cùng mở ≈ 21 s vì mỗi lượt
//      trượt đệm tự đi R2 (3.998 request cho 400 tệp × 10 GV). Nay chỉ GET tệp NHỎ không Range được gộp (kể cả có If-None-Match: lượt tải là
//      GET không điều kiện, rồi so ETag CỤC BỘ ⇒ 304 — trình duyệt xác nhận lại tệp hết `max-age` 1 giờ cũng không đổ thẳng xuống R2): bên sau chờ
//      kết quả của bên trước. Tệp lớn / Range / HEAD vẫn đi đường riêng. Gộp chạy SAU mọi hàng rào — nó chỉ thay NGUỒN byte.
//  15. `206` mang `no-transform` ở Cache-Control: lớp nén của Next không xét `Range`/206 nên gzip lại một phần 206 mà vẫn giữ `Content-Range`
//      của bản chưa nén (vi phạm RFC 9110; benchmark ca F). Cục bộ ở route — không đổi hợp đồng `chinhSachCache`.
//  16. Gia hạn vé TRƯỢT hỏi phiên SỐNG ở DB (`requireLiveSession`), CHỈ ở nhánh thật sự cấp cookie mới (vé còn < 5 phút ≈ 1 lần/5 phút/vé,
//      có gộp + nhớ 60 s ⇒ không thêm truy vấn DB vào đường nóng). Phiên chết ⇒ 403 'phien'; không hỏi được DB ⇒ không cấp cookie mới
//      nhưng vẫn phục vụ request bằng vé còn hạn (xem `kiemPhienSongCoNho` ở lib/scorm/luong-r2.ts).
//
// ── 25/10/2026 (vòng 2, quan sát) ──
//  17. `Server-Timing` trên 200/206/304 thành công: `cache;desc=<disk|r2-leader|r2-coalesced|r2-stream|r2-head>, pre;dur, src;dur, total;dur`. Smoke PROD 24/10 chỉ có
//      thời gian phía trình duyệt nên không tách được "đĩa trúng / R2 trượt / gộp lượt của người khác"; header này cho trình duyệt đọc qua
//      `PerformanceResourceTiming.serverTiming`. Chỉ MỘT chỗ gắn (`ganServerTiming`); các nhánh chỉ ghi nguồn vào `NguCanhVe.tm`. KHÔNG mang khoá R2/prefix/
//      mã gói; KHÔNG gắn cho 403/404/416/5xx (hàng rào chặn thì không để lộ thêm gì). `total` không gồm thời gian truyền thân dòng.
import type { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/lib/auth";
import { requireLiveSession } from "@/lib/auth/live-session";
import { db } from "@/lib/db";
import { isScormEnabled } from "@/lib/flags";
import {
  SCORM_COOKIE_VE,
  SCORM_COOKIE_VE_CU,
  cookiePathChoGoi,
  rangeChuyenTiep,
  tachDuongDanAsset,
} from "@/lib/scorm/asset-url";
import { chinhSachCache } from "@/lib/scorm/cache-asset";
import {
  coLuotTaiNhoDangBay,
  demDangBat,
  docMetaDem,
  docToanBoDem,
  ghiDemTuBytes,
  ghiNhanLoiR2,
  lamNongGoi,
  moLuongDemAnToan,
  taiTepNhoDungChung,
  type MetaDem,
  type TepNho,
} from "@/lib/scorm/dem-dia";
import { laDuongDanNoiBo } from "@/lib/scorm/duong-dan-cam";
import { tinhServerTiming, type DoThoiGian, type NguonByte } from "@/lib/scorm/do-thoi-gian";
import { docRange } from "@/lib/elearning/range";
import {
  HAN_CHO_R2_MS,
  NGUONG_DEM_BYTE,
  boLuongNode,
  docHetLuong,
  ghiLogAsset,
  ifRangeKhop,
  kiemPhienSongCoNho,
  khopIfNoneMatch,
  phanLoaiLoiR2,
  taoPhienHuy,
  type PhienHuy,
} from "@/lib/scorm/luong-r2";
import { giaHanScormTicket, verifyScormTicket } from "@/lib/scorm/ticket";
import { getR2Client, getR2Bucket } from "@/lib/storage/r2-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Segment nguy hiểm: rỗng, ".", "..", backslash, "/" lọt trong segment (`%2F` đã giải mã), NUL → traversal/absolute. */
function isUnsafeSegments(segs: string[]): boolean {
  if (segs.length === 0) return true;
  for (const s of segs) {
    if (!s || s === "." || s === "..") return true;
    if (s.includes("\\") || s.includes("/") || s.includes("\0")) return true;
  }
  return false;
}

type NguCanhVe = {
  queryToken: string | null;
  token: string;
  payload: NonNullable<ReturnType<typeof verifyScormTicket>["payload"]>;
  /** URL kiểu cũ (không mã gói): chính sách cache khác — xem `chinhSachCache`. */
  urlKieuCu: boolean;
  /**
   * Vé GIA HẠN sẽ đặt vào cookie — đã tính SẴN (một lần/request) và đã được hỏi phiên SỐNG ở DB. `null` = không gia hạn
   * (vé còn lâu / quá trần / phiên không xác nhận được). Hop đầu (`?t`) không dùng trường này.
   */
  veGiaHan: string | null;
  /** Số đo cho `Server-Timing` (không phải vé): các nhánh phục vụ ghi nguồn byte + thời gian vào đây, `ganServerTiming` gắn header MỘT lần. */
  tm: DoThoiGian;
};

/** Để log: gói + khoá TƯƠNG ĐỐI trong gói + mốc thời gian. KHÔNG chứa vé/cookie/query. */
type NguCanhLog = { packageId: string; rel: string; t0: number };

/** Lỗi/chặn: không để trình duyệt hay proxy giữ (404 mặc định có thể bị cache theo heuristic). */
function loi(status: number, text: string | null, extra: Record<string, string> = {}): NextResponse {
  return new NextResponse(text, { status, headers: { "Cache-Control": "private, no-store", ...extra } });
}

/** 403 do vé/phiên/đường dẫn: đếm + log mức thấp (nén dòng lặp), không bao giờ log vé. */
function chan403(lyDo: string, packageId: string | null): NextResponse {
  ghiLogAsset(`403:${lyDo}`, "warn", `403 ${lyDo}`, { packageId });
  return loi(403, "Forbidden");
}

function dauCache(v: NguCanhVe): Record<string, string> {
  const c = chinhSachCache({ coQueryToken: Boolean(v.queryToken), urlKieuCu: v.urlKieuCu });
  return c.vary ? { "Cache-Control": c.cacheControl, Vary: c.vary } : { "Cache-Control": c.cacheControl };
}

/**
 * `no-transform` cho phản hồi 206. Lớp nén (`compression`) của Next bỏ qua khi Cache-Control có `no-transform` nhưng KHÔNG hề xét
 * `Range`/206 — không có chỉ thị này nó gzip lại một phần 206 (js/css/json/html) mà vẫn giữ `Content-Range` của bản chưa nén. CỤC BỘ ở
 * route: `chinhSachCache` (lib/scorm/cache-asset.ts) giữ nguyên hợp đồng cho 200/304.
 */
function chiThiKhongBienDoi(cacheControl: string | undefined): string {
  return cacheControl ? `${cacheControl}, no-transform` : "no-transform";
}

/** Đặt cookie vé THEO GÓI: hop đầu (có ?t) hoặc khi vé sắp hết và còn trong trần gia hạn. */
function datCookieVe(res: NextResponse, v: NguCanhVe): void {
  const veMoi = v.queryToken ? v.token : v.veGiaHan;
  if (!veMoi) return;
  res.cookies.set(SCORM_COOKIE_VE, veMoi, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: cookiePathChoGoi(v.payload.packageId),
    maxAge: 600,
  });
}

/** Ghi nguồn byte của phản hồi thành công + thời gian từ lúc bắt đầu chạm nguồn (đĩa/R2). Gọi ngay trước khi dựng phản hồi. */
function ghiNguon(v: NguCanhVe, nguon: NguonByte): void {
  v.tm.nguon = nguon;
  if (v.tm.batDauNguon !== undefined) v.tm.msNguon = performance.now() - v.tm.batDauNguon;
}

/** Gắn `Server-Timing` cho phản hồi THÀNH CÔNG (200/206/304) có nguồn đã biết. Nhánh lỗi/chặn không bao giờ mang header này. */
function ganServerTiming(res: NextResponse, tm: DoThoiGian, tp0: number): NextResponse {
  if (res.status !== 200 && res.status !== 206 && res.status !== 304) return res;
  const gt = tinhServerTiming(tm, performance.now() - tp0);
  if (gt) res.headers.set("Server-Timing", gt);
  return res;
}

type MetaTep = { contentType: string; etag: string | null; lastModified: string | null; size: number };

/** Header của 200/206 — dùng chung cho đĩa, R2 HEAD và (qua `Content-Length` riêng) R2 GET. */
function headerTep(meta: MetaTep, kq: ReturnType<typeof docRange>, v: NguCanhVe): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": meta.contentType,
    "Accept-Ranges": "bytes",
    ...dauCache(v),
  };
  if (meta.etag) h.ETag = meta.etag;
  if (meta.lastModified) h["Last-Modified"] = meta.lastModified;
  if (kq.loai === "mot-phan") {
    h["Content-Range"] = kq.contentRange;
    h["Content-Length"] = String(kq.contentLength);
    h["Cache-Control"] = chiThiKhongBienDoi(h["Cache-Control"]);
  } else {
    h["Content-Length"] = String(meta.size);
  }
  return h;
}

/** `Range` dùng thật: bỏ nếu `If-Range` cho biết trình duyệt đang giữ bản khác (RFC 9110 §13.1.5) ⇒ trả cả tệp 200. */
function rangeDung(req: NextRequest, etag: string | null, lastModified: string | null): string | null {
  return ifRangeKhop(req.headers.get("if-range"), etag, lastModified) ? req.headers.get("range") : null;
}

function tra304(v: NguCanhVe, etag: string | null): NextResponse {
  const r = new NextResponse(null, { status: 304, headers: { ...dauCache(v), ...(etag ? { ETag: etag } : {}) } });
  datCookieVe(r, v);
  return r;
}

/**
 * Phục vụ từ ĐĨA: ETag/304, Range (206/416), If-Range, HEAD; tệp nhỏ nạp RAM, lớn truyền dòng có backpressure.
 * Trả null khi đệm vừa hỏng/bị dọn giữa chừng ⇒ caller rơi về R2 (chưa gửi byte nào nên rơi về vẫn an toàn).
 */
async function phucVuTuDia(
  req: NextRequest,
  key: string,
  meta: MetaDem,
  v: NguCanhVe,
  laHead: boolean,
  nguCanhLog: NguCanhLog,
): Promise<NextResponse | null> {
  if (khopIfNoneMatch(req.headers.get("if-none-match"), meta.etag)) {
    ghiNguon(v, "disk");
    return tra304(v, meta.etag);
  }
  const kq = docRange(rangeDung(req, meta.etag, meta.lastModified), meta.size);
  if (kq.loai === "khong-thoa-man") return loi(416, null, { "Content-Range": kq.contentRange });
  const headers = headerTep(meta, kq, v);
  const status = kq.loai === "mot-phan" ? 206 : 200;

  let body: BodyInit | null = null;
  if (!laHead) {
    try {
      if (kq.loai === "mot-phan") {
        body = boLuongNode(await moLuongDemAnToan(key, { start: kq.start, end: kq.end }, meta.size), { signal: req.signal });
      } else if (meta.size <= NGUONG_DEM_BYTE) {
        const buf = await docToanBoDem(key);
        if (buf.length !== meta.size) throw new Error("tệp đệm đổi kích thước");
        body = buf as unknown as BodyInit; // Buffer là Uint8Array hợp lệ lúc chạy; lib.dom của TS chưa nhận kiểu Buffer<ArrayBufferLike>
      } else {
        body = boLuongNode(await moLuongDemAnToan(key, undefined, meta.size), { signal: req.signal });
      }
    } catch (e) {
      ghiLogAsset("dem-dia-hong", "warn", "đệm đĩa không mở được — rơi về R2", {
        ...nguCanhLog,
        ten: (e as { name?: string })?.name,
        ms: Date.now() - nguCanhLog.t0,
      });
      return null;
    }
  }
  ghiNguon(v, "disk");
  const res = new NextResponse(body, { status, headers });
  datCookieVe(res, v);
  return res;
}

/** Phản hồi 200 cho tệp NHỎ đã có bytes trong RAM (từ lượt tải gộp). Mọi người chờ cùng một lượt dùng chung hàm này. */
function traTepNhoDaGop(tep: TepNho, prefix: string, v: NguCanhVe, nguCanhLog: NguCanhLog, ifNoneMatch: string | null): NextResponse {
  // Trình duyệt xác nhận lại tệp đã hết `max-age`: lượt tải gộp là GET KHÔNG điều kiện (dùng chung cho mọi người chờ) nên so ETag ở đây.
  if (khopIfNoneMatch(ifNoneMatch, tep.meta.etag)) return tra304(v, tep.meta.etag);
  const headers: Record<string, string> = {
    "Content-Type": tep.meta.contentType,
    "Accept-Ranges": "bytes",
    ...dauCache(v),
    "Content-Length": String(tep.bytes.length),
  };
  if (tep.meta.etag) headers.ETag = tep.meta.etag;
  if (tep.meta.lastModified) headers["Last-Modified"] = tep.meta.lastModified;
  const msHeader = Date.now() - nguCanhLog.t0;
  if (msHeader > 2_000) ghiLogAsset("r2-cham", "warn", "R2 lên header chậm", { ...nguCanhLog, ms: msHeader });
  const res = new NextResponse(tep.bytes as unknown as BodyInit, { status: 200, headers });
  datCookieVe(res, v);
  void lamNongGoi(prefix);
  return res;
}

/** Gọi R2 với hạn chờ tới khi có header. Thân (luồng) KHÔNG bị hạn chờ cắt (đã có canh treo riêng ở `boLuongNode`). */
async function layTuR2<T>(huy: PhienHuy, gui: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const hen = setTimeout(() => huy.hetHan(), HAN_CHO_R2_MS);
  try {
    return await gui(huy.signal);
  } finally {
    clearTimeout(hen);
  }
}

/** Phản hồi lỗi R2 → HTTP, kèm log có cấu trúc. */
async function traLoiR2(
  e: unknown,
  huy: PhienHuy,
  req: NextRequest,
  key: string,
  v: NguCanhVe,
  nguCanhLog: NguCanhLog,
  coRange: boolean,
): Promise<NextResponse> {
  // Người xem tự ngắt (đóng tab, trình duyệt huỷ video): không phải lỗi hạ tầng, không ai nhận phản hồi này.
  if (huy.lyDo() === "client") return new NextResponse(null, { status: 499 });
  const ma = huy.lyDo() === "het-han" ? 504 : phanLoaiLoiR2(e);
  const ten = (e as { name?: string } | null)?.name;
  const ms = Date.now() - nguCanhLog.t0;
  if (ma === 304) {
    ghiNguon(v, "r2-stream");
    const inm = req.headers.get("if-none-match");
    return tra304(v, inm && !inm.includes(",") && inm.trim() !== "*" ? inm.trim() : null);
  }
  if (ma === 416) {
    // R2 không báo dung lượng trong lỗi; hỏi HEAD (hiếm — chỉ khi client xin quá cuối) để trả `Content-Range: bytes */size` đúng RFC.
    const size = await dungLuongTuR2(key);
    return loi(416, null, size === null ? {} : { "Content-Range": `bytes */${size}` });
  }
  if (ma === 404) {
    ghiLogAsset("404", "warn", "R2 không có khoá", { ...nguCanhLog, ten, ms });
    return loi(404, "Not found");
  }
  // Lỗi hạ tầng (R2 chậm/ngắt) — ghi lại để thấy được, và ĐỪNG giả làm 404 (client sẽ không thử lại). Cũng báo cho làm nóng nghỉ.
  ghiLogAsset(`r2:${ma}:${ten ?? "?"}`, "error", "R2 lỗi", { ...nguCanhLog, ma, ten, ms, coRange });
  ghiNhanLoiR2();
  return loi(ma === 504 ? 504 : 502, "Upstream error");
}

/** Dung lượng tệp trên R2 bằng HEAD (best-effort, hạn chờ ngắn). null nếu không biết. */
async function dungLuongTuR2(key: string): Promise<number | null> {
  const huy = taoPhienHuy();
  const hen = setTimeout(() => huy.hetHan(), 5_000);
  try {
    const r = await getR2Client().send(new HeadObjectCommand({ Bucket: getR2Bucket(), Key: key }), { abortSignal: huy.signal });
    return typeof r.ContentLength === "number" ? r.ContentLength : null;
  } catch {
    return null;
  } finally {
    clearTimeout(hen);
  }
}

const laLuongNode = (b: unknown): b is Readable =>
  typeof b === "object" && b !== null && typeof (b as Readable).pipe === "function" && typeof (b as Readable).on === "function";

/** Phục vụ từ R2: GET (Range/If-None-Match chuyển thẳng) hoặc HEAD (chỉ header, KHÔNG tải thân). */
async function phucVuTuR2(
  req: NextRequest,
  key: string,
  prefix: string,
  v: NguCanhVe,
  laHead: boolean,
  nguCanhLog: NguCanhLog,
): Promise<NextResponse> {
  const rangeGoc = rangeChuyenTiep(req.headers.get("range"));
  const ifNoneMatch = req.headers.get("if-none-match");
  const ifRange = req.headers.get("if-range");
  // `If-Range` dạng ETag mạnh ⇒ nhờ R2 kiểm hộ (IfMatch): lệch ⇒ 412 ⇒ lấy lại cả tệp (đúng RFC), không kéo nhầm khoảng của bản khác.
  const ifMatch = rangeGoc && ifRange && ifRange.trim().startsWith('"') ? ifRange.trim() : undefined;
  const huy = taoPhienHuy(req.signal);

  try {
    if (laHead) {
      const dau = await layTuR2(huy, (signal) =>
        getR2Client().send(new HeadObjectCommand({ Bucket: getR2Bucket(), Key: key, ...(ifNoneMatch ? { IfNoneMatch: ifNoneMatch } : {}) }), { abortSignal: signal }),
      );
      const meta: MetaTep = {
        contentType: dau.ContentType ?? "application/octet-stream",
        etag: dau.ETag ?? null,
        lastModified: dau.LastModified ? dau.LastModified.toUTCString() : null,
        size: Number(dau.ContentLength ?? 0),
      };
      const kq = docRange(rangeDung(req, meta.etag, meta.lastModified), meta.size);
      if (kq.loai === "khong-thoa-man") return loi(416, null, { "Content-Range": kq.contentRange });
      ghiNguon(v, "r2-head");
      const res = new NextResponse(null, { status: kq.loai === "mot-phan" ? 206 : 200, headers: headerTep(meta, kq, v) });
      datCookieVe(res, v);
      return res;
    }

    // GỘP lượt trượt đệm: chỉ GET tệp NHỎ, không Range, và chỉ khi đệm đĩa BẬT (SCORM_CACHE_OFF=1 là công tắc lùi — tắt luôn cả gộp).
    // `If-None-Match` ĐƯỢC gộp (lượt tải không điều kiện, so ETag cục bộ trong `traTepNhoDaGop`): giờ vào lớp sau một lần triển khai đệm nguội,
    // trình duyệt của giáo viên quay lại đều mang `If-None-Match` cho tệp hết `max-age` — nếu mỗi cái đi thẳng R2 thì pool × độ trễ R2 lại là
    // nút thắt (304 không nhanh hơn 200 ở pool). Hàng rào vé/phiên/mã gói/đường dẫn nội bộ đã chạy ở `xuLy` cho TỪNG request; ở đây chỉ chọn
    // NGUỒN byte. Tệp hoá ra lớn (hoặc đã biết là lớn) ⇒ rơi xuống đường truyền dòng riêng ngay dưới (có điều kiện chuyển thẳng cho R2).
    if (!rangeGoc && demDangBat()) {
      // Hỏi TRƯỚC khi gọi (không có `await` xen giữa) để biết mình là bên MỞ lượt tải hay bên CHỜ lượt của người khác — chỉ để quan sát.
      const laBenCho = coLuotTaiNhoDangBay(key);
      const gop = await taiTepNhoDungChung(key, { signal: req.signal });
      if (gop.loai === "nho") {
        ghiNguon(v, laBenCho ? "r2-coalesced" : "r2-leader");
        return traTepNhoDaGop(gop, prefix, v, nguCanhLog, ifNoneMatch);
      }
    }

    const lay = (range: string | null, dieuKien: boolean) =>
      layTuR2(huy, (signal) =>
        getR2Client().send(
          new GetObjectCommand({
            Bucket: getR2Bucket(),
            Key: key,
            ...(range ? { Range: range } : {}),
            ...(dieuKien && ifMatch ? { IfMatch: ifMatch } : {}),
            ...(ifNoneMatch && !range ? { IfNoneMatch: ifNoneMatch } : {}),
          }),
          { abortSignal: signal },
        ),
      );
    let range = rangeGoc;
    let obj;
    try {
      obj = await lay(range, true);
    } catch (e) {
      if (!(range && ifMatch && phanLoaiLoiR2(e) === 412)) throw e;
      range = null; // tệp đã đổi so với bản trình duyệt giữ ⇒ trả cả tệp
      obj = await lay(null, false);
    }
    if (!obj.Body) return loi(404, "Not found");

    const dai = Number(obj.ContentLength ?? 0);
    const laKhoang = Boolean(range && obj.ContentRange);
    const headers: Record<string, string> = {
      "Content-Type": obj.ContentType ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      // Hop đầu mang vé trên URL: đừng để trình duyệt/proxy giữ bản có vé. Asset con: cache riêng tư như cũ.
      ...dauCache(v),
    };
    if (obj.ETag) headers.ETag = obj.ETag;
    if (obj.LastModified) headers["Last-Modified"] = obj.LastModified.toUTCString();
    if (laKhoang) {
      headers["Content-Range"] = String(obj.ContentRange);
      headers["Cache-Control"] = chiThiKhongBienDoi(headers["Cache-Control"]);
    }

    // Tệp nhỏ & không phải khoảng: nạp RAM (có trần byte + canh treo) ⇒ socket R2 được trả ngay. Còn lại truyền dòng có backpressure.
    let body: BodyInit;
    const nguon: unknown = obj.Body;
    if (!laKhoang && dai > 0 && dai <= NGUONG_DEM_BYTE && laLuongNode(nguon)) {
      const bytes = await docHetLuong(nguon, { toiDaByte: NGUONG_DEM_BYTE, signal: huy.signal });
      headers["Content-Length"] = String(bytes.length);
      body = bytes as unknown as BodyInit;
      // Ghi xuống đĩa SAU khi đã có byte (không chặn phản hồi, không ném).
      void ghiDemTuBytes(key, bytes, {
        contentType: obj.ContentType ?? "application/octet-stream",
        etag: obj.ETag ?? null,
        lastModified: obj.LastModified ? obj.LastModified.toUTCString() : null,
      });
    } else {
      if (dai > 0) headers["Content-Length"] = String(dai);
      body = laLuongNode(nguon)
        ? boLuongNode(nguon, {
            signal: huy.signal,
            khiXong: (kq, e) => {
              // Cắt giữa thân (header đã đi): chỉ log được, không đổi được status. "huy" = client ngắt, không phải lỗi.
              if (kq !== "loi") return;
              const ten = (e as { name?: string } | null)?.name;
              ghiLogAsset(`than-r2:${ten ?? "?"}`, "error", "luồng R2 đứt giữa thân", { ...nguCanhLog, ten, ms: Date.now() - nguCanhLog.t0 });
              if (ten === "TimeoutError") ghiNhanLoiR2();
            },
          })
        : (nguon as { transformToWebStream: () => ReadableStream }).transformToWebStream();
    }

    // R2 lên header chậm (nhưng chưa tới hạn chờ) vẫn đáng thấy: đó là số đo "R2 từ VPS", log nén dòng.
    const msHeader = Date.now() - nguCanhLog.t0;
    if (msHeader > 2_000) ghiLogAsset("r2-cham", "warn", "R2 lên header chậm", { ...nguCanhLog, ms: msHeader });

    ghiNguon(v, "r2-stream");
    const res = new NextResponse(body, { status: laKhoang ? 206 : 200, headers });
    // Cookie vé THEO GÓI (hop đầu / sắp hết vé). Cookie cũ không ghi nữa.
    datCookieVe(res, v);
    // Trượt đệm: kích hoạt LÀM NÓNG cả gói ở nền (tệp lớn/video + các tệp chưa có) — lượt sau phục vụ từ đĩa.
    void lamNongGoi(prefix);
    return res;
  } catch (e) {
    return traLoiR2(e, huy, req, key, v, nguCanhLog, Boolean(rangeGoc));
  }
}

async function xuLy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }, laHead: boolean): Promise<NextResponse> {
  const t0 = Date.now();
  const tp0 = performance.now(); // độ phân giải dưới ms cho Server-Timing (t0 dùng cho log, làm tròn tới mili giây)
  if (!isScormEnabled()) {
    return loi(404, "Not found");
  }

  // 1. Vé: query ?t (hop đầu) hoặc cookie theo gói (asset con relative — đã mất query), rồi cookie cũ cho vé đang bay.
  const queryToken = req.nextUrl.searchParams.get("t");
  const token =
    queryToken ??
    req.cookies.get(SCORM_COOKIE_VE)?.value ??
    req.cookies.get(SCORM_COOKIE_VE_CU)?.value ??
    "";
  const ve = verifyScormTicket(token);
  if (!ve.ok || !ve.payload) {
    return chan403(token ? "ve-sai-hoac-het-han" : "khong-ve", null);
  }
  const payload = ve.payload;

  // 2. Buộc vé theo user đăng nhập — chặn chia sẻ link + PARENT/HV.
  const session = await auth();
  if (!session?.user || session.user.id !== payload.userId) {
    return chan403("phien", payload.packageId);
  }

  // 3. Path traversal guard + mã gói trong URL phải KHỚP vé (đường dẫn kiểu cũ không có mã gói vẫn được — vé đang bay).
  const { path } = await ctx.params;
  if (isUnsafeSegments(path)) {
    return chan403("duong-dan", payload.packageId);
  }
  const { maGoiTrongUrl, rel } = tachDuongDanAsset(path);
  if (maGoiTrongUrl !== null && maGoiTrongUrl !== payload.packageId) {
    return chan403("ma-goi-khac", payload.packageId);
  }
  if (rel.length === 0) {
    return loi(404, "Not found");
  }
  // 3b. Tệp NỘI BỘ cùng prefix (zip gốc, `_src/`) — không bao giờ phục vụ, trả 404 như thể không tồn tại. Chạy trước đệm/R2.
  if (laDuongDanNoiBo(rel)) {
    ghiLogAsset("404-noi-bo", "warn", "chặn đường dẫn nội bộ của gói", { packageId: payload.packageId, rel: rel.join("/") });
    return loi(404, "Not found");
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
      return loi(404, "Not found");
    }
    storagePrefix = pkg.storagePrefix;
  }
  const prefix = storagePrefix.endsWith("/") ? storagePrefix : `${storagePrefix}/`;
  const key = `${prefix}${rel.join("/")}`;

  // 4a. GIA HẠN VÉ TRƯỢT cần phiên còn SỐNG ở DB. Route này chỉ tin JWT (`auth()` ở trên) nên không có bước này thì tài khoản bị khoá giữa
  //     buổi vẫn đọc asset tới hết trần 3 giờ. Chỉ hỏi khi thật sự sắp cấp cookie mới (≈ 1 lần/5 phút/vé), KHÔNG mỗi tệp; hop đầu (`?t`)
  //     mang vé vừa cấp ngay sau kiểm quyền ở trang nên không gia hạn ở đây. `chet` ⇒ 403 (đúng như phiên bị cắt); `khong-ro` (DB chập) ⇒
  //     bỏ cookie mới nhưng vẫn phục vụ bằng vé còn hạn — không đổi một cú chập DB thành lỗi giả giữa buổi dạy.
  let veGiaHan: string | null = null;
  if (!queryToken) {
    veGiaHan = giaHanScormTicket(payload);
    if (veGiaHan) {
      // Nhấc ra khỏi closure: TypeScript không giữ phép thu hẹp `session.user` bên trong hàm lồng.
      const uid = session.user.id;
      const tv = session.user.tokenVersion;
      const song = await kiemPhienSongCoNho(`${uid}:${tv}`, async () => {
        const s = await requireLiveSession();
        return s?.user?.id === uid;
      });
      if (song === "chet") return chan403("phien-da-chet", payload.packageId);
      if (song === "khong-ro") veGiaHan = null;
    }
  }
  const tm: DoThoiGian = {};
  const nguCanh: NguCanhVe = { queryToken, token, payload, urlKieuCu: maGoiTrongUrl === null, veGiaHan, tm };
  // `rel` do người dùng gửi lên: cắt ngắn để một URL rác dài hàng KB không làm phình log.
  const nguCanhLog: NguCanhLog = { packageId: payload.packageId, rel: rel.join("/").slice(0, 200), t0 };

  // Hết hàng rào: từ đây là thời gian "chạm nguồn". `pre` = vé + phiên + mã gói + đường dẫn (+ DB nếu vé cũ / hỏi phiên sống khi gia hạn vé).
  tm.msTruoc = performance.now() - tp0;
  tm.batDauNguon = performance.now();

  // 4b. ĐỆM ĐĨA: có sẵn thì phục vụ ngay (không chạm R2). Mọi hàng rào ở trên đã chạy.
  const meta = await docMetaDem(key);
  if (meta) {
    const tuDia = await phucVuTuDia(req, key, meta, nguCanh, laHead, nguCanhLog);
    if (tuDia) return ganServerTiming(tuDia, tm, tp0);
    // Đệm vừa hỏng/bị dọn giữa chừng ⇒ rơi về R2: đo lại từ đây để `src` là thời gian của nguồn THẬT SỰ phục vụ.
    tm.nguon = undefined;
    tm.batDauNguon = performance.now();
  }

  // 5. Điều kiện + Range chuyển thẳng cho R2 (một khoảng hợp lệ; còn lại trả cả tệp).
  return ganServerTiming(await phucVuTuR2(req, key, prefix, nguCanh, laHead, nguCanhLog), tm, tp0);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return xuLy(req, ctx, false);
}

/** HEAD tường minh: cùng hàng rào với GET, nhưng chỉ lấy header (HeadObject / meta đĩa) — không kéo thân từ R2. */
export async function HEAD(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return xuLy(req, ctx, true);
}
