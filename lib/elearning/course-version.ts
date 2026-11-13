/**
 * EL-08 — VÒNG ĐỜI PHIÊN BẢN KHOÁ: nháp → gửi duyệt → xuất bản → lưu trữ.
 *
 * ⚠️ Vì sao khoá cần PHIÊN BẢN chứ không chỉ một cờ "đã xuất bản" (BR-013):
 * người đang học dở một khoá phải học hết theo tập bài mà họ được giao. Đào tạo
 * sửa nội dung giữa chừng — việc hoàn toàn bình thường — mà không có phiên bản
 * thì tập bài đổi dưới chân người học: hôm qua còn 8 bài, hôm nay thành 10, và
 * tiến độ 100% của họ tụt xuống 80% mà không ai giải thích được.
 *
 * `TrnCourseVersionLesson` ghim tập bài + cờ `required` của TỪNG phiên bản, nên
 * bản đang phát cho người học đứng yên kể cả khi bản nháp kế tiếp đang được sửa.
 */

export type TrangThaiPhienBan =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "ARCHIVED";

export type PhienBan = { major: number; minor: number };

/**
 * Số phiên bản kế tiếp.
 *
 * - `MINOR` — sửa chữ, sửa lỗi chính tả, đổi thứ tự. Người đang học KHÔNG bị ảnh
 *   hưởng về mặt điều kiện hoàn thành.
 * - `MAJOR` — thêm/bớt bài bắt buộc. Đây là thay đổi ĐỔI ĐIỀU KIỆN HOÀN THÀNH,
 *   nên nó phải nhìn thấy được trong số phiên bản chứ không lẫn vào một minor.
 */
export function phienBanKeTiep(
  hienTai: PhienBan | null,
  loai: "MAJOR" | "MINOR",
): PhienBan {
  if (!hienTai) return { major: 1, minor: 0 };
  return loai === "MAJOR"
    ? { major: hienTai.major + 1, minor: 0 }
    : { major: hienTai.major, minor: hienTai.minor + 1 };
}

export function nhanPhienBan(v: PhienBan): string {
  return `v${v.major}.${v.minor}`;
}

/**
 * Thay đổi tập bài BẮT BUỘC có phải là thay đổi MAJOR không.
 *
 * So theo TẬP HỢP id bài bắt buộc, không theo số lượng: đổi bài A bắt buộc thành
 * bài B bắt buộc giữ nguyên số lượng nhưng đổi hẳn điều kiện hoàn thành.
 */
export function laThayDoiMajor(input: {
  batBuocCu: string[];
  batBuocMoi: string[];
}): boolean {
  const cu = new Set(input.batBuocCu);
  const moi = new Set(input.batBuocMoi);
  if (cu.size !== moi.size) return true;
  for (const id of cu) if (!moi.has(id)) return true;
  return false;
}

export type HanhDongPhienBan =
  | "GUI_DUYET"
  | "TRA_LAI"
  | "DUYET"
  | "XUAT_BAN"
  | "LUU_TRU";

export type ChuyenTrangThai =
  | { ok: true; toi: TrangThaiPhienBan }
  | { ok: false; code: "SAI_LUONG" | "CAN_DAN_BAI_HOP_LE" };

/**
 * Máy trạng thái của một phiên bản.
 *
 * ⚠️ `APPROVED` và `PUBLISHED` là HAI bước, không phải một. Duyệt là "nội dung
 * này đúng"; xuất bản là "phát cho người học". Gộp lại thì người duyệt mất khả
 * năng nói "đúng rồi, nhưng chờ tới đầu quý hãy phát".
 *
 * ⚠️ KHÔNG có đường từ `PUBLISHED` ngược về `DRAFT`. Bản đã phát ra cho người học
 * là một sự kiện đã xảy ra; muốn sửa thì mở bản nháp MỚI, không kéo bản cũ về
 * nháp — kéo về là đổi dưới chân người đang học đúng thứ mà phiên bản sinh ra để
 * chống.
 */
export function chuyenTrangThai(input: {
  tu: TrangThaiPhienBan;
  hanhDong: HanhDongPhienBan;
  danBaiHopLe: boolean;
}): ChuyenTrangThai {
  const { tu, hanhDong } = input;

  if (hanhDong === "GUI_DUYET") {
    if (tu !== "DRAFT") return { ok: false, code: "SAI_LUONG" };
    // Chặn ở bước GỬI DUYỆT chứ không đợi tới bước xuất bản: bắt người duyệt
    // phát hiện một chương rỗng là đẩy việc của người soạn sang người khác.
    if (!input.danBaiHopLe) return { ok: false, code: "CAN_DAN_BAI_HOP_LE" };
    return { ok: true, toi: "PENDING_REVIEW" };
  }

  if (hanhDong === "TRA_LAI") {
    // Trả lại được từ CẢ hai chỗ: người duyệt đổi ý sau khi đã duyệt mà chưa
    // phát thì vẫn còn đường lùi — sau khi PHÁT thì không.
    if (tu !== "PENDING_REVIEW" && tu !== "APPROVED") {
      return { ok: false, code: "SAI_LUONG" };
    }
    return { ok: true, toi: "DRAFT" };
  }

  if (hanhDong === "DUYET") {
    if (tu !== "PENDING_REVIEW") return { ok: false, code: "SAI_LUONG" };
    if (!input.danBaiHopLe) return { ok: false, code: "CAN_DAN_BAI_HOP_LE" };
    return { ok: true, toi: "APPROVED" };
  }

  if (hanhDong === "XUAT_BAN") {
    if (tu !== "APPROVED") return { ok: false, code: "SAI_LUONG" };
    // Kiểm LẠI dàn bài ở bước xuất bản, dù hai bước trước đã kiểm: giữa các bước
    // có thể có người xoá một bài.
    if (!input.danBaiHopLe) return { ok: false, code: "CAN_DAN_BAI_HOP_LE" };
    return { ok: true, toi: "PUBLISHED" };
  }

  // LUU_TRU
  if (tu !== "PUBLISHED") return { ok: false, code: "SAI_LUONG" };
  return { ok: true, toi: "ARCHIVED" };
}

export const THONG_BAO_PHIEN_BAN: Record<
  Exclude<ChuyenTrangThai, { ok: true }>["code"],
  string
> = {
  SAI_LUONG: "Thao tác không hợp lệ với trạng thái hiện tại của phiên bản",
  CAN_DAN_BAI_HOP_LE: "Dàn bài chưa hợp lệ — xem danh sách lỗi bên dưới rồi thử lại",
};

/**
 * Mã và tên cho khoá NHÂN BẢN.
 *
 * ⚠️ Hậu tố phải làm bản sao KHÁC BIỆT NGAY TRÊN DANH SÁCH. Nhân bản mà giữ
 * nguyên tên là cách chắc chắn nhất để hai tuần sau không ai biết bản nào đang
 * phát cho người học.
 */
export function tenBanSao(input: { code: string; title: string; lan: number }): {
  code: string;
  title: string;
  slug: string;
} {
  const hau = input.lan <= 1 ? "COPY" : `COPY${input.lan}`;
  const code = `${input.code}.${hau}`;
  return {
    code,
    title: `${input.title} (bản sao${input.lan > 1 ? ` ${input.lan}` : ""})`,
    slug: code.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  };
}
