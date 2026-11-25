// lib/finance/hoa-don/nhac-ke-toan.ts — CHUÔNG NHẮC KẾ TOÁN hằng ngày: lần thu chờ xuất hoá đơn. THUẦN.
//
// PLAN Q-mở 7 ("báo chuông kế toán mỗi ngày — dùng lại cron `payment-reconcile`") để mặc định "có".
// Người chạy (tra DB, gửi) là `nhac-ke-toan-db.ts`; ở đây chỉ hai quyết định, kiểm được không cần DB:
//   1. ĐẾM — dòng nào vào số, chia theo cơ sở của đơn;
//   2. CHIA — ai nhận bản nào: kế toán cơ sở nhận bản CƠ SỞ MÌNH, kế toán Hội sở (phạm vi ALL) nhận MỘT
//      bản TỔNG — không nhận thêm bản theo từng cơ sở (một việc, một tiếng chuông).
//
// ⚠️ "Dòng nào là chờ xuất" KHÔNG viết lại ở đây: dòng đến từ `napHangChoHoaDon` — cùng loader, cùng
// `dungDongHangCho` của màn — nên số trên chuông khớp số trên tab "Chờ xuất" mà người nhận bấm vào.
// ⚠️ Nội dung chỉ mang SỐ LẦN THU, không số tiền (panel chuông mở giữa chỗ đông người — `pii.ts`), và
// đếm in số trần: `toLocaleString` ra "1.234" thì bộ soi tiền đọc thành số tiền.

import type { DongHangCho, NganHangCho } from "./dong-hang-cho";

/** Tiền tố `dedupeKey` — khai ở `lib/notifications/catalog.ts`. Khoá: `<tiền tố><centerId|tong>:<ngày>`. */
export const TIEN_TO_NHAC = "hoa-don.cho-xuat:" as const;

/** Mở thẳng ngăn "Chờ xuất" của màn (`?ngan=` — `chonNgan` đọc nó). */
export const HREF_NHAC = "/payments/hoa-don?ngan=cho" as const;

/**
 * Ngăn được đếm. CHỈ ngăn `cho` (nhãn "Chờ xuất"): lệch số / nghi trùng, đã tải tệp, cần điều chỉnh
 * là việc KHÁC loại — gộp vào một con số là chuông nói một đằng, tab mở ra nói một nẻo. Muốn nhắc thêm
 * loại nào thì thêm ngăn vào đây (và câu chữ ở `dungThongBaoNhac` phải đổi theo).
 */
export const NGAN_NHAC: readonly NganHangCho[] = ["cho"];

export type DemCoSo = { centerId: string; ten: string; soLanThu: number };

/**
 * Đếm dòng thuộc `NGAN_NHAC` theo cơ sở CỦA ĐƠN. `coSoCuaDon`: orderId → centerId (người gọi tra một
 * câu). Đơn không tra được cơ sở ⇒ bỏ, không đoán theo tên/mã hiển thị.
 */
export function demChoTheoCoSo(
  dong: readonly Pick<DongHangCho, "ngan" | "orderId" | "coSo">[],
  coSoCuaDon: ReadonlyMap<string, string>,
): DemCoSo[] {
  const theoCoSo = new Map<string, DemCoSo>();
  for (const d of dong) {
    if (!NGAN_NHAC.includes(d.ngan)) continue;
    const centerId = coSoCuaDon.get(d.orderId);
    if (!centerId) continue;
    const cu = theoCoSo.get(centerId);
    if (cu) cu.soLanThu += 1;
    else theoCoSo.set(centerId, { centerId, ten: d.coSo.ten, soLanThu: 1 });
  }
  return [...theoCoSo.values()].sort((a, b) => a.ten.localeCompare(b.ten, "vi") || a.centerId.localeCompare(b.centerId));
}

/** Người nhận + phạm vi kế toán của họ (`actionCenterScope(actor, "payments:confirm")`). */
export type NguoiNhanNhac = { userId: string; phamVi: "ALL" | readonly string[] };

export type ThongBaoNhac = { userIds: string[]; dedupeKey: string; title: string; body: string; href: string };

const TIEU_DE = "Lần thu chờ xuất hoá đơn";

export function dungThongBaoNhac(input: {
  dem: readonly DemCoSo[];
  nguoiNhan: readonly NguoiNhanNhac[];
  /** `YYYY-MM-DD` — khoá chống trùng theo ngày (mỗi người tối đa một bản/cơ sở/ngày). */
  ngay: string;
}): ThongBaoNhac[] {
  const coViec = input.dem.filter((d) => d.soLanThu > 0);
  if (coViec.length === 0) return [];
  const ra: ThongBaoNhac[] = [];

  for (const d of coViec) {
    const userIds = [
      ...new Set(input.nguoiNhan.filter((n) => n.phamVi !== "ALL" && n.phamVi.includes(d.centerId)).map((n) => n.userId)),
    ];
    if (userIds.length === 0) continue;
    ra.push({
      userIds,
      dedupeKey: `${TIEN_TO_NHAC}${d.centerId}:${input.ngay}`,
      title: TIEU_DE,
      body: `${d.soLanThu} lần thu tại ${d.ten} đang chờ xuất hoá đơn.`,
      href: HREF_NHAC,
    });
  }

  const hoiSo = [...new Set(input.nguoiNhan.filter((n) => n.phamVi === "ALL").map((n) => n.userId))];
  if (hoiSo.length > 0) {
    const tong = coViec.reduce((s, d) => s + d.soLanThu, 0);
    ra.push({
      userIds: hoiSo,
      dedupeKey: `${TIEN_TO_NHAC}tong:${input.ngay}`,
      title: TIEU_DE,
      body: `${tong} lần thu đang chờ xuất hoá đơn — ${coViec.map((d) => `${d.ten}: ${d.soLanThu}`).join(" · ")}.`,
      href: HREF_NHAC,
    });
  }
  return ra;
}
