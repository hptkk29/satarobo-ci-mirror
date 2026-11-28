import "server-only";
// lib/payments/pos/agent/su-kien.ts — NHẬT KÝ máy đồng bộ (`PosAgentEvent`, GĐ4 POS — T19). Ghi bằng `db` trần
// (đường HỆ THỐNG, không actor — như `nhapLoPos`); `centerId` đặt TƯỜNG MINH (scopedDb không che write).
//
// T19: heartbeat KHÔNG ghi một dòng mỗi lượt (tránh 1.440 dòng/ngày) — chỉ LAN_DAU · KET_NOI_LAI ·
// DOI_PHIEN_BAN; SYNC chỉ khi lô có thay đổi; ERROR GỘP theo (agent, mã, ngày VN) bằng `khoaGop @unique`.
// `detail` KHÔNG PII: chỉ số đếm, mã, mốc giờ.
import type { PosAgentEventType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ngayVN } from "@/lib/format/thoi-gian-vn";

export type AgentChoSuKien = { id: string; centerId: string; orgUnitId: string | null };

/** `orgUnitId` của agent trống ⇒ BỎ khoá để ghi kép tự điền theo `centerId` (khuôn `dongNhatKy` GĐ2). */
function cotDonVi(a: AgentChoSuKien): { centerId: string; orgUnitId?: string } {
  return a.orgUnitId ? { centerId: a.centerId, orgUnitId: a.orgUnitId } : { centerId: a.centerId };
}

export async function ghiSuKien(x: {
  agent: AgentChoSuKien;
  type: PosAgentEventType;
  ma: string | null;
  detail: Prisma.InputJsonObject;
  now: Date;
}): Promise<void> {
  await db.posAgentEvent.create({
    data: { agentId: x.agent.id, ...cotDonVi(x.agent), type: x.type, ma: x.ma, detail: x.detail, createdAt: x.now },
  });
}

/** Khoá gộp ERROR: một dòng / (agent, mã, ngày VN). */
export function khoaGopLoi(agentId: string, ma: string, now: Date): string {
  return `ERROR:${ma}:${agentId}:${ngayVN(now)}`;
}

function laTrungKhoa(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "P2002";
}

/**
 * ERROR GỘP: lần đầu trong ngày ⇒ TẠO (trả `moi: true` — người gọi quyết có báo admin không); lần sau ⇒
 * cộng `dem` + mốc cuối. Đếm là chẩn đoán (không phải sổ tiền) ⇒ đọc-rồi-ghi không khoá là chấp nhận được;
 * hai lượt đua tạo ⇒ P2002 ⇒ lượt thua rơi về nhánh cộng.
 */
export async function ghiLoiGop(x: {
  agent: AgentChoSuKien;
  ma: string;
  detail: Prisma.InputJsonObject;
  now: Date;
}): Promise<{ moi: boolean }> {
  const khoaGop = khoaGopLoi(x.agent.id, x.ma, x.now);
  const cong = async (): Promise<{ moi: boolean }> => {
    const cu = await db.posAgentEvent.findUnique({ where: { khoaGop }, select: { id: true, detail: true } });
    if (!cu) return { moi: false };
    const truoc = cu.detail !== null && typeof cu.detail === "object" && !Array.isArray(cu.detail) ? cu.detail : {};
    const dem = typeof truoc.dem === "number" ? truoc.dem : 1;
    await db.posAgentEvent.update({
      where: { id: cu.id },
      data: { detail: { ...x.detail, dem: dem + 1, lanCuoi: x.now.toISOString() } },
    });
    return { moi: false };
  };
  const da = await db.posAgentEvent.findUnique({ where: { khoaGop }, select: { id: true } });
  if (da) return cong();
  try {
    await db.posAgentEvent.create({
      data: {
        agentId: x.agent.id,
        ...cotDonVi(x.agent),
        type: "ERROR",
        ma: x.ma,
        khoaGop,
        detail: { ...x.detail, dem: 1 },
        createdAt: x.now,
      },
    });
    return { moi: true };
  } catch (err) {
    if (!laTrungKhoa(err)) throw err;
    return cong();
  }
}
