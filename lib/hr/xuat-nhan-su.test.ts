/**
 * lib/hr/xuat-nhan-su.test.ts — cột của file xuất hồ sơ nhân sự.
 *
 * Đây là lưới canh một CỔNG RÒ, không phải canh định dạng. Hỏng ở đây nghĩa là lương hoặc
 * giấy tờ của người khác nằm trong một tệp đã gửi đi — không thu hồi được, và không có gì
 * báo lỗi: tệp vẫn mở được, vẫn đẹp, chỉ là thừa vài cột.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { getEmployeeFieldVisibility } from "@/lib/auth/permissions";
import { dungWorkbook } from "@/lib/cham-cong/xuat-bang";
import {
  cotXuatNhanSu,
  ngayVn,
  nhomBiCat,
  nhanBoPhan,
  nhanTrangThai,
  type DongNhanSu,
} from "./xuat-nhan-su";

const nhan = (roles: Parameters<typeof getEmployeeFieldVisibility>[0]) =>
  cotXuatNhanSu(getEmployeeFieldVisibility(roles)).map((c) => c.nhan);

describe("cotXuatNhanSu — cột ngoài quyền phải BIẾN MẤT", () => {
  it("SUPER_ADMIN thấy đủ mọi nhóm", () => {
    const c = nhan("SUPER_ADMIN");
    expect(c).toContain("Email");
    expect(c).toContain("Mức đóng BHXH");
    expect(c).toContain("Ngày sinh");
  });

  it("TEACHER (chỉ `basic`) KHÔNG có cột lương, KHÔNG có cột cá nhân", () => {
    const c = nhan("TEACHER");
    expect(c).toContain("Họ tên");
    expect(c).not.toContain("Ngạch lương");
    expect(c).not.toContain("Bậc lương");
    expect(c).not.toContain("Mức đóng BHXH");
    expect(c).not.toContain("Ngày sinh");
    expect(c).not.toContain("Địa chỉ");
    expect(c).not.toContain("Ghi chú");
  });

  it("ACCOUNTANT thấy LƯƠNG nhưng KHÔNG thấy cá nhân", () => {
    // Kế toán cần ngạch/bậc để tính lương, không cần ngày sinh và địa chỉ.
    const c = nhan("ACCOUNTANT");
    expect(c).toContain("Mức đóng BHXH");
    expect(c).not.toContain("Ngày sinh");
    expect(c).not.toContain("Liên hệ khẩn cấp");
  });

  it("CENTER_MANAGER thấy LIÊN HỆ nhưng KHÔNG thấy lương", () => {
    const c = nhan("CENTER_MANAGER");
    expect(c).toContain("Email");
    expect(c).not.toContain("Ngạch lương");
  });

  it("đa vai trò: TEACHER + ACCOUNTANT ⇒ hợp nhất quyền, có lương", () => {
    // `getEmployeeFieldVisibility` lấy UNION của các vai — cột phải theo đúng luật đó,
    // không được tự suy từ vai đầu tiên.
    expect(nhan(["TEACHER", "ACCOUNTANT"])).toContain("Mức đóng BHXH");
  });

  it("không vai nào ⇒ KHÔNG có cột nhóm nào, chỉ còn cột cơ bản", () => {
    const c = nhan([]);
    expect(c).not.toContain("Email");
    expect(c).not.toContain("Ngạch lương");
    expect(c).not.toContain("Ngày sinh");
    expect(c.length).toBeGreaterThan(0); // vẫn có cột cơ bản, không rỗng trơn
  });

  it("🔒 CCCD KHÔNG BAO GIỜ xuất, kể cả SUPER_ADMIN", () => {
    // Quyết định có chủ đích: màn hình và TỆP khác nhau ở chỗ tệp rời khỏi hệ thống được.
    // CCCD là trường tệ nhất để rò. HR cần thì mở hồ sơ trên màn.
    for (const r of ["SUPER_ADMIN", "HR", "ACCOUNTANT", "CENTER_MANAGER"]) {
      const c = nhan(r);
      expect(c.some((x) => /CCCD|CMND|căn cước|nationalId/i.test(x)), `${r} lọt CCCD`).toBe(false);
    }
  });

  it("cột mã NV và SĐT ép định dạng Text — Excel nuốt số 0 đầu", () => {
    const cot = cotXuatNhanSu(getEmployeeFieldVisibility("SUPER_ADMIN"));
    expect(cot.find((c) => c.nhan === "Mã NV")?.chuoi).toBe(true);
    expect(cot.find((c) => c.nhan === "Số điện thoại")?.chuoi).toBe(true);
  });
});

describe("nhomBiCat — tệp phải TỰ KHAI là nó không đầy đủ", () => {
  it("SUPER_ADMIN ⇒ không cắt gì", () => {
    expect(nhomBiCat(getEmployeeFieldVisibility("SUPER_ADMIN"))).toEqual([]);
  });

  it("TEACHER ⇒ khai đủ ba nhóm bị cắt", () => {
    // Người nhận tệp phải biết mình đang cầm bản rút gọn, kẻo họ kết luận "công ty không
    // có dữ liệu đó" và đi hỏi vòng.
    const c = nhomBiCat(getEmployeeFieldVisibility("TEACHER"));
    expect(c).toHaveLength(3);
    expect(c.join(" ")).toMatch(/lương/);
  });
});

describe("ngayVn", () => {
  it("in dd/mm/yyyy giờ VN", () => {
    // 2026-09-27T17:30Z = 28/09 lúc 00:30 giờ VN ⇒ phải ra NGÀY 28, không phải 27.
    expect(ngayVn(new Date("2026-09-27T17:30:00Z"))).toBe("28/09/2026");
  });

  it("mốc Unix 1970 ra RỖNG, không in 01/01/1970", () => {
    // `joinedAt` NULL từng bị ghi thành `0` — 13 hồ sơ trên prod, đo 08/09/2026. In ra là
    // một ngày trông như thật, và người đọc tin.
    expect(ngayVn(new Date(0))).toBe("");
    expect(ngayVn(null)).toBe("");
  });
});

describe("nhãn tiếng Việt", () => {
  it("bộ phận và trạng thái dịch đúng; mã lạ in nguyên, không ném", () => {
    expect(nhanBoPhan("HANH_CHANH_NHAN_SU")).toBe("Hành Chính Nhân Sự");
    expect(nhanBoPhan("MA_LA")).toBe("MA LA");
    expect(nhanTrangThai("ON_LEAVE")).toBe("Tạm nghỉ");
    expect(nhanTrangThai(null)).toBe("");
  });
});

/**
 * Lưới trên CHÍNH BYTES CỦA TỆP.
 *
 * Lưới cột ở trên chỉ chứng minh cái mảng cột. Thứ rời khỏi hệ thống là tệp — và giữa hai
 * thứ đó còn `dungWorkbook`. Đo tệp là đo thứ thật sự gửi đi.
 */
describe("tệp xuất thật — đọc lại bytes", () => {
  const nguoi: DongNhanSu = {
    employeeCode: "0042", fullName: "Nguyễn Văn A", jobTitle: "Giáo viên",
    department: "GIANG_DAY", centerName: "CS1", status: "ACTIVE",
    joinedAt: new Date("2024-03-01T00:00:00Z"), managerName: "Trần B",
    vaiTro: "Giáo viên", isActive: true,
    email: "a@satarobo.vn", phone: "0905123456",
    salaryRank: 3, salaryLevel: 2, bhxhBase: 5_000_000,
    dateOfBirth: new Date("1995-07-15T00:00:00Z"), gender: "MALE",
    contractType: "Xác định thời hạn", endDate: null,
    address: "12 Lê Lợi", emergencyContact: "0905999888", notes: "ghi chú",
  };

  const docSheet = async (vai: string) => {
    const v = { ...getEmployeeFieldVisibility(vai), contact: true };
    const wb = dungWorkbook<DongNhanSu>({
      tieuDe: "HỒ SƠ NHÂN SỰ", tenSheet: "Nhan su",
      cot: cotXuatNhanSu(v), dong: [nguoi], watermark: "test",
    });
    const buf = await wb.xlsx.writeBuffer();
    const lai = new ExcelJS.Workbook();
    await lai.xlsx.load(buf as ArrayBuffer);
    const ws = lai.getWorksheet("Nhan su")!;
    const oChu: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => oChu.push(String(c.value ?? ""))));
    return oChu.join("");
  };

  it("tệp của TEACHER KHÔNG chứa số lương ở bất kỳ ô nào", async () => {
    const chu = await docSheet("TEACHER");
    expect(chu).toContain("Nguyễn Văn A");
    expect(chu).not.toContain("Mức đóng BHXH");
    expect(chu).not.toContain("5000000");
    expect(chu).not.toContain("12 Lê Lợi"); // địa chỉ thuộc nhóm `personal`
  });

  it("tệp của HR có lương, và mã NV giữ số 0 đầu", async () => {
    const chu = await docSheet("HR");
    expect(chu).toContain("Mức đóng BHXH");
    // "0042" mất số 0 đầu là cột đối chiếu với Sheet/MISA hỏng im lặng.
    expect(chu).toContain("0042");
  });
});
