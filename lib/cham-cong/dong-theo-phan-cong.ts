// lib/cham-cong/dong-theo-phan-cong.ts — HIỂN THỊ dòng công của GV parttime tính theo PHÂN CÔNG (chủ dự án chốt 08/11/2026). THUẦN.
//
// Dùng chung cho Bảng công ngày (admin) và Bảng công site GV — một chỗ dựng chữ, hai màn in cùng chữ (luật 12b). Số liệu KHÔNG tính ở đây:
// mọi con số đến từ `ViecNgay` (`lib/parttime/viec-ngay.ts`, cắt từ engine "Lương dự kiến" của màn Phân công).
//
// Ba luật của dòng theo phân công, và vì sao:
//   1. Công = VIỆC theo phân công (mã ô, tiết đứng chính, trợ giảng, trực, Trial) + tiền DỰ KIẾN. KHÔNG in 0 / 0,5 / 1 của ô ca: công ô ca
//      (lịch rảnh S/C/T) đã BỎ HẲN cho nhóm này — in nó là nói dối (vd. "Ngoài lịch · 0 công" cho GV có 2 tiết + trực).
//   2. Cờ dựa trên LỊCH Ô CA (đi muộn / về sớm / thiếu giờ / ngoài lịch / không có lượt / thiếu lượt…) KHÔNG áp — chúng đo lượt quét so với
//      một ca không còn quyết công. Chỉ giữ cờ nói về CHÍNH lượt quét (vùng, GPS, vượt trần): lượt quét còn là bằng chứng.
//   3. Ai vào sổ: người đã có ngày công / ca xếp (như cũ) CỘNG người parttime có việc phân công ở cơ sở này ngày đó — dù không có ô ca nào.
import type { CanhBaoO } from "@/lib/parttime/luoi-tuan-ghep";
import { NHAN_NHOM_TIEN, NHOM_TIEN } from "@/lib/parttime/luong-tuan";
import { nhanMaO, nhanTien, nhanViec, type TongViec, type ViecNgay } from "@/lib/parttime/viec-ngay";

/**
 * Cờ GIỮ LẠI cho dòng theo phân công — chỉ cờ nói về chính lượt quét, không so với ca. Danh sách TRẮNG (fail-closed): một cờ mới chưa phân
 * loại sẽ KHÔNG hiện cho dòng này, thay vì lén so với ô ca không còn quyết công.
 */
export const CO_CUA_LUOT_QUET: ReadonlySet<string> = new Set([
  "NGOAI_VUNG",
  "THIEU_GPS",
  "CHUA_TOA_DO",
  "GPS_KEM_CHINH_XAC",
  "VUOT_TRAN",
  "NGOAI_DIA_DIEM_DUYET",
  "LAM_TU_XA",
  "CONG_TAC",
]);

export function coChoDongTheoPhanCong(flags: readonly string[]): string[] {
  return flags.filter((f) => CO_CUA_LUOT_QUET.has(f));
}

/** Ai vào sổ công của cơ sở × ngày: sổ cũ (`nguoiThuocSoCong`) + GV parttime có việc phân công ở đây. Thứ tự: sổ cũ trước. */
export function nguoiSoCongCoPhanCong(p: { soCongCu: readonly string[]; viec: readonly Pick<ViecNgay, "userId">[]; theoPhanCong: (userId: string) => boolean }): string[] {
  return [...new Set([...p.soCongCu, ...p.viec.map((v) => v.userId).filter(p.theoPhanCong)])];
}

export const NHAN_CANH_BAO_PHAN_CONG: Record<CanhBaoO, string> = {
  NGHI_DA_DUYET: "Có đơn nghỉ đã duyệt mà vẫn còn buổi",
  TRUNG_GIO: "Trùng giờ với việc khác",
  O_CO_SO_KHAC: "Cùng ca có việc ở cơ sở khác",
  LEGACY: "Ngày chưa có chính sách SR.QD.238",
  CHUA_NHAN: "Có buổi chưa nhận lớp",
  POLICY_UNRESOLVED: "Buổi lệch chuẩn chưa quyết số tiết",
  TRUC_CHUA_TINH_DUOC: "Ca trực chưa tính được",
  QUA_SO_TIET: "Quá số tiết tối đa một ca",
};

const TEN_CA: Record<string, string> = { S: "Sáng", C: "Chiều", T: "Tối" };

/** Dữ liệu hiển thị (chuỗi, tuần tự hoá được — đi xuống client component). */
export type PhanCongNgayHien = {
  /** Mã ô theo ca, như màn Phân công: [{ ca: "C", ten: "Chiều", ma: "TD" }]. */
  o: { ca: string; ten: string; ma: string }[];
  /** "2 tiết · TG 1 · trực ½" (`nhanViec`). */
  viec: string;
  /** Tiền DỰ KIẾN của ngày, "450.000đ". */
  tien: string;
  tienSo: number;
  /** Tách theo nhóm (chỉ nhóm khác 0) — `NHAN_NHOM_TIEN`. */
  nhom: { nhan: string; tien: string }[];
  /** Phần CHƯA tính / không tính — phải nói ra, không cộng. */
  ghiChu: string[];
  canhBao: string[];
};

export function hienPhanCongNgay(v: ViecNgay | null): PhanCongNgayHien {
  if (!v) return { o: [], viec: "Không có phân công", tien: nhanTien(0), tienSo: 0, nhom: [], ghiChu: [], canhBao: [] };
  const ghiChu: string[] = [];
  if (v.chuaTinh > 0) ghiChu.push(`${v.chuaTinh} dòng tiền chưa tính được — không cộng vào số dự kiến`);
  if (v.ngoaiCa > 0) ghiChu.push(`${v.ngoaiCa} phân công vượt ranh ca — không nằm trong ô nào, không tính`);
  if (v.legacy) ghiChu.push("Có việc ở ngày chưa có chính sách SR.QD.238 — không có mã / tiền dự kiến");
  const canhBao = [...new Set(v.o.flatMap((x) => x.canhBao))].filter((c) => c !== "LEGACY").map((c) => NHAN_CANH_BAO_PHAN_CONG[c]);
  return {
    o: v.o.map((x) => ({ ca: x.ca, ten: TEN_CA[x.ca] ?? x.ca, ma: nhanMaO(x) })),
    viec: nhanViec(v),
    tien: nhanTien(v.tien),
    tienSo: v.tien,
    nhom: NHOM_TIEN.filter((n) => v.tienTheoNhom[n] !== 0).map((n) => ({ nhan: NHAN_NHOM_TIEN[n], tien: nhanTien(v.tienTheoNhom[n]) })),
    ghiChu,
    canhBao,
  };
}

/** Tóm tắt THÁNG của việc theo phân công (site GV; Bảng công tháng admin) — cộng các ngày đã cắt (`tongViec`), không tính lại. */
export type TongPhanCongHien = {
  soNgay: number;
  tietChinh: string;
  tietTroGiang: string;
  trucDu: number;
  trucNua: number;
  soBuoiTrial: number;
  viec: string;
  tien: string;
  tienSo: number;
  nhom: { nhan: string; tien: string }[];
  ghiChu: string[];
  /** Số thô (cho file Excel — kế toán cần số, không cần chuỗi đã định dạng). */
  goc: { tietChinh: number; tietTroGiang: number; chuaTinh: number };
};

export function hienTongPhanCong(t: TongViec): TongPhanCongHien {
  const so = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  const ghiChu: string[] = [];
  if (t.chuaTinh > 0) ghiChu.push(`${t.chuaTinh} dòng tiền chưa tính được — không cộng vào số dự kiến`);
  if (t.ngoaiCa > 0) ghiChu.push(`${t.ngoaiCa} phân công vượt ranh ca — không tính`);
  if (t.legacy) ghiChu.push("Có việc ở ngày chưa có chính sách SR.QD.238 — không có tiền dự kiến");
  return {
    soNgay: t.soNgay,
    tietChinh: so(t.tietChinh),
    tietTroGiang: so(t.tietTroGiang),
    trucDu: t.trucDu,
    trucNua: t.trucNua,
    soBuoiTrial: t.soBuoiTrial,
    viec: nhanViec(t),
    tien: nhanTien(t.tien),
    tienSo: t.tien,
    nhom: NHOM_TIEN.filter((n) => t.tienTheoNhom[n] !== 0).map((n) => ({ nhan: NHAN_NHOM_TIEN[n], tien: nhanTien(t.tienTheoNhom[n]) })),
    ghiChu,
    goc: { tietChinh: t.tietChinh, tietTroGiang: t.tietTroGiang, chuaTinh: t.chuaTinh },
  };
}
