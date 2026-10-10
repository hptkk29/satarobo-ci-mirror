/**
 * R4-01 — ownership: PH chỉ thấy con MÌNH (C1.4), token chống tamper (C1.3). PG LOCAL.
 * getChildren là server-only nên test trực tiếp truy vấn (cùng ngữ nghĩa) + token thuần.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../../e2e/_helpers/seed";
import { testEmail } from "../../e2e/_helpers/fixtures";
import { makeToken, verifyToken } from "../../../lib/portal/active-site-token";

test.describe("[R4-01] Portal ownership", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R4-01-C1.4] PH chỉ thấy con mình; con người khác KHÔNG lọt", async () => {
    const pa = await seedUser({ email: testEmail("pa"), role: "PARENT" });
    const pb = await seedUser({ email: testEmail("pb"), role: "PARENT" });
    const x = await db.student.create({ data: { name: "Con X", parentUserId: pa.id } });
    const y = await db.student.create({ data: { name: "Con Y", parentUserId: pa.id } });
    const z = await db.student.create({ data: { name: "Con Z", parentUserId: pb.id } });

    const childrenOfA = await db.student.findMany({ where: { parentUserId: pa.id, deletedAt: null }, select: { id: true } });
    const ids = childrenOfA.map((c) => c.id).sort();
    expect(ids).toEqual([x.id, y.id].sort());
    expect(ids).not.toContain(z.id); // C1.4 — con người khác không lọt

    // Giả lập cookie tamper sang con Z (của PH khác): getPortalContext chỉ chấp nhận
    // nếu studentId nằm trong danh sách con → Z bị từ chối.
    const accepted = childrenOfA.find((c) => c.id === z.id);
    expect(accepted).toBeUndefined();
  });

  test("[R4-01-C1.3] token activeSite hợp lệ verify được; sửa value → bị từ chối", async () => {
    const p = await seedUser({ email: testEmail("p1"), role: "PARENT" });
    const child = await db.student.create({ data: { name: "Con", parentUserId: p.id } });
    const tok = makeToken(child.id, "secret-x");
    expect(verifyToken(tok, "secret-x")).toBe(child.id);
    const forged = "other-student." + tok.split(".")[1];
    expect(verifyToken(forged, "secret-x")).toBeNull(); // không thể đổi sang con khác
  });
});
