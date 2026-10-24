// lib/integrations/zalocrm/dich-payload.ts — PAYLOAD ZALOCRM → VIỆC PHẢI LÀM.
//
// =============================================================================
// 🔴 ĐỌC TRƯỚC KHI SỬA — BẢNG TÊN TRƯỜNG DƯỚI ĐÂY LÀ PHỎNG ĐOÁN.
//
// Bản GỐC của ZaloCRM bắn `{messageId, conversationId, senderUid, content,
// contentType, sentAt}` và KHÔNG kèm SĐT, `contactId`, `zaloAccountId`
// (`docs/tich-hop-zalocrm/01-ban-1-ve-tinh-khong-sua-ma.md` §4.2, đọc từ
// `[ZCRM] message-handler.ts:612-619`). Bản FORK (việc F2, repo khác, CHƯA TỒN TẠI)
// sẽ thêm `zaloAccountId`, `threadId`, `threadType`, `contactId`, `contact.phone`,
// `sentByExternalId`.
//
// Vì vậy file này, giống hệt `lib/calls/cdr.ts` từng làm cho OMICall (đã gỡ 06/10/2026):
//   · nhận NHIỀU tên trường khả dĩ cho cùng một ý;
//   · **KHÔNG BAO GIỜ NÉM** trên dữ liệu lạ — ném = 5xx = ZaloCRM retry bão một
//     payload không bao giờ xử lý được;
//   · thiếu thứ BẮT BUỘC ⇒ trả `{ok:false, ma}` để webhook ghi FAILED (đỏ ở màn
//     Tích hợp), chứ không im lặng bỏ tin.
//
// Khi có payload THẬT: sửa ĐÚNG bảng ánh xạ trong file này + fixture ở
// `__fixtures__/` + `dich-payload.test.ts`. KHÔNG chỗ nào khác.
//
// FILE THUẦN — không DB, không `server-only`, không `process.env`.
// =============================================================================
import { canonicalPhone } from "@/lib/phone";
import type { TinDenNgoai } from "@/lib/inbox/ingest";
import {
  KENH_ZALOCRM,
  type HuongTin,
  type KetQuaDich,
  type MaLoiDich,
} from "./types";

/**
 * Nhãn cho tin không có chữ (ảnh, sticker, tệp, thoại).
 *
 * Đính kèm CỐ Ý không kéo về (chốt phạm vi: "chỉ hiện nhãn, không kéo file"), nên
 * `body` phải là một câu đọc được chứ không phải chuỗi rỗng — hội thoại toàn dòng
 * trống thì người trực không biết có gì đã xảy ra.
 */
export const NHAN_TIN_KHONG_CHU = "[ảnh/tệp — xem trong ZaloCRM]";

/** Trần độ dài nội dung giữ lại. Tin Zalo dài nhất thực tế còn xa dưới mốc này. */
const TRAN_NOI_DUNG = 8_000;

// ── Đọc kiểu an toàn ─────────────────────────────────────────────────────────

function laObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Giá trị đầu tiên khác rỗng trong danh sách tên trường khả dĩ. */
function lay(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function chuoi(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  // ZaloCRM đánh số một số định danh bằng số nguyên lớn — ép về chuỗi để khoá không
  // bao giờ mất chữ số do làm tròn khi so sánh.
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "bigint") return String(v);
  return null;
}

/** ISO-8601, epoch giây, hoặc epoch mili. KHÔNG đoán định dạng địa phương. */
function thoiDiem(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = Math.abs(v) < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = chuoi(v);
  if (!s) return null;
  // Chuỗi toàn số cũng là epoch (một số hệ gửi `"1788660000"`).
  if (/^\d{10}$|^\d{13}$/.test(s)) return thoiDiem(Number(s));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function loi(ma: MaLoiDich, thongDiep: string): KetQuaDich {
  return { ok: false, ma, thongDiep };
}

function boQua(lyDo: string): KetQuaDich {
  return { ok: true, viec: { loai: "BO_QUA", lyDo } };
}

// ── Đọc phần chung của mọi payload ───────────────────────────────────────────

/**
 * Khối `data`. Nhận cả payload PHẲNG (không bọc `data`) vì không có văn bản nào
 * cam kết lớp bọc đó — và một lớp bọc thiếu không đáng để mất cả tin.
 */
function layData(payload: unknown): Record<string, unknown> | null {
  if (!laObject(payload)) return null;
  const d = payload.data ?? payload.payload ?? payload;
  return laObject(d) ? d : null;
}

/**
 * Tên sự kiện. Ưu tiên payload rồi mới tới header `X-Webhook-Event`: header đi qua
 * proxy/tunnel còn thân thì không, nên khi hai bên lệch thì thân đáng tin hơn.
 */
export function docLoaiSuKien(payload: unknown, tenSuKienHeader?: string | null): string | null {
  if (laObject(payload)) {
    const trongThan = chuoi(lay(payload, "event", "eventType", "event_type", "type"));
    if (trongThan) return trongThan;
  }
  return chuoi(tenSuKienHeader ?? null);
}

/**
 * Mã tin của nhà cung cấp — dùng làm `WebhookDelivery.externalId` để index
 * `[source, externalId]` có tác dụng đối soát.
 *
 * `null` với sự kiện không phải tin: đó là chuyện bình thường, không phải lỗi.
 */
export function docMaTin(payload: unknown): string | null {
  const data = layData(payload);
  if (!data) return null;
  return chuoi(lay(data, "messageId", "message_id", "msgId", "msg_id", "id"));
}

/** SĐT khách trong payload, chuẩn hoá `84XXXXXXXXX`. Số rác / cố định ⇒ `null`. */
function docSdt(data: Record<string, unknown>): string | null {
  const contact = laObject(data.contact) ? data.contact : null;
  const tho =
    lay(data, "contactPhone", "contact_phone", "phone", "phoneNormalized") ??
    (contact ? lay(contact, "phone", "phoneNormalized", "phone_normalized") : undefined);
  return canonicalPhone(tho);
}

/** Tên hiển thị của KHÁCH (không bao giờ lấy tên nhân viên — xem `docTin`). */
function docTenKhach(data: Record<string, unknown>): string | null {
  const contact = laObject(data.contact) ? data.contact : null;
  return contact ? chuoi(lay(contact, "fullName", "full_name", "crmName", "name")) : null;
}

/**
 * Hội thoại NHÓM? Chốt 9.6 loại hẳn nhóm: tin trong nhóm không tách được người, mà
 * luật chat #6 cấm tin của phụ huynh này lọt vào payload phụ huynh khác.
 *
 * Nhận cả chuỗi lẫn số vì zca-js đánh `ThreadType.User = 0` / `Group = 1`, còn API
 * public của ZaloCRM lại dùng chữ.
 */
function laNhom(data: Record<string, unknown>): boolean {
  const v = lay(data, "threadType", "thread_type", "conversationType");
  if (typeof v === "number") return v === 1;
  const s = chuoi(v);
  return s !== null && s.toLowerCase() === "group";
}

// ── Bảng ánh xạ chính ────────────────────────────────────────────────────────

/**
 * Dịch một payload webhook thành VIỆC. Không chạm DB, không hỏi quyền.
 *
 * @param now Mốc thay thế khi sự kiện trạng thái nick không kèm thời gian. Truyền
 *   vào (thay vì gọi `new Date()` bên trong) để test không phụ thuộc đồng hồ máy.
 */
export function dichPayloadZalocrm(input: {
  payload: unknown;
  orgCode: string;
  tenSuKienHeader?: string | null;
  now?: Date;
}): KetQuaDich {
  const orgCode = input.orgCode?.trim();
  if (!orgCode) {
    // Tiền tố org rỗng ⇒ `channelMessageId` mất phần tách org ⇒ tin của org sau bị
    // nuốt im lặng. Thà FAILED có mã còn hơn ghi một khoá sai.
    return loi("THIEU_ORG", "Thiếu mã tổ chức (orgCode) — không dựng được khoá chống trùng.");
  }

  const suKien = docLoaiSuKien(input.payload, input.tenSuKienHeader);
  if (!suKien) return loi("THIEU_SU_KIEN", "Payload không mang tên sự kiện (event).");

  const data = layData(input.payload);
  if (!data) return loi("PAYLOAD_KHONG_HOP_LE", "Thân webhook không phải một đối tượng JSON.");

  switch (suKien) {
    case "message.received":
      return docTin(data, orgCode, "DEN");
    case "message.sent":
      return docTin(data, orgCode, "DI");
    // Kế hoạch S3 gọi sự kiện này là `contact.phone_set`; mã THẬT của ZaloCRM bắn
    // `contact.updated` kèm `changes.phone`. Nhận cả hai tên để đợt nâng cấp fork
    // đổi tên cũng không làm rơi tin.
    case "contact.updated":
    case "contact.phone_set":
      return docCapNhatLienHe(data, orgCode);
    case "zalo.connected":
      return docTrangThaiNick(data, orgCode, "CONNECTED", input.payload, input.now);
    case "zalo.disconnected":
      return docTrangThaiNick(data, orgCode, "DISCONNECTED", input.payload, input.now);
    default:
      // `contact.created`, `friend.*`, `webhook.test`, và mọi tên lạ: PROCESSED và
      // bỏ qua. Đánh FAILED ở đây là đổ đỏ giả lên màn Tích hợp mỗi lần bên kia
      // thêm một sự kiện mới.
      return boQua(`SU_KIEN_KHONG_XU_LY:${suKien.slice(0, 40)}`);
  }
}

function docTin(
  data: Record<string, unknown>,
  orgCode: string,
  huong: HuongTin,
): KetQuaDich {
  if (laNhom(data)) return boQua("HOI_THOAI_NHOM");

  const messageId = chuoi(lay(data, "messageId", "message_id", "msgId", "msg_id", "id"));
  if (!messageId) {
    return loi("THIEU_MESSAGE_ID", "Thiếu messageId — không có khoá chống trùng thì không ghi.");
  }

  // Nick là `accountId` của hộp thư. BẮT BUỘC: khoá hội thoại là
  // `[channel, accountId, externalThreadId]`, dùng hằng "zalocrm" thay cho nó là
  // gộp một khách nhắn hai nick thành MỘT hội thoại.
  const zcrmAccountId = chuoi(
    lay(data, "zaloAccountId", "zalo_account_id", "accountId", "account_id"),
  );
  if (!zcrmAccountId) {
    return loi(
      "THIEU_ZALO_ACCOUNT_ID",
      "Thiếu zaloAccountId — bản gốc ZaloCRM chưa gửi trường này (cần việc F2 bên fork).",
    );
  }

  const zcrmConversationId = chuoi(
    lay(data, "conversationId", "conversation_id", "convId"),
  );
  if (!zcrmConversationId) {
    return loi("THIEU_CONVERSATION_ID", "Thiếu conversationId — không xác định được hội thoại.");
  }

  const senderUid = chuoi(lay(data, "senderUid", "sender_uid", "fromUid", "from_uid"));
  const threadId = chuoi(lay(data, "threadId", "thread_id", "peerUid", "peer_uid"));

  // 🔴 KHÁCH LÀ AI, theo chiều tin:
  //  · ĐẾN — `senderUid` chính là khách;
  //  · ĐI  — `senderUid` là UID NICK CỦA MÌNH, khách là đầu kia của luồng (`threadId`).
  // Lấy nhầm ở chiều ĐI thì `InboxIdentity` sinh ra mang danh chính nhân viên và
  // hội thoại của khách tách làm đôi — không có gì đỏ lên, chỉ lộ khi đọc lại lịch sử.
  const externalUserId = huong === "DEN" ? (senderUid ?? threadId) : threadId;
  if (!externalUserId) {
    return huong === "DEN"
      ? loi("THIEU_NGUOI_GUI", "Thiếu senderUid — không biết tin của khách nào.")
      : loi(
          "THIEU_NGUOI_NHAN",
          "Thiếu threadId — tin ĐI không suy được khách nhận (cần việc F2 bên fork).",
        );
  }

  const sentAt = thoiDiem(lay(data, "sentAt", "sent_at", "timestamp", "ts", "createdAt"));
  if (!sentAt) {
    // KHÔNG lấy `Date.now()` thay thế: tin đến trễ sẽ trông như vừa đến, `awaitingReply`
    // tính sai, và "khách chờ 3 tiếng" biến mất khỏi mọi báo cáo.
    return loi("THIEU_THOI_DIEM", "Thiếu/sai sentAt — không lấy giờ máy thay cho giờ tin.");
  }

  const contentType = chuoi(lay(data, "contentType", "content_type", "msgType")) ?? "text";
  const chu = chuoi(lay(data, "content", "text", "body", "message"));
  const coChu = chu !== null && contentType.toLowerCase() === "text";
  const body = coChu ? chu.slice(0, TRAN_NOI_DUNG) : NHAN_TIN_KHONG_CHU;

  // 🔴 `displayName` ghi đè lên chính danh tính KHÁCH (`ingest*` upsert nó). Ở chiều
  // ĐI, `senderName` là tên NHÂN VIÊN — dùng nó là đổi tên khách thành tên Sale
  // trong toàn bộ hộp thư. Nên chiều ĐI chỉ lấy tên từ `contact`.
  const tenKhach = docTenKhach(data);
  const displayName =
    huong === "DEN"
      ? (tenKhach ?? chuoi(lay(data, "senderName", "sender_name")))
      : tenKhach;

  const tin: TinDenNgoai = {
    channel: KENH_ZALOCRM,
    accountId: zcrmAccountId,
    externalUserId,
    externalThreadId: zcrmConversationId,
    // Tiền tố org là BẮT BUỘC — xem `[ZC-DP-02]`.
    channelMessageId: `${orgCode}:${messageId}`,
    body,
    // Chỉ giữ LOẠI nội dung, không giữ liên kết tệp: kho đính kèm ở lại bên ZaloCRM
    // (chốt phạm vi), và một URL tệp trong DB là một đường rò không hạn giờ.
    attachments: coChu ? undefined : { contentType: contentType.slice(0, 40) },
    sentAt,
    displayName,
  };

  return {
    ok: true,
    viec: {
      loai: "TIN",
      huong,
      tin,
      orgCode,
      zcrmAccountId,
      zcrmConversationId,
      zcrmContactId: chuoi(lay(data, "contactId", "contact_id")) ?? docMaLienHeTrongContact(data),
      phone: docSdt(data),
      sentByExternalId:
        huong === "DI"
          ? chuoi(lay(data, "sentByExternalId", "sent_by_external_id", "sentByUserId"))
          : null,
      noiDung: coChu ? body : "",
      sentAt,
    },
  };
}

/** `contact.id` lồng bên trong khối `contact` (một số payload chỉ có dạng này). */
function docMaLienHeTrongContact(data: Record<string, unknown>): string | null {
  const contact = laObject(data.contact) ? data.contact : null;
  return contact ? chuoi(lay(contact, "id", "contactId")) : null;
}

function docCapNhatLienHe(data: Record<string, unknown>, orgCode: string): KetQuaDich {
  const zcrmContactId =
    chuoi(lay(data, "contactId", "contact_id")) ?? docMaLienHeTrongContact(data);
  if (!zcrmContactId) return loi("THIEU_CONTACT_ID", "Thiếu contactId trong contact.updated.");

  const phone = docSdt(data) ?? docSdtTrongChanges(data);
  // ZaloCRM bắn `contact.updated` cho 9 trường; chỉ SĐT mới mở ra được đường nối
  // lead. Mọi thay đổi khác không có việc gì để làm ⇒ PROCESSED, không FAILED.
  if (!phone) return boQua("LIEN_HE_KHONG_DOI_SDT");

  return { ok: true, viec: { loai: "LIEN_HE", orgCode, zcrmContactId, phone } };
}

/** SĐT nằm trong khối diff `changes.phone` (`{from, to}` hoặc giá trị trần). */
function docSdtTrongChanges(data: Record<string, unknown>): string | null {
  const changes = laObject(data.changes) ? data.changes : null;
  if (!changes) return null;
  const p = changes.phone;
  if (laObject(p)) return canonicalPhone(lay(p, "to", "new", "value"));
  return canonicalPhone(p);
}

function docTrangThaiNick(
  data: Record<string, unknown>,
  orgCode: string,
  trangThai: "CONNECTED" | "DISCONNECTED",
  payload: unknown,
  now?: Date,
): KetQuaDich {
  const zcrmAccountId = chuoi(
    lay(data, "accountId", "account_id", "zaloAccountId", "zalo_account_id"),
  );
  if (!zcrmAccountId) return loi("THIEU_ACCOUNT_ID", "Thiếu accountId trong sự kiện nick.");

  const goc = laObject(payload) ? payload : {};
  const luc =
    thoiDiem(lay(data, "at", "timestamp", "ts", "occurredAt")) ??
    thoiDiem(lay(goc, "timestamp", "ts", "sentAt")) ??
    now ??
    new Date();

  return { ok: true, viec: { loai: "NICK", orgCode, zcrmAccountId, trangThai, luc } };
}
