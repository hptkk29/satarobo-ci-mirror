/**
 * ĐỔI NGUỒN BÀI VIDEO — LUẬT THUẦN (không DB, không `server-only`: form soạn và test cùng đọc).
 *
 * Ba câu hỏi, mỗi câu một hàm:
 *  1. Nguồn có THẬT SỰ đổi không?          → `nguonDaDoi`
 *  2. Lượt ghi danh nào bị đặt lại / giữ?   → `LUOT_DAT_LAI` / `LUOT_DONG_BANG` (một nguồn duy nhất cho cả SQL lẫn hiển thị)
 *  3. Được phép đổi không, cần gì thêm?      → `quyetDinhDoiNguon`
 *
 * ── Chính sách (owner chốt 28/10/2026, D5 phương án (a) có kiểm soát phiên bản) ─────────────────────────────
 *  · Lượt ĐANG HỌC (NOT_STARTED / IN_PROGRESS / OVERDUE): chụp bất biến tiến độ cũ rồi bắt đầu lại ở phiên bản mới —
 *    CÙNG giao dịch với việc đổi nguồn.
 *  · Lượt ĐÃ KẾT THÚC (COMPLETED / COMPLETED_LATE / REVOKED): trạng thái khoá, chứng nhận và hàng tiến độ GIỮ NGUYÊN.
 *    Hàng tiến độ ở lại phiên bản cũ (đóng băng): DONE cũ KHÔNG bao giờ được công nhận là DONE của video mới; nhịp xem
 *    không ghi vào nó. Họ chỉ học lại khi có quyết định đào tạo hoặc một đợt giao học MỚI (lượt ghi danh mới).
 *  · Metadata (tiêu đề, phụ đề, bản chép lời) KHÔNG bao giờ làm đổi phiên bản.
 */

export type NguonBai = {
  youtubeId: string | null;
  videoKey: string | null;
  durationSec: number | null;
};

/**
 * Nhận dạng NGUỒN của bài: YouTube thắng khi dữ liệu cũ lỡ mang cả hai (trang học cũng ưu tiên YouTube).
 * `null` = bài chưa có video nào.
 */
export function nhanDangNguon(b: Pick<NguonBai, "youtubeId" | "videoKey">): string | null {
  if (b.youtubeId) return `youtube:${b.youtubeId}`;
  if (b.videoKey) return `tep:${b.videoKey}`;
  return null;
}

/**
 * Nội dung video có đổi so với bản đang lưu không — điều kiện DUY NHẤT để tăng `mediaRevision`.
 *
 * · Nguồn khác (mã YouTube / khoá tệp) ⇒ đổi; thời lượng khác (cùng nguồn) ⇒ đổi (mẫu số của mọi phần trăm đổi).
 * · Bài CHƯA có nguồn nào mà nay gắn lần đầu ⇒ KHÔNG phải đổi: chưa có nội dung cũ nào để thay, và chưa thể có tiến độ.
 * · Lưu lại đúng nguồn cũ với tiêu đề/phụ đề khác ⇒ KHÔNG đổi.
 */
export function nguonDaDoi(cu: NguonBai, moi: NguonBai): boolean {
  const idCu = nhanDangNguon(cu);
  if (idCu === null) return false;
  if (idCu !== nhanDangNguon(moi)) return true;
  return (cu.durationSec ?? null) !== (moi.durationSec ?? null);
}

/** Lượt ghi danh còn đang học — tiến độ bài bị chụp rồi đặt lại khi bài đổi nguồn. */
export const LUOT_DAT_LAI = ["NOT_STARTED", "IN_PROGRESS", "OVERDUE"] as const;
/** Lượt ghi danh đã kết thúc — giữ nguyên trạng thái, chứng nhận và hàng tiến độ (đóng băng ở phiên bản cũ). */
export const LUOT_DONG_BANG = ["COMPLETED", "COMPLETED_LATE", "REVOKED"] as const;

export type TacDongDoiNguon = {
  /** Hàng tiến độ (phiên bản hiện tại) của lượt ĐANG HỌC đã có xem — sẽ được chụp và đặt lại. */
  ghiDanhDangHoc: number;
  /** Hàng tiến độ của lượt ĐÃ KẾT THÚC — giữ nguyên, đóng băng ở phiên bản cũ. */
  ghiDanhDongBang: number;
  /** Trong số đó đã DONE ở bài này. */
  daXongDangHoc: number;
  daXongDongBang: number;
  /** Câu hỏi chèn giữa video đặt theo giây của video CŨ — người soạn phải xem lại sau khi đổi. */
  soCauHoiChen: number;
};

export const TAC_DONG_RONG: TacDongDoiNguon = {
  ghiDanhDangHoc: 0,
  ghiDanhDongBang: 0,
  daXongDangHoc: 0,
  daXongDongBang: 0,
  soCauHoiChen: 0,
};

/** Số hàng tiến độ có người học (đang học + đã kết thúc). */
export const soNguoiDaHoc = (t: TacDongDoiNguon) => t.ghiDanhDangHoc + t.ghiDanhDongBang;

/**
 * · `CAN_QUYEN_XUAT_BAN` — thiếu quyền xuất bản nội dung.
 * · `CAN_LY_DO` — đổi nội dung thật mà thiếu/ngoài khoảng lý do.
 * · `CAN_XAC_NHAN_TAC_DONG` — chưa có xác nhận hợp lệ cho nội dung + tập người học HIỆN TẠI.
 * · `TAC_DONG_DA_DOI` — có xác nhận hợp lệ nhưng cho một tập người học KHÁC (có người bắt đầu/xong bài từ lúc xem trước):
 *   form phải xem trước và xin xác nhận LẠI.
 */
export type MaTuChoiDoiNguon = "CAN_QUYEN_XUAT_BAN" | "CAN_LY_DO" | "CAN_XAC_NHAN_TAC_DONG" | "TAC_DONG_DA_DOI";

export type QuyetDinhDoiNguon =
  | { loai: "CHO_PHEP" }
  | { loai: "TU_CHOI"; ma: MaTuChoiDoiNguon; thongBao: string };

/** Câu nói thẳng tác động — dùng cho cả lời từ chối (hộp xác nhận ở form) lẫn sổ audit. */
export function thongBaoTacDong(t: TacDongDoiNguon, khoaDaXuatBan = false): string {
  if (soNguoiDaHoc(t) === 0) {
    const cueRong = t.soCauHoiChen > 0 ? ` Có ${t.soCauHoiChen} câu hỏi chèn đặt theo video cũ — xem lại sau khi đổi.` : "";
    return (
      (khoaDaXuatBan
        ? "Khoá này đã xuất bản: đổi video là đổi nội dung đang phát cho mọi người được giao học. Hiện chưa có ai xem bài này."
        : "Hiện chưa có ai xem bài này.") +
      cueRong +
      " Xác nhận để tiếp tục."
    );
  }
  const dongBang =
    t.ghiDanhDongBang > 0
      ? ` ${t.ghiDanhDongBang} lượt đã kết thúc khoá (đã hoàn thành hoặc bị thu hồi) giữ nguyên kết quả và chứng nhận; họ chỉ học lại khi có quyết định đào tạo hoặc đợt giao học mới.`
      : "";
  const cue = t.soCauHoiChen > 0 ? ` Có ${t.soCauHoiChen} câu hỏi chèn đặt theo video cũ — xem lại sau khi đổi.` : "";
  return (
    `Bài này đã có ${soNguoiDaHoc(t)} lượt học (${t.daXongDangHoc + t.daXongDongBang} đã xong bài). ` +
    `Đổi video sẽ chụp lại rồi bắt đầu lại tiến độ bài này cho ${t.ghiDanhDangHoc} lượt đang học (lịch sử cũ được giữ).` +
    dongBang +
    cue +
    " Xác nhận để tiếp tục."
  );
}

/**
 * Được đổi nguồn không?
 *
 *  · KHÔNG đổi nội dung thật ⇒ cho (không có tác động nào để hỏi).
 *  · Khoá ĐÃ XUẤT BẢN, hoặc đã có người học ⇒ chỉ người có quyền XUẤT BẢN được đổi nguồn: `TrnLesson` dùng chung giữa các
 *    phiên bản khoá nên sửa nguồn là sửa nội dung đang phát NGAY — quyền soạn nội dung không đủ cho việc đó.
 *  · Khoá ĐÃ XUẤT BẢN, hoặc đã có người học ⇒ phải XÁC NHẬN tác động (server ép, không chỉ form) — KỂ CẢ khi chưa có ai
 *    học (owner chốt 28/10/2026: khoá đã xuất bản luôn cần quyền publish và xác nhận). `daXacNhan` do server tính từ chữ ký
 *    gắn với nội dung + tập người học hiện tại (`video-doi-nguon-xac-nhan.ts`), không phải cờ do client gửi.
 */
export function quyetDinhDoiNguon(i: {
  doi: boolean;
  tacDong: TacDongDoiNguon;
  khoaDaXuatBan: boolean;
  coQuyenXuatBan: boolean;
  daXacNhan: boolean;
}): QuyetDinhDoiNguon {
  if (!i.doi) return { loai: "CHO_PHEP" };
  const coNguoiHoc = soNguoiDaHoc(i.tacDong) > 0;
  if ((i.khoaDaXuatBan || coNguoiHoc) && !i.coQuyenXuatBan) {
    return {
      loai: "TU_CHOI",
      ma: "CAN_QUYEN_XUAT_BAN",
      thongBao: i.khoaDaXuatBan
        ? "Khoá này đã xuất bản — đổi video của bài là đổi nội dung đang phát, cần quyền xuất bản nội dung."
        : "Bài này đã có người học — đổi video cần quyền xuất bản nội dung.",
    };
  }
  if ((i.khoaDaXuatBan || coNguoiHoc) && !i.daXacNhan) {
    return { loai: "TU_CHOI", ma: "CAN_XAC_NHAN_TAC_DONG", thongBao: thongBaoTacDong(i.tacDong, i.khoaDaXuatBan) };
  }
  return { loai: "CHO_PHEP" };
}

export const LY_DO_TOI_THIEU = 5;
export const LY_DO_TOI_DA = 500;

/**
 * Lý do đổi nội dung video. BẮT BUỘC khi nội dung thật sự đổi (đi vào `TrnLessonProgressRevision.reason` và sổ audit),
 * giới hạn độ dài để không nhét văn bản tuỳ ý vào sổ bất biến. Cắt khoảng trắng hai đầu TRƯỚC khi đếm.
 */
/**
 * Lý do KHÔNG được chứa link hoặc đường dẫn video: mã YouTube / khoá tệp của video không công khai là BÍ MẬT, và lý do đi vào sổ audit
 * + bản chụp tiến độ BẤT BIẾN — dán vào đó là để mã nằm lại vĩnh viễn ở nơi không sửa được. Chỉ chặn được dạng NHẬN RA được (URL,
 * tên miền YouTube, đường dẫn kho `elearning/…`, đuôi `.mp4`); một chuỗi 11 ký tự trần không phân biệt được với chữ thường — giao diện
 * nhắc người nhập.
 */
export const MAU_LY_DO_CHUA_NGUON = /https?:\/\/|\byoutu\.be\b|youtube\.com|elearning\/(?:master|caption|audio)\/|\.mp4\b/i;

export function lyDoChuaNguon(lyDo: string): boolean {
  return MAU_LY_DO_CHUA_NGUON.test(lyDo);
}

export function kiemLyDoDoiNguon(lyDo: string | null | undefined): { ok: true; lyDo: string } | { ok: false; thongBao: string } {
  const t = (lyDo ?? "").trim();
  if (t.length < LY_DO_TOI_THIEU || t.length > LY_DO_TOI_DA) {
    return { ok: false, thongBao: `Cần ghi lý do đổi video (từ ${LY_DO_TOI_THIEU} đến ${LY_DO_TOI_DA} ký tự).` };
  }
  if (lyDoChuaNguon(t)) {
    return { ok: false, thongBao: "Lý do không được chứa link hoặc đường dẫn video — mã nguồn là bí mật của video không công khai. Hãy mô tả bằng lời." };
  }
  return { ok: true, lyDo: t };
}
