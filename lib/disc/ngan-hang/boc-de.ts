/**
 * BỐC ĐỀ KHÔNG TRÙNG + DỰNG BỘ ĐỀ ĐỂ `cham()` GỐC CHẤM — hàm THUẦN, tất định theo `hat`.
 *
 * ── Luật bốc (mỗi ô khung chọn đúng MỘT câu) ───────────────────────────────────
 *  1. Ưu tiên câu mà người này CHƯA THẤY và có HÀNH VI (mẫu) chưa thấy ở ô đó.
 *  2. Hết hành vi mới ⇒ câu chưa thấy (cùng hành vi cũ, bối cảnh mới).
 *  3. Thấy hết rồi ⇒ câu thấy LÂU NHẤT (đầu lịch sử) — không bao giờ kẹt.
 *  4. Trong cùng mức ưu tiên: tránh bối cảnh đã dùng trong đề này, tránh trùng bối cảnh
 *     với câu ngay trước nó; còn lại bốc theo `hat`.
 *
 * Hệ quả đo được (test `[BD-03]`, `[BD-04]`): với ≥ 6 mẫu mỗi ô, 6 lần làm đầu tiên không
 * gặp lại một hành vi nào; với ≥ 91 câu mỗi ô, phải tới lần thứ 92 mới gặp lại đúng một câu.
 *
 * ── Vì sao điểm vẫn ĐÚNG khi mỗi người một đề ─────────────────────────────────
 * Đề bốc ra có đúng số câu, đúng trục, đúng chiều thuận/đảo, đúng thứ tự trục của đề gốc
 * (`kiemKhung` kiểm, và `dungBoDe` từ chối đề sai khung). `cham()` chỉ đọc `truc`, `dao`,
 * `mucToiDa` và đếm câu, nên đề cùng khung chấm theo CÙNG một phép tính với đề gốc.
 *
 * Thuộc TẦNG LÕI: không đồng hồ, không ngẫu nhiên thật (PRNG gieo bằng `hat`).
 */

import { NGAN_HANG } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import { type BoDe, type CauHoi, type MaBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

import { CAU_LOAI_TRU, PHIEN_BAN_KHUNG } from "./khung";
import { cauThayChoO, oKhungCua, timCauNganHang } from "./nap";
import type { CauNganHang } from "./sinh";

export type DeDaBoc = {
  readonly boDe: MaBoDe;
  readonly phienBanKhung: string;
  /** Mã câu theo ĐÚNG thứ tự hiển thị (vị trí i ↔ ô khung thứ i). */
  readonly maCau: readonly string[];
};

export type YeuCauBoc = {
  readonly boDe: MaBoDe;
  /** Mã các câu người này đã gặp, CŨ TRƯỚC — MỚI SAU. Câu lạ (phiên bản cũ) bị bỏ qua. */
  readonly daThay: readonly string[];
  /** Hạt gieo. Cùng `hat` + cùng lịch sử ⇒ cùng đề (tái hiện được lỗi). */
  readonly hat: string;
};

/* ── PRNG nhỏ, tất định ───────────────────────────────────────────────────── */

function bamChuoi(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function taoNgauNhien(hat: string): () => number {
  let a = bamChuoi(hat) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Bốc ──────────────────────────────────────────────────────────────────── */

const khoaHanhVi = (c: CauNganHang) => `${c.oKhung}#${c.mau ?? "goc"}`;

export function bocDe(yc: YeuCauBoc): DeDaBoc {
  const lanCuoi = new Map<string, number>();
  const hanhViDaThay = new Set<string>();
  yc.daThay.forEach((ma, i) => {
    const c = timCauNganHang(ma);
    if (!c || c.boDe !== yc.boDe) return;
    lanCuoi.set(ma, i);
    hanhViDaThay.add(khoaHanhVi(c));
  });

  const rnd = taoNgauNhien(`${PHIEN_BAN_KHUNG}|${yc.boDe}|${yc.hat}|${yc.daThay.length}`);
  const boiCanhDaDung = new Set<string>();
  let boiCanhTruoc: string | undefined;
  const maCau: string[] = [];

  for (const o of oKhungCua(yc.boDe)) {
    const ungVien = cauThayChoO(yc.boDe, o).filter((c) => !(c.ma in CAU_LOAI_TRU));
    if (ungVien.length === 0) throw new Error(`Ô ${o} không còn câu nào để bốc (đã loại hết?).`);

    // Mức ưu tiên: 0 = câu mới + hành vi mới · 1 = câu mới · 2 = đã thấy (xếp theo độ cũ).
    const muc = (c: CauNganHang) => (lanCuoi.has(c.ma) ? 2 : hanhViDaThay.has(khoaHanhVi(c)) ? 1 : 0);
    const mucTot = Math.min(...ungVien.map(muc));
    let nhom = ungVien.filter((c) => muc(c) === mucTot);
    if (mucTot === 2) {
      const cuNhat = Math.min(...nhom.map((c) => lanCuoi.get(c.ma) ?? 0));
      nhom = nhom.filter((c) => lanCuoi.get(c.ma) === cuNhat);
    }

    // Đa dạng bối cảnh trong cùng đề — chỉ là ưu tiên, không bao giờ làm rỗng nhóm.
    const khacTruoc = nhom.filter((c) => c.boiCanh === undefined || c.boiCanh !== boiCanhTruoc);
    if (khacTruoc.length > 0) nhom = khacTruoc;
    const chuaDung = nhom.filter((c) => c.boiCanh === undefined || !boiCanhDaDung.has(c.boiCanh));
    if (chuaDung.length > 0) nhom = chuaDung;

    const chon = nhom[Math.floor(rnd() * nhom.length)];
    maCau.push(chon.ma);
    if (chon.boiCanh) boiCanhDaDung.add(chon.boiCanh);
    boiCanhTruoc = chon.boiCanh;
  }

  return { boDe: yc.boDe, phienBanKhung: PHIEN_BAN_KHUNG, maCau };
}

/* ── Kiểm khung ───────────────────────────────────────────────────────────── */

export type LoiKhung =
  | { readonly ma: "KHUNG_CU"; readonly co: string }
  | { readonly ma: "SAI_SO_CAU"; readonly can: number; readonly co: number }
  | { readonly ma: "CAU_LA"; readonly viTri: number; readonly maCau: string }
  | { readonly ma: "SAI_O"; readonly viTri: number; readonly maCau: string; readonly oCan: string }
  | { readonly ma: "TRUNG_CAU"; readonly maCau: string };

/** Đề có đúng khung không. Rỗng = đúng. Đề sai khung thì KHÔNG được chấm. */
export function kiemKhung(de: DeDaBoc): LoiKhung[] {
  const loi: LoiKhung[] = [];
  if (de.phienBanKhung !== PHIEN_BAN_KHUNG) loi.push({ ma: "KHUNG_CU", co: de.phienBanKhung });
  const oKhung = oKhungCua(de.boDe);
  if (de.maCau.length !== oKhung.length) {
    loi.push({ ma: "SAI_SO_CAU", can: oKhung.length, co: de.maCau.length });
    return loi;
  }
  const daGap = new Set<string>();
  de.maCau.forEach((ma, i) => {
    if (daGap.has(ma)) loi.push({ ma: "TRUNG_CAU", maCau: ma });
    daGap.add(ma);
    const c = timCauNganHang(ma);
    if (!c || c.boDe !== de.boDe) {
      loi.push({ ma: "CAU_LA", viTri: i, maCau: ma });
      return;
    }
    if (c.oKhung !== oKhung[i]) loi.push({ ma: "SAI_O", viTri: i, maCau: ma, oCan: oKhung[i] });
  });
  return loi;
}

export class LoiDe extends Error {
  constructor(readonly chiTiet: readonly LoiKhung[]) {
    super(`Đề sai khung: ${chiTiet.map((l) => l.ma).join(", ")}`);
    this.name = "LoiDe";
  }
}

/**
 * Dựng `BoDe` (kiểu của engine gốc) từ đề đã bốc: giữ nguyên thang, câu dẫn, `mucToiDa` của
 * bộ gốc; chỉ thay danh sách câu. Đây là thứ đưa vào `cham()`.
 *
 * 🔴 NÉM khi đề sai khung — không có đường nào để một đề lệch trục được chấm thành điểm.
 */
export function dungBoDe(de: DeDaBoc): BoDe {
  const loi = kiemKhung(de);
  if (loi.length > 0) throw new LoiDe(loi);
  const goc = NGAN_HANG[de.boDe];
  const cau: CauHoi[] = de.maCau.map((ma) => {
    const c = timCauNganHang(ma) as CauNganHang;
    return { ma: c.ma, truc: c.truc, dao: c.dao, noiDung: c.noiDung };
  });
  return { ...goc, cau };
}

/* ── Phần đi ra trình duyệt ───────────────────────────────────────────────── */

export type CauChoKhach = { readonly viTri: number; readonly noiDung: string };

/**
 * Chỉ VỊ TRÍ + NỘI DUNG. Không mã câu (mã chứa ô khung ⇒ lộ trục), không trục, không chiều.
 * Client gửi lại câu trả lời theo vị trí; máy chủ đổi vị trí → mã bằng đề đã ký.
 */
export function deChoKhach(de: DeDaBoc): CauChoKhach[] {
  return de.maCau.map((ma, viTri) => ({ viTri, noiDung: (timCauNganHang(ma) as CauNganHang).noiDung }));
}

/** Đổi câu trả lời theo vị trí (client gửi) sang theo mã câu (`cham()` đọc). */
export function traLoiTheoMa(de: DeDaBoc, theoViTri: Readonly<Record<string, number>>): Record<string, number> {
  const ra: Record<string, number> = {};
  for (const [k, v] of Object.entries(theoViTri)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= de.maCau.length) continue;
    ra[de.maCau[i]] = v;
  }
  return ra;
}
