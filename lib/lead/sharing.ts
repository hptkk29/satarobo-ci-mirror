// lib/lead/sharing.ts — Đợt E (22/08/2026): lead độc quyền tuyệt đối.
//
// Chủ dự án chốt Q8 (21/08): bỏ tính năng "dùng chung lead trong cơ sở".
//
// ⚠️ ĐÂY LÀ ĐẢO MỘT QUYẾT ĐỊNH ĐÃ KÝ của chính chủ dự án — BGĐ câu 10, ký
// 10/07/2026 — và tính năng ĐANG CHẠY TRÊN PROD. Người đang dựa vào nó sẽ mất
// quyền xem ngay ngày cờ này có hiệu lực. Vì vậy gỡ theo 2 pha:
//
//   Pha 1 (đợt này): ngừng tôn trọng cờ ở tầng ĐỌC + ẩn nút bật/tắt.
//                    **GIỮ nguyên cột `Lead.isSharedWithTeam` và dữ liệu.**
//   Pha 2 (sau, nếu chắc chắn không đảo lại): mới bàn tới việc bỏ cột.
//
// Bật lại = đặt env `LEAD_SHARING_ENABLED="true"` + redeploy. Không revert code,
// không mất dữ liệu — vì đây là quyết định về CHÍNH SÁCH, mà chính sách thì đổi.
import { isLeadSharingEnabled } from "@/lib/flags";

/**
 * Ai được mở một lead. THUẦN — nhận sẵn mọi dữ kiện, để test được và để quy tắc
 * nằm ở MỘT chỗ thay vì lặp lại trong từng trang.
 *
 * `sharingEnabled` truyền vào tường minh (không đọc env bên trong) để test không
 * phụ thuộc môi trường; tầng gọi dùng `leadSharingEnabled()` bên dưới.
 */
export function canSeeLead(input: {
  /** Có `leads:view-all` — quản lý/CRM nhìn toàn bộ lead trong tầm nhìn cơ sở. */
  canViewAll: boolean;
  /** Người xem chính là người phụ trách lead (`assignedToId`). */
  isOwner: boolean;
  /**
   * Người xem chính là NGƯỜI NHẬP phiếu (`Lead.createdById`) — 23/08/2026.
   *
   * Vế riêng chứ không gộp vào `isOwner`: phiếu do Sale Hội sở nhập TỰ CHIA về
   * Sale cơ sở, nên người nhập không bao giờ là assignee. Thiếu vế này thì họ
   * nhập xong bấm "Mở" là bị đá về danh sách.
   */
  isCreator?: boolean;
  /** Lead đang bật cờ "dùng chung" (dữ liệu cũ vẫn còn). */
  isShared: boolean;
  /** Chính sách chia sẻ lead có đang bật không. */
  sharingEnabled: boolean;
}): boolean {
  if (input.canViewAll || input.isOwner || input.isCreator) return true;
  return input.sharingEnabled && input.isShared;
}

/** Đọc chính sách hiện hành. Tách ra để trang/action không import cờ rải rác. */
export function leadSharingEnabled(): boolean {
  return isLeadSharingEnabled();
}

/**
 * Mệnh đề `OR` bổ sung cho truy vấn danh sách lead — rỗng khi chính sách đã tắt.
 *
 * Dùng trải (`...`) vào mảng `OR` đang có, để chỗ gọi không phải viết điều kiện
 * ba ngôi và không ai quên cập nhật khi chính sách đổi.
 */
export function leadSharedOrClause(): { isSharedWithTeam: true }[] {
  return isLeadSharingEnabled() ? [{ isSharedWithTeam: true }] : [];
}

/**
 * Mệnh đề `OR` cho "LEAD CỦA TÔI" — nguồn ĐỊNH NGHĨA DUY NHẤT của cụm từ đó.
 *
 * ── VÌ SAO LÀ HÀM DÙNG CHUNG, KHÔNG CHÉP TẠI CHỖ (17/09/2026) ─────────────────────────
 * "Của tôi" có BA vế và không vế nào bỏ được:
 *   · `assignedToId` — Sale cơ sở: phiếu được GIAO cho mình;
 *   · `createdById`  — Sale Hội sở: phiếu mình NHẬP. Phiếu đó tự chia về cơ sở nên họ
 *     KHÔNG BAO GIỜ là assignee; thiếu vế này thì danh sách của họ rỗng trắng;
 *   · lead dùng chung — theo chính sách `LEAD_SHARING_ENABLED`, tắt thì mảng rỗng.
 *
 * Ba vế đó đã được cân ở màn `/admin/leads` và `/admin/search`. Chép lần thứ tư sang màn
 * Lớp Trial là dựng bản thứ tư để trôi lệch — và cùng ngày hôm nay repo vừa trả giá đúng
 * một lần cho lỗi ấy (hai đường sinh nhãn giáo viên: vá một, cái còn lại vẫn in ra prod).
 *
 * ⚠️ Chỉ dùng cho người KHÔNG có `leads:view-all`. Người có khoá đó đi nhánh khác — gọi
 * hàm này cho họ là tự siết quyền của chính mình.
 */
export function leadCuaToiOrClause(
  userId: string,
): ({ assignedToId: string } | { createdById: string } | { isSharedWithTeam: true })[] {
  return [{ assignedToId: userId }, { createdById: userId }, ...leadSharedOrClause()];
}

/**
 * Bản THUẦN của `leadCuaToiOrClause`, dùng cho CỬA GHI.
 *
 * Cửa đọc lọc bằng mệnh đề Prisma; cửa ghi đã cầm sẵn bản ghi nên chỉ cần so. Hai vế phải
 * nói CÙNG một điều — tách hai hàm nhưng đặt cạnh nhau, cùng một chú thích, để ai sửa một
 * vế thấy ngay vế kia. Thêm/bớt một vế ở đây mà quên vế trên là lọc một đằng, chặn một nẻo.
 */
export function laLeadCuaToi(
  lead: { assignedToId: string | null; createdById: string | null; isSharedWithTeam: boolean },
  userId: string,
): boolean {
  if (lead.assignedToId === userId) return true;
  if (lead.createdById === userId) return true;
  return isLeadSharingEnabled() && lead.isSharedWithTeam;
}
