// lib/payments/memo-phat-hanh.ts — CHỌN khuôn nội dung CK lúc phát hành QR.
//
// Đây là chỗ DUY NHẤT quyết định một mã QR sắp in ra mang khuôn ĐỜI MỚI hay ĐỜI CŨ, và nó hỏi
// đúng một câu: công tắc `billing.flexV1Enabled` có bật cho cơ sở này không.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH RA MỘT TỆP RIÊNG THAY VÌ NHÉT VÀO `memo-ck.ts`
//
// `memo-ck.ts` là hàm THUẦN — test được mọi biến thể memo mà không cần Postgres. Nhét một lời
// gọi `getSetting` vào đó là biến cả tệp thành thứ phải mock mới test được, và khi đó những ca
// như "bốn biến thể memo cùng một kết quả" sẽ phải dựng DB để chạy. Ranh giới này giữ cho phần
// khó test (đọc cấu hình) nhỏ đúng bằng một hàm.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ MÃ ĐÃ PHÁT HÀNH CẤM ĐỔI
//
// Hàm này chỉ chọn khuôn cho QR **sắp in**. Nó KHÔNG đụng `matchKey` hay mã của phiếu đã có —
// bất biến #3 của repo (khoá sinh MỘT LẦN, bền theo đời phiếu). Một phụ huynh đang giữ ảnh QR
// cũ trong điện thoại vẫn chuyển được, vì parser nhận cả hai đời.
//
// Hệ quả phải biết khi TẮT cờ sau khi đã bật: phiếu đã phát hành theo khuôn mới giữ nguyên mã 5
// ký tự, và parser vẫn đọc được. Tắt cờ chỉ làm phiếu MỚI quay về khuôn cũ.

import { laThuTienLinhHoatBat } from "@/lib/finance/feature";
import { noiDungCkCoKhoa } from "./noi-dung-ck";
import { dungMemo } from "./memo-ck";

export type DauVaoMemo = {
  /** `OrgUnit.id` của cơ sở giữ đơn — quyết định công tắc. */
  orgUnitId?: string | null;
  /** Họ tên học viên trong hồ sơ, dùng cho phần TÊN của khuôn mới. */
  hoTen?: string | null;
  /** SĐT phụ huynh (mọi định dạng — hàm tự chuẩn hoá). */
  sdt?: string | null;
  /** Mã phiếu 5 ký tự của đời mới. Bỏ trống ⇒ buộc rơi về khuôn cũ. */
  maMoi?: string | null;
  /** `PaymentRequest.matchKey` — khoá của khuôn cũ. */
  matchKeyCu?: string | null;
  /** Phần người đọc của khuôn cũ (`TenCon_84SĐT_MaKhoa`), đã cắt đúng ngân sách. */
  phanNguoiDocCu?: string;
  /** Trần ký tự: 25 cho QR, 80 cho bản sale đọc cho phụ huynh gõ tay. */
  tran: number;
};

export type MemoPhatHanh = {
  noiDung: string;
  doi: "MOI" | "CU";
};

/**
 * Phép chọn khuôn — tách THUẦN để test được không cần DB.
 *
 * Rơi về khuôn CŨ trong hai ca, và cả hai đều là "chưa đủ dữ liệu cho khuôn mới", không phải
 * lỗi: công tắc tắt, hoặc phiếu chưa có mã 5 ký tự (sinh trước khi bật cờ).
 *
 * ⚠️ Vế `maMoi` KHÔNG thừa. Bật cờ không làm phiếu cũ mọc mã ra; thiếu vế này thì mọi phiếu
 * sinh trước lúc bật sẽ in một memo có chỗ của mã bỏ trống — tức một QR không khớp được gì.
 */
export function chonKhuonMemo(input: { bat: boolean; maMoi?: string | null }): "MOI" | "CU" {
  return input.bat === true && typeof input.maMoi === "string" && input.maMoi !== "" ? "MOI" : "CU";
}

/**
 * Dựng nội dung chuyển khoản cho một lần phát hành QR.
 */
export async function memoPhatHanh(input: DauVaoMemo): Promise<MemoPhatHanh> {
  const bat = await laThuTienLinhHoatBat(input.orgUnitId ?? null);
  if (chonKhuonMemo({ bat, maMoi: input.maMoi }) === "MOI") {
    return {
      noiDung: dungMemo({
        hoTen: input.hoTen ?? "",
        sdt: input.sdt ?? "",
        ma: input.maMoi as string,
      }),
      doi: "MOI",
    };
  }
  return {
    noiDung: noiDungCkCoKhoa(input.matchKeyCu ?? null, input.phanNguoiDocCu ?? "", input.tran),
    doi: "CU",
  };
}
