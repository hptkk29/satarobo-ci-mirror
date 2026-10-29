// lib/cham-cong/ghi-luot-tuan-tu.ts — H2 · GHI MỘT LƯỢT CHẤM CÔNG TUẦN TỰ theo (người × ngày). Đường ghi DUY NHẤT của nút "Chấm công"
// (QR `recordCheckin` và công tác `chamCongTac`).
//
// ĐUA CŨ (đo bằng `[RACE-*]`, tests/cham-cong/cham-cong-dua.spec.ts): `suyHuongHomNay` đọc lượt trong ngày rồi `recordTimeLog` ghi —
// hai lệnh rời, không giao dịch, không khoá. Hai lượt bấm gần như cùng lúc (hai vé hợp lệ, hai máy) cùng đọc "chưa có VÀO mở" ⇒ cùng
// ghi VÀO, KHÔNG lượt nào mang cờ trùng ⇒ hai lượt VÀO "hợp lệ". Khoá ở client (vô hiệu nút, debounce) không phải cổng: endpoint gọi
// thẳng được.
//
// NAY: một giao dịch Postgres giữ khoá tư vấn `pg_advisory_xact_lock(hashtext('cham-cong:<userId>:<ngày VN>'))`, rồi TRONG khoá:
//   1. lấy mốc `now` (SAU khi giữ khoá — lượt đến sau không thể mang mốc sớm hơn lượt đã ghi);
//   2. đọc lại lượt trong ngày + suy hướng (`suyHuongHomNay`, cùng luật bấm trùng `shift.duplicateTapMinutes`);
//   3. ghi ĐÚNG một lượt (`recordTimeLog`, cờ trùng tính trên cùng lượt vừa đọc);
//   4. nhả khoá khi giao dịch commit.
// Dự đoán trên trang vẫn chỉ là GỢI Ý; kết quả trả về (hướng · trùng · nhãn buổi · mốc) là của lượt ĐÃ GHI.
//
// Ngoài khoá (cố ý): tiêu vé, kiểm thiết bị, ngữ cảnh hiển thị sau ghi, tính lại ngày (hàng đợi). Trong khoá chỉ những câu cần nhìn thấy
// lượt của chính người đó — giữ khoá ngắn (trần giao dịch Prisma 5s mặc định; nâng lên 20s ở đây, chờ khoá tối đa 8s).
//
// Giới hạn đã biết: cùng MỘT người bắn ≥ số kết nối của pool lượt song song thì các lượt chờ khoá giữ kết nối; `lock_timeout` 8s cắt
// chúng trước `pool_timeout` 10s của Prisma ⇒ lượt chờ báo lỗi "bấm lại", không treo, không hỏng dữ liệu.
import { db } from "@/lib/db";
import { vnYmd } from "@/lib/time/vn";
import { recordTimeLog, type RecordTimeLogInput, type RecordTimeLogResult } from "./timelog";
import { suyHuongHomNay, type SuyHuongHomNay } from "./suy-huong-db";

/** Khoá tư vấn của MỘT dòng lượt chấm công (người × ngày VN) — tiền tố riêng, theo nếp `hashtext('<tiền tố>:…')` của repo. */
export const khoaChamCong = (userId: string, ngay: string) => `cham-cong:${userId}:${ngay}`;

export type GhiLuotTuanTuKetQua = { now: Date; suy: SuyHuongHomNay; r: RecordTimeLogResult };

export async function ghiLuotTuanTu(
  p: Omit<RecordTimeLogInput, "direction" | "client" | "now"> & {
    /** CHỈ cho test (luật 19). Đường thật để trống ⇒ mốc lấy SAU khi giữ khoá. */
    now?: Date;
  },
): Promise<GhiLuotTuanTuKetQua> {
  const ngay = vnYmd(p.now ?? new Date());
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '8s'`;
      // `$executeRaw`, KHÔNG `$queryRaw`: `pg_advisory_xact_lock` trả `void`, Prisma không đọc được cột kiểu đó.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${khoaChamCong(p.userId, ngay)}))`;
      const now = p.now ?? new Date();
      const suy = await suyHuongHomNay({ userId: p.userId, workLocationId: p.workLocationId, now, client: tx });
      const r = await recordTimeLog({ ...p, direction: suy.huong, now, client: tx });
      return { now, suy, r };
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}
