// @vitest-environment node
// [LR3D-R*] Thu nhỏ giáo trình × tài liệu lắp ráp 3D (owner chốt 23/10/2026): buổi bị LƯU TRỮ có link ⇒ phải
// có cảnh báo cụ thể + coi là cần xác nhận; lưu trữ KHÔNG được xoá link. `planResize` / `resizeCurriculum`
// chạy THẬT với client giả. Fake tôn trọng `select` — quên xin một cột ở mã thật thì ca đỏ, không xanh nhờ fixture đủ.
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("@/lib/db", () => ({ db: {} }));

import { planResize, resizeCurriculum } from "./curriculum";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  lessons: [] as Row[],
  updates: [] as { where: Row; data: Row }[],
  lastSelect: null as null | Record<string, unknown>,
}));

const pick = (row: Row, sel: Record<string, unknown> | undefined): Row =>
  sel ? Object.fromEntries(Object.keys(sel).filter((k) => sel[k]).map((k) => [k, row[k]])) : row;

const client = {
  curriculum: { findUnique: async () => ({ id: "gt1" }) },
  lesson: {
    findMany: async (a: { select?: Record<string, unknown> }) => {
      h.lastSelect = a.select ?? null;
      return h.lessons.map((l) => pick(l, a.select));
    },
  },
  $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      lesson: {
        updateMany: async (a: { where: Row; data: Row }) => {
          h.updates.push(a);
          return { count: 1 };
        },
      },
    }),
} as unknown as PrismaClient;

const bai = (order: number, over: Row = {}): Row => ({
  id: `b${order}`,
  order,
  title: `Bài ${order}`,
  status: "INCOMPLETE",
  version: 1,
  assemblyManualUrl: null,
  assemblyManualSetName: null,
  assemblyManualModelName: null,
  _count: { exams: 0, assignments: 0, documents: 0 },
  ...over,
});
const CO_LINK = {
  assemblyManualUrl: "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha%20Set%20A/03.Catapult%20Car",
  assemblyManualSetName: "Alpha Set A",
  assemblyManualModelName: "03.Catapult Car",
};

beforeEach(() => {
  h.lessons = [bai(1), bai(2), bai(3, CO_LINK)];
  h.updates = [];
  h.lastSelect = null;
});

describe("planResize × tài liệu lắp ráp 3D", () => {
  it("[LR3D-R01] loader XIN đủ ba cột lắp ráp (quên select ⇒ cảnh báo chết im lặng)", async () => {
    await planResize("gt1", 2, client);
    expect(h.lastSelect).toMatchObject({
      assemblyManualUrl: true,
      assemblyManualSetName: true,
      assemblyManualModelName: true,
    });
  });

  it("[LR3D-R02] buổi bị loại có link ⇒ ứng viên mang tên bộ + tên mô hình, và needsConfirm=true dù KHÔNG có đề/bài tập/tài liệu", async () => {
    const plan = await planResize("gt1", 2, client);
    expect(plan.toArchive.map((c) => c.order)).toEqual([3]);
    expect(plan.toArchive[0]).toMatchObject({
      hasLinks: false,
      assemblyManual: { setName: "Alpha Set A", modelName: "03.Catapult Car" },
    });
    expect(plan.needsConfirm).toBe(true);
  });

  it("[LR3D-R03] không buổi nào bị loại có link ⇒ assemblyManual=null và KHÔNG đòi xác nhận thêm", async () => {
    const plan = await planResize("gt1", 3, client); // noop
    expect(plan.toArchive).toEqual([]);
    h.lessons = [bai(1), bai(2, CO_LINK), bai(3)];
    const p2 = await planResize("gt1", 2, client); // loại bài 3 (không link); bài 2 có link được giữ
    expect(p2.toArchive.map((c) => c.order)).toEqual([3]);
    expect(p2.toArchive[0]!.assemblyManual).toBeNull();
    expect(p2.needsConfirm).toBe(false);
  });

  it("[LR3D-R04] link không tên ⇒ vẫn là có link (assemblyManual khác null, tên null)", async () => {
    h.lessons = [bai(1), bai(2, { assemblyManualUrl: CO_LINK.assemblyManualUrl })];
    const plan = await planResize("gt1", 1, client);
    expect(plan.toArchive[0]!.assemblyManual).toEqual({ setName: null, modelName: null });
    expect(plan.needsConfirm).toBe(true);
  });
});

describe("resizeCurriculum × tài liệu lắp ráp 3D", () => {
  it("[LR3D-R05] giảm số buổi có link mà CHƯA confirm ⇒ NEEDS_CONFIRM, chưa ghi gì", async () => {
    const r = await resizeCurriculum({ curriculumId: "gt1", targetN: 2, client });
    expect(r).toMatchObject({ ok: false, code: "NEEDS_CONFIRM" });
    expect(h.updates).toEqual([]);
  });

  it("[LR3D-R06] confirm ⇒ chỉ ghi archivedAt + version, KHÔNG chạm ba cột link (không tự xoá link)", async () => {
    const r = await resizeCurriculum({ curriculumId: "gt1", targetN: 2, confirm: true, client });
    expect(r).toMatchObject({ ok: true, archived: 1 });
    expect(h.updates).toHaveLength(1);
    expect(Object.keys(h.updates[0]!.data).sort()).toEqual(["archivedAt", "version"]);
    expect(Object.keys(h.updates[0]!.data).filter((k) => k.startsWith("assemblyManual"))).toEqual([]);
  });
});
