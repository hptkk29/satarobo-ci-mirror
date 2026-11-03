// lib/integrations/zalocrm/duc-payload.ts — ĐỤC PII TRƯỚC KHI GHI `WebhookDelivery`.
//
// =============================================================================
// 🔴 VÌ SAO PHẢI VIẾT MỚI (repo CHƯA CÓ hàm nào làm việc này):
// `logWebhookDelivery` (`lib/lead/webhook.ts`) ghi `payload` NGUYÊN VĂN, không cắt,
// không đục. `redactContactsInText` (`lib/lead/pii.ts`) chỉ đục SĐT/email TRONG một
// chuỗi và chỉ được dùng ở tầng ĐỌC của hộp thư — nó KHÔNG thay được việc bỏ hẳn
// `content` khỏi bản ghi.
//
// Nếu bỏ bước này thì nội dung chat của phụ huynh (kèm số máy khách tự gõ giữa câu)
// nằm plaintext trong một bảng: KHÔNG có TTL, KHÔNG có cách ly cơ sở, và màn
// "Webhook lỗi — Replay" mở cho bất kỳ ai có `settings:edit` — tức QLCS cơ sở này
// đọc được sự cố của cơ sở kia. Với ZaloCRM (mỗi TIN một dòng, nhiều hơn hẳn webhook
// lead) thì đó là kho dữ liệu trẻ em tích lại theo tuần.
//
// ── HAI VIỆC, ĐỔI CHIỀU NHAU, PHẢI CÙNG ĐÚNG ────────────────────────────────
//  · BỎ nội dung + mọi trường định danh CON NGƯỜI (số máy, email, tên);
//  · GIỮ mọi trường định danh MÁY MÓC (messageId, conversationId, threadId,
//    zaloAccountId, contactId, orgCode, sentAt, contentType) — không có chúng thì
//    bảng này hết tác dụng đối soát, mà đối soát là lý do duy nhất nó tồn tại.
// Nội dung được thay bằng `{len, sha256}` chứ không xoá trắng: hai bên vẫn so được
// "có phải cùng một tin không" khi đối chiếu sự cố, mà không ai đọc được chữ.
//
// FILE THUẦN — không DB, không `server-only`.
// =============================================================================
import { createHash } from "node:crypto";

/** Giá trị thay cho một trường PII. Chuỗi cố định, KHÔNG giữ lại vài ký tự cuối. */
export const DA_DUC = "[đã đục]";

/** Dấu vết của một nội dung đã bỏ: đủ để đối soát, không đủ để đọc. */
export type NoiDungDaDuc = { len: number; sha256: string };

/**
 * Trần bảo vệ CHÍNH MÌNH: bên gửi là máy chủ của người khác. Payload lồng 10.000
 * tầng làm hàm đục tràn ngăn xếp ⇒ 5xx ⇒ ZaloCRM retry ⇒ vòng lặp. Cắt sớm rẻ hơn
 * mọi cách chữa.
 */
const SAU_TOI_DA = 8;
const PHAN_TU_TOI_DA = 20;
const NUT_TOI_DA = 400;
const CHUOI_TOI_DA = 200;

/** Ghi chú thay cho phần đã cắt — để người đọc bản ghi biết là mình đang xem bản rút. */
const DA_CAT = "[đã cắt]";

/**
 * Trường mang NỘI DUNG tin — thay bằng `{len, sha256}`.
 *
 * `notes`/`note` có mặt vì `PUT /contacts/:id` của ZaloCRM ghi được ghi chú tự do,
 * và ghi chú tự do là chỗ người ta chép nguyên số máy vào.
 */
const KHOA_NOI_DUNG = new Set([
  "content",
  "text",
  "body",
  "message",
  "caption",
  "noidung",
  "note",
  "notes",
]);

/**
 * Trường mang định danh CON NGƯỜI — đục hẳn.
 *
 * Tên người nằm đây cùng số máy, cố ý: `WebhookDelivery` hiện với mọi cơ sở cho ai
 * có `settings:edit`, nên "giữ tên cho dễ nhìn" là giữ lại đúng thứ không được nhìn.
 */
const KHOA_PII = new Set([
  "phone",
  "phonenormalized",
  "phone_normalized",
  "contactphone",
  "contact_phone",
  "email",
  "fullname",
  "full_name",
  "crmname",
  "crm_name",
  "sendername",
  "sender_name",
  "displayname",
  "display_name",
  "name",
  "address",
  "addressline",
  "address_line",
  "avatar",
  "avatarurl",
  "avatar_url",
  "birthdate",
  "birth_date",
  "gender",
  "occupation",
]);

/** Đính kèm: giữ SỐ LƯỢNG, bỏ liên kết tệp (một URL tệp là đường rò không hạn giờ). */
const KHOA_DINH_KEM = new Set(["attachments", "attachment", "files", "media"]);

/** Dấu vết của một nội dung: độ dài + băm. Cùng chữ ⇒ cùng băm, khác chữ ⇒ khác. */
export function ducNoiDung(v: string): NoiDungDaDuc {
  return { len: v.length, sha256: createHash("sha256").update(v, "utf8").digest("hex") };
}

/**
 * Bản đã đục của payload, sẵn sàng ghi vào `WebhookDelivery.payload`.
 *
 * KHÔNG BAO GIỜ NÉM và luôn trả thứ `JSON.stringify` được — nó chạy ngay trước
 * `logWebhookDelivery`, mà bước ghi vết là thứ cuối cùng được phép hỏng.
 */
export function ducPayload(payload: unknown): unknown {
  const dem = { soNut: 0 };
  try {
    return di(payload, 0, dem, null);
  } catch {
    // Kể cả khi có gì đó rất lạ, vẫn phải còn một dòng vết để biết đã nhận request.
    return { ghiChu: "KHONG_DUC_DUOC_PAYLOAD" };
  }
}

function di(
  v: unknown,
  sau: number,
  dem: { soNut: number },
  khoaCha: string | null,
): unknown {
  if (dem.soNut++ > NUT_TOI_DA) return DA_CAT;
  if (sau > SAU_TOI_DA) return DA_CAT;

  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return String(v);
  if (typeof v === "string") return chuoiTheoKhoa(v, khoaCha);
  if (Array.isArray(v)) {
    const giu = v.slice(0, PHAN_TU_TOI_DA).map((x) => di(x, sau + 1, dem, khoaCha));
    return v.length > PHAN_TU_TOI_DA ? [...giu, `${DA_CAT} (+${v.length - PHAN_TU_TOI_DA})`] : giu;
  }
  if (typeof v === "object") {
    const ra: Record<string, unknown> = {};
    for (const [k, gt] of Object.entries(v as Record<string, unknown>)) {
      const thuong = k.toLowerCase();
      if (KHOA_DINH_KEM.has(thuong)) {
        ra[k] = Array.isArray(gt) ? { soLuong: gt.length } : { coDinhKem: gt != null };
        continue;
      }
      if (KHOA_NOI_DUNG.has(thuong)) {
        ra[k] = typeof gt === "string" ? ducNoiDung(gt) : gt == null ? null : DA_DUC;
        continue;
      }
      if (KHOA_PII.has(thuong)) {
        // Đục KỂ CẢ khi giá trị là object/array (`changes.phone = {from, to}`):
        // đi sâu vào nó là để lọt đúng thứ vừa quyết định bỏ.
        ra[k] = gt == null ? null : DA_DUC;
        continue;
      }
      ra[k] = di(gt, sau + 1, dem, thuong);
    }
    return ra;
  }
  // Hàm/symbol không đến từ `JSON.parse` — nhưng `ducPayload` nhận `unknown`.
  return DA_CAT;
}

/** Chuỗi thường: cắt độ dài. Chuỗi nằm dưới một khoá PII/nội dung đã bị chặn ở trên. */
function chuoiTheoKhoa(v: string, khoaCha: string | null): unknown {
  if (khoaCha && KHOA_NOI_DUNG.has(khoaCha)) return ducNoiDung(v);
  if (khoaCha && KHOA_PII.has(khoaCha)) return DA_DUC;
  return v.length > CHUOI_TOI_DA ? `${v.slice(0, CHUOI_TOI_DA)}${DA_CAT}` : v;
}
