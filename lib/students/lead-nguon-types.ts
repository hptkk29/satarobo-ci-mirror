// lib/students/lead-nguon-types.ts — HỢP ĐỒNG KIỂU của khối "Lead nguồn" trên hồ sơ học viên
// (25/09/2026). Chỉ khai kiểu, không import gì phía server ⇒ client component import được.
//
// Nguồn dữ liệu: `lib/students/lead-nguon.ts` (đọc qua cách ly cơ sở + canSeeLead + che PII).
// Mọi chuỗi trong các kiểu dưới đây ĐÃ được che theo quyền của người xem trước khi rời
// server — client KHÔNG tự che, và không bao giờ nhận bản thô.

/** Một lead mà người xem ĐƯỢC mở — đủ các ô "thông tin khách hàng" phía phễu. */
export type LeadNguonChiTiet = {
  leadId: string;
  /** `/leads/<id>` — chỉ có khi người xem mở được trang lead (canSeeLead). */
  href: string;
  /** Tên phụ huynh trên lead (đã che nếu thiếu leads:view-pii). */
  tenPhuHuynh: string;
  /** SĐT đã định dạng + che theo quyền; null khi lead chưa có số. */
  sdt: string | null;
  /** Nhãn trạng thái phễu (LEAD_STATUS_LABEL). */
  trangThai: string;
  /** Lead.source nguyên văn; null = chưa ghi nguồn. */
  nguon: string | null;
  /**
   * "MÃ_Tên" người nhập phiếu. `null` khi không tra được. Chỉ điền khi người xem có
   * leads:view-all — cùng luật với trang lead (người nhập là thông tin quản trị).
   */
  nguoiNhap: string | null;
  /** Người xem có được thấy ô "Người nhập lead" không (để UI ẩn hẳn ô thay vì in "—"). */
  hienNguoiNhap: boolean;
  khoaQuanTam: string | null;
  /** Lead.createdAt (ISO). */
  ngayNhanLead: string;
  /** Lần Sale chạm khách gần nhất do NGƯỜI làm (lastLeadOutreachAt), ISO; null = chưa. */
  tuongTacGanNhat: string | null;
  salePhuTrach: string | null;
  coSo: string | null;
  /** "Tên (MÃ)" người/đối tác giới thiệu (Affiliate); null = không có. */
  nguoiGioiThieu: string | null;
  /** Phần ghi chú do người gõ (bỏ dòng máy), đã che theo quyền. */
  ghiChu: string | null;
  /** Đứa trẻ cụ thể trong phiếu mà học viên này nối tới (nếu biết). */
  con: {
    id: string;
    ten: string;
    /** LeadChild.classId → tên lớp; null khi chưa chọn hoặc lớp đã xoá. */
    lopTaiTrungTam: string | null;
  } | null;
};

/** Một lead ĐỀ XUẤT để gắn (học viên chưa nối lead nào). */
export type LeadGoiY = {
  leadId: string;
  tenPhuHuynh: string;
  sdt: string | null;
  trangThai: string;
  ngayNhanLead: string;
  salePhuTrach: string | null;
  coSo: string | null;
  /**
   * Vì sao đề xuất:
   *  - VET_GHI_DANH: một ghi danh của HV mang `leadChildId` của phiếu này (vết convert) — chắc chắn.
   *  - CUNG_SDT:     SĐT phụ huynh trùng — chỉ là gợi ý, người dùng phải xác nhận.
   *  - TIM_KIEM:     người dùng tự gõ tìm.
   */
  lyDo: "VET_GHI_DANH" | "CUNG_SDT" | "TIM_KIEM";
  /** Các con trong phiếu — để chọn đúng đứa khi gắn. */
  cacCon: { id: string; ten: string }[];
};

export type LeadNguonKetQua =
  | {
      kind: "CO_LEAD";
      lead: LeadNguonChiTiet;
      /** Người xem được gỡ / đổi liên kết không. */
      coTheSua: boolean;
    }
  | {
      /**
       * Học viên ĐÃ nối lead nhưng người xem không được mở lead đó. Chỉ nói "có", KHÔNG lộ
       * dữ liệu lead và KHÔNG có link (link tới trang sẽ đá về là lời hứa suông — luật 12).
       */
      kind: "KHONG_DUOC_XEM";
      lyDo: "SALE_KHAC" | "CO_SO_KHAC";
    }
  | {
      /** Học viên chưa nối lead nào (NULL ≠ "không đến từ lead"). */
      kind: "CHUA_NOI";
      goiY: LeadGoiY[];
      coTheGan: boolean;
    };

/** Một học viên đã thành từ lead — cho chiều ngược Lead → Học viên. */
export type HocVienTuLead = {
  studentId: string;
  ten: string;
  maHocVien: string | null;
  /** Nhãn trạng thái học viên (Đang học / Bảo lưu / …). */
  trangThai: string;
  /** `/students/<id>/edit` khi người xem mở được hồ sơ; null thì chỉ in tên, không link. */
  href: string | null;
  /** Nối bằng đường nào — để người đọc biết độ chắc. */
  noiQua: "LIEN_KET" | "VET_GHI_DANH";
};
