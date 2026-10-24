// [SRC-INT-79] — LEAD NHÃN CŨ ĐẠI DIỆN của đường tường minh `uat-nap-lead-cu-*` (lane F5, 20/10/2026): phần THUẦN (không DB). Phần chạm Postgres ở `tests/hoa-hong/uat-nguon-final-lead-cu.spec.ts` ([SRC-INT-82]);
// phần dây nối script/workflow ở `nguon-final-wiring.test.ts` ([SRC-INT-80/81]).
//
// Vì sao một tệp riêng: `nguon-final.test.ts` đo bộ nạp chung (3 lead nhãn cũ, dải SĐT 09904) — hai bộ cố ý tách để đổi bộ này không đổi hành vi `uat-nap-ghi`.
// Quy ước: KHÔNG viết lại luật quy nguồn ở đây — nhóm / lý do xem tay mong đợi được đo bằng CHÍNH `anhXaNhanCu` + `tomTatDiTru` (hai hàm mà báo cáo vét lead cũ dùng).
import { describe, expect, it } from "vitest";

import { MOC_KHAO_SAT_0610, MOC_NGUOI_NHAP, anhXaNhanCu, chuanHoaNhanNguon, laNhanDaChot, tomTatDiTru, type HangDiTru } from "../nguon/anh-xa-nhan-cu";
import { LEAD_CU, LEAD_CU_DAI_DIEN, TIEN_TO_NGUON_FINAL, lopLeadCuDaiDien, phoneLeadCu, phoneLeadCuDaiDien, tenLeadCuDaiDien } from "./nguon-final";

const anh = (nhan: string, createdAt: Date) => anhXaNhanCu({ nhan, createdAt, affiliate: null, nguoiNhap: null, maNvTrongNote: null }, [], "EMPLOYEE_REFERRAL");
const nhomCua = (nhan: string, d: Date): string => {
  const k = anh(nhan, d);
  if (k.loai === "INVALID") throw new Error(`nhãn ${nhan} INVALID`);
  return k.nhom;
};
/** Quá khứ so với mọi `--den` hợp lý của lượt UAT (hôm nay ≥ 20/10/2026). */
const GIOI_HAN_QUA_KHU = new Date("2026-10-08T00:00:00.000Z");
const theoMa = (ma: string) => LEAD_CU_DAI_DIEN.find((l) => l.ma === ma)!;

describe("[SRC-INT-79] lead nhãn cũ ĐẠI DIỆN ra đúng lớp qua luật thật", () => {
  it("[SRC-INT-79a] mã duy nhất; mọi nhãn nằm trong bảng 28 nhãn (0 INVALID); nhóm + lý do xem tay khớp CHÍNH luật thật; AUTO ⇒ xemTay rỗng", () => {
    expect(LEAD_CU_DAI_DIEN.length).toBe(16);
    expect(new Set(LEAD_CU_DAI_DIEN.map((l) => l.ma)).size, "mã trùng").toBe(LEAD_CU_DAI_DIEN.length);
    for (const lc of LEAD_CU_DAI_DIEN) {
      expect(laNhanDaChot(lc.nhan), `${lc.ma}: nhãn «${lc.nhan}» phải nằm trong bảng 28 nhãn`).toBe(true);
      const kq = anh(lc.nhan, lc.taoLuc);
      expect(kq.loai, lc.ma).not.toBe("INVALID");
      if (kq.loai === "INVALID") continue;
      expect(kq.nhom, `${lc.ma}: nhóm`).toBe(lc.nhom);
      expect(kq.xemTay, `${lc.ma}: lý do xem tay`).toEqual(lc.xemTay === null ? [] : [lc.xemTay]);
    }
  });

  it("[SRC-INT-79b] ngày tạo TUYỆT ĐỐI và ở QUÁ KHỨ; đứng đúng phía của hai mốc quyết định; đối chứng ÂM: đảo phía mốc thì kết quả đổi (ngày trong fixture là bắt buộc)", () => {
    for (const lc of LEAD_CU_DAI_DIEN) expect(lc.taoLuc.getTime(), `${lc.ma}: phải ở quá khứ`).toBeLessThan(GIOI_HAN_QUA_KHU.getTime());
    expect(theoMa("KHAC_TRUOC_MOC").taoLuc.getTime()).toBeLessThan(MOC_KHAO_SAT_0610.getTime());
    for (const ma of ["NGUON_KHAC", "KHAC_SAU_MOC", "NHAP_TAY_SAU_MOC"]) expect(theoMa(ma).taoLuc.getTime(), ma).toBeGreaterThan(MOC_KHAO_SAT_0610.getTime());
    expect(theoMa("SALE_FORM_CU").taoLuc.getTime()).toBeLessThan(MOC_NGUOI_NHAP.getTime());
    expect(theoMa("SALE_FORM_APP_MOI").taoLuc.getTime()).toBeGreaterThan(MOC_NGUOI_NHAP.getTime());
    expect(nhomCua("Khác", new Date(MOC_KHAO_SAT_0610.getTime() + 1))).toBe("OTHER");
    expect(nhomCua("Khác", new Date(MOC_KHAO_SAT_0610.getTime() - 1))).toBe("EMPLOYEE_REFERRAL");
    expect(nhomCua("sale-form", new Date(MOC_NGUOI_NHAP.getTime() + 1))).toBe("OTHER");
    expect(nhomCua("sale-form", new Date(MOC_NGUOI_NHAP.getTime() - 1))).toBe("PAID_ADS");
  });

  it("[SRC-INT-79c] phủ đủ: AUTO nhiều nhóm đích · MANUAL_REVIEW (thiếu người) · OTHER; nhãn kiểu «Khác» ở CẢ hai phía mốc; số lead mỗi lớp được GHIM (8 · 4 · 4)", () => {
    const lop = (l: string) => LEAD_CU_DAI_DIEN.filter((x) => lopLeadCuDaiDien(x) === l);
    expect(lop("AUTO").length).toBe(8);
    expect(lop("MANUAL_REVIEW").length).toBe(4);
    expect(lop("OTHER").length).toBe(4);
    expect(new Set(lop("AUTO").map((l) => l.nhom))).toEqual(new Set(["PAID_ADS", "CENTER_ORGANIC", "WALK_IN"]));
    expect(lop("AUTO").some((l) => l.nhan === "quatang"), "nhánh THEO_AFF").toBe(true);
    expect(new Set(lop("MANUAL_REVIEW").map((l) => l.nhom))).toEqual(new Set(["PARENT_REFERRAL", "EMPLOYEE_REFERRAL"]));
    expect(LEAD_CU_DAI_DIEN.filter((l) => l.nhan === "Khác").map((l) => l.nhom).sort()).toEqual(["EMPLOYEE_REFERRAL", "OTHER"]);
  });

  it("[SRC-INT-79d] phân hoạch THẬT của báo cáo vét lead cũ (tomTatDiTru): 0 INVALID · 0 trùng SĐT · 8 tự động (MAPPED) + 8 xem tay; lý do xem tay 4 · 1 · 3 — con số người UAT đối chiếu dry-run", () => {
    const hang: HangDiTru[] = LEAD_CU_DAI_DIEN.map((l) => ({ leadId: l.ma, kq: anh(l.nhan, l.taoLuc), nhanChuan: chuanHoaNhanNguon(l.nhan), createdAt: l.taoLuc }));
    const t = tomTatDiTru(hang, new Set());
    expect(t).toMatchObject({ total: 16, invalid: 0, duplicate: 0, unknown: 0, mapped: 8, manualReview: 8, seGhi: 16 });
    expect(t.xemTayTheoLyDo).toMatchObject({ THIEU_NGUOI: 4, MA_NV_KHONG_GIAI: 1, NHAN_CHOT_THEO_PHIEU: 3, AFF_CHUA_PHAN_LOAI: 0, VAI_SUY_TU_HIEN_TAI: 0 });
    expect(t.theoDich).toMatchObject({ PAID_ADS: 5, CENTER_ORGANIC: 1, WALK_IN: 2, PARENT_REFERRAL: 1, EMPLOYEE_REFERRAL: 3, OTHER: 4 });
  });

  it("[SRC-INT-79e] SĐT dải 09907 duy nhất, 10 số, KHÔNG đụng dải bộ cũ (09901/09902) và không đụng dải lead cũ của bộ nạp chung (09904); tên mang tiền tố; SĐT lạ ⇒ ném", () => {
    const so = LEAD_CU_DAI_DIEN.map((l) => phoneLeadCuDaiDien(l.ma));
    expect(new Set(so).size).toBe(so.length);
    for (const s of so) {
      expect(s, s).toMatch(/^09907\d{5}$/);
      expect(LEAD_CU.map((l) => phoneLeadCu(l.ma)), `${s} đụng dải lead cũ của bộ nạp chung`).not.toContain(s);
    }
    for (const lc of LEAD_CU_DAI_DIEN) {
      expect(tenLeadCuDaiDien(lc.ma).startsWith(TIEN_TO_NGUON_FINAL), lc.ma).toBe(true);
    }
    expect(() => phoneLeadCuDaiDien("KHONG_CO")).toThrow(/lạ/);
  });
});
