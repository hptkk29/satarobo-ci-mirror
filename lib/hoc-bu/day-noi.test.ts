import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// [HB-W] DÂY NỐI của học bù Phiên A — lưới ghim mã nguồn. Luật lượt bù có test thuần
// (`luot-bu.test.ts`, `dong-can-bu.test.ts`); ở đây khoá những CỔNG mà test thuần không chạm:
// cổng quyền, cổng "không hồi sinh dòng đã huỷ", bộ lọc danh sách, cổng sở hữu ở portal.

function boChuThich(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((d) => {
      const t = d.trim();
      return !(t.startsWith("//") || t.startsWith("/*") || t.startsWith("*"));
    })
    .join("\n");
}
const doc = (p: string) => boChuThich(fs.readFileSync(path.join(process.cwd(), p), "utf8"));
function thanHam(src: string, ten: string): string {
  const dau = src.indexOf(`export async function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const ke = src.indexOf("\nexport ", dau + 10);
  return src.slice(dau, ke === -1 ? undefined : ke);
}
const dem = (s: string, x: string) => s.split(x).length - 1;

describe("[HB-W] dây nối học bù Phiên A", () => {
  it("[HB-W1] Huỷ: hỏi makeup:waive TRƯỚC phép ghi; ghi có điều kiện PENDING + chưa huỷ", () => {
    const t = thanHam(doc("app/(admin)/admin/hoc-bu/_actions.ts"), "huyBuoiCanBuAction");
    const quyen = t.indexOf('checkPermission("makeup:waive")');
    const ghi = t.indexOf(".updateMany(");
    expect(quyen).toBeGreaterThan(-1);
    expect(ghi).toBeGreaterThan(quyen);
    expect(dem(t, ".updateMany(")).toBe(1);
    const dieuKien = t.slice(ghi, t.indexOf("data:", ghi));
    expect(dieuKien).toContain('status: "PENDING"');
    expect(dieuKien).toContain("waivedAt: null");
    // Đọc qua scopedDb (chống IDOR ghi chéo cơ sở), không qua db trần.
    expect(t).toContain("scopedDb(");
    expect(t).toContain("waivedReason: p.data.lyDo");
  });

  it("[HB-W2] sửa điểm danh KHÔNG hồi sinh dòng đã huỷ có lý do", () => {
    const t = thanHam(doc("lib/makeup/service.ts"), "createMakeupNeed");
    const vs = t.slice(t.indexOf("const revived"), t.indexOf("if (revived)"));
    expect(vs).toContain("need.waivedAt === null");
    expect(vs).toContain('need.status === "CANCELLED"');
  });

  it("[HB-W3] danh sách: bỏ dữ liệu cũ, bỏ dòng đã huỷ, bỏ khoá tắt học bù; lọc Sale ở cùng chỗ", () => {
    const src = doc("lib/hoc-bu/danh-sach-db.ts");
    const dau = src.indexOf("export function whereCanBu(");
    const loc = src.slice(dau, src.indexOf("\n}\n", dau));
    expect(loc).toContain('status: "PENDING"');
    expect(loc).toContain("waivedAt: null");
    expect(loc).toContain("createdAt: { gte: HOC_BU_TU_NGAY }");
    expect(loc).toContain("choPhepHocBu: true");
    expect(loc).toContain("student: hocVienCuaSale(loc.chiCuaSale)");
    // Cùng một `where` cho đếm và trang — lệch là số trang nói dối.
    const t = thanHam(src, "docDanhSachCanBu");
    expect(t).toContain("const where = whereCanBu(loc)");
    expect(t).toContain("sdb.makeupNeed.count({ where })");
    expect(t).toMatch(/sdb\.makeupNeed\.findMany\(\{\s*where,/);
  });

  it("[HB-W4] màn /hoc-bu gác bằng PAGE_GATES, nút Huỷ chỉ hiện khi có makeup:waive", () => {
    const t = doc("app/(admin)/admin/hoc-bu/page.tsx");
    expect(t).toContain('PAGE_GATES["/hoc-bu"]');
    expect(t).toContain('checkPermission("makeup:waive")');
    expect(t).not.toContain("parent-requests:manage");
    expect(doc("app/(admin)/admin/hoc-bu/_components/bang-can-bu.tsx")).toContain("{coTheHuy && (");
  });

  it("[HB-W5] đơn PH xin bù: tra nhu cầu qua portalDb + studentId của con đang chọn", () => {
    const t = thanHam(doc("app/(portal)/portal/yeu-cau/actions.ts"), "createParentRequest");
    const i = t.indexOf('d.type === "MAKEUP" && d.makeupNeedId');
    expect(i).toBeGreaterThan(-1);
    const khoi = t.slice(i, t.indexOf("const preferredDate", i));
    expect(khoi).toContain("pdb.makeupNeed.findFirst(");
    expect(khoi).toContain("where: { id: d.makeupNeedId, studentId }");
    expect(khoi).toContain("sessionId = need.missedSessionId");
  });

  it("[HB-W6] cấu hình khoá: kiểm học phần THẬT trước khi ghi", () => {
    const t = thanHam(doc("app/(admin)/admin/courses/[id]/_actions.ts"), "luuCauHinhHocBuAction");
    const kiem = t.indexOf("maThat.has(");
    const ghi = t.indexOf("$transaction(");
    expect(kiem).toBeGreaterThan(-1);
    expect(ghi).toBeGreaterThan(kiem);
    expect(t.indexOf("gate()")).toBeLessThan(kiem);
  });

  it("[HB-W7] luồng cũ đã gỡ: không còn xếp bé vào buổi của lớp khác từ admin", () => {
    const act = doc("app/(admin)/admin/hoc-bu/_actions.ts");
    for (const cu of ["scheduleMakeup", "suggestMakeupSessions", "completeMakeup"]) {
      expect(act, cu).not.toContain(cu);
    }
    expect(fs.existsSync(path.join(process.cwd(), "app/(admin)/admin/hoc-bu/_components/makeup-row.tsx"))).toBe(
      false,
    );
    expect(doc("app/(admin)/admin/classes/[id]/page.tsx")).not.toContain('value="makeup"');
  });

  it("[HB-W8] tạo case: kiểm dòng (nhóm + tiền) và GV TRONG CA trước transaction", () => {
    const t = thanHam(doc("lib/hoc-bu/case-db.ts"), "taoCaseVaXep");
    const kiem = t.indexOf("kiemDongXep(");
    const gv = t.indexOf("gvTrongCa(");
    const coGv = t.indexOf("gv.ds.some((g) => g.id === p.teacherId)");
    const tx = t.indexOf("db.$transaction(");
    expect(kiem).toBeGreaterThan(-1);
    expect(gv).toBeGreaterThan(kiem);
    expect(coGv).toBeGreaterThan(gv);
    expect(tx).toBeGreaterThan(coGv);
    const k = doc("lib/hoc-bu/case-db.ts");
    const kd = k.slice(k.indexOf("async function kiemDongXep("), k.indexOf("async function phanLoaiBu("));
    expect(kd).toContain("kiemNhom(");
    expect(kd).toContain("if (!d.xep.ok) throw");
  });

  it("[HB-W9] xếp bé: đổi dòng PENDING có điều kiện + đếm TRƯỚC khi tạo bé trong case", () => {
    const k = doc("lib/hoc-bu/case-db.ts");
    const f = k.slice(k.indexOf("async function ghiBeVaoCase("), k.indexOf("export async function goKhoiCase("));
    const doi = f.indexOf('status: "PENDING", waivedAt: null');
    const dem = f.indexOf("if (doi.count !== dong.length) throw");
    const tao = f.indexOf("makeupCaseStudent.createMany(");
    expect(doi).toBeGreaterThan(-1);
    expect(dem).toBeGreaterThan(doi);
    expect(tao).toBeGreaterThan(dem);
    expect(f).toContain("dungLuot: d.xep.ok && d.xep.dungLuot");
  });

  it("[HB-W10] điểm danh: có mặt ⇒ tiêu lượt theo cách xếp; vắng ⇒ về PENDING, KHÔNG tiêu lượt", () => {
    const t = thanHam(doc("lib/hoc-bu/case-db.ts"), "diemDanhBu");
    expect(t).toContain('data: { status: "COMPLETED", completedAt: now, usedQuota: cs.dungLuot }');
    expect(t).toContain('data: { status: "PENDING", completedAt: null, usedQuota: false }');
    // Có mặt ở buổi bù ⇒ buổi gốc thành CÓ MẶT nhưng giữ dấu "đã bù" (chốt 29/09).
    expect(t).toContain('data: { status: "PRESENT", makeupStatus: "MADE_UP" }');
    expect(t).toContain("cs.case.teacherId !== p.chiGiaoVien");
    // Case chỉ sinh công khi có ít nhất một bé có mặt.
    expect(t).toContain('coMat > 0 ? { status: "COMPLETED", completedAt: now } : { status: "CANCELLED" }');
  });

  it("[HB-W11] site GV: quyền điểm danh + chỉ ĐÚNG giáo viên của case", () => {
    const t = thanHam(doc("app/(teacher)/teacher/hoc-bu/_actions.ts"), "diemDanhBuGvAction");
    expect(t.indexOf('checkPermission("makeup:attend")')).toBeGreaterThan(-1);
    expect(t.indexOf('checkPermission("makeup:attend")')).toBeLessThan(t.indexOf("diemDanhBu("));
    expect(t).toContain("chiGiaoVien: session.user.id");
    expect(doc("app/(teacher)/teacher/hoc-bu/[id]/page.tsx")).toContain("docChiTietCaseChoGv(session.user.id, id)");
  });

  it("[HB-W12] Sale chỉ thấy học viên mình: màn danh sách + chi tiết case lấy phạm vi từ makeup:view-all", () => {
    const ds = doc("app/(admin)/admin/hoc-bu/page.tsx");
    expect(ds).toContain('checkPermission("makeup:view-all")');
    expect(ds).toContain("const chiCuaSale = xemTatCa ? null : session.user.id;");
    const ct = doc("app/(admin)/admin/hoc-bu/case/[id]/page.tsx");
    expect(ct).toContain("chiCuaSale: xemTatCa ? null : session.user.id");
  });

  it("[HB-W13] công dạy đọc case dạy bù ĐÃ CHỐT qua nguồn MAKEUP", () => {
    const t = thanHam(doc("lib/cham-cong/cong-day-db.ts"), "loadBuoiDay");
    expect(t).toContain("db.makeupCase.findMany(");
    expect(t).toContain('where: { status: "COMPLETED", date: { gte: from, lte: to }, teacherId: { in: userIds } }');
    expect(t).toContain('source: "MAKEUP"');
  });

  it("[HB-W14] phí bù: chỉ khi CAN_THU, đơn có phiếu thu (QR) ngay, gắn vào dòng có điều kiện", () => {
    const t = thanHam(doc("lib/hoc-bu/case-db.ts"), "taoPhiBu");
    expect(t).toContain('if (d.phi.loai !== "CAN_THU")');
    expect(t).toContain("giaMoiBuoi(khoa.price, khoa.totalSessions)");
    expect(t.indexOf("ensureFullOrderRequest(tx, order)")).toBeGreaterThan(t.indexOf("tx.order.create("));
    expect(t).toContain('type: "MAKEUP_FEE"');
    expect(t).toContain('where: { id: d.id, status: "PENDING" }');
  });

  it("[HB-W15] mọi action ghi của admin hỏi quyền ở ĐẦU hàm", () => {
    const src = doc("app/(admin)/admin/hoc-bu/_actions.ts");
    const can: [string, string][] = [
      ["taoCaseAction", 'cong("makeup:manage")'],
      ["xepVaoCaseAction", 'cong("makeup:manage")'],
      ["goKhoiCaseAction", 'cong("makeup:manage")'],
      ["diemDanhBuAction", 'cong("makeup:attend")'],
      ["nhanXetBuAction", 'cong("makeup:attend")'],
      ["huyCaseAction", 'cong("makeup:manage")'],
      ["taoPhiBuAction", 'cong("makeup:manage")'],
      ["mienPhiBuAction", 'cong("makeup:waive")'],
    ];
    for (const [ham, cong] of can) {
      const t = thanHam(src, ham);
      expect(t.indexOf(cong), ham).toBeGreaterThan(-1);
      expect(t.indexOf(cong), ham).toBeLessThan(t.indexOf("try {"));
    }
  });

  it("[HB-W16] giáo trình: chia học phần đi qua quyền giáo trình + hàm chia DUY NHẤT", () => {
    const t = thanHam(doc("app/(admin)/admin/curriculums/_actions.ts"), "chiaHocPhanAction");
    expect(t.indexOf("requireRole()")).toBeGreaterThan(-1);
    expect(t.indexOf("requireRole()")).toBeLessThan(t.indexOf("$transaction("));
    expect(t).toContain("chiaHocPhanTheoSo(cur.lessons.map((l) => l.order), p.data.soBuoiMoiHp)");
    expect(t.indexOf("if (!chia.ok) return")).toBeLessThan(t.indexOf("$transaction("));
    expect(t).toContain("archivedAt: null");
  });

  it("[HB-W17] đơn phí học bù: cổng KHÔNG trả góp đứng trước mọi phép ghi kế hoạch", () => {
    const src = doc("lib/orders/installments.ts");
    const t = thanHam(src, "recordInstallmentPlan");
    const cong = t.indexOf("if (laDonPhiHocBu(order.items)) return { ok: false");
    expect(cong).toBeGreaterThan(-1);
    expect(cong).toBeLessThan(t.indexOf("kiemKeHoachDot("));
    expect(doc("app/(admin)/admin/orders/_components/order-detail-client.tsx")).toContain("laDonPhiHocBu(order.items) ?");
  });

  it("[HB-W18] nhận xét buổi bù ghi vào buổi GỐC; cổng buổi chính vẫn nguyên cho đường thường", () => {
    const core = doc("app/(admin)/admin/sessions/[id]/_feedback-core.ts");
    expect(thanHam(core, "saveSessionEvalCore")).toContain('luuPhieuNhanXet(user, input, tuyChon, "KIEM")');
    expect(thanHam(core, "saveSessionEvalChoHocBu")).toContain('"DA_KIEM_O_HOC_BU"');
    expect(core).toContain('if (congBuoi === "KIEM") {');
    const gv = thanHam(doc("app/(teacher)/teacher/hoc-bu/_actions.ts"), "nhanXetBuGvAction");
    expect(gv.indexOf('checkPermission("makeup:attend")')).toBeLessThan(gv.indexOf("saveSessionEvalChoHocBu("));
    expect(gv).toContain("chiGiaoVien: session.user.id");
    expect(gv.indexOf("beDeNhanXet(")).toBeLessThan(gv.indexOf("saveSessionEvalChoHocBu("));
    const ad = thanHam(doc("app/(admin)/admin/hoc-bu/_actions.ts"), "nhanXetBuAction");
    expect(ad.indexOf("beDeNhanXet(")).toBeLessThan(ad.indexOf("saveSessionEvalChoHocBu("));
    expect(ad).toContain("sessionId: dich.missedSessionId");
    // Chỉ bé ĐÃ CÓ MẶT mới nhận xét được.
    expect(thanHam(doc("lib/hoc-bu/case-db.ts"), "beDeNhanXet")).toContain('if (cs.status !== "PRESENT") throw');
  });

  it("[HB-W19] SCORM: GV dạy bù mở được ĐÚNG bài của case chưa huỷ — không nới chỗ khác", () => {
    const src = doc("app/(teacher)/teacher/scorm/play/[id]/page.tsx");
    const i = src.indexOf("sdb.makeupCase.findFirst(");
    expect(i).toBeGreaterThan(-1);
    const khoi = src.slice(i, src.indexOf("canView = Boolean(dayBu)", i));
    expect(khoi).toContain('where: { teacherId: actor.userId, lessonId: pkg.lessonId, status: { not: "CANCELLED" } }');
    // Nhánh học bù đứng TRƯỚC cổng redirect và SAU các nhánh cũ.
    expect(i).toBeGreaterThan(src.indexOf("canView = Boolean(teaches)"));
    expect(i).toBeLessThan(src.indexOf('if (!canView) redirect("/teacher")'));
  });

  it("[HB-W20] gửi bài kiểm tra bù: chỉ bé CÓ MẶT, chỉ đề của ĐÚNG bài, ghi vào buổi gốc", () => {
    const t = thanHam(doc("lib/hoc-bu/tai-lieu-bu.ts"), "guiBaiKiemTraBu");
    expect(t).toContain('where: { status: "PRESENT" }');
    expect(t).toContain("lessonId: c.lessonId,");
    expect(t).toContain("classSessionId: b.missedSessionId");
    expect(t).toContain("if (p.chiGiaoVien !== null && c.teacherId !== p.chiGiaoVien) throw");
    const gv = thanHam(doc("app/(teacher)/teacher/hoc-bu/_actions.ts"), "guiBaiKiemTraBuGvAction");
    expect(gv).toContain("chiGiaoVien: session.user.id");
  });

  it("[HB-W21] site GV: màn Học bù có segment route + mục menu", async () => {
    const { TEACHER_ROUTE_SEGMENTS } = await import("@/lib/auth/route-policy");
    expect(TEACHER_ROUTE_SEGMENTS.has("hoc-bu")).toBe(true);
    expect(doc("app/(teacher)/teacher/_components/nav-config.ts")).toContain('href: "/teacher/hoc-bu"');
  });

  it("[HB-W22] màn Học bù KHÔNG truyền `sdb` làm prop cho server component (dev sập 'Invalid array length')", () => {
    // Trước bản vá: <TabCanBu sdb={sdb} …/> — React bản dev chép prop vào debug info, proxy Prisma
    // làm `_debugInfo` nở gấp đôi tới 2^27 phần tử rồi sập MỌI lượt dựng trang (đo 30/09).
    const src = doc("app/(admin)/admin/hoc-bu/page.tsx");
    expect(src).not.toMatch(/\bsdb=\{/);
    expect(src.match(/userId=\{session\.user\.id\}/g)?.length).toBe(3);
  });

  it("[HB-W23] đơn phí học bù KHÔNG bật 'thu theo con' (một bé một đơn, thu một lần)", () => {
    const src = doc("app/(admin)/admin/orders/[id]/page.tsx");
    expect(src).toContain("laDonPhiHocBu(order.items) ? false : laThuTienLinhHoatBat(order.orgUnitId)");
  });
});
