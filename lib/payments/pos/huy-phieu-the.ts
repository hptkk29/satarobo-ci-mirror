// lib/payments/pos/huy-phieu-the.ts — LUẬT "HUỶ PHIẾU THẺ" (Việc 4 · 09/10/2026). THUẦN, client-safe.
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §6. Nút "Huỷ phiếu thẻ" là lối thoát của cổng Việc 1 ("phiếu gộp có thẻ mở thì
// không huỷ được phiếu gộp"): bấm nhầm "Thẻ POS" thì khoá cả đơn tới 24 giờ. Nhưng huỷ phiếu thẻ lúc khách ĐÃ quẹt là
// chính điều V2 của Việc 1 canh: sale phát mã mới / QR cho một khoản đã trả ⇒ đòi khách trả lần hai. Hàm này là chỗ
// DUY NHẤT trả lời "huỷ được không", và nó trả lời theo hướng AN TOÀN: chỉ cho huỷ khi KHÔNG có dấu hiệu tiền đang bay.
//
// ─────────────────────────────────────────────────────────────────────────────
// AI GỌI HÀM NÀY — và tất cả phải truyền ĐỦ, KHÔNG có mặc định (luật 7: `tsc` liệt kê chỗ gọi)
//   · màn:      `dungPhieuPosView` (phieu-pos-luat.ts) → `PhieuPosView.huyPhieuThe` — component KHÔNG tự viết điều kiện;
//   · máy chủ:  `huyPhieuThe` (Agent S, `huy-phieu-the-db.ts`) — đọc LẠI mọi đầu vào DƯỚI khoá đơn + khoá dòng phiếu thẻ
//               rồi hỏi hàm này. Lưới `[HN4-W2]` quét MỌI nơi gọi (kể cả tệp mới) và đòi đủ khoá + cách đo hạn.
// Hai nơi cùng một hàm ⇒ màn không vẽ nút mà máy chủ chắc chắn từ chối.
//
// Tệp này là LÁ của tầng luật: chỉ import tệp chữ + kiểu + `dauCauChuaThay` + (VIỆC 6) `cauTuChoi`/`TrangThaiSaiMa` của `sai-ma.ts` (cũng thuần, KHÔNG
// import ngược lại tệp này). KHÔNG import `phieu-pos-luat.ts` (nó import tệp này).
// Vì vậy hết hạn / phiếu gộp còn mở là BOOLEAN do người gọi tính bằng CHÍNH `phieuPosHetHan` / `paymentBill.status`
// (lưới `[HN4-W2]` ghim cả hai nơi gọi) — không chép lại mốc hết hạn thành bản thứ hai.
//
// ─────────────────────────────────────────────────────────────────────────────
// THỨ TỰ CÁC CỔNG — rủi ro TIỀN nói trước, "không còn gì để huỷ" nói sau (một phiếu vừa quá hạn vừa lỗi kết nối phải
// nghe "lỗi kết nối"):
//   ① trạng thái ĐÃ ĐÓNG        DA_THU · LECH_TIEN · CAN_XU_LY · HUY · HET_HAN
//   ② dấu hiệu TIỀN ĐANG BAY    đã nhận giao dịch · giao dịch chờ tay · yêu cầu sai mã đang giữ
//                               · dòng thẻ mang mã chưa thành giao dịch (VIỆC 4 — lớp mù của kết quả lưu + hàng chờ tay)
//   ③ kết quả lượt kiểm gần nhất  chỉ `null` · FAILED · "chưa thấy" TRẦN cho qua (và câu `tuChoiSaiMa` vừa ghi — xem dưới)
//   ④ cấu trúc                  phiếu gộp đã đóng · quá hạn
// Đã qua hết ⇒ cho huỷ, và LUÔN đòi xác nhận mạnh (V4.3).
//
// ─────────────────────────────────────────────────────────────────────────────
// VIỆC 6 (chủ dự án chốt 10/10/2026) — SAU KHI KẾ TOÁN TỪ CHỐI "nhập sai mã", SALE HUỶ ĐƯỢC PHIẾU THẺ theo cổng thường
// Bản Việc 4 có nấc ② riêng "yêu cầu sai mã mới nhất bị từ chối" (mã `SAI_MA_BI_TU_CHOI`, V4.2) vì ca lách: kế toán bác X ⇒ sale huỷ ⇒ mở phiếu mới ⇒ gửi LẠI X ⇒ X tự
// ghi nhận, tiền vào đơn KHÔNG qua kế toán. Từ Việc 5 điều đó do BỘ NHỚ theo ĐƠN chặn (`docGiaoDichDaBiBac`, `sai-ma-doc.ts` — phiếu thẻ mới, kể cả sau huỷ, không nhận X) nên nấc
// riêng ấy ĐÃ BỎ cùng mã của nó. Còn nguyên mọi nấc thường: yêu cầu ĐANG chờ/đang ghi vẫn chặn, giao dịch chờ tay · dòng thẻ chưa ngã ngũ · kết quả lượt kiểm vẫn chặn.
//
// ⚠️ Chỉ bỏ nấc ② thì NÚT NHẤP NHÁY (luật 12). Ngay sau từ chối Việc 3 ghi vào phiếu `lastResultKind` NOT_FOUND và `lastResultMessage = cauTuChoi(lyDo)` — câu CHỈ ĐỂ HIỆN NGAY,
// KHÔNG phải câu "chưa thấy" trần ⇒ nấc ③ sẽ nói `CHUA_NGA_NGU` ("có giao dịch đang xử lý" — sai nghĩa); vài phút sau poller / Kiểm tra ghi đè bằng "Chưa thấy…" và nút TỰ HIỆN mà
// không dữ kiện nào về tiền đổi. Nên ③ phải nhận ra câu từ chối — bằng MỘT cờ `cauLuuLaCauTuChoiSaiMa` do `laCauLuuTuChoiSaiMa` tính từ yêu cầu MỚI NHẤT (so ĐÚNG CHUỖI
// `cauTuChoi(lyDoTuChoi)`), KHÔNG bằng cách đọc tiền tố câu. Hàm luật chỉ tin cờ: ô "câu từ chối mà cờ TẮT" vẫn ra `CHUA_NGA_NGU` (fail-closed — `[HN4-04b]`, `[HN4-09]`).
import type { PosIntentStatus } from "@prisma/client";
import type { PosCheckResult } from "./provider/kieu";
import { dauCauChuaThay } from "./thong-diep-pos";
import { cauTuChoi, type TrangThaiSaiMa } from "./sai-ma";
import { CAU_TU_CHOI_HUY_PHIEU_THE, type MaTuChoiHuyPhieuThe } from "./huy-phieu-the-cau";

export type DauVaoChoPhepHuyPhieuThe = {
  /** Trạng thái phiếu thẻ — đọc LẠI dưới khoá ở máy chủ, `PosPaymentIntent.status` ở màn. */
  status: PosIntentStatus;
  /** `lastResultKind` — loại kết quả lượt kiểm gần nhất; `null` = chưa kiểm lần nào. */
  lastResultKind: PosCheckResult["kind"] | null;
  /**
   * `lastResultMessage` — CÂU đã lưu của lượt kiểm gần nhất. Chỉ để phân biệt "chưa thấy" trần với NOT_FOUND
   * "ĐỪNG quẹt lại" (cùng `lastResultKind`!) — xem `laCauChuaThayTran`. `null`/lạ ⇒ KHÔNG phải "chưa thấy" trần.
   */
  lastResultMessage: string | null;
  /** Mã 5 ký tự của phiếu thẻ — câu "chưa thấy" nêu đúng mã này. */
  code5: string;
  /** Phiếu thẻ đã NHẬN một giao dịch (`bankTransactionId !== null`). Phiếu mở mà có ⇒ dữ liệu bất thường, fail-closed. */
  daNhanGiaoDich: boolean;
  /**
   * Còn giao dịch thẻ mang MÃ của phiếu gộp nằm hàng chờ tay (`maCoGiaoDichChoTay`, `the-dang-mo.ts`) — tiền khách đã
   * bị trừ mà chưa gắn vào đâu. CÙNG hàm cổng `taoPhieuPosTrongKhoa` và cổng huỷ phiếu gộp dùng.
   */
  coGiaoDichChoTay: boolean;
  /**
   * VIỆC 3 (sale nhập sai mã): có yêu cầu CÒN SỐNG (`trangThai ≠ TU_CHOI`) cho phiếu thẻ này. Đọc bằng
   * `coYeuCauSaiMaDangGiu(tx, intentId)` (`yeu-cau-sai-ma-dang-giu.ts`) — đọc bảng `PosSaiMaYeuCau` thật (đã nối; màn suy từ `saiMaYeuCau[0]`).
   * Đường thật của Việc 3 chuyển phiếu sang CAN_XU_LY ngay lúc gửi nên cổng ① thường nói trước; cờ này là LỚP THỨ HAI cho
   * dữ liệu vi phạm bất biến đó (V4.1).
   */
  coYeuCauSaiMaDangGiu: boolean;
  /**
   * VIỆC 6 (thay cho cờ "yêu cầu sai mã mới nhất bị từ chối" của V4.2 — cổng chặn riêng ấy ĐÃ BỎ): `lastResultMessage` CHÍNH LÀ câu mà `tuChoiSaiMa` (Việc 3) ghi vào phiếu lúc kế
   * toán từ chối — tức là chưa lượt kiểm nào ghi đè kể từ lúc đó. Tính bằng `laCauLuuTuChoiSaiMa` (hàm DUY NHẤT nhận ra câu này; màn và máy chủ cùng gọi nó), BẮT BUỘC, không mặc định
   * (luật 7). Chỉ có nghĩa ở nấc ③ khi `lastResultKind = NOT_FOUND`: cờ BẬT ⇒ câu lưu đó được đối xử như "chưa thấy" TRẦN (không phải "đang xử lý"). KHÔNG mở khoá nấc nào khác.
   */
  cauLuuLaCauTuChoiSaiMa: boolean;
  /**
   * VIỆC 4 (rà đối kháng 09/10/2026): còn DÒNG THẺ mang mã nằm trong DB mà CHƯA thành giao dịch — "Đang xử lý"/chữ lạ,
   * "Thành công" số ≤ 0, hoàn MỘT PHẦN (`maCoDongTheChuaKetLuan`, `dong-the-chua-ket-luan.ts`). Lớp MÙ của `coGiaoDichChoTay`
   * (chỉ đếm giao dịch UNMATCHED) và của câu lưu (chỉ đúng lúc kiểm): dòng đã VỀ mà lượt kiểm lưu trước đó vẫn nói "Chưa thấy…"
   * thì không cờ nào khác thấy nó. BẮT BUỘC, không mặc định (luật 7): quên truyền là cổng huỷ mở đúng lúc khách có thể đã quẹt.
   */
  coDongTheChuaKetLuan: boolean;
  /** Phiếu gộp của phiếu thẻ còn `OPEN` (`paymentBill.status === "OPEN"`). */
  phieuGopConMo: boolean;
  /** `phieuPosHetHan(expiresAt, now)` — phiếu còn trạng thái mở nhưng đã quá hạn (poller sẽ ghi HET_HAN). */
  daHetHan: boolean;
};

export type KetQuaChoPhepHuyPhieuThe =
  /**
   * Cho huỷ. `canXacNhanManh` = hộp xác nhận in `CAU_XAC_NHAN_MANH_HUY_PHIEU_THE` + ô tick bắt buộc, gửi
   * `xacNhanKhachChuaQuet: true`; máy chủ ném `CAU_THIEU_XAC_NHAN_MANH` khi thiếu. Hôm nay LUÔN `true` (V4.3: không có ca
   * nào chứng minh được "khách chưa quẹt thành công"); trường giữ trong hợp đồng để thêm một ca chứng minh được sau này
   * mà không đổi hình dạng kết quả — màn đọc trường, KHÔNG hard-code.
   */
  | { huyDuoc: true; canXacNhanManh: boolean }
  /** Không huỷ. `ma` để nhánh logic/test; `lyDo` + `viecNenLam` là CÂU (ghép bằng `ghepCauTuChoiHuy`). */
  | { huyDuoc: false; ma: MaTuChoiHuyPhieuThe; lyDo: string; viecNenLam: string };

/**
 * Kết quả của `huyPhieuTheAction` — hình DẸT như ba action thu thẻ POS cùng tệp (`taoPhieuPosAction` …): màn đọc
 * `res.ok` / `res.error`, không phải `ActionResult<T>` của factory (hình `{ error: { code, message } }`; factory chưa có
 * consumer nào ở màn đơn hàng — V4.5).
 */
export type KetQuaHuyPhieuThe = { ok: true; intentId: string; code5: string } | { ok: false; error: string };

/**
 * Câu đã lưu có phải câu của kết luận "CHƯA THẤY" TRẦN cho ĐÚNG mã này không.
 *
 * Vì sao phải đọc câu: `lastResultKind = NOT_FOUND` gom cả bốn kết luận khác nhau về rủi ro — "chưa thấy" trần
 * (`CHUA_THAY`), dòng mang mã chưa ngã ngũ (`DANG_CHO_NGAN_HANG`), máy đồng bộ có dòng bị từ chối
 * (`MAY_KHONG_DOC_DUOC`), máy đồng bộ chưa trả lời kịp (`DANG_DONG_BO`). Ba kết luận sau đều nói "ĐỪNG cho quẹt lại"
 * (khách có thể đã bị trừ tiền) ⇒ không huỷ. Provider không đặt `reasonCode` cho chúng (đo `tcb-agent.ts`,
 * `doc-du-lieu.ts`) nên nhật ký kiểm cũng không phân biệt được; không có cột nào khác. Không migration: nhận ra bằng câu,
 * qua CHÍNH hàm dựng câu (`dauCauChuaThay`), và FAIL-CLOSED — câu trống/lạ/của mã khác ⇒ `false` ⇒ không huỷ.
 *
 * Khớp theo TIỀN TỐ + ký tự ngay sau mã phải là dấu chấm ⇒ mã `WT9GX` không nhận câu của mã `WT9GXA`.
 */
export function laCauChuaThayTran(cau: string | null, code5: string): boolean {
  return cau !== null && cau.startsWith(dauCauChuaThay(code5));
}

/**
 * VIỆC 6 — câu đã lưu có phải CÂU `tuChoiSaiMa` (Việc 3) vừa ghi sau khi kế toán TỪ CHỐI một yêu cầu "nhập sai mã" không. MỘT hàm cho cả màn (`dungPhieuPosView`, từ `saiMaYeuCau[0]`) lẫn máy chủ
 * (`huyPhieuThe`, từ `yeuCauSaiMaMoiNhat(tx, …)`): hai nơi tự nhận ra câu là hai nơi có ngày cãi nhau về nút huỷ.
 *
 * Đúng khi CẢ BA vế cùng đứng:
 *   (a) có yêu cầu MỚI NHẤT, và nó ở trạng thái `TU_CHOI` — yêu cầu SỐNG mới hơn (gửi lại sau khi bị bác) thì câu cũ không còn nói về trạng thái hiện tại;
 *   (b) câu lưu KHÔNG `null`;
 *   (c) câu lưu BẰNG `cauTuChoi(lyDoTuChoi của CHÍNH yêu cầu ấy)` — so ĐÚNG CHUỖI, không so tiền tố: ai nối thêm chữ vào câu từ chối thì cờ tắt (fail-closed ⇒ `CHUA_NGA_NGU`), không bật nhầm.
 * Lượt kiểm SAU từ chối (poller · nút Kiểm tra · đồng bộ sau nhập) ghi đè câu lưu ⇒ (c) sai ⇒ cờ tắt: thông tin mới hơn thắng. `lyDoTuChoi = null` (dữ liệu cũ) vẫn nhận ra vì hai phía cùng gọi
 * `cauTuChoi(null)`. Hàm KHÔNG chạm DB, KHÔNG đọc đồng hồ.
 */
export function laCauLuuTuChoiSaiMa(x: {
  /** `PosPaymentIntent.lastResultMessage` đọc CÙNG LÚC với yêu cầu (màn: hàng thô; máy chủ: đọc lại dưới khoá). */
  lastResultMessage: string | null;
  /** Yêu cầu "nhập sai mã" MỚI NHẤT của CHÍNH phiếu thẻ này (`createdAt desc, take 1`), hoặc `null` khi chưa từng có. */
  yeuCauMoiNhat: { trangThai: TrangThaiSaiMa; lyDoTuChoi: string | null } | null;
}): boolean {
  const yc = x.yeuCauMoiNhat;
  return yc !== null && yc.trangThai === "TU_CHOI" && x.lastResultMessage !== null && x.lastResultMessage === cauTuChoi(yc.lyDoTuChoi);
}

function tuChoi(ma: MaTuChoiHuyPhieuThe): KetQuaChoPhepHuyPhieuThe {
  return { huyDuoc: false, ma, ...CAU_TU_CHOI_HUY_PHIEU_THE[ma] };
}

/**
 * Phiếu thẻ này huỷ tay được không. Thứ tự: RỦI RO TIỀN nói trước (trạng thái có tiền → dấu hiệu tiền đang bay → kết
 * quả máy), rồi mới tới "không còn gì để huỷ" (cấu trúc). Một phiếu vừa quá hạn vừa lỗi kết nối phải nghe "lỗi kết nối".
 */
export function choPhepHuyPhieuThe(v: DauVaoChoPhepHuyPhieuThe): KetQuaChoPhepHuyPhieuThe {
  // ① Trạng thái ĐÃ ĐÓNG — tiền đã vào / đang chờ kế toán, hoặc phiếu đã hết đường.
  if (v.status === "DA_THU") return tuChoi("DA_THU");
  if (v.status === "LECH_TIEN") return tuChoi("LECH_TIEN");
  if (v.status === "CAN_XU_LY") return tuChoi("CAN_XU_LY");
  if (v.status === "HUY") return tuChoi("DA_HUY");
  if (v.status === "HET_HAN") return tuChoi("DA_HET_HAN");

  // ② Phiếu MỞ (CHO_QUET / THAT_BAI) nhưng có DẤU HIỆU TIỀN ĐANG BAY.
  if (v.daNhanGiaoDich) return tuChoi("DA_NHAN_GIAO_DICH");
  if (v.coGiaoDichChoTay) return tuChoi("CO_GIAO_DICH_CHO_TAY");
  if (v.coYeuCauSaiMaDangGiu) return tuChoi("CO_YEU_CAU_SAI_MA");
  if (v.coDongTheChuaKetLuan) return tuChoi("DONG_THE_CHUA_NGA_NGU");

  // ③ Kết quả lượt kiểm gần nhất. Mặc định AN TOÀN: chỉ ba loại cho qua (null · FAILED · "chưa thấy" TRẦN); MỌI loại khác —
  // kể cả một `kind` mới thêm sau này mà không ai nhớ vào đây — rơi xuống `LOI_KET_NOI` (fail-closed).
  // VIỆC 6: NOT_FOUND mà câu lưu là CÂU TỪ CHỐI của `tuChoiSaiMa` (cờ `cauLuuLaCauTuChoiSaiMa`) cũng cho qua — câu ấy không nói "đang xử lý", nó chỉ là chữ hiện ngay sau từ chối.
  const kind = v.lastResultKind;
  if (kind === null || kind === "FAILED") {
    // cho qua: chưa kiểm lần nào / máy đã báo lần quẹt gần nhất THẤT BẠI
  } else if (kind === "NOT_FOUND") {
    if (!laCauChuaThayTran(v.lastResultMessage, v.code5) && !v.cauLuuLaCauTuChoiSaiMa) return tuChoi("CHUA_NGA_NGU");
  } else if (kind === "PAID" || kind === "PAID_AMOUNT_MISMATCH") {
    // Thấy giao dịch mà phiếu vẫn MỞ. Hai đường thật dẫn tới cùng cặp cột: pha tiền NÉM (phiếu giữ CHO_QUET/THAT_BAI) và
    // BO_QUA "đã huỷ/thất bại trên máy" (luôn chuyển phiếu sang THAT_BAI). CHO_QUET ⇒ chắc chắn là nguồn thứ nhất;
    // THAT_BAI ⇒ hai nguồn, không phân biệt được bằng cột ⇒ fail-closed nhưng bằng câu TRUNG TÍNH (V4.4).
    return tuChoi(v.status === "THAT_BAI" ? "KET_QUA_PAID_SAU_THAT_BAI" : "KET_QUA_PAID_CHUA_GHI");
  } else if (kind === "CANCELLED_AFTER_PAID") {
    return tuChoi("HUY_SAU_THU");
  } else {
    return tuChoi("LOI_KET_NOI"); // PROVIDER_ERROR — chưa biết gì; và mọi kind lạ (fail-closed)
  }
  // null · FAILED · NOT_FOUND "chưa thấy" trần: cho qua — nhưng KHÔNG chứng minh được "khách chưa quẹt" (V4.3).

  // ④ Cấu trúc — không còn gì để huỷ.
  if (!v.phieuGopConMo) return tuChoi("PHIEU_GOP_DA_DONG");
  if (v.daHetHan) return tuChoi("QUA_HAN_CHO_DONG");

  return { huyDuoc: true, canXacNhanManh: true };
}
