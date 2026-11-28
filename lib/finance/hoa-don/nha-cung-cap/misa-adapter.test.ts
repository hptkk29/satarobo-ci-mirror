import { describe, expect, it, vi } from "vitest";
import type { CauHinhHsm } from "@/lib/misa/meinvoice/cau-hinh";
import type { CongHoaDon, KetQuaPhatHanh } from "@/lib/misa/meinvoice/cong";
import { taoCongGiaLap, _xoaBoNhoGiaLapChoTest } from "@/lib/misa/meinvoice/gia-lap";
import { taoCongHsm, _xoaBoNhoTokenChoTest, type FetchLike } from "@/lib/misa/meinvoice/http";
import { chayBoTestHopDong, phieuMauHopDong, MST_NGUOI_BAN_MAU, type AdapterThu, type KichBan } from "./bo-test-hop-dong";
import { BAN_DO_NANG_LUC_MISA, taoMisaMeInvoiceAdapter } from "./misa-adapter";
import { NANG_LUC, type NangLuc, type ProviderSupports } from "./nang-luc";

// Bí mật GIẢ của kịch bản — chỉ để soát rằng chúng không lọt vào lỗi/nhật ký.
const CAU_HINH_BI_MAT: CauHinhHsm = {
  cheDo: "sandbox",
  baseUrl: "https://testapi.meinvoice.vn/api/v3",
  appId: "APPID-BI-MAT-0001",
  username: "tai-khoan-bi-mat",
  password: "mat-khau-bi-mat-9z",
  loaiHoaDon: "co-ma",
};

function phanHoi(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function lenhGoiAbort(): Error {
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

/** MISA giả: token OK, publish bị cắt ngang (timeout); tra cứu theo RefID trả có/không tuỳ kịch bản. */
function fetchKichBan(kichBan: Exclude<KichBan, "THANH_CONG">): FetchLike {
  return async (url, init) => {
    if (url.endsWith("/auth/token")) {
      return kichBan === "LOI_XAC_THUC" ? phanHoi({ Success: false }, 401) : phanHoi({ Success: true, Data: "token-gia" });
    }
    if (kichBan === "LOI_XAC_THUC") return phanHoi({ Success: false }, 401);
    if (url.includes("/itg/invoicepublishing/publishhsm")) throw lenhGoiAbort();
    if (url.includes("/invoicepublished/invoice-status/refid")) {
      const mang = JSON.parse(String(init?.body ?? "[]")) as string[];
      const refId = mang[0] ?? "";
      const data =
        kichBan === "TIMEOUT_DA_GHI"
          ? [
              {
                RefID: refId,
                InvNo: "0000123",
                TransactionID: `TX-${refId}`,
                InvDate: "2026-09-30T00:00:00+07:00",
                InvSeries: "C26TSR",
                InvTemplateNo: "1",
                EInvoiceStatus: "1",
              },
            ]
          : [];
      return phanHoi({ Success: true, Data: JSON.stringify(data) });
    }
    return phanHoi({ Success: false }, 404);
  };
}

function taoMisaThu(kichBan: KichBan): AdapterThu {
  _xoaBoNhoTokenChoTest();
  _xoaBoNhoGiaLapChoTest();
  if (kichBan === "THANH_CONG") return { adapter: taoMisaMeInvoiceAdapter(taoCongGiaLap()) };
  const nhatKy: string[] = [];
  const cong = taoCongHsm({
    cauHinh: CAU_HINH_BI_MAT,
    fetchImpl: fetchKichBan(kichBan),
    log: (s) => nhatKy.push(s),
  });
  return { adapter: taoMisaMeInvoiceAdapter(cong), nhatKy: () => nhatKy };
}

// ── Bộ test hợp đồng dùng chung, chạy trên MisaMeInvoiceAdapter ─────────────────────────────────────
// THANH_CONG ⇒ cổng GIA_LAP hiện có; các kịch bản lỗi ⇒ cổng HSM THẬT với fetch giả (không mạng).
chayBoTestHopDong("MisaMeInvoiceAdapter", taoMisaThu, {
  nhaCungCap: "MISA_MEINVOICE",
  adapterImplements: ["PHAT_HANH", "TRA_CUU_THEO_KHOA", "TAI_PDF", "TAI_XML"],
  biMat: [CAU_HINH_BI_MAT.appId, CAU_HINH_BI_MAT.username, CAU_HINH_BI_MAT.password, "token-gia"],
});

// ── Riêng MISA ───────────────────────────────────────────────────────────────────────────────────────

function congGia(moiTruong: CongHoaDon["moiTruong"], cheDo: CongHoaDon["cheDo"] = "HSM") {
  return {
    cheDo,
    moiTruong,
    phatHanh: vi.fn<CongHoaDon["phatHanh"]>(),
    traCuu: vi.fn<CongHoaDon["traCuu"]>(),
    taiTep: vi.fn<CongHoaDon["taiTep"]>(),
  } satisfies CongHoaDon;
}

describe("[HDNCC-MI] MisaMeInvoiceAdapter — vỏ bọc CongHoaDon, không viết lại logic", () => {
  it("[HDNCC-MI-01] khai năng lực ĐÚNG thực tế mã + mỗi mục có mức chắc chắn trong ghiChu; providerSupports lấy từ audit 10", () => {
    const cuThe: Record<NangLuc, readonly [ProviderSupports, boolean]> = {
      PHAT_HANH: ["CO", true],
      TRA_CUU_THEO_KHOA: ["CO", true],
      TAI_PDF: ["CO", true],
      TAI_XML: ["CO", true],
      KIEM_TRA_KET_NOI: ["CO", false],
      LAY_PHAP_NHAN: ["CO", false],
      DANH_MUC_MAU_KY_HIEU: ["CO", false],
      TRANG_THAI_CQT: ["CO", false],
      GUI_EMAIL: ["CO", false],
      DIEU_CHINH: ["CO", false],
      THAY_THE: ["CO", false],
      HUY: ["CO", false],
      BAO_SAI_SOT: ["CHUA_XAC_MINH", false],
    };
    for (const nl of NANG_LUC) {
      expect([BAN_DO_NANG_LUC_MISA[nl].providerSupports, BAN_DO_NANG_LUC_MISA[nl].adapterImplements], nl).toEqual(cuThe[nl]);
      // mức chắc chắn A/B/D/R/— nằm trong ngoặc vuông ở đầu ghiChu
      expect(BAN_DO_NANG_LUC_MISA[nl].ghiChu, nl).toMatch(/\[(A|B|D|R|—)/);
    }
  });

  it("[HDNCC-MI-02] chuyển tiếp NGUYÊN VẸN: cùng đối số, cùng đối tượng kết quả — kể cả KHONG_RO (không bọc lại, không sinh refId)", async () => {
    const cong = congGia("sandbox");
    const khongRo: KetQuaPhatHanh = { loai: "KHONG_RO", thongDiep: "timeout" };
    cong.phatHanh.mockResolvedValue(khongRo);
    cong.traCuu.mockResolvedValue({ loai: "CHUA_CO" });
    cong.taiTep.mockResolvedValue(new Uint8Array([1, 2]));
    const adapter = taoMisaMeInvoiceAdapter(cong);

    const phieu = phieuMauHopDong("hdncc-mi-02");
    const kq = await adapter.phatHanh(phieu);
    expect(cong.phatHanh).toHaveBeenCalledTimes(1);
    expect(cong.phatHanh.mock.calls[0]?.[0]).toBe(phieu);
    expect(kq).toBe(khongRo);

    await adapter.traCuu("khoa-cu", MST_NGUOI_BAN_MAU);
    expect(cong.traCuu).toHaveBeenCalledWith("khoa-cu", MST_NGUOI_BAN_MAU);
    await adapter.taiTep("MA", "xml", MST_NGUOI_BAN_MAU);
    expect(cong.taiTep).toHaveBeenCalledWith("MA", "xml", MST_NGUOI_BAN_MAU);
  });

  it("[HDNCC-MI-03] moiTruongVanHanh suy từ moiTruong của cổng: gia-lap→GIA_LAP · sandbox→SANDBOX · production→THAT", () => {
    expect(taoMisaMeInvoiceAdapter(congGia("gia-lap", "GIA_LAP")).moiTruongVanHanh).toBe("GIA_LAP");
    expect(taoMisaMeInvoiceAdapter(congGia("sandbox")).moiTruongVanHanh).toBe("SANDBOX");
    expect(taoMisaMeInvoiceAdapter(congGia("production")).moiTruongVanHanh).toBe("THAT");
  });

  it("[HDNCC-MI-04] moiTruong lạ (ngoài ba giá trị) ⇒ ném, không đoán — fail-closed", () => {
    const cong = congGia("sandbox");
    const lac = { ...cong, moiTruong: "staging" } as unknown as CongHoaDon;
    expect(() => taoMisaMeInvoiceAdapter(lac)).toThrow(/staging/);
  });

  it("[HDNCC-MI-05] adapter đóng băng và không có phương thức ngoài ba phương thức lõi (huy/thayThe/dieuChinh… không tồn tại)", () => {
    const adapter = taoMisaMeInvoiceAdapter(congGia("sandbox"));
    expect(Object.isFrozen(adapter)).toBe(true);
    for (const ten of ["huy", "thayThe", "dieuChinh", "layTrangThai", "guiEmail", "layPhapNhan", "layDanhMucMauKyHieu", "baoSaiSot", "kiemTraKetNoi"]) {
      expect((adapter as unknown as Record<string, unknown>)[ten], ten).toBeUndefined();
    }
  });
});
