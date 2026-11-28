import { describe, expect, it } from "vitest";

import {
  doTinCay,
  heSoQuanHe,
  hoSoChiSo,
  kieuGiaDinhTu,
  mucVaCham,
  mucVaChamCap,
  nhanCanBang,
  nhanQuanHeCap,
  nhanTuKieu,
  tangBaoCaoMo,
  tinhChiSoGiaDinh,
  toaDoBanDo,
  type NguoiChiSo,
} from "./chi-so";
import type { DiemDisc } from "./kieu";

// Số liệu TÍNH TAY từ công thức spec 4.2–4.5 (không gọi lại hàm để lấy kỳ vọng).
const P_BO: DiemDisc = { D: 88, I: 40, S: 20, C: 45 }; // pace (128−65)/2 = 31,5 · focus (60−133)/2 = −36,5
const P_ME: DiemDisc = { D: 34, I: 24, S: 62, C: 74 }; // pace (58−136)/2 = −39 · focus (86−108)/2 = −11
const P_CON: DiemDisc = { D: 58, I: 74, S: 46, C: 22 }; // pace (132−68)/2 = 32 · focus (120−80)/2 = 20
const P_BE: DiemDisc = { D: 20, I: 48, S: 74, C: 40 }; // pace (68−114)/2 = −23 · focus (122−60)/2 = 31

const ng = (id: string, ten: string, vai: NguoiChiSo["vaiTro"], laTre: boolean, diem: DiemDisc, kieu: NguoiChiSo["kieu"], qua: NguoiChiSo["qua"] = "TU_LAM"): NguoiChiSo => ({
  id, ten, vaiTro: vai, laTre, diem, kieu, qua,
});
const NHA = [
  ng("bo", "Một", "bo", false, P_BO, { loai: "don", truc: "D" }),
  ng("me", "Hai", "me", false, P_ME, { loai: "pha", cap: ["C", "S"] }),
  ng("con", "Ba", "con", true, P_CON, { loai: "don", truc: "I" }),
  ng("be", "Bốn", "con", true, P_BE, { loai: "don", truc: "S" }),
];

describe("hai trục và nhãn hồ sơ (spec 4.1–4.2)", () => {
  it("[SG-CS-01] nhịp độ / trọng tâm khớp tính tay", () => {
    const h = hoSoChiSo(P_BO, { loai: "don", truc: "D" });
    expect(h.pace).toBe(31.5);
    expect(h.focus).toBe(-36.5);
    expect(h.chinh).toBe("D");
    expect(h.cuongDo).toBe("rõ"); // 88 ≥ 75
    const m = hoSoChiSo(P_ME, { loai: "pha", cap: ["C", "S"] });
    expect(m.pace).toBe(-39);
    expect(m.focus).toBe(-11);
    expect(m.nhan).toBe("Cs");
    expect(m.cuongDo).toBe("vừa"); // 74 ⇒ vừa
  });

  it("[SG-CS-02] nhãn từ kiểu của engine: đơn · pha (chữ thứ hai viết thường) · cân bằng", () => {
    expect(nhanTuKieu({ loai: "don", truc: "I" })).toBe("I");
    expect(nhanTuKieu({ loai: "pha", cap: ["D", "I"] })).toBe("Di");
    expect(nhanTuKieu({ loai: "deu" })).toBe("Cân bằng");
  });

  it("[SG-CS-03] cường độ theo ngưỡng 75 / 60", () => {
    expect(hoSoChiSo({ D: 75, I: 10, S: 10, C: 10 }, { loai: "don", truc: "D" }).cuongDo).toBe("rõ");
    expect(hoSoChiSo({ D: 74.9, I: 10, S: 10, C: 10 }, { loai: "don", truc: "D" }).cuongDo).toBe("vừa");
    expect(hoSoChiSo({ D: 60, I: 10, S: 10, C: 10 }, { loai: "don", truc: "D" }).cuongDo).toBe("vừa");
    expect(hoSoChiSo({ D: 59.9, I: 10, S: 10, C: 10 }, { loai: "don", truc: "D" }).cuongDo).toBe("nhẹ");
  });
});

describe("mức va chạm của cặp (spec 4.3–4.4)", () => {
  it("[SG-CS-04] T tính tay: bố–bé = √(54,5² + 67,5²) = 86,8 ⇒ Cao; đối xứng", () => {
    const a = hoSoChiSo(P_BO, { loai: "don", truc: "D" });
    const b = hoSoChiSo(P_BE, { loai: "don", truc: "S" });
    expect(mucVaChamCap(a, b)).toBe(86.8);
    expect(mucVaChamCap(b, a)).toBe(86.8);
    expect(mucVaCham(86.8)).toBe("cao");
  });

  it("[SG-CS-05] hai hồ sơ giống hệt ⇒ T = 0 ⇒ Thấp; ngưỡng 35 và 76", () => {
    const a = hoSoChiSo(P_BO, { loai: "don", truc: "D" });
    expect(mucVaChamCap(a, a)).toBe(0);
    expect(mucVaCham(0)).toBe("thap");
    expect(mucVaCham(34.9)).toBe("thap");
    expect(mucVaCham(35)).toBe("trung-binh");
    expect(mucVaCham(75.9)).toBe("trung-binh");
    expect(mucVaCham(76)).toBe("cao");
  });

  it("[SG-CS-06] T kẹp ở 100", () => {
    const a = hoSoChiSo({ D: 100, I: 100, S: 0, C: 0 }, { loai: "pha", cap: ["D", "I"] }); // pace 100, focus 0
    const b = hoSoChiSo({ D: 0, I: 0, S: 100, C: 100 }, { loai: "pha", cap: ["S", "C"] }); // pace −100
    expect(mucVaChamCap(a, b)).toBe(100);
  });

  it("[SG-CS-07] hệ số quan hệ: cha mẹ–con 1,2 · vợ chồng 1,2 · anh chị em 1,0 · ông bà–cháu 0,9 · người lớn khác 1,0", () => {
    const bo = { laTre: false, vaiTro: "bo" as const };
    const me = { laTre: false, vaiTro: "me" as const };
    const ong = { laTre: false, vaiTro: "ong" as const };
    const ba = { laTre: false, vaiTro: "ba" as const };
    const con = { laTre: true, vaiTro: "con" as const };
    const khac = { laTre: false, vaiTro: "nguoi-than" as const };
    expect(heSoQuanHe(bo, con)).toBe(1.2);
    expect(heSoQuanHe(con, me)).toBe(1.2);
    expect(heSoQuanHe(bo, me)).toBe(1.2);
    expect(heSoQuanHe(ong, ba)).toBe(1.2);
    expect(heSoQuanHe(con, con)).toBe(1.0);
    expect(heSoQuanHe(ong, con)).toBe(0.9);
    expect(heSoQuanHe(con, ba)).toBe(0.9);
    expect(heSoQuanHe(bo, khac)).toBe(1.0);
    expect(heSoQuanHe(bo, bo)).toBe(1.0);
  });

  it("[SG-CS-08] nhãn quan hệ", () => {
    expect(nhanQuanHeCap({ laTre: false, vaiTro: "bo" }, { laTre: false, vaiTro: "me" })).toBe("Vợ chồng");
    expect(nhanQuanHeCap({ laTre: false, vaiTro: "bo" }, { laTre: true, vaiTro: "con" })).toBe("Cha – con");
    expect(nhanQuanHeCap({ laTre: true, vaiTro: "con" }, { laTre: false, vaiTro: "me" })).toBe("Mẹ – con");
    expect(nhanQuanHeCap({ laTre: true, vaiTro: "con" }, { laTre: true, vaiTro: "con" })).toBe("Anh chị em");
  });
});

describe("chỉ số cả nhà (spec 4.4–4.5, 7)", () => {
  const cs = tinhChiSoGiaDinh(NHA)!;

  it("[SG-CS-09] n người ⇒ n(n−1)/2 cặp; cặp nóng ≤ 2, đều T ≥ 35, xếp theo độ ưu tiên giảm", () => {
    expect(cs.cap).toHaveLength(6);
    expect(cs.capNong.length).toBeLessThanOrEqual(2);
    for (const c of cs.capNong) expect(c.T).toBeGreaterThanOrEqual(35);
    for (let i = 1; i < cs.capTheoUuTien.length; i++) expect(cs.capTheoUuTien[i - 1]!.uuTien).toBeGreaterThanOrEqual(cs.capTheoUuTien[i]!.uuTien);
    expect(cs.capCanGiu).toBeNull();
  });

  it("[SG-CS-10] độ ưu tiên = T × hệ số (bố–bé: 86,8 × 1,2 = 104,2)", () => {
    const c = cs.cap.find((x) => x.aId === "bo" && x.bId === "be")!;
    expect(c.T).toBe(86.8);
    expect(c.heSo).toBe(1.2);
    expect(c.uuTien).toBe(104.2);
    expect(c.muc).toBe("cao");
  });

  it("[SG-CS-11] hồ sơ trung bình, cân bằng B = 100 − 2·(max − min) tính tay = 90", () => {
    // M = D 50 · I 46,5 · S 50,5 · C 45,25 ⇒ B = 100 − 2·5,25 = 89,5 ⇒ làm tròn 90.
    expect(cs.trungBinh).toEqual({ D: 50, I: 46.5, S: 50.5, C: 45.3 });
    expect(cs.canBang).toBe(90);
    expect(cs.nhanCanBang).toBe("can-bang");
    expect(nhanCanBang(70)).toBe("can-bang");
    expect(nhanCanBang(69)).toBe("lech-vua");
    expect(nhanCanBang(40)).toBe("lech-vua");
    expect(nhanCanBang(39)).toBe("lech-manh");
  });

  it("[SG-CS-12] kiểu gia đình: điểm gia đình gần tâm (±10) ⇒ Hài hoà; các góc phần tư còn lại", () => {
    // pace TB = (31,5 − 39 + 32 − 23)/4 = 0,4 · focus TB = (−36,5 − 11 + 20 + 31)/4 = 0,9
    expect(cs.diemGiaDinh).toEqual({ pace: 0.4, focus: 0.9 });
    expect(cs.kieu.ma).toBe("hai-hoa");
    expect(kieuGiaDinhTu(30, -30).ma).toBe("hanh-dong");
    expect(kieuGiaDinhTu(30, 30).ma).toBe("le-hoi");
    expect(kieuGiaDinhTu(-30, 30).ma).toBe("to-am");
    expect(kieuGiaDinhTu(-30, -30).ma).toBe("ngan-nap");
    expect(kieuGiaDinhTu(10, -10).ma).toBe("hai-hoa");
    expect(kieuGiaDinhTu(10.1, -10).ma).toBe("hanh-dong");
  });

  it("[SG-CS-13] độ phủ ≥ 60: D ← Một; I ← Ba; S ← Hai, Bốn; C ← Hai; không nhóm nào thiếu", () => {
    expect(cs.phu.D).toEqual(["Một"]); // Ba có D = 58 < 60
    expect(cs.phu.I).toEqual(["Ba"]); // Bốn có I = 48
    expect(cs.phu.S).toEqual(["Hai", "Bốn"]);
    expect(cs.phu.C).toEqual(["Hai"]);
    expect(cs.thieu).toEqual([]);
  });

  it("[SG-CS-14] thiếu nhóm được nhận ra (không ai ≥ 60 ở C)", () => {
    const thieuC = tinhChiSoGiaDinh([
      ng("a", "A", "bo", false, { D: 70, I: 20, S: 30, C: 10 }, { loai: "don", truc: "D" }),
      ng("b", "B", "me", false, { D: 20, I: 80, S: 30, C: 10 }, { loai: "don", truc: "I" }),
    ])!;
    expect(thieuC.thieu).toEqual(["S", "C"]);
  });

  it("[SG-CS-15] vai tự nhiên: hai người cùng nhóm ⇒ người cao điểm hơn giữ vai chính, người kia vai phụ", () => {
    const x = tinhChiSoGiaDinh([
      ng("a", "A", "bo", false, { D: 90, I: 10, S: 10, C: 10 }, { loai: "don", truc: "D" }),
      ng("b", "B", "me", false, { D: 70, I: 10, S: 10, C: 10 }, { loai: "don", truc: "D" }),
    ])!;
    expect(x.vai.find((v) => v.id === "a")).toMatchObject({ vai: "Người chốt", vaiChinh: true });
    expect(x.vai.find((v) => v.id === "b")).toMatchObject({ vai: "Người chốt", vaiChinh: false });
  });

  it("[SG-CS-16] không cặp nào T ≥ 35 mà có cặp cùng nhóm chính ⇒ «cặp cần giữ» với điểm mù chung", () => {
    const x = tinhChiSoGiaDinh([
      ng("a", "A", "bo", false, { D: 80, I: 30, S: 20, C: 20 }, { loai: "don", truc: "D" }),
      ng("b", "B", "me", false, { D: 82, I: 31, S: 21, C: 19 }, { loai: "don", truc: "D" }),
    ])!;
    expect(x.capNong).toEqual([]);
    expect(x.capCanGiu?.diemMuChung).toBe("D");
  });

  it("[SG-CS-17] không ai ⇒ null", () => {
    expect(tinhChiSoGiaDinh([])).toBeNull();
  });
});

describe("báo cáo mở dần (spec 4.6)", () => {
  it("[SG-CS-18] 1 người tự làm: chỉ tầng 1", () => {
    const t = tangBaoCaoMo(1, 1, 4);
    expect(t).toMatchObject({ t1: true, t2: false, t3: false, ke7: false, ke30: false, ke365: false, soTheChieu: 0, tinCay: 25 });
  });
  it("[SG-CS-19] 2 người tự làm: tầng 1+2, 2 thẻ chiều, kế hoạch 7 ngày; chưa có bản đồ", () => {
    const t = tangBaoCaoMo(2, 2, 4);
    expect(t).toMatchObject({ t1: true, t2: true, t3: false, ke7: true, ke30: false, soTheChieu: 2, tinCay: 50 });
  });
  it("[SG-CS-20] 3 hồ sơ (1 ước lượng) + 2 tự làm: đủ tầng 3, 6 thẻ; tin cậy 50% ⇒ bản nháp, kế hoạch 1 năm khoá", () => {
    const t = tangBaoCaoMo(2, 3, 4);
    expect(t).toMatchObject({ t3: true, nhap: true, soTheChieu: 6, ke30: true, ke365: false, tinCay: 50 });
  });
  it("[SG-CS-21] 3 hồ sơ nhưng chỉ 1 tự làm ⇒ tầng 3 vẫn khoá", () => {
    expect(tangBaoCaoMo(1, 3, 4).t3).toBe(false);
  });
  it("[SG-CS-22] tất cả tự làm: tin cậy 100%, không nháp, mở kế hoạch 1 năm; 4 người ⇒ 12 thẻ", () => {
    const t = tangBaoCaoMo(4, 4, 4);
    expect(t).toMatchObject({ t3: true, nhap: false, ke365: true, soTheChieu: 12, tinCay: 100 });
    expect(tangBaoCaoMo(5, 5, 5).soTheChieu).toBe(20);
  });
  it("[SG-CS-23] độ tin cậy đúng ngưỡng 60% ⇒ không nháp; 59% ⇒ nháp; tổng 0 ⇒ 0", () => {
    expect(tangBaoCaoMo(3, 3, 5).nhap).toBe(false); // 60%
    expect(tangBaoCaoMo(3, 3, 5).ke365).toBe(true);
    expect(doTinCay(0, 0)).toBe(0);
    expect(tangBaoCaoMo(2, 3, 5)).toMatchObject({ nhap: true }); // 40%
  });
});

describe("bản đồ", () => {
  it("[SG-CS-24] toạ độ: tâm 200; trọng tâm +100 ⇒ x = 380; nhịp độ +100 ⇒ y = 20; ngoài khoảng bị kẹp", () => {
    expect(toaDoBanDo(0, 0)).toEqual({ x: 200, y: 200 });
    expect(toaDoBanDo(100, 100)).toEqual({ x: 380, y: 20 });
    expect(toaDoBanDo(-100, -100)).toEqual({ x: 20, y: 380 });
    expect(toaDoBanDo(500, -500)).toEqual({ x: 20, y: 20 });
  });
});
