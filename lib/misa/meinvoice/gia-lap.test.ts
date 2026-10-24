import { beforeEach, describe, expect, it } from "vitest";
import type { PhieuPhatHanh } from "./cong";
import { DONG_MO_PHONG, _xoaBoNhoGiaLapChoTest, maTraCuuGiaLap, soHoaDonGiaLap, taoCongGiaLap } from "./gia-lap";

function phieuMau(refId: string): PhieuPhatHanh {
  return {
    refId,
    kyHieu: "1C26TSR",
    mstNguoiBan: "0402145678",
    ngayHoaDon: new Date("2026-09-30T00:00:00.000Z"),
    nguoiMua: { hoTen: "Nguyễn Văn A", donVi: null, mst: null, diaChi: null, email: null },
    hinhThucThanhToan: "Chuyển khoản",
    dong: [{ stt: 1, ten: "Học phí", donViTinh: "Khoá", soLuong: 1, donGia: 5000000, thanhTien: 5000000, thueSuat: "KCT", tienThue: 0 }],
    tongTruocThue: 5000000,
    tongThue: 0,
    tongThanhToan: 5000000,
    soTienBangChu: "Năm triệu đồng.",
  };
}

beforeEach(() => _xoaBoNhoGiaLapChoTest());

describe("[MEI-GL] cổng giả lập", () => {
  it("[MEI-GL-01] chế độ GIA_LAP / môi trường gia-lap", () => {
    const c = taoCongGiaLap();
    expect(c.cheDo).toBe("GIA_LAP");
    expect(c.moiTruong).toBe("gia-lap");
  });

  it("[MEI-GL-02] số hoá đơn + mã tra cứu TẤT ĐỊNH từ refId, tiền tố MP, refId khác ⇒ số khác", async () => {
    const a = await taoCongGiaLap().phatHanh(phieuMau("ref-a"));
    _xoaBoNhoGiaLapChoTest();
    const a2 = await taoCongGiaLap().phatHanh(phieuMau("ref-a"));
    const b = await taoCongGiaLap().phatHanh(phieuMau("ref-b"));
    expect(a).toEqual(a2);
    expect(a).toMatchObject({ loai: "DA_PHAT_HANH", soHoaDon: soHoaDonGiaLap("ref-a"), maTraCuu: maTraCuuGiaLap("ref-a") });
    expect(soHoaDonGiaLap("ref-a")).toMatch(/^MP\d{8}$/);
    expect(maTraCuuGiaLap("ref-a")).toMatch(/^MP-/);
    expect(b.loai === "DA_PHAT_HANH" && a.loai === "DA_PHAT_HANH" && b.soHoaDon !== a.soHoaDon).toBe(true);
  });

  it("[MEI-GL-03] traCuu CHUA_CO trước khi phát hành ⇒ DA_PHAT_HANH sau", async () => {
    const c = taoCongGiaLap();
    expect(await c.traCuu("ref-c", "0402145678")).toEqual({ loai: "CHUA_CO" });
    const kq = await c.phatHanh(phieuMau("ref-c"));
    expect(await c.traCuu("ref-c", "0402145678")).toEqual(kq);
    // bộ nhớ là của tiến trình: cổng dựng mới vẫn thấy
    expect((await taoCongGiaLap().traCuu("ref-c", "0402145678")).loai).toBe("DA_PHAT_HANH");
  });

  it("[MEI-GL-04] phiếu sai ⇒ TU_CHOI, không ghi nhớ", async () => {
    const c = taoCongGiaLap();
    const p = { ...phieuMau("ref-d"), tongThanhToan: 1 };
    expect((await c.phatHanh(p)).loai).toBe("TU_CHOI");
    expect(await c.traCuu("ref-d", "0402145678")).toEqual({ loai: "CHUA_CO" });
  });

  it("[MEI-GL-05] PDF bắt đầu %PDF, có dòng mô phỏng, xref trỏ đúng offset", async () => {
    const bytes = await taoCongGiaLap().taiTep("MP-ABC", "pdf", "0402145678");
    const s = Buffer.from(bytes).toString("latin1");
    expect(s.startsWith("%PDF")).toBe(true);
    expect(s).toContain(DONG_MO_PHONG);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(s)?.[1]);
    expect(s.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...s.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it("[MEI-GL-06] XML có cùng dòng mô phỏng, escape mã tra cứu", async () => {
    const s = Buffer.from(await taoCongGiaLap().taiTep("MP-<x>", "xml", "0402145678")).toString("utf8");
    expect(s.startsWith("<?xml")).toBe(true);
    expect(s).toContain(DONG_MO_PHONG);
    expect(s).toContain("MP-&lt;x&gt;");
  });
});
