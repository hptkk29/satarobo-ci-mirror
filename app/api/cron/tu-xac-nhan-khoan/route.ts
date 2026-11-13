import { withCron } from "@/lib/cron/handler";
import { chayTuXacNhanKhoanNganHang } from "@/lib/finance/tu-xac-nhan-ngan-hang";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Tự xác nhận khoản thu ĐÃ VỀ NGÂN HÀNG (chủ dự án 08/11/2026) — chạy `*/5 * * * *` (`deploy/crontab.example`; `vercel.json` cùng lịch).
// Công tắc `payment.tuXacNhanNganHang` TẮT mặc định (bật được từng cơ sở): tắt ⇒ lượt chạy chỉ ĐẾM, không xác nhận khoản nào. Luật ở `lib/finance/tu-xac-nhan-ngan-hang.ts`.
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc.
export const GET = withCron("tu-xac-nhan-khoan", async () => {
  const kq = await chayTuXacNhanKhoanNganHang({ now: new Date() });
  return { ok: true, data: kq };
});
