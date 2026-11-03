// lib/orders/loc-trang-thai.ts — Ô "TRẠNG THÁI ĐƠN" trên màn danh sách. THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO MỘT TỆP RIÊNG CHO MỘT Ô CHỌN [25/09/2026]
//
// Chủ dự án: *"thêm trạng thái đơn chờ duyệt, khi đơn vượt quá mức mà quản lý chưa duyệt
// nữa chứ"*.
//
// Đúng — với người dùng, "đang chờ duyệt" LÀ một trạng thái của đơn. Nhưng trong DB nó
// KHÔNG phải: `OrderStatus` là enum (`DRAFT`…`REFUNDED`), còn "chờ duyệt" nằm ở hai cột
// khác (`discountApprovalStatus` / `installmentApprovalStatus`). Một ô chọn duy nhất phải
// che được cả hai thế giới ấy.
//
// ⚠️ Phép ánh xạ HAI CHIỀU là chỗ dễ sai nhất và hỏng CÂM:
//   · chiều ĐỌC  — bộ lọc hiện tại thì ô chọn phải hiện đúng mục nào đang bật;
//   · chiều GHI  — chọn "Chờ duyệt" thì phải bật `choDuyet` VÀ xoá `status`.
// Quên vế "xoá `status`" là người dùng chọn "Chờ duyệt" sau khi đã chọn "Hoàn tất", rồi
// nhận về danh sách rỗng mà không hiểu vì sao — hai điều kiện AND với nhau. Không lỗi nào
// báo, không ca test nào đỏ nếu chỉ test từng vế.
//
// Nên hai chiều nằm cạnh nhau ở đây, có bộ ca `[LTT-*]` khoá chúng vào nhau.

import type { OrderStatus } from "@prisma/client";

/** Giá trị đặc biệt của ô chọn — KHÔNG phải `OrderStatus`. */
export const MOI_TRANG_THAI = "ALL";
export const CHO_DUYET = "CHO_DUYET";

/** Phần bộ lọc mà ô này làm chủ. Hai khoá, luôn đi cùng nhau. */
export type PhanLocTrangThai = {
  status: OrderStatus | undefined;
  choDuyet: true | undefined;
};

/**
 * Ô chọn đang hiện mục nào, suy từ bộ lọc hiện tại.
 *
 * ⚠️ `choDuyet` THẮNG `status` khi cả hai cùng bật. Không phải lựa chọn tuỳ ý: đường GHI
 * bên dưới không bao giờ tạo ra trạng thái đó, nên nếu nó xuất hiện thì là dữ liệu tới từ
 * URL gõ tay — và khi ấy hiện "Chờ duyệt" là mô tả đúng hơn phần đang siết chặt danh sách.
 */
export function giaTriOLocTrangThai(loc: {
  status?: OrderStatus;
  choDuyet?: boolean;
}): string {
  if (loc.choDuyet) return CHO_DUYET;
  return loc.status ?? MOI_TRANG_THAI;
}

/**
 * Người dùng vừa chọn một mục ⇒ phần bộ lọc mới.
 *
 * ⚠️ LUÔN trả về CẢ HAI khoá, kể cả khi một khoá là `undefined`. Trả về một đối tượng
 * thưa (`{ choDuyet: true }`) rồi để chỗ gọi `{...cũ, ...mới}` là giữ nguyên `status` cũ —
 * đúng con bug mô tả ở đầu tệp. Trả đủ hai khoá thì phép trộn tự xoá vế kia.
 */
export function docOLocTrangThai(giaTri: string | null | undefined): PhanLocTrangThai {
  if (giaTri === CHO_DUYET) return { status: undefined, choDuyet: true };
  if (!giaTri || giaTri === MOI_TRANG_THAI) return { status: undefined, choDuyet: undefined };
  return { status: giaTri as OrderStatus, choDuyet: undefined };
}
