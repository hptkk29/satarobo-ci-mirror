import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRANG_THAI_CASE_CO_CONG } from "@/lib/cham-cong/buoi-bu-ky";
import { PAGE_GATES } from "@/lib/auth/page-gates";

// [DCW] 20/10/2026 — DÂY NỐI của "case chờ duyệt" (Sale tạo ⇒ quản lý cơ sở duyệt ⇒ mới thành lịch thật, giáo viên mới thấy).
//
// Hành vi ghi đã có test Postgres thật với Sale / quản lý cơ sở thật (`tests/hoc-bu/duyet-case.test.ts`, `phan-quyen-action.test.ts` PQA-03/08/09). Thứ chúng KHÔNG canh:
//   · thêm một giá trị vào enum KHÔNG làm `tsc` đỏ ở mọi chỗ đọc: chỗ lọc `status: "SCHEDULED"` tự khép kín, nhưng chỗ lọc `not CANCELLED` hay KHÔNG lọc status thấy case chờ duyệt như một lịch
//     thật — giáo viên thấy lịch chưa duyệt, bảng chứng công in một buổi không ai được giao. Một chỗ ĐỌC MỚI quên lọc không làm ca hành vi nào đỏ ⇒ [DCW-01] quét cả cây;
//   · cổng quyền `makeup:waive` ở ba action duyệt, và việc `taoCaseAction` suy "có quyền duyệt" từ QUYỀN THẬT (không phải hằng `true`);
//   · thứ tự các bước trong dịch vụ (khoá → kiểm lại → ghi → phát tin).
//
// Đọc mã ĐÃ BỎ chú thích (chú thích giải thích bản vá chứa đúng những chuỗi đang tìm) và chuẩn hoá CRLF.
const ma = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Thân MỘT hàm: từ khai báo (cột 0) tới khai báo kế tiếp ở cột 0. */
const than = (src: string, ten: string): string => {
  const mo = [`\nexport async function ${ten}(`, `\nasync function ${ten}(`, `\nexport function ${ten}(`].map((k) => src.indexOf(k)).find((i) => i >= 0);
  expect(mo, `không thấy hàm ${ten}`).toBeDefined();
  const sau = src.slice(mo! + 1).search(/\n(export )?(async )?function |\nexport (const|type) /);
  return src.slice(mo!, sau < 0 ? undefined : mo! + 1 + sau + 1);
};
const vi = (s: string, x: string, tu = 0) => {
  const i = s.indexOf(x, tu);
  expect(i, `không thấy "${x}"`).toBeGreaterThanOrEqual(0);
  return i;
};
const dem = (s: string, x: string) => s.split(x).length - 1;

function tepNguon(thuMuc: string): string[] {
  const ra: string[] = [];
  for (const t of readdirSync(resolve(process.cwd(), thuMuc))) {
    if (t === "node_modules" || t === ".next" || t.startsWith(".")) continue;
    const d = join(thuMuc, t);
    if (statSync(resolve(process.cwd(), d)).isDirectory()) ra.push(...tepNguon(d));
    else if (/\.tsx?$/.test(t) && !/\.(test|spec)\.tsx?$/.test(t)) ra.push(d.split("\\").join("/")); // Windows: `join` ra dấu \
  }
  return ra;
}

/**
 * MỌI tệp nguồn (app · lib · components — KHÔNG quét `scripts/`: script vận hành không lên repo gương, và không đưa case cho ai) đọc `makeupCase` (`.find*` · `.count` · `.groupBy` · `.aggregate`) PHẢI có tên ở đây kèm LÝ DO — thêm một chỗ đọc mới mà quên phân loại là đỏ ngay.
 *   · LOC            — đưa case cho giáo viên / công / phân công: phải loại case chờ duyệt (tệp phải nhắc `CASE_KHONG_PHAI_LICH_THAT` hoặc `CASE_CHO_DUYET`).
 *   · CHI_DA_CHOT    — chỉ đọc case đã chốt (COMPLETED / NO_SHOW) nên không bao giờ thấy case chờ duyệt.
 *   · CHI_SCHEDULED  — chỉ đọc `status: "SCHEDULED"`.
 *   · THEO_ID        — đọc theo id mà một phân công / công đã trỏ tới; case chờ duyệt chưa có phân công (`danhDauCanDongBo` chỉ chạy lúc duyệt).
 *   · THAY_CHO_DUYET — CỐ Ý thấy case chờ duyệt: màn / dịch vụ quản trị, sổ kiểm, lõi trùng lịch (case chờ duyệt vẫn GIỮ CHỖ giáo viên · phòng · bé).
 */
type Loai = "LOC" | "CHI_DA_CHOT" | "CHI_SCHEDULED" | "THEO_ID" | "THAY_CHO_DUYET";
const PHAN_LOAI: Record<string, Loai> = {
  "app/(teacher)/teacher/scorm/play/[id]/page.tsx": "LOC",
  "lib/hoc-bu/case-chi-tiet.ts": "LOC",
  "lib/hoc-bu/case-doc.ts": "LOC",
  "lib/parttime/bang-chung-cong-db.ts": "LOC",
  "lib/parttime/bang-phan-cong.ts": "LOC",
  "lib/parttime/chay-bong-db.ts": "LOC",
  "lib/cham-cong/cong-day-db.ts": "CHI_DA_CHOT",
  "lib/cham-cong/period.ts": "CHI_DA_CHOT",
  "lib/hoc-bu/nhac-db.ts": "CHI_SCHEDULED",
  "lib/parttime/bao-cao-thang-db.ts": "THEO_ID",
  "lib/parttime/don-vi-tiet-db.ts": "THEO_ID",
  "lib/parttime/ngu-canh-cham-cong-db.ts": "THEO_ID",
  // Lệnh dọn lời mời cũ (20/10/2026): đọc trạng thái buổi THEO sourceId của lời mời đã có.
  "lib/parttime/don-loi-moi-db.ts": "THEO_ID",
  "lib/parttime/phan-cong-db.ts": "THEO_ID",
  "lib/parttime/workunit-db.ts": "THEO_ID",
  // Màn Phân công gộp (27/10/2026): đọc case theo id của buổi đang giao để ghi cột GV gốc; case không còn SCHEDULED (chờ duyệt…) ⇒ TỪ CHỐI, không ghi.
  "app/(admin)/admin/curriculums/[id]/edit/page.tsx": "THAY_CHO_DUYET",
  "app/(admin)/admin/hoc-bu/_actions.ts": "THAY_CHO_DUYET",
  "app/(admin)/admin/hoc-bu/page.tsx": "THAY_CHO_DUYET",
  "lib/hoc-bu/bao-gv-db.ts": "THAY_CHO_DUYET",
  "lib/hoc-bu/case-db.ts": "THAY_CHO_DUYET",
  "lib/hoc-bu/case-diem-danh-db.ts": "THAY_CHO_DUYET",
  "lib/hoc-bu/case-nang-cap-db.ts": "THAY_CHO_DUYET",
  "lib/hoc-bu/phu-thuoc.ts": "THAY_CHO_DUYET",
  "lib/hoc-bu/sua-du-lieu-db.ts": "THAY_CHO_DUYET",
  "lib/hoc-bu/tai-lieu-bu.ts": "THAY_CHO_DUYET",
  "lib/hoc-bu/thong-bao-db.ts": "THAY_CHO_DUYET",
  "lib/hoc-bu/toan-ven-db.ts": "THAY_CHO_DUYET",
  // Màn Duyệt (24/10/2026): đọc case đích của một yêu cầu thêm học viên để hiện ngày giờ + trạng thái — quản trị, không đưa case cho ai.
  "lib/hoc-bu/yeu-cau-them-be-db.ts": "THAY_CHO_DUYET",
  "lib/lms/schedule-conflict.ts": "THAY_CHO_DUYET",
};
const DOC_CASE = /makeupCase\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|groupBy|aggregate)\b/;

describe("[DCW] case chờ duyệt — dây nối", { timeout: 60_000 }, () => {
  it("[DCW-01] MỌI chỗ đọc `makeupCase` đã được PHÂN LOẠI: chỗ đưa case cho giáo viên / công / phân công loại case chờ duyệt; chỗ còn lại có lý do để thấy nó", () => {
    const thay = ["app", "lib", "components"].flatMap(tepNguon).filter((f) => DOC_CASE.test(ma(f)));
    expect(thay.sort()).toEqual(Object.keys(PHAN_LOAI).sort());
    for (const [f, loai] of Object.entries(PHAN_LOAI)) {
      const src = ma(f);
      if (loai === "LOC") expect(src, `${f} đưa case cho GV / công / phân công — phải loại case chờ duyệt`).toMatch(/CASE_KHONG_PHAI_LICH_THAT|CASE_CHO_DUYET/);
      if (loai === "CHI_SCHEDULED") expect(src, f).toContain('status: "SCHEDULED"');
      if (loai === "CHI_DA_CHOT") expect(src, f).toContain("TRANG_THAI_CASE_CO_CONG");
    }
  });

  it("[DCW-02] công dạy chỉ tính case ĐÃ CHỐT (COMPLETED / NO_SHOW) — case chờ duyệt không bao giờ có công", () => {
    expect([...TRANG_THAI_CASE_CO_CONG]).toEqual(["COMPLETED", "NO_SHOW"]);
  });

  it("[DCW-03] từng chỗ LOC dùng ĐÚNG biểu thức loại: lịch GV · chi tiết GV · học liệu SCORM · phiếu PDF của GV loại cả huỷ lẫn chờ duyệt; ba bảng parttime chỉ loại chờ duyệt (vẫn hiện case huỷ như cũ)", () => {
    const doc = ma("lib/hoc-bu/case-doc.ts");
    expect(than(doc, "caseCuaGiaoVien")).toContain("status: { notIn: [...CASE_KHONG_PHAI_LICH_THAT] }");
    // danh sách Học bù của GV chỉ lấy SCHEDULED + đã chốt — không có trạng thái chờ duyệt
    expect(than(doc, "danhSachCaseGv")).toContain('{ status: "SCHEDULED" }');
    expect(than(ma("lib/hoc-bu/case-chi-tiet.ts"), "docChiTietCaseV2ChoGv")).toContain("status: { notIn: [...CASE_KHONG_PHAI_LICH_THAT] }");
    expect(ma("app/(teacher)/teacher/scorm/play/[id]/page.tsx")).toContain("status: { notIn: [...CASE_KHONG_PHAI_LICH_THAT] },");
    expect(ma("lib/hoc-bu/phieu-muc-pdf.ts")).toContain("case: { teacherId, status: { not: CASE_CHO_DUYET } }");
    for (const f of ["lib/parttime/bang-chung-cong-db.ts", "lib/parttime/bang-phan-cong.ts", "lib/parttime/chay-bong-db.ts"]) {
      expect(dem(ma(f), "status: { not: CASE_CHO_DUYET }"), f).toBe(1);
    }
  });

  it("[DCW-04] kết quả buổi (phụ huynh · hồ sơ · điểm danh): mục trong case chờ duyệt KHÔNG vào lịch sử, và dòng chỉ bị giữ chỗ bởi case chờ duyệt vẫn đọc là 'chờ xếp'", () => {
    const k = than(ma("lib/hoc-bu/ket-qua-buoi.ts"), "dungKetQuaBuoi");
    expect(k).toContain('.filter((m) => m.case.status !== "PENDING_APPROVAL")');
    expect(k).toContain("chiGiuChoChoDuyet");
    expect(k).toContain('dong.status === "SCHEDULED" && !chiGiuChoChoDuyet');
  });

  it("[DCW-05] ba action duyệt gác `makeup:waive` NGAY ĐẦU hàm (trước mọi đọc / ghi)", () => {
    const a = ma("app/(admin)/admin/hoc-bu/_actions.ts");
    for (const ten of ["duyetCaseAction", "tuChoiCaseAction", "layLuaChonDuyetAction"]) {
      const t = than(a, ten);
      expect(t.split("\n").slice(0, 3).join("\n"), ten).toContain('await cong("makeup:waive")');
    }
  });

  it("[DCW-06] `taoCaseAction` suy `coQuyenDuyet` từ QUYỀN THẬT `makeup:waive` và truyền xuống dịch vụ; không nơi nào của app/ truyền hằng `true`", () => {
    const a = ma("app/(admin)/admin/hoc-bu/_actions.ts");
    const t = than(a, "taoCaseAction");
    expect(t).toContain('const coQuyenDuyet = await checkPermission("makeup:waive");');
    expect(t).toContain("coQuyenDuyet })");
    expect(t).toContain("choDuyet: !coQuyenDuyet");
    for (const f of tepNguon("app")) expect(ma(f), f).not.toMatch(/coQuyenDuyet:\s*true/);
  });

  it("[DCW-07] `taoCaseVaXep`: trạng thái đầu do `trangThaiCaseKhiTao`; phân công parttime CHỈ khi lịch thật; báo quản lý CHỈ khi chờ duyệt; không báo phụ huynh / giáo viên lúc tạo case chờ duyệt", () => {
    const c = ma("lib/hoc-bu/case-db.ts");
    const t = than(c, "taoCaseVaXep");
    expect(t).toContain("coQuyenDuyet: boolean;");
    expect(t).toContain("trangThaiCaseKhiTao({ coQuyenDuyet: p.coQuyenDuyet })");
    expect(t).toContain("status: trangThaiDau,");
    expect(t).toContain("if (choDuyet) await phatCaseChoDuyet(tx, { caseId: c.id });");
    expect(t).toMatch(/if \(!choDuyet\) \{\s*canDongBo = await danhDauCanDongBo\(tx,/);
    // Tin phụ huynh / giáo viên (`makeup.case.scheduled`) nằm ở `ghiBeVaoCase`, và nó tự đọc trạng thái của case rồi dừng trước khi phát.
    const g = than(c, "ghiBeVaoCase");
    expect(g).toContain('const choDuyet = trangThaiCase === CASE_CHO_DUYET;');
    expect(vi(g, "if (choDuyet) return;")).toBeLessThan(vi(g, "await phatCaseDaXep(tx,"));
  });

  it("[DCW-08] `duyetCase`: kiểm hạn + GV có ca trước giao dịch; trong giao dịch khoá hàng → kiểm lại trạng thái + phiên bản → kiểm TRÙNG LỊCH (loại chính nó) → đổi trạng thái có điều kiện → phát tin + đánh dấu phân công → nhật ký", () => {
    const c = ma("lib/hoc-bu/case-db.ts");
    const t = than(c, "duyetCase");
    expect(t.split("\n").slice(0, 8).join("\n")).toContain("actor: NguoiHocBu");
    const ngoai = vi(t, "kiemDuyetDuoc(");
    expect(vi(t, "kiemGvVaPhong(actor,")).toBeGreaterThan(ngoai);
    const tx = vi(t, "db.$transaction(");
    expect(ngoai).toBeLessThan(tx);
    const khoa = vi(t, 'FOR UPDATE', tx);
    const trangThai = vi(t, "song?.status !== CASE_CHO_DUYET", khoa);
    const phienBan = vi(t, "song.version !== p.phienBan", trangThai);
    const lich = vi(t, "kiemLichTrongTx(tx", phienBan);
    expect(t.slice(lich, lich + 400)).toContain('exclude: [{ type: "MAKEUP_CASE", id: c.id }]');
    const doi = vi(t, "tx.makeupCase.updateMany(", lich);
    expect(t.slice(doi, doi + 300)).toContain("status: CASE_CHO_DUYET, version: p.phienBan");
    const phat = vi(t, "await phatTinCaseVuaDuyet(tx, c.id)", doi);
    const danhDau = vi(t, "canDongBo = await danhDauCanDongBo(tx,", phat);
    const nk = vi(t, '"hoc-bu.duyet-case"', danhDau);
    expect([khoa, trangThai, phienBan, lich, doi, phat, danhDau, nk]).toEqual([khoa, trangThai, phienBan, lich, doi, phat, danhDau, nk].sort((x, y) => x - y));
    expect(t).toMatch(/if \(canDongBo\) await dongBoNgay\(/);
    // Không có `db.makeupCase.update*` ngoài giao dịch (một phép ghi ngoài tx là giao dịch thứ hai).
    expect(t).not.toMatch(/\bdb\.makeupCase\.update/);
  });

  it("[DCW-09] `huyCase` nhận case chờ duyệt: tin phụ huynh / giáo viên + phân công CHỈ khi case từng là lịch thật; từ chối có lý do được LƯU trên case và báo người tạo", () => {
    const c = ma("lib/hoc-bu/case-db.ts");
    const t = than(c, "huyCase");
    expect(t).toContain('if (tuChoi && c.status !== CASE_CHO_DUYET) throw new LoiHocBu("Case này không còn chờ duyệt — tải lại trang");');
    expect(t).toContain('rejectReason: tuChoi?.lyDo ?? "Người tạo rút lại"');
    expect(t).toMatch(/if \(!choDuyet\) \{\s*canDongBo = await danhDauCanDongBo\(tx,/);
    expect(vi(t, "await phatBeBiGo(tx,")).toBeGreaterThan(vi(t, "if (!choDuyet) {"));
    expect(vi(t, "await phatCaseBiHuy(tx,")).toBeGreaterThan(vi(t, "if (!choDuyet) {"));
    expect(t).toContain("else if (tuChoi && c.createdById !== actor.userId)");
    expect(vi(t, "await phatCaseBiTuChoi(tx,")).toBeGreaterThan(vi(t, "await phatCaseBiHuy(tx,"));
  });

  it("[DCW-10] màn: trang Duyệt case gác `makeup:waive` và về /hoc-bu nếu thiếu; nút vào chỉ khi có quyền ấy; chi tiết case: Duyệt / Từ chối chỉ khi chờ duyệt + quyền duyệt, Rút lại chỉ khi chờ duyệt + KHÔNG có quyền duyệt + có quyền xếp", () => {
    const p = ma("app/(admin)/admin/hoc-bu/duyet/page.tsx");
    // 21/10/2026 — cổng trang nay đi qua PAGE_GATES (để mục sidebar "Duyệt học bù" và trang dùng CHUNG một nguồn, test "menu nói thật" canh hai tập bằng nhau). LUẬT vẫn là: chỉ người có
    // `makeup:waive` vào được, thiếu thì về /hoc-bu TRƯỚC khi đọc dữ liệu. Ghim luật (khoá cổng = đúng quyền duyệt, đứng trước câu đọc), không ghim cách viết.
    expect(PAGE_GATES["/hoc-bu/duyet"]).toEqual(["makeup:waive"]);
    expect(vi(p, 'if (!(await checkAnyPermission(PAGE_GATES["/hoc-bu/duyet"]))) redirect("/hoc-bu");')).toBeLessThan(vi(p, "docCaseChoDuyet("));
    const m = ma("app/(admin)/admin/hoc-bu/page.tsx");
    // Luật: nút "Duyệt case" chỉ dựng khi `coTheHuy` (= `makeup:waive`). Chấp nhận cả `{coTheHuy && (<Link …` lẫn `coTheHuy ? (<Link …` — hình dạng JSX không phải luật.
    expect(m).toMatch(/(?:\{coTheHuy && |coTheHuy \? )\(\s*<Link\s+href="\/hoc-bu\/duyet"/);
    // 24/10/2026: số đếm gồm cả lô yêu cầu thêm học viên (cùng màn). Luật: chỉ đếm khi có quyền duyệt (`coTheHuy ? … : Promise.resolve(0)`), và có đếm case chờ duyệt.
    expect(m).toContain('sdb.makeupCase.count({ where: { status: "PENDING_APPROVAL" } })');
    expect(m).toContain("sdb.makeupCaseAddRequest.findMany({ where: { status: \"PENDING\" }, distinct: [\"batchId\"]");
    expect(m).toMatch(/coTheHuy\s*\?\s*Promise\.all\(\[[\s\S]*?\]\)\.then\(\(\[caseCho, loCho\]\) => caseCho \+ loCho\.length\)\s*:\s*Promise\.resolve\(0\)/);
    const d = ma("app/(admin)/admin/hoc-bu/case/[id]/page.tsx");
    expect(d).toContain("{choDuyet && coTheDuyet && <NutDuyetCase caseId={c.id} phienBan={c.version} size=\"default\" />}");
    expect(d).toContain('{choDuyet && coTheDuyet && <NutTuChoiCase caseId={c.id} size="default" />}');
    expect(d).toContain("{choDuyet && !coTheDuyet && coTheXep && <NutHuyCase caseId={c.id} rutLai />}");
    expect(d).toContain('checkPermission("makeup:waive")');
  });

  it("[DCW-11] sidebar có đúng MỘT mục trỏ /hoc-bu/duyet, cổng lấy từ PAGE_GATES (không khai quyền rời) — gỡ mục này không làm ca nào khác đỏ", () => {
    // `nav-coverage` xanh dù mục bị gỡ: màn vẫn được trỏ tới từ nút "Duyệt case (n)" ở /hoc-bu. Quản lý cơ sở chỉ thấy việc chờ duyệt ở sidebar nếu mục này còn.
    const s = ma("components/admin/sidebar.tsx");
    expect(s.match(/href:\s*"\/hoc-bu\/duyet"/g)).toHaveLength(1);
    expect(s).toMatch(/label:\s*"Duyệt học bù",\s*href:\s*"\/hoc-bu\/duyet",[^}]*perm:\s*\[\s*\.\.\.PAGE_GATES\["\/hoc-bu\/duyet"\]\s*\]/);
  });

  it("[DCW-12] 28/10/2026 — 'Duyệt học vượt' có mục sidebar NGAY DƯỚI 'Duyệt học bù' (cổng từ PAGE_GATES) và nút cạnh 'Duyệt case' ở /hoc-bu, chỉ khi có `makeup:waive`", () => {
    const s = ma("components/admin/sidebar.tsx");
    expect(s.match(/href:\s*"\/hoc-bu\/duyet-hoc-vuot"/g)).toHaveLength(1);
    expect(s).toMatch(/label:\s*"Duyệt học bù",\s*href:\s*"\/hoc-bu\/duyet",[^}]*\},\s*(?:\/\/[^\n]*\n\s*)*\{\s*label:\s*"Duyệt học vượt",\s*href:\s*"\/hoc-bu\/duyet-hoc-vuot",[^}]*perm:\s*\[\s*\.\.\.PAGE_GATES\["\/hoc-bu\/duyet-hoc-vuot"\]\s*\]/);
    expect(PAGE_GATES["/hoc-bu/duyet-hoc-vuot"]).toEqual(["makeup:waive"]);
    const m = ma("app/(admin)/admin/hoc-bu/page.tsx");
    expect(m).toMatch(/(?:\{coTheHuy && |coTheHuy \? )\(\s*<Link\s+href="\/hoc-bu\/duyet-hoc-vuot"/);
  });
});
