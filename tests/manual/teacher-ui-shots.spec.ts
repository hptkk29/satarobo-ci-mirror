/**
 * Chụp màn site giáo viên để soi THIẾT KẾ (không phải test hồi quy).
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts teacher-ui-shots
 *   TEACHER_THEME=dark ... (chụp chế độ Tối)
 *
 * VÌ SAO CẦN. Site GV chỉ mở cho vai TEACHER, mà proxy đẩy tài khoản quản trị về
 * /admin — nên mở trình duyệt bằng phiên admin sẵn có sẽ KHÔNG bao giờ thấy được
 * màn giáo viên. Đây là đường ngắn nhất để nhìn thật trước/sau khi sửa giao diện.
 *
 * Tài khoản: seed cục bộ của prisma/seed-test-teacher.ts (chạy `pnpm tsx
 * prisma/seed-test-teacher.ts` nếu chưa có). Chạy trên dev server đang mở; ảnh ra
 * thư mục shots-teacher/ (đã .gitignore).
 */
import { test, type Page } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";

const EMAIL = process.env.TEACHER_EMAIL ?? "giaovien.test@satarobo.vn";
const PW = process.env.TEACHER_PW ?? "Test@1234";

const ROUTES: Array<[string, string]> = [
  ["/teacher", "00-viec-hom-nay"],
  ["/teacher/lich", "01-lich"],
  ["/teacher/lop", "02-lop"],
  ["/teacher/diem-danh", "03-diem-danh"],
  ["/teacher/cham-bai", "04-cham-bai"],
  ["/teacher/hoc-ba", "05-hoc-ba"],
  ["/teacher/hoc-vien", "06-hoc-vien"],
  ["/teacher/tai-lieu", "07-tai-lieu"],
  ["/teacher/anh-lop", "08-anh-lop"],
  ["/teacher/bang-cong", "09-bang-cong"],
  ["/teacher/ho-so", "10-ho-so"],
  ["/teacher/huong-dan", "11-huong-dan"],
];

async function shoot(page: Page, path: string, name: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `shots-teacher/${name}.png`, fullPage: true });
}

test("chup man giao vien", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await sharedLogin(page, { email: EMAIL, password: PW, timeout: 120_000 });
  if (process.env.TEACHER_THEME === "dark") {
    // Sáng/Tối lưu ở localStorage của chính site GV (không phải <html>) — xem
    // _components/teacher-theme.tsx. Phải vào một trang /teacher trước để có origin.
    await page.goto("/teacher", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("teacher-theme", "dark"));
  }
  for (const [path, name] of ROUTES) {
    try {
      await shoot(page, path, name);
    } catch (e) {
      console.log("BO QUA", path, String(e).slice(0, 120));
    }
  }
});
