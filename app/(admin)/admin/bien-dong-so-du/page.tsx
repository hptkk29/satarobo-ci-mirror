import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { coNoiNaoBatThuLinhHoat } from "@/lib/finance/feature";
import { resolveActor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { extractOrderCode } from "@/lib/payments/sepay";
import { PROVIDER_THE_POS } from "@/lib/payments/pos/kieu";
import { nhapPosDuocMoiCoSo } from "@/lib/payments/pos/pham-vi-nhap";
import { loaiCanhBaoPos, tieuDeCanhBaoPos } from "@/lib/payments/pos/phan-loai-pos";
import { trangThaiHienThiLo } from "@/lib/payments/pos/trang-thai-lo";
import { docHangChoSaiMa } from "@/lib/payments/pos/sai-ma-doc";
import { ngayGioVN } from "@/lib/format/date";
import { SepayLogClient } from "./_components/sepay-log-client";
import { BankTxnClient, type BankTxnItem } from "./_components/bank-txn-client";
import { NhapFilePos } from "./_components/nhap-file-pos";
import {
  KhuThePos,
  type CanhBaoPosItem,
  type DonDaVao,
  type DongPosItem,
  type LoImportItem,
} from "./_components/khu-the-pos";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { AlertTriangle } from "lucide-react";
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

type LocTrangThai = "all" | "unmatched" | "matched";
type LocNguon = "tat-ca" | "ck" | "the";
type Loc = { status: LocTrangThai; nguon: LocNguon; posBoQua: boolean };

/**
 * Link lọc GIỮ tham số của nhau: bấm "Cần xử lý" khi đang ở "Thẻ POS" thì vẫn ở "Thẻ POS".
 * Giá trị mặc định không ghi lên URL để link gốc vẫn là `/bien-dong-so-du`.
 */
function hrefLoc(hienTai: Loc, doi: Partial<Loc>): string {
  const l = { ...hienTai, ...doi };
  const q = new URLSearchParams();
  if (l.status !== "all") q.set("status", l.status);
  if (l.nguon !== "tat-ca") q.set("nguon", l.nguon);
  if (l.posBoQua) q.set("posBoQua", "1");
  const s = q.toString();
  return s ? `/bien-dong-so-du?${s}` : "/bien-dong-so-du";
}

export default async function SepayLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; nguon?: string; posBoQua?: string }>;
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
  //
  // `payments:import-pos` (Q-D: chỉ Kế toán HO + Quản trị tối cao) KHÔNG mở cửa trang — nó chỉ
  // quyết định có vẽ nút "Import file POS" / "Đóng cảnh báo" hay không, đúng quyền mà
  // `_pos-actions.ts` hỏi lại ở server (luật 12: nút không hứa việc action sẽ từ chối).
  //
  // `centers:view` (09/10/2026): link "Khai máy POS ở Cơ sở" trỏ `/centers`, mà trang đó gác bằng quyền này — vẽ link cho
  // người sẽ bị đá về /dashboard là lời hứa suông. Hỏi trong CÙNG lô, không thêm lượt đi-về, và hỏi Y HỆT trang đích
  // (`centers/page.tsx`: có đích `{ centerId }`) — gọi trần một action seed scope CENTER (CENTER_HR) là khoá nhầm dưới RBAC v2,
  // đúng lớp lỗi lưới `rbac-scope` R1 canh.
  const [canManagePayments, canRecordPayments, canViewPayments, canImportPos, coQuyenXemCoSo] = await Promise.all([
    checkPermission("payments:manage"),
    checkPermission("payments:record"),
    checkPermission("payments:view"),
    checkPermission("payments:import-pos"),
    checkPermission("centers:view", { centerId: session.user.centerId ?? null }),
  ]);
  if (!canManagePayments && !canRecordPayments && !canViewPayments) redirect("/dashboard");

  const sp = await searchParams;
  const filter: LocTrangThai = sp.status === "unmatched" || sp.status === "matched" ? sp.status : "all";
  const nguon: LocNguon = sp.nguon === "ck" || sp.nguon === "the" ? sp.nguon : "tat-ca";
  const posBoQua = sp.posBoQua === "1";
  const loc: Loc = { status: filter, nguon, posBoQua };
  // Nguồn tiền: thẻ POS là `BankTransaction.provider = CARD_POS`; "chuyển khoản" là mọi cổng còn lại.
  const whereNguon =
    nguon === "the"
      ? { provider: PROVIDER_THE_POS }
      : nguon === "ck"
        ? { provider: { not: PROVIDER_THE_POS } }
        : {};

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  // Nút import hỏi ĐÚNG hai cổng mà `_pos-actions.ts` hỏi lại ở server: quyền + phạm vi MỌI cơ
  // sở. Chỉ gác bằng quyền thì người giữ quyền mà tầm nhìn chỉ một cơ sở chọn file, xem trước,
  // bấm Nhập rồi mới bị từ chối (luật 12). Link "Khai máy POS ở Cơ sở" (thêm `centers:view`, xem lô quyền ở trên) và
  // "Đóng cảnh báo" giữ theo quyền.
  const nhapPosDuoc = canImportPos && nhapPosDuocMoiCoSo(actor);

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
      ...whereNguon,
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
      // Nested include KHÔNG được auto-scope. Giao dịch top-level trong scope KHÔNG bảo đảm
      // đơn cùng cơ sở: giao dịch thẻ POS mang cơ sở của MÁY (quẹt ở CS1 cho phiếu CS2) ⇒ lọc
      // từng đơn bằng `passesScope("Order")` khi dựng `txnItems` bên dưới.
      allocations: {
        select: {
          amount: true,
          paymentRequestId: true,
          paymentRequest: {
            select: {
              installmentNo: true,
              amountDue: true,
              status: true,
              order: { select: { id: true, code: true, customerName: true, centerId: true } },
            },
          },
        },
      },
    },
  });

  // Đếm theo NGUỒN đang lọc — con số trên tab phải khớp số dòng người dùng sắp thấy.
  const unmatchedCount = await sdb.bankTransaction.count({ where: { ...whereNguon, status: "UNMATCHED" } });

  // ── Giao dịch thẻ POS (docs/pos-the-smartpos.md) ─────────────────────────────
  // `PosCardTransaction` ∈ SCOPED_MODELS + NULL_IS_GLOBAL_MODELS: centerId null (máy chưa khai
  // cơ sở) vẫn hiện cho mọi người đối soát — y lý do của BankTransaction ở trên.
  // Bốn câu tra độc lập ⇒ một lô (CLAUDE.md: "trang admin chậm" là độ sâu tuần tự).
  const dieuKienDongPos = posBoQua
    ? { OR: [{ matchStatus: "CAN_XU_LY" as const, bankTransactionId: null }, { matchStatus: "BO_QUA" as const }] }
    : { matchStatus: "CAN_XU_LY" as const, bankTransactionId: null };
  // Việc 3 (09/10): hàng chờ "sale nhập sai mã trên máy" vào CHÍNH lô này — không thêm lượt đi-về nối đuôi. Chỉ đọc khi người xem có
  // `payments:manage` (đúng quyền hai nút Duyệt/Từ chối hỏi ở máy chủ): nút họ không bấm được thì không đọc, không vẽ (luật 12).
  const [canhBaoRows, dongPosRows, soBoQua, loRows, hangSaiMa] = await Promise.all([
    sdb.posCardTransaction.findMany({
      where: { canhBaoHuy: true, canhBaoDaXuLyLuc: null },
      orderBy: { thoiGianGiaoDich: "desc" },
      take: 100,
      select: {
        id: true,
        maGiaoDich: true,
        thoiGianGiaoDich: true,
        soTien: true,
        maThietBi: true,
        soTheMasked: true,
        loaiThe: true,
        matchReason: true,
        // Nested select KHÔNG được auto-scope, và dòng POS top-level có thể nằm trong scope CHỈ
        // VÌ nó NULL (máy chưa khai ⇒ NULL_IS_GLOBAL) trong khi tiền đã gắn vào đơn cơ sở khác
        // ⇒ lọc từng đơn bằng `passesScope("Order")` khi dựng `canhBaoPos` (ca `[POS-DB-18]`).
        bankTransaction: {
          select: {
            status: true,
            allocations: {
              select: {
                amount: true,
                // Khoá React của từng dòng "Tiền đã vào": phiếu gộp hai bé cùng học phí cho hai
                // phân bổ cùng (đơn, số tiền) ⇒ key trùng. Ca `[POS-UI-05]`.
                paymentRequestId: true,
                paymentRequest: {
                  select: { order: { select: { id: true, code: true, customerName: true, centerId: true } } },
                },
              },
            },
          },
        },
      },
    }),
    sdb.posCardTransaction.findMany({
      where: dieuKienDongPos,
      orderBy: { thoiGianGiaoDich: "desc" },
      take: 200,
      select: {
        id: true,
        maGiaoDich: true,
        maGiaoDichGoc: true,
        loaiGiaoDich: true,
        trangThaiHoanHuy: true,
        thoiGianGiaoDich: true,
        soTien: true,
        dienGiai: true,
        maThietBi: true,
        maQuay: true,
        soTheMasked: true,
        loaiThe: true,
        matchStatus: true,
        matchReason: true,
      },
    }),
    sdb.posCardTransaction.count({ where: { matchStatus: "BO_QUA" } }),
    // `PosImportBatch` không có cột đơn vị (một file chứa giao dịch mọi máy) — chỉ tên file,
    // người nhập và số đếm, không có dữ liệu giao dịch nào.
    sdb.posImportBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        tenFile: true,
        createdAt: true,
        soDong: true,
        soMoi: true,
        soCapNhat: true,
        soTuKhop: true,
        soCanXuLy: true,
        soBoQua: true,
        soLoi: true,
        trangThai: true,
        soLoTong: true,
        soLoXong: true,
        updatedAt: true,
        importedBy: { select: { name: true, email: true } },
      },
    }),
    canManagePayments ? docHangChoSaiMa(sdb, actor, new Date()) : Promise.resolve(null),
  ]);

  const canhBaoPos: CanhBaoPosItem[] = canhBaoRows.map((c) => ({
    id: c.id,
    maGiaoDich: c.maGiaoDich,
    thoiGian: c.thoiGianGiaoDich,
    soTien: c.soTien,
    maThietBi: c.maThietBi,
    soTheMasked: c.soTheMasked,
    loaiThe: c.loaiThe,
    matchReason: c.matchReason,
    loai: loaiCanhBaoPos(c.matchReason),
    trangThaiSo: c.bankTransaction?.status ?? null,
    donDaVao: (c.bankTransaction?.allocations ?? []).flatMap((a): DonDaVao[] => {
      const o = a.paymentRequest.order;
      if (!o) return [];
      // Đơn ngoài tầm nhìn ⇒ chỉ số tiền; KHÔNG mã đơn, KHÔNG tên khách, KHÔNG link.
      return passesScope("Order", o, actor)
        ? [{ khoa: a.paymentRequestId, orderId: o.id, orderCode: o.code, customerName: o.customerName, amount: a.amount }]
        : [{ khoa: a.paymentRequestId, orderId: null, orderCode: "Đơn ở cơ sở khác", customerName: null, amount: a.amount }];
    }),
  }));
  const dongPos: DongPosItem[] = dongPosRows.map((d) => ({
    id: d.id,
    maGiaoDich: d.maGiaoDich,
    maGiaoDichGoc: d.maGiaoDichGoc,
    loaiGiaoDich: d.loaiGiaoDich,
    trangThaiHoanHuy: d.trangThaiHoanHuy,
    thoiGian: d.thoiGianGiaoDich,
    soTien: d.soTien,
    dienGiai: d.dienGiai,
    maThietBi: d.maThietBi,
    maQuay: d.maQuay,
    soTheMasked: d.soTheMasked,
    loaiThe: d.loaiThe,
    matchStatus: d.matchStatus,
    matchReason: d.matchReason,
  }));
  // "Dừng giữa chừng" của lượt bỏ dở được SUY ở đây, khi đọc (quá 30 phút không lô nào cập
  // nhật) — không cron nào ghi trạng thái đó. Mốc giờ đọc một lần cho cả bảng.
  const docLuc = new Date();
  const loPos: LoImportItem[] = loRows.map((l) => ({
    id: l.id,
    tenFile: l.tenFile,
    nguoiNhap: l.importedBy.name ?? l.importedBy.email ?? "—",
    luc: l.createdAt,
    soDong: l.soDong,
    soMoi: l.soMoi,
    soCapNhat: l.soCapNhat,
    soTuKhop: l.soTuKhop,
    soCanXuLy: l.soCanXuLy,
    soBoQua: l.soBoQua,
    soLoi: l.soLoi,
    trangThai: trangThaiHienThiLo(
      { trangThai: l.trangThai, soLoTong: l.soLoTong, soLoXong: l.soLoXong, capNhatLuc: l.updatedAt },
      docLuc,
    ),
  }));

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
    allocations: t.allocations.map((a) => {
      const o = a.paymentRequest.order;
      // Đơn ngoài tầm nhìn (giao dịch thẻ quẹt ở máy cơ sở này cho phiếu cơ sở khác) ⇒ không lộ
      // mã đơn / tên khách / link — chỉ số tiền và đợt.
      const thay = o ? passesScope("Order", o, actor) : false;
      return {
        paymentRequestId: a.paymentRequestId,
        amount: a.amount,
        installmentNo: a.paymentRequest.installmentNo,
        amountDue: a.paymentRequest.amountDue,
        requestStatus: a.paymentRequest.status,
        orderId: thay ? (o?.id ?? null) : null,
        orderCode: thay ? (o?.code ?? null) : o ? "Đơn ở cơ sở khác" : null,
        customerName: thay ? (o?.customerName ?? null) : null,
      };
    }),
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
        <div className="min-w-0 flex-1 basis-[28rem]">
          <h1 className="text-2xl font-bold text-foreground">Biến động số dư</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Tiền về tài khoản → cổng báo về → hệ thống ghi giao dịch và <b>rót vào phiếu thu</b>{" "}
            của đơn. Trang này để kiểm tra tiền đã đi đúng chỗ chưa; dòng <b>Cần xử lý</b> là
            giao dịch chưa rót được vào phiếu nào (sai nội dung CK, không tra ra đơn) — mở đơn
            và xử lý tay.
          </p>
        </div>
        {canImportPos && (
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {/* Lối vào chỗ khai máy cho Kế toán HO khi gặp "Thiết bị chưa gán cơ sở". Từ 09/10/2026 `payments:import-pos` KHÔNG còn
                nằm trong `QUYEN_TAB` nên mục sidebar "Cấu hình vận hành" (hiện theo `QUYEN_TAB`) không còn hiện với họ; và trên PROD "menu
                gọn" (`AN_MENU_KE_TOAN`) ẩn nốt mục sidebar "Cơ sở" — nên link này (cùng link ở trang đơn và màn POS Agent) là đường còn lại
                KHÔNG qua sidebar. Đã đo: docs/pos-hai-nut-khai-may.md §2.10 mục 2.
                Chỗ khai máy dời từ tab "Máy POS" về mục "Máy POS quẹt thẻ" của MỖI cơ sở ⇒ link trỏ danh sách cơ sở (link này không mang
                cơ sở nào). `/centers` gác `centers:view` nên link chỉ vẽ khi người xem có quyền đó (luật 12).
                Lưới `[POS-NAV-01]` · `[HN2-MP-W06]` · trình duyệt thật `[HN2-MP-E3]`. */}
            {coQuyenXemCoSo && (
              <Link
                href="/centers"
                className="text-sm font-medium text-state-info-ink hover:underline"
              >
                Khai máy POS ở Cơ sở
              </Link>
            )}
            {/* GĐ2 POS — màn tra cứu nhật ký kiểm thẻ: cổng = `payments:import-pos`, đúng quyền vẽ khối
                này (luật 12). Chuông quét sạch / lỗi kết nối cũng trỏ về đó. Lưới `[POS2-NK-04]`. */}
            <Link
              href="/bien-dong-so-du/nhat-ky-pos"
              className="text-sm font-medium text-state-info-ink hover:underline"
            >
              Nhật ký kiểm thẻ POS
            </Link>
            {/* GĐ4 POS — màn Sức khoẻ POS Agent + đối chiếu agent ↔ file: cổng =
                `payments:import-pos`, đúng quyền vẽ khối này (luật 12). Chuông hết phiên / mất kết nối /
                lỗi agent trỏ về đó. Lưới `[POS4-NAV-01]`. */}
            <Link
              href="/bien-dong-so-du/pos-agent"
              className="text-sm font-medium text-state-info-ink hover:underline"
            >
              Sức khoẻ POS Agent
            </Link>
            {nhapPosDuoc && <NhapFilePos />}
          </div>
        )}
      </div>

      {canhBaoPos.length > 0 && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-state-danger bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="font-semibold">{tieuDeCanhBaoPos(canhBaoPos)}</span>
          <a href="#the-pos" className="font-medium underline underline-offset-2 hover:no-underline">
            Xem và xử lý
          </a>
        </div>
      )}

      {/* Việc 3: có yêu cầu "sale nhập sai mã" đang CHỜ kế toán ⇒ băng riêng ngay đầu trang, không chung băng với cảnh báo hủy
          (hai việc khác loại: đây là giao dịch CÓ TIỀN chờ ghi nhận, kia là tiền ĐÃ ghi nhận mà thẻ bị hủy sau). */}
      {hangSaiMa !== null && hangSaiMa.soCanXuLy > 0 && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-state-warning/50 bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="font-semibold">{hangSaiMa.soCanXuLy} giao dịch thẻ do sale báo nhập sai mã đang chờ xử lý</span>
          <a href="#the-pos-sai-ma" className="font-medium underline underline-offset-2 hover:no-underline">
            Xem và xử lý
          </a>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
        <nav aria-label="Lọc theo trạng thái" className="flex flex-wrap gap-2">
          <FilterTab href={hrefLoc(loc, { status: "all" })} label="Tất cả" active={filter === "all"} />
          <FilterTab
            href={hrefLoc(loc, { status: "unmatched" })}
            label={`Cần xử lý${unmatchedCount ? ` (${unmatchedCount})` : ""}`}
            active={filter === "unmatched"}
          />
          <FilterTab
            href={hrefLoc(loc, { status: "matched" })}
            label="Đã khớp"
            active={filter === "matched"}
          />
        </nav>
        <nav aria-label="Lọc theo nguồn tiền" className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Nguồn</span>
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <NguonTab href={hrefLoc(loc, { nguon: "tat-ca" })} label="Tất cả" active={nguon === "tat-ca"} />
            <NguonTab href={hrefLoc(loc, { nguon: "ck" })} label="Chuyển khoản" active={nguon === "ck"} />
            <NguonTab href={hrefLoc(loc, { nguon: "the" })} label="Thẻ POS" active={nguon === "the"} />
          </div>
        </nav>
      </div>

      <BankTxnClient
        items={txnItems}
        canManage={canManagePayments}
        canGan={canGan}
        nguon={nguon}
        saiMaTheoGiaoDich={hangSaiMa?.theoGiaoDich ?? {}}
      />

      <p className="mt-3 text-xs text-muted-foreground">
        Chỉ hiện 200 giao dịch gần nhất. Chuyển khoản về qua cổng (webhook); giao dịch thẻ POS về
        khi Kế toán Hội sở import file của ngân hàng.
      </p>

      {/* ── Giao dịch thẻ POS cần xử lý ──────────────────────────────────── */}
      <KhuThePos
        canhBao={canhBaoPos}
        dong={dongPos}
        lo={loPos}
        hienBoQua={posBoQua}
        soBoQua={soBoQua}
        hrefBatTatBoQua={`${hrefLoc(loc, { posBoQua: !posBoQua })}#the-pos`}
        hrefCanXuLyThe={hrefLoc(loc, { status: "unmatched", nguon: "the" })}
        canDongCanhBao={canImportPos}
        saiMa={hangSaiMa}
        nguoiXemId={session.user.id}
      />

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
                        {ngayGioVN(c.createdAt)}
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
      aria-current={active ? "page" : undefined}
      className={`whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-colors duration-150 ${ active ? "bg-primary-dark text-white" : "border border-border text-foreground hover:bg-muted" }`}
    >
      {label}
    </Link>
  );
}

/** Nút trong nhóm "Nguồn" — nhóm phân đoạn, nhẹ hơn tab trạng thái để hai trục không tranh nhau. */
function NguonTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-medium transition-colors duration-150 ${
        active ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}
