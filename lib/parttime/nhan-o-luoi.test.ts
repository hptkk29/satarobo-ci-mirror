// [NOL-*] chữ của một ô lưới phân công GV — QA cuối 25/10/2026 (ô "D+T?" nhưng ngăn ghi "Kế hoạch D", aria-label đọc "D").
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canhBaoTrongNgan, maKeHoach, nhanTruyCap } from "./nhan-o-luoi";
import type { OLuoi } from "./luoi-tuan-ghep";

const o = (ma: string | null, canhBao: OLuoi["canhBao"] = [], coTrial = false) =>
  ({ ke: { ma, coTrial } as unknown as NonNullable<OLuoi["ke"]>, canhBao }) as Pick<OLuoi, "ke" | "canhBao">;

describe("[NOL] chữ của ô lưới", () => {
  it("[NOL-01] chờ quyết trực ⇒ tầng Kế hoạch in đúng như ô: D+T?; quyết rồi ⇒ chỉ mã", () => {
    expect(maKeHoach(o("D", ["CAN_QUYET_TRUC"]))).toBe("D+T?");
    expect(maKeHoach(o("TD"))).toBe("TD");
    expect(maKeHoach(o("D", [], true))).toBe("D +TR");
    expect(maKeHoach({ ke: null, canhBao: [] })).toBe("—");
  });

  it("[NOL-02] nhãn trình đọc màn hình nói bằng CHỮ phần chờ quyết (không chỉ đọc 'D')", () => {
    expect(nhanTruyCap(o("D", ["CAN_QUYET_TRUC"]))).toBe("D · chờ quyết định trực");
    expect(nhanTruyCap(o("TD"))).toBe("TD");
    expect(nhanTruyCap(o("D", [], true))).toBe("D có Trial");
    expect(nhanTruyCap({ ke: null, canhBao: [] })).toBe("ngày cũ");
  });

  it("[NOL-03] hộp cảnh báo bỏ CAN_QUYET_TRUC CHỈ khi khối quyết định đang hiện; người không quyết được vẫn thấy cảnh báo", () => {
    const cb: OLuoi["canhBao"] = ["CAN_QUYET_TRUC", "CHUA_NHAN"];
    expect(canhBaoTrongNgan(cb, true)).toEqual(["CHUA_NHAN"]);
    expect(canhBaoTrongNgan(cb, false)).toEqual(["CAN_QUYET_TRUC", "CHUA_NHAN"]);
    expect(canhBaoTrongNgan(["CHUA_NHAN"] as OLuoi["canhBao"], true)).toEqual(["CHUA_NHAN"]);
  });

  it("[NOL-W1] lưới GV gọi đúng ba hàm ở ba chỗ (component không có test hành vi)", () => {
    const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/cham-cong/phan-cong-gv/_components/luoi-gv.tsx"), "utf8")
      .split(/\r?\n/)
      .filter((d) => !d.trim().startsWith("//"))
      .join("\n");
    expect(src.match(/: \$\{nhanTruyCap\(o\)\}`/g)?.length).toBe(1);
    expect(src.match(/>\{maKeHoach\(chon\.o\)\}</g)?.length).toBe(1);
    // Cả điều kiện hiện hộp lẫn danh sách in ra đều đi qua bộ lọc (2 lần), cùng cờ với khối quyết định.
    expect(src.match(/canhBaoTrongNgan\(chon\.o\.canhBao, quyetTrucDuoc\)/g)?.length).toBe(2);
    expect(src).not.toMatch(/chon\.o\.canhBao\.map\(/);
    expect(src).not.toMatch(/ca \$\{TEN_CA\[ca\] \?\? ca\}: \$\{o\.ke\?\.ma/);
  });
});
