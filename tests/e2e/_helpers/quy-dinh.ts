import type { Page } from "@playwright/test";

/**
 * Đi qua màn CỔNG «Quy định đào tạo học viên» (12/11/2026) nếu nó đang chắn cổng phụ huynh.
 *
 * Phụ huynh có con ĐÃ ĐĂNG KÝ khoá mà chưa đồng ý bản quy định hiện hành thì MỌI trang `/portal/*` chỉ trả màn này (layout không dựng `children`).
 * Spec nào đăng nhập một phụ huynh có ghi danh rồi vào trang portal đều gặp nó. Đi qua bằng CHÍNH cổng thật (cuộn hết rồi bấm «Tôi đã đọc và đồng ý»),
 * KHÔNG chèn bản ghi bằng DB — để cổng cũng được kiểm (cùng nguyên tắc với cổng «Chính sách hoạt động của website»). Không có cổng ⇒ không làm gì.
 */
export async function quaCongQuyDinh(page: Page): Promise<void> {
  const cong = page.getByRole("dialog", { name: "Quy định đào tạo học viên" });
  if (!(await cong.isVisible({ timeout: 3_000 }).catch(() => false))) return;
  await cong.getByLabel("Nội dung quy định, cuộn để đọc").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll"));
  });
  await cong.getByRole("button", { name: "Tôi đã đọc và đồng ý" }).click();
  await cong.waitFor({ state: "detached", timeout: 30_000 });
}
