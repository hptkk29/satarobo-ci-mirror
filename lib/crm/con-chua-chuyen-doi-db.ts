/**
 * Đọc DB cho `conConChuyenDoiDuoc` — MỘT phép đọc dùng chung cho hàm chốt (`convert-lead-v2`),
 * trang lead (nút "Chuyển đổi") và trang chuyển đổi (danh sách bé). Ba chỗ mà đọc ba kiểu là
 * nút hiện một đằng, server nhận một nẻo.
 */
import type { Prisma } from "@prisma/client";
import { conConChuyenDoiDuoc } from "./con-chua-chuyen-doi";

type DocLeadChild = {
  leadChild: {
    findMany(args: {
      where: Prisma.LeadChildWhereInput;
      select: {
        id: true;
        closedAt: true;
        createdAt: true;
        _count: { select: { enrollments: true; sourceStudents: true } };
      };
    }): Promise<
      {
        id: string;
        closedAt: Date | null;
        createdAt: Date;
        _count: { enrollments: number; sourceStudents: number };
      }[]
    >;
  };
};

/** Mã các bé của lead ĐÃ chuyển đổi còn chốt được. Lead chưa chuyển đổi ⇒ không dùng hàm này. */
export async function docConChuyenDoiDuoc(
  client: DocLeadChild,
  leadId: string,
  leadConvertedAt: Date,
): Promise<string[]> {
  const con = await client.leadChild.findMany({
    where: { leadId },
    select: {
      id: true,
      closedAt: true,
      createdAt: true,
      _count: { select: { enrollments: true, sourceStudents: true } },
    },
  });
  return conConChuyenDoiDuoc(
    leadConvertedAt,
    con.map((c) => ({
      id: c.id,
      closedAt: c.closedAt,
      createdAt: c.createdAt,
      soGhiDanh: c._count.enrollments,
      soHocVien: c._count.sourceStudents,
    })),
  );
}
