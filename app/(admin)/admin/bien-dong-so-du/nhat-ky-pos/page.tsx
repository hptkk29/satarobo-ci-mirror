// Nhật ký kiểm thẻ POS — mỗi lượt hệ thống hỏi kết quả một phiếu thu thẻ (GĐ2 POS, docs/pos-gd2-thiet-ke.md §7).
//
// Trang CHỈ ĐỌC: chỗ trả lời "lượt nào đã ghi nhận phiếu này", "máy có đang lỗi không", "sale có bấm dồn
// không". Không nút sửa — nhật ký trả lời được câu đó mà lại sửa được thì nó thôi là câu trả lời.
//
// ── CỔNG ───────────────────────────────────────────────────────────────────────────────
// `payments:import-pos` (U17) — Kế toán HO (v2) / Quản trị tối cao (`can()` nhánh SUPER_ADMIN): đúng nhóm
// nhận chuông `pos.quet-sach:` + `pos.loi-ket-noi:he-thong:` (cả hai trỏ về đây) và người quản máy (Q-D).
// Hỏi ĐẦU trang, TRƯỚC mọi câu tra (lưới `[POS2-NK-02]`). Không quyền mới ⇒ không cần seed-prod-roles.
//
// ── PHẠM VI ────────────────────────────────────────────────────────────────────────────
// Dữ liệu qua `docNhatKy(scopedDb(actor), …)` — `PosCheckLog` ∈ SCOPED_MODELS (prefix `payments:`) nên tự
// lọc theo cơ sở người xem. Ô "Cơ sở" chỉ là BỘ LỌC trong tầm nhìn đó. Import `@/lib/db` trần ở đây là
// ESLint error (luật 4) — không có đường vòng.
//
// Nằm dưới `/bien-dong-so-du` (đã khai `ADMIN_ROUTE_SEGMENTS`) ⇒ không sửa decideRoute/proxy. Lối vào: link
// literal trong khối `{canImportPos && (…)}` của Biến động số dư (`[POS2-NK-04]`) + hai loại chuông trên.
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Info } from "lucide-react";
import type { PosCheckLogKind, PosIntentStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { loadCenterPaymentOptions } from "@/lib/payments/center-options";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import {
  docLocNhatKy,
  NHAN_KET_QUA,
  NHAN_NGUON,
  NHAN_TRANG_THAI_PHIEU,
  thamSoNhatKy,
  TRAN_DONG_NHAT_KY,
} from "@/lib/payments/pos/nhat-ky-loc";
import { docNhatKy } from "@/lib/payments/pos/nhat-ky-doc";
import { PageHeader } from "@/components/admin/ui/page-header";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { EmptyState } from "@/components/admin/ui/states";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { cn } from "@/lib/utils";
import { BoLocNhatKy } from "./_components/bo-loc-nhat-ky";

export const metadata = { title: "Nhật ký kiểm thẻ POS | Admin" };
export const dynamic = "force-dynamic";

/** Màu theo NGHĨA của kết quả máy báo (DESIGN.md §1 — thang ngữ nghĩa, không mượn màu thương hiệu). */
const TONE_KET_QUA: Record<PosCheckLogKind, PillTone> = {
  PAID: "success",
  PAID_AMOUNT_MISMATCH: "warning",
  FAILED: "danger",
  NOT_FOUND: "muted",
  CANCELLED_AFTER_PAID: "warning",
  PROVIDER_ERROR: "danger",
  CACHE: "info",
};

const TONE_TRANG_THAI: Record<PosIntentStatus, PillTone> = {
  CHO_QUET: "muted",
  THAT_BAI: "danger",
  DA_THU: "success",
  LECH_TIEN: "warning",
  CAN_XU_LY: "warning",
  HET_HAN: "muted",
  HUY: "muted",
};

const soVN = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

/** "2026-10-06T17:40:12+07:00" → "06/10 17:40:12" (năm chỉ hiện khi khác năm của "đến ngày"). */
function lucNgan(iso: string, namDen: string): string {
  const nam = iso.slice(0, 4);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}${nam !== namDen ? `/${nam}` : ""} ${iso.slice(11, 19)}`;
}

export default async function NhatKyKiemThePosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("payments:import-pos"))) redirect("/dashboard");

  const now = new Date();
  const [sp, actor] = await Promise.all([searchParams, resolveActor(session.user.id)]);
  const sdb = scopedDb(actor);
  const [coSoChonDuoc, moiCoSo] = await Promise.all([
    loadCenterPaymentOptions(actor),
    // Tên của MỌI cơ sở (kể cả đã ngừng) — dòng nhật ký cũ có thể thuộc cơ sở đã đóng.
    sdb.center.findMany({ select: { id: true, name: true } }),
  ]);
  const loc = docLocNhatKy(sp, now, coSoChonDuoc.map((c) => c.id));
  const dl = await docNhatKy(scopedDb(actor), loc);
  const tenCoSo = new Map(moiCoSo.map((c) => [c.id, c.name]));

  // Dải tổng đếm theo bộ lọc ĐÃ BỎ vế kết quả (`dl.daiTong`) — số cạnh mỗi lọc nhanh = số dòng bấm ra.
  const soCache = dl.daiTong.theoKetQua.CACHE ?? 0;
  const tiLeCache = dl.daiTong.tong > 0 ? Math.round((soCache / dl.daiTong.tong) * 100) : 0;
  const locNhanh = (ketQua: PosCheckLogKind | null) => `?${thamSoNhatKy(loc, { ketQua })}`;
  const namDen = loc.den.slice(0, 4);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <Link
        href="/bien-dong-so-du?nguon=the"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:min-h-0"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden /> Biến động số dư
      </Link>

      <PageHeader
        className="mb-0 sm:mb-0"
        title="Nhật ký kiểm thẻ POS"
        actions={
          // GĐ4 — lượt kiểm báo lỗi `AGENT_*` (máy đồng bộ hết phiên / mất kết nối) thì việc tiếp theo nằm ở màn
          // Sức khoẻ. Cùng cổng `payments:import-pos` với trang này (luật 12). Lưới `[POS4-NAV-01]`.
          <Link href="/bien-dong-so-du/pos-agent" className="text-sm font-medium text-state-info-ink hover:underline">
            Sức khoẻ POS Agent
          </Link>
        }
        subtitle={
          <>
            Mỗi lần hệ thống hỏi kết quả một phiếu thu thẻ: sale bấm Kiểm tra, tự kiểm mỗi phút, sau import file,
            quét cuối ngày 23:30. Tra khi cần biết <b className="font-semibold text-foreground">lượt nào đã ghi nhận</b>{" "}
            một phiếu, hoặc máy thanh toán có đang lỗi không.
          </>
        }
      />

      <BoLocNhatKy
        key={thamSoNhatKy(loc)}
        giaTri={{ tu: loc.tu, den: loc.den, coSo: loc.coSo, nguon: loc.nguon, ketQua: loc.ketQua, ma: loc.ma }}
        homNay={ngayVN(now)}
        coSo={coSoChonDuoc.map((c) => ({ value: c.id, label: c.name }))}
        nguon={Object.entries(NHAN_NGUON).map(([value, label]) => ({ value, label }))}
        ketQua={Object.entries(NHAN_KET_QUA).map(([value, label]) => ({ value, label }))}
      />

      {loc.canhBao.length > 0 ? (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-foreground">{loc.canhBao.join(" ")}</p>
        </div>
      ) : null}

      {/* Dải tổng — mỗi con số là MỘT bộ lọc nhanh (link thật: bấm là lọc đúng thứ nó đếm). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-semibold tabular-nums text-foreground">{soVN(dl.tong)} lượt</span>
        <Link href={locNhanh("CACHE")} className="tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Bấm dồn <b className="font-semibold text-foreground">{soVN(soCache)}</b> ({tiLeCache}%)
        </Link>
        <Link href={locNhanh("PROVIDER_ERROR")} className="tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Lỗi kết nối{" "}
          <b className={cn("font-semibold", (dl.daiTong.theoKetQua.PROVIDER_ERROR ?? 0) > 0 ? "text-state-danger-ink" : "text-foreground")}>
            {soVN(dl.daiTong.theoKetQua.PROVIDER_ERROR ?? 0)}
          </b>
        </Link>
        <Link href={locNhanh("PAID")} className="tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Đã thu <b className="font-semibold text-foreground">{soVN(dl.daiTong.theoKetQua.PAID ?? 0)}</b>
        </Link>
        {loc.ketQua ? (
          <Link href={locNhanh(null)} className="text-state-info-ink underline-offset-2 hover:underline">
            Bỏ lọc kết quả
          </Link>
        ) : null}
      </div>

      {dl.dong.length === 0 ? (
        <EmptyState
          title="Không có lượt kiểm nào trong khoảng này."
          description={
            <>
              Nới khoảng ngày hoặc bỏ bớt bộ lọc. Phiếu thu thẻ chỉ có nhật ký khi có người bấm Kiểm tra, khi máy
              tự kiểm (mỗi phút với phiếu đang mở) hoặc sau một lượt import file Techcombank.
            </>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang tenDonVi="lượt" cuonNgang>
            <table className="w-full border-collapse">
              <thead className="border-b border-border bg-muted/40">
                {/* Thứ tự cột theo câu người tra hỏi (smoke 06/10): lúc nào · phiếu nào · ai/cái gì kích ·
                    máy nói gì · hệ thống kết luận gì · đơn nào — các cột chẩn đoán kỹ thuật ra sau. */}
                <tr>
                  <th className={adminTh}>Lúc</th>
                  <th className={adminTh}>Mã phiếu</th>
                  <th className={adminTh}>Nguồn</th>
                  <th className={adminTh}>Kết quả</th>
                  <th className={adminTh}>Trạng thái sau</th>
                  <th className={adminTh}>Đơn</th>
                  <th className={adminTh}>Người bấm</th>
                  <th className={adminTh}>Cơ sở</th>
                  <th className={adminTh}>Mã lỗi</th>
                  <th className={cn(adminTh, "text-right")}>Thời lượng</th>
                  <th className={adminTh}>Mã GD TCB</th>
                </tr>
              </thead>
              <tbody>
                {dl.dong.map((d) => (
                  <tr key={d.id} className={adminTr}>
                    <td className={cn(adminTd, "tabular-nums text-muted-foreground")} title={d.luc}>
                      {lucNgan(d.luc, namDen)}
                    </td>
                    <td className={cn(adminTd, "font-mono font-medium")}>{d.code5}</td>
                    <td className={adminTd}>{NHAN_NGUON[d.nguon]}</td>
                    <td className={adminTd}>
                      <StatusPill tone={TONE_KET_QUA[d.ketQua]}>{NHAN_KET_QUA[d.ketQua]}</StatusPill>
                    </td>
                    <td className={adminTd}>
                      {d.statusSau ? (
                        <StatusPill tone={TONE_TRANG_THAI[d.statusSau]}>{NHAN_TRANG_THAI_PHIEU[d.statusSau]}</StatusPill>
                      ) : (
                        <span className="text-muted-foreground" title="Lượt xử lý gặp lỗi — trạng thái phiếu không đổi">
                          —
                        </span>
                      )}
                    </td>
                    <td className={adminTd}>
                      <Link href={`/orders/${d.orderId}`} className="font-medium text-state-info-ink hover:underline">
                        {d.orderCode ?? "Mở đơn"}
                      </Link>
                    </td>
                    <td className={adminTd}>
                      {d.nguoiBam ?? <span className="text-muted-foreground">Hệ thống</span>}
                    </td>
                    <td className={adminTd}>
                      <span className="block max-w-[180px] truncate" title={tenCoSo.get(d.centerId) ?? d.centerId}>
                        {tenCoSo.get(d.centerId) ?? "Không rõ"}
                      </span>
                    </td>
                    <td className={cn(adminTd, "font-mono text-xs")}>
                      {d.errorCode ?? <span className="font-sans text-muted-foreground">—</span>}
                    </td>
                    <td className={cn(adminTd, "text-right tabular-nums")}>
                      {d.ketQua === "CACHE" ? <span className="text-muted-foreground">—</span> : `${soVN(d.durationMs)} ms`}
                    </td>
                    <td className={cn(adminTd, "font-mono text-xs")}>
                      {d.providerTxnId ?? <span className="font-sans text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
          {dl.chamTran ? (
            <p className="border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
              Chỉ hiện {soVN(TRAN_DONG_NHAT_KY)} lượt mới nhất trong {soVN(dl.tong)} lượt khớp bộ lọc — thu hẹp khoảng
              ngày hoặc lọc theo mã phiếu.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
