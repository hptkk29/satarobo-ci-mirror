/**
 * [STN-*] — kế hoạch đưa thông tin đã khai ở trang công khai sang tài khoản cổng (`keHoachSauNhan`, THUẦN). Mốc năm TIÊM từ ngoài (luật 19).
 *   [STN-01] khách mới: đặt tên tài khoản + tạo sổ (chủ sổ = phụ huynh, đúng vai) + bé vào LeadChild và vào sổ; KHÔNG có học viên nào
 *   [STN-02] tài khoản đã có tên ⇒ KHÔNG đè (đối chứng dương của [STN-01])
 *   [STN-03] lặp lại (đã có LeadChild + đã có thành viên) ⇒ không tạo thêm gì — idempotent
 *   [STN-04] bé trùng học viên THẬT của tài khoản ⇒ nối studentId vào sổ, KHÔNG tạo LeadChild
 *   [STN-05] bài chưa nối phiếu ⇒ không LeadChild nhưng vẫn vào sổ
 *   [STN-06] chuẩn hoá tên bỏ dấu/hoa thường; khai trùng tên trong cùng bài ⇒ gộp một
 *   [STN-07] sổ đầy chỗ ⇒ cắt theo chỗ còn lại (sổ mới chiếm 1 chỗ cho chủ sổ)
 *   [STN-W1] dây nối: nhan-prisma.ts gọi bước này đúng một lần; bước này không tạo học viên
 *   [STN-08] vai chủ sổ theo vai đã khai; lớp/nhãn lớp; tuổi; tên dài bị cắt đúng độ dài sổ
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chuanTen,
  keHoachSauNhan,
  lopCuaSo,
  nhanLopTrenPhieu,
  vaiChuSoTuVaiDaKhai,
  type HienCo,
  type NguoiLonDaKhai,
  type TreDaKhai,
} from "./thong-tin-sau-nhan";
import { SO_THANH_VIEN_TOI_DA_SO, TEN_TOI_DA } from "./so-gia-dinh/validators";

const NAM_NAY = 2026;
const PH: NguoiLonDaKhai = { ten: "Nguyễn Thu Hà", namSinh: 1988, vaiTro: "ME" };
const BE: TreDaKhai = { ten: "Phạm Bảo Châu", namSinh: 2016, bacHoc: "4" };
const TRONG: HienCo = { tenTaiKhoan: null, conTrenPhieu: [], coPhieu: true, hocVien: [], so: null };

describe("[STN-01] khách mới", () => {
  const kh = keHoachSauNhan({ nguoiLon: PH, tre: [BE], hienCo: TRONG, namNay: NAM_NAY });
  it("đặt tên tài khoản bằng tên phụ huynh đã khai", () => {
    expect(kh.datTenTaiKhoan).toBe("Nguyễn Thu Hà");
  });
  it("tạo sổ với chủ sổ = phụ huynh, đúng vai và năm sinh", () => {
    expect(kh.taoSo).toEqual({ tenChuSo: "Nguyễn Thu Hà", vaiTroChuSo: "me", namSinhChuSo: 1988 });
  });
  it("bé vào LeadChild (tuổi, nhãn lớp, ghi chú nguồn) và vào sổ — không nối học viên", () => {
    expect(kh.leadChildMoi).toEqual([
      { fullName: "Phạm Bảo Châu", ageYears: 10, gradeLevel: "Lớp 4", note: "Từ bài DISC trên trang công khai (năm sinh 2016)." },
    ]);
    expect(kh.thanhVienMoi).toEqual([{ ten: "Phạm Bảo Châu", namSinh: 2016, lop: "4", studentId: null }]);
  });
  it("kết quả không có chỗ nào cho học viên thật", () => {
    expect(JSON.stringify(kh)).not.toMatch(/student(?!Id)/i);
  });
});

describe("[STN-02] không đè tên người dùng đã có", () => {
  it("đã có tên ⇒ datTenTaiKhoan = null", () => {
    expect(keHoachSauNhan({ nguoiLon: PH, tre: [BE], hienCo: { ...TRONG, tenTaiKhoan: "Mẹ Su" }, namNay: NAM_NAY }).datTenTaiKhoan).toBeNull();
  });
  it("tên chỉ có khoảng trắng tính là CHƯA có tên", () => {
    expect(keHoachSauNhan({ nguoiLon: PH, tre: [], hienCo: { ...TRONG, tenTaiKhoan: "   " }, namNay: NAM_NAY }).datTenTaiKhoan).toBe("Nguyễn Thu Hà");
  });
  it("không khai tên phụ huynh ⇒ không đặt tên", () => {
    expect(keHoachSauNhan({ nguoiLon: null, tre: [], hienCo: TRONG, namNay: NAM_NAY }).datTenTaiKhoan).toBeNull();
  });
});

describe("[STN-03] lặp lại không tạo thêm", () => {
  it("đã có LeadChild + thành viên + sổ ⇒ kế hoạch rỗng", () => {
    const co: HienCo = { tenTaiKhoan: "Nguyễn Thu Hà", conTrenPhieu: ["Phạm Bảo Châu"], coPhieu: true, hocVien: [], so: { thanhVien: [{ ten: "Nguyễn Thu Hà" }, { ten: "Phạm Bảo Châu" }] } };
    expect(keHoachSauNhan({ nguoiLon: PH, tre: [BE], hienCo: co, namNay: NAM_NAY })).toEqual({ datTenTaiKhoan: null, leadChildMoi: [], taoSo: null, thanhVienMoi: [] });
  });
});

describe("[STN-04] bé trùng học viên thật của tài khoản", () => {
  it("nối studentId vào sổ; KHÔNG tạo LeadChild", () => {
    const kh = keHoachSauNhan({ nguoiLon: PH, tre: [BE], hienCo: { ...TRONG, hocVien: [{ id: "hv-1", ten: "pham bao chau" }] }, namNay: NAM_NAY });
    expect(kh.leadChildMoi).toEqual([]);
    expect(kh.thanhVienMoi).toEqual([{ ten: "Phạm Bảo Châu", namSinh: 2016, lop: "4", studentId: "hv-1" }]);
  });
  it("đối chứng: học viên TÊN KHÁC ⇒ không nối, vẫn có LeadChild", () => {
    const kh = keHoachSauNhan({ nguoiLon: PH, tre: [BE], hienCo: { ...TRONG, hocVien: [{ id: "hv-9", ten: "Lê Minh" }] }, namNay: NAM_NAY });
    expect(kh.leadChildMoi).toHaveLength(1);
    expect(kh.thanhVienMoi[0]?.studentId).toBeNull();
  });
});

describe("[STN-05] bài chưa nối phiếu", () => {
  it("không LeadChild; vẫn vào sổ", () => {
    const kh = keHoachSauNhan({ nguoiLon: PH, tre: [BE], hienCo: { ...TRONG, coPhieu: false }, namNay: NAM_NAY });
    expect(kh.leadChildMoi).toEqual([]);
    expect(kh.thanhVienMoi).toHaveLength(1);
  });
});

describe("[STN-06] chuẩn hoá tên", () => {
  it("bỏ dấu, hoa thường, gộp khoảng trắng, đ → d", () => {
    expect(chuanTen("  Đỗ  Bảo   CHÂU ")).toBe("do bao chau");
    expect(chuanTen(null)).toBe("");
  });
  it("hai lần khai cùng một bé trong một bài ⇒ gộp một", () => {
    const kh = keHoachSauNhan({ nguoiLon: PH, tre: [BE, { ...BE, ten: "pham bao chau" }], hienCo: TRONG, namNay: NAM_NAY });
    expect(kh.thanhVienMoi).toHaveLength(1);
    expect(kh.leadChildMoi).toHaveLength(1);
  });
  it("hai bé khác tên ⇒ hai bé", () => {
    const kh = keHoachSauNhan({ nguoiLon: PH, tre: [BE, { ten: "Phạm Đức Anh", namSinh: 2013, bacHoc: "6" }], hienCo: TRONG, namNay: NAM_NAY });
    expect(kh.thanhVienMoi.map((m) => m.ten)).toEqual(["Phạm Bảo Châu", "Phạm Đức Anh"]);
  });
});

describe("[STN-07] sổ đầy chỗ", () => {
  const nhieuBe = Array.from({ length: 12 }, (_, i): TreDaKhai => ({ ten: `Bé số ${i + 1}`, namSinh: 2016, bacHoc: "4" }));
  it("sổ MỚI: chủ sổ chiếm một chỗ ⇒ còn (tối đa − 1) bé", () => {
    const kh = keHoachSauNhan({ nguoiLon: PH, tre: nhieuBe, hienCo: TRONG, namNay: NAM_NAY });
    expect(kh.thanhVienMoi).toHaveLength(SO_THANH_VIEN_TOI_DA_SO - 1);
  });
  it("sổ CÓ SẴN gần đầy ⇒ chỉ thêm đúng số chỗ còn lại; đầy hẳn ⇒ không thêm", () => {
    const co = (n: number): HienCo => ({ ...TRONG, so: { thanhVien: Array.from({ length: n }, (_, i) => ({ ten: `TV ${i}` })) } });
    expect(keHoachSauNhan({ nguoiLon: PH, tre: nhieuBe, hienCo: co(SO_THANH_VIEN_TOI_DA_SO - 2), namNay: NAM_NAY }).thanhVienMoi).toHaveLength(2);
    expect(keHoachSauNhan({ nguoiLon: PH, tre: nhieuBe, hienCo: co(SO_THANH_VIEN_TOI_DA_SO), namNay: NAM_NAY }).thanhVienMoi).toHaveLength(0);
  });
});

describe("[STN-08] vai, lớp, tuổi, độ dài", () => {
  it("vai chủ sổ", () => {
    expect(vaiChuSoTuVaiDaKhai("BO")).toBe("bo");
    expect(vaiChuSoTuVaiDaKhai("ME")).toBe("me");
    expect(vaiChuSoTuVaiDaKhai("NGUOI_GIAM_HO")).toBe("nguoi-than");
    expect(vaiChuSoTuVaiDaKhai(null)).toBe("nguoi-than");
    expect(vaiChuSoTuVaiDaKhai("LA")).toBe("nguoi-than");
  });
  it("lớp của sổ và nhãn lớp trên phiếu", () => {
    expect(lopCuaSo("MN")).toBe("mam-non");
    expect(lopCuaSo("12")).toBe("12");
    expect(lopCuaSo("13")).toBeNull();
    expect(lopCuaSo("0")).toBeNull();
    expect(lopCuaSo(null)).toBeNull();
    expect(nhanLopTrenPhieu("MN")).toBe("Mầm non");
    expect(nhanLopTrenPhieu("7")).toBe("Lớp 7");
    expect(nhanLopTrenPhieu("abc")).toBeNull();
  });
  it("năm sinh ngoài biên ⇒ không tính tuổi; tên dài bị cắt đúng TEN_TOI_DA cho sổ, GIỮ NGUYÊN trên phiếu", () => {
    const dai = "N".repeat(TEN_TOI_DA + 20);
    const kh = keHoachSauNhan({ nguoiLon: { ten: dai, namSinh: null, vaiTro: null }, tre: [{ ten: dai + "x", namSinh: 2030, bacHoc: null }], hienCo: TRONG, namNay: NAM_NAY });
    expect(kh.taoSo?.tenChuSo).toHaveLength(TEN_TOI_DA);
    expect(kh.thanhVienMoi[0]?.ten).toHaveLength(TEN_TOI_DA);
    expect(kh.leadChildMoi[0]?.ageYears).toBeNull();
    expect(kh.leadChildMoi[0]?.fullName).toBe(dai + "x");
  });
  it("không khai phụ huynh ⇒ chủ sổ tên dự phòng «Phụ huynh»", () => {
    expect(keHoachSauNhan({ nguoiLon: null, tre: [BE], hienCo: TRONG, namNay: NAM_NAY }).taoSo?.tenChuSo).toBe("Phụ huynh");
  });
});

describe("[STN-W1] dây nối vào luồng nhận bài", () => {
  // Bước này chạy ở `sauKhiNhan` (sau OTP + mã). Test hành vi gọi thẳng `dongBoThongTinSauNhan` nên gỡ lời gọi khỏi luồng nhận là KHÔNG ca hành vi nào đỏ.
  const nguon = readFileSync(resolve(process.cwd(), "lib/disc/nhan-prisma.ts"), "utf8").replace(/\r\n/g, "\n");
  it("nhan-prisma.ts gọi dongBoThongTinSauNhan đúng một lần, bên trong Promise.allSettled của sauKhiNhan", () => {
    expect(nguon.match(/dongBoThongTinSauNhan\(\{ submissionId: p\.submissionId \}\)/g) ?? []).toHaveLength(1);
    expect(nguon).toMatch(/Promise\.allSettled\(\[[^\]]*dongBoThongTinSauNhan\(/);
  });
  it("bước này KHÔNG tạo học viên: mã của nó không có lời gọi student.create", () => {
    for (const f of ["lib/disc/thong-tin-sau-nhan.ts", "lib/disc/thong-tin-sau-nhan-db.ts"]) {
      const t = readFileSync(resolve(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(t, f).not.toMatch(/student\.(?:create|createMany|upsert)\b/);
    }
  });
});
