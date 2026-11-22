/**
 * [HDNAV-P1..P2] Pháp nhân đang thao tác của từng cơ sở (phần server của thanh phạm vi).
 * THUẦN — pháp nhân suy bằng CHÍNH hàm mà đường phát hành dùng (`phapNhanPhatHanhChoCoSo`), không tự bịa.
 */
import { describe, expect, it } from "vitest";
import type { PhapNhan } from "@/lib/finance/hoa-don/phap-nhan";
import type { CauHinhCoSo } from "@/lib/finance/hoa-don/cau-hinh-co-so";
import { ngayVN, tomTatPhapNhanTheoCoSo } from "./phap-nhan-hien-thi";

const PN = (ma: string, ten: string, mst: string, bat = true): PhapNhan => ({ ma, ten, maSoThue: mst, diaChi: "Đà Nẵng", bat });
const DANH_SACH = [PN("SATA_ROBO", "Công ty CP Công nghệ Giáo dục Sata Robo", "0402222222"), PN("STEM", "Công ty STEM Robotics & AI", "0403333333")];
const CH = (centerId: string, phapNhanMa: string, kyHieu: string, tu = "2026-01-01", den = "2026-12-31"): CauHinhCoSo => ({
  id: `ch-${centerId}-${kyHieu}`,
  centerId,
  phapNhanMa,
  kyHieu,
  hieuLucTu: tu,
  hieuLucDen: den,
  dangBat: true,
});

describe("[HDNAV-P1] pháp nhân đang thao tác — đọc từ cấu hình ký hiệu hiệu lực HÔM NAY", () => {
  const cacCoSo = [{ id: "cs1" }, { id: "cs2" }, { id: "cs3" }];
  const kq = tomTatPhapNhanTheoCoSo({
    cacCoSo,
    cauHinh: [CH("cs1", "SATA_ROBO", "1C26TSR"), CH("cs2", "STEM", "1C26TST"), CH("cs2", "STEM", "1C25OLD", "2025-01-01", "2025-12-31")],
    ngay: "2026-11-01",
    danhSachPhapNhan: DANH_SACH,
  });

  it("có cấu hình hiệu lực ⇒ tên + MST + ký hiệu của đúng cơ sở (cs2 lấy dòng 2026, không lấy dòng đã hết hạn)", () => {
    expect(kq.cs1).toEqual({ loai: "CO", ten: "Công ty CP Công nghệ Giáo dục Sata Robo", maSoThue: "0402222222", kyHieu: "1C26TSR" });
    expect(kq.cs2).toEqual({ loai: "CO", ten: "Công ty STEM Robotics & AI", maSoThue: "0403333333", kyHieu: "1C26TST" });
  });

  it("cơ sở chưa khai cấu hình ⇒ THIẾU kèm lý do tiếng Việt của luật phát hành — KHÔNG rơi về pháp nhân mặc định", () => {
    expect(kq.cs3?.loai).toBe("THIEU");
    expect(kq.cs3 && "lyDo" in kq.cs3 ? kq.cs3.lyDo.length : 0).toBeGreaterThan(10);
  });

  it("mỗi cơ sở trong danh sách có đúng một mục (không thừa, không thiếu)", () => {
    expect(Object.keys(kq).sort()).toEqual(["cs1", "cs2", "cs3"]);
  });

  it("pháp nhân của cấu hình đang TẮT trong danh sách ⇒ THIẾU (không in tên pháp nhân đã tắt)", () => {
    const r = tomTatPhapNhanTheoCoSo({
      cacCoSo: [{ id: "cs1" }],
      cauHinh: [CH("cs1", "STEM", "1C26TST")],
      ngay: "2026-11-01",
      danhSachPhapNhan: [PN("STEM", "Công ty STEM Robotics & AI", "0403333333", false)],
    });
    expect(r.cs1?.loai).toBe("THIEU");
  });

  it("chồng ngày (mơ hồ) ⇒ THIẾU, không chọn bừa một dòng", () => {
    const r = tomTatPhapNhanTheoCoSo({
      cacCoSo: [{ id: "cs1" }],
      cauHinh: [CH("cs1", "SATA_ROBO", "1C26TSR"), CH("cs1", "STEM", "1C26TST")],
      ngay: "2026-11-01",
      danhSachPhapNhan: DANH_SACH,
    });
    expect(r.cs1?.loai).toBe("THIEU");
  });
});

describe("[HDNAV-P2] ngày VN truyền tường minh (luật 19: không đọc đồng hồ máy)", () => {
  it("17:00 UTC đã là ngày hôm sau theo giờ Việt Nam", () => {
    expect(ngayVN(new Date("2026-10-31T16:59:00Z"))).toBe("2026-10-31");
    expect(ngayVN(new Date("2026-10-31T17:00:00Z"))).toBe("2026-11-01");
  });
});
