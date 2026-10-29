import "server-only";
import { db } from "@/lib/db";
import { khoBaoLuuDaCauHinh, lietKeTepBaoLuu, xoaNhieuTepBaoLuu } from "@/lib/bao-luu/kho-tep";
import { chonTepMoCoi, TRAN_XOA_MOI_LUOT, type TepTrongKho } from "@/lib/bao-luu/tep-mo-coi";

// lib/bao-luu/don-tep-mo-coi.ts — cron HẰNG TUẦN xử lý tệp mồ côi của kho bảo lưu. PHIÊN 7. Khuôn: `lib/finance/hoa-don/don-tep-mo-coi.ts`.
//
// Ba nhịp nối đuôi có chủ đích: (1) liệt kê kho; (2) tra tập khoá đang được tham chiếu — MỘT câu SAU nhịp 1 (hồ sơ lưu trong lúc liệt kê
// vẫn được thấy), bằng `db` TRẦN: câu tra để CHẶN phải không-scope, lọc scope là bỏ sót tham chiếu của cơ sở khác ⇒ xoá tệp của hồ sơ còn sống;
// (3) chọn (thuần) rồi — CHỈ KHI `choPhepXoa` — xoá đúng danh sách đó.
//
// ⚠️ MẶC ĐỊNH CHỈ BÁO CÁO, KHÔNG XOÁ (`choPhepXoa = false`). Tệp bảo lưu là chứng từ của một quy chế mới; một lỗi trong tập tham chiếu sẽ xoá
// đơn đã ký của một hồ sơ còn sống và KHÔNG khôi phục được (R2 không thùng rác). Người vận hành bật xoá bằng env `BAO_LUU_DON_TEP_XOA=1`
// sau khi đã đọc vài lượt báo cáo thấy con số `moCoi` hợp lý. Xem CAN-QUYET K15.
// ⚠️ KHÔNG lọc trạng thái ở nhịp 2: hồ sơ REJECTED / CANCELLED / ENDED vẫn giữ tệp của mình.
// ⚠️ KHÔNG hỏi cờ `pause.enabled`: tệp mồ côi mang dữ liệu trẻ em vẫn phải được đo khi cờ tắt.

export type KetQuaDonTepBaoLuu = {
  boQua: "KHO_CHUA_CAU_HINH" | null;
  daXet: number;
  moCoi: number;
  /** Số tệp ĐÃ CHỌN để xoá lượt này (≤ trần) — báo cáo kể cả khi không được phép xoá. */
  seXoa: number;
  daXoa: number;
  loiXoa: number;
  choPhepXoa: boolean;
  conLai: number;
  catNgang: boolean;
};

export type PhuThuocDonTep = {
  daCauHinh: () => boolean;
  lietKe: () => Promise<{ tep: TepTrongKho[]; catNgang: boolean }>;
  docThamChieu: () => Promise<Set<string>>;
  xoa: (khoa: readonly string[]) => Promise<{ daXoa: number; loi: number }>;
};

/** Mọi khoá mà MỘT hồ sơ nào đó (mọi trạng thái) đang trỏ tới. Một câu, không scope. */
export async function docKhoaThamChieuBaoLuu(): Promise<Set<string>> {
  const hs = await db.studentReserve.findMany({
    where: { OR: [{ applicationFileKey: { not: null } }, { evidenceFileKeys: { isEmpty: false } }] },
    select: { applicationFileKey: true, evidenceFileKeys: true },
  });
  const ra = new Set<string>();
  for (const h of hs) {
    if (h.applicationFileKey) ra.add(h.applicationFileKey);
    for (const k of h.evidenceFileKeys) ra.add(k);
  }
  return ra;
}

const MAC_DINH: PhuThuocDonTep = {
  daCauHinh: khoBaoLuuDaCauHinh,
  lietKe: lietKeTepBaoLuu,
  docThamChieu: docKhoaThamChieuBaoLuu,
  xoa: xoaNhieuTepBaoLuu,
};

export async function donTepBaoLuuMoCoi(now: Date, opts: { choPhepXoa: boolean }, dep: PhuThuocDonTep = MAC_DINH): Promise<KetQuaDonTepBaoLuu> {
  if (!dep.daCauHinh()) {
    return { boQua: "KHO_CHUA_CAU_HINH", daXet: 0, moCoi: 0, seXoa: 0, daXoa: 0, loiXoa: 0, choPhepXoa: opts.choPhepXoa, conLai: 0, catNgang: false };
  }
  const { tep, catNgang } = await dep.lietKe();
  const thamChieu = await dep.docThamChieu();
  const { xoa, moCoi } = chonTepMoCoi({ tep, thamChieu, now, tran: TRAN_XOA_MOI_LUOT });
  const kq = opts.choPhepXoa && xoa.length > 0 ? await dep.xoa(xoa) : { daXoa: 0, loi: 0 };
  const ra: KetQuaDonTepBaoLuu = {
    boQua: null,
    daXet: tep.length,
    moCoi,
    seXoa: xoa.length,
    daXoa: kq.daXoa,
    loiXoa: kq.loi,
    choPhepXoa: opts.choPhepXoa,
    conLai: Math.max(0, moCoi - kq.daXoa),
    catNgang,
  };
  console.info(`[bao-luu/don-tep-mo-coi] ${JSON.stringify(ra)}`);
  return ra;
}
