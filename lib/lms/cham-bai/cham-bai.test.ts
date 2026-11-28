import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { chamCau, CHINH_SACH_MAC_DINH, kiemTraTraLoi, moPhong, tongKetLuot, traLoiSchema, type TraLoi } from "./cham";
import { chieuCauHoi, hoanViTheoHat, idMu, type CauChieu } from "./chieu";
import { thongBaoLoiXuatBan, type HangCauDe } from "./xuat-ban";
import { chuanHoaCau, kiemDeThi, MA_DANG, sangViMo, type CauChuanHoa, type CauHoiGoc, type MaDang } from "./chuan-hoa";

/**
 * [CB-*] ENGINE 13 DẠNG: chuẩn hoá · hình chiếu không đáp án · id không mã hoá đáp án · xáo ổn định · kiểm câu trả lời · chấm từng dạng.
 * Mọi chuỗi «SECRET» là đáp án/khoá bí mật: KHÔNG được xuất hiện trong bất kỳ hình chiếu nào.
 */
const SEED = "hat-luot-lam-1";
const lc = (id: string, order: number, text: string, isCorrect: boolean) => ({ id, order, text, isCorrect });
const q = (type: string, o: Partial<CauHoiGoc> = {}): CauHoiGoc => ({ id: "q-" + type, type, text: "Đề " + type, choices: [], points: 2, ...o });

const BAN_DO = { rows: 4, cols: 4, walls: [[1, 1]], goal: [0, 2], start: [2, 0], dir: "N" };
const PALETTE = [
  { id: "di", label: "Đi thẳng", kind: "move" },
  { id: "phai", label: "Rẽ phải", kind: "turnR" },
  { id: "trai", label: "Rẽ trái", kind: "turnL" },
  { id: "lap2", label: "Lặp 2 lần", kind: "repeat", times: 2 },
  { id: "dung", label: "Dừng", kind: "stop" },
];

export const MAU: Record<MaDang, CauHoiGoc> = {
  chon_mot: q("MULTIPLE_CHOICE", { choices: [lc("a", 1, "Một", false), lc("b", 2, "Hai", true), lc("c", 3, "Ba", false)], meta: { ui: "single" } }),
  chon_nhieu: q("MULTIPLE_CHOICE", { id: "q-nhieu", choices: [lc("a", 1, "A", true), lc("b", 2, "B", true), lc("c", 3, "C", false)], meta: { ui: "multiple" } }),
  dung_sai: q("TRUE_FALSE", { choices: [lc("t", 1, "Đúng", true), lc("f", 2, "Sai", false)] }),
  ngan: q("SHORT_ANSWER", { correctAnswer: "SECRET-Robot" }),
  tu_luan: q("ESSAY"),
  dien_khuyet: q("FILL_BLANK", { text: "Robot ______ đi ______ ô", meta: { answers: ["SECRET-có thể", ["SECRET-ba", "SECRET-3"]] } }),
  ghep_cap: q("MATCHING", { meta: { pairs: [{ left: "Cảm biến", right: "V-mắt" }, { left: "Động cơ", right: "V-chân" }, { left: "Pin", right: "V-tim" }] } }),
  sap_xep: q("ORDERING", { meta: { items: ["V-bước một", "V-bước hai", "V-bước ba", "V-bước bốn"] } }),
  nop_san_pham: q("VIDEO"),
  phan_loai: q("CLASSIFY", { meta: { groups: [{ id: "SECRET-G1", name: "Siêu âm" }, { id: "SECRET-G2", name: "Màu" }], cards: [{ id: "k1", text: "Tường", group: "SECRET-G1" }, { id: "k2", text: "Cờ đỏ", group: "SECRET-G2" }, { id: "k3", text: "Hộp", group: "SECRET-G1" }] } }),
  chon_tren_hinh: q("HOTSPOT", { meta: { image: { url: "uploads/anh/ban-do.png", w: 800, h: 400 }, regions: [{ shape: "circle", x: 0.5, y: 0.5, r: 0.1 }, { shape: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }], maxPoints: 2 } }),
  nhap_so: q("NUMERIC", { meta: { value: "60", tolerance: "0.5", unit: "cm" } }),
  sap_khoi_lenh: q("BLOCK_PROGRAM", { meta: { palette: PALETTE, grid: BAN_DO, maxBlocks: 6 } }),
};
const cau = (d: MaDang): CauChuanHoa => {
  const r = chuanHoaCau(MAU[d]);
  if (!r.ok) throw new Error(d + ": " + r.loi);
  return r.cau;
};
const kyAnh = (u: string) => `https://ky.test/${u}?sig=1`;
const chieu = (d: MaDang, seed = SEED): CauChieu => {
  const r = chieuCauHoi(cau(d), { seed, xaoLuaChon: true, kyAnh });
  if (!r.ok) throw new Error(r.loi);
  return r.cau;
};
const idsOf = (c: CauChieu, khoa: string) => (c[khoa] as { id: string; noiDung: string }[]);
const idCua = (c: CauChieu, khoa: string, noiDung: string) => idsOf(c, khoa).find((x) => x.noiDung === noiDung)!.id;

describe("[CB-01] 13 dạng: chuẩn hoá đủ, mã dạng khớp hợp đồng", () => {
  it("mỗi dạng chuẩn hoá được và ra đúng mã", () => {
    expect(MA_DANG).toHaveLength(13);
    for (const d of MA_DANG) expect(cau(d).dang, d).toBe(d);
  });
  it("CODE và dạng lạ KHÔNG thuộc 13 dạng ⇒ lỗi rõ, không chấm 0 ngầm", () => {
    expect(chuanHoaCau(q("CODE"))).toMatchObject({ ok: false, dang: null });
    expect(chuanHoaCau(q("HOLOGRAM"))).toMatchObject({ ok: false });
  });
  it("câu thiếu/sai đáp án bị CHẶN (liệt kê câu lỗi)", () => {
    const hong: CauHoiGoc[] = [
      q("SHORT_ANSWER", { id: "h1", correctAnswer: "  " }),
      q("MULTIPLE_CHOICE", { id: "h2", choices: [lc("a", 1, "A", false), lc("b", 2, "B", false)] }),
      q("MULTIPLE_CHOICE", { id: "h3", meta: { ui: "single" }, choices: [lc("a", 1, "A", true), lc("b", 2, "B", true)] }),
      q("TRUE_FALSE", { id: "h4", choices: [lc("a", 1, "Đ", true), lc("b", 2, "S", true)] }),
      q("FILL_BLANK", { id: "h5", text: "chỉ một ______", meta: { answers: ["a", "b"] } }),
      q("MATCHING", { id: "h6", meta: { pairs: [{ left: "a", right: "b" }] } }),
      q("ORDERING", { id: "h7", meta: { items: ["một"] } }),
      q("CLASSIFY", { id: "h8", meta: { groups: [{ id: "g", name: "G" }, { id: "g2", name: "G2" }], cards: [{ id: "c", text: "t", group: "khong-co" }, { id: "c2", text: "t2", group: "g" }] } }),
      q("HOTSPOT", { id: "h9", meta: { image: { url: "u", w: 1, h: 1 }, regions: [] } }),
      q("NUMERIC", { id: "h10", meta: { value: "6o" } }),
      q("BLOCK_PROGRAM", { id: "h11", meta: { palette: PALETTE, grid: { ...BAN_DO, walls: [[0, 2]] } } }),
      q("BLOCK_PROGRAM", { id: "h12", meta: { palette: PALETTE, grid: { ...BAN_DO, goal: [9, 9] } } }),
    ];
    const r = kiemDeThi(hong);
    expect(r.ok).toBe(false);
    expect(r.loi.map((x) => x.cauHoiId)).toEqual(hong.map((x) => x.id)); // đủ 12, không câu nào lọt
  });
});

describe("[CB-02] hình chiếu: ALLOW-LIST, không đáp án", () => {
  it("không dạng nào chứa SECRET hay khoá nghiệp vụ", () => {
    for (const d of MA_DANG) {
      const s = JSON.stringify(chieu(d));
      expect(s, d).not.toContain("SECRET");
      for (const k of ["isCorrect", "correctAnswer", '"meta"', '"answers"', '"pairs"', '"regions"', '"group"', '"tolerance"', '"value"']) expect(s, `${d} ${k}`).not.toContain(k);
    }
  });
  it("[CB-02c] KHOÁ cấp cao của hình chiếu = ALLOW-LIST đúng từng dạng (thêm một trường là đỏ — kể cả trường lộ thứ tự đúng bằng chữ hiển thị)", () => {
    const CHUNG = ["id", "dang", "de", "anh", "diem"];
    const RIENG: Record<MaDang, string[]> = {
      chon_mot: ["luaChon"], chon_nhieu: ["luaChon"], dung_sai: ["luaChon"], ngan: ["doDaiToiDa"], tu_luan: ["doDaiToiDa"], dien_khuyet: ["manh"],
      ghep_cap: ["ve_trai", "ve_phai"], sap_xep: ["muc"], nop_san_pham: ["loaiTep", "soTepToiDa"], phan_loai: ["nhom", "the"],
      chon_tren_hinh: ["hinh", "soDiemToiDa"], nhap_so: ["donVi", "choPhepThapPhan"], sap_khoi_lenh: ["hopKhoi", "soKhoiToiDa", "banDo"],
    };
    for (const d of MA_DANG) expect(Object.keys(chieu(d)).sort(), d).toEqual([...CHUNG, ...RIENG[d]].sort());
  });
  it("trường đúng hợp đồng cho vài dạng then chốt", () => {
    expect(chieu("dien_khuyet")).toMatchObject({ dang: "dien_khuyet", manh: ["Robot ", " đi ", " ô"] });
    expect(chieu("nhap_so")).toMatchObject({ dang: "nhap_so", donVi: "cm", choPhepThapPhan: true });
    expect(chieu("sap_khoi_lenh")).toMatchObject({ soKhoiToiDa: 6, banDo: { hang: 4, cot: 4, huong: "B" } });
    expect((chieu("sap_khoi_lenh").hopKhoi as { loai: string }[]).map((k) => k.loai)).toEqual(["don", "don", "don", "lap", "don"]);
    expect(chieu("chon_tren_hinh")).toMatchObject({ hinh: { url: "https://ky.test/uploads/anh/ban-do.png?sig=1", rong: 800, cao: 400 }, soDiemToiDa: 2 });
  });
  it("[CB-02b] ảnh: không có kyAnh ⇒ bỏ ảnh; câu chọn-trên-hình không ký được ⇒ KHÔNG phục vụ (không URL công khai)", () => {
    const c = chieuCauHoi(cau("chon_tren_hinh"), { seed: SEED, xaoLuaChon: false });
    expect(c.ok).toBe(false);
    const mc = chieuCauHoi(cau("chon_mot"), { seed: SEED, xaoLuaChon: false });
    expect(mc.ok && mc.cau.anh).toBeNull();
  });
});

describe("[CB-03] id mờ + xáo ổn định", () => {
  it("id KHÔNG là chỉ số/thứ tự đúng: khác seed ⇒ khác id; không chứa 'm0','p0','c0'", () => {
    for (const d of ["sap_xep", "ghep_cap", "phan_loai"] as MaDang[]) {
      const a = JSON.stringify(chieu(d, "seed-A"));
      const b = JSON.stringify(chieu(d, "seed-B"));
      expect(a).not.toBe(b);
      expect(a).not.toMatch(/"id":"[mptcn]\d+"/);
    }
  });
  it("cùng seed ⇒ hình chiếu GIỐNG HỆT (khôi phục bản nháp không đổi thứ tự)", () => {
    for (const d of MA_DANG) expect(JSON.stringify(chieu(d))).toBe(JSON.stringify(chieu(d)));
  });
  it("thứ tự sắp xếp/ghép cặp KHÔNG BAO GIỜ trùng thứ tự đúng (quét 300 seed)", () => {
    for (let i = 0; i < 300; i++) {
      const s = "seed-" + i;
      const sx = idsOf(chieu("sap_xep", s), "muc").map((x) => x.noiDung);
      expect(sx).not.toEqual(["V-bước một", "V-bước hai", "V-bước ba", "V-bước bốn"]);
    }
  });
  it("hoanViTheoHat: là hoán vị; n=2 vẫn bị đảo", () => {
    for (let i = 0; i < 100; i++) {
      const p = hoanViTheoHat("s" + i, "k", 5, false);
      expect([...p].sort()).toEqual([0, 1, 2, 3, 4]);
      expect(hoanViTheoHat("s" + i, "k", 2, true)).toEqual([1, 0]);
    }
  });
});

describe("[CB-04] kiểm cấu trúc câu trả lời", () => {
  const ok = (d: MaDang, tl: TraLoi) => kiemTraTraLoi(cau(d), tl, SEED);
  it("dương", () => {
    expect(ok("chon_mot", { dang: "chon_mot", luaChonId: "a" })).toEqual({ ok: true });
    expect(ok("nhap_so", { dang: "nhap_so", giaTri: "60.0", donVi: "cm" })).toEqual({ ok: true });
  });
  it("âm: lệch dạng · id lạ · thiếu/dư · lặp · số sai · khối sai", () => {
    expect(ok("chon_mot", { dang: "dung_sai", luaChonId: "t" })).toMatchObject({ ok: false });
    expect(ok("chon_mot", { dang: "dung_sai", luaChonId: "a" })).toMatchObject({ ok: false }); // id HỢP LỆ nhưng sai DẠNG vẫn bị từ chối
    const gc = chieu("ghep_cap");
    const phaiIds = idsOf(gc, "ve_phai").map((x) => x.id);
    expect(ok("ghep_cap", { dang: "ghep_cap", cap: idsOf(gc, "ve_trai").map((x, i) => ({ traiId: x.id, phaiId: i === 0 ? "id-la" : phaiIds[i]! })) })).toMatchObject({ ok: false }); // id lạ
    const pl = chieu("phan_loai");
    expect(ok("phan_loai", { dang: "phan_loai", gan: idsOf(pl, "the").map((x) => ({ theId: x.id, nhomId: "nhom-la" })) })).toMatchObject({ ok: false });
    expect(ok("chon_mot", { dang: "chon_mot", luaChonId: "zzz" })).toMatchObject({ ok: false });
    expect(ok("chon_nhieu", { dang: "chon_nhieu", luaChonIds: ["a", "a"] })).toMatchObject({ ok: false });
    expect(ok("dien_khuyet", { dang: "dien_khuyet", cho: ["x"] })).toMatchObject({ ok: false });
    expect(ok("sap_xep", { dang: "sap_xep", thuTu: ["a", "b"] })).toMatchObject({ ok: false });
    expect(ok("chon_tren_hinh", { dang: "chon_tren_hinh", diem: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 0.5 }] })).toMatchObject({ ok: false });
    expect(ok("sap_khoi_lenh", { dang: "sap_khoi_lenh", chuongTrinh: [{ khoiId: "khong-co" }] })).toMatchObject({ ok: false });
    expect(ok("sap_khoi_lenh", { dang: "sap_khoi_lenh", chuongTrinh: [{ khoiId: "di", con: [{ khoiId: "di" }] }] })).toMatchObject({ ok: false }); // khối đơn có con
    expect(ok("sap_khoi_lenh", { dang: "sap_khoi_lenh", chuongTrinh: Array(7).fill({ khoiId: "di" }) })).toMatchObject({ ok: false }); // vượt 6 khối
    expect(ok("nop_san_pham", { dang: "nop_san_pham", tepIds: ["a", "b"] })).toMatchObject({ ok: false });
  });
  it("strict: trường lạ (điểm) bị từ chối ở lược đồ", () => {
    expect(traLoiSchema.safeParse({ dang: "ngan", vanBan: "x", diem: 10 }).success).toBe(false);
    expect(traLoiSchema.safeParse({ dang: "nhap_so", giaTri: "2,5" }).success).toBe(false);
    expect(traLoiSchema.safeParse({ dang: "ngan", vanBan: "x" }).success).toBe(true);
  });
});

describe("[CB-05] chấm từng dạng (đúng + sai + bỏ trống)", () => {
  const cham = (d: MaDang, tl: TraLoi | null, cs = CHINH_SACH_MAC_DINH) => chamCau(cau(d), tl, SEED, cs);
  const diemDung = { trangThai: "tu_dong", dung: true, diem: 2 };
  const sai0 = { trangThai: "tu_dong", dung: false, diem: 0 };

  it("trắc nghiệm / đúng-sai / ngắn", () => {
    expect(cham("chon_mot", { dang: "chon_mot", luaChonId: "b" })).toMatchObject(diemDung);
    expect(cham("chon_mot", { dang: "chon_mot", luaChonId: "a" })).toMatchObject(sai0);
    expect(cham("chon_nhieu", { dang: "chon_nhieu", luaChonIds: ["b", "a"] })).toMatchObject(diemDung);
    expect(cham("chon_nhieu", { dang: "chon_nhieu", luaChonIds: ["a"] })).toMatchObject(sai0); // thiếu một đáp án
    expect(cham("chon_nhieu", { dang: "chon_nhieu", luaChonIds: ["a", "b", "c"] })).toMatchObject(sai0); // chọn THỪA một lựa chọn sai
    expect(cham("dung_sai", { dang: "dung_sai", luaChonId: "t" })).toMatchObject(diemDung);
    expect(cham("ngan", { dang: "ngan", vanBan: "  secret-ROBOT " })).toMatchObject(diemDung); // không phân biệt hoa/thường + cắt khoảng trắng
    expect(cham("ngan", { dang: "ngan", vanBan: "robo" })).toMatchObject(sai0);
  });
  it("bỏ trống câu chấm máy = SAI thật (không phải 'chưa hỗ trợ'); chấm tay ⇒ cho_cham", () => {
    for (const d of MA_DANG.filter((x) => x !== "tu_luan" && x !== "nop_san_pham")) expect(cham(d, null), d).toMatchObject(sai0);
    expect(cham("tu_luan", null)).toEqual({ trangThai: "cho_cham" });
    expect(cham("nop_san_pham", { dang: "nop_san_pham", tepIds: ["u1"] })).toEqual({ trangThai: "cho_cham" });
  });
  it("điền khuyết: NFC + hoa/thường + khoảng trắng + nhiều đáp án chấp nhận", () => {
    const nfd = "SECRET-có thể".normalize("NFD");
    expect(cham("dien_khuyet", { dang: "dien_khuyet", cho: [` ${nfd.toUpperCase()} `, "secret-3"] })).toMatchObject(diemDung);
    expect(cham("dien_khuyet", { dang: "dien_khuyet", cho: ["secret-có thể", "bốn"] })).toMatchObject({ dung: false, soDung: 1, tong: 2 });
  });
  it("ghép cặp: đúng khi mọi cặp đúng", () => {
    const c = chieu("ghep_cap");
    const dap = (cap: [string, string][]): TraLoi => ({ dang: "ghep_cap", cap: cap.map(([l, r]) => ({ traiId: idCua(c, "ve_trai", l), phaiId: idCua(c, "ve_phai", r) })) });
    expect(cham("ghep_cap", dap([["Cảm biến", "V-mắt"], ["Động cơ", "V-chân"], ["Pin", "V-tim"]]))).toMatchObject(diemDung);
    expect(cham("ghep_cap", dap([["Cảm biến", "V-chân"], ["Động cơ", "V-mắt"], ["Pin", "V-tim"]]))).toMatchObject({ dung: false, soDung: 1, tong: 3 });
  });
  it("sắp xếp: so từng vị trí", () => {
    const c = chieu("sap_xep");
    const ids = (ds: string[]): TraLoi => ({ dang: "sap_xep", thuTu: ds.map((n) => idCua(c, "muc", n)) });
    expect(cham("sap_xep", ids(["V-bước một", "V-bước hai", "V-bước ba", "V-bước bốn"]))).toMatchObject(diemDung);
    expect(cham("sap_xep", ids(["V-bước hai", "V-bước một", "V-bước ba", "V-bước bốn"]))).toMatchObject({ dung: false, soDung: 2, tong: 4 });
  });
  it("phân loại: mọi thẻ đúng nhóm", () => {
    const c = chieu("phan_loai");
    const nhom = (ten: string) => idCua(c as CauChieu & { nhom: never }, "nhom" as never, ten) as string;
    const dap = (a: string, b: string, k3: string): TraLoi => ({ dang: "phan_loai", gan: [["Tường", a], ["Cờ đỏ", b], ["Hộp", k3]].map(([t, n]) => ({ theId: idCua(c, "the", t!), nhomId: (c.nhom as { id: string; ten: string }[]).find((x) => x.ten === n)!.id })) });
    void nhom;
    expect(cham("phan_loai", dap("Siêu âm", "Màu", "Siêu âm"))).toMatchObject(diemDung);
    expect(cham("phan_loai", dap("Màu", "Màu", "Siêu âm"))).toMatchObject({ dung: false, soDung: 2, tong: 3 });
  });
  it("chọn trên hình: vùng tròn theo tỉ lệ ảnh, điểm thừa ⇒ sai, vùng còn thiếu ⇒ sai", () => {
    const mot = cham("chon_tren_hinh", { dang: "chon_tren_hinh", diem: [{ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.2 }] });
    expect(mot).toMatchObject(diemDung);
    expect(cham("chon_tren_hinh", { dang: "chon_tren_hinh", diem: [{ x: 0.5, y: 0.5 }] })).toMatchObject({ dung: false, soDung: 1, tong: 2 }); // thiếu vùng
    expect(cham("chon_tren_hinh", { dang: "chon_tren_hinh", diem: [{ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.2 }, { x: 0.9, y: 0.9 }] })).toMatchObject({ dung: false, soDung: 0 }); // điểm thừa
    // ảnh 800×400 (tỉ lệ 2): vùng tròn r=0.1 tính theo CHIỀU CAO ⇒ chiều ngang hẹp lại: x lệch 0.06 (=0.12 đơn vị cao) đã ra ngoài
    expect(cham("chon_tren_hinh", { dang: "chon_tren_hinh", diem: [{ x: 0.56, y: 0.5 }, { x: 0.2, y: 0.2 }] })).toMatchObject({ dung: false });
    expect(cham("chon_tren_hinh", { dang: "chon_tren_hinh", diem: [{ x: 0.54, y: 0.5 }, { x: 0.2, y: 0.2 }] })).toMatchObject(diemDung);
  });
  it("nhập số: số nguyên vi mô (0.1+0.2 không phá dung sai), đơn vị, sai số", () => {
    expect(cham("nhap_so", { dang: "nhap_so", giaTri: "60.5", donVi: "CM" })).toMatchObject(diemDung); // đúng ở biên sai số 0.5
    expect(cham("nhap_so", { dang: "nhap_so", giaTri: "60.500001", donVi: "cm" })).toMatchObject(sai0);
    expect(cham("nhap_so", { dang: "nhap_so", giaTri: "60", donVi: "m" })).toMatchObject(sai0); // sai đơn vị
    expect(cham("nhap_so", { dang: "nhap_so", giaTri: "60" })).toMatchObject(sai0); // thiếu đơn vị khi đề đặt đơn vị
    expect(sangViMo("0.1")! + sangViMo("0.2")!).toBe(sangViMo("0.3")!);
    expect(sangViMo("2,5")).toBeNull();
  });
  it("sắp khối lệnh: mô phỏng — tới đích ⇒ đúng; đâm tường / ra ngoài / không tới ⇒ sai", () => {
    // start [2,0] hướng Bắc; tường [1,1]; đích [0,2]. Đường: đi 2 (lên hàng 0), phải, đi 2 ⇒ [0,2].
    const dung: TraLoi = { dang: "sap_khoi_lenh", chuongTrinh: [{ khoiId: "lap2", con: [{ khoiId: "di" }] }, { khoiId: "phai" }, { khoiId: "lap2", con: [{ khoiId: "di" }] }] };
    expect(cham("sap_khoi_lenh", dung)).toMatchObject(diemDung);
    expect(cham("sap_khoi_lenh", { dang: "sap_khoi_lenh", chuongTrinh: [{ khoiId: "phai" }, { khoiId: "di" }, { khoiId: "trai" }, { khoiId: "di" }] })).toMatchObject(sai0); // đâm tường [1,1]
    // Đi XUYÊN tường sẽ tới đích (đúng 6 khối = trần): [2,0]→di[1,0]→phải(Đông)→lặp2{di}: [1,1]=TƯỜNG (xuyên thì tới [1,2])→trái(Bắc)→di[0,2]=đích. Có tường thì phải SAI.
    expect(cham("sap_khoi_lenh", { dang: "sap_khoi_lenh", chuongTrinh: [{ khoiId: "di" }, { khoiId: "phai" }, { khoiId: "lap2", con: [{ khoiId: "di" }] }, { khoiId: "trai" }, { khoiId: "di" }] })).toMatchObject(sai0);
    expect(cham("sap_khoi_lenh", { dang: "sap_khoi_lenh", chuongTrinh: [{ khoiId: "lap2", con: [{ khoiId: "di" }] }, { khoiId: "lap2", con: [{ khoiId: "di" }] }] })).toMatchObject(sai0); // ra ngoài
    expect(cham("sap_khoi_lenh", { dang: "sap_khoi_lenh", chuongTrinh: [{ khoiId: "di" }] })).toMatchObject(sai0); // dừng giữa đường
    expect(cham("sap_khoi_lenh", { dang: "sap_khoi_lenh", chuongTrinh: [{ khoiId: "lap2", con: [{ khoiId: "di" }] }, { khoiId: "dung" }, { khoiId: "phai" }, { khoiId: "lap2", con: [{ khoiId: "di" }] }] })).toMatchObject(sai0); // «Dừng» cắt chương trình
  });
  it("[CB-05b] mô phỏng: quá 500 bước ⇒ sai (không treo)", () => {
    const hop = new Map([["lap", { kieu: "lap", so: 10 } as const], ["di", { kieu: "di" } as const], ["trai", { kieu: "trai" } as const]]);
    const ban = { hang: 12, cot: 12, tuong: [], dich: [0, 0] as const, batDau: [0, 0] as const, huong: "D" as const };
    const ct = [{ khoiId: "lap", con: Array.from({ length: 20 }, () => ({ khoiId: "lap", con: Array.from({ length: 20 }, () => ({ khoiId: "trai" })) })) }];
    expect(moPhong(ban, hop, ct).lyDo).toBe("qua_nhieu_buoc");
  });
});

describe("[CB-06] chính sách chưa được Owner duyệt = cấu hình có test", () => {
  it("điểm một phần: mặc định TẮT; bật thì chia theo số phần đúng, làm tròn 2 chữ số", () => {
    const tl: TraLoi = { dang: "dien_khuyet", cho: ["secret-có thể", "bốn"] };
    expect(chamCau(cau("dien_khuyet"), tl, SEED)).toMatchObject({ diem: 0, dung: false });
    expect(chamCau(cau("dien_khuyet"), tl, SEED, { diemMotPhan: true, saiSoMacDinh: "0" })).toMatchObject({ diem: 1, soDung: 1, tong: 2 });
  });
  it("sai số mặc định khi giáo viên không đặt", () => {
    const k = { ...MAU.nhap_so, meta: { value: "10" } };
    const c = chuanHoaCau(k);
    if (!c.ok) throw new Error(c.loi);
    const tl: TraLoi = { dang: "nhap_so", giaTri: "10.4" };
    expect(chamCau(c.cau, tl, SEED)).toMatchObject({ dung: false });
    expect(chamCau(c.cau, tl, SEED, { diemMotPhan: false, saiSoMacDinh: "0.5" })).toMatchObject({ dung: true });
  });
  it("tổng kết: có câu chờ chấm ⇒ cả lượt chờ giáo viên", () => {
    expect(tongKetLuot([{ trangThai: "tu_dong", dung: true, diem: 2, soDung: 1, tong: 1 }, { trangThai: "cho_cham" }])).toEqual({ tongDiem: 2, canGiaoVien: true, soCauTuDong: 1 });
    expect(tongKetLuot([{ trangThai: "tu_dong", dung: true, diem: 2.5, soDung: 1, tong: 1 }, { trangThai: "tu_dong", dung: false, diem: 0, soDung: 0, tong: 1 }])).toEqual({ tongDiem: 2.5, canGiaoVien: false, soCauTuDong: 2 });
  });
});

describe("[CB-07] idMu ổn định", () => {
  it("cùng đầu vào ⇒ cùng id; khác chỉ số ⇒ khác id", () => {
    expect(idMu("s", "q", "m", 0)).toBe(idMu("s", "q", "m", 0));
    expect(new Set([0, 1, 2, 3, 4, 5].map((i) => idMu("s", "q", "m", i))).size).toBe(6);
  });
});

describe("[CB-08] cổng xuất bản đề + dây nối web", () => {
  const hang = (g: CauHoiGoc, points = 2): HangCauDe => ({ id: g.id, points, question: { type: g.type, text: g.text, imageUrl: g.imageUrl ?? null, correctAnswer: g.correctAnswer ?? null, meta: g.meta ?? null, choices: g.choices.map((c) => ({ ...c, imageUrl: c.imageUrl ?? null })) } });
  it("đề rỗng / có câu hỏng ⇒ chặn kèm lý do; đề đủ 13 dạng hợp lệ ⇒ qua; CODE (chấm tay trên web) KHÔNG bị chặn", () => {
    expect(thongBaoLoiXuatBan([])).toMatch(/chưa có câu hỏi/);
    expect(thongBaoLoiXuatBan(MA_DANG.map((d) => hang(MAU[d])))).toBeNull();
    const hong = thongBaoLoiXuatBan([hang(MAU.chon_mot), hang({ ...MAU.ngan, id: "q-hong", correctAnswer: "" })]);
    expect(hong).toMatch(/1 câu chưa hợp lệ/);
    expect(hong).toMatch(/câu 2/);
    expect(thongBaoLoiXuatBan([hang(MAU.chon_mot), hang(q("CODE", { id: "q-code" }))])).toBeNull();
  });
  const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
  it("[CB-W1] cả HAI đường xuất bản của web (updateExam, changeExamStatus) đều đi qua cổng", () => {
    const s = doc("app/(admin)/admin/exams/_actions.ts");
    expect(s.match(/await loiXuatBanDe\(gate\.sdb, /g)).toHaveLength(2);
    expect(s).toContain('data.status === "PUBLISHED" && current.status !== "PUBLISHED"');
    expect(s).toContain('parsed.data.status === "PUBLISHED" && cur.status !== "PUBLISHED"');
  });
  it("[CB-W2] web submitAttempt: dạng KHÔNG chấm máy được ⇒ chờ giáo viên, không «GRADED + 0» âm thầm", () => {
    const s = doc("app/(portal)/portal/bai-thi/actions.ts");
    expect(s).toContain('const CHAM_MAY_O_WEB = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"];');
    expect(s).toContain("(eq) => !CHAM_MAY_O_WEB.includes(eq.question.type),");
  });
});
