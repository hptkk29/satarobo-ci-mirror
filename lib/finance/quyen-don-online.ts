import type { Actor } from "@/lib/auth/actor";
import { coQuyenToanHeThong } from "@/lib/auth/quyen-tai-co-so";

/**
 * THAO TÁC TIỀN / TRẠNG THÁI trên đơn ONLINE (M8 P0-1, 28/11/2026) — xác nhận · từ chối · sửa · điều chỉnh khoản thu, đổi trạng thái đơn.
 *
 * Vì sao cần ngoài `checkPermission` + `scopedDb`: đơn và khoản thu Online mang `centerId = NULL`. Người kiêm một vai neo Hội sở có BẤT KỲ khoá nào cùng tiền tố
 * (`payments:*` / `orders:*`) nhìn thấy chúng, rồi ghi bằng khoá của thao tác mà họ chỉ giữ ở CƠ SỞ (`can()` không target ⇒ `GLOBAL` luôn đúng). NHÌN THẤY ≠ ĐƯỢC GHI.
 *
 * Luật: CHÍNH (các) khoá của thao tác phải được giữ ở tầm toàn hệ (`coQuyenToanHeThong`: Quản trị tối cao · grant ALLOW per-user · dòng quyền có `centerScope === "ALL"`).
 * Vai nào giữ đúng khoá đó ở Hội sở vẫn làm được như cũ. KHÔNG đòi thêm `isHoLevel`: các màn này chưa bao giờ đòi vế đó, thêm vào là tước quyền của người được cấp riêng.
 * (Hoàn tiền Online đi cổng RIÊNG `duocQuanLyHoanOnline`, giữ nguyên độ chặt cũ của API đó.) Đơn không phải Online: không dùng hàm này.
 */
export const CAU_THIEU_QUYEN_DON_ONLINE = "Không có quyền thao tác trên đơn Online — quyền này phải được giữ ở tầm toàn hệ thống";

export function giuKhoaToanHe(actor: Pick<Actor, "isSuperAdmin" | "grantsAllow" | "permissions">, ...khoa: [string, ...string[]]): boolean {
  return khoa.every((k) => coQuyenToanHeThong(actor, k));
}

/**
 * CỔNG CHUNG cho mọi thao tác GHI lên một đơn: gọi NGAY SAU phép đọc đơn có kiểm phạm vi, trước mọi phép ghi. `null` = được đi tiếp.
 * `loaiDon` đọc từ DB (`Order.type`) — KHÔNG nhận từ client. Đơn không phải Online ⇒ luôn `null` (đường offline y nguyên).
 * Lưới `[QDO-*]` (`quyen-don-online-luoi.test.ts`) bắt Server Action ghi đơn / tiền mới mà chưa qua cổng.
 */
export function loiQuyenDonOnline(
  loaiDon: string | null | undefined,
  actor: Pick<Actor, "isSuperAdmin" | "grantsAllow" | "permissions">,
  ...khoa: [string, ...string[]]
): string | null {
  return loaiDon === "ONLINE" && !giuKhoaToanHe(actor, ...khoa) ? CAU_THIEU_QUYEN_DON_ONLINE : null;
}
