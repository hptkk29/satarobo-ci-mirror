// lib/email/chan-gui-hoa-don.ts — MÔI TRƯỜNG KHÔNG PHẢI PRODUCTION THẬT ⇒ KHÔNG gửi email hoá đơn cho khách. THUẦN, không import gì nặng.
//
// Sinh ra từ UAT TEST 25/10/2026: lúc đó tưởng `RESEND_API_KEY` ĐÃ được đặt trên env test; không có cờ dry-run nào, và ô "Gửi hoá đơn tới email
// khách khi xác nhận" mặc định BẬT — nghĩa là bấm "xác nhận" một hoá đơn thử trên test là có thể gửi thư thật qua Resend.
// ⚠️ ĐÍNH CHÍNH 25/10 ~17:50 (đo trên container test): `RESEND_API_KEY` KHÔNG được đặt — test hiện KHÔNG gửi được thư thật. Lớp chặn này
// vẫn cần: thiếu khoá là tình trạng cấu hình, không phải một cổng; ai đặt khoá vào env test sau này thì chỉ còn lớp này đứng giữa.
//
// Luật (chủ dự án chốt 25/10/2026): chặn Ở SERVER, không phụ thuộc ô tick; không đánh dấu thư giả lập là "đã gửi"; không đổi gì ở PROD.
//
//   · Hai lớp ĐỘC LẬP, chỉ cần MỘT lớp nói "đây không phải prod thật" là chặn:
//       1. `!laProductionThat(env)` — `VERCEL_ENV` khác `production` (test VPS đặt `preview`), hoặc không đặt + không phải `next start` thật.
//       2. host của URL ứng dụng (`NEXTAUTH_URL` · `AUTH_URL` · `NEXT_PUBLIC_APP_URL`) bắt đầu bằng `test.` — lưới thứ hai cho ca
//          env test thiếu `VERCEL_ENV` (khi đó lớp 1 rơi về `NODE_ENV=production && !CI` ⇒ TRUE ⇒ KHÔNG chặn; nguy hiểm).
//   · KHÔNG có công tắc "cho phép gửi thật" nào ở đây — thêm một biến env như vậy là thêm đúng thứ có thể bị bật nhầm trên test.
//   · PROD (`VERCEL_ENV=production`, đo trên env prod của VPS 25/10/2026) và URL không bắt đầu bằng `test.` ⇒ `chan: false` ⇒ hành vi cũ nguyên vẹn.
//   · Phạm vi CHỈ là email HOÁ ĐƠN (`contextType = NGU_CANH_EMAIL_HOA_DON`). OTP, thông báo, nhắc lịch… không đổi.

import { laProductionThat, type BienMoiTruong } from "@/lib/security/client-ip";

/** Giá trị `EmailQueue.contextType` / `EmailLog.contextType` của dòng gửi hoá đơn — `contextId` = `HoaDonGuiEmail.id`. */
export const NGU_CANH_EMAIL_HOA_DON = "HoaDonGuiEmail";

/** Đầu câu ghi vào `HoaDonGuiEmail.loi` / `EmailQueue.error` / `EmailLog.failureReason` — để người đọc và test nhận ra ngay. */
export const DAU_CHAN_EMAIL_TEST = "[TEST — KHÔNG GỬI]";

const BIEN_URL_UNG_DUNG = ["NEXTAUTH_URL", "AUTH_URL", "NEXT_PUBLIC_APP_URL"] as const;
const HOST_TEST = /^test\./i;

export type KetQuaChanEmail =
  | { chan: false }
  | { chan: true; nguon: "KHONG_PHAI_PRODUCTION" | "HOST_TEST"; lyDo: string };

function hostCua(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const lyDo = (vi: string) =>
  `${DAU_CHAN_EMAIL_TEST} ${vi}: server không gửi email hoá đơn cho khách (không phụ thuộc ô tick). Thư KHÔNG được gửi — lượt này ghi là lỗi, không phải "đã gửi".`;

/**
 * Host của URL ứng dụng (`NEXTAUTH_URL` · `AUTH_URL` · `NEXT_PUBLIC_APP_URL`) có bắt đầu bằng `test.` không. MỘT định nghĩa cho cả "chặn email hoá
 * đơn" (chặn khi CÓ) lẫn "pháp nhân UAT chỉ hiện ở TEST" (cho phép khi CÓ — `lib/finance/hoa-don/phap-nhan-theo-moi-truong.ts`).
 */
export function hostUngDungLaTest(env: BienMoiTruong = process.env): boolean {
  return BIEN_URL_UNG_DUNG.some((k) => {
    const h = hostCua(env[k]);
    return h !== null && HOST_TEST.test(h);
  });
}

/** Có phải một dòng/lượt email HOÁ ĐƠN không — chỗ DUY NHẤT so khớp ngữ cảnh. */
export const laNguCanhEmailHoaDon = (contextType: string | null | undefined): boolean => contextType === NGU_CANH_EMAIL_HOA_DON;

/** Môi trường hiện tại có bị CHẶN gửi email hoá đơn không. `env` nhận từ chỗ gọi để test không phải đổi `process.env`. */
export function chanGuiEmailHoaDon(env: BienMoiTruong = process.env): KetQuaChanEmail {
  if (hostUngDungLaTest(env)) return { chan: true, nguon: "HOST_TEST", lyDo: lyDo("Môi trường TEST (host test.*)") };
  if (!laProductionThat(env)) return { chan: true, nguon: "KHONG_PHAI_PRODUCTION", lyDo: lyDo("Môi trường không phải production thật") };
  return { chan: false };
}
