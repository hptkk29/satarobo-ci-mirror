// @vitest-environment node
/**
 * [NHH-DSP-01] — ĐỒ THỊ TRẠNG THÁI của khiếu nại (04 §15, 05 AC-DSP-01): OPEN → UNDER_REVIEW → APPROVED | REJECTED → CLOSED.
 * Không nhảy cóc, không lùi. THUẦN — không DB.
 *
 * Bảng chuyển đủ 25 cặp (5 × 5) viết TAY ở đây, KHÔNG suy từ chính hằng của mã nguồn: một bảng test suy từ bảng nguồn là tautology
 * (luật 9). Nếu ai nới `CHUYEN_HOP_LE`, đúng một dòng ở đây đỏ.
 */
import { describe, it, expect } from "vitest";

import {
  CHUYEN_HOP_LE,
  TRANG_THAI_KHIEU_NAI,
  batChuyenTrangThai,
  kiemChuyenTrangThai,
  ketQuaKhieuNai,
  laDangMo,
  type TrangThaiKhieuNai,
} from "./khieu-nai-trang-thai";
import { HoaHongError } from "./kieu";

const O = "OPEN",
  U = "UNDER_REVIEW",
  A = "APPROVED",
  R = "REJECTED",
  C = "CLOSED";

/** Cặp ĐƯỢC PHÉP — đủ 4 cặp của đồ thị + 1 cặp APPROVED→CLOSED/REJECTED→CLOSED (cùng đích). */
const DUOC: ReadonlyArray<[TrangThaiKhieuNai, TrangThaiKhieuNai]> = [
  [O, U],
  [U, A],
  [U, R],
  [A, C],
  [R, C],
];

describe("[NHH-DSP-01] đồ thị trạng thái khiếu nại", () => {
  it("năm trạng thái đúng thứ tự, không thêm không bớt", () => {
    expect([...TRANG_THAI_KHIEU_NAI]).toEqual([O, U, A, R, C]);
  });

  it("[NHH-DSP-01] ĐỦ 25 cặp: đúng 5 cặp được phép, 20 cặp còn lại (kể cả giữ nguyên, lùi, nhảy cóc) bị từ chối", () => {
    let duoc = 0;
    for (const tu of TRANG_THAI_KHIEU_NAI) {
      for (const den of TRANG_THAI_KHIEU_NAI) {
        const kyVong = DUOC.some(([a, b]) => a === tu && b === den);
        const loi = kiemChuyenTrangThai(tu, den);
        expect(loi === null, `${tu} → ${den}: kỳ vọng ${kyVong ? "ĐƯỢC" : "TỪ CHỐI"}, thực tế ${loi ?? "được"}`).toBe(kyVong);
        if (kyVong) duoc += 1;
      }
    }
    expect(duoc).toBe(5);
  });

  it("câu từ chối nói cặp bị cấm bằng chữ người đọc được (không in mã enum trần)", () => {
    const loi = kiemChuyenTrangThai(O, A);
    expect(loi).toMatch(/Mới tiếp nhận/);
    expect(loi).toMatch(/Đã duyệt/);
    expect(loi).not.toMatch(/UNDER_REVIEW|APPROVED|OPEN/);
  });

  it("[NHH-DSP-01b] không lùi: APPROVED/REJECTED/CLOSED không về UNDER_REVIEW; REJECTED không đổi thành APPROVED và ngược lại", () => {
    expect(kiemChuyenTrangThai(R, U)).not.toBeNull();
    expect(kiemChuyenTrangThai(A, U)).not.toBeNull();
    expect(kiemChuyenTrangThai(R, A)).not.toBeNull();
    expect(kiemChuyenTrangThai(A, R)).not.toBeNull();
    for (const den of TRANG_THAI_KHIEU_NAI) expect(kiemChuyenTrangThai(C, den), `CLOSED → ${den}`).not.toBeNull();
  });

  it("batChuyenTrangThai ném HoaHongError mã CHUYEN_TRANG_THAI_SAI khi cấm; im lặng khi cho", () => {
    expect(() => batChuyenTrangThai(O, U)).not.toThrow();
    try {
      batChuyenTrangThai(R, U);
      throw new Error("phải ném");
    } catch (e) {
      expect(e).toBeInstanceOf(HoaHongError);
      expect((e as HoaHongError).ma).toBe("CHUYEN_TRANG_THAI_SAI");
    }
  });

  it("CHUYEN_HOP_LE khớp bảng viết tay (đối chứng hai chiều: không cặp thừa, không cặp thiếu)", () => {
    const tuMa = TRANG_THAI_KHIEU_NAI.flatMap((tu) => CHUYEN_HOP_LE[tu].map((den) => `${tu}>${den}`)).sort();
    expect(tuMa).toEqual(DUOC.map(([a, b]) => `${a}>${b}`).sort());
  });

  it("laDangMo: chỉ OPEN và UNDER_REVIEW là đang mở (đối chứng: các trạng thái còn lại không)", () => {
    expect(TRANG_THAI_KHIEU_NAI.filter(laDangMo)).toEqual([O, U]);
  });
});

describe("[NHH-DSP-01c] ketQuaKhieuNai — nhãn kết quả người dùng thấy suy từ cột, không từ riêng enum", () => {
  const goc = { resolution: null, decidedAt: null } as const;
  const ngay = new Date("2026-10-13T03:00:00.000Z");
  it("chưa quyết ⇒ chờ xử lý / đang xem xét", () => {
    expect(ketQuaKhieuNai({ status: O, ...goc })).toBe("CHO_XU_LY");
    expect(ketQuaKhieuNai({ status: U, ...goc })).toBe("DANG_XEM_XET");
  });
  it("APPROVED/CLOSED có cách giải ⇒ được duyệt theo đúng cách", () => {
    expect(ketQuaKhieuNai({ status: A, resolution: "SOURCE_CORRECTION", decidedAt: ngay })).toBe("DUOC_DUYET_DOI_NGUON");
    expect(ketQuaKhieuNai({ status: C, resolution: "MONEY_ADJUSTMENT", decidedAt: ngay })).toBe("DUOC_DUYET_DIEU_CHINH_TIEN");
  });
  it("REJECTED, và CLOSED không có cách giải ⇒ bị từ chối (CLOSED sau từ chối vẫn là 'từ chối')", () => {
    expect(ketQuaKhieuNai({ status: R, resolution: null, decidedAt: ngay })).toBe("TU_CHOI");
    expect(ketQuaKhieuNai({ status: C, resolution: null, decidedAt: ngay })).toBe("TU_CHOI");
  });
});
