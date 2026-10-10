// [GOL-*] — luật số phận một ô lưới ca (T04). THUẦN. Mỗi dòng của bảng ở đầu `ghi-o-luat.ts` là một ca.
import { describe, expect, it } from "vitest";
import { CAU_LY_DO_BO_QUA, duocGhiDe, quyetDinhO, type LyDoBoQua, type NguonO } from "@/lib/cham-cong/ghi-o-luat";

const NGUON: NguonO[] = ["PATTERN", "IMPORT", "MANUAL", "SWAP", "LEAVE", "HOLIDAY"];

describe("[GOL] duocGhiDe — ma trận nguồn × nguồn (quyết định 07/10, mục 2)", () => {
  it("[GOL-01] đẩy khung (PATTERN): đè PATTERN và HOLIDAY; KHÔNG đè IMPORT/MANUAL trừ khi bật ghi đè; KHÔNG BAO GIỜ đè SWAP/LEAVE", () => {
    for (const cu of ["PATTERN", "HOLIDAY"] as const) {
      expect(duocGhiDe("PATTERN", cu, false), cu).toBe(true);
      expect(duocGhiDe("PATTERN", cu, true), cu).toBe(true);
    }
    for (const cu of ["IMPORT", "MANUAL"] as const) {
      expect(duocGhiDe("PATTERN", cu, false), `${cu} mặc định`).toBe(false);
      expect(duocGhiDe("PATTERN", cu, true), `${cu} bật ghi đè`).toBe(true);
    }
    for (const cu of ["SWAP", "LEAVE"] as const) {
      expect(duocGhiDe("PATTERN", cu, false), cu).toBe(false);
      expect(duocGhiDe("PATTERN", cu, true), `${cu} — bật ghi đè KHÔNG cứu được ô của đơn đã duyệt`).toBe(false);
    }
  });

  it("[GOL-02] nhập file (IMPORT): đè PATTERN/HOLIDAY/IMPORT (nhập lại); MANUAL chỉ khi bật; SWAP/LEAVE không bao giờ", () => {
    for (const cu of ["PATTERN", "HOLIDAY", "IMPORT"] as const) expect(duocGhiDe("IMPORT", cu, false), cu).toBe(true);
    expect(duocGhiDe("IMPORT", "MANUAL", false)).toBe(false);
    expect(duocGhiDe("IMPORT", "MANUAL", true)).toBe(true);
    for (const cu of ["SWAP", "LEAVE"] as const) {
      expect(duocGhiDe("IMPORT", cu, false)).toBe(false);
      expect(duocGhiDe("IMPORT", cu, true)).toBe(false);
    }
  });

  it("[GOL-03] sửa tay / duyệt đơn / lễ (MANUAL, SWAP, LEAVE, HOLIDAY) đè mọi nguồn — giữ đúng hành vi cũ của đường sửa tay", () => {
    for (const moi of ["MANUAL", "SWAP", "LEAVE", "HOLIDAY"] as const) {
      for (const cu of NGUON) expect(duocGhiDe(moi, cu, false), `${moi}→${cu}`).toBe(true);
    }
  });
});

const co = (_: string) => true;
const khong = (_: string) => false;
const cu = (source: NguonO, templateCode = "HC", centerId = "cs1") => ({ source, templateCode, centerId });
const moi = (templateCode = "CN", centerId = "cs1") => ({ templateCode, centerId });
const base = { ghiDeNhapTay: false, quaKhu: false, coQuyen: co, kyDaChot: khong } as const;

describe("[GOL] quyetDinhO — thứ tự cổng", () => {
  it("[GOL-04] ô trống + ô mới ⇒ TAO; có ô cũ khác ⇒ THAY; cả hai trống ⇒ GIU (không có gì để ghi); có ô cũ + xoá ⇒ XOA", () => {
    expect(quyetDinhO({ ...base, nguon: "PATTERN", cu: null, moi: moi() })).toEqual({ ket: "TAO" });
    expect(quyetDinhO({ ...base, nguon: "PATTERN", cu: cu("PATTERN"), moi: moi("CN") })).toEqual({ ket: "THAY" });
    expect(quyetDinhO({ ...base, nguon: "PATTERN", cu: null, moi: null })).toEqual({ ket: "GIU" });
    expect(quyetDinhO({ ...base, nguon: "PATTERN", cu: cu("PATTERN"), moi: null })).toEqual({ ket: "XOA" });
  });

  it("[GOL-05] CỔNG QUÁ KHỨ đứng TRƯỚC mọi nhánh khác — kể cả ô được bảo vệ, kể cả không quyền, kể cả kỳ chốt (chỉ nguồn PATTERN)", () => {
    for (const c of [null, cu("PATTERN"), cu("SWAP"), cu("MANUAL")]) {
      expect(quyetDinhO({ ...base, nguon: "PATTERN", cu: c, moi: moi(), quaKhu: true, coQuyen: khong, kyDaChot: co })).toEqual({ ket: "BO_QUA", lyDo: "QUA_KHU" });
    }
    // Nguồn khác không bị cổng quá khứ: nhập file / sửa tay hợp lệ khi chỉnh dữ liệu lùi (kỳ chưa chốt).
    for (const nguon of ["IMPORT", "MANUAL", "SWAP", "LEAVE"] as const) {
      expect(quyetDinhO({ ...base, nguon, cu: null, moi: moi(), quaKhu: true })).toEqual({ ket: "TAO" });
    }
  });

  it("[GOL-06] ô được bảo vệ ⇒ O_DUOC_BAO_VE, đứng TRƯỚC cổng quyền và kỳ chốt (đếm đúng 'được bảo vệ', không đếm nhầm 'không quyền')", () => {
    const r = quyetDinhO({ ...base, nguon: "PATTERN", cu: cu("LEAVE"), moi: moi(), coQuyen: khong, kyDaChot: co });
    expect(r).toEqual({ ket: "BO_QUA", lyDo: "O_DUOC_BAO_VE" });
    // Xoá ô cũng bị bảo vệ: khung trống không được xoá ô nhập tay.
    expect(quyetDinhO({ ...base, nguon: "PATTERN", cu: cu("MANUAL"), moi: null })).toEqual({ ket: "BO_QUA", lyDo: "O_DUOC_BAO_VE" });
    // Bật ghi đè thủ công: ô MANUAL bị thay; ô SWAP vẫn không.
    expect(quyetDinhO({ ...base, nguon: "PATTERN", cu: cu("MANUAL"), moi: moi("CN"), ghiDeNhapTay: true })).toEqual({ ket: "THAY" });
    expect(quyetDinhO({ ...base, nguon: "PATTERN", cu: cu("SWAP"), moi: moi("CN"), ghiDeNhapTay: true })).toEqual({ ket: "BO_QUA", lyDo: "O_DUOC_BAO_VE" });
  });

  it("[GOL-07] không có gì đổi (cùng mã + cùng cơ sở) ⇒ GIU — kể cả khi KHÔNG có quyền hay kỳ đã chốt (không có phép ghi nào để chặn)", () => {
    expect(quyetDinhO({ ...base, nguon: "PATTERN", cu: cu("PATTERN", "HC"), moi: moi("HC"), coQuyen: khong, kyDaChot: co })).toEqual({ ket: "GIU" });
    expect(quyetDinhO({ ...base, nguon: "IMPORT", cu: cu("IMPORT", "HC"), moi: moi("HC"), coQuyen: khong, kyDaChot: co })).toEqual({ ket: "GIU" });
  });

  it("[GOL-08] nguồn MANUAL/SWAP/LEAVE cùng mã cùng cơ sở nhưng KHÁC nhãn nguồn ⇒ THAY để ghi nhãn mới (nhãn nguồn là thứ bảo vệ ô); cùng nhãn ⇒ GIU", () => {
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: cu("PATTERN", "HC"), moi: moi("HC") })).toEqual({ ket: "THAY" });
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: cu("MANUAL", "HC"), moi: moi("HC") })).toEqual({ ket: "GIU" });
    expect(quyetDinhO({ ...base, nguon: "LEAVE", cu: cu("SWAP", "HC"), moi: moi("HC") })).toEqual({ ket: "THAY" });
  });

  it("[GOL-09] quyền: ô CŨ ở cơ sở không có quyền ⇒ KHONG_QUYEN_CO_SO_CU; ô MỚI ở cơ sở không có quyền ⇒ KHONG_QUYEN_CO_SO_MOI; cũ được kiểm trước", () => {
    const chiCs1 = (c: string) => c === "cs1";
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: cu("PATTERN", "HC", "cs2"), moi: moi("CN", "cs1"), coQuyen: chiCs1 })).toEqual({ ket: "BO_QUA", lyDo: "KHONG_QUYEN_CO_SO_CU" });
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: cu("PATTERN", "HC", "cs1"), moi: moi("CN", "cs2"), coQuyen: chiCs1 })).toEqual({ ket: "BO_QUA", lyDo: "KHONG_QUYEN_CO_SO_MOI" });
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: null, moi: moi("CN", "cs2"), coQuyen: chiCs1 })).toEqual({ ket: "BO_QUA", lyDo: "KHONG_QUYEN_CO_SO_MOI" });
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: cu("PATTERN", "HC", "cs2"), moi: null, coQuyen: chiCs1 })).toEqual({ ket: "BO_QUA", lyDo: "KHONG_QUYEN_CO_SO_CU" });
  });

  it("[GOL-10] kỳ đã chốt: ô cũ HOẶC ô mới nằm trong kỳ chốt ⇒ KY_DA_CHOT (kiểm CẢ HAI cơ sở — ô D1/D2 có thể đổi cơ sở)", () => {
    const chotCs2 = (c: string) => c === "cs2";
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: cu("PATTERN", "HC", "cs2"), moi: moi("CN", "cs1"), kyDaChot: chotCs2 })).toEqual({ ket: "BO_QUA", lyDo: "KY_DA_CHOT" });
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: cu("PATTERN", "HC", "cs1"), moi: moi("CN", "cs2"), kyDaChot: chotCs2 })).toEqual({ ket: "BO_QUA", lyDo: "KY_DA_CHOT" });
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: cu("PATTERN", "HC", "cs2"), moi: null, kyDaChot: chotCs2 })).toEqual({ ket: "BO_QUA", lyDo: "KY_DA_CHOT" });
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: null, moi: moi("CN", "cs2"), kyDaChot: chotCs2 })).toEqual({ ket: "BO_QUA", lyDo: "KY_DA_CHOT" });
    // Kỳ cơ sở khác chốt thì không liên quan.
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: null, moi: moi("CN", "cs1"), kyDaChot: chotCs2 })).toEqual({ ket: "TAO" });
  });

  it("[GOL-11] quyền cơ sở CŨ đứng trước kỳ chốt; kỳ chốt đứng trước quyền cơ sở MỚI", () => {
    const chiCs1 = (c: string) => c === "cs1";
    // cũ không quyền + kỳ chốt cùng lúc ⇒ báo thiếu quyền (người dùng cần biết mình không có quyền, không phải "kỳ chốt")
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: cu("PATTERN", "HC", "cs2"), moi: moi("CN", "cs1"), coQuyen: chiCs1, kyDaChot: co })).toEqual({ ket: "BO_QUA", lyDo: "KHONG_QUYEN_CO_SO_CU" });
    // mới không quyền + kỳ chốt ⇒ báo kỳ chốt
    expect(quyetDinhO({ ...base, nguon: "MANUAL", cu: cu("PATTERN", "HC", "cs1"), moi: moi("CN", "cs2"), coQuyen: chiCs1, kyDaChot: (c) => c === "cs2" })).toEqual({ ket: "BO_QUA", lyDo: "KY_DA_CHOT" });
  });

  it("[GOL-12] mọi lý do bỏ qua đều có câu chữ cho người dùng (không có mã thô nào lọt ra màn hình)", () => {
    const lyDo: LyDoBoQua[] = ["QUA_KHU", "O_DUOC_BAO_VE", "KHONG_QUYEN_CO_SO_CU", "KHONG_QUYEN_CO_SO_MOI", "KY_DA_CHOT", "MA_KHONG_CO", "CO_SO_LA"];
    expect(Object.keys(CAU_LY_DO_BO_QUA).sort()).toEqual([...lyDo].sort());
    for (const k of lyDo) expect(CAU_LY_DO_BO_QUA[k].length).toBeGreaterThan(10);
  });
});
