// components/admin/scorm-trang-thai-tai.ts — máy trạng thái "đang tải bài giảng" của ScormPlayer/PdfSlidePlayer (24/10/2026). THUẦN.
//
// Vì sao có file này: lớp phủ cũ chỉ chạy theo MỘT đồng hồ 12s và `onLoad` của iframe. Hai thứ đó không phân biệt được "mạng
// chậm" với "vé hết hạn" (403), "không có tệp" (404), "máy chủ lỗi" (5xx) hay "mất mạng" — và một iframe trỏ vào trang lỗi dạng
// chữ ("Forbidden", "Not found") vẫn bắn `load` thành công ⇒ lớp phủ biến mất, giáo viên đứng trước một khung trắng chữ nhỏ.
// Bản thử lại thì chỉ có một lối: reload cả trang (kể cả khi lỗi là mạng thoáng qua).
//
// Hợp đồng:
//  · "chậm" (`cham`) là NHẮC, KHÔNG phải lỗi: bài nặng trên mạng yếu vẫn đang tải thật. Lỗi chỉ đến từ bằng chứng (mã HTTP của
//    lần thăm dò, nội dung thật của iframe) hoặc từ hạn chót tổng (`HEN_QUA_HAN_MS`).
//  · KHÔNG tự thử lại: `SO_LAN_TU_THU_LAI_TOI_DA = 0`. Thử lại chỉ do người dùng bấm (`thu-lai`). Tự reload là cách 37% lượt mở bị
//    mở lại <10 phút trở thành bão request trên một đường đã chậm.
//  · Bằng chứng NỘI DUNG thắng: iframe nạp ra HTML thật ⇒ `san-sang` kể cả khi lần thăm dò trước đó báo mạng/5xx (hai request
//    khác nhau; request nào chạy được thì người dạy được dạy). Ngược lại một khi đã `san-sang`, mọi sự kiện muộn đều bị bỏ qua
//    (SCO điều hướng nội bộ bắn `load` nhiều lần — không được biến một bài đang chiếu thành "lỗi").
//  · Mọi thứ ở đây FAIL-OPEN: không đọc được iframe (`khong-doc`) không phải lỗi; chỉ ghi nhớ rồi chờ lần thăm dò xác nhận.

/** Mã lỗi hiển thị ra `data-scorm-loi` cho QA/UAT. */
export type MaLoi = "ve-het-han" | "khong-thay" | "may-chu" | "mang" | "qua-han";

/** Sau ngần này vẫn chưa xong thì NHẮC (không phải lỗi). Giữ đúng 12s của lớp phủ cũ. */
export const HEN_CHAM_MS = 12_000;
/** Hạn chót tổng của một lượt nạp iframe SCORM: quá hạn ⇒ `loi/qua-han` kèm nút Thử lại. Gói nặng nhất ~150MB, nhưng iframe chỉ cần
 *  `res/index.html` + vài tệp đầu — 45s là mạng hỏng, không phải gói nặng. */
export const HEN_QUA_HAN_MS = 45_000;
/** Giáo án PDF tải NGUYÊN tệp rồi mới vẽ trang đầu ⇒ hạn dài hơn. */
export const HEN_QUA_HAN_PDF_MS = 90_000;
/** Số lần tự thử lại. Cố ý 0 — xem đầu file. Hằng này để test ghim luật, không phải núm chỉnh. */
export const SO_LAN_TU_THU_LAI_TOI_DA = 0;

export type TrangThaiTai = {
  loai: "dang-tai" | "san-sang" | "loi";
  ma: MaLoi | null;
  /** Đã quá `HEN_CHAM_MS` — hiện nhắc "mạng yếu". */
  cham: boolean;
  /** Người dùng bấm "Ẩn thông báo": đừng bật lại lớp phủ (kể cả khi quá hạn) — họ đã chọn tiếp tục dạy. */
  anNhac: boolean;
  /** Số lần người dùng bấm Thử lại — dùng làm `key` của iframe để nạp lại. */
  lanThu: number;
  /** Kết quả lần thăm dò launch URL. */
  thamDo: "chua" | "tot" | "mang";
  /** iframe đã bắn `load` nhưng không đọc được tài liệu (vd trang lỗi của trình duyệt) — chờ thăm dò quyết. */
  iframeKhongDoc: boolean;
};

export function trangThaiTaiBanDau(lanThu = 0): TrangThaiTai {
  return { loai: "dang-tai", ma: null, cham: false, anNhac: false, lanThu, thamDo: "chua", iframeKhongDoc: false };
}

/** Mô tả tài liệu trong iframe — phần DOM thật do người gọi đọc, hàm ở đây chỉ phán xét. */
export type MoTaTaiLieu = {
  href: string;
  contentType: string;
  readyState: string;
  /** Chữ đầu của body (≤ 200 ký tự). Chỉ có nghĩa với trang nhỏ / không phải HTML. */
  vanBan: string;
};

export type KetQuaTaiLieu =
  | { kq: "chua-ro" } // about:blank / chưa điều hướng xong
  | { kq: "dang-doc" } // đã có tài liệu HTML đầu tiên, còn đang nạp (= First Content Visible)
  | { kq: "tot" } // readyState complete (= Interactive Ready)
  | { kq: "loi"; ma: MaLoi }
  | { kq: "khong-doc" }; // null: không đọc được (trang lỗi của trình duyệt / khác origin)

/** Mã HTTP của lần thăm dò → mã lỗi, hoặc null nếu không phải lỗi (2xx, 304, 416 do Range 0-0 trên tệp rỗng, 3xx đã theo). */
export function maLoiTuHttp(status: number): MaLoi | null {
  if (status >= 200 && status < 400) return null;
  if (status === 416) return null;
  if (status === 401 || status === 403) return "ve-het-han";
  if (status === 404 || status === 410) return "khong-thay";
  return "may-chu"; // 5xx và mọi 4xx còn lại (408/429…) — máy chủ chưa phục vụ được lúc này
}

/** Phân loại chữ trong trang lỗi dạng chữ của route asset ("Forbidden" / "Not found" / "Upstream error") và của proxy. */
export function phanLoaiVanBanLoi(vanBan: string): MaLoi | null {
  const v = vanBan.trim().toLowerCase();
  if (!v || v.length > 80) return null;
  if (/^(forbidden|unauthorized)\b/.test(v)) return "ve-het-han";
  if (/^not found\b/.test(v)) return "khong-thay";
  if (/^(upstream error|bad gateway|service unavailable|gateway time-?out|internal server error)\b/.test(v)) return "may-chu";
  return null;
}

const LA_HTML = /html/i;

export function danhGiaTaiLieu(d: MoTaTaiLieu | null): KetQuaTaiLieu {
  if (!d) return { kq: "khong-doc" };
  if (!d.href || d.href === "about:blank") return { kq: "chua-ro" };
  // contentType rỗng (môi trường không khai) coi như HTML — chỉ loại khi CHẮC chắn là thứ khác.
  if (d.contentType && !LA_HTML.test(d.contentType)) {
    return { kq: "loi", ma: phanLoaiVanBanLoi(d.vanBan) ?? "may-chu" };
  }
  const maChu = phanLoaiVanBanLoi(d.vanBan);
  if (maChu) return { kq: "loi", ma: maChu };
  return d.readyState === "complete" ? { kq: "tot" } : { kq: "dang-doc" };
}

export type SuKien =
  | { loai: "cham" }
  | { loai: "qua-han" }
  | { loai: "tham-do"; trangThaiHttp: number }
  | { loai: "tham-do-mang" }
  | { loai: "tai-lieu"; ketQua: KetQuaTaiLieu }
  /** PDF: tải + dựng xong trang đầu. */
  | { loai: "san-sang" }
  /** PDF: lỗi tự phân loại (tệp hỏng…). */
  | { loai: "loi"; ma: MaLoi }
  | { loai: "an-nhac" }
  | { loai: "thu-lai" };

const loi = (s: TrangThaiTai, ma: MaLoi): TrangThaiTai => ({ ...s, loai: "loi", ma, cham: false, anNhac: false });
const sanSang = (s: TrangThaiTai): TrangThaiTai => ({ ...s, loai: "san-sang", ma: null, cham: false, anNhac: false });
/** Lỗi "mềm" (không có bằng chứng từ máy chủ) — để bằng chứng thật đến sau được ghi đè. */
const laLoiMem = (s: TrangThaiTai) => s.loai === "loi" && (s.ma === "qua-han" || s.ma === "mang");

export function lapTrangThaiTai(s: TrangThaiTai, e: SuKien): TrangThaiTai {
  if (e.loai === "thu-lai") return trangThaiTaiBanDau(s.lanThu + 1);
  // Đã sẵn sàng là chốt: sự kiện muộn (thăm dò về trễ, SCO điều hướng nội bộ) không được kéo bài đang chiếu về "lỗi".
  if (s.loai === "san-sang") return s;

  switch (e.loai) {
    case "cham":
      return s.loai === "dang-tai" && !s.cham && !s.anNhac ? { ...s, cham: true } : s;
    case "an-nhac":
      return s.loai === "dang-tai" && s.cham ? { ...s, anNhac: true } : s;
    case "qua-han":
      return s.loai === "dang-tai" && !s.anNhac ? loi(s, "qua-han") : s;
    case "san-sang":
      return sanSang(s);
    case "loi":
      return loi(s, e.ma);
    case "tham-do": {
      const ma = maLoiTuHttp(e.trangThaiHttp);
      if (ma) {
        // Mã HTTP thật thắng "quá hạn"/"mất mạng" (mềm) nhưng không đè một lỗi cứng đã có.
        return s.loai === "dang-tai" || laLoiMem(s) ? loi(s, ma) : s;
      }
      if (s.loai !== "dang-tai") return s;
      return s.iframeKhongDoc ? sanSang(s) : { ...s, thamDo: "tot" };
    }
    case "tham-do-mang":
      if (s.loai !== "dang-tai") return s;
      return loi({ ...s, thamDo: "mang" }, "mang");
    case "tai-lieu": {
      const k = e.ketQua;
      if (k.kq === "tot") return sanSang(s); // nội dung thật thắng mọi lỗi mềm/cứng của lần thăm dò
      if (k.kq === "loi") return loi(s, k.ma);
      if (k.kq === "khong-doc") {
        if (s.loai !== "dang-tai") return s;
        return s.thamDo === "tot" ? sanSang(s) : { ...s, iframeKhongDoc: true };
      }
      return s; // chua-ro / dang-doc: chưa có gì để kết luận
    }
  }
}

export type ThongDiepLoi = {
  tieuDe: string;
  noiDung: string;
  /** true ⇒ nút chính là "Tải lại trang" (cấp vé mới); false ⇒ "Thử lại" nạp lại khung. */
  taiLaiTrang: boolean;
};

/** Lỗi nào chỉ có tải lại CẢ TRANG mới chữa được: vé nằm trong URL trang, nạp lại iframe dùng lại vé cũ. */
export function hanhDongThuLai(ma: MaLoi): "tai-lai-trang" | "nap-lai-khung" {
  return thongDiepLoi(ma).taiLaiTrang ? "tai-lai-trang" : "nap-lai-khung";
}

export function thongDiepLoi(ma: MaLoi): ThongDiepLoi {
  switch (ma) {
    case "ve-het-han":
      return {
        tieuDe: "Phiên xem bài đã hết hạn",
        noiDung: "Cần mở lại bài để cấp quyền xem mới. Tải lại trang là xong — tiến độ giảng của thầy/cô vẫn được giữ.",
        taiLaiTrang: true,
      };
    case "khong-thay":
      return {
        tieuDe: "Không tìm thấy bài giảng",
        noiDung: "Máy chủ báo không có tệp bài giảng này. Bấm Thử lại; nếu vẫn lỗi, báo bộ phận Đào tạo kiểm tra gói bài.",
        taiLaiTrang: false,
      };
    case "may-chu":
      return {
        tieuDe: "Máy chủ chưa trả được bài giảng",
        noiDung: "Máy chủ đang bận hoặc gặp lỗi tạm thời. Đợi vài giây rồi bấm Thử lại.",
        taiLaiTrang: false,
      };
    case "mang":
      return {
        tieuDe: "Mất kết nối mạng",
        noiDung: "Không kết nối được tới máy chủ. Kiểm tra mạng của thiết bị rồi bấm Thử lại.",
        taiLaiTrang: false,
      };
    case "qua-han":
      return {
        tieuDe: "Bài giảng tải quá lâu",
        noiDung: "Mạng đang yếu hoặc bài giảng khá nặng. Bấm Thử lại, hoặc tải lại trang nếu vẫn không được.",
        taiLaiTrang: false,
      };
  }
}

export type DauMocScorm = "scorm:open" | "scorm:first-content" | "scorm:ready" | "scorm:error";

/** `performance.mark` cho QA/UAT đo thời gian mở. Fail-open: môi trường không có Performance API thì bỏ qua. */
export function danhDauScorm(ten: DauMocScorm): void {
  try {
    if (typeof performance !== "undefined" && typeof performance.mark === "function") performance.mark(ten);
  } catch {
    /* fail-open */
  }
}
