import { withCron } from "@/lib/cron/handler";
import { layCongHoaDon } from "@/lib/finance/hoa-don/cong-phat-hanh";
import { docSlaKhongRoPhut } from "@/lib/finance/hoa-don/feature";
import { layCongHsmChoPhapNhan } from "@/lib/finance/hoa-don/ket-noi/cong-theo-phap-nhan";
import { kyDangTamDung, lyDoKhongGuiDuocHoaDonHeThong } from "@/lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db";
import { chayKyUsbCuaCron } from "@/lib/finance/hoa-don/ky-usb/quet-tao-lenh";
import { doiSoatPhatHanhTreo } from "@/lib/finance/hoa-don/phat-hanh-misa";
import { chayQuetBong } from "@/lib/finance/hoa-don/quet-nghia-vu-db";
import { chayDonDepNguoiMua } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-quet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trần thời gian một lượt: tối đa 50 bản, mỗi bản ≤ 1 lượt tra + 1 lượt gửi lại + 2 lượt tải tệp MISA.
 * Tiền lệ khai `maxDuration`: `app/api/cron/hoa-don-tep-mo-coi/route.ts`.
 */
export const maxDuration = 120;

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
//
// ── [ĐÃ GỠ 09/11/2026 — BGĐ đổi: không còn «tự xuất sau n giờ»; xuất liền = nút «Xuất liền» của Sale, còn lại đi cùng lô cuối ngày 23h30] (từng là) pha P4 — THÊM pha P4 — phụ huynh đã điền form QR quá n giờ (`hoaDon.tuXuatSauGio`, mặc định 2) thì PHÁT HÀNH hoá đơn cho các lần thu đang chờ xuất của đơn.
//   Công tắc `hoaDon.tuXuatBat` (TẮT mặc định) hỏi BÊN TRONG `chayTuXuatCuaCron`: tắt ⇒ null ⇒ phản hồi giữ nguyên từng chữ. Bật ⇒ kết quả dưới khoá `tuXuat`. Chạy SAU P1 (đối soát bản treo
//   trước khi phát hành thêm), tự bắt mọi lỗi, trần 10 hoá đơn/lượt. `maxDuration` 60 → 120 cho một lượt phát hành có thể gọi nhà cung cấp nhiều lần.
export const GET = withCron("hoa-don-misa-doi-soat", async () => {
  const batDau = Date.now();
  let loiP1: unknown = null;
  let doiSoat: Awaited<ReturnType<typeof doiSoatPhatHanhTreo>> | null = null;
  try {
    doiSoat = await doiSoatPhatHanhTreo({
      cong: layCongHoaDon(),
      congTheo: layCongHoaDon,
      // Cổng theo PHÁP NHÂN đã chụp trên bản (hub/13). Bản cũ chưa có mã pháp nhân ⇒ `congTheo` (cổng env của nhà cung cấp) như trước.
      // Pháp nhân ký USB / chưa cấu hình ⇒ `null` ⇒ bản đó bị BỎ QUA (không đẩy sang cổng khác).
      congTheoPhapNhan: async (ncc, phapNhanMa) => {
        // «TRA_CUU»: đối soát bản đã gửi KHÔNG bị chặn khi pháp nhân tạm dừng ký; việc GỬI LẠI thì bị chặn qua `khoaGui` bên dưới.
        const kq = await layCongHsmChoPhapNhan(phapNhanMa, "TRA_CUU");
        // [05/11/2026] Bản đã gửi qua nhà cung cấp X thì CHỈ hỏi nhà cung cấp X. Pháp nhân đã đổi sang Y ⇒ bỏ qua bản đó (fail-closed; cổng đổi nhà cung cấp vốn đã chặn khi còn bản đang phát hành dở).
        return kq.ok && kq.nhaCungCap === ncc ? kq.cong : null;
      },
      khoaGui: async (phapNhanMa) => (await kyDangTamDung(phapNhanMa)).tamDung,
      // Bản do HỆ THỐNG tạo mà chưa từng gửi: kiểm lại chính sách HIỆN HÀNH (hạn mức mỗi hoá đơn, tạm dừng) trước khi cron gửi. Bản đã gửi rồi thì không hỏi.
      chanChuaGui: lyDoKhongGuiDuocHoaDonHeThong,
      now: new Date(),
      slaKhongRoPhut: await docSlaKhongRoPhut(),
    });
  } catch (e) {
    loiP1 = e;
  }
  const bong = await chayQuetBong({ now: new Date(), conThoiGian: () => Date.now() - batDau < NGAN_SACH_MS });
  const nguoiMua = await chayDonDepNguoiMua({ now: new Date() });
  // P5 (BGĐ 04/11/2026): pháp nhân KÝ USB — tạo lệnh chờ ký (người yêu cầu = hệ thống) + báo kế toán. Cờ `hoaDon.kyUsb` TẮT ⇒ null ⇒ phản hồi giữ nguyên từng chữ. Tự bắt mọi lỗi.
  const kyUsb = await chayKyUsbCuaCron(new Date());
  if (doiSoat === null) throw loiP1;
  return { ok: true, data: { ...doiSoat, ...(bong === null ? {} : { bong }), ...(nguoiMua === null ? {} : { nguoiMua }), ...(kyUsb === null ? {} : { kyUsb }) } };
});
