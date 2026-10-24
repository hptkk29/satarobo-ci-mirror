// @vitest-environment node
/**
 * EL-16/EL-17 — khớp YÊU CẦU ĐÀO TẠO với một người.
 *
 * Bảng `TrnRequirement` hiện RỖNG, nên mọi ca ở đây chạy trên dữ liệu bịa. Đó không
 * phải lý do để hoãn: cái sai của phép khớp này chỉ lộ ra **sau chu kỳ đầu tiên** —
 * tức sau khi hệ thống đã phát hàng loạt chứng nhận với hạn hiệu lực sai.
 */
import { describe, it, expect } from "vitest";
import {
  chuKyNganNhat,
  khopYeuCau,
  PHAM_VI_CHUA_KHOP_DUOC,
  type NguoiDeKhop,
  type YeuCauDeKhop,
} from "@/lib/elearning/requirement-match";

const nguoi: NguoiDeKhop = {
  userId: "u1",
  departmentId: "dep-daotao",
  orgUnitPath: "/ho/danang/cs1/",
  positionId: null,
};

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

describe("ALL_STAFF", () => {
  it("áp cho mọi người", () => {
    const r = khopYeuCau(nguoi, [yc({ scopeKind: "ALL_STAFF" })]);
    expect(r.apDung).toHaveLength(1);
  });
});

describe("DEPARTMENT", () => {
  it("khớp đúng phòng ban", () => {
    const r = khopYeuCau(nguoi, [
      yc({ scopeKind: "DEPARTMENT", departmentId: "dep-daotao" }),
    ]);
    expect(r.apDung).toHaveLength(1);
  });

  it("khác phòng ban thì không áp", () => {
    const r = khopYeuCau(nguoi, [
      yc({ scopeKind: "DEPARTMENT", departmentId: "dep-ketoan" }),
    ]);
    expect(r.apDung).toHaveLength(0);
  });

  it("người CHƯA có departmentId ⇒ không khớp (fail-closed)", () => {
    // Người chưa gắn phòng ban mà khớp bừa là áp một yêu cầu tuân thủ cho người
    // không thuộc phạm vi — và họ sẽ nhận nhắc, nhận báo cáo có tên.
    const r = khopYeuCau(
      { ...nguoi, departmentId: null },
      [yc({ scopeKind: "DEPARTMENT", departmentId: "dep-daotao" })],
    );
    expect(r.apDung).toHaveLength(0);
  });

  it("yêu cầu khai DEPARTMENT nhưng bỏ trống cột đích ⇒ không khớp ai", () => {
    // `null === null` sẽ cho ra "khớp mọi người chưa có phòng ban". Đó là biến một
    // dữ liệu khai thiếu thành một phạm vi rộng.
    const r = khopYeuCau(
      { ...nguoi, departmentId: null },
      [yc({ scopeKind: "DEPARTMENT", departmentId: null })],
    );
    expect(r.apDung).toHaveLength(0);
  });
});

describe("ORG_UNIT — yêu cầu ở đơn vị CHA áp cho cả nhánh dưới", () => {
  it("yêu cầu đặt ở HO áp cho người ở CS1", () => {
    // So bằng id thì mọi yêu cầu toàn công ty phải khai lại ở từng cơ sở, và thiếu
    // một cơ sở là thiếu im lặng.
    const r = khopYeuCau(nguoi, [
      yc({ scopeKind: "ORG_UNIT", orgUnitPath: "/ho/" }),
    ]);
    expect(r.apDung).toHaveLength(1);
  });

  it("đúng chính đơn vị đó cũng khớp", () => {
    const r = khopYeuCau(nguoi, [
      yc({ scopeKind: "ORG_UNIT", orgUnitPath: "/ho/danang/cs1/" }),
    ]);
    expect(r.apDung).toHaveLength(1);
  });

  it("nhánh KHÁC thì không áp — cách ly cơ sở", () => {
    const r = khopYeuCau(nguoi, [
      yc({ scopeKind: "ORG_UNIT", orgUnitPath: "/ho/danang/cs2/" }),
    ]);
    expect(r.apDung).toHaveLength(0);
  });

  it("người không có path ⇒ không khớp", () => {
    const r = khopYeuCau({ ...nguoi, orgUnitPath: null }, [
      yc({ scopeKind: "ORG_UNIT", orgUnitPath: "/ho/" }),
    ]);
    expect(r.apDung).toHaveLength(0);
  });
});

describe("🔴 hai phạm vi CHƯA khớp được ai — phải nói ra, không im lặng", () => {
  it.each([
    ["POSITION", "Position"],
    ["LEVEL_TAG", "thẻ bậc"],
  ])("%s rơi vào nhánh CÓ TÊN kèm lý do", (scopeKind, manh) => {
    // ⚠️ Khác biệt sống còn: "không áp dụng" là một CÂU TRẢ LỜI, còn đây là "chưa
    // trả lời được". Gộp hai thứ là biến một khoảng trống dữ liệu thành kết luận —
    // và ở EL-16 kết luận đó là một tấm chứng nhận VÔ THỜI HẠN.
    const r = khopYeuCau(nguoi, [yc({ scopeKind })]);
    expect(r.apDung).toHaveLength(0);
    expect(r.khongDoiChieuDuoc).toHaveLength(1);
    expect(r.khongDoiChieuDuoc[0]!.lyDo).toContain(manh);
  });

  it("hai lý do đó có thật trong bảng lý do, không phải chuỗi rỗng", () => {
    for (const k of ["POSITION", "LEVEL_TAG"]) {
      expect(PHAM_VI_CHUA_KHOP_DUOC[k]!.length).toBeGreaterThan(20);
    }
  });

  it("giá trị scopeKind LẠ cũng không bị coi là 'không áp dụng'", () => {
    // Thêm một giá trị vào enum mà quên viết luật đối chiếu thì nó phải nổi lên,
    // không được lặng lẽ rơi vào nhánh "người này không thuộc phạm vi".
    const r = khopYeuCau(nguoi, [yc({ scopeKind: "PHAM_VI_MOI" })]);
    expect(r.apDung).toHaveLength(0);
    expect(r.khongDoiChieuDuoc).toHaveLength(1);
  });
});

describe("chu kỳ ngắn nhất", () => {
  it("lấy nhỏ nhất trong các yêu cầu áp dụng", () => {
    expect(
      chuKyNganNhat([yc({ validityMonths: 24 }), yc({ validityMonths: 6 })]),
    ).toBe(6);
  });

  it("bỏ qua null và số không dương", () => {
    expect(
      chuKyNganNhat([
        yc({ validityMonths: null }),
        yc({ validityMonths: 0 }),
        yc({ validityMonths: -1 }),
        yc({ validityMonths: 18 }),
      ]),
    ).toBe(18);
  });

  it("không yêu cầu nào đặt chu kỳ ⇒ null", () => {
    expect(chuKyNganNhat([yc({ validityMonths: null })])).toBeNull();
    expect(chuKyNganNhat([])).toBeNull();
  });
});
