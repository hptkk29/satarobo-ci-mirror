/**
 * #11 T1 (câu 10 BGĐ, Kiệt ký spec 10/07) — lead "dùng chung" (isSharedWithTeam):
 * ai THẤY lead trong danh sách. Postgres LOCAL (.env.test). Actor resolve THẬT từ DB
 * (OrgUnit + RoleDef + UserOrgRole), query qua scopedDb như page thật.
 *
 * ⚠️ CẬP NHẬT 22/08/2026 — ĐỢT E ĐẢO CHÍNH QUYẾT ĐỊNH MÀ FILE NÀY KHOÁ.
 * Chủ dự án chốt Q8 (21/08): **lead độc quyền tuyệt đối**, bỏ tính năng dùng chung.
 * Spec nay nghiệm thu HAI trạng thái, theo cờ `LEAD_SHARING_ENABLED`:
 *   · Mặc định (chính sách TẮT): sale khác KHÔNG thấy lead, kể cả lead đang bật cờ.
 *   · Bật lại bằng env: hành vi cũ trở lại nguyên vẹn — đó là đường quay lui, và
 *     giữ ca cũ ở đây là cách duy nhất biết đường quay lui còn sống.
 *
 * ⚠️ `scopeToSelfWhere()` dưới đây là BẢN SAO where của app/(admin)/admin/leads/page.tsx
 * (nhánh scopeToSelf — sale chỉ có leads:view-own):
 *   AND: [{ OR: [{ assignedToId: <sale> }, ...leadSharedOrClause()] }]
 * gói trong AND để không đè key OR của search q. NẾU ĐỔI where ở page → PHẢI đổi spec này.
 *
 * T1: sale2 cùng CS1 — KHÔNG thấy lead riêng của sale1, và (Đợt E) vẫn KHÔNG thấy
 *     sau khi bật cờ dùng chung.
 * T2 (Q4): sale3 @CS2 — KHÔNG thấy lead CS1 (cách ly cơ sở, độc lập với chính sách).
 * T3: CENTER_MANAGER @CS1 (view-all, không scope-to-self) — thấy bất kể shared.
 * T4 (Đợt E): bật LEAD_SHARING_ENABLED → hành vi cũ sống lại.
 *
 * Chạy: CRM_SKIP_WEBSERVER=1 npx playwright test -c playwright.crm.config.ts lead-share-visibility
 */
import { test, expect } from "@playwright/test";
import type { Prisma } from "@prisma/client";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached, type Actor } from "../../../lib/auth/actor";
import { scopedDb } from "../../../lib/db-scope";
import { leadSharedOrClause } from "../../../lib/lead/sharing";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

async function orgId(code: string): Promise<string> {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerId(code: string): Promise<string> {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
async function roleId(code: string): Promise<string> {
  return (await db.roleDef.findUnique({ where: { code }, select: { id: true } }))!.id;
}
/** Tạo user + gán 1 role tại 1 orgUnit → actor resolve thật (cần cả userId cho where). */
async function makeActor(
  slug: string,
  orgCode: string,
  roleCode: string,
): Promise<{ userId: string; actor: Actor }> {
  const u = await seedUser({ email: testEmail(roleCode, slug), role: "SALES_CSM" });
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: await orgId(orgCode),
    roleId: await roleId(roleCode),
    reason: "seed #11 lead share",
  });
  return { userId: u.id, actor: await resolveActorUncached(u.id) };
}

/**
 * BẢN SAO where của leads/page.tsx nhánh scopeToSelf (sale view-own) — xem header.
 * Cách ly cơ sở KHÔNG nằm ở đây: scopedDb(actor) tự inject `centerId IN visible`.
 *
 * Gọi thẳng `leadSharedOrClause()` chứ không chép lại điều kiện: chép ra đây là đẻ
 * nguồn sự thật thứ hai, và lần sau chính sách đổi thì spec vẫn xanh trong khi màn
 * hình đã khác — đúng kiểu test ru ngủ.
 */
function scopeToSelfWhere(userId: string): Prisma.LeadWhereInput {
  return {
    deletedAt: null,
    AND: [
      {
        OR: [{ assignedToId: userId }, ...leadSharedOrClause()],
      },
    ],
  };
}

/** Danh sách id lead mà actor thấy với where scope-to-self (như page render). */
async function visibleLeadIds(actor: Actor, userId: string): Promise<string[]> {
  const rows = await scopedDb(actor).lead.findMany({
    where: scopeToSelfWhere(userId),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

test.describe("[#11-SHARE] Lead dùng chung (isSharedWithTeam) — phạm vi hiển thị", () => {
  let cs1 = "";
  let cs2 = "";
  let sale1!: { userId: string; actor: Actor }; // owner (assignee) @CS1
  let sale2!: { userId: string; actor: Actor }; // đồng nghiệp cùng CS1
  let sale3!: { userId: string; actor: Actor }; // sale CS2 (đối chứng Q4)
  let cm!: { userId: string; actor: Actor }; // CENTER_MANAGER @CS1 (view-all)
  let leadId = "";

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-share11", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-share11", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    cs1 = await centerId("CS1");
    cs2 = await centerId("CS2");
    sale1 = await makeActor("s1", "CS1", "CENTER_SALES_CSM");
    sale2 = await makeActor("s2", "CS1", "CENTER_SALES_CSM");
    sale3 = await makeActor("s3", "CS2", "CENTER_SALES_CSM");
    cm = await makeActor("cm", "CS1", "CENTER_MANAGER");

    // Lead L thuộc CS1, sale1 phụ trách, CHƯA bật dùng chung.
    const lead = await db.lead.create({
      data: {
        parentName: "PH Share Test",
        phone: "0900001111",
        centerId: cs1,
        assignedToId: sale1.userId,
        status: "MOI",
        isSharedWithTeam: false,
      },
      select: { id: true },
    });
    leadId = lead.id;
  });

  /** Bật "dùng chung" trực tiếp qua db (đường bật/tắt đã test riêng ở toggleLeadShareAction). */
  async function shareLead(): Promise<void> {
    await db.lead.update({
      where: { id: leadId },
      data: { isSharedWithTeam: true, sharedAt: new Date(), sharedById: sale1.userId },
    });
  }

  test("[#11-SHARE-01] Sale2 cùng cơ sở KHÔNG thấy lead của sale1 — kể cả khi cờ dùng chung đang BẬT", async () => {
    // Bất biến gốc: owner luôn thấy lead của mình (nhánh assignedToId).
    expect(await visibleLeadIds(sale1.actor, sale1.userId)).toContain(leadId);

    // Chưa shared → sale2 (cùng CS1, không phải assignee) KHÔNG thấy.
    expect(await visibleLeadIds(sale2.actor, sale2.userId)).not.toContain(leadId);

    // ⚠️ ĐÂY LÀ CHỖ HÀNH VI ĐỔI (Đợt E — Q8 chủ dự án chốt 21/08). Trước 22/08 dòng
    // dưới là `toContain`. Nay lead độc quyền: cờ dùng chung vẫn còn nguyên trong DB
    // nhưng tầng đọc không tôn trọng nó nữa.
    await shareLead();
    expect(await visibleLeadIds(sale2.actor, sale2.userId)).not.toContain(leadId);
  });

  test("[#11-SHARE-04] (Đợt E) Bật lại LEAD_SHARING_ENABLED → hành vi cũ sống lại", async () => {
    // Đường quay lui là lời hứa của Đợt E: đổi chính sách bằng env, không revert
    // code, không mất dữ liệu. Lời hứa không có test thì chỉ là lời hứa.
    await shareLead();
    const cu = process.env.LEAD_SHARING_ENABLED;
    process.env.LEAD_SHARING_ENABLED = "true";
    try {
      expect(await visibleLeadIds(sale2.actor, sale2.userId)).toContain(leadId);
    } finally {
      if (cu === undefined) delete process.env.LEAD_SHARING_ENABLED;
      else process.env.LEAD_SHARING_ENABLED = cu;
    }
    // Trả env về mặc định → lại không thấy.
    expect(await visibleLeadIds(sale2.actor, sale2.userId)).not.toContain(leadId);
  });

  test("[#11-SHARE-02] (Q4) Sale CS2 KHÔNG thấy lead CS1 dù đã shared — cách ly cơ sở", async () => {
    await shareLead();

    // Dù where có nhánh isSharedWithTeam=true, scopedDb(sale3) inject centerId IN [CS2]
    // → lead CS1 bị cách ly. Đây chính là lý do share KHÔNG cần (và không được) nới scope.
    const seen = await visibleLeadIds(sale3.actor, sale3.userId);
    expect(seen).not.toContain(leadId);
    expect(seen).toHaveLength(0);

    // Đối chứng: lead CS2 do CHÍNH sale3 phụ trách thì thấy bình thường — chứng minh
    // ca trên trượt vì cách ly cơ sở, không phải vì actor hỏng.
    // (Trước Đợt E đối chứng dùng một lead shared không có chủ; nay cờ dùng chung
    // không còn mở cửa nữa nên phải đổi sang nhánh assignedToId.)
    const leadCs2 = await db.lead.create({
      data: {
        parentName: "PH CS2",
        phone: "0900002222",
        centerId: cs2,
        assignedToId: sale3.userId,
        status: "MOI",
      },
      select: { id: true },
    });
    expect(await visibleLeadIds(sale3.actor, sale3.userId)).toContain(leadCs2.id);
  });

  test("[#11-SHARE-03] CENTER_MANAGER CS1 (view-all) thấy lead bất kể shared", async () => {
    // CM có leads:view-all → page KHÔNG đi nhánh scopeToSelf; where chỉ còn deletedAt
    // (bản sao baseWhere của page khi canViewAll, không filter thêm).
    const cmWhere: Prisma.LeadWhereInput = { deletedAt: null };

    // Chưa shared → vẫn thấy (view-all trong cơ sở).
    const before = await scopedDb(cm.actor).lead.findMany({ where: cmWhere, select: { id: true } });
    expect(before.map((r) => r.id)).toContain(leadId);

    // Shared → vẫn thấy, không đổi hành vi.
    await shareLead();
    const after = await scopedDb(cm.actor).lead.findMany({ where: cmWhere, select: { id: true } });
    expect(after.map((r) => r.id)).toContain(leadId);
  });
});
