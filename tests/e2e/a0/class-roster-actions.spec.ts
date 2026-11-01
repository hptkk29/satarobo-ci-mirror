/**
 * 21/08/2026 — Roster lớp: nút "Chuyển lớp" / "Xoá khỏi lớp" / "Nghỉ hẳn"
 * (/admin/classes/<id>/students). Test QUA TRÌNH DUYỆT vì phần dễ vỡ nằm ở UI:
 * gỡ xong thì DÒNG học viên biến mất khỏi roster, nên mọi hộp thoại "việc tiếp theo"
 * phải sống ở cấp danh sách. Bản đầu đặt hộp thoại trong dòng và test này bắt được
 * hai lỗi liền: hộp thoại bị unmount, rồi nút xác nhận kẹt ở "Đang xử lý…".
 *
 * Phủ:
 *  R1 — HV có Student.status=INACTIVE VẪN nằm trong roster (đúng bản chất bug đã báo:
 *       roster đọc từ Enrollment, không đọc Student.status) → nên phải có nút để gỡ.
 *  R2 — gỡ HV đang học → báo "Chờ xếp lớp", dòng biến mất khỏi lớp.
 *  R3 — gỡ HV đã nghỉ học + hết lớp → mở tiếp "Nghỉ hẳn"; xác nhận thì Student bị xoá
 *       mềm VÀ StudentCenterHistory được chốt sổ (dấu vết "đã từng học tại cơ sở này").
 *  R4 — hộp thoại Chuyển lớp chỉ liệt kê lớp CÙNG KHOÁ, CÙNG CƠ SỞ.
 *  R5 — 375px không tràn ngang.
 *
 * ⚠️ actor.isSuperAdmin suy từ UserOrgRole chứ KHÔNG từ User.role — thiếu dòng đó thì
 * scopedDb chèn `centerId IN []` và trang lớp trả 404 (xem seedAdmin).
 *
 * ⚠️ VÌ SAO NẰM Ở `tests/e2e/a0` CHỨ KHÔNG PHẢI `r7` (nơi có các spec cùng chủ đề):
 * job CI "E2E Phase R7" CỐ Ý không cài trình duyệt — toàn bộ spec R7 là service-level,
 * và chính bước `playwright install` từng là chỗ duy nhất giết job đó (apt treo 19 phút).
 * Bộ A0 mới là bộ có đủ ba thứ spec này cần: trình duyệt, webServer :3100, Postgres local
 * + `.env.test` — giống `login-identifier.spec.ts` / `forgot-password.spec.ts` ở cạnh đây.
 * Phần LOGIC (không cần trình duyệt) của cùng bản vá nằm ở
 * `tests/e2e/r7/withdraw-student-legacy-active.spec.ts`.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { login } from "../_helpers/auth";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

/** actor.isSuperAdmin suy từ UserOrgRole, KHÔNG từ User.role — thiếu dòng này thì
 *  scopedDb chèn `centerId IN []` và trang lớp trả notFound (404). */
async function seedAdmin(email: string) {
  const u = await seedUser({ email, role: "SUPER_ADMIN" });
  const root = await db.orgUnit.findFirst({ where: { code: "SATAROBO" }, select: { id: true } });
  const org = root ?? (await db.orgUnit.findFirstOrThrow({ where: { code: "HO" }, select: { id: true } }));
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" }, select: { id: true } });
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: org.id,
    roleId: role.id,
    reason: "smoke",
  });
  return u;
}

const CLASS_A = "smoke-class-a";
const CLASS_B = "smoke-class-b";

async function seedScenario() {
  const center = await db.center.create({
    data: { code: "CS1", name: "CS1 Nguyễn Hữu Thọ", slug: "cs1", address: "211 NHT" },
  });
  await seedOrg(["HO", "CS1"]);
  await seedRoles();
  const course = await db.course.create({
    data: { name: "Sata 1", slug: "sata-1", price: 4_000_000 },
  });
  await db.class.create({
    data: {
      id: CLASS_A,
      name: "Sata1-A (smoke)",
      courseId: course.id,
      centerId: center.id,
      maxStudents: 12,
      status: "ACTIVE",
    },
  });
  await db.class.create({
    data: {
      id: CLASS_B,
      name: "Sata1-B (smoke)",
      courseId: course.id,
      centerId: center.id,
      maxStudents: 12,
      status: "RECRUITING",
    },
  });

  const specs = [
    { id: "smoke-hv-1", name: "Be An dang hoc", sStatus: "ACTIVE" as const, eStatus: undefined },
    { id: "smoke-hv-2", name: "Be Binh da xep", sStatus: "ACTIVE" as const, eStatus: "CONFIRMED" as const },
    { id: "smoke-hv-3", name: "Be Cuong da nghi", sStatus: "INACTIVE" as const, eStatus: "STUDYING" as const },
  ];
  for (const s of specs) {
    await db.student.create({
      data: {
        id: s.id,
        name: s.name,
        centerId: center.id,
        status: s.sStatus,
        parentName: `PH ${s.name}`,
        parentPhone: `84900000${s.id.slice(-3)}`,
      },
    });
    await db.enrollment.create({
      data: {
        studentId: s.id,
        classId: CLASS_A,
        courseId: course.id,
        centerId: center.id,
        finalPrice: 4_000_000,
        ...(s.eStatus ? { status: s.eStatus } : {}),
      },
    });
  }
  return { center, course };
}

test.describe("[BUG-2108-UI] Roster lớp — chuyển / gỡ / nghỉ hẳn", () => {
  test("[R1-R4] gỡ HV đang học → chờ xếp lớp; gỡ HV đã nghỉ → nghỉ hẳn + giữ dấu vết cơ sở", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await resetDb();
    await seedScenario();
    await seedAdmin("smoke-admin@satarobo.vn");
    await login(page, {
      email: "smoke-admin@satarobo.vn",
      callbackUrl: `/admin/classes/${CLASS_A}/students`,
      timeout: 120_000,
    });
    await page.goto(`/admin/classes/${CLASS_A}/students`);
    await expect(page.getByRole("heading", { name: /Học sinh lớp/ })).toBeVisible({
      timeout: 60_000,
    });

    // Cả 3 em đều nằm trong lớp (kể cả em Student.status=INACTIVE — đúng bug đã báo).
    await expect(page.getByText("Be An dang hoc")).toBeVisible();
    await expect(page.getByText("Be Binh da xep")).toBeVisible();
    await expect(page.getByText("Be Cuong da nghi")).toBeVisible();

    // Nút mới có mặt trên từng dòng.
    await expect(page.getByRole("button", { name: /Chuyển lớp/ })).toHaveCount(3);
    await expect(page.getByRole("button", { name: /khỏi lớp/ })).toHaveCount(3);

    await page.screenshot({ path: "test-results/roster-actions-roster-desktop.png", fullPage: true });

    // ── Ca 1: gỡ em ĐANG HỌC → thông báo "Chờ xếp lớp".
    const rowAn = page.locator("li", { hasText: "Be An dang hoc" }).first();
    await rowAn.getByRole("button", { name: /khỏi lớp/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: "test-results/roster-actions-remove-dialog.png" });
    await page.getByRole("dialog").getByRole("textbox").fill("Phu huynh xin doi lich");
    await page.getByRole("button", { name: "Xác nhận gỡ khỏi lớp" }).click();
    await expect(page.getByText(/Chờ xếp lớp/)).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "test-results/roster-actions-after-remove-active.png" });
    await expect(page.getByText("Be An dang hoc")).toHaveCount(0, { timeout: 20_000 });

    // ── Ca 2: gỡ em ĐÃ NGHỈ HỌC → hiện nút "Nghỉ hẳn".
    const rowCuong = page.locator("li", { hasText: "Be Cuong da nghi" }).first();
    await rowCuong.getByRole("button", { name: /khỏi lớp/ }).click();
    await page.getByRole("dialog").getByRole("textbox").fill("Da nghi han, don ho so");
    await page.getByRole("button", { name: "Xác nhận gỡ khỏi lớp" }).click();
    await expect(
      page.getByRole("heading", { name: /Nghỉ hẳn — Be Cuong da nghi/ }),
    ).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "test-results/roster-actions-leave-dialog.png" });
    await page.getByRole("button", { name: "Xác nhận nghỉ hẳn" }).click();
    await expect(
      page.getByText(/Đã cho Be Cuong da nghi nghỉ hẳn/).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Be Cuong da nghi")).toHaveCount(0, { timeout: 20_000 });

    const gone = await db.student.findUnique({
      where: { id: "smoke-hv-3" },
      select: { deletedAt: true },
    });
    expect(gone?.deletedAt).not.toBeNull();
    const hist = await db.studentCenterHistory.findMany({ where: { studentId: "smoke-hv-3" } });
    expect(hist).toHaveLength(1);
    expect(hist[0].toDate).not.toBeNull();

    // ── Ca 3: dialog chuyển lớp liệt kê lớp B cùng khoá, cùng cơ sở.
    const rowBinh = page.locator("li", { hasText: "Be Binh da xep" }).first();
    await rowBinh.getByRole("button", { name: /Chuyển lớp/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("combobox")).toContainText(
      "Sata1-B (smoke)",
    );
    await page.screenshot({ path: "test-results/roster-actions-transfer-dialog.png" });
  });

  test("[R5] 375px — hàng học viên không tràn ngang", async ({ page }) => {
    test.setTimeout(180_000);
    await resetDb();
    await seedScenario();
    await seedAdmin("smoke-admin2@satarobo.vn");
    await page.setViewportSize({ width: 375, height: 800 });
    await login(page, {
      email: "smoke-admin2@satarobo.vn",
      callbackUrl: `/admin/classes/${CLASS_A}/students`,
      timeout: 120_000,
    });
    await page.goto(`/admin/classes/${CLASS_A}/students`);
    await expect(page.getByRole("heading", { name: /Học sinh lớp/ })).toBeVisible({
      timeout: 60_000,
    });
    await page.screenshot({ path: "test-results/roster-actions-roster-375.png", fullPage: true });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "trang tràn ngang ở 375px").toBeLessThanOrEqual(1);
  });
});
