"use client";

import { signOut } from "next-auth/react";
import { huyThietBiTheoEndpointAction } from "@/app/(admin)/admin/settings/_push-actions";

/**
 * URL cổng đăng nhập dùng khi đăng xuất — quyết định TẠI THỜI ĐIỂM click (không đọc
 * `window` ở module-level → an toàn SSR).
 *
 * GATE (Q41): cổng login CHUNG (`satarobo.vn/login`) chỉ bật khi
 * `NEXT_PUBLIC_COMMON_LOGIN === "true"` — phải bật ĐỒNG BỘ với F4
 * (`COMMON_LOGIN_AT_ROOT`) + F2 (`AUTH_COOKIE_DOMAIN`) SAU flip. MẶC ĐỊNH (chưa bật):
 * `/login` tương đối GIỮ host hiện tại — TƯƠNG ĐƯƠNG hành vi cũ `signOut({callbackUrl:"/login"})`,
 * nên deploy trong tuần flip KHÔNG đổi behavior.
 * - `NEXT_PUBLIC_LOGIN_URL` set → override thẳng (staging/preview).
 * - Site test (`test.satarobo.vn`) → `/login` tương đối (cổng login RIÊNG, KHÔNG
 *   đẩy về prod dù host cũng kết thúc `.satarobo.vn`).
 * - Bật cổng chung + đang ở domain prod thật (`*.satarobo.vn`) → `https://satarobo.vn/login`.
 * - Còn lại (chưa bật, localhost, `*.vercel.app`) → `/login` tương đối (giữ host).
 */
function resolveLoginGateUrl(): string {
  const configured = process.env.NEXT_PUBLIC_LOGIN_URL?.trim();
  if (configured) return configured;

  const host = window.location.hostname;

  // Site test có cổng login riêng — logout GIỮ NGUYÊN host (test.satarobo.vn/login),
  // không gộp về prod. Đặt TRƯỚC nhánh `.satarobo.vn` (test cũng khớp đuôi đó) và
  // trước cả gate-off để đúng kể cả khi NEXT_PUBLIC_COMMON_LOGIN được set nhầm ở env test.
  if (host === "test.satarobo.vn") return "/login";

  // Gate-off: cổng chung chưa bật → giữ host hiện tại (hành vi cũ).
  if (process.env.NEXT_PUBLIC_COMMON_LOGIN !== "true") return "/login";

  if (host === "satarobo.vn" || host.endsWith(".satarobo.vn")) {
    return "https://satarobo.vn/login";
  }
  return "/login";
}

/**
 * Đăng xuất từ BẤT KỲ subdomain nào (admin/teacher/portal) rồi đưa về cổng login chung.
 *
 * KHÔNG dùng `signOut({ callbackUrl: "https://..." })`: Auth.js redirect callback chặn
 * cross-origin nên trả về baseUrl của host hiện tại → tái tạo đúng bug
 * `giaovien.satarobo.vn/login?callbackUrl=%2F`. Vì vậy đăng xuất KHÔNG redirect (chỉ xoá
 * session cookie của host hiện tại) rồi tự điều hướng full-page về cổng chung. `finally`
 * bảo đảm luôn điều hướng kể cả khi `signOut` lỗi mạng (đánh đổi có chủ đích: cookie
 * host-only còn sót là chấp nhận được, tránh kẹt lại màn hình đã-đăng-xuất-một-nửa).
 */
/**
 * Chờ tối đa bao lâu cho việc gỡ đăng ký push trước khi bỏ qua và đăng xuất luôn.
 *
 * Có trần vì đăng xuất KHÔNG được treo: người dùng bấm "Đăng xuất" trên máy dùng chung là
 * họ đang muốn ĐỨNG LÊN ĐI. Mạng chậm mà ta chờ vô hạn thì họ bỏ đi với phiên còn mở — tệ
 * hơn hẳn cái ta đang cố vá.
 */
const CHO_GO_PUSH_MS = 1500;

/**
 * Gỡ đăng ký push CỦA ĐÚNG MÁY NÀY trước khi đăng xuất (US-14b Đợt 5).
 *
 * Service worker khoá theo ORIGIN, không theo phiên. Không gỡ thì trên máy lễ tân dùng chung,
 * mọi lead chia cho người vừa đăng xuất sẽ nổ trên màn hình khoá của người đăng nhập sau —
 * kèm tên phụ huynh.
 *
 * ── THỨ TỰ: MÁY CHỦ TRƯỚC, TRÌNH DUYỆT SAU ──────────────────────────────────────────────
 * Đúng bài học của `tatMayNay` ở Đợt 3: `unsubscribe()` KHÔNG hoàn tác được, nên gọi nó trước
 * là tự phá mất thứ duy nhất định danh được dòng cần thu hồi.
 *
 * ── CHỈ `unsubscribe()` KHI MÁY CHỦ XÁC NHẬN VỪA THU HỒI MỘT DÒNG **CỦA MÌNH** ───────────
 * ⚠️ Đây là ĐẢO NGƯỢC so với bản đầu của Đợt 5, vì lăng kính phản biện đưa ra một dữ kiện mà
 * bản đầu không tính tới. Bản đầu huỷ VÔ ĐIỀU KIỆN với lý lẽ "một endpoint đã huỷ thì không
 * giao được cho ai, nên cứ huỷ vẫn an toàn hơn". Lý lẽ đó SAI ở môi trường MỘT ORIGIN:
 * `test.satarobo.vn` và `localhost` đi nhánh không-chia-subdomain của `proxy.ts`, nên admin,
 * portal và teacher DÙNG CHUNG một origin ⇒ CHUNG một service worker. Mà `logoutToGate` được
 * gọi cả từ portal. Hệ quả đo được: một PHỤ HUYNH bấm Đăng xuất trên `test.satarobo.vn` sẽ
 * `getSubscription()` ra đăng ký của NHÂN VIÊN, action từ chối ("Không có quyền"), rồi bản đầu
 * vẫn `unsubscribe()` — giết đăng ký của người khác. Triệu chứng trên UAT là "bật rồi mà không
 * nhận được gì", và `/settings` vẫn báo thiết bị đang hoạt động.
 *
 * Nên: hỏi máy chủ đã thu hồi được BAO NHIÊU dòng. `> 0` nghĩa là endpoint này thật sự thuộc
 * người đang đăng xuất ⇒ huỷ. `0` hoặc lỗi ⇒ KHÔNG huỷ; lúc đó lưới còn lại là `bat()` (nó
 * luôn `unsubscribe()` đăng ký cũ trước khi đăng ký mới) và nửa server ở `/dang-xuat`.
 *
 * ⚠️ KHÔNG kín, và đừng viết tài liệu như thể đã kín: đóng thẳng tab · mất mạng · JWT hết hạn
 * tự nhiên · xoá cookie tay đều không chạy hàm này. Ca "tài khoản chết" thì đã có nửa server
 * ở `app/(auth)/dang-xuat/route.ts` lo. Phần còn lại nằm trong sổ nợ `docs/web-push §14.4`.
 */
async function goDangKyPushCuaMayNay(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  // Nơi chưa ai cài worker ⇒ `getRegistration()` trả `undefined` và hàm thoát ở đây, không tốn
  // một lượt gọi máy chủ nào. (Trên các host THẬT thì portal/sale không mount worker; trên
  // localhost và `test.satarobo.vn` thì mọi khu dùng chung một origin nên có thể thấy worker
  // của khu khác — đó chính là ca mà cổng `soDong > 0` dưới đây chặn.)
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager?.getSubscription();
  if (!sub) return;

  let cuaToi = false;
  try {
    const kq = await huyThietBiTheoEndpointAction({ endpoint: sub.endpoint });
    cuaToi = kq.ok && (kq.soDong ?? 0) > 0;
  } catch {
    // Máy chủ hỏng/phiên vừa hết ⇒ KHÔNG biết endpoint này của ai ⇒ không huỷ.
  }
  if (cuaToi) await sub.unsubscribe();
}

export async function logoutToGate(): Promise<void> {
  // Gỡ push TRƯỚC `signOut`: action thu hồi cần phiên còn sống để biết `userId` (nó lấy từ
  // phiên server, không bao giờ từ input). Sau `signOut` thì nó chỉ trả "Chưa đăng nhập".
  try {
    await Promise.race([
      goDangKyPushCuaMayNay(),
      new Promise<void>((r) => setTimeout(r, CHO_GO_PUSH_MS)),
    ]);
  } catch {
    // Đăng xuất không bao giờ được chặn bởi việc dọn push.
  }

  try {
    await signOut({ redirect: false });
  } finally {
    window.location.href = resolveLoginGateUrl();
  }
}
