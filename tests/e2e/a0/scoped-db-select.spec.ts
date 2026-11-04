/**
 * scopedDb.findUnique + select HẸP (không xin centerId) — bug có từ A0-04, vá 10/07.
 *
 * Trước fix: passesScope đọc record.centerId; select hẹp ⇒ undefined ⇒ actor cấp cơ sở
 * bị trả null OAN trên chính record cơ sở mình. Quét 10/07 ra 28 call-site dính
 * (chuyển lớp, hoàn thành khoá, in phiếu thu, học bù, tin nhắn...). SUPER_ADMIN không
 * dính (bypass) nên mọi e2e cũ vẫn xanh — vì thế spec này ép actor CENTER-LEVEL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { scopedDb } from "../../../lib/db-scope";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const orgId = async (code: string) =>
  (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
const centerId = async (code: string) =>
  (await db.center.findUnique({ where: { code }, select: { id: true } }))!.id;

async function seedCenters() {
  for (const code of ["CS1", "CS2"]) {
    await db.center.upsert({
      where: { id: code },
      create: { id: code, name: code, code, slug: code.toLowerCase(), address: "test" },
      update: {},
    });
  }
}

async function centerManagerActor(orgCode: string) {
  const u = await seedUser({ email: testEmail(`cm-${orgCode}`), role: "CENTER_MANAGER" });
  const r = (await db.roleDef.findUnique({ where: { code: "CENTER_MANAGER" }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId(orgCode), roleId: r, reason: "seed" });
  return resolveActorUncached(u.id);
}

test.describe("[A0-04-FIX] findUnique select hẹp không được trả null oan", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedCenters();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[FIX-1] CM@CS1 + select hẹp: record CS1 TRẢ VỀ (trước fix: null oan), đúng shape", async () => {
    const lead = await db.lead.create({
      data: { parentName: "PH CS1", phone: "0900000001", centerId: await centerId("CS1") },
      select: { id: true },
    });
    const cm = await centerManagerActor("CS1");

    const r = await scopedDb(cm).lead.findUnique({
      where: { id: lead.id },
      select: { parentName: true }, // KHÔNG xin centerId — trước fix chỗ này chết
    });
    expect(r).not.toBeNull();
    expect(r!.parentName).toBe("PH CS1");
    // centerId được merge nội bộ để check scope thì phải STRIP — trả đúng shape caller xin.
    expect("centerId" in (r as object)).toBe(false);
  });

  test("[FIX-2] IDOR vẫn chặn: CM@CS1 + select hẹp trên record CS2 → null", async () => {
    const lead = await db.lead.create({
      data: { parentName: "PH CS2", phone: "0900000002", centerId: await centerId("CS2") },
      select: { id: true },
    });
    const cm = await centerManagerActor("CS1");

    const r = await scopedDb(cm).lead.findUnique({
      where: { id: lead.id },
      select: { parentName: true },
    });
    expect(r).toBeNull();
  });

  test("[FIX-3] select CÓ xin centerId → giữ nguyên hành vi, field trả về bình thường", async () => {
    const cs1 = await centerId("CS1");
    const lead = await db.lead.create({
      data: { parentName: "PH", phone: "0900000003", centerId: cs1 },
      select: { id: true },
    });
    const cm = await centerManagerActor("CS1");

    const r = await scopedDb(cm).lead.findUnique({
      where: { id: lead.id },
      select: { parentName: true, centerId: true },
    });
    expect(r?.centerId).toBe(cs1);
  });

  test("[FIX-4] không select (full record) → như cũ; model không scoped không bị đụng", async () => {
    const cs1 = await centerId("CS1");
    const lead = await db.lead.create({
      data: { parentName: "PH", phone: "0900000004", centerId: cs1 },
      select: { id: true },
    });
    const cm = await centerManagerActor("CS1");

    const full = await scopedDb(cm).lead.findUnique({ where: { id: lead.id } });
    expect(full?.centerId).toBe(cs1);

    // RoleDef không có centerId, không thuộc SCOPED_MODELS → pass-through nguyên vẹn.
    const role = await scopedDb(cm).roleDef.findUnique({
      where: { code: "CENTER_MANAGER" },
      select: { code: true },
    });
    expect(role?.code).toBe("CENTER_MANAGER");
  });

  test("[FIX-5] tình huống thật đã dính: staffOwnsEnrollment kiểu tin-nhan (Enrollment select {classId})", async () => {
    const cs1 = await centerId("CS1");
    const course = await db.course.create({ data: { name: "Khoá X", slug: "khoa-x" } });
    const cls = await db.class.create({
      data: { name: "Lớp X", courseId: course.id, centerId: cs1, status: "ACTIVE" },
      select: { id: true },
    });
    const student = await db.student.create({ data: { name: "HV", centerId: cs1 }, select: { id: true } });
    const enr = await db.enrollment.create({
      data: { studentId: student.id, classId: cls.id, courseId: course.id, centerId: cs1, status: "STUDYING" },
      select: { id: true },
    });
    const cm = await centerManagerActor("CS1");

    // Đúng shape query của app/(admin)/admin/tin-nhan/_actions.ts:31.
    const e = await scopedDb(cm).enrollment.findUnique({
      where: { id: enr.id },
      select: { classId: true },
    });
    expect(e?.classId).toBe(cls.id); // trước fix: null → QL cơ sở không đọc/gửi được tin nhắn
  });
});
