import type { Page } from "@playwright/test";

/**
 * ĐO TRÀN NGANG THẬT — vùng cuộn chính của trang có bị kéo ngang không.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 VÌ SAO HÀM NÀY TỒN TẠI [25/09/2026] — BA phép đo trước đều sai, theo ba kiểu khác
 * nhau, và cả ba đều XANH trên mã đã hỏng. Ghi lại đủ vì mỗi cái là một cách tự lừa.
 *
 * **#1 — `documentElement.scrollWidth - clientWidth`** (đang dùng ở nhiều spec):
 * không thấy gì trong khung admin. `components/admin/admin-shell.tsx` dựng
 * `<main className="flex-1 overflow-y-auto …">` trong khung cao bằng màn hình, nên tràn
 * nằm gọn trong `<main>` và `documentElement` không hề đổi.
 *
 * **#2 — quét `scrollWidth > clientWidth` MỌI phần tử**: báo động giả. Nó tố một
 * `<input>` ẩn của base-ui "tràn 31px"; với ô nhập, `scrollWidth` là CHIỀU DÀI CHỮ bên
 * trong so với bề rộng ô, chẳng đẩy gì trên màn.
 *
 * **#3 — quét mép phải vượt khung nhìn, BỎ QUA thứ nằm trong vùng cuộn ngang**: chính
 * `<main>` có `overflow-x: auto` (CSS ép trục còn lại thành `auto` khi một trục là
 * `auto`), nên phép loại trừ ấy bỏ qua TOÀN BỘ nội dung admin. Cấy một thẻ rộng cứng
 * 700px vào khung nhìn 375px — vẫn XANH.
 *
 * **Phép đo dùng nay:** hỏi thẳng hai vùng cuộn thật (`documentElement` và `<main>`) xem
 * chúng có kéo ngang được không. Đó đúng là thứ người dùng cảm thấy. Bảng đặt trong
 * `PhanTrangBang cuonNgang` KHÔNG gây báo động: nó có vùng cuộn RIÊNG nên tự hấp thụ bề
 * rộng của mình, `<main>` không nở theo.
 *
 * ⚠️ Đã cấy lại lỗi (thẻ `w-[700px]`) và thấy ĐỎ trước khi tin — xem `[DTD-01]`.
 */
export async function doTranNgang(page: Page): Promise<{ px: number; thuPham: string }> {
  return page.evaluate(() => {
    const vung: { ten: string; el: Element | null }[] = [
      { ten: "documentElement", el: document.documentElement },
      { ten: "main", el: document.querySelector("main") },
    ];
    let px = 0;
    let thuPham = "(không có)";
    for (const v of vung) {
      if (!v.el) continue;
      const du = Math.round(v.el.scrollWidth - v.el.clientWidth);
      if (du > px) {
        px = du;
        thuPham = v.ten;
      }
    }
    if (px === 0) return { px: 0, thuPham };

    // Có tràn thật ⇒ chỉ đích danh phần tử rộng nhất, để người đọc log khỏi đi dò.
    const rong = document.documentElement.clientWidth;
    let roNhat = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("main *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width > rong && r.width > roNhat) {
        roNhat = r.width;
        const cls = typeof el.className === "string" ? el.className.slice(0, 70) : "";
        thuPham = `${v0(el)}.${cls} (rộng ${Math.round(r.width)}px)`;
      }
    }
    function v0(el: HTMLElement) {
      return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "");
    }
    return { px, thuPham };
  });
}
