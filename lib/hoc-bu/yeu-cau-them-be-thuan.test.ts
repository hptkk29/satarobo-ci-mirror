import { describe, expect, it } from "vitest";
import { beMoiTrongLo, gomTheoLo, laBeDangTrongCase, quyetDinhThemVaoCase, type DongYeuCau } from "./yeu-cau-them-be-thuan";

// [YCT-*] Luật "thêm học viên khác vào case có sẵn phải qua quản lý cơ sở duyệt" (24/10/2026) — phần THUẦN.

const tg = (studentId: string, attendanceStatus: "PENDING" | "PRESENT" | "ABSENT" | "REMOVED") => ({ studentId, attendanceStatus });

describe("quyetDinhThemVaoCase", () => {
  it("[YCT-01] người CÓ quyền duyệt thêm NGAY, kể cả khi có bé mới", () => {
    expect(quyetDinhThemVaoCase({ coQuyenDuyet: true, soBeMoi: 3 })).toBe("NGAY");
    expect(quyetDinhThemVaoCase({ coQuyenDuyet: true, soBeMoi: 0 })).toBe("NGAY");
  });

  it("[YCT-02] người KHÔNG có quyền: có bé mới ⇒ chờ duyệt; chỉ thêm buổi cho bé đã trong case ⇒ ngay", () => {
    expect(quyetDinhThemVaoCase({ coQuyenDuyet: false, soBeMoi: 1 })).toBe("CHO_DUYET");
    expect(quyetDinhThemVaoCase({ coQuyenDuyet: false, soBeMoi: 5 })).toBe("CHO_DUYET");
    expect(quyetDinhThemVaoCase({ coQuyenDuyet: false, soBeMoi: 0 })).toBe("NGAY");
  });
});

describe("beMoiTrongLo", () => {
  it("[YCT-03] bé đã là người tham gia ĐANG HỌC của case không phải bé mới — kể cả đã điểm danh", () => {
    expect(beMoiTrongLo(["a", "b"], [tg("a", "PENDING"), tg("b", "PRESENT")])).toEqual([]);
    expect(beMoiTrongLo(["a"], [tg("a", "ABSENT")])).toEqual([]);
  });

  it("[YCT-04] bé chưa có trong case là bé mới; khử trùng khi một bé có nhiều dòng; giữ thứ tự", () => {
    expect(beMoiTrongLo(["c", "a", "c", "d"], [tg("a", "PENDING")])).toEqual(["c", "d"]);
  });

  it("[YCT-05] bé đã bị GỠ (REMOVED) rồi thêm lại là bé mới — thêm học viên vào case, phải qua duyệt", () => {
    expect(beMoiTrongLo(["a"], [tg("a", "REMOVED")])).toEqual(["a"]);
    expect(laBeDangTrongCase("REMOVED")).toBe(false);
    expect(laBeDangTrongCase("PENDING")).toBe(true);
  });
});

const dong = (p: Partial<DongYeuCau> & { id: string }): DongYeuCau => ({
  batchId: "b1",
  caseId: "c1",
  makeupNeedId: `need-${p.id}`,
  studentId: "s1",
  moRongBai: false,
  proposedById: "u1",
  ...p,
});

describe("gomTheoLo", () => {
  it("[YCT-06] gom theo batchId; một bé nhiều dòng chỉ đếm một lần; moRongBai là OR của cả lô", () => {
    const lo = gomTheoLo([
      dong({ id: "1", studentId: "s1" }),
      dong({ id: "2", studentId: "s1", moRongBai: true }),
      dong({ id: "3", studentId: "s2" }),
      dong({ id: "4", batchId: "b2", caseId: "c2", studentId: "s3", proposedById: "u2" }),
    ]);
    expect(lo.map((l) => l.batchId)).toEqual(["b1", "b2"]);
    expect(lo[0]).toMatchObject({ needIds: ["need-1", "need-2", "need-3"], studentIds: ["s1", "s2"], moRongBai: true, caseId: "c1", proposedById: "u1" });
    expect(lo[1]).toMatchObject({ needIds: ["need-4"], studentIds: ["s3"], moRongBai: false });
  });

  it("[YCT-07] lô không đồng nhất (khác case hoặc khác người gửi) là dữ liệu hỏng ⇒ ném, không đoán", () => {
    expect(() => gomTheoLo([dong({ id: "1" }), dong({ id: "2", caseId: "c9" })])).toThrow(/không đồng nhất/);
    expect(() => gomTheoLo([dong({ id: "1" }), dong({ id: "2", proposedById: "u9" })])).toThrow(/không đồng nhất/);
  });
});
