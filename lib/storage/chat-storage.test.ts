// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// lib/storage/chat-storage.test.ts — chốt bất biến RIÊNG TƯ của kho ảnh chat.
//
// Bucket `R2_BUCKET_NAME` có custom domain `R2_PUBLIC_URL` (cdn.satarobo.vn) ⇒
// mọi object trong đó tải được vô danh. Ảnh chat (ảnh trẻ em trong nhóm lớp) vì
// thế PHẢI nằm ở bucket riêng, nếu không thì signed URL 5 phút chỉ là trang trí.
// Bộ test này chốt: chat-storage không bao giờ hỏi bucket/host công khai, và
// thiếu cấu hình thì THROW chứ không mượn tạm bucket công khai.
// =============================================================================

const h = vi.hoisted(() => ({
  getR2Client: vi.fn(() => ({ tag: "r2-client" })),
  getR2Bucket: vi.fn(() => "satarobo-uploads"),
  getR2PublicUrl: vi.fn(() => "https://cdn.satarobo.vn"),
  getPublicUrl: vi.fn((k: string) => `https://cdn.satarobo.vn/${k}`),
  getSignedUrl: vi.fn(
    async (
      _c: unknown,
      cmd: { input: { Bucket: string; Key: string; ContentType?: string } },
      opts: { expiresIn: number },
    ) =>
      `https://${cmd.input.Bucket}.r2-signed.test/${cmd.input.Key}?X-Amz-Expires=${opts.expiresIn}`,
  ),
}));

vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: h.getR2Client,
  getR2Bucket: h.getR2Bucket,
  getR2PublicUrl: h.getR2PublicUrl,
  getPublicUrl: h.getPublicUrl,
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: h.getSignedUrl }));

import {
  ChatStorageConfigError,
  getChatBucket,
  isChatBucketConfigured,
  signChatGetUrl,
  signChatPutUrl,
} from "./chat-storage";

const CHAT_BUCKET = "satarobo-chat-private";
const PUBLIC_BUCKET = "satarobo-uploads";
const ENV_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
  "R2_CHAT_BUCKET_NAME",
] as const;
let snapshot: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  snapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.R2_ACCOUNT_ID = "zztest-account";
  process.env.R2_ACCESS_KEY_ID = "zztest-key";
  process.env.R2_SECRET_ACCESS_KEY = "zztest-secret";
  process.env.R2_BUCKET_NAME = PUBLIC_BUCKET;
  process.env.R2_PUBLIC_URL = "https://cdn.satarobo.vn";
  process.env.R2_CHAT_BUCKET_NAME = CHAT_BUCKET;
  vi.clearAllMocks();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = snapshot[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("getChatBucket", () => {
  it("trả bucket riêng của chat, không hỏi bucket công khai", () => {
    expect(getChatBucket()).toBe(CHAT_BUCKET);
    expect(h.getR2Bucket).not.toHaveBeenCalled();
    expect(h.getR2PublicUrl).not.toHaveBeenCalled();
  });

  it("thiếu R2_CHAT_BUCKET_NAME → throw, KHÔNG fallback R2_BUCKET_NAME", () => {
    delete process.env.R2_CHAT_BUCKET_NAME;
    expect(() => getChatBucket()).toThrow(ChatStorageConfigError);
    expect(isChatBucketConfigured()).toBe(false);
    expect(h.getR2Bucket).not.toHaveBeenCalled();
  });

  it("chuỗi rỗng / toàn khoảng trắng cũng coi như chưa đặt", () => {
    for (const v of ["", "   "]) {
      process.env.R2_CHAT_BUCKET_NAME = v;
      expect(() => getChatBucket()).toThrow(ChatStorageConfigError);
    }
  });

  it("trỏ đúng vào bucket công khai → throw (chặn cấu hình sai ngay tại env)", () => {
    process.env.R2_CHAT_BUCKET_NAME = PUBLIC_BUCKET;
    expect(() => getChatBucket()).toThrow(/công khai/);
    expect(isChatBucketConfigured()).toBe(false);
  });

  it("không phụ thuộc R2_PUBLIC_URL: xoá đi vẫn cấu hình đủ", () => {
    delete process.env.R2_PUBLIC_URL;
    expect(getChatBucket()).toBe(CHAT_BUCKET);
    expect(isChatBucketConfigured()).toBe(true);
  });

  it("thiếu credential R2 → isChatBucketConfigured false (fail closed)", () => {
    delete process.env.R2_ACCESS_KEY_ID;
    expect(isChatBucketConfigured()).toBe(false);
  });
});

describe("signChatPutUrl / signChatGetUrl", () => {
  it("PUT ký vào bucket chat, kèm đúng ContentType + TTL", async () => {
    const url = await signChatPutUrl("chat-attachments/c1/2026-08/x.jpg", "image/jpeg", 300);
    const [, cmd, opts] = h.getSignedUrl.mock.calls[0]!;
    expect(cmd.input.Bucket).toBe(CHAT_BUCKET);
    expect(cmd.input.ContentType).toBe("image/jpeg");
    expect(opts.expiresIn).toBe(300);
    expect(url).not.toContain("cdn.satarobo.vn");
    expect(h.getR2Bucket).not.toHaveBeenCalled();
  });

  it("GET ký vào bucket chat, KHÔNG ký ContentType", async () => {
    await signChatGetUrl("chat-attachments/c1/2026-08/x.jpg", 300);
    const [, cmd, opts] = h.getSignedUrl.mock.calls[0]!;
    expect(cmd.input.Bucket).toBe(CHAT_BUCKET);
    expect(cmd.input.ContentType).toBeUndefined();
    expect(opts.expiresIn).toBe(300);
    expect(h.getR2Bucket).not.toHaveBeenCalled();
    expect(h.getR2PublicUrl).not.toHaveBeenCalled();
  });

  it("dùng CHUNG credential R2 (getR2Client) — chỉ khác bucket", async () => {
    await signChatGetUrl("chat-attachments/c1/2026-08/x.jpg", 300);
    expect(h.getR2Client).toHaveBeenCalledTimes(1);
    expect(h.getSignedUrl.mock.calls[0]![0]).toEqual({ tag: "r2-client" });
  });

  it("thiếu bucket chat → throw trước khi ký (không có object nào được ký)", async () => {
    delete process.env.R2_CHAT_BUCKET_NAME;
    await expect(signChatPutUrl("k.jpg", "image/jpeg", 300)).rejects.toThrow(
      ChatStorageConfigError,
    );
    await expect(signChatGetUrl("k.jpg", 300)).rejects.toThrow(ChatStorageConfigError);
    expect(h.getSignedUrl).not.toHaveBeenCalled();
  });
});
