/**
 * FL1-04 — Trang "Tài liệu lớp tôi" (GV xem tài liệu giảng dạy của lớp mình).
 * Phác AC theo BA #07 US-LMS-3. Postgres LOCAL (.env.test). KHÔNG chạy CI nhánh này.
 *
 * AC bao phủ:
 *  - AC1: GV chỉ thấy lớp mình dạy (scope ASSIGNED); mở lớp → khung CT → buổi.
 *  - AC2: Mỗi buổi: present SCORM (tôn trọng SCORM_ENABLED) + bài tập của buổi (read-only).
 *  - AC3: Thống kê nộp bài (đã nộp / đã chấm / chưa nộp) phục vụ đánh giá cuối khoá.
 *  - AC4: READ-ONLY — không có nút sửa curriculum/lesson/SCORM/assignment.
 *  - AC5 (cách ly): GV không thấy lớp/cơ sở khác.
 *
 * Logic THUẦN (chọn lớp + thống kê) đã có unit test ở lib/teachers/materials.test.ts;
 * spec này phác kịch bản UI end-to-end (đăng nhập GV, điều hướng, kiểm chứng nội dung).
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.ADMIN_BASE_URL ?? "http://admin.localhost:3000";

test.describe("[FL1-04] Teaching materials (GV xem tài liệu lớp)", () => {
  test.skip(true, "Phác AC — chạy thủ công với seed GV + lớp + SCORM + bài tập trên DB test");

  test("[FL1-04-01] AC1 — GV mở /teaching-materials thấy đúng lớp mình dạy", async ({ page }) => {
    // Đăng nhập GV (teacherId của 1 lớp). Mở trang.
    await page.goto(`${BASE}/teaching-materials`);
    // Dropdown chỉ có lớp GV được phân công, không có lớp của GV khác.
    const options = page.locator('select[name="classId"] option');
    await expect(options).toHaveCount(2); // placeholder + đúng 1 lớp được giao
  });

  test("[FL1-04-02] AC1 — chọn lớp → hiện khung chương trình + danh sách buổi", async ({ page }) => {
    await page.goto(`${BASE}/teaching-materials?classId=__seed_class__`);
    await expect(page.getByText("Khung chương trình")).toBeVisible();
    await expect(page.getByText(/Buổi \d+:/)).toBeVisible();
  });

  test("[FL1-04-03] AC2 — buổi có gói SCORM PUBLISHED → nút Trình chiếu trỏ player", async ({ page }) => {
    await page.goto(`${BASE}/teaching-materials?classId=__seed_class__`);
    const present = page.getByRole("link", { name: /Trình chiếu/ });
    await expect(present).toBeVisible();
    // Link mở player kèm sessionId của buổi (gate canOpenScorm theo GV phân công).
    await expect(present).toHaveAttribute("href", /\/scorm\/play\/.+sessionId=/);
  });

  test("[FL1-04-04] AC2 — SCORM_ENABLED=false → ẩn phần trình chiếu, bài tập vẫn xem được", async ({ page }) => {
    await page.goto(`${BASE}/teaching-materials?classId=__seed_class__`);
    await expect(page.getByText(/SCORM.*đang tắt/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Trình chiếu/ })).toHaveCount(0);
  });

  test("[FL1-04-05] AC3 — thống kê nộp bài (đã nộp / đã chấm / chưa nộp)", async ({ page }) => {
    await page.goto(`${BASE}/teaching-materials?classId=__seed_class__`);
    await expect(page.getByText("Đã nộp")).toBeVisible();
    await expect(page.getByText("Đã chấm")).toBeVisible();
    await expect(page.getByText("Chưa nộp")).toBeVisible();
  });

  test("[FL1-04-06] AC4 — READ-ONLY: không có nút sửa/xoá LMS", async ({ page }) => {
    await page.goto(`${BASE}/teaching-materials?classId=__seed_class__`);
    await expect(page.getByRole("button", { name: /Sửa|Xoá|Lưu trữ|Phát hành/ })).toHaveCount(0);
  });

  test("[FL1-04-07] AC5 — cách ly: GV truyền classId lớp khác → không có quyền xem", async ({ page }) => {
    await page.goto(`${BASE}/teaching-materials?classId=__other_center_class__`);
    await expect(page.getByText(/không có quyền xem lớp này/)).toBeVisible();
  });
});
