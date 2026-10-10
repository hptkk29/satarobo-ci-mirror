import { withCron } from "@/lib/cron/handler";
import { layCongHoaDon } from "@/lib/finance/hoa-don/cong-phat-hanh";
import { doiSoatPhatHanhTreo } from "@/lib/finance/hoa-don/phat-hanh-misa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trần thời gian một lượt: tối đa 50 bản, mỗi bản ≤ 1 lượt tra + 1 lượt gửi lại + 2 lượt tải tệp MISA.
 * Tiền lệ khai `maxDuration`: `app/api/cron/hoa-don-tep-mo-coi/route.ts`.
 */
export const maxDuration = 60;

// Hoá đơn điện tử · bước 1 MISA (docs/ke-toan-hoa-don/PLAN.md "Bước 1 — Phát hành qua MISA") — đối soát bản
// ĐANG PHÁT HÀNH bị treo (MISA trả lời không rõ, máy chủ chết giữa chừng, tải tệp hỏng): `traCuu(refId)` →
// hoàn tất / gửi lại CÙNG refId (chỉ khi MISA nói chưa có và lượt trước đã > 10 phút) / tải tệp còn thiếu.
// 10 phút một lần (`deploy/crontab.example`; `vercel.json` `*/10 * * * *`).
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc.
// Chưa cấu hình cổng MISA ⇒ 200 kèm `boQua`, không ném. KHÔNG hỏi công tắc `hoaDon.misaPhatHanh`: tắt nút
// không được bỏ rơi những hoá đơn đã gửi sang MISA — chúng vẫn phải được ghi nhận.
export const GET = withCron("hoa-don-misa-doi-soat", async () => ({
  ok: true,
  data: await doiSoatPhatHanhTreo({ cong: layCongHoaDon(), now: new Date() }),
}));
