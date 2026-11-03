import { withCron } from "@/lib/cron/handler";
import { layCongHoaDon } from "@/lib/finance/hoa-don/cong-phat-hanh";
import { docSlaKhongRoPhut } from "@/lib/finance/hoa-don/feature";
import { doiSoatPhatHanhTreo } from "@/lib/finance/hoa-don/phat-hanh-misa";
import { chayQuetBong } from "@/lib/finance/hoa-don/quet-nghia-vu-db";
import { chayDonDepNguoiMua } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-quet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trần thời gian một lượt: tối đa 50 bản, mỗi bản ≤ 1 lượt tra + 1 lượt gửi lại + 2 lượt tải tệp MISA.
 * Tiền lệ khai `maxDuration`: `app/api/cron/hoa-don-tep-mo-coi/route.ts`.
 */
export const maxDuration = 60;

/**
 * Ngân sách của CẢ lượt cho pha P2 (scanner bóng): hết `NGAN_SACH_MS` kể từ lúc cron bắt đầu thì scanner dừng SAU đơn hiện tại. P1 chạy trước và ăn
 * bao nhiêu thì P2 chỉ còn phần còn lại; chừa ~20 giây dưới `maxDuration` cho việc ghi nhịp tim + chuông + trả lời.
 */
const NGAN_SACH_MS = 40_000;

// Hoá đơn điện tử · bước 1 MISA (docs/ke-toan-hoa-don/PLAN.md "Bước 1 — Phát hành qua MISA") — đối soát bản
// ĐANG PHÁT HÀNH bị treo (MISA trả lời không rõ, máy chủ chết giữa chừng, tải tệp hỏng): `traCuu(refId)` →
// hoàn tất / gửi lại CÙNG refId (chỉ khi MISA nói chưa có và lượt trước đã > 10 phút) / tải tệp còn thiếu.
// 10 phút một lần (`deploy/crontab.example`; `vercel.json` `*/10 * * * *`).
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc.
// Chưa cấu hình cổng MISA ⇒ 200 kèm `boQua`, không ném. KHÔNG hỏi công tắc `hoaDon.misaPhatHanh`: tắt nút
// không được bỏ rơi những hoá đơn đã gửi sang MISA — chúng vẫn phải được ghi nhận.
//
// ── INVOICE HUB S8 (01/11/2026): THÊM pha P2 — scanner bóng nghĩa vụ hoá đơn (ADR §7.2, TD-04: mở rộng cron này, KHÔNG cron mới).
//   P1 chạy TRƯỚC và KHÔNG ĐỔI. P2 hỏi công tắc `hoaDon.hubQuet` (TẮT mặc định) ở BÊN TRONG `chayQuetBong`: tắt ⇒ trả null ⇒ phản hồi giữ nguyên từng
//   chữ. Bật ⇒ kết quả nằm dưới khoá `bong` (khoá `quet` đã là số bản P1 đã tra). Scanner chỉ ghi bảng chiếu + ngoại lệ — không gọi MISA, không phát hành.
//   Một pha lỗi KHÔNG làm hỏng pha kia: P2 tự bắt mọi lỗi (trả nhãn ngắn); P1 ném thì P2 vẫn chạy rồi lỗi của P1 được ném lại y như trước S8.
//
// ── INVOICE HUB S11 (02/11/2026): THÊM pha P3 — dọn yêu cầu thông tin người mua (hết hạn + xoá dữ liệu quá thời hạn giữ). Cờ `hoaDon.hubNguoiMua` + cơ sở thí điểm hỏi BÊN TRONG
//   `chayDonDepNguoiMua`: tắt ⇒ null ⇒ phản hồi giữ nguyên từng chữ. Bật ⇒ kết quả dưới khoá `nguoiMua`. Tự bắt mọi lỗi; không phụ thuộc P1/P2.
export const GET = withCron("hoa-don-misa-doi-soat", async () => {
  const batDau = Date.now();
  let loiP1: unknown = null;
  let doiSoat: Awaited<ReturnType<typeof doiSoatPhatHanhTreo>> | null = null;
  try {
    doiSoat = await doiSoatPhatHanhTreo({ cong: layCongHoaDon(), congTheo: layCongHoaDon, now: new Date(), slaKhongRoPhut: await docSlaKhongRoPhut() });
  } catch (e) {
    loiP1 = e;
  }
  const bong = await chayQuetBong({ now: new Date(), conThoiGian: () => Date.now() - batDau < NGAN_SACH_MS });
  const nguoiMua = await chayDonDepNguoiMua({ now: new Date() });
  if (doiSoat === null) throw loiP1;
  return { ok: true, data: { ...doiSoat, ...(bong === null ? {} : { bong }), ...(nguoiMua === null ? {} : { nguoiMua }) } };
});
