// @vitest-environment node
/**
 * `GET /api/elearning/media/[...khoa]` — đường phát media đào tạo, có HTTP Range.
 *
 * Vì sao tệp này tồn tại: trước nó, cả ba route của EL-10 chỉ được canh bằng
 * `readFileSync` + `toContain` — tức chứng minh CÓ VIẾT, không chứng minh CÓ CHẠY.
 * Vòng rà đối kháng 25/08/2026 tiêm ba đột biến, **cả ba sống sót 47/47 case**:
 *
 *  · xoá dòng gán `Content-Range` ở nhánh 206 ⇒ trình phát không đặt được khối byte
 *    lên trục thời gian, huỷ tải, khung đen — mà **mã trạng thái vẫn là 206**, nên
 *    chỉ số T1 ("tỉ lệ 5xx của route Range") đọc 0% lỗi;
 *  · `Content-Length` lấy `coTep` thay vì `kq.contentLength` ⇒ header lệch thân,
 *    đứt nối giữa dòng;
 *  · xin R2 một cửa sổ byte khác cửa sổ đã hứa trong header.
 *
 * Cả ba đều là lỗi ở phép NỐI giữa số học và phản hồi. Số học thì đã được canh tốt
 * (`lib/elearning/range.test.ts`, 19 case biên). Chỗ hở là VỎ route — và chỉ gọi
 * thật handler rồi đọc phản hồi mới bịt được.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";

const CO_TEP = 1000;
const LESSON = "lesson-1";
const KHOA = `elearning/master/${LESSON}/abc.mp4`;

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  kiemVeMedia: vi.fn(),
  getElearningBucket: vi.fn(() => "satarobo-elearning"),
  send: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/storage/r2-client", () => ({ getR2Client: () => ({ send: h.send }) }));
vi.mock("@/lib/storage/elearning-storage", () => ({
  getElearningBucket: h.getElearningBucket,
}));
// `kiemVeMedia` cần khoá HMAC nên phải giả lập; `khoaThuocBai` là hàm THUẦN —
// giữ bản thật để case 404 dưới đây còn nói được điều gì đó.
vi.mock("@/lib/elearning/media-ticket", async (goc) => {
  const that = await goc<typeof import("@/lib/elearning/media-ticket")>();
  return { ...that, kiemVeMedia: h.kiemVeMedia };
});

import { GET } from "./route";

const req = (o: { range?: string; ve?: string; khoa?: string } = {}) =>
  ({
    nextUrl: new URL(
      `https://elearning.satarobo.vn/api/elearning/media/${o.khoa ?? KHOA}?ve=${o.ve ?? "ve-hop-le"}`,
    ),
    headers: new Headers(o.range ? { range: o.range } : {}),
  }) as unknown as NextRequest;

const ctx = (khoa = KHOA) => ({ params: Promise.resolve({ khoa: khoa.split("/") }) });

/** Thân R2 giả — luồng, đúng như `transformToWebStream()` trả về. */
const than = () => ({
  transformToWebStream: () =>
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.close();
      },
    }),
});

beforeEach(() => {
  h.auth.mockReset();
  h.auth.mockResolvedValue({ user: { id: "u-1" } });
  h.kiemVeMedia.mockReset();
  h.kiemVeMedia.mockReturnValue({ ok: true, ve: { userId: "u-1", lessonId: LESSON } });
  h.getElearningBucket.mockReset();
  h.getElearningBucket.mockReturnValue("satarobo-elearning");
  h.send.mockReset();
  h.send.mockImplementation(async (cmd: unknown) => {
    if (cmd instanceof HeadObjectCommand) return { ContentLength: CO_TEP };
    return { Body: than(), ContentType: "video/mp4" };
  });
});

/** Lệnh GetObject đã gửi tới R2 (nếu có). */
const lenhDoc = () =>
  h.send.mock.calls.map((c) => c[0]).find((c) => c instanceof GetObjectCommand) as
    | GetObjectCommand
    | undefined;

describe("hỏi dung lượng bằng HeadObject, KHÔNG bằng GetObject 1 byte", () => {
  it("dùng `HeadObject`, và không lệnh nào xin `bytes=0-0`", async () => {
    // `GetObject` trả về một LUỒNG. Lấy về rồi không đọc, không `destroy()` là giữ
    // một khe socket của pool SDK (50 khe, keepAlive, KHÔNG hạn chờ) cho tới khi
    // phía R2 đóng nối rỗi. Hỏng kiểu TREO, không phải 5xx — mọi chỉ số đếm 5xx
    // đều mù với nó, kể cả T1 của chính đặc tả.
    await GET(req({ range: "bytes=0-99" }), ctx());

    const lenh = h.send.mock.calls.map((c) => c[0]);
    expect(lenh.some((c) => c instanceof HeadObjectCommand)).toBe(true);
    expect(
      lenh.some(
        (c) => c instanceof GetObjectCommand && c.input.Range === "bytes=0-0",
      ),
    ).toBe(false);
    // Đúng hai lượt đi R2: một hỏi cỡ, một lấy byte.
    expect(h.send).toHaveBeenCalledTimes(2);
  });
});

describe("206 Partial Content — phép nối giữa số học và header", () => {
  it("trả 206 kèm `Content-Range` và `Content-Length` ĐÚNG SỐ", async () => {
    const r = await GET(req({ range: "bytes=0-99" }), ctx());

    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe(`bytes 0-99/${CO_TEP}`);
    expect(r.headers.get("Content-Length")).toBe("100");
    expect(r.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("xin R2 ĐÚNG cửa sổ byte đã hứa trong header", async () => {
    // Hứa một khoảng rồi lấy khoảng khác là trả về byte không khớp `Content-Range`
    // — trình phát ghép sai và không có lỗi nào nổ ra.
    const r = await GET(req({ range: "bytes=200-299" }), ctx());

    expect(r.headers.get("Content-Range")).toBe(`bytes 200-299/${CO_TEP}`);
    expect(lenhDoc()?.input.Range).toBe("bytes=200-299");
  });

  it("đuôi tệp (`bytes=-100`) ra đúng khoảng cuối", async () => {
    const r = await GET(req({ range: "bytes=-100" }), ctx());

    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe(`bytes 900-999/${CO_TEP}`);
    expect(r.headers.get("Content-Length")).toBe("100");
  });
});

describe("không có Range ⇒ 200, và KHÔNG kèm Content-Range", () => {
  it("trả trọn tệp", async () => {
    const r = await GET(req(), ctx());

    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Length")).toBe(String(CO_TEP));
    expect(r.headers.get("Content-Range")).toBeNull();
    expect(lenhDoc()?.input.Range).toBeUndefined();
  });
});

describe("khoảng không thoả mãn ⇒ 416, không trả byte nào", () => {
  it("trả 416 kèm `Content-Range: bytes */<cỡ>`", async () => {
    const r = await GET(req({ range: `bytes=${CO_TEP + 10}-` }), ctx());

    expect(r.status).toBe(416);
    expect(r.headers.get("Content-Range")).toBe(`bytes */${CO_TEP}`);
    expect(lenhDoc()).toBeUndefined();
  });
});

describe("cổng vào — bốn nhánh chặn", () => {
  it("chưa đăng nhập ⇒ 401, không chạm R2", async () => {
    h.auth.mockResolvedValue(null);
    const r = await GET(req(), ctx());

    expect(r.status).toBe(401);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("vé hỏng ⇒ 403", async () => {
    h.kiemVeMedia.mockReturnValue({ ok: false, ve: null });
    expect((await GET(req(), ctx())).status).toBe(403);
  });

  it("vé của NGƯỜI KHÁC ⇒ 403 (một vé chia sẻ không cho cả phòng xem)", async () => {
    h.kiemVeMedia.mockReturnValue({ ok: true, ve: { userId: "u-khac", lessonId: LESSON } });
    expect((await GET(req(), ctx())).status).toBe(403);
  });

  it("khoá KHÔNG thuộc bài của vé ⇒ 404, không chạm R2", async () => {
    const la = `elearning/master/lesson-khac/x.mp4`;
    const r = await GET(req({ khoa: la }), ctx(la));

    expect(r.status).toBe(404);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("chưa cấu hình bucket ⇒ 503, KHÔNG rơi về bucket công khai", async () => {
    h.getElearningBucket.mockImplementation(() => {
      throw new Error("chưa đặt R2_ELEARNING_BUCKET_NAME");
    });
    const r = await GET(req(), ctx());

    expect(r.status).toBe(503);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("tệp không có trên R2 ⇒ 404", async () => {
    h.send.mockRejectedValue(new Error("NoSuchKey"));
    expect((await GET(req(), ctx())).status).toBe(404);
  });
});

describe("không để cache sống lâu hơn vé", () => {
  it("`Cache-Control: no-store` ở cả 206 lẫn 416", async () => {
    // Đường SCORM đặt `private, max-age=3600` — cache sống lâu hơn vé nên tệp còn
    // phát được sau khi vé hết hạn.
    expect((await GET(req({ range: "bytes=0-9" }), ctx())).headers.get("Cache-Control")).toBe(
      "no-store",
    );
    expect(
      (await GET(req({ range: `bytes=${CO_TEP + 10}-` }), ctx())).headers.get("Cache-Control"),
    ).toBe("no-store");
  });

  it("`X-Content-Type-Options: nosniff`", async () => {
    const r = await GET(req(), ctx());
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
