import "server-only";
// lib/payments/pos/agent/giam-sat.ts — CRON GIÁM SÁT máy đồng bộ (GĐ4 POS). Thiết kế: docs/pos-gd4-thiet-ke.md §8.3.
//
// Route `/api/cron/pos-agent-giam-sat` mỗi phút. Một lượt:
//   (a) agent đang bật, ĐÃ từng kết nối, im > 5′ ⇒ đánh dấu `matKetNoiTuLuc` (= lần liên lạc cuối — `updateMany` CÓ
//       ĐIỀU KIỆN, chỉ lượt thắng) + sự kiện ERROR/MAT_KET_NOI (gộp ngày). Trong giờ hoạt động (08:00–21:00, thứ
//       Ba–CN, VN) ⇒ chuông `pos.agent-mat-ket-noi:` (lượt mất MỚI ⇒ `reopen`); ngoài giờ chỉ sự kiện. Vẫn mất
//       khi vào giờ (vd từ đêm tới 08:00) ⇒ chuông của NGÀY MỚI (một lần — chưa có chuông khoá hôm nay mới gửi);
//   (b) job PENDING > 2′ ⇒ EXPIRED; agent CÒN SỐNG mà để job hết hạn ⇒ ERROR/JOB_KHONG_TRA_LOI + chuông (trong giờ);
//   (c) dọn nonce > 15′.
// KHÔNG ghi tiền, KHÔNG ghi quyền (luật cứng #8), KHÔNG đọc đồng hồ thật (luật 19 — `dongHo` tiêm).
import { db } from "@/lib/db";
import { gioVN } from "@/lib/format/thoi-gian-vn";
import { NGUONG_BAO_MAT_KET_NOI_MS, NGUONG_MAT_KET_NOI_MS, NONCE_GIU_MS } from "./hop-dong";
import { khoaChuongAgent, nhanCoSo, trongGioHoatDong } from "./canh-bao-luat";
import { baoMatKetNoi } from "./canh-bao";
import { hetHanJobCu } from "./job";
import { ghiLoiGop } from "./su-kien";

/** Job hết hạn cũ hơn chừng này (tính từ lúc tạo) không còn là tín hiệu "agent không trả lời" mới. */
const JOB_BAO_TRONG_MS = 12 * 60_000;

/**
 * Dọn nonce cũ hơn 15 phút (T21). Biên: đúng 15′ GIỮ (`lt`) — một request hợp lệ phát lại được tới
 * `ts + 5′`, nonce ghi ở `S ∈ [ts − 5′, ts + 5′]` ⇒ cần giữ tới `S + 10′`; 15′ là biên an toàn.
 */
export async function donNonceCu(now: Date): Promise<number> {
  const r = await db.posAgentNonce.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - NONCE_GIU_MS) } } });
  return r.count;
}

/** Lô xếp chờ (RV-04) của một lượt BỎ DỞ (không bao giờ có lô final) sống tối đa chừng này rồi bị dọn. */
const LO_CHO_GIU_MS = 60 * 60_000;

/**
 * Dọn lô `final:false` xếp chờ cũ hơn 1 giờ (rà đối kháng RV-04): lượt đồng bộ hỏng giữa chừng không gửi lô final;
 * lượt SAU của agent gửi lại cả cửa sổ (lastSyncedAt không đẩy) với `syncId` MỚI, nên lô chờ của lượt cũ vô chủ.
 * Biên `lt`: đúng 1 giờ GIỮ.
 */
export async function donLoChoCu(now: Date): Promise<number> {
  const r = await db.posAgentLoCho.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - LO_CHO_GIU_MS) } } });
  return r.count;
}

async function daCoChuong(dedupeKey: string): Promise<boolean> {
  return (await db.staffNotification.findFirst({ where: { dedupeKey }, select: { id: true } })) !== null;
}

export type KetQuaGiamSat = {
  /** Agent vừa bị đánh dấu mất kết nối ở lượt này. */
  matKetNoi: number;
  /** Lượt gửi chuông mất kết nối (mới hoặc chuông ngày mới). */
  baoMatKetNoi: number;
  jobHetHan: number;
  jobKhongTraLoi: number;
  nonceXoa: number;
  /** Lô xếp chờ của lượt bỏ dở đã dọn (RV-04). */
  loChoXoa: number;
};

export async function chayGiamSatAgent(x: { dongHo: () => Date }): Promise<KetQuaGiamSat> {
  const now = x.dongHo();
  const kq: KetQuaGiamSat = { matKetNoi: 0, baoMatKetNoi: 0, jobHetHan: 0, jobKhongTraLoi: 0, nonceXoa: 0, loChoXoa: 0 };
  const trongGio = trongGioHoatDong(now);

  // (a) mất kết nối.
  const agents = await db.posAgent.findMany({
    where: { active: true },
    select: {
      id: true,
      centerId: true,
      orgUnitId: true,
      lastHeartbeatAt: true,
      matKetNoiTuLuc: true,
      center: { select: { code: true, name: true } },
    },
  });
  for (const a of agents) {
    // Chưa từng kết nối ⇒ cron KHÔNG báo (agent mới tạo chưa cài) — lượt SALE bị D9 tự báo ca đó.
    if (a.lastHeartbeatAt === null) continue;
    if (now.getTime() - a.lastHeartbeatAt.getTime() <= NGUONG_BAO_MAT_KET_NOI_MS) continue;
    let moi = false;
    let tuLuc = a.matKetNoiTuLuc;
    if (tuLuc === null) {
      const u = await db.posAgent.updateMany({
        where: { id: a.id, matKetNoiTuLuc: null, lastHeartbeatAt: a.lastHeartbeatAt },
        data: { matKetNoiTuLuc: a.lastHeartbeatAt },
      });
      if (u.count !== 1) continue; // request mới vừa tới / lượt cron khác vừa đánh dấu
      moi = true;
      tuLuc = a.lastHeartbeatAt;
      kq.matKetNoi += 1;
      await ghiLoiGop({ agent: a, ma: "MAT_KET_NOI", detail: { tuLuc: gioVN(tuLuc) }, now });
    }
    if (!trongGio) continue;
    if (moi || !(await daCoChuong(khoaChuongAgent("mat-ket-noi", a.centerId, now)))) {
      await baoMatKetNoi({ centerId: a.centerId, coSo: nhanCoSo(a.center), lyDo: "MAT_KET_NOI", tuLuc, now, reopen: moi });
      kq.baoMatKetNoi += 1;
    }
  }

  // (b) job quá 2′ ⇒ EXPIRED; agent còn sống mà không trả lời ⇒ cảnh báo (gộp theo agent + ngày).
  const hetHan = await hetHanJobCu(now);
  kq.jobHetHan = hetHan.length;
  const agentKhongTraLoi = new Set(
    hetHan.filter((j) => now.getTime() - j.createdAt.getTime() <= JOB_BAO_TRONG_MS).map((j) => j.agentId),
  );
  for (const id of agentKhongTraLoi) {
    const a = agents.find((g) => g.id === id);
    if (!a || a.lastHeartbeatAt === null || now.getTime() - a.lastHeartbeatAt.getTime() > NGUONG_MAT_KET_NOI_MS) continue;
    kq.jobKhongTraLoi += 1;
    const { moi } = await ghiLoiGop({ agent: a, ma: "JOB_KHONG_TRA_LOI", detail: {}, now });
    if (moi && trongGio) {
      await baoMatKetNoi({ centerId: a.centerId, coSo: nhanCoSo(a.center), lyDo: "JOB_KHONG_TRA_LOI", tuLuc: null, now, reopen: true });
    }
  }

  // (c) nonce.
  kq.nonceXoa = await donNonceCu(now);
  // (d) lô xếp chờ của lượt bỏ dở.
  kq.loChoXoa = await donLoChoCu(now);
  return kq;
}
