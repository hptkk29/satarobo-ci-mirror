// [LT-*] — lưới phân công GV: xếp tiết vào ca, suy mã ô, tiền dự kiến, cổng hỗ trợ Trial. THUẦN, mốc tuyệt đối (luật 19).
// Tài liệu: docs/cham-cong/parttime/23-LUOI-PHAN-CONG-GV.md §2 + §4. Ví dụ tiền lấy NGUYÊN VĂN SR.QD.238 §2 (ca tối, Rank 1).
import { describe, expect, it } from "vitest";
import { docThamSo, type ThamSoSrQd238 } from "./chinh-sach";
import { maNen, tinhCaDuKien, xepVaoCa, xetHoTroTrial, type HoatDongO, type TrucO, type XetTrialVao } from "./luoi-tuan";

const TS = docThamSo({
  loai: "SR_QD_238",
  tiet: { chuanBiPhut: 10, dayPhut: 90, chuanPhut: 100 },
  ca: [
    { ma: "S", tu: "07:45", den: "11:30" },
    { ma: "C", tu: "13:45", den: "17:30" },
    { ma: "T", tu: "17:15", den: "21:00" },
  ],
  toiDaTietMoiCa: 2,
  donGia: { mainTheoRank: { "1": 120000, "2": 140000, "3": 160000, "4": 200000 }, troGiang: 80000, trucCa: 90000, nuaCaTruc: 45000 },
  rankMacDinh: 1,
  nguongTroGiang: [],
}) as ThamSoSrQd238;

const CHUAN = { trangThai: "CHUAN", donVi: "1", ghiDeId: null } as const;
let n = 0;
const hd = (vai: "MAIN" | "TA", loai: HoatDongO["loai"] = "REGULAR", p: Partial<HoatDongO> = {}): HoatDongO => ({
  id: `a${++n}`,
  vai,
  loai,
  gioBatDau: "18:00",
  gioKetThuc: "19:30",
  donViTiet: CHUAN,
  ...p,
});
const TRUC: TrucO = { dutyId: "d1" };
const ca = (hoatDong: HoatDongO[], truc: TrucO | null = null, rank = 1, trial: { soTien: number }[] = []) =>
  tinhCaDuKien({ thamSo: TS, rank, hoatDong, truc, trial });

describe("[LT-CA] xếp tiết vào ca — chứa TRỌN phần dạy", () => {
  it("[LT-CA-01] 18:00–19:30 ⇒ T · 15:45–17:15 ⇒ C · 09:45–11:15 ⇒ S", () => {
    expect(xepVaoCa(TS, "18:00", "19:30")).toBe("T");
    expect(xepVaoCa(TS, "15:45", "17:15")).toBe("C");
    expect(xepVaoCa(TS, "09:45", "11:15")).toBe("S");
  });
  it("[LT-CA-02] vùng chồng C/T 17:15–17:30: 16:00–17:30 chỉ nằm trọn trong C; 17:15–18:45 chỉ nằm trọn trong T", () => {
    expect(xepVaoCa(TS, "16:00", "17:30")).toBe("C");
    expect(xepVaoCa(TS, "17:15", "18:45")).toBe("T");
  });
  it("[LT-CA-03] không ca nào chứa trọn ⇒ null (VƯỢT CA — không đoán)", () => {
    expect(xepVaoCa(TS, "11:00", "12:30")).toBeNull();
    expect(xepVaoCa(TS, "17:00", "18:30")).toBeNull();
  });
});

describe("[LT-MA] mã nền của ô", () => {
  it("[LT-MA-01] bảng mã chuẩn", () => {
    expect(maNen({ main: 0, ta: 0, truc: false })).toBe("X");
    expect(maNen({ main: 1, ta: 0, truc: false })).toBe("D");
    expect(maNen({ main: 0, ta: 0, truc: true })).toBe("T");
    expect(maNen({ main: 0, ta: 1, truc: false })).toBe("TG");
    expect(maNen({ main: 1, ta: 0, truc: true })).toBe("TD");
    expect(maNen({ main: 0, ta: 1, truc: true })).toBe("TTG");
    expect(maNen({ main: 2, ta: 0, truc: false })).toBe("D2");
    expect(maNen({ main: 1, ta: 1, truc: false })).toBe("D+TG");
    expect(maNen({ main: 0, ta: 2, truc: false })).toBe("TG2");
  });
  it("[LT-MA-02] 2 tiết + trực: trực không đổi mã (0 đồng trực) — vẫn D2 / D+TG / TG2", () => {
    expect(maNen({ main: 2, ta: 0, truc: true })).toBe("D2");
    expect(maNen({ main: 1, ta: 1, truc: true })).toBe("D+TG");
    expect(maNen({ main: 0, ta: 2, truc: true })).toBe("TG2");
  });
  it("[LT-MA-03] quá số tiết tối đa một ca ⇒ null (không bịa mã)", () => {
    expect(maNen({ main: 3, ta: 0, truc: false })).toBeNull();
    expect(maNen({ main: 2, ta: 1, truc: false })).toBeNull();
  });
});

describe("[LT-TIEN] tiền dự kiến một ca (SR.QD.238 §2, Rank 1)", () => {
  it("[LT-TIEN-01] D theo Rank 1/2/3/4 = 120k/140k/160k/200k", () => {
    expect([1, 2, 3, 4].map((r) => ca([hd("MAIN")], null, r).tong)).toEqual([120000, 140000, 160000, 200000]);
  });
  it("[LT-TIEN-02] T 90k · TG 80k · TD 165k · TTG 125k · D2 240k · D+TG 200k · TG2 160k", () => {
    expect(ca([], TRUC)).toMatchObject({ ma: "T", tong: 90000 });
    expect(ca([hd("TA")])).toMatchObject({ ma: "TG", tong: 80000 });
    expect(ca([hd("MAIN")], TRUC)).toMatchObject({ ma: "TD", tong: 165000 });
    expect(ca([hd("TA")], TRUC)).toMatchObject({ ma: "TTG", tong: 125000 });
    expect(ca([hd("MAIN"), hd("MAIN")])).toMatchObject({ ma: "D2", tong: 240000 });
    expect(ca([hd("MAIN"), hd("TA")])).toMatchObject({ ma: "D+TG", tong: 200000 });
    expect(ca([hd("TA"), hd("TA")])).toMatchObject({ ma: "TG2", tong: 160000 });
  });
  it("[LT-TIEN-03] ≥ 2 tiết + có trực ⇒ 0đ trực (không trả chồng)", () => {
    const r = ca([hd("MAIN"), hd("MAIN")], TRUC);
    expect(r.tong).toBe(240000);
    expect(r.dong.find((d) => d.loai === "TRUC")).toMatchObject({ soLuong: 0, thanhTien: 0 });
  });
  it("[LT-TIEN-04] KHÔNG có dòng trực ⇒ 0đ trực, dù không có tiết (X = 0)", () => {
    expect(ca([])).toMatchObject({ ma: "X", tong: 0 });
    expect(ca([hd("MAIN")]).dong.some((d) => d.loai === "TRUC")).toBe(false);
  });
  it("[LT-TIEN-05] breakdown từng dòng, không chỉ tổng: TD Rank 1 = 120.000 (MAIN) + 45.000 (nửa trực)", () => {
    expect(ca([hd("MAIN")], TRUC).dong).toEqual([
      { loai: "MAIN", soLuong: 1, donGia: 120000, thanhTien: 120000, nguon: ["a" + n] },
      { loai: "TRUC", soLuong: 0.5, donGia: 90000, thanhTien: 45000, nguon: ["d1"] },
    ]);
  });
  it("[LT-TIEN-06] ví dụ ngày của chủ dự án: S TD + C T + T X (Rank 1) = 255.000", () => {
    expect(ca([hd("MAIN", "REGULAR", { gioBatDau: "09:45", gioKetThuc: "11:15" })], TRUC).tong + ca([], TRUC).tong + ca([]).tong).toBe(255000);
  });
  it("[LT-TIEN-07] học bù / học vượt / dạy thay đều là D (tiết đứng chính); Trial KHÔNG BAO GIỜ là D", () => {
    for (const l of ["MAKEUP", "ADVANCE", "SUBSTITUTE"] as const) expect(ca([hd("MAIN", l)])).toMatchObject({ ma: "D", tong: 120000 });
    const r = ca([hd("MAIN", "TRIAL")], TRUC);
    expect(r).toMatchObject({ ma: "T", tong: 90000 }); // buổi trial không chiếm nửa ca — chỉ là lớp phủ +TR
    expect(r.coTrial).toBe(true);
  });
  it("[LT-TIEN-08] buổi lệch chuẩn (60'/120') không ghi đè ⇒ POLICY_UNRESOLVED, 0đ cho tiết đó, không 0,6 / 1,2", () => {
    const lech = hd("MAIN", "MAKEUP", { donViTiet: { trangThai: "NEEDS_POLICY_DECISION", donVi: null, ghiDeId: null, lyDo: "THOI_LUONG_LECH_CHUAN" } });
    const r = ca([lech]);
    expect(r.tong).toBe(0);
    expect(r.canhBao).toContain("POLICY_UNRESOLVED");
    expect(r.dong.find((d) => d.loai === "MAIN")).toMatchObject({ soLuong: 0, thanhTien: 0 });
  });
  it("[LT-TIEN-09] buổi lệch chuẩn + có trực ⇒ tiền trực KHÔNG tính được (không đoán nửa ca hay cả ca)", () => {
    const lech = hd("MAIN", "MAKEUP", { donViTiet: { trangThai: "NEEDS_POLICY_DECISION", donVi: null, ghiDeId: null, lyDo: "THOI_LUONG_LECH_CHUAN" } });
    const r = ca([lech], TRUC);
    expect(r.dong.find((d) => d.loai === "TRUC")).toMatchObject({ thanhTien: null });
    expect(r.canhBao).toContain("TRUC_CHUA_TINH_DUOC");
  });
  it("[LT-TIEN-10] ghi đè đã duyệt (60' = 0,67 tiết) ⇒ tiền theo số tiết ghi đè", () => {
    const gd = hd("MAIN", "MAKEUP", { donViTiet: { trangThai: "GHI_DE", donVi: "0.67", ghiDeId: "g1" } });
    expect(ca([gd]).tong).toBe(80400);
  });
  it("[LT-TIEN-11] T + Trial: cộng nguyên số tiền hỗ trợ Trial đã xét (2 HV = 60k ⇒ 150k; 1 HV ⇒ 120k; 0 ⇒ 90k)", () => {
    expect(ca([], TRUC, 1, [{ soTien: 60000 }]).tong).toBe(150000);
    expect(ca([], TRUC, 1, [{ soTien: 30000 }]).tong).toBe(120000);
    expect(ca([], TRUC, 1, [{ soTien: 0 }]).tong).toBe(90000);
  });
  it("[LT-TIEN-12] quá 2 tiết trong ca ⇒ mã null + cảnh báo QUA_SO_TIET (không bịa tiền trực)", () => {
    const r = ca([hd("MAIN"), hd("MAIN"), hd("TA")], TRUC);
    expect(r.ma).toBeNull();
    expect(r.canhBao).toContain("QUA_SO_TIET");
  });
});

// ── Cổng hỗ trợ Trial (SR.QD.238 §6 + công tắc mới của chủ dự án 24/10/2026) ─────────────────────────────────────────
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const tr = (p: Partial<XetTrialVao> = {}): XetTrialVao => ({
  chinhSach: { bat: true, mucMoiHocVien: 30000 },
  chungNhanHieuLuc: true,
  phanCongTaoLuc: vn("2026-11-02", "10:00"),
  batDauBuoi: vn("2026-11-07", "20:00"),
  ketThucBuoi: vn("2026-11-07", "21:00"),
  nguoiPhanCong: "gv",
  gvCuaBuoi: "gv",
  buoiHuy: false,
  hocVien: [
    { ghiDanhId: "e1", hopLe: true, diemDanh: "PRESENT" },
    { ghiDanhId: "e2", hopLe: true, diemDanh: "PRESENT" },
  ],
  now: vn("2026-11-08", "09:00"),
  ...p,
});

describe("[LT-TR] hỗ trợ Trial — đủ mọi cổng mới tính", () => {
  it("[LT-TR-01] 2 HV PRESENT + đủ điều kiện ⇒ 60.000", () => {
    expect(xetHoTroTrial(tr())).toMatchObject({ trangThai: "DU_DIEU_KIEN", soCoMat: 2, soTien: 60000, lyDo: [] });
  });
  it("[LT-TR-02] 1 PRESENT + 1 ABSENT ⇒ 30.000", () => {
    const r = xetHoTroTrial(tr({ hocVien: [{ ghiDanhId: "e1", hopLe: true, diemDanh: "PRESENT" }, { ghiDanhId: "e2", hopLe: true, diemDanh: "ABSENT" }] }));
    expect(r).toMatchObject({ trangThai: "DU_DIEU_KIEN", soCoMat: 1, soTien: 30000 });
  });
  it("[LT-TR-03] tất cả vắng (đã GHI) ⇒ 0, lý do STUDENT_ABSENT", () => {
    const r = xetHoTroTrial(tr({ hocVien: [{ ghiDanhId: "e1", hopLe: true, diemDanh: "ABSENT" }] }));
    expect(r).toMatchObject({ soTien: 0, soCoMat: 0 });
    expect(r.lyDo).toContain("STUDENT_ABSENT");
  });
  it("[LT-TR-04] buổi đã qua mà còn bé CHƯA điểm danh ⇒ ATTENDANCE_PENDING — không coi là vắng, không tính tiền", () => {
    const r = xetHoTroTrial(tr({ hocVien: [{ ghiDanhId: "e1", hopLe: true, diemDanh: "PRESENT" }, { ghiDanhId: "e2", hopLe: true, diemDanh: null }] }));
    expect(r).toMatchObject({ trangThai: "CHO_DIEM_DANH", soTien: 0 });
    expect(r.lyDo).toContain("ATTENDANCE_PENDING");
  });
  it("[LT-TR-05] không có chứng nhận ⇒ 0 + CERTIFICATE_MISSING", () => {
    const r = xetHoTroTrial(tr({ chungNhanHieuLuc: false }));
    expect(r).toMatchObject({ trangThai: "KHONG_DU", soTien: 0 });
    expect(r.lyDo).toContain("CERTIFICATE_MISSING");
  });
  it("[LT-TR-06] chính sách tắt / không có bản phủ ngày buổi ⇒ 0 + TRIAL_POLICY_DISABLED", () => {
    expect(xetHoTroTrial(tr({ chinhSach: { bat: false, mucMoiHocVien: 30000 } })).lyDo).toContain("TRIAL_POLICY_DISABLED");
    expect(xetHoTroTrial(tr({ chinhSach: null })).lyDo).toContain("TRIAL_POLICY_DISABLED");
  });
  it("[LT-TR-07] phân công tạo SAU giờ bắt đầu buổi ⇒ 0 + NOT_ASSIGNED_BEFORE_SESSION", () => {
    const r = xetHoTroTrial(tr({ phanCongTaoLuc: vn("2026-11-07", "20:05") }));
    expect(r.lyDo).toContain("NOT_ASSIGNED_BEFORE_SESSION");
    expect(r.soTien).toBe(0);
  });
  it("[LT-TR-08] buổi huỷ ⇒ 0 + CASE_CANCELLED", () => {
    expect(xetHoTroTrial(tr({ buoiHuy: true }))).toMatchObject({ soTien: 0, lyDo: ["CASE_CANCELLED"] });
  });
  it("[LT-TR-09] người được phân công ≠ GV của buổi (đổi GV sau khi chốt) ⇒ NEEDS_REVIEW, không trả AI", () => {
    const r = xetHoTroTrial(tr({ gvCuaBuoi: "gv-khac" }));
    expect(r).toMatchObject({ trangThai: "NEEDS_REVIEW", soTien: 0 });
    expect(r.lyDo).toContain("TRIAL_TEACHER_MISMATCH");
  });
  it("[LT-TR-10] một bé hai dòng ⇒ đếm MỘT lần + DUPLICATE_CLAIM", () => {
    const r = xetHoTroTrial(tr({ hocVien: [{ ghiDanhId: "e1", hopLe: true, diemDanh: "PRESENT" }, { ghiDanhId: "e1", hopLe: true, diemDanh: "PRESENT" }] }));
    expect(r).toMatchObject({ soCoMat: 1, soTien: 30000 });
    expect(r.lyDo).toContain("DUPLICATE_CLAIM");
  });
  it("[LT-TR-11] bé đã rút / ghi danh không hợp lệ không được đếm, kể cả có dòng PRESENT", () => {
    const r = xetHoTroTrial(tr({ hocVien: [{ ghiDanhId: "e1", hopLe: false, diemDanh: "PRESENT" }, { ghiDanhId: "e2", hopLe: true, diemDanh: "PRESENT" }] }));
    expect(r).toMatchObject({ soCoMat: 1, soTien: 30000 });
  });
  it("[LT-TR-12] không còn bé nào ⇒ 0, không phải chờ điểm danh", () => {
    expect(xetHoTroTrial(tr({ hocVien: [] }))).toMatchObject({ soTien: 0, trangThai: "KHONG_DU" });
  });
  it("[LT-TR-13] buổi CHƯA diễn ra ⇒ DU_KIEN (chưa phát sinh công thực tế), số tiền dự kiến theo số bé đang ghi danh = 0", () => {
    const r = xetHoTroTrial(tr({ now: vn("2026-11-06", "09:00"), hocVien: [{ ghiDanhId: "e1", hopLe: true, diemDanh: null }] }));
    expect(r).toMatchObject({ trangThai: "CHUA_DIEN_RA", soTien: 0 });
  });
  it("[LT-TR-14] mức lấy từ dòng chính sách, không hằng số (40.000 ⇒ 2 bé = 80.000)", () => {
    expect(xetHoTroTrial(tr({ chinhSach: { bat: true, mucMoiHocVien: 40000 } })).soTien).toBe(80000);
  });
});
