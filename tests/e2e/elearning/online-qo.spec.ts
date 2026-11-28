/**
 * [QO-*] E-learning ONLINE — HÀNH VI THẬT trong trình duyệt (Đào tạo đăng nhập): tạo khoá → soạn chương/bài → phát hành → cấp/thu hồi quyền.
 * Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG (người thiếu quyền bị chặn; người có quyền thấy).
 *
 * Chụp ảnh các màn Qo* ở khổ hiện tại (1440 / 375) vào `E:\tmp\onl-shots` để so với bộ thiết kế 20/11 — việc so ảnh là bước tay, KHÔNG phải khẳng định của spec.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { db } from "../../../lib/db";
import { donBangOnl } from "../../elearning/_onl-don";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/onl-shots";
const TEN_KHOA = "E2E Robot cho bé";
const MA_KHOA = "E2E-ONL-1";
let d: BoDuLieu;
let courseUrl = "";
let hocVienOnlineId = "";
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: "E2E_ONL_" } } });
  const hv = await db.student.create({ data: { name: "E2E_ONL_Nguyen Gia Huy", parentName: "Nguyễn Thu Hà", parentPhone: "0905412118" }, select: { id: true } });
  hocVienOnlineId = hv.id;
  mkdirSync(ANH, { recursive: true });
  for (const email of [d.daoTaoEmail, d.hocVienEmail]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email, callbackUrl: "/elearning" });
    await expect(p).toHaveURL(/\/elearning/);
    cookie.set(email, await ctx.cookies());
    await ctx.close();
  }
});
test.afterAll(async () => {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: "E2E_ONL_" } } });
});

async function vao(page: Page, email: string, duongDan: string) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookie.get(email)!);
  await page.goto(duongDan);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}
const chup = async (page: Page, ten: string) => {
  const toi = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
  await page.screenshot({ path: `${ANH}/${ten}-${page.viewportSize()?.width ?? 0}${toi ? "-dark" : ""}.png`, fullPage: true });
};
/** Không tràn ngang ở cấp TRANG. Thất bại thì nói PHẦN TỬ nào thò ra (ngoài mọi vùng `overflow-x-auto`) — bằng không chỉ biết "dư N px". */
const khongTranNgang = async (page: Page) => {
  const du = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (du <= 1) return;
  const loi = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest(".overflow-x-auto") && getComputedStyle(e).position !== "fixed")
      .slice(0, 6)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.getAttribute("class") ?? "").slice(0, 60)} → ${Math.round(e.getBoundingClientRect().right)}px`),
  );
  expect(loi, `trang dư ${du}px ở khổ ${page.viewportSize()?.width}`).toEqual([]);
};

test.describe("[QO-01] vào khu Online: cờ + quyền", () => {
  test("🔴 Đào tạo THẤY danh sách khoá online và nút Tạo; người học (giáo viên) bị CHẶN (đối chứng dương + âm)", async ({ page }) => {
    await vao(page, d.daoTaoEmail, "/elearning/online");
    await expect(page.getByRole("heading", { name: "Khoá online", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tạo khoá online" })).toBeVisible();
    await chup(page, "qo-danh-sach-rong");
    await vao(page, d.hocVienEmail, "/elearning/online");
    await expect(page.getByRole("link", { name: "Tạo khoá online" })).toHaveCount(0);
    await expect(page.getByText(/onl:course:view/)).toBeVisible();
    await vao(page, d.hocVienEmail, "/elearning/online/tao");
    await expect(page.getByRole("button", { name: "Tạo khoá" })).toHaveCount(0);
  });
});

test.describe("[QO-02] tạo khoá → soạn → phát hành", () => {
  test("tạo khoá bằng form: đủ thông tin ⇒ sang trang khoá, tab Chương & bài; mã trùng bị từ chối", async ({ page }) => {
    await vao(page, d.daoTaoEmail, "/elearning/online/tao");
    await chup(page, "qo-tao");
    await page.getByLabel("Tên khoá *").fill(TEN_KHOA);
    await page.getByLabel("Mã khoá *").fill(MA_KHOA);
    await page.getByLabel("Giá niêm yết (đ) *").fill("690000");
    await page.getByLabel("Giá bán (đ) *").fill("590000");
    await page.getByRole("button", { name: "Tạo khoá" }).click();
    await expect(page).toHaveURL(/\/elearning\/online\/khoa\/[^/]+\?tab=chuong-bai/);
    courseUrl = new URL(page.url()).pathname;
    await expect(page.getByText("Chưa có chương nào")).toBeVisible();

    // mã trùng
    await vao(page, d.daoTaoEmail, "/elearning/online/tao");
    await page.getByLabel("Tên khoá *").fill("Khoá khác");
    await page.getByLabel("Mã khoá *").fill(MA_KHOA);
    await page.getByRole("button", { name: "Tạo khoá" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("Mã khoá đã tồn tại");
  });

  test("soạn chương và bài: thêm chương, thêm bài đọc, sửa nội dung bài — lưu và còn sau khi tải lại", async ({ page }) => {
    await vao(page, d.daoTaoEmail, `${courseUrl}?tab=chuong-bai`);
    await page.getByLabel("Chương mới").fill("Làm quen với robot");
    await page.getByRole("button", { name: "Thêm chương" }).click();
    await expect(page.getByText("Làm quen với robot")).toBeVisible();
    await page.getByLabel("Loại bài").selectOption("READ");
    await page.getByLabel("Tên bài mới").fill("Robot là gì?");
    await page.getByRole("button", { name: "Thêm bài", exact: true }).click();
    await expect(page.getByText("Robot là gì?")).toBeVisible();
    await page.getByRole("button", { name: "Sửa", exact: true }).first().click();
    await page.getByLabel("Nội dung bài đọc").fill("Robot là cỗ máy tự động.");
    await page.getByRole("button", { name: "Lưu bài" }).click();
    await page.reload();
    await expect(page.getByText("Robot là gì?")).toBeVisible();
    await chup(page, "qo-chuong-bai");
    await khongTranNgang(page);
  });

  test("🔴 phát hành lần đầu qua wizard: phải gõ PHAT HANH; sau đó bản 1 'Đang chạy' và có thể mở bán", async ({ page }) => {
    await vao(page, d.daoTaoEmail, courseUrl);
    await page.getByRole("link", { name: "Phát hành bản mới" }).click();
    await expect(page.getByText("lần phát hành đầu tiên", { exact: false })).toBeVisible();
    await chup(page, "qo-phat-hanh-1");
    await page.getByRole("button", { name: "Tiếp tục" }).click();
    const nut = page.getByRole("button", { name: "Phát hành", exact: true });
    await expect(nut).toBeDisabled(); // chưa gõ xác nhận
    await page.getByLabel(/Gõ/).fill("phat hanh"); // sai chữ thường ⇒ vẫn khoá
    await expect(nut).toBeDisabled();
    await page.getByLabel(/Gõ/).fill("PHAT HANH");
    await expect(nut).toBeEnabled();
    await chup(page, "qo-phat-hanh-3");
    await nut.click();
    await expect(page).toHaveURL(/tab=phien-ban/);
    await expect(page.getByText("Đang chạy").first()).toBeVisible();
    await chup(page, "qo-phien-ban");

    // mở bán
    await vao(page, d.daoTaoEmail, courseUrl);
    await page.getByLabel("Trạng thái bán").selectOption("ON_SALE");
    await page.getByRole("button", { name: "Đổi", exact: true }).click();
    await expect(page.getByText("Đang bán").first()).toBeVisible();
    await chup(page, "qo-tong-quan");
  });
});

test.describe("[QO-03] quản lý học viên trong khoá", () => {
  test("🔴 cấp quyền miễn phí: bắt buộc lý do; cấp xong học viên hiện dưới phụ huynh với hạn; THU HỒI ⇒ biến khỏi bảng, hiện lại khi lọc 'Đã thu hồi'", async ({ page }) => {
    await vao(page, d.daoTaoEmail, `${courseUrl}?tab=hoc-vien`);
    await expect(page.getByText("Khoá chưa có học viên")).toBeVisible(); // trạng thái rỗng theo QoHocVienTT (V9.5)
    await page.getByRole("button", { name: "Cấp quyền miễn phí" }).click();
    const hop = page.getByRole("dialog", { name: "Cấp quyền học miễn phí" });
    await hop.getByLabel("Tìm học viên").fill("E2E_ONL_Nguyen");
    await hop.getByRole("button", { name: "Tìm", exact: true }).click();
    await hop.getByRole("button", { name: /E2E_ONL_Nguyen Gia Huy/ }).click();
    const cap = hop.getByRole("button", { name: "Cấp quyền", exact: true });
    await expect(cap).toBeDisabled(); // chưa có lý do
    await hop.getByLabel("Lý do (≥ 10 ký tự)").fill("Học bổng thử nghiệm E2E");
    await expect(cap).toBeEnabled();
    await cap.click();
    await expect(page.getByText("Nguyễn Thu Hà")).toBeVisible();
    await expect(page.getByText("E2E_ONL_Nguyen Gia Huy")).toBeVisible();
    await expect(page.locator("td", { hasText: "Cấp miễn phí" })).toBeVisible();
    await expect(page.getByText("1 con trong khoá")).toBeVisible();
    await chup(page, "qo-hoc-vien");
    await khongTranNgang(page);

    // DB: đúng một dòng quyền + một sự kiện GRANTED kèm lý do và người thực hiện
    const q = await db.onlEntitlement.findFirstOrThrow({ where: { studentId: hocVienOnlineId }, include: { events: true } });
    expect(q).toMatchObject({ status: "ACTIVE", source: "FREE_GRANT" });
    expect(q.events).toHaveLength(1);
    expect(q.events[0]).toMatchObject({ kind: "GRANTED", reason: "Học bổng thử nghiệm E2E", actorUserId: d.daoTaoId });

    // lịch sử
    await page.getByRole("button", { name: "Lịch sử" }).click();
    await expect(page.getByRole("dialog", { name: /Lịch sử quyền học/ }).getByText("Cấp quyền")).toBeVisible();
    await page.keyboard.press("Escape");

    // thu hồi
    await page.getByRole("button", { name: "Thu hồi", exact: true }).click();
    const th = page.getByRole("dialog", { name: /Thu hồi quyền học/ });
    await expect(th.getByRole("button", { name: "Thu hồi quyền" })).toBeDisabled();
    await th.getByLabel(/Lý do/).fill("Hoàn tiền theo yêu cầu phụ huynh");
    await th.getByRole("button", { name: "Thu hồi quyền" }).click();
    await expect(page.getByText("Khoá chưa có học viên")).toBeVisible(); // mặc định ẩn quyền đã thu hồi
    await page.goto(`${courseUrl}?tab=hoc-vien&tt=THU_HOI`);
    await expect(page.getByText("E2E_ONL_Nguyen Gia Huy")).toBeVisible(); // lọc đúng ⇒ thấy
    await expect(page.locator("td", { hasText: "Đã thu hồi" }).first()).toBeVisible();
    expect((await db.onlEntitlement.findFirstOrThrow({ where: { studentId: hocVienOnlineId } })).status).toBe("REVOKED");
  });

  test("🔴 người học (giáo viên) KHÔNG xem được học viên trong khoá, kể cả gõ thẳng địa chỉ", async ({ page }) => {
    await vao(page, d.hocVienEmail, `${courseUrl}?tab=hoc-vien`);
    await expect(page.getByText("E2E_ONL_Nguyen Gia Huy")).toHaveCount(0);
    await expect(page.getByText(/onl:course:view/)).toBeVisible();
  });
});

test.describe("[QO-04] danh sách có khoá + danh mục + sắp thứ tự", () => {
  test("danh sách hiện khoá vừa tạo với nhãn Bản 1 và Đang bán; danh mục thêm được; trang sắp thứ tự mở được", async ({ page }) => {
    await vao(page, d.daoTaoEmail, "/elearning/online");
    await expect(page.getByRole("link", { name: TEN_KHOA })).toBeVisible();
    await expect(page.getByText("Bản 1", { exact: true })).toBeVisible();
    await chup(page, "qo-danh-sach");
    await khongTranNgang(page);
    await vao(page, d.daoTaoEmail, "/elearning/online/danh-muc");
    await page.getByLabel("Tên danh mục mới").fill("Lập trình robot ảo");
    await page.getByRole("button", { name: "Thêm", exact: true }).click();
    await expect(page.locator("li span", { hasText: "Lập trình robot ảo" })).toBeVisible();
    await chup(page, "qo-danh-muc");
    await vao(page, d.daoTaoEmail, "/elearning/online/sap-xep");
    await expect(page.getByText(TEN_KHOA)).toBeVisible();
    await chup(page, "qo-sap-xep");
  });
});

test.describe("[QO-05] kiểm tra & thi + chấm bài + chứng nhận", () => {
  test("🔴 tab Kiểm tra & thi: thêm câu hỏi chọn một, tạo đề ĐANG DÙNG từ câu đó, gắn vào bài; Giáo viên (không có quyền) KHÔNG thấy tab nào của ba tab này", async ({ page }) => {
    await vao(page, d.daoTaoEmail, `${courseUrl}?tab=kiem-tra`);
    await page.getByLabel("Nội dung câu hỏi *").fill("1 + 1 bằng mấy?");
    await page.getByRole("textbox", { name: "Lựa chọn 1" }).fill("2");
    await page.getByRole("textbox", { name: "Lựa chọn 2" }).fill("3");
    await page.getByRole("button", { name: "Thêm câu hỏi", exact: true }).click();
    await expect(page.getByText("1 + 1 bằng mấy?")).toBeVisible();
    await page.getByRole("button", { name: "Tạo đề mới" }).click();
    await page.getByLabel("Tên đề *").fill("Kiểm tra chương 1");
    await page.getByLabel("Trạng thái").selectOption("ACTIVE");
    await page.getByRole("form", { name: "Tạo đề mới" }).getByText("1 + 1 bằng mấy?").click();
    await page.getByRole("button", { name: "Lưu đề" }).click();
    await expect(page.getByText("Kiểm tra chương 1")).toBeVisible();
    await expect(page.getByText("1 câu · đạt 70%")).toBeVisible();
    await chup(page, "qo-kiem-tra");
    await khongTranNgang(page);
    const de = await db.onlAssessment.findFirstOrThrow({ where: { title: "Kiểm tra chương 1" }, include: { questions: true } });
    expect(de).toMatchObject({ status: "ACTIVE", kind: "QUIZ", passPercent: 70 });
    expect(de.questions).toHaveLength(1);
    // đáp án đúng đã lưu ở máy chủ nhưng KHÔNG nằm trong HTML của trang
    expect(await page.content()).not.toContain('"correct"');

    // tab chứng nhận + chấm bài mở được
    await vao(page, d.daoTaoEmail, `${courseUrl}?tab=chung-nhan`);
    await expect(page.getByText("Chưa có chứng nhận nào")).toBeVisible();
    await vao(page, d.daoTaoEmail, `${courseUrl}?tab=cham-bai`);
    await expect(page.getByText("Không có bài nào đang chờ chấm")).toBeVisible();
    await chup(page, "qo-cham-bai");

    // âm: giáo viên không có quyền ⇒ không có tab; gõ thẳng tab ⇒ rơi về Tổng quan (không lộ ngân hàng câu hỏi)
    await vao(page, d.hocVienEmail, `${courseUrl}?tab=kiem-tra`);
    await expect(page.getByText("1 + 1 bằng mấy?")).toHaveCount(0);
  });
});
