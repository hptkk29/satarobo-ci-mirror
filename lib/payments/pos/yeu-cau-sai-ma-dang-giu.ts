import "server-only";
// lib/payments/pos/yeu-cau-sai-ma-dang-giu.ts — HAI sự thật về yêu cầu "nhập sai mã" (Việc 3) của một phiếu thẻ, cho cổng của nút "Huỷ phiếu thẻ" (Việc 4):
//   · `coYeuCauSaiMaDangGiu`   — còn một yêu cầu SỐNG (`trangThai ≠ TU_CHOI`: kế toán chưa/đang quyết, hoặc đã ghi nhận);
//   · `yeuCauSaiMaMoiNhat`     — yêu cầu MỚI NHẤT của phiếu: trạng thái + lý do từ chối của CHÍNH dòng đó (`null` khi chưa từng có).
// Thiết kế: docs/pos-hai-nut-khai-may.md §6.9 + §7 (NỐI THẬT sau lượt ghép Việc 4 lên Việc 3). Ca đo trên Postgres thật: `tests/finance/pos-huy-sai-ma.test.ts`.
//
// ── VIỆC 6 · a2 (chủ dự án chốt 10/10/2026: kế toán TỪ CHỐI thì sale HUỶ ĐƯỢC phiếu thẻ) ──────────────────────────────────────────────────
// Hàm thứ hai TỪNG là `yeuCauSaiMaMoiNhatBiTuChoi` (trả boolean — cổng chặn riêng V4.2, mã `SAI_MA_BI_TU_CHOI`). Cổng ấy ĐÃ GỠ: ca lách "bác X ⇒ huỷ ⇒ mở phiếu mới ⇒ gửi LẠI X" nay do bộ nhớ theo ĐƠN của
// Việc 5 chặn (`docGiaoDichDaBiBac`, sai-ma-doc.ts), không còn do việc cấm huỷ. Hàm đọc yêu cầu MỚI NHẤT vẫn cần, vì một lý do KHÁC: máy chủ phải NHẬN RA câu lưu sau từ chối
// (`laCauLuuTuChoiSaiMa`, huy-phieu-the.ts — so `lastResultMessage` với `cauTuChoi(lyDoTuChoi)`), nên nó trả CẢ trạng thái lẫn lý do của dòng mới nhất và KHÔNG trả gì thêm (không id / giao dịch / người
// quyết ra khỏi lớp đọc). Chỉ yêu cầu SỐNG mới hơn mới đổi phán quyết huỷ (`coYeuCauSaiMaDangGiu`), một yêu cầu bị từ chối thì không tự nó chặn gì.
//
// ── MÔ HÌNH CỦA VIỆC 3 (đo từ mã, không từ lời kể) ──────────────────────────────────────────────────────────────────────
//   Bảng `PosSaiMaYeuCau` (accessor `posSaiMaYeuCau`): `intentId` · `trangThai` ∈ {CHO_DUYET, DANG_GHI, DA_GHI_NHAN, TU_CHOI} · `createdAt`.
//   DB gác (migration `20261010090000_pos_sai_ma_yeu_cau`): UNIQUE (intentId) WHERE trangThai <> 'TU_CHOI' ⇒ mỗi phiếu thẻ tối đa MỘT yêu cầu SỐNG,
//   và yêu cầu sống luôn là yêu cầu MỚI NHẤT (không thể chèn yêu cầu mới khi dòng cũ chưa bị bác).
//
//   · GỬI (`sai-ma-ghi.ts`, cả hai bậc): trong CÙNG transaction INSERT yêu cầu + chuyển phiếu thẻ `CHO_QUET → CAN_XU_LY` + `bankTransactionId := X`.
//     ⇒ qua ĐƯỜNG THẬT, phiếu MỞ + yêu cầu sống KHÔNG BAO GIỜ cùng tồn tại: cổng ① (trạng thái CAN_XU_LY) của `choPhepHuyPhieuThe` nói trước và
//     `coYeuCauSaiMaDangGiu` chưa bao giờ tới lượt. Nó là LỚP THỨ HAI cho dữ liệu vi phạm bất biến đó (chèn SQL tay, một sửa đổi sau này của Việc 3
//     giữ phiếu ở CHO_QUET) — ca `[HN4-DB-13b]` dựng nó bằng cách chèn thẳng.
//   · TỪ CHỐI (`sai-ma-ghi.ts`): yêu cầu → TU_CHOI; phiếu thẻ → `CHO_QUET`, `bankTransactionId := NULL`, `lastResultKind` vẫn NOT_FOUND,
//     `lastResultMessage := cauTuChoi(lyDo)` — câu CHỈ ĐỂ HIỆN NGAY (poller / Kiểm tra ghi đè bằng "Chưa thấy…" sau vài phút). Đây là ca THẬT cần `yeuCauSaiMaMoiNhat`: phiếu MỞ, kết quả NOT_FOUND,
//     và nếu quyết theo câu lưu thì nút nhấp nháy từ chối ⇄ cho huỷ khi sự thật không đổi — nên cổng nhận ra câu từ chối bằng YÊU CẦU MỚI NHẤT (không bằng cách đọc tiền tố câu).
//     CA LÁCH "kế toán vừa bác X, sale huỷ phiếu, mở phiếu mới, gửi LẠI X" (bản Việc 3 đếm `soLanBiBac` / `daBiBacChoPhieu` THEO PHIẾU THẺ nên phiếu mới "chưa từng bị bác" và X TỰ GHI NHẬN: tiền vào đơn KHÔNG
//     qua kế toán — đo ở `[HN4-DB-13e]` bản cũ: +1 Payment) từ Việc 5 do bộ nhớ "đã bị bác" khoá theo ĐƠN chặn (`docGiaoDichDaBiBac`, sai-ma-doc.ts): phiếu thẻ mới — dù do huỷ, hết hạn hay phiếu gộp đổi
//     mã — không nhận X (`tests/finance/pos-bac-lach-phieu-moi.test.ts`). Từ VIỆC 6 cổng huỷ KHÔNG còn chặn thêm lần nữa: huỷ sau từ chối ĐƯỢC, và `[HN4-DB-13e]` chạy đúng ca lách bằng đường huỷ THẬT.
//     Điều bộ nhớ theo đơn không bảo vệ được — khách có thể đã bị trừ tiền — nằm ở câu cấm "ĐỪNG cho khách quẹt lại" còn trên màn (dòng đỏ của yêu cầu, rồi cảnh báo cấp ĐƠN `CAU_DON_DA_CO_VET_BAC` kể cả trên phiếu đã huỷ).
//
// ── HAI ĐIỀU PHẢI GIỮ KHI GỌI ───────────────────────────────────────────────────────────────────────────────────────────
//   1. GỌI DƯỚI KHOÁ ĐƠN + KHOÁ DÒNG PHIẾU (`huy-phieu-the-db.ts`). Mọi phép GHI làm đổi "sống ⇄ TU_CHOI" (gửi: INSERT · từ chối: UPDATE) cũng giữ khoá đơn
//      trước, nên lượt đọc dưới khoá không bao giờ thấy trạng thái nửa vời. Các chuyển DANG_GHI → DA_GHI_NHAN / CHO_DUYET không đổi phân loại (cùng ≠ TU_CHOI).
//   2. TRA BẰNG `tx` TRẦN, KHÔNG BAO GIỜ bằng `scopedDb`. Câu tra để CHẶN mà đi qua client scope thì đúng dòng cần chặn bị lọc mất, trả `false`, và cổng
//      đọc "không có" thành "cho qua" — mở toang đúng lúc phải đóng (cùng bài học `PaymentMethod`, CLAUDE.md). Phạm vi đã gác ở action (`congXemPhieuPos`);
//      `[HN4-DB-13f]` chèn một dòng mang `centerId` LỆCH để canh đúng điều này. Kiểu `Client` là client CỦA TRANSACTION (`Pick<Tx, "posSaiMaYeuCau">`), không phải client scope.
//
// "Mới nhất" = CÙNG `orderBy createdAt desc, take 1` mà `CHON_VIEW` (phieu-pos.ts) dùng cho `PhieuPosDeXem.saiMaYeuCau` — màn và máy chủ hỏi cùng một câu,
// nên `huyPhieuThe` của màn (suy từ `saiMaYeuCau[0]`) và của máy chủ không thể cãi nhau về "bị từ chối". "Đang giữ" = `trangThai ≠ TU_CHOI` — CÙNG vị từ hai
// UNIQUE từng phần của Việc 3 (một định nghĩa, không hai): DANG_GHI và DA_GHI_NHAN cũng là "giữ" (fail-closed — phiếu mở mà có yêu cầu đã ghi nhận là dữ liệu sai).
import type { Prisma } from "@prisma/client";
import type { TrangThaiSaiMa } from "./sai-ma";

type Tx = Prisma.TransactionClient;
/** Máy chủ đọc bằng `tx` dưới khoá đơn + khoá dòng phiếu thẻ. CHỈ model `posSaiMaYeuCau` — không nhận client đã scope. */
type Client = Pick<Tx, "posSaiMaYeuCau">;

/** Phiếu thẻ này còn một yêu cầu "nhập sai mã" SỐNG (`trangThai <> TU_CHOI`) không. */
export async function coYeuCauSaiMaDangGiu(client: Client, intentId: string): Promise<boolean> {
  const dong = await client.posSaiMaYeuCau.findFirst({
    where: { intentId, trangThai: { not: "TU_CHOI" } },
    select: { id: true },
  });
  return dong !== null;
}

/**
 * Yêu cầu "nhập sai mã" MỚI NHẤT của phiếu thẻ này: trạng thái + lý do từ chối của CHÍNH dòng đó (`null` khi phiếu chưa từng có yêu cầu nào). VIỆC 6 · a2 — thay cho hàm trả boolean
 * "mới nhất bị từ chối" (cổng chặn riêng đã gỡ). Hình dạng kết quả CỐ Ý chỉ gồm hai trường `laCauLuuTuChoiSaiMa` cần — dựng tường minh, không trả nguyên dòng, để một lần mở rộng `select`
 * sau này không làm id / giao dịch / người quyết rò ra khỏi lớp đọc (`[HN6-A2-T3b]`).
 */
export async function yeuCauSaiMaMoiNhat(client: Client, intentId: string): Promise<{ trangThai: TrangThaiSaiMa; lyDoTuChoi: string | null } | null> {
  const moiNhat = await client.posSaiMaYeuCau.findFirst({
    where: { intentId },
    orderBy: { createdAt: "desc" },
    select: { trangThai: true, lyDoTuChoi: true },
  });
  return moiNhat === null ? null : { trangThai: moiNhat.trangThai, lyDoTuChoi: moiNhat.lyDoTuChoi };
}
