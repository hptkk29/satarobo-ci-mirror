// Phần THUẦN của "Dữ liệu của tôi": định dạng thời gian, mô tả "đã đọc / xem" từng bài, dòng tổng. Không import React/DB.
//
// ⚠️ Chỉ nói thứ ĐO ĐƯỢC: bài video thiếu `durationSec` thì không nói "% video"; không bịa phần trăm.

/** 2520 → "42 phút"; 4680 → "1 giờ 18 phút"; 45 → "45 giây"; 0 → "0 giây". */
export function dinhDangThoiGian(giay: number): string {
  const g = Math.max(0, Math.floor(giay));
  if (g < 60) return `${g} giây`;
  const gio = Math.floor(g / 3600);
  const phut = Math.floor((g % 3600) / 60);
  if (gio === 0) return `${phut} phút`;
  return phut === 0 ? `${gio} giờ` : `${gio} giờ ${phut} phút`;
}

export type DongTienDoRut = {
  kind: string;
  durationSec: number | null;
  coveredSec: number;
  readSeconds: number;
  scrollMaxPct: number;
};

/** "33% video" · "đọc 3 phút · cuộn 80%" · "—" khi chưa có số đo. */
export function moTaDaDocXem(r: DongTienDoRut): string {
  if (r.kind === "VIDEO") {
    if (!r.durationSec || r.durationSec <= 0) return r.coveredSec > 0 ? `đã xem ${dinhDangThoiGian(r.coveredSec)}` : "—";
    const pct = Math.min(100, Math.round((r.coveredSec / r.durationSec) * 100));
    return `${pct}% video`;
  }
  if (r.readSeconds > 0 || r.scrollMaxPct > 0) return `đọc ${dinhDangThoiGian(r.readSeconds)} · cuộn ${r.scrollMaxPct}%`;
  return "—";
}

/**
 * Dòng tổng: "Đã đọc 42 phút · Đã xem 1 giờ 18 phút". `giayXem` cộng `coveredSec` (đoạn video ĐÃ XEM thật), không cộng thời gian
 * mở trang. `null` khi cả hai bằng 0 (không in dòng tổng rỗng).
 */
export function dongTongThoiGian(rows: readonly Pick<DongTienDoRut, "coveredSec" | "readSeconds" | "kind">[]): string | null {
  let doc = 0;
  let xem = 0;
  for (const r of rows) {
    doc += r.readSeconds;
    if (r.kind === "VIDEO") xem += r.coveredSec;
  }
  if (doc === 0 && xem === 0) return null;
  return `Đã đọc ${dinhDangThoiGian(doc)} · Đã xem ${dinhDangThoiGian(xem)}`;
}
