import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { LY_DO_CHUA_CHON_KHOA, kiemKhoaTruocKhiVaoCase } from "./khoa-truoc-case";

describe("kiemKhoaTruocKhiVaoCase", () => {
  it("[KTC-01] lớp theo khung + bé chưa có khoá ⇒ CHẶN, kèm lý do", () => {
    for (const khoaCuaBe of [null, undefined, "", "   "]) {
      expect(kiemKhoaTruocKhiVaoCase({ lopTheoKhung: true, khoaCuaBe })).toEqual({
        duoc: false,
        lyDo: LY_DO_CHUA_CHON_KHOA,
      });
    }
  });

  it("[KTC-02] lớp theo khung + bé đã có khoá ⇒ cho qua (đối chứng dương của KTC-01)", () => {
    expect(kiemKhoaTruocKhiVaoCase({ lopTheoKhung: true, khoaCuaBe: "course-sata2" })).toEqual({
      duoc: true,
    });
  });

  it("[KTC-03] lớp CŨ không bị cổng này chặn — lớp cũ có khoá của lớp", () => {
    expect(kiemKhoaTruocKhiVaoCase({ lopTheoKhung: false, khoaCuaBe: null })).toEqual({
      duoc: true,
    });
  });
});

// ── [KTC-W] DÂY NỐI — lưới ghim mã nguồn ────────────────────────────────────────────
// Luật thuần ở trên xanh vĩnh viễn kể cả khi KHÔNG cửa nào gọi nó. Thứ cần khoá là hai
// cửa đưa bé vào case (xếp từ "Chưa xếp case", và gắn thẳng vào case) đều hỏi luật này,
// và cửa đổi khoá gác bằng ĐÚNG quyền của cửa xếp case.
function boChuThich(src: string): string {
  const ra: string[] = [];
  let trongKhoi = false;
  for (const d of src.split(/\r?\n/)) {
    let l = d;
    if (trongKhoi) {
      const h = l.indexOf("*/");
      if (h === -1) continue;
      l = l.slice(h + 2);
      trongKhoi = false;
    }
    for (;;) {
      const m = l.indexOf("/*");
      if (m === -1) break;
      const h = l.indexOf("*/", m + 2);
      if (h === -1) {
        l = l.slice(0, m);
        trongKhoi = true;
        break;
      }
      l = l.slice(0, m) + l.slice(h + 2);
    }
    const d2 = l.indexOf("//");
    if (d2 !== -1) l = l.slice(0, d2);
    ra.push(l);
  }
  return ra.join("\n");
}

/** Thân một hàm export theo tên — từ dòng khai tới dòng khai `export` kế tiếp. */
function thanHam(src: string, ten: string): string {
  const dau = src.indexOf(`export async function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const ke = src.indexOf("\nexport ", dau + 10);
  return src.slice(dau, ke === -1 ? undefined : ke);
}

describe("[KTC-W] cửa server có nối luật khoá học", () => {
  const goc = fs.readFileSync(
    path.join(process.cwd(), "app/(admin)/admin/lop-trial/_actions.ts"),
    "utf8",
  );
  const ACT = boChuThich(goc);

  it("phép quét tự kiểm: bỏ chú thích không ăn mất mã", () => {
    expect(ACT.length / goc.length).toBeGreaterThan(0.3);
  });

  it("[KTC-W1] xếp case (từ khối Chưa xếp case) hỏi luật khoá TRƯỚC khi chuyển", () => {
    const t = thanHam(ACT, "xepCaseHocVienAction");
    const hoi = t.indexOf("kiemKhoaTruocKhiVaoCase(");
    const chuyen = t.indexOf("rescheduleTrialEnrollment(");
    expect(hoi).toBeGreaterThan(-1);
    expect(hoi).toBeLessThan(chuyen);
    expect(t).toContain("interestedCourseId: true");
  });

  it("[KTC-W2] gắn thẳng vào case (có sessionId) cũng hỏi luật khoá TRƯỚC khi xếp", () => {
    const t = thanHam(ACT, "enrollLeadChildLopTrialAction");
    const hoi = t.indexOf("kiemKhoaTruocKhiVaoCase(");
    const xep = t.indexOf("enrollLeadChild(");
    expect(hoi).toBeGreaterThan(-1);
    expect(hoi).toBeLessThan(xep);
  });

  it("[KTC-W3] cửa đổi khoá gác bằng ĐÚNG quyền của cửa xếp case, trước phép ghi", () => {
    const t = thanHam(ACT, "datKhoaHocTrialAction");
    const quyen = t.indexOf("quyenChuyenCase(");
    const ghi = t.indexOf("datKhoaHocChoBeTrial(");
    expect(t).toContain('checkPermission("trials:manage")');
    expect(quyen).toBeGreaterThan(-1);
    expect(quyen).toBeLessThan(ghi);
    // Chặn lớp đã kết thúc + khoá đã ngừng — hai ca mà ô chọn trên màn không vẽ ra.
    expect(t).toContain('cls.status === "CANCELLED"');
    expect(t).toContain("!khoa.isActive");
  });

  it("[KTC-W4] đúng HAI chỗ hỏi luật — thêm cửa thứ ba thì phải cập nhật lưới này", () => {
    expect((ACT.match(/kiemKhoaTruocKhiVaoCase\(/g) ?? []).length).toBe(2);
  });
});
