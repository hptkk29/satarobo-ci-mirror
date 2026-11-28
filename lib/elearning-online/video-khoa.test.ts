import { describe, expect, it } from "vitest";
import { kiemNoiDungBai } from "./noi-dung";
import { khoaVideoOnline, laKhoaVideoOnlineHopLe } from "./video-khoa";

describe("[VK-01] khoá video Online: danh sách TRẮNG trong bucket dùng chung với video giáo trình/SCORM/bài nộp/phôi", () => {
  it("nhận khoá đúng vùng và đúng quy ước đặt khoá", () => {
    expect(laKhoaVideoOnlineHopLe("online/video/c1/b1/abc123.mp4")).toBe(true);
    expect(laKhoaVideoOnlineHopLe(khoaVideoOnline("khoa1", "bai1", "m9", "webm"))).toBe(true);
    expect(laKhoaVideoOnlineHopLe("online/video/c1/m.MOV".toLowerCase())).toBe(true);
  });
  it.each([
    ["video giáo trình Offline", "sata3/video1.mp4"],
    ["gói SCORM", "scorm/pkg-1/res/video1.mp4"],
    ["bài nộp của học viên khác", "online/sp/c1/hv2/sa-ban.mp4"],
    ["phôi chứng nhận", "online/cn/c1/abcdef.png"],
    ["leo thư mục", "online/video/c1/../../sp/c1/hv2/x.mp4"],
    ["leo thư mục (đoạn có ..)", "online/video/c1/a..b/x.mp4"],
    ["khoá tuyệt đối", "/online/video/c1/x.mp4"],
    ["URL", "https://cdn.example.com/online/video/c1/x.mp4"],
    ["thiếu thư mục khoá", "online/video/x.mp4"],
    ["đuôi lạ", "online/video/c1/x.exe"],
    ["không đuôi", "online/video/c1/x"],
    ["hai dấu gạch chéo", "online/video/c1//x.mp4"],
    ["rỗng", ""],
    ["không phải chuỗi", 42 as unknown as string],
  ])("từ chối: %s", (_t, ref) => expect(laKhoaVideoOnlineHopLe(ref)).toBe(false));
  it("đường LƯU nội dung bài VIDEO dùng đúng cổng này (và vẫn chặn URL)", () => {
    expect(kiemNoiDungBai("VIDEO", { mediaRef: "online/video/c1/b1/x.mp4" }).ok).toBe(true); // dương
    expect(kiemNoiDungBai("VIDEO", { mediaRef: "scorm/pkg/video1.mp4" }).ok).toBe(false);
    expect(kiemNoiDungBai("VIDEO", { mediaRef: "online/sp/c1/hv/x.mp4" }).ok).toBe(false);
    expect(kiemNoiDungBai("VIDEO", { mediaRef: "https://x.com/v.mp4" }).ok).toBe(false);
  });
});
