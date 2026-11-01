/**
 * lib/cham-cong/suc-khoe-danh-muc-db.ts — đếm danh mục nền rồi giao cho hàm THUẦN xét.
 *
 * Tách khỏi `suc-khoe-danh-muc.ts` để phần LUẬT kiểm được không cần Postgres (14 ca ở
 * `suc-khoe-danh-muc.test.ts`), còn file này chỉ làm đúng một việc: đếm.
 *
 * ⚠️ Bốn danh mục đầu là TOÀN CỤC thật (`ShiftTemplate` dùng chung `centerId: null`,
 * `LeaveType`, `SessionCategory`, `TeachingCreditType` không có cột cơ sở) nên đếm trần là
 * đúng. Nhưng `WorkLocation` thì THEO CƠ SỞ — đếm trần ở đó là nói cho người CS1 biết CS2
 * đang thiếu gì. Vì vậy hàm BẮT BUỘC nhận danh sách cơ sở người đang xem được cấu hình;
 * không có tham số mặc định (luật 7: mặc định của SCOPE phải fail-closed, không bao giờ
 * là "tất cả").
 */
import { db } from "@/lib/db";

import {
  coCanhBaoNang,
  kiemSucKhoeDanhMuc,
  type CanhBaoDanhMuc,
} from "./suc-khoe-danh-muc";

/**
 * @param coSoVanHanhIds `centerId` của những cơ sở VẬN HÀNH mà người xem có quyền cấu hình
 *   (đã bỏ Hội sở — Q-04: HO không có quầy nên không có điểm chấm).
 */
export async function docSucKhoeDanhMuc(
  coSoVanHanhIds: readonly string[],
): Promise<CanhBaoDanhMuc[]> {
  const [maCa, loaiNghi, phanLoaiBuoi, soPhanLoaiMacDinh, loaiCongDay, diemCham] =
    await Promise.all([
      db.shiftTemplate.count({ where: { centerId: null } }),
      db.leaveType.count(),
      db.sessionCategory.count(),
      db.sessionCategory.count({ where: { isDefault: true } }),
      db.teachingCreditType.count(),
      coSoVanHanhIds.length
        ? db.workLocation.count({ where: { centerId: { in: [...coSoVanHanhIds] } } })
        : Promise.resolve(0),
    ]);

  const ds = kiemSucKhoeDanhMuc({
    maCa,
    loaiNghi,
    phanLoaiBuoi,
    soPhanLoaiMacDinh,
    loaiCongDay,
    diemCham,
    coSoVanHanh: coSoVanHanhIds.length,
  });

  // GHI LOG — cổng này không chặn, nên log là thứ duy nhất còn lại nếu không ai đọc màn.
  // Tiền tố cố định để lọc được trên Vercel; in mã cảnh báo chứ không in câu chữ (câu chữ
  // sẽ đổi, mã thì không — ca test neo vào mã).
  if (ds.length) {
    const nang = coCanhBaoNang(ds);
    console.warn(
      `[suc-khoe-danh-muc] ${nang ? "NANG" : "NHE"} · ${ds.map((c) => c.ma).join(",")} · ` +
        `maCa=${maCa} loaiNghi=${loaiNghi} phanLoai=${phanLoaiBuoi}/${soPhanLoaiMacDinh} ` +
        `congDay=${loaiCongDay} diemCham=${diemCham}/${coSoVanHanhIds.length}`,
    );
  }
  return ds;
}
