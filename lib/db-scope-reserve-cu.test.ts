// Hồ sơ bảo lưu ĐƯỜNG CŨ (tạo trước khi đường ghi set `centerId`) mang `centerId = NULL`. Từ khi StudentReserve vào
// SCOPED_MODELS (HB-REL-01), `centerId IN (...)` trần làm hồ sơ ấy VÔ HÌNH với Quản lý cơ sở — đo prod 18/10/2026:
// 2 dòng, status ACTIVE, học viên có cơ sở. Luật: NULL ⇒ suy theo cơ sở của HỌC VIÊN; học viên cũng không có cơ sở
// thì vẫn fail-closed (chỉ tầm nhìn ALL thấy). `centerId` đã có thì LUÔN thắng cột của học viên.
import { describe, expect, it } from "vitest";
import { buildActor } from "@/lib/auth/actor";
import { CENTER_VIA_STUDENT_MODELS, injectScope, passesScope } from "@/lib/db-scope";
import type { OrgUnitNode } from "@/lib/org/types";

const ORG: OrgUnitNode[] = [
  { id: "root", code: "SATAROBO", type: "ROOT", parentId: null, centerId: null },
  { id: "ho", code: "HO", type: "HO", parentId: "root", centerId: null },
  { id: "cs1", code: "CS1", type: "CENTER", parentId: "root", centerId: "c1" },
  { id: "cs2", code: "CS2", type: "CENTER", parentId: "root", centerId: "c2" },
];
const row = (orgUnitId: string, code: string) => ({
  orgUnitId, status: "ACTIVE", effectiveFrom: new Date("2000-01-01"), effectiveTo: null,
  role: { code, isActive: true, permissions: [] as { action: string; scopeType: "GLOBAL" }[] },
});
const make = (r: ReturnType<typeof row>[]) => buildActor({ userId: "u1", rows: r, orgNodes: ORG });
const coSo1 = make([row("cs1", "CENTER_MANAGER")]); // visible [c1]
const hoiSo = make([row("ho", "HO_ACCOUNTANT")]); // isHoLevel

describe("[RSV-NULL] hồ sơ bảo lưu centerId NULL ⇒ theo cơ sở của học viên", () => {
  it("[RSV-NULL-01] chỉ StudentReserve được suy theo học viên (StudentReserveEvent và model khác KHÔNG)", () => {
    expect([...CENTER_VIA_STUDENT_MODELS]).toEqual(["StudentReserve"]);
    expect(injectScope("StudentReserveEvent", {}, coSo1)).toEqual({ where: { centerId: { in: ["c1"] } } });
    expect(injectScope("Lead", {}, coSo1)).toEqual({ where: { centerId: { in: ["c1"] } } });
  });

  it("[RSV-NULL-02] injectScope: centerId IN HOẶC (centerId NULL VÀ học viên IN) — giữ where cũ qua AND", () => {
    const phamVi = { OR: [{ centerId: { in: ["c1"] } }, { centerId: null, student: { centerId: { in: ["c1"] } } }] };
    expect(injectScope("StudentReserve", {}, coSo1)).toEqual({ where: phamVi });
    expect(injectScope("StudentReserve", { where: { status: "ACTIVE" } }, coSo1)).toEqual({
      where: { AND: [{ status: "ACTIVE" }, phamVi] },
    });
  });

  it("[RSV-NULL-03] tầm nhìn ALL (Hội sở) không bị chèn gì", () => {
    expect(injectScope("StudentReserve", { where: { id: "x" } }, hoiSo)).toEqual({ where: { id: "x" } });
  });

  it("[RSV-NULL-04] passesScope: NULL + học viên cùng cơ sở ⇒ qua; học viên cơ sở khác / không cơ sở / không biết ⇒ CHẶN", () => {
    expect(passesScope("StudentReserve", { centerId: null, student: { centerId: "c1" } }, coSo1)).toBe(true);
    expect(passesScope("StudentReserve", { centerId: null, student: { centerId: "c2" } }, coSo1)).toBe(false);
    expect(passesScope("StudentReserve", { centerId: null, student: { centerId: null } }, coSo1)).toBe(false);
    expect(passesScope("StudentReserve", { centerId: null, student: null }, coSo1)).toBe(false);
    expect(passesScope("StudentReserve", { centerId: null }, coSo1)).toBe(false);
  });

  it("[RSV-NULL-05] centerId ĐÃ CÓ thì thắng cột của học viên (không mở lối ngược)", () => {
    expect(passesScope("StudentReserve", { centerId: "c2", student: { centerId: "c1" } }, coSo1)).toBe(false);
    expect(passesScope("StudentReserve", { centerId: "c1", student: { centerId: "c2" } }, coSo1)).toBe(true);
  });

  it("[RSV-NULL-06] model khác KHÔNG hưởng lối suy này: Lead centerId NULL + student.centerId bất kỳ vẫn chặn", () => {
    expect(passesScope("Lead", { centerId: null, student: { centerId: "c1" } } as never, coSo1)).toBe(false);
  });

  it("[RSV-NULL-07] Hội sở: NULL vẫn qua (như mọi model)", () => {
    expect(passesScope("StudentReserve", { centerId: null }, hoiSo)).toBe(true);
  });
});
