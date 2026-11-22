// @vitest-environment node
// [HCT] Phụ huynh thấy HOÁ ĐƠN hay PHIẾU THU (chủ dự án 12/11/2026): mốc 01/11/2026 (giờ VN) + yêu cầu hoá đơn.
import { describe, expect, it } from "vitest";
import { MOC_HOA_DON_CHO_PH, huongChungTu, whereDonCoNhuCauCuaCon, whereHoaDonPhuHuynh } from "./hoa-don-phu-huynh-thuan";

const KHONG = { invoiceBuyerName: null, invoiceCompanyName: null, invoiceTaxCode: null, invoiceEmail: null };
const CO = { ...KHONG, invoiceEmail: "ketoan@congty.vn" };
const moi = new Date("2026-11-03T03:00:00Z");
const cu = new Date("2026-10-20T03:00:00Z");

describe("[HCT] chứng từ phụ huynh nhận", () => {
  it("[HCT-01] mốc là 00:00 ngày 01/11/2026 GIỜ VIỆT NAM (= 17:00Z ngày 31/10)", () => {
    expect(MOC_HOA_DON_CHO_PH.toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });

  it("[HCT-02] đơn CŨ luôn là PHIẾU THU, kể cả khi có yêu cầu hoá đơn", () => {
    expect(huongChungTu({ ...CO, createdAt: cu })).toBe("PHIEU_THU");
    expect(huongChungTu({ ...KHONG, createdAt: cu })).toBe("PHIEU_THU");
  });

  it("[HCT-03] đơn MỚI: có yêu cầu hoá đơn ⇒ HOÁ ĐƠN; không yêu cầu ⇒ PHIẾU THU", () => {
    expect(huongChungTu({ ...CO, createdAt: moi })).toBe("HOA_DON");
    expect(huongChungTu({ ...KHONG, createdAt: moi })).toBe("PHIEU_THU");
  });

  it("[HCT-04] biên mốc: đúng 00:00 VN ngày 01/11 đã là đơn MỚI; một giây trước thì là CŨ", () => {
    expect(huongChungTu({ ...CO, createdAt: new Date("2026-10-31T17:00:00Z") })).toBe("HOA_DON");
    expect(huongChungTu({ ...CO, createdAt: new Date("2026-10-31T16:59:59Z") })).toBe("PHIEU_THU");
  });

  it("[HCT-05] điều kiện DB của hoá đơn và của mục «Hoá đơn» đều có mốc (không lệch với hàm thuần)", () => {
    const a = JSON.stringify(whereHoaDonPhuHuynh(["s1"]));
    const b = JSON.stringify(whereDonCoNhuCauCuaCon(["s1"]));
    expect(a).toContain(MOC_HOA_DON_CHO_PH.toISOString());
    expect(b).toContain(MOC_HOA_DON_CHO_PH.toISOString());
  });
});
