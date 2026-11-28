import "server-only";
// lib/integrations/zalocrm/webhook.ts — NHẬN TIN TỪ ZALOCRM.
//
// =============================================================================
// Chép khuôn `lib/calls/webhook.ts` (OmiCall — đã gỡ 06/10/2026) (bản thân nó chép từ `lib/lead/webhook.ts`).
// Bảy bước, đúng thứ tự này, và THỨ TỰ LÀ PHẦN QUAN TRỌNG NHẤT:
//   1. giới hạn tần suất — khoá KÈM org (xem bên dưới)
//   2. chặn thân quá lớn (đọc `content-length` TRƯỚC khi đọc thân)
//   3. tra cấu hình org + bí mật, FAIL-CLOSED
//   4. đọc thân thô ĐÚNG MỘT LẦN (chữ ký tính trên chính chuỗi đó)
//   5. kiểm chữ ký HMAC — RỖNG hay SAI đều 401
//   6. ghi `WebhookDelivery` TRƯỚC khi xử lý (payload ĐÃ ĐỤC)
//   7. `markWebhookDelivery` PROCESSED | DUPLICATE | FAILED
// `bat-bien.test.ts` đọc chính tệp này dạng chuỗi và canh thứ tự đó. Đảo bước là
// ĐỎ ngay — vì không có test chạy-thật nào bắt được việc cửa vừa bị mở.
//
// ── BA CHỖ CỐ Ý KHÁC BẢN OMICALL, ĐỪNG "SỬA CHO GIỐNG" ──────────────────────
//
// 🔴 (a) KHÔNG có nhánh fail-open. `lib/calls/webhook.ts:79` (OmiCall — đã gỡ 06/10/2026) có
//        `if (!secret) return { ok: true }` và `:53-59` có "chế độ stub" ở dev.
//        Đó là ngoại lệ riêng của OMICall (TQ-5: chưa biết nhà cung cấp có ký hay
//        không). ZaloCRM ký HMAC-SHA256 bắt buộc (`[ZCRM] webhook-service.ts:39-54`),
//        nên chép nhánh đó sang là mở toang cửa: bất kỳ ai POST vào cũng ghi thẳng
//        được vào hộp thư VÀ vào dòng thời gian phiếu lead.
//
// 🔴 (b) KHÔNG luôn trả 200. OMICall trả 200 cho mọi thứ để tránh retry bão. Ở đây
//        TÁCH theo loại lỗi:
//          · NGHIỆP VỤ (payload lạ, org lạ, hội thoại nhóm) ⇒ 200 + FAILED/PROCESSED
//            — retry cũng ra đúng kết quả đó;
//          · HẠ TẦNG (Prisma ngã, pool cạn) ⇒ 5xx — outbox của fork (F2) chỉ retry
//            khi thấy non-2xx. Luôn 200 nghĩa là tin MẤT VĨNH VIỄN mà bên gửi tưởng
//            đã giao xong.
//
// 🔴 (c) Khoá rate-limit KÈM org. Ba org (CS1, CS2, TEST) đi qua MỘT Cloudflare
//        Tunnel ⇒ cùng một IP nguồn. Giới hạn theo IP trần là CS1 bận làm nghẹt CS2,
//        và 429 KHÔNG để lại dòng `WebhookDelivery` nào ⇒ mất tin không có vết.
//
// ⚠️ Chữ ký tính trên chuỗi đã giải mã UTF-8 (`.update(raw, "utf8")`). Bên fork phải
// ký trên CHÍNH chuỗi JSON đã serialize; ký trên buffer đã qua biến đổi thì byte
// không hợp lệ thành U+FFFD ⇒ 401 ngẫu nhiên trên đúng những tin có emoji.
// =============================================================================
import { createHmac } from "node:crypto";

import { rateLimit } from "@/lib/rate-limit";
import { ipChoRateLimit } from "@/lib/security/client-ip";
import { safeEqual } from "@/lib/security/safe-equal";
import { logWebhookDelivery, markWebhookDelivery } from "@/lib/lead/webhook";
import { traCauHinhOrg } from "./config";
import { dichPayloadZalocrm, docMaTin } from "./dich-payload";
import { ducPayload } from "./duc-payload";
import { ghiNhatKyZalocrm } from "./log";
import { napSuKienZalocrm } from "./nap-su-kien";
import type { ZalocrmWebhookResult } from "./types";

const NGUON = "zalocrm";

/** Header ZaloCRM gửi kèm (`[ZCRM] webhook-service.ts:39-54`). */
const HEADER_CHU_KY = "x-webhook-signature";
const HEADER_SU_KIEN = "x-webhook-event";

/**
 * 600/phút cho MỖI org. Cao hơn hẳn OMICall (120) vì đơn vị ở đây là TIN NHẮN chứ
 * không phải cuộc gọi — một buổi cao điểm của một nick đã vượt xa 120.
 */
const TRAN_MOI_PHUT = 600;
const TRAN_THAN_BYTE = 100_000;

type KiemKetQua = { ok: true } | { ok: false; lyDo: "missing-secret" | "mismatch" };

/**
 * Bước 5 — HMAC-SHA256 trên chuỗi thân đã đọc.
 *
 * 🔴 KHÔNG có nhánh "chưa cấu hình khoá thì cho qua". Header vắng, rỗng, hay sai đều
 * là `mismatch` ⇒ 401. Đây là điểm khác quan trọng nhất so với bản OMICall.
 */
export function kiemChuKyZalocrm(
  rawBody: string,
  header: string | null,
  secret: string,
): KiemKetQua {
  if (!secret) return { ok: false, lyDo: "missing-secret" };
  const daNhan = header?.trim();
  if (!daNhan) return { ok: false, lyDo: "mismatch" };
  const mong = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const thuc = daNhan.startsWith("sha256=") ? daNhan.slice(7) : daNhan;
  return safeEqual(thuc, mong) ? { ok: true } : { ok: false, lyDo: "mismatch" };
}

export async function xuLyWebhookZalocrm(
  req: Request,
  org: string,
): Promise<ZalocrmWebhookResult> {
  // ── 1. Giới hạn tần suất, KÈM org. fail-soft (Upstash → bộ nhớ). ─────────
  // IP qua luật dùng chung (28/09/2026) — bản cũ lấy phần tử ĐẦU của XFF, tức phần khách viết
  // ⇒ mỗi lượt một khoá, trần không bao giờ chạm. `[ZC-WH-IP-01]` ghim.
  const ip = ipChoRateLimit(req.headers);
  const rl = await rateLimit({
    key: `webhook:zalocrm:${org}:${ip}`,
    max: TRAN_MOI_PHUT,
    windowMs: 60_000,
  });
  if (!rl.success) {
    return { httpStatus: 429, body: { ok: false, error: "Quá nhiều request — thử lại sau" } };
  }

  // ── 2. Chặn thân quá lớn TRƯỚC khi đọc. ─────────────────────────────────
  // ⚠️ Đây là rào chống VÔ Ý, không chống cố ý: request `Transfer-Encoding: chunked`
  // không có header này và sẽ đi tiếp. Đừng bán nó như một lớp bảo vệ.
  if (Number(req.headers.get("content-length") ?? 0) > TRAN_THAN_BYTE) {
    return { httpStatus: 413, body: { ok: false, error: "Payload quá lớn" } };
  }

  // ── 3. Tra org + bí mật. FAIL-CLOSED. ───────────────────────────────────
  // Bọc try/catch: `traCauHinhOrg` chạm DB (IntegrationConfig + setting + Center).
  // Để lỗi bay ra là Next trả một trang lỗi HTML — bên gửi vẫn thấy non-2xx và retry
  // (đúng), nhưng ta mất dòng log và mất luôn hình dạng `{ok:false}` của hợp đồng API.
  let cauHinh: Awaited<ReturnType<typeof traCauHinhOrg>>;
  try {
    cauHinh = await traCauHinhOrg(org);
  } catch (err) {
    console.error(`[webhook:${NGUON}:${org}] không tra được cấu hình org:`, err);
    return { httpStatus: 500, body: { ok: false, error: "Lỗi hệ thống" } };
  }
  if (!cauHinh.ok) return await tuChoiOrg(cauHinh.ma, org, ip);

  // ── 4. Đọc thân thô ĐÚNG MỘT LẦN. ───────────────────────────────────────
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    raw = "";
  }

  // ── 5. Chữ ký — bắt buộc. ───────────────────────────────────────────────
  const chuKy = kiemChuKyZalocrm(raw, req.headers.get(HEADER_CHU_KY), cauHinh.cauHinh.secret);
  if (!chuKy.ok) {
    console.warn(`[webhook:${NGUON}:${org}] chữ ký không hợp lệ (${chuKy.lyDo})`);
    // Van riêng cho đường CHƯA xác thực: bất kỳ ai cũng gọi được nó vô hạn.
    await ghiNhatKyZalocrm({
      orgCode: org,
      action: "WEBHOOK_CHU_KY_SAI",
      status: "FAILED",
      errorMessage: `CHU_KY_${chuKy.lyDo}`,
      khoaThrottle: `zalocrm:log-chu-ky:${ip}`,
    });
    return { httpStatus: 401, body: { ok: false, error: "Chữ ký không hợp lệ" } };
  }

  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    // JSON hỏng KHÔNG trả lỗi ngay: vẫn phải để lại một dòng vết (bước 6) rồi mới
    // đánh FAILED — nếu không thì "bên kia gửi rác" và "bên này không nhận được gì"
    // trông giống hệt nhau.
    payload = null;
  }

  // ── 6. Ghi vết TRƯỚC khi xử lý — payload ĐÃ ĐỤC. ────────────────────────
  // `source` mang org vì bảng KHÔNG có cột org; và KHÔNG dùng `"zalo"` — tên đó đã
  // bị webhook Zalo OA đang chạy trên prod chiếm (`lib/lead/webhook.ts:21`).
  let deliveryId: string;
  try {
    deliveryId = await logWebhookDelivery({
      source: `zalocrm:${org}`,
      externalId: docMaTin(payload),
      payload: ducPayload(payload),
    });
  } catch (err) {
    // Không ghi nổi bản vết = DB đang ngã ⇒ HẠ TẦNG ⇒ 5xx để fork retry.
    console.error(`[webhook:${NGUON}:${org}] không ghi được WebhookDelivery:`, err);
    return { httpStatus: 500, body: { ok: false, error: "Lỗi hệ thống" } };
  }

  // ── 7. Dịch + nạp + đánh dấu. ───────────────────────────────────────────
  try {
    const dich = dichPayloadZalocrm({
      payload,
      orgCode: org,
      tenSuKienHeader: req.headers.get(HEADER_SU_KIEN),
    });
    if (!dich.ok) {
      // Lỗi NGHIỆP VỤ. `errorMessage` chỉ là MÃ — tuyệt đối không nhét mẩu payload
      // vào: màn "Webhook lỗi — Replay" hiện cột đó cho mọi cơ sở.
      await markWebhookDelivery(deliveryId, "FAILED", dich.ma);
      await ghiNhatKyZalocrm({
        orgCode: org,
        action: "WEBHOOK_PAYLOAD_LA",
        status: "FAILED",
        errorMessage: dich.ma,
      });
      return { httpStatus: 200, body: { ok: false, error: dich.thongDiep, ma: dich.ma } };
    }

    const kq = await napSuKienZalocrm({ viec: dich.viec, cauHinh: cauHinh.cauHinh });
    if (!kq.ok) {
      await markWebhookDelivery(deliveryId, "FAILED", kq.ma);
      return { httpStatus: 200, body: { ok: false, error: kq.thongDiep, ma: kq.ma } };
    }

    // TRÙNG có trạng thái RIÊNG: `ingest*` đã dừng ở nhánh không-tạo-dòng-thứ-hai và
    // KHÔNG đụng bộ đếm chưa đọc.
    await markWebhookDelivery(deliveryId, kq.trung ? "DUPLICATE" : "PROCESSED");
    return {
      httpStatus: 200,
      body: { ok: true, conversationId: kq.conversationId, duplicate: kq.trung },
    };
  } catch (err) {
    // HẠ TẦNG ⇒ 5xx. Ghi FAILED nếu còn ghi được; nếu chính lệnh ghi cũng ngã thì
    // nuốt — không để một lỗi ở bảng vết che mất mã 5xx mà bên gửi cần thấy.
    console.error(`[webhook:${NGUON}:${org}] lỗi hạ tầng:`, err);
    try {
      await markWebhookDelivery(deliveryId, "FAILED", "Lỗi hệ thống");
    } catch {
      /* đã log ở trên */
    }
    return { httpStatus: 500, body: { ok: false, error: "Lỗi hệ thống" } };
  }
}

/**
 * Bước 3 hỏng — chưa đọc thân, chưa có bản vết nào.
 *
 * `THIEU_BI_MAT` ⇒ **503**: lỗi cấu hình CỦA MÌNH, và 503 để bên gửi retry sau khi ta
 * khai xong env. Ba mã còn lại ⇒ **404**: chưa bật/không có thì không lộ ra rằng địa
 * chỉ này có thật (cùng lý do `app/api/webhooks/omicall/cdr/route.ts:13-15` (OmiCall — đã gỡ 06/10/2026)).
 */
async function tuChoiOrg(
  ma: "ORG_KHONG_HOP_LE" | "THIEU_BI_MAT" | "ORG_KHONG_KHAI" | "ORG_TAT",
  org: string,
  ip: string,
): Promise<ZalocrmWebhookResult> {
  if (ma === "THIEU_BI_MAT") {
    return { httpStatus: 503, body: { ok: false, error: "Webhook chưa cấu hình secret" } };
  }

  if (ma === "ORG_KHONG_HOP_LE") {
    // KHÔNG ghi `IntegrationLog`: `provider` sẽ mang nguyên chuỗi của người lạ, và
    // mỗi chuỗi bịa là một khoá rate-limit riêng ⇒ bảng phình không giới hạn.
    console.warn(`[webhook:${NGUON}] đoạn org sai khuôn — từ chối, không ghi nhật ký.`);
    return { httpStatus: 404, body: { ok: false, error: "Not found" } };
  }

  // Org đúng khuôn nhưng chưa khai / đang tắt: PHẢI để lại vết. Triệu chứng của "gõ
  // sai một ký tự trong webhook_url" là HỘP THƯ TRỐNG, không phải một lỗi ai đó thấy.
  //
  // Vết ở HAI nơi có chủ đích: `console.warn` để người trực thấy ngay trong log
  // Vercel lúc đang dựng, và `IntegrationLog` để màn Tích hợp còn đỏ lên sau đó.
  // Chỉ có nhật ký DB thì không ai mở nó trong lúc đang loay hoay khai webhook.
  console.warn(`[webhook:${NGUON}] từ chối org "${org}" — mã ${ma}.`);
  await ghiNhatKyZalocrm({
    orgCode: org,
    action: ma === "ORG_TAT" ? "WEBHOOK_ORG_TAT" : "WEBHOOK_ORG_LA",
    status: "FAILED",
    errorMessage: ma,
    khoaThrottle: `zalocrm:log-org-la:${ip}`,
  });
  return { httpStatus: 404, body: { ok: false, error: "Not found" } };
}
