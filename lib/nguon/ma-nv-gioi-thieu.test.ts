/**
 * Ca [MNV-*] — cột "Mã NV giới thiệu" của Excel nhập lead (THUẦN, không DB). Đặc tả: `lib/nguon/ma-nv-gioi-thieu.ts`.
 *
 * Fixture mang hình dạng dữ liệu thật: mã chữ thường, dạng đảo đoạn `nv.sr.002`, và đợt hoán vị mã 04/09/2026 18:08–18:11 giờ VN
 * (= 11:08–11:11Z). Ngày TUYỆT ĐỐI (luật 19): hàm thuần không đọc đồng hồ.
 */
import type { SourceReferrerRequirement } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  dungBangTraMaNv,
  gopMaCungSdt,
  ngayGiaiMaTuDongDangKy,
  quyetDinhMaNvGioiThieu,
  type BangTraMaNv,
  type NhomYeuCau,
} from "./ma-nv-gioi-thieu";
import type { DoiMa } from "./ma-nhan-vien";

const d = (iso: string) => new Date(iso);
const SAU_DOI = d("2026-10-09T03:00:00.000Z");

const NHAN_VIEN = [
  { id: "E_HUE", employeeCode: "SR.NV.002", status: "ACTIVE" },
  { id: "E_LINH", employeeCode: "SR.NV.006", status: "ACTIVE" },
  { id: "E_NGHI", employeeCode: "SR.NV.010", status: "RESIGNED" },
  { id: "E_PHEP", employeeCode: "SR.NV.011", status: "ON_LEAVE" },
  { id: "E_BI_DUOI", employeeCode: "SR.NV.012", status: "TERMINATED" },
] as const;

/** Nhóm có thật của danh mục: EMPLOYEE_REFERRAL cần NHÂN SỰ; còn lại không. Quyết định theo THUỘC TÍNH, không theo mã. */
const NHOM: NhomYeuCau = new Map<string, SourceReferrerRequirement>([
  ["EMPLOYEE_REFERRAL", "EMPLOYEE"],
  ["PAID_ADS", "NONE"],
  ["PARENT_REFERRAL", "PARENT"],
  ["WALK_IN", "NONE"],
  ["CENTER_ORGANIC", "NONE"],
  ["OTHER", "NONE"],
  ["UNKNOWN", "NONE"],
]);

const bang = (lichSu: readonly DoiMa[] = [], nv: readonly { id: string; employeeCode: string; status: string }[] = NHAN_VIEN): BangTraMaNv =>
  dungBangTraMaNv(nv, lichSu);

const hoi = (maTho: string | null, nhanKhai: string | null, o: { ngay?: Date; b?: BangTraMaNv; nhom?: NhomYeuCau } = {}) =>
  quyetDinhMaNvGioiThieu({
    maTho,
    nhanKhai,
    ngayGiaiMa: o.ngay ?? SAU_DOI,
    bayGio: SAU_DOI,
    bang: o.b ?? bang(),
    nhomYeuCau: o.nhom ?? NHOM,
    nhomNhanSu: "EMPLOYEE_REFERRAL",
  });

describe("[MNV-01] ô trống ⇒ hành vi cũ (không có gì để làm)", () => {
  it("null, rỗng, toàn khoảng trắng ⇒ KHONG_CO — kể cả khi nhãn nguồn là thứ lạ", () => {
    expect(hoi(null, null)).toEqual({ kieu: "KHONG_CO" });
    expect(hoi("", "Ads")).toEqual({ kieu: "KHONG_CO" });
    expect(hoi("   ", "nhãn lạ hoắc")).toEqual({ kieu: "KHONG_CO" });
  });
});

describe("[MNV-02] mã giải được + nhãn nguồn KHÔNG mâu thuẫn ⇒ DUNG (đối chứng dương)", () => {
  it("nhãn nguồn để TRỐNG + mã đúng ⇒ nhân sự đó", () => {
    expect(hoi("SR.NV.002", null)).toEqual({ kieu: "DUNG", employeeId: "E_HUE" });
  });
  it("nhãn thuộc nhóm kiểu EMPLOYEE (bảng 28 nhãn: 'Quản Lý Trung Tâm', 'Sale tự kiếm') + mã đúng ⇒ nhân sự đó", () => {
    expect(hoi("SR.NV.002", "Quản Lý Trung Tâm")).toEqual({ kieu: "DUNG", employeeId: "E_HUE" });
    expect(hoi("SR.NV.006", "  sale TỰ kiếm ")).toEqual({ kieu: "DUNG", employeeId: "E_LINH" });
  });
  it("mã chữ thường / dạng đảo đoạn 'nv.sr.002' (biểu mẫu cũ) cũng giải được", () => {
    expect(hoi("nv.sr.002", null)).toEqual({ kieu: "DUNG", employeeId: "E_HUE" });
    expect(hoi("  sr.nv.002 ", null)).toEqual({ kieu: "DUNG", employeeId: "E_HUE" });
  });
  it("nhân sự ON_LEAVE vẫn được claim (cùng luật D13 của thu-thap-tin-hieu)", () => {
    expect(hoi("SR.NV.011", null)).toEqual({ kieu: "DUNG", employeeId: "E_PHEP" });
  });
});

describe("[MNV-03] KHÔNG ÉP NGUỒN — nhãn thuộc nhóm khác ⇒ bỏ mã, KHÔNG ghi người", () => {
  it("'Ads' + mã đúng ⇒ BO_QUA (nguồn quảng cáo của dòng giữ nguyên)", () => {
    const r = hoi("SR.NV.002", "Ads");
    expect(r.kieu).toBe("BO_QUA");
    if (r.kieu === "BO_QUA") expect(r.lyDo).toMatch(/Ads/);
  });
  it("'Giới thiệu' (phụ huynh giới thiệu) + mã ⇒ BO_QUA — nhóm PH không phải nhóm nhân sự", () => {
    expect(hoi("SR.NV.002", "Giới thiệu").kieu).toBe("BO_QUA");
  });
  it("nhãn LẠ (ngoài bảng 28 nhãn) + mã ⇒ BO_QUA — không đoán nhãn đó là nhóm gì", () => {
    expect(hoi("SR.NV.002", "Nguồn mới tinh").kieu).toBe("BO_QUA");
  });
  it("QUYẾT ĐỊNH THEO THUỘC TÍNH, không theo mã: nếu nhóm EMPLOYEE_REFERRAL không còn kiểu EMPLOYEE thì nhãn 'Sale tự kiếm' cũng không cho mã có tác dụng", () => {
    const nhom = new Map<string, SourceReferrerRequirement>(NHOM);
    nhom.set("EMPLOYEE_REFERRAL", "NONE");
    expect(hoi("SR.NV.002", "Sale tự kiếm", { nhom }).kieu).toBe("BO_QUA");
    // Đối chứng dương nằm ở [MNV-02]: cùng nhãn, nhóm còn kiểu EMPLOYEE ⇒ DUNG.
  });
});

describe("[MNV-04] mã KHÔNG giải được ⇒ BO_QUA, không bao giờ đoán người", () => {
  it("mã không có trong hệ thống", () => {
    const r = hoi("SR.NV.999", null);
    expect(r.kieu).toBe("BO_QUA");
    if (r.kieu === "BO_QUA") expect(r.lyDo).toMatch(/SR\.NV\.999/);
  });
  it("ô chứa TÊN người (không phải mã) ⇒ BO_QUA — không bao giờ khớp theo tên", () => {
    for (const ten of ["Nguyễn Thị Huệ", "Huệ", "hue", "SR.NV"]) expect(hoi(ten, null).kieu).toBe("BO_QUA");
  });
  it("nhân sự đã nghỉ (RESIGNED / TERMINATED) ⇒ BO_QUA — không claim MỚI cho người đã nghỉ (D13)", () => {
    const a = hoi("SR.NV.010", null);
    const b = hoi("SR.NV.012", null);
    expect(a.kieu).toBe("BO_QUA");
    expect(b.kieu).toBe("BO_QUA");
    if (a.kieu === "BO_QUA") expect(a.lyDo).toMatch(/nghỉ|không còn/i);
  });
});

describe("[MNV-05] MƠ HỒ ⇒ BO_QUA — hai nhân viên cùng một mã sau khi chuẩn hoá", () => {
  // 'NV.SR.002' (biểu mẫu cũ) và 'SR.NV.002' cùng chuẩn hoá về 'SR.NV.002': không ai biết là ai. Bản cũ ghi đè Map im lặng.
  const nv = [
    { id: "E_A", employeeCode: "SR.NV.002", status: "ACTIVE" },
    { id: "E_B", employeeCode: "NV.SR.002", status: "ACTIVE" },
    { id: "E_C", employeeCode: "SR.NV.006", status: "ACTIVE" },
  ];
  it("mã trùng ⇒ BO_QUA, nêu rõ là mơ hồ; mã không trùng vẫn giải bình thường", () => {
    const b = dungBangTraMaNv(nv, []);
    const r = hoi("SR.NV.002", null, { b });
    expect(r.kieu).toBe("BO_QUA");
    if (r.kieu === "BO_QUA") expect(r.lyDo).toMatch(/nhiều nhân viên|mơ hồ/i);
    expect(hoi("SR.NV.006", null, { b })).toEqual({ kieu: "DUNG", employeeId: "E_C" });
  });
});

describe("[MNV-06] GIẢI THEO NGÀY — chịu đổi mã (hoán vị 04/09)", () => {
  const lichSu: DoiMa[] = [
    { employeeId: "E_LINH", maCu: "SR.NV.002", maMoi: "SR.NV.006", luc: d("2026-09-04T11:08:30.000Z") },
    { employeeId: "E_HUE", maCu: "SR.NV.004", maMoi: "SR.NV.002", luc: d("2026-09-04T11:09:10.000Z") },
  ];
  const nv = [
    { id: "E_HUE", employeeCode: "SR.NV.002", status: "ACTIVE" },
    { id: "E_LINH", employeeCode: "SR.NV.006", status: "ACTIVE" },
  ];
  const b = dungBangTraMaNv(nv, lichSu);

  it("cùng một mã, hai ngày ⇒ hai người", () => {
    expect(hoi("SR.NV.002", null, { b, ngay: d("2026-09-01T03:00:00.000Z") })).toEqual({ kieu: "DUNG", employeeId: "E_LINH" });
    expect(hoi("SR.NV.002", null, { b, ngay: d("2026-09-05T03:00:00.000Z") })).toEqual({ kieu: "DUNG", employeeId: "E_HUE" });
  });
  it("hôm nay: mã cũ SR.NV.004 chưa ai giữ ⇒ BO_QUA; ngày trước đợt đổi nó là E_HUE", () => {
    expect(hoi("SR.NV.004", null, { b, ngay: SAU_DOI }).kieu).toBe("BO_QUA");
    expect(hoi("SR.NV.004", null, { b, ngay: d("2026-09-01T03:00:00.000Z") })).toEqual({ kieu: "DUNG", employeeId: "E_HUE" });
  });
});

describe("[MNV-06b] ngày giải MÃ và ngày xét NHÃN là HAI thứ khác nhau", () => {
  it("nhãn 'Khác' chỉ chốt đích theo phiếu TRƯỚC 06/10: xét nhãn theo bayGio (hôm nay), KHÔNG theo ngày cũ của dòng", () => {
    // Dòng đăng ký ghi ngày 01/09 (trước mốc) nhưng đang được nhập hôm nay (sau mốc): lõi quy nguồn xét nhãn lúc nhập ⇒ OTHER, không phải nhóm nhân sự.
    const r = quyetDinhMaNvGioiThieu({
      maTho: "SR.NV.002",
      nhanKhai: "Khác",
      ngayGiaiMa: d("2026-09-01T03:00:00.000Z"),
      bayGio: SAU_DOI,
      bang: bang(),
      nhomYeuCau: NHOM,
      nhomNhanSu: "EMPLOYEE_REFERRAL",
    });
    expect(r.kieu).toBe("BO_QUA");
  });
});

describe("[MNV-07] nhiều dòng cùng SĐT ⇒ MỘT lead ⇒ mã phải thống nhất", () => {
  it("không dòng nào có mã ⇒ không có mã", () => {
    expect(gopMaCungSdt([null, "", "  "])).toEqual({ ma: null, khacNhau: false });
  });
  it("chỉ MỘT dòng có mã ⇒ lấy mã đó (các dòng khác để trống)", () => {
    expect(gopMaCungSdt([null, "SR.NV.002", ""])).toEqual({ ma: "SR.NV.002", khacNhau: false });
  });
  it("cùng mã ghi hai kiểu (chữ thường / đảo đoạn) ⇒ vẫn là MỘT mã", () => {
    expect(gopMaCungSdt(["sr.nv.002", "NV.SR.002"])).toEqual({ ma: "SR.NV.002", khacNhau: false });
  });
  it("HAI mã khác nhau ⇒ khacNhau, KHÔNG lấy dòng đầu (kết quả không được phụ thuộc thứ tự dòng)", () => {
    const a = gopMaCungSdt(["SR.NV.002", "SR.NV.006"]);
    const b = gopMaCungSdt(["SR.NV.006", "SR.NV.002"]);
    expect(a).toEqual({ ma: null, khacNhau: true });
    expect(b).toEqual({ ma: null, khacNhau: true });
  });
});

describe("[MNV-08] ngày giải mã của file ĐĂNG KÝ — lấy từ cột 'Ngày' của phiếu, không phải hôm nay", () => {
  const BAY_GIO = d("2026-10-09T03:00:00.000Z");

  it("không có ngày nào đọc được ⇒ hôm nay (bayGio)", () => {
    expect(ngayGiaiMaTuDongDangKy([], BAY_GIO)).toEqual(BAY_GIO);
    expect(ngayGiaiMaTuDongDangKy([null, "", "tuần trước", "31/02/2026", "1/13/2026"], BAY_GIO)).toEqual(BAY_GIO);
  });

  it("dd/mm/yyyy ⇒ giữa trưa ngày đó theo giờ VN (05:00Z); nhiều con thì lấy ngày SỚM NHẤT", () => {
    expect(ngayGiaiMaTuDongDangKy(["03/09/2026"], BAY_GIO)).toEqual(d("2026-09-03T05:00:00.000Z"));
    expect(ngayGiaiMaTuDongDangKy(["20/09/2026", "03/09/2026", null], BAY_GIO)).toEqual(d("2026-09-03T05:00:00.000Z"));
    expect(ngayGiaiMaTuDongDangKy(["3/9/2026"], BAY_GIO)).toEqual(d("2026-09-03T05:00:00.000Z"));
  });

  it("ngày TƯƠNG LAI (gõ nhầm năm) không được dùng — nếu dùng, mã mới đổi sau đó sẽ giải sai ra người cũ", () => {
    expect(ngayGiaiMaTuDongDangKy(["03/09/2027"], BAY_GIO)).toEqual(BAY_GIO);
    // Lẫn một ngày hợp lệ: bỏ ngày tương lai, giữ ngày hợp lệ.
    expect(ngayGiaiMaTuDongDangKy(["03/09/2027", "10/08/2026"], BAY_GIO)).toEqual(d("2026-08-10T05:00:00.000Z"));
  });
});
