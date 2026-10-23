// lib/finance/hoa-don/ngan-hang-cho.ts — các NGĂN (tab) của màn Hoá đơn điện tử. THUẦN, client dùng được.
//
// Một chỗ cho: tên ngăn, câu rỗng của từng ngăn, đếm, chọn ngăn khi mở màn, thứ tự dòng trong ngăn.
// Page (RSC) và component client cùng đọc — đổi nhãn ở đây là đổi ở mọi nơi.

import type { DongHangCho, NganHangCho } from "./dong-hang-cho";

export type MoTaNgan = {
  ngan: NganHangCho;
  nhan: string;
  /** Câu trạng thái rỗng — nói VÌ SAO rỗng (DESIGN.md §5). */
  rong: string;
};

export const CAC_NGAN: readonly MoTaNgan[] = [
  { ngan: "cho", nhan: "Chờ xuất", rong: "Không còn khoản thu nào chờ xuất hoá đơn." },
  { ngan: "lech", nhan: "Lệch số", rong: "Không có lần thu nào lệch số tiền hay nghi trùng." },
  { ngan: "nhap", nhan: "Đã tải tệp", rong: "Chưa có hoá đơn nào đã tải tệp mà chưa xác nhận." },
  {
    ngan: "phat-hanh",
    nhan: "Phát hành MISA",
    rong: "Không có hoá đơn nào đang phát hành hay lỗi phát hành qua MISA.",
  },
  { ngan: "da-xuat", nhan: "Đã xuất", rong: "Chưa có hoá đơn nào được xác nhận trên hệ thống." },
  { ngan: "khong-xuat", nhan: "Không xuất", rong: "Chưa có lần thu nào được đánh dấu không xuất hoá đơn." },
  { ngan: "don-huy", nhan: "Đơn đã huỷ", rong: "Không có khoản thu nào nằm trên đơn đã huỷ." },
  {
    ngan: "can-dieu-chinh",
    nhan: "Cần điều chỉnh",
    rong: "Không có hoá đơn đã xuất nào bị đổi tiền hay huỷ đơn sau khi xuất.",
  },
];

export function laNgan(s: string | null | undefined): s is NganHangCho {
  return CAC_NGAN.some((n) => n.ngan === s);
}

export function demTheoNgan(dong: readonly Pick<DongHangCho, "ngan">[]): Record<NganHangCho, number> {
  const dem = Object.fromEntries(CAC_NGAN.map((n) => [n.ngan, 0])) as Record<NganHangCho, number>;
  for (const d of dong) dem[d.ngan] += 1;
  return dem;
}

/**
 * Ngăn đang mở: URL nói thì theo URL; không thì theo dòng đang chọn (mở link `?chon=` từ nơi khác
 * phải thấy dòng đó trong danh sách); không nữa thì "Chờ xuất".
 */
export function chonNgan(input: { tuUrl: string | null | undefined; dongDangChon: Pick<DongHangCho, "ngan"> | null }): NganHangCho {
  if (laNgan(input.tuUrl)) return input.tuUrl;
  return input.dongDangChon?.ngan ?? "cho";
}

/**
 * Thứ tự dòng trong một ngăn. Việc CÒN PHẢI LÀM: cũ nhất lên trước (chờ lâu nhất làm trước).
 * Sổ ĐÃ XONG (đã xuất / không xuất): mới nhất lên trước — người mở tab đó thường tra việc vừa làm.
 */
export function sapXepTrongNgan<T extends Pick<DongHangCho, "ngan" | "ngayThu" | "key">>(ngan: NganHangCho, dong: readonly T[]): T[] {
  const moiTruoc = ngan === "da-xuat" || ngan === "khong-xuat";
  return dong
    .filter((d) => d.ngan === ngan)
    .sort((a, b) => {
      const c = a.ngayThu === b.ngayThu ? a.key.localeCompare(b.key) : a.ngayThu.localeCompare(b.ngayThu);
      return moiTruoc ? -c : c;
    });
}
