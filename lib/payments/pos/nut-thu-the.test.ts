// Ca [POS1-UI-01] — ô "Thẻ POS" của MỘT dòng đợt vẽ gì (`nutThuThe`). THUẦN.
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §7.2. Luật 12 — không vẽ nút chắc chắn bị máy chủ từ chối:
// mỗi ca đối chiếu một cổng của `moPhieuPos` (T9 chờ duyệt · T10 chưa khai máy · T21 giao dịch thẻ
// trước còn ở hàng chờ · đợt khác đang giữ mã) với đúng thứ ô hiển thị. Mỗi ca "KHÔNG nút" có đối
// chứng dương (luật 11 — ca chỉ khẳng định SỰ VẮNG MẶT luôn đạt khi tính năng hỏng hoàn toàn).
import { describe, it, expect } from "vitest";
import { nutThuThe, type DauVaoNutThuThe, type PhieuPosChoNut } from "./nut-thu-the";

const PHIEU: PhieuPosChoNut = {
  paymentRequestIds: ["pr1"],
  cuaPhieuDangMo: true,
  hienThi: "CHO_QUET",
  choKeToan: false,
};

function vao(p: Partial<DauVaoNutThuThe> = {}): DauVaoNutThuThe {
  return {
    duocThuThePos: true,
    bat: true,
    tt: { kieu: "MOI_CHUA_PHAT" },
    paymentRequestId: "pr1",
    rowStatus: "PENDING",
    conThieu: 3_564_000,
    lyDoChuaDuyet: null,
    soMay: 1,
    phieuPos: null,
    ...p,
  };
}

describe("[POS1-UI-01] nutThuThe — bảng §7.2", () => {
  it("đối chứng dương: đủ điều kiện ⇒ nút TAO (cả MOI_CHUA_PHAT lẫn MOI_CUA_DOT_NAY)", () => {
    expect(nutThuThe(vao()).kieu).toBe("TAO");
    expect(nutThuThe(vao({ tt: { kieu: "MOI_CUA_DOT_NAY" } })).kieu).toBe("TAO");
  });

  it("không quyền `payments:pos-check` ⇒ không gì (kể cả khi có phiếu đang chờ)", () => {
    expect(nutThuThe(vao({ duocThuThePos: false })).kieu).toBe("AN");
    expect(nutThuThe(vao({ duocThuThePos: false, phieuPos: PHIEU, tt: { kieu: "MOI_CUA_DOT_NAY" } })).kieu).toBe("AN");
  });

  it("cờ tắt ⇒ không nút TẠO; đối chứng: cờ bật cùng dữ liệu ⇒ TAO", () => {
    expect(nutThuThe(vao({ bat: false, tt: { kieu: "CU" } })).kieu).toBe("AN");
    expect(nutThuThe(vao({ bat: true })).kieu).toBe("TAO");
  });

  it("đợt PAID / VOID / hết nợ ⇒ không gì", () => {
    expect(nutThuThe(vao({ rowStatus: "PAID" })).kieu).toBe("AN");
    expect(nutThuThe(vao({ rowStatus: "VOID" })).kieu).toBe("AN");
    expect(nutThuThe(vao({ conThieu: 0 })).kieu).toBe("AN");
    expect(nutThuThe(vao({ rowStatus: "PARTIAL" })).kieu).toBe("TAO");
  });

  it("đợt KHÁC đang giữ mã ⇒ DOT_KHAC kèm nhãn (không nút thẻ)", () => {
    const n = nutThuThe(vao({ tt: { kieu: "MOI_CUA_DOT_KHAC", nhanDotDangGiu: "Đợt 1/3" } }));
    expect(n).toEqual({ kieu: "DOT_KHAC", nhanDotDangGiu: "Đợt 1/3" });
  });

  it("chờ duyệt (T9) ⇒ CHO_DUYET mang ĐÚNG câu của cổng máy chủ", () => {
    expect(nutThuThe(vao({ lyDoChuaDuyet: "Giảm giá chưa duyệt" }))).toEqual({
      kieu: "CHO_DUYET",
      lyDo: "Giảm giá chưa duyệt",
    });
  });

  it("cơ sở chưa khai máy (T10) ⇒ CHUA_KHAI_MAY; đối chứng 2 máy ⇒ TAO", () => {
    expect(nutThuThe(vao({ soMay: 0 })).kieu).toBe("CHUA_KHAI_MAY");
    expect(nutThuThe(vao({ soMay: 2 })).kieu).toBe("TAO");
  });

  it("phiếu POS ĐANG MỞ của phiếu gộp chứa dòng ⇒ DANG_CHO (mở lại hộp), cả CHO_QUET lẫn THAT_BAI", () => {
    const tt = { kieu: "MOI_CUA_DOT_NAY" } as const;
    expect(nutThuThe(vao({ tt, phieuPos: PHIEU })).kieu).toBe("DANG_CHO");
    expect(nutThuThe(vao({ tt, phieuPos: { ...PHIEU, hienThi: "THAT_BAI" } })).kieu).toBe("DANG_CHO");
  });

  it("phiếu POS đang chờ vẫn mở lại được khi chờ duyệt / cờ tắt (T8: xem + kiểm không hỏi cờ)", () => {
    expect(nutThuThe(vao({ tt: { kieu: "CU" }, bat: false, phieuPos: PHIEU })).kieu).toBe("DANG_CHO");
    expect(nutThuThe(vao({ lyDoChuaDuyet: "x", phieuPos: PHIEU })).kieu).toBe("DANG_CHO");
  });

  it("phiếu POS của dòng KHÁC / của phiếu gộp không còn mở ⇒ không chiếm ô dòng này", () => {
    expect(nutThuThe(vao({ phieuPos: { ...PHIEU, paymentRequestIds: ["pr9"] } })).kieu).toBe("TAO");
    expect(nutThuThe(vao({ phieuPos: { ...PHIEU, cuaPhieuDangMo: false } })).kieu).toBe("TAO");
  });

  it("(T21) giao dịch thẻ trước LECH_TIEN/CAN_XU_LY còn ở hàng chờ ⇒ CHO_KE_TOAN, KHÔNG nút tạo mới", () => {
    const n = nutThuThe(
      vao({ tt: { kieu: "MOI_CUA_DOT_NAY" }, phieuPos: { ...PHIEU, hienThi: "LECH_TIEN", choKeToan: true } }),
    );
    expect(n.kieu).toBe("CHO_KE_TOAN");
    // Đối chứng: kế toán đã gắn tay (giao dịch rời hàng chờ) ⇒ tạo lại được.
    const sau = nutThuThe(
      vao({ tt: { kieu: "MOI_CUA_DOT_NAY" }, phieuPos: { ...PHIEU, hienThi: "KE_TOAN_DA_GHI", choKeToan: false } }),
    );
    expect(sau.kieu).toBe("TAO");
  });

  it("phiếu POS HẾT HẠN ⇒ nút TAO (máy chủ đóng phiếu cũ, mở phiếu mới)", () => {
    expect(nutThuThe(vao({ tt: { kieu: "MOI_CUA_DOT_NAY" }, phieuPos: { ...PHIEU, hienThi: "HET_HAN" } })).kieu).toBe("TAO");
  });
});
