import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dữ liệu GIẢ. Chống lạm dụng ở route /api/disc/luu: S-04 (IPv6 /64 + trần toàn cục), S-06 (đếm SĐT sau zod), S-11 (đọc luồng).
const m = vi.hoisted(() => ({
  taoHoacLayTheoKhoa: vi.fn(),
  xoayTokenTai: vi.fn(),
  demTheoPhone: vi.fn(),
  rateLimit: vi.fn(),
  denNguong: vi.fn(),
  crm: vi.fn(),
  guiLinkXacMinh: vi.fn(),
}));
vi.mock("@/lib/disc/crm-that", () => ({ congCrmThat: m.crm }));
vi.mock("@/lib/disc/email-prisma", () => ({ emailStore: {}, xepThuThat: vi.fn(), gioiHanEmailThat: {} }));
vi.mock("@/lib/disc/email", async (orig) => ({ ...(await orig<typeof import("@/lib/disc/email")>()), guiLinkXacMinh: m.guiLinkXacMinh }));
vi.mock("@/lib/disc/store-prisma", () => ({ discStore: { taoHoacLayTheoKhoa: m.taoHoacLayTheoKhoa, xoayTokenTai: m.xoayTokenTai, demTheoPhone: m.demTheoPhone } }));
vi.mock("@/lib/disc/engine-dang-ky", () => ({ ensureDiscEngine: () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));
vi.mock("@/lib/security/dong-deu-thoi-gian", () => ({ phuThuocThoiGianThat: () => ({ now: () => new Date() }), denNguongThoiGian: m.denNguong }));

import { datEngine, type DiscEngine } from "@/lib/disc/engine";
import { POST } from "./route";

const engineGia: DiscEngine = {
  phienBan: "engine-GIA-1",
  chonBoDe: ({ vai }) => ({ ma: vai === "PH" ? "PH-GIA" : "HS-GIA", phienBan: "g", doiTuong: vai === "PH" ? "PH" : "TH", nguoiLonTraLoiHo: false, cauHoi: [] }),
  layBoDe: () => null,
  cham: (ma, tl) => ({ ok: true, ketQua: { diem: { D: Object.values(tl).reduce((a, b) => a + b, 0), I: 1, S: 2, C: 3 }, maBoDe: ma, phienBanBoDe: "g" } }),
};
const payload = (o: Record<string, unknown> = {}) => ({
  idempotencyKey: "khoa-ngau-nhien-0123456789", // gitleaks:allow
  soDienThoai: "0905 123 456",
  email: null,
  dongY: { xuLyHoSo: true, tiepThi: false },
  phuHuynh: { hoTen: "Nguyễn Thị Mai", vaiTro: "ME", namSinh: 1988 },
  hocSinh: { hoTen: "Trần Bảo Minh", namSinh: 2016, bacHoc: "4" },
  bai: { phuHuynh: { maBoDe: "PH-GIA", traLoi: { q1: 3 } }, hocSinh: { maBoDe: "HS-GIA", traLoi: { q1: 1 } } },
  ...o,
});
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/disc/luu", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const khoaDem = () => m.rateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);

const env0 = { ...process.env };
beforeEach(() => {
  process.env.DISC_ENABLED = "true";
  process.env.NEXTAUTH_SECRET = "n".repeat(40);
  m.rateLimit.mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
  m.taoHoacLayTheoKhoa.mockImplementation(async (d: { phoneKey: string; emailStatus: string; emailTo: string | null }) => ({
    ban: { id: "s1", phoneKey: d.phoneKey, emailStatus: d.emailStatus, emailTo: d.emailTo, claimStatus: "PENDING_CLAIM", payloadHash: "x", deletedAt: null, retainUntil: new Date("2099-01-01T00:00:00Z") },
    taoMoi: true,
  }));
  m.xoayTokenTai.mockResolvedValue(true);
  m.demTheoPhone.mockResolvedValue({ theoCap: 0, theoPhone: 0 });
  m.denNguong.mockResolvedValue(false);
  m.crm.mockResolvedValue({ leadId: "L1" });
  m.guiLinkXacMinh.mockResolvedValue({ ok: true });
  for (const k of ["NEXTAUTH_URL", "AUTH_URL", "NEXT_PUBLIC_APP_URL", "DISC_PEPPER"]) delete process.env[k];
  datEngine(engineGia);
});
afterEach(() => {
  datEngine(null);
  vi.clearAllMocks();
  process.env = { ...env0 };
});

describe("[DISC-API-LUU-S04] IPv6 gộp /64 + cầu chì toàn cục", () => {
  it("hai IPv6 khác nhau trong CÙNG /64 ⇒ CÙNG khoá IP và CÙNG khoá cặp (xoay địa chỉ trong /64 không mở thêm trần)", async () => {
    await POST(req(payload(), { "x-forwarded-for": "2001:db8:1:2:aaaa::1" }));
    const a = khoaDem();
    m.rateLimit.mockClear();
    await POST(req(payload(), { "x-forwarded-for": "2001:db8:1:2:bbbb::ffff" }));
    expect(khoaDem()).toEqual(a);
    expect(a[0]).toMatch(/^disc:luu:ip:/);
    expect(a[0]).toContain("v6/64:2001:db8:1:2");
    m.rateLimit.mockClear();
    await POST(req(payload(), { "x-forwarded-for": "2001:db8:1:3::1" })); // /64 khác
    expect(khoaDem()[0]).not.toBe(a[0]);
    expect(khoaDem()[1]).not.toBe(a[1]);
  });
  it("IPv4 giữ nguyên khoá (không đổi hành vi cũ)", async () => {
    await POST(req(payload(), { "x-forwarded-for": "203.0.113.9" }));
    expect(khoaDem()[0]).toBe("disc:luu:ip:203.0.113.9");
  });
  it("cầu chì toàn cục: bài hợp lệ tiêu 1 lượt khoá cố định (đứng SAU trần cặp và trần SĐT)", async () => {
    const r = await POST(req(payload()));
    expect(r.status).toBe(200);
    const k = khoaDem();
    expect(k).toHaveLength(4);
    expect(k[3]).toBe("disc:luu:toan-cuc:ngay");
    expect(k.join()).not.toMatch(/905123456/);
  });
  it("chạm trần toàn cục ⇒ 503 LUU_THAT_BAI Y HỆT lỗi lưu chung (không lộ lý do), KHÔNG ghi gì", async () => {
    m.rateLimit.mockImplementation(async ({ key }: { key: string }) => ({ success: key !== "disc:luu:toan-cuc:ngay", remaining: 0, resetAt: 0 }));
    const r = await POST(req(payload()));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(m.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
    expect(m.crm).not.toHaveBeenCalled();
  });
  it("trần toàn cục lấy từ env DISC_TRAN_BAI_MOI_NGAY", async () => {
    process.env.DISC_TRAN_BAI_MOI_NGAY = "17";
    await POST(req(payload()));
    const lanToanCuc = m.rateLimit.mock.calls.map((c) => c[0] as { key: string; max: number }).find((c) => c.key === "disc:luu:toan-cuc:ngay");
    expect(lanToanCuc?.max).toBe(17);
  });
});

describe("[DISC-API-LUU-S06] bộ đếm theo SĐT chỉ tăng SAU khi body qua zod", () => {
  it("body sai hình dạng nhưng có SĐT hợp lệ ⇒ 400 và KHÔNG tiêu trần cặp / trần SĐT / toàn cục (chỉ trần IP)", async () => {
    const r = await POST(req({ soDienThoai: "0905 123 456", rac: true }));
    expect(r.status).toBe(400);
    expect(khoaDem()).toEqual([expect.stringMatching(/^disc:luu:ip:/)]);
  });
  it("30 body sai kèm SĐT nạn nhân không làm hết hạn mức của nạn nhân (bộ đếm giả có trạng thái)", async () => {
    const dem = new Map<string, number>();
    m.rateLimit.mockImplementation(async ({ key, max }: { key: string; max: number }) => {
      const n = (dem.get(key) ?? 0) + 1;
      dem.set(key, n);
      return { success: n <= max, remaining: 0, resetAt: 0 };
    });
    for (let i = 0; i < 40; i++) await POST(req({ soDienThoai: "0905 123 456", sai: i }, { "x-forwarded-for": `198.51.100.${i + 1}` }));
    const nanNhan = await POST(req(payload(), { "x-forwarded-for": "203.0.113.50" }));
    expect(nanNhan.status).toBe(200);
  });
  it("đối chứng dương: body ĐÚNG hình dạng thì có tiêu trần cặp + SĐT", async () => {
    await POST(req(payload()));
    expect(khoaDem().some((k) => k.startsWith("disc:luu:cap:"))).toBe(true);
    expect(khoaDem().some((k) => k.startsWith("disc:luu:sdt:"))).toBe(true);
  });
});

describe("[DISC-API-LUU-S11] đọc body theo luồng", () => {
  it("body chunked KHÔNG khai Content-Length, vượt trần ⇒ 413 và luồng bị HUỶ (không đọc hết)", async () => {
    let i = 0;
    let daHuy = false;
    const chunk = new Uint8Array(8 * 1024).fill(0x61);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i++ < 5000) c.enqueue(chunk);
        else c.close();
      },
      cancel() {
        daHuy = true;
      },
    });
    const r = await POST(new Request("http://localhost/api/disc/luu", { method: "POST", body: stream, duplex: "half" } as RequestInit));
    expect(r.status).toBe(413);
    expect(daHuy).toBe(true);
    expect(i).toBeLessThan(100);
    expect(m.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
});
