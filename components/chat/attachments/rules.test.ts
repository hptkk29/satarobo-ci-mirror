/**
 * US-11 — tầng THUẦN phía client của luồng gửi ảnh.
 *
 * Đây là phép lịch sự với người dùng (báo sai sớm), KHÔNG phải cửa chặn: cửa chặn nằm ở
 * `assertChatUploadFiles` (sniff magic bytes) và `checkAttachmentPaths` (khi ghi tin).
 * Test ở đây giữ cho phép lịch sự đó không nói sai — báo "quá 5 ảnh" trong khi thật ra
 * file sai định dạng là kiểu thông điệp khiến phụ huynh loay hoay không hiểu vì sao.
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_IMAGE_ACCEPT,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_FILES,
  bytesToBase64,
  formatFileSize,
  pickChatImages,
} from "./rules";

/** Hàm chỉ đọc `name`/`type`/`size` — không cần dựng file 10MB thật trong test. */
function file(name: string, type: string, size = 1024): File {
  return { name, type, size } as unknown as File;
}

describe("[US-11] pickChatImages — lọc file trước khi upload", () => {
  it("ảnh jpg/png/webp hợp lệ → nhận hết, không lỗi", () => {
    const res = pickChatImages(0, [
      file("a.jpg", "image/jpeg"),
      file("b.png", "image/png"),
      file("c.webp", "image/webp"),
    ]);
    expect(res.accepted).toHaveLength(3);
    expect(res.error).toBeNull();
  });

  it("heic/pdf → loại kèm thông điệp 'Định dạng chưa hỗ trợ' (AC5)", () => {
    const res = pickChatImages(0, [file("x.heic", "image/heic"), file("y.pdf", "application/pdf")]);
    expect(res.accepted).toHaveLength(0);
    expect(res.error).toMatch(/Định dạng chưa hỗ trợ/);
  });

  it("đổi đuôi file KHÔNG lách được ở client (mime rỗng vẫn rụng) — server còn sniff lần nữa", () => {
    const res = pickChatImages(0, [file("virus.jpg", "")]);
    expect(res.accepted).toHaveLength(0);
    expect(res.error).toMatch(/Định dạng chưa hỗ trợ/);
  });

  it("ảnh quá 10MB → loại, thông điệp nói rõ tên ảnh", () => {
    const res = pickChatImages(0, [file("to.jpg", "image/jpeg", CHAT_IMAGE_MAX_BYTES + 1)]);
    expect(res.accepted).toHaveLength(0);
    expect(res.error).toContain("to.jpg");
  });

  it("ảnh đúng 10MB → vẫn nhận (biên không lệch 1)", () => {
    const res = pickChatImages(0, [file("vua.jpg", "image/jpeg", CHAT_IMAGE_MAX_BYTES)]);
    expect(res.accepted).toHaveLength(1);
    expect(res.error).toBeNull();
  });

  it(`trần ${CHAT_IMAGE_MAX_FILES} ảnh tính trên CẢ TIN, không chỉ lượt chọn`, () => {
    const res = pickChatImages(4, [
      file("a.jpg", "image/jpeg"),
      file("b.jpg", "image/jpeg"),
      file("c.jpg", "image/jpeg"),
    ]);
    expect(res.accepted).toHaveLength(1);
    expect(res.error).toContain(String(CHAT_IMAGE_MAX_FILES));
  });

  it("đã đủ 5 ảnh → không nhận thêm ảnh nào", () => {
    const res = pickChatImages(CHAT_IMAGE_MAX_FILES, [file("a.jpg", "image/jpeg")]);
    expect(res.accepted).toHaveLength(0);
  });

  it("sai định dạng được báo TRƯỚC 'quá số lượng' — không đổ lỗi nhầm cho người dùng", () => {
    const res = pickChatImages(CHAT_IMAGE_MAX_FILES, [file("x.pdf", "application/pdf")]);
    expect(res.error).toMatch(/Định dạng chưa hỗ trợ/);
  });

  it("mime có charset / viết hoa vẫn nhận (Image/JPEG; x=1)", () => {
    expect(pickChatImages(0, [file("a.jpg", "Image/JPEG; x=1")]).accepted).toHaveLength(1);
  });

  it("thuộc tính accept của input chỉ liệt kê đúng 3 định dạng của gói cắt", () => {
    expect(CHAT_IMAGE_ACCEPT).toBe("image/jpeg,image/png,image/webp");
  });
});

describe("[US-11] bytesToBase64 — phần đầu file gửi cho server sniff", () => {
  it("mã hoá đúng magic bytes của JPEG", () => {
    expect(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("/9j/");
  });

  it("mảng rỗng → chuỗi rỗng (server tự coi là không sniff được)", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });
});

describe("[US-11] formatFileSize", () => {
  it("hiển thị KB/MB kiểu Việt Nam", () => {
    expect(formatFileSize(900)).toBe("900 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1_500_000)).toBe("1,4 MB");
  });

  it("số vô nghĩa → chuỗi rỗng (không in 'NaN' lên màn hình người dùng)", () => {
    expect(formatFileSize(0)).toBe("");
    expect(formatFileSize(Number.NaN)).toBe("");
  });
});
