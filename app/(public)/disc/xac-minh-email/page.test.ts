// @vitest-environment node
/**
 * [DISC-XME-*] Trang xác nhận email DISC (F-07/F-08/F-15). Không DB, không mạng, dữ liệu GIẢ.
 *  · GET chỉ vẽ NÚT — không bao giờ gọi dịch vụ xác minh (trình quét thư/bot mở liên kết bằng GET);
 *  · lỗi MỘT câu chung; siêu dữ liệu noindex + no-referrer; cờ tắt ⇒ 404;
 *  · action: POST mới xác minh, đi qua PRG, token không còn trên URL, mọi thất bại ra cùng một đích.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { boChuThich, docTep } from "../../../../tests/disc/_quet";

class NotFoundGia extends Error {
  readonly digest = "NEXT_NOT_FOUND";
}
class ChuyenHuongGia extends Error {
  constructor(readonly toi: string) {
    super("NEXT_REDIRECT");
  }
}

const M = vi.hoisted(() => ({
  xacMinh: vi.fn(async (_a: { token: unknown; goc: string; now: Date }) => ({ ok: true as boolean, xepBaoCao: true as boolean })),
  rateLimit: vi.fn(async (_a: { key: string; max: number; windowMs: number }) => ({ success: true })),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundGia("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new ChuyenHuongGia(to);
  },
}));
vi.mock("@/lib/disc/email", () => ({ xacMinhEmail: M.xacMinh }));
vi.mock("@/lib/disc/email-prisma", () => ({ emailStore: {}, xepThuThat: async () => ({ ok: true }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: M.rateLimit }));
vi.mock("@/lib/audit/headers", () => ({ getRequestMetadata: async () => ({ ip: "203.0.113.9" }) }));

const cu = { disc: process.env.DISC_ENABLED, url: process.env.NEXTAUTH_URL, auth: process.env.AUTH_URL, app: process.env.NEXT_PUBLIC_APP_URL };
afterEach(() => {
  for (const [k, v] of [["DISC_ENABLED", cu.disc], ["NEXTAUTH_URL", cu.url], ["AUTH_URL", cu.auth], ["NEXT_PUBLIC_APP_URL", cu.app]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.clearAllMocks();
});

type Nut = { type?: unknown; props?: { children?: unknown; [k: string]: unknown } };
function duyet(n: unknown, ra: Nut[] = []): Nut[] {
  if (Array.isArray(n)) n.forEach((x) => duyet(x, ra));
  else if (n && typeof n === "object") {
    const e = n as Nut;
    ra.push(e);
    duyet(e.props?.children, ra);
  }
  return ra;
}
function chu(n: unknown): string {
  if (typeof n === "string") return n;
  if (Array.isArray(n)) return n.map(chu).join("");
  if (n && typeof n === "object") return chu((n as Nut).props?.children);
  return "";
}

async function ve(sp: { t?: string; kq?: string }) {
  const { default: Trang } = await import("./page");
  return Trang({ searchParams: Promise.resolve(sp) });
}

describe("[DISC-XME-01] cổng cờ", () => {
  it.each([[undefined], ["false"], ["1"]])("cờ=%j ⇒ 404, không đọc searchParams", async (v) => {
    if (v === undefined) delete process.env.DISC_ENABLED;
    else process.env.DISC_ENABLED = v;
    const { default: Trang } = await import("./page");
    const daDoc = vi.fn();
    const thenable = { then: (ok: (v: object) => void) => (daDoc(), ok({})) } as unknown as Promise<{ t?: string }>;
    await expect(Trang({ searchParams: thenable })).rejects.toBeInstanceOf(NotFoundGia);
    expect(daDoc).not.toHaveBeenCalled();
  });
});

describe("[DISC-XME-02] GET chỉ hiện NÚT, không xác minh", () => {
  it("có token ⇒ form (action) + input ẩn t + nút; KHÔNG gọi xacMinhEmail", async () => {
    process.env.DISC_ENABLED = "true";
    const cay = await ve({ t: "v1.sub.abc.xyz" });
    const nut = duyet(cay);
    const form = nut.find((e) => e.type === "form");
    expect(form).toBeTruthy();
    expect(typeof form!.props!.action).toBe("function");
    const an = nut.find((e) => e.type === "input");
    expect(an!.props).toMatchObject({ type: "hidden", name: "t", value: "v1.sub.abc.xyz" });
    expect(nut.some((e) => e.type === "button" && e.props!.type === "submit")).toBe(true);
    expect(M.xacMinh).not.toHaveBeenCalled();
  });
  it("trang không chứa tên người / thông tin hồ sơ", async () => {
    process.env.DISC_ENABLED = "true";
    const van = chu(await ve({ t: "v1.sub.abc.xyz" }));
    expect(van).not.toMatch(/điểm|năm sinh|tên|lớp \d/i);
    expect(van).toContain("Xác nhận");
  });
});

describe("[DISC-XME-03] lỗi: MỘT câu chung, không phân biệt nguyên nhân", () => {
  it("?kq=loi, thiếu token, token quá dài ⇒ cùng nội dung; không có form", async () => {
    process.env.DISC_ENABLED = "true";
    const a = await ve({ kq: "loi" });
    const b = await ve({});
    const c = await ve({ t: "x".repeat(300) });
    expect(chu(a)).toBe(chu(b));
    expect(chu(b)).toBe(chu(c));
    expect(chu(a)).toContain("không hợp lệ hoặc đã hết hạn");
    expect(duyet(a).some((e) => e.type === "form")).toBe(false);
  });
  it("kq=ok nói 'xếp hàng' chứ không nói 'đã gửi' (QUEUED ≠ SENT); kq=chua-xep nói thật là chưa xếp", async () => {
    process.env.DISC_ENABLED = "true";
    const ok = chu(await ve({ kq: "ok" }));
    expect(ok).toMatch(/xếp hàng/);
    expect(ok).not.toMatch(/đã gửi/i);
    expect(chu(await ve({ kq: "chua-xep" }))).toMatch(/chưa được xếp hàng/);
  });
});

describe("[DISC-XME-04] siêu dữ liệu", () => {
  it("noindex/nofollow/nocache, no-referrer, tiêu đề trung tính, trang động", async () => {
    const mod = await import("./page");
    expect(mod.metadata.robots).toMatchObject({ index: false, follow: false, nocache: true });
    expect(mod.metadata.referrer).toBe("no-referrer");
    expect(String(mod.metadata.title)).not.toMatch(/[0-9{}$]/);
    expect(mod.dynamic).toBe("force-dynamic");
  });
});

describe("[DISC-XME-05] action: POST mới xác minh, PRG, một đích lỗi", () => {
  const form = (t: unknown) => {
    const f = new FormData();
    if (t !== undefined) f.set("t", t as string);
    return f;
  };
  const chay = async (f: FormData) => {
    const { xacNhanEmailDiscAction } = await import("./_actions");
    try {
      await xacNhanEmailDiscAction(f);
    } catch (e) {
      if (e instanceof ChuyenHuongGia) return e.toi;
      throw e;
    }
    throw new Error("không chuyển hướng");
  };

  it("cờ tắt ⇒ 404 và không làm gì", async () => {
    delete process.env.DISC_ENABLED;
    process.env.NEXTAUTH_URL = "https://satarobo.example";
    await expect(chay(form("tok"))).rejects.toBeInstanceOf(NotFoundGia);
    expect(M.xacMinh).not.toHaveBeenCalled();
    expect(M.rateLimit).not.toHaveBeenCalled();
  });
  it("thành công ⇒ ?kq=ok, token KHÔNG nằm trong URL đích; dịch vụ nhận token + gốc URL từ env + giờ", async () => {
    process.env.DISC_ENABLED = "true";
    process.env.NEXTAUTH_URL = "https://satarobo.example";
    expect(await chay(form("v1.sub.abc.xyz"))).toBe("/disc/xac-minh-email?kq=ok");
    expect(M.xacMinh).toHaveBeenCalledTimes(1);
    expect(M.xacMinh.mock.calls[0]![0]).toMatchObject({ token: "v1.sub.abc.xyz", goc: "https://satarobo.example" });
    expect(M.xacMinh.mock.calls[0]![0].now).toBeInstanceOf(Date);
  });
  it("xác minh được nhưng chưa xếp được thư ⇒ ?kq=chua-xep", async () => {
    process.env.DISC_ENABLED = "true";
    process.env.NEXTAUTH_URL = "https://satarobo.example";
    M.xacMinh.mockResolvedValueOnce({ ok: true, xepBaoCao: false });
    expect(await chay(form("t"))).toBe("/disc/xac-minh-email?kq=chua-xep");
  });
  it("mọi thất bại (dịch vụ từ chối · quá tần suất · thiếu gốc URL · thiếu/không phải chuỗi) ⇒ CÙNG ?kq=loi", async () => {
    process.env.DISC_ENABLED = "true";
    process.env.NEXTAUTH_URL = "https://satarobo.example";
    M.xacMinh.mockResolvedValueOnce({ ok: false, xepBaoCao: false });
    const a = await chay(form("t"));
    M.rateLimit.mockResolvedValueOnce({ success: false });
    const b = await chay(form("t"));
    delete process.env.NEXTAUTH_URL;
    delete process.env.AUTH_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    const c = await chay(form("t"));
    process.env.NEXTAUTH_URL = "https://satarobo.example";
    M.xacMinh.mockResolvedValueOnce({ ok: false, xepBaoCao: false });
    const d = await chay(form(undefined));
    expect(new Set([a, b, c, d])).toEqual(new Set(["/disc/xac-minh-email?kq=loi"]));
    // b và c bị chặn TRƯỚC khi chạm dịch vụ xác minh; d vẫn hỏi dịch vụ với token null (dịch vụ từ chối).
    expect(M.xacMinh).toHaveBeenCalledTimes(2);
    expect(M.xacMinh.mock.calls[1]![0].token).toBeNull();
  });
  it("trần tần suất theo IP, khoá không chứa token", async () => {
    process.env.DISC_ENABLED = "true";
    process.env.NEXTAUTH_URL = "https://satarobo.example";
    await chay(form("v1.sub.abc.xyz"));
    const a = M.rateLimit.mock.calls[0]![0];
    expect(a.key).toBe("disc-email-verify:ip:203.0.113.9");
    expect(a.key).not.toContain("abc");
  });
  it("lưới đọc mã: action không log, không đọc token ngoài formData, không nhận token từ URL", () => {
    const ma = boChuThich(docTep(resolve(process.cwd(), "app/(public)/disc/xac-minh-email/_actions.ts")));
    expect(ma).not.toMatch(/console\./);
    expect(ma).not.toMatch(/searchParams|headers\(\)\.get|cookies\(/);
    expect(ma).toMatch(/formData\.get\("t"\)/);
  });
});
