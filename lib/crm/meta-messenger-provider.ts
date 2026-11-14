import "server-only";

/**
 * S-2b — ADAPTER META SEND API (gửi tin Messenger ra khách).
 *
 * ── Vì sao file này tồn tại ──────────────────────────────────────────────────
 * Trước 27/08/2026 kho KHÔNG có một lời gọi nào ra Send API: `recordOutgoingMessage()`
 * chỉ `db.messengerMessage.create(...)` rồi thôi. Người trực bấm "Trả lời" → hệ thống
 * báo thành công → **khách không nhận được gì**. `graph.facebook.com` chỉ xuất hiện ở
 * `lib/crm/ads-insights.ts` (số liệu quảng cáo) và `lib/tracking.ts` (Conversions API).
 * Đợt S-2a (25/08) đã chặn cứng nút gửi để thôi nói dối; đợt này nối đường thật.
 *
 * ── Khuôn ────────────────────────────────────────────────────────────────────
 * Chép khuôn adapter đang chạy `lib/zalo/provider.ts:91-125` (spec §2.2, bốn luật
 * AD-1…AD-4): thiếu credential ⇒ **tắt an toàn, trả mã lỗi, KHÔNG ném**; chưa live ⇒
 * **không gọi API thật**; và trạng thái mô phỏng phải được **ghi vào sổ** chứ không
 * lặng lẽ coi như đã gửi. Cổng live nằm ở lớp trên (`lib/crm/messenger-send.ts`), file
 * này chỉ lo phép gọi.
 *
 * ── Giới hạn ĐANG CÓ, phải biết trước khi dùng ───────────────────────────────
 * • **Một token cho một Page.** `FacebookPageMapping` cho phép nhiều Page, nhưng env chỉ
 *   có `META_PAGE_ID` + `META_PAGE_ACCESS_TOKEN`. Hội thoại thuộc Page khác ⇒ trả
 *   `META_SAI_PAGE`, KHÔNG gửi bằng token của Page khác (Meta sẽ từ chối, và nếu lọt
 *   thì tin đi sai Page). Muốn nhiều Page: cất token theo `pageId` (SystemSetting mã
 *   hoá hoặc bảng riêng) rồi sửa `layTokenTheoPage()` — chỗ duy nhất phải sửa.
 * • **Cửa sổ 24 giờ.** Meta chỉ cho trả lời trong 24h kể từ tin cuối của khách.
 *   Cổng chặn TRƯỚC khi gọi nằm ở `messenger-send.ts`; ở đây chỉ nhận diện lỗi Meta
 *   trả về (code 10 / subcode 2018278) và đổi nó thành mã riêng để lớp trên nói tiếng
 *   người, thay vì để nó rơi xuống thành lỗi 500 câm.
 * • **Token là secret** (luật cứng #9): đi ở header `Authorization`, KHÔNG nhét vào
 *   query string (query string lọt vào log truy cập / breadcrumb Sentry), và mọi lời
 *   lỗi trả ra đều lọc bỏ giá trị token trước khi rời hàm này.
 */

/** Phiên bản Graph API — bám theo `lib/crm/ads-insights.ts:90` để cả kho chỉ có một mốc. */
export const META_GRAPH_VERSION = "v21.0";

/** Timeout một lời gọi ra Meta. Bằng chuẩn hiện hành của kho (`lib/zalo/provider.ts:59`). */
const TIMEOUT_MS = 10_000;

/** Meta báo "ngoài cửa sổ nhắn tin": code 10, subcode 2018278. */
const SUBCODE_NGOAI_CUA_SO = 2018278;

export type MaLoiGuiMeta =
  /** Chưa điền `META_PAGE_ACCESS_TOKEN` (hoặc `META_PAGE_ID`) — chưa ai cấu hình. */
  | "META_NOT_CONFIGURED"
  /** Hội thoại thuộc Page khác Page có token — không có khoá để gửi. */
  | "META_SAI_PAGE"
  /** Meta từ chối vì quá 24h kể từ tin cuối của khách. */
  | "NGOAI_CUA_SO_24H"
  /** Meta trả lỗi khác (token hỏng, thiếu quyền `pages_messaging`, nội dung bị chặn…). */
  | "META_TU_CHOI"
  /** Không nhận được câu trả lời nào: mạng đứt, Meta treo, hết `TIMEOUT_MS`. */
  | "META_KHONG_TRA_LOI";

export interface MetaSendInput {
  pageId: string;
  psid: string;
  text: string;
}

export type MetaSendResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      ma: MaLoiGuiMeta;
      /** Mã Meta trả về, dạng `code` hoặc `code/subcode`. Giữ để sau còn đối soát. */
      maLoiMeta?: string;
      /** Nguyên văn lời Meta (đã lọc secret). Để chẩn đoán, KHÔNG hiện thẳng cho người dùng. */
      loiGoc?: string;
    };

function pageIdCauHinh(): string | undefined {
  return process.env.META_PAGE_ID?.trim() || undefined;
}

/** Token của `pageId`. Hiện chỉ có 1 Page trong env — xem ghi chú "Giới hạn" ở đầu file. */
function layTokenTheoPage(pageId: string): string | undefined {
  const token = process.env.META_PAGE_ACCESS_TOKEN?.trim();
  if (!token) return undefined;
  const cauHinh = pageIdCauHinh();
  if (!cauHinh || cauHinh !== pageId) return undefined;
  return token;
}

/** Có đủ khoá để gửi ra Page này chưa? (AD-1 — hỏi trước, không ném.) */
export function messengerSendDaCauHinh(pageId: string): boolean {
  return Boolean(layTokenTheoPage(pageId));
}

/**
 * Bỏ mọi giá trị secret khỏi chuỗi trước khi nó rời file này. Meta có lúc trả lại
 * nguyên access token trong lời lỗi ("Bad token EAA…"), mà chuỗi đó sẽ được ghi vào
 * `MessengerMessage.errorMessage` và hiện lên màn quản trị.
 */
function locSecret(s: string): string {
  let ra = s;
  for (const bi of [process.env.META_PAGE_ACCESS_TOKEN, process.env.META_APP_SECRET]) {
    const v = bi?.trim();
    if (v && v.length >= 8) ra = ra.split(v).join("«đã ẩn»");
  }
  return ra;
}

/**
 * Gửi 1 tin văn bản ra Messenger.
 *
 * KHÔNG BAO GIỜ NÉM — mọi hỏng hóc của nhà cung cấp (mạng, timeout, 4xx, 5xx, thân
 * phản hồi lạ) đều quay về `{ ok: false, ma }`. Người gọi là một Server Action đang
 * ghi sổ trong nước; để ngoại lệ vọt ra là biến lỗi của Facebook thành lỗi 500 của
 * Sata Robo.
 */
export async function guiTinRaMeta(input: MetaSendInput): Promise<MetaSendResult> {
  const token = layTokenTheoPage(input.pageId);
  if (!token) {
    // Phân biệt hai cảnh khác nhau, vì cách xử lý khác nhau: chưa ai điền khoá
    // (việc của người vận hành) ≠ hội thoại thuộc Page chưa có khoá (việc của kỹ thuật).
    return process.env.META_PAGE_ACCESS_TOKEN?.trim()
      ? { ok: false, ma: "META_SAI_PAGE" }
      : { ok: false, ma: "META_NOT_CONFIGURED" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${input.pageId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recipient: { id: input.psid },
          // RESPONSE = trả lời trong cửa sổ 24h. KHÔNG dùng MESSAGE_TAG ở đây: tag là
          // ngoại lệ có điều kiện của Meta, dùng sai là Page bị hạn chế/khoá.
          messaging_type: "RESPONSE",
          message: { text: input.text },
        }),
        signal: controller.signal,
      },
    );

    const json = (await res.json().catch(() => null)) as {
      message_id?: string;
      error?: { message?: string; code?: number; error_subcode?: number };
    } | null;

    if (json?.message_id) return { ok: true, providerMessageId: json.message_id };

    const loi = json?.error;
    const maLoiMeta =
      loi?.code == null
        ? undefined
        : loi.error_subcode == null
          ? String(loi.code)
          : `${loi.code}/${loi.error_subcode}`;
    const loiGoc = locSecret(loi?.message ?? `HTTP ${res.status} — phản hồi không có message_id`);

    const ngoaiCuaSo =
      loi?.error_subcode === SUBCODE_NGOAI_CUA_SO ||
      /outside[^.]*window/i.test(loi?.message ?? "");

    // 200 mà không có `message_id` cũng là thất bại: không có bằng chứng tin đã đi
    // thì không được ghi SENT. Thà báo hỏng còn hơn bịa một lần gửi thành công.
    return {
      ok: false,
      ma: ngoaiCuaSo ? "NGOAI_CUA_SO_24H" : "META_TU_CHOI",
      maLoiMeta,
      loiGoc,
    };
  } catch (err) {
    return {
      ok: false,
      ma: "META_KHONG_TRA_LOI",
      loiGoc: locSecret(err instanceof Error ? err.message : "FETCH_FAILED"),
    };
  } finally {
    clearTimeout(timer);
  }
}
