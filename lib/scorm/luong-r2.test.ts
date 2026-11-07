// @vitest-environment node
// Phần thuần của đường phát asset SCORM (24/10/2026): luồng Node → Web có backpressure / huỷ / chống treo, phân loại lỗi R2,
// so khớp ETag + If-Range, log nén dòng. Không cần mạng, không cần Next.
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LoiTreo,
  NHO_PHIEN_LOI_MS,
  NHO_PHIEN_SONG_MS,
  _datLaiBoNhoPhien,
  _datLaiLog,
  boLuongNode,
  canhGacTreo,
  docDemSuKien,
  docHetLuong,
  ghiLogAsset,
  ifRangeKhop,
  khopIfNoneMatch,
  kiemPhienSongCoNho,
  phanLoaiLoiR2,
  taoPhienHuy,
} from "./luong-r2";

const MANH = 64 * 1024;

/** Nguồn sinh từng mảnh theo yêu cầu; `st.daSinh` = số mảnh nguồn đã bị đọc ra. */
function nguon(soManh: number, o: { loiSauManh?: number; dungSauManh?: number } = {}) {
  const st = { daSinh: 0 };
  let i = 0;
  const r = new Readable({
    highWaterMark: MANH,
    read() {
      if (o.dungSauManh !== undefined && i >= o.dungSauManh) return; // im lặng vĩnh viễn (nguồn treo)
      if (o.loiSauManh !== undefined && i >= o.loiSauManh) return this.destroy(new Error("ECONNRESET"));
      if (i >= soManh) return this.push(null);
      i++;
      st.daSinh++;
      this.push(Buffer.alloc(MANH, i % 251));
    },
  });
  return Object.assign(r, { st });
}

beforeEach(() => {
  _datLaiLog();
  _datLaiBoNhoPhien();
});
afterEach(() => vi.restoreAllMocks());

describe("[LR] boLuongNode: luồng Node → Web", () => {
  it("[LR-01] chuyển đủ byte, đúng thứ tự, rồi đóng", async () => {
    const r = boLuongNode(nguon(5)).getReader();
    let tong = 0;
    const dau: number[] = [];
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      tong += value.length;
      dau.push(value[0]!);
    }
    expect(tong).toBe(5 * MANH);
    expect(dau).toEqual([1, 2, 3, 4, 5]);
  });

  it("[LR-02] BACKPRESSURE: không ai đọc ⇒ nguồn chỉ bị hút tới ngưỡng hàng đợi, không bị hút cạn", async () => {
    const src = nguon(1000); // 64MB nếu bị hút cạn
    boLuongNode(src);
    await new Promise((r) => setTimeout(r, 50));
    // ngưỡng 256KB = 4 mảnh + đệm nội bộ của Readable + 1 mảnh đang bay; nhỏ hơn 1000 rất xa
    expect(src.st.daSinh).toBeLessThanOrEqual(10);
    expect(src.isPaused()).toBe(true);
  });

  it("[LR-03] client đọc chậm: độ lệch (nguồn đã sinh − client đã nhận) luôn nhỏ, tổng byte vẫn đủ", async () => {
    const src = nguon(300);
    const r = boLuongNode(src).getReader();
    let nhan = 0;
    let lechMax = 0;
    for (;;) {
      const { done } = await r.read();
      if (done) break;
      nhan++;
      lechMax = Math.max(lechMax, src.st.daSinh - nhan);
      if (nhan % 20 === 0) await new Promise((x) => setTimeout(x, 2));
    }
    expect(nhan).toBe(300);
    expect(lechMax).toBeLessThanOrEqual(10);
  });

  it("[LR-04] cancel (client đóng/ngắt) ⇒ nguồn bị HUỶ ngay (nhả socket R2 / fd đĩa)", async () => {
    const src = nguon(100);
    const kq = vi.fn();
    const r = boLuongNode(src, { khiXong: kq }).getReader();
    await r.read();
    await r.cancel();
    expect(src.destroyed).toBe(true);
    expect(kq).toHaveBeenCalledTimes(1);
    expect(kq.mock.calls[0]![0]).toBe("huy");
  });

  it("[LR-05] signal abort (req.signal) ⇒ nguồn bị huỷ và người đang đọc nhận AbortError, không treo", async () => {
    const ctl = new AbortController();
    const src = nguon(100);
    const r = boLuongNode(src, { signal: ctl.signal }).getReader();
    await r.read();
    ctl.abort();
    await expect(r.read()).rejects.toMatchObject({ name: "AbortError" });
    expect(src.destroyed).toBe(true);
  });

  it("[LR-06] signal đã abort từ trước ⇒ nguồn bị huỷ ngay khi dựng", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const src = nguon(10);
    boLuongNode(src, { signal: ctl.signal });
    expect(src.destroyed).toBe(true);
  });

  it("[LR-07] nguồn lỗi giữa chừng ⇒ phía nhận nhận lỗi (không treo, không đóng êm như thể đủ)", async () => {
    const kq = vi.fn();
    const r = boLuongNode(nguon(100, { loiSauManh: 3 }), { khiXong: kq }).getReader();
    let doc = 0;
    await expect(
      (async () => {
        for (;;) {
          const { done } = await r.read();
          if (done) return;
          doc++;
        }
      })(),
    ).rejects.toThrow("ECONNRESET");
    expect(doc).toBeLessThanOrEqual(3);
    expect(kq.mock.calls[0]![0]).toBe("loi");
  });

  it("[LR-08] nguồn ĐỨNG IM quá treoMs ⇒ cắt bằng LoiTreo và huỷ nguồn (không treo vô hạn)", async () => {
    const src = nguon(100, { dungSauManh: 2 });
    const r = boLuongNode(src, { treoMs: 40 }).getReader();
    await expect(
      (async () => {
        for (;;) if ((await r.read()).done) return;
      })(),
    ).rejects.toBeInstanceOf(LoiTreo);
    expect(src.destroyed).toBe(true);
  });

  it("[LR-09] client đọc CHẬM (ta tự tạm dừng) KHÔNG bị tính là nguồn treo", async () => {
    const src = nguon(40);
    const r = boLuongNode(src, { treoMs: 40 }).getReader();
    await r.read();
    await new Promise((x) => setTimeout(x, 150)); // lâu gấp ~4 lần treoMs, hàng đợi đầy ⇒ nguồn đang bị ta dừng
    let nhan = 1;
    for (;;) {
      const { done } = await r.read();
      if (done) break;
      nhan++;
    }
    expect(nhan).toBe(40);
  });

  it("[LR-10] khiXong gọi ĐÚNG MỘT lần dù cancel + abort + đóng nguồn dồn dập; nguồn ném lỗi muộn không thành unhandled", async () => {
    const ctl = new AbortController();
    const src = nguon(10);
    const kq = vi.fn();
    const r = boLuongNode(src, { signal: ctl.signal, khiXong: kq }).getReader();
    await r.read();
    ctl.abort();
    await r.cancel().catch(() => {});
    src.destroy(new Error("muộn"));
    await new Promise((x) => setTimeout(x, 10));
    expect(kq).toHaveBeenCalledTimes(1);
  });
});

describe("[LR] docHetLuong + canhGacTreo", () => {
  it("[LR-11] đọc hết luồng nhỏ vào Buffer", async () => {
    const b = await docHetLuong(nguon(3), { toiDaByte: 3 * MANH });
    expect(b.length).toBe(3 * MANH);
  });

  it("[LR-12] vượt trần byte (R2 khai sai ContentLength) ⇒ ném + HUỶ nguồn, không phình RAM", async () => {
    const src = nguon(100);
    await expect(docHetLuong(src, { toiDaByte: 2 * MANH })).rejects.toThrow(/vượt trần/);
    expect(src.destroyed).toBe(true);
    expect(src.st.daSinh).toBeLessThan(10);
  });

  it("[LR-13] nguồn im ⇒ LoiTreo (→ 504), nguồn bị huỷ; signal abort ⇒ AbortError", async () => {
    const src = nguon(100, { dungSauManh: 1 });
    await expect(docHetLuong(src, { toiDaByte: 1e9, treoMs: 30 })).rejects.toBeInstanceOf(LoiTreo);
    expect(src.destroyed).toBe(true);
    const ctl = new AbortController();
    const src2 = nguon(100, { dungSauManh: 1 });
    const p = docHetLuong(src2, { toiDaByte: 1e9, signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(src2.destroyed).toBe(true);
  });

  it("[LR-14] canhGacTreo: luồng chảy mà im quá hạn ⇒ nguồn bị huỷ bằng LoiTreo; dừng canh thì không huỷ nữa", async () => {
    const src = nguon(100, { dungSauManh: 1 });
    const loi = new Promise<unknown>((ok) => src.once("error", ok));
    canhGacTreo(src, 30);
    expect(await loi).toBeInstanceOf(LoiTreo);
    const src2 = nguon(100, { dungSauManh: 1 });
    const dung = canhGacTreo(src2, 30);
    dung();
    await new Promise((x) => setTimeout(x, 80));
    expect(src2.destroyed).toBe(false);
    src2.destroy();
  });
});

describe("[LR] phân loại lỗi + điều kiện HTTP", () => {
  it("[LR-15] phanLoaiLoiR2: 504 / 304 / 404 / 416 / 412 / còn lại 502 (không nuốt thành 404)", () => {
    expect(phanLoaiLoiR2(Object.assign(new Error(), { name: "AbortError" }))).toBe(504);
    expect(phanLoaiLoiR2(new LoiTreo(1))).toBe(504);
    expect(phanLoaiLoiR2({ name: "NotModified" })).toBe(304);
    expect(phanLoaiLoiR2({ $metadata: { httpStatusCode: 304 } })).toBe(304);
    expect(phanLoaiLoiR2({ name: "NoSuchKey" })).toBe(404);
    expect(phanLoaiLoiR2({ name: "NotFound" })).toBe(404);
    expect(phanLoaiLoiR2({ name: "InvalidRange" })).toBe(416);
    expect(phanLoaiLoiR2({ $metadata: { httpStatusCode: 412 } })).toBe(412);
    expect(phanLoaiLoiR2(new Error("ECONNRESET"))).toBe(502);
    expect(phanLoaiLoiR2(null)).toBe(502);
    expect(phanLoaiLoiR2({ $metadata: { httpStatusCode: 503 } })).toBe(502);
  });

  it("[LR-16] khopIfNoneMatch: đơn, danh sách, yếu `W/`, `*`; không có ETag ⇒ không khớp", () => {
    expect(khopIfNoneMatch('"a"', '"a"')).toBe(true);
    expect(khopIfNoneMatch('"b", "a"', '"a"')).toBe(true);
    expect(khopIfNoneMatch('W/"a"', '"a"')).toBe(true);
    expect(khopIfNoneMatch('"a"', 'W/"a"')).toBe(true);
    expect(khopIfNoneMatch("*", '"a"')).toBe(true);
    expect(khopIfNoneMatch('"b"', '"a"')).toBe(false);
    expect(khopIfNoneMatch('"a"', null)).toBe(false);
    expect(khopIfNoneMatch(null, '"a"')).toBe(false);
    expect(khopIfNoneMatch('"ab"', '"a"')).toBe(false);
  });

  it("[LR-17] ifRangeKhop: không có ⇒ true; ETag mạnh khớp/lệch; ETag yếu ⇒ false; dạng ngày chỉ khớp ĐÚNG Last-Modified", () => {
    const lm = "Mon, 12 Oct 2026 03:00:00 GMT";
    expect(ifRangeKhop(null, '"a"', lm)).toBe(true);
    expect(ifRangeKhop('"a"', '"a"', lm)).toBe(true);
    expect(ifRangeKhop('"b"', '"a"', lm)).toBe(false);
    expect(ifRangeKhop('"a"', null, lm)).toBe(false);
    expect(ifRangeKhop('W/"a"', '"a"', lm)).toBe(false);
    expect(ifRangeKhop(lm, '"a"', lm)).toBe(true);
    expect(ifRangeKhop("Tue, 13 Oct 2026 03:00:00 GMT", '"a"', lm)).toBe(false);
    expect(ifRangeKhop("rac", '"a"', lm)).toBe(false);
  });

  it("[LR-18] taoPhienHuy: client ngắt ⇒ lý do 'client'; hết hạn ⇒ 'het-han'; lý do đầu tiên thắng; signal đã abort sẵn cũng tính", () => {
    const ctl = new AbortController();
    const p = taoPhienHuy(ctl.signal);
    expect(p.lyDo()).toBeNull();
    ctl.abort();
    expect(p.signal.aborted).toBe(true);
    expect(p.lyDo()).toBe("client");
    p.hetHan();
    expect(p.lyDo()).toBe("client");
    const p2 = taoPhienHuy();
    p2.hetHan();
    expect(p2.signal.aborted).toBe(true);
    expect(p2.lyDo()).toBe("het-han");
    const sanAbort = new AbortController();
    sanAbort.abort();
    expect(taoPhienHuy(sanAbort.signal).lyDo()).toBe("client");
  });
});

describe("[LR] log có cấu trúc, nén dòng lặp", () => {
  it("[LR-19] cùng khoá: 5 dòng đầu in, phần dư chỉ đếm; sang cửa sổ mới in MỘT dòng tóm tắt; đếm sự kiện vẫn đủ", () => {
    const loi = vi.spyOn(console, "error").mockImplementation(() => {});
    const canh = vi.spyOn(console, "warn").mockImplementation(() => {});
    const T = Date.UTC(2026, 9, 24, 3, 0, 0);
    for (let i = 0; i < 50; i++) ghiLogAsset("r2:502:X", "error", "R2 lỗi", { packageId: "g", rel: `res/${i}.js` }, T + i);
    expect(loi).toHaveBeenCalledTimes(5);
    expect(docDemSuKien()["r2:502:X"]).toBe(50);
    ghiLogAsset("r2:502:X", "error", "R2 lỗi", { packageId: "g" }, T + 61_000);
    expect(canh).toHaveBeenCalledTimes(1);
    expect(String(canh.mock.calls[0]![0])).toContain("45");
    expect(loi).toHaveBeenCalledTimes(6);
    // khoá khác không bị khoá chung
    ghiLogAsset("404", "warn", "R2 không có khoá", {}, T + 61_000);
    expect(canh).toHaveBeenCalledTimes(2);
  });
});

describe("[LR] R2_ENDPOINT_URL: đổi endpoint cho dev/test, bỏ trống = hành vi y hệt", () => {
  const BIEN = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_PUBLIC_URL", "R2_ENDPOINT_URL"] as const;
  const goc: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of BIEN) goc[k] = process.env[k];
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET_NAME = "bucket-test";
    process.env.R2_PUBLIC_URL = "https://cdn.example.test";
    delete process.env.R2_ENDPOINT_URL;
    vi.resetModules(); // client là singleton theo module — đọc env ở lần gọi ĐẦU
  });
  afterEach(() => {
    for (const k of BIEN) {
      if (goc[k] === undefined) delete process.env[k];
      else process.env[k] = goc[k];
    }
    vi.resetModules();
  });

  it("[LR-20] không đặt (hoặc chỉ khoảng trắng) ⇒ endpoint R2 thật theo tài khoản, KHÔNG path-style — y hệt trước đây", async () => {
    for (const giaTri of [undefined, "   ", ""]) {
      vi.resetModules();
      if (giaTri === undefined) delete process.env.R2_ENDPOINT_URL;
      else process.env.R2_ENDPOINT_URL = giaTri;
      const { getR2Client } = await import("@/lib/storage/r2-client");
      const c = getR2Client();
      const ep = await c.config.endpoint!();
      expect(ep.hostname, JSON.stringify(giaTri)).toBe("acct.r2.cloudflarestorage.com");
      expect(ep.protocol).toBe("https:");
      expect(c.config.forcePathStyle).toBe(false);
    }
  });

  it("[LR-21] đặt ⇒ dùng endpoint đó và bật path-style (S3 giả ở 127.0.0.1:port không phân giải được `bucket.127.0.0.1`)", async () => {
    process.env.R2_ENDPOINT_URL = "http://127.0.0.1:19090";
    const { getR2Client } = await import("@/lib/storage/r2-client");
    const c = getR2Client();
    const ep = await c.config.endpoint!();
    expect(ep.hostname).toBe("127.0.0.1");
    expect(ep.port).toBe(19090);
    expect(ep.protocol).toBe("http:");
    expect(c.config.forcePathStyle).toBe(true);
  });
});

describe("[KP] kiểm phiên SỐNG khi gia hạn vé — gộp lượt đang bay + nhớ ngắn", () => {
  const T = 1_000_000;

  it("[KP-1] N lời gọi đồng thời cùng khoá ⇒ `kiem` chạy ĐÚNG 1 lần; cùng kết quả", async () => {
    const kiem = vi.fn(async () => true);
    const kq = await Promise.all(Array.from({ length: 12 }, () => kiemPhienSongCoNho("u1:0", kiem, T)));
    expect(kq).toEqual(Array(12).fill("song"));
    expect(kiem).toHaveBeenCalledTimes(1);
  });

  it("[KP-2] nhớ \"song\" NHO_PHIEN_SONG_MS: trong hạn không hỏi lại; quá hạn hỏi lại", async () => {
    const kiem = vi.fn(async () => true);
    await kiemPhienSongCoNho("u1:0", kiem, T);
    await kiemPhienSongCoNho("u1:0", kiem, T + NHO_PHIEN_SONG_MS - 1);
    expect(kiem).toHaveBeenCalledTimes(1);
    await kiemPhienSongCoNho("u1:0", kiem, T + NHO_PHIEN_SONG_MS + 1);
    expect(kiem).toHaveBeenCalledTimes(2);
  });

  it("[KP-3] \"chet\" cũng được nhớ (cùng hạn) và KHÔNG bị đổi thành \"song\" khi hỏi lại trong hạn", async () => {
    const kiem = vi.fn(async () => false);
    expect(await kiemPhienSongCoNho("u1:0", kiem, T)).toBe("chet");
    kiem.mockResolvedValue(true);
    expect(await kiemPhienSongCoNho("u1:0", kiem, T + 1000)).toBe("chet");
    expect(kiem).toHaveBeenCalledTimes(1);
  });

  it("[KP-4] `kiem` NÉM LỖI ⇒ \"khong-ro\" (không ném ra ngoài), nhớ chỉ NHO_PHIEN_LOI_MS rồi hỏi lại", async () => {
    const kiem = vi.fn<() => Promise<boolean>>().mockRejectedValue(new Error("ECONNRESET"));
    expect(await kiemPhienSongCoNho("u1:0", kiem, T)).toBe("khong-ro");
    expect(await kiemPhienSongCoNho("u1:0", kiem, T + NHO_PHIEN_LOI_MS - 1)).toBe("khong-ro");
    expect(kiem).toHaveBeenCalledTimes(1);
    kiem.mockResolvedValue(true);
    expect(await kiemPhienSongCoNho("u1:0", kiem, T + NHO_PHIEN_LOI_MS + 1)).toBe("song");
    expect(kiem).toHaveBeenCalledTimes(2);
  });

  it("[KP-5] khoá khác (user khác / tokenVersion khác) KHÔNG dùng chung kết quả", async () => {
    const kiem = vi.fn(async () => true);
    await kiemPhienSongCoNho("u1:0", kiem, T);
    await kiemPhienSongCoNho("u2:0", kiem, T);
    await kiemPhienSongCoNho("u1:1", kiem, T);
    expect(kiem).toHaveBeenCalledTimes(3);
  });

  it("[KP-6] `kiem` ném lỗi ĐỒNG BỘ (trước khi trả promise) cũng ra \"khong-ro\", không rò entry đang-bay", async () => {
    const kiem = vi.fn<() => Promise<boolean>>(() => {
      throw new Error("sync");
    });
    expect(await kiemPhienSongCoNho("u1:0", kiem, T)).toBe("khong-ro");
    kiem.mockImplementation(async () => true);
    expect(await kiemPhienSongCoNho("u1:0", kiem, T + NHO_PHIEN_LOI_MS + 1)).toBe("song");
  });
});
