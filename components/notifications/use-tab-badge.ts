"use client";

// components/notifications/use-tab-badge.ts — đưa badge "leo ra" thanh tab trình duyệt.
//
// VÌ SAO CẦN: chuông chỉ có tác dụng khi người dùng ĐANG Ở trong tab này. Nhân sự mở 5–10 tab và
// phần lớn thời gian đang ở tab khác. Đây là lý do PRD xếp hạng mục này cao nhất bảng RICE — công
// rất thấp mà mở rộng phạm vi tiếp cận ra ngoài tab đang mở.
//
// PHƯƠNG ÁN A (mẫu Facebook), đã chốt: CON SỐ chỉ ở TIÊU ĐỀ, favicon chỉ có CHẤM ĐỎ TRƠN.
// Không phải để cho gọn — favicon hiển thị thật ở 16×16px, con số nhét vào chấm còn chưa tới 7px,
// đọc không ra, riêng "9+" thì bất khả. Chữ trong tiêu đề thì luôn đọc được.
// Lợi ích phụ đáng kể: favicon chỉ có HAI trạng thái (có chấm / không), nên chỉ phải vẽ lại khi
// chuyển giữa hai trạng thái đó, chứ không phải mỗi lần con số đổi.
//
// ⚠️ Khác biệt CÓ CHỦ ĐÍCH với chuông, QA cần biết để không báo nhầm là lỗi lệch số:
// 1 mục chưa đọc → chuông hiện CHẤM KHÔNG SỐ, còn tiêu đề tab hiện `(1)`. Trên tab, chấm đỏ đã do
// favicon đảm nhiệm rồi nên tiêu đề là kênh mang con số.

import { useEffect } from "react";
import { buildTabTitlePrefix } from "@/lib/notifications/badge";

/** Bắt tiền tố `(N) ` hoặc `(9+) ` ở ĐẦU tiêu đề để gỡ ra trước khi ghép cái mới. */
const TIEN_TO = /^\(\d+\+?\)\s*/;

/** Kích thước canvas dựng favicon. 32 để chấm còn sắc khi trình duyệt thu về 16. */
const CANVAS = 32;

export function stripTabBadge(title: string): string {
  return title.replace(TIEN_TO, "");
}

export function withTabBadge(title: string, unread: number): string {
  return buildTabTitlePrefix(unread) + stripTabBadge(title);
}

/** Href gốc của từng thẻ favicon — để trả lại nguyên trạng khi hết mục chưa đọc. */
const hrefGoc = new WeakMap<HTMLLinkElement, string>();
/** Data URL đã vẽ chấm, dựng một lần cho cả phiên. */
let faviconCoCham: string | null = null;
/** Trình duyệt/định dạng không cho vẽ lại favicon → thôi, không thử nữa, không báo lỗi. */
let faviconBoCuoc = false;
/** Cờ chống đệ quy: thao tác của chính ta cũng làm `<head>` đổi và đánh thức observer. */
let dangApDung = false;

/** Mọi thẻ favicon THƯỜNG (bỏ qua apple-touch-icon — nó không hiện trên thanh tab). */
function cacTheFavicon(): HTMLLinkElement[] {
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
}

/**
 * Vẽ favicon gốc lên canvas rồi chấm đỏ viền trắng ở góc trên phải.
 *
 * Chấm chiếm ~40% chiều rộng và BẮT BUỘC có viền trắng: favicon hiển thị thật ở 16×16, chấm nhỏ
 * hơn thì tan vào nền và người dùng không thấy gì cả.
 */
async function dungFaviconCoCham(src: string): Promise<string | null> {
  try {
    const img = new Image();
    // Cùng origin (`app/icon.png` do Next phục vụ) nên canvas không bị "vấy bẩn"; đặt sẵn
    // crossOrigin phòng khi sau này favicon chuyển sang CDN.
    img.crossOrigin = "anonymous";
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("không tải được favicon"));
    });
    img.src = src;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = CANVAS;
    canvas.height = CANVAS;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, CANVAS, CANVAS);

    const r = CANVAS * 0.22;
    const cx = CANVAS - r - 1;
    const cy = r + 1;

    ctx.beginPath();
    ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#D93A2B";
    ctx.fill();

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Đổi `href` của MỌI thẻ favicon — cố ý KHÔNG gỡ/chèn node nào trong `<head>`.
 *
 * Hai lỗi đã đo thật 20/08/2026, bản vá phải né cả hai:
 *
 *  1. Chỉ sửa thẻ ĐẦU TIÊN là chưa đủ. `<head>` có ĐẾN HAI thẻ `rel="icon"` — một do HTML
 *     server dựng, một do Next chèn lúc hydrate. Sửa mỗi cái đầu thì cái sau vẫn trỏ
 *     `/icon.png` gốc và trình duyệt chọn nó ⇒ tiêu đề tab hiện `(9+)` bình thường mà chấm đỏ
 *     KHÔNG BAO GIỜ xuất hiện. Đúng triệu chứng người dùng báo.
 *
 *  2. ⛔ ĐỪNG "dọn cho sạch" bằng cách gỡ các thẻ rồi chèn một thẻ mới. Đã thử: nó phá cơ chế
 *     quản lý `<head>` của Next — sau lần điều hướng phía client đầu tiên, thẻ `<title>` BIẾN
 *     MẤT hoàn toàn và tab chỉ còn hiện URL. Đo bằng công tắc tạm: tắt phần favicon thì tiêu đề
 *     sống sót, bật lên thì mất. Sửa thuộc tính thì an toàn, gỡ node thì không.
 */
async function datFavicon(coCham: boolean): Promise<void> {
  if (faviconBoCuoc) return;

  const cacThe = cacTheFavicon();
  if (cacThe.length === 0) {
    faviconBoCuoc = true;
    return;
  }
  for (const l of cacThe) if (!hrefGoc.has(l)) hrefGoc.set(l, l.href);

  if (coCham && !faviconCoCham) {
    const nguon = hrefGoc.get(cacThe[0]!);
    faviconCoCham = nguon ? await dungFaviconCoCham(nguon) : null;
    if (!faviconCoCham) {
      // Suy biến an toàn theo đúng PRD: chỉ dùng tiêu đề tab, không báo lỗi, không thử lại.
      faviconBoCuoc = true;
      return;
    }
  }

  dangApDung = true;
  try {
    for (const l of cacThe) {
      const dich = coCham ? faviconCoCham! : (hrefGoc.get(l) ?? l.href);
      if (l.getAttribute("href") !== dich) l.setAttribute("href", dich);
    }
  } finally {
    queueMicrotask(() => {
      dangApDung = false;
    });
  }
}

/**
 * Gắn số chưa đọc vào tiêu đề tab + chấm đỏ vào favicon.
 *
 * Tiêu đề trang tự đổi khi điều hướng (Next ghi lại `document.title`), nên phải THEO DÕI thẻ
 * `<title>` mà ghép lại — nếu không thì chuyển trang một cái là con số biến mất. Dùng
 * MutationObserver thay vì hẹn giờ: đổi tiêu đề là sự kiện, không phải thứ để đi hỏi định kỳ.
 */
export function useTabBadge(unread: number): void {
  useEffect(() => {
    if (typeof document === "undefined") return;

    let tuMinhSua = false;

    const apDung = () => {
      const mongMuon = withTabBadge(document.title, unread);
      if (document.title === mongMuon) return;
      tuMinhSua = true;
      document.title = mongMuon;
      // Cờ được hạ ở lượt vi-task kế tiếp, sau khi observer đã tiêu hoá thay đổi của chính ta.
      queueMicrotask(() => {
        tuMinhSua = false;
      });
    };

    apDung();
    void datFavicon(unread > 0);

    // MỘT observer bám cả `<head>`, KHÔNG bám riêng thẻ `<title>`.
    //
    // Vì sao: khi điều hướng phía client, Next THAY luôn thẻ `<title>` chứ không chỉ đổi chữ
    // bên trong. Observer bám vào thẻ cũ thì chết theo thẻ đó — đo được 20/08/2026: sau lần
    // chuyển trang đầu tiên, tiêu đề thành "Lớp của tôi | …" và tiền tố `(2)` biến mất vĩnh
    // viễn, trong khi PRD §7.11e đòi ghép lại mỗi lần tiêu đề trang đổi.
    // `subtree + characterData` bắt cả hai kiểu: thay thẻ (childList của head) và sửa chữ
    // trong thẻ cũ (characterData). Cùng observer đó lo luôn thẻ favicon Next chèn mới.
    const observer = new MutationObserver(() => {
      if (tuMinhSua || dangApDung) return;
      apDung();
      const coTheChuaDoi = cacTheFavicon().some(
        (l) => faviconCoCham !== null && l.getAttribute("href") !== faviconCoCham,
      );
      if (unread > 0 && coTheChuaDoi) void datFavicon(true);
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      // Trả tiêu đề về nguyên gốc: đăng xuất hoặc gỡ component mà còn để lại `(8)` là nói dối.
      document.title = stripTabBadge(document.title);
      void datFavicon(false);
    };
  }, [unread]);
}
