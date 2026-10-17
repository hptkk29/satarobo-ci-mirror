// [GV-08] Lưới ghim DÂY NỐI phạm vi của màn Công dạy giáo viên — đọc chính `page.tsx`.
//
// Vì sao là lưới ghim mã nguồn: luật cần khoá là "tham số URL nào đi qua cổng nào" trong một trang RSC.
// Hàm cổng (`gvHopLe`, che dòng) đã có ca thuần; thứ ca thuần KHÔNG chứng minh được là trang có GỌI
// chúng hay đọc thẳng `sp.gv` / `sp.coSo`. Mã TRƯỚC bản vá chưa có `?gv=` — lỗ cần chặn là bản sau ai
// đó viết `loadBuoiDay([sp.gv], …)` hay `chiTietGiaoVien(…, new Set(scope.blocks…))`: QLCS CS1 gõ id
// một giáo viên chỉ dạy CS2 là đọc được lịch lớp CS2.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Bỏ chú thích TRƯỚC khi đếm — chú thích giải thích bản vá chứa đúng chuỗi đang soi (luật 11). */
function boChuThich(x: string): string {
  return x
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const SRC = boChuThich(readFileSync(resolve(process.cwd(), "app/(admin)/admin/cham-cong/cong-day/page.tsx"), "utf8"));
const dem = (re: RegExp) => (SRC.match(re) ?? []).length;

describe("[GV-08] phạm vi — dây nối trong page.tsx", () => {
  it("?gv= đọc ĐÚNG MỘT lần, và lần đó là đối số của gvHopLe với tập người của khối", () => {
    expect(dem(/\bsp\.gv\b/g)).toBe(1);
    expect(SRC).toMatch(/gvHopLe\(\s*sp\.gv\s*,\s*nguoiCuaKhoi\s*\)/);
    expect(SRC).toMatch(/const nguoiCuaKhoi = new Set\(userIds\)/);
  });

  it("tập người của khối dựng bằng scopedDb (lưới ca + buổi lớp của CHÍNH cơ sở đang xem)", () => {
    expect(SRC).toMatch(/sdb\.shiftAssignment\.findMany\(\{\s*where: \{ centerId: coSo,/);
    expect(SRC).toMatch(/sdb\.classSession\.findMany\(\{[\s\S]{0,200}class: \{ centerId: coSo \}/);
    // Buổi chỉ nạp cho người của khối — không cho id lấy thẳng từ URL.
    expect(SRC).toMatch(/loadBuoiDay\(userIds, from, to\)/);
    expect(dem(/loadBuoiDay\(/g)).toBe(1);
  });

  it("?coSo= chỉ đi qua scope.pick (rơi về khối có quyền nếu trỏ ra ngoài)", () => {
    expect(dem(/\bsp\.coSo\b/g)).toBe(2); // pick + ModuleNav của nhánh KHÔNG có quyền
    expect(SRC).toMatch(/scope\.pick\(sp\.coSo, VIEW\)/);
  });

  it("che dòng: tập cơ sở xem được = khối CÓ quyền xem, không phải mọi khối thấy tên", () => {
    expect(SRC).toMatch(/const coSoXemDuoc = new Set\(visible\.map\(\(b\) => b\.id\)\)/);
    expect(SRC).toMatch(/chiTietGiaoVien\(buoiCua\.get\(gv\) \?\? \[\], danhMuc, loc, coSoXemDuoc\)/);
    expect(dem(/chiTietGiaoVien\(/g)).toBe(1);
    expect(SRC).not.toMatch(/new Set\(scope\.blocks\.map/);
  });

  it("[GV-11] màn CHỈ ĐỌC: trạng thái kỳ qua periodStatusOf (findUnique), không mở / chốt kỳ, không câu ghi nào", () => {
    // `getOrCreatePeriod` UPSERT — gọi nó ở màn đọc là MỞ KỲ cho mọi cơ sở × tháng người ta lướt qua
    // (`module-scope.ts`). Kỳ đã chốt mà màn này ghi gì vào là đổi lịch sử đã trả lương.
    expect(SRC).toMatch(/periodStatusOf\(sdb, coSo, ky\)/);
    expect(SRC).not.toMatch(/getOrCreatePeriod|lockPeriod|reopenPeriod|buildPeriodSummary/);
    expect(SRC).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(SRC).not.toMatch(/\$executeRaw|\$transaction/);
  });

  it("tên người trong ô chi tiết tra qua scopedDb", () => {
    expect(SRC).toMatch(/sdb\.user\.findMany\(\{ where: \{ id: \{ in: idNguoiChiTiet \} \}/);
  });
});
