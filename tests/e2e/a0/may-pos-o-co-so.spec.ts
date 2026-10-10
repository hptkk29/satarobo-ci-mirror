/**
 * 09/10/2026 — KHAI MÁY POS Ở MÀN CƠ SỞ, QUA TRÌNH DUYỆT THẬT (docs/pos-hai-nut-khai-may.md §2, Việc 2).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VÌ SAO SPEC NÀY TỒN TẠI
 *
 * Mục "Máy POS quẹt thẻ" nằm BÊN TRONG `<form action>` của `CenterForm`. Test hành vi của component (RTL) dựng giả lập; test
 * loader dùng `sdb` giả. Không bộ nào chạy CẢ CHUỖI: đăng nhập thật → RSC thật đọc Postgres thật qua `scopedDb` → bấm thật →
 * server action thật → `revalidatePath` → danh sách làm mới. Đây là lớp duy nhất bắt được:
 *   · Quản lý cơ sở của CS1 mở `/centers/<CS2>/edit` và thấy (hay RÒ qua RSC payload) máy của CS2 — khuôn `[PTTT-11]`;
 *   · "đã lưu" mà danh sách đứng nguyên vì action chỉ `revalidatePath` trang Cấu hình vận hành (V32);
 *   · bấm lạc một nút trong mục mà form cơ sở bị gửi (Button không đặt `type` mặc định).
 *
 * ⚠️ PHẠM VI CỐ Ý HẸP: hỏi "ai thấy / ai sửa / lưu về đúng cơ sở / redirect / không tràn 375px". KHÔNG hỏi "mã đối khớp tiền
 * đúng không" (đã phủ ở `tests/finance`). Không dựng POS Agent (dòng agent phủ ở `may-o-co-so-agent.test.ts`).
 *
 * ⚠️ Chạy ở CẢ HAI chế độ quyền: mặc định (v1, như CI) và `RBAC_V2_ENABLED=true` (như prod). Hai chế độ cùng đồng ý với bảng
 * quyền của các khoá dùng ở đây (`payments:view` · `payments:import-pos` · `centers:view` · `payments:pos-check`). Thứ chúng KHÔNG
 * đồng ý là HÌNH DẠNG SIDEBAR (menu gọn chỉ chạy ở v2) — nên spec này không khẳng định mục sidebar nào; xem `[HN2-MP-E3]`.
 *
 * ⚠️ VÌ SAO NẰM Ở `tests/e2e/a0`: job "E2E Phase R7" CỐ Ý không cài trình duyệt; bộ A0 có đủ trình duyệt + webServer :3100 +
 * Postgres local + `.env.test`.
 */
import { test, expect, type Page } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { login } from "../_helpers/auth";
import { doTranNgang } from "../_helpers/tran-ngang";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { KHOA_CONG_TAC } from "../../../lib/finance/feature";

const SA: RbacActor = { id: "seed-sa-mpos", name: "SA", role: "SUPER_ADMIN" };

/** Một email cho MỖI lượt đăng nhập — `lib/auth.ts` chặn 5 lượt/phút theo định danh (xem `thu-tien-theo-con.spec.ts`). */
const KT = [
  "kt1@mpos.vn",
  "kt2@mpos.vn",
  "kt3@mpos.vn",
  "kt4@mpos.vn",
  "kt5@mpos.vn",
  "kt6@mpos.vn",
  "kt7@mpos.vn",
  "kt8@mpos.vn",
  "kt9@mpos.vn",
  "kt10@mpos.vn",
  "kt11@mpos.vn",
  "kt12@mpos.vn",
] as const;
/** Quản trị tối cao — CÓ `centers:edit` (rà đối kháng Việc 2): đối chứng dương cho form hồ sơ + người duy nhất gửi được form cơ sở. */
const SA_USER = ["sa1@mpos.vn", "sa2@mpos.vn"] as const;
/** Kế toán CƠ SỞ CS1 — có `payments:manage`, KHÔNG có `payments:import-pos` (v2) và KHÔNG có `centers:edit`. */
const KT_CS1 = "ktcs1@mpos.vn";
const QL1 = ["ql1a@mpos.vn", "ql1b@mpos.vn"] as const;
const QL2 = "ql2@mpos.vn";

let CS1 = "";
let CS2 = "";

/** Mã thiết bị cố ý DÀI và có dấu gạch dưới — mã thật của Techcombank trông như `SP_GINI_X990_V9E1013321`. */
const MAY_CS1 = "SP_GINI_X990_E2E_CS1_0001";
const MAY_CS2 = "SP_GINI_X990_E2E_CS2_0002";

async function gan(userId: string, orgCode: string, roleCode: string) {
  const org = await db.orgUnit.findFirstOrThrow({ where: { code: orgCode }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: roleCode }, select: { id: true } });
  await assignUserOrgRole(SA, { userId, orgUnitId: org.id, roleId: role.id, reason: "e2e máy POS" });
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  await resetDb();
  await seedOrg(["HO", "CS1", "CS2"]);
  await seedRoles();
  CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
  CS2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
  // `seedOrg` dựng Center thiếu `city`, mà ô "Tỉnh / TP" của form cơ sở là `required`: để trống thì HTML5 CHẶN gửi form
  // (không POST nào) — ca E7 (Enter ở "Tên cơ sở") sẽ đỏ vì fixture, không vì mã. Cơ sở thật luôn có thành phố.
  await db.center.updateMany({ where: { id: { in: [CS1, CS2] } }, data: { city: "Đà Nẵng" } });

  // Kế toán Hội sở: vai neo tại HO ⇒ nhìn mọi cơ sở, có `payments:import-pos`.
  for (const e of KT) {
    const u = await seedUser({ email: e, role: "ACCOUNTANT" });
    await gan(u.id, "HO", "HO_ACCOUNTANT");
  }
  // Quản lý cơ sở CS1 (hai tài khoản — hai lượt đăng nhập) và CS2.
  for (const e of QL1) {
    const u = await seedUser({ email: e, role: "CENTER_MANAGER", centerId: CS1 });
    await gan(u.id, "CS1", "CENTER_MANAGER");
  }
  const ql2 = await seedUser({ email: QL2, role: "CENTER_MANAGER", centerId: CS2 });
  await gan(ql2.id, "CS2", "CENTER_MANAGER");
  // Quản trị tối cao (hai tài khoản — hai lượt đăng nhập) + Kế toán cơ sở CS1.
  // RBAC v2 đọc `isSuperAdmin` từ `UserOrgRole` (không từ `User.role`) ⇒ phải GÁN vai SUPER_ADMIN tại HO, không chỉ seed người dùng.
  for (const e of SA_USER) {
    const sa = await seedUser({ email: e, role: "SUPER_ADMIN" });
    await gan(sa.id, "HO", "SUPER_ADMIN");
  }
  const ktcs = await seedUser({ email: KT_CS1, role: "ACCOUNTANT", centerId: CS1 });
  await gan(ktcs.id, "CS1", "CENTER_ACCOUNTANT");

  // CS1: một máy ĐANG BẬT. CS2: một máy ĐÃ TẮT — vẫn liệt kê được (kiểm RÒ dữ liệu cơ sở khác) mà cơ sở không còn máy ĐANG BẬT
  // nào ⇒ trang đơn của CS2 hiện "Chưa khai máy POS" (ca E5).
  await db.posTerminal.create({
    data: { maThietBi: MAY_CS1, maQuay: "QTT-CS1", ten: "Máy quầy lễ tân CS1", maCuaHang: "CH-CS1", maNhaCungCap: "NCCCS1TEST", centerId: CS1 },
  });
  await db.posTerminal.create({
    data: { maThietBi: MAY_CS2, maQuay: "QTT-CS2", ten: "Máy quầy CS2", centerId: CS2, active: false },
  });

  // Công tắc thu linh hoạt BẬT + một đơn ở CS2 (cơ sở không còn máy ĐANG BẬT) — dựng ở đây để MỖI ca chạy một mình vẫn xanh (luật 18).
  await db.systemSetting.upsert({
    where: { key: KHOA_CONG_TAC },
    create: { key: KHOA_CONG_TAC, valueJson: true },
    update: { valueJson: true },
  });
  await db.order.create({
    data: {
      id: "mpos-don-1",
      code: "ORD-269979-000501",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh máy POS",
      customerPhone: "0905123456",
      totalAmount: 3_168_000,
      centerId: CS2,
    },
  });
  await db.orderItem.create({
    data: {
      id: "mpos-don-1-item",
      orderId: "mpos-don-1",
      type: "COURSE_ENROLLMENT",
      itemName: "Bé A — Sata 4",
      quantity: 1,
      unitPrice: 3_168_000,
      totalPrice: 3_168_000,
    },
  });
  await db.paymentRequest.create({
    data: {
      id: "mpos-don-1-dot",
      orderId: "mpos-don-1",
      orderItemId: "mpos-don-1-item",
      centerId: CS2,
      installmentNo: 1,
      amountDue: 3_168_000,
      status: "PENDING",
      sortOrder: 1,
    },
  });
});

const mucMayPos = (page: Page) => page.locator("#may-pos");

/**
 * Agent của CS1 mang merchant của `MAY_CS1`: heartbeat VỪA XONG (≤ 3 phút ⇒ 'Đang làm việc'), hạn phiên ở xa (+30 giờ ⇒ không dính mốc
 * 21:00 hôm nay, nên không phụ thuộc giờ chạy).
 *
 * Gọi Ở ĐẦU MỖI CA cần nó (E6 và E6b), KHÔNG dựng một lần trong `beforeAll`: heartbeat phải còn tươi lúc ca chạy, và quan trọng hơn,
 * ca ĐỐI CHỨNG (E6b — "không `import-pos` thì không thấy dòng agent") chỉ có nghĩa khi agent TỒN TẠI. Bản đầu của spec này dựng agent
 * TRONG E6, nên chạy E6b một mình thì CS1 không có agent nào và E6b xanh cả khi cổng `import-pos` bị gỡ (luật 18 + luật 11).
 */
async function seedAgentCs1() {
  const bayGio = new Date();
  const dacTa = {
    sessionState: "READY" as const,
    lastHeartbeatAt: bayGio,
    lastSyncedAt: bayGio,
    sessionExpiresAt: new Date(bayGio.getTime() + 30 * 3_600_000),
  };
  await db.posAgent.upsert({
    where: { merchantCode: "NCCCS1TEST" },
    create: { centerId: CS1, merchantCode: "NCCCS1TEST", ...dacTa },
    update: dacTa,
  });
}

test("[HN2-MP-E1] Kế toán HO: thấy máy của TỪNG cơ sở đang mở; khai máy mới lưu về ĐÚNG cơ sở của trang, danh sách tự làm mới, form cơ sở không bị gửi", async ({
  page,
}) => {
  await login(page, { email: KT[0] });
  await page.goto(`/admin/centers/${CS1}/edit`);
  const sec = mucMayPos(page);
  await expect(sec).toBeVisible();
  await expect(sec.getByRole("heading", { name: /Máy POS quẹt thẻ/ })).toBeVisible();
  await expect(sec).toContainText(MAY_CS1);
  await expect(sec, "trang CS1 không liệt kê máy của CS2").not.toContainText(MAY_CS2);
  await expect(sec.getByRole("button", { name: /Thêm máy POS/ })).toBeVisible();

  const truoc = await db.center.findUniqueOrThrow({ where: { id: CS1 }, select: { name: true, updatedAt: true } });

  // Thêm máy MỚI qua hộp thoại. Cơ sở là chữ chỉ-đọc, KHÔNG có ô chọn.
  await sec.getByRole("button", { name: /Thêm máy POS/ }).click();
  const hop = page.getByRole("dialog");
  await expect(hop.getByRole("combobox")).toHaveCount(0);
  await expect(hop).toContainText(/Cơ sở đặt máy/);
  expect(await page.locator("form form").count(), "không có form lồng form").toBe(0);
  await hop.getByLabel(/^Mã thiết bị/).fill("E2E_MPOS_NEW_0003");
  await hop.getByLabel(/^Mã quầy/).fill("QTT-NEW");
  await hop.getByRole("button", { name: "Khai máy" }).click();

  // Danh sách TỰ làm mới (V32: revalidatePath trang cơ sở) — không reload tay.
  await expect(sec).toContainText("E2E_MPOS_NEW_0003", { timeout: 15_000 });
  await expect(hop).toBeHidden();
  const moi = await db.posTerminal.findUniqueOrThrow({ where: { maThietBi: "E2E_MPOS_NEW_0003" } });
  expect(moi.centerId, "lưu về cơ sở CỦA TRANG").toBe(CS1);
  expect(moi.active).toBe(true);
  // Form cơ sở KHÔNG bị gửi: vẫn ở trang sửa, tên + updatedAt cơ sở không đổi.
  await expect(page).toHaveURL(new RegExp(`/centers/${CS1}/edit`));
  const sau = await db.center.findUniqueOrThrow({ where: { id: CS1 }, select: { name: true, updatedAt: true } });
  expect(sau.name).toBe(truoc.name);
  expect(sau.updatedAt.getTime(), "cơ sở không bị cập nhật").toBe(truoc.updatedAt.getTime());

  // Cùng người, trang CS2: thấy máy CS2 (đã tắt), KHÔNG thấy máy CS1 — Kế toán HO nhìn mọi cơ sở.
  await page.goto(`/admin/centers/${CS2}/edit`);
  await expect(mucMayPos(page)).toContainText(MAY_CS2);
  await expect(mucMayPos(page)).not.toContainText(MAY_CS1);
});

test("[HN2-MP-E2] Quản lý cơ sở CS1: thấy máy CS1 nhưng KHÔNG có nút ghi; mở trang CS2 ⇒ KHÔNG thấy mục và không RÒ máy CS2 qua payload (khuôn [PTTT-11])", async ({
  page,
}) => {
  await login(page, { email: QL1[0] });

  // Cơ sở CỦA MÌNH.
  await page.goto(`/admin/centers/${CS1}/edit`);
  const sec = mucMayPos(page);
  await expect(sec).toBeVisible();
  await expect(sec).toContainText(MAY_CS1);
  await expect(sec.getByRole("button", { name: /Thêm máy POS/ })).toHaveCount(0);
  await expect(sec.getByRole("button", { name: /^Sửa máy/ })).toHaveCount(0);
  await expect(sec.getByRole("switch")).toHaveCount(0);
  await expect(sec).toContainText(/Bạn chỉ xem/);

  // Cơ sở KHÁC — cùng người, cùng quyền `payments:view` (seed GLOBAL: đích bị `can()` vứt) nhưng cơ sở nằm ngoài tầm nhìn.
  await page.goto(`/admin/centers/${CS2}/edit`);
  await expect(page.getByRole("heading", { level: 1 }), "trang vẫn mở (không có cổng ở đầu) — chỉ mục máy POS bị gác").toBeVisible();
  await expect(mucMayPos(page)).toHaveCount(0);
  const html = await page.content();
  expect(html, "payload RSC không được chứa máy của CS2").not.toContain(MAY_CS2);
  expect(html, "…và không chứa mã quầy của CS2").not.toContain("QTT-CS2");
});

test("[HN2-MP-E3] link cũ `?tab=may-pos` ⇒ về /centers (không 404, không dashboard); lối vào THẬT của Kế toán HO (link ở Biến động số dư) còn sống", async ({
  page,
}) => {
  await login(page, { email: KT[1] });
  const res = await page.goto("/admin/cau-hinh-van-hanh?tab=may-pos");
  expect(res?.status(), "không 404").toBeLessThan(400);
  await expect(page).toHaveURL(/\/centers\/?$/);
  await expect(page.getByRole("heading", { name: "Cơ sở", exact: true })).toBeVisible();
  // ⚠️ ĐỪNG khẳng định "sidebar có mục Cơ sở" ở đây. Bản đầu của chỗ này làm đúng vậy và NÓI DỐI: xanh dưới RBAC v1 (local/CI), ĐỎ dưới v2
  // (cấu hình PROD). Đo 09/10/2026: "menu gọn" (28/09, `AN_MENU_KE_TOAN` có `/centers`) ẩn mục Cơ sở — kéo theo cả nhóm "Lớp học & Lịch học" —
  // khỏi sidebar của Kế toán HO, và menu gọn chỉ chạy khi `RBAC_V2_ENABLED` (`vaiDangDungChoMenu`) nên dev/CI không bao giờ thấy. Đó là quyết
  // định của chủ dự án (ghim ở `[MG-SEED-01]`), không phải việc của mục này. Việc của mục này: lối vào THẬT còn sống ở CẢ hai chế độ. Người khai
  // máy (chỉ Kế toán HO có `import-pos`) đi từ link "Khai máy POS ở Cơ sở" trên màn Biến động số dư (hoặc từ trang đơn / màn POS Agent).
  await page.goto("/admin/bien-dong-so-du");
  const lienKetKhaiMay = page.getByRole("link", { name: "Khai máy POS ở Cơ sở", exact: true });
  await expect(lienKetKhaiMay).toBeVisible();
  await lienKetKhaiMay.click();
  await expect(page).toHaveURL(/\/centers\/?$/);
  await expect(page.getByRole("heading", { name: "Cơ sở", exact: true })).toBeVisible();
  // Từ danh sách, bước kế tiếp của người khai máy: mở một cơ sở ⇒ thấy mục.
  await page.locator("article").getByRole("link", { name: /^Mở/ }).first().click();
  await expect(page).toHaveURL(/\/centers\/[^/]+\/edit/);
  await expect(mucMayPos(page)).toBeVisible();
});

test("[HN2-MP-E4] 375px: trang cơ sở KHÔNG tràn ngang, mục máy POS đọc được, nút Sửa/Thêm với tới được", async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page, { email: KT[2] });
  await page.goto(`/admin/centers/${CS1}/edit`);
  const sec = mucMayPos(page);
  await expect(sec).toBeVisible();
  await sec.scrollIntoViewIfNeeded();
  const tran = await doTranNgang(page);
  expect(tran.px, `trang tràn ngang ${tran.px}px bởi ${tran.thuPham}`).toBe(0);
  // Nút Thêm và nút Sửa nằm TRONG khung nhìn (không bị đẩy ra ngoài mép phải).
  for (const nut of [sec.getByRole("button", { name: /Thêm máy POS/ }), sec.getByRole("button", { name: /^Sửa máy/ }).first()]) {
    await expect(nut).toBeVisible();
    const box = await nut.boundingBox();
    expect(box, "nút có hộp").not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, "mép phải nút trong 375px").toBeLessThanOrEqual(375);
    expect(box!.height, "vùng chạm ≥ 44px ở màn hẹp").toBeGreaterThanOrEqual(44);
  }
  // Mã dài ngắt dòng trong thẻ, không đẩy cả mục rộng ra.
  const hop = await sec.boundingBox();
  expect(hop!.width).toBeLessThanOrEqual(375);
  await sec.screenshot({ path: info.outputPath("may-pos-375.png") });

  // Hộp thoại Thêm ở 375px: không tràn, nút Khai máy với tới được (cuộn TRONG hộp).
  await sec.getByRole("button", { name: /Thêm máy POS/ }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  const kich = await dlg.boundingBox();
  expect(kich!.x).toBeGreaterThanOrEqual(0);
  expect(kich!.x + kich!.width).toBeLessThanOrEqual(375);
  await dlg.screenshot({ path: info.outputPath("may-pos-hop-thoai-375.png") });
});

test("[HN2-MP-E5] trang ĐƠN: 'Chưa khai máy POS' là link tới đúng mục khi người xem ghi được; Quản lý cơ sở thấy cùng chữ nhưng KHÔNG có link", async ({
  page,
}) => {
  const tenCs2 = (await db.center.findUniqueOrThrow({ where: { id: CS2 }, select: { name: true } })).name;

  // Kế toán HO: link.
  await login(page, { email: KT[3] });
  await page.goto("/admin/orders/mpos-don-1");
  const lk = page.getByRole("link", { name: "Chưa khai máy POS" });
  await expect(lk).toBeVisible();
  await expect(lk).toHaveAttribute("href", `/centers/${CS2}/edit#may-pos`);
  await expect(lk).toHaveAttribute("title", `Khai máy ở Cơ sở → ${tenCs2} → Máy POS quẹt thẻ`);
  await lk.click();
  await expect(page).toHaveURL(new RegExp(`/centers/${CS2}/edit`));
  await expect(mucMayPos(page)).toBeVisible();
  await expect(mucMayPos(page)).toContainText(MAY_CS2);
});

test("[HN2-MP-E5b] đối chứng của E5: Quản lý cơ sở CS2 mở cùng đơn ⇒ thấy 'Chưa khai máy POS' nhưng KHÔNG phải link", async ({ page }) => {
  await login(page, { email: QL2 });
  await page.goto("/admin/orders/mpos-don-1");
  const chu = page.getByText("Chưa khai máy POS", { exact: true });
  await expect(chu).toBeVisible();
  await expect(page.getByRole("link", { name: "Chưa khai máy POS" })).toHaveCount(0);
  await expect(chu).toHaveAttribute("title", /^Khai máy ở Cơ sở → .+ → Máy POS quẹt thẻ$/);
});

test("[HN2-MP-E6] dòng POS Agent cạnh máy: Kế toán HO thấy đúng trạng thái (ghép chặt theo merchant + mã quầy); Quản lý cơ sở KHÔNG thấy dòng nào (cổng `import-pos`)", async ({
  page,
}, info) => {
  await seedAgentCs1();
  // Máy thứ hai của CS1 KHÔNG khai mã nhà cung cấp ⇒ không ghép được dù cơ sở có agent (không dùng nhánh "agent duy nhất").
  await db.posTerminal.upsert({
    where: { maThietBi: "E2E_MPOS_THIEU_NCC" },
    create: { maThietBi: "E2E_MPOS_THIEU_NCC", maQuay: "QTT-THIEU", ten: "Máy thiếu mã nhà cung cấp", centerId: CS1 },
    update: {},
  });

  await login(page, { email: KT[4] });
  await page.goto(`/admin/centers/${CS1}/edit`);
  const sec = mucMayPos(page);
  const dongKhop = sec.getByRole("listitem").filter({ hasText: MAY_CS1 });
  await expect(dongKhop).toContainText("POS Agent");
  await expect(dongKhop).toContainText("Đang làm việc");
  await expect(dongKhop).toContainText(/Phiên: Sống · hết hạn/);
  await expect(dongKhop.getByRole("link", { name: /sức khoẻ POS Agent/i })).toHaveAttribute(
    "href",
    /^\/bien-dong-so-du\/pos-agent#the-/,
  );
  const dongThieu = sec.getByRole("listitem").filter({ hasText: "E2E_MPOS_THIEU_NCC" });
  await expect(dongThieu).toContainText("POS Agent chưa khớp máy này — máy thiếu mã nhà cung cấp");
  await expect(dongThieu).not.toContainText("Đang làm việc");
  await sec.screenshot({ path: info.outputPath("may-pos-desktop.png") });

  // 375px: dòng agent không làm tràn ngang.
  await page.setViewportSize({ width: 375, height: 800 });
  await sec.scrollIntoViewIfNeeded();
  const tran = await doTranNgang(page);
  expect(tran.px, `trang tràn ngang ${tran.px}px bởi ${tran.thuPham}`).toBe(0);
  await sec.screenshot({ path: info.outputPath("may-pos-agent-375.png") });
});

test("[HN2-MP-E6b] đối chứng của E6: Quản lý cơ sở CS1 (không `import-pos`) mở cùng trang ⇒ KHÔNG chữ 'POS Agent' nào, kể cả trong payload; người CÓ `import-pos` thấy ngay trên cùng dữ liệu", async ({
  page,
  browser,
}) => {
  // Agent PHẢI tồn tại (ca này chạy MỘT MÌNH vẫn có nghĩa) — và đối chứng dương nằm NGAY TRONG ca (cuối ca).
  await seedAgentCs1();
  await login(page, { email: QL1[1] });
  await page.goto(`/admin/centers/${CS1}/edit`);
  const sec = mucMayPos(page);
  await expect(sec).toBeVisible();
  await expect(sec).toContainText(MAY_CS1);
  await expect(sec).not.toContainText("POS Agent");
  // `KHOP` / `CHUA_KHOP` là hai giá trị `kieu` của dòng agent (loader chỉ dựng khi người xem có `import-pos`) — không được lọt vào payload.
  expect(await page.content(), "payload RSC không mang dòng agent cho người không có `import-pos`").not.toContain("KHOP");

  // Đối chứng dương: CÙNG trang, CÙNG dữ liệu, người có `import-pos` (Kế toán HO) THẤY dòng agent. Không có vế này thì hai khẳng định
  // "không thấy" ở trên xanh được cả khi agent không bao giờ hiện với bất kỳ ai (luật 11).
  const ngu = await browser.newContext({ locale: "vi-VN" });
  try {
    const trangKt = await ngu.newPage();
    await login(trangKt, { email: KT[6] });
    await trangKt.goto(`/admin/centers/${CS1}/edit`);
    await expect(mucMayPos(trangKt)).toContainText("POS Agent");
    await expect(mucMayPos(trangKt)).toContainText("Đang làm việc");
  } finally {
    await ngu.close();
  }
});

test("[HN2-MP-E7] mục máy POS KHÔNG cướp nút gửi của form cơ sở: mở / đóng hộp thoại không gọi server action; Enter ở 'Tên cơ sở' vẫn là nút 'Cập nhật' của chính form", async ({
  page,
}) => {
  // Quản trị tối cao, KHÔNG phải Kế toán HO: từ rà đối kháng Việc 2 ô hồ sơ của người không có `centers:edit` bị KHOÁ (form chỉ-xem,
  // `[HN2-RD-E1]`) nên Enter ở "Tên cơ sở" chỉ còn gửi được form cho người SỬA ĐƯỢC hồ sơ. Ca này đo "mục máy POS không cướp nút gửi
  // mặc định" — vẫn đo trọn vẹn với người có nút "Cập nhật".
  await login(page, { email: SA_USER[0] });
  await page.goto(`/admin/centers/${CS1}/edit`);
  const sec = mucMayPos(page);
  await expect(sec).toBeVisible();

  // Mọi server action của Next là một POST mang header `next-action`. Đếm chúng: form cơ sở bị gửi nhầm thì có POST.
  const postAction: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"]) postAction.push(r.url());
  });

  // 1. Mở rồi đóng từng hộp thoại của mục: không gửi gì.
  await sec.getByRole("button", { name: /Thêm máy POS/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Huỷ" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await sec.getByRole("button", { name: /^Sửa máy/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Huỷ" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(postAction, "mở / đóng hộp thoại của mục không được gọi server action nào").toEqual([]);

  // 2. Enter ở ô "Tên cơ sở" = gửi form cơ sở bằng nút gửi MẶC ĐỊNH của nó. Mục máy POS đứng TRƯỚC nút "Cập nhật" trong cây DOM,
  //    nên nếu có một nút trần (submit) trong mục, nó sẽ là nút mặc định: Enter mở hộp thoại thay vì gửi form.
  await page.getByLabel(/^Tên cơ sở/).press("Enter");
  await expect.poll(() => postAction.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.getByRole("dialog"), "Enter không được mở hộp thoại của mục").toHaveCount(0);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// RÀ ĐỐI KHÁNG VIỆC 2 (09/10/2026) — docs/pos-hai-nut-khai-may.md §3
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

test("[HN2-RD-E1] form hồ sơ cơ sở NÓI THẬT: Kế toán HO (không `centers:edit`) KHÔNG có nút 'Cập nhật', ô hồ sơ bị khoá, mục máy POS vẫn dùng được; Quản trị tối cao (đối chứng dương) có nút", async ({
  page,
  browser,
}) => {
  await login(page, { email: KT[7] });
  await page.goto(`/admin/centers/${CS1}/edit`);
  const sec = mucMayPos(page);
  await expect(sec).toBeVisible();
  // Trước bản vá: nút 'Cập nhật' bật sẵn, bấm ⇒ /dashboard?error=unauthorized không một câu giải thích.
  await expect(page.getByRole("button", { name: "Cập nhật" })).toHaveCount(0);
  await expect(page.getByLabel(/^Tên cơ sở/)).toBeDisabled();
  await expect(page.getByLabel(/^Vĩ độ/)).toBeDisabled();
  await expect(page.getByRole("link", { name: "Quay lại danh sách" })).toHaveAttribute("href", "/centers");
  await expect(page.getByText(/Hồ sơ cơ sở chỉ Quản trị tối cao sửa/)).toBeVisible();
  // Việc họ tới đây để làm vẫn làm được: nút Thêm bấm được và mở hộp thoại.
  await expect(sec.getByRole("button", { name: /Thêm máy POS/ })).toBeEnabled();
  await sec.getByRole("button", { name: /Thêm máy POS/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Huỷ" }).click();
  await expect(page).toHaveURL(new RegExp(`/centers/${CS1}/edit`));

  // Đối chứng dương: CÙNG trang, Quản trị tối cao THẤY nút và ô sửa được. Không có vế này thì các khẳng định "không có nút" ở trên xanh
  // được cả khi form chưa bao giờ vẽ nút cho bất kỳ ai (luật 11).
  const ngu = await browser.newContext({ locale: "vi-VN" });
  try {
    const trangSa = await ngu.newPage();
    await login(trangSa, { email: SA_USER[1] });
    await trangSa.goto(`/admin/centers/${CS1}/edit`);
    await expect(trangSa.getByRole("button", { name: "Cập nhật" })).toBeEnabled();
    await expect(trangSa.getByLabel(/^Tên cơ sở/)).toBeEnabled();
    await expect(trangSa.getByRole("link", { name: "Quay lại danh sách" })).toHaveCount(0);
  } finally {
    await ngu.close();
  }
});

test("[HN2-RD-E1b] Kế toán cơ sở CS1 (có `payments:manage`, KHÔNG `import-pos`/`centers:edit`): thấy 'Tạo phương thức thanh toán', không có nút sửa máy, không có 'Cập nhật' — đảo thứ tự hai lời hỏi quyền sẽ làm ca này đỏ (RBAC v2)", async ({
  page,
}) => {
  await login(page, { email: KT_CS1 });
  await page.goto(`/admin/centers/${CS1}/edit`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Có `payments:manage` ⇒ nút tạo phương thức thanh toán (RBAC v2: đảo manage ↔ import-pos làm nút này BIẾN MẤT).
  await expect(page.getByRole("link", { name: /Tạo phương thức thanh toán/ })).toBeVisible();
  // Không `centers:edit` ⇒ form chỉ-xem.
  await expect(page.getByRole("button", { name: "Cập nhật" })).toHaveCount(0);
  await expect(page.getByLabel(/^Tên cơ sở/)).toBeDisabled();
  // Không ghi được máy dù (v1) có `import-pos`: không tầm nhìn mọi cơ sở.
  const sec = mucMayPos(page);
  await expect(sec.getByRole("button", { name: /Thêm máy POS/ })).toHaveCount(0);
  await expect(sec.getByRole("button", { name: /^Sửa máy/ })).toHaveCount(0);
});

test("[HN2-RD-E2] Biến động số dư ở 375px KHÔNG tràn ngang và 'Import file POS' với tới được; ở 1280px bốn mục vẫn nằm MỘT hàng", async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page, { email: KT[8] });
  await page.goto("/admin/bien-dong-so-du");
  const lienKet = page.getByRole("link", { name: "Khai máy POS ở Cơ sở", exact: true });
  await expect(lienKet).toBeVisible();
  const nutImport = page.getByText("Import file POS", { exact: true }).first();
  await expect(nutImport).toBeVisible();
  const tran = await doTranNgang(page);
  // Trước bản vá: main scrollWidth 677 / clientWidth 375 ⇒ tràn 302px (khối nút `shrink-0` kéo 4 mục thành một hàng 637px).
  expect(tran.px, `trang tràn ngang ${tran.px}px bởi ${tran.thuPham}`).toBe(0);
  const hop = await nutImport.boundingBox();
  expect(hop, "nút có hộp").not.toBeNull();
  expect(hop!.x + hop!.width, "mép phải 'Import file POS' trong khung 375px").toBeLessThanOrEqual(375);
  await page.screenshot({ path: info.outputPath("bien-dong-375.png") });

  // 1280px: không thoái lùi — bốn mục vẫn CÙNG MỘT hàng (cùng toạ độ y xấp xỉ).
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  const ten = ["Khai máy POS ở Cơ sở", "Nhật ký kiểm thẻ POS", "Sức khoẻ POS Agent"];
  const ys: number[] = [];
  for (const t of ten) {
    const b = await page.getByRole("link", { name: t, exact: true }).boundingBox();
    expect(b, `${t} có hộp ở 1280px`).not.toBeNull();
    ys.push(b!.y);
  }
  const b = await page.getByText("Import file POS", { exact: true }).first().boundingBox();
  expect(b).not.toBeNull();
  ys.push(b!.y);
  expect(Math.max(...ys) - Math.min(...ys), "bốn mục cùng một hàng ở 1280px").toBeLessThanOrEqual(24);
});

test("[HN2-RD-E3] bookmark `?tab=may-pos` mở lúc CHƯA đăng nhập: query rơi ở proxy, nhưng sau đăng nhập Kế toán HO tới /centers (không phải dashboard)", async ({
  page,
}) => {
  // KHÔNG dùng `login()` cho bước đầu: helper tự `goto("/login?callbackUrl=…")` và che mất đúng đường này.
  await page.goto("/admin/cau-hinh-van-hanh?tab=may-pos");
  await expect(page).toHaveURL(/\/login\?/);
  const cb = new URL(page.url()).searchParams.get("callbackUrl");
  expect(cb, "proxy giữ callbackUrl về màn cấu hình (query bị bỏ — chính sách chung)").toMatch(/cau-hinh-van-hanh/);
  // Đăng nhập bằng ĐÚNG callbackUrl mà proxy đã đặt, như người dùng thật.
  await login(page, { email: KT[9], callbackUrl: cb! });
  // Trước bản vá: trang cấu hình thấy Kế toán HO không giữ tab nào ⇒ /admin/dashboard.
  await expect(page).toHaveURL(/\/centers\/?$/);
  await expect(page.getByRole("heading", { name: "Cơ sở", exact: true })).toBeVisible();
});

test("[HN2-RD-E3b] đối chứng của E3: Kế toán cơ sở CS1 (không `import-pos`, không giữ tab nào) đi cùng đường ⇒ về dashboard và trình duyệt KHÔNG HỀ gửi yêu cầu nào tới /centers", async ({
  page,
}) => {
  // ⚠️ Chỉ nhìn URL CUỐI là không đủ: người này không có `centers:view` nên /centers lại đá về dashboard — URL cuối giống hệt nhau dù lớp
  // thứ hai đi nhầm nhánh (đo bằng phép cấy đảo hai nhánh: bản đầu của ca này, chỉ khẳng định URL cuối, vẫn XANH). Nên ghi lại MỌI yêu
  // cầu của trang (điều hướng lẫn RSC) và khẳng định không có yêu cầu nào tới /centers — một bước chuyển hướng máy chủ tới /centers sinh
  // đúng một yêu cầu như vậy.
  // ⚠️ Chỉ có nghĩa dưới RBAC v2 (cấu hình PROD): ở v1 (mặc định / CI) vai `ACCOUNTANT` cơ sở CÓ `payments:import-pos` (ma trận tĩnh) nên
  // lớp thứ hai ĐÚNG là đưa họ sang /centers — đo 09/10: v1 ⇒ `/centers`, v2 ⇒ `/dashboard`. Hướng của hai nhánh do `[HN2-RD-09]` ghim.
  test.skip(process.env.RBAC_V2_ENABLED !== "true", "chỉ đo ở RBAC v2: v1 cấp `payments:import-pos` cho kế toán cơ sở (ma trận tĩnh)");
  const duongDaGoi: string[] = [];
  page.on("request", (r) => duongDaGoi.push(new URL(r.url()).pathname));
  await login(page, { email: KT_CS1, callbackUrl: "/admin/cau-hinh-van-hanh" });
  await expect(page).toHaveURL(/\/dashboard/);
  expect(duongDaGoi.filter((p) => /\/cau-hinh-van-hanh/.test(p)).length, "phép ghi có thấy yêu cầu tới màn cấu hình (không mù)").toBeGreaterThan(0);
  expect(duongDaGoi.filter((p) => /\/centers/.test(p)), "không yêu cầu nào tới /centers").toEqual([]);
});

test("[HN2-RD-E4] màn POS Agent: máy lệch merchant ⇒ link 'Khai máy POS' (người ghi được) trỏ ĐÚNG mục máy POS của cơ sở agent, bấm tới nơi", async ({
  page,
}) => {
  const bayGio = new Date();
  await db.posAgent.upsert({
    where: { merchantCode: "NCCLECH" },
    create: {
      centerId: CS1,
      merchantCode: "NCCLECH",
      sessionState: "READY",
      lastHeartbeatAt: bayGio,
      lastSyncedAt: bayGio,
      sessionExpiresAt: new Date(bayGio.getTime() + 30 * 3_600_000),
    },
    update: { lastHeartbeatAt: bayGio, lastSyncedAt: bayGio },
  });
  await login(page, { email: KT[10] });
  await page.goto("/admin/bien-dong-so-du/pos-agent");
  const lk = page.getByRole("link", { name: "Khai máy POS", exact: true }).first();
  await expect(lk).toBeVisible();
  await expect(lk).toHaveAttribute("href", `/centers/${CS1}/edit#may-pos`);
  // Đối chứng nhãn: người GHI được không thấy chữ 'Xem máy POS'.
  await expect(page.getByRole("link", { name: "Xem máy POS", exact: true })).toHaveCount(0);
  await lk.click();
  await expect(page).toHaveURL(new RegExp(`/centers/${CS1}/edit`));
  await expect(mucMayPos(page)).toBeVisible();
});

test("[HN2-RD-E5] trang CS1 CŨ: máy vừa được chuyển sang CS2 (bên kỹ thuật), Kế toán HO đổi TÊN máy trên trang cũ ⇒ máy VẪN ở CS2, các mã khác còn nguyên", async ({
  page,
}) => {
  const MA = "E2E_MPOS_STALE_0009";
  await db.posTerminal.deleteMany({ where: { maThietBi: MA } });
  await db.posTerminal.create({
    data: { maThietBi: MA, maQuay: "QTT-STALE", ten: "Máy sẽ bị chuyển", maCuaHang: "CH-STALE", maNhaCungCap: "NCCSTALE", maTcbQuay: "TCB-STALE", centerId: CS1 },
  });
  try {
    await login(page, { email: KT[11] });
    await page.goto(`/admin/centers/${CS1}/edit`);
    const sec = mucMayPos(page);
    await expect(sec).toContainText(MA);
    // Bên kỹ thuật chuyển máy sang CS2 (đường duy nhất: gọi thẳng action) — trang CS1 trong trình duyệt KHÔNG biết.
    await db.posTerminal.update({ where: { maThietBi: MA }, data: { centerId: CS2 } });

    await sec.getByRole("button", { name: `Sửa máy ${MA}` }).click();
    const hop = page.getByRole("dialog");
    await hop.getByLabel(/^Tên máy/).fill("Tên mới sau chuyển");
    await hop.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(hop).toBeHidden({ timeout: 15_000 });

    const sau = await db.posTerminal.findUniqueOrThrow({ where: { maThietBi: MA } });
    // Trước bản vá: hộp thoại gửi `centerId` của TRANG (CS1) ⇒ máy bị kéo về CS1, toast "đã lưu", không cảnh báo.
    expect(sau.centerId, "máy KHÔNG bị kéo về cơ sở của trang cũ").toBe(CS2);
    expect(sau.ten).toBe("Tên mới sau chuyển");
    expect(sau.maQuay, "mã quầy còn nguyên").toBe("QTT-STALE");
    expect(sau.maNhaCungCap).toBe("NCCSTALE");
  } finally {
    await db.posTerminal.deleteMany({ where: { maThietBi: MA } });
  }
});
