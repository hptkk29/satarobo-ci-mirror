import "server-only";
// lib/payments/pos/agent/suc-khoe-doc.ts — NẠP dữ liệu màn "Sức khoẻ POS Agent" + "Đối chiếu agent ↔ file" (GĐ4 POS).
// Thiết kế: docs/pos-gd4-thiet-ke.md §9.3.
//
// NHẬN `sdb` (scopedDb của người xem) — không import `@/lib/db`: PosAgent · PosAgentEvent · PosCheckJob ·
// PosTxnSource ∈ SCOPED_MODELS (prefix `payments:`) nên mọi câu tự lọc theo cơ sở người xem được thấy; dòng nguồn
// chưa biết cơ sở (`centerId` NULL) chỉ người cấp Hội sở thấy (T25). Một lô `Promise.all` mỗi khối.
import type { PosAgentEventType, PosAgentSessionState, Prisma } from "@prisma/client";
import type { scopedDb } from "@/lib/db-scope";
import { congNgay, dauNgayTuChuoi } from "@/lib/format/thoi-gian-vn";
import { JOB_SONG_MS, NGUONG_MAT_KET_NOI_MS } from "./hop-dong";
import { nhanCoSo } from "./canh-bao-luat";
import { chuanMa } from "./may";
import { thoiGianSongPhien } from "./suc-khoe";
import { doiChieuNguon, type DongDoiChieu, type NhomDoiChieu } from "./doi-chieu";

type Sdb = ReturnType<typeof scopedDb>;

const NGAY_MS = 24 * 60 * 60_000;
const TRAN_SU_KIEN = 20;
const TRAN_DONG_DOI_CHIEU = 5_000;

export type KetNoiAgent = "TRUC_TUYEN" | "MAT_KET_NOI" | "CHUA_KET_NOI";

export type TheAgent = {
  id: string;
  centerId: string;
  coSo: string;
  tenCoSo: string;
  merchantCode: string;
  active: boolean;
  ketNoi: KetNoiAgent;
  lastHeartbeatAt: Date | null;
  matKetNoiTuLuc: Date | null;
  sessionState: PosAgentSessionState;
  sessionDoiLuc: Date | null;
  sessionExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  /** Chốt hợp đồng 1.1 — `windowTo` của lô final (mốc dữ liệu đã đọc tới), tách khỏi `lastSyncedAt` (giờ nhận). */
  duLieuDenLuc: Date | null;
  extensionVersion: string | null;
  profileName: string | null;
  loiGanNhat: string | null;
  loiGanNhatLuc: Date | null;
  secretVersion: number;
  secretDoiLuc: Date | null;
  /** Job PENDING còn trẻ (≤ 2′). */
  jobCho: number;
  /** 30 ngày — cặp SESSION_READY → SESSION_EXPIRED. */
  songPhien: { soPhien: number; tbMs: number | null };
  /** Cơ sở có máy POS đang bật khai ĐỦ merchant + quầy của agent này (không ⇒ giao dịch vào "Thiết bị chưa gán"). */
  mayKhaiDu: boolean;
};

export type SuKienNgan = {
  id: string;
  agentId: string;
  coSo: string;
  type: PosAgentEventType;
  ma: string | null;
  detail: Prisma.JsonValue;
  createdAt: Date;
};

/** Sức khoẻ: kết nối theo mốc `lastHeartbeatAt` (mọi request đã ký — T4); > 3′ ⇒ mất kết nối (cùng ngưỡng D9). */
export function ketNoiCua(lastHeartbeatAt: Date | null, now: Date): KetNoiAgent {
  if (lastHeartbeatAt === null) return "CHUA_KET_NOI";
  return now.getTime() - lastHeartbeatAt.getTime() > NGUONG_MAT_KET_NOI_MS ? "MAT_KET_NOI" : "TRUC_TUYEN";
}

export async function docSucKhoeAgent(sdb: Sdb, now: Date): Promise<{ agents: TheAgent[]; suKien: SuKienNgan[] }> {
  const [agents, jobs, phienEv, suKien, mays] = await Promise.all([
    sdb.posAgent.findMany({
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        centerId: true,
        merchantCode: true,
        active: true,
        lastHeartbeatAt: true,
        matKetNoiTuLuc: true,
        sessionState: true,
        sessionDoiLuc: true,
        sessionExpiresAt: true,
        lastSyncedAt: true,
        duLieuDenLuc: true,
        extensionVersion: true,
        profileName: true,
        loiGanNhat: true,
        loiGanNhatLuc: true,
        secretVersion: true,
        secretDoiLuc: true,
        center: { select: { code: true, name: true } },
      },
    }),
    sdb.posCheckJob.groupBy({
      by: ["agentId"],
      where: { status: "PENDING", createdAt: { gte: new Date(now.getTime() - JOB_SONG_MS) } },
      _count: { _all: true },
    }),
    sdb.posAgentEvent.findMany({
      where: { type: { in: ["SESSION_READY", "SESSION_EXPIRED"] }, createdAt: { gte: new Date(now.getTime() - 30 * NGAY_MS) } },
      select: { agentId: true, type: true, createdAt: true },
    }),
    sdb.posAgentEvent.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TRAN_SU_KIEN,
      select: { id: true, agentId: true, type: true, ma: true, detail: true, createdAt: true },
    }),
    sdb.posTerminal.findMany({ where: { active: true }, select: { centerId: true, maNhaCungCap: true, maQuay: true } }),
  ]);
  const jobTheoAgent = new Map(jobs.map((j) => [j.agentId, j._count._all]));
  const coSoTheoAgent = new Map(agents.map((a) => [a.id, nhanCoSo(a.center)]));
  return {
    agents: agents.map((a) => ({
      id: a.id,
      centerId: a.centerId,
      coSo: nhanCoSo(a.center),
      tenCoSo: a.center.name,
      merchantCode: a.merchantCode,
      active: a.active,
      ketNoi: ketNoiCua(a.lastHeartbeatAt, now),
      lastHeartbeatAt: a.lastHeartbeatAt,
      matKetNoiTuLuc: a.matKetNoiTuLuc,
      sessionState: a.sessionState,
      sessionDoiLuc: a.sessionDoiLuc,
      sessionExpiresAt: a.sessionExpiresAt,
      lastSyncedAt: a.lastSyncedAt,
      duLieuDenLuc: a.duLieuDenLuc,
      extensionVersion: a.extensionVersion,
      profileName: a.profileName,
      loiGanNhat: a.loiGanNhat,
      loiGanNhatLuc: a.loiGanNhatLuc,
      secretVersion: a.secretVersion,
      secretDoiLuc: a.secretDoiLuc,
      jobCho: jobTheoAgent.get(a.id) ?? 0,
      songPhien: thoiGianSongPhien(phienEv.filter((e) => e.agentId === a.id)),
      mayKhaiDu: mays.some(
        (m) => m.centerId === a.centerId && chuanMa(m.maNhaCungCap) === chuanMa(a.merchantCode) && chuanMa(m.maQuay) !== "",
      ),
    })),
    suKien: suKien.map((e) => ({ ...e, coSo: coSoTheoAgent.get(e.agentId) ?? "?" })),
  };
}

export type DuLieuDoiChieu = {
  ngay: string;
  tong: Record<NhomDoiChieu, number>;
  dong: DongDoiChieu[];
  /** Lô file nhập xong gần nhất — để biết "chỉ agent thấy" là CHƯA NHẬP hay lệch thật. */
  fileNhapCuoiLuc: Date | null;
  chamTran: boolean;
};

/** Đối chiếu ngày VN `ngay` (YYYY-MM-DD): giờ giao dịch trong ngày; dòng bị từ chối vì giờ hỏng theo lúc thấy. */
export async function docDoiChieuNguon(sdb: Sdb, ngay: string): Promise<DuLieuDoiChieu> {
  const tu = dauNgayTuChuoi(ngay);
  const den = dauNgayTuChuoi(congNgay(ngay, 1));
  const [rows, lo] = await Promise.all([
    sdb.posTxnSource.findMany({
      where: {
        OR: [
          { thoiGianGiaoDich: { gte: tu, lt: den } },
          { thoiGianGiaoDich: null, lanDauThay: { gte: tu, lt: den } },
        ],
      },
      orderBy: [{ thoiGianGiaoDich: "desc" }],
      take: TRAN_DONG_DOI_CHIEU,
      select: {
        maGiaoDich: true,
        nguon: true,
        tuChoi: true,
        soTien: true,
        trangThai: true,
        loaiGiaoDich: true,
        thoiGianGiaoDich: true,
        bamDienGiai: true,
        lanDauThay: true,
      },
    }),
    sdb.posImportBatch.findFirst({ where: { soLoXong: { gt: 0 } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);
  const { tong, dong } = doiChieuNguon(rows);
  return { ngay, tong, dong, fileNhapCuoiLuc: lo?.updatedAt ?? null, chamTran: rows.length >= TRAN_DONG_DOI_CHIEU };
}
