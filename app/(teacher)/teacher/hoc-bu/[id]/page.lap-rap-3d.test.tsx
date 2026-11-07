// @vitest-environment node
// [LRB-GV*] Trang buổi dạy bù của GV: nút "Lắp ráp 3D" cho TỪNG bài (ca 1–3 bài), đúng bài, một câu truy vấn,
// và case của người khác ⇒ 404 TRƯỚC khi đọc bất kỳ liên kết nào. Chạy page THẬT; mock chỉ phần dữ liệu / client nặng.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { gomLapRap3d } from "@/lib/hoc-bu/lap-rap-3d";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  ca: null as Record<string, unknown> | null,
  baiTrongDb: [] as { id: string; assemblyManualUrl: string | null; assemblyManualSetName: string | null; assemblyManualModelName: string | null }[],
  goiLapRap: [] as string[][],
  goiTaiLieu: [] as string[],
  gvDoc: [] as string[],
}));

vi.mock("sonner", () => ({ toast: { error: () => undefined, success: () => undefined } }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "gv1" } }) }));
vi.mock("@/lib/hoc-bu/case-chi-tiet", () => ({
  docChiTietCaseV2ChoGv: async (gv: string, id: string) => {
    h.gvDoc.push(`${gv}:${id}`);
    return h.ca;
  },
}));
vi.mock("@/components/hoc-bu/diem-danh-be", () => ({ DiemDanhBe: () => null }));
vi.mock("../../_components/ui/page-header", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("../_actions", () => ({
  diemDanhBeGvAction: vi.fn(),
  suaDiemDanhBeGvAction: vi.fn(),
  danhGiaMucGvAction: vi.fn(),
  guiBaiKiemTraBuGvAction: vi.fn(),
}));
vi.mock("@/lib/hoc-bu/tai-lieu-bu", () => ({
  taiLieuCuaCase: async (c: { lessonId: string }) => {
    h.goiTaiLieu.push(c.lessonId);
    return { scorm: { id: `p-${c.lessonId}`, name: `Giáo án ${c.lessonId}` }, deKiemTra: [] };
  },
  // Dùng lõi THẬT `gomLapRap3d` (kiểm lại URL) trên "bảng Lesson" giả — chỉ phần đọc DB là giả.
  layLapRap3dCacBai: async (ids: string[]) => {
    h.goiLapRap.push([...ids]);
    return gomLapRap3d(h.baiTrongDb.filter((b) => ids.includes(b.id)));
  },
}));

import TeacherHocBuPage from "./page";

const URL_1 = "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha%20Set%20A/01.Car";
const URL_2 = "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha%20Set%20A/02.Crane";
const URL_3 = "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha%20Set%20A/03.Arm";

const gan = (id: string, url: string | null, model: string | null = null) => ({
  id,
  assemblyManualUrl: url,
  assemblyManualSetName: url ? "Alpha Set A" : null,
  assemblyManualModelName: model,
});
function dungCa(soBai: number): Row {
  return {
    id: "c1",
    status: "SCHEDULED",
    khoa: "Sata 3",
    date: new Date("2026-10-24T00:00:00Z"),
    startTime: "09:00",
    endTime: "10:30",
    phong: null,
    boBai: Array.from({ length: soBai }, (_, i) => ({ id: `b${i + 1}`, ten: `Buổi ${i + 1}` })),
    classIds: ["lop1"],
    soCoMat: 1,
    soBe: 1,
    soChoDiemDanh: 1,
    daNangCap: true,
    be: [],
  };
}
async function ve(): Promise<string> {
  return renderToStaticMarkup(await TeacherHocBuPage({ params: Promise.resolve({ id: "c1" }) }));
}
const dem = (s: string, sub: string) => s.split(sub).length - 1;
/** Cắt HTML theo tiêu đề từng bài (h3 `mb-1.5`) — trả { 'Buổi 1': '<html của khối bài 1>' }. */
function theoBai(html: string): Record<string, string> {
  const re = /<h3 class="mb-1\.5[^"]*">([^<]*)<\/h3>/g;
  const mốc = [...html.matchAll(re)].map((m) => ({ ten: m[1]!, tu: m.index! }));
  const kq: Record<string, string> = {};
  mốc.forEach((m, i) => {
    kq[m.ten] = html.slice(m.tu, i + 1 < mốc.length ? mốc[i + 1]!.tu : undefined);
  });
  return kq;
}

beforeEach(() => {
  h.ca = dungCa(1);
  h.baiTrongDb = [];
  h.goiLapRap = [];
  h.goiTaiLieu = [];
  h.gvDoc = [];
});

describe("[LRB-GV] /teacher/hoc-bu/[id] × Lắp ráp 3D", () => {
  it("[LRB-GV01] ca 1 bài có link ⇒ đúng 1 nút, mở tab mới", async () => {
    h.baiTrongDb = [gan("b1", URL_1, "01.Car")];
    const out = await ve();
    expect(dem(out, "data-lap-rap-3d")).toBe(1);
    expect(out).toContain(`href="${URL_1}"`);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("[LRB-GV02] ca 3 bài, đủ link ⇒ 3 nút, MỖI nút nằm dưới đúng bài của nó", async () => {
    h.ca = dungCa(3);
    h.baiTrongDb = [gan("b1", URL_1, "01.Car"), gan("b2", URL_2, "02.Crane"), gan("b3", URL_3, "03.Arm")];
    const out = await ve();
    expect(dem(out, "data-lap-rap-3d")).toBe(3);
    const khoi = theoBai(out);
    expect(Object.keys(khoi)).toEqual(["Buổi 1", "Buổi 2", "Buổi 3"]);
    expect(khoi["Buổi 1"]).toContain(`href="${URL_1}"`);
    expect(khoi["Buổi 2"]).toContain(`href="${URL_2}"`);
    expect(khoi["Buổi 3"]).toContain(`href="${URL_3}"`);
    for (const [ten, html] of Object.entries(khoi)) expect(dem(html, "data-lap-rap-3d"), ten).toBe(1);
  });

  it("[LRB-GV03] ca 2 bài, chỉ bài 2 có link ⇒ 1 nút ở bài 2; bài 1 trung tính (không nút, không chữ lỗi)", async () => {
    h.ca = dungCa(2);
    h.baiTrongDb = [gan("b1", null), gan("b2", URL_2, "02.Crane")];
    const khoi = theoBai(await ve());
    expect(khoi["Buổi 1"]).not.toContain("data-lap-rap-3d");
    expect(khoi["Buổi 1"]).not.toContain("Lắp ráp 3D");
    expect(khoi["Buổi 2"]).toContain(`href="${URL_2}"`);
  });

  it("[LRB-GV04] không bài nào có link ⇒ không nút nào; trang vẫn dựng và vẫn có 'Mở bài giảng' (SCORM không bị ảnh hưởng)", async () => {
    h.ca = dungCa(3);
    const out = await ve();
    expect(out).not.toContain("data-lap-rap-3d");
    expect(dem(out, "Mở bài giảng")).toBe(3);
  });

  it("[LRB-GV05] link bẩn trong bảng bài (javascript:, host lạ) ⇒ không nút", async () => {
    h.ca = dungCa(2);
    h.baiTrongDb = [gan("b1", "javascript:alert(1)"), gan("b2", "https://zmrobo.net.evil.com/modelmanual/model?modelUrl=a")];
    const out = await ve();
    expect(out).not.toContain("data-lap-rap-3d");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("evil.com");
  });

  it("[LRB-GV06] lấy liên kết bằng ĐÚNG MỘT lời gọi cho cả bộ bài (không mỗi bài một câu), theo thứ tự bài của ca", async () => {
    h.ca = dungCa(3);
    await ve();
    expect(h.goiLapRap).toEqual([["b1", "b2", "b3"]]);
  });

  it("[LRB-GV07] case của người khác / chờ duyệt (loader trả null) ⇒ 404 và KHÔNG đọc liên kết nào", async () => {
    h.ca = null;
    h.baiTrongDb = [gan("b1", URL_1)];
    await expect(ve()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(h.gvDoc).toEqual(["gv1:c1"]); // cổng là teacherId của phiên + id trên URL
    expect(h.goiLapRap).toHaveLength(0);
    expect(h.goiTaiLieu).toHaveLength(0);
  });

  it("[LRB-GV08] nút không mang mã học viên / lớp / case / token trong URL", async () => {
    h.baiTrongDb = [gan("b1", URL_1, "01.Car")];
    const out = await ve();
    const href = out.match(/<a href="([^"]*zmrobo[^"]*)"/)![1]!;
    expect(href).toBe(URL_1);
    expect(new URL(href).searchParams.size).toBe(1);
  });
});
