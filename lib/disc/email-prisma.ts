import "server-only";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email/queue";
import { rateLimit } from "@/lib/rate-limit";
import { gatEmailDaXacMinhChoLead } from "./crm-email";
import { TRAN_THU_XAC_MINH_MOI_BAI_MOI_NGAY, TRAN_THU_XAC_MINH_MOI_DIA_CHI_MOI_NGAY, type EmailStore, type GioiHanEmail, type XepThu } from "./email";

const MOT_NGAY_MS = 24 * 60 * 60_000;

/**
 * Hai trần số thư xác minh (theo địa chỉ đã BĂM · theo bài). `rateLimit` không bao giờ ném (rơi về bộ nhớ khi Upstash chết) nên đây
 * không phải điểm gãy; dù vậy `guiLinkXacMinh` vẫn coi ngoại lệ là "hết hạn mức".
 */
export const gioiHanEmailThat: GioiHanEmail = {
  theoDiaChi: async (khoa) => (await rateLimit({ key: `disc-email:dia-chi:${khoa}`, max: TRAN_THU_XAC_MINH_MOI_DIA_CHI_MOI_NGAY, windowMs: MOT_NGAY_MS })).success,
  theoBai: async (id) => (await rateLimit({ key: `disc-email:bai:${id}`, max: TRAN_THU_XAC_MINH_MOI_BAI_MOI_NGAY, windowMs: MOT_NGAY_MS })).success,
};

/**
 * Nối `email.ts` với DB + hàng đợi thật. Điều kiện của mọi CAS nằm TRONG phép ghi (`updateMany ... count`).
 * `xepThuThat` chỉ TẠO dòng PENDING trong `EmailQueue` — việc gửi là của `processEmailQueue` (cron).
 */
export const emailStore: EmailStore = {
  async layBai(id) {
    return db.discSubmission.findUnique({
      where: { id },
      select: { id: true, emailTo: true, emailStatus: true, emailVerifiedAt: true, emailVerifyExpiresAt: true, claimStatus: true, deletedAt: true },
    });
  },

  async datTokenLanDau(id, tokenHash, hetHan, now) {
    // Chưa có token HOẶC token cũ đã hết hạn (gửi lại). Hạn nằm ở CỘT — nguồn sự thật, kiểm trong chính phép ghi.
    const r = await db.discSubmission.updateMany({
      where: {
        id,
        emailStatus: "VERIFICATION_REQUIRED",
        emailTo: { not: null },
        deletedAt: null,
        OR: [{ emailVerifyTokenHash: null }, { emailVerifyExpiresAt: { lte: now } }],
      },
      data: { emailVerifyTokenHash: tokenHash, emailVerifyExpiresAt: hetHan },
    });
    return r.count === 1;
  },

  async goTokenNeuKhop(id, tokenHash) {
    await db.discSubmission.updateMany({ where: { id, emailVerifyTokenHash: tokenHash }, data: { emailVerifyTokenHash: null, emailVerifyExpiresAt: null } });
  },

  async xacMinhNeuKhop(id, tokenHash, now) {
    const r = await db.discSubmission.updateMany({
      where: {
        id,
        emailStatus: "VERIFICATION_REQUIRED",
        emailVerifyTokenHash: tokenHash,
        emailVerifyExpiresAt: { gt: now }, // hạn theo CỘT, trong chính phép ghi
        deletedAt: null,
        claimStatus: { in: ["PENDING_CLAIM", "CLAIMED"] },
      },
      data: { emailStatus: "QUEUED", emailVerifiedAt: now, emailVerifyTokenHash: null, emailVerifyExpiresAt: null },
    });
    // N4: email chỉ vào lead khi (đã nhận bài ∧ đã xác minh). Nếu bài chưa được nhận, bước này không đủ điều kiện và
    // sẽ được làm lúc nhận (nhan-prisma.sauKhiNhan). Best-effort, không ném.
    if (r.count === 1) await gatEmailDaXacMinhChoLead(id);
    return r.count === 1;
  },

  async doiTrangThai(id, tu, den) {
    const r = await db.discSubmission.updateMany({ where: { id, emailStatus: tu }, data: { emailStatus: den } });
    return r.count === 1;
  },

  async trangThaiHangDoi(ngucCanh, id) {
    const row = await db.emailQueue.findFirst({
      where: { contextType: ngucCanh, contextId: id },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    return row?.status ?? null;
  },
};

export const xepThuThat: XepThu = async (e) => {
  const r = await enqueueEmail({
    to: e.to,
    subject: e.subject,
    bodyText: e.bodyText,
    bodyHtml: e.bodyHtml,
    context: e.context,
  });
  return { ok: r.ok };
};
