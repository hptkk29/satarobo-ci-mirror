// [XDW-*] — LƯỚI GHIM MÃ NGUỒN cho T09: mọi đường xếp lịch đi qua MỘT lõi trùng lịch, và đường GHI kiểm TRONG transaction dưới khoá hẹp.
//
// Hành vi đã có test thật trên Postgres (`tests/hoc-bu/xung-dot-lich.test.ts`) và phép so có test thuần (`lich-xung-dot.test.ts`). Thứ chúng
// KHÔNG canh: một đường xếp lịch MỚI (hoặc đường cũ bị sửa) tự dựng một phép so riêng, hay kiểm ngoài transaction, hay bỏ lõi — mọi test hành vi
// của đường đó vẫn xanh vì không ai gọi nó. Cách làm theo CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN": bóc chú thích, neo chuỗi HẸP vào LỜI GỌI,
// khẳng định THỨ TỰ (cổng đứng trước phép ghi) và đếm số lần khớp.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
const ma = (p: string) => boChuThich(doc(p));
function than(src: string, ten: string): string {
  const m = new RegExp(`(?:^|\\n)(?:export )?async function ${ten}\\(`).exec(src);
  expect(m, `không thấy hàm ${ten}`).not.toBeNull();
  const dau = m!.index;
  const ke = src.slice(dau + 10).search(/\n(?:export )?(?:async )?(?:function|const|type|interface|class) /);
  return src.slice(dau, ke === -1 ? undefined : dau + 10 + ke);
}
const vi = (s: string, x: string) => {
  const i = s.indexOf(x);
  expect(i, `không thấy "${x}"`).toBeGreaterThanOrEqual(0);
  return i;
};
/**
 * Chỗ BẮT ĐẦU phần chạy trong transaction của một hàm: lời gọi `db.$transaction(` viết thẳng, HOẶC closure nhận `tx` (đơn từ đợt 3 gom thân hàm
 * vào closure để chạy dưới `tx` của người gọi nếu có, còn không thì `db.$transaction(closure)` ở cuối hàm). Luật cần khoá là "cổng nằm TRONG
 * thân chạy dưới transaction, trước phép ghi" — KHÔNG phải "chữ `db.$transaction(` đứng trước chữ khác". Vẫn đòi hàm có mở transaction thật.
 */
const moTx = (f: string) => {
  expect(f, "hàm không mở transaction nào").toMatch(/db\.\$transaction\(/);
  const m = /db\.\$transaction\(|async \(tx(?:: Prisma\.TransactionClient)?\) =>/.exec(f);
  expect(m, "không thấy thân chạy trong transaction").not.toBeNull();
  return m!.index;
};
const dem = (s: string, x: string) => s.split(x).length - 1;

const LOI = "lib/lms/schedule-conflict.ts";
const CASE = "lib/hoc-bu/case-db.ts";
const ADJUST = "lib/classes/adjust.ts";
const SESSIONS = "app/(admin)/admin/sessions/_actions.ts";
const TRIAL_Q = "app/(admin)/admin/lop-trial/_lib/queries.ts";

describe("[XDW] T09 — một lõi trùng lịch, đường ghi kiểm trong transaction", { timeout: 30_000 }, () => {
  it("[XDW-01] MỘT quy tắc trùng: bất đẳng thức nửa-mở nằm ĐÚNG MỘT chỗ (`khoangChongLan`); không bản chép tại chỗ ở app/ + lib/", () => {
    const tep = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "app/**/*.ts", "app/**/*.tsx", "lib/**/*.ts", "lib/**/*.tsx"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter((f) => f && !/\.(test|spec)\.tsx?$/.test(f));
    expect(tep.length, "quét ra quá ít tệp — sai cwd? lưới đang không chạm tới gì").toBeGreaterThan(500);
    // Hình dạng của một phép so trùng chép tay: `x.startAt < y.endAt`, `x.endAt > y.startAt`, `a1 < b2 && b1 < a2`, hoặc hàm `overlaps(` tự định nghĩa.
    const DAU_VAN_TAY = /\bstartAt\s*<\s*\w+\.endAt|\bendAt\s*>\s*\w+\.startAt|\b\w+1\s*<\s*\w+2\s*&&\s*\w+1\s*<\s*\w+2|function overlaps\(/;
    const co = tep.filter((f) => DAU_VAN_TAY.test(ma(f)));
    expect(co, "phép so trùng tự chép — dùng `khoangChongLan` / `overlaps` của lib/lms/scheduling.ts").toEqual(["lib/lms/scheduling.ts"]);
    // Ba nơi từng chép riêng nay đều gọi primitive chung.
    expect(ma("lib/trial/lop-moi.ts")).toMatch(/khoangChongLan\(a1, a2, b1, b2\)/);
    expect(ma("lib/teachers/schedule.ts")).toMatch(/khoangChongLan\(aS, aE, bS, bE\)/);
    expect(ma("lib/lms/lich-xung-dot.ts")).toMatch(/overlaps\(m, khung\)/);
  });

  it("[XDW-02] lõi nhìn ĐỦ BA nguồn và ba chiều: `layMucLich` đọc classSession + trialClassSession + makeupCase; `layMucLichHocVien` đọc lớp + case + trial", () => {
    const s = ma(LOI);
    const l = than(s, "layMucLich");
    for (const b of ["classSession.findMany", "trialClassSession.findMany", "makeupCase.findMany"]) expect(dem(l, b), b).toBe(1);
    const h = than(s, "layMucLichHocVien");
    for (const b of ["enrollment.findMany", "makeupCaseStudent.findMany", "trialEnrollment.findMany", "classSession.findMany"]) expect(dem(h, b), b).toBeGreaterThanOrEqual(1);
    // Chỉ bản ghi còn sống: mọi truy vấn lọc CANCELLED.
    expect(dem(l, 'status: { not: "CANCELLED" }')).toBeGreaterThanOrEqual(3);
    expect(dem(h, 'status: { not: "CANCELLED" }')).toBeGreaterThanOrEqual(3);
    // Lớp đã xoá mềm và lớp trial đã huỷ bị loại.
    expect(l).toContain("deletedAt: null");
    expect(l).toContain('trialClass: { status: { not: "CANCELLED" }');
    // BATCH: không truy vấn trong vòng lặp qua học viên.
    expect(h).not.toMatch(/for \([^)]*studentIds[^)]*\) \{[^}]*findMany/);
  });

  it("[XDW-03] mọi đường CŨ nay là lớp mỏng trên lõi: `detectSessionConflicts` → `checkScheduleConflicts`, `detectBatchConflicts` → `layMucLich` + `timXungDot`; không còn truy vấn riêng", () => {
    const s = ma(LOI);
    expect(than(s, "detectSessionConflicts")).toContain("checkScheduleConflicts(");
    const b = than(s, "detectBatchConflicts");
    expect(b).toContain("layMucLich(");
    expect(b).toContain("timXungDot(");
    // Không còn tự đọc `classSession.findMany` ngoài hai hàm đọc của lõi + `tenLopCuaBuoi` (chỉ lấy TÊN lớp cho câu báo của `kiemTrungThaoTacBuoi`,
    // hotfix 09/10) (+ detectConflictsForExistingSession đọc MỘT buổi theo id).
    expect(dem(s, "classSession.findMany")).toBe(3);
    expect(dem(s, "classSession.findUnique")).toBe(1);
    expect(s).not.toMatch(/function othersWhere/);
  });

  it("[XDW-04] case dạy bù — TẠO: khoá + kiểm lịch (GV, phòng, TỪNG học viên) TRONG transaction, TRƯỚC `makeupCase.create`", () => {
    const f = than(ma(CASE), "taoCaseVaXep");
    const tx = moTx(f);
    const kiem = vi(f, "kiemLichTrongTx(tx");
    // Gọi THẲNG, không bọc trong nhánh (`if (false) await …` là cách tắt cổng mà văn bản vẫn còn nguyên).
    expect(f).toMatch(/\n\s+await kiemLichTrongTx\(tx,/);
    const ghi = vi(f, "makeupCase.create(");
    expect(tx).toBeLessThan(kiem);
    expect(kiem).toBeLessThan(ghi);
    const goi = f.slice(kiem, f.indexOf("});", kiem));
    for (const t of ["teacherId: p.teacherId", "roomId: p.roomId", "studentIds: dong.map((d) => d.studentId)"]) expect(goi, t).toContain(t);
  });

  it("[XDW-05] case dạy bù — THÊM bé: kiểm từng bé mới trong transaction TRƯỚC `ghiBeVaoCase`, loại CHÍNH case đó", () => {
    const f = than(ma(CASE), "xepVaoCaseCoSan");
    expect(vi(f, "db.$transaction(")).toBeLessThan(vi(f, "kiemLichTrongTx(tx"));
    expect(f).toMatch(/\n\s+await kiemLichTrongTx\(tx,/);
    expect(vi(f, "kiemLichTrongTx(tx")).toBeLessThan(vi(f, "ghiBeVaoCase(tx"));
    expect(f).toMatch(/exclude: \[\{ type: "MAKEUP_CASE", id: c\.id \}\]/);
  });

  it("[XDW-06] `kiemLichTrongTx`: KHOÁ trước, KIỂM sau, và kiểm bằng CHÍNH lõi (truyền `tx`, không `db` trần — kiểm ngoài transaction là TOCTOU)", () => {
    const f = than(ma(CASE), "kiemLichTrongTx");
    expect(vi(f, "khoaLichTrongTx(tx")).toBeLessThan(vi(f, "checkScheduleConflicts("));
    expect(f).toMatch(/\},\s*tx,\s*\)/);
    expect(f).toContain("throw new LoiTrungLich(");
    expect(f).toContain("dungThongDiepXungDot(");
  });

  it("[XDW-07] khoá HẸP: advisory theo (GV | phòng | học viên) × NGÀY, sắp khoá trước khi lấy, `$executeRaw` (không `$queryRaw` — hàm trả void)", () => {
    const k = than(ma(LOI), "khoaLichTrongTx");
    expect(k).toContain("$executeRaw");
    expect(k).not.toContain("$queryRaw");
    expect(k).toContain("pg_advisory_xact_lock(hashtext(");
    expect(k).toMatch(/\.sort\(\)/);
    for (const m of ["lich:gv:", "lich:phong:", "lich:hv:"]) expect(k, m).toContain(m);
    // Không phải khoá toàn cục: khoá luôn mang id + ngày.
    expect(k).not.toMatch(/hashtext\('lich'\)/);
  });

  it("[XDW-08] lớp chính — SỬA buổi (`adjustSession`): kiểm TRONG transaction, dưới khoá hẹp, trước phép ghi; không còn kiểm ngoài transaction", () => {
    const f = than(ma(ADJUST), "adjustSession");
    expect(f).not.toContain("detectSessionConflicts(");
    const tx = moTx(f);
    const khoa = vi(f, "khoaLichTrongTx(tx");
    const kiem = vi(f, "checkScheduleConflicts(");
    const ghi = vi(f, "classSession.updateMany(");
    expect(tx).toBeLessThan(khoa);
    expect(khoa).toBeLessThan(kiem);
    expect(kiem).toBeLessThan(ghi);
    expect(f).toMatch(/exclude: \[\{ type: "CLASS", id: session\.classId \}\]/);
    expect(f).toContain("dungThongDiepXungDot(");
  });

  it("[XDW-09] lớp chính — TẠO/SỬA buổi (`sessions/_actions`): dùng helper chung trên lõi đa nguồn và nói CỤ THỂ; không còn câu chung", () => {
    const s = ma(SESSIONS);
    expect(s).toContain("kiemXungDotBuoiLop(");
    expect(ma("lib/classes/xung-dot-buoi.ts")).toContain("dungThongDiepXungDot(");
    expect(s).not.toContain("detectSessionConflicts(");
    expect(s).not.toMatch(/Trùng lịch giáo viên: GV của lớp này/);
  });

  it("[XDW-10] lớp trial — note đỏ chọn GV đọc lịch bận qua `layMucLich` (ba nguồn), KHÔNG tự truy vấn từng bảng", () => {
    const s = ma(TRIAL_Q);
    const f = than(s, "buoiDaChiemTrongNgay");
    expect(f).toContain("layMucLich(");
    expect(f).not.toMatch(/\.(classSession|trialClassSession|makeupCase)\.findMany/);
    expect(s).not.toMatch(/async function buoi(Trial|LopChinh)DaChiem/);
    expect(ma("lib/trial/gv-kha-dung.ts")).toContain('"TRIAL" | "LOP_CHINH" | "HOC_BU"');
  });

  // ═══ T09-F1 / F2 ═══════════════════════════════════════════════════════════════════════════════════

  it("[XDW-11] lớp chính — TẠO/SỬA buổi: MỘT helper chung (`kiemXungDotBuoiLop`), tạo luôn kiểm học viên; sửa chỉ khi ĐỔI NGÀY / CHUYỂN LỚP", () => {
    const s = ma(SESSIONS);
    expect(s).not.toMatch(/function checkSessionScheduleConflict/);
    expect(s.split("kiemXungDotBuoiLop({").length - 1).toBe(2);
    // kiểm TRONG transaction ghi (có `tx`), dưới khoá hẹp, TRƯỚC phép ghi — và ném `LoiLichLop` để rollback
    expect(s.split(", tx });").length - 1).toBeGreaterThanOrEqual(2);
    expect(s.split('throw new LoiLichLop("XUNG_DOT_LICH", conflictMsg)').length - 1).toBe(2);
    const tao = than(s, "createSession");
    expect(vi(tao, "kiemXungDotBuoiLop({")).toBeLessThan(vi(tao, "themBuoi("));
    expect(tao).toMatch(/kiemHocVien: true/);
    const sua = than(s, "updateSession");
    expect(vi(sua, "khoaLopBuoi(tx")).toBeLessThan(vi(sua, "kiemXungDotBuoiLop({"));
    expect(vi(sua, "kiemXungDotBuoiLop({")).toBeLessThan(vi(sua, "tx.classSession.update("));
    // học viên chỉ kiểm khi ĐỔI NGÀY / CHUYỂN LỚP (`doiViTri`), đọc dưới khoá
    expect(sua).toMatch(/kiemHocVien: doiViTri, tx/);
    const h = ma("lib/classes/xung-dot-buoi.ts");
    // roster lấy MỘT lượt cho cả lớp rồi truyền một lần vào lõi; chiều học viên chỉ nhìn case dạy bù; loại cả lớp
    expect(h).toContain("layHocVienDangHocCuaLop(doc, p.classId)");
    expect(h).toContain("const doc = p.tx ?? db;");
    expect(h).toContain("teacherId, roomId, studentIds }");
    expect(h).toContain('nguonHocVien: ["MAKEUP_CASE"]');
    expect(h).toContain('{ type: "CLASS", id: p.classId }');
    expect(h).toContain("checkScheduleConflicts(");
    // đọc bằng `db` TRẦN: quyền xem không được biến thành "không thấy ⇒ không bận"
    expect(h).not.toMatch(/scopedDb/);
    // có `tx` ⇒ lấy khoá hẹp TRƯỚC khi kiểm (cùng khoá với `kiemLichTrongTx` của case dạy bù)
    expect(vi(h, "khoaLichTrongTx(p.tx, tham)")).toBeLessThan(vi(h, "checkScheduleConflicts("));
    expect(h).toContain("if (p.tx) await khoaLichTrongTx(");
    // và kiểm bằng CHÍNH `tx` (qua `doc`), không `db` trần — một ảnh chụp nhất quán với phép ghi ngay sau
    expect(h).toMatch(/exclude \}, doc\);/);
  });

  it("[XDW-12] adjustSession: học viên của lớp được kiểm khi ĐỔI NGÀY, đọc trong transaction, chỉ nguồn case dạy bù", () => {
    const f = than(ma(ADJUST), "adjustSession");
    expect(f).toMatch(/hocVien: hasDate/);
    const tx = moTx(f);
    expect(tx).toBeLessThan(vi(f, "layHocVienDangHocCuaLop(tx"));
    expect(vi(f, "layHocVienDangHocCuaLop(tx")).toBeLessThan(vi(f, "khoaLichTrongTx(tx"));
    expect(f).toContain('nguonHocVien: ["MAKEUP_CASE"]');
    expect(f).toMatch(/khoaLichTrongTx\(tx, \{ \.\.\.tham, studentIds \}\)/);
  });

  it("[XDW-13] cancelSession — BUỔI THAY THẾ đi qua lõi: tính ngày → khoá → kiểm → CHỈ SAU ĐÓ `themBuoi`, tất cả trong transaction dưới khoá lớp; trùng ⇒ ném (rollback)", () => {
    const f = than(ma(ADJUST), "cancelSession");
    const tx = moTx(f);
    const khoaLop = vi(f, "khoaLopBuoi(tx");
    const ngay = vi(f, "buildMakeupDate(");
    const khoaLich = vi(f, "khoaLichTrongTx(tx");
    const kiem = vi(f, "checkScheduleConflicts(");
    const them = vi(f, "themBuoi(");
    const audit = vi(f, "writeAudit(");
    const sukien = vi(f, "publishEvent(");
    expect(tx).toBeLessThan(khoaLop);
    expect(khoaLop).toBeLessThan(ngay);
    expect(ngay).toBeLessThan(khoaLich);
    expect(khoaLich).toBeLessThan(kiem);
    expect(kiem).toBeLessThan(them);
    expect(f).toContain("throw new LoiXungDotLich(");
    // Việc huỷ buổi cũ nằm CÙNG transaction (conditional update ở đầu) nên trùng ⇒ ném ⇒ rollback cả huỷ cũ; tạo buổi thay thế, audit và sự kiện đều SAU cổng.
    expect(kiem).toBeLessThan(audit);
    expect(kiem).toBeLessThan(sukien);
    // kiểm đủ ba chiều: GV, phòng của lớp + học viên (case dạy bù), qua `tx`, loại cả lớp
    const goi = f.slice(kiem, f.indexOf("tx,", kiem));
    expect(goi).toContain('nguonHocVien: ["MAKEUP_CASE"]');
    expect(goi).toContain('exclude: [{ type: "CLASS", id: session.classId }]');
    expect(f).toMatch(/teacherId: lopCuaBuoi\.teacherId, roomId: lopCuaBuoi\.roomId, studentIds: hocVien/);
    // cổng KHÔNG bọc trong nhánh chết: bật khi lớp có giờ, và khi có GV / phòng / học viên để so
    expect(f).toContain("if (lopCuaBuoi?.startTime) {");
    expect(f).toContain("if (tham.teacherId || tham.roomId || hocVien.length > 0) {");
    // câu lỗi nói rõ ĐÂY là buổi thay thế và nêu NGÀY
    expect(f).toContain("buổi thay thế");
  });

  it("[XDW-14] lớp trial — mọi cửa GHI có người tham gia / phòng đi qua `trialTrungHocBu` TRƯỚC phép ghi; GV vẫn là cảnh báo mềm", () => {
    const a = ma("app/(admin)/admin/lop-trial/_actions.ts");
    const cua: [string, string][] = [
      ["addLopTrialSessionAction", "addTrialSession("],
      ["updateLopTrialSessionAction", "sdb.trialClassSession.update("],
      ["enrollLeadChildLopTrialAction", "enrollLeadChild({"],
      ["xepCaseHocVienAction", "rescheduleTrialEnrollment({"],
    ];
    for (const [ham, ghi] of cua) {
      const f = than(a, ham);
      expect(dem(f, "trialTrungHocBu("), ham).toBe(1);
      expect(vi(f, "trialTrungHocBu("), ham).toBeLessThan(vi(f, ghi));
      expect(f, ham).toMatch(/if \(trung\) return \{ ok: false, error: trung \}/);
    }
    // người tham gia xác định: buổi (ghi danh ACTIVE đúng buổi) hoặc đứa trẻ cụ thể — KHÔNG phải cả lớp
    expect(than(a, "updateLopTrialSessionAction")).toContain("nguoiThamGia: doiLich ? { buoiTrialId: data.sessionId } : null");
    // cổng KHÔNG bọc trong nhánh chết: điều kiện bật nó đúng là "dời giờ HOẶC đổi phòng"
    expect(than(a, "updateLopTrialSessionAction")).toContain("if (doiLich || phongMoi !== ses.roomId) {");
    expect(than(a, "enrollLeadChildLopTrialAction")).toContain("nguoiThamGia: { leadChildIds: [input.leadChildId] }");
    expect(than(a, "xepCaseHocVienAction")).toContain("nguoiThamGia: { leadChildIds: [enr.leadChildId] }");
    const h = ma("lib/trial/xung-dot-hoc-bu.ts");
    expect(h).toContain("layHocVienCuaBuoiTrial(db,");
    expect(h).toContain("hocVienTuTre(db,");
    expect(h).toContain('nguon: ["MAKEUP_CASE"]');
    expect(h).not.toContain("teacherId"); // GV của trial: cảnh báo mềm ở note đỏ, không chặn
    expect(h).not.toMatch(/scopedDb/);
  });

  it("[XDW-15] người tham gia trial theo ĐÚNG luật `nghia-null`: ghi danh ACTIVE; chọn đúng buổi, hoặc lớp slot CŨ chưa chọn; lớp theo khung chưa xếp case thì KHÔNG; đổi sang học viên MỘT lượt", () => {
    const s = ma(LOI);
    const f = than(s, "layHocVienCuaBuoiTrial");
    expect(f).toContain('status: "ACTIVE"');
    expect(f).toMatch(/scheduledSessionId: sessionId/);
    expect(f).toMatch(/ses\.trialClass\.theoKhung \? \[\] : \[\{ scheduledSessionId: null \}\]/);
    expect(dem(f, "hocVienTuTre(")).toBe(1);
    expect(f).not.toMatch(/for \(/);
  });

  it("[XDW-16] cảnh báo hàng loạt vẫn là CẢNH BÁO (không chặn) nhưng đủ chiều học viên: bốn nơi sinh/dời truyền `hocVienCuaLop`", () => {
    for (const f of [
      "lib/classes/generate.ts",
      "lib/classes/session-sync.ts",
      "app/(admin)/admin/classes/[id]/_schedule-actions.ts",
      "app/(admin)/admin/classes/_actions.ts",
    ]) {
      const s = ma(f);
      expect(s, f).toMatch(/hocVienCuaLop: (classId|cls\.id),/);
      expect(s, f).toContain("detectBatchConflicts(");
    }
    // Không có GV/phòng thì vẫn còn học viên để va case dạy bù: các nơi không còn thoát sớm theo GV/phòng
    expect(ma("lib/classes/generate.ts")).not.toMatch(/if \(!cls\.teacherId && !cls\.roomId\) return undefined;/);
    expect(ma("lib/classes/session-sync.ts")).not.toMatch(/!cls\.teacherId && !cls\.roomId/);
    expect(ma("app/(admin)/admin/classes/[id]/_schedule-actions.ts")).not.toMatch(/!cls\.teacherId && !cls\.roomId/);
    const b = than(ma(LOI), "detectBatchConflicts");
    expect(b).toContain("layMucLichHocVien(db, studentIds, { tu, den, nguonLich: [\"MAKEUP_CASE\"] })");
  });

  it("[XDW-17] KẾT QUẢ cấu trúc đi ra ngoài đã gỡ metadata ngoài tầm nhìn: `kiemLichTrongTx` ném `LoiTrungLich` với `ketQuaAnToan(kq, p.actor)`", () => {
    const f = than(ma(CASE), "kiemLichTrongTx");
    expect(f).toMatch(/throw new LoiTrungLich\(.*ketQuaAnToan\(kq, p\.actor\)\)/);
    // máy chủ vẫn CHẶN dù người xem không đọc được: câu hỏi quyền xem chỉ đổi cách NÓI, không bao giờ đổi kết luận
    expect(f).toContain("if (!kq.coXungDot) return;");
  });
});
