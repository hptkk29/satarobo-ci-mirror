// @vitest-environment node
/**
 * Phiếu nhu cầu theo quyền — Postgres thật (hotfix 26/10/2026).
 *
 * Người đề xuất giữ chức năng gửi phiếu, nhưng chỉ làm điều thuộc quyền mình:
 *   • TẠO phiếu: ai có `elearning:portal:access`; người đề nghị do SERVER gán (không bao giờ từ giao diện);
 *   • THẤY phiếu: chỉ phiếu của chính mình (người quản lý thấy mọi phiếu trong phạm vi);
 *   • DUYỆT phiếu: chỉ `elearning:program:manage`, và không tự duyệt phiếu của mình.
 *
 * Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG (luật 11): "không thấy phiếu người khác" luôn đạt nếu trang hỏng hẳn và không hiện gì cả.
 * `quanLy` ở đây tính bằng `can()` THẬT của actor dựng từ DB — đúng cách trang tính, không gõ tay.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import { can } from "../../lib/auth/can";
import { resolveActorUncached, type Actor } from "../../lib/auth/actor";
import { runAction } from "../../lib/actions/factory";
import { cauHinhDuyetPhieuNhuCau, cauHinhTaoPhieuNhuCau, dieuKienPhieuXem } from "../../lib/elearning/training-need";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const ID: Record<string, string> = {};
const MA: Record<string, string> = {};

/**
 * ⚠️ KHÔNG `resetDb()` (TRUNCATE mọi bảng) — sự cố CI 26/10/2026. Ở CI các bộ DB chạy TUẦN TỰ trên CÙNG một database `ci_test`
 * (`ci-guong/ci.yml`: chat → nền → elearning → lead-intake → … → hoa hồng). TRUNCATE ở đây xoá cả dữ liệu danh mục do MIGRATION seed
 * (CommissionRole, LeadSourceGroup…) và 50 ca của bộ hoa hồng/lead-intake chạy SAU đỏ ("expected [] to deeply equal [SALE…]").
 * Ở máy dev không thấy vì mỗi bộ chạy trên DB riêng. Quy ước của khu này (xem `cach-ly-co-so.spec.ts`): chỉ dọn dữ liệu MANG DẤU
 * của chính bộ test, ở beforeAll VÀ afterAll.
 */
const HAU_TO_EMAIL = "@phieu.test";
const TIEN_TO_TIEU_DE = "Phiếu của";

/** Xoá đúng dữ liệu MANG DẤU của bộ này (phiếu của các tài khoản `@phieu.test`, vai gán cho họ). */
async function don(): Promise<void> {
  const nguoi = await db.user.findMany({ where: { email: { endsWith: HAU_TO_EMAIL } }, select: { id: true } });
  const ids = nguoi.map((u) => u.id);
  if (ids.length === 0) return;
  await db.trnTrainingNeed.deleteMany({ where: { requesterUserId: { in: ids } } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
}

async function lap(ten: string, vai: string, coSo: "HO" | "CS1") {
  const u = await seedUser({ email: `${ten}${HAU_TO_EMAIL}`, role: "TEACHER", name: ten });
  const donVi = await db.orgUnit.findFirstOrThrow({ where: { code: coSo }, select: { id: true } });
  const r = await db.roleDef.findUniqueOrThrow({ where: { code: vai }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: donVi.id, roleId: r.id, grantedById: u.id } });
  ID[ten] = u.id;
}

const actorCua = (ten: string): Promise<Actor> => resolveActorUncached(ID[ten]);

const PHIEU = (tieuDe: string) => ({
  title: tieuDe,
  targetGroupText: "Nhóm thử nghiệm",
  reason: "Lý do đủ dài để qua kiểm tra",
  expectedOutcome: "Kết quả mong đợi đủ dài",
  proposedQuarter: "2026-Q4",
});

async function gui(ten: string, tieuDe: string) {
  const actor = await actorCua(ten);
  const { res } = await runAction(cauHinhTaoPhieuNhuCau, actor, PHIEU(tieuDe), { actorName: ten });
  expect(res.ok, `${ten} gửi phiếu`).toBe(true);
  if (res.ok) MA[tieuDe] = res.data.needId;
}

/** Đúng cách trang tính: `quanLy` từ `can()` thật, `where` từ `dieuKienPhieuXem`, đọc qua `scopedDb`. */
async function thay(ten: string): Promise<string[]> {
  const actor = await actorCua(ten);
  const quanLy = can(actor, "elearning:program:manage");
  const dong = await scopedDb(actor).trnTrainingNeed.findMany({
    where: dieuKienPhieuXem({ quanLy, userId: actor.userId }),
    select: { title: true },
    orderBy: { title: "asc" },
  });
  // DB dùng chung ở CI: chỉ xét phiếu MANG DẤU của bộ này (người quản lý thấy cả phiếu của các bộ khác).
  return dong.map((x: { title: string }) => x.title).filter((t: string) => t.startsWith(TIEN_TO_TIEU_DE));
}

describe.skipIf(!RUN_DB_TESTS)("Phiếu nhu cầu theo quyền — Postgres thật", () => {
  beforeAll(async () => {
    await don(); // dọn dấu vết của lượt chạy trước (nếu có) — KHÔNG TRUNCATE
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    await lap("dao_tao", "TRAINING", "HO"); // có program:manage
    await lap("gv_a", "TEACHER", "CS1"); // chỉ đề nghị
    await lap("sale_b", "CENTER_SALES_CSM", "CS1"); // chỉ đề nghị
    await gui("gv_a", "Phiếu của A");
    await gui("sale_b", "Phiếu của B");
    await gui("dao_tao", "Phiếu của Đào tạo");
  });
  afterAll(async () => {
    await don();
    await disconnectDb();
  });

  it("[PQ-01] ĐỐI CHỨNG DƯƠNG: phân vai đúng — Đào tạo có program:manage, hai người kia thì không", async () => {
    expect(can(await actorCua("dao_tao"), "elearning:program:manage")).toBe(true);
    expect(can(await actorCua("gv_a"), "elearning:program:manage")).toBe(false);
    expect(can(await actorCua("sale_b"), "elearning:program:manage")).toBe(false);
  });

  it("[PQ-02] người đề nghị do SERVER gán: phiếu mang đúng id người gửi", async () => {
    const dong = await db.trnTrainingNeed.findMany({
      where: { title: { startsWith: TIEN_TO_TIEU_DE } },
      select: { title: true, requesterUserId: true },
    });
    const theoTen = Object.fromEntries(dong.map((d) => [d.title, d.requesterUserId]));
    expect(theoTen["Phiếu của A"]).toBe(ID.gv_a);
    expect(theoTen["Phiếu của B"]).toBe(ID.sale_b);
    expect(theoTen["Phiếu của Đào tạo"]).toBe(ID.dao_tao);
  });

  it("[PQ-03] người đề nghị A chỉ thấy phiếu CỦA MÌNH, không thấy phiếu của B hay của Đào tạo", async () => {
    expect(await thay("gv_a")).toEqual(["Phiếu của A"]);
  });

  it("[PQ-04] người đề nghị B cũng chỉ thấy phiếu của mình (không phải 'ai cũng thấy phiếu đầu tiên')", async () => {
    expect(await thay("sale_b")).toEqual(["Phiếu của B"]);
  });

  it("[PQ-05] ĐỐI CHỨNG DƯƠNG: người quản lý thấy MỌI phiếu", async () => {
    expect(await thay("dao_tao")).toEqual(["Phiếu của A", "Phiếu của B", "Phiếu của Đào tạo"]);
  });

  it("[PQ-06] phiếu đã xoá mềm không hiện với ai", async () => {
    await db.trnTrainingNeed.update({ where: { id: MA["Phiếu của B"] }, data: { deletedAt: new Date("2026-10-01T00:00:00Z") } });
    expect(await thay("sale_b")).toEqual([]);
    expect(await thay("dao_tao")).toEqual(["Phiếu của A", "Phiếu của Đào tạo"]);
    await db.trnTrainingNeed.update({ where: { id: MA["Phiếu của B"] }, data: { deletedAt: null } });
  });

  it("[PQ-07] DUYỆT thuộc quyền riêng: người chỉ đề nghị bị PERMISSION_DENIED và phiếu giữ nguyên trạng thái", async () => {
    const actor = await actorCua("gv_a");
    const { res } = await runAction(cauHinhDuyetPhieuNhuCau, actor, { needId: MA["Phiếu của B"] }, { actorName: "gv_a", reason: "thử duyệt trái quyền" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
    const p = await db.trnTrainingNeed.findUniqueOrThrow({ where: { id: MA["Phiếu của B"] }, select: { status: true, approvedByUserId: true } });
    expect(p.status).toBe("NEW");
    expect(p.approvedByUserId).toBeNull();
  });

  it("[PQ-08] không tự duyệt phiếu của chính mình, kể cả người có quyền duyệt (SELF_APPROVAL), phiếu giữ nguyên", async () => {
    const actor = await actorCua("dao_tao");
    const { res } = await runAction(cauHinhDuyetPhieuNhuCau, actor, { needId: MA["Phiếu của Đào tạo"] }, { actorName: "dao_tao", reason: "thử tự duyệt" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("SELF_APPROVAL");
    const p = await db.trnTrainingNeed.findUniqueOrThrow({ where: { id: MA["Phiếu của Đào tạo"] }, select: { status: true } });
    expect(p.status).toBe("NEW");
  });

  it("[PQ-09] ĐỐI CHỨNG DƯƠNG: người có quyền duyệt phiếu của NGƯỜI KHÁC thì duyệt được", async () => {
    const actor = await actorCua("dao_tao");
    const { res } = await runAction(cauHinhDuyetPhieuNhuCau, actor, { needId: MA["Phiếu của A"] }, { actorName: "dao_tao", reason: "Phù hợp kế hoạch quý 4" });
    expect(res.ok).toBe(true);
    const p = await db.trnTrainingNeed.findUniqueOrThrow({ where: { id: MA["Phiếu của A"] }, select: { status: true, approvedByUserId: true } });
    expect(p.status).toBe("APPROVED");
    expect(p.approvedByUserId).toBe(ID.dao_tao);
  });

  it("[PQ-10] sau khi được duyệt, người đề nghị vẫn thấy phiếu của mình (và thấy trạng thái mới)", async () => {
    const actor = await actorCua("gv_a");
    const dong = await scopedDb(actor).trnTrainingNeed.findMany({
      where: dieuKienPhieuXem({ quanLy: false, userId: actor.userId }),
      select: { title: true, status: true },
    });
    expect(dong).toEqual([{ title: "Phiếu của A", status: "APPROVED" }]);
  });
});
