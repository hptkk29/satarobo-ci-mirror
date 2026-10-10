// lib/lms/doi-ten-bai.ts — "seed đổi tên bài này là DỌN HÌNH THỨC hay ĐỔI NỘI DUNG".
// THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 VÌ SAO CẦN PHÂN LOẠI, THAY VÌ IN RA MỘT BẢNG DÀI [26/09/2026]
//
// Dry-run đợt này ra **240 bài sẽ đổi tên** trên prod. Bản đầu của báo cáo in bảng và
// `slice(0, 200)` — tức **40 dòng cuối không ai nhìn**, mà dòng nguy hiểm thì không có
// lý do gì phải nằm trong 200 dòng đầu. Một bảng 240 dòng cũng chẳng ai đọc hết.
//
// Thứ người quyết định THỰC SỰ cần biết không phải "240 dòng đổi", mà là:
// **có dòng nào đổi NỘI DUNG không**. Vì:
//   · đổi hình thức (cắt tiền tố `"HP1 - "`, gộp dấu cách thừa, chuẩn hoá hoa/thường)
//     là DỌN RÁC — mã học phần vốn bị nhét nhầm vào `Lesson.title` vì cột `moduleCode`
//     còn trống; seed trả nó về đúng cột;
//   · đổi NỘI DUNG là thay tên một buổi học — chuỗi ấy đi tới nhãn buổi và tới phiếu
//     gửi PHỤ HUYNH, và không có bản sao nào để lùi (`Lesson.title` là bản duy nhất).
//
// ⚠️ Phép so KHÔNG bỏ dấu tiếng Việt. `"Ôn tập"` và `"On tap"` là hai tên khác nhau với
// người đọc; gộp chúng lại là giấu đúng loại thay đổi cần soi.
//
// ⚠️ Chuẩn hoá Unicode về NFC trước khi so: cùng một chữ "ề" có hai cách mã hoá (tổ hợp
// và dựng sẵn), và hai chuỗi trông y hệt nhau vẫn `!==` nhau. Không chuẩn hoá thì báo
// cáo sẽ dựng ra những dòng "đổi nội dung" mà TRƯỚC và SAU in ra không khác một nét.

/** Tiền tố học phần trong tên bài: `"HP2 - Họa Sĩ Robot"`, `"HP1 —  Ôn tập"`. */
const TIEN_TO_HP = /^HP\s*\d+\s*[-–—:.]\s*/i;

export type LoaiDoiTen =
  /** Cắt tiền tố `"HPn - "` — mã học phần về đúng cột `moduleCode`. */
  | "cat-tien-to"
  /** Gộp các cụm khoảng trắng thừa. */
  | "don-khoang-trang"
  /** Chỉ khác hoa/thường. */
  | "doi-hoa-thuong"
  /** ⚠️ ĐỔI NỘI DUNG — đây là nhóm DUY NHẤT phải đọc từng dòng. */
  | "doi-noi-dung";

export type KetQuaDoiTen = {
  /** Nhóm nặng nhất trong các phép biến đổi phát hiện được. */
  loai: LoaiDoiTen;
  /** Mọi phép biến đổi hình thức nhận ra được — để câu chữ nói rõ "đổi những gì". */
  hinhThuc: Exclude<LoaiDoiTen, "doi-noi-dung">[];
};

function nfc(s: string): string {
  return s.normalize("NFC");
}

/** Gộp mọi cụm khoảng trắng thành một dấu cách, cắt hai đầu. */
function gon(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Tên này đổi kiểu gì.
 *
 * ⚠️ `cu`/`moi` là tên ĐÃ Ở DẠNG THÔ trong DB và trong nguồn — đừng tự cắt tiền tố trước
 * khi gọi, vì chính việc "có cắt tiền tố hay không" là một trong các nhóm cần phân biệt.
 */
export function phanLoaiDoiTen(cu: string, moi: string): KetQuaDoiTen {
  const a = nfc(cu);
  const b = nfc(moi);

  const hinhThuc: Exclude<LoaiDoiTen, "doi-noi-dung">[] = [];
  const coTienTo = TIEN_TO_HP.test(a.trim());
  if (coTienTo) hinhThuc.push("cat-tien-to");

  const aKhongTienTo = a.trim().replace(TIEN_TO_HP, "");
  if (gon(aKhongTienTo) !== aKhongTienTo.trim()) hinhThuc.push("don-khoang-trang");

  const aGon = gon(aKhongTienTo);
  const bGon = gon(b);

  if (aGon === bGon) return { loai: hinhThuc[0] ?? "don-khoang-trang", hinhThuc };

  if (aGon.toLocaleLowerCase("vi") === bGon.toLocaleLowerCase("vi")) {
    hinhThuc.push("doi-hoa-thuong");
    return { loai: "doi-hoa-thuong", hinhThuc };
  }

  // ⚠️ Rơi tới đây là ĐỔI NỘI DUNG — không gộp thêm phép chuẩn hoá nào nữa. Mỗi phép
  // "chuẩn hoá" thêm vào đây là một loại thay đổi bị giấu khỏi người đang quyết.
  return { loai: "doi-noi-dung", hinhThuc };
}

/** Câu chữ tiếng Việt cho từng nhóm — dùng chung giữa báo cáo và bộ ca. */
export const NHAN_DOI_TEN: Record<LoaiDoiTen, string> = {
  "cat-tien-to": "cắt tiền tố học phần (mã về đúng cột `moduleCode`)",
  "don-khoang-trang": "gộp dấu cách thừa",
  "doi-hoa-thuong": "chuẩn hoá hoa/thường",
  "doi-noi-dung": "⚠️ ĐỔI NỘI DUNG — đọc từng dòng",
};
