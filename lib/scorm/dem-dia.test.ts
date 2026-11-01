// @vitest-environment node
// Đệm đĩa asset SCORM: ghi/đọc, hạn dùng, dọn theo trần, làm nóng cả gói (gộp lượt gọi, nghỉ giữa hai lần). R2 giả lập.
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Các ca trong tệp này ghi/đọc HÀNG CHỤC tệp nhỏ xuống đĩa thật. Chạy riêng ~60 ms/ca, nhưng trong lượt toàn repo (≈19 worker cùng đụng đĩa, Windows có quét thời gian thực)
// từng thấy quá hạn 5 s mặc định ở SCD-04/QAL-01/QAL-02 (24/10/2026). Nới hạn chờ cho CẢ TỆP thay vì từng ca; nó chỉ đổi ngưỡng treo, không đổi điều khẳng định nào.
vi.setConfig({ testTimeout: 30_000 });

vi.mock("server-only", () => ({}));

const send = vi.fn();
vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({ send: (c: unknown, o: unknown) => send(c, o) }),
  getR2Bucket: () => "bucket-test",
}));

import {
  NGUONG_LAM_NONG_BYTE,
  _datLaiTrangThai,
  demDangBat,
  docMetaDem,
  docToanBoDem,
  donDem,
  ghiDemTuBytes,
  ghiNhanLoiR2,
  lamNongGoi,
  moLuongDem,
  moLuongDemAnToan,
} from "./dem-dia";

const MB = 1024 * 1024;
const T0 = Date.UTC(2026, 9, 12, 3, 0, 0); // đồng hồ ĐÓNG BĂNG (luật 19)
const META = { contentType: "text/javascript", etag: '"e1"', lastModified: "Mon, 12 Oct 2026 03:00:00 GMT" };
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scorm-dem-test-"));
  process.env.SCORM_CACHE_DIR = dir;
  delete process.env.SCORM_CACHE_OFF;
  delete process.env.SCORM_CACHE_MAX_MB;
  delete process.env.SCORM_CACHE_TTL_HOURS;
  _datLaiTrangThai();
  send.mockReset();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

async function demTep(): Promise<{ bin: number; json: number }> {
  let bin = 0;
  let json = 0;
  for (const con of await readdir(dir)) {
    for (const t of await readdir(join(dir, con))) {
      if (t.endsWith(".bin")) bin++;
      if (t.endsWith(".json")) json++;
    }
  }
  return { bin, json };
}

describe("[DD] đệm đĩa: ghi / đọc / hạn dùng", () => {
  it("[DD-01] ghi rồi đọc lại đúng byte + meta; khoá khác ⇒ trượt", async () => {
    const byte = new Uint8Array([1, 2, 3, 4, 5]);
    await ghiDemTuBytes("scorm/g1/res/a.js", byte, META, T0);
    const meta = await docMetaDem("scorm/g1/res/a.js", T0 + 1000);
    expect(meta).toMatchObject({ contentType: "text/javascript", etag: '"e1"', size: 5, luc: T0 });
    expect([...(await docToanBoDem("scorm/g1/res/a.js"))]).toEqual([1, 2, 3, 4, 5]);
    expect(await docMetaDem("scorm/g1/res/KHAC.js", T0)).toBeNull();
  });

  it("[DD-02] hạn dùng 72h (đổi được bằng env): quá hạn ⇒ trượt", async () => {
    await ghiDemTuBytes("scorm/g1/a", new Uint8Array(3), META, T0);
    expect(await docMetaDem("scorm/g1/a", T0 + 71 * 3600_000)).not.toBeNull();
    expect(await docMetaDem("scorm/g1/a", T0 + 73 * 3600_000)).toBeNull();
    process.env.SCORM_CACHE_TTL_HOURS = "1";
    expect(await docMetaDem("scorm/g1/a", T0 + 2 * 3600_000)).toBeNull();
  });

  it("[DD-03] mục dở dang (kích thước đĩa ≠ meta) ⇒ trượt, không phục vụ tệp cụt", async () => {
    await ghiDemTuBytes("scorm/g1/a", new Uint8Array(10), META, T0);
    // sửa meta khai 99 byte trong khi đĩa có 10
    const { readFile, writeFile } = await import("node:fs/promises");
    const con = (await readdir(dir))[0]!;
    const json = (await readdir(join(dir, con))).find((t) => t.endsWith(".json"))!;
    const m = JSON.parse(await readFile(join(dir, con, json), "utf8"));
    m.size = 99;
    await writeFile(join(dir, con, json), JSON.stringify(m));
    expect(await docMetaDem("scorm/g1/a", T0)).toBeNull();
  });

  it("[DD-04] luồng đọc theo KHOẢNG [start,end] đóng", async () => {
    await ghiDemTuBytes("scorm/g1/v.mp4", new Uint8Array([10, 11, 12, 13, 14, 15]), META, T0);
    const chunks: Buffer[] = [];
    for await (const c of moLuongDem("scorm/g1/v.mp4", { start: 2, end: 4 })) chunks.push(c as Buffer);
    expect([...Buffer.concat(chunks)]).toEqual([12, 13, 14]);
  });

  it("[DD-05] SCORM_CACHE_OFF=1 ⇒ tắt hẳn: không ghi, không đọc (rollback không cần triển khai lại)", async () => {
    process.env.SCORM_CACHE_OFF = "1";
    expect(demDangBat()).toBe(false);
    await ghiDemTuBytes("scorm/g1/a", new Uint8Array(3), META, T0);
    expect(await readdir(dir)).toEqual([]);
    expect(await docMetaDem("scorm/g1/a", T0)).toBeNull();
    const kq = await lamNongGoi("scorm/g1/");
    expect(kq.tai).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("[DD] dọn đệm theo trần + hạn", () => {
  async function tao(key: string, bytes: number, mtimeMs: number) {
    await ghiDemTuBytes(key, new Uint8Array(bytes), META, mtimeMs);
    // đặt mtime của .bin để phân biệt cũ/mới
    for (const con of await readdir(dir)) {
      for (const t of await readdir(join(dir, con))) {
        if (!t.endsWith(".bin")) continue;
        const { createHash } = await import("node:crypto");
        const h = createHash("sha256").update(key).digest("hex");
        if (t === `${h}.bin`) await utimes(join(dir, con, t), mtimeMs / 1000, mtimeMs / 1000);
      }
    }
  }

  it("[DD-06] vượt trần ⇒ xoá mục CŨ NHẤT trước, dừng khi ≤ 80% trần; xoá cả .bin lẫn .json", async () => {
    process.env.SCORM_CACHE_MAX_MB = "1"; // trần 1MB
    await tao("k/cu", 400 * 1024, T0 - 3000);
    await tao("k/giua", 400 * 1024, T0 - 2000);
    await tao("k/moi", 400 * 1024, T0 - 1000); // tổng 1,2MB > 1MB
    const kq = await donDem(T0, true);
    expect(kq.xoa).toBeGreaterThanOrEqual(1);
    expect(await docMetaDem("k/cu", T0)).toBeNull(); // cũ nhất đã bị dọn
    expect(await docMetaDem("k/moi", T0)).not.toBeNull(); // mới nhất còn
    const { bin, json } = await demTep();
    expect(bin).toBe(json); // không để lại nửa mục
    expect(kq.conLaiByte).toBeLessThanOrEqual(0.8 * MB);
  });

  it("[DD-07] mục quá hạn bị dọn dù chưa chạm trần", async () => {
    await tao("k/qua-han", 10, T0 - 80 * 3600_000);
    await tao("k/con-han", 10, T0 - 1000);
    await donDem(T0, true);
    expect((await demTep()).bin).toBe(1);
  });

  it("[DD-08] dọn có khoảng nghỉ 5 phút (không quét đĩa mỗi lượt gọi)", async () => {
    await tao("k/a", 10, T0 - 1000);
    expect((await donDem(T0)).conLaiByte).toBeGreaterThanOrEqual(0); // lượt đầu: quét thật
    const lan2 = await donDem(T0 + 60_000);
    expect(lan2.conLaiByte).toBe(-1); // trong 5 phút: bỏ qua
  });
});

function s3Gia(tep: { key: string; size: number }[], boDemGet: { n: number }) {
  send.mockImplementation(async (cmd: { constructor: { name: string }; input: { Key?: string; ContinuationToken?: string } }) => {
    const ten = cmd.constructor.name;
    if (ten === "ListObjectsV2Command") {
      const trang = cmd.input.ContinuationToken ? tep.slice(2) : tep.slice(0, 2);
      return { Contents: trang.map((t) => ({ Key: t.key, Size: t.size })), NextContinuationToken: cmd.input.ContinuationToken ? undefined : "p2" };
    }
    boDemGet.n++;
    const t = tep.find((x) => x.key === cmd.input.Key)!;
    const buf = Buffer.alloc(t.size, 9);
    return {
      Body: Object.assign(Readable.from([buf]), { transformToByteArray: async () => new Uint8Array(buf) }),
      ContentType: "image/png",
      ETag: '"x"',
      ContentLength: t.size,
    };
  });
}

describe("[DD] làm nóng cả gói", () => {
  it("[DD-09] tải mọi tệp (nhiều trang liệt kê), BỎ .zip gốc và tệp quá lớn; tệp > 4MB đi đường luồng", async () => {
    const dem = { n: 0 };
    const tep = [
      { key: "scorm/g1/res/a.js", size: 100 },
      { key: "scorm/g1/res/b.png", size: 200 },
      { key: "scorm/g1/res/video.mp4", size: 5 * MB }, // đường luồng
      { key: "scorm/g1/source.zip", size: 13 * MB }, // bỏ
      { key: "scorm/g1/res/khong-lo.bin", size: 130 * MB }, // bỏ (> 120MB)
    ];
    s3Gia(tep, dem);
    const kq = await lamNongGoi("scorm/g1", T0);
    expect(kq).toMatchObject({ tai: 3, boQua: 2, loi: 0 });
    expect(dem.n).toBe(3);
    expect((await docMetaDem("scorm/g1/res/video.mp4"))?.size).toBe(5 * MB);
    expect(await docMetaDem("scorm/g1/source.zip")).toBeNull();
  });

  it("[DD-09b] ngưỡng làm nóng 8MB: tệp ĐÚNG bằng ngưỡng vẫn tải, hơn 1 byte thì BỎ (video để Range lo); tệp 120MB cũ không còn được tải", async () => {
    expect(NGUONG_LAM_NONG_BYTE).toBe(8 * MB);
    const dem = { n: 0 };
    s3Gia(
      [
        { key: "scorm/gv/res/dung-nguong.bin", size: NGUONG_LAM_NONG_BYTE },
        { key: "scorm/gv/res/qua-nguong.mp4", size: NGUONG_LAM_NONG_BYTE + 1 },
        { key: "scorm/gv/res/video-30.mp4", size: 30 * MB },
        { key: "scorm/gv/res/nho.js", size: 100 },
      ],
      dem,
    );
    const kq = await lamNongGoi("scorm/gv/", T0);
    expect(kq).toMatchObject({ tai: 2, boQua: 2, loi: 0 });
    expect(dem.n, "chỉ GET hai tệp được tải").toBe(2);
    expect(await docMetaDem("scorm/gv/res/qua-nguong.mp4")).toBeNull();
    expect(await docMetaDem("scorm/gv/res/video-30.mp4")).toBeNull();
    expect((await docMetaDem("scorm/gv/res/dung-nguong.bin"))?.size).toBe(NGUONG_LAM_NONG_BYTE);
  });

  it("[DD-10] hai lượt gọi ĐỒNG THỜI cho một gói ⇒ gộp thành MỘT đợt (mỗi tệp chỉ GET một lần)", async () => {
    const dem = { n: 0 };
    s3Gia([{ key: "scorm/g2/a", size: 10 }, { key: "scorm/g2/b", size: 10 }, { key: "scorm/g2/c", size: 10 }], dem);
    const [a, b] = await Promise.all([lamNongGoi("scorm/g2/", T0), lamNongGoi("scorm/g2/", T0)]);
    expect(a).toBe(b);
    expect(dem.n).toBe(3);
  });

  it("[DD-11] vừa làm nóng xong thì NGHỈ 10 phút (tệp còn trượt không kéo cả đợt liệt kê R2 mỗi lượt); hết nghỉ thì làm lại và BỎ QUA tệp đã có", async () => {
    const dem = { n: 0 };
    s3Gia([{ key: "scorm/g3/a", size: 10 }, { key: "scorm/g3/b", size: 10 }, { key: "scorm/g3/c", size: 10 }], dem);
    await lamNongGoi("scorm/g3/", T0);
    send.mockClear();
    const sau = await lamNongGoi("scorm/g3/", T0 + 60_000);
    expect(sau.tai).toBe(0);
    expect(send).not.toHaveBeenCalled(); // không liệt kê lại
    const hetNghi = await lamNongGoi("scorm/g3/", T0 + 11 * 60_000);
    expect(hetNghi).toMatchObject({ tai: 0, daCo: 3 });
  });

  it("[DD-12] lỗi một tệp không làm hỏng cả đợt và KHÔNG bao giờ ném", async () => {
    const dem = { n: 0 };
    s3Gia([{ key: "scorm/g4/a", size: 10 }, { key: "scorm/g4/b", size: 10 }, { key: "scorm/g4/c", size: 10 }], dem);
    const goc = send.getMockImplementation()!;
    send.mockImplementation(async (cmd: { constructor: { name: string }; input: { Key?: string } }, o: unknown) => {
      if (cmd.constructor.name === "GetObjectCommand" && cmd.input.Key === "scorm/g4/b") throw new Error("R2 chậm");
      return goc(cmd as never, o as never);
    });
    const kq = await lamNongGoi("scorm/g4/", T0);
    expect(kq).toMatchObject({ tai: 2, loi: 1 });
    // liệt kê R2 hỏng cả đợt cũng không ném
    send.mockReset();
    send.mockRejectedValue(new Error("R2 sập"));
    await expect(lamNongGoi("scorm/g5/", T0)).resolves.toMatchObject({ loi: 1 });
  });
});

// ── 24/10/2026: mở fd an toàn, giới hạn TOÀN CỤC, dừng khi R2 ốm ──────────────────────────────────────────────────────────
describe("[SCD] mở luồng đĩa an toàn", () => {
  async function doc(r: Readable): Promise<number[]> {
    const manh: Buffer[] = [];
    for await (const c of r) manh.push(c as Buffer);
    return [...Buffer.concat(manh)];
  }

  it("[SCD-01] tệp không có (vừa bị dọn) ⇒ NÉM ở bước mở — route rơi về R2 trước khi gửi header, không gửi 200 rồi đứt", async () => {
    await expect(moLuongDemAnToan("scorm/g1/khong-co")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("[SCD-02] đọc đúng khoảng; kích thước lệch meta ⇒ ném (tệp bị ghi đè dở)", async () => {
    await ghiDemTuBytes("scorm/g1/v.mp4", new Uint8Array([10, 11, 12, 13, 14, 15]), META, T0);
    expect(await doc(await moLuongDemAnToan("scorm/g1/v.mp4", { start: 2, end: 4 }, 6))).toEqual([12, 13, 14]);
    expect(await doc(await moLuongDemAnToan("scorm/g1/v.mp4", undefined, 6))).toEqual([10, 11, 12, 13, 14, 15]);
    await expect(moLuongDemAnToan("scorm/g1/v.mp4", undefined, 99)).rejects.toThrow(/đổi kích thước/);
  });

  it("[SCD-03] đã mở fd thì dọn đệm xoá tên tệp GIỮA CHỪNG cũng không cắt luồng đang chạy", async () => {
    const lon = new Uint8Array(300_000).map((_, i) => i % 251);
    await ghiDemTuBytes("scorm/g1/lon.bin", lon, META, T0);
    const luong = await moLuongDemAnToan("scorm/g1/lon.bin", undefined, lon.length);
    // mtime của .bin là đồng hồ THẬT của đĩa ⇒ để mục "quá hạn" thì phải đẩy `now` của donDem tới tương lai thật
    expect((await donDem(Date.now() + 200 * 3600_000, true)).xoa).toBe(1);
    expect(await docMetaDem("scorm/g1/lon.bin", T0)).toBeNull();
    expect((await doc(luong)).length).toBe(300_000);
  });
});

/** S3 giả có độ trễ + đếm số GetObject đồng thời. */
function s3Cham(soTep: number, o: { goi: string; tre?: number; hong?: boolean; sizeKhai?: number }, dem: { dang: number; max: number; get: number }) {
  const tep = Array.from({ length: soTep }, (_, i) => ({ key: `${o.goi}f${i}.js`, size: o.sizeKhai ?? 50 }));
  return async (cmd: { constructor: { name: string }; input: { Key?: string; Prefix?: string } }) => {
    if (cmd.constructor.name === "ListObjectsV2Command") {
      const ds = tep.filter((t) => t.key.startsWith(cmd.input.Prefix ?? ""));
      return { Contents: ds.map((t) => ({ Key: t.key, Size: t.size })) };
    }
    dem.get++;
    dem.dang++;
    dem.max = Math.max(dem.max, dem.dang);
    try {
      await new Promise((x) => setTimeout(x, o.tre ?? 10));
      if (o.hong) throw new Error("R2 ốm");
      const buf = Buffer.alloc(50, 3);
      return { Body: Object.assign(Readable.from([buf]), { transformToByteArray: async () => new Uint8Array(buf) }), ContentType: "text/javascript", ETag: '"x"' };
    } finally {
      dem.dang--;
    }
  };
}

describe("[SCD] làm nóng: giới hạn TOÀN CỤC + dừng khi R2 ốm", () => {
  it("[SCD-04] hai gói làm nóng cùng lúc vẫn chỉ ≤ 12 GetObject đồng thời TOÀN CỤC (không phải 12 mỗi gói); gói thứ ba bị từ chối chứ không xếp hàng", async () => {
    const dem = { dang: 0, max: 0, get: 0 };
    const a = s3Cham(40, { goi: "scorm/ga/" }, dem);
    const b = s3Cham(40, { goi: "scorm/gb/" }, dem);
    const c = s3Cham(40, { goi: "scorm/gc/" }, dem);
    send.mockImplementation((cmd: never) => {
      const k = (cmd as { input: { Key?: string; Prefix?: string } }).input;
      const ten = k.Key ?? k.Prefix ?? "";
      return (ten.startsWith("scorm/ga/") ? a : ten.startsWith("scorm/gb/") ? b : c)(cmd);
    });
    const [ka, kb, kc] = await Promise.all([lamNongGoi("scorm/ga/", T0), lamNongGoi("scorm/gb/", T0), lamNongGoi("scorm/gc/", T0)]);
    expect(ka.tai).toBe(40);
    expect(kb.tai).toBe(40);
    expect(kc).toMatchObject({ tai: 0, dung: "day-goi" });
    expect(dem.max).toBeLessThanOrEqual(12);
    expect(dem.max).toBeGreaterThan(1); // và vẫn song song thật (không tuần tự hoá)
    // từ chối KHÔNG đánh dấu "vừa làm xong": hết chỗ là làm được ngay
    const sau = await lamNongGoi("scorm/gc/", T0 + 1000);
    expect(sau.tai).toBe(40);
  });

  it("[SCD-05] R2 lỗi liên tiếp ⇒ DỪNG đợt (không đập tiếp 60 tệp) và gói khác tạm NGHỈ, không gọi R2 nữa", async () => {
    const dem = { dang: 0, max: 0, get: 0 };
    const hong = s3Cham(60, { goi: "scorm/gh/", hong: true, tre: 5 }, dem);
    send.mockImplementation((cmd: never) => hong(cmd));
    const kq = await lamNongGoi("scorm/gh/", T0);
    expect(kq.dung).toBe("loi-lien-tiep");
    expect(kq.loi).toBeGreaterThanOrEqual(5);
    expect(kq.loi).toBeLessThan(60);
    expect(dem.get).toBeLessThan(60);
    send.mockClear();
    const khac = await lamNongGoi("scorm/gk/", Date.now() + 1000);
    expect(khac).toMatchObject({ tai: 0, dung: "dang-nghi" });
    expect(send).not.toHaveBeenCalled();
  });

  it("[SCD-06] `ghiNhanLoiR2` (route gặp 502/504) ⇒ nghỉ 2 phút; hết nghỉ thì làm bình thường", async () => {
    s3Gia([{ key: "scorm/gn/a", size: 10 }], { n: 0 });
    ghiNhanLoiR2(T0);
    expect(await lamNongGoi("scorm/gn/", T0 + 60_000)).toMatchObject({ tai: 0, dung: "dang-nghi" });
    expect(send).not.toHaveBeenCalled();
    expect((await lamNongGoi("scorm/gn/", T0 + 3 * 60_000)).tai).toBe(1);
  });

  it("[SCD-07] thân R2 đứt GIỮA CHỪNG ⇒ huỷ request (nhả socket), tính là lỗi, KHÔNG để lại mục đệm dở", async () => {
    const ds: AbortSignal[] = [];
    send.mockImplementation(async (cmd: { constructor: { name: string }; input: { Key?: string } }, o: { abortSignal: AbortSignal }) => {
      if (cmd.constructor.name === "ListObjectsV2Command") return { Contents: [{ Key: "scorm/gd/lon.bin", Size: 6 * MB }] };
      ds.push(o.abortSignal);
      const r = new Readable({
        read() {
          this.push(Buffer.alloc(64 * 1024, 1));
          if (++n > 3) this.destroy(new Error("ECONNRESET"));
        },
      });
      let n = 0;
      return { Body: r, ContentType: "video/mp4", ETag: '"v"' };
    });
    const kq = await lamNongGoi("scorm/gd/", T0);
    expect(kq).toMatchObject({ tai: 0, loi: 1 });
    expect(ds[0]?.aborted).toBe(true);
    expect(await docMetaDem("scorm/gd/lon.bin")).toBeNull();
    expect((await demTep()).bin).toBe(0);
  });

  it("[SCD-09] thân R2 (tệp lớn) ĐỨNG IM giữa chừng ⇒ canh treo cắt sau 30s, khe tải toàn cục được trả, đợt làm nóng KẾT THÚC (không treo vĩnh viễn)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let than: Readable | undefined;
      send.mockImplementation(async (cmd: { constructor: { name: string } }) => {
        if (cmd.constructor.name === "ListObjectsV2Command") return { Contents: [{ Key: "scorm/gi/lon.bin", Size: 6 * MB }] };
        let da = false;
        than = new Readable({ read() { if (!da) { da = true; this.push(Buffer.alloc(1024, 1)); } } }); // một mảnh rồi im lặng
        return { Body: than, ContentType: "video/mp4", ETag: '"v"' };
      });
      const xong = lamNongGoi("scorm/gi/", T0);
      // Chờ tới khi canh treo thật sự ĐÃ đặt hẹn giờ (nó đặt sau khi mkdir xong — I/O thật, nhanh chậm tuỳ máy).
      const han = Date.now() + 5000;
      while ((!than || vi.getTimerCount() === 0) && Date.now() < han) await new Promise((x) => setImmediate(x));
      expect(than).toBeDefined();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(31_000);
      const kq = await xong;
      expect(kq).toMatchObject({ tai: 0, loi: 1 });
      expect(than?.destroyed).toBe(true);
      expect(await docMetaDem("scorm/gi/lon.bin")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("[SCD-08] tệp nhỏ mà R2 khai Size nhỏ nhưng thân thật khổng lồ ⇒ chặn ở trần byte (không phình RAM), tính là lỗi, thân bị huỷ", async () => {
    let than: Readable | undefined;
    send.mockImplementation(async (cmd: { constructor: { name: string } }) => {
      if (cmd.constructor.name === "ListObjectsV2Command") return { Contents: [{ Key: "scorm/ge/nho.js", Size: 100 }] };
      than = Readable.from((function* () { for (let i = 0; i < 400; i++) yield Buffer.alloc(64 * 1024, 1); })(), { objectMode: false });
      return { Body: than, ContentType: "text/javascript", ETag: '"n"' };
    });
    const kq = await lamNongGoi("scorm/ge/", T0);
    expect(kq).toMatchObject({ tai: 0, loi: 1 });
    expect(than?.destroyed).toBe(true);
    expect(await docMetaDem("scorm/ge/nho.js")).toBeNull();
  });
});
