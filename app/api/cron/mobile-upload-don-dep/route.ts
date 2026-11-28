import { withCron } from "@/lib/cron/handler";
import { donVeTaiLenBoDo } from "@/lib/mobile-api/dich-vu/don-ve-tai-len";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// SEC-07 (V8.45) — dọn tệp tải lên BỎ DỞ của kho riêng (vé ISSUED hết hạn > 1 giờ, UPLOADED > 7 ngày chưa gắn). Hằng ngày 03:30 giờ VN
// (`deploy/crontab.example`; `vercel.json` UTC `30 20 * * *`). ⚠️ MẶC ĐỊNH CHỈ BÁO CÁO: xoá thật chỉ khi env `MOBILE_UPLOAD_DON_XOA=1` (xem `lib/mobile-api/dich-vu/don-ve-tai-len.ts`).
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc. Kho chưa cấu hình ⇒ 200 kèm `boQua`.
export const GET = withCron("mobile-upload-don-dep", async () => ({
  ok: true,
  data: await donVeTaiLenBoDo(new Date(), { choPhepXoa: process.env.MOBILE_UPLOAD_DON_XOA === "1" }),
}));
