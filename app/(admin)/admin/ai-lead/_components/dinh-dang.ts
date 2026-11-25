// Định dạng thời gian cho màn AI Lead. THUẦN, TẤT ĐỊNH (múi giờ cố định) — render server và client ra cùng chuỗi, không lệch hydration.
const DINH_DANG = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function gioVn(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(x.getTime()) ? "—" : DINH_DANG.format(x);
}

/** "42 giây" · "5 phút" · "3 giờ" · "2 ngày" — làm tròn xuống, không bao giờ âm. */
export function tuoiChu(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} giây`;
  const p = Math.floor(s / 60);
  if (p < 60) return `${p} phút`;
  const g = Math.floor(p / 60);
  if (g < 48) return `${g} giờ`;
  return `${Math.floor(g / 24)} ngày`;
}

/** Rút gọn mã dài để hiện (giữ đủ để nhận ra): `abcd…wxyz`. */
export function rutGon(s: string | null | undefined, giu = 7): string {
  if (!s) return "—";
  return s.length <= giu * 2 + 1 ? s : `${s.slice(0, giu)}…${s.slice(-giu)}`;
}
