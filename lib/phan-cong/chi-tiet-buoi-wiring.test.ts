// [GD7-W*] Lưới ghim DÂY NỐI của GĐ7 (mẫu "lưới ghim mã nguồn", CLAUDE.md) — thứ test thuần không thấy: action trả gì khi 0 buổi,
// action có tự kiểm lý do không, panel có khoá ngày đã qua bằng cùng hàm không, và màn có đọc buổi MỘT lần không.
//
// Mã TRƯỚC bản vá:
//   · `_actions-gop.ts`: `const message = kq.soNgay === 0 ? \`Không ${viec} được buổi nào.\` : …; return { ok: true, message, … }`
//     ⇒ bấm ở ngày đã qua: máy chủ bỏ qua ngày đó, toast XANH;
//   · `datNguoiAction` nhận `lyDo` tuỳ chọn, mặc định "Giao trên màn Phân công" ⇒ thay / gỡ đứng chính không lý do;
//   · `luoi-gop.tsx`: `duocGhi` không xét ngày.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const dem = (src: string, re: RegExp) => (src.match(re) ?? []).length;

const action = doc("app/(admin)/admin/cham-cong/phan-cong/_actions-gop.ts");
const luoi = doc("app/(admin)/admin/cham-cong/phan-cong/_components/luoi-gop.tsx");
const man = doc("app/(admin)/admin/cham-cong/phan-cong/_components/man-gop.tsx");

describe("[GD7-W] dây nối GĐ7", () => {
  it("[GD7-W1] 0 buổi được ghi ⇒ action trả THẤT BẠI (không còn nhánh `ok: true` cho soNgay 0)", () => {
    expect(dem(action, /if \(kq\.soNgay === 0\) return \{ ok: false, error: /g)).toBe(1);
    expect(dem(action, /kq\.soNgay === 0 \?/g)).toBe(0);
  });
  it("[GD7-W2] datNguoiAction tự kiểm lý do thay / gỡ bằng `lyDoThieuKhiDoi` và DỪNG trước phép ghi", () => {
    expect(dem(action, /const thieuLyDo = lyDoThieuKhiDoi\(\{ boUserId: p\.data\.boUserId, lyDo: p\.data\.lyDo \}\);/g)).toBe(1);
    expect(dem(action, /if \(thieuLyDo\) return \{ ok: false, error: thieuLyDo \};/g)).toBe(1);
    expect(action.indexOf("if (thieuLyDo) return")).toBeLessThan(action.indexOf("datNguoiVaoBuoi(tx,"));
  });
  it("[GD7-W3] panel: ba panel đều đi qua `theoNgay` (khoá ngày đã qua bằng `laNgayDaQua`), panel hỏi lý do bằng cùng hàm máy chủ", () => {
    expect(dem(luoi, /const p = theoNgay\(p0, ngay\);/g)).toBe(3);
    expect(dem(luoi, /if \(!laNgayDaQua\(ngay, p\.homNay\)\) return p;/g)).toBe(1);
    expect(dem(luoi, /duocGhi: false,/g)).toBe(1);
    expect(dem(luoi, /if \(lyDoThieuKhiDoi\(\{ boUserId, lyDo: null \}\) == null\) return guiNguoi\(c, null\);/g)).toBe(1);
  });
  it("[GD7-W5] đổi GV Trial đã xong: cột gốc + phân công đứng chính trong CÙNG `trongGiaoDich`; thông báo gửi SAU commit", () => {
    const tr = doc("app/(admin)/admin/lop-trial/_actions.ts");
    const i = tr.indexOf("export async function doiGiaoVienCaseDaXongAction");
    const than = tr.slice(i, tr.indexOf("\nexport async function", i + 10));
    const gd = than.indexOf("await trongGiaoDich(async (tx) => {");
    expect(gd).toBeGreaterThan(0);
    expect(than.indexOf("await tx.trialClassSession.updateMany(", gd)).toBeGreaterThan(gd);
    expect(than.indexOf("await suaDungChinhDaQuaTuNguonGoc(tx, {", gd)).toBeGreaterThan(gd);
    expect(than.indexOf("await guiThongBaoPhanCong(thongBaoPc")).toBeGreaterThan(than.indexOf("await suaDungChinhDaQuaTuNguonGoc(tx, {"));
    // Không còn phép ghi cột gốc NGOÀI giao dịch (đường cũ: `sdb.trialClassSession.updateMany`).
    expect(than).not.toMatch(/sdb\.trialClassSession\.updateMany/);
  });

  it("[GD7-W4] màn tuần đọc buổi MỘT lần cho cả lưới lẫn chi tiết buổi", () => {
    expect(dem(man, /docTuanPhanCong\(/g)).toBe(1);
    expect(dem(man, /docLuoiGop\(\{ centerId: coSo, tu, den, buoiDaDoc: b \}\)/g)).toBe(1);
    expect(dem(man, /docChiTietBuoiGop\(\{ centerId: coSo, tu, den, now, homNay: p\.homNay, buoi: b \}\)/g)).toBe(1);
  });
  it("[GD7-W6] lương dự kiến (chốt 29/10): màn đưa CHÍNH lưới gộp vừa đọc vào `docLuoiTuan` (một bản đồ ca/ghép), panel GV vẽ tiền của ô, lưới có cột tuần", () => {
    expect(dem(man, /docLuoiTuan\(\{ centerId: coSo, tu, den, now, luoiGop: l \}\)/g)).toBe(1);
    expect(dem(man, /luoiP\.then\(\(l\) => docLuoiTuan/g)).toBe(1);
    expect(dem(man, /luong=\{luongTuan \?/g)).toBe(1);
    expect(dem(luoi, /<TienDuKien userId=\{d\.userId\} ngay=\{ngay\} ca=\{ca\} p=\{p\} \/>/g)).toBe(1);
    expect(dem(luoi, /data-luong-tuan=\{d\.userId\}/g)).toBe(1);
    expect(dem(luoi, /<LuongTuanGv /g)).toBe(1);
  });
});
