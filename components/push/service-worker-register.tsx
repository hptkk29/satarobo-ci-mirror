"use client";

import { useEffect } from "react";
import { tuDangKyLaiPush } from "@/lib/push/tu-dang-ky-lai";

/**
 * Đăng ký service worker `/sw.js` — Web Push Đợt 2, mở rộng ở Đợt 6.
 *
 * KHÔNG xin quyền thông báo ở đây. Xin quyền chỉ được làm trong một cú bấm của người dùng
 * (Đợt 3): gọi `Notification.requestPermission()` lúc tải trang là cách chắc chắn để nhân viên
 * bấm "Chặn" theo phản xạ, và trình duyệt KHÔNG hỏi lại — mất kênh vĩnh viễn cho máy đó, code
 * không lấy lại được. Component này chỉ cài worker, và (Đợt 6) dựng lại đăng ký cho người đã
 * cấp quyền TỪ TRƯỚC — `tuDangKyLaiPush` không gọi `requestPermission()` ở bất kỳ nhánh nào.
 *
 * KHÔNG chặn render: chạy trong `useEffect` sau khi trang đã vẽ, và đợi thêm sự kiện `load` để
 * việc đăng ký không tranh băng thông với chính lần tải đầu.
 *
 * ⚠️ Chỉ mount ở `app/(admin)/admin/layout.tsx` và `app/(teacher)/teacher/layout.tsx` — hai
 * layout đã `auth()` + `redirect("/login")`, nên "sau khi đăng nhập" là điều kiện SẴN CÓ chứ
 * không phải thứ component này phải tự kiểm. TUYỆT ĐỐI không mount ở host phụ huynh/công khai
 * (cổng `[PUSH-D3-T14]` trong `lib/push/ui-state.test.ts` canh việc đó).
 *
 * `nguoiDung` = `session.user.id`, BẮT BUỘC. Hai cổng trạng thái ở trình duyệt khoá theo người
 * chứ không theo origin — thiếu nó là mở lại hai lỗ máy-dùng-chung mà lăng kính Đợt 6 đo được
 * (đọc khối đầu `lib/push/bo-nho-may.ts`). Không phải dữ liệu mới trong HTML: `Topbar` và
 * `AppShell` đã nhận đúng giá trị này từ trước.
 *
 * ⚠️ Service worker khoá theo ORIGIN. Hệ thống chạy 4 host trên cùng một app, nên component này
 * mount ở host nào thì worker sống ở host đó — một người dùng cả `admin.satarobo.vn` lẫn
 * `giaovien.satarobo.vn` sẽ có HAI đăng ký rời. Bảng `WebPushSubscription` chịu được điều đó
 * (cột `origin`), nhưng đừng bất ngờ khi thấy một người nhiều dòng.
 */
export function ServiceWorkerRegister({ nguoiDung }: { nguoiDung: string }) {
  useEffect(() => {
    // Không có API (trình duyệt cũ, hoặc ngữ cảnh không bảo mật) ⇒ im lặng bỏ qua. Đây là
    // tính năng cộng thêm; thiếu nó thì chuông trong ứng dụng vẫn chạy như cũ.
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let huy = false;

    const dangKy = () => {
      if (huy) return;
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        // Phải qua `navigator.serviceWorker.ready`, KHÔNG dùng thẳng registration mà `register()`
        // trả về: `register()` xong là registration đã tồn tại nhưng worker có thể còn ở
        // `installing`, và theo spec Push API thì `pushManager.subscribe()` trên một registration
        // chưa có `active` worker sẽ ném `InvalidStateError`. Đúng đường mà `bat()` ở
        // `components/push/bat-thong-bao.tsx` đã đi.
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => {
          // Chuỗi này CỐ Ý móc vào đây chứ không nằm trong một `useEffect` riêng: việc cài worker
          // bị hoãn tới sự kiện `load`, nên một effect độc lập sẽ chạy TRƯỚC và không thấy
          // registration nào ở lượt tải ĐẦU của một máy mới.
          if (huy) return;
          // Đợt 6 — TỰ ĐĂNG KÝ LẠI sau đăng nhập. Hàm không bao giờ ném và không bao giờ xin
          // quyền; mọi cổng nằm trong nó.
          void tuDangKyLaiPush(reg, nguoiDung);
        })
        .catch((err: unknown) => {
          // Nuốt lỗi có chủ đích, nhưng để lại vết: đăng ký hỏng là kênh push chết câm ở máy đó,
          // và không có triệu chứng nào khác ngoài "sao tôi không nhận được thông báo".
          console.warn("[push] không đăng ký được service worker:", err);
        });
    };

    if (document.readyState === "complete") {
      dangKy();
    } else {
      window.addEventListener("load", dangKy, { once: true });
    }

    return () => {
      huy = true;
      window.removeEventListener("load", dangKy);
    };
  }, [nguoiDung]);

  return null;
}
