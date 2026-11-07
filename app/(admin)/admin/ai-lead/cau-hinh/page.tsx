// app/(admin)/admin/ai-lead/cau-hinh/page.tsx — Cấu hình AI Lead (AI Lead Gateway, lát K).
// Bốn mục chọn bằng `?tab=` (mỗi mục là Server Component; không thêm route mới): Agent & khoá · Page · Cơ sở & catalog · Chính sách & cổng PROD.
// Cổng trang = `ai-leads:configure` (PAGE_GATES). Từng nút ghi gác lại ở Server Action; ở đây chỉ QUYẾT ĐỊNH HIỂN THỊ nút nào.
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/admin/ui/page-header";
import { ErrorState } from "@/components/admin/ui/states";
import { auth } from "@/lib/auth";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { agentTestDuocChayTrenMayChu } from "@/lib/ai-lead/cai-dat";
import { docBoQuyTacView, docCauHinh, docQuyTacTuTao, type BoQuyTacView, type CauHinhView, type QuyTacTuTaoView } from "@/lib/ai-lead/dich-vu/cau-hinh";
import { cn } from "@/lib/utils";
import { AgentVaKhoa } from "./_components/agent-va-khoa";
import { ChinhSach } from "./_components/chinh-sach";
import { CoSoCatalog } from "./_components/co-so-catalog";
import { PageAgent } from "./_components/page-agent";
import { QuyTac } from "./_components/quy-tac";
import { NutTaiLai } from "../_components/nut-tai-lai";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cấu hình AI Lead | Admin Sata Robo" };

const MUC = [
  { ma: "agent", nhan: "Agent & khoá" },
  { ma: "page", nhan: "Page" },
  { ma: "catalog", nhan: "Cơ sở & catalog" },
  { ma: "quy-tac", nhan: "Quy tắc" },
  { ma: "chinh-sach", nhan: "Chính sách & cổng PROD" },
] as const;
type MaMuc = (typeof MUC)[number]["ma"];

export default async function CauHinhAiLeadPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fai-lead%2Fcau-hinh");
  if (!(await checkAnyPermission([...PAGE_GATES["/ai-lead/cau-hinh"]]))) redirect("/dashboard?error=unauthorized");

  const [coXemKetNoi, coQuanLy, coCauHinh, coChinhSach] = await Promise.all([
    checkPermission("ai-integration:view"),
    checkPermission("ai-integration:manage"),
    checkPermission("ai-leads:configure"),
    checkPermission("ai-leads:policy"),
  ]);
  const duocPage = coCauHinh || coQuanLy;
  const sp = await searchParams;
  const hienMuc = MUC.filter((m) => m.ma !== "agent" || coXemKetNoi || coQuanLy);
  const dangChon: MaMuc = hienMuc.find((m) => m.ma === sp.tab)?.ma ?? hienMuc[0]?.ma ?? "page";

  // KHÔNG log lỗi trần (có thể chứa giá trị cột). Lỗi đọc ⇒ ErrorState; lỗi vẫn lên Sentry ở ranh giới hạ tầng.
  const view: CauHinhView | null = await docCauHinh(new Date()).catch(() => null);
  const boQuyTac: BoQuyTacView | null = dangChon === "quy-tac" ? await docBoQuyTacView().catch(() => null) : null;
  // Quy tắc tự tạo lead theo Page (E2) — chỉ đọc khi đang ở mục Page. Lỗi đọc ⇒ `null` = "không đọc được": màn hình KHÔNG được hiện "TẮT" (khẳng định) khi chưa biết.
  const quyTac: QuyTacTuTaoView | null = dangChon === "page" ? await docQuyTacTuTao().catch(() => null) : { toanHe: false, batTheo: [] };

  return (
    <div className="mx-auto w-full max-w-[96rem]">
      <PageHeader title="Cấu hình AI Lead" subtitle="Agent & khoá, Page, cơ sở xuất bản và catalog cho AI Messenger. Thao tác nguy hiểm đều hỏi lý do và ghi nhật ký." />
      <nav aria-label="Các mục cấu hình" className="mb-5 flex flex-wrap gap-1">
        {hienMuc.map((m) => (
          <Link
            key={m.ma}
            href={`?tab=${m.ma}`}
            aria-current={m.ma === dangChon ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors",
              m.ma === dangChon ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {m.nhan}
          </Link>
        ))}
      </nav>

      {view === null ? (
        <ErrorState action={<NutTaiLai href={`?tab=${dangChon}`} />} />
      ) : dangChon === "agent" ? (
        <AgentVaKhoa agents={view.agents} masterKeyOk={view.masterKeyOk} congProdMo={view.chinhSach.congProd.allowed} coQuyenQuanLy={coQuanLy} testDuocChay={agentTestDuocChayTrenMayChu()} />
      ) : dangChon === "page" ? (
        <PageAgent agents={view.agents} coSo={view.coSoChon} duocSua={duocPage} quyTac={quyTac} duocDatTuTao={coQuanLy} />
      ) : dangChon === "quy-tac" ? (
        boQuyTac === null ? <ErrorState action={<NutTaiLai href="?tab=quy-tac" />} /> : <QuyTac view={boQuyTac} agents={view.agents} coSo={view.coSoChon} duocSua={coCauHinh} />
      ) : dangChon === "catalog" ? (
        <CoSoCatalog view={view} duocSua={coCauHinh} />
      ) : (
        <ChinhSach chinhSach={view.chinhSach} coQuyenChinhSach={coChinhSach} />
      )}
    </div>
  );
}
