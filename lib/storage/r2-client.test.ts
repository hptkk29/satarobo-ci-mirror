/**
 * Khoá đúng MỘT bất biến, nhưng là bất biến đã từng làm chết cả tính năng:
 * client R2 phải TẮT tính-checksum-tự-động, nếu không mọi URL PUT ký sẵn đều hỏng.
 *
 * Bối cảnh (nghiệm thu chat 10/08/2026): từ `@aws-sdk/client-s3` v3.729, mặc định
 * `requestChecksumCalculation: "WHEN_SUPPORTED"` khiến SDK nhúng `x-amz-checksum-crc32`
 * vào URL ký sẵn của PutObject. Lúc ký, server CHƯA CÓ file ⇒ giá trị nhúng là CRC32 của
 * body RỖNG (`AAAAAA==`); trình duyệt PUT byte thật lên thì R2 tính ra số khác và TỪ CHỐI.
 * Response lỗi của R2 không kèm header CORS nên trình duyệt báo "No
 * 'Access-Control-Allow-Origin' header is present" — che mất nguyên nhân thật.
 *
 * Ảnh hưởng KHÔNG chỉ chat: đây là client dùng chung cho mọi đường ký URL, gồm cả upload
 * của admin/SCORM. Vì vậy test này canh ở tầng client chứ không ở tầng chat.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ ctor: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(config: unknown) {
      h.ctor(config);
    }
  },
  GetObjectCommand: class {},
  PutObjectCommand: class {},
}));

describe("client R2", () => {
  beforeEach(() => {
    vi.resetModules();
    h.ctor.mockClear();
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET_NAME = "bucket-test";
    process.env.R2_PUBLIC_URL = "https://cdn.example.test";
  });

  it("TẮT checksum tự động — nếu không, mọi URL PUT ký sẵn đều bị kho từ chối", async () => {
    const { getR2Client } = await import("./r2-client");
    getR2Client();

    expect(h.ctor).toHaveBeenCalledTimes(1);
    const config = h.ctor.mock.calls[0]![0] as Record<string, unknown>;
    expect(
      config.requestChecksumCalculation,
      'thiếu dòng này ⇒ URL ký sẵn mang CRC32 của body RỖNG ⇒ R2 từ chối, trình duyệt báo nhầm thành lỗi CORS',
    ).toBe("WHEN_REQUIRED");
    expect(config.responseChecksumValidation).toBe("WHEN_REQUIRED");
  });

  it("vẫn trỏ đúng endpoint tài khoản R2 và region auto", async () => {
    const { getR2Client } = await import("./r2-client");
    getR2Client();
    const config = h.ctor.mock.calls[0]![0] as Record<string, unknown>;
    expect(config.region).toBe("auto");
    expect(config.endpoint).toBe("https://acct.r2.cloudflarestorage.com");
  });

  it("[R2-CFG] r2DaCauHinh trả lời ĐÚNG câu mà getR2Client hỏi — đủ năm biến mới true, không ném", async () => {
    const { r2DaCauHinh, getR2Client } = await import("./r2-client");
    expect(r2DaCauHinh()).toBe(true);
    for (const bien of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_PUBLIC_URL"]) {
      const giu = process.env[bien];
      delete process.env[bien];
      expect(r2DaCauHinh(), bien).toBe(false);
      // Đối chứng: đúng lúc hàm báo false thì client chung THẬT SỰ không dựng được.
      expect(() => getR2Client(), bien).toThrow(/R2 env vars missing/);
      process.env[bien] = giu;
    }
  });
});
