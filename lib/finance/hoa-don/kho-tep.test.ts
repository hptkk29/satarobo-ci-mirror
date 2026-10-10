// Ca [KT-*] — KHO TỆP HOÁ ĐƠN: bucket RIÊNG, fail-closed, khoá tệp đúng đơn, vân tay tệp thật.
//
// Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §6. Tệp hoá đơn mang MST, địa chỉ, email khách. Bucket
// mặc định (`R2_BUCKET_NAME`) phát CÔNG KHAI qua cdn.satarobo.vn — URL ký chứa nguyên khoá, ai có
// URL là ghép sang CDN tải vĩnh viễn. Nên kho hoá đơn là bucket riêng, và getter NÉM chứ không lùi.
//
// Khuôn chép `lib/calls/kho-ghi-am.ts` (bản đầy đủ nhất), nhưng so trùng đủ BỐN bucket — ba bản cũ
// không đối xứng (chat so 1, e-learning so 2, ghi âm so 3).
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const h = vi.hoisted(() => ({
  send: vi.fn(),
  getR2Bucket: vi.fn(() => "satarobo-uploads"),
  getSignedUrl: vi.fn(
    async (
      _c: unknown,
      cmd: { input: { Bucket: string; Key: string; ContentType?: string; ResponseContentDisposition?: string } },
      opts: { expiresIn: number },
    ) => `https://${cmd.input.Bucket}.r2-signed.test/${cmd.input.Key}?X-Amz-Expires=${opts.expiresIn}`,
  ),
}));
// `r2DaCauHinh` giữ bản THẬT: nó đọc env, và `khoHoaDonDaCauHinh` phải hỏi đúng danh sách biến của
// client chung — mock nó thành hằng là test không còn đo gì ([KT-01b]).
vi.mock("@/lib/storage/r2-client", async (goc) => ({
  ...(await goc<typeof import("@/lib/storage/r2-client")>()),
  getR2Client: () => ({ send: h.send }),
  getR2Bucket: h.getR2Bucket,
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: h.getSignedUrl }));

import {
  getHoaDonBucket,
  HoaDonKhoConfigError,
  khoHoaDonDaCauHinh,
  khoaTepHoaDon,
  khoaThuocDon,
  vanTayHoaDon,
  kyUrlTaiLenHoaDon,
  kyUrlTaiVeHoaDon,
  xacMinhTepHoaDon,
  TRAN_CO_TEP,
} from "./kho-tep";

const ENV_GOC = { ...process.env };
beforeEach(() => {
  process.env.R2_INVOICE_BUCKET_NAME = "satarobo-hoa-don";
  process.env.R2_BUCKET_NAME = "satarobo-uploads";
  process.env.R2_CHAT_BUCKET_NAME = "satarobo-chat";
  process.env.R2_ELEARNING_BUCKET_NAME = "satarobo-elearning";
  process.env.R2_CALL_BUCKET_NAME = "satarobo-ghi-am";
  process.env.R2_ACCOUNT_ID = "acc";
  process.env.R2_ACCESS_KEY_ID = "key";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  process.env.R2_PUBLIC_URL = "https://cdn.example.test";
  h.send.mockReset();
  h.getSignedUrl.mockClear();
  h.getR2Bucket.mockClear();
});
afterEach(() => {
  process.env = { ...ENV_GOC };
});

const bytes = (s: string, dau: number[] = []) => new Uint8Array([...dau, ...Buffer.from(s, "utf8")]);

describe("[KT-01] getter bucket — FAIL-CLOSED, so trùng đủ bốn bucket", () => {
  it("đặt đúng ⇒ trả tên (đã trim)", () => {
    process.env.R2_INVOICE_BUCKET_NAME = "  satarobo-hoa-don  ";
    expect(getHoaDonBucket()).toBe("satarobo-hoa-don");
  });

  it("chưa đặt / rỗng ⇒ NÉM, không lùi về bucket nào", () => {
    delete process.env.R2_INVOICE_BUCKET_NAME;
    expect(() => getHoaDonBucket()).toThrow(HoaDonKhoConfigError);
    process.env.R2_INVOICE_BUCKET_NAME = "   ";
    expect(() => getHoaDonBucket()).toThrow(HoaDonKhoConfigError);
  });

  for (const [env, nhan] of [
    ["R2_BUCKET_NAME", /công khai/i],
    ["R2_CHAT_BUCKET_NAME", /chat/i],
    ["R2_ELEARNING_BUCKET_NAME", /đào tạo/i],
    ["R2_CALL_BUCKET_NAME", /ghi âm/i],
  ] as const) {
    it(`trùng ${env} ⇒ NÉM`, () => {
      process.env.R2_INVOICE_BUCKET_NAME = process.env[env]!;
      expect(() => getHoaDonBucket()).toThrow(nhan);
    });
  }

  it("đối chứng dương: bucket kia CHƯA đặt thì không chặn nhầm", () => {
    delete process.env.R2_BUCKET_NAME;
    delete process.env.R2_CHAT_BUCKET_NAME;
    delete process.env.R2_ELEARNING_BUCKET_NAME;
    delete process.env.R2_CALL_BUCKET_NAME;
    expect(getHoaDonBucket()).toBe("satarobo-hoa-don");
  });

  it(".env.example khai biến (rỗng) — người dựng máy mới biết phải đặt, và không có giá trị thật lọt vào repo", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const env = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    expect(env).toMatch(/^R2_INVOICE_BUCKET_NAME=""\s*$/m);
  });

  it("khoHoaDonDaCauHinh: đủ bucket + đủ khoá R2 ⇒ true; thiếu một ⇒ false, KHÔNG ném", () => {
    expect(khoHoaDonDaCauHinh()).toBe(true);
    delete process.env.R2_SECRET_ACCESS_KEY;
    expect(khoHoaDonDaCauHinh()).toBe(false);
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_INVOICE_BUCKET_NAME = "satarobo-uploads";
    expect(khoHoaDonDaCauHinh()).toBe(false);
  });

  it("[KT-01b] thiếu biến mà client R2 CHUNG đòi (R2_PUBLIC_URL / R2_BUCKET_NAME) ⇒ false", () => {
    // Bản cũ chỉ hỏi ba khoá truy cập ⇒ true ⇒ màn vẽ nút tải, route ký URL qua `getR2Client()`
    // thì ném "R2 env vars missing" ⇒ 503 (smoke GĐ 7, 26/09/2026).
    expect(khoHoaDonDaCauHinh()).toBe(true);
    delete process.env.R2_PUBLIC_URL;
    expect(khoHoaDonDaCauHinh()).toBe(false);
    process.env.R2_PUBLIC_URL = "https://cdn.example.test";
    delete process.env.R2_BUCKET_NAME;
    expect(khoHoaDonDaCauHinh()).toBe(false);
  });
});

describe("[KT-02] khoá tệp — gắn cứng vào cơ sở + đơn", () => {
  const vao = { centerCode: "CS1", orderId: "cmorder123", loai: "pdf" as const, nam: 2026, uuid: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b" };

  it("dạng hoa-don/<mã CS>/<năm>/<orderId>/<uuid>.<đuôi>", () => {
    expect(khoaTepHoaDon(vao)).toBe("hoa-don/CS1/2026/cmorder123/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.pdf");
    expect(khoaTepHoaDon({ ...vao, loai: "xml" })).toMatch(/\.xml$/);
  });

  it("mã cơ sở / orderId mang ký tự đường dẫn ⇒ NÉM (không cho khoá thoát khỏi thư mục đơn)", () => {
    expect(() => khoaTepHoaDon({ ...vao, centerCode: "../CS2" })).toThrow();
    expect(() => khoaTepHoaDon({ ...vao, orderId: "a/b" })).toThrow();
    expect(() => khoaTepHoaDon({ ...vao, centerCode: "" })).toThrow();
  });

  it("khoaThuocDon: đúng đơn đúng cơ sở ⇒ true", () => {
    expect(khoaThuocDon(khoaTepHoaDon(vao), "CS1", "cmorder123")).toBe(true);
  });

  it("khoaThuocDon: khoá của đơn KHÁC / cơ sở KHÁC / có '..' / đuôi lạ / thiếu tiền tố ⇒ false", () => {
    const k = khoaTepHoaDon(vao);
    expect(khoaThuocDon(k, "CS1", "cmorder999")).toBe(false);
    expect(khoaThuocDon(k, "CS2", "cmorder123")).toBe(false);
    expect(khoaThuocDon("hoa-don/CS1/2026/cmorder123/../../CS2/x.pdf", "CS1", "cmorder123")).toBe(false);
    expect(khoaThuocDon("hoa-don/CS1/2026/cmorder123/abc.exe", "CS1", "cmorder123")).toBe(false);
    expect(khoaThuocDon("chat/CS1/2026/cmorder123/abc.pdf", "CS1", "cmorder123")).toBe(false);
  });
});

describe("[KT-03] vân tay tệp — tin BYTE, không tin đuôi/mime trình duyệt khai", () => {
  it("PDF phải mở đầu bằng %PDF-", () => {
    expect(vanTayHoaDon("pdf", bytes("%PDF-1.7\n"))).toBe(true);
    expect(vanTayHoaDon("pdf", bytes("PK\u0003\u0004"))).toBe(false);
    expect(vanTayHoaDon("pdf", bytes(" %PDF-1.7"))).toBe(false);
  });

  it("XML: '<' đầu tiên, cho phép UTF-8 BOM và khoảng trắng đứng trước", () => {
    expect(vanTayHoaDon("xml", bytes('<?xml version="1.0"?>'))).toBe(true);
    expect(vanTayHoaDon("xml", bytes('<?xml version="1.0"?>', [0xef, 0xbb, 0xbf]))).toBe(true);
    expect(vanTayHoaDon("xml", bytes("\r\n  <HDon>"))).toBe(true);
  });

  it("XML: tệp nhị phân / PDF đổi đuôi ⇒ false", () => {
    expect(vanTayHoaDon("xml", bytes("%PDF-1.7"))).toBe(false);
    expect(vanTayHoaDon("xml", new Uint8Array([0x00, 0x01, 0x02]))).toBe(false);
    expect(vanTayHoaDon("xml", new Uint8Array([]))).toBe(false);
  });
});

describe("[KT-04] ký URL — đúng bucket hoá đơn, KHÔNG BAO GIỜ bucket công khai", () => {
  it("PUT: chỉ ký ContentType (ký thêm header trình duyệt không gửi ⇒ R2 403 giả dạng lỗi CORS)", async () => {
    const url = await kyUrlTaiLenHoaDon("hoa-don/CS1/2026/o/u.pdf", "application/pdf", 300);
    const [, cmd, opts] = h.getSignedUrl.mock.calls[0]!;
    expect(cmd.input).toEqual({ Bucket: "satarobo-hoa-don", Key: "hoa-don/CS1/2026/o/u.pdf", ContentType: "application/pdf" });
    expect(opts.expiresIn).toBe(300);
    expect(url).toContain("satarobo-hoa-don");
    expect(h.getR2Bucket).not.toHaveBeenCalled();
  });

  it("GET: tải về đúng tên tệp (Content-Disposition attachment, tên có dấu mã hoá RFC 5987)", async () => {
    await kyUrlTaiVeHoaDon("hoa-don/CS1/2026/o/u.pdf", "Hoá đơn 1C26TSR-127.pdf", 300);
    const [, cmd, opts] = h.getSignedUrl.mock.calls[0]!;
    expect(cmd.input.Bucket).toBe("satarobo-hoa-don");
    expect(cmd.input.ResponseContentDisposition).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''/);
    expect(cmd.input.ResponseContentDisposition).toContain(encodeURIComponent("Hoá đơn 1C26TSR-127.pdf"));
    expect(opts.expiresIn).toBe(300);
    expect(h.getR2Bucket).not.toHaveBeenCalled();
  });

  it("bucket chưa cấu hình ⇒ ký NÉM, không ký sang bucket nào khác", async () => {
    delete process.env.R2_INVOICE_BUCKET_NAME;
    await expect(kyUrlTaiLenHoaDon("k", "application/pdf", 300)).rejects.toThrow(HoaDonKhoConfigError);
    expect(h.getSignedUrl).not.toHaveBeenCalled();
  });
});

describe("[KT-05] xác minh sau khi tải lên — cỡ THẬT, vân tay THẬT, sha256", () => {
  const KHOA = "hoa-don/CS1/2026/o/u.pdf";
  const PDF = bytes("%PDF-1.7\n...noi dung...");

  function kho(opts: { co?: number | null; body?: Uint8Array; khongThay?: boolean }) {
    h.send.mockImplementation(async (cmd: unknown) => {
      if (opts.khongThay && (cmd instanceof HeadObjectCommand || cmd instanceof GetObjectCommand)) {
        throw Object.assign(new Error("NotFound"), { name: "NotFound" });
      }
      if (cmd instanceof HeadObjectCommand) return { ContentLength: opts.co ?? opts.body?.length };
      if (cmd instanceof GetObjectCommand) return { Body: { transformToByteArray: async () => opts.body ?? new Uint8Array() } };
      if (cmd instanceof DeleteObjectCommand) return {};
      throw new Error("lệnh lạ");
    });
  }
  const daXoa = () => h.send.mock.calls.some(([c]) => c instanceof DeleteObjectCommand);

  it("tệp PDF thật ⇒ ok, cỡ + sha256 đúng của chính byte đã đọc", async () => {
    kho({ body: PDF });
    const r = await xacMinhTepHoaDon({ khoa: KHOA, loai: "pdf" });
    expect(r).toEqual({ ok: true, co: PDF.length, sha256: createHash("sha256").update(PDF).digest("hex") });
    expect(daXoa()).toBe(false);
  });

  it("không thấy tệp (trình duyệt chưa PUT xong / PUT hỏng) ⇒ KHONG_THAY, không xoá gì", async () => {
    kho({ khongThay: true });
    expect(await xacMinhTepHoaDon({ khoa: KHOA, loai: "pdf" })).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(daXoa()).toBe(false);
  });

  it("quá cỡ ⇒ QUA_LON, DỌN tệp, và KHÔNG đọc thân tệp", async () => {
    kho({ co: TRAN_CO_TEP.pdf + 1, body: PDF });
    expect(await xacMinhTepHoaDon({ khoa: KHOA, loai: "pdf" })).toMatchObject({ ok: false, ma: "QUA_LON" });
    expect(daXoa()).toBe(true);
    expect(h.send.mock.calls.some(([c]) => c instanceof GetObjectCommand)).toBe(false);
  });

  it("sai vân tay (tệp .exe đổi đuôi .pdf) ⇒ SAI_LOAI và DỌN tệp", async () => {
    kho({ body: bytes("MZ\u0090\u0000") });
    expect(await xacMinhTepHoaDon({ khoa: KHOA, loai: "pdf" })).toMatchObject({ ok: false, ma: "SAI_LOAI" });
    expect(daXoa()).toBe(true);
  });

  it("tệp rỗng ⇒ SAI_LOAI (không coi là hoá đơn)", async () => {
    kho({ co: 0, body: new Uint8Array() });
    expect(await xacMinhTepHoaDon({ khoa: KHOA, loai: "pdf" })).toMatchObject({ ok: false, ma: "SAI_LOAI" });
  });

  it("XML dùng trần cỡ RIÊNG (nhỏ hơn PDF)", async () => {
    expect(TRAN_CO_TEP.xml).toBeLessThan(TRAN_CO_TEP.pdf);
    kho({ co: TRAN_CO_TEP.xml + 1, body: bytes("<?xml?>") });
    expect(await xacMinhTepHoaDon({ khoa: "hoa-don/CS1/2026/o/u.xml", loai: "xml" })).toMatchObject({ ok: false, ma: "QUA_LON" });
  });
});
