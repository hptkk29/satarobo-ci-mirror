// Ca [CHC-*] — cấu hình hoá đơn theo cơ sở × hiệu lực (PR2).
import { describe, expect, it } from "vitest";
import { canhBaoThieuCauHinh, kiemCauHinhCoSo, kiemKyHieuVoiCauHinh, kiemSuaCauHinh, kyHieuDeXuat, laNgayHopLe, phapNhanTheoCauHinh, timCauHinhTheoNgay, type CauHinhCoSo } from "./cau-hinh-co-so";

const PN = [
  { ma: "SATA_ROBO", ten: "Sata Robo", bat: true },
  { ma: "NEW_VISION", ten: "New Vision", bat: true },
  { ma: "CU", ten: "Pháp nhân cũ", bat: false },
];
const c = (o: Partial<CauHinhCoSo> & Pick<CauHinhCoSo, "id" | "centerId" | "kyHieu" | "phapNhanMa">): CauHinhCoSo => ({
  hieuLucTu: "2026-01-01",
  hieuLucDen: "2026-12-31",
  dangBat: true,
  ...o,
});
const CS1_26 = c({ id: "a", centerId: "cs1", kyHieu: "1C26MAI", phapNhanMa: "SATA_ROBO" });
const CS2_26 = c({ id: "b", centerId: "cs2", kyHieu: "1C26MNV", phapNhanMa: "NEW_VISION" });
const CS1_27 = c({ id: "d", centerId: "cs1", kyHieu: "1C27MAI", phapNhanMa: "SATA_ROBO", hieuLucTu: "2027-01-01", hieuLucDen: "2027-12-31" });

describe("[CHC-01] tìm cấu hình theo cơ sở + ngày", () => {
  const ds = [CS1_26, CS2_26, CS1_27];
  it("đúng cơ sở, đúng ngày (gồm cả hai đầu khoảng)", () => {
    expect(timCauHinhTheoNgay(ds, "cs1", "2026-10-20")).toEqual({ loai: "CO", cauHinh: CS1_26 });
    expect(timCauHinhTheoNgay(ds, "cs1", "2026-01-01")).toMatchObject({ loai: "CO" });
    expect(timCauHinhTheoNgay(ds, "cs1", "2026-12-31")).toMatchObject({ loai: "CO" });
    expect(timCauHinhTheoNgay(ds, "cs2", "2026-10-20")).toEqual({ loai: "CO", cauHinh: CS2_26 });
  });
  it("ĐỔI NĂM: 31/12 → ký hiệu năm cũ, 01/01 → dòng năm mới", () => {
    expect(timCauHinhTheoNgay(ds, "cs1", "2026-12-31")).toMatchObject({ cauHinh: { kyHieu: "1C26MAI" } });
    expect(timCauHinhTheoNgay(ds, "cs1", "2027-01-01")).toMatchObject({ cauHinh: { kyHieu: "1C27MAI" } });
  });
  it("KHÔNG TÌM THẤY: cơ sở chưa khai, năm chưa khai, dòng đã tắt, ngày hỏng ⇒ KHONG_CO (không mượn của cơ sở khác)", () => {
    expect(timCauHinhTheoNgay(ds, "cs3", "2026-10-20")).toEqual({ loai: "KHONG_CO" });
    expect(timCauHinhTheoNgay([CS1_26], "cs1", "2028-02-01")).toEqual({ loai: "KHONG_CO" });
    expect(timCauHinhTheoNgay([{ ...CS1_26, dangBat: false }], "cs1", "2026-10-20")).toEqual({ loai: "KHONG_CO" });
    expect(timCauHinhTheoNgay(ds, "cs1", "20/10/2026")).toEqual({ loai: "KHONG_CO" });
    expect(timCauHinhTheoNgay(ds, "cs1", "2026-02-31")).toEqual({ loai: "KHONG_CO" });
  });
  it("MƠ HỒ: hai dòng bật chồng ngày (dữ liệu hỏng) ⇒ MO_HO, không chọn bừa", () => {
    const trung = c({ id: "z", centerId: "cs1", kyHieu: "1C26XYZ", phapNhanMa: "SATA_ROBO" });
    expect(timCauHinhTheoNgay([CS1_26, trung], "cs1", "2026-10-20")).toEqual({ loai: "MO_HO", cacId: ["a", "z"] });
  });
  it("hai cơ sở CÙNG pháp nhân + ký hiệu (dãy dùng chung) vẫn hợp lệ — không có khoá duy nhất xuyên cơ sở", () => {
    const chung2 = c({ id: "e", centerId: "cs2", kyHieu: "1C26MAI", phapNhanMa: "SATA_ROBO" });
    expect(kiemCauHinhCoSo({ ...chung2 }, [CS1_26], PN)).toEqual([]);
  });
});

describe("[CHC-02] ký hiệu điền sẵn", () => {
  const ds = [CS1_26, CS2_26];
  it("có cấu hình ⇒ dùng NGUYÊN CHUỖI cấu hình, không đổi năm, không dùng mẫu 1C26TSR", () => {
    expect(kyHieuDeXuat({ cauHinh: ds, centerId: "cs1", ngay: "2026-10-20" })).toEqual({
      nguon: "CAU_HINH",
      kyHieu: "1C26MAI",
      phapNhanMa: "SATA_ROBO",
    });
    expect(kyHieuDeXuat({ cauHinh: ds, centerId: "cs2", ngay: "2026-10-20" })).toMatchObject({ kyHieu: "1C26MNV", phapNhanMa: "NEW_VISION" });
  });
  it("không có cấu hình ⇒ để TRỐNG và nói rõ THIẾU CẤU HÌNH — không còn đoán mẫu 1C26TSR (D1)", () => {
    expect(kyHieuDeXuat({ cauHinh: ds, centerId: "cs1", ngay: "2027-03-01" })).toEqual({ nguon: "THIEU_CAU_HINH", kyHieu: "", phapNhanMa: null });
    expect(kyHieuDeXuat({ cauHinh: [], centerId: "cs9", ngay: "2026-10-20" })).toEqual({ nguon: "THIEU_CAU_HINH", kyHieu: "", phapNhanMa: null });
  });
  it("mơ hồ ⇒ để TRỐNG, không đoán", () => {
    const trung = c({ id: "z", centerId: "cs1", kyHieu: "1C26XYZ", phapNhanMa: "SATA_ROBO" });
    expect(kyHieuDeXuat({ cauHinh: [CS1_26, trung], centerId: "cs1", ngay: "2026-10-20" })).toEqual({ nguon: "MO_HO", kyHieu: "", phapNhanMa: null });
  });
});

describe("[CHC-03] kiểm dòng cấu hình mới", () => {
  const ok = { centerId: "cs1", phapNhanMa: "SATA_ROBO", kyHieu: "1C27MAI", hieuLucTu: "2027-01-01", hieuLucDen: "2027-12-31", dangBat: true };
  it("hợp lệ ⇒ không lỗi", () => {
    expect(kiemCauHinhCoSo(ok, [CS1_26], PN)).toEqual([]);
  });
  it("ĐỔI KÝ HIỆU giữa năm: dòng mới chồng ngày ⇒ phải rút ngắn dòng cũ trước", () => {
    const loi = kiemCauHinhCoSo({ ...ok, kyHieu: "1C26MAX", hieuLucTu: "2026-11-01", hieuLucDen: "2026-12-31" }, [CS1_26], PN);
    expect(loi.join(" ")).toMatch(/Trùng khoảng ngày/);
    const rutNgan = { ...CS1_26, hieuLucDen: "2026-10-31" };
    expect(kiemCauHinhCoSo({ ...ok, kyHieu: "1C26MAX", hieuLucTu: "2026-11-01", hieuLucDen: "2026-12-31" }, [rutNgan], PN)).toEqual([]);
  });
  it("chồng ngày với dòng ĐÃ TẮT hoặc của cơ sở KHÁC thì không sao", () => {
    expect(kiemCauHinhCoSo({ ...ok, kyHieu: "1C26MAX", hieuLucTu: "2026-02-01", hieuLucDen: "2026-12-31" }, [{ ...CS1_26, dangBat: false }], PN)).toEqual([]);
    expect(kiemCauHinhCoSo({ ...ok, kyHieu: "1C26MAX", hieuLucTu: "2026-02-01", hieuLucDen: "2026-12-31" }, [CS2_26], PN)).toEqual([]);
  });
  it("ĐỔI NĂM: khoảng vắt qua hai năm / ký hiệu sai năm / sai dạng ⇒ lỗi", () => {
    expect(kiemCauHinhCoSo({ ...ok, hieuLucTu: "2026-06-01", hieuLucDen: "2027-05-31", kyHieu: "1C26MAI" }, [], PN).join(" ")).toMatch(/MỘT năm/);
    expect(kiemCauHinhCoSo({ ...ok, kyHieu: "1C26MAI" }, [], PN).join(" ")).toMatch(/mang năm "26"/);
    expect(kiemCauHinhCoSo({ ...ok, kyHieu: "MAI27" }, [], PN).join(" ")).toMatch(/không đúng dạng/);
  });
  it("ĐỔI PHÁP NHÂN: pháp nhân lạ hoặc đang tắt ⇒ lỗi", () => {
    expect(kiemCauHinhCoSo({ ...ok, phapNhanMa: "KHONG_CO" }, [], PN).join(" ")).toMatch(/chưa được khai/);
    expect(kiemCauHinhCoSo({ ...ok, phapNhanMa: "CU" }, [], PN).join(" ")).toMatch(/đang tắt/);
  });
  it("ngày hỏng / đảo ngược ⇒ lỗi", () => {
    expect(kiemCauHinhCoSo({ ...ok, hieuLucTu: "2027-13-01" }, [], PN).join(" ")).toMatch(/bắt đầu hiệu lực không hợp lệ/);
    expect(kiemCauHinhCoSo({ ...ok, hieuLucTu: "2027-06-01", hieuLucDen: "2027-05-01" }, [], PN).join(" ")).toMatch(/sau hoặc bằng/);
  });
  it("dòng TẮT thì không bị kiểm chồng ngày", () => {
    expect(kiemCauHinhCoSo({ ...ok, kyHieu: "1C26MAX", hieuLucTu: "2026-02-01", hieuLucDen: "2026-12-31", dangBat: false }, [CS1_26], PN)).toEqual([]);
  });
});

describe("[CHC-04] sửa dòng đã có hoá đơn — không viết lại lịch sử", () => {
  const cu = CS1_26;
  const moi = { centerId: "cs1", phapNhanMa: "SATA_ROBO", kyHieu: "1C26MAI", hieuLucTu: "2026-01-01", hieuLucDen: "2026-12-31", dangBat: true };
  const dung = { soHoaDon: 6, ngayMin: "2026-10-06", ngayMax: "2026-10-17" };
  it("chưa có hoá đơn ⇒ sửa gì cũng được (phần kiểm hợp lệ do kiemCauHinhCoSo)", () => {
    expect(kiemSuaCauHinh(cu, { ...moi, kyHieu: "1C26ABC", phapNhanMa: "NEW_VISION" }, { soHoaDon: 0, ngayMin: null, ngayMax: null })).toEqual([]);
  });
  it("đã có hoá đơn: đổi pháp nhân / ký hiệu / cơ sở ⇒ chặn", () => {
    expect(kiemSuaCauHinh(cu, { ...moi, phapNhanMa: "NEW_VISION" }, dung).join(" ")).toMatch(/không đổi pháp nhân/);
    expect(kiemSuaCauHinh(cu, { ...moi, kyHieu: "1C26ABC" }, dung).join(" ")).toMatch(/không đổi ký hiệu/);
    expect(kiemSuaCauHinh(cu, { ...moi, centerId: "cs2" }, dung).join(" ")).toMatch(/cơ sở/);
  });
  it("đã có hoá đơn: không co khoảng khỏi ngày phát hành đã dùng; mở rộng hoặc co vừa khít thì được", () => {
    expect(kiemSuaCauHinh(cu, { ...moi, hieuLucDen: "2026-10-10" }, dung).join(" ")).toMatch(/không được trước 2026-10-17/);
    expect(kiemSuaCauHinh(cu, { ...moi, hieuLucTu: "2026-10-10" }, dung).join(" ")).toMatch(/không được sau 2026-10-06/);
    expect(kiemSuaCauHinh(cu, { ...moi, hieuLucTu: "2026-10-06", hieuLucDen: "2026-10-17" }, dung)).toEqual([]);
  });
  it("đã có hoá đơn: TẮT dòng (dangBat=false) luôn được", () => {
    expect(kiemSuaCauHinh(cu, { ...moi, dangBat: false }, dung)).toEqual([]);
  });
});

describe("[CHC-05] laNgayHopLe", () => {
  it("chỉ nhận yyyy-mm-dd có thật", () => {
    expect(laNgayHopLe("2026-02-28")).toBe(true);
    expect(laNgayHopLe("2026-02-29")).toBe(false);
    expect(laNgayHopLe("2028-02-29")).toBe(true);
    expect(laNgayHopLe("26-02-28")).toBe(false);
  });
});

describe("[CHC-06] pháp nhân phát hành theo cấu hình cơ sở", () => {
  const DS = [
    { ma: "SATA_ROBO", ten: "Sata Robo", maSoThue: "0402301783", diaChi: "x", bat: true },
    { ma: "NEW_VISION", ten: "New Vision", maSoThue: "0402341070", diaChi: "x", bat: true },
    { ma: "CU", ten: "Cũ", maSoThue: "0400000000", diaChi: "x", bat: false },
  ];
  const macDinh = DS[0]!;
  const lay = (cauHinh: CauHinhCoSo[], centerId: string, ngay = "2026-10-20", khiThieuCauHinh: "CHAN" | "MAC_DINH" = "CHAN") =>
    phapNhanTheoCauHinh({ cauHinh, centerId, ngay, danhSachPhapNhan: DS, macDinh, khiThieuCauHinh });
  it("CS2 có cấu hình ⇒ New Vision (không còn rơi về ánh xạ phiếu thu = Sata Robo)", () => {
    const r = lay([CS1_26, CS2_26], "cs2");
    expect(r).toMatchObject({ ok: true, nguon: "CAU_HINH", kyHieuCauHinh: "1C26MNV" });
    expect(r.ok && r.phapNhan.maSoThue).toBe("0402341070");
  });
  it("CS1 có cấu hình ⇒ Sata Robo theo cấu hình", () => {
    expect(lay([CS1_26, CS2_26], "cs1")).toMatchObject({ ok: true, nguon: "CAU_HINH" });
  });
  it("D1: KHÔNG TÌM THẤY cấu hình ⇒ CHẶN (không âm thầm dùng pháp nhân mặc định), câu lỗi nói rõ ngày + chỉ đường", () => {
    const r = lay([CS1_26], "cs2");
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/chưa khai cấu hình hoá đơn.*2026-10-20.*Cấu hình ký hiệu/) });
    expect(lay([CS1_26], "cs1", "2027-02-01")).toMatchObject({ ok: false });
    expect(lay([], "cs1")).toMatchObject({ ok: false });
  });
  it("D1: dòng cấu hình đang TẮT không tính là có cấu hình", () => {
    expect(lay([{ ...CS1_26, dangBat: false }], "cs1")).toMatchObject({ ok: false });
  });
  it("chế độ MAC_DINH (chỉ cho cờ hiện nút MISA): vẫn rơi về mặc định và NÓI RÕ nguồn = MAC_DINH", () => {
    expect(lay([CS1_26], "cs2", "2026-10-20", "MAC_DINH")).toMatchObject({ ok: true, nguon: "MAC_DINH", kyHieuCauHinh: null });
    expect(lay([CS1_26], "cs1", "2027-02-01", "MAC_DINH")).toMatchObject({ ok: true, nguon: "MAC_DINH" });
  });
  it("chế độ MAC_DINH mà không có mặc định ⇒ lỗi tiếng Việt, không bịa pháp nhân", () => {
    const r = phapNhanTheoCauHinh({ cauHinh: [], centerId: "cs2", ngay: "2026-10-20", danhSachPhapNhan: DS, macDinh: null, khiThieuCauHinh: "MAC_DINH" });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Chưa khai pháp nhân/) });
  });
  it("D1: có cấu hình thì hai chế độ cho CÙNG kết quả (chặn chỉ áp khi thiếu)", () => {
    expect(lay([CS1_26, CS2_26], "cs2", "2026-10-20", "CHAN")).toEqual(lay([CS1_26, CS2_26], "cs2", "2026-10-20", "MAC_DINH"));
  });
  it("cấu hình mơ hồ / trỏ pháp nhân đã tắt ⇒ LỖI, không in nhầm MST", () => {
    const trung = c({ id: "z", centerId: "cs1", kyHieu: "1C26XYZ", phapNhanMa: "SATA_ROBO" });
    expect(lay([CS1_26, trung], "cs1")).toMatchObject({ ok: false });
    expect(lay([c({ id: "t", centerId: "cs3", kyHieu: "1C26MAI", phapNhanMa: "CU" })], "cs3")).toMatchObject({ ok: false });
  });
  it("ĐỔI PHÁP NHÂN giữa năm: ngày trước/sau mốc ra hai pháp nhân khác nhau", () => {
    const truoc = c({ id: "p", centerId: "cs2", kyHieu: "1C26MNV", phapNhanMa: "NEW_VISION", hieuLucTu: "2026-01-01", hieuLucDen: "2026-10-31" });
    const sau = c({ id: "q", centerId: "cs2", kyHieu: "1C26TSR", phapNhanMa: "SATA_ROBO", hieuLucTu: "2026-11-01", hieuLucDen: "2026-12-31" });
    expect(lay([truoc, sau], "cs2", "2026-10-31")).toMatchObject({ ok: true, kyHieuCauHinh: "1C26MNV" });
    expect(lay([truoc, sau], "cs2", "2026-11-01")).toMatchObject({ ok: true, kyHieuCauHinh: "1C26TSR" });
  });
});

describe("[CHC-07] cảnh báo thiếu cấu hình cho màn (D1)", () => {
  it("có đúng một cấu hình ⇒ không cảnh báo", () => {
    expect(canhBaoThieuCauHinh([CS1_26], "cs1", "2026-10-20")).toBeNull();
  });
  it("thiếu ⇒ nêu NGÀY và chỉ màn cần mở; ngày sai dạng ⇒ đòi chọn ngày hợp lệ", () => {
    expect(canhBaoThieuCauHinh([CS1_26], "cs2", "2026-10-20")).toMatch(/ngày 2026-10-20.*Cấu hình ký hiệu/);
    expect(canhBaoThieuCauHinh([CS1_26], "cs1", "2027-01-01")).toMatch(/2027-01-01/);
    expect(canhBaoThieuCauHinh([CS1_26], "cs1", "")).toMatch(/ngày phát hành hợp lệ/);
  });
  it("chồng ngày ⇒ cảnh báo chồng ngày (không nhầm với thiếu)", () => {
    const trung = c({ id: "z", centerId: "cs1", kyHieu: "1C26XYZ", phapNhanMa: "SATA_ROBO" });
    expect(canhBaoThieuCauHinh([CS1_26, trung], "cs1", "2026-10-20")).toMatch(/chồng ngày/);
  });
});

describe("[CHC-08] ký hiệu nhập so với cấu hình hợp lệ của cơ sở vào ngày phát hành", () => {
  const ds = [CS1_26, CS2_26];
  const kt = (centerId: string, ngay: string, kyHieuNhap: string | null) => kiemKyHieuVoiCauHinh({ cauHinh: ds, centerId, ngay, kyHieuNhap });
  it("đúng ký hiệu của cấu hình ⇒ KHOP, không phân biệt hoa/thường và khoảng trắng đầu/cuối", () => {
    expect(kt("cs2", "2026-10-20", "1C26MNV")).toEqual({ loai: "KHOP", kyHieuCauHinh: "1C26MNV" });
    expect(kt("cs2", "2026-10-20", " 1c26mnv ")).toMatchObject({ loai: "KHOP" });
  });
  it("ca thật 24/10: CS2 gõ 1C26MVS thay vì 1C26MNV ⇒ LECH, nêu ký hiệu đúng", () => {
    expect(kt("cs2", "2026-10-24", "1C26MVS")).toEqual({ loai: "LECH", kyHieuCauHinh: "1C26MNV" });
  });
  it("ký hiệu của CƠ SỞ KHÁC không cứu được cơ sở này (CS1 gõ ký hiệu CS2 ⇒ LECH)", () => {
    expect(kt("cs1", "2026-10-20", "1C26MNV")).toMatchObject({ loai: "LECH", kyHieuCauHinh: "1C26MAI" });
  });
  it("ký hiệu rỗng ⇒ KHOP (chưa có gì để chặn); cơ sở thiếu cấu hình / chồng ngày ⇒ KHONG_CO_CAU_HINH (cổng D1 lo)", () => {
    expect(kt("cs1", "2026-10-20", "")).toMatchObject({ loai: "KHOP" });
    expect(kt("cs9", "2026-10-20", "1C26MAI")).toEqual({ loai: "KHONG_CO_CAU_HINH" });
    const trung = c({ id: "z", centerId: "cs1", kyHieu: "1C26XYZ", phapNhanMa: "SATA_ROBO" });
    expect(kiemKyHieuVoiCauHinh({ cauHinh: [CS1_26, trung], centerId: "cs1", ngay: "2026-10-20", kyHieuNhap: "1C26MAI" })).toEqual({ loai: "KHONG_CO_CAU_HINH" });
  });
  it("đổi năm: ngày thuộc năm không có cấu hình ⇒ KHONG_CO_CAU_HINH (không tự đổi hai số năm)", () => {
    expect(kt("cs1", "2027-02-01", "1C27MAI")).toEqual({ loai: "KHONG_CO_CAU_HINH" });
  });
});
