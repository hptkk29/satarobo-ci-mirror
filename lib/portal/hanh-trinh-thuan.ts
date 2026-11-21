// Cổng phụ huynh — màn "Hành trình" (artifact Hanh-trinh.dc.html): phần THUẦN.
// Chia buổi theo học phần, dựng nhãn từng dòng bài, dựng lưới lịch tháng. Không DB.
import { vnParts, vnYmd } from "@/lib/time/vn";
import { demNgayLich, nhanHocPhan } from "@/lib/portal/tong-quan-thuan";

const hai = (n: number) => String(n).padStart(2, "0");

const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;
/** `T7` — thứ rút gọn theo lịch VN. */
export const thuNgan = (iso: string): string => THU[vnParts(new Date(iso)).weekday] ?? "";
/** `31/10 21:05` — giờ VN. */
export function ngayGio(iso: string): string {
  const p = vnParts(new Date(iso));
  return `${hai(p.day)}/${hai(p.month + 1)} ${hai(p.hour)}:${hai(p.minute)}`;
}

export type TrangThaiDong = "xong" | "vang-cho-bu" | "vang" | "da-bu" | "chua-cham" | "huy" | "tiep" | "sap" | "moc";

export type BuoiHanhTrinh = {
  id: string;
  order: number;
  /** Tên bài trần — rỗng khi lớp chưa ghim giáo trình. */
  tieuDe: string;
  dateISO: string;
  nhanThu: string;
  /** `dd/MM` */
  ngayNgan: string;
  past: boolean;
  today: boolean;
  attendance: "PRESENT" | "EXCUSED" | "ABSENT" | "MAKEUP" | "FUTURE" | "UNMARKED" | "CANCELLED";
  hocPhan: string | null;
};

export type DongBai = BuoiHanhTrinh & {
  trangThai: TrangThaiDong;
  nhan: string;
  /** Buổi CUỐI của học phần — «mốc lớn, con trình bày» (xem `idBuoiMoc`). Giữ cả khi buổi đã qua để tô màu ở danh sách. */
  laMoc: boolean;
  /** Bài chưa có tên trong giáo trình ⇒ hiện chữ mờ thay vì bịa. */
  chuaCoTen: boolean;
};

const NHAN: Record<TrangThaiDong, string> = {
  xong: "Có mặt",
  "vang-cho-bu": "Vắng có phép · chờ học bù",
  vang: "Vắng",
  "da-bu": "Đã học bù",
  "chua-cham": "Chưa chấm điểm danh",
  huy: "Đã huỷ",
  tiep: "Tuần này",
  sap: "Sắp tới",
  moc: "Mốc lớn · con trình bày",
};

/**
 * Buổi «mốc lớn · con trình bày» = buổi CUỐI của mỗi học phần (buổi 12 · 24 · 36 · 48 của khoá 48 buổi).
 *
 * Chủ dự án 13/11/2026: «buổi 12 mới là buổi mốc lớn, con trình bày chứ không phải buổi 11». Bản cũ nhận theo TÊN BÀI bắt đầu bằng «Demo»
 * nên rơi vào buổi 11 «Demo cuối học phần»; buổi 12 «Báo cáo cuối học phần» mới là buổi con trình bày.
 * Buổi HUỶ không tính (không phải buổi học có thật). Khoá không chia học phần (`hocPhan` null) ⇒ không có mốc — không bịa.
 */
export function idBuoiMoc(
  buoi: { id: string; order: number; hocPhan: string | null; attendance: BuoiHanhTrinh["attendance"] }[],
): Set<string> {
  const cuoi = new Map<string, { id: string; order: number }>();
  for (const b of buoi) {
    if (!b.hocPhan || b.attendance === "CANCELLED") continue;
    const hien = cuoi.get(b.hocPhan);
    if (!hien || b.order > hien.order) cuoi.set(b.hocPhan, { id: b.id, order: b.order });
  }
  return new Set([...cuoi.values()].map((x) => x.id));
}

export function dungDongBai(
  b: BuoiHanhTrinh,
  o: { tiepTheoId: string | null; canBuIds: ReadonlySet<string>; mocIds: ReadonlySet<string>; now: Date },
): DongBai {
  const laMoc = o.mocIds.has(b.id);
  let trangThai: TrangThaiDong;
  switch (b.attendance) {
    case "CANCELLED":
      trangThai = "huy";
      break;
    case "PRESENT":
      trangThai = "xong";
      break;
    case "MAKEUP":
      trangThai = "da-bu";
      break;
    case "UNMARKED":
      trangThai = "chua-cham";
      break;
    case "EXCUSED":
    case "ABSENT":
      trangThai = o.canBuIds.has(b.id) ? "vang-cho-bu" : "vang";
      break;
    default:
      trangThai =
        b.id === o.tiepTheoId ? "tiep" : laMoc ? "moc" : "sap";
  }
  // Buổi kế tiếp mà còn xa hơn một tuần thì nói "Buổi kế tiếp", không nói "Tuần này".
  const nhan =
    trangThai === "tiep" && demNgayLich(b.dateISO, o.now) > 7 ? "Buổi kế tiếp" : NHAN[trangThai];
  return { ...b, trangThai, nhan, laMoc, chuaCoTen: b.tieuDe.trim() === "" };
}

export type HocPhanHanhTrinh = {
  ma: string;
  ten: string;
  /** `Học phần 1 · buổi 1–12` */
  tieuDe: string;
  tong: number;
  daHoc: number;
  batDau: string | null;
  ketThuc: string | null;
  /** Mở rộng thành danh sách dòng: học phần đang học hoặc đã có buổi diễn ra. */
  chiTiet: boolean;
  dong: DongBai[];
};

function khoangBuoi(ds: { order: number }[]): string {
  const so = ds.map((d) => d.order).filter((n) => n > 0);
  if (so.length === 0) return "";
  const a = Math.min(...so);
  const z = Math.max(...so);
  return a === z ? `buổi ${a}` : `buổi ${a}–${z}`;
}

/**
 * Gom dòng bài theo học phần. Khoá không chia học phần ⇒ MỘT nhóm "Lộ trình" (không bịa "Học phần 1").
 */
export function gomTheoHocPhan(dong: DongBai[]): HocPhanHanhTrinh[] {
  const sapXep = [...dong].sort((a, b) => Date.parse(a.dateISO) - Date.parse(b.dateISO));
  const nhom = new Map<string, DongBai[]>();
  for (const d of sapXep) {
    const k = d.hocPhan ?? "";
    nhom.set(k, [...(nhom.get(k) ?? []), d]);
  }
  const ds = [...nhom.entries()].sort(([a], [b]) => a.localeCompare(b, "vi", { numeric: true }));
  return ds.map(([ma, rows]) => {
    const song = rows.filter((r) => r.trangThai !== "huy");
    const daHoc = song.filter((r) => r.past).length;
    const ten = ma ? (nhanHocPhan(ma) ?? ma) : "Lộ trình";
    const kb = khoangBuoi(song);
    return {
      ma,
      ten,
      tieuDe: kb ? `${ten} · ${kb}` : ten,
      tong: song.length,
      daHoc,
      batDau: song[0]?.ngayNgan ?? null,
      ketThuc: song[song.length - 1]?.ngayNgan ?? null,
      chiTiet: daHoc > 0 || rows.some((r) => r.trangThai === "tiep") || ds.length === 1,
      dong: rows,
    };
  });
}

// ── Lưới lịch tháng ────────────────────────────────────────────────────────────

export type KieuNgay = "xong" | "tiep" | "sap" | "khong";

export type OLich = {
  key: string;
  ngay: number;
  trongThang: boolean;
  homNay: boolean;
  kieu: KieuNgay;
};

export function thangKe(y: number, m0: number, delta: -1 | 1): { y: number; m0: number } {
  const t = y * 12 + m0 + delta;
  return { y: Math.floor(t / 12), m0: ((t % 12) + 12) % 12 };
}

/**
 * 6 tuần × 7 ngày, tuần bắt đầu Thứ Hai (như artifact). Số học lịch THUẦN — không phụ thuộc TZ máy chạy;
 * chỉ ngày của BUỔI HỌC mới đổi sang lịch VN.
 */
export function dungLuoiThang(
  y: number,
  m0: number,
  buoi: { id: string; dateISO: string; past: boolean; huy: boolean }[],
  tiepTheoId: string | null,
  now: Date,
): OLich[] {
  const kieuTheoNgay = new Map<string, KieuNgay>();
  const uuTien: Record<KieuNgay, number> = { khong: 0, sap: 1, xong: 2, tiep: 3 };
  for (const b of buoi) {
    if (b.huy) continue;
    const k: KieuNgay = b.id === tiepTheoId ? "tiep" : b.past ? "xong" : "sap";
    const ngay = vnYmd(new Date(b.dateISO));
    const cu = kieuTheoNgay.get(ngay) ?? "khong";
    if (uuTien[k] > uuTien[cu]) kieuTheoNgay.set(ngay, k);
  }
  const homNay = vnYmd(now);
  const dauThang = new Date(Date.UTC(y, m0, 1));
  const lui = (dauThang.getUTCDay() + 6) % 7; // Thứ Hai = 0
  const o: OLich[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(y, m0, 1 - lui + i));
    const key = `${d.getUTCFullYear()}-${hai(d.getUTCMonth() + 1)}-${hai(d.getUTCDate())}`;
    o.push({
      key,
      ngay: d.getUTCDate(),
      trongThang: d.getUTCMonth() === m0,
      homNay: key === homNay,
      kieu: kieuTheoNgay.get(key) ?? "khong",
    });
  }
  return o;
}

export const nhanThang = (y: number, m0: number): string => `Tháng ${m0 + 1}/${y}`;

/** `vnParts` cho nhãn tháng mặc định (lịch VN). */
export function thangHienTai(now: Date): { y: number; m0: number } {
  const p = vnParts(now);
  return { y: p.year, m0: p.month };
}
