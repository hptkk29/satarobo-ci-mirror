// Lõi cưỡng chế của chế độ học sinh: `getPortalContext().cheDo` + `requireActiveStudent` fail-closed.
// Giả lập phiên + DB + cookie; token ký THẬT bằng hv-token.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HV_COOKIE, taoTokenCheDo } from "./hv-token";

const KHOA = "khoa-ky-thu-nghiem-du-dai-32-ky-tu-tro-len-0001";
const cookieJar = new Map<string, string>();
let phien: { user: { id: string; role: string; name: string } } | null = null;

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (cookieJar.has(k) ? { value: cookieJar.get(k) } : undefined) }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => phien }));
vi.mock("@/lib/security/signing-key", () => ({ getSigningSecret: () => KHOA }));
vi.mock("@/lib/db", () => ({
  db: {
    student: {
      findMany: async () => [
        { id: "conA", name: "Bé A", studentCode: null, avatarUrl: null, centerId: null, preferredCenterId: null },
        { id: "conB", name: "Bé B", studentCode: null, avatarUrl: null, centerId: null, preferredCenterId: null },
      ],
    },
  },
}));

const sess = await import("./session");

beforeEach(() => {
  cookieJar.clear();
  phien = { user: { id: "phuhuynh1", role: "PARENT", name: "Ba Mẹ" } };
});

describe("chế độ học sinh — getPortalContext", () => {
  it("[HVS-01] không có token ⇒ chế độ phụ huynh", async () => {
    const ctx = await sess.getPortalContext();
    expect(ctx?.cheDo).toBe("phu-huynh");
  });
  it("[HVS-02] token hợp lệ ⇒ chế độ học sinh VÀ con đang xem bị ép theo token, bỏ qua cookie đổi con", async () => {
    cookieJar.set(HV_COOKIE, taoTokenCheDo("phuhuynh1", "conB", Date.now(), KHOA));
    cookieJar.set(sess.ACTIVE_SITE_COOKIE, sess.makeActiveSiteToken("conA"));
    const ctx = await sess.getPortalContext();
    expect(ctx?.cheDo).toBe("hoc-sinh");
    expect(ctx?.activeStudent?.id).toBe("conB");
  });
  it("[HVS-03] token của phụ huynh KHÁC, token giả, token cho con không thuộc nhà ⇒ không vào chế độ học sinh", async () => {
    cookieJar.set(HV_COOKIE, taoTokenCheDo("nguoiLa", "conB", Date.now(), KHOA));
    expect((await sess.getPortalContext())?.cheDo).toBe("phu-huynh");
    cookieJar.set(HV_COOKIE, taoTokenCheDo("phuhuynh1", "conB", Date.now(), "khoa-khac-khoa-khac-khoa-khac-khoa-khac-0002"));
    expect((await sess.getPortalContext())?.cheDo).toBe("phu-huynh");
    cookieJar.set(HV_COOKIE, taoTokenCheDo("phuhuynh1", "conLa", Date.now(), KHOA));
    expect((await sess.getPortalContext())?.cheDo).toBe("phu-huynh");
  });
  it("[HVS-04] token còn nguyên NHƯNG phiên là người khác (đăng xuất rồi phụ huynh khác đăng nhập) ⇒ không áp", async () => {
    cookieJar.set(HV_COOKIE, taoTokenCheDo("phuhuynh1", "conB", Date.now(), KHOA));
    phien = { user: { id: "phuhuynh2", role: "PARENT", name: "Khác" } };
    expect((await sess.getPortalContext())?.cheDo).toBe("phu-huynh");
  });
});

describe("chế độ học sinh — requireActiveStudent FAIL-CLOSED", () => {
  it("[HVS-05] ở chế độ học sinh, gọi mặc định (trang/hành động của ba mẹ) ⇒ đá về /portal/hoc-sinh", async () => {
    cookieJar.set(HV_COOKIE, taoTokenCheDo("phuhuynh1", "conA", Date.now(), KHOA));
    await expect(sess.requireActiveStudent()).rejects.toThrow("REDIRECT:/portal/hoc-sinh");
  });
  it("[HVS-06] chỉ `choHocSinh: true` mới qua, và studentId là con trong token", async () => {
    cookieJar.set(HV_COOKIE, taoTokenCheDo("phuhuynh1", "conB", Date.now(), KHOA));
    cookieJar.set(sess.ACTIVE_SITE_COOKIE, sess.makeActiveSiteToken("conA"));
    const r = await sess.requireActiveStudent({ choHocSinh: true });
    expect(r.studentId).toBe("conB");
  });
  it("[HVS-07] chế độ phụ huynh: mặc định vẫn qua như cũ (không đổi hành vi của ba mẹ)", async () => {
    const r = await sess.requireActiveStudent();
    expect(r.ctx.cheDo).toBe("phu-huynh");
    expect(["conA", "conB"]).toContain(r.studentId);
  });
  it("[HVS-08] chanKhiOCheDoHocSinh: đá khi ở chế độ học sinh, im khi không", async () => {
    await expect(sess.chanKhiOCheDoHocSinh()).resolves.toBeUndefined();
    cookieJar.set(HV_COOKIE, taoTokenCheDo("phuhuynh1", "conA", Date.now(), KHOA));
    await expect(sess.chanKhiOCheDoHocSinh()).rejects.toThrow("REDIRECT:/portal/hoc-sinh");
    expect(await sess.dangOCheDoHocSinh()).toBe(true);
  });
});
