// "Tìm kiếm" của người học — phần THUẦN: lọc, đếm theo tab, tô đậm từ khớp. Không import React/DB.
//
// ⚠️ CHỈ tìm TIÊU ĐỀ (khoá, bài, tên khoá của chứng nhận) của thứ NGƯỜI NÀY được thấy. KHÔNG tìm nội dung câu hỏi hay nội dung
// bài: nội dung đề thi chưa mở đi qua chuỗi 4 điều kiện ở server (luật cứng #7 của Nền Hệ thống) — chỉ mục tìm kiếm là đường vòng.

import { chuanHoaTim } from "./dashboard-pure";

export type LoaiKetQua = "khoa" | "bai" | "chung-nhan";

export type KetQuaTim = {
  loai: LoaiKetQua;
  /** Khoá React ổn định. */
  id: string;
  tieuDe: string;
  /** Dòng ngữ cảnh: "An toàn điện · video 7 phút · đã xem 80%". */
  nguCanh: string;
  href: string;
};

export const TAB_TIM_KIEM = [
  { id: "tat-ca", nhan: "Tất cả" },
  { id: "khoa", nhan: "Khoá" },
  { id: "bai", nhan: "Bài học" },
  { id: "chung-nhan", nhan: "Chứng nhận" },
] as const;
export type TabTim = (typeof TAB_TIM_KIEM)[number]["id"];
export const MA_TAB_TIM: readonly TabTim[] = TAB_TIM_KIEM.map((t) => t.id);

/** Độ dài tối thiểu của từ khoá. Dưới ngưỡng ⇒ không tìm (một chữ cái khớp gần hết mọi tiêu đề, không có nghĩa). */
export const TOI_THIEU_TU_KHOA = 2;
export const TOI_DA_TU_KHOA = 100;

export function lamSachTuKhoa(v: string | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim().slice(0, TOI_DA_TU_KHOA);
}

export function coTheTim(q: string): boolean {
  return chuanHoaTim(q).length >= TOI_THIEU_TU_KHOA;
}

export function locKetQua(nguon: readonly KetQuaTim[], q: string): KetQuaTim[] {
  const tim = chuanHoaTim(q);
  if (tim.length < TOI_THIEU_TU_KHOA) return [];
  return nguon.filter((k) => chuanHoaTim(k.tieuDe).includes(tim));
}

export function demTheoTab(ds: readonly KetQuaTim[]): Record<TabTim, number> {
  const dem: Record<TabTim, number> = { "tat-ca": ds.length, khoa: 0, bai: 0, "chung-nhan": 0 };
  for (const k of ds) dem[k.loai] += 1;
  return dem;
}

export function theoTab(ds: readonly KetQuaTim[], tab: TabTim): KetQuaTim[] {
  return tab === "tat-ca" ? [...ds] : ds.filter((k) => k.loai === tab);
}

export type Doan = { chu: string; khop: boolean };

/** Bỏ dấu + thường hoá MỘT ký tự, KHÔNG trim (giữ khoảng trắng để ánh xạ vị trí đúng). */
function boDauKy(c: string): string {
  return c
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

/**
 * Chia `text` thành các đoạn, đoạn khớp `q` (BỎ DẤU, không phân biệt hoa thường) đánh `khop: true` — để tô đậm đúng chữ gốc
 * có dấu. Chuẩn hoá từng KÝ TỰ một và giữ bảng ánh xạ chỉ số: chuẩn hoá cả chuỗi làm lệch vị trí (NFD tách dấu thành ký tự riêng).
 */
export function danhDauKhop(text: string, q: string): Doan[] {
  const tim = chuanHoaTim(q);
  if (tim.length < TOI_THIEU_TU_KHOA || text === "") return [{ chu: text, khop: false }];

  let chuan = "";
  const vi: number[] = []; // vi[i] = chỉ số ký tự GỐC sinh ra ký tự chuẩn hoá thứ i
  const ky = Array.from(text);
  const batDau: number[] = []; // batDau[j] = vị trí (theo code unit) của ký tự gốc thứ j
  let pos = 0;
  ky.forEach((c, j) => {
    batDau.push(pos);
    pos += c.length;
    // KHÔNG dùng `chuanHoaTim` cho từng ký tự: nó `trim()` nên khoảng trắng biến mất và vị trí lệch.
    const n = boDauKy(c);
    for (let m = 0; m < n.length; m++) vi.push(j);
    chuan += n;
  });
  batDau.push(pos);

  const doan: Doan[] = [];
  let con = 0; // vị trí gốc đã xử lý
  let i = 0;
  while (i <= chuan.length - tim.length) {
    const j = chuan.indexOf(tim, i);
    if (j < 0) break;
    const dau = vi[j]!;
    const cuoi = vi[j + tim.length - 1]! + 1; // ký tự gốc CUỐI được phủ, tính cả dấu
    const a = batDau[dau]!;
    const b = batDau[cuoi]!;
    if (a > con) doan.push({ chu: text.slice(con, a), khop: false });
    doan.push({ chu: text.slice(a, b), khop: true });
    con = b;
    i = j + tim.length;
  }
  if (con < text.length) doan.push({ chu: text.slice(con), khop: false });
  return doan.length > 0 ? doan : [{ chu: text, khop: false }];
}
