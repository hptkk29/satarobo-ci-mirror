import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mọi dữ liệu là GIẢ. Không DB thật, không Upstash thật.
const m = vi.hoisted(() => ({
  taoHoacLayTheoKhoa: vi.fn(),
  xoayTokenTai: vi.fn(),
  demTheoPhone: vi.fn(),
  rateLimit: vi.fn(),
  denNguong: vi.fn(),
  crm: vi.fn(),
  guiLinkXacMinh: vi.fn(),
  emailStoreGia: { id: "emailStore-gia" },
  xepThuGia: vi.fn(),
  gioiHanGia: { theoDiaChi: vi.fn(), theoBai: vi.fn() },
}));
// CRM thật + hàng đợi email thật chạm DB/Redis/cookies: thay bằng bản giả có tên để kiểm DÂY NỐI (route đưa đúng thứ vào đúng chỗ).
vi.mock("@/lib/disc/crm-that", () => ({ congCrmThat: m.crm }));
vi.mock("@/lib/disc/email-prisma", () => ({ emailStore: m.emailStoreGia, xepThuThat: m.xepThuGia, gioiHanEmailThat: m.gioiHanGia }));
vi.mock("@/lib/disc/email", async (orig) => ({ ...(await orig<typeof import("@/lib/disc/email")>()), guiLinkXacMinh: m.guiLinkXacMinh }));
vi.mock("@/lib/disc/store-prisma", () => ({ discStore: { taoHoacLayTheoKhoa: m.taoHoacLayTheoKhoa, xoayTokenTai: m.xoayTokenTai, demTheoPhone: m.demTheoPhone } }));
// Route test dùng engine GIẢ qua datEngine: ensureDiscEngine() (đăng ký engine thật) không được ghi đè nó.
// Engine thật được kiểm ở tests/disc-engine và tests/disc-engine/route-engine-that.test.ts.
vi.mock("@/lib/disc/engine-dang-ky", () => ({ ensureDiscEngine: () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));
// F-12: sàn thời gian thật chờ ≥700 ms/ca — thay bằng bản ghi nhận để khẳng định route GỌI nó, không chờ thật.
vi.mock("@/lib/security/dong-deu-thoi-gian", () => ({ phuThuocThoiGianThat: () => ({ now: () => new Date() }), denNguongThoiGian: m.denNguong }));

import { datEngine, type DiscEngine } from "@/lib/disc/engine";
import { POST } from "./route";

const TRAN_BODY_BYTE = 64 * 1024; // phải trùng hằng cùng tên trong route.ts

const engineGia: DiscEngine = {
  phienBan: "engine-GIA-1",
  chonBoDe: ({ vai }) => ({ ma: vai === "PH" ? "PH-GIA" : "HS-GIA", phienBan: "g", doiTuong: vai === "PH" ? "PH" : "TH", nguoiLonTraLoiHo: false, cauHoi: [] }),
  layBoDe: () => null,
  cham: (ma, tl) => ({ ok: true, ketQua: { diem: { D: Object.values(tl).reduce((a, b) => a + b, 0), I: 1, S: 2, C: 3 }, maBoDe: ma, phienBanBoDe: "g" } }),
};

const payload = (o: Record<string, unknown> = {}) => ({
  idempotencyKey: "khoa-ngau-nhien-0123456789",  // gitleaks:allow
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

const env0 = { ...process.env };
beforeEach(() => {
  process.env.DISC_ENABLED = "true";
  process.env.NEXTAUTH_SECRET = "n".repeat(40);
  delete process.env.DISC_TEST_TRUST_CLIENT_SCORES;
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
  for (const k of ["NEXTAUTH_URL", "AUTH_URL", "NEXT_PUBLIC_APP_URL"]) delete process.env[k];
  datEngine(engineGia);
});
afterEach(() => {
  datEngine(null);
  vi.clearAllMocks();
  process.env = { ...env0 };
});

describe("[DISC-API-LUU-01] cổng và giới hạn", () => {
  it("cờ DISC_ENABLED tắt ⇒ 404 TRƯỚC mọi việc (không rate-limit, không đọc body, không ghi)", async () => {
    delete process.env.DISC_ENABLED;
    const r = await POST(req(payload()));
    expect(r.status).toBe(404);
    expect(m.rateLimit).not.toHaveBeenCalled();
    expect(m.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("vượt giới hạn IP ⇒ 429, không ghi", async () => {
    m.rateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 0 });
    const r = await POST(req(payload()));
    expect(r.status).toBe(429);
    expect(m.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("vượt giới hạn theo CẶP (SĐT, IP) ⇒ 429; khoá đếm KHÔNG chứa SĐT thô lẫn IP thô", async () => {
    m.rateLimit.mockResolvedValueOnce({ success: true, remaining: 1, resetAt: 0 }).mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 0 });
    const r = await POST(req(payload(), { "x-forwarded-for": "203.0.113.9" }));
    expect(r.status).toBe(429);
    const khoa = m.rateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(khoa).toHaveLength(2); // chưa tiêu trần cứng
    expect(khoa[0]).toMatch(/^disc:luu:ip:/);
    expect(khoa[1]).toMatch(/^disc:luu:cap:[0-9a-f]{24}:[0-9a-f]{24}$/);
    expect(khoa[1]).not.toContain("203.0.113.9");
    expect(khoa.join()).not.toMatch(/905123456/);
    expect(m.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("[N6] vượt TRẦN CỨNG theo SĐT ⇒ phản hồi Y HỆT lỗi lưu chung (503 LUU_THAT_BAI), KHÔNG phải 429", async () => {
    m.rateLimit
      .mockResolvedValueOnce({ success: true, remaining: 1, resetAt: 0 })
      .mockResolvedValueOnce({ success: true, remaining: 1, resetAt: 0 })
      .mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 0 });
    const r = await POST(req(payload()));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    const khoa = m.rateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(khoa[2]).toMatch(/^disc:luu:sdt:[0-9a-f]{24}$/);
    expect(m.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("[N6] kẻ gõ SĐT nạn nhân đủ 5 lần từ IP-X KHÔNG khoá chủ số lưu từ IP-Y (bộ đếm giả có trạng thái theo khoá)", async () => {
    const dem = new Map<string, number>();
    m.rateLimit.mockImplementation(async ({ key, max }: { key: string; max: number }) => {
      const n = (dem.get(key) ?? 0) + 1;
      dem.set(key, n);
      return { success: n <= max, remaining: 0, resetAt: 0 };
    });
    for (let i = 0; i < 5; i++) expect((await POST(req(payload({ idempotencyKey: `khoa-xau-${i}-0123456789abcd` }), { "x-forwarded-for": "203.0.113.9" }))).status).toBe(200);
    expect((await POST(req(payload({ idempotencyKey: "khoa-xau-6-0123456789abcd" }), { "x-forwarded-for": "203.0.113.9" }))).status).toBe(429);  // gitleaks:allow
    const chuSo = await POST(req(payload({ idempotencyKey: "khoa-that-0123456789abcdef" }), { "x-forwarded-for": "198.51.100.7" }));  // gitleaks:allow
    expect(chuSo.status).toBe(200);
  });
  it("Content-Length khai báo quá trần ⇒ 413 (chưa đọc body)", async () => {
    const r = await POST(req(payload(), { "content-length": String(TRAN_BODY_BYTE + 1) }));
    expect(r.status).toBe(413);
    expect(m.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("body thật quá trần dù không khai Content-Length ⇒ 413", async () => {
    const r = await POST(req(JSON.stringify({ rac: "x".repeat(TRAN_BODY_BYTE) })));
    expect(r.status).toBe(413);
  });
  it("JSON hỏng ⇒ 400", async () => {
    expect((await POST(req("{khong-phai-json"))).status).toBe(400);
  });
});

describe("[DISC-API-LUU-03] lưới thứ hai khi bộ đếm tần suất không chặn được (Upstash chết / fail-open)", () => {
  it("rateLimit LUÔN cho qua nhưng DB đã có 5 bài của CẶP (SĐT, IP) ⇒ 429 QUA_NHIEU_YEU_CAU, không tạo dòng", async () => {
    m.rateLimit.mockResolvedValue({ success: true, remaining: 99, resetAt: 0 });
    m.demTheoPhone.mockResolvedValue({ theoCap: 5, theoPhone: 5 });
    const r = await POST(req(payload()));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ ok: false, loi: "QUA_NHIEU_YEU_CAU" });
    expect(m.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("phát lại cùng khoá nhưng KHÁC nội dung ⇒ 503 LUU_THAT_BAI chung, không xoay token", async () => {
    m.taoHoacLayTheoKhoa.mockImplementationOnce(async (d: { phoneKey: string }) => ({
      ban: { id: "s1", phoneKey: d.phoneKey, emailStatus: "NONE", emailTo: null, claimStatus: "PENDING_CLAIM", payloadHash: "hash-cua-noi-dung-khac", deletedAt: null, retainUntil: new Date("2099-01-01T00:00:00Z") },
      taoMoi: false,
    }));
    const r = await POST(req(payload()));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(m.xoayTokenTai).not.toHaveBeenCalled();
  });
});

describe("[DISC-API-LUU-06] N6/F-12 trần cứng, IP băm, sàn thời gian", () => {
  it("[N6] trần cứng DB (30 bài/SĐT ở mọi IP) ⇒ 503 LUU_THAT_BAI chung; IP thô KHÔNG tới store, chỉ ipKey HMAC", async () => {
    m.demTheoPhone.mockResolvedValue({ theoCap: 0, theoPhone: 30 });
    const r = await POST(req(payload(), { "x-forwarded-for": "203.0.113.9" }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    const [pk, ik] = m.demTheoPhone.mock.calls[0]!;
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
    expect(ik).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(m.demTheoPhone.mock.calls)).not.toContain("203.0.113.9");
  });
  it("[N6] bản ghi lưu mang ipKey + pepperVersion; không có IP thô", async () => {
    await POST(req(payload(), { "x-forwarded-for": "203.0.113.9" }));
    const d = m.taoHoacLayTheoKhoa.mock.calls[0]![0];
    expect(d.ipKey).toMatch(/^[0-9a-f]{64}$/);
    expect(d.pepperVersion).toBe("ns0"); // test không đặt DISC_PEPPER
    expect(JSON.stringify(d)).not.toContain("203.0.113.9");
  });
  it("[F-12] sàn thời gian được áp cho MỌI nhánh sau khi đọc body: ok · lỗi hạ tầng · JSON hỏng · replay sai · trần cặp", async () => {
    await POST(req(payload()));
    expect(m.denNguong).toHaveBeenCalledTimes(1);
    expect(m.denNguong.mock.calls[0]![2]).toBe("disc-luu");
    m.denNguong.mockClear();

    await POST(req("{khong-phai-json"));
    expect(m.denNguong).toHaveBeenCalledTimes(1);
    m.denNguong.mockClear();

    m.demTheoPhone.mockResolvedValueOnce({ theoCap: 5, theoPhone: 5 });
    expect((await POST(req(payload()))).status).toBe(429);
    expect(m.denNguong).toHaveBeenCalledTimes(1);
    m.denNguong.mockClear();

    m.taoHoacLayTheoKhoa.mockRejectedValueOnce(new Error("db"));
    expect((await POST(req(payload()))).status).toBe(503);
    expect(m.denNguong).toHaveBeenCalledTimes(1);
    m.denNguong.mockClear();

    m.rateLimit.mockRejectedValueOnce(new Error("upstash"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(req(payload()))).status).toBe(503);
    expect(m.denNguong).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it("[F-12] KHÔNG áp sàn cho cổng trước-body (cờ tắt · IP 429 · 413): chúng không phân biệt gì về SĐT", async () => {
    m.rateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 0 });
    await POST(req(payload()));
    await POST(req(payload(), { "content-length": String(TRAN_BODY_BYTE + 1) }));
    delete process.env.DISC_ENABLED;
    await POST(req(payload()));
    expect(m.denNguong).not.toHaveBeenCalled();
  });
});

describe("[DISC-API-LUU-02] đường lưu", () => {
  it("thành công: 200, no-store, trả submissionId/tokenTai/maNhan; server tự chấm; store chỉ nhận hash", async () => {
    const r = await POST(req(payload()));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const b = await r.json();
    expect(b).toMatchObject({ ok: true, submissionId: "s1" });
    expect(b.maNhan).toMatch(/^[2-9A-HJ-NP-Z]{10}$/);
    expect(b.tokenTai.length).toBeGreaterThan(20);
    const goi = m.taoHoacLayTheoKhoa.mock.calls[0]![0];
    expect(goi.nguoi[0].ketQua.diem.D).toBe(3);
    expect(JSON.stringify(goi)).not.toContain(b.maNhan);
    expect(JSON.stringify(goi)).not.toContain(b.tokenTai);
  });
  it("điểm client gửi kèm bị bỏ qua ở production-like (không có cổng thử nghiệm)", async () => {
    const r = await POST(req(payload({ ketQua: { engineVersion: "x", phuHuynh: { diem: { D: 99, I: 99, S: 99, C: 99 }, maBoDe: "PH-GIA", phienBanBoDe: "g" }, hocSinh: { diem: { D: 99, I: 99, S: 99, C: 99 }, maBoDe: "HS-GIA", phienBanBoDe: "g" } } })));
    expect(r.status).toBe(200);
    expect(m.taoHoacLayTheoKhoa.mock.calls[0]![0].nguoi[0].ketQua.diem.D).toBe(3);
  });
  it("chưa có engine ⇒ 503 ENGINE_CHUA_SAN_SANG, không ghi (kể cả khi client gửi điểm)", async () => {
    datEngine(null);
    const diem = { D: 1, I: 1, S: 1, C: 1 };
    const r = await POST(req(payload({ ketQua: { engineVersion: "x", phuHuynh: { diem, maBoDe: "a", phienBanBoDe: "b" }, hocSinh: { diem, maBoDe: "a", phienBanBoDe: "b" } } })));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, loi: "ENGINE_CHUA_SAN_SANG" });
    expect(m.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("dữ liệu sai ⇒ 400 kèm chiTiet", async () => {
    const r = await POST(req(payload({ soDienThoai: "123" })));
    expect(r.status).toBe(400);
    expect((await r.json()).loi).toBe("DU_LIEU_KHONG_HOP_LE");
  });
  it("lỗi hạ tầng ⇒ 503 chung, KHÔNG lộ chi tiết lỗi gốc, KHÔNG log body", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m.taoHoacLayTheoKhoa.mockRejectedValueOnce(new Error("password authentication failed for user minh-gia"));
    const r = await POST(req(payload()));
    expect(r.status).toBe(503);
    const txt = JSON.stringify(await r.json());
    expect(txt).toBe(JSON.stringify({ ok: false, loi: "LUU_THAT_BAI" }));
    const log = JSON.stringify(spy.mock.calls);
    expect(log).not.toMatch(/Mai|Minh|0905|password/);
    spy.mockRestore();
  });
  it("hạ tầng chặn tần suất ném ⇒ 503 chung, không rò", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m.rateLimit.mockRejectedValueOnce(new Error("redis boom"));
    const r = await POST(req(payload()));
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toMatch(/redis/);
    spy.mockRestore();
  });
  it("không phân biệt SĐT: hai SĐT khác nhau ⇒ cùng status và cùng tập khoá phản hồi", async () => {
    const a = await POST(req(payload()));
    const b = await POST(req(payload({ soDienThoai: "0912345678", idempotencyKey: "khoa-khac-0123456789ab" })));  // gitleaks:allow
    expect(a.status).toBe(b.status);
    const ka = Object.keys(await a.json()).sort();
    const kb = Object.keys(await b.json()).sort();
    expect(ka).toEqual(kb);
  });
});

describe("[DISC-API-LUU-04] dây nối CRM thật", () => {
  it("lưu mới ⇒ cổng CRM THẬT (congCrmThat) được gọi MỘT lần với SĐT chuẩn hoá 84… và KHÔNG có tên con/điểm/năm sinh", async () => {
    const r = await POST(req(payload()));
    expect(r.status).toBe(200);
    expect(m.crm).toHaveBeenCalledTimes(1);
    const d = m.crm.mock.calls[0]![0];
    expect(d).toMatchObject({ submissionId: "s1", soDienThoai: "84905123456", tenPhuHuynh: "Nguyễn Thị Mai", email: null, tiepThi: false });
    expect(Object.keys(d).sort()).toEqual(["chienDich", "diaChi", "email", "soDienThoai", "submissionId", "tenPhuHuynh", "tiepThi"]);
    expect(JSON.stringify(d)).not.toMatch(/Bảo Minh|2016|diem/);
  });
  it("CRM ném ⇒ vẫn 200 (dữ liệu đã an toàn), phản hồi không chứa lỗi CRM", async () => {
    m.crm.mockRejectedValueOnce(new Error("lead down 0905123456"));
    const r = await POST(req(payload()));
    expect(r.status).toBe(200);
    expect(JSON.stringify(await r.json())).not.toMatch(/lead down|0905/);
  });
});

describe("[DISC-API-LUU-05] dây nối email xác minh + thông báo trung thực", () => {
  const coEmail = () => payload({ email: "an@gmail.com" });

  it("không email ⇒ KHÔNG gọi guiLinkXacMinh", async () => {
    process.env.NEXTAUTH_URL = "https://app.example.test";
    expect((await POST(req(payload()))).status).toBe(200);
    expect(m.guiLinkXacMinh).not.toHaveBeenCalled();
  });
  it("có email + có gốc URL ⇒ guiLinkXacMinh nhận gốc từ cấu hình, store/xepThu/gioiHan THẬT (đúng tham chiếu), id bài, và giờ; thông báo 'sẽ gửi liên kết'", async () => {
    process.env.NEXTAUTH_URL = "https://app.example.test/";
    const r = await POST(req(coEmail()));
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(m.guiLinkXacMinh).toHaveBeenCalledTimes(1);
    const p = m.guiLinkXacMinh.mock.calls[0]![0];
    expect(p.submissionId).toBe("s1");
    expect(p.goc).toBe("https://app.example.test");
    expect(p.store).toBe(m.emailStoreGia);
    expect(p.xepThu).toBe(m.xepThuGia);
    expect(p.gioiHan).toBe(m.gioiHanGia);
    expect(p.now).toBeInstanceOf(Date);
    expect(b.thongBao.email).toMatch(/sẽ gửi liên kết xác minh/);
    expect(JSON.stringify(b)).not.toContain("an@gmail.com");
  });
  it("gốc URL KHÔNG lấy từ Host/Origin của request (chống open-redirect)", async () => {
    process.env.NEXTAUTH_URL = "https://app.example.test";
    await POST(req(coEmail(), { host: "ke-tan-cong.example", origin: "https://ke-tan-cong.example", "x-forwarded-host": "ke-tan-cong.example" }));
    expect(m.guiLinkXacMinh.mock.calls[0]![0].goc).toBe("https://app.example.test");
  });
  it("THIẾU gốc URL hợp lệ ⇒ KHÔNG đoán domain, KHÔNG gửi; vẫn 200 + nói 'chưa gửi được liên kết xác minh'", async () => {
    process.env.NEXTAUTH_URL = "http://khong-phai-https.example.test"; // không https, không localhost ⇒ bị bỏ qua
    const r = await POST(req(coEmail()));
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(m.guiLinkXacMinh).not.toHaveBeenCalled();
    expect(b.thongBao.email).toMatch(/chưa gửi được liên kết xác minh/);
    expect(b.thongBao.email).toMatch(/vẫn tải được kết quả/);
    expect(b.thongBao.email).not.toMatch(/đã gửi|sẽ gửi/);
  });
  it.each(["QUA_HAN_MUC", "XEP_HANG_THAT_BAI"] as const)("guiLinkXacMinh trả %s ⇒ 200 + 'chưa gửi được', không hứa", async (loi) => {
    process.env.NEXTAUTH_URL = "https://app.example.test";
    m.guiLinkXacMinh.mockResolvedValueOnce({ ok: false, loi });
    const b = await (await POST(req(coEmail()))).json();
    expect(b.ok).toBe(true);
    expect(b.thongBao.email).toMatch(/chưa gửi được liên kết xác minh/);
    expect(b.thongBao.email).not.toMatch(/đã gửi|sẽ gửi/);
  });
  it("guiLinkXacMinh ném ⇒ vẫn 200 (không làm hỏng việc lưu) + 'chưa gửi được', không lộ lỗi", async () => {
    process.env.NEXTAUTH_URL = "https://app.example.test";
    m.guiLinkXacMinh.mockRejectedValueOnce(new Error("redis boom an@gmail.com"));
    const r = await POST(req(coEmail()));
    expect(r.status).toBe(200);
    const txt = JSON.stringify(await r.json());
    expect(txt).toMatch(/chưa gửi được liên kết xác minh/);
    expect(txt).not.toMatch(/boom|an@gmail/);
  });
  it("lưu thất bại ⇒ KHÔNG gửi email", async () => {
    process.env.NEXTAUTH_URL = "https://app.example.test";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m.taoHoacLayTheoKhoa.mockRejectedValueOnce(new Error("db down"));
    expect((await POST(req(coEmail()))).status).toBe(503);
    expect(m.guiLinkXacMinh).not.toHaveBeenCalled();
    expect(m.crm).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
