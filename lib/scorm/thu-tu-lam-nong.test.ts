// @vitest-environment node
// Thứ tự + độ song song của LÀM NÓNG gói (25/10/2026, vòng 2). Cùng S3 giả với qa-lam-nong.test.ts (lamNongGoi THẬT).
//
// Vì sao: trước vòng 2 hàng đợi làm nóng sắp theo CỠ tăng dần ⇒ với gói thật (đo ListObjectsV2 PROD: 154 png p50 577 B + 26 xsd + 12 js, một js 1,7 MB) các tệp mã trình duyệt cần
// ĐẦU TIÊN nằm sau ~150 ảnh/schema bé. Ca [TTL-04] dựng đúng hình dạng đó và đo thứ tự GetObject thật.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({ send: (cmd: unknown, opts?: { abortSignal?: AbortSignal }) => s3.send(cmd, opts) }),
  getR2Bucket: () => "bucket-test",
}));

import { _datLaiTrangThai, lamNongGoi, nhomLamNong, soSanhLamNong, songSongLamNong } from "./dem-dia";
import { choDen, taoS3Gia } from "./qa-s3-gia";
// Các ca `lamNongGoi thật` ghi hàng chục tệp xuống đĩa thật: chạy riêng nhanh, nhưng trong lượt toàn repo (nhiều worker cùng đụng đĩa) TTL-05/TTL-06 từng quá hạn 5 s mặc định
// (25/10/2026). Cùng cách xử lý với qa-lam-nong.test.ts: nới hạn chờ cho CẢ TỆP, không đổi điều khẳng định nào.
vi.setConfig({ testTimeout: 30_000 });

const s3 = taoS3Gia();
const PREFIX = "scorm/cmgoi0000000000000000thutu/";

let thuMuc = "";
beforeEach(async () => {
  s3.datLai();
  thuMuc = await mkdtemp(join(tmpdir(), "scorm-thu-tu-"));
  process.env.SCORM_CACHE_DIR = thuMuc;
  delete process.env.SCORM_CACHE_OFF;
  delete process.env.SCORM_LAM_NONG_THEO_CO;
  delete process.env.SCORM_LAM_NONG_SONG_SONG;
  _datLaiTrangThai();
});
afterEach(async () => {
  await choDen(() => s3.tk.openStreams === 0, 300);
  await rm(thuMuc, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  delete process.env.SCORM_CACHE_DIR;
  delete process.env.SCORM_LAM_NONG_THEO_CO;
  delete process.env.SCORM_LAM_NONG_SONG_SONG;
});

describe("[TTL] nhóm + so sánh", () => {
  it("[TTL-01] nhomLamNong: mã chạy được = 0 · phông/con trỏ/icon = 1 · còn lại = 2 · schema/manifest SCORM = 3 (không phân biệt hoa thường, đường dẫn sâu)", () => {
    const k = (rel: string) => `scorm/x/${rel}`;
    for (const r of ["res/index.html", "res/lib/Player.JS", "res/a.css", "res/data.json", "res/x.mjs", "res/y.htm", "res/z.xml"]) expect(nhomLamNong(k(r)), r).toBe(0);
    for (const r of ["res/f.woff", "res/f.woff2", "res/f.TTF", "res/c.cur", "res/favicon.ico"]) expect(nhomLamNong(k(r)), r).toBe(1);
    for (const r of ["res/a.png", "res/b.jpg", "res/c.mp4", "res/d.mp3", "res/khong-duoi"]) expect(nhomLamNong(k(r)), r).toBe(2);
    for (const r of ["adlcp_v1p3.xsd", "common/vocabTypes.XSD", "XMLSchema.dtd", "imsmanifest.xml", "res/imsmanifest.xml"]) expect(nhomLamNong(k(r)), r).toBe(3);
  });

  it("[TTL-02] soSanhLamNong: nhóm trước, trong nhóm tệp nhỏ trước — js 1,7 MB đứng TRƯỚC ảnh 100 B (cỡ tăng dần thuần thì ngược lại)", () => {
    const ds = [
      { key: "p/a.png", size: 100 },
      { key: "p/runtime.js", size: 1_729_929 },
      { key: "p/s.xsd", size: 50 },
      { key: "p/app.js", size: 9000 },
      { key: "p/f.woff", size: 79_000 },
      { key: "p/x.css", size: 800 },
    ];
    expect([...ds].sort(soSanhLamNong).map((x) => x.key.slice(2))).toEqual(["x.css", "app.js", "runtime.js", "f.woff", "a.png", "s.xsd"]);
    process.env.SCORM_LAM_NONG_THEO_CO = "1";
    expect([...ds].sort(soSanhLamNong).map((x) => x.key.slice(2))).toEqual(["s.xsd", "a.png", "x.css", "app.js", "f.woff", "runtime.js"]);
  });

  it("[TTL-03] songSongLamNong: mặc định 12; env hợp lệ được tôn trọng; dưới 4 hoặc rác ⇒ mặc định; trên 32 ⇒ kẹp 32 (pool R2 50 socket dùng chung với người dùng)", () => {
    expect(songSongLamNong()).toBe(12);
    for (const [env, kq] of [["24", 24], ["4", 4], ["100", 32], ["2", 12], ["0", 12], ["abc", 12], ["", 12], ["16.9", 16]] as const) {
      process.env.SCORM_LAM_NONG_SONG_SONG = env;
      expect(songSongLamNong(), `env=${JSON.stringify(env)}`).toBe(kq);
    }
  });
});

describe("[TTL] lamNongGoi thật", () => {
  /** Hình dạng gói thật thu nhỏ: nhiều ảnh bé + schema, vài tệp mã (một cái lớn), phông, manifest. */
  function dungGoiThu() {
    const them = (rel: string, size: number) => s3.them(`${PREFIX}${rel}`, new Uint8Array(size).fill(7), { etag: `"${rel}"` });
    for (let i = 0; i < 40; i++) them(`res/data/img${i}.png`, 100 + i);
    for (let i = 0; i < 6; i++) them(`schema/s${i}.xsd`, 50 + i);
    for (let i = 0; i < 4; i++) them(`res/lib/m${i}.js`, 5000 + i * 100);
    them("res/lib/runtime.js", 1_500_000);
    them("res/theme.css", 700);
    them("res/index.html", 18_000);
    them("res/f.woff", 79_000);
    them("imsmanifest.xml", 9000);
    return { soMa: 7 }; // 4 js + runtime + css + html
  }

  it("[TTL-04] thứ tự GetObject THẬT: mọi tệp mã được lấy trong (số tệp mã + song song − 1) lượt đầu, trước phần lớn ảnh; schema/manifest sau cùng", async () => {
    process.env.SCORM_LAM_NONG_SONG_SONG = "4";
    const { soMa } = dungGoiThu();
    await lamNongGoi(PREFIX);
    const gets = s3.tk.gets.map((g) => g.key.slice(PREFIX.length));
    const vt = (rel: string) => gets.indexOf(rel);
    const viTriMa = ["res/index.html", "res/theme.css", "res/lib/runtime.js", "res/lib/m0.js", "res/lib/m1.js", "res/lib/m2.js", "res/lib/m3.js"].map(vt);
    expect(viTriMa.every((v) => v >= 0), "đủ tệp mã").toBe(true);
    expect(Math.max(...viTriMa), `tệp mã phải nằm trong ${soMa + 3} lượt đầu`).toBeLessThan(soMa + 4);
    expect(vt("res/f.woff")).toBeLessThan(vt("res/data/img20.png"));
    const viTriCuoi = ["schema/s0.xsd", "imsmanifest.xml"].map(vt);
    expect(Math.min(...viTriCuoi), "schema/manifest sau mọi ảnh trừ tối đa vài cái đang bay song song").toBeGreaterThanOrEqual(gets.length - 6 - 3);
  });

  it("[TTL-05] công tắc lùi SCORM_LAM_NONG_THEO_CO=1 ⇒ quay về cỡ tăng dần (ảnh bé và schema đi trước js 1,5 MB)", async () => {
    process.env.SCORM_LAM_NONG_SONG_SONG = "4";
    process.env.SCORM_LAM_NONG_THEO_CO = "1";
    dungGoiThu();
    await lamNongGoi(PREFIX);
    const gets = s3.tk.gets.map((g) => g.key.slice(PREFIX.length));
    expect(gets.indexOf("res/lib/runtime.js")).toBeGreaterThan(gets.indexOf("res/data/img39.png") - 4);
    expect(gets.indexOf("res/data/img0.png")).toBeLessThan(gets.indexOf("res/lib/m0.js"));
  });

  it("[TTL-06] độ song song: đỉnh GetObject đồng thời ≤ giá trị cấu hình (4 → ≤ 4; 16 → vượt 12 nhưng ≤ 16); cùng một tập tệp, không sót không thừa", async () => {
    s3.datDoTre(null, 8);
    dungGoiThu();
    const tong = 40 + 6 + 4 + 1 + 1 + 1 + 1 + 1;
    process.env.SCORM_LAM_NONG_SONG_SONG = "4";
    const a = await lamNongGoi(PREFIX);
    expect(a.tai).toBe(tong);
    expect(s3.tk.inflightPeak).toBeLessThanOrEqual(4);
    // lượt hai: thư mục mới + trạng thái mới, cấu hình 16
    s3.datLai();
    await rm(thuMuc, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    _datLaiTrangThai();
    s3.datDoTre(null, 8);
    dungGoiThu();
    process.env.SCORM_LAM_NONG_SONG_SONG = "16";
    const b = await lamNongGoi(PREFIX);
    expect(b.tai).toBe(tong);
    expect(s3.tk.inflightPeak).toBeGreaterThan(12);
    expect(s3.tk.inflightPeak).toBeLessThanOrEqual(16);
  });
});
