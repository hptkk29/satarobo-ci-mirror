// @vitest-environment node
/**
 * `reconcileUserOrgRoles` — DỌN DÒNG VAI ĐẶT SAI ĐƠN VỊ (`revokeMisplaced`).
 *
 * ─── Lỗ hổng, đo được trên prod 22/08/2026 ───────────────────────────────────
 * Vòng thu hồi cũ duyệt `previous`, tức duyệt thứ NGƯỜI GỌI TIN LÀ đang có. Nếu
 * dòng thật nằm ở đơn vị khác với thứ `previous` nói, nó không bao giờ được dọn.
 * Hậu quả đo được: một tài khoản có `User.orgUnitId = CS2` nhưng vẫn giữ dòng
 * vai neo tại Hội sở ⇒ vẫn `isHoLevel` ⇒ vẫn thấy MỌI cơ sở, và lưu lại hồ sơ
 * bao nhiêu lần cũng không gỡ được.
 *
 * ─── Vì sao cờ này mặc định TẮT ──────────────────────────────────────────────
 * Ở đường đổi vai trò và đường gán tay, một người CÓ THỂ giữ cùng một vai ở nhiều
 * đơn vị một cách hợp lệ (giáo viên dạy chéo cơ sở). Dọn ở đó là thu hồi nhầm
 * quyền của người đang dùng. Cờ chỉ bật ở đường đồng bộ đơn vị từ HỒ SƠ NHÂN SỰ,
 * nơi hồ sơ LÀ nguồn sự thật về "người này làm ở đâu".
 *
 * Case quan trọng nhất trong file này là case CUỐI: vai gán tay KHÔNG bị đụng.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/audit/log", () => ({ logRbacAudit: vi.fn(async () => undefined) }));

import { reconcileUserOrgRoles } from "./org-role-sync";

const HO = "ou-ho";
const CS1 = "ou-cs1";
const CS2 = "ou-cs2";

/** roleId giả, ổn định theo code để test đọc được. */
const rid = (code: string) => `role-${code}`;

type Dong = { orgUnitId: string; roleId: string };

function fakeTx(existing: Dong[]) {
  const updates: Array<{ orgUnitId: string; roleId: string; data: unknown }> = [];
  const upserts: Array<{ orgUnitId: string; roleId: string }> = [];
  const now = new Date();
  const tx = {
    orgUnit: {
      findMany: vi.fn(async () => [
        { id: HO, type: "HO" },
        { id: CS1, type: "CENTER" },
        { id: CS2, type: "CENTER" },
      ]),
    },
    roleDef: {
      // Trả RoleDef cho MỌI code được hỏi — test không quan tâm danh mục thật.
      findMany: vi.fn(async (args: { where: { code: { in: string[] } } }) =>
        args.where.code.in.map((code) => ({ id: rid(code), code, isActive: true })),
      ),
    },
    userOrgRole: {
      findMany: vi.fn(async () =>
        existing.map((r) => ({
          ...r,
          status: "ACTIVE",
          effectiveFrom: new Date(now.getTime() - 1000),
          effectiveTo: null,
        })),
      ),
      upsert: vi.fn(async (a: { where: { userId_orgUnitId_roleId: Dong } }) => {
        upserts.push({
          orgUnitId: a.where.userId_orgUnitId_roleId.orgUnitId,
          roleId: a.where.userId_orgUnitId_roleId.roleId,
        });
        return {};
      }),
      update: vi.fn(
        async (a: { where: { userId_orgUnitId_roleId: Dong }; data: unknown }) => {
          updates.push({
            orgUnitId: a.where.userId_orgUnitId_roleId.orgUnitId,
            roleId: a.where.userId_orgUnitId_roleId.roleId,
            data: a.data,
          });
          return {};
        },
      ),
    },
  } as never;
  return { tx, updates, upserts };
}

const NEN = {
  userId: "u1",
  actorId: "admin1",
  actorName: "Admin",
  reason: "test",
};

beforeEach(() => vi.clearAllMocks());

describe("dòng vai kẹt sai đơn vị", () => {
  /** Giáo viên: hồ sơ nói CS1, nhưng dòng vai đang neo tại Hội sở. */
  const KET_O_HO = [{ orgUnitId: HO, roleId: rid("TEACHER") }];

  it("KHÔNG bật cờ ⇒ dòng kẹt ở HO vẫn nguyên (giữ hành vi cũ)", async () => {
    const { tx, updates } = fakeTx(KET_O_HO);
    await reconcileUserOrgRoles({
      ...NEN,
      tx,
      previous: { roles: ["TEACHER"], orgUnitId: CS1 },
      next: { roles: ["TEACHER"], orgUnitId: CS1 },
    });
    // `previous` nói vai ở CS1, mà DB không có dòng CS1 nào ⇒ vòng cũ không thấy
    // gì để thu hồi. Dòng ở HO nằm ngoài tầm với — đúng lỗ hổng đang vá.
    expect(updates).toEqual([]);
  });

  it("BẬT cờ ⇒ thu hồi dòng ở HO và cấp lại ở CS1", async () => {
    const { tx, updates, upserts } = fakeTx(KET_O_HO);
    const kq = await reconcileUserOrgRoles({
      ...NEN,
      tx,
      previous: { roles: ["TEACHER"], orgUnitId: CS1 },
      next: { roles: ["TEACHER"], orgUnitId: CS1 },
      revokeMisplaced: true,
    });
    expect(upserts.map((u) => u.orgUnitId)).toContain(CS1);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.orgUnitId).toBe(HO);
    expect(updates[0]?.data).toMatchObject({ status: "EXPIRED" });
    expect(kq.revoked.length).toBeGreaterThan(0);
  });

  it("dòng ĐÃ ở đúng đơn vị ⇒ không đụng, không sinh nhịp thu-hồi-rồi-cấp-lại", async () => {
    const { tx, updates, upserts } = fakeTx([
      { orgUnitId: CS1, roleId: rid("TEACHER") },
    ]);
    await reconcileUserOrgRoles({
      ...NEN,
      tx,
      previous: { roles: ["TEACHER"], orgUnitId: CS1 },
      next: { roles: ["TEACHER"], orgUnitId: CS1 },
      revokeMisplaced: true,
    });
    expect(updates).toEqual([]);
    expect(upserts).toEqual([]);
  });
});

describe("ranh giới an toàn — vai gán tay không bao giờ bị đụng", () => {
  it("vai NGOÀI bảng ánh xạ lần này vẫn nguyên, kể cả khi bật cờ", async () => {
    // Đây là case đắt nhất của cả file. `ASSISTANT_TEACHER` và `HO_SALE` là vai
    // người ta gán TAY ở /admin/users/[id]/org-roles. Nếu vòng dọn duyệt theo
    // "mọi dòng đang hiệu lực" thay vì "vai mà bảng ánh xạ vừa sinh ra", nó sẽ
    // thu hồi sạch quyền của người đang dùng — im lặng, và chỉ lộ khi họ mất
    // quyền giữa ca làm.
    const { tx, updates } = fakeTx([
      { orgUnitId: HO, roleId: rid("ASSISTANT_TEACHER") },
      { orgUnitId: CS2, roleId: rid("HO_SALE") },
    ]);
    await reconcileUserOrgRoles({
      ...NEN,
      tx,
      previous: { roles: ["TEACHER"], orgUnitId: CS1 },
      next: { roles: ["TEACHER"], orgUnitId: CS1 },
      revokeMisplaced: true,
    });
    expect(updates).toEqual([]);
  });

  it("chỉ dọn ĐÚNG vai bị lệch, các vai khác của cùng người vẫn nguyên", async () => {
    const { tx, updates } = fakeTx([
      { orgUnitId: HO, roleId: rid("TEACHER") }, // lệch → dọn
      { orgUnitId: HO, roleId: rid("ASSISTANT_TEACHER") }, // gán tay → giữ
    ]);
    await reconcileUserOrgRoles({
      ...NEN,
      tx,
      previous: { roles: ["TEACHER"], orgUnitId: CS1 },
      next: { roles: ["TEACHER"], orgUnitId: CS1 },
      revokeMisplaced: true,
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.roleId).toBe(rid("TEACHER"));
  });
});

describe("đường đồng bộ đơn vị từ hồ sơ nhân sự BẬT cờ, ba đường kia thì không", () => {
  it("chỉ lib/hr/sync-employee-unit.ts truyền revokeMisplaced", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const ROOT = process.cwd();
    const BAT = "lib/hr/sync-employee-unit.ts";
    const KHONG = [
      "app/(admin)/admin/nhan-su/actions.ts",
      "app/(admin)/admin/teachers/_actions.ts",
      "app/(admin)/admin/users/_actions.ts",
    ];
    expect(readFileSync(join(ROOT, BAT), "utf8")).toContain("revokeMisplaced: true");
    for (const f of KHONG) {
      // Ở ba đường này một người CÓ THỂ giữ cùng vai ở nhiều đơn vị hợp lệ
      // (dạy chéo cơ sở). Bật cờ ở đó là thu hồi nhầm quyền người đang dùng.
      expect(readFileSync(join(ROOT, f), "utf8"), f).not.toContain(
        "revokeMisplaced",
      );
    }
  });
});
