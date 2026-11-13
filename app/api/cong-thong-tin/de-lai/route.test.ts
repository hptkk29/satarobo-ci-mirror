// @vitest-environment node
/**
 * [CTT-RT-*] POST /api/cong-thong-tin/de-lai — lớp HTTP (lead + giới hạn tần suất được giả; không DB, không Upstash).
 *   [CTT-RT-01] cờ: cả hai tắt ⇒ 404; phiếu của tính năng đang TẮT ⇒ 404 dù cờ kia bật
 *   [CTT-RT-02] phiếu hợp lệ ⇒ 200 + cookie sr_ctt httpOnly mang thẻ KIỂM ĐƯỢC; lead được tạo MỘT lần với đúng phiếu
 *   [CTT-RT-03] ô bẫy ⇒ 200 GIẢ: không tạo lead, không đặt thẻ
 *   [CTT-RT-04] phiếu sai ⇒ 400 + lỗi đúng trường, không tạo lead, không đặt thẻ; JSON hỏng ⇒ 400; body quá lớn ⇒ 413
 *   [CTT-RT-05] chạm trần tần suất (IP · cặp · SĐT) ⇒ 429, không tạo lead
 *   [CTT-RT-06] lỗi hạ tầng ⇒ 503 chung, KHÔNG lộ thông điệp lỗi/SĐT, không đặt thẻ
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rateLimit: vi.fn(), taoLead: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));
vi.mock("@/lib/cong-thong-tin/tao-lead", () => ({ taoLeadTuCong: m.taoLead }));

import { COOKIE_MO_KHOA, kiemTheMoKhoa } from "@/lib/cong-thong-tin/the-mo-khoa";
import { POST } from "./route";

const KHOA = "r".repeat(48);
const OK = {
  hoTen: "Nguyễn Thị Lan",
  soDienThoai: "0905123456",
  thanhPho: "Tp Đà Nẵng",
  phuong: "Phường Hải Châu",
  soNha: null,
  dongY: { xuLyHoSo: true, tiepThi: false },
  nguon: "tu-sach",
  nguCanh: "ebook:3",
};
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/cong-thong-tin/de-lai", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
const cookie = (r: Response) => r.headers.get("set-cookie") ?? "";

const env0 = { ...process.env };
beforeEach(() => {
  process.env.TU_SACH_ENABLED = "true";
  delete process.env.SUC_KHOE_ENABLED;
  process.env.NEXTAUTH_SECRET = KHOA;
  m.rateLimit.mockReset().mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
  m.taoLead.mockReset().mockResolvedValue({ leadId: "lead-1", laLeadMoi: true });
});
afterEach(() => {
  process.env = { ...env0 };
});

describe("[CTT-RT-01] cờ", () => {
  it("cả hai tắt ⇒ 404 không thân, không chạm lead", async () => {
    delete process.env.TU_SACH_ENABLED;
    const r = await POST(req(OK));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
    expect(m.taoLead).not.toHaveBeenCalled();
  });
  it("chỉ Tủ sách bật: phiếu suc-khoe ⇒ 404; phiếu tu-sach ⇒ 200", async () => {
    expect((await POST(req({ ...OK, nguon: "suc-khoe" }))).status).toBe(404);
    expect(m.taoLead).not.toHaveBeenCalled();
    expect((await POST(req(OK))).status).toBe(200);
  });
  it("chỉ Sức khỏe bật: phiếu tu-sach ⇒ 404; phiếu suc-khoe ⇒ 200", async () => {
    delete process.env.TU_SACH_ENABLED;
    process.env.SUC_KHOE_ENABLED = "true";
    expect((await POST(req(OK))).status).toBe(404);
    expect((await POST(req({ ...OK, nguon: "suc-khoe", nguCanh: null }))).status).toBe(200);
  });
  it('"TRUE"/"1" KHÔNG bật cờ', async () => {
    process.env.TU_SACH_ENABLED = "TRUE";
    expect((await POST(req(OK))).status).toBe(404);
  });
});

describe("[CTT-RT-02] thành công", () => {
  it("200 + cookie httpOnly mang thẻ hợp lệ + lead tạo một lần với phiếu đã chuẩn hoá", async () => {
    const r = await POST(req(OK));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const c = cookie(r);
    expect(c).toContain(`${COOKIE_MO_KHOA}=`);
    expect(c.toLowerCase()).toContain("httponly");
    expect(c.toLowerCase()).toContain("samesite=lax");
    const the = decodeURIComponent(c.split(`${COOKIE_MO_KHOA}=`)[1]!.split(";")[0]!);
    expect(kiemTheMoKhoa(the, { bayGio: new Date(), khoa: KHOA })).toMatchObject({ ok: true, nguon: "tu-sach" });
    expect(m.taoLead).toHaveBeenCalledTimes(1);
    expect(m.taoLead.mock.calls[0]![0]).toMatchObject({ soDienThoai: "84905123456", nguon: "tu-sach", diaChi: { phuong: "Phường Hải Châu" } });
  });
  it("phản hồi KHÔNG đổi giữa SĐT mới và SĐT đã là lead (không oracle)", async () => {
    const moi = await (await POST(req(OK))).json();
    m.taoLead.mockResolvedValue({ leadId: "lead-cu", laLeadMoi: false });
    const cu = await (await POST(req(OK))).json();
    expect(cu).toEqual(moi);
  });
});

describe("[CTT-RT-03] ô bẫy", () => {
  it("200 giả: không lead, không thẻ", async () => {
    const r = await POST(req({ ...OK, bay: "http://spam.example" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(cookie(r)).toBe("");
    expect(m.taoLead).not.toHaveBeenCalled();
  });
});

describe("[CTT-RT-04] phiếu sai", () => {
  it("thiếu phường ⇒ 400 lỗi đúng trường, không lead, không thẻ", async () => {
    const r = await POST(req({ ...OK, phuong: "" }));
    expect(r.status).toBe(400);
    const b = await r.json();
    expect(b.ok).toBe(false);
    expect(b.loi.map((l: { truong: string }) => l.truong)).toContain("phuong");
    expect(cookie(r)).toBe("");
    expect(m.taoLead).not.toHaveBeenCalled();
  });
  it("JSON hỏng ⇒ 400; body quá lớn ⇒ 413", async () => {
    expect((await POST(req("{khong-phai-json"))).status).toBe(400);
    expect((await POST(req(JSON.stringify({ ...OK, hoTen: "x".repeat(20_000) })))).status).toBe(413);
    expect(m.taoLead).not.toHaveBeenCalled();
  });
});

describe("[CTT-RT-05] tần suất", () => {
  it.each([[1], [2], [3]])("lượt thứ %i của rateLimit bị chặn ⇒ 429, không lead", async (lan) => {
    let n = 0;
    m.rateLimit.mockImplementation(async () => ({ success: ++n !== lan, remaining: 0, resetAt: 0 }));
    const r = await POST(req(OK));
    expect(r.status).toBe(429);
    expect(m.taoLead).not.toHaveBeenCalled();
    expect(cookie(r)).toBe("");
  });
  it("khoá tần suất KHÔNG chứa SĐT thô", async () => {
    await POST(req(OK));
    const khoa = m.rateLimit.mock.calls.map((c) => (c[0] as { key: string }).key).join(" ");
    expect(khoa).not.toMatch(/0905123456|84905123456/);
  });
});

describe("[CTT-RT-06] lỗi hạ tầng", () => {
  it("503 chung, không lộ lỗi/SĐT, không thẻ", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.taoLead.mockRejectedValue(Object.assign(new Error("duplicate key value (phone)=(84905123456)"), { code: "XYZ" }));
    const r = await POST(req(OK));
    expect(r.status).toBe(503);
    const s = JSON.stringify(await r.json()) + cookie(r);
    expect(s).not.toMatch(/84905123456|duplicate|XYZ/);
    expect(cookie(r)).toBe("");
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/84905123456|0905123456|Nguyễn/);
    log.mockRestore();
  });
});
