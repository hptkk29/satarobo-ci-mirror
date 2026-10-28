// @vitest-environment node
// Server-Timing của route asset SCORM (25/10/2026, vòng 2): tách "đĩa trúng / R2 trượt (bên mở lượt tải) / R2 trượt (bên chờ lượt của người khác) / R2 truyền dòng".
// Cùng bộ giả lập với asset-route.test.ts (R2 · phiên · DB giả, đệm đĩa THẬT trong thư mục tạm). Đặt ở lib/scorm/: `tests/scorm/` không nằm trong `include` của vitest.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const send = vi.fn();
const auth = vi.fn();
const timPkg = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/auth/live-session", () => ({ requireLiveSession: async () => ({ user: { id: "gv-1" } }) }));
vi.mock("@/lib/db", () => ({ db: { scormPackage: { findUnique: (a: unknown) => timPkg(a) } } }));
vi.mock("@/lib/flags", () => ({ isScormEnabled: () => true }));
vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({ send: (cmd: unknown, opts: unknown) => send(cmd, opts) }),
  getR2Bucket: () => "bucket-test",
}));
// Làm nóng gói chạm R2 (liệt kê + tải) — giả lập để test route không bị lẫn lệnh. Các hàm đệm/gộp lượt còn lại là THẬT.
vi.mock("@/lib/scorm/dem-dia", async (goc) => ({
  ...(await goc<typeof import("@/lib/scorm/dem-dia")>()),
  lamNongGoi: async () => ({ tai: 0, daCo: 0, boQua: 0, loi: 0, ms: 0 }),
}));

import { NextRequest } from "next/server";
import { GET, HEAD } from "../../app/api/scorm/asset/[...path]/route";
import { _datLaiTrangThai, docMetaDem } from "./dem-dia";
import { _datLaiBoNhoPhien, _datLaiLog } from "./luong-r2";
import { SCORM_COOKIE_VE } from "./asset-url";
import { signScormTicket } from "./ticket";

const GOI = "cmuz8xsix01vlh3dv9t2bz8d1";
const PREFIX = `scorm/${GOI}/`;
const USER = "gv-1";
process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
process.env.AUTH_SECRET = process.env.NEXTAUTH_SECRET;

function thanR2(bytes: number) {
  return Object.assign(Readable.from([Buffer.alloc(bytes, 7)], { objectMode: false }), {
    transformToWebStream: () => Readable.toWeb(Readable.from([Buffer.alloc(bytes, 7)])),
  });
}
const ve = () => signScormTicket({ packageId: GOI, sessionId: "buoi-1", userId: USER, prefix: PREFIX }, 600);
const yeuCau = (rel: string, o: { t?: string; headers?: Record<string, string>; method?: string } = {}) =>
  new NextRequest(`http://localhost/api/scorm/asset/${GOI}/${rel}${o.t ? `?t=${encodeURIComponent(o.t)}` : ""}`, {
    method: o.method,
    headers: { cookie: `${SCORM_COOKIE_VE}=${ve()}`, ...(o.headers ?? {}) },
  });
const goi = (req: NextRequest, rel: string) => GET(req, { params: Promise.resolve({ path: [GOI, ...rel.split("/")] }) });
const goiHead = (req: NextRequest, rel: string) => HEAD(req, { params: Promise.resolve({ path: [GOI, ...rel.split("/")] }) });
const st = (r: Response) => r.headers.get("server-timing");
const doiDem = async (rel: string) => {
  for (let i = 0; i < 100; i++) {
    if (await docMetaDem(`${PREFIX}${rel}`)) return;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  throw new Error("đệm không được ghi");
};

let thuMuc = "";
beforeEach(async () => {
  vi.clearAllMocks();
  _datLaiLog();
  _datLaiBoNhoPhien();
  thuMuc = await mkdtemp(join(tmpdir(), "scorm-stm-"));
  process.env.SCORM_CACHE_DIR = thuMuc;
  delete process.env.SCORM_CACHE_OFF; // đệm BẬT: cần cho đường gộp lượt + đĩa
  _datLaiTrangThai();
  auth.mockResolvedValue({ user: { id: USER } });
  timPkg.mockResolvedValue({ storagePrefix: PREFIX });
  send.mockImplementation(async (cmd: { constructor: { name: string } }) =>
    cmd.constructor.name === "HeadObjectCommand"
      ? { ContentLength: 1000, ContentType: "application/javascript", ETag: '"abc"' }
      : { Body: thanR2(1000), ContentLength: 1000, ContentType: "application/javascript", ETag: '"abc"' },
  );
});
afterEach(async () => {
  await rm(thuMuc, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

const KHUON = /^cache;desc=(disk|r2-leader|r2-coalesced|r2-stream|r2-head), pre;dur=\d+(\.\d)?, src;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

describe("[STM] Server-Timing của route asset", () => {
  it("[STM-01] trượt đệm, một mình ⇒ r2-leader; lượt sau (đã ghi đĩa) ⇒ disk — và đúng khuôn, không có gì ngoài con số + nhãn nguồn", async () => {
    const a = await goi(yeuCau("res/a.js"), "res/a.js");
    expect(a.status).toBe(200);
    expect(st(a)).toMatch(KHUON);
    expect(st(a)).toContain("cache;desc=r2-leader");
    await doiDem("res/a.js");
    const b = await goi(yeuCau("res/a.js"), "res/a.js");
    expect(b.status).toBe(200);
    expect(st(b)).toMatch(KHUON);
    expect(st(b)).toContain("cache;desc=disk");
  });

  it("[STM-02] hai request cùng khoá đến CÙNG LÚC ⇒ một r2-leader + một r2-coalesced, và R2 chỉ bị gọi MỘT lần", async () => {
    let tha: () => void = () => {};
    const cho = new Promise<void>((ok) => (tha = ok));
    send.mockImplementation(async () => {
      await cho;
      return { Body: thanR2(1000), ContentLength: 1000, ContentType: "application/javascript", ETag: '"abc"' };
    });
    const p1 = goi(yeuCau("res/b.js"), "res/b.js");
    await new Promise((ok) => setTimeout(ok, 30)); // p1 đã mở lượt tải (đang treo ở R2)
    const p2 = goi(yeuCau("res/b.js"), "res/b.js");
    await new Promise((ok) => setTimeout(ok, 30));
    tha();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect([st(r1), st(r2)].map((x) => /cache;desc=([a-z0-9-]+)/.exec(x ?? "")?.[1])).toEqual(["r2-leader", "r2-coalesced"]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("[STM-03] Range ⇒ 206 + r2-stream; đệm TẮT ⇒ cũng r2-stream (không gộp, không đĩa)", async () => {
    send.mockImplementation(async () => ({
      Body: thanR2(100),
      ContentLength: 100,
      ContentRange: "bytes 0-99/1000",
      ContentType: "video/mp4",
      ETag: '"v"',
    }));
    const r = await goi(yeuCau("res/v.mp4", { headers: { range: "bytes=0-99" } }), "res/v.mp4");
    expect(r.status).toBe(206);
    expect(st(r)).toMatch(KHUON);
    expect(st(r)).toContain("cache;desc=r2-stream");

    process.env.SCORM_CACHE_OFF = "1";
    send.mockImplementation(async () => ({ Body: thanR2(1000), ContentLength: 1000, ContentType: "application/javascript", ETag: '"abc"' }));
    const t = await goi(yeuCau("res/c.js"), "res/c.js");
    expect(t.status).toBe(200);
    expect(st(t)).toContain("cache;desc=r2-stream");
  });

  it("[STM-04] HEAD ⇒ r2-head (chưa có đĩa) và disk (đã có đĩa)", async () => {
    const h = await goiHead(yeuCau("res/d.js", { method: "HEAD" }), "res/d.js");
    expect(h.status).toBe(200);
    expect(st(h)).toContain("cache;desc=r2-head");
    await goi(yeuCau("res/d.js"), "res/d.js");
    await doiDem("res/d.js");
    const h2 = await goiHead(yeuCau("res/d.js", { method: "HEAD" }), "res/d.js");
    expect(st(h2)).toContain("cache;desc=disk");
  });

  it("[STM-05] 304 theo If-None-Match từ đĩa cũng mang Server-Timing (disk)", async () => {
    await goi(yeuCau("res/e.js"), "res/e.js");
    await doiDem("res/e.js");
    const r = await goi(yeuCau("res/e.js", { headers: { "if-none-match": '"abc"' } }), "res/e.js");
    expect(r.status).toBe(304);
    expect(st(r)).toContain("cache;desc=disk");
  });

  it("[STM-06] phản hồi bị CHẶN/LỖI không mang Server-Timing: không vé, vé sai, mã gói khác, tệp nội bộ (source.zip), R2 báo không có khoá", async () => {
    const khongVe = new NextRequest(`http://localhost/api/scorm/asset/${GOI}/res/a.js`);
    expect((await goi(khongVe, "res/a.js")).headers.has("server-timing")).toBe(false);
    const rac = new NextRequest(`http://localhost/api/scorm/asset/${GOI}/res/a.js`, { headers: { cookie: `${SCORM_COOKIE_VE}=rac.rac` } });
    expect((await goi(rac, "res/a.js")).headers.has("server-timing")).toBe(false);
    const khac = await GET(yeuCau("res/a.js"), { params: Promise.resolve({ path: ["cmgoikhac000000000000000", "res", "a.js"] }) });
    expect(khac.status).toBe(403);
    expect(khac.headers.has("server-timing")).toBe(false);
    const zip = await goi(yeuCau("source.zip"), "source.zip");
    expect(zip.status).toBe(404);
    expect(zip.headers.has("server-timing")).toBe(false);
    send.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }));
    const kn = await goi(yeuCau("res/khong-co.js"), "res/khong-co.js");
    expect(kn.status).toBe(404);
    expect(kn.headers.has("server-timing")).toBe(false);
  });

  it("[STM-08] Range ngoài tệp trên đĩa ⇒ 416 và KHÔNG có Server-Timing (chỉ 200/206/304 thành công mới mang header)", async () => {
    await goi(yeuCau("res/f.js"), "res/f.js");
    await doiDem("res/f.js");
    const r = await goi(yeuCau("res/f.js", { headers: { range: "bytes=999999999-" } }), "res/f.js");
    expect(r.status).toBe(416);
    expect(r.headers.has("server-timing")).toBe(false);
  });

  it("[STM-07] header không lộ khoá R2, prefix, mã gói, tên tệp hay vé", async () => {
    const t = ve();
    const r = await goi(yeuCau("res/bi-mat-ten-tep.js", { t }), "res/bi-mat-ten-tep.js");
    const h = st(r) ?? "";
    for (const cam of [GOI, "scorm/", "bi-mat-ten-tep", t.slice(0, 12), "bucket-test", USER, "buoi-1"]) expect(h).not.toContain(cam);
  });
});
