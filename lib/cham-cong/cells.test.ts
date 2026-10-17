// [CEL-*] — `loiCuaLyDo`: câu lỗi người sửa tay / duyệt đơn đọc được (T04). Chữ của các câu cũ được GIỮ NGUYÊN vì đã có
// người đọc và có test khác khớp theo chữ; câu cho kỳ chốt, khối lạ và nhánh mặc định là thứ trước T04 không có.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { loiCuaLyDo } from "@/lib/cham-cong/cells";
import { CAU_LY_DO_BO_QUA, type LyDoBoQua } from "@/lib/cham-cong/ghi-o-luat";

const P = { code: "CG", homeUnit: "CS1" };
const TAT_CA = Object.keys(CAU_LY_DO_BO_QUA) as LyDoBoQua[];

describe("[CEL] loiCuaLyDo", () => {
  it("[CEL-01] câu cũ giữ nguyên chữ", () => {
    expect(loiCuaLyDo("KHONG_QUYEN_CO_SO_CU", P)).toBe("Không có quyền sửa ca ở cơ sở này");
    expect(loiCuaLyDo("KHONG_QUYEN_CO_SO_MOI", P)).toBe("Không có quyền xếp ca ở cơ sở này");
    expect(loiCuaLyDo("MA_KHONG_CO", { ...P, code: "ZZ" })).toBe('Mã ca "ZZ" không có trong danh mục');
  });

  it("[CEL-02] kỳ đã chốt: nói rõ là KỲ CHỐT và chỉ đường (mở lại kỳ), không để người dùng đoán là lỗi quyền", () => {
    const s = loiCuaLyDo("KY_DA_CHOT", P);
    expect(s).toContain("CHỐT SỔ");
    expect(s).toContain("mở lại kỳ");
    expect(s).not.toContain("quyền sửa ca");
  });

  it("[CEL-03] khối lạ: nêu đúng tên khối", () => {
    expect(loiCuaLyDo("CO_SO_LA", { ...P, homeUnit: "CS9" })).toContain('"CS9"');
  });

  it("[CEL-04] MỌI lý do đều ra một câu đọc được (không phải mã nội bộ trần) — thêm lý do mới mà quên câu chữ là đỏ ở đây", () => {
    for (const l of TAT_CA) {
      const s = loiCuaLyDo(l, P);
      expect(s.length, l).toBeGreaterThan(10);
      expect(s, l).not.toMatch(/^[A-Z_]+$/);
    }
    // Lý do không có câu riêng rơi về câu chung dựa trên CAU_LY_DO_BO_QUA.
    expect(loiCuaLyDo("O_DUOC_BAO_VE", P)).toContain(CAU_LY_DO_BO_QUA.O_DUOC_BAO_VE);
    expect(loiCuaLyDo("QUA_KHU", P)).toContain(CAU_LY_DO_BO_QUA.QUA_KHU);
  });
});
