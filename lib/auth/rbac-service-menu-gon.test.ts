// Ca [MG-SV-*] — `setRoleAnMenu` (menu gọn theo vai, 28/09/2026): cùng cổng như sửa quyền vai —
// chỉ người có `roles:manage`, lý do bắt buộc, đường dẫn phải là đường nội bộ, ghi + nhật ký trong
// MỘT transaction. DB và nhật ký giả lập; thứ đo là CỔNG của hàm, không phải Postgres.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const tx = { roleDef: { update: vi.fn(async () => ({})) } };
  return {
    tx,
    findUnique: vi.fn(),
    audit: vi.fn(async () => undefined),
    transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
});

vi.mock("@/lib/db", () => ({
  db: { roleDef: { findUnique: h.findUnique }, $transaction: h.transaction },
}));
vi.mock("@/lib/audit/log", () => ({ logRbacAudit: h.audit }));
vi.mock("@/lib/chat/sync-membership", () => ({ syncCenterClassConversations: vi.fn() }));

import { RbacError, setRoleAnMenu } from "./rbac-service";

const QTTC = { id: "u1", name: "Kiệt", role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] };
const KE_TOAN = { id: "u2", name: "Kế toán", role: "ACCOUNTANT", roles: ["ACCOUNTANT"] };

beforeEach(() => {
  vi.clearAllMocks();
  h.findUnique.mockResolvedValue({ id: "r1", anMenu: ["/lich"] });
});

describe("[MG-SV-01] cổng", () => {
  it("thiếu roles:manage ⇒ FORBIDDEN, không đọc, không ghi", async () => {
    await expect(setRoleAnMenu(KE_TOAN, "r1", { anMenu: ["/students"], reason: "gọn menu" })).rejects.toMatchObject({
      name: "RbacError",
      code: "FORBIDDEN",
    });
    expect(h.findUnique).not.toHaveBeenCalled();
    expect(h.tx.roleDef.update).not.toHaveBeenCalled();
  });

  it("thiếu lý do / đường dẫn lạ ⇒ từ chối, không ghi", async () => {
    await expect(setRoleAnMenu(QTTC, "r1", { anMenu: ["/students"] })).rejects.toBeTruthy();
    await expect(setRoleAnMenu(QTTC, "r1", { anMenu: ["https://evil.example/x"], reason: "gọn menu" })).rejects.toBeTruthy();
    await expect(setRoleAnMenu(QTTC, "r1", { anMenu: ["students"], reason: "gọn menu" })).rejects.toBeTruthy();
    expect(h.tx.roleDef.update).not.toHaveBeenCalled();
  });

  it("vai không tồn tại ⇒ ROLE_NOT_FOUND, không ghi", async () => {
    h.findUnique.mockResolvedValue(null);
    await expect(setRoleAnMenu(QTTC, "rX", { anMenu: [], reason: "gọn menu" })).rejects.toBeInstanceOf(RbacError);
    expect(h.tx.roleDef.update).not.toHaveBeenCalled();
  });
});

describe("[MG-SV-02] đường vui", () => {
  it("ghi danh sách đã bỏ trùng + sắp xếp, nhật ký cũ→mới trong CÙNG transaction", async () => {
    await setRoleAnMenu(QTTC, "r1", { anMenu: ["/students", "/classes", "/students"], reason: "gọn menu kế toán" });
    expect(h.tx.roleDef.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { anMenu: ["/classes", "/students"] } });
    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "ROLE",
        entityId: "r1",
        reason: "gọn menu kế toán",
        oldValues: { anMenu: ["/lich"] },
        newValues: { anMenu: ["/classes", "/students"] },
        tx: h.tx,
      }),
    );
  });
});
