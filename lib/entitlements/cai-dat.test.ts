import { describe, expect, it } from "vitest";
import { SETTINGS } from "@/lib/settings/registry";
import { CAU_HINH_PHAM_VI_MAC_DINH } from "./pham-vi-hoc";
import { cauHinhPhamViTuCaiDat, quyTacBuoiLeTuCaiDat, thuTuConTuCaiDat } from "./cai-dat";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";

describe("[CDT] cài đặt thu học phí theo phạm vi học", () => {
  it("[CDT-01] công tắc chính MẶC ĐỊNH TẮT và cho phép bật riêng từng cơ sở", () => {
    const d = SETTINGS["billing.scopePurchaseEnabled"];
    expect(d.default).toBe(false);
    expect(d.centerOverridable).toBe(true);
  });

  it("[CDT-02] mặc định trong registry KHỚP mặc định của hàm thuần (không trôi lệch hai nơi)", () => {
    const c = CAU_HINH_PHAM_VI_MAC_DINH;
    expect(SETTINGS["enrollment.lateEntryMaxLessons"].default).toBe(c.lateEntryMaxLessons);
    expect(SETTINGS["enrollment.catchUpMaxSessions"].default).toBe(c.catchUpMaxSessions);
    expect(SETTINGS["enrollment.catchUpOverCapPolicy"].default).toBe(c.catchUpOverCapPolicy);
    expect(SETTINGS["enrollment.graceCountsTowardNextPurchase"].default).toBe(c.graceCountsTowardNext);
  });

  it("[CDT-03] số liệu mặc định đúng văn bản: ngưỡng 4, trần 6, ân hạn 2, giữ chỗ 14, 3 bài/buổi", () => {
    expect(SETTINGS["enrollment.lateEntryMaxLessons"].default).toBe(4);
    expect(SETTINGS["enrollment.catchUpMaxSessions"].default).toBe(6);
    expect(SETTINGS["enrollment.renewalGraceSessions"].default).toBe(2);
    expect(SETTINGS["enrollment.seatHoldDays"].default).toBe(14);
    expect(SETTINGS["enrollment.catchUpMaxLessonsPerSession"].default).toBe(3);
  });

  it("[CDT-04] các điểm CHƯA CHỐT mặc định theo hướng an toàn: ngày tạo đơn, buổi lẻ nhập tay, quyền học khi tiền về", () => {
    expect(SETTINGS["pricing.policyDateBasis"].default).toBe("ORDER_CREATED");
    expect(SETTINGS["pricing.oddSessionsRule"].default).toBe("MANUAL");
    expect(SETTINGS["enrollment.entitlementTrigger"].default).toBe("PAYMENT_PAID");
  });

  it("[CDT-05] ánh xạ quy tắc buổi lẻ: mỗi giá trị cài đặt ra đúng một quy tắc, giá trị lạ ⇒ TU_CHOI", () => {
    expect(quyTacBuoiLeTuCaiDat("MANUAL")).toBe("NHAP_TAY");
    expect(quyTacBuoiLeTuCaiDat("NO_DISCOUNT")).toBe("KHONG_GIAM");
    expect(quyTacBuoiLeTuCaiDat("LOWER_TIER")).toBe("MOC_THAP_HON");
    expect(quyTacBuoiLeTuCaiDat("")).toBe("TU_CHOI");
    expect(quyTacBuoiLeTuCaiDat("toString")).toBe("TU_CHOI"); // khoá của Object.prototype không được lọt qua
  });

  it("[CDT-06] mọi giá trị hợp lệ của registry đều ánh xạ được (không có giá trị bị rơi vào TU_CHOI)", () => {
    const opts = (SETTINGS["pricing.oddSessionsRule"].schema as unknown as { options: readonly string[] }).options;
    expect(opts.length).toBe(3);
    for (const v of opts) expect(quyTacBuoiLeTuCaiDat(v)).not.toBe("TU_CHOI");
  });

  it("[CDT-07] cấu hình phạm vi: lấy tham số từ cài đặt, giữ 12 bài/học phần và 48 bài cho giáo trình", () => {
    const c = cauHinhPhamViTuCaiDat({
      lateEntryMaxLessons: 2,
      catchUpMaxSessions: 5,
      catchUpOverCapPolicy: "DROP_ALL",
      graceCountsTowardNextPurchase: false,
    });
    expect(c).toMatchObject({
      lateEntryMaxLessons: 2,
      catchUpMaxSessions: 5,
      catchUpOverCapPolicy: "DROP_ALL",
      graceCountsTowardNext: false,
      soBaiMotHocPhan: 12,
      tongBai: 48,
    });
    expect(c.tongBai).toBe(CHINH_SACH_PL02.soBuoiCaGoi); // hai nơi cùng nói "gói trọn = 48"
  });

  it("[CDT-08] chính sách vượt trần lạ ⇒ DROP_ALL (mất bài thấy ngay, không dạy lố trần âm thầm)", () => {
    const c = cauHinhPhamViTuCaiDat({
      lateEntryMaxLessons: 4,
      catchUpMaxSessions: 6,
      catchUpOverCapPolicy: "???",
      graceCountsTowardNextPurchase: true,
    });
    expect(c.catchUpOverCapPolicy).toBe("DROP_ALL");
  });

  it("[CDT-09] thứ tự con mặc định: mặc định registry KHỚP hàm ánh xạ; giá trị lạ ⇒ thấp trước", () => {
    expect(thuTuConTuCaiDat(SETTINGS["pricing.sameTimeChildOrder"].default)).toBe("LOWER_VALUE_FIRST");
    expect(thuTuConTuCaiDat("HIGHER_VALUE_FIRST")).toBe("HIGHER_VALUE_FIRST");
    for (const v of ["???", "", null, undefined, 1]) expect(thuTuConTuCaiDat(v)).toBe("LOWER_VALUE_FIRST");
  });
});
