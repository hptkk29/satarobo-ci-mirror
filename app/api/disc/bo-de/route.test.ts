import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dữ liệu GIẢ. Không DB, không Upstash.
const m = vi.hoisted(() => ({ rateLimit: vi.fn() }));
// Route test dùng engine GIẢ qua datEngine: ensureDiscEngine() (đăng ký engine thật) không được ghi đè nó.
// Engine thật được kiểm ở tests/disc-engine và tests/disc-engine/route-engine-that.test.ts.
vi.mock("@/lib/disc/engine-dang-ky", () => ({ ensureDiscEngine: () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));

import { datEngine, type BoDeDisc, type DiscEngine } from "@/lib/disc/engine";
import { POST } from "./route";

const boGia = {
  ma: "HS-GIA",
  phienBan: "gia-1",
  doiTuong: "TH",
  nguoiLonTraLoiHo: false,
  cauHoi: [{ id: "c1", noiDung: "Câu giả", trongSo: { D: 9 } }],
  khoaBiMat: "KHOA-CHAM",
} as unknown as BoDeDisc;
const chon = vi.fn((_d: { vai: string; bacHoc?: string; namSinh: number; namNay: number }) => boGia as BoDeDisc | null);
const engineGia: DiscEngine = { phienBan: "e", chonBoDe: chon, layBoDe: () => boGia, cham: () => ({ ok: false, lyDo: "BO_DE_KHONG_TON_TAI" }) };

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/disc/bo-de", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
// Đồng hồ hệ thống ĐÓNG BĂNG ở một mốc tuyệt đối (chỉ giả Date — không đụng setTimeout/promise). 03:00Z = 10:00 giờ VN, ngày 01/11/2026.
const MOC = new Date("2026-11-01T03:00:00Z");
const namNay = 2026;

const env0 = { ...process.env };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MOC);
  process.env.DISC_ENABLED = "true";
  m.rateLimit.mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
  chon.mockClear();
  datEngine(engineGia);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  datEngine(null);
  process.env = { ...env0 };
});

describe("[DISC-API-BODE-01] POST /api/disc/bo-de", () => {
  it("cờ tắt ⇒ 404 rỗng, không rate-limit, không chạm engine", async () => {
    delete process.env.DISC_ENABLED;
    const r = await POST(req({ vai: "PH", namSinh: namNay - 38 }));
    expect(r.status).toBe(404);
    expect(m.rateLimit).not.toHaveBeenCalled();
    expect(chon).not.toHaveBeenCalled();
  });
  it("chưa có engine ⇒ 503 ENGINE_CHUA_SAN_SANG", async () => {
    datEngine(null);
    const r = await POST(req({ vai: "PH", namSinh: namNay - 38 }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, loi: "ENGINE_CHUA_SAN_SANG" });
  });
  it("hợp lệ ⇒ 200 no-store, bộ đề đã LỌC (không rò trọng số), engine nhận namNay theo giờ VN", async () => {
    const r = await POST(req({ vai: "HS", bacHoc: "4", namSinh: namNay - 10 }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const b = await r.json();
    expect(b).toEqual({ ok: true, boDe: { ma: "HS-GIA", phienBan: "gia-1", doiTuong: "TH", nguoiLonTraLoiHo: false, cauHoi: [{ id: "c1", noiDung: "Câu giả" }] } });
    expect(JSON.stringify(b)).not.toMatch(/trongSo|KHOA-CHAM/);
    expect(chon.mock.calls[0]![0]).toMatchObject({ vai: "HS", bacHoc: "4", namNay });
  });
  it.each([
    ["vai lạ", { vai: "GV", namSinh: 1990 }],
    ["học sinh thiếu bậc học", { vai: "HS", namSinh: 2016 }],
    ["bậc học lạ", { vai: "HS", bacHoc: "13", namSinh: 2016 }],
    ["năm sinh không nguyên", { vai: "PH", namSinh: 1988.5 }],
    ["năm sinh ở tương lai", { vai: "PH", namSinh: 9999 }],
    ["năm sinh quá xa", { vai: "PH", namSinh: 1800 }],
    ["thiếu năm sinh", { vai: "PH" }],
  ])("%s ⇒ 400, không chạm engine", async (_t, body) => {
    const r = await POST(req(body));
    expect(r.status).toBe(400);
    expect(chon).not.toHaveBeenCalled();
  });
  it("engine không có bộ đề phù hợp ⇒ 400 (không lộ lý do)", async () => {
    chon.mockReturnValueOnce(null);
    expect((await POST(req({ vai: "PH", namSinh: namNay - 38 }))).status).toBe(400);
  });
  it("JSON hỏng ⇒ 400; body quá trần ⇒ 413; vượt giới hạn IP ⇒ 429", async () => {
    expect((await POST(req("{khong-phai-json"))).status).toBe(400);
    expect((await POST(req({ vai: "PH", namSinh: 1988, rac: "x".repeat(3000) }))).status).toBe(413);
    m.rateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 0 });
    expect((await POST(req({ vai: "PH", namSinh: namNay - 38 }))).status).toBe(429);
  });
  it("hạ tầng chặn tần suất ném ⇒ 503 chung, không rò", async () => {
    m.rateLimit.mockRejectedValueOnce(new Error("redis boom"));
    const r = await POST(req({ vai: "PH", namSinh: namNay - 38 }));
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toMatch(/redis/);
  });
});

describe("[DISC-API-BODE-02] năm hiện tại đọc ở MỘT điểm đầu route (now), theo giờ VN", () => {
  it("23:59 ngày 31/12 giờ VN vẫn là năm cũ; qua nửa đêm giờ VN là năm mới — bộ đề và kiểm năm sinh dùng CÙNG một mốc", async () => {
    vi.setSystemTime(new Date("2026-12-31T16:59:00Z")); // 23:59 VN 31/12/2026
    expect((await POST(req({ vai: "PH", namSinh: 2026 - 38 }))).status).toBe(200);
    expect(chon.mock.calls.at(-1)![0].namNay).toBe(2026);
    expect((await POST(req({ vai: "PH", namSinh: 2027 }))).status).toBe(400); // năm sinh ở tương lai so với 2026
    vi.setSystemTime(new Date("2026-12-31T17:01:00Z")); // 00:01 VN 01/01/2027
    expect((await POST(req({ vai: "PH", namSinh: 2027 }))).status).toBe(200);
    expect(chon.mock.calls.at(-1)![0].namNay).toBe(2027);
  });
});
