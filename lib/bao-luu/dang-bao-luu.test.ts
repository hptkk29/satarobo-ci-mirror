// lib/bao-luu/dang-bao-luu.test.ts — phép hỏi "đang bảo lưu" THUẦN. PHIÊN 1.
//
// Mọi ngày là TUYỆT ĐỐI và `ngay` luôn được TRUYỀN (luật 19) — hàm không có đường rơi về
// đồng hồ thật nên không có ca nào hẹn giờ.
import { describe, it, expect } from "vitest";
import {
  capDangBaoLuu,
  capHocVienCuaDon,
  donDangBaoLuu,
  luotConHieuLuc,
  type LuotBaoLuu,
} from "./dang-bao-luu";

const BAT_DAU = new Date("2026-09-22T03:00:00Z");
const TRUOC = new Date("2026-09-21T00:00:00Z");
const SAU = new Date("2026-10-07T00:00:00Z");

function luot(p: Partial<LuotBaoLuu> = {}): LuotBaoLuu {
  return {
    id: "r1",
    studentId: "hs-binh",
    enrollmentId: null,
    startedAt: BAT_DAU,
    expectedEndAt: new Date("2026-10-22T00:00:00Z"),
    endedAt: null,
    isActive: true,
    ...p,
  };
}

describe("[BL1] luotConHieuLuc", () => {
  it("[BL1-01] chưa tới ngày bắt đầu ⇒ chưa hiệu lực; từ ngày bắt đầu ⇒ hiệu lực", () => {
    expect(luotConHieuLuc(luot(), TRUOC)).toBe(false);
    expect(luotConHieuLuc(luot(), BAT_DAU)).toBe(true);
    expect(luotConHieuLuc(luot(), SAU)).toBe(true);
  });

  it("[BL1-02] chưa đóng nhưng isActive=false ⇒ KHÔNG hiệu lực (cờ phi chuẩn hoá lệch thì đứng về phía không tha)", () => {
    expect(luotConHieuLuc(luot({ isActive: false }), SAU)).toBe(false);
  });

  it("[BL1-03] đã đóng ⇒ còn hiệu lực cho tới TRƯỚC endedAt, từ endedAt trở đi thì hết", () => {
    const dong = luot({ isActive: false, endedAt: new Date("2026-10-01T00:00:00Z") });
    expect(luotConHieuLuc(dong, new Date("2026-09-30T23:59:59Z"))).toBe(true);
    expect(luotConHieuLuc(dong, new Date("2026-10-01T00:00:00Z"))).toBe(false);
    expect(luotConHieuLuc(dong, SAU)).toBe(false);
  });

  it("[BL1-04] quá expectedEndAt mà chưa ai đóng lượt ⇒ VẪN đang bảo lưu (BR-19: quá hạn không tự chấm dứt)", () => {
    const quaHan = luot({ expectedEndAt: new Date("2026-09-30T00:00:00Z") });
    expect(luotConHieuLuc(quaHan, SAU)).toBe(true);
  });
});

describe("[BL1] capDangBaoLuu — hai vế enrollmentId", () => {
  it("[BL1-05] lượt CẢ HỌC VIÊN (enrollmentId=null) phủ mọi ghi danh của em đó", () => {
    const l = [luot({ enrollmentId: null })];
    expect(capDangBaoLuu({ studentId: "hs-binh", enrollmentId: "gd-1" }, l, SAU)).toBe(true);
    expect(capDangBaoLuu({ studentId: "hs-binh", enrollmentId: "gd-2" }, l, SAU)).toBe(true);
  });

  it("[BL1-06] lượt MỘT ghi danh chỉ phủ đúng ghi danh đó — bé học hai khoá, khoá kia vẫn đang học", () => {
    const l = [luot({ enrollmentId: "gd-1" })];
    expect(capDangBaoLuu({ studentId: "hs-binh", enrollmentId: "gd-1" }, l, SAU)).toBe(true);
    expect(capDangBaoLuu({ studentId: "hs-binh", enrollmentId: "gd-2" }, l, SAU)).toBe(false);
  });

  it("[BL1-07] hỏi khi chỉ biết học viên (enrollmentId=null) ⇒ chỉ lượt cả-học-viên mới phủ; lượt theo ghi danh KHÔNG", () => {
    // Fail-closed: không biết dòng thuộc ghi danh nào thì không dám nói "đang bảo lưu".
    const theoGhiDanh = [luot({ enrollmentId: "gd-1" })];
    const caHocVien = [luot({ enrollmentId: null })];
    expect(capDangBaoLuu({ studentId: "hs-binh", enrollmentId: null }, theoGhiDanh, SAU)).toBe(false);
    expect(capDangBaoLuu({ studentId: "hs-binh", enrollmentId: null }, caHocVien, SAU)).toBe(true);
  });

  it("[BL1-08] học viên khác ⇒ không", () => {
    expect(capDangBaoLuu({ studentId: "hs-an", enrollmentId: "gd-9" }, [luot()], SAU)).toBe(false);
  });

  it("[BL1-09] lượt đã hết hiệu lực không được cứu bởi lượt khác của học viên khác", () => {
    const l = [luot({ isActive: false, endedAt: TRUOC }), luot({ id: "r2", studentId: "hs-an" })];
    expect(capDangBaoLuu({ studentId: "hs-binh", enrollmentId: null }, l, SAU)).toBe(false);
  });
});

describe("[BL1] capHocVienCuaDon + donDangBaoLuu — mức ĐƠN (sổ trả góp cũ)", () => {
  const dong = (p: object) => ({
    type: "COURSE_ENROLLMENT",
    enrollmentId: null,
    enrollmentStudentId: null,
    studentId: null,
    ...p,
  });

  it("[BL1-10] bé suy từ ghi danh nối vào dòng; dòng chưa nối ghi danh thì suy từ OrderItem.studentId", () => {
    const cap = capHocVienCuaDon({
      orderStudentId: null,
      items: [
        dong({ enrollmentId: "gd-1", enrollmentStudentId: "hs-binh" }),
        dong({ studentId: "hs-an" }),
      ],
    });
    expect(cap).toEqual([
      { studentId: "hs-binh", enrollmentId: "gd-1" },
      { studentId: "hs-an", enrollmentId: null },
    ]);
  });

  it("[BL1-11] dòng KHOÁ HỌC không xác định được bé ⇒ null ⇒ KHÔNG BAO GIỜ bị coi là bảo lưu", () => {
    const cap = capHocVienCuaDon({
      orderStudentId: "hs-binh",
      items: [dong({ enrollmentId: "gd-1", enrollmentStudentId: "hs-binh" }), dong({})],
    });
    expect(cap).toBeNull();
    expect(donDangBaoLuu(cap, [luot()], SAU)).toBe(false);
  });

  it("[BL1-12] dòng không phải khoá học (kit…) bị bỏ qua; đơn chỉ có dòng như vậy rơi về Order.studentId", () => {
    const cap = capHocVienCuaDon({
      orderStudentId: "hs-binh",
      items: [{ type: "PRODUCT", enrollmentId: null, enrollmentStudentId: null, studentId: null }],
    });
    expect(cap).toEqual([{ studentId: "hs-binh", enrollmentId: null }]);
    expect(donDangBaoLuu(cap, [luot()], SAU)).toBe(true);
  });

  it("[BL1-13] đơn hai bé mà MỘT bé bảo lưu ⇒ đơn KHÔNG bảo lưu (bé kia còn đang học và đang nợ)", () => {
    const cap = capHocVienCuaDon({
      orderStudentId: null,
      items: [
        dong({ enrollmentId: "gd-1", enrollmentStudentId: "hs-binh" }),
        dong({ enrollmentId: "gd-2", enrollmentStudentId: "hs-an" }),
      ],
    });
    expect(donDangBaoLuu(cap, [luot({ enrollmentId: null })], SAU)).toBe(false);
  });

  it("[BL1-14] đơn hai bé mà CẢ HAI bảo lưu ⇒ bảo lưu", () => {
    const cap = capHocVienCuaDon({
      orderStudentId: null,
      items: [
        dong({ enrollmentId: "gd-1", enrollmentStudentId: "hs-binh" }),
        dong({ enrollmentId: "gd-2", enrollmentStudentId: "hs-an" }),
      ],
    });
    const l = [luot(), luot({ id: "r2", studentId: "hs-an" })];
    expect(donDangBaoLuu(cap, l, SAU)).toBe(true);
  });

  it("[BL1-15] đơn không có bé nào (cap rỗng hoặc null) ⇒ không bảo lưu", () => {
    expect(donDangBaoLuu([], [luot()], SAU)).toBe(false);
    expect(donDangBaoLuu(null, [luot()], SAU)).toBe(false);
  });
});
