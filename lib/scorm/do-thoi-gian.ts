// lib/scorm/do-thoi-gian.ts — QUAN SÁT lượt mở NGUỘI của giáo trình SCORM (25/10/2026, vòng 2).
//
// Vì sao có: smoke PROD 24/10 cho thấy lượt mở nguội đầu tiên có lúc 7,9 s, nhưng 3,4 s trong đó trôi qua TRƯỚC KHI viewer bắt đầu
// (mốc `scorm:open` nằm ở lúc hydrate, trước mọi request asset) — tức không thể là lỗi đệm SCORM. Không có số đo phía máy chủ nên không tách được
// "trang play (DB/auth) · nạp module lần đầu của tiến trình · trình duyệt" khỏi "route asset (đĩa/R2)". Tệp này cấp hai thứ, cả hai CHỈ là con số thời gian
// và nhãn nguồn cố định — KHÔNG chứa khoá R2, prefix, mã gói, vé, tên người dùng:
//   1. `Server-Timing` cho route asset: `cache;desc=<nguồn>, pre;dur=…, src;dur=…, total;dur=…` (trình duyệt đọc qua `PerformanceResourceTiming.serverTiming`).
//   2. Chuỗi `data-scorm-ssr` cho trang play (RSC không đặt được header phản hồi): `auth=…;actor=…;batch=…;gate=…;total=…;n=<lần render thứ mấy của tiến trình>;up=<giây
//      tiến trình đã sống>`. `n=1` là lượt đầu tiên của tiến trình Node này — phép thử trực tiếp cho giả thuyết "nạp module lần đầu".
//
// Thuần (không import server-only) để test trong vitest không cần dựng gì.
import { chungTienTrinh } from "@/lib/scorm/chung-tien-trinh";

/** Byte của phản hồi asset đến từ đâu. Tập GIÁ TRỊ CỐ ĐỊNH — không bao giờ nhét chuỗi tự do (khoá R2…) vào header. */
export type NguonByte =
  /** Đệm đĩa (đã có sẵn). */
  | "disk"
  /** Trượt đệm; request NÀY là bên mở lượt tải R2 (single-flight). */
  | "r2-leader"
  /** Trượt đệm; request NÀY chờ lượt tải R2 do request khác mở (gộp). */
  | "r2-coalesced"
  /** R2 truyền dòng (tệp lớn, Range, hoặc đệm tắt). */
  | "r2-stream"
  /** HEAD tới R2 (không tải thân). */
  | "r2-head";

export type DoThoiGian = {
  nguon?: NguonByte;
  /** ms từ đầu request tới khi xong vé + phiên + mã gói + đường dẫn (trước khi chạm đệm/R2). */
  msTruoc?: number;
  /** ms để có byte/header từ NGUỒN (đĩa: đọc meta + mở fd; R2: tới header, hoặc tới khi có đủ thân với tệp nhỏ). */
  msNguon?: number;
  /** NỘI BỘ (không in ra header): mốc `performance.now()` lúc bắt đầu chạm nguồn, để `ghiNguon` tính `msNguon`. */
  batDauNguon?: number;
};

const ok = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const lamTron1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Giá trị header `Server-Timing`. null khi chưa biết nguồn (phản hồi lỗi/chặn trước hàng rào KHÔNG được mang header này).
 * `total` = từ đầu request tới lúc dựng xong phản hồi — KHÔNG gồm thời gian truyền thân dòng (video/Range) tới client.
 */
export function tinhServerTiming(tm: DoThoiGian, tongMs: number): string | null {
  if (!tm.nguon) return null;
  const p = [`cache;desc=${tm.nguon}`];
  if (ok(tm.msTruoc)) p.push(`pre;dur=${lamTron1(tm.msTruoc)}`);
  if (ok(tm.msNguon)) p.push(`src;dur=${lamTron1(tm.msNguon)}`);
  if (ok(tongMs)) p.push(`total;dur=${lamTron1(tongMs)}`);
  return p.join(", ");
}

export type MocSsr = "auth" | "actor" | "batch" | "gate";

/** Đếm số lần trang play render trong tiến trình này (chung giữa admin/GV vì cùng bộ nhớ tiến trình). */
const demRender = chungTienTrinh("do-thoi-gian.render", () => ({ n: 0 }));

/**
 * Đồng hồ cho trang play: gọi `moc(ten)` ngay SAU mỗi chặng (mỗi chặng được tính từ mốc trước), `chot()` ngay trước `return` để lấy chuỗi.
 * Chặng bị bỏ qua (vd GV vào bằng đường khác) thì không in. Chỉ đo, không đổi hành vi trang.
 */
export function dongHoSsr(now: () => number = () => performance.now(), upGiay: () => number = () => process.uptime()) {
  const t0 = now();
  let truoc = t0;
  const pha: Partial<Record<MocSsr, number>> = {};
  return {
    moc(ten: MocSsr): void {
      const t = now();
      pha[ten] = t - truoc;
      truoc = t;
    },
    chot(): string {
      demRender.n++;
      const ms = (n: number | undefined) => (ok(n) ? String(Math.round(n)) : "-");
      return [
        `auth=${ms(pha.auth)}`,
        `actor=${ms(pha.actor)}`,
        `batch=${ms(pha.batch)}`,
        `gate=${ms(pha.gate)}`,
        `total=${ms(now() - t0)}`,
        `n=${demRender.n}`,
        `up=${Math.round(upGiay())}`,
      ].join(";");
    },
  };
}

/** Chỉ cho test: đặt lại bộ đếm render. */
export function _datLaiDemRender(): void {
  demRender.n = 0;
}
