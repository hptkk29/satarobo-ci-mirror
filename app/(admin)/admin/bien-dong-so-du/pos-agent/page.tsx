// Sức khoẻ POS Agent + đối chiếu agent ↔ file (GĐ4 POS, docs/pos-gd4-thiet-ke.md §9.3).
//
// Người mở màn này thường vừa nhận chuông "hết phiên / mất kết nối POS Agent", hoặc sale báo "Tạm mất kết nối
// Techcombank". Ba câu họ cần trả lời, theo thứ tự trên màn: máy nào đang hỏng và PHẢI LÀM GÌ (thẻ máy) · nó hỏng
// từ bao giờ, đã sống lại chưa (sự kiện gần nhất) · POS Agent có thấy đủ giao dịch như file không (đối chiếu —
// dữ liệu để GĐ6 quyết thôi nhập file).
//
// ── CỔNG ───────────────────────────────────────────────────────────────────────────────
// XEM: `payments:import-pos` (Kế toán HO / Quản trị tối cao — người nhận bốn loại chuông `pos.agent-*`). Hỏi ĐẦU
// trang, TRƯỚC mọi câu tra (lưới `[POS4-Q-01]`). SỬA (tạo · tạo lại bí mật · bật-tắt): `settings:edit` VÀ máy
// chủ có `POS_AGENT_MASTER_KEY` — đúng hai cổng ba action hỏi lại; thiếu một trong hai thì KHÔNG vẽ nút, và màn
// nói vì sao (luật 12). Không quyền mới ⇒ không cần `seed-prod-roles.yml`.
//
// ── PHẠM VI ────────────────────────────────────────────────────────────────────────────
// Dữ liệu qua `scopedDb(actor)` — PosAgent · PosAgentEvent · PosCheckJob · PosTxnSource ∈ SCOPED_MODELS (prefix
// `payments:`). Import `@/lib/db` trần ở đây là ESLint error (luật 4).
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { loadCenterPaymentOptions } from "@/lib/payments/center-options";
import { congNgay, laNgayHopLe, ngayVN } from "@/lib/format/thoi-gian-vn";
import { masterKeyCoSan } from "@/lib/payments/pos/agent/khoa";
import { docDoiChieuNguon, docSucKhoeAgent, type TheAgent } from "@/lib/payments/pos/agent/suc-khoe-doc";
import type { AnhNgan, NhomDoiChieu } from "@/lib/payments/pos/agent/doi-chieu";
import {
  duLieuDocToi,
  khoang,
  luc,
  NHAN_COT_LECH,
  NHAN_LOAI_SU_KIEN,
  NHAN_NHOM_DOI_CHIEU,
  nhanMa,
  TONE_LOAI_SU_KIEN,
  TONE_NHOM_DOI_CHIEU,
  tomTatSuKien,
  truocDay,
  type TheTrangThai,
  type Tone,
} from "@/lib/payments/pos/agent/hien-thi";
import { dongPhien, tinhHinhChung, xepTheoMucKhan, type TinhHinh } from "@/lib/payments/pos/agent/tinh-hinh";
import { PageHeader } from "@/components/admin/ui/page-header";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { EmptyState } from "@/components/admin/ui/states";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { cn } from "@/lib/utils";
import { NutMayDongBo, TaoMayDongBo } from "./_components/may-dong-bo";

export const metadata = { title: "Sức khoẻ POS Agent | Admin" };
export const dynamic = "force-dynamic";

const soVN = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
const tien = (n: number) => `${soVN(n)}đ`;

/** Khối "việc cần làm" theo tone của thẻ — nền nhạt + chữ `-ink` (DESIGN.md §1: chữ trên nền nhạt dùng `-ink`). */
const KHOI_VIEC: Record<Tone, string> = {
  danger: "bg-state-danger-soft text-state-danger-ink",
  warning: "bg-state-warning-soft text-state-warning-ink",
  success: "bg-state-info-soft text-state-info-ink",
  info: "bg-state-info-soft text-state-info-ink",
  muted: "bg-muted text-foreground",
};

const THU_TU_NHOM: NhomDoiChieu[] = ["LECH", "AGENT_TU_CHOI", "CHI_FILE", "CHI_AGENT", "KHOP"];

function Muc({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/60 py-2 last:border-0 sm:block sm:border-0 sm:py-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{nhan}</dt>
      <dd className="min-w-0 text-right text-sm text-foreground sm:mt-0.5 sm:text-left">{children}</dd>
    </div>
  );
}

const Thieu = ({ chu = "—" }: { chu?: string }) => <span className="text-muted-foreground">{chu}</span>;

/**
 * Chốt hợp đồng 1.1 (RV5.4 #4): "Dữ liệu đã đọc tới" = `windowTo` của lô final (mốc agent khai đã quét tới) — KHÁC "Nhận
 * lô cuối" (giờ máy chủ nhận lô). Dừng sớm hơn lúc nhận > 60″ ⇒ nói thẳng là TRỄ: giao dịch sau mốc đó chưa được đọc.
 */
function ODuLieuDocToi({ a, now }: { a: TheAgent; now: Date }) {
  const d = duLieuDocToi(a.lastSyncedAt, a.duLieuDenLuc);
  if (d.loai === "CHUA_CO") return <Thieu chu={a.lastSyncedAt ? "Chưa có — chờ lượt đồng bộ kế" : "Chưa lần nào"} />;
  if (d.loai === "KIP") return <span className="tabular-nums">{luc(d.luc, now, true)}</span>;
  return (
    <span className="text-state-warning-ink">
      <span className="tabular-nums">{luc(d.luc, now, true)}</span> · trễ {khoang(d.treMs)} so với lúc nhận
    </span>
  );
}

/** Khối tóm tắt đầu khu máy — chỉ vẽ khi ≥ 2 máy (một máy thì chính thẻ của nó là tóm tắt, lặp lại là ồn). */
const KHOI_TINH_HINH: Record<TinhHinh["tone"], string> = {
  danger: "border-state-danger bg-state-danger-soft text-state-danger-ink",
  warning: "border-state-warning bg-state-warning-soft text-state-warning-ink",
  muted: "border-border bg-muted text-foreground",
  success: "border-border bg-card text-foreground",
};

function KhoiTinhHinh({ th }: { th: TinhHinh }) {
  return (
    <div role={th.tone === "danger" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3", KHOI_TINH_HINH[th.tone])}>
      <p className="text-sm">
        <b className="font-semibold">{th.tieuDe}</b>
        {th.phu ? <span className="opacity-80"> · {th.phu}</span> : null}
      </p>
      {th.canXuLy.length > 0 ? (
        <ul className="mt-2 divide-y divide-current/15">
          {th.canXuLy.map((x) => (
            <li key={x.id} className="flex flex-col gap-1 py-2 last:pb-0 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="flex shrink-0 items-center gap-2 sm:w-44">
                <b className="font-semibold text-foreground">{x.coSo}</b>
                <StatusPill tone={x.tone}>{x.nhan}</StatusPill>
              </span>
              <span className="min-w-0 flex-1 text-sm">{x.lamGi}</span>
              <a
                href={`#the-${x.id}`}
                className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium underline underline-offset-2 hover:no-underline sm:min-h-0"
              >
                Tới thẻ {x.coSo}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TheMay({
  a,
  tt,
  toneViec,
  now,
  suaDuoc,
}: {
  a: TheAgent;
  tt: TheTrangThai;
  /** Tone của khối "Việc cần làm" — "đang làm việc" mà phiên hết hạn trước 21:00 là việc VÀNG (`xepTheoMucKhan`). */
  toneViec: Tone;
  now: Date;
  suaDuoc: boolean;
}) {
  const tbPhien = a.songPhien.tbMs;
  const phien = dongPhien(a, now);
  return (
    <article
      id={`the-${a.id}`}
      aria-labelledby={`may-${a.id}`}
      className={cn(
        "flex scroll-mt-4 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5",
        tt.tone === "danger" ? "border-state-danger" : "border-border",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 id={`may-${a.id}`} className="text-base font-semibold text-foreground">
            {a.coSo}
            {a.tenCoSo && a.tenCoSo !== a.coSo ? <span className="font-normal text-muted-foreground"> · {a.tenCoSo}</span> : null}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Merchant <span className="font-mono text-foreground">{a.merchantCode}</span>
          </p>
        </div>
        <StatusPill tone={tt.tone}>{tt.nhan}</StatusPill>
      </header>

      <p className="text-sm text-foreground">{tt.cau}</p>

      {tt.lamGi ? (
        <div className={cn("flex gap-2 rounded-lg px-3 py-2.5 text-sm", KHOI_VIEC[toneViec])}>
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <b className="font-semibold">Việc cần làm:</b> {tt.lamGi}
          </p>
        </div>
      ) : null}

      <dl className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-3">
        <Muc nhan="Liên lạc cuối">
          {a.lastHeartbeatAt ? (
            <>
              <span className="tabular-nums">{luc(a.lastHeartbeatAt, now, true)}</span>{" "}
              <span className="text-muted-foreground">({truocDay(now.getTime() - a.lastHeartbeatAt.getTime())})</span>
            </>
          ) : (
            <Thieu chu="Chưa lần nào" />
          )}
        </Muc>
        <Muc nhan="Nhận lô cuối (giờ máy chủ)">
          {a.lastSyncedAt ? <span className="tabular-nums">{luc(a.lastSyncedAt, now, true)}</span> : <Thieu chu="Chưa lần nào" />}
        </Muc>
        <Muc nhan="Dữ liệu đã đọc tới">
          <ODuLieuDocToi a={a} now={now} />
        </Muc>
        <Muc nhan="Phiên portal">
          <span className={cn(phien.tone === "danger" && "font-semibold text-state-danger-ink")}>{phien.chu}</span>
          {phien.phu ? (
            <span className={cn("tabular-nums", phien.tone === "warning" ? "text-state-warning-ink" : "text-muted-foreground")}>
              {" "}
              · {phien.phu}
            </span>
          ) : null}
        </Muc>
        <Muc nhan="Phiên sống trung bình (30 ngày)">
          {tbPhien !== null ? (
            <>
              {khoang(tbPhien)} <span className="text-muted-foreground">· {soVN(a.songPhien.soPhien)} phiên</span>
            </>
          ) : (
            <Thieu chu="Chưa đủ dữ liệu" />
          )}
        </Muc>
        <Muc nhan="Yêu cầu kiểm đang chờ">
          <span className={cn("tabular-nums", a.jobCho > 0 && "font-semibold")}>{soVN(a.jobCho)}</span>
          {/* Máy đang hỏng mà còn yêu cầu chờ ⇒ có sale đang đứng quầy chờ kết quả — nói ra, đừng để một con số trơ. */}
          {a.jobCho > 0 && tt.tone === "danger" ? <span className="text-state-danger-ink"> · có sale vừa bấm kiểm, chưa có kết quả</span> : null}
        </Muc>
        <Muc nhan="Extension">
          {a.extensionVersion ? <span className="font-mono text-xs">{a.extensionVersion}</span> : <Thieu />}
          {a.profileName ? <span className="text-muted-foreground"> · hồ sơ {a.profileName}</span> : null}
        </Muc>
        <Muc nhan="Lỗi gần nhất">
          {a.loiGanNhat ? (
            <>
              {nhanMa(a.loiGanNhat)}
              {a.loiGanNhatLuc ? <span className="tabular-nums text-muted-foreground"> · {luc(a.loiGanNhatLuc, now)}</span> : null}
            </>
          ) : (
            <Thieu chu="Không có" />
          )}
        </Muc>
        <Muc nhan="Bí mật">
          Phiên bản {a.secretVersion}
          {a.secretDoiLuc ? <span className="tabular-nums text-muted-foreground"> · đổi {luc(a.secretDoiLuc, now)}</span> : null}
        </Muc>
      </dl>

      {!a.mayKhaiDu ? (
        <div className="flex gap-2 rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {a.coSo} chưa có máy POS đang bật mang merchant <span className="font-mono">{a.merchantCode}</span>{" "}
            và mã quầy —
            giao dịch POS Agent gửi về sẽ vào “Thiết bị chưa gán cơ sở” và không tự khớp phiếu.{" "}
            <Link href="/cau-hinh-van-hanh?tab=may-pos" className="whitespace-nowrap font-semibold underline underline-offset-2 hover:no-underline">
              Khai máy POS
            </Link>
          </p>
        </div>
      ) : null}

      {suaDuoc ? (
        <footer className="border-t border-border pt-3">
          <NutMayDongBo
            key={a.id}
            agentId={a.id}
            coSo={a.coSo}
            merchantCode={a.merchantCode}
            secretVersion={a.secretVersion}
            active={a.active}
          />
        </footer>
      ) : null}
    </article>
  );
}

/** Một nguồn nói gì về một giao dịch — số tiền + trạng thái + loại; bị từ chối thì nói mã từ chối. */
function OAnh({ anh }: { anh: AnhNgan | null }) {
  if (!anh) return <Thieu chu="Không thấy" />;
  if (anh.tuChoi) return <span className="text-state-warning-ink">Từ chối: {nhanMa(anh.tuChoi)}</span>;
  return (
    <span>
      <span className="tabular-nums">{anh.soTien !== null ? tien(anh.soTien) : "—"}</span>
      <span className="text-muted-foreground">
        {" "}
        · {anh.trangThai ?? "—"}
        {anh.loaiGiaoDich ? ` · ${anh.loaiGiaoDich}` : ""}
      </span>
    </span>
  );
}

export default async function MayDongBoPosPage({ searchParams }: { searchParams: Promise<{ ngay?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("payments:import-pos"))) redirect("/dashboard");

  const now = new Date();
  const [sp, actor, coQuyenSua] = await Promise.all([
    searchParams,
    resolveActor(session.user.id),
    checkPermission("settings:edit"),
  ]);
  const sdb = scopedDb(actor);
  const homNay = ngayVN(now);
  const ngayXin = typeof sp.ngay === "string" ? sp.ngay : "";
  const ngay = laNgayHopLe(ngayXin) && ngayXin <= homNay ? ngayXin : homNay;
  const coKhoa = masterKeyCoSan();
  const suaDuoc = coQuyenSua && coKhoa;

  const [sk, dc, coSoChon] = await Promise.all([
    docSucKhoeAgent(sdb, now),
    docDoiChieuNguon(sdb, ngay),
    suaDuoc ? loadCenterPaymentOptions(actor) : Promise.resolve([]),
  ]);
  const tongNguon = THU_TU_NHOM.reduce((s, n) => s + dc.tong[n], 0);
  // Máy hỏng lên đầu (đợt /impeccable 07/10) — người mở màn cần "cơ sở NÀO đang chết" trước mọi thứ khác.
  const xep = xepTheoMucKhan(sk.agents, now);
  const tinhHinh = sk.agents.length >= 2 ? tinhHinhChung(xep) : null;

  return (
    <div className="space-y-8 p-4 sm:p-6">
      <div className="space-y-4">
        <Link
          href="/bien-dong-so-du?nguon=the"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:min-h-0"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden /> Biến động số dư
        </Link>

        <PageHeader
          className="mb-0 sm:mb-0"
          title="Sức khoẻ POS Agent"
          subtitle={
            <>
              Extension Chrome trên máy POS Agent đọc giao dịch thẻ từ portal Techcombank và gửi về mỗi 1–2 phút, để
              phiếu thu thẻ tự chuyển <b className="font-semibold text-foreground">Đã thu</b>{" "}
              mà không cần nhập file.
              Máy hết phiên hoặc mất kết nối thì sale thấy “Tạm mất kết nối Techcombank” — việc cần làm ghi
              ngay trên thẻ của máy.
            </>
          }
          actions={
            <Link
              href="/bien-dong-so-du/nhat-ky-pos"
              className="inline-flex min-h-11 items-center text-sm font-medium text-state-info-ink hover:underline sm:min-h-0"
            >
              Nhật ký kiểm thẻ POS
            </Link>
          }
        />

        {!coKhoa ? (
          <div role="alert" className="flex gap-2 rounded-lg border border-state-danger bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <b className="font-semibold">Máy chủ chưa đặt POS_AGENT_MASTER_KEY.</b>{" "}
              POS Agent không gọi về được (mọi
              lượt bị từ chối) và chưa tạo / đổi được bí mật. Phiếu thu thẻ vẫn đọc dữ liệu từ file nhập tay. Báo bộ phận
              kỹ thuật.
            </p>
          </div>
        ) : null}
      </div>

      {/* ── Máy POS Agent ───────────────────────────────────────────────────── */}
      <section aria-labelledby="khu-may" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="khu-may" className="text-lg font-semibold text-foreground">
            Máy POS Agent{sk.agents.length > 0 ? <span className="font-normal text-muted-foreground"> ({sk.agents.length})</span> : null}
          </h2>
          {!coQuyenSua ? (
            <p className="text-xs text-muted-foreground">Tạo máy, đổi bí mật và bật/tắt là việc của Quản trị tối cao.</p>
          ) : null}
        </div>

        {sk.agents.length === 0 ? (
          <EmptyState
            title="Chưa có máy POS Agent nào."
            description={
              <>
                Phiếu thu thẻ đang đọc dữ liệu từ file Techcombank nhập tay.{" "}
                {suaDuoc
                  ? "Tạo một POS Agent cho mỗi merchant portal ở khối ngay dưới, rồi dán cấu hình vào extension."
                  : "Quản trị tối cao tạo POS Agent cho từng merchant portal ở màn này."}
              </>
            }
          />
        ) : (
          <>
            {tinhHinh ? <KhoiTinhHinh th={tinhHinh} /> : null}
            <div className="grid gap-4 xl:grid-cols-2">
              {xep.map((x) => (
                <TheMay key={x.a.id} a={x.a} tt={x.tt} toneViec={x.tone} now={now} suaDuoc={suaDuoc} />
              ))}
            </div>
          </>
        )}

        {suaDuoc ? (
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <h3 className="mb-3 text-base font-semibold text-foreground">Thêm POS Agent</h3>
            <TaoMayDongBo key="tao-may-dong-bo" coSo={coSoChon.map((c) => ({ value: c.id, label: c.name }))} />
          </div>
        ) : null}
      </section>

      {/* ── Sự kiện gần nhất ──────────────────────────────────────────────── */}
      <section aria-labelledby="khu-su-kien" className="space-y-3">
        <div>
          <h2 id="khu-su-kien" className="text-lg font-semibold text-foreground">
            Sự kiện gần nhất
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            20 sự kiện mới nhất: hết phiên, sống lại, kết nối lại, lượt đồng bộ có thay đổi, lỗi (gộp theo ngày).
          </p>
        </div>
        {sk.suKien.length === 0 ? (
          <EmptyState
            title="Chưa có sự kiện nào."
            description="POS Agent chưa gọi về lần nào — sự kiện đầu tiên xuất hiện khi extension gửi tín hiệu đầu tiên."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <PhanTrangBang tenDonVi="sự kiện" cuonNgang>
              <table className="w-full border-collapse">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className={adminTh}>Lúc</th>
                    <th className={adminTh}>Cơ sở</th>
                    <th className={adminTh}>Loại</th>
                    <th className={adminTh}>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {sk.suKien.map((e) => (
                    <tr key={e.id} className={adminTr}>
                      <td className={cn(adminTd, "tabular-nums text-muted-foreground")}>{luc(e.createdAt, now, true)}</td>
                      <td className={adminTd}>{e.coSo}</td>
                      <td className={adminTd}>
                        <StatusPill tone={TONE_LOAI_SU_KIEN[e.type]}>{NHAN_LOAI_SU_KIEN[e.type]}</StatusPill>
                      </td>
                      <td className={cn(adminTd, "text-muted-foreground")}>{tomTatSuKien(e.type, e.ma, e.detail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>
        )}
      </section>

      {/* ── Đối chiếu POS Agent ↔ file ──────────────────────────────────── */}
      <section aria-labelledby="khu-doi-chieu" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 max-w-3xl">
            <h2 id="khu-doi-chieu" className="text-lg font-semibold text-foreground">
              Đối chiếu POS Agent ↔ file
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Cùng một ngày, POS Agent và file Techcombank nói gì về từng giao dịch — so số tiền, trạng thái, loại,
              giờ. Bảng chỉ liệt kê dòng không khớp.
            </p>
          </div>
          <form method="get" className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Ngày giao dịch
              <input
                type="date"
                name="ngay"
                defaultValue={ngay}
                max={homNay}
                className="h-11 rounded-lg border border-input bg-card px-2.5 text-sm text-foreground sm:h-9"
              />
            </label>
            <button
              type="submit"
              className="h-11 rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:h-9"
            >
              Xem
            </button>
          </form>
        </div>

        {/* Lưới cố định thay hàng pill tự xuống dòng: ở 375px hàng cũ gãy thành 3 hàng lệch nhau, số nằm lạc khỏi nhãn. */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border text-sm sm:grid-cols-5">
          {THU_TU_NHOM.map((n) => (
            <div key={n} className="flex min-w-0 flex-col gap-1.5 bg-card px-3 py-2.5 last:col-span-2 sm:last:col-span-1">
              <dt className="min-w-0">
                <StatusPill tone={dc.tong[n] > 0 ? TONE_NHOM_DOI_CHIEU[n] : "muted"}>{NHAN_NHOM_DOI_CHIEU[n]}</StatusPill>
              </dt>
              <dd className={cn("text-lg font-semibold tabular-nums", dc.tong[n] > 0 ? "text-foreground" : "text-muted-foreground")}>
                {soVN(dc.tong[n])}
              </dd>
            </div>
          ))}
        </dl>

        {dc.chamTran ? (
          <p role="status" className="rounded-lg bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
            Ngày này có quá nhiều dòng nguồn — chỉ đối chiếu 5.000 dòng đầu, số đếm ở trên có thể thiếu.
          </p>
        ) : null}

        <p className="flex gap-2 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            “Chỉ POS Agent thấy” thường là file của ngày đó chưa nhập
            {dc.fileNhapCuoiLuc ? <> — lô file nhập xong gần nhất lúc {luc(dc.fileNhapCuoiLuc, now)}</> : <> — chưa có lô file nào nhập xong</>}
            . “Chỉ file thấy” là giao dịch POS Agent bỏ sót. Cột “POS Agent thấy sau” quá 10 phút là
            dòng được quét bù sau khi máy sống lại.
          </span>
        </p>

        {tongNguon === 0 ? (
          <EmptyState
            title={`Ngày ${ngay.slice(8, 10)}/${ngay.slice(5, 7)} chưa có giao dịch nào từ POS Agent hay file.`}
            description={
              ngay === homNay ? (
                <>
                  Chọn ngày trước —{" "}
                  <Link
                    href={`/bien-dong-so-du/pos-agent?ngay=${congNgay(ngay, -1)}`}
                    className="font-medium text-state-info-ink hover:underline"
                  >
                    xem hôm qua
                  </Link>
                  .
                </>
              ) : (
                "Chọn ngày khác ở ô Ngày giao dịch."
              )
            }
          />
        ) : dc.dong.length === 0 ? (
          <EmptyState
            title="Mọi giao dịch đều khớp."
            description="Hai nguồn cùng thấy đủ giao dịch của ngày này, cùng số tiền, trạng thái, loại và giờ."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <PhanTrangBang tenDonVi="giao dịch" cuonNgang>
              <table className="w-full border-collapse">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className={adminTh}>Mã giao dịch</th>
                    <th className={adminTh}>Giờ</th>
                    <th className={adminTh}>Nhóm</th>
                    <th className={adminTh}>POS Agent</th>
                    <th className={adminTh}>File</th>
                    <th className={adminTh}>Lệch ở</th>
                    <th className={cn(adminTh, "text-right")}>POS Agent thấy sau</th>
                  </tr>
                </thead>
                <tbody>
                  {dc.dong.map((d) => (
                    <tr key={d.maGiaoDich} className={adminTr}>
                      <td className={cn(adminTd, "font-mono text-xs")}>{d.maGiaoDich}</td>
                      <td className={cn(adminTd, "tabular-nums text-muted-foreground")}>
                        {d.thoiGian ? luc(d.thoiGian, now, true) : "—"}
                      </td>
                      <td className={adminTd}>
                        <StatusPill tone={TONE_NHOM_DOI_CHIEU[d.nhom]}>{NHAN_NHOM_DOI_CHIEU[d.nhom]}</StatusPill>
                      </td>
                      <td className={adminTd}>
                        <OAnh anh={d.agent} />
                      </td>
                      <td className={adminTd}>
                        <OAnh anh={d.file} />
                      </td>
                      <td className={adminTd}>
                        {d.lech.length > 0 ? d.lech.map((c) => NHAN_COT_LECH[c]).join(", ") : <Thieu />}
                      </td>
                      <td className={cn(adminTd, "text-right tabular-nums")}>
                        {d.treMs !== null ? (
                          <span className={d.duocBu ? "font-semibold text-state-warning-ink" : "text-muted-foreground"}>
                            {khoang(Math.max(0, d.treMs))}
                            {d.duocBu ? " · quét bù" : ""}
                          </span>
                        ) : (
                          <Thieu />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>
        )}
      </section>
    </div>
  );
}
