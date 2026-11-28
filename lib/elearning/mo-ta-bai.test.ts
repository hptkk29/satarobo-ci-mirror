// @vitest-environment node
/** [MTB-*] QtSoanKhoa — dòng mô tả bài chỉ nói số đo thật. */
import { describe, expect, it } from "vitest";
import { chuThoiLuongDoc, moTaBaiTrongDanBai } from "./mo-ta-bai";

describe("[MTB-01] moTaBaiTrongDanBai", () => {
  it("bài đọc: có ngưỡng ⇒ làm tròn phút (tối thiểu 1); không có ⇒ chỉ nhãn loại", () => {
    expect(moTaBaiTrongDanBai({ kind: "READ", minReadSeconds: 180 })).toBe("Bài đọc · ngưỡng đọc 3 phút");
    expect(moTaBaiTrongDanBai({ kind: "READ", minReadSeconds: 20 })).toBe("Bài đọc · ngưỡng đọc 1 phút");
    expect(moTaBaiTrongDanBai({ kind: "READ", minReadSeconds: 0 })).toBe("Bài đọc");
    expect(moTaBaiTrongDanBai({ kind: "READ" })).toBe("Bài đọc");
  });
  it("video: nguồn YouTube/tải lên + mm:ss; thiếu độ dài thì bỏ, không bịa", () => {
    expect(moTaBaiTrongDanBai({ kind: "VIDEO", youtubeId: "abc", durationSec: 664 })).toBe("Video YouTube · 11:04");
    expect(moTaBaiTrongDanBai({ kind: "VIDEO", videoKey: "k", durationSec: 65 })).toBe("Video tải lên · 1:05");
    expect(moTaBaiTrongDanBai({ kind: "VIDEO", youtubeId: "abc" })).toBe("Video YouTube");
    expect(moTaBaiTrongDanBai({ kind: "VIDEO" })).toBe("Video");
  });
  it("buổi trực tiếp · kiểm tra · bài tập · loại lạ giữ mã thô", () => {
    expect(moTaBaiTrongDanBai({ kind: "LIVE_SESSION" })).toBe("Buổi trực tiếp · điểm danh");
    expect(moTaBaiTrongDanBai({ kind: "QUIZ" })).toBe("Bài kiểm tra");
    expect(moTaBaiTrongDanBai({ kind: "TASK" })).toBe("Bài tập");
    expect(moTaBaiTrongDanBai({ kind: "XYZ" })).toBe("XYZ");
  });
});

describe("[MTB-02] chuThoiLuongDoc", () => {
  it("dưới 1 phút ⇒ giây; từ 1 phút ⇒ phút (+ giây lẻ); âm/lẻ được chuẩn hoá", () => {
    expect(chuThoiLuongDoc(30)).toBe("30 giây");
    expect(chuThoiLuongDoc(59)).toBe("59 giây");
    expect(chuThoiLuongDoc(60)).toBe("1 phút");
    expect(chuThoiLuongDoc(180)).toBe("3 phút");
    expect(chuThoiLuongDoc(90)).toBe("1 phút 30 giây");
    expect(chuThoiLuongDoc(-5)).toBe("0 giây");
    expect(chuThoiLuongDoc(29.6)).toBe("30 giây");
  });
});
