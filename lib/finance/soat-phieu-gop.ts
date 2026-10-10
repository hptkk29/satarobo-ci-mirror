// lib/finance/soat-phieu-gop.ts — PHIẾU GỘP ĐANG MỞ TRÊN ĐỢT ĐÃ HUỶ. THUẦN.
//
// Tầng DB: `soat-phieu-gop-db.ts` (gọi từ `recomputeRequestStatuses` — năm đường VOID đợt đều
// gọi nó sau khi VOID — và từ `huyDotChoCon`, đường VOID đợt duy nhất không đi qua đó).
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ TỆP NÀY — rà đối kháng vòng 3, 30/09/2026 (docs/pos-the-smartpos.md)
//
// Phiếu gộp chụp số lúc phát, còn các ĐỢT của nó sống tiếp và bị VOID dưới chân nó bởi năm đường
// không biết phiếu gộp tồn tại: lưu / từ chối kế hoạch trả góp (VOID đợt "thu toàn đơn" hoặc đợt
// theo kế hoạch), huỷ đợt, miễn giảm, thêm con (VOID rồi tạo lại). Phiếu OPEN có dòng trỏ đợt
// VOID ⇒ trang đơn vẫn mời khách trả trọn số cũ, và `thuTheoPhieuGop` rót tiền vào đợt VOID rồi
// ghi thêm một `Payment` ⇒ Σ Payment gấp đôi học phí (ca `[V3-01]`: gỡ gắn mở lại phiếu R0 → lưu
// kế hoạch VOID R0 → khách trả lần hai).
//
// Luật: có dòng trỏ đợt VOID ⇒ HUỶ (VOID) nếu phiếu chưa nhận đồng nào, ĐÓNG (CLOSED) nếu đã
// nhận — đúng ranh giới chủ dự án chốt cho phiếu gộp (*"Huỷ phiếu chỉ khi chưa nhận đồng nào; đã
// nhận một phần → Đóng phiếu"*), và đúng nhánh `dung-hoc-con.ts` vẫn tự chọn khi dừng học.
//
// ⚠️ CỐ Ý KHÔNG tự đặt PAID cho phiếu OPEN đã đủ tiền từ ĐƯỜNG KHÁC (gắn tay, mã đời cũ). Đã thử
// và `[POS-DB-21b]` đỏ đúng chỗ: PAID là trạng thái lượt gỡ gắn KHÔNG đảo lại được (nó chỉ mở lại
// phiếu mang nhãn của chính giao dịch bị gỡ) ⇒ gỡ khoản "đường khác" xong phiếu vẫn nói "ĐÃ THU
// ĐỦ" trong khi đợt đã về nợ. Phiếu OPEN 0đ do `docPhieuGopDangMo` giấu đi và `taoPhieuGop` tự
// khép lại lúc phát phiếu mới — xem hai chỗ đó.

export type DichPhieuMo = "VOID" | "CLOSED";

export function quyetPhieuMo(x: { daNhan: number; coDotDaHuy: boolean }): { dich: DichPhieuMo; lyDo: string } | null {
  if (!x.coDotDaHuy) return null;
  return x.daNhan > 0
    ? { dich: "CLOSED", lyDo: "Phiếu có đợt đã bị huỷ — đóng phiếu (đã nhận một phần), mã cũ không thu tiếp" }
    : { dich: "VOID", lyDo: "Phiếu có đợt đã bị huỷ — huỷ phiếu (chưa nhận đồng nào), phát lại mã mới cho phần còn nợ" };
}

/**
 * Phiếu OPEN có đợt vừa bị ĐỔI SỐ TIỀN (sửa kế hoạch) — rà vòng 5 (30/09/2026, ca `[V5-41]`). Mã
 * của cả nhà in số chụp lúc phát; đợt đổi số ⇒ còn phải thu đổi mà mã giữ nguyên ⇒ phụ huynh chuyển
 * theo QR đã nhận thì LECH_SO. Cùng ranh giới HUỶ/ĐÓNG với `quyetPhieuMo` (đã nhận đồng nào chưa).
 */
export function quyetPhieuDoiSo(x: { daNhan: number }): { dich: DichPhieuMo; lyDo: string } {
  return x.daNhan > 0
    ? { dich: "CLOSED", lyDo: "Phiếu có đợt vừa đổi số tiền (sửa kế hoạch) — đóng phiếu (đã nhận một phần), mã cũ in số cũ" }
    : { dich: "VOID", lyDo: "Phiếu có đợt vừa đổi số tiền (sửa kế hoạch) — huỷ phiếu (chưa nhận đồng nào), phát lại mã đúng số mới" };
}

/** Hình dạng tối thiểu của một phiếu vừa bị soát — `PhieuDaSoat` (tầng DB) khớp cấu trúc. */
export type PhieuDaSoatTom = { ma: string | null; dich: DichPhieuMo };

/**
 * Câu báo NGƯỜI BẤM sau một lượt VOID đợt (huỷ đợt, miễn giảm, thêm con, lưu / duyệt / từ chối kế
 * hoạch) — `null` khi không phiếu nào bị đụng. Rà vòng 4 (30/09/2026, luật 12): phiếu gộp trải
 * trên NHIỀU bé, nên huỷ một đợt là huỷ cả mã QR đã gửi phụ huynh; toast chỉ nói "Đã huỷ đợt" thì
 * sale không biết phải phát mã mới, phụ huynh quét QR cũ ⇒ tiền về hàng chờ.
 */
export function thongDiepPhieuDaSoat(ds: readonly PhieuDaSoatTom[]): string | null {
  if (ds.length === 0) return null;
  const cau = ds.map((p) => {
    const ten = p.ma ? `Phiếu gộp ${p.ma}` : "Phiếu gộp";
    return p.dich === "VOID" ? `${ten} đã HUỶ` : `${ten} đã ĐÓNG (đã nhận một phần, mã cũ không thu tiếp)`;
  });
  return `${cau.join(" · ")} — phát mã mới cho phần còn nợ, báo phụ huynh bỏ QR cũ.`;
}

/**
 * Câu báo sau lượt HUỶ ĐƠN (rà vòng 5) — khác `thongDiepPhieuDaSoat` ở vế việc phải làm: đơn đã
 * huỷ thì KHÔNG "phát mã mới cho phần còn nợ" (câu đó là lời mời thu tiền của một đơn đã bỏ).
 */
export function thongDiepPhieuKhiHuyDon(ds: readonly PhieuDaSoatTom[]): string | null {
  if (ds.length === 0) return null;
  const cau = ds.map((p) => {
    const ten = p.ma ? `Phiếu gộp ${p.ma}` : "Phiếu gộp";
    return p.dich === "VOID" ? `${ten} đã HUỶ` : `${ten} đã ĐÓNG (đã nhận một phần — kế toán xử lý hoàn)`;
  });
  return `${cau.join(" · ")} — báo phụ huynh bỏ QR cũ; tiền chuyển theo mã đó sẽ không vào đơn.`;
}

/** Hình dạng tối thiểu của phiếu gộp ĐANG MỞ mà màn nói-trước cần — `PhieuGopView` khớp cấu trúc. */
export type PhieuMoTom = {
  ma: string;
  /** Σ đã rót vào các đợt của phiếu. > 0 ⇒ phiếu chỉ ĐÓNG được, không huỷ được. */
  daNhan: number;
  dong: readonly { paymentRequestId: string }[];
};

export type CanhBaoTruocPhieu = {
  ma: string;
  dich: DichPhieuMo;
  /** Số đợt của phiếu mà thao tác sẽ huỷ. */
  soDotCham: number;
  /** Một dòng, in đậm trên hộp — sự thật duy nhất người bấm cần biết ngay. */
  tieuDe: string;
  /** Hệ quả + việc phải làm sau. */
  chiTiet: string;
  /** `tieuDe — chiTiet`, cho toast. */
  cau: string;
};

/**
 * NÓI TRƯỚC khi bấm — rà vòng 4 (30/09/2026, luật 12). MỘT hàm cho MỌI thao tác VOID đợt (huỷ
 * đợt, miễn giảm, thêm con, lưu kế hoạch trả góp): mỗi màn chỉ việc đưa vào DANH SÁCH ĐỢT SẼ BỊ
 * VOID (tính bằng đúng hàm mà đường ghi dùng), còn điều kiện "đợt nằm trong phiếu ⇒ phiếu HUỶ hay
 * ĐÓNG" và câu chữ sống ở đây — nhân bản ra ba màn là ba bản lệch nhau ở lần sửa đầu tiên.
 *
 * Luật HUỶ/ĐÓNG là `quyetPhieuMo` — CÙNG hàm `soatPhieuGopMoTrongTx` dùng sau khi ghi, nên lời
 * nói trước và việc máy làm không thể nói hai giọng. `null` khi không đợt nào của phiếu bị chạm.
 */
export function canhBaoTruocVoidDot(
  phieu: PhieuMoTom | null | undefined,
  seHuy: readonly string[],
  /**
   * Đợt sẽ bị ĐỔI SỐ TIỀN (chỉ màn sửa kế hoạch có — `dotSeDoiSoKhiApKeHoach`). Rà vòng 5: đổi số
   * cũng làm đường ghi huỷ/đóng phiếu (`quyetPhieuDoiSo`, cùng ranh giới) — chỉ khác câu chữ.
   */
  doiSo: readonly string[] = [],
): CanhBaoTruocPhieu | null {
  if (!phieu || (seHuy.length === 0 && doiSo.length === 0)) return null;
  const huy = new Set([...seHuy, ...doiSo]);
  const soDotCham = phieu.dong.filter((d) => huy.has(d.paymentRequestId)).length;
  if (soDotCham === 0) return null;
  const coDoiSo = phieu.dong.some((d) => doiSo.includes(d.paymentRequestId));
  const q = quyetPhieuMo({ daNhan: phieu.daNhan, coDotDaHuy: true });
  const dich: DichPhieuMo = q?.dich ?? "VOID";
  const tieuDe = `Mã phiếu ${phieu.ma} của cả nhà sẽ bị ${dich === "CLOSED" ? "ĐÓNG" : "HUỶ"}`;
  const dotCham = soDotCham === phieu.dong.length ? "mọi đợt" : `${soDotCham}/${phieu.dong.length} đợt`;
  const daNhan =
    dich === "CLOSED"
      ? ` Phiếu đã nhận ${Math.round(phieu.daNhan).toLocaleString("vi-VN")}đ nên chỉ đóng, số đã nhận giữ nguyên.`
      : "";
  const chiTiet =
    `Thao tác này ${coDoiSo ? "huỷ / đổi số tiền" : "huỷ"} ${dotCham} của phiếu, mã QR đã gửi phụ huynh sẽ không thu được nữa.${daNhan}` +
    " Làm xong: phát mã mới cho phần còn nợ, báo phụ huynh bỏ QR cũ.";
  return { ma: phieu.ma, dich, soDotCham, tieuDe, chiTiet, cau: `${tieuDe} — ${chiTiet}` };
}

/**
 * NÓI TRƯỚC cho thao tác trên MỘT BÉ mà đường ghi huỷ/đóng CẢ phiếu gộp đang mở có dòng của bé (bước 2
 * của `dungHocTrongTx` — dừng học, đổi khoá). Rà vòng 5 (`[V5-10]`, luật 12): đầu vào là bản xem
 * trước MÁY CHỦ tính bằng `docPhieuGopChoXemTruoc` — cùng hàm đường ghi dùng, nên màn không tự đoán.
 */
export function canhBaoTruocPhieuCuaCon(
  p: { ma: string | null; daNhan: number; hanhDong: "HUY" | "DONG" } | null | undefined,
): CanhBaoTruocPhieu | null {
  if (!p) return null;
  const dich: DichPhieuMo = p.hanhDong === "DONG" ? "CLOSED" : "VOID";
  const ma = p.ma ?? "(không mã)";
  const tieuDe = `Mã phiếu ${ma} của cả nhà sẽ bị ${dich === "CLOSED" ? "ĐÓNG" : "HUỶ"}`;
  const daNhan =
    dich === "CLOSED" ? ` Phiếu đã nhận ${Math.round(p.daNhan).toLocaleString("vi-VN")}đ nên chỉ đóng, số đã nhận giữ nguyên.` : "";
  const chiTiet =
    `Bé có đợt nằm trong phiếu gộp của gia đình — cả mã (gồm phần của các bé khác) sẽ không thu được nữa.${daNhan}` +
    " Làm xong: phát mã mới cho phần còn nợ, báo phụ huynh bỏ QR cũ.";
  return { ma, dich, soDotCham: 0, tieuDe, chiTiet, cau: `${tieuDe} — ${chiTiet}` };
}

/**
 * NÓI TRƯỚC cho hộp "Đổi trạng thái → Đã huỷ" (rà vòng 5). Huỷ đơn VOID MỌI đợt còn mở ⇒ mọi dòng
 * của phiếu gộp đang mở bị chạm. Dùng CÙNG `canhBaoTruocVoidDot` (luật HUỶ/ĐÓNG = `quyetPhieuMo`),
 * chỉ thay câu việc-phải-làm: đơn huỷ thì không phát mã mới.
 */
export function canhBaoTruocHuyDon(phieu: PhieuMoTom | null | undefined): CanhBaoTruocPhieu | null {
  const cb = canhBaoTruocVoidDot(phieu, phieu ? phieu.dong.map((d) => d.paymentRequestId) : []);
  if (!cb) return null;
  const daNhan =
    cb.dich === "CLOSED"
      ? ` Phiếu đã nhận ${Math.round(phieu?.daNhan ?? 0).toLocaleString("vi-VN")}đ nên chỉ đóng — kế toán xử lý hoàn.`
      : "";
  const chiTiet = `Huỷ đơn huỷ mọi đợt còn mở; mã QR đã gửi phụ huynh sẽ không thu được nữa.${daNhan} Báo phụ huynh bỏ QR cũ.`;
  return { ...cb, chiTiet, cau: `${cb.tieuDe} — ${chiTiet}` };
}

/**
 * Nhãn nút xác nhận KÈM hệ quả khi thao tác chạm phiếu gộp — "Miễn giảm · huỷ mã K7M2N". Nút là
 * lời hứa (luật 12): ô cảnh báo có thể bị cuộn khuất, cái nút thì người bấm chắc chắn đọc.
 */
export function nhanNutKemPhieu(nhan: string, canhBao: CanhBaoTruocPhieu | null): string {
  if (!canhBao) return nhan;
  return `${nhan} · ${canhBao.dich === "CLOSED" ? "đóng" : "huỷ"} mã ${canhBao.ma}`;
}
