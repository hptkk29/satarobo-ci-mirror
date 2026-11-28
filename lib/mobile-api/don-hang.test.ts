import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { goiYHoiLai, suyTrangThaiThanhToan, TRANG_THAI_THANH_TOAN, type BangChungThanhToan } from "./dich-vu/don-hang";
import { kiemTruocThanhToanSchema, loiHoSoMua, thieuTuyChon, YEU_CAU_HO_SO_MUA } from "./dich-vu/mua-khoa";

/**
 * [DH] V8 — trạng thái thanh toán suy từ bản ghi (thuần) + kiểm trước checkout (thuần) + lưới ghim.
 *   [DH-01] bảng trạng thái: huỷ/hoàn > chờ > một phần > đủ tiền rồi rẽ theo cấp quyền
 *   [DH-02] KHÔNG BAO GIỜ «đã cấp quyền» khi chưa đủ tiền, và KHÔNG «đã cấp» khi engine chưa nối (fail-closed)
 *   [DH-03] nhịp hỏi lại chỉ có ở trạng thái chưa cuối
 *   [DH-04] lược đồ checkout strict: giá/tổng tiền/khuyến mãi từ client ⇒ bị từ chối; mỗi dòng PHẢI có studentId
 *   [DH-05] lỗi hồ sơ TỐI THIỂU có cấu trúc (field/code/scope); ngày sinh học viên KHÔNG bắt buộc (chỉ `thieuTuyChon`); không đòi MST
 *   [DH-W1] ghim mã nguồn: tiền đọc qua KHOAN_DA_GHI_NHAN; không đọc kế toán duyệt/hoá đơn; không trạng thái THAT_BAI tự bịa
 */
const D = (o: Partial<BangChungThanhToan> = {}): BangChungThanhToan => ({ trangThaiDon: "PENDING_PAYMENT", tongTien: 1_000_000, daNhan: 0, coKhoanChoKeToan: false, capQuyen: "KHONG_AP_DUNG", ...o });
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));

describe("[DH] trạng thái thanh toán", () => {
  it("[DH-01] bảng trạng thái", () => {
    expect(suyTrangThaiThanhToan(D({ trangThaiDon: "CANCELLED", daNhan: 1_000_000 }))).toBe("DA_HUY");
    expect(suyTrangThaiThanhToan(D({ trangThaiDon: "REFUNDED", daNhan: 0 }))).toBe("DA_HOAN_TIEN");
    expect(suyTrangThaiThanhToan(D())).toBe("CHO_THANH_TOAN");
    expect(suyTrangThaiThanhToan(D({ daNhan: 400_000 }))).toBe("DA_NHAN_MOT_PHAN");
    expect(suyTrangThaiThanhToan(D({ daNhan: 1_000_000, trangThaiDon: "CONFIRMED" }))).toBe("DA_NHAN_TIEN");
    expect(suyTrangThaiThanhToan(D({ daNhan: 1_000_000, capQuyen: "CHO_CAP" }))).toBe("DA_NHAN_TIEN_CHO_CAP_QUYEN");
    expect(suyTrangThaiThanhToan(D({ daNhan: 1_000_000, capQuyen: "DA_CAP" }))).toBe("DA_CAP_QUYEN");
    expect(suyTrangThaiThanhToan(D({ daNhan: 1_000_000, capQuyen: "LOI_CAN_THU_LAI" }))).toBe("CAP_QUYEN_LOI");
    // thu thừa vẫn là đủ; đơn 0đ chỉ «đủ» khi đơn đã chốt
    expect(suyTrangThaiThanhToan(D({ daNhan: 1_200_000 }))).toBe("DA_NHAN_TIEN");
    expect(suyTrangThaiThanhToan(D({ tongTien: 0 }))).toBe("CHO_THANH_TOAN");
    expect(suyTrangThaiThanhToan(D({ tongTien: 0, trangThaiDon: "CONFIRMED" }))).toBe("DA_NHAN_TIEN");
    // khoản chờ kế toán KHÔNG làm đổi kết luận (không đòi kế toán duyệt)
    expect(suyTrangThaiThanhToan(D({ daNhan: 1_000_000, coKhoanChoKeToan: true }))).toBe("DA_NHAN_TIEN");
  });

  it("[DH-02] không «đã cấp» khi chưa đủ tiền / engine chưa nối", () => {
    for (const c of ["DA_CAP", "CHO_CAP", "LOI_CAN_THU_LAI", "CHUA_NOI_ENGINE"] as const) {
      expect(suyTrangThaiThanhToan(D({ daNhan: 0, capQuyen: c })), c).toBe("CHO_THANH_TOAN");
      expect(suyTrangThaiThanhToan(D({ daNhan: 999_999, capQuyen: c })), c).toBe("DA_NHAN_MOT_PHAN");
    }
    expect(suyTrangThaiThanhToan(D({ daNhan: 1_000_000, capQuyen: "CHUA_NOI_ENGINE" }))).toBe("DA_NHAN_TIEN_CHO_CAP_QUYEN");
    expect(suyTrangThaiThanhToan(D({ trangThaiDon: "CANCELLED", capQuyen: "DA_CAP", daNhan: 1_000_000 }))).toBe("DA_HUY");
  });

  it("[DH-03] nhịp hỏi lại", () => {
    expect(TRANG_THAI_THANH_TOAN.filter((t) => goiYHoiLai(t) !== null).sort()).toEqual(["CAP_QUYEN_LOI", "CHO_THANH_TOAN", "DA_NHAN_MOT_PHAN", "DA_NHAN_TIEN_CHO_CAP_QUYEN"].sort());
    for (const t of ["DA_HUY", "DA_HOAN_TIEN", "DA_NHAN_TIEN", "DA_CAP_QUYEN"] as const) expect(goiYHoiLai(t), t).toBeNull();
  });

  it("[DH-04] lược đồ checkout strict", () => {
    const dong = { studentId: "s1", khoaId: "k1" };
    expect(kiemTruocThanhToanSchema.safeParse({ dong: [dong] }).success).toBe(true);
    expect(kiemTruocThanhToanSchema.safeParse({ dong: [] }).success).toBe(false);
    expect(kiemTruocThanhToanSchema.safeParse({ dong: [{ khoaId: "k1" }] }).success).toBe(false); // thiếu studentId
    for (const them of [{ gia: 1 }, { tongTien: 1 }, { khuyenMai: "X" }, { activeChild: "s1" }]) {
      expect(kiemTruocThanhToanSchema.safeParse({ dong: [{ ...dong, ...them }] }).success, JSON.stringify(them)).toBe(false);
      expect(kiemTruocThanhToanSchema.safeParse({ dong: [dong], ...them }).success, JSON.stringify(them)).toBe(false);
    }
    expect(kiemTruocThanhToanSchema.safeParse({ dong: Array.from({ length: 21 }, () => dong) }).success).toBe(false);
  });

  it("[DH-05] lỗi hồ sơ có cấu trúc", () => {
    expect(loiHoSoMua({ ten: "Ba", sdt: "0900" })).toEqual([]); // hồ sơ tối thiểu đủ ⇒ KHÔNG có lỗi, dù học viên thiếu ngày sinh
    const l = loiHoSoMua({ ten: " ", sdt: null });
    expect(l.map((e) => [e.field, e.code, e.scope])).toEqual([
      ["phuHuynh.ten", "REQUIRED", "parent"],
      ["phuHuynh.sdt", "REQUIRED", "parent"],
    ]);
    expect(Object.keys(YEU_CAU_HO_SO_MUA).sort()).toEqual(["sdtPhuHuynh", "tenPhuHuynh"]); // không có ngày sinh / MST trong yêu cầu bắt buộc
    expect(thieuTuyChon([{ id: "s1", ngaySinh: null }, { id: "s2", ngaySinh: new Date() }])).toEqual([{ field: "hocVien.ngaySinh", scope: "student", studentId: "s1" }]);
    expect(JSON.stringify(l)).not.toMatch(/taxCode|mst|MST/); // không đòi mã số thuế
  });

  it("[DH-W1] ghim mã nguồn", () => {
    const s = doc("lib/mobile-api/dich-vu/don-hang.ts");
    expect(s).toContain("KHOAN_DA_GHI_NHAN");
    expect(s).not.toMatch(/\b(invoice|hoaDon|Receipt|accountantStatus\s*:\s*["']CONFIRMED)/);
    expect(s).not.toContain('"THAT_BAI"'); // không bịa trạng thái thất bại khi không có bản ghi
    expect(s).toContain("parentUserId");
    const m = doc("lib/mobile-api/dich-vu/mua-khoa.ts");
    expect(m).toContain("parentUserId");
    expect(m).toMatch(/\.strict\(\)/);
    for (const p of ["lib/mobile-api/dich-vu/don-hang.ts", "lib/mobile-api/dich-vu/mua-khoa.ts", "lib/mobile-api/dich-vu/khu-hoc-tap.ts"]) {
      expect(doc(p), p).not.toMatch(/\bdb\.(?:order|payment|studyEntitlement|orderItem)\.(?:create|update|upsert|delete)/); // CHỈ ĐỌC
    }
  });
});
