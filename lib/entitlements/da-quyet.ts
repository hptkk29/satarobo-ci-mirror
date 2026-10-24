// lib/entitlements/da-quyet.ts — QUYẾT ĐỊNH CỦA NGƯỜI XỬ LÝ TRÊN MỘT DÒNG HÀNG ĐỢI. THUẦN, không DB.
//
// Vấn đề (PR hàng đợi quyền học): `hanhDongChoChuyenDoi` / `hanhDongChoXepLop` trả `MO_LAI` mỗi khi dòng đã đóng mà điều kiện chờ vẫn đúng.
// Đó là hành vi ĐÚNG cho máy ("tiền lại thiếu ⇒ mở lại"), nhưng nó xoá sạch quyết định của người: người có quyền bấm "giữ quyền" / "đóng" cho một dòng
// CAN_THU_HOI, lượt hích hoặc cron đối soát kế tiếp thấy điều kiện còn nguyên ⇒ mở lại ngay — mỗi đêm, mãi mãi.
//
// Luật (chốt trong PR này, không có ở PR trước):
//   · Người đóng một dòng ⇒ ghi `payload.daQuyet` = { dauVan, hanhDong, boi, luc, lyDo }. `dauVan` là `lyDo` của dòng LÚC ĐÓ — dấu vân của điều kiện
//     mà người đã nhìn thấy và quyết.
//   · Máy tính ra cùng điều kiện (cùng `lyDo`) trên dòng đang đóng ⇒ `KHONG_LAM_GI`. Điều kiện ĐỔI (số tiền thiếu đổi, học viên khớp thêm hồ sơ…)
//     ⇒ `lyDo` đổi ⇒ khác dấu vân ⇒ mở lại CHÍNH dòng đó (khoá duy nhất `(orderItemId, loai)` là chỉ mục đầy đủ — "dòng mới" không tồn tại được mà
//     không đổi chỉ mục; xem docs/thu-hoc-phi-pham-vi/HANG-DOI-VAN-HANH.md).
//   · Hướng lỗi AN TOÀN: đổi câu chữ của một `lyDo` trong mã làm dòng đã quyết hiện lại một lần (người xem lại), KHÔNG BAO GIỜ làm mất cảnh báo.
//   · Dòng đóng bởi MÁY không có `daQuyet` (hoặc bị gỡ khi mở lại), nên không bao giờ bị chặn mở lại.
//
// Nguồn đọc DUY NHẤT là `payload` — không suy "người đóng" từ chữ trong `resolvedNote`.

import { Prisma } from "@prisma/client";

const laDoiTuong = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export const KHOA_DA_QUYET = "daQuyet" as const;

export type HanhDongDaQuyet = "DONG" | "GIU_QUYEN" | "THU_HOI" | "DANH_DAU_CAN_DUYET" | "DUYET_HOC_VUOT";

export interface DaQuyet {
  /** `lyDo` của dòng lúc người quyết — dấu vân của điều kiện. */
  readonly dauVan: string;
  readonly hanhDong: HanhDongDaQuyet;
  readonly boi: { readonly id: string | null; readonly ten: string };
  /** ISO. */
  readonly luc: string;
  /** Lý do người nhập (≥ 10 ký tự ở tầng action). */
  readonly lyDo: string;
}

/** Dấu vân của quyết định người, nếu `payload` mang. Hình dạng lạ ⇒ `null` (fail-open về phía MỞ LẠI: máy cứ cảnh báo). */
export function docDauVanDaQuyet(payload: unknown): string | null {
  if (!laDoiTuong(payload)) return null;
  const q = payload[KHOA_DA_QUYET];
  if (!laDoiTuong(q)) return null;
  return typeof q.dauVan === "string" && q.dauVan.length > 0 ? q.dauVan : null;
}

/** Đọc cả khối quyết định (cho giao diện). Hình dạng lạ ⇒ `null`. */
export function docDaQuyet(payload: unknown): DaQuyet | null {
  if (!laDoiTuong(payload)) return null;
  const q = payload[KHOA_DA_QUYET];
  if (!laDoiTuong(q)) return null;
  const boi = q.boi;
  if (typeof q.dauVan !== "string" || typeof q.hanhDong !== "string" || typeof q.luc !== "string" || typeof q.lyDo !== "string") return null;
  if (!laDoiTuong(boi) || typeof boi.ten !== "string") return null;
  return {
    dauVan: q.dauVan,
    hanhDong: q.hanhDong as HanhDongDaQuyet,
    boi: { id: typeof boi.id === "string" ? boi.id : null, ten: boi.ten },
    luc: q.luc,
    lyDo: q.lyDo,
  };
}

/** `payload` mới = payload cũ (giữ mọi khoá khác) + khối quyết định. */
export function ghiDaQuyet(payload: unknown, q: DaQuyet): Record<string, unknown> {
  const goc = laDoiTuong(payload) ? { ...payload } : {};
  return { ...goc, [KHOA_DA_QUYET]: q };
}

/**
 * `payload` sau khi GỠ khối quyết định (dùng khi máy MỞ LẠI dòng: quyết định cũ không còn áp cho điều kiện mới, và một dòng đóng bởi máy sau đó
 * không được thừa hưởng nó). `null` khi không còn gì để giữ — người gọi đổi `null` thành `Prisma.DbNull`.
 */
export function boDaQuyet(payload: unknown): Record<string, unknown> | null {
  if (!laDoiTuong(payload)) return null;
  if (!(KHOA_DA_QUYET in payload)) return payload;
  const { [KHOA_DA_QUYET]: _bo, ...conLai } = payload;
  return Object.keys(conLai).length > 0 ? conLai : null;
}

/**
 * Mảnh `data` cho phép ghi MỞ LẠI một dòng: gỡ khối quyết định nếu có, KHÔNG đụng `payload` nếu không có gì để gỡ (tránh ghi thừa ⇒ `updatedAt` nhấp nháy).
 * Dùng bằng `...payloadSauMoLai(cho.payload)` trong `data` của `update`.
 */
export function payloadSauMoLai(payload: unknown): { payload?: Prisma.InputJsonValue | typeof Prisma.DbNull } {
  if (docDauVanDaQuyet(payload) === null) return {};
  const con = boDaQuyet(payload);
  return { payload: con === null ? Prisma.DbNull : (con as Prisma.InputJsonValue) };
}
