import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { ipChoRateLimit } from "@/lib/security/client-ip";
import { getSetting } from "@/lib/settings/service";
import { ingestIntakeLead } from "@/lib/lead/intake/ingest";
import { KHONG_CO_TIN_HIEU_NGUON } from "@/lib/nguon/tin-hieu";
import {
  mapSaleForm,
  SALE_FORM_HONEYPOT,
} from "@/lib/lead/intake/map-sale-form";
import { logWebhookDelivery } from "@/lib/lead/webhook";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { isLeadIntakeAuthRequired } from "@/lib/flags";
import { getStaffIdentity } from "@/lib/lead/intake/staff-identity";
import { pickEmployeeCode } from "@/lib/lead/intake/identity-override";
import { originCuaRequest } from "@/lib/http/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// NHẬN PHIẾU "Form nhập liên hệ từ Sale" — endpoint CŨ của biểu mẫu tĩnh.
//
// ⛔ 22/08/2026 — biểu mẫu tĩnh `sale.satarobo.vn/nhap-lieu.html` đã NGHỈ, thay
// bằng `satarobo.vn/nhap-khach-hang` (Server Action, có đăng nhập). Endpoint này
// GIỮ LẠI có chủ đích, KHÔNG phải quên dọn:
//   - `LEAD_INTAKE_REQUIRE_AUTH` nay mặc định BẬT ⇒ nó đã khoá với người ngoài;
//   - `lib/crm/webhook-replay.ts` còn phát lại `WebhookDelivery` nguồn
//     "sale-form" (các phiếu đã nhận trước đây) qua đúng mapper này;
//   - nếu một ngày phải dựng lại biểu mẫu công khai thì chỉ cần đặt cờ về
//     "false", không phải viết lại đường nhận.
//
// Trước 16/08/2026 form POST thẳng sang MISA và hệ thống ta KHÔNG có gì. Từ 16/08
// nó POST về đây để tạo Lead thật. Bản sao sang MISA đã GỠ ngày 29/08/2026.
//
// Đây là POST FORM CỦA TRÌNH DUYỆT, không phải fetch JSON:
//  - body là `application/x-www-form-urlencoded`;
//  - phải trả 303 + Location, KHÔNG trả JSON (người nhập sẽ thấy JSON thô);
//  - lỗi thì trả 1 trang HTML nhỏ có nút quay lại, để người nhập không mất
//    công gõ lại cả phiếu.
//
// ⚠️ Route nằm dưới `/api/*` nên `isInfraPath` (`lib/auth/route-policy.ts`) cho
// nó đi thẳng qua cổng host — ở MỌI host. Nghĩa là bịt cổng trang KHÔNG bịt được
// endpoint: ai trên Internet cũng `curl` vào đây tạo Lead thật. Honeypot +
// giới hạn theo IP + trần dung lượng chỉ chống SPAM, không chống truy cập trái phép.
//
// G-D (21/08/2026) — hai lớp vá:
//   1. Cổng đăng nhập, gài sau cờ `LEAD_INTAKE_REQUIRE_AUTH` (mặc định OFF).
//      Bật là biểu mẫu tĩnh ẩn danh đang dùng hằng ngày chết ⇒ chỉ bật khi trang
//      có đăng nhập đã lên và marketing đã được thông báo. Xem `lib/flags.ts`.
//   2. **Có hiệu lực NGAY, không phụ thuộc cờ:** phiếu nào đến kèm phiên đăng
//      nhập thì mã nhân viên lấy từ PHIÊN, không lấy từ ô người dùng gõ.
// =============================================================================

const MAX_BODY_BYTES = 100_000;

/**
 * Đích sau khi lưu xong. 22/08/2026 trang cảm ơn tĩnh đã bị xoá cùng biểu mẫu
 * cũ ⇒ trả người nhập về biểu mẫu MỚI (nó ở host public; đứng trên host nào thì
 * tầng route policy tự đá tiếp về đúng chỗ).
 */
const INTAKE_PAGE = "/nhap-khach-hang";

function redirect(req: NextRequest, path: string, params: Record<string, string>) {
  const url = new URL(path, originCuaRequest(req));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // 303: đổi POST thành GET khi đi tiếp — bấm F5 ở trang cảm ơn sẽ không gửi
  // lại phiếu (nguồn kinh điển của lead trùng).
  return NextResponse.redirect(url, 303);
}

function errorPage(message: string, status: number) {
  const safe = message.replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;",
  );
  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Chưa lưu được phiếu</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5fb;
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2937;padding:24px}
  .box{max-width:440px;background:#fff;border-radius:18px;padding:28px;
       box-shadow:0 10px 30px rgba(107,33,168,.12);text-align:center}
  h1{font-size:20px;margin:0 0 10px;color:#6B21A8}
  p{margin:0 0 20px;line-height:1.6}
  button{border:0;border-radius:12px;padding:12px 22px;font-size:15px;font-weight:600;
         background:#6B21A8;color:#fff;cursor:pointer}
</style></head>
<body><div class="box">
  <h1>Chưa lưu được phiếu</h1>
  <p>${safe}</p>
  <button onclick="history.back()">← Quay lại sửa phiếu</button>
</div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Vào thẳng bằng trình duyệt (GET) → đưa về form, đừng trả 405 khó hiểu. */
export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL(INTAKE_PAGE, originCuaRequest(req)), 303);
}

export async function POST(req: NextRequest) {
  // IP qua luật dùng chung (28/09/2026) — bản cũ lấy phần tử ĐẦU của XFF, tức phần khách viết.
  const ip = ipChoRateLimit(req.headers);

  try {
    // ── G-D: cổng đăng nhập ───────────────────────────────────────────────
    // Kiểm TRƯỚC khi đọc body: không tốn công xử lý phiếu của người không được
    // phép, và không để thông báo lỗi tiết lộ gì về nghiệp vụ bên trong.
    const session = await auth();
    if (isLeadIntakeAuthRequired() && !session?.user) {
      return errorPage(
        "Cần đăng nhập để nhập khách hàng. Mở trang nhập khách trong hệ thống rồi thử lại giúp nhé.",
        401,
      );
    }
    // Có phiên thì phải đúng người có quyền nhập lead — kể cả khi cờ còn TẮT.
    if (session?.user && !(await checkPermission("leads:create"))) {
      return errorPage("Tài khoản của bạn không có quyền nhập khách hàng.", 403);
    }

    // Chốt kích thước 2 lớp. Header là đường nhanh nhưng KHÔNG tin được: HTTP/2
    // và chunked thường không gửi `content-length`, và `Number(null ?? 0)` = 0
    // lọt qua mọi so sánh. Nên phải đo lại chính chuỗi đã đọc.
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return errorPage("Dữ liệu gửi lên quá lớn.", 413);
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      console.warn(`[sale-form] body ${raw.length} byte vượt trần, ip: ${ip}`);
      return errorPage("Dữ liệu gửi lên quá lớn.", 413);
    }
    const payload = Object.fromEntries(new URLSearchParams(raw).entries());

    // Bẫy bot: ô ẩn, người thật không thấy nên luôn rỗng. Trả về như thành công
    // để bot không dò ra là đã bị chặn.
    //
    // ⚠️ Phiếu bị vứt HẲN ở đây. Nếu một ngày trình quản lý mật khẩu tự điền ô
    // này thì đó là lead thật bị mất — nên GHI CẢ PAYLOAD vào WebhookDelivery
    // để còn cứu được, thay vì chỉ log mỗi IP rồi mất trắng.
    if ((payload[SALE_FORM_HONEYPOT] ?? "").length > 0) {
      console.warn("[sale-form] honeypot dính, ip:", ip);
      await logWebhookDelivery({
        source: "sale-form",
        payload,
        status: "FAILED",
        errorMessage: `Honeypot "${SALE_FORM_HONEYPOT}" có giá trị — nghi bot, không tạo lead. IP ${ip}.`,
      }).catch((err) => console.error("[sale-form] không ghi được honeypot log:", err));
      return redirect(req, INTAKE_PAGE, { ok: "1" });
    }

    const max = await getSetting("intake.saleFormRateLimitMax");
    const limit = await rateLimit({
      key: `sale-form:${ip}`,
      max,
      windowMs: 60_000,
    });
    if (!limit.success) {
      return errorPage(
        "Bạn gửi hơi nhanh. Đợi khoảng một phút rồi gửi lại giúp nhé.",
        429,
      );
    }

    const mapped = mapSaleForm(payload);
    if (!mapped.ok) return errorPage(mapped.error, 400);

    // ── G-D: danh tính lấy từ PHIÊN, không từ ô người dùng gõ ─────────────
    // Ô "Mã số NV" trên phiếu quyết định lead giao cho ai (`resolveOwner`),
    // nhưng ai cũng gõ được mã của người khác. Có phiên thì phiên thắng.
    if (session?.user) {
      const staff = await getStaffIdentity(
        session.user.id,
        session.user.name ?? session.user.email ?? "Không rõ",
      );
      const pick = pickEmployeeCode(staff.employeeCode, mapped.lead.employeeCode);
      mapped.lead.employeeCode = pick.code;
      if (pick.spoofed) {
        // Không chặn phiếu — có thể là nhập hộ đồng nghiệp. Nhưng phải để lại vết,
        // vì đây cũng đúng hình dạng của việc cướp lead.
        mapped.lead.warnings.push(
          `Phiếu ghi mã nhân viên khác với người đang đăng nhập — đã dùng mã của người nhập (${pick.code}).`,
        );
      }
      if (pick.source === "session") {
        mapped.lead.noteLines.push(`Người nhập (đã đăng nhập): ${staff.displayName}`);
      }
    }

    const result = await ingestIntakeLead(mapped.lead, {
      source: "sale-form",
      ipAddress: ip,
      userAgent: req.headers.get("user-agent"),
      landingPage: req.headers.get("referer"),
      actorName: "Hệ thống (form Sale)",
      // Form công khai KHÔNG có ô nguồn/quảng cáo: người giới thiệu là mã NV trên phiếu (D12), do ingest giải.
      tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON,
    });

    if (!result.ok) {
      return errorPage(
        result.error ?? "Lỗi hệ thống, thử lại giúp nhé.",
        500,
      );
    }

    // 29/08/2026 — GỠ bản sao sang MISA (chủ dự án bỏ hẳn CRM của MISA). Endpoint
    // này GIỮ LẠI vì quảng cáo/QR cũ còn trỏ tới, nhưng nay nó chỉ tạo Lead trong
    // Postgres rồi thôi: không gọi mạng ra ngoài, không `WebhookDelivery` nào.

    return redirect(req, INTAKE_PAGE, {
      ok: "1",
      ...(result.duplicate ? { dup: "1" } : {}),
      ...(result.childAdded ? { child: "1" } : {}),
    });
  } catch (err) {
    console.error("[POST /api/public/lead-intake/sale-form]", err);
    return errorPage("Lỗi hệ thống, thử lại giúp nhé.", 500);
  }
}
