// @vitest-environment node
// Đường phát asset SCORM (12/10/2026): hàng rào TRƯỚC khi gọi R2, Range cho video, 304, phân loại lỗi, vé gia hạn, cookie theo gói.
// R2 / phiên đăng nhập / DB đều giả lập — không cần mạng. (Đặt ở lib/scorm/: `tests/scorm/` không nằm trong `include` của vitest
// lẫn allowlist của gương CI.)
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

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
// Phiên SỐNG (đối chiếu DB) mà route hỏi khi GIA HẠN vé trượt: mặc định trả đúng phiên `auth()`; nhóm [SCR-V] cho nó chết / ném lỗi.
const phienSong = vi.fn();
vi.mock("@/lib/auth/live-session", () => ({ requireLiveSession: () => phienSong() }));
vi.mock("@/lib/db", () => ({ db: { scormPackage: { findUnique: (a: unknown) => timPkg(a) } } }));
vi.mock("@/lib/flags", () => ({ isScormEnabled: () => flag() }));
vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({ send: (cmd: unknown, opts: unknown) => send(cmd, opts) }),
  getR2Bucket: () => "bucket-test",
}));

// Làm nóng gói chạm R2 (liệt kê + tải) — giả lập để test route không bị lẫn lệnh; các hàm đệm đĩa còn lại là THẬT (thư mục tạm).
const lamNong = vi.fn();
const ghiNhan = vi.fn();
vi.mock("@/lib/scorm/dem-dia", async (goc) => ({
  ...(await goc<typeof import("@/lib/scorm/dem-dia")>()),
  lamNongGoi: (...a: unknown[]) => lamNong(...a),
  ghiNhanLoiR2: (...a: unknown[]) => ghiNhan(...a),
}));

import { NextRequest } from "next/server";
import { GET, HEAD } from "../../app/api/scorm/asset/[...path]/route";
import { docMetaDem, _datLaiTrangThai } from "./dem-dia";
import { HAN_CHO_R2_MS, NGUONG_DEM_BYTE, _datLaiBoNhoPhien, _datLaiLog, docDemSuKien } from "./luong-r2";
import { SCORM_COOKIE_VE, SCORM_COOKIE_VE_CU } from "./asset-url";
import { SCORM_GIA_HAN_KHI_CON_MS, signScormTicket, verifyScormTicket } from "./ticket";

const GOI = "cmuz8xsix01vlh3dv9t2bz8d1";
const GOI_KHAC = "cmuz8xsiy01vmh3dv9t2bz8d2";
const PREFIX = `scorm/${GOI}/`;
const USER = "gv-1";

process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
process.env.AUTH_SECRET = process.env.NEXTAUTH_SECRET;

type Fake = { Body?: unknown; ContentLength?: number; ContentType?: string; ETag?: string; ContentRange?: string; LastModified?: Date };
// Thân giả giống thân SDK thật: LÀ một Readable (luồng Node) có thêm các hàm transformTo*. Sinh từng mảnh 64KB theo yêu cầu
// (`daSinh` = số byte nguồn đã bị đọc) để test thấy được backpressure — nguồn không bị hút cạn khi chưa ai đọc.
const MANH = 64 * 1024;
function body(bytes: number) {
  const st = { daSinh: 0 };
  async function* sinh() {
    for (let o = 0; o < bytes; o += MANH) {
      const n = Math.min(MANH, bytes - o);
      st.daSinh += n;
      yield Buffer.alloc(n, 7);
    }
  }
  return Object.assign(Readable.from(sinh(), { objectMode: false }), {
    st,
    transformToByteArray: vi.fn(async () => new Uint8Array(bytes).fill(7)),
    transformToWebStream: vi.fn(() => Readable.toWeb(Readable.from([Buffer.alloc(bytes, 7)]))),
  });
}
function tep(bytes: number, extra: Partial<Fake> = {}): Fake {
  return { Body: body(bytes), ContentLength: bytes, ContentType: "application/javascript", ETag: '"abc"', ...extra };
}
function ve(over: Partial<{ packageId: string; userId: string; prefix: string | null }> = {}, ttl = 600, now = Date.now()) {
  const prefix = over.prefix === null ? undefined : (over.prefix ?? PREFIX);
  return signScormTicket({ packageId: over.packageId ?? GOI, sessionId: "buoi-1", userId: over.userId ?? USER, prefix }, ttl, now);
}
function yeuCau(duongDan: string, o: { t?: string; cookie?: string; cookieTen?: string; headers?: Record<string, string> } = {}) {
  const url = `http://localhost/api/scorm/asset/${duongDan}${o.t ? `?t=${encodeURIComponent(o.t)}` : ""}`;
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = `${o.cookieTen ?? SCORM_COOKIE_VE}=${o.cookie}`;
  return new NextRequest(url, { headers });
}
const goi = (req: NextRequest, segs: string[]) => GET(req, { params: Promise.resolve({ path: segs }) });
const lenhCuoi = () => send.mock.calls.at(-1)![0] as { input: Record<string, unknown> };

let thuMucDem = "";
beforeEach(async () => {
  vi.clearAllMocks();
  _datLaiLog();
  _datLaiBoNhoPhien();
  thuMucDem = await mkdtemp(join(tmpdir(), "scorm-route-test-"));
  process.env.SCORM_CACHE_DIR = thuMucDem;
  process.env.SCORM_CACHE_OFF = "1"; // mặc định TẮT đệm đĩa để các ca R2 ở trên xác định; nhóm [SCR-D] bật lại
  _datLaiTrangThai();
  flag.mockReturnValue(true);
  auth.mockResolvedValue({ user: { id: USER } });
  phienSong.mockReset();
  phienSong.mockResolvedValue({ user: { id: USER } });
  timPkg.mockResolvedValue({ storagePrefix: PREFIX });
  send.mockImplementation(async () => tep(1000));
});
afterEach(async () => {
  vi.useRealTimers();
  // Lượt ghi đệm chạy NỀN (void) có thể còn dở khi test kết thúc ⇒ thử lại thay vì ENOTEMPTY ngẫu nhiên.
  await rm(thuMucDem, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

describe("[SCR-G] hàng rào chạy TRƯỚC khi gọi R2 (return sớm sau GetObject = rò socket)", () => {
  it("[SCR-G1] cờ tắt / không vé / vé sai / hết hạn / user khác ⇒ 404 / 403 và KHÔNG gọi R2", async () => {
    flag.mockReturnValueOnce(false);
    expect((await goi(yeuCau(`${GOI}/res/a.js`, { t: ve() }), [GOI, "res", "a.js"])).status).toBe(404);
    expect((await goi(yeuCau(`${GOI}/res/a.js`), [GOI, "res", "a.js"])).status).toBe(403);
    expect((await goi(yeuCau(`${GOI}/res/a.js`, { t: "rac.rac" }), [GOI, "res", "a.js"])).status).toBe(403);
    expect((await goi(yeuCau(`${GOI}/res/a.js`, { t: ve({}, 600, Date.now() - 700_000) }), [GOI, "res", "a.js"])).status).toBe(403);
    auth.mockResolvedValueOnce({ user: { id: "nguoi-khac" } });
    expect((await goi(yeuCau(`${GOI}/res/a.js`, { t: ve() }), [GOI, "res", "a.js"])).status).toBe(403);
    auth.mockResolvedValueOnce(null);
    expect((await goi(yeuCau(`${GOI}/res/a.js`, { t: ve() }), [GOI, "res", "a.js"])).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCR-G2] mã gói trong URL KHÁC mã gói của vé ⇒ 403, không gọi R2 (đổi URL sang gói khác)", async () => {
    const r = await goi(yeuCau(`${GOI_KHAC}/res/a.js`, { t: ve() }), [GOI_KHAC, "res", "a.js"]);
    expect(r.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCR-G3] path traversal / segment rỗng ⇒ 403; chỉ có mã gói không có tệp ⇒ 404 — không gọi R2", async () => {
    expect((await goi(yeuCau(`${GOI}/../x`, { t: ve() }), [GOI, "..", "x"])).status).toBe(403);
    expect((await goi(yeuCau(`${GOI}/a`, { t: ve() }), [GOI, "a" + String.fromCharCode(92) + "b"])).status).toBe(403);
    expect((await goi(yeuCau(`${GOI}`, { t: ve() }), [GOI])).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("[SCR-P] prefix: vé mới khỏi tra DB, vé cũ vẫn chạy", () => {
  it("[SCR-P1] vé CÓ prefix ⇒ KHÔNG tra DB; key R2 = prefix của VÉ + đường dẫn (không theo URL)", async () => {
    const r = await goi(yeuCau(`${GOI}/res/data/player.js`, { t: ve() }), [GOI, "res", "data", "player.js"]);
    expect(r.status).toBe(200);
    expect(timPkg).not.toHaveBeenCalled();
    expect(lenhCuoi().input.Key).toBe(`${PREFIX}res/data/player.js`);
    expect(lenhCuoi().input.Bucket).toBe("bucket-test");
  });

  it("[SCR-P2] vé CŨ (không prefix) + URL kiểu cũ (không mã gói) ⇒ tra DB, vẫn phục vụ đúng", async () => {
    const r = await goi(yeuCau("res/data/player.js", { cookie: ve({ prefix: null }), cookieTen: SCORM_COOKIE_VE_CU }), ["res", "data", "player.js"]);
    expect(r.status).toBe(200);
    expect(timPkg).toHaveBeenCalledTimes(1);
    expect(lenhCuoi().input.Key).toBe(`${PREFIX}res/data/player.js`);
  });

  it("[SCR-P3] gói không còn trong DB (vé cũ) ⇒ 404", async () => {
    timPkg.mockResolvedValueOnce(null);
    const r = await goi(yeuCau("res/a.js", { cookie: ve({ prefix: null }), cookieTen: SCORM_COOKIE_VE_CU }), ["res", "a.js"]);
    expect(r.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("[SCR-B] truyền dòng / nạp RAM + Range cho video", () => {
  it("[SCR-B1] tệp NHỎ ⇒ nạp RAM (nhả socket R2 ngay), 200 + Content-Length + Accept-Ranges", async () => {
    const f = tep(NGUONG_DEM_BYTE - 1);
    send.mockResolvedValueOnce(f);
    const r = await goi(yeuCau(`${GOI}/res/a.js`, { t: ve() }), [GOI, "res", "a.js"]);
    expect(r.status).toBe(200);
    // Đã đọc HẾT thân trước khi trả header ⇒ socket R2 đã được nhả (không còn luồng nào đang mở cho tệp nhỏ).
    expect((f.Body as ReturnType<typeof body>).readableEnded).toBe(true);
    expect(r.headers.get("Accept-Ranges")).toBe("bytes");
    expect(r.headers.get("Content-Length")).toBe(String(NGUONG_DEM_BYTE - 1));
    expect(r.headers.get("ETag")).toBe('"abc"');
  });

  it("[SCR-B2] tệp LỚN ⇒ truyền dòng, KHÔNG nạp cả tệp vào RAM", async () => {
    const f = tep(NGUONG_DEM_BYTE + 1, { ContentType: "video/mp4" });
    send.mockResolvedValueOnce(f);
    const r = await goi(yeuCau(`${GOI}/res/data/video1.mp4`, { cookie: ve() }), [GOI, "res", "data", "video1.mp4"]);
    expect(r.status).toBe(200);
    // Chưa ai đọc phản hồi ⇒ nguồn chỉ bị hút tới ngưỡng hàng đợi, KHÔNG bị nạp cả tệp vào RAM.
    const nguon = f.Body as ReturnType<typeof body>;
    expect(nguon.readableEnded).toBe(false);
    expect(nguon.st.daSinh).toBeLessThan(NGUONG_DEM_BYTE);
    expect(r.headers.get("Content-Type")).toBe("video/mp4");
    expect((await r.arrayBuffer()).byteLength).toBe(NGUONG_DEM_BYTE + 1);
  });

  it("[SCR-B3] `Range: bytes=0-` ⇒ chuyển cho R2, trả 206 + Content-Range + Content-Length của KHOẢNG, truyền dòng", async () => {
    const f = tep(1000, { ContentRange: "bytes 0-999/5000000", ContentType: "video/mp4" });
    send.mockResolvedValueOnce(f);
    const r = await goi(yeuCau(`${GOI}/res/data/video1.mp4`, { cookie: ve(), headers: { range: "bytes=0-" } }), [GOI, "res", "data", "video1.mp4"]);
    expect(lenhCuoi().input.Range).toBe("bytes=0-");
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 0-999/5000000");
    expect(r.headers.get("Content-Length")).toBe("1000");
    expect((await r.arrayBuffer()).byteLength).toBe(1000);
  });

  it("[SCR-B4] Range nhiều khoảng / sai dạng ⇒ bỏ qua, trả cả tệp (không đoán)", async () => {
    await goi(yeuCau(`${GOI}/res/a.js`, { cookie: ve(), headers: { range: "bytes=0-9,20-29" } }), [GOI, "res", "a.js"]);
    expect(lenhCuoi().input.Range).toBeUndefined();
  });

  it("[SCR-B5] R2 báo InvalidRange ⇒ 416", async () => {
    send.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "InvalidRange", $metadata: { httpStatusCode: 416 } }));
    const r = await goi(yeuCau(`${GOI}/res/data/video1.mp4`, { cookie: ve(), headers: { range: "bytes=999999999-" } }), [GOI, "res", "data", "video1.mp4"]);
    expect(r.status).toBe(416);
  });
});

describe("[SCR-C] 304 + phân loại lỗi R2 (không nuốt hết thành 404)", () => {
  it("[SCR-C1] If-None-Match chuyển cho R2; R2 báo NotModified ⇒ 304, không thân", async () => {
    send.mockRejectedValueOnce(Object.assign(new Error("nm"), { name: "NotModified", $metadata: { httpStatusCode: 304 } }));
    const r = await goi(yeuCau(`${GOI}/res/a.js`, { cookie: ve(), headers: { "if-none-match": '"abc"' } }), [GOI, "res", "a.js"]);
    expect(lenhCuoi().input.IfNoneMatch).toBe('"abc"');
    expect(r.status).toBe(304);
    expect(await r.text()).toBe("");
  });

  it("[SCR-C2] NoSuchKey ⇒ 404; lỗi lạ ⇒ 502; hết hạn chờ (AbortError) ⇒ 504", async () => {
    const lo = vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValueOnce(Object.assign(new Error("k"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }));
    expect((await goi(yeuCau(`${GOI}/res/a.js`, { cookie: ve() }), [GOI, "res", "a.js"])).status).toBe(404);
    send.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect((await goi(yeuCau(`${GOI}/res/a.js`, { cookie: ve() }), [GOI, "res", "a.js"])).status).toBe(502);
    send.mockRejectedValueOnce(Object.assign(new Error("a"), { name: "AbortError" }));
    expect((await goi(yeuCau(`${GOI}/res/a.js`, { cookie: ve() }), [GOI, "res", "a.js"])).status).toBe(504);
    expect(lo).toHaveBeenCalled(); // lỗi hạ tầng được GHI LẠI, không câm
    lo.mockRestore();
  });

  it("[SCR-C3] gọi R2 có HẠN CHỜ: truyền abortSignal, và tín hiệu thật sự bị huỷ khi quá hạn", async () => {
    vi.useFakeTimers();
    try {
      let tin: AbortSignal | undefined;
      send.mockImplementationOnce((_c: unknown, o: { abortSignal: AbortSignal }) => {
        tin = o.abortSignal;
        return new Promise((_ok, loi) => o.abortSignal.addEventListener("abort", () => loi(Object.assign(new Error("a"), { name: "AbortError" }))));
      });
      const lo = vi.spyOn(console, "error").mockImplementation(() => {});
      const cho = goi(yeuCau(`${GOI}/res/a.js`, { cookie: ve() }), [GOI, "res", "a.js"]);
      // Hạn chờ chỉ được đặt SAU các await phía trước (auth, đệm) — đợi tới khi R2 thật sự được gọi rồi mới quay đồng hồ.
      for (let i = 0; i < 200 && !tin; i++) await Promise.resolve();
      expect(tin).toBeDefined();
      await vi.advanceTimersByTimeAsync(HAN_CHO_R2_MS + 10);
      const r = await cho;
      expect(tin?.aborted).toBe(true);
      expect(r.status).toBe(504);
      lo.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("[SCR-K] cookie vé THEO GÓI + gia hạn trượt", () => {
  it("[SCR-K1] hop đầu (?t) ⇒ đặt cookie `scorm_tk` với path RIÊNG của gói; Cache-Control không giữ bản có vé", async () => {
    const r = await goi(yeuCau(`${GOI}/res/index.html`, { t: ve() }), [GOI, "res", "index.html"]);
    const sc = r.headers.get("set-cookie") ?? "";
    expect(sc).toContain(`${SCORM_COOKIE_VE}=`);
    expect(sc).toContain(`Path=/api/scorm/asset/${GOI}`);
    expect(sc.toLowerCase()).toContain("httponly");
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("[SCR-K2] asset con (cookie) còn lâu mới hết hạn ⇒ KHÔNG đặt lại cookie; cache riêng tư như cũ (3600s)", async () => {
    const r = await goi(yeuCau(`${GOI}/res/data/img1.png`, { cookie: ve() }), [GOI, "res", "data", "img1.png"]);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it("[SCR-K3] vé sắp hết ⇒ cấp lại cookie với vé MỚI cùng quyền (asset nạp trễ sau phút thứ 10 không ăn 403)", async () => {
    const now = Date.now();
    const sapHet = ve({}, 600, now - 600_000 + SCORM_GIA_HAN_KHI_CON_MS - 5000); // còn < 5 phút
    const r = await goi(yeuCau(`${GOI}/res/data/img1.png`, { cookie: sapHet }), [GOI, "res", "data", "img1.png"]);
    const sc = r.headers.get("set-cookie") ?? "";
    expect(sc).toContain(`${SCORM_COOKIE_VE}=`);
    const giaTri = decodeURIComponent(/scorm_tk=([^;]+)/.exec(sc)![1]!);
    const p = verifyScormTicket(giaTri).payload!;
    expect(p.packageId).toBe(GOI);
    expect(p.userId).toBe(USER);
    expect(p.prefix).toBe(PREFIX);
    expect(p.exp).toBeGreaterThan(now + 9 * 60_000);
  });
});

describe("[SCR-W] dây nối: URL mới ở cả hai player và cả hai trang cấp vé", () => {
  it("[SCR-W1] cả hai trang ký prefix vào vé; player dùng URL mang mã gói", async () => {
    const { readFileSync } = await import("node:fs");
    const doc = (p: string) =>
      readFileSync(p, "utf8")
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
        .join("\n");
    for (const f of ["app/(admin)/admin/scorm/play/[id]/page.tsx", "app/(teacher)/teacher/scorm/play/[id]/page.tsx"]) {
      expect(doc(f), f).toContain("prefix: pkg.storagePrefix");
      expect(doc(f), f).toContain("packageId={pkg.id}");
    }
    expect(doc("components/admin/scorm-player.tsx")).toContain("taoUrlAssetScorm(packageId, launchUrl, launchTicket)");
    expect(doc("components/admin/pdf-slide-player.tsx")).toContain("taoUrlAssetScorm(packageId, launchUrl, ticket)");
    // Lớp phủ "Tải lại" phải nạp lại CẢ TRANG (cấp vé mới) — nạp lại iframe sẽ dùng vé có thể đã hết hạn.
    expect(doc("components/admin/scorm-player.tsx")).toContain("window.location.reload()");
  });
});

describe("[SCR-D] đệm đĩa: phục vụ không chạm R2, và KHÔNG là đường vòng qua các hàng rào", () => {
  beforeEach(() => {
    delete process.env.SCORM_CACHE_OFF;
  });
  const KEY = `${PREFIX}res/data/player.js`;
  const SEGS = [GOI, "res", "data", "player.js"];
  async function choCoTrenDia(key: string) {
    for (let i = 0; i < 50; i++) {
      if (await docMetaDem(key)) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("tệp chưa được ghi xuống đĩa");
  }
  async function lamDay() {
    // lượt TRƯỢT: lấy từ R2 rồi ghi xuống đĩa
    send.mockResolvedValueOnce(tep(10, { ETag: '"e-dia"' }));
    const r = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve() }), SEGS);
    expect(r.status).toBe(200);
    await choCoTrenDia(KEY);
    send.mockClear();
    lamNong.mockClear();
  }

  it("[SCR-D1] trượt ⇒ lấy R2 + GHI xuống đĩa + kích hoạt làm nóng cả gói; lượt sau phục vụ từ đĩa, KHÔNG gọi R2", async () => {
    send.mockResolvedValueOnce(tep(10, { ETag: '"e-dia"' }));
    const r1 = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve() }), SEGS);
    expect(r1.status).toBe(200);
    expect(lamNong).toHaveBeenCalledTimes(1);
    expect(lamNong.mock.calls[0]![0]).toBe(PREFIX);
    await choCoTrenDia(KEY);
    send.mockClear();
    lamNong.mockClear();

    const r2 = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve() }), SEGS);
    expect(r2.status).toBe(200);
    expect(send).not.toHaveBeenCalled(); // phục vụ từ đĩa
    expect(lamNong).not.toHaveBeenCalled(); // trúng đệm thì không làm nóng lại
    expect(new Uint8Array(await r2.arrayBuffer()).length).toBe(10);
    expect(r2.headers.get("ETag")).toBe('"e-dia"');
    expect(r2.headers.get("Accept-Ranges")).toBe("bytes");
    expect(r2.headers.get("Content-Type")).toBe("application/javascript");
  });

  it("[SCR-D2] từ đĩa + `Range` ⇒ 206 đúng khoảng byte, Content-Range đủ dung lượng, không chạm R2", async () => {
    await lamDay();
    const r = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve(), headers: { range: "bytes=2-4" } }), SEGS);
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 2-4/10");
    expect(r.headers.get("Content-Length")).toBe("3");
    expect((await r.arrayBuffer()).byteLength).toBe(3);
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCR-D3] từ đĩa + khoảng QUÁ cuối tệp ⇒ 416; If-None-Match khớp ETag ⇒ 304 — đều không chạm R2", async () => {
    await lamDay();
    const r416 = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve(), headers: { range: "bytes=999-" } }), SEGS);
    expect(r416.status).toBe(416);
    const r304 = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve(), headers: { "if-none-match": '"e-dia"' } }), SEGS);
    expect(r304.status).toBe(304);
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCR-D4] đệm KHÔNG phải đường vòng: tệp đã nằm trên đĩa mà vé sai / user khác / mã gói khác / thiếu vé ⇒ vẫn 403", async () => {
    await lamDay();
    expect((await goi(yeuCau(`${GOI}/res/data/player.js`), SEGS)).status).toBe(403); // không vé
    expect((await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: "rac.rac" }), SEGS)).status).toBe(403);
    auth.mockResolvedValueOnce({ user: { id: "nguoi-khac" } });
    expect((await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve() }), SEGS)).status).toBe(403);
    // URL trỏ gói khác dù tệp cùng đường dẫn đang nằm trong đệm của gói này
    expect((await goi(yeuCau(`${GOI_KHAC}/res/data/player.js`, { cookie: ve() }), [GOI_KHAC, "res", "data", "player.js"])).status).toBe(403);
    // Vé của gói KHÁC (prefix khác) đọc cùng đường dẫn ⇒ khoá đệm khác ⇒ trượt, KHÔNG nhận tệp của gói này
    const veKhac = ve({ packageId: GOI_KHAC, prefix: `scorm/${GOI_KHAC}/` });
    send.mockResolvedValueOnce(tep(7));
    const r = await goi(yeuCau(`${GOI_KHAC}/res/data/player.js`, { cookie: veKhac }), [GOI_KHAC, "res", "data", "player.js"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.headers.get("Content-Length")).toBe("7");
    await choCoTrenDia(`scorm/${GOI_KHAC}/res/data/player.js`); // chờ lượt ghi nền xong rồi mới dọn thư mục tạm
  });

  it("[SCR-D5] trúng đệm ở hop đầu (có ?t) vẫn đặt cookie vé theo gói", async () => {
    await lamDay();
    const r = await goi(yeuCau(`${GOI}/res/data/player.js`, { t: ve() }), SEGS);
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie") ?? "").toContain(`Path=/api/scorm/asset/${GOI}`);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

// ── 24/10/2026: vá nốt ────────────────────────────────────────────────────────────────────────────────────────────────────
const tenLenh = (c: unknown) => (c as { constructor: { name: string } }).constructor.name;
const lenhTheoTen = (ten: string) => send.mock.calls.map((c) => c[0]).filter((c) => tenLenh(c) === ten) as Array<{ input: Record<string, unknown> }>;
const ctxPath = (segs: string[]) => ({ params: Promise.resolve({ path: segs }) });

describe("[SCR-S] tệp NỘI BỘ cùng prefix (source.zip, _src/) — không bao giờ phục vụ", () => {
  const CAC_DUONG: Array<[string, string[]]> = [
    ["source.zip ở gốc gói", [GOI, "source.zip"]],
    ["Source.ZIP (đổi hoa-thường)", [GOI, "Source.ZIP"]],
    ["source.zip. (dấu chấm cuối)", [GOI, "source.zip."]],
    ["%2573ource.zip (mã hoá phần trăm kép)", [GOI, "%2573ource.zip"]],
    ["_src/package.zip (đường presign mới)", [GOI, "_src", "package.zip"]],
    ["_src/x (thư mục)", [GOI, "_src", "x"]],
  ];

  it.each(CAC_DUONG)("[SCR-S1] %s ⇒ 404 và KHÔNG chạm R2", async (_ten, segs) => {
    const r = await goi(yeuCau(segs.join("/"), { t: ve() }), segs);
    expect(r.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCR-S2] URL kiểu CŨ (không mã gói, vé đang bay) cũng không lấy được source.zip", async () => {
    const r = await goi(yeuCau("source.zip", { cookie: ve({ prefix: null }), cookieTen: SCORM_COOKIE_VE_CU }), ["source.zip"]);
    expect(r.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
    expect(timPkg).not.toHaveBeenCalled(); // và chặn trước cả lượt tra DB
  });

  it("[SCR-S3] hàng rào chạy TRƯỚC đệm đĩa: dù source.zip đã nằm sẵn trong đệm (do lượt làm nóng cũ) vẫn 404", async () => {
    delete process.env.SCORM_CACHE_OFF;
    const { ghiDemTuBytes } = await import("./dem-dia");
    await ghiDemTuBytes(`${PREFIX}source.zip`, new Uint8Array(50).fill(1), { contentType: "application/zip", etag: '"z"', lastModified: null });
    expect(await docMetaDem(`${PREFIX}source.zip`)).not.toBeNull();
    const r = await goi(yeuCau(`${GOI}/source.zip`, { cookie: ve() }), [GOI, "source.zip"]);
    expect(r.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCR-S4] `%2F` lọt trong một segment (res/../source.zip dồn thành một segment) ⇒ 403, không ghép được vào khoá R2", async () => {
    const r = await goi(yeuCau(`${GOI}/x`, { t: ve() }), [GOI, "res/../source.zip"]);
    expect(r.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCR-S5] đối chứng DƯƠNG: tệp thường trong gói (kể cả tên có chữ zip) vẫn phục vụ", async () => {
    const r = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve() }), [GOI, "res", "data", "player.js"]);
    expect(r.status).toBe(200);
    const r2 = await goi(yeuCau(`${GOI}/res/source.zip.js`, { cookie: ve() }), [GOI, "res", "source.zip.js"]);
    expect(r2.status).toBe(200);
  });

  it("[SCR-S6] chặn nội bộ KHÔNG nuốt hàng rào vé: không vé vẫn là 403 (người chưa đăng nhập không thấy khác biệt 404/403)", async () => {
    const r = await goi(yeuCau(`${GOI}/source.zip`), [GOI, "source.zip"]);
    expect(r.status).toBe(403);
  });
});

describe("[SCR-H] HEAD tường minh — header thôi, KHÔNG kéo thân từ R2", () => {
  it("[SCR-H1] HEAD ⇒ HeadObject, KHÔNG GetObject; Content-Length/Content-Type/ETag/Accept-Ranges đúng; thân rỗng", async () => {
    send.mockImplementation(async (c: unknown) =>
      tenLenh(c) === "HeadObjectCommand" ? { ContentLength: 73_000_000, ContentType: "video/mp4", ETag: '"vid"', LastModified: new Date(Date.UTC(2026, 9, 1)) } : tep(1),
    );
    const segs = [GOI, "res", "data", "video1.mp4"];
    const r = await HEAD(yeuCau(segs.join("/"), { cookie: ve() }), ctxPath(segs));
    expect(r.status).toBe(200);
    expect(lenhTheoTen("GetObjectCommand")).toHaveLength(0);
    expect(lenhTheoTen("HeadObjectCommand")).toHaveLength(1);
    expect(lenhTheoTen("HeadObjectCommand")[0]!.input.Key).toBe(`${PREFIX}res/data/video1.mp4`);
    expect(r.headers.get("Content-Length")).toBe("73000000");
    expect(r.headers.get("Content-Type")).toBe("video/mp4");
    expect(r.headers.get("ETag")).toBe('"vid"');
    expect(r.headers.get("Accept-Ranges")).toBe("bytes");
    expect(r.headers.get("Last-Modified")).toContain("2026");
    expect(await r.text()).toBe("");
    expect(lamNong).not.toHaveBeenCalled(); // HEAD không kích hoạt làm nóng
  });

  it("[SCR-H2] HEAD + Range ⇒ 206 + Content-Range + Content-Length của KHOẢNG; khoảng quá cuối ⇒ 416 `bytes */size`", async () => {
    send.mockImplementation(async (c: unknown) => (tenLenh(c) === "HeadObjectCommand" ? { ContentLength: 1000, ContentType: "video/mp4", ETag: '"v"' } : tep(1)));
    const segs = [GOI, "res", "v.mp4"];
    const r = await HEAD(yeuCau(segs.join("/"), { cookie: ve(), headers: { range: "bytes=100-199" } }), ctxPath(segs));
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 100-199/1000");
    expect(r.headers.get("Content-Length")).toBe("100");
    const r416 = await HEAD(yeuCau(segs.join("/"), { cookie: ve(), headers: { range: "bytes=5000-" } }), ctxPath(segs));
    expect(r416.status).toBe(416);
    expect(r416.headers.get("Content-Range")).toBe("bytes */1000");
  });

  it("[SCR-H3] HEAD đi qua ĐỦ hàng rào như GET: không vé / user khác / mã gói khác / source.zip ⇒ 403 / 403 / 403 / 404, không chạm R2", async () => {
    const hd = (segs: string[], o: Parameters<typeof yeuCau>[1] = {}) => HEAD(yeuCau(segs.join("/"), o), ctxPath(segs));
    expect((await hd([GOI, "res", "a.js"])).status).toBe(403);
    auth.mockResolvedValueOnce({ user: { id: "nguoi-khac" } });
    expect((await hd([GOI, "res", "a.js"], { cookie: ve() })).status).toBe(403);
    expect((await hd([GOI_KHAC, "res", "a.js"], { cookie: ve() })).status).toBe(403);
    expect((await hd([GOI, "source.zip"], { cookie: ve() })).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCR-H4] HEAD trúng ĐỆM ĐĨA ⇒ không chạm R2 (kể cả HeadObject), Content-Length = dung lượng tệp đệm", async () => {
    delete process.env.SCORM_CACHE_OFF;
    const { ghiDemTuBytes } = await import("./dem-dia");
    await ghiDemTuBytes(`${PREFIX}res/big.bin`, new Uint8Array(3000).fill(2), { contentType: "application/octet-stream", etag: '"d"', lastModified: null });
    const segs = [GOI, "res", "big.bin"];
    const r = await HEAD(yeuCau(segs.join("/"), { cookie: ve() }), ctxPath(segs));
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Length")).toBe("3000");
    expect(await r.text()).toBe(""); // HEAD không mang thân (không đọc đĩa)
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCR-H5] HEAD tệp không có trên R2 ⇒ 404 (NotFound của HeadObject)", async () => {
    send.mockRejectedValueOnce(Object.assign(new Error("nf"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }));
    const segs = [GOI, "res", "khong-co.js"];
    const r = await HEAD(yeuCau(segs.join("/"), { cookie: ve() }), ctxPath(segs));
    expect(r.status).toBe(404);
  });
});

describe("[SCR-R] Range / If-Range / If-None-Match đúng chuẩn, cả đĩa lẫn R2", () => {
  it("[SCR-R1] R2 báo InvalidRange ⇒ 416 kèm `Content-Range: bytes */size` (size hỏi bằng HeadObject, không đoán)", async () => {
    send.mockImplementation(async (c: unknown) => {
      if (tenLenh(c) === "HeadObjectCommand") return { ContentLength: 5_000_000 };
      throw Object.assign(new Error("x"), { name: "InvalidRange", $metadata: { httpStatusCode: 416 } });
    });
    const r = await goi(yeuCau(`${GOI}/res/v.mp4`, { cookie: ve(), headers: { range: "bytes=999999999-" } }), [GOI, "res", "v.mp4"]);
    expect(r.status).toBe(416);
    expect(r.headers.get("Content-Range")).toBe("bytes */5000000");
  });

  it("[SCR-R2] R2: `bytes=-500` (đuôi) chuyển nguyên văn; 206 giữ Content-Range của R2", async () => {
    send.mockResolvedValueOnce(tep(500, { ContentRange: "bytes 4999500-4999999/5000000", ContentType: "video/mp4" }));
    const r = await goi(yeuCau(`${GOI}/res/v.mp4`, { cookie: ve(), headers: { range: "bytes=-500" } }), [GOI, "res", "v.mp4"]);
    expect(lenhCuoi().input.Range).toBe("bytes=-500");
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 4999500-4999999/5000000");
    expect(r.headers.get("Content-Length")).toBe("500");
  });

  it("[SCR-R3] đĩa: 416 mang `Content-Range: bytes */size`; If-None-Match dạng DANH SÁCH / yếu / `*` ⇒ 304", async () => {
    delete process.env.SCORM_CACHE_OFF;
    const { ghiDemTuBytes } = await import("./dem-dia");
    await ghiDemTuBytes(`${PREFIX}res/data/player.js`, new Uint8Array(10).fill(9), { contentType: "application/javascript", etag: '"e-dia"', lastModified: "Mon, 12 Oct 2026 03:00:00 GMT" });
    const S = [GOI, "res", "data", "player.js"];
    const r416 = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve(), headers: { range: "bytes=999-" } }), S);
    expect(r416.status).toBe(416);
    expect(r416.headers.get("Content-Range")).toBe("bytes */10");
    for (const inm of ['"x", "e-dia-khac", W/"e-dia"', '"e-dia"', "*"]) {
      const r = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve(), headers: { "if-none-match": inm } }), S);
      expect(r.status, inm).toBe(304);
      expect(r.headers.get("ETag")).toBe('"e-dia"');
    }
    const khong = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve(), headers: { "if-none-match": '"khac"' } }), S);
    expect(khong.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCR-R4] đĩa + If-Range: khớp ETag ⇒ 206; LỆCH ⇒ bỏ Range, trả cả tệp 200; ETag yếu ⇒ 200", async () => {
    delete process.env.SCORM_CACHE_OFF;
    const { ghiDemTuBytes } = await import("./dem-dia");
    await ghiDemTuBytes(`${PREFIX}res/data/player.js`, new Uint8Array(10).fill(9), { contentType: "application/javascript", etag: '"e-dia"', lastModified: null });
    const S = [GOI, "res", "data", "player.js"];
    const hdr = (ifRange: string) => ({ range: "bytes=2-4", "if-range": ifRange });
    const khop = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve(), headers: hdr('"e-dia"') }), S);
    expect(khop.status).toBe(206);
    const lech = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve(), headers: hdr('"cu"') }), S);
    expect(lech.status).toBe(200);
    expect(lech.headers.get("Content-Range")).toBeNull();
    expect((await lech.arrayBuffer()).byteLength).toBe(10);
    const yeu = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve(), headers: hdr('W/"e-dia"') }), S);
    expect(yeu.status).toBe(200);
  });

  it("[SCR-R5] R2 + If-Range ETag: gửi IfMatch cùng Range; R2 báo 412 (tệp đã đổi) ⇒ lấy lại cả tệp KHÔNG Range, trả 200", async () => {
    send
      .mockRejectedValueOnce(Object.assign(new Error("pf"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } }))
      .mockResolvedValueOnce(tep(1000, { ContentType: "video/mp4" }));
    const r = await goi(yeuCau(`${GOI}/res/v.mp4`, { cookie: ve(), headers: { range: "bytes=0-99", "if-range": '"cu"' } }), [GOI, "res", "v.mp4"]);
    const gets = lenhTheoTen("GetObjectCommand");
    expect(gets).toHaveLength(2);
    expect(gets[0]!.input.Range).toBe("bytes=0-99");
    expect(gets[0]!.input.IfMatch).toBe('"cu"');
    expect(gets[1]!.input.Range).toBeUndefined();
    expect(gets[1]!.input.IfMatch).toBeUndefined();
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Range")).toBeNull();
  });
});

describe("[SCR-X] client ngắt ⇒ HUỶ luồng R2 và nhả socket ngay", () => {
  const SEGS = [GOI, "res", "data", "video1.mp4"];
  const LON = NGUONG_DEM_BYTE * 20;

  it("[SCR-X1] đọc một mảnh rồi huỷ phản hồi (trình duyệt đóng video) ⇒ thân R2 bị destroy, không bị hút tiếp", async () => {
    const f = tep(LON, { ContentType: "video/mp4" });
    send.mockResolvedValueOnce(f);
    const r = await goi(yeuCau(`${GOI}/res/data/video1.mp4`, { cookie: ve() }), SEGS);
    const rd = r.body!.getReader();
    await rd.read();
    await rd.cancel();
    const nguon = f.Body as ReturnType<typeof body>;
    expect(nguon.destroyed).toBe(true);
    expect(nguon.st.daSinh).toBeLessThan(LON / 4);
  });

  it("[SCR-X2] `req.signal` abort ⇒ thân R2 bị destroy VÀ tín hiệu huỷ của chính lệnh gọi R2 được bật (SDK đóng socket)", async () => {
    const f = tep(LON, { ContentType: "video/mp4" });
    let tin: AbortSignal | undefined;
    send.mockImplementationOnce(async (_c: unknown, o: { abortSignal: AbortSignal }) => {
      tin = o.abortSignal;
      return f;
    });
    const ctl = new AbortController();
    const req = new NextRequest(`http://localhost/api/scorm/asset/${GOI}/res/data/video1.mp4`, {
      headers: { cookie: `${SCORM_COOKIE_VE}=${ve()}` },
      signal: ctl.signal,
    });
    const r = await goi(req, SEGS);
    expect(r.status).toBe(200);
    expect(tin?.aborted).toBe(false);
    ctl.abort();
    await new Promise((x) => setTimeout(x, 10));
    expect(tin?.aborted).toBe(true);
    expect((f.Body as ReturnType<typeof body>).destroyed).toBe(true);
  });

  it("[SCR-X3] client ngắt LÚC ĐANG CHỜ header R2 ⇒ huỷ lệnh gọi R2, không log như lỗi hạ tầng", async () => {
    const lo = vi.spyOn(console, "error").mockImplementation(() => {});
    let tin: AbortSignal | undefined;
    send.mockImplementationOnce(
      (_c: unknown, o: { abortSignal: AbortSignal }) =>
        new Promise((_ok, loi) => {
          tin = o.abortSignal;
          o.abortSignal.addEventListener("abort", () => loi(Object.assign(new Error("a"), { name: "AbortError" })));
        }),
    );
    const ctl = new AbortController();
    const req = new NextRequest(`http://localhost/api/scorm/asset/${GOI}/res/a.js`, { headers: { cookie: `${SCORM_COOKIE_VE}=${ve()}` }, signal: ctl.signal });
    const cho = goi(req, [GOI, "res", "a.js"]);
    for (let i = 0; i < 200 && !tin; i++) await new Promise((x) => setTimeout(x, 1));
    ctl.abort();
    const r = await cho;
    expect(tin?.aborted).toBe(true);
    expect(r.status).toBe(499);
    expect(lo).not.toHaveBeenCalled();
    lo.mockRestore();
  });

  it("[SCR-X4] tệp NHỎ mà R2 khai sai ContentLength (thân thật lớn hơn nhiều) ⇒ chặn ở trần byte, 502, thân bị huỷ — KHÔNG phình RAM", async () => {
    const lo = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = tep(NGUONG_DEM_BYTE * 5);
    f.ContentLength = 1000; // khai nhỏ
    send.mockResolvedValueOnce(f);
    const r = await goi(yeuCau(`${GOI}/res/a.js`, { cookie: ve() }), [GOI, "res", "a.js"]);
    expect(r.status).toBe(502);
    expect((f.Body as ReturnType<typeof body>).destroyed).toBe(true);
    lo.mockRestore();
  });
});

describe("[SCR-L] cache theo kiểu URL + log có cấu trúc", () => {
  it("[SCR-L1] URL kiểu CŨ (không mã gói, trùng nhau giữa các gói) ⇒ KHÔNG cache (no-store), cả R2 lẫn đĩa lẫn 304; URL mới ⇒ max-age", async () => {
    const cu = { cookie: ve({ prefix: null }), cookieTen: SCORM_COOKIE_VE_CU };
    const r = await goi(yeuCau("res/data/player.js", cu), ["res", "data", "player.js"]);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const moi = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve() }), [GOI, "res", "data", "player.js"]);
    expect(moi.headers.get("Cache-Control")).toBe("private, max-age=3600");
    delete process.env.SCORM_CACHE_OFF;
    const { ghiDemTuBytes } = await import("./dem-dia");
    await ghiDemTuBytes(`${PREFIX}res/data/player.js`, new Uint8Array(10), { contentType: "application/javascript", etag: '"e"', lastModified: null });
    const dCu = await goi(yeuCau("res/data/player.js", cu), ["res", "data", "player.js"]);
    expect(dCu.headers.get("Cache-Control")).toBe("private, no-store");
    const dMoi = await goi(yeuCau(`${GOI}/res/data/player.js`, { cookie: ve() }), [GOI, "res", "data", "player.js"]);
    expect(dMoi.headers.get("Cache-Control")).toBe("private, max-age=3600");
    const r304 = await goi(yeuCau("res/data/player.js", { ...cu, headers: { "if-none-match": '"e"' } }), ["res", "data", "player.js"]);
    expect(r304.status).toBe(304);
    expect(r304.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("[SCR-L2] mọi phản hồi LỖI (403/404/502) đều `private, no-store` — 404 không được cache theo heuristic", async () => {
    const lo = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await goi(yeuCau(`${GOI}/res/a.js`), [GOI, "res", "a.js"])).headers.get("Cache-Control")).toBe("private, no-store");
    expect((await goi(yeuCau(`${GOI}/source.zip`, { cookie: ve() }), [GOI, "source.zip"])).headers.get("Cache-Control")).toBe("private, no-store");
    send.mockRejectedValueOnce(new Error("ECONNRESET"));
    const r502 = await goi(yeuCau(`${GOI}/res/a.js`, { cookie: ve() }), [GOI, "res", "a.js"]);
    expect(r502.status).toBe(502);
    expect(r502.headers.get("Cache-Control")).toBe("private, no-store");
    lo.mockRestore();
  });

  it("[SCR-L3] lỗi R2 được log CÓ CẤU TRÚC (packageId · khoá tương đối · mã · tên lỗi · ms) và KHÔNG chứa vé/cookie/prefix R2", async () => {
    const lo = vi.spyOn(console, "error").mockImplementation(() => {});
    const veChuoi = ve();
    send.mockRejectedValueOnce(Object.assign(new Error("boom"), { name: "SlowDown" }));
    await goi(yeuCau(`${GOI}/res/data/img1.png`, { t: veChuoi }), [GOI, "res", "data", "img1.png"]);
    expect(lo).toHaveBeenCalledTimes(1);
    const [msg, obj] = lo.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toContain("scorm-asset");
    expect(obj).toMatchObject({ packageId: GOI, rel: "res/data/img1.png", ma: 502, ten: "SlowDown" });
    expect(typeof obj.ms).toBe("number");
    const tatCa = JSON.stringify(lo.mock.calls);
    expect(tatCa).not.toContain(veChuoi);
    expect(tatCa).not.toContain(veChuoi.split(".")[0]!);
    expect(tatCa).not.toContain(PREFIX); // khoá R2 đầy đủ có prefix — chỉ log khoá tương đối
    lo.mockRestore();
  });

  it("[SCR-L4] 403 được ĐẾM theo lý do (không im lặng) và log bị nén khi dồn dập", async () => {
    const canh = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 30; i++) await goi(yeuCau(`${GOI}/res/a.js`), [GOI, "res", "a.js"]);
    await goi(yeuCau(`${GOI}/res/a.js`, { t: "rac.rac" }), [GOI, "res", "a.js"]);
    auth.mockResolvedValueOnce(null);
    await goi(yeuCau(`${GOI}/res/a.js`, { t: ve() }), [GOI, "res", "a.js"]);
    const dem = docDemSuKien();
    expect(dem["403:khong-ve"]).toBe(30);
    expect(dem["403:ve-sai-hoac-het-han"]).toBe(1);
    expect(dem["403:phien"]).toBe(1);
    expect(canh.mock.calls.filter((c) => String(c[0]).includes("khong-ve")).length).toBeLessThanOrEqual(5);
    canh.mockRestore();
  });

  it("[SCR-L5] R2 lỗi hạ tầng (502/504) ⇒ route báo `ghiNhanLoiR2` để làm nóng gói TẠM NGHỈ", async () => {
    const lo = vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValueOnce(new Error("ECONNRESET"));
    await goi(yeuCau(`${GOI}/res/a.js`, { cookie: ve() }), [GOI, "res", "a.js"]);
    expect(ghiNhan).toHaveBeenCalledTimes(1);
    send.mockRejectedValueOnce(Object.assign(new Error("nf"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }));
    await goi(yeuCau(`${GOI}/res/b.js`, { cookie: ve() }), [GOI, "res", "b.js"]);
    expect(ghiNhan).toHaveBeenCalledTimes(1); // 404 không phải lỗi hạ tầng
    lo.mockRestore();
  });
});

describe("[SCR-M] số đo: video lớn trả byte đầu KHÔNG chờ cả tệp, RAM không tăng theo kích thước tệp", () => {
  const MB = 1024 * 1024;
  const TONG = 96 * MB; // video lớn nhất gói thật ~72,6MB; lấy 96MB cho chắc
  const TRE_HEADER_MS = 60; // R2 lên header sau 60ms (thật: p50 180ms)

  /**
   * Thân R2 giả: sinh theo nhịp đọc của nhà nhận (cấp phát mới mỗi mảnh), băng thông giả lập ~100MB/s — không có độ trễ này thì
   * "chờ cả tệp" và "byte đầu" đều gần 0 và số đo vô nghĩa.
   */
  function video(tong: number) {
    const st = { daSinh: 0 };
    const r = new Readable({
      highWaterMark: MANH,
      read() {
        if (st.daSinh >= tong) return;
        // Một "gói mạng" = 8 mảnh 128KB (1MB) mỗi ~8ms (bộ hẹn giờ Windows thô ~15ms ⇒ thực tế 60–120MB/s).
        setTimeout(() => {
          for (let k = 0; k < 8 && st.daSinh < tong; k++) {
            const n = Math.min(2 * MANH, tong - st.daSinh);
            st.daSinh += n;
            this.push(Buffer.alloc(n, 5));
          }
          if (st.daSinh >= tong) this.push(null);
        }, 8);
      },
    });
    return Object.assign(r, { st });
  }
  const boNho = () => {
    const m = process.memoryUsage();
    return m.heapUsed + m.arrayBuffers;
  };

  it("[SCR-M1] route phát 96MB: byte đầu tới ngay (không chờ tải cả tệp), độ lệch sinh−nhận bị chặn, RAM đỉnh nhỏ hơn nhiều so với nạp cả tệp", async () => {
    // A) ĐƯỜNG CŨ (đối chứng): nạp cả thân vào RAM rồi mới trả — đúng `transformToByteArray()` của route trước 12/10.
    const goc = video(TONG);
    const batDauCu = performance.now();
    const m0 = boNho();
    let dinhCu = m0;
    const manh: Buffer[] = [];
    for await (const c of goc) {
      manh.push(c as Buffer);
      if (manh.length % 128 === 0) dinhCu = Math.max(dinhCu, boNho());
    }
    const gop = Buffer.concat(manh);
    dinhCu = Math.max(dinhCu, boNho());
    const byteDauCuMs = performance.now() - batDauCu; // phải chờ XONG cả tệp mới có byte đầu
    expect(gop.length).toBe(TONG);
    manh.length = 0;

    // B) ĐƯỜNG MỚI: qua chính route.
    const f = { Body: video(TONG), ContentLength: TONG, ContentType: "video/mp4", ETag: '"vid"' } as Fake;
    send.mockImplementationOnce(async () => {
      await new Promise((x) => setTimeout(x, TRE_HEADER_MS));
      return f;
    });
    const m1 = boNho();
    let dinhMoi = m1;
    const t0 = performance.now();
    const r = await goi(yeuCau(`${GOI}/res/data/video1.mp4`, { cookie: ve() }), [GOI, "res", "data", "video1.mp4"]);
    const rd = r.body!.getReader();
    const dau = await rd.read();
    const byteDauMoiMs = performance.now() - t0;
    const nguon = f.Body as ReturnType<typeof video>;
    const daSinhLucByteDau = nguon.st.daSinh;
    let nhan = dau.value!.length;
    let lechMax = nguon.st.daSinh - nhan;
    let dem = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      nhan += value.length;
      lechMax = Math.max(lechMax, nguon.st.daSinh - nhan);
      if (++dem % 128 === 0) {
        dinhMoi = Math.max(dinhMoi, boNho());
        await new Promise((x) => setImmediate(x)); // nhà nhận chậm hơn nguồn
      }
    }
    const tongMoiMs = performance.now() - t0;
    expect(nhan).toBe(TONG);

    const mb = (b: number) => Math.round((b / MB) * 10) / 10;
    process.stdout.write(
      `[SCR-M1] ${TONG / MB}MB · ĐƯỜNG CŨ (nạp RAM): byte đầu sau ${Math.round(byteDauCuMs)}ms, đỉnh +${mb(dinhCu - m0)}MB RAM ` +
        `· ĐƯỜNG MỚI (route): byte đầu sau ${Math.round(byteDauMoiMs)}ms (R2 header ${TRE_HEADER_MS}ms), nguồn mới bị hút ${mb(daSinhLucByteDau)}MB lúc byte đầu, ` +
        `lệch sinh−nhận tối đa ${mb(lechMax)}MB, đỉnh +${mb(dinhMoi - m1)}MB RAM, hết tệp sau ${Math.round(tongMoiMs)}ms
`,
    );
    // Byte đầu không phụ thuộc kích thước tệp: nguồn mới bị hút một nhúm nhỏ, không phải cả 96MB.
    expect(daSinhLucByteDau).toBeLessThan(2 * MB);
    expect(byteDauMoiMs).toBeLessThan(TRE_HEADER_MS + 500);
    // Backpressure: nguồn không bao giờ chạy trước nhà nhận quá vài trăm KB (ngưỡng hàng đợi 256KB + đệm nội bộ).
    expect(lechMax).toBeLessThan(2 * MB);
    // RAM đỉnh không tăng theo kích thước tệp (đường cũ: cả tệp + bản gộp; đường mới: hằng số nhỏ).
    expect(dinhMoi - m1).toBeLessThan(0.5 * TONG);
    expect(dinhCu - m0).toBeGreaterThan(dinhMoi - m1);
  }, 30_000);

  it("[SCR-M2] client đọc CHẬM: nguồn R2 không chạy trước client quá ngưỡng hàng đợi (backpressure thật qua route, không chỉ ở hàm thuần)", async () => {
    const TONG2 = 24 * MB;
    const f = { Body: video(TONG2), ContentLength: TONG2, ContentType: "video/mp4", ETag: '"vid"' } as Fake;
    send.mockResolvedValueOnce(f);
    const r = await goi(yeuCau(`${GOI}/res/data/video1.mp4`, { cookie: ve() }), [GOI, "res", "data", "video1.mp4"]);
    const rd = r.body!.getReader();
    const nguon = f.Body as ReturnType<typeof video>;
    await rd.read();
    // client đứng yên 150ms: một nguồn không có backpressure sẽ hút thêm hàng chục MB trong lúc đó (≥ 1MB mỗi ~8–15ms)
    await new Promise((x) => setTimeout(x, 150));
    const hutKhiClientDung = nguon.st.daSinh;
    let nhan = 0;
    let lechMax = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      nhan += value.length;
      lechMax = Math.max(lechMax, nguon.st.daSinh - nhan);
      if (nhan % MB < 2 * MANH) await new Promise((x) => setTimeout(x, 5));
    }
    process.stdout.write(`[SCR-M2] client đứng yên 150ms: nguồn bị hút ${Math.round((hutKhiClientDung / MB) * 10) / 10}MB / ${TONG2 / MB}MB; lệch tối đa khi đọc chậm ${Math.round((lechMax / MB) * 10) / 10}MB
`);
    expect(hutKhiClientDung).toBeLessThan(3 * MB);
    expect(lechMax).toBeLessThan(3 * MB);
  }, 30_000);
});

// ── 24/10/2026 (vòng 2): `no-transform` trên 206 + phiên SỐNG khi gia hạn vé trượt ──────────────────────────────────────────
describe("[SCR-NT] `206` mang `no-transform` (Next không được gzip lại một phần 206)", () => {
  const SEGS = [GOI, "res", "data", "player.js"];
  const URL_ = `${GOI}/res/data/player.js`;

  it("[SCR-NT1] R2 + Range ⇒ 206 có `no-transform`; ĐỐI CHỨNG: cùng tệp không Range ⇒ 200 KHÔNG có", async () => {
    send.mockResolvedValueOnce(tep(1000, { ContentRange: "bytes 0-999/5000", ContentType: "text/javascript" }));
    const r206 = await goi(yeuCau(URL_, { cookie: ve(), headers: { range: "bytes=0-999" } }), SEGS);
    expect(r206.status).toBe(206);
    expect(r206.headers.get("Cache-Control")).toBe("private, max-age=3600, no-transform");
    const r200 = await goi(yeuCau(URL_, { cookie: ve() }), SEGS);
    expect(r200.status).toBe(200);
    expect(r200.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it("[SCR-NT2] hop đầu (?t) + Range ⇒ 206 `private, no-store, no-transform` (chính sách cache gốc giữ nguyên, chỉ thêm chỉ thị)", async () => {
    send.mockResolvedValueOnce(tep(500, { ContentRange: "bytes 0-499/5000", ContentType: "text/javascript" }));
    const r = await goi(yeuCau(URL_, { t: ve(), headers: { range: "bytes=0-499" } }), SEGS);
    expect(r.status).toBe(206);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store, no-transform");
  });

  it("[SCR-NT3] ĐĨA + Range ⇒ 206 có `no-transform`; ĐỐI CHỨNG: đĩa 200 và 304 KHÔNG có", async () => {
    delete process.env.SCORM_CACHE_OFF;
    const { ghiDemTuBytes } = await import("./dem-dia");
    await ghiDemTuBytes(`${PREFIX}res/data/player.js`, new Uint8Array(10).fill(9), { contentType: "text/javascript", etag: '"e-dia"', lastModified: null });
    const r206 = await goi(yeuCau(URL_, { cookie: ve(), headers: { range: "bytes=2-4" } }), SEGS);
    expect(r206.status).toBe(206);
    expect(r206.headers.get("Cache-Control")).toBe("private, max-age=3600, no-transform");
    const r200 = await goi(yeuCau(URL_, { cookie: ve() }), SEGS);
    expect(r200.status).toBe(200);
    expect(r200.headers.get("Cache-Control")).toBe("private, max-age=3600");
    const r304 = await goi(yeuCau(URL_, { cookie: ve(), headers: { "if-none-match": '"e-dia"' } }), SEGS);
    expect(r304.status).toBe(304);
    expect(r304.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCR-NT4] HEAD + Range ⇒ 206 có `no-transform` (cùng header như GET); HEAD không Range thì không", async () => {
    send.mockImplementation(async (c: unknown) => (tenLenh(c) === "HeadObjectCommand" ? { ContentLength: 1000, ContentType: "video/mp4", ETag: '"v"' } : tep(1)));
    const r206 = await HEAD(yeuCau(URL_, { cookie: ve(), headers: { range: "bytes=100-199" } }), ctxPath(SEGS));
    expect(r206.status).toBe(206);
    expect(r206.headers.get("Cache-Control")).toBe("private, max-age=3600, no-transform");
    const r200 = await HEAD(yeuCau(URL_, { cookie: ve() }), ctxPath(SEGS));
    expect(r200.status).toBe(200);
    expect(r200.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it("[SCR-NT5] 416 và lỗi vẫn `private, no-store` đúng như cũ (không lây `no-transform` sang phản hồi không phải 206)", async () => {
    send.mockImplementation(async (c: unknown) => {
      if (tenLenh(c) === "HeadObjectCommand") return { ContentLength: 5000 };
      throw Object.assign(new Error("x"), { name: "InvalidRange", $metadata: { httpStatusCode: 416 } });
    });
    const r = await goi(yeuCau(URL_, { cookie: ve(), headers: { range: "bytes=999999-" } }), SEGS);
    expect(r.status).toBe(416);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("[SCR-V] gia hạn vé TRƯỢT hỏi phiên SỐNG ở DB — chỉ ở nhánh thật sự cấp cookie mới", () => {
  const SEGS = [GOI, "res", "data", "img1.png"];
  const sapHet = () => ve({}, 600, Date.now() - 600_000 + SCORM_GIA_HAN_KHI_CON_MS - 5000); // còn < 5 phút
  const cookieMoi = (r: Response) => /scorm_tk=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? null;

  it("[SCR-V1] vé sắp hết + phiên SỐNG ⇒ 200 + cookie mới; hỏi DB đúng 1 lần", async () => {
    const r = await goi(yeuCau(`${GOI}/res/data/img1.png`, { cookie: sapHet() }), SEGS);
    expect(r.status).toBe(200);
    expect(cookieMoi(r)).not.toBeNull();
    expect(phienSong).toHaveBeenCalledTimes(1);
  });

  it("[SCR-V2] vé sắp hết + phiên CHẾT (khoá / xoá / đổi tokenVersion) ⇒ 403, KHÔNG cookie mới, KHÔNG chạm R2; được đếm theo lý do", async () => {
    phienSong.mockResolvedValue(null);
    const r = await goi(yeuCau(`${GOI}/res/data/img1.png`, { cookie: sapHet() }), SEGS);
    expect(r.status).toBe(403);
    expect(cookieMoi(r)).toBeNull();
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(send).not.toHaveBeenCalled();
    expect(docDemSuKien()["403:phien-da-chet"]).toBe(1);
  });

  it("[SCR-V3] DB trả phiên của NGƯỜI KHÁC (id lệch) ⇒ coi là chết, 403", async () => {
    phienSong.mockResolvedValue({ user: { id: "nguoi-khac" } });
    const r = await goi(yeuCau(`${GOI}/res/data/img1.png`, { cookie: sapHet() }), SEGS);
    expect(r.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCR-V4] DB chập (ném lỗi) ⇒ KHÔNG cấp cookie mới nhưng VẪN phục vụ bằng vé còn hạn (không biến cú chập thành lỗi giả giữa buổi dạy)", async () => {
    phienSong.mockRejectedValue(new Error("ECONNRESET"));
    const r = await goi(yeuCau(`${GOI}/res/data/img1.png`, { cookie: sapHet() }), SEGS);
    expect(r.status).toBe(200);
    expect(cookieMoi(r)).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("[SCR-V5] ĐƯỜNG NÓNG không có DB: vé còn lâu ⇒ không hỏi; hop đầu (?t) ⇒ không hỏi và cookie là CHÍNH vé", async () => {
    await goi(yeuCau(`${GOI}/res/data/img1.png`, { cookie: ve() }), SEGS);
    expect(phienSong).not.toHaveBeenCalled();
    const veHop = sapHet();
    const r = await goi(yeuCau(`${GOI}/res/data/img1.png`, { t: veHop }), SEGS);
    expect(r.status).toBe(200);
    expect(phienSong).not.toHaveBeenCalled();
    expect(decodeURIComponent(cookieMoi(r)!)).toBe(veHop);
  });

  it("[SCR-V6] 12 request SONG SONG cùng mang cookie sắp hết ⇒ chỉ 1 truy vấn phiên (gộp lượt đang bay); cả 12 đều được cookie mới", async () => {
    const cu = sapHet();
    const kq = await Promise.all(Array.from({ length: 12 }, () => goi(yeuCau(`${GOI}/res/data/img1.png`, { cookie: cu }), SEGS)));
    expect(kq.every((r) => r.status === 200 && cookieMoi(r) !== null)).toBe(true);
    expect(phienSong).toHaveBeenCalledTimes(1);
  });

  it("[SCR-V7] nhớ ngắn: request kế tiếp ngay sau đó không hỏi lại; phiên khác (user khác) có kết quả riêng", async () => {
    await goi(yeuCau(`${GOI}/res/data/img1.png`, { cookie: sapHet() }), SEGS);
    await goi(yeuCau(`${GOI}/res/data/img1.png`, { cookie: sapHet() }), SEGS);
    expect(phienSong).toHaveBeenCalledTimes(1);
    auth.mockResolvedValue({ user: { id: "gv-2" } });
    phienSong.mockResolvedValue({ user: { id: "gv-2" } });
    const veGv2 = ve({ userId: "gv-2" }, 600, Date.now() - 600_000 + SCORM_GIA_HAN_KHI_CON_MS - 5000);
    const r = await goi(yeuCau(`${GOI}/res/data/img1.png`, { cookie: veGv2 }), SEGS);
    expect(r.status).toBe(200);
    expect(phienSong).toHaveBeenCalledTimes(2);
  });

  it("[SCR-V8] hàng rào cũ vẫn chạy TRƯỚC: vé sắp hết + user lệch phiên JWT ⇒ 403 'phien' mà KHÔNG hỏi DB", async () => {
    auth.mockResolvedValue({ user: { id: "nguoi-khac" } });
    const r = await goi(yeuCau(`${GOI}/res/data/img1.png`, { cookie: sapHet() }), SEGS);
    expect(r.status).toBe(403);
    expect(phienSong).not.toHaveBeenCalled();
    expect(docDemSuKien()["403:phien"]).toBe(1);
  });
});
