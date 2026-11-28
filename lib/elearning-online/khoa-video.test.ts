import { describe, expect, it } from "vitest";
import { kiemKhoaVideo } from "./khoa-video";
import { laKhoaVideoOnlineHopLe, VUNG_VIDEO_ONLINE } from "./video-khoa";

/**
 * [KVD] Khoá video ở lớp phát (A) = BỌC hàm của Core E (`laKhoaVideoOnlineHopLe`, vùng `online/video/`). Test này khoá hai điều:
 * (1) lớp phát KHÔNG tự đặt vùng/đuôi thứ hai — mọi khoá E bác thì lớp phát cũng bác, mọi khoá E nhận thì nhận (không lệch hai chiều);
 * (2) Content-Type suy từ ĐUÔI, và lý do lỗi ổn định cho log.
 */
describe("[KVD] kiemKhoaVideo (bọc laKhoaVideoOnlineHopLe của E)", () => {
  it("khoá hợp lệ ⇒ ok + Content-Type theo đuôi", () => {
    expect(kiemKhoaVideo("online/video/khoa-1/bai-1/v1.mp4")).toEqual({ ok: true, khoa: "online/video/khoa-1/bai-1/v1.mp4", contentType: "video/mp4" });
    expect(kiemKhoaVideo("online/video/a/v.webm")).toMatchObject({ ok: true, contentType: "video/webm" });
    expect(kiemKhoaVideo("online/video/a.b/c.d/v.mov")).toMatchObject({ ok: true, contentType: "video/quicktime" });
  });

  it("[KVD-E] đồng nhất với hàm của E trên một bộ khoá đủ loại (hợp lệ ⇔ hợp lệ)", () => {
    const bo = [
      "online/video/a/v.mp4", "online/video/v.mp4", "online/video/", VUNG_VIDEO_ONLINE, "online/video/a/b/c/v.mov", "online/video/a/V.MP4", "online/video/a/v.m4v",
      "online/video/../x/v.mp4", "online/video/a/../v.mp4", "online/video//a/v.mp4", "online/video/a//v.mp4", "online/video/.a/v.mp4", "online/video/a/v..mp4",
      "online/video/%2e%2e/a.mp4", "online/video/a b/v.mp4", "online/video/a\\v.mp4", "online/sp/x/v.mp4", "online/cn/x/v.mp4", "scorm/abc/index.mp4",
      "kho-bi-mat/a/v.mp4", "x.mp4", "/online/video/a/v.mp4", "ONLINE/VIDEO/a/v.mp4", `online/video/a/${"x".repeat(101)}.mp4`,
    ];
    for (const k of bo) expect(kiemKhoaVideo(k).ok, k).toBe(laKhoaVideoOnlineHopLe(k));
  });

  it("ngoài vùng (video giáo trình/SCORM, bài nộp, phôi, vùng cũ của A) ⇒ NGOAI_VUNG", () => {
    for (const x of ["scorm/abc/index.mp4", "media/x.mp4", "x.mp4", "kho-bi-mat/a/v.mp4", "online/sp/x/v.mp4", "online/cn/x/v.mp4", "ONLINE/VIDEO/a/v.mp4", "/online/video/a/v.mp4", "online/video\\a/v.mp4"]) {
      expect(kiemKhoaVideo(x), x).toEqual({ ok: false, lyDo: "NGOAI_VUNG" });
    }
  });

  it("trong vùng nhưng khoá xấu (đi-lên-thư-mục, đoạn rỗng/ẩn, ký tự lạ, đuôi ngoài danh sách) ⇒ KHOA_KHONG_HOP_LE", () => {
    for (const x of [
      "online/video/", "online/video/v.mp4", "online/video/../scorm/a.mp4", "online/video/a/../../b.mp4", "online/video/./a/v.mp4", "online/video//a/v.mp4",
      "online/video/a//v.mp4", "online/video/.an/v.mp4", "online/video/%2e%2e/a.mp4", "online/video/..%2fa/v.mp4", "online/video/a b/v.mp4",
      "online/video/a/v.html", "online/video/a/v.js", "online/video/a/v.zip", "online/video/a/v.svg", "online/video/a/v", "online/video/a/v.", "online/video/a/mp4",
      "online/video/a/v.mp4?x=1", "online/video/a/v.mp4#f", "online/video/a/v.M4V", "online/video/a/v.mp4 ",
    ]) {
      expect(kiemKhoaVideo(x), JSON.stringify(x)).toEqual({ ok: false, lyDo: "KHOA_KHONG_HOP_LE" });
    }
  });

  it("rỗng / không phải chuỗi ⇒ RONG; quá dài ⇒ QUA_DAI", () => {
    for (const x of ["", null, undefined, 123, {}, []]) expect(kiemKhoaVideo(x), String(x)).toEqual({ ok: false, lyDo: "RONG" });
    expect(kiemKhoaVideo(`online/video/a/${"a".repeat(300)}.mp4`)).toEqual({ ok: false, lyDo: "QUA_DAI" });
  });
});
