import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_GATES } from "@/lib/auth/page-gates";

// Lưới ghim DÂY NỐI của "tách học bù / học vượt" (17/11/2026) và màn "Lịch sử cấp lượt". Test hành vi của case-db / action đều chạm DB hoặc giả lập module, nên quên gọi
// cổng chặn trộn / quên cập nhật số buổi của yêu cầu là KHÔNG ca nào đỏ — các ca dưới đây canh đúng những chỗ đó.
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
// Bỏ chú thích TRƯỚC khi đếm: chú thích giải thích bản vá thường chứa đúng chuỗi đang canh.
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function than(src: string, ten: string): string {
  const i = src.search(new RegExp(`(?:async )?function ${ten}\\b`));
  expect(i, `không thấy hàm ${ten}`).toBeGreaterThanOrEqual(0);
  const j = src.indexOf("\nexport ", i + 10);
  const k = src.indexOf("\nasync function ", i + 10);
  const f = src.indexOf("\nfunction ", i + 10);
  const kt = [j, k, f].filter((x) => x > 0);
  return src.slice(i, kt.length ? Math.min(...kt) : undefined);
}

describe("[LBV-W] tách học bù / học vượt — dây nối", () => {
  const caseDb = boChuThich(doc("lib/hoc-bu/case-db.ts"));

  it("[LBV-W1] kiemDongXep (cổng chung của tạo case + xếp thêm + duyệt thêm bé) chặn trộn vượt/bù bằng kiemCungLoai trên mọi dòng được chọn", () => {
    const t = than(caseDb, "kiemDongXep");
    expect(t).toMatch(/kiemCungLoai\(dong\.map\(/);
    expect(t).toMatch(/if \(!cungLoai\.ok\) throw new LoiHocBu\(cungLoai\.lyDo\)/);
  });

  it("[LBV-W2] taoCaseVaXep gắn phân loại buổi THEO LOẠI của dòng (không còn gọi trần phanLoaiBu() luôn ra BU)", () => {
    const t = than(caseDb, "taoCaseVaXep");
    expect(t).toMatch(/phanLoaiBu\(dong\[0\]\?\.loai \?\? "BU"\)/);
    expect(t).not.toMatch(/phanLoaiBu\(\)/);
  });

  it("[LBV-W3] xếp thêm bé vào case có sẵn so loại bé với loại của các mục đang sống trong case (kiemHopVoiCase), không tính mục RELEASED", () => {
    const t = than(caseDb, "chuanBiXepVaoCase");
    expect(t).toMatch(/kiemHopVoiCase\(/);
    expect(t).toMatch(/loaiCuaCaseTuDong\(/);
    expect(t).toMatch(/result: \{ not: "RELEASED" \}/);
  });

  it("[LBV-W4] phanLoaiBu: danh mục VUOT tắt ⇒ rơi về BU, KHÔNG để trống (trống = học chính thức ⇒ đổi cách tính công dạy)", () => {
    const t = than(caseDb, "phanLoaiBu");
    expect(t).toContain("MA_PHAN_LOAI_THEO_LOAI[loai]");
    expect(t).toMatch(/if \(loai === "BU"\) return null;/);
    expect(t).toContain("MA_PHAN_LOAI_THEO_LOAI.BU");
  });

  it("[LBV-W5] dòng cần bù mang loai từ sourceType; bộ lọc dùng cùng phép chia (chỉ ORDER_CONVERSION là vượt)", () => {
    const s = boChuThich(doc("lib/hoc-bu/danh-sach-db.ts"));
    expect(s).toMatch(/loai: loaiTuNguon\(n\.sourceType\)/);
    expect(s).toMatch(/loc\.loai === "VUOT"[^\n]*sourceType: "ORDER_CONVERSION"/);
    expect(s).toMatch(/loc\.loai === "BU"[^\n]*sourceType: \{ not: "ORDER_CONVERSION"/);
    const c = boChuThich(doc("lib/hoc-bu/case-doc.ts"));
    expect(c).toMatch(/makeupNeed: \{ sourceType: "ORDER_CONVERSION" \}/);
    expect((c.match(/loai: loaiCuaCaseTuDong\(/g) ?? []).length).toBe(2); // docDanhSachCase + caseChoNhom
  });

  it("[LBV-W6] hộp chọn case có sẵn chỉ gợi ý case CÙNG loại (case trống nhận loại nào cũng được)", () => {
    const a = boChuThich(doc("app/(admin)/admin/hoc-bu/_actions.ts"));
    expect(a).toMatch(/caseCoSan = caseTatCa\.filter\(\(c\) => c\.soBe === 0 \|\| c\.loai === cungLoai\.loai\)/);
    expect(a).toMatch(/kiemCungLoai\(dong\.map\(/);
  });
});

describe("[LSL-W] màn lịch sử cấp lượt — dây nối", () => {
  const db = boChuThich(doc("lib/hoc-bu/lich-su-luot-db.ts"));
  const act = boChuThich(doc("app/(admin)/admin/hoc-bu/lich-su-luot/_actions.ts"));

  it("[LSL-W1] cổng trang + cả hai Server Action gác `makeup:waive`; trang có lối vào ở sidebar và ở màn Duyệt học vượt", () => {
    expect(PAGE_GATES["/hoc-bu/lich-su-luot"]).toEqual(["makeup:waive"]);
    expect(act).toMatch(/checkPermission\("makeup:waive"\)/);
    expect(boChuThich(doc("components/admin/sidebar.tsx"))).toMatch(/href: "\/hoc-bu\/lich-su-luot"[^\n]*PAGE_GATES\["\/hoc-bu\/lich-su-luot"\]/);
    expect(boChuThich(doc("app/(admin)/admin/hoc-bu/duyet-hoc-vuot/page.tsx"))).toContain('href="/hoc-bu/lich-su-luot"');
    expect(boChuThich(doc("app/(admin)/admin/hoc-bu/lich-su-luot/page.tsx"))).toMatch(/PAGE_GATES\["\/hoc-bu\/lich-su-luot"\]/);
  });

  it("[LSL-W2] đọc lịch sử ép phạm vi cơ sở qua cơ sở của HỌC VIÊN (sổ lượt không mang centerId)", () => {
    const t = than(db, "docLichSuLuot");
    expect(t).toMatch(/phamViHocVien\(actor\)/);
    expect(than(db, "phamViHocVien")).toMatch(/getModelVisibleCenterIds\("Student", actor\)/);
  });

  it("[LSL-W3] sửa số buổi duyệt học vượt: khoá hàng yêu cầu, chỉ APPROVED, bút toán bù trừ VÀ cập nhật makeupSessions trong CÙNG hàm (đường đổi buổi bắt đầu đọc số này)", () => {
    const t = than(db, "suaLuotHocVuot");
    expect(t).toMatch(/FOR UPDATE/);
    expect(t).toMatch(/y\.status !== "APPROVED"/);
    expect(t).toMatch(/dieuChinhLuot\(tx,/);
    expect(t).toMatch(/enrollmentCatchUpRequest\.update\(\{ where: \{ id: y\.id \}, data: \{ makeupSessions: p\.bMoi \} \}\)/);
    expect(t).toMatch(/ap !== delta/);
    // cổng IDOR đứng TRƯỚC giao dịch
    expect(t.indexOf("scopedDb(actor).enrollmentCatchUpRequest")).toBeGreaterThanOrEqual(0);
    expect(t.indexOf("scopedDb(actor).enrollmentCatchUpRequest")).toBeLessThan(t.indexOf("db.$transaction"));
  });

  it("[LSL-W4] sửa bút toán QLCS: cổng IDOR theo học viên, chỉ bút toán QLCS_CAP/QLCS_GIAM, khoá chống lặp theo mã lần, từ chối khi giảm không đủ lượt trống", () => {
    const t = than(db, "suaLuotQlcs");
    expect(t).toMatch(/hocVienTrongTamNhin\(actor, goc\.account\.studentId\)/);
    expect(t).toMatch(/pl\.nhom !== "QLCS_CAP" && pl\.nhom !== "QLCS_GIAM"/);
    expect(t).toMatch(/idemKey: `ADJUSTMENT:\$\{nguon\}`/);
    expect(t).toMatch(/ap !== delta/);
  });
});
