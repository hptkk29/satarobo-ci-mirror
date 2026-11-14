import { describe, expect, it } from "vitest";
import {
  chonMacDinh,
  dungPhieu,
  gomHocPhan,
  laPhieuMoi,
  nangLucCaKhoa,
  phanLoaiBuoi,
  tongHop,
  vachTuMuc,
  type BuoiNX,
} from "@/lib/portal/nhan-xet-thuan";
import { parseFeedbackNotes } from "@/lib/lms/session-eval-rubric";

const phieu = (rubric: Record<string, number> | null, deXuat: string | null = null) => ({
  chamLuc: null,
  giaoVien: null,
  chung: [{ nhan: null, text: "ok" }],
  deXuat,
  nhom: [],
  soTieuChi: rubric ? Object.keys(rubric).length : 0,
});
const b = (n: number, o: Partial<BuoiNX> = {}): BuoiNX => ({
  id: `s${n}`, n, ngay: "T7 01/10", ten: `Bài ${n}`, hocPhan: "HP1", kieu: "phieu", moi: false, vangGhi: null, canBu: false,
  phieu: phieu({ "kt-cu": 2 }), muc: { "kt-cu": 2 }, ...o,
});

describe("[NX-01] phân loại buổi", () => {
  it("phiếu > vắng > chưa học > chờ phiếu; buổi huỷ tách riêng", () => {
    expect(phanLoaiBuoi({ attendance: "PRESENT", past: true, coPhieu: true })).toBe("phieu");
    expect(phanLoaiBuoi({ attendance: "EXCUSED", past: true, coPhieu: false })).toBe("vang");
    expect(phanLoaiBuoi({ attendance: "FUTURE", past: false, coPhieu: false })).toBe("chua");
    expect(phanLoaiBuoi({ attendance: "PRESENT", past: true, coPhieu: false })).toBe("cho-phieu");
    expect(phanLoaiBuoi({ attendance: "UNMARKED", past: true, coPhieu: false })).toBe("cho-phieu");
    expect(phanLoaiBuoi({ attendance: "CANCELLED", past: false, coPhieu: true })).toBe("huy");
  });
  it("số vạch = 6 − mức, kẹp 1..5", () => {
    expect([1, 2, 3, 4, 5, 9, 0].map(vachTuMuc)).toEqual([5, 4, 3, 2, 1, 1, 5]);
  });
  it("phiếu mới trong 7 ngày", () => {
    const now = new Date("2026-11-02T03:00:00Z");
    expect(laPhieuMoi("2026-10-30T10:00:00Z", now)).toBe(true);
    expect(laPhieuMoi("2026-10-20T10:00:00Z", now)).toBe(false);
  });
});

describe("[NX-02] dựng phiếu", () => {
  it("phiếu mới: một đoạn 'Đánh giá chung', không có đề xuất riêng", () => {
    const p = dungPhieu({ comment: "", notes: parseFeedbackNotes({ overall: "Con học tốt." }), rubric: { "kt-cu": 1, "td-tt": 4 }, giaoVien: "Thầy A", chamLuc: "31/10 21:05" });
    expect(p.chung).toEqual([{ nhan: null, text: "Con học tốt." }]);
    expect(p.deXuat).toBeNull();
    expect(p.soTieuChi).toBe(2);
    expect(p.nhom.flatMap((g) => g.tc).map((c) => c.vach)).toEqual([5, 2]);
  });
  it("phiếu cũ: tách mục Đề xuất ra khỏi phần chung; không chế tiêu chí khi rubric rỗng", () => {
    const p = dungPhieu({ comment: "", notes: parseFeedbackNotes({ knowledge: "Nhớ bài", proposal: "Ôn thêm" }), rubric: null, giaoVien: null, chamLuc: null });
    expect(p.chung).toEqual([{ nhan: "Kiến thức", text: "Nhớ bài" }]);
    expect(p.deXuat).toBe("Ôn thêm");
    expect(p.nhom).toEqual([]);
  });
  it("chỉ có comment cũ thì dùng comment", () => {
    expect(dungPhieu({ comment: " Khá ", notes: null, rubric: null, giaoVien: null, chamLuc: null }).chung[0]?.text).toBe("Khá");
  });
});

describe("[NX-03] học phần + buổi mở sẵn", () => {
  const ds = [b(1), b(2), b(3, { hocPhan: "HP2", kieu: "chua" }), b(4, { hocPhan: null, kieu: "chua" })];
  it("gom theo mã; buổi không mã theo nhóm trước; 'chưa học' khi chưa buổi nào xong", () => {
    const g = gomHocPhan(ds, (id) => id === "s1" || id === "s2");
    expect(g.map((x) => [x.ten, x.tom, x.ids.length])).toEqual([["HP1", "2/2", 2], ["HP2", "chưa học", 2]]);
  });
  it("khoá không chia học phần: một nhóm 'Tất cả'", () => {
    const g = gomHocPhan([b(1, { hocPhan: null })], () => true);
    expect(g).toHaveLength(1);
    expect(g[0]?.ten).toBe("Tất cả");
  });
  it("mở sẵn phiếu mới nhất; không phiếu thì buổi đã học; không gì thì buổi đầu", () => {
    expect(chonMacDinh(ds)).toBe("s2");
    expect(chonMacDinh([b(3, { kieu: "vang" }), b(5, { kieu: "cho-phieu" }), b(7, { kieu: "chua" })])).toBe("s5");
    expect(chonMacDinh([b(1, { kieu: "chua" })])).toBe("s1");
    expect(chonMacDinh([])).toBeNull();
  });
});

describe("[NX-04] tổng hợp cả khoá", () => {
  const ds = [
    b(1, { muc: { "kt-cu": 4 } }),
    b(2, { muc: { "kt-cu": 3 } }),
    b(3, { kieu: "vang", phieu: null, muc: null }),
    b(4, { muc: { "kt-cu": 2 } }),
    b(5, { muc: { "kt-cu": 1 }, phieu: phieu({ "kt-cu": 1 }, "Nhờ con kể lại") }),
    b(6, { kieu: "chua", phieu: null, muc: null }),
  ];
  const t = tongHop(ds);
  it("cột = buổi đã học (kể cả vắng), không có buổi chưa học", () => {
    expect(t.cot.map((c) => c.n)).toEqual([1, 2, 3, 4, 5]);
    expect(t.soPhieu).toBe(4);
  });
  it("ô vắng ghi 'vang', ô có mức ghi vạch", () => {
    const r = t.hang.find((h) => h.id === "kt-cu")!;
    expect(r.o[2]?.loai).toBe("vang");
    expect(r.o[0]).toMatchObject({ loai: "muc", vach: 2 });
  });
  it("xu hướng: 3 phiếu đầu (4,3,2) so 3 phiếu cuối (3,2,1) ⇒ tiến bộ; ít hơn 2 phiếu ⇒ không kết luận", () => {
    expect(t.hang.find((h) => h.id === "kt-cu")?.xh).toBe("tang");
    expect(t.hang.find((h) => h.id === "td-tt")?.xh).toBeNull();
    expect(t.tienBo).toBe(1);
  });
  it("mạnh nhất / cần cố gắng chỉ xét tiêu chí có dữ liệu; đề xuất chỉ lấy phiếu có mục đề xuất", () => {
    expect(t.manh?.ten).toBe("Kiến thức cũ");
    expect(t.soDeXuat).toBe(1);
    expect(t.deXuat[0]?.n).toBe(5);
  });
  it("không có phiếu nào ⇒ không bịa mạnh/yếu", () => {
    const r = tongHop([b(1, { kieu: "chua", phieu: null, muc: null })]);
    expect(r.manh).toBeNull();
    expect(r.yeu).toBeNull();
  });
});

describe("[NX-05] năng lực cả khoá", () => {
  it("đầu → cuối theo thang 5 vạch, chỉ nhóm có dữ liệu", () => {
    const g = nangLucCaKhoa([b(1, { muc: { "kt-cu": 4 } }), b(2, { muc: { "kt-cu": 2 } })]);
    expect(g).toHaveLength(1);
    expect(g[0]?.tc[0]).toMatchObject({ ten: "Kiến thức cũ", dau: "3,0", cuoi: "3,0" });
  });
  it("chưa có phiếu ⇒ rỗng", () => {
    expect(nangLucCaKhoa([b(1, { kieu: "chua", muc: null })])).toEqual([]);
  });
});

describe("[NX-06] cột bảng tổng hợp", () => {
  it("buổi đã học nhưng chưa có phiếu KHÔNG thành cột trống", () => {
    const t = tongHop([b(1), b(2, { kieu: "cho-phieu", phieu: null, muc: null }), b(3, { kieu: "vang", phieu: null, muc: null })]);
    expect(t.cot.map((c) => c.n)).toEqual([1, 3]);
  });
});
