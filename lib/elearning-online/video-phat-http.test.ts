import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
const RL = vi.hoisted(() => ({ ok: true, resetAt: 0 }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ success: RL.ok, remaining: 0, resetAt: RL.resetAt })) }));
const VP = vi.hoisted(() => ({ kiem: vi.fn(), capCk: vi.fn() }));
vi.mock("./video-phat", async (goc) => {
  const that = await goc<typeof import("./video-phat")>();
  return { ...that, kiemVePhat: VP.kiem, capVePhatHocThu: VP.capCk };
});

import { xuLyCapVeHocThu, xuLyPhat } from "./video-phat-http";
/** Vùng khoá của Core E (`online/video/`) — KHÔNG trùng đường phát `/api/public/elearning-online/video/phat` (trước dấu `online` có dấu `-`). */
const KHOA_VUNG_E = /(^|[^-])online\/video\//;

/**
 * [VH] Lớp HTTP của phát video (V8.44) — KHÔNG DB, KHÔNG R2 thật: `kiemVePhat` được giả lập (quyền/vé có ca DB riêng ở `tests/elearning/onl-video-phat-db.test.ts`),
 * máy khách R2 là đối tượng giả ghi lại từng lệnh. Chứng minh: thứ tự cổng (R2 không bị chạm khi vé/quyền sai), Range 200/206/416, HEAD, truyền DÒNG, header an toàn, lỗi R2.
 */
const NOI_DUNG = Buffer.from("0123456789"); // 10 byte
const KHOA = "online/video/khoa-1/bai-1.mp4";
const BUCKET = "bucket-da-co-test";

type Lenh = { loai: string; input: Record<string, unknown> };
function s3Gia(opts: { size?: number; headLoi?: unknown; getLoi?: unknown; contentTypeR2?: string } = {}) {
  const lenh: Lenh[] = [];
  const size = opts.size ?? NOI_DUNG.length;
  return {
    lenh,
    chuaChamR2: () => lenh.length === 0,
    send: vi.fn(async (c: unknown) => {
      if (c instanceof HeadObjectCommand) {
        lenh.push({ loai: "HEAD", input: c.input as unknown as Record<string, unknown> });
        if (opts.headLoi) throw opts.headLoi;
        return { ContentLength: size, ContentType: opts.contentTypeR2 ?? "text/html" };
      }
      if (c instanceof GetObjectCommand) {
        lenh.push({ loai: "GET", input: c.input as unknown as Record<string, unknown> });
        if (opts.getLoi) throw opts.getLoi;
        const r = /^bytes=(\d+)-(\d+)$/.exec(String(c.input.Range ?? ""));
        const phan = r ? NOI_DUNG.subarray(Number(r[1]), Number(r[2]) + 1) : NOI_DUNG;
        return {
          ContentType: opts.contentTypeR2 ?? "text/html",
          Body: {
            transformToWebStream: () => new ReadableStream({ start(k) { k.enqueue(new Uint8Array(phan)); k.close(); } }),
            transformToByteArray: () => { throw new Error("KHÔNG được nạp cả tệp vào RAM"); },
          },
        };
      }
      throw new Error("lệnh lạ");
    }),
  };
}
const yeuCau = (o: { range?: string; method?: string; ve?: string | null } = {}) => {
  const u = new URL("http://localhost/api/public/elearning-online/video/phat");
  if (o.ve !== null) u.searchParams.set("ve", o.ve ?? "ve-gia");
  return new Request(u, { method: o.method ?? "GET", headers: o.range ? { range: o.range } : {} });
};
const doc = async (r: Response) => ({ status: r.status, headers: r.headers, text: await r.text() });

beforeEach(() => {
  process.env.ELEARNING_ONLINE_ENABLED = "true";
  process.env.R2_ONLINE_VIDEO_BUCKET_NAME = BUCKET;
  delete process.env.R2_BUCKET_NAME;
  delete process.env.R2_CHAT_BUCKET_NAME;
  RL.ok = true;
  VP.kiem.mockReset().mockResolvedValue({ ok: true, khoa: KHOA, contentType: "video/mp4", loai: "TRA_PHI" });
  VP.capCk.mockReset();
});
afterEach(() => {
  delete process.env.ELEARNING_ONLINE_ENABLED;
  delete process.env.R2_ONLINE_VIDEO_BUCKET_NAME;
});

describe("[VH] xuLyPhat — cổng trước R2", () => {
  it("[VH-01] cờ tắt ⇒ 404 trống, không hỏi vé, không chạm R2", async () => {
    delete process.env.ELEARNING_ONLINE_ENABLED;
    const s3 = s3Gia();
    const r = await xuLyPhat(yeuCau(), { s3 });
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
    expect(VP.kiem).not.toHaveBeenCalled();
    expect(s3.chuaChamR2()).toBe(true);
  });

  it("[VH-02] phương thức lạ ⇒ 405; thiếu vé / vé quá dài ⇒ 400 — chưa hỏi vé, chưa chạm R2", async () => {
    const s3 = s3Gia();
    expect((await xuLyPhat(yeuCau({ method: "POST" }), { s3 })).status).toBe(405);
    expect((await xuLyPhat(yeuCau({ method: "DELETE" }), { s3 })).status).toBe(405);
    const thieu = await doc(await xuLyPhat(yeuCau({ ve: null }), { s3 }));
    expect(thieu.status).toBe(400);
    expect(JSON.parse(thieu.text)).toMatchObject({ ok: false, error: { code: "THAM_SO_KHONG_HOP_LE" } });
    expect((await xuLyPhat(yeuCau({ ve: "x".repeat(1201) }), { s3 })).status).toBe(400);
    expect(VP.kiem).not.toHaveBeenCalled();
    expect(s3.chuaChamR2()).toBe(true);
  });

  it("[VH-03] 🔴 vé/quyền sai ⇒ lỗi theo bảng, KHÔNG chạm R2, `no-store`, không lộ khoá", async () => {
    const bang: Array<[string, number]> = [["VE_SAI_DINH_DANG", 400], ["VE_SAI_CHU_KY", 401], ["VE_HET_HAN", 401], ["VE_PHIEN_BAN_CU", 401], ["VE_KHONG_KHOP_QUYEN", 403], ["KHONG_CO_QUYEN", 403], ["DA_THU_HOI", 403], ["HET_HAN", 403], ["KHONG_TIM_THAY", 404], ["KHOA_CHUA_PHAT_HANH", 404], ["BAI_KHONG_TON_TAI", 404], ["BAI_CHUA_MO", 403], ["KHOA_VIDEO_KHONG_HOP_LE", 409], ["CAI_DAT_KHONG_HOP_LE", 503]];
    for (const [ma, status] of bang) {
      VP.kiem.mockResolvedValueOnce({ ok: false, ma });
      const s3 = s3Gia();
      const r = await doc(await xuLyPhat(yeuCau(), { s3 }));
      expect(r.status, ma).toBe(status);
      expect(JSON.parse(r.text), ma).toMatchObject({ ok: false, error: { code: ma } });
      expect(r.headers.get("cache-control"), ma).toBe("no-store");
      expect(r.text, ma).not.toMatch(KHOA_VUNG_E);
      expect(s3.chuaChamR2(), ma).toBe(true);
    }
  });

  it("[VH-04] kho video chưa cấu hình / trùng bucket chat ⇒ 503, KHÔNG chạm R2, không rơi về bucket nào khác", async () => {
    const s3 = s3Gia();
    delete process.env.R2_ONLINE_VIDEO_BUCKET_NAME;
    let r = await doc(await xuLyPhat(yeuCau(), { s3 }));
    expect(r.status).toBe(503);
    expect(JSON.parse(r.text).error.code).toBe("KHO_VIDEO_CHUA_CAU_HINH");
    process.env.R2_ONLINE_VIDEO_BUCKET_NAME = BUCKET;
    process.env.R2_CHAT_BUCKET_NAME = BUCKET;
    r = await doc(await xuLyPhat(yeuCau(), { s3 }));
    expect(r.status).toBe(503);
    expect(s3.chuaChamR2()).toBe(true);
  });

  it("[VH-04b] 🔴 bucket CÔNG KHAI bị từ chối trừ khi chủ dự án chấp nhận rõ ràng bằng cờ", async () => {
    const s3 = s3Gia();
    process.env.R2_BUCKET_NAME = BUCKET;
    expect((await xuLyPhat(yeuCau(), { s3 })).status).toBe(503);
    expect(s3.chuaChamR2()).toBe(true);
    process.env.R2_ONLINE_VIDEO_CHAP_NHAN_BUCKET_CONG_KHAI = "true";
    try {
      expect((await xuLyPhat(yeuCau(), { s3 })).status).toBe(200);
    } finally {
      delete process.env.R2_ONLINE_VIDEO_CHAP_NHAN_BUCKET_CONG_KHAI;
    }
  });
});

describe("[VH] xuLyPhat — phát + Range", () => {
  it("[VH-05] 200 toàn tệp: khoá/bucket do SERVER chọn, Content-Type từ ĐUÔI (không tin R2), header an toàn, thân đúng byte", async () => {
    const s3 = s3Gia({ contentTypeR2: "text/html" });
    const r = await doc(await xuLyPhat(yeuCau(), { s3 }));
    expect(r.status).toBe(200);
    expect(r.text).toBe("0123456789");
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(r.headers.get("content-length")).toBe("10");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(s3.lenh.map((l) => l.loai)).toEqual(["HEAD", "GET"]);
    for (const l of s3.lenh) expect(l.input).toMatchObject({ Bucket: BUCKET, Key: KHOA });
    expect(s3.lenh[1]!.input.Range).toBeUndefined();
  });

  it("[VH-06] 206 một khoảng: Content-Range đúng, thân đúng byte, Range gửi R2 đúng; khoảng mở/đuôi/vượt cuối", async () => {
    const ca: Array<[string, string, string, string]> = [
      ["bytes=2-5", "bytes 2-5/10", "2345", "bytes=2-5"],
      ["bytes=7-", "bytes 7-9/10", "789", "bytes=7-9"],
      ["bytes=-3", "bytes 7-9/10", "789", "bytes=7-9"],
      ["bytes=5-999", "bytes 5-9/10", "56789", "bytes=5-9"],
      ["bytes=0-0", "bytes 0-0/10", "0", "bytes=0-0"],
    ];
    for (const [range, cr, thanh, gui] of ca) {
      const s3 = s3Gia();
      const r = await doc(await xuLyPhat(yeuCau({ range }), { s3 }));
      expect(r.status, range).toBe(206);
      expect(r.headers.get("content-range"), range).toBe(cr);
      expect(r.headers.get("content-length"), range).toBe(String(thanh.length));
      expect(r.text, range).toBe(thanh);
      expect(s3.lenh[1]!.input.Range, range).toBe(gui);
    }
  });

  it("[VH-07] 416 khi xin quá cuối: Content-Range `bytes */10`, KHÔNG gọi GetObject (không giữ khe kết nối)", async () => {
    const s3 = s3Gia();
    const r = await xuLyPhat(yeuCau({ range: "bytes=100-" }), { s3 });
    expect(r.status).toBe(416);
    expect(r.headers.get("content-range")).toBe("bytes */10");
    expect(s3.lenh.map((l) => l.loai)).toEqual(["HEAD"]);
  });

  it("[VH-08] HEAD: chỉ header (kể cả 206 khi có Range), KHÔNG GetObject, thân rỗng", async () => {
    const s3 = s3Gia();
    const r = await doc(await xuLyPhat(yeuCau({ method: "HEAD" }), { s3 }));
    expect(r.status).toBe(200);
    expect(r.text).toBe("");
    expect(r.headers.get("content-length")).toBe("10");
    const r2 = await doc(await xuLyPhat(yeuCau({ method: "HEAD", range: "bytes=2-5" }), { s3 }));
    expect(r2.status).toBe(206);
    expect(r2.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(s3.lenh.every((l) => l.loai === "HEAD")).toBe(true);
  });

  it("[VH-09] R2: không có đối tượng ⇒ 404 KHONG_TIM_THAY; lỗi khác ⇒ 502 (không 500, không lộ chi tiết)", async () => {
    let r = await doc(await xuLyPhat(yeuCau(), { s3: s3Gia({ headLoi: Object.assign(new Error("x"), { name: "NotFound" }) }) }));
    expect(r.status).toBe(404);
    r = await doc(await xuLyPhat(yeuCau(), { s3: s3Gia({ headLoi: Object.assign(new Error("secret-detail-endpoint"), { name: "TimeoutError" }) }) }));
    expect(r.status).toBe(502);
    expect(r.text).not.toContain("secret-detail-endpoint");
    r = await doc(await xuLyPhat(yeuCau(), { s3: s3Gia({ getLoi: Object.assign(new Error("x"), { $metadata: { httpStatusCode: 404 } }) }) }));
    expect(r.status).toBe(404);
  });

  it("[VH-10] 🔴 truyền DÒNG: thân là ReadableStream từ `transformToWebStream`, `transformToByteArray` không bao giờ được gọi", async () => {
    const s3 = s3Gia();
    const r = await xuLyPhat(yeuCau(), { s3 });
    expect(r.body).toBeInstanceOf(ReadableStream);
    expect(await r.text()).toBe("0123456789"); // nếu mã gọi transformToByteArray thì đã ném ở trên
  });

  it("[VH-11] khoá + tên bucket không bao giờ nằm trong phản hồi (header lẫn thân)", async () => {
    const r = await xuLyPhat(yeuCau({ range: "bytes=0-3" }), { s3: s3Gia() });
    const tatCa = [...r.headers.entries()].map(([k, v]) => `${k}:${v}`).join("\n") + (await r.text());
    expect(tatCa).not.toMatch(KHOA_VUNG_E);
    expect(tatCa).not.toContain(BUCKET);
  });

  it("[VH-12] vé được kiểm ở MỖI lượt (kể cả mỗi lượt Range) — không cache kết quả giữa hai lượt", async () => {
    const s3 = s3Gia();
    await xuLyPhat(yeuCau({ range: "bytes=0-1" }), { s3 });
    await xuLyPhat(yeuCau({ range: "bytes=2-3" }), { s3 });
    expect(VP.kiem).toHaveBeenCalledTimes(2);
    VP.kiem.mockResolvedValueOnce({ ok: false, ma: "DA_THU_HOI" });
    expect((await xuLyPhat(yeuCau({ range: "bytes=4-5" }), { s3 })).status).toBe(403); // thu hồi giữa chừng ⇒ lượt kế tiếp bị cắt
  });
});

describe("[VH] xuLyPhat — khoá không bao giờ đến từ URL", () => {
  it("[VH-16] 🔴 tham số `khoa`/`key`/`path`/`bucket` trong query bị BỎ QUA: khoá + bucket R2 luôn do server tra từ DB (kiemVePhat)", async () => {
    const s3 = s3Gia();
    const u = new URL("http://localhost/api/public/elearning-online/video/phat?ve=ve-gia&khoa=online/video/khac.mp4&key=scorm/x.mp4&path=../a&bucket=bucket-khac&Key=x");
    const r = await xuLyPhat(new Request(u), { s3 });
    expect(r.status).toBe(200);
    expect(s3.lenh.length).toBeGreaterThan(0);
    for (const l of s3.lenh) expect(l.input).toMatchObject({ Bucket: BUCKET, Key: KHOA });
  });
});

describe("[VH] xuLyCapVeHocThu — vé công khai", () => {
  const post = () => new Request("http://localhost/api/public/elearning-online/khoa/robot-1/hoc-thu/bai-1/video-ticket", { method: "POST" });
  const veOk = { ok: true, ve: "payload.sig", hetHanLuc: new Date("2026-11-25T05:02:00.000Z"), ttlGiay: 120, loai: "HOC_THU", loaiTep: "video/mp4" };

  it("[VH-13] cờ tắt ⇒ 404; slug/bài sai định dạng ⇒ 404 KHONG_TIM_THAY (không chạm DB)", async () => {
    delete process.env.ELEARNING_ONLINE_ENABLED;
    expect((await xuLyCapVeHocThu(post(), "robot-1", "bai-1")).status).toBe(404);
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    for (const [slug, bai] of [["Robot_1", "bai-1"], ["robot-1", "../x"], ["robot-1", "a b"], ["", "bai-1"], ["robot-1", "x".repeat(65)]]) {
      const r = await doc(await xuLyCapVeHocThu(post(), slug!, bai!));
      expect(r.status, `${slug}/${bai}`).toBe(404);
    }
    expect(VP.capCk).not.toHaveBeenCalled();
  });

  it("[VH-14] vượt giới hạn tần suất ⇒ 429 + Retry-After, không cấp vé", async () => {
    RL.ok = false;
    RL.resetAt = Date.now() + 30_000;
    const r = await xuLyCapVeHocThu(post(), "robot-1", "bai-1");
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(VP.capCk).not.toHaveBeenCalled();
  });

  it("[VH-15] thành công: `no-store`, DTO có duongPhat/hetHanLuc/lamMoiTruocLuc/ttlGiay/loaiTep, KHÔNG khoá media; bài trả phí ⇒ 404", async () => {
    VP.capCk.mockResolvedValueOnce(veOk);
    const r = await doc(await xuLyCapVeHocThu(post(), "robot-1", "bai-1"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const d = JSON.parse(r.text).data;
    expect(d).toEqual({
      loai: "HOC_THU",
      duongPhat: "/api/public/elearning-online/video/phat?ve=payload.sig",
      hetHanLuc: "2026-11-25T05:02:00.000Z",
      lamMoiTruocLuc: "2026-11-25T05:01:36.000Z",
      ttlGiay: 120,
      loaiTep: "video/mp4",
      hoTroRange: true,
    });
    expect(r.text).not.toMatch(KHOA_VUNG_E);
    VP.capCk.mockResolvedValueOnce({ ok: false, ma: "KHONG_TIM_THAY" });
    const k = await doc(await xuLyCapVeHocThu(post(), "robot-1", "bai-tra-phi"));
    expect(k.status).toBe(404);
    expect(k.headers.get("cache-control")).toBe("no-store");
  });
});
