// lib/hoc-bu/so-luot-nhap-db.ts — NHẬP dữ liệu lượt bù TRƯỚC T06 vào sổ (T06, 07/10/2026). Đọc + ghi cho script `so-luot-khoi-tao`.
//
// Sổ tạo tài khoản LƯỜI (lần đầu một bé được xếp/điểm danh bù) nên bé không đụng tới học bù sẽ không có tài khoản — điều đó ổn vì công
// thức vẫn cho số xem trước. Nhưng bé ĐÃ có lượt đang giữ hoặc đã tiêu từ trước T06 thì sổ phải biết ngay, không đợi lần sau (checker
// TV-35 báo đúng nhóm này). Hàm ở đây tìm đúng nhóm đó, và dùng CHÍNH `khoaTaiKhoan` để nhập (cùng luật khởi tạo với đường lười).
import type { Prisma } from "@prisma/client";
import { khoaTaiKhoan } from "@/lib/hoc-bu/so-luot";
import { tongLuotCongThuc } from "@/lib/hoc-bu/luot-cong-thuc-db";
import { soVuotCuaSo } from "@/lib/hoc-bu/so-luot-thuan";

type Tx = Prisma.TransactionClient;

export type CapCanNhap = {
  studentId: string;
  courseId: string;
  /** Lớp của một dòng bất kỳ của cặp — chỉ để tính công thức (công thức theo lớp). */
  classId: string;
  hocVien: string;
  dangGiu: number;
  daTieu: number;
  tongCongThuc: number;
  /** Phần dữ liệu cũ vượt công thức — sẽ nằm trong sổ như MỘT bút toán ADJUSTMENT có lý do (cần người rà). */
  soVuot: number;
};

/** Mọi (học viên, khoá) có lượt đang giữ / đã tiêu mà CHƯA có tài khoản. Chỉ đọc. */
export async function docCapCanNhap(tx: Tx): Promise<CapCanNhap[]> {
  const needs = await tx.makeupNeed.findMany({
    where: { OR: [{ usedQuota: true }, { caseStudents: { some: { status: "PLACED", dungLuot: true } } }] },
    select: {
      studentId: true,
      courseId: true,
      classId: true,
      usedQuota: true,
      student: { select: { name: true, leadChildId: true } },
      class: { select: { course: { select: { id: true, totalSessions: true, choPhepHocBu: true } } } },
      caseStudents: { where: { status: "PLACED", dungLuot: true }, select: { id: true } },
    },
    orderBy: [{ studentId: "asc" }, { courseId: "asc" }, { id: "asc" }],
  });
  if (needs.length === 0) return [];
  const coTk = await tx.makeupCreditAccount.findMany({
    where: { studentId: { in: [...new Set(needs.map((n) => n.studentId))] } },
    select: { studentId: true, courseId: true },
  });
  const daCo = new Set(coTk.map((t) => `${t.studentId}|${t.courseId}`));

  const nhom = new Map<string, CapCanNhap & { leadChildId: string | null; course: { id: string; totalSessions: number | null; choPhepHocBu: boolean } }>();
  for (const n of needs) {
    const k = `${n.studentId}|${n.courseId}`;
    if (daCo.has(k)) continue;
    const g =
      nhom.get(k) ??
      {
        studentId: n.studentId,
        courseId: n.courseId,
        classId: n.classId,
        hocVien: n.student.name,
        dangGiu: 0,
        daTieu: 0,
        tongCongThuc: 0,
        soVuot: 0,
        leadChildId: n.student.leadChildId,
        course: n.class.course,
      };
    g.dangGiu += n.caseStudents.length;
    if (n.usedQuota) g.daTieu += 1;
    nhom.set(k, g);
  }
  const theoCap = await tongLuotCongThuc(
    tx,
    tx,
    [...nhom.values()].map((g) => ({ studentId: g.studentId, classId: g.classId, leadChildId: g.leadChildId, course: g.course })),
  );
  return [...nhom.values()].map(({ leadChildId: _l, course: _c, ...g }) => {
    const tong = theoCap.get(`${g.studentId}|${g.classId}`) ?? 0;
    return {
      ...g,
      tongCongThuc: tong,
      soVuot: soVuotCuaSo(tong, g.dangGiu + g.daTieu),
    };
  });
}

/**
 * Nhập từng cặp bằng `khoaTaiKhoan` (cùng luật khởi tạo với đường lười). `expect` BẮT BUỘC: số cặp thấy ở dry-run — lệch ⇒ ném,
 * chưa ghi gì. Chạy trong MỘT transaction của người gọi.
 */
export async function apDungNhapSo(tx: Tx, p: { expect: number }): Promise<{ daNhap: CapCanNhap[] }> {
  const ds = await docCapCanNhap(tx);
  if (ds.length !== p.expect) {
    throw new Error(`Số cặp cần nhập đã đổi: dry-run thấy ${p.expect}, bây giờ là ${ds.length} — DỪNG, chạy lại dry-run.`);
  }
  for (const c of ds) {
    await khoaTaiKhoan(tx, { studentId: c.studentId, courseId: c.courseId, classId: c.classId }, null);
  }
  return { daNhap: ds };
}
