// [YCW-*] — LƯỚI GHIM MÃ NGUỒN cho "thêm học viên khác vào case có sẵn phải qua quản lý cơ sở duyệt" (24/10/2026).
//
// Test hành vi (`tests/hoc-bu/yeu-cau-them-be.test.ts`) chứng minh luật chạy đúng khi được gọi. Thứ nó KHÔNG canh: một đường gọi MỚI của `xepVaoCaseCoSan` quên khai quyền duyệt
// (hoặc truyền thẳng `true`), cổng bé-mới ở lớp thấp nhất bị gỡ, phép nhận yêu cầu dời ra ngoài giao dịch, hay cờ `boQuaYeuCauMo` bị dùng ở chỗ khác ngoài lượt duyệt.
// Mỗi ca neo vào BIỂU THỨC của luật, không neo vào chỗ đặt chữ (bài học `[NDC-07]`).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((d) => (d.trim().startsWith("//") ? "" : d.replace(/\s\/\/ .*$/, "")))
    .join("\n");
const ma = (p: string) => boChuThich(doc(p));
function than(src: string, ten: string): string {
  const m = new RegExp(`(?:^|\\n)(?:export )?async function ${ten}\\(`).exec(src);
  expect(m, `không thấy hàm ${ten}`).not.toBeNull();
  const dau = m!.index;
  const ke = src.slice(dau + 10).search(/\n(?:\/\*\*|export (?:async )?function|(?:async )?function|export const|const|type|interface) /);
  return src.slice(dau, ke === -1 ? undefined : dau + 10 + ke);
}
function tepTs(dir: string): string[] {
  const ra: string[] = [];
  for (const t of readdirSync(resolve(process.cwd(), dir))) {
    const d = join(dir, t);
    if (statSync(resolve(process.cwd(), d)).isDirectory()) ra.push(...tepTs(d));
    else if (/\.tsx?$/.test(t) && !/\.test\.tsx?$/.test(t)) ra.push(d.split("\\").join("/"));
  }
  return ra;
}
const dem = (s: string, chuoi: string) => s.split(chuoi).length - 1;

const CD = "lib/hoc-bu/case-db.ts";
const ACT = "app/(admin)/admin/hoc-bu/_actions.ts";

describe("[YCW] thêm học viên vào case có sẵn — dây nối của luật duyệt", { timeout: 60_000 }, () => {
  it("[YCW-01] MỌI nơi gọi `xepVaoCaseCoSan` (mã chạy thật) khai `coQuyenDuyet` — và chỉ action truyền giá trị đọc từ quyền thật, không phải hằng `true`", () => {
    const tep = [...tepTs("lib"), ...tepTs("app"), ...tepTs("prisma")];
    const goi: string[] = [];
    for (const t of tep) {
      const src = ma(t);
      for (const m of src.matchAll(/xepVaoCaseCoSan\(/g)) {
        const sau = src.slice(m.index, m.index + 260);
        // Định nghĩa hàm không phải lời gọi.
        if (/^xepVaoCaseCoSan\(\s*\n?\s*actor: NguoiHocBu/.test(sau)) continue;
        goi.push(t);
        expect(sau, `${t}: lời gọi xepVaoCaseCoSan phải khai coQuyenDuyet`).toContain("coQuyenDuyet");
      }
    }
    // Mã chạy thật gọi từ MỘT chỗ: action của admin (đọc quyền thật). Ngoài ra chỉ có script nghiệm thu UAT chạy tay trên DB dev, đóng vai quản trị.
    expect(goi.filter((t) => t !== CD).sort()).toEqual([ACT, "prisma/seed-uat/chay-nghiem-thu-gop.ts"].sort());
    const a = ma(ACT);
    const thanh = than(a, "xepVaoCaseAction");
    expect(thanh).toContain('const coQuyenDuyet = await checkPermission("makeup:waive");');
    expect(thanh).toContain("xepVaoCaseCoSan(n.actor, { ...p.data, coQuyenDuyet })");
    expect(dem(thanh, "checkPermission("), "đọc quyền ĐÚNG một lần").toBe(1);
    expect(thanh).not.toMatch(/coQuyenDuyet:\s*true/);
  });

  it("[YCW-02] cổng ở LỚP THẤP NHẤT: `thucHienXepVaoCase` từ chối bé mới khi không có quyền duyệt (đọc lại người tham gia TRONG khoá hàng case); `xepVaoCaseCoSan` truyền đúng quyền, lượt duyệt truyền `true`", () => {
    const c = ma(CD);
    const g = than(c, "thucHienXepVaoCase");
    expect(g).toMatch(/!opts\.choPhepBeMoi && beMoiTrongLo\(/);
    expect(g).toContain("phải qua quản lý cơ sở duyệt");
    // Đọc lại người tham gia trong giao dịch, SAU khi khoá hàng case.
    expect(g.indexOf('FOR UPDATE')).toBeGreaterThanOrEqual(0);
    expect(g.indexOf("!opts.choPhepBeMoi")).toBeGreaterThan(g.indexOf("FOR UPDATE"));
    expect(g).toContain("participants: { select: { studentId: true, attendanceStatus: true } }");
    expect(than(c, "xepVaoCaseCoSan")).toContain("thucHienXepVaoCase(actor, kq, { choPhepBeMoi: p.coQuyenDuyet })");
    expect(than(c, "duyetYeuCauThemBe")).toContain("choPhepBeMoi: true");
    expect(dem(c, "choPhepBeMoi: true"), "chỉ lượt DUYỆT được cho phép bé mới vô điều kiện").toBe(1);
  });

  it("[YCW-03] quyết định thêm-ngay / chờ-duyệt dùng ĐÚNG `quyetDinhThemVaoCase` ở máy chủ, danh sách chọn case và hộp thêm học viên (một luật, ba nơi); `CHO_DUYET` đi vào `guiYeuCauThemBe`, không chạm phép ghi bé", () => {
    const x = than(ma(CD), "xepVaoCaseCoSan");
    expect(x).toContain("quyetDinhThemVaoCase({ coQuyenDuyet: p.coQuyenDuyet, soBeMoi: kq.beMoi.length })");
    const iGui = x.indexOf("guiYeuCauThemBe(");
    const iGhi = x.indexOf("thucHienXepVaoCase(");
    expect(iGui).toBeGreaterThanOrEqual(0);
    expect(iGhi).toBeGreaterThan(iGui); // nhánh chờ duyệt `return` TRƯỚC khi tới phép ghi bé
    expect(x.slice(iGui, iGhi)).toContain("return { choDuyet: true }");
    expect(ma(ACT)).toContain("quyetDinhThemVaoCase({");
    expect(ma("app/(admin)/admin/hoc-bu/case/[id]/them-hoc-vien.tsx")).toContain("quyetDinhThemVaoCase({ coQuyenDuyet: d.coQuyenDuyet");
  });

  it("[YCW-04] phép NHẬN yêu cầu (PENDING → APPROVED) nằm TRONG giao dịch xếp bé, TRƯỚC `ghiBeVaoCase`: hai người duyệt cùng lúc thì người sau rollback; nhận xong mà xếp lỗi thì yêu cầu vẫn PENDING", () => {
    const g = than(ma(CD), "thucHienXepVaoCase");
    const iNhan = g.indexOf("makeupCaseAddRequest.updateMany(");
    const iGhi = g.indexOf("ghiBeVaoCase(tx");
    const iTx = g.indexOf("$transaction(");
    expect(iTx).toBeGreaterThanOrEqual(0);
    expect(iNhan).toBeGreaterThan(iTx);
    expect(iGhi).toBeGreaterThan(iNhan);
    expect(g).toContain('status: "PENDING" }');
    expect(g).toMatch(/nhan\.count !== opts\.lo\.soDong\) throw new LoiHocBu/);
  });

  it("[YCW-05] cờ `boQuaYeuCauMo` (tính lại `xep` không kể yêu cầu đang duyệt) chỉ bật Ở MỘT chỗ: lượt duyệt. Mặc định tắt ⇒ dòng đang có yêu cầu bị khoá ở mọi cửa khác", () => {
    let n = 0;
    for (const t of [...tepTs("lib"), ...tepTs("app")]) n += dem(ma(t), "boQuaYeuCauMo: true");
    expect(n).toBe(1);
    expect(than(ma(CD), "duyetYeuCauThemBe")).toContain("boQuaYeuCauMo: true");
    expect(ma(CD)).toContain("opts.boQuaYeuCauMo ? goc.map(");
    const d = ma("lib/hoc-bu/danh-sach-db.ts");
    expect(d).toContain("xep: yeuCauMo.has(n.id) ? { ok: false, lyDo: LY_DO_DANG_CHO_DUYET_THEM } : duocXep(phi)");
    expect(d).toContain("docYeuCauMoCuaDong(needs.map((n) => n.id))");
  });

  it("[YCW-06] cổng quyền của ba action: duyệt / từ chối = `makeup:waive`; rút = `makeup:manage` (cùng quyền gửi, máy chủ còn đòi đúng người gửi)", () => {
    const a = ma(ACT);
    expect(than(a, "duyetThemBeAction")).toContain('cong("makeup:waive")');
    expect(than(a, "tuChoiThemBeAction")).toContain('cong("makeup:waive")');
    expect(than(a, "rutThemBeAction")).toContain('cong("makeup:manage")');
    const y = ma("lib/hoc-bu/yeu-cau-them-be-db.ts");
    expect(than(y, "rutYeuCauThemBe")).toContain("lo.proposedById !== actor.userId");
    expect(than(y, "tuChoiYeuCauThemBe")).toContain("LY_DO_TOI_THIEU");
    // Đọc lô qua `scopedDb`: quản lý cơ sở khác không thấy lô của cơ sở này.
    expect(y).toContain("scopedDb(actor)");
  });

  it("[YCW-07] huỷ case đóng yêu cầu chờ của nó TRONG giao dịch huỷ; gửi yêu cầu tự set cơ sở của CASE (scopedDb không che write) và khoá thông báo theo LÔ", () => {
    const h = than(ma(CD), "huyCase");
    expect(h.indexOf("huyYeuCauKhiHuyCase(tx")).toBeGreaterThan(h.indexOf("$transaction("));
    const y = ma("lib/hoc-bu/yeu-cau-them-be-db.ts");
    const gui = than(y, "guiYeuCauThemBe");
    expect(gui).toContain("centerId: p.c.centerId");
    expect(gui).toContain("phatYeuCauThemBe(tx, { caseId: p.c.id, batchId })");
    expect(ma("lib/hoc-bu/su-kien.ts")).toContain("dedupeKey: khoaSuKien.yeuCauThemBe(p.batchId)");
  });

  it("[YCW-08] ba sự kiện mới có handler đăng ký và mục catalog (thiếu handler ⇒ tin không bao giờ gửi, không lỗi nào báo)", () => {
    const hd = ma("lib/_handlers/hoc-bu-case-notif.ts");
    for (const k of ["YEU_CAU_THEM_BE", "YEU_CAU_THEM_BE_DUYET", "YEU_CAU_THEM_BE_TU_CHOI"]) expect(hd, k).toMatch(new RegExp(`on\\(SU_KIEN\\.${k},`));
    const cat = doc("lib/notifications/catalog.ts");
    for (const k of ["makeup.case.add-request:", "makeup.case.add-approved:", "makeup.case.add-rejected:"]) expect(cat, k).toContain(`"${k}"`);
  });

  it("[YCW-09] nút trên giao diện nói thật: hộp 'Xếp case' đổi nhãn theo `seChoDuyet` do máy chủ tính; hộp 'Thêm học viên' đổi nhãn + toast theo `choDuyet` máy chủ trả về", () => {
    expect(ma("app/(admin)/admin/hoc-bu/_components/hop-xep-case.tsx")).toContain("c.seChoDuyet ? NHAN_GUI_DUYET");
    expect(ma("app/(admin)/admin/hoc-bu/_components/hop-xep-case.tsx")).toContain("kq.choDuyet ?");
    const t = ma("app/(admin)/admin/hoc-bu/case/[id]/them-hoc-vien.tsx");
    expect(t).toContain("kq.choDuyet");
    expect(t).toContain("NHAN_GUI_DUYET");
    expect(than(ma(ACT), "layLuaChonCaseAction")).toContain("seChoDuyet");
    // Bảng Cần bù: nút "Xếp case" ẩn khi dòng không xếp được — dòng đang chờ duyệt phải có nhãn nói vì sao.
    expect(ma("app/(admin)/admin/hoc-bu/_components/bang-can-bu.tsx")).toContain("{d.yeuCauThemMo && <StatusPill tone=\"warning\">Chờ QLCS duyệt thêm vào case</StatusPill>}");
  });
});
