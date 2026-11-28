import { z } from "zod";
import { LOAI_MO_RONG, chamMoRong, kiemCauMoRong, laLoaiChamTay, laLoaiMoRong, veCauMoRong, type LoaiMoRong } from "./dang-cau-hoi";

/**
 * E-LEARNING ONLINE — CHẤM ĐIỂM (hàm THUẦN): kiểm câu hỏi · chấm tự động · tổng điểm · đạt/không · phần hiển thị cho học viên theo cài đặt "xem kết quả".
 * KHÔNG dùng chung với `TrnQuestion`/`Exam*` (Nội bộ/LMS Offline) — chỉ chung KHÁI NIỆM, không chung mã nghiệp vụ.
 *
 * Bất biến:
 * 1. Đạt ⇔ `điểmĐạt × 100 ≥ ngưỡng × tổng` (so SỐ NGUYÊN) — không làm tròn lên rồi mới so; % hiển thị làm tròn XUỐNG (không báo 100% khi thiếu).
 * 2. Điểm tối đa = 0 (đề rỗng) ⇒ KHÔNG đạt (không "đạt vì không có gì để sai").
 * 3. Câu chọn nhiều ĐÚNG khi tập chọn = tập đáp án (không chấm một phần); câu tự luận chỉ có điểm sau khi chấm tay; đề có tự luận chưa chấm ⇒ `passed = null`.
 * 4. Đáp án sai KIỂU (vd chuỗi cho câu chọn nhiều) = sai, không ném lỗi — học viên gửi gì cũng không làm hỏng lượt chấm.
 * 5. Học viên KHÔNG BAO GIỜ nhận đáp án đúng khi đang làm bài (`veChoHocVien`).
 */

export type LoaiCauHoi = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_TEXT" | "ESSAY" | LoaiMoRong;
/** 5 dạng gốc + 8 dạng mở rộng (V10.0 Q5) = 13. */
export const LOAI_CAU_HOI = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_TEXT", "ESSAY", ...LOAI_MO_RONG] as const;

export type LuaChon = { id: string; text: string };
export type DapAn = { correct?: string | string[] | boolean; accepted?: string[]; [khoa: string]: unknown };

/** Một câu trong SNAPSHOT của lượt làm bài (có đáp án — chỉ lưu DB, không gửi học viên). */
export type CauHoiSnapshot = { id: string; type: LoaiCauHoi; stem: string; options: LuaChon[]; /** Cấu hình của 8 dạng mở rộng (`optionsJson` dạng đối tượng). Snapshot cũ không có trường này. */ cauHinh?: Record<string, unknown>; key: DapAn; points: number; explanation: string | null };
export type SnapshotDe = { assessmentId: string; title: string; kind: string; passPercent: number; timeLimitMin: number | null; cau: CauHoiSnapshot[] };

// ───────── Soạn câu hỏi ─────────

export const cauHoiSchema = z
  .object({
    id: z.string().min(1).optional(),
    courseId: z.string().min(1),
    type: z.enum(LOAI_CAU_HOI),
    stem: z.string().trim().min(1, "Câu hỏi cần có nội dung").max(5000),
    options: z.array(z.object({ id: z.string().trim().min(1).max(40), text: z.string().trim().min(1, "Lựa chọn không được trống").max(1000) }).strict()).max(10).optional(),
    correct: z.union([z.string(), z.array(z.string()), z.boolean()]).optional(),
    accepted: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
    /** Cấu hình riêng của 8 dạng mở rộng (xem `dang-cau-hoi.ts`). */
    cauHinh: z.record(z.string(), z.unknown()).optional(),
    explanation: z.string().trim().max(3000).nullable().optional(),
    points: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
export type CauHoiInput = z.infer<typeof cauHoiSchema>;

export type KetQuaKiemCau = { ok: true; optionsJson: LuaChon[] | Record<string, unknown>; answerKeyJson: DapAn } | { ok: false; thongBao: string };

export function kiemCauHoi(i: Pick<CauHoiInput, "type" | "options" | "correct" | "accepted"> & { stem?: string; cauHinh?: Record<string, unknown> }): KetQuaKiemCau {
  if (laLoaiMoRong(i.type)) {
    const k = kiemCauMoRong(i.type, i.stem ?? "", i.cauHinh);
    return k.ok ? { ok: true, optionsJson: k.optionsJson, answerKeyJson: k.answerKeyJson } : k;
  }
  const opts = i.options ?? [];
  const ids = new Set(opts.map((o) => o.id));
  switch (i.type) {
    case "SINGLE_CHOICE": {
      if (opts.length < 2) return { ok: false, thongBao: "Câu chọn một cần ít nhất 2 lựa chọn" };
      if (ids.size !== opts.length) return { ok: false, thongBao: "Mã lựa chọn bị trùng" };
      if (typeof i.correct !== "string" || !ids.has(i.correct)) return { ok: false, thongBao: "Chọn đúng MỘT đáp án thuộc các lựa chọn" };
      return { ok: true, optionsJson: opts, answerKeyJson: { correct: i.correct } };
    }
    case "MULTIPLE_CHOICE": {
      if (opts.length < 2) return { ok: false, thongBao: "Câu chọn nhiều cần ít nhất 2 lựa chọn" };
      if (ids.size !== opts.length) return { ok: false, thongBao: "Mã lựa chọn bị trùng" };
      if (!Array.isArray(i.correct) || i.correct.length < 1) return { ok: false, thongBao: "Chọn ít nhất một đáp án đúng" };
      const dung = [...new Set(i.correct)];
      if (!dung.every((c) => ids.has(c))) return { ok: false, thongBao: "Đáp án đúng phải thuộc các lựa chọn" };
      return { ok: true, optionsJson: opts, answerKeyJson: { correct: dung.sort() } };
    }
    case "TRUE_FALSE": {
      if (typeof i.correct !== "boolean") return { ok: false, thongBao: "Chọn Đúng hoặc Sai" };
      return { ok: true, optionsJson: [], answerKeyJson: { correct: i.correct } };
    }
    case "SHORT_TEXT": {
      const acc = (i.accepted ?? []).map((a) => a.trim()).filter(Boolean);
      if (acc.length < 1) return { ok: false, thongBao: "Nhập ít nhất một đáp án được chấp nhận" };
      return { ok: true, optionsJson: [], answerKeyJson: { accepted: [...new Set(acc)] } };
    }
    case "ESSAY":
      return { ok: true, optionsJson: [], answerKeyJson: {} };
    default:
      return { ok: false, thongBao: "Dạng câu hỏi không hợp lệ" };
  }
}

// ───────── Chấm ─────────

/** Chuẩn hoá để so câu trả lời ngắn: NFC, chữ thường, gộp khoảng trắng, bỏ dấu câu ở hai đầu. KHÔNG bỏ dấu tiếng Việt (dấu đổi nghĩa). */
export function chuanHoaVanBan(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim().replace(/^[\s.,;:!?"'“”‘’()-]+|[\s.,;:!?"'“”‘’()-]+$/g, "");
}

export type KetQuaCau = { id: string; dung: boolean | null; diem: number; toiDa: number; /** Chỉ có ở dạng chấm từng phần (ghép cặp, sắp xếp, phân loại, điền trống). */ soDung?: number; soCau?: number };

export function chamCau(q: CauHoiSnapshot, traLoi: unknown): KetQuaCau {
  const toiDa = q.points;
  const kq = (dung: boolean | null): KetQuaCau => ({ id: q.id, dung, diem: dung ? toiDa : 0, toiDa });
  switch (q.type) {
    case "SINGLE_CHOICE":
      return kq(typeof traLoi === "string" && traLoi === q.key.correct);
    case "MULTIPLE_CHOICE": {
      const dung = Array.isArray(q.key.correct) ? (q.key.correct as string[]) : [];
      if (!Array.isArray(traLoi) || traLoi.some((x) => typeof x !== "string")) return kq(false);
      const chon = [...new Set(traLoi as string[])];
      return kq(chon.length === dung.length && dung.every((d) => chon.includes(d)));
    }
    case "TRUE_FALSE":
      return kq(typeof traLoi === "boolean" && traLoi === q.key.correct);
    case "SHORT_TEXT": {
      if (typeof traLoi !== "string") return kq(false);
      const t = chuanHoaVanBan(traLoi);
      return kq(t.length > 0 && (q.key.accepted ?? []).some((a) => chuanHoaVanBan(a) === t));
    }
    case "ESSAY":
      return { id: q.id, dung: null, diem: 0, toiDa };
    default: {
      // 8 dạng mở rộng. Điểm một phần làm tròn XUỐNG; PRODUCT không tự chấm (dung = null, điểm 0 cho tới khi người chấm chấm).
      const k = chamMoRong({ id: q.id, type: q.type, stem: q.stem, options: q.cauHinh ?? {}, key: q.key, points: q.points }, traLoi);
      if (k.dung === null) return { id: q.id, dung: null, diem: 0, toiDa };
      return { id: q.id, dung: k.dung, diem: k.soCau > 0 ? Math.floor((toiDa * k.soDung) / k.soCau) : 0, toiDa, ...(k.soCau > 1 ? { soDung: k.soDung, soCau: k.soCau } : {}) };
    }
  }
}

export type KetQuaBai = {
  earned: number;
  total: number;
  /** Làm tròn XUỐNG; `null` nếu còn câu tự luận chưa chấm. */
  scorePercent: number | null;
  passed: boolean | null;
  canChamTay: boolean;
  chiTiet: KetQuaCau[];
};

/**
 * Chấm cả bài. `diemTuLuan`: điểm GIÁO VIÊN chấm cho từng câu tự luận (0..điểm tối đa của câu); thiếu câu nào ⇒ `canChamTay = true` và chưa kết luận.
 * Điểm tự luận ngoài khoảng bị KẸP về [0, tối đa] (không để điểm âm/vượt kéo lệch cả bài).
 */
export function chamBai(de: SnapshotDe, traLoi: Record<string, unknown>, diemTuLuan: Record<string, number> = {}): KetQuaBai {
  const coDiem = (id: string) => typeof diemTuLuan[id] === "number" && Number.isFinite(diemTuLuan[id]);
  const chiTiet = de.cau.map((q) => {
    if (!laLoaiChamTay(q.type)) return chamCau(q, traLoi[q.id]);
    const d = diemTuLuan[q.id];
    return { id: q.id, dung: null, diem: coDiem(q.id) ? Math.min(q.points, Math.max(0, Math.round(d!))) : 0, toiDa: q.points };
  });
  const total = de.cau.reduce((s, q) => s + q.points, 0);
  const earned = chiTiet.reduce((s, c) => s + c.diem, 0);
  const canChamTay = de.cau.some((q) => laLoaiChamTay(q.type) && !coDiem(q.id));
  if (canChamTay) return { earned, total, scorePercent: null, passed: null, canChamTay: true, chiTiet };
  return {
    earned,
    total,
    scorePercent: total === 0 ? 0 : Math.floor((earned * 100) / total),
    passed: total > 0 && earned * 100 >= de.passPercent * total,
    canChamTay: false,
    chiTiet,
  };
}

// ───────── Phần gửi cho học viên ─────────

export type CauHoiChoHocVien = { id: string; type: LoaiCauHoi; stem: string; options: LuaChon[]; points: number; /** Cấu hình hiển thị của dạng mở rộng — KHÔNG có đáp án. */ cauHinh?: Record<string, unknown> };

/** Bỏ đáp án + giải thích khỏi câu hỏi trước khi gửi học viên (khi ĐANG làm bài). */
export function veChoHocVien(de: SnapshotDe): { tieuDe: string; kind: string; thoiGianPhut: number | null; cau: CauHoiChoHocVien[] } {
  return { tieuDe: de.title, kind: de.kind, thoiGianPhut: de.timeLimitMin, cau: de.cau.map((q) => {
      if (!laLoaiMoRong(q.type)) return { id: q.id, type: q.type, stem: q.stem, options: q.options, points: q.points };
      const v = veCauMoRong({ id: q.id, type: q.type, stem: q.stem, options: q.cauHinh ?? {}, key: q.key, points: q.points });
      return { id: q.id, type: q.type, stem: v.stem, options: [], points: q.points, cauHinh: v.cauHinh };
    }) };
}

export type XemKetQua = "DIEM_VA_DUNG_SAI" | "CA_DAP_AN_SAU_HET_LUOT" | "CHI_DIEM";

export type KetQuaChoHocVien = {
  scorePercent: number | null;
  passed: boolean | null;
  daChamXong: boolean;
  chiTiet?: { id: string; dung: boolean | null; diem: number; toiDa: number; dapAnDung?: DapAn; giaiThich?: string | null }[];
};

export type ChinhSachDapAn = { che: "SAU_KHI_NOP" | "SAU_KHI_DE_DONG" | "KHONG_BAO_GIO"; dongLuc: Date | null };

/** D6: có lộ đáp án đúng cho lượt ĐÃ CHỐT không. Hàm thuần — màn hình, API và test cùng gọi. KHÔNG bao giờ gọi cho lượt INTERRUPTED/EXPIRED (không có kết quả). */
export function duocHienDapAn(cs: ChinhSachDapAn, now: Date): boolean {
  if (cs.che === "SAU_KHI_NOP") return true;
  if (cs.che === "SAU_KHI_DE_DONG") return cs.dongLuc !== null && now.getTime() >= cs.dongLuc.getTime();
  return false;
}

/**
 * Phần học viên ĐƯỢC xem của một lượt đã nộp, theo cài đặt của khoá:
 * - `CHI_DIEM`: chỉ điểm + đạt/không.
 * - `DIEM_VA_DUNG_SAI`: thêm đúng/sai từng câu (KHÔNG đáp án).
 * - `CA_DAP_AN_SAU_HET_LUOT`: như trên; đáp án đúng + giải thích chỉ hiện khi ĐÃ HẾT LƯỢT hoặc ĐÃ ĐẠT (còn lượt mà lộ đáp án là mời học vẹt).
 */
export function ketQuaChoHocVien(input: { de: SnapshotDe; ketQua: KetQuaBai; xemKetQua: XemKetQua; conLuot: boolean; /** D6: có ⇒ quyết lộ đáp án theo chính sách này (cần `now`); vắng ⇒ luật cũ theo `xemKetQua`. */ chinhSachDapAn?: ChinhSachDapAn; now?: Date }): KetQuaChoHocVien {
  const { de, ketQua: k } = input;
  const co: KetQuaChoHocVien = { scorePercent: k.scorePercent, passed: k.passed, daChamXong: !k.canChamTay };
  if (input.xemKetQua === "CHI_DIEM") return co;
  const hienDapAn = input.chinhSachDapAn
    ? duocHienDapAn(input.chinhSachDapAn, input.now ?? new Date(0))
    : input.xemKetQua === "CA_DAP_AN_SAU_HET_LUOT" && (!input.conLuot || k.passed === true);
  const theoId = new Map(de.cau.map((q) => [q.id, q]));
  co.chiTiet = k.chiTiet.map((c) => ({
    id: c.id,
    dung: c.dung,
    diem: c.diem,
    toiDa: c.toiDa,
    ...(hienDapAn ? { dapAnDung: theoId.get(c.id)!.key, giaiThich: theoId.get(c.id)!.explanation } : {}),
  }));
  return co;
}

/** Xáo thứ tự bằng nguồn ngẫu nhiên truyền vào (kiểm thử được). Fisher–Yates. */
export function xaoTron<T>(ds: readonly T[], ngauNhien: () => number): T[] {
  const a = [...ds];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(ngauNhien() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
