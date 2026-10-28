// [HN2-MP-L01..] — LOADER của mục "Máy POS quẹt thẻ" (`docMucMayPos`): cổng HAI lớp + "không quyền ⇒ không đọc gì".
// docs/pos-hai-nut-khai-may.md §2.3. Dùng `Actor` THẬT (literal) + `passesScope` / `getModelVisibleCenterIds` THẬT; chỉ `sdb` và
// `docSucKhoeAgent` là giả — nên ca nào đỏ là đỏ vì LUẬT, không vì giả lập.
//
// Mẫu bẫy cần canh (khuôn [PTTT-11]): `payments:view` seed GLOBAL ⇒ `can()` vứt đích ⇒ Quản lý cơ sở của CS1 có quyền = true khi
// mở trang CS2. Cách ly thật là `passesScope("PosTerminal", …)`. Ca `[HN2-MP-L03]` mô phỏng đúng tình huống đó: `coQuyenXem = true`
// (đúng như `checkPermission` trả về) mà loader PHẢI trả `null` và KHÔNG chạm DB.
//
// Luật 19: `now` truyền vào, không đọc đồng hồ thật.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, PermEntry } from "@/lib/auth/actor";
import type { TheAgent } from "./agent/suc-khoe-doc";

const h = vi.hoisted(() => ({
  docSucKhoeAgent: vi.fn(),
}));
vi.mock("./agent/suc-khoe-doc", () => ({ docSucKhoeAgent: h.docSucKhoeAgent }));

import { docMucMayPos } from "./may-o-co-so-doc";

const NOW = new Date("2026-10-09T05:00:00Z");

const perm = (action: string, centerScope: "ALL" | string[]): PermEntry => ({
  action,
  scopeType: "GLOBAL",
  orgUnitId: centerScope === "ALL" ? "org-ho" : "org-cs1",
  roleCode: centerScope === "ALL" ? "HO_ACCOUNTANT" : "CENTER_MANAGER",
  centerScope,
});

function actor(p: Partial<Actor>): Actor {
  return {
    userId: "u",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set(),
    assignedClassIds: new Set(),
    ...p,
  };
}

/** Kế toán HO: `payments:*` neo tại HO ⇒ ALL. */
const KE_TOAN_HO = actor({
  isHoLevel: true,
  permissions: [perm("payments:view", "ALL"), perm("payments:import-pos", "ALL")],
});
/** Quản lý cơ sở CS1: `payments:view` (seed GLOBAL nhưng centerScope = [cs1]). */
const QLCS_CS1 = actor({
  visibleCenterIds: ["cs1"],
  permissions: [perm("payments:view", ["cs1"])],
});

const CS1 = { id: "cs1", name: "CS1 - 211 Nguyễn Hữu Thọ", isActive: true };
const CS2 = { id: "cs2", name: "CS2 - 114 Hoàng Diệu", isActive: true };

const HANG_MAY = {
  id: "m1",
  maThietBi: "SP_GINI_X990_V9E1013321",
  maQuay: "QTT45XWQT",
  ten: "Máy quầy lễ tân",
  maCuaHang: "CH9TSGU9",
  maNhaCungCap: "NCCPH6KE",
  maTcbQuay: null,
  active: true,
  createdAt: new Date("2026-10-05T03:00:00Z"),
};

function sdbGia(rows: unknown[] = [HANG_MAY]) {
  const findMany = vi.fn(async (_a: unknown) => rows);
  return { sdb: { posTerminal: { findMany } } as never, findMany };
}

const AGENT: TheAgent = {
  id: "ag1",
  centerId: "cs1",
  coSo: "CS1",
  tenCoSo: CS1.name,
  merchantCode: "NCCPH6KE",
  active: true,
  ketNoi: "TRUC_TUYEN",
  lastHeartbeatAt: new Date(NOW.getTime() - 30_000),
  matKetNoiTuLuc: null,
  sessionState: "READY",
  sessionDoiLuc: null,
  sessionExpiresAt: new Date("2026-10-09T14:30:00Z"),
  lastSyncedAt: new Date(NOW.getTime() - 60_000),
  duLieuDenLuc: null,
  extensionVersion: null,
  profileName: null,
  loiGanNhat: null,
  loiGanNhatLuc: null,
  secretVersion: 1,
  secretDoiLuc: null,
  jobCho: 0,
  songPhien: { soPhien: 0, tbMs: null },
  mayKhaiDu: true,
};

// Luật 18 — mỗi ca XANH khi chạy một mình.
beforeEach(() => {
  h.docSucKhoeAgent.mockReset();
  h.docSucKhoeAgent.mockResolvedValue({ agents: [AGENT], suKien: [] });
});

describe("[HN2-MP-L01] Kế toán HO (nhìn mọi cơ sở, có import-pos): thấy máy của ĐÚNG cơ sở đang mở, sửa được", () => {
  it("đọc máy theo `centerId` của trang, trả view đủ trường + quyền sửa/thêm", async () => {
    const { sdb, findMany } = sdbGia();
    const v = await docMucMayPos({ sdb, actor: KE_TOAN_HO, coSo: CS1, coQuyenXem: true, coQuyenGhi: true, now: NOW });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { centerId: "cs1" } });
    expect(v).not.toBeNull();
    expect(v!.coSo).toEqual({ id: "cs1", ten: CS1.name, dangHoatDong: true });
    expect(v!.quyen).toEqual({ xem: true, sua: true, them: true, lyDoKhongThem: null });
    expect(v!.may).toHaveLength(1);
    expect(v!.may[0]).toMatchObject({
      id: "m1",
      maThietBi: "SP_GINI_X990_V9E1013321",
      maQuay: "QTT45XWQT",
      ten: "Máy quầy lễ tân",
      maCuaHang: "CH9TSGU9",
      maNhaCungCap: "NCCPH6KE",
      maTcbQuay: null,
      active: true,
      taoLuc: "2026-10-05T03:00:00.000Z",
    });
  });

  it("đối chứng dương cho ca CS2: cùng người mở trang CS2 cũng thấy (Kế toán HO nhìn mọi cơ sở)", async () => {
    const { sdb, findMany } = sdbGia([]);
    const v = await docMucMayPos({ sdb, actor: KE_TOAN_HO, coSo: CS2, coQuyenXem: true, coQuyenGhi: true, now: NOW });
    expect(v).not.toBeNull();
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { centerId: "cs2" } });
  });
});

describe("[HN2-MP-L02] Quản lý cơ sở ở CƠ SỞ CỦA MÌNH: thấy máy, KHÔNG sửa, KHÔNG đọc agent", () => {
  it("quyền sửa/thêm = false; không gọi `docSucKhoeAgent` (không có import-pos); dòng agent = null", async () => {
    const { sdb } = sdbGia();
    const v = await docMucMayPos({ sdb, actor: QLCS_CS1, coSo: CS1, coQuyenXem: true, coQuyenGhi: false, now: NOW });
    expect(v).not.toBeNull();
    expect(v!.quyen).toEqual({ xem: true, sua: false, them: false, lyDoKhongThem: null });
    expect(h.docSucKhoeAgent).not.toHaveBeenCalled();
    expect(v!.may.every((m) => m.agent === null)).toBe(true);
    expect(v!.may).toHaveLength(1);
  });
});

describe("[HN2-MP-L03] Quản lý cơ sở mở trang cơ sở KHÁC: null và KHÔNG chạm DB (khuôn [PTTT-11])", () => {
  it("`coQuyenXem = true` (đúng như checkPermission GLOBAL trả) mà loader vẫn trả null, không đọc máy, không đọc agent", async () => {
    const { sdb, findMany } = sdbGia([{ ...HANG_MAY, id: "m_cs2", maThietBi: "MAY_CUA_CS2" }]);
    const v = await docMucMayPos({ sdb, actor: QLCS_CS1, coSo: CS2, coQuyenXem: true, coQuyenGhi: false, now: NOW });
    expect(v).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
    expect(h.docSucKhoeAgent).not.toHaveBeenCalled();
  });

  it("…cũng là ca của người có CẢ `import-pos` mà chỉ nhìn cơ sở mình (vai cơ sở bị cấp quyền) — không thấy cơ sở khác", async () => {
    const { sdb, findMany } = sdbGia();
    const v = await docMucMayPos({ sdb, actor: QLCS_CS1, coSo: CS2, coQuyenXem: true, coQuyenGhi: true, now: NOW });
    expect(v).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("đối chứng dương: cùng người, cùng quyền, mở trang CƠ SỞ MÌNH thì thấy", async () => {
    const { sdb, findMany } = sdbGia();
    const v = await docMucMayPos({ sdb, actor: QLCS_CS1, coSo: CS1, coQuyenXem: true, coQuyenGhi: false, now: NOW });
    expect(v).not.toBeNull();
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe("[HN2-MP-L04] không quyền chức năng ⇒ không đọc, không vẽ", () => {
  it("không `payments:view`, không `import-pos` ⇒ null", async () => {
    const { sdb, findMany } = sdbGia();
    const v = await docMucMayPos({ sdb, actor: QLCS_CS1, coSo: CS1, coQuyenXem: false, coQuyenGhi: false, now: NOW });
    expect(v).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("[HN2-MP-L05] vai CƠ SỞ được cấp `import-pos`: xem + thấy dòng agent, nhưng KHÔNG sửa (cổng phạm vi mọi cơ sở)", () => {
  it("quyen.sua = false (action sẽ từ chối), nhưng agent vẫn được đọc vì cổng xem agent là `import-pos`", async () => {
    const { sdb } = sdbGia();
    const coImportPos = actor({
      visibleCenterIds: ["cs1"],
      permissions: [perm("payments:view", ["cs1"]), perm("payments:import-pos", ["cs1"])],
    });
    const v = await docMucMayPos({ sdb, actor: coImportPos, coSo: CS1, coQuyenXem: true, coQuyenGhi: true, now: NOW });
    expect(v!.quyen.sua).toBe(false);
    expect(v!.quyen.them).toBe(false);
    expect(h.docSucKhoeAgent).toHaveBeenCalledTimes(1);
    expect(v!.may[0]!.agent).toMatchObject({ kieu: "KHOP", agentId: "ag1" });
  });
});

describe("[HN2-MP-L06] dòng agent: chỉ agent CỦA CƠ SỞ NÀY, ghép chặt, `now` truyền thẳng", () => {
  it("reader trả agent của MỌI cơ sở (Kế toán HO) ⇒ chỉ agent cùng `centerId` được ghép", async () => {
    const { sdb } = sdbGia();
    const cs2 = { ...AGENT, id: "ag_cs2", centerId: "cs2", coSo: "CS2" };
    h.docSucKhoeAgent.mockResolvedValue({ agents: [cs2], suKien: [] });
    const v = await docMucMayPos({ sdb, actor: KE_TOAN_HO, coSo: CS1, coQuyenXem: true, coQuyenGhi: true, now: NOW });
    // Chỉ có agent của CS2 ⇒ CS1 coi như chưa dùng agent ⇒ không in dòng nào.
    expect(v!.may[0]!.agent).toBeNull();
  });

  it("`now` đi thẳng vào reader (luật 19), và reader chạy trong CÙNG lô với câu đọc máy", async () => {
    const { sdb } = sdbGia();
    await docMucMayPos({ sdb, actor: KE_TOAN_HO, coSo: CS1, coQuyenXem: true, coQuyenGhi: true, now: NOW });
    expect(h.docSucKhoeAgent).toHaveBeenCalledTimes(1);
    expect(h.docSucKhoeAgent.mock.calls[0]![1]).toBe(NOW);
  });

  it("máy đã tắt ⇒ không in dòng agent", async () => {
    const { sdb } = sdbGia([{ ...HANG_MAY, active: false }]);
    const v = await docMucMayPos({ sdb, actor: KE_TOAN_HO, coSo: CS1, coQuyenXem: true, coQuyenGhi: true, now: NOW });
    expect(v!.may[0]!.agent).toBeNull();
  });
});

describe("[HN2-MP-L07] cơ sở đã ĐÓNG: view vẫn trả, nhưng không cho thêm", () => {
  it("quyen.them = false kèm lý do; sửa vẫn true", async () => {
    const { sdb } = sdbGia();
    const v = await docMucMayPos({
      sdb,
      actor: KE_TOAN_HO,
      coSo: { ...CS1, isActive: false },
      coQuyenXem: true,
      coQuyenGhi: true,
      now: NOW,
    });
    expect(v!.coSo.dangHoatDong).toBe(false);
    expect(v!.quyen.sua).toBe(true);
    expect(v!.quyen.them).toBe(false);
    expect(v!.quyen.lyDoKhongThem).toMatch(/Cơ sở đã đóng/);
  });
});

describe("[HN2-MP-L08] link 'Mở Biến động số dư' chỉ khi người xem có `payments:view`", () => {
  it("có payments:view ⇒ true; chỉ có import-pos ⇒ false (đích đến không chắc mở được)", async () => {
    const { sdb } = sdbGia();
    const a = await docMucMayPos({ sdb, actor: KE_TOAN_HO, coSo: CS1, coQuyenXem: true, coQuyenGhi: true, now: NOW });
    expect(a!.moDuocBienDong).toBe(true);
    const b = await docMucMayPos({ sdb, actor: KE_TOAN_HO, coSo: CS1, coQuyenXem: false, coQuyenGhi: true, now: NOW });
    expect(b!.moDuocBienDong).toBe(false);
  });
});
