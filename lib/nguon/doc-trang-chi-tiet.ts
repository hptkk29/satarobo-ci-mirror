/**
 * lib/nguon/doc-trang-chi-tiet.ts — MỘT lượt đọc cho trang CHI TIẾT một nguồn (SPEC nguồn động §4 mục 4): ghép các hàm đọc đã có, chạy SONG SONG, và CÔ LẬP lỗi theo mục.
 *
 * ── Vì sao ghép ở đây, không ở page.tsx ───────────────────────────────────────────────────────
 *  · Page async chỉ lấy dữ liệu rồi đưa props thuần cho các mục — mục nào cũng test được bằng RTL không cần DB (luật: màn đọc dữ liệu phải có chỗ cấy lỗi);
 *  · SÁU câu đọc độc lập chạy trong MỘT `Promise.all` (CLAUDE.md «trang admin chậm = độ sâu tuần tự»: nối đuôi là sáu lượt đi-về cộng dồn);
 *  · một mục đọc hỏng không làm sập cả trang: mục đó nói «không đọc được», sáu mục còn lại vẫn đọc được. Thiếu quyền (`PermissionError`) KHÁC lỗi — hai trạng thái, hai câu.
 *
 * ── Không viết lại luật ───────────────────────────────────────────────────────────────────────
 * Không có điều kiện quyền/phạm vi nào ở đây: mỗi hàm đọc tự gác (`sources:view`, `phamViNguoiXem`, `scopedDb`). Tệp này chỉ ghép + bắt lỗi.
 *
 * `now` BẮT BUỘC (luật 19). `lichSuToiDa` BẮT BUỘC, không mặc định: nó quyết trang đọc 20 hay 200 dòng nhật ký.
 */
import type { Actor } from "@/lib/auth/actor";
import { PermissionError } from "@/lib/auth/can";
import { db } from "@/lib/db";
import { demNguoiGioiThieuTheoLoai, type NguoiGioiThieuTheoLoai } from "./dem-nguoi-gioi-thieu";
import { docChiTietNguon, type ChiTietNguon } from "./doc-danh-muc";
import {
  docChinhSachApDungCuaNguon,
  docHoaHongCuaNguon,
  docLichSuNguon,
  docNguonDeSua,
  type ChinhSachApDungCuaNguon,
  type HoaHongCuaNguon,
  type MucLichSuNguon,
  type NguonDeSuaView,
} from "./doc-chi-tiet-nguon";

/** Kết quả đọc MỘT mục: có dữ liệu, thiếu quyền, hoặc lỗi — ba trạng thái KHÁC nhau, màn hình nói ba câu khác nhau. */
export type KetQuaMuc<T> = { ok: true; du: T } | { ok: false; loai: "QUYEN" | "LOI" };

/** Chạy một câu đọc, đổi ném lỗi thành trạng thái. Chỉ ghi TÊN lỗi (không thông điệp: thông điệp Prisma có thể mang giá trị tham số). */
export async function docMuc<T>(nhan: string, f: () => Promise<T>): Promise<KetQuaMuc<T>> {
  try {
    return { ok: true, du: await f() };
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, loai: "QUYEN" };
    console.error(`[nguon/chi-tiet] mục «${nhan}» đọc lỗi`, e instanceof Error ? e.name : "?");
    return { ok: false, loai: "LOI" };
  }
}

export type TrangChiTietNguon = {
  /** Tracking + thống kê (đếm lead qua `scopedDb`). */
  chiTiet: KetQuaMuc<ChiTietNguon>;
  /** Thông tin + Attribution: nguồn đầy đủ cột + «đã dùng» + trường bị khoá. */
  nguon: KetQuaMuc<NguonDeSuaView>;
  /** Tên đơn vị sở hữu nguồn (`ownerOrgUnitId`) — id thô không đọc được. null = nguồn không gắn đơn vị, hoặc không đọc được tên. */
  tenDonVi: string | null;
  /** Đối tượng liên quan: đếm lead theo loại người giới thiệu. */
  nguoiGioiThieu: KetQuaMuc<NguoiGioiThieuTheoLoai>;
  /** Chính sách áp dụng THẬT (câu trả lời của engine) — hoa hồng nguồn tách khỏi giao dịch khác. */
  chinhSach: KetQuaMuc<ChinhSachApDungCuaNguon>;
  /** Tiền đã ghi sổ. `du = null` ⇒ người xem KHÔNG có quyền xem hoa hồng (khác «0 đồng»). */
  hoaHong: KetQuaMuc<HoaHongCuaNguon | null>;
  /** Nhật ký, mới nhất trước. `biCat` = còn dòng cũ hơn mà chưa đọc. */
  lichSu: KetQuaMuc<{ muc: MucLichSuNguon[]; biCat: boolean }>;
};

/** Trần cứng của `docLichSuNguon`. Đọc đúng trần mà vẫn đủ trần dòng ⇒ không biết còn nữa hay không: nói «có thể còn», không nói «hết». */
export const TRAN_LICH_SU_NGUON = 200;

/**
 * `null` ⇒ không có nguồn mã này (nơi gọi `notFound()`). Quyết định «không có» CHỈ từ các hàm trả `null` khi không thấy nhóm; một mục LỖI thì không được coi là «không có».
 */
export async function docTrangChiTietNguon(
  actor: Actor,
  code: string,
  p: { now: Date; lichSuToiDa: number },
): Promise<TrangChiTietNguon | null> {
  const toiDa = Math.min(Math.max(p.lichSuToiDa, 1), TRAN_LICH_SU_NGUON);
  // Xin thêm MỘT dòng để biết «còn nữa không» mà không cần câu đếm riêng; đã ở trần thì không xin được nữa.
  const xin = Math.min(toiDa + 1, TRAN_LICH_SU_NGUON);

  const [chiTiet, nguon, nguoiGioiThieu, chinhSach, hoaHong, lichSu] = await Promise.all([
    docMuc("thống kê", () => docChiTietNguon(actor, code, p.now)),
    docMuc("thông tin", () => docNguonDeSua(actor, code)),
    docMuc("người giới thiệu", () => demNguoiGioiThieuTheoLoai(actor, code)),
    docMuc("chính sách", () => docChinhSachApDungCuaNguon(actor, code, p.now)),
    docMuc("hoa hồng", () => docHoaHongCuaNguon(actor, code)),
    docMuc("nhật ký", () => docLichSuNguon(actor, code, xin)),
  ]);

  // Không có nhóm ⇒ mọi hàm có kiểm tồn tại trả null. Chỉ cần MỘT mục đọc thành công mà báo «không có» là đủ để 404.
  const khongCo = [chiTiet, nguon, chinhSach, lichSu].some((r) => r.ok && r.du === null);
  if (khongCo) return null;

  // Từ đây các mục `ok` đều khác null (đã loại ở trên); thu hẹp kiểu bằng hàm, không ép `!`.
  // Một câu đọc tên đơn vị, CHỈ khi nguồn có gắn đơn vị (cột trần không FK nên không include được cùng câu đọc nguồn). Lỗi ở đây không làm mất mục: tên thiếu thì màn nói «không đọc được tên».
  const maDonVi = nguon.ok && nguon.du ? nguon.du.ownerOrgUnitId : null;
  const donVi = maDonVi ? await docMuc("đơn vị", () => db.orgUnit.findFirst({ where: { id: maDonVi, deletedAt: null }, select: { name: true } })) : null;
  const tenDonVi = donVi?.ok ? (donVi.du?.name ?? null) : null;

  const boNull = <T>(r: KetQuaMuc<T | null>): KetQuaMuc<T> => (r.ok ? (r.du === null ? { ok: false, loai: "LOI" } : { ok: true, du: r.du }) : r);

  return {
    chiTiet: boNull(chiTiet),
    nguon: boNull(nguon),
    tenDonVi,
    nguoiGioiThieu,
    chinhSach: boNull(chinhSach),
    hoaHong,
    lichSu: lichSu.ok
      ? lichSu.du === null
        ? { ok: false, loai: "LOI" }
        : { ok: true, du: { muc: lichSu.du.slice(0, toiDa), biCat: lichSu.du.length > toiDa || (toiDa >= TRAN_LICH_SU_NGUON && lichSu.du.length >= TRAN_LICH_SU_NGUON) } }
      : lichSu,
  };
}
