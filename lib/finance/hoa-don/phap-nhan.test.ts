// Ca [PN-*] — pháp nhân phát hành + thuế theo loại đơn.
import { describe, it, expect } from "vitest";
import { KIEU_GIA } from "@/lib/finance/hoa-don/tinh-hoa-don";
import {
  CAU_HINH_HOA_DON_MAC_DINH,
  kiemCauHinhHoaDon,
  phapNhanChoDon,
  thueChoLoaiDon,
  type CauHinhHoaDon,
} from "@/lib/finance/hoa-don/phap-nhan";

const sao = (): CauHinhHoaDon =>
  JSON.parse(JSON.stringify(CAU_HINH_HOA_DON_MAC_DINH)) as CauHinhHoaDon;

describe("[PN-01] mặc định phải KHỚP hoá đơn thật", () => {
  it("hai pháp nhân, đúng tên và mã số thuế in trên giấy", () => {
    const c = CAU_HINH_HOA_DON_MAC_DINH;
    const sata = c.phapNhan.find((p) => p.ma === "SATA_ROBO");
    const nv = c.phapNhan.find((p) => p.ma === "NEW_VISION");
    expect(sata?.ten).toBe("CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC SATA ROBO");
    expect(sata?.maSoThue).toBe("0402301783");
    expect(sata?.kyHieu).toBe("1C26TSR");
    expect(nv?.ten).toBe("CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC NEW VISION");
    expect(nv?.maSoThue).toBe("0402341070");
    expect(nv?.kyHieu).toBe("1C26MNV");
  });

  it("bản mặc định TỰ NÓ phải hợp lệ — không giao hàng một cấu hình sai sẵn", () => {
    expect(kiemCauHinhHoaDon(CAU_HINH_HOA_DON_MAC_DINH)).toEqual([]);
  });

  it("ánh xạ cơ sở → pháp nhân là DỮ LIỆU KHAI, chỉ khai cơ sở đã có người quyết", () => {
    // ⚠️ CA NÀY ĐẢO TIỀN ĐỀ [15/09/2026]. Bản cũ ghim `macDinhTheoCoSo` phải RỖNG, với lý
    // lẽ "ba tờ mẫu không nói cơ sở nào phát hành qua pháp nhân nào — đoán là in sai mã số
    // thuế". Lý lẽ đó đúng với ĐOÁN, và vẫn đúng.
    //
    // Nhưng chủ dự án đã QUYẾT 15/09: *"cs1 là satarobo còn cs2 là new vision đấy nhé"*.
    // Đó không phải suy luận, đó là người biết nói ra. Giữ ô rỗng lúc này không còn là thận
    // trọng mà là bỏ một câu trả lời đã có: trong lúc rỗng, phiếu RCP-CS2-26-0011 của một
    // đơn CS2 đã in ra pháp nhân Sata Robo với MST 0402301783.
    //
    // ⚠️ ĐẢO LẦN THỨ HAI [22/09/2026] — Ban lãnh đạo, trong phiếu quyết định hồ sơ Bộ Công
    // Thương: *"Xuất hoá đơn Sata Robo"* cho giao dịch phát sinh qua website. Lý do: hồ sơ
    // đăng ký website đứng tên SATA ROBO, nên chứng từ của giao dịch trên website phải
    // cùng pháp nhân đó; để CS2 đứng tên New Vision là phụ huynh mua ở một nơi, nhận
    // chứng từ của một nơi khác.
    //
    // Pháp nhân NEW_VISION VẪN CÒN trong danh sách — hoá đơn cũ đã phát hành dưới tên đó,
    // xoá đi là mất đường tra ngược. Chỉ gỡ ánh xạ MẶC ĐỊNH.
    //
    // Luật còn lại: CHỈ khai cơ sở đã có người quyết. CS91/CS92/HO không nằm trong câu chốt
    // nên không được điền bừa — chúng rơi về `phapNhanMacDinh`, và đó là hành vi đúng.
    expect(CAU_HINH_HOA_DON_MAC_DINH.macDinhTheoCoSo).toEqual([
      { maCoSo: "CS1", maPhapNhan: "SATA_ROBO" },
      { maCoSo: "CS2", maPhapNhan: "SATA_ROBO" },
    ]);
  });
});

describe("[PN-02] thueChoLoaiDon", () => {
  it("dòng khai ĐÍCH DANH thắng dòng TAT_CA", () => {
    const c = sao();
    c.thue.push({
      loaiDon: "COURSE",
      thueSuat: 8,
      kieuGia: KIEU_GIA.CHUA_GOM_THUE,
    });
    // Đúng ca 1C26TSR-127: học phí tính thuế CỘNG THÊM, trong khi mặc định là đã-gồm.
    expect(thueChoLoaiDon("COURSE", c)).toEqual({
      thueSuat: 8,
      kieuGia: KIEU_GIA.CHUA_GOM_THUE,
    });
    expect(thueChoLoaiDon("PRODUCT", c)).toEqual({
      thueSuat: 8,
      kieuGia: KIEU_GIA.DA_GOM_THUE,
    });
  });

  it("không có dòng nào ⇒ 8% / đã gồm thuế, KHÔNG phải 0%", () => {
    // Hoá đơn in nhầm 0% là sai tờ khai thuế và không có gì báo lỗi.
    expect(thueChoLoaiDon("COURSE", { thue: [] })).toEqual({
      thueSuat: 8,
      kieuGia: KIEU_GIA.DA_GOM_THUE,
    });
  });
});

describe("[PN-03] phapNhanChoDon", () => {
  it("theo cơ sở trước, rồi mặc định chung", () => {
    const c = sao();
    c.macDinhTheoCoSo = [{ maCoSo: "CS2", maPhapNhan: "NEW_VISION" }];
    expect(phapNhanChoDon("CS2", c)?.ma).toBe("NEW_VISION");
    expect(phapNhanChoDon("CS1", c)?.ma).toBe("SATA_ROBO");
    expect(phapNhanChoDon(null, c)?.ma).toBe("SATA_ROBO");
  });

  it("pháp nhân TẮT thì không được chọn, kể cả khi cơ sở trỏ đích danh vào nó", () => {
    const c = sao();
    c.macDinhTheoCoSo = [{ maCoSo: "CS2", maPhapNhan: "NEW_VISION" }];
    c.phapNhan = c.phapNhan.map((p) =>
      p.ma === "NEW_VISION" ? { ...p, bat: false } : p,
    );
    expect(phapNhanChoDon("CS2", c)?.ma).toBe("SATA_ROBO");
  });

  it("không còn pháp nhân nào bật ⇒ null, KHÔNG bịa ra một cái", () => {
    // Màn phải bắt chọn tay. Im lặng in một mã số thuế nào đó lên hoá đơn là sai pháp lý.
    const c = sao();
    c.phapNhan = c.phapNhan.map((p) => ({ ...p, bat: false }));
    expect(phapNhanChoDon("CS1", c)).toBeNull();
  });
});

describe("[PN-04] kiemCauHinhHoaDon — luật nghiệp vụ", () => {
  it("mã số thuế phải 10 hoặc 13 chữ số", () => {
    const c = sao();
    c.phapNhan[0].maSoThue = "04023017";
    expect(kiemCauHinhHoaDon(c).join(" ")).toContain("Mã số thuế");
    c.phapNhan[0].maSoThue = "0402301783-001";
    expect(kiemCauHinhHoaDon(c)).toEqual([]); // 13 số sau khi bỏ gạch
  });

  it("mã pháp nhân trùng nhau", () => {
    const c = sao();
    c.phapNhan[1].ma = c.phapNhan[0].ma;
    expect(kiemCauHinhHoaDon(c).join(" ")).toContain("bị trùng");
  });

  it("cơ sở trỏ tới pháp nhân không tồn tại", () => {
    const c = sao();
    c.macDinhTheoCoSo = [{ maCoSo: "CS9", maPhapNhan: "KHONG_CO" }];
    expect(kiemCauHinhHoaDon(c).join(" ")).toContain("không tồn tại");
  });

  it("thiếu dòng thuế TAT_CA", () => {
    const c = sao();
    c.thue = [];
    expect(kiemCauHinhHoaDon(c).join(" ")).toContain("TAT_CA");
  });

  it("khai thuế hai lần cho cùng một loại đơn", () => {
    const c = sao();
    c.thue.push({ loaiDon: "TAT_CA", thueSuat: 10, kieuGia: KIEU_GIA.DA_GOM_THUE });
    expect(kiemCauHinhHoaDon(c).join(" ")).toContain("hai lần");
  });

  it("tắt hết pháp nhân", () => {
    const c = sao();
    c.phapNhan = c.phapNhan.map((p) => ({ ...p, bat: false }));
    expect(kiemCauHinhHoaDon(c).join(" ")).toContain("đang bật");
  });

  it("KHÔNG chặn thuế suất lạ trong 0–100 — mức thuế là chính sách, không phải hằng", () => {
    const c = sao();
    c.thue[0].thueSuat = 2;
    expect(kiemCauHinhHoaDon(c)).toEqual([]);
    c.thue[0].thueSuat = 101;
    expect(kiemCauHinhHoaDon(c).join(" ")).toContain("0–100%");
  });
});

// ═══ ÁNH XẠ CƠ SỞ → PHÁP NHÂN, CHỐT 15/09/2026 ════════════════════════════════
//
// Chủ dự án: *"cs1 là satarobo còn cs2 là new vision đấy nhé"*.
//
// Ca [PN-03] ở trên tự khai `macDinhTheoCoSo` trong thân test nên nó KIỂM HÀM, không kiểm
// CẤU HÌNH MẶC ĐỊNH. Suốt thời gian ô đó còn rỗng, [PN-03] vẫn xanh — và phiếu
// RCP-CS2-26-0011 của một đơn CS2 in ra pháp nhân Sata Robo với mã số thuế 0402301783.
// Lưới dưới đây canh chính bộ mặc định.
describe("[PN-05] CẤU HÌNH MẶC ĐỊNH phải khai đủ CS1/CS2", () => {
  it("CS1 → Sata Robo (MST 0402301783)", () => {
    const p = phapNhanChoDon("CS1", CAU_HINH_HOA_DON_MAC_DINH);
    expect(p?.ma).toBe("SATA_ROBO");
    expect(p?.maSoThue).toBe("0402301783");
  });

  it("CS2 → Sata Robo (MST 0402301783) — ĐẢO 22/09/2026 theo quyết định BLĐ", () => {
    // Từ 15/09 đến 22/09 ô này là NEW_VISION (MST 0402341070). BLĐ đảo trong phiếu quyết
    // định hồ sơ Bộ Công Thương: giao dịch qua website đứng tên pháp nhân đăng ký hồ sơ.
    const p = phapNhanChoDon("CS2", CAU_HINH_HOA_DON_MAC_DINH);
    expect(p?.ma).toBe("SATA_ROBO");
    expect(p?.maSoThue).toBe("0402301783");
  });

  it("ô ánh xạ KHÔNG được để rỗng — rỗng là im lặng chọn pháp nhân mặc định", () => {
    const ma = CAU_HINH_HOA_DON_MAC_DINH.macDinhTheoCoSo.map((m) => m.maCoSo);
    expect(ma).toContain("CS1");
    expect(ma).toContain("CS2");
  });

  it("⚠️ khớp theo Center.CODE, không phải Center.id", () => {
    // `Order.centerId` giữ id dạng slug ("co-so-hoang-dieu"). Truyền id vào đây thì không
    // khớp dòng nào rồi ÂM THẦM rơi về mặc định — in sai mã số thuế mà không lỗi nào báo.
    //
    // ⚠️ Ca này KHÔNG dùng bộ mặc định được nữa: từ 22/09/2026 cả CS1 lẫn CS2 đều trỏ
    // SATA_ROBO, nên khoá đúng và khoá sai cho ra cùng một kết quả và lưới mất sức bắt.
    // Dựng một cấu hình riêng có hai pháp nhân KHÁC NHAU để phép so còn phân biệt được.
    const cauHinhHaiPhapNhan = {
      ...CAU_HINH_HOA_DON_MAC_DINH,
      macDinhTheoCoSo: [{ maCoSo: "CS2", maPhapNhan: "NEW_VISION" }],
    };
    expect(phapNhanChoDon("CS2", cauHinhHaiPhapNhan)?.ma).toBe("NEW_VISION");
    // Truyền Center.id (slug) → không khớp dòng nào → rơi về mặc định.
    expect(phapNhanChoDon("co-so-hoang-dieu", cauHinhHaiPhapNhan)?.ma).toBe("SATA_ROBO");
  });

  it("cơ sở KHÁC (HO, CS91…) rơi về mặc định — chưa ai khai thì không đoán", () => {
    expect(phapNhanChoDon("HO", CAU_HINH_HOA_DON_MAC_DINH)?.ma).toBe("SATA_ROBO");
    expect(phapNhanChoDon(null, CAU_HINH_HOA_DON_MAC_DINH)?.ma).toBe("SATA_ROBO");
  });
});
