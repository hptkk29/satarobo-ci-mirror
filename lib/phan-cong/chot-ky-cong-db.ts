// lib/phan-cong/chot-ky-cong-db.ts — GHI CỨNG công Parttime lúc CHỐT KỲ (GĐ6, chốt 10: "công tính khi đọc; lúc chốt kỳ mới ghi cứng
// WorkUnit, người ghi = người bấm chốt; không tài khoản hệ thống"). Chỉ kỳ LUẬT MỚI (cờ `shift.parttimeLuatCongMoiTuKy`).
//
// ⚠️ ĐẢO 09/11/2026 (chủ dự án: "Sửa chốt kỳ ghi theo phân công"). Bản GĐ6 chỉ ghi ô ĐỦ LƯỢT QUÉT (`docCongOThang` TU_DONG); ô thiếu quét
// bị bỏ. Nay: ghi MỌI tiết / ca trực ĐÃ PHÂN CÔNG còn sống của GV parttime (`chamTheoPhanCong`) — ĐÚNG số engine "Lương dự kiến"
// (`docLuoiTuan` → `keHoachGhiTheoPhanCong`): số tiết, trực quy đổi, đơn giá + Rank tại ngày. Lượt quét chỉ là bằng chứng (vẫn chụp vào
// WorkConfirmation qua `snapshotThucHien` / dấu vân), KHÔNG là điều kiện. Mục engine "chưa tính được" / Trial / vượt ca ⇒ `boQua` kèm lý do.
//
// GIỮ NGUYÊN dữ liệu đã ghi: phân công đã có WorkUnit CONFIRMED cùng PHIÊN BẢN phân công (vd. xác nhận tay 01–14/11 trên prod — đo
// 09/11/2026: 5 đơn vị) ⇒ KHÔNG ghi lại, KHÔNG void (bằng chứng đổi không còn là lý do xác nhận lại). Chốt lại sau khi mở: idempotent.
// Thứ tự: DẠY trước (giao dịch riêng, idempotent), TRỰC ghi TRONG giao dịch khoá kỳ (`lockPeriod`).
import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { docDoiSoatThucHien, ghiQuyetDinhThucHienTrongTx, snapshotThucHien } from "@/lib/parttime/workunit-db";
import { anhChupDonVi, anhChupHoTroTrial } from "@/lib/parttime/workunit";
import { docTrucDeGhi, ghiQuyetDinhTrucTrongTx } from "@/lib/parttime/truc-van-hanh-db";
import type { NguoiThaoTac } from "@/lib/parttime/phan-cong-db";
import { docChinhSach } from "@/lib/parttime/phan-cong-db";
import { chinhSachTaiNgay } from "@/lib/parttime/chinh-sach";
import { docLuoiTuan } from "@/lib/parttime/luoi-tuan-db";
import { chamTheoPhanCong } from "@/lib/parttime/cham-theo-phan-cong";
import { docLoaiHopDong } from "@/lib/parttime/viec-ngay-db";
import { luatKy } from "./cong-o";
import { docKyLuatMoi } from "./ky-luat-db";
import { keHoachGhiTheoPhanCong, type MucBoQua, type MucGhiTruc } from "./ghi-theo-phan-cong";

export type BoQuaGhiCung = { loai: "DAY" | "TRUC" | "TRIAL"; id: string; userId: string; ngay: string; lyDo: string };
/** `soOChuaTinh` = số mục engine CHƯA TÍNH ĐƯỢC (buổi lệch chuẩn chưa ghi đè số tiết, ca trực chờ quyết) — QLCS xử lý rồi chốt lại. */
export type KetQuaGhiCung = { soDonViDay: number; soDonViTruc: number; soOChuaTinh: number; boQua: BoQuaGhiCung[] };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const cuoiThang = (periodKey: string) => {
  const [y, m] = periodKey.split("-").map(Number) as [number, number];
  return ymd(new Date(Date.UTC(y, m, 0)));
};

/** Kỳ này có đi luật mới không (đọc cờ). `lockPeriod` hỏi trước để kỳ cũ không tốn câu tra nào thêm. */
export async function kyGhiCung(periodKey: string): Promise<boolean> {
  return luatKy(periodKey, await docKyLuatMoi()) !== "CU";
}

const sangBoQua = (b: MucBoQua): BoQuaGhiCung => ({
  loai: b.loai === "TRUC_CHUA_TINH" ? "TRUC" : "DAY",
  id: b.id,
  userId: b.userId,
  ngay: b.ngay,
  lyDo: b.lyDo,
});

/** Kế hoạch ghi của MỘT cơ sở × kỳ theo phân công (đọc). Dùng cho ghi cứng và cho test đẳng thức tiền. */
export async function docKeHoachGhiKy(p: { centerId: string; periodKey: string; now: Date }) {
  const tu = `${p.periodKey}-01`;
  const den = cuoiThang(p.periodKey);
  const [luoi, tuKy] = await Promise.all([docLuoiTuan({ centerId: p.centerId, tu, den, now: p.now }), docKyLuatMoi()]);
  const loaiHd = await docLoaiHopDong(luoi.dong.map((d) => d.userId));
  const ke = keHoachGhiTheoPhanCong(luoi.dong, (userId, ngay) => chamTheoPhanCong({ contractType: loaiHd.get(userId) ?? null, ngay, tuKy }));
  return { tu, den, ke, ten: Object.fromEntries(luoi.dong.map((d) => [d.userId, d.ten])) as Record<string, string> };
}

/**
 * Bước 1 — lập kế hoạch theo phân công, GHI đơn vị DẠY trong một giao dịch riêng (idempotent). Trả kế hoạch TRỰC để bước 2 ghi trong
 * giao dịch khoá kỳ, cùng danh sách bỏ qua. Gọi SAU `recomputeRange`.
 */
export async function ghiCungDay(p: { centerId: string; periodKey: string; now: Date; actor: NguoiThaoTac & { id: string } }): Promise<{
  soDonViDay: number;
  soOChuaTinh: number;
  keTruc: MucGhiTruc[];
  boQua: BoQuaGhiCung[];
}> {
  const { tu, den, ke } = await docKeHoachGhiKy(p);
  const boQua = ke.boQua.map(sangBoQua);
  const soOChuaTinh = ke.boQua.filter((b) => b.loai === "TIET_CHUA_TINH" || b.loai === "TRUC_CHUA_TINH").length;
  if (!ke.day.length && !ke.trial.length) return { soDonViDay: 0, soOChuaTinh, keTruc: ke.truc, boQua };

  const ids = [...ke.day.map((m) => m.assignmentId), ...ke.trial.map((m) => m.assignmentId)];
  const [ds, pcs, daCo, chinhSach] = await Promise.all([
    docDoiSoatThucHien({ centerId: p.centerId, tu, den, now: p.now }),
    db.sessionStaffAssignment.findMany({ where: { id: { in: ids } }, select: { id: true, centerId: true, orgUnitId: true, ngay: true, userId: true, assignmentVersion: true } }),
    db.workUnit.findMany({ where: { assignmentId: { in: ids }, status: "CONFIRMED" }, select: { assignmentId: true, assignmentVersion: true } }),
    docChinhSach(),
  ]);
  const ghi: Parameters<typeof ghiQuyetDinhThucHienTrongTx>[1][] = [];
  for (const m of ke.day) {
    const pc = pcs.find((x) => x.id === m.assignmentId);
    // Đã có đơn vị CONFIRMED cùng phiên bản phân công ⇒ giữ nguyên (không ghi lại, không void) — xem đầu tệp.
    if (pc && daCo.some((w) => w.assignmentId === m.assignmentId && w.assignmentVersion === pc.assignmentVersion)) continue;
    const dong = ds.dong.find((d) => d.bc.assignmentId === m.assignmentId);
    const cs = chinhSachTaiNgay(chinhSach, m.ngay);
    if (!pc || !dong || !dong.policyVersionId || !cs || cs.thamSo.loai !== "SR_QD_238") {
      boQua.push({ loai: "DAY", id: m.assignmentId, userId: m.userId, ngay: m.ngay, lyDo: "Phân công không có trong đối soát / ngoài SR.QD.238 — không ghi." });
      continue;
    }
    // CÙNG công thức đơn vị của luồng P5 (`anhChupDonVi`); số tiết + Rank là số engine. Lệch đơn giá với engine ⇒ không ghi (không đoán).
    const anh = anhChupDonVi(m.loai, cs.thamSo, m.rank, String(m.soTiet));
    if (anh.rateSnapshot !== m.donGia) {
      boQua.push({ loai: "DAY", id: m.assignmentId, userId: m.userId, ngay: m.ngay, lyDo: `Đơn giá lệch Lương dự kiến (${anh.rateSnapshot} ≠ ${m.donGia}) — không ghi.` });
      continue;
    }
    ghi.push({
      assignmentId: m.assignmentId,
      pc,
      dong,
      anh,
      snapshot: { ...snapshotThucHien(dong), chotKy: true, theoPhanCong: true },
      quyetDinh: "CONFIRMED",
      lyDo: `Ghi cứng lúc chốt kỳ ${p.periodKey} theo phân công`,
      hangLoat: true,
      actor: p.actor,
      now: p.now,
    });
  }
  // Hỗ trợ Trial: CÙNG phép ghi (WorkConfirmation + WorkUnit + audit) với đơn vị dạy, loại TRIAL_SUPPORT, số = `xetHoTroTrial` của engine.
  for (const m of ke.trial) {
    const pc = pcs.find((x) => x.id === m.assignmentId);
    if (pc && daCo.some((w) => w.assignmentId === m.assignmentId && w.assignmentVersion === pc.assignmentVersion)) continue;
    const dong = ds.dong.find((d) => d.bc.assignmentId === m.assignmentId);
    if (!pc || !dong || !dong.policyVersionId) {
      boQua.push({ loai: "TRIAL", id: m.assignmentId, userId: m.userId, ngay: m.ngay, lyDo: "Phân công Trial không có trong đối soát / ngoài SR.QD.238 — không ghi." });
      continue;
    }
    ghi.push({
      assignmentId: m.assignmentId,
      pc,
      dong,
      anh: anhChupHoTroTrial(m.soCoMat, m.donGia),
      snapshot: { ...snapshotThucHien(dong), chotKy: true, theoPhanCong: true, hoTroTrial: { soCoMat: m.soCoMat, mucMoiHocVien: m.donGia } },
      quyetDinh: "CONFIRMED",
      lyDo: `Ghi cứng lúc chốt kỳ ${p.periodKey} theo phân công (hỗ trợ Trial)`,
      hangLoat: true,
      actor: p.actor,
      now: p.now,
    });
  }
  let soDonViDay = 0;
  if (ghi.length) {
    await db.$transaction(
      async (tx) => {
        for (const k of ghi) {
          const r = await ghiQuyetDinhThucHienTrongTx(tx, k);
          if (r.workUnitId && !r.daCo) soDonViDay++;
        }
      },
      { timeout: 60_000 },
    );
  }
  return { soDonViDay, soOChuaTinh, keTruc: ke.truc, boQua };
}

/** Bước 2 — kế hoạch TRỰC (đọc): ghép mục trực của kế hoạch với dòng trực gốc + bằng chứng (dấu vân, chính sách). */
export async function keHoachTruc(p: { centerId: string; periodKey: string; now: Date; keTruc: readonly MucGhiTruc[] }) {
  const boQua: BoQuaGhiCung[] = [];
  if (!p.keTruc.length) return { ke: [] as { t: Awaited<ReturnType<typeof docTrucDeGhi>>[number]["t"]; dong: Awaited<ReturnType<typeof docTrucDeGhi>>[number]["dong"]; muc: MucGhiTruc }[], boQua };
  const [tat, daCo] = await Promise.all([
    docTrucDeGhi({ centerId: p.centerId, tu: `${p.periodKey}-01`, den: cuoiThang(p.periodKey), now: p.now }),
    db.workUnit.findMany({ where: { assignmentId: { in: p.keTruc.map((m) => m.dutyId) }, status: "CONFIRMED" }, select: { assignmentId: true, assignmentVersion: true } }),
  ]);
  const ke = [];
  for (const m of p.keTruc) {
    const x = tat.find((r) => r.t.id === m.dutyId);
    if (x && daCo.some((w) => w.assignmentId === m.dutyId && w.assignmentVersion === x.t.assignmentVersion)) continue;
    if (!x || !x.dong.policyVersionId) {
      boQua.push({ loai: "TRUC", id: m.dutyId, userId: m.userId, ngay: m.ngay, lyDo: "Dòng trực không đọc được / ngoài SR.QD.238 — không ghi." });
      continue;
    }
    ke.push({ ...x, muc: m });
  }
  return { ke, boQua };
}

/** Bước 2 — GHI trực, TRONG giao dịch khoá kỳ. Trả số đơn vị mới. */
export async function ghiTrucTrongTx(
  tx: Prisma.TransactionClient,
  p: { ke: Awaited<ReturnType<typeof keHoachTruc>>["ke"]; periodKey: string; now: Date; actor: NguoiThaoTac & { id: string } },
): Promise<number> {
  let n = 0;
  for (const { t, dong, muc } of p.ke) {
    const r = await ghiQuyetDinhTrucTrongTx(tx, {
      t,
      dong,
      quyetDinh: "CONFIRMED",
      lyDo: `Ghi cứng lúc chốt kỳ ${p.periodKey} theo phân công`,
      hangLoat: true,
      actor: p.actor,
      now: p.now,
      donViTheoPhanCong: { soCa: muc.soCa, donGia: muc.donGia },
    });
    if (r.workUnitId && !r.daCo) n++;
  }
  return n;
}
