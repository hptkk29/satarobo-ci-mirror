// @vitest-environment node
/**
 * [DYN-NS-*] — giá trị hợp lệ của setting `nguon.nhomNhanSuMacDinh` (phần THUẦN). Phần chặn Ở NƠI LƯU có ca DB `[DYN-SET-01]` (`tests/hoa-hong/nguon-dong-cong.spec.ts`).
 */
import { describe, expect, it } from "vitest";
import { loiNhomNhanSuMacDinh, type NhomKiemMacDinh } from "./nhom-nhan-su-mac-dinh";

const NOW = new Date("2026-10-09T03:00:00.000Z");
const tot: NhomKiemMacDinh = { status: "ACTIVE", selectable: true, effectiveFrom: null, effectiveTo: null, referrerRequirement: "EMPLOYEE" };

describe("[DYN-NS-01] loiNhomNhanSuMacDinh", () => {
  it("nguồn kiểu nhân sự, đang hoạt động, chọn được, trong hiệu lực ⇒ hợp lệ (đối chứng dương)", () => {
    expect(loiNhomNhanSuMacDinh("EMPLOYEE_REFERRAL", tot, NOW)).toBeNull();
    expect(loiNhomNhanSuMacDinh("X", { ...tot, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2026-12-31T00:00:00.000Z") }, NOW)).toBeNull();
  });
  it("mã không có trong danh mục ⇒ nêu đúng mã", () => {
    expect(loiNhomNhanSuMacDinh("GO_NHAM", null, NOW)).toContain("GO_NHAM");
  });
  it("sai kiểu (không cần nhân sự) ⇒ nói NGUYÊN NHÂN là kiểu, không nói «không dùng được» chung chung", () => {
    for (const req of ["NONE", "PARENT", "AFFILIATE_ORG", "EVENT"]) {
      const l = loiNhomNhanSuMacDinh("PAID_ADS", { ...tot, referrerRequirement: req }, NOW);
      expect(l, req).toContain("NHÂN SỰ");
      expect(l, req).toContain(req);
    }
  });
  it("kiểu đúng nhưng KHÔNG chọn được: ngừng · lưu trữ · nháp · tắt chọn · chưa tới / quá hạn hiệu lực ⇒ từ chối", () => {
    for (const status of ["INACTIVE", "ARCHIVED", "DRAFT"]) expect(loiNhomNhanSuMacDinh("X", { ...tot, status }, NOW), status).toContain("không chọn được");
    expect(loiNhomNhanSuMacDinh("X", { ...tot, selectable: false }, NOW)).toContain("không chọn được");
    expect(loiNhomNhanSuMacDinh("X", { ...tot, effectiveFrom: new Date("2026-10-10T00:00:00.000Z") }, NOW)).toContain("không chọn được");
    expect(loiNhomNhanSuMacDinh("X", { ...tot, effectiveTo: NOW }, NOW)).toContain("không chọn được"); // biên kết thúc MỞ
  });
  it("kiểm KIỂU trước, rồi mới kiểm trạng thái (một nguồn sai cả hai ⇒ nói lỗi kiểu — lỗi người sửa không cứu được bằng cách bật nguồn)", () => {
    expect(loiNhomNhanSuMacDinh("X", { ...tot, referrerRequirement: "NONE", status: "INACTIVE" }, NOW)).toContain("NHÂN SỰ");
  });
});
