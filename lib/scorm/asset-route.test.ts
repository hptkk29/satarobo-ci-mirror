// @vitest-environment node
// Đường phát asset SCORM (12/10/2026): hàng rào TRƯỚC khi gọi R2, Range cho video, 304, phân loại lỗi, vé gia hạn, cookie theo gói.
// R2 / phiên đăng nhập / DB đều giả lập — không cần mạng. (Đặt ở lib/scorm/: `tests/scorm/` không nằm trong `include` của vitest
// lẫn allowlist của gương CI.)
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const send = vi.fn();
const auth = vi.fn();
const timPkg = vi.fn();
const flag = vi.fn(() => true);

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/db", () => ({ db: { scormPackage: { findUnique: (a: unknown) => timPkg(a) } } }));
vi.mock("@/lib/flags", () => ({ isScormEnabled: () => flag() }));
vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({ send: (cmd: unknown, opts: unknown) => send(cmd, opts) }),
  getR2Bucket: () => "bucket-test",
}));

// Làm nóng gói chạm R2 (liệt kê + tải) — giả lập để test route không bị lẫn lệnh; các hàm đệm đĩa còn lại là THẬT (thư mục tạm).
const lamNong = vi.fn();
vi.mock("@/lib/scorm/dem-dia", async (goc) => ({
  ...(await goc<typeof import("@/lib/scorm/dem-dia")>()),
  lamNongGoi: (...a: unknown[]) => lamNong(...a),
}));

import { NextRequest } from "next/server";
import { GET, HAN_CHO_R2_MS, NGUONG_DEM_BYTE } from "../../app/api/scorm/asset/[...path]/route";
import { docMetaDem, _datLaiTrangThai } from "./dem-dia";
import { SCORM_COOKIE_VE, SCORM_COOKIE_VE_CU } from "./asset-url";
import { SCORM_GIA_HAN_KHI_CON_MS, signScormTicket, verifyScormTicket } from "./ticket";

const GOI = "cmuz8xsix01vlh3dv9t2bz8d1";
const GOI_KHAC = "cmuz8xsiy01vmh3dv9t2bz8d2";
const PREFIX = `scorm/${GOI}/`;
const USER = "gv-1";

process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
process.env.AUTH_SECRET = process.env.NEXTAUTH_SECRET;

type Fake = { Body?: unknown; ContentLength?: number; ContentType?: string; ETag?: string; ContentRange?: string; LastModified?: Date };
function body(bytes: number) {
  const buf = new Uint8Array(bytes).fill(7);
  return {
    transformToByteArray: vi.fn(async () => buf),
    transformToWebStream: vi.fn(() => new ReadableStream({ start(c) { c.enqueue(buf); c.close(); } })),
  };
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
  thuMucDem = await mkdtemp(join(tmpdir(), "scorm-route-test-"));
  process.env.SCORM_CACHE_DIR = thuMucDem;
  process.env.SCORM_CACHE_OFF = "1"; // mặc định TẮT đệm đĩa để các ca R2 ở trên xác định; nhóm [SCR-D] bật lại
  _datLaiTrangThai();
  flag.mockReturnValue(true);
  auth.mockResolvedValue({ user: { id: USER } });
  timPkg.mockResolvedValue({ storagePrefix: PREFIX });
  send.mockResolvedValue(tep(1000));
});
afterEach(async () => {
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
    expect((f.Body as ReturnType<typeof body>).transformToByteArray).toHaveBeenCalled();
    expect((f.Body as ReturnType<typeof body>).transformToWebStream).not.toHaveBeenCalled();
    expect(r.headers.get("Accept-Ranges")).toBe("bytes");
    expect(r.headers.get("Content-Length")).toBe(String(NGUONG_DEM_BYTE - 1));
    expect(r.headers.get("ETag")).toBe('"abc"');
  });

  it("[SCR-B2] tệp LỚN ⇒ truyền dòng, KHÔNG nạp cả tệp vào RAM", async () => {
    const f = tep(NGUONG_DEM_BYTE + 1, { ContentType: "video/mp4" });
    send.mockResolvedValueOnce(f);
    const r = await goi(yeuCau(`${GOI}/res/data/video1.mp4`, { cookie: ve() }), [GOI, "res", "data", "video1.mp4"]);
    expect(r.status).toBe(200);
    expect((f.Body as ReturnType<typeof body>).transformToWebStream).toHaveBeenCalled();
    expect((f.Body as ReturnType<typeof body>).transformToByteArray).not.toHaveBeenCalled();
    expect(r.headers.get("Content-Type")).toBe("video/mp4");
  });

  it("[SCR-B3] `Range: bytes=0-` ⇒ chuyển cho R2, trả 206 + Content-Range + Content-Length của KHOẢNG, truyền dòng", async () => {
    const f = tep(1000, { ContentRange: "bytes 0-999/5000000", ContentType: "video/mp4" });
    send.mockResolvedValueOnce(f);
    const r = await goi(yeuCau(`${GOI}/res/data/video1.mp4`, { cookie: ve(), headers: { range: "bytes=0-" } }), [GOI, "res", "data", "video1.mp4"]);
    expect(lenhCuoi().input.Range).toBe("bytes=0-");
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 0-999/5000000");
    expect(r.headers.get("Content-Length")).toBe("1000");
    expect((f.Body as ReturnType<typeof body>).transformToWebStream).toHaveBeenCalled();
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
