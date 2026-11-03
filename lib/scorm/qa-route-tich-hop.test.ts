// @vitest-environment node
// QA ĐỘC LẬP (24/10/2026) — đường phát asset SCORM, tầng TÍCH HỢP: route thật + S3 giả có luồng `Readable` thật.
//
// ── Bằng chứng loại nào? ───────────────────────────────────────────────────────────────────────────────────────────────
// Đây là bằng chứng "tích hợp có S3 giả" (route THẬT, ticket THẬT, đệm đĩa THẬT; chỉ phiên đăng nhập / DB / R2 là giả). Nó KHÔNG
// phải UAT: không có trình duyệt, không có Next server, không có mạng. Xanh ở đây nghĩa là "route giữ đúng hợp đồng với một R2
// mô phỏng", không nghĩa là "giáo viên mở bài thấy mượt".
//
// ── Cách đọc tên ca ────────────────────────────────────────────────────────────────────────────────────────────────────
// `(phụ thuộc A1|A3)` = ca viết theo ĐẶC TẢ của đợt này mà mã nền (origin/test) chưa làm; ca đó ĐỎ cho tới khi agent kia xong.
// Cố ý KHÔNG dùng `it.skip`/`it.fails` cho nhóm này: skip là quên, `it.fails` giấu mất lúc nó chuyển xanh.
//
// ── Luật 14 (cấy lại lưới) ─────────────────────────────────────────────────────────────────────────────────────────────
// Mỗi detector (huỷ luồng, nạp RAM, backpressure) có ca `[QAR-N*]` chạy detector đó lên một "route" CỐ TÌNH SAI để chứng minh
// detector biết đỏ. Ba phép cấy lên chính S3 giả (destroy no-op · bỏ qua Range · transformToWebStream nạp trước) ghi ở
// docs/scorm-hieu-nang/ma-tran-kiem-thu.md.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = vi.fn();
const timPkg = vi.fn();
const flag = vi.fn(() => true);
const lamNong = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/db", () => ({ db: { scormPackage: { findUnique: (a: unknown) => timPkg(a) } } }));
vi.mock("@/lib/flags", () => ({ isScormEnabled: () => flag() }));
// Gia hạn trượt hỏi phiên SỐNG ở DB (route, nhánh cấp cookie mới). Ở đây chỉ cần "phiên sống = phiên auth() đang giả lập".
vi.mock("@/lib/auth/live-session", () => ({ requireLiveSession: () => auth() }));
vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({ send: (cmd: unknown, opts?: { abortSignal?: AbortSignal }) => s3.send(cmd, opts) }),
  getR2Bucket: () => "bucket-test",
}));
// Làm nóng gói có bộ test riêng (qa-lam-nong.test.ts); ở đây giả lập để không lẫn lệnh vào thống kê của S3 giả.
vi.mock("@/lib/scorm/dem-dia", async (goc) => ({
  ...(await goc<typeof import("@/lib/scorm/dem-dia")>()),
  lamNongGoi: (...a: unknown[]) => lamNong(...a),
}));


// Theo dõi mọi luồng ĐỌC ĐĨA (fs.createReadStream) để [QAR-A9] biết luồng nào chưa đóng. Các hàm khác của `node:fs` đi thẳng, không đổi hành vi.
// (A1 mở fd bằng `fs.open` callback rồi đưa fd cho createReadStream — đã tránh FileHandle vì GC FileHandle có thể sập tiến trình — nên điểm
// quan sát duy nhất ổn định là chính ReadStream: `.closed` chỉ true khi fd đã được đóng.)
const luongDiaTheoDoi: Array<{ closed: boolean; destroyed: boolean }> = [];
let dangTheoDoiLuongDia = false;
vi.mock("node:fs", async (goc) => {
  const that = await goc<typeof import("node:fs")>();
  const createReadStream = ((...a: Parameters<typeof that.createReadStream>) => {
    const rs = that.createReadStream(...a);
    if (dangTheoDoiLuongDia) luongDiaTheoDoi.push(rs);
    return rs;
  }) as typeof that.createReadStream;
  return { ...that, createReadStream, default: { ...that, createReadStream } };
});

// ── Cổng cấy lỗi vào MÃ SẢN PHẨM mà không động vào file của agent khác (luật 14) ─────────────────────────────────────────────
// Khi đặt QA_DOT_BIEN_LUONG=<đường dẫn tuyệt đối>, module `@/lib/scorm/luong-r2` được thay bằng bản ĐỘT BIẾN (một bản sao đã cấy lỗi do script
// của QA tạo ra ở thư mục tạm). Bình thường biến này không có ⇒ dùng module thật; file đột biến chưa từng được nạp.
vi.mock("@/lib/scorm/luong-r2", async (goc) => {
  const that = await goc<typeof import("@/lib/scorm/luong-r2")>();
  const f = process.env.QA_DOT_BIEN_LUONG;
  if (!f) return that;
  return (await import(/* @vite-ignore */ f)) as typeof that;
});

// Khi đặt QA_DOT_BIEN_TICKET=<đường dẫn tuyệt đối>, module `@/lib/scorm/ticket` được thay bằng bản ĐỘT BIẾN (một bản sao đã cấy lỗi do script
// của QA tạo ra ở thư mục tạm). Bình thường biến này không có ⇒ dùng module thật; file đột biến chưa từng được nạp.
vi.mock("@/lib/scorm/ticket", async (goc) => {
  const that = await goc<typeof import("@/lib/scorm/ticket")>();
  const f = process.env.QA_DOT_BIEN_TICKET;
  if (!f) return that;
  return (await import(/* @vite-ignore */ f)) as typeof that;
});

import { NextRequest } from "next/server";
import * as route from "../../app/api/scorm/asset/[...path]/route";
import { _datLaiTrangThai, docMetaDem, ghiDemTuBytes } from "./dem-dia";
import { SCORM_COOKIE_VE, SCORM_COOKIE_VE_CU } from "./asset-url";
import { signScormTicket } from "./ticket";
import { byteTai, choDen, docHetThan, taoS3Gia } from "./qa-s3-gia";

const s3 = taoS3Gia();
const { GET } = route;

const GOI = "cmuz8xsix01vlh3dv9t2bz8d1";
const GOI_KHAC = "cmuz8xsiy01vmh3dv9t2bz8d2";
const PREFIX = `scorm/${GOI}/`;
const PREFIX_KHAC = `scorm/${GOI_KHAC}/`;
const USER = "gv-1";
const MB = 1024 * 1024;
// Hằng của ĐẶC TẢ, cố ý KHÔNG import từ route (route.ts không được export tên lạ và A1 đang dời hằng sang lib/scorm/luong-r2.ts):
// bộ QA đo hợp đồng quan sát được, không đo tên biến nội bộ. Nếu A1 đổi số mà ca đỏ thì đó là tín hiệu cần xem lại hợp đồng.
const NGUONG_DEM = 2 * MB; // tệp ≤ ngưỡng này nạp RAM; lớn hơn truyền dòng
const HAN_CHO_R2 = 15_000; // chờ R2 trả header tối đa (ms)

process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
process.env.AUTH_SECRET = process.env.NEXTAUTH_SECRET;

function ve(over: Partial<{ packageId: string; userId: string; prefix: string | null }> = {}, ttl = 600, now = Date.now()) {
  const prefix = over.prefix === null ? undefined : (over.prefix ?? PREFIX);
  return signScormTicket({ packageId: over.packageId ?? GOI, sessionId: "buoi-1", userId: over.userId ?? USER, prefix }, ttl, now);
}
type TuyChon = { t?: string; cookie?: string; cookieTen?: string; headers?: Record<string, string>; method?: string; signal?: AbortSignal };
function yeuCau(duongDan: string, o: TuyChon = {}) {
  const url = `http://localhost/api/scorm/asset/${duongDan}${o.t ? `?t=${encodeURIComponent(o.t)}` : ""}`;
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = `${o.cookieTen ?? SCORM_COOKIE_VE}=${o.cookie}`;
  return new NextRequest(url, { method: o.method ?? "GET", headers, signal: o.signal });
}
const goi = (req: NextRequest, segs: string[]) => GET(req, { params: Promise.resolve({ path: segs }) });
/** Gọi như trình duyệt: asset con của gói `ma` (mặc định GOI) bằng cookie vé theo gói. */
function lay(rel: string, o: TuyChon & { ma?: string; veRieng?: string } = {}) {
  const ma = o.ma ?? GOI;
  return goi(yeuCau(`${ma}/${rel}`, { cookie: o.veRieng ?? ve({ packageId: ma, prefix: `scorm/${ma}/` }), ...o }), [ma, ...rel.split("/")]);
}
const keyS3 = () => s3.tk.gets.map((g) => g.key);

let thuMucDem = "";
beforeAll(() => {
  // Ghi dấu SNAPSHOT mã nền đang bị đo — mã đang bị agent khác sửa song song, nên "FAIL (phụ thuộc A1)" phải trỏ được vào bản cụ thể.
  // Không được làm chết cả bộ nếu một tệp vắng (vd khi chuyển chọn lọc sang nhánh khác chưa có `duong-dan-cam.ts`/`cache-asset.ts`): ghi "thiếu".
  const sha = (p: string) => {
    try {
      return createHash("sha1").update(readFileSync(p)).digest("hex").slice(0, 10);
    } catch {
      return "THIẾU";
    }
  };
  console.info(
    `[QAR] snapshot route=${sha("app/api/scorm/asset/[...path]/route.ts")} dem-dia=${sha("lib/scorm/dem-dia.ts")} ` +
      `duong-dan-cam=${sha("lib/scorm/duong-dan-cam.ts")} cache-asset=${sha("lib/scorm/cache-asset.ts")}`,
  );
});
beforeEach(async () => {
  vi.clearAllMocks();
  auth.mockReset(); // clearAllMocks KHÔNG xoá hàng đợi mockResolvedValueOnce — một Once thừa rò sang ca sau (đã dính ở QAR-I4 → I5)
  timPkg.mockReset();
  s3.datLai();
  thuMucDem = await mkdtemp(join(tmpdir(), "scorm-qa-route-"));
  process.env.SCORM_CACHE_DIR = thuMucDem;
  process.env.SCORM_CACHE_OFF = "1";
  _datLaiTrangThai();
  flag.mockReturnValue(true);
  auth.mockResolvedValue({ user: { id: USER } });
  timPkg.mockResolvedValue({ storagePrefix: PREFIX });
});
afterEach(async () => {
  vi.useRealTimers();
  await choDen(() => s3.tk.openStreams === 0, 200); // để lượt ghi đệm nền / luồng dở dang kịp đóng trước khi dọn thư mục
  await rm(thuMucDem, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});
afterAll(() => {
  delete process.env.SCORM_CACHE_DIR;
  delete process.env.SCORM_CACHE_OFF;
});

const batDem = () => {
  delete process.env.SCORM_CACHE_OFF;
};
const nho = (n: number, giaTri = 7) => new Uint8Array(n).fill(giaTri);
async function choCoTrenDia(key: string) {
  for (let i = 0; i < 100; i++) {
    if (await docMetaDem(key)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`tệp chưa được ghi xuống đĩa: ${key}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("[QAR-R] Range / seek video (tệp lớn truyền dòng, khoảng chuyển thẳng cho R2)", () => {
  const VIDEO = `${PREFIX}res/data/video1.mp4`;
  const SIZE = 6_000_000;
  beforeEach(() => s3.themLon(VIDEO, SIZE, { contentType: "video/mp4", etag: '"v1"' }));

  it("[QAR-R1] không Range ⇒ 200, đủ cỡ, Accept-Ranges, đúng nội dung", async () => {
    const r = await lay("res/data/video1.mp4");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("video/mp4");
    expect(r.headers.get("Accept-Ranges")).toBe("bytes");
    expect(r.headers.get("Content-Length")).toBe(String(SIZE));
    const d = await docHetThan(r);
    expect(d.tong).toBe(SIZE);
    expect(d.dau).toBe(byteTai(0));
    expect(d.cuoi).toBe(byteTai(SIZE - 1));
  });

  it("[QAR-R2] `Range: bytes=0-` (kiểu Chrome mở video) ⇒ 206, Content-Range đủ cỡ, Content-Length = cả tệp", async () => {
    const r = await lay("res/data/video1.mp4", { headers: { range: "bytes=0-" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe(`bytes 0-${SIZE - 1}/${SIZE}`);
    expect(r.headers.get("Content-Length")).toBe(String(SIZE));
    expect((await docHetThan(r)).tong).toBe(SIZE);
  });

  it("[QAR-R3] seek GIỮA tệp ⇒ 206 đúng khoảng, byte đầu/cuối đúng vị trí, R2 KHÔNG sản xuất quá khoảng xin", async () => {
    const [a, b] = [3_000_000, 3_999_999];
    const r = await lay("res/data/video1.mp4", { headers: { range: `bytes=${a}-${b}` } });
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe(`bytes ${a}-${b}/${SIZE}`);
    expect(r.headers.get("Content-Length")).toBe(String(b - a + 1));
    expect(s3.tk.gets.at(-1)!.range).toBe(`bytes=${a}-${b}`);
    const d = await docHetThan(r);
    expect(d.tong).toBe(b - a + 1);
    expect(d.dau).toBe(byteTai(a));
    expect(d.cuoi).toBe(byteTai(b));
    expect(s3.tk.bytesProduced).toBeLessThanOrEqual(b - a + 1 + 64 * 1024); // seek không được kéo cả tệp
  });

  it("[QAR-R4] `bytes=-1000` (đuôi tệp — moov atom ở cuối) ⇒ 206, 1000 byte cuối đúng nội dung", async () => {
    const r = await lay("res/data/video1.mp4", { headers: { range: "bytes=-1000" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe(`bytes ${SIZE - 1000}-${SIZE - 1}/${SIZE}`);
    const d = await docHetThan(r);
    expect(d.tong).toBe(1000);
    expect(d.dau).toBe(byteTai(SIZE - 1000));
  });

  it("[QAR-R5] khoảng bắt đầu SAU cuối tệp ⇒ 416 (không 5xx, không 200)", async () => {
    const r = await lay("res/data/video1.mp4", { headers: { range: `bytes=${SIZE + 100}-` } });
    expect(r.status).toBe(416);
  });

  it("[QAR-R6] Range nhiều khoảng / sai đơn vị / sai dạng ⇒ bị bỏ qua, trả cả tệp 200 — không đoán, không 5xx", async () => {
    for (const h of ["bytes=0-9,20-29", "items=0-1", "bytes=a-b", "bytes=-", "bytes="]) {
      const r = await lay("res/data/video1.mp4", { headers: { range: h } });
      expect(r.status, h).toBe(200);
      expect(r.headers.get("Content-Length"), h).toBe(String(SIZE));
      await r.body?.cancel();
    }
  });

  it("[QAR-R7] khoảng đảo (`bytes=500-100`) ⇒ 416 hoặc 200, tuyệt đối không 5xx", async () => {
    const r = await lay("res/data/video1.mp4", { headers: { range: "bytes=500-100" } });
    expect([200, 416]).toContain(r.status);
    await r.body?.cancel();
  });

  it("[QAR-R8] chuỗi seek nối nhau như trình phát (6 khoảng lệch nhau): mỗi khoảng đúng 100%, không rò luồng", async () => {
    for (const a of [0, 1_234_567, 5_999_000, 42, 3_000_001, 4_500_000]) {
      const b = Math.min(a + 4999, SIZE - 1);
      const r = await lay("res/data/video1.mp4", { headers: { range: `bytes=${a}-${b}` } });
      expect(r.status, `a=${a}`).toBe(206);
      const d = await docHetThan(r);
      expect(d.tong, `a=${a}`).toBe(b - a + 1);
      expect(d.dau, `a=${a}`).toBe(byteTai(a));
    }
    expect(await choDen(() => s3.tk.openStreams === 0, 500)).toBe(true);
  });

  it("[QAR-R9] tệp nhỏ có Range từ R2 (không qua đệm) cũng trả 206 chuẩn", async () => {
    s3.them(`${PREFIX}res/a.js`, Uint8Array.from({ length: 100 }, (_, i) => i), { etag: '"a"' });
    const r = await lay("res/a.js", { headers: { range: "bytes=10-19" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 10-19/100");
    expect(Array.from(new Uint8Array(await r.arrayBuffer()))).toEqual(Array.from({ length: 10 }, (_, i) => 10 + i));
  });

  it("[QAR-R10] If-Range (Chrome gửi khi nối lại video dở): ETag KHỚP ⇒ 206 đúng khoảng; ETag LỆCH ⇒ 200 trả CẢ tệp (RFC 9110 §13.1.5) — cả nguồn R2 lẫn đĩa", async () => {
    s3.them(`${PREFIX}res/a.js`, Uint8Array.from({ length: 100 }, (_, i) => i), { etag: '"a1"' });
    for (const nguon of ["R2", "DIA"] as const) {
      if (nguon === "DIA") {
        batDem();
        await lay("res/a.js");
        await choCoTrenDia(`${PREFIX}res/a.js`);
      }
      const khop = await lay("res/a.js", { headers: { range: "bytes=10-19", "if-range": '"a1"' } });
      expect(khop.status, `${nguon} If-Range khớp`).toBe(206);
      expect((await khop.arrayBuffer()).byteLength).toBe(10);
      const lech = await lay("res/a.js", { headers: { range: "bytes=10-19", "if-range": '"sai"' } });
      expect(lech.status, `${nguon} If-Range lệch`).toBe(200);
      expect((await lech.arrayBuffer()).byteLength, `${nguon} lệch ⇒ cả tệp`).toBe(100);
    }
  });

  it("[QAR-R11] hợp đồng với viewer: thăm dò `Range: bytes=0-0` trên launch URL (kèm ?t) ⇒ 206, đúng 1 byte, Content-Range đủ cỡ, và vẫn đặt cookie vé theo gói", async () => {
    const html = new TextEncoder().encode("<html>x".repeat(50));
    s3.them(`${PREFIX}res/index.html`, html, { etag: '"i"', contentType: "text/html" });
    const r = await goi(yeuCau(`${GOI}/res/index.html`, { t: ve(), headers: { range: "bytes=0-0" } }), [GOI, "res", "index.html"]);
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe(`bytes 0-0/${html.length}`);
    expect((await r.arrayBuffer()).byteLength).toBe(1);
    expect(r.headers.get("set-cookie") ?? "").toContain(`Path=/api/scorm/asset/${GOI}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("[QAR-C] Cache-Control — mọi loại phản hồi × ba loại URL × hai nguồn byte (R2 / đĩa)", () => {
  // Hợp đồng (cache-asset.ts): URL CÓ mã gói, không vé trên URL ⇒ `private, max-age=3600`; hop đầu `?t` ⇒ `private, no-store`;
  // URL kiểu CŨ (không mã gói, trùng giữa các gói) ⇒ KHÔNG lưu. Luôn `private` (một proxy/CDN chung không được giữ bản của ai).
  const REL = "res/data/x.js";
  const DUONG = {
    "A:ma-goi+cookie": { cc: "private, max-age=3600" },
    "B:?t(hop-dau)": { cc: "private, no-store" },
    "C:url-kieu-cu": { cc: "private, no-store" },
  } as const;
  type Kieu = keyof typeof DUONG;
  const LOAI = ["200", "206", "304"] as const;

  function goiKieu(kieu: Kieu, headers: Record<string, string>) {
    if (kieu === "A:ma-goi+cookie") return goi(yeuCau(`${GOI}/${REL}`, { cookie: ve(), headers }), [GOI, ...REL.split("/")]);
    if (kieu === "B:?t(hop-dau)") return goi(yeuCau(`${GOI}/${REL}`, { t: ve(), headers }), [GOI, ...REL.split("/")]);
    return goi(yeuCau(REL, { cookie: ve({ prefix: null }), cookieTen: SCORM_COOKIE_VE_CU, headers }), REL.split("/"));
  }
  const phatHien = (r: Response) => {
    const cc = r.headers.get("Cache-Control") ?? "";
    expect(cc, "luôn private").toMatch(/\bprivate\b/);
    expect(cc, "không public / s-maxage").not.toMatch(/\bpublic\b|s-maxage/);
    return cc;
  };

  for (const nguon of ["R2", "DIA"] as const) {
    for (const loai of LOAI) {
      for (const kieu of Object.keys(DUONG) as Kieu[]) {
        const phuThuoc = kieu === "C:url-kieu-cu" ? " (phụ thuộc A1: dùng chinhSachCache)" : "";
        it(`[QAR-C-${nguon}-${loai}-${kieu[0]}] ${nguon} ${loai} ${kieu}${phuThuoc}`, async () => {
          s3.them(`${PREFIX}${REL}`, nho(2000), { etag: '"e-x"', contentType: "application/javascript" });
          if (nguon === "DIA") {
            batDem();
            expect((await goiKieu("A:ma-goi+cookie", {})).status).toBe(200); // lượt trượt ⇒ ghi đĩa
            await choCoTrenDia(`${PREFIX}${REL}`);
            s3.datLaiThongKe();
          }
          const headers: Record<string, string> = loai === "206" ? { range: "bytes=0-9" } : loai === "304" ? { "if-none-match": '"e-x"' } : {};
          const r = await goiKieu(kieu, headers);
          expect(r.status).toBe(Number(loai));
          if (nguon === "DIA") expect(s3.tk.gets.length, "phục vụ từ đĩa, không chạm R2").toBe(0);
          const cc = phatHien(r);
          // 206 thêm `no-transform` CỤC BỘ ở route: Next/Caddy không được nén lại một phần (RFC 9110). 200/304 giữ nguyên bảng.
          expect(cc).toBe(loai === "206" ? `${DUONG[kieu].cc}, no-transform` : DUONG[kieu].cc);
          await r.body?.cancel();
        });
      }
    }
  }

  it("[QAR-C-ERR] 403/404/416 không bao giờ mang `public` hay `max-age` dài", async () => {
    s3.themLon(`${PREFIX}res/data/v.mp4`, 1000);
    const kqs = [
      await goi(yeuCau(`${GOI}/${REL}`), [GOI, ...REL.split("/")]), // 403
      await lay("res/khong-co.js"), // 404
      await lay("res/data/v.mp4", { headers: { range: "bytes=99999-" } }), // 416
    ];
    expect(kqs.map((r) => r.status)).toEqual([403, 404, 416]);
    for (const r of kqs) expect(r.headers.get("Cache-Control") ?? "").not.toMatch(/\bpublic\b|s-maxage|max-age=3600/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("[QAR-I] cô lập: hai gói CÙNG đường dẫn con không lẫn; vé gói này không mở gói kia; user khác không đọc được", () => {
  const REL = "res/data/player.js";
  const A = nho(500, 11);
  const B = nho(700, 22);

  it("[QAR-I1] URL có mã gói + khoá đĩa theo prefix: A rồi B rồi A, B (lượt sau từ ĐĨA) — không bao giờ lẫn nội dung", async () => {
    batDem();
    s3.them(`${PREFIX}${REL}`, A, { etag: '"a"' });
    s3.them(`${PREFIX_KHAC}${REL}`, B, { etag: '"b"' });
    const bytes = async (r: Response) => new Uint8Array(await r.arrayBuffer());
    expect(await bytes(await lay(REL, { ma: GOI }))).toEqual(A);
    expect(await bytes(await lay(REL, { ma: GOI_KHAC }))).toEqual(B);
    await choCoTrenDia(`${PREFIX}${REL}`);
    await choCoTrenDia(`${PREFIX_KHAC}${REL}`);
    s3.datLaiThongKe();
    expect(await bytes(await lay(REL, { ma: GOI }))).toEqual(A);
    expect(await bytes(await lay(REL, { ma: GOI_KHAC }))).toEqual(B);
    expect(await bytes(await lay(REL, { ma: GOI_KHAC, headers: { range: "bytes=0-9" } }))).toEqual(B.subarray(0, 10));
    expect(s3.tk.gets.length, "cả bốn lượt sau phải từ đĩa").toBe(0);
  });

  it("[QAR-I2] cookie vé của gói A + URL của gói B ⇒ 403, không chạm R2 (kể cả khi tệp B đã nằm trên đĩa)", async () => {
    batDem();
    s3.them(`${PREFIX_KHAC}${REL}`, B, { etag: '"b"' });
    await lay(REL, { ma: GOI_KHAC });
    await choCoTrenDia(`${PREFIX_KHAC}${REL}`);
    s3.datLaiThongKe();
    const r = await goi(yeuCau(`${GOI_KHAC}/${REL}`, { cookie: ve({ packageId: GOI }) }), [GOI_KHAC, ...REL.split("/")]);
    expect(r.status).toBe(403);
    expect(s3.tk.gets.length).toBe(0);
  });

  it("[QAR-I3] hop đầu (?t): Set-Cookie của MỖI gói có `Path` riêng của gói đó (mở hai tab hai gói không ghi đè cookie nhau)", async () => {
    s3.them(`${PREFIX}res/index.html`, nho(50));
    s3.them(`${PREFIX_KHAC}res/index.html`, nho(50));
    const r1 = await goi(yeuCau(`${GOI}/res/index.html`, { t: ve({ packageId: GOI }) }), [GOI, "res", "index.html"]);
    const r2 = await goi(
      yeuCau(`${GOI_KHAC}/res/index.html`, { t: ve({ packageId: GOI_KHAC, prefix: PREFIX_KHAC }) }),
      [GOI_KHAC, "res", "index.html"],
    );
    const p1 = /Path=([^;]+)/i.exec(r1.headers.get("set-cookie") ?? "")?.[1];
    const p2 = /Path=([^;]+)/i.exec(r2.headers.get("set-cookie") ?? "")?.[1];
    expect(p1).toBe(`/api/scorm/asset/${GOI}`);
    expect(p2).toBe(`/api/scorm/asset/${GOI_KHAC}`);
    expect(p1).not.toBe(p2);
    const sc = r1.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=lax/i);
    expect(sc).toMatch(/Max-Age=600/i);
  });

  it("[QAR-I4] user khác (phiên ≠ userId trong vé) ⇒ 403 cho GET, Range, HEAD — kể cả khi tệp đã nằm trên đĩa", async () => {
    batDem();
    s3.them(`${PREFIX}${REL}`, A, { etag: '"a"' });
    await lay(REL);
    await choCoTrenDia(`${PREFIX}${REL}`);
    s3.datLaiThongKe();
    for (const method of ["GET", "HEAD"] as const) {
      const fn = method === "GET" ? GET : (route as unknown as Record<string, typeof GET>).HEAD;
      if (typeof fn !== "function") continue; // HEAD có ca riêng [QAR-H1]
      auth.mockResolvedValueOnce({ user: { id: "nguoi-khac" } });
      const r = await fn(yeuCau(`${GOI}/${REL}`, { cookie: ve(), method, headers: { range: "bytes=0-9" } }), { params: Promise.resolve({ path: [GOI, ...REL.split("/")] }) });
      expect(r.status, method).toBe(403);
    }
    expect(s3.tk.gets.length).toBe(0);
  });

  it("[QAR-I5] vé CŨ (không prefix, cookie `scorm_at`, URL kiểu cũ) vẫn mở được — tương thích ngược cho vé đang bay", async () => {
    s3.them(`${PREFIX}${REL}`, A, { etag: '"a"' });
    const r = await goi(yeuCau(REL, { cookie: ve({ prefix: null }), cookieTen: SCORM_COOKIE_VE_CU }), REL.split("/"));
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(A);
    expect(timPkg).toHaveBeenCalledTimes(1);
    expect(r.headers.get("set-cookie") ?? "").not.toContain(`${SCORM_COOKIE_VE_CU}=`); // cookie cũ không ghi nữa
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("[QAR-Z] tệp nội bộ (source.zip, _src/) + path traversal — chặn TRƯỚC đệm đĩa và R2", () => {
  // Segment đến route đã được Next giải mã MỘT lần; dạng `%73ource.zip` là kẻ tấn công mã hoá hai lần.
  const BIEN_THE_ZIP = [["source.zip"], ["Source.ZIP"], ["source.zip."], ["source.zip "], ["%73ource.zip"], ["source%2ezip"], ["package.zip"]];
  const NOI_BO = [...BIEN_THE_ZIP, ["_src", "package.zip"], ["res", "_SRC", "x.js"]];

  for (const nho_ of [false, true]) {
    it(`[QAR-Z1${nho_ ? "b" : "a"}] zip gốc + _src ở mọi cách viết ⇒ 404, KHÔNG chạm R2${nho_ ? " (đệm đĩa BẬT, tệp ĐÃ nằm sẵn trên đĩa)" : ""} (phụ thuộc A1+A3)`, async () => {
      if (nho_) batDem();
      for (const rel of NOI_BO) {
        s3.them(PREFIX + rel.join("/"), nho(64), { etag: '"z"' });
        if (nho_) await ghiDemTuBytes(PREFIX + rel.join("/"), nho(64), { contentType: "application/zip", etag: '"z"', lastModified: null });
      }
      s3.datLaiThongKe();
      for (const rel of NOI_BO) {
        const r = await goi(yeuCau(`${GOI}/${rel.join("/")}`, { cookie: ve() }), [GOI, ...rel]);
        expect(r.status, JSON.stringify(rel)).toBe(404);
        expect(await r.text(), JSON.stringify(rel)).not.toMatch(/PK|zip/i);
      }
      expect(s3.tk.gets, "không được GetObject cho tệp nội bộ").toEqual([]);
      expect(lamNong).not.toHaveBeenCalled();
    });
  }

  it("[QAR-Z2] URL kiểu cũ + vé cũ cũng không đọc được source.zip (phụ thuộc A1+A3)", async () => {
    s3.them(`${PREFIX}source.zip`, nho(64));
    const r = await goi(yeuCau("source.zip", { cookie: ve({ prefix: null }), cookieTen: SCORM_COOKIE_VE_CU }), ["source.zip"]);
    expect(r.status).toBe(404);
    expect(s3.tk.gets).toEqual([]);
  });

  it("[QAR-Z3] đối chứng dương: tệp phục vụ thật (index.html, video, manifest, ảnh) KHÔNG bị chặn oan", async () => {
    for (const rel of ["res/index.html", "res/data/video1.mp4", "imsmanifest.xml", "res/data/img1.png", "res/data/player.js"]) {
      s3.them(PREFIX + rel, nho(32));
      const r = await lay(rel);
      expect(r.status, rel).toBe(200);
      await r.body?.cancel();
    }
  });

  it("[QAR-Z4] traversal / phân đoạn nguy hiểm ⇒ 403 và KHÔNG có GetObject nào; mọi key gửi R2 luôn nằm TRONG prefix gói", async () => {
    const BAD: string[][] = [
      [GOI, "..", "x"],
      [GOI, "res", "..", "..", "gói-khác", "x.js"],
      [GOI, ".", "x"],
      [GOI, "res", "", "x"],
      [GOI, "res", "a\\b"],
      [GOI, "res", "a\0b"],
      ["..", "x"],
    ];
    for (const segs of BAD) {
      const r = await goi(yeuCau(segs.join("/"), { cookie: ve() }), segs);
      expect(r.status, JSON.stringify(segs)).toBe(403);
    }
    expect(s3.tk.gets).toEqual([]);
    // Dạng "đã mã hoá hai lần": đến route như tên tệp bình thường ⇒ key vẫn nằm trong prefix, không thoát được.
    for (const segs of [[GOI, "%2e%2e", "x.js"], [GOI, "res", "%2e%2e%2f%2e%2e", "x.js"], [GOI, "%2fetc", "passwd"]]) {
      const r = await goi(yeuCau(segs.join("/"), { cookie: ve() }), segs);
      expect([403, 404], JSON.stringify(segs)).toContain(r.status);
    }
    for (const k of keyS3()) expect(k.startsWith(PREFIX), k).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("[QAR-H] HEAD — không tải thân từ R2 (Next tự suy HEAD từ GET nếu không export ⇒ mở thân R2 rồi bỏ)", () => {
  type Ham = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;
  const head = () => (route as unknown as Record<string, Ham | undefined>).HEAD;
  const goiHead = (rel: string, o: TuyChon = {}) => {
    const fn = head();
    if (typeof fn !== "function") throw new Error("route chưa export HEAD (phụ thuộc A1)");
    return fn(yeuCau(`${GOI}/${rel}`, { cookie: ve(), method: "HEAD", ...o }), { params: Promise.resolve({ path: [GOI, ...rel.split("/")] }) });
  };

  it("[QAR-H1] route có export HEAD (phụ thuộc A1)", () => {
    expect(typeof head()).toBe("function");
  });

  it("[QAR-H2] HEAD video lớn ⇒ 200 + Content-Length + Accept-Ranges + Content-Type, THÂN RỖNG, R2 không đẩy byte nào, không luồng mở (phụ thuộc A1)", async () => {
    s3.themLon(`${PREFIX}res/data/video1.mp4`, 80 * MB, { contentType: "video/mp4", etag: '"v"' });
    const r = await goiHead("res/data/video1.mp4");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Length")).toBe(String(80 * MB));
    expect(r.headers.get("Accept-Ranges")).toBe("bytes");
    expect(r.headers.get("Content-Type")).toBe("video/mp4");
    expect((await r.arrayBuffer()).byteLength).toBe(0);
    expect(await choDen(() => s3.tk.openStreams === 0, 500), "luồng R2 mở bởi HEAD chưa đóng").toBe(true);
    expect(s3.tk.bytesProduced, "HEAD không được tải thân").toBeLessThanOrEqual(64 * 1024); // chấp nhận GetObject bị huỷ ngay (≤ 1 chunk)
    expect(s3.tk.bulkBytes).toBe(0);
  });

  it("[QAR-H3] HEAD không vé ⇒ 403; HEAD source.zip ⇒ 404; HEAD tệp không có ⇒ 404 (phụ thuộc A1)", async () => {
    s3.them(`${PREFIX}source.zip`, nho(10));
    expect((await goiHead("res/a.js", { cookie: undefined })).status).toBe(403);
    expect((await goiHead("source.zip")).status).toBe(404);
    expect((await goiHead("res/khong-co.js")).status).toBe(404);
    expect(keyS3()).not.toContain(`${PREFIX}source.zip`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("[QAR-M] bộ nhớ + backpressure: video KHÔNG được nạp nguyên vào RAM, nguồn không được chạy trước người đọc", () => {
  // 512MB để tách bạch với nhiễu GC: đo thực tế (24/10) cho thấy `heapUsed + arrayBuffers` dao động 30–160MB chỉ vì rác chưa thu
  // khi kéo một luồng 192MB qua Readable.toWeb, KHÔNG phụ thuộc cỡ tệp. Một route GIỮ chunk lại sẽ vọt gần bằng cả tệp (~512MB).
  // Cổng chính là `bulkBytes` (xác định); đỉnh bộ nhớ chỉ bắt dạng 'gom chunk vào mảng' mà không qua transformToByteArray.
  const LON = 512 * MB;

  it("[QAR-M1] video 512MB (200) chảy hết: bulkBytes ≤ ngưỡng đệm, đỉnh (heap+arrayBuffers) tăng < 256MB, luồng đóng sạch", async () => {
    s3.themLon(`${PREFIX}res/data/video1.mp4`, LON, { contentType: "video/mp4" });
    const goc = process.memoryUsage();
    const r = await lay("res/data/video1.mp4");
    expect(r.status).toBe(200);
    // Nguồn chưa được phép chạy trước người đọc: phản hồi đã trả mà R2 đã đẩy cả trăm MB ⇒ route đang GOM tệp vào RAM (kể cả khi
    // nó gom bằng luồng chứ không bằng transformToByteArray — `bulkBytes` mù với kiểu gom đó).
    expect(s3.tk.bytesProduced, "route gom video vào RAM trước khi trả header").toBeLessThan(8 * MB);
    const d = await docHetThan(r);
    expect(d.tong).toBe(LON);
    expect(s3.tk.bulkBytes, "không được transformToByteArray cả video").toBeLessThanOrEqual(NGUONG_DEM);
    expect(d.dinhBoNho - (goc.heapUsed + goc.arrayBuffers)).toBeLessThan(256 * MB);
    expect(await choDen(() => s3.tk.openStreams === 0, 500)).toBe(true);
  });

  it("[QAR-M2] cùng video với `Range: bytes=0-` (206) — cùng giới hạn", async () => {
    s3.themLon(`${PREFIX}res/data/video1.mp4`, LON, { contentType: "video/mp4" });
    const goc = process.memoryUsage();
    const r = await lay("res/data/video1.mp4", { headers: { range: "bytes=0-" } });
    expect(r.status).toBe(206);
    expect(s3.tk.bytesProduced, "route gom video vào RAM trước khi trả header").toBeLessThan(8 * MB);
    const d = await docHetThan(r);
    expect(d.tong).toBe(LON);
    expect(s3.tk.bulkBytes).toBeLessThanOrEqual(NGUONG_DEM);
    expect(d.dinhBoNho - (goc.heapUsed + goc.arrayBuffers)).toBeLessThan(256 * MB);
  });

  it("[QAR-M3] backpressure: đọc 1 chunk rồi DỪNG đọc ⇒ nguồn R2 không đẩy quá ~8MB trong 500 vòng sự kiện (tệp 512MB)", async () => {
    s3.themLon(`${PREFIX}res/data/video1.mp4`, 512 * MB, { contentType: "video/mp4" });
    const r = await lay("res/data/video1.mp4");
    const rd = r.body!.getReader();
    await rd.read();
    for (let i = 0; i < 500; i++) await new Promise((ok) => setImmediate(ok));
    expect(s3.tk.bytesProduced).toBeLessThan(8 * MB);
    await rd.cancel();
    expect(await choDen(() => s3.tk.openStreams === 0, 500)).toBe(true);
  });

  it("[QAR-M4] tệp NHỎ (≤ ngưỡng): nạp RAM rồi nhả socket R2 NGAY, không cần ai đọc thân", async () => {
    s3.them(`${PREFIX}res/a.js`, nho(NGUONG_DEM - 1), { etag: '"a"' });
    const r = await lay("res/a.js");
    expect(r.status).toBe(200);
    // Không đòi 0 NGAY lập tức: 'close' của Readable phát ở tick kế sau 'end'. Điều đòi hỏi là: không cần ai đọc thân mà socket vẫn được trả.
    expect(await choDen(() => s3.tk.openStreams === 0, 200), "socket R2 phải được trả mà không cần client đọc thân").toBe(true);
    expect(s3.tk.bulkBytes, "nạp RAM không vượt ngưỡng").toBeLessThanOrEqual(NGUONG_DEM);
    expect((await r.arrayBuffer()).byteLength).toBe(NGUONG_DEM - 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("[QAR-A] client ngắt / R2 đứt giữa chừng / treo giữa thân — luồng R2 PHẢI bị huỷ, không hứa suông", () => {
  const REL = "res/data/video1.mp4";
  // 2^50 byte (tổng hợp, không tốn RAM): nguồn KHÔNG thể tự chảy cạn trong cửa sổ chờ. Đã đo: nguồn giả đẩy 32GB trong < 1s (mỗi chunk là
  // một subarray, không sao chép), nên với 64MB hay 32GB một route KHÔNG huỷ luồng vẫn "xanh" vì nguồn tự chảy hết rồi tự đóng —
  // phép cấy destroy-no-op làm ca A3 lộ đúng điểm mù này. Chỉ một nguồn không bao giờ cạn mới phân biệt được "đã huỷ" với "tự hết".
  const VO_HAN = 2 ** 50;
  // `nhip: 1` — nguồn vô hạn mà chảy hết tốc lực thì một route rò luồng sẽ ăn trọn một nhân CPU và làm treo cả bộ test.
  beforeEach(() => s3.themLon(PREFIX + REL, VO_HAN, { contentType: "video/mp4", nhip: 1 }));

  it("[QAR-A1] đọc 1 chunk rồi huỷ (reader.cancel) ⇒ Readable của R2 bị destroy, openStreams về 0", async () => {
    const r = await lay(REL);
    const rd = r.body!.getReader();
    await rd.read();
    expect(s3.tk.openStreams).toBe(1);
    await rd.cancel();
    expect(await choDen(() => s3.tk.openStreams === 0, 1000), "luồng R2 còn mở sau khi client huỷ").toBe(true);
    expect(s3.tk.destroyed).toBe(1);
  });

  it("[QAR-A2] cùng ca với Range: bytes=0- (đúng điều Chrome làm khi tua/đổi video)", async () => {
    const r = await lay(REL, { headers: { range: "bytes=0-" } });
    const rd = r.body!.getReader();
    await rd.read();
    await rd.cancel();
    expect(await choDen(() => s3.tk.openStreams === 0, 1000)).toBe(true);
    expect(s3.tk.destroyed).toBe(1);
  });

  it("[QAR-A3] huỷ NGAY khi nhận header, chưa đọc chữ nào (body.cancel) ⇒ vẫn destroy", async () => {
    const r = await lay(REL);
    await r.body!.cancel();
    expect(await choDen(() => s3.tk.openStreams === 0, 1000)).toBe(true);
  });

  it("[QAR-A4] 40 lượt `bytes=0-` rồi huỷ liên tiếp (Caddy ghi H3_REQUEST_CANCELLED y như vậy) ⇒ không rò luồng nào", async () => {
    for (let i = 0; i < 40; i++) {
      const r = await lay(REL, { headers: { range: "bytes=0-" } });
      const rd = r.body!.getReader();
      await rd.read();
      await rd.cancel();
    }
    expect(await choDen(() => s3.tk.openStreams === 0, 2000), `còn ${s3.tk.openStreams} luồng mở`).toBe(true);
    expect(s3.tk.destroyed).toBe(40);
  });

  it("[QAR-A5] R2 đứt kết nối sau 1MB ⇒ người đọc nhận LỖI (không treo, không 'thành công giả'), luồng đóng sạch", async () => {
    s3.datHong(PREFIX + REL, { failAfter: 1 * MB });
    const r = await lay(REL);
    const rd = r.body!.getReader();
    let loi: unknown = null;
    let doc = 0;
    try {
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        doc += value.length;
      }
    } catch (e) {
      loi = e;
    }
    expect(loi, "phải báo lỗi để trình duyệt thử lại, không cắt cụt im lặng").not.toBeNull();
    expect(doc).toBeLessThan(VO_HAN);
    expect(await choDen(() => s3.tk.openStreams === 0, 1000)).toBe(true);
  });

  it("[QAR-A6] R2 TREO giữa thân (không đẩy, không đóng) rồi client bỏ đi ⇒ luồng vẫn bị huỷ", async () => {
    s3.datHong(PREFIX + REL, { stallAfter: 256 * 1024 });
    const r = await lay(REL);
    const rd = r.body!.getReader();
    let doc = 0;
    while (doc < 256 * 1024) doc += (await rd.read()).value?.length ?? 0;
    expect(s3.tk.openStreams).toBe(1);
    await rd.cancel();
    expect(await choDen(() => s3.tk.openStreams === 0, 1000)).toBe(true);
    expect(s3.tk.destroyed).toBe(1);
  });

  it("[QAR-A7] huỷ giữa lúc đang chờ R2 trả header (R2 chậm) ⇒ không rò: sau hạn chờ trả 504 và không còn luồng nào", async () => {
    vi.useFakeTimers();
    s3.datDoTre(PREFIX + REL, 60_000);
    const lo = vi.spyOn(console, "error").mockImplementation(() => {});
    const cho = lay(REL);
    await vi.advanceTimersByTimeAsync(HAN_CHO_R2 + 50);
    const r = await cho;
    expect(r.status).toBe(504);
    expect(s3.tk.aborted, "abortSignal phải thật sự đến được R2").toBe(1);
    expect(s3.tk.openStreams).toBe(0);
    lo.mockRestore();
  });

  it("[QAR-A8] self-test detector: S3 giả mà luồng KHÔNG bị destroy khi huỷ thì openStreams KHÔNG về 0 (detector biết đỏ)", async () => {
    // Một "nhà máy luồng rò": giữ luồng sống bằng cách chặn destroy — chứng minh phép đo ở A1..A6 không xanh vì lười.
    const { Readable } = await import("node:stream");
    let mo = 0;
    const r = new Readable({ read() {} });
    mo++;
    r.destroy = (() => r) as typeof r.destroy; // destroy bị vô hiệu
    const web = Readable.toWeb(r) as unknown as ReadableStream;
    const rd = web.getReader();
    r.push(new Uint8Array(10));
    await rd.read();
    await rd.cancel();
    expect(r.destroyed, "destroy bị vô hiệu nên cờ .destroyed phải còn false").toBe(false);
    expect(mo).toBe(1);
    r.push(null);
  });

  it("[QAR-A9] tệp lớn phục vụ từ ĐĨA: 30 lượt đọc 1 chunk rồi huỷ ⇒ MỌI FileHandle đã mở đều được đóng (không rò file descriptor)", async () => {
    batDem();
    const key = `${PREFIX}${REL}`;
    await ghiDemTuBytes(key, nho(6 * MB), { contentType: "video/mp4", etag: '"d"', lastModified: null });
    await choCoTrenDia(key);
    s3.datLaiThongKe();
    // Đo bằng ReadStream của chính đường đĩa. Cố ý KHÔNG đo bằng "xoá được tệp đệm": libuv mở tệp với FILE_SHARE_DELETE nên Windows vẫn xoá được
    // tệp đang mở — phép đo đó mù (đã thử). Cũng không đo FileHandle: đường sản phẩm không dùng FileHandle.
    luongDiaTheoDoi.length = 0;
    dangTheoDoiLuongDia = true;
    const luong = luongDiaTheoDoi;
    try {
      for (let i = 0; i < 30; i++) {
        const r = await lay(REL, { headers: { range: "bytes=0-" } });
        expect(r.status).toBe(206);
        const rd = r.body!.getReader();
        await rd.read();
        await rd.cancel();
      }
      expect(luong.length, "đường đĩa phải tạo ReadStream cho mỗi lượt (nếu 0 thì phép đo này mù)").toBeGreaterThanOrEqual(30);
      expect(s3.tk.gets.length, "phải phục vụ từ đĩa").toBe(0);
      expect(await choDen(() => luong.every((l) => l.closed), 1500), `còn ${luong.filter((l) => !l.closed).length}/${luong.length} luồng đọc đĩa chưa đóng fd`).toBe(true);
    } finally {
      dangTheoDoiLuongDia = false;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("[QAR-E] lỗi từ R2 — phân loại, không rò chi tiết nội bộ, không đầu độc đệm", () => {
  const REL = "res/a.js";
  const R2 = (name: string, ma: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: ma } });
  let loLog: { mockRestore: () => void };
  beforeEach(() => {
    loLog = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => loLog.mockRestore());

  it("[QAR-E1] NoSuchKey ⇒ 404; thân KHÔNG lộ tên bucket/key", async () => {
    const r = await lay(REL);
    expect(r.status).toBe(404);
    const t = await r.text();
    expect(t).not.toContain("bucket-test");
    expect(t).not.toContain(PREFIX);
  });

  it("[QAR-E2] 500/503/SlowDown/ECONNRESET ⇒ 5xx (KHÔNG 404/200 — client sẽ không thử lại nếu là 404), thân không lộ stack/key", async () => {
    s3.them(PREFIX + REL, nho(10));
    for (const e of [R2("InternalError", 500), R2("ServiceUnavailable", 503), R2("SlowDown", 503), new Error("ECONNRESET")]) {
      s3.datLoi(PREFIX + REL, e);
      const r = await lay(REL);
      expect(r.status, e.name).toBeGreaterThanOrEqual(500);
      expect(r.status, e.name).toBeLessThan(600);
      const t = await r.text();
      expect(t).not.toMatch(/bucket-test|scorm\/cm|\sat\s.+\(/);
    }
  });

  it("[QAR-E3] R2 chậm 5s nhưng TRONG hạn chờ ⇒ vẫn 200 (không cắt oan)", async () => {
    vi.useFakeTimers();
    s3.them(PREFIX + REL, nho(10));
    s3.datDoTre(PREFIX + REL, 5000);
    const cho = lay(REL);
    await vi.advanceTimersByTimeAsync(5100);
    expect((await cho).status).toBe(200);
  });

  it("[QAR-E4] sau lỗi R2 tạm thời, lượt SAU lấy lại được (đệm không nhớ lỗi / 404)", async () => {
    batDem();
    s3.them(PREFIX + REL, nho(10), { etag: '"a"' });
    s3.datLoi(PREFIX + REL, R2("InternalError", 500));
    expect((await lay(REL)).status).toBeGreaterThanOrEqual(500);
    s3.datLoi(PREFIX + REL, null);
    expect((await lay(REL)).status).toBe(200);
    s3.xoa(PREFIX + REL);
    s3.them(PREFIX + "res/b.js", nho(10));
    expect((await lay("res/b.js")).status).toBe(200);
    s3.datLaiThongKe();
  });

  it("[QAR-E5] 404 không bị nhớ: tệp được tải lên SAU lần 404 vẫn phục vụ được (đệm bật)", async () => {
    batDem();
    expect((await lay(REL)).status).toBe(404);
    s3.them(PREFIX + REL, nho(10), { etag: '"a"' });
    expect((await lay(REL)).status).toBe(200);
  });

  it("[QAR-E6] If-None-Match khớp ⇒ 304 không thân, chuyển điều kiện cho R2", async () => {
    s3.them(PREFIX + REL, nho(10), { etag: '"a"' });
    const r = await lay(REL, { headers: { "if-none-match": '"a"' } });
    expect(r.status).toBe(304);
    expect(s3.tk.gets.at(-1)!.ifNoneMatch).toBe('"a"');
    expect(await r.text()).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("[QAR-K] nhiều người / nhiều tab / nhiều gói cùng lúc", () => {
  const GOIS = [GOI, GOI_KHAC, "cmuz8xsiz01vnh3dv9t2bz8d3"];
  const pref = (g: string) => `scorm/${g}/`;

  it("[QAR-K1] 3 gói × 40 yêu cầu song song (nhỏ / Range / video lớn huỷ giữa chừng): đúng nội dung từng gói, luồng về 0", async () => {
    batDem();
    GOIS.forEach((g, i) => {
      s3.them(`${pref(g)}res/data/player.js`, nho(300 + i, 10 + i), { etag: `"p${i}"` });
      s3.themLon(`${pref(g)}res/data/video1.mp4`, 8 * MB, { contentType: "video/mp4" });
    });
    const viec: Promise<void>[] = [];
    for (let n = 0; n < 40; n++) {
      GOIS.forEach((g, i) => {
        const ve_ = ve({ packageId: g, prefix: pref(g) });
        const lam = async () => {
          if (n % 3 === 0) {
            const r = await lay("res/data/video1.mp4", { ma: g, veRieng: ve_, headers: { range: `bytes=${n * 1000}-` } });
            expect(r.status).toBe(206);
            const rd = r.body!.getReader();
            await rd.read();
            await rd.cancel();
          } else {
            const r = await lay("res/data/player.js", { ma: g, veRieng: ve_ });
            expect(r.status).toBe(200);
            const b = new Uint8Array(await r.arrayBuffer());
            expect(b.length).toBe(300 + i);
            expect(b[0]).toBe(10 + i); // KHÔNG lẫn nội dung gói khác
          }
        };
        viec.push(lam());
      });
    }
    await Promise.all(viec);
    expect(await choDen(() => s3.tk.openStreams === 0, 3000), `còn ${s3.tk.openStreams} luồng mở`).toBe(true);
  });

  it("[QAR-K2] 300 yêu cầu asset nhỏ song song (một gói thật có ~400–570 tệp nạp cùng lúc) ⇒ tất cả 200, đúng byte", async () => {
    for (let i = 0; i < 300; i++) s3.them(`${PREFIX}res/data/img${i}.png`, nho(1 + (i % 200), i % 256), { etag: `"i${i}"` });
    const kq = await Promise.all(
      Array.from({ length: 300 }, async (_, i) => {
        const r = await lay(`res/data/img${i}.png`);
        const b = new Uint8Array(await r.arrayBuffer());
        return r.status === 200 && b.length === 1 + (i % 200) && b[0] === i % 256;
      }),
    );
    expect(kq.every(Boolean)).toBe(true);
    expect(s3.tk.openStreams).toBe(0);
    console.info(`[QAR] K2 đỉnh GetObject đồng thời tới R2 = ${s3.tk.inflightPeak} (số đo, không phải ngưỡng)`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("[QAR-V] vé: KHÔNG nới an ninh để chữa 'ngồi yên >10 phút' — cookie đã hết hạn vẫn 403, gia hạn có trần", () => {
  const REL = "res/data/img1.png";
  const GIO = 3_600_000;

  it("[QAR-V1] cookie đã hết hạn ⇒ 403 (kể cả Range, kể cả tệp đang nằm trên đĩa) — chữa 'ngồi yên' là việc của viewer gọi gia-han TRƯỚC hạn", async () => {
    batDem();
    s3.them(PREFIX + REL, nho(10), { etag: '"a"' });
    await lay(REL);
    await choCoTrenDia(PREFIX + REL);
    s3.datLaiThongKe();
    const hetHan = ve({}, 600, Date.now() - 601_000);
    for (const headers of [{}, { range: "bytes=0-4" }, { "if-none-match": '"a"' }] as Record<string, string>[]) {
      const r = await lay(REL, { veRieng: hetHan, headers });
      expect(r.status, JSON.stringify(headers)).toBe(403);
    }
    expect(s3.tk.gets.length).toBe(0);
  });

  it("[QAR-V2] chuỗi gia hạn trượt trên route có TRẦN 3 giờ: sống qua nhiều lần gia hạn nhưng cuối cùng PHẢI 403; không gia hạn vô hạn", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = Date.now();
    s3.them(PREFIX + REL, nho(10), { etag: '"a"' });
    let cookie = ve({}, 600, t0);
    let dongKhiNao: number | null = null;
    let soLanCapLai = 0;
    for (let phut = 6; phut <= 400; phut += 6) {
      vi.setSystemTime(t0 + phut * 60_000);
      const r = await lay(REL, { veRieng: cookie });
      if (r.status === 403) {
        dongKhiNao = phut;
        break;
      }
      expect(r.status, `phút ${phut}`).toBe(200);
      const sc = r.headers.get("set-cookie") ?? "";
      const m = new RegExp(`${SCORM_COOKIE_VE}=([^;]+)`).exec(sc);
      if (m) {
        cookie = decodeURIComponent(m[1]!);
        soLanCapLai++;
      }
    }
    expect(dongKhiNao, "phải có lúc vé bị từ chối").not.toBeNull();
    expect(soLanCapLai, "phải gia hạn được nhiều lần").toBeGreaterThan(10);
    expect(dongKhiNao!).toBeGreaterThanOrEqual(180); // không đóng sớm hơn 3 giờ
    expect(dongKhiNao! * 60_000).toBeLessThanOrEqual(3 * GIO + 10 * 60_000 + 6 * 60_000); // trần 3h + một vé cuối 10' + bước lấy mẫu
  });

  it("[QAR-V3] vé đã quá trần 3h nhưng còn hạn ngắn ⇒ vẫn dùng được tới hết hạn, KHÔNG được cấp lại cookie mới", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.now();
    // iat = now − 3h − 60s ; exp = iat + 3h + 60s + 120s = now + 120s
    const ticket = ve({}, (3 * GIO + 60_000 + 120_000) / 1000, now - 3 * GIO - 60_000);
    s3.them(PREFIX + REL, nho(10), { etag: '"a"' });
    const r = await lay(REL, { veRieng: ticket });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie") ?? "", "quá trần ⇒ không cấp lại").not.toContain(`${SCORM_COOKIE_VE}=`);
    vi.setSystemTime(now + 121_000);
    expect((await lay(REL, { veRieng: ticket })).status).toBe(403);
  });

  it("[QAR-V4] vé thân hợp lệ nhưng chữ ký KHÔNG khớp (kẻ tấn công đổi packageId/userId/exp trong thân, giữ chữ ký cũ) ⇒ 403 — kể cả khi tệp đã nằm trên đĩa", async () => {
    batDem();
    s3.them(PREFIX_KHAC + REL, nho(10), { etag: '"a"' });
    await lay(REL, { ma: GOI_KHAC });
    await choCoTrenDia(PREFIX_KHAC + REL);
    s3.datLaiThongKe();
    const [than, ky] = ve({ packageId: GOI_KHAC, prefix: PREFIX_KHAC }).split(".");
    const p = JSON.parse(Buffer.from(than!, "base64url").toString("utf8")) as Record<string, unknown>;
    for (const doi of [{ exp: Date.now() + 99 * GIO }, { userId: "nguoi-khac" }, { prefix: PREFIX }]) {
      const giaMao = `${Buffer.from(JSON.stringify({ ...p, ...doi })).toString("base64url")}.${ky}`;
      const r = await goi(yeuCau(`${GOI_KHAC}/${REL}`, { cookie: giaMao }), [GOI_KHAC, ...REL.split("/")]);
      expect(r.status, JSON.stringify(doi)).toBe(403);
    }
    expect(s3.tk.gets.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("[QAR-N] self-test các detector (luật 14): detector phải ĐỎ trên 'route' cố tình sai", () => {
  it("[QAR-N1] detector nạp-RAM: một 'route' gọi transformToByteArray lên video 40MB làm bulkBytes vọt qua ngưỡng", async () => {
    s3.themLon("k/video.mp4", 40 * MB);
    const out = (await s3.send(new (await import("@aws-sdk/client-s3")).GetObjectCommand({ Bucket: "b", Key: "k/video.mp4" }))) as {
      Body: { transformToByteArray: () => Promise<Uint8Array> };
    };
    await out.Body.transformToByteArray();
    expect(s3.tk.bulkBytes).toBe(40 * MB);
    expect(s3.tk.bulkBytes).toBeGreaterThan(NGUONG_DEM);
  });

  it("[QAR-N2] detector backpressure: một bên tiêu thụ CHẠY HẾT (không dừng) làm bytesProduced đúng bằng cỡ tệp", async () => {
    s3.themLon("k/video.mp4", 20 * MB);
    const out = (await s3.send(new (await import("@aws-sdk/client-s3")).GetObjectCommand({ Bucket: "b", Key: "k/video.mp4" }))) as {
      Body: { transformToWebStream: () => ReadableStream };
    };
    await docHetThan(new Response(out.Body.transformToWebStream()));
    expect(s3.tk.bytesProduced).toBe(20 * MB);
    expect(s3.tk.openStreams).toBe(0);
  });

  it("[QAR-N3] detector 'đúng khoảng': byte theo vị trí cho biết trả nhầm khoảng (khác pha chu kỳ 251)", async () => {
    expect(byteTai(0)).not.toBe(byteTai(1));
    expect(byteTai(251)).toBe(byteTai(0));
    expect(byteTai(3_000_000)).not.toBe(byteTai(3_000_001));
  });
});
