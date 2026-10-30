// @vitest-environment node
// [LR3D-H*] Tab "Tài liệu học phần" của Class Hub: nút "Lắp ráp 3D" theo ĐÚNG bài có đường dẫn, độc lập
// với SCORM. Chạy HubMaterialsTab THẬT với `scopedDb` giả. Fake tôn trọng `select` (chỉ trả những khoá
// được xin) — nên quên `select` ba cột mới ở loader là ca đỏ, không phải xanh nhờ fixture quá đủ.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  scormOn: true,
  lessons: [] as Row[],
  scormPkgs: [] as Row[],
  lastLessonSelect: null as null | Record<string, unknown>,
}));

const pick = (row: Row, select: Record<string, unknown> | undefined): Row =>
  select ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]])) : row;

vi.mock("@/lib/flags", () => ({ isScormEnabled: () => h.scormOn }));
vi.mock("@/lib/db-scope", () => ({
  actorGiangDay: (a: unknown) => a,
  scopedDb: () => ({
    class: { findUnique: async () => ({ courseId: "c1" }) },
    curriculum: {
      findFirst: async (a: { select: { lessons: { select: Record<string, unknown> } } }) => {
        h.lastLessonSelect = a.select.lessons.select;
        return { name: "Sata3", lessons: h.lessons.map((l) => pick(l, a.select.lessons.select)) };
      },
    },
    document: { findMany: async () => [] },
    scormPackage: { findMany: async () => h.scormPkgs },
    classSession: { findMany: async () => [] },
  }),
}));

import { HubMaterialsTab } from "./hub-materials-tab";

const URL_A = "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha%20Set%20A/03.Catapult%20Car";
const baiCo = (id: string, order: number, over: Row = {}): Row => ({
  id,
  order,
  title: `Bài ${order}`,
  objectives: [],
  assemblyManualUrl: null,
  assemblyManualSetName: null,
  assemblyManualModelName: null,
  ...over,
});
const goiScorm = (lessonId: string): Row => ({ id: `sc-${lessonId}`, name: `Giáo án ${lessonId}`, lessonId, storagePrefix: "p/" });

async function ve() {
  const jsx = await HubMaterialsTab({ actor: { id: "gv1" } as never, classId: "lop1" });
  return renderToStaticMarkup(jsx);
}
const dem = (s: string, sub: string) => s.split(sub).length - 1;

beforeEach(() => {
  h.scormOn = true;
  h.lessons = [];
  h.scormPkgs = [];
  h.lastLessonSelect = null;
});

describe("HubMaterialsTab × Lắp ráp 3D", () => {
  it("[LR3D-H01] bài có SCORM + đường dẫn ⇒ đủ cả 'Mở trình chiếu' lẫn 'Lắp ráp 3D'", async () => {
    h.lessons = [baiCo("b1", 1, { assemblyManualUrl: URL_A, assemblyManualSetName: "Alpha Set A", assemblyManualModelName: "03.Catapult Car" })];
    h.scormPkgs = [goiScorm("b1")];
    const out = await ve();
    expect(out).toContain("Bài giảng SCORM");
    expect(out).toContain("Mở trình");
    expect(out).toContain(`href="${URL_A}"`);
    expect(out).toContain("Lắp ráp 3D");
    expect(out).toContain('target="_blank"');
    // Tên bộ/tên mô hình đi tới tận nhãn mà giáo viên thấy — đúng thứ tự (bộ trước, mô hình sau).
    expect(out).toContain('aria-label="Lắp ráp 3D: Alpha Set A · 03.Catapult Car (mở tab mới)"');
  });

  it("[LR3D-H02] bài KHÔNG có SCORM nhưng có đường dẫn ⇒ vẫn hiện nút lắp ráp, không hiện SCORM", async () => {
    h.lessons = [baiCo("b1", 1, { assemblyManualUrl: URL_A })];
    const out = await ve();
    expect(out).toContain("Lắp ráp 3D");
    expect(out).not.toContain("Bài giảng SCORM");
    expect(out).not.toContain("Mở trình");
    expect(out).toContain("Không có tài liệu đính kèm khác.");
  });

  it("[LR3D-H03] cờ SCORM TẮT ⇒ nút lắp ráp vẫn hiện (độc lập với SCORM)", async () => {
    h.scormOn = false;
    h.lessons = [baiCo("b1", 1, { assemblyManualUrl: URL_A })];
    h.scormPkgs = [goiScorm("b1")];
    const out = await ve();
    expect(out).toContain("Lắp ráp 3D");
    expect(out).not.toContain("Mở trình");
  });

  it("[LR3D-H04] bài KHÔNG có đường dẫn ⇒ không có nút; bố cục SCORM không đổi", async () => {
    h.lessons = [baiCo("b1", 1), baiCo("b2", 2, { assemblyManualUrl: URL_A })];
    h.scormPkgs = [goiScorm("b1")];
    const out = await ve();
    // Đúng MỘT nút (bài b2); bài b1 chỉ có SCORM.
    expect(dem(out, 'aria-label="Lắp ráp 3D (mở tab mới)"')).toBe(1);
    expect(dem(out, 'target="_blank"')).toBe(1);
    expect(out).toContain("Mở trình");
  });

  it("[LR3D-H05] hai bài dùng CÙNG một đường dẫn ⇒ cả hai có nút, cùng href", async () => {
    h.lessons = [baiCo("b1", 1, { assemblyManualUrl: URL_A }), baiCo("b2", 5, { assemblyManualUrl: URL_A })];
    const out = await ve();
    expect(dem(out, `href="${URL_A}"`)).toBe(2);
  });

  it("[LR3D-H06] đường dẫn bẩn trong DB (không qua validator) ⇒ KHÔNG có nút, không có href lạ", async () => {
    h.lessons = [
      baiCo("b1", 1, { assemblyManualUrl: "javascript:alert(1)" }),
      baiCo("b2", 2, { assemblyManualUrl: "https://evil.example/modelmanual/model?modelUrl=A" }),
    ];
    const out = await ve();
    expect(out).not.toContain("Lắp ráp 3D");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("evil.example");
    // Không dựng khối nút rỗng, và câu thay thế vẫn nói đúng: bài này CHƯA có tài liệu nào.
    expect(out).toContain("Buổi này chưa có tài liệu.");
    expect(out).not.toContain("Không có tài liệu đính kèm khác.");
  });

  it("[LR3D-H07] loader XIN đủ ba cột mới (quên select thì fake không trả ⇒ ca H01 đỏ)", async () => {
    h.lessons = [baiCo("b1", 1)];
    await ve();
    expect(h.lastLessonSelect).toMatchObject({
      assemblyManualUrl: true,
      assemblyManualSetName: true,
      assemblyManualModelName: true,
    });
  });
});
