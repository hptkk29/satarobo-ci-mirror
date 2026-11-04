// @vitest-environment node
// [TLHP-*] Tab "Tài liệu học phần" — lưới số truy vấn / số tầng đi-về DB (24/10/2026).
//
// Vì sao có: giáo viên báo tab tải chậm. Đo trên dữ liệu PROD (EXPLAIN): mỗi câu DB < 2 ms ⇒ cái đắt không phải một câu mà là
// SỐ LƯỢT ĐI-VỀ NỐI ĐUÔI (mỗi lượt qua Prisma còn kéo theo `DEALLOCATE ALL` vì `lib/db.ts` ép `pgbouncer=true`) và pool chỉ 5
// kết nối. Bản cũ: lớp → khung (+bài) → RỒI mới tài liệu/SCORM/buổi = bốn lượt nối đuôi. Nay tài liệu/SCORM/buổi lọc theo QUAN HỆ
// nên chạy CÙNG LÚC với khung, và nơi gọi đưa sẵn `courseIdDaBiet` để bỏ câu tra lớp.
//
// Test chạy HubMaterialsTab THẬT với `scopedDb` giả GHI THỨ TỰ gọi. Các ca "đồng thời" dùng promise treo (deferred): nếu mã quay lại
// kiểu `await` nối đuôi thì câu thứ hai KHÔNG được gọi trước khi câu thứ nhất xong ⇒ ca đỏ.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type Row = Record<string, unknown>;
type Deferred<T> = { p: Promise<T>; ok: (v: T) => void };
const treo = <T,>(): Deferred<T> => {
  let ok!: (v: T) => void;
  const p = new Promise<T>((r) => (ok = r));
  return { p, ok };
};

const h = vi.hoisted(() => ({
  scormOn: true,
  goi: [] as string[], // thứ tự BẮT ĐẦU của từng câu: "class", "curriculum", "document", "scorm", "session"
  args: {} as Record<string, unknown>,
  hoan: null as null | Record<string, { p: Promise<unknown>; ok: (v: unknown) => void }>,
  data: {
    curriculum: { name: "Sata3", lessons: [] as Row[] } as Row | null,
    document: [] as Row[],
    scorm: [] as Row[],
    session: [] as Row[],
  },
  after: vi.fn(),
  lamNong: vi.fn(),
}));

const chay = (ten: string, args: unknown, tra: () => unknown) => {
  h.goi.push(ten);
  h.args[ten] = args;
  const d = h.hoan?.[ten];
  return d ? d.p : Promise.resolve(tra());
};

vi.mock("@/lib/flags", () => ({ isScormEnabled: () => h.scormOn }));
vi.mock("next/server", () => ({ after: (f: () => void) => h.after(f) }));
vi.mock("@/lib/scorm/dem-dia", () => ({ lamNongGoi: (p: string) => h.lamNong(p) }));
vi.mock("@/lib/db-scope", () => ({
  actorGiangDay: (a: unknown) => a,
  scopedDb: () => ({
    class: { findUnique: (a: unknown) => chay("class", a, () => ({ courseId: "c1" })) },
    curriculum: { findFirst: (a: unknown) => chay("curriculum", a, () => h.data.curriculum) },
    document: { findMany: (a: unknown) => chay("document", a, () => h.data.document) },
    scormPackage: { findMany: (a: unknown) => chay("scorm", a, () => h.data.scorm) },
    classSession: { findMany: (a: unknown) => chay("session", a, () => h.data.session) },
  }),
}));

import { HubMaterialsTab } from "./hub-materials-tab";

const bai = (id: string, order: number): Row => ({
  id,
  order,
  title: `Bài ${order}`,
  objectives: [],
  assemblyManualUrl: null,
  assemblyManualSetName: null,
  assemblyManualModelName: null,
});

const actor = { id: "gv1" } as never;

beforeEach(() => {
  h.scormOn = true;
  h.goi = [];
  h.args = {};
  h.hoan = null;
  h.data = {
    curriculum: { name: "Sata3", lessons: [bai("b1", 1), bai("b2", 2)] },
    document: [{ id: "d1", title: "Phiếu 1", fileUrl: "https://x.test/1.pdf", type: "PDF", lessonId: "b1" }],
    scorm: [{ id: "sc1", name: "Giáo án 1", lessonId: "b1", storagePrefix: "scorm/sc1/" }],
    session: [{ id: "s1", lessonId: "b1" }],
  };
  h.after.mockReset();
  h.lamNong.mockReset();
});

describe("HubMaterialsTab × số truy vấn", () => {
  it("[TLHP-01] nơi gọi đưa sẵn khoá ⇒ KHÔNG tra lại lớp (bỏ một lượt đi-về)", async () => {
    const out = renderToStaticMarkup(await HubMaterialsTab({ actor, classId: "lop1", courseIdDaBiet: "c1" }));
    expect(h.goi).not.toContain("class");
    expect(out).toContain("Phiếu 1");
    expect(out).toContain("Bài giảng SCORM");
    // Khoá đưa vào là khoá mà câu khung dùng — không phải khoá nào khác.
    expect((h.args.curriculum as { where: { courseId: string } }).where.courseId).toBe("c1");
  });

  it("[TLHP-02] không có khoá ⇒ tự tra đúng MỘT lần, đúng lớp", async () => {
    await HubMaterialsTab({ actor, classId: "lop1" });
    expect(h.goi.filter((x) => x === "class")).toHaveLength(1);
    expect((h.args.class as { where: { id: string } }).where.id).toBe("lop1");
  });

  it("[TLHP-03] khung · tài liệu · SCORM · buổi được HỎI CÙNG LÚC (chưa câu nào xong đã đủ bốn câu)", async () => {
    h.hoan = {
      curriculum: treo(),
      document: treo(),
      scorm: treo(),
      session: treo(),
    };
    const chayXong = HubMaterialsTab({ actor, classId: "lop1", courseIdDaBiet: "c1" });
    // Nhường vòng lặp sự kiện vài nhịp — nếu mã `await` nối đuôi, chỉ câu đầu đã được gọi.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect([...h.goi].sort()).toEqual(["curriculum", "document", "scorm", "session"]);
    h.hoan.curriculum!.ok(h.data.curriculum);
    h.hoan.document!.ok(h.data.document);
    h.hoan.scorm!.ok(h.data.scorm);
    h.hoan.session!.ok(h.data.session);
    expect(renderToStaticMarkup(await chayXong)).toContain("Bài 1");
  });

  it("[TLHP-04] tài liệu/SCORM/buổi lọc theo QUAN HỆ (khung ACTIVE của khoá), không theo danh sách id chờ câu khung", async () => {
    await HubMaterialsTab({ actor, classId: "lop1", courseIdDaBiet: "c1" });
    const loc = {
      lesson: { archivedAt: null, curriculum: { courseId: "c1", status: "ACTIVE" } },
    };
    expect((h.args.document as { where: unknown }).where).toEqual(loc);
    expect((h.args.scorm as { where: unknown }).where).toEqual({ ...loc, isActiveForLesson: true, status: "PUBLISHED" });
    expect((h.args.session as { where: unknown }).where).toEqual({ classId: "lop1", ...loc });
  });

  it("[TLHP-05] đầu ra KHÔNG đổi khi câu trả về thừa dòng của bài ngoài khung đã chọn", async () => {
    h.data.document.push({ id: "dx", title: "Của khung khác", fileUrl: "https://x.test/x.pdf", type: "PDF", lessonId: "bai-khung-khac" });
    h.data.scorm.push({ id: "scx", name: "SCORM khung khác", lessonId: "bai-khung-khac", storagePrefix: "scorm/scx/" });
    const out = renderToStaticMarkup(await HubMaterialsTab({ actor, classId: "lop1", courseIdDaBiet: "c1" }));
    expect(out).not.toContain("Của khung khác");
    expect(out).not.toContain("scx");
    expect(out).toContain("Phiếu 1");
  });

  it("[TLHP-06] Hub đầy đủ KHÔNG làm nóng gói nào (hàng chục gói của cả khoá không được tải về VPS)", async () => {
    await HubMaterialsTab({ actor, classId: "lop1", courseIdDaBiet: "c1" });
    expect(h.after).not.toHaveBeenCalled();
    expect(h.lamNong).not.toHaveBeenCalled();
  });

  it("[TLHP-08] cờ SCORM tắt ⇒ không hỏi SCORM lẫn buổi (chỉ khung + tài liệu)", async () => {
    h.scormOn = false;
    await HubMaterialsTab({ actor, classId: "lop1", courseIdDaBiet: "c1" });
    expect([...h.goi].sort()).toEqual(["curriculum", "document"]);
  });

  it("[TLHP-09] không xin cột nặng: tài liệu chỉ 5 cột, SCORM chỉ 3 cột (không manifest/launch/error…)", async () => {
    await HubMaterialsTab({ actor, classId: "lop1", courseIdDaBiet: "c1" });
    expect(Object.keys((h.args.document as { select: object }).select).sort()).toEqual(
      ["fileUrl", "id", "lessonId", "title", "type"].sort(),
    );
    expect(Object.keys((h.args.scorm as { select: object }).select).sort()).toEqual(
      ["id", "lessonId", "name"].sort(),
    );
  });
});
