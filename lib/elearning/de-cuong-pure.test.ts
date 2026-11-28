/** [DCP-*] Phần thuần của trang Đề cương khoá. Ngày TUYỆT ĐỐI, không đọc đồng hồ (luật 19). */
import { describe, expect, it } from "vitest";
import { dongGiaHan, dongHoanThanh, moTaThoiLuongBai, tinhTienDoBatBuoc, uocLuongPhutDoc } from "./de-cuong-pure";

const khong = { durationSec: null, minReadSeconds: null, soCau: null };

describe("[DCP-01] moTaThoiLuongBai", () => {
  it("video: làm tròn phút; tối thiểu 1 phút", () => {
    expect(moTaThoiLuongBai("VIDEO", { ...khong, durationSec: 720 })).toBe("Video · 12 phút");
    expect(moTaThoiLuongBai("VIDEO", { ...khong, durationSec: 20 })).toBe("Video · 1 phút");
  });
  it("kiểm tra: số câu; không có đề ⇒ không bịa số", () => {
    expect(moTaThoiLuongBai("QUIZ", { ...khong, soCau: 13 })).toBe("Bài kiểm tra · 13 câu");
    expect(moTaThoiLuongBai("QUIZ", khong)).toBeNull();
  });
  it("bài đọc nói đúng nghĩa 'đọc tối thiểu' (không phải độ dài bài)", () => {
    expect(moTaThoiLuongBai("READ", { ...khong, minReadSeconds: 180 })).toBe("Bài đọc · đọc tối thiểu 3 phút");
  });
  it("loại không có số đo (bài tập, buổi trực tiếp) và loại lạ ⇒ null", () => {
    expect(moTaThoiLuongBai("TASK", khong)).toBeNull();
    expect(moTaThoiLuongBai("LIVE_SESSION", khong)).toBeNull();
    expect(moTaThoiLuongBai("LA", khong)).toBeNull();
  });
});

describe("[DCP-02] dongGiaHan — chỉ khi hạn thật sự dời ra sau", () => {
  const goc = new Date("2026-11-01T10:00:00.000Z");
  const moi = new Date("2026-11-04T10:00:00.000Z");
  it("dời ra sau kèm lý do", () => {
    expect(dongGiaHan({ dueAt: moi, dueAtOriginal: goc, extensionReason: " Sự cố " })).toBe(
      "Hạn của bạn đã được gia hạn đến 04/11/2026 (hạn ban đầu 01/11/2026). Lý do: Sự cố",
    );
  });
  it("không lý do ⇒ không in 'Lý do:'", () => {
    expect(dongGiaHan({ dueAt: moi, dueAtOriginal: goc, extensionReason: null })).not.toContain("Lý do");
  });
  it("hạn bằng/ sớm hơn hạn gốc, hoặc thiếu một đầu ⇒ null", () => {
    expect(dongGiaHan({ dueAt: goc, dueAtOriginal: goc, extensionReason: "x" })).toBeNull();
    expect(dongGiaHan({ dueAt: goc, dueAtOriginal: moi, extensionReason: "x" })).toBeNull();
    expect(dongGiaHan({ dueAt: null, dueAtOriginal: goc, extensionReason: "x" })).toBeNull();
  });
});

describe("[DCP-03] dongHoanThanh", () => {
  it("có ngày ⇒ câu có ngày; không có ⇒ null (không bịa)", () => {
    expect(dongHoanThanh(new Date("2026-11-01T03:00:00.000Z"))).toBe("Bạn đã hoàn thành khoá ngày 01/11/2026.");
    expect(dongHoanThanh(null)).toBeNull();
  });
});

describe("[DCP-04] tinhTienDoBatBuoc — MỘT định nghĩa n/m", () => {
  const bai = ["a", "b", "c", "d"];
  it("bài không có dòng phiên bản ⇒ coi là bắt buộc (mặc định phía chặt)", () => {
    expect(tinhTienDoBatBuoc(bai, new Map(), new Set(["a"]))).toEqual({ xong: 1, tong: 4 });
  });
  it("bài required=false không tính vào n lẫn m", () => {
    expect(tinhTienDoBatBuoc(bai, new Map([["b", false]]), new Set(["a", "b"]))).toEqual({ xong: 1, tong: 3 });
  });
  it("bài xong không thuộc khoá (id lạ) không làm n vượt m", () => {
    const r = tinhTienDoBatBuoc(bai, new Map(), new Set(["a", "zzz"]));
    expect(r.xong).toBeLessThanOrEqual(r.tong);
  });
  it("khoá không có bài ⇒ tong 0", () => {
    expect(tinhTienDoBatBuoc([], new Map(), new Set())).toEqual({ xong: 0, tong: 0 });
  });
});

describe("[DCP-05] uocLuongPhutDoc", () => {
  const tu = (n: number) => Array.from({ length: n }, (_, i) => `từ${i}`).join(" ");
  it("200 từ/phút, làm tròn LÊN, tối thiểu 1 phút", () => {
    expect(uocLuongPhutDoc(tu(200))).toBe(1);
    expect(uocLuongPhutDoc(tu(201))).toBe(2);
    expect(uocLuongPhutDoc(tu(1200))).toBe(6);
    expect(uocLuongPhutDoc("ngắn thôi")).toBe(1);
  });
  it("ký hiệu Markdown đứng riêng ('-', '>', '#') không tính là từ", () => {
    // 200 từ thật + ba ký hiệu đứng riêng: nếu ký hiệu bị đếm thì ra 203 từ ⇒ 2 phút
    expect(uocLuongPhutDoc(`# ${tu(100)}\n\n- ${tu(100)}\n\n> `)).toBe(1);
  });
  it("nội dung trống / chỉ ký hiệu ⇒ null (không bịa)", () => {
    expect(uocLuongPhutDoc("")).toBeNull();
    expect(uocLuongPhutDoc(null)).toBeNull();
    expect(uocLuongPhutDoc("# \n- \n> ")).toBeNull();
  });
});
