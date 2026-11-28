/**
 * Định dạng nhãn cho app theo GIỜ VIỆT NAM — máy chủ định dạng để app không phụ thuộc múi giờ của máy (cùng lý do với `nhanBuoiKeTiep`).
 * Hàm thuần: `now` do nơi gọi truyền (kiểm thử không đọc đồng hồ thật).
 */
const FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function phan(d: Date) {
  const p = FMT.formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour"), mi: g("minute") };
}

/** "dd/MM" theo giờ VN; ISO hỏng ⇒ chuỗi rỗng. */
export function nhanNgay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = phan(d);
  return `${p.d}/${p.m}`;
}

/** "Hôm nay, 09:15" · "Hôm qua, 18:00" · "dd/MM, HH:mm" (theo lịch VN). ISO hỏng ⇒ chuỗi rỗng. */
export function nhanThoiDiem(iso: string | null | undefined, now: Date): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const a = phan(d);
  const hn = phan(now);
  const homQua = phan(new Date(now.getTime() - 86_400_000));
  const gio = `${a.h}:${a.mi}`;
  if (a.y === hn.y && a.m === hn.m && a.d === hn.d) return `Hôm nay, ${gio}`;
  if (a.y === homQua.y && a.m === homQua.m && a.d === homQua.d) return `Hôm qua, ${gio}`;
  return `${a.d}/${a.m}, ${gio}`;
}
