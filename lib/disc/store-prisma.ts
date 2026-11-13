import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { DiscStore, MaNhanStore } from "./luu";
import type { NhanStore } from "./nhan";
import type { TaiStore } from "./tai-bao-cao";
import { writeAudit } from "@/lib/audit/audit-log";
import { NGU_CANH_BAO_CAO, NGU_CANH_XAC_MINH } from "./email";
import { NOI_DUNG_BI_XOA, type VongDoiClaimedStore, type VongDoiStore, type XoaCuaChuStore } from "./vong-doi";

/**
 * Bản Prisma của `DiscStore`/`NhanStore`. Bảng DISC KHÔNG thuộc phạm vi cơ sở nên không đi qua
 * `scopedDb`; thay vào đó MỌI phép đọc/ghi đều nằm trong tệp này + `lib/disc/*` (không rải ra app).
 * ⚠️ Chứa dữ liệu cá nhân của trẻ: không log nội dung, không `select *` ra ngoài tầng này.
 */

const CHON_BAN_GHI = { id: true, phoneKey: true, emailStatus: true, emailTo: true, claimStatus: true, payloadHash: true, deletedAt: true, retainUntil: true } as const;

export const discStore: DiscStore = {
  async taoHoacLayTheoKhoa(d) {
    try {
      const ban = await db.discSubmission.create({
        data: {
          idempotencyKey: d.idempotencyKey,
          phoneKey: d.phoneKey,
          ipKey: d.ipKey,
          pepperVersion: d.pepperVersion,
          payloadHash: d.payloadHash,
          campaign: d.campaign,
          emailTo: d.emailTo,
          emailStatus: d.emailStatus,
          consentVersion: d.consentVersion,
          consentMarketing: d.tiepThi,
          // Mốc đồng ý từ `now` do dịch vụ tiêm vào — store không đọc đồng hồ (F-08).
          consentAt: d.consentAt,
          consentMarketingAt: d.consentMarketingAt,
          consentSubjectRole: d.consentSubjectRole,
          consentTextHash: d.consentTextHash,
          engineVersion: d.engineVersion,
          // Một nguồn lưu kết quả: DiscSubject.result. Cột này chỉ còn để tương thích (NOT NULL) — luôn {}.
          reportSnapshot: {},
          downloadTokenHash: d.tokenHash,
          downloadTokenExpires: d.tokenHetHan,
          claimCodeHash: d.claimCodeHash,
          retainUntil: d.retainUntil,
          subjects: {
            create: d.nguoi.map((n) => ({
              role: n.role,
              fullName: n.hoTen,
              birthYear: n.namSinh,
              grade: n.bacHoc,
              observedByAdult: n.nguoiLonQuanSat,
              questionSetVersion: n.phienBanBoDe,
              result: n.ketQua as Prisma.InputJsonValue,
            })),
          },
        },
        select: CHON_BAN_GHI,
      });
      return { ban, taoMoi: true };
    } catch (e) {
      // Đua/bấm lặp: UNIQUE(idempotencyKey) ⇒ lấy dòng đã có, KHÔNG ghi thêm. Trả đủ trường để dịch vụ
      // quyết replay có hợp lệ không (trạng thái · xoá · hạn · payloadHash).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const co = await db.discSubmission.findUnique({ where: { idempotencyKey: d.idempotencyKey }, select: CHON_BAN_GHI });
        if (co) return { ban: co, taoMoi: false };
      }
      throw e;
    }
  },

  async xoayTokenTai(id, tokenHash, hetHan, claimCodeHash, now) {
    // MỘT phép ghi có điều kiện: bài đã nhận/thu hồi/xoá/hết hạn giữa hai bước ⇒ 0 dòng đổi ⇒ false.
    // KHÔNG đụng claimAttempts (phát lại không được mở khoá).
    const r = await db.discSubmission.updateMany({
      where: { id, claimStatus: "PENDING_CLAIM", deletedAt: null, retainUntil: { gt: now } },
      data: { downloadTokenHash: tokenHash, downloadTokenExpires: hetHan, claimCodeHash },
    });
    return r.count === 1;
  },

  async demTheoPhone(phoneKey, ipKey, tu, boQuaKhoa) {
    // Mọi trạng thái (kể cả REVOKED/EXPIRED còn phoneKey ở dòng "bia mộ"); cửa sổ theo `consentAt` (= now tiêm).
    // Hai số cùng một cửa sổ: theo cặp (SĐT, IP) và theo SĐT ở mọi IP (N6).
    const chung = { phoneKey, consentAt: { gte: tu }, idempotencyKey: { not: boQuaKhoa } };
    const [theoCap, theoPhone] = await Promise.all([db.discSubmission.count({ where: { ...chung, ipKey } }), db.discSubmission.count({ where: chung })]);
    return { theoCap, theoPhone };
  },
};

/**
 * ⚠️ `dangCho`/`nhan` theo CHỈ SĐT đã bị GỠ có chủ đích (quyết định kiến trúc claim code): chỉ OTP SĐT
 * không đủ để liệt kê/nhận bài. Đường nhận hợp lệ duy nhất là `nhan.ts` (OTP + mã nhận + năm sinh của con) qua `thachDoStore`.
 * Ném lỗi thay vì trả rỗng để ai còn gọi đường cũ thấy ngay, không âm thầm "không có gì để nhận".
 */
export const nhanStore: NhanStore = {
  async dangCho() {
    throw new Error("DISC: liệt kê theo SĐT đã bị gỡ — dùng nhan.ts (OTP + mã nhận + năm sinh của con)");
  },

  async nhan() {
    throw new Error("DISC: nhận theo SĐT đã bị gỡ — dùng nhan.ts (OTP + mã nhận + năm sinh của con)");
  },

  async tuChoi(ids, phoneKey, now) {
    return db.$transaction(async (tx) => {
      const chon = await tx.discSubmission.findMany({
        where: { id: { in: ids }, phoneKey, claimStatus: "PENDING_CLAIM", deletedAt: null },
        select: { id: true },
      });
      if (!chon.length) return 0;
      const idsHopLe = chon.map((c) => c.id);
      // Từ chối ⇒ xoá nội dung nhạy cảm (người gõ nhầm số không được để lại hồ sơ trẻ nơi người lạ).
      await tx.discSubject.deleteMany({ where: { submissionId: { in: idsHopLe } } });
      const r = await tx.discSubmission.updateMany({
        where: { id: { in: idsHopLe }, claimStatus: "PENDING_CLAIM" },
        data: { claimStatus: "REVOKED", deletedAt: now, ...NOI_DUNG_BI_XOA },
      });
      return r.count;
    });
  },
};

/**
 * Xoá bằng OTP + mã nhận (nhánh NHẬN đã gỡ — luồng nhận mới ở nhan-prisma.ts có thách đố năm sinh). Hai bước TRONG MỘT transaction (xem hợp đồng ở `MaNhanStore`):
 * bước 1 tăng bộ đếm (chỉ dòng còn dưới ngưỡng) — không tăng được ⇒ đã khoá ⇒ null; bước 2 mới so mã.
 * So băm bằng `=` trong SQL: kẻ tấn công không biết khoá HMAC nên không điều khiển được tiền tố băm
 * ⇒ không có kênh thời gian dùng được; ngưỡng thử sai mới là chốt chặn.
 * Transaction commit cả khi trả null (bộ đếm PHẢI giữ lại) — vì thế ở đây KHÔNG ném khi sai mã.
 */
export const maNhanStore: MaNhanStore = {
  async thuBangMa({ phoneKey, maHash, now, toiDaLanThu, hanhDong }) {
    return db.$transaction(async (tx) => {
      const cho = { phoneKey, claimStatus: "PENDING_CLAIM" as const, deletedAt: null, retainUntil: { gt: now } };
      // N12: tăng TỪNG DÒNG bằng `updateMany` có điều kiện rồi CHỈ so mã trong các dòng vừa tăng được (cùng khuôn `thachDoStore`).
      // Bản cũ tăng cả loạt rồi `findFirst` trên MỌI dòng của SĐT với `lte` ⇒ mã của dòng A (đã khoá) xoá được A qua lượt tăng của dòng B.
      const ungVien = await tx.discSubmission.findMany({ where: { ...cho, claimAttempts: { lt: toiDaLanThu } }, select: { id: true } });
      const daTang: string[] = [];
      for (const u of ungVien) {
        const r = await tx.discSubmission.updateMany({
          where: { id: u.id, ...cho, claimAttempts: { lt: toiDaLanThu } },
          data: { claimAttempts: { increment: 1 } },
        });
        if (r.count === 1) daTang.push(u.id);
      }
      if (daTang.length === 0) return null;
      const khop = await tx.discSubmission.findFirst({
        where: { id: { in: daTang }, claimCodeHash: maHash },
        select: { id: true },
      });
      if (!khop) return null;
      // Chỉ còn đường XOÁ (kiểu `HanhDongMa` không có biến thể nào khác). Nhận bài KHÔNG đi qua đây: nó đòi thêm thách đố
      // năm sinh của con và ngưỡng riêng — xem `thachDoStore` (nhan-prisma.ts).
      if (hanhDong.loai !== "XOA") return null;
      await tx.discSubject.deleteMany({ where: { submissionId: khop.id } });
      await tx.discSubmission.update({ where: { id: khop.id }, data: { claimStatus: "REVOKED", deletedAt: now, ...NOI_DUNG_BI_XOA } });
      return { submissionId: khop.id };
    });
  },
};

export const taiStore: TaiStore = {
  async timTheoHashToken(hash) {
    const b = await db.discSubmission.findFirst({
      where: { downloadTokenHash: hash, deletedAt: null },
      select: {
        downloadTokenHash: true,
        downloadTokenExpires: true,
        claimStatus: true,
        deletedAt: true,
        createdAt: true,
        engineVersion: true,
        // Kết quả đọc từ DiscSubject.result (một nguồn), không từ reportSnapshot.
        subjects: { select: { role: true, fullName: true, birthYear: true, grade: true, observedByAdult: true, result: true } },
      },
    });
    return b;
  },
};

export const vongDoiStore: VongDoiStore = {
  async timHetHan(now, gioiHan) {
    const ds = await db.discSubmission.findMany({
      where: { claimStatus: "PENDING_CLAIM", deletedAt: null, retainUntil: { lte: now } },
      orderBy: { retainUntil: "asc" },
      take: gioiHan,
      select: { id: true },
    });
    return ds.map((d) => d.id);
  },

  async danhDauHetHan(ids, now) {
    if (!ids.length) return 0;
    return db.$transaction(async (tx) => {
      // Điều kiện lặp lại trong phép ghi: bài vừa được nhận giữa hai bước ⇒ không bị xoá nhầm.
      const chon = await tx.discSubmission.findMany({
        where: { id: { in: ids }, claimStatus: "PENDING_CLAIM", deletedAt: null, retainUntil: { lte: now } },
        select: { id: true },
      });
      if (!chon.length) return 0;
      const hopLe = chon.map((c) => c.id);
      await tx.discSubject.deleteMany({ where: { submissionId: { in: hopLe } } });
      const r = await tx.discSubmission.updateMany({
        where: { id: { in: hopLe }, claimStatus: "PENDING_CLAIM" },
        data: { claimStatus: "EXPIRED", deletedAt: now, ...NOI_DUNG_BI_XOA },
      });
      return r.count;
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bài ĐÃ NHẬN (CLAIMED): chủ tự xoá + hạn lưu cấu hình (S-01)
// ─────────────────────────────────────────────────────────────────────────────

type TxDisc = Prisma.TransactionClient;
const NGU_CANH_EMAIL = [NGU_CANH_XAC_MINH, NGU_CANH_BAO_CAO];

/**
 * Xoá nội dung MỘT LÔ bài đã nhận, TRONG transaction của người gọi. Không xoá `Lead` (bản ghi nghiệp vụ CRM):
 * chỉ gỡ liên kết DISC (submission.leadId; và `Lead.eventId = disc:<id>` + cờ tiếp thị của lead do CHÍNH bài này tạo).
 * LeadTouchpoint/LeadAttribution KHÔNG đụng ở đây: chỉ `lib/nguon/**` được ghi hai bảng đó (lưới [QN-W11]), touchpoint
 * không mang id bài, và theo hợp đồng bảng không chứa SĐT/tên — xem 06-security-privacy (quyết định pháp chế còn mở).
 * Bia mộ giữ: id, phoneKey (HMAC), mốc đồng ý/nhận/xoá, phiên bản — KHÔNG còn thông tin về trẻ hay email.
 */
async function xoaNoiDungDaNhanTx(tx: TxDisc, ids: string[], o: { den: "REVOKED" | "EXPIRED"; now: Date; rutDongY: boolean; actor: { id: string | null; name: string }; hanhDong: string }): Promise<number> {
  if (!ids.length) return 0;
  const bai = await tx.discSubmission.findMany({ where: { id: { in: ids } }, select: { id: true, leadId: true } });
  const idsHopLe = bai.map((b) => b.id);
  await tx.discSubject.deleteMany({ where: { submissionId: { in: idsHopLe } } });
  // Thư xác minh/báo cáo của bài: xoá hàng đợi (kể cả đang chờ gửi) và nhật ký — chúng mang địa chỉ + nội dung thư.
  await tx.emailQueue.deleteMany({ where: { contextType: { in: NGU_CANH_EMAIL }, contextId: { in: idsHopLe } } });
  await tx.emailLog.deleteMany({ where: { contextType: { in: NGU_CANH_EMAIL }, contextId: { in: idsHopLe } } });
  for (const b of bai) {
    if (b.leadId) await tx.lead.updateMany({ where: { id: b.leadId, eventId: `disc:${b.id}` }, data: { eventId: null, consentMarketing: false } });
  }
  const r = await tx.discSubmission.updateMany({
    where: { id: { in: idsHopLe }, claimStatus: "CLAIMED" },
    data: {
      claimStatus: o.den,
      deletedAt: o.now,
      leadId: null,
      consentMarketing: false,
      consentMarketingAt: null,
      emailStatus: "NONE",
      emailVerifiedAt: null,
      emailVerifyExpiresAt: null,
      ...(o.rutDongY ? { consentWithdrawnAt: o.now } : {}),
      ...NOI_DUNG_BI_XOA,
    },
  });
  for (const id of idsHopLe) {
    // Audit KHÔNG chứa tên/năm sinh/SĐT/email — chỉ id bài + loại hành động.
    await writeAudit({ actor: o.actor, module: "disc", entityType: "DiscSubmission", entityId: id, action: o.hanhDong, newValues: { claimStatus: o.den, rutDongY: o.rutDongY }, tx });
  }
  return r.count;
}

export const xoaCuaChuStore: XoaCuaChuStore = {
  async xoaBaiCuaChu({ userId, id, now }) {
    return db.$transaction(async (tx) => {
      // Quyền = claimedUserId từ PHIÊN. Id của người khác/lạ/đã xoá ⇒ không khớp dòng nào ⇒ 0.
      const chon = await tx.discSubmission.findMany({
        where: { claimedUserId: userId, claimStatus: "CLAIMED", deletedAt: null, ...(id ? { id } : {}) },
        select: { id: true },
      });
      return xoaNoiDungDaNhanTx(tx, chon.map((c) => c.id), { den: "REVOKED", now, rutDongY: true, actor: { id: userId, name: "Phụ huynh (tự xoá)" }, hanhDong: "disc.claimed.xoa_boi_chu" });
    });
  },
};

export const vongDoiClaimedStore: VongDoiClaimedStore = {
  async timHetHanClaimed(truocMoc, gioiHan) {
    const ds = await db.discSubmission.findMany({
      where: { claimStatus: "CLAIMED", deletedAt: null, OR: [{ claimedAt: { lte: truocMoc } }, { claimedAt: null, createdAt: { lte: truocMoc } }] },
      orderBy: { createdAt: "asc" },
      take: gioiHan,
      select: { id: true },
    });
    return ds.map((d) => d.id);
  },

  async danhDauHetHanClaimed(ids, truocMoc, now) {
    if (!ids.length) return 0;
    return db.$transaction(async (tx) => {
      // Điều kiện lặp lại trong phép ghi: bài vừa bị chủ xoá giữa hai bước ⇒ không xử lý lại.
      const chon = await tx.discSubmission.findMany({
        where: { id: { in: ids }, claimStatus: "CLAIMED", deletedAt: null, OR: [{ claimedAt: { lte: truocMoc } }, { claimedAt: null, createdAt: { lte: truocMoc } }] },
        select: { id: true },
      });
      return xoaNoiDungDaNhanTx(tx, chon.map((c) => c.id), { den: "EXPIRED", now, rutDongY: false, actor: { id: null, name: "Hệ thống (DISC hạn lưu)" }, hanhDong: "disc.claimed.het_han" });
    });
  },
};
