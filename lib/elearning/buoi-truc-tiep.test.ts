/** [BTT-*] Màn buổi trực tiếp cho người học — nội dung thuần. Ngày TUYỆT ĐỐI (luật 19). */
import { describe, expect, it } from "vitest";
import { moTaBuoiTrucTiep } from "./buoi-truc-tiep";

const NGAY = new Date("2026-11-16T08:00:00.000Z"); // 15:00 giờ VN
const LUC = new Date("2026-11-16T10:05:00.000Z"); // 17:05 giờ VN

describe("[BTT-01] chưa điểm danh", () => {
  const m = moTaBuoiTrucTiep({ daDiemDanh: false, ngayBuoi: NGAY, luc: null, nguoiGhi: null });
  it("nói rõ KHÔNG cần bấm gì và hỏi ai (không hứa hành vi chưa có)", () => {
    expect(m.tieuDe).toBe("Chưa điểm danh");
    expect(m.huongDan).toContain("không cần bấm gì");
    expect(m.huongDan).toContain("quản lý trực tiếp");
    expect(m.huongDan).toContain("phòng Đào tạo");
  });
  it("chỉ in ngày buổi khi có; không bịa phòng/địa điểm", () => {
    expect(m.chiTiet).toEqual(["Buổi học ngày 16/11/2026"]);
    expect(moTaBuoiTrucTiep({ daDiemDanh: false, ngayBuoi: null, luc: null, nguoiGhi: null }).chiTiet).toEqual([]);
    expect(JSON.stringify(m)).not.toMatch(/phòng \d|CS\d/);
  });
});

describe("[BTT-02] đã điểm danh", () => {
  it("ai ghi + lúc nào (giờ VN) + ngày buổi", () => {
    const m = moTaBuoiTrucTiep({ daDiemDanh: true, ngayBuoi: NGAY, luc: LUC, nguoiGhi: "Huỳnh Gia Phát" });
    expect(m.tieuDe).toBe("Bạn đã được ghi có mặt");
    expect(m.chiTiet[0]).toBe("Huỳnh Gia Phát ghi lúc 16/11, 17:05");
    expect(m.chiTiet[1]).toBe("Buổi học ngày 16/11/2026");
    expect(m.huongDan).toContain("không cần làm gì thêm");
  });
  it("không đọc được tên người ghi (khác cơ sở/đã xoá) ⇒ vẫn đúng, không in 'null'", () => {
    const m = moTaBuoiTrucTiep({ daDiemDanh: true, ngayBuoi: null, luc: LUC, nguoiGhi: null });
    expect(m.chiTiet).toEqual(["Được ghi lúc 16/11, 17:05"]);
    expect(JSON.stringify(m)).not.toContain("null");
  });
});
