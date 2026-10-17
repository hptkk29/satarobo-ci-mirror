// lib/parttime/control-tower.ts — luật THUẦN của màn Control Tower (QLCS · SR.QD.238 · P3b): thẻ số, bộ lọc, cảnh báo,
// xem trước khởi động. Không đọc DB, không đọc đồng hồ (`now` bắt buộc — luật 7 + 19).
//
// Thẻ số và bộ lọc `?loc=` dùng CHUNG một vị từ (`THE[ma].khop`) — đếm một đằng lọc một nẻo là thẻ nói dối (luật 12).
import { laTaBatBuoc } from "./phan-cong";
import { mocVn, type NgoaiLeBuoi } from "./bang-chung-cong";
import type { BuoiTrongTuan } from "./bang-phan-cong";

/** Buổi là VIỆC của màn này: thuộc SR.QD.238 và còn mở. Buổi LEGACY / đã chốt / đã đóng chỉ hiện để đối chiếu. */
export const laViec = (b: Pick<BuoiTrongTuan, "apDung" | "tinhTrang">) => b.apDung && b.tinhTrang === "MO";

type BuoiThe = Pick<BuoiTrongTuan, "apDung" | "tinhTrang" | "trangThai" | "main" | "ta" | "lichSu" | "yeuCauTA">;

export const MA_THE = ["tong", "du", "cho-xac-nhan", "thieu-gv", "thieu-ta", "tu-choi", "phan-lai"] as const;
export type MaThe = (typeof MA_THE)[number];

export const THE: Record<MaThe, { nhan: string; khop: (b: BuoiThe) => boolean }> = {
  tong: { nhan: "Buổi cần đội hình", khop: (b) => laViec(b) },
  du: { nhan: "Đủ người đã nhận", khop: (b) => laViec(b) && b.trangThai === "STAFFING_CONFIRMED" },
  "cho-xac-nhan": { nhan: "Chờ nhận lớp", khop: (b) => laViec(b) && (b.trangThai === "WAITING_ACCEPTANCE" || b.trangThai === "PARTIALLY_ACCEPTED") },
  "thieu-gv": { nhan: "Thiếu giáo viên đứng chính", khop: (b) => laViec(b) && !b.main },
  "thieu-ta": { nhan: "Thiếu trợ giảng bắt buộc", khop: (b) => laViec(b) && laTaBatBuoc(b.yeuCauTA) && !b.ta },
  "tu-choi": { nhan: "Có người từ chối", khop: (b) => laViec(b) && b.lichSu.some((x) => x.status === "DECLINED") },
  "phan-lai": { nhan: "Cần phân lại", khop: (b) => laViec(b) && (b.trangThai === "NEEDS_REASSIGNMENT" || b.trangThai === "STAFFING_REJECTED") },
};

export const laMaThe = (x: string | undefined | null): x is MaThe => !!x && (MA_THE as readonly string[]).includes(x);

export function demThe(ds: readonly BuoiThe[]): Record<MaThe, number> {
  const ra = Object.fromEntries(MA_THE.map((m) => [m, 0])) as Record<MaThe, number>;
  for (const b of ds) for (const m of MA_THE) if (THE[m].khop(b)) ra[m]++;
  return ra;
}

// ─── Cảnh báo theo buổi ──────────────────────────────────────────────────────────────────────

export type MaCanhBao =
  | "SAP_DIEN_RA_MAIN_CHUA_NHAN"
  | "THIEU_TA_BAT_BUOC"
  | "MAIN_TU_CHOI"
  | "TA_TU_CHOI"
  | "LICH_DOI_CAN_NHAN_LAI"
  | "DA_DIEN_RA_CHUA_DU"
  | "LECH_NGUOI_DUNG_LOP"
  | "ANH_CHUP_LECH"
  | "LECH_PHAN_CONG_TAY"
  | "TRUNG_VAI"
  | "DA_CHOT_NHUNG_BUOI_DONG"
  | "SESSION_COMPLETED_WITHOUT_CONFIRMED_MAIN"
  | "TA_PRESENT_WITHOUT_ASSIGNMENT";

export type CanhBao = { ma: MaCanhBao; nhan: string; muc: "danger" | "warning" | "info" };

/** "Sắp diễn ra" là ngưỡng HIỂN THỊ (24 giờ), KHÔNG phải hạn nhận lớp — hạn / leo thang là câu Q6 còn mở. */
export const SAP_DIEN_RA_GIO = 24;

type BuoiCanhBao = Pick<
  BuoiTrongTuan,
  "apDung" | "tinhTrang" | "trangThai" | "main" | "ta" | "lichSu" | "yeuCauTA" | "ngay" | "gioBatDau" | "sourceType" | "nguoiDungLop" | "keHoach"
>;

export function canhBaoBuoi(b: BuoiCanhBao, now: Date): CanhBao[] {
  const ra: CanhBao[] = [];
  // Ngoại lệ của bộ đồng bộ hiện ở MỌI tình trạng (kể cả đã chốt mà buổi đóng — đối soát).
  for (const x of b.keHoach) {
    if (x.loai !== "NGOAI_LE") continue;
    if (x.ma === "LECH_PHAN_CONG_TAY") ra.push({ ma: x.ma, nhan: "Phân tay khác người mặc định", muc: "info" });
    if (x.ma === "TRUNG_VAI") ra.push({ ma: x.ma, nhan: "Người mặc định đang giữ vai khác", muc: "warning" });
    if (x.ma === "DA_CHOT_NHUNG_BUOI_DONG") ra.push({ ma: x.ma, nhan: "Đã chốt nhưng buổi đã đóng — cần đối soát", muc: "danger" });
  }
  // Đối soát người đứng lớp: chỉ buổi lớp, MAIN đã nhận mà người được quy công là người khác.
  if (b.sourceType === "CLASS_SESSION" && b.main?.daNhan && b.nguoiDungLop && b.nguoiDungLop !== b.main.userId) {
    ra.push({ ma: "LECH_NGUOI_DUNG_LOP", nhan: "Người đứng lớp khác người đã nhận — cần đối soát", muc: "warning" });
  }
  if (!laViec(b)) return ra;

  const batDau = mocVn(b.ngay, b.gioBatDau).getTime();
  const conLai = batDau - now.getTime();
  if (b.main && !b.main.daNhan && conLai > 0 && conLai <= SAP_DIEN_RA_GIO * 3_600_000) {
    ra.push({ ma: "SAP_DIEN_RA_MAIN_CHUA_NHAN", nhan: "Sắp diễn ra — giáo viên chưa nhận", muc: "danger" });
  }
  if (laTaBatBuoc(b.yeuCauTA) && !b.ta) ra.push({ ma: "THIEU_TA_BAT_BUOC", nhan: "Thiếu trợ giảng bắt buộc", muc: "danger" });
  const tuChoi = (role: "MAIN_TEACHER" | "TEACHING_ASSISTANT") => b.lichSu.some((x) => x.status === "DECLINED" && x.role === role);
  const daNhanVai = (pc: BuoiCanhBao["main"]) => !!pc?.daNhan;
  if (tuChoi("MAIN_TEACHER") && !daNhanVai(b.main)) ra.push({ ma: "MAIN_TU_CHOI", nhan: "Giáo viên đứng chính đã từ chối", muc: "danger" });
  if (tuChoi("TEACHING_ASSISTANT") && !daNhanVai(b.ta)) ra.push({ ma: "TA_TU_CHOI", nhan: "Trợ giảng đã từ chối", muc: "warning" });
  if ([b.main, b.ta].some((pc) => pc && !pc.daNhan && pc.phienBan > 1)) {
    ra.push({ ma: "LICH_DOI_CAN_NHAN_LAI", nhan: "Lịch đã đổi — chờ nhận lại", muc: "warning" });
  }
  if (conLai <= 0 && b.trangThai !== "STAFFING_CONFIRMED") ra.push({ ma: "DA_DIEN_RA_CHUA_DU", nhan: "Đã diễn ra mà chưa đủ người nhận", muc: "danger" });
  if (b.keHoach.some((x) => x.loai === "DOI_LICH")) ra.push({ ma: "ANH_CHUP_LECH", nhan: "Giờ / nơi phân công lệch lịch buổi", muc: "warning" });
  return ra;
}

/** Ngoại lệ cấp BUỔI của engine bằng chứng P4 ⇒ cảnh báo trên dòng buổi (không tự sửa). */
export function canhBaoTuBangChung(ds: readonly Pick<NgoaiLeBuoi, "ma">[]): CanhBao[] {
  return ds.map((x) =>
    x.ma === "SESSION_COMPLETED_WITHOUT_CONFIRMED_MAIN"
      ? { ma: x.ma, nhan: "Buổi đã chốt mà không có giáo viên đứng chính đã nhận", muc: "danger" as const }
      : { ma: x.ma, nhan: "Trợ giảng của lớp có mặt mà không được phân công", muc: "info" as const },
  );
}

// ─── Xem trước khởi động (công tắc TẮT) ──────────────────────────────────────────────────────

export type XemTruoc = { soBuoi: number; dungMain: number; dungTa: number; loiMoi: number; ngoaiLe: number };

/**
 * Nếu bật công tắc, bộ đồng bộ sẽ dựng bao nhiêu — đếm thẳng các bước TẠO / THAY của `keHoachDongBo` đã chạy thử trên
 * từng buổi (cùng một luật với lần đồng bộ thật). Mỗi phân công mới = một lời mời xác nhận.
 */
export function xemTruocKhoiDong(ds: readonly Pick<BuoiTrongTuan, "apDung" | "tinhTrang" | "keHoach">[]): XemTruoc {
  const ra: XemTruoc = { soBuoi: 0, dungMain: 0, dungTa: 0, loiMoi: 0, ngoaiLe: 0 };
  for (const b of ds) {
    if (!laViec(b)) continue;
    ra.soBuoi++;
    for (const x of b.keHoach) {
      if (x.loai === "TAO" || x.loai === "THAY") {
        if (x.role === "MAIN_TEACHER") ra.dungMain++;
        else ra.dungTa++;
        ra.loiMoi++;
      }
      if (x.loai === "NGOAI_LE") ra.ngoaiLe++;
    }
  }
  return ra;
}
