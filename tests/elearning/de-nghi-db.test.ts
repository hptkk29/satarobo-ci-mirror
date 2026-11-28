// @vitest-environment node
/**
 * [DN-DB] Đề nghị đào tạo của người học (`napPhieuCuaToi`, `napPhieuChiTiet`) — Postgres THẬT.
 * Ranh giới: A chỉ thấy phiếu CỦA MÌNH; mã phiếu của B ≡ mã không tồn tại; người duyệt/chương trình hiện đúng khi đã duyệt.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_DND_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import type { ScopedDb } from "../../lib/actions/factory";
import { db } from "../../lib/db";
import { napPhieuChiTiet, napPhieuCuaToi } from "../../lib/elearning/de-nghi-view";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_DND_";
const HAU_TO = "@dnd.test";
// Ranh giới đo ở đây là `requesterUserId`; cách ly cơ sở do e2e đo bằng scopedDb thật.
const sdb = db as unknown as ScopedDb;

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnTrainingNeed.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!RUN_DB_TESTS)("[DN-DB] đề nghị đào tạo (Postgres thật)", () => {
  let a = "";
  let b = "";
  let duyetId = "";

  const tao = (code: string, requesterUserId: string, extra: Record<string, unknown> = {}) =>
    db.trnTrainingNeed.create({
      data: {
        code: `${P}${code}`,
        title: `${P}Nhu cầu ${code}`,
        requesterUserId,
        targetGroupText: "Nhóm thử",
        reason: "Lý do đủ dài để qua",
        expectedOutcome: "Kết quả mong đợi đủ dài",
        proposedQuarter: "2027-Q1",
        ...extra,
      },
      select: { id: true },
    });

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    a = (await seedUser({ email: `a${HAU_TO}`, role: "TEACHER", name: `${P}A` })).id;
    b = (await seedUser({ email: `b${HAU_TO}`, role: "TEACHER", name: `${P}B` })).id;
    duyetId = (await seedUser({ email: `duyet${HAU_TO}`, role: "TRAINING", name: `${P}Chị Duyệt` })).id;
    await tao("A1", a);
    await tao("A2", a, { status: "APPROVED", approvedByUserId: duyetId, approvedAt: new Date("2026-11-15T03:00:00.000Z") });
    await tao("B1", b);
    await tao("A-XOA", a, { deletedAt: new Date() });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[DN-DB-01] đối chứng dương: A thấy đúng 2 phiếu của mình (không có phiếu đã xoá, không có của B)", async () => {
    const ds = await napPhieuCuaToi(sdb, a);
    expect(ds.map((p) => p.code).sort()).toEqual([`${P}A1`, `${P}A2`]);
  }, CASE_TIMEOUT);

  it("[DN-DB-02] 🔴 A mở phiếu của B theo mã ⇒ null — GIỐNG HỆT mã không tồn tại và phiếu đã xoá", async () => {
    expect(await napPhieuChiTiet(sdb, { code: `${P}B1`, userId: a })).toBeNull();
    expect(await napPhieuChiTiet(sdb, { code: `${P}KHONG-CO`, userId: a })).toBeNull();
    expect(await napPhieuChiTiet(sdb, { code: `${P}A-XOA`, userId: a })).toBeNull();
    // đối chứng dương: B mở được của B
    expect((await napPhieuChiTiet(sdb, { code: `${P}B1`, userId: b }))?.title).toBe(`${P}Nhu cầu B1`);
  }, CASE_TIMEOUT);

  it("[DN-DB-03] phiếu đã duyệt: có tên người duyệt + ngày; phiếu mới: không bịa người duyệt", async () => {
    const duyet = await napPhieuChiTiet(sdb, { code: `${P}A2`, userId: a });
    expect(duyet).toMatchObject({ status: "APPROVED", nguoiDuyet: `${P}Chị Duyệt` });
    expect(duyet?.approvedAt?.toISOString()).toBe("2026-11-15T03:00:00.000Z");
    const moi = await napPhieuChiTiet(sdb, { code: `${P}A1`, userId: a });
    expect(moi).toMatchObject({ status: "NEW", nguoiDuyet: null, approvedAt: null, tenChuongTrinh: [] });
  }, CASE_TIMEOUT);
});
