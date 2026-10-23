// [P5-C*] hạn nhận xét · [P5-A*] đề xuất điều chỉnh (thuần, đồng hồ đóng băng). DB: tests/cham-cong/parttime-dieu-chinh.spec.ts.
import { describe, expect, it } from "vitest";
import { BANG_NHAP_BLD, chanChotKy, deXuatDieuChinh, kiemQuyetDieuChinh, type DauVaoDieuChinh } from "./dieu-chinh";
import { danhGiaNhanXet, hanNhanXet } from "./nhan-xet-han";

const vn = (ymd: string, h: string) => new Date(`${ymd}T${h}:00+07:00`);
const BUOI = "2026-10-20";
const nx = (now: Date, nhanXet: { studentId: string; createdAt: Date }[], coMat: string[] | null = ["a", "b"]) => danhGiaNhanXet({ ngayBuoi: BUOI, hocVienCoMat: coMat, nhanXet, now });

describe("[P5-C] hạn nhận xét 10:00 hôm sau (giờ VN)", () => {
  it("[P5-C00] hạn = 10:00 ngày THEO LỊCH kế tiếp, cả qua tháng / năm", () => {
    expect(hanNhanXet("2026-10-20").toISOString()).toBe(vn("2026-10-21", "10:00").toISOString());
    expect(hanNhanXet("2026-10-31").toISOString()).toBe(vn("2026-11-01", "10:00").toISOString());
    expect(hanNhanXet("2026-12-31").toISOString()).toBe(vn("2027-01-01", "10:00").toISOString());
  });

  it("[P5-C01] hoàn thành cùng ngày ⇒ ON_TIME", () => {
    expect(nx(vn("2026-10-22", "08:00"), [{ studentId: "a", createdAt: vn(BUOI, "19:40") }, { studentId: "b", createdAt: vn(BUOI, "20:10") }])).toMatchObject({ trangThai: "ON_TIME", canCo: 2, daCo: 2 });
  });

  it("[P5-C02][P5-C03][P5-C04] 09:59 ⇒ ON_TIME · đúng 10:00:00 ⇒ ON_TIME (bao gồm) · 10:01 ⇒ LATE", () => {
    const lan = (h: string) => nx(vn("2026-10-23", "08:00"), [{ studentId: "a", createdAt: vn(BUOI, "19:40") }, { studentId: "b", createdAt: vn("2026-10-21", h) }]);
    expect(lan("09:59").trangThai).toBe("ON_TIME");
    expect(lan("10:00").trangThai).toBe("ON_TIME");
    expect(lan("10:01")).toMatchObject({ trangThai: "LATE", hoanTatLuc: vn("2026-10-21", "10:01") });
  });

  it("[P5-C05] quá hạn mà còn thiếu ⇒ MISSING; trước hạn ⇒ PENDING", () => {
    const mot = [{ studentId: "a", createdAt: vn(BUOI, "19:40") }];
    expect(nx(vn("2026-10-21", "10:01"), mot)).toMatchObject({ trangThai: "MISSING", canCo: 2, daCo: 1 });
    expect(nx(vn("2026-10-21", "10:00"), mot).trangThai).toBe("PENDING");
    expect(nx(vn("2026-10-21", "10:01"), []).trangThai).toBe("MISSING");
  });

  it("[P5-C08] không ai có mặt ⇒ KHONG_YEU_CAU; chưa điểm danh ⇒ PENDING rồi CHUA_DIEM_DANH (không tự phạt); nhận xét cho HV vắng không tính", () => {
    expect(nx(vn("2026-10-22", "08:00"), [], []).trangThai).toBe("KHONG_YEU_CAU");
    expect(nx(vn("2026-10-21", "09:00"), [], null).trangThai).toBe("PENDING");
    expect(nx(vn("2026-10-22", "08:00"), [], null).trangThai).toBe("CHUA_DIEM_DANH");
    expect(nx(vn("2026-10-22", "08:00"), [{ studentId: "a", createdAt: vn(BUOI, "19:40") }, { studentId: "vang", createdAt: vn(BUOI, "19:41") }])).toMatchObject({ trangThai: "MISSING", daCo: 1 });
  });
});

const dv = (p: Partial<DauVaoDieuChinh> = {}): DauVaoDieuChinh => ({ role: "MAIN_TEACHER", treVaoPhut: 0, diMuon: false, raSomPhut: 0, raSom: false, nhanXet: "ON_TIME", ...p });

describe("[P5-A] đề xuất điều chỉnh — bản nháp BLĐ, không đoán khung mơ hồ", () => {
  it("[P5-A00] sạch ⇒ không có mục nào", () => {
    expect(deXuatDieuChinh(dv())).toEqual([]);
  });

  it("[P5-A01] đứng chính muộn 1–15' ⇒ ĐỀ XUẤT -10.000đ (LATE_0_15)", () => {
    for (const m of [1, 8, 15]) expect(deXuatDieuChinh(dv({ diMuon: true, treVaoPhut: m }))).toMatchObject([{ loai: "LATE_ARRIVAL", maLuat: "LATE_0_15", soTien: -10_000, trangThai: "DE_XUAT" }]);
  });

  it("[P5-A02] muộn 16–30' ⇒ CHO_CHINH_SACH Q10, KHÔNG có số tiền (không đoán -30.000đ)", () => {
    for (const m of [16, 30]) {
      const [x] = deXuatDieuChinh(dv({ diMuon: true, treVaoPhut: m }));
      expect(x).toMatchObject({ maLuat: "LATE_MIDDLE_UNRESOLVED", soTien: null, trangThai: "CHO_CHINH_SACH", cauHoi: "Q10" });
    }
    expect(BANG_NHAP_BLD.diMuon.find((k) => k.maLuat === "LATE_MIDDLE_UNRESOLVED")!.soTien).toBeNull();
  });

  it("[P5-A03] muộn > 30' ⇒ NGOẠI LỆ NGHIÊM TRỌNG 'bỏ ca' (Q11), không số tiền, không tự áp -200.000đ", () => {
    expect(deXuatDieuChinh(dv({ diMuon: true, treVaoPhut: 31 }))).toMatchObject([{ loai: "ABANDONED_WORK", soTien: null, trangThai: "NGOAI_LE_NGHIEM_TRONG", cauHoi: "Q11" }]);
  });

  it("[P5-A04] đứng chính thiếu nhận xét (quá hạn) ⇒ ĐỀ XUẤT -30.000đ; nộp trễ ⇒ CHO_CHINH_SACH Q15; chưa điểm danh ⇒ xem tay", () => {
    expect(deXuatDieuChinh(dv({ nhanXet: "MISSING" }))).toMatchObject([{ loai: "MISSING_SESSION_COMMENT", soTien: -30_000, trangThai: "DE_XUAT" }]);
    expect(deXuatDieuChinh(dv({ nhanXet: "LATE" }))).toMatchObject([{ soTien: null, trangThai: "CHO_CHINH_SACH", cauHoi: "Q15" }]);
    expect(deXuatDieuChinh(dv({ nhanXet: "CHUA_DIEM_DANH" }))).toMatchObject([{ soTien: null, trangThai: "CHO_CHINH_SACH" }]);
    expect(deXuatDieuChinh(dv({ nhanXet: "PENDING" }))).toEqual([]);
  });

  it("[P5-A05] về sớm ⇒ có bằng chứng nhưng CHỜ ngưỡng phút (Q13), không số tiền", () => {
    expect(deXuatDieuChinh(dv({ raSom: true, raSomPhut: 30 }))).toMatchObject([{ loai: "EARLY_LEAVE", soTien: null, trangThai: "CHO_CHINH_SACH", cauHoi: "Q13" }]);
  });

  it("[P5-C06][P5-A08] trợ giảng: thiếu nhận xét KHÔNG sinh khoản (Q14); muộn ⇒ chờ Q12 (không tự áp như đứng chính)", () => {
    expect(deXuatDieuChinh(dv({ role: "TEACHING_ASSISTANT", nhanXet: "MISSING" }))).toEqual([]);
    expect(deXuatDieuChinh(dv({ role: "TEACHING_ASSISTANT", diMuon: true, treVaoPhut: 8 }))).toMatchObject([{ soTien: null, trangThai: "CHO_CHINH_SACH", cauHoi: "Q12" }]);
  });

  it("[P5-A09] dung sai chưa vượt (diMuon=false) ⇒ không đề xuất dù có phút thô", () => {
    expect(deXuatDieuChinh(dv({ diMuon: false, treVaoPhut: 3 }))).toEqual([]);
  });

  it("[P5-A10] mục chưa giải quyết chặn chốt kỳ; mục ĐỀ XUẤT thì không", () => {
    const ds = [...deXuatDieuChinh(dv({ diMuon: true, treVaoPhut: 20, nhanXet: "MISSING" }))];
    expect(chanChotKy(ds).map((m) => m.maLuat)).toEqual(["LATE_MIDDLE_UNRESOLVED"]);
  });

  it("[P5-A11] cổng quyết: tự quyết khoản của mình · kỳ khoá · không áp thiếu lý do · quyết lại khoản đã quyết ⇒ từ chối", () => {
    const k = (p: Partial<Parameters<typeof kiemQuyetDieuChinh>[0]> = {}) => kiemQuyetDieuChinh({ trangThai: "PROPOSED", quyet: "CONFIRMED", lyDo: null, nguoiQuyetId: "ql", nguoiBiTruId: "gv", kyKhoa: false, ...p });
    expect(k()).toBeNull();
    expect(k({ nguoiQuyetId: "gv" })).toMatch(/chính mình/);
    expect(k({ kyKhoa: true })).toMatch(/khoá/);
    expect(k({ quyet: "REJECTED" })).toMatch(/lý do/);
    expect(k({ trangThai: "CONFIRMED" })).toMatch(/không còn/);
    expect(k({ trangThai: "CONFIRMED", quyet: "CANCELLED", lyDo: "nhầm người" })).toBeNull();
    expect(k({ trangThai: "REJECTED", quyet: "CANCELLED", lyDo: "nhầm người" })).toMatch(/Chỉ huỷ/);
  });
});
