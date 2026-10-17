// @vitest-environment node
// Đệm đĩa asset SCORM: ghi/đọc, hạn dùng, dọn theo trần, làm nóng cả gói (gộp lượt gọi, nghỉ giữa hai lần). R2 giả lập.
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const send = vi.fn();
vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({ send: (c: unknown, o: unknown) => send(c, o) }),
  getR2Bucket: () => "bucket-test",
}));

import {
  _datLaiTrangThai,
  demDangBat,
  docMetaDem,
  docToanBoDem,
  donDem,
  ghiDemTuBytes,
  lamNongGoi,
  moLuongDem,
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
