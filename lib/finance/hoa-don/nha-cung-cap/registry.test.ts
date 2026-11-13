import { describe, expect, it, vi } from "vitest";
import type { CongHoaDon } from "@/lib/misa/meinvoice/cong";
import type { HoaDonNhaCungCap } from "./hop-dong";
import { taoMisaMeInvoiceAdapter } from "./misa-adapter";
import { taoMockAdapter } from "./mock-adapter";
import { LoiDangKyNhaCungCap, taoRegistryNhaCungCap, type MoiTruongDangKy, type MucDangKy } from "./registry";
import { taoViettelSInvoiceAdapter } from "./stub-chua-ho-tro";
import { taoVinHoaDonAdapter } from "./vin-adapter";

function congGia(moiTruong: CongHoaDon["moiTruong"]): CongHoaDon {
  return {
    cheDo: moiTruong === "gia-lap" ? "GIA_LAP" : "HSM",
    moiTruong,
    phatHanh: vi.fn(),
    traCuu: vi.fn(),
    taiTep: vi.fn(),
  };
}

const misaThat = () => taoMisaMeInvoiceAdapter(congGia("production"));
const misaSandbox = () => taoMisaMeInvoiceAdapter(congGia("sandbox"));
const mock = () => taoMockAdapter({ cheDo: "THANH_CONG" });

function muc(phapNhanMa: string, moiTruong: MoiTruongDangKy, nhaCungCap: MucDangKy["nhaCungCap"], taoAdapter: () => HoaDonNhaCungCap): MucDangKy {
  return { phapNhanMa, moiTruong, nhaCungCap, taoAdapter };
}

function bat(f: () => unknown): LoiDangKyNhaCungCap {
  try {
    f();
  } catch (e) {
    if (e instanceof LoiDangKyNhaCungCap) return e;
    throw e;
  }
  throw new Error("kỳ vọng ném LoiDangKyNhaCungCap nhưng không ném gì");
}

describe("[HDNCC-RG] ProviderRegistry — thuần, không rơi về adapter khác", () => {
  it("[HDNCC-RG-01] tìm đúng khoá (pháp nhân × môi trường) ⇒ đúng adapter; hai lần hỏi cùng một thể hiện (dựng lười một lần)", () => {
    const tao = vi.fn(misaThat);
    const rg = taoRegistryNhaCungCap([muc("CS1", "PROD", "MISA_MEINVOICE", tao), muc("CS1", "TEST", "MOCK", mock)]);
    const a = rg.layAdapter("CS1", "PROD");
    expect(a?.nhaCungCap).toBe("MISA_MEINVOICE");
    expect(rg.layAdapter("CS1", "PROD")).toBe(a);
    expect(tao).toHaveBeenCalledTimes(1);
    expect(rg.layAdapter("CS1", "TEST")?.nhaCungCap).toBe("MOCK");
  });

  it("[HDNCC-RG-02] KHÔNG tìm thấy ⇒ null — pháp nhân lạ, và CẢ HAI chiều TEST↔PROD (không rơi sang môi trường kia)", () => {
    const soloTest = taoRegistryNhaCungCap([muc("CS1", "TEST", "MOCK", mock)]);
    expect(soloTest.layAdapter("CS1", "TEST")).not.toBeNull(); // đối chứng dương
    expect(soloTest.layAdapter("CS1", "PROD")).toBeNull(); // PROD phải khai tường minh
    const soloProd = taoRegistryNhaCungCap([muc("CS1", "PROD", "MISA_MEINVOICE", misaThat)]);
    expect(soloProd.layAdapter("CS1", "PROD")).not.toBeNull();
    expect(soloProd.layAdapter("CS1", "TEST")).toBeNull();
    expect(soloTest.layAdapter("CS2", "TEST")).toBeNull();
  });

  it("[HDNCC-RG-03] không tìm thấy thì KHÔNG dựng (và không hỏi) adapter của mục khác — không chuyển nhà cung cấp ngầm", () => {
    const taoA = vi.fn(misaThat);
    const taoB = vi.fn(mock);
    const rg = taoRegistryNhaCungCap([muc("CS1", "PROD", "MISA_MEINVOICE", taoA), muc("CS2", "TEST", "MOCK", taoB)]);
    expect(rg.layAdapter("CS3", "PROD")).toBeNull();
    expect(rg.layAdapter("CS2", "PROD")).toBeNull();
    expect(taoA).not.toHaveBeenCalled();
    expect(taoB).not.toHaveBeenCalled();
  });

  it("[HDNCC-RG-04] CẤM hai adapter cho cùng khoá (kể cả khác nhà cung cấp); cùng pháp nhân khác môi trường, hoặc khác pháp nhân cùng môi trường thì được", () => {
    const loi = bat(() => taoRegistryNhaCungCap([muc("CS1", "TEST", "MOCK", mock), muc("CS1", "TEST", "MISA_MEINVOICE", misaSandbox)]));
    expect(loi.ma).toBe("DUPLICATE_PROVIDER_BINDING");
    expect(loi.message).toContain("CS1");
    expect(bat(() => taoRegistryNhaCungCap([muc("CS1", "TEST", "MOCK", mock), muc("CS1", "TEST", "MOCK", mock)])).ma).toBe(
      "DUPLICATE_PROVIDER_BINDING",
    );
    expect(() => taoRegistryNhaCungCap([muc("CS1", "TEST", "MOCK", mock), muc("CS1", "PROD", "MISA_MEINVOICE", misaThat)])).not.toThrow();
    expect(() => taoRegistryNhaCungCap([muc("CS1", "TEST", "MOCK", mock), muc("CS2", "TEST", "MOCK", mock)])).not.toThrow();
  });

  it("[HDNCC-RG-05] môi trường lúc chạy sai kiểu ('prod' thường, rỗng, undefined) ⇒ null, không đoán thành PROD/TEST", () => {
    const rg = taoRegistryNhaCungCap([muc("CS1", "PROD", "MISA_MEINVOICE", misaThat), muc("CS1", "TEST", "MOCK", mock)]);
    for (const sai of ["prod", "Prod", "", "STAGING", undefined, null]) {
      expect(rg.layAdapter("CS1", sai as unknown as MoiTruongDangKy), String(sai)).toBeNull();
    }
    expect(rg.layAdapter("cs1", "PROD")).toBeNull(); // khớp CHÍNH XÁC, không chuẩn hoá chữ hoa
    expect(rg.layAdapter(" CS1", "PROD")).toBeNull();
  });

  it("[HDNCC-RG-06] cặp môi trường phải khớp: PROD chỉ nhận adapter THẬT; TEST không nhận adapter THẬT (không phát hành chứng từ thuế thật từ môi trường test)", () => {
    // PROD + MOCK: chắc chắn sai nên bị chặn ngay lúc dựng registry (không cần dựng adapter)
    expect(bat(() => taoRegistryNhaCungCap([muc("CS1", "PROD", "MOCK", mock)])).ma).toBe("PROVIDER_ENVIRONMENT_MISMATCH");
    // PROD + GIA_LAP / SANDBOX ⇒ lỗi lúc dựng adapter (hoá đơn 'thật' mà hoá ra mô phỏng/thử)
    for (const [ten, tao] of [
      ["misa sandbox", misaSandbox],
      ["misa gia-lap", () => taoMisaMeInvoiceAdapter(congGia("gia-lap"))],
    ] as const) {
      const rg = taoRegistryNhaCungCap([muc("CS1", "PROD", "MISA_MEINVOICE", tao)]);
      expect(bat(() => rg.layAdapter("CS1", "PROD")).ma, ten).toBe("PROVIDER_ENVIRONMENT_MISMATCH");
    }
    // TEST + THẬT ⇒ lỗi
    const rgTest = taoRegistryNhaCungCap([muc("CS1", "TEST", "MISA_MEINVOICE", misaThat)]);
    expect(bat(() => rgTest.layAdapter("CS1", "TEST")).ma).toBe("PROVIDER_ENVIRONMENT_MISMATCH");
    // đối chứng dương: TEST + SANDBOX/GIA_LAP, PROD + THẬT đều qua
    const ok = taoRegistryNhaCungCap([
      muc("A", "TEST", "MISA_MEINVOICE", misaSandbox),
      muc("B", "TEST", "MOCK", mock),
      muc("C", "PROD", "MISA_MEINVOICE", misaThat),
    ]);
    expect(ok.layAdapter("A", "TEST")).not.toBeNull();
    expect(ok.layAdapter("B", "TEST")).not.toBeNull();
    expect(ok.layAdapter("C", "PROD")).not.toBeNull();
  });

  it("[HDNCC-RG-07] nhà cung cấp khai trong mục ≠ nhà cung cấp của adapter dựng ra ⇒ ném (không đổi nhà cung cấp ngầm qua hàm tạo)", () => {
    const rg = taoRegistryNhaCungCap([muc("CS1", "TEST", "MISA_MEINVOICE", mock)]);
    expect(bat(() => rg.layAdapter("CS1", "TEST")).ma).toBe("PROVIDER_MISMATCH");
  });

  it("[HDNCC-RG-08] stub BLOCKED (Viettel) không đăng ký chạy được ở cả TEST lẫn PROD", () => {
    for (const moiTruong of ["TEST", "PROD"] as const) {
      const rg = taoRegistryNhaCungCap([muc("VT", moiTruong, "VIETTEL_SINVOICE", taoViettelSInvoiceAdapter)]);
      expect(bat(() => rg.layAdapter("VT", moiTruong)).ma, `VT ${moiTruong}`).toBe("PROVIDER_ENVIRONMENT_MISMATCH");
    }
  });

  it("[HDNCC-RG-08b] VIN-HOADON (adapter thật, không còn là stub): sandbox chỉ vào TEST, môi trường thật chỉ vào PROD — đổi chéo ⇒ ném", () => {
    const vinSandbox = () => taoVinHoaDonAdapter(congGia("sandbox"));
    const vinThat = () => taoVinHoaDonAdapter(congGia("production"));
    // đối chứng DƯƠNG: đúng cặp thì lấy được adapter VIN
    const dung = taoRegistryNhaCungCap([muc("VIN", "TEST", "VIN_HOADON", vinSandbox), muc("VIN", "PROD", "VIN_HOADON", vinThat)]);
    expect(dung.layAdapter("VIN", "TEST")?.nhaCungCap).toBe("VIN_HOADON");
    expect(dung.layAdapter("VIN", "PROD")?.moiTruongVanHanh).toBe("THAT");
    // đổi chéo: cổng sandbox khai PROD, cổng thật khai TEST ⇒ PROVIDER_ENVIRONMENT_MISMATCH (không phát hành thuế từ môi trường thử)
    const sandboxVaoProd = taoRegistryNhaCungCap([muc("VIN", "PROD", "VIN_HOADON", vinSandbox)]);
    expect(bat(() => sandboxVaoProd.layAdapter("VIN", "PROD")).ma).toBe("PROVIDER_ENVIRONMENT_MISMATCH");
    const thatVaoTest = taoRegistryNhaCungCap([muc("VIN", "TEST", "VIN_HOADON", vinThat)]);
    expect(bat(() => thatVaoTest.layAdapter("VIN", "TEST")).ma).toBe("PROVIDER_ENVIRONMENT_MISMATCH");
  });

  it("[HDNCC-RG-09] khoá khai sai hình (rỗng, thừa khoảng trắng, môi trường/nhà cung cấp lạ, hàm tạo không phải hàm) ⇒ ném lúc dựng registry", () => {
    const loiKhoa = ["", "  ", " CS1", "CS1 "];
    for (const k of loiKhoa) {
      expect(bat(() => taoRegistryNhaCungCap([muc(k, "TEST", "MOCK", mock)])).ma, JSON.stringify(k)).toBe("INVALID_PROVIDER_BINDING");
    }
    expect(bat(() => taoRegistryNhaCungCap([muc("CS1", "STAGING" as MoiTruongDangKy, "MOCK", mock)])).ma).toBe("INVALID_PROVIDER_BINDING");
    expect(bat(() => taoRegistryNhaCungCap([muc("CS1", "TEST", "BKAV" as MucDangKy["nhaCungCap"], mock)])).ma).toBe("INVALID_PROVIDER_BINDING");
    expect(bat(() => taoRegistryNhaCungCap([muc("CS1", "TEST", "MOCK", "khong-phai-ham" as unknown as () => HoaDonNhaCungCap)])).ma).toBe(
      "INVALID_PROVIDER_BINDING",
    );
  });

  it("[HDNCC-RG-10] mục sai cặp môi trường KHÔNG bị nhớ đệm: hỏi lại vẫn ném (không có đường 'lần hai thì qua')", () => {
    const rg = taoRegistryNhaCungCap([muc("CS1", "PROD", "MISA_MEINVOICE", misaSandbox)]);
    expect(bat(() => rg.layAdapter("CS1", "PROD")).ma).toBe("PROVIDER_ENVIRONMENT_MISMATCH");
    expect(bat(() => rg.layAdapter("CS1", "PROD")).ma).toBe("PROVIDER_ENVIRONMENT_MISMATCH");
  });

  it("[HDNCC-RG-11] danhSachKhaiBao + coKhaiBao: mô tả mục KHÔNG dựng adapter; kết quả là bản sao (sửa không đổi registry)", () => {
    const tao = vi.fn(misaThat);
    const rg = taoRegistryNhaCungCap([muc("CS1", "PROD", "MISA_MEINVOICE", tao)]);
    expect(rg.coKhaiBao("CS1", "PROD")).toBe(true);
    expect(rg.coKhaiBao("CS1", "TEST")).toBe(false);
    const ds = rg.danhSachKhaiBao() as unknown as { phapNhanMa: string }[];
    expect(ds).toEqual([{ phapNhanMa: "CS1", moiTruong: "PROD", nhaCungCap: "MISA_MEINVOICE" }]);
    ds[0]!.phapNhanMa = "BI-SUA";
    expect(rg.danhSachKhaiBao()[0]?.phapNhanMa).toBe("CS1");
    expect(tao).not.toHaveBeenCalled();
  });

  it("[HDNCC-RG-12] registry rỗng hợp lệ và luôn trả null", () => {
    const rg = taoRegistryNhaCungCap([]);
    expect(rg.layAdapter("CS1", "PROD")).toBeNull();
    expect(rg.layAdapter("CS1", "TEST")).toBeNull();
    expect(rg.danhSachKhaiBao()).toEqual([]);
  });
});
