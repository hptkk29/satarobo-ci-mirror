import "server-only";
// lib/integrations/zalocrm/client.ts — GỌI NGƯỢC sang máy chủ ZaloCRM (Public API).
//
// =============================================================================
// ⚠️ CHƯA DÙNG THẬT. Đường này chỉ bật ở GĐ3 (đồng bộ nick, đối soát 5 phút, gửi
// tin). Viết trước để phần chạm mạng có một chỗ DUY NHẤT, đã đặt hạn giờ và đã có
// khuôn kết quả — chứ không phải để gọi ngay.
//
// 🔴 REPO KHÔNG CÓ HTTP CLIENT DÙNG CHUNG, và PR này CỐ Ý KHÔNG tạo một cái.
// Mỗi tích hợp trong repo tự `fetch` (MISA, Meta, Zalo OA, R2). Dựng một "helper
// chung" ở đây là quyết định kiến trúc cho cả repo, không phải việc của một lô —
// nên file này tự lo: `AbortController` 10 giây, `clearTimeout` trong `finally`.
//
// ⚠️ HẠN GIỜ LÀ BẮT BUỘC, không phải tuỳ chọn: `fetch` của Node KHÔNG có timeout mặc
// định. ZaloCRM chạy trên VPS riêng sau một Cloudflare Tunnel — tunnel đứt thì
// request treo cho tới khi hạ tầng cắt, và mỗi request treo giữ một function
// invocation của Vercel.
//
// ── KHOÁ API ─────────────────────────────────────────────────────────────────
// `ZALOCRM_API_KEYS` là JSON `{orgCode: key}` trong ENV (cùng lý do với
// `ZALOCRM_WEBHOOK_SECRETS` — luật cứng #9). Một key là TOÀN QUYỀN trên một org
// (`[ZCRM] public-api-routes.ts:14-24`: tra `AppSetting{public_api_key}` → `orgId`,
// không scope theo tài nguyên), nên nó không bao giờ được ra khỏi máy chủ và không
// bao giờ vào log.
// =============================================================================

/** Hạn giờ mỗi lượt gọi. Đủ rộng cho tunnel chậm, đủ hẹp để không giữ invocation. */
export const ZALOCRM_TIMEOUT_MS = 10_000;

export type MaLoiGoi =
  /** Thiếu `ZALOCRM_BASE_URL` hoặc khoá của org — lỗi cấu hình của mình. */
  | "CHUA_CAU_HINH"
  /** Quá `ZALOCRM_TIMEOUT_MS`. */
  | "HET_GIO"
  /** Không nối được (tunnel đứt, DNS hỏng). */
  | "KHONG_KET_NOI"
  /** Máy chủ trả mã lỗi HTTP. */
  | "LOI_HTTP"
  /** Trả 2xx nhưng thân không phải JSON đọc được. */
  | "THAN_KHONG_DOC_DUOC";

export type KetQuaGoi<T> =
  | { ok: true; data: T }
  | { ok: false; ma: MaLoiGoi; thongDiep: string; httpStatus?: number };

/**
 * Khoá API của một org.
 *
 * Trả `null` khi chưa khai — nơi gọi phải chịu được ca đó (GĐ0/GĐ1 chưa có khoá) và
 * KHÔNG được coi "chưa khai" là "gọi thành công".
 */
export function docKhoaApi(orgCode: string): string | null {
  const tho = process.env.ZALOCRM_API_KEYS;
  if (!tho?.trim()) return null;
  try {
    const doc: unknown = JSON.parse(tho);
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
    const v = (doc as Record<string, unknown>)[orgCode];
    return typeof v === "string" && v.trim() ? v : null;
  } catch {
    // KHÔNG in giá trị ra log — nó chứa khoá toàn quyền của mọi org.
    console.error("[zalocrm] ZALOCRM_API_KEYS không phải JSON hợp lệ.");
    return null;
  }
}

/**
 * Một lượt gọi sang ZaloCRM. **KHÔNG BAO GIỜ NÉM** — mọi hỏng hóc thành `{ok:false}`
 * có mã, để chỗ gọi (cron/đồng bộ) ghi `IntegrationLog` rồi đi tiếp thay vì chết cả job.
 */
export async function goiZalocrm<T>(input: {
  orgCode: string;
  /** Đường dẫn tính từ gốc, ví dụ `/api/public/conversations?limit=100`. */
  duongDan: string;
  method?: "GET" | "POST" | "PUT";
  than?: unknown;
  timeoutMs?: number;
}): Promise<KetQuaGoi<T>> {
  const goc = process.env.ZALOCRM_BASE_URL?.trim();
  const khoa = docKhoaApi(input.orgCode);
  if (!goc || !khoa) {
    return {
      ok: false,
      ma: "CHUA_CAU_HINH",
      thongDiep: "Chưa khai ZALOCRM_BASE_URL hoặc ZALOCRM_API_KEYS cho cơ sở này.",
    };
  }

  const controller = new AbortController();
  const hetGio = setTimeout(() => controller.abort(), input.timeoutMs ?? ZALOCRM_TIMEOUT_MS);
  try {
    const res = await fetch(`${goc.replace(/\/+$/, "")}${input.duongDan}`, {
      method: input.method ?? "GET",
      headers: {
        // Tên header đọc từ mã ZaloCRM (`[ZCRM] public-api-routes.ts:14-24`).
        "x-api-key": khoa,
        ...(input.than === undefined ? {} : { "content-type": "application/json" }),
      },
      body: input.than === undefined ? undefined : JSON.stringify(input.than),
      signal: controller.signal,
      // Không bao giờ cache một lượt gọi tích hợp.
      cache: "no-store",
    });

    if (!res.ok) {
      // Thân lỗi của bên kia có thể kèm dữ liệu khách — KHÔNG đưa vào thông điệp.
      return {
        ok: false,
        ma: "LOI_HTTP",
        httpStatus: res.status,
        thongDiep: `ZaloCRM trả mã ${res.status}.`,
      };
    }

    try {
      return { ok: true, data: (await res.json()) as T };
    } catch {
      return { ok: false, ma: "THAN_KHONG_DOC_DUOC", thongDiep: "Phản hồi không phải JSON." };
    }
  } catch (err) {
    const hetHan = err instanceof Error && err.name === "AbortError";
    return hetHan
      ? { ok: false, ma: "HET_GIO", thongDiep: `Quá ${ZALOCRM_TIMEOUT_MS}ms không phản hồi.` }
      : { ok: false, ma: "KHONG_KET_NOI", thongDiep: "Không kết nối được máy chủ ZaloCRM." };
  } finally {
    // BẮT BUỘC: bỏ quên là mỗi lượt gọi giữ một timer sống thêm 10 giây, và trong
    // môi trường serverless thì đó là invocation không chịu kết thúc.
    clearTimeout(hetGio);
  }
}

// ── Các lượt gọi của Public API ─────────────────────────────────────────────
//
// 🔴 HÌNH DẠNG ĐÃ ĐỐI CHIẾU MÃ FORK 13/09/2026 (F4, `public-api-routes.ts`), không
// còn là phỏng đoán. Bản viết trước đoán sai ngay tên khoá: fork trả
// `{ conversations: [...] }` và `{ messages: [...] }`, **không phải** `{ data: [...] }`.
// Đoán sai chỗ này là mọi lượt đối soát đọc ra 0 dòng — im lặng, và trông y hệt
// "không có gì mới".

export type HoiThoaiZalocrm = {
  id: string;
  threadType?: string | null;
  externalThreadId?: string | null;
  /** Nick đang giữ hội thoại — khoá để suy ra cơ sở. F4 mới thêm. */
  zaloAccountId?: string | null;
  lastMessageAt?: string | null;
  unreadCount?: number | null;
  isReplied?: boolean | null;
  contact?: {
    id: string;
    fullName?: string | null;
    phone?: string | null;
    /** `Lead.id` bên Sata, nếu đã gắn. F4 mới thêm. */
    externalRef?: string | null;
  } | null;
};

/**
 * `GET /api/public/conversations` — danh sách hội thoại, mới nhất trước.
 *
 * `since` lọc theo `lastMessageAt`. Truyền mốc của lượt đối soát trước để chỉ kéo về
 * phần đổi; không truyền thì mỗi lượt kéo cả trang đầu rồi tự bỏ đi.
 */
export function layHoiThoaiZalocrm(
  orgCode: string,
  tuyChon: { limit?: number; since?: Date | string | null } = {},
): Promise<KetQuaGoi<{ conversations?: HoiThoaiZalocrm[] }>> {
  const tham = new URLSearchParams({ limit: String(tuyChon.limit ?? 100) });
  const moc = tuyChon.since;
  if (moc) tham.set("since", moc instanceof Date ? moc.toISOString() : String(moc));
  return goiZalocrm({ orgCode, duongDan: `/api/public/conversations?${tham.toString()}` });
}

/** `GET /api/public/conversations/:id` — một hội thoại. F4 mới thêm. */
export function layMotHoiThoaiZalocrm(
  orgCode: string,
  conversationId: string,
): Promise<KetQuaGoi<{ conversation?: HoiThoaiZalocrm }>> {
  return goiZalocrm({
    orgCode,
    duongDan: `/api/public/conversations/${encodeURIComponent(conversationId)}`,
  });
}

export type TinZalocrm = {
  id: string;
  senderType?: "self" | "contact" | "ai_assistant";
  senderName?: string | null;
  content?: string | null;
  contentType?: string | null;
  sentAt?: string | null;
};

/** `GET /api/public/conversations/:id/messages?limit=…`. */
export function layTinZalocrm(
  orgCode: string,
  conversationId: string,
  limit = 50,
): Promise<KetQuaGoi<{ messages?: TinZalocrm[] }>> {
  return goiZalocrm({
    orgCode,
    duongDan: `/api/public/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`,
  });
}

/**
 * `POST /api/public/messages/send`.
 *
 * Sau F4 (13/09/2026) route này: đi qua trần chống khoá nick của ZaloCRM · trả `msgId` ·
 * nhận `idempotencyKey`.
 *
 * 🔴 `idempotencyKey` KHÔNG phải tuỳ chọn cho vui. Hàng đợi gửi lại của Sata mà gặp
 * timeout thì tin có thể ĐÃ tới Zalo; gửi lại là khách nhận hai lần, và tin đã đi thì
 * không thu hồi được. Truyền `outboundKey` của lượt gửi vào đây.
 *
 * 🔴 Thiếu `msgId` trong phản hồi ⇒ nơi gọi phải trả `FAILED`/`SKIPPED`, **TUYỆT ĐỐI
 * không bịa id**: `providerMessageId` được ghi làm `channelMessageId` để bản echo về
 * sau bị nhận ra là trùng. Bịa id là echo tạo dòng OUT thứ hai, mỗi tin hiện hai lần.
 */
export function guiTinZalocrm(
  orgCode: string,
  than: {
    zaloAccountId: string;
    threadId: string;
    content: string;
    threadType?: string;
    idempotencyKey?: string;
  },
): Promise<KetQuaGoi<{ success?: boolean; msgId?: string | null; duplicate?: boolean }>> {
  return goiZalocrm({ orgCode, duongDan: "/api/public/messages/send", method: "POST", than });
}

/**
 * `PUT /api/public/contacts/:id/external-ref` — gắn `Lead.id` của Sata vào liên hệ bên
 * ZaloCRM, để màn chat mở đúng phiếu. `null` là gỡ liên kết.
 *
 * Trả 409 `EXTERNAL_REF_TAKEN` khi khoá đã thuộc liên hệ khác — **không đè**, vì dấu
 * hiệu thật ở đó là hai liên hệ trùng người và việc phải xử là gộp.
 */
export function datKhoaPhieuZalocrm(
  orgCode: string,
  contactId: string,
  externalRef: string | null,
): Promise<KetQuaGoi<{ contact?: { id: string; externalRef: string | null } }>> {
  return goiZalocrm({
    orgCode,
    duongDan: `/api/public/contacts/${encodeURIComponent(contactId)}/external-ref`,
    method: "PUT",
    than: { externalRef },
  });
}

/**
 * `PUT /api/public/zalo-accounts/:id/access` — ĐẶT danh sách người được dùng một nick,
 * KÈM MỨC của từng người.
 *
 * 🔴 THAY CẢ TẬP, không phải "thêm một người": ai không có trong danh sách sẽ BỊ GỠ
 * quyền. Đó là chủ đích — vế gỡ (nghỉ việc, chuyển cơ sở, đổi vai) là vế không ai nhớ
 * làm tay và hỏng thì không có triệu chứng.
 *
 * Bên fork chỉ đụng người đến từ Sata (`externalId != null`); tài khoản tạo tay trong
 * ZaloCRM không bị hệ ngoài thu quyền.
 *
 * Mảng RỖNG là hợp lệ và có nghĩa: "không ai bên Sata được dùng nick này nữa".
 *
 * ── 🔴 GỬI CẢ HAI DẠNG THÂN, CÓ CHỦ ĐÍCH (24/09/2026) ──────────────────────
 * Trước đó gửi `{ externalIds: [...] }` và bên kia đóng cứng mọi người ở mức `chat`.
 * Nay mỗi người một mức (`read`/`chat`/`admin`) qua `access[]`.
 *
 * Thân mang ĐỒNG THỜI `access[]` (bản mới đọc) và `externalIds[]` (bản cũ đọc). Trông
 * thừa, nhưng nó xoá hẳn một rủi ro THỨ TỰ TRIỂN KHAI trên hệ thống đang có người dùng:
 * ZaloCRM chạy trong container riêng, Sata chạy trên Vercel, hai bên lên KHÔNG cùng lúc.
 *   · chỉ gửi `access[]` + ZaloCRM còn bản cũ ⇒ nó trả **400** và KHÔNG cấp/gỡ cho ai;
 *     mọi lượt đối soát (288 lượt/ngày) hỏng cho tới khi container được khởi động lại.
 *   · gửi cả hai ⇒ bản cũ vẫn chạy đúng như trước (mọi người mức `chat`), bản mới đọc
 *     `access[]` và dùng mức thật. Xấu nhất là "mức chưa có hiệu lực", không phải "mất
 *     cả đường cấp quyền".
 * Bỏ `externalIds` đi được — SAU khi chắc mọi bản ZaloCRM đang chạy đều đọc `access[]`.
 *
 * 🔴 `sataUserId` CHÍNH LÀ `externalId` bên kia — tài khoản ZaloCRM sinh ra từ vé SSO
 * mang `User.id` của Sata. Đừng ánh xạ qua email: email đổi được, `id` thì không.
 */
export function datQuyenNickZalocrm(
  orgCode: string,
  zcrmAccountId: string,
  quyen: readonly { sataUserId: string; mucQuyen: string }[],
): Promise<KetQuaGoi<{ granted?: number; revoked?: number; unknown?: number }>> {
  return goiZalocrm({
    orgCode,
    duongDan: `/api/public/zalo-accounts/${encodeURIComponent(zcrmAccountId)}/access`,
    method: "PUT",
    than: {
      access: quyen.map((q) => ({ externalId: q.sataUserId, permission: q.mucQuyen })),
      // Dự phòng cho ZaloCRM bản cũ — xem khối trên. Hai mảng PHẢI cùng tập người, nên
      // suy ra từ cùng một nguồn chứ không nhận thêm tham số.
      externalIds: quyen.map((q) => q.sataUserId),
    },
  });
}
