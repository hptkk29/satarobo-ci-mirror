// @vitest-environment node
// QA ĐỘC LẬP (24/10/2026) — POST /api/scorm/gia-han (gia hạn CHỦ ĐỘNG vé mở SCORM/PDF) theo HỢP ĐỒNG của đợt này:
//   body JSON {"ticket": string} → 200 {ok:true, ticket, expiresInSec} + Set-Cookie vé theo gói (cùng tên/path/thuộc tính với route asset);
//   lỗi 401/403 {ok:false, reason:"phien"|"ve-sai"|"het-han-toi-da"}; 429 nếu bị giới hạn.
// Bằng chứng loại "tích hợp có phiên giả" (route THẬT + ticket THẬT + rate-limit THẬT trong bộ nhớ; phiên đăng nhập giả). Không phải UAT.
//
// Mỗi ca nạp route bằng `await import(...)` ĐỘNG: route chưa tồn tại ⇒ từng ca đỏ với "Cannot find module" thay vì cả file chết lúc
// thu thập (một file chết lúc thu thập giấu mất toàn bộ ca).
//
// Nguyên tắc an ninh bộ ca này canh (đừng nới để "chữa" lỗi viewer):
//   · gia hạn KHÔNG nâng quyền: packageId/userId/prefix/sessionId giữ nguyên, mốc cấp gốc (`iat`) không bị đặt lại;
//   · TRẦN 3 giờ tính từ lúc cấp gốc, kể cả khi gia hạn nối tiếp nhiều lần;
//   · vé của người khác / vé giả / vé sửa thân ⇒ không bao giờ ra vé mới;
//   · cookie cấp ra có đúng `Path` của gói trong vé — không đặt được cookie cho gói khác.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const auth = vi.fn();
const flag = vi.fn(() => true);
vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/auth/live-session", () => ({ requireLiveSession: () => auth() }));
vi.mock("@/lib/flags", () => ({ isScormEnabled: () => flag() }));

// ── Cổng cấy lỗi vào MÃ SẢN PHẨM mà không động vào file của agent khác (luật 14) ─────────────────────────────────────────────
// Khi đặt QA_DOT_BIEN_TICKET=<đường dẫn tuyệt đối>, module `@/lib/scorm/ticket` được thay bằng bản ĐỘT BIẾN (một bản sao đã cấy lỗi do script
// của QA tạo ra ở thư mục tạm). Bình thường biến này không có ⇒ dùng module thật; file đột biến chưa từng được nạp.
vi.mock("@/lib/scorm/ticket", async (goc) => {
  const that = await goc<typeof import("@/lib/scorm/ticket")>();
  const f = process.env.QA_DOT_BIEN_TICKET;
  if (!f) return that;
  return (await import(/* @vite-ignore */ f)) as typeof that;
});

import { NextRequest } from "next/server";
import { SCORM_COOKIE_VE, cookiePathChoGoi } from "./asset-url";
import { signScormTicket, verifyScormTicket } from "./ticket";

process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
process.env.AUTH_SECRET = process.env.NEXTAUTH_SECRET;

const GOI = "cmuz8xsix01vlh3dv9t2bz8d1";
const GOI_KHAC = "cmuz8xsiy01vmh3dv9t2bz8d2";
const PREFIX = `scorm/${GOI}/`;
// Mỗi ca một người dùng RIÊNG: bộ giới hạn tần suất (30 lượt/phút/người) nhớ theo userId trong cả tiến trình, dùng chung một id thì
// ca sau ăn 429 vì ca trước — hỏng giả khó lần ra.
let USER = "gv-0";
let demCa = 0;
const PHUT = 60_000;
const GIO = 60 * PHUT;

type Ham = (req: NextRequest) => Promise<Response>;
async function route(): Promise<Ham> {
  const m = (await import("../../app/api/scorm/gia-han/route")) as unknown as { POST?: Ham };
  if (typeof m.POST !== "function") throw new Error("route /api/scorm/gia-han chưa export POST (phụ thuộc A3)");
  return m.POST;
}
type Tuy = { body?: unknown; raw?: string; ct?: string | null; site?: string | null; headers?: Record<string, string> };
function yeuCau(o: Tuy = {}) {
  const headers: Record<string, string> = { host: "localhost", ...(o.headers ?? {}) };
  if (o.ct !== null) headers["content-type"] = o.ct ?? "application/json";
  // Trình duyệt thật luôn tự đặt Sec-Fetch-Site: same-origin cho fetch cùng nguồn gốc.
  if (o.site !== null) headers["sec-fetch-site"] = o.site ?? "same-origin";
  return new NextRequest("http://localhost/api/scorm/gia-han", {
    method: "POST",
    headers,
    body: o.raw ?? JSON.stringify(o.body ?? {}),
  });
}
const goi = async (o: Tuy) => (await route())(yeuCau(o));
const ve = (over: { packageId?: string; userId?: string; prefix?: string | null; sessionId?: string | null } = {}, ttl = 600, now = Date.now()) =>
  signScormTicket(
    {
      packageId: over.packageId ?? GOI,
      sessionId: over.sessionId === undefined ? "buoi-1" : over.sessionId,
      userId: over.userId ?? USER,
      prefix: over.prefix === null ? undefined : (over.prefix ?? PREFIX),
    },
    ttl,
    now,
  );
type KetQua = { ok: boolean; ticket?: string; expiresInSec?: number; reason?: string };
const json = async (r: Response) => (await r.json()) as KetQua;
const layCookie = (r: Response) => r.headers.get("set-cookie") ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockReset();
  USER = `gv-${++demCa}`;
  auth.mockResolvedValue({ user: { id: USER } });
  flag.mockReturnValue(true);
});
afterEach(() => vi.useRealTimers());

describe("[QAG] gia hạn chủ động — hình dạng phản hồi + cookie", () => {
  it("[QAG-01] vé hợp lệ + phiên đúng ⇒ 200 {ok, ticket, expiresInSec}; no-store; vé mới xác thực được", async () => {
    const r = await goi({ body: { ticket: ve() } });
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control") ?? "").toMatch(/no-store/);
    const j = await json(r);
    expect(j.ok).toBe(true);
    expect(typeof j.ticket).toBe("string");
    expect(j.expiresInSec).toBeGreaterThan(0);
    expect(j.expiresInSec).toBeLessThanOrEqual(600);
    expect(verifyScormTicket(j.ticket!).ok).toBe(true);
  });

  it("[QAG-02] Set-Cookie: tên `scorm_tk`, Path = đúng thư mục asset của gói, HttpOnly, SameSite=Lax, Max-Age ≤ 600; giá trị = vé mới", async () => {
    const r = await goi({ body: { ticket: ve() } });
    const j = await json(r);
    const sc = layCookie(r);
    expect(sc).toContain(`${SCORM_COOKIE_VE}=`);
    expect(/Path=([^;]+)/i.exec(sc)?.[1]).toBe(cookiePathChoGoi(GOI));
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=lax/i);
    const maxAge = Number(/Max-Age=(\d+)/i.exec(sc)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(600);
    expect(decodeURIComponent(new RegExp(`${SCORM_COOKIE_VE}=([^;]+)`).exec(sc)![1]!)).toBe(j.ticket);
  });

  it("[QAG-03] vé mới GIỮ NGUYÊN packageId · userId · prefix · sessionId; hạn lùi xa hơn; mốc cấp gốc (iat) KHÔNG bị đặt lại", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    const cu = ve({}, 600, t0);
    const pc = verifyScormTicket(cu).payload!;
    vi.setSystemTime(t0 + 7 * PHUT);
    const j = await json(await goi({ body: { ticket: cu } }));
    const pm = verifyScormTicket(j.ticket!).payload!;
    expect(pm).toMatchObject({ packageId: GOI, userId: USER, prefix: PREFIX, sessionId: "buoi-1" });
    expect(pm.exp).toBeGreaterThan(pc.exp);
    expect(pm.iat).toBe(pc.iat);
  });

  it("[QAG-04] vé của gói B nhận cookie có Path của gói B (không đặt được cookie cho gói khác)", async () => {
    const r = await goi({ body: { ticket: ve({ packageId: GOI_KHAC, prefix: `scorm/${GOI_KHAC}/` }) } });
    expect(r.status).toBe(200);
    expect(/Path=([^;]+)/i.exec(layCookie(r))?.[1]).toBe(cookiePathChoGoi(GOI_KHAC));
  });

  it("[QAG-05] vé CŨ (không prefix, không iat) vẫn gia hạn được và KHÔNG tự thêm prefix (không nâng quyền)", async () => {
    const j = await json(await goi({ body: { ticket: ve({ prefix: null }) } }));
    expect(j.ok).toBe(true);
    const p = verifyScormTicket(j.ticket!).payload!;
    expect(p.prefix).toBeUndefined();
    expect(p.packageId).toBe(GOI);
  });

  it("[QAG-06] hai tab cùng gói gọi gần nhau với CÙNG vé ⇒ cả hai 200 (gia hạn không làm vô hiệu vé của tab kia)", async () => {
    const cu = ve();
    const [a, b] = await Promise.all([goi({ body: { ticket: cu } }), goi({ body: { ticket: cu } })]);
    expect([a.status, b.status]).toEqual([200, 200]);
  });
});

describe("[QAG] gia hạn chủ động — từ chối", () => {
  const reason = async (r: Response) => (await json(r)).reason;

  it("[QAG-10] không đăng nhập ⇒ 401, reason `phien`, không cookie", async () => {
    auth.mockResolvedValue(null);
    const r = await goi({ body: { ticket: ve() } });
    expect(r.status).toBe(401);
    expect(await reason(r)).toBe("phien");
    expect(layCookie(r)).toBe("");
  });

  it("[QAG-11] vé của NGƯỜI KHÁC (phiên ≠ userId trong vé) ⇒ 403, không cookie, không vé", async () => {
    auth.mockResolvedValue({ user: { id: "nguoi-khac" } });
    const r = await goi({ body: { ticket: ve() } });
    expect(r.status).toBe(403);
    expect(["phien", "ve-sai"]).toContain(await reason(r));
    expect(layCookie(r)).toBe("");
  });

  it("[QAG-12] vé rác / thiếu chữ ký / sửa thân giữ chữ ký ⇒ 403 `ve-sai`, không bao giờ 200", async () => {
    const hop = ve();
    const [than, ky] = hop.split(".");
    const p = JSON.parse(Buffer.from(than!, "base64url").toString("utf8")) as Record<string, unknown>;
    const giaMao = Buffer.from(JSON.stringify({ ...p, packageId: GOI_KHAC, exp: Date.now() + 99 * GIO })).toString("base64url");
    for (const t of ["rac.rac", "", "a", `${than}`, `${giaMao}.${ky}`, `${than}.${ky}x`]) {
      const r = await goi({ body: { ticket: t } });
      expect(r.status, JSON.stringify(t).slice(0, 40)).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(layCookie(r), JSON.stringify(t).slice(0, 40)).toBe("");
    }
    expect(await reason(await goi({ body: { ticket: `${giaMao}.${ky}` } }))).toBe("ve-sai");
  });

  it("[QAG-13] thân sai dạng (không JSON · thiếu `ticket` · ticket không phải chuỗi · content-type lạ) ⇒ 4xx, không ném 500", async () => {
    for (const o of [{ raw: "khong-phai-json" }, { body: {} }, { body: { ticket: 123 } }, { body: { ticket: ve() }, ct: "text/plain" }]) {
      const r = await goi(o);
      expect(r.status, JSON.stringify(o).slice(0, 50)).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
  });

  it("[QAG-14] thân khổng lồ (100KB) ⇒ bị từ chối 4xx trước khi xử lý (không nuốt RAM, không HMAC)", async () => {
    const r = await goi({ body: { ticket: "x".repeat(100_000) } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it("[QAG-15] yêu cầu từ trang KHÁC nguồn gốc (Sec-Fetch-Site: cross-site) ⇒ không bao giờ ra vé (hàng rào do A3 thêm; đối chứng dương ở QAG-01)", async () => {
    const r = await goi({ body: { ticket: ve() }, site: "cross-site" });
    expect(r.status).not.toBe(200);
    expect(layCookie(r)).toBe("");
  });

  it("[QAG-16] cờ SCORM tắt ⇒ 404, không cookie", async () => {
    flag.mockReturnValue(false);
    const r = await goi({ body: { ticket: ve() } });
    expect(r.status).toBe(404);
    expect(layCookie(r)).toBe("");
  });

  it("[QAG-17] mọi phản hồi lỗi cũng `no-store` (đừng để proxy giữ 403 của vé này cho vé khác)", async () => {
    for (const o of [{ body: { ticket: "rac" } }, { raw: "{" }]) {
      expect((await goi(o)).headers.get("Cache-Control") ?? "").toMatch(/no-store/);
    }
  });
});

describe("[QAG] gia hạn chủ động — TRẦN 3 giờ + vé đã hết hạn", () => {
  it("[QAG-20] gia hạn NỐI TIẾP mỗi 9 phút: thành công nhiều lần rồi PHẢI dừng với 403 `het-han-toi-da`; không vé nào sống quá 3h kể từ lúc cấp gốc", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    let hien = ve({}, 600, t0);
    let thanhCong = 0;
    let lyDoDung: string | undefined;
    let expCuoi = 0;
    for (let phut = 9; phut <= 400; phut += 9) {
      vi.setSystemTime(t0 + phut * PHUT);
      const r = await goi({ body: { ticket: hien } });
      if (r.status !== 200) {
        expect(r.status).toBe(403);
        lyDoDung = (await json(r)).reason;
        break;
      }
      const j = await json(r);
      thanhCong++;
      hien = j.ticket!;
      expCuoi = Math.max(expCuoi, verifyScormTicket(hien, Date.now()).payload?.exp ?? 0);
    }
    expect(lyDoDung).toBe("het-han-toi-da");
    expect(thanhCong).toBeGreaterThanOrEqual(18); // 3h / 9' = 20 lần
    expect(thanhCong).toBeLessThanOrEqual(21);
    // Đặc tả: trần 3h. Cho dung sai MỘT vé cuối (10') nếu A3 chọn "gia hạn khi còn trong trần" thay vì kẹp cứng — xem QAG-21.
    expect(expCuoi).toBeLessThanOrEqual(t0 + 3 * GIO + 10 * PHUT);
  });

  it("[QAG-21] (mức chặt hơn đặc tả — theo docs/scorm-hieu-nang/bao-mat.md của A3) hạn của vé gia hạn bị KẸP: không có 'trần + 10 phút'", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0 + 3 * GIO - 2 * PHUT); // còn 2 phút tới trần
    const r = await goi({ body: { ticket: ve({}, 11_000, t0) } });
    if (r.status === 200) {
      const exp = verifyScormTicket((await json(r)).ticket!, Date.now()).payload!.exp;
      expect(exp).toBeLessThanOrEqual(t0 + 3 * GIO + 1000);
    } else {
      expect(r.status).toBe(403);
    }
  });

  it("[QAG-22] vé cấp gốc cách đây > 3 giờ ⇒ 403 `het-han-toi-da`, không cookie", async () => {
    const now = Date.now();
    const cuLam = ve({}, 4 * 3600, now - 3 * GIO - 5 * PHUT); // còn hạn nhưng đã quá trần
    const r = await goi({ body: { ticket: cuLam } });
    expect(r.status).toBe(403);
    expect((await json(r)).reason).toBe("het-han-toi-da");
    expect(layCookie(r)).toBe("");
  });

  it("[QAG-23] vé vừa hết hạn (trong trần): chấp nhận đổi (200) HOẶC từ chối `ve-sai` — nhưng KHÔNG 5xx; ghi nhận hành vi", async () => {
    const hetHan = ve({}, 600, Date.now() - 11 * PHUT);
    const r = await goi({ body: { ticket: hetHan } });
    console.info(`[QAG] vé vừa hết hạn 1 phút, còn trong trần 3h ⇒ HTTP ${r.status} (A3 chủ trương: vẫn đổi được nếu phiên SỐNG khớp userId)`);
    expect([200, 403]).toContain(r.status);
    if (r.status === 403) expect((await json(r)).reason).toBe("ve-sai");
  });

  it("[QAG-24] vé hết hạn QUÁ trần ⇒ không bao giờ đổi được", async () => {
    const r = await goi({ body: { ticket: ve({}, 600, Date.now() - 4 * GIO) } });
    expect(r.status).toBe(403);
    expect(layCookie(r)).toBe("");
  });
});

describe("[QAG] giới hạn tần suất (đo, không ép)", () => {
  it("[QAG-30] 80 lượt liên tiếp của một người: mọi phản hồi ∈ {200, 429}; ghi lại ngưỡng thực tế; 429 có Retry-After nếu xuất hiện", async () => {
    const cu = ve();
    const ma: number[] = [];
    let r429: Response | null = null;
    for (let i = 0; i < 80; i++) {
      const r = await goi({ body: { ticket: cu } });
      ma.push(r.status);
      if (r.status === 429 && !r429) r429 = r;
    }
    const soOk = ma.filter((m) => m === 200).length;
    console.info(`[QAG] 80 lượt gia hạn liên tiếp ⇒ ${soOk} lượt 200, ${ma.filter((m) => m === 429).length} lượt 429`);
    expect(ma.every((m) => m === 200 || m === 429)).toBe(true);
    if (r429) {
      expect(Number(r429.headers.get("Retry-After") ?? "0")).toBeGreaterThan(0);
      expect(layCookie(r429)).toBe("");
    }
  });
});
