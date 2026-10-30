// app/(admin)/admin/ai-lead/[id]/page.tsx — Chi tiết MỘT hồ sơ chờ AI, bốn khối:
//   ① Thông tin Agent thu thập (nhãn «do Agent khai, chưa được Meta xác minh»)  ② Hội thoại (mở Page Inbox / hướng dẫn tìm tay)
//   ③ Xử lý (nhận · bổ sung · duyệt · từ chối · chuyển · trả · báo đã nhận)       ④ Dòng thời gian (nhật ký)
// Server Component. Che PII Ở SERVER theo `leads:view-pii`; hồ sơ ngoài phạm vi cơ sở hiện cùng màn «không tìm thấy» như hồ sơ không tồn tại (không lộ sự tồn tại).
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ExternalLink, Info } from "lucide-react";
import { EmptyState, ErrorState, NoPermission } from "@/components/admin/ui/states";
import { ViTrang } from "../_components/nhan-trang-thai";
import { NutTaiLai } from "../_components/nut-tai-lai";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { canViewLeadPii, checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { chiTiet, ungVienChuyen, type ChiTietHoSo } from "@/lib/ai-lead/dich-vu/duyet";
import { bangNut } from "@/lib/ai-lead/dich-vu/hanh-dong-kha-dung";
import { khoiLienKetHoiThoai } from "@/lib/ai-lead/dich-vu/lien-ket-inbox";
import { getSetting } from "@/lib/settings/service";
import { KhoiXuLy } from "../_ho-so/khoi-xu-ly";
import { NhanSla, NhanTrangThai } from "../_ho-so/huy-hieu";
import {
  NHAN_HANH_DONG,
  NHAN_NGUON_TEN,
  NHAN_NGUON_TEN_KHAI,
  NHAN_OWNER,
  NHAN_Y_DINH,
  conLai,
  gioVn,
} from "../_ho-so/hien-thi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chi tiết hồ sơ AI | Admin Sata Robo" };

const KHOI = "min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5";
const DL = "grid grid-cols-1 gap-x-4 gap-y-3 min-[440px]:grid-cols-[9.5rem_minmax(0,1fr)]";
const DT = "text-xs font-medium text-muted-foreground min-[440px]:pt-0.5";
const DD = "min-w-0 break-words text-sm text-foreground";

function QuayLai() {
  return (
    <Link href="/ai-lead" className="mb-3 inline-flex h-11 items-center gap-1.5 rounded-lg pr-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-9">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Danh sách hồ sơ chờ AI
    </Link>
  );
}

export default async function ChiTietHoSoAiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent(`/ai-lead/${id}`)}`);
  if (!(await checkAnyPermission([...PAGE_GATES["/ai-lead"]]))) {
    return (
      <div className="mx-auto w-full max-w-[90rem]">
        <QuayLai />
        <NoPermission what="hồ sơ chờ AI" permission="ai-leads:view" askWho="quản trị viên hệ thống" />
      </div>
    );
  }

  const now = new Date();
  let ct: ChiTietHoSo | null;
  let coPii: boolean;
  let coQuyenReview: boolean;
  let mauLink: string;
  let ungVien: { id: string; ten: string }[] = [];
  try {
    const [actor, pii, review, mau] = await Promise.all([
      resolveActor(session.user.id),
      canViewLeadPii(),
      checkPermission("ai-leads:review"),
      getSetting("ai.inboxLinkTemplate"),
    ]);
    coPii = pii;
    coQuyenReview = review;
    mauLink = mau;
    ct = await chiTiet(actor, id, pii, now);
    if (ct && review && ct.claimedBoiToi) ungVien = await ungVienChuyen({ actor, ten: session.user.name ?? "" }, id);
  } catch {
    return (
      <div className="mx-auto w-full max-w-[90rem]">
        <QuayLai />
        <ErrorState description="Không đọc được hồ sơ này. Tải lại trang; nếu vẫn lỗi, báo bộ phận kỹ thuật." action={<NutTaiLai href={`/ai-lead/${id}`} />} />
      </div>
    );
  }

  if (!ct) {
    return (
      <div className="mx-auto w-full max-w-[90rem]">
        <QuayLai />
        <EmptyState
          title="Không tìm thấy hồ sơ"
          description="Hồ sơ không tồn tại, hoặc thuộc cơ sở bạn không phụ trách. Quay lại danh sách để chọn hồ sơ khác."
        />
      </div>
    );
  }

  const bang = bangNut({
    state: ct.state,
    claimedById: ct.claimedById,
    claimedBoiToi: ct.claimedBoiToi,
    claimedTen: ct.claimedTen,
    coQuyenReview,
    thieu: ct.thieu,
    ownerState: ct.hoiThoai.ownerState,
  });
  const lienKet = khoiLienKetHoiThoai(mauLink, ct.hoiThoai.inboxThreadId);
  // Thiếu quyền xem PII: server KHÔNG đưa giá trị thật xuống ô sửa — ô trống, giá trị đã che chỉ làm gợi ý.
  const ban = {
    fbName: coPii ? (ct.fbName ?? "") : "",
    phone: coPii ? (ct.phone ?? "") : "",
    goiYFbName: coPii ? "" : (ct.fbName ?? ""),
    goiYPhone: coPii ? "" : (ct.phone ?? ""),
  };

  return (
    <div className="mx-auto w-full max-w-[90rem]">
      <QuayLai />
      <header className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="line-clamp-3 break-words text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {ct.fbName ?? "Hồ sơ chưa có tên Facebook"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mã hồ sơ {ct.id.slice(-8)} · {NHAN_Y_DINH[ct.intent] ?? ct.intent} · nhận lúc {gioVn(ct.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <NhanTrangThai state={ct.state} />
          <NhanSla muc={ct.mucSla} />
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        {/* ① THÔNG TIN AGENT THU THẬP */}
        <section aria-labelledby="kh-thong-tin" className={`${KHOI} lg:col-start-1 lg:row-start-1`}>
          <h2 id="kh-thong-tin" className="text-base font-semibold text-foreground">Thông tin Agent thu thập</h2>
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-state-info-soft px-3 py-2 text-xs text-state-info-ink">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Do Agent khai từ hội thoại, <strong>chưa được Meta xác minh</strong>. Đối chiếu trong Page Inbox trước khi duyệt.</span>
          </p>
          <dl className={`${DL} mt-4`}>
            <dt className={DT}>Tên Facebook</dt>
            <dd className={DD}>
              <span className="font-medium">{ct.fbName ?? "Chưa có"}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2">
                {ct.nguonTen ? (
                  <ViTrang tone={ct.nguonTen === "NHAN_VIEN" ? "success" : "muted"}>{NHAN_NGUON_TEN[ct.nguonTen]}</ViTrang>
                ) : (
                  <ViTrang tone="warning">Chưa xác minh</ViTrang>
                )}
                {ct.fbNameSource && <span className="text-xs text-muted-foreground">{NHAN_NGUON_TEN_KHAI[ct.fbNameSource] ?? ct.fbNameSource}</span>}
              </span>
            </dd>
            <dt className={DT}>Số điện thoại</dt>
            <dd className={DD}>
              {ct.phone ? <span className="font-medium tabular-nums">{ct.phone}</span> : <span className="text-muted-foreground">Chưa có hoặc chưa hợp lệ</span>}
              {ct.phone && !coPii && <span className="mt-0.5 block text-xs text-muted-foreground">Đã che theo quyền của bạn.</span>}
            </dd>
            <dt className={DT}>Cơ sở khách chọn</dt>
            <dd className={DD}>{ct.centerTen ?? <span className="text-muted-foreground">Chưa chọn</span>}{ct.campusCode && <span className="ml-2 text-xs text-muted-foreground">({ct.campusCode})</span>}</dd>
            <dt className={DT}>Khách muốn</dt>
            <dd className={DD}>{NHAN_Y_DINH[ct.intent] ?? ct.intent}</dd>
            <dt className={DT}>Đồng ý được liên hệ</dt>
            <dd className={DD}>{ct.consentAllowed ? "Có — Agent đã ghi nhận kèm bằng chứng tin nhắn" : "Chưa ghi nhận"}</dd>
            <dt className={DT}>Page · khách</dt>
            <dd className={DD}><span className="font-mono text-xs">{ct.pageId}</span> · khách <span className="font-mono text-xs">{ct.psidRutGon}</span></dd>
            <dt className={DT}>Hạn SLA</dt>
            <dd className={DD}>
              Nhận: {ct.claimedById ? "đã có người nhận" : `${gioVn(ct.slaClaimDueAt)} (${conLai(ct.slaClaimDueAt, now)})`}
              <br />
              Xử lý xong: {gioVn(ct.slaResolveDueAt)} {ct.slaResolveDueAt ? `(${conLai(ct.slaResolveDueAt, now)})` : ""}
            </dd>
            {ct.leadId && (
              <>
                <dt className={DT}>Lead đã tạo</dt>
                <dd className={DD}>
                  <Link href={`/leads/${ct.leadId}`} className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-h-0">
                    Mở lead trong CRM
                  </Link>
                  {ct.resultNote === "GAN_VAO_LEAD_CO_SAN" && <span className="block text-xs text-muted-foreground">Số này đã có lead đang mở nên hồ sơ được gắn vào lead đó.</span>}
                  {(ct.resultNote === "NGUON_UNKNOWN_SAU_TAO" || ct.resultNote === "NGUON_KHONG_GHI_SAU_TAO") && (
                    <span role="note" className="mt-1 block text-xs font-medium text-amber-700">
                      Nguồn của lead này cần xem lại: {ct.resultNote === "NGUON_UNKNOWN_SAU_TAO" ? "hệ thống xếp vào «Không xác định» (có thể kế thừa nguồn của lead cũ cùng số điện thoại)" : "hệ thống không ghi nguồn nào"}. Nhờ người phụ trách nguồn lead kiểm tra trên màn lead.
                    </span>
                  )}
                </dd>
              </>
            )}
            {ct.state === "REJECTED" && (
              <>
                <dt className={DT}>Lý do từ chối</dt>
                <dd className={DD}>{ct.rejectedReason}</dd>
              </>
            )}
            {ct.state === "SYSTEM_EXCEPTION" && (
              <>
                <dt className={DT}>Lỗi hệ thống</dt>
                <dd className={DD}>Chưa tạo được lead (mã {ct.resultNote ?? "không rõ"}). Bổ sung/kiểm tra rồi duyệt lại, hoặc báo bộ phận kỹ thuật.</dd>
              </>
            )}
          </dl>
        </section>

        {/* ② HỘI THOẠI */}
        <section aria-labelledby="kh-hoi-thoai" className={`${KHOI} lg:col-start-1 lg:row-start-2`}>
          <h2 id="kh-hoi-thoai" className="text-base font-semibold text-foreground">Hội thoại Facebook</h2>
          <dl className={`${DL} mt-3`}>
            <dt className={DT}>Trạng thái</dt>
            <dd className={DD}>{NHAN_OWNER[ct.hoiThoai.ownerState] ?? ct.hoiThoai.ownerState}</dd>
            {ct.hoiThoai.takeoverConfirmedAt && (
              <>
                <dt className={DT}>Tiếp quản</dt>
                <dd className={DD}>
                  {ct.hoiThoai.takeoverConfirmSource === "AGENT_REPORTED" ? "Agent đã xác nhận" : "Nhân viên đã báo nhận"} lúc {gioVn(ct.hoiThoai.takeoverConfirmedAt)}
                </dd>
              </>
            )}
          </dl>
          <div className="mt-4">
            {lienKet.loai === "LINK" ? (
              <>
                <a
                  href={lienKet.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 max-sm:w-full sm:h-10"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden /> Mở hội thoại Facebook
                </a>
                <p className="mt-2 break-words text-xs text-muted-foreground">
                  Mở trong tab mới. <strong>Đối chiếu tên khách</strong> trong Page Inbox với tên «{ct.fbName ?? "—"}» trước khi trả lời, vì mã hội thoại do Agent khai.
                </p>
              </>
            ) : (
              <p className="break-words rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
                {lienKet.lyDo === "CHUA_CO_MA_HOI_THOAI"
                  ? "Hồ sơ này chưa có mã hội thoại nên chưa dựng được liên kết. "
                  : "Chưa cấu hình liên kết mở Page Inbox. "}
                Tìm cuộc trò chuyện trong Page Inbox của Page <span className="font-mono text-xs">{ct.pageId}</span> theo tên khách «{ct.fbName ?? "—"}» và đối chiếu kỹ trước khi trả lời.
              </p>
            )}
          </div>
        </section>

        {/* ③ XỬ LÝ */}
        <section aria-labelledby="kh-xu-ly" className={`${KHOI} lg:col-start-2 lg:row-start-1`}>
          <h2 id="kh-xu-ly" className="mb-3 text-base font-semibold text-foreground">Xử lý hồ sơ</h2>
          {/* «Đang do X xử lý.» đã nằm trong ghi chú của khối xử lý (bang.ghiChu) — không in lần nữa ở đây. */}
          {ct.claimedById && !ct.claimedBoiToi && bang.ghiChu ? null : (
            <p className="mb-3 text-sm text-muted-foreground">
              {ct.claimedById ? (ct.claimedBoiToi ? "Bạn đang xử lý hồ sơ này." : `Đang do ${ct.claimedTen ?? "người khác"} xử lý.`) : "Chưa ai nhận hồ sơ này."}
            </p>
          )}
          <KhoiXuLy
            draftId={ct.id}
            version={ct.version}
            bang={bang}
            ban={ban}
            coSoCoThe={ct.coSoCoThe.map((c) => ({ id: c.id, ten: c.ten }))}
            coSoHienTai={ct.centerTen}
            ungVien={ungVien}
          />
        </section>

        {/* ④ DÒNG THỜI GIAN */}
        <section aria-labelledby="kh-nhat-ky" className={`${KHOI} lg:col-start-2 lg:row-start-2`}>
          <h2 id="kh-nhat-ky" className="text-base font-semibold text-foreground">Dòng thời gian</h2>
          {ct.dongThoiGian.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Chưa có thao tác nào của nhân viên trên hồ sơ này.</p>
          ) : (
            <ol className="mt-3 divide-y divide-border">
              {ct.dongThoiGian.map((s) => (
                <li key={s.id} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <span className="font-medium text-foreground">{NHAN_HANH_DONG[s.hanhDong] ?? s.hanhDong}</span>
                    <time dateTime={s.luc.toISOString()} className="text-xs text-muted-foreground">{gioVn(s.luc)}</time>
                  </p>
                  <p className="text-xs text-muted-foreground">{s.nguoi}</p>
                  {s.lyDo && <p className="mt-1 break-words text-sm text-foreground">Lý do: {s.lyDo}</p>}
                  <Chenh thayDoi={s.thayDoi} />
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

const NHAN_TRUONG: Record<string, string> = { fbName: "Tên Facebook", phone: "SĐT", campus: "Cơ sở", state: "Trạng thái", ownerState: "Hội thoại", claimedById: "Người giữ" };

/** Chỉ hiện các trường nghiệp vụ nhân viên sửa — giá trị tên/SĐT trong audit ĐÃ che từ lúc ghi. */
function Chenh({ thayDoi }: { thayDoi: Record<string, unknown> | null }) {
  if (!thayDoi) return null;
  const dong = (["fbName", "phone", "campus"] as const).filter((k) => typeof thayDoi[k] === "string");
  if (dong.length === 0) return null;
  return (
    <p className="mt-1 break-words text-xs text-muted-foreground">
      {dong.map((k) => `${NHAN_TRUONG[k]}: ${String(thayDoi[k])}`).join(" · ")}
    </p>
  );
}
