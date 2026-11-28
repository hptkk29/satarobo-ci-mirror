import { describe, expect, it } from "vitest";
import { duDieuKienXemMienPhi, keHoachXemMienPhi, nhanBaiDangMienPhi, soBaiDauDangMienPhi, soBaiDuDieuKienXemMienPhi, type ChuongXemMienPhi } from "./xem-mien-phi";

const b = (id: string, kind = "VIDEO", o: { hidden?: boolean; freePreview?: boolean } = {}) => ({ id, kind, hidden: o.hidden ?? false, freePreview: o.freePreview ?? false });

const BO_CUC: ChuongXemMienPhi[] = [
  { hidden: false, lessons: [b("a1"), b("a2", "READ"), b("a3", "QUIZ")] },
  { hidden: false, lessons: [b("b1"), b("b2", "VIDEO", { hidden: true }), b("b3", "ASSIGNMENT")] },
  { hidden: false, lessons: [b("c1", "FINAL_EXAM")] },
];

describe("[XMP] xem miễn phí N bài đầu — kế hoạch đổi cờ", () => {
  it("[XMP-01] N=3 ⇒ ba bài ĐỦ ĐIỀU KIỆN đầu (a1, a2, b1) được bật; bài kiểm tra và bài ẩn không chiếm suất", () => {
    expect(keHoachXemMienPhi(BO_CUC, 3)).toEqual([
      { lessonId: "a1", freePreview: true },
      { lessonId: "a2", freePreview: true },
      { lessonId: "b1", freePreview: true },
    ]);
  });

  it("[XMP-02] chỉ trả bài ĐANG LỆCH — bài đã đúng thì không ghi lại; bài đủ điều kiện nằm ngoài N bị TẮT", () => {
    const cu: ChuongXemMienPhi[] = [{ hidden: false, lessons: [b("a1", "VIDEO", { freePreview: true }), b("a2", "READ", { freePreview: true }), b("a3", "READ", { freePreview: true })] }];
    expect(keHoachXemMienPhi(cu, 2)).toEqual([{ lessonId: "a3", freePreview: false }]);
    expect(keHoachXemMienPhi(cu, 3)).toEqual([]);
  });

  it("[XMP-03] N=0 tắt hết; N lớn hơn số bài đủ điều kiện thì bật tất cả bài đủ điều kiện, KHÔNG đụng bài kiểm tra/ẩn", () => {
    const co: ChuongXemMienPhi[] = [{ hidden: false, lessons: [b("a1", "VIDEO", { freePreview: true }), b("a2", "READ", { freePreview: true })] }];
    expect(keHoachXemMienPhi(co, 0)).toEqual([{ lessonId: "a1", freePreview: false }, { lessonId: "a2", freePreview: false }]);
    expect(keHoachXemMienPhi(BO_CUC, 99).map((x) => x.lessonId)).toEqual(["a1", "a2", "b1", "b3"]);
  });

  it("[XMP-04] bài không đủ điều kiện (kiểm tra · thi cuối · bài ẩn · chương ẩn) không bao giờ xuất hiện trong kế hoạch, kể cả khi đang bật tay", () => {
    const co: ChuongXemMienPhi[] = [
      { hidden: false, lessons: [b("q", "QUIZ", { freePreview: true }), b("h", "VIDEO", { hidden: true, freePreview: true }), b("v")] },
      { hidden: true, lessons: [b("x", "VIDEO", { freePreview: true })] },
    ];
    expect(keHoachXemMienPhi(co, 0)).toEqual([]);
    expect(keHoachXemMienPhi(co, 5)).toEqual([{ lessonId: "v", freePreview: true }]);
  });

  it("[XMP-06] ô mặc định 'N bài đầu': đếm bài đủ điều kiện miễn phí LIÊN TIẾP từ đầu — miễn phí rời rạc (chỉ bài sau) ⇒ 0, bỏ qua bài kiểm tra/ẩn ở giữa", () => {
    const lien: ChuongXemMienPhi[] = [{ hidden: false, lessons: [b("a1", "VIDEO", { freePreview: true }), b("a2", "QUIZ"), b("a3", "READ", { freePreview: true }), b("a4", "READ")] }];
    expect(soBaiDauDangMienPhi(lien), "quiz ở giữa không cắt chuỗi").toBe(2);
    const roiRac: ChuongXemMienPhi[] = [{ hidden: false, lessons: [b("a1"), b("a2", "READ", { freePreview: true })] }];
    expect(soBaiDauDangMienPhi(roiRac), "chỉ bài thứ hai miễn phí ⇒ chưa có 'bài đầu tiên' nào").toBe(0);
    expect(soBaiDauDangMienPhi([])).toBe(0);
  });

  it("[XMP-05] đếm bài đủ điều kiện + nhãn bài đang miễn phí theo chương.bài", () => {
    expect(soBaiDuDieuKienXemMienPhi(BO_CUC)).toBe(4);
    expect(duDieuKienXemMienPhi(BO_CUC[0]!, BO_CUC[0]!.lessons[2]!)).toBe(false);
    expect(nhanBaiDangMienPhi([{ hidden: false, lessons: [b("a", "VIDEO", { freePreview: true }), b("b")] }, { hidden: false, lessons: [b("c", "READ", { freePreview: true })] }])).toEqual(["1.1", "2.1"]);
  });
});
