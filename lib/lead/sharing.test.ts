// Đợt E (kế hoạch Site Sale, 22/08/2026) — test viết TRƯỚC hiện thực (luật cứng #5).
//
// Chủ dự án chốt Q8 (21/08): **lead độc quyền tuyệt đối** — bỏ tính năng "dùng
// chung lead trong cơ sở".
//
// ⚠️ Đây là ĐẢO một quyết định đã ký của chính chủ dự án (BGĐ câu 10, ký
// 10/07/2026) và tính năng ĐANG CHẠY PROD. Vì vậy gỡ theo 2 pha: ngừng tôn trọng
// cờ ở tầng đọc, **GIỮ cột và dữ liệu**, và để lại đường bật lại bằng env.
import { describe, it, expect } from "vitest";
import { canSeeLead } from "./sharing";

describe("[Đợt E] canSeeLead — lead độc quyền", () => {
  it("chủ lead luôn xem được", () => {
    expect(canSeeLead({ canViewAll: false, isOwner: true, isShared: false, sharingEnabled: false })).toBe(true);
  });

  it("người có quyền xem toàn bộ luôn xem được", () => {
    expect(canSeeLead({ canViewAll: true, isOwner: false, isShared: false, sharingEnabled: false })).toBe(true);
  });

  it("sale khác KHÔNG xem được, kể cả lead đang bật cờ dùng chung", () => {
    // Đây chính là thay đổi hành vi: trước 22/08 ca này TRẢ VỀ true.
    expect(canSeeLead({ canViewAll: false, isOwner: false, isShared: true, sharingEnabled: false })).toBe(false);
  });

  it("sale khác không xem được lead không chia sẻ", () => {
    expect(canSeeLead({ canViewAll: false, isOwner: false, isShared: false, sharingEnabled: false })).toBe(false);
  });

  it("bật lại bằng env → cờ dùng chung có tác dụng như cũ (đường quay lui)", () => {
    expect(canSeeLead({ canViewAll: false, isOwner: false, isShared: true, sharingEnabled: true })).toBe(true);
    expect(canSeeLead({ canViewAll: false, isOwner: false, isShared: false, sharingEnabled: true })).toBe(false);
  });

  it("không có ai đúng điều kiện → từ chối (fail-closed)", () => {
    expect(canSeeLead({ canViewAll: false, isOwner: false, isShared: false, sharingEnabled: true })).toBe(false);
  });
});
