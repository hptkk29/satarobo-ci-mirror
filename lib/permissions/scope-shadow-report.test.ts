// lib/permissions/scope-shadow-report.test.ts — Nền Hệ thống P3 · US-12 (AC2 + AC4).
//
// Trọng tâm test này KHÔNG phải "đếm có đúng không" mà là **cổng có từ chối xanh giả
// không**. Một cổng chỉ kiểm `lech === 0` sẽ báo ĐẠT trên một cửa sổ mà shadow không
// chạy ngày nào — đúng lỗi `inconclusive` mà đối soát OrgUnit đã dính. Ba ca cuối
// file này tồn tại để chặn đúng chuyện đó.
import { describe, it, expect, vi, beforeEach } from "vitest";

const groupBy = vi.fn();
const create = vi.fn();
const queryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    scopeShadowDiff: {
      groupBy: (...a: unknown[]) => groupBy(...a),
      create: (...a: unknown[]) => create(...a),
    },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));

import {
  ghiScopeShadow,
  thongKeScopeShadow,
  congCutoverDat,
} from "@/lib/permissions/scope-shadow-report";
import type { Actor, PermEntry } from "@/lib/auth/actor";

/** Một PermEntry đo bằng đơn vị — đường mà prod đang thật sự enforce. */
const perm = (over: Partial<PermEntry> = {}): PermEntry => ({
  action: "students:view",
  scopeType: "CENTER",
  orgUnitId: "ou-cs1",
  roleCode: "CENTER_MANAGER",
  centerScope: ["c-cs1"],
  orgUnitScope: ["ou-cs1"],
  ...over,
});

const actor = (): Actor =>
  ({
    userId: "u1",
    isSuperAdmin: false,
    roleIds: [],
    groupIds: [],
    permissions: [perm()],
    permissionGrants: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;

const dem = (rows: { ketQua: string; permissionKey: string; n: number }[]) =>
  groupBy.mockResolvedValue(
    rows.map((r) => ({
      ketQua: r.ketQua,
      permissionKey: r.permissionKey,
      _count: { _all: r.n },
    })),
  );

/** N ngày riêng biệt có bản ghi shadow. */
const nhip = (soNgay: number) =>
  queryRaw.mockResolvedValue(
    Array.from({ length: soNgay }, (_, i) => ({ ngay: new Date(2026, 7, i + 1) })),
  );

beforeEach(() => {
  groupBy.mockReset();
  create.mockReset();
  queryRaw.mockReset();
  create.mockResolvedValue({});
});

describe("[US-12][AC3] ghiScopeShadow — quan sát viên, không bao giờ chặn", () => {
  it("ca GIỐNG: mặc định KHÔNG ghi (nhịp lấy mẫu trượt)", async () => {
    await ghiScopeShadow({
      actor: actor(),
      permissionKey: "students:view",
      target: { centerId: "c-cs1", orgUnitId: "ou-cs1" },
      nhipMau: 0.9,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("ca GIỐNG: vẫn ghi khi trúng nhịp lấy mẫu — đây là MẪU CHỨNG shadow có chạy", async () => {
    await ghiScopeShadow({
      actor: actor(),
      permissionKey: "students:view",
      target: { centerId: "c-cs1", orgUnitId: "ou-cs1" },
      nhipMau: 0,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data.ketQua).toBe("GIONG");
  });

  it("ca LỆCH: ghi đủ ngữ cảnh để TÁI HIỆN, không chỉ để đếm", async () => {
    await ghiScopeShadow({
      actor: actor(),
      permissionKey: "students:view",
      target: { centerId: "c-cs1", orgUnitId: "ou-khac" },
    });
    const d = create.mock.calls[0]?.[0].data;
    expect(d.ketQua).toBe("LECH");
    expect(d.cu).toBe(true);
    expect(d.moi).toBe(false);
    expect(d.userId).toBe("u1");
    expect(d.permissionKey).toBe("students:view");
    expect(d.nguon).toBe("perm");
    expect(d.targetCenterId).toBe("c-cs1");
    expect(d.targetOrgUnitId).toBe("ou-khac");
    // luật cứng #3: bảng mới phải mang orgUnitId của dòng dữ liệu.
    expect(d.orgUnitId).toBe("ou-khac");
  });

  it("ca CHƯA PHỦ: ghi riêng nhãn, `moi` để trống vì KHÔNG so được", async () => {
    await ghiScopeShadow({
      actor: actor(),
      permissionKey: "students:view",
      target: { centerId: "c-cs1" },
    });
    const d = create.mock.calls[0]?.[0].data;
    expect(d.ketQua).toBe("CHUA_PHU");
    expect(d.moi).toBeNull();
    expect(d.lyDo).toContain("orgUnitId");
  });

  it("DB lỗi ⇒ nuốt, KHÔNG ném — quan sát viên không được làm hỏng thứ nó quan sát", async () => {
    create.mockRejectedValue(new Error("mất kết nối"));
    await expect(
      ghiScopeShadow({
        actor: actor(),
        permissionKey: "students:view",
        target: { centerId: "c-cs1", orgUnitId: "ou-khac" },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("[US-12][AC4] thongKeScopeShadow", () => {
  it("tách LỆCH và CHƯA PHỦ, và KHÔNG tính mẫu chứng GIỐNG vào cả hai", async () => {
    dem([
      { ketQua: "LECH", permissionKey: "students:view", n: 3 },
      { ketQua: "LECH", permissionKey: "classes:view", n: 2 },
      { ketQua: "CHUA_PHU", permissionKey: "students:view", n: 40 },
      { ketQua: "GIONG", permissionKey: "students:view", n: 900 },
    ]);
    const s = await thongKeScopeShadow();
    expect(s.lech).toBe(5);
    expect(s.chuaPhu).toBe(40);
    expect(s.lechTheoQuyen).toEqual({ "students:view": 3, "classes:view": 2 });
    expect(s.chuaPhuTheoQuyen).toEqual({ "students:view": 40 });
  });
});

describe("[US-13][AC1] congCutoverDat — cổng phải từ chối XANH GIẢ", () => {
  it("đủ 7 ngày có mẫu, 0 lệch, 0 chưa phủ ⇒ ĐẠT", async () => {
    dem([{ ketQua: "GIONG", permissionKey: "students:view", n: 500 }]);
    nhip(7);
    const c = await congCutoverDat();
    expect(c.dat).toBe(true);
    expect(c.lyDo).toEqual([]);
  });

  it("còn lệch ⇒ KHÔNG đạt", async () => {
    dem([
      { ketQua: "LECH", permissionKey: "students:view", n: 1 },
      { ketQua: "GIONG", permissionKey: "students:view", n: 500 },
    ]);
    nhip(7);
    const c = await congCutoverDat();
    expect(c.dat).toBe(false);
    expect(c.lyDo.join(" ")).toContain("lệch");
  });

  it("0 lệch nhưng còn CHƯA PHỦ ⇒ KHÔNG đạt (resolver mới chưa được thử ở đó)", async () => {
    dem([
      { ketQua: "CHUA_PHU", permissionKey: "students:view", n: 12 },
      { ketQua: "GIONG", permissionKey: "students:view", n: 500 },
    ]);
    nhip(7);
    const c = await congCutoverDat();
    expect(c.dat).toBe(false);
    expect(c.lyDo.join(" ")).toContain("CHƯA PHỦ");
  });

  it("BẢNG RỖNG ⇒ KHÔNG đạt. Đây là ca cổng ngây thơ báo ĐẠT sai", async () => {
    dem([]);
    nhip(0);
    const c = await congCutoverDat();
    expect(c.dat).toBe(false);
    expect(c.lech).toBe(0);
    expect(c.chuaPhu).toBe(0);
    expect(c.lyDo.join(" ")).toContain("XANH GIẢ");
  });

  it("sạch nhưng shadow chỉ chạy 3/7 ngày ⇒ KHÔNG đạt (chưa chứng minh LIÊN TỤC)", async () => {
    dem([{ ketQua: "GIONG", permissionKey: "students:view", n: 200 }]);
    nhip(3);
    const c = await congCutoverDat();
    expect(c.dat).toBe(false);
    expect(c.soNgayCoDuLieu).toBe(3);
    expect(c.lyDo.join(" ")).toContain("3/7");
  });
});
