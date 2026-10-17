import { redirect } from "next/navigation";
import { ShieldAlert, Wallet } from "lucide-react";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { BACKFILL_PAYMENT_MARKER } from "@/lib/finance/payment-markers";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { canXuLy, conThieu, phanLoaiHocPhi } from "@/lib/finance/thieu-hoc-phi";
import { chonDonDeGhiThem } from "@/lib/finance/ghi-them-hoc-phi";

import { ThieuHocPhiClient } from "./_components/thieu-hoc-phi-client";
import type { DongThieu } from "./_components/types";

export const metadata = { title: "Thiếu học phí · Sata Robo" };

/**
 * MÀN "HỌC VIÊN CHƯA PHÁT SINH ĐƠN HÀNG HOẶC THIẾU HỌC PHÍ".
 *
 * VÌ SAO CÓ: `lib/crm/bulk-convert.ts` có nhánh `allowNoPayment` — chốt lead hàng loạt
 * mà không nhập tiền thì hệ thống CỐ Ý không bịa khoản thu (chỉ ghi nhật ký
 * `BACKFILL_IMPORT`). Kết quả: các em đó có `Enrollment` nhưng KHÔNG có `Order`/`Payment`
 * ⇒ học phí của các em không nằm trong sổ nào, không ai nợ ai, và không màn nào hiện ra.
 * Đây là màn duy nhất nhìn thấy nhóm đó.
 *
 * Gom theo LEAD (không theo học viên): một lead có thể nhiều con, và đơn hàng gắn `leadId`
 * — `createBackfillOrderPaymentInTx` cũng idempotent theo lead. Gom theo học viên sẽ vẽ
 * ra nhiều dòng cho cùng một khoản phải thu.
 */
export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Bốn trạng thái của DESIGN.md §5 — "không có quyền" là hạng nhất ở hệ này.
  const [xemDuoc, ghiDuoc] = await Promise.all([
    checkPermission("payments:view"),
    checkPermission("payments:record"),
  ]);
  if (!xemDuoc) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-xl border border-border bg-muted/30 p-6 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-state-warning-ink" aria-hidden />
          <h1 className="mt-3 text-base font-semibold text-foreground">
            Bạn không có quyền xem màn này
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Màn này cần quyền <b className="font-semibold text-foreground">payments:view</b>.
            Liên hệ Quản trị tối cao hoặc Quản lý cơ sở của bạn để được cấp.
          </p>
        </div>
      </div>
    );
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // Lead ĐÃ CHỐT (có ghi danh) — scopedDb lọc theo tầm nhìn cơ sở.
  const leads = await sdb.lead.findMany({
    where: { deletedAt: null, status: "DA_DANG_KY" },
    select: {
      id: true,
      parentName: true,
      phone: true,
      createdAt: true,
      center: { select: { name: true } },
      // KHÔNG có quan hệ Lead↔Student trực tiếp trong schema; tên con lấy từ chính
      // Lead (`childName` / `children`) — và đó lại là nguồn ĐÚNG cho nhóm chưa có đơn,
      // vì các em đó chưa có dòng Order nào để tra tên qua.
      childName: true,
      children: { select: { fullName: true }, take: 5 },
      orders: {
        where: { deletedAt: null },
        select: {
          id: true,
          code: true,
          createdAt: true,
          totalAmount: true,
          payments: {
            where: KHOAN_DA_GHI_NHAN,
            select: { amount: true, note: true },
          },
          items: { select: { itemName: true }, take: 1 },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const rows: DongThieu[] = [];
  for (const l of leads) {
    const tongPhaiThu = l.orders.reduce((s, o) => s + o.totalAmount, 0);
    const tongDaThu = l.orders.reduce(
      (s, o) => s + o.payments.reduce((x, p) => x + p.amount, 0),
      0,
    );
    const input = { soDon: l.orders.length, tongPhaiThu, tongDaThu };
    if (!canXuLy(input)) continue;

    rows.push({
      leadId: l.id,
      parentName: l.parentName,
      phone: l.phone,
      centerName: l.center?.name ?? "—",
      studentNames:
        l.children.length > 0
          ? l.children.map((c) => c.fullName)
          : l.childName
            ? [l.childName]
            : [],
      trangThai: phanLoaiHocPhi(input),
      soDon: l.orders.length,
      tongPhaiThu,
      tongDaThu,
      conThieu: conThieu(input),
      // Tên dòng đơn gợi ý: lấy từ đơn cũ nếu có, để người nhập không phải gõ lại.
      goiYTenKhoa: l.orders[0]?.items[0]?.itemName ?? null,
      // Chế độ ghi cho dòng này. Bản trước chỉ mang cờ `daCoKhoanNhapLieu` rồi KHOÁ nút —
      // nên một em thiếu 7.000.000đ không có đường nào ghi tiếp. Luật chọn đơn nằm ở
      // `lib/finance/ghi-them-hoc-phi.ts` (hàm thuần, có test): ghi tiền vào sai đơn là
      // công nợ hai đơn đều sai mà tổng vẫn đúng, không màn nào lộ ra.
      ghiThem: (() => {
        const kq = chonDonDeGhiThem(
          l.orders.map((o) => ({
            id: o.id,
            totalAmount: o.totalAmount,
            daThu: o.payments.reduce((x, p) => x + p.amount, 0),
            coKhoanNhapLieu: o.payments.some((p) =>
              (p.note ?? "").includes(BACKFILL_PAYMENT_MARKER),
            ),
            taoLuc: o.createdAt.getTime(),
          })),
        );
        if (kq.cheDo !== "GHI_THEM") return null;
        const don = l.orders.find((o) => o.id === kq.orderId);
        return { orderId: kq.orderId, toiDa: kq.toiDa, maDon: don?.code ?? "" };
      })(),
    });
  }

  const tongConThieu = rows.reduce((s, r) => s + r.conThieu, 0);
  const soChuaCoDon = rows.filter((r) => r.trangThai === "CHUA_CO_DON").length;

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Wallet className="h-5 w-5 shrink-0 text-accent-ink" aria-hidden />
            Thiếu học phí
          </h1>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
            Học viên đã chốt nhưng <b className="font-semibold text-foreground">chưa phát sinh
            đơn hàng</b>, hoặc có đơn mà{" "}
            <b className="font-semibold text-foreground">chưa thu đủ</b>. Nhóm &quot;chưa có
            đơn&quot; đến từ các lượt chốt hàng loạt không nhập số tiền — hệ thống cố ý không
            bịa khoản thu.
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-3">
          <div className="min-w-0 rounded-xl border border-border bg-background px-4 py-3">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Chưa có đơn
            </p>
            <p className="mt-1 truncate text-xl font-bold tabular-nums text-state-danger-ink">
              {soChuaCoDon}
            </p>
          </div>
          <div className="min-w-0 rounded-xl border border-border bg-background px-4 py-3">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tổng còn thiếu
            </p>
            <p className="mt-1 truncate text-xl font-bold tabular-nums text-state-warning-ink">
              {tongConThieu.toLocaleString("vi-VN")}đ
            </p>
          </div>
        </div>
      </header>

      <ThieuHocPhiClient rows={rows} ghiDuoc={ghiDuoc} />
    </div>
  );
}
