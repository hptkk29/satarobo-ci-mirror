// lib/portal/hv-lich-thuan.ts — Cổng học sinh, màn "Lịch học của em" (artifact HV-Lich): phần THUẦN. Không DB.
import { vnParts } from "@/lib/time/vn";
import { demNgayLich } from "@/lib/portal/tong-quan-thuan";
import { nhanNgayNgan } from "@/lib/portal/hv-hom-nay-thuan";

const hai = (n: number) => String(n).padStart(2, "0");
const THU_NGAN = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

export type BuoiLich = {
  id: string;
  order: number;
  title: string;
  dateISO: string;
  past: boolean;
  attendance: "PRESENT" | "EXCUSED" | "ABSENT" | "MAKEUP" | "FUTURE" | "UNMARKED" | "CANCELLED";
};

export type ChipLich = "tiep" | "trinh-bay" | "sap" | "co-mat" | "vang" | "da-bu" | "chua-cham";

export const NHAN_CHIP: Record<ChipLich, string> = {
  tiep: "Buổi tiếp theo",
  "trinh-bay": "Em trình bày",
  sap: "Sắp tới",
  "co-mat": "Có mặt",
  vang: "Em vắng · sẽ học bù",
  "da-bu": "Đã học bù",
  "chua-cham": "Chưa chấm điểm danh",
};

export type DongLich = {
  id: string;
  n: number;
  /** Tên bài; null khi lớp chưa ghim giáo trình. */
  ten: string | null;
  /** `T7, 07/11` hoặc `T7 · 3 tuần trước`. */
  ngay: string;
  chip: ChipLich;
  tiep: boolean;
};

const tenThat = (t: string): string | null => (t.trim() === "" || t.trim() === "Buổi học" ? null : t.trim());
const laDemo = (t: string) => /^demo\b/i.test(t.trim());

function tuanTruoc(dateISO: string, now: Date): string {
  const t = Date.parse(dateISO);
  const thu = THU_NGAN[vnParts(new Date(t)).weekday];
  const ngay = -demNgayLich(dateISO, now);
  const tuan = Math.max(1, Math.round(ngay / 7));
  return ngay <= 1 ? `${thu} · hôm qua` : ngay < 7 ? `${thu} · ${ngay} ngày trước` : `${thu} · ${tuan} tuần trước`;
}

/**
 * Hai danh sách của tab: "Sắp tới" (tối đa 5 buổi chưa diễn ra, buổi tiếp theo đứng đầu) và "Đã học" (5 buổi đã diễn ra gần nhất).
 * Buổi đã huỷ không nằm trong danh sách nào — đó là buổi không diễn ra.
 */
export function dungDanhSachLich(buoi: BuoiLich[], tiepTheoId: string | null, now: Date): { sapToi: DongLich[]; daHoc: DongLich[] } {
  const song = buoi.filter((b) => b.attendance !== "CANCELLED").sort((a, b) => Date.parse(a.dateISO) - Date.parse(b.dateISO));
  const sapToi = song
    .filter((b) => !b.past)
    .slice(0, 5)
    .map((b): DongLich => {
      const tiep = b.id === tiepTheoId;
      return {
        id: b.id,
        n: b.order,
        ten: tenThat(b.title),
        ngay: nhanNgayNgan(b.dateISO),
        chip: tiep ? "tiep" : laDemo(b.title) ? "trinh-bay" : "sap",
        tiep,
      };
    });
  const daHoc = song
    .filter((b) => b.past)
    .slice(-5)
    .reverse()
    .map((b): DongLich => {
      const chip: ChipLich =
        b.attendance === "ABSENT" || b.attendance === "EXCUSED"
          ? "vang"
          : b.attendance === "MAKEUP"
            ? "da-bu"
            : b.attendance === "UNMARKED"
              ? "chua-cham"
              : "co-mat";
      return { id: b.id, n: b.order, ten: tenThat(b.title), ngay: tuanTruoc(b.dateISO, now), chip, tiep: false };
    });
  return { sapToi, daHoc };
}

export type NgayCoBuoi = { key: string; n: number; ten: string | null; nhanNgay: string; ghi: string };

/** `2026-11-07` ⇒ `T7, 07/11` (số học lịch, không phụ thuộc múi giờ máy). */
function nhanTuKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const thu = THU_NGAN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${thu}, ${hai(d)}/${hai(m)}`;
}

/**
 * Chi tiết khi bấm một ngày có buổi: `Buổi n · tên` + dòng ghi. Mỗi ngày có thể có nhiều buổi (con học 2 lớp) — lấy buổi sớm nhất;
 * chi tiết đầy đủ nằm ở danh sách bên cạnh.
 */
export function chiTietCacNgay(buoi: BuoiLich[], tiepTheoId: string | null, gioTiep: string | null): Record<string, NgayCoBuoi> {
  const ra: Record<string, NgayCoBuoi> = {};
  for (const b of [...buoi].sort((x, y) => Date.parse(x.dateISO) - Date.parse(y.dateISO))) {
    if (b.attendance === "CANCELLED") continue;
    const p = vnParts(new Date(b.dateISO));
    const key = `${p.year}-${hai(p.month + 1)}-${hai(p.day)}`;
    if (ra[key]) continue;
    let ghi: string;
    if (b.id === tiepTheoId) ghi = "Buổi tiếp theo của em";
    else if (b.attendance === "ABSENT" || b.attendance === "EXCUSED") ghi = "Em vắng buổi này · sẽ học bù";
    else if (b.attendance === "MAKEUP") ghi = "Em đã học bù buổi này";
    else if (b.attendance === "UNMARKED") ghi = "Buổi đã diễn ra · thầy cô chưa điểm danh";
    else if (b.past) ghi = "Em đã học buổi này · có mặt";
    else ghi = "Sắp tới";
    ra[key] = {
      key,
      n: b.order,
      ten: tenThat(b.title),
      nhanNgay: b.id === tiepTheoId && gioTiep ? `${nhanTuKey(key)} · ${gioTiep}` : nhanTuKey(key),
      ghi,
    };
  }
  return ra;
}

/** Dòng "Em học Thứ Bảy · 20:00 – 21:00 · P302" dưới tiêu đề. */
export function dongLichHoc(i: { thuDayDu: string | null; gio: string | null; phong: string | null }): string | null {
  const phan = [[i.thuDayDu, i.gio].filter(Boolean).join(" · "), i.phong].filter((x): x is string => !!x && x.length > 0);
  return phan.length ? `Em học ${phan.join(" · ")}` : null;
}
