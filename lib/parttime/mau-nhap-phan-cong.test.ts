// [MNP-*] — file mẫu nhập phân công GV: dựng bằng ExcelJS, đọc lại bằng CHÍNH bộ đọc của import (vòng tròn).
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { dungFileMauNhap, type DauVaoMauNhap } from "./mau-nhap-phan-cong";
import { docSheetNhap } from "./nhap-phan-cong";

const THAM_SO = {
  loai: "SR_QD_238" as const,
  tiet: { chuanBiPhut: 10, dayPhut: 90, chuanPhut: 100 },
  ca: [
    { ma: "S", tu: "07:45", den: "11:30" },
    { ma: "C", tu: "13:45", den: "17:30" },
    { ma: "T", tu: "17:15", den: "21:00" },
  ],
  toiDaTietMoiCa: 2,
  donGia: { mainTheoRank: { "1": 120000, "2": 140000, "3": 160000, "4": 200000 }, troGiang: 80000, trucCa: 90000, nuaCaTruc: 45000 },
  rankMacDinh: 1,
  nguongTroGiang: [],
};
const VAO: DauVaoMauNhap = {
  tu: "2026-11-02",
  den: "2026-11-08",
  coSo: [{ ma: "CS2", ten: "Cơ sở 2" }, { ma: "CS9", ten: "Cơ sở mới" }],
  thamSo: THAM_SO,
  mucTrial: 30000,
  giaoVien: [{ maGV: "GV002", ten: "GV Hai", email: "gv2@x.vn", coSo: ["CS2"] }],
  buoi: [{ sessionId: "S1", loai: "Lớp", coSo: "CS2", ngay: "2026-11-05", ca: "C", gio: "14:00–15:30", lop: "SATA3", gvChinh: "GV Hai", troGiang: "" }],
};
const buf = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer());

describe("[MNP] file mẫu", () => {
  it("[MNP-01] đủ 9 sheet của file chủ dự án + 2 sheet tra cứu; sheet nhập để TRỐNG (đọc lại ra 0 dòng)", async () => {
    const wb = dungFileMauNhap(VAO);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["HUONG_DAN", "MA_VA_GIA", "NHAP_PHAN_CONG", "VI_DU", "EVENT_TRIAL_BU", "LUOI_TUAN", "DOI_SOAT", "RANK_TRIAL", "CHECKLIST", "DS_GIAO_VIEN", "DS_BUOI"]);
    expect(docSheetNhap(await buf(wb))).toEqual({ ok: true, dong: [] });
  });
  it("[MNP-02] điền một dòng vào ô vàng hàng 5 ⇒ bộ đọc nhận đúng dòng 5", async () => {
    const wb = dungFileMauNhap(VAO);
    const ws = wb.getWorksheet("NHAP_PHAN_CONG")!;
    ["K1", "GAN_TRUC", "CS2", "2026-11-05", "S", "GV002"].forEach((v, i) => (ws.getRow(5).getCell(i + 1).value = v));
    const r = docSheetNhap(await buf(wb));
    expect(r.ok && r.dong.map((d) => [d.soDong, d.ImportKey, d.ThaoTac, d.Ngay, d.MaGV])).toEqual([[5, "K1", "GAN_TRUC", "2026-11-05", "GV002"]]);
  });
  it("[MNP-03] dropdown cơ sở lấy từ DB (không cứng CS1,CS2); đơn giá lấy từ chính sách", async () => {
    const wb = dungFileMauNhap({ ...VAO, thamSo: { ...THAM_SO, donGia: { ...THAM_SO.donGia, troGiang: 85000 } } });
    // Đọc lại từ TỆP ĐÃ GHI — kiểm thứ người dùng mở ra, không phải đối tượng trong bộ nhớ.
    const lai = new ExcelJS.Workbook();
    await lai.xlsx.load(await wb.xlsx.writeBuffer());
    const np = lai.getWorksheet("NHAP_PHAN_CONG")!;
    expect((np.getCell("C5").dataValidation as { formulae?: string[] }).formulae).toEqual(['"CS2,CS9"']);
    expect((np.getCell("B304").dataValidation as { formulae?: string[] }).formulae?.[0]).toContain("GAN_TRUC");
    const mg = wb.getWorksheet("MA_VA_GIA")!;
    const tg = mg.getRows(4, 12)!.find((r) => r.getCell(1).value === "TG")!;
    expect(tg.getCell(7).value).toBe(85000);
  });
  it("[MNP-04] VI_DU KHÔNG được bộ đọc nhập nhận (chỉ đọc sheet NHAP_PHAN_CONG)", async () => {
    const wb = dungFileMauNhap(VAO);
    wb.removeWorksheet(wb.getWorksheet("NHAP_PHAN_CONG")!.id);
    expect(docSheetNhap(await buf(wb))).toMatchObject({ ok: false });
  });
});
