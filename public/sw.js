/* Sata Robo — service worker cho thông báo đẩy (Web Push Đợt 2, 08/09/2026).
 *
 * PHẠM VI CỐ Ý HẸP: chỉ nhận push và xử lý cú bấm. KHÔNG có handler `fetch`, KHÔNG cache gì.
 * Thêm cache vào đây là nhận nguyên một lớp lỗi mới (phục vụ bản cũ sau khi deploy, "sao tôi
 * bấm mà trang không đổi") để đổi lấy một thứ không ai yêu cầu. Muốn offline thì đó là việc riêng.
 *
 * ⚠️ FILE NÀY CHẠY TRONG TRÌNH DUYỆT, KHÔNG QUA BUNDLER. Không `import`, không TypeScript,
 * không optional chaining phức tạp — cứ JS trần cho mọi trình duyệt của nhân viên đọc được.
 * Nó được test THẬT ở `lib/push/sw.test.ts`: test đọc chính file này rồi chạy trong một `self`
 * giả, nên đừng đổi tên hàm/hành vi mà không chạy lại bộ đó.
 *
 * ⚠️ ĐƯỜNG PHỤC VỤ: `/sw.js` nằm ngoài middleware — matcher của `proxy.ts` loại mọi đường kết
 * thúc `.js`. Không phải may: đó là lý do file đặt ở `public/` với đuôi `.js` chứ không phải một
 * route handler. Scope của worker là `/` vì file nằm ở gốc.
 */

/** Không bao giờ để trống: mỗi push PHẢI hiện một thông báo (userVisibleOnly). */
var TIEU_DE_MAC_DINH = "Sata Robo";
var NOI_DUNG_MAC_DINH = "Bạn có thông báo mới.";
var DUONG_MAC_DINH = "/";

/**
 * Bóc payload, KHÔNG BAO GIỜ ném.
 *
 * Vì sao phải chịu được rác: nếu handler `push` ném lỗi thì trình duyệt coi như ta đã nhận push
 * mà không hiện gì — và Chrome/Firefox phạt đúng hành vi đó bằng cách tự hiện một thông báo
 * "This site has been updated in the background", hoặc thu hồi quyền push sau vài lần. Tức một
 * lỗi phân tích JSON có thể giết cả kênh. Thà hiện thông báo mặc định còn hơn im.
 */
function bocPayload(event) {
  var raw = null;
  try {
    raw = event && event.data ? event.data.json() : null;
  } catch (e) {
    raw = null;
  }
  var d = raw && typeof raw === "object" ? raw : {};
  return {
    title: typeof d.title === "string" && d.title ? d.title : TIEU_DE_MAC_DINH,
    body: typeof d.body === "string" && d.body ? d.body : NOI_DUNG_MAC_DINH,
    url: typeof d.url === "string" && d.url ? d.url : DUONG_MAC_DINH,
    // `tag` gộp các thông báo cùng loại. Lấy từ payload để "lead mới" và "khách nhập lại"
    // KHÔNG đè nhau — hai việc khác nhau, gộp là nuốt mất một cái.
    tag: typeof d.tag === "string" && d.tag ? d.tag : undefined,
  };
}

self.addEventListener("push", function (event) {
  var p = bocPayload(event);
  var options = {
    body: p.body,
    // Icon lấy từ đường tĩnh trong `public/` — service worker không đọc được bundle.
    icon: "/icons/satarobo-500.png",
    badge: "/icons/satarobo-500.png",
    tag: p.tag,
    // KHÔNG `requireInteraction`: thông báo tự tắt như mọi thông báo khác. Bắt người dùng
    // phải bấm mới tắt là cách nhanh nhất để họ tắt quyền thông báo ở cấp trình duyệt.
    data: { url: p.url },
  };
  // `waitUntil` là bắt buộc: thiếu nó thì worker có thể bị dừng trước khi thông báo hiện ra.
  event.waitUntil(self.registration.showNotification(p.title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || DUONG_MAC_DINH;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (danhSach) {
        // Ưu tiên tab ĐANG MỞ của cùng origin: mở thêm cửa sổ khi người ta đã có sẵn một tab
        // là cách chắc chắn để nhân viên tích 6 tab admin trong một buổi sáng.
        for (var i = 0; i < danhSach.length; i++) {
          var c = danhSach[i];
          if (c.url && c.url.indexOf(self.location.origin) === 0) {
            // `navigate` có thể không được hỗ trợ (hoặc bị từ chối) — vẫn phải focus.
            if (typeof c.navigate === "function") {
              try {
                c.navigate(url);
              } catch (e) {
                /* focus vẫn hơn không làm gì */
              }
            }
            return c.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});

// Bản mới thay bản cũ ngay, không đợi mọi tab đóng: worker này không giữ trạng thái gì nên
// không có gì để mất, còn đợi thì một tab admin mở cả ngày sẽ ghim mãi bản cũ.
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});
