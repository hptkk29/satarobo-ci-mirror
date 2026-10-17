// [DDW-*] — LƯỚI GHIM MÃ NGUỒN cho T02: nối luật giữ "đã bù" + cổng thời gian + khoá hàng vào ĐÚNG chỗ.
//
// Luật thuần có test riêng (`giu-da-bu.test.ts`, `cua-so-diem-danh.test.ts`) và hành vi DB có test riêng
// (`tests/hoc-bu/diem-danh-bu.test.ts`). Thứ không test nào kia chạm tới là DÂY NỐI: bốn Server Action lưu điểm danh
// đều là endpoint riêng, gỡ lời gọi `makeupStatusSauKhiLuu` khỏi một trong bốn là lỗi quay lại mà MỌI test hành vi vẫn
// xanh (chúng không chạy Server Action). Cách làm theo CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN": bóc chú thích, neo chuỗi
// HẸP vào LỜI GỌI (không vào dòng import), đếm số lần khớp, và đã cấy lại lỗi để thấy đỏ.
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

/** Thân một hàm `export async function ten(` đến hàm export kế tiếp. */
function than(src: string, ten: string): string {
  const dau = src.indexOf(`export async function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const ke = src.indexOf("\nexport ", dau + 10);
  return src.slice(dau, ke === -1 ? undefined : ke);
}
const dem = (s: string, x: string) => s.split(x).length - 1;

const GV = "app/(teacher)/teacher/lop/_actions.ts";
const AD = "app/(admin)/admin/attendance/_actions.ts";
const PR = "app/(admin)/admin/parent-requests/actions.ts";
const SV = "lib/lms/attendance-record.ts";
const CB = "lib/hoc-bu/case-db.ts";
const HB = "app/(admin)/admin/hoc-bu/_actions.ts";

describe("[DDW] T02 — dây nối", () => {
  it("[DDW-01] site GV: MỘT lời gọi makeupStatusSauKhiLuu, từ chối `doiHaDaBu` TRƯỚC phép ghi, không còn tự suy makeupStatus", () => {
    const t = than(ma(GV), "saveClassAttendanceAction");
    expect(dem(t, "makeupStatusSauKhiLuu(")).toBe(1);
    expect(dem(t, "doiHaDaBu(")).toBe(1);
    // Giá trị CŨ thật sự được truyền vào (truyền `undefined` ở đây = coi như chưa từng có bản ghi = đúng HB-05).
    expect(dem(t, "cu: existingBy.get(r.studentId)?.makeupStatus as MakeupStatus | undefined")).toBe(1);
    expect(dem(t, "cu: old?.makeupStatus as MakeupStatus | undefined")).toBe(1);
    expect(t.indexOf("doiHaDaBu(")).toBeLessThan(t.indexOf(".upsert("));
    expect(t.indexOf("makeupStatusSauKhiLuu(")).toBeLessThan(t.indexOf(".upsert("));
    expect(t).not.toContain("deriveMakeup(");
    expect(ma(GV)).not.toContain("function deriveMakeup");
    // Đọc bản ghi cũ bằng helper dùng `db` trần (scopedDb có thể ra rỗng ⇒ hiểu là "chưa có gì").
    expect(t.indexOf("getExistingAttendanceByStudent(")).toBeLessThan(t.indexOf("doiHaDaBu("));
  });

  it("[DDW-02] lưới admin: đọc bản ghi cũ bằng db trần, từ chối `doiHaDaBu`, MỘT lời gọi makeupStatusSauKhiLuu — cả hai chỗ dùng chung bản đã tính", () => {
    const t = than(ma(AD), "markAttendance");
    expect(dem(t, "getExistingAttendanceByStudent(")).toBe(1);
    expect(dem(t, "doiHaDaBu(")).toBe(1);
    expect(dem(t, "makeupStatusSauKhiLuu(")).toBe(1);
    // T05: bước tạo MakeupNeed không còn đọc `makeupTheo` riêng — nó chạy TRONG giao dịch ghi, nhận chính giá trị đã tính qua `ghi`.
    expect(dem(t, "makeupTheo.get(")).toBe(1);
    expect(dem(t, "makeupStatusTruoc: cuBy.get(r.studentId)?.makeupStatus as MakeupStatus | undefined,")).toBe(1);
    expect(dem(t, "const cu = cuBy.get(r.studentId)?.makeupStatus as MakeupStatus | undefined")).toBe(1);
    // T05: giao dịch ghi nay là `giaoDichDiemDanh(` (điểm danh + dòng cần bù cùng commit); cổng `doiHaDaBu` vẫn đứng TRƯỚC nó.
    expect(t.indexOf("giaoDichDiemDanh(")).toBeGreaterThan(-1);
    expect(t.indexOf("doiHaDaBu(")).toBeLessThan(t.indexOf("giaoDichDiemDanh("));
    expect(ma(AD)).not.toContain("makeupKhiVang");
  });

  it("[DDW-03] phiếu nghỉ: đọc điểm danh cũ TRƯỚC upsert, giữ MADE_UP, và MỌI nhánh (kể cả 'Đánh vắng') đều tạo dòng cần bù", () => {
    const t = than(ma(PR), "resolveAbsence");
    expect(dem(t, "getExistingAttendanceByStudent(")).toBe(1);
    expect(dem(t, "makeupStatusSauKhiLuu(")).toBe(1);
    expect(t.indexOf("getExistingAttendanceByStudent(")).toBeLessThan(t.indexOf(".upsert("));
    expect(dem(t, "cu: cuAtt?.makeupStatus as")).toBe(1);
    // HB-01: không còn gán makeupStatus cố định NONE cho nhánh ABSENT…
    expect(t).not.toMatch(/makeupStatus\s*=\s*input\.action/);
    expect(t).not.toMatch(/\?\s*"NEEDS_MAKEUP"\s*:\s*"NONE"/);
    // …và việc tạo dòng cần bù (T05: `dongBoDongSauDiemDanh`, trong CÙNG giao dịch với điểm danh + phiếu) không còn nằm sau điều kiện
    // `input.action === "MAKEUP"` — mọi nhánh đều là buổi vắng cần bù (HB-01); luật "NEEDS_MAKEUP ⇒ tạo dòng" nằm trong hàm dùng chung.
    expect(dem(t, "dongBoDongSauDiemDanh(")).toBe(1);
    expect(t).not.toContain("createMakeupNeed(");
    const goi = t.indexOf("dongBoDongSauDiemDanh(");
    expect(goi).toBeGreaterThan(t.indexOf("tx.attendance.upsert("));
    expect(goi).toBeGreaterThan(t.indexOf("tx.parentRequest.update("));
    expect(goi).toBeGreaterThan(t.indexOf("giaoDichDiemDanh("));
    expect(t.slice(Math.max(0, goi - 80), goi)).not.toContain('input.action === "MAKEUP"');
    expect(dem(t, "makeupStatusTruoc: cuAtt?.makeupStatus as")).toBe(1);
  });

  it("[DDW-04] dịch vụ recordAttendance dùng luật chung cho CẢ nhánh sửa lẫn nhánh tạo", () => {
    const t = ma(SV);
    expect(dem(t, "makeupStatusSauKhiLuu(")).toBe(1);
    expect(dem(t, "cu: existing?.makeupStatus,")).toBe(1);
    expect(t).not.toMatch(/makeupStatus:\s*willMakeup/); // bản cũ: `makeupStatus: willMakeup ? … : …` ghi thẳng, không đọc giá trị cũ
    expect(t.match(/^\s*makeupStatus,$/gm)).toHaveLength(1); // nhánh create dùng biến đã tính (cả dòng chỉ có tên biến)
    expect(dem(t, "makeupStatus }")).toBe(1); // nhánh update
  });

  it("[DDW-05] diemDanhBu: cổng thời gian TRƯỚC transaction; khoá hàng CASE là câu ĐẦU TIÊN trong transaction; không còn ghi đè status buổi gốc", () => {
    // T07: điểm danh LẦN ĐẦU là `diemDanhBe` (tầng 1 + tầng 2); `diemDanhBu` chỉ còn là vỏ cho bé học MỘT bài. Luật không đổi:
    // cổng thời gian TRƯỚC transaction, khoá hàng CASE là câu ĐẦU TIÊN trong transaction (kể cả sửa điểm danh), audit trong transaction.
    const cd = "lib/hoc-bu/case-diem-danh-db.ts";
    const t = than(ma(cd), "diemDanhBe");
    expect(dem(t, "cuaSoDiemDanhBu(")).toBe(1);
    expect(t.indexOf("cuaSoDiemDanhBu(")).toBeLessThan(t.indexOf("$transaction("));
    // Kết quả của cổng phải THỰC SỰ chặn — gọi hàm mà bỏ lệnh ném là cổng giả.
    expect(dem(t, "if (!cuaSo.ok) throw new LoiHocBu(cuaSo.thongBao);")).toBe(1);
    expect(t.indexOf("if (!cuaSo.ok) throw")).toBeLessThan(t.indexOf("$transaction("));
    // Ghi đè: giáo viên (actor = null) không bao giờ ghi đè; audit nằm TRONG transaction.
    expect(ma(cd)).toContain("const dung = actor !== null && ghiDe !== undefined;");
    expect(dem(t, "writeAudit(")).toBe(1);
    expect(t.slice(t.indexOf("$transaction(")).includes("writeAudit(")).toBe(true);
    // Phần ghi chung: khoá hàng CASE đứng TRƯỚC mọi phép ghi (mục, bé, dòng, sổ lượt).
    const g = ma(cd);
    const chung = g.slice(g.indexOf("async function ganDiemDanhBeTrongTx("), g.indexOf("export async function diemDanhBe("));
    expect(dem(chung, 'FROM "MakeupCase" WHERE id =')).toBe(1);
    expect(chung).toContain("FOR UPDATE");
    expect(chung.indexOf('FROM "MakeupCase" WHERE id =')).toBeLessThan(chung.indexOf("doiKetQuaMuc("));
    expect(chung.indexOf('FROM "MakeupCase" WHERE id =')).toBeLessThan(chung.indexOf(".updateMany("));
    // HB-13: lệnh ghi lên Attendance gốc chỉ đặt dấu `makeupStatus`, KHÔNG đổi `status` (vắng có phép / không phép giữ nguyên).
    const doi = than(g, "doiKetQuaMuc");
    for (const m of doi.matchAll(/tx\.attendance\.updateMany\(/g)) {
      const att = doi.slice(m.index);
      const khoiData = att.slice(att.indexOf("data:"), att.indexOf("});"));
      expect(khoiData).toContain("makeupStatus:");
      expect(khoiData).not.toMatch(/\bstatus:/);
    }
    expect(dem(doi, "tx.attendance.updateMany(")).toBe(2);
    expect(doi).toContain('makeupStatus: "MADE_UP"');
    expect(doi).toContain('makeupStatus: "NEEDS_MAKEUP"');
  });

  it("[DDW-06] taoPhiBu: khoá hàng dòng cần bù TRƯỚC khi tạo đơn, đọc lại trạng thái trong khoá, và so-và-đổi con trỏ", () => {
    const t = than(ma(CB), "taoPhiBu");
    const khoa = t.indexOf('FROM "MakeupNeed" WHERE id =');
    expect(khoa).toBeGreaterThan(-1);
    expect(dem(t, 'FROM "MakeupNeed" WHERE id =')).toBe(1);
    expect(khoa).toBeLessThan(t.indexOf("order.create("));
    expect(t.slice(khoa, khoa + 120)).toContain("FOR UPDATE");
    expect(t.indexOf("tx.makeupNeed.findUnique(")).toBeGreaterThan(khoa);
    expect(t.indexOf("tx.makeupNeed.findUnique(")).toBeLessThan(t.indexOf("order.create("));
    // Hai lớp phòng thủ cho "vừa được miễn phí / vừa có phí giữa hai lượt": đọc lại trong khoá VÀ điều kiện ở updateMany.
    // Ca DB chỉ chạm lớp ngoài cùng (cổng đọc ngoài transaction đã chặn trước) nên lớp trong khoá được ghim ở đây.
    expect(dem(t, "if (dong.freeApprovedAt !== null) throw")).toBe(1);
    expect(dem(t, 'if (!dong || dong.status !== "PENDING") throw')).toBe(1);
    const gan = t.slice(t.indexOf("tx.makeupNeed.updateMany("));
    expect(gan.slice(0, gan.indexOf("data:"))).toContain("feeOrderItemId: dong.feeOrderItemId");
    expect(gan.slice(0, gan.indexOf("data:"))).toContain("freeApprovedAt: null");
  });

  it("[DDW-07] action admin: ghi đè điểm danh quá hạn đòi quyền makeup:waive TRƯỚC khi gọi dịch vụ — một cổng `ghiDeTuInput` cho cả điểm danh lẫn sửa điểm danh", () => {
    const src = ma(HB);
    // Cổng: quyền riêng nằm ở MỘT hàm, `ghiDe` chỉ rời hàm ấy khi đã qua quyền.
    const dau = src.indexOf("async function ghiDeTuInput(");
    expect(dau).toBeGreaterThan(-1);
    const cong = src.slice(dau, src.indexOf("return { ok: true as const, ghiDe: {", dau) + 200);
    expect(cong).toContain('checkPermission("makeup:waive")');
    expect(cong.indexOf('checkPermission("makeup:waive")')).toBeLessThan(cong.indexOf("ghiDe: { lyDo: ghiDe.lyDo"));
    for (const [ham, dich] of [
      ["diemDanhBeAction", "diemDanhBe("],
      ["suaDiemDanhBeAction", "suaDiemDanhBe("],
    ] as const) {
      const t = than(src, ham);
      expect(dem(t, "await ghiDeTuInput("), ham).toBe(1);
      expect(t.indexOf("await ghiDeTuInput("), ham).toBeLessThan(t.indexOf(dich));
      expect(dem(t, dich), ham).toBe(1);
      // Dịch vụ chỉ nhận `ghiDe` ĐÃ QUA cổng (`gd.ghiDe`), không bao giờ đọc thẳng `p.data.ghiDe`.
      expect(t, ham).toContain("ghiDe: gd.ghiDe");
      expect(dem(t, "p.data.ghiDe"), ham).toBe(1);
    }
  });
});
