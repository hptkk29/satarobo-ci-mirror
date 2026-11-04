import "server-only";
// lib/ai-lead/dich-vu/hoi-thoai.ts — HỘI THOẠI (agent × Page × PSID): upsert lời khai + KHOÁ HÀNG để tuần tự hoá mọi ghi trên cùng một khách.
//
// Hai bước, có chủ đích tách khỏi nhau:
//  1. `capNhatHoiThoai` — NGOÀI giao dịch nghiệp vụ. Dùng Prisma create/update với vòng thử lại P2002 (ngoài giao dịch thì P2002 chỉ là một lỗi thường, bắt được).
//  2. `khoaHoiThoai` — TRONG giao dịch, `SELECT … FOR UPDATE`. Đây là thứ làm "20 yêu cầu song song cùng hội thoại, khác key ⇒ đúng 1 hồ sơ mở" thành thật:
//     mọi ghi (hồ sơ · chuyển người) trên cùng hội thoại xếp hàng ở khoá hàng này; chỉ mục duy nhất từng phần của hồ sơ chỉ còn là lưới sau cùng.
//
// Lời khai của Agent (OD-01) là DỮ LIỆU KHÔNG TIN CẬY — `claimSource` mặc định `AGENT_ASSERTED`; không bao giờ coi `fbName` là "đã xác minh" nếu nguồn là khách tự khai.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { FbNameSource, OwnerState } from "../kieu";

export type LoiKhaiHoiThoai = {
  pageId: string;
  psid: string;
  fbName?: string | null | undefined;
  fbNameSource?: FbNameSource | undefined;
  inboxThreadId?: string | null | undefined;
};

type Tx = Prisma.TransactionClient;

/** Nguồn tên do runtime cung cấp (Meta/webhook) — tin cậy hơn lời khách tự gõ. */
function nguonDaXacMinh(s: FbNameSource | null | undefined): boolean {
  return s === "META_PROFILE_API" || s === "WEBHOOK_PAYLOAD";
}

/**
 * Tên Facebook sẽ GHI vào hội thoại, hoặc `null` = giữ nguyên cái đang có.
 *  · `fbName` vắng/null ⇒ KHÔNG xoá tên đã có (lượt sau không lấy được tên không được làm mất tên lượt trước).
 *  · Tên khách tự khai (CUSTOMER_STATED) KHÔNG đè tên đã có nguồn Meta/webhook — nếu không, một câu "tên em là X" hạ cấp hội thoại từ ACCEPTED xuống HUMAN_QUEUED.
 */
export function tenSeGhi(
  cu: { fbName: string | null; fbNameSource: FbNameSource | null } | null,
  moi: { fbName?: string | null | undefined; fbNameSource?: FbNameSource | undefined },
): { fbName: string; fbNameSource: FbNameSource } | null {
  if (typeof moi.fbName !== "string" || moi.fbName === "" || moi.fbNameSource === undefined) return null;
  if (cu && cu.fbName && nguonDaXacMinh(cu.fbNameSource) && moi.fbNameSource === "CUSTOMER_STATED") return null;
  return { fbName: moi.fbName, fbNameSource: moi.fbNameSource };
}

/**
 * Upsert hội thoại; trả `id`. An toàn khi nhiều yêu cầu cùng tạo một khách lần đầu: tạo bằng `createMany({ skipDuplicates })` (= `ON CONFLICT DO NOTHING`)
 * nên kẻ thua không sinh lỗi P2002 (Prisma còn ghi `prisma:error` ra log cho mỗi P2002 — nhiễu vô ích), rồi đọc lại và cập nhật như hội thoại đã có.
 */
export async function capNhatHoiThoai(agentId: string, c: LoiKhaiHoiThoai, nowMs: number): Promise<{ id: string }> {
  const now = new Date(nowMs);
  const where = { agentId_pageId_psid: { agentId, pageId: c.pageId, psid: c.psid } };
  for (let lan = 0; lan < 3; lan++) {
    const cu = await db.aiLeadConversation.findUnique({ where, select: { id: true, fbName: true, fbNameSource: true } });
    if (cu) {
      const ten = tenSeGhi(cu, c);
      await db.aiLeadConversation.update({
        where: { id: cu.id },
        data: {
          lastEventAt: now,
          ...(ten ?? {}),
          ...(typeof c.inboxThreadId === "string" ? { inboxThreadId: c.inboxThreadId } : {}),
        },
      });
      return { id: cu.id };
    }
    const ten = tenSeGhi(null, c);
    await db.aiLeadConversation.createMany({
      data: [
        {
          agentId,
          pageId: c.pageId,
          psid: c.psid,
          lastEventAt: now,
          ...(ten ?? {}),
          ...(typeof c.inboxThreadId === "string" ? { inboxThreadId: c.inboxThreadId } : {}),
        },
      ],
      skipDuplicates: true,
    });
    // Vòng sau đọc lại: dù ta tạo hay người khác vừa tạo, đều đi nhánh "đã có" (cập nhật tên/thread theo luật `tenSeGhi`).
  }
  throw new Error("capNhatHoiThoai: không tạo/cập nhật được sau 3 lượt");
}

export type HoiThoaiDaKhoa = {
  id: string;
  pageId: string;
  ownerState: OwnerState;
  fbName: string | null;
  fbNameSource: FbNameSource | null;
  holdingSentAt: Date | null;
};

/** Khoá hàng hội thoại (đến hết giao dịch) rồi đọc lại trạng thái SAU khoá. Phải gọi SAU `giuKhoaTrongTx` và TRƯỚC mọi phép ghi nghiệp vụ. */
export async function khoaHoiThoai(tx: Tx, hoiThoaiId: string): Promise<HoiThoaiDaKhoa> {
  await tx.$queryRaw`SELECT "id" FROM "AiLeadConversation" WHERE "id" = ${hoiThoaiId} FOR UPDATE`;
  const h = await tx.aiLeadConversation.findUniqueOrThrow({
    where: { id: hoiThoaiId },
    select: { id: true, pageId: true, ownerState: true, fbName: true, fbNameSource: true, holdingSentAt: true },
  });
  return h;
}
