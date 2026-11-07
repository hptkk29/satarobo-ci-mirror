// @vitest-environment node
// GỘP LƯỢT TRƯỢT ĐỆM (single-flight) + LÀM NÓNG GỌN (24/10/2026, vòng 2). Route THẬT + đệm đĩa THẬT + `lamNongGoi` THẬT; chỉ phiên đăng nhập,
// DB và R2 là giả. R2 giả cho test ĐIỀU KHIỂN từng lệnh GetObject (mở / lỗi / treo) nên đếm được "bao nhiêu lần gọi R2" một cách xác định.
//
// Bằng chứng loại: tích hợp có R2 giả (không phải mạng thật, không phải trình duyệt). Số đo thật của lợi ích nằm ở docs/scorm-hieu-nang/benchmark.md.
//
// Luật 14 (cấy lỗi): mỗi bất biến dưới đây đã được cấy lỗi vào mã thật và thấy ĐỎ đúng tập ca — danh sách ở báo cáo của đợt (không ghi lại ở đây
// để khỏi lệch). Các ca có hậu tố "ĐỐI CHỨNG" là phía dương của một ca chỉ khẳng định sự vắng mặt.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const send = vi.fn();
const auth = vi.fn();
const timPkg = vi.fn();
const flag = vi.fn(() => true);
const lamNong = vi.fn();
const lamNongThat = vi.hoisted(() => ({ f: undefined as undefined | ((p: string, now?: number) => Promise<{ tai: number; daCo: number; boQua: number; loi: number }>) }));

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/auth/live-session", () => ({ requireLiveSession: async () => ({ user: { id: "gv-1" } }) }));
vi.mock("@/lib/db", () => ({ db: { scormPackage: { findUnique: (a: unknown) => timPkg(a) } } }));
vi.mock("@/lib/flags", () => ({ isScormEnabled: () => flag() }));
vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({ send: (cmd: unknown, opts: unknown) => send(cmd, opts) }),
  getR2Bucket: () => "bucket-test",
}));
// Route gọi `lamNongGoi` sau mỗi lượt trượt: mặc định no-op (để không lẫn lệnh); ca [SF-W*] bật bản THẬT.
vi.mock("@/lib/scorm/dem-dia", async (goc) => {
  const that = await goc<typeof import("@/lib/scorm/dem-dia")>();
  lamNongThat.f = that.lamNongGoi as never;
  return { ...that, lamNongGoi: (...a: unknown[]) => lamNong(...a) };
});

import { NextRequest } from "next/server";
import { GET, HEAD } from "../../app/api/scorm/asset/[...path]/route";
import { NGUONG_LAM_NONG_BYTE, _datLaiTrangThai, docMetaDem, taiTepNhoDungChung } from "./dem-dia";
import { NGUONG_DEM_BYTE, HAN_CHO_R2_MS, _datLaiBoNhoPhien, _datLaiLog } from "./luong-r2";
import { SCORM_COOKIE_VE } from "./asset-url";
import { signScormTicket } from "./ticket";

process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
process.env.AUTH_SECRET = process.env.NEXTAUTH_SECRET;

const MB = 1024 * 1024;
const GOI = "cmuz8xsix01vlh3dv9t2bz8d1";
const GOI_KHAC = "cmuz8xsiy01vmh3dv9t2bz8d2";
const PREFIX = `scorm/${GOI}/`;
const USER = "gv-1";
const REL = "res/data/player.js";
const KEY = `${PREFIX}${REL}`;
const SEGS = [GOI, ...REL.split("/")];

// ── R2 giả điều khiển được ─────────────────────────────────────────────────────────────────────────────────────────────────
type Fake = { Body?: unknown; ContentLength?: number; ContentType?: string; ETag?: string; ContentRange?: string; LastModified?: Date };
type Get = {
  key: string;
  range: string | undefined;
  ifNone: string | undefined;
  signal: AbortSignal | undefined;
  daHuy: boolean;
  mo: (f?: Partial<Fake>) => void;
  loi: (e: unknown) => void;
  thanDaTao: Readable[];
};
let gets: Get[] = [];
let heads: string[] = [];
let listing: Array<{ Key: string; Size: number }> = [];
const kichThuoc = new Map<string, number>();
const DAI_MAC_DINH = 1000;
const tenLenh = (c: unknown) => (c as { constructor: { name: string } }).constructor.name;
const nghi = (ms = 15) => new Promise((x) => setTimeout(x, ms));
async function choDen(dk: () => boolean, ms = 3000): Promise<void> {
  const han = Date.now() + ms;
  while (!dk()) {
    if (Date.now() > han) throw new Error("hết hạn chờ điều kiện");
    await nghi(1);
  }
}
function datR2Gia(): void {
  gets = [];
  heads = [];
  listing = [];
  kichThuoc.clear();
  send.mockImplementation((cmd: { input: Record<string, string | undefined> }, opts?: { abortSignal?: AbortSignal }) => {
    const ten = tenLenh(cmd);
    const key = cmd.input.Key ?? "";
    if (ten === "ListObjectsV2Command") return Promise.resolve({ Contents: listing.filter((o) => o.Key.startsWith(cmd.input.Prefix ?? "")) });
    const n = kichThuoc.get(key) ?? DAI_MAC_DINH;
    if (ten === "HeadObjectCommand") {
      heads.push(key);
      return Promise.resolve({ ContentLength: n, ContentType: "application/javascript", ETag: '"e"' });
    }
    return new Promise((ok, no) => {
      const g: Get = {
        key,
        range: cmd.input.Range,
        ifNone: cmd.input.IfNoneMatch,
        signal: opts?.abortSignal,
        daHuy: false,
        thanDaTao: [],
        mo: (f) => {
          const than = Readable.from([Buffer.alloc(n, 7)]);
          g.thanDaTao.push(than);
          ok({
            Body: than,
            ContentLength: n,
            ContentType: "application/javascript",
            ETag: '"e"',
            ...(g.range ? { ContentRange: `bytes 0-${n - 1}/${n}` } : {}),
            ...f,
          });
        },
        loi: no,
      };
      opts?.abortSignal?.addEventListener(
        "abort",
        () => {
          g.daHuy = true;
          no(Object.assign(new Error("aborted"), { name: "AbortError" }));
        },
        { once: true },
      );
      gets.push(g);
    });
  });
}

// ── Gọi route ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function ve(over: Partial<{ packageId: string; userId: string }> = {}) {
  return signScormTicket({ packageId: over.packageId ?? GOI, sessionId: "buoi-1", userId: over.userId ?? USER, prefix: `scorm/${over.packageId ?? GOI}/` }, 600);
}
type Opt = { headers?: Record<string, string>; signal?: AbortSignal; cookie?: string };
function yeuCau(rel = REL, o: Opt = {}, ma = GOI) {
  const headers: Record<string, string> = { ...(o.headers ?? {}), cookie: `${SCORM_COOKIE_VE}=${o.cookie ?? ve({ packageId: ma })}` };
  return new NextRequest(`http://localhost/api/scorm/asset/${ma}/${rel}`, { headers, signal: o.signal });
}
const lay = (rel = REL, o: Opt = {}, ma = GOI) => GET(yeuCau(rel, o, ma), { params: Promise.resolve({ path: [ma, ...rel.split("/")] }) });
const layHead = (rel = REL, o: Opt = {}) => HEAD(yeuCau(rel, o), { params: Promise.resolve({ path: [GOI, ...rel.split("/")] }) });
const soGet = (key = KEY) => gets.filter((g) => g.key === key).length;
const thanBuf = async (r: Response) => Buffer.from(await r.arrayBuffer());

let thuMucDem = "";
beforeEach(async () => {
  vi.clearAllMocks();
  auth.mockReset();
  auth.mockResolvedValue({ user: { id: USER } });
  timPkg.mockResolvedValue({ storagePrefix: PREFIX });
  flag.mockReturnValue(true);
  lamNong.mockReset();
  lamNong.mockResolvedValue({ tai: 0, daCo: 0, boQua: 0, loi: 0, ms: 0 });
  _datLaiLog();
  _datLaiBoNhoPhien();
  thuMucDem = await mkdtemp(join(tmpdir(), "scorm-sf-test-"));
  process.env.SCORM_CACHE_DIR = thuMucDem;
  delete process.env.SCORM_CACHE_OFF; // gộp lượt chỉ chạy khi đệm đĩa BẬT
  _datLaiTrangThai();
  datR2Gia();
});
afterEach(async () => {
  vi.useRealTimers();
  // Lượt ghi đệm chạy NỀN có thể còn dở ⇒ thử lại thay vì ENOTEMPTY ngẫu nhiên.
  await rm(thuMucDem, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

describe("[SF] gộp lượt trượt đệm theo khoá — tệp NHỎ", () => {
  it("[SF-01] 10 GET đồng thời cùng một tệp nhỏ ⇒ ĐÚNG 1 lệnh GetObject; cả 10 nhận 200 + cùng byte; tệp được ghi đĩa", async () => {
    const dsReq = Array.from({ length: 10 }, () => lay());
    await choDen(() => gets.length >= 1);
    await nghi(40);
    expect(gets.length, "10 request đồng thời cùng khoá ⇒ 1 lượt gọi R2").toBe(1);
    gets[0]!.mo();
    const kq = await Promise.all(dsReq);
    expect(kq.map((r) => r.status)).toEqual(Array(10).fill(200));
    for (const r of kq) {
      const b = await thanBuf(r);
      expect(b.length).toBe(DAI_MAC_DINH);
      expect(b.every((x) => x === 7)).toBe(true);
      expect(r.headers.get("Content-Length")).toBe(String(DAI_MAC_DINH));
      expect(r.headers.get("ETag")).toBe('"e"');
    }
    expect(soGet(), "không lượt nào sinh thêm lệnh R2").toBe(1);
    expect(lamNong, "mỗi phản hồi gộp vẫn kích hoạt làm nóng gói (như đường trượt đệm cũ)").toHaveBeenCalledTimes(10);
    expect(lamNong.mock.calls.every((c) => c[0] === PREFIX)).toBe(true);
    for (let i = 0; i < 100 && !(await docMetaDem(KEY)); i++) await nghi(5); // chờ lượt ghi đĩa nền xong rồi mới dọn thư mục tạm
    expect((await docMetaDem(KEY))?.size).toBe(DAI_MAC_DINH);
  });

  it("[SF-02] ĐỐI CHỨNG (khoá KHÁC nhau thì KHÔNG gộp): 3 tệp khác nhau đồng thời ⇒ 3 lệnh GetObject", async () => {
    const ds = ["res/a.js", "res/b.js", "res/c.js"].map((r) => lay(r));
    await choDen(() => gets.length >= 3);
    expect(gets.map((g) => g.key).sort()).toEqual([`${PREFIX}res/a.js`, `${PREFIX}res/b.js`, `${PREFIX}res/c.js`]);
    gets.forEach((g) => g.mo());
    expect((await Promise.all(ds)).map((r) => r.status)).toEqual([200, 200, 200]);
  });

  it("[SF-03] LEADER ngắt (req.signal) KHÔNG làm hỏng lượt tải mà người khác đang chờ: lượt R2 không bị huỷ, B vẫn nhận 200; A nhận 499", async () => {
    const ctlA = new AbortController();
    const a = lay(REL, { signal: ctlA.signal });
    await choDen(() => gets.length >= 1);
    const b = lay();
    await nghi(40); // B đã vào hàng chờ
    expect(gets.length).toBe(1);
    ctlA.abort();
    expect((await a).status).toBe(499);
    await nghi(20);
    expect(gets[0]!.daHuy, "còn người chờ ⇒ lượt R2 KHÔNG được huỷ").toBe(false);
    gets[0]!.mo();
    const rb = await b;
    expect(rb.status).toBe(200);
    expect((await thanBuf(rb)).length).toBe(DAI_MAC_DINH);
    expect(gets.length).toBe(1);
  });

  it("[SF-04] KHÔNG CÒN AI chờ ⇒ lượt R2 bị HUỶ (nhả socket) và entry bị gỡ: request đến sau mở lượt MỚI, không bám vào lượt đã chết", async () => {
    const ctlA = new AbortController();
    const ctlB = new AbortController();
    const a = lay(REL, { signal: ctlA.signal });
    await choDen(() => gets.length >= 1);
    const b = lay(REL, { signal: ctlB.signal });
    await nghi(40);
    ctlA.abort();
    await a;
    await nghi(10);
    expect(gets[0]!.daHuy, "còn B ⇒ chưa huỷ").toBe(false);
    ctlB.abort();
    expect([(await a).status, (await b).status]).toEqual([499, 499]);
    await choDen(() => gets[0]!.daHuy);
    const c = lay();
    await choDen(() => gets.length >= 2);
    expect(gets.length, "C phải mở lượt R2 mới").toBe(2);
    gets[1]!.mo();
    expect((await c).status).toBe(200);
  });

  it("[SF-05] LỖI hạ tầng của lượt tải: mọi người chờ cùng nhận 502; lỗi KHÔNG được nhớ — request sau gọi R2 lại và thành công", async () => {
    const lo = vi.spyOn(console, "error").mockImplementation(() => {});
    const ds = Array.from({ length: 4 }, () => lay());
    await choDen(() => gets.length >= 1);
    await nghi(30);
    gets[0]!.loi(Object.assign(new Error("InternalError"), { name: "InternalError", $metadata: { httpStatusCode: 500 } }));
    expect((await Promise.all(ds)).map((r) => r.status)).toEqual([502, 502, 502, 502]);
    expect(gets.length).toBe(1);
    const sau = lay();
    await choDen(() => gets.length >= 2);
    gets[1]!.mo();
    expect((await sau).status, "lỗi cũ không được nhớ").toBe(200);
    expect(gets.length).toBe(2);
    lo.mockRestore();
  });

  it("[SF-06] NoSuchKey: mọi người chờ cùng nhận 404 (không phải 502); entry gỡ — request sau gọi R2 lại", async () => {
    const lo = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ds = Array.from({ length: 3 }, () => lay());
    await choDen(() => gets.length >= 1);
    await nghi(30);
    gets[0]!.loi(Object.assign(new Error("nf"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }));
    expect((await Promise.all(ds)).map((r) => r.status)).toEqual([404, 404, 404]);
    const sau = lay();
    await choDen(() => gets.length >= 2);
    gets[1]!.mo();
    expect((await sau).status).toBe(200);
    lo.mockRestore();
  });

  it("[SF-07] R2 không lên header trong HAN_CHO_R2_MS ⇒ lượt tải bị huỷ, mọi người chờ nhận 504, entry gỡ", async () => {
    const lo = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ds = Array.from({ length: 3 }, () => lay());
    // setImmediate KHÔNG bị giả ⇒ nhường vòng lặp sự kiện thật cho IO đĩa của `docMetaDem` tiến lên trước khi lượt tải được mở.
    for (let i = 0; i < 5000 && gets.length < 1; i++) await new Promise((x) => setImmediate(x));
    for (let i = 0; i < 200; i++) await new Promise((x) => setImmediate(x)); // để cả 3 request vào hàng chờ
    expect(gets.length).toBe(1);
    await vi.advanceTimersByTimeAsync(HAN_CHO_R2_MS + 50);
    const kq = await Promise.all(ds);
    expect(kq.map((r) => r.status)).toEqual([504, 504, 504]);
    expect(gets[0]!.daHuy).toBe(true);
    lo.mockRestore();
  });

  it("[SF-08] thân tệp nhỏ sau khi gộp xong được ghi ĐĨA đúng một bản: request kế tiếp phục vụ từ đĩa, KHÔNG gọi R2", async () => {
    const a = lay();
    await choDen(() => gets.length >= 1);
    gets[0]!.mo();
    expect((await a).status).toBe(200);
    for (let i = 0; i < 100 && !(await docMetaDem(KEY)); i++) await nghi(5);
    expect((await docMetaDem(KEY))?.size).toBe(DAI_MAC_DINH);
    const b = await lay();
    expect(b.status).toBe(200);
    expect(gets.length, "trúng đệm ⇒ không gọi R2 nữa").toBe(1);
  });

  it("[SF-09] đệm TẮT (SCORM_CACHE_OFF=1 — công tắc lùi) ⇒ KHÔNG gộp: mỗi request tự gọi R2 như bản cũ", async () => {
    process.env.SCORM_CACHE_OFF = "1";
    const ds = Array.from({ length: 3 }, () => lay());
    await choDen(() => gets.length >= 3);
    expect(gets.length).toBe(3);
    gets.forEach((g) => g.mo());
    expect((await Promise.all(ds)).map((r) => r.status)).toEqual([200, 200, 200]);
  });
});

describe("[SF] chỉ gộp thứ CÓ THỂ gộp: tệp lớn / Range / HEAD / điều kiện đi đường riêng", () => {
  it("[SF-10] tệp LỚN (ContentLength > ngưỡng): lượt dò bị huỷ, MỖI request tự truyền dòng bản đầy đủ (không chung luồng); khoá được nhớ là lớn", async () => {
    kichThuoc.set(KEY, NGUONG_DEM_BYTE + 1000);
    const ds = Array.from({ length: 3 }, () => lay());
    await choDen(() => gets.length >= 1);
    await nghi(40);
    expect(gets.length, "lượt dò chung").toBe(1);
    gets[0]!.mo();
    await choDen(() => gets.length >= 4);
    expect(gets.length, "dò 1 + mỗi request 1").toBe(4);
    expect(gets[0]!.daHuy, "lượt dò phải nhả socket").toBe(true);
    expect(gets[0]!.thanDaTao[0]!.destroyed).toBe(true);
    gets.slice(1).forEach((g) => g.mo());
    const kq = await Promise.all(ds);
    expect(kq.map((r) => r.status)).toEqual([200, 200, 200]);
    for (const r of kq) expect((await thanBuf(r)).length).toBe(NGUONG_DEM_BYTE + 1000);
    // Lần sau khỏi dò: khoá đã biết là lớn ⇒ đúng 1 GetObject cho 1 request.
    const sau = lay();
    await choDen(() => gets.length >= 5);
    await nghi(30);
    expect(gets.length).toBe(5);
    gets[4]!.mo();
    expect((await sau).status).toBe(200);
  });

  it("[SF-11] Range KHÔNG bao giờ gộp: 2 request Range đồng thời ⇒ 2 lệnh có Range; và Range không bám vào lượt gộp đang bay", async () => {
    const a = lay(REL, { headers: { range: "bytes=0-99" } });
    const b = lay(REL, { headers: { range: "bytes=0-99" } });
    await choDen(() => gets.length >= 2);
    expect(gets.map((g) => g.range)).toEqual(["bytes=0-99", "bytes=0-99"]);
    const c = lay(); // không Range ⇒ mở lượt gộp
    await choDen(() => gets.length >= 3);
    const d = lay(REL, { headers: { range: "bytes=5-9" } });
    await choDen(() => gets.length >= 4);
    expect(gets[3]!.range).toBe("bytes=5-9");
    gets.forEach((g) => g.mo());
    expect((await Promise.all([a, b, c, d])).map((r) => r.status)).toEqual([206, 206, 200, 206]);
  });

  it("[SF-12] If-None-Match CŨNG được gộp và trả lời CỤC BỘ: 3 request khớp ETag + 1 lệch, đồng thời ⇒ 1 GetObject KHÔNG điều kiện; 3 nhận 304 (không thân, có ETag), 1 nhận 200 đủ thân", async () => {
    const khop = { "if-none-match": '"e"' };
    const ds = [lay(REL, { headers: khop }), lay(REL, { headers: khop }), lay(REL, { headers: { "if-none-match": '"khac"' } }), lay(REL, { headers: khop })];
    await choDen(() => gets.length >= 1);
    await nghi(40);
    expect(gets.length, "mọi người chờ chung MỘT lượt R2").toBe(1);
    expect(gets[0]!.ifNone, "lượt dùng chung là GET không điều kiện").toBeUndefined();
    gets[0]!.mo();
    const kq = await Promise.all(ds);
    expect(kq.map((r) => r.status)).toEqual([304, 304, 200, 304]);
    for (const i of [0, 1, 3]) {
      expect(kq[i]!.headers.get("ETag")).toBe('"e"');
      expect((await thanBuf(kq[i]!)).length, "304 không thân").toBe(0);
    }
    expect((await thanBuf(kq[2]!)).length).toBe(DAI_MAC_DINH);
    expect(gets.length).toBe(1);
  });

  it("[SF-12b] If-None-Match + tệp LỚN ⇒ không gộp được: sau lượt dò, mỗi request tự gửi lệnh R2 MANG IfNoneMatch (R2 trả 304 đúng nghĩa)", async () => {
    kichThuoc.set(KEY, NGUONG_DEM_BYTE + 1000);
    const h = { "if-none-match": '"x"' };
    const ds = [lay(REL, { headers: h }), lay(REL, { headers: h })];
    await choDen(() => gets.length >= 1);
    await nghi(40);
    gets[0]!.mo();
    await choDen(() => gets.length >= 3);
    expect(gets[0]!.ifNone).toBeUndefined();
    expect(gets.slice(1).map((g) => g.ifNone)).toEqual(['"x"', '"x"']);
    gets.slice(1).forEach((g) => g.mo());
    expect((await Promise.all(ds)).map((r) => r.status)).toEqual([200, 200]);
  });

  it("[SF-13] HEAD không gộp và không GetObject: 2 HEAD đồng thời ⇒ 2 HeadObject, 0 GetObject", async () => {
    const [a, b] = await Promise.all([layHead(), layHead()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(heads.length).toBe(2);
    expect(gets.length).toBe(0);
  });
});

describe("[SF] gộp chỉ thay NGUỒN byte — mọi hàng rào chạy TRƯỚC, cho TỪNG request", () => {
  it("[SF-14] người dùng KHÁC phiên (JWT khớp vé? không) đến giữa lúc lượt tải của người kia đang bay ⇒ 403, KHÔNG nhận byte", async () => {
    const a = lay();
    await choDen(() => gets.length >= 1);
    auth.mockResolvedValueOnce({ user: { id: "nguoi-khac" } }); // phiên của request kế tiếp
    const b = await lay();
    expect(b.status).toBe(403);
    expect(b.headers.get("Content-Length")).toBeNull();
    expect(gets.length).toBe(1);
    gets[0]!.mo();
    expect((await a).status).toBe(200);
  });

  it("[SF-15] vé của gói KHÁC (URL cùng đường dẫn) và không vé ⇒ 403; source.zip ⇒ 404 — đều không gộp, không gọi R2 thêm", async () => {
    const a = lay();
    await choDen(() => gets.length >= 1);
    const veKhac = ve({ packageId: GOI_KHAC });
    const khacGoi = await GET(yeuCau(REL, { cookie: veKhac }), { params: Promise.resolve({ path: [GOI, ...REL.split("/")] }) }); // vé gói KHÁC, URL gói này
    expect(khacGoi.status).toBe(403);
    const khongVe = await GET(new NextRequest(`http://localhost/api/scorm/asset/${GOI}/${REL}`), { params: Promise.resolve({ path: SEGS }) });
    expect(khongVe.status).toBe(403);
    const zip = await lay("source.zip");
    expect(zip.status).toBe(404);
    expect(gets.length, "không hàng rào nào lọt xuống R2").toBe(1);
    gets[0]!.mo();
    expect((await a).status).toBe(200);
  });

  it("[SF-17] gộp chỉ chia sẻ BYTE, không chia sẻ HEADER: leader bằng cookie, follower là hop đầu (?t) ⇒ follower có Set-Cookie + `no-store`, leader thì không", async () => {
    const leader = lay();
    await choDen(() => gets.length >= 1);
    const token = ve();
    const hopDau = GET(new NextRequest(`http://localhost/api/scorm/asset/${GOI}/${REL}?t=${encodeURIComponent(token)}`), { params: Promise.resolve({ path: SEGS }) });
    await nghi(40);
    expect(gets.length).toBe(1);
    gets[0]!.mo();
    const [rl, rh] = await Promise.all([leader, hopDau]);
    expect([rl.status, rh.status]).toEqual([200, 200]);
    expect(rl.headers.get("set-cookie")).toBeNull();
    expect(rl.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(rh.headers.get("set-cookie") ?? "").toContain(`${SCORM_COOKIE_VE}=`);
    expect(rh.headers.get("set-cookie") ?? "").toContain(`Path=/api/scorm/asset/${GOI}`);
    expect(rh.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await thanBuf(rh)).equals(await thanBuf(rl))).toBe(true);
  });

  it("[SF-16] ĐỐI CHỨNG: chính user hợp lệ đến giữa lúc lượt tải bay VẪN được gộp (nên 2 ca trên không phải do gộp hỏng hẳn)", async () => {
    const a = lay();
    await choDen(() => gets.length >= 1);
    const b = lay();
    await nghi(30);
    gets[0]!.mo();
    expect([(await a).status, (await b).status]).toEqual([200, 200]);
    expect(gets.length).toBe(1);
  });
});

describe("[SFW] làm nóng CHUNG bản đồ với route + chính sách gọn", () => {
  const PRE = PREFIX;
  const dung = (ten: string, size: number) => {
    kichThuoc.set(`${PRE}${ten}`, size);
    listing.push({ Key: `${PRE}${ten}`, Size: size });
  };
  /** Mở lần lượt MỌI lệnh GetObject cho tới khi `xong` hoàn tất (làm nóng phát lệnh dần vì giới hạn 12 đồng thời). */
  async function moHet(xong: Promise<unknown>): Promise<void> {
    let ketThuc = false;
    void xong.finally(() => (ketThuc = true));
    const daMo = new Set<Get>();
    const han = Date.now() + 10_000;
    while (!ketThuc && Date.now() < han) {
      for (const g of gets) {
        if (daMo.has(g) || g.daHuy) continue;
        daMo.add(g);
        g.mo();
      }
      await nghi(2);
    }
    await xong;
  }

  it("[SFW-1] route đang tải A, làm nóng đến SAU ⇒ làm nóng GỘP vào lượt của route: A chỉ bị GET 1 lần", async () => {
    dung("a.js", 100);
    dung("b.js", 200);
    const r = lay("a.js");
    await choDen(() => gets.length >= 1);
    lamNong.mockImplementation((p: string) => lamNongThat.f!(p));
    const nong = lamNongThat.f!(PRE);
    await choDen(() => soGet(`${PRE}b.js`) >= 1);
    await nghi(30);
    expect(soGet(`${PRE}a.js`), "a.js đang do route tải ⇒ làm nóng không gọi R2 lần hai").toBe(1);
    const kq = await Promise.all([r, moHet(nong).then(() => nong)]);
    expect(kq[0].status).toBe(200);
    expect(kq[1]).toMatchObject({ tai: 2, loi: 0 });
    expect(soGet(`${PRE}a.js`)).toBe(1);
    expect(soGet(`${PRE}b.js`)).toBe(1);
    expect((await docMetaDem(`${PRE}a.js`))?.size).toBe(100);
  });

  it("[SFW-2] làm nóng đang tải A, route đến SAU ⇒ route gộp vào lượt của làm nóng: A chỉ bị GET 1 lần, route vẫn nhận 200", async () => {
    dung("a.js", 100);
    const nong = lamNongThat.f!(PRE);
    await choDen(() => soGet(`${PRE}a.js`) >= 1);
    const r = lay("a.js");
    await nghi(40);
    expect(soGet(`${PRE}a.js`)).toBe(1);
    gets[0]!.mo();
    expect((await r).status).toBe(200);
    expect(await nong).toMatchObject({ tai: 1, loi: 0 });
    expect(soGet(`${PRE}a.js`)).toBe(1);
  });

  it("[SFW-3] làm nóng BỎ tệp lớn hơn ngưỡng (video) và chỉ GET tệp ≤ ngưỡng; tệp đúng bằng ngưỡng vẫn được tải", async () => {
    dung("video1.mp4", NGUONG_LAM_NONG_BYTE + 1);
    dung("vua.bin", NGUONG_LAM_NONG_BYTE);
    dung("nho.js", 100);
    const nong = lamNongThat.f!(PRE);
    await moHet(nong);
    const kq = await nong;
    expect(kq).toMatchObject({ tai: 2, boQua: 1, loi: 0 });
    expect(soGet(`${PRE}video1.mp4`), "video không được nạp trước").toBe(0);
    expect(soGet(`${PRE}vua.bin`)).toBe(1);
    expect(soGet(`${PRE}nho.js`)).toBe(1);
  });

  it("[SFW-4] TỆP NHỎ TRƯỚC: khi hết khe tải, tệp vừa/lớn ở cuối danh sách thật sự chờ sau mọi tệp nhỏ (dù R2 liệt kê chúng đầu tiên)", async () => {
    // Liệt kê: 2 tệp to đứng đầu, 12 tệp nhỏ đứng sau. Không sắp xếp ⇒ 12 lệnh đầu gồm 2 tệp to; có sắp xếp ⇒ 12 lệnh đầu đều là tệp nhỏ.
    dung("to-1.bin", 5 * MB);
    dung("to-2.bin", 3 * MB);
    for (let i = 0; i < 12; i++) dung(`nho-${String(i).padStart(2, "0")}.js`, 100 + i);
    const nong = lamNongThat.f!(PRE);
    await choDen(() => gets.length >= 12);
    await nghi(60);
    expect(gets.length, "trần 12 tải đồng thời").toBe(12);
    expect(gets.map((g) => g.key).filter((k) => k.includes("to-")), "chưa tệp to nào được phát lệnh").toEqual([]);
    await moHet(nong);
    expect((await nong).tai).toBe(14);
  });

  it("[SFW-5] làm nóng tệp nhỏ mà R2 báo LỚN (danh sách lỗi thời) ⇒ bỏ qua tệp, không lỗi, thân được nhả", async () => {
    dung("la.js", 100);
    kichThuoc.set(`${PRE}la.js`, NGUONG_DEM_BYTE + 5);
    const nong = lamNongThat.f!(PRE);
    await moHet(nong);
    expect(await nong).toMatchObject({ tai: 0, boQua: 1, loi: 0 });
    expect(gets[0]!.thanDaTao[0]!.destroyed).toBe(true);
  });
});

describe("[SFD] `taiTepNhoDungChung` gọi trực tiếp", () => {
  it("[SFD-1] hai lời gọi cùng khoá ⇒ cùng kết quả (cùng Buffer), 1 lệnh R2; khoá khác ⇒ lệnh khác", async () => {
    const a = taiTepNhoDungChung(KEY);
    const b = taiTepNhoDungChung(KEY);
    const c = taiTepNhoDungChung(`${PREFIX}res/khac.js`);
    await choDen(() => gets.length >= 2);
    gets.forEach((g) => g.mo());
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(gets.length).toBe(2);
    if (ra.loai !== "nho" || rb.loai !== "nho" || rc.loai !== "nho") throw new Error("phải là tệp nhỏ");
    expect(ra.bytes).toBe(rb.bytes);
    expect(ra.bytes).not.toBe(rc.bytes);
  });

  it("[SFD-2] signal đã abort từ trước ⇒ reject AbortError NGAY, không gọi R2, không để lại entry", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(taiTepNhoDungChung(KEY, { signal: ctl.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(gets.length).toBe(0);
    const ok = taiTepNhoDungChung(KEY);
    await choDen(() => gets.length >= 1);
    gets[0]!.mo();
    expect((await ok).loai).toBe("nho");
  });

  it("[SFD-3] người chờ có signal rút lui sau khi lượt tải đã XONG ⇒ không huỷ gì, không ném (ngắt muộn vô hại)", async () => {
    const ctl = new AbortController();
    const p = taiTepNhoDungChung(KEY, { signal: ctl.signal });
    await choDen(() => gets.length >= 1);
    gets[0]!.mo();
    expect((await p).loai).toBe("nho");
    ctl.abort();
    await nghi(10);
    expect(gets[0]!.daHuy).toBe(false);
  });

  it("[SFD-5] người chờ CUỐI CÙNG ngắt rồi NGAY TRONG CÙNG nhịp có người mới đến ⇒ người mới mở lượt MỚI, không bám vào lượt vừa bị huỷ (entry gỡ ĐỒNG BỘ khi ngắt)", async () => {
    const a = new AbortController();
    const b = new AbortController();
    const pa = taiTepNhoDungChung(KEY, { signal: a.signal });
    const pb = taiTepNhoDungChung(KEY, { signal: b.signal });
    await choDen(() => gets.length >= 1);
    a.abort();
    b.abort();
    const pc = taiTepNhoDungChung(KEY); // cùng nhịp đồng bộ, TRƯỚC khi lời từ chối của lượt cũ kịp lan ra
    await expect(pa).rejects.toMatchObject({ name: "AbortError" });
    await expect(pb).rejects.toMatchObject({ name: "AbortError" });
    await choDen(() => gets.length >= 2);
    gets[1]!.mo();
    expect((await pc).loai, "người mới không được nhận lỗi huỷ của lượt cũ").toBe("nho");
  });

  it("[SFD-4] `choGhiDia`: chỉ trả khi tệp ĐÃ nằm trên đĩa (đợt làm nóng không báo xong khi đĩa còn trống)", async () => {
    const p = taiTepNhoDungChung(KEY, { choGhiDia: true });
    await choDen(() => gets.length >= 1);
    gets[0]!.mo();
    await p;
    expect(await docMetaDem(KEY), "trả về nghĩa là đã ghi đĩa").not.toBeNull();
  });
});
