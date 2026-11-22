// lib/hoa-hong/hang-cho-ten-hanh-dong.ts — LÁ THUẦN: tên hành động kiểm toán dùng chung giữa `hang-cho.ts` (ghi) và `hang-cho-xu-ly.ts` (đọc). Không import gì.
//
// Tách ra để tránh vòng `hang-cho-xu-ly → dieu-chinh → hang-cho-so-nhom → hang-cho` (depcruise `no-circular`), và để tầng thuần không phải import tệp kéo `writeAudit`/DB (lưới `[HCX-W1]`).

/** Hàng chờ được MỞ LẠI (RESOLVED → OPEN, cùng `holdKey`) — `ghiHangCho` ghi cùng giao dịch với việc mở; mọi đề nghị cấp 1 lập TRƯỚC dòng này hết hiệu lực (`ganDauVoHieu`). */
export const HANH_DONG_MO_LAI = "REOPEN" as const;
