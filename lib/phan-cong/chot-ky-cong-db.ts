// lib/phan-cong/chot-ky-cong-db.ts — GHI CỨNG công Parttime lúc CHỐT KỲ (GĐ6, chốt 10: "công tính khi đọc; lúc chốt kỳ mới ghi cứng
// WorkUnit, người ghi = người bấm chốt; không tài khoản hệ thống"). Chỉ kỳ LUẬT MỚI (cờ `shift.parttimeLuatCongMoiTuKy`).
//
// ĐỔI "AI QUYẾT", KHÔNG ĐỔI "BAO NHIÊU": số lượng / đơn giá / rank lấy ĐÚNG hàm của luồng xác nhận P5 (`anhChupChoDong`,
// `ghiQuyetDinhThucHienTrongTx`, `ghiQuyetDinhTrucTrongTx`) — chỉ khác ai bấm và dòng nào được ghi. Dòng nào được ghi do Ô quyết:
//   · ô TỰ ĐỘNG (`docCongOThang`) ⇒ các phân công dạy trong ô + dòng trực của ô là ứng viên;
//   · ô CẦN XEM (chưa phản ánh / chưa duyệt) ⇒ KHÔNG ghi (chưa tính — chốt 4, 8);
//   · ứng viên mà P5 xếp KHONG_AP_DUNG (Trial — trả riêng, LEGACY, buổi huỷ) / CHUA_XONG / CHAN (vd. Q1 chưa có số tiết) ⇒ KHÔNG ghi,
//     trả về danh sách BỎ QUA kèm lý do (không bỏ im lặng). XEM_TAY (vd. nhận xét trễ) VẪN ghi — ô đủ lượt quét là căn cứ của luật
//     mới; lý do giữ trong ảnh chụp (QUYET-DINH L2-14).
// Thứ tự: DẠY trước (giao dịch riêng, idempotent), rồi mới lập kế hoạch TRỰC — đơn vị trực đếm tiết dạy ĐÃ có đơn vị (`danhGiaTruc`).
// Ghi trực nằm trong giao dịch khoá kỳ (`lockPeriod`). Chốt lại sau khi mở: đơn vị trùng dữ liệu ⇒ không ghi gì (idempotent).
import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { anhChupChoDong, docDoiSoatThucHien, ghiQuyetDinhThucHienTrongTx, snapshotThucHien } from "@/lib/parttime/workunit-db";
import { docTrucDeGhi, ghiQuyetDinhTrucTrongTx, lyDoKhongGhiTruc } from "@/lib/parttime/truc-van-hanh-db";
import type { NguoiThaoTac } from "@/lib/parttime/phan-cong-db";
import { luatKy } from "./cong-o";
import { docCongOThang } from "./cong-o-db";
import { docKyLuatMoi } from "./ky-luat-db";

export type BoQuaGhiCung = { loai: "DAY" | "TRUC"; id: string; userId: string; ngay: string; lyDo: string };
export type KetQuaGhiCung = { soDonViDay: number; soDonViTruc: number; soOChuaTinh: number; boQua: BoQuaGhiCung[] };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const cuoiThang = (periodKey: string) => {
  const [y, m] = periodKey.split("-").map(Number) as [number, number];
  return ymd(new Date(Date.UTC(y, m, 0)));
};

/** Kỳ này có đi luật mới không (đọc cờ). `lockPeriod` hỏi trước để kỳ cũ không tốn câu tra nào thêm. */
export async function kyGhiCung(periodKey: string): Promise<boolean> {
  return luatKy(periodKey, await docKyLuatMoi()) === "MOI";
}

/**
 * Bước 1 — ĐỌC ô + đối soát, rồi GHI đơn vị DẠY trong một giao dịch riêng (idempotent). Trả các dòng trực thuộc ô tự động để bước 2
 * ghi trong giao dịch khoá kỳ, cùng danh sách bỏ qua. Gọi SAU `recomputeRange` (lượt quét ghi thêm khi duyệt phản ánh đã vào).
 */
export async function ghiCungDay(p: { centerId: string; periodKey: string; now: Date; actor: NguoiThaoTac & { id: string } }): Promise<{
  soDonViDay: number;
  soOChuaTinh: number;
  trucTuDong: Set<string>;
  boQua: BoQuaGhiCung[];
}> {
  const tu = `${p.periodKey}-01`;
  const den = cuoiThang(p.periodKey);
  const cong = await docCongOThang({ centerId: p.centerId, periodKey: p.periodKey, den, userId: null });
  const tuDong = cong.o.filter((o) => o.trangThai === "TU_DONG");
  const idDay = [...new Set(tuDong.flatMap((o) => o.assignmentIds))];
  const trucTuDong = new Set(tuDong.flatMap((o) => (o.trucId ? [o.trucId] : [])));
  const boQua: BoQuaGhiCung[] = [];
  if (!idDay.length) return { soDonViDay: 0, soOChuaTinh: cong.o.length - tuDong.length, trucTuDong, boQua };

  const [ds, pcs] = await Promise.all([
    docDoiSoatThucHien({ centerId: p.centerId, tu, den, now: p.now }),
    db.sessionStaffAssignment.findMany({ where: { id: { in: idDay } }, select: { id: true, centerId: true, orgUnitId: true, ngay: true, userId: true } }),
  ]);
  const ke: Parameters<typeof ghiQuyetDinhThucHienTrongTx>[1][] = [];
  for (const id of idDay) {
    const dong = ds.dong.find((d) => d.bc.assignmentId === id);
    const pc = pcs.find((x) => x.id === id);
    if (!dong || !pc) {
      boQua.push({ loai: "DAY", id, userId: pc?.userId ?? "", ngay: pc ? ymd(pc.ngay) : "", lyDo: "Phân công không còn trong đối soát (đã huỷ / bị thay)." });
      continue;
    }
    const lop = dong.ungVien.lop;
    if (lop === "KHONG_AP_DUNG" || lop === "CHUA_XONG" || lop === "CHAN") {
      boQua.push({ loai: "DAY", id, userId: pc.userId, ngay: ymd(pc.ngay), lyDo: `${lop}: ${dong.ungVien.lyDo.join(", ") || "—"}` });
      continue;
    }
    const a = await anhChupChoDong(dong, pc);
    if (!a.ok) {
      boQua.push({ loai: "DAY", id, userId: pc.userId, ngay: ymd(pc.ngay), lyDo: a.loi });
      continue;
    }
    ke.push({ assignmentId: id, pc, dong, anh: a.anh, snapshot: { ...snapshotThucHien(dong), chotKy: true }, quyetDinh: "CONFIRMED", lyDo: `Ghi cứng lúc chốt kỳ ${p.periodKey}`, hangLoat: true, actor: p.actor, now: p.now });
  }
  let soDonViDay = 0;
  if (ke.length) {
    await db.$transaction(
      async (tx) => {
        for (const k of ke) {
          const r = await ghiQuyetDinhThucHienTrongTx(tx, k);
          if (r.workUnitId && !r.daCo) soDonViDay++;
        }
      },
      { timeout: 60_000 },
    );
  }
  return { soDonViDay, soOChuaTinh: cong.o.length - tuDong.length, trucTuDong, boQua };
}

/** Bước 2 — kế hoạch TRỰC (đọc, SAU khi đơn vị dạy đã ghi). Chỉ dòng trực của ô tự động. */
export async function keHoachTruc(p: { centerId: string; periodKey: string; now: Date; trucTuDong: ReadonlySet<string> }) {
  if (!p.trucTuDong.size) return { ke: [] as Awaited<ReturnType<typeof docTrucDeGhi>>, boQua: [] as BoQuaGhiCung[] };
  const tat = await docTrucDeGhi({ centerId: p.centerId, tu: `${p.periodKey}-01`, den: cuoiThang(p.periodKey), now: p.now });
  const boQua: BoQuaGhiCung[] = [];
  const ke = tat.filter(({ t, dong }) => {
    if (!p.trucTuDong.has(t.id)) return false;
    const lop = dong.danhGia.lop;
    const loi = lop === "TU_DONG" || lop === "XEM_TAY" ? lyDoKhongGhiTruc(dong) : `${lop}: ${dong.danhGia.lyDo.join(", ") || "—"}`;
    if (loi) boQua.push({ loai: "TRUC", id: t.id, userId: t.userId, ngay: ymd(t.workDate), lyDo: loi });
    return !loi;
  });
  return { ke, boQua };
}

/** Bước 2 — GHI trực, TRONG giao dịch khoá kỳ. Trả số đơn vị mới. */
export async function ghiTrucTrongTx(
  tx: Prisma.TransactionClient,
  p: { ke: Awaited<ReturnType<typeof docTrucDeGhi>>; periodKey: string; now: Date; actor: NguoiThaoTac & { id: string } },
): Promise<number> {
  let n = 0;
  for (const { t, dong } of p.ke) {
    const r = await ghiQuyetDinhTrucTrongTx(tx, { t, dong, quyetDinh: "CONFIRMED", lyDo: `Ghi cứng lúc chốt kỳ ${p.periodKey}`, hangLoat: true, actor: p.actor, now: p.now });
    if (r.workUnitId && !r.daCo) n++;
  }
  return n;
}
