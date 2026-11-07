// lib/students/ma-hoc-vien-dang.ts — DẠNG DUY NHẤT của mã học viên: `CS1-26-AB3K9P`. THUẦN (không DB).
//
//   <mã cơ sở>-<2 số cuối năm>-<6 ký tự ngẫu nhiên>
//
// Chủ dự án chốt 06/11/2026: "đúng 1 form thôi" + "từ nay về sau không được bị lại nữa". Sự cố sinh ra luật này: màn Học
// viên hiện `COSONGUYENHUUTHO-26-FD8Q6T` cạnh `CS1-26-XVM455` — tiền tố lấy nhầm từ `Center.id` (slug) thay vì
// `Center.code`. ⚠️ Mã sai ấy VẪN KHỚP mẫu `XXX-26-XXXXXX`: chỉ kiểm HÌNH DẠNG thì không bắt được, phải kiểm cả TIỀN TỐ so với
// mã cơ sở thật. Đó là lý do hàm dưới nhận `maCoSo`.
//
// Mọi nơi NHẬN mã từ người/tệp (nút «Sửa mã», form học viên, nhập Excel) phải đi qua `loiMaHocVien`; mọi nơi SINH mã đi qua
// `genStudentCodeV2ChoCoSo` (`lib/codegen.ts`). Lưới canh: `lib/codegen-ma-hoc-vien.test.ts`.

/** Charset bỏ ký tự dễ nhầm: I, L, O, 0, 1. */
export const STUDENT_CODE_V2_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Mã cơ sở → dạng dùng trong mã học viên: in hoa, bỏ ký tự không phải chữ-số (`cs-1` → `CS1`). */
export function chuanHoaMaCoSo(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const DANG = new RegExp(`^([A-Z0-9]+)-(\\d{2})-([${STUDENT_CODE_V2_CHARSET}]{6})$`);

export const LOI_DANG_MA_HOC_VIEN =
  "Mã học viên phải có dạng CS1-26-AB3K9P: mã cơ sở – 2 số cuối năm – 6 ký tự (chữ in hoa và số, không dùng I, L, O, 0, 1).";

/**
 * Lỗi của một mã học viên MỚI, hoặc `null` nếu hợp lệ.
 *
 * `maCoSo`:
 *  · một chuỗi — tiền tố PHẢI bằng mã cơ sở này (học viên đã biết cơ sở);
 *  · một mảng — tiền tố PHẢI thuộc một trong các mã cơ sở đang có (chưa biết cơ sở của dòng: nhập Excel);
 *  · `null` — chỉ kiểm hình dạng (học viên chưa gắn cơ sở, không có gì để đối chiếu).
 */
export function loiMaHocVien(ma: string, maCoSo: string | readonly string[] | null): string | null {
  const m = DANG.exec(ma.trim());
  if (!m) return LOI_DANG_MA_HOC_VIEN;
  if (maCoSo === null) return null;
  const tienTo = m[1]!;
  if (typeof maCoSo === "string") {
    const dung = chuanHoaMaCoSo(maCoSo);
    return tienTo === dung ? null : `Mã học viên phải bắt đầu bằng mã cơ sở của học viên này: "${dung}-".`;
  }
  const dung = maCoSo.map(chuanHoaMaCoSo).filter((x) => x !== "");
  return dung.includes(tienTo)
    ? null
    : `Mã học viên phải bắt đầu bằng mã một cơ sở có thật (${dung.join(", ")}), không phải "${tienTo}".`;
}

/**
 * Mã học viên HỢP LỆ và TẤT ĐỊNH từ một số thứ tự — cho seed / fixture cần mã ổn định (chạy lại ra đúng mã cũ).
 * Không dùng cho học viên thật (đó là việc của `genStudentCodeV2ChoCoSo`: ngẫu nhiên + tránh trùng trên DB).
 *
 * Từ 06/11/2026 DB có trigger (`Student_studentCode_dang_trg`) từ chối mã sai dạng hoặc sai tiền tố cơ sở, nên fixture không còn gõ tay
 * `HV-001` / `HS-xyz` được nữa. `n` trong [0, 31^6) — dư cho mọi seed (31^6 ≈ 887 triệu).
 */
export function maHocVienTuSo(maCoSo: string, n: number, yy = "26"): string {
  if (!Number.isInteger(n) || n < 0 || n >= 31 ** 6) throw new Error(`maHocVienTuSo: số ngoài khoảng (${n})`);
  const base = STUDENT_CODE_V2_CHARSET.length;
  let x = n;
  let than = "";
  for (let i = 0; i < 6; i++) {
    than = STUDENT_CODE_V2_CHARSET[x % base] + than;
    x = Math.floor(x / base);
  }
  return `${chuanHoaMaCoSo(maCoSo)}-${yy}-${than}`;
}
