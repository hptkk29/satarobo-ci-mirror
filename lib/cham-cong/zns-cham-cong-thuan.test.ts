// lib/cham-cong/zns-cham-cong-thuan.test.ts — P2.6 luật "có gửi ZNS cho nhân sự không" + khuôn tham số.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { quyetDinhZnsChamCong, thamSoZnsChamCong, ZNS_CHAM_CONG_PARAM_SPEC } from "./zns-cham-cong-thuan";
import { canMoiXacNhan } from "./xac-nhan-cong-thuan";

const DU = { bat: true, mau: "616999", sdt: "84905123456", daGui: false };

describe("[ZNST] quyết định gửi ZNS chấm công — tắt an toàn nhiều tầng", () => {
  it("[ZNST-01] đủ điều kiện ⇒ gửi (đối chứng dương)", () => {
    expect(quyetDinhZnsChamCong(DU)).toEqual({ gui: true });
  });
  it("[ZNST-02] công tắc tắt ⇒ không gửi, dù mẫu + SĐT đủ", () => {
    expect(quyetDinhZnsChamCong({ ...DU, bat: false })).toEqual({ gui: false, lyDo: "TAT" });
  });
  it("[ZNST-03] mẫu rỗng / khoảng trắng / không phải số ⇒ CHUA_CO_MAU (mẫu chưa duyệt thì không gửi)", () => {
    for (const mau of ["", "   ", "abc", "61699x"]) expect(quyetDinhZnsChamCong({ ...DU, mau })).toEqual({ gui: false, lyDo: "CHUA_CO_MAU" });
  });
  it("[ZNST-04] không SĐT ⇒ không gửi", () => {
    expect(quyetDinhZnsChamCong({ ...DU, sdt: null })).toEqual({ gui: false, lyDo: "KHONG_SDT" });
    expect(quyetDinhZnsChamCong({ ...DU, sdt: " " })).toEqual({ gui: false, lyDo: "KHONG_SDT" });
  });
  it("[ZNST-05] đã gửi thành công cùng dữ liệu ⇒ không gửi lại (thử lại không gửi đôi)", () => {
    expect(quyetDinhZnsChamCong({ ...DU, daGui: true })).toEqual({ gui: false, lyDo: "DA_GUI" });
  });
});

describe("[ZNSP] tham số mẫu đúng khuôn đã khai", () => {
  it("[ZNSP-01] mỗi loại ra ĐÚNG tập khoá của spec — khác tên là Zalo từ chối mọi tin", () => {
    expect(Object.keys(thamSoZnsChamCong("MOI_XAC_NHAN", { ten: "An", ky: "2026-09" })).sort()).toEqual([...ZNS_CHAM_CONG_PARAM_SPEC.MOI_XAC_NHAN].sort());
    expect(Object.keys(thamSoZnsChamCong("KHIEU_NAI_XU_LY", { ten: "An", ky: "2026-09", ketQua: "Giải quyết" })).sort()).toEqual(
      [...ZNS_CHAM_CONG_PARAM_SPEC.KHIEU_NAI_XU_LY].sort(),
    );
  });
  it("[ZNSP-02] kỳ in dạng MM/YYYY; tên dài bị cắt ≤ 30 ký tự", () => {
    const t = thamSoZnsChamCong("MOI_XAC_NHAN", { ten: "N".repeat(50), ky: "2026-09" });
    expect(t.ky).toBe("09/2026");
    expect(Array.from(t.ten!).length).toBeLessThanOrEqual(30);
  });
});

describe("[MXN] ai được mời xác nhận", () => {
  it("[MXN-01] chỉ CHUA_XAC_NHAN / CAN_XAC_NHAN_LAI", () => {
    expect(canMoiXacNhan("CHUA_XAC_NHAN")).toBe(true);
    expect(canMoiXacNhan("CAN_XAC_NHAN_LAI")).toBe(true);
    expect(canMoiXacNhan("DA_XAC_NHAN")).toBe(false);
    expect(canMoiXacNhan("HR_XAC_NHAN_THAY")).toBe(false);
  });
});

describe("[ZNS-W] dây nối", () => {
  const src = (f: string) =>
    readFileSync(resolve(process.cwd(), f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  it("[ZNS-W1] handler đã đăng ký với dispatcher", () => {
    expect(src("lib/events/register.ts").match(/registerZnsChamCongHandlers\(\);/g)).toHaveLength(1);
  });
  it("[ZNS-W2] action: khiếu nại đã xử lý + mời xác nhận đều xếp ZNS, cùng khoá chống trùng với chuông", () => {
    const a = src("lib/cham-cong/xac-nhan-cong-actions.ts");
    expect(a.match(/phatZnsChamCong\(\{/g)).toHaveLength(2);
    expect(a).toMatch(/loai: "KHIEU_NAI_XU_LY"[\s\S]{0,200}dedupeKey: `khieu-nai-cong\.ket-qua:\$\{kn\.id\}:\$\{r\.messageId\}`/);
    expect(a).toMatch(/loai: "MOI_XAC_NHAN"[\s\S]{0,120}dedupeKey,/);
  });
  it("[ZNS-W3] không còn `Date.now()` trong khoá chống trùng của khiếu nại công", () => {
    expect(src("lib/cham-cong/xac-nhan-cong-actions.ts")).not.toMatch(/dedupeKey: `khieu-nai-cong[^`]*Date\.now\(\)/);
  });
});
