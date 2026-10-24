// [GDC-*] — xếp LẠI học viên vào lớp từng có ghi danh đã kết thúc (sự cố 09/10/2026, prod:
// học viên CS2-26-57AWRE "gỡ ra add lại" lớp P302 ⇒ mọi cửa từ chối vì dòng "Đã huỷ").
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  xetGhiDanhCu,
  cauChanGhiDanhCu,
  TRANG_THAI_GO_DUOC,
  type GhiDanhCu,
  type DemNghiepVu,
} from "./ghi-danh-cu-trong-lop";
import { nhanTinhTrangHoSo } from "@/app/(admin)/admin/students/_components/ho-so/nhan-ho-so";

const SACH: DemNghiepVu = { payments: 0, orderItems: 0, receipts: 0, reserves: 0, refundRequests: 0 };
const dong = (status: GhiDanhCu["status"], dem: Partial<DemNghiepVu> = {}): GhiDanhCu => ({
  id: "e1",
  status,
  _count: { ...SACH, ...dem },
});

describe("[GDC-01] xetGhiDanhCu — phân loại dòng cũ ở lớp đích", () => {
  it("không có dòng ⇒ TRONG, không câu chặn", () => {
    expect(xetGhiDanhCu(null)).toEqual({ loai: "TRONG" });
    expect(cauChanGhiDanhCu(xetGhiDanhCu(null))).toBeNull();
  });

  it("ĐÚNG ca prod: CANCELLED, không dữ liệu nghiệp vụ ⇒ GO_DUOC, không câu chặn", () => {
    const x = xetGhiDanhCu(dong("CANCELLED"));
    expect(x).toEqual({ loai: "GO_DUOC", id: "e1", status: "CANCELLED" });
    expect(cauChanGhiDanhCu(x)).toBeNull();
  });

  it("WITHDREW sạch ⇒ GO_DUOC (gỡ nhầm khi đã học vẫn xếp lại được)", () => {
    expect(xetGhiDanhCu(dong("WITHDREW")).loai).toBe("GO_DUOC");
  });

  it.each(["PENDING", "CONFIRMED", "STUDYING", "ACTIVE", "PAUSED", "COMPLETED", "TRANSFERRED"] as const)(
    "%s ⇒ DANG_CHIEM (vẫn chặn như cũ, câu nói tiếng Việt)",
    (s) => {
      const x = xetGhiDanhCu(dong(s));
      expect(x.loai).toBe("DANG_CHIEM");
      const cau = cauChanGhiDanhCu(x) ?? "";
      expect(cau).toMatch(/^Học viên đã có trong lớp này \(trạng thái: /);
      // Câu cũ in mã thô ("trạng thái: CANCELLED") — người vận hành không đọc được.
      expect(cau).not.toContain(`trạng thái: ${s})`);
    },
  );

  it.each(["payments", "orderItems", "receipts", "reserves", "refundRequests"] as const)(
    "CANCELLED nhưng có %s ⇒ CO_DU_LIEU, chặn bằng câu nói rõ lý do (không P2002 thô)",
    (k) => {
      const x = xetGhiDanhCu(dong("CANCELLED", { [k]: 1 }));
      expect(x.loai).toBe("CO_DU_LIEU");
      expect(cauChanGhiDanhCu(x)).toMatch(/khoản thu \/ biên lai/);
    },
  );

  it("chỉ CANCELLED + WITHDREW được tự gỡ — TRANSFERRED là nguồn chuỗi chuyển lớp", () => {
    expect([...TRANG_THAI_GO_DUOC].sort()).toEqual(["CANCELLED", "WITHDREW"]);
  });
});

// ── [GDC-W*] lưới ghim DÂY NỐI — test hành vi của action đều giả lập DB, nên gỡ lời gọi ở
// cửa nào thì không ca hành vi nào đỏ. Neo vào LỜI GọI (có dấu `(`), đếm số lần.
function nguon(p: string): string {
  return readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

describe("[GDC-W] mọi cửa ghi danh hỏi cùng một luật", () => {
  const CUA = [
    "app/(admin)/admin/enrollments/_actions.ts",
    "app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts",
    "app/(admin)/admin/class-groups/_actions.ts",
  ];
  it.each(CUA)("%s gọi xetGhiDanhCu( + cauChanGhiDanhCu( + goGhiDanhCuDaKetThuc(", (p) => {
    const s = nguon(p);
    expect(s).toMatch(/xetGhiDanhCu\(/);
    expect(s).toMatch(/cauChanGhiDanhCu\(/);
    expect(s).toMatch(/goGhiDanhCuDaKetThuc\(\s*tx/);
  });

  it("enrollStudent KHÔNG còn câu tra `existing` trần { studentId, classId } không lọc", () => {
    const s = nguon("app/(admin)/admin/enrollments/_actions.ts");
    const fn = s.slice(s.indexOf("export async function enrollStudent("), s.indexOf("const ChangeStatusSchema"));
    expect(fn).not.toMatch(/where:\s*\{\s*studentId,\s*classId\s*\}/);
    expect(fn).toMatch(/whereGhiDanhCu\(studentId, classId\)/);
  });
});

describe("[GDC-NHAN] dải đầu hồ sơ nói CÙNG một chữ với danh sách /students", () => {
  it("ĐÚNG ca prod: ACTIVE + chỉ một ghi danh 'Đã huỷ' ⇒ 'Chờ xếp lớp', KHÔNG 'Đang học'", () => {
    expect(nhanTinhTrangHoSo("ACTIVE", ["CANCELLED"]).nhan).toBe("Chờ xếp lớp");
  });
  it("đối chứng dương: ACTIVE + ghi danh đang học ⇒ 'Đang học'", () => {
    expect(nhanTinhTrangHoSo("ACTIVE", ["ACTIVE"]).nhan).toBe("Đang học");
  });
  it("trạng thái do người vận hành đặt giữ nguyên nghĩa (Bảo lưu / Nghỉ học)", () => {
    expect(nhanTinhTrangHoSo("PAUSED", ["ACTIVE"]).nhan).toBe("Bảo lưu");
    expect(nhanTinhTrangHoSo("INACTIVE", []).nhan).toBe("Nghỉ học");
  });
  it("dải đầu gọi nhanTinhTrangHoSo( — không đọc thẳng NHAN_TRANG_THAI_HV[student.status]", () => {
    const s = nguon("app/(admin)/admin/students/_components/ho-so/dai-danh-tinh.tsx");
    expect(s).toMatch(/nhanTinhTrangHoSo\(/);
    expect(s).not.toMatch(/NHAN_TRANG_THAI_HV\[student\.status\]/);
  });
  it("khối Lớp & tiến độ có lối ghi danh ở CẢ hai nhánh (chưa từng có lớp / không còn lớp nào)", () => {
    const s = nguon("app/(admin)/admin/students/_components/ho-so/lop-va-tien-do.tsx");
    expect(s.match(/href=\{`\/enrollments\/new\?studentId=\$\{studentId\}`\}/g)?.length).toBe(2);
  });
});
