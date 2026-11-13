import {
  EVAL_CRITERIA,
  evalLevelText,
  evalNotesProse,
  groupedEvalCriteria,
  type EvalNotes,
} from "@/lib/lms/session-eval-rubric";
import type { SessionAttendance } from "@/lib/portal/student-sessions";

// Cổng phụ huynh — phần THUẦN của màn "Nhận xét & học bạ" (artifact Nhan-xet.dc.html).
// Không đụng DB: nhận dữ liệu đã nạp, trả đúng thứ màn cần vẽ. Mức rubric 1 = tốt nhất … 5 = cần cố gắng;
// số "vạch" cho phụ huynh = 6 − mức (5 vạch = tốt nhất).

export const vachTuMuc = (muc: number): number => Math.min(5, Math.max(1, 6 - Math.round(muc)));

/** `3,5` — một chữ số thập phân, dấu phẩy kiểu Việt. */
export const so1 = (x: number): string => x.toFixed(1).replace(".", ",");

// ── Một buổi ───────────────────────────────────────────────────────────────────

export type KieuBuoi = "phieu" | "cho-phieu" | "vang" | "chua" | "huy";

export function phanLoaiBuoi(i: { attendance: SessionAttendance; past: boolean; coPhieu: boolean }): KieuBuoi {
  if (i.attendance === "CANCELLED") return "huy";
  if (i.coPhieu) return "phieu";
  if (i.past && (i.attendance === "EXCUSED" || i.attendance === "ABSENT")) return "vang";
  if (!i.past || i.attendance === "FUTURE") return "chua";
  return "cho-phieu";
}

export type DongChung = { nhan: string | null; text: string };

export type PhieuView = {
  /** `31/10 21:05` — lúc giáo viên chấm. */
  chamLuc: string | null;
  giaoVien: string | null;
  /** Phần "Đánh giá chung": phiếu mới một đoạn; phiếu cũ nhiều mục có nhãn (không gồm Đề xuất). */
  chung: DongChung[];
  /** Chỉ phiếu cũ mới có mục "Đề xuất" tách riêng. */
  deXuat: string | null;
  nhom: { ten: string; tc: { id: string; ten: string; mo: string; vach: number }[] }[];
  soTieuChi: number;
};

export function dungPhieu(i: {
  comment: string;
  notes: EvalNotes | null;
  rubric: Record<string, number> | null;
  giaoVien: string | null;
  chamLuc: string | null;
}): PhieuView {
  const prose = evalNotesProse(i.notes);
  let chung: DongChung[] = [];
  let deXuat: string | null = null;
  if (prose?.kind === "overall") chung = [{ nhan: null, text: prose.text }];
  else if (prose?.kind === "legacy") {
    chung = prose.rows.filter((r) => r.key !== "proposal").map((r) => ({ nhan: r.label, text: r.text }));
    deXuat = prose.rows.find((r) => r.key === "proposal")?.text ?? null;
  } else if (i.comment.trim()) chung = [{ nhan: null, text: i.comment.trim() }];

  const nhom = groupedEvalCriteria()
    .map(([ten, items]) => ({
      ten,
      tc: items
        .filter((c) => i.rubric?.[c.id] != null)
        .map((c) => {
          const muc = i.rubric?.[c.id] ?? 3;
          return { id: c.id, ten: c.name, mo: evalLevelText(c.id, muc) || `Mức ${muc}/5`, vach: vachTuMuc(muc) };
        }),
    }))
    .filter((g) => g.tc.length > 0);
  return {
    chamLuc: i.chamLuc,
    giaoVien: i.giaoVien,
    chung,
    deXuat,
    nhom,
    soTieuChi: nhom.reduce((n, g) => n + g.tc.length, 0),
  };
}

export type BuoiNX = {
  id: string;
  n: number;
  /** `T7 31/10` */
  ngay: string;
  ten: string;
  hocPhan: string | null;
  kieu: KieuBuoi;
  /** Phiếu mới (≤ 7 ngày) — chấm cam trên ô buổi. */
  moi: boolean;
  /** Chỉ buổi vắng. */
  vangGhi: string | null;
  canBu: boolean;
  phieu: PhieuView | null;
  muc: Record<string, number> | null;
};

export const NGAY_MOI = 7;
export const laPhieuMoi = (chamLucISO: string, now: Date): boolean => {
  const ms = now.getTime() - new Date(chamLucISO).getTime();
  return ms >= 0 && ms <= NGAY_MOI * 24 * 3600 * 1000;
};

// ── Học phần (chip phía trên lưới buổi) ────────────────────────────────────────

export type NhomHocPhan = { ma: string; ten: string; tom: string; ids: string[] };

export function gomHocPhan(buoi: Pick<BuoiNX, "id" | "hocPhan" | "kieu">[], daHoc: (id: string) => boolean): NhomHocPhan[] {
  const co = buoi.some((b) => b.hocPhan);
  const nhom: { ma: string; ids: string[] }[] = [];
  let hienTai: { ma: string; ids: string[] } | null = null;
  for (const b of buoi) {
    const truoc: string = hienTai ? hienTai.ma : "";
    const ma: string = co ? (b.hocPhan ?? truoc) : "all";
    if (!hienTai || hienTai.ma !== ma) {
      hienTai = nhom.find((g) => g.ma === ma) ?? null;
      if (!hienTai) {
        hienTai = { ma, ids: [] };
        nhom.push(hienTai);
      }
    }
    hienTai.ids.push(b.id);
  }
  return nhom.map((g) => {
    const da = g.ids.filter(daHoc).length;
    const so = /^HP\s*(\d+)$/i.exec(g.ma);
    return {
      ma: g.ma,
      ten: g.ma === "all" ? "Tất cả" : so ? `HP${Number(so[1])}` : g.ma || "Lộ trình",
      tom: da > 0 ? `${da}/${g.ids.length}` : "chưa học",
      ids: g.ids,
    };
  });
}

/** Buổi mở sẵn: phiếu mới nhất; chưa có phiếu nào thì buổi đã học gần nhất; chưa học gì thì buổi đầu. */
export function chonMacDinh(buoi: Pick<BuoiNX, "id" | "n" | "kieu">[]): string | null {
  const phieu = buoi.filter((b) => b.kieu === "phieu");
  if (phieu.length) return phieu.reduce((a, b) => (b.n > a.n ? b : a)).id;
  const daHoc = buoi.filter((b) => b.kieu === "vang" || b.kieu === "cho-phieu");
  if (daHoc.length) return daHoc.reduce((a, b) => (b.n > a.n ? b : a)).id;
  return buoi[0]?.id ?? null;
}

// ── Tổng hợp cả khoá ───────────────────────────────────────────────────────────

export type XuHuongTC = "tang" | "giu" | "giam" | null;
export type OBang = { loai: "muc"; muc: number; vach: number; buoiId: string; n: number } | { loai: "vang"; buoiId: string; n: number } | { loai: "trong"; buoiId: string; n: number };

export type TongHop = {
  soPhieu: number;
  soCoMat: number;
  tienBo: number;
  giam: number;
  soDeXuat: number;
  cot: { buoiId: string; n: number }[];
  hang: { id: string; nhom: string; ten: string; o: OBang[]; xh: XuHuongTC }[];
  manh: { ten: string; tb: string } | null;
  yeu: { ten: string; tb: string } | null;
  deXuat: { buoiId: string; n: number; ngay: string; text: string }[];
  chung: { buoiId: string; n: number; ngay: string; ten: string; chung: DongChung[] }[];
};

const tbCua = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function tongHop(buoi: BuoiNX[]): TongHop {
  const sx = [...buoi].sort((a, b) => a.n - b.n);
  const coPhieu = sx.filter((b) => b.kieu === "phieu");
  // Chỉ buổi CÓ thông tin: có phiếu hoặc vắng. Buổi đã học mà thầy cô chưa chấm phiếu là cột trống hoàn toàn, không đưa vào bảng.
  const cot = sx.filter((b) => b.kieu === "phieu" || b.kieu === "vang").map((b) => ({ buoiId: b.id, n: b.n }));
  const hang = EVAL_CRITERIA.map((c) => {
    const o: OBang[] = cot.map(({ buoiId, n }) => {
      const b = sx.find((x) => x.id === buoiId)!;
      const muc = b.muc?.[c.id];
      if (muc != null) return { loai: "muc", muc, vach: vachTuMuc(muc), buoiId, n };
      return b.kieu === "vang" ? { loai: "vang", buoiId, n } : { loai: "trong", buoiId, n };
    });
    const co = coPhieu.map((b) => b.muc?.[c.id]).filter((x): x is number => x != null);
    let xh: XuHuongTC = null;
    if (co.length >= 2) {
      const d = Math.round((tbCua(co.slice(0, 3)) - tbCua(co.slice(-3))) * 10) / 10;
      xh = d >= 0.5 ? "tang" : d <= -0.5 ? "giam" : "giu";
    }
    return { id: c.id, nhom: c.group, ten: c.name, o, xh, tb: co.length ? tbCua(co) : null };
  });
  const coDuLieu = hang.filter((h) => h.tb != null);
  let manh: TongHop["manh"] = null;
  let yeu: TongHop["yeu"] = null;
  if (coDuLieu.length) {
    const m = coDuLieu.reduce((a, b) => ((b.tb as number) < (a.tb as number) ? b : a));
    const y = coDuLieu.reduce((a, b) => ((b.tb as number) > (a.tb as number) ? b : a));
    manh = { ten: m.ten, tb: so1(6 - (m.tb as number)) };
    yeu = { ten: y.ten, tb: so1(6 - (y.tb as number)) };
  }
  const moi = [...coPhieu].reverse();
  return {
    soPhieu: coPhieu.length,
    soCoMat: sx.filter((b) => b.kieu === "phieu" || b.kieu === "cho-phieu").length,
    tienBo: hang.filter((h) => h.xh === "tang").length,
    giam: hang.filter((h) => h.xh === "giam").length,
    soDeXuat: coPhieu.filter((b) => b.phieu?.deXuat).length,
    cot,
    hang: hang.map(({ tb: _tb, ...h }) => h),
    manh,
    yeu,
    deXuat: moi.filter((b) => b.phieu?.deXuat).map((b) => ({ buoiId: b.id, n: b.n, ngay: b.ngay, text: b.phieu!.deXuat as string })),
    chung: moi.filter((b) => (b.phieu?.chung.length ?? 0) > 0).map((b) => ({ buoiId: b.id, n: b.n, ngay: b.ngay, ten: b.ten, chung: b.phieu!.chung })),
  };
}

// ── Năng lực cả khoá (tab Học bạ) ──────────────────────────────────────────────

export type NangLucNhom = { ten: string; tom: string; tc: { ten: string; dau: string; cuoi: string; phanTram: number }[] };

export function nangLucCaKhoa(buoi: BuoiNX[]): NangLucNhom[] {
  const co = buoi.filter((b) => b.kieu === "phieu" && b.muc).sort((a, b) => a.n - b.n);
  if (co.length === 0) return [];
  return groupedEvalCriteria()
    .map(([ten, items]) => {
      const tc = items
        .map((c) => {
          const xs = co.map((b) => b.muc?.[c.id]).filter((x): x is number => x != null);
          if (xs.length === 0) return null;
          const dau = 6 - tbCua(xs.slice(0, 3));
          const cuoi = 6 - tbCua(xs.slice(-3));
          return { ten: c.name, dau: so1(dau), cuoi: so1(cuoi), phanTram: Math.round((cuoi / 5) * 100) };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      return { ten, tom: `${tc.length} tiêu chí`, tc };
    })
    .filter((g) => g.tc.length > 0);
}
