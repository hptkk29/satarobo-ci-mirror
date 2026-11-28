// [CSL-*] V8.19 — kho chat CỤC BỘ (thử nghiệm HTTP/UAT không có R2): chỉ bật khi non-production + MOBILE_UPLOAD_LOCAL_DIR + KHÔNG đặt R2_CHAT_BUCKET_NAME.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ghiKhoLocal } from "@/lib/mobile-api/kho-tep-rieng";
import { chatKhoCucBoDangBat, getChatBucket, docByteDauChat, headChatObject, isChatBucketConfigured, signChatGetUrl, signChatPutUrl } from "./chat-storage";

const KEYS = ["NODE_ENV", "MOBILE_UPLOAD_LOCAL_DIR", "MOBILE_UPLOAD_LOCAL_BASE", "R2_CHAT_BUCKET_NAME", "R2_BUCKET_NAME", "NEXTAUTH_SECRET", "AUTH_SECRET"] as const;
const goc: Record<string, string | undefined> = {};
let dir = "";
const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  for (const k of KEYS) goc[k] = env[k];
  dir = mkdtempSync(join(tmpdir(), "chat-kho-"));
  env.NODE_ENV = "test";
  env.MOBILE_UPLOAD_LOCAL_DIR = dir;
  env.MOBILE_UPLOAD_LOCAL_BASE = "http://localhost:3221";
  delete env.R2_CHAT_BUCKET_NAME;
  env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
});
afterEach(() => {
  for (const k of KEYS) {
    if (goc[k] === undefined) delete env[k];
    else env[k] = goc[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("[CSL] kho chat cục bộ", () => {
  it("[CSL-01] bật: non-production + có thư mục + không có bucket chat thật", () => {
    expect(chatKhoCucBoDangBat()).toBe(true);
    expect(isChatBucketConfigured()).toBe(true);
  });
  it("[CSL-02] PRODUCTION ⇒ không bao giờ bật (dù có thư mục)", () => {
    env.NODE_ENV = "production";
    expect(chatKhoCucBoDangBat()).toBe(false);
  });
  it("[CSL-03] đã đặt bucket chat thật ⇒ KHÔNG dùng kho cục bộ", () => {
    env.R2_CHAT_BUCKET_NAME = "bucket-chat-rieng";
    expect(chatKhoCucBoDangBat()).toBe(false);
  });
  it("[CSL-03b] getChatBucket: cục bộ ⇒ tên giữ chỗ; có bucket thật ⇒ bucket thật; production/không cấu hình ⇒ ném", () => {
    expect(getChatBucket()).toBe("kho-cuc-bo-thu-nghiem");
    env.R2_CHAT_BUCKET_NAME = "bucket-chat-rieng";
    expect(getChatBucket()).toBe("bucket-chat-rieng");
    delete env.R2_CHAT_BUCKET_NAME;
    env.NODE_ENV = "production";
    expect(() => getChatBucket()).toThrow();
  });
  it("[CSL-04] không đặt thư mục ⇒ tắt; fail closed như cũ (isChatBucketConfigured=false vì thiếu R2)", () => {
    delete env.MOBILE_UPLOAD_LOCAL_DIR;
    expect(chatKhoCucBoDangBat()).toBe(false);
    expect(isChatBucketConfigured()).toBe(false);
  });
  it("[CSL-05] vòng ghi → head → đọc byte đầu → URL đọc ký; không có đối tượng ⇒ null; không URL công khai", async () => {
    const key = "chat-attachments/c1/x.png";
    expect(await headChatObject(key)).toBeNull();
    expect(await docByteDauChat(key, 8)).toBeNull();
    const put = await signChatPutUrl(key, "image/png", 300);
    expect(put).toContain("/api/dev-kho/chat-attachments/c1/x.png?act=put");
    await ghiKhoLocal(key, "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]));
    expect(await headChatObject(key)).toEqual({ size: 9, contentType: "image/png" });
    expect(Array.from((await docByteDauChat(key, 4))!)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const get = await signChatGetUrl(key, 300);
    expect(get).toMatch(/\?act=get&e=\d+&c=-&s=[0-9a-f]{64}$/);
    expect(get).not.toMatch(/cdn\.satarobo|r2\.cloudflarestorage/);
  });
});
