/**
 * Invoice Hub — NGHIỆM THU GIAO DIỆN TRÊN TRÌNH DUYỆT THẬT (Chromium) chạy trên bản build production.
 * Cấu hình + cách chạy: `playwright.hoa-don-hub.config.ts`.
 *
 * Phủ: khu Hoá đơn điện tử (tab Cảnh báo & Cấu hình, bộ lọc giữ qua đổi tab, phân quyền theo cơ sở, trạng thái rỗng),
 * Sale ở chi tiết đơn (tạo mã QR → phụ huynh điền ở trang CÔNG KHAI → áp dụng vào đơn), mục Học phí của phụ huynh
 * (+ cổng sở hữu của route tải PDF), và độ rộng 320 → 7680px.
 *
 * ⚠️ Luật 12 — mọi ca "KHÔNG thấy / bị chặn" kèm ĐỐI CHỨNG DƯƠNG (vai kia THẤY): ca khẳng định sự vắng mặt luôn xanh khi tính
 * năng hỏng hoàn toàn.
 * ⚠️ Giới hạn đã biết, ghi trong báo cáo chứ không giấu: RBAC v2 TẮT ở máy dev (prod BẬT) — quyền lấy từ `UserOrgRole` + `RoleDef`
 * như prod nhưng cờ `RBAC_V2_ENABLED` không bật; kho R2 là GIẢ (không phát byte PDF thật).
 */
import { test, expect, type Page } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser, disconnectDb } from "../_helpers/seed";
import { login } from "../_helpers/auth";
import { doTranNgang } from "../_helpers/tran-ngang";
import { quetMan, cao } from "../_helpers/quet-375";

const T = "fx-hub-";
const DO_RONG = [320, 375, 768, 1024, 1440, 1920, 3840, 7680] as const;
const cao_cua = (w: number) => (w >= 3840 ? 2160 : w >= 1440 ? 1000 : 800);

const ctx = {
  cs1: "", cs2: "", ou1: "", ou2: "", ouHo: "",
  sa: "", kt1: "", sale1: "", phA: "", phB: "", phC: "",
  don1: `${T}don1`, don2: `${T}don2`, donCs2: `${T}don-cs2`, donPh: `${T}don-ph`,
  hdPh: `${T}hd-ph`, hs: "", donPhC: `${T}don-phc`, hdPhC: `${T}hd-phc`,
};
const EM = {
  sa: "sa@hub.test", kt1: "kt1@hub.test", sale1: "sale1@hub.test", phA: "pha@hub.test", phB: "phb@hub.test", phC: "phc@hub.test",
};

async function gan(userId: string, orgUnitId: string, code: string, by: string) {
  const r = await db.roleDef.findUniqueOrThrow({ where: { code }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId, orgUnitId, roleId: r.id, grantedById: by } });
}

async function batCo() {
  for (const [key, v] of [
    ["billing.hoaDonEnabled", true], ["hoaDon.hubQuet", true], ["hoaDon.hubNguoiMua", true], ["hoaDon.hubPhanPhoi", true],
  ] as const) await db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v }, update: { valueJson: v } });
  // Thí điểm THEO CƠ SỞ: chỉ CS1 bật. CS2 cố ý tắt — là đối chứng cho mọi ca cách ly cơ sở.
  await db.centerSetting.upsert({
    where: { orgUnitId_key: { orgUnitId: ctx.ou1, key: "hoaDon.hubThiDiem" } },
    create: { orgUnitId: ctx.ou1, key: "hoaDon.hubThiDiem", valueJson: true },
    update: { valueJson: true },
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await resetDb();
  await seedOrg(["HO", "CS1", "CS2"]);
  await seedRoles();
  const [c1, c2] = await Promise.all([
    db.center.findFirstOrThrow({ where: { code: "CS1" }, select: { id: true } }),
    db.center.findFirstOrThrow({ where: { code: "CS2" }, select: { id: true } }),
  ]);
  ctx.cs1 = c1.id;
  ctx.cs2 = c2.id;
  const [o1, o2, oh] = await Promise.all([
    db.orgUnit.findFirstOrThrow({ where: { code: "CS1" }, select: { id: true } }),
    db.orgUnit.findFirstOrThrow({ where: { code: "CS2" }, select: { id: true } }),
    db.orgUnit.findFirstOrThrow({ where: { code: "HO" }, select: { id: true } }),
  ]);
  ctx.ou1 = o1.id; ctx.ou2 = o2.id; ctx.ouHo = oh.id;

  const sa = await seedUser({ email: EM.sa, role: "SUPER_ADMIN", name: "Quản trị Hub" });
  const kt1 = await seedUser({ email: EM.kt1, role: "ACCOUNTANT", name: "Kế toán CS1", centerId: ctx.cs1 });
  const sale1 = await seedUser({ email: EM.sale1, role: "SALES_CSM", name: "Sale CS1", centerId: ctx.cs1 });
  const phA = await seedUser({ email: EM.phA, role: "PARENT", name: "Phụ huynh A" });
  const phB = await seedUser({ email: EM.phB, role: "PARENT", name: "Phụ huynh B" });
  const phC = await seedUser({ email: EM.phC, role: "PARENT", name: "Phụ huynh C (CS2)" });
  Object.assign(ctx, { sa: sa.id, kt1: kt1.id, sale1: sale1.id, phA: phA.id, phB: phB.id, phC: phC.id });
  await gan(sa.id, ctx.ouHo, "SUPER_ADMIN", sa.id);
  await gan(kt1.id, ctx.ou1, "CENTER_ACCOUNTANT", sa.id);
  await gan(sale1.id, ctx.ou1, "CENTER_SALES_CSM", sa.id);
  await gan(phA.id, ctx.ou1, "PARENT", sa.id);
  await gan(phB.id, ctx.ou1, "PARENT", sa.id);
  await gan(phC.id, ctx.ou2, "PARENT", sa.id);

  await batCo();

  const don = (id: string, code: string, centerId: string, extra: Record<string, unknown> = {}) =>
    db.order.create({
      data: { id, code, type: "COURSE", status: "CONFIRMED", customerName: "Khách hàng Hub", customerPhone: "0328545441", totalAmount: 5_000_000, centerId, ...extra },
    });
  await don(ctx.don1, "ORD-HUB-000001", ctx.cs1);
  await don(ctx.don2, "ORD-HUB-000002", ctx.cs1);
  await don(ctx.donCs2, "ORD-HUB-000003", ctx.cs2);

  // Ngoại lệ: CS1 ×2 mở (1 khẩn) + 1 đã đóng; CS2 ×1 mở (không khẩn).
  const nl = (id: string, centerId: string, orderId: string, loai: string, muc: string, trangThai = "MO", o: Record<string, unknown> = {}) =>
    db.hoaDonNgoaiLe.create({ data: { id, centerId, orderId, loai, muc, trangThai, dedupeKey: `${loai}:${id}`, createdAt: new Date("2026-11-02T01:00:00Z"), ...o } });
  await nl(`${T}nl1`, ctx.cs1, ctx.don1, "NGHI_TRUNG", "CAN_XU_LY");
  await nl(`${T}nl2`, ctx.cs1, ctx.don1, "NGUON_MAT", "KHAN");
  await nl(`${T}nl3`, ctx.cs2, ctx.donCs2, "TIEN_THUA", "CAN_XU_LY");
  await nl(`${T}nl4`, ctx.cs1, ctx.don1, "TIEN_THUA", "CAN_XU_LY", "DA_XU_LY", { nguoiXuLyId: ctx.kt1, lyDoXuLy: "Đã xử lý xong" });

  // Phụ huynh A có một em + một đơn có hoá đơn đã phát hành (tệp PDF nằm ở kho GIẢ).
  const hs = await db.student.create({ data: { name: "Bé Hub A", parentUserId: phA.id, centerId: ctx.cs1 } });
  ctx.hs = hs.id;
  await don(ctx.donPh, "ORD-HUB-000009", ctx.cs1, { studentId: hs.id });
  // Phụ huynh C ở CS2 — cơ sở CHƯA thí điểm: có hoá đơn đã phát hành nhưng mục KHÔNG được hiện (đối chứng của ca [HUB-UI-23]).
  const hsC = await db.student.create({ data: { name: "Bé Hub C", parentUserId: phC.id, centerId: ctx.cs2 } });
  await don(ctx.donPhC, "ORD-HUB-000010", ctx.cs2, { studentId: hsC.id });
  await db.hoaDonDienTu.create({
    data: {
      id: ctx.hdPhC, orderId: ctx.donPhC, centerId: ctx.cs2, trangThai: "DA_XAC_NHAN", nguonPhatHanh: "TAI_LEN",
      kyHieu: "C26THUC", soHoaDon: "0000043", ngayPhatHanh: new Date("2026-11-01T00:00:00Z"), tongTien: 3_000_000,
      tepPdfKey: "hoa-don/fake/hd-hub-c.pdf", taoBoiId: sa.id, xacNhanBoiId: sa.id, xacNhanLuc: new Date("2026-11-01T03:00:00Z"),
    },
  });
  await db.hoaDonDienTu.create({
    data: {
      id: ctx.hdPh, orderId: ctx.donPh, centerId: ctx.cs1, trangThai: "DA_XAC_NHAN", nguonPhatHanh: "TAI_LEN",
      kyHieu: "C26THUB", soHoaDon: "0000042", ngayPhatHanh: new Date("2026-11-01T00:00:00Z"), tongTien: 5_000_000,
      tepPdfKey: "hoa-don/fake/hd-hub.pdf", taoBoiId: sa.id, xacNhanBoiId: sa.id, xacNhanLuc: new Date("2026-11-01T03:00:00Z"),
    },
  });
});

test.afterAll(async () => {
  await disconnectDb();
});

async function dangNhap(page: Page, email: string, callbackUrl: string) {
  await login(page, { email, callbackUrl });
}
async function moHocPhi(page: Page) {
  // Lần đầu mỗi phụ huynh gặp màn CỔNG «Chính sách hoạt động của website» (hồ sơ Bộ Công Thương): đồng ý qua chính cổng thật,
  // KHÔNG chèn bản ghi đồng ý bằng DB — để cổng cũng được kiểm. Chưa qua cổng thì mọi khẳng định «không thấy hoá đơn» đều xanh vô nghĩa.
  await page.goto("/portal/hoc-phi");
  const nutCong = page.getByRole("button", { name: "Xác nhận và tiếp tục" });
  if (await nutCong.isVisible().catch(() => false)) {
    await expect(async () => {
      await page.getByRole("checkbox").check({ timeout: 2_000 }).catch(() => undefined);
      await nutCong.click({ timeout: 2_000 }).catch(() => undefined);
      await expect(nutCong).toBeHidden({ timeout: 6_000 });
    }).toPass({ timeout: 40_000 });
  }
}
async function chupDoRong(page: Page, ten: string, choDung: () => Promise<void>) {
  const kq: string[] = [];
  for (const w of DO_RONG) {
    await page.setViewportSize({ width: w, height: cao_cua(w) });
    await choDung();
    const t = await doTranNgang(page);
    await test.info().attach(`${ten}-${w}px`, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
    if (t.px > 0) kq.push(`${w}px: tràn ${t.px}px (${t.thuPham})`);
  }
  expect(kq, `${ten}: tràn ngang ở độ rộng nào`).toEqual([]);
}

test.describe("Khu Hoá đơn điện tử — admin", () => {
  test("[HUB-UI-01] Quản trị: tab Cảnh báo thấy ngoại lệ MỌI cơ sở; chuyển tab giữ cơ sở + tháng trên URL", async ({ page }) => {
    await dangNhap(page, EM.sa, "/admin/payments/hoa-don/canh-bao");
    await expect(page.getByRole("heading", { level: 1, name: "Hoá đơn điện tử" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ngoại lệ hoá đơn" })).toBeVisible();
    // 3 đang mở (2 CS1 + 1 CS2), 1 đã đóng; 1 khẩn.
    await expect(page.getByRole("link", { name: /Đang mở \(3\)/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Đã đóng \(1\)/ })).toBeVisible();
    await expect(page.getByText("1 khẩn đang mở")).toBeVisible();

    await page.goto(`/admin/payments/hoa-don/canh-bao?coSo=${ctx.cs1}&thang=2026-11`);
    await expect(page.getByRole("link", { name: /Đang mở \(2\)/ })).toBeVisible(); // chỉ CS1
    const nav = page.getByRole("navigation", { name: "Khu vực hoá đơn" });
    await nav.getByRole("link", { name: "Cấu hình" }).click();
    await expect(page).toHaveURL(/\/payments\/hoa-don\/cau-hinh/);
    expect(page.url()).toContain(`coSo=${ctx.cs1}`);
    expect(page.url()).toContain("thang=2026-11");
    await nav.getByRole("link", { name: "Cảnh báo & sai sót" }).click();
    await expect(page).toHaveURL(/\/payments\/hoa-don\/canh-bao/);
    expect(page.url()).toContain(`coSo=${ctx.cs1}`);
    expect(page.url()).toContain("thang=2026-11");
    await expect(page.getByRole("link", { name: /Đang mở \(2\)/ })).toBeVisible(); // bộ lọc còn nguyên sau khứ hồi
  });

  test("[HUB-UI-02] Kế toán CS1 chỉ thấy ngoại lệ CS1 — ĐỐI CHỨNG: quản trị ở ca trên thấy cả CS2", async ({ page }) => {
    await dangNhap(page, EM.kt1, "/admin/payments/hoa-don/canh-bao");
    await expect(page.getByRole("heading", { name: "Ngoại lệ hoá đơn" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Đang mở \(2\)/ })).toBeVisible(); // KHÔNG phải 3
    await expect(page.getByRole("link", { name: /Đang mở \(3\)/ })).toHaveCount(0);
    // Cố ý đòi cơ sở khác qua URL: vẫn không thấy gì của CS2.
    await page.goto(`/admin/payments/hoa-don/canh-bao?coSo=${ctx.cs2}`);
    await expect(page.getByRole("link", { name: /Đang mở \(3\)/ })).toHaveCount(0);
  });

  test("[HUB-UI-03] Trạng thái rỗng: lọc không khớp nói rõ «Không có ngoại lệ nào khớp» (không phải trang trắng)", async ({ page }) => {
    await dangNhap(page, EM.sa, `/admin/payments/hoa-don/canh-bao?coSo=${ctx.cs2}&nlMuc=KHAN`);
    await expect(page.getByText("Không có ngoại lệ nào khớp")).toBeVisible();
    // Đối chứng dương: bỏ bộ lọc mức thì CS2 có 1 ngoại lệ.
    await page.goto(`/admin/payments/hoa-don/canh-bao?coSo=${ctx.cs2}`);
    await expect(page.getByRole("link", { name: /Đang mở \(1\)/ })).toBeVisible();
  });

  test("[HUB-UI-04] Phân quyền: Sale không vào được khu Hoá đơn; Kế toán và Quản trị vào được (đối chứng)", async ({ page, browser }) => {
    await dangNhap(page, EM.sale1, "/admin/payments/hoa-don/canh-bao");
    await expect(page.getByRole("heading", { name: "Ngoại lệ hoá đơn" })).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/payments\/hoa-don\/canh-bao/);
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await dangNhap(p2, EM.kt1, "/admin/payments/hoa-don/cau-hinh");
    await expect(p2).toHaveURL(/\/payments\/hoa-don\/cau-hinh/);
    await expect(p2.getByRole("heading", { level: 1, name: "Hoá đơn điện tử" })).toBeVisible();
    await ctx2.close();
  });

  test("[HUB-UI-05] Tab Cảnh báo và Cấu hình không tràn ngang ở 320 → 7680px", async ({ page }) => {
    await dangNhap(page, EM.sa, "/admin/payments/hoa-don/canh-bao");
    await chupDoRong(page, "canh-bao", async () => {
      await page.goto("/admin/payments/hoa-don/canh-bao");
      await expect(page.getByRole("heading", { name: "Ngoại lệ hoá đơn" })).toBeVisible();
    });
    await chupDoRong(page, "cau-hinh", async () => {
      await page.goto("/admin/payments/hoa-don/cau-hinh");
      await expect(page.getByRole("heading", { level: 1, name: "Hoá đơn điện tử" })).toBeVisible();
    });
  });

  test("[HUB-UI-06] 375px: không phần tử tương tác nào ngoài khung / bị che / vùng chạm quá nhỏ ở tab Cảnh báo", async ({ page }) => {
    await dangNhap(page, EM.sa, "/admin/payments/hoa-don/canh-bao");
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/admin/payments/hoa-don/canh-bao");
    await expect(page.getByRole("heading", { name: "Ngoại lệ hoá đơn" })).toBeVisible();
    const kq = await quetMan(page, test.info(), "hub-canh-bao-375");
    expect(cao(kq), JSON.stringify(cao(kq))).toEqual([]);
  });
});

test.describe("Người mua hoá đơn qua QR — Sale → phụ huynh (trang công khai) → áp dụng vào đơn", () => {
  let lienKet = "";

  test("[HUB-UI-10] Sale CS1 tạo mã QR ở chi tiết đơn: thấy QR (phóng to được) + nút sao chép (KHÔNG in liên kết), mã chỉ hiện một lần", async ({ page }) => {
    await dangNhap(page, EM.sale1, `/admin/orders/${ctx.don1}`);
    await expect(page.getByRole("heading", { name: /Thông tin người mua qua mã QR/ })).toBeVisible();
    // Chờ trang hydrate xong rồi mới bấm (bấm trước khi React gắn handler là lệnh câm — không lỗi, không toast).
    // Trang có kết nối thường trực ⇒ không dùng `networkidle`; bấm lại tới khi có kết quả (nút biến mất khi lượt đầu đã chạy — `catch`).
    const o = page.getByRole("button", { name: /Sao chép liên kết/ });
    const toastLoi = page.locator('[data-sonner-toast][data-type="error"]');
    const nut = page.getByRole("button", { name: "Tạo mã QR cho phụ huynh" });
    await expect(async () => {
      await nut.click({ timeout: 2_000 }).catch(() => undefined);
      await expect(o.or(toastLoi).first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 45_000 });
    if (await toastLoi.count()) throw new Error(`Tạo mã bị từ chối: ${await toastLoi.first().innerText()}`);
    await expect(o).toBeVisible();
    // Liên kết KHÔNG được in ra màn (chỉ có nút chép) — đối chứng: nút có, chuỗi URL không.
    await expect(page.getByLabel("Liên kết gửi phụ huynh")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toContain("/thong-tin-hoa-don/");
    // Liên kết không còn in ra màn (02/11/2026) ⇒ chép vào clipboard rồi đọc lại để mở trên giàn thử.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
    await o.click();
    const day = await page.evaluate(() => navigator.clipboard.readText());
    expect(day).toMatch(/^https:\/\/hub-e2e\.example\.com\/thong-tin-hoa-don\/[^/]+$/);
    lienKet = day.replace(/^https?:\/\/[^/]+/, ""); // chỉ phần đường dẫn — mở trên localhost của giàn thử
    await expect(page.getByAltText("Mã QR để phụ huynh mở biểu mẫu thông tin người mua")).toBeVisible();
    await expect(page.getByText(/Mã chỉ hiện lần này/)).toBeVisible();
    // «Phóng to»: hộp thoại ảnh LỚN để phụ huynh quét tại quầy.
    const nhoW = (await page.getByAltText("Mã QR để phụ huynh mở biểu mẫu thông tin người mua").boundingBox())?.width ?? 0;
    await page.getByRole("button", { name: /Phóng to/ }).click();
    const lon = page.getByAltText(/phóng to/);
    await expect(lon).toBeVisible();
    expect((await lon.boundingBox())?.width ?? 0, "ảnh phóng to phải LỚN HƠN ảnh nhỏ").toBeGreaterThan(nhoW + 40);
    await page.keyboard.press("Escape");
    await expect(lon).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: /Sao chép liên kết/ })).toHaveCount(0); // tải lại ⇒ không xem lại được
    await expect(page.getByText("Đang chờ phụ huynh")).toBeVisible();
  });

  test("[HUB-UI-11] Cách ly cơ sở: Kế toán CS1 KHÔNG mở được đơn CS2 — ĐỐI CHỨNG: cùng người mở được đơn CS1", async ({ page }) => {
    await dangNhap(page, EM.kt1, `/admin/orders/${ctx.don1}`);
    await expect(page.getByRole("heading", { name: /Thông tin người mua qua mã QR/ })).toBeVisible();
    await page.goto(`/admin/orders/${ctx.donCs2}`);
    await expect(page.getByRole("heading", { name: /Thông tin người mua qua mã QR/ })).toHaveCount(0);
  });

  test("[HUB-UI-12] Phụ huynh (chưa đăng nhập) mở liên kết: điền biểu mẫu, thiếu đồng ý bị chặn tại chỗ, đủ thì gửi được", async ({ browser }) => {
    expect(lienKet, "ca [HUB-UI-10] phải chạy trước").not.toBe("");
    const c = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const p = await c.newPage();
    await p.goto(lienKet);
    await expect(p.getByRole("heading", { level: 1, name: "Thông tin để xuất hoá đơn" })).toBeVisible();
    await p.locator('input[name="ten"]').fill("Nguyễn Thị Phụ Huynh Hub");
    await p.locator('input[name="diaChi"], textarea[name="diaChi"]').fill("114 Hoàng Diệu, Hải Châu, Đà Nẵng");
    await p.locator('input[name="email"]').fill("ph.hub@example.com");
    // Cá nhân BẮT BUỘC CCCD ba/mẹ (02/11/2026): thiếu ⇒ báo lỗi TẠI CHỖ dưới ô CCCD; đối chứng: có CCCD thì qua.
    await p.locator('input[name="dongY"]').check();
    await p.getByRole("button", { name: "Gửi thông tin" }).click();
    await expect(p.getByText("Nhập số CCCD của ba/mẹ")).toBeVisible();
    await expect(p.getByRole("heading", { level: 1, name: "Thông tin để xuất hoá đơn" })).toBeVisible();
    await p.locator('input[name="cccd"]').fill("048123456789");
    await p.locator('input[name="dongY"]').uncheck();
    await p.getByRole("button", { name: "Gửi thông tin" }).click();
    // Chưa tick đồng ý ⇒ báo lỗi TẠI CHỖ, không rời trang.
    await expect(p.getByRole("alert").first()).toBeVisible();
    await expect(p.getByRole("heading", { level: 1, name: "Thông tin để xuất hoá đơn" })).toBeVisible();
    await p.locator('input[name="dongY"]').check();
    await p.getByRole("button", { name: "Gửi thông tin" }).click();
    await expect(p.getByRole("heading", { name: "Đã nhận thông tin — cảm ơn bạn" })).toBeVisible();
    await c.close();
  });

  test("[HUB-UI-13] Liên kết sai/không tồn tại không lộ gì và không 500; trang không tràn ngang ở 320 → 7680px", async ({ browser }) => {
    expect(lienKet).not.toBe("");
    const c = await browser.newContext();
    const p = await c.newPage();
    const r = await p.goto("/thong-tin-hoa-don/khong-co-ma-nay.xxxxxxxxxxxxxxxx");
    expect(r?.status() ?? 0).toBeLessThan(500);
    await expect(p.getByText("Thông tin để xuất hoá đơn")).toHaveCount(0);
    // Yêu cầu còn MỞ (nhân viên chưa áp dụng) ⇒ phụ huynh mở lại liên kết thì sửa được: biểu mẫu ĐIỀN SẴN những gì chính họ đã gửi.
    await p.goto(lienKet);
    await expect(p.locator('input[name="ten"]')).toHaveValue("Nguyễn Thị Phụ Huynh Hub");
    // ⛔ Ô NHẠY CẢM không bao giờ được điền sẵn lại (lộ liên kết không được lộ CCCD) — dù PH đã gửi CCCD ở ca trước.
    await expect(p.locator('input[name="cccd"]')).toHaveValue("");
    expect(await p.locator("body").innerHTML()).not.toContain("048123456789");
    // Trang công khai KHÔNG được lộ gì của đơn: mã đơn, SĐT khách, số tiền.
    const chu = await p.locator("body").innerText();
    for (const cam of ["ORD-HUB-000001", "0328545441", "5.000.000"]) expect(chu, `trang công khai lộ «${cam}»`).not.toContain(cam);
    // Độ rộng 320 → 7680px (trang công khai là thứ phụ huynh mở bằng điện thoại).
    await chupDoRong(p, "trang-cong-khai", async () => {
      await p.goto(lienKet);
      await expect(p.getByRole("heading", { level: 1, name: "Thông tin để xuất hoá đơn" })).toBeVisible();
    });
    await c.close();
  });

  test("[HUB-UI-14] Sale thấy «Phụ huynh đã gửi» và bấm «Áp dụng vào đơn»: khối «Người mua trên hoá đơn» nhận đúng tên", async ({ page }) => {
    await dangNhap(page, EM.sale1, `/admin/orders/${ctx.don1}`);
    await expect(page.getByText("Phụ huynh đã gửi")).toBeVisible();
    await page.getByRole("button", { name: "Áp dụng vào đơn" }).click();
    await expect(page.getByText("Đã áp dụng vào thông tin hoá đơn của đơn")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Nguyễn Thị Phụ Huynh Hub").first()).toBeVisible();
    // Dấu vết trong DB: chỉ nêu TÊN cột, không giá trị (PII).
    const logs = await db.auditLog.findMany({ where: { entityId: ctx.don1 }, select: { newValues: true } });
    expect(JSON.stringify(logs)).not.toContain("Nguyễn Thị Phụ Huynh Hub");
    expect(JSON.stringify(logs)).not.toContain("048123456789"); // CCCD cũng không vào vết ghi
  });

  test("[HUB-UI-15] Chi tiết đơn không tràn ngang ở 320 → 7680px (Sale)", async ({ page }) => {
    await dangNhap(page, EM.sale1, `/admin/orders/${ctx.don2}`);
    await chupDoRong(page, "chi-tiet-don-sale", async () => {
      await page.goto(`/admin/orders/${ctx.don2}`);
      await expect(page.getByRole("heading", { name: /Thông tin người mua qua mã QR/ })).toBeVisible();
    });
  });
});

test.describe("Phụ huynh — mục Hoá đơn điện tử ở Học phí + cổng sở hữu của route tải PDF", () => {
  test("[HUB-UI-20] Phụ huynh A thấy hoá đơn của con mình ở Học phí, nút Tải PDF có aria-label", async ({ page }) => {
    await dangNhap(page, EM.phA, "/portal/hoc-phi");
    await moHocPhi(page);
    await expect(page.getByRole("heading", { name: "Hoá đơn điện tử" })).toBeVisible();
    await expect(page.getByText(/Ký hiệu C26THUB/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Tải PDF/ })).toBeVisible();
  });

  test("[HUB-UI-21] Phụ huynh B (người lạ) KHÔNG thấy hoá đơn của A và bị 404 khi gọi thẳng route tải — ĐỐI CHỨNG: A không bị 404", async ({ page, browser }) => {
    await dangNhap(page, EM.phB, "/portal/hoc-phi");
    await moHocPhi(page);
    await expect(page.getByText(/Ký hiệu C26THUB/)).toHaveCount(0);
    const rb = await page.request.get(`/api/hoa-don/${ctx.hdPh}/tai-pdf`);
    expect(rb.status()).toBe(404);

    const c = await browser.newContext();
    const pa = await c.newPage();
    await dangNhap(pa, EM.phA, "/portal/hoc-phi");
    await moHocPhi(pa);
    const ra = await pa.request.get(`/api/hoa-don/${ctx.hdPh}/tai-pdf`);
    // Kho tệp là GIẢ ⇒ chủ sở hữu qua hết cổng rồi mới gặp lỗi kho (503); điều cần khẳng định là KHÔNG phải 404/401/403 của cổng sở hữu.
    expect([404, 401, 403]).not.toContain(ra.status());
    await c.close();
  });

  test("[HUB-UI-22] Học phí của phụ huynh không tràn ngang ở 320 → 7680px", async ({ page }) => {
    await dangNhap(page, EM.phA, "/portal/hoc-phi");
    await moHocPhi(page);
    await chupDoRong(page, "hoc-phi-phu-huynh", async () => {
      await page.goto("/portal/hoc-phi");
      await expect(page.getByRole("heading", { name: "Hoá đơn điện tử" })).toBeVisible();
    });
  });

  test("[HUB-UI-23] Cơ sở chưa thí điểm (CS2) thì mục biến mất dù có hoá đơn đã phát hành — ĐỐI CHỨNG: phụ huynh CS1 ở ca [HUB-UI-20] thấy", async ({ page }) => {
    // Không bật/tắt cờ bằng SQL giữa chừng: cấu hình được đệm 300s và ghi thẳng DB không làm mới đệm (đúng thiết kế — lib/settings/service.ts).
    await dangNhap(page, EM.phC, "/portal/hoc-phi");
    await moHocPhi(page);
    await expect(page.getByRole("heading", { name: "Học phí" }).first()).toBeVisible(); // trang tải được (đã qua cổng chính sách)
    await expect(page.getByRole("heading", { name: "Hoá đơn điện tử" })).toHaveCount(0);
    await expect(page.getByText(/Ký hiệu C26THUC/)).toHaveCount(0);
    // Và route tải của chính chủ cũng đóng khi cơ sở chưa bật (không có «tải được mà không thấy»).
    const r = await page.request.get(`/api/hoa-don/${ctx.hdPhC}/tai-pdf`);
    expect(r.status()).toBe(404);
  });
});
