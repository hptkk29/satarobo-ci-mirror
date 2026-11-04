/**
 * [AFF-LK-*] — link/mã giới thiệu có đang HỢP LỆ không (đặc tả §31, §43, §50, §74). THUẦN, đồng hồ cố định (luật 19).
 * [AFF-TGT-*] — «tự giới thiệu» (§51–§52).
 */
import { describe, expect, it } from "vitest";
import {
  CAU_CHUNG_CHO_KHACH,
  NHAN_LIEN_KET_KHONG_HOP_LE,
  THU_TU_MA_LIEN_KET,
  kiemLienKet,
  trongCuaSoCookie,
  type DauVaoKiemLienKet,
} from "./lien-ket-hop-le";
import { canCuTuGioiThieu, kiemTuGioiThieu } from "./tu-gioi-thieu";

const D = (iso: string) => new Date(iso);
const BAY_GIO = D("2026-11-15T03:00:00.000Z");

const tot = (p: Partial<DauVaoKiemLienKet> = {}): DauVaoKiemLienKet => ({
  taiSan: { status: "ACTIVE" },
  doiTac: { status: "ACTIVE" },
  thanhVien: { status: "ACTIVE", effectiveFrom: D("2026-11-01T00:00:00.000Z"), effectiveTo: null },
  campaign: { status: "ACTIVE", effectiveFrom: D("2026-11-01T00:00:00.000Z"), effectiveTo: D("2026-12-31T00:00:00.000Z") },
  website: { status: "ACTIVE", trackingEnabled: true },
  trangDichConHieuLuc: true,
  ...p,
});

describe("[AFF-LK-01] link hợp lệ khi MỌI điều kiện đạt (đối chứng dương)", () => {
  it("tất cả đạt ⇒ ok", () => {
    expect(kiemLienKet(tot(), BAY_GIO)).toEqual({ ok: true });
  });
  it("campaign/thành viên không có hạn dưới/hạn trên (null) vẫn hợp lệ", () => {
    expect(kiemLienKet(tot({ campaign: { status: "ACTIVE", effectiveFrom: null, effectiveTo: null } }), BAY_GIO)).toEqual({ ok: true });
  });
});

describe("[AFF-LK-02] mỗi điều kiện hỏng RIÊNG LẺ ⇒ đúng một mã (UAT §74: revoked · expired · inactive campaign · inactive membership)", () => {
  const CA: [string, Partial<DauVaoKiemLienKet>, (typeof THU_TU_MA_LIEN_KET)[number]][] = [
    ["link bị thu hồi", { taiSan: { status: "REVOKED" } }, "LINK_DA_THU_HOI"],
    ["đối tác tạm ngừng", { doiTac: { status: "SUSPENDED" } }, "DOI_TAC_KHONG_HOAT_DONG"],
    ["đối tác chưa duyệt", { doiTac: { status: "PENDING" } }, "DOI_TAC_KHONG_HOAT_DONG"],
    ["thành viên chờ duyệt", { thanhVien: { status: "PENDING", effectiveFrom: D("2026-11-01T00:00:00.000Z"), effectiveTo: null } }, "THANH_VIEN_KHONG_HOAT_DONG"],
    ["thành viên tạm ngừng", { thanhVien: { status: "SUSPENDED", effectiveFrom: D("2026-11-01T00:00:00.000Z"), effectiveTo: null } }, "THANH_VIEN_KHONG_HOAT_DONG"],
    ["thành viên chưa tới ngày", { thanhVien: { status: "ACTIVE", effectiveFrom: D("2026-11-20T00:00:00.000Z"), effectiveTo: null } }, "THANH_VIEN_CHUA_HIEU_LUC"],
    ["thành viên hết hạn", { thanhVien: { status: "ACTIVE", effectiveFrom: D("2026-11-01T00:00:00.000Z"), effectiveTo: D("2026-11-10T00:00:00.000Z") } }, "THANH_VIEN_HET_HAN"],
    ["campaign tạm dừng", { campaign: { status: "PAUSED", effectiveFrom: null, effectiveTo: null } }, "CAMPAIGN_KHONG_HOAT_DONG"],
    ["campaign còn nháp", { campaign: { status: "DRAFT", effectiveFrom: null, effectiveTo: null } }, "CAMPAIGN_KHONG_HOAT_DONG"],
    ["campaign đã kết thúc", { campaign: { status: "ENDED", effectiveFrom: null, effectiveTo: null } }, "CAMPAIGN_KHONG_HOAT_DONG"],
    ["campaign chưa tới ngày", { campaign: { status: "ACTIVE", effectiveFrom: D("2026-12-01T00:00:00.000Z"), effectiveTo: null } }, "CAMPAIGN_CHUA_HIEU_LUC"],
    ["campaign hết hạn", { campaign: { status: "ACTIVE", effectiveFrom: null, effectiveTo: D("2026-11-14T00:00:00.000Z") } }, "CAMPAIGN_HET_HAN"],
    ["website ngừng", { website: { status: "INACTIVE", trackingEnabled: true } }, "WEBSITE_KHONG_HOAT_DONG"],
    ["website tắt theo dõi", { website: { status: "ACTIVE", trackingEnabled: false } }, "THEO_DOI_DANG_TAT"],
    ["trang đích bị tắt", { trangDichConHieuLuc: false }, "TRANG_DICH_KHONG_CON"],
  ];
  for (const [ten, p, ma] of CA) {
    it(ten, () => {
      const kq = kiemLienKet(tot(p), BAY_GIO);
      expect(kq.ok).toBe(false);
      if (!kq.ok) {
        expect(kq.ma).toBe(ma);
        expect(kq.tatCa).toEqual([ma]);
      }
    });
  }
});

describe("[AFF-LK-03] biên thời gian: từ ĐÓNG, đến MỞ", () => {
  it("đúng giờ bắt đầu ⇒ hợp lệ; đúng giờ kết thúc ⇒ HẾT HẠN", () => {
    const cp = (from: string | null, to: string | null) => tot({ campaign: { status: "ACTIVE", effectiveFrom: from ? D(from) : null, effectiveTo: to ? D(to) : null } });
    expect(kiemLienKet(cp(BAY_GIO.toISOString(), null), BAY_GIO)).toEqual({ ok: true });
    const het = kiemLienKet(cp(null, BAY_GIO.toISOString()), BAY_GIO);
    expect(het.ok).toBe(false);
    if (!het.ok) expect(het.ma).toBe("CAMPAIGN_HET_HAN");
    expect(kiemLienKet(cp(null, new Date(BAY_GIO.getTime() + 1).toISOString()), BAY_GIO)).toEqual({ ok: true });
  });
});

describe("[AFF-LK-04] nhiều điều kiện cùng hỏng: lý do ĐẦU TIÊN theo thứ tự cố định, `tatCa` đủ", () => {
  it("thu hồi đứng trước mọi lý do khác (admin vừa bấm thu hồi phải thấy đúng lý do đó)", () => {
    const kq = kiemLienKet(
      tot({ taiSan: { status: "REVOKED" }, campaign: { status: "ENDED", effectiveFrom: null, effectiveTo: null }, doiTac: { status: "ENDED" }, trangDichConHieuLuc: false }),
      BAY_GIO,
    );
    expect(kq.ok).toBe(false);
    if (!kq.ok) {
      expect(kq.ma).toBe("LINK_DA_THU_HOI");
      expect(kq.tatCa).toEqual(["LINK_DA_THU_HOI", "DOI_TAC_KHONG_HOAT_DONG", "CAMPAIGN_KHONG_HOAT_DONG", "TRANG_DICH_KHONG_CON"]);
    }
  });

  it("thứ tự trong `tatCa` luôn theo THU_TU_MA_LIEN_KET (không theo thứ tự phát hiện)", () => {
    const kq = kiemLienKet(tot({ website: { status: "INACTIVE", trackingEnabled: false }, taiSan: { status: "REVOKED" } }), BAY_GIO);
    if (kq.ok) throw new Error("phải hỏng");
    const idx = kq.tatCa.map((m) => THU_TU_MA_LIEN_KET.indexOf(m));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("mọi mã đều có nhãn người vận hành; khách chỉ nhận MỘT câu chung (không lộ lý do ⇒ không lộ token từng tồn tại)", () => {
    for (const m of THU_TU_MA_LIEN_KET) expect(NHAN_LIEN_KET_KHONG_HOP_LE[m].length).toBeGreaterThan(5);
    expect(Object.keys(NHAN_LIEN_KET_KHONG_HOP_LE).sort()).toEqual([...THU_TU_MA_LIEN_KET].sort());
    for (const m of THU_TU_MA_LIEN_KET) expect(CAU_CHUNG_CHO_KHACH).not.toContain(NHAN_LIEN_KET_KHONG_HOP_LE[m]);
  });
});

describe("[AFF-LK-05] cửa sổ cookie đo ở SERVER theo tham số campaign", () => {
  const click = D("2026-11-01T00:00:00.000Z");
  const ngay = (n: number) => new Date(click.getTime() + n * 86_400_000);

  it("trong cửa sổ ⇒ true; đúng ngày thứ N ⇒ false (biên trên MỞ); ngay lúc bấm ⇒ true", () => {
    expect(trongCuaSoCookie(click, click, 30)).toBe(true);
    expect(trongCuaSoCookie(click, ngay(29), 30)).toBe(true);
    expect(trongCuaSoCookie(click, ngay(30), 30)).toBe(false);
    expect(trongCuaSoCookie(click, ngay(90), 30)).toBe(false);
  });

  it("tham số campaign quyết định, không phải hằng 30: cùng thời điểm, cửa sổ 7 ngày ⇒ false, cửa sổ 60 ngày ⇒ true", () => {
    expect(trongCuaSoCookie(click, ngay(20), 7)).toBe(false);
    expect(trongCuaSoCookie(click, ngay(20), 60)).toBe(true);
  });

  it("mốc bấm ở TƯƠNG LAI so với lúc gửi (đồng hồ lệch/giả) ⇒ false; cửa sổ không hợp lệ (0, âm, NaN) ⇒ false", () => {
    expect(trongCuaSoCookie(ngay(1), click, 30)).toBe(false);
    for (const d of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(trongCuaSoCookie(click, click, d), String(d)).toBe(false);
  });
});

describe("[AFF-TGT-01] tự giới thiệu: so theo NHIỀU căn cứ, không chỉ User.id", () => {
  it("cùng tài khoản / cùng nhân viên", () => {
    expect(canCuTuGioiThieu({ userId: "u1" }, { userId: "u1" })).toEqual(["TAI_KHOAN"]);
    expect(canCuTuGioiThieu({ employeeId: "e1" }, { employeeId: "e1" })).toEqual(["NHAN_VIEN"]);
    expect(canCuTuGioiThieu({ userId: "u1" }, { userId: "u2" })).toEqual([]);
  });

  it("SĐT khớp qua mọi dạng viết (0xxx · 84xxx · +84xxx · có dấu chấm)", () => {
    expect(canCuTuGioiThieu({ phones: ["0905123456"] }, { phones: ["+84 905 123 456"] })).toEqual(["SDT"]);
    expect(canCuTuGioiThieu({ phones: ["84905123456"] }, { phones: ["0905.123.456"] })).toEqual(["SDT"]);
  });

  it("SĐT RÁC giống nhau (\"N/A\", số bàn, rỗng) KHÔNG phải căn cứ — không chặn oan", () => {
    expect(canCuTuGioiThieu({ phones: ["N/A"] }, { phones: ["N/A"] })).toEqual([]);
    expect(canCuTuGioiThieu({ phones: ["02363123456"] }, { phones: ["02363123456"] })).toEqual([]);
    expect(canCuTuGioiThieu({ phones: ["", null, undefined] }, { phones: ["", null] })).toEqual([]);
  });

  it("email khớp không phân biệt hoa thường; chuỗi không có '@' không phải căn cứ", () => {
    expect(canCuTuGioiThieu({ emails: [" An@Example.com "] }, { emails: ["an@example.COM"] })).toEqual(["EMAIL"]);
    expect(canCuTuGioiThieu({ emails: ["khong-co-a-cong"] }, { emails: ["khong-co-a-cong"] })).toEqual([]);
  });

  it("nhiều căn cứ cùng khớp ⇒ liệt kê đủ, theo thứ tự cố định", () => {
    const a = { userId: "u1", employeeId: "e1", phones: ["0905123456"], emails: ["a@x.vn"] };
    expect(canCuTuGioiThieu(a, a)).toEqual(["TAI_KHOAN", "NHAN_VIEN", "SDT", "EMAIL"]);
  });

  it("thiếu dữ liệu một bên (null/undefined) KHÔNG khớp nhầm (null === null)", () => {
    expect(canCuTuGioiThieu({ userId: null, employeeId: null }, { userId: null, employeeId: null })).toEqual([]);
    expect(canCuTuGioiThieu({}, {})).toEqual([]);
  });
});

describe("[AFF-TGT-02] allowSelfReferral quyết định CHẶN, căn cứ vẫn được ghi lại", () => {
  const a = { employeeId: "e1", phones: ["0905123456"] };
  it("không cho phép (mặc định) ⇒ chặn kèm căn cứ", () => {
    expect(kiemTuGioiThieu(a, a, false)).toEqual({ chan: true, canCu: ["NHAN_VIEN", "SDT"] });
  });
  it("cho phép ⇒ KHÔNG chặn nhưng vẫn trả căn cứ (ghi vào bằng chứng)", () => {
    expect(kiemTuGioiThieu(a, a, true)).toEqual({ chan: false, canCu: ["NHAN_VIEN", "SDT"] });
  });
  it("không có căn cứ ⇒ không chặn dù campaign không cho phép", () => {
    expect(kiemTuGioiThieu({ employeeId: "e1" }, { employeeId: "e2" }, false)).toEqual({ chan: false, canCu: [] });
  });
});
