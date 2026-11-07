import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dữ liệu GIẢ. Không OTP thật, không DB, không chờ đồng hồ thật.
const m = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  verifyAndConsumeOtp: vi.fn(),
  thuBangMa: vi.fn(),
  denNguong: vi.fn(),
  demBaiKhop: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { discSubmission: { count: m.demBaiKhop } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));
vi.mock("@/lib/otp/service", () => ({ verifyAndConsumeOtp: m.verifyAndConsumeOtp }));
vi.mock("@/lib/disc/store-prisma", () => ({ maNhanStore: { thuBangMa: m.thuBangMa } }));
// Đồng hồ là thứ route lấy từ `phuThuocThoiGianThat().now` — test thay bằng mốc tuyệt đối (03:00Z ngày 01/11/2026).
const MOC = vi.hoisted(() => new Date("2026-11-01T03:00:00Z"));
vi.mock("@/lib/security/dong-deu-thoi-gian", () => ({ phuThuocThoiGianThat: () => ({ now: () => MOC }), denNguongThoiGian: m.denNguong }));

import { POST } from "./route";

const body = (o: Record<string, unknown> = {}) => ({ soDienThoai: "0905 123 456", otp: "123456", maNhan: "ABCDE-FGHJK", ...o });
const req = (b: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/disc/xoa", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b), headers: { "content-type": "application/json", ...headers } });

const env0 = { ...process.env };
beforeEach(() => {
  process.env.DISC_ENABLED = "true";
  process.env.NEXTAUTH_SECRET = "n".repeat(40);
  m.rateLimit.mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
  m.verifyAndConsumeOtp.mockResolvedValue({ ok: true, otpId: "o1", userId: null });
  m.thuBangMa.mockResolvedValue({ submissionId: "s1" });
  m.denNguong.mockResolvedValue(false);
  m.demBaiKhop.mockResolvedValue(1);
});
afterEach(() => {
  vi.clearAllMocks();
  process.env = { ...env0 };
});

describe("[DISC-API-XOA-01] POST /api/disc/xoa", () => {
  it("cờ tắt ⇒ 404 rỗng TRƯỚC mọi việc", async () => {
    delete process.env.DISC_ENABLED;
    expect((await POST(req(body()))).status).toBe(404);
    expect(m.rateLimit).not.toHaveBeenCalled();
    expect(m.verifyAndConsumeOtp).not.toHaveBeenCalled();
  });
  it("OTP đúng + mã đúng ⇒ 200; OTP kiểm bằng SĐT chuẩn hoá purpose DISC_CLAIM; store nhận phoneKey HMAC + hành động XOA", async () => {
    const r = await POST(req(body()));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(m.verifyAndConsumeOtp).toHaveBeenCalledWith({ target: "84905123456", purpose: "DISC_CLAIM", code: "123456" });
    const t = m.thuBangMa.mock.calls[0]![0];
    expect(t.hanhDong).toEqual({ loai: "XOA" });
    expect(t.phoneKey).toMatch(/^[0-9a-f]{64}$/);
    expect(t.phoneKey).not.toContain("905123456");
  });
  it("khoá đếm theo IP và theo SĐT KHÔNG chứa SĐT", async () => {
    await POST(req(body()));
    const khoa = m.rateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(khoa[0]).toMatch(/^disc:xoa:ip:/);
    expect(khoa[1]).toMatch(/^disc:xoa:sdt:[0-9a-f]{24}$/);
    expect(khoa.join()).not.toMatch(/905123456/);
  });
  it("MỌI thất bại ⇒ CÙNG một phản hồi (400 KHONG_XOA_DUOC): OTP sai · mã sai/khoá/bài số khác · SĐT rác · otp sai định dạng · JSON hỏng", async () => {
    const dung = { status: 400, body: { ok: false, loi: "KHONG_XOA_DUOC" } };
    const ghi: Array<{ status: number; body: unknown }> = [];
    const chay = async (r: Response) => ghi.push({ status: r.status, body: await r.json() });

    m.verifyAndConsumeOtp.mockResolvedValueOnce({ ok: false, error: "Mã không đúng. Còn 2 lần thử.", attemptsLeft: 2 });
    await chay(await POST(req(body())));
    m.thuBangMa.mockResolvedValueOnce(null);
    await chay(await POST(req(body())));
    await chay(await POST(req(body({ soDienThoai: "12345" }))));
    await chay(await POST(req(body({ otp: "12" }))));
    await chay(await POST(req("{khong-json")));
    for (const g of ghi) expect(g).toEqual(dung);
    expect(JSON.stringify(ghi)).not.toMatch(/lần thử|attempts/);
  });
  it("OTP sai ⇒ KHÔNG chạm store xoá; SĐT rác ⇒ không gọi OTP", async () => {
    m.verifyAndConsumeOtp.mockResolvedValueOnce({ ok: false, error: "x" });
    await POST(req(body()));
    expect(m.thuBangMa).not.toHaveBeenCalled();
    m.verifyAndConsumeOtp.mockClear();
    await POST(req(body({ soDienThoai: "12345" })));
    expect(m.verifyAndConsumeOtp).not.toHaveBeenCalled();
  });
  it("các phản hồi sau bước đọc body đều được kéo về sàn thời gian", async () => {
    await POST(req(body()));
    m.thuBangMa.mockResolvedValueOnce(null);
    await POST(req(body()));
    expect(m.denNguong).toHaveBeenCalledTimes(2);
  });
  it("vượt giới hạn IP / SĐT ⇒ 429; body quá trần ⇒ 413; không chạm OTP", async () => {
    m.rateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 0 });
    expect((await POST(req(body()))).status).toBe(429);
    m.rateLimit.mockResolvedValueOnce({ success: true, remaining: 1, resetAt: 0 }).mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 0 });
    expect((await POST(req(body()))).status).toBe(429);
    expect((await POST(req(body({ rac: "x".repeat(3000) })))).status).toBe(413);
    expect(m.verifyAndConsumeOtp).not.toHaveBeenCalled();
  });
  it("lỗi hạ tầng ⇒ 503 chung, không rò chi tiết", async () => {
    m.thuBangMa.mockRejectedValueOnce(new Error("password authentication failed for user minh-gia"));
    const r = await POST(req(body()));
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toMatch(/password|minh-gia/);
  });
});

describe("[DISC-API-XOA-02] đồng hồ tiêm được: MỘT điểm đọc giờ ở đầu route", () => {
  it("`now` của nghiệp vụ (xoaBangMa → store) và mốc bắt đầu của sàn thời gian cùng lấy từ đồng hồ tiêm", async () => {
    await POST(req(body()));
    expect(m.thuBangMa.mock.calls[0]![0].now).toBe(MOC);
    expect(m.denNguong).toHaveBeenCalledTimes(1);
    expect(m.denNguong.mock.calls[0]![1]).toBe(MOC.getTime());
  });
});

describe("[DISC-API-XOA-03] S-05 — phải đúng mã nhận TRƯỚC khi tiêu lượt OTP", () => {
  it("không có bài khớp mã nhận ⇒ 400 chung, KHÔNG gọi OTP, KHÔNG chạm store xoá", async () => {
    m.demBaiKhop.mockResolvedValueOnce(0);
    const r = await POST(req(body()));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, loi: "KHONG_XOA_DUOC" });
    expect(m.verifyAndConsumeOtp).not.toHaveBeenCalled();
    expect(m.thuBangMa).not.toHaveBeenCalled();
    expect(m.denNguong).toHaveBeenCalledTimes(1);
  });
  it("mã nhận hỏng định dạng ⇒ dừng trước OTP và không truy vấn", async () => {
    const r = await POST(req(body({ maNhan: "!!" })));
    expect(r.status).toBe(400);
    expect(m.demBaiKhop).not.toHaveBeenCalled();
    expect(m.verifyAndConsumeOtp).not.toHaveBeenCalled();
  });
  it("cổng đọc đúng bài: PENDING_CLAIM, chưa xoá, còn hạn, dưới ngưỡng thử, theo phoneKey HMAC + mã băm", async () => {
    await POST(req(body()));
    const w = m.demBaiKhop.mock.calls[0]![0].where;
    expect(w.claimStatus).toBe("PENDING_CLAIM");
    expect(w.deletedAt).toBeNull();
    expect(w.retainUntil).toEqual({ gt: MOC });
    expect(w.claimAttempts).toEqual({ lt: 5 });
    expect(w.phoneKey).toMatch(/^[0-9a-f]{64}$/);
    expect(w.claimCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.verifyAndConsumeOtp).toHaveBeenCalledTimes(1);
  });
});
