/**
 * Ca [NHH-SRC-16]/[NHH-SRC-17] — `quyetDinhDoiNguon` (03 §3). THUẦN: quyết định cho/không cho đổi nguồn.
 * Phần GHI (transaction, audit, event) là `doi-nguon-lead.ts` — ca DB ở tests/lead-intake.
 */
import { describe, expect, it } from "vitest";
import { KHOA_QUYEN_DOI_NGUON, quyenDoiNguon, quyetDinhDoiNguon } from "./doi-nguon";

const OK_QUYEN = { overwrite: true, overrideSauThanhToan: false, quanLyNguon: false };
const nhomThuong = { trangThai: "ACTIVE", selectable: true, requiresNote: false, referrerRequirement: "NONE" } as const;
const goc = {
  daCoThucThu: false,
  daCoDongSo: false,
  quyen: OK_QUYEN,
  nguonDangKhoa: false,
  lyDo: "Khách xác nhận qua điện thoại" as string | null,
  nguonMoi: nhomThuong as {
    trangThai: string;
    selectable: boolean;
    requiresNote: boolean;
    referrerRequirement: "NONE" | "PARENT" | "EMPLOYEE" | "AFFILIATE_ORG" | "EVENT";
  },
  thamChieu: null as { employeeId: string | null; parentUserId: string | null; studentId: string | null; affiliateId: string | null } | null,
  giaiTrinh: null as string | null,
  gianLan: [] as { ma: "TU_CLAIM" | "SDT_NHAN_VIEN" | "NGUOI_GT_LA_KHACH"; muc: "BLOCK" | "WARNING" }[],
};

describe("[NHH-SRC-16] đổi nguồn TRƯỚC thực thu: leads:overwrite + lý do ≥ 10 ký tự", () => {
  it("đủ quyền + lý do ⇒ được, không điều chỉnh tiền, hành động DOI_NGUON", () => {
    expect(quyetDinhDoiNguon(goc)).toEqual({ ok: true, canDieuChinh: false, action: "DOI_NGUON" });
  });
  it("thiếu leads:overwrite ⇒ từ chối trên field quyen", () => {
    const r = quyetDinhDoiNguon({ ...goc, quyen: { ...OK_QUYEN, overwrite: false } });
    expect(r).toMatchObject({ ok: false, truong: "quyen" });
  });
  it("lý do 9 ký tự ⇒ lỗi trên field lyDo (không để rơi xuống lỗi DB); 10 ⇒ qua; toàn khoảng trắng ⇒ lỗi", () => {
    expect(quyetDinhDoiNguon({ ...goc, lyDo: "123456789" })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(quyetDinhDoiNguon({ ...goc, lyDo: "1234567890" }).ok).toBe(true);
    expect(quyetDinhDoiNguon({ ...goc, lyDo: "            " })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(quyetDinhDoiNguon({ ...goc, lyDo: null })).toMatchObject({ ok: false, truong: "lyDo" });
  });
  it("lý do bắt buộc kể cả khi CHƯA có tiền (mọi lượt đổi lead đã có attribution — 03 §3)", () => {
    expect(quyetDinhDoiNguon({ ...goc, daCoThucThu: false, lyDo: "ngắn" }).ok).toBe(false);
  });
});

describe("[NHH-SRC-17] đổi nguồn SAU thực thu: chỉ sources:override-after-payment", () => {
  const sau = { ...goc, daCoThucThu: true };
  it("chỉ có leads:overwrite ⇒ TỪ CHỐI (không được dùng quyền thường để sửa nguồn của khoản đã thu)", () => {
    expect(quyetDinhDoiNguon(sau)).toMatchObject({ ok: false, truong: "quyen" });
  });
  it("có quyền riêng + lý do ⇒ được, canDieuChinh=true, action DOI_NGUON_SAU_THU", () => {
    expect(
      quyetDinhDoiNguon({ ...sau, quyen: { overwrite: false, overrideSauThanhToan: true, quanLyNguon: false } }),
    ).toEqual({ ok: true, canDieuChinh: true, action: "DOI_NGUON_SAU_THU" });
  });
  it("quyền riêng nhưng thiếu lý do ⇒ vẫn lỗi lyDo", () => {
    expect(
      quyetDinhDoiNguon({
        ...sau,
        lyDo: "ngắn",
        quyen: { overwrite: false, overrideSauThanhToan: true, quanLyNguon: false },
      }),
    ).toMatchObject({ ok: false, truong: "lyDo" });
  });
});

describe("cổng chung: nguồn mới hợp lệ · người · giải trình · gian lận · nguồn đang khoá", () => {
  it("nguồn mới không ACTIVE hoặc không selectable (UNKNOWN) ⇒ lỗi trên field nguon", () => {
    expect(quyetDinhDoiNguon({ ...goc, nguonMoi: { ...nhomThuong, trangThai: "INACTIVE" } })).toMatchObject({
      ok: false,
      truong: "nguon",
    });
    expect(quyetDinhDoiNguon({ ...goc, nguonMoi: { ...nhomThuong, selectable: false } })).toMatchObject({
      ok: false,
      truong: "nguon",
    });
  });
  it("nhóm ✅ người thiếu người ⇒ lỗi thamChieu; có người ⇒ qua", () => {
    const emp = { ...nhomThuong, referrerRequirement: "EMPLOYEE" } as const;
    expect(quyetDinhDoiNguon({ ...goc, nguonMoi: emp })).toMatchObject({ ok: false, truong: "thamChieu" });
    expect(
      quyetDinhDoiNguon({
        ...goc,
        nguonMoi: emp,
        thamChieu: { employeeId: "E1", parentUserId: null, studentId: null, affiliateId: null },
      }).ok,
    ).toBe(true);
  });
  it("nhóm 11 thiếu giải trình ⇒ lỗi giaiTrinh", () => {
    const n11 = { ...nhomThuong, requiresNote: true };
    expect(quyetDinhDoiNguon({ ...goc, nguonMoi: n11 })).toMatchObject({ ok: false, truong: "giaiTrinh" });
    expect(quyetDinhDoiNguon({ ...goc, nguonMoi: n11, giaiTrinh: "khách tự mô tả rõ ràng" }).ok).toBe(true);
  });
  it("TU_CLAIM (BLOCK) ⇒ lỗi trên field thamChieu; WARNING không chặn", () => {
    expect(quyetDinhDoiNguon({ ...goc, gianLan: [{ ma: "TU_CLAIM", muc: "BLOCK" }] })).toMatchObject({
      ok: false,
      truong: "thamChieu",
    });
    expect(quyetDinhDoiNguon({ ...goc, gianLan: [{ ma: "SDT_NHAN_VIEN", muc: "WARNING" }] }).ok).toBe(true);
  });
  it("nguồn đang KHOÁ (page mapping): cần sources:manage; thiếu ⇒ từ chối, có ⇒ qua", () => {
    expect(quyetDinhDoiNguon({ ...goc, nguonDangKhoa: true })).toMatchObject({ ok: false, truong: "quyen" });
    expect(quyetDinhDoiNguon({ ...goc, nguonDangKhoa: true, quyen: { ...OK_QUYEN, quanLyNguon: true } }).ok).toBe(true);
  });
  it("daCoDongSo (đã có dòng sổ hoa hồng) cũng báo canDieuChinh dù chưa thực thu", () => {
    const r = quyetDinhDoiNguon({ ...goc, daCoDongSo: true });
    expect(r).toMatchObject({ ok: true, canDieuChinh: true });
  });
});

describe("[NHH-UI-QD-01] quyenDoiNguon — MỘT phép hỏi quyền cho nút VẼ và cho cổng SERVER (luật 12)", () => {
  const Q = { overwrite: false, overrideSauThanhToan: false, quanLyNguon: false };
  it("trước thực thu: cần đúng `leads:overwrite`; thiếu ⇒ nêu TÊN quyền thiếu", () => {
    expect(quyenDoiNguon({ daCoThucThu: false, nguonDangKhoa: false, quyen: Q })).toMatchObject({
      ok: false,
      thieu: ["leads:overwrite"],
    });
    expect(quyenDoiNguon({ daCoThucThu: false, nguonDangKhoa: false, quyen: { ...Q, overwrite: true } })).toEqual({ ok: true });
  });
  it("sau thực thu: `leads:overwrite` KHÔNG đủ — cần quyền riêng; tên quyền nêu đúng", () => {
    expect(quyenDoiNguon({ daCoThucThu: true, nguonDangKhoa: false, quyen: { ...Q, overwrite: true } })).toMatchObject({
      ok: false,
      thieu: ["sources:override-after-payment"],
      maChan: "DOI_SAU_TT",
    });
  });
  it("nguồn đang KHOÁ: thêm `sources:manage`; có đủ cả hai ⇒ được", () => {
    expect(quyenDoiNguon({ daCoThucThu: false, nguonDangKhoa: true, quyen: { ...Q, overwrite: true } })).toMatchObject({
      ok: false,
      thieu: ["sources:manage"],
    });
    expect(
      quyenDoiNguon({ daCoThucThu: false, nguonDangKhoa: true, quyen: { ...Q, overwrite: true, quanLyNguon: true } }),
    ).toEqual({ ok: true });
  });
  it("thiếu CẢ quyền chính lẫn quyền khoá ⇒ liệt kê đủ hai (người hỏi xin một lần, không phải hai)", () => {
    const r = quyenDoiNguon({ daCoThucThu: false, nguonDangKhoa: true, quyen: Q });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.thieu).toEqual(["leads:overwrite", "sources:manage"]);
  });
  it("tên khoá lấy từ MỘT bảng hằng — không gõ lại chuỗi ở nơi khác", () => {
    expect(KHOA_QUYEN_DOI_NGUON).toEqual({
      truocThuc: "leads:overwrite",
      sauThuc: "sources:override-after-payment",
      khoa: "sources:manage",
    });
  });
  it("quyetDinhDoiNguon đi QUA quyenDoiNguon: cùng đầu vào quyền ⇒ cùng kết luận ok/không và cùng field 'quyen'", () => {
    const base = {
      daCoThucThu: true,
      daCoDongSo: false,
      quyen: Q,
      nguonDangKhoa: false,
      lyDo: "Khách xác nhận qua điện thoại" as string | null,
      nguonMoi: { trangThai: "ACTIVE", selectable: true, requiresNote: false, referrerRequirement: "NONE" as const },
      thamChieu: null,
      giaiTrinh: null,
      gianLan: [],
    };
    const q = quyenDoiNguon({ daCoThucThu: true, nguonDangKhoa: false, quyen: Q });
    const d = quyetDinhDoiNguon(base);
    expect(q.ok).toBe(false);
    expect(d).toMatchObject({ ok: false, truong: "quyen", ...(q.ok ? {} : { loi: q.loi, maChan: q.maChan }) });
  });
});
