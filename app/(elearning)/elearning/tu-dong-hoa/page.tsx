import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { HANH_DONG_BI_CAM, dieuKienSchema, hanhDongSchema } from "@/lib/elearning/automation";
import { moTaKhi, moTaThi } from "@/lib/elearning/automation-mota";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import type { SacThai } from "@/lib/elearning/dashboard-pure";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { GhiChu, Khoi, KhoiRong, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU, NUT_CHINH, NUT_PHU } from "../_components/ui/dieu-khien";
import { RuleToggle } from "./_components/rule-toggle";

/**
 * EL-18 — CỖ MÁY TỰ ĐỘNG HOÁ: luật, lộ trình, và nhật ký thi hành. Khai luật / soạn lộ trình nằm ở route riêng (thiết kế 20/11):
 * `/tu-dong-hoa/luat` (kèm chạy thử chỉ-đọc) và `/tu-dong-hoa/lo-trinh`. Bật/tắt luật vẫn ở bảng này (lý do bắt buộc).
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

const NHAN_KET_QUA: Record<string, { chu: string; sac: SacThai }> = {
  APPLIED: { chu: "Đã thi hành", sac: "success" },
  SKIPPED: { chu: "Bỏ qua", sac: "muted" },
  FAILED: { chu: "Lỗi", sac: "danger" },
};

const gio = (d: Date) =>
  new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(d);

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
        <NoPermission permission="elearning:program:manage · elearning:progress:view-all" what="cỗ máy tự động hoá" askWho="phòng Đào tạo" />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  const [luat, loTrinh, nhatKy, khoa, phongBan] = await Promise.all([
    db.trnAutomationRule.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, title: true, trigger: true, action: true, enabled: true, dueDays: true, conditionJson: true, actionJson: true },
      orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    db.trnLearningPath.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, title: true, sequential: true, _count: { select: { steps: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.trnAutomationLog.findMany({
      select: { id: true, ruleId: true, subjectUserId: true, outcome: true, detail: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.trnCourse.findMany({ where: { deletedAt: null }, select: { id: true, title: true }, take: 500 }),
    db.departmentDef.findMany({ select: { id: true, name: true }, take: 200 }),
  ]);

  const tenKhoa = new Map((khoa as { id: string; title: string }[]).map((k) => [k.id, k.title] as const));
  const tenPhong = new Map((phongBan as { id: string; name: string }[]).map((p) => [p.id, p.name] as const));
  const tenLoTrinh = new Map(loTrinh.map((t) => [t.id, t.title] as const));
  const luatTheoId = new Map(luat.map((l) => [l.id, l] as const));
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
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Tự động hoá"
        subtitle="Khi → điều kiện → hành động. Không có hành động chế tài. Luật mới luôn lưu ở trạng thái tắt."
        actions={
          duocSua ? (
            <>
              <Link href="/elearning/tu-dong-hoa/luat" className={NUT_CHINH}>
                Khai luật mới
              </Link>
              <Link href="/elearning/tu-dong-hoa/lo-trinh" className={NUT_PHU}>
                Soạn lộ trình
              </Link>
            </>
          ) : undefined
        }
      />

      <GhiChu sac="info">
        <strong>Không có hành động chế tài.</strong> {HANH_DONG_BI_CAM.length} thứ như gắn cờ hồ sơ nhân sự hay trừ điểm đánh giá cố ý không tồn tại trong cỗ máy: QĐ-CDA-06 chốt chế độ chỉ báo cáo,
        &ldquo;không leo thang kỷ luật ở bất kỳ giá trị cấu hình nào&rdquo;. Chúng vắng mặt trong mã, không phải bị tắt bằng một cờ.{" "}
        <Link href="/elearning/yeu-cau" className={LIEN_KET_CHU}>
          Xem yêu cầu đào tạo
        </Link>
      </GhiChu>

      <Khoi tieuDe={`Luật (${luat.length})`}>
        {luat.length === 0 ? (
          <KhoiRong title="Chưa có luật nào" description="Cỗ máy đang không làm gì cả — đó là trạng thái mặc định." />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="luật" soDongMacDinh={20}>
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Luật</th>
                  <th scope="col" className={TH_BANG}>Khi</th>
                  <th scope="col" className={TH_BANG}>Thì</th>
                  <th scope="col" className={TH_BANG}>Trạng thái</th>
                  <th scope="col" className={TH_BANG}>
                    <span className="sr-only">Bật / tắt</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {luat.map((l) => {
                  const dk = dieuKienSchema.safeParse(l.conditionJson ?? {});
                  const aj = hanhDongSchema.safeParse(l.actionJson ?? {});
                  return (
                    <tr key={l.id} className={`${TR_BANG} align-top`}>
                      <td className={TD_BANG}>
                        <span className="block text-foreground">{l.title}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{l.code}</span>
                      </td>
                      <td className={TD_BANG}>{moTaKhi(String(l.trigger), dk.success ? dk.data : {}, { phongBan: tenPhong, khoa: tenKhoa })}</td>
                      <td className={TD_BANG}>{moTaThi(String(l.action), aj.success ? aj.data : {}, l.dueDays, { khoa: tenKhoa, loTrinh: tenLoTrinh })}</td>
                      <td className={`${TD_BANG} whitespace-nowrap`}>
                        <TrangThaiBadge sac={l.enabled ? "success" : "muted"}>{l.enabled ? "Đang bật" : "Đang tắt"}</TrangThaiBadge>
                      </td>
                      <td className={TD_BANG}>{duocSua ? <RuleToggle ruleId={l.id} dangBat={l.enabled} ten={l.title} /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </Khoi>

      <Khoi tieuDe={`Lộ trình (${loTrinh.length})`}>
        {loTrinh.length === 0 ? (
          <KhoiRong title="Chưa có lộ trình nào" description="Lộ trình là chuỗi khoá giao theo thứ tự; luật có thể giao trọn một lộ trình." />
        ) : (
          <ul className="space-y-2 text-sm">
            {loTrinh.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background px-4 py-3">
                <span className="font-medium">
                  {t.title}
                  <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{t.code}</span>
                </span>
                <span className="text-sm text-muted-foreground">
                  {t._count.steps} bước · {t.sequential ? "tuần tự" : "giao một lượt"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Khoi>

      <Khoi
        tieuDe="Nhật ký thi hành"
        moTa={
          <>
            Ghi cả những lần BỎ QUA kèm lý do — đây là chỗ trả lời câu &ldquo;vì sao tôi không được giao khoá đó&rdquo;.
            {soLoi > 0 ? <span className="ml-1 font-semibold text-state-danger-ink">{soLoi} dòng lỗi trong 100 dòng gần nhất.</span> : null}
          </>
        }
        sat
      >
        {nhatKy.length === 0 ? (
          <KhoiRong title="Chưa có lần thi hành nào" description="Khi một luật được kích hoạt, mỗi lần chạy — kể cả lần bỏ qua — sẽ ghi vào đây." />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="dòng" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Thời điểm</th>
                  <th scope="col" className={TH_BANG}>Luật</th>
                  <th scope="col" className={TH_BANG}>Đối tượng</th>
                  <th scope="col" className={TH_BANG}>Kết quả</th>
                  <th scope="col" className={TH_BANG}>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {nhatKy.map((n) => {
                  const k = NHAN_KET_QUA[String(n.outcome)] ?? NHAN_KET_QUA.SKIPPED!;
                  return (
                    <tr key={n.id} className={`${TR_BANG} align-top`}>
                      <td className={`${TD_BANG} whitespace-nowrap`}>{gio(n.createdAt)}</td>
                      <td className={`${TD_BANG} font-mono text-xs`}>{luatTheoId.get(n.ruleId)?.code ?? "(đã xoá)"}</td>
                      <td className={TD_BANG}>{tenNguoi.get(n.subjectUserId) ?? "(không rõ)"}</td>
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
