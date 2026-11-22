/**
 * Đo TƯƠNG PHẢN CHỮ ở chế độ Tối của site giáo viên (WCAG AA).
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts teacher-dark-contrast
 *
 * VÌ SAO CẦN MÁY ĐO. Chế độ Tối của site GV chuyển từ "mỗi chỗ tự cân bằng tay
 * bằng `dark:text-amber-300`" sang "token tự đảo". Nhìn mắt thường vài màn không
 * đủ để nói cả site đọc được — chữ nhạt trên nền nhạt trông vẫn "có vẻ ổn" trong
 * ảnh chụp. Đây đo từng nút chữ: màu chữ so với nền THỰC (đã trộn alpha của các
 * lớp nền phía sau), rồi đối chiếu ngưỡng AA (4,5:1 chữ thường / 3:1 chữ lớn).
 *
 * Bỏ qua: nút chữ rỗng, phần tử ẩn, và `sr-only` (không ai nhìn bằng mắt).
 */
import { test } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";
import { AUDIT, type ChoTruot } from "./_contrast";

const EMAIL = process.env.TEACHER_EMAIL ?? "giaovien.test@satarobo.vn";
const PW = process.env.TEACHER_PW ?? "Test@1234";

const ROUTES = [
  "/teacher",
  "/teacher/lich",
  "/teacher/lop",
  "/teacher/diem-danh",
  "/teacher/cham-bai",
  "/teacher/hoc-ba",
  "/teacher/hoc-vien",
  "/teacher/tai-lieu",
  "/teacher/anh-lop",
  "/teacher/bang-cong",
  "/teacher/ho-so",
  "/teacher/kho-bai-tap",
  "/teacher/hoan-thanh",
  "/teacher/nhan-xet",
  "/teacher/trial",
  "/teacher/don-tu",
  "/teacher/huong-dan",
];

/** TEACHER_THEME=light để đo chế độ Sáng (mặc định: Tối). */
const THEME = process.env.TEACHER_THEME === "light" ? "light" : "dark";

test(`tuong phan che do ${THEME}`, async ({ page }) => {
  test.setTimeout(25 * 60_000);
  await sharedLogin(page, { email: EMAIL, password: PW, timeout: 120_000 });
  await page.goto("/teacher", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("teacher-theme", t), THEME);

  let total = 0;
  for (const r of ROUTES) {
    await page.goto(r, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const dangToi = await page.evaluate(
      () => !!document.querySelector(".teacher-root.dark"),
    );
    if (dangToi !== (THEME === "dark")) {
      console.log("BO QUA (khong vao dung che do):", r);
      continue;
    }
    // Playwright coi chuỗi là BIỂU THỨC: `() => {}` trả về chính hàm (không chạy).
    // Phải tự gọi bằng IIFE thì mới lấy được kết quả.
    const bad = (await page.evaluate(`(${AUDIT})()`)) as ChoTruot[];
    if (bad.length) {
      console.log("== " + r);
      for (const b of bad)
        console.log(
          `   ${b.ty}:1 (can ${b.can}) ${b.co}px  "${b.chu}"  ${b.mau} tren ${b.nen}  [${b.cls}]`,
        );
      total += bad.length;
    }
  }
  console.log(`TONG CHO TRUOT AA (${THEME}):`, total);
});
