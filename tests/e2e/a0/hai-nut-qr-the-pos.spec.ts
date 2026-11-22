/**
 * 09/10/2026 — HAI NÚT QR / THẺ POS CHUNG MỘT MÃ, QUA TRÌNH DUYỆT THẬT.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VÌ SAO SPEC NÀY TỒN TẠI
 *
 * Lỗi sinh ra nó: màn đơn vẽ panel QR của phiếu gộp MỖI KHI có phiếu gộp, mà bấm "Thẻ POS" cũng đẻ ra phiếu gộp
 * ⇒ bấm Thẻ là bung luôn ảnh QR + "Nội dung CK" cạnh hộp thẻ. Test hành vi của component (RTL) giả lập máy chủ bằng
 * `rerender`; test DB gọi hàm chứ không bấm nút. Không bộ nào chạy CẢ CHUỖI: bấm nút thật → server action thật →
 * Postgres thật → trang làm mới → panel đúng kênh. Đây là lớp duy nhất bắt được "mỗi bộ xanh mà ghép lại thì hỏng"
 * (đúng loại luật 12 — xem đầu `thu-tien-theo-con.spec.ts`).
 *
 * ⚠️ PHẠM VI CỐ Ý HẸP: hỏi "mỗi nút chỉ xuất thứ của nó, và CHUNG MỘT mã", KHÔNG hỏi "tiền tính đúng không" (đã phủ ở
 * `tests/finance/pos-hai-nut.test.ts` · `pos-gd1.test.ts` trên Postgres thật).
 *
 * ⚠️ KHÔNG bấm "Kiểm tra thanh toán": nó hỏi dữ liệu máy POS đã import — spec này không dựng file nào.
 *
 * ⚠️ VÌ SAO NẰM Ở `tests/e2e/a0`: job "E2E Phase R7" CỐ Ý không cài trình duyệt. Bộ A0 mới có đủ ba thứ cần —
 * trình duyệt, webServer :3100, Postgres local + `.env.test`.
 */
import { test, expect, type Page } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { login } from "../_helpers/auth";
import { doTranNgang } from "../_helpers/tran-ngang";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { KHOA_CONG_TAC } from "../../../lib/finance/feature";

const SA: RbacActor = { id: "seed-sa-hn1", name: "SA", role: "SUPER_ADMIN" };

/** Một email cho MỖI ca — `lib/auth.ts` chặn 5 lượt đăng nhập/phút theo định danh (xem `thu-tien-theo-con.spec.ts`). */
const EMAIL = ["a1@hn1.vn", "a2@hn1.vn", "a3@hn1.vn", "a4@hn1.vn", "a5@hn1.vn"] as const;
/** Một đơn cho MỖI ca — mỗi ca tự dựng phiếu gộp của mình, không nhờ ca trước dọn hộ (luật 18). */
const DON = ["hn1-don-1", "hn1-don-2", "hn1-don-3", "hn1-don-4", "hn1-don-5"] as const;

let CENTER = "";

async function seedAdmin(email: string) {
  const u = await seedUser({ email, role: "SUPER_ADMIN" });
  const root = await db.orgUnit.findFirst({ where: { code: "SATAROBO" }, select: { id: true } });
  const org = root ?? (await db.orgUnit.findFirstOrThrow({ where: { code: "HO" }, select: { id: true } }));
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" }, select: { id: true } });
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: org.id, roleId: role.id, reason: "smoke" });
  return u;
}

/** Hai đợt, số cố ý KHÔNG tròn (fixture tròn trịa là fixture không kiểm được gì). */
const DOT_1 = 3_168_000;
const DOT_2 = 3_564_000;

async function dungDon(id: string, ten: string) {
  await db.order.create({
    data: {
      id,
      code: `ORD-269979-${id.slice(-1).padStart(6, "0")}`,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: ten,
      customerPhone: "0905123456",
      totalAmount: DOT_1 + DOT_2,
      centerId: CENTER,
    },
  });
  for (const [suffix, giaTien, thuTu] of [
    ["a", DOT_1, 1],
    ["b", DOT_2, 2],
  ] as const) {
    await db.orderItem.create({
      data: {
        id: `${id}-item-${suffix}`,
        orderId: id,
        type: "COURSE_ENROLLMENT",
        itemName: `Bé ${suffix.toUpperCase()} — Sata 4`,
        quantity: 1,
        unitPrice: giaTien,
        totalPrice: giaTien,
      },
    });
    await db.paymentRequest.create({
      data: {
        id: `${id}-dot-${suffix}`,
        orderId: id,
        orderItemId: `${id}-item-${suffix}`,
        centerId: CENTER,
        installmentNo: thuTu,
        amountDue: giaTien,
        status: "PENDING",
        sortOrder: thuTu,
      },
    });
  }
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  await resetDb();
  await seedOrg(["HO", "CS1", "CS2"]);
  await seedRoles();
  CENTER = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
  for (const e of EMAIL) await seedAdmin(e);

  // ⚠️ CÔNG TẮC phải BẬT, nếu không không có phiếu gộp, không có nút Thẻ POS (xem `thu-tien-theo-con.spec.ts`).
  await db.systemSetting.upsert({
    where: { key: KHOA_CONG_TAC },
    create: { key: KHOA_CONG_TAC, valueJson: true },
    update: { valueJson: true },
  });

  // Tài khoản nhận tiền THẬT của cơ sở ⇒ `qrUrl` ≠ null ⇒ panel QR có ẢNH. Thiếu cái này thì "không có ảnh QR" luôn
  // đúng (panel chỉ in khung "Chưa dựng được QR") — ca vắng mặt xanh vì lý do sai (luật 11).
  await db.paymentMethod.create({
    data: {
      code: "HN1_BANK",
      name: "Chuyển khoản HN1",
      type: "BANK_TRANSFER",
      centerId: CENTER,
      bankBin: "970407",
      bankAccountNumber: "19035000000019",
      bankAccountName: "CONG TY SATA ROBO",
    },
  });
  // Cơ sở PHẢI có đúng một máy POS đang bật, nếu không nút Thẻ POS thành "Chưa khai máy POS" (T10).
  await db.posTerminal.create({ data: { maThietBi: "E2EHN1MAY01", maQuay: "QTT45XWQT", centerId: CENTER } });

  for (const [i, id] of DON.entries()) await dungDon(id, `Phụ huynh HN1 số ${i + 1}`);
});

/** Khối "Phiếu thu & QR theo đợt" — neo vào đây, không neo cả trang (tên đợt lặp ở nhiều khối khác). */
const bang = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: /Phiếu thu & QR theo đợt/i }) });
const dong = (page: Page, nhan: string) => bang(page).getByRole("row", { name: new RegExp(nhan) });
const anhQr = (page: Page) => bang(page).getByAltText(/Mã QR phiếu/);
const noiDungCk = (page: Page) => bang(page).getByText(/Nội dung CK/);

/**
 * Đóng hộp thẻ bằng Escape — LẶP tới khi nó chịu đóng.
 *
 * ⚠️ Hộp CỐ Ý từ chối đóng khi còn đang tạo phiếu / kiểm tra / báo admin (`dongDuoc` trong `hop-phieu-pos.tsx`: đóng
 * giữa lúc action còn chạy là mất kết quả), và `dangTao` là `useTransition` bao luôn cả `router.refresh()` của trang
 * `force-dynamic`. Bản đầu của spec này bấm Escape MỘT lần rồi chờ — hai ca đỏ ngay chỗ đó (hộp vẫn mở sau 5 giây),
 * trong khi cùng thao tác ở trang tĩnh (không có action đang chạy) đóng được ngay. Nên lặp tới khi hộp chịu đóng.
 * Cổng `dongDuoc` có từ GĐ1, không do bản này thêm.
 */
async function dongHop(page: Page) {
  const hop = page.getByRole("dialog");
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(hop).toBeHidden({ timeout: 1_500 });
  }).toPass({ timeout: 30_000 });
}

const soPhieuGop = (orderId: string) => db.paymentBill.count({ where: { orderId } });
const soPhieuThe = (orderId: string) => db.posPaymentIntent.count({ where: { paymentBill: { orderId } } });
const maCuaDon = async (orderId: string) =>
  (await db.paymentBill.findFirstOrThrow({ where: { orderId, status: "OPEN" }, select: { matchKey: true } })).matchKey!;

test("[HN1-E1] bấm 'Thẻ POS' ⇒ CHỈ hộp thẻ (không ảnh QR, không 'Nội dung CK'); rồi nút 'QR · MÃ' dùng lại CÙNG mã", async ({
  page,
}) => {
  const d = DON[0];
  await login(page, { email: EMAIL[0] });
  await page.goto(`/admin/orders/${d}`);
  await expect(bang(page)).toBeVisible();
  // Đối chứng dương cho các ca "không có" bên dưới: trước khi bấm, hai nút cạnh nhau có mặt.
  await expect(dong(page, "Đợt 1/2").getByRole("button", { name: "Xuất QR" })).toBeVisible();
  await dong(page, "Đợt 1/2").getByRole("button", { name: "Thẻ POS" }).click();

  const hop = page.getByRole("dialog");
  await expect(hop.getByText(/Thu thẻ POS — Đợt 1\/2/)).toBeVisible();
  const ma = await maCuaDon(d);
  await expect(hop.getByText(ma, { exact: true }), "hộp thẻ in mã cỡ lớn của phiếu gộp").toBeVisible();
  await expect(hop.getByText("Cùng mã với QR chuyển khoản")).toBeVisible();

  // Lỗi cũ: panel QR bung theo. Nay KHÔNG.
  await expect(anhQr(page), "bấm Thẻ POS không được bung ảnh QR").toHaveCount(0);
  await expect(noiDungCk(page), "…cũng không bung 'Nội dung CK'").toHaveCount(0);
  await expect(page.getByText("Phiếu thu gộp · đang chờ tiền")).toHaveCount(0);
  expect(await soPhieuGop(d), "một phiếu gộp").toBe(1);
  expect(await soPhieuThe(d), "một phiếu thẻ").toBe(1);
  const intent = await db.posPaymentIntent.findFirstOrThrow({ where: { paymentBill: { orderId: d } } });
  expect(intent.code5, "ghi chú POS = đúng mã của phiếu gộp").toBe(ma);

  // Đóng hộp: dòng nói thật hai kênh; QR chưa hiện (chưa ai bấm).
  await dongHop(page);
  await expect(hop).toBeHidden();
  const d1 = dong(page, "Đợt 1/2");
  await expect(d1.getByRole("button", { name: /Thẻ · đang chờ/ })).toBeVisible();
  const nutQr = d1.getByRole("button", { name: new RegExp(`QR · ${ma}`) });
  await expect(nutQr).toBeVisible();
  await expect(nutQr).toHaveAttribute("aria-expanded", "false");
  await expect(anhQr(page)).toHaveCount(0);

  // Bấm QR ⇒ CHỈ panel QR, CÙNG mã, KHÔNG phát phiếu mới.
  await nutQr.click();
  await expect(anhQr(page)).toBeVisible();
  await expect(page.getByAltText(`Mã QR phiếu ${ma}`)).toBeVisible();
  await expect(noiDungCk(page)).toContainText(ma);
  await expect(nutQr).toHaveAttribute("aria-expanded", "true");
  // Cả hai kênh cùng mở cho một mã ⇒ cảnh báo; thẻ đang chờ ⇒ KHÔNG mời huỷ phiếu.
  await expect(bang(page).getByText(/khách chỉ trả MỘT cách/)).toBeVisible();
  await expect(bang(page).getByRole("button", { name: "Huỷ phiếu" })).toHaveCount(0);
  await expect(bang(page).getByText(/Đang chờ quẹt thẻ cho mã này/)).toBeVisible();
  expect(await soPhieuGop(d), "nút thứ hai dùng lại mã, không phát mới").toBe(1);
  expect(await soPhieuThe(d)).toBe(1);

  // Bấm lần nữa ⇒ ẩn.
  await nutQr.click();
  await expect(anhQr(page)).toHaveCount(0);
});

test("[HN1-E2] bấm 'Xuất QR' ⇒ CHỈ panel QR; rồi 'Thẻ POS' dùng lại CÙNG mã, hộp thẻ có cảnh báo, panel QR ẩn", async ({
  page,
}) => {
  const d = DON[1];
  await login(page, { email: EMAIL[1] });
  await page.goto(`/admin/orders/${d}`);
  await dong(page, "Đợt 1/2").getByRole("button", { name: "Xuất QR" }).click();

  await expect(anhQr(page)).toBeVisible();
  await expect(noiDungCk(page)).toBeVisible();
  await expect(page.getByRole("dialog"), "bấm QR không được bung hộp thẻ").toHaveCount(0);
  const ma = await maCuaDon(d);
  await expect(bang(page).getByText(ma, { exact: true })).toBeVisible();
  expect(await soPhieuThe(d), "chưa có phiếu thẻ").toBe(0);

  await dong(page, "Đợt 1/2").getByRole("button", { name: "Thẻ POS" }).click();
  const hop = page.getByRole("dialog");
  await expect(hop.getByText(ma, { exact: true }), "cùng mã với QR").toBeVisible();
  await expect(hop.getByText(/khách chỉ trả MỘT cách/), "QR đã hiện rồi mới mở thẻ ⇒ cảnh báo trong hộp").toBeVisible();
  await expect(anhQr(page), "mở hộp thẻ ⇒ panel QR ẩn (một kênh một lúc)").toHaveCount(0);
  expect(await soPhieuGop(d), "chỉ MỘT phiếu gộp sau khi bấm lần lượt cả hai").toBe(1);
  expect(await soPhieuThe(d)).toBe(1);
  expect((await db.posPaymentIntent.findFirstOrThrow({ where: { paymentBill: { orderId: d } } })).code5).toBe(ma);
});

test("[HN1-E3] ĐỐI CHỨNG: phiếu gộp KHÔNG có thẻ ⇒ 'Huỷ phiếu' có và huỷ được THẬT (action đổi chữ ký vẫn chạy)", async ({ page }) => {
  const d = DON[2];
  await login(page, { email: EMAIL[2] });
  await page.goto(`/admin/orders/${d}`);
  await dong(page, "Đợt 1/2").getByRole("button", { name: "Xuất QR" }).click();
  await expect(anhQr(page)).toBeVisible();
  expect(await soPhieuGop(d)).toBe(1);

  // Hai lần bấm, không hỏi lý do (chủ dự án chốt 24/09).
  await bang(page).getByRole("button", { name: "Huỷ phiếu" }).click();
  await bang(page).getByRole("button", { name: /Xác nhận huỷ mã/ }).click();
  await expect
    .poll(async () => (await db.paymentBill.findFirst({ where: { orderId: d }, select: { status: true } }))?.status, { timeout: 15_000 })
    .toBe("VOID");
  // Huỷ xong, dòng quay về nút phát phiếu.
  await expect(dong(page, "Đợt 1/2").getByRole("button", { name: "Xuất QR" })).toBeVisible();
  await expect(anhQr(page)).toHaveCount(0);
});

test("[HN1-E4] 375px: trang KHÔNG tràn ngang; hai nút với tới được bằng cuộn bảng và vẫn một-nút-một-kênh", async ({ page }) => {
  const d = DON[3];
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page, { email: EMAIL[3] });
  await page.goto(`/admin/orders/${d}`);
  await expect(bang(page)).toBeVisible();
  const truoc = await doTranNgang(page);
  expect(truoc.px, `trang tràn ngang ${truoc.px}px ở 375px (${truoc.thuPham})`).toBeLessThanOrEqual(1);

  // Playwright tự cuộn vùng bảng tới nút trước khi bấm — nút phải CÓ và bấm được ở khung điện thoại.
  await dong(page, "Đợt 1/2").getByRole("button", { name: "Thẻ POS" }).click();
  const hop = page.getByRole("dialog");
  await expect(hop.getByText(/Thu thẻ POS — Đợt 1\/2/)).toBeVisible();
  await expect(anhQr(page)).toHaveCount(0);
  await dongHop(page);
  await expect(hop).toBeHidden();

  const ma = await maCuaDon(d);
  await dong(page, "Đợt 1/2").getByRole("button", { name: new RegExp(`QR · ${ma}`) }).click();
  await expect(anhQr(page)).toBeVisible();
  const sau = await doTranNgang(page);
  expect(sau.px, `mở panel QR làm trang tràn ngang ${sau.px}px ở 375px (${sau.thuPham})`).toBeLessThanOrEqual(1);
});
