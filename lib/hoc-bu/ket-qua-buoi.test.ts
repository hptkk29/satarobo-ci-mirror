// [KQB-*] — mô hình đọc kết quả học bù của một buổi gốc (T08). THUẦN.
import { describe, expect, it } from "vitest";
import { dungKetQuaBuoi, gonKetQua, nhanKetHop, nhanTuKetQua, ymdSangDmy, type DongDoc, type MucDoc } from "@/lib/hoc-bu/ket-qua-buoi";
import { dongPhieu } from "@/lib/hoc-bu/phieu-tom-tat";

const ngay = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
let dem = 0;
const muc = (o: Partial<MucDoc> & { ngay?: string; caseStatus?: MucDoc["case"]["status"] } = {}): MucDoc => {
  dem++;
  return {
    id: o.id ?? `m${dem}`,
    result: o.result ?? "PLANNED",
    status: o.status ?? "PLACED",
    lessonId: o.lessonId ?? "b5",
    teacherEvaluation: o.teacherEvaluation ?? null,
    evaluationRubric: o.evaluationRubric ?? null,
    completedAt: o.completedAt ?? null,
    createdAt: o.createdAt ?? new Date(2026, 9, dem),
    case: { id: `c${dem}`, status: o.caseStatus ?? "SCHEDULED", date: ngay(o.ngay ?? "2026-10-15"), startTime: "18:00", endTime: "19:30", teacherId: "gv", roomId: "p", centerId: "cs1" },
  };
};
const dong = (o: Partial<DongDoc> = {}): DongDoc => ({
  id: "n1",
  studentId: "hv",
  missedSessionId: "s5",
  status: "PENDING",
  waivedAt: null,
  makeupSessionId: null,
  muc: [],
  ...o,
});
const kq = (d: DongDoc | null) => dungKetQuaBuoi({ sessionId: "s5", studentId: "hv", dong: d });

describe("[KQB] kết quả học bù của một buổi gốc", () => {
  it("[KQB-01] không có dòng cần bù ⇒ KHONG_CAN_BU, nhãn rỗng, nhãn ghép = nhãn gốc", () => {
    const r = kq(null);
    expect(r).toMatchObject({ trangThai: "KHONG_CAN_BU", needId: null, hienTai: null, lichSu: [], nhan: "", khongKhop: false });
    expect(nhanKetHop("Có mặt", r)).toBe("Có mặt");
    expect(nhanKetHop("Có mặt", undefined)).toBe("Có mặt");
  });

  it("[KQB-02] chờ xếp / đã xếp / đã bù: trạng thái theo DÒNG CẦN BÙ, kết quả hiện tại là lần phù hợp; nhãn ghép giữ nguyên điểm danh gốc", () => {
    const cho = kq(dong());
    expect(cho).toMatchObject({ trangThai: "CHO_XEP", hienTai: null, nhan: "Chờ xếp học bù" });
    expect(nhanKetHop("Vắng có phép", cho)).toBe("Vắng có phép · Chờ xếp học bù");

    const xep = kq(dong({ status: "SCHEDULED", muc: [muc({ ngay: "2026-10-16" })] }));
    expect(xep.trangThai).toBe("DA_XEP");
    expect(xep.hienTai).toMatchObject({ loai: "DA_XEP", gioBatDau: "18:00", gioKetThuc: "19:30" });
    expect(xep.nhan).toBe("Đã xếp học bù ngày 16/10/2026 lúc 18:00");

    const xong = kq(dong({ status: "COMPLETED", muc: [muc({ result: "COMPLETED", status: "PRESENT", teacherEvaluation: "Con làm tốt", completedAt: new Date("2026-10-15T12:00:00.000Z") })] }));
    expect(xong.trangThai).toBe("DA_BU");
    expect(xong.hienTai).toMatchObject({ loai: "DA_XONG", danhGia: "Con làm tốt" });
    expect(xong.nhan).toBe("Đã học bù ngày 15/10/2026");
    expect(nhanKetHop("Vắng có phép", xong)).toBe("Vắng có phép ✓ Đã học bù ngày 15/10/2026");
    expect(xong.khongKhop).toBe(false);
  });

  it("[KQB-03] KHÔNG chọn nhầm lần cũ: vắng buổi bù rồi xếp lại và bù xong ⇒ kết quả hiện tại là lần XONG; lần vắng nằm ở lịch sử; thứ tự theo thời gian", () => {
    const r = kq(
      dong({
        status: "COMPLETED",
        muc: [
          muc({ id: "lan2", result: "COMPLETED", status: "PRESENT", ngay: "2026-10-20", completedAt: new Date("2026-10-20T12:00:00.000Z") }),
          muc({ id: "lan1", result: "RELEASED", status: "ABSENT", ngay: "2026-10-15" }),
        ],
      }),
    );
    expect(r.lichSu.map((l) => [l.mucId, l.loai])).toEqual([["lan1", "VANG_BUOI_BU"], ["lan2", "DA_XONG"]]);
    expect(r.hienTai?.mucId).toBe("lan2");
    expect(r.nhan).toBe("Đã học bù ngày 20/10/2026");
  });

  it("[KQB-04] dòng còn nợ sau một lần vắng ⇒ CHO_XEP, hienTai null (KHÔNG lấy lần vắng làm kết quả), lịch sử vẫn thấy lần vắng", () => {
    const r = kq(dong({ status: "PENDING", muc: [muc({ result: "RELEASED", status: "ABSENT" })] }));
    expect(r.trangThai).toBe("CHO_XEP");
    expect(r.hienTai).toBeNull();
    expect(r.lichSu.map((l) => l.loai)).toEqual(["VANG_BUOI_BU"]);
    expect(r.khongKhop).toBe(false);
  });

  it("[KQB-05] bé có mặt nhưng CHƯA xong bài ⇒ dòng về PENDING; lần đó là CHUA_XONG trong lịch sử, không hiện là đã bù; mục bị gỡ là DA_GO", () => {
    const r = kq(dong({ status: "PENDING", muc: [muc({ id: "a", result: "NOT_COMPLETED", status: "ABSENT", ngay: "2026-10-15" }), muc({ id: "b", result: "RELEASED", status: "RELEASED", ngay: "2026-10-16" })] }));
    expect(r.trangThai).toBe("CHO_XEP");
    expect(r.lichSu.map((l) => [l.mucId, l.loai])).toEqual([["a", "CHUA_XONG"], ["b", "DA_GO"]]);
    expect(r.hienTai).toBeNull();
  });

  it("[KQB-06] hai mục cùng ngày: thứ tự ổn định theo giờ rồi thời điểm tạo; mục PLANNED trong case đã HUỶ không được coi là đang chờ", () => {
    const r = kq(dong({ status: "PENDING", muc: [muc({ id: "x", result: "PLANNED", caseStatus: "CANCELLED" })] }));
    expect(r.lichSu[0]!.loai).toBe("DA_GO");
    expect(r.hienTai).toBeNull();
    const hai = kq(dong({ status: "SCHEDULED", muc: [muc({ id: "sau", createdAt: new Date(2026, 9, 20) }), muc({ id: "truoc", createdAt: new Date(2026, 9, 10) })] }));
    expect(hai.lichSu.map((l) => l.mucId)).toEqual(["truoc", "sau"]);
    expect(hai.hienTai?.mucId).toBe("sau"); // lần đã xếp MỚI NHẤT
  });

  it("[KQB-07] dòng huỷ: có `waivedAt` (quản lý chủ ý) ⇒ DA_HUY_KHONG_BU; không có (buổi gốc sửa sang có mặt) ⇒ KHONG_CON_CAN_BU — hai câu khác nhau", () => {
    expect(kq(dong({ status: "CANCELLED", waivedAt: new Date("2026-10-02T00:00:00.000Z") })).nhan).toBe("Đã huỷ — không bù");
    expect(kq(dong({ status: "CANCELLED" }))).toMatchObject({ trangThai: "KHONG_CON_CAN_BU", nhan: "Không còn cần bù" });
  });

  it("[KQB-08] dữ liệu lệch ⇒ cờ khongKhop: dòng 'đã bù' mà không có lần XONG; dòng chưa bù mà có lần XONG; luồng cũ (makeupSessionId) thì KHÔNG báo lệch", () => {
    expect(kq(dong({ status: "COMPLETED" })).khongKhop).toBe(true);
    expect(kq(dong({ status: "PENDING", muc: [muc({ result: "COMPLETED", status: "PRESENT" })] })).khongKhop).toBe(true);
    expect(kq(dong({ status: "SCHEDULED" })).khongKhop).toBe(true); // đã xếp mà không có mục nào chờ
    const cu = kq(dong({ status: "COMPLETED", makeupSessionId: "buoi-lop-khac" }));
    expect(cu.khongKhop).toBe(false);
    expect(cu).toMatchObject({ trangThai: "DA_BU", hienTai: null, nhan: "Đã học bù" }); // luồng cũ: biết đã bù, không biết bù ở đâu
  });

  it("[KQB-09] nhãn: ngày định dạng không phụ thuộc múi giờ máy; nhãn ghép đúng hai kiểu", () => {
    expect(ymdSangDmy(new Date("2026-01-05T00:00:00.000Z"))).toBe("05/01/2026");
    expect(nhanTuKetQua("DA_BU", null)).toBe("Đã học bù");
    expect(nhanTuKetQua("DA_XEP", null)).toBe("Đã xếp học bù");
  });

  it("[KQB-11] kết quả hiện tại là lần XONG dù KHÔNG phải lần cuối theo lịch: mục từng xếp vào case ngày muộn hơn rồi bị gỡ nằm SAU lần bù xong trong lịch sử, nhưng không che nó", () => {
    const r = kq(
      dong({
        status: "COMPLETED",
        muc: [
          muc({ id: "xong", result: "COMPLETED", status: "PRESENT", ngay: "2026-10-16", completedAt: new Date("2026-10-16T12:00:00.000Z") }),
          muc({ id: "goSau", result: "RELEASED", status: "RELEASED", ngay: "2026-10-22" }), // xếp trước vào case 22/10 rồi gỡ — theo ngày case nằm SAU lần xong
        ],
      }),
    );
    expect(r.lichSu.map((l) => l.mucId)).toEqual(["xong", "goSau"]);
    expect(r.hienTai?.mucId).toBe("xong");
    expect(r.nhan).toBe("Đã học bù ngày 16/10/2026");
    // Tương tự với lần ĐÃ XẾP: lần chờ mới nhất, không phải lần cuối bất kỳ.
    const x = kq(dong({ status: "SCHEDULED", muc: [muc({ id: "cho", result: "PLANNED", ngay: "2026-10-16" }), muc({ id: "vangSau", result: "RELEASED", status: "ABSENT", ngay: "2026-10-30" })] }));
    expect(x.hienTai?.mucId).toBe("cho");
  });

  it("[KQB-10] mô hình THUẦN: không nhận điểm danh gốc làm đầu vào nên đổi điểm danh gốc không đổi kết quả (hợp đồng 'điểm danh gốc không đổi vì học bù')", () => {
    const d = dong({ status: "COMPLETED", muc: [muc({ result: "COMPLETED", status: "PRESENT" })] });
    const a = kq(d);
    const b = kq(structuredClone(d));
    expect(b).toEqual(a);
    expect(Object.keys(a).sort()).toEqual(["hienTai", "khongKhop", "lichSu", "needId", "nhan", "sessionId", "studentId", "trangThai"]);
  });
});

describe("[KQB-PHIEU] bảng 9 tiêu chí đi CÙNG đánh giá chung (một bản ghi) tới buổi gốc", () => {
  const xong = (o: Partial<MucDoc> = {}) =>
    kq(dong({ status: "COMPLETED", muc: [muc({ result: "COMPLETED", status: "PRESENT", completedAt: new Date(2026, 9, 15), ...o })] }));

  it("[KQB-PHIEU-01] có bảng ⇒ `phieu` đủ 9 khoá mức 1–5 (chuẩn hoá) + `coPhieu`; cùng bản ghi với đánh giá chung", () => {
    const r = xong({ teacherEvaluation: "Con làm tốt", evaluationRubric: { "kt-cu": 2, rac: 99 } });
    expect(r.hienTai!.danhGia).toBe("Con làm tốt");
    expect(Object.keys(r.hienTai!.phieu!)).toHaveLength(9);
    expect(r.hienTai!.phieu!["kt-cu"]).toBe(2);
    expect(Object.values(r.hienTai!.phieu!).every((v) => v >= 1 && v <= 5)).toBe(true); // giá trị rác ⇒ mức mặc định, không vỡ
    expect(gonKetQua(r)).toMatchObject({ danhGia: "Con làm tốt", coPhieu: true });
    expect(dongPhieu(r.hienTai!.phieu)).toHaveLength(9);
  });

  it("[KQB-PHIEU-02] phiếu chỉ có chữ ⇒ `phieu = null`, `coPhieu = false` (không bịa bảng); chưa có phiếu nào ⇒ cũng không", () => {
    const chiChu = xong({ teacherEvaluation: "Con làm tốt", evaluationRubric: null });
    expect(chiChu.hienTai!.phieu).toBeNull();
    expect(gonKetQua(chiChu)).toMatchObject({ danhGia: "Con làm tốt", coPhieu: false });
    expect(dongPhieu(null)).toBeNull();
    expect(gonKetQua(xong({ teacherEvaluation: null, evaluationRubric: null }))).toMatchObject({ danhGia: null, coPhieu: false });
  });

  it("[KQB-PHIEU-03] chỉ có bảng (đánh giá chung trống) vẫn là phiếu hợp lệ: `danhGia = null`, `coPhieu = true`", () => {
    expect(gonKetQua(xong({ teacherEvaluation: null, evaluationRubric: { "kt-cu": 1 } }))).toMatchObject({ danhGia: null, coPhieu: true });
  });
});
