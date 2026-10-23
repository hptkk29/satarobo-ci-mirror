// lib/parttime/tich-hop.ts — điểm cắm phân công vào các luồng CÓ SẴN (đơn từ, tạo / dời / huỷ / mở lại buổi, đổi GV buổi).
//
// Từ P3a, các điểm cắm KHÔNG tự quyết phải làm gì với phân công: chúng chỉ ĐÁNH DẤU nguồn cần đồng bộ (DomainEvent
// trong cùng giao dịch — `dong-bo.ts`); bộ đồng bộ theo trạng thái sống (`dongBoPhanCongTheoNguon`) làm phần còn lại
// SAU commit, trên `db` trần. Lý do: nhiều nơi gọi chạy trong giao dịch có scope — xem đầu `dong-bo.ts`.
//
// Ngoại lệ có chủ đích: hai hook ĐƠN TỪ (`khiDuyetDayThay`, `khiHuyDonDayThay`) vẫn làm việc NGAY trong giao dịch của
// đơn vì chúng mang MÃ ĐƠN (`sourceWorkRequestId`) mà bộ đồng bộ không suy lại được; chúng cũng đánh dấu để đồng bộ
// soát lại phần còn lại (TA, lịch). Hai cổng của chúng: công tắc STAFFING TẠI CƠ SỞ CỦA BUỔI (`cong-tac.ts`) + ngày thuộc
// SR.QD.238. Các hàm còn lại trả `[]` thông báo — thông báo do bộ đồng bộ gửi sau commit (gộp theo người).
import type { Prisma } from "@prisma/client";
import {
  docBuoi,
  hoanTacThayGiaoVien,
  thamSoApDung,
  thayGiaoVienChinh,
  type NguoiThaoTac,
  type ThongBaoPhanCong,
} from "./phan-cong-db";
import { boXetCongTac } from "./cong-tac";
import { danhDauCanDongBo } from "./dong-bo";

type Tx = Prisma.TransactionClient;
const lop = (sessionId: string) => ({ sourceType: "CLASS_SESSION" as const, sourceId: sessionId });

/** Buổi lớp này có thuộc phạm vi phân công mới không (công tắc STAFFING bật TẠI CƠ SỞ CỦA BUỔI + ngày thuộc SR.QD.238). */
export async function apDungChoBuoiLop(tx: Tx, sessionId: string): Promise<boolean> {
  const xet = await boXetCongTac("STAFFING");
  if (!xet.coNoiNao) return false;
  const b = await docBuoi(tx, lop(sessionId));
  return !!b && xet.tai({ centerId: b.centerId }) && (await thamSoApDung(tx, b.ngay)) != null;
}

/** Đơn dạy thay / nghỉ giữ buổi đã duyệt ⇒ người thay nhận phân công SUBSTITUTE mang mã đơn, chờ họ xác nhận. */
export async function khiDuyetDayThay(
  tx: Tx,
  p: { sessionId: string; gvMoiId: string; donId: string; actor: NguoiThaoTac; lyDo: string },
): Promise<ThongBaoPhanCong[]> {
  if (!(await apDungChoBuoiLop(tx, p.sessionId))) return [];
  const r = await thayGiaoVienChinh(tx, { nguon: lop(p.sessionId), gvMoiId: p.gvMoiId, actor: p.actor, sourceWorkRequestId: p.donId, lyDo: p.lyDo });
  if (!r.ok) throw new Error(r.loi);
  await danhDauCanDongBo(tx, [lop(p.sessionId)], "DOI_GV_BUOI", p.actor);
  return r.thongBao;
}

/** Đơn nghỉ dạy (huỷ buổi) đã duyệt / huỷ buổi ⇒ đánh dấu; đồng bộ huỷ phân công của buổi. */
export async function khiHuyBuoiTheoDon(tx: Tx, p: { sessionId: string; actor: NguoiThaoTac; lyDo: string }): Promise<ThongBaoPhanCong[]> {
  await danhDauCanDongBo(tx, [lop(p.sessionId)], "HUY_BUOI", p.actor);
  return [];
}

/** Huỷ đơn dạy thay ⇒ gỡ phân công của người thay, phân lại người cũ (phải xác nhận lại). */
export async function khiHuyDonDayThay(tx: Tx, p: { sessionId: string; donId: string; actor: NguoiThaoTac }): Promise<ThongBaoPhanCong[]> {
  if (!(await apDungChoBuoiLop(tx, p.sessionId))) return [];
  const r = await hoanTacThayGiaoVien(tx, { nguon: lop(p.sessionId), sourceWorkRequestId: p.donId, actor: p.actor });
  await danhDauCanDongBo(tx, [lop(p.sessionId)], "DOI_GV_BUOI", p.actor);
  return r.thongBao;
}

/** Buổi được mở lại (huỷ đơn nghỉ / QLCS mở lại) + buổi bù đi kèm bị gỡ ⇒ đánh dấu cả hai. */
export async function khiKhoiPhucBuoi(
  tx: Tx,
  p: { sessionId: string; buoiBuId: string | null; actor: NguoiThaoTac },
): Promise<ThongBaoPhanCong[]> {
  await danhDauCanDongBo(tx, p.buoiBuId ? [lop(p.sessionId), lop(p.buoiBuId)] : [lop(p.sessionId)], "MO_LAI_BUOI", p.actor);
  return [];
}

/** Buổi lớp vừa được TẠO ⇒ đánh dấu (đồng bộ dựng phân công mặc định khi công tắc bật + ngày thuộc SR.QD.238). */
export async function khiTaoBuoiLop(tx: Tx, sessionIds: readonly string[], actor: NguoiThaoTac): Promise<ThongBaoPhanCong[]> {
  await danhDauCanDongBo(tx, sessionIds.map(lop), "TAO_BUOI", actor);
  return [];
}

/**
 * Buổi lớp đổi NGÀY/GIỜ ⇒ đánh dấu. Đồng bộ đọc ngày MỚI: còn thuộc SR.QD.238 ⇒ phiên bản +1 (xác nhận lại); dời về
 * trước 15/10 ⇒ huỷ phân công (GAP-05); dời từ trước 15/10 sang sau ⇒ dựng (khi công tắc bật).
 */
export async function khiDoiLichBuoi(tx: Tx, sessionIds: readonly string[], actor: NguoiThaoTac): Promise<ThongBaoPhanCong[]> {
  await danhDauCanDongBo(tx, sessionIds.map(lop), "DOI_LICH_BUOI", actor);
  return [];
}

/** QLCS đổi / gỡ GV dạy thay của MỘT buổi (màn "Điều chỉnh") ⇒ đánh dấu; đồng bộ theo `substituteTeacherId` mới. */
export async function khiDoiGvBuoi(
  tx: Tx,
  p: { sessionId: string; gvMoiId: string | null; actor: NguoiThaoTac; lyDo: string },
): Promise<ThongBaoPhanCong[]> {
  await danhDauCanDongBo(tx, [lop(p.sessionId)], "DOI_GV_BUOI", p.actor);
  return [];
}
