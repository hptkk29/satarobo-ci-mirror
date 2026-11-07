// Cổng phụ huynh — màn "Tổng quan" (artifact Main.dc.html). TOÀN BỘ phần THUẦN: nhãn ngày,
// gom học phần, tóm tắt đi học / học phí, so năng lực theo tháng. Không DB, không `server-only`
// ⇒ test được không cần Postgres. Phần chạm DB nằm ở `tong-quan.ts`.
//
// Vì sao tách: bốn con số trên màn này (đi học, đã học, học phí, buổi tiếp theo) trước đây
// mỗi màn tự đếm một kiểu — bản ánh xạ dữ liệu ghi 8 lỗi. Mọi phép ở đây đọc CÙNG nguồn
// với `getStudentSessionsView` / `getStudentBilling` rồi chỉ diễn đạt lại, KHÔNG đếm lại.
import { EVAL_CRITERIA_BY_ID } from "@/lib/lms/session-eval-rubric";
import { vnParts, vnStartOfDay } from "@/lib/time/vn";

const hai = (n: number) => String(n).padStart(2, "0");

const THU_DAI = [
  "CHỦ NHẬT",
  "THỨ HAI",
  "THỨ BA",
  "THỨ TƯ",
  "THỨ NĂM",
  "THỨ SÁU",
  "THỨ BẢY",
] as const;

/** `CHỦ NHẬT, 01/11/2026` — theo LỊCH VN (Vercel/VPS chạy UTC nên không dùng `getDay()`). */
export function nhanHomNay(now: Date): string {
  const p = vnParts(now);
  return `${THU_DAI[p.weekday]}, ${hai(p.day)}/${hai(p.month + 1)}/${p.year}`;
}

/** Số ngày LỊCH từ `now` tới `ngayISO` (cùng ngày = 0, mai = 1). */
export function demNgayLich(ngayISO: string, now: Date): number {
  const t = Date.parse(ngayISO);
  if (Number.isNaN(t)) return 0;
  const ms = vnStartOfDay(new Date(t)).getTime() - vnStartOfDay(now).getTime();
  return Math.round(ms / 86_400_000);
}

/** `HÔM NAY` · `NGÀY MAI` · `CÒN 6 NGÀY`. Buổi đã qua giờ (n < 0) không bao giờ vào đây. */
export function nhanConNgay(n: number): string {
  if (n <= 0) return "HÔM NAY";
  if (n === 1) return "NGÀY MAI";
  return `CÒN ${n} NGÀY`;
}

/** `HP2` → `Học phần 2`; mã lạ giữ nguyên để không bịa. */
export function nhanHocPhan(ma: string | null | undefined): string | null {
  const m = (ma ?? "").trim();
  if (!m) return null;
  const so = /^HP\s*(\d+)$/i.exec(m);
  return so ? `Học phần ${Number(so[1])}` : m;
}

/** Tên riêng để chào: cả họ tên — KHÔNG cắt (lỗi 5 của bản ánh xạ: tên con bị cắt). */
export function tenDayDu(ten: string | null | undefined): string {
  return (ten ?? "").trim().replace(/\s+/g, " ");
}

// ── Gom học phần ───────────────────────────────────────────────────────────────

export type BuoiChoHanhTrinh = {
  id: string;
  /** Buổi thứ mấy của lớp. */
  order: number;
  title: string;
  dateISO: string;
  past: boolean;
  cancelled: boolean;
  /** `Lesson.moduleCode` ("HP1") — null khi khoá không chia học phần. */
  hocPhan: string | null;
};

export type OngHocPhan = "xong" | "tiep" | "chua";

export type HocPhanTomTat = {
  ma: string;
  ten: string;
  tong: number;
  daHoc: number;
  /** `dd/MM` của buổi đầu học phần — hiện khi chưa học buổi nào. */
  batDau: string | null;
  ong: OngHocPhan[];
};

function dm(iso: string): string {
  const p = vnParts(new Date(iso));
  return `${hai(p.day)}/${hai(p.month + 1)}`;
}

/**
 * Gom buổi theo học phần. Buổi HUỶ không tính (không phải buổi học có thật). Khoá không chia
 * học phần (mọi `hocPhan` null) ⇒ `[]` — màn hình bỏ khối thanh thay vì bịa "Học phần 1".
 */
export function gomHocPhan(buoi: BuoiChoHanhTrinh[], tiepTheoId: string | null): HocPhanTomTat[] {
  const song = buoi
    .filter((b) => !b.cancelled)
    .sort((a, b) => Date.parse(a.dateISO) - Date.parse(b.dateISO));
  const nhom = new Map<string, BuoiChoHanhTrinh[]>();
  for (const b of song) {
    if (!b.hocPhan) continue;
    const ds = nhom.get(b.hocPhan) ?? [];
    ds.push(b);
    nhom.set(b.hocPhan, ds);
  }
  return [...nhom.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "vi", { numeric: true }))
    .map(([ma, ds]) => ({
      ma,
      ten: nhanHocPhan(ma) ?? ma,
      tong: ds.length,
      daHoc: ds.filter((b) => b.past).length,
      batDau: ds[0] ? dm(ds[0].dateISO) : null,
      ong: ds.map((b): OngHocPhan => (b.past ? "xong" : b.id === tiepTheoId ? "tiep" : "chua")),
    }));
}

// ── Đi học ─────────────────────────────────────────────────────────────────────

export type DiHocTomTat = {
  /** `Có mặt 6/7 buổi` */
  tieuDe: string;
  /** Một dòng phụ, không bao giờ rỗng. */
  phu: string;
  /** Mẫu số = buổi đã diễn ra TRỪ buổi chưa chấm (lỗi 2: chưa chấm không phải vắng). */
  mauSo: number;
};

export function tomTatDiHoc(i: {
  daHoc: number;
  coMat: number;
  vang: number;
  chuaCham: number;
  canBu: number;
}): DiHocTomTat {
  const mauSo = Math.max(i.daHoc - i.chuaCham, i.coMat, 0);
  if (mauSo === 0) {
    // Có buổi đã diễn ra nhưng chưa buổi nào được chấm ⇒ KHÔNG phải "chưa có buổi" (và càng
    // không phải 0%): nói thẳng là giáo viên chưa chấm.
    if (i.daHoc > 0) {
      return {
        tieuDe: "Chưa chấm điểm danh",
        phu: `${i.daHoc} buổi đã học, giáo viên chưa chấm`,
        mauSo,
      };
    }
    return { tieuDe: "Chưa có buổi nào", phu: "Chuyên cần sẽ hiện sau buổi học đầu tiên", mauSo };
  }
  let phu: string;
  if (i.canBu > 0) phu = `Vắng ${i.canBu} buổi — chờ chọn giờ bù`;
  else if (i.vang > 0) phu = `Vắng ${i.vang} buổi`;
  else phu = "Chưa vắng buổi nào";
  if (i.chuaCham > 0) phu += ` · ${i.chuaCham} buổi chưa chấm`;
  return { tieuDe: `Có mặt ${i.coMat}/${mauSo} buổi`, phu, mauSo };
}

// ── Học phí — chỉ HAI trạng thái hiển thị: «Đã nộp» / «Chưa nộp» ─────────────────
//
// Chủ dự án chốt 03/11/2026: "trạng thái chỉ cần hiển thị ĐÃ NỘP hay CHƯA thôi". Mọi chip/nhãn trạng thái
// học phí của cổng phụ huynh (Tổng quan lẫn trang Học phí) đọc từ đây — «Đã đóng một phần», «Quá hạn»,
// «Tạm hoãn thu», «Chờ báo giá», «Chờ kế toán xác nhận» KHÔNG còn là nhãn trạng thái. Thông tin bắt buộc
// phải nói (còn bao nhiêu, hạn, đang bảo lưu, chưa chốt giá) đi ở dòng phụ `phu`, không phải chip.
//
// `CHUA_CO` (con chưa có khoản học phí nào) KHÔNG phải trạng thái nộp — không có gì để nộp — nên không vẽ chip.
//
// Lỗi 1 của bản ánh xạ vẫn được giữ: giá chưa chốt KHÔNG bao giờ là «Đã nộp» (chưa có gì để gọi là đã nộp đủ).

export type HocPhiTrangThai = "CHUA_CO" | "CHUA_NOP" | "DA_NOP";

export const NHAN_DA_NOP = "Đã nộp";
export const NHAN_CHUA_NOP = "Chưa nộp";

export type HocPhiTomTat = {
  trangThai: HocPhiTrangThai;
  /** Chỉ có thể là «Đã nộp» · «Chưa nộp» · (khi chưa có khoản nào) «Chưa có khoản học phí». */
  tieuDe: string;
  phu: string;
};

export const vnd = (n: number): string => `${Math.round(n).toLocaleString("vi-VN")}đ`;

export function tomTatHocPhi(b: {
  rows: { chuaChotGia: boolean }[];
  outstanding: number;
  nextDueDate: string | null;
  tamHoanThu: { denNgay: string | null } | null;
  /** Số đã đóng (đã xác nhận) — để dòng phụ nói số đã đóng khi mới đóng một phần. */
  paid?: number;
}): HocPhiTomTat {
  if (b.rows.length === 0) {
    return { trangThai: "CHUA_CO", tieuDe: "Chưa có khoản học phí", phu: "Trung tâm sẽ báo khi có" };
  }
  // Bảo lưu KHÔNG đổi trạng thái nộp (còn nợ vẫn là «Chưa nộp», hết nợ vẫn là «Đã nộp») — chỉ thêm một đoạn ở dòng phụ.
  const baoLuu = b.tamHoanThu
    ? b.tamHoanThu.denNgay
      ? `Tạm hoãn thu do bảo lưu đến ${ngayDmy(b.tamHoanThu.denNgay)}`
      : "Tạm hoãn thu do bảo lưu"
    : null;
  const tatCaChuaGia = b.rows.every((r) => r.chuaChotGia);
  if (tatCaChuaGia) {
    return {
      trangThai: "CHUA_NOP",
      tieuDe: NHAN_CHUA_NOP,
      phu: ["Trung tâm chưa chốt học phí cho con", baoLuu].filter(Boolean).join(" · "),
    };
  }
  if (b.outstanding > 0) {
    const dao = [`Còn ${vnd(b.outstanding)}`];
    if (baoLuu) dao.push(baoLuu);
    else if (b.nextDueDate) dao.push(`Hạn gần nhất ${ngayDmy(b.nextDueDate)}`);
    if ((b.paid ?? 0) > 0) dao.push(`Đã đóng ${vnd(b.paid ?? 0)}`);
    return { trangThai: "CHUA_NOP", tieuDe: NHAN_CHUA_NOP, phu: dao.join(" · ") };
  }
  const coKhoanChuaGia = b.rows.some((r) => r.chuaChotGia);
  return {
    trangThai: "DA_NOP",
    tieuDe: NHAN_DA_NOP,
    phu: coKhoanChuaGia ? "Còn khoản chờ báo giá" : (baoLuu ?? "Không còn khoản nào chờ đóng"),
  };
}

/** Trạng thái MỘT khoản (một ghi danh) — cùng hai nhãn. Giá chưa chốt hoặc còn nợ ⇒ «Chưa nộp». */
export function trangThaiKhoanHocPhi(r: { chuaChotGia: boolean; outstanding: number }): {
  nhan: typeof NHAN_DA_NOP | typeof NHAN_CHUA_NOP;
  /** Dòng phụ: số còn nợ / chưa chốt giá — null khi đã nộp. */
  phu: string | null;
} {
  if (r.chuaChotGia) return { nhan: NHAN_CHUA_NOP, phu: "Chưa chốt học phí" };
  if (r.outstanding > 0) return { nhan: NHAN_CHUA_NOP, phu: `Còn ${vnd(r.outstanding)}` };
  return { nhan: NHAN_DA_NOP, phu: null };
}

export function ngayDmy(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const p = vnParts(new Date(t));
  return `${hai(p.day)}/${hai(p.month + 1)}/${p.year}`;
}

// ── Năng lực theo tháng ────────────────────────────────────────────────────────

export type NangLucBac = 1 | 2 | 3;
export type XuHuong = "tang" | "giu" | "giam";

export type NangLucDong = {
  nhom: string;
  /** Bậc tháng gần nhất (3 = tích cực). */
  bac: NangLucBac;
  nhanBac: string;
  /** null khi tháng trước chưa có dữ liệu cho nhóm này. */
  xuHuong: XuHuong | null;
  bacTruoc: NangLucBac | null;
};

export type NangLucTomTat = {
  thang: number;
  thangTruoc: number;
  soNhanXet: number;
  dong: NangLucDong[];
};

/**
 * Rubric đi từ 1 (tốt nhất) tới 5 (cần cố gắng) — NGƯỢC chiều với "điểm". Ba bậc cho màn
 * hình là cách DIỄN ĐẠT lại trung bình của nhóm tiêu chí, không phải một thang chấm mới.
 */
export function bacTuTrungBinh(tb: number): NangLucBac {
  if (tb <= 1.75) return 3;
  if (tb <= 2.75) return 2;
  return 1;
}

const NHAN_BAC: Record<NangLucBac, string> = { 1: "Khá", 2: "Tốt", 3: "Tích cực" };

function trungBinhNhom(
  nhanXet: { rubric: Record<string, number> }[],
): Map<string, number> {
  const tong = new Map<string, { s: number; n: number }>();
  for (const nx of nhanXet) {
    for (const [id, v] of Object.entries(nx.rubric)) {
      const nhom = EVAL_CRITERIA_BY_ID[id]?.group;
      if (!nhom || !(v >= 1 && v <= 5)) continue;
      const cur = tong.get(nhom) ?? { s: 0, n: 0 };
      cur.s += v;
      cur.n += 1;
      tong.set(nhom, cur);
    }
  }
  return new Map([...tong].map(([k, { s, n }]) => [k, s / n]));
}

/**
 * So tháng GẦN NHẤT CÓ rubric với tháng liền trước. Không có rubric nào ⇒ `null` (màn hình
 * nói "chưa đủ nhận xét", không vẽ thanh bịa).
 */
export function soSanhNangLuc(
  nhanXet: { dateISO: string; rubric: Record<string, number> | null }[],
): NangLucTomTat | null {
  const co = nhanXet
    .filter((n): n is { dateISO: string; rubric: Record<string, number> } => !!n.rubric && !!n.dateISO)
    .map((n) => {
      const p = vnParts(new Date(n.dateISO));
      return { ...n, khoa: p.year * 12 + p.month };
    });
  if (co.length === 0) return null;
  const moi = Math.max(...co.map((n) => n.khoa));
  const thangNay = co.filter((n) => n.khoa === moi);
  const thangTruoc = co.filter((n) => n.khoa === moi - 1);
  const tbNay = trungBinhNhom(thangNay);
  const tbTruoc = trungBinhNhom(thangTruoc);
  const dong: NangLucDong[] = [...tbNay].map(([nhom, tb]) => {
    const bac = bacTuTrungBinh(tb);
    const truoc = tbTruoc.get(nhom);
    let xuHuong: XuHuong | null = null;
    if (truoc !== undefined) {
      const d = truoc - tb; // thấp hơn = tốt hơn
      xuHuong = d >= 0.3 ? "tang" : d <= -0.3 ? "giam" : "giu";
    }
    return {
      nhom,
      bac,
      nhanBac: NHAN_BAC[bac],
      xuHuong,
      bacTruoc: truoc !== undefined ? bacTuTrungBinh(truoc) : null,
    };
  });
  return {
    thang: (moi % 12) + 1,
    thangTruoc: ((moi - 1) % 12 + 12) % 12 + 1,
    soNhanXet: thangNay.length,
    dong,
  };
}

export const NHAN_XU_HUONG: Record<XuHuong, string> = { tang: "tăng", giu: "giữ", giam: "giảm" };
