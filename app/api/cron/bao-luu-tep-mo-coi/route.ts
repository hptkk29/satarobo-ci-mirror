import { withCron } from "@/lib/cron/handler";
import { donTepBaoLuuMoCoi } from "@/lib/bao-luu/don-tep-mo-coi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Bảo lưu (Phiên 7) — tệp đơn / minh chứng đã PUT lên kho bảo lưu mà không hồ sơ nào lưu. Hằng tuần, Chủ nhật 04:30 giờ VN
// (`deploy/crontab.example`; `vercel.json` UTC `30 21 * * 6`).
//
// ⚠️ MẶC ĐỊNH CHỈ BÁO CÁO: xoá thật chỉ khi env `BAO_LUU_DON_TEP_XOA=1` (xem `lib/bao-luu/don-tep-mo-coi.ts`, CAN-QUYET K15).
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc. Kho chưa cấu hình ⇒ 200 kèm `boQua`.
export const GET = withCron("bao-luu-tep-mo-coi", async () => ({
  ok: true,
  data: await donTepBaoLuuMoCoi(new Date(), { choPhepXoa: process.env.BAO_LUU_DON_TEP_XOA === "1" }),
}));
