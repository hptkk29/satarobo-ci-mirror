import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangQuanTri } from "../_components/ui/trang";
import { BankList, type DongKho } from "./_components/bank-list";

/**
 * EL-14b — KHO CÂU HỎI đào tạo nội bộ.
 *
 * ⚠️ CỔNG QUYỀN HAI TẦNG, cố ý:
 *  · vào được màn  = `elearning:content:author`  [SUPER_ADMIN, HO_HR, TRAINING]
 *  · thấy NỘI DUNG = `elearning:content:publish` [SUPER_ADMIN, TRAINING]
 *
 * Nghiệm thu đòi "chỉ Đào tạo và Quản trị tối cao thấy ngân hàng câu hỏi", nhưng
 * KHÔNG khoá quyền nào trong bộ 17 có đúng tập vai đó. Mở khoá thứ 18 thì phải sửa
 * `seed-roles.ts` VÀ chạy `seed-prod-roles.yml` từ `main` sau merge — một việc phải
 * biết trước, không phải phát hiện sau. Hai tầng này cho HO_HR xem được thống kê
 * mà không thấy đề bài, tức giữ đúng phần quan trọng của yêu cầu.
 *
 * ⚠️ Cắt nội dung ở SERVER, không ẩn ở giao diện. Ẩn bằng CSS là để đề bài và đáp
 * án nằm trong HTML — mở F12 ra là đọc được, và cả kho câu hỏi mất giá trị.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kho câu hỏi | Sata Robo",
  robots: { index: false, follow: false },
};

const GOC = "/";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ nhanh?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:content:author")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Kho câu hỏi" />
        <NoPermission permission="elearning:content:author" what="kho câu hỏi" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }
  const xemNoiDung = can(actor, "elearning:content:publish");

  const db = scopedDb(actor);
  const { nhanh } = await searchParams;
  const loc = nhanh?.trim() || "";

  const cacCau = await db.trnQuestion.findMany({
    where: {
      deletedAt: null,
      ...(loc ? { bankPath: { startsWith: loc } } : {}),
    },
    select: {
      id: true,
      bankPath: true,
      type: true,
      difficulty: true,
      defaultPoints: true,
      stem: true,
      explanation: true,
      choices: {
        select: { text: true, isCorrect: true },
        orderBy: { orderIndex: "asc" },
      },
      _count: { select: { examQuestions: true } },
    },
    orderBy: [{ bankPath: "asc" }, { createdAt: "desc" }],
    take: 500,
  });

  // Cây nhánh dựng TỪ dữ liệu, không khai tay: nhánh nào có câu thì nhánh đó tồn
  // tại. Khai tay là danh sách trôi khỏi thực tế ngay lần đầu ai đó đặt nhánh mới.
  const nhanhCo = [...new Set(cacCau.map((c) => c.bankPath))].sort();

  const dong: DongKho[] = cacCau.map((c) => ({
    id: c.id,
    bankPath: c.bankPath,
    type: c.type,
    difficulty: c.difficulty,
    defaultPoints: c.defaultPoints,
    // ⚠️ Đề bài và đáp án CHỈ đi xuống khi có quyền. Đây là chỗ cắt thật.
    stem: xemNoiDung ? c.stem : null,
    daVaoDe: c._count.examQuestions > 0,
    chiTiet: xemNoiDung
      ? {
          id: c.id,
          bankPath: c.bankPath,
          type: c.type,
          stem: c.stem,
          explanation: c.explanation,
          difficulty: c.difficulty,
          defaultPoints: c.defaultPoints,
          choices: c.choices,
        }
      : null,
  }));

  const chip = (mo: boolean) =>
    `inline-flex min-h-9 items-center rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
      mo
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-card text-foreground hover:bg-muted"
    }`;

  return (
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Kho câu hỏi"
        subtitle={`${cacCau.length} câu${loc ? ` ở nhánh ${loc}` : ""}. Câu do Hội sở soạn dùng chung cho mọi cơ sở.`}
      />

      {nhanhCo.length > 0 ? (
        <nav aria-label="Lọc theo nhánh kho" className="flex flex-wrap gap-2">
          <Link
            href="/elearning/kho-cau-hoi"
            aria-current={!loc ? "true" : undefined}
            className={chip(!loc)}
          >
            Tất cả
          </Link>
          {nhanhCo.map((n) => (
            <Link
              key={n}
              href={`/elearning/kho-cau-hoi?nhanh=${encodeURIComponent(n)}`}
              aria-current={n === loc ? "true" : undefined}
              className={`${chip(n === loc)} font-mono`}
            >
              {n}
            </Link>
          ))}
        </nav>
      ) : null}

      <BankList
        dong={dong}
        xemNoiDung={xemNoiDung}
        bankPathMacDinh={loc || GOC}
      />
    </TrangQuanTri>
  );
}
