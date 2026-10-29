/**
 * LEAD ĐƯỢC PHÂN BỔ LẠI VÌ LÂU CHƯA CHĂM — nổi lên ĐẦU danh sách `/leads` của Sale. Hàm THUẦN.
 *
 * Yêu cầu 28/10/2026: QLCS phân bổ lại lead nguội cho Sale, nhưng `/leads` sắp theo
 * `lastInboundAt` nên lead cũ chìm xuống đáy — Sale phải đi tìm từng số điện thoại.
 *
 * ── "CÒN CHỜ CHĂM" SUY RA, KHÔNG LƯU ─────────────────────────────────────────────────────
 * `Lead.phanBoLaiNguoiAt` = `createdAt` của dòng ghi chú "Được phân bổ lại…", và dòng đó
 * cũng đặt `lastActivityAt` đúng bằng mốc ấy. Mọi thao tác chăm lead sau đó (ghi chú, gọi,
 * đổi trạng thái, đóng việc…) đều nâng `lastActivityAt` lên CAO HƠN. Nên:
 *
 *     còn chờ chăm  ⇔  lastActivityAt <= phanBoLaiNguoiAt
 *
 * Không cần hook "gỡ ghim" ở từng chỗ chăm lead (có ít nhất 5 chỗ ghi `lastActivityAt`, và chỗ
 * thứ 6 mọc ra tuần sau sẽ làm lead ghim mãi). Đổi chủ lần nữa cũng tự hết ghim, vì lượt đổi
 * chủ nào cũng ghi một dòng hoạt động ⇒ `lastActivityAt` vượt mốc.
 */

export interface LeadDeGhim {
  phanBoLaiNguoiAt: Date | null;
  lastActivityAt: Date | null;
}

/** Lead này còn đang chờ Sale chăm sau lượt phân bổ lại không. */
export function conGhim(l: LeadDeGhim): boolean {
  if (!l.phanBoLaiNguoiAt) return false;
  if (!l.lastActivityAt) return true;
  return l.lastActivityAt.getTime() <= l.phanBoLaiNguoiAt.getTime();
}

export interface CatTrang {
  /** Đoạn `[tu, den)` cắt từ danh sách ghim (đã sắp mới-phân-bổ-trước). */
  ghim: { tu: number; den: number };
  /** Phần còn lại của trang lấy từ danh sách thường: bỏ `bo` dòng đầu, lấy `lay` dòng. */
  thuong: { bo: number; lay: number };
}

/**
 * Chia một trang ra hai nguồn: ghim trước, thường sau — mà số dòng mỗi trang VẪN đúng `soDong`
 * và không dòng nào hiện hai lần hay rơi mất giữa hai trang.
 *
 * Danh sách thường phải LOẠI các lead ghim (`id notIn`), nên `bo` chỉ đếm dòng thường.
 */
export function chiaTrangCoGhim(p: { tongGhim: number; trang: number; soDong: number }): CatTrang {
  const bo = (Math.max(1, p.trang) - 1) * p.soDong;
  const tu = Math.min(bo, p.tongGhim);
  const den = Math.min(bo + p.soDong, p.tongGhim);
  return {
    ghim: { tu, den },
    thuong: { bo: Math.max(0, bo - p.tongGhim), lay: p.soDong - (den - tu) },
  };
}
