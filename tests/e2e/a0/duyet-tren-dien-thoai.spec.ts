/**
 * Ca [DTD-*] — MÀN DUYỆT MỘT ĐƠN TRÊN ĐIỆN THOẠI (`/orders/<id>/duyet`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 Chủ dự án 25/09/2026: *"làm riêng 1 màn duyệt riêng trên điện thoại cho qly, khi qly
 * thấy thông báo chỉ cần bấm vào xem đơn hàng cần duyệt đó và duyệt luôn"*.
 *
 * Bộ này đo những thứ **chỉ trình duyệt thật mới trả lời được**, và cả ba đều hỏng câm:
 *   · 375px có TRÀN NGANG không — đo đọc mã thì chỉ đoán được, `flex` + số 9 chữ số là
 *     thứ phải render mới biết;
 *   · nút có đủ 44px cho ngón tay không;
 *   · đơn đã bị người khác duyệt trước thì màn nói gì (ca THẬT: thông báo gửi cho MỌI
 *     người duyệt của cơ sở, hai người cùng mở một link là chuyện thường).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { login } from "../_helpers/auth";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { doTranNgang } from "../_helpers/tran-ngang";

const SA: RbacActor = { id: "seed-sa-dtd", name: "SA", role: "SUPER_ADMIN" };
const EMAIL = ["dtd1@ttc.vn", "dtd2@ttc.vn", "dtd3@ttc.vn", "dtd4@ttc.vn", "dtd5@ttc.vn"] as const;

/** Số tiền 9 chữ số + nhãn dài — đúng cặp mà bản đọc mã nghi là gây tràn ở 375px. */
const TIEN = 955_563_000;
const ID_CHO = "dtd-don-cho";
const ID_XONG = "dtd-don-xong";
/** Đơn chờ duyệt ĐÚNG MỘT phần (giảm giá) NHƯNG vẫn có kế hoạch đợt — đối chứng của `[DTD-05]`. */
const ID_MOT = "dtd-don-mot-phan";
let CENTER = "";

async function seedAdmin(email: string) {
  const u = await seedUser({ email, role: "SUPER_ADMIN" });
  const root = await db.orgUnit.findFirst({ where: { code: "SATAROBO" }, select: { id: true } });
  const org =
    root ?? (await db.orgUnit.findFirstOrThrow({ where: { code: "HO" }, select: { id: true } }));
  const role = await db.roleDef.findUniqueOrThrow({
    where: { code: "SUPER_ADMIN" },
    select: { id: true },
  });
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: org.id, roleId: role.id, reason: "smoke" });
  return u;
}

test.beforeAll(async () => {
  await resetDb();
  await seedOrg(["HO", "CS1", "CS2"]);
  await seedRoles();
  CENTER = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
  for (const e of EMAIL) await seedAdmin(e);

  // Đơn ĐANG chờ duyệt — cố ý cho vượt CẢ HAI mức để thẻ vẽ đủ mọi khối (nhiều ưu đãi
  // trên một dòng + kế hoạch nhiều đợt), tức là ca RỘNG NHẤT cho phép đo tràn.
  await db.order.create({
    data: {
      id: ID_CHO,
      code: "ORD-DTD-0001",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Nguyễn Thị Hoàng Phương Linh",
      customerPhone: "0909000077",
      subtotal: TIEN + 12_500_000,
      discountAmount: 12_500_000,
      discountPercent: null,
      totalAmount: TIEN,
      centerId: CENTER,
      discountApprovalStatus: "PENDING_APPROVAL",
      installmentApprovalStatus: "PENDING_APPROVAL",
      items: {
        create: {
          type: "COURSE_ENROLLMENT",
          itemName: "Sata 4 — Lập trình khối",
          quantity: 1,
          unitPrice: TIEN + 12_500_000,
          totalPrice: TIEN + 12_500_000,
          discountAmount: 12_500_000,
          discounts: [
            { kieu: "PHAN_TRAM", giaTri: 15, phanTram: 15, giam: 12_000_000, lyDo: "Ưu đãi khai giảng sớm" },
            { kieu: "SO_TIEN", giaTri: 500_000, phanTram: null, giam: 500_000, lyDo: "Anh chị em ruột" },
          ],
        },
      },
      installments: {
        create: [1, 2, 3, 4, 5, 6].map((n) => ({
          soDot: n,
          amount: n === 6 ? TIEN - 159_260_500 * 5 : 159_260_500,
          dueDate: new Date(`2026-1${n === 6 ? 2 : 0}-0${n}T00:00:00.000Z`),
        })),
      },
    },
  });

  // Đơn ĐÃ xử lý xong — để đo ca "người khác duyệt trước".
  await db.order.create({
    data: {
      id: ID_XONG,
      code: "ORD-DTD-0002",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Trần Văn Bình",
      customerPhone: "0909000078",
      subtotal: 5_000_000,
      discountAmount: 0,
      totalAmount: 5_000_000,
      centerId: CENTER,
      discountApprovalStatus: "APPROVED",
      installmentApprovalStatus: null,
    },
  });

  // Đơn chờ duyệt ĐÚNG MỘT phần (giảm giá) nhưng VẪN CÓ kế hoạch đợt.
  //
  // ⚠️ Đây là fixture ĐỐI CHỨNG, và nó là thứ duy nhất chứng minh được luật "khối chờ
  // duyệt trông khác khối bối cảnh". Đơn vướng CẢ HAI phần (ID_CHO) không phân biệt
  // được: mọi khối đều cảnh báo thì một hàm luôn trả `dangCho: true` cũng đạt.
  await db.order.create({
    data: {
      id: ID_MOT,
      code: "ORD-DTD-0003",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phan Thị Mai",
      customerPhone: "0909000079",
      subtotal: 12_000_000,
      discountAmount: 2_000_000,
      totalAmount: 10_000_000,
      centerId: CENTER,
      discountApprovalStatus: "PENDING_APPROVAL",
      installmentApprovalStatus: null,
      items: {
        create: {
          type: "COURSE_ENROLLMENT",
          itemName: "Sata 3 — Cảm biến",
          quantity: 1,
          unitPrice: 12_000_000,
          totalPrice: 12_000_000,
          discountAmount: 2_000_000,
          discounts: [
            { kieu: "SO_TIEN", giaTri: 2_000_000, phanTram: null, giam: 2_000_000, lyDo: "Ưu đãi khai giảng" },
          ],
        },
      },
      installments: {
        create: [1, 2].map((n) => ({
          soDot: n,
          amount: 5_000_000,
          dueDate: new Date(`2026-1${n}-05T00:00:00.000Z`),
        })),
      },
    },
  });
});

test("[DTD-01] 375px: KHÔNG tràn ngang, dù tiền 9 chữ số và tên khách rất dài", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 780 });
  await login(page, { email: EMAIL[0] });
  await page.goto(`/orders/${ID_CHO}/duyet`);
  await expect(page.getByRole("heading", { name: /Duyệt đơn ORD-DTD-0001/ })).toBeVisible();

  // ⚠️ Đây là phép đo mà bản đọc-mã KHÔNG thay thế được. `MoneyRow` và dòng "Đợt N" vốn
  // thiếu `flex-wrap`/`min-w-0`; số tiền 955.563.000 đ là MỘT token liền (dấu chấm, không
  // phải khoảng trắng) nên trình duyệt không có chỗ ngắt.
  // ⚠️ KHÔNG đo bằng `documentElement.scrollWidth` — phép đo đó CHẾT trong khung admin
  // (`<main>` có `overflow-y-auto` nên tràn bên trong không lan ra). Đã cấy hai lỗi tràn
  // liên tiếp mà nó vẫn trả 0. Xem `tests/e2e/_helpers/tran-ngang.ts`.
  const tran = await doTranNgang(page);
  expect(tran.px, `tràn ngang ${tran.px}px ở 375px — thủ phạm: ${tran.thuPham}`).toBe(0);

  // Số tiền phải HIỆN ĐỦ, không bị cắt bằng "…": cắt một chữ số là đổi nghĩa cả dòng.
  await expect(page.getByText("955.563.000 đ").first()).toBeVisible();
});

test("[DTD-02] nút hành động DÍNH ĐÁY và đủ 44px cho ngón tay", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 780 });
  await login(page, { email: EMAIL[1] });
  await page.goto(`/orders/${ID_CHO}/duyet`);

  const duyet = page.getByRole("button", { name: "Duyệt đơn" });
  const tuChoi = page.getByRole("button", { name: "Từ chối" });
  await expect(duyet).toBeVisible();

  // 44px là mức TỐI THIỂU cho ngón tay (`adapt.md`). Mặc định của cặp nút này là 36px —
  // hợp với chuột, không hợp với tay. Đo CHIỀU CAO THẬT, không đọc tên lớp.
  for (const [ten, nut] of [["Duyệt đơn", duyet], ["Từ chối", tuChoi]] as const) {
    const hop = await nut.boundingBox();
    expect(hop, `không thấy nút ${ten}`).not.toBeNull();
    expect(hop!.height, `nút ${ten} cao ${hop!.height}px`).toBeGreaterThanOrEqual(44);
  }

  // DÍNH ĐÁY: nút phải nằm trong tầm nhìn NGAY khi mở, không phải cuộn tới cuối mới thấy.
  const hopDuyet = await duyet.boundingBox();
  expect(hopDuyet!.y, "nút không nằm trong màn hình đầu tiên").toBeLessThan(780);
});

test("[DTD-03] bấm Duyệt là XONG — không có bước xác nhận thừa", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 780 });
  await login(page, { email: EMAIL[2] });
  await page.goto(`/orders/${ID_CHO}/duyet`);

  // Chủ dự án: *"bấm vào xem đơn hàng cần duyệt đó và DUYỆT LUÔN"*. Một hộp thoại "chắc
  // chưa?" ở đây là thêm một chạm vào đúng việc cần ít chạm nhất.
  await page.getByRole("button", { name: "Duyệt đơn" }).click();

  // Sau khi duyệt, chính màn này phải đổi sang trạng thái "xong" — không để người ta ngồi
  // nhìn một màn y hệt lúc trước rồi bấm lần thứ hai.
  await expect(page.getByText("Đơn này đã xử lý xong")).toBeVisible({ timeout: 15_000 });

  // Và cờ trong DB thật sự đổi — màn nói xong mà sổ chưa đổi là màn nói dối.
  const sau = await db.order.findUniqueOrThrow({
    where: { id: ID_CHO },
    select: { discountApprovalStatus: true, installmentApprovalStatus: true },
  });
  expect(sau.discountApprovalStatus).not.toBe("PENDING_APPROVAL");
  expect(sau.installmentApprovalStatus).not.toBe("PENDING_APPROVAL");
});

test("[DTD-04] đơn người khác duyệt trước ⇒ nói 'đã xử lý xong', KHÔNG phải 404", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 780 });
  await login(page, { email: EMAIL[3] });
  await page.goto(`/orders/${ID_XONG}/duyet`);

  // ⚠️ Ca THẬT, không phải phòng xa: thông báo gửi cho MỌI người có quyền duyệt tại cơ
  // sở, nên hai người cùng mở một link là chuyện thường. Trả 404 cho ca này là nói dối —
  // đơn có thật, chỉ là hết việc — và người nhận thông báo sẽ tưởng link hỏng.
  await expect(page.getByText("Đơn này đã xử lý xong")).toBeVisible();
  await expect(page.getByText("404")).toHaveCount(0);

  // Phải có đường đi tiếp, không để người ta cụt đường.
  await expect(page.getByRole("link", { name: /Xem các đơn còn chờ duyệt/ })).toBeVisible();
});

test("[DTD-05] khối CHỜ DUYỆT phải trông KHÁC khối bối cảnh", async ({ page }) => {
  // 🔴 Chủ dự án 26/09/2026: *"phần nào cần duyệt thì thiết kế chữ nổi bật lên cho QLCS
  // dễ nhận thấy"*.
  //
  // Trước bản vá, cả ba khối đều `bg-muted` + tiêu đề cùng màu. Đơn này chỉ vướng GIẢM
  // GIÁ nhưng vẫn có kế hoạch đợt, nên khối "Kế hoạch thanh toán" hiện ra trông y hệt
  // khối phải gật — người duyệt không có cách nào biết mình đang duyệt cái gì ngoài đọc
  // hết.
  //
  // ⚠️ Đo MÀU NỀN THẬT của hai khối, KHÔNG đọc tên lớp và KHÔNG đọc `data-khoi`. Tên lớp
  // đổi theo token; đọc móc test là tự khẳng định lại thứ mình vừa viết. Thứ duy nhất có
  // nghĩa với người dùng là hai khối ấy có TRÔNG khác nhau hay không.
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, { email: EMAIL[4] });
  await page.goto(`/orders/${ID_MOT}/duyet`);

  const giam = page.locator('[data-khoi="Giải trình giảm giá"]');
  const keHoach = page.locator('[data-khoi="Kế hoạch thanh toán 2 đợt"]');
  await expect(giam).toBeVisible();
  await expect(keHoach, "fixture hỏng: đơn phải CÓ kế hoạch đợt thì mới đối chứng được").toBeVisible();

  const nen = (l: typeof giam) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
  const nenGiam = await nen(giam);
  const nenKeHoach = await nen(keHoach);
  expect(nenGiam, `hai khối cùng nền ${nenGiam} — không phân biệt được cái nào phải duyệt`).not.toBe(
    nenKeHoach,
  );

  // ĐỐI CHỨNG DƯƠNG cho chính phép đo trên: khối đang chờ phải mang dấu hiệu cảnh báo,
  // không chỉ "khác nền". Thiếu vế này thì đổi `bg-muted` của khối BỐI CẢNH sang một màu
  // bất kỳ cũng làm ca đạt — trong khi thứ phải nổi lên vẫn không nổi.
  await expect(giam.locator("svg").first(), "khối chờ duyệt thiếu biểu tượng cảnh báo").toBeVisible();
});
