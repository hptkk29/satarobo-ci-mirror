// Chính sách vai HO_SALE với lead — chủ dự án chốt 23/08/2026.
//
// ĐẢO Doc 15 §2 ("Sale Hội sở xem toàn hệ thống nhưng KHÔNG sửa"). Luật mới:
//   · nhập được phiếu;
//   · phiếu VẪN tự chia về Sale cơ sở đã chọn (chốt 04/08 "lead không bao giờ
//     về Hội sở" GIỮ NGUYÊN);
//   · chỉ THẤY phiếu do chính mình nhập — không thấy phiếu người khác nhập;
//   · chỉ SỬA các ô có trong biểu mẫu `/nhap-khach-hang`; Sale cơ sở toàn quyền.
//
// Bộ test này khoá đúng bốn mệnh đề đó ở tầng ma trận quyền (thuần, không DB),
// vì chúng dễ trôi âm thầm: quyền nằm trong seed, và một dòng `leads:view-all`
// thêm vào là thủng luật "không thấy phiếu người khác" mà không test nào đỏ.
import { describe, it, expect } from "vitest";
import { buildActor, type UserOrgRoleRow } from "@/lib/auth/actor";
import type { OrgUnitNode } from "@/lib/org/types";
import { can } from "@/lib/auth/can";
import { ROLE_SEED } from "@/prisma/seed-roles";

const ORG: OrgUnitNode[] = [
  { id: "ho", code: "HO", type: "HO", parentId: null, centerId: null },
  { id: "cs1", code: "CS1", type: "CENTER", parentId: "ho", centerId: "c1" },
];

const seedOf = (code: string) => {
  const s = ROLE_SEED.find((r) => r.code === code);
  if (!s) throw new Error(`Không thấy RoleDef "${code}" trong seed-roles.ts`);
  return s;
};

/** Actor dựng từ CHÍNH bộ quyền trong seed — test đi cùng nguồn sự thật. */
function actorFromSeed(code: string, orgUnitId: string, userId = "u-ho-sale") {
  const row: UserOrgRoleRow = {
    orgUnitId,
    status: "ACTIVE",
    effectiveFrom: new Date("2000-01-01"),
    effectiveTo: null,
    role: {
      code,
      isActive: true,
      permissions: seedOf(code).perms.map((p) => ({
        action: p.action,
        scopeType: p.scopeType,
      })),
    },
  };
  return buildActor({
    userId,
    rows: [row],
    orgNodes: ORG,
    now: new Date("2026-08-23"),
  });
}

describe("HO_SALE — nhập được, nhưng chỉ phần của mình", () => {
  const me = "u-ho-sale";
  const nguoiKhac = "u-khac";

  it("nhập phiếu được", () => {
    expect(can(actorFromSeed("HO_SALE", "ho"), "leads:create")).toBe(true);
  });

  it("🔴 KHÔNG có leads:view-all — nếu có thì thấy hết phiếu người khác", () => {
    // v2 là ALLOW-wins, KHÔNG có DENY để bù. Thêm lại `leads:view-all` cho vai
    // này là vô hiệu hoá toàn bộ luật "chỉ thấy phiếu mình nhập", vì trang
    // danh sách bỏ hẳn mệnh đề lọc khi actor có view-all.
    expect(can(actorFromSeed("HO_SALE", "ho"), "leads:view-all")).toBe(false);
  });

  it("view-own phải khai GLOBAL — nó bị gọi TRẦN ở trang danh sách", () => {
    // Luật R1 (đầu seed-roles.ts): scope OWN + gọi không kèm target = luôn false
    // ⇒ người ta bị đá khỏi /leads. Giới hạn thật nằm ở mệnh đề lọc truy vấn.
    const a = actorFromSeed("HO_SALE", "ho");
    expect(can(a, "leads:view-own")).toBe(true);
    expect(seedOf("HO_SALE").perms.find((p) => p.action === "leads:view-own")?.scopeType).toBe(
      "GLOBAL",
    );
  });

  it("🔴 KHÔNG có leads:edit — quyền đó mở luôn ~10 action khác", () => {
    // `leads:edit` đang gác đổi trạng thái, giao việc, chuyển cơ sở, thêm/sửa
    // con, ghi chú, bàn giao. Cấp cho vai này là phá vỡ "chỉ sửa ô của biểu mẫu".
    expect(can(actorFromSeed("HO_SALE", "ho"), "leads:edit")).toBe(false);
  });

  it("sửa được phiếu MÌNH nhập, KHÔNG sửa được phiếu người khác nhập", () => {
    const a = actorFromSeed("HO_SALE", "ho");
    expect(can(a, "leads:edit-own-intake", { createdById: me })).toBe(true);
    expect(can(a, "leads:edit-own-intake", { createdById: nguoiKhac })).toBe(false);
    // Phiếu cũ (createdById NULL) không ai nhận là của mình — fail-closed.
    expect(can(a, "leads:edit-own-intake", {})).toBe(false);
  });

  it("KHÔNG được giao lead / xoá lead / chốt đơn hộ Sale cơ sở", () => {
    const a = actorFromSeed("HO_SALE", "ho");
    for (const act of ["leads:assign", "leads:delete", "leads:export", "leads:import"]) {
      expect(can(a, act)).toBe(false);
    }
  });
});

describe("Sale cơ sở — KHÔNG bị đợt này siết", () => {
  it("giữ nguyên leads:edit (toàn quyền sửa)", () => {
    const a = actorFromSeed("CENTER_SALES_CSM", "cs1", "u-sale-cs1");
    expect(can(a, "leads:edit")).toBe(true);
    expect(can(a, "leads:create")).toBe(true);
  });
});
