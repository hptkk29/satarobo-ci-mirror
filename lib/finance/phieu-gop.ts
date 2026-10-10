import "server-only";
// lib/finance/phieu-gop.ts — PHIẾU GỘP: phát hành, huỷ/đóng, và rót tiền về theo phiếu.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN C · Chủ dự án chốt 20/09/2026
//
//   *"Sale tick các đợt đang mở (1 hoặc nhiều con) → 'In QR'. QR in sẵn TỔNG tiền và từng
//   dòng. Webhook: khớp mã phiếu OPEN VÀ số tiền = đúng còn phải thu của phiếu → tạo Payment
//   cho TỪNG con đúng số từng dòng. Mọi ca khác → KHÔNG phân bổ, về UNMATCHED."*
//
// Đây là bước làm cho tiền vào ĐÚNG CON tự động — hết cảnh sale gắn tay từng khoản.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHẦN THUẦN ĐÃ CÓ SẴN TỪ US-10, TỆP NÀY CHỈ NỐI DÂY
//
//   `lib/payments/ma-phieu.ts`       bảng chữ 27 · checksum Damm · `sinhMa(soThuTu)`
//   `lib/payments/cap-phat-ma.ts`    sequence + hoán vị  [mới, PHIÊN C]
//   `lib/payments/memo-ck.ts`        `dungMemo` (phát) · `docMemo` (đọc, cửa sổ trượt)
//   `lib/payments/khop-giao-dich.ts` `khopGiaoDich` — ba bậc
//   `lib/payments/chia-phieu-gop.ts` `conPhaiThuCuaPhieu` · `chiaTheoPhieuGop` — ăn cả hoặc
//                                    không ăn gì
//
// ⚠️ Trước PHIÊN C, năm mô-đun trên có **0 đường gọi** trong mã chạy thật (`grep` ra đúng các
// tệp test của chính chúng). Chúng đúng, có test, và hoàn toàn vô dụng — vì không ai gọi.
// Đó là lý do phiên này là "nối dây" chứ không phải "xây mới": phần khó đã xong từ 16/09.
//
// ─────────────────────────────────────────────────────────────────────────────
// BA BẤT BIẾN, VÀ CẢ BA ĐỀU DO DB GÁC — KHÔNG PHẢI DO MÃ NÀY
//
//   B7  mỗi đơn tối đa MỘT phiếu OPEN  → `PaymentBill_orderId_open_key` (partial unique)
//   ·   mã phiếu không trùng           → `PaymentBill_matchKey_key`
//   ·   một đợt không nằm hai lần trong cùng phiếu → `PaymentBillLine_billId_paymentRequestId_key`
//
// Kiểm ở tầng mã ("đếm rồi mới ghi") KHÔNG chặn được hai lượt bấm đồng thời: cả hai cùng đọc
// thấy 0, cả hai cùng ghi. Nên ở đây ta ghi rồi BẮT lỗi unique và dịch nó sang tiếng Việt —
// chứ không đếm trước rồi yên tâm.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { capPhatMaPhieu } from "@/lib/payments/cap-phat-ma";
import {
  chiaTheoPhieuGop,
  conPhaiThuCuaPhieu,
  type DongPhieuGop,
  type PhieuGopDeChia,
} from "@/lib/payments/chia-phieu-gop";
import { khopGiaoDich, type PhieuUngVien } from "@/lib/payments/khop-giao-dich";
import { docMemo } from "@/lib/payments/memo-ck";
import { locDonNhanTien } from "@/lib/payments/don-nhan-tien";
import { recomputeRequestStatuses } from "@/lib/payments/payment-request";
import { publishEvent } from "@/lib/events/publish";
import {
  khoaDonTrongTx,
  khoaGiaoDichTrongTx,
  conDongThuGiuTien,
  type KetQuaGhi,
} from "./ghi-tien-don";
import { nhanPhieuGop } from "./phieu-gop-go-gan";
import { khepPhieuMo0dTrongTx } from "./khep-phieu-0d-db";

type Tx = Prisma.TransactionClient;

// ⚠️ VÌ SAO `db.$transaction` + `khoaDonTrongTx` CHỨ KHÔNG PHẢI `ghiTienChoDon`
//
// `ghiTienChoDon` gói sẵn "khoá đơn + đọc lại CÔNG NỢ THEO CON trong khoá". Vế thứ hai là thứ
// mọi lệnh của nó cần — còn ba lệnh ở tệp này thì KHÔNG: phiếu gộp làm việc theo ĐỢT
// (`PaymentRequest`), không theo con, và `orderItemId` lấy thẳng từ đợt. Gọi nó ở đây là thêm
// một câu tra `docSoTheoCon` (4 bảng) cho mỗi lượt phát phiếu và mỗi giao dịch webhook, để
// dùng đúng 0 trường của kết quả.
//
// Thứ BẮT BUỘC dùng chung thì vẫn dùng chung: `khoaDonTrongTx` — nơi DUY NHẤT đánh vần chuỗi
// khoá của đơn. Khoá khác chuỗi là webhook và màn gắn tay giẫm lên nhau trong khi đọc mã chỗ
// nào cũng thấy "có khoá".

/** Trạng thái phiếu thu được coi là ĐANG MỞ — tức được đưa vào một phiếu gộp. */
const DOT_DANG_MO = ["PENDING", "PARTIAL"] as const;

/** Số lần thử lại khi mã vừa cấp đụng `@unique`. */
const SO_LAN_THU_MA = 5;

/**
 * Từ chối SAU khi đã có phép ghi trong callback `$transaction` — phải NÉM, không `return`.
 *
 * ⚠️ Luật rollback (CLAUDE.md mục 7): `return` trong callback KHÔNG rollback. Bản đầu của
 * `taoPhieuGop` trả `{ ok: false }` từ trong khối `catch` của `tx.paymentBill.create` — và
 * lưới `cong-truoc-phep-ghi.test.ts` đỏ đúng chỗ đó. Nó đúng, vì hai lẽ:
 *
 *   · hình dạng ấy là hình dạng của một lượt "ghi rồi mới từ chối", và lưới không thể (và
 *     không nên) đoán rằng phép ghi này vừa NÉM nên chưa ghi được gì;
 *   · Postgres đã đánh dấu transaction là FAILED khi câu lệnh ném, nên `return` bình thường
 *     ở đó là mời Prisma đi COMMIT một transaction đã hỏng.
 *
 * Nên: ném lỗi này ở trong, bắt và dịch ở ngoài. Đúng khuôn `StockError` mà CLAUDE.md nêu.
 */
class LoiPhatPhieu extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiPhatPhieu";
  }
}

/**
 * Phiếu gộp đổi trạng thái GIỮA lúc lượt thu đã qua mọi cổng (ảnh chụp: OPEN, đợt còn sống) và lúc
 * nó đặt PAID. Rà vòng 5 (30/09/2026): nhánh này từng bị bỏ qua im lặng — tiền đã rót vào đợt, giao
 * dịch MATCHED, `Payment` ghi vào một đơn vừa bị huỷ. Mọi đường VOID đợt nay giữ khoá đơn nên nhánh
 * không còn đường sinh bình thường; khi vẫn xảy ra thì NÉM (rollback cả lượt rót) và chạy lại MỘT
 * lần — lượt sau đọc trạng thái mới dưới khoá và ra kết luận đúng (thường là CHUA_CHIA).
 */
class LoiPhieuDoiGiuaChung extends Error {
  constructor(billId: string) {
    super(`Phiếu (bill) ${billId} vừa đổi trạng thái giữa lượt thu — không rót, chạy lại`);
    this.name = "LoiPhieuDoiGiuaChung";
  }
}

function laLoiTrungKhoa(err: unknown, tenChiMuc: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;
  const t = e.meta?.target;
  const s = Array.isArray(t) ? t.join(",") : String(t ?? "");
  return s.includes(tenChiMuc);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 · PHÁT HÀNH PHIẾU GỘP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tạo một phiếu gộp từ các đợt ĐANG MỞ mà sale tick.
 *
 * Cổng, TẤT CẢ đứng TRƯỚC phép ghi đầu tiên (luật rollback — CLAUDE.md mục 7):
 *   1. có ít nhất một đợt;
 *   2. không có đợt nào lặp lại trong danh sách gửi lên;
 *   3. đơn NHẬN ĐƯỢC TIỀN (`locDonNhanTien`) — phiếu cho đơn nháp/đã huỷ là một QR chết;
 *   4. mọi đợt thuộc CHÍNH đơn này;
 *   5. mọi đợt đang `PENDING`/`PARTIAL`;
 *   6. tổng còn phải thu > 0 — một phiếu 0đ thì QR không in được số nào.
 *
 * Bất biến B7 (một đơn một phiếu OPEN) do **chỉ mục** gác, không do vòng đếm ở đây.
 *
 * ⚠️ `amount` của mỗi dòng là phần **CÒN THIẾU** của đợt tại thời điểm phát, không phải
 * `amountDue`. Đợt `PARTIAL` (đã nhận một phần từ đường khác) mà ghi trọn `amountDue` thì QR
 * đòi cả phần đã trả — đúng con bug mà cổng tạo đợt đã phải vá một lần.
 */
export async function taoPhieuGop(input: {
  orderId: string;
  paymentRequestIds: readonly string[];
  actor: AuditActor;
}): Promise<
  KetQuaGhi<{ billId: string; ma: string; tongTien: number; soDong: number; canhBaoKho: string | null }>
> {
  // ⚠️ `try` bọc NGOÀI `$transaction`: mọi lời từ chối phát sinh SAU phép ghi đầu tiên đi ra
  // bằng `throw` (xem `LoiPhatPhieu`), và chỗ duy nhất dịch nó sang `{ ok: false }` là đây.
  try {
    return await db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, input.orderId);

        const ids = [...new Set(input.paymentRequestIds ?? [])];
      // CỔNG 1 + 2 — `Set` đã gộp trùng; so độ dài để nói thẳng thay vì im lặng gộp hộ.
      if (ids.length === 0) return { ok: false as const, error: "Chưa chọn đợt nào" };
      if (ids.length !== (input.paymentRequestIds ?? []).length) {
        return { ok: false as const, error: "Có đợt bị chọn hai lần — tải lại trang" };
      }

      // CỔNG 3 — cùng một luật với tầng đối khớp tự động. Phát QR cho đơn không nhận tiền là
      // phát một tờ giấy mà webhook sẽ từ chối, và phụ huynh là người phát hiện ra.
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

      const dot = await tx.paymentRequest.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          orderId: true,
          orderItemId: true,
          installmentNo: true,
          amountDue: true,
          status: true,
          sortOrder: true,
          allocations: { select: { amount: true } },
          orderItem: { select: { itemName: true } },
        },
        orderBy: { sortOrder: "asc" },
      });

      // CỔNG 4 — `findMany` bỏ im lặng id không tồn tại, nên so SỐ LƯỢNG mới thấy.
      if (dot.length !== ids.length) {
        return { ok: false as const, error: "Có đợt không tồn tại — tải lại trang" };
      }
      if (dot.some((d) => d.orderId !== input.orderId)) {
        return { ok: false as const, error: "Có đợt không thuộc đơn này — tải lại trang" };
      }
      // CỔNG 5
      const dong = dot.find((d) => !DOT_DANG_MO.includes(d.status as (typeof DOT_DANG_MO)[number]));
      if (dong) {
        return {
          ok: false as const,
          error: `Đợt ${dong.installmentNo} đang ở trạng thái ${dong.status}, không gộp được`,
        };
      }

      const dongPhieu = dot.map((d) => {
        const daRot = d.allocations.reduce((s, a) => s + a.amount, 0);
        return {
          paymentRequestId: d.id,
          sortOrder: d.sortOrder,
          // Phần CÒN THIẾU, không phải `amountDue`. Xem chú thích hàm.
          amount: Math.max(0, d.amountDue - daRot),
          amountDue: d.amountDue,
          daRot,
          tenCon: d.orderItem?.itemName ?? null,
        };
      });
      const tongTien = dongPhieu.reduce((s, d) => s + d.amount, 0);
      // CỔNG 6
      if (tongTien <= 0) {
        return { ok: false as const, error: "Các đợt đã chọn không còn phải thu đồng nào" };
      }

      // ── HẾT CỔNG. Từ đây trở xuống là phép ghi. ──────────────────────────────

      // Phiếu OPEN cũ đã HẾT VIỆC (mọi dòng đủ tiền từ đường khác — gắn tay, mã đời cũ — còn phải
      // thu 0đ) ⇒ khép lại trước để chỉ mục một-phiếu-mở nhường chỗ: đã nhận ⇒ ĐÓNG, chưa ⇒ HUỶ
      // (đúng luật nút tay). Không khép thì phiếu 0đ kẹt OPEN chặn phát phiếu cho CẢ đơn — rà vòng
      // 3, ca `[V3-21]`. Cố ý khép Ở ĐÂY (lúc có người cần chỗ) chứ không tự đặt PAID ngay khi tiền
      // đường khác về: PAID là trạng thái lượt gỡ gắn không đảo lại được (xem `soat-phieu-gop.ts`).
      // Phép khép dùng CHUNG với luật gỡ gắn (rà vòng 4, `khep-phieu-0d-db.ts`, ca `[V3-23]`).
      await khepPhieuMo0dTrongTx(tx, {
        orderId: input.orderId,
        lyDo: "Phiếu cũ đã đủ tiền từ đường khác (còn phải thu 0đ) — khép lại khi phát phiếu mới",
        actor: input.actor,
      });

      let billId: string | null = null;
      let ma = "";
      let canhBaoKho: string | null = null;
      let loiCuoi: unknown = null;

      for (let lan = 0; lan < SO_LAN_THU_MA; lan++) {
        const cap = await capPhatMaPhieu(tx);
        try {
          const bill = await tx.paymentBill.create({
            data: {
              orderId: input.orderId,
              centerId: don.centerId,
              amountDue: tongTien,
              status: "OPEN",
              matchKey: cap.ma,
              lines: {
                create: dongPhieu.map((d) => ({
                  paymentRequestId: d.paymentRequestId,
                  sortOrder: d.sortOrder,
                  amount: d.amount,
                })),
              },
            },
            select: { id: true },
          });
          billId = bill.id;
          ma = cap.ma;
          canhBaoKho = cap.kho.canhBao ? cap.kho.moTa : null;
          break;
        } catch (err) {
          loiCuoi = err;
          // ⚠️ Chỉ thử lại khi đụng đúng chỉ mục MÃ. Đụng `PaymentBill_orderId_open_key` là đơn
          // đã có phiếu OPEN — thử lại bao nhiêu lần cũng đụng, và người dùng cần nghe điều đó
          // chứ không phải đợi năm vòng rồi nhận một câu lỗi khác.
          if (laLoiTrungKhoa(err, "matchKey")) continue;
          if (laLoiTrungKhoa(err, "orderId")) {
            // NÉM, không `return` — xem `LoiPhatPhieu`. Đường gọi ngay dưới bắt và dịch.
            throw new LoiPhatPhieu(
              "Đơn này đã có một phiếu gộp đang mở — huỷ hoặc đóng phiếu đó trước",
            );
          }
          throw err;
        }
      }

      if (billId == null) {
        // Năm lần liên tiếp đụng mã đã tồn tại. Sequence là đơn điệu nên ca này chỉ xảy ra khi
        // ai đó đã reset sequence hoặc chèn mã bằng tay — tức một sự cố vận hành, không phải
        // xui. Ném để nó nổi lên nhật ký thay vì trả một câu lỗi êm ái.
        throw new Error(
          `Không cấp được mã phiếu sau ${SO_LAN_THU_MA} lần thử (đơn ${don.code})`,
          { cause: loiCuoi },
        );
      }

      await writeAudit({
        tx,
        actor: input.actor,
        module: "finance",
        entityType: "Order",
        entityId: input.orderId,
        action: "PHIEU_GOP_CREATED",
        newValues: {
          billId,
          ma,
          tongTien,
          dong: dongPhieu.map((d) => ({
            paymentRequestId: d.paymentRequestId,
            ten: d.tenCon,
            soTien: d.amount,
          })),
        },
        reason: `Phát phiếu gộp ${ma} — ${dongPhieu.length} đợt, ${tongTien}`,
        orgUnitId: don.centerId,
      });

      return {
        ok: true as const,
        billId,
        ma,
        tongTien,
        soDong: dongPhieu.length,
        canhBaoKho,
      };
    });
  } catch (err) {
    // Chỉ dịch lỗi CỦA MÌNH. Mọi lỗi khác (mất kết nối, vi phạm khoá ngoài…) phải nổi lên
    // nhật ký nguyên vẹn — nuốt chúng thành một câu tiếng Việt êm ái là giấu sự cố hạ tầng.
    if (err instanceof LoiPhatPhieu) return { ok: false as const, error: err.message };
    throw err;
  }
}

/**
 * Phiếu gộp ĐANG MỞ của một đơn, kèm đủ số để màn hình vẽ — hoặc `null`.
 *
 * ⚠️ `db` TRẦN, không `scopedDb` — cùng lý lẽ với `noTheoCon`: *"cùng một đơn, ai mở cũng ra
 * cùng con số"*. Cách ly cơ sở đã ép ở CỬA VÀO (trang đơn tra chính cái đơn qua `scopedDb`),
 * nên tới được đây nghĩa là người xem đã được phép đọc đơn này.
 *
 * ⚠️ KHÔNG dựng `qrUrl`/nội dung CK ở đây: cả hai cần tài khoản nhận tiền của cơ sở VÀ cần
 * biết người xem có `orders:view-pii` không. Trang gọi mới biết hai thứ đó.
 */
export async function docPhieuGopDangMo(orderId: string): Promise<{
  billId: string;
  ma: string;
  tongTien: number;
  daNhan: number;
  dong: {
    /** Đợt nào — trang đơn cần nó để biết DÒNG NÀO của bảng phiếu thu đang giữ mã này. */
    paymentRequestId: string;
    installmentNo: number;
    ten: string;
    soTien: number;
  }[];
} | null> {
  const phieu = await db.paymentBill.findFirst({
    // `order: locDonNhanTien()` — rà vòng 5 (luật 12): phiếu OPEN còn sót trên đơn KHÔNG nhận tiền
    // (huỷ trước bản vá, dữ liệu cũ) không phải "phiếu đang mở" với người xem: in QR cho một đơn đã
    // huỷ là mời trả một khoản mà `thuTheoPhieuGop` chắc chắn từ chối. Cùng luật cổng của đường thu.
    where: { orderId, status: "OPEN", order: locDonNhanTien() },
    select: {
      id: true,
      matchKey: true,
      lines: {
        orderBy: { sortOrder: "asc" },
        select: {
          paymentRequestId: true,
          sortOrder: true,
          amount: true,
          paymentRequest: {
            select: {
              amountDue: true,
              installmentNo: true,
              orderItemId: true,
              orderItem: { select: { itemName: true } },
              allocations: { select: { amount: true, roundingWaived: true } },
            },
          },
        },
      },
    },
  });
  if (!phieu || !phieu.matchKey) return null;

  const dongChia = phieu.lines.map((l) => ({
    paymentRequestId: l.paymentRequestId,
    sortOrder: l.sortOrder,
    amount: l.amount,
    amountDue: l.paymentRequest.amountDue,
    daRot: l.paymentRequest.allocations.reduce((s, a) => s + a.amount, 0),
    daTha: l.paymentRequest.allocations.reduce((s, a) => s + a.roundingWaived, 0),
  }));
  const conPhaiThuNay = conPhaiThuCuaPhieu(dongChia);
  // Phiếu OPEN mà còn phải thu 0đ (mọi dòng đủ tiền từ đường khác) KHÔNG phải "phiếu đang mở"
  // với người xem: in một QR 0đ là mời khách chuyển một số mà đường khớp chắc chắn từ chối, và
  // giấu nút phát phiếu cho các đợt khác (luật 12). `taoPhieuGop` tự khép nó khi phát phiếu mới.
  // Giữ OPEN trong DB (không tự PAID): gỡ khoản "đường khác" thì phiếu hiện lại đúng số — rà
  // vòng 3, ca `[V3-20]` `[V3-21]`.
  if (conPhaiThuNay === 0) return null;

  return {
    billId: phieu.id,
    ma: phieu.matchKey,
    // ⚠️ `conPhaiThuCuaPhieu`, KHÔNG phải `PaymentBill.amountDue`. Một dòng của phiếu có thể
    // đã được lấp từ đường khác sau lúc phát, và khi đó QR phải in số NHỎ HƠN. Đây cũng chính
    // là con số mà tiền về phải khớp từng đồng — in số khác là khách nào cũng chuyển sai.
    tongTien: conPhaiThuCuaPhieu(dongChia),
    daNhan: dongChia.reduce((s, d) => s + d.daRot, 0),
    dong: phieu.lines.map((l) => ({
      // 24/09/2026 — thêm hai trường ĐỊNH DANH. Trước đó `dong` chỉ có tên + số tiền, đủ để
      // VẼ phiếu nhưng KHÔNG đủ để trả lời "dòng nào của bảng phiếu thu đang giữ mã này" —
      // câu hỏi mà `trangThaiQrDot` cần để không vẽ một cái nút chắc chắn bị DB từ chối.
      paymentRequestId: l.paymentRequestId,
      installmentNo: l.paymentRequest.installmentNo,
      ten: l.paymentRequest.orderItem?.itemName ?? `Đợt ${l.paymentRequest.installmentNo}`,
      soTien: l.amount,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · HUỶ / ĐÓNG PHIẾU
//
// ⚠️ HAI LỆNH, KHÔNG PHẢI MỘT — và ranh giới là "phiếu đã nhận đồng nào chưa".
//
//   · chưa nhận đồng nào  → **VOID**  (huỷ): phiếu coi như chưa từng tồn tại, phát lại mã mới;
//   · đã nhận một phần    → **CLOSED** (đóng): không phát QR mới cho phiếu này nữa, nhưng
//     phiếu ở lại sổ làm chứng cho phần đã nhận.
//
// ⚠️ **ĐẢO chú thích enum `PaymentBillStatus` [20/09/2026].** `schema.prisma` ghi `CLOSED` là
// *"KHÔNG dùng ở luồng mới … KHÔNG đường ghi nào được đặt nó"* — câu đó đúng cho phần WEBHOOK
// (webhook vẫn ăn cả hoặc không ăn gì, không bao giờ lấp một phần) và **hết đúng** cho phần
// vận hành: tiền có thể vào các đợt của phiếu từ ĐƯỜNG KHÁC (kế toán gắn tay ở biến động số
// dư, hoặc một QR đơn lẻ cũ). Lúc đó phiếu gộp đã nhận một phần mà không phải do nó.
//
// Huỷ phiếu ấy là xoá dấu vết của việc phát hành trong khi tiền đã đi theo nó — nên chủ dự án
// chốt: *"Huỷ phiếu chỉ khi chưa nhận đồng nào; đã nhận một phần → Đóng phiếu."*
// ─────────────────────────────────────────────────────────────────────────────

/** Đọc một phiếu + các dòng, đủ để tính `conPhaiThuCuaPhieu`. */
async function docPhieu(tx: Tx, billId: string) {
  return tx.paymentBill.findUnique({
    where: { id: billId },
    select: {
      id: true,
      orderId: true,
      status: true,
      matchKey: true,
      amountDue: true,
      centerId: true,
      lines: {
        select: {
          paymentRequestId: true,
          sortOrder: true,
          amount: true,
          paymentRequest: {
            select: {
              amountDue: true,
              orderItemId: true,
              // Cổng "đợt đã huỷ" của `thuTheoPhieuGop` (rà vòng 3, ca `[V3-03]`).
              status: true,
              allocations: { select: { amount: true, roundingWaived: true } },
            },
          },
        },
      },
    },
  });
}

type PhieuDaDoc = NonNullable<Awaited<ReturnType<typeof docPhieu>>>;

function dungDongDeChia(phieu: PhieuDaDoc): DongPhieuGop[] {
  return phieu.lines.map((l) => ({
    paymentRequestId: l.paymentRequestId,
    sortOrder: l.sortOrder,
    amount: l.amount,
    amountDue: l.paymentRequest.amountDue,
    daRot: l.paymentRequest.allocations.reduce((s, a) => s + a.amount, 0),
    daTha: l.paymentRequest.allocations.reduce((s, a) => s + a.roundingWaived, 0),
  }));
}

/**
 * Một phiếu gộp + "CÒN PHẢI THU" của nó, đọc TRONG transaction của người gọi [GĐ1 POS · 06/10/2026].
 *
 * Tạo phiếu thu thẻ (`lib/payments/pos/phieu-pos.ts`) đọc số phải thu DƯỚI KHOÁ ĐƠN bằng ĐÚNG
 * phép tính đường thu dùng (`conPhaiThuCuaPhieu(dungDongDeChia(…))`) — "tính ở đúng MỘT chỗ"
 * (`chia-phieu-gop.ts`). Viết lại phép cộng ở tệp POS là cách chắc chắn nhất để số in trên hộp
 * phiếu POS lệch số mà tiền về phải khớp.
 *
 * ⚠️ Người gọi PHẢI đang giữ `khoaDonTrongTx` của đơn chứa phiếu.
 */
export async function docPhieuDeThuTrongTx(
  tx: Tx,
  billId: string,
): Promise<{
  id: string;
  orderId: string;
  status: string;
  matchKey: string | null;
  centerId: string | null;
  conPhaiThu: number;
  paymentRequestIds: string[];
} | null> {
  const phieu = await docPhieu(tx, billId);
  if (!phieu) return null;
  return {
    id: phieu.id,
    orderId: phieu.orderId,
    status: phieu.status,
    matchKey: phieu.matchKey,
    centerId: phieu.centerId,
    conPhaiThu: conPhaiThuCuaPhieu(dungDongDeChia(phieu)),
    paymentRequestIds: phieu.lines.map((l) => l.paymentRequestId),
  };
}

/** Σ đã rót vào các đợt của phiếu — con số quyết định huỷ được hay chỉ đóng được. */
function daNhanCuaPhieu(phieu: PhieuDaDoc): number {
  return phieu.lines.reduce(
    (s, l) => s + l.paymentRequest.allocations.reduce((t, a) => t + a.amount, 0),
    0,
  );
}

async function doiTrangThaiPhieu(
  input: {
    orderId: string;
    billId: string;
    lyDo: string;
    actor: AuditActor;
  },
  dich: "VOID" | "CLOSED",
): Promise<KetQuaGhi<{ daNhan: number }>> {
  return db.$transaction(async (tx) => {
    await khoaDonTrongTx(tx, input.orderId);
    return doiTrangThaiPhieuTrongTx(tx, input, dich);
  });
}

/**
 * Bản chạy TRONG transaction + khoá đơn của người gọi.
 *
 * ⚠️ Tách ra ở PHIÊN D [21/09/2026] vì lượt DỪNG HỌC phải đóng/huỷ phiếu gộp **cùng một
 * transaction** với phép quyết toán. Mở một `$transaction` lồng trong `ghiTienChoDon` là
 * hoặc deadlock trên chính khoá của mình, hoặc — tệ hơn — một phép ghi commit riêng rồi ở
 * lại khi transaction ngoài cuộn ngược.
 *
 * ⚠️ Người gọi PHẢI đã giữ `khoaDonTrongTx(tx, orderId)`. Hàm này KHÔNG tự lấy khoá: lấy
 * lại một advisory lock mình đang giữ thì không lỗi gì (nó tái nhập được), nhưng viết vậy
 * là che mất yêu cầu thật — rằng phép đọc `daNhanCuaPhieu` bên dưới chỉ đúng khi đơn đang
 * bị khoá.
 */
export async function doiTrangThaiPhieuTrongTx(
  tx: Tx,
  input: {
    orderId: string;
    billId: string;
    lyDo: string;
    actor: AuditActor;
  },
  dich: "VOID" | "CLOSED",
): Promise<KetQuaGhi<{ daNhan: number }>> {
  {
    // ── LÝ DO: BẮT BUỘC CHO "ĐÓNG", KHÔNG BẮT BUỘC CHO "HUỶ" [chủ dự án chốt 24/09/2026]
    //
    // *"huỷ phiếu kh cần lý do, chỉ cần xác nhận 1 lần nữa là được"*.
    //
    // ⚠️ Ranh giới KHÔNG tuỳ tiện, nó trùng đúng ranh giới nghiệp vụ đã có ở ngay dưới:
    //   · `VOID`   chỉ xảy ra khi phiếu **chưa nhận đồng nào** (gác ở `daNhan > 0` bên
    //              dưới) ⇒ huỷ là bỏ một tờ giấy chưa ai trả tiền vào. Không có gì để đối
    //              soát, nên bắt ghi lý do chỉ tạo thói quen gõ "x" cho xong — một trường
    //              bắt buộc mà ai cũng gõ bừa thì tệ hơn không có trường.
    //   · `CLOSED` chỉ xảy ra khi phiếu **ĐÃ nhận tiền** ⇒ có tiền thật dừng giữa chừng,
    //              và ba tháng sau kế toán sẽ hỏi vì sao. Lý do GIỮ NGUYÊN bắt buộc.
    //
    // ⚠️ Vẫn ghi `reason` vào `AuditLog` cho cả hai — chỉ là với `VOID` thì nó tự khai
    // "không ghi lý do" thay vì để trống. Một ô `reason` rỗng trong sổ kiểm toán đọc như
    // dữ liệu hỏng; một câu nói rõ "người dùng không phải ghi" thì đọc được.
    if (dich === "CLOSED" && !input.lyDo.trim()) {
      return { ok: false as const, error: "Phải ghi lý do" };
    }

    const phieu = await docPhieu(tx, input.billId);
    if (!phieu || phieu.orderId !== input.orderId) {
      return { ok: false as const, error: "Không tìm thấy phiếu gộp của đơn này" };
    }
    if (phieu.status !== "OPEN") {
      return { ok: false as const, error: `Phiếu đang ở trạng thái ${phieu.status}, không đổi được` };
    }

    const daNhan = daNhanCuaPhieu(phieu);
    if (dich === "VOID" && daNhan > 0) {
      return {
        ok: false as const,
        error:
          `Phiếu này đã nhận ${daNhan.toLocaleString("vi-VN")}đ — không huỷ được. ` +
          `Dùng "Đóng phiếu" để ngừng thu tiếp mà vẫn giữ dấu vết phần đã nhận.`,
      };
    }
    if (dich === "CLOSED" && daNhan === 0) {
      return {
        ok: false as const,
        error: 'Phiếu chưa nhận đồng nào — dùng "Huỷ phiếu" để phát lại mã mới',
      };
    }

    // ⚠️ `updateMany` + `status: "OPEN"` TRONG `where`: hai người cùng bấm thì người vào sau
    // đổi 0 dòng và ta từ chối, thay vì đè lên quyết định của người trước.
    const upd = await tx.paymentBill.updateMany({
      where: { id: phieu.id, status: "OPEN" },
      data: { status: dich },
    });
    if (upd.count === 0) return { ok: false as const, error: "Phiếu vừa đổi — tải lại trang" };

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: dich === "VOID" ? "PHIEU_GOP_VOID" : "PHIEU_GOP_CLOSED",
      oldValues: { billId: phieu.id, ma: phieu.matchKey, status: "OPEN" },
      newValues: { billId: phieu.id, status: dich, daNhan },
      reason: input.lyDo.trim() || "Huỷ phiếu chưa nhận tiền — màn hình không đòi lý do",
      orgUnitId: phieu.centerId,
    });

    return { ok: true as const, daNhan };
  }
}

/**
 * Phiếu gộp đang mở của đơn có dòng thuộc con này không, và đã nhận bao nhiêu.
 *
 * PHIÊN D dùng để quyết: chưa nhận đồng nào → HUỶ (phát lại mã mới cho phần còn lại); đã
 * nhận một phần → ĐÓNG (ngừng thu tiếp mà giữ dấu vết).
 *
 * ⚠️ Trả cả phiếu KHÔNG chứa dòng của bé này (`coDongCuaCon: false`). Người gọi cần biết
 * điều đó để **không** đụng vào một phiếu đang thu cho những bé khác.
 */
export async function phieuGopCuaConTrongTx(
  tx: Tx,
  orderId: string,
  orderItemId: string,
): Promise<{ billId: string; ma: string | null; daNhan: number; coDongCuaCon: boolean } | null> {
  const phieu = await tx.paymentBill.findFirst({
    where: { orderId, status: "OPEN" },
    select: {
      id: true,
      matchKey: true,
      lines: {
        select: {
          paymentRequest: {
            select: { orderItemId: true, allocations: { select: { amount: true } } },
          },
        },
      },
    },
  });
  if (!phieu) return null;
  return {
    billId: phieu.id,
    ma: phieu.matchKey,
    daNhan: phieu.lines.reduce(
      (s, l) => s + l.paymentRequest.allocations.reduce((t, a) => t + a.amount, 0),
      0,
    ),
    coDongCuaCon: phieu.lines.some((l) => l.paymentRequest.orderItemId === orderItemId),
  };
}

/** HUỶ một phiếu chưa nhận đồng nào. Mã của phiếu VOID không đối khớp được nữa. */
export async function huyPhieuGop(input: {
  orderId: string;
  billId: string;
  lyDo: string;
  actor: AuditActor;
}): Promise<KetQuaGhi<{ daNhan: number }>> {
  return doiTrangThaiPhieu(input, "VOID");
}

/** ĐÓNG một phiếu đã nhận một phần từ đường khác. Xem khối chú thích mục 2. */
export async function dongPhieuGop(input: {
  orderId: string;
  billId: string;
  lyDo: string;
  actor: AuditActor;
}): Promise<KetQuaGhi<{ daNhan: number }>> {
  return doiTrangThaiPhieu(input, "CLOSED");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · RÓT TIỀN VỀ THEO PHIẾU  (đường webhook)
//
// ⚠️ VÌ SAO KHÔNG DÙNG LẠI `allocateToOrder` — ba điểm, và cả ba đều là luật NGƯỢC NHAU
//
//   · `allocateToOrder` chạy `planAllocation`: rót THÁC NƯỚC theo thứ tự đợt, có DUNG SAI làm
//     tròn, tiền dư ra `CreditBalance`. Phiếu gộp thì **khớp từng đồng hoặc không ăn gì** —
//     không thác, không dung sai, không ví.
//   · `allocateToOrder` ghi **MỘT** dòng `Payment` cho cả đơn. Phiếu gộp phải ghi **một dòng
//     mỗi CON**, vì đó là toàn bộ mục đích của nó.
//   · `allocateToOrder` nhận đúng MỘT `paymentRequestId` làm đích; phiếu gộp có n đích đã
//     chốt sẵn từ lúc phát hành.
//
// Nhồi cả ba khác biệt vào `allocateToOrder` bằng cờ là biến hàm rót tiền của cả hệ thống
// thành hai hàm dính nhau — và cái giá sẽ trả ở lần ai đó sửa nhánh này mà nhánh kia đổi theo.
//
// DÙNG CHUNG thì vẫn phải dùng chung đúng những thứ KHÔNG được lệch: **khoá đơn**
// (`khoaDonTrongTx`, cùng một chuỗi với `allocateToOrder`), đọc lại trạng thái giao dịch
// TRONG khoá, `recomputeRequestStatuses`, và **marker `[auto:<provider>:<txn>]`** trên
// `Payment` — marker đó là dây duy nhất cho `goGanTheoCon` tìm lại dòng gốc khi kế toán gỡ.
// ─────────────────────────────────────────────────────────────────────────────

/** Vì sao một giao dịch ĐÃ tra ra phiếu gộp mà không chia. */
export type LyDoChuaChia = "LECH_SO" | "PHIEU_KHONG_MO" | "DOT_DA_HUY" | "DON_KHONG_NHAN_TIEN";

export type KetQuaThuPhieu =
  /** Đường này KHÔNG nhận giao dịch — người gọi chạy tiếp đường cũ. */
  | { xuLy: false }
  /** Đã chia đích danh theo dòng; phiếu PAID, giao dịch MATCHED. */
  | {
      xuLy: true;
      ketQua: "DA_CHIA";
      orderId: string;
      billId: string;
      /**
       * Các phiếu thu ĐÃ nhận tiền trong lượt này, theo thứ tự dòng của phiếu.
       *
       * ⚠️ Trả cả DANH SÁCH chứ không một cái: phiếu gộp có n đích, và `IngestOutcome` đời cũ
       * chỉ có chỗ cho một `paymentRequestId`. Người gọi lấy phần tử đầu cho trường cũ — một
       * `paymentRequestId` CÓ THẬT đã nhận tiền, không phải số giả — và ghi `billId` để ai cần
       * đủ n đích thì tra `PaymentBillLine`.
       */
      paymentRequestIds: string[];
      soDong: number;
      tong: number;
    }
  /**
   * Đã nhận trách nhiệm nhưng KHÔNG chia — giao dịch để UNMATCHED cho người xử.
   *
   * `lyDo` + `conPhaiThu` [GĐ1 POS · 06/10/2026] — kết quả CÓ CẤU TRÚC cho người gọi cần phân
   * biệt "lệch số" với "lý do khác" (phiếu thu thẻ: LECH_TIEN ≠ CAN_XU_LY) mà không phải đọc chữ
   * trong `ghiChu`. BẮT BUỘC (luật 7): `tsc` liệt kê đủ chỗ dựng. `ghiChu` không đổi một chữ.
   */
  | {
      xuLy: true;
      ketQua: "CHUA_CHIA";
      billId: string | null;
      ma: string;
      ghiChu: string;
      lyDo: LyDoChuaChia;
      /** Còn phải thu của phiếu LÚC KHỚP (`conPhaiThuCuaPhieu`) — `null` khi không tính tới. */
      conPhaiThu: number | null;
    }
  /** Giao dịch đã xử lý rồi (chống trùng). */
  | { xuLy: true; ketQua: "TRUNG" };

/**
 * Thử nhận một giao dịch bằng MÃ PHIẾU GỘP.
 *
 * ── KHI NÀO ĐƯỜNG NÀY NHẬN TRÁCH NHIỆM, VÀ KHI NÀO NÓ NHƯỜNG ─────────────────
 *
 * Nó nhận **chỉ khi tra ra một phiếu gộp có thật**. Không tra ra thì trả `{ xuLy: false }` và
 * người gọi chạy tiếp đường cũ (orderCode / VA / SĐT).
 *
 * ⚠️ Đây là chỗ dễ làm sai nhất của cả phiên, nên nói thẳng: **KHÔNG** được coi "memo có một
 * khối 5 ký tự qua checksum nhưng không ra phiếu" là *mã sai ⇒ UNMATCHED*. Checksum lọc 26/27
 * khối rác, không lọc hết — nghĩa là một memo ĐỜI CŨ (`TenCon_84SĐT_MaKhoa`) vẫn có ~1/27 cơ
 * hội chứa một khối qua checksum. Nếu đường này nuốt luôn ca đó thì **mỗi ~27 giao dịch đời cũ
 * có một giao dịch rơi xuống UNMATCHED mà không lý do gì**, và triệu chứng sẽ trông như "SePay
 * thỉnh thoảng lỗi".
 *
 * Nhường lại cho đường cũ thì ca đó tự về UNMATCHED nếu đường cũ cũng không tra ra — cùng kết
 * quả cho giao dịch đời mới, mà không phá giao dịch đời cũ.
 *
 * ── CÒN KHI ĐÃ TRA RA PHIẾU THÌ KHÔNG NHƯỜNG ─────────────────────────────────
 *
 * Tra ra phiếu nghĩa là ta BIẾT khách định trả phiếu nào. Lệch số / phiếu đã PAID / đơn không
 * nhận tiền → vẫn nhận trách nhiệm và để UNMATCHED. Nhường tiếp cho đường cũ ở đây là mời nó
 * đoán theo SĐT và rót vào một đợt khác — đúng thứ chủ dự án cấm: *"Không tỉ trọng, không đoán
 * theo SĐT."*
 */
export async function thuTheoPhieuGop(input: {
  bankTransactionId: string;
  provider: string;
  providerTxnId: string;
  /** Nội dung chuyển khoản THÔ. Hàm tự `docMemo`. */
  noiDung: string | null;
  soTienVe: number;
  /**
   * NGÀY THU ghi vào `Payment.paidDate` — BẮT BUỘC, không mặc định (luật 7: `tsc` liệt kê
   * chỗ gọi). Webhook chuyển khoản truyền `new Date()` (giữ hành vi cũ); nguồn thẻ POS truyền
   * GIỜ QUẸT THẺ (chủ dự án chốt Q-C 29/09/2026 — file POS import trễ, lấy giờ import là ghi
   * sai ngày thu). Xem `lib/payments/pos/ngay-thu.ts`.
   */
  ngayThu: Date;
}): Promise<KetQuaThuPhieu> {
  const memo = docMemo(input.noiDung ?? "");
  // CHỈ mã đời MỚI. Mã đời cũ (`ORD…D<số>`) là của luồng cũ và phải đi đường cũ — chủ dự án
  // chốt: *"Mã đời cũ ORD…D giữ nguyên đường cũ."*
  if (memo.ungVien.length === 0) return { xuLy: false };

  // Tra NGOÀI transaction để biết có phiếu nào không — nếu không có thì nhường ngay, không
  // mở transaction cũng không lấy khoá. Đọc lại trong khoá ở dưới mới là đọc có hiệu lực.
  const so = await db.paymentBill.findFirst({
    where: { matchKey: { in: memo.ungVien } },
    select: { id: true, orderId: true, matchKey: true },
  });
  if (!so) return { xuLy: false };

  try {
    return await thuTheoPhieuGopTrongKhoa(input, memo, so);
  } catch (err) {
    if (!(err instanceof LoiPhieuDoiGiuaChung)) throw err;
    return thuTheoPhieuGopTrongKhoa(input, memo, so);
  }
}

async function thuTheoPhieuGopTrongKhoa(
  input: Parameters<typeof thuTheoPhieuGop>[0],
  memo: ReturnType<typeof docMemo>,
  so: { id: string; orderId: string },
): Promise<KetQuaThuPhieu> {
  return db.$transaction(async (tx) => {
    await khoaDonTrongTx(tx, so.orderId);
    // Khoá DÒNG giao dịch: khoá đơn không chặn lượt gắn tay cùng giao dịch vào ĐƠN KHÁC.
    await khoaGiaoDichTrongTx(tx, input.bankTransactionId);

    // Chống trùng: đọc lại TRONG khoá. Hai webhook cùng giao dịch chạy song song thì cái vào
    // sau thấy khác `UNMATCHED` và rút lui — không rót hai lần.
    const txn = await tx.bankTransaction.findUnique({
      where: { id: input.bankTransactionId },
      select: { status: true, centerId: true },
    });
    if (!txn || txn.status !== "UNMATCHED") return { xuLy: true as const, ketQua: "TRUNG" as const };

    const phieu = await docPhieu(tx, so.id);
    if (!phieu) return { xuLy: false as const };

    // Dựng ứng viên cho `khopGiaoDich` — bậc 1 theo MÃ. `traTheoSdt` trả rỗng CÓ CHỦ ĐÍCH:
    // phiên này chỉ mở bậc 1. Bậc 2 (đoán theo SĐT) là một quyết định riêng, chưa tới lượt.
    const dong = dungDongDeChia(phieu);
    const ungVien: PhieuUngVien = {
      billId: phieu.id,
      ma: phieu.matchKey ?? "",
      trangThai: phieu.status as PhieuUngVien["trangThai"],
      conPhaiThu: conPhaiThuCuaPhieu(dong),
      sdtChuPhieu: null,
    };
    const khop = khopGiaoDich({
      memo,
      soTienVe: input.soTienVe,
      traTheoMa: (ma) => (ma === phieu.matchKey ? ungVien : null),
      traTheoSdt: () => [],
    });
    if (khop.bac !== 1) {
      // Tra ra phiếu ở ngoài mà trong khoá lại không khớp = phiếu vừa bị đổi mã (không xảy ra:
      // mã bất biến) hoặc dữ liệu hỏng. Nhường cho đường cũ thay vì đoán.
      return { xuLy: false as const };
    }

    // CỔNG TẠI CHỖ TIÊU TIỀN — phiếu OPEN có dòng trỏ đợt ĐÃ HUỶ ⇒ không chia, CẢ phiếu (ăn cả
    // hoặc không ăn gì). `conPhaiThuCuaPhieu` không biết trạng thái đợt, nên thiếu cổng này tiền
    // đúng số rót thẳng vào đợt VOID rồi ghi thêm một `Payment` — khách trả lần hai cho khoản đã
    // thu (rà vòng 3, ca `[V3-01]` `[V3-03]`). `soatPhieuGopMoTrongTx` đóng phiếu ngay lúc đợt bị
    // huỷ; cổng này che mọi đường VOID đợt không đi qua đó (SQL tay, dữ liệu cũ).
    const dotHuy = phieu.lines.filter((l) => l.paymentRequest.status === "VOID");
    if (phieu.status === "OPEN" && dotHuy.length > 0) {
      return ketThucChuaChia(tx, {
        bankTransactionId: input.bankTransactionId,
        billId: phieu.id,
        ma: khop.maDung,
        ghiChu:
          `[PHIEU_KHONG_MO] Tiền về ${input.soTienVe.toLocaleString("vi-VN")}đ khớp phiếu ${khop.maDung} ` +
          `nhưng ${dotHuy.length} đợt của phiếu đã bị huỷ — không phân bổ, kế toán xử lý tay`,
        lyDo: "DOT_DA_HUY",
        conPhaiThu: ungVien.conPhaiThu,
      });
    }

    // ĐƠN có nhận tiền được không — cùng một luật với tầng tự động. Phiếu vẫn OPEN mà đơn đã
    // bị huỷ là ca có thật (huỷ đơn không đụng phiếu gộp), và rót vào đó là rót vào chỗ đã bỏ.
    const don = await tx.order.findFirst({
      where: { id: phieu.orderId, ...locDonNhanTien() },
      select: { id: true, code: true, centerId: true },
    });
    if (!don) {
      return ketThucChuaChia(tx, {
        bankTransactionId: input.bankTransactionId,
        billId: phieu.id,
        ma: khop.maDung,
        ghiChu:
          `Tiền về ${input.soTienVe.toLocaleString("vi-VN")}đ khớp phiếu ${khop.maDung} ` +
          `nhưng đơn không nhận tiền được (nháp / đã huỷ / đã hoàn / đã xoá)`,
        lyDo: "DON_KHONG_NHAN_TIEN",
        conPhaiThu: ungVien.conPhaiThu,
      });
    }

    const quyet = chiaTheoPhieuGop(input.soTienVe, {
      billId: phieu.id,
      trangThai: phieu.status as PhieuGopDeChia["trangThai"],
      dong,
    });

    if (!quyet.chia) {
      return ketThucChuaChia(tx, {
        bankTransactionId: input.bankTransactionId,
        billId: phieu.id,
        ma: khop.maDung,
        ghiChu: `[${quyet.ma}] ${quyet.moTa}`,
        lyDo: quyet.ma === "LECH_SO" ? "LECH_SO" : "PHIEU_KHONG_MO",
        conPhaiThu: quyet.conPhaiThu,
      });
    }

    // ── CHIA ĐÚNG TỪNG ĐỒNG ──────────────────────────────────────────────────

    await tx.paymentAllocation.createMany({
      data: quyet.lines.map((l) => ({
        bankTransactionId: input.bankTransactionId,
        paymentRequestId: l.paymentRequestId,
        amount: l.amount,
        // Luôn 0: phiếu gộp KHÔNG có dung sai làm tròn. Ghi tường minh để không ai đọc nhầm
        // là "quên" rồi thêm dung sai vào — thêm là phá luật ăn-cả-hoặc-không.
        roundingWaived: 0,
        centerId: don.centerId,
      })),
      skipDuplicates: true,
    });

    await recomputeRequestStatuses(tx, don.id);

    const daPaid = await tx.paymentBill.updateMany({
      where: { id: phieu.id, status: "OPEN" },
      data: { status: "PAID" },
    });
    // Đổi 0 dòng ⇒ phiếu vừa bị soát/đổi giữa chừng (vd `recompute` vừa ĐÓNG nó vì một đợt đã
    // VOID) — tiền vừa rót KHÔNG được ở lại. NÉM để rollback, xem `LoiPhieuDoiGiuaChung`.
    if (daPaid.count === 0) throw new LoiPhieuDoiGiuaChung(phieu.id);

    await tx.bankTransaction.update({
      where: { id: input.bankTransactionId },
      data: { status: "MATCHED", centerId: txn.centerId ?? don.centerId, unmatchedNote: null },
    });

    // ── SỔ CŨ (`Payment`) — MỘT DÒNG MỖI CON ─────────────────────────────────
    //
    // Công nợ hiển thị, cổng phụ huynh và mọi màn tiền vẫn đọc `Payment` (cờ
    // `PAYMENT_LEDGER_V2` là cờ CHẾT — xem CLAUDE.md). Không ghi sang đây thì tiền về qua QR
    // hiện ra "chưa đóng đồng nào" ở mọi nơi người dùng nhìn.
    //
    // Gộp theo `orderItemId` chứ không mỗi đợt một dòng: công nợ đọc theo CON, và hai đợt của
    // cùng một bé gộp lại thì sổ vẫn đúng mà ít dòng hơn để đối chiếu — cùng lối với
    // `ganTienTheoCon`.
    //
    // Phép kiểm trùng đi qua `conDongThuGiuTien` — CÙNG một luật với `allocateToOrder`, vì hai
    // đường ghi cùng một họ marker `[auto:<provider>:<txn>]` [vá 28/09/2026]. Bản cũ hỏi "có
    // dòng nào mang marker không", nên dòng đã bị gỡ gắn ĐẢO vẫn tính là trùng.
    // Đường NÀY tới được sau gỡ gắn [gộp nhánh SmartPOS 01/10/2026]: gỡ gắn chuyển khoản MỞ LẠI
    // phiếu gộp (`phieuGopSauGoGanTrongTx`), và "Rót vào đơn" → gỡ gắn → phát mã mới đưa CHÍNH
    // giao dịch ấy về đây — ca DB `[POS-DB-21b]` đi qua đúng phép kiểm này (`[POS-DB-21]` là
    // đường `allocateToOrder`). Gắn lại mà đếm cả dòng đã đảo là bỏ ghi `Payment`: sổ A ròng 0
    // trong khi sổ B đã thu.
    // ⚠️ KHÔNG rút gọn thành "dòng gốc chưa có bút toán con nào" (bản nhánh SmartPOS từng viết
    // tại chỗ): khoản chỉ điều chỉnh MỘT PHẦN bị coi là đã đảo ⇒ ghi sổ cũ hai lần (`[GGL-04]`).
    // Lưới `[KTS-W1]` giữ hai chỗ gọi cùng một hàm.
    const marker = `[auto:${input.provider.toLowerCase()}:${input.providerTxnId}]`;
    const daGhiSoCu = await conDongThuGiuTien(tx, { orderId: don.id, marker });
    if (!daGhiSoCu) {
      const dotTheoId = new Map(phieu.lines.map((l) => [l.paymentRequestId, l]));
      const congTheoCon = new Map<string, number>();
      for (const l of quyet.lines) {
        // `orderItemId` NULL = đợt của luồng CŨ nằm trong phiếu gộp. Vẫn ghi, vẫn đúng tổng —
        // chỉ là khoản đó chưa biết của bé nào, y như trước.
        const khoa = dotTheoId.get(l.paymentRequestId)?.paymentRequest.orderItemId ?? "";
        congTheoCon.set(khoa, (congTheoCon.get(khoa) ?? 0) + l.amount);
      }

      const dongHang = await tx.orderItem.findMany({
        where: { id: { in: [...congTheoCon.keys()].filter((k) => k !== "") } },
        select: { id: true, enrollmentId: true },
      });
      const ghiDanhTheoDong = new Map(dongHang.map((d) => [d.id, d.enrollmentId]));

      for (const [orderItemId, soTien] of congTheoCon) {
        await tx.payment.create({
          data: {
            orderId: don.id,
            orderItemId: orderItemId === "" ? null : orderItemId,
            // Suy từ DÒNG HÀNG — điều kiện `confirmPayment` đòi để phát được phiếu thu.
            enrollmentId: orderItemId === "" ? null : (ghiDanhTheoDong.get(orderItemId) ?? null),
            amount: soTien,
            method: input.provider.toLowerCase(),
            // Người gọi quyết định ngày thu (webhook = lúc nhận, POS = giờ quẹt) — `[POS-NT-01]`.
            paidDate: input.ngayThu,
            // Nhãn phiếu đánh vần ở MỘT chỗ: lượt gỡ gắn đọc nó để biết phiếu nào vừa mất tiền
            // (`lib/finance/phieu-gop-go-gan.ts`) — lệch một ký tự là phiếu không bao giờ mở lại.
            note: `${nhanPhieuGop(phieu.matchKey)} ${input.provider} ${input.providerTxnId} ${marker}`,
            saleStatus: "RECORDED",
            // PENDING: máy ghi nhận ≠ kế toán xác nhận. Đặt CONFIRMED ở đây là bỏ hẳn trục
            // kế toán cho mọi đồng tiền về qua QR.
            accountantStatus: "PENDING",
            centerId: don.centerId,
          },
        });
      }
    }

    // ── SỰ KIỆN SAU KHI CHIA [GĐ1 POS · 06/10/2026] ──────────────────────────
    //
    // Đường phiếu gộp (QR mã mới + thẻ POS) trước đây KHÔNG làm ba việc mà `allocateToOrder` làm
    // sau khi tiền vào: đẩy lead lên "Đã đăng ký", việc SAU CHỐT đơn thu đủ (lịch sử + cấp tài khoản
    // phụ huynh + biên nhận) — và không báo sale. (`recomputeRequestStatuses` ngay trên chỉ ROLLUP
    // NGẦM đơn lên CONFIRMED — F6, xem `lib/payments/don-thu-du.ts` `nhanDonChotNgam`.) Phát sự kiện ở đây (TRONG tx: rollback tiền ⇒ không có sự
    // kiện — outbox) để handler `lib/payments/sau-da-chia.ts` chạy đúng các việc đó SAU commit,
    // CÙNG luật `allocateToOrder` (`sauKhiDonThuDu`). `dedupeKey` mang cả giao dịch lẫn phiếu: một
    // giao dịch gỡ gắn rồi rót vào phiếu KHÁC vẫn có sự kiện của nó. Tên LITERAL — lưới
    // `khop-phat-nghe.test.ts` quét `publishEvent("…"`. Ca `[POS1-EV-02]` `[POS1-EV-07]`.
    // ⚠️ KHÔNG đặt tên trường `paidDate` trong payload — `[POS-NT-01]` đếm `paidDate:` của tệp này.
    await publishEvent(
      "phieu-gop.da-chia",
      {
        bankTransactionId: input.bankTransactionId,
        billId: phieu.id,
        ma: phieu.matchKey,
        orderId: don.id,
        provider: input.provider,
        providerTxnId: input.providerTxnId,
        tong: quyet.tongRot,
        ngayThu: input.ngayThu.toISOString(),
      },
      { tx, dedupeKey: `phieu-gop.da-chia:${input.bankTransactionId}:${phieu.id}` },
    );

    return {
      xuLy: true as const,
      ketQua: "DA_CHIA" as const,
      orderId: don.id,
      billId: phieu.id,
      paymentRequestIds: quyet.lines.map((l) => l.paymentRequestId),
      soDong: quyet.lines.length,
      tong: quyet.tongRot,
    };
  });
}

/**
 * Đóng lượt xử lý mà KHÔNG chia: giao dịch để `UNMATCHED` kèm lý do người đọc hiểu được.
 *
 * ⚠️ `unmatchedNote` là thứ DUY NHẤT sale/kế toán thấy ở `/admin/bien-dong-so-du`. Một câu
 * "không khớp" trần trụi buộc họ tự dò; câu có MÃ PHIẾU + số cần + số về thì họ gọi cho phụ
 * huynh được ngay.
 */
async function ketThucChuaChia(
  tx: Tx,
  x: {
    bankTransactionId: string;
    billId: string | null;
    ma: string;
    ghiChu: string;
    lyDo: LyDoChuaChia;
    conPhaiThu: number | null;
  },
): Promise<KetQuaThuPhieu> {
  await tx.bankTransaction.update({
    where: { id: x.bankTransactionId },
    data: { status: "UNMATCHED", unmatchedNote: x.ghiChu.slice(0, 1000) },
  });
  return {
    xuLy: true,
    ketQua: "CHUA_CHIA",
    billId: x.billId,
    ma: x.ma,
    ghiChu: x.ghiChu,
    lyDo: x.lyDo,
    conPhaiThu: x.conPhaiThu,
  };
}
