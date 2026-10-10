// @vitest-environment node
//
// Ca [BL2-RT-*] — HAI ROUTE tệp bảo lưu: ký URL tải lên (POST) và xem tệp (GET). Test HÀNH VI của cổng:
// quyền, công tắc, cơ sở, khoá hợp lệ, audit TRƯỚC khi ký, redirect 302 no-store, KHÔNG có publicUrl.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  findUnique: vi.fn(),
  writeAudit: vi.fn(async (_a: unknown) => ({ id: "audit-1" })),
  khoOk: vi.fn(() => true),
  kyGet: vi.fn(async (khoa: string, ttl: number) => `https://r2.test/${khoa}?ttl=${ttl}`),
  kyPut: vi.fn(async (khoa: string) => `https://r2.test/put/${khoa}`),
  batNoiNao: vi.fn(async () => true),
  getSetting: vi.fn(async () => 600),
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({ studentReserve: { findUnique: h.findUnique } }) }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/settings/service", () => ({ getSetting: h.getSetting }));
vi.mock("@/lib/bao-luu/feature", () => ({ coNoiNaoBatBaoLuu: h.batNoiNao, LOI_BAO_LUU_TAT: "TAT" }));
vi.mock("@/lib/bao-luu/kho-tep", () => ({
  khoBaoLuuDaCauHinh: h.khoOk,
  kyUrlTaiVeBaoLuu: h.kyGet,
  kyUrlTaiLenBaoLuu: h.kyPut,
}));

import { POST } from "./upload-url/route";
import { GET } from "./[reserveId]/route";
import { NextRequest } from "next/server";

const KHOA = "bao-luu/2026-10/ab12cd34ef56ab12.pdf";
const HS = { id: "r1", centerId: "cs1", orgUnitId: "ou1", studentId: "hv1", applicationFileKey: KHOA, evidenceFileKeys: ["bao-luu/2026-10/ffeeddcc.jpg"] };

const post = (body: unknown) =>
  POST(new NextRequest("https://admin.satarobo.vn/api/admin/bao-luu/tep/upload-url", { method: "POST", body: JSON.stringify(body) }));
const get = (q = "", id = "r1") =>
  GET(new Request(`https://admin.satarobo.vn/api/admin/bao-luu/tep/${id}${q}`), { params: Promise.resolve({ reserveId: id }) });
const quyen = (...cho: string[]) => h.checkPermission.mockImplementation(async (a: string) => cho.includes(a));

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Sale" } });
  h.resolveActor.mockResolvedValue({ isHoLevel: false, visibleOrgUnitIds: ["ou1"] });
  h.khoOk.mockReturnValue(true);
  h.batNoiNao.mockResolvedValue(true);
  h.findUnique.mockResolvedValue({ ...HS });
  h.writeAudit.mockResolvedValue({ id: "audit-1" });
});

describe("[BL2-RT-01] POST upload-url — cổng vào", () => {
  const OK = { filename: "don-bao-luu.pdf", mimeType: "application/pdf", sizeBytes: 1_000_000 };

  it("chưa đăng nhập ⇒ 401; không có bao-luu:create lẫn center-pause ⇒ 403", async () => {
    h.auth.mockResolvedValue(null);
    expect((await post(OK)).status).toBe(401);
    h.auth.mockResolvedValue({ user: { id: "u1" } });
    quyen("bao-luu:view");
    expect((await post(OK)).status).toBe(403);
    expect(h.kyPut).not.toHaveBeenCalled();
  });

  it("có bao-luu:create ⇒ 200, trả key hợp lệ và TUYỆT ĐỐI không có publicUrl; ĐỐI CHỨNG: center-pause cũng được", async () => {
    quyen("bao-luu:create");
    const r = await post(OK);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.key).toMatch(/^bao-luu\/\d{4}-\d{2}\/[a-f0-9]{32}\.pdf$/);
    expect(b).not.toHaveProperty("publicUrl");
    expect(b.uploadUrl).toContain(b.key);
    expect(r.headers.get("cache-control")).toBe("no-store");
    quyen("bao-luu:center-pause");
    expect((await post(OK)).status).toBe(200);
  });

  it("công tắc bảo lưu TẮT ở mọi cơ sở trong tầm nhìn ⇒ 403, không ký", async () => {
    quyen("bao-luu:create");
    h.batNoiNao.mockResolvedValue(false);
    expect((await post(OK)).status).toBe(403);
    expect(h.kyPut).not.toHaveBeenCalled();
  });

  it("người cấp Hội sở hỏi công tắc theo danh sách RỖNG (toàn hệ), người cấp cơ sở theo đơn vị của mình", async () => {
    quyen("bao-luu:create");
    await post(OK);
    expect(h.batNoiNao).toHaveBeenLastCalledWith(["ou1"]);
    h.resolveActor.mockResolvedValue({ isHoLevel: true, visibleOrgUnitIds: ["ou1", "ou2"] });
    await post(OK);
    expect(h.batNoiNao).toHaveBeenLastCalledWith([]);
  });

  it.each([
    ["đuôi lạ", { filename: "macro.docm", mimeType: "application/msword", sizeBytes: 10 }, 400],
    ["mime không khớp đuôi", { filename: "don.pdf", mimeType: "image/png", sizeBytes: 10 }, 400],
    ["quá lớn", { filename: "don.pdf", mimeType: "application/pdf", sizeBytes: 11 * 1024 * 1024 }, 413],
    ["cỡ 0", { filename: "don.pdf", mimeType: "application/pdf", sizeBytes: 0 }, 400],
    ["thiếu trường", { filename: "don.pdf" }, 400],
  ])("từ chối: %s", async (_ten, body, status) => {
    quyen("bao-luu:create");
    expect((await post(body)).status).toBe(status);
    expect(h.kyPut).not.toHaveBeenCalled();
  });

  it("kho chưa cấu hình ⇒ 503 (fail-closed), không rơi về bucket chung", async () => {
    quyen("bao-luu:create");
    h.khoOk.mockReturnValue(false);
    expect((await post(OK)).status).toBe(503);
  });
});

describe("[BL2-RT-02] GET xem tệp", () => {
  it("chưa đăng nhập ⇒ 401; thiếu bao-luu:view ⇒ 403 (kể cả khi có bao-luu:create — tải lên KHÔNG kéo theo xem)", async () => {
    h.auth.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    h.auth.mockResolvedValue({ user: { id: "u1" } });
    quyen("bao-luu:create");
    expect((await get()).status).toBe(403);
    expect(h.findUnique).not.toHaveBeenCalled();
  });

  it("hồ sơ ngoài tầm nhìn cơ sở ⇒ 404 (không 403 — không lộ sự tồn tại), không audit, không ký", async () => {
    quyen("bao-luu:view");
    h.findUnique.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(h.kyGet).not.toHaveBeenCalled();
  });

  it("đúng quyền + đúng cơ sở ⇒ 302 no-store tới URL ký 120 giây, audit ghi TRƯỚC khi ký và KHÔNG chứa khoá/URL", async () => {
    quyen("bao-luu:view");
    const thuTu: string[] = [];
    h.writeAudit.mockImplementation(async (_a: unknown) => { thuTu.push("audit"); return { id: "a" }; });
    h.kyGet.mockImplementation(async (k: string, t: number) => { thuTu.push("ky"); return `https://r2.test/${k}?ttl=${t}`; });
    const r = await get("?loai=don");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`https://r2.test/${KHOA}?ttl=120`);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(thuTu).toEqual(["audit", "ky"]);
    const ghi = h.writeAudit.mock.calls[0]![0] as { action: string; newValues: Record<string, unknown>; orgUnitId: string };
    expect(ghi.action).toBe("TAI_TEP_BAO_LUU");
    expect(ghi.orgUnitId).toBe("ou1");
    expect(JSON.stringify(ghi.newValues)).not.toContain("bao-luu/");
  });

  it("minh chứng theo số thứ tự; số thứ tự ngoài mảng ⇒ 404; số âm/không nguyên ⇒ 400", async () => {
    quyen("bao-luu:view");
    expect((await get("?loai=minh-chung&i=0")).headers.get("location")).toContain("ffeeddcc.jpg");
    expect((await get("?loai=minh-chung&i=7")).status).toBe(404);
    expect((await get("?loai=minh-chung&i=-1")).status).toBe(400);
    expect((await get("?loai=minh-chung&i=1.5")).status).toBe(400);
  });

  it("loại lạ ⇒ 400; hồ sơ chưa có đơn ⇒ 404", async () => {
    quyen("bao-luu:view");
    expect((await get("?loai=khac")).status).toBe(400);
    h.findUnique.mockResolvedValue({ ...HS, applicationFileKey: null });
    expect((await get("?loai=don")).status).toBe(404);
  });

  it("KHOÁ SAI HÌNH DẠNG trong DB (vd khoá của hoá đơn) ⇒ 404 và KHÔNG ký, KHÔNG audit — lớp chặn xin URL ký object tuỳ ý", async () => {
    quyen("bao-luu:view");
    h.findUnique.mockResolvedValue({ ...HS, applicationFileKey: "hoa-don/CS1/2026/don1/u.pdf" });
    expect((await get("?loai=don")).status).toBe(404);
    expect(h.kyGet).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("audit ném ⇒ 503 và KHÔNG ký — kẻ xem tệp phải để lại dấu vết", async () => {
    quyen("bao-luu:view");
    h.writeAudit.mockRejectedValue(new Error("db down"));
    expect((await get()).status).toBe(503);
    expect(h.kyGet).not.toHaveBeenCalled();
  });

  it("kho chưa cấu hình ⇒ 503, không audit", async () => {
    quyen("bao-luu:view");
    h.khoOk.mockReturnValue(false);
    expect((await get()).status).toBe(503);
    expect(h.writeAudit).not.toHaveBeenCalled();
  });
});
