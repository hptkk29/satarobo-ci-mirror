import { canonicalPhone } from "@/lib/phone";
import { centerHintFromText, parentNameFallback, str } from "./normalize";
import type { MapResult } from "./types";

// =============================================================================
// MAPPER — quatang.edu.vn.
//
// Đường đi: trang quatang POST JSON vào Apps Script web-app (`doPost`), script
// ghi 1 dòng vào Google Sheet rồi gọi tiếp sang ta. Ta nhận ĐÚNG payload gốc mà
// site gửi cho script — KHÔNG đọc lại hàng đã ghi xuống sheet.
//
// Vì sao không đọc sheet (đo 16/08/2026 trên dữ liệu thật):
//  - Ô SĐT định dạng số nên sheet NUỐT SỐ 0 ĐẦU; payload gốc thì còn nguyên chuỗi.
//  - Thứ tự cột đã đổi 3 lần từ 19/05 tới nay.
// Payload gốc có tên trường ⇒ miễn nhiễm với cả hai.
//
// ⚠️ Ràng buộc phía script LỎNG HƠN ta: nó nhận `/^(\+84|0)\d{8,10}$/`, tức
// chấp cả số 9 lẫn 11 chữ số. Số nào `canonicalPhone` không nhận sẽ bị TỪ CHỐI
// ở đây — nhưng payload vẫn nằm nguyên trong `WebhookDelivery` (gửi lại được)
// và hàng vẫn nằm trong sheet, nên không mất gì.
// =============================================================================

/** Tên trường trong JSON mà trang quatang gửi (khớp `doPost` v2.5). */
export const QUATANG_FIELDS = {
  childName: "ho_ten_con",
  parentName: "ho_ten",
  phone: "sdt",
  email: "email",
  schoolName: "truong",
  gradeLevel: "lop",
  center: "co_so",
  province: "tinh",
  source: "source",
  ip: "ip",
  userAgent: "user_agent",
  affLinkLast: "aff_ma_link_cuoi",
  affLinkFirst: "aff_ma_link_dau",
  affEmployeeCode: "aff_ma_nv",
  affEmployeeName: "aff_ten_nv",
  affClickId: "aff_click_id",
  affClickAt: "aff_thoi_diem_click",
  affUtm: "aff_utm",
  misaStatus: "misa_status",
  eventId: "event_id",
} as const;

/** Trần độ dài — endpoint công khai, cùng lý do như mapper form Sale. */
const MAX_LEN: Record<string, number> = {
  [QUATANG_FIELDS.childName]: 100,
  [QUATANG_FIELDS.parentName]: 100,
  [QUATANG_FIELDS.phone]: 20,
  [QUATANG_FIELDS.email]: 120,
  [QUATANG_FIELDS.schoolName]: 150,
  [QUATANG_FIELDS.gradeLevel]: 50,
  [QUATANG_FIELDS.center]: 150,
  [QUATANG_FIELDS.province]: 80,
  [QUATANG_FIELDS.affEmployeeCode]: 50,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
}

/** IP thật của phụ huynh nằm TRONG payload — request tới ta mang IP của Google. */
export function quatangClientMeta(payload: unknown): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const p = asRecord(payload);
  return {
    ipAddress: str(p[QUATANG_FIELDS.ip]),
    userAgent: str(p[QUATANG_FIELDS.userAgent]),
  };
}

/**
 * Khoá idempotency. Ưu tiên `event_id` do script gửi; không có thì dựng từ
 * SĐT đã chuẩn hoá + mốc thời gian, để chạy lại script không đẻ lead trùng.
 */
export function quatangExternalId(payload: unknown): string | null {
  const p = asRecord(payload);
  const explicit = str(p[QUATANG_FIELDS.eventId]);
  if (explicit) return explicit;

  const phone = canonicalPhone(p[QUATANG_FIELDS.phone]);
  const at = str(p["ts"]) ?? str(p[QUATANG_FIELDS.affClickAt]);
  return phone && at ? `${at}-${phone}` : null;
}

export function mapQuatang(payload: unknown): MapResult {
  const p = asRecord(payload);
  const get = (k: string) => str(p[k]);

  for (const [field, max] of Object.entries(MAX_LEN)) {
    const value = get(field);
    if (value && value.length > max) {
      return { ok: false, error: `Trường "${field}" dài quá ${max} ký tự.` };
    }
  }

  const rawPhone = get(QUATANG_FIELDS.phone);
  const phone = canonicalPhone(rawPhone);
  if (!phone) {
    return {
      ok: false,
      error: rawPhone
        ? `Số điện thoại "${rawPhone}" không phải di động VN hợp lệ.`
        : "Thiếu số điện thoại phụ huynh",
    };
  }

  const warnings: string[] = [];
  const noteLines: string[] = [];

  const childName = get(QUATANG_FIELDS.childName);
  let parentName = get(QUATANG_FIELDS.parentName);
  if (!parentName) {
    // Có thật: cả một đợt của sheet bỏ trống hẳn cột tên phụ huynh.
    parentName = parentNameFallback(childName);
    warnings.push("Phiếu không có tên phụ huynh — cần hỏi lại khi gọi.");
  }

  const rawEmail = get(QUATANG_FIELDS.email);
  let email: string | null = null;
  if (rawEmail) {
    if (EMAIL_RE.test(rawEmail)) email = rawEmail;
    else warnings.push(`Email "${rawEmail}" sai định dạng — chưa lưu.`);
  }

  const province = get(QUATANG_FIELDS.province);
  if (province) noteLines.push(`Tỉnh/TP: ${province}`);

  // ── Attribution affiliate ────────────────────────────────────────────────
  // Mã link là hệ affiliate RIÊNG của quatang (tab Links của sheet AffLinks),
  // KHÔNG phải `Affiliate.code` của repo ⇒ chỉ ghi vào note để truy ngược, không
  // tự gán `Lead.affiliateId` (gán bừa là chia hoa hồng sai người).
  const affName = get(QUATANG_FIELDS.affEmployeeName);
  const affLinkLast = get(QUATANG_FIELDS.affLinkLast);
  const affLinkFirst = get(QUATANG_FIELDS.affLinkFirst);
  const affClickId = get(QUATANG_FIELDS.affClickId);
  const affUtm = get(QUATANG_FIELDS.affUtm);

  if (affName) noteLines.push(`NV giới thiệu: ${affName}`);
  if (affLinkLast) {
    noteLines.push(
      `Mã link giới thiệu: ${affLinkLast}` +
        (affLinkFirst && affLinkFirst !== affLinkLast ? ` (chạm đầu: ${affLinkFirst})` : ""),
    );
  }
  if (affClickId) noteLines.push(`Aff clickId: ${affClickId}`);
  if (affUtm) noteLines.push(`UTM: ${affUtm}`);

  // Cột "MISA status" trên sheet trống 100% tính tới 16/08 — site không báo về.
  // Nếu một ngày nó báo lỗi thì lead của ta phải nói ra, đừng để chỉ nằm ở sheet.
  const misaStatus = get(QUATANG_FIELDS.misaStatus);
  if (misaStatus && misaStatus !== "OK") {
    warnings.push(`Site báo đẩy MISA thất bại (misa_status=${misaStatus}).`);
  }

  return {
    ok: true,
    lead: {
      parentName,
      phone,
      email,
      centerHint: centerHintFromText(get(QUATANG_FIELDS.center)),
      children: childName
        ? [
            {
              fullName: childName,
              schoolName: get(QUATANG_FIELDS.schoolName),
              gradeLevel: get(QUATANG_FIELDS.gradeLevel),
            },
          ]
        : [],
      employeeCode: get(QUATANG_FIELDS.affEmployeeCode),
      noteLines,
      externalId: quatangExternalId(payload),
      // Phụ huynh TỰ điền form trên landing page ⇒ đây là đăng ký chủ động,
      // khác phiếu Sale nhập hộ.
      consentMarketing: true,
      warnings,
    },
  };
}
