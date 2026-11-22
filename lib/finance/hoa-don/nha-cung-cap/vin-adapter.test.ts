import { describe, expect, it, vi } from "vitest";
import type { CongHoaDon, KetQuaPhatHanh } from "@/lib/misa/meinvoice/cong";
import type { CauHinhVin } from "@/lib/vin-hoadon/cau-hinh";
import { _xoaBoNhoTokenVinChoTest, taoCongVin } from "@/lib/vin-hoadon/http";
import { TAI_KHOAN_VIN_GIA, taoMayChuVinGia, type KichBanVinGia } from "@/lib/vin-hoadon/may-chu-vin-gia";
import { MST_NGUOI_BAN_MAU, chayBoTestHopDong, phieuMauHopDong, type AdapterThu, type KichBan } from "./bo-test-hop-dong";
import { NANG_LUC, type NangLuc, type ProviderSupports } from "./nang-luc";
import { BAN_DO_NANG_LUC_VIN, taoVinHoaDonAdapter } from "./vin-adapter";

const CAU_HINH: CauHinhVin = {
  cheDo: "sandbox",
  baseUrl: "https://vin-thu.example.test",
  username: TAI_KHOAN_VIN_GIA.username,
  password: TAI_KHOAN_VIN_GIA.password,
};

function taoVinThu(kichBan: KichBan): AdapterThu {
  _xoaBoNhoTokenVinChoTest();
  const may = taoMayChuVinGia(kichBan as KichBanVinGia);
  const nhatKy: string[] = [];
  const cong = taoCongVin({ cauHinh: CAU_HINH, fetchImpl: may.fetchImpl, log: (s) => nhatKy.push(s) });
  return {
    adapter: taoVinHoaDonAdapter(cong),
    nhatKy: () => nhatKy,
    datKichBan: (k) => may.datKichBan(k as KichBanVinGia),
  };
}

// ── Bộ test hợp đồng dùng chung, chạy trên VinHoaDonAdapter ─────────────────────────────────────────
// Cổng HTTP THẬT của ta + máy chủ VIN GIẢ (không mạng). Có `datKichBan` ⇒ ca tải tệp thử bằng mã tra cứu thật.
chayBoTestHopDong("VinHoaDonAdapter", taoVinThu, {
  nhaCungCap: "VIN_HOADON",
  adapterImplements: ["PHAT_HANH", "TRA_CUU_THEO_KHOA", "TAI_PDF", "TAI_XML"],
  biMat: [TAI_KHOAN_VIN_GIA.username, TAI_KHOAN_VIN_GIA.password, TAI_KHOAN_VIN_GIA.token],
});

// ── Riêng VIN ────────────────────────────────────────────────────────────────────────────────────────

function congGia(moiTruong: CongHoaDon["moiTruong"], cheDo: CongHoaDon["cheDo"] = "HSM") {
  return {
    cheDo,
    moiTruong,
    phatHanh: vi.fn<CongHoaDon["phatHanh"]>(),
    traCuu: vi.fn<CongHoaDon["traCuu"]>(),
    taiTep: vi.fn<CongHoaDon["taiTep"]>(),
  } satisfies CongHoaDon;
}

describe("[HDNCC-VIN] VinHoaDonAdapter — vỏ bọc CongHoaDon, không viết lại logic", () => {
  it("[HDNCC-VIN-01] bản đồ năng lực ĐÚNG thực tế mã + mỗi mục mang mức chắc chắn và nguồn PDF v13.0", () => {
    const cuThe: Record<NangLuc, readonly [ProviderSupports, boolean]> = {
      PHAT_HANH: ["CO", true],
      TRA_CUU_THEO_KHOA: ["CO", true],
      TAI_PDF: ["CO", true],
      TAI_XML: ["CO", true],
      KIEM_TRA_KET_NOI: ["CO", false],
      LAY_PHAP_NHAN: ["CHUA_XAC_MINH", false],
      DANH_MUC_MAU_KY_HIEU: ["CO", false],
      TRANG_THAI_CQT: ["CO", false],
      GUI_EMAIL: ["CO", false],
      DIEU_CHINH: ["CO", false],
      THAY_THE: ["CO", false],
      HUY: ["KHONG", false],
      BAO_SAI_SOT: ["CO", false],
    };
    for (const nl of NANG_LUC) {
      expect([BAN_DO_NANG_LUC_VIN[nl].providerSupports, BAN_DO_NANG_LUC_VIN[nl].adapterImplements], nl).toEqual(cuThe[nl]);
      expect(BAN_DO_NANG_LUC_VIN[nl].ghiChu, nl).toMatch(/\[(A|B|D|R|—)/);
    }
    // mọi mục "CO"/"KHONG" nói được từ PDF phải dẫn trang — không có "CO" nào là lời nói suông
    for (const nl of NANG_LUC) {
      if (BAN_DO_NANG_LUC_VIN[nl].providerSupports === "CO") expect(BAN_DO_NANG_LUC_VIN[nl].ghiChu, nl).toMatch(/\bp\d/);
    }
  });

  it("[HDNCC-VIN-02] chuyển tiếp NGUYÊN VẸN: cùng đối số, cùng đối tượng kết quả — kể cả KHONG_RO (không bọc lại, không sinh refId)", async () => {
    const cong = congGia("sandbox");
    const khongRo: KetQuaPhatHanh = { loai: "KHONG_RO", thongDiep: "timeout" };
    cong.phatHanh.mockResolvedValue(khongRo);
    cong.traCuu.mockResolvedValue({ loai: "CHUA_CO" });
    cong.taiTep.mockResolvedValue(new Uint8Array([1, 2]));
    const adapter = taoVinHoaDonAdapter(cong);

    const phieu = phieuMauHopDong("hdncc-vin-02");
    const kq = await adapter.phatHanh(phieu);
    expect(cong.phatHanh).toHaveBeenCalledTimes(1);
    expect(cong.phatHanh.mock.calls[0]?.[0]).toBe(phieu);
    expect(kq).toBe(khongRo);

    await adapter.traCuu("khoa-cu", MST_NGUOI_BAN_MAU);
    expect(cong.traCuu).toHaveBeenCalledWith("khoa-cu", MST_NGUOI_BAN_MAU);
    await adapter.taiTep("MA", "xml", MST_NGUOI_BAN_MAU);
    expect(cong.taiTep).toHaveBeenCalledWith("MA", "xml", MST_NGUOI_BAN_MAU);
  });

  it("[HDNCC-VIN-03] moiTruongVanHanh suy từ moiTruong của cổng: gia-lap→GIA_LAP · sandbox→SANDBOX · production→THAT", () => {
    expect(taoVinHoaDonAdapter(congGia("gia-lap", "GIA_LAP")).moiTruongVanHanh).toBe("GIA_LAP");
    expect(taoVinHoaDonAdapter(congGia("sandbox")).moiTruongVanHanh).toBe("SANDBOX");
    expect(taoVinHoaDonAdapter(congGia("production")).moiTruongVanHanh).toBe("THAT");
  });

  it("[HDNCC-VIN-04] moiTruong lạ ⇒ ném, không đoán — fail-closed", () => {
    const lac = { ...congGia("sandbox"), moiTruong: "staging" } as unknown as CongHoaDon;
    expect(() => taoVinHoaDonAdapter(lac)).toThrow(/staging/);
  });

  it("[HDNCC-VIN-05] adapter đóng băng, KHÔNG có phương thức ngoài ba lõi — huỷ/thay thế/điều chỉnh/sai sót chưa nối (OD-10)", () => {
    const adapter = taoVinHoaDonAdapter(congGia("sandbox"));
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(adapter.nhaCungCap).toBe("VIN_HOADON");
    for (const ten of ["huy", "thayThe", "dieuChinh", "layTrangThai", "guiEmail", "layPhapNhan", "layDanhMucMauKyHieu", "baoSaiSot", "kiemTraKetNoi"]) {
      expect((adapter as unknown as Record<string, unknown>)[ten], ten).toBeUndefined();
    }
  });
});
