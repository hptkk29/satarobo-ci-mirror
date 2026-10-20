// lib/parttime/cutover.ts — PHÂN LOẠI cutover cho từng buổi (THUẦN, không DB, không đồng hồ). MỘT bộ phân loại cho cả công cụ
// `scripts/parttime-cutover.ts` (đọc DB) lẫn phép đo prod CHỈ-ĐỌC từ bản dump JSON (prod chưa có bảng Parttime).
//
// Hai trục TÁCH RỜI (Q2: dạy độc lập với ca; Q1 chỉ chặn TÍNH tiết):
//   · `nhom` — trạng thái NHẬP (cái quyết định công cụ có tạo phân công không):
//       INVALID            không nhập được (ngoài SR.QD.238 · thiếu cơ sở · thiếu giờ · lớp không có khoá)
//       MISSING_MAIN       không có GV đứng chính mặc định ⇒ không nhập, QLCS phải phân
//       REVIEW             đã có phân công lệch mặc định (phân tay / dạy thay khác người) ⇒ không ghi đè, người xem
//       ACCEPTED           mọi vai bắt buộc đã NHẬN — không còn gì để nhập
//       PENDING_ACCEPTANCE đã có phân công sống (nhập rồi / dựng rồi) mà chưa nhận đủ
//       READY_TO_IMPORT    chưa có phân công, nhập được
//   · `nhan` — nhãn KHÔNG chặn nhập: MISSING_TA · NON_STANDARD_DURATION · AMBIGUOUS_SHIFT.
// `chinh` = nhóm báo cáo chính (một buổi một nhóm) theo thứ tự nghiêm trọng — để đếm, không để quyết nhập.
import { phutTrongNgay, type ThamSoChinhSach } from "./chinh-sach";
import { donViTiet, type DonViTiet, type GhiDeDonVi } from "./don-vi-tiet";
import { yeuCauTroGiangThuan, laTaBatBuoc, type YeuCauTroGiang } from "./phan-cong";

export type NhomNhap = "INVALID" | "MISSING_MAIN" | "REVIEW" | "ACCEPTED" | "PENDING_ACCEPTANCE" | "READY_TO_IMPORT";
export type NhanCutover = "MISSING_TA" | "NON_STANDARD_DURATION" | "AMBIGUOUS_SHIFT";
export type NhomChinh = NhomNhap | NhanCutover;
/** Thứ tự đếm nhóm chính: chặn nhập trước, rồi nhãn (Q9 → Q1 → Q2), rồi trạng thái nhận. */
export const THU_TU_CHINH: readonly NhomChinh[] = [
  "INVALID",
  "MISSING_MAIN",
  "REVIEW",
  "MISSING_TA",
  "NON_STANDARD_DURATION",
  "AMBIGUOUS_SHIFT",
  "PENDING_ACCEPTANCE",
  "ACCEPTED",
  "READY_TO_IMPORT",
];

/** Phân công Parttime đang có của buổi (rỗng khi môi trường chưa có bảng). */
export type PhanCongCo = { userId: string; role: "MAIN_TEACHER" | "TEACHING_ASSISTANT"; status: string; assignmentType: string; daNhan: boolean };

export type BuoiCutover = {
  sessionId: string;
  centerId: string | null;
  centerCode: string | null;
  classId: string;
  classCode: string | null;
  courseId: string | null;
  tenKhoa: string | null;
  sessionType: string | null;
  /** "YYYY-MM-DD" giờ VN. */
  ngay: string;
  /** "HH:mm" giờ dạy (không gồm chuẩn bị); null = thiếu. */
  gioBatDau: string | null;
  gioKetThuc: string | null;
  /** GV đứng chính MẶC ĐỊNH của buổi: dạy thay ?? GV lớp. */
  mainId: string | null;
  mainLaDayThay: boolean;
  /** TA mặc định của lớp. */
  taId: string | null;
  soHocVien: number;
  /** Ghi đè yêu cầu TA của QLCS (theo lớp) — null = theo PL02. */
  taGhiDe: boolean | null;
  phanCong: readonly PhanCongCo[];
};

export type KetQuaCutover = {
  sessionId: string;
  centerCode: string | null;
  classCode: string | null;
  ngay: string;
  gio: string | null;
  mainId: string | null;
  taId: string | null;
  yeuCauTA: YeuCauTroGiang | null;
  thoiLuongDayPhut: number | null;
  /** Q1 — trạng thái chính sách số tiết (null = ngoài SR.QD.238 / thiếu giờ). */
  chinhSach: DonViTiet["trangThai"] | null;
  nhom: NhomNhap;
  nhan: NhanCutover[];
  chinh: NhomChinh;
  lyDo: string[];
  /** Vai sẽ được NHẬP (rỗng nếu nhóm không nhập). */
  seNhap: { role: "MAIN_TEACHER" | "TEACHING_ASSISTANT"; userId: string }[];
};

const SONG = new Set(["PROPOSED", "WAITING_ACCEPTANCE", "ACCEPTED", "ACTIVE", "COMPLETED"]);

export function phanLoaiCutover(b: BuoiCutover, ctx: { thamSo: ThamSoChinhSach | null; ghiDe: readonly GhiDeDonVi[] }): KetQuaCutover {
  const ts = ctx.thamSo && ctx.thamSo.loai === "SR_QD_238" ? ctx.thamSo : null;
  const lyDo: string[] = [];
  const nhan: NhanCutover[] = [];
  const coGio = !!b.gioBatDau && !!b.gioKetThuc && phutTrongNgay(b.gioKetThuc) > phutTrongNgay(b.gioBatDau);
  const thoiLuong = coGio ? phutTrongNgay(b.gioKetThuc!) - phutTrongNgay(b.gioBatDau!) : null;
  const dv = ts && thoiLuong != null ? donViTiet({ thoiLuongDayPhut: thoiLuong, chuanDayPhut: ts.tiet.dayPhut, ghiDe: ctx.ghiDe }) : null;
  const yeuCauTA = ts ? yeuCauTroGiangThuan({ ghiDe: b.taGhiDe, tenKhoa: b.tenKhoa, soHocVien: b.soHocVien, nguong: ts.nguongTroGiang }) : null;
  const song = b.phanCong.filter((p) => SONG.has(p.status));
  const mainSong = song.find((p) => p.role === "MAIN_TEACHER") ?? null;
  const taSong = song.filter((p) => p.role === "TEACHING_ASSISTANT");
  const tuChoi = new Set(b.phanCong.filter((p) => p.status === "DECLINED").map((p) => `${p.role}|${p.userId}`));
  const mainDaTuChoi = !mainSong && !!b.mainId && tuChoi.has(`MAIN_TEACHER|${b.mainId}`);

  // ── nhãn (không chặn nhập) ──
  if (yeuCauTA && laTaBatBuoc(yeuCauTA) && !b.taId && taSong.length === 0) nhan.push("MISSING_TA");
  if (dv && dv.trangThai === "NEEDS_POLICY_DECISION") nhan.push("NON_STANDARD_DURATION");
  if (ts && coGio) {
    // Khung PHẢI CÓ MẶT (chuẩn bị + dạy) nằm trọn trong MỘT ca của chính sách? Không ⇒ nhãn — dạy vẫn hợp lệ (Q2).
    const tu = phutTrongNgay(b.gioBatDau!) - ts.tiet.chuanBiPhut;
    const den = phutTrongNgay(b.gioKetThuc!);
    if (!ts.ca.some((c) => tu >= phutTrongNgay(c.tu) && den <= phutTrongNgay(c.den))) nhan.push("AMBIGUOUS_SHIFT");
  }

  // ── nhóm nhập ──
  let nhom: NhomNhap;
  if (!ts) {
    nhom = "INVALID";
    lyDo.push("NGOAI_SR_QD_238");
  } else if (!b.centerId) {
    nhom = "INVALID";
    lyDo.push("THIEU_CO_SO");
  } else if (!coGio) {
    nhom = "INVALID";
    lyDo.push("THIEU_GIO");
  } else if (!b.courseId) {
    nhom = "INVALID";
    lyDo.push("LOP_KHONG_KHOA");
  } else if (!b.mainId && !mainSong) {
    nhom = "MISSING_MAIN";
  } else if (mainDaTuChoi) {
    // GV mặc định đã TỪ CHỐI, chưa ai thay ⇒ buổi đang thiếu người đứng chính — QLCS xếp người khác (không nhập lại người đó).
    nhom = "MISSING_MAIN";
    lyDo.push("MAIN_MAC_DINH_DA_TU_CHOI");
  } else if (mainSong && b.mainId && mainSong.userId !== b.mainId && !["SYSTEM", "REGULAR", "CUTOVER"].includes(mainSong.assignmentType)) {
    nhom = "REVIEW";
    lyDo.push(`MAIN_LECH_MAC_DINH:${mainSong.assignmentType}`);
  } else if (song.length > 0) {
    const batBuocDaNhan = !!mainSong?.daNhan && (!(yeuCauTA && laTaBatBuoc(yeuCauTA)) || taSong.some((t) => t.daNhan));
    nhom = batBuocDaNhan && song.every((p) => p.daNhan || p.status === "COMPLETED") ? "ACCEPTED" : "PENDING_ACCEPTANCE";
  } else {
    nhom = "READY_TO_IMPORT";
  }

  // ── sẽ nhập: chỉ vai CÒN THIẾU, chỉ khi nhóm cho phép (MISSING_TA / NON_STANDARD / AMBIGUOUS vẫn nhập được) ──
  const seNhap: KetQuaCutover["seNhap"] = [];
  if (nhom === "READY_TO_IMPORT" || nhom === "PENDING_ACCEPTANCE") {
    if (!mainSong && b.mainId && !tuChoi.has(`MAIN_TEACHER|${b.mainId}`)) seNhap.push({ role: "MAIN_TEACHER", userId: b.mainId });
    if (b.taId && b.taId !== b.mainId && taSong.length === 0 && !tuChoi.has(`TEACHING_ASSISTANT|${b.taId}`)) seNhap.push({ role: "TEACHING_ASSISTANT", userId: b.taId });
  }

  const tatCa: NhomChinh[] = [nhom, ...nhan];
  const chinh = THU_TU_CHINH.find((x) => tatCa.includes(x)) ?? nhom;
  return {
    sessionId: b.sessionId,
    centerCode: b.centerCode,
    classCode: b.classCode,
    ngay: b.ngay,
    gio: coGio ? `${b.gioBatDau}–${b.gioKetThuc}` : null,
    mainId: b.mainId,
    taId: b.taId,
    yeuCauTA,
    thoiLuongDayPhut: thoiLuong,
    chinhSach: dv?.trangThai ?? null,
    nhom,
    nhan,
    chinh,
    lyDo,
    seNhap,
  };
}

/** Đếm theo nhóm chính + nhóm nhập + nhãn, theo cơ sở. */
export function tongHopCutover(ds: readonly KetQuaCutover[]) {
  const dem = <K extends string>(f: (k: KetQuaCutover) => K[]) => {
    const m: Record<string, number> = {};
    for (const k of ds) for (const x of f(k)) m[x] = (m[x] ?? 0) + 1;
    return m;
  };
  const theoCoSo: Record<string, { chinh: Record<string, number>; nhom: Record<string, number>; nhan: Record<string, number>; tong: number }> = {};
  for (const cs of [...new Set(ds.map((k) => k.centerCode ?? "?"))].sort()) {
    const con = ds.filter((k) => (k.centerCode ?? "?") === cs);
    const d2 = <K extends string>(f: (k: KetQuaCutover) => K[]) => {
      const m: Record<string, number> = {};
      for (const k of con) for (const x of f(k)) m[x] = (m[x] ?? 0) + 1;
      return m;
    };
    theoCoSo[cs] = { chinh: d2((k) => [k.chinh]), nhom: d2((k) => [k.nhom]), nhan: d2((k) => k.nhan), tong: con.length };
  }
  return { tong: ds.length, chinh: dem((k) => [k.chinh]), nhom: dem((k) => [k.nhom]), nhan: dem((k) => k.nhan), seNhap: ds.reduce((s, k) => s + k.seNhap.length, 0), theoCoSo };
}
