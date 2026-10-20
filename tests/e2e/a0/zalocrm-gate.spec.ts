/**
 * S1 (tích hợp ZaloCRM) — cổng vào màn `/zalo-crm`: cờ 2 pha + quyền + mục sidebar.
 *
 * Đi ké job CI `e2e-a0` (`.github/workflows/ci.yml`), Postgres LOCAL. KHÔNG chạy trên
 * Supabase — `resetDb()` chỉ chấp nhận `satarobo_test`/`ci_test`.
 *
 * ⚠️ HAI CHẾ ĐỘ, KHÔNG PHẢI "TEST BỊ TẮT":
 * Cờ `ZALOCRM_ENABLED` mặc định TẮT, và CI hiện chạy đúng như vậy. Bộ này vì thế kiểm
 * chế độ ĐANG CHẠY THẬT ([ZC-E2E-00]: cờ tắt ⇒ màn không tồn tại với cả SUPER_ADMIN) và
 * giữ sẵn ba ca của chế độ BẬT. Bật lên mà chạy:
 *
 *     ZALOCRM_ENABLED=true pnpm test:e2e:a0 -- zalocrm-gate
 *
 * (cả tiến trình test lẫn `webServer` của `playwright.a0.config.ts` cùng đọc process.env,
 *  nên một biến là đủ cho cả hai).
 *
 * ⚠️ ĐIỀU BỘ NÀY CỐ Ý KHÔNG KIỂM: nội dung bên trong khung nhúng. Fork ZaloCRM là repo
 * khác và ở GĐ0 chưa tồn tại — khung TRẮNG là kết quả ĐÚNG. Ca [ZC-E2E-03] chỉ soi có
 * đúng một thẻ `<iframe>` trỏ đúng origin, không hơn.
 *
 * ✅ ĐÃ CHẠY THẬT cả HAI chế độ (06/09/2026): tắt cờ 1/1 xanh, bật cờ 3/3 xanh.
 * Lần chạy đầu tiên đỏ 2 chỗ và cả hai đều là lỗi CỦA TEST, không phải của mã sản phẩm:
 *   · khoá mã HTTP 404 — `notFound()` chạy đúng, chỉ là Next đã chốt phần đầu phản hồi
 *     nên mã vẫn 200 (xem chú thích trong [ZC-E2E-00]);
 *   · soi mục sidebar khi nhóm accordion còn ĐÓNG — mục con chưa vào DOM, làm ca khẳng
 *     định HIỆN thì đỏ, còn hai ca khẳng định VẮNG thì xanh GIẢ. Vá bằng `moNhomSidebar`.
 *
 * ⚠️ Muốn chạy ở máy mình thì `.env.test` phải có `NEXTAUTH_URL=http://localhost:3100`
 * (đúng cổng của `playwright.a0.config.ts`). Trỏ nhầm cổng thì đăng nhập không dính
 * phiên và MỌI ca ở đây rơi về trang /login — triệu chứng trông y hệt "hỏng quyền".
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { loginAs } from "../_helpers/auth";
import { testEmail } from "../_helpers/fixtures";

const CO_BAT = process.env.ZALOCRM_ENABLED === "true";
const APP_URL = process.env.ZALOCRM_APP_URL ?? "";
const CO_CAU_HINH_DAY_DU = CO_BAT && Boolean(APP_URL) && Boolean(process.env.ZALOCRM_SSO_SECRET);

/** Mục sidebar — dùng nhãn chính xác như khai trong `components/admin/sidebar.tsx`. */
const MUC_SIDEBAR = "Zalo CRM";
/** Nhóm chứa mục, cũng lấy nguyên văn từ `components/admin/sidebar.tsx`. */
const NHOM_SIDEBAR = "CSKH & Phụ huynh";

/**
 * Mở nhóm sidebar chứa "Zalo CRM" rồi mới soi mục.
 *
 * 🔴 BẮT BUỘC GỌI TRƯỚC MỌI KHẲNG ĐỊNH VỀ MỤC — kể cả khẳng định PHỦ ĐỊNH.
 * Sidebar dựng nhóm dạng accordion và mặc định ĐÓNG: lúc đóng, mục con KHÔNG nằm
 * trong DOM. Nghĩa là `expect(muc).toHaveCount(0)` sẽ XANH ngay cả khi quyền hở toang
 * — nó chỉ đang đo "nhóm đang đóng", không đo "không có quyền". Ca [ZC-E2E-01] đỏ thật
 * lần chạy đầu tiên chính vì nhóm đóng, và nhờ đó lộ ra hai ca phủ định kia đang xanh
 * giả.
 *
 * Nhóm không tồn tại (vai không có mục nào trong nhóm) thì thôi — mục con lại càng
 * không thể có, và đó cũng là một kết quả đúng cho ca phủ định.
 */
async function moNhomSidebar(page: import("@playwright/test").Page): Promise<void> {
  const nut = page.getByRole("button", { name: NHOM_SIDEBAR });
  if ((await nut.count()) === 0) return;
  if ((await nut.getAttribute("aria-expanded")) === "true") return;
  await nut.click();
  await expect(nut).toHaveAttribute("aria-expanded", "true");
}

test.describe("[S1] Cổng vào màn Zalo CRM", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[ZC-E2E-00] cờ TẮT ⇒ màn không dựng được (ra màn 404) và mục sidebar ẩn — kể cả SUPER_ADMIN", async ({
    page,
  }) => {
    test.skip(CO_BAT, "Chế độ này chỉ đúng khi ZALOCRM_ENABLED chưa bật");

    await loginAs(page, {
      email: testEmail("zc-super-admin"),
      role: "SUPER_ADMIN",
      callbackUrl: "/admin/dashboard",
    });

    // "Tắt" nghĩa là KHÔNG TỒN TẠI, không phải "vào được rồi báo chưa bật".
    //
    // ⚠️ KIỂM THEO THỨ NGƯỜI DÙNG THẤY, KHÔNG THEO MÃ HTTP — có lý do, đừng "sửa lại
    // cho chặt". Bản đầu của ca này khẳng định `res.status() === 404` và ĐỎ ở CI với
    // 200. Đo lại thì `notFound()` CHẠY ĐÚNG (trang trả về đúng màn 404 của
    // `app/not-found.tsx`, không rò một mẩu nội dung Zalo CRM nào), chỉ có mã HTTP là
    // 200 vì Next đã chốt phần đầu phản hồi trước khi `notFound()` ném — hành vi của
    // khung, không phải của cổng quyền. Toàn repo cũng không có ca nào khác khoá mã
    // 404, nên khoá ở đây là tự đặt ra một quy ước riêng rồi tự vấp.
    //
    // Thứ THẬT SỰ phải đúng: người mở được là màn KHÔNG hiện, và màn 404 hiện thay.
    await page.goto("/admin/zalo-crm");
    await expect(
      page.getByRole("heading", { name: "Không tìm thấy trang" }),
      "cờ tắt phải ra màn 404, không phải màn Zalo CRM",
    ).toBeVisible();
    // Màn KHÔNG còn tiêu đề H1 (bỏ 07/09/2026 — khung nhúng đã mang thanh điều hướng
    // riêng), nên soi H1 ở đây là assert rỗng, luôn xanh kể cả khi cổng cờ hỏng. Soi
    // CHỮ trên trang: cờ tắt thì không một mẩu "Zalo CRM" nào được lọt ra, kể cả khối
    // hướng dẫn lẫn mục sidebar.
    await expect(
      page.getByText(/Zalo CRM/),
      "cờ tắt mà vẫn dựng được màn = cổng cờ hỏng",
    ).toHaveCount(0);
    await expect(page.locator("iframe"), "cờ tắt thì không được có khung nhúng nào").toHaveCount(0);

    await page.goto("/admin/dashboard");
    await moNhomSidebar(page);
    await expect(page.getByRole("link", { name: MUC_SIDEBAR })).toHaveCount(0);
  });

  test("[ZC-E2E-01] SALES_CSM thấy mục \"Zalo CRM\" và mở được màn", async ({ page }) => {
    test.skip(!CO_BAT, "Cần ZALOCRM_ENABLED=true (xem chú thích đầu file)");

    await loginAs(page, {
      email: testEmail("zc-sale"),
      role: "SALES_CSM",
      callbackUrl: "/admin/dashboard",
    });
    await page.goto("/admin/dashboard");

    // Menu và cổng trang đọc CÙNG một bảng `PAGE_GATES["/zalo-crm"]`, nên hai assert
    // dưới đây phải cùng đúng — lệch một chiều là dead-link, lệch chiều kia là hở quyền.
    await moNhomSidebar(page);
    const muc = page.getByRole("link", { name: MUC_SIDEBAR });
    await expect(muc).toBeVisible();

    await page.goto("/admin/zalo-crm");
    await expect(page).not.toHaveURL(/error=unauthorized/);
    // Ca này chỉ hỏi "vào được màn hay bị đá". Trước 07/09/2026 nó soi tiêu đề H1
    // "Zalo CRM"; H1 ấy đã bỏ (khung nhúng tự có thanh điều hướng), nên bằng chứng
    // "đã vào được" nay là ĐỊA CHỈ đứng yên tại màn + khối hướng dẫn dựng ra bên dưới.
    await expect(page).toHaveURL(/\/admin\/zalo-crm(\?|$)/);

    // Sale seed ở ca này CỐ Ý không có `UserOrgRole` ⇒ `actor.visibleCenterIds` rỗng ⇒
    // không tab nào, và màn hiện hướng dẫn thay vì khung nhúng. Đó là FAIL-CLOSED đúng
    // thiết kế (tầm nhìn cơ sở chỉ đến từ `UserOrgRole`, không suy từ `User.centerId`),
    // nên khẳng định luôn để người sau không "sửa" nó thành ra nới quyền.
    // Ca [ZC-E2E-03] mới là ca dựng đủ org + UserOrgRole và đòi có khung nhúng thật.
    await expect(page.getByRole("heading", { name: "Chưa mở được Zalo CRM" })).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("[ZC-E2E-02] Kế toán KHÔNG thấy mục và gõ thẳng URL thì bị đá về /dashboard", async ({
    page,
  }) => {
    test.skip(!CO_BAT, "Cần ZALOCRM_ENABLED=true (xem chú thích đầu file)");

    // `ACCOUNTANT` là mã vai v1 (enum `Role`) — local/CI chạy RBAC v1. Vai tương ứng ở
    // v2 là `CENTER_ACCOUNTANT`, cũng KHÔNG được cấp `zalocrm:use` (ca [ZC-Q-04] của L2
    // canh phía seed). Ở đây kiểm tầng chạy thật của môi trường này.
    await loginAs(page, {
      email: testEmail("zc-ke-toan"),
      role: "ACCOUNTANT",
      callbackUrl: "/admin/dashboard",
    });
    await page.goto("/admin/dashboard");
    await moNhomSidebar(page);
    await expect(page.getByRole("link", { name: MUC_SIDEBAR })).toHaveCount(0);

    // Giấu menu là chưa đủ — cổng phải đứng ở chính trang.
    await page.goto("/admin/zalo-crm");
    await expect(page).toHaveURL(/\/dashboard(\?|$)/);
    await expect(page).toHaveURL(/error=unauthorized/);
  });

  test("[ZC-E2E-03] có ĐÚNG MỘT iframe, trỏ đúng origin ZaloCRM, vé nằm trong #fragment", async ({
    page,
  }) => {
    test.skip(
      !CO_CAU_HINH_DAY_DU,
      "Cần ZALOCRM_ENABLED=true + ZALOCRM_APP_URL + ZALOCRM_SSO_SECRET",
    );

    // Màn chỉ dựng khung khi cơ sở đã ánh xạ orgCode VÀ người dùng nhìn thấy cơ sở đó.
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const center = await db.center.create({
      data: {
        code: "CS1",
        name: "CS1 — Nguyễn Hữu Thọ",
        slug: "zc-cs1",
        address: "211 Nguyễn Hữu Thọ",
      },
      select: { id: true },
    });
    // OrgUnit CS1 đã có sau seedOrg nhưng chưa trỏ Center (Center tạo sau) — nối lại.
    const orgUnit = await db.orgUnit.update({
      where: { code: "CS1" },
      data: { centerId: center.id },
      select: { id: true },
    });
    await db.systemSetting.upsert({
      where: { key: "zalocrm.orgCodes" },
      update: { valueJson: { CS1: "cs1" } },
      create: { key: "zalocrm.orgCodes", valueJson: { CS1: "cs1" } },
    });

    const user = await seedUser({
      email: testEmail("zc-qlcs"),
      role: "CENTER_MANAGER",
      centerId: center.id,
    });
    const role = await db.roleDef.findUniqueOrThrow({
      where: { code: "CENTER_MANAGER" },
      select: { id: true },
    });
    // Tầm nhìn cơ sở đến từ `UserOrgRole` (`actor.visibleCenterIds`) — không có dòng này
    // thì danh sách tab rỗng và trang hiện hướng dẫn thay vì khung nhúng.
    await db.userOrgRole.create({
      data: {
        userId: user.id,
        orgUnitId: orgUnit.id,
        roleId: role.id,
        grantedById: user.id, // cột bắt buộc (audit ai cấp) — trong test tự cấp cho mình
      },
    });

    await loginAs(page, {
      email: testEmail("zc-qlcs"),
      role: "CENTER_MANAGER",
      centerId: center.id,
      callbackUrl: "/admin/dashboard",
    });
    await page.goto("/admin/zalo-crm");

    const khung = page.locator("iframe");
    await expect(khung).toHaveCount(1);
    const src = await khung.getAttribute("src");
    expect(src, "iframe phải có src").toBeTruthy();
    expect(src!.startsWith(new URL(APP_URL).origin), `src sai origin: ${src}`).toBe(true);
    // Vé SSO nằm trong FRAGMENT — phần trước dấu `#` không được mang token, nếu không
    // nó rơi vào access log của mọi proxy trên đường đi.
    const [truocHash, sauHash] = src!.split("#");
    expect(truocHash).not.toContain("token");
    expect(sauHash ?? "").toContain("token=");
  });
});
