// @vitest-environment node
/**
 * [NHH-SO-VS-*] — NGĂN "VÌ SAO CON SỐ NÀY" đầy đủ (06 §2.3): một danh sách định nghĩa theo THỨ TỰ NHÂN QUẢ, kèm điều chỉnh liên quan và dòng thời gian. THUẦN.
 *
 * Dữ liệu duy nhất là ẢNH CHỤP nằm trên dòng sổ (+ vài tra cứu theo id để ra TÊN): chính sách đổi/hết hạn sau đó vẫn giải thích đúng con số đã ghi.
 */
import { describe, it, expect } from "vitest";

import { MA_KHOI_PHUC_HOAN_LEGACY } from "./kieu";
import { cachPhanGiaiNguoiHuong, dungViSaoDayDu, type DuLieuViSaoDayDu } from "./vi-sao-day-du";
import type { DongChoViSao } from "./vi-sao";

const dongGoc = (p: Partial<DongChoViSao> = {}): DongChoViSao => ({
  entryKind: "ORIGINAL",
  amount: 80_000,
  grossAmount: 4_000_000,
  vatRate: 0,
  netBase: 4_000_000,
  rate: 0.02,
  fixedAmount: null,
  capRate: 0.09,
  equivalentRate: 0.07,
  sourceGroupCode: "EMPLOYEE_REFERRAL",
  transactionTypeCode: "RENEWAL",
  roleCode: "SALE",
  splitMethod: "DONG",
  documentNumber: "SR.QD.231",
  versionNo: 2,
  calcKind: "PERCENT",
  reason: "SOURCE_GROUP=EMPLOYEE_REFERRAL thắng GLOBAL v3 vì phạm vi cụ thể hơn",
  reasonCode: null,
  naturalPeriod: "2026-10",
  kyGhi: "2026-10",
  lateArrival: false,
  refEntryId: null,
  refEventType: null,
  refEventId: null,
  resolverBasis: { canCu: "LEAD_CONVERTED_BY" },
  paymentId: "pay-1",
  ...p,
});

const du = (p: Partial<DuLieuViSaoDayDu> = {}): DuLieuViSaoDayDu => ({
  dong: dongGoc(),
  hienTongTiLe: true,
  nguoiHuong: { ten: "Lê Thị Phương Liên", kind: "USER" },
  tenVai: "Sale",
  tenNhomNguon: "Sale / TVV giới thiệu",
  tenNhomTheoMa: { UNKNOWN: "Không rõ nguồn (hệ thống)", PARENT_REFERRAL: "Phụ huynh giới thiệu", EMPLOYEE_REFERRAL: "Sale / TVV giới thiệu" },
  resolverType: "TRANSACTION_ROLE",
  hocVien: { ten: "Nguyễn Bảo Minh" },
  khoanThu: { ngayThu: "2026-10-12T03:00:00.000Z", xacNhanLuc: "2026-10-12T04:00:00.000Z", soTien: 4_000_000 },
  chiTra: { trangThai: "PENDING", luc: null },
  taoLuc: "2026-10-12T05:00:00.000Z",
  lienQuan: [],
  nhatKy: null,
  ...p,
});

const nhan = (v: ReturnType<typeof dungViSaoDayDu>, n: string) => v.muc.find((m) => m.nhan === n);

describe("[NHH-SO-VS-21] ngăn 'Vì sao' không in MÃ kỹ thuật (nhóm nguồn, loại giao dịch) và tiền luôn đúng một dạng", () => {
  it("[NHH-SO-VS-21] câu giải thích chính sách do engine ghi: mã nhóm → TÊN nhóm, 'UNKNOWN' → tên, '440.000 đ' → '440.000đ'; câu không có mã giữ NGUYÊN", () => {
    const reason = "UNKNOWN → mức thấp nhất = nhóm PARENT_REFERRAL (440.000 đ) trong 11 nhóm";
    const v = dungViSaoDayDu(du({ dong: dongGoc({ reason }) }));
    const g = nhan(v, "Chính sách")!.ghiChu!;
    expect(g).toBe("Không rõ nguồn (hệ thống) → mức thấp nhất = nhóm Phụ huynh giới thiệu (440.000đ) trong 11 nhóm");
    expect(g).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}|UNKNOWN/);
    // mã LẠ (không có trong bảng tên) KHÔNG bị bịa tên: giữ nguyên chữ engine ghi
    expect(nhan(dungViSaoDayDu(du({ dong: dongGoc({ reason: "nhóm MA_LA_CHUA_BIET thắng" }) })), "Chính sách")!.ghiChu).toBe("nhóm MA_LA_CHUA_BIET thắng");
    // câu thường (không mã) đi qua không đổi
    expect(nhan(dungViSaoDayDu(du({ dong: dongGoc({ reason: "SOURCE_GROUP=EMPLOYEE_REFERRAL thắng GLOBAL v3 vì phạm vi cụ thể hơn" }) })), "Chính sách")!.ghiChu).toBe("SOURCE_GROUP=Sale / TVV giới thiệu thắng GLOBAL v3 vì phạm vi cụ thể hơn");
  });

  it("[NHH-SO-VS-22] 'Loại giao dịch' nói 'Khách mới' / 'Tái tục', không kèm mã (NEW)/(RENEWAL)", () => {
    expect(nhan(dungViSaoDayDu(du({ dong: dongGoc({ transactionTypeCode: "NEW" }) })), "Loại giao dịch")!.giaTri).toBe("Khách mới · Nguyễn Bảo Minh");
    expect(nhan(dungViSaoDayDu(du({ dong: dongGoc({ transactionTypeCode: "RENEWAL" }) })), "Loại giao dịch")!.giaTri).toBe("Tái tục · Nguyễn Bảo Minh");
  });
});

describe("[NHH-SO-VS-20] tiêu đề ngăn — nói TÊN vai, không in MÃ vai", () => {
  it("[NHH-SO-VS-20] 'Hoa hồng phát sinh từ khoản thu · Sale (người chốt đơn)' chứ không '· SALE'; mã vai nhiều từ cũng không lộ SNAKE_CASE (chụp thật 09/10: tiêu đề in 'SALE' ngay dưới dòng mô tả đã có 'vai Sale (người chốt đơn)')", () => {
    const v = dungViSaoDayDu(du({ tenVai: "Sale (người chốt đơn)", dong: dongGoc({ entryKind: "ORIGINAL", roleCode: "SALE" }) }));
    expect(v.tieuDe).toBe("Hoa hồng phát sinh từ khoản thu · Sale (người chốt đơn)");
    const w = dungViSaoDayDu(du({ tenVai: "Phụ huynh giới thiệu", dong: dongGoc({ entryKind: "REVERSAL", roleCode: "REFERRER_PARENT" }) }));
    expect(w.tieuDe).toBe("Thu hồi do hoàn tiền / điều chỉnh giảm · Phụ huynh giới thiệu");
    for (const t of [v.tieuDe, w.tieuDe]) expect(t, t).not.toMatch(/[A-Z]{3,}/); // không có từ viết hoa toàn bộ từ ba chữ trở lên (mã vai, mã loại)
  });
});

describe("[NHH-SO-VS] dungViSaoDayDu — chuỗi nhân quả", () => {
  it("[NHH-SO-VS-01] thứ tự: khoản thu → cơ sở tính → VAT → loại giao dịch → nguồn → người hưởng → chính sách → tỉ lệ → hoa hồng → trần → kỳ → chi trả", () => {
    const v = dungViSaoDayDu(du());
    expect(v.muc.map((m) => m.nhan)).toEqual([
      "Khoản thu gốc",
      "Cơ sở tính",
      "VAT",
      "Loại giao dịch",
      "Nguồn",
      "Người hưởng",
      "Chính sách",
      "Tỉ lệ",
      "Hoa hồng",
      "Kiểm trần",
      "Kỳ",
      "Chi trả",
    ]);
  });

  it("[NHH-SO-VS-02] số liệu: khoản thu, cơ sở tính, VAT, tỉ lệ, tiền khớp ảnh chụp trên dòng", () => {
    const v = dungViSaoDayDu(du({ dong: dongGoc({ grossAmount: 4_320_000, vatRate: 0.08, netBase: 4_000_000 }) }));
    expect(nhan(v, "Khoản thu gốc")?.giaTri).toContain("4.320.000đ");
    expect(nhan(v, "Cơ sở tính")?.giaTri).toBe("4.000.000đ");
    expect(nhan(v, "VAT")?.giaTri).toBe("8% — đã bỏ 320.000đ");
    expect(nhan(v, "Tỉ lệ")?.giaTri).toBe("2%");
    expect(nhan(v, "Hoa hồng")?.giaTri).toBe("4.000.000đ × 2% = 80.000đ");
  });

  it("[NHH-SO-VS-02b] VAT: 0% nói \"không có VAT\"; dòng THU HỒI (số âm) vẫn báo số VAT đã bỏ DƯƠNG", () => {
    expect(nhan(dungViSaoDayDu(du()), "VAT")?.giaTri).toBe("0% — không có VAT");
    const thuHoi = dungViSaoDayDu(
      du({ dong: dongGoc({ entryKind: "REVERSAL", amount: -64_000, grossAmount: -1_728_000, vatRate: 0.08, netBase: -1_600_000, rate: null, calcKind: null, refEntryId: "e0" }) }),
    );
    expect(nhan(thuHoi, "VAT")?.giaTri).toBe("8% — đã bỏ 128.000đ");
  });

  it("[NHH-SO-VS-03] chính sách: văn bản + phiên bản + LÝ DO thắng (chụp trên dòng)", () => {
    const m = nhan(dungViSaoDayDu(du()), "Chính sách");
    expect(m?.giaTri).toBe("SR.QD.231 · phiên bản 2");
    expect(m?.ghiChu).toContain("thắng GLOBAL v3");
  });

  it("[NHH-SO-VS-04] nguồn và loại giao dịch dùng TÊN, kèm học viên; nhóm UNKNOWN nói rõ là mức thấp nhất", () => {
    const v = dungViSaoDayDu(du());
    expect(nhan(v, "Nguồn")?.giaTri).toBe("Sale / TVV giới thiệu");
    expect(nhan(v, "Loại giao dịch")?.giaTri).toBe("Tái tục · Nguyễn Bảo Minh");
    const u = dungViSaoDayDu(du({ dong: dongGoc({ sourceGroupCode: "UNKNOWN" }), tenNhomNguon: "Không rõ nguồn" }));
    expect(nhan(u, "Nguồn")?.giaTri).toBe("Không rõ nguồn");
    expect(nhan(u, "Nguồn")?.ghiChu).toMatch(/thấp nhất/);
  });

  it("[NHH-SO-VS-05] học viên chưa biết ⇒ KHÔNG bịa tên", () => {
    const v = dungViSaoDayDu(du({ hocVien: { ten: null } }));
    expect(nhan(v, "Loại giao dịch")?.giaTri).toBe("Tái tục");
  });

  it("[NHH-SO-VS-06] cách phân giải người hưởng nói bằng chữ nghiệp vụ, không lộ khoá kỹ thuật", () => {
    const m = nhan(dungViSaoDayDu(du()), "Người hưởng");
    expect(m?.giaTri).toBe("Lê Thị Phương Liên · vai Sale");
    expect(m?.ghiChu).toBe("Người chốt lead");
    for (const [t, basis, mong] of [
      ["TRANSACTION_ROLE", { canCu: "LEAD_ADMIN" }, "Người phụ trách lead (admin)"],
      ["TRANSACTION_ROLE", { canCu: "TRIAL_TEACHER" }, "Giáo viên dạy buổi Trial"],
      ["ORG_UNIT_ROLE", { canCu: "ASSIGNEE_QL_TT@cs1" }, "Người phụ trách cơ sở được khai"],
      ["ORG_UNIT_ROLE", { canCu: "QC@cs1" }, "Người phụ trách cơ sở được khai"],
      ["DIRECT_PERSON", { canCu: "REFERRER_PARENT" }, "Người giới thiệu ghi trên nguồn"],
      ["DIRECT_PERSON", { canCu: "AFFILIATE" }, "Người giới thiệu ghi trên nguồn"],
      ["TRANSACTION_ROLE", { engineCu: true, tier: "SALE" }, "Bảng kê của sổ hoa hồng cũ"],
    ] as const) {
      expect(cachPhanGiaiNguoiHuong(t, basis), `${t} ${JSON.stringify(basis)}`).toBe(mong);
    }
    // dữ liệu rác ⇒ câu trung tính, KHÔNG ném, KHÔNG in JSON thô
    for (const rac of [null, undefined, 3, "x", [], {}, { canCu: 5 }]) {
      const chu = cachPhanGiaiNguoiHuong("TRANSACTION_ROLE", rac);
      expect(chu).toBe("Theo chính sách của vai");
    }
  });

  it("[NHH-SO-VS-07] kiểm trần: người có tầm nhìn cơ sở thấy tổng tỉ lệ; người chỉ xem phần mình KHÔNG thấy tổng (NHH-SEC-09)", () => {
    const co = nhan(dungViSaoDayDu(du({ hienTongTiLe: true })), "Kiểm trần");
    expect(co?.giaTri).toBe("Tổng tỉ lệ 7% ≤ trần 9%");
    const khong = dungViSaoDayDu(du({ hienTongTiLe: false }));
    expect(nhan(khong, "Kiểm trần")?.giaTri).toBe("Trong trần 9%");
    // không chỗ nào khác trong ngăn lộ tổng 7%
    expect(JSON.stringify(khong)).not.toContain("7%");
  });

  it("[NHH-SO-VS-08] kỳ: hiệu lực ≠ ghi sổ (H22) nêu cả hai và nói kỳ cũ KHÔNG bị mở lại", () => {
    const v = dungViSaoDayDu(du({ dong: dongGoc({ entryKind: "LATE_ARRIVAL", lateArrival: true, naturalPeriod: "2026-10", kyGhi: "2026-11", reasonCode: "KY_GOC_DA_DONG" }) }));
    expect(nhan(v, "Kỳ")?.giaTri).toBe("Hiệu lực 10/2026 · ghi vào kỳ 11/2026");
    expect(v.canhBao.join(" ")).toMatch(/không bị mở lại/);
    const thuong = dungViSaoDayDu(du());
    expect(nhan(thuong, "Kỳ")?.giaTri).toBe("Kỳ 10/2026");
    expect(thuong.canhBao).toEqual([]);
  });

  it("[NHH-SO-VS-09] dòng THU HỒI: tiền âm in '−', tỉ lệ nói là theo dòng gốc, KHÔNG có công thức nhân với tỉ lệ hôm nay", () => {
    const v = dungViSaoDayDu(
      du({
        dong: dongGoc({ entryKind: "REVERSAL", amount: -32_000, netBase: -1_600_000, grossAmount: -1_600_000, rate: null, calcKind: null, refEntryId: "e0", refEventType: "PAYMENT", refEventId: "pay-refund", reasonCode: "HOAN_TIEN" }),
      }),
    );
    expect(nhan(v, "Hoa hồng")?.giaTri).toBe("−32.000đ");
    expect(nhan(v, "Tỉ lệ")?.giaTri).toMatch(/dòng gốc/);
    expect(v.tieuDe).toContain("Thu hồi");
    // câu `reason` của máy (mang id nội bộ) KHÔNG lên màn ở dòng thu hồi; dòng phát sinh thì có (đối chứng dương)
    expect(nhan(v, "Chính sách")?.ghiChu).toBeUndefined();
    expect(nhan(dungViSaoDayDu(du()), "Chính sách")?.ghiChu).toContain("thắng GLOBAL v3");
  });

  it("[NHH-SO-VS-10] khoản thu không có (PERIOD_BONUS / LEGACY) ⇒ KHÔNG bịa; dòng 'Khoản thu gốc' nói thẳng", () => {
    const v = dungViSaoDayDu(du({ khoanThu: null, dong: dongGoc({ paymentId: null }) }));
    expect(nhan(v, "Khoản thu gốc")?.giaTri).toBe("Không gắn với một khoản thu");
  });

  it("[NHH-SO-VS-11] khoản thu: ngày thu + ngày kế toán xác nhận; chưa xác nhận thì nói chưa", () => {
    expect(nhan(dungViSaoDayDu(du()), "Khoản thu gốc")?.ghiChu).toBe("Kế toán xác nhận 12/10/2026");
    const chua = dungViSaoDayDu(du({ khoanThu: { ngayThu: "2026-10-12T03:00:00.000Z", xacNhanLuc: null, soTien: 4_000_000 } }));
    expect(nhan(chua, "Khoản thu gốc")?.ghiChu).toBe("Kế toán chưa xác nhận");
  });

  it("[NHH-SO-VS-12] chi trả: nhãn tiếng Việt cho từng trạng thái", () => {
    for (const [tt, chu] of [
      ["PENDING", "Chưa chi"],
      ["APPROVED", "Đã duyệt chi"],
      ["EXPORTED", "Đã xuất bảng chi"],
      ["PAID", "Đã chi"],
    ] as const) {
      expect(nhan(dungViSaoDayDu(du({ chiTra: { trangThai: tt, luc: null } })), "Chi trả")?.giaTri).toBe(chu);
    }
  });

  it("[NHH-SO-VS-13] dòng khôi phục hoàn sổ cũ bị bác không bị gọi là 'khiếu nại' (kế thừa [NHH-VS-12])", () => {
    const v = dungViSaoDayDu(du({ dong: dongGoc({ entryKind: "DISPUTE_ADJUSTMENT", reasonCode: MA_KHOI_PHUC_HOAN_LEGACY, amount: 160_000 }) }));
    expect(v.tieuDe).not.toMatch(/khiếu nại/);
  });
});

describe("[NHH-SO-VS] điều chỉnh liên quan + dòng thời gian", () => {
  const goc = { id: "e0", entryKind: "ORIGINAL", amount: 80_000, kyGhi: "2026-10", kyHieuLuc: "2026-10", lateArrival: false, reasonCode: null, laDongNay: false } as const;
  const dieuChinh = { id: "e1", entryKind: "REVERSAL", amount: -32_000, kyGhi: "2026-11", kyHieuLuc: "2026-10", lateArrival: true, reasonCode: "HOAN_TIEN", laDongNay: false } as const;

  it("[NHH-SO-VS-14] Original ↔ Adjustment: dòng gốc đứng trước, điều chỉnh có mũi tên ↳, Effective Period ≠ Posting Period, lý do bằng chữ", () => {
    const v = dungViSaoDayDu(du({ lienQuan: [dieuChinh, goc] }));
    expect(v.dieuChinh.map((d) => d.id)).toEqual(["e0", "e1"]);
    const [g, dc] = v.dieuChinh;
    expect(g!.laDongGoc).toBe(true);
    expect(g!.muiTen).toBe(false);
    expect(dc!.muiTen).toBe(true);
    expect(dc!.soTien).toBe(-32_000);
    expect(dc!.ky).toBe("Hiệu lực 10/2026 · ghi vào kỳ 11/2026");
    expect(dc!.nhan).toBe("Thu hồi do hoàn tiền / điều chỉnh giảm");
    expect(dc!.lyDo).toMatch(/hoàn/);
  });

  it("[NHH-SO-VS-15] chỉ MỘT dòng (không có gì liên quan) ⇒ danh sách rỗng, không in 'điều chỉnh' giả", () => {
    expect(dungViSaoDayDu(du({ lienQuan: [{ ...goc, laDongNay: true }] })).dieuChinh).toEqual([]);
  });

  it("[NHH-SO-VS-16] đánh dấu dòng đang xem; mã lý do LATE_ARRIVAL / LEGACY_REVERSAL hiện thành chữ", () => {
    const late = { ...dieuChinh, id: "e2", entryKind: "LATE_ARRIVAL", reasonCode: "KY_GOC_DA_DONG", laDongNay: true } as const;
    const legacy = { ...dieuChinh, id: "e3", entryKind: "LEGACY_REVERSAL", reasonCode: "HOAN_TIEN" } as const;
    const v = dungViSaoDayDu(du({ lienQuan: [goc, late, legacy] }));
    expect(v.dieuChinh.find((d) => d.id === "e2")?.laDongNay).toBe(true);
    expect(v.dieuChinh.find((d) => d.id === "e2")?.lyDo).toMatch(/kỳ hiệu lực đã đóng/);
    expect(v.dieuChinh.find((d) => d.id === "e3")?.nhan).toBe("Thu hồi khoản của sổ cũ");
  });

  it("[NHH-SO-VS-17] nhật ký: người không có tầm nhìn cơ sở ⇒ chỉ dòng thời gian suy từ chính dòng sổ, KHÔNG có tên/lý do của người khác", () => {
    const v = dungViSaoDayDu(du({ nhatKy: null, chiTra: { trangThai: "PAID", luc: "2026-11-05T03:00:00.000Z" } }));
    expect(v.thoiGian.map((t) => t.nhan)).toEqual(["Ghi vào sổ", "Đã chi"]);
    expect(v.thoiGian.every((t) => t.nguoi === null && t.lyDo === null)).toBe(true);
  });

  it("[NHH-SO-VS-18] nhật ký: người có tầm nhìn cơ sở thấy thao tác kèm người làm + lý do, sắp theo thời gian; Tính/Đến muộn không lặp lại dòng 'Ghi vào sổ'", () => {
    const v = dungViSaoDayDu(
      du({
        nhatKy: [
          { luc: "2026-10-12T05:00:00.000Z", hanhDong: "CALCULATE", nguoi: "Engine hoa hồng", lyDo: null },
          { luc: "2026-11-02T03:00:00.000Z", hanhDong: "APPLY", nguoi: "Trần Kế Toán", lyDo: "Khách đổi nguồn" },
        ],
      }),
    );
    expect(v.thoiGian.map((t) => t.nhan)).toEqual(["Ghi vào sổ", "Áp dụng thay đổi"]);
    expect(v.thoiGian[1]).toMatchObject({ nguoi: "Trần Kế Toán", lyDo: "Khách đổi nguồn" });
  });

  it("[NHH-SO-VS-19] thao tác lạ trong nhật ký ⇒ nhãn trung tính, KHÔNG in mã thô", () => {
    const v = dungViSaoDayDu(du({ nhatKy: [{ luc: "2026-11-02T03:00:00.000Z", hanhDong: "XYZ_LA", nguoi: null, lyDo: null }] }));
    expect(v.thoiGian.map((t) => t.nhan)).toEqual(["Ghi vào sổ", "Thao tác khác"]);
  });
});
