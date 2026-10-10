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
    // T05: đổi trạng thái đi qua `chuyenTrangThaiDong` (CÓ ĐIỀU KIỆN trạng thái cũ) chứ không `updateMany` tự viết ở action.
    const ghi = t.indexOf("chuyenTrangThaiDong(");
    expect(quyen).toBeGreaterThan(-1);
    expect(ghi).toBeGreaterThan(quyen);
    expect(dem(t, "chuyenTrangThaiDong(")).toBe(1);
    expect(t).not.toMatch(/makeupNeed\.(update|updateMany|upsert|delete|deleteMany)\(/);
    const goi = t.slice(ghi, t.indexOf("});", ghi));
    expect(goi).toContain('tu: "PENDING"');
    expect(goi).toContain('sang: "CANCELLED"');
    expect(goi).toContain('lyDo: "HUY_KHONG_BU"');
    expect(goi).toContain("ngoai: { waivedAt: null }");
    // Đọc qua scopedDb (chống IDOR ghi chéo cơ sở), không qua db trần.
    expect(t).toContain("scopedDb(");
    expect(t).toContain("waivedReason: p.data.lyDo");
    // Audit nằm TRONG giao dịch với phép chuyển (bản cũ ghi audit SAU, ngoài giao dịch).
    expect(t.indexOf("writeAudit(")).toBeGreaterThan(ghi);
    expect(t.slice(t.indexOf("writeAudit("))).toContain("tx,");
  });

  it("[HB-W2] sửa điểm danh KHÔNG hồi sinh dòng đã huỷ có lý do", () => {
    // T05: luật hồi sinh nằm ở `taoDongHocBu` (dong-service.ts); `createMakeupNeed` chỉ còn là bọc mỏng truyền cờ `reviveCancelled`.
    const w = thanHam(doc("lib/makeup/service.ts"), "createMakeupNeed");
    expect(w).toContain("taoDongHocBu(");
    expect(w).toContain("hoiSinh: params.reviveCancelled === true");
    const src = doc("lib/hoc-bu/dong-service.ts");
    const t = src.slice(src.indexOf("export async function taoDongHocBu("));
    const dk = t.slice(t.indexOf('if (dong.status === "CANCELLED"'), t.indexOf('lyDo: "HOI_SINH_VANG_LAI"'));
    expect(dk).toContain('dong.status === "CANCELLED"');
    expect(dk).toContain("dong.waivedAt === null");
    expect(dk).toContain("p.hoiSinh === true");
    // Và phép chuyển cũng tự gác `waivedAt: null` — hai lớp, hồi sinh không bao giờ đè dòng quản lý huỷ tay.
    expect(t.slice(t.indexOf('lyDo: "HOI_SINH_VANG_LAI"'), t.indexOf("them:"))).toContain("ngoai: { waivedAt: null }");
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
    // T11: tra nhu cầu chuyển vào cổng `kiemDongChoYeuCau` (lib/portal/yeu-cau-bu.ts) — luật không đổi: qua portalDb + studentId của con ĐANG CHỌN.
    expect(khoi).toContain("kiemDongChoYeuCau(pdb, { studentId, needId: d.makeupNeedId })");
    expect(khoi).toContain("sessionId = kiem.sessionId");
    const gate = doc("lib/portal/yeu-cau-bu.ts");
    expect(gate).toContain("pdb.makeupNeed.findFirst(");
    expect(gate).toContain("where: { id: p.needId, studentId: p.studentId }");
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
    // T07: GV-trong-ca + phòng gom vào MỘT hàm `kiemGvVaPhong` (dùng chung cho tạo case và sửa case) — luật không đổi: kiểm dòng, rồi GV
    // TRONG CA, rồi mới mở transaction. Hàm giữ nguyên điều kiện "GV phải nằm trong danh sách GV có ca phủ khung giờ".
    const t = thanHam(doc("lib/hoc-bu/case-db.ts"), "taoCaseVaXep");
    const kiem = t.indexOf("kiemDongXep(");
    const gv = t.indexOf("kiemGvVaPhong(");
    const tx = t.indexOf("db.$transaction(");
    expect(kiem).toBeGreaterThan(-1);
    expect(gv).toBeGreaterThan(kiem);
    expect(tx).toBeGreaterThan(gv);
    const k = doc("lib/hoc-bu/case-db.ts");
    const kg = k.slice(k.indexOf("async function kiemGvVaPhong("), k.indexOf("export async function taoCaseVaXep("));
    expect(kg).toContain("gvTrongCa(");
    expect(kg).toContain("gv.ds.some((g) => g.id === p.teacherId)");
    expect(kg.indexOf("gvTrongCa(")).toBeLessThan(kg.indexOf("gv.ds.some((g) => g.id === p.teacherId)"));
    const kd = k.slice(k.indexOf("async function kiemDongXep("), k.indexOf("async function phanLoaiBu("));
    expect(kd).toContain("kiemNhomNhieuBai(");
    expect(kd).toContain("if (!d.xep.ok) throw");
  });

  it("[HB-W9] xếp bé: đổi dòng PENDING có điều kiện + đếm TRƯỚC khi tạo bé trong case", () => {
    const k = doc("lib/hoc-bu/case-db.ts");
    const f = k.slice(k.indexOf("async function ghiBeVaoCase("), k.indexOf("export async function goKhoiCase("));
    // T05: chuyển PENDING→SCHEDULED qua `chuyenTrangThaiDong` (tự đếm và ném khi lệch số dòng) — và PHẢI đứng TRƯỚC khi tạo bé.
    const doi = f.indexOf("chuyenTrangThaiDong(");
    // T06: `createManyAndReturn` — cần id từng mục case để giữ lượt theo mục (HOLD khoá chống lặp theo `caseStudentId`).
    const tao = f.indexOf("makeupCaseStudent.createManyAndReturn(");
    expect(doi).toBeGreaterThan(-1);
    expect(tao).toBeGreaterThan(doi);
    const goi = f.slice(doi, f.indexOf("});", doi));
    expect(goi).toContain('tu: "PENDING"');
    expect(goi).toContain('sang: "SCHEDULED"');
    expect(goi).toContain('lyDo: "XEP_CASE"');
    expect(goi).toContain("ngoai: { waivedAt: null }");
    expect(f).not.toContain("makeupNeed.updateMany(");
    expect(f).toContain("dungLuot: d.xep.ok && d.xep.dungLuot");
  });

  it("[HB-W10] điểm danh: có mặt ⇒ tiêu lượt theo cách xếp; vắng ⇒ về PENDING, KHÔNG tiêu lượt", () => {
    // T07: luật "xong ⇒ tiêu lượt + dòng COMPLETED; vắng / chưa xong ⇒ nhả lượt + dòng PENDING" nằm ở BẢNG `chuyenMuc` (thuần, có test riêng
    // `case-nhieu-bai-thuan.test.ts`); `doiKetQuaMuc` chỉ làm theo bảng. Lưới này ghim phần GHI: dòng đổi qua `chuyenTrangThaiDong`
    // với cột đi kèm khớp luật lượt, buổi gốc chỉ đổi dấu `makeupStatus` (không đổi `status`), giáo viên chỉ điểm danh case của mình,
    // và case chỉ sinh công khi đã chốt COMPLETED / NO_SHOW (chốt bằng `chotCase` — xem [CNB-06]).
    const dd = doc("lib/hoc-bu/case-diem-danh-db.ts");
    const t = thanHam(dd, "doiKetQuaMuc");
    expect(t).toContain("chuyenMuc(m.result, den, m.dungLuot, ctx.lyDo)");
    expect(t).toContain("{ completedAt: ctx.now, usedQuota: m.dungLuot }");
    expect(t).toContain("{ completedAt: null, usedQuota: false }");
    expect(t).not.toMatch(/makeupNeed\.(update|updateMany)\(/);
    expect(t).toContain("chuyenTrangThaiDong(tx");
    expect(t).toContain('data: { makeupStatus: "MADE_UP" }');
    expect(t).not.toContain('data: { status: "PRESENT", makeupStatus: "MADE_UP" }');
    expect(dd).toContain("be.case.teacherId !== v.chiGiaoVien");
    expect(thanHam(dd, "chotLaiCaseTrongTx")).toContain("chotCase(c.participants)");
  });

  it("[HB-W11] site GV: quyền điểm danh + chỉ ĐÚNG giáo viên của case (cả điểm danh, sửa điểm danh, đánh giá bài)", () => {
    const tep = doc("app/(teacher)/teacher/hoc-bu/_actions.ts");
    for (const [ham, dich] of [
      ["diemDanhBeGvAction", "diemDanhBe("],
      ["suaDiemDanhBeGvAction", "suaDiemDanhBe("],
      ["danhGiaMucGvAction", "ghiDanhGiaMuc("],
    ] as const) {
      const t = thanHam(tep, ham);
      expect(t.indexOf('checkPermission("makeup:attend")'), ham).toBeGreaterThan(-1);
      expect(t.indexOf('checkPermission("makeup:attend")'), ham).toBeLessThan(t.indexOf(dich));
      expect(t, ham).toContain("chiGiaoVien: session.user.id");
    }
    // T16: đường điểm danh cũ theo MỤC lẻ đã gỡ khỏi site GV — còn lại chỉ đường hai tầng.
    expect(tep).not.toContain("diemDanhBuGvAction");
    expect(tep).not.toContain("nhanXetBuGvAction");
    expect(doc("app/(teacher)/teacher/hoc-bu/[id]/page.tsx")).toContain("docChiTietCaseV2ChoGv(session.user.id, id)");
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
    // T07: case ĐÃ DẠY = COMPLETED (có bé có mặt) hoặc NO_SHOW (giáo viên dạy mà mọi bé vắng) — cả hai có công; CANCELLED thì không.
    // T12: danh sách trạng thái có công nằm ở MỘT hằng (`TRANG_THAI_CASE_CO_CONG` = COMPLETED + NO_SHOW), dùng chung với bản chốt kỳ.
    expect(t).toContain("where: { status: { in: [...TRANG_THAI_CASE_CO_CONG] }, date: { gte: from, lte: to }, teacherId: { in: userIds } }");
    expect(doc("lib/cham-cong/buoi-bu-ky.ts")).toContain('export const TRANG_THAI_CASE_CO_CONG = ["COMPLETED", "NO_SHOW"] as const;');
    expect(t).toContain('source: "MAKEUP"');
  });

  it("[HB-W14] phí bù: chỉ khi CAN_THU, đơn có phiếu thu (QR) ngay, gắn vào dòng có điều kiện", () => {
    const t = thanHam(doc("lib/hoc-bu/case-db.ts"), "taoPhiBu");
    expect(t).toContain('if (d.phi.loai !== "CAN_THU")');
    expect(t).toContain("giaMoiBuoi(khoa.price, khoa.totalSessions)");
    expect(t.indexOf("ensureFullOrderRequest(tx, order)")).toBeGreaterThan(t.indexOf("tx.order.create("));
    expect(t).toContain('type: "MAKEUP_FEE"');
    // T02 (HB-17): con trỏ phí ghi theo kiểu SO-VÀ-ĐỔI — chỉ đổi khi dòng vẫn PENDING, chưa miễn phí, và con trỏ vẫn là
    // giá trị đã đọc trong khoá hàng. Chi tiết khoá + so-và-đổi ghim ở `diem-danh-wiring.test.ts` [DDW-06].
    expect(t).toContain('where: { id: d.id, status: "PENDING", freeApprovedAt: null, feeOrderItemId: dong.feeOrderItemId }');
  });

  it("[HB-W15] mọi action ghi của admin hỏi quyền ở ĐẦU hàm", () => {
    const src = doc("app/(admin)/admin/hoc-bu/_actions.ts");
    const can: [string, string][] = [
      ["taoCaseAction", 'cong("makeup:manage")'],
      ["xepVaoCaseAction", 'cong("makeup:manage")'],
      ["goKhoiCaseAction", 'cong("makeup:manage")'],
      ["diemDanhBeAction", 'cong("makeup:attend")'],
      ["suaDiemDanhBeAction", 'cong("makeup:attend")'],
      ["danhGiaMucAction", 'cong("makeup:attend")'],
      ["goBeKhoiCaseAction", 'cong("makeup:manage")'],
      ["suaCaseAction", 'cong("makeup:manage")'],
      ["nangCapCaseAction", 'cong("makeup:manage")'],
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
    const gv = thanHam(doc("app/(teacher)/teacher/hoc-bu/_actions.ts"), "danhGiaMucGvAction");
    // T07 (đảo chốt 29/09): đánh giá bài của bé lưu ở MỤC của case (`ghiDanhGiaMuc`), KHÔNG ghi vào phiếu của buổi vắng gốc.
    expect(gv.indexOf('checkPermission("makeup:attend")')).toBeLessThan(gv.indexOf("ghiDanhGiaMuc("));
    expect(gv).toContain("chiGiaoVien: session.user.id");
    expect(gv).not.toContain("saveSessionEvalChoHocBu");
    const ad = thanHam(doc("app/(admin)/admin/hoc-bu/_actions.ts"), "danhGiaMucAction");
    expect(ad).toContain("ghiDanhGiaMuc(");
    expect(ad).not.toContain("saveSessionEvalChoHocBu");
    // Chỉ bé ĐÃ CÓ MẶT (mục xong / chưa xong) mới được đánh giá; không đụng bảng phiếu nhận xét của buổi chính.
    const dg = thanHam(doc("lib/hoc-bu/case-diem-danh-db.ts"), "ghiDanhGiaMuc");
    expect(dg).toContain('m.result !== "COMPLETED" && m.result !== "NOT_COMPLETED"');
    expect(dg).not.toMatch(/studentSessionFeedback|saveSessionEval/);
  });

  it("[HB-W19] SCORM: GV dạy bù mở được ĐÚNG bài của case chưa huỷ — không nới chỗ khác", () => {
    const src = doc("app/(teacher)/teacher/scorm/play/[id]/page.tsx");
    const i = src.indexOf("sdb.makeupCase.findFirst(");
    expect(i).toBeGreaterThan(-1);
    const khoi = src.slice(i, src.indexOf("canView = Boolean(dayBu)", i));
    // T07: case dạy 1–3 bài ⇒ GV mở được MỌI bài trong bộ bài của case mình dạy (bài chính HOẶC bài trong `MakeupCaseLesson`).
    expect(khoi).toContain("teacherId: actor.userId,");
    expect(khoi).toContain('status: { not: "CANCELLED" },');
    expect(khoi).toContain("OR: [{ lessonId: pkg.lessonId }, { lessons: { some: { lessonId: pkg.lessonId } } }],");
    // Nhánh học bù đứng TRƯỚC cổng redirect và SAU các nhánh cũ.
    expect(i).toBeGreaterThan(src.indexOf("canView = Boolean(teaches)"));
    expect(i).toBeLessThan(src.indexOf('if (!canView) redirect("/teacher")'));
  });

  it("[HB-W20] gửi bài kiểm tra bù: chỉ bé CÓ MẶT, chỉ đề của ĐÚNG bài, ghi vào buổi gốc", () => {
    const t = thanHam(doc("lib/hoc-bu/tai-lieu-bu.ts"), "guiBaiKiemTraBu");
    // T07: chỉ bé đã HỌC XONG bài của đề (mục COMPLETED), đề phải thuộc BỘ BÀI của case.
    expect(t).toContain('where: { result: "COMPLETED" }');
    expect(t).toContain("lessonId: { in: baiCase },");
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
