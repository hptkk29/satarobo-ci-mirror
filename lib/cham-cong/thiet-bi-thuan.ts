// lib/cham-cong/thiet-bi-thuan.ts — phần THUẦN của THIẾT BỊ CHẤM CÔNG (P2.3, 11/10/2026). Không chạm DB.
//
// Ba chế độ (`shift.thietBiCheDo`):
//   OFF     — không làm gì (không cookie, không đọc/ghi). Mặc định.
//   OBSERVE — ghi nhận thiết bị, gắn cờ lượt chấm từ máy lạ / máy đã thu hồi, KHÔNG BAO GIỜ chặn.
//   ENFORCE — chặn máy đã thu hồi / báo mất; máy chưa tin cậy thì theo `choPhepKhanCap`.
// Mục đích của OBSERVE: thu dữ liệu thật trước khi siết — không khoá cửa hàng loạt vào một sáng thứ Hai.

export const CHE_DO_THIET_BI = ["OFF", "OBSERVE", "ENFORCE"] as const;
export type CheDoThietBi = (typeof CHE_DO_THIET_BI)[number];

export type TrangThaiThietBi = "PENDING" | "TRUSTED" | "REVOKED" | "LOST";

/** Cờ gắn lên `StaffTimeLog.flags` — quản lý đọc ở bảng công ngày / danh sách ngày có cờ. */
export const CO_THIET_BI = {
  CHUA_TIN_CAY: "THIET_BI_CHUA_TIN_CAY",
  DA_THU_HOI: "THIET_BI_DA_THU_HOI",
} as const;

export type QuyetDinhThietBi = { cho: true; co: string | null } | { cho: false; loi: string };

/** Cho chấm không, và gắn cờ gì. MỘT bảng cho đường chấm công lẫn test. */
export function quyetDinhThietBi(input: {
  cheDo: CheDoThietBi;
  trangThai: TrangThaiThietBi;
  /** ENFORCE: máy chưa tin cậy vẫn chấm được (gắn cờ). BẮT BUỘC khai (luật 7). */
  choPhepKhanCap: boolean;
}): QuyetDinhThietBi {
  const { cheDo, trangThai } = input;
  if (cheDo === "OFF") return { cho: true, co: null };
  const thuHoi = trangThai === "REVOKED" || trangThai === "LOST";
  if (cheDo === "OBSERVE") {
    if (thuHoi) return { cho: true, co: CO_THIET_BI.DA_THU_HOI };
    return { cho: true, co: trangThai === "TRUSTED" ? null : CO_THIET_BI.CHUA_TIN_CAY };
  }
  // ENFORCE
  if (thuHoi) {
    return {
      cho: false,
      loi: `Thiết bị này đã bị ${trangThai === "LOST" ? "báo mất" : "thu hồi"} — không chấm công được. Liên hệ quản lý để được duyệt máy khác.`,
    };
  }
  if (trangThai === "TRUSTED") return { cho: true, co: null };
  if (input.choPhepKhanCap) return { cho: true, co: CO_THIET_BI.CHUA_TIN_CAY };
  return { cho: false, loi: "Thiết bị này chưa được quản lý duyệt — chấm công trên máy đã duyệt, hoặc nhờ quản lý duyệt máy này." };
}

/** Thiết bị MỚI đăng ký vào trạng thái gì: máy đầu tiên (chưa có máy tin cậy nào) tự tin cậy nếu bật. */
export function trangThaiKhiDangKy(input: { soDangTinCay: number; tuTinCayDauTien: boolean }): "TRUSTED" | "PENDING" {
  return input.tuTinCayDauTien && input.soDangTinCay === 0 ? "TRUSTED" : "PENDING";
}

export type HanhDongThietBi = "TIN_CAY" | "THU_HOI" | "BAO_MAT";

const CHUYEN: Record<HanhDongThietBi, { tu: readonly TrangThaiThietBi[]; den: TrangThaiThietBi }> = {
  TIN_CAY: { tu: ["PENDING"], den: "TRUSTED" },
  THU_HOI: { tu: ["PENDING", "TRUSTED"], den: "REVOKED" },
  BAO_MAT: { tu: ["PENDING", "TRUSTED", "REVOKED"], den: "LOST" },
};

export const NHAN_HANH_DONG_THIET_BI: Record<HanhDongThietBi, string> = {
  TIN_CAY: "Duyệt",
  THU_HOI: "Thu hồi",
  BAO_MAT: "Báo mất",
};

/** Chuyển trạng thái hợp lệ không; duyệt thêm thì kiểm trần số máy tin cậy. */
export function chuyenThietBi(input: {
  hienTai: TrangThaiThietBi;
  hanhDong: HanhDongThietBi;
  soDangTinCay: number;
  toiDa: number;
}): { ok: true; den: TrangThaiThietBi } | { ok: false; error: string } {
  const q = CHUYEN[input.hanhDong];
  if (!q.tu.includes(input.hienTai)) return { ok: false, error: `Thiết bị đang ở trạng thái không cho “${NHAN_HANH_DONG_THIET_BI[input.hanhDong]}”` };
  if (input.hanhDong === "TIN_CAY" && input.soDangTinCay >= input.toiDa) {
    return { ok: false, error: `Người này đã có ${input.soDangTinCay}/${input.toiDa} máy tin cậy — thu hồi bớt máy cũ trước` };
  }
  return { ok: true, den: q.den };
}

export const hanhDongThietBiHopLe = (hienTai: TrangThaiThietBi): HanhDongThietBi[] =>
  (Object.keys(CHUYEN) as HanhDongThietBi[]).filter((h) => CHUYEN[h].tu.includes(hienTai));

/** Nhãn máy đọc được từ user-agent — CHỈ để người xem nhận ra máy, không dùng làm định danh. */
export function nhanThietBi(userAgent: string | null | undefined): { deviceName: string; platform: string } {
  const ua = userAgent ?? "";
  const platform = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
      ? "iPad"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/i.test(ua)
            ? "Mac"
            : /Linux/i.test(ua)
              ? "Linux"
              : "Không rõ";
  const trinhDuyet = /Zalo/i.test(ua)
    ? "Zalo"
    : /Edg\//.test(ua)
      ? "Edge"
      : /CriOS|Chrome\//.test(ua)
        ? "Chrome"
        : /FxiOS|Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Trình duyệt khác";
  return { deviceName: `${platform} · ${trinhDuyet}`, platform };
}

/**
 * ĐẶT LẠI = THÁO khoá khỏi dòng thiết bị (nghiệm thu test 11/10/2026). Bản đầu chỉ chuyển dòng sang REVOKED và GIỮ
 * `keyHash` ⇒ chính trình duyệt đang dùng vẫn khớp dòng đã thu hồi ⇒ ENFORCE chặn nó mãi, trái với lời hứa
 * "lần chấm kế tiếp đăng ký lại". Nay `keyHash` của dòng bị thay bằng `dat-lai:<id>` — không chuỗi băm SHA-256 hex
 * nào bắt đầu như vậy ⇒ không cookie nào khớp lại được; dòng vẫn còn để xem lịch sử.
 * Máy BÁO MẤT KHÔNG bị tháo: điện thoại bị mất phải bị chặn tiếp, kể cả sau khi đặt lại.
 */
export const TIEN_TO_DA_DAT_LAI = "dat-lai:";
export const daDatLai = (keyHash: string): boolean => keyHash.startsWith(TIEN_TO_DA_DAT_LAI);
/** Dòng nào bị lần đặt lại tháo khoá. */
export const biDatLai = (m: { status: TrangThaiThietBi; keyHash: string }): boolean => m.status !== "LOST" && !daDatLai(m.keyHash);

/**
 * D-04 (chủ dự án chốt 11/10/2026): LOST là khoá MẠNH — "Đặt lại" thường không bao giờ trả nó về; khôi phục máy báo mất
 * (nếu có ngày cần) phải là một thao tác quản trị riêng. Câu báo nói đúng việc ĐẶT LẠI — bản đầu báo "Đã thu hồi N máy"
 * cho thao tác đặt lại. Không còn máy nào để tháo ⇒ TỪ CHỐI, không ghi gì (nơi gọi hỏi hàm này TRƯỚC phép ghi đầu tiên).
 */
export const LOI_DAT_LAI_BAO_MAT = "Thiết bị đã báo mất không thể đặt lại bằng thao tác này.";
export const LOI_DAT_LAI_KHONG_CO_MAY = "Người này không còn thiết bị nào để đặt lại.";

export function thongBaoDatLai(input: { soMay: number; soBaoMat: number }): { ok: true; note: string } | { ok: false; error: string } {
  if (input.soMay === 0) return { ok: false, error: input.soBaoMat > 0 ? LOI_DAT_LAI_BAO_MAT : LOI_DAT_LAI_KHONG_CO_MAY };
  const chinh =
    input.soMay === 1
      ? "Đã đặt lại 1 thiết bị. Thiết bị sẽ cần đăng ký lại khi chấm công lần tiếp theo."
      : `Đã đặt lại ${input.soMay} thiết bị.`;
  return { ok: true, note: input.soBaoMat > 0 ? `${chinh} ${LOI_DAT_LAI_BAO_MAT}` : chinh };
}
