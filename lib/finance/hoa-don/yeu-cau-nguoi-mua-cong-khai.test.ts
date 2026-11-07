// Ca [CKH-*] — ĐIỀU PHỐI đường công khai "thông tin người mua": thứ tự cổng + dịch kết quả sang lời thường ngày. Phụ thuộc GIẢ (không DB, không Next, không đồng hồ thật).
// Mọi ca "KHÔNG được" kèm đối chứng dương. Hành vi trên Postgres thật: tests/finance/hoa-don-trang-cong-khai-db.test.ts.
import { describe, expect, it, vi } from "vitest";
import type { KetQuaGhiO, KetQuaMo, MaLoi } from "./yeu-cau-nguoi-mua-db";
import {
  TAN_SUAT,
  THONG_DIEP_CONG_KHAI,
  xuLyGui,
  xuLyMoTrang,
  type CauHinhNguoiMua,
  type PhuThuoc,
} from "./yeu-cau-nguoi-mua-cong-khai";
import { ghepMaLienKet, sinhToken } from "./yeu-cau-nguoi-mua-token";

const NOW = new Date("2026-11-02T03:00:00.000Z");
const ID = "00000000-0000-4000-8000-000000000abc";
const TOKEN = sinhToken(() => Buffer.alloc(32, 7));
const MA = ghepMaLienKet(ID, TOKEN);
const CAU_HINH: CauHinhNguoiMua = { ttlPhut: 240, toiDaSaiToken: 5, toiDaLanMo: 30, khoaPhut: 15, giuDuLieuNgay: 30, choXuLyToiDaNgay: 14 };
const FORM_DUNG = { loai: "CA_NHAN", ten: "Nguyễn Thị Phụ Huynh", diaChi: "114 Hoàng Diệu, Đà Nẵng", cccd: "079000000001", email: "", maSoThue: "", dongY: true };
const PHIEN_BAN = "dk-test-1";

const loi = (ma: MaLoi, extra: Record<string, unknown> = {}) => ({ ok: false as const, ma, error: `NOI_BO_${ma}`, ...extra });

function dung(over: Partial<PhuThuoc> = {}) {
  const goi: string[] = [];
  const pt: PhuThuoc = {
    choPhep: vi.fn(async (k: string) => (goi.push(`choPhep:${k}`), true)),
    docCoSo: vi.fn(async () => (goi.push("docCoSo"), "cs-1")),
    hubBat: vi.fn(async () => (goi.push("hubBat"), true)),
    docCauHinh: vi.fn(async () => (goi.push("docCauHinh"), CAU_HINH)),
    mo: vi.fn(async (): Promise<KetQuaMo> => (goi.push("mo"), { ok: true, yeuCau: { id: ID, phamVi: "DON", hetHanLuc: NOW, o: {}, dienSan: {} } })),
    gui: vi.fn(async (): Promise<KetQuaGhiO> => (goi.push("gui"), { ok: true, oDaDoi: ["ten"], oXungDot: [] })),
    ghiLoi: vi.fn(),
    ...over,
  };
  return { pt, goi };
}
const mo = (pt: PhuThuoc, o: { ma?: unknown; ip?: string; laBot?: boolean } = {}) => xuLyMoTrang({ ma: "ma" in o ? o.ma : MA, ip: o.ip ?? "1.2.3.4", laBot: o.laBot ?? false, now: NOW }, pt);
const gui = (pt: PhuThuoc, o: { ma?: unknown; ip?: string; raw?: unknown } = {}) =>
  xuLyGui({ ma: "ma" in o ? o.ma : MA, ip: o.ip ?? "1.2.3.4", raw: o.raw ?? FORM_DUNG, phienBanDieuKhoan: PHIEN_BAN, now: NOW }, pt);

describe("[CKH-01] MỞ TRANG: đường chính + điền sẵn chỉ GIÁ TRỊ", () => {
  it("qua đủ cổng theo ĐÚNG thứ tự: tần suất IP → tần suất yêu cầu → cơ sở → cờ → cấu hình → mở", async () => {
    const { pt, goi } = dung();
    expect((await mo(pt)).kieu).toBe("FORM");
    expect(goi).toEqual(["choPhep:hoa-don-nguoi-mua:mo:ip:1.2.3.4", `choPhep:hoa-don-nguoi-mua:yeu-cau:${ID}`, "docCoSo", "hubBat", "docCauHinh", "mo"]);
  });
  it("điền sẵn từ `dienSan` (đơn / hồ sơ / lead) CHỈ dưới dạng giá trị; bỏ ô rỗng; KHÔNG lấy từ bản PH đã gửi trước đó (`o`)", async () => {
    const { pt } = dung({
      mo: vi.fn(async (): Promise<KetQuaMo> => ({
        ok: true,
        yeuCau: {
          id: ID,
          phamVi: "DON",
          hetHanLuc: NOW,
          o: { ten: { giaTri: "Tên PH gửi lần trước", nguon: "PHU_HUYNH", luc: "2026-11-02T01:00:00.000Z" } },
          dienSan: { ten: "Nguyễn Thị Gốc", email: "" },
        },
      })),
    });
    const r = await mo(pt);
    expect(r).toEqual({ kieu: "FORM", o: { ten: "Nguyễn Thị Gốc" } });
    expect(JSON.stringify(r)).not.toMatch(/SALE_NHAP_THAY|PHU_HUYNH|luc|nguon|lần trước/);
  });
  it("[CKH-04b] ⛔ HAI ô CCCD KHÔNG BAO GIỜ được điền sẵn lên trang công khai, dù `dienSan` lỡ mang chúng — lộ liên kết không được lộ CCCD; SĐT + ngày sinh học viên thì ĐƯỢC (chủ dự án chốt 03/11)", async () => {
    const { pt } = dung({
      mo: vi.fn(async (): Promise<KetQuaMo> => ({
        ok: true,
        yeuCau: {
          id: ID,
          phamVi: "DON",
          hetHanLuc: NOW,
          o: {},
          dienSan: { ten: "Nguyễn Thị Gốc", cccd: "048123456789", sdt: "0905123456", tenHocVien: "Bé", ngaySinhHocVien: "2016-08-03", cccdHocVien: "048987654321" },
        },
      })),
    });
    const r = await mo(pt);
    expect(r).toEqual({ kieu: "FORM", o: { ten: "Nguyễn Thị Gốc", sdt: "0905123456", tenHocVien: "Bé", ngaySinhHocVien: "2016-08-03" } }); // đối chứng dương: các ô còn lại vẫn điền sẵn
    expect(JSON.stringify(r)).not.toMatch(/048123456789|048987654321/);
  });
  it("truyền ĐÚNG id + token tách từ mã, giới hạn từ cấu hình, và `now`", async () => {
    const { pt } = dung();
    await mo(pt);
    expect(pt.mo).toHaveBeenCalledWith({ id: ID, token: TOKEN, gioiHan: { toiDaSaiToken: 5, toiDaLanMo: 30, khoaPhut: 15 }, now: NOW });
  });
});

describe("[CKH-02] MỞ TRANG: CỜ TẮT ⇒ không gọi dịch vụ, không ghi, cùng câu với liên kết sai", () => {
  it("cờ TẮT ⇒ «không còn hiệu lực», `mo` KHÔNG được gọi; đối chứng: cờ BẬT ⇒ gọi `mo`", async () => {
    const tat = dung({ hubBat: vi.fn(async () => false) });
    expect(await mo(tat.pt)).toEqual({ kieu: "KHONG_CON_HIEU_LUC", thongDiep: THONG_DIEP_CONG_KHAI.KHONG_CON_HIEU_LUC });
    expect(tat.pt.mo).not.toHaveBeenCalled();
    expect(tat.pt.docCauHinh).not.toHaveBeenCalled();
    const bat = dung();
    expect((await mo(bat.pt)).kieu).toBe("FORM");
    expect(bat.pt.mo).toHaveBeenCalledTimes(1);
  });
  it("cờ hỏi bằng CƠ SỞ của yêu cầu (không phải hằng, không phải cơ sở khác)", async () => {
    const { pt } = dung({ docCoSo: vi.fn(async () => "cs-xyz") });
    await mo(pt);
    expect(pt.hubBat).toHaveBeenCalledWith("cs-xyz");
  });
  it("câu của cờ TẮT, id lạ, bot và mã sai hình dạng ĐỀU GIỐNG HỆT nhau (không lộ lý do)", async () => {
    const cuaCoTat = await mo(dung({ hubBat: vi.fn(async () => false) }).pt);
    const cuaIdLa = await mo(dung({ docCoSo: vi.fn(async () => null) }).pt);
    const cuaBot = await mo(dung().pt, { laBot: true });
    const cuaMaSai = await mo(dung().pt, { ma: "khong-co-dau-cham" });
    expect(cuaIdLa).toEqual(cuaCoTat);
    expect(cuaBot).toEqual(cuaCoTat);
    expect(cuaMaSai).toEqual(cuaCoTat);
  });
});

describe("[CKH-03] MỞ TRANG: mã sai hình dạng và bot không chạm gì", () => {
  it.each([[undefined], [null], [""], ["abc"], [".token"], [`${ID}.ngan`], [`${ID}.${TOKEN}.thua`], [42]])("mã %j ⇒ không cổng nào được hỏi", async (ma) => {
    const { pt, goi } = dung();
    expect((await mo(pt, { ma })).kieu).toBe("KHONG_CON_HIEU_LUC");
    expect(goi).toEqual([]);
  });
  it("bot xem trước ⇒ KHÔNG gọi `mo` (không ăn lượt mở của khách thật); đối chứng: người ⇒ gọi", async () => {
    const bot = dung();
    expect((await mo(bot.pt, { laBot: true })).kieu).toBe("KHONG_CON_HIEU_LUC");
    expect(bot.goi).toEqual([]);
    const nguoi = dung();
    await mo(nguoi.pt, { laBot: false });
    expect(nguoi.pt.mo).toHaveBeenCalledTimes(1);
  });
});

describe("[CKH-04] RATE-LIMIT chạy TRƯỚC mọi truy cập DB", () => {
  it("vượt hạn mức theo IP ⇒ «quá nhanh», không đọc cơ sở, không đọc cờ, không mở; đối chứng: còn hạn ⇒ đi tiếp", async () => {
    const { pt, goi } = dung({ choPhep: vi.fn(async () => false) });
    expect(await mo(pt)).toEqual({ kieu: "QUA_NHANH", thongDiep: THONG_DIEP_CONG_KHAI.QUA_NHANH });
    expect(goi).toEqual([]);
    expect(pt.docCoSo).not.toHaveBeenCalled();
    expect(pt.mo).not.toHaveBeenCalled();
    expect((await mo(dung().pt)).kieu).toBe("FORM");
  });
  it("vượt hạn mức theo ID YÊU CẦU (IP còn hạn) ⇒ cũng chặn trước DB", async () => {
    const { pt } = dung({ choPhep: vi.fn(async (k: string) => !k.includes(":yeu-cau:")) });
    expect((await mo(pt)).kieu).toBe("QUA_NHANH");
    expect(pt.docCoSo).not.toHaveBeenCalled();
  });
  it("khoá hạn mức mang IP + id đúng, và hạn mức khớp hằng `TAN_SUAT`", async () => {
    const { pt } = dung();
    await mo(pt, { ip: "9.9.9.9" });
    expect(pt.choPhep).toHaveBeenNthCalledWith(1, "hoa-don-nguoi-mua:mo:ip:9.9.9.9", TAN_SUAT.moTheoIp.toiDa, TAN_SUAT.moTheoIp.cuaSoMs);
    expect(pt.choPhep).toHaveBeenNthCalledWith(2, `hoa-don-nguoi-mua:yeu-cau:${ID}`, TAN_SUAT.theoYeuCau.toiDa, TAN_SUAT.theoYeuCau.cuaSoMs);
  });
  it("MỞ và GỬI dùng hai khoá IP khác nhau (gửi không ăn hạn mức của mở)", async () => {
    const a = dung();
    await mo(a.pt);
    const b = dung();
    await gui(b.pt);
    expect(a.goi[0]).toMatch(/^choPhep:hoa-don-nguoi-mua:mo:ip:/);
    expect(b.goi[0]).toMatch(/^choPhep:hoa-don-nguoi-mua:gui:ip:/);
  });
});

describe("[CKH-05] MỞ TRANG: dịch kết quả của dịch vụ", () => {
  it("KHOA ⇒ câu «tạm khoá» RIÊNG; mọi mã khác ⇒ MỘT câu chung (không lộ lý do)", async () => {
    const khoa = await mo(dung({ mo: vi.fn(async (): Promise<KetQuaMo> => loi("KHOA")) }).pt);
    expect(khoa).toEqual({ kieu: "KHOA", thongDiep: THONG_DIEP_CONG_KHAI.KHOA });
    const chung: MaLoi[] = ["KHONG_HOP_LE", "HET_HAN", "DA_DONG", "VUOT_SO_LAN_MO", "KHONG_CO_QUYEN"];
    for (const ma of chung) {
      expect(await mo(dung({ mo: vi.fn(async (): Promise<KetQuaMo> => loi(ma)) }).pt)).toEqual({ kieu: "KHONG_CON_HIEU_LUC", thongDiep: THONG_DIEP_CONG_KHAI.KHONG_CON_HIEU_LUC });
    }
  });
  it("câu trả về KHÔNG chứa mã nội bộ hay chuỗi `error` của dịch vụ", async () => {
    for (const ma of ["KHOA", "HET_HAN", "DA_DONG", "VUOT_SO_LAN_MO", "KHONG_HOP_LE"] as const) {
      const r = await mo(dung({ mo: vi.fn(async (): Promise<KetQuaMo> => loi(ma)) }).pt);
      expect(JSON.stringify(r)).not.toMatch(/NOI_BO|HET_HAN|DA_DONG|VUOT_SO_LAN_MO|KHONG_HOP_LE|KHONG_CO_QUYEN/);
    }
  });
  it("dịch vụ NÉM ⇒ «hệ thống bận», ghi lỗi bằng TÊN loại (không thông điệp), không ném ra ngoài", async () => {
    class LoiGiaTien extends Error {
      override name = "PrismaClientKnownRequestError";
    }
    const { pt } = dung({ mo: vi.fn(async (): Promise<KetQuaMo> => { throw new LoiGiaTien("Invalid invocation: where: { tokenHash: 'abc-bi-mat' }"); }) });
    const r = await mo(pt);
    expect(r).toEqual({ kieu: "LOI_TAM", thongDiep: THONG_DIEP_CONG_KHAI.LOI_TAM });
    expect(pt.ghiLoi).toHaveBeenCalledWith("PrismaClientKnownRequestError");
    expect(JSON.stringify(vi.mocked(pt.ghiLoi).mock.calls)).not.toMatch(/abc-bi-mat|tokenHash/);
  });
});

describe("[CKH-06] GỬI: cờ TẮT và các cổng chặn TRƯỚC khi kiểm biểu mẫu / gọi dịch vụ", () => {
  it("cờ TẮT ⇒ «không còn hiệu lực», `gui` KHÔNG được gọi; đối chứng: cờ BẬT ⇒ ok", async () => {
    const tat = dung({ hubBat: vi.fn(async () => false) });
    expect(await gui(tat.pt)).toEqual({ ok: false, kieu: "KHONG_CON_HIEU_LUC", thongDiep: THONG_DIEP_CONG_KHAI.KHONG_CON_HIEU_LUC });
    expect(tat.pt.gui).not.toHaveBeenCalled();
    expect(tat.pt.docCauHinh).not.toHaveBeenCalled();
    const bat = dung();
    expect(await gui(bat.pt)).toEqual({ ok: true });
    expect(bat.pt.gui).toHaveBeenCalledTimes(1);
  });
  it("cờ TẮT + dữ liệu SAI ⇒ vẫn là «không còn hiệu lực» (không lộ rằng biểu mẫu đã được kiểm)", async () => {
    const r = await gui(dung({ hubBat: vi.fn(async () => false) }).pt, { raw: { loai: "" } });
    expect(r).toMatchObject({ ok: false, kieu: "KHONG_CON_HIEU_LUC" });
  });
  it("vượt hạn mức ⇒ «quá nhanh», không đọc cơ sở, không gọi dịch vụ; đối chứng: còn hạn ⇒ gọi", async () => {
    const { pt } = dung({ choPhep: vi.fn(async () => false) });
    expect(await gui(pt)).toMatchObject({ ok: false, kieu: "QUA_NHANH" });
    expect(pt.docCoSo).not.toHaveBeenCalled();
    expect(pt.gui).not.toHaveBeenCalled();
  });
  it("mã sai hình dạng / id lạ ⇒ «không còn hiệu lực» không chạm dịch vụ", async () => {
    const a = dung();
    expect(await gui(a.pt, { ma: "rac" })).toMatchObject({ ok: false, kieu: "KHONG_CON_HIEU_LUC" });
    expect(a.goi).toEqual([]);
    const b = dung({ docCoSo: vi.fn(async () => null) });
    expect(await gui(b.pt)).toMatchObject({ ok: false, kieu: "KHONG_CON_HIEU_LUC" });
    expect(b.pt.gui).not.toHaveBeenCalled();
  });
});

describe("[CKH-07] GỬI: kiểm biểu mẫu + ghi đồng ý", () => {
  it("biểu mẫu sai ⇒ lỗi theo ô, KHÔNG gọi dịch vụ; đối chứng: sửa đúng ⇒ gọi", async () => {
    const { pt } = dung();
    const r = await gui(pt, { raw: { ...FORM_DUNG, ten: "" } });
    expect(r).toMatchObject({ ok: false, kieu: "DU_LIEU", loi: { theoO: { ten: expect.any(String) } } });
    expect(pt.gui).not.toHaveBeenCalled();
    expect(await gui(pt)).toEqual({ ok: true });
  });
  it("chưa tick đồng ý ⇒ chặn, không gọi dịch vụ — không đường nào ghi dữ liệu mà thiếu bản ghi đồng ý", async () => {
    const { pt } = dung();
    expect(await gui(pt, { raw: { ...FORM_DUNG, dongY: false } })).toMatchObject({ ok: false, kieu: "DU_LIEU", loi: { dongY: expect.any(String) } });
    expect(pt.gui).not.toHaveBeenCalled();
  });
  it("gọi dịch vụ với đúng id/token/giới hạn/ô đã chuẩn hoá và `donY` mang phiên bản điều khoản của trang", async () => {
    const { pt } = dung();
    await gui(pt, { raw: { ...FORM_DUNG, ten: "  Nguyễn   Thị  Phụ Huynh ", soCanCuoc: "x" } });
    expect(pt.gui).toHaveBeenCalledWith({
      id: ID,
      token: TOKEN,
      gioiHan: { toiDaSaiToken: 5, toiDaLanMo: 30, khoaPhut: 15 },
      du: { loai: "CA_NHAN", ten: "Nguyễn Thị Phụ Huynh", diaChi: "114 Hoàng Diệu, Đà Nẵng", cccd: "079000000001" },
      banDau: {},
      donY: { phienBanDieuKhoan: PHIEN_BAN },
      now: NOW,
    });
    // CCCD ba/mẹ ĐI TIẾP (luật mới); khoá lạ thì không.
    expect(JSON.stringify(vi.mocked(pt.gui).mock.calls)).not.toMatch(/soCanCuoc/);
  });
  it("[CKH-07c] `banDau` (bản điền sẵn PH nhìn thấy) đi tiếp xuống dịch vụ ĐÃ CHUẨN HOÁ; bỏ khoá lạ + hai ô CCCD + giá trị không phải chuỗi; thiếu hẳn ⇒ `{}`", async () => {
    const { pt } = dung();
    await gui(pt, { raw: { ...FORM_DUNG, banDau: { ten: "  Nguyễn   Thị Cũ ", cccd: "079000000001", cccdHocVien: "1", hoChieu: "x", sdt: 5, email: "" } } });
    expect(vi.mocked(pt.gui).mock.calls[0]![0].banDau).toEqual({ ten: "Nguyễn Thị Cũ" });
    const khong = dung();
    await gui(khong.pt);
    expect(vi.mocked(khong.pt.gui).mock.calls[0]![0].banDau).toEqual({});
  });
  it("[CKH-07b] thiếu CCCD ba/mẹ ⇒ lỗi theo ô cccd, KHÔNG gọi dịch vụ; đối chứng dương: có CCCD ⇒ gọi", async () => {
    const { pt } = dung();
    expect(await gui(pt, { raw: { ...FORM_DUNG, cccd: "" } })).toMatchObject({ ok: false, kieu: "DU_LIEU", loi: { theoO: { cccd: expect.any(String) } } });
    expect(pt.gui).not.toHaveBeenCalled();
    await gui(pt, { raw: FORM_DUNG });
    expect(pt.gui).toHaveBeenCalledTimes(1);
  });
});

describe("[CKH-08] GỬI: dịch kết quả của dịch vụ, KHÔNG lộ mã nội bộ", () => {
  it("KHOA ⇒ câu tạm khoá; DU_LIEU_SAI ⇒ lời theo ô của dịch vụ; KHONG_CO_DU_LIEU ⇒ lỗi dữ liệu chung", async () => {
    expect(await gui(dung({ gui: vi.fn(async (): Promise<KetQuaGhiO> => loi("KHOA")) }).pt)).toEqual({ ok: false, kieu: "KHOA", thongDiep: THONG_DIEP_CONG_KHAI.KHOA });
    const sai = await gui(dung({ gui: vi.fn(async (): Promise<KetQuaGhiO> => loi("DU_LIEU_SAI", { loiTheoO: { maSoThue: "Mã số thuế gồm 10 hoặc 13 chữ số" } })) }).pt);
    expect(sai).toMatchObject({ ok: false, kieu: "DU_LIEU", loi: { theoO: { maSoThue: "Mã số thuế gồm 10 hoặc 13 chữ số" } } });
    const trong = await gui(dung({ gui: vi.fn(async (): Promise<KetQuaGhiO> => loi("KHONG_CO_DU_LIEU")) }).pt);
    expect(trong).toMatchObject({ ok: false, kieu: "DU_LIEU", loi: { theoO: {} } });
  });
  it("KHONG_HOP_LE · HET_HAN · DA_DONG · VUOT_SO_LAN_MO · KHONG_CO_QUYEN ⇒ CÙNG MỘT câu «không còn hiệu lực»", async () => {
    const mau = THONG_DIEP_CONG_KHAI.KHONG_CON_HIEU_LUC;
    for (const ma of ["KHONG_HOP_LE", "HET_HAN", "DA_DONG", "VUOT_SO_LAN_MO", "KHONG_CO_QUYEN"] as const) {
      expect(await gui(dung({ gui: vi.fn(async (): Promise<KetQuaGhiO> => loi(ma)) }).pt)).toEqual({ ok: false, kieu: "KHONG_CON_HIEU_LUC", thongDiep: mau });
    }
  });
  it("không kết quả nào chứa mã nội bộ hay chuỗi `error` của dịch vụ", async () => {
    for (const ma of ["KHOA", "HET_HAN", "DA_DONG", "VUOT_SO_LAN_MO", "KHONG_HOP_LE", "KHONG_CO_DU_LIEU", "THIEU_THONG_TIN", "LY_DO_NGAN", "DA_CO_YEU_CAU_MO"] as const) {
      const r = await gui(dung({ gui: vi.fn(async (): Promise<KetQuaGhiO> => loi(ma)) }).pt);
      expect(JSON.stringify(r)).not.toMatch(/NOI_BO_|VUOT_SO_LAN_MO|KHONG_HOP_LE|DA_DONG|HET_HAN|THIEU_THONG_TIN|LY_DO_NGAN|DA_CO_YEU_CAU_MO|KHONG_CO_QUYEN|KHONG_CO_DU_LIEU/);
    }
  });
  it("dịch vụ NÉM ⇒ «hệ thống bận» + ghi TÊN loại lỗi; dữ liệu người dùng KHÔNG đi vào log", async () => {
    const { pt } = dung({ gui: vi.fn(async (): Promise<KetQuaGhiO> => { throw new Error("duplicate key value: Nguyễn Thị Phụ Huynh"); }) });
    expect(await gui(pt)).toEqual({ ok: false, kieu: "LOI_TAM", thongDiep: THONG_DIEP_CONG_KHAI.LOI_TAM });
    expect(pt.ghiLoi).toHaveBeenCalledWith("Error");
    expect(JSON.stringify(vi.mocked(pt.ghiLoi).mock.calls)).not.toMatch(/Nguyễn|duplicate/);
  });
});
