import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TabNav } from "../_components/ui/tab-nav";
import { TrangQuanTri } from "../_components/ui/trang";
import { BankList, type DongKho } from "./_components/bank-list";
import { laCauSo } from "@/lib/elearning/exam-grading";
import { docCauSoTuNoiDung } from "@/lib/elearning/question-content-map";
import { TAB_KHO, demTheoTab, dungCayNhanh, locTheoTab, tiLeDungTheoCau, type TabKho } from "@/lib/elearning/kho-cau-hoi-hien";
import { hrefTab, tabDangMo, type SearchParamsTho } from "@/lib/elearning/tab-url";

/**
 * EL-14b + P8 — KHO CÂU HỎI đào tạo nội bộ (thiết kế `QtCauHoi`): cây nhánh có đếm bên trái, ba tab (Mọi dạng · Máy chấm · Người chấm) và bảng câu hỏi bên phải.
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
 *
 * ⚠️ MIỀN DỮ LIỆU: kho NỘI BỘ (`TrnQuestion`). Thiết kế vẽ thêm cột "Dành cho" và các nhánh "Học viên · …" (kho dùng chung với khoá online) — kho chung CHƯA có
 * (B-12, chờ Owner), nên màn này không vẽ cột/nhánh đó: câu hỏi của khoá online nằm ở màn từng khoá online (`OnlQuestion`), không bao giờ lẫn vào đây.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kho câu hỏi | Sata Robo",
  robots: { index: false, follow: false },
};

const GOC = "/";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParamsTho> }) {
  const sp = await searchParams;
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
        <PageHeader title="Ngân hàng câu hỏi" />
        <NoPermission permission="elearning:content:author" what="kho câu hỏi" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }
  const xemNoiDung = can(actor, "elearning:content:publish");

  const db = scopedDb(actor);
  const nhanhTho = Array.isArray(sp.nhanh) ? sp.nhanh[0] : sp.nhanh;
  const loc = nhanhTho?.trim() || "";
  const tab = tabDangMo(sp, TAB_KHO, "moi-dang") as TabKho;

  const [moiCau, cacCau] = await Promise.all([
    // Cây nhánh + số dạng của TOÀN kho (không phụ thuộc nhánh/tab đang xem). Chỉ hai cột nhẹ.
    db.trnQuestion.findMany({ where: { deletedAt: null }, select: { bankPath: true, type: true }, take: 5000 }),
    db.trnQuestion.findMany({
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
        // Câu NHẬP SỐ: đáp án/sai số nằm trong `contentJson` — chỉ đi xuống khi người xem được xem NỘI DUNG (cùng cổng `xemNoiDung` với đề bài).
        contentJson: true,
        choices: {
          select: { text: true, isCorrect: true },
          orderBy: { orderIndex: "asc" },
        },
        _count: { select: { examQuestions: true } },
      },
      orderBy: [{ bankPath: "asc" }, { createdAt: "desc" }],
      take: 500,
    }),
  ]);

  // % đúng theo câu: gộp mọi đề dùng câu này, chỉ lượt ĐÃ CHẤM XONG (cùng nguồn với báo cáo Kết quả thi).
  const idCau = cacCau.map((c) => c.id);
  const cauCuaDe = idCau.length === 0 ? [] : await db.trnExamQuestion.findMany({ where: { questionId: { in: idCau } }, select: { id: true, questionId: true } });
  const traLoi =
    cauCuaDe.length === 0
      ? []
      : await db.trnExamAnswer.findMany({
          where: { examQuestionId: { in: cauCuaDe.map((e) => e.id) }, attempt: { status: "GRADED" } },
          select: { examQuestionId: true, isCorrect: true },
          take: 20000,
        });
  const dung = tiLeDungTheoCau(traLoi, new Map(cauCuaDe.map((e) => [e.id, e.questionId] as const)));

  const cay = dungCayNhanh(moiCau.map((c) => c.bankPath));
  const soDang = new Set(moiCau.map((c) => c.type)).size;
  const demTab = demTheoTab(cacCau);
  const hienThi = locTheoTab(cacCau, tab);

  const dong: DongKho[] = hienThi.map((c) => ({
    id: c.id,
    bankPath: c.bankPath,
    type: c.type,
    difficulty: c.difficulty,
    defaultPoints: c.defaultPoints,
    // ⚠️ Đề bài và đáp án CHỈ đi xuống khi có quyền. Đây là chỗ cắt thật.
    stem: xemNoiDung ? c.stem : null,
    daVaoDe: c._count.examQuestions > 0,
    soDe: c._count.examQuestions,
    tiLeDung: dung.get(c.id)?.tiLe ?? null,
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
          so: laCauSo(c.type) ? (docCauSoTuNoiDung(c.contentJson) ?? null) : null,
        }
      : null,
  }));

  const giuNhanh = { nhanh: loc || undefined };
  const hrefNhanh = (path: string | null) => (path ? `/elearning/kho-cau-hoi?nhanh=${encodeURIComponent(path)}${tab !== "moi-dang" ? `&tab=${tab}` : ""}` : hrefTab("/elearning/kho-cau-hoi", tab));
  const muc = (mo: boolean) =>
    `flex min-h-9 items-center justify-between gap-2 border-l-2 px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      mo ? "border-primary bg-card font-medium text-foreground" : "border-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground"
    }`;

  return (
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Ngân hàng câu hỏi"
        subtitle={`${moiCau.length} câu · ${soDang} dạng · câu đã nằm trong đề thi nhân bản thay vì sửa. Câu do Hội sở soạn dùng chung cho mọi cơ sở.`}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Nhánh kho câu hỏi" className="min-w-0">
          <ul className="m-0 list-none p-0">
            <li>
              <Link href={hrefNhanh(null)} aria-current={!loc ? "true" : undefined} className={muc(!loc)}>
                <span>Tất cả</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{moiCau.length}</span>
              </Link>
            </li>
            {cay.map((n) => (
              <li key={n.path}>
                <Link
                  href={hrefNhanh(n.path)}
                  aria-current={n.path === loc ? "true" : undefined}
                  className={muc(n.path === loc)}
                  style={{ paddingLeft: `${0.75 + n.cap * 0.9}rem` }}
                >
                  <span className="min-w-0 truncate" title={n.path}>
                    {n.nhan}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{n.dem}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4">
          <TabNav
            duongDan="/elearning/kho-cau-hoi"
            nhanDanhSach="Lọc theo cách chấm"
            dangMo={tab}
            giuLai={giuNhanh}
            tab={[
              { id: "moi-dang", nhan: "Mọi dạng", dem: demTab["moi-dang"] },
              { id: "may-cham", nhan: "Máy chấm", dem: demTab["may-cham"] },
              { id: "nguoi-cham", nhan: "Người chấm", dem: demTab["nguoi-cham"] },
            ]}
          />
          <BankList dong={dong} xemNoiDung={xemNoiDung} bankPathMacDinh={loc || GOC} nhanhCo={cay.map((n) => n.path)} />
        </div>
      </div>
    </TrangQuanTri>
  );
}
