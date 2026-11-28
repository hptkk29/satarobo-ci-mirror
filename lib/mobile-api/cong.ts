import type { NextResponse } from "next/server";
import type { ZodType } from "zod";

import { fail, ok } from "@/lib/api/response";
import { isMobileApiEnabled } from "@/lib/flags";
import { ipChoRateLimit } from "@/lib/security/client-ip";

import { baoLoiKhongLuongTruoc } from "./bao-loi-5xx";
import { kiemCheDoHocSinh } from "./che-do-hoc-sinh-thuan";
import { chanNeuCanQuyDinh, kiemHocVienCuaPhuHuynh, type MaHocVienDaKiem } from "./so-huu";
import { LoiApiMobile, xacThucAccess, type NguCanh, type NguoiGoi } from "./xac-thuc/dich-vu";

/**
 * CỔNG CHUNG của API di động — route handler chỉ gọi hàm ở đây rồi gọi dịch vụ.
 *   1. Cờ `MOBILE_API_ENABLED` tắt ⇒ 404 (như thể endpoint không tồn tại).
 *   2. Đọc thân JSON + kiểm lược đồ ⇒ 400 VALIDATION (không lộ chi tiết nội bộ).
 *   3. (Endpoint đã đăng nhập) xác thực access token qua `xacThucAccess` (kiểm phiên, tokenVersion, phụ huynh thuần).
 *   4. Mọi lỗi đổi về khuôn chuẩn `{ ok:false, error:{code,message,requestId} }`; không bao giờ trả stack / băm / token.
 * Mọi phản hồi mang `Cache-Control: no-store`.
 */
const KHONG_LUU = { "Cache-Control": "no-store" } as const;

export function nguCanhYeuCau(req: Request): NguCanh {
  return { ip: ipChoRateLimit(req.headers), now: new Date() };
}

export function motMobileTat(): NextResponse | null {
  return isMobileApiEnabled() ? null : fail("NOT_FOUND", "Không tìm thấy.", { status: 404, headers: KHONG_LUU });
}

/**
 * Đọc thân JSON cho các route CỬA XÁC THỰC (login/refresh/logout + 4 route OTP — người gọi CHƯA có token). SEC-03 (25/11/2026): bản cũ gọi `req.json()` KHÔNG TRẦN ⇒ một
 * yêu cầu chưa đăng nhập đọc được thân lớn tuỳ ý vào RAM. Nay: chặn sớm bằng `Content-Length` (rẻ, chưa đọc gì) RỒI đọc luồng có trần `THAN_TOI_DA_BYTE` (thân chunked/khai
 * dối độ dài cũng bị cắt khi vượt) — cùng bộ đọc với các route đã đăng nhập. Vượt ⇒ 413 `PAYLOAD_TOO_LARGE`; JSON hỏng/lược đồ sai ⇒ 400 như cũ.
 */
export async function docThanJson<T>(req: Request, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  const lon = chanThanQuaLon(req);
  if (lon) return { ok: false, res: lon };
  return docThanCoTran(req, schema);
}

/** Trần thân JSON của API di động (byte). Mọi lược đồ thật đều nhỏ hơn nhiều (tin nhắn ≤ vài nghìn ký tự); tệp đi qua URL ký, không qua thân JSON. */
export const THAN_TOI_DA_BYTE = 256 * 1024;

/**
 * Chặn THÂN QUÁ LỚN bằng tiêu đề `Content-Length` — rẻ, KHÔNG đọc thân, KHÔNG chạm DB nên chạy an toàn TRƯỚC xác thực
 * (không lộ gì về tài nguyên nào, và giữ lớp chống DoS cho đường chưa đăng nhập). Thân chunked/không khai độ dài chỉ bị ĐỌC sau xác thực,
 * qua `docThanCoTran` (cắt khi vượt trần) — yêu cầu chưa đăng nhập không bao giờ bị đọc thân.
 */
export function chanThanQuaLon(req: Request): NextResponse | null {
  const cl = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(cl) && cl > THAN_TOI_DA_BYTE) {
    return fail("PAYLOAD_TOO_LARGE", "Yêu cầu quá lớn.", { status: 413, headers: KHONG_LUU });
  }
  return null;
}

/**
 * Đọc thân VĂN BẢN có TRẦN (đọc luồng, DỪNG khi vượt `THAN_TOI_DA_BYTE`) — không bao giờ đọc hết vào RAM rồi mới cắt. Vượt ⇒ 413. Không có thân ⇒ `""`.
 * CHỈ gọi sau xác thực. Route có thân TUỲ CHỌN dùng thẳng hàm này (cùng `chanThanQuaLon`); route thân bắt buộc đi qua `docThanCoTran`.
 */
export async function docVanBanCoTran(req: Request): Promise<{ ok: true; text: string } | { ok: false; res: NextResponse }> {
  let text = "";
  try {
    const reader = req.body?.getReader();
    if (reader) {
      const dec = new TextDecoder();
      let tong = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        tong += value.byteLength;
        if (tong > THAN_TOI_DA_BYTE) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, res: fail("PAYLOAD_TOO_LARGE", "Yêu cầu quá lớn.", { status: 413, headers: KHONG_LUU }) };
        }
        text += dec.decode(value, { stream: true });
      }
      text += dec.decode();
    }
  } catch {
    return { ok: false, res: fail("VALIDATION", "Yêu cầu không hợp lệ.", { status: 400, headers: KHONG_LUU }) };
  }
  return { ok: true, text };
}

/** Đọc thân JSON có TRẦN rồi kiểm lược đồ. CHỈ gọi sau xác thực (xem `chay*CoThan`). */
async function docThanCoTran<T>(req: Request, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  const doc = await docVanBanCoTran(req);
  if (!doc.ok) return doc;
  let raw: unknown;
  try {
    raw = JSON.parse(doc.text);
  } catch {
    return { ok: false, res: fail("VALIDATION", "Yêu cầu không hợp lệ.", { status: 400, headers: KHONG_LUU }) };
  }
  const kq = schema.safeParse(raw);
  if (!kq.success) {
    const dau = kq.error.issues[0];
    return {
      ok: false,
      res: fail("VALIDATION", dau?.message || "Yêu cầu không hợp lệ.", { status: 400, field: dau?.path.join(".") || undefined, headers: KHONG_LUU }),
    };
  }
  return { ok: true, data: kq.data };
}

export function traLoi(e: unknown): NextResponse {
  if (e instanceof LoiApiMobile) {
    return fail(e.code, e.message, {
      status: e.status,
      headers: e.retryAfterGiay ? { ...KHONG_LUU, "Retry-After": String(e.retryAfterGiay) } : KHONG_LUU,
      ...(e.maChiTiet ? { maChiTiet: e.maChiTiet } : {}),
      ...(e.chiTiet !== undefined ? { chiTiet: e.chiTiet } : {}),
    });
  }
  if (process.env.VITEST) console.error("[mobile-api] lỗi không lường trước:", e); // chỉ khi chạy kiểm thử
  // Lỗi không lường trước: không lộ chi tiết cho app. (Không ghi thân yêu cầu, token hay định danh vào log.)
  // SEC-11: nhưng KHÔNG câm ở máy chủ — báo Sentry + một dòng log đếm được, `requestId` KHỚP cái trả cho app.
  const requestId = crypto.randomUUID();
  baoLoiKhongLuongTruoc(e, requestId);
  return fail("SERVER", "Có lỗi xảy ra. Vui lòng thử lại.", { status: 500, requestId, headers: KHONG_LUU });
}

export function traThanhCong<T>(data: T): NextResponse {
  return ok(data, { headers: KHONG_LUU });
}

/** Chạy một endpoint ĐÃ ĐĂNG NHẬP: cờ → access token → handler. */
export async function chayDaDangNhap(req: Request, handler: (nguoi: NguoiGoi, ctx: NguCanh) => Promise<NextResponse>): Promise<NextResponse> {
  const tat = motMobileTat();
  if (tat) return tat;
  const ctx = nguCanhYeuCau(req);
  try {
    const nguoi = await xacThucAccess(req.headers.get("authorization"), ctx);
    // H-S3: phiên ở CHẾ ĐỘ HỌC SINH chỉ đi được vào danh sách học sinh được xem (mặc định từ chối) — ép ở máy chủ, không tin app.
    const cd = kiemCheDoHocSinh({ pathname: new URL(req.url).pathname, method: req.method, hocSinhId: nguoi.hocSinhId });
    if (!cd.ok) {
      throw new LoiApiMobile("FORBIDDEN", 403, cd.ma === "KHAC_HOC_SINH" ? "Đang ở chế độ học sinh — không xem được học viên khác." : "Đang ở chế độ học sinh — ba mẹ nhập mã để mở phần này.");
    }
    return await handler(nguoi, ctx);
  } catch (e) {
    return traLoi(e);
  }
}

/**
 * Chạy một endpoint THEO HỌC VIÊN (cổng C): cờ → access token → cổng quy định (`POLICY_REQUIRED`) → kiểm sở hữu (studentId KHÔNG được tin) → handler.
 * Học viên của gia đình khác / không tồn tại / đã xoá mềm ⇒ cùng một `404 NOT_FOUND`. Handler chỉ nhận `MaHocVienDaKiem`.
 */
export async function chayTheoHocVien(
  req: Request,
  studentId: string,
  handler: (hs: MaHocVienDaKiem, nguoi: NguoiGoi, ctx: NguCanh) => Promise<NextResponse>,
): Promise<NextResponse> {
  return chayDaDangNhap(req, async (nguoi, ctx) => {
    await chanNeuCanQuyDinh(nguoi.userId);
    const hs = await kiemHocVienCuaPhuHuynh(nguoi.userId, studentId);
    return handler(hs, nguoi, ctx);
  });
}

/** Chạy một endpoint của PHỤ HUYNH (không theo học viên) qua cổng quy định. */
export async function chayChoPhuHuynh(req: Request, handler: (nguoi: NguoiGoi, ctx: NguCanh) => Promise<NextResponse>): Promise<NextResponse> {
  return chayDaDangNhap(req, async (nguoi, ctx) => {
    await chanNeuCanQuyDinh(nguoi.userId);
    return handler(nguoi, ctx);
  });
}

// ───────── Cổng CÓ THÂN (V8.17 G1): xác thực TRƯỚC, đọc/kiểm thân SAU ─────────
// Thứ tự: cờ → (Content-Length quá lớn) → access token → chế độ học sinh → cổng quy định / sở hữu → ĐỌC THÂN + lược đồ → handler.
// Phiên thiếu/hết hạn/bị thu hồi luôn nhận 401 dù thân sai; học viên của nhà khác luôn nhận 404 dù thân sai; chỉ người ĐÃ được phép mới thấy 400 VALIDATION.

/** Endpoint ĐÃ ĐĂNG NHẬP có thân JSON. */
export async function chayDaDangNhapCoThan<T>(
  req: Request,
  schema: ZodType<T>,
  handler: (nguoi: NguoiGoi, ctx: NguCanh, than: T) => Promise<NextResponse>,
): Promise<NextResponse> {
  const tat = motMobileTat();
  if (tat) return tat;
  const lon = chanThanQuaLon(req);
  if (lon) return lon;
  return chayDaDangNhap(req, async (nguoi, ctx) => {
    const than = await docThanCoTran(req, schema);
    if (!than.ok) return than.res;
    return handler(nguoi, ctx, than.data);
  });
}

/** Endpoint của PHỤ HUYNH (qua cổng quy định) có thân JSON. */
export async function chayChoPhuHuynhCoThan<T>(
  req: Request,
  schema: ZodType<T>,
  handler: (nguoi: NguoiGoi, ctx: NguCanh, than: T) => Promise<NextResponse>,
): Promise<NextResponse> {
  const tat = motMobileTat();
  if (tat) return tat;
  const lon = chanThanQuaLon(req);
  if (lon) return lon;
  return chayChoPhuHuynh(req, async (nguoi, ctx) => {
    const than = await docThanCoTran(req, schema);
    if (!than.ok) return than.res;
    return handler(nguoi, ctx, than.data);
  });
}

/** Endpoint THEO HỌC VIÊN (quy định + sở hữu) có thân JSON. */
export async function chayTheoHocVienCoThan<T>(
  req: Request,
  studentId: string,
  schema: ZodType<T>,
  handler: (hs: MaHocVienDaKiem, nguoi: NguoiGoi, ctx: NguCanh, than: T) => Promise<NextResponse>,
): Promise<NextResponse> {
  const tat = motMobileTat();
  if (tat) return tat;
  const lon = chanThanQuaLon(req);
  if (lon) return lon;
  return chayTheoHocVien(req, studentId, async (hs, nguoi, ctx) => {
    const than = await docThanCoTran(req, schema);
    if (!than.ok) return than.res;
    return handler(hs, nguoi, ctx, than.data);
  });
}

/** Như `chayTheoHocVienCoThan` nhưng `studentId` NẰM TRONG THÂN (vd `student-mode/enter`): xác thực → đọc thân → cổng quy định → kiểm sở hữu. */
export async function chayTheoHocVienTrongThan<T>(
  req: Request,
  schema: ZodType<T>,
  layStudentId: (than: T) => string,
  handler: (hs: MaHocVienDaKiem, nguoi: NguoiGoi, ctx: NguCanh, than: T) => Promise<NextResponse>,
): Promise<NextResponse> {
  return chayDaDangNhapCoThan(req, schema, async (nguoi, ctx, than) => {
    await chanNeuCanQuyDinh(nguoi.userId);
    const hs = await kiemHocVienCuaPhuHuynh(nguoi.userId, layStudentId(than));
    return handler(hs, nguoi, ctx, than);
  });
}
