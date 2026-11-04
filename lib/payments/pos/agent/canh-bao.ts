import "server-only";
// lib/payments/pos/agent/canh-bao.ts — CHUÔNG của máy đồng bộ (GĐ4 POS — T16, T23). Thiết kế: §6.5, §8.
//
// Người nhận = `nguoiNhanBaoPos` (Kế toán HO ∪ Quản trị tối cao — cùng tập mọi chuông POS, T17 GĐ1). Bốn
// loại khoá theo (cơ sở + ngày VN) — `khoaChuongAgent`. MỘT chỗ dựng câu (`canh-bao-luat.ts`): `/status`,
// cron và lượt SALE bị D9 dựng CÙNG thân từ CÙNG mốc đã lưu ⇒ không dội hai chuông, không đổi thân vô cớ.
//
// ⚠️ `reopen` CHỈ khi có sự việc MỚI (lượt đổi trạng thái thắng / sự kiện lỗi mới trong ngày): `notifyStaff`
// kéo bản ĐÃ ĐỌC về chưa đọc mỗi lần gọi với `reopen: true` dù thân y nguyên — gọi lặp là rung mỗi phút.
import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { nguoiNhanBaoPos } from "../nguoi-nhan-bao-pos";
import {
  HREF_SUC_KHOE,
  khoaChuongAgent,
  noiDungHetPhien,
  noiDungLoi,
  noiDungMatKetNoi,
  noiDungSapHetPhien,
  nhanCoSo,
  type LoaiChuongAgent,
  type LyDoMatKetNoi,
  type NoiDungChuong,
} from "./canh-bao-luat";

async function gui(x: { loai: LoaiChuongAgent; centerId: string; nd: NoiDungChuong; now: Date; reopen: boolean }): Promise<number> {
  const nguoi = await nguoiNhanBaoPos(x.now);
  if (nguoi.length === 0) {
    console.warn(`[pos-agent] chuông ${x.loai} cơ sở ${x.centerId}: không có Kế toán HO / Quản trị nào để báo`);
    return 0;
  }
  return notifyStaff({
    userIds: nguoi,
    dedupeKey: khoaChuongAgent(x.loai, x.centerId, x.now),
    title: x.nd.title,
    body: x.nd.body,
    href: HREF_SUC_KHOE,
    ...(x.reopen ? { reopen: true } : {}),
  });
}

export function baoHetPhien(x: { centerId: string; coSo: string; luc: Date; now: Date; reopen: boolean }): Promise<number> {
  return gui({ loai: "het-phien", centerId: x.centerId, nd: noiDungHetPhien(x.coSo, x.luc, x.now), now: x.now, reopen: x.reopen });
}

export function baoMatKetNoi(x: {
  centerId: string;
  coSo: string;
  lyDo: LyDoMatKetNoi;
  tuLuc: Date | null;
  now: Date;
  reopen: boolean;
}): Promise<number> {
  return gui({
    loai: "mat-ket-noi",
    centerId: x.centerId,
    nd: noiDungMatKetNoi(x.coSo, x.lyDo, x.tuLuc, x.now),
    now: x.now,
    reopen: x.reopen,
  });
}

export function baoSapHetPhien(x: { centerId: string; coSo: string; hetLuc: Date; now: Date }): Promise<number> {
  return gui({ loai: "sap-het-phien", centerId: x.centerId, nd: noiDungSapHetPhien(x.coSo, x.hetLuc, x.now), now: x.now, reopen: false });
}

export function baoLoiAgent(x: { centerId: string; coSo: string; ma: string; now: Date }): Promise<number> {
  return gui({ loai: "loi", centerId: x.centerId, nd: noiDungLoi(x.coSo, x.ma, x.now, x.now), now: x.now, reopen: true });
}

/** Mã lý do D9 do provider trả (`AGENT_<sức khoẻ>`). */
export type LyDoKhongSanSang = "AGENT_HET_PHIEN" | "AGENT_MAT_KET_NOI" | "AGENT_CHUA_KET_NOI" | "AGENT_CHUA_SAN_SANG";

export function laLyDoAgent(ma: string | null | undefined): ma is LyDoKhongSanSang {
  return ma === "AGENT_HET_PHIEN" || ma === "AGENT_MAT_KET_NOI" || ma === "AGENT_CHUA_KET_NOI" || ma === "AGENT_CHUA_SAN_SANG";
}

/**
 * Lượt SALE bị D9 ("Tạm mất kết nối Techcombank CSx, đã báo admin…") ⇒ BẢO ĐẢM đã báo: câu D9 nói "đã báo
 * admin" thì phải đúng là đã báo (luật 12) — kể cả agent CHƯA kết nối lần nào (cron không báo ca đó) và kể
 * cả ngoài khung giờ của cron. CÙNG khoá với `/status` + cron, thân dựng từ CÙNG mốc đã lưu ⇒ lượt bấm lặp
 * không dội chuông (không `reopen`). KHÔNG bắn chuông `pos.loi-ket-noi:` (T16).
 */
export async function baoAgentKhongSanSang(x: { centerId: string; lyDo: LyDoKhongSanSang; now: Date }): Promise<number> {
  const ds = await db.posAgent.findMany({
    where: { centerId: x.centerId, active: true },
    select: { sessionState: true, sessionDoiLuc: true, lastHeartbeatAt: true, center: { select: { code: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (ds.length === 0) return 0;
  if (x.lyDo === "AGENT_HET_PHIEN") {
    const a = ds.find((d) => d.sessionState === "EXPIRED") ?? ds[0]!;
    return baoHetPhien({ centerId: x.centerId, coSo: nhanCoSo(a.center), luc: a.sessionDoiLuc ?? x.now, now: x.now, reopen: false });
  }
  // Agent liên lạc CŨ nhất (chưa từng ⇒ trước) — đúng cái làm phiếu bị gác.
  const a = [...ds].sort((p, q) => (p.lastHeartbeatAt?.getTime() ?? -1) - (q.lastHeartbeatAt?.getTime() ?? -1))[0]!;
  const lyDo: LyDoMatKetNoi =
    x.lyDo === "AGENT_CHUA_KET_NOI" ? "CHUA_KET_NOI" : x.lyDo === "AGENT_CHUA_SAN_SANG" ? "CHUA_SAN_SANG" : "MAT_KET_NOI";
  return baoMatKetNoi({ centerId: x.centerId, coSo: nhanCoSo(a.center), lyDo, tuLuc: a.lastHeartbeatAt, now: x.now, reopen: false });
}
