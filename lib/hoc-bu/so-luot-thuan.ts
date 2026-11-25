// lib/hoc-bu/so-luot-thuan.ts — THUẦN: toán của SỔ LƯỢT học bù (T06, 07/10/2026). Không chạm DB.
//
// Một tài khoản mỗi (học viên, khoá). Ba số, một công thức duy nhất:  còn = granted − held − consumed.
// Mỗi bút toán nói rõ nó đổi số nào (khớp CHECK `MakeupCreditEntry_dang_check` ở migration — hai bên PHẢI cùng một bảng):
//
//   GRANT       granted +n
//   HOLD        held +1                 xếp vào case bằng lượt
//   RELEASE     held −1                 gỡ / huỷ case / bé vắng buổi bù
//   CONSUME     held −1, consumed +1    bé CÓ MẶT (held 0 chỉ cho dòng cũ nhập vào sổ — không có HOLD để nhả)
//   ADJUSTMENT  granted ±n              đơn huỷ/hoàn/đổi số buổi — luôn kèm lý do
//
// Vì sao tách khỏi tệp ghi DB: phép "áp một bút toán lên ba số rồi kiểm bất biến" là chỗ DUY NHẤT quyết định lượt có bị âm hay
// vượt không, và nó cần chỗ cấy lỗi mà không cần Postgres (trước T06, `conLuotBu` che số âm bằng `Math.max(0, …)` nên lượt âm
// im lặng — HB-20).

export type SoLuot = { granted: number; held: number; consumed: number };

export type LoaiButToan = "GRANT" | "HOLD" | "RELEASE" | "CONSUME" | "ADJUSTMENT";

export type ButToan = {
  type: LoaiButToan;
  grantedDelta: number;
  heldDelta: number;
  consumedDelta: number;
  /** Khoá chống lặp trong tài khoản — chạy lại một bước không ghi hai lần. */
  idemKey: string;
  makeupNeedId?: string | null;
  caseStudentId?: string | null;
  reason?: string | null;
};

export const conLai = (s: SoLuot): number => s.granted - s.held - s.consumed;

export const SO_RONG: SoLuot = { granted: 0, held: 0, consumed: 0 };

// ── Khoá chống lặp — MỘT nơi định nghĩa, để hai bên (ghi + kiểm) không lệch nhau ──────────────────────────────────────────
export const khoaCap = (): string => "GRANT:khoi-tao";
export const khoaGiu = (caseStudentId: string): string => `HOLD:${caseStudentId}`;
export const khoaNha = (caseStudentId: string): string => `RELEASE:${caseStudentId}`;
/** Tiêu lượt theo DÒNG cần bù (mỗi dòng tiêu tối đa một lần), không theo mục case. */
export const khoaTieu = (makeupNeedId: string): string => `CONSUME:${makeupNeedId}`;
export const khoaDieuChinh = (nguon: string): string => `ADJUSTMENT:${nguon}`;
/**
 * T07 — tiêu lượt theo MỤC case + LẦN sửa điểm danh của bé: một mục có thể tiêu → trả → tiêu lại khi sửa điểm danh, và mỗi lần là một
 * bút toán riêng (cùng khoá thì lần sau bị coi là "chạy lại" và lặng lẽ bỏ qua — lượt không được tiêu).
 */
export const khoaTieuMuc = (makeupNeedId: string, caseStudentId: string, lan: number): string => `CONSUME:${makeupNeedId}:${caseStudentId}:${lan}`;
export const khoaDaoTieu = (caseStudentId: string, lan: number): string => `REVERT:${caseStudentId}:${lan}`;

// ── Dựng bút toán ───────────────────────────────────────────────────────────────────────────────────────────────────
export function butToanCap(n: number, p: { reason: string | null }): ButToan {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`GRANT phải là số nguyên dương, nhận ${n}`);
  return { type: "GRANT", grantedDelta: n, heldDelta: 0, consumedDelta: 0, idemKey: khoaCap(), reason: p.reason };
}

export function butToanGiu(p: { caseStudentId: string; makeupNeedId: string }): ButToan {
  return {
    type: "HOLD",
    grantedDelta: 0,
    heldDelta: 1,
    consumedDelta: 0,
    idemKey: khoaGiu(p.caseStudentId),
    caseStudentId: p.caseStudentId,
    makeupNeedId: p.makeupNeedId,
  };
}

export function butToanNha(p: { caseStudentId: string; makeupNeedId: string; reason: string }): ButToan {
  return {
    type: "RELEASE",
    grantedDelta: 0,
    heldDelta: -1,
    consumedDelta: 0,
    idemKey: khoaNha(p.caseStudentId),
    caseStudentId: p.caseStudentId,
    makeupNeedId: p.makeupNeedId,
    reason: p.reason,
  };
}

/** `daGiu` = lượt này đang được GIỮ (HOLD) ⇒ tiêu là chuyển held→consumed. Dòng cũ nhập vào sổ không có HOLD ⇒ `daGiu = false`. */
export function butToanTieu(p: { makeupNeedId: string; caseStudentId: string | null; daGiu: boolean; khoa?: string }): ButToan {
  return {
    type: "CONSUME",
    grantedDelta: 0,
    heldDelta: p.daGiu ? -1 : 0,
    consumedDelta: 1,
    idemKey: p.khoa ?? khoaTieu(p.makeupNeedId),
    caseStudentId: p.caseStudentId,
    makeupNeedId: p.makeupNeedId,
  };
}

/** Trả lại ĐÚNG MỘT lượt đã tiêu (sửa điểm danh) — ADJUSTMENT consumed −1, bắt buộc lý do; không xoá bút toán tiêu cũ. */
export function butToanDaoTieu(p: { makeupNeedId: string; caseStudentId: string; lan: number; reason: string }): ButToan {
  if (p.reason.trim().length === 0) throw new RangeError("ADJUSTMENT phải có lý do");
  return {
    type: "ADJUSTMENT",
    grantedDelta: 0,
    heldDelta: 0,
    consumedDelta: -1,
    idemKey: khoaDaoTieu(p.caseStudentId, p.lan),
    caseStudentId: p.caseStudentId,
    makeupNeedId: p.makeupNeedId,
    reason: p.reason.trim(),
  };
}

export function butToanDieuChinh(p: { delta: number; nguon: string; reason: string; makeupNeedId?: string | null }): ButToan {
  if (!Number.isInteger(p.delta) || p.delta === 0) throw new RangeError(`ADJUSTMENT phải là số nguyên khác 0, nhận ${p.delta}`);
  if (p.reason.trim().length === 0) throw new RangeError("ADJUSTMENT phải có lý do");
  return {
    type: "ADJUSTMENT",
    grantedDelta: p.delta,
    heldDelta: 0,
    consumedDelta: 0,
    idemKey: khoaDieuChinh(p.nguon),
    makeupNeedId: p.makeupNeedId ?? null,
    reason: p.reason.trim(),
  };
}

// ── Áp lên ba số ────────────────────────────────────────────────────────────────────────────────────────────────────
export type KetQuaAp = { ok: true; sau: SoLuot } | { ok: false; ma: "AM" | "VUOT"; lyDo: string };

/**
 * Áp MỘT bút toán lên ba số và kiểm bất biến (không âm, và còn ≥ 0). Trả lỗi chứ không ném — nơi gọi quyết định câu nói với người
 * dùng ("hết lượt" khác "sổ hỏng"). Cùng luật với hai CHECK của bảng: lỗi mã không thể ghi số âm vào DB, và cũng không thể
 * "che" nó trong bộ nhớ.
 */
export function apButToan(truoc: SoLuot, b: Pick<ButToan, "grantedDelta" | "heldDelta" | "consumedDelta">): KetQuaAp {
  const sau: SoLuot = {
    granted: truoc.granted + b.grantedDelta,
    held: truoc.held + b.heldDelta,
    consumed: truoc.consumed + b.consumedDelta,
  };
  if (sau.granted < 0 || sau.held < 0 || sau.consumed < 0) {
    return { ok: false, ma: "AM", lyDo: "Sổ lượt bị âm — bút toán không hợp lệ với số hiện có" };
  }
  if (conLai(sau) < 0) return { ok: false, ma: "VUOT", lyDo: "Hết lượt" };
  return { ok: true, sau };
}

/**
 * Điều chỉnh GIẢM không được kéo "còn" xuống âm: lượt đã giữ/đã tiêu là sự thật đã xảy ra, không rút lại bằng một đơn huỷ.
 * Trả mức giảm THỰC SỰ áp được (≤ 0) và phần bị giữ lại để nơi gọi ghi vào lý do — không im lặng bỏ phần dư.
 */
export function gioiHanDieuChinhGiam(s: SoLuot, delta: number): { ap: number; giuLai: number } {
  if (delta >= 0) return { ap: delta, giuLai: 0 };
  const duocRut = Math.max(0, conLai(s));
  const ap = 0 - Math.min(-delta, duocRut); // `0 -` chứ không `-`: tránh −0 (JSON/so sánh phân biệt −0 với 0)
  return { ap, giuLai: -delta + ap };
}

/** Tổng các bút toán — dùng cho checker: số trên tài khoản PHẢI bằng tổng sổ. */
export function tongTuSo(
  but: readonly Pick<ButToan, "grantedDelta" | "heldDelta" | "consumedDelta">[],
): SoLuot {
  return but.reduce<SoLuot>(
    (a, b) => ({
      granted: a.granted + b.grantedDelta,
      held: a.held + b.heldDelta,
      consumed: a.consumed + b.consumedDelta,
    }),
    { ...SO_RONG },
  );
}

export type DuLieuNhapCu = {
  /** Lượt công thức cấp cho (học viên, khoá) — kết quả của `tongLuotBu`. */
  tongCongThuc: number;
  /** Mục case đang PLACED bằng lượt (đã xếp, chưa điểm danh) — mỗi mục là một HOLD. */
  dangGiu: readonly { caseStudentId: string; makeupNeedId: string }[];
  /** Dòng đã COMPLETED có `usedQuota` — mỗi dòng là một CONSUME (không có HOLD để nhả). */
  daTieu: readonly { makeupNeedId: string; caseStudentId: string | null }[];
};

/**
 * Bút toán KHỞI TẠO một tài khoản mới từ dữ liệu trước T06: cấp theo công thức hiện tại, rồi phát lại những gì đã giữ / đã tiêu.
 * Nếu bé ĐÃ dùng vượt số lượt công thức cho (dữ liệu cũ vượt lượt — HB-20) thì thêm ADJUSTMENT dương có lý do để sổ không âm:
 * sự thật "đã bù rồi" không được xoá, và con số vượt không bị che mà nằm ngay trong sổ.
 */
export function butToanKhoiTao(d: DuLieuNhapCu): ButToan[] {
  const ra: ButToan[] = [];
  const can = d.dangGiu.length + d.daTieu.length;
  const cap = Math.max(0, Math.floor(d.tongCongThuc));
  const vuot = soVuotCuaSo(d.tongCongThuc, can);
  if (cap > 0) {
    ra.push(butToanCap(cap, { reason: "Khởi tạo sổ: lượt theo công thức học phần hiện tại" }));
  }
  if (vuot > 0) {
    ra.push(
      butToanDieuChinh({
        delta: vuot,
        nguon: "khoi-tao-dung-vuot",
        reason: `Khởi tạo sổ: dữ liệu cũ đã giữ/tiêu ${can} lượt nhưng công thức chỉ cấp ${cap} — ghi nhận phần vượt (SYSTEM_MIGRATION, cần người rà)`,
      }),
    );
  }
  for (const g of d.dangGiu) ra.push(butToanGiu(g));
  for (const t of d.daTieu) ra.push(butToanTieu({ ...t, daGiu: false }));
  return ra;
}

/** Phần dữ liệu cũ vượt công thức — MỘT chỗ định nghĩa, cho cả `butToanKhoiTao` lẫn báo cáo dry-run của script nhập. */
export const soVuotCuaSo = (tongCongThuc: number, soDaDung: number): number =>
  Math.max(0, soDaDung - Math.max(0, Math.floor(tongCongThuc)));

export const soVuotKhiKhoiTao = (d: Pick<DuLieuNhapCu, "tongCongThuc" | "dangGiu" | "daTieu">): number =>
  soVuotCuaSo(d.tongCongThuc, d.dangGiu.length + d.daTieu.length);
