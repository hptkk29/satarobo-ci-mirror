// lib/portal/tien-do-pham-vi-wiring.test.ts — [PVW] LƯỚI GHIM DÂY NỐI của tiến độ theo phạm vi ở cổng phụ huynh.
//
// Vì sao cần: các test hành vi của từng màn không đi qua `learning.ts` thật (nó chạm DB), nên gỡ lời gọi `tienDoPortal(` / `nhanBuoiPhamVi(` ra
// khỏi `learning.ts` KHÔNG làm ca hành vi nào đỏ — phụ huynh lặng lẽ quay về mẫu số cả khoá. Lưới này neo vào LỜI GỌI (không phải dòng import,
// không phải chú thích), đếm SỐ LẦN, và canh hai luật 12b: không dựng lại công thức tại chỗ, không chép nhãn 'ngoài phạm vi' bằng tay.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
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

describe("[PVW] tiến độ theo phạm vi — dây nối cổng phụ huynh", () => {
  it("[PVW-01] learning.ts: ba hàm tiến độ / chuyên cần / lịch học đều gọi bộ chuyển đổi (mỗi hàm một lời gọi) và đọc dữ liệu qua getStudentPhamVi", () => {
    const s = code("lib/portal/learning.ts");
    expect(demLoiGoi(s, "tienDoPortal")).toBe(1);
    expect(demLoiGoi(s, "tomTatDiemDanhPortal")).toBe(1);
    expect(demLoiGoi(s, "nhanBuoiPhamVi")).toBe(1);
    // ba hàm công khai + bản thân hàm bọc: getStudentPhamVi được gọi ở progress, attendance, sessions.
    expect(demLoiGoi(s, "getStudentPhamVi")).toBe(4); // 1 khai báo + 3 nơi gọi
    expect(s).toMatch(/docPhamViChoCon\(studentId, classIds, now\)/);
  });

  it("[PVW-02] trang Kết quả: tiến độ buổi VÀ khối 'Điểm danh' đều đi qua bộ chuyển đổi, cùng một lần đọc getStudentPhamVi", () => {
    const s = code("app/(portal)/portal/ket-qua/page.tsx");
    expect(demLoiGoi(s, "getStudentPhamVi")).toBe(1);
    expect(demLoiGoi(s, "tienDoPortal")).toBe(1);
    expect(demLoiGoi(s, "diemDanhKetQua")).toBe(1);
  });

  it("[PVW-03] cờ: đọc theo cơ sở của LỚP bằng orgUnitId, KHÔNG BAO GIỜ hỏi với null/rỗng (rơi về giá trị toàn hệ); cơ sở không có OrgUnit ⇒ false", () => {
    const s = code("lib/portal/tien-do-pham-vi-db.ts");
    expect(demLoiGoi(s, "laThuHocPhiTheoPhamViBat")).toBe(1);
    expect(s).toMatch(/orgUnitId \? await laThuHocPhiTheoPhamViBat\(orgUnitId\) : false/);
    expect(s).not.toMatch(/laThuHocPhiTheoPhamViBat\(\s*(null|undefined)?\s*\)/);
    expect(demLoiGoi(s, "orgUnitIdForCenter")).toBe(1);
  });

  it("[PVW-04] khoá quyền học: luôn neo studentId + khoá của lớp, rồi lọc theo cơ sở của lớp (không quyền học của con khác / cơ sở khác)", () => {
    const s = code("lib/portal/tien-do-pham-vi-db.ts");
    expect(s).toMatch(/studyEntitlement\.findMany\(\{\s*where: \{\s*studentId,\s*courseId: \{ in:/);
    expect(demLoiGoi(s, "locTheoCoSo")).toBe(1);
    // hai lớp cùng một khoá ⇒ giữ đường cũ
    expect(s).toMatch(/soLopTheoKhoa\.get\(l\.courseId\) === 1/);
  });

  it("[PVW-05] số bài của buổi tính bằng MỘT hàm (soBuoiTheoLoTrinh qua baiCuaBuoi), không dùng Lesson.order trần hay hạng theo ngày", () => {
    const db = code("lib/portal/tien-do-pham-vi-db.ts");
    const thuan = code("lib/portal/tien-do-pham-vi.ts");
    expect(demLoiGoi(thuan, "soBuoiTheoLoTrinh")).toBe(1);
    expect(demLoiGoi(db, "baiCuaBuoi")).toBe(2); // buổi + dòng điểm danh
    expect(db).not.toMatch(/lesson\??\.order/);
  });

  it("[PVW-06] luật 12b: công thức 'theo phạm vi' CHỈ được gọi ở adapter; không nơi nào trong cổng phụ huynh chép nhãn 'ngoài phạm vi' hay gọi nhanLyDo/phanLoaiBai", () => {
    const tep = [...quet("lib/portal"), ...quet("app/(portal)")].filter((p) => !p.endsWith("lib/portal/tien-do-pham-vi.ts"));
    for (const p of tep) {
      const s = code(p);
      expect(demLoiGoi(s, "tienDoTheoPhamVi"), `${p} gọi thẳng tienDoTheoPhamVi`).toBe(0);
      expect(demLoiGoi(s, "nhanLyDo"), `${p} gọi thẳng nhanLyDo`).toBe(0);
      expect(demLoiGoi(s, "phanLoaiBai"), `${p} gọi thẳng phanLoaiBai`).toBe(0);
      expect(s, `${p} chép tay nhãn`).not.toMatch(/ngoài phạm vi đăng ký/i);
    }
    // và adapter thì ĐÚNG MỘT lần mỗi hàm lõi
    const a = code("lib/portal/tien-do-pham-vi.ts");
    expect(demLoiGoi(a, "tienDoTheoPhamVi")).toBe(2); // soLieuPhamVi + tienDoPortal
    expect(demLoiGoi(a, "nhanLyDo")).toBe(2); // BO_QUA + NGOAI_PHAM_VI — nguồn chữ duy nhất
  });

  it("[PVW-07] mốc thời gian do người gọi truyền (luật 19): hàm đọc không tự gọi new Date() ngoài giá trị mặc định ở learning.ts", () => {
    const db = code("lib/portal/tien-do-pham-vi-db.ts");
    expect(db).not.toMatch(/new Date\(/);
    expect(db).not.toMatch(/Date\.now\(/);
  });
});
