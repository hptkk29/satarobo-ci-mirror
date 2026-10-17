// @vitest-environment node
/**
 * [KTR-*] — KHAI TAY referral: đầu vào, cổng hợp lệ, khoá chống trùng (AFF-L3b). THUẦN.
 *
 *   [KTR-01] schema `.strict()`: KHÔNG nhận tiền / tỉ lệ / nguồn / trạng thái — từ chối khoá lạ chứ không bỏ qua im lặng
 *   [KTR-02] lý do · ghi chú: trim, ≥10 ký tự, không SĐT/email
 *   [KTR-03] cổng `kiemKhaiTay`: từng nhánh từ chối đúng mã và đúng THỨ TỰ; hợp lệ khi mọi thứ đều ổn
 *   [KTR-04] chuỗi hợp lệ dùng LẠI `kiemLienKet`: thành viên chưa tới ngày / hết hạn / campaign hết hạn đều chặn
 *   [KTR-05] khoá chống gửi lặp: cố định theo bộ ba + lần; trong 8–128 ký tự (CHECK DB); lần khác ⇒ khoá khác
 */
import { describe, expect, it } from "vitest";
import { khaiTayReferralSchema, khoaGiaoDichKhaiTay, khoaKhaiTay, kiemKhaiTay, type DauVaoKiemKhaiTay } from "./khai-tay-referral";

const NOW = new Date("2026-10-13T03:00:00.000Z");
const HOP_LE = {
  partyId: "party000000000000000001",
  campaignId: "camp0000000000000000001",
  leadId: "lead0000000000000000001",
  method: "OFFLINE",
  lyDo: "Khách nói chị A giới thiệu tại sự kiện",
  ghiChu: "Biên nhận sự kiện BN-0042 do cán bộ Lan ký",
};

describe("[KTR-01] schema strict — không có ô tiền / tỉ lệ / nguồn", () => {
  it("đầu vào hợp lệ qua, và được trim", () => {
    const r = khaiTayReferralSchema.safeParse({ ...HOP_LE, lyDo: `  ${HOP_LE.lyDo}  ` });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.lyDo).toBe(HOP_LE.lyDo);
  });
  for (const khoa of ["soTien", "amount", "hoaHong", "commission", "tiLe", "rate", "commissionPercent", "sourceGroupId", "nguonId", "status", "trangThai", "protectedUntil", "idempotencyKey", "centerId", "createdById"]) {
    it(`khoá lạ «${khoa}» bị TỪ CHỐI (không bị bỏ qua im lặng)`, () => {
      const r = khaiTayReferralSchema.safeParse({ ...HOP_LE, [khoa]: khoa === "tiLe" || khoa === "rate" ? 0.5 : "x" });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.code).toBe("unrecognized_keys");
    });
  }
  it("cách đến chỉ MANUAL | OFFLINE (không LINK/QR/CODE/API — những đường đó có token)", () => {
    for (const m of ["LINK", "QR", "CODE", "API", "", "manual"]) expect(khaiTayReferralSchema.safeParse({ ...HOP_LE, method: m }).success, m).toBe(false);
    for (const m of ["MANUAL", "OFFLINE"]) expect(khaiTayReferralSchema.safeParse({ ...HOP_LE, method: m }).success, m).toBe(true);
  });
  it("thiếu đối tác / campaign / phiếu ⇒ lỗi theo đúng ô", () => {
    for (const k of ["partyId", "campaignId", "leadId"] as const) {
      const r = khaiTayReferralSchema.safeParse({ ...HOP_LE, [k]: "  " });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.path[0]).toBe(k);
    }
  });
});

describe("[KTR-02] lý do · ghi chú", () => {
  it("lý do và ghi chú < 10 ký tự sau trim bị từ chối", () => {
    expect(khaiTayReferralSchema.safeParse({ ...HOP_LE, lyDo: "   ngắn   " }).success).toBe(false);
    expect(khaiTayReferralSchema.safeParse({ ...HOP_LE, ghiChu: "ngắn" }).success).toBe(false);
  });
  it("lý do / ghi chú chứa SĐT hoặc email khách bị từ chối", () => {
    const sdt = khaiTayReferralSchema.safeParse({ ...HOP_LE, ghiChu: "Khách có số 0907 111 222 xác nhận" });
    expect(sdt.success).toBe(false);
    const mail = khaiTayReferralSchema.safeParse({ ...HOP_LE, lyDo: "Email khach@example.com cho biết đối tác" });
    expect(mail.success).toBe(false);
  });
});

const OK: DauVaoKiemKhaiTay = {
  doiTac: { status: "ACTIVE" },
  campaign: { status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: null },
  thanhVien: { status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: null },
  phieuThayDuoc: true,
  tuGioiThieu: { chan: false },
  daCoLuotDangSong: false,
};
const ma = (v: DauVaoKiemKhaiTay) => {
  const r = kiemKhaiTay(v, NOW);
  return r.ok ? "OK" : r.ma;
};

describe("[KTR-03] cổng kiemKhaiTay", () => {
  it("mọi thứ ổn ⇒ qua", () => expect(kiemKhaiTay(OK, NOW)).toEqual({ ok: true }));
  it("từng nhánh từ chối đúng mã", () => {
    expect(ma({ ...OK, doiTac: null })).toBe("DOI_TAC_KHONG_TIM_THAY");
    expect(ma({ ...OK, campaign: null })).toBe("CAMPAIGN_KHONG_TIM_THAY");
    expect(ma({ ...OK, phieuThayDuoc: false })).toBe("PHIEU_KHONG_TIM_THAY");
    expect(ma({ ...OK, thanhVien: null })).toBe("CHUA_LA_THANH_VIEN");
    expect(ma({ ...OK, doiTac: { status: "SUSPENDED" } })).toBe("DOI_TAC_KHONG_HOAT_DONG");
    expect(ma({ ...OK, tuGioiThieu: { chan: true } })).toBe("TU_GIOI_THIEU");
    expect(ma({ ...OK, daCoLuotDangSong: true })).toBe("DA_CO_LUOT_DANG_SONG");
  });
  it("THỨ TỰ: không tìm thấy < phiếu < thành viên < chuỗi hợp lệ < tự giới thiệu < trùng", () => {
    const hong = { ...OK, doiTac: null, campaign: null, phieuThayDuoc: false, thanhVien: null, tuGioiThieu: { chan: true }, daCoLuotDangSong: true };
    expect(ma(hong)).toBe("DOI_TAC_KHONG_TIM_THAY");
    expect(ma({ ...hong, doiTac: { status: "ACTIVE" } })).toBe("CAMPAIGN_KHONG_TIM_THAY");
    expect(ma({ ...hong, doiTac: { status: "ACTIVE" }, campaign: OK.campaign })).toBe("PHIEU_KHONG_TIM_THAY");
    expect(ma({ ...hong, doiTac: { status: "ACTIVE" }, campaign: OK.campaign, phieuThayDuoc: true })).toBe("CHUA_LA_THANH_VIEN");
    const chuoiHong = { ...OK, doiTac: { status: "ENDED" as const }, tuGioiThieu: { chan: true }, daCoLuotDangSong: true };
    expect(ma(chuoiHong)).toBe("DOI_TAC_KHONG_HOAT_DONG");
    expect(ma({ ...OK, tuGioiThieu: { chan: true }, daCoLuotDangSong: true })).toBe("TU_GIOI_THIEU");
  });
  it("câu lỗi tiếng Việt, không để mã trần", () => {
    const r = kiemKhaiTay({ ...OK, daCoLuotDangSong: true }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).toContain("đang chờ xử lý");
  });
});

describe("[KTR-04] chuỗi hợp lệ dùng lại kiemLienKet", () => {
  it("thành viên chưa tới ngày hiệu lực / đã hết hạn / không ACTIVE", () => {
    expect(ma({ ...OK, thanhVien: { status: "ACTIVE", effectiveFrom: new Date("2026-10-14T00:00:00.000Z"), effectiveTo: null } })).toBe("THANH_VIEN_CHUA_HIEU_LUC");
    expect(ma({ ...OK, thanhVien: { status: "ACTIVE", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: new Date("2026-10-13T03:00:00.000Z") } })).toBe("THANH_VIEN_HET_HAN"); // biên trên MỞ
    expect(ma({ ...OK, thanhVien: { status: "PENDING", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null } })).toBe("THANH_VIEN_KHONG_HOAT_DONG");
  });
  it("campaign không chạy / chưa tới ngày / hết hạn", () => {
    expect(ma({ ...OK, campaign: { status: "PAUSED", effectiveFrom: null, effectiveTo: null } })).toBe("CAMPAIGN_KHONG_HOAT_DONG");
    expect(ma({ ...OK, campaign: { status: "ACTIVE", effectiveFrom: new Date("2026-11-01T00:00:00.000Z"), effectiveTo: null } })).toBe("CAMPAIGN_CHUA_HIEU_LUC");
    expect(ma({ ...OK, campaign: { status: "ACTIVE", effectiveFrom: null, effectiveTo: new Date("2026-10-01T00:00:00.000Z") } })).toBe("CAMPAIGN_HET_HAN");
  });
  it("đối chứng dương: biên dưới ĐÓNG (đúng giờ hiệu lực vẫn qua)", () => {
    expect(ma({ ...OK, thanhVien: { status: "ACTIVE", effectiveFrom: NOW, effectiveTo: null } })).toBe("OK");
  });
});

describe("[KTR-05] khoá chống gửi lặp", () => {
  const b = { leadId: "clead00000000000000000001", partyId: "cparty0000000000000000001", campaignId: "ccamp00000000000000000001" };
  it("tất định và nằm trong 8–128 ký tự", () => {
    expect(khoaKhaiTay({ ...b, lan: 1 })).toBe(khoaKhaiTay({ ...b, lan: 1 }));
    const k = khoaKhaiTay({ ...b, lan: 12 });
    expect(k.length).toBeGreaterThanOrEqual(8);
    expect(k.length).toBeLessThanOrEqual(128);
  });
  it("lần khác ⇒ khoá khác (khai lại được sau khi lượt cũ bị từ chối); bộ ba khác ⇒ khoá khác", () => {
    expect(khoaKhaiTay({ ...b, lan: 1 })).not.toBe(khoaKhaiTay({ ...b, lan: 2 }));
    expect(khoaKhaiTay({ ...b, lan: 1 })).not.toBe(khoaKhaiTay({ ...b, partyId: "cparty0000000000000000002", lan: 1 }));
    expect(khoaKhaiTay({ ...b, lan: 1 })).not.toBe(khoaKhaiTay({ ...b, leadId: "clead00000000000000000002", lan: 1 }));
    expect(khoaKhaiTay({ ...b, lan: 1 })).not.toBe(khoaKhaiTay({ ...b, campaignId: "ccamp00000000000000000002", lan: 1 }));
  });
  it("khoá giao dịch (advisory) theo đúng bộ ba — không phụ thuộc cách đến", () => {
    expect(khoaGiaoDichKhaiTay(b)).toBe(khoaGiaoDichKhaiTay({ ...b }));
    expect(khoaGiaoDichKhaiTay(b)).toContain(b.leadId);
    expect(khoaGiaoDichKhaiTay(b)).toContain(b.partyId);
    expect(khoaGiaoDichKhaiTay(b)).toContain(b.campaignId);
  });
});
