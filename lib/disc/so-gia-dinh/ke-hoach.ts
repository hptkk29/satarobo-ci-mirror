/**
 * KẾ HOẠCH HÀNH ĐỘNG 7 NGÀY · 1 THÁNG · 1 NĂM (doc 18, mục 7.2–7.3) — sinh từ bản phân tích cả nhà.
 *
 * Nguyên tắc nội dung: KHÔNG tự viết lời khuyên. Mỗi việc của một người lấy NGUYÊN từ bảng `VIEC_CUA_TOI` (và `THOA_THUAN`) của engine
 * qua `theChieu()`. Khung kế hoạch (tên nghi thức, chủ đề quý, mốc) lấy từ «Spec Hệ thống DISC Gia đình» mục 8.2–8.3 và doc 18 mục 7.2.
 * Chỗ không có nội dung (ví dụ lát cắt hai người trùng khớp ⇒ không có «việc của tôi») thì KHÔNG có việc — chứ không bịa.
 *
 *   7 ngày:  ngày 1–5 mỗi người ≤ 1 việc/ngày (≤ 10 phút) hướng tới đúng MỘT người nhận chính (người có độ ưu tiên cặp cao nhất với họ);
 *            không lặp một việc 3 ngày liền · ngày 6 hoạt động chung · ngày 7 họp nhà 20 phút.
 *   1 tháng: thoả thuận hai tuần của 2 cặp lệch nhất (tuần 1–2 cặp 1, tuần 3–4 cặp 2) + mỗi tuần một nghi thức cả nhà + việc theo tuần cho cặp.
 *   1 năm:   4 quý × 1 chủ đề; mỗi tháng 1 «ngày gia đình» do lần lượt từng người lên kế hoạch; mốc làm lại bài; việc bù nhóm còn thiếu.
 *
 * Độ khó (`doKho` 1–3) quyết định kho việc của mỗi người: 1 = trục lệch nhất với người nhận chính · 2 = thêm trục thứ hai · 3 = thêm các cặp tiếp theo.
 * Trẻ bậc «nhỏ» (mầm non – lớp 2) không nhận việc tự làm: bảng việc của engine viết cho trẻ đọc được, chưa có bản cho bậc này.
 *
 * Thuần, tất định, không đồng hồ: `batDau` truyền vào là chuỗi YYYY-MM-DD.
 */
import { bacCuaTre } from "@/lib/disc/engine-goc/modules/core/gia-dinh/bac-hoc";

import { type BanChup, theChieu, type TheChieu, chiSoTuChup } from "./phan-tich";
import { congNgay, soNgayGiua, type MaTruc } from "./kieu";
import { VIEC_BU_THIEU } from "./chi-so";

export type KyKeHoach = "NGAY_7" | "THANG_1" | "NAM_1";
export const MOI_KY: readonly KyKeHoach[] = ["NGAY_7", "THANG_1", "NAM_1"];
export const NHAN_KY: Readonly<Record<KyKeHoach, string>> = { NGAY_7: "7 ngày", THANG_1: "1 tháng", NAM_1: "1 năm" };
export const SO_NGAY_KY: Readonly<Record<KyKeHoach, number>> = { NGAY_7: 7, THANG_1: 28, NAM_1: 365 };

export const PHUT_VIEC_NHO = 10;
export const PHUT_HOP_NHA = 20;
export const PHUT_HOAT_DONG_CHUNG = 30;
export const DO_KHO_TOI_DA = 3;
/** Tick muộn tối đa 2 ngày sau ngày của việc (doc 18, 7.3). */
export const TICK_MUON_TOI_DA_NGAY = 2;

export type HoatDongDaKiem = {
  readonly id: string;
  readonly loai: string;
  readonly moTa: string;
  readonly phut: number;
  readonly chiPhi: string | null;
  readonly diaDiem: { readonly ten: string; readonly diaChi: string } | null;
};

export type ViecSinh = {
  /** YYYY-MM-DD */
  readonly ngay: string;
  /** null = việc của cả nhà. */
  readonly nguoiLamId: string | null;
  readonly nguoiNhanId: string | null;
  /** Khoá bảng nội dung đã sinh ra việc — truy nguồn, không phải nội dung. */
  readonly nguon: string;
  readonly noiDung: string;
  readonly phut: number;
  readonly hoatDongId: string | null;
};

export type DauVaoKeHoach = {
  readonly chup: BanChup;
  readonly ky: KyKeHoach;
  readonly batDau: string;
  readonly doKho: number;
  readonly soViecTuan: number;
  readonly hoatDong: readonly HoatDongDaKiem[];
};

/* ── Khung cố định (Spec §8.2–8.3) ────────────────────────────────────────── */

export const NGHI_THUC_TUAN: readonly { readonly tuan: number; readonly chuDe: string; readonly nghiThuc: string }[] = [
  { tuan: 1, chuDe: "Lắng nghe", nghiThuc: "Họp gia đình 20 phút Chủ nhật" },
  { tuan: 2, chuDe: "Ghi nhận", nghiThuc: "Bữa tối «mỗi người khen 1 người», 2 lần trong tuần" },
  { tuan: 3, chuDe: "Thoả thuận", nghiThuc: "Cùng viết 3–5 «luật nhà» (giờ học, điện thoại, việc nhà)" },
  { tuan: 4, chuDe: "Tổng kết", nghiThuc: "Xem lại điểm hoà thuận 4 tuần, chọn chủ đề tháng sau" },
];

export const QUY_NAM: readonly { readonly quy: number; readonly chuDe: string; readonly mucTieu: string; readonly moc: string }[] = [
  { quy: 1, chuDe: "Giao tiếp", mucTieu: "Họp gia đình đều đặn, không có tuần nào bỏ", moc: "Cuối quý xem lại báo cáo cặp" },
  { quy: 2, chuDe: "Phân việc", mucTieu: "Bảng việc nhà theo điểm mạnh từng người", moc: "Tháng 6: trẻ dưới 16 tuổi làm lại bài" },
  {
    quy: 3,
    chuDe: "Xử lý mâu thuẫn",
    mucTieu: "Quy trình «dừng – nói nhu cầu – thoả thuận»",
    moc: "Một chuyến đi có phần cho cả 4 nhóm: phiêu lưu (D), giao lưu (I), nghỉ ngơi (S), tự lên lịch (C)",
  },
  { quy: 4, chuDe: "Mục tiêu chung", mucTieu: "Cả nhà chọn 1 mục tiêu năm sau", moc: "Tháng 12: cả nhà làm lại bài, nhận báo cáo so sánh 2 lần" },
];

export const CHU_DE_NGAY_CHUNG = {
  hoatDongChung: "Hoạt động chung — cả nhà chơi 1 trò, mỗi người chọn một phần (30 phút)",
  hopNha: "Họp gia đình đầu tiên — 20 phút: mỗi người nói 1 điều vui trong tuần và 1 mong muốn tuần sau",
} as const;

/* ── Việc của một người ───────────────────────────────────────────────────── */

type UngVien = { readonly nguoiNhanId: string; readonly nguon: string; readonly noiDung: string; readonly uuTien: number; readonly trucThu: number };

/** Kho việc của MỘT người, đã lọc theo độ khó; xếp: người nhận ưu tiên cao trước, trục lệch nhất trước. */
export function khoViecCuaNguoi(chup: BanChup, nguoiId: string, doKho: number): UngVien[] {
  const chiSo = chiSoTuChup(chup);
  const toi = chup.nguoi.find((n) => n.id === nguoiId);
  if (!toi || !chiSo) return [];
  // Trẻ bậc nhỏ: không có bản việc phù hợp ⇒ không sinh.
  if (toi.laTre && bacCuaTre(toi.lop ?? undefined) === "nho") return [];

  const uuTienVoi = new Map<string, number>();
  for (const c of chiSo.cap) {
    if (c.aId === nguoiId) uuTienVoi.set(c.bId, c.uuTien);
    else if (c.bId === nguoiId) uuTienVoi.set(c.aId, c.uuTien);
  }
  const nguoiKia = chup.nguoi
    .filter((n) => n.id !== nguoiId)
    .sort((a, b) => (uuTienVoi.get(b.id) ?? 0) - (uuTienVoi.get(a.id) ?? 0));

  const kq: UngVien[] = [];
  nguoiKia.forEach((kia) => {
    const the = theChieu(chup, nguoiId, kia.id);
    if (!the) return;
    the.lech.forEach((k, idxTruc) => {
      kq.push({
        nguoiNhanId: kia.id,
        nguon: `VIEC_CUA_TOI:${k.truc}:${k.huong}:${the.theQuyen}`,
        noiDung: k.viecCuaToi,
        uuTien: uuTienVoi.get(kia.id) ?? 0,
        trucThu: idxTruc,
      });
    });
  });

  const dk = Math.max(1, Math.min(DO_KHO_TOI_DA, Math.floor(doKho)));
  const nguoiChinh = nguoiKia[0]?.id;
  return kq.filter((u) => {
    if (dk >= 3) return true;
    if (u.nguoiNhanId !== nguoiChinh) return false;
    return dk >= 2 ? true : u.trucThu === 0;
  });
}

/** Người nhận chính của một người = người có độ ưu tiên cặp cao nhất với họ (null nếu không ai). */
export function nguoiNhanChinh(chup: BanChup, nguoiId: string): string | null {
  const chiSo = chiSoTuChup(chup);
  if (!chiSo) return null;
  const ds = chiSo.capTheoUuTien.filter((c) => c.aId === nguoiId || c.bId === nguoiId);
  const c = ds[0];
  return c ? (c.aId === nguoiId ? c.bId : c.aId) : null;
}

/** Những ngày (1–5) mà mỗi người có việc, theo số việc/tuần. */
export function ngayCoViec(soViecTuan: number): readonly number[] {
  if (soViecTuan >= 5) return [1, 2, 3, 4, 5];
  if (soViecTuan === 4) return [1, 2, 4, 5];
  return [1, 3, 5];
}

/**
 * Mỗi ngày một việc, không lặp một việc 3 ngày liền. Ưu tiên `kho` (đúng độ khó, người nhận chính); chỉ khi kho đó KHÔNG còn việc nào hợp lệ
 * (ví dụ nhà ≥ 4 người chỉ có MỘT câu «việc của tôi» cho người nhận chính) mới lấy từ `khoRong` (mọi người nhận) — để không có ngày trống
 * mà vẫn không tự bịa nội dung.
 */
function chonViecTheoNgay(
  kho: readonly UngVien[],
  khoRong: readonly UngVien[],
  ngayDung: readonly number[],
): ({ readonly ngay: number; readonly v: UngVien } | null)[] {
  // Lịch sử theo NGÀY (kể cả ngày bỏ trống = null) để «không lặp một việc 3 ngày liền» tính đúng sau một ngày nghỉ.
  const lichSu: (string | null)[] = [];
  const kq: ({ ngay: number; v: UngVien } | null)[] = [];
  let con = 0;
  let conRong = 0;
  const thu = (ds: readonly UngVien[], dau: number, haiGanNhat: (string | null)[]): { u: UngVien; k: number } | null => {
    for (let k = 0; k < ds.length; k++) {
      const u = ds[(dau + k) % ds.length]!;
      const lap3 = haiGanNhat.length === 2 && haiGanNhat[0] === u.noiDung && haiGanNhat[1] === u.noiDung;
      if (!lap3) return { u, k };
    }
    return null;
  };
  for (const ngay of ngayDung) {
    const haiGanNhat = lichSu.slice(-2);
    let chon: UngVien | null = null;
    const a = thu(kho, con, haiGanNhat);
    if (a) {
      chon = a.u;
      con = (con + a.k + 1) % kho.length;
    } else {
      const b = thu(khoRong, conRong, haiGanNhat);
      if (b) {
        chon = b.u;
        conRong = (conRong + b.k + 1) % khoRong.length;
      }
    }
    lichSu.push(chon ? chon.noiDung : null);
    kq.push(chon ? { ngay, v: chon } : null);
  }
  return kq;
}

/* ── Sinh kế hoạch ────────────────────────────────────────────────────────── */

function viecCaNha(ngay: string, nguon: string, noiDung: string, phut: number, hd?: HoatDongDaKiem): ViecSinh {
  return { ngay, nguoiLamId: null, nguoiNhanId: null, nguon, noiDung, phut, hoatDongId: hd?.id ?? null };
}

/** Mô tả hoạt động ĐÃ KIỂM; có địa điểm thì nêu địa điểm, không có thì chỉ mô tả — không bịa. */
export function chuHoatDong(hd: HoatDongDaKiem): string {
  return hd.diaDiem ? `${hd.moTa} — ${hd.diaDiem.ten}, ${hd.diaDiem.diaChi}` : hd.moTa;
}

function sinh7Ngay(dv: DauVaoKeHoach, batDau: string, soViecTuan: number, doKho: number, tuanThu = 1): ViecSinh[] {
  const kq: ViecSinh[] = [];
  const ngayDung = ngayCoViec(soViecTuan);
  for (const n of dv.chup.nguoi) {
    const chon = chonViecTheoNgay(khoViecCuaNguoi(dv.chup, n.id, doKho), khoViecCuaNguoi(dv.chup, n.id, DO_KHO_TOI_DA), ngayDung);
    for (const c of chon) {
      if (!c) continue;
      kq.push({
        ngay: congNgay(batDau, c.ngay - 1),
        nguoiLamId: n.id,
        nguoiNhanId: c.v.nguoiNhanId,
        nguon: c.v.nguon,
        noiDung: c.v.noiDung,
        phut: PHUT_VIEC_NHO,
        hoatDongId: null,
      });
    }
  }
  const hd = dv.hoatDong[0];
  kq.push(
    viecCaNha(
      congNgay(batDau, 5),
      hd ? `HOAT_DONG:${hd.id}` : "HOAT_DONG_CHUNG",
      hd ? chuHoatDong(hd) : CHU_DE_NGAY_CHUNG.hoatDongChung,
      hd ? Math.min(hd.phut, 240) : PHUT_HOAT_DONG_CHUNG,
      hd,
    ),
  );
  kq.push(viecCaNha(congNgay(batDau, 6), tuanThu === 1 ? "HOP_NHA" : `HOP_NHA:${tuanThu}`, CHU_DE_NGAY_CHUNG.hopNha, PHUT_HOP_NHA));
  return kq;
}

/** Hai cặp lệch nhất: lấy theo độ ưu tiên, bỏ cặp không có khối lệch nào (không có nội dung để thoả thuận). */
export function capCoNoiDung(chup: BanChup): { readonly a: string; readonly b: string; readonly the: TheChieu }[] {
  const chiSo = chiSoTuChup(chup);
  if (!chiSo) return [];
  const kq: { a: string; b: string; the: TheChieu }[] = [];
  for (const c of chiSo.capTheoUuTien) {
    const the = theChieu(chup, c.aId, c.bId);
    if (the && the.lech.length > 0) kq.push({ a: c.aId, b: c.bId, the });
  }
  return kq;
}

function sinh1Thang(dv: DauVaoKeHoach): ViecSinh[] {
  const kq: ViecSinh[] = [];
  const caps = capCoNoiDung(dv.chup).slice(0, 2);
  const nghiThucNgay = (tuan: number) => congNgay(dv.batDau, 7 * (tuan - 1) + 6);

  for (const nt of NGHI_THUC_TUAN) {
    kq.push(viecCaNha(nghiThucNgay(nt.tuan), `NGHI_THUC:${nt.tuan}`, nt.nghiThuc, nt.tuan === 1 ? PHUT_HOP_NHA : 30));
  }
  // Thoả thuận hai tuần: cặp 1 ở tuần 1, cặp 2 ở tuần 3.
  caps.forEach((cap, i) => {
    const k = cap.the.lech[0]!;
    kq.push({
      ngay: congNgay(dv.batDau, 14 * i),
      nguoiLamId: cap.a,
      nguoiNhanId: cap.b,
      nguon: `THOA_THUAN:${k.truc}:${k.huong}`,
      noiDung: k.thoaThuan,
      phut: PHUT_VIEC_NHO,
      hoatDongId: null,
    });
  });
  // Việc theo tuần cho cặp cần chú ý.
  caps.forEach((cap, i) => {
    const k = cap.the.lech[0]!;
    kq.push({
      ngay: congNgay(dv.batDau, 7 + i),
      nguoiLamId: cap.a,
      nguoiNhanId: cap.b,
      nguon: `VIEC_CUA_TOI:${k.truc}:${k.huong}:${cap.the.theQuyen}`,
      noiDung: k.viecCuaToi,
      phut: PHUT_VIEC_NHO,
      hoatDongId: null,
    });
    kq.push({
      ngay: congNgay(dv.batDau, 2 + i),
      nguoiLamId: cap.a,
      nguoiNhanId: cap.b,
      nguon: "MOT_MOT_30P",
      noiDung: "Một buổi 1-1, 30 phút, chỉ hai người — không bàn bài vở hay việc nhà.",
      phut: 30,
      hoatDongId: null,
    });
  });
  // Tuần 4: mỗi người viết một lời cảm ơn cho người nhận chính.
  for (const n of dv.chup.nguoi) {
    const nhan = nguoiNhanChinh(dv.chup, n.id);
    if (!nhan) continue;
    const tenNhan = dv.chup.nguoi.find((x) => x.id === nhan)?.ten ?? "";
    kq.push({
      ngay: congNgay(dv.batDau, 7 * 3 + 5),
      nguoiLamId: n.id,
      nguoiNhanId: nhan,
      nguon: "CAM_ON_CUOI_THANG",
      noiDung: `Viết một lời cảm ơn gửi ${tenNhan}.`,
      phut: PHUT_VIEC_NHO,
      hoatDongId: null,
    });
  }
  return kq;
}

function sinh1Nam(dv: DauVaoKeHoach): ViecSinh[] {
  const kq: ViecSinh[] = [];
  const chiSo = chiSoTuChup(dv.chup);
  const nguoi = dv.chup.nguoi;
  for (let i = 0; i < 12; i++) {
    const ai = nguoi[i % nguoi.length]!;
    kq.push({
      ngay: congNgay(dv.batDau, 30 * i + 20),
      nguoiLamId: ai.id,
      nguoiNhanId: null,
      nguon: `NGAY_GIA_DINH:${i + 1}`,
      noiDung: `Tháng ${i + 1}: ${ai.ten} lên kế hoạch ngày gia đình — chọn một hoạt động cả nhà cùng làm.`,
      phut: 120,
      hoatDongId: null,
    });
  }
  const thieu: readonly MaTruc[] = chiSo?.thieu ?? [];
  if (thieu.length > 0) {
    for (let q = 0; q < 4; q++) {
      const x = thieu[q % thieu.length]!;
      kq.push(viecCaNha(congNgay(dv.batDau, 91 * q + 7), `BU_THIEU:${x}`, `Quý ${q + 1}: ${VIEC_BU_THIEU[x]}.`, PHUT_VIEC_NHO));
    }
  }
  kq.push(viecCaNha(congNgay(dv.batDau, 180), "LAM_LAI_BAI:6T", "Đến hạn làm lại bài DISC (6 tháng): mở mục «Làm bài» để so với lần trước.", 15));
  kq.push(viecCaNha(congNgay(dv.batDau, 360), "LAM_LAI_BAI:12T", "Cả nhà làm lại bài DISC để nhận báo cáo so sánh hai lần.", 15));
  return kq;
}

export function sinhKeHoach(dv: DauVaoKeHoach): ViecSinh[] {
  const doKho = Math.max(1, Math.min(DO_KHO_TOI_DA, Math.floor(dv.doKho)));
  const soViec = Math.max(3, Math.min(7, Math.floor(dv.soViecTuan)));
  const ds = dv.ky === "NGAY_7" ? sinh7Ngay(dv, dv.batDau, soViec, doKho) : dv.ky === "THANG_1" ? sinh1Thang(dv) : sinh1Nam(dv);
  return ds.sort((a, b) => (a.ngay < b.ngay ? -1 : a.ngay > b.ngay ? 1 : 0));
}

/* ── Tick, cảm ơn ─────────────────────────────────────────────────────────── */

export type LyDoKhongTick = "VIEC_CHUA_TOI_NGAY" | "QUA_HAN_TICK" | "DA_TICK";

/** Tick được khi ngày của việc ≤ hôm nay ≤ ngày của việc + 2. */
export function choPhepTick(ngayViec: string, homNay: string, daTick: boolean): { readonly duoc: true } | { readonly duoc: false; readonly lyDo: LyDoKhongTick } {
  if (daTick) return { duoc: false, lyDo: "DA_TICK" };
  const cach = soNgayGiua(ngayViec, homNay);
  if (cach < 0) return { duoc: false, lyDo: "VIEC_CHUA_TOI_NGAY" };
  if (cach > TICK_MUON_TOI_DA_NGAY) return { duoc: false, lyDo: "QUA_HAN_TICK" };
  return { duoc: true };
}

export const CAU_KHONG_TICK: Readonly<Record<LyDoKhongTick, string>> = {
  VIEC_CHUA_TOI_NGAY: "Việc này chưa tới ngày.",
  QUA_HAN_TICK: "Việc đã quá 2 ngày, không đánh dấu bù được nữa.",
  DA_TICK: "Việc này đã được đánh dấu.",
};

/* ── Check-in và tự điều chỉnh (doc 18, 7.3) ──────────────────────────────── */

export type KetQuaTuan = {
  /** 1-based, tuần của kế hoạch. */
  readonly tuan: number;
  /** Tỉ lệ hoàn thành 0–1 (việc đã xong / việc của tuần). null nếu tuần không có việc nào. */
  readonly tyLeHoanThanh: number | null;
  /** Điểm hoà thuận trung bình các check-in (1–5). null nếu chưa ai check-in. */
  readonly diemTrungBinh: number | null;
  /** Điểm của TỪNG người trong tuần (để tìm cặp bị chấm thấp). */
  readonly diemTheoNguoi: Readonly<Record<string, number>>;
};

export type QuyetDinhDieuChinh = {
  readonly soViecTuan: number;
  readonly doKho: number;
  /** Cặp (idA|idB) cần đổi việc khác cùng khối và thêm 1 buổi 1-1. */
  readonly capCanThem1_1: readonly string[];
  readonly lyDo: readonly string[];
};

export const NGUONG_HOAN_THANH_THAP = 0.4;
export const NGUONG_HOAN_THANH_CAO = 0.8;
export const DIEM_HAI_HOA_CAO = 4;
export const DIEM_HAI_HOA_THAP = 2;

export function khoaCap(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Điều chỉnh tuần sau từ các tuần đã có kết quả (cũ → mới). Ba luật (doc 18, 7.3):
 *  · hoàn thành < 40% ⇒ còn 3 việc/tuần, độ khó 1;
 *  · một người chấm ≤ 2 hai tuần liền ⇒ cặp của họ với người nhận chính được đổi việc + thêm 1 buổi 1-1
 *    (diễn giải: bản đặc tả nói «một cặp được chấm thấp» nhưng check-in chấm theo NGƯỜI, nên cặp = người đó × người nhận chính của họ);
 *  · ≥ 80% hoàn thành và điểm ≥ 4 trong 2 tuần liền ⇒ tăng độ khó (tối đa 3).
 * Luật hoàn thành thấp thắng luật tăng độ khó (không vừa giảm vừa tăng).
 */
export function dieuChinhTuanSau(
  hienTai: { readonly soViecTuan: number; readonly doKho: number },
  tuanDaQua: readonly KetQuaTuan[],
  nguoiNhanChinhCua: (nguoiId: string) => string | null,
): QuyetDinhDieuChinh {
  const ds = [...tuanDaQua].sort((a, b) => a.tuan - b.tuan);
  const moi = ds[ds.length - 1];
  const truoc = ds[ds.length - 2];
  let soViecTuan = hienTai.soViecTuan;
  let doKho = hienTai.doKho;
  const lyDo: string[] = [];
  const cap: string[] = [];

  if (moi && moi.tyLeHoanThanh !== null && moi.tyLeHoanThanh < NGUONG_HOAN_THANH_THAP) {
    soViecTuan = 3;
    doKho = 1;
    lyDo.push("Hoàn thành dưới 40%: tuần sau còn 3 việc, độ khó 1.");
  } else if (
    moi &&
    truoc &&
    moi.tyLeHoanThanh !== null &&
    truoc.tyLeHoanThanh !== null &&
    moi.tyLeHoanThanh >= NGUONG_HOAN_THANH_CAO &&
    truoc.tyLeHoanThanh >= NGUONG_HOAN_THANH_CAO &&
    moi.diemTrungBinh !== null &&
    truoc.diemTrungBinh !== null &&
    moi.diemTrungBinh >= DIEM_HAI_HOA_CAO &&
    truoc.diemTrungBinh >= DIEM_HAI_HOA_CAO
  ) {
    doKho = Math.min(DO_KHO_TOI_DA, doKho + 1);
    lyDo.push("Hoàn thành trên 80% và điểm từ 4 trở lên hai tuần liền: tăng độ khó.");
  }

  if (moi && truoc) {
    for (const [id, d] of Object.entries(moi.diemTheoNguoi)) {
      const dTruoc = truoc.diemTheoNguoi[id];
      if (d <= DIEM_HAI_HOA_THAP && dTruoc !== undefined && dTruoc <= DIEM_HAI_HOA_THAP) {
        const nhan = nguoiNhanChinhCua(id);
        if (nhan) cap.push(khoaCap(id, nhan));
      }
    }
    if (cap.length > 0) lyDo.push("Có người chấm thấp hai tuần liền: đổi việc khác cùng khối và thêm 1 buổi 1-1 cho cặp đó.");
  }
  return { soViecTuan, doKho, capCanThem1_1: [...new Set(cap)], lyDo };
}

/** Tuần (1-based) của một ngày trong kế hoạch; ngoài kế hoạch ⇒ null. */
export function tuanCuaNgay(batDau: string, ngay: string, soNgayKy: number): number | null {
  const d = soNgayGiua(batDau, ngay);
  if (d < 0 || d >= soNgayKy) return null;
  return Math.floor(d / 7) + 1;
}
