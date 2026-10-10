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
    expect(dem(t, "makeupTheo.get(")).toBe(2); // phép ghi upsert + bước tạo MakeupNeed
    expect(dem(t, "const cu = cuBy.get(r.studentId)?.makeupStatus as MakeupStatus | undefined")).toBe(1);
    expect(t.indexOf("doiHaDaBu(")).toBeLessThan(t.indexOf("$transaction("));
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
    // …và `createMakeupNeed` không còn nằm sau điều kiện `input.action === "MAKEUP"`.
    const goi = t.indexOf("createMakeupNeed(");
    expect(goi).toBeGreaterThan(-1);
    const dieuKien = t.slice(Math.max(0, goi - 120), goi);
    expect(dieuKien).toContain('makeupStatus === "NEEDS_MAKEUP"');
    expect(dieuKien).not.toContain('input.action === "MAKEUP"');
    expect(dem(t, "createMakeupNeed(")).toBe(1);
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
    const t = than(ma(CB), "diemDanhBu");
    expect(dem(t, "cuaSoDiemDanhBu(")).toBe(1);
    expect(t.indexOf("cuaSoDiemDanhBu(")).toBeLessThan(t.indexOf("$transaction("));
    // Kết quả của cổng phải THỰC SỰ chặn — gọi hàm mà bỏ lệnh ném là cổng giả.
    expect(dem(t, "if (!cuaSo.ok) throw new LoiHocBu(cuaSo.thongBao);")).toBe(1);
    expect(t.indexOf("if (!cuaSo.ok) throw")).toBeLessThan(t.indexOf("$transaction("));
    const trongTx = t.slice(t.indexOf("$transaction("));
    expect(dem(trongTx, 'FROM "MakeupCase" WHERE id =')).toBe(1);
    expect(trongTx.indexOf('FROM "MakeupCase" WHERE id =')).toBeLessThan(trongTx.indexOf(".updateMany("));
    expect(trongTx).toContain("FOR UPDATE");
    // HB-13: lệnh ghi lên Attendance gốc chỉ đặt dấu MADE_UP.
    const att = trongTx.slice(trongTx.indexOf("tx.attendance.updateMany("));
    const khoiData = att.slice(att.indexOf("data:"), att.indexOf("});"));
    expect(khoiData).toContain('makeupStatus: "MADE_UP"');
    expect(khoiData).not.toContain("status:");
    // Ghi đè: giáo viên (actor = null) không bao giờ ghi đè; audit nằm TRONG transaction.
    expect(t).toContain("ghiDe = actor !== null && p.ghiDe !== undefined");
    expect(dem(t, "writeAudit(")).toBe(1);
    expect(trongTx).toContain("writeAudit(");
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

  it("[DDW-07] action admin: ghi đè điểm danh quá hạn đòi quyền makeup:waive TRƯỚC khi gọi diemDanhBu", () => {
    const t = than(ma(HB), "diemDanhBuAction");
    const quyen = t.indexOf('checkPermission("makeup:waive")');
    expect(quyen).toBeGreaterThan(-1);
    expect(quyen).toBeLessThan(t.indexOf("diemDanhBu("));
    expect(dem(t, "diemDanhBu(")).toBe(1);
    // `ghiDe` chỉ được truyền xuống khi đã qua cổng quyền: nó nằm trong khối `if (input.ghiDe)`.
    const khoi = t.slice(t.indexOf("if (input.ghiDe)"), t.indexOf("try {"));
    expect(khoi).toContain('checkPermission("makeup:waive")');
    expect(khoi).toContain("ghiDe =");
  });
});
