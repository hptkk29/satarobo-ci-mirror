/**
 * Lưu SỔ SỨC KHOẺ của cổng phụ huynh TRÊN MÁY (localStorage) — số đo, câu trả lời khảo sát, thử thách KHÔNG BAO GIỜ gửi lên máy chủ (chủ dự án chốt 08/11/2026).
 * Đọc lại thì kiểm hình dạng từng phần và bỏ phần hỏng thay vì làm sập trang. Khoá riêng, KHÔNG dùng chung với sổ của trang công khai (`sata.suc-khoe.v1`).
 */
import { TOI_DA_BAN, TOI_DA_NGUOI_CONG, type Ban, type HoatDong, type KhaoSatDaLam, type NguoiCong } from "@/lib/suc-khoe/so-cong";

export const KHOA_LUU_CONG = "sata.portal-suc-khoe.v1";

export type SoCong = { v: 1; ds: NguoiCong[]; thu: Record<string, boolean[]>; dongY: boolean };

const laChuoi = (x: unknown): x is string => typeof x === "string";
const laSo = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const laDoiTuong = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const NGAY = /^\d{4}-\d{2}-\d{2}$/;

function docBan(x: unknown): Ban | null {
  if (!laDoiTuong(x) || !laChuoi(x.id) || !laChuoi(x.ngay) || !NGAY.test(x.ngay) || !laSo(x.cao) || !laSo(x.nang)) return null;
  return { id: x.id, ngay: x.ngay, cao: x.cao, nang: x.nang, eo: laSo(x.eo) ? x.eo : null };
}

function docKhaoSat(x: unknown): KhaoSatDaLam | null {
  if (!laDoiTuong(x) || !laChuoi(x.ngay) || !NGAY.test(x.ngay) || !laChuoi(x.ai) || !laDoiTuong(x.tl)) return null;
  const tl: Record<string, number | number[]> = {};
  for (const [k, v] of Object.entries(x.tl)) {
    if (laSo(v)) tl[k] = v;
    else if (Array.isArray(v) && v.every(laSo)) tl[k] = v;
  }
  return { ngay: x.ngay, ai: x.ai.slice(0, 80), tl };
}

function docNguoi(x: unknown): NguoiCong | null {
  if (!laDoiTuong(x) || !laChuoi(x.id) || !laChuoi(x.ten) || !x.ten.trim() || !laChuoi(x.ns) || !NGAY.test(x.ns)) return null;
  const ban = (Array.isArray(x.ban) ? x.ban : []).map(docBan).filter((b): b is Ban => b !== null).slice(0, TOI_DA_BAN);
  if (ban.length === 0) return null; // người không có số đo nào thì sổ vô nghĩa
  const hd: HoatDong = x.hoatDong === "it" || x.hoatDong === "nhieu" ? x.hoatDong : "vua";
  return {
    id: x.id,
    ten: x.ten.slice(0, 40),
    vt: laChuoi(x.vt) ? x.vt.slice(0, 20) : "Người thân khác",
    ns: x.ns,
    gt: x.gt === "nam" ? "nam" : "nu",
    hoatDong: hd,
    mt: x.mt === true,
    benhNen: x.benhNen === true,
    ban,
    ks: docKhaoSat(x.ks),
  };
}

/** Đọc chuỗi JSON → sổ hợp lệ (hoặc null nếu không dùng được). Tối đa `TOI_DA_NGUOI_CONG` người, id không trùng. */
export function docSoCong(chuoi: string | null): SoCong | null {
  if (!chuoi) return null;
  let tho: unknown;
  try {
    tho = JSON.parse(chuoi);
  } catch {
    return null;
  }
  if (!laDoiTuong(tho) || tho.v !== 1 || !Array.isArray(tho.ds)) return null;
  const thay = new Set<string>();
  const ds: NguoiCong[] = [];
  for (const n of tho.ds) {
    const ng = docNguoi(n);
    if (ng && !thay.has(ng.id) && ds.length < TOI_DA_NGUOI_CONG) {
      thay.add(ng.id);
      ds.push(ng);
    }
  }
  const thu: Record<string, boolean[]> = {};
  if (laDoiTuong(tho.thu)) for (const [k, v] of Object.entries(tho.thu)) if (thay.has(k) && Array.isArray(v) && v.length === 3) thu[k] = v.map((b) => b === true);
  return { v: 1, ds, thu, dongY: tho.dongY === true };
}

export const ghiSoCong = (so: Omit<SoCong, "v">): string => JSON.stringify({ v: 1, ...so });

/** Bản sao lưu cho người dùng tải về. */
export const banSaoLuuCong = (so: Omit<SoCong, "v">): string => JSON.stringify({ v: 1, ...so }, null, 2);
