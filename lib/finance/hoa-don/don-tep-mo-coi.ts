import "server-only";
import { db } from "@/lib/db";
import { khoHoaDonDaCauHinh, lietKeTepHoaDon, xoaNhieuTepHoaDon } from "./kho-tep";
import { chonTepMoCoi, TRAN_XOA_MOI_LUOT } from "./tep-mo-coi";

// lib/finance/hoa-don/don-tep-mo-coi.ts — cron HẰNG TUẦN dọn tệp mồ côi của kho hoá đơn (PLAN §6).
//
// Ba nhịp, nối đuôi có chủ đích:
//   1. liệt kê bucket hoá đơn, tiền tố `hoa-don/` (`lietKeTepHoaDon` — getter bucket NÉM khi trùng bucket
//      công khai, nên không có đường nào liệt kê nhầm cdn);
//   2. tra tập khoá đang được tham chiếu — MỘT câu, SAU nhịp 1 (hoá đơn lưu trong lúc liệt kê vẫn được
//      thấy), bằng `db` TRẦN: câu tra để CHẶN phải không-scope, lọc scope là bỏ sót tham chiếu của cơ sở
//      khác ⇒ xoá tệp của hoá đơn còn sống;
//   3. chọn (`chonTepMoCoi`, thuần) rồi xoá đúng danh sách đó (`xoaNhieuTepHoaDon`).
//
// ⚠️ KHÔNG lọc trạng thái ở nhịp 2: bản THAY_THE (đã huỷ) vẫn tải được để đối chiếu, bản NHÁP / KHÔNG
// XUẤT vẫn giữ tệp của mình. Chỉ tệp không hoá đơn nào trỏ tới mới là mồ côi.
// ⚠️ Chi phí nhịp 2: đọc hai cột khoá của MỌI hoá đơn có tệp — số dòng tăng theo số hoá đơn từng xuất
// (vài nghìn dòng/năm, hai chuỗi ngắn mỗi dòng), một lần mỗi tuần. Rẻ hơn tách `IN (…)` theo lô ứng viên
// (mỗi lô một câu), và không chạm trần tham số của Postgres khi kho lớn.
// ⚠️ KHÔNG hỏi cờ màn hoá đơn: cờ gác màn + route tải + email; tệp mồ côi mang MST/địa chỉ khách vẫn phải
// dọn khi màn đang tắt.
// ⚠️ Kế toán để tab mở quá 7 ngày rồi mới lưu nháp: tệp đã bị dọn ⇒ bước lưu xác minh LẠI tệp
// (`xacMinhTepHoaDon` → HEAD) và báo "Không thấy tệp trên kho — tải lên lại". Hỏng có tiếng, không câm.

export type KetQuaDonTep = {
  /** Lý do bỏ qua cả lượt; `null` = đã chạy. */
  boQua: "KHO_CHUA_CAU_HINH" | null;
  daXet: number;
  moCoi: number;
  daXoa: number;
  loiXoa: number;
  /** Mồ côi còn lại do chạm trần — lượt sau dọn tiếp. */
  conLai: number;
  /** Liệt kê chạm trần trang — phần sau của kho chưa được xét lượt này. */
  catNgang: boolean;
};

export async function donTepHoaDonMoCoi(now: Date): Promise<KetQuaDonTep> {
  if (!khoHoaDonDaCauHinh()) {
    return { boQua: "KHO_CHUA_CAU_HINH", daXet: 0, moCoi: 0, daXoa: 0, loiXoa: 0, conLai: 0, catNgang: false };
  }

  const { tep, catNgang } = await lietKeTepHoaDon();
  const hoaDon = await db.hoaDonDienTu.findMany({
    where: { OR: [{ tepPdfKey: { not: null } }, { tepXmlKey: { not: null } }] },
    select: { tepPdfKey: true, tepXmlKey: true },
  });
  const thamChieu = new Set<string>();
  for (const h of hoaDon) {
    if (h.tepPdfKey) thamChieu.add(h.tepPdfKey);
    if (h.tepXmlKey) thamChieu.add(h.tepXmlKey);
  }

  const { xoa, moCoi } = chonTepMoCoi({ tep, thamChieu, now, tran: TRAN_XOA_MOI_LUOT });
  const { daXoa, loi } = xoa.length > 0 ? await xoaNhieuTepHoaDon(xoa) : { daXoa: 0, loi: 0 };

  const kq: KetQuaDonTep = {
    boQua: null,
    daXet: tep.length,
    moCoi,
    daXoa,
    loiXoa: loi,
    conLai: moCoi - xoa.length,
    catNgang,
  };
  // CHỈ số đếm: khoá tệp mang mã đơn, và log VPS không có hạn giữ — đừng thêm danh sách khoá vào đây.
  console.info(
    `[cron:hoa-don-tep-mo-coi] daXet=${kq.daXet} moCoi=${kq.moCoi} daXoa=${kq.daXoa} loiXoa=${kq.loiXoa} conLai=${kq.conLai} catNgang=${kq.catNgang}`,
  );
  return kq;
}
