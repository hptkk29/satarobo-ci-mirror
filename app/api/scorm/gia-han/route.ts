// app/api/scorm/gia-han/route.ts — gia hạn CHỦ ĐỘNG vé mở SCORM/PDF (24/10/2026).
//
// Vì sao có: vé + cookie vé sống 10 phút. Route asset chỉ gia hạn khi CÓ request asset tới (trượt), nên giáo viên ngồi yên > 10 phút
// rồi mới trình chiếu tiếp (ảnh/video của slide nạp trễ) ăn 403 mà viewer câm. Viewer gọi route này định kỳ (≈ 4 phút khi tab hiện
// + ngay khi tab hiện lại) để đổi vé cũ lấy vé mới và đặt lại cookie theo gói. iframe dùng cookie nên KHÔNG cần tải lại iframe.
//
// POST { "ticket": string } → 200 { ok: true, ticket, expiresInSec } + Set-Cookie (cùng thuộc tính với route asset)
//                           → 401/403 { ok: false, reason: "phien" | "ve-sai" | "het-han-toi-da" | "nguon-goc" } · 400/413 · 429
// Mọi phản hồi (kể cả lỗi) là `Cache-Control: no-store`.
//
// Hàng rào, THEO THỨ TỰ (rẻ trước, đắt sau; mọi hàng rào đứng TRƯỚC phép ký vé):
//   cờ → cùng nguồn gốc → cỡ thân → phiên đăng nhập SỐNG → giới hạn tần suất → chữ ký vé → vé thuộc về CHÍNH người đang đăng nhập → trần tổng.
// Không dùng vé vĩnh viễn: vé mới bị KẸP trong trần `SCORM_GIA_HAN_TOI_DA_MS` tính từ lúc mở bài (mốc gốc được ghim trong vé). Hết trần
// ⇒ viewer báo "phiên hết hạn, tải lại trang" ⇒ trang mở bài kiểm quyền LẠI rồi cấp vé mới. Đánh đổi + mô hình đe doạ:
// docs/scorm-hieu-nang/bao-mat.md.
import { NextRequest, NextResponse } from "next/server";
import { requireLiveSession } from "@/lib/auth/live-session";
import { isScormEnabled } from "@/lib/flags";
import { rateLimit } from "@/lib/rate-limit";
import { SCORM_COOKIE_VE, tuyChonCookieVe } from "@/lib/scorm/asset-url";
import { giaHanVeChuDong, xacThucVeChoGiaHan } from "@/lib/scorm/ticket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Thân hợp lệ chỉ là `{"ticket":"…"}` (≈ 400–600 ký tự). Trần cứng để không ai đẩy thân lớn vào đường có HMAC. */
const THAN_TOI_DA_BYTE = 4096;
/** Viewer gọi ≈ 1 lượt/4 phút/tab; 30 lượt/phút/người là rộng mà vẫn chặn được vòng lặp lỗi. */
const GIA_HAN_TOI_DA_MOI_PHUT = 30;

type LyDo = "phien" | "ve-sai" | "het-han-toi-da" | "nguon-goc" | "dinh-dang" | "qua-lon" | "gioi-han";

function loi(status: number, reason: LyDo, extra: Record<string, string> = {}) {
  return NextResponse.json(
    { ok: false, reason },
    { status, headers: { "Cache-Control": "no-store", ...extra } },
  );
}

/**
 * Yêu cầu có đến từ CHÍNH trang của mình không? `Sec-Fetch-Site` do trình duyệt đặt (script không giả được) là căn cứ chính.
 * Trình duyệt cũ không gửi nó thì dựa vào `Origin` (POST luôn có) so với Host. Cả hai vắng ⇒ không phải trình duyệt đang chạy
 * viewer ⇒ từ chối. (Không so với origin cứng: admin.* và giaovien.* là hai nguồn gốc chạy chung một app.)
 */
function laCungNguonGoc(req: NextRequest): boolean {
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs) return sfs === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let hostOrigin: string;
  try {
    hostOrigin = new URL(origin).host;
  } catch {
    return false;
  }
  const hostMay = req.headers.get("host");
  // Proxy tin được (Caddy) đặt host khách gọi vào PHẦN TỬ CUỐI của x-forwarded-host.
  const dsChuyenTiep = (req.headers.get("x-forwarded-host") ?? "").split(",");
  const chuyenTiep = dsChuyenTiep[dsChuyenTiep.length - 1]?.trim() ?? "";
  return hostOrigin === hostMay || (chuyenTiep !== "" && hostOrigin === chuyenTiep);
}

/** Đọc thân theo luồng, dừng khi vượt trần (Content-Length có thể vắng hoặc nói dối). `null` ⇒ quá lớn. */
async function docThanGioiHan(req: NextRequest): Promise<string | null> {
  const khaiBao = Number(req.headers.get("content-length"));
  if (Number.isFinite(khaiBao) && khaiBao > THAN_TOI_DA_BYTE) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const manh: Uint8Array[] = [];
  let tong = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tong += value.byteLength;
    if (tong > THAN_TOI_DA_BYTE) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    manh.push(value);
  }
  return Buffer.concat(manh).toString("utf8");
}

export async function POST(req: NextRequest) {
  if (!isScormEnabled()) {
    return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  if (!laCungNguonGoc(req)) return loi(403, "nguon-goc");

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) return loi(400, "dinh-dang");
  const thanChu = await docThanGioiHan(req);
  if (thanChu === null) return loi(413, "qua-lon");
  let ve = "";
  try {
    const b = JSON.parse(thanChu) as unknown;
    if (b && typeof b === "object" && typeof (b as { ticket?: unknown }).ticket === "string") {
      ve = (b as { ticket: string }).ticket;
    }
  } catch {
    // rơi xuống kiểm `ve` rỗng
  }
  if (!ve) return loi(400, "dinh-dang");

  // Phiên đăng nhập là điều kiện CẦN: vé không có giá trị nếu thiếu phiên của đúng userId trong vé. Dùng phiên SỐNG (đối chiếu
  // isActive / deletedAt / tokenVersion với DB, như các route nhạy cảm khác): tài khoản bị khoá hoặc bị cắt phiên giữa buổi thì LẦN
  // GIA HẠN KẾ TIẾP thất bại (`phien`) thay vì tiếp tục kéo dài tới trần 3 giờ. 1 truy vấn / ≈ 4 phút / tab.
  const session = await requireLiveSession();
  const userId = session?.user?.id;
  if (!userId) return loi(401, "phien");

  const gioiHan = await rateLimit({
    key: `scorm:gia-han:${userId}`,
    max: GIA_HAN_TOI_DA_MOI_PHUT,
    windowMs: 60_000,
  });
  if (!gioiHan.success) {
    const giay = Math.max(1, Math.ceil((gioiHan.resetAt - Date.now()) / 1000));
    return loi(429, "gioi-han", { "Retry-After": String(giay) });
  }

  // Chữ ký vé (KHÔNG xét hạn — vé vừa hết hạn vẫn đổi được, miễn còn trong trần) rồi buộc theo phiên.
  const payload = xacThucVeChoGiaHan(ve);
  if (!payload) return loi(403, "ve-sai");
  if (payload.userId !== userId) return loi(403, "phien");

  const kq = giaHanVeChuDong(payload);
  if (!kq.ok) return loi(403, kq.reason);

  const res = NextResponse.json(
    { ok: true, ticket: kq.ticket, expiresInSec: kq.expiresInSec },
    { headers: { "Cache-Control": "no-store" } },
  );
  // Cùng tên + cùng thuộc tính với route asset (`tuyChonCookieVe` là nguồn chung); sống đúng bằng phần còn lại của vé đã kẹp trần.
  res.cookies.set(SCORM_COOKIE_VE, kq.ticket, tuyChonCookieVe(payload.packageId, kq.expiresInSec));
  return res;
}
