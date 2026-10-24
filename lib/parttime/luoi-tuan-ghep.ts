// lib/parttime/luoi-tuan-ghep.ts — GHÉP lưới tuần (người × ngày × ca S/C/T) từ các dòng nguồn đã đọc. THUẦN, không DB, không đồng hồ.
//
// Đầu vào là dòng nguồn THẬT (phân công buổi còn sống, dòng trực còn sống, kết quả xét Trial, đơn vị đã xác nhận) — lưới không có
// bảng riêng, nên dời / huỷ / đổi người ở module nguồn (bộ đồng bộ Parttime đã sửa phân công) tự hiện ra ở lần đọc kế tiếp.
// Suy mã + tiền: `luoi-tuan.ts`. Tài liệu: docs/cham-cong/parttime/23-LUOI-PHAN-CONG-GV.md.
import type { StaffAssignmentStatus, StaffAssignmentType, WorkActivityType, WorkRole, WorkSourceType } from "@prisma/client";
import { chinhSachTaiNgay, phutTrongNgay, type BanChinhSach } from "./chinh-sach";
import type { DonViTiet } from "./don-vi-tiet";
import { rankTaiNgay, type DongRank } from "./rank";
import { maNen, tinhCaDuKien, xepVaoCa, type CaDuKien, type HoatDongO, type KetQuaTrial, type LoaiHoatDong, type MaO } from "./luoi-tuan";

export type PhanCongVao = {
  id: string;
  userId: string;
  centerId: string;
  sourceType: WorkSourceType;
  sourceId: string;
  ngay: string; // "YYYY-MM-DD"
  gioBatDau: string;
  gioKetThuc: string;
  role: WorkRole;
  activityType: WorkActivityType;
  assignmentType: StaffAssignmentType;
  status: StaffAssignmentStatus;
  donViTiet: DonViTiet;
};

export type TrucVao = { id: string; userId: string; centerId: string; ngay: string; shiftCode: string; status: StaffAssignmentStatus };

/** Đơn vị ĐÃ XÁC NHẬN (WorkUnit CONFIRMED) — trục THỰC TẾ. `assignmentId` = phân công buổi hoặc dòng trực. */
export type DonViDaXacNhan = { assignmentId: string; loai: "MAIN_TEACHING" | "ASSISTANT_TEACHING" | "OPERATIONS_DUTY"; quantity: number; rateSnapshot: number };

export type CanhBaoO = "NGHI_DA_DUYET" | "TRUNG_GIO" | "O_CO_SO_KHAC" | "LEGACY" | "CHUA_NHAN" | "POLICY_UNRESOLVED" | "TRUC_CHUA_TINH_DUOC" | "QUA_SO_TIET";

export type HoatDongHien = {
  id: string;
  sourceType: WorkSourceType;
  sourceId: string;
  vai: "MAIN" | "TA";
  loai: LoaiHoatDong;
  gioBatDau: string;
  gioKetThuc: string;
  assignmentType: StaffAssignmentType;
  daGan: boolean;
  /** Chỉ Trial: kết quả xét hỗ trợ. */
  trial: KetQuaTrial | null;
};

export type OLuoi = {
  ke: CaDuKien | null; // null = ngày LEGACY (trước SR.QD.238) — không có mã / tiền dự kiến
  thucTe: { ma: MaO | null; tong: number } | null; // null = chưa có đơn vị nào được xác nhận
  hoatDong: HoatDongHien[];
  trucId: string | null;
  canhBao: CanhBaoO[];
};

export type DongGiaoVien = {
  userId: string;
  /** Cơ sở GỐC khác cơ sở đang xem ⇒ giáo viên "mượn". */
  laMuon: boolean;
  o: Record<string, Record<string, OLuoi>>; // ngay → ca → ô
  tongNgay: Record<string, number>;
  tongTuan: number;
  rankTheoNgay: Record<string, number | null>;
  /** Phân công không ca nào chứa trọn (vượt ranh ca) — hiện riêng theo ngày, không ép vào ô nào. */
  ngoaiCa: Record<string, { id: string; gioBatDau: string; gioKetThuc: string }[]>;
};

export type DauVaoGhep = {
  centerId: string;
  ngays: readonly string[];
  chinhSach: readonly BanChinhSach[];
  /** Phân công CÒN SỐNG của cơ sở đang xem. */
  phanCong: readonly PhanCongVao[];
  /** Phân công còn sống ở CƠ SỞ KHÁC của cùng những người — chỉ để báo trùng giờ / bận nơi khác, không tính tiền ở đây. */
  phanCongNoiKhac: readonly PhanCongVao[];
  truc: readonly TrucVao[];
  rank: ReadonlyMap<string, readonly DongRank[]>;
  coSoGoc: ReadonlyMap<string, string | null>;
  trial: ReadonlyMap<string, KetQuaTrial>; // assignmentId → kết quả
  daXacNhan: readonly DonViDaXacNhan[];
  /** Ngày có ô ca nguồn LEAVE (đơn nghỉ ĐÃ duyệt) — khoá `userId|ngay`. Chỉ để CẢNH BÁO: đơn nghỉ không đổi người đứng chính;
   *  chỉ dạy thay được duyệt mới đổi (EV-13 / EV-14). BẮT BUỘC (luật 7). */
  nghiDaDuyet: ReadonlySet<string>;
};

const LOAI: Record<WorkActivityType, LoaiHoatDong> = { REGULAR_CLASS: "REGULAR", MAKEUP: "MAKEUP", ADVANCE: "ADVANCE", TRIAL: "TRIAL", SPECIAL: "REGULAR" };
const loaiCua = (p: PhanCongVao): LoaiHoatDong => (p.assignmentType === "SUBSTITUTE" && p.activityType !== "TRIAL" ? "SUBSTITUTE" : LOAI[p.activityType]);
const vaiCua = (r: WorkRole): "MAIN" | "TA" | null => (r === "MAIN_TEACHER" ? "MAIN" : r === "TEACHING_ASSISTANT" ? "TA" : null);
const DA_GAN: readonly StaffAssignmentStatus[] = ["ACCEPTED", "ACTIVE", "COMPLETED"];
const them = <T>(ds: T[], x: T) => {
  if (!ds.includes(x)) ds.push(x);
};

export function ghepLuoi(v: DauVaoGhep): DongGiaoVien[] {
  const nguoi = [...new Set([...v.phanCong.map((p) => p.userId), ...v.truc.map((t) => t.userId)])].sort();
  const xn = new Map<string, DonViDaXacNhan[]>();
  for (const d of v.daXacNhan) xn.set(d.assignmentId, [...(xn.get(d.assignmentId) ?? []), d]);
  const ra: DongGiaoVien[] = [];

  for (const userId of nguoi) {
    const goc = v.coSoGoc.get(userId) ?? null;
    const dong: DongGiaoVien = { userId, laMuon: goc != null && goc !== v.centerId, o: {}, tongNgay: {}, tongTuan: 0, rankTheoNgay: {}, ngoaiCa: {} };
    for (const ngay of v.ngays) {
      const cs = chinhSachTaiNgay(v.chinhSach, ngay);
      const ts = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo : null;
      const rank = ts ? rankTaiNgay(v.rank.get(userId) ?? [], ngay, ts.rankMacDinh).rank : null;
      dong.rankTheoNgay[ngay] = rank;
      const cuaNgay = v.phanCong.filter((p) => p.userId === userId && p.ngay === ngay && vaiCua(p.role));
      const noiKhac = v.phanCongNoiKhac.filter((p) => p.userId === userId && p.ngay === ngay);
      const trucNgay = v.truc.filter((t) => t.userId === userId && t.ngay === ngay);
      const maCa = ts ? ts.ca.map((c) => c.ma) : ["S", "C", "T"];
      const o: Record<string, OLuoi> = {};
      for (const ma of maCa) o[ma] = { ke: null, thucTe: null, hoatDong: [], trucId: null, canhBao: [] };

      // Trùng giờ: hai phân công của CÙNG người cùng ngày chồng thời gian (mọi cơ sở) — không khả thi.
      const tatCa = [...cuaNgay, ...noiKhac];
      const trung = new Set<string>();
      for (let i = 0; i < tatCa.length; i++)
        for (let j = i + 1; j < tatCa.length; j++) {
          const a = tatCa[i]!;
          const b = tatCa[j]!;
          if (phutTrongNgay(a.gioBatDau) < phutTrongNgay(b.gioKetThuc) && phutTrongNgay(b.gioBatDau) < phutTrongNgay(a.gioKetThuc)) {
            trung.add(a.id);
            trung.add(b.id);
          }
        }

      const vuotCa: PhanCongVao[] = [];
      for (const p of cuaNgay) {
        const ca = ts ? xepVaoCa(ts, p.gioBatDau, p.gioKetThuc) : xepTheoGioLegacy(p.gioBatDau);
        if (!ca || !o[ca]) {
          vuotCa.push(p);
          continue;
        }
        const daGan = DA_GAN.includes(p.status);
        o[ca]!.hoatDong.push({
          id: p.id,
          sourceType: p.sourceType,
          sourceId: p.sourceId,
          vai: vaiCua(p.role)!,
          loai: loaiCua(p),
          gioBatDau: p.gioBatDau,
          gioKetThuc: p.gioKetThuc,
          assignmentType: p.assignmentType,
          daGan,
          trial: p.activityType === "TRIAL" ? (v.trial.get(p.id) ?? null) : null,
        });
        if (!daGan) them(o[ca]!.canhBao, "CHUA_NHAN");
        if (trung.has(p.id)) them(o[ca]!.canhBao, "TRUNG_GIO");
        if (v.nghiDaDuyet.has(`${userId}|${ngay}`)) them(o[ca]!.canhBao, "NGHI_DA_DUYET");
      }
      for (const t of trucNgay) if (o[t.shiftCode]) o[t.shiftCode]!.trucId = t.id;
      for (const p of noiKhac) {
        const ca = ts ? xepVaoCa(ts, p.gioBatDau, p.gioKetThuc) : null;
        if (ca && o[ca]) them(o[ca]!.canhBao, "O_CO_SO_KHAC");
      }

      let tongNgay = 0;
      for (const ma of maCa) {
        const cell = o[ma]!;
        if (!ts || rank == null) {
          if (cell.hoatDong.length || cell.trucId) them(cell.canhBao, "LEGACY");
          continue;
        }
        const hd: HoatDongO[] = cell.hoatDong.map((h) => ({
          id: h.id,
          vai: h.vai,
          loai: h.loai,
          gioBatDau: h.gioBatDau,
          gioKetThuc: h.gioKetThuc,
          donViTiet: cuaNgay.find((p) => p.id === h.id)!.donViTiet,
        }));
        cell.ke = tinhCaDuKien({
          thamSo: ts,
          rank,
          hoatDong: hd,
          truc: cell.trucId ? { dutyId: cell.trucId } : null,
          trial: cell.hoatDong.filter((h) => h.trial && h.vai === "MAIN").map((h) => ({ soTien: h.trial!.soTien })),
        });
        for (const c of cell.ke.canhBao) them(cell.canhBao, c);
        tongNgay += cell.ke.tong;

        // THỰC TẾ: chỉ từ đơn vị đã xác nhận (P5) — không tính lại.
        const dv = [...cell.hoatDong.map((h) => h.id), ...(cell.trucId ? [cell.trucId] : [])].flatMap((id) => xn.get(id) ?? []);
        if (dv.length) {
          const m = dv.filter((d) => d.loai === "MAIN_TEACHING").length;
          const t = dv.filter((d) => d.loai === "ASSISTANT_TEACHING").length;
          const truc = dv.some((d) => d.loai === "OPERATIONS_DUTY");
          cell.thucTe = { ma: maNen({ main: m, ta: t, truc }), tong: Math.round(dv.reduce((s, d) => s + d.quantity * d.rateSnapshot, 0)) };
        }
      }
      dong.o[ngay] = o;
      dong.ngoaiCa[ngay] = vuotCa.map((p) => ({ id: p.id, gioBatDau: p.gioBatDau, gioKetThuc: p.gioKetThuc }));
      dong.tongNgay[ngay] = tongNgay;
      dong.tongTuan += tongNgay;
    }
    ra.push(dong);
  }
  return ra;
}

/** Ngày LEGACY (không có khung ca chính sách): chỉ để HIỆN hoạt động ở đúng buổi trong ngày — không tính mã / tiền. */
function xepTheoGioLegacy(gioBatDau: string): string {
  const p = phutTrongNgay(gioBatDau);
  return p < 12 * 60 ? "S" : p < 17 * 60 + 15 ? "C" : "T";
}
