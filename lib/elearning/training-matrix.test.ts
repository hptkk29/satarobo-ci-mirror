// @vitest-environment node
/**
 * EL-17 — ma trận đào tạo R3 + mẫu số North Star.
 *
 * Bộ này canh đúng một thứ, và nó là thứ dễ hỏng nhất của cả báo cáo tuân thủ:
 * **"không áp dụng" là một CÂU TRẢ LỜI, "chưa đối chiếu được" thì không.** Trộn hai
 * cái là biến một khoảng trống dữ liệu thành kết luận về một con người — kết luận sẽ
 * đi vào báo cáo có ghi tên, gửi thẳng quản lý trực tiếp của họ.
 */
import { describe, it, expect } from "vitest";
import {
  canhBaoPhamVi,
  dungMaTran,
  tinhNSM,
  tinhNSMTheoNguoi,
  type ODat,
} from "@/lib/elearning/training-matrix";
import type { NguoiDeKhop, YeuCauDeKhop } from "@/lib/elearning/requirement-match";

const ng = (id: string, dep: string | null, path: string | null): NguoiDeKhop => ({
  userId: id,
  departmentId: dep,
  orgUnitPath: path,
  positionId: null,
});

const yc = (p: Partial<YeuCauDeKhop>): YeuCauDeKhop => ({
  id: "y",
  scopeKind: "ALL_STAFF",
  positionId: null,
  departmentId: null,
  levelTag: null,
  orgUnitPath: null,
  validityMonths: 12,
  ...p,
});

const o = (t: ODat["trangThai"], u = "u1", r = "y1"): ODat => ({
  userId: u,
  requirementId: r,
  trangThai: t,
  lyDo: null,
});

describe("dựng ma trận — bốn trạng thái, không phải ba", () => {
  const nguoi = [
    ng("u1", "dep-daotao", "/ho/danang/cs1/"),
    ng("u2", "dep-ketoan", "/ho/danang/cs2/"),
  ];

  it("ĐẠT khi có chứng cứ hoàn thành còn hiệu lực", () => {
    const r = dungMaTran({
      nguoi: [nguoi[0]!],
      yeuCau: [yc({ id: "y1", scopeKind: "ALL_STAFF" })],
      daDat: [{ userId: "u1", courseId: "k1" }],
      khoaCuaYeuCau: new Map([["y1", "k1"]]),
    });
    expect(r[0]!.trangThai).toBe("DAT");
  });

  it("CHƯA ĐẠT khi yêu cầu áp mà không có chứng cứ", () => {
    const r = dungMaTran({
      nguoi: [nguoi[0]!],
      yeuCau: [yc({ id: "y1", scopeKind: "ALL_STAFF" })],
      daDat: [],
      khoaCuaYeuCau: new Map([["y1", "k1"]]),
    });
    expect(r[0]!.trangThai).toBe("CHUA_DAT");
  });

  it("🔴 KHÔNG ÁP DỤNG (ô xám) khác hẳn CHƯA ĐẠT", () => {
    // Người kế toán không dính yêu cầu của phòng đào tạo. Vẽ ô ấy thành "chưa đạt"
    // là ghi tên họ vào danh sách chưa tuân thủ vì một nghĩa vụ không phải của họ.
    const r = dungMaTran({
      nguoi,
      yeuCau: [yc({ id: "y1", scopeKind: "DEPARTMENT", departmentId: "dep-daotao" })],
      daDat: [],
      khoaCuaYeuCau: new Map([["y1", "k1"]]),
    });
    expect(r.find((x) => x.userId === "u1")!.trangThai).toBe("CHUA_DAT");
    expect(r.find((x) => x.userId === "u2")!.trangThai).toBe("KHONG_AP_DUNG");
  });

  it("🔴 CHƯA ĐỐI CHIẾU ĐƯỢC là trạng thái THỨ TƯ, không gộp vào ô xám", () => {
    // `POSITION` với bảng `Position` rỗng trên prod: hệ thống KHÔNG BIẾT yêu cầu này
    // có áp cho ai không. Vẽ nó xám là trả lời thay cho một câu chưa có đáp án.
    const r = dungMaTran({
      nguoi: [nguoi[0]!],
      yeuCau: [yc({ id: "y1", scopeKind: "POSITION", positionId: "p1" })],
      daDat: [],
      khoaCuaYeuCau: new Map([["y1", "k1"]]),
    });
    expect(r[0]!.trangThai).toBe("CHUA_DOI_CHIEU_DUOC");
    expect(r[0]!.lyDo).toContain("Position");
  });

  it("yêu cầu không tra được khoá ⇒ CHƯA ĐẠT, không im lặng thành ĐẠT", () => {
    // Thiếu ánh xạ mà mặc định "đạt" là báo cáo tuân thủ nói dối theo hướng dễ chịu.
    const r = dungMaTran({
      nguoi: [nguoi[0]!],
      yeuCau: [yc({ id: "y1" })],
      daDat: [{ userId: "u1", courseId: "k1" }],
      khoaCuaYeuCau: new Map(),
    });
    expect(r[0]!.trangThai).toBe("CHUA_DAT");
  });

  it("phủ đủ MỌI cặp người × yêu cầu", () => {
    const r = dungMaTran({
      nguoi,
      yeuCau: [yc({ id: "y1" }), yc({ id: "y2" })],
      daDat: [],
      khoaCuaYeuCau: new Map(),
    });
    expect(r).toHaveLength(4);
  });
});

describe("🔴 mẫu số NSM = cặp ÁP DỤNG, không phải người × yêu cầu", () => {
  it("ô xám KHÔNG vào mẫu số", () => {
    const r = tinhNSM([o("DAT"), o("CHUA_DAT", "u2"), o("KHONG_AP_DUNG", "u3")]);
    expect(r.mauSo).toBe(2);
    expect(r.tuSo).toBe(1);
    expect(r.tiLe).toBe(50);
  });

  it("🔴 ô CHƯA ĐỐI CHIẾU ĐƯỢC nằm ngoài CẢ tử lẫn mẫu, và ĐẾM ĐƯỢC", () => {
    // Nhét vào mẫu số là tính người ta chưa đạt một yêu cầu mà hệ thống còn chưa biết
    // có áp cho họ không. Bỏ im lặng thì NSM trông sạch trong khi một phần yêu cầu
    // không được đo — và không ai biết phần ấy lớn cỡ nào.
    const r = tinhNSM([o("DAT"), o("CHUA_DOI_CHIEU_DUOC", "u2")]);
    expect(r.mauSo).toBe(1);
    expect(r.tiLe).toBe(100);
    expect(r.chuaDoiChieuDuoc).toBe(1);
  });

  it("mẫu số 0 ⇒ `null`, KHÔNG phải 0%", () => {
    // "0% tuân thủ" đọc thành thảm hoạ; sự thật là chưa có yêu cầu nào được khai.
    expect(tinhNSM([]).tiLe).toBeNull();
    expect(tinhNSM([o("KHONG_AP_DUNG")]).tiLe).toBeNull();
  });

  it("thêm người KHÔNG có yêu cầu nào thì mẫu số KHÔNG phình", () => {
    // TS-35 bước ④/⑤: thêm một vị trí mới không được làm mẫu số to ra.
    const truoc = tinhNSM([o("DAT"), o("CHUA_DAT", "u2")]);
    const sau = tinhNSM([
      o("DAT"),
      o("CHUA_DAT", "u2"),
      o("KHONG_AP_DUNG", "u3"),
      o("KHONG_AP_DUNG", "u3", "y2"),
    ]);
    expect(sau.mauSo).toBe(truoc.mauSo);
  });
});

describe("🔴 ngưỡng viết bằng NGƯỜI, không bằng phần trăm", () => {
  it("một người đạt khi đạt TOÀN BỘ yêu cầu áp cho họ", () => {
    const r = tinhNSMTheoNguoi([
      o("DAT", "u1", "y1"),
      o("CHUA_DAT", "u1", "y2"),
      o("DAT", "u2", "y1"),
    ]);
    expect(r.soNguoiDat).toBe(1);
    expect(r.soNguoiCoYeuCau).toBe(2);
  });

  it("người KHÔNG có yêu cầu nào đứng ngoài cả tử lẫn mẫu", () => {
    const r = tinhNSMTheoNguoi([o("DAT", "u1"), o("KHONG_AP_DUNG", "u2")]);
    expect(r.soNguoiCoYeuCau).toBe(1);
  });

  it("câu in ra là 'x/y người', KHÔNG phải phần trăm", () => {
    // ⚠️ Ở mẫu số 15, MỖI NGƯỜI là 6,7 điểm phần trăm — "80%" và "86,7%" là cùng một
    // người. Ngưỡng viết bằng phần trăm chỉ tạo ảo giác chính xác, và "chưa đạt 90%"
    // nghe như một khoảng cách lớn trong khi thực tế là thiếu đúng 1–2 người.
    const r = tinhNSMTheoNguoi([o("DAT", "u1"), o("CHUA_DAT", "u2")]);
    expect(r.cau).toBe("1/2 người");
    expect(r.cau).not.toContain("%");
  });
});

describe("🔴 cảnh báo NGAY LÚC LƯU, không đợi đọc báo cáo", () => {
  it("phạm vi chưa đối chiếu được thì nói rõ, kèm lý do", () => {
    const c = canhBaoPhamVi({ scopeKind: "POSITION", soNguoiKhop: 0 });
    expect(c).toContain("0 người");
    expect(c).toContain("Position");
  });

  it("phạm vi hợp lệ nhưng khớp 0 người ⇒ vẫn cảnh báo", () => {
    // Một yêu cầu áp cho 0 người trông y hệt một yêu cầu chưa ai kịp làm: cả hai đều
    // là một hàng ô xám. Khác biệt chỉ lộ khi có người hỏi "vì sao khoá này không ai
    // học", và lúc đó đã trôi qua vài tháng.
    expect(canhBaoPhamVi({ scopeKind: "DEPARTMENT", soNguoiKhop: 0 })).toContain(
      "0 người",
    );
  });

  it("khớp được người thì KHÔNG làm phiền", () => {
    expect(canhBaoPhamVi({ scopeKind: "DEPARTMENT", soNguoiKhop: 4 })).toBeNull();
  });
});
