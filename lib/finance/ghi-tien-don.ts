import "server-only";
// lib/finance/ghi-tien-don.ts — ĐƯỜNG GHI DUY NHẤT cho mọi phép làm đổi tiền của MỘT ĐƠN.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN B · Chủ dự án chốt 16/09/2026
//
//   *"Một hàm ghi tiền trong lib/finance, transaction + pg_advisory_xact_lock theo orderId.
//   Đọc còn nợ và ghi trong CÙNG transaction sau khi lấy khoá."*
//
// ⚠️ VÌ SAO ĐỌC PHẢI NẰM TRONG KHOÁ — lỗi PHIÊN A đã mắc
//
// `taoDotChoConAction` của PHIÊN A gọi `noTheoCon(orderId)` NGOÀI transaction rồi mới `create`.
// Hai sale bấm "Tạo đợt" cùng lúc cho cùng một bé: cả hai đọc `conNo = 8.000.000`, cả hai thấy
// "đợt đang mở = 0", cả hai tạo đợt 8.000.000 ⇒ hệ thống phát HAI mã QR mỗi mã đòi đủ tiền.
// Cổng `kiemTaoDot` không sai một dòng nào — nó chỉ được cho ăn một con số đã cũ.
//
// Khoá advisory (không phải `SELECT … FOR UPDATE`) vì thứ cần khoá là *cả cụm tiền của đơn*,
// mà cụm đó trải trên bốn bảng (`PaymentRequest`, `PaymentAllocation`, `Payment`,
// `BankTransaction`); không có một hàng nào để khoá cho ra nghĩa đó.
//
// ⚠️ KHOÁ PHẢI CÙNG MỘT KHOÁ với `allocateToOrder` (`lib/payments/payos-ingest.ts`), nếu không
// thì webhook và màn gắn tay chạy song song vẫn giẫm lên nhau trong khi cả hai đều "có khoá".
// Đó là lý do `khoaDonTrongTx` tồn tại và là NƠI DUY NHẤT trong repo đánh vần chuỗi khoá ấy
// cho đơn hàng.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { TIEN_THUA_CHUA_XU_LY, lyDoTienThuaDoGoGan } from "@/lib/finance/tien-thua";
import { docSoTheoCon } from "@/lib/finance/debt";
import { kiemTaoDot, kiemHuyDot, type NoTheoConKetQua } from "@/lib/finance/no-theo-con";
import { kiemChiaTheoCon, dungDotDeChia, type DongChia } from "@/lib/finance/chia-tien-theo-con";
import { kiemTachKhoan, type PhanTach } from "@/lib/finance/tach-khoan";
import { kiemChuyenTien } from "@/lib/finance/chuyen-tien-con";
import { locDonNhanTien } from "@/lib/payments/don-nhan-tien";
import { giaoDichPosSauGoGanTrongTx, type SauGoGanPos } from "@/lib/payments/pos/go-gan-pos";
import { ngayThuCuaGiaoDich } from "@/lib/payments/pos/ngay-thu";
import { phieuGopSauGoGanTrongTx, type PhieuSauGoGan } from "@/lib/finance/phieu-gop-go-gan-db";
import { soatPhieuGopMoTrongTx } from "@/lib/finance/soat-phieu-gop-db";
import { thongDiepPhieuDaSoat } from "@/lib/finance/soat-phieu-gop";
import { recomputeRequestStatuses } from "@/lib/payments/payment-request";
import { thuTuRot } from "@/lib/payments/thu-tu-rot";
import { khoanDaKhoaHoaDon, thongDiepKhoaHoaDon } from "@/lib/finance/hoa-don/khoa-khoan";

type Tx = Prisma.TransactionClient;

export type KetQuaGhi<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/**
 * Khoá advisory theo ĐƠN — nơi DUY NHẤT trong repo đánh vần chuỗi khoá này cho đơn hàng.
 *
 * ⚠️ PHẢI `$executeRaw`, KHÔNG `$queryRaw`: `pg_advisory_xact_lock()` trả kiểu `void` và Prisma
 * sẽ ném *"Failed to deserialize column of type 'void'"* — đúng con bug PR #76.
 *
 * ⚠️ Công thức khoá (`hashtext(orderId)::bigint`, KHÔNG tiền tố) phải trùng KHÍT với chỗ cũ ở
 * `allocateToOrder`. Thêm một tiền tố cho "sạch" là hai đường ghi khoá hai chỗ khác nhau, ai
 * đọc mã cũng thấy "có khoá", và không có gì báo động.
 */
export async function khoaDonTrongTx(tx: Tx, orderId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderId})::bigint)`;
}

/**
 * Khoá DÒNG `BankTransaction` (`SELECT … FOR UPDATE`) — gọi NGAY SAU khoá đơn, TRƯỚC khi đọc
 * `status` để quyết "còn UNMATCHED không".
 *
 * ⚠️ Khoá đơn KHÔNG đủ để chống rót một giao dịch hai lần: hai đường gắn CÙNG một giao dịch vào
 * HAI ĐƠN khác nhau giữ hai khoá khác nhau, cùng đọc thấy UNMATCHED, cùng ghi phân bổ + `Payment`,
 * rồi cùng `update … MATCHED` (lệnh update đến sau chỉ chờ khoá dòng rồi ghi đè). Đo 29/09: nhập
 * lại file POS (tự khớp phiếu đơn A) ‖ gắn tay vào đơn B ⇒ 11/12 lượt ghi tiền ĐÔI — một lần quẹt
 * 6.732.000đ thành 13.464.000đ trên hai đơn (ca `[POS-DB-19]`).
 *
 * Khoá dòng làm bên vào sau CHỜ bên trước commit, rồi đọc lại (READ COMMITTED: câu lệnh mới thấy
 * bản đã commit) ra MATCHED ⇒ rút lui. Thứ tự khoá luôn là ĐƠN rồi GIAO DỊCH ở mọi đường gọi,
 * nên không sinh vòng chờ.
 */
export async function khoaGiaoDichTrongTx(tx: Tx, bankTransactionId: string): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM "BankTransaction" WHERE id = ${bankTransactionId} FOR UPDATE`;
}

/**
 * Mở một transaction, lấy khoá của đơn, đọc LẠI công nợ theo con trong khoá, rồi chạy `viec`.
 *
 * `viec` nhận `so` đã đọc dưới khoá — đừng đọc lại bằng `noTheoCon` ở trong đó, bản kia dùng
 * `db` trần và nằm ngoài transaction này.
 */
export async function ghiTienChoDon<T>(
  orderId: string,
  viec: (tx: Tx, so: NoTheoConKetQua) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await khoaDonTrongTx(tx, orderId);
    const so = await docSoTheoCon(tx, orderId);
    return viec(tx, so);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 · TẠO ĐỢT CHO MỘT CON
// ─────────────────────────────────────────────────────────────────────────────

export async function taoDotChoCon(input: {
  orderId: string;
  orderItemId: string;
  soTien: number;
  dueDate: Date | null;
  centerId: string | null;
  actor: AuditActor;
}): Promise<KetQuaGhi<{ paymentRequestId: string; installmentNo: number }>> {
  return ghiTienChoDon(input.orderId, (tx, so) => taoDotChoConTrongTx(tx, so, input));
}

/**
 * Thân của `taoDotChoCon`, chạy TRONG transaction của người gọi. [Tách ở F4 · 22/09/2026]
 *
 * ⚠️ Cùng lý do với `dungHocTrongTx` và `chuyenLopTrongTx`: F4 ("đổi khoá") phải tạo đợt cho
 * phần còn thiếu của khoá mới trong CÙNG transaction đã dừng dòng cũ và chuyển tiền —
 * `ghiTienChoDon` không lồng được. Chép lại cổng tạo đợt sang chỗ thứ hai là hai bản luật
 * tiền song song.
 *
 * ⚠️ `so` phải là ảnh chụp ĐỌC SAU khi dòng mới đã tồn tại: cổng `kiemTaoDot` lấy còn-nợ của
 * con và của đơn TỪ ẢNH CHỤP.
 */
export async function taoDotChoConTrongTx(
  tx: Tx,
  so: NoTheoConKetQua,
  input: {
    orderId: string;
    orderItemId: string;
    soTien: number;
    dueDate: Date | null;
    centerId: string | null;
    actor: AuditActor;
  },
): Promise<KetQuaGhi<{ paymentRequestId: string; installmentNo: number }>> {
  {
    const con = so.con.find((c) => c.orderItemId === input.orderItemId);
    if (!con) return { ok: false as const, error: "Dòng hàng không thuộc đơn này" };

    const kiem = kiemTaoDot({
      soTien: input.soTien,
      conNo: con.conNo,
      tongDotDangMo: con.tongDotDangMo,
      tenCon: con.ten,
      // Hai vế ĐƠN lấy thẳng từ `docSoTheoCon` — đọc TRONG transaction sau khi đã khoá đơn
      // (`ghiTienChoDon`), nên hai lượt tạo đợt song song không cùng thấy một số cũ.
      conNoDon: so.conNoDon,
      tongDotDangMoDon: so.tongDotDangMoDon,
    });
    if (!kiem.ok) return { ok: false as const, error: kiem.loi };

    // Số đợt kế tiếp CỦA RIÊNG CON NÀY — khoá duy nhất từng phần là
    // `[orderItemId, installmentNo] WHERE orderItemId IS NOT NULL`, nên hai con đếm độc lập.
    const maxDot = await tx.paymentRequest.aggregate({
      where: { orderItemId: input.orderItemId },
      _max: { installmentNo: true },
    });
    const soDot = (maxDot._max.installmentNo ?? 0) + 1;

    const phieu = await tx.paymentRequest.create({
      data: {
        orderId: input.orderId,
        orderItemId: input.orderItemId,
        centerId: input.centerId,
        installmentNo: soDot,
        amountDue: kiem.soTien,
        dueDate: input.dueDate,
        status: "PENDING",
        // Thứ tự rót: DÒNG trước, ĐỢT sau (`lib/payments/thu-tu-rot.ts`). Không đặt thì hai
        // con cùng "đợt 1" có cùng `sortOrder` và thứ tự rót rơi về so sánh cuid.
        sortOrder: thuTuRot({
          thuTuDong: so.con.findIndex((c) => c.orderItemId === input.orderItemId),
          installmentNo: soDot,
        }),
      },
      select: { id: true },
    });

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: "DOT_THEO_CON_CREATED",
      newValues: { orderItemId: input.orderItemId, ten: con.ten, soTien: kiem.soTien, soDot },
      orgUnitId: input.centerId,
    });

    return { ok: true as const, paymentRequestId: phieu.id, installmentNo: soDot };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · HUỶ MỘT ĐỢT CHƯA CÓ TIỀN
// ─────────────────────────────────────────────────────────────────────────────

export async function huyDotChoCon(input: {
  orderId: string;
  paymentRequestId: string;
  centerId: string | null;
  actor: AuditActor;
}): Promise<KetQuaGhi<{ thongDiepPhieu: string | null }>> {
  return ghiTienChoDon(input.orderId, async (tx) => {
    const phieu = await tx.paymentRequest.findUnique({
      where: { id: input.paymentRequestId },
      select: { id: true, orderId: true, status: true, allocations: { select: { amount: true } } },
    });
    // So `orderId` chứ không tin tham số: người gọi có thể gửi id phiếu của đơn khác.
    if (!phieu || phieu.orderId !== input.orderId) {
      return { ok: false as const, error: "Không tìm thấy đợt thu" };
    }

    const kiem = kiemHuyDot({
      trangThai: phieu.status,
      daRot: phieu.allocations.reduce((s, a) => s + a.amount, 0),
    });
    if (!kiem.ok) return { ok: false as const, error: kiem.loi };

    await tx.paymentRequest.update({ where: { id: phieu.id }, data: { status: "VOID" } });
    // Mã QR của đợt vừa huỷ phải chết theo — affordance phải nói thật.
    await tx.qrSession.updateMany({
      where: { paymentRequestId: phieu.id, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });
    // Phiếu gộp đang mở có dòng trỏ đợt vừa huỷ ⇒ huỷ/đóng phiếu (đường này không qua
    // `recomputeRequestStatuses`, nên gọi thẳng). Để nguyên là mời khách trả trọn số cũ — ca `[V3-04]`.
    // Kết quả lên tới toast (rà vòng 4, luật 12): phiếu gộp của CẢ gia đình vừa bị huỷ/đóng.
    const phieuDaSoat = await soatPhieuGopMoTrongTx(tx, input.orderId);

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: "DOT_THEO_CON_VOIDED",
      newValues: { paymentRequestId: phieu.id },
      orgUnitId: input.centerId,
    });

    return { ok: true as const, thongDiepPhieu: thongDiepPhieuDaSoat(phieuDaSoat) };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · GẮN MỘT GIAO DỊCH NGÂN HÀNG, CHIA ĐÍCH DANH THEO ĐỢT
// ─────────────────────────────────────────────────────────────────────────────

/** Marker trong `Payment.note` để tìm lại đúng các dòng do một lần GẮN TAY sinh ra. */
export const markerGanTay = (bankTransactionId: string) => `[gan-tay:${bankTransactionId}]`;

/**
 * Tiền tố `BankTransaction.unmatchedNote` của một giao dịch vừa được GỠ GẮN. Tầng import thẻ
 * POS (`lib/payments/pos/nhap-lo-pos.ts`) đọc nó để KHÔNG tự khớp lại / ghi đè lý do gỡ của kế
 * toán ở lần import sau — đổi chuỗi này mà không đổi bên kia là giao dịch vừa gỡ bị máy khớp
 * lại im lặng (ca `[POS-DB-20]`).
 */
export const TIEN_TO_GO_GAN = "Đã gỡ gắn: ";

/**
 * Marker của đường WEBHOOK (`allocateToOrder`) — họ marker ĐỜI CŨ.
 *
 * ⚠️ Phải khớp TỪNG KÝ TỰ với chuỗi mà `payos-ingest.ts` ghi ra:
 * `` `[auto:${provider.toLowerCase()}:${providerTxnId}]` ``. Lệch một ký tự là `goGanTheoCon`
 * không tìm thấy dòng gốc nào — và hậu quả KHÔNG phải một lỗi, mà là một lượt gỡ NỬA VỜI:
 * `PaymentAllocation` bị xoá (Ledger-B mất dấu) trong khi `Payment` còn nguyên (Ledger-A vẫn
 * tính là đã thu). Giao dịch quay về hàng chờ, công nợ vẫn báo đã đóng, và không lỗi nào báo.
 */
export const markerWebhook = (provider: string, providerTxnId: string) =>
  `[auto:${provider.toLowerCase()}:${providerTxnId}]`;

/**
 * Đơn còn DÒNG THU nào mang `marker` mà vẫn GIỮ TIỀN không — phép kiểm trùng trước khi ghi sổ
 * cũ (`Payment`) cho một giao dịch ngân hàng. Chung cho `allocateToOrder`
 * (`lib/payments/payos-ingest.ts`) và `thuTheoPhieuGop` (`lib/finance/phieu-gop.ts`).
 *
 * ⚠️ VÌ SAO KHÔNG CÒN LÀ "CÓ DÒNG NÀO MANG MARKER KHÔNG" [vá 28/09/2026]
 *
 * Bản cũ ở cả hai chỗ gọi là `payment.findFirst({ orderId, deletedAt: null, note contains
 * marker })`. Nó đúng cho webhook retry, và SAI cho gỡ → gắn lại: `goGanTheoCon` (mục 5) GIỮ
 * dòng gốc P1 + đẻ bút toán đảo P2, rồi đưa giao dịch về UNMATCHED. Gắn lại vào CÙNG đơn thì
 * phép kiểm cũ thấy P1 ⇒ bỏ qua ghi sổ ⇒ Ledger-B (phân bổ) nói đã thu, Ledger-A (Σ `Payment`)
 * nói 0 ⇒ công nợ báo còn nợ nguyên số tiền đã về. Ca `[GGL-01]`
 * (`tests/finance/go-gan-gan-lai.test.ts`).
 *
 * "Còn giữ tiền" = dòng `PAYMENT` + Σ bút toán `ADJUSTMENT` còn sống trỏ về nó ≠ 0 — đúng công
 * thức "giá trị HIỆN TẠI của phiếu" của `adjustPayment` (`lib/finance/payment.ts`).
 *
 * ⚠️ KHÔNG rút gọn thành "chưa có bút toán con nào" (`adjustments: { none: … }`). `ADJUSTMENT`
 * có HAI nghĩa: đảo TRỌN (gỡ gắn, tách khoản) và điều chỉnh MỘT PHẦN (`adjustPayment`). Bản
 * rút gọn coi khoản đã điều chỉnh −100.000 là "đã đảo" — mà `goGanTheoCon` cũng bỏ qua đúng
 * dòng ấy (`daDao > 0 → continue`), nên gỡ xong nó vẫn giữ 5.900.000 và gắn lại sẽ ghi thêm
 * 6.000.000: sổ cũ 11.900.000 cho một giao dịch 6.000.000. Ca `[GGL-04]` canh đúng điều đó.
 *
 * Dòng hoàn tiền (`refundPayment`) là `PAYMENT` số ÂM chép `note` của gốc, nên cũng mang
 * marker. `goGanTheoCon` đảo nó như mọi dòng thu khác ⇒ sau gỡ nó cũng về 0 — không cần nhánh
 * riêng ở đây.
 *
 * Đọc bằng `tx` của chỗ gọi, TRONG khoá đơn — ngoài khoá thì hai lượt song song cùng thấy
 * "không còn" và cùng ghi.
 */
export async function conDongThuGiuTien(
  tx: Tx,
  input: { orderId: string; marker: string },
): Promise<boolean> {
  const dong = await tx.payment.findMany({
    where: {
      orderId: input.orderId,
      deletedAt: null,
      paymentType: "PAYMENT",
      note: { contains: input.marker },
    },
    select: {
      amount: true,
      adjustments: {
        where: { paymentType: "ADJUSTMENT", deletedAt: null },
        select: { amount: true },
      },
    },
  });
  return dong.some((d) => d.amount + d.adjustments.reduce((s, a) => s + a.amount, 0) !== 0);
}

/**
 * Câu từ chối khi người KHÔNG phải kế toán gắn tay một giao dịch mà kế toán ĐÃ BÁC cho chính đơn này. [VIỆC 6 · a1, 10/10/2026]
 *
 * Nói đủ ba điều: chuyện gì đã xảy ra (kế toán từ chối), phạm vi (đơn này), việc nên làm (nhờ kế toán). Không "hủy/huỷ", không mời quẹt hay gắn lại.
 * Đứng ở `ghi-tien-don.ts` (chứ không ở `sai-ma.ts`) vì đây là câu của ĐƯỜNG GẮN TAY — và lib này không được import `sai-ma-doc` (xem `NguoiGan`).
 *
 * CHỮ — qua `/impeccable clarify` (Operate, chỉ chữ): người đọc là sale / quản lý cơ sở, trên màn họ thấy nút "Gắn vào đơn" và các câu anh em trong tệp này ("Giao dịch này đã được gắn rồi",
 * "Kế toán đã từ chối khoản này — không gắn cho bé nào được"). "Gắn tay" là thuật ngữ nội bộ của tài liệu/mã, không phải chữ trên màn ⇒ câu dùng "gắn" trơn (ca `[GTB-U6]` ghim).
 * Không nói LÝ DO bác (hệ thống không biết nó còn đúng hay không) và không khẳng định khách đã bị trừ tiền (giao dịch có thể là của khách khác).
 */
export const CAU_GAN_TAY_DA_BI_BAC =
  "Kế toán đã từ chối giao dịch này cho đơn này nên bạn không gắn được — nhờ kế toán xử lý.";

/**
 * AI đang gắn tay — quyết định giao dịch mà kế toán ĐÃ BÁC cho đơn này có gắn lại được không. [VIỆC 6 · a1, 10/10/2026]
 *
 * Chủ dự án chốt 10/10/2026: *"Chặn sale gắn tay giao dịch đã bị kế toán BÁC cho cùng đơn đó… Kế toán vẫn gắn được. Đơn khác vẫn thấy giao dịch đó."* Đảo V71 / V5-12 / R-5g
 * (trước đó đường gắn tay KHÔNG đọc vết bác nên sale gắn lại được đúng khoản kế toán vừa từ chối).
 *
 *   · `KE_TOAN` — người gắn giữ `payments:manage` (`HO_ACCOUNTANT` · `CENTER_ACCOUNTANT` · `SUPER_ADMIN`): quyết định cuối của kế toán (V71), không cổng nào thêm.
 *   · `KHAC` — mọi người còn lại có quyền gắn (`payments:record`: sale, quản lý cơ sở). BUỘC mang `docGiaoDichDaBiBac`: lib gọi nó DƯỚI khoá đơn, bằng `tx` của chính lượt
 *     gắn, và từ chối nếu giao dịch nằm trong kết quả.
 *
 * ⚠️ VÌ SAO HÀM ĐỌC ĐƯỢC TRUYỀN VÀO, KHÔNG IMPORT: `docGiaoDichDaBiBac` nằm ở `lib/payments/pos/sai-ma-doc.ts`, mà tệp đó import ngược `ghi-tien-don.ts`
 * (`TIEN_TO_GO_GAN`, `phieu-gop`) ⇒ import thẳng là vòng phụ thuộc, và `no-circular` của `.dependency-cruiser.cjs` là **error**. Kiểu hàm được khai CẤU TRÚC ở đây
 * (không `import type` từ `sai-ma-doc`) để cạnh phụ thuộc cũng không có. Người gọi (action) truyền thẳng CHÍNH hàm dùng chung của Việc 5 — không bọc, không viết lại.
 *
 * ⚠️ BẮT BUỘC (luật 7), không mặc định: mặc định "không ai bị hỏi vết bác" là đúng thứ vừa bị đóng. Dạng `KHAC` không thể khai thiếu hàm đọc, nên không có cách nói
 * "không phải kế toán" mà quên kiểm; còn miễn cho kế toán phải được NÓI RA ở từng chỗ gọi — `tsc` liệt kê đủ chỗ.
 */
export type NguoiGan =
  | { loai: "KE_TOAN" }
  | {
      loai: "KHAC";
      docGiaoDichDaBiBac: (tx: Tx, orderId: string) => Promise<{ readonly giaoDich: ReadonlySet<string> }>;
    };

export async function ganTienTheoCon(input: {
  bankTransactionId: string;
  orderId: string;
  dong: readonly DongChia[];
  actor: AuditActor;
  /** BẮT BUỘC (luật 7) — xem `NguoiGan`. */
  nguoiGan: NguoiGan;
}): Promise<KetQuaGhi<{ daChia: number; soDong: number; daDuTien: boolean }>> {
  return ghiTienChoDon(input.orderId, async (tx, so) => {
    // Đọc LẠI trong khoá: hai người cùng gắn một giao dịch thì người vào sau thấy MATCHED.
    // Khoá DÒNG giao dịch trước khi đọc — khoá đơn không chặn lượt gắn vào ĐƠN KHÁC.
    await khoaGiaoDichTrongTx(tx, input.bankTransactionId);
    const txn = await tx.bankTransaction.findUnique({
      where: { id: input.bankTransactionId },
      select: {
        id: true,
        amount: true,
        status: true,
        centerId: true,
        provider: true,
        providerTxnId: true,
        // Ngày thu của `Payment`: nguồn thẻ POS = giờ quẹt (`ngayThuCuaGiaoDich`).
        transferredAt: true,
      },
    });
    if (!txn) return { ok: false as const, error: "Không tìm thấy giao dịch" };
    if (txn.status === "MATCHED") {
      return { ok: false as const, error: "Giao dịch này đã được gắn rồi" };
    }
    if (txn.status === "IGNORED") {
      return {
        ok: false as const,
        error: "Giao dịch đang ở trạng thái Bỏ qua — kế toán phải mở lại trước",
      };
    }

    // Cùng một luật với tầng đối khớp tự động: đơn DRAFT/CANCELLED/REFUNDED/xoá mềm không
    // nhận tiền. Gắn tay KHÔNG phải cửa sau của luật đó.
    const don = await tx.order.findFirst({
      where: { id: input.orderId, ...locDonNhanTien() },
      select: { id: true, code: true, centerId: true },
    });
    if (!don) {
      return {
        ok: false as const,
        error: "Đơn này không nhận tiền được (nháp / đã huỷ / đã hoàn / đã xoá)",
      };
    }

    // ── VIỆC 6 · a1 — GIAO DỊCH KẾ TOÁN ĐÃ BÁC CHO CHÍNH ĐƠN NÀY: chỉ kế toán gắn lại được. ───────────────────────────────────────────────────────────────────────
    // Đứng ở ĐÂY có chủ ý: (i) SAU mọi từ chối về trạng thái giao dịch / đơn — giao dịch đã MATCHED thì sale nghe "đã được gắn rồi" (đúng và mới hơn), không nghe một
    // câu bác đã cũ; (ii) TRƯỚC bước chia và TRƯỚC phép ghi đầu tiên (`return` trong callback `$transaction` KHÔNG rollback — luật rollback ở CLAUDE.md); (iii) DƯỚI khoá
    // đơn + khoá dòng giao dịch, bằng `tx` của chính lượt này: bên GHI vết bác (`tuChoiSaiMa`) cùng tuần tự trên `khoaDonTrongTx` của đơn nên lượt đọc này không bao giờ
    // thấy một vết bác nửa vời, và vết bác commit giữa lúc sale bấm với lúc nắm được khoá thì lượt này vẫn thấy (ca `[GTB-DB-07]`).
    // Kiểm ĐÚNG giao dịch đang gắn (`has(txn.id)`), không "đơn từng có vết bác" — đơn đã bác X vẫn nhận Z. Đơn KHÁC không bị ảnh hưởng: hàm đọc khoá theo đơn của lời gọi.
    // Đọc lỗi (ném) ⇒ lượt gắn ném theo ⇒ rollback: cổng KHÔNG nuốt lỗi thành "cho qua".
    if (input.nguoiGan.loai === "KHAC") {
      const daBiBac = await input.nguoiGan.docGiaoDichDaBiBac(tx, input.orderId);
      if (daBiBac.giaoDich.has(txn.id)) {
        return { ok: false as const, error: CAU_GAN_TAY_DA_BI_BAC };
      }
    }

    const dotDeChia = dungDotDeChia(so);
    const kiem = kiemChiaTheoCon({
      soTienGiaoDich: txn.amount,
      dong: input.dong,
      dot: dotDeChia,
      tranCon: so.con.map((c) => ({ orderItemId: c.orderItemId, ten: c.ten, conNo: c.conNo })),
    });
    if (!kiem.ok) return { ok: false as const, error: kiem.loi };

    // Đợt nào của con nào — cần cho `Payment.orderItemId`, tức cho công nợ theo con.
    const dotTheoId = new Map(dotDeChia.map((d) => [d.id, d]));

    // ─────────────────────────────────────────────────────────────────────────
    // ĐƠN CŨ · ĐƠN MỘT CON — nâng đợt `orderItemId = NULL` lên đúng bé đó.
    //
    // Đơn trước 16/09 có đợt không thuộc bé nào. Đơn ấy mà chỉ có MỘT dòng hàng thì tiền
    // không thể của ai khác, nên không có gì để đoán: lúc gắn tiền là lúc thích hợp nhất để
    // đóng luôn khoảng trống dữ liệu.
    //
    // ⚠️ Nâng cả `PaymentRequest` chứ không chỉ `Payment`: để đợt ở NULL trong khi tiền của
    // nó đã ghi tên bé là hai màn nói hai chuyện — `con[].dotDangMo` không nhận đợt đó, nên
    // nó ở lại khối "Đợt chung (chưa chia con)" mãi, dù chẳng còn gì chưa chia.
    //
    // ⚠️ VÀ CÓ MỘT CA KHÔNG NÂNG ĐƯỢC: khoá duy nhất từng phần
    // `(orderItemId, installmentNo) WHERE NOT NULL` sẽ đụng nếu bé đó ĐÃ có đợt cùng số.
    // Ca đó thì chỉ ghi `Payment.orderItemId` (tiền vẫn về đúng bé) và để đợt nguyên NULL —
    // thà một màn hiện thừa một dòng còn hơn transaction ném và cả lượt gắn rollback.
    const dongCuaDon = await tx.orderItem.findMany({
      where: { orderId: input.orderId },
      select: { id: true },
      take: 2,
    });
    const conDuyNhat = dongCuaDon.length === 1 ? (dongCuaDon[0]?.id ?? null) : null;
    /** Đợt NULL → bé nào, sau khi đã nâng (hoặc chỉ suy ra được cho phần tiền). */
    const conSuyRa = new Map<string, string>();
    if (conDuyNhat) {
      for (const d of kiem.dong) {
        const dot = dotTheoId.get(d.paymentRequestId);
        if (!dot || dot.orderItemId != null) continue;
        conSuyRa.set(d.paymentRequestId, conDuyNhat);
        const dungSo = await tx.paymentRequest.count({
          where: { orderItemId: conDuyNhat, installmentNo: dot.installmentNo },
        });
        if (dungSo === 0) {
          await tx.paymentRequest.update({
            where: { id: d.paymentRequestId },
            data: { orderItemId: conDuyNhat },
          });
        }
      }
    }

    for (const d of kiem.dong) {
      await tx.paymentAllocation.create({
        data: {
          bankTransactionId: txn.id,
          paymentRequestId: d.paymentRequestId,
          amount: d.soTien,
          centerId: don.centerId,
        },
      });
    }

    // Trạng thái đợt (PENDING → PARTIAL → PAID) và "đơn đã đủ tiền chưa" tính LẠI từ phân bổ,
    // không set tay — dùng chung đúng hàm mà webhook dùng.
    const { settled } = await recomputeRequestStatuses(tx, input.orderId);

    // Ledger-A: một dòng `Payment` cho MỖI CON, không phải mỗi đợt — công nợ đọc theo con,
    // và gộp đợt của cùng một bé lại thì sổ vẫn đúng mà ít dòng hơn để đối chiếu.
    const congTheoCon = new Map<string, number>();
    for (const d of kiem.dong) {
      const dot = dotTheoId.get(d.paymentRequestId);
      // Đợt NULL của đơn MỘT con ⇒ tiền vẫn ghi tên bé đó (xem khối "ĐƠN CŨ" ở trên).
      const khoa = dot?.orderItemId ?? conSuyRa.get(d.paymentRequestId) ?? "";
      congTheoCon.set(khoa, (congTheoCon.get(khoa) ?? 0) + d.soTien);
    }

    // `enrollmentId` lấy THẲNG từ dòng hàng: khi đã biết đợt của con nào thì không còn phải
    // đoán như đường webhook (xem `chonGhiDanhChoKhoan`) — dòng hàng trỏ đúng một ghi danh.
    const dongHang = await tx.orderItem.findMany({
      where: { id: { in: [...congTheoCon.keys()].filter((k) => k !== "") } },
      select: { id: true, enrollmentId: true },
    });
    const ghiDanhTheoDong = new Map(dongHang.map((d) => [d.id, d.enrollmentId]));

    const marker = markerGanTay(txn.id);
    for (const [orderItemId, soTien] of congTheoCon) {
      await tx.payment.create({
        data: {
          orderId: input.orderId,
          orderItemId: orderItemId === "" ? null : orderItemId,
          enrollmentId: orderItemId === "" ? null : (ghiDanhTheoDong.get(orderItemId) ?? null),
          amount: soTien,
          method: txn.provider.toLowerCase(),
          // Chỉ nguồn CARD_POS đổi (giờ quẹt thẻ, Q-C 29/09); chuyển khoản vẫn là lúc gắn.
          paidDate: ngayThuCuaGiaoDich(txn, new Date()),
          note: `Gắn tay giao dịch ${txn.provider} ${txn.providerTxnId} ${marker}`,
          saleStatus: "RECORDED",
          // PENDING: người gắn là sale, và sale ghi nhận ≠ kế toán xác nhận. Đặt CONFIRMED ở
          // đây là cho sale tự đóng công nợ, tức bỏ hẳn trục kế toán.
          accountantStatus: "PENDING",
          centerId: don.centerId,
        },
      });
    }

    await tx.bankTransaction.update({
      where: { id: txn.id },
      data: { status: "MATCHED", unmatchedNote: null, centerId: txn.centerId ?? don.centerId },
    });

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "BankTransaction",
      entityId: txn.id,
      action: "TXN_CHIA_THEO_CON",
      newValues: {
        orderId: don.id,
        orderCode: don.code,
        tong: kiem.tong,
        dong: kiem.dong.map((d) => ({
          paymentRequestId: d.paymentRequestId,
          orderItemId:
            dotTheoId.get(d.paymentRequestId)?.orderItemId ??
            conSuyRa.get(d.paymentRequestId) ??
            null,
          soTien: d.soTien,
        })),
      },
      orgUnitId: don.centerId,
    });

    return { ok: true as const, daChia: kiem.tong, soDong: kiem.dong.length, daDuTien: settled };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · GẮN MỘT KHOẢN ĐÃ THU VÀO MỘT BÉ  ("đường B")
//
// ⚠️ VÌ SAO PHẢI CÓ ĐƯỜNG NÀY, VÀ NÓ KHÁC `ganTienTheoCon` CHỖ NÀO
//
// `ganTienTheoCon` (mục 3) đi từ một `BankTransaction` đang `UNMATCHED`: nó TẠO ra các dòng
// `Payment` mới, mỗi bé một dòng. Đó là đường cho tiền ĐANG VÀO.
//
// Nhưng tiền ĐÃ VÀO thì không đi qua đó được. Đo trên prod 18/09/2026, đơn
// `ORD-260917-000001`: 4 dòng `Payment` (`method = sepay`, `PENDING`) mang `orderItemId = NULL`
// — người vận hành nhập tay để khớp với số phụ huynh đã chuyển, nên **không có
// `BankTransaction` nào phía sau**. `ganTienTheoCon` đòi `bankTransactionId` và từ chối giao
// dịch `MATCHED`, nên cả hai cửa đều đóng: 4.836.000đ nằm trong DB mà không đường nào —
// giao diện hay script — gắn được cho bé nào.
//
// Đường B lấp đúng chỗ đó: **không tạo tiền, không đụng tiền, chỉ điền một cột đang trống.**
//
// ─────────────────────────────────────────────────────────────────────────────
// GIỚI HẠN — NÓI THẲNG, KHÔNG LÀM NỬA VỜI
//
// **MỘT khoản gắn cho ĐÚNG MỘT bé.** Không tách một khoản ra cho hai bé.
//
// Vì sao không làm: tách khoản nghĩa là sửa `amount` của dòng gốc rồi đẻ dòng mới — mà "không
// đụng `amount`" chính là điều làm cho đường này an toàn và kiểm được. Một lệnh vừa chia tiền
// vừa điền cột là một lệnh phải chứng minh nhiều thứ hơn hẳn, và nó sẽ nằm cùng chỗ với đường
// tạo bút toán chứ không nằm ở đây.
//
// ⚠️ **[ĐẢO 20/09/2026 — xem MỤC 6 cuối tệp.]** Ngày ấy đã tới: `ORD-260918-000001` có MỘT
// khoản 9.530.000đ cho hai bé. `tachKhoanChoCon` là "đợt riêng" mà đoạn dưới hẹn, và nó KHÔNG
// sửa `amount` của dòng nào — nó đảo dòng gốc rồi đẻ n dòng mới, đúng khuôn mục 5.
//
// Đoạn dưới GIỮ NGUYÊN vì lý lẽ của nó vẫn đúng cho CHÍNH hàm này: `ganKhoanDaThuChoCon`
// không bao giờ được chia tiền.
//
// Thực tế chưa cần: 4 khoản của `ORD-260917-000001` vốn đã là bốn lần chuyển riêng
// (1.188.000 · 1.230.000 · 1.188.000 · 1.230.000), gắn mỗi khoản cho một bé là đủ. Ngày nào
// gặp một khoản thật sự phải xé đôi thì đó là một đợt riêng, và câu trả lời hôm nay là
// **"chưa hỗ trợ"** chứ không phải một nút gắn được một nửa.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gắn một `Payment` ĐÃ CÓ vào một dòng hàng (một bé) của CHÍNH đơn đó.
 *
 * ⚠️ CHỈ ghi cột `orderItemId`. Không `amount`, không `accountantStatus`, không `saleStatus`,
 * không `enrollmentId`, không `paidDate`, không `deletedAt`. Đó là toàn bộ lý do lệnh này an
 * toàn — và là thứ ca `[GKC-*]` + lưới mã nguồn canh.
 *
 * Bốn cổng, TẤT CẢ đứng TRƯỚC phép ghi đầu tiên (luật rollback — CLAUDE.md mục 7):
 *   1. khoản phải thuộc CHÍNH đơn này và chưa xoá mềm;
 *   2. khoản phải đang TRỐNG (`orderItemId IS NULL`) — đã gắn rồi thì bỏ gắn trước, để một
 *      lượt bấm nhầm không âm thầm chuyển tiền từ bé này sang bé kia;
 *   3. dòng hàng phải thuộc CHÍNH đơn này — chặn gắn tiền của đơn A cho con của đơn B;
 *   4. khoản không được ở trạng thái `REJECTED` — kế toán đã từ chối thì nó không phải tiền,
 *      gắn cho một bé là làm công nợ bé ấy giảm bằng một khoản không tồn tại.
 */
export async function ganKhoanDaThuChoCon(input: {
  orderId: string;
  paymentId: string;
  orderItemId: string;
  actor: AuditActor;
}): Promise<KetQuaGhi<{ soTien: number; tenCon: string }>> {
  return ghiTienChoDon(input.orderId, async (tx, so) => {
    const con = so.con.find((c) => c.orderItemId === input.orderItemId);
    // CỔNG 3 — dòng hàng phải thuộc đơn này. `so.con` dựng từ `OrderItem` CỦA ĐƠN NÀY, nên
    // không tìm thấy nghĩa là dòng hàng thuộc đơn khác (hoặc không tồn tại).
    if (!con) return { ok: false as const, error: "Dòng hàng không thuộc đơn này" };

    const khoan = await tx.payment.findFirst({
      where: { id: input.paymentId, orderId: input.orderId, deletedAt: null },
      select: { id: true, amount: true, orderItemId: true, accountantStatus: true },
    });
    // CỔNG 1 — câu tra đã khoá cả `orderId` lẫn `deletedAt`, nên `null` gộp hai ca: không có
    // khoản ấy, hoặc nó thuộc đơn khác. Câu chữ cố ý không phân biệt — biết một khoản tồn tại
    // ở đơn khác đã là một mẩu thông tin không nên rò.
    if (!khoan) return { ok: false as const, error: "Không tìm thấy khoản thu của đơn này" };

    // CỔNG 2
    if (khoan.orderItemId !== null) {
      return {
        ok: false as const,
        error: "Khoản này đã gắn cho một bé rồi — bỏ gắn trước nếu muốn đổi",
      };
    }
    // CỔNG 4
    if (khoan.accountantStatus === "REJECTED") {
      return {
        ok: false as const,
        error: "Kế toán đã từ chối khoản này — không gắn cho bé nào được",
      };
    }

    // ⚠️ `updateMany` + `orderItemId: null` TRONG `where`, KHÔNG phải `update` theo id. Hai
    // người cùng bấm thì người vào sau đổi 0 dòng và ta từ chối, thay vì đè lên lựa chọn của
    // người trước. `count === 0` ở đây là ghi có điều kiện đổi 0 dòng — commit vô hại, đúng
    // ngoại lệ hợp lệ của luật rollback.
    const upd = await tx.payment.updateMany({
      where: { id: khoan.id, orderId: input.orderId, orderItemId: null, deletedAt: null },
      data: { orderItemId: input.orderItemId },
    });
    // ⚠️ MỘT DÒNG, đúng khuôn ngoại lệ của luật rollback (CLAUDE.md mục 7) — và lưới
    // `cong-truoc-phep-ghi.test.ts` nhận diện khuôn ấy theo HÌNH DẠNG `if (x.count === 0)
    // return`. Viết thành khối `{ … }` là lưới báo "từ chối sau phép ghi" (đã xảy ra, 18/09).
    // Sửa mã cho khớp khuôn, ĐỪNG nới lưới: ngoại lệ mà nới ra thì có ngày nuốt một ca thật.
    if (upd.count === 0) return { ok: false as const, error: "Khoản vừa được gắn — tải lại trang" };

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: "KHOAN_GAN_CHO_CON",
      changedFields: ["orderItemId"],
      oldValues: { paymentId: khoan.id, orderItemId: null },
      newValues: {
        paymentId: khoan.id,
        orderItemId: input.orderItemId,
        ten: con.ten,
        soTien: khoan.amount,
      },
      reason: `Gắn khoản đã thu ${khoan.amount} cho ${con.ten}`,
    });

    return { ok: true as const, soTien: khoan.amount, tenCon: con.ten };
  });
}

/**
 * BỎ GẮN — đưa `Payment.orderItemId` về `NULL`. Quyền kế toán (`payments:manage`).
 *
 * ⚠️ KHÁC `goGanTheoCon` (mục 5) và cố ý không dùng lại nó: `goGanTheoCon` gỡ cả một
 * `BankTransaction` — nó xoá `PaymentAllocation`, sinh bút toán ĐẢO, và đẩy giao dịch về
 * `UNMATCHED`. Ở đây **không có giao dịch nào**, cũng không có phân bổ nào; tiền vẫn nằm
 * nguyên trong đơn. Việc duy nhất phải hoàn là **một cột**.
 *
 * Gọi `goGanTheoCon` cho ca này sẽ tạo một bút toán đảo cho khoản tiền KHÔNG hề bị gỡ khỏi
 * đơn ⇒ công nợ đơn tụt đi một lần nữa. Hai việc nghe giống nhau, hậu quả ngược nhau.
 *
 * `lyDo` BẮT BUỘC và không rỗng: đây là đường sửa một quyết định của người khác, nên nó phải
 * để lại câu trả lời cho "vì sao".
 */
export async function boGanKhoanKhoiCon(input: {
  orderId: string;
  paymentId: string;
  lyDo: string;
  actor: AuditActor;
}): Promise<KetQuaGhi<{ soTien: number }>> {
  return ghiTienChoDon(input.orderId, async (tx) => {
    if (!input.lyDo.trim()) return { ok: false as const, error: "Phải ghi lý do bỏ gắn" };

    const khoan = await tx.payment.findFirst({
      where: { id: input.paymentId, orderId: input.orderId, deletedAt: null },
      select: { id: true, amount: true, orderItemId: true },
    });
    if (!khoan) return { ok: false as const, error: "Không tìm thấy khoản thu của đơn này" };
    if (khoan.orderItemId === null) {
      return { ok: false as const, error: "Khoản này chưa gắn cho bé nào" };
    }

    const upd = await tx.payment.updateMany({
      where: { id: khoan.id, orderId: input.orderId, orderItemId: khoan.orderItemId },
      data: { orderItemId: null },
    });
    if (upd.count === 0) return { ok: false as const, error: "Khoản vừa đổi — tải lại trang" };

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: "KHOAN_BO_GAN_CON",
      changedFields: ["orderItemId"],
      oldValues: { paymentId: khoan.id, orderItemId: khoan.orderItemId },
      newValues: { paymentId: khoan.id, orderItemId: null },
      reason: input.lyDo.trim(),
    });

    return { ok: true as const, soTien: khoan.amount };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · GỠ GẮN GIAO DỊCH NGÂN HÀNG — BÚT TOÁN ĐẢO, KHÔNG XOÁ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gỡ một giao dịch đã gắn: giao dịch về UNMATCHED, nợ con quay lại.
 *
 * ⚠️ HAI BẢNG, HAI CÁCH XỬ LÝ KHÁC NHAU, và đó không phải sự thiếu nhất quán:
 *
 *  · `PaymentAllocation` bị **XOÁ**. Nó là DÂY NỐI "giao dịch này rót vào đợt kia", không phải
 *    bút toán. Gắn nhầm thì dây nối ấy là một câu sai, và giữ lại một câu sai kèm một câu đính
 *    chính là bắt mọi đường đọc sau này phải biết luật cộng-trừ. Hơn nữa nó KHÔNG BIỂU DIỄN
 *    ĐƯỢC: `@@unique([bankTransactionId, paymentRequestId])` chặn dòng thứ hai cho cùng cặp,
 *    nên "phân bổ âm" là thứ lược đồ không cho phép.
 *
 *  · `Payment` thì **GIỮ NGUYÊN + thêm bút toán đảo** (`paymentType: ADJUSTMENT`,
 *    `adjustmentOfId` trỏ dòng gốc, `amount` âm). Đây là sổ tiền, và repo đã chốt luật *"lưu
 *    DELTA, dòng gốc bất biến"* cho mọi phép sửa. Bút toán đảo mang ĐÚNG `accountantStatus`
 *    của dòng gốc — trái dấu mà khác trục thì tổng của trục kia không về 0, tức công nợ hiển
 *    thị vẫn tụt dù tiền đã gỡ.
 *
 * Hai việc đi kèm, CÙNG transaction, mỗi việc MỘT lời gọi sang tệp riêng [30/09/2026]:
 *
 *  · PHIẾU GỘP mà giao dịch này đã trả ⇒ MỞ LẠI (mã cũ thu lại đúng số còn phải thu), hoặc
 *    ĐÓNG khi không mở lại được — `phieuGopSauGoGanTrongTx` (`lib/finance/phieu-gop-go-gan.ts`).
 *    Giao dịch THẺ POS thì LUÔN ĐÓNG, không bao giờ mở lại (Q-M, chủ dự án chốt 30/09/2026).
 *    Trước đó phiếu ở lại PAID: khách chuyển lại đúng mã, đúng số thì bị từ chối "ĐÃ THU ĐỦ".
 *  · Giao dịch THẺ POS mà gốc đã biết bị hủy/hoàn ⇒ ra khỏi hàng chờ NGAY (IGNORED) thay vì
 *    UNMATCHED đủ số gộp — `giaoDichPosSauGoGanTrongTx` (`lib/payments/pos/go-gan-pos.ts`).
 *    Trạng thái cuối trả ở `trangThaiGiaoDich`: người gọi KHÔNG được mặc định "về hàng chờ".
 */
export async function goGanTheoCon(input: {
  bankTransactionId: string;
  orderId: string;
  lyDo: string;
  actor: AuditActor;
}): Promise<
  KetQuaGhi<{
    soDongDao: number;
    tienDao: number;
    trangThaiGiaoDich: SauGoGanPos["trangThai"];
    phieuGop: PhieuSauGoGan[];
  }>
> {
  return ghiTienChoDon(input.orderId, async (tx) => {
    // Khoá DÒNG giao dịch (sau khoá đơn — cùng thứ tự `thuTheoPhieuGop`/`ganTienTheoCon`, không
    // khoá chéo). Import thẻ POS không lấy khoá đơn; nó đọc lại giao dịch gốc DƯỚI khoá dòng này
    // sau khi ghi dòng hủy (`nhap-lo-pos.ts`), nên lượt gỡ và lượt import luôn thấy nhau: gỡ đọc
    // "dòng hủy đã có chưa" (`giaoDichPosSauGoGanTrongTx`) trong khoá — ca đua `[V3-40]`.
    await khoaGiaoDichTrongTx(tx, input.bankTransactionId);
    const txn = await tx.bankTransaction.findUnique({
      where: { id: input.bankTransactionId },
      select: {
        id: true,
        status: true,
        amount: true,
        centerId: true,
        // Cần cho marker ĐỜI CŨ `[auto:<provider>:<txnId>]` — xem `markerWebhook`.
        provider: true,
        providerTxnId: true,
      },
    });
    if (!txn) return { ok: false as const, error: "Không tìm thấy giao dịch" };
    if (txn.status !== "MATCHED") {
      return {
        ok: false as const,
        error: `Giao dịch đang ở trạng thái ${txn.status} — không có gì để gỡ`,
      };
    }

    // ẢNH CHỤP ĐỦ trước khi xoá — chủ dự án chốt 17/09.
    //
    // ⚠️ `PaymentAllocation` bị XOÁ thật, nên sau lượt gỡ thì DB không còn bằng chứng nào về
    // việc "tiền này từng rót vào đợt kia". Thiếu một cột trong ảnh chụp là cột đó mất VĨNH
    // VIỄN — không có đường dựng lại. Vì thế chụp cả `createdAt` (rót lúc nào) và
    // `orderItemId` của phiếu (rót cho bé nào): hai thứ không suy ra được từ phần còn lại.
    const phanBo = await tx.paymentAllocation.findMany({
      where: { bankTransactionId: txn.id },
      select: {
        id: true,
        bankTransactionId: true,
        paymentRequestId: true,
        amount: true,
        roundingWaived: true,
        centerId: true,
        createdAt: true,
        paymentRequest: {
          select: {
            orderId: true,
            orderItemId: true,
            installmentNo: true,
            amountDue: true,
            status: true,
          },
        },
      },
    });
    if (phanBo.length === 0) {
      return { ok: false as const, error: "Giao dịch này không có phân bổ nào" };
    }
    // Không cho gỡ chéo đơn: khoá đang giữ là khoá của MỘT đơn, nên đụng vào đơn khác là
    // đụng ngoài phạm vi khoá.
    if (phanBo.some((p) => p.paymentRequest.orderId !== input.orderId)) {
      return { ok: false as const, error: "Giao dịch này rót vào đơn khác — mở đúng đơn đó để gỡ" };
    }

    // NGƯỜI GẮN: `PaymentAllocation` không có cột actor, nên dấu vết ấy chỉ còn trong nhật ký
    // của lượt GẮN. Tra ngược ngay đây để ảnh chụp tự đủ — người đọc nhật ký gỡ không phải đi
    // tìm tiếp một bản ghi khác mới biết ai đã gắn.
    const vetGan = await tx.auditLog.findFirst({
      where: { entityType: "BankTransaction", entityId: txn.id, action: "TXN_CHIA_THEO_CON" },
      orderBy: { createdAt: "desc" },
      select: { actorId: true, actorName: true, createdAt: true },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TÌM DÒNG GỐC — HAI HỌ MARKER, và bỏ sót họ thứ hai là một lỗ TIỀN
    //
    // ⚠️ Bản đầu chỉ tìm `[gan-tay:…]`. Nhưng gỡ gắn KHÔNG nằm sau công tắc, nên ngay khi merge
    // nó chạy được trên MỌI phân bổ đang có trên prod — mà phân bổ trên prod hôm nay đều do
    // WEBHOOK sinh, và chúng mang marker `[auto:<provider>:<txnId>]`.
    //
    // Hậu quả của bản đầu, nếu để nguyên: kế toán bấm "Gỡ gắn" một giao dịch đời cũ ⇒
    // `PaymentAllocation` bị xoá, `Payment` KHÔNG có bút toán đảo nào (vì không tìm thấy dòng
    // gốc) ⇒ giao dịch về hàng chờ trong khi công nợ vẫn báo ĐÃ ĐÓNG. Hai sổ nói hai chuyện,
    // và không lỗi nào báo.
    const markerTay = markerGanTay(txn.id);
    const markerCu = markerWebhook(txn.provider, txn.providerTxnId);
    const goc = await tx.payment.findMany({
      where: {
        orderId: input.orderId,
        deletedAt: null,
        paymentType: "PAYMENT",
        OR: [{ note: { contains: markerTay } }, { note: { contains: markerCu } }],
      },
      select: {
        id: true,
        amount: true,
        orderItemId: true,
        enrollmentId: true,
        method: true,
        centerId: true,
        accountantStatus: true,
        saleStatus: true,
        note: true,
        receipts: {
          where: { status: "ACTIVE", deletedAt: null },
          select: { id: true, code: true },
        },
      },
    });

    // ⚠️ CHẶN khi khoản đã XUẤT PHIẾU THU — không gỡ nửa vời.
    //
    // `Receipt` là chứng từ ĐÃ GIAO cho phụ huynh, và `Receipt.paymentId` mang `onDelete:
    // Restrict`. Đảo tiền trong khi tờ phiếu vẫn đứng là để lại một chứng từ nói rằng khoản
    // này đã thu, cho một khoản vừa bị gỡ. Bút toán đảo chữa được SỔ, nó không chữa được tờ
    // giấy đang nằm trong tay khách.
    //
    // KHÔNG chặn chỉ vì khoản có `enrollmentId`: bút toán đảo mang đúng `enrollmentId` đó và
    // trái dấu, nên tổng theo ghi danh về 0 — học bạ và công nợ ghi danh không lệch. Thứ lệch
    // được là tờ phiếu thu, và đó là thứ ca này canh.
    const daXuatPhieu = goc.filter((g) => g.receipts.length > 0);
    if (daXuatPhieu.length > 0) {
      const ma = daXuatPhieu.flatMap((g) => g.receipts.map((r) => r.code)).join(", ");
      return {
        ok: false as const,
        error:
          `Khoản thu của giao dịch này đã xuất phiếu thu (${ma}) — không gỡ được. ` +
          `Kế toán phải huỷ hoặc hoàn phiếu thu đó trước, rồi mới gỡ.`,
      };
    }

    // CHẶN khi khoản đã nằm trong hoá đơn (docs/ke-toan-hoa-don/PLAN.md §5) — luôn chạy, không
    // hỏi cờ. Gỡ gắn là đảo tiền của dòng gốc; tờ hoá đơn đã chụp đúng số đó.
    const khoaHd = await khoanDaKhoaHoaDon(tx, goc.map((g) => g.id));
    if (khoaHd.length > 0) return { ok: false as const, error: thongDiepKhoaHoaDon(khoaHd) };

    // ⚠️⚠️ MỌI CỔNG TỪ CHỐI PHẢI NẰM TRÊN DÒNG NÀY.
    //
    // Trong Prisma, `return` từ callback của `$transaction` **KHÔNG rollback** — chỉ `throw`
    // mới rollback. Một cổng `return { ok: false }` đặt SAU một phép ghi là: phép ghi ấy
    // ĐƯỢC COMMIT, còn người dùng nhận thông báo từ chối.
    //
    // Đã đo, không phải phòng xa: bản đầu đặt cổng "đã xuất phiếu thu" sau `deleteMany`.
    // Ca `[GDC-c2]` bắt được — giao dịch báo "không gỡ được" trong khi phân bổ đã xoá sạch.
    // Tức chính cái cổng sinh ra để chặn gỡ nửa vời lại TẠO RA một lượt gỡ nửa vời.
    await tx.paymentAllocation.deleteMany({ where: { bankTransactionId: txn.id } });
    await recomputeRequestStatuses(tx, input.orderId);

    // Trạng thái đợt SAU khi gỡ — ghi vào nhật ký làm bằng chứng "nợ con đã quay lại".
    // KHÔNG tự suy ra PENDING: `deriveStatus` mới là nơi quyết, và một đợt còn tiền của giao
    // dịch KHÁC thì phải là PARTIAL.
    const dotSau = await tx.paymentRequest.findMany({
      where: { id: { in: phanBo.map((x) => x.paymentRequestId) } },
      select: { id: true, installmentNo: true, status: true, orderItemId: true },
    });

    let tienDao = 0;
    let soDongDao = 0;
    const idButToanDao: string[] = [];
    /** `note` của đúng các khoản đảo Ở LƯỢT NÀY — nhãn "Phiếu gộp <mã>" nói phiếu nào vừa mất tiền. */
    const ghiChuVuaDao: string[] = [];
    for (const g of goc) {
      // Đã có bút toán đảo cho dòng này rồi thì thôi — gỡ hai lần không được trừ hai lần.
      const daDao = await tx.payment.count({
        where: { adjustmentOfId: g.id, paymentType: "ADJUSTMENT", deletedAt: null },
      });
      if (daDao > 0) continue;
      ghiChuVuaDao.push(g.note ?? "");
      const dao = await tx.payment.create({
        select: { id: true },
        data: {
          orderId: input.orderId,
          orderItemId: g.orderItemId,
          enrollmentId: g.enrollmentId,
          amount: -g.amount,
          method: g.method,
          paidDate: new Date(),
          note: `Đảo bút toán ${markerTay} — ${input.lyDo}`,
          paymentType: "ADJUSTMENT",
          adjustmentOfId: g.id,
          saleStatus: g.saleStatus,
          accountantStatus: g.accountantStatus,
          centerId: g.centerId,
        },
      });
      idButToanDao.push(dao.id);
      tienDao += g.amount;
      soDongDao += 1;
    }

    // TIỀN DƯ của giao dịch — chốt 29/09/2026.
    //
    // `allocateToOrder` ghi phần dư sang `CreditBalance` gắn `bankTransactionId`. Để nguyên thì
    // gắn lại cùng giao dịch là ghi tiền dư LẦN HAI (ca `[GGL-05b]`: 400.000 thay vì 200.000).
    // ĐÁNH DẤU "đã xử lý — do gỡ gắn": KHÔNG xoá (dòng là chứng cứ tiền từng dư), KHÔNG ghi dòng
    // âm (bảng này không phải sổ cộng dồn — mọi chỗ đọc hỏi `settledAt`, xem `tien-thua.ts`).
    // Chỉ dòng CHƯA xử lý: dòng kế toán đã xử lý tay giữ nguyên người + lý do của họ.
    const tienDu = await tx.creditBalance.findMany({
      where: { bankTransactionId: txn.id, ...TIEN_THUA_CHUA_XU_LY },
      select: { id: true, amount: true },
    });
    if (tienDu.length > 0) {
      await tx.creditBalance.updateMany({
        where: { id: { in: tienDu.map((c) => c.id) }, ...TIEN_THUA_CHUA_XU_LY },
        data: {
          settledAt: new Date(),
          settledById: input.actor.id,
          settledReason: lyDoTienThuaDoGoGan(txn.id, input.lyDo),
        },
      });
    }

    const ghiChuGo = `${TIEN_TO_GO_GAN}${input.lyDo}`;
    await tx.bankTransaction.update({
      where: { id: txn.id },
      data: { status: "UNMATCHED", unmatchedNote: ghiChuGo },
    });
    // Giao dịch thẻ POS mà gốc đã biết bị hủy/hoàn ⇒ IGNORED ngay. Luật thẻ ở tệp riêng — ở đây
    // chỉ MỘT lời gọi, và nó phải đứng SAU câu ghi UNMATCHED ngay trên (lưới `[GGP-W1]`).
    const sauGoPos = await giaoDichPosSauGoGanTrongTx(tx, {
      bankTransactionId: txn.id,
      provider: txn.provider,
      ghiChuGoGan: ghiChuGo,
    });

    // Phiếu gộp giao dịch này đã trả ⇒ mở lại / đóng. SAU `deleteMany` ở trên: số còn phải thu
    // của phiếu đọc phân bổ SỐNG. Khoá đơn đang giữ ⇒ không đường tạo/đổi phiếu nào chen vào.
    // Rà vòng 4: đứng SAU helper thẻ để biết tín hiệu hủy/hoàn — thẻ đã hoàn MỘT PHẦN thì KHÔNG mở
    // lại phiếu đòi trọn số gộp (`[PNS-11]`, lưới `[PGG-W1]`). Q-M (30/09/2026): nguồn THẺ thì
    // KHÔNG BAO GIỜ mở lại — nguồn do helper thẻ nói ra, đường chung chỉ chuyển tiếp.
    const phieuGop = await phieuGopSauGoGanTrongTx(tx, {
      orderId: input.orderId,
      dotVuaGo: phanBo.map((p) => p.paymentRequestId),
      // Rà vòng 6 — số tiền của chính các phân bổ vừa xoá: phiếu OPEN chỉ đóng khi lượt gỡ làm nó đòi THÊM.
      phanBoVuaXoa: phanBo,
      ghiChuVuaDao,
      lyDoGo: input.lyDo,
      actor: input.actor,
      tinHieuThe: sauGoPos.tinHieu,
      nguon: sauGoPos.nguon,
    });

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "BankTransaction",
      entityId: txn.id,
      action: "TXN_GO_GAN",
      oldValues: {
        orderId: input.orderId,
        // Ảnh chụp ĐỦ — xem khối chú thích ở chỗ tra `phanBo`.
        phanBo: phanBo.map((p) => ({
          id: p.id,
          bankTransactionId: p.bankTransactionId,
          paymentRequestId: p.paymentRequestId,
          orderItemId: p.paymentRequest.orderItemId,
          installmentNo: p.paymentRequest.installmentNo,
          amount: p.amount,
          roundingWaived: p.roundingWaived,
          centerId: p.centerId,
          createdAt: p.createdAt.toISOString(),
        })),
        nguoiGan: vetGan
          ? {
              actorId: vetGan.actorId,
              actorName: vetGan.actorName,
              luc: vetGan.createdAt.toISOString(),
            }
          : null,
      },
      newValues: {
        // Trạng thái CUỐI (UNMATCHED, hoặc IGNORED khi thẻ đã bị hủy/hoàn) — không gõ cứng.
        status: sauGoPos.trangThai,
        tinHieuThe: sauGoPos.tinHieu,
        soDongDao,
        tienDao,
        idButToanDao,
        tienDuDaDanhDau: tienDu.map((c) => ({ id: c.id, amount: c.amount })),
        trangThaiDotSauGo: dotSau.map((d) => ({
          paymentRequestId: d.id,
          installmentNo: d.installmentNo,
          orderItemId: d.orderItemId,
          status: d.status,
        })),
        phieuGop: phieuGop.map((p) => ({ billId: p.billId, ma: p.ma, hanhDong: p.hanhDong, conPhaiThu: p.conPhaiThu })),
      },
      reason: input.lyDo,
      orgUnitId: txn.centerId,
    });

    return { ok: true as const, soDongDao, tienDao, trangThaiGiaoDich: sauGoPos.trangThai, phieuGop };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · TÁCH MỘT KHOẢN ĐÃ THU CHO NHIỀU CON  ("đường B", phần chia)
//
// ⚠️ MỤC 4 NGAY TRÊN TỪNG NÓI "CHƯA HỖ TRỢ" — MỤC NÀY LÀ CÂU TRẢ LỜI, chốt 20/09/2026.
//
// Ca thật: `ORD-260918-000001` có MỘT khoản 9.530.000đ (`PENDING`, chưa gắn bé) trong khi
// đơn có hai bé (8.976.000đ + 10.032.000đ). Phụ huynh chuyển một lần cho cả hai con — tức
// ca CHÍNH của module, không phải ca biên.
//
// ─────────────────────────────────────────────────────────────────────────────
// CÁCH GHI: DÒNG GỐC NGUYÊN VẸN + BÚT TOÁN ĐẢO + n DÒNG MỚI
//
//     gốc   +9.530.000  orderItemId = NULL   (KHÔNG đụng tới)
//     đảo   −9.530.000  orderItemId = NULL   adjustmentOfId = gốc
//     phần        +X    orderItemId = bé A
//     phần        +Y    orderItemId = bé B     (X + Y = 9.530.000, ĐÚNG BẰNG)
//                       ─────────────────────
//     mọi phép cộng      +9.530.000   (y như trước khi tách)
//
// ⚠️ X và Y để ngỏ CÓ CHỦ ĐÍCH. Hai nửa học phí của đơn này là 4.488.000 + 5.016.000 =
// 9.504.000, tức **chênh 26.000đ** so với khoản thật — và chủ dự án chốt 20/09/2026 rằng
// khoản chênh ấy *"là tiền thật chưa ai giải thích được"*, nên **hệ thống không được tự dồn
// nó vào một bé**. Cổng chỉ từ chối và nói còn thiếu bao nhiêu; người vận hành đi hỏi.
//
// Ba cách đã cân, và hai cách kia THUA vì lý do cụ thể:
//
//  · **Sửa `amount` của dòng gốc rồi đẻ n−1 dòng** — vi phạm thẳng luật của repo: *"lưu
//    DELTA, dòng gốc bất biến"* (mục 5 ngay trên đánh vần nguyên văn). Dòng gốc là thứ nhật
//    ký, phiếu thu và đối soát trỏ vào; sửa số tiền của nó là đổi lời khai đã ký.
//
//  · **Xoá mềm dòng gốc rồi đẻ n dòng** — `deletedAt` trên `Payment` nghĩa là *"khoản này
//    không phải tiền"*. Nhưng tiền NÀY có thật và vẫn nằm trong đơn; chỉ có cách ghi tên chủ
//    của nó là đổi. Mượn `deletedAt` cho việc đó là nói dối mọi đường đọc về sau.
//
// Cách đang dùng là ĐÚNG CÁI KHUÔN `goGanTheoCon` (mục 5) đã dùng để gỡ tiền, nên nó không
// phải cơ chế mới — chỉ là cùng một cơ chế cho một việc khác.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO PHẢI LÀ n DÒNG `Payment` RIÊNG, KHÔNG PHẢI MỘT DÒNG + BẢNG PHỤ
//
// Chủ dự án yêu cầu: *"kế toán xác nhận/từ chối sau đó phải áp đúng từng phần."*
//
// `confirmPayment` / `rejectPayment` (`lib/finance/payment.ts`) làm việc theo **`paymentId`**,
// và `confirmPayment` phát MỘT `Receipt` cho mỗi `Payment`. Nên "xác nhận phần của bé A, từ
// chối phần của bé B" CHỈ biểu diễn được khi hai phần là hai dòng `Payment`. Mọi thiết kế
// giữ một dòng + một bảng phụ đều buộc phải viết lại trục kế toán — và đó là trục đang nuôi
// phiếu thu, học bạ, sự kiện `payment.confirmed`.
//
// Hệ quả trực tiếp: sau khi tách, **mỗi bé có phiếu thu riêng** — đúng thứ phụ huynh cần.
//
// ─────────────────────────────────────────────────────────────────────────────
// `note` PHẢI CHÉP SANG — ĐÂY LÀ DÂY NỐI SANG SỔ NGÂN HÀNG, KHÔNG PHẢI TRANG TRÍ
//
// ⚠️ `Payment` **KHÔNG có cột `bankTransactionId`** (kiểm `prisma/schema.prisma`). Dây duy
// nhất nối một khoản với giao dịch ngân hàng là MARKER trong `note`:
// `[gan-tay:<txnId>]` hoặc `[auto:<provider>:<providerTxnId>]` — xem `markerGanTay` /
// `markerWebhook`. `goGanTheoCon` tìm dòng gốc BẰNG CHÍNH marker ấy.
//
// Nên nếu các phần không chép `note` sang: bấm "Gỡ gắn" giao dịch ⇒ `PaymentAllocation` bị
// xoá (Ledger-B mất dấu) mà các phần KHÔNG có bút toán đảo nào (Ledger-A vẫn tính là đã thu)
// ⇒ giao dịch về hàng chờ trong khi công nợ vẫn báo đã đóng. Đúng con "gỡ NỬA VỜI" mà mục 5
// viết hẳn một khối chú thích để chặn. Ca `[TKD-09]` canh điều này bằng cách gỡ THẬT.
//
// ⚠️ Và cặp gốc/đảo KHÔNG bị `goGanTheoCon` đảo thêm lần nữa: nó bỏ qua dòng đã có bút toán
// đảo (`daDao > 0 → continue`) và chỉ lấy `paymentType: "PAYMENT"`. Nghĩa là gỡ sau khi tách
// đảo ĐÚNG n phần — tổng vẫn khớp. Đó là may mắn có căn cứ, nên `[TKD-09]` ghim lại.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOÀN TÁC: **KHÔNG CÓ**, và nói thẳng
//
// Không có nút "gộp lại". Sau khi tách, n phần là những khoản BÌNH THƯỜNG — kế toán có thể
// đã xác nhận, đã từ chối, đã phát phiếu thu cho một trong số chúng. Một lệnh "gộp lại" phải
// suy xét đủ mọi tổ hợp ấy, và nó sẽ sai vào ngày gặp tổ hợp không ai nghĩ tới.
//
// ĐƯỜNG SỬA khi tách nhầm số: **bỏ gắn từng phần** (`boGanKhoanKhoiCon`, quyền
// `payments:manage`, bắt buộc ghi lý do) rồi **gắn / tách lại**. Tổng tiền không đổi ở bất
// kỳ bước nào và mọi bước đều có nhật ký.
//
// ⚠️ Cái KHÔNG lấy lại được: sau khi bỏ gắn cả n phần, khối "chưa gắn cho con nào" hiện **n
// dòng** chứ không phải một dòng gốc 9.530.000đ như lúc đầu. Dòng gốc ở lại vĩnh viễn trong
// trạng thái đã-đảo. Đó là cái sẹo của một cuốn sổ, và nó đúng là thứ cuốn sổ sinh ra để giữ.
// ─────────────────────────────────────────────────────────────────────────────

/** Marker trong `Payment.note` để tìm lại đúng n phần do MỘT lần tách sinh ra. */
export const markerTach = (paymentId: string) => `[tach:${paymentId}]`;

/**
 * Tách một `Payment` chưa gắn bé thành n phần, mỗi phần cho một bé của CHÍNH đơn đó.
 *
 * Bảy cổng, TẤT CẢ đứng TRƯỚC phép ghi đầu tiên (luật rollback — CLAUDE.md mục 7):
 *   1. khoản thuộc CHÍNH đơn này và chưa xoá mềm;
 *   2. khoản đang TRỐNG (`orderItemId IS NULL`) — đã gắn rồi thì bỏ gắn trước;
 *   3. khoản là bút toán THU (`paymentType = PAYMENT`), không phải điều chỉnh;
 *   4. khoản CHƯA bị đảo — tách hai lần là đẻ tiền;
 *   5. kế toán CHƯA xử lý (`accountantStatus = PENDING`);
 *   6. khoản chưa phát phiếu thu nào còn hiệu lực;
 *   7. phép chia hợp lệ (`kiemTachKhoan`: ≥2 bé · Σ đúng bằng · mỗi phần ≤ `conCoTheNhan`).
 *
 * ⚠️ KHÔNG gọi `recomputeRequestStatuses`: phép tách chỉ động vào **Ledger-A** (`Payment`).
 * `PaymentRequest` và `PaymentAllocation` không đổi một dòng nào, nên trạng thái đợt cũng
 * không có gì để tính lại. Gọi thừa ở đây thì vô hại hôm nay, nhưng nó nói SAI rằng lệnh này
 * chạm Ledger-B.
 */
export async function tachKhoanChoCon(input: {
  orderId: string;
  paymentId: string;
  phan: readonly PhanTach[];
  actor: AuditActor;
}): Promise<KetQuaGhi<{ soTien: number; soPhan: number; tenCon: string[] }>> {
  return ghiTienChoDon(input.orderId, async (tx, so) => {
    const khoan = await tx.payment.findFirst({
      where: { id: input.paymentId, orderId: input.orderId, deletedAt: null },
      select: {
        id: true,
        amount: true,
        orderItemId: true,
        accountantStatus: true,
        saleStatus: true,
        paymentType: true,
        method: true,
        paidDate: true,
        evidenceUrl: true,
        note: true,
        centerId: true,
        enrollmentId: true,
        recordedById: true,
        receipts: { where: { status: "ACTIVE", deletedAt: null }, select: { code: true } },
      },
    });
    // CỔNG 1 — câu tra khoá cả `orderId` lẫn `deletedAt`; `null` gộp "không có" với "của đơn
    // khác", cố ý không phân biệt (biết một khoản tồn tại ở đơn khác đã là một mẩu rò rỉ).
    if (!khoan) return { ok: false as const, error: "Không tìm thấy khoản thu của đơn này" };

    // CỔNG HOÁ ĐƠN (PLAN §5) — tách là đảo dòng gốc + đẻ n dòng mới; tờ hoá đơn đã chụp dòng gốc.
    const khoaHd = await khoanDaKhoaHoaDon(tx, [khoan.id]);
    if (khoaHd.length > 0) return { ok: false as const, error: thongDiepKhoaHoaDon(khoaHd) };

    // CỔNG 2
    if (khoan.orderItemId !== null) {
      return {
        ok: false as const,
        error: "Khoản này đã gắn cho một bé rồi — bỏ gắn trước nếu muốn tách",
      };
    }
    // CỔNG 3
    if (khoan.paymentType !== "PAYMENT") {
      return { ok: false as const, error: "Bút toán điều chỉnh không tách được" };
    }
    // CỔNG 4 — chống tách hai lần, và chống tách một dòng đã bị gỡ gắn đảo mất.
    const soDao = await tx.payment.count({
      where: { adjustmentOfId: khoan.id, paymentType: "ADJUSTMENT", deletedAt: null },
    });
    if (soDao > 0) {
      return { ok: false as const, error: "Khoản này đã được tách hoặc đã gỡ — tải lại trang" };
    }
    // CỔNG 5 — chỉ tách khoản kế toán CHƯA xử lý.
    //
    // `CONFIRMED` thì đã có phiếu thu đứng tên số tiền gốc; đảo dòng gốc mà tờ phiếu vẫn nằm
    // trong tay phụ huynh là chữa SỔ chứ không chữa được tờ giấy (cùng lý lẽ với cổng "đã
    // xuất phiếu thu" của mục 5). `REJECTED` thì tiền không về, không có gì để chia.
    if (khoan.accountantStatus !== "PENDING") {
      return {
        ok: false as const,
        error:
          `Kế toán đã xử lý khoản này (${khoan.accountantStatus}) — không tách được. ` +
          `Sửa một khoản đã xác nhận phải đi đường điều chỉnh / hoàn của kế toán.`,
      };
    }
    // CỔNG 6 — thắt lưng thêm dây: `PENDING` thì chưa thể có phiếu thu (`issueReceipt` chỉ
    // chạy trong `confirmPayment`), nhưng kiểm bằng DỮ LIỆU thay vì tin vào suy luận. Cột này
    // đi kèm câu tra ở trên nên không tốn thêm một vòng nào.
    if (khoan.receipts.length > 0) {
      const ma = khoan.receipts.map((r) => r.code).join(", ");
      return {
        ok: false as const,
        error: `Khoản này đã phát phiếu thu (${ma}) — kế toán phải huỷ/hoàn phiếu trước`,
      };
    }

    // CỔNG 7 — phép chia. Trần lấy `conCoTheNhan` (tập RỘNG), KHÔNG phải `conNo` (trục A):
    // lý do đầy đủ ở đầu `lib/finance/tach-khoan.ts`.
    const kiem = kiemTachKhoan({
      soTienKhoan: khoan.amount,
      phan: input.phan,
      tranCon: so.con.map((c) => ({
        orderItemId: c.orderItemId,
        ten: c.ten,
        conCoTheNhan: c.conCoTheNhan,
        daVe: c.daVe,
      })),
    });
    if (!kiem.ok) return { ok: false as const, error: kiem.loi };

    // ── HẾT CỔNG. Từ đây trở xuống là phép ghi. ──────────────────────────────

    const marker = markerTach(khoan.id);

    // 1 · BÚT TOÁN ĐẢO cho dòng gốc. Mang ĐÚNG `enrollmentId` + `accountantStatus` của gốc —
    // trái dấu mà khác trục thì tổng của trục kia không về 0 (bài học ở mục 5).
    const dao = await tx.payment.create({
      select: { id: true },
      data: {
        orderId: input.orderId,
        orderItemId: null,
        enrollmentId: khoan.enrollmentId,
        amount: -khoan.amount,
        method: khoan.method,
        paidDate: new Date(),
        // ⚠️ KHÔNG chép `note` của gốc vào đây: nó mang marker ngân hàng, và một dòng mang
        // marker là một dòng `goGanTheoCon` sẽ đi tìm. Dòng này đã được che bởi bộ lọc
        // `paymentType: "PAYMENT"` của hàm ấy, nhưng đừng dựa vào một lớp khi có thể không
        // tạo ra vấn đề ngay từ đầu.
        note: `Đảo để tách khoản cho ${kiem.phan.length} bé ${marker}`,
        paymentType: "ADJUSTMENT",
        adjustmentOfId: khoan.id,
        saleStatus: khoan.saleStatus,
        accountantStatus: khoan.accountantStatus,
        centerId: khoan.centerId,
      },
    });

    // `enrollmentId` suy từ DÒNG HÀNG, không chép từ gốc — giống `ganTienTheoCon`. Khi đã
    // biết tiền của bé nào thì dòng hàng trỏ đúng một ghi danh; chép `enrollmentId` của một
    // dòng VỐN chưa thuộc bé nào là gắn phần của bé A vào ghi danh của bé B.
    //
    // Và đây là thứ làm cho "kế toán xác nhận từng phần" chạy được THẬT: `confirmPayment` TỪ
    // CHỐI khoản không có `enrollmentId` ("Khoản chưa gắn ghi danh, không thể sinh phiếu thu").
    const dongHang = await tx.orderItem.findMany({
      where: { id: { in: kiem.phan.map((p) => p.orderItemId) } },
      select: { id: true, enrollmentId: true },
    });
    const ghiDanhTheoDong = new Map(dongHang.map((d) => [d.id, d.enrollmentId]));

    const idPhan: string[] = [];
    for (const p of kiem.phan) {
      const moi = await tx.payment.create({
        select: { id: true },
        data: {
          orderId: input.orderId,
          orderItemId: p.orderItemId,
          enrollmentId: ghiDanhTheoDong.get(p.orderItemId) ?? null,
          amount: p.soTien,
          // Dấu vết của gốc theo sang TỪNG phần — chủ dự án chốt. `note` là BẮT BUỘC chứ
          // không phải tuỳ nghi: nó chở marker ngân hàng (khối chú thích đầu mục).
          method: khoan.method,
          paidDate: khoan.paidDate,
          evidenceUrl: khoan.evidenceUrl,
          note: `${khoan.note ?? ""} ${marker}`.trim(),
          recordedById: khoan.recordedById,
          saleStatus: khoan.saleStatus,
          accountantStatus: khoan.accountantStatus,
          centerId: khoan.centerId,
        },
      });
      idPhan.push(moi.id);
    }

    const tenTheoDong = new Map(so.con.map((c) => [c.orderItemId, c.ten]));
    const tenCon = kiem.phan.map((p) => tenTheoDong.get(p.orderItemId) ?? "");

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: "KHOAN_TACH_CHO_CON",
      oldValues: {
        paymentId: khoan.id,
        amount: khoan.amount,
        orderItemId: null,
        accountantStatus: khoan.accountantStatus,
      },
      newValues: {
        butToanDaoId: dao.id,
        phan: kiem.phan.map((p, i) => ({
          paymentId: idPhan[i],
          orderItemId: p.orderItemId,
          ten: tenCon[i],
          soTien: p.soTien,
        })),
      },
      reason: `Tách khoản ${khoan.amount} cho ${kiem.phan.length} bé`,
      orgUnitId: khoan.centerId,
    });

    return { ok: true as const, soTien: kiem.tong, soPhan: kiem.phan.length, tenCon };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 7 · CHUYỂN TIỀN GIỮA HAI CON CỦA CÙNG MỘT ĐƠN
//
// Sinh ra ở PHIÊN D [21/09/2026] cho bước "phân hết khoản dư" của lượt dừng học. PHIÊN F1
// sẽ mở cùng phép này thành một thao tác đứng riêng — nên nó viết ở đây, tx-level, chứ
// không giấu trong `dung-hoc-con.ts`.
//
// ─────────────────────────────────────────────────────────────────────────────
// HAI DÒNG, CÙNG MỘT MÃ NGHIỆP VỤ
//
//     −X  orderItemId = bé CHO    paymentType ADJUSTMENT   note …[chuyen:<id>]
//     +X  orderItemId = bé NHẬN   paymentType PAYMENT      note …[chuyen:<id>]
//                                 ─────────────────────────
//     tổng tiền của ĐƠN            không đổi một đồng
//
// ⚠️ CHỈ chuyển phần `CONFIRMED` (chủ dự án chốt). Khoản kế toán chưa xác nhận có thể bị
// TỪ CHỐI, và lúc đó ta đã chuyển sang bé khác một số tiền chưa bao giờ về — bé nhận hết
// nợ bằng tiền không tồn tại. Cổng ấy nằm ở tầng gọi (số `du` tính từ trục A), ở đây chỉ
// ghi cho đúng: **cả hai dòng mang `accountantStatus: "CONFIRMED"`**.
//
// ⚠️ Dòng −X **KHÔNG** set `adjustmentOfId`. `adjustmentOfId` nghĩa là "đảo ĐÚNG dòng thu
// kia"; phần dư ở đây có thể gom từ nhiều khoản thu khác nhau, nên trỏ vào một dòng bất kỳ
// là một lời khai sai. Hệ quả có lợi kèm theo: `docSoTheoCon` tính `daBiDao` từ
// `adjustmentOfId`, nên không dòng thu nào bị đánh dấu "đã đảo" oan và mất nút trên màn.
//
// ⚠️ Dòng +X là `PAYMENT`, không phải `ADJUSTMENT`. Nó phải trông như một khoản thu bình
// thường của bé nhận để kế toán xuất phiếu thu được (`confirmPayment` phát `Receipt` theo
// `Payment`), và để màn đơn hiển thị nó trong khối của bé ấy.

/** Marker trong `Payment.note` để tìm lại đúng cặp dòng do MỘT lượt chuyển sinh ra. */
export const markerChuyen = (id: string) => `[chuyen:${id}]`;

export type PhanChuyen = { orderItemId: string; soTien: number };

/**
 * Ghi cặp bút toán chuyển tiền từ một bé sang n bé khác của CÙNG đơn.
 *
 * ⚠️ Gọi BÊN TRONG `ghiTienChoDon` (transaction đang giữ khoá của đơn). Hàm này KHÔNG tự
 * lấy khoá và KHÔNG kiểm trần — người gọi đã kiểm bằng `kiemPhanDu`, và kiểm lại ở đây
 * bằng một con số đọc lại sẽ là hai cổng cho cùng một luật, tức hai cổng sẵn sàng lệch.
 */
export async function chuyenTienGiuaConTrongTx(
  tx: Tx,
  input: {
    orderId: string;
    /** Bé CHO tiền — dòng `−X` ghi tên bé này. */
    tuOrderItemId: string;
    phan: readonly PhanChuyen[];
    centerId: string | null;
    /** Câu giải trình đi vào `note` của cả hai dòng và vào nhật ký. */
    lyDo: string;
    /** Mã nghiệp vụ dùng chung cho cả lượt — thường là `OrderItem.id` của bé cho. */
    maNghiepVu: string;
  },
): Promise<{ tong: number; idDong: string[] }> {
  const marker = markerChuyen(input.maNghiepVu);
  const tong = input.phan.reduce((s, p) => s + Math.round(p.soTien), 0);
  const idDong: string[] = [];

  // `enrollmentId` suy từ DÒNG HÀNG, không chép từ đâu khác — cùng lý lẽ với
  // `tachKhoanChoCon` (mục 6): dòng hàng trỏ đúng một ghi danh, và `confirmPayment` TỪ CHỐI
  // khoản không có `enrollmentId` ("không thể sinh phiếu thu").
  const dongHang = await tx.orderItem.findMany({
    where: { id: { in: [input.tuOrderItemId, ...input.phan.map((p) => p.orderItemId)] } },
    select: { id: true, enrollmentId: true },
  });
  const ghiDanhTheoDong = new Map(dongHang.map((d) => [d.id, d.enrollmentId]));

  const raKhoi = await tx.payment.create({
    select: { id: true },
    data: {
      orderId: input.orderId,
      orderItemId: input.tuOrderItemId,
      enrollmentId: ghiDanhTheoDong.get(input.tuOrderItemId) ?? null,
      amount: -tong,
      method: "chuyen-noi-bo",
      paidDate: new Date(),
      note: `Chuyển cho bé khác cùng đơn — ${input.lyDo} ${marker}`,
      paymentType: "ADJUSTMENT",
      saleStatus: "RECORDED",
      accountantStatus: "CONFIRMED",
      centerId: input.centerId,
    },
  });
  idDong.push(raKhoi.id);

  for (const p of input.phan) {
    const vao = await tx.payment.create({
      select: { id: true },
      data: {
        orderId: input.orderId,
        orderItemId: p.orderItemId,
        enrollmentId: ghiDanhTheoDong.get(p.orderItemId) ?? null,
        amount: Math.round(p.soTien),
        method: "chuyen-noi-bo",
        paidDate: new Date(),
        note: `Nhận từ bé khác cùng đơn — ${input.lyDo} ${marker}`,
        saleStatus: "RECORDED",
        accountantStatus: "CONFIRMED",
        centerId: input.centerId,
      },
    });
    idDong.push(vao.id);
  }

  return { tong, idDong };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8 · CHUYỂN TIỀN GIỮA HAI CON — THAO TÁC ĐỨNG RIÊNG  [PHIÊN F1 · 22/09/2026]
//
// Mục 7 (`chuyenTienGiuaConTrongTx`) là phép GHI, sinh ra cho bước "phân hết khoản dư"
// của lượt dừng học. Mục này mở đúng phép ấy thành thao tác dùng được BẤT KỲ LÚC NÀO —
// ca thật: phụ huynh chuyển một khoản, sale gắn nhầm cho bé A, phát hiện ra sau.
//
// ⚠️ KHÔNG dùng lại `boGanKhoanKhoiCon` + `ganKhoanDaThuChoCon` cho việc này, dù nghe
// tương đương. Ba lý do, mỗi cái đều đủ:
//   · "bỏ gắn rồi gắn lại" chỉ chuyển được TRỌN một khoản; ca thật thường là chuyển MỘT
//     PHẦN (phụ huynh đóng chung 9.530.000đ, chia nhầm 6/3.5 thay vì 5/4.5);
//   · nó đi qua hai lượt ghi rời, nên có một khoảnh khắc tiền không thuộc bé nào — và
//     nếu lượt hai hỏng thì nó ở lại đó;
//   · nhật ký ra hai dòng không liên quan, thay vì một cặp −/+ mang chung mã nghiệp vụ.
// ─────────────────────────────────────────────────────────────────────────────

export async function chuyenTienGiuaCon(input: {
  orderId: string;
  tuOrderItemId: string;
  denOrderItemId: string;
  soTien: number;
  lyDo: string;
  centerId: string | null;
  actor: AuditActor;
}): Promise<KetQuaGhi<{ soTien: number; tenCho: string; tenNhan: string }>> {
  return ghiTienChoDon(input.orderId, async (tx, so) => {
    // Cổng 1 — giải trình BẮT BUỘC. Đây là đường sửa một quyết định đã ghi vào sổ tiền,
    // nên nó phải để lại câu trả lời cho "vì sao" (cùng luật với `boGanKhoanKhoiCon`).
    if (!input.lyDo.trim()) {
      return { ok: false as const, error: "Phải ghi lý do chuyển tiền giữa hai bé" };
    }

    // Cổng 2 — phép kiểm THUẦN, ăn con số đọc TRONG transaction đang giữ khoá đơn.
    const kiem = kiemChuyenTien({
      tuOrderItemId: input.tuOrderItemId,
      denOrderItemId: input.denOrderItemId,
      soTien: input.soTien,
      con: so.con.map((c) => ({
        orderItemId: c.orderItemId,
        ten: c.ten,
        daThu: c.daThu,
        conNo: c.conNo,
      })),
    });
    if (!kiem.ok) return { ok: false as const, error: kiem.loi };

    // ── HẾT CỔNG. Từ đây là phép ghi. ────────────────────────────────────────

    const kq = await chuyenTienGiuaConTrongTx(tx, {
      orderId: input.orderId,
      tuOrderItemId: input.tuOrderItemId,
      phan: [{ orderItemId: input.denOrderItemId, soTien: kiem.soTien }],
      centerId: input.centerId,
      lyDo: input.lyDo.trim(),
      // Mã nghiệp vụ theo LƯỢT, không theo bé: hai lượt chuyển khác nhau giữa cùng cặp bé
      // phải phân biệt được trong nhật ký. `cuid()` của dòng đầu tiên là thứ sẵn có và duy
      // nhất; dùng `orderItemId` như mục 7 thì mọi lượt trùng marker.
      maNghiepVu: `${input.tuOrderItemId}-${Date.now()}`,
    });

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: "CHUYEN_TIEN_GIUA_CON",
      oldValues: {
        tuOrderItemId: input.tuOrderItemId,
        tenCho: kiem.tenCho,
        daThuTruoc: so.con.find((c) => c.orderItemId === input.tuOrderItemId)?.daThu ?? 0,
        denOrderItemId: input.denOrderItemId,
        tenNhan: kiem.tenNhan,
        conNoNhanTruoc: so.con.find((c) => c.orderItemId === input.denOrderItemId)?.conNo ?? 0,
      },
      newValues: { soTien: kiem.soTien, idDong: kq.idDong },
      reason: input.lyDo.trim(),
      orgUnitId: input.centerId,
    });

    return {
      ok: true as const,
      soTien: kiem.soTien,
      tenCho: kiem.tenCho,
      tenNhan: kiem.tenNhan,
    };
  });
}
