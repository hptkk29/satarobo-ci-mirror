// lib/push/tu-dang-ky-lai.ts — TỰ ĐĂNG KÝ LẠI sau khi đăng nhập. Web Push Đợt 6.
//
// ⚠️ FILE NÀY CHẠY Ở TRÌNH DUYỆT. Không `server-only`, không `Buffer`.
//
// ── VÌ SAO CẦN ────────────────────────────────────────────────────────────────────────────
// Từ Đợt 5, đăng xuất THU HỒI đăng ký (dòng DB về `REVOKED`, và nửa client huỷ luôn đăng ký ở
// trình duyệt khi máy chủ xác nhận nó là của mình). Đúng cho máy dùng chung, nhưng nó để lại một
// hệ quả làm tính năng gần như vô dụng trên máy để bàn: ai đăng xuất buổi tối thì HÔM SAU KHÔNG
// NHẬN GÌ, tới khi tự vào /settings bấm lại. Người ta đăng xuất hằng ngày.
//
// ── RÀNG BUỘC CỨNG, KHÔNG THƯƠNG LƯỢNG ───────────────────────────────────────────────────
// TUYỆT ĐỐI KHÔNG gọi `Notification.requestPermission()` ở đường này. Xin quyền chỉ được làm
// trong một cú bấm của người dùng: gọi lúc tải trang là cách chắc chắn để nhân viên bấm "Chặn"
// theo phản xạ, và trình duyệt KHÔNG hỏi lại — mất kênh vĩnh viễn cho máy đó, code không lấy lại
// được. `permission` khác `"granted"` (kể cả `"default"`) thì hàm này KHÔNG LÀM GÌ.
//
// ── NĂM CỔNG, THEO THỨ TỰ ────────────────────────────────────────────────────────────────
//  1. quyền phải ĐANG là `granted` — không xin, chỉ đọc;
//  2. CHÍNH NGƯỜI NÀY chưa chủ động tắt trên máy này (`daTatTayOMayNay`) — nếu không có cổng này
//     thì nút "Gỡ" thành vô nghĩa: nó chỉ thu hồi DÒNG, nên lượt tải kế tự đăng ký lại;
//  3. khoá VAPID của đăng ký cũ phải KHỚP khoá server đang chạy — xem khối dưới, đây là cổng dễ
//     bỏ sót nhất và bỏ sót là lỗi câm vĩnh viễn;
//  4. endpoint đó chưa được CHÍNH NGƯỜI NÀY đồng bộ trong phiên tab này — chốt idempotence;
//  5. cổng THỨ NĂM nằm Ở MÁY CHỦ, không ở đây: `tuDong: true` bắt `dangKyThietBiAction` đòi
//     người này ĐÃ TỪNG bật thông báo trên origin này, và cấm hồi sinh một dòng bị thu hồi vì lý
//     do KHÁC "đăng xuất". Hai điều đó không thể gác ở client vì client không có danh tính đáng
//     tin — xem chú thích `tuDong` trong `app/(admin)/admin/settings/_push-actions.ts`.
//
// ── ⚠️ MỌI CỔNG TRẠNG THÁI ĐỀU THEO NGƯỜI, KHÔNG THEO ORIGIN ─────────────────────────────
// Lăng kính Đợt 6 đo được hai chuỗi hỏng im lặng trên máy dùng chung khi hai cổng trạng thái
// khoá theo origin. Chi tiết ở đầu `lib/push/bo-nho-may.ts` — đọc trước khi đổi chữ ký.

import { dangKyThietBiAction } from "@/app/(admin)/admin/settings/_push-actions";
import {
  bamEndpointOClient,
  khoaVapidSangBytes,
  laKhoaVapidHopLeOClient,
} from "@/lib/push/client-key";
import { daDongBoTrongPhien, daTatTayOMayNay, datDaDongBo } from "@/lib/push/bo-nho-may";

/** Vì sao một lượt không làm gì — chỉ để test đọc được, không hiện cho người dùng. */
export type KetQuaTuDangKy =
  | "DA_GHI"
  | "KHONG_HO_TRO"
  | "CHUA_CAP_QUYEN"
  | "NGUOI_DUNG_DA_TAT"
  | "THIEU_KHOA"
  | "KHOA_KHONG_DOI_CHIEU_DUOC"
  | "DA_DONG_BO"
  | "LOI";

/**
 * So khoá VAPID của một đăng ký đã có với khoá server đang chạy.
 *
 * @returns `true` khớp · `false` lệch · `null` KHÔNG ĐỐI CHIẾU ĐƯỢC.
 *
 * ── VÌ SAO BƯỚC NÀY BẮT BUỘC ─────────────────────────────────────────────────────────────
 * Tái dùng một đăng ký cũ mà không so khoá là LỖI CÂM VĨNH VIỄN: nếu đăng ký đó được ký bằng
 * khoá VAPID CŨ, lời gọi ghi sẽ HỒI SINH dòng trong DB (nhánh `update` dọn `revokedAt` và đặt
 * `failureCount: 0`) trỏ vào một endpoint mà server không ký nổi ⇒ engine nhận 403
 * `VapidPkHashMismatch`, mà 403 CỐ Ý không gỡ thiết bị (nó thường nghĩa là khoá server vừa xoay,
 * không phải máy người dùng hỏng). Kết quả: `/settings` báo "đang nhận", thực tế không bao giờ
 * nhận, và không ai có lý do đi tìm.
 *
 * Lệch thì phải `unsubscribe()` trước khi `subscribe()`: theo spec Push API, `subscribe()` với
 * một `applicationServerKey` KHÁC trong khi đã có đăng ký sẽ bị từ chối.
 */
export function khoaCuaDangKyCoKhop(
  sub: Pick<PushSubscription, "options">,
  khoaHienTai: Uint8Array,
): boolean | null {
  const k = sub.options?.applicationServerKey;
  if (!k) return null;
  const a = new Uint8Array(k);
  if (a.length !== khoaHienTai.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== khoaHienTai[i]) return false;
  return true;
}

/**
 * Lặng lẽ dựng lại đăng ký push cho máy này rồi ghi lên máy chủ.
 *
 * @param reg registration ĐÃ CÓ `active` worker — nơi gọi lấy từ `navigator.serviceWorker.ready`
 *   sau `register()`. CỐ Ý không tự `getRegistration()`: việc cài worker bị hoãn tới sự kiện
 *   `load` (`components/push/service-worker-register.tsx`), nên một hàm tự đi tìm registration sẽ
 *   trả `undefined` ở lượt tải ĐẦU và chỉ "may mắn" chạy ở lượt sau. Và `subscribe()` trên một
 *   registration còn `installing` ném `InvalidStateError`.
 * @param nguoiDung `session.user.id` của phiên server. Thiếu ⇒ hàm không làm gì (fail-closed).
 *
 * KHÔNG BAO GIỜ NÉM: đây là tính năng cộng thêm chạy lúc tải trang; một lỗi lọt ra ngoài là làm
 * trắng màn hình cho một việc mà người dùng không yêu cầu.
 */
export async function tuDangKyLaiPush(
  reg: ServiceWorkerRegistration,
  nguoiDung: string | null | undefined,
): Promise<KetQuaTuDangKy> {
  try {
    if (typeof Notification === "undefined" || !reg.pushManager) return "KHONG_HO_TRO";

    // CỔNG 1 — chỉ ĐỌC `permission`, không bao giờ xin. `"default"` cũng là không làm gì.
    if (Notification.permission !== "granted") return "CHUA_CAP_QUYEN";

    // CỔNG 2 — chính người này đã tự tắt trên máy này. `nguoiDung` rỗng cũng rơi vào đây
    // (`daTatTayOMayNay` fail-closed), nên không có đường nào ghi bằng một danh tính không rõ.
    if (daTatTayOMayNay(nguoiDung)) return "NGUOI_DUNG_DA_TAT";

    // Đọc khoá TRONG hàm, không ở module scope: `NEXT_PUBLIC_*` được nhúng lúc build nên cách
    // nào cũng chạy trên prod, nhưng đọc ở module scope thì `vi.stubEnv` trong test VÔ TÁC DỤNG
    // (module đã nạp trước khi `beforeEach` chạy) — và một cổng không test được là một cổng
    // không tồn tại.
    const khoaCongKhai = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!laKhoaVapidHopLeOClient(khoaCongKhai)) {
      // PHẢI để lại vết. Ca thật đang chờ sẵn: người vận hành đặt ba biến VAPID trên Vercel rồi
      // KHÔNG deploy lại — `NEXT_PUBLIC_*` nhúng lúc BUILD, nên bundle đang chạy mang `undefined`
      // và đường tự động của CẢ CÔNG TY chết. Không log thì triệu chứng duy nhất là "sao tôi
      // không nhận được thông báo", thứ không tự chỉ về đây.
      console.warn(
        "[push] tự đăng ký lại: NEXT_PUBLIC_VAPID_PUBLIC_KEY thiếu/sai hình dạng — " +
          "biến này nhúng lúc BUILD, đặt env xong phải deploy lại.",
      );
      return "THIEU_KHOA";
    }
    const khoaBytes = khoaVapidSangBytes(khoaCongKhai as string);

    let sub = await reg.pushManager.getSubscription();

    // CỔNG 3 — so khoá.
    if (sub) {
      const khop = khoaCuaDangKyCoKhop(sub, khoaBytes);
      if (khop === null) {
        // Trình duyệt không cho đọc `options` (Safari cũ). KHÔNG tái dùng mù: xem khối chú thích
        // của `khoaCuaDangKyCoKhop`. Cũng không huỷ-rồi-đăng-ký-lại, vì làm vậy mỗi lượt tải
        // trang là đẻ một endpoint mới và một dòng mồ côi. Để người dùng bấm tay như trước —
        // nhưng NÓI RA, vì ca này làm máy đó câm mà không có dấu hiệu nào khác.
        console.warn(
          "[push] tự đăng ký lại: trình duyệt không cho đọc applicationServerKey của đăng ký " +
            "hiện có — bỏ qua để không đẻ đăng ký mồ côi. Bật lại bằng tay ở trang Cài đặt.",
        );
        return "KHOA_KHONG_DOI_CHIEU_DUOC";
      }
      if (khop === false) {
        await sub.unsubscribe().catch(() => undefined);
        sub = null;
      }
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        // Mọi push PHẢI hiện một thông báo — ràng buộc của cả việc này.
        userVisibleOnly: true,
        applicationServerKey: khoaBytes,
      });
    }

    // CỔNG 4 — idempotence theo (người × phiên tab × endpoint).
    const bam = await bamEndpointOClient(sub.endpoint);
    if (bam && daDongBoTrongPhien(nguoiDung, bam)) return "DA_DONG_BO";

    // Gọi THẲNG Server Action, không qua một tham số tiêm được: bộ test `vi.mock` chính module
    // action, nên đường đi trong test là ĐÚNG đường đi trên prod. Một hàm tiêm vào sẽ xanh kể cả
    // khi `import` ở trên trỏ sai action.
    //
    // `tuDong: true` là CỔNG 5 — nó chỉ SIẾT, không bao giờ nới (xem `_push-actions.ts`). Đường
    // bấm tay cố ý KHÔNG gửi cờ này: chính nó là chỗ người dùng tạo tiền sử.
    const kq = await dangKyThietBiAction({
      subscription: sub.toJSON(),
      userAgent: navigator.userAgent,
      displayMode: window.matchMedia?.("(display-mode: standalone)").matches
        ? "standalone"
        : "browser",
      tuDong: true,
    });
    if (!kq.ok) {
      // Không nói gì với người dùng: họ không yêu cầu việc này. Nhưng để lại vết — "bật rồi mà
      // không nhận được gì" là triệu chứng duy nhất, và nó không tự chỉ về đây.
      //
      // ⚠️ CHỈ in `kq.error` (chuỗi do action tự soạn). TUYỆT ĐỐI không in `sub.endpoint` /
      // `p256dh` / `auth`: Sentry browser đang bật với `replaysOnErrorSampleRate: 1.0`, nên một
      // dòng log mang endpoint là đưa KHẢ NĂNG GỬI ra ngoài. Có ca test canh điều này.
      console.warn("[push] tự đăng ký lại: máy chủ từ chối —", kq.error);
      return "LOI";
    }
    if (bam) datDaDongBo(nguoiDung, bam);
    return "DA_GHI";
  } catch (err) {
    console.warn("[push] tự đăng ký lại lỗi (không ảnh hưởng trang):", err);
    return "LOI";
  }
}
