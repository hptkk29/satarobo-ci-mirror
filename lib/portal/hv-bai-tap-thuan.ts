// lib/portal/hv-bai-tap-thuan.ts — Cổng học sinh, màn "Bài tập & bài thi" (artifact HV-Bai-tap): phần THUẦN. Không DB.
import { nhanHanBai } from "@/lib/portal/hv-hom-nay-thuan";
import { vnParts } from "@/lib/time/vn";

const hai = (n: number) => String(n).padStart(2, "0");

export type BaiTapTho = {
  id: string;
  title: string;
  /** Hạn THẬT (đã lọc sentinel 1970) hoặc null. */
  dueAt: string | null;
  done: boolean;
  /** Hết đường nộp (đóng / quá hạn mà GV không mở nộp bù) — bấm vào cũng bị chặn. */
  closed: boolean;
  overdue: boolean;
};

export type BaiCanLam = {
  id: string;
  /** Số buổi trong lộ trình; null với bài giáo viên giao mà không gắn buổi. */
  buoi: number | null;
  ten: string;
  dueAt: string | null;
  han: { nhan: string; gap: boolean };
};

/**
 * Bài "Cần làm" = chưa nộp VÀ còn nộp được. Bài đã hết đường nộp (đóng/quá hạn) KHÔNG nằm ở đây — hiện nút "Làm bài" cho thứ mà
 * cổng nộp sẽ từ chối là lời hứa suông. Sắp theo hạn gần nhất lên đầu, bài không đặt hạn xuống cuối.
 */
export function chonBaiCanLam(
  items: { order: number; assignment: BaiTapTho | null }[],
  ngoaiLoTrinh: BaiTapTho[],
  now: Date,
): BaiCanLam[] {
  const ra: BaiCanLam[] = [];
  const thay = new Set<string>();
  const them = (a: BaiTapTho, buoi: number | null) => {
    if (a.done || a.closed || thay.has(a.id)) return;
    thay.add(a.id);
    ra.push({ id: a.id, buoi, ten: a.title, dueAt: a.dueAt, han: nhanHanBai(a.dueAt, now) });
  };
  for (const it of items) if (it.assignment) them(it.assignment, it.order);
  for (const a of ngoaiLoTrinh) them(a, null);
  return ra.sort((x, y) => {
    if (x.dueAt === null && y.dueAt === null) return 0;
    if (x.dueAt === null) return 1;
    if (y.dueAt === null) return -1;
    return Date.parse(x.dueAt) - Date.parse(y.dueAt);
  });
}

/** `9` · `8,5` (dấu phẩy kiểu VN). Thang điểm khác 10 thì kèm mẫu số: `45/50`. */
export function diemHienThi(score: number, tong: number): { chu: string; thang10: boolean } {
  const f = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
  if (tong === 10) return { chu: f(score), thang10: true };
  return { chu: `${f(score)}/${f(tong)}`, thang10: false };
}

export type BaiNopTho = {
  id: string;
  title: string;
  status: "SUBMITTED" | "LATE" | "GRADED";
  score: number | null;
  tong: number;
  feedback: string | null;
  submittedAt: string | null;
};

export type BaiDaNop = {
  id: string;
  buoi: number | null;
  ten: string;
  /** `23/10` theo lịch VN. */
  ngayNop: string;
  choCham: boolean;
  diem: { chu: string; thang10: boolean } | null;
  loi: string | null;
  tre: boolean;
};

function ngayNgan(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const p = vnParts(new Date(t));
  return `${hai(p.day)}/${hai(p.month + 1)}`;
}

/** Bài đã nộp, mới nhất trước. Chưa chấm (hoặc điểm null) ⇒ `choCham`. */
export function dungBaiDaNop(rows: BaiNopTho[], buoiCua: ReadonlyMap<string, number>): BaiDaNop[] {
  return [...rows]
    .sort((a, b) => (Date.parse(b.submittedAt ?? "") || 0) - (Date.parse(a.submittedAt ?? "") || 0))
    .map((r) => {
      const daCham = r.status === "GRADED" && r.score !== null;
      return {
        id: r.id,
        buoi: buoiCua.get(r.id) ?? null,
        ten: r.title,
        ngayNop: ngayNgan(r.submittedAt),
        choCham: !daCham,
        diem: daCham ? diemHienThi(r.score as number, r.tong) : null,
        loi: r.feedback && r.feedback.trim() ? r.feedback.trim() : null,
        tre: r.status === "LATE",
      };
    });
}

// ── Bài thi ───────────────────────────────────────────────────────────────────────────

export type ThiTho = {
  id: string;
  title: string;
  durationMinutes: number;
  isOpen: boolean;
  closeAt: string | null;
  maxAttempts: number;
  attemptsUsed: number;
  attemptStatus: string | null;
  totalScore: number | null;
};

export type KieuThi = "lam-duoc" | "dang-lam" | "het-luot" | "chua-mo" | "da-dong";

const DA_NOP = new Set(["SUBMITTED", "GRADED", "REVIEWED"]);

/** Một bài thi ở trạng thái nào đối với em: còn làm được / đang làm dở / hết lượt / chưa mở / đã đóng. */
export function kieuBaiThi(t: ThiTho, now: Date): KieuThi {
  if (t.attemptStatus === "IN_PROGRESS") return "dang-lam";
  if (!t.isOpen) {
    const dong = t.closeAt !== null && Date.parse(t.closeAt) < now.getTime();
    return dong ? "da-dong" : "chua-mo";
  }
  const daNop = t.attemptStatus !== null && DA_NOP.has(t.attemptStatus);
  if (daNop && t.attemptsUsed >= Math.max(1, t.maxAttempts)) return "het-luot";
  return "lam-duoc";
}

export function moTaLuot(t: ThiTho): string {
  const toiDa = Math.max(1, t.maxAttempts);
  const phut = `${t.durationMinutes} phút`;
  return toiDa > 1 ? `${phut} · làm được ${toiDa} lần (đã dùng ${t.attemptsUsed})` : `${phut} · làm 1 lần`;
}
