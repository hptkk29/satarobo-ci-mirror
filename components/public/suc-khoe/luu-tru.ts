/**
 * Lưu sổ sức khỏe TRÊN MÁY (localStorage). Câu trả lời, số đo, kết quả KHÔNG BAO GIỜ gửi lên máy chủ — phiếu «để lại thông tin» chỉ mang liên hệ.
 * Đọc lại thì kiểm hình dạng từng người (dữ liệu có thể do bản cũ/người dùng sửa tay) và bỏ phần hỏng thay vì làm sập trang.
 */
import { TOI_DA_LUOT, TOI_DA_NGUOI } from "@/lib/suc-khoe/dong-co-goc";
import type { Luot, Nguoi, TraLoi } from "./kieu";

export const KHOA_LUU = "sata.suc-khoe.v1";

export type SoLuu = { v: 1; ds: Nguoi[]; thu: Record<string, boolean[]> };

const laChuoi = (x: unknown): x is string => typeof x === "string";
const laDoiTuong = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const NGAY = /^\d{4}-\d{2}-\d{2}$/;

function docTraLoi(x: unknown): TraLoi {
  const ra: TraLoi = {};
  if (!laDoiTuong(x)) return ra;
  for (const [k, v] of Object.entries(x)) if (typeof v === "string" || typeof v === "number") ra[k] = v;
  return ra;
}

function docLuot(x: unknown): Luot | null {
  if (!laDoiTuong(x) || !laChuoi(x.id) || !laChuoi(x.ngay) || !NGAY.test(x.ngay)) return null;
  const xtl: Record<string, number> = {};
  if (laDoiTuong(x.xtl)) for (const [k, v] of Object.entries(x.xtl)) if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 10) xtl[k] = v;
  return { id: x.id, ngay: x.ngay, tl: docTraLoi(x.tl), xoay: Array.isArray(x.xoay) ? x.xoay.filter(laChuoi) : [], xtl };
}

function docNguoi(x: unknown): Nguoi | null {
  if (!laDoiTuong(x) || !laChuoi(x.id) || !laChuoi(x.ten) || !x.ten.trim() || !laChuoi(x.ns) || !NGAY.test(x.ns)) return null;
  const luot = (Array.isArray(x.luot) ? x.luot : []).map(docLuot).filter((l): l is Luot => l !== null).slice(0, TOI_DA_LUOT);
  return {
    id: x.id,
    ten: x.ten.slice(0, 40),
    vt: laChuoi(x.vt) ? x.vt.slice(0, 20) : "Người thân khác",
    ns: x.ns,
    gt: x.gt === "nam" ? "nam" : "nu",
    mt: x.mt === true,
    viDu: x.viDu === true,
    daThay: Array.isArray(x.daThay) ? x.daThay.filter(laChuoi) : [],
    luot,
  };
}

/** Đọc chuỗi JSON → sổ hợp lệ (hoặc null nếu không dùng được). Tối đa `TOI_DA_NGUOI` người, id không trùng. */
export function docSoLuu(chuoi: string | null): SoLuu | null {
  if (!chuoi) return null;
  let tho: unknown;
  try {
    tho = JSON.parse(chuoi);
  } catch {
    return null;
  }
  if (!laDoiTuong(tho) || tho.v !== 1 || !Array.isArray(tho.ds)) return null;
  const thay = new Set<string>();
  const ds: Nguoi[] = [];
  for (const n of tho.ds) {
    const ng = docNguoi(n);
    if (ng && !thay.has(ng.id) && ds.length < TOI_DA_NGUOI) {
      thay.add(ng.id);
      ds.push(ng);
    }
  }
  const thu: Record<string, boolean[]> = {};
  if (laDoiTuong(tho.thu)) {
    for (const [k, v] of Object.entries(tho.thu)) if (thay.has(k) && Array.isArray(v) && v.length === 3) thu[k] = v.map((b) => b === true);
  }
  return { v: 1, ds, thu };
}

export function ghiSoLuu(ds: readonly Nguoi[], thu: Record<string, boolean[]>): string {
  const goc: SoLuu = { v: 1, ds: [...ds], thu };
  return JSON.stringify(goc);
}

/** Bản sao lưu để người dùng tải về: bỏ người «ví dụ». */
export function banSaoLuu(ds: readonly Nguoi[], thu: Record<string, boolean[]>): string {
  const that = ds.filter((n) => !n.viDu);
  const thuThat: Record<string, boolean[]> = {};
  for (const n of that) if (thu[n.id]) thuThat[n.id] = thu[n.id]!;
  return JSON.stringify({ v: 1, ds: that, thu: thuThat }, null, 2);
}
