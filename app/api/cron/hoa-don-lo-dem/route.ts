import { withCron } from "@/lib/cron/handler";
import { chayLoDemCuaCron } from "@/lib/finance/hoa-don/xuat-lo-dem/chay-lo-dem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tối đa ~150 hoá đơn × (1 giao dịch + 1 lượt gọi nhà cung cấp + tải tệp) — chừa dư để lượt sau của chính nó không chồng lên. */
export const maxDuration = 300;

/** Dừng nhận lần thu mới sau ngần này: chừa ~60 giây cho bản đang gửi dở + ghi nhật ký tổng kết. */
const NGAN_SACH_MS = 230_000;

// Hoá đơn điện tử · LÔ 23H (BGĐ yêu cầu 03/11/2026) — khoản thu mà phụ huynh KHÔNG khai thông tin xuất hoá đơn thì 23h đêm xuất hoá đơn «bán cho người tiêu dùng»,
// mỗi lần thu một hoá đơn (tên người mua = tên học viên). Chạy `0 23 * * *` giờ VN (`deploy/crontab.example`; `vercel.json` `0 16 * * *` theo UTC).
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc.
// Cả hai công tắc `hoaDon.loDemChayThu` / `hoaDon.loDemTuDong` TẮT (mặc định) ⇒ 200 `{ ok: true, data: null }`, KHÔNG đọc bảng nào của Hub.
// `loDemChayThu` bật ⇒ chỉ lập báo cáo (nhật ký `HoaDonLoDem`), không gọi nhà cung cấp. `loDemTuDong` bật ⇒ phát hành thật. Luật chọn lần thu: `chon-lan-thu.ts`.
export const GET = withCron("hoa-don-lo-dem", async () => {
  const batDau = Date.now();
  const kq = await chayLoDemCuaCron({ now: new Date(), conThoiGian: () => Date.now() - batDau < NGAN_SACH_MS });
  return { ok: true, data: kq };
});
