/**
 * Đợt D — chia lead LUÂN PHIÊN ĐỀU LƯỢT, phần chạm DB thật.
 *
 * Chủ dự án chốt Q7 (21/08/2026): chia đều theo SỐ LƯỢT, "qua ngày không reset",
 * "không phân biệt người nhiều việc người ít việc", và **"tuyệt đối không được sai"**.
 * Ba chữ cuối là lý do file này tồn tại: phần toán đã có test thuần
 * (`lib/lead/rotation.test.ts`), nhưng ba thứ dưới đây CHỈ chứng minh được khi có
 * Postgres thật — khoá đua tranh, cách ly cơ sở, và sổ lượt sống qua nhiều lần gọi.
 *
 * ⚠️ CHƯA CHẠY ĐƯỢC Ở MÁY VIẾT (22/08/2026): Postgres portable trên Windows không
 * fork nổi tiến trình con ("could not reserve shared memory region", error 487) ⇒
 * mọi kết nối rớt. Và suite `crm` HIỆN KHÔNG CÓ JOB CI (xem plan/16 Q-TEST-5:
 * "32 spec e2e mồ côi"). Nên coi file này là **chưa có tín hiệu** cho tới khi ai đó
 * chạy nó thật. Ba ca quét-nguồn trong `lib/lead/rotation.test.ts` là thứ đang chạy.
 *
 * Chạy tay (cần Postgres local + .env.test):
 *   CRM_SKIP_WEBSERVER=1 npx playwright test -c playwright.crm.config.ts lead-rotation-fair
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { takeRotationTurn } from "../../../lib/lead/rotation";
import { autoAssignNewLead } from "../../../lib/lead/auto-assign";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const ACTOR = { actorId: null, actorName: "hệ thống (test)" };

async function orgId(code: string): Promise<string> {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerId(code: string): Promise<string> {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
async function roleId(code: string): Promise<string> {
  return (await db.roleDef.findUnique({ where: { code }, select: { id: true } }))!.id;
}

/** Sale thật: có vai SALES_CSM, active, gắn cơ sở — đúng tập mà getSaleStats lấy. */
async function makeSale(slug: string, orgCode: string): Promise<string> {
  const u = await seedUser({ email: testEmail("CENTER_SALES_CSM", slug), role: "SALES_CSM" });
  await db.user.update({
    where: { id: u.id },
    data: { centerId: await centerId(orgCode), isActive: true, roles: ["SALES_CSM"] },
  });
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: await orgId(orgCode),
    roleId: await roleId("CENTER_SALES_CSM"),
    reason: "seed Đợt D rotation",
  });
  return u.id;
}

async function makeLead(cId: string, phone: string): Promise<string> {
  const l = await db.lead.create({
    data: { parentName: "PH Rotation", phone, centerId: cId, status: "MOI" },
    select: { id: true },
  });
  return l.id;
}

test.describe("[Đợt D] Chia lead luân phiên đều lượt", () => {
  let cs1 = "";
  let cs2 = "";
  let ou1 = "";
  let sales: string[] = [];

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-rot", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-rot", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    cs1 = await centerId("CS1");
    cs2 = await centerId("CS2");
    ou1 = await orgId("CS1");
    sales = [await makeSale("r1", "CS1"), await makeSale("r2", "CS1"), await makeSale("r3", "CS1")];
  });

  test("[D-ROT-01] 30 lead / 3 sale → mỗi người đúng 10, sổ lượt khớp", async () => {
    for (let i = 0; i < 30; i++) {
      const id = await makeLead(cs1, `09000${String(i).padStart(5, "0")}`);
      const res = await autoAssignNewLead(id, ACTOR);
      expect(res.ok, `lead thứ ${i} chia lỗi: ${res.error}`).toBe(true);
      expect(res.assignedToId, `lead thứ ${i} không ai nhận`).toBeTruthy();
    }
    const dem = await db.lead.groupBy({
      by: ["assignedToId"],
      where: { centerId: cs1, deletedAt: null },
      _count: { id: true },
    });
    expect(dem).toHaveLength(3);
    for (const d of dem) expect(d._count.id).toBe(10);

    // Sổ lượt phải khớp với số lead thật — hai con số lệch nhau là sổ nói dối.
    const so = await db.leadRotationTurn.findMany({ where: { orgUnitId: ou1 } });
    expect(so).toHaveLength(3);
    for (const r of so) expect(r.turns).toBe(10);
  });

  test("[D-ROT-02] Sổ lượt KHÔNG reset — đợt sau nối tiếp đợt trước", async () => {
    // Đợt 1: 4 lead / 3 sale ⇒ một người được 2, hai người được 1.
    for (let i = 0; i < 4; i++) await autoAssignNewLead(await makeLead(cs1, `09100${i}0000`), ACTOR);
    // Đợt 2 (coi như "hôm sau"): 2 lead nữa. Nếu có chỗ nào reset về 0 thì hai
    // lead này sẽ về lại người đã nhận 2 — và tổng sẽ lệch 3/2/1.
    for (let i = 0; i < 2; i++) await autoAssignNewLead(await makeLead(cs1, `09200${i}0000`), ACTOR);

    const so = await db.leadRotationTurn.findMany({ where: { orgUnitId: ou1 } });
    const vals = so.map((s) => s.turns).sort();
    expect(vals).toEqual([2, 2, 2]);
  });

  test("[D-ROT-03][SS-LR-06] Hai lead cùng lúc → HAI người khác nhau", async () => {
    // Đây là ca mà luồng cũ sai: getSaleStats đọc NGOÀI transaction ⇒ hai lượt
    // đồng thời đọc cùng một trạng thái và chọn trúng một người.
    for (let lan = 0; lan < 10; lan++) {
      const [a, b] = await Promise.all([
        takeRotationTurn(ou1, sales),
        takeRotationTurn(ou1, sales),
      ]);
      expect(a, `lần ${lan}: lượt 1 rỗng`).toBeTruthy();
      expect(b, `lần ${lan}: lượt 2 rỗng`).toBeTruthy();
      expect(a, `lần ${lan}: hai lead cùng tiêu một lượt của ${a}`).not.toBe(b);
    }
    const so = await db.leadRotationTurn.findMany({ where: { orgUnitId: ou1 } });
    expect(so.reduce((s, r) => s + r.turns, 0)).toBe(20);
  });

  test("[D-ROT-04][SS-LR-11] Cơ sở không có sale → lead CHƯA PHÂN, KHÔNG chia xuyên cơ sở", async () => {
    // CS2 không có sale nào. Trước Đợt D, code lấy sale toàn hệ thống làm fallback
    // ⇒ lead CS2 rơi vào tay sale CS1, và người đó KHÔNG mở nổi nó (scopedDb).
    const id = await makeLead(cs2, "0955000000");
    const res = await autoAssignNewLead(id, ACTOR);
    expect(res.ok).toBe(true);
    expect(res.assignedToId ?? null).toBeNull();

    const lead = await db.lead.findUnique({ where: { id }, select: { assignedToId: true } });
    expect(lead?.assignedToId ?? null).toBeNull();
    // Và không lượt nào bị tiêu ở cơ sở khác.
    expect(await db.leadRotationTurn.count()).toBe(0);
  });

  test("[D-ROT-05] Người mới vào vòng NGANG người ít lượt nhất, không nhận dồn", async () => {
    for (let i = 0; i < 12; i++) await autoAssignNewLead(await makeLead(cs1, `09300${i}0000`), ACTOR);
    const moi = await makeSale("r4", "CS1");

    // 4 lead tiếp: người mới nhận đúng 1 (vào ngang, rồi luân phiên), KHÔNG nhận cả 4.
    for (let i = 0; i < 4; i++) await autoAssignNewLead(await makeLead(cs1, `09400${i}0000`), ACTOR);
    const cua = await db.leadRotationTurn.findUnique({
      where: { orgUnitId_userId: { orgUnitId: ou1, userId: moi } },
    });
    // 12 lead / 3 người ⇒ vòng đang ở mức 4 ⇒ người mới vào vòng ở 4.
    expect(cua?.seedTurns, "phải vào NGANG mức thấp nhất, không phải từ 0").toBe(4);
    // Số lead THẬT đã nhận = vị trí − khởi điểm. Phải là 1, không phải 4.
    expect((cua?.turns ?? 0) - (cua?.seedTurns ?? 0), "không được nhận dồn").toBe(1);
  });

  test("[D-ROT-06] Sổ lượt phải KHỚP số lead — không thổi phồng khi vòng đang lấp đầy", () => {
    // Ca này sinh ra từ chính lỗi 22/08: 6 lead từng bị ghi thành 8 lượt vì khởi
    // điểm của người vào sau tính theo "min của những dòng đã có" (=1), thay vì
    // chốt một lần lúc vào vòng. Số ở sổ mà không khớp số lead thì bảng bằng
    // chứng vô giá trị — nên đây là bất biến, không phải chi tiết.
    return (async () => {
      const N = 7;
      for (let i = 0; i < N; i++) await autoAssignNewLead(await makeLead(cs1, `09500${i}0000`), ACTOR);
      const so = await db.leadRotationTurn.findMany({ where: { orgUnitId: ou1 } });
      const daNhan = so.reduce((s, r) => s + (r.turns - r.seedTurns), 0);
      expect(daNhan, "tổng lead đã nhận phải bằng số lead đã chia").toBe(N);
      const gan = await db.lead.count({ where: { centerId: cs1, assignedToId: { not: null } } });
      expect(gan).toBe(N);
    })();
  });
});
