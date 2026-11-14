// @vitest-environment node
// [LR3D-A*] Server Action `updateLessonAssemblyManual` — đăng nhập → ĐÚNG quyền → kiểm đường dẫn → mới ghi.
// Fake `scopedDb` ghi lại MỌI lời gọi, nên khẳng định được cả "không ghi gì" lẫn "chỉ ghi đúng 3 cột".
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  quyen: new Set<string>(),
  dangNhap: true,
  bai: null as null | Record<string, unknown>,
  update: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  loiGhi: null as null | Error,
  nguon: [] as Record<string, unknown>[],
  dich: [] as Record<string, unknown>[],
  selUnique: null as null | Record<string, unknown>,
  selMany: null as null | Record<string, unknown>,
  selNguon: null as null | Record<string, unknown>,
  tx: null as unknown,
}));

// Fake TÔN TRỌNG `select` (chỉ trả khoá được xin) — quên select một cột trong mã thật thì cột đó "biến mất" và ca đỏ,
// thay vì xanh nhờ fixture trả đủ.
const pick = (row: Record<string, unknown>, sel: Record<string, unknown> | undefined) =>
  sel ? Object.fromEntries(Object.keys(sel).filter((k) => sel[k]).map((k) => [k, row[k]])) : row;

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (h.dangNhap ? { user: { id: "u-dt", name: "Đào tạo" } } : null),
}));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: async (a: string) => h.quyen.has(a) }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: async () => ({ id: "u-dt" }) }));
vi.mock("@/lib/audit/log", () => ({ getAuditActor: () => ({ actorId: "u-dt", actorName: "Đào tạo" }) }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: (...a: unknown[]) => h.audit(...a) }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    curriculum: { findUnique: async () => ({ id: "dich", name: "Giáo trình đích" }) },
    lesson: {
      findMany: async (a: { where: { curriculumId: string }; select?: Record<string, unknown> }) => {
        if (a.where.curriculumId !== "nguon") h.selMany = a.select ?? null;
        else h.selNguon = a.select ?? null;
        return (a.where.curriculumId === "nguon" ? h.nguon : h.dich).map((r) => pick(r, a.select));
      },
      findUnique: async (a: { select?: Record<string, unknown> }) => {
        h.selUnique = a.select ?? null;
        return h.bai ? pick(h.bai, a.select) : null;
      },
      update: async (a: unknown) => {
        if (h.loiGhi) throw h.loiGhi;
        return h.update(a);
      },
    },
    // Transaction GIẢ: phép ghi chỉ được "commit" (vào h.update) khi callback KHÔNG ném — như Postgres rollback thật.
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const staged: unknown[] = [];
      const tx = {
        lesson: {
          update: async (a: unknown) => {
            if (h.loiGhi) throw h.loiGhi;
            staged.push(a);
          },
        },
      };
      h.tx = tx;
      const r = await cb(tx);
      for (const a of staged) h.update(a);
      return r;
    },
  }),
}));

import { previewMergeLessons, updateLesson, updateLessonAssemblyManual } from "./_actions";
import { pickLessonContent } from "@/lib/lms/curriculum-merge";

const URL_OK = "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha%20Set%20A/03.Catapult%20Car";
const BAI_TRON = {
  curriculumId: "gt1",
  order: 3,
  archivedAt: null,
  assemblyManualUrl: null,
  assemblyManualSetName: null,
  assemblyManualModelName: null,
};
const BAI_DA_GAN = {
  ...BAI_TRON,
  assemblyManualUrl: URL_OK,
  assemblyManualSetName: "Alpha Set A",
  assemblyManualModelName: "03.Catapult Car",
};

function khongGhiGi() {
  expect(h.update).not.toHaveBeenCalled();
  expect(h.audit).not.toHaveBeenCalled();
  expect(h.revalidate).not.toHaveBeenCalled();
}

beforeEach(() => {
  h.quyen = new Set(["curriculum:edit"]);
  h.dangNhap = true;
  h.bai = { ...BAI_TRON };
  h.loiGhi = null;
  h.tx = null;
  h.selNguon = null;
  h.update.mockReset();
  h.audit.mockReset();
  h.revalidate.mockReset();
});

describe("updateLessonAssemblyManual — cổng", () => {
  it("[LR3D-A01] chưa đăng nhập ⇒ từ chối, không ghi", async () => {
    h.dangNhap = false;
    const r = await updateLessonAssemblyManual("b1", { url: URL_OK });
    expect(r.ok).toBe(false);
    khongGhiGi();
  });

  it("[LR3D-A02] thiếu curriculum:edit ⇒ từ chối, không ghi (kể cả có quyền khác)", async () => {
    h.quyen = new Set(["curriculum:view", "training:manage"]);
    const r = await updateLessonAssemblyManual("b1", { url: URL_OK });
    expect(r).toEqual({ ok: false, error: "Không có quyền quản lý giáo trình" });
    khongGhiGi();
  });

  it("[LR3D-A03] đường dẫn sai ⇒ từ chối TRƯỚC khi chạm DB", async () => {
    for (const url of [
      "javascript:alert(1)",
      "http://www.zmrobo.net/modelmanual/model?modelUrl=A",
      "https://evil.example/modelmanual/model?modelUrl=A",
      "https://www.zmrobo.net/modelmanual/model",
    ]) {
      const r = await updateLessonAssemblyManual("b1", { url });
      expect(r.ok, url).toBe(false);
    }
    khongGhiGi();
  });

  it("[LR3D-A04] bài không tồn tại / đã lưu trữ ⇒ từ chối, không ghi", async () => {
    h.bai = null;
    expect((await updateLessonAssemblyManual("b1", { url: URL_OK })).ok).toBe(false);
    h.bai = { ...BAI_TRON, archivedAt: new Date() };
    const r = await updateLessonAssemblyManual("b1", { url: URL_OK });
    expect(r.ok).toBe(false);
    khongGhiGi();
  });
});

describe("updateLessonAssemblyManual — ghi", () => {
  it("[LR3D-A10] thêm mới ⇒ ghi ĐÚNG 3 cột (không version, không cột nào khác), có audit + làm mới trang admin", async () => {
    const r = await updateLessonAssemblyManual("b1", { url: URL_OK, setName: " Alpha Set A ", modelName: "03.Catapult Car" });
    expect(r).toEqual({
      ok: true,
      data: { url: URL_OK, setName: "Alpha Set A", modelName: "03.Catapult Car" },
    });
    expect(h.update).toHaveBeenCalledTimes(1);
    const arg = h.update.mock.calls[0]![0] as { where: unknown; data: Record<string, unknown> };
    expect(arg.where).toEqual({ id: "b1" });
    expect(Object.keys(arg.data).sort()).toEqual([
      "assemblyManualModelName",
      "assemblyManualSetName",
      "assemblyManualUrl",
    ]);
    expect(arg.data).toEqual({
      assemblyManualUrl: URL_OK,
      assemblyManualSetName: "Alpha Set A",
      assemblyManualModelName: "03.Catapult Car",
    });
    expect(h.audit).toHaveBeenCalledTimes(1);
    const au = h.audit.mock.calls[0]![0] as Record<string, unknown>;
    expect(au).toMatchObject({ module: "lms", entityType: "Lesson", entityId: "b1", action: "UPDATE" });
    expect(au.oldValues).toEqual({ assemblyManual: null });
    expect(au.newValues).toEqual({
      assemblyManual: { url: URL_OK, setName: "Alpha Set A", modelName: "03.Catapult Car" },
    });
    expect(h.revalidate).toHaveBeenCalledWith("/curriculums/gt1/edit");
  });

  it("[LR3D-A11] chỉ có đường dẫn ⇒ hai tên được ghi là NULL", async () => {
    await updateLessonAssemblyManual("b1", { url: URL_OK });
    expect((h.update.mock.calls[0]![0] as { data: unknown }).data).toEqual({
      assemblyManualUrl: URL_OK,
      assemblyManualSetName: null,
      assemblyManualModelName: null,
    });
  });

  it("[LR3D-A12] sửa đường dẫn ⇒ audit mang cả giá trị CŨ lẫn MỚI", async () => {
    h.bai = { ...BAI_DA_GAN };
    const moi = "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha%20Set%20B/01.Robot%20Arm";
    await updateLessonAssemblyManual("b1", { url: moi, setName: "Alpha Set B", modelName: "01.Robot Arm" });
    const au = h.audit.mock.calls[0]![0] as { oldValues: unknown; newValues: unknown };
    expect(au.oldValues).toEqual({
      assemblyManual: { url: URL_OK, setName: "Alpha Set A", modelName: "03.Catapult Car" },
    });
    expect(au.newValues).toEqual({
      assemblyManual: { url: moi, setName: "Alpha Set B", modelName: "01.Robot Arm" },
    });
  });

  it("[LR3D-A13] gỡ liên kết ({}) ⇒ xoá CẢ BA cột, không để tên mồ côi", async () => {
    h.bai = { ...BAI_DA_GAN };
    const r = await updateLessonAssemblyManual("b1", {});
    expect(r).toEqual({ ok: true, data: null });
    expect((h.update.mock.calls[0]![0] as { data: unknown }).data).toEqual({
      assemblyManualUrl: null,
      assemblyManualSetName: null,
      assemblyManualModelName: null,
    });
    expect((h.audit.mock.calls[0]![0] as { newValues: unknown }).newValues).toEqual({ assemblyManual: null });
  });

  it("[LR3D-A14] gỡ khi bài chưa có gì / lưu lại đúng giá trị cũ ⇒ KHÔNG ghi, KHÔNG audit", async () => {
    expect(await updateLessonAssemblyManual("b1", {})).toEqual({ ok: true, data: null });
    h.bai = { ...BAI_DA_GAN };
    const r = await updateLessonAssemblyManual("b1", {
      url: URL_OK,
      setName: "Alpha Set A",
      modelName: "03.Catapult Car",
    });
    expect(r.ok).toBe(true);
    khongGhiGi();
  });

  it("[LR3D-A15] buổi KHOÁ (LOCKED) vẫn sửa được — học liệu đính kèm giống SCORM, khác nội dung buổi", async () => {
    h.bai = { ...BAI_TRON, status: "LOCKED" };
    const r = await updateLessonAssemblyManual("b1", { url: URL_OK });
    expect(r.ok).toBe(true);
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it("[LR3D-A16] lỗi DB ⇒ báo lỗi, KHÔNG ghi audit, KHÔNG làm mới trang", async () => {
    h.loiGhi = new Error("boom");
    const r = await updateLessonAssemblyManual("b1", { url: URL_OK });
    expect(r.ok).toBe(false);
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});

// T18 — sửa "Nội dung buổi" KHÔNG được xoá (hay đổi) tài liệu lắp ráp. `updateLesson` ghi cả `lessonSchema`
// (`nullableStr` đổi khoá-thiếu thành NULL) nên ba cột mới cố ý KHÔNG nằm trong schema đó.
describe("T18 — các đường ghi khác không chạm tài liệu lắp ráp", () => {
  const NOI_DUNG = {
    curriculumId: "gt1",
    title: "Bài 3",
    order: 3,
    description: null,
    content: null,
    duration: 90,
    objectives: [],
    materials: [],
    notes: null,
    teacherGuide: null,
    expectedOutput: null,
    homeworkDefault: null,
    assessmentCriteria: null,
  };

  it("[LR3D-A20] lưu 'Nội dung buổi' ⇒ data gửi xuống DB KHÔNG có khoá assemblyManual* nào", async () => {
    h.bai = { ...BAI_DA_GAN, status: "INCOMPLETE" };
    const r = await updateLesson("b1", NOI_DUNG);
    expect(r.ok).toBe(true);
    const data = (h.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).filter((k) => k.startsWith("assemblyManual"))).toEqual([]);
  });

  it("[LR3D-A21] kể cả khi client GỬI KÈM ba trường ấy ⇒ bị bỏ, không lọt vào update (chỉ đi đường riêng có kiểm URL)", async () => {
    h.bai = { ...BAI_TRON, status: "INCOMPLETE" };
    await updateLesson("b1", {
      ...NOI_DUNG,
      assemblyManualUrl: "javascript:alert(1)",
      assemblyManualSetName: "x",
      assemblyManualModelName: "y",
    } as never);
    const data = (h.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).filter((k) => k.startsWith("assemblyManual"))).toEqual([]);
  });

  it("[LR3D-A22] 'Gộp bài từ giáo trình khác' (pickLessonContent) không sao chép cũng không xoá tài liệu lắp ráp của bài đích", () => {
    const src = { ...NOI_DUNG, id: "s1", assemblyManualUrl: URL_OK } as never;
    const out = pickLessonContent(src);
    expect(Object.keys(out).filter((k) => k.startsWith("assemblyManual"))).toEqual([]);
  });
});

describe("Gộp bài × tài liệu lắp ráp", () => {
  const nguon = (order: number) => ({
    id: `s${order}`, order, title: `Nguồn ${order}`, description: null, content: null, duration: 90, objectives: [], materials: [],
    notes: null, teacherGuide: null, expectedOutput: null, homeworkDefault: null, assessmentCriteria: null,
  });
  const dich = (order: number, over: Record<string, unknown> = {}) => ({
    id: `t${order}`, order, title: `Buổi ${order}`, status: "INCOMPLETE", archivedAt: null, assemblyManualUrl: null,
    _count: { scormPackages: 0, assignments: 0, exams: 0, documents: 0 }, ...over,
  });
  const xem = () => previewMergeLessons({ targetCurriculumId: "dich", sourceCurriculumId: "nguon", startOrder: 1 });

  it("[LR3D-A23] bài đích CHỈ có link lắp ráp (không SCORM/bài tập…) ⇒ gộp vẫn CẢNH BÁO 'đã gắn học liệu'", async () => {
    h.nguon = [nguon(1)];
    h.dich = [dich(1, { assemblyManualUrl: URL_OK })];
    const r = await xem();
    expect(r.ok).toBe(true);
    expect(r.ok && r.data?.warnings.join(" ")).toMatch(/đã gắn 1 học liệu/);
  });

  it("[LR3D-A24] đối chứng: bài đích trơn ⇒ không cảnh báo", async () => {
    h.nguon = [nguon(1)];
    h.dich = [dich(1)];
    const r = await xem();
    expect(r.ok && r.data?.warnings).toEqual([]);
  });
});

describe("updateLessonAssemblyManual — audit nhất quán với việc ghi link (transaction)", () => {
  it("[LR3D-A40] audit LỖI ⇒ link KHÔNG được ghi (rollback), báo lỗi, không làm mới trang", async () => {
    h.audit.mockImplementation(() => {
      throw new Error("audit chết");
    });
    const r = await updateLessonAssemblyManual("b1", { url: URL_OK });
    expect(r.ok).toBe(false);
    expect(h.update).not.toHaveBeenCalled(); // không có thay đổi nào được commit
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it("[LR3D-A41] audit được ghi bằng CHÍNH transaction của phép ghi link (cùng `tx`), và link cũng đi qua `tx`", async () => {
    await updateLessonAssemblyManual("b1", { url: URL_OK });
    expect(h.tx).not.toBeNull();
    const au = h.audit.mock.calls[0]![0] as { tx?: unknown };
    expect(au.tx).toBe(h.tx);
    expect(h.update).toHaveBeenCalledTimes(1); // commit đúng một lần, qua tx
  });

  it("[LR3D-A42] ghi link LỖI ⇒ không ghi audit (không có dấu vết của thay đổi không xảy ra)", async () => {
    h.loiGhi = new Error("boom");
    const r = await updateLessonAssemblyManual("b1", { url: URL_OK });
    expect(r.ok).toBe(false);
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe("previewMergeLessons — cảnh báo link lắp ráp của bài NGUỒN (owner chốt 23/10/2026)", () => {
  const nguon = (over: Record<string, unknown> = {}) => ({
    id: "s1", order: 1, title: "Nguồn 1", description: null, content: null, duration: 90, objectives: [], materials: [],
    notes: null, teacherGuide: null, expectedOutput: null, homeworkDefault: null, assessmentCriteria: null, ...over,
  });
  const dich = (over: Record<string, unknown> = {}) => ({
    id: "t1", order: 1, title: "Buổi 1", status: "INCOMPLETE", archivedAt: null, assemblyManualUrl: null,
    _count: { scormPackages: 0, assignments: 0, exams: 0, documents: 0 }, ...over,
  });
  const goi = async () => {
    const r = await previewMergeLessons({ targetCurriculumId: "dich", sourceCurriculumId: "nguon", startOrder: 1 });
    if (!r.ok || !r.data) throw new Error("preview lỗi");
    return r.data;
  };

  it("[LR3D-A34] loader bài NGUỒN XIN cột assemblyManualUrl (bỏ cột ⇒ cảnh báo chết im lặng)", async () => {
    h.nguon = [nguon()];
    h.dich = [dich()];
    await goi();
    expect(h.selNguon).toMatchObject({ assemblyManualUrl: true });
  });

  it("[LR3D-A35] nguồn có link, đích trống ⇒ preview có cảnh báo 'KHÔNG sao chép' và 'sẽ KHÔNG có link'", async () => {
    h.nguon = [nguon({ assemblyManualUrl: URL_OK })];
    h.dich = [dich()];
    const r = await goi();
    const dong = r.warnings.filter((w) => w.includes("bài nguồn có tài liệu lắp ráp 3D"));
    expect(dong).toHaveLength(1);
    expect(dong[0]).toContain("KHÔNG sao chép");
    expect(dong[0]).toContain("1 buổi đích sẽ KHÔNG có link lắp ráp");
    expect(r.errors).toEqual([]);
  });

  it("[LR3D-A36] nguồn có link, đích CŨNG có link ⇒ cảnh báo nói link đích được giữ nguyên", async () => {
    h.nguon = [nguon({ assemblyManualUrl: URL_OK })];
    h.dich = [dich({ assemblyManualUrl: URL_OK })];
    const r = await goi();
    expect(r.warnings.join(" | ")).toContain("1 buổi đích đang có link riêng: giữ nguyên");
  });

  it("[LR3D-A37] nguồn KHÔNG có link ⇒ không có cảnh báo lắp ráp nào", async () => {
    h.nguon = [nguon()];
    h.dich = [dich()];
    const r = await goi();
    expect(r.warnings.filter((w) => w.includes("lắp ráp"))).toEqual([]);
  });
});

describe("updateLessonAssemblyManual — bắt lỗi do bỏ sót (cấy lỗi chỉ ra các lỗ này)", () => {
  it("[LR3D-A30] loader XIN đủ cột: curriculumId, archivedAt và ba cột lắp ráp (quên một cột ⇒ guard/audit/no-op chết im lặng)", async () => {
    await updateLessonAssemblyManual("b1", { url: URL_OK });
    expect(h.selUnique).toMatchObject({
      curriculumId: true,
      archivedAt: true,
      assemblyManualUrl: true,
      assemblyManualSetName: true,
      assemblyManualModelName: true,
    });
  });

  it("[LR3D-A31] chỉ đổi TÊN (cùng đường dẫn) ⇒ PHẢI ghi + audit — lối tắt 'không đổi' không được nuốt sửa tên", async () => {
    h.bai = { ...BAI_DA_GAN };
    const r = await updateLessonAssemblyManual("b1", { url: URL_OK, setName: "Alpha Set B", modelName: "03.Catapult Car" });
    expect(r.ok).toBe(true);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect((h.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data.assemblyManualSetName).toBe("Alpha Set B");
    expect(h.audit).toHaveBeenCalledTimes(1);
    // xoá tên (giữ URL) cũng là một thay đổi
    h.update.mockReset();
    h.audit.mockReset();
    await updateLessonAssemblyManual("b1", { url: URL_OK });
    expect((h.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data).toMatchObject({
      assemblyManualSetName: null,
      assemblyManualModelName: null,
    });
    expect(h.audit).toHaveBeenCalledTimes(1);
  });

  it("[LR3D-A32] đường dẫn dán 'thô' (khoảng trắng, host viết hoa, bao khoảng trắng) ⇒ cái GHI xuống DB là bản CHUẨN HOÁ", async () => {
    const tho = "  https://WWW.ZMROBO.NET/modelmanual/model?modelUrl=Alpha Set A/03.Catapult Car  ";
    await updateLessonAssemblyManual("b1", { url: tho });
    expect((h.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data.assemblyManualUrl).toBe(URL_OK);
    expect((h.audit.mock.calls[0]![0] as { newValues: { assemblyManual: { url: string } } }).newValues.assemblyManual.url).toBe(URL_OK);
  });

  it("[LR3D-A33] gộp bài: loader bài ĐÍCH XIN cột assemblyManualUrl (bỏ cột ⇒ cảnh báo [LR3D-A23] chết im lặng)", async () => {
    h.nguon = [{ id: "s1", order: 1, title: "N", description: null, content: null, duration: 90, objectives: [], materials: [], notes: null, teacherGuide: null, expectedOutput: null, homeworkDefault: null, assessmentCriteria: null }];
    h.dich = [{ id: "t1", order: 1, title: "Buổi 1", status: "INCOMPLETE", archivedAt: null, assemblyManualUrl: URL_OK, _count: { scormPackages: 0, assignments: 0, exams: 0, documents: 0 } }];
    await previewMergeLessons({ targetCurriculumId: "dich", sourceCurriculumId: "nguon", startOrder: 1 });
    expect(h.selMany).toMatchObject({ assemblyManualUrl: true });
  });
});
