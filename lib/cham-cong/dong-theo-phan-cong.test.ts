// [DTPC-*] Dòng công GV parttime theo phân công (chủ dự án chốt 08/11/2026): luật hiển thị thuần + lưới ghim dây nối của từng màn.
// Không họ tên thật. Lưới ghim đọc mã nguồn ĐÃ BỎ CHÚ THÍCH (chú thích giải thích bản vá chứa đúng chuỗi đang soi).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { coChoDongTheoPhanCong, hienPhanCongNgay, nguoiSoCongCoPhanCong } from "./dong-theo-phan-cong";
import type { ViecNgay } from "@/lib/parttime/viec-ngay";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
function boChuThich(x: string): string {
  return x
    // JSX `{/* … */}` — KHÔNG được vượt qua một `*/` (bản lười `[\s\S]*?` nuốt từ `= {` của một kiểu tới `*/ }` tận dưới).
    .replace(/\{\s*\/\*(?:(?!\*\/)[\s\S])*\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/\s\/\/ .*$/gm, " ");
}
const dem = (src: string, s: string) => src.split(s).length - 1;

const viec = (p: Partial<ViecNgay> = {}): ViecNgay => ({
  userId: "u1",
  ten: "GV u1",
  ngay: "2026-11-05",
  coSo: ["cs2"],
  o: [
    { centerId: "cs2", ca: "C", ma: "TD", coTrial: false, canhBao: [] },
    { centerId: "cs2", ca: "T", ma: "D2", coTrial: true, canhBao: ["TRUNG_GIO"] },
  ],
  tietChinh: 3,
  tietTroGiang: 0,
  trucDu: 0,
  trucNua: 1,
  trucQuyDoi: 0.5,
  soBuoiTrial: 1,
  tien: 435000,
  tienTheoNhom: { DAY_CHINH: 360000, DAY_BU: 0, DAY_THAY: 0, HOC_VUOT: 0, TRO_GIANG: 0, TRUC_DU: 0, TRUC_NUA: 45000, HO_TRO_TRIAL: 30000 },
  chuaTinh: 0,
  ngoaiCa: 0,
  legacy: false,
  ...p,
});

describe("luật hiển thị", () => {
  it("[DTPC-01] cờ so với ô ca bị bỏ (đi muộn / về sớm / thiếu giờ / ngoài lịch / không có lượt / thiếu lượt), cờ của chính lượt quét giữ", () => {
    const vao = ["DI_MUON", "VE_SOM", "THIEU_GIO", "CHAM_NGOAI_LICH", "KHONG_CO_LUOT", "THIEU_LUOT_RA", "THIEU_BUOI_SANG", "SAI_NOI_LAM", "NGOAI_VUNG", "THIEU_GPS", "VUOT_TRAN"];
    expect(coChoDongTheoPhanCong(vao)).toEqual(["NGOAI_VUNG", "THIEU_GPS", "VUOT_TRAN"]);
    // Danh sách TRẮNG: cờ lạ chưa phân loại không lọt.
    expect(coChoDongTheoPhanCong(["MA_MOI_CHUA_BIET"])).toEqual([]);
  });
  it("[DTPC-02] mã ô như màn Phân công (+TR), việc, tiền dự kiến, nhóm khác 0, cảnh báo phân công thành chữ", () => {
    const h = hienPhanCongNgay(viec());
    expect(h.o).toEqual([
      { ca: "C", ten: "Chiều", ma: "TD" },
      { ca: "T", ten: "Tối", ma: "D2+TR" },
    ]);
    expect(h.viec).toBe("3 tiết · trực ½ · Trial 1");
    expect(h.tien).toBe(`${(435000).toLocaleString("vi-VN")}đ`);
    expect(h.nhom.map((n) => n.nhan)).toEqual(["Dạy chính (lớp cố định)", "Nửa ca trực", "Hỗ trợ Trial"]);
    expect(h.canhBao).toEqual(["Trùng giờ với việc khác"]);
    expect(h.ghiChu).toEqual([]);
  });
  it("[DTPC-03] chưa tính / vượt ca / legacy ⇒ NÓI ra (không cộng, không im lặng); không có việc ⇒ 'Không có phân công' 0đ", () => {
    const h = hienPhanCongNgay(viec({ chuaTinh: 2, ngoaiCa: 1, legacy: true }));
    expect(h.ghiChu).toHaveLength(3);
    expect(h.ghiChu[0]).toMatch(/2 dòng tiền chưa tính/);
    expect(hienPhanCongNgay(null)).toMatchObject({ o: [], viec: "Không có phân công", tienSo: 0 });
  });
  it("[DTPC-04] sổ công = sổ cũ + GV theo phân công có việc (đối chứng âm: người có việc mà KHÔNG theo phân công không được thêm)", () => {
    const ds = nguoiSoCongCoPhanCong({ soCongCu: ["a", "b"], viec: [{ userId: "b" }, { userId: "pt" }, { userId: "ft" }], theoPhanCong: (u) => u !== "ft" });
    expect(ds).toEqual(["a", "b", "pt"]);
  });
});

describe("[DTPC-W] lưới ghim dây nối — mỗi màn gọi ĐÚNG hàm dùng chung, không tự tính", () => {
  it("[DTPC-W1] Bảng công ngày (admin): đọc docViecParttime + chamTheoPhanCong; sổ công qua nguoiSoCongCoPhanCong; lọc cờ ở dòng, lượt, dải ngày", () => {
    const src = boChuThich(doc("app/(admin)/admin/cham-cong/page.tsx"));
    expect(dem(src, "docViecParttime({")).toBe(1);
    expect(dem(src, "chamTheoPhanCong({")).toBe(1);
    expect(src).toMatch(/const userIds = nguoiSoCongCoPhanCong\(\{/);
    expect(dem(src, "hienPhanCongNgay(")).toBe(1);
    // Ba chỗ lọc cờ: dòng + từng lượt (qua `locCo`) và dải ngày của tháng (trực tiếp).
    expect(src).toMatch(/const locCo = \(fs: string\[\]\) => \(phanCong \? coChoDongTheoPhanCong\(fs\) : fs\)/);
    expect(dem(src, "locCo(")).toBe(2);
    expect(src).toMatch(/theoPhanCong\(r\.userId, ymd\) \? coChoDongTheoPhanCong\(r\.flags\) : r\.flags/);
    // Không tự tính: không đọc dòng tiền / số lượng / engine tiền ở trang.
    for (const cam of ["tinhCaDuKien", "tongHopTuan", ".soLuong", "ke.dong", "docLuoiTuan", "docLuoiGop", "contractType ==="]) expect(src).not.toContain(cam);
  });
  it("[DTPC-W2] panel chi tiết: phanCong là trường BẮT BUỘC; dòng theo phân công KHÔNG vẽ ghi đè công / kết luận vắng", () => {
    const src = boChuThich(doc("app/(admin)/admin/cham-cong/_components/day-detail-sheet.tsx"));
    expect(src).toMatch(/\n {2}phanCong: PhanCongNgayHien \| null;/);
    expect(src).toMatch(/const hoiKetLuan =\s*!row\.phanCong &&/);
    expect(src).toMatch(/\{row\.phanCong \? \(\s*<section>[\s\S]{0,200}Ghi đè công/);
    expect(src).toMatch(/\{!row\.phanCong && \(\s*<section>\s*<h3[^>]*>\s*Công của ngày/);
  });
  it("[DTPC-W3] Bảng công site GV: CÙNG docViecParttime (chỉ chính mình, mọi cơ sở) + chamTheoPhanCong; truyền vào dungDongBangCong; tóm tắt bỏ ngày theo phân công", () => {
    const src = boChuThich(doc("app/(teacher)/teacher/bang-cong/page.tsx"));
    expect(dem(src, "docViecParttime({")).toBe(1);
    expect(src).toMatch(/centerIds: await docCoSoCoPhanCong\(session\.user\.id,/);
    expect(src).toMatch(/userIds: \[session\.user\.id\]/);
    expect(dem(src, "chamTheoPhanCong({")).toBe(1);
    expect(src).toMatch(/theoPhanCong: thangCoPhanCong \? \{ apDung: apDungPhanCong, viec: viecPhanCong \} : null/);
    expect(src).toMatch(/ngay: myDays\.filter\(\(d\) => !\(thangCoPhanCong && apDungPhanCong\(isoKey\(d\.date\)\)\)\)\.map\(\(d\) => d\.gop\)/);
    // Khung thiết kế (10/11/2026): GV có ô công / parttime theo phân công ⇒ \`tuOCong\`; còn lại ⇒ \`tuDongCa\` với tóm tắt đã bỏ ngày theo phân công.
    expect(src).toMatch(/const coKhoiParttime = oThang\.length > 0 \|\| tongPhanCong !== null;/);
    expect(src).toMatch(/const kq = coKhoiParttime\s*\?\s*tuOCong\(\{/);
    expect(src).toMatch(/:\s*tuDongCa\(\{\s*rows,\s*tomTat,/);
    expect(dem(src, "hienTongPhanCong(tongViec(")).toBe(2);
    for (const cam of ["tinhCaDuKien", "tongHopTuan", ".soLuong", "ke.dong", "docLuoiTuan", "docLuoiGop", "contractType ==="]) expect(src).not.toContain(cam);
  });
  it("[DTPC-W4] Bảng công tháng + Excel: MỘT nguồn loadBangCongThang đọc docViecParttime + chamTheoPhanCong; màn và file xuất in CÙNG r.phanCong; cổng xuất KHÔNG nới", () => {
    const lib = boChuThich(doc("lib/cham-cong/bang-cong-thang-db.ts"));
    expect(dem(lib, "docViecParttime({")).toBe(1);
    expect(lib).toMatch(/userIds: "TAT_CA" \}\)/);
    expect(dem(lib, "chamTheoPhanCong({")).toBe(1);
    expect(lib).toMatch(/phanCong: coNgayPhanCong \? hienTongPhanCong\(tongViec\(viecNguoi\)\) : null/);
    // GV parttime chỉ có phân công vào sổ.
    expect(lib).toMatch(/const userIds = \[\.\.\.new Set\(\[\.\.\.soCu, \.\.\.\[\.\.\.viecCua\.values\(\)\]\.map\(\(v\) => v\.userId\)\]\)\];/);
    // Ngày theo phân công KHÔNG vào đếm màu / tổng công ô ca (continue trước phanLoaiO).
    expect(lib.indexOf("if (theoPhanCong(uid, ymd)) {")).toBeLessThan(lib.indexOf("const r = phanLoaiO({"));
    for (const cam of ["tinhCaDuKien", "tongHopTuan", ".soLuong", "ke.dong", "docLuoiTuan"]) expect(lib).not.toContain(cam);
    const grid = boChuThich(doc("components/admin/cham-cong/bang-cong-thang-grid.tsx"));
    expect(grid).toMatch(/\{row\.phanCong \? \(/);
    const xuat = boChuThich(doc("app/api/admin/cham-cong/bang-cong-thang/export/route.ts"));
    expect(dem(xuat, "r.phanCong?.")).toBeGreaterThanOrEqual(6);
    expect(xuat).toContain('chanXuatVai("cham-cong-thang", session)');
    expect(xuat).toMatch(/checkPermission\("hr_attendance:export", \{ centerId: c \}\)/);
    const page = boChuThich(doc("app/(admin)/admin/cham-cong/bang-cong-thang/page.tsx"));
    expect(page).toContain("const canExport = block.perms[EXPORT];");
    expect(page).toMatch(/now: new Date\(\),\s*lockedStatus: period\.status/);
  });
  it("[DTPC-W5] Kỳ công + summaryJson: buildPeriodSummary lọc công ô ca của ngày theo phân công TRƯỚC mọi phép gộp, phanCong từ CÙNG docViecParttime; màn + Excel đọc r.phanCong", () => {
    const src = boChuThich(doc("lib/cham-cong/period.ts"));
    expect(dem(src, "docViecParttime({")).toBe(1);
    expect(src).toMatch(/const mine = dayRows\.filter\(\(r\) => r\.userId === userId && !theoPhanCong\(userId, r\.workDate\.toISOString\(\)\.slice\(0, 10\)\)\);/);
    expect(src.indexOf("const mine = dayRows.filter(")).toBeLessThan(src.indexOf("const gop = gopNgayCong(mine);"));
    expect(src).toMatch(/phanCong: phanCongKyCuaNguoi\(viecNguoi, ngayDauPc\)/);
    expect(src).toMatch(/if \(!theoPhanCong\(userId, ymd\)\) grid\[ymd\] = a\.templateCode;/);
    const xlsx = boChuThich(doc("lib/cham-cong/export-xlsx.ts"));
    expect(dem(xlsx, "r.phanCong?.")).toBe(7);
    const page = boChuThich(doc("app/(admin)/admin/cham-cong/ky-cong/page.tsx"));
    expect(page).toMatch(/phanCong: r\.phanCong \? \{ viec: nhanViec\(r\.phanCong\), tien: nhanTien\(r\.phanCong\.tien\)/);
    expect(page).toMatch(/if \(r\.phanCong && ymd >= r\.phanCong\.tuNgay\) continue;/);
  });
});
