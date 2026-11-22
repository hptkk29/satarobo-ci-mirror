// tests/hoc-bu/_so-luot-fixture.ts — dựng SỔ LƯỢT cho fixture của các bộ học bù khác (T06).
//
// Fixture của T01/T02 dựng thẳng MakeupNeed/MakeupCaseStudent bằng `createMany` — tức giả lập "dữ liệu TRƯỚC T06". Từ T06 checker
// đòi sổ khớp (TV-33/34) hoặc báo "chưa nhập" (TV-35), nên fixture phải được NHẬP vào sổ đúng như prod sẽ làm bằng script
// `so-luot-khoi-tao`: cùng `docCapCanNhap` + `khoaTaiKhoan`, chỉ lọc theo tiền tố học viên của fixture.
import { db } from "@/lib/db";
import { docCapCanNhap } from "@/lib/hoc-bu/so-luot-nhap-db";
import { khoaTaiKhoan } from "@/lib/hoc-bu/so-luot";
import { nangCapCase } from "@/lib/hoc-bu/case-nang-cap-db";

export async function nhapSoCuaFixture(tienToHocVien: string): Promise<void> {
  await db.$transaction(
    async (tx) => {
      const ds = (await docCapCanNhap(tx)).filter((c) => c.studentId.startsWith(tienToHocVien));
      for (const c of ds) await khoaTaiKhoan(tx, { studentId: c.studentId, courseId: c.courseId, classId: c.classId }, null);
    },
    { timeout: 30_000 },
  );
}

/**
 * T07: fixture dựng thẳng case đời cũ (một bài, mục không có bé tham gia). Nâng chúng lên mô hình nhiều bài bằng CHÍNH hàm mà prod sẽ dùng
 * (`nangCapCase`), để checker đo trên hình dạng dữ liệu thật của sau T07 (TV-40 chỉ nên báo khi CÒN case chưa nâng).
 */
export async function nangCapCaseCuaFixture(tienToCase: string): Promise<void> {
  const ds = await db.makeupCase.findMany({ where: { id: { startsWith: tienToCase } }, select: { id: true } });
  for (const c of ds) await db.$transaction((tx) => nangCapCase(tx, c.id));
}

/** Dọn tài khoản của fixture — PHẢI chạy trước khi xoá khoá học (FK Restrict) hoặc học viên. */
export const donSoCuaFixture = (tienToHocVien: string) =>
  db.makeupCreditAccount.deleteMany({ where: { studentId: { startsWith: tienToHocVien } } });
