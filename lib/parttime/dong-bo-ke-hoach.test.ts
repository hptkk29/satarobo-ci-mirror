// [PT3A-P*] Công Parttime SR.QD.238 · P3a — luật THUẦN của bộ đồng bộ (`keHoachDongBo`). Phần chạm DB (khoá, ghi,
// thông báo, vòng đời thật) ở tests/cham-cong/parttime-dong-bo.spec.ts.
import { describe, expect, it } from "vitest";
import { keHoachDongBo, type KyVongBuoi, type PhanCongDangCo } from "./phan-cong";

const LICH = { sourceType: "CLASS_SESSION", sourceId: "s1", centerId: "cs1", ngay: "2026-11-02", gioBatDau: "17:30", gioKetThuc: "19:30" };
const kv = (p: Partial<KyVongBuoi> = {}): KyVongBuoi => ({
  tinhTrang: "MO",
  lyDoDong: null,
  apDung: true,
  congTacBat: true,
  lich: LICH,
  main: { userId: "gv", kieu: "SYSTEM" },
  ta: null,
  nguoiDayThay: null,
  ...p,
});
let soId = 0;
const pc = (p: Partial<PhanCongDangCo> & Pick<PhanCongDangCo, "userId">): PhanCongDangCo => {
  const role = p.role ?? "MAIN_TEACHER";
  return { id: `pc${++soId}`, role, status: "WAITING_ACCEPTANCE", assignmentType: "SYSTEM", nguonGiao: "DONG_BO", nghiaVu: { ...LICH, role }, ...p };
};
const loai = (b: ReturnType<typeof keHoachDongBo>) => b.map((x) => x.loai);

describe("[PT3A-P] keHoachDongBo — luật thuần", () => {
  it("[PT3A-P01] chưa có gì + công tắc bật ⇒ TẠO đúng một MAIN (+ một TA khi có)", () => {
    expect(keHoachDongBo(kv(), [])).toEqual([{ loai: "TAO", role: "MAIN_TEACHER", userId: "gv", kieu: "SYSTEM" }]);
    expect(loai(keHoachDongBo(kv({ ta: { userId: "ta" } }), []))).toEqual(["TAO", "TAO"]);
  });

  it("[PT3A-P02] đã khớp ⇒ KHÔNG bước nào (idempotent)", () => {
    expect(keHoachDongBo(kv(), [pc({ userId: "gv", status: "ACCEPTED" })])).toEqual([]);
  });

  it("[PT3A-P03] buổi DA_CHOT ⇒ đóng băng: không huỷ, không đổi lịch, không tạo", () => {
    const cu = pc({ userId: "gv", status: "ACCEPTED", nghiaVu: { ...LICH, role: "MAIN_TEACHER", gioBatDau: "08:00" } });
    expect(keHoachDongBo(kv({ tinhTrang: "DA_CHOT", main: { userId: "khac", kieu: "SYSTEM" } }), [cu])).toEqual([]);
  });

  it("[PT3A-P04] DA_DONG ⇒ HUỶ mọi phân công sống chưa chốt — KỂ CẢ khi công tắc tắt; COMPLETED chỉ báo ngoại lệ", () => {
    const a = pc({ userId: "gv", status: "ACCEPTED" });
    const b = pc({ userId: "ta", role: "TEACHING_ASSISTANT", status: "COMPLETED" });
    const c = pc({ userId: "x", status: "CANCELLED" });
    const r = keHoachDongBo(kv({ tinhTrang: "DA_DONG", lyDoDong: "Lớp đã huỷ", congTacBat: false }), [a, b, c]);
    expect(r).toEqual([
      { loai: "HUY", id: a.id, lyDo: "Lớp đã huỷ" },
      { loai: "NGOAI_LE", ma: "DA_CHOT_NHUNG_BUOI_DONG", role: "TEACHING_ASSISTANT", userId: "ta", chiTiet: expect.any(String) },
    ]);
  });

  it("[PT3A-P05] ngày trước 15/10 ⇒ huỷ phân công SR.QD.238 còn sống (không dựng dù công tắc bật)", () => {
    const a = pc({ userId: "gv" });
    expect(keHoachDongBo(kv({ apDung: false }), [a])).toEqual([{ loai: "HUY", id: a.id, lyDo: expect.stringContaining("15/10") }]);
    expect(keHoachDongBo(kv({ apDung: false }), [])).toEqual([]);
  });

  it("[PT3A-P06] công tắc TẮT + buổi mở ⇒ không dựng, không thay, không tăng phiên bản", () => {
    const lech = pc({ userId: "cu", nghiaVu: { ...LICH, role: "MAIN_TEACHER", gioBatDau: "08:00" } });
    expect(keHoachDongBo(kv({ congTacBat: false }), [lech])).toEqual([]);
    expect(keHoachDongBo(kv({ congTacBat: false }), [])).toEqual([]);
  });

  it("[PT3A-P07] GV mặc định đổi ⇒ THAY phân công SYSTEM; giữ kiểu của mặc định (SUBSTITUTE khi buổi có người thay)", () => {
    const cu = pc({ userId: "gv" });
    expect(keHoachDongBo(kv({ main: { userId: "gv2", kieu: "SYSTEM" } }), [cu])).toEqual([{ loai: "THAY", cuId: cu.id, role: "MAIN_TEACHER", userId: "gv2", kieu: "SYSTEM" }]);
    expect(keHoachDongBo(kv({ main: { userId: "thay", kieu: "SUBSTITUTE" }, nguoiDayThay: "thay" }), [cu])).toEqual([
      { loai: "THAY", cuId: cu.id, role: "MAIN_TEACHER", userId: "thay", kieu: "SUBSTITUTE" },
    ]);
  });

  it("[PT3A-P08] SUBSTITUTE còn được buổi chống lưng ⇒ KHÔNG bị thay; thôi chống lưng ⇒ thay được", () => {
    const sub = pc({ userId: "thay", assignmentType: "SUBSTITUTE" });
    const r = keHoachDongBo(kv({ main: { userId: "thay", kieu: "SUBSTITUTE" }, nguoiDayThay: "thay" }), [sub]);
    expect(r).toEqual([]);
    // Ngay cả khi mặc định (vì lý do nào đó) là người khác mà buổi vẫn chỉ người thay ⇒ ngoại lệ, không ghi đè.
    expect(loai(keHoachDongBo(kv({ main: { userId: "gv2", kieu: "SYSTEM" }, nguoiDayThay: "thay" }), [sub]))).toEqual(["NGOAI_LE"]);
    expect(keHoachDongBo(kv({ nguoiDayThay: null }), [sub])).toEqual([{ loai: "THAY", cuId: sub.id, role: "MAIN_TEACHER", userId: "gv", kieu: "SYSTEM" }]);
  });

  it("[PT3A-P09] MANUAL khác mặc định ⇒ NGOẠI LỆ, không ghi đè, không MAIN thứ hai", () => {
    const tay = pc({ userId: "qlcs-chon", assignmentType: "MANUAL" });
    const r = keHoachDongBo(kv(), [tay]);
    expect(r).toEqual([{ loai: "NGOAI_LE", ma: "LECH_PHAN_CONG_TAY", role: "MAIN_TEACHER", userId: "gv", chiTiet: expect.any(String) }]);
  });

  it("[PT3A-P10] lịch đổi đáng kể ⇒ DOI_LICH cho phân công được GIỮ (gồm cả MANUAL), không cho cái bị thay", () => {
    const lech = { ...LICH, gioBatDau: "08:00" };
    const giu = pc({ userId: "gv", status: "ACCEPTED", nghiaVu: { ...lech, role: "MAIN_TEACHER" } });
    expect(keHoachDongBo(kv(), [giu])).toEqual([{ loai: "DOI_LICH", id: giu.id }]);
    const tay = pc({ userId: "khac", assignmentType: "MANUAL", nghiaVu: { ...lech, role: "MAIN_TEACHER" } });
    expect(loai(keHoachDongBo(kv(), [tay]))).toEqual(["NGOAI_LE", "DOI_LICH"]);
    const bi = pc({ userId: "gv", nghiaVu: { ...lech, role: "MAIN_TEACHER" } });
    expect(loai(keHoachDongBo(kv({ main: { userId: "gv2", kieu: "SYSTEM" } }), [bi]))).toEqual(["THAY"]);
  });

  it("[PT3A-P11] đổi cơ sở / đổi nguồn là đổi đáng kể (chuyển buổi sang lớp khác cơ sở)", () => {
    const giu = pc({ userId: "gv", status: "ACCEPTED" });
    expect(keHoachDongBo(kv({ lich: { ...LICH, centerId: "cs2" } }), [giu])).toEqual([{ loai: "DOI_LICH", id: giu.id }]);
  });

  it("[PT3A-P12] cặp (người, vai) đã TỪ CHỐI ⇒ không dựng lại người đó vào vai đó; người khác thì dựng", () => {
    const tc = pc({ userId: "gv", status: "DECLINED" });
    expect(keHoachDongBo(kv(), [tc])).toEqual([]);
    expect(keHoachDongBo(kv({ main: { userId: "gv2", kieu: "SYSTEM" } }), [tc])).toEqual([{ loai: "TAO", role: "MAIN_TEACHER", userId: "gv2", kieu: "SYSTEM" }]);
  });

  it("[PT3A-P13] MAIN đã COMPLETED ⇒ không dựng MAIN thứ hai dù mặc định đổi", () => {
    const xong = pc({ userId: "gv", status: "COMPLETED" });
    expect(keHoachDongBo(kv({ main: { userId: "gv2", kieu: "SYSTEM" } }), [xong])).toEqual([]);
  });

  it("[PT3A-P14] một người không hai vai: mặc định MAIN đang giữ TA ⇒ ngoại lệ TRUNG_VAI, không tạo", () => {
    const taSong = pc({ userId: "gv", role: "TEACHING_ASSISTANT" });
    const r = keHoachDongBo(kv(), [taSong]);
    expect(r.find((x) => x.loai === "TAO")).toBeUndefined();
    expect(r.some((x) => x.loai === "NGOAI_LE" && x.ma === "TRUNG_VAI")).toBe(true);
  });

  it("[PT3A-P15] TA: mặc định đổi ⇒ THAY TA dẫn xuất; gỡ ⇒ HUỶ TA dẫn xuất; TA phân tay thắng (ngoại lệ, không thêm TA thứ hai)", () => {
    const ta = pc({ userId: "ta", role: "TEACHING_ASSISTANT" });
    expect(keHoachDongBo(kv({ ta: { userId: "ta2" } }), [pc({ userId: "gv" }), ta]).filter((x) => x.loai !== "DOI_LICH")).toEqual([
      { loai: "THAY", cuId: ta.id, role: "TEACHING_ASSISTANT", userId: "ta2", kieu: "SYSTEM" },
    ]);
    expect(keHoachDongBo(kv({ ta: null }), [pc({ userId: "gv" }), ta])).toEqual([{ loai: "HUY", id: ta.id, lyDo: expect.any(String) }]);
    const tay = pc({ userId: "tay", role: "TEACHING_ASSISTANT", assignmentType: "MANUAL" });
    expect(loai(keHoachDongBo(kv({ ta: { userId: "ta2" } }), [pc({ userId: "gv" }), tay]))).toEqual(["NGOAI_LE"]);
    expect(keHoachDongBo(kv({ ta: null }), [pc({ userId: "gv" }), tay])).toEqual([]);
  });

  it("[PT3A-P16] mặc định không còn GV ⇒ huỷ MAIN dẫn xuất; dòng đã đóng không bao giờ là đầu vào để 'sống lại'", () => {
    const cu = pc({ userId: "gv" });
    expect(keHoachDongBo(kv({ main: null }), [cu])).toEqual([{ loai: "HUY", id: cu.id, lyDo: expect.any(String) }]);
    const daHuy = pc({ userId: "gv", status: "CANCELLED" });
    const daThay = pc({ userId: "gv", status: "REPLACED" });
    // Có dòng CANCELLED/REPLACED của chính người mặc định ⇒ vẫn TẠO dòng MỚI (không đụng dòng cũ).
    expect(keHoachDongBo(kv(), [daHuy, daThay])).toEqual([{ loai: "TAO", role: "MAIN_TEACHER", userId: "gv", kieu: "SYSTEM" }]);
  });
});

describe("[PCG2-DB] GĐ2 phân công gộp — đồng bộ một chiều KHÔNG đè dòng do người quyết (chốt 6)", () => {
  it("[PCG2-DB01] MAIN mang nguồn TAY / AP_KHUNG / TU_XEP_BU_TRIAL (dù loại SYSTEM) ⇒ không THAY, chỉ báo LECH_PHAN_CONG_TAY", () => {
    for (const nguonGiao of ["TAY", "AP_KHUNG", "TU_XEP_BU_TRIAL"] as const) {
      const b = keHoachDongBo(kv({ main: { userId: "gvMoi", kieu: "SYSTEM" } }), [pc({ userId: "gv", status: "ACCEPTED", assignmentType: "SYSTEM", nguonGiao })]);
      expect(loai(b)).toEqual(["NGOAI_LE"]);
      expect(b[0]).toMatchObject({ ma: "LECH_PHAN_CONG_TAY" });
    }
  });
  it("[PCG2-DB02] đối chứng dương: cùng dòng mang nguồn DONG_BO ⇒ đồng bộ THAY bình thường", () => {
    expect(loai(keHoachDongBo(kv({ main: { userId: "gvMoi", kieu: "SYSTEM" } }), [pc({ userId: "gv", status: "ACCEPTED", assignmentType: "SYSTEM", nguonGiao: "DONG_BO" })]))).toEqual(["THAY"]);
  });
  it("[PCG2-DB03] buổi không còn GV mặc định: MAIN nguồn TAY KHÔNG bị huỷ (đối chứng: DONG_BO bị huỷ)", () => {
    expect(loai(keHoachDongBo(kv({ main: null }), [pc({ userId: "gv", status: "ACCEPTED", nguonGiao: "TAY" })]))).toEqual(["NGOAI_LE"]);
    expect(loai(keHoachDongBo(kv({ main: null }), [pc({ userId: "gv", status: "ACCEPTED", nguonGiao: "DONG_BO" })]))).toEqual(["HUY"]);
  });
  it("[PCG2-DB04] trợ giảng mặc định bị GỠ TAY (CANCELLED + nguồn TAY) ⇒ không dựng lại đúng người đó; đối chứng: huỷ do đồng bộ ⇒ dựng lại", () => {
    const goTay = pc({ userId: "ta", role: "TEACHING_ASSISTANT", status: "CANCELLED", nguonGiao: "TAY" });
    const huyDongBo = pc({ userId: "ta", role: "TEACHING_ASSISTANT", status: "CANCELLED", nguonGiao: "DONG_BO" });
    const main = pc({ userId: "gv", status: "ACCEPTED" });
    expect(keHoachDongBo(kv({ ta: { userId: "ta" } }), [main, goTay])).toEqual([]);
    expect(keHoachDongBo(kv({ ta: { userId: "ta" } }), [main, huyDongBo])).toEqual([{ loai: "TAO", role: "TEACHING_ASSISTANT", userId: "ta", kieu: "SYSTEM" }]);
  });
  it("[PCG2-DB05] buổi ĐÃ ĐÓNG vẫn huỷ cả dòng TAY (buổi không còn — không có gì để giữ)", () => {
    expect(loai(keHoachDongBo(kv({ tinhTrang: "DA_DONG", lyDoDong: "Buổi đã huỷ" }), [pc({ userId: "gv", status: "ACCEPTED", nguonGiao: "TAY" })]))).toEqual(["HUY"]);
  });
});
