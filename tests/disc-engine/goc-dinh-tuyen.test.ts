// PORT từ repo hodacphuchtc/DISC · tests/dinh-tuyen.test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c (chỉ đổi đường dẫn import).
import { describe, expect, it } from "vitest";

import {
  LOP_CUOI_TIEU_HOC,
  LOP_DAU_CAP_BA,
  LOP_LON_NHAT,
  LOP_MAM_NON,
  LOP_NHO_NHAT,
  LOP_TREN_12,
} from "@/lib/disc/engine-goc/config/disc-nguong";
import {
  LOP_CAO_NHAT_DUNG_BAN_QUAN_SAT,
  TUOI_TU_DANH_GIA_TOI_THIEU,
  boDeChoThanhVien,
  boDeQuanSatTheoLop,
  dinhTuyen,
  type DauVaoDinhTuyen,
} from "@/lib/disc/engine-goc/modules/test/dinh-tuyen";

/**
 * 🔴 ĐỌC TỪ `config/`, KHÔNG GÕ CỨNG.
 *
 * Trước 11.5 dòng này là `[1,2,3,4,5,6,7,8,9]`. Khi trần lớp nới lên 12, danh sách gõ cứng
 * ấy vẫn xanh y như cũ — nó chỉ lặng lẽ thôi kiểm ba lớp mới. Một cửa kiểm không còn kiểm
 * cái nó nói là đang kiểm thì tệ hơn không có, vì nó vẫn đọc lên đầy yên tâm.
 */
const LOP = Array.from(
  { length: LOP_LON_NHAT - LOP_NHO_NHAT + 1 },
  (_, i) => LOP_NHO_NHAT + i,
);

describe("định tuyến — bảng đầy đủ", () => {
  it("Mầm non ⇒ bộ MN, không hỏi thêm gì", () => {
    expect(dinhTuyen({ doiTuong: "mam-non" })).toEqual({ xong: true, boDe: "MN" });
  });

  it("THCS ⇒ bộ THCS, không hỏi thêm gì", () => {
    expect(dinhTuyen({ doiTuong: "thcs" })).toEqual({ xong: true, boDe: "THCS" });
  });

  it("Tiểu học chưa biết lớp ⇒ hỏi lớp, KHÔNG đoán bừa", () => {
    expect(dinhTuyen({ doiTuong: "tieu-hoc" })).toEqual({ xong: false, hoiThem: "lop" });
  });

  it.each([1, 2])("Tiểu học lớp %i ⇒ bộ MN KÈM giải thích", (lop) => {
    expect(dinhTuyen({ doiTuong: "tieu-hoc", lop })).toEqual({
      xong: true,
      boDe: "MN",
      giaiThich: "LOP_1_2",
    });
  });

  it.each([3, 4, 5])("Tiểu học lớp %i ⇒ bộ TH, bé tự làm", (lop) => {
    expect(dinhTuyen({ doiTuong: "tieu-hoc", lop })).toEqual({ xong: true, boDe: "TH" });
  });

  it("🔴 lớp 1 và lớp 2 KHÔNG BAO GIỜ ra bộ TH — quét toàn bộ 12 lớp", () => {
    for (const lop of LOP) {
      const kq = dinhTuyen({ doiTuong: "tieu-hoc", lop });
      if (!kq.xong) throw new Error("phải xong");
      if (lop <= LOP_CAO_NHAT_DUNG_BAN_QUAN_SAT) {
        expect(kq.boDe, `Lớp ${lop} bị đẩy sang bộ ${kq.boDe}`).toBe("MN");
      } else {
        expect(kq.boDe).not.toBe("MN");
      }
    }
  });

  it("chuyển sang bản quan sát thì LUÔN kèm mã giải thích — không chuyển im lặng", () => {
    for (const lop of [1, 2]) {
      const kq = dinhTuyen({ doiTuong: "tieu-hoc", lop });
      if (!kq.xong) throw new Error("phải xong");
      expect(kq.giaiThich).toBeDefined();
    }
    // Còn lớp 3–5 thì không có gì để giải thích.
    for (const lop of [3, 4, 5]) {
      const kq = dinhTuyen({ doiTuong: "tieu-hoc", lop });
      if (!kq.xong) throw new Error("phải xong");
      expect(kq.giaiThich).toBeUndefined();
    }
  });

  it("Phụ huynh chưa chọn mục tiêu ⇒ hỏi mục tiêu", () => {
    expect(dinhTuyen({ doiTuong: "phu-huynh" })).toEqual({ xong: false, hoiThem: "muc-tieu" });
  });

  it("Phụ huynh · về chính mình ⇒ bộ PH, không cần hỏi tuổi con", () => {
    expect(dinhTuyen({ doiTuong: "phu-huynh", mucTieu: "toi" })).toEqual({
      xong: true,
      boDe: "PH",
    });
  });

  it("Phụ huynh · về con nhưng chưa biết tuổi ⇒ hỏi tuổi con", () => {
    expect(dinhTuyen({ doiTuong: "phu-huynh", mucTieu: "con" })).toEqual({
      xong: false,
      hoiThem: "tuoi-con",
    });
  });

  it.each([8, 9, 12, 15])("Phụ huynh · con %i tuổi ⇒ bộ QS", (tuoiCon) => {
    expect(dinhTuyen({ doiTuong: "phu-huynh", mucTieu: "con", tuoiCon })).toEqual({
      xong: true,
      boDe: "QS",
    });
  });

  it.each([3, 5, 7])("Phụ huynh · con %i tuổi ⇒ bộ MN KÈM giải thích, KHÔNG ra QS", (tuoiCon) => {
    expect(dinhTuyen({ doiTuong: "phu-huynh", mucTieu: "con", tuoiCon })).toEqual({
      xong: true,
      boDe: "MN",
      giaiThich: "CON_DUOI_8",
    });
  });

  it("biên tuổi: đúng 8 tuổi thì ra QS, 7 tuổi thì không", () => {
    expect(TUOI_TU_DANH_GIA_TOI_THIEU).toBe(8);
    const o8 = dinhTuyen({ doiTuong: "phu-huynh", mucTieu: "con", tuoiCon: 8 });
    const o7 = dinhTuyen({ doiTuong: "phu-huynh", mucTieu: "con", tuoiCon: 7 });
    if (!o8.xong || !o7.xong) throw new Error("phải xong");
    expect(o8.boDe).toBe("QS");
    expect(o7.boDe).toBe("MN");
  });

  it("🔴 KHÔNG đường nào đưa trẻ dưới 8 tuổi vào bộ tự làm (TH hoặc THCS)", () => {
    const moiDauVao: DauVaoDinhTuyen[] = [
      { doiTuong: "mam-non" },
      ...LOP.map((lop) => ({ doiTuong: "tieu-hoc" as const, lop })),
      ...[3, 4, 5, 6, 7].map((tuoiCon) => ({
        doiTuong: "phu-huynh" as const,
        mucTieu: "con" as const,
        tuoiCon,
      })),
    ];
    for (const dv of moiDauVao) {
      const kq = dinhTuyen(dv);
      if (!kq.xong) continue;
      const treNho =
        dv.doiTuong === "mam-non" ||
        (dv.lop !== undefined && dv.lop <= 2) ||
        (dv.tuoiCon !== undefined && dv.tuoiCon < 8);
      if (treNho) {
        expect(["TH", "THCS"], `${JSON.stringify(dv)} ra bộ ${kq.boDe}`).not.toContain(kq.boDe);
      }
    }
  });
});

describe("🔴 11.5 — cấp ba trở lên", () => {
  /**
   * Trước 11.5 trần lớp là 9. Một em lớp 10 mở khoang ra, không thấy lớp mình đâu, và
   * cũng không có lối nào khác — trong khi em ấy chính là con của tệp gia đình mà cả
   * GĐ11–14 sinh ra để giữ chân.
   *
   * Cách gỡ rẻ nhất: dùng lại bộ PH, vốn là bản TỰ ĐÁNH GIÁ cho người lớn, thang 5 mức,
   * câu chữ người lớn — đúng thứ một em lớp 11 cần. Không dựng bộ đề thứ sáu.
   */
  it.each([10, 11, 12])("lớp %i ⇒ bộ PH, tự đánh giá", (lop) => {
    expect(dinhTuyen({ doiTuong: "cap-ba-tro-len", lop })).toEqual({ xong: true, boDe: "PH" });
  });

  it("đã qua lớp 12 (không có số lớp) ⇒ vẫn ra bộ PH, không hỏi thêm gì", () => {
    expect(dinhTuyen({ doiTuong: "cap-ba-tro-len" })).toEqual({ xong: true, boDe: "PH" });
  });

  it("🔴 quét ĐỦ 12 lớp: mỗi lớp ra đúng một bộ, không lớp nào rơi ra ngoài", () => {
    const mong = (lop: number) => {
      if (lop >= LOP_DAU_CAP_BA) return "PH";
      if (lop <= LOP_CAO_NHAT_DUNG_BAN_QUAN_SAT) return "MN";
      if (lop <= LOP_CUOI_TIEU_HOC) return "TH";
      return "THCS";
    };

    for (let lop = LOP_NHO_NHAT; lop <= LOP_LON_NHAT; lop += 1) {
      const doiTuong =
        lop >= LOP_DAU_CAP_BA
          ? "cap-ba-tro-len"
          : lop <= LOP_CUOI_TIEU_HOC
            ? "tieu-hoc"
            : "thcs";
      const kq = dinhTuyen({ doiTuong, lop });
      if (!kq.xong) throw new Error(`lớp ${lop} chưa xong`);
      expect(kq.boDe, `lớp ${lop}`).toBe(mong(lop));
    }
  });

  it("🔴 ADR-002 KHÔNG bị nới theo: lớp 1–2 vẫn ra bộ MN kèm giải thích", () => {
    // Nới trần lớp là chuyện của đầu trên. Sàn tự đánh giá 8 tuổi là chuyện khác hẳn, và
    // nó là thứ đắt nhất trong cả sản phẩm — nới nhầm ở đây là bịa số về một đứa trẻ.
    for (const lop of [1, 2]) {
      expect(dinhTuyen({ doiTuong: "tieu-hoc", lop })).toEqual({
        xong: true,
        boDe: "MN",
        giaiThich: "LOP_1_2",
      });
    }
  });

  it("cấp ba KHÔNG kèm mã giải thích — không có gì bị chuyển hướng cả", () => {
    const kq = dinhTuyen({ doiTuong: "cap-ba-tro-len", lop: 11 });
    if (!kq.xong) throw new Error("phải xong");
    expect(kq.giaiThich).toBeUndefined();
  });
});

/* ── Bộ đề cho MỘT NGƯỜI TRONG SỔ (V1.3) ─────────────────────────────────── */

describe("boDeChoThanhVien — vai + bậc học, không hỏi lại gì", () => {
  /**
   * 🔴 BẢNG NÀY LÀ BẢN ĐẶC TẢ ĐỌC ĐƯỢC của luồng vào bài từ thẻ thành viên.
   * Thêm một cửa thứ hai vào bộ nào là thấy ngay ở đây.
   */
  const BANG = [
    { vai: "me", lop: undefined, boDe: "PH", ho: false, ghiChu: "mẹ tự đánh giá" },
    { vai: "bo", lop: undefined, boDe: "PH", ho: false, ghiChu: "bố tự đánh giá" },
    { vai: "ong", lop: undefined, boDe: "PH", ho: false, ghiChu: "ông tự đánh giá" },
    { vai: "ba", lop: undefined, boDe: "PH", ho: false, ghiChu: "bà tự đánh giá" },
    { vai: "nguoi-than", lop: undefined, boDe: "PH", ho: false, ghiChu: "người thân" },
    { vai: "khac", lop: undefined, boDe: "PH", ho: false, ghiChu: "vai khác" },
    { vai: "con", lop: LOP_MAM_NON, boDe: "MN", ho: true, ghiChu: "mầm non — người lớn trả lời hộ" },
    { vai: "con", lop: "1", boDe: "MN", ho: true, giai: "LOP_1_2", ghiChu: "lớp 1" },
    { vai: "con", lop: "2", boDe: "MN", ho: true, giai: "LOP_1_2", ghiChu: "lớp 2" },
    { vai: "con", lop: "3", boDe: "TH", ho: false, ghiChu: "lớp 3 tự làm" },
    { vai: "con", lop: "5", boDe: "TH", ho: false, ghiChu: "lớp 5 tự làm" },
    { vai: "con", lop: "6", boDe: "THCS", ho: false, ghiChu: "lớp 6 tự làm" },
    { vai: "con", lop: "9", boDe: "THCS", ho: false, ghiChu: "lớp 9 tự làm" },
    { vai: "con", lop: "10", boDe: "PH", ho: false, ghiChu: "lớp 10 dùng bản người lớn" },
    { vai: "con", lop: "12", boDe: "PH", ho: false, ghiChu: "lớp 12" },
    { vai: "con", lop: LOP_TREN_12, boDe: "PH", ho: false, ghiChu: "đã qua lớp 12" },
    { vai: "anh-chi-em", lop: "8", boDe: "THCS", ho: false, ghiChu: "anh chị em đang đi học" },
  ] as const;

  for (const d of BANG) {
    it(`${d.ghiChu} → bộ ${d.boDe}`, () => {
      const kq = boDeChoThanhVien(d.vai, d.lop);
      expect(kq, `${d.ghiChu} không ra bộ đề nào`).not.toBeNull();
      expect(kq!.boDe).toBe(d.boDe);
      expect(kq!.nguoiLonTraLoiHo).toBe(d.ho);
      expect(kq!.giaiThich).toBe("giai" in d ? d.giai : undefined);
    });
  }

  it("🔴 KHÔNG người lớn nào bị đá về màn hỏi lại — đây là lỗi V1.3 sinh ra để sửa", () => {
    for (const vai of ["me", "bo", "ong", "ba", "nguoi-than", "khac"] as const) {
      expect(boDeChoThanhVien(vai, undefined), `vai ${vai} vẫn bị trả null`).not.toBeNull();
    }
  });

  it("🔴 trẻ mầm non KHÔNG bị trả null vì Number('mam-non') ra NaN", () => {
    expect(boDeChoThanhVien("con", LOP_MAM_NON)).not.toBeNull();
  });

  it("người đang đi học mà chưa chọn bậc thì trả null — không đoán bừa bộ đề cho trẻ", () => {
    expect(boDeChoThanhVien("con", undefined)).toBeNull();
    expect(boDeChoThanhVien("con", "")).toBeNull();
    expect(boDeChoThanhVien("anh-chi-em", "lop bay")).toBeNull();
  });

  it("🔴 lớp 1–2 LUÔN kèm lý do chuyển bản — chuyển im lặng là lừa người dùng", () => {
    for (const l of ["1", "2"]) {
      expect(boDeChoThanhVien("con", l)!.giaiThich).toBe("LOP_1_2");
    }
    // Và lớp 3 thì KHÔNG có lý do nào, vì em ấy không bị chuyển đi đâu cả.
    expect(boDeChoThanhVien("con", "3")!.giaiThich).toBeUndefined();
  });
});

describe("boDeQuanSatTheoLop — nút phụ trên thẻ của trẻ", () => {
  it("từ lớp 3 trở lên mở bộ QS", () => {
    for (const l of ["3", "5", "7", "9", "12"]) {
      expect(boDeQuanSatTheoLop(l), `lớp ${l}`).toBe("QS");
    }
  });

  it("mầm non và lớp 1–2 ra bộ MN — bài chính của các em vốn đã là bản người lớn trả lời", () => {
    expect(boDeQuanSatTheoLop(LOP_MAM_NON)).toBe("MN");
    expect(boDeQuanSatTheoLop("1")).toBe("MN");
    expect(boDeQuanSatTheoLop("2")).toBe("MN");
  });

  it("chưa có bậc thì không mở nút nào", () => {
    expect(boDeQuanSatTheoLop(undefined)).toBeNull();
    expect(boDeQuanSatTheoLop(LOP_TREN_12)).toBeNull();
  });

  it("🔴 cửa ADR-002 phát biểu bằng LỚP không được lệch khỏi bản phát biểu bằng TUỔI", () => {
    // `dinhTuyen` gác bộ QS bằng `tuoiCon >= 8`; ở đây gác bằng `lop >= 3`. Hai cách nói
    // về cùng một hàng rào, nên chúng phải cùng kết luận ở mọi lứa — nếu không thì sổ gia
    // đình đang đi vòng qua đúng hàng rào đắt nhất của sản phẩm.
    expect(boDeQuanSatTheoLop("2")).toBe(
      (dinhTuyen({ doiTuong: "phu-huynh", mucTieu: "con", tuoiCon: 7 }) as { boDe: string }).boDe,
    );
    expect(boDeQuanSatTheoLop("3")).toBe(
      (dinhTuyen({ doiTuong: "phu-huynh", mucTieu: "con", tuoiCon: 8 }) as { boDe: string }).boDe,
    );
  });
});
