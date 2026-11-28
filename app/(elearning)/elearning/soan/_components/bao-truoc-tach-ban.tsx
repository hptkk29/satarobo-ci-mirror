import { GhiChu } from "../../_components/ui/trang";

/**
 * B-11 — DÒNG BÁO TRƯỚC khi lưu: bài đang nằm trong một phiên bản ĐÃ KHOÁ (chờ duyệt · đã duyệt · đã xuất bản · lưu trữ) thì mọi lần lưu sẽ ghi vào
 * một BẢN TÁCH của bản nháp (cổng `layBaiDeGhi`), không sửa bài mà người đang học đọc. Người soạn phải biết điều này TRƯỚC khi bấm Lưu — nếu không, sau khi
 * lưu họ thấy địa chỉ trang đổi sang một bài khác mà không hiểu vì sao, và tưởng người học đã thấy bản sửa.
 *
 * `seTachBan` do SERVER tính bằng `daKhoaBai` (cùng hàm cổng ghi dùng); đây chỉ là cờ hiển thị, không phải cổng — cổng thật vẫn ở `layBaiDeGhi`.
 */
export function BaoTruocTachBan({ seTachBan }: { seTachBan: boolean }) {
  if (!seTachBan) return null;
  return (
    <GhiChu sac="info" tieuDe="Lưu sẽ tạo bản nháp mới">
      Bài này đang nằm trong một phiên bản đã khoá. Khi bấm Lưu, thay đổi được ghi vào bản nháp mới của khoá — người đang học vẫn đọc nguyên văn bản cũ cho tới
      khi bản nháp được duyệt và phát hành.
    </GhiChu>
  );
}
