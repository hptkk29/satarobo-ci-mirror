import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { HANH_DONG_BI_CAM } from "@/lib/elearning/automation";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import type { SacThai } from "@/lib/elearning/dashboard-pure";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { GhiChu, Khoi, KhoiRong, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU } from "../_components/ui/dieu-khien";
import { RuleToggle } from "./_components/rule-toggle";
import { RuleForm } from "./_components/rule-form";
import { PathForm } from "./_components/path-form";

/**
 * EL-18 — CỖ MÁY TỰ ĐỘNG HOÁ: luật, lộ trình, và nhật ký thi hành.
 *
 * ⚠️ Nhật ký ghi CẢ những lần BỎ QUA, không chỉ những lần làm. Một cỗ máy chỉ ghi lúc
 * nó làm gì đó là một cỗ máy không giải thích được vì sao nó KHÔNG làm — và "vì sao
 * tôi không được giao khoá đó" là câu hỏi sẽ được hỏi.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tự động hoá | Sata Robo",
  robots: { index: false, follow: false },
};

const NHAN_KICH_HOAT: Record<string, string> = {
  NHAN_SU_MOI: "Nhân sự mới",
  KHOA_HOAN_THANH: "Hoàn thành một khoá",
  CHUNG_NHAN_HET_HAN: "Chứng nhận hết hiệu lực",
  YEU_CAU_MOI_AP_DUNG: "Yêu cầu mới áp dụng",
};

const NHAN_HANH_DONG: Record<string, string> = {
  GIAO_KHOA: "Giao một khoá",
  GIAO_LO_TRINH: "Giao trọn lộ trình",
  GUI_NHAC: "Gửi nhắc",
};

const NHAN_KET_QUA: Record<string, { chu: string; sac: SacThai }> = {
  APPLIED: { chu: "Đã thi hành", sac: "success" },
  SKIPPED: { chu: "Bỏ qua", sac: "muted" },
  FAILED: { chu: "Lỗi", sac: "danger" },
};

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  const duocSua = can(actor, "elearning:program:manage");
  if (!duocSua && !can(actor, "elearning:progress:view-all")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Tự động hoá" />
        <NoPermission
          permission="elearning:program:manage · elearning:progress:view-all"
          what="cỗ máy tự động hoá"
          askWho="phòng Đào tạo"
        />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);

  const luat = await db.trnAutomationRule.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      trigger: true,
      action: true,
      enabled: true,
      dueDays: true,
    },
    orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  const loTrinh = await db.trnLearningPath.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      sequential: true,
      _count: { select: { steps: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const nhatKy = await db.trnAutomationLog.findMany({
    select: {
      id: true,
      ruleId: true,
      subjectUserId: true,
      outcome: true,
      detail: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Dữ liệu cho hai form soạn — chỉ nạp khi người xem SỬA được (đọc qua scopedDb nên chỉ thấy khoá
  // trong tầm nhìn cơ sở của họ; khoá dùng chung centerId = null vẫn hiện, đúng NULL_IS_GLOBAL).
  const khoaChoForm = duocSua
    ? await db.trnCourse.findMany({
        where: { deletedAt: null, status: "PUBLISHED" },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
        take: 300,
      })
    : [];
  const phongBanChoForm = duocSua
    ? await db.departmentDef.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { displayOrder: "asc" },
        take: 100,
      })
    : [];

  const tenLuat = new Map(luat.map((l) => [l.id, l.title] as const));
  const tenNguoi = new Map(
    nhatKy.length === 0
      ? []
      : (
          await db.user.findMany({
            where: { id: { in: [...new Set(nhatKy.map((n) => n.subjectUserId))] } },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name ?? "(không rõ tên)"] as const),
  );

  const soLoi = nhatKy.filter((n) => n.outcome === "FAILED").length;

  return (
    <TrangQuanTri>
      <PageHeader
        title="Tự động hoá"
        subtitle={
          <>
            Kích hoạt → điều kiện → hành động. Mọi luật đều trả lời được &ldquo;vì sao
            người này được giao khoá đó&rdquo; bằng một câu, không bằng một điểm số.{" "}
            <Link href="/elearning/yeu-cau" className={LIEN_KET_CHU}>
              Xem yêu cầu đào tạo
            </Link>
          </>
        }
      />

      <GhiChu sac="info">
        {/* Nói ra rằng module KHÔNG có hành động chế tài, và vì sao — người vận hành
            đi tìm nó cần biết đây là quyết định, không phải thiếu sót. */}
        <strong>Không có hành động chế tài.</strong> Danh sách hành động cố ý không có{" "}
        {HANH_DONG_BI_CAM.length}{" "}thứ như gắn cờ hồ sơ nhân sự hay trừ điểm đánh giá:
        QĐ-CDA-06 chốt module chạy chế độ chỉ báo cáo, &ldquo;không leo thang kỷ luật ở
        bất kỳ giá trị cấu hình nào&rdquo;. Chúng vắng mặt trong mã, không phải bị tắt
        bằng một cờ — cờ tắt được thì bật được.
      </GhiChu>

      <Khoi tieuDe={`Luật (${luat.length})`}>
        <div className="space-y-3">
          {duocSua ? (
            <RuleForm
              khoa={khoaChoForm}
              loTrinh={loTrinh.map((t) => ({ id: t.id, title: t.title, soBuoc: t._count.steps }))}
              phongBan={phongBanChoForm}
            />
          ) : null}
          {luat.length === 0 ? (
            <KhoiRong
              title="Chưa có luật nào"
              description="Cỗ máy đang không làm gì cả — đó là trạng thái mặc định."
            />
          ) : (
            <ul className="space-y-2">
              {luat.map((l) => (
                <li key={l.id} className="rounded-xl border border-border bg-background p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {l.title}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {l.code}
                      </span>
                    </span>
                    <TrangThaiBadge sac={l.enabled ? "success" : "muted"}>
                      {l.enabled ? "Đang bật" : "Đang tắt"}
                    </TrangThaiBadge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Khi <strong className="text-foreground">{NHAN_KICH_HOAT[String(l.trigger)]}</strong> →{" "}
                    <strong className="text-foreground">{NHAN_HANH_DONG[String(l.action)]}</strong>, hạn {l.dueDays}{" "}
                    ngày.
                  </p>
                  {duocSua ? (
                    <div className="mt-2">
                      <RuleToggle ruleId={l.id} dangBat={l.enabled} ten={l.title} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Khoi>

      <Khoi tieuDe={`Lộ trình (${loTrinh.length})`}>
        <div className="space-y-3">
          {duocSua ? <PathForm khoa={khoaChoForm} /> : null}
          {loTrinh.length === 0 ? (
            <KhoiRong
              title="Chưa có lộ trình nào"
              description="Lộ trình là chuỗi khoá giao theo thứ tự; luật có thể giao trọn một lộ trình."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {loTrinh.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background px-4 py-3">
                  <span className="font-medium">
                    {t.title}
                    <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                      {t.code}
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t._count.steps} bước · {t.sequential ? "tuần tự" : "giao một lượt"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Khoi>

      <Khoi
        tieuDe="Nhật ký thi hành"
        moTa={
          <>
            Ghi cả những lần BỎ QUA kèm lý do — đây là chỗ trả lời câu &ldquo;vì sao tôi
            không được giao khoá đó&rdquo;.
            {soLoi > 0 ? (
              <span className="ml-1 font-semibold text-state-danger-ink">
                {soLoi} dòng lỗi trong 100 dòng gần nhất.
              </span>
            ) : null}
          </>
        }
        sat
      >
        {nhatKy.length === 0 ? (
          <KhoiRong
            title="Chưa có lần thi hành nào"
            description="Khi một luật được kích hoạt, mỗi lần chạy — kể cả lần bỏ qua — sẽ ghi vào đây."
          />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="dòng" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Lúc</th>
                  <th scope="col" className={TH_BANG}>Luật</th>
                  <th scope="col" className={TH_BANG}>Người</th>
                  <th scope="col" className={TH_BANG}>Kết quả</th>
                  <th scope="col" className={TH_BANG}>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {nhatKy.map((n) => {
                  const k = NHAN_KET_QUA[String(n.outcome)] ?? NHAN_KET_QUA.SKIPPED!;
                  return (
                    <tr key={n.id} className={`${TR_BANG} align-top`}>
                      <td className={`${TD_BANG} whitespace-nowrap`}>
                        {n.createdAt.toLocaleString("vi-VN")}
                      </td>
                      <td className={TD_BANG}>{tenLuat.get(n.ruleId) ?? "(đã xoá)"}</td>
                      <td className={TD_BANG}>
                        {tenNguoi.get(n.subjectUserId) ?? "(không rõ)"}
                      </td>
                      <td className={`${TD_BANG} whitespace-nowrap`}>
                        <TrangThaiBadge sac={k.sac}>{k.chu}</TrangThaiBadge>
                      </td>
                      <td className={`${TD_BANG} text-muted-foreground`}>{n.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </Khoi>
    </TrangQuanTri>
  );
}
