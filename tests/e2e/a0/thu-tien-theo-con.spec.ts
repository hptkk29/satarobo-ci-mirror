/**
 * 21/09/2026 — ĐƯỜNG THU TIỀN THEO CON trên màn đơn, QUA TRÌNH DUYỆT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO SPEC NÀY TỒN TẠI
 *
 * Từ 21/09 có năm lượt liên tiếp (PHIÊN A · B · C · D · E) đưa nút mới lên đúng một
 * màn — gắn khoản cho bé, tách khoản, phát phiếu QR gộp, dừng học — và **không cổng
 * nào bấm một nút thật**: mọi bộ đang xanh (`R7`, `R1`, `CRM`, `FL`, `finance-db`,
 * unit) chạy ở TẦNG DỊCH VỤ, tức gọi hàm chứ không bấm nút.
 *
 * Đó đúng là lớp lỗi luật 12 mô tả: con trỏ · nhãn · nút đều là LỜI HỨA, và lời hứa
 * suông **không ném lỗi, không làm test đỏ, console vẫn sạch** — chỉ người bấm mới
 * biết. Repo đã trả giá ba lần trong một tuần cho đúng lớp ấy (nhãn "Hoàn tất" suy ra ·
 * `photoDone` không bao giờ true · chevron `/cham-cong` chưa từng được nối).
 *
 * ⚠️ PHẠM VI CỐ Ý HẸP: spec này hỏi **"nút có nối không"**, KHÔNG hỏi "tiền tính đúng
 * không". Phần số tiền đã phủ kín ở `tests/finance/*` (Postgres thật) và
 * `lib/finance/*.test.ts` (thuần). Nhồi thêm khẳng định tiền vào đây là dựng bản sao thứ
 * hai của những ca ấy — chậm hơn, mong manh hơn, và khi đỏ thì không ai biết đỏ vì UI
 * hay vì phép tính.
 *
 * ⚠️ KHÔNG bấm "Xác nhận dừng học". Dừng học **không hoàn tác được**; dừng ở màn xem
 * trước là đủ trả lời câu hỏi của spec, và giữ cho ca chạy lại được trên cùng fixture.
 *
 * ⚠️ VÌ SAO NẰM Ở `tests/e2e/a0`: job "E2E Phase R7" CỐ Ý không cài trình duyệt. Bộ A0
 * mới có đủ ba thứ spec này cần — trình duyệt, webServer :3100, Postgres local +
 * `.env.test`. Cùng lý lẽ đã ghi ở `class-roster-actions.spec.ts`.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { login } from "../_helpers/auth";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { KHOA_CONG_TAC } from "../../../lib/finance/feature";

const SA: RbacActor = { id: "seed-sa-ttc", name: "SA", role: "SUPER_ADMIN" };

/** Một email cho MỖI ca — xem chú thích ở `beforeAll`. */
const EMAIL = ["sa1@ttc.vn", "sa2@ttc.vn", "sa3@ttc.vn", "sa4@ttc.vn", "sa5@ttc.vn"] as const;

/**
 * Cơ sở của đơn — LẤY TỪ CÂY do `seedOrg` dựng, không tạo bản thứ hai.
 *
 * ⚠️ Bản cũ tự `db.center.create({ code: "CS2" })`. Việc đó chạy được chỉ vì `seedOrg`
 * khi ấy KHÔNG dựng `Center` nào — tức fixture có một `Center` mã CS2 trong khi
 * `OrgUnit(CS2).centerId` là null, hai thứ lẽ ra phải là một. Từ 23/09 `seedOrg` dựng
 * `Center` và nối cầu đàng hoàng, nên tạo thêm ở đây là đụng khoá duy nhất `code`.
 * Dùng lại cái đã có vừa hết đụng, vừa cho ra fixture NÓI THẬT về quan hệ cơ sở ↔ đơn vị.
 */
let CENTER = "";
const DON = "ttc-don";
const BE_A = "ttc-item-a";
const BE_B = "ttc-item-b";
const KHOAN = "ttc-pay";

/** Học phí mỗi bé + khoản phụ huynh chuyển MỘT LẦN cho cả hai — hình dạng ca thật. */
const HOC_PHI = 8_000_000;
/**
 * Tên khoá — DÙNG CHUNG cho cả hai dòng, cố ý.
 *
 * Đây là hình dạng `/orders/new` thật sự ghi (`itemName: Course.name`), và là ca chủ
 * dự án hỏi 25/09/2026. Đặt hai chuỗi khác nhau ở đây là làm spec xanh vì lý do sai.
 */
const KHOA = "Sata 4 — Lập trình khối";
const DA_CHUYEN = 5_000_000;

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
  CENTER = (
    await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })
  ).id;
  // ⚠️ MỖI CA MỘT TÀI KHOẢN — không phải để cho đẹp.
  //
  // `lib/auth.ts:133` chặn **5 lượt đăng nhập/phút theo ĐỊNH DANH**, bộ đếm nằm trong bộ
  // nhớ tiến trình server nên `resetDb()` không xoá được. Năm ca dùng chung một email là
  // chạm đúng trần, và chạy lại spec trong cùng một phút thì trần đã bị tiêu từ lượt
  // trước ⇒ ca đỏ ở `/login` mà không lỗi nào được ném.
  //
  // Đo thật 21/09: dùng chung email ⇒ lượt 1 xanh 5/5, lượt 2 và 3 chỉ 3/5. Mỗi ca một
  // email ⇒ ba lượt liên tiếp đều 5/5. (Vế IP đã được `login()` tự tách — xem
  // `tests/e2e/_helpers/auth.ts`.)
  for (const e of EMAIL) await seedAdmin(e);

  // ⚠️ CÔNG TẮC phải BẬT, nếu không cả khối "Công nợ theo con" không được dựng và spec
  // sẽ đỏ với lý do hoàn toàn khác ("không thấy nút"). Bật ở mức TOÀN HỆ cho gọn — phép
  // giải theo cơ sở đã có ca riêng ở `lib/finance/feature.test.ts`.
  await db.systemSetting.upsert({
    where: { key: KHOA_CONG_TAC },
    create: { key: KHOA_CONG_TAC, valueJson: true },
    update: { valueJson: true },
  });

  // ⚠️ FIXTURE MANG HÌNH DẠNG THẬT — HAI CON HỌC CÙNG MỘT KHOÁ [25/09/2026].
  //
  // Bản trước ghi "Bé Thứ Nhất"/"Bé Thứ Hai" thẳng vào `itemName`, và **xanh vì lý do
  // sai**: nó ghim đúng cái giả định mà đường ghi thật vi phạm (luật 9). Trên
  // `/orders/new`, `itemName` được gán `Course.name` — tên KHOÁ — nên hai con cùng khoá
  // sinh ra hai dòng có nhãn GIỐNG HỆT NHAU. Chủ dự án hỏi đúng chỗ đó:
  //   *"2 con học cùng khoá thì sao biết là đang giảm đơn cho con nào?"*
  //
  // Nay cả hai dòng mang CÙNG `itemName`, và danh tính bé nằm ở
  // `metadata.leadChildId` — đúng đường mà `/orders/new` ghi. Mọi khẳng định "thấy tên
  // bé" bên dưới vì thế chỉ ĐẠT khi chuỗi suy `lib/orders/ten-con-tren-dong.ts` chạy
  // thật; gỡ nó ra là spec đỏ ngay.
  const lead = await db.lead.create({
    data: { parentName: "Phụ huynh hai con", phone: "0909000099", centerId: CENTER },
    select: { id: true },
  });
  const conLead: Record<string, string> = {};
  for (const [dongId, tenBe] of [
    [BE_A, "Bé Thứ Nhất"],
    [BE_B, "Bé Thứ Hai"],
  ] as const) {
    const c = await db.leadChild.create({
      data: { leadId: lead.id, fullName: tenBe },
      select: { id: true },
    });
    conLead[dongId] = c.id;
  }

  await db.order.create({
    data: {
      id: DON,
      code: "ORD-260921-000099",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh hai con",
      customerPhone: "0909000099",
      totalAmount: HOC_PHI * 2,
      centerId: CENTER,
      leadId: lead.id,
    },
  });
  for (const dongId of [BE_A, BE_B] as const) {
    await db.orderItem.create({
      data: {
        id: dongId,
        orderId: DON,
        type: "COURSE_ENROLLMENT",
        // CÙNG một chuỗi cho cả hai dòng — đây là điểm mấu chốt của fixture.
        itemName: KHOA,
        quantity: 1,
        unitPrice: HOC_PHI,
        totalPrice: HOC_PHI,
        metadata: { leadChildId: conLead[dongId] },
      },
    });
  }
  // Tiền ĐÃ VỀ mà chưa biết của bé nào — đúng hình dạng 146 khoản trên prod, và là điều
  // kiện để hai nút "Gắn cho bé" / "Tách khoản" hiện ra.
  await db.payment.create({
    data: {
      id: KHOAN,
      orderId: DON,
      orderItemId: null,
      amount: DA_CHUYEN,
      method: "BANK_TRANSFER",
      accountantStatus: "PENDING",
      paidDate: new Date("2026-09-20T03:00:00Z"),
      centerId: CENTER,
    },
  });
});

test("[TTC-01] khối Công nợ theo con hiện đủ hai bé + khoản chưa gắn", async ({ page }) => {
  await login(page, { email: EMAIL[0] });
  await page.goto(`/admin/orders/${DON}`);

  await expect(page.getByRole("heading", { name: /Công nợ theo con/i })).toBeVisible();

  // ⚠️ Neo TRONG khối, không neo cả trang: tên bé xuất hiện ở BA chỗ (khối công nợ, nút
  // chọn bé, bảng dòng hàng) và `getByText` trần vi phạm strict mode. Bản đầu của ca này
  // đỏ đúng vì thế — và đó là một phát hiện, không phải phiền toái: nó cho thấy tên bé là
  // thứ lặp lại khắp màn, nên mọi locator sau này phải nói rõ nó đang nói về khối nào.
  // ⚠️ `.first()` vì ngay TRONG khối tên bé cũng xuất hiện hai lần: một ở tiêu đề khối
  // của bé, một ở ô chọn bé của khoản chưa gắn. Dùng `getByText` trần là vi phạm strict
  // mode — và điều đó nói đúng một điều có ích: tên bé không phải một định danh duy nhất
  // trên màn này, nên đừng neo gì quan trọng vào nó.
  const khoi = page.getByLabel("Công nợ theo con");
  await expect(khoi.getByText("Bé Thứ Nhất").first()).toBeVisible();
  await expect(khoi.getByText("Bé Thứ Hai").first()).toBeVisible();
  // Khoản chưa gắn phải HIỆN RA như một việc cần làm — 5.000.000đ tiền thật đang không
  // thuộc về bé nào.
  await expect(khoi.getByText(/5\.000\.000/).first()).toBeVisible();
});

test("[TTC-02] 'Gắn cho bé…' mở ô chọn và gắn được THẬT", async ({ page }) => {
  await login(page, { email: EMAIL[1] });
  await page.goto(`/admin/orders/${DON}`);

  await page.getByRole("button", { name: "Gắn cho bé…" }).first().click();
  // Mở ra thì phải có đủ hai bé để chọn — danh sách rỗng nghĩa là nút hứa suông.
  const chon = page.getByLabel("Chọn bé để gắn khoản này");
  await expect(chon).toBeVisible();
  await chon.selectOption({ label: "Bé Thứ Nhất" });
  await page.getByRole("button", { name: "Gắn", exact: true }).click();

  // Vế đang kiểm là "nút NỐI ĐÚNG đường ghi", không phải "số tiền đúng" (đã phủ kín ở
  // tests/finance/gan-khoan-cho-con.test.ts trên Postgres thật).
  await expect
    .poll(
      async () =>
        (await db.payment.findUnique({ where: { id: KHOAN }, select: { orderItemId: true } }))
          ?.orderItemId,
      { timeout: 15_000 },
    )
    .toBe(BE_A);

  // Trả fixture về trạng thái đầu để [TTC-03] chạy độc lập (luật 18: mỗi ca phải xanh khi
  // chạy MỘT MÌNH, và "một mình" gồm cả "không nhờ ca trước dọn hộ").
  await db.payment.update({ where: { id: KHOAN }, data: { orderItemId: null } });
});

test("[TTC-03] 'Tách cho nhiều bé…' mở form chia cho TỪNG bé", async ({ page }) => {
  await login(page, { email: EMAIL[2] });
  await page.goto(`/admin/orders/${DON}`);

  // ⚠️ Nhãn thật là "Tách cho nhiều bé…", không phải "Tách khoản". Bản đầu gõ theo trí nhớ
  // và ca đỏ sau 30s chờ một nút không tồn tại — đúng thứ spec qua trình duyệt sinh ra để
  // bắt, chỉ lần này nó bắt chính tôi.
  await page.getByRole("button", { name: "Tách cho nhiều bé…" }).first().click();

  // Form tách phải có ô nhập cho TỪNG bé — một ô là không tách được cho ai.
  await expect(page.getByRole("textbox", { name: /Bé Thứ Nhất/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Bé Thứ Hai/i })).toBeVisible();
  // Và nói rõ tổng phải đúng bằng bao nhiêu — luật Σ-đúng-bằng giữ cho tiền không tự sinh.
  await expect(page.getByText(/đúng bằng/i).first()).toBeVisible();
});

test("[TTC-04] nút 'Dừng học' mở màn XEM TRƯỚC (không bấm xác nhận)", async ({ page }) => {
  await login(page, { email: EMAIL[3] });
  await page.goto(`/admin/orders/${DON}`);

  // ⚠️ LỐI VÀO ĐỔI 24/09/2026: "Dừng học…" nay là MỤC MENU trong nút `⋯`, không còn là
  // một nút rải trên thẻ. Lý lẽ của ca này không đổi một chữ — nó nói về NỘI DUNG màn
  // xem trước — nên sửa locator là hợp lệ.
  //
  // ⚠️ Nhưng phải kèm KHẲNG ĐỊNH DƯƠNG rằng mục ấy CÓ trong menu. Thiếu vế đó thì gỡ hẳn
  // mục khỏi menu sẽ không làm ca nào đỏ: ca này chỉ còn chứng minh "hộp thoại nào đó mở
  // ra được", mà không ai mở được nó nữa (luật 11 + luật 12).
  await page.getByRole("button", { name: /Việc khác cho Bé Thứ Nhất/i }).click();
  const mucDungHoc = page.getByRole("menuitem", { name: /Dừng học/i });
  await expect(mucDungHoc).toBeVisible();
  await mucDungHoc.click();

  const hop = page.getByRole("dialog");
  await expect(hop.getByText(/Dừng học — Bé Thứ Nhất/)).toBeVisible();
  // Ba thứ màn xem trước BẮT BUỘC nói ra trước khi ai đó gật.
  await expect(hop.getByText(/Không hoàn tác được/i)).toBeVisible();
  await expect(hop.getByText(/Phụ huynh chủ động cho nghỉ/)).toBeVisible();
  await expect(hop.getByText(/Trung tâm huỷ lớp/)).toBeVisible();

  // ⚠️ DỪNG Ở ĐÂY. Không bấm "Xác nhận dừng học" — xem khối chú thích đầu tệp.
  await expect(hop.getByRole("button", { name: /Xác nhận dừng học/ })).toBeVisible();
});

test("[TTC-05] 375px: khối công nợ theo con KHÔNG tràn ngang", async ({ page }) => {
  // Tên tiếng Việt dài + tiền 9 chữ số là mặc định của màn này, nên tràn ngang không
  // phải chuyện hiếm — nó là chuyện thường nếu không ai đo.
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page, { email: EMAIL[4] });
  await page.goto(`/admin/orders/${DON}`);
  await expect(page.getByRole("heading", { name: /Công nợ theo con/i })).toBeVisible();

  const tran = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(tran, "trang tràn ngang ở 375px").toBeLessThanOrEqual(1);
});
