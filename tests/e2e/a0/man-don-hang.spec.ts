/**
 * Ca [MDH-*] — MÀN ĐƠN HÀNG sau đợt vẽ lại 25/09/2026.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO BỘ NÀY TỒN TẠI
 *
 * Chủ dự án: *"redesign lại màn /orders … làm sao cho đẹp và responsive tất cả các màn
 * từ nhỏ nhất đến màn 8K"* + *"thiết kế lại chức năng lọc … sale thì không có phần lọc
 * cơ sở, qlcs thì không có phần lọc của khu vực"*.
 *
 * Ba thứ ở đây **không có cách nào kiểm bằng test thuần**, và cả ba đều hỏng câm:
 *   · bảng có thật sự biến thành thẻ dưới `sm` không — nó phụ thuộc Tailwind có sinh ra
 *     `before:content-[attr(data-nhan)]` hay không. Không sinh ⇒ nhãn cột biến mất trên
 *     điện thoại, không lỗi nào báo;
 *   · 375px có tràn ngang không;
 *   · ô lọc phạm vi có ẩn đúng người không.
 *
 * ⚠️ Bộ này cố ý KHÔNG chụp ảnh so sánh: ảnh vỡ vì một pixel phông chữ là lưới người ta
 * học cách bỏ qua. Nó đo HÀNH VI — chữ có hiện không, trang có tràn không.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { login } from "../_helpers/auth";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { doTranNgang } from "../_helpers/tran-ngang";

const SA: RbacActor = { id: "seed-sa-mdh", name: "SA", role: "SUPER_ADMIN" };
/** Mỗi ca một tài khoản — trần 5 lượt đăng nhập/phút theo định danh (xem spec `TTC`). */
const EMAIL = [
  "mdh1@ttc.vn", "mdh2@ttc.vn", "mdh3@ttc.vn", "mdh4@ttc.vn",
  "mdh5@ttc.vn", "mdh6@ttc.vn", "mdh7@ttc.vn", "mdh8@ttc.vn", "mdh9@ttc.vn",
  "mdh10@ttc.vn",
] as const;

const KHOA = "Sata 4 — Lập trình khối";
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

  // Hai đơn: một CHỜ DUYỆT (vượt trần ưu đãi), một bình thường. Cần cả hai để ca "nổi
  // bật" có ĐỐI CHỨNG — một màn toàn đơn chờ duyệt thì không chứng minh được gì.
  for (const [ma, choDuyet] of [
    ["ORD-MDH-0001", true],
    ["ORD-MDH-0002", false],
  ] as const) {
    await db.order.create({
      data: {
        code: ma,
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: choDuyet ? "Phụ huynh Chờ Duyệt" : "Phụ huynh Bình Thường",
        customerPhone: choDuyet ? "0909000011" : "0909000022",
        subtotal: 10_000_000,
        discountAmount: choDuyet ? 2_000_000 : 0,
        totalAmount: choDuyet ? 8_000_000 : 10_000_000,
        centerId: CENTER,
        discountApprovalStatus: choDuyet ? "PENDING_APPROVAL" : null,
        items: {
          create: {
            type: "COURSE_ENROLLMENT",
            itemName: KHOA,
            quantity: 1,
            unitPrice: 10_000_000,
            totalPrice: 10_000_000,
            discountAmount: choDuyet ? 2_000_000 : 0,
          },
        },
      },
    });
  }
});

test("[MDH-01] màn rộng: bảng đủ cột, đơn chờ duyệt NỔI BẬT kèm đối chứng", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, { email: EMAIL[0] });
  await page.goto("/orders");

  // ⚠️ DANH SÁCH CHỜ DUYỆT **ẨN**, chỉ còn một cái NÚT [đảo 25/09/2026].
  // Chủ dự án: *"ẩn list chờ duyệt đi … khi bấm nút đơn hàng cần duyệt thì mới hiển thị"*.
  // Ca này giữ CẢ HAI vế — nút có, và danh sách KHÔNG có. Bỏ vế thứ hai thì ca vẫn ĐẠT
  // kể cả khi danh sách lại hiện thường trực, tức mất đúng thứ vừa chốt.
  await expect(page.getByRole("link", { name: /1 đơn cần bạn duyệt/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /đơn đang chờ bạn duyệt/ })).toHaveCount(0);

  // Bảng có header (chế độ bảng, không phải chế độ thẻ).
  await expect(page.getByRole("columnheader", { name: "Mã đơn" })).toBeVisible();

  // ĐỐI CHỨNG DƯƠNG + ÂM trong cùng một ca (luật 11): đơn vượt trần mang chip, đơn
  // thường KHÔNG. Ca chỉ khẳng định "có chip" sẽ ĐẠT kể cả khi mọi dòng đều mang chip.
  const dongChoDuyet = page.getByRole("row").filter({ hasText: "ORD-MDH-0001" });
  const dongThuong = page.getByRole("row").filter({ hasText: "ORD-MDH-0002" });
  await expect(dongChoDuyet.getByText(/Chờ duyệt giảm giá/)).toBeVisible();
  await expect(dongThuong.getByText(/Chờ duyệt/)).toHaveCount(0);
});

test("[MDH-02] 375px: KHÔNG tràn ngang, và bảng đã thành THẺ có nhãn cột", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page, { email: EMAIL[1] });
  await page.goto("/orders");
  // ⚠️ Thu hẹp vào BẢNG. Mã đơn xuất hiện HAI lần trên trang — một lần trong khối "chờ
  // bạn duyệt" ở đầu, một lần trong bảng — nên `getByText` trần vi phạm strict mode.
  // Bản đầu của ca này đỏ đúng vì lý do đó, và nó là bằng chứng khối duyệt có dựng thật.
  const bang = page.locator("table");
  await expect(bang.getByText("ORD-MDH-0001")).toBeVisible();

  // Vế 1 — không tràn ngang. Đây là lỗi responsive hay gặp nhất và nó không ném gì.
  // ⚠️ Phép đo cũ ở đây (`documentElement.scrollWidth`) ĐÃ CHẾT — xem
  // `tests/e2e/_helpers/tran-ngang.ts`. Nó không thấy tràn xảy ra bên trong `<main>` của
  // khung admin, tức ca này từng xanh mà chẳng canh được gì.
  const tran = await doTranNgang(page);
  expect(tran.px, `tràn ngang ${tran.px}px ở 375px — thủ phạm: ${tran.thuPham}`).toBe(0);

  // Vế 2 — header bảng BIẾN MẤT (đã chuyển sang chế độ thẻ).
  await expect(page.getByRole("columnheader", { name: "Mã đơn" })).toBeHidden();

  // Vế 3 — VÀ nhãn cột xuất hiện lại trên từng ô qua `before:content-[attr(data-nhan)]`.
  // ⚠️ Đây là ca đắt nhất của bộ: nếu Tailwind không sinh ra lớp ấy thì thẻ mất sạch
  // nhãn ("Nguyễn Văn A / 8.000.000 / …" không biết số nào là số nào), mà không lỗi nào
  // báo. Đọc bằng `::before` vì nội dung do CSS sinh, `innerText` không thấy.
  const nhan = await page.evaluate(() => {
    const o = document.querySelector("td[data-nhan='Số tiền']");
    return o ? getComputedStyle(o, "::before").content : null;
  });
  expect(nhan, "nhãn cột trên thẻ (::before content)").toContain("Số tiền");
});

test("[MDH-03] ô lọc PHẠM VI chỉ hiện khi cho ≥2 lựa chọn", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, { email: EMAIL[2] });
  await page.goto("/orders");
  await expect(page.locator("table").getByText("ORD-MDH-0001")).toBeVisible();

  // Cây `seedOrg(["HO","CS1","CS2"])` có 2 cơ sở nhưng chỉ 1 khu vực ⇒
  // CÓ ô "Cơ sở", KHÔNG có ô "Khu vực". Đây đúng là hình dạng tổ chức thật hôm nay,
  // và là đối chứng dương/âm cho `oLocPhamVi` ở tầng giao diện.
  await expect(page.getByLabel("Lọc theo cơ sở")).toBeVisible();
  await expect(page.getByLabel("Lọc theo khu vực")).toHaveCount(0);
});

test("[MDH-04] lọc nhanh 'Chờ duyệt' thu hẹp danh sách, và gỡ được", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, { email: EMAIL[3] });
  await page.goto("/orders");
  await expect(page.locator("table").getByText("ORD-MDH-0002")).toBeVisible();

  await page.getByRole("button", { name: /Chờ duyệt \(1\)/ }).click();
  await expect(page.locator("table").getByText("ORD-MDH-0001")).toBeVisible();
  // Đơn thường BIẾN MẤT — nếu không, nút lọc là một lời hứa suông.
  await expect(page.locator("table").getByText("ORD-MDH-0002")).toHaveCount(0);

  // Bấm lại là về hết — đường thoát phải có, nếu không người ta kẹt trong bộ lọc.
  await page.getByRole("button", { name: /Chờ duyệt \(1\)/ }).click();
  await expect(page.locator("table").getByText("ORD-MDH-0002")).toBeVisible();
});

test("[MDH-05] bấm nút mở MÀN DUYỆT, và quay lại được", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, { email: EMAIL[4] });
  await page.goto("/orders");

  // Ở danh sách: có nút, KHÔNG có màn duyệt.
  const nut = page.getByRole("link", { name: /1 đơn cần bạn duyệt/ });
  await expect(nut).toBeVisible();
  await expect(page.getByRole("heading", { name: /đơn đang chờ bạn duyệt/ })).toHaveCount(0);

  await nut.click();

  // Ở màn duyệt: có danh sách duyệt, KHÔNG còn bảng đơn.
  await expect(page.getByRole("heading", { name: /1 đơn đang chờ bạn duyệt/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Duyệt đơn hàng" })).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
  // Tham số URL — thứ làm nút Back của trình duyệt chạy đúng và link gửi được cho nhau.
  await expect(page).toHaveURL(/[?&]duyet=1/);

  // ĐƯỜNG LÙI phải có, và phải đưa về đúng danh sách.
  await page.getByRole("link", { name: /Quay lại danh sách/ }).click();
  await expect(page.locator("table")).toBeVisible();
  await expect(page.getByRole("link", { name: /1 đơn cần bạn duyệt/ })).toBeVisible();
});

test("[MDH-06] ô lọc KHÔNG in giá trị thô 'ALL' ra màn", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, { email: EMAIL[5] });
  await page.goto("/orders");
  await page.getByRole("button", { name: /^Bộ lọc/ }).click();

  // 🔴 Lỗi chủ dự án chụp ảnh 25/09: ô "Loại đơn" hiện đúng chữ "ALL".
  // Gốc là bẫy đã ghi sẵn trong repo — `<SelectValue>` của base-ui in GIÁ TRỊ THÔ, không
  // tra nhãn từ danh sách mục. Nó KHÔNG ném gì, không ca nào đỏ; chỉ người nhìn mới thấy.
  const trangThai = page.getByLabel("Trạng thái đơn");
  const loai = page.getByLabel("Loại đơn");
  await expect(trangThai).toContainText("Mọi trạng thái");
  await expect(loai).toContainText("Mọi loại đơn");
  // Đối chứng ÂM tường minh: chuỗi thô không được xuất hiện ở bất kỳ ô nào.
  await expect(trangThai).not.toContainText("ALL");
  await expect(loai).not.toContainText("ALL");
});

test("[MDH-07] bảng lọc ĐẨY nội dung xuống, không đè lên bảng đơn", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, { email: EMAIL[6] });
  await page.goto("/orders");
  await expect(page.locator("table")).toBeVisible();

  await page.getByRole("button", { name: /^Bộ lọc/ }).click();
  const panel = page.getByRole("group", { name: "Bộ lọc chi tiết" });
  const bang = page.locator("table");

  // 🔴 Chủ dự án: *"bị đè lên nhau rồi"*. Bản đầu dựng bảng lọc bằng `absolute` nên nó
  // NỔI ĐÈ lên bảng đơn. Đo bằng HÌNH HỌC, không bằng tên lớp CSS: lớp CSS là cách viết,
  // "không đè" mới là luật (bài học `[NDC-07]`/`[QCS-03]`).
  const hopPanel = await panel.boundingBox();
  const hopBang = await bang.boundingBox();
  expect(hopPanel, "không tìm thấy bảng lọc").not.toBeNull();
  expect(hopBang, "không tìm thấy bảng đơn").not.toBeNull();
  expect(
    hopBang!.y,
    `bảng đơn bắt đầu ở y=${hopBang!.y} trong khi bảng lọc kết thúc ở y=${hopPanel!.y + hopPanel!.height}`,
  ).toBeGreaterThanOrEqual(hopPanel!.y + hopPanel!.height - 1);
});

test("[MDH-08] chọn 'Chờ duyệt' trong ô Trạng thái thì lọc đúng, và gỡ được bằng chip", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, { email: EMAIL[7] });
  await page.goto("/orders");
  await expect(page.locator("table").getByText("ORD-MDH-0002")).toBeVisible();

  await page.getByRole("button", { name: /^Bộ lọc/ }).click();
  await page.getByLabel("Trạng thái đơn").click();
  await page.getByRole("option", { name: /^Chờ duyệt$/ }).click();
  await page.getByRole("button", { name: "Áp dụng" }).click();

  await expect(page.locator("table").getByText("ORD-MDH-0001")).toBeVisible();
  await expect(page.locator("table").getByText("ORD-MDH-0002")).toHaveCount(0);

  // Gỡ bằng chip — bộ lọc bật từ ô chọn phải có cùng đường thoát như mọi bộ lọc khác.
  await page.getByRole("button", { name: /Bỏ lọc Chờ duyệt/ }).click();
  await expect(page.locator("table").getByText("ORD-MDH-0002")).toBeVisible();
});

test("[MDH-09] mở bộ lọc KHÔNG được xô lệch hàng công cụ", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, { email: EMAIL[8] });
  await page.goto("/orders");
  await expect(page.locator("table")).toBeVisible();

  // 🔴 Chủ dự án, ảnh 25/09: *"tôi không muốn khi bấm vào nó bị thay đổi thiết kế của cái
  // khác như thế này"*. Bản trước đặt `<details>` NGAY TRONG hàng công cụ (flex), nên mở
  // ra là chính nó phình lên và cả hàng dàn lại — ô tìm kiếm rơi xuống dòng, các nút nhảy
  // chỗ. Không lỗi nào báo; chỉ mắt người mới thấy.
  //
  // ⚠️ ĐO CHIỀU CAO CỦA HÀNG, KHÔNG đo toạ độ tuyệt đối của ô tìm kiếm.
  //
  // Bản đầu của ca này so `x`/`y` tuyệt đối và **xanh khi chạy một mình, đỏ khi chạy cả
  // bộ** — đúng chữ ký luật 18. Lỗi ở chính ca test: toạ độ tuyệt đối phụ thuộc mọi thứ
  // nằm TRÊN hàng công cụ (băng "N đơn cần bạn duyệt" xuống dòng khác đi một nhịp là
  // lệch), nên nó đo cả những thứ không liên quan tới điều cần khoá.
  //
  // Bất biến THẬT của "mở bộ lọc không xô lệch hàng công cụ" là: hàng ấy **không cao
  // thêm**. Ô tìm kiếm rơi xuống dòng thì hàng cao lên — đó chính là thứ trong ảnh chủ
  // dự án gửi. Đo cái đó thì không dính gì tới phần trên trang.
  const hang = page.getByRole("group", { name: "Thanh công cụ đơn hàng" });
  await expect(hang).toBeVisible();
  const truoc = await hang.boundingBox();
  expect(truoc).not.toBeNull();

  await page.getByRole("button", { name: /^Bộ lọc/ }).click();
  await expect(page.getByRole("group", { name: "Bộ lọc chi tiết" })).toBeVisible();

  const sau = await hang.boundingBox();
  expect(sau).not.toBeNull();
  expect(
    sau!.height,
    `hàng công cụ cao từ ${truoc!.height}px lên ${sau!.height}px khi mở bộ lọc`,
  ).toBe(truoc!.height);
  expect(sau!.width, "bề rộng hàng công cụ đổi").toBe(truoc!.width);
});

test("[MDH-10] KHÔNG có chú thích mã nguồn lọt ra màn hình", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, { email: EMAIL[9] });
  await page.goto("/orders");
  await expect(page.locator("table")).toBeVisible();

  // 🔴 SỰ CỐ 25/09/2026, và nó là lỗi của chính bản vá trước đó. Khi dời khối chú thích
  // ra khỏi biểu thức `{moBoLoc && (…)}`, tôi đổi `{/* … */}` thành `/* … */` — mà ở VỊ
  // TRÍ CON của JSX thì `/* */` KHÔNG phải chú thích, nó là CHỮ. Cả đoạn chú thích in
  // thẳng lên trang, ngay trên bảng đơn.
  //
  // ⚠️ Lớp lỗi này CÂM hoàn toàn: `tsc` xanh, `eslint` xanh, mọi ca test xanh. Không có
  // cổng tự động nào của repo bắt được — chỉ chủ dự án nhìn thấy rồi chụp ảnh gửi.
  //
  // Đo bằng CHỮ HIỆN RA, không bằng mã nguồn: `*/` và `/*` là chữ ký không thể nhầm của
  // một chú thích bị rò, và không nội dung nghiệp vụ nào hợp lệ chứa chúng.
  async function chuTrenMan(): Promise<string> {
    return page.evaluate(() => document.body.innerText);
  }

  const dong = await chuTrenMan();
  expect(dong, "chú thích mã nguồn lọt ra màn (bảng lọc ĐÓNG)").not.toMatch(/\/\*|\*\//);

  // Mở bảng lọc rồi đo lại — khối chú thích bị rò nằm ngay cạnh nó, và một ca chỉ đo ở
  // trạng thái đóng sẽ bỏ sót mọi chú thích nằm TRONG nhánh mở.
  await page.getByRole("button", { name: /^Bộ lọc/ }).click();
  await expect(page.getByRole("group", { name: "Bộ lọc chi tiết" })).toBeVisible();
  const mo = await chuTrenMan();
  expect(mo, "chú thích mã nguồn lọt ra màn (bảng lọc MỞ)").not.toMatch(/\/\*|\*\//);
});
