/**
 * P8/QtKhungCham — LOGIC THUẦN của trình dựng khung chấm kiểu "ô nhập mở sẵn" (thiết kế 20/11).
 *
 * Không đổi nghiệp vụ: nguồn kiểm DUY NHẤT vẫn là `dsMucSchema` (`rubric-shape.ts`) — màn chỉ báo trước điều máy chủ sẽ từ chối,
 * để người soạn thấy lỗi ngay ở ô, không phải bấm Lưu rồi mới biết. Máy chủ vẫn kiểm lại (`rubric-authoring.ts`).
 *
 * Giá trị ô nhập là CHUỖI (người dùng đang gõ); chỉ đổi sang số khi gửi.
 */
import { dsMucSchema, type Muc } from "./rubric-shape";

export type MucNhap = { label: string; points: string; desc?: string | null };

export type TieuChiNhap = {
  /** Rỗng = tiêu chí MỚI chưa lưu. */
  criterionId: string;
  label: string;
  description: string;
  levels: MucNhap[];
};

export function nhapTuTieuChi(t: { criterionId: string; label: string; description: string | null; levels: Muc[] }): TieuChiNhap {
  return {
    criterionId: t.criterionId,
    label: t.label,
    description: t.description ?? "",
    levels: t.levels.map((m) => ({ label: m.label, points: String(m.points), desc: m.desc ?? null })),
  };
}

export const tieuChiMoi = (): TieuChiNhap => ({
  criterionId: "",
  label: "",
  description: "",
  levels: [
    { label: "Chưa đạt", points: "0" },
    { label: "Đạt", points: "10" },
  ],
});

/** Điểm là SỐ NGUYÊN KHÔNG ÂM (mọi cột đích là `Int` — xem `mucSchema`). Chuỗi rỗng / thập phân / chữ ⇒ null. */
export function diemTuChuoi(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/** Đổi các mức đang nhập sang dạng gửi lên máy chủ; null khi còn ô điểm không phải số nguyên. */
export function mucTuNhap(levels: readonly MucNhap[]): Muc[] | null {
  const ra: Muc[] = [];
  for (const m of levels) {
    const p = diemTuChuoi(m.points);
    if (p === null) return null;
    ra.push({ label: m.label.trim(), points: p, desc: m.desc?.trim() || null });
  }
  return ra;
}

/** Lỗi của MỘT tiêu chí đang nhập (câu để hiện cạnh ô), hoặc null nếu hợp lệ. Cùng luật với máy chủ. */
export function loiTieuChiNhap(t: TieuChiNhap): string | null {
  if (t.label.trim().length < 2) return "Tên tiêu chí cần ít nhất 2 ký tự";
  if (t.levels.length < 2) return "Tiêu chí phải có ít nhất hai mức";
  if (t.levels.some((m) => diemTuChuoi(m.points) === null)) return "Điểm mỗi mức phải là số nguyên không âm";
  const muc = mucTuNhap(t.levels);
  if (!muc) return "Điểm mỗi mức phải là số nguyên không âm";
  const r = dsMucSchema.safeParse(muc);
  return r.success ? null : (r.error.issues[0]?.message ?? "Các mức chưa hợp lệ");
}

/** Điểm tối đa = mức CAO NHẤT (không phải mức cuối mảng); null khi chưa đọc được điểm. */
export function diemToiDaNhap(levels: readonly MucNhap[]): number | null {
  const muc = mucTuNhap(levels);
  if (!muc || muc.length === 0) return null;
  return Math.max(...muc.map((m) => m.points));
}

export type TongDiem = { tong: number; hopLe: boolean };

/** Tổng điểm các tiêu chí; `hopLe=false` khi có tiêu chí chưa tính được (khi đó `tong` là phần đã tính được, KHÔNG phải tổng thật). */
export function tongDiemNhap(ds: readonly TieuChiNhap[]): TongDiem {
  let tong = 0;
  let hopLe = true;
  for (const t of ds) {
    const d = diemToiDaNhap(t.levels);
    if (d === null) hopLe = false;
    else tong += d;
  }
  return { tong, hopLe };
}

export function daDoiTieuChi(goc: TieuChiNhap, nhap: TieuChiNhap): boolean {
  if (goc.label !== nhap.label || goc.description !== nhap.description || goc.levels.length !== nhap.levels.length) return true;
  return goc.levels.some((m, i) => m.label !== nhap.levels[i]!.label || m.points !== nhap.levels[i]!.points);
}

export type TrangThaiTong = { sac: "success" | "warning" | "danger"; cau: string };

/** Dòng tổng điểm dưới danh sách tiêu chí (thiết kế: "Tổng điểm các tiêu chí 12/12 — khớp thang điểm"). */
export function trangThaiTongDiem(o: { tong: number; thang: number; soTieuChi: number; hopLe: boolean }): TrangThaiTong {
  if (o.soTieuChi === 0) return { sac: "warning", cau: `Chưa có tiêu chí nào — thang điểm ${o.thang}` };
  if (!o.hopLe) return { sac: "danger", cau: "Còn tiêu chí chưa hợp lệ — chưa cộng được tổng điểm" };
  if (o.tong === o.thang) return { sac: "success", cau: `Tổng điểm các tiêu chí ${o.tong}/${o.thang} — khớp thang điểm` };
  const lech = Math.abs(o.tong - o.thang);
  return { sac: "warning", cau: `Tổng điểm các tiêu chí ${o.tong}/${o.thang} — ${o.tong > o.thang ? "thừa" : "thiếu"} ${lech} so với thang` };
}

/** Nút "Kích hoạt khung" chỉ sáng khi mọi thứ ĐÃ LƯU và khớp; trả LÝ DO khoá (hiện cạnh nút) thay vì khoá câm. */
export function lyDoChuaKichHoat(o: {
  soTieuChi: number;
  lechThang: boolean;
  coTieuChiHong: boolean;
  conChuaLuu: boolean;
}): string | null {
  if (o.conChuaLuu) return "Còn thay đổi chưa lưu — lưu xong mới kích hoạt được.";
  if (o.soTieuChi === 0) return "Khung chưa có tiêu chí nào.";
  if (o.coTieuChiHong) return "Có tiêu chí hệ thống không đọc được các mức — nhập lại mức rồi lưu.";
  if (o.lechThang) return "Tổng điểm các tiêu chí chưa khớp thang điểm.";
  return null;
}
