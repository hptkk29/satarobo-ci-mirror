// @vitest-environment node
/**
 * [DYN-SALE-*] — chọn Sale phụ trách của phụ huynh giới thiệu (ảnh chụp lúc ghi nhận). THUẦN; `bayGio` truyền vào (luật 19).
 * Fixture mang HÌNH DẠNG THẬT: nhiều học viên không có `leadId` (đo: `Student.leadId` thường NULL), hai lead cùng phụ huynh khác ngày.
 */
import { describe, expect, it } from "vitest";
import { chonSaleCuaPhuHuynh, type HocVienCuaPhuHuynh, type LeadCuaHocVien } from "./sale-cua-phu-huynh";

const BAY_GIO = new Date("2026-10-10T03:00:00.000Z");
const d = (iso: string) => new Date(`${iso}T03:00:00.000Z`);

function lead(id: string, p: Partial<LeadCuaHocVien> = {}): LeadCuaHocVien {
  return { id, convertedById: null, assignedToId: null, convertedAt: null, createdAt: d("2026-06-01"), deletedAt: null, ...p };
}
function hv(id: string, parentUserId: string | null, l: LeadCuaHocVien | null): HocVienCuaPhuHuynh {
  return { id, parentUserId, lead: l };
}

describe("[DYN-SALE-01] đúng học viên được chọn thắng; không có Sale mới xét bé cùng phụ huynh", () => {
  it("bé được chọn có lead → Sale của lead ấy, dù bé khác cùng phụ huynh có lead MỚI hơn", () => {
    const ds = [
      hv("s1", "ph", lead("l1", { convertedById: "sale-X", createdAt: d("2026-03-01") })),
      hv("s2", "ph", lead("l2", { convertedById: "sale-Y", createdAt: d("2026-09-01") })),
    ];
    expect(chonSaleCuaPhuHuynh({ studentId: "s1", parentUserId: "ph", hocVien: ds, bayGio: BAY_GIO })).toBe("sale-X");
    // đối chứng dương: không chọn bé nào ⇒ lead gần nhất của phụ huynh
    expect(chonSaleCuaPhuHuynh({ studentId: null, parentUserId: "ph", hocVien: ds, bayGio: BAY_GIO })).toBe("sale-Y");
  });

  it("bé được chọn KHÔNG có leadId (hình dạng phổ biến) → rơi về bé cùng phụ huynh (parentUserId lấy từ chính bé khi người nhập không khai)", () => {
    const ds = [hv("s1", "ph", null), hv("s2", "ph", lead("l2", { assignedToId: "sale-Y" }))];
    expect(chonSaleCuaPhuHuynh({ studentId: "s1", parentUserId: null, hocVien: ds, bayGio: BAY_GIO })).toBe("sale-Y");
  });

  it("không có học viên nào có lead → null (người gọi ghi cờ xem tay, KHÔNG đoán)", () => {
    expect(chonSaleCuaPhuHuynh({ studentId: "s1", parentUserId: "ph", hocVien: [hv("s1", "ph", null), hv("s2", "ph", null)], bayGio: BAY_GIO })).toBeNull();
    expect(chonSaleCuaPhuHuynh({ studentId: null, parentUserId: null, hocVien: [], bayGio: BAY_GIO })).toBeNull();
  });

  it("phụ huynh khác KHÔNG lẫn vào", () => {
    const ds = [hv("s9", "ph-khac", lead("l9", { convertedById: "sale-Z" }))];
    expect(chonSaleCuaPhuHuynh({ studentId: null, parentUserId: "ph", hocVien: ds, bayGio: BAY_GIO })).toBeNull();
  });
});

describe("[DYN-SALE-02] lead gần nhất, tất định, không đọc tương lai", () => {
  it("hai lead cùng phụ huynh khác ngày → lead GẦN NHẤT thắng (mốc = convertedAt ?? createdAt)", () => {
    const ds = [
      hv("s1", "ph", lead("l1", { convertedById: "sale-cu", createdAt: d("2026-01-01") })),
      hv("s2", "ph", lead("l2", { convertedById: "sale-moi", createdAt: d("2026-01-02"), convertedAt: d("2026-08-01") })),
    ];
    expect(chonSaleCuaPhuHuynh({ studentId: null, parentUserId: "ph", hocVien: ds, bayGio: BAY_GIO })).toBe("sale-moi");
  });

  it("lead tạo/chốt SAU bayGio bị loại (ảnh chụp không đọc tương lai)", () => {
    const ds = [
      hv("s1", "ph", lead("l1", { convertedById: "sale-luc-do", createdAt: d("2026-05-01") })),
      hv("s2", "ph", lead("l2", { convertedById: "sale-sau-nay", createdAt: d("2026-11-01") })),
    ];
    expect(chonSaleCuaPhuHuynh({ studentId: null, parentUserId: "ph", hocVien: ds, bayGio: BAY_GIO })).toBe("sale-luc-do");
  });

  it("hoà mốc → lead.id nhỏ hơn (kết quả không phụ thuộc thứ tự nạp)", () => {
    const a = hv("s1", "ph", lead("lb", { convertedById: "sale-B" }));
    const b = hv("s2", "ph", lead("la", { convertedById: "sale-A" }));
    expect(chonSaleCuaPhuHuynh({ studentId: null, parentUserId: "ph", hocVien: [a, b], bayGio: BAY_GIO })).toBe("sale-A");
    expect(chonSaleCuaPhuHuynh({ studentId: null, parentUserId: "ph", hocVien: [b, a], bayGio: BAY_GIO })).toBe("sale-A");
  });

  it("convertedById ưu tiên hơn assignedToId; lead xoá mềm bị loại; lead không có Sale thì xét lead cũ hơn", () => {
    const ds = [
      hv("s1", "ph", lead("l1", { convertedById: "sale-chot", assignedToId: "sale-cham" })),
      hv("s2", "ph", lead("l2", { convertedById: "sale-da-xoa", createdAt: d("2026-09-01"), deletedAt: d("2026-09-02") })),
      hv("s3", "ph", lead("l3", { createdAt: d("2026-09-15") })), // mới nhất nhưng KHÔNG có Sale nào
    ];
    expect(chonSaleCuaPhuHuynh({ studentId: null, parentUserId: "ph", hocVien: ds, bayGio: BAY_GIO })).toBe("sale-chot");
    const chiCham = [hv("s1", "ph", lead("l1", { assignedToId: "sale-cham" }))];
    expect(chonSaleCuaPhuHuynh({ studentId: null, parentUserId: "ph", hocVien: chiCham, bayGio: BAY_GIO })).toBe("sale-cham");
  });
});
