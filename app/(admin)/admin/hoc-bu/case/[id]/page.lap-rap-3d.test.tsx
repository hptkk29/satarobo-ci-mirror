// @vitest-environment node
// [LRB-AD*] Trang case dạy bù của ADMIN: cùng nút "Lắp ráp 3D" theo từng bài như site GV; cổng quyền + phạm vi
// của trang không bị đổi (không đọc liên kết khi case không thấy được). Chạy page THẬT; mock dữ liệu / client nặng.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { gomLapRap3d } from "@/lib/hoc-bu/lap-rap-3d";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  ca: null as Record<string, unknown> | null,
  baiTrongDb: [] as { id: string; assemblyManualUrl: string | null; assemblyManualSetName: string | null; assemblyManualModelName: string | null }[],
  goiLapRap: [] as string[][],
  quyen: true,
}));

vi.mock("sonner", () => ({ toast: { error: () => undefined, success: () => undefined } }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/auth/check-permission", () => ({
  checkAnyPermission: async () => h.quyen,
  checkPermission: async () => h.quyen,
}));
vi.mock("@/lib/auth/page-gates", () => ({ PAGE_GATES: { "/hoc-bu": ["makeup:view"] } }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({ room: { findMany: async () => [] } }) }));
vi.mock("@/lib/hoc-bu/case-chi-tiet", () => ({ docChiTietCaseV2: async () => h.ca }));
vi.mock("@/components/hoc-bu/diem-danh-be", () => ({ DiemDanhBe: () => null }));
vi.mock("../../_actions", () => ({
  diemDanhBeAction: vi.fn(),
  suaDiemDanhBeAction: vi.fn(),
  danhGiaMucAction: vi.fn(),
  goBeKhoiCaseAction: vi.fn(),
  goKhoiCaseAction: vi.fn(),
  guiBaiKiemTraBuAction: vi.fn(),
}));
vi.mock("./nut-huy-case", () => ({ NutHuyCase: () => null }));
vi.mock("../../_components/duyet-case", () => ({ NutDuyetCase: () => null, NutTuChoiCase: () => null }));
vi.mock("./sua-case", () => ({ NutNangCap: () => null, NutSuaCase: () => null }));
vi.mock("./them-hoc-vien", () => ({ NutThemBuoi: () => null, NutThemHocVien: () => null }));
// Lô thêm bé chờ duyệt (24/10/2026) là đọc DB riêng của trang; ca này chỉ canh nút Lắp ráp 3D nên không có lô nào chờ.
vi.mock("@/lib/hoc-bu/yeu-cau-them-be-db", () => ({ docLoChoDuyetThem: async () => [] }));
vi.mock("@/lib/hoc-bu/tai-lieu-bu", () => ({
  taiLieuCuaCase: async () => ({ scorm: null, deKiemTra: [] }),
  layLapRap3dCacBai: async (ids: string[]) => {
    h.goiLapRap.push([...ids]);
    return gomLapRap3d(h.baiTrongDb.filter((b) => ids.includes(b.id)));
  },
}));

import CaseBuPage from "./page";

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
    version: 0,
    status: "SCHEDULED",
    centerId: "cs1",
    courseId: "k1",
    khoa: "Sata 3",
    date: new Date("2026-10-24T00:00:00Z"),
    startTime: "09:00",
    endTime: "10:30",
    boBai: Array.from({ length: soBai }, (_, i) => ({ id: `b${i + 1}`, ten: `Buổi ${i + 1}` })),
    teacherId: "gv1",
    giaoVien: "Cô A",
    roomId: null,
    phong: null,
    sucChua: null,
    note: null,
    rejectReason: null,
    classIds: ["lop1"],
    soCoMat: 1,
    soBe: 1,
    soChoDiemDanh: 1,
    daNangCap: true,
    be: [],
  };
}
async function ve(): Promise<string> {
  return renderToStaticMarkup(await CaseBuPage({ params: Promise.resolve({ id: "c1" }) }));
}
const dem = (s: string, sub: string) => s.split(sub).length - 1;
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
  h.quyen = true;
});

describe("[LRB-AD] /hoc-bu/case/[id] (admin) × Lắp ráp 3D", () => {
  it("[LRB-AD01] ca 1 bài có link ⇒ 1 nút mở tab mới (admin không mở SCORM nhưng vẫn mở được liên kết ngoài)", async () => {
    h.baiTrongDb = [gan("b1", URL_1, "01.Car")];
    const out = await ve();
    expect(dem(out, "data-lap-rap-3d")).toBe(1);
    expect(out).toContain(`href="${URL_1}"`);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain("Mở bài giảng");
  });

  it("[LRB-AD02] ca 3 bài ⇒ 3 nút, mỗi nút dưới đúng bài", async () => {
    h.ca = dungCa(3);
    h.baiTrongDb = [gan("b1", URL_1, "01.Car"), gan("b2", URL_2, "02.Crane"), gan("b3", URL_3, "03.Arm")];
    const khoi = theoBai(await ve());
    expect(khoi["Buổi 1"]).toContain(`href="${URL_1}"`);
    expect(khoi["Buổi 2"]).toContain(`href="${URL_2}"`);
    expect(khoi["Buổi 3"]).toContain(`href="${URL_3}"`);
    for (const [ten, html] of Object.entries(khoi)) expect(dem(html, "data-lap-rap-3d"), ten).toBe(1);
  });

  it("[LRB-AD03] ca 2 bài, chỉ bài 1 có link ⇒ bài 2 không nút", async () => {
    h.ca = dungCa(2);
    h.baiTrongDb = [gan("b1", URL_1, "01.Car"), gan("b2", null)];
    const khoi = theoBai(await ve());
    expect(khoi["Buổi 1"]).toContain("data-lap-rap-3d");
    expect(khoi["Buổi 2"]).not.toContain("data-lap-rap-3d");
  });

  it("[LRB-AD04] link bẩn ⇒ không nút", async () => {
    h.baiTrongDb = [gan("b1", "javascript:alert(1)")];
    const out = await ve();
    expect(out).not.toContain("data-lap-rap-3d");
    expect(out).not.toContain("javascript:");
  });

  it("[LRB-AD05] MỘT lời gọi cho cả bộ bài", async () => {
    h.ca = dungCa(3);
    await ve();
    expect(h.goiLapRap).toEqual([["b1", "b2", "b3"]]);
  });

  it("[LRB-AD06] case ngoài tầm nhìn (loader trả null) ⇒ 404, không đọc liên kết; thiếu quyền trang ⇒ redirect, không đọc liên kết", async () => {
    h.ca = null;
    await expect(ve()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(h.goiLapRap).toHaveLength(0);
    h.ca = dungCa(1);
    h.quyen = false;
    await expect(ve()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(h.goiLapRap).toHaveLength(0);
  });
});
