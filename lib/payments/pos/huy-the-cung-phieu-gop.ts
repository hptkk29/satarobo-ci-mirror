import "server-only";
// lib/payments/pos/huy-the-cung-phieu-gop.ts — HUỶ KÈM PHIẾU THẺ MỞ khi một phiếu gộp bị hệ thống huỷ/đóng (Việc 6 · mục 3 · a3 · 10/10/2026).
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §9. Chủ dự án chốt 10/10/2026: *"Dừng học: huỷ kèm phiếu thẻ đang mở trong cùng transaction với việc huỷ phiếu gộp; giao dịch về
// sau rơi vào hàng chờ gắn tay, không ghi đôi."*
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ TỆP NÀY
//
// Dừng học (và "đổi khoá", dùng chung thân `dungHocTrongTx`) VOID/ĐÓNG phiếu gộp có dòng của bé. Trước Việc 6 phiếu thẻ MỞ của phiếu gộp đó ở lại (V1 của Việc 1, ca `[HN1-DB-09]` cũ):
// poller vẫn hỏi nó tới 24 giờ, màn vẫn in "phiếu gộp đã đóng" cho một phiếu thẻ khách có thể đang quẹt, và khi giao dịch về SAU, phiếu thẻ "mồ côi" còn NHẬN giao dịch ấy
// (`CAN_XU_LY` giữ giao dịch của một phiếu gộp đã chết — ca `[HN6-DH-06c]`/`[HN6-DH-07]` đo trên mã cũ). Nay phiếu thẻ mở bị HUY CÙNG transaction với phiếu gộp: không còn ai chờ một
// khoản sẽ không bao giờ tự khớp; khoản quẹt về sau (đúng mã cũ, đúng số) rơi hàng chờ gắn tay của kế toán qua `thuTheoPhieuGop` (phiếu gộp VOID ⇒ `PHIEU_KHONG_MO`) — CHÍNH đường
// ấy đã làm việc đó từ trước; tệp này không thêm đường tiền nào.
//
// ─────────────────────────────────────────────────────────────────────────────
// BỐN ĐIỀU PHẢI GIỮ
//
// 1. NGƯỜI GỌI GIỮ KHOÁ ĐƠN. Hàm lấy tiếp khoá DÒNG từng phiếu thẻ (`khoaPhieuPosTrongTx`) — thứ tự đơn → [giao dịch] → phiếu POS của mọi đường tiền / đường phiếu
//    (`xuLyKetQuaPos`, `hetHanPhieuPos`, `taoPhieuPosTrongKhoa`, `huyPhieuThe`, `guiSaiMa`). Không đụng giao dịch ⇒ không khoá dòng giao dịch. Phiếu lấy theo `id` tăng dần.
// 2. KHÔNG TỪ CHỐI. Hàm không có đường `return { ok:false }`: dừng học là quyết toán do hệ thống, KHÔNG bị cổng tiền của nút tay (`choPhepHuyPhieuThe`: tiền đang bay, kết quả chưa
//    kết luận…) chặn — chặn ở đây = dừng học kẹt vì một phiếu thẻ bỏ dở, và đó chính là thứ V1 từ chối đổi (cổng ở `doiTrangThaiPhieuTrongTx` để lại đợt VOID mà phiếu OPEN). Sau phép ghi
//    đầu tiên chỉ có `throw` (do `ghiHuyPhieuTheTrongTx`: `updateMany` đổi 0 dòng dưới khoá = bất khả).
// 3. CHỈ PHIẾU "MỞ + CHƯA NHẬN GIAO DỊCH" bị huỷ (`theMoChuaNhan`): CHO_QUET/THAT_BAI mà `bankTransactionId` rỗng — đúng điều kiện của phép ghi. Phiếu đã ĐÓNG (HET_HAN · HUY · DA_THU) và phiếu
//    ĐANG CHỜ KẾ TOÁN (LECH_TIEN · CAN_XU_LY — mang giao dịch của khách ở hàng chờ) GIỮ NGUYÊN: huỷ chúng là xoá tay cầm của một khoản tiền có thật.
// 4. PHIẾU CÒN YÊU CẦU "NHẬP SAI MÃ" SỐNG (`coYeuCauSaiMaDangGiu`) KHÔNG BỊ HUỶ — bỏ qua và nói ra. Bất biến của Việc 3: yêu cầu sống ⇒ phiếu thẻ ở CAN_XU_LY (không phải phiếu mở), nên qua
//    đường thật nhánh này không bao giờ chạy; nó là LỚP THỨ HAI cho dữ liệu vi phạm bất biến (cùng lý lẽ `coYeuCauSaiMaDangGiu` của nút tay): có người (kế toán ≠ người gửi — DB CHECK) đang
//    quyết tiền gắn với phiếu này, hệ thống không đổi trạng thái phiếu sau lưng họ, và hệ thống cũng KHÔNG thể tự "từ chối" yêu cầu thay họ (CHECK `nguoiQuyetId ≠ nguoiGuiId`; tự gán một
//    người quyết là bịa ra một quyết định). Dừng học vẫn chạy; phiếu bị bỏ qua vào vết `CON_DUNG_HOC.phieuTheBoQua`. Yêu cầu sống trên phiếu CAN_XU_LY (đường thật) cũng ở lại nguyên —
//    kế toán thấy câu "Phiếu gộp không còn mở — … từ chối yêu cầu hoặc xử lý tay" khi bấm Duyệt (ca `[HN6-DH-05a]`).
//
// Không chạm: PaymentBill (người gọi đổi sau) · Order · Payment · BankTransaction · PaymentAllocation · PaymentRequest · PosCardTransaction · PosSaiMaYeuCau.
// `scopedDb` KHÔNG che write: phạm vi đã gác ở action dừng học (`congDungHoc`: quyền + cơ sở của đơn + cờ); mọi truy vấn ở đây khoá theo `paymentBillId` của phiếu gộp của CHÍNH đơn đang khoá,
// bằng `tx` trần — một đơn khác không thể lọt vào (ca `[HN6-DH-02b]`).
import type { Prisma, PosIntentStatus } from "@prisma/client";
import type { AuditActor } from "@/lib/audit/audit-log";
import { ghiHuyPhieuTheTrongTx } from "./huy-phieu-the-db";
import { TRANG_THAI_MO } from "./phieu-pos-luat";
import { khoaPhieuPosTrongTx } from "./xu-ly-ket-qua";
import { coYeuCauSaiMaDangGiu } from "./yeu-cau-sai-ma-dang-giu";

type Tx = Prisma.TransactionClient;

/**
 * Phiếu thẻ MỞ và CHƯA nhận giao dịch — HAI điều kiện của chính phép ghi (`ghiHuyPhieuTheTrongTx`). MỘT định nghĩa cho bản xem trước (đếm) và đường ghi (liệt kê): hai nơi tự viết là hai
 * nơi có ngày cãi nhau, và màn "Sẽ huỷ khi xác nhận" nói dối. Hàm (không phải hằng) vì Prisma không nhận mảng `readonly` ở `in`.
 */
const theMoChuaNhan = () => ({ status: { in: [...TRANG_THAI_MO] }, bankTransactionId: null }) satisfies Prisma.PosPaymentIntentWhereInput;

/**
 * Số phiếu thẻ mà đường ghi SẼ huỷ — cho màn XEM TRƯỚC "Dừng học" / "Đổi khoá" (chỉ đọc, không khoá). CÙNG điều kiện với đường ghi, KỂ CẢ luật "phiếu mang yêu cầu sống thì bỏ qua": đếm thừa
 * phiếu mà máy chủ để nguyên là màn hứa huỷ một phiếu rồi không huỷ (luật 12). Qua đường thật phiếu MỞ không bao giờ mang yêu cầu sống (bất biến Việc 3) nên hai cách đếm trùng nhau; chúng chỉ
 * khác nhau trên dữ liệu vi phạm bất biến — đúng chỗ ca `[HN6-DH-10c]` ghim.
 */
export async function demTheMoCuaPhieuGop(client: Pick<Tx, "posPaymentIntent" | "posSaiMaYeuCau">, billId: string): Promise<number> {
  const ungVien = await client.posPaymentIntent.findMany({ where: { paymentBillId: billId, ...theMoChuaNhan() }, select: { id: true }, orderBy: { id: "asc" } });
  let seHuy = 0;
  for (const { id } of ungVien) if (!(await coYeuCauSaiMaDangGiu(client, id))) seHuy++;
  return seHuy;
}

/** `nguoiTaoId` [VIỆC 6 · chốt]: người tạo phiếu thẻ — để báo họ SAU commit (`bao-the-huy-cung.ts`); KHÔNG đi ra khỏi lớp lib (người gọi bóc nó trước khi trả cho client). */
export type TheDaHuyCungPhieuGop = { intentId: string; ma: string; trangThaiTruoc: PosIntentStatus; nguoiTaoId: string };
export type TheBiBoQuaKhiHuy = { intentId: string; ma: string; vi: "CO_YEU_CAU_SAI_MA" };
export type KetQuaHuyTheCungPhieuGop = { daHuy: TheDaHuyCungPhieuGop[]; boQua: TheBiBoQuaKhiHuy[] };

/**
 * HUỶ mọi phiếu thẻ MỞ (chưa nhận giao dịch) của phiếu gộp `billId` — gọi NGAY TRƯỚC khi đổi trạng thái phiếu gộp, CÙNG transaction + khoá đơn của người gọi.
 * `lyDo` là câu của người gọi ("Dừng học: <tên bé>") — vào `reason` của vết cùng mã phiếu; `them` vào `newValues` (vd bé nào).
 */
export async function huyTheMoCungPhieuGopTrongTx(
  tx: Tx,
  x: { orderId: string; billId: string; actor: AuditActor; lyDo: string; them: Record<string, unknown> },
): Promise<KetQuaHuyTheCungPhieuGop> {
  const ungVien = await tx.posPaymentIntent.findMany({
    where: { paymentBillId: x.billId, ...theMoChuaNhan() },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const ket: KetQuaHuyTheCungPhieuGop = { daHuy: [], boQua: [] };
  for (const { id } of ungVien) {
    await khoaPhieuPosTrongTx(tx, id);
    // ĐỌC LẠI dưới khoá dòng: danh sách ở trên chỉ là ứng viên; sự thật là hàng đọc SAU khi giữ khoá.
    const p = await tx.posPaymentIntent.findFirst({
      where: { id, paymentBillId: x.billId, ...theMoChuaNhan() },
      select: { id: true, status: true, code5: true, lastResultKind: true, createdById: true },
    });
    if (!p) continue; // đã đóng/nhận giao dịch trong lúc chờ khoá ⇒ không còn gì để huỷ
    if (await coYeuCauSaiMaDangGiu(tx, p.id)) {
      ket.boQua.push({ intentId: p.id, ma: p.code5, vi: "CO_YEU_CAU_SAI_MA" });
      continue;
    }
    await ghiHuyPhieuTheTrongTx(tx, {
      orderId: x.orderId,
      intentId: p.id,
      billId: x.billId,
      code5: p.code5,
      trangThaiTruoc: p.status,
      ketQuaTruoc: p.lastResultKind,
      actor: x.actor,
      nguon: "DUNG_HOC",
      reason: `${x.lyDo} — huỷ phiếu thu thẻ mã ${p.code5} cùng phiếu gộp`,
      them: x.them,
    });
    ket.daHuy.push({ intentId: p.id, ma: p.code5, trangThaiTruoc: p.status, nguoiTaoId: p.createdById });
  }
  return ket;
}
