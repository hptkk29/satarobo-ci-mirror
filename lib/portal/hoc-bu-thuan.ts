// Cổng phụ huynh — phần THUẦN của màn "Xin nghỉ & học bù" (artifact Hoc-bu.dc.html).

export type BuocHocBu = { ten: string; tt: "xong" | "dang" | "chua" };

/**
 * 5 bước của một buổi cần bù, dựng từ trạng thái THẬT của dòng cần bù:
 *   PENDING chưa có đơn  → đang ở bước "Ba mẹ xin học bù"
 *   PENDING đã có đơn    → đang ở bước "Trung tâm xếp giờ"
 *   SCHEDULED            → đang ở bước "Con học bù"
 *   COMPLETED            → xong tới "Con học bù", chờ nhận xét
 * Nhãn khác artifact ở hai bước giữa ("Ba mẹ chọn giờ" → "Ba mẹ xin học bù" / "Trung tâm xếp giờ") vì hệ thống chưa lưu
 * các giờ trung tâm đề xuất cho ba mẹ chọn.
 */
export const SU_KIEN_BUOC = ["Ba mẹ báo nghỉ", "Ba mẹ xin học bù", "Trung tâm xếp giờ", "Con học bù", "Có nhận xét"] as const;

export function buocHocBu(i: { status: "PENDING" | "SCHEDULED" | "COMPLETED" | "CANCELLED"; yeuCauMo: boolean }): BuocHocBu[] {
  const hienTai =
    i.status === "COMPLETED" ? 4 : i.status === "SCHEDULED" ? 3 : i.status === "PENDING" && i.yeuCauMo ? 2 : 1;
  return SU_KIEN_BUOC.map((ten, k) => ({ ten, tt: k < hienTai ? "xong" : k === hienTai ? "dang" : "chua" }));
}

export const lyDoBaoNghi = ["Con ốm", "Việc gia đình", "Lịch học ở trường", "Khác"] as const;

/** Nội dung đơn báo nghỉ gửi lên server (cột `content`, ≥ 5 ký tự): lý do + ghi chú + có xin học bù không. */
export function noiDungBaoNghi(i: { lyDo: string; ghiChu: string; muonBu: boolean }): string {
  const ghi = i.ghiChu.trim();
  return [`Lý do: ${i.lyDo}.`, ghi ? `Ghi chú: ${ghi}` : null, i.muonBu ? "Con muốn học bù buổi này." : "Không cần học bù."].filter(Boolean).join(" ");
}
