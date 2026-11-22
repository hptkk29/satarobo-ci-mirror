import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// [THV-W] 20/10/2026 — DÂY NỐI của "thêm học viên vào case đã tạo". Hành vi ghi đã có test Postgres thật (`tests/hoc-bu/them-hoc-vien-vao-case.test.ts`); thứ bộ đó KHÔNG canh được là
// các cổng nằm ở lời gọi: Sale không nới bộ bài của case có bé người khác, hộp chỉ hiện nút khi máy chủ nhận, người xem chỉ thấy dòng trong phạm vi của mình. Gỡ một cổng thì không ca
// hành vi nào đỏ (Postgres test dùng actor Admin).
//
// Đọc mã ĐÃ BỎ chú thích (chú thích giải thích bản vá chứa đúng những chuỗi đang tìm) và chuẩn hoá CRLF.
const ma = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const than = (src: string, ten: string, kieu = "export async function") => {
  const dau = src.indexOf(`${kieu} ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const cuoi = src.indexOf("\n}\n", dau);
  expect(cuoi, `không thấy cuối hàm ${ten}`).toBeGreaterThan(dau);
  return src.slice(dau, cuoi);
};
const vi = (s: string, x: string, tu = 0) => {
  const i = s.indexOf(x, tu);
  expect(i, `không thấy "${x}"`).toBeGreaterThanOrEqual(0);
  return i;
};

describe("[THV-W] service: xepVaoCaseCoSan nới bộ bài", () => {
  // 24/10/2026: `xepVaoCaseCoSan` tách làm ba — QUYẾT + cổng Sale (ở nó), ĐỌC/KIỂM (`chuanBiXepVaoCase`), GHI (`thucHienXepVaoCase`, dùng chung với lượt duyệt yêu cầu). Luật không đổi, chỉ đổi chỗ ở.
  const cd = ma("lib/hoc-bu/case-db.ts");
  const x = than(cd, "xepVaoCaseCoSan");
  const chuanBi = than(cd, "chuanBiXepVaoCase", "async function");
  const f = than(cd, "thucHienXepVaoCase", "async function");

  it("[THV-W1] nới bộ bài là SỬA case: Sale không đụng case có bé của người khác — cổng đứng TRƯỚC `$transaction`, và chỉ khi có bài mới", () => {
    // Cổng Sale chỉ ở nhánh THÊM TRỰC TIẾP, chỉ khi có bài mới, và đứng TRƯỚC phép ghi (`thucHienXepVaoCase` là nơi mở giao dịch). Yêu cầu chờ duyệt thì quản lý quyết, nên không áp ở nhánh đó.
    expect(x).toContain("if (kq.baiThem.length > 0) await chanNeuCaseCoBeNguoiKhac(actor, kq.c.id);");
    expect(vi(x, "chanNeuCaseCoBeNguoiKhac(")).toBeLessThan(vi(x, "thucHienXepVaoCase("));
    expect(vi(x, "return { choDuyet: true }")).toBeLessThan(vi(x, "chanNeuCaseCoBeNguoiKhac("));
    expect(f).not.toContain("chanNeuCaseCoBeNguoiKhac(");
    // Bài mới phải thuộc khoá của case — kiểm ở bước ĐỌC/KIỂM, trước khi quyết.
    expect(chuanBi).toContain("kiemBaiThuocKhoa(db, c.courseId, baiThem)");
    expect(vi(chuanBi, "kiemBaiThuocKhoa(")).toBeLessThan(vi(chuanBi, "caseNhanThemV2("));
  });

  it("[THV-W2] bài mới chỉ tính khi `moRongBai` bật, từ chính các dòng được thêm — không nhận mã bài từ trình duyệt", () => {
    expect(chuanBi).toContain("const baiThem = p.moRongBai ? [");
    expect(chuanBi).toContain("dongChon.map((d) => d.lessonId)");
    expect(chuanBi).not.toContain("p.lessonIds");
    expect(x).not.toContain("p.lessonIds");
  });

  it("[THV-W3] trong giao dịch: khoá hàng → đọc lại trạng thái → NỚI bộ bài (cùng giao dịch, bump version) → kiểm lịch → ghi bé", () => {
    const khoa = vi(f, "FOR UPDATE");
    const trangThai = vi(f, 'song?.status !== "SCHEDULED"');
    const noi = vi(f, "await nangCapCase(tx, c.id)");
    const tao = vi(f, "tx.makeupCaseLesson.create(");
    const bump = vi(f, "version: { increment: 1 }");
    const lich = vi(f, "kiemLichTrongTx(tx");
    const ghi = vi(f, "ghiBeVaoCase(tx");
    expect([khoa, trangThai, noi, tao, bump, lich, ghi]).toEqual([...[khoa, trangThai, noi, tao, bump, lich, ghi]].sort((a, b) => a - b));
    // Mọi phép ghi của việc nới bộ bài đi qua `tx` — một lời gọi `db.makeupCaseLesson` là giao dịch thứ hai.
    expect(f).not.toMatch(/\bdb\.makeupCaseLesson\./);
    expect(f).not.toMatch(/\bdb\.makeupCase\.update/);
  });

  it("[THV-W4] bộ bài đọc LẠI trong khoá và vẫn kiểm trần 3 bài + cổng đã điểm danh trước khi ghi", () => {
    const noi = vi(f, "await nangCapCase(tx, c.id)");
    const doc = vi(f, "tx.makeupCaseLesson.findMany(", noi);
    const tran = vi(f, "kiemBoBai([...hienTai, ...moi])", doc);
    const diemDanh = vi(f, 'attendanceStatus: { in: ["PRESENT", "ABSENT"] }', tran);
    expect(diemDanh).toBeLessThan(vi(f, "tx.makeupCaseLesson.create(", diemDanh));
  });
});

describe("[THV-W5] action + hộp", () => {
  const act = ma("app/(admin)/admin/hoc-bu/_actions.ts");

  it("[THV-W5a] `xepVaoCaseAction` cho `moRongBai` đi qua schema và truyền xuống dịch vụ", () => {
    const f = than(act, "xepVaoCaseAction");
    expect(f).toContain("moRongBai: z.boolean().optional()");
    expect(f).toContain("xepVaoCaseCoSan(n.actor, { ...p.data, coQuyenDuyet })");
  });

  it("[THV-W5b] danh sách ứng viên: quyền xếp case → case trong phạm vi người xem (cả Sale) → dòng theo cơ sở + khoá CỦA CASE, cùng phạm vi Sale", () => {
    const f = than(act, "layUngVienThemVaoCaseAction");
    expect(vi(f, 'cong("makeup:manage")')).toBeLessThan(vi(f, "makeupCase.findFirst("));
    expect(f).toContain("...whereCase({ chiCuaSale: n.actor.chiCuaSale })");
    const i = vi(f, "docDongCanBuTheoKhoa(sdb, {");
    const goi = f.slice(i, f.indexOf("})", i));
    for (const t of ["centerId: c.centerId", "courseId: c.courseId", "chiCuaSale: n.actor.chiCuaSale"]) expect(goi, t).toContain(t);
    // Học viên LỚP KHÁC được vào (chủ dự án 20/10): ràng buộc chỉ là cơ sở + khoá, KHÔNG lọc theo lớp ở máy chủ.
    expect(goi).not.toContain("classId");
  });

  it("[THV-W5c] lý do khoá một dòng lấy từ CHÍNH cổng xếp (`d.xep.lyDo`) và hai luật riêng của việc thêm vào case", () => {
    const f = than(act, "layUngVienThemVaoCaseAction");
    expect(f).toContain("? d.xep.lyDo");
    expect(f).toContain("beDaDiemDanh.has(d.studentId)");
    expect(f).toContain("!trongBoBai && daCoDiemDanh");
    expect(f).toContain('c.status !== "SCHEDULED"');
  });

  it("[THV-W5d] hộp: gửi `moRongBai: true`, khoá dòng không xếp được, dùng phép đếm THUẦN, hiện xung đột có cấu trúc", () => {
    const u = ma("app/(admin)/admin/hoc-bu/case/[id]/them-hoc-vien.tsx");
    expect(u).toContain("xepVaoCaseAction({ caseId, needIds: [...chon], moRongBai: true })");
    expect(u).toContain("const khoa = !r.xepDuoc || vuotNeuChon(r);");
    expect(u).toContain("tongBaiSauKhiThem(d.soBaiCase, dsChon)");
    expect(u).toContain("vuotTranNeuChon({");
    expect(u).toContain("setXungDot(kq.xungDot ?? [])");
    expect(u).toContain("<XungDotView nhom={xungDot} />");
    expect(u).toContain("disabled={pending || chon.size === 0 || vuot}");
    // BỎ ô "Chỉ cùng lớp" (chủ dự án 21/10): danh sách luôn hiện mọi dòng cùng khoá trong phạm vi người xem.
    expect(u).not.toContain("chiCungLop");
    expect(u).not.toContain("Chỉ cùng lớp");
  });

  it("[THV-W5e] trang chi tiết: nút Thêm học viên đứng dưới ĐÚNG cổng (có quyền xếp · case còn mở · đã nâng cấp) và KHÔNG phụ thuộc 'chưa bé nào điểm danh' (khác Sửa / Huỷ)", () => {
    const p = ma("app/(admin)/admin/hoc-bu/case/[id]/page.tsx");
    expect(p).toContain("{coTheXep && mo && c.daNangCap && <NutThemHocVien caseId={c.id} />}");
    expect(p).not.toMatch(/chuaDiemDanh === c\.soBe && <NutThemHocVien/);
    expect(p).toContain('import { NutThemBuoi, NutThemHocVien } from "./them-hoc-vien";');
  });
});

describe("[THV-W6] sửa linh hoạt TỪNG BÉ trong case (nút Thêm buổi · Gỡ buổi này)", () => {
  it("[THV-W6a] 'Thêm buổi' ở thẻ bé nạp CHỈ buổi vắng của đúng bé đó: nút truyền studentId → loader lọc theo studentIds, vẫn qua phạm vi + lý do khoá", () => {
    const u = ma("app/(admin)/admin/hoc-bu/case/[id]/them-hoc-vien.tsx");
    expect(u).toContain("layUngVienThemVaoCaseAction(caseId, studentId)");
    expect(u).toContain("export function NutThemBuoi(");
    const act = ma("app/(admin)/admin/hoc-bu/_actions.ts");
    expect(act).toContain("studentIds: hv.data ? [hv.data] : undefined");
  });

  it("[THV-W6b] thẻ bé: nút chỉ vẽ khi bé CHƯA điểm danh và case còn mở; 'Gỡ buổi này' chỉ khi bé còn từ hai buổi (một buổi = gỡ cả bé, đã có nút)", () => {
    const d = ma("components/hoc-bu/diem-danh-be.tsx");
    expect(d).toContain("{themBuoi && <themBuoi.Nut caseId={themBuoi.caseId} studentId={b.studentId} hocVien={b.hocVien} />}");
    // nút Thêm buổi đứng trong nhánh `choDiemDanh` (cùng nhánh với Có mặt / Vắng / Gỡ bé)
    expect(d.indexOf("themBuoi.Nut")).toBeGreaterThan(d.indexOf("{choDiemDanh ? ("));
    expect(d.indexOf("themBuoi.Nut")).toBeLessThan(d.indexOf("hanhDong.goBe && ("));
    expect(d).toContain('onGo={b.status === "PENDING" && moDiemDanh && hanhDong.goMuc && b.muc.length > 1');
  });

  it("[THV-W6c] trang: nút và 'Gỡ buổi' chỉ truyền xuống khi có quyền xếp + case còn mở; 'Gỡ buổi' đi qua action gỡ mục có sẵn", () => {
    const p = ma("app/(admin)/admin/hoc-bu/case/[id]/page.tsx");
    expect(p).toContain("themBuoi={coTheXep && mo ? { caseId: c.id, Nut: NutThemBuoi } : undefined}");
    expect(p).toContain("goMuc: coTheXep && mo ? goMuc : undefined");
    expect(p).toContain("goKhoiCaseAction({ caseId: id, caseStudentId })");
  });

  it("[THV-W6d] gỡ buổi / gỡ bé dọn bộ bài TRONG CÙNG giao dịch, chỉ khi case còn mở, và 'sống' = status khác RELEASED (đúng định nghĩa checker TV-42)", () => {
    const cd = ma("lib/hoc-bu/case-db.ts");
    const g1 = than(cd, "goKhoiCase");
    expect(g1).toContain("if (kq.caseMoi === null) await donBaiKhongAiHoc(tx, kq.caseId);");
    const g2 = than(cd, "goBeKhoiCase");
    expect(g2).toContain("if (caseMoi === null) await donBaiKhongAiHoc(tx, be.caseId);");
    const d = than(cd, "donBaiKhongAiHoc", "async function");
    expect(d).toContain('status: { not: "RELEASED" }');
    expect(d).toContain('attendanceStatus: { in: ["PRESENT", "ABSENT"] }');
    expect(d).toContain("lessonId: giu[0]!");
  });
});
