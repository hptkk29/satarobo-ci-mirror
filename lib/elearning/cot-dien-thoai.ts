// Luật chọn cột cho DANH SÁCH GỌN trên điện thoại (HANDOFF §4): mỗi dòng chỉ còn chấm màu + tiêu đề + 2–4 thông tin chính +
// thao tác. Hàm THUẦN để test được mà không cần dựng giao diện.
//
// Vì sao ném lỗi khi vi phạm thay vì cắt bớt âm thầm: một danh sách điện thoại thiếu tiêu đề hoặc nhồi 7 thông tin là lỗi
// khi VIẾT màn (người viết bố trí sai), không phải lỗi dữ liệu lúc chạy — cắt lặng lẽ sẽ giấu nó cho tới khi người dùng báo.

export type VaiTroDienThoai = "tieu-de" | "thong-tin" | "an";

export type CotKhaiBao = {
  id: string;
  /** Vai trò trên điện thoại; mặc định "an". */
  dienThoai?: VaiTroDienThoai;
  /** Cột thao tác (nút/menu) — luôn nằm cạnh phải dòng, không tính vào 2–4 thông tin. */
  thaoTac?: boolean;
};

export const TOI_THIEU_THONG_TIN = 2;
export const TOI_DA_THONG_TIN = 4;

export function phanLoaiCotDienThoai<C extends CotKhaiBao>(cot: readonly C[]): { tieuDe: C; thongTin: C[]; thaoTac: C[] } {
  const tieuDe = cot.filter((c) => !c.thaoTac && c.dienThoai === "tieu-de");
  if (tieuDe.length !== 1) {
    throw new Error(`Danh sách điện thoại cần ĐÚNG 1 cột tiêu đề, đang có ${tieuDe.length} (${tieuDe.map((c) => c.id).join(", ")})`);
  }
  const thongTin = cot.filter((c) => !c.thaoTac && c.dienThoai === "thong-tin");
  if (thongTin.length < TOI_THIEU_THONG_TIN || thongTin.length > TOI_DA_THONG_TIN) {
    throw new Error(
      `Danh sách điện thoại cần ${TOI_THIEU_THONG_TIN}–${TOI_DA_THONG_TIN} cột thông tin, đang có ${thongTin.length}`,
    );
  }
  return { tieuDe: tieuDe[0], thongTin, thaoTac: cot.filter((c) => c.thaoTac) };
}
