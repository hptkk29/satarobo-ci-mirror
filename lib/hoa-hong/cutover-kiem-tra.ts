// lib/hoa-hong/cutover-kiem-tra.ts — PRECHECK của hành động đặt mốc cutover: bốn điều kiện bằng chứng + câu chữ cho người vận hành. THUẦN.
//
// Nguồn: docs/source-commission/05 §2.2c, §7.5 (bước 2–3), 08 §11 bước 7. Hướng D của đợt UAT cutover.
//
// ── Precheck là MỘT PHẦN của cổng, không phải một bước gọi trước ───────────────────────────────────────────────
// `quyetDinhDatMoc` (cutover.ts) nhận bốn con số này trong `DauVaoDatMoc` và gọi `cacChanPrecheck` — nên nút «Xác nhận», `datMocCutover` và ca test cùng đi
// qua MỘT cổng. Một cổng nằm ngoài hàm ghi là một cổng mà đường gọi thứ hai (script, action khác) quên gọi.
//
// ── Bốn con số, và vì sao KHÔNG mặc định ───────────────────────────────────────────────────────────────────────
//   · `invalidAttribution`     lead mà công cụ di trú xếp INVALID (nhãn cũ không có trong bảng ánh xạ) — Invalid > 0 ⇒ chưa biết nguồn của chúng.
//   · `holdNghiemTrongDuKien`  hàng chờ mà engine mới SẼ ghi, đếm TỪ KẾT QUẢ SO BÓNG. KHÔNG đếm bảng `CommissionHold`: trước cutover engine tắt nên bảng đó luôn 0
//                              — một cổng đếm bảng ấy chỉ kiểm sự vắng mặt và luôn qua.
//                              ⚠️ TÊN nói «nghiêm trọng» nhưng SỐ ĐẾM là MỌI hàng chờ dự kiến, kể cả mức SOFT (`baoCao.hold.tong`, không lọc `mucDo`): over-block CÓ CHỦ Ý — fail-closed, ghi là việc mở
//                              ở docs/source-commission/05; nới thành «chỉ HARD» là quyết định của chủ dự án, không phải của tệp này. KHÔNG đổi tên trường: nó nằm trong audit `bangChung`, dấu vân và
//                              lịch sử đặt mốc. Chỉ đếm DỰ KIẾN trong cửa sổ so bóng — chưa đọc bảng `CommissionHold` thật (với DOI_SOM, nơi engine đã chạy từ một mốc cũ, hàng chờ thật chưa được tính).
//   · `unexpectedDelta`        số dòng so bóng UNEXPECTED (so-bong.ts).
//   · `diTruChuaSanSang`       thiếu bảng quy nguồn · thiếu dòng danh mục gốc · nối đơn về lead còn nhiều lead cùng số.
// Kiểu `number | null` / `boolean | null`: `null` = KHÔNG ĐO, và với hành động cần precheck thì «không đo» là CHẶN (không bao giờ rơi về 0 — số 0 là một câu trả lời).
// Chỗ gọi nói rõ «hành động này không cần bằng chứng» bằng cách truyền `null` cho cả bốn (DOI_MUON · GO).
//
// ⚠️ Chỉ `DAT_LAN_DAU` và `DOI_SOM` đòi precheck: hai hành động ấy GIAO thêm tháng cho engine mới. `DOI_MUON` / `GO` rút lại phần đã giao — chúng giữ cổng
// «không có dòng sổ mới trong vùng bị nhả» (cutover.ts) và không cần chứng minh engine mới đúng.
import type { HanhDongDatMoc } from "./cutover-kieu";
import { dinhDangSo } from "./vi-sao";

/** Hành động nào đòi precheck. MỘT chỗ — `quyetDinhDatMoc`, trang xem trước và ca test cùng hỏi hàm này. */
export function hanhDongCanPrecheck(h: HanhDongDatMoc | null): h is "DAT_LAN_DAU" | "DOI_SOM" {
  return h === "DAT_LAN_DAU" || h === "DOI_SOM";
}

/** Bốn con số bằng chứng. Mỗi trường `null` = KHÔNG ĐO. */
export type BangChungDoDuoc = {
  invalidAttribution: number | null;
  holdNghiemTrongDuKien: number | null;
  unexpectedDelta: number | null;
  diTruChuaSanSang: boolean | null;
};

/** Cả bốn trường `null` — dành riêng cho hành động KHÔNG đòi precheck. Đặt tên để chỗ gọi viết ra điều mình đang làm. */
export const KHONG_DO_BANG_CHUNG: BangChungDoDuoc = { invalidAttribution: null, holdNghiemTrongDuKien: null, unexpectedDelta: null, diTruChuaSanSang: null };

export const MA_CHAN_PRECHECK = ["THIEU_BANG_CHUNG", "CO_INVALID_NGUON", "CO_HOLD_DU_KIEN", "CO_CHENH_BAT_NGO", "DI_TRU_CHUA_SAN_SANG"] as const;
export type MaChanPrecheck = (typeof MA_CHAN_PRECHECK)[number];

export type VanDeChan = {
  /** Mã precheck (`MaChanPrecheck`) hoặc mã cổng nghiệp vụ của mốc (`quyetDinhDatMoc`) — cùng một danh sách hiện ra cho người đọc. */
  ma: string;
  /** Tiếng Việt, đủ để người đọc hiểu vì sao bị chặn (có số). */
  lyDo: string;
  /** Ai sửa. Vai NGHIỆP VỤ, không phải mã RoleDef. */
  aiSua: string;
  /** Sửa ở đâu. */
  noiSua: string;
};

/** Chi tiết phụ của «di trú chưa sẵn sàng» — chỉ để câu chữ cụ thể; không đổi quyết định chặn. */
export type ChiTietDiTru = {
  thieuBangQuyNguon: boolean;
  thieuDanhMuc: readonly string[];
  /** Số đơn chưa có lead mà số điện thoại khớp NHIỀU lead (nối đơn không tự quyết được). */
  noiDonNhieu: number;
};

const dem = (n: number): string => dinhDangSo(n);

/**
 * Các điều kiện CHẶN, theo thứ tự ưu tiên. Rỗng = qua. `chiTiet` chỉ làm câu chữ cụ thể hơn.
 * Thứ tự cố định: thiếu bằng chứng trước (không đọc được con số thì các con số còn lại không đáng tin), rồi Invalid, hàng chờ, chênh bất ngờ, di trú.
 */
export type ChanPrecheck = VanDeChan & { ma: MaChanPrecheck };

export function cacChanPrecheck(b: BangChungDoDuoc, chiTiet: ChiTietDiTru | null = null): ChanPrecheck[] {
  const ra: ChanPrecheck[] = [];
  const thieu = [
    b.invalidAttribution === null ? "số lead Invalid" : null,
    b.holdNghiemTrongDuKien === null ? "số hàng chờ dự kiến" : null,
    b.unexpectedDelta === null ? "số chênh ngoài dự kiến" : null,
    b.diTruChuaSanSang === null ? "tình trạng di trú nguồn" : null,
  ].filter((x): x is string => x !== null);
  if (thieu.length > 0) {
    ra.push({
      ma: "THIEU_BANG_CHUNG",
      lyDo: `Chưa đo được: ${thieu.join(", ")}. Không đo được thì không được coi là đạt.`,
      aiSua: "Quản trị hệ thống",
      noiSua: "Tải lại trang để đo lại; nếu vẫn thiếu, báo bộ phận kỹ thuật.",
    });
  }
  if (b.invalidAttribution !== null && b.invalidAttribution > 0) {
    ra.push({
      ma: "CO_INVALID_NGUON",
      lyDo: `Còn ${dem(b.invalidAttribution)} lead mà công cụ di trú xếp loại Invalid (nhãn nguồn cũ không có trong bảng ánh xạ) — chưa biết nguồn của chúng.`,
      aiSua: "Quản trị hệ thống cùng người phụ trách dữ liệu lead",
      noiSua: "Báo cáo di trú nguồn (docs/source-commission/08 §11 bước 13), mục «Invalid»: thêm nhãn vào bảng ánh xạ rồi chạy lại.",
    });
  }
  if (b.holdNghiemTrongDuKien !== null && b.holdNghiemTrongDuKien > 0) {
    ra.push({
      ma: "CO_HOLD_DU_KIEN",
      lyDo: `Engine mới sẽ ghi ${dem(b.holdNghiemTrongDuKien)} hàng chờ vì thiếu dữ liệu (khoản thu chưa gắn bé / đơn không có lead / thiếu người phụ trách…) — đếm MỌI mức, kể cả hàng chờ mềm. Tính trên kết quả so bóng của cửa sổ đang xem.`,
      aiSua: "Kế toán và Quản lý cơ sở (khoản thu, đơn) · Sale Admin (lead) · Quản trị hệ thống (người phụ trách nguồn)",
      noiSua: "Bảng «Khoản chưa tính được» ở khối Tác động phía trên cho biết mã và số lượng; sửa dữ liệu ở màn Đơn hàng / Lead / Nguồn rồi xem trước lại.",
    });
  }
  if (b.unexpectedDelta !== null && b.unexpectedDelta > 0) {
    ra.push({
      ma: "CO_CHENH_BAT_NGO",
      lyDo: `Còn ${dem(b.unexpectedDelta)} dòng chênh giữa engine cũ và mới KHÔNG nằm trong danh sách chấp nhận. Mọi chênh khác danh sách — kể cả chênh một phần, kể cả 1 đồng — đều chặn.`,
      aiSua: "Quản trị hệ thống cùng Kế toán trưởng",
      noiSua: "Bảng «Chênh lệch ngoài dự kiến» ở khối Tác động phía trên: sửa dữ liệu / chính sách, hoặc đưa một mã vào danh sách chấp nhận bằng quyết định có văn bản (lib/hoa-hong/so-bong.ts).",
    });
  }
  if (b.diTruChuaSanSang === true) {
    const ly: string[] = [];
    if (chiTiet?.thieuBangQuyNguon) ly.push("chưa có bảng quy nguồn (migration chưa chạy)");
    if (chiTiet && chiTiet.thieuDanhMuc.length > 0) ly.push(`thiếu ${dem(chiTiet.thieuDanhMuc.length)} dòng danh mục nguồn gốc (${chiTiet.thieuDanhMuc.join(", ")})`);
    if (chiTiet && chiTiet.noiDonNhieu > 0) ly.push(`còn ${dem(chiTiet.noiDonNhieu)} đơn mà số điện thoại khớp nhiều lead nên chưa nối được`);
    ra.push({
      ma: "DI_TRU_CHUA_SAN_SANG",
      lyDo: `Di trú nguồn chưa sẵn sàng${ly.length > 0 ? `: ${ly.join("; ")}` : " (công cụ di trú báo chưa sẵn sàng)"}.`,
      aiSua: "Quản trị hệ thống (chạy tay trên prod, luật cứng #4) cùng Sale Admin (gộp lead trùng)",
      noiSua: "Runbook 08 §11 bước 12–13: nối đơn về lead (noi-don-ve-lead-prod) và di trú nguồn lead cũ; xong chạy xem trước lại.",
    });
  }
  return ra;
}

/** Chữ cho một mã chặn khi chỉ có mã (thông báo lỗi của `quyetDinhDatMoc`). */
export function chanDauTien(b: BangChungDoDuoc, chiTiet: ChiTietDiTru | null = null): ChanPrecheck | null {
  return cacChanPrecheck(b, chiTiet)[0] ?? null;
}

// ── Cổng NGHIỆP VỤ của mốc (không phải precheck) — cùng khuôn «mã · lý do · ai sửa · sửa ở đâu» để trang xem trước hiện chung một danh sách ───────────────

const HUONG_DAN_CONG: Readonly<Record<string, { aiSua: string; noiSua: string }>> = {
  MOC_SAI_DANG: { aiSua: "Người đặt mốc", noiSua: "Chọn lại tháng ở ô «Mốc đề xuất»." },
  MOC_KHONG_DOI: { aiSua: "Người đặt mốc", noiSua: "Chọn một tháng khác mốc hiện tại." },
  MOC_KHONG_O_TUONG_LAI: { aiSua: "Người đặt mốc", noiSua: "Chọn tháng SAU tháng hiện tại (giờ Việt Nam) — mốc không được đặt cho tháng đã bắt đầu." },
  CO_BANG_KE_CU: { aiSua: "Kế toán trưởng cùng Quản trị hệ thống", noiSua: "Màn Hoa hồng cũ (/crm/commission): đường cũ phải ngừng tại tháng này — không còn bảng kê cho tháng ≥ mốc." },
  THIEU_MANIFEST: { aiSua: "Quản trị hệ thống (chạy tay, luật cứng #4)", noiSua: "Dựng lại manifest cho kỳ đã duyệt thiếu danh sách khoản (05 §2.2c bước 3, 04 §3.1) rồi xem trước lại." },
  CO_DONG_SO_MOI: { aiSua: "Kế toán trưởng", noiSua: "Không dời/gỡ mốc khi sổ mới đã có dòng: tắt engine nếu cần dừng, sửa sai bằng dòng điều chỉnh (05 §7.6)." },
};

/** Đưa một mã từ chối của `quyetDinhDatMoc` về khuôn `VanDeChan`. Mã lạ vẫn hiện (lý do gốc), chỉ thiếu hướng dẫn. */
export function vanDeChanCuaCong(ma: string, lyDo: string): VanDeChan {
  const h = HUONG_DAN_CONG[ma];
  return { ma, lyDo, aiSua: h?.aiSua ?? "Quản trị hệ thống", noiSua: h?.noiSua ?? "Xem lý do bên cạnh." };
}

/**
 * Kết luận «sẵn sàng đặt mốc chưa» cho trang xem trước: gộp lỗi cổng nghiệp vụ (nếu có) với toàn bộ vấn đề precheck, kèm cảnh báo không chặn.
 * `sanSang` = KHÔNG còn vấn đề nào VÀ cổng đầy đủ (`quyetDinh`) cũng cho qua — nút xác nhận chỉ bật theo giá trị này.
 */
export function danhGiaSanSang(i: {
  hanhDong: HanhDongDatMoc | null;
  quyetDinh: { ok: true } | { ok: false; ma: string; lyDo: string };
  bangChung: BangChungDoDuoc;
  chiTiet: ChiTietDiTru | null;
  canhBao: readonly string[];
}): { chan: VanDeChan[]; canhBao: string[]; sanSang: boolean } {
  const chan: VanDeChan[] = [];
  const precheck = hanhDongCanPrecheck(i.hanhDong) ? cacChanPrecheck(i.bangChung, i.chiTiet) : [];
  if (!i.quyetDinh.ok && !MA_CHAN_PRECHECK.includes(i.quyetDinh.ma as MaChanPrecheck)) chan.push(vanDeChanCuaCong(i.quyetDinh.ma, i.quyetDinh.lyDo));
  chan.push(...precheck);
  return { chan, canhBao: [...i.canhBao], sanSang: chan.length === 0 && i.quyetDinh.ok };
}
