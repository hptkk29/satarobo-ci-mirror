// lib/scorm/qa-s3-gia.ts — S3/R2 GIẢ cho bộ test QA độc lập của đường phát asset SCORM (24/10/2026). KHÔNG phải mã sản phẩm.
//
// Vì sao tự dựng thay vì `vi.fn()` trả `{ transformToWebStream: () => new ReadableStream(...) }` như `asset-route.test.ts`:
// bản đó trả luồng web đã đóng sẵn nên KHÔNG thể hiện được ba thứ làm nên lỗi thật — (1) luồng còn MỞ sau khi client ngắt,
// (2) bên sản xuất cứ đẩy byte dù không ai đọc (không backpressure), (3) tệp bị nạp nguyên vào RAM. Ở đây Body là một
// `Readable` thật của Node (đúng hình dạng thân trả lời của SDK: IncomingMessage + mixin `transformTo*`) cộng bộ đếm:
//   · `openStreams` / `destroyed`  — đo bằng `.destroyed` + sự kiện 'close', KHÔNG bằng cờ tự đặt;
//   · `bytesProduced`              — số byte bên sản xuất đã đẩy ra (backpressure ⇒ bị chặn ở vài chục KB);
//   · `bulkBytes`                  — chỉ tăng khi ai đó gọi `transformToByteArray` (= nạp nguyên thân vào RAM).
// Nội dung tệp tổng hợp: byte thứ i = i % 251 (số nguyên tố ⇒ không trùng chu kỳ với cỡ chunk), nên kiểm được "trả đúng KHOẢNG"
// mà không cần giữ tệp 200MB trong bộ nhớ: mọi chunk là `subarray` của MỘT vùng đệm chung, giả lập không cấp phát thêm gì.
import { Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

export const CHU_KY = 251;
const CHUNK = 64 * 1024;
/** Vùng đệm chung: chunk = subarray (không cấp phát). Dài hơn CHUNK + CHU_KY để cắt từ mọi pha của chu kỳ. */
const MAU = (() => {
  const b = new Uint8Array(CHUNK + CHU_KY * 2);
  for (let i = 0; i < b.length; i++) b[i] = i % CHU_KY;
  return b;
})();

/** Byte kỳ vọng ở vị trí `i` của tệp tổng hợp. */
export const byteTai = (i: number): number => i % CHU_KY;

export type TepGia = {
  /** Tệp nhỏ có nội dung riêng (ưu tiên hơn `size`). */
  bytes?: Uint8Array;
  /** Tệp lớn tổng hợp: chỉ cần cỡ. */
  size?: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
  /**
   * Nhịp (ms) giữa hai chunk; 0/bỏ trống = chảy hết tốc lực. BẮT BUỘC cho nguồn "vô hạn" (cỡ ~2^50): nếu một route RÒ luồng, nguồn
   * chảy hết tốc lực sẽ ăn 100% một nhân CPU cho tới khi bị giết — CI treo thay vì đỏ (đã gặp khi cấy lỗi destroy-no-op).
   */
  nhip?: number;
};

export type HongGiuaChung = {
  /** Sau ngần này byte thì luồng nổ lỗi (R2 đứt kết nối giữa chừng). */
  failAfter?: number;
  /** Sau ngần này byte thì luồng đứng im (không đẩy thêm, không đóng) — R2/mạng treo giữa thân. */
  stallAfter?: number;
};

export type ThongKeS3 = {
  gets: { key: string; range: string | undefined; ifNoneMatch: string | undefined }[];
  heads: string[];
  lists: { prefix: string | undefined; token: string | undefined }[];
  openStreams: number;
  destroyed: number;
  bytesProduced: number;
  bulkBytes: number;
  /** Thân lớn nhất từng bị nạp nguyên vào RAM qua transformToByteArray (byte). */
  bulkMax: number;
  /** Số lệnh đang chạy đồng thời (kể cả lúc chờ độ trễ) và đỉnh của nó. */
  inflight: number;
  inflightPeak: number;
  /** Số lệnh bị huỷ bởi abortSignal. */
  aborted: number;
  /** Số GetObject đã trả luồng nhưng luồng CHƯA đóng — để chẩn đoán rò. */
  bodiesOpened: number;
};

function loiS3(ten: string, ma: number): Error {
  return Object.assign(new Error(ten), { name: ten, $metadata: { httpStatusCode: ma } });
}

function docRangeGia(h: string | undefined, size: number): { start: number; end: number } | "khong-thoa" | null {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(h.trim());
  if (!m) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    if (m[2] === "") return null;
    const n = Number(m[2]);
    if (n <= 0) return "khong-thoa";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    if (start >= size) return "khong-thoa";
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (end < start) return "khong-thoa";
  }
  return { start, end };
}

export type S3Gia = ReturnType<typeof taoS3Gia>;

export function taoS3Gia() {
  const tep = new Map<string, TepGia>();
  const doTre = new Map<string, number>();
  const loi = new Map<string, Error>();
  const hong = new Map<string, HongGiuaChung>();
  const tk: ThongKeS3 = {
    gets: [],
    heads: [],
    lists: [],
    openStreams: 0,
    destroyed: 0,
    bytesProduced: 0,
    bulkBytes: 0,
    bulkMax: 0,
    inflight: 0,
    inflightPeak: 0,
    aborted: 0,
    bodiesOpened: 0,
  };
  let doTreMacDinh = 0;
  let trangListTrang = 1000;

  const kichThuoc = (f: TepGia): number => f.bytes?.length ?? f.size ?? 0;

  /** Mẫu byte của khoảng [start, end] — mỗi chunk là subarray của vùng đệm chung. */
  function chunkTai(f: TepGia, viTri: number, toiDa: number): Uint8Array {
    if (f.bytes) return f.bytes.subarray(viTri, viTri + toiDa);
    const pha = viTri % CHU_KY;
    return MAU.subarray(pha, pha + toiDa);
  }

  function taoBody(f: TepGia, start: number, end: number, h: HongGiuaChung | undefined) {
    let vt = start;
    let daDay = 0;
    const r = new Readable({
      highWaterMark: CHUNK,
      read() {
        if (h?.stallAfter !== undefined && daDay >= h.stallAfter) return; // treo: không đẩy, không đóng
        if (h?.failAfter !== undefined && daDay >= h.failAfter) {
          this.destroy(Object.assign(new Error("ECONNRESET giữa thân"), { code: "ECONNRESET" }));
          return;
        }
        if (vt > end) {
          this.push(null);
          return;
        }
        let n = Math.min(CHUNK, end - vt + 1);
        if (h?.failAfter !== undefined) n = Math.min(n, Math.max(1, h.failAfter - daDay));
        if (h?.stallAfter !== undefined) n = Math.min(n, Math.max(1, h.stallAfter - daDay));
        const c = chunkTai(f, vt, n);
        vt += c.length;
        daDay += c.length;
        tk.bytesProduced += c.length;
        if (f.nhip && f.nhip > 0) {
          setTimeout(() => {
            if (!this.destroyed) this.push(c);
          }, f.nhip);
          return;
        }
        this.push(c);
      },
    });
    tk.openStreams++;
    tk.bodiesOpened++;
    r.on("close", () => {
      tk.openStreams--;
      if (r.destroyed) tk.destroyed++;
    });
    // Mixin của SDK. `transformToByteArray` = nạp NGUYÊN thân vào RAM ⇒ tính vào bulkBytes.
    const mixin = {
      transformToByteArray: async (): Promise<Uint8Array> => {
        const parts: Buffer[] = [];
        for await (const c of r) parts.push(Buffer.from(c as Uint8Array));
        const out = new Uint8Array(Buffer.concat(parts));
        tk.bulkBytes += out.length;
        tk.bulkMax = Math.max(tk.bulkMax, out.length);
        return out;
      },
      transformToString: async (): Promise<string> => Buffer.from(await mixin.transformToByteArray()).toString("utf8"),
      transformToWebStream: (): ReadableStream => Readable.toWeb(r) as unknown as ReadableStream,
    };
    return Object.assign(r, mixin);
  }

  function cho(ms: number, signal: AbortSignal | undefined): Promise<void> {
    if (ms <= 0 && !signal?.aborted) return Promise.resolve();
    return new Promise((ok, loiCho) => {
      const baoHuy = () => {
        tk.aborted++;
        loiCho(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      };
      if (signal?.aborted) return baoHuy();
      const h = setTimeout(() => {
        signal?.removeEventListener("abort", baoHuy);
        ok();
      }, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(h);
          baoHuy();
        },
        { once: true },
      );
    });
  }

  async function send(cmd: unknown, opts?: { abortSignal?: AbortSignal }): Promise<unknown> {
    tk.inflight++;
    tk.inflightPeak = Math.max(tk.inflightPeak, tk.inflight);
    try {
      if (cmd instanceof GetObjectCommand || cmd instanceof HeadObjectCommand) {
        const laHead = cmd instanceof HeadObjectCommand;
        const key = String(cmd.input.Key);
        const rangeIn = laHead ? undefined : (cmd.input as { Range?: string }).Range;
        const inm = laHead ? undefined : (cmd.input as { IfNoneMatch?: string }).IfNoneMatch;
        if (laHead) tk.heads.push(key);
        else tk.gets.push({ key, range: rangeIn, ifNoneMatch: inm });
        await cho(doTre.get(key) ?? doTreMacDinh, opts?.abortSignal);
        const e = loi.get(key);
        if (e) throw e;
        const f = tep.get(key);
        if (!f) throw loiS3(laHead ? "NotFound" : "NoSuchKey", 404);
        const size = kichThuoc(f);
        if (inm && f.etag && inm === f.etag) throw loiS3("NotModified", 304);
        const im = laHead ? undefined : (cmd.input as { IfMatch?: string }).IfMatch;
        if (im && f.etag && im !== f.etag) throw loiS3("PreconditionFailed", 412); // R2/S3 thật kiểm If-Match: route dùng nó để đỡ phần If-Range
        const kq = docRangeGia(rangeIn, size);
        if (kq === "khong-thoa") throw loiS3("InvalidRange", 416);
        const start = kq ? kq.start : 0;
        const end = kq ? kq.end : size - 1;
        const meta = {
          ContentType: f.contentType ?? "application/octet-stream",
          ETag: f.etag,
          LastModified: f.lastModified ?? new Date("2026-10-01T00:00:00Z"),
          AcceptRanges: "bytes",
          ContentLength: size === 0 ? 0 : end - start + 1,
          ...(kq ? { ContentRange: `bytes ${start}-${end}/${size}` } : {}),
        };
        if (laHead) return { ...meta, ContentLength: size };
        return { ...meta, Body: taoBody(f, start, end, hong.get(key)) };
      }
      if (cmd instanceof ListObjectsV2Command) {
        const input = cmd.input;
        tk.lists.push({ prefix: input.Prefix, token: input.ContinuationToken });
        await cho(doTreMacDinh, opts?.abortSignal);
        const khoa = [...tep.keys()].filter((k) => k.startsWith(input.Prefix ?? "")).sort();
        const batDau = input.ContinuationToken ? khoa.findIndex((k) => k > input.ContinuationToken!) : 0;
        const lat = batDau < 0 ? [] : khoa.slice(batDau, batDau + trangListTrang);
        const conNua = batDau >= 0 && batDau + trangListTrang < khoa.length;
        return {
          Contents: lat.map((k) => ({ Key: k, Size: kichThuoc(tep.get(k)!) })),
          IsTruncated: conNua,
          NextContinuationToken: conNua ? lat[lat.length - 1] : undefined,
        };
      }
      throw new Error(`S3 giả: chưa hỗ trợ lệnh ${(cmd as { constructor?: { name?: string } })?.constructor?.name ?? "?"}`);
    } finally {
      tk.inflight--;
    }
  }

  return {
    tk,
    send,
    /** Thêm tệp nhỏ có nội dung. */
    them(key: string, bytes: Uint8Array, over: Partial<TepGia> = {}) {
      tep.set(key, { bytes, ...over });
    },
    /** Thêm tệp lớn tổng hợp theo cỡ (byte i = i % 251). */
    themLon(key: string, size: number, over: Partial<TepGia> = {}) {
      tep.set(key, { size, ...over });
    },
    xoa(key: string) {
      tep.delete(key);
    },
    coTep: (key: string) => tep.has(key),
    datDoTre(key: string | null, ms: number) {
      if (key === null) doTreMacDinh = ms;
      else doTre.set(key, ms);
    },
    datLoi(key: string, e: Error | null) {
      if (e) loi.set(key, e);
      else loi.delete(key);
    },
    datHong(key: string, h: HongGiuaChung | null) {
      if (h) hong.set(key, h);
      else hong.delete(key);
    },
    datCoTrang(n: number) {
      trangListTrang = n;
    },
    /** Xoá toàn bộ tệp + lỗi + thống kê. */
    datLai() {
      tep.clear();
      doTre.clear();
      loi.clear();
      hong.clear();
      doTreMacDinh = 0;
      trangListTrang = 1000;
      tk.gets.length = 0;
      tk.heads.length = 0;
      tk.lists.length = 0;
      tk.openStreams = 0;
      tk.destroyed = 0;
      tk.bytesProduced = 0;
      tk.bulkBytes = 0;
      tk.bulkMax = 0;
      tk.inflight = 0;
      tk.inflightPeak = 0;
      tk.aborted = 0;
      tk.bodiesOpened = 0;
    },
    /** Chỉ xoá thống kê (giữ tệp). */
    datLaiThongKe() {
      tk.gets.length = 0;
      tk.heads.length = 0;
      tk.lists.length = 0;
      tk.destroyed = 0;
      tk.bytesProduced = 0;
      tk.bulkBytes = 0;
      tk.bulkMax = 0;
      tk.inflightPeak = 0;
      tk.aborted = 0;
      tk.bodiesOpened = 0;
    },
  };
}

/** Chờ điều kiện đúng (poll bằng macrotask thật), tối đa `toiDaMs`. Trả về điều kiện cuối cùng. */
export async function choDen(dk: () => boolean, toiDaMs = 1000): Promise<boolean> {
  const han = Date.now() + toiDaMs;
  while (Date.now() < han) {
    if (dk()) return true;
    await new Promise((ok) => setTimeout(ok, 5));
  }
  return dk();
}

/** Đọc hết thân phản hồi, trả số byte + byte đầu/cuối + đỉnh bộ nhớ (heapUsed + arrayBuffers) lấy mẫu mỗi 64 chunk. */
export async function docHetThan(res: Response): Promise<{ tong: number; dau: number | null; cuoi: number | null; dinhBoNho: number }> {
  if (!res.body) return { tong: 0, dau: null, cuoi: null, dinhBoNho: 0 };
  const rd = res.body.getReader();
  let tong = 0;
  let dau: number | null = null;
  let cuoi: number | null = null;
  let dinh = 0;
  let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    if (dau === null && value.length > 0) dau = value[0]!;
    if (value.length > 0) cuoi = value[value.length - 1]!;
    tong += value.length;
    if (++n % 64 === 0) {
      const m = process.memoryUsage();
      dinh = Math.max(dinh, m.heapUsed + m.arrayBuffers);
    }
  }
  return { tong, dau, cuoi, dinhBoNho: dinh };
}
