// lib/cham-cong/ky-cong-phan-cong.ts — phần "theo PHÂN CÔNG" của dòng Kỳ công / `summaryJson` cho GV parttime. THUẦN.
//
// Chủ dự án chốt 09/11/2026 ("GV parttime: kỳ công chỉ hiện tiết/trực/tiền"): từ mốc `shift.parttimeLuatCongMoiTuKy`, dòng GV parttime
// trong Kỳ công (màn, chốt, `summaryJson`, file xuất) KHÔNG còn công ô ca từ mốc — `units` / `leaveUnits` / `holidayPaidUnits` / phút… chỉ
// còn các ngày TRƯỚC mốc (cả tháng sau mốc ⇒ 0). Việc theo phân công nằm ở trường RIÊNG `phanCong` (tuỳ chọn — bản chốt cũ không có), đọc từ
// CÙNG `docViecParttime` (engine Lương dự kiến) như Bảng công ngày / tháng và kế hoạch ghi WorkUnit lúc chốt kỳ.
//
// Vì sao TRƯỜNG RIÊNG chứ không nhét tiền vào `units`: `units` là CÔNG (đơn vị ngày công) mà bảng lương fulltime / agent ngoài đang đọc và
// cộng; đổ tiết / tiền vào đó là trộn hai thước đo. Đặt `units = 0` (cho phần sau mốc) giữ nguyên HÌNH DẠNG cũ — mọi nơi cộng `units` không
// cộng nhầm công ô ca của GV parttime, và nơi muốn số phân công đọc `phanCong`.
import { tongViec, type ViecNgay } from "@/lib/parttime/viec-ngay";
import type { NhomTien } from "@/lib/parttime/luong-tuan";

export type PhanCongKy = {
  /** Ngày đầu tính theo phân công trong kỳ ("YYYY-MM-DD"). */
  tuNgay: string;
  /** Số ngày có việc theo phân công. */
  soNgay: number;
  tietChinh: number;
  tietTroGiang: number;
  trucDu: number;
  trucNua: number;
  trucQuyDoi: number;
  soBuoiTrial: number;
  /** Tiền DỰ KIẾN theo phân công (engine Lương dự kiến) — đúng số chốt kỳ ghi WorkUnit. */
  tien: number;
  tienTheoNhom: Record<NhomTien, number>;
  /** Dòng tiền chưa tính được (không cộng vào `tien`). */
  chuaTinh: number;
  /** Phân công vượt ranh ca (không tính). */
  ngoaiCa: number;
};

/** `viec` = việc theo phân công CỦA MỘT NGƯỜI, đã lọc đúng ngày theo phân công (`chamTheoPhanCong`). */
export function phanCongKyCuaNguoi(viec: readonly ViecNgay[], tuNgay: string): PhanCongKy {
  const t = tongViec(viec);
  return {
    tuNgay,
    soNgay: t.soNgay,
    tietChinh: t.tietChinh,
    tietTroGiang: t.tietTroGiang,
    trucDu: t.trucDu,
    trucNua: t.trucNua,
    trucQuyDoi: t.trucQuyDoi,
    soBuoiTrial: t.soBuoiTrial,
    tien: t.tien,
    tienTheoNhom: t.tienTheoNhom,
    chuaTinh: t.chuaTinh,
    ngoaiCa: t.ngoaiCa,
  };
}
