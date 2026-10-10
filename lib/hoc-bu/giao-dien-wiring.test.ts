// lib/hoc-bu/giao-dien-wiring.test.ts — T16: LƯỚI GHIM DÂY NỐI của giao diện học bù.
//
// Test hành vi của component (`diem-danh-be.test.tsx`) không thấy được TRANG nào dùng nó, và test action không thấy được NÚT nào gọi nó. Lưới này canh các mối nối đó:
//   · cả hai trang chi tiết case đọc mô hình MỚI và không còn đường đọc / điểm danh theo mục lẻ;
//   · mọi hành động của component điểm danh được trang bind `caseId` rồi truyền xuống đúng;
//   · mọi action ghi của admin có ít nhất một nơi gọi (không có "lời hứa suông" ở tầng server);
//   · các nút mới (gỡ miễn phí · vì sao còn lượt · nâng cấp · sửa case) nối đúng action và đúng cổng quyền.
// Đọc mã đã BỎ CHÚ THÍCH (chú thích giải thích bản vá thường chứa đúng chuỗi đang tìm — bài học luật 11).
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const goc = process.cwd();
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const doc = (p: string) => boChuThich(readFileSync(resolve(goc, p), "utf8"));
const dem = (s: string, sub: string) => s.split(sub).length - 1;

const ADMIN_TRANG = "app/(admin)/admin/hoc-bu/case/[id]/page.tsx";
const GV_TRANG = "app/(teacher)/teacher/hoc-bu/[id]/page.tsx";
const ADMIN_ACT = "app/(admin)/admin/hoc-bu/_actions.ts";

function moiTep(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(resolve(goc, thuMuc))) {
    const p = join(thuMuc, ten);
    if (ten === "node_modules" || ten === ".next") continue;
    if (statSync(resolve(goc, p)).isDirectory()) moiTep(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.test\./.test(ten)) ra.push(p.replace(/\\/g, "/"));
  }
  return ra;
}

describe("[GDW] T16 — dây nối giao diện học bù", () => {
  it("[GDW-01] hai trang chi tiết case đọc mô hình MỚI; không còn đường đọc / component điểm danh theo mục lẻ", () => {
    expect(doc(ADMIN_TRANG)).toContain("docChiTietCaseV2(sdb, { caseId: id, chiCuaSale: xemTatCa ? null : session.user.id })");
    expect(doc(GV_TRANG)).toContain("docChiTietCaseV2ChoGv(session.user.id, id)");
    for (const t of [ADMIN_TRANG, GV_TRANG]) {
      const s = doc(t);
      expect(s, t).not.toContain("docChiTietCase(");
      expect(s, t).not.toContain("docChiTietCaseChoGv(");
      expect(s, t).not.toContain("DiemDanhCase");
      expect(s, t).toContain("<DiemDanhBe");
    }
    expect(existsSync(resolve(goc, "components/hoc-bu/diem-danh-case.tsx"))).toBe(false);
    const caseDoc = doc("lib/hoc-bu/case-doc.ts");
    expect(caseDoc).not.toMatch(/export (async )?function docChiTietCase/);
    expect(caseDoc).not.toContain("ghepChiTiet");
  });

  it("[GDW-02] trang ADMIN: mỗi hành động bind `caseId` cố định rồi truyền xuống; gỡ bé CHỈ khi có quyền xếp và case còn mở", () => {
    const s = doc(ADMIN_TRANG);
    expect(s).toContain("diemDanhBeAction({ caseId: id, ...p })");
    expect(s).toContain("suaDiemDanhBeAction({ caseId: id, ...p })");
    expect(s).toContain("danhGiaMucAction({ caseId: id, ...p })");
    // Đường PDF là CHUỖI (hàm thường không qua được ranh Server → Client Component — đã gặp lỗi thật 09/10).
    expect(s).toContain('hrefPhieuGoc="/hoc-bu/phieu/"');
    expect(s).not.toContain("hrefPhieu =");
    expect(s).toContain("goBeKhoiCaseAction({ caseId: id, participantId })");
    expect(s).toContain("const hanhDong: HanhDongBe = { diemDanh, sua, luuPhieu, goBe: coTheXep && mo ? goBe : undefined };");
    expect(s).toContain("coTheNhap={coTheNhap}");
    // Sale (không `makeup:attend`) chỉ XEM: tài liệu / gửi bài cũng bị khoá cùng cờ.
    expect(s).toContain("guiBai={coTheNhap ? guiBai : null}");
  });

  it("[GDW-03] trang GIÁO VIÊN: bind caseId, KHÔNG có `goBe` (giáo viên không gỡ bé), `coTheNhap` luôn bật vì action tự kiểm 'đúng giáo viên của case'", () => {
    const s = doc(GV_TRANG);
    expect(s).toContain("diemDanhBeGvAction({ caseId: id, ...p })");
    expect(s).toContain("suaDiemDanhBeGvAction({ caseId: id, ...p })");
    expect(s).toContain("danhGiaMucGvAction({ caseId: id, ...p })");
    expect(s).toContain('hrefPhieuGoc="/teacher/hoc-bu/phieu/"');
    expect(s).toContain("const hanhDong: HanhDongBe = { diemDanh, sua, luuPhieu };");
    expect(s).not.toContain("goBe");
    expect(s).toMatch(/<DiemDanhBe[^>]*\bcoTheNhap\b/);
  });

  it("[GDW-04] case đời cũ: trang chỉ hiện nút 'Nâng cấp' cho người có quyền xếp, và KHÔNG ghi gì trong lúc render", () => {
    const s = doc(ADMIN_TRANG);
    expect(s).toContain("{coTheXep && !c.daNangCap && (");
    expect(s).toContain("<NutNangCap caseId={c.id} />");
    // Trang chỉ đọc: mọi lời gọi ghi nằm trong hàm 'use server' bên trong, không phải ở thân trang.
    expect(s).not.toContain("nangCapCase(");
    expect(doc("app/(admin)/admin/hoc-bu/case/[id]/sua-case.tsx")).toContain("nangCapCaseAction(caseId)");
  });

  it("[GDW-05] Sửa / Huỷ case chỉ hiện khi: có quyền xếp · case còn mở · đã nâng cấp · CHƯA bé nào điểm danh", () => {
    const s = doc(ADMIN_TRANG);
    expect(dem(s, "coTheXep && mo && c.daNangCap && chuaDiemDanh === c.soBe")).toBe(1);
    const khoi = s.slice(s.indexOf("coTheXep && mo && c.daNangCap && chuaDiemDanh === c.soBe"));
    expect(khoi.indexOf("<NutSuaCase")).toBeGreaterThan(-1);
    expect(khoi.indexOf("<NutHuyCase")).toBeGreaterThan(khoi.indexOf("<NutSuaCase"));
  });

  it("[GDW-06] hộp sửa case chỉ gửi TRƯỜNG ĐÃ ĐỔI và kèm phiên bản (khoá lạc quan); lỗi trùng lịch hiện theo nhóm", () => {
    const s = doc("app/(admin)/admin/hoc-bu/case/[id]/sua-case.tsx");
    expect(s).toContain("phienBan: d.phienBan");
    for (const tr of ["ymd", "startTime", "endTime", "teacherId", "roomId", "note"]) {
      expect(s, tr).toMatch(new RegExp(`${tr}: .*!== d\\.`));
    }
    expect(s).toContain("setXungDot(kq.xungDot ?? [])");
    expect(s).toContain("<XungDotView nhom={xungDot} />");
  });

  it("[GDW-07] hộp xếp case: gửi bộ bài CHỈ khi thêm bài, hiện sức chứa, và hiện xung đột có cấu trúc ở CẢ HAI đường (xếp vào case có sẵn · tạo mới)", () => {
    const s = doc("app/(admin)/admin/hoc-bu/_components/hop-xep-case.tsx");
    expect(s).toContain("lessonIds: themBai.length > 0 ? [...baiCuaNhom.map((b) => b.id), ...themBai] : undefined");
    expect(s).toContain("trangThaiSucChua(needIds.length");
    expect(dem(s, "setXungDot(kq.xungDot ?? [])")).toBe(2);
    expect(dem(s, "<XungDotView nhom={xungDot} />")).toBe(2);
    // Trần 3 bài đọc từ MỘT hằng, không số 3 rải trong giao diện.
    expect(dem(s, "BAI_TOI_DA")).toBeGreaterThanOrEqual(3);
  });

  it("[GDW-08] bảng cần bù: 'gỡ miễn phí' chỉ ở dòng ĐANG miễn phí và dưới cổng huỷ/miễn phí; 'vì sao còn lượt' nối action đọc sổ", () => {
    const s = doc("app/(admin)/admin/hoc-bu/_components/bang-can-bu.tsx");
    const i = s.indexOf('d.phi.loai === "MIEN_PHI" && (');
    expect(i).toBeGreaterThan(-1);
    expect(s.indexOf("{coTheHuy && (")).toBeLessThan(i);
    expect(s.slice(i, i + 200)).toContain('loai: "GO_MIEN_PHI"');
    expect(s).toContain("await goMienPhiBuAction({ needId: hop.dong.id, lyDo })");
    expect(s).toContain("await layBienLaiLuotAction(d.id)");
    expect(s).toContain("<HopGiaiThichLuot hop={hopBienLai}");
  });

  it("[GDW-09] action đọc sổ lượt: phạm vi như danh sách (Sale chỉ học viên mình) và kiểm quyền xem TRƯỚC khi đọc sổ", () => {
    const a = doc(ADMIN_ACT);
    const t = a.slice(a.indexOf("export async function layBienLaiLuotAction"));
    const fin = t.slice(0, t.indexOf("\nexport "));
    expect(fin.indexOf('checkPermission("makeup:view")')).toBeGreaterThan(-1);
    expect(fin.indexOf('checkPermission("makeup:view")')).toBeLessThan(fin.indexOf("docBienLaiLuot("));
    expect(fin).toContain("xemTatCa ? null : session.user.id");
    // Dòng ngoài phạm vi tra bằng `docDongTheoId` TRƯỚC khi hỏi sổ — sổ lượt không bao giờ hỏi bằng id từ trình duyệt.
    expect(fin.indexOf("docDongTheoId(")).toBeLessThan(fin.indexOf("docBienLaiLuot("));
    expect(fin).toContain("studentId: d.studentId");
  });

  it("[GDW-10] component điểm danh: có mặt thì PHẢI qua `kiemKetQuaGui` trước khi gọi action (cả lần đầu lẫn sửa)", () => {
    const s = doc("components/hoc-bu/diem-danh-be.tsx");
    expect(s).toContain("kiemKetQuaGui(b.muc, chon)");
    const co = s.slice(s.indexOf("function guiCoMat()"), s.indexOf("function guiVang()"));
    expect(co.indexOf("if (!kiem.ok)")).toBeGreaterThan(-1);
    expect(co.indexOf("if (!kiem.ok)")).toBeLessThan(co.indexOf("hanhDong.diemDanh("));
    const sua = s.slice(s.indexOf("function guiSua("), s.indexOf("const pill ="));
    expect(sua.indexOf("lyDoSuaThieu(lyDo)")).toBeLessThan(sua.indexOf("hanhDong.sua!("));
    expect(sua.indexOf("coMat && !kiem.ok")).toBeLessThan(sua.indexOf("hanhDong.sua!("));
    // Vắng thì KHÔNG gửi kết quả bài nào.
    expect(s).toContain("coMat: false, ketQuaMuc: {}, nhanXetChung: null");
  });

  it("[GDW-12] NHẬN XÉT LÀ PHIẾU như bên giáo viên (không phải ô chữ): component dùng hộp thoại phiếu + PDF; hai route PDF kiểm quyền TRƯỚC khi đọc và lọc theo phạm vi", () => {
    const c = doc("components/hoc-bu/diem-danh-be.tsx");
    expect(c).toContain('import { StudentEvalDialog } from "@/app/(teacher)/teacher/lop/_components/student-eval-dialog";');
    expect(c).toContain("<StudentEvalDialog");
    expect(c).toContain("luu={(p) => hanhDong.luuPhieu!({ caseStudentId: m.id, danhGia: p.notes.overall, rubric: p.rubric })}");
    // Form điểm danh không còn ô chữ nhận xét từng bài.
    expect(c).not.toMatch(/<textarea[^>]*aria-label=\{`Đánh giá/);
    // Admin: quyền xem → phạm vi Sale/cơ sở → mới đọc.
    const ad = doc("app/(admin)/admin/hoc-bu/phieu/[caseStudentId]/route.ts");
    expect(ad.indexOf('checkPermission("makeup:view")')).toBeGreaterThan(-1);
    expect(ad.indexOf('checkPermission("makeup:view")')).toBeLessThan(ad.indexOf("sdb.makeupCaseStudent.findFirst("));
    expect(ad).toContain("case: whereCase({ chiCuaSale: xemTatCa ? null : session.user.id })");
    // Giáo viên: chỉ case MÌNH dạy.
    const gv = doc("app/(teacher)/teacher/hoc-bu/phieu/[caseStudentId]/route.ts");
    expect(gv.indexOf('checkPermission("makeup:attend")')).toBeLessThan(gv.indexOf("docMucPhieuChoGv("));
    expect(gv).toContain("docMucPhieuChoGv(session.user.id, caseStudentId)");
    expect(doc("lib/hoc-bu/phieu-muc-pdf.ts")).toContain("case: { teacherId }");
    // Cả hai: mục không thấy ⇒ 404 và dùng CÙNG bộ dựng PDF.
    for (const r of [ad, gv]) {
      expect(r).toContain("{ status: 404 }");
      expect(r).toContain("dungPdfPhieuMuc(m)");
    }
    // Phiếu rỗng không xuất được.
    expect(doc("lib/hoc-bu/phieu-muc-pdf.ts")).toContain("if (!phieuCoNoiDung(m))");
  });

  it("[GDW-11] mọi action `*Action` của admin học bù có ít nhất MỘT nơi gọi ngoài tệp của nó (không còn action mồ côi)", () => {
    const nguon = doc(ADMIN_ACT);
    const ten = [...nguon.matchAll(/export async function (\w+Action)\(/g)].map((m) => m[1]!);
    expect(ten.length).toBeGreaterThan(10);
    const tep = [...moiTep("app"), ...moiTep("components")].filter((p) => p !== ADMIN_ACT);
    const noiDung = tep.map((p) => readFileSync(resolve(goc, p), "utf8")).join("\n");
    const moCoi = ten.filter((t) => !new RegExp(`\\b${t}\\b`).test(noiDung));
    expect(moCoi).toEqual([]);
  });
});
