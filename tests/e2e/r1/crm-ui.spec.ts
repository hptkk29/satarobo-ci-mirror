/**
 * R1-03/08 browser e2e — inbox gate + render, dashboard render. Cần webServer (Next dev 3100).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../../e2e/_helpers/seed";
import { login } from "../../e2e/_helpers/auth";
import { testEmail } from "../../e2e/_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

test.describe("[R1-03/08] CRM UI", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[R1-03-C3.3] role không có quyền CRM (TEACHER) → không vào inbox", async ({ page }) => {
    const email = testEmail("teacher-crm");
    await seedUser({ email, role: "TEACHER" });
    await login(page, { email, callbackUrl: "/admin/crm/messenger" });
    await page.goto("/admin/crm/messenger");
    // gate redirect khỏi messenger.
    await expect(page).not.toHaveURL(/\/admin\/crm\/messenger/);
  });

  test("[R1-03-C3.1] SUPER_ADMIN thấy inbox + hội thoại + ô reply", async ({ page }) => {
    const email = testEmail("sa-crm");
    const u = await seedUser({ email, role: "SUPER_ADMIN" });
    const roleId = (await db.roleDef.findUnique({ where: { code: "SUPER_ADMIN" }, select: { id: true } }))!.id;
    const orgId = (await db.orgUnit.findUnique({ where: { code: "HO" }, select: { id: true } }))!.id;
    await assignUserOrgRole(SA, { userId: u.id, orgUnitId: orgId, roleId, reason: "seed" });
    await db.messengerConversation.create({
      data: { pageId: "P", psid: "psid-1", parentName: "Chị Hoa", firstMessageAt: new Date() },
    });

    await login(page, { email, callbackUrl: "/admin/crm/messenger" });
    await page.goto("/admin/crm/messenger");
    await expect(page.getByText("Chị Hoa")).toBeVisible();
    await expect(page.getByRole("button", { name: "Gửi" }).first()).toBeVisible();
  });

  test("[R1-08-C8.1] dashboard funnel hiển thị", async ({ page }) => {
    const email = testEmail("sa-dash");
    await seedUser({ email, role: "SUPER_ADMIN" });
    await db.messengerConversation.create({ data: { pageId: "P", psid: "d1", firstMessageAt: new Date() } });
    await login(page, { email, callbackUrl: "/admin/marketing/funnel" });
    await page.goto("/admin/marketing/funnel");
    await expect(page.getByText("L1 (hội thoại)")).toBeVisible();
    await expect(page.getByText("ROAS", { exact: true })).toBeVisible();
  });
});
