import { beforeEach, describe, expect, it, vi } from "vitest";

const kho = vi.hoisted(() => ({
  doiTuong: new Map<string, { size: number; contentType: string | null; byte: number[] }>(),
  hongHead: false,
  hongDoc: false,
  daDoc: [] as string[],
}));
vi.mock("@/lib/storage/chat-storage", () => ({
  headChatObject: async (key: string) => {
    if (kho.hongHead) throw new Error("R2 down");
    const o = kho.doiTuong.get(key);
    return o ? { size: o.size, contentType: o.contentType } : null;
  },
  docByteDauChat: async (key: string) => {
    kho.daDoc.push(key);
    if (kho.hongDoc) throw new Error("R2 down");
    const o = kho.doiTuong.get(key);
    return o ? new Uint8Array(o.byte) : null;
  },
}));

import { xacMinhTepChatDaTaiLen } from "./xac-minh-tep-da-tai";

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];
const HTML = Array.from("<html><script>alert(1)</script>").map((c) => c.charCodeAt(0));
const EXE = [0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0, 0x04, 0, 0, 0];
const K = (n: number) => `chat-attachments/c/2026-11/o${n}.jpg`;
const dat = (n: number, o: Partial<{ size: number; contentType: string | null; byte: number[] }> = {}) =>
  kho.doiTuong.set(K(n), { size: 1000, contentType: "image/jpeg", byte: JPEG, ...o });
const tep = (n: number, o: Partial<{ mimeType: string; sizeBytes: number }> = {}) => ({ storagePath: K(n), mimeType: "image/jpeg", sizeBytes: 1000, ...o });

beforeEach(() => { kho.doiTuong.clear(); kho.hongHead = false; kho.hongDoc = false; kho.daDoc = []; });

describe("[XMT] SEC-06 — xác minh ảnh chat SAU khi tải lên (web + app dùng chung)", () => {
  it("[XMT-01] ảnh thật JPEG / PNG / WEBP đúng cỡ + Content-Type ⇒ hợp lệ; danh sách rỗng ⇒ hợp lệ", async () => {
    dat(1); dat(2, { contentType: "image/png", byte: PNG }); dat(3, { contentType: "image/webp", byte: WEBP });
    expect(await xacMinhTepChatDaTaiLen([tep(1), tep(2, { mimeType: "image/png" }), tep(3, { mimeType: "image/webp" })])).toBeNull();
    expect(await xacMinhTepChatDaTaiLen([])).toBeNull();
    dat(4, { contentType: "IMAGE/JPEG; charset=x" }); // chuẩn hoá: hoa/thường + tham số
    expect(await xacMinhTepChatDaTaiLen([tep(4, { mimeType: "Image/JPEG" })])).toBeNull();
  });

  it("[XMT-02] 🔴 HTML / EXE ĐỔI TÊN .jpg (khai image/jpeg, Content-Type image/jpeg) ⇒ ATTACHMENT_CONTENT_INVALID — đúng lỗ SEC-06", async () => {
    dat(1, { byte: HTML }); dat(2, { byte: EXE });
    expect((await xacMinhTepChatDaTaiLen([tep(1)]))?.code).toBe("ATTACHMENT_CONTENT_INVALID");
    expect((await xacMinhTepChatDaTaiLen([tep(2)]))?.code).toBe("ATTACHMENT_CONTENT_INVALID");
    dat(3, { contentType: "image/png", byte: JPEG }); // ruột JPEG nhưng khai PNG
    expect((await xacMinhTepChatDaTaiLen([tep(3, { mimeType: "image/png" })]))?.code).toBe("ATTACHMENT_CONTENT_INVALID");
  });

  it("[XMT-03] chưa tải lên ⇒ NOT_UPLOADED; sai cỡ ⇒ SIZE_MISMATCH; Content-Type thật khác khai (hoặc trống) ⇒ TYPE_MISMATCH", async () => {
    expect((await xacMinhTepChatDaTaiLen([tep(9)]))?.code).toBe("ATTACHMENT_NOT_UPLOADED");
    dat(1, { size: 999 });
    expect((await xacMinhTepChatDaTaiLen([tep(1)]))?.code).toBe("ATTACHMENT_SIZE_MISMATCH");
    dat(2, { contentType: "text/html" });
    expect((await xacMinhTepChatDaTaiLen([tep(2)]))?.code).toBe("ATTACHMENT_TYPE_MISMATCH");
    dat(3, { contentType: null });
    expect((await xacMinhTepChatDaTaiLen([tep(3)]))?.code).toBe("ATTACHMENT_TYPE_MISMATCH");
  });

  it("[XMT-04] kho lỗi (HEAD hoặc đọc byte) ⇒ ATTACHMENT_STORAGE_UNAVAILABLE — TỪ CHỐI, không coi «không kiểm được» là hợp lệ", async () => {
    dat(1);
    kho.hongHead = true;
    expect((await xacMinhTepChatDaTaiLen([tep(1)]))?.code).toBe("ATTACHMENT_STORAGE_UNAVAILABLE");
    kho.hongHead = false; kho.hongDoc = true;
    expect((await xacMinhTepChatDaTaiLen([tep(1)]))?.code).toBe("ATTACHMENT_STORAGE_UNAVAILABLE");
  });

  it("[XMT-05] nhiều ảnh: MỘT ảnh xấu là cả tin bị từ chối (kể cả ảnh xấu đứng sau ảnh tốt); đọc byte chỉ khi đã qua HEAD", async () => {
    dat(1); dat(2, { byte: HTML });
    expect((await xacMinhTepChatDaTaiLen([tep(1), tep(2)]))?.code).toBe("ATTACHMENT_CONTENT_INVALID");
    kho.daDoc = [];
    dat(3, { size: 5 });
    await xacMinhTepChatDaTaiLen([tep(3)]);
    expect(kho.daDoc).toEqual([]); // sai cỡ ⇒ dừng trước khi tải byte
  });
});
