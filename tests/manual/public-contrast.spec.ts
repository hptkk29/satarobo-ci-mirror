/**
 * Rà site CÔNG KHAI: tương phản chữ (WCAG AA) + tràn ngang ở 375px.
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts public-contrast
 *   VIEWPORT=mobile ... (đo ở 375px thay vì 1280px)
 *
 * Không cần đăng nhập. Đo cả hai bề rộng vì trang marketing nhiều hero/gradient —
 * chỗ chữ đè lên nền màu là nơi hay trượt nhất, và nó đổi theo bề rộng.
 *
 * ⚠️ Máy đo BỎ QUA phần tử có nền ảnh/gradient (không đọc được bằng
 * backgroundColor). Trang công khai dùng nhiều hero ảnh, nên KHÔNG kết luận
 * "sạch" từ con số này — nó chỉ phủ phần nền màu đặc.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠️ SPEC NÀY CÒN BÁO ~121 CHỖ — LÀ CÓ CHỦ Ý, ĐỪNG VÁ.
 *
 * Chủ dự án chốt 11/08/2026: KHÔNG đụng màu site công khai. Gần như toàn bộ số
 * còn lại là màu THƯƠNG HIỆU dùng làm chữ hoặc làm nền nút chữ trắng:
 *   · 18× chữ trắng trên nút cam #FF6900        = 2,89:1
 *   · 19× chữ cam #F97316 trên nền trắng        = 3,58:1
 *   · 13× chữ trắng trên nút tím #8E51FF        = 4,40:1
 *   · 13× nút "Chấp nhận tất cả" của dải cookie = 3,02:1
 *   · 20× landing cũ, cùng cặp cam/trắng        = 2,80:1
 * Vá được về mặt kỹ thuật, nhưng vá nghĩa là cam thương hiệu trên trang
 * marketing SẬM ĐI THẤY RÕ (so sánh: site giáo viên phải hạ #F97316 → #C2410C
 * mới đạt 5,18:1 với chữ trắng). Đó là quyết định nhận diện, đã được chốt là
 * GIỮ NGUYÊN.
 *
 * ⇒ Con số cần theo dõi là số chỗ trượt thuộc nhóm KHÁC (chữ xám, chữ trên nền
 *   trung tính). Nhóm đó đã về 0 ngày 11/08 — nếu nó mọc lại thì mới là hồi quy.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { test } from "@playwright/test";
import { AUDIT, type ChoTruot } from "./_contrast";

const MOBILE = process.env.VIEWPORT === "mobile";

test.use(
  MOBILE
    ? { viewport: { width: 375, height: 812 } }
    : { viewport: { width: 1280, height: 900 } },
);

const ROUTES = [
  "/",
  "/khoa-hoc",
  "/khoa-hoc/laptrinhrobot",
  "/khoa-hoc/luyenthirobosim",
  // "/hoc-cu" — ĐÃ GỠ 21/09/2026: trang đang bị ẩn (404) theo hồ sơ BCT mục 4.
  // Thêm lại CÙNG LÚC với việc xoá app/(public)/hoc-cu/layout.tsx.
  "/tin-tuc",
  "/vinh-danh",
  "/vinh-danh/tat-ca",
  "/tuyen-dung",
  "/lien-he",
  "/ve-chung-toi",
  // ─── 12 trang pháp lý của hồ sơ Bộ Công Thương ───────────────────────────
  // Spec này cảnh báo TRAN NGANG khi scrollWidth > 376px ở mobile — đúng thứ bắt lỗi
  // BẢNG 2 cột "mức hoàn trả" của /chinh-sach-cham-dut-dich-vu tràn ra khỏi màn hình.
  "/chinh-sach",
  "/chinh-sach-bao-mat",
  "/phuong-thuc-tiep-nhan-phan-anh",
  "/chinh-sach-gia",
  "/chinh-sach-thanh-toan",
  "/cac-dieu-kien-va-han-che",
  "/chinh-sach-giao-hang",
  "/phuong-thuc-cung-cap-dich-vu",
  "/chinh-sach-hoan-tra",
  "/chinh-sach-cham-dut-dich-vu",
  "/quyen-va-nghia-vu-cac-ben",
  "/dieu-khoan-su-dung",
  "/quyen-rieng-tu",
];

test(`site cong khai — ${MOBILE ? "375px" : "1280px"}`, async ({ page }) => {
  test.setTimeout(25 * 60_000);
  let truot = 0;
  let tran = 0;
  for (const r of ROUTES) {
    await page.goto(r, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);

    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (MOBILE && w > 376) {
      tran++;
      console.log("TRAN NGANG", r, w + "px");
    }

    const bad = (await page.evaluate(`(${AUDIT})()`)) as ChoTruot[];
    if (bad.length) {
      console.log("== " + r);
      for (const b of bad)
        console.log(
          `   ${b.ty}:1 (can ${b.can}) ${b.co}px  "${b.chu}"  ${b.mau} tren ${b.nen}  [${b.cls}]`,
        );
      truot += bad.length;
    }
  }
  console.log(
    `KET LUAN: truot AA ${truot} | tran ngang ${tran}/${ROUTES.length}`,
  );
});
