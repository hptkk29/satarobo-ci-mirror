// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/noi-dung-ban.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * NỘI DUNG MỘT BẢN PHÂN TÍCH, DẠNG DÒNG — nguồn dùng chung cho PDF (16.6).
 *
 * 🔴 VÌ SAO TÁCH RA KHỎI COMPONENT. Bản in trên màn (`ban-tong-hop.tsx`) và bản PDF nói
 * đúng một nội dung. Gõ lại nội dung đó lần thứ hai bên trong bộ sinh PDF là dựng hai
 * nguồn sự thật, và chúng chỉ lệch nhau vào đúng ngày ai đó sửa một bên — kiểu lỗi mà cả
 * repo này đã trả giá nhiều lần. Ở đây là hàm THUẦN: vào một `BanPhanTich`, ra một danh
 * sách dòng có nhãn kiểu. Ai vẽ thì vẽ.
 *
 * Thuộc TẦNG LÕI (ADR-004): không React, không DOM.
 */

import { thayDaiTuCap } from "@/lib/disc/engine-goc/config/disc-lech-cap";
import {
  MO_TA_LECH,
  THOA_THUAN,
  TRUNG_KHOP,
  VIEC_CUA_TOI,
} from "@/lib/disc/engine-goc/config/disc-noi-dung-cap";
import { CHU_TONG_HOP, TRUC } from "@/lib/disc/engine-goc/config/disc-tu-dien";
import type { BanPhanTich } from "@/lib/disc/engine-goc/modules/report/phan-tich-gia-dinh";

/** Vai trò trình bày của một dòng. Người vẽ tự quyết cỡ chữ và khoảng cách. */
export type KieuDong = "tieuDe" | "tieuDeLat" | "tieuDeTruc" | "than" | "nhanManh";

export type DongBan = {
  readonly kieu: KieuDong;
  readonly chu: string;
};

/**
 * Mọi dòng chữ của MỘT bản, đúng thứ tự đọc.
 *
 * 🔴 CHỈ nhận một `BanPhanTich` — cố ý không nhận cả mảng. Đây là hàng rào *"mỗi người
 * một tờ"* đặt ở chỗ thấp nhất có thể: hàm này không có cách nào nhìn thấy bản của người
 * khác, nên không có cách nào lỡ tay trộn chúng vào nhau.
 *
 * Lưu ý về nghĩa của "một tờ": tờ của Bin CÓ nhắc tên Mẹ Lan — một lát cắt là chuyện giữa
 * hai người, không nói tên thì không nói được gì. Thứ không được lọt sang là **BẢN của Mẹ
 * Lan**, tức phần Mẹ Lan đọc về cả nhà.
 */
export function dongChoBan(ban: BanPhanTich): DongBan[] {
  const dong: DongBan[] = [
    { kieu: "tieuDe", chu: CHU_TONG_HOP.tieuDeBan.replace("{ten}", ban.tenLuc) },
  ];

  for (const lat of ban.latCat) {
    const thay = (chu: string) => thayDaiTuCap(chu, lat.theQuyen, lat.tenNguoiKia);
    dong.push({
      kieu: "tieuDeLat",
      chu: CHU_TONG_HOP.nhanLatCat
        .replace("{ten}", ban.tenLuc)
        .replace("{nguoiKia}", lat.tenNguoiKia),
    });

    if (lat.trucLech.length > 0) {
      for (const t of lat.trucLech) {
        dong.push({ kieu: "tieuDeTruc", chu: TRUC[t.truc].ten });
        dong.push({ kieu: "than", chu: thay(MO_TA_LECH[t.truc][t.huong].veToi) });
        dong.push({ kieu: "than", chu: thay(MO_TA_LECH[t.truc][t.huong].veNguoiKia) });
        dong.push({
          kieu: "nhanManh",
          chu: `${CHU_TONG_HOP.nhanViecCuaToi.replace("{ten}", ban.tenLuc)}: ${thay(
            VIEC_CUA_TOI[t.truc][t.huong][lat.theQuyen],
          )}`,
        });
        dong.push({
          kieu: "than",
          chu: `${CHU_TONG_HOP.nhanThoaThuan}: ${thay(THOA_THUAN[t.truc][t.huong])}`,
        });
      }
    } else if (lat.trungKhop) {
      dong.push({ kieu: "tieuDeTruc", chu: CHU_TONG_HOP.nhanTrungKhop });
      for (const tk of lat.trungKhop) {
        dong.push({ kieu: "than", chu: TRUNG_KHOP[tk.truc][tk.kieu] });
      }
    }
  }

  return dong;
}

/**
 * Tên tệp cho bản của một người: `{tên}-{yyyy-mm-dd}-{HHhMM}.pdf`.
 *
 * 🔴 BỎ DẤU VÀ LỌC KÝ TỰ. Tên tệp đi qua hệ tệp của Windows, macOS, Android và cả bộ giải
 * nén `.zip` — mỗi nơi cấm một bộ ký tự khác nhau, và một tên tệp hỏng thì cả tệp coi như
 * không mở được. Bỏ dấu ở ĐÂY chứ không ở nội dung: chữ bên trong PDF vẫn đủ dấu.
 */
export function tenTepBan(ten: string, luc: Date): string {
  const hai = (n: number) => String(n).padStart(2, "0");
  const ngay = `${luc.getFullYear()}-${hai(luc.getMonth() + 1)}-${hai(luc.getDate())}`;
  const gio = `${hai(luc.getHours())}h${hai(luc.getMinutes())}`;
  const sach =
    ten
      .normalize("NFD")
      .replace(/[̀-ͯ]/gu, "")
      .replace(/đ/gu, "d")
      .replace(/Đ/gu, "D")
      .replace(/[^A-Za-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "nguoi";
  return `${sach}-${ngay}-${gio}.pdf`;
}
