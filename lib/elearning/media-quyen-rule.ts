import { revCuaVe, type VeMedia } from "@/lib/elearning/media-ticket";

/**
 * QUYỀN TRUY CẬP MEDIA MỖI LƯỢT — luật THUẦN (không DB, không `server-only`).
 *
 * Vé phát (`media-ticket.ts`) chỉ chứng minh MỘT điều: "khi trang học dựng xong, người này được học bài này". Nó sống 30 phút và
 * KHÔNG biết gì về những gì xảy ra sau đó. Hai thứ có thể đổi trong 30 phút ấy:
 *
 *  1. **Bài đổi nguồn** (B2). Nếu route chỉ kiểm chữ ký vé, ai cầm vé của phiên bản cũ vẫn tải được `videoKey` CŨ chừng nào tệp còn
 *     trên R2 (xoá tệp cũ là việc của cron dọn rác, không phải của lần đổi nguồn) — tức nội dung đã bị thay vẫn phát được.
 *  2. **Ghi danh bị thu hồi.** Vé đã cấp vẫn dùng được tới hết hạn.
 *
 * Nên mỗi lượt xin media phải hỏi lại DB: bài hiện giờ ở phiên bản nào, khoá tệp này còn là một trong các tệp HIỆN HÀNH của bài
 * không, người này còn ghi danh hợp lệ không. Hàm này chỉ QUYẾT ĐỊNH; việc đọc DB ở `media-quyen.ts`.
 *
 * Thứ tự kiểm (mỗi bước từ chối bằng mã riêng để form/log phân biệt, nhưng "bài không tồn tại" và "khoá không còn là nguồn hiện
 * hành" cùng trả `NOT_FOUND`: phân biệt là nói cho người dò biết tệp cũ còn nằm ở đâu):
 *   bài có thật → phiên bản của vé = phiên bản hiện tại → khoá là tệp hiện hành → còn ghi danh hợp lệ.
 */

export type BaiHienHanh = {
  mediaRevision: number;
  videoKey: string | null;
  videoKey360: string | null;
  captionKey: string | null;
  audioKey: string | null;
};

export type QuyetDinhMedia =
  | { ok: true }
  | { ok: false; status: 403 | 404 | 409; code: "NOT_FOUND" | "NOI_DUNG_DA_DOI" | "FORBIDDEN"; message: string };

export function quyetDinhMedia(i: {
  ve: Pick<VeMedia, "rev" | "exp" | "lessonId" | "userId">;
  khoa: string;
  /** `null` = bài không tồn tại / đã xoá / khoá học đã xoá. */
  bai: BaiHienHanh | null;
  /** Người cầm vé còn một ghi danh KHÔNG bị thu hồi vào khoá chứa bài. */
  coGhiDanhHopLe: boolean;
}): QuyetDinhMedia {
  const { bai } = i;
  if (!bai) return { ok: false, status: 404, code: "NOT_FOUND", message: "Không tìm thấy tệp" };

  if (revCuaVe(i.ve) !== bai.mediaRevision) {
    // 409 như đường nhịp xem (`NOI_DUNG_DA_DOI`): trình phát hiểu là "tải lại trang để lấy vé mới", không phải lỗi mạng.
    return {
      ok: false,
      status: 409,
      code: "NOI_DUNG_DA_DOI",
      message: "Nội dung bài đã được cập nhật — tải lại trang để xem bản mới",
    };
  }

  const hienHanh = [bai.videoKey, bai.videoKey360, bai.captionKey, bai.audioKey].filter((k): k is string => Boolean(k));
  if (!hienHanh.includes(i.khoa)) return { ok: false, status: 404, code: "NOT_FOUND", message: "Không tìm thấy tệp" };

  if (!i.coGhiDanhHopLe) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Bạn không còn quyền xem bài này" };
  }
  return { ok: true };
}
