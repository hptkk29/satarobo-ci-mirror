// lib/assignments/lam-bai.ts — HỌC VIÊN LÀM BÀI TẬP TỪNG CÂU: phần THUẦN (không DB, không zod).
//
// Vì sao có file này: bài tập giáo viên giao có thể có nhiều câu (trắc nghiệm, đúng/sai, điền khuyết, ghép cặp, sắp xếp, tự luận,
// nộp video…), nhưng cổng học viên từng chỉ có ô "văn bản + tệp" — 4 câu đầu không bao giờ tới được học viên, riêng câu video lọt
// qua vì đề của nó bị nối vào "Hướng dẫn". Ở đây có ba việc, cả ba phải đi cùng nhau:
//   1. `toCauHoiHocVien` — dựng bản câu hỏi AN TOÀN gửi cho học viên (KHÔNG mang đáp án đúng, ghép cặp/sắp xếp đã xáo).
//   2. `kiemDapAn`        — kiểm đáp án client gửi lên có khớp loại câu + trong giới hạn không (server coi input là thô).
//   3. `chamBai`          — chấm các câu chấm được tự động, ra điểm theo thang của bài.
//
// ⚠️ Luật rò đáp án: mọi thứ trong `CauHoiHocVien` đi thẳng vào payload RSC/client component. Thêm một trường vào đó là thêm một thứ
// học viên đọc được bằng DevTools — `lam-bai.test.ts` ([LB-01]) khẳng định không trường nào của đáp án đúng lọt ra.
import { countBlanks, type ContentQuestion } from "@/lib/assignments/question-content";

/* ------------------------------ Bản gửi học viên ------------------------------ */

type CauHocVienChung = { id: string; question: string; imageUrl: string | null };

export type CauHoiHocVien =
  | (CauHocVienChung & { type: "single" | "multiple"; options: string[] })
  | (CauHocVienChung & { type: "boolean" })
  | (CauHocVienChung & { type: "fill"; soCho: number })
  | (CauHocVienChung & { type: "short" | "essay" })
  | (CauHocVienChung & { type: "matching"; trai: string[]; phai: string[] })
  | (CauHocVienChung & { type: "ordering"; muc: string[] })
  | (CauHocVienChung & { type: "video" });

/** Xáo có hạt giống (cùng một câu ⇒ cùng một thứ tự mỗi lần tải trang), và KHÔNG bao giờ trả về đúng thứ tự gốc. */
export function xaoTheoHat<T>(ds: readonly T[], hat: string): T[] {
  const a = [...ds];
  if (a.length < 2) return a;
  let h = 2166136261;
  for (let i = 0; i < hat.length; i++) {
    h ^= hat.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  // Xáo ra đúng thứ tự gốc thì lộ luôn đáp án của câu sắp xếp ⇒ xoay một nấc.
  if (a.every((x, i) => x === ds[i])) a.push(a.shift() as T);
  return a;
}

/** Bản câu hỏi gửi học viên. `ContentQuestion` ở vào có đáp án; ở ra KHÔNG còn. */
export function toCauHoiHocVien(q: ContentQuestion, imageUrl: string | null): CauHoiHocVien {
  const chung = { id: q.id, question: q.question, imageUrl };
  switch (q.type) {
    case "single":
    case "multiple":
      return { ...chung, type: q.type, options: [...q.options] };
    case "boolean":
      return { ...chung, type: "boolean" };
    case "fill":
      return { ...chung, type: "fill", soCho: countBlanks(q.question) };
    case "short":
    case "essay":
      return { ...chung, type: q.type };
    case "matching":
      return {
        ...chung,
        type: "matching",
        trai: q.pairs.map((p) => p.left),
        phai: xaoTheoHat(
          q.pairs.map((p) => p.right),
          q.id,
        ),
      };
    case "ordering":
      return { ...chung, type: "ordering", muc: xaoTheoHat(q.items, q.id) };
    case "video":
      return { ...chung, type: "video" };
  }
}

/* ---------------------------------- Đáp án ---------------------------------- */

/** Đáp án học viên cho MỘT câu. Câu video không có đáp án ở đây — video đi theo tệp đính kèm của bài nộp. */
export type DapAn =
  | { k: "single"; i: number }
  | { k: "multiple"; i: number[] }
  | { k: "boolean"; v: boolean }
  | { k: "fill"; t: string[] }
  | { k: "text"; t: string }
  | { k: "matching"; r: string[] }
  | { k: "ordering"; o: string[] };

export const TRAN_DO_DAI_DAP_AN = 2000;

/** Loại đáp án mà một loại câu chấp nhận; null = câu không có đáp án gõ/chọn (video). */
export function loaiDapAnCua(type: ContentQuestion["type"]): DapAn["k"] | null {
  switch (type) {
    case "single":
      return "single";
    case "multiple":
      return "multiple";
    case "boolean":
      return "boolean";
    case "fill":
      return "fill";
    case "short":
    case "essay":
      return "text";
    case "matching":
      return "matching";
    case "ordering":
      return "ordering";
    case "video":
      return null;
  }
}

const dai = (s: string) => s.length <= TRAN_DO_DAI_DAP_AN;

/** Đáp án client gửi lên có hợp lệ với câu này không. Trả thông báo lỗi (tiếng Việt) hoặc null. */
export function kiemDapAn(q: ContentQuestion, a: DapAn): string | null {
  if (loaiDapAnCua(q.type) !== a.k) return "Đáp án không đúng loại câu hỏi";
  switch (a.k) {
    case "single": {
      const n = q.type === "single" ? q.options.length : 0;
      return Number.isInteger(a.i) && a.i >= 0 && a.i < n ? null : "Lựa chọn không hợp lệ";
    }
    case "multiple": {
      const n = q.type === "multiple" ? q.options.length : 0;
      const ok = a.i.length <= n && a.i.every((i) => Number.isInteger(i) && i >= 0 && i < n) && new Set(a.i).size === a.i.length;
      return ok ? null : "Lựa chọn không hợp lệ";
    }
    case "boolean":
      return null;
    case "fill": {
      const n = q.type === "fill" ? countBlanks(q.question) : 0;
      return a.t.length <= n && a.t.every(dai) ? null : "Đáp án điền khuyết không hợp lệ";
    }
    case "text":
      return dai(a.t) ? null : "Câu trả lời quá dài";
    case "matching": {
      const n = q.type === "matching" ? q.pairs.length : 0;
      return a.r.length <= n && a.r.every(dai) ? null : "Đáp án ghép cặp không hợp lệ";
    }
    case "ordering": {
      const n = q.type === "ordering" ? q.items.length : 0;
      return a.o.length <= n && a.o.every(dai) ? null : "Đáp án sắp xếp không hợp lệ";
    }
  }
}

/* ------------------------------------ Chấm ------------------------------------ */

/** So chuỗi lỏng: bỏ khoảng trắng thừa, không phân biệt hoa/thường. KHÔNG bỏ dấu — "mẹ" và "me" khác nghĩa. */
export const chuanSo = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

export type KetQuaCau = { loai: "tu-dong"; tiLe: number } | { loai: "cham-tay" };

/** Chấm một câu. `a = null` = bỏ trống ⇒ 0 với câu chấm tự động. */
export function chamCau(q: ContentQuestion, a: DapAn | null): KetQuaCau {
  switch (q.type) {
    case "short":
    case "essay":
    case "video":
      return { loai: "cham-tay" };
    case "single":
      return { loai: "tu-dong", tiLe: a?.k === "single" && a.i === q.correctIndex ? 1 : 0 };
    case "multiple": {
      if (a?.k !== "multiple") return { loai: "tu-dong", tiLe: 0 };
      const dung = [...q.correctIndices].sort((x, y) => x - y);
      const chon = [...a.i].sort((x, y) => x - y);
      const khop = dung.length === chon.length && dung.every((v, i) => v === chon[i]);
      return { loai: "tu-dong", tiLe: khop ? 1 : 0 };
    }
    case "boolean":
      return { loai: "tu-dong", tiLe: a?.k === "boolean" && a.v === q.correct ? 1 : 0 };
    case "fill": {
      if (a?.k !== "fill" || q.answers.length === 0) return { loai: "tu-dong", tiLe: 0 };
      const dung = q.answers.filter((x, i) => chuanSo(a.t[i] ?? "") === chuanSo(x)).length;
      return { loai: "tu-dong", tiLe: dung / q.answers.length };
    }
    case "matching": {
      if (a?.k !== "matching" || q.pairs.length === 0) return { loai: "tu-dong", tiLe: 0 };
      const dung = q.pairs.filter((p, i) => chuanSo(a.r[i] ?? "") === chuanSo(p.right)).length;
      return { loai: "tu-dong", tiLe: dung / q.pairs.length };
    }
    case "ordering": {
      if (a?.k !== "ordering") return { loai: "tu-dong", tiLe: 0 };
      const khop = a.o.length === q.items.length && q.items.every((x, i) => chuanSo(a.o[i] ?? "") === chuanSo(x));
      return { loai: "tu-dong", tiLe: khop ? 1 : 0 };
    }
  }
}

export type CauChamTho = { q: ContentQuestion; diemCau: number | null; dapAn: DapAn | null };

export type CauDaCham = {
  id: string;
  /** null = câu chấm tay (thầy cô chấm). */
  tiLe: number | null;
  /** Điểm đạt được THEO THANG CỦA BÀI (đã nhân trọng số); null = câu chấm tay. */
  diem: number | null;
  /** null = chưa biết (câu chấm tay). */
  dung: boolean | null;
};

export type BaiDaCham = {
  cau: CauDaCham[];
  /** Tổng điểm các câu chấm tự động, theo thang của bài, làm tròn 2 số lẻ. */
  diemTuDong: number;
  /** Còn câu thầy cô phải chấm (tự luận, trả lời ngắn, video). */
  conChamTay: boolean;
};

/**
 * Chấm cả bài. Trọng số mỗi câu = điểm riêng của câu (`Question.points`) hoặc 1 nếu không đặt; điểm của câu = `tongDiem × trọng số /
 * Σ trọng số` — câu chấm tay VẪN chiếm phần của nó trong mẫu số, nên điểm tự động không bao giờ vượt phần mình đáng được hưởng.
 */
export function chamBai(cau: readonly CauChamTho[], tongDiem: number): BaiDaCham {
  const w = (c: CauChamTho) => (c.diemCau != null && c.diemCau > 0 ? c.diemCau : 1);
  const tongW = cau.reduce((s, c) => s + w(c), 0);
  let diemTuDong = 0;
  let conChamTay = false;
  const ra: CauDaCham[] = cau.map((c) => {
    const kq = chamCau(c.q, c.dapAn);
    if (kq.loai === "cham-tay") {
      conChamTay = true;
      return { id: c.q.id, tiLe: null, diem: null, dung: null };
    }
    const diem = tongW > 0 ? (tongDiem * w(c) * kq.tiLe) / tongW : 0;
    diemTuDong += diem;
    return { id: c.q.id, tiLe: kq.tiLe, diem: Math.round(diem * 10000) / 10000, dung: kq.tiLe === 1 };
  });
  return { cau: ra, diemTuDong: Math.round(diemTuDong * 100) / 100, conChamTay };
}
