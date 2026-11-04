// @vitest-environment node
// Lưới bảo mật HỒI QUY của đường phát asset SCORM/PDF + gia hạn vé chủ động (24/10/2026). Mô hình đe doạ: docs/scorm-hieu-nang/bao-mat.md.
// Đi qua route THẬT (GET asset, POST gia-han); R2 / phiên đăng nhập / DB / giới hạn tần suất giả lập — không cần mạng.
// Nhóm đánh dấu "(phụ thuộc A1)" kiểm hàng rào nằm trong route asset do agent backend nối (laDuongDanNoiBo, Cache-Control lỗi): nếu
// lúc chạy mà route chưa nối thì ca đó ĐỎ — đó là tín hiệu thiếu dây nối, không phải lỗi của lưới.
// (Đặt ở lib/scorm/: `tests/scorm/` không nằm trong `include` của vitest lẫn allowlist của gương CI.)
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const send = vi.fn();
const auth = vi.fn();
const timPkg = vi.fn();
const flag = vi.fn(() => true);
const gioiHan = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
// Phiên SỐNG (đối chiếu DB) của route gia hạn: mặc định trả đúng phiên `auth()`; ca [BM-G14] cho nó trả null (tài khoản bị khoá).
const phienSong = vi.fn();
vi.mock("@/lib/auth/live-session", () => ({ requireLiveSession: () => phienSong() }));
vi.mock("@/lib/db", () => ({ db: { scormPackage: { findUnique: (a: unknown) => timPkg(a) } } }));
vi.mock("@/lib/flags", () => ({ isScormEnabled: () => flag() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (a: unknown) => gioiHan(a) }));
vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({ send: (cmd: unknown, opts: unknown) => send(cmd, opts) }),
  getR2Bucket: () => "bucket-test",
}));
const lamNong = vi.fn();
vi.mock("@/lib/scorm/dem-dia", async (goc) => ({
  ...(await goc<typeof import("@/lib/scorm/dem-dia")>()),
  lamNongGoi: (...a: unknown[]) => lamNong(...a),
}));

import { NextRequest } from "next/server";
import * as routeAsset from "../../app/api/scorm/asset/[...path]/route";
import { POST as giaHan } from "../../app/api/scorm/gia-han/route";
import { _datLaiTrangThai } from "./dem-dia";
import { SCORM_COOKIE_VE, SCORM_COOKIE_VE_CU } from "./asset-url";
import { signScormTicket, verifyScormTicket } from "./ticket";

const GET = routeAsset.GET;
const GOI = "cmuz8xsix01vlh3dv9t2bz8d1";
const GOI_KHAC = "cmuz8xsiy01vmh3dv9t2bz8d2";
const PREFIX = `scorm/${GOI}/`;
const PREFIX_KHAC = `scorm/${GOI_KHAC}/`;
const USER = "gv-1";
const USER_KHAC = "gv-2";

process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
process.env.AUTH_SECRET = process.env.NEXTAUTH_SECRET;

function body(bytes: number) {
  const buf = new Uint8Array(bytes).fill(7);
  return {
    transformToByteArray: vi.fn(async () => buf),
    transformToWebStream: vi.fn(() => new ReadableStream({ start(c) { c.enqueue(buf); c.close(); } })),
  };
}
const tep = (bytes = 1000) => ({ Body: body(bytes), ContentLength: bytes, ContentType: "application/javascript", ETag: '"abc"' });

function ve(over: Partial<{ packageId: string; userId: string; prefix: string | null }> = {}, ttl = 600, now = Date.now()) {
  const prefix = over.prefix === null ? undefined : (over.prefix ?? PREFIX);
  return signScormTicket({ packageId: over.packageId ?? GOI, sessionId: "buoi-1", userId: over.userId ?? USER, prefix }, ttl, now);
}
function yeuCauAsset(duongDan: string, o: { t?: string; cookie?: string; cookieTen?: string; method?: string; headers?: Record<string, string> } = {}) {
  const url = `http://localhost/api/scorm/asset/${duongDan}${o.t ? `?t=${encodeURIComponent(o.t)}` : ""}`;
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = `${o.cookieTen ?? SCORM_COOKIE_VE}=${o.cookie}`;
  return new NextRequest(url, { method: o.method ?? "GET", headers });
}
const goi = (req: NextRequest, segs: string[]) => GET(req, { params: Promise.resolve({ path: segs }) });
const khoaDaGoi = () => send.mock.calls.map((c) => (c[0] as { input: { Key: string } }).input.Key);

type OGiaHan = { ticket?: unknown; raw?: string; headers?: Record<string, string>; ct?: string | null };
function yeuCauGiaHan(o: OGiaHan = {}) {
  const headers: Record<string, string> = { "sec-fetch-site": "same-origin", ...(o.headers ?? {}) };
  if (o.ct !== null) headers["content-type"] = o.ct ?? "application/json";
  return new NextRequest("http://localhost/api/scorm/gia-han", {
    method: "POST",
    headers,
    body: o.raw ?? JSON.stringify({ ticket: o.ticket ?? ve() }),
  });
}
// Trần 3 giờ viết THẲNG bằng số, không lấy từ hằng của mã (nới hằng thì test vẫn phải đỏ).
const TRAN_3_GIO = 3 * 60 * 60 * 1000;
const NGAY_TRUOC_TRAN = (phut: number) => Date.now() - TRAN_3_GIO + phut * 60_000;

let thuMucDem = "";
beforeEach(async () => {
  vi.clearAllMocks();
  thuMucDem = await mkdtemp(join(tmpdir(), "scorm-baomat-test-"));
  process.env.SCORM_CACHE_DIR = thuMucDem;
  process.env.SCORM_CACHE_OFF = "1";
  _datLaiTrangThai();
  flag.mockReturnValue(true);
  auth.mockResolvedValue({ user: { id: USER } });
  timPkg.mockResolvedValue({ storagePrefix: PREFIX });
  gioiHan.mockResolvedValue({ success: true, remaining: 29, resetAt: Date.now() + 60_000 });
  phienSong.mockImplementation(() => auth());
  send.mockResolvedValue(tep());
});
afterEach(async () => {
  await rm(thuMucDem, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

describe("[BM-T] traversal — mọi cách viết bị chặn TRƯỚC khi chạm R2, và khoá R2 không bao giờ thoát prefix của vé", () => {
  const b = String.fromCharCode(92);
  const KIEU_403: Array<[string, string[]]> = [
    ["dot-dot", ["..", "x"]],
    ["dot-dot giữa đường", ["res", "..", "..", "scorm", "x"]],
    ["dấu chấm", [".", "x"]],
    ["backslash", ["res", `a${b}..${b}b`]],
    ["NUL", ["res", "a\0b.js"]],
    ["segment rỗng", ["res", "", "a.js"]],
    ["tuyệt đối", ["/etc/passwd"]],
    ["tuyệt đối ở giữa", ["res", "/etc/passwd"]],
  ];
  for (const [ten, segs] of KIEU_403) {
    it(`[BM-T1] ${ten} ⇒ 403, không gọi R2`, async () => {
      const r = await goi(yeuCauAsset(`${GOI}/x`, { t: ve() }), [GOI, ...segs]);
      expect(r.status).toBe(403);
      expect(send).not.toHaveBeenCalled();
    });
  }

  it("[BM-T2] thoát prefix bằng mã hoá: route KHÔNG giải mã lần nữa — khoá R2 là chuỗi LITERAL nằm trong prefix của vé (hoặc bị chặn)", async () => {
    // Next giải mã %-escape ĐÚNG MỘT lần trước khi đưa vào `params`; những gì còn `%2e` / `%252e` là chữ literal.
    const kieu: string[][] = [
      ["res", "%2e%2e", "x.js"],
      ["res", "%252e%252e", "x.js"],
      ["%2e%2e", "%2e%2e", "x.js"],
      ["res", "..%2f..%2fx.js"],
      ["res", "..;", "x.js"],
      ["res", "....", "x.js"],
      ["res", "a%00b.js"],
    ];
    for (const segs of kieu) {
      send.mockClear();
      const r = await goi(yeuCauAsset(`${GOI}/x`, { t: ve() }), [GOI, ...segs]);
      expect([200, 403, 404], JSON.stringify(segs)).toContain(r.status);
      for (const khoa of khoaDaGoi()) {
        expect(khoa.startsWith(PREFIX), `${JSON.stringify(segs)} → ${khoa}`).toBe(true);
        expect(khoa.split("/").some((p) => p === ".." || p === "."), `${JSON.stringify(segs)} → ${khoa}`).toBe(false);
        expect(khoa, "không được giải mã thêm").toBe(`${PREFIX}${segs.join("/")}`);
      }
    }
  });

  it("[BM-T3] khoá R2 dựng từ prefix CỦA VÉ, không theo mã gói trong URL (gói khác ⇒ 403 trước khi tới R2)", async () => {
    const r = await goi(yeuCauAsset(`${GOI_KHAC}/res/a.js`, { t: ve() }), [GOI_KHAC, "res", "a.js"]);
    expect(r.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
    await goi(yeuCauAsset(`${GOI}/res/a.js`, { t: ve() }), [GOI, "res", "a.js"]);
    expect(khoaDaGoi()).toEqual([`${PREFIX}res/a.js`]);
  });
});

describe("[BM-V] vé / phiên / gói — ai không có đủ ba thứ thì không đọc được byte nào", () => {
  const dich = [GOI, "res", "data", "player.js"];
  const u = `${GOI}/res/data/player.js`;

  it("[BM-V1] không vé / vé rác / vé sai chữ ký / vé sửa payload ⇒ 403, không gọi R2", async () => {
    const hop = ve();
    const [thanVe, chuKy] = hop.split(".");
    const sua = JSON.parse(Buffer.from(thanVe!, "base64url").toString("utf8"));
    sua.packageId = GOI_KHAC;
    sua.prefix = PREFIX_KHAC;
    const giaPayload = `${Buffer.from(JSON.stringify(sua)).toString("base64url")}.${chuKy}`;
    for (const t of [undefined, "rac", "a.b.c", `${thanVe}.${chuKy!.slice(0, -2)}xx`, giaPayload]) {
      const r = await goi(yeuCauAsset(u, { t }), dich);
      expect(r.status, String(t)).toBe(403);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("[BM-V2] vé HẾT HẠN ⇒ 403 (route asset KHÔNG hồi sinh vé hết hạn — chỉ route gia hạn chủ động làm việc đó, và có phiên)", async () => {
    const r = await goi(yeuCauAsset(u, { t: ve({}, 600, Date.now() - 700_000) }), dich);
    expect(r.status).toBe(403);
    const r2 = await goi(yeuCauAsset(u, { cookie: ve({}, 600, Date.now() - 700_000) }), dich);
    expect(r2.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("[BM-V3] vé của NGƯỜI KHÁC (chia sẻ link / cookie) hoặc không có phiên ⇒ 403", async () => {
    auth.mockResolvedValue({ user: { id: USER_KHAC } });
    expect((await goi(yeuCauAsset(u, { t: ve() }), dich)).status).toBe(403);
    expect((await goi(yeuCauAsset(u, { cookie: ve() }), dich)).status).toBe(403);
    auth.mockResolvedValue(null);
    expect((await goi(yeuCauAsset(u, { t: ve() }), dich)).status).toBe(403);
    auth.mockResolvedValue({ user: {} });
    expect((await goi(yeuCauAsset(u, { t: ve() }), dich)).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("[BM-V4] vé của gói A KHÔNG đọc được gói B — dù qua query hay cookie, dù URL mới hay cũ", async () => {
    const veA = ve();
    const b = [GOI_KHAC, "res", "data", "player.js"];
    expect((await goi(yeuCauAsset(`${GOI_KHAC}/res/data/player.js`, { t: veA }), b)).status).toBe(403);
    expect((await goi(yeuCauAsset(`${GOI_KHAC}/res/data/player.js`, { cookie: veA }), b)).status).toBe(403);
    // vé của gói B (có prefix B) dùng ở URL gói A
    expect((await goi(yeuCauAsset(u, { t: ve({ packageId: GOI_KHAC, prefix: PREFIX_KHAC }) }), dich)).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("[BM-V5] cookie KIỂU CŨ (`scorm_at`, vé đang bay): đúng người ⇒ phục vụ; người khác ⇒ 403; URL mang mã gói KHÁC vé ⇒ 403", async () => {
    const cu = ve({ prefix: null });
    const r = await goi(yeuCauAsset("res/data/player.js", { cookie: cu, cookieTen: SCORM_COOKIE_VE_CU }), ["res", "data", "player.js"]);
    expect(r.status).toBe(200);
    expect(khoaDaGoi()).toEqual([`${PREFIX}res/data/player.js`]);

    auth.mockResolvedValue({ user: { id: USER_KHAC } });
    expect((await goi(yeuCauAsset("res/data/player.js", { cookie: cu, cookieTen: SCORM_COOKIE_VE_CU }), ["res", "data", "player.js"])).status).toBe(403);

    auth.mockResolvedValue({ user: { id: USER } });
    send.mockClear();
    expect((await goi(yeuCauAsset(`${GOI_KHAC}/res/a.js`, { cookie: cu, cookieTen: SCORM_COOKIE_VE_CU }), [GOI_KHAC, "res", "a.js"])).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("[BM-V6] cờ tắt ⇒ 404 và không gọi R2, kể cả với vé hợp lệ", async () => {
    flag.mockReturnValue(false);
    expect((await goi(yeuCauAsset(u, { t: ve() }), dich)).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("[BM-V7] phản hồi lỗi KHÔNG lộ prefix R2, khoá, mã gói của gói khác hay nội dung vé", async () => {
    const veHong = "rac.rac";
    const cacLoi = [
      await goi(yeuCauAsset(u, { t: veHong }), dich),
      await goi(yeuCauAsset(`${GOI_KHAC}/res/a.js`, { t: ve() }), [GOI_KHAC, "res", "a.js"]),
      await goi(yeuCauAsset(`${GOI}/x`, { t: ve() }), [GOI, "..", "x"]),
    ];
    for (const r of cacLoi) {
      const txt = await r.text();
      expect(txt).not.toContain("scorm/");
      expect(txt).not.toContain(GOI_KHAC);
      expect(txt).not.toContain("bucket-test");
      expect(txt.length).toBeLessThan(40);
    }
  });
});

describe("[BM-Z] zip gốc / thư mục nguồn không bao giờ được phục vụ (phụ thuộc A1: route phải gọi laDuongDanNoiBo)", () => {
  const vi_ = (segs: string[], t = ve()) => goi(yeuCauAsset([GOI, ...segs].join("/"), { t }), [GOI, ...segs]);

  it("[BM-Z1] source.zip ở gốc, mọi cách viết ⇒ 404 và KHÔNG gọi R2 (không đệm đĩa, không tải 94MB)", async () => {
    for (const segs of [["source.zip"], ["Source.ZIP"], ["source.zip."], ["%73ource.zip"], ["%2573ource.zip"], ["source.zip "], ["ｓｏｕｒｃｅ．ｚｉｐ"], ["source.zip​"]]) {
      send.mockClear();
      const r = await vi_(segs);
      expect(r.status, JSON.stringify(segs)).toBe(404);
      expect(send, JSON.stringify(segs)).not.toHaveBeenCalled();
    }
  });

  it("[BM-Z2] thư mục _src (đường presign mới) ⇒ 404, không gọi R2", async () => {
    for (const segs of [["_src", "package.zip"], ["_SRC", "package.zip"], ["%5Fsrc", "package.zip"], ["res", "_src", "x.bin"]]) {
      send.mockClear();
      const r = await vi_(segs);
      expect(r.status, JSON.stringify(segs)).toBe(404);
      expect(send, JSON.stringify(segs)).not.toHaveBeenCalled();
    }
  });

  it("[BM-Z3] segment mang dấu phân cách (từ %2F) như `res/../source.zip`, `_src/package.zip` ⇒ 403/404, không bao giờ tới R2", async () => {
    for (const segs of [["res/../source.zip"], ["_src/package.zip"], ["res", "_src/x.bin"], ["..%5Csource.zip"]]) {
      send.mockClear();
      const r = await vi_(segs);
      expect([403, 404], JSON.stringify(segs)).toContain(r.status);
      expect(send, JSON.stringify(segs)).not.toHaveBeenCalled();
    }
  });

  it("[BM-Z4] đối chứng dương: tệp hợp lệ của gói VẪN được phục vụ (không chặn nhầm)", async () => {
    for (const segs of [["res", "index.html"], ["res", "data", "video1.mp4"], ["res", "data", "img12.png"], ["imsmanifest.xml"], ["res", "tai-ve", "bai.zip"]]) {
      send.mockClear();
      const r = await vi_(segs);
      expect(r.status, JSON.stringify(segs)).toBe(200);
      expect(khoaDaGoi(), JSON.stringify(segs)).toEqual([`${PREFIX}${segs.join("/")}`]);
    }
  });

  it("[BM-Z5] đệm đĩa không phải đường vòng: tệp zip gốc đã nằm sẵn trong đệm vẫn bị chặn", async () => {
    process.env.SCORM_CACHE_OFF = "";
    const dem = await import("./dem-dia");
    _datLaiTrangThai();
    await dem.ghiDemTuBytes(`${PREFIX}source.zip`, new Uint8Array([1, 2, 3]), { contentType: "application/zip", etag: null, lastModified: null });
    const r = await vi_(["source.zip"]);
    expect(r.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("[BM-C] Cache-Control: lỗi không bị lưu, hop đầu mang vé không bị lưu, asset con chỉ riêng tư", () => {
  it("[BM-C1] hop đầu mang vé trên URL ⇒ `private, no-store`; asset con (cookie) ⇒ `private` có max-age ≤ 1 giờ, không Vary", async () => {
    const dau = await goi(yeuCauAsset(`${GOI}/res/index.html`, { t: ve() }), [GOI, "res", "index.html"]);
    expect(dau.headers.get("cache-control")).toBe("private, no-store");
    const con = await goi(yeuCauAsset(`${GOI}/res/data/img1.png`, { cookie: ve() }), [GOI, "res", "data", "img1.png"]);
    const cc = con.headers.get("cache-control") ?? "";
    expect(cc.startsWith("private")).toBe(true);
    expect(cc).not.toMatch(/public|s-maxage/);
    expect(Number(/max-age=(\d+)/.exec(cc)?.[1])).toBeLessThanOrEqual(3600);
  });

  it("[BM-C2] URL kiểu cũ (trùng giữa các gói) ⇒ không lưu (phụ thuộc A1: route phải dùng chinhSachCache)", async () => {
    const r = await goi(yeuCauAsset("res/data/player.js", { cookie: ve({ prefix: null }), cookieTen: SCORM_COOKIE_VE_CU }), ["res", "data", "player.js"]);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("[BM-C3] phản hồi LỖI (403/404) có `no-store` (phụ thuộc A1)", async () => {
    const cacLoi = [
      await goi(yeuCauAsset(`${GOI}/res/a.js`, { t: "rac" }), [GOI, "res", "a.js"]),
      await goi(yeuCauAsset(`${GOI}/source.zip`, { t: ve() }), [GOI, "source.zip"]),
      await goi(yeuCauAsset(`${GOI}`, { t: ve() }), [GOI]),
    ];
    for (const r of cacLoi) expect(r.headers.get("cache-control"), String(r.status)).toContain("no-store");
  });
});

describe("[BM-H] HEAD không rò thông tin", () => {
  const dau = (routeAsset as unknown as { HEAD?: typeof GET }).HEAD ?? GET; // Next dựng HEAD từ GET khi route không export HEAD
  const chay = (req: NextRequest, segs: string[]) => dau(req, { params: Promise.resolve({ path: segs }) });

  it("[BM-H1] HEAD không vé / sai người / sai gói ⇒ 403, không gọi R2", async () => {
    const u = `${GOI}/res/a.js`;
    expect((await chay(yeuCauAsset(u, { method: "HEAD" }), [GOI, "res", "a.js"])).status).toBe(403);
    auth.mockResolvedValue({ user: { id: USER_KHAC } });
    expect((await chay(yeuCauAsset(u, { method: "HEAD", t: ve() }), [GOI, "res", "a.js"])).status).toBe(403);
    auth.mockResolvedValue({ user: { id: USER } });
    expect((await chay(yeuCauAsset(`${GOI_KHAC}/res/a.js`, { method: "HEAD", t: ve() }), [GOI_KHAC, "res", "a.js"])).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("[BM-H2] HEAD vào source.zip ⇒ 404 và KHÔNG gọi R2 — không dò được sự tồn tại/kích thước (phụ thuộc A1)", async () => {
    const r = await chay(yeuCauAsset(`${GOI}/source.zip`, { method: "HEAD", t: ve() }), [GOI, "source.zip"]);
    expect(r.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("[BM-G] gia hạn chủ động — chỉ người ĐÚNG, từ CHÍNH trang, trong TRẦN", () => {
  it("[BM-G1] hợp lệ ⇒ 200 + vé mới cùng quyền (gói/buổi/người/prefix/iat) + cookie theo gói + no-store", async () => {
    const goc = Date.now() - 4 * 60_000;
    const cu = ve({}, 600, goc);
    const r = await giaHan(yeuCauGiaHan({ ticket: cu }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const j = (await r.json()) as { ok: boolean; ticket: string; expiresInSec: number };
    expect(j.ok).toBe(true);
    expect(j.expiresInSec).toBeGreaterThan(9 * 60 - 5);
    expect(j.expiresInSec).toBeLessThanOrEqual(600);
    const pc = verifyScormTicket(cu, goc).payload!;
    const pm = verifyScormTicket(j.ticket).payload!;
    expect({ ...pm, exp: 0 }).toEqual({ ...pc, exp: 0 });
    const sc = r.headers.get("set-cookie") ?? "";
    expect(sc).toContain(`${SCORM_COOKIE_VE}=`);
    expect(sc).toContain(`Path=/api/scorm/asset/${GOI}`);
    expect(sc.toLowerCase()).toContain("httponly");
    expect(sc.toLowerCase()).toContain("samesite=lax");
    expect(decodeURIComponent(/scorm_tk=([^;]+)/.exec(sc)![1]!)).toBe(j.ticket);
  });

  it("[BM-G2] cookie do gia hạn đặt có CÙNG thuộc tính với cookie do route asset đặt (không hai bản lệch nhau)", async () => {
    const thuocTinh = (sc: string) =>
      sc
        .split(";")
        .map((x) => x.trim().toLowerCase())
        .filter((x) => !x.startsWith(`${SCORM_COOKIE_VE}=`) && !x.startsWith("max-age=") && !x.startsWith("expires="))
        .sort();
    const a = await goi(yeuCauAsset(`${GOI}/res/index.html`, { t: ve() }), [GOI, "res", "index.html"]);
    const g = await giaHan(yeuCauGiaHan());
    expect(thuocTinh(g.headers.get("set-cookie") ?? "")).toEqual(thuocTinh(a.headers.get("set-cookie") ?? ""));
  });

  it("[BM-G3] không có phiên ⇒ 401 `phien`, không cookie", async () => {
    auth.mockResolvedValue(null);
    const r = await giaHan(yeuCauGiaHan());
    expect(r.status).toBe(401);
    expect(((await r.json()) as { reason: string }).reason).toBe("phien");
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("[BM-G4] vé của NGƯỜI KHÁC (phiên khác userId trong vé) ⇒ 403 `phien`, không cookie, không vé mới", async () => {
    auth.mockResolvedValue({ user: { id: USER_KHAC } });
    const r = await giaHan(yeuCauGiaHan({ ticket: ve() }));
    expect(r.status).toBe(403);
    const j = (await r.json()) as { reason: string; ticket?: string };
    expect(j.reason).toBe("phien");
    expect(j.ticket).toBeUndefined();
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("[BM-G5] vé sai chữ ký / rác / sửa payload ⇒ 403 `ve-sai`", async () => {
    const hop = ve();
    const [thanVe, chuKy] = hop.split(".");
    const sua = JSON.parse(Buffer.from(thanVe!, "base64url").toString("utf8"));
    sua.iat = Date.now() + 10 * 3600_000; // nới trần bằng cách đẩy iat
    for (const t of ["rac", `${thanVe}.${chuKy!.slice(0, -2)}xx`, `${Buffer.from(JSON.stringify(sua)).toString("base64url")}.${chuKy}`]) {
      const r = await giaHan(yeuCauGiaHan({ ticket: t }));
      expect(r.status, t).toBe(403);
      expect(((await r.json()) as { reason: string }).reason).toBe("ve-sai");
      expect(r.headers.get("set-cookie")).toBeNull();
    }
  });

  it("[BM-G6] vé hết hạn GẦN ĐÂY nhưng còn trong trần (ngồi yên > 10 phút) ⇒ 200", async () => {
    const r = await giaHan(yeuCauGiaHan({ ticket: ve({}, 600, Date.now() - 30 * 60_000) }));
    expect(r.status).toBe(200);
  });

  it("[BM-G7] QUÁ TRẦN (iat + 3 giờ) ⇒ 403 `het-han-toi-da`, không cookie — dù vé còn hạn hay đã hết hạn", async () => {
    for (const goc of [Date.now() - TRAN_3_GIO - 1000, Date.now() - TRAN_3_GIO - 3600_000]) {
      const r = await giaHan(yeuCauGiaHan({ ticket: ve({}, 600, goc) }));
      expect(r.status).toBe(403);
      expect(((await r.json()) as { reason: string }).reason).toBe("het-han-toi-da");
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    // vé cấp 3 giờ trừ 10 phút trước nhưng TTL dài bất thường (ký nội bộ) vẫn không vượt trần khi gia hạn
    const con = await giaHan(yeuCauGiaHan({ ticket: ve({}, 600, NGAY_TRUOC_TRAN(2)) }));
    expect(con.status).toBe(200);
    const j = (await con.json()) as { ticket: string; expiresInSec: number };
    expect(j.expiresInSec).toBeLessThanOrEqual(2 * 60);
    expect(verifyScormTicket(j.ticket).payload!.exp).toBeLessThanOrEqual(Date.now() + 2 * 60_000 + 1000);
  });

  it("[BM-G8] nguồn gốc: `Sec-Fetch-Site` khác same-origin / vắng cả hai / Origin lạ ⇒ 403 `nguon-goc`; Origin khớp Host (trình duyệt cũ) ⇒ 200", async () => {
    const chan = [
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "none" },
    ];
    for (const h of chan) {
      const r = await giaHan(yeuCauGiaHan({ headers: h }));
      expect(r.status, JSON.stringify(h)).toBe(403);
      expect(((await r.json()) as { reason: string }).reason).toBe("nguon-goc");
    }
    const khongDau = new NextRequest("http://localhost/api/scorm/gia-han", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: ve() }),
    });
    expect((await giaHan(khongDau)).status).toBe(403);

    const goc = (origin: string, extra: Record<string, string> = {}) =>
      new NextRequest("http://localhost/api/scorm/gia-han", {
        method: "POST",
        headers: { "content-type": "application/json", origin, host: "giaovien.satarobo.vn", ...extra },
        body: JSON.stringify({ ticket: ve() }),
      });
    expect((await giaHan(goc("https://evil.example"))).status).toBe(403);
    expect((await giaHan(goc("null"))).status).toBe(403);
    expect((await giaHan(goc("https://giaovien.satarobo.vn.evil.example"))).status).toBe(403);
    expect((await giaHan(goc("https://giaovien.satarobo.vn"))).status).toBe(200);
    // Sec-Fetch-Site có mặt thì LÀ căn cứ duy nhất: Origin "khớp" mà trình duyệt nói cross-site vẫn bị từ chối.
    expect((await giaHan(goc("https://giaovien.satarobo.vn", { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });

  it("[BM-G9] thân: quá lớn (khai báo hoặc thực tế), không phải JSON, thiếu/sai kiểu `ticket`, sai content-type ⇒ 4xx, không ký gì", async () => {
    const lon = await giaHan(yeuCauGiaHan({ headers: { "content-length": "100000" } }));
    expect(lon.status).toBe(413);
    const lonThat = await giaHan(yeuCauGiaHan({ raw: JSON.stringify({ ticket: ve(), rac: "x".repeat(6000) }) }));
    expect(lonThat.status).toBe(413);
    for (const raw of ["", "{", "[]", "null", JSON.stringify({}), JSON.stringify({ ticket: 5 }), JSON.stringify({ ticket: "" }), JSON.stringify({ ticket: ["a"] })]) {
      const r = await giaHan(yeuCauGiaHan({ raw }));
      expect(r.status, raw).toBe(400);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    expect((await giaHan(yeuCauGiaHan({ ct: "text/plain" }))).status).toBe(400);
    expect((await giaHan(yeuCauGiaHan({ ct: null }))).status).toBe(400);
  });

  it("[BM-G10] giới hạn tần suất theo NGƯỜI DÙNG ⇒ 429 + Retry-After, không cookie", async () => {
    gioiHan.mockResolvedValue({ success: false, remaining: 0, resetAt: Date.now() + 20_000 });
    const r = await giaHan(yeuCauGiaHan());
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(gioiHan.mock.calls[0]![0]).toMatchObject({ key: `scorm:gia-han:${USER}` });
  });

  it("[BM-G11] cờ tắt ⇒ 404, không ký", async () => {
    flag.mockReturnValue(false);
    const r = await giaHan(yeuCauGiaHan());
    expect(r.status).toBe(404);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("[BM-G12] MỌI phản hồi (kể cả lỗi) là `no-store`, và lỗi không chứa vé/prefix/mã gói", async () => {
    flag.mockReturnValue(true);
    const mau: NextRequest[] = [
      yeuCauGiaHan(),
      yeuCauGiaHan({ ticket: "rac" }),
      yeuCauGiaHan({ raw: "{" }),
      yeuCauGiaHan({ headers: { "sec-fetch-site": "cross-site" } }),
      yeuCauGiaHan({ ticket: ve({}, 600, Date.now() - TRAN_3_GIO - 1000) }),
    ];
    for (const req of mau) {
      const r = await giaHan(req);
      expect(r.headers.get("cache-control")).toBe("no-store");
      if (r.status !== 200) {
        const txt = await r.text();
        expect(txt).not.toContain("scorm/");
        expect(txt).not.toContain(GOI);
        expect(txt.length).toBeLessThan(80);
      }
    }
  });

  it("[BM-G13] vé do gia hạn cấp dùng được ngay ở route asset; vé của gói A đổi ra vẫn chỉ là vé gói A (cookie path theo gói A)", async () => {
    const r = await giaHan(yeuCauGiaHan({ ticket: ve() }));
    const j = (await r.json()) as { ticket: string };
    expect((await goi(yeuCauAsset(`${GOI}/res/a.js`, { cookie: j.ticket }), [GOI, "res", "a.js"])).status).toBe(200);
    expect((await goi(yeuCauAsset(`${GOI_KHAC}/res/a.js`, { cookie: j.ticket }), [GOI_KHAC, "res", "a.js"])).status).toBe(403);
    expect(r.headers.get("set-cookie")).toContain(`Path=/api/scorm/asset/${GOI}`);
    expect(r.headers.get("set-cookie")).not.toContain(GOI_KHAC);
  });

  it("[BM-G14] tài khoản bị KHOÁ / cắt phiên giữa buổi (phiên sống = null dù JWT còn) ⇒ 401 `phien`, không cookie, không ký vé", async () => {
    phienSong.mockResolvedValue(null);
    const r = await giaHan(yeuCauGiaHan());
    expect(r.status).toBe(401);
    expect(((await r.json()) as { reason: string }).reason).toBe("phien");
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(gioiHan).not.toHaveBeenCalled();
  });
});
