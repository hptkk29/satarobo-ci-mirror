// @vitest-environment node
/**
 * [RFV-*] — chữ và hình dạng của màn Referral (`lib/affiliate/ghi-referral-dau-vao.ts`), THUẦN: không DB.
 *
 *   [RFV-01] bảng trạng thái: đủ MỌI giá trị enum, thứ tự chip, nhãn, tông đúng ngữ nghĩa
 *   [RFV-02] `dichLyDoReferral`: ba mã từ chối dịch ra tiếng Việt; mã link lạ vẫn có câu; căn cứ tự giới thiệu
 *   [RFV-03] `dichLyDoReferral`: câu xem tay CÓ dấu `:` ("luật thắng: X") KHÔNG bị tách theo `:`; null/rỗng ⇒ "—"
 *   [RFV-04] `docSnapshotReferral`: chỉ giữ khoá đã biết, mặc định an toàn với hình dạng lạ, KHÔNG chuyển PII lọt vào
 *   [RFV-05] `thoiDiemHienThi` giờ Việt Nam; `maRutGonPhieu`; nhãn cách đến đủ sáu giá trị
 */
import { describe, expect, it } from "vitest";
import {
  CACH_DEN_REFERRAL,
  MO_TA_TRANG_THAI_REFERRAL,
  NHAN_CACH_DEN_REFERRAL,
  NHAN_TRANG_THAI_REFERRAL,
  TONE_TRANG_THAI_REFERRAL,
  TRANG_THAI_REFERRAL,
  demRong,
  dichLyDoReferral,
  docSnapshotReferral,
  laTrangThaiReferral,
  maRutGonPhieu,
  thoiDiemHienThi,
  tongCacTrangThai,
} from "./ghi-referral-dau-vao";
import { NHAN_LIEN_KET_KHONG_HOP_LE } from "./lien-ket-hop-le";
import { NHAN_TU_CHOI_REFERRAL } from "./quyet-dinh-referral";

describe("[RFV-01] bảng trạng thái", () => {
  it("đúng năm trạng thái, thứ tự chip: Hợp lệ · Cần xem tay · Từ chối · Trùng · Tranh chấp; nhãn và mô tả đủ cho từng cái", () => {
    expect([...TRANG_THAI_REFERRAL]).toEqual(["VALID", "MANUAL_REVIEW", "REJECTED", "REJECTED_DUPLICATE", "DISPUTED"]);
    expect(TRANG_THAI_REFERRAL.map((t) => NHAN_TRANG_THAI_REFERRAL[t])).toEqual(["Hợp lệ", "Cần xem tay", "Từ chối", "Trùng — đã có người ghi nhận trước", "Tranh chấp"]);
    for (const t of TRANG_THAI_REFERRAL) {
      expect(MO_TA_TRANG_THAI_REFERRAL[t].length).toBeGreaterThan(10);
      expect(TONE_TRANG_THAI_REFERRAL[t]).toBeTruthy();
    }
  });

  it("tông đúng ngữ nghĩa: Hợp lệ success · Cần xem tay warning · Từ chối danger · Trùng muted · Tranh chấp warning", () => {
    expect(TONE_TRANG_THAI_REFERRAL).toEqual({ VALID: "success", MANUAL_REVIEW: "warning", REJECTED: "danger", REJECTED_DUPLICATE: "muted", DISPUTED: "warning" });
  });

  it("`laTrangThaiReferral` chỉ nhận đúng năm giá trị (rác URL không lọt vào truy vấn)", () => {
    expect(TRANG_THAI_REFERRAL.every((t) => laTrangThaiReferral(t))).toBe(true);
    for (const rac of ["valid", "ALL", "", null, undefined, 3, "VALID; DROP", "REJECTED "]) expect(laTrangThaiReferral(rac)).toBe(false);
  });

  it("`demRong` đủ mọi khoá bằng 0; `tongCacTrangThai` cộng đúng (đối chứng dương)", () => {
    const d = demRong();
    expect(Object.keys(d).sort()).toEqual([...TRANG_THAI_REFERRAL].sort());
    expect(tongCacTrangThai(d)).toBe(0);
    expect(tongCacTrangThai({ ...d, VALID: 3, MANUAL_REVIEW: 2, DISPUTED: 1 })).toBe(6);
  });
});

describe("[RFV-02] dichLyDoReferral — mã máy ra tiếng Việt", () => {
  it("LINK_KHONG_HOP_LE:<mã> ⇒ nêu đúng lý do link; câu đầy đủ chứa câu gốc của mã từ chối", () => {
    const r = dichLyDoReferral("LINK_KHONG_HOP_LE:LINK_DA_THU_HOI");
    expect(r.dang).toBe("MA");
    expect(r.ngan).toBe(`Link không còn hợp lệ: ${NHAN_LIEN_KET_KHONG_HOP_LE.LINK_DA_THU_HOI}`);
    expect(r.day).toContain(NHAN_TU_CHOI_REFERRAL.LINK_KHONG_HOP_LE);
    expect(r.day).toContain(NHAN_LIEN_KET_KHONG_HOP_LE.LINK_DA_THU_HOI);
    expect(r.ngan).not.toContain("LINK_DA_THU_HOI");
  });

  it("mã link không có trong bảng nhãn ⇒ vẫn là câu tiếng Việt (không lộ mã máy)", () => {
    const r = dichLyDoReferral("LINK_KHONG_HOP_LE:MA_CHUA_TUNG_CO");
    expect(r.ngan).toBe("Link không còn hợp lệ");
    expect(r.day).toBe(NHAN_TU_CHOI_REFERRAL.LINK_KHONG_HOP_LE);
    expect(r.day).not.toContain("MA_CHUA_TUNG_CO");
  });

  it("mã link của website không gắn campaign (chỉ có ở bảng của tab Link) cũng dịch được", () => {
    expect(dichLyDoReferral("LINK_KHONG_HOP_LE:SITE_KHONG_GAN_CAMPAIGN").day).toContain("Website này không còn được gắn vào campaign");
  });

  it("NGOAI_CUA_SO_COOKIE:Cửa sổ 30 ngày ⇒ giữ chi tiết đã là tiếng Việt", () => {
    const r = dichLyDoReferral("NGOAI_CUA_SO_COOKIE:Cửa sổ 30 ngày");
    expect(r.ngan).toBe("Quá cửa sổ ghi nhận (Cửa sổ 30 ngày)");
    expect(r.day).toContain(NHAN_TU_CHOI_REFERRAL.NGOAI_CUA_SO_COOKIE);
    expect(r.day).toContain("Cửa sổ 30 ngày");
  });

  it("TU_GIOI_THIEU:SDT, EMAIL ⇒ dịch từng căn cứ; căn cứ lạ bị bỏ, không in thô", () => {
    const r = dichLyDoReferral("TU_GIOI_THIEU:SDT, EMAIL");
    expect(r.ngan).toBe("Tự giới thiệu (trùng số điện thoại, trùng email)");
    expect(r.day).toContain("Căn cứ: trùng số điện thoại, trùng email");
    const la = dichLyDoReferral("TU_GIOI_THIEU:SDT, HAN_HOI_LA");
    expect(la.ngan).toBe("Tự giới thiệu (trùng số điện thoại)");
    expect(la.day).not.toContain("HAN_HOI_LA");
    // không còn căn cứ nào đọc được ⇒ chỉ nêu loại từ chối
    expect(dichLyDoReferral("TU_GIOI_THIEU:").ngan).toBe("Tự giới thiệu");
  });
});

describe("[RFV-03] dichLyDoReferral — câu viết sẵn và biên", () => {
  it("câu xem tay có dấu `:` ('luật thắng: X') đi NGUYÊN VĂN — không bị tách mù theo ':'", () => {
    const cau = "Luật quy nguồn của lead không chọn người giới thiệu này (luật thắng: SDT_TRUNG_LEAD_CU).";
    expect(dichLyDoReferral(cau)).toEqual({ ngan: cau, day: cau, dang: "CAU" });
  });

  it("câu có dấu `:` mà phần trước KHÔNG phải mã từ chối ⇒ nguyên văn (đối chứng: cùng cấu trúc `X:y`, X lạ)", () => {
    expect(dichLyDoReferral("MA_LA:chi tiết").dang).toBe("CAU");
    expect(dichLyDoReferral("MA_LA:chi tiết").ngan).toBe("MA_LA:chi tiết");
  });

  it("câu xem tay / trùng cố định của hệ thống đi nguyên văn", () => {
    for (const c of [
      "Biểu mẫu gửi từ tên miền ngoài danh sách website của link giới thiệu.",
      "Không đọc được kết quả quy nguồn của lead.",
      "Khách đã có nguồn gốc từ hồ sơ trước — giữ người ghi nhận đầu tiên.",
      "Khách đã có hồ sơ trong cửa sổ chống trùng — giữ người ghi nhận đầu tiên.",
    ]) {
      expect(dichLyDoReferral(c)).toEqual({ ngan: c, day: c, dang: "CAU" });
    }
  });

  it("null / undefined / rỗng / toàn khoảng trắng ⇒ «—», dạng TRỐNG (không bịa lý do)", () => {
    for (const v of [null, undefined, "", "   "]) expect(dichLyDoReferral(v)).toEqual({ ngan: "—", day: "—", dang: "TRONG" });
  });
});

describe("[RFV-04] docSnapshotReferral — chỉ khoá đã biết", () => {
  const day = {
    affiliateCode: "FXDT01",
    campaignCode: "TET_2027",
    method: "LINK",
    typeCode: "PHU_HUYNH",
    tagCodes: ["VIP", "KOL"],
    tu: "RULE_LOAI",
    tuNhan: "Quy tắc campaign theo loại đối tác",
    canCuTuGioiThieu: ["SDT"],
    origin: "KHOP",
  };

  it("snapshot đầy đủ ⇒ đọc đúng từng trường", () => {
    expect(docSnapshotReferral(day)).toEqual({
      maDoiTac: "FXDT01",
      maCampaign: "TET_2027",
      maLoai: "PHU_HUYNH",
      maNhan: ["VIP", "KOL"],
      tu: "RULE_LOAI",
      tuNhan: "Quy tắc campaign theo loại đối tác",
      canCuTuGioiThieu: ["SDT"],
      origin: "KHOP",
    });
  });

  it("KHÔNG chuyển khoá lạ: SĐT/tên/email khách lỡ nằm trong Json không xuất hiện ở kết quả", () => {
    const kq = JSON.stringify(docSnapshotReferral({ ...day, phone: "0905123456", parentName: "Nguyễn Văn Khách", email: "khach@example.com", leadId: "ckabc123", evidence: { ghiChu: "bí mật" } }));
    for (const rò of ["0905123456", "Nguyễn Văn Khách", "khach@example.com", "ckabc123", "bí mật"]) expect(kq).not.toContain(rò);
  });

  it("hình dạng lạ ⇒ mặc định an toàn, không ném: null · mảng · chuỗi · số · thiếu khoá", () => {
    const rong = { maDoiTac: null, maCampaign: null, maLoai: null, maNhan: [], tu: null, tuNhan: null, canCuTuGioiThieu: [], origin: null };
    for (const v of [null, undefined, [], "x", 5, {}]) expect(docSnapshotReferral(v)).toEqual(rong);
  });

  it("giá trị sai kiểu bị bỏ: bậc nguồn lạ ⇒ null (không có nguồn đã giải); origin lạ ⇒ null; căn cứ lạ bị lọc; mảng nhãn lẫn rác", () => {
    const r = docSnapshotReferral({ ...day, tu: "BAC_LA", origin: "KHONG_BIET", canCuTuGioiThieu: ["SDT", "LA", 3], tagCodes: ["A", 5, "", null, "B"] });
    expect(r.tu).toBeNull();
    expect(r.tuNhan).toBeNull(); // không có bậc ⇒ không có câu «quyết định theo» dù Json có
    expect(r.origin).toBeNull();
    expect(r.canCuTuGioiThieu).toEqual(["SDT"]);
    expect(r.maNhan).toEqual(["A", "B"]);
  });

  it("thiếu câu chụp `tuNhan` nhưng có bậc ⇒ dịch từ bậc", () => {
    expect(docSnapshotReferral({ tu: "MAC_DINH_LOAI" }).tuNhan).toBe("Nguồn mặc định của loại đối tác");
  });
});

describe("[RFV-05] thời điểm · mã rút gọn · cách đến", () => {
  it("`thoiDiemHienThi` theo GIỜ VIỆT NAM (23:30Z ngày 12 là 06:30 ngày 13); null/sai dạng ⇒ «—»", () => {
    expect(thoiDiemHienThi("2026-10-12T23:30:00.000Z")).toBe("13/10/2026 06:30");
    expect(thoiDiemHienThi("2026-10-13T03:05:00.000Z")).toBe("13/10/2026 10:05");
    for (const v of [null, undefined, "", "không phải ngày"]) expect(thoiDiemHienThi(v)).toBe("—");
  });

  it("`maRutGonPhieu` = 6 ký tự cuối, chữ hoa — không đủ dựng lại id", () => {
    expect(maRutGonPhieu("ckxyz1234abcdef")).toBe("ABCDEF");
    expect(maRutGonPhieu("ckxyz1234abcdef")).toHaveLength(6);
  });

  it("nhãn cách đến đủ SÁU giá trị của enum, không trống", () => {
    expect([...CACH_DEN_REFERRAL]).toEqual(["LINK", "QR", "CODE", "MANUAL", "OFFLINE", "API"]);
    for (const c of CACH_DEN_REFERRAL) expect(NHAN_CACH_DEN_REFERRAL[c].length).toBeGreaterThan(0);
    expect(NHAN_CACH_DEN_REFERRAL.LINK).toBe("Link");
    expect(NHAN_CACH_DEN_REFERRAL.CODE).toBe("Mã");
  });
});
