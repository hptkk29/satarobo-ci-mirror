/**
 * [SK-EG-*] Test GHIM hành vi của động cơ «Sức khỏe cả nhà» (chép nguyên văn từ thiết kế). Đồng hồ được đặt cố định bằng `datHomNay` — không đọc giờ thật (luật 19).
 *   [SK-EG-01] nhóm tuổi theo tháng: ranh giới 6/12/18/60 tuổi
 *   [SK-EG-02] cấu trúc dữ liệu: 56 câu lõi, id duy nhất, nhóm tuổi hợp lệ, mọi lĩnh vực có câu; 7 khối đào sâu có câu hợp lệ
 *   [SK-EG-03] BMI người lớn châu Á: nhẹ cân/bình thường/thừa cân/béo phì ⇒ mức đúng; trẻ và thai kỳ KHÔNG bị gán mức bằng BMI thô
 *   [SK-EG-04] vận động người lớn: ≥150 phút/tuần ⇒ ổn; <150 ⇒ nên chú ý; vận động mạnh tính gấp đôi
 *   [SK-EG-05] dấu hiệu cần lưu ý ngay (coDo) bật khi trả lời «có»; không bật khi không
 *   [SK-EG-06] tâm trạng: PHQ-2/GAD-2 ≥ 3 mở khối đào sâu; thấp thì không
 *   [SK-EG-08] chỉ cân nặng + chiều cao còn gõ số; mọi câu khác trắc nghiệm, mốc chia khớp ngưỡng luật; sổ cũ (số gõ tay) vẫn đọc được
 *   [SK-EG-07] bất biến toàn cục: mọi dòng khuyến nghị có nguồn, không có «NaN»/«undefined» trong văn bản, mức thuộc bảng MUC
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DS, LOI, LV, MUC, NG, cauCuaLv, daoSau, datHomNay, ketQua, ngCtx, nhanTl, nhomTuoi, thangTuoi } from "./dong-co-goc";

const HOM_NAY = "2026-11-07";
beforeAll(() => datHomNay(HOM_NAY));

const nlNam = { ns: "1990-05-01", gt: "nam", mt: false };
const nlNu = { ns: "1990-05-01", gt: "nu", mt: false };
const mucCua = (kq: { the: { lv: string; muc: string }[] }, lv: string) => kq.the.find((t) => t.lv === lv)?.muc;

describe("[SK-EG-01] nhóm tuổi", () => {
  it.each([
    ["2026-11-07", "u5"], // 0 tháng
    ["2021-11-08", "u5"], // 5 tuổi 11 tháng 30 ngày
    ["2020-11-07", "c6"], // đủ 6 tuổi
    ["2015-11-08", "c6"],
    ["2014-11-07", "c12"], // đủ 12 tuổi
    ["2009-11-08", "c12"],
    ["2008-11-07", "nl"], // đủ 18 tuổi
    ["1966-11-08", "nl"],
    ["1966-11-07", "gia"], // đủ 60 tuổi
  ])("sinh %s ⇒ %s", (ns, g) => {
    expect(nhomTuoi(ns)).toBe(g);
  });
  it("tính tháng tuổi đúng khi chưa đến sinh nhật trong tháng; ngày sinh rác ⇒ null", () => {
    expect(thangTuoi("2026-10-08")).toBe(0);
    expect(thangTuoi("2026-10-07")).toBe(1);
    expect(thangTuoi("không-phải-ngày")).toBeNull();
    expect(nhomTuoi("")).toBeNull();
  });
});

describe("[SK-EG-02] cấu trúc dữ liệu", () => {
  it("57 câu lõi, id duy nhất, nhóm tuổi và lĩnh vực hợp lệ", () => {
    expect(LOI).toHaveLength(57); // 56 câu gốc + `vd_tuan` (12/11/2026); câu bỏ khỏi bản hỏi vẫn giữ để đọc sổ cũ (g: [])
    expect(new Set(LOI.map((x: { id: string }) => x.id)).size).toBe(57);
    const lvId = new Set(LV.map((l: { id: string }) => l.id));
    for (const it of LOI) {
      expect(lvId.has(it.d), it.id).toBe(true);
      expect(it.g.every((g: string) => ["u5", "c6", "c12", "nl", "gia"].includes(g)), it.id).toBe(true);
      expect(typeof it.q).toBe("string");
    }
  });
  it("mọi lĩnh vực có ít nhất một câu cho MỘT nhóm tuổi nào đó", () => {
    for (const lv of LV) expect(LOI.some((x: { d: string }) => x.d === lv.id), lv.id).toBe(true);
  });
  it("7 khối đào sâu có điều kiện + câu hợp lệ", () => {
    expect(DS).toHaveLength(7);
    for (const d of DS) {
      expect(typeof d.khi).toBe("function");
      expect(d.cau.length, d.id).toBeGreaterThan(0);
      for (const c of d.cau) expect(c.o.length, c.id).toBeGreaterThan(1);
    }
  });
  it("ngưỡng BMI châu Á", () => {
    expect(NG).toEqual({ thieu: 18.5, thua: 23, beo: 25, nang: 30 });
  });
});

describe("[SK-EG-03] BMI", () => {
  const kq = (can: string, cao: string, ng = nlNam, them = {}) => ketQua(ng, { can, cao, ...them });
  it.each([
    ["49", "170", "gap"], // 16,96 — nhẹ cân
    ["60", "170", "on"], // 20,76 — bình thường
    ["70", "170", "cy"], // 24,22 — thừa cân
    ["75", "170", "cy"], // 25,95 — béo phì độ I
    ["90", "170", "gap"], // 31,14 — béo phì độ II
  ])("%s kg / %s cm ⇒ mức %s", (can, cao, muc) => {
    expect(mucCua(kq(can, cao), "so")).toBe(muc);
  });
  it("nhãn phân loại châu Á đúng ở các mốc", () => {
    const sl = (can: string) => kq(can, "170").the.find((t: { lv: string }) => t.lv === "so")!.soLieu as string;
    expect(sl("49")).toMatch(/Nhẹ cân/);
    expect(sl("60")).toMatch(/Bình thường/);
    expect(sl("70")).toMatch(/Thừa cân/);
    expect(sl("75")).toMatch(/Béo phì độ I /);
    expect(sl("90")).toMatch(/Béo phì độ II/);
  });
  it("vòng eo cao (nam ≥ 90, nữ ≥ 80) ⇒ chuyển bình thường thành «nên chú ý»", () => {
    expect(mucCua(kq("60", "170", nlNam, { eo: "85" }), "so")).toBe("on");
    expect(mucCua(kq("60", "170", nlNam, { eo: "90" }), "so")).toBe("cy");
    expect(mucCua(kq("60", "170", nlNu, { eo: "80" }), "so")).toBe("cy");
  });
  it("TRẺ em: KHÔNG gán mức bằng BMI thô — «chưa đủ thông tin», nói rõ lý do (chờ bảng chuẩn WHO)", () => {
    const k = ketQua({ ns: "2018-03-01", gt: "nam" }, { can: "40", cao: "125" });
    expect(mucCua(k, "so")).toBe("chua");
    const dong = JSON.stringify(k.the.find((t: { lv: string }) => t.lv === "so"));
    expect(dong).toMatch(/BMI thô/);
    expect(dong).toMatch(/đừng tự cho bé ăn kiêng/i);
  });
  it("mang thai/cho con bú: BMI không áp dụng", () => {
    const k = ketQua({ ns: "1992-01-01", gt: "nu", mt: true }, { can: "70", cao: "160" });
    expect(mucCua(k, "so")).toBe("chua");
    expect(JSON.stringify(k.the)).toMatch(/không áp dụng khi mang thai/);
  });
  it("thiếu cân hoặc chiều cao ⇒ không có thẻ «số đo»", () => {
    expect(ketQua(nlNam, { can: "70" }).the.find((t: { lv: string }) => t.lv === "so")).toBeUndefined();
  });
});

describe("[SK-EG-04] vận động người lớn", () => {
  const vd = (a: Record<string, string>) => ngCtx(nlNam, a);
  it("công thức phút/tuần: vừa + đi bộ + 2 × mạnh", () => {
    expect(vd({ vd_vua_ngay: "5", vd_vua_phut: "30" }).phutTuan).toBe(150);
    expect(vd({ vd_vua_ngay: "2", vd_vua_phut: "30", vd_di_ngay: "3", vd_di_phut: "20" }).phutTuan).toBe(120);
    expect(vd({ vd_vua_ngay: "0", vd_manh_ngay: "2", vd_manh_phut: "30" }).phutTuan).toBe(120); // 2 ngày × 30 phút × 2
  });
  it("≥ 150 ⇒ ổn; < 150 ⇒ nên chú ý và nêu mục tiêu WHO", () => {
    expect(mucCua(ketQua(nlNam, { vd_vua_ngay: "5", vd_vua_phut: "30" }), "vd")).toBe("on");
    const thieu = ketQua(nlNam, { vd_vua_ngay: "2", vd_vua_phut: "30" });
    expect(mucCua(thieu, "vd")).toBe("cy");
    expect(JSON.stringify(thieu.the)).toMatch(/150–300 phút/);
  });
  it("các cặp «ngày × phút» cũ không còn được hỏi, dù đã trả lời ngày > 0", () => {
    const ids = cauCuaLv("vd", nlNam, { vd_manh_ngay: "3", vd_vua_ngay: "3", vd_di_ngay: "3" }).map((x: { id: string }) => x.id);
    expect(ids).toEqual(["vd_tuan"]);
  });
});

describe("[SK-EG-05] dấu hiệu cần lưu ý ngay", () => {
  it("trả lời «có» ở một câu cờ đỏ ⇒ coDo = true; không ⇒ false", () => {
    expect(ngCtx(nlNam, { do1: 1 }).coDo).toBe(true);
    expect(ngCtx(nlNam, { do1: 0, do2: 0 }).coDo).toBe(false);
    expect(ngCtx({ ns: "2018-03-01", gt: "nu" }, { do_tre1: 1 }).coDo).toBe(true);
    expect(ngCtx({ ns: "2025-05-01", gt: "nu" }, { do_u5a: 1 }).coDo).toBe(true);
  });
  it("ketQua truyền coDo ra ngoài (để giao diện hiện lời nhắc liên hệ y tế)", () => {
    expect(ketQua(nlNam, { do1: 1 }).coDo).toBe(true);
    expect(ketQua(nlNam, { do1: 0 }).coDo).toBe(false);
  });
});

describe("[SK-EG-06] tâm trạng mở khối đào sâu", () => {
  it("PHQ-2 ≥ 3 hoặc GAD-2 ≥ 3 ⇒ khối «dd_tt»; thấp ⇒ không", () => {
    const co = (a: Record<string, number>) => daoSau("tt", nlNam, a).some((d: { id: string }) => d.id === "dd_tt");
    expect(ngCtx(nlNam, { p1: 2, p2: 1 }).phq2).toBe(3);
    expect(co({ p1: 2, p2: 1, g1: 0, g2: 0 })).toBe(true);
    expect(co({ p1: 0, p2: 1, g1: 1, g2: 1 })).toBe(false);
    expect(co({ p1: 0, p2: 0, g1: 2, g2: 1 })).toBe(true);
  });
  it("điểm WHO-5 chỉ có khi trả lời đủ 5 câu", () => {
    expect(ngCtx(nlNam, { w1: 3, w2: 3, w3: 3, w4: 3 }).who5).toBeNull();
    expect(ngCtx(nlNam, { w1: 3, w2: 3, w3: 3, w4: 3, w5: 3 }).who5).toBe(15);
  });
});

/** Giá trị lưu của phương án mang NHÃN này ở câu `id` — test nói bằng chữ người dùng bấm, không bằng số. */
const chon = (id: string, nhan: string): number => {
  const cau = LOI.find((x: { id: string }) => x.id === id)!;
  const o = cau.o.find((p: [string, number]) => p[0] === nhan);
  if (!o) throw new Error(`câu ${id} không có phương án «${nhan}»`);
  return o[1] as number;
};

describe("[SK-EG-08] chỉ cân nặng + chiều cao còn gõ số, mọi câu khác là trắc nghiệm (12/11/2026)", () => {
  it("[SK-EG-08a] câu kiểu «gõ số» CHỈ còn can và cao", () => {
    expect(LOI.filter((x: { t: string }) => x.t === "so").map((x: { id: string }) => x.id)).toEqual(["can", "cao"]);
  });
  it("[SK-EG-08b] mọi câu trắc nghiệm có ≥ 2 phương án, nhãn không trùng, giá trị khác nhau; câu khoảng thì giá trị tăng dần", () => {
    for (const it of LOI.filter((x: { t: string }) => x.t === "chon")) {
      const nhan = it.o.map((p: [string, number]) => p[0]);
      const gt = it.o.map((p: [string, number]) => p[1]);
      expect(it.o.length, it.id).toBeGreaterThanOrEqual(2);
      expect(new Set(nhan).size, `${it.id}: nhãn`).toBe(nhan.length);
      expect(new Set(gt).size, `${it.id}: giá trị`).toBe(gt.length);
    }
    for (const id of ["vd_manh_phut", "vd_vua_phut", "vd_di_phut", "vd_ngoi", "an_rq", "ngu_gio", "ngu_u5", "mh_thuong", "mh_nghi"]) {
      const gt = LOI.find((x: { id: string }) => x.id === id)!.o.map((p: [string, number]) => p[1]);
      expect(gt, id).toEqual([...gt].sort((a, b) => a - b));
    }
  });
  it("[SK-EG-08c] vận động: 5 ngày × «khoảng 30 phút» = 150 ⇒ ổn; 5 ngày × «khoảng 15 phút» ⇒ nên chú ý", () => {
    const ket = (nhan: string) => ketQua(nlNam, { vd_vua_ngay: 5, vd_vua_phut: chon("vd_vua_phut", nhan) });
    expect(mucCua(ket("Khoảng 30 phút"), "vd")).toBe("on");
    expect(mucCua(ket("Khoảng 15 phút"), "vd")).toBe("cy");
    // vận động mạnh vẫn tính gấp đôi: 2 ngày × 45 phút × 2 = 180
    expect(ngCtx(nlNam, { vd_manh_ngay: 2, vd_manh_phut: chon("vd_manh_phut", "Khoảng 45 phút") }).phutTuan).toBe(180);
  });
  it("[SK-EG-08d] giấc ngủ: mốc theo tuổi giữ nguyên — người lớn 7 giờ ổn, 6 giờ thiếu; bé 3 tuổi 12 giờ ổn, 10 giờ thiếu", () => {
    const nguLon = (nhan: string) => ngCtx(nlNam, { ngu_gio: chon("ngu_gio", nhan) }).nguThieu;
    expect(nguLon("Khoảng 7 giờ")).toBe(false);
    expect(nguLon("Khoảng 6 giờ")).toBe(true);
    expect(nguLon("Dưới 5 giờ")).toBe(true);
    const be3 = { ns: "2023-05-01", gt: "nu" }; // 3 tuổi: khuyến nghị 10–13 giờ
    expect(ngCtx(be3, { ngu_u5: chon("ngu_u5", "Khoảng 12 giờ") }).nguThieu).toBe(false);
    expect(ngCtx(be3, { ngu_u5: chon("ngu_u5", "Dưới 9 giờ") }).nguThieu).toBe(true);
  });
  it("[SK-EG-08e] màn hình: trên 2 giờ mới là «nhiều»; ngồi từ 8 giờ mới bị nhắc; rau quả dưới 5 phần bị nhắc", () => {
    const be8 = { ns: "2018-03-01", gt: "nam" };
    const nhieu = (nhan: string) => ngCtx(be8, { mh_thuong: chon("mh_thuong", nhan) }).mhNhieu;
    expect(nhieu("Khoảng 2 giờ")).toBe(false);
    expect(nhieu("Khoảng 3 giờ")).toBe(true);
    const ngoi = (nhan: string) => JSON.stringify(ketQua(nlNam, { vd_vua_ngay: 5, vd_vua_phut: 30, vd_ngoi: chon("vd_ngoi", nhan) }).the.find((t: { lv: string }) => t.lv === "vd"));
    expect(ngoi("6–7 giờ")).not.toMatch(/Ngồi/);
    expect(ngoi("8–9 giờ")).toMatch(/Ngồi 8–9 giờ mỗi ngày/);
    const an = (nhan: string) => JSON.stringify(ketQua(nlNam, { an_rq: chon("an_rq", nhan) }).the.find((t: { lv: string }) => t.lv === "an"));
    expect(an("5 phần trở lên")).toMatch(/đủ khoảng 5 phần/);
    expect(an("3–4 phần")).toMatch(/Mới 3–4 phần rau quả mỗi ngày/);
  });
  it("[SK-EG-08f] vòng eo là câu chọn (không bắt buộc): «cao hơn mốc» đổi mức ổn thành nên chú ý; «thấp hơn mốc» thì không", () => {
    const eo = LOI.find((x: { id: string }) => x.id === "eo_muc")!;
    expect(eo.tuy).toBe(true);
    expect(eo.t).toBe("chon");
    expect(mucCua(ketQua(nlNam, { can: "60", cao: "170", eo_muc: chon("eo_muc", "Bằng hoặc cao hơn mốc") }), "so")).toBe("cy");
    expect(mucCua(ketQua(nlNu, { can: "52", cao: "158", eo_muc: chon("eo_muc", "Bằng hoặc cao hơn mốc") }), "so")).toBe("cy");
    expect(mucCua(ketQua(nlNam, { can: "60", cao: "170", eo_muc: chon("eo_muc", "Thấp hơn mốc") }), "so")).toBe("on");
    expect(JSON.stringify(ketQua(nlNam, { can: "60", cao: "170", eo_muc: 1 }).the)).not.toMatch(/NaN|undefined/);
  });
  it("[SK-EG-08g] sổ cũ (số gõ tay) vẫn đọc được: kết quả không lỗi và nhãn «lần trước» in ra số đã gõ", () => {
    const cu = { can: "70", cao: "170", eo: "92", vd_vua_ngay: "3", vd_vua_phut: "40", vd_ngoi: "9", an_rq: "3", ngu_gio: "6.5" };
    const k = ketQua(nlNam, cu);
    expect(mucCua(k, "so")).toBe("cy"); // BMI 24,2 + eo 92 ≥ 90
    expect(JSON.stringify(k.the)).not.toMatch(/NaN|undefined|\[object/);
    const nhan = (id: string, v: unknown) => nhanTl(LOI.find((x: { id: string }) => x.id === id)!, v);
    expect(nhan("ngu_gio", "6.5")).toBe("6,5 giờ"); // không khớp phương án nào ⇒ in số đã gõ, không để trống
    expect(nhan("ngu_gio", 7)).toBe("Khoảng 7 giờ"); // khớp phương án ⇒ in nhãn
    expect(nhan("vd_vua_phut", "40")).toBe("40 phút");
  });
});

describe("[SK-EG-09] giảm một nửa số câu hỏi (13/11/2026)", () => {
  // Số câu trong bản hỏi cho người CHƯA trả lời gì (câu điều kiện «khi» chưa hiện). Trần = mức chủ dự án chốt: nửa của 26.
  const demCau = (ng: { ns: string; gt: string; mt?: boolean }) => {
    const ids: string[] = [];
    for (const lv of LV) for (const x of cauCuaLv(lv.id, ng, {})) ids.push(x.id);
    return ids;
  };
  const nam = (tuoi: number) => ({ ns: `${2026 - tuoi}-01-01`, gt: "nam", mt: false });
  it("[SK-EG-09a] người lớn và người từ 60 tuổi: đúng 13 câu, trong đó chỉ 2 câu gõ số", () => {
    for (const ng of [nam(38), nam(70)]) {
      const ids = demCau(ng);
      expect(ids.length).toBe(13);
      expect(ids.filter((i) => LOI.find((x: { id: string }) => x.id === i)?.t === "so")).toEqual(["can", "cao"]);
    }
  });
  it("[SK-EG-09b] trẻ không vượt 13 câu ở bất kỳ nhóm tuổi nào", () => {
    for (const tuoi of [0, 1, 4, 6, 9, 12, 15, 17]) expect(demCau(nam(tuoi)).length, "tuổi " + tuoi).toBeLessThanOrEqual(13);
  });
  it("[SK-EG-09c] các câu đỏ-cờ và sàng lọc tâm trạng KHÔNG bị cắt (an toàn trước tiện)", () => {
    const ids = demCau(nam(38));
    for (const k of ["do1", "do2", "p1", "p2", "g1", "g2", "hut", "a1"]) expect(ids, k).toContain(k);
  });
  it("[SK-EG-09d] vd_tuan: ranh giới 150 phút/tuần khớp luật; 3 đáp án dưới mức ⇒ nên chú ý, từ 150 ⇒ ổn", () => {
    // Lấy giá trị TỪ CHÍNH phương án (không gõ tay số) — sửa mốc của phương án nào là đỏ đúng phương án đó.
    const o = (LOI.find((x: { id: string }) => x.id === "vd_tuan")?.o ?? []) as [string, number][];
    const mucTheoNhan = (nhan: string) => mucCua(ketQua(nlNam, { vd_tuan: String(o.find((p) => p[0] === nhan)![1]) }), "vd");
    expect(mucTheoNhan("Dưới 60 phút")).toBe("cy");
    expect(mucTheoNhan("60–149 phút")).toBe("cy");
    expect(mucTheoNhan("150–299 phút")).toBe("on");
    expect(mucTheoNhan("300 phút trở lên")).toBe("on");
    expect(ngCtx(nlNam, { vd_tuan: "105" }).phutTuan).toBe(105);
  });
  it("[SK-EG-09e] sổ cũ (ngày × phút) vẫn tính đúng khi chưa có vd_tuan; có vd_tuan thì lấy vd_tuan", () => {
    const cu = { vd_vua_ngay: "5", vd_vua_phut: "30" };
    expect(ngCtx(nlNam, cu).phutTuan).toBe(150);
    expect(ngCtx(nlNam, { ...cu, vd_tuan: "30" }).phutTuan).toBe(30);
  });
  it("[SK-EG-09f] không có WHO-5 vẫn ra kết quả tâm trạng từ PHQ-2/GAD-2; điểm cao vẫn khuyên gặp chuyên gia", () => {
    const ok = ketQua(nlNam, { p1: "0", p2: "1", g1: "0", g2: "0" });
    expect(mucCua(ok, "tt")).toBe("on");
    const cao = ketQua(nlNam, { p1: "2", p2: "2", g1: "0", g2: "0" });
    expect(mucCua(cao, "tt")).toBe("gap");
    expect(JSON.stringify(ok.the)).not.toMatch(/NaN|undefined/);
  });
  it("[SK-EG-09g] người lớn không bị khẳng định «không có khói thuốc trong nhà» khi chưa hề được hỏi", () => {
    // Không trả lời a1 để khối «thuốc lá & rượu» không có dòng nào khác ⇒ rơi đúng vào câu mặc định.
    const kq = ketQua(nlNam, { hut: "0" });
    const th = JSON.stringify(kq.the.find((t: { lv: string }) => t.lv === "th"));
    expect(th).toMatch(/Không có điểm nào cần chú ý/);
    expect(th).not.toMatch(/Không có khói thuốc trong nhà/);
    // đối chứng dương: bé nhỏ ĐÃ được hỏi khói thuốc thì câu cũ vẫn xuất hiện
    expect(JSON.stringify(ketQua({ ns: "2024-01-01", gt: "nam", mt: false }, { khoi: "0" }).the)).toMatch(/Không có khói thuốc trong nhà/);
  });
});

describe("[SK-EG-07] bất biến toàn cục của kết quả", () => {
  const CA_NHAN = [
    { ten: "người lớn nam", ng: nlNam, a: { can: "75", cao: "170", eo: "92", vd_vua_ngay: "2", vd_vua_phut: "20", ngu_gio: "5.5", mh_thuong: "4", p1: 2, p2: 2, g1: 1, g2: 2, w1: 2, w2: 2, w3: 2, w4: 2, w5: 2, a1: 2, a2: 1, a3: 1 } },
    { ten: "người lớn nữ mang thai", ng: { ns: "1992-01-01", gt: "nu", mt: true }, a: { can: "70", cao: "160", vd_vua_ngay: "3", vd_vua_phut: "30" } },
    { ten: "người từ 60 tuổi", ng: { ns: "1960-01-01", gt: "nu", mt: false }, a: { can: "60", cao: "155", vd_vua_ngay: "1", vd_vua_phut: "20", vd_tb: 1, vd_nga: 2 } },
    { ten: "bé 8 tuổi", ng: { ns: "2018-03-01", gt: "nam" }, a: { can: "30", cao: "128", vd60: "3", ngu_gio: "8", mh_thuong: "3" } },
    { ten: "bé 3 tuổi", ng: { ns: "2023-05-01", gt: "nu" }, a: { can: "14", cao: "95", vd_u5: "120", ngu_u5: "10", mh_u5: "2" } },
    { ten: "bé 8 tháng", ng: { ns: "2026-03-01", gt: "nam" }, a: { can: "8", cao: "70", vd_u5: "30", ngu_u5: "13" } },
    // Kiểu trả lời MỚI (trắc nghiệm, 12/11/2026): giá trị là số đại diện của phương án đã chọn
    { ten: "người lớn nam (trắc nghiệm)", ng: nlNam, a: { can: "75", cao: "170", eo_muc: 1, vd_vua_ngay: 2, vd_vua_phut: 30, vd_ngoi: 8.5, an_rq: 1.5, ngu_gio: 6, mh_thuong: 3 } },
    { ten: "bé 8 tuổi (trắc nghiệm)", ng: { ns: "2018-03-01", gt: "nam" }, a: { can: "30", cao: "128", vd60: 3, ngu_gio: 8, mh_thuong: 3, mh_nghi: 4, an_rq: 0 } },
    { ten: "bé 3 tuổi (trắc nghiệm)", ng: { ns: "2023-05-01", gt: "nu" }, a: { can: "14", cao: "95", vd_u5: 120, ngu_u5: 9, mh_u5: 2 } },
  ];
  it.each(CA_NHAN)("$ten: mọi thẻ thuộc bảng mức, mọi dòng có nguồn, văn bản sạch", ({ ng, a }) => {
    const k = ketQua(ng, a);
    expect(Array.isArray(k.the)).toBe(true);
    for (const t of k.the) {
      expect(Object.keys(MUC), t.lv).toContain(t.muc);
      expect(LV.some((l: { id: string }) => l.id === t.lv)).toBe(true);
      for (const [vanBan, nguon] of t.dong) {
        expect(typeof vanBan).toBe("string");
        expect(vanBan.length).toBeGreaterThan(5);
        expect(typeof nguon, `${t.lv}: nguồn`).toBe("string");
        expect(nguon.length).toBeGreaterThan(1);
      }
    }
    const tatCa = JSON.stringify(k.the);
    expect(tatCa).not.toMatch(/NaN|undefined|\[object/);
  });
});
