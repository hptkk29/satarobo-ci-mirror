// lib/portal/lich-tuan-pham-vi-wiring.test.ts — [PVX] LƯỚI GHIM DÂY NỐI của tiến độ theo phạm vi ở LỊCH TUẦN và BUỔI HỌC CỦA HỌC SINH.
//
// Vì sao cần (cùng lý do `tien-do-pham-vi-wiring.test.ts` [PVW]): hai hàm `getStudentSchedule` / `getStudentSessionsView` chạm DB nên test hành vi
// thuần không đi qua chúng; gỡ lời gọi `nhanBuoiPhamVi(` / `demBuoiTheoPhamVi(` thì KHÔNG ca thuần nào đỏ — phụ huynh lặng lẽ quay về mẫu số cả
// lớp. Lưới này neo vào LỜI GỌI (không phải dòng import, không phải chú thích), đếm SỐ LẦN, và canh thêm:
//   · số bài của buổi lấy từ `soBuoiLoTrinh` (plan.order+1 → Lesson.order), KHÔNG phải `soBuoi` (hạng theo ngày — trông đúng ở dữ liệu seed sạch);
//   · trang chỉ lấy `studentId` từ `requireActiveStudent()` — không từ URL;
//   · luật 12b: không dựng lại công thức phạm vi, không chép nhãn bằng tay ở các tệp mới chạm.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const boChuThich = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const code = (p: string) => boChuThich(doc(p));
const demLoiGoi = (s: string, ten: string) => (s.match(new RegExp(`\\b${ten}\\s*\\(`, "g")) ?? []).length;

function quet(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(resolve(process.cwd(), thuMuc))) {
    const p = join(thuMuc, ten);
    if (statSync(resolve(process.cwd(), p)).isDirectory()) quet(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.test\.(ts|tsx)$/.test(ten)) ra.push(p.replace(/\\/g, "/"));
  }
  return ra;
}

const NHAN_CO_DIEU_KIEN = /nhan \? \{ \.\.\.hang, ngoaiPhamVi: nhan\.ngoaiPhamVi, nhanPhamVi: nhan\.nhan \} : hang/;

describe("[PVX] lịch tuần + buổi học của học sinh — dây nối phạm vi", () => {
  it("[PVX-01] schedule.ts: đọc phạm vi MỘT lần cho đúng các lớp của con + cùng `now`; nhãn từ nhanBuoiPhamVi(soBuoiLoTrinh); đếm qua demBuoiTheoPhamVi", () => {
    const s = code("lib/portal/schedule.ts");
    expect(demLoiGoi(s, "getStudentPhamVi")).toBe(1);
    expect(s).toMatch(/getStudentPhamVi\(studentId, classIds, now\)/);
    expect(s).toMatch(/getStudentAttendanceSummaries\(studentId, now\)/); // cùng một `now` cho chuyên cần và phạm vi
    expect(demLoiGoi(s, "nhanBuoiPhamVi")).toBe(1);
    expect(s).toMatch(/nhanBuoiPhamVi\(phamVi\.get\(b\.classId\), b\.soBuoiLoTrinh\)/);
    expect(demLoiGoi(s, "demBuoiTheoPhamVi")).toBe(1);
    expect(s).toMatch(/demBuoiTheoPhamVi\(buoiList, phamVi\)/);
    expect(demLoiGoi(s, "demBuoi")).toBe(0); // không còn đếm cả lớp bằng tay
    expect(s).toMatch(NHAN_CO_DIEU_KIEN); // trường mới chỉ thêm khi CÓ nhãn
    expect(s).not.toMatch(/const now = new Date\(\)/); // `now` do người gọi truyền (luật 19)
  });

  it("[PVX-02] student-sessions.ts: như trên, và 'chưa chấm' KHÔNG đếm buổi ngoài phạm vi", () => {
    const s = code("lib/portal/student-sessions.ts");
    expect(demLoiGoi(s, "getStudentPhamVi")).toBe(1);
    expect(s).toMatch(/getStudentPhamVi\(studentId, classIds, now\)/);
    expect(s).toMatch(/getStudentAttendanceSummaries\(studentId, now\)/);
    expect(demLoiGoi(s, "nhanBuoiPhamVi")).toBe(1);
    expect(s).toMatch(/nhanBuoiPhamVi\(phamVi\.get\(b\.classId\), b\.soBuoiLoTrinh\)/);
    expect(demLoiGoi(s, "demBuoiTheoPhamVi")).toBe(1);
    expect(s).toMatch(/demBuoiTheoPhamVi\(buoiList, phamVi\)/);
    expect(demLoiGoi(s, "demBuoi")).toBe(0);
    expect(s).toMatch(NHAN_CO_DIEU_KIEN);
    expect(s).toMatch(/s\.attendance === "UNMARKED" && s\.ngoaiPhamVi !== true/);
    expect(s).not.toMatch(/const now = new Date\(\)/);
  });

  it("[PVX-03] buoi-hoc.ts: công thức theo phạm vi gọi MỘT lần, từ adapter, ở mốc BAY_GIO (cùng mẫu số chuyên cần); không import thẳng lib/entitlements", () => {
    const s = code("lib/portal/buoi-hoc.ts");
    expect(demLoiGoi(s, "soLieuPhamVi")).toBe(1);
    expect(s).toMatch(/soLieuPhamVi\(phamVi\.get\(classId\), "BAY_GIO"\)/);
    expect(s).not.toMatch(/from "@\/lib\/entitlements/);
    expect(s).toMatch(/phamVi\.size === 0\) return chung/); // Map rỗng ⇒ đường cũ ngay, không duyệt gì
    expect(s).toMatch(/return apDung \? cong : chung/); // không lớp nào áp dụng ⇒ đúng kết quả cũ
  });

  it("[PVX-04] trang: studentId CHỈ từ requireActiveStudent(), truyền đúng một đối số — không từ URL / searchParams", () => {
    for (const p of [
      "app/(portal)/portal/lich/page.tsx",
      "app/(portal)/portal/hoc-sinh/lich/page.tsx",
      "app/(portal)/portal/hoc-sinh/buoi-hoc/page.tsx",
    ]) {
      const s = code(p);
      expect(s, p).toMatch(/const \{ studentId \} = await requireActiveStudent\(\)/);
      expect(s, p).toMatch(/(getStudentSchedule|getStudentSessionsView)\(studentId\)/);
      expect(s, p).not.toMatch(/(sp|searchParams|params)\??\.studentId/);
    }
  });

  it("[PVX-05] luật 12b: hai tệp dữ liệu + buoi-hoc.ts + components/portal KHÔNG gọi hàm lõi phạm vi, không chép nhãn bằng tay", () => {
    const tep = [
      "lib/portal/schedule.ts",
      "lib/portal/student-sessions.ts",
      "lib/portal/buoi-hoc.ts",
      ...quet("components/portal"),
    ];
    for (const p of tep) {
      const s = code(p);
      expect(demLoiGoi(s, "tienDoTheoPhamVi"), `${p} gọi thẳng tienDoTheoPhamVi`).toBe(0);
      expect(demLoiGoi(s, "nhanLyDo"), `${p} gọi thẳng nhanLyDo`).toBe(0);
      expect(demLoiGoi(s, "phanLoaiBai"), `${p} gọi thẳng phanLoaiBai`).toBe(0);
      expect(s, `${p} chép tay nhãn`).not.toMatch(/ngoài phạm vi đăng ký/i);
    }
  });

  it("[PVX-06] components: nhãn lấy từ trường server tính sẵn, ở ĐỦ các chỗ liệt kê buổi (lịch tuần: kế tiếp + tuần này + sắp tới; buổi học: danh sách + chi tiết)", () => {
    const lich = code("components/portal/schedule-page.tsx");
    expect(demLoiGoi(lich.replace(/<NhanPhamVi/g, "NhanPhamVi("), "NhanPhamVi")).toBe(3);
    expect(lich).toMatch(/nhan=\{s\.next\.nhanPhamVi\}/);
    expect(lich).toMatch(/nhan=\{it\.nhanPhamVi\}/);
    const buoi = code("components/portal/student/buoi-hoc-page.tsx");
    expect(demLoiGoi(buoi.replace(/<NhanPhamVi/g, "NhanPhamVi("), "NhanPhamVi")).toBe(2);
    expect(buoi).toMatch(/nhan=\{s\.nhanPhamVi\}/);
    // component nhãn không tự viết chữ và không vẽ gì khi không có nhãn
    const c = code("components/portal/nhan-pham-vi.tsx");
    expect(c).toMatch(/if \(!nhan\) return null/);
  });

  it("[PVX-07] chỉ MỘT nơi trong cổng đọc cờ phạm vi (tien-do-pham-vi-db.ts): hai tệp mới đi qua getStudentPhamVi, không hỏi cờ", () => {
    for (const p of ["lib/portal/schedule.ts", "lib/portal/student-sessions.ts", "lib/portal/buoi-hoc.ts"]) {
      const s = code(p);
      expect(demLoiGoi(s, "laThuHocPhiTheoPhamViBat"), p).toBe(0);
      expect(demLoiGoi(s, "docPhamViChoCon"), p).toBe(0);
      expect(s, p).not.toMatch(/studyEntitlement/);
    }
  });
});
