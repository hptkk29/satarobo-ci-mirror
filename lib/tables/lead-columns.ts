// lib/tables/lead-columns.ts — DANH MỤC CỘT của bảng Lead (/admin/leads).
//
// Thêm cột mới = thêm MỘT dòng ở đây + MỘT `case` trong `LeadCell`
// (`app/(admin)/admin/leads/_components/leads-table.tsx`). Test `lead-columns.test.ts`
// đỏ nếu thiếu một trong hai — không có nó thì cột hiện trong hộp chọn mà ô luôn trống,
// và người dùng tưởng dữ liệu bị mất.
//
// File THUẦN: không import Prisma/auth, client component kéo theo được.

/**
 * Khoá bảng có namespace — bảng thứ hai (học viên, đơn hàng…) chỉ cần khai danh mục
 * riêng và thêm khoá vào `TABLE_KEYS`, KHÔNG phải đổi schema.
 *
 * (G-04, `20260825235000_g04_add_user_table_preference`. Giữ lại khi hợp nhất `main` →
 * `test` ngày 16/09/2026: nhánh `main` chưa có tính năng lưu bố cục bảng theo người, nên
 * bản `lead-columns.ts` bên đó không khai hai hằng này — mà `lib/validators/table-preference.ts`
 * thì cần. Bỏ đi là màn Lead mất bộ cột riêng của từng người.)
 */
export const LEAD_TABLE_KEY = "admin.leads.list";

export const TABLE_KEYS = [LEAD_TABLE_KEY] as const;
export type TableKey = (typeof TABLE_KEYS)[number];

export type LeadColumn = {
  key: string;
  label: string;
  /** Có nằm trong bộ mặc định không. */
  macDinh: boolean;
  /** Cột KHÔNG tắt được (bỏ đi thì bảng vô nghĩa). */
  batBuoc?: boolean;
};

/**
 * Thứ tự ở đây là thứ tự MẶC ĐỊNH. Từ 30/08/2026 người dùng đổi được cả HIỆN/ẨN lẫn
 * THỨ TỰ (chủ dự án chốt), lưu trong `localStorage` — mỗi người một bộ.
 *
 * Hệ quả phải nhớ: ĐỪNG mô tả cột theo VỊ TRÍ ("cột thứ ba") trong tài liệu hay lời
 * nhắn — hai người đang xem hai thứ tự khác nhau. Gọi theo TÊN cột.
 */
export const LEAD_COLUMNS: readonly LeadColumn[] = [
  { key: "parentName", label: "Phụ huynh / học sinh", macDinh: true, batBuoc: true },
  { key: "phone", label: "Số điện thoại", macDinh: true },
  { key: "course", label: "Khóa quan tâm", macDinh: true },
  { key: "status", label: "Trạng thái", macDinh: true },
  { key: "center", label: "Cơ sở", macDinh: true },
  { key: "assignedTo", label: "Sale phụ trách", macDinh: true },
  // 30/08 — đổi tên từ "Ngày đăng ký": lead vào hệ thống chưa phải là đã đăng ký học,
  // gọi vậy làm người đọc tưởng đây là mốc chốt đơn. Có kèm GIỜ vì trong ngày cao
  // điểm, thứ tự nhận lead trong cùng một ngày mới là thứ Sale cần.
  // ⚠️ 07/09 — ô này IN NGÀY NHẬN HIỆU LỰC (`lastInboundAt` khi khách quay lại), chứ
  // không phải `createdAt` trần. Xem `laNhapLai` cuối file.
  { key: "createdAt", label: "Ngày nhận lead", macDinh: true },
  // 30/08 — MẶC ĐỊNH ẨN (chủ dự án chốt). Cột này chỉ có nghĩa với phiếu khách quay
  // lại; để mặc định thì đa số dòng in ra đúng bằng "Ngày nhận lead", tốn một cột
  // ngang mà không nói thêm gì.
  // 07/09 — nay còn TRÙNG nhiều hơn nữa: "Ngày nhận lead" đã in mốc quay lại. Giữ vì
  // nó là chỗ DUY NHẤT xem được mốc thô, và vì gỡ một cột là quyết định của chủ dự án.
  { key: "lastInboundAt", label: "Lần nhập gần nhất", macDinh: false },
  { key: "childName", label: "Tên con", macDinh: false },
  { key: "childAge", label: "Tuổi con", macDinh: false },
  { key: "email", label: "Email", macDinh: false },
  { key: "source", label: "Nguồn", macDinh: false },
  { key: "note", label: "Ghi chú", macDinh: false },
  { key: "utmCampaign", label: "Chiến dịch (UTM)", macDinh: false },
];

export const LEAD_COLUMN_KEYS: readonly string[] = LEAD_COLUMNS.map((c) => c.key);

/** Khoá lưu lựa chọn trong trình duyệt — mỗi người một bộ, không đụng người khác. */
export const LEAD_COLUMNS_STORAGE_KEY = "satarobo:leads:cols:v1";

export function cotMacDinh(): string[] {
  return LEAD_COLUMNS.filter((c) => c.macDinh).map((c) => c.key);
}

/**
 * Làm sạch danh sách cột đọc từ trình duyệt.
 *
 * Ba việc, thiếu việc nào cũng vỡ bảng:
 *   · bỏ khoá lạ (cột đã xoá khỏi mã nguồn) — nếu không, bảng cố render một `case`
 *     không tồn tại và ra ô trống mãi mãi;
 *   · luôn kèm cột BẮT BUỘC, kể cả khi người dùng bỏ nó đi;
 *   · GIỮ ĐÚNG THỨ TỰ NGƯỜI DÙNG ĐÃ CHỌN (30/08 — chủ dự án chốt cho sắp xếp).
 *
 * ⚠️ Đảo chốt 30/08 sáng ("thứ tự cố định theo danh mục"). Lý do cũ — "hai người mô
 * tả 'cột thứ ba' sẽ nói về hai cột khác nhau" — vẫn đúng, nhưng đổi lại người dùng
 * được xếp bảng theo cách họ làm việc. Hệ quả phải nhớ: ĐỪNG mô tả cột theo VỊ TRÍ
 * trong tài liệu hay lời nhắn, chỉ gọi theo TÊN.
 *
 * Rỗng hoặc hỏng thì rơi về bộ mặc định — thà thấy bộ mặc định còn hơn bảng trắng.
 */
export function chuanHoaCot(raw: unknown): string[] {
  const hopLe = new Set(LEAD_COLUMN_KEYS);
  const batBuoc = LEAD_COLUMNS.filter((c) => c.batBuoc).map((c) => c.key);
  if (!Array.isArray(raw)) return cotMacDinh();

  // Giữ thứ tự người dùng, khử trùng, bỏ khoá lạ.
  const ra: string[] = [];
  for (const x of raw) {
    if (typeof x === "string" && hopLe.has(x) && !ra.includes(x)) ra.push(x);
  }
  // Cột bắt buộc thiếu thì chèn lên ĐẦU: nó là cột định danh, nằm giữa bảng thì
  // người đọc không biết mỗi dòng nói về ai cho tới khi cuộn tới nó.
  for (const k of batBuoc) if (!ra.includes(k)) ra.unshift(k);

  return ra.length > batBuoc.length ? ra : cotMacDinh();
}

/**
 * Dời một cột lên/xuống MỘT bậc. Trả về danh sách mới (không sửa mảng gốc).
 *
 * Dùng nút lên/xuống chứ không kéo-thả: kéo-thả cần thư viện, cần xử lý bàn phím
 * riêng cho người không dùng chuột, và ở một hộp 14 dòng thì hai cái nút là đủ.
 */
export function doiChoCot(cot: string[], key: string, huong: -1 | 1): string[] {
  const i = cot.indexOf(key);
  const j = i + huong;
  if (i === -1 || j < 0 || j >= cot.length) return cot;
  const ra = [...cot];
  [ra[i], ra[j]] = [ra[j], ra[i]];
  return ra;
}

/**
 * Phiếu này có phải khách QUAY LẠI không (để ô "Ngày nhận lead" in mốc mới + dán nhãn).
 *
 * ⚠️ Phải là `>` chứ KHÔNG phải `>=`. Lúc tạo lead, `lastInboundAt` được đặt BẰNG
 * `createdAt` (`lib/lead/intake/ingest.ts`, `lib/lead/assign-lead.ts`) — dùng `>=` là
 * dán nhãn "nhập lại" lên MỌI phiếu, nhãn mất sạch ý nghĩa mà không ai thấy sai ngay.
 *
 * `null` = lead cũ chưa có mốc (trước migration 29/08, hoặc chèn bằng SQL thô) ⇒ không
 * kết luận gì, coi như chưa quay lại.
 *
 * Nhận CHUỖI ISO: đó là dạng dữ liệu đi từ server sang bảng (`toISOString()`), và ISO
 * 8601 cùng múi Z thì so chuỗi ra đúng thứ tự thời gian.
 */
export function laNhapLai(
  createdAt: string,
  lastInboundAt: string | null | undefined,
): boolean {
  return !!lastInboundAt && lastInboundAt > createdAt;
}
