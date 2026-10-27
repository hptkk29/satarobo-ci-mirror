// @vitest-environment node
// QA ĐỘC LẬP (24/10/2026) — LÀM NÓNG GÓI (lamNongGoi, mã THẬT) trên S3 giả có luồng Readable thật. Bằng chứng loại "tích hợp có S3 giả".
//
// Làm nóng chạy NỀN sau khi mở bài (`after()`), không ai nhìn thấy nó hỏng — nên mọi lỗi của nó là lỗi CÂM: tranh pool 50 socket R2
// với request thật của giáo viên, ăn RAM, đầy đĩa, hay treo vĩnh viễn một khe tải. Các ca dưới đo đúng những điều đó.
//
// ⚠️ Ngưỡng `≤ 25 GetObject đồng thời` (nửa pool 50 socket mặc định của SDK) là NGƯỠNG DO QA ĐỀ XUẤT, không có trong hợp đồng của
// đợt này — xem openIssues. Các ngưỡng khác ghi ngay tại ca.
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Các ca trong tệp này ghi/đọc HÀNG CHỤC tệp nhỏ xuống đĩa thật. Chạy riêng ~60 ms/ca, nhưng trong lượt toàn repo (≈19 worker cùng đụng đĩa, Windows có quét thời gian thực)
// từng thấy quá hạn 5 s mặc định ở SCD-04/QAL-01/QAL-02 (24/10/2026). Nới hạn chờ cho CẢ TỆP thay vì từng ca; nó chỉ đổi ngưỡng treo, không đổi điều khẳng định nào.
vi.setConfig({ testTimeout: 30_000 });

vi.mock("server-only", () => ({}));
vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({ send: (cmd: unknown, opts?: { abortSignal?: AbortSignal }) => s3.send(cmd, opts) }),
  getR2Bucket: () => "bucket-test",
}));

import { _datLaiTrangThai, docMetaDem, donDem, lamNongGoi } from "./dem-dia";
import { choDen, taoS3Gia } from "./qa-s3-gia";

const s3 = taoS3Gia();
const MB = 1024 * 1024;
const NGUONG_DONG_THOI = 25; // QA đề xuất: nửa pool 50 socket

let thuMuc = "";
beforeEach(async () => {
  s3.datLai();
  thuMuc = await mkdtemp(join(tmpdir(), "scorm-qa-nong-"));
  process.env.SCORM_CACHE_DIR = thuMuc;
  delete process.env.SCORM_CACHE_OFF;
  delete process.env.SCORM_CACHE_MAX_MB;
  _datLaiTrangThai();
});
afterEach(async () => {
  vi.useRealTimers();
  await choDen(() => s3.tk.openStreams === 0, 300);
  await rm(thuMuc, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  delete process.env.SCORM_CACHE_DIR;
  delete process.env.SCORM_CACHE_MAX_MB;
});

const pref = (i: number) => `scorm/cmgoi${String(i).padStart(22, "0")}/`;
function themGoi(i: number, soTep: number, kichThuoc = 2000) {
  for (let n = 0; n < soTep; n++) s3.them(`${pref(i)}res/data/f${n}.png`, new Uint8Array(kichThuoc).fill(n % 256), { etag: `"f${n}"` });
  s3.them(`${pref(i)}imsmanifest.xml`, new Uint8Array(300), { etag: '"m"' });
}
async function dungLuongDia(): Promise<number> {
  let tong = 0;
  for (const con of await readdir(thuMuc).catch(() => [])) {
    for (const t of await readdir(join(thuMuc, con)).catch(() => [])) {
      if (t.endsWith(".bin")) tong += (await stat(join(thuMuc, con, t))).size;
    }
  }
  return tong;
}

describe("[QAL] làm nóng gói — tải, giới hạn tài nguyên, chịu lỗi", () => {
  it("[QAL-01] tải đủ mọi tệp của gói xuống đĩa (kể cả khi R2 phân trang liệt kê), trừ `.zip`", async () => {
    themGoi(1, 40);
    s3.them(`${pref(1)}source.zip`, new Uint8Array(5000));
    s3.them(`${pref(1)}_src/package.zip`, new Uint8Array(5000));
    s3.datCoTrang(7); // 41 tệp .png/.xml + 2 zip = 43 ⇒ 7 trang
    const kq = await lamNongGoi(pref(1));
    expect(kq.tai).toBe(41);
    expect(kq.boQua).toBe(2);
    expect(s3.tk.lists.length).toBeGreaterThanOrEqual(6);
    for (let n = 0; n < 40; n++) expect(await docMetaDem(`${pref(1)}res/data/f${n}.png`), `f${n}`).not.toBeNull();
    expect(s3.tk.gets.map((g) => g.key).filter((k) => k.endsWith(".zip")), "không được tải .zip").toEqual([]);
    expect(await docMetaDem(`${pref(1)}source.zip`)).toBeNull();
  });

  it("[QAL-02] giới hạn ĐỒNG THỜI toàn cục: 6 gói mở cùng lúc, đỉnh GetObject đồng thời ≤ 25 (ngưỡng do QA đề xuất, nửa pool socket)", async () => {
    s3.datDoTre(null, 5);
    for (let i = 1; i <= 6; i++) themGoi(i, 60);
    const kq = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => lamNongGoi(pref(i))));
    console.info(`[QAL] đỉnh GetObject đồng thời khi 6 gói làm nóng cùng lúc = ${s3.tk.inflightPeak}; kết quả = ${JSON.stringify(kq.map((k) => [k.tai, k.dung ?? ""]))}`);
    expect(s3.tk.inflightPeak).toBeLessThanOrEqual(NGUONG_DONG_THOI);
  });

  it("[QAL-03] 40 gói cùng bấm mở (giờ vào lớp, nhiều giáo viên) vẫn giữ đỉnh đồng thời ≤ 25", async () => {
    s3.datDoTre(null, 2);
    for (let i = 1; i <= 40; i++) themGoi(i, 20);
    await Promise.all(Array.from({ length: 40 }, (_, i) => lamNongGoi(pref(i + 1))));
    expect(s3.tk.inflightPeak).toBeLessThanOrEqual(NGUONG_DONG_THOI);
  });

  it("[QAL-04] tệp LỚN (7MB — sát ngưỡng làm nóng 8MB) không bao giờ bị nạp nguyên vào RAM (chỉ tệp nhỏ ≤ 4MB được phép)", { timeout: 30_000 }, async () => {
    // Tệp > 8MB (NGUONG_LAM_NONG_BYTE) nay bị làm nóng BỎ QUA hẳn (video đã phục vụ bằng Range) — ca này thử đường luồng nên dùng 7MB.
    s3.themLon(`${pref(1)}res/data/video1.mp4`, 7 * MB, { contentType: "video/mp4", etag: '"v"' });
    s3.them(`${pref(1)}res/index.html`, new Uint8Array(3000), { etag: '"i"' });
    const kq = await lamNongGoi(pref(1));
    expect(kq.tai).toBe(2);
    expect(s3.tk.bulkMax, "thân lớn nhất từng bị nạp RAM").toBeLessThanOrEqual(4 * MB + 1);
    expect(await docMetaDem(`${pref(1)}res/data/video1.mp4`)).toMatchObject({ size: 7 * MB });
    expect(await choDen(() => s3.tk.openStreams === 0, 5000)).toBe(true);
  });

  it("[QAL-05] hai lượt gọi đồng thời cho CÙNG gói gộp làm một (một đợt liệt kê); lượt thứ hai trong thời gian nghỉ không làm gì", async () => {
    themGoi(1, 10);
    const [a, b] = await Promise.all([lamNongGoi(pref(1)), lamNongGoi(pref(1))]);
    expect(a).toEqual(b); // cùng một đợt ⇒ cùng kết quả
    expect(s3.tk.lists.length).toBe(1);
    const lanSau = await lamNongGoi(pref(1));
    expect(lanSau.tai).toBe(0);
    expect(s3.tk.lists.length, "đang nghỉ giữa hai lần ⇒ không liệt kê lại").toBe(1);
  });

  it("[QAL-06] tệp đã nằm trên đĩa (đúng cỡ) KHÔNG tải lại", async () => {
    themGoi(1, 10);
    await lamNongGoi(pref(1));
    s3.datLaiThongKe();
    _datLaiTrangThai(); // bỏ thời gian nghỉ để chạy lượt hai
    const kq = await lamNongGoi(pref(1));
    expect(kq.daCo).toBe(11);
    expect(kq.tai).toBe(0);
    expect(s3.tk.gets).toEqual([]);
  });

  it("[QAL-07] R2 lỗi 5xx trên mọi tệp (200 tệp): dừng sớm, KHÔNG đập thêm vào R2 đang ốm (≤ 50 lần GetObject; ngưỡng do QA đề xuất)", async () => {
    themGoi(1, 200);
    const e500 = Object.assign(new Error("InternalError"), { name: "InternalError", $metadata: { httpStatusCode: 500 } });
    for (let n = 0; n < 200; n++) s3.datLoi(`${pref(1)}res/data/f${n}.png`, e500);
    s3.datLoi(`${pref(1)}imsmanifest.xml`, e500); // R2 'ốm' = MỌI tệp lỗi (kể cả manifest)
    const kq = await lamNongGoi(pref(1));
    console.info(`[QAL] R2 lỗi hàng loạt: số GetObject đã gửi = ${s3.tk.gets.length}, kết quả = ${JSON.stringify(kq)}`);
    expect(kq.tai).toBe(0);
    expect(s3.tk.gets.length).toBeLessThanOrEqual(50);
    expect(s3.tk.openStreams).toBe(0);
  });

  it("[QAL-08] không bao giờ ném: R2 sập hoàn toàn từ lúc liệt kê ⇒ trả kết quả có `loi`, không reject", async () => {
    themGoi(1, 5);
    const vanLoi = vi.spyOn(s3, "send").mockRejectedValue(new Error("ECONNREFUSED"));
    const kq = await lamNongGoi(pref(1));
    expect(kq.tai).toBe(0);
    expect(kq.loi).toBeGreaterThanOrEqual(1);
    vanLoi.mockRestore();
  });

  it("[QAL-09] thân R2 TREO giữa chừng ⇒ khe tải được trả sau hạn treo, không giữ vĩnh viễn; không để lại mục đệm dở dang", { timeout: 20_000 }, async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    s3.themLon(`${pref(1)}res/data/video1.mp4`, 7 * MB, { etag: '"v"' }); // ≤ 8MB: tệp > 8MB không còn được làm nóng
    s3.datHong(`${pref(1)}res/data/video1.mp4`, { stallAfter: 1 * MB });
    s3.them(`${pref(1)}res/index.html`, new Uint8Array(100), { etag: '"i"' });
    const xong = lamNongGoi(pref(1));
    // Hàng canh treo được ĐẶT sau khi mở tệp (IO thật), nên không thể một phát `advanceTimersByTimeAsync(120_000)`: phải vừa cho đồng hồ chạy
    // vừa nhường vòng lặp sự kiện thật để IO đĩa tiến — nếu không canh treo chưa kịp đặt thì kiểm thử tự treo (đã dính ở lần viết đầu).
    let ketThuc = false;
    void xong.finally(() => (ketThuc = true));
    const hanThat = performance.now() + 10_000; // hạn bằng đồng hồ THẬT (performance không bị giả): máy tải nặng thì IO đĩa chậm, đừng đoán theo số vòng
    while (!ketThuc && performance.now() < hanThat) {
      await vi.advanceTimersByTimeAsync(5000);
      await new Promise((ok) => setImmediate(ok));
    }
    expect(ketThuc, "làm nóng phải kết thúc sau hạn treo, không treo vĩnh viễn").toBe(true);
    const kq = await xong;
    expect(kq.loi).toBeGreaterThanOrEqual(1);
    expect(kq.tai).toBeGreaterThanOrEqual(1); // tệp nhỏ vẫn tải được
    vi.useRealTimers();
    expect(await docMetaDem(`${pref(1)}res/data/video1.mp4`), "tệp treo không được công bố như đã có").toBeNull();
    expect(await choDen(() => s3.tk.openStreams === 0, 5000), "luồng treo phải bị huỷ").toBe(true);
  });

  it("[QAL-10] R2 đứt kết nối giữa thân ⇒ không công bố mục đệm hỏng (docMetaDem = null), luồng đóng sạch", async () => {
    s3.themLon(`${pref(1)}res/data/video1.mp4`, 7 * MB, { etag: '"v"' }); // ≤ 8MB: tệp > 8MB không còn được làm nóng
    s3.datHong(`${pref(1)}res/data/video1.mp4`, { failAfter: 2 * MB });
    const kq = await lamNongGoi(pref(1));
    expect(kq.loi).toBeGreaterThanOrEqual(1);
    expect(await docMetaDem(`${pref(1)}res/data/video1.mp4`)).toBeNull();
    expect(await choDen(() => s3.tk.openStreams === 0, 1000)).toBe(true);
  });

  it("[QAL-11] trần dung lượng đĩa là trần MỀM: dọn ép buộc sau làm nóng đưa tổng .bin về ≤ trần; vượt tạm thời bị chặn trong ~1 gói", async () => {
    process.env.SCORM_CACHE_MAX_MB = "1";
    for (let i = 1; i <= 3; i++) themGoi(i, 6, 300 * 1024); // 3 × 6 × 300KB ≈ 5.4MB ≫ 1MB
    await Promise.all([1, 2, 3].map((i) => lamNongGoi(pref(i))));
    const truocDon = await dungLuongDia();
    console.info(`[QAL] đĩa sau làm nóng với trần 1MB = ${(truocDon / MB).toFixed(2)}MB (trước dọn ép buộc)`);
    // Đợt dọn cuối của làm nóng bị khống chế tần suất (5 phút/lần) nên có thể chạy khi các gói khác còn đang ghi ⇒ vượt tạm thời.
    expect(truocDon, "vượt tạm thời phải nhỏ hơn một gói làm nóng").toBeLessThanOrEqual(1 * MB + 6 * 300 * 1024);
    await donDem(Date.now(), true);
    expect(await dungLuongDia()).toBeLessThanOrEqual(1 * MB);
  });

  it("[QAL-12] đệm tắt (SCORM_CACHE_OFF=1) ⇒ làm nóng KHÔNG chạm R2 (công tắc lùi hoạt động)", async () => {
    process.env.SCORM_CACHE_OFF = "1";
    themGoi(1, 10);
    const kq = await lamNongGoi(pref(1));
    expect(kq.tai).toBe(0);
    expect(s3.tk.lists.length + s3.tk.gets.length).toBe(0);
  });
});
