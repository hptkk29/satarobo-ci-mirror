// lib/parttime/doi-soat-dong-bo.ts — ĐỐI SOÁT ĐỊNH KỲ phân công Parttime (G1, docs/cham-cong/parttime/23-LUOI-PHAN-CONG-GV.md §3).
//
// Vì sao: bộ đồng bộ chạy theo SỰ KIỆN (dấu `parttime.staffing_dirty` / gọi thẳng `dongBoNgay`). Không có lượt quét lại nào ⇒ một
// sự kiện sót (đường ghi chưa đánh dấu, đánh dấu Trial không atomic, sập giữa chừng) thì lưới sai MÃI. Hàm này gọi lại CHÍNH
// `dongBoNgay` cho mọi nguồn của một khoảng ngày — bộ đồng bộ vốn idempotent (nguồn đã đúng ⇒ không ghi gì), nên "đúng sẵn" là no-op.
//
// Phạm vi: CHỈ [hôm nay, hôm nay + `soNgay`] (giờ VN). Buổi đã qua KHÔNG đối soát tự động — chốt 20/10/2026: không mời / không dựng
// phân công hồi tố; buổi đã qua đi đường đối soát lịch sử có người duyệt (`suaBuoiDaQua`).
// Nguồn = (a) mọi buổi lớp / case học bù / buổi trial trong khoảng ở cơ sở ĐANG BẬT phân công + (b) mọi nguồn còn phân công SỐNG trong
// khoảng ở BẤT KỲ cơ sở nào (để huỷ phân công mồ côi khi cơ sở đã tắt / nguồn đã đổi). Không cơ sở nào bật và không phân công sống
// nào ⇒ không làm gì.
import "server-only";
import { db } from "@/lib/db";
import { vnYmd } from "@/lib/time/vn";
import { CASE_CHO_DUYET } from "@/lib/hoc-bu/duyet-case-thuan";
import { coSoCoHieuLuc } from "./cong-tac";
import { dongBoNgay, type KetQuaChayDongBo } from "./dong-bo";
import { SONG_CHUA_CHOT } from "./phan-cong";
import type { Nguon, NguoiThaoTac } from "./phan-cong-db";

const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const congNgay = (ymd: string, n: number) => {
  const d = ngayDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Mặc định của cron: 3 tuần tới — đủ phủ "tuần này + tuần sau" của lưới và mọi booking học bù / Trial thường gặp. */
export const SO_NGAY_DOI_SOAT = 21;

/** Danh sách nguồn cần đối soát trong [tu, den] (ngày VN, gồm hai đầu). */
export async function nguonCanDoiSoat(p: { tu: string; den: string; centerIds?: readonly string[] }): Promise<Nguon[]> {
  const tuVn = new Date(`${p.tu}T00:00:00+07:00`);
  const denVn = new Date(new Date(`${p.den}T00:00:00+07:00`).getTime() + 86_400_000);
  const centers = p.centerIds ?? (await db.center.findMany({ select: { id: true } })).map((c) => c.id);
  const bat = [...(await coSoCoHieuLuc("STAFFING", centers))];
  const [lop, bu, trial, song] = await Promise.all([
    bat.length
      ? db.classSession.findMany({ where: { date: { gte: tuVn, lt: denVn }, OR: [{ centerId: { in: bat } }, { centerId: null, class: { centerId: { in: bat } } }] }, select: { id: true } })
      : [],
    // Case CHỜ DUYỆT chưa là lịch thật — không đưa vào bộ phân công (lớp chặn thứ hai; engine cũng tự đóng nó, ca [PT3B-MD-04]).
    bat.length
      ? db.makeupCase.findMany({ where: { centerId: { in: bat }, date: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, status: { not: CASE_CHO_DUYET } }, select: { id: true } })
      : [],
    bat.length
      ? db.trialClassSession.findMany({ where: { date: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, trialClass: { centerId: { in: bat } } }, select: { id: true } })
      : [],
    db.sessionStaffAssignment.findMany({
      where: { ngay: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, status: { in: [...SONG_CHUA_CHOT] }, ...(p.centerIds ? { centerId: { in: [...p.centerIds] } } : {}) },
      select: { sourceType: true, sourceId: true },
      distinct: ["sourceType", "sourceId"],
    }),
  ]);
  const ra = new Map<string, Nguon>();
  for (const x of lop) ra.set(`CLASS_SESSION:${x.id}`, { sourceType: "CLASS_SESSION", sourceId: x.id });
  for (const x of bu) ra.set(`MAKEUP_CASE:${x.id}`, { sourceType: "MAKEUP_CASE", sourceId: x.id });
  for (const x of trial) ra.set(`TRIAL_SESSION:${x.id}`, { sourceType: "TRIAL_SESSION", sourceId: x.id });
  for (const x of song) ra.set(`${x.sourceType}:${x.sourceId}`, { sourceType: x.sourceType, sourceId: x.sourceId });
  return [...ra.values()];
}

/** Chạy đối soát: [hôm nay, hôm nay + `soNgay`] theo giờ VN của `now`. */
export async function doiSoatDongBo(p: { now: Date; soNgay: number; actor: NguoiThaoTac; centerIds?: readonly string[] }): Promise<KetQuaChayDongBo & { tu: string; den: string }> {
  const tu = vnYmd(p.now);
  const den = congNgay(tu, p.soNgay);
  const nguon = await nguonCanDoiSoat({ tu, den, centerIds: p.centerIds });
  const kq = await dongBoNgay(nguon, "DOI_SOAT_DINH_KY", p.actor);
  return { ...kq, tu, den };
}
