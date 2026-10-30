// lib/ai-lead/dich-vu/hanh-dong-kha-dung.ts — NÚT NÀO HIỆN, NÚT NÀO SÁNG, VÌ SAO TỐI. HÀM THUẦN.
//
// Luật 12 (affordance phải NÓI THẬT): nút sáng mà bấm vào bị từ chối là lời hứa suông; nút tối không nói lý do là câu đố. Mọi nút của màn chi tiết đọc từ MỘT bảng này, và mỗi
// điều kiện ở đây ĐỐI CHIẾU với một cổng thật trong `duyet.ts` (cùng các hàm `nhanVienXuLyDuoc`/`tuChoiDuoc`/`thieuDieuKien`). Đổi cổng ở một nơi mà không đổi nơi kia ⇒ nút nói dối;
// ca DB `[DYT-*]` (cổng thật) + ca `[HDK-*]` (bảng này) cùng canh.
import { daRaLead, laKetThuc, NHAN_THIEU, nhanVienXuLyDuoc, tuChoiDuoc, type ThieuDieuKien } from "./dieu-kien";

export type TrangThaiNut = {
  /** Có vẽ nút không. Không vẽ = hành động không áp dụng ở trạng thái này (khác với «tối»: tối = áp dụng nhưng chưa làm được). */
  hien: boolean;
  /** Sáng (bấm được). Chỉ có nghĩa khi `hien`. */
  bat: boolean;
  /** Vì sao tối — câu tiếng Việt hiện ngay cạnh nút (không giấu trong tooltip: mobile không có hover). */
  lyDoKhoa: string | null;
};

export type DauVaoNut = {
  state: string;
  claimedById: string | null;
  claimedBoiToi: boolean;
  claimedTen: string | null;
  coQuyenReview: boolean;
  thieu: readonly ThieuDieuKien[];
  ownerState: string;
};

export type BangNut = {
  nhanXuLy: TrangThaiNut;
  boSung: TrangThaiNut;
  duyet: TrangThaiNut;
  tuChoi: TrangThaiNut;
  chuyenNguoi: TrangThaiNut;
  traHoSo: TrangThaiNut;
  baoDaNhan: TrangThaiNut;
  /** Một câu giải thích CHUNG khi cả bảng bị khoá (không có quyền · đã xong · người khác giữ). */
  ghiChu: string | null;
};

const AN: TrangThaiNut = { hien: false, bat: false, lyDoKhoa: null };
const SANG: TrangThaiNut = { hien: true, bat: true, lyDoKhoa: null };
const toi = (lyDo: string): TrangThaiNut => ({ hien: true, bat: false, lyDoKhoa: lyDo });

export function bangNut(x: DauVaoNut): BangNut {
  const tatCaAn = (ghiChu: string | null): BangNut => ({
    nhanXuLy: AN, boSung: AN, duyet: AN, tuChoi: AN, chuyenNguoi: AN, traHoSo: AN, baoDaNhan: AN, ghiChu,
  });
  if (!x.coQuyenReview) return tatCaAn("Bạn chỉ có quyền xem hồ sơ này. Cần quyền ai-leads:review để xử lý.");
  if (daRaLead(x.state)) {
    return tatCaAn(x.state === "ASSIGNMENT_PENDING" ? "Đã tạo lead, đang chờ phân công người phụ trách ở màn «Chưa phân công»." : "Hồ sơ đã được duyệt và tạo lead.");
  }
  if (laKetThuc(x.state)) return tatCaAn("Hồ sơ đã đóng.");

  const nguoiKhac = x.claimedById !== null && !x.claimedBoiToi;
  const khoaNguoiKhac = nguoiKhac ? `Đang do ${x.claimedTen ?? "người khác"} xử lý.` : null;
  const xuLyDuoc = nhanVienXuLyDuoc(x.state);
  const dangThuThap = x.state === "COLLECTING";

  const duocTuChoi = tuChoiDuoc(x.state);
  const tuChoi = duocTuChoi ? (nguoiKhac ? toi(khoaNguoiKhac!) : SANG) : AN;

  if (!xuLyDuoc) {
    // COLLECTING: Agent còn đang hỏi khách ⇒ chỉ cho từ chối (khách bỏ đi). Mọi thứ khác ẩn kèm lời giải thích.
    return { ...tatCaAn(dangThuThap ? "Agent đang thu thập thông tin từ khách. Chờ hồ sơ đủ thông tin hoặc chuyển cho nhân viên." : null), tuChoi };
  }

  const thieu = x.thieu.length ? `Còn thiếu: ${x.thieu.map((t) => NHAN_THIEU[t]).join("; ")}.` : null;
  return {
    nhanXuLy: x.claimedById === null ? SANG : AN,
    boSung: nguoiKhac ? toi(khoaNguoiKhac!) : SANG,
    duyet: nguoiKhac ? toi(khoaNguoiKhac!) : thieu ? toi(thieu) : SANG,
    tuChoi,
    chuyenNguoi: x.claimedBoiToi ? SANG : AN,
    traHoSo: x.claimedBoiToi ? SANG : AN,
    // «Báo đã nhận» chỉ có nghĩa khi hội thoại ĐÃ yêu cầu chuyển cho người.
    baoDaNhan:
      x.ownerState === "HANDOFF_REQUESTED" || x.ownerState === "TAKEOVER_PENDING"
        ? nguoiKhac
          ? toi(khoaNguoiKhac!)
          : SANG
        : AN,
    ghiChu: khoaNguoiKhac,
  };
}
