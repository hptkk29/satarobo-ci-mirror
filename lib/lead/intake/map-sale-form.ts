import { canonicalPhone } from "@/lib/phone";
import { misaProvinceName } from "./misa-provinces";
import {
  centerHintFromIndex,
  parentNameFallback,
  str,
} from "./normalize";
import type { MapResult } from "./types";

// =============================================================================
// MAPPER — "Form nhập liên hệ từ Sale", biểu mẫu tĩnh `sale.satarobo.vn/nhap-lieu.html`.
//
// ⛔ Biểu mẫu đó đã NGHỈ 22/08/2026 (thay bằng `satarobo.vn/nhap-khach-hang`, xem
// `map-internal-form.ts`). File này GIỮ LẠI vì `lib/crm/webhook-replay.ts` còn
// phát lại các `WebhookDelivery` nguồn "sale-form" đã nhận trước đó qua đúng đây.
//
// Tên trường GIỮ NGUYÊN của MISA (`LastName`, `CustomField15`…) vì trong giai
// đoạn chuyển tiếp ta còn mirror y nguyên payload sang MISA (QĐ-3). Đổi tên
// trường ở form là làm gãy đường mirror.
//
// ⚠️ Bẫy đặt tên của MISA: `LastName` là TÊN HỌC SINH, KHÔNG phải họ của phụ
// huynh. Tên PH nằm ở `CustomField25`. Map ngược là hỏng toàn bộ dữ liệu.
// =============================================================================

/** Tên trường trong form — cũng là danh sách được phép mirror sang MISA. */
export const SALE_FORM_FIELDS = {
  childName: "LastName",
  parentName: "CustomField25",
  phone: "CustomField15",
  email: "Email",
  centerIndex: "CustomField17",
  schoolName: "CustomField14",
  gradeLevel: "CustomField13",
  employeeCode: "CustomField26",
  provinceId: "ShippingProvinceID",
  address: "ShippingAddress",
} as const;

/** Ô bẫy bot — người thật không nhìn thấy nên luôn rỗng. */
export const SALE_FORM_HONEYPOT = "sr_website";

/**
 * Trần độ dài từng trường. Endpoint này CÔNG KHAI (không auth) nên thiếu trần là
 * mời người ta bơm chuỗi 80k ký tự vào `Lead.parentName` — cột Postgres `text`
 * không chặn, và bảng `/admin/leads` sẽ kéo nguyên khối đó xuống payload RSC.
 * Lấy đúng trần của đường lead công khai còn lại (`lib/validators/lead.ts`).
 */
const MAX_LEN: Record<string, number> = {
  [SALE_FORM_FIELDS.childName]: 100,
  [SALE_FORM_FIELDS.parentName]: 100,
  [SALE_FORM_FIELDS.phone]: 20,
  [SALE_FORM_FIELDS.email]: 120,
  [SALE_FORM_FIELDS.centerIndex]: 10,
  [SALE_FORM_FIELDS.schoolName]: 150,
  [SALE_FORM_FIELDS.gradeLevel]: 50,
  [SALE_FORM_FIELDS.employeeCode]: 50,
  [SALE_FORM_FIELDS.provinceId]: 10,
  [SALE_FORM_FIELDS.address]: 255,
};

const FIELD_LABEL: Record<string, string> = {
  [SALE_FORM_FIELDS.childName]: "Tên học sinh",
  [SALE_FORM_FIELDS.parentName]: "Tên phụ huynh",
  [SALE_FORM_FIELDS.phone]: "SĐT phụ huynh",
  [SALE_FORM_FIELDS.email]: "Email phụ huynh",
  [SALE_FORM_FIELDS.schoolName]: "Trường con đang học",
  [SALE_FORM_FIELDS.gradeLevel]: "Lớp",
  [SALE_FORM_FIELDS.employeeCode]: "Mã số NV",
  [SALE_FORM_FIELDS.address]: "Địa chỉ chi tiết",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trường nào dài quá trần thì nêu tên trường ra — người nhập sửa được ngay. */
function findTooLong(payload: Record<string, string>): string | null {
  for (const [field, max] of Object.entries(MAX_LEN)) {
    const value = payload[field];
    if (typeof value === "string" && value.trim().length > max) {
      return `${FIELD_LABEL[field] ?? field} dài quá ${max} ký tự.`;
    }
  }
  return null;
}

export function mapSaleForm(payload: Record<string, string>): MapResult {
  const tooLong = findTooLong(payload);
  if (tooLong) return { ok: false, error: tooLong };

  const get = (k: string) => str(payload[k]);

  const rawPhone = get(SALE_FORM_FIELDS.phone);
  const phone = canonicalPhone(rawPhone);
  if (!phone) {
    // MISA chỉ bắt buộc `LastName` nên SĐT có thể trống hoặc sai — ta bắt buộc,
    // vì lead không có SĐT thì Sale không làm gì được với nó.
    return {
      ok: false,
      error: rawPhone
        ? "Số điện thoại không hợp lệ (cần số di động Việt Nam)"
        : "Thiếu số điện thoại phụ huynh",
    };
  }

  const warnings: string[] = [];
  const noteLines: string[] = [];

  const childName = get(SALE_FORM_FIELDS.childName);
  let parentName = get(SALE_FORM_FIELDS.parentName);
  if (!parentName) {
    parentName = parentNameFallback(childName);
    warnings.push("Phiếu không có tên phụ huynh — cần hỏi lại khi gọi.");
  }

  // Email sai định dạng ⇒ bỏ qua + cảnh báo, KHÔNG chặn phiếu: email là ô phụ,
  // chặn cả lead chỉ vì gõ thiếu dấu chấm là đánh đổi sai.
  const rawEmail = get(SALE_FORM_FIELDS.email);
  let email: string | null = null;
  if (rawEmail) {
    if (EMAIL_RE.test(rawEmail)) email = rawEmail;
    else warnings.push(`Email "${rawEmail}" sai định dạng — chưa lưu, hỏi lại giúp.`);
  }

  const rawProvince = get(SALE_FORM_FIELDS.provinceId);
  if (rawProvince) {
    const provinceName = misaProvinceName(rawProvince);
    if (provinceName) noteLines.push(`Tỉnh/TP: ${provinceName}`);
    else warnings.push(`Mã tỉnh/TP lạ từ form: ${rawProvince}`);
  }

  const address = get(SALE_FORM_FIELDS.address);
  if (address) noteLines.push(`Địa chỉ: ${address}`);

  const employeeCode = get(SALE_FORM_FIELDS.employeeCode);
  if (employeeCode) noteLines.push(`Nhân viên nhập: ${employeeCode}`);

  return {
    ok: true,
    lead: {
      parentName,
      phone,
      email,
      centerHint: centerHintFromIndex(get(SALE_FORM_FIELDS.centerIndex)),
      children: childName
        ? [
            {
              fullName: childName,
              schoolName: get(SALE_FORM_FIELDS.schoolName),
              gradeLevel: get(SALE_FORM_FIELDS.gradeLevel),
            },
          ]
        : [],
      employeeCode,
      noteLines,
      // Phiếu do NHÂN VIÊN nhập hộ khi tư vấn trực tiếp — không có ô tick đồng
      // ý. Giữ `true` cho khớp 3 nguồn webhook đang chạy, nhưng ghi rõ xuất xứ
      // để sau này rà lại consent không phải đoán.
      consentMarketing: true,
      externalId: null,
      warnings,
    },
  };
}
