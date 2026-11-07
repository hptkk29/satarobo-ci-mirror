// @vitest-environment node
// (node: dùng Buffer thật để dựng magic bytes — jsdom bọc Uint8Array khác realm.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// (server-only được alias sang stub rỗng trong vitest.config.ts)

// ── DB giả: đủ 3 model attachments.ts chạm, chỉnh state từng test ───────────
type ConvRow = { id: string; status: "ACTIVE" | "ARCHIVED" | "LOCKED" } | null;
type PartRow = { leftAt: Date | null } | null;
type AttRow = {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  message: { conversationId: string; deletedAt: Date | null };
} | null;

const state: { conv: ConvRow; part: PartRow; att: AttRow } = {
  conv: null,
  part: null,
  att: null,
};

vi.mock("@/lib/db", () => ({
  db: {
    conversation: { findUnique: vi.fn(async () => state.conv) },
    conversationParticipant: { findUnique: vi.fn(async () => state.part) },
    messageAttachment: { findUnique: vi.fn(async () => state.att) },
  },
}));

// ── R2 giả ──────────────────────────────────────────────────────────────────
// KHÔNG mock `@/lib/storage/chat-storage`: nó chính là thứ phải kiểm (ký vào
// bucket NÀO). Chỉ chặn ở tầng dưới cùng (`getSignedUrl`) để không đụng mạng.
//
// 3 hàm của kho CÔNG KHAI (`getR2Bucket`, `getR2PublicUrl`, `signedMediaUrl`) được
// mock kèm giá trị thật-như-prod và bị **assert là KHÔNG ĐƯỢC GỌI**: luồng chat
// chạm bất kỳ hàm nào trong số đó = ảnh trẻ em rơi vào bucket có cdn.satarobo.vn.
const h = vi.hoisted(() => {
  const presign: Array<{
    bucket: string;
    key: string;
    contentType?: string;
    expiresIn: number;
  }> = [];
  return {
    presign,
    getR2Client: vi.fn(() => ({})),
    getR2Bucket: vi.fn(() => "satarobo-uploads"),
    getR2PublicUrl: vi.fn(() => "https://cdn.satarobo.vn"),
    getPublicUrl: vi.fn((k: string) => `https://cdn.satarobo.vn/${k}`),
    signedMediaUrl: vi.fn(
      async (key: string, ttl: number) => `https://cdn.satarobo.vn/${key}?ttl=${ttl}`,
    ),
    getSignedUrl: vi.fn(
      async (
        _c: unknown,
        cmd: { input: { Bucket: string; Key: string; ContentType?: string } },
        opts: { expiresIn: number },
      ) => {
        presign.push({
          bucket: cmd.input.Bucket,
          key: cmd.input.Key,
          contentType: cmd.input.ContentType,
          expiresIn: opts.expiresIn,
        });
        const ct = cmd.input.ContentType
          ? `&ct=${encodeURIComponent(cmd.input.ContentType)}`
          : "";
        // Host mang tên bucket ⇒ test soi được URL đang trỏ vào bucket nào.
        return `https://${cmd.input.Bucket}.r2-signed.test/${cmd.input.Key}?X-Amz-Expires=${opts.expiresIn}${ct}`;
      },
    ),
  };
});

vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: h.getR2Client,
  getR2Bucket: h.getR2Bucket,
  getR2PublicUrl: h.getR2PublicUrl,
  getPublicUrl: h.getPublicUrl,
}));
vi.mock("@/lib/storage/signed-url", () => ({ signedMediaUrl: h.signedMediaUrl }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: h.getSignedUrl }));

/** Bucket RIÊNG của chat (không custom domain) — nơi ảnh chat PHẢI nằm. */
const CHAT_BUCKET = "satarobo-chat-private";
/** Bucket CÔNG KHAI (gắn cdn.satarobo.vn) — chat KHÔNG ĐƯỢC chạm. */
const PUBLIC_BUCKET = "satarobo-uploads";
const PUBLIC_HOST = "cdn.satarobo.vn";

const ENV_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
  "R2_CHAT_BUCKET_NAME",
] as const;
let envSnapshot: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

/** Không hàm nào của kho công khai được gọi trong luồng chat. */
function expectPublicStorageUntouched() {
  expect(h.getR2Bucket).not.toHaveBeenCalled();
  expect(h.getR2PublicUrl).not.toHaveBeenCalled();
  expect(h.getPublicUrl).not.toHaveBeenCalled();
  expect(h.signedMediaUrl).not.toHaveBeenCalled();
}

import {
  CHAT_IMAGE_RULES,
  ChatAttachmentError,
  buildChatAttachmentKey,
  createChatUploadTicket,
  getChatAttachmentReadUrl,
  isChatStorageConfigured,
  sanitizeChatFileName,
  sniffImageMime,
  assertChatUploadFiles,
  type ChatUploadFileInput,
} from "./attachments";

// ── Magic bytes thật ────────────────────────────────────────────────────────
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // "RIFF"
  0x24, 0x10, 0x00, 0x00, // size (bỏ qua)
  0x57, 0x45, 0x42, 0x50, // "WEBP"
  0x56, 0x50, 0x38, 0x20,
]);
/** PE/DOS header — `virus.exe` đổi đuôi `.jpg` (TS-14.1). */
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x10, 0x00, 0x80, 0x00]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3]);
/** HEIC: `....ftypheic` — đúng cấu trúc ISO-BMFF, vẫn phải bị từ chối (AC5). */
const HEIC = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
]);

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function file(over: Partial<ChatUploadFileInput> = {}): ChatUploadFileInput {
  return {
    fileName: "anh.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 120_000,
    headBase64: b64(JPEG),
    ...over,
  };
}

const CONV = "6d0f4c22-1111-4aaa-9bbb-000000000001";
const USER = "clzztestuser0001abcdefgh";

beforeEach(() => {
  state.conv = { id: CONV, status: "ACTIVE" };
  state.part = { leftAt: null };
  state.att = null;

  envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.R2_ACCOUNT_ID = "zztest-account";
  process.env.R2_ACCESS_KEY_ID = "zztest-key";
  process.env.R2_SECRET_ACCESS_KEY = "zztest-secret";
  process.env.R2_BUCKET_NAME = PUBLIC_BUCKET;
  process.env.R2_PUBLIC_URL = `https://${PUBLIC_HOST}`;
  process.env.R2_CHAT_BUCKET_NAME = CHAT_BUCKET;

  h.presign.length = 0;
  vi.clearAllMocks(); // xoá lịch sử gọi, GIỮ implementation (vi.fn(impl))
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = envSnapshot[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
describe("[US-11] sniffImageMime — magic bytes (AC1: đổi đuôi không lách được)", () => {
  it("nhận đúng 3 định dạng trong gói cắt", () => {
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(WEBP)).toBe("image/webp");
  });

  it("virus.exe đổi tên .jpg → null (chốt chặn AC1)", () => {
    expect(sniffImageMime(EXE)).toBeNull();
  });

  it("heic / pdf / gif → null (ngoài gói cắt)", () => {
    expect(sniffImageMime(HEIC)).toBeNull();
    expect(sniffImageMime(PDF)).toBeNull();
    expect(sniffImageMime(GIF)).toBeNull();
  });

  it("file rỗng / quá ngắn → null, không throw", () => {
    expect(sniffImageMime(new Uint8Array([]))).toBeNull();
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8]))).toBeNull(); // JPEG thiếu byte 3
    expect(sniffImageMime(PNG.slice(0, 7))).toBeNull(); // PNG thiếu byte 8
    expect(sniffImageMime(WEBP.slice(0, 11))).toBeNull(); // chưa tới tag "WEBP"
  });

  it("RIFF nhưng không phải WEBP (vd AVI) → null", () => {
    const avi = new Uint8Array(WEBP);
    avi.set([0x41, 0x56, 0x49, 0x20], 8); // "AVI "
    expect(sniffImageMime(avi)).toBeNull();
  });

  it("byte đầu đúng nhưng lệch 1 byte giữa chừng → null (không so lỏng)", () => {
    const brokenPng = new Uint8Array(PNG);
    brokenPng[4] = 0x00; // hỏng \r
    expect(sniffImageMime(brokenPng)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("[US-11] assertChatUploadFiles — cỡ / số lượng / định dạng", () => {
  it("3 ảnh hợp lệ (jpg+png+webp) → trả mime đã sniff, không throw", () => {
    const mimes = assertChatUploadFiles([
      file(),
      file({ fileName: "a.png", mimeType: "image/png", headBase64: b64(PNG) }),
      file({ fileName: "a.webp", mimeType: "image/webp", headBase64: b64(WEBP) }),
    ]);
    expect(mimes).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  it("0 ảnh → NO_FILES", () => {
    expect(() => assertChatUploadFiles([])).toThrow(ChatAttachmentError);
    try {
      assertChatUploadFiles([]);
    } catch (e) {
      expect((e as ChatAttachmentError).code).toBe("NO_FILES");
      expect((e as ChatAttachmentError).status).toBe(400);
    }
  });

  it("6 ảnh/tin → TOO_MANY_FILES (413), chặn TRƯỚC khi soi từng file", () => {
    const six = Array.from({ length: 6 }, () => file());
    expect(CHAT_IMAGE_RULES.maxFilesPerMessage).toBe(5);
    try {
      assertChatUploadFiles(six);
      throw new Error("phải throw");
    } catch (e) {
      expect((e as ChatAttachmentError).code).toBe("TOO_MANY_FILES");
      expect((e as ChatAttachmentError).status).toBe(413);
      expect((e as ChatAttachmentError).message).toContain("5");
    }
  });

  it("12MB → FILE_TOO_LARGE (413), thông điệp nêu mốc 10MB", () => {
    expect(CHAT_IMAGE_RULES.maxSizeBytes).toBe(10 * 1024 * 1024);
    try {
      assertChatUploadFiles([file({ sizeBytes: 12 * 1024 * 1024 })]);
      throw new Error("phải throw");
    } catch (e) {
      expect((e as ChatAttachmentError).code).toBe("FILE_TOO_LARGE");
      expect((e as ChatAttachmentError).status).toBe(413);
      expect((e as ChatAttachmentError).message).toContain("10MB");
    }
  });

  it("sizeBytes ≤ 0 / không nguyên → INVALID_FILE (400)", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      try {
        assertChatUploadFiles([file({ sizeBytes: bad })]);
        throw new Error("phải throw");
      } catch (e) {
        expect((e as ChatAttachmentError).code).toBe("INVALID_FILE");
      }
    }
  });

  it("heic → UNSUPPORTED_MEDIA_TYPE (415) đúng thông điệp 'Định dạng chưa hỗ trợ' (AC5)", () => {
    try {
      assertChatUploadFiles([
        file({ fileName: "IMG_0001.heic", mimeType: "image/heic", headBase64: b64(HEIC) }),
      ]);
      throw new Error("phải throw");
    } catch (e) {
      expect((e as ChatAttachmentError).code).toBe("UNSUPPORTED_MEDIA_TYPE");
      expect((e as ChatAttachmentError).status).toBe(415);
      expect((e as ChatAttachmentError).message).toContain("Định dạng chưa hỗ trợ");
    }
  });

  it("pdf → UNSUPPORTED_MEDIA_TYPE cùng thông điệp (AC5)", () => {
    try {
      assertChatUploadFiles([
        file({ fileName: "bang-diem.pdf", mimeType: "application/pdf", headBase64: b64(PDF) }),
      ]);
      throw new Error("phải throw");
    } catch (e) {
      expect((e as ChatAttachmentError).code).toBe("UNSUPPORTED_MEDIA_TYPE");
      expect((e as ChatAttachmentError).message).toContain("Định dạng chưa hỗ trợ");
    }
  });

  it("virus.exe đổi tên .jpg + khai image/jpeg → 415 (đuôi + mime khai đều nói dối)", () => {
    try {
      assertChatUploadFiles([
        file({ fileName: "virus.jpg", mimeType: "image/jpeg", headBase64: b64(EXE) }),
      ]);
      throw new Error("phải throw");
    } catch (e) {
      expect((e as ChatAttachmentError).code).toBe("UNSUPPORTED_MEDIA_TYPE");
      expect((e as ChatAttachmentError).status).toBe(415);
    }
  });

  it("khai image/png nhưng ruột là JPEG → 415 (mime khai phải khớp magic bytes)", () => {
    try {
      assertChatUploadFiles([file({ fileName: "a.png", mimeType: "image/png" })]);
      throw new Error("phải throw");
    } catch (e) {
      expect((e as ChatAttachmentError).code).toBe("UNSUPPORTED_MEDIA_TYPE");
    }
  });

  it("headBase64 rỗng / rác → 415 (không cho qua vì 'không đọc được đầu file')", () => {
    for (const head of ["", "!!!not-base64!!!", b64(new Uint8Array([0x00]))]) {
      try {
        assertChatUploadFiles([file({ headBase64: head })]);
        throw new Error("phải throw");
      } catch (e) {
        expect((e as ChatAttachmentError).code).toBe("UNSUPPORTED_MEDIA_TYPE");
      }
    }
  });

  it("kiểm cỡ TRƯỚC định dạng: file 12MB heic → 413 (không tốn công decode)", () => {
    try {
      assertChatUploadFiles([
        file({ sizeBytes: 12 * 1024 * 1024, mimeType: "image/heic", headBase64: b64(HEIC) }),
      ]);
      throw new Error("phải throw");
    } catch (e) {
      expect((e as ChatAttachmentError).code).toBe("FILE_TOO_LARGE");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("[US-11] buildChatAttachmentKey / sanitizeChatFileName", () => {
  it("key đúng khuôn chat-attachments/{conv}/{yyyy-MM}/{uuid}{ext}", () => {
    const key = buildChatAttachmentKey({
      conversationId: CONV,
      mime: "image/webp",
      objectId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      now: new Date("2026-08-09T23:30:00.000Z"),
    });
    expect(key).toBe(
      `chat-attachments/${CONV}/2026-08/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp`,
    );
  });

  it("đuôi lấy từ mime ĐÃ SNIFF, không lấy từ tên người dùng", () => {
    const base = { conversationId: CONV, objectId: "11111111-2222-4333-8444-555555555555" };
    expect(buildChatAttachmentKey({ ...base, mime: "image/jpeg" })).toMatch(/\.jpg$/);
    expect(buildChatAttachmentKey({ ...base, mime: "image/png" })).toMatch(/\.png$/);
    expect(buildChatAttachmentKey({ ...base, mime: "image/webp" })).toMatch(/\.webp$/);
  });

  it("conversationId có ký tự lạ (path traversal) → throw, không dựng key", () => {
    expect(() =>
      buildChatAttachmentKey({
        conversationId: "../../secret",
        mime: "image/jpeg",
        objectId: "11111111-2222-4333-8444-555555555555",
      }),
    ).toThrow();
  });

  it("sanitizeChatFileName cắt đường dẫn, giữ tên hiển thị", () => {
    expect(sanitizeChatFileName("../../etc/passwd.jpg", "image/jpeg")).toBe("passwd.jpg");
    expect(sanitizeChatFileName("C:\\Users\\phuc\\anh vui.png", "image/png")).toBe("anh vui.png");
    expect(sanitizeChatFileName("   ", "image/webp")).toBe("anh.webp");
    expect(sanitizeChatFileName("a".repeat(400) + ".jpg", "image/jpeg").length).toBeLessThanOrEqual(
      120,
    );
    // ký tự điều khiển / xuống dòng bị loại (chống log-injection khi in tên file)
    expect(sanitizeChatFileName("anh\n\r\u0000.png", "image/png")).toBe("anh.png");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("[US-11] createChatUploadTicket — guard trước, ký sau", () => {
  it("participant hiệu lực + ảnh hợp lệ → ticket có storagePath + uploadUrl", async () => {
    const r = await createChatUploadTicket({
      conversationId: CONV,
      userId: USER,
      files: [file({ fileName: "../../anh cua con.jpg" })],
    });
    expect(r.tickets).toHaveLength(1);
    const t = r.tickets[0]!;
    expect(t.storagePath).toMatch(
      new RegExp(`^chat-attachments/${CONV}/\\d{4}-\\d{2}/[0-9a-f-]{36}\\.jpg$`),
    );
    // AC bảo mật: KHÔNG nhúng tên người dùng vào key; tên gốc chỉ nằm ở fileName.
    expect(t.storagePath).not.toContain("anh cua con");
    expect(t.storagePath).not.toContain("..");
    expect(t.fileName).toBe("anh cua con.jpg");
    expect(t.uploadUrl).toContain(t.storagePath);
    expect(t.mimeType).toBe("image/jpeg");
    expect(t.expiresIn).toBe(CHAT_IMAGE_RULES.uploadUrlTtlSeconds);
  });

  it("không phải participant → NOT_PARTICIPANT (403)", async () => {
    state.part = null;
    await expect(
      createChatUploadTicket({ conversationId: CONV, userId: USER, files: [file()] }),
    ).rejects.toMatchObject({ code: "NOT_PARTICIPANT", status: 403 });
  });

  it("đã rời nhóm (leftAt set) → NOT_PARTICIPANT", async () => {
    state.part = { leftAt: new Date("2026-08-01T00:00:00.000Z") };
    await expect(
      createChatUploadTicket({ conversationId: CONV, userId: USER, files: [file()] }),
    ).rejects.toMatchObject({ code: "NOT_PARTICIPANT" });
  });

  it("hội thoại không tồn tại → CONVERSATION_NOT_FOUND (404)", async () => {
    state.conv = null;
    await expect(
      createChatUploadTicket({ conversationId: CONV, userId: USER, files: [file()] }),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND", status: 404 });
  });

  it("ARCHIVED / LOCKED → từ chối đúng mã riêng như F-SEND", async () => {
    state.conv = { id: CONV, status: "ARCHIVED" };
    await expect(
      createChatUploadTicket({ conversationId: CONV, userId: USER, files: [file()] }),
    ).rejects.toMatchObject({ code: "CONVERSATION_ARCHIVED", status: 403 });

    state.conv = { id: CONV, status: "LOCKED" };
    await expect(
      createChatUploadTicket({ conversationId: CONV, userId: USER, files: [file()] }),
    ).rejects.toMatchObject({ code: "CONVERSATION_LOCKED", status: 403 });
  });

  it("người ngoài gửi file rác → 403 quyền TRƯỚC 415 định dạng (không rò 'file của bạn sai gì')", async () => {
    state.part = null;
    await expect(
      createChatUploadTicket({
        conversationId: CONV,
        userId: USER,
        files: [file({ headBase64: b64(EXE) })],
      }),
    ).rejects.toMatchObject({ code: "NOT_PARTICIPANT" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("[US-11] getChatAttachmentReadUrl — signed GET 5 phút (TS-14.2/14.4)", () => {
  const ATT = {
    id: "att-1",
    storagePath: `chat-attachments/${CONV}/2026-08/aaaa.jpg`,
    fileName: "anh.jpg",
    mimeType: "image/jpeg",
    message: { conversationId: CONV, deletedAt: null as Date | null },
  };

  it("participant → URL ký hạn ĐÚNG 300s", async () => {
    state.att = { ...ATT, message: { ...ATT.message } };
    const r = await getChatAttachmentReadUrl("att-1", USER);
    expect(CHAT_IMAGE_RULES.readUrlTtlSeconds).toBe(300);
    expect(r.url).toContain("X-Amz-Expires=300");
    expect(r.url).toContain(ATT.storagePath);
    expect(r.expiresIn).toBe(300);
    expect(r.expiresAt.getTime() - Date.now()).toBeGreaterThan(290_000);
  });

  it("hội thoại ARCHIVED vẫn XEM được ảnh (permissions.md: ARCHIVED đọc ✅)", async () => {
    state.conv = { id: CONV, status: "ARCHIVED" };
    state.att = { ...ATT, message: { ...ATT.message } };
    await expect(getChatAttachmentReadUrl("att-1", USER)).resolves.toMatchObject({
      mimeType: "image/jpeg",
    });
  });

  it("không phải participant của hội thoại chứa ảnh → NOT_PARTICIPANT (TS-14.2)", async () => {
    state.att = { ...ATT, message: { ...ATT.message } };
    state.part = null;
    await expect(getChatAttachmentReadUrl("att-1", USER)).rejects.toMatchObject({
      code: "NOT_PARTICIPANT",
      status: 403,
    });
  });

  it("tin chứa ảnh đã bị gỡ → MESSAGE_DELETED (TS-14.4 / F-DEL)", async () => {
    state.att = { ...ATT, message: { conversationId: CONV, deletedAt: new Date() } };
    await expect(getChatAttachmentReadUrl("att-1", USER)).rejects.toMatchObject({
      code: "MESSAGE_DELETED",
      status: 403,
    });
  });

  it("ảnh không tồn tại → ATTACHMENT_NOT_FOUND (404)", async () => {
    state.att = null;
    await expect(getChatAttachmentReadUrl("khong-co", USER)).rejects.toMatchObject({
      code: "ATTACHMENT_NOT_FOUND",
      status: 404,
    });
  });

  it("người ngoài hỏi ảnh của tin đã gỡ → vẫn 403 vì quyền (kiểm quyền trước)", async () => {
    state.att = { ...ATT, message: { conversationId: CONV, deletedAt: new Date() } };
    state.part = null;
    await expect(getChatAttachmentReadUrl("att-1", USER)).rejects.toMatchObject({
      code: "NOT_PARTICIPANT",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Kho ảnh chat PHẢI tách khỏi bucket công khai (cdn.satarobo.vn).
// Nếu ảnh nằm ở bucket có custom domain thì signed URL vô nghĩa: URL ký chứa
// nguyên key ⇒ ghép `https://cdn.satarobo.vn/<key>` là có bản vĩnh viễn, không
// chữ ký, không hạn 5 phút, tải được cả SAU KHI tin bị gỡ. Phá thẳng
// flows.md:51-52,63 + US-12 AC5 + Q2 (00-dieu-chinh-cho-repo.md).
// Bộ test dưới đây chốt: đổi `getChatBucket()` → `getR2Bucket()` là ĐỎ.
// ═══════════════════════════════════════════════════════════════════════════
describe("[SEC][US-11] ảnh chat nằm ở bucket RIÊNG, không phải bucket công khai", () => {
  const ATT = {
    id: "att-1",
    storagePath: `chat-attachments/${CONV}/2026-08/aaaa.jpg`,
    fileName: "anh.jpg",
    mimeType: "image/jpeg",
    message: { conversationId: CONV, deletedAt: null as Date | null },
  };

  it("PUT được ký vào R2_CHAT_BUCKET_NAME, KHÔNG phải R2_BUCKET_NAME", async () => {
    const r = await createChatUploadTicket({
      conversationId: CONV,
      userId: USER,
      files: [file()],
    });
    expect(h.presign).toHaveLength(1);
    expect(h.presign[0]!.bucket).toBe(CHAT_BUCKET);
    expect(h.presign[0]!.bucket).not.toBe(PUBLIC_BUCKET);
    expect(r.tickets[0]!.uploadUrl).toContain(CHAT_BUCKET);
    expectPublicStorageUntouched();
  });

  it("GET được ký vào R2_CHAT_BUCKET_NAME (không đi qua signedMediaUrl)", async () => {
    state.att = { ...ATT, message: { ...ATT.message } };
    const r = await getChatAttachmentReadUrl("att-1", USER);
    expect(h.presign).toHaveLength(1);
    expect(h.presign[0]!.bucket).toBe(CHAT_BUCKET);
    expect(h.presign[0]!.expiresIn).toBe(300);
    expect(r.url).toContain(CHAT_BUCKET);
    expectPublicStorageUntouched();
  });

  it("URL cấp cho người dùng KHÔNG chứa host công khai R2_PUBLIC_URL", async () => {
    const put = await createChatUploadTicket({
      conversationId: CONV,
      userId: USER,
      files: [file()],
    });
    state.att = { ...ATT, message: { ...ATT.message } };
    const get = await getChatAttachmentReadUrl("att-1", USER);
    for (const url of [put.tickets[0]!.uploadUrl, get.url]) {
      expect(url).not.toContain(PUBLIC_HOST);
      expect(url).not.toContain(process.env.R2_PUBLIC_URL!);
      expect(url).not.toContain(PUBLIC_BUCKET);
    }
  });

  it("thiếu R2_CHAT_BUCKET_NAME → 503, TUYỆT ĐỐI không rơi về bucket công khai", async () => {
    delete process.env.R2_CHAT_BUCKET_NAME;
    expect(isChatStorageConfigured()).toBe(false);

    await expect(
      createChatUploadTicket({ conversationId: CONV, userId: USER, files: [file()] }),
    ).rejects.toMatchObject({ code: "STORAGE_NOT_CONFIGURED", status: 503 });

    state.att = { ...ATT, message: { ...ATT.message } };
    await expect(getChatAttachmentReadUrl("att-1", USER)).rejects.toMatchObject({
      code: "STORAGE_NOT_CONFIGURED",
      status: 503,
    });

    // Không ký gì cả — và nhất là không hỏi bucket công khai để "chữa cháy".
    expect(h.presign).toHaveLength(0);
    expectPublicStorageUntouched();
  });

  it("R2_CHAT_BUCKET_NAME bị trỏ ĐÚNG vào bucket công khai → vẫn 503 (chặn cấu hình sai)", async () => {
    process.env.R2_CHAT_BUCKET_NAME = PUBLIC_BUCKET;
    expect(isChatStorageConfigured()).toBe(false);
    await expect(
      createChatUploadTicket({ conversationId: CONV, userId: USER, files: [file()] }),
    ).rejects.toMatchObject({ code: "STORAGE_NOT_CONFIGURED", status: 503 });
    expect(h.presign).toHaveLength(0);
  });

  it("isChatStorageConfigured KHÔNG còn phụ thuộc R2_PUBLIC_URL / R2_BUCKET_NAME", async () => {
    delete process.env.R2_PUBLIC_URL;
    delete process.env.R2_BUCKET_NAME;
    expect(isChatStorageConfigured()).toBe(true);
    const r = await createChatUploadTicket({
      conversationId: CONV,
      userId: USER,
      files: [file()],
    });
    expect(r.tickets[0]!.uploadUrl).toContain(CHAT_BUCKET);
    expectPublicStorageUntouched();
  });

  it("thiếu credential R2 → isChatStorageConfigured false (fail closed)", () => {
    delete process.env.R2_SECRET_ACCESS_KEY;
    expect(isChatStorageConfigured()).toBe(false);
  });
});
