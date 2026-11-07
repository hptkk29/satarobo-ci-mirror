/**
 * lib/nguon/di-tru-bang.ts — BẢNG "NHÃN CŨ × NGUỒN ĐÍCH" của báo cáo di trú (dry-run). THUẦN.
 *
 * Cột in ra: Nhãn cũ · Nguồn đích · Số lượng · Baseline · Delta · AUTO / MANUAL_REVIEW.
 *
 *  · AUTO / MANUAL_REVIEW đọc từ `soXemTay` của `tomTatDiTru` (số lead của dòng có ≥1 lý do xem tay). Dòng một phần ⇒ `HON_HOP`
 *    (nói thẳng, không gộp thành AUTO — gộp là che lead phải xem tay).
 *  · Baseline = số của LƯỢT CHẠY TRƯỚC (tệp JSON mà chính báo cáo này ghi ra), KHÔNG bịa: không có tệp ⇒ `null` (không phải 0).
 *    Có tệp mà dòng không có trong đó ⇒ baseline 0 (dòng MỚI xuất hiện). Dòng có trong baseline mà nay không còn ⇒ vẫn liệt kê
 *    (`KHONG_CON`, số lượng 0, Delta âm): một nhãn biến mất là tín hiệu, không được im lặng.
 *  · Delta = Số lượng − Baseline.
 *
 * KHÔNG đọc DB, KHÔNG đọc tệp, KHÔNG đọc đồng hồ: việc đọc/ghi tệp nằm ở kịch bản (`scripts/nguon/di-tru-nguon-cu.ts`).
 */
import type { MaNhomGoc } from "./danh-muc-goc";

export type DongTheoNhan = {
  nhanChuan: string | null;
  stt: number | null;
  nhom: MaNhomGoc | "INVALID";
  soLead: number;
  soXemTay: number;
};

export type LoaiDongBang = "AUTO" | "MANUAL_REVIEW" | "HON_HOP" | "INVALID" | "KHONG_CON";

export type DongBangNhan = DongTheoNhan & {
  /** null = KHÔNG có baseline để so (khác 0). */
  baseline: number | null;
  delta: number | null;
  loai: LoaiDongBang;
};

const NUL = "\u0000";

/** Khoá một dòng trong baseline: nhãn chuẩn hoá + đích (nhãn trống ⇒ chuỗi rỗng). */
export const khoaBaseline = (nhanChuan: string | null, nhom: string): string => `${nhanChuan ?? ""}${NUL}${nhom}`;

function loaiDong(d: DongTheoNhan): LoaiDongBang {
  if (d.nhom === "INVALID") return "INVALID";
  if (d.soXemTay <= 0) return "AUTO";
  return d.soXemTay >= d.soLead ? "MANUAL_REVIEW" : "HON_HOP";
}

export function dungBangNhan(
  theoNhan: readonly DongTheoNhan[],
  baseline: ReadonlyMap<string, number> | null,
): DongBangNhan[] {
  const ra: DongBangNhan[] = theoNhan.map((d) => {
    const b = baseline === null ? null : (baseline.get(khoaBaseline(d.nhanChuan, d.nhom)) ?? 0);
    return { ...d, baseline: b, delta: b === null ? null : d.soLead - b, loai: loaiDong(d) };
  });
  if (baseline !== null) {
    const co = new Set(theoNhan.map((d) => khoaBaseline(d.nhanChuan, d.nhom)));
    for (const [khoa, so] of baseline) {
      if (co.has(khoa) || so === 0) continue;
      const [nhan = "", nhom = ""] = khoa.split(NUL);
      ra.push({
        nhanChuan: nhan === "" ? null : nhan,
        stt: null,
        nhom: nhom as DongTheoNhan["nhom"],
        soLead: 0,
        soXemTay: 0,
        baseline: so,
        delta: -so,
        loai: "KHONG_CON",
      });
    }
  }
  return ra;
}

type TepBaseline = { phienBan: 1; dong: { khoa: string; soLead: number }[] };

/** Tệp baseline ghi ra cho lượt sau. Chỉ mang nhãn hệ thống + số đếm — không dữ liệu cá nhân. */
export function thanhBaseline(bang: readonly DongBangNhan[]): TepBaseline {
  return {
    phienBan: 1,
    dong: bang.filter((d) => d.loai !== "KHONG_CON").map((d) => ({ khoa: khoaBaseline(d.nhanChuan, d.nhom), soLead: d.soLead })),
  };
}

/** Đọc tệp baseline đã parse JSON. Hỏng/không đúng hình ⇒ null (báo cáo nói "không có baseline", KHÔNG đoán). */
export function docBaseline(raw: unknown): Map<string, number> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as { phienBan?: unknown; dong?: unknown };
  if (o.phienBan !== 1 || !Array.isArray(o.dong)) return null;
  const ra = new Map<string, number>();
  for (const d of o.dong as unknown[]) {
    if (typeof d !== "object" || d === null) return null;
    const { khoa, soLead } = d as { khoa?: unknown; soLead?: unknown };
    if (typeof khoa !== "string" || typeof soLead !== "number" || !Number.isInteger(soLead) || soLead < 0) return null;
    ra.set(khoa, soLead);
  }
  return ra;
}
