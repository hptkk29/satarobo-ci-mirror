// "Khoá của tôi" chia thành BA tab theo URL (`?tab=`): Cần làm · Quá hạn · Đã xong — hàm THUẦN, không import React/DB.
//
// ⚠️ Tab suy từ `nhomHan` (cùng nguồn với KPI ở Tổng quan): "quá hạn" ở Tổng quan và ở tab này KHÔNG THỂ lệch nhau.
// Ba tab CHIA ĐÔI TẬP KHOÁ (mỗi khoá đúng một tab) — lưới `khoa-cua-toi-tab.test.ts` ghim điều đó.
//
// ⚠️ Hành vi quá hạn KHÔNG đổi ở đây (Q6/B-02): tab chỉ PHÂN LOẠI để hiển thị; việc khoá ghi tiến độ là `due-lock.ts`.

import { chuanHoaTim, nhomHan, type KhoaRut } from "./dashboard-pure";

export const TAB_KHOA = [
  { id: "can-lam", nhan: "Cần làm" },
  { id: "qua-han", nhan: "Quá hạn" },
  { id: "da-xong", nhan: "Đã xong" },
] as const;
export type TabKhoa = (typeof TAB_KHOA)[number]["id"];
export const MA_TAB_KHOA: readonly TabKhoa[] = TAB_KHOA.map((t) => t.id);
export const TAB_MAC_DINH: TabKhoa = "can-lam";

/**
 * Liên kết CŨ `?tt=` (từ Tổng quan, thông báo, chuông) → tab mới. `sap-han`/`dang-hoc`/`chua-bat-dau` đều là việc CẦN LÀM;
 * `tat-ca` không còn tương ứng (không có tab "tất cả") nên rơi về tab mặc định.
 */
export const BIET_DANH_TT: Readonly<Record<string, TabKhoa>> = {
  "tat-ca": "can-lam",
  "dang-hoc": "can-lam",
  "chua-bat-dau": "can-lam",
  "sap-han": "can-lam",
  "qua-han": "qua-han",
  "hoan-thanh": "da-xong",
};

/** Một khoá thuộc đúng MỘT tab. */
export function tabCuaKhoa(k: Pick<KhoaRut, "status" | "dueAt">, now: Date): TabKhoa {
  const n = nhomHan(k, now);
  if (n === "XONG") return "da-xong";
  if (n === "QUA_HAN") return "qua-han";
  return "can-lam";
}

export type KhoaDong = KhoaRut & {
  /** Ngày được giao (`TrnEnrollment.createdAt`). */
  createdAt: Date | null;
  completedAt: Date | null;
  /** Số bài (chưa xoá) của khoá; `null` = chưa đếm được. */
  soBai: number | null;
  /** Khoá có bài kiểm tra (`QUIZ`). */
  coKiemTra: boolean;
  /** n/m bài BẮT BUỘC (cùng định nghĩa với Tổng quan và đề cương). `tong = 0` ⇒ chưa có bài bắt buộc: KHÔNG vẽ chuỗi chấm. */
  tienDoBai: { xong: number; tong: number };
};

export const SAP_XEP_TAB = [
  { ma: "han", nhan: "Hạn gần nhất trước" },
  { ma: "moi-giao", nhan: "Mới giao nhất" },
  { ma: "tien-do", nhan: "Tiến độ cao nhất" },
  { ma: "ten", nhan: "Tên A→Z" },
] as const;
export type SapXepTab = (typeof SAP_XEP_TAB)[number]["ma"];

export function docSapXepTab(v: string | undefined): SapXepTab {
  return SAP_XEP_TAB.find((s) => s.ma === v)?.ma ?? "han";
}

export const SO_KHOA_MOI_TRANG_TAB = 12;

const MA_VO_CUC = Number.POSITIVE_INFINITY;
const thuTuHan = (a: KhoaDong, b: KhoaDong) => (a.dueAt?.getTime() ?? MA_VO_CUC) - (b.dueAt?.getTime() ?? MA_VO_CUC);
const moiGiao = (a: KhoaDong, b: KhoaDong) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);

export type KetQuaTab = {
  dong: KhoaDong[];
  tong: number;
  trang: number;
  tongTrang: number;
  /**
   * Số khoá KHỚP Ô TÌM ở từng tab (không có `q` thì là tổng của tab). Đếm theo ô tìm chứ không theo tab đang mở: tìm "an toàn"
   * mà khoá nằm ở "Đã xong" thì tab "Cần làm" trống — người dùng phải thấy "1" cạnh "Đã xong", không phải "không có".
   */
  dem: Record<TabKhoa, number>;
};

export function locSapXepTheoTab(
  khoa: readonly KhoaDong[],
  o: { tab: TabKhoa; q: string; sapXep: SapXepTab; trang: number; coTrang?: number },
  now: Date,
): KetQuaTab {
  const coTrang = o.coTrang ?? SO_KHOA_MOI_TRANG_TAB;
  const tim = chuanHoaTim(o.q);
  const khop = (k: KhoaDong) => tim === "" || chuanHoaTim(k.tenKhoa).includes(tim);

  const dem: Record<TabKhoa, number> = { "can-lam": 0, "qua-han": 0, "da-xong": 0 };
  const trongTab: KhoaDong[] = [];
  for (const k of khoa) {
    if (!khop(k)) continue;
    const t = tabCuaKhoa(k, now);
    dem[t] += 1;
    if (t === o.tab) trongTab.push(k);
  }

  const ds = [...trongTab];
  if (o.sapXep === "han") ds.sort(thuTuHan);
  else if (o.sapXep === "moi-giao") ds.sort(moiGiao);
  else if (o.sapXep === "tien-do") ds.sort((a, b) => b.progressPercent - a.progressPercent || a.tenKhoa.localeCompare(b.tenKhoa, "vi"));
  else ds.sort((a, b) => a.tenKhoa.localeCompare(b.tenKhoa, "vi"));

  const tongTrang = Math.max(1, Math.ceil(ds.length / coTrang));
  const trang = Math.min(Math.max(1, Math.floor(o.trang) || 1), tongTrang);
  return { dong: ds.slice((trang - 1) * coTrang, trang * coTrang), tong: ds.length, trang, tongTrang, dem };
}

/** Dòng phụ dưới tên khoá: "4 bài · có bài kiểm tra". `null` khi không có gì đáng nói (chưa đếm được bài). */
export function moTaPhuKhoa(k: Pick<KhoaDong, "soBai" | "coKiemTra">): string | null {
  const phan: string[] = [];
  if (k.soBai !== null && k.soBai > 0) phan.push(`${k.soBai} bài`);
  if (k.coKiemTra) phan.push("có bài kiểm tra");
  return phan.length > 0 ? phan.join(" · ") : null;
}

/** Nhóm màu của dòng khoá (chấm màu + chú thích). Suy từ cùng `nhomHan` — không phải bảng trạng thái thứ hai. */
export function nhomMauCuaKhoa(
  k: Pick<KhoaRut, "status" | "dueAt">,
  now: Date,
): "on" | "chu-y" | "tre-loi" | "chua-bat-dau" | "da-duyet" {
  const n = nhomHan(k, now);
  if (n === "XONG") return k.status === "COMPLETED_LATE" ? "chu-y" : "da-duyet";
  if (n === "QUA_HAN") return "tre-loi";
  if (n === "SAP_HAN") return "chu-y";
  return k.status === "IN_PROGRESS" ? "on" : "chua-bat-dau";
}
