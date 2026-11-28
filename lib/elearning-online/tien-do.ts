import type { CaiDatHocTap } from "./cai-dat-hoc-tap";

/**
 * E-LEARNING ONLINE — TIẾN ĐỘ KHOÁ + MỞ BÀI (hàm THUẦN, V7 §9). Server là nguồn duy nhất: client KHÔNG tự cộng tiến độ.
 *
 * - Bài ẨN không tính vào tổng/% của bản đang chạy ("không tính vào % hoàn thành của bản 4" — QoPhatHanh1), nhưng VẪN mở được với người
 *   đã học nó (quyết định ở cổng truy cập, không ở đây).
 * - Bài thi cuối khoá (`FINAL_EXAM`) KHÔNG nằm trong % bài bắt buộc; nó là điều kiện riêng khi `thiCuoiKhoa.bat`.
 * - QUIZ/ASSIGNMENT: "hoàn thành" = trạng thái COMPLETED (đã ĐẠT ngưỡng) — việc chấm điểm quyết định, không phải việc của hàm này.
 */

export type BaiTrongBan = {
  stableId: string;
  chapterStableId: string;
  kind: "VIDEO" | "READ" | "ASSIGNMENT" | "QUIZ" | "FINAL_EXAM";
  required: boolean;
  hidden: boolean;
  /** Thứ tự TOÀN KHOÁ (chương rồi bài), tăng dần, duy nhất. */
  thuTu: number;
  /** Thứ tự chương, tăng dần. */
  thuTuChuong: number;
};

export type TienDoBai = Record<string, "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | undefined>;

const hienThi = (b: BaiTrongBan) => !b.hidden;
const xong = (td: TienDoBai, b: BaiTrongBan) => td[b.stableId] === "COMPLETED";

export type TienDoKhoa = {
  tongBaiBatBuoc: number;
  daXongBatBuoc: number;
  /** 0..100, làm tròn xuống (không báo 100% khi còn thiếu). */
  phanTram: number;
  /** Đủ % bài bắt buộc (chưa xét thi cuối). */
  duBaiBatBuoc: boolean;
  /** Có bài thi cuối khoá hiển thị trong bản. */
  coThiCuoi: boolean;
  thiCuoiDat: boolean;
  /** Khoá hoàn thành = đủ % bài bắt buộc VÀ (nếu bật thi cuối) đã ĐẠT thi cuối. */
  hoanThanh: boolean;
};

export function tinhTienDoKhoa(bai: readonly BaiTrongBan[], td: TienDoBai, cd: Pick<CaiDatHocTap, "khoaHoanThanhPhanTramBaiBatBuoc" | "thiCuoiKhoa">): TienDoKhoa {
  const batBuoc = bai.filter((b) => hienThi(b) && b.required && b.kind !== "FINAL_EXAM");
  const daXong = batBuoc.filter((b) => xong(td, b)).length;
  const tong = batBuoc.length;
  const phanTram = tong === 0 ? 0 : Math.floor((daXong * 100) / tong);
  // Không có bài bắt buộc nào ⇒ KHÔNG coi là "đủ" (khoá rỗng không tự hoàn thành).
  const duBaiBatBuoc = tong > 0 && daXong * 100 >= cd.khoaHoanThanhPhanTramBaiBatBuoc * tong;
  const thiCuoi = bai.find((b) => hienThi(b) && b.kind === "FINAL_EXAM");
  const thiCuoiDat = !!thiCuoi && xong(td, thiCuoi);
  const canThi = cd.thiCuoiKhoa.bat;
  return {
    tongBaiBatBuoc: tong,
    daXongBatBuoc: daXong,
    phanTram,
    duBaiBatBuoc,
    coThiCuoi: !!thiCuoi,
    thiCuoiDat,
    hoanThanh: duBaiBatBuoc && (!canThi || thiCuoiDat),
  };
}

export type KetQuaMoBai = { mo: true } | { mo: false; lyDo: "BAI_TRUOC_CHUA_XONG" | "CHUONG_TRUOC_CHUA_XONG" | "CHUA_DU_DIEU_KIEN_THI_CUOI" | "BAI_KHONG_TON_TAI" };

/**
 * Bài `stableId` có MỞ được theo cài đặt `moBaiTiepTheo` không (chưa xét quyền/hạn/xem lại — đó là cổng truy cập).
 * - `MO_HET`: mở hết.
 * - `KHI_BAI_TRUOC_XONG`: bài đầu mở; các bài sau mở khi mọi bài BẮT BUỘC hiển thị đứng TRƯỚC nó đã xong (bài tuỳ chọn không chặn).
 * - `THEO_CHUONG`: mọi bài của chương đầu mở; chương k mở khi mọi bài BẮT BUỘC của các chương trước đã xong (gồm bài kiểm tra chương).
 * - Thi cuối khoá: chỉ mở khi đủ % bài bắt buộc (bất kể chế độ mở bài).
 */
export function baiCoMoDuoc(bai: readonly BaiTrongBan[], td: TienDoBai, cd: CaiDatHocTap, stableId: string): KetQuaMoBai {
  const b = bai.find((x) => x.stableId === stableId);
  if (!b) return { mo: false, lyDo: "BAI_KHONG_TON_TAI" };
  if (b.kind === "FINAL_EXAM") {
    return tinhTienDoKhoa(bai, td, cd).duBaiBatBuoc ? { mo: true } : { mo: false, lyDo: "CHUA_DU_DIEU_KIEN_THI_CUOI" };
  }
  if (cd.moBaiTiepTheo === "MO_HET") return { mo: true };
  const truoc = bai.filter((x) => hienThi(x) && x.required && x.kind !== "FINAL_EXAM");
  if (cd.moBaiTiepTheo === "KHI_BAI_TRUOC_XONG") {
    const chua = truoc.some((x) => x.thuTu < b.thuTu && !xong(td, x));
    return chua ? { mo: false, lyDo: "BAI_TRUOC_CHUA_XONG" } : { mo: true };
  }
  const chua = truoc.some((x) => x.thuTuChuong < b.thuTuChuong && !xong(td, x));
  return chua ? { mo: false, lyDo: "CHUONG_TRUOC_CHUA_XONG" } : { mo: true };
}
