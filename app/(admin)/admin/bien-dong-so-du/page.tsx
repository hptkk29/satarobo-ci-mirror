import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { coNoiNaoBatThuLinhHoat } from "@/lib/finance/feature";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { extractOrderCode } from "@/lib/payments/sepay";
import { SepayLogClient } from "./_components/sepay-log-client";
import { BankTxnClient, type BankTxnItem } from "./_components/bank-txn-client";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { TIEN_THUA_CHUA_XU_LY } from "@/lib/finance/tien-thua";

export const metadata = { title: "Biến động số dư | Admin" };
export const dynamic = "force-dynamic";

// Trang ĐỐI SOÁT tiền về. Khách quét QR → cổng (payOS/SePay) đẩy biến động số dư về
// webhook → hệ thống ghi `BankTransaction` rồi RÓT vào phiếu thu (`PaymentRequest`)
// qua `PaymentAllocation`. Trang này để NHÌN xem tiền đã đi đúng chỗ chưa — không
// phải nơi xác nhận thủ công thay máy.
//
// 03/08 — nguồn chính đổi từ `IntegrationLog(SEPAY)` sang `BankTransaction`:
//   • IntegrationLog trả lời "webhook chạy xong hay hỏng" — nhật ký kỹ thuật.
//   • BankTransaction trả lời "tiền này về lúc nào, vào phiếu nào, còn dư bao nhiêu"
//     — đó mới là câu kế toán hỏi, và là sổ mọi phân bổ neo vào.
// Log cũ GIỮ NGUYÊN ở khu riêng bên dưới: đơn SePay trước ngày đổi vẫn phải tra được.
//
// Mỗi dòng BankTransaction:
//   MATCHED   — đã rót vào ≥1 phiếu thu.
//   UNMATCHED — CHƯA rót được (sai nội dung CK, không tra ra đơn) → hàng chờ xử lý
//               tay DUY NHẤT được phép tồn tại.
//   IGNORED   — cố ý bỏ (giao dịch không phải học phí).

type SepayPayload = {
  id?: string | number;
  gateway?: string;
  transferAmount?: number | string;
  transferType?: string;
  content?: string;
  description?: string;
  referenceCode?: string;
  accountNumber?: string;
  transactionDate?: string;
};

function readPayload(raw: unknown): SepayPayload {
  return raw && typeof raw === "object" ? (raw as SepayPayload) : {};
}

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

export default async function SepayLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Cùng quyền với sổ thu chi — người đối soát tiền mới cần trang này.
  // 03/08 — thêm `payments:view` (chỉ xem) cho Quản lý cơ sở: màn này vốn CHỈ ĐỌC
  // (đối soát tiền về từ SePay), không có thao tác ghi nào.
  //
  // PHIÊN B — thêm `payments:record` (SALE). Chủ dự án chốt 17/09: sale phải GẮN được tiền
  // vào đơn, mà sale chỉ có `payments:record`. Ba quyền, ba mức, KHÔNG gộp:
  //   · `payments:view`   → nhìn;
  //   · `payments:record` → nhìn + GẮN tiền vào đơn (trong phạm vi cơ sở của mình);
  //   · `payments:manage` → thêm BỎ QUA và GỠ GẮN (chỉ kế toán).
  //
  // ⚠️ Danh sách UNMATCHED KHÔNG lọc theo cơ sở: giao dịch chưa gắn thì chưa biết của cơ sở
  // nào, lọc nó đi là giấu mất tiền của chính người đang tìm. Cách ly cơ sở áp ở ĐƠN —
  // `congGanVaoDon` trong `_gan-theo-con.ts`.
  const [canManagePayments, canRecordPayments, canViewPayments] = await Promise.all([
    checkPermission("payments:manage"),
    checkPermission("payments:record"),
    checkPermission("payments:view"),
  ]);
  if (!canManagePayments && !canRecordPayments && !canViewPayments) redirect("/dashboard");

  const { status } = await searchParams;
  const filter = status === "unmatched" || status === "matched" ? status : "all";

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // ⚠️ AFFORDANCE THEO CÔNG TẮC — chủ dự án chốt 17/09: *"cờ tắt → màn và quyền y như trước
  // merge (chỉ payments:manage)"*.
  //
  // Nút "Gắn vào đơn" là nút của SALE, và sale chỉ được vẽ nút khi có cơ sở nào trong tầm nhìn
  // của họ đã bật cờ. Không nơi nào bật ⇒ `canGan` rơi về đúng `canManage`, tức prod sau merge
  // giống hệt prod trước merge.
  //
  // Đây CHỈ là affordance. Cổng tiền hỏi cờ của CƠ SỞ GIỮ ĐƠN (`congGanVaoDon` trong
  // `_gan-theo-con.ts`) — ở đây chưa biết tiền của đơn nào nên không thể hỏi câu hẹp hơn.
  const coNoiBatCo = await coNoiNaoBatThuLinhHoat(actor.visibleOrgUnitIds);
  const canGan = canManagePayments || (canRecordPayments && coNoiBatCo);

  // ── Nguồn chính: giao dịch tiền về (mọi provider) ────────────────────────────
  // BankTransaction ∈ SCOPED_MODELS + NULL_IS_GLOBAL_MODELS → centerId null (tiền vừa
  // về, chưa biết của cơ sở nào) vẫn hiện cho MỌI người đối soát. Đó chính là nhóm
  // cần xử lý — ẩn đi là làm mất đúng thứ họ vào đây để tìm.
  const txns = await sdb.bankTransaction.findMany({
    where: {
      ...(filter === "unmatched" ? { status: "UNMATCHED" as const } : {}),
      ...(filter === "matched" ? { status: "MATCHED" as const } : {}),
    },
    orderBy: { transferredAt: "desc" },
    take: 200,
    select: {
      id: true,
      provider: true,
      providerTxnId: true,
      amount: true,
      transferredAt: true,
      accountNumber: true,
      referenceCode: true,
      content: true,
      status: true,
      unmatchedNote: true,
      // Nested include KHÔNG được auto-scope — an toàn ở đây vì giao dịch top-level
      // đã trong scope, và phân bổ của nó luôn thuộc cùng đơn/cơ sở.
      allocations: {
        select: {
          amount: true,
          paymentRequestId: true,
          paymentRequest: {
            select: {
              installmentNo: true,
              amountDue: true,
              status: true,
              order: { select: { id: true, code: true, customerName: true } },
            },
          },
        },
      },
    },
  });

  const unmatchedCount = await sdb.bankTransaction.count({ where: { status: "UNMATCHED" } });

  const txnItems: BankTxnItem[] = txns.map((t) => ({
    id: t.id,
    at: t.transferredAt.toISOString(),
    provider: t.provider,
    providerTxnId: t.providerTxnId,
    amount: t.amount,
    content: t.content,
    referenceCode: t.referenceCode,
    accountNumber: t.accountNumber,
    status: t.status,
    unmatchedNote: t.unmatchedNote,
    allocations: t.allocations.map((a) => ({
      paymentRequestId: a.paymentRequestId,
      amount: a.amount,
      installmentNo: a.paymentRequest.installmentNo,
      amountDue: a.paymentRequest.amountDue,
      requestStatus: a.paymentRequest.status,
      orderId: a.paymentRequest.order?.id ?? null,
      orderCode: a.paymentRequest.order?.code ?? null,
      customerName: a.paymentRequest.order?.customerName ?? null,
    })),
  }));

  // ── Tiền thừa chưa xử lý ─────────────────────────────────────────────────────
  // Hệ thống KHÔNG tự hoàn, KHÔNG tự trừ sang đơn khác — kế toán quyết. Chỉ hiển thị.
  const credits = await sdb.creditBalance.findMany({
    // Loại cả dòng đã đánh dấu "do gỡ gắn" — xem `lib/finance/tien-thua.ts`.
    where: TIEN_THUA_CHUA_XU_LY,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, amount: true, note: true, createdAt: true, orderId: true, studentId: true },
  });
  const creditTotal = credits.reduce((s, c) => s + c.amount, 0);

  // ── Log webhook SePay cũ (giữ để tra lịch sử) ────────────────────────────────
  const legacyRows = await sdb.integrationLog.findMany({
    where: { provider: "SEPAY" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const legacyCodes = [
    ...new Set(
      legacyRows
        .map((r) => {
          const p = readPayload(r.requestPayload);
          return extractOrderCode(p.content ?? p.description);
        })
        .filter((c): c is string => Boolean(c)),
    ),
  ];
  const legacyOrders = legacyCodes.length
    ? await sdb.order.findMany({
        where: { code: { in: legacyCodes } },
        select: { id: true, code: true, status: true, totalAmount: true, customerName: true },
      })
    : [];
  const orderByCode = new Map(legacyOrders.map((o) => [o.code, o]));

  // 20/08 — Nối dòng nhật ký kỹ thuật với SỔ giao dịch. Trước đây màn này kết luận
  // "chưa xử lý được" bằng cách xem nội dung CK CÓ MÃ ĐƠN hay không; từ 20/08 nội
  // dung CK không còn nhúng mã đơn nữa nên điều kiện đó đúng với MỌI giao dịch mới
  // ⇒ cảnh báo mất sạch giá trị phân loại và che luôn những dòng UNMATCHED thật.
  // Câu hỏi đúng là "có TRA RA ĐƠN không" — chỉ `BankTransaction.status` trả lời
  // được, kèm `unmatchedNote` nói rõ vướng ở đâu để kế toán biết đường xử lý.
  // Khoá nối = `providerTxnId` mà `resolveProviderTxnId` dựng: reference trước, thiếu
  // thì tới id giao dịch của SePay (đúng thứ tự webhook truyền vào ingest).
  const legacyTxnKeys = [
    ...new Set(
      legacyRows
        .map((r) => {
          const p = readPayload(r.requestPayload);
          return p.referenceCode ?? (p.id != null ? String(p.id) : null);
        })
        .filter((k): k is string => Boolean(k)),
    ),
  ];
  const legacyTxns = legacyTxnKeys.length
    ? await sdb.bankTransaction.findMany({
        where: { provider: "SEPAY", providerTxnId: { in: legacyTxnKeys } },
        select: { providerTxnId: true, status: true, unmatchedNote: true },
      })
    : [];
  const txnByKey = new Map(legacyTxns.map((t) => [t.providerTxnId, t]));

  const legacyItems = legacyRows.map((r) => {
    const p = readPayload(r.requestPayload);
    const code = extractOrderCode(p.content ?? p.description);
    const order = code ? (orderByCode.get(code) ?? null) : null;
    const txnKey = p.referenceCode ?? (p.id != null ? String(p.id) : null);
    const txn = txnKey ? (txnByKey.get(txnKey) ?? null) : null;
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      action: r.action,
      status: r.status,
      error: r.errorMessage,
      amount: Number(p.transferAmount ?? 0),
      gateway: p.gateway ?? null,
      referenceCode: p.referenceCode ?? null,
      content: p.content ?? p.description ?? null,
      orderCode: code,
      order: order
        ? { id: order.id, status: order.status, totalAmount: order.totalAmount, customerName: order.customerName }
        : null,
      // null = không có dòng nào trong sổ giao dịch (log trước ngày dựng sổ, hoặc
      // dòng AUTH_FAILED chưa từng đi tới bước ghi sổ) — KHÔNG suy ra là lỗi.
      txnStatus: txn?.status ?? null,
      unmatchedNote: txn?.unmatchedNote ?? null,
    };
  });

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Biến động số dư</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Tiền về tài khoản → cổng báo về → hệ thống ghi giao dịch và <b>rót vào phiếu thu</b>{" "}
            của đơn. Trang này để kiểm tra tiền đã đi đúng chỗ chưa; dòng <b>Cần xử lý</b> là
            giao dịch chưa rót được vào phiếu nào (sai nội dung CK, không tra ra đơn) — mở đơn
            và xử lý tay.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <FilterTab href="/bien-dong-so-du" label="Tất cả" active={filter === "all"} />
          <FilterTab
            href="/bien-dong-so-du?status=unmatched"
            label={`Cần xử lý${unmatchedCount ? ` (${unmatchedCount})` : ""}`}
            active={filter === "unmatched"}
          />
          <FilterTab
            href="/bien-dong-so-du?status=matched"
            label="Đã khớp"
            active={filter === "matched"}
          />
        </div>
      </div>

      <BankTxnClient
        items={txnItems}
        canManage={canManagePayments}
        canGan={canGan}
      />

      <p className="mt-3 text-xs text-muted-foreground">
        Chỉ hiện 200 giao dịch gần nhất. Bảng trống nghĩa là chưa có tiền về qua cổng (webhook
        chưa bật) — không phải lỗi.
      </p>

      {/* ── Tiền thừa ─────────────────────────────────────────────────────── */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-border pb-2">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Tiền thừa chưa xử lý</h2>
            <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
              Tiền còn dư sau khi đã rót hết các đợt của đơn. Hệ thống <b>không tự hoàn</b> và{" "}
              <b>không tự trừ sang đơn khác</b> — kế toán quyết rồi ghi nhận ở nơi xử lý tương
              ứng. Đây là danh sách chỉ để xem.
            </p>
          </div>
          {credits.length > 0 && (
            <div className="text-sm text-foreground">
              Tổng: <b className="tabular-nums">{fmt(creditTotal)}đ</b> · {credits.length} khoản
            </div>
          )}
        </div>

        {credits.length === 0 ? (
          <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Không có khoản tiền thừa nào đang chờ xử lý.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <PhanTrangBang cuonNgang>
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted text-left text-xs font-medium uppercase text-muted-foreground">
                  <tr>
                    <th className="w-36 px-3 py-2">Thời gian</th>
                    <th className="w-32 px-3 py-2 text-right">Số tiền</th>
                    <th className="w-40 px-3 py-2">Đơn liên quan</th>
                    <th className="px-3 py-2">Ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {credits.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                        {c.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="px-3 py-2 align-top text-right font-semibold tabular-nums">
                        {fmt(c.amount)}đ
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        {c.orderId ? (
                          <Link href={`/orders/${c.orderId}`} className="font-medium text-state-info-ink hover:underline">
                            Mở đơn →
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">(chưa gắn đơn)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground">{c.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>
        )}
      </section>

      {/* ── Log webhook SePay cũ ──────────────────────────────────────────── */}
      <section className="mt-10">
        <div className="mb-3 border-b border-border pb-2">
          <h2 className="text-lg font-semibold text-foreground">Nhật ký webhook SePay (lịch sử)</h2>
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
            Nhật ký kỹ thuật của webhook SePay — giữ lại để tra các đơn xử lý TRƯỚC khi chuyển
            sang sổ giao dịch ở trên. Không phải nguồn đối soát chính nữa; 100 dòng gần nhất.
          </p>
        </div>
        <SepayLogClient items={legacyItems} />
      </section>
    </div>
  );
}

function FilterTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`rounded-lg px-3 py-1.5 font-medium ${ active ? "bg-primary-dark text-white" : "border border-border text-foreground hover:bg-muted" }`}
    >
      {label}
    </Link>
  );
}
