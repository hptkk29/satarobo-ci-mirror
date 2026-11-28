// lib/chat/sync-membership.test.ts — US-03 unit (thuần, không DB):
// computeDerivedMembership — bẫy BA mục 5 + BR-11/BR-14.
import { describe, expect, it } from "vitest";
import {
  CHAT_CENTER_MANAGER_ROLE_CODES,
  computeDerivedMembership,
  type ClassMembershipSnapshot,
} from "./sync-membership";
import { ROLE_SEED } from "../../prisma/seed-roles";

function snap(partial: Partial<ClassMembershipSnapshot>): ClassMembershipSnapshot {
  return { teacherIds: [], students: [], centerManagerIds: [], ...partial };
}

function byUser(list: ReturnType<typeof computeDerivedMembership>) {
  return new Map(list.map((p) => [p.userId, p]));
}

describe("computeDerivedMembership (US-03)", () => {
  it("[TS-06] PH có 2 con cùng lớp → đúng MỘT entry (bẫy BA: tập học viên)", () => {
    const out = computeDerivedMembership(
      snap({
        students: [
          { id: "hs1", parentIds: ["ph1"] },
          { id: "hs2", parentIds: ["ph1"] },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      userId: "ph1",
      role: "MEMBER",
      derivedFrom: "CLASS_STUDENT_PARENT",
    });
  });

  it("[BR-14] học viên có 2 PH (bố + mẹ) → 2 entry riêng biệt, đều MEMBER", () => {
    const out = computeDerivedMembership(
      snap({ students: [{ id: "hs1", parentIds: ["bo", "me"] }] }),
    );
    expect(out).toHaveLength(2);
    const m = byUser(out);
    for (const id of ["bo", "me"]) {
      expect(m.get(id)).toEqual({
        userId: id,
        role: "MEMBER",
        derivedFrom: "CLASS_STUDENT_PARENT",
      });
    }
  });

  it("[BR-11a] GV chính + trợ giảng → cả hai MODERATOR/CLASS_TEACHER", () => {
    const out = computeDerivedMembership(
      snap({ teacherIds: ["gv1", "ta1"] }),
    );
    const m = byUser(out);
    expect(out).toHaveLength(2);
    expect(m.get("gv1")).toEqual({
      userId: "gv1",
      role: "MODERATOR",
      derivedFrom: "CLASS_TEACHER",
    });
    expect(m.get("ta1")).toEqual({
      userId: "ta1",
      role: "MODERATOR",
      derivedFrom: "CLASS_TEACHER",
    });
  });

  it("teacherIds có null/undefined (lớp chưa gán trợ giảng) → tự bỏ", () => {
    const out = computeDerivedMembership(
      snap({ teacherIds: ["gv1", null, undefined] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.userId).toBe("gv1");
  });

  it("[US-03 AC1] QLCS → MEMBER/CENTER_MANAGER (chốt 07/08: MEMBER, không OBSERVER)", () => {
    const out = computeDerivedMembership(snap({ centerManagerIds: ["ql1"] }));
    expect(out).toEqual([
      { userId: "ql1", role: "MEMBER", derivedFrom: "CENTER_MANAGER" },
    ]);
  });

  it("lớp không học viên → chỉ GV + QLCS", () => {
    const out = computeDerivedMembership(
      snap({ teacherIds: ["gv1"], centerManagerIds: ["ql1"] }),
    );
    expect(out).toHaveLength(2);
    const m = byUser(out);
    expect(m.get("gv1")!.role).toBe("MODERATOR");
    expect(m.get("ql1")!.role).toBe("MEMBER");
  });

  it("snapshot rỗng hoàn toàn → []", () => {
    expect(computeDerivedMembership(snap({}))).toEqual([]);
  });

  it("ưu tiên tư cách: GV kiêm PH → MODERATOR/CLASS_TEACHER, vẫn 1 entry", () => {
    const out = computeDerivedMembership(
      snap({
        teacherIds: ["u1"],
        students: [{ id: "hs1", parentIds: ["u1"] }],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      userId: "u1",
      role: "MODERATOR",
      derivedFrom: "CLASS_TEACHER",
    });
  });

  it("ưu tiên tư cách: PH kiêm QLCS → giữ CLASS_STUDENT_PARENT (sát lớp học nhất)", () => {
    const out = computeDerivedMembership(
      snap({
        students: [{ id: "hs1", parentIds: ["u2"] }],
        centerManagerIds: ["u2"],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.derivedFrom).toBe("CLASS_STUDENT_PARENT");
    expect(out[0]!.role).toBe("MEMBER");
  });

  it("[chốt 09/08] Giáo vụ trong snapshot → participant MEMBER/CENTER_MANAGER, y hệt QLCS", () => {
    // `centerManagerIds` là tập HỢP NHẤT (QLCS ∪ Giáo vụ) do resolveCenterManagerUserIds
    // dựng — Giáo vụ dùng CHUNG nhãn CENTER_MANAGER vì `DerivedFrom` là enum DB
    // (thêm giá trị = phải migration) và hai vai có cùng tư cách trong nhóm.
    const out = computeDerivedMembership(
      snap({ teacherIds: ["gv1"], centerManagerIds: ["ql1", "giaovu1"] }),
    );
    const m = byUser(out);
    expect(m.get("giaovu1")).toEqual({
      userId: "giaovu1",
      role: "MEMBER",
      derivedFrom: "CENTER_MANAGER",
    });
    expect(m.get("giaovu1")).toEqual({ ...m.get("ql1")!, userId: "giaovu1" });
    expect(out).toHaveLength(3);
  });

  it("hàm thuần + xác định: cùng input gọi 2 lần → cùng output (nền cho AC6)", () => {
    const input = snap({
      teacherIds: ["gv1"],
      students: [
        { id: "hs1", parentIds: ["ph1", "ph2"] },
        { id: "hs2", parentIds: ["ph1"] },
      ],
      centerManagerIds: ["ql1"],
    });
    const a = computeDerivedMembership(input);
    const b = computeDerivedMembership(input);
    expect(a).toEqual(b);
    expect(a).toHaveLength(4); // gv1, ph1 (1 entry cho 2 con), ph2, ql1
  });
});

/**
 * NGUỒN "quản lý cơ sở" ở nhánh v2 của `resolveCenterManagerUserIds`.
 *
 * Phần DB không unit-test được (cần Postgres — vế đó ở scripts/_zztest-chat-backfill.ts),
 * nhưng DANH SÁCH RoleDef thì thuần và là chỗ dễ tụt nhất: gỡ `CENTER_CLASS_MANAGER` khỏi
 * đây là Giáo vụ lặng lẽ biến mất khỏi mọi nhóm lớp trong lần sync kế tiếp (participant
 * bị set leftAt + không có lỗi nào nổi lên), trong khi 3 perm chat:* của vai vẫn còn
 * nguyên ⇒ họ mở /tin-nhan ra thấy trắng. Test này chặn đúng cú đó.
 */
describe("CHAT_CENTER_MANAGER_ROLE_CODES — nguồn QLCS (v2) của nhóm lớp", () => {
  it("[chốt 09/08] gồm ĐÚNG CENTER_MANAGER + CENTER_CLASS_MANAGER (Giáo vụ)", () => {
    expect([...CHAT_CENTER_MANAGER_ROLE_CODES].sort()).toEqual([
      "CENTER_CLASS_MANAGER",
      "CENTER_MANAGER",
    ]);
  });

  it("mọi code trong danh sách phải TỒN TẠI trong ROLE_SEED (chống gõ sai → lọc rỗng im lặng)", () => {
    // Sai chính tả không làm query nổ, chỉ trả 0 dòng — vai đó rơi khỏi nhóm không dấu vết.
    for (const code of CHAT_CENTER_MANAGER_ROLE_CODES) {
      expect(
        ROLE_SEED.find((r) => r.code === code),
        `ROLE_SEED không có RoleDef "${code}"`,
      ).toBeDefined();
    }
  });

  it("mọi code trong danh sách phải giữ ĐỦ bộ chat:read/send/announce (membership không kèm quyền = vô nghĩa)", () => {
    for (const code of CHAT_CENTER_MANAGER_ROLE_CODES) {
      const perms = ROLE_SEED.find((r) => r.code === code)!.perms;
      const chat = perms
        .filter((p) => p.action.startsWith("chat:"))
        .map((p) => `${p.action}=${p.scopeType}`)
        .sort();
      expect(chat, `RoleDef ${code}`).toEqual([
        "chat:announce=CENTER",
        "chat:read=CENTER",
        "chat:send=CENTER",
      ]);
    }
  });
});
