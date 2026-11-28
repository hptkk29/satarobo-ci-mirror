/**
 * [QO-07] V9.5 — QoMkt (chế độ chỉ-đọc cho Marketing), QoHocVienTT (trạng thái KHÔNG QUYỀN), QoCNPrompt (hộp prompt giấy chứng nhận).
 * Trình duyệt THẬT + Postgres thật + đăng nhập bằng form. Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG (Đào tạo thấy phần ngược lại).
 */
import { mkdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { db } from "../../../lib/db";
import { taoKhoa } from "../../../lib/elearning-online/khoa-hoc";
import { capQuyenHoc } from "../../../lib/elearning-online/quyen-hoc-db"; // import TĨNH: `await import()` chết ở bộ nạp của Playwright
import { donBangOnl } from "../../elearning/_onl-don";
import { dungSauVai, EMAIL, type BoSauVai, type Nhan } from "./_helpers/sau-vai";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/onl-shots";
let B: BoSauVai;
let courseId = "";
const TEN_KHOA = "E2E Khoá chỉ-đọc";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(480_000);
  B = await dungSauVai(browser);
  await donBangOnl(db);
  const t = await taoKhoa(db, { code: `E2E-QO7-${Date.now().toString(36).toUpperCase()}`, name: TEN_KHOA, listPrice: 990000, salePrice: 890000, validityMonths: 12, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  courseId = t.courseId;
  await db.onlCourse.update({ where: { id: courseId }, data: { shortDescription: "Con lập trình robot ảo tự thoát mê cung", fullDescription: "Giới thiệu đầy đủ của khoá E2E" } });
  mkdirSync(ANH, { recursive: true });
});
test.afterAll(async () => {
  await donBangOnl(db);
});

async function vao(page: Page, nhan: Nhan, duongDan: string) {
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(B.hu.get(nhan)!);
  await page.goto(duongDan);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}
const chup = async (page: Page, ten: string) => {
  const toi = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
  await page.screenshot({ path: `${ANH}/${ten}-${page.viewportSize()?.width ?? 0}${toi ? "-dark" : ""}.png`, fullPage: true });
};
const tabs = (page: Page) => page.getByRole("navigation", { name: "Các phần của khoá" });
const KHOA = () => `/elearning/online/khoa/${courseId}`;

test("[QO-07a] QoMkt — Marketing: huy hiệu 'Chỉ đọc', ĐÚNG 4 tab, Nội dung public có mô tả; đối chứng: Đào tạo thấy tab quản trị và KHÔNG có tab 'Nội dung public'", async ({ page }) => {
  await vao(page, "MARKETING", KHOA());
  await expect(page.getByRole("heading", { level: 1, name: TEN_KHOA })).toBeVisible();
  await expect(page.getByText("Chỉ đọc", { exact: true })).toBeVisible();
  await expect(page.getByText("Không sửa, không xem điểm, không cấp quyền")).toBeVisible();
  const nav = tabs(page);
  await expect(nav.getByRole("link")).toHaveText(["Tổng quan", "Nội dung public", "Giá & khuyến mãi", "Báo cáo"]);
  for (const an of ["Chương & bài", "Kiểm tra & thi", "Chấm bài", "Quản lý học viên", "Chứng nhận", "Cài đặt học tập", "Phiên bản và lịch sử"]) await expect(nav.getByRole("link", { name: an })).toHaveCount(0);
  await nav.getByRole("link", { name: "Nội dung public" }).click();
  await expect(page.getByText("Con lập trình robot ảo tự thoát mê cung")).toBeVisible();
  await expect(page.getByText("Giới thiệu đầy đủ của khoá E2E")).toBeVisible();
  await expect(page.getByText("Khoá chưa phát hành — chưa có bài học thử công khai.")).toBeVisible();
  await chup(page, "qo-mkt-noi-dung-public");

  await vao(page, "DAO_TAO", KHOA());
  await expect(page.getByRole("heading", { level: 1, name: TEN_KHOA })).toBeVisible();
  const nd = tabs(page);
  for (const co of ["Chương & bài", "Kiểm tra & thi", "Quản lý học viên", "Cài đặt học tập", "Phiên bản và lịch sử"]) await expect(nd.getByRole("link", { name: co })).toBeVisible();
  await expect(nd.getByRole("link", { name: "Nội dung public" })).toHaveCount(0);
  await expect(page.getByText("Chỉ đọc", { exact: true })).toHaveCount(0);
});

test("[QO-07b] QoMkt — Báo cáo của Marketing: có số liệu tổng hợp nhưng KHÔNG có khối điểm theo đề; đối chứng: Đào tạo thấy khối điểm", async ({ page }) => {
  await vao(page, "MARKETING", `${KHOA()}?tab=bao-cao`);
  await expect(page.getByText("Tổng quyền học")).toBeVisible(); // dương: báo cáo tổng hợp có
  await expect(page.getByText("Điểm theo đề chỉ dành cho người soạn đề và người chấm")).toBeVisible();
  await expect(page.getByText("Đề kiểm tra và thi", { exact: true })).toHaveCount(0);
  await vao(page, "DAO_TAO", `${KHOA()}?tab=bao-cao`);
  await expect(page.getByText("Tổng quyền học")).toBeVisible();
  await expect(page.getByText("Đề kiểm tra và thi", { exact: true })).toBeVisible();
});

test("[QO-07c] QoHocVienTT — gõ thẳng tab bị ẩn: Marketing thấy trạng thái KHÔNG QUYỀN (không lặng lẽ về Tổng quan); đối chứng: Đào tạo vào được tab", async ({ page }) => {
  for (const tab of ["hoc-vien", "cai-dat", "chuong-bai"]) {
    await vao(page, "MARKETING", `${KHOA()}?tab=${tab}`);
    await expect(page.getByRole("alert").filter({ hasText: "Bạn không có quyền xem phần này" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Về tổng quan" })).toBeVisible();
  }
  await chup(page, "qo-hoc-vien-khong-quyen");
  await vao(page, "DAO_TAO", `${KHOA()}?tab=hoc-vien`);
  await expect(page.getByRole("heading", { level: 1, name: TEN_KHOA })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Bạn không có quyền xem phần này" })).toHaveCount(0);
  // người học thuần cũng bị chặn ở cửa trang (không có onl:course:view)
  await vao(page, "HOC_VIEN", KHOA());
  await expect(page.getByText(/không có quyền/i).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: TEN_KHOA })).toHaveCount(0);
});

test("[QO-07d] QoCNPrompt — tab Cài đặt: thẻ 'Giấy chứng nhận của khoá' NÓI THẲNG phần chưa có; hộp prompt mang tên khoá, bỏ dòng chữ ký khi chưa nhập, có dòng khi nhập đủ; sao chép được", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await vao(page, "DAO_TAO", `${KHOA()}?tab=cai-dat`);
  const the = page.getByRole("region", { name: "Giấy chứng nhận của khoá" });
  await expect(the).toBeVisible();
  await expect(the.getByText("Mẫu riêng của khoá chưa dùng được")).toBeVisible();
  // không có nút giả
  for (const an of ["Tải phôi lên", "Xem mẫu giấy chứng nhận", "Duyệt mẫu này", "Lưu vào bản nháp"]) await expect(page.getByRole("button", { name: an })).toHaveCount(0);
  // Chờ hydration: mở hộp bằng toPass
  const hop = page.getByRole("dialog", { name: `Prompt giấy chứng nhận · ${TEN_KHOA}` });
  await expect(async () => {
    await the.getByRole("button", { name: "Prompt giấy chứng nhận" }).click();
    await expect(hop).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  const pre = hop.getByLabel("Nội dung prompt");
  await expect(pre).toContainText(`Khoá học: ${TEN_KHOA} · Đối tượng nhận: Học viên.`);
  await expect(pre).toContainText("A4 nằm ngang, 3508 × 2480 px (300 dpi)");
  await expect(pre).not.toContainText("chữ ký"); // chưa nhập người ký ⇒ không bịa
  await hop.getByLabel("Người ký (tuỳ chọn)").fill("Nguyễn Văn A");
  await expect(pre).not.toContainText("chữ ký"); // chỉ một nửa ⇒ vẫn bỏ
  await hop.getByLabel("Chức danh (tuỳ chọn)").fill("Giám đốc");
  await expect(pre).toContainText('chữ ký và dòng "Nguyễn Văn A – Giám đốc" ở góc dưới phải');
  await chup(page, "qo-cn-prompt");
  await hop.getByRole("button", { name: "Sao chép prompt" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`Khoá học: ${TEN_KHOA}`);
  await hop.getByRole("button", { name: "Đóng" }).click();
  await expect(hop).toBeHidden();
  void EMAIL;
});

test("[QO-07e] QoGiaHan — hộp 'Gia hạn': bảng xem trước (Khoá · Nguồn · Hạn hiện tại · Hạn mới) và HẠN MỚI GHI VÀO DB = hạn mới đã xem trước; đối chứng: nút Gia hạn không vẽ cho người không có quyền cấp", async ({ page }) => {
  await db.student.deleteMany({ where: { name: { startsWith: "E2E_ONL_GH" } } });
  const hv = await db.student.create({ data: { name: "E2E_ONL_GH Lê Minh Khang", parentName: "Lê Thị Mỹ Duyên", parentPhone: "0914663005" }, select: { id: true } });
  const cap = await capQuyenHoc(db, { studentId: hv.id, courseId, loai: "CAP_MIEN_PHI", now: new Date(), idempotencyKey: `e2e-gh-${Date.now()}` });
  if (!cap.ok) throw new Error(cap.thongBao);
  const truoc = await db.onlEntitlement.findFirstOrThrow({ where: { studentId: hv.id, courseId }, select: { expiresAt: true } });
  expect(truoc.expiresAt, "khoá fixture có hạn 12 tháng").not.toBeNull();

  await vao(page, "DAO_TAO", `${KHOA()}?tab=hoc-vien`);
  const dong = page.getByRole("row").filter({ hasText: "E2E_ONL_GH Lê Minh Khang" });
  await expect(dong).toBeVisible();
  const hop = page.getByRole("dialog", { name: /Gia hạn quyền học/ });
  await expect(async () => {
    await dong.getByRole("button", { name: "Gia hạn" }).click();
    await expect(hop).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  const xt = hop.getByRole("group", { name: "Xem trước gia hạn" }).or(hop.locator('dl[aria-label="Xem trước gia hạn"]'));
  await expect(xt).toContainText(TEN_KHOA);
  await expect(xt).toContainText("Cấp miễn phí"); // nguồn hiện tại
  await expect(xt).toContainText("thêm 12 tháng theo khoá");
  const dinhDang = (d: Date) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(d);
  await expect(xt).toContainText(dinhDang(truoc.expiresAt!)); // hạn hiện tại
  await hop.getByLabel("Lý do (≥ 10 ký tự)").fill("Gia hạn theo yêu cầu phụ huynh E2E");
  const xtText = (await xt.textContent()) ?? ""; // đọc TRƯỚC khi gửi (hộp đóng sau khi gia hạn)
  await chup(page, "qo-gia-han-hop");
  await hop.getByRole("button", { name: "Gia hạn", exact: true }).click();
  await expect.poll(async () => (await db.onlEntitlement.findFirstOrThrow({ where: { studentId: hv.id, courseId }, select: { expiresAt: true } })).expiresAt?.getTime(), { timeout: 20_000 }).toBeGreaterThan(truoc.expiresAt!.getTime());
  const sau = await db.onlEntitlement.findFirstOrThrow({ where: { studentId: hv.id, courseId }, select: { expiresAt: true } });
  expect(xtText, "hạn mới đã xem trước = hạn mới đã ghi").toContain(dinhDang(sau.expiresAt!));

  // đối chứng ÂM: Marketing không thấy tab học viên ⇒ không có nút Gia hạn nào
  await vao(page, "MARKETING", `${KHOA()}?tab=hoc-vien`);
  await expect(page.getByRole("button", { name: "Gia hạn" })).toHaveCount(0);
  await db.student.deleteMany({ where: { name: { startsWith: "E2E_ONL_GH" } } }).catch(() => undefined);
});
