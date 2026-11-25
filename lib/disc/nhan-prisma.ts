import "server-only";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { requestOtp, verifyAndConsumeOtp } from "@/lib/otp/service";
import { phoneVariants } from "@/lib/phone";
import { ghiReferralSauNhan, xacNhanTiepThiSauNhan } from "./crm-that";
import { gatEmailDaXacMinhChoLead } from "./crm-email";
import { dongBoThongTinSauNhan } from "./thong-tin-sau-nhan-db";
import { TOI_DA_LAN_THU_NHAN, TRAN_OTP_NHAN_MOI_SDT_MOI_NGAY, TRAN_THU_NHAN_MOI_SDT_MOI_GIO, type NhanDeps, type ThachDoStore } from "./nhan";
import { layKhoaDisc, phoneKeyTuSdtChuan } from "./phone-key";
import { choPhepOtpClaimToanCuc } from "./tran-toan-cuc";

/**
 * Thách đố nhận bài: mã nhận + năm sinh của con (F-06), trong MỘT transaction.
 *
 *  1. Tìm các dòng PENDING_CLAIM của `phoneKey` (HMAC) còn dưới ngưỡng, rồi TĂNG BỘ ĐẾM TỪNG DÒNG bằng `updateMany` CÓ ĐIỀU KIỆN
 *     `claimAttempts < toiDaLanThu` — chỉ dòng nào thật sự tăng được (count === 1) mới được so ở bước 2. Điều kiện nằm TRONG phép
 *     ghi nên N lượt song song cũng chỉ được tối đa `toiDaLanThu` lượt chạm tới bước 2 (Postgres đánh giá lại `where` sau khi đợi khoá dòng).
 *  2. CHỈ trong các dòng vừa tăng: khớp `claimCodeHash` ∧ có `DiscSubject` vai STUDENT đúng năm sinh.
 *
 * ⚠️ Transaction PHẢI commit cả khi sai (trả null chứ KHÔNG ném) — nếu ném, bộ đếm bị rollback và kẻ đoán thử vô hạn.
 * ⚠️ Bộ đếm tăng TRƯỚC khi so (so-rồi-tăng cho phép nhiều phiên song song cùng đoán lượt cuối).
 * Mã và năm sinh sai cùng trả null ⇒ không phân biệt được "mã đúng, năm sai".
 */
export const thachDoStore: ThachDoStore = {
  async thu({ phoneKey, maHash, namSinhCon, now, toiDaLanThu }) {
    return db.$transaction(async (tx) => {
      const cho = { phoneKey, claimStatus: "PENDING_CLAIM" as const, deletedAt: null, retainUntil: { gt: now } };
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
        where: { id: { in: daTang }, claimCodeHash: maHash, subjects: { some: { role: "STUDENT", birthYear: namSinhCon } } },
        select: { id: true },
      });
      return khop ? { submissionId: khop.id } : null;
    });
  },

  async gan({ submissionId, phoneKey, userId, now }) {
    const r = await db.discSubmission.updateMany({
      where: { id: submissionId, phoneKey, claimStatus: "PENDING_CLAIM", deletedAt: null, retainUntil: { gt: now } },
      data: { claimStatus: "CLAIMED", claimedUserId: userId, claimedAt: now },
    });
    return r.count === 1;
  },
};

const MOT_NGAY_MS = 24 * 60 * 60_000;

/**
 * Nối `nhan.ts` với DB thật + dịch vụ OTP thật. Tách khỏi `nhan.ts` để luật thuần test được không cần DB.
 * Mọi truy vấn ở đây đi `db` trần có chủ đích: bảng DISC không theo cơ sở và `User` tra theo SĐT đã
 * chuẩn hoá để tạo/kích hoạt tài khoản phụ huynh (cùng cách `lib/parents/provision.ts`).
 */
export function taoNhanDeps(now: Date = new Date()): NhanDeps {
  return {
    now,
    thachDoStore,
    khoaSdt: (sdtChuan) => phoneKeyTuSdtChuan(sdtChuan, layKhoaDisc()),
    coBaiDangCho: async (khoaSdt, t) => {
      const n = await db.discSubmission.count({
        where: { phoneKey: khoaSdt, claimStatus: "PENDING_CLAIM", deletedAt: null, retainUntil: { gt: t }, claimCodeHash: { not: null } },
      });
      return n > 0;
    },
    // Khoá theo HMAC (không đưa SĐT thô vào Redis). Gọi sau mọi cổng nên chỉ lượt thật sự sắp gửi ZNS mới tiêu hạn mức.
    choPhepGuiOtp: async (khoaSdt) => {
      const r = await rateLimit({ key: `otp:disc-claim:sdt:${khoaSdt}`, max: TRAN_OTP_NHAN_MOI_SDT_MOI_NGAY, windowMs: MOT_NGAY_MS });
      if (!r.success) return false;
      // S-04: cầu chì NGÂN SÁCH toàn cục theo ngày (ZNS tốn tiền) — chỉ tiêu ở lượt THẬT SỰ sắp gửi, sau mọi cổng khác.
      return choPhepOtpClaimToanCuc();
    },
    // N3: cổng TRƯỚC `otp.xacMinh` — có dòng chờ khớp mã băm (đọc, không đếm) rồi mới tính trần theo HMAC-SĐT.
    // Thứ tự: kẻ không có mã không chạm tới trần của chủ số (không đốt hạn mức của họ).
    choPhepThuOtp: async ({ khoaSdt, maHash, now: t }) => {
      const n = await db.discSubmission.count({
        where: {
          phoneKey: khoaSdt,
          claimStatus: "PENDING_CLAIM",
          deletedAt: null,
          retainUntil: { gt: t },
          claimAttempts: { lt: TOI_DA_LAN_THU_NHAN },
          claimCodeHash: maHash,
        },
      });
      if (n === 0) return false;
      const r = await rateLimit({ key: `disc-claim:thu:${khoaSdt}`, max: TRAN_THU_NHAN_MOI_SDT_MOI_GIO, windowMs: 60 * 60_000 });
      return r.success;
    },
    otp: {
      yeuCau: (sdtChuan) => requestOtp({ target: sdtChuan, purpose: "DISC_CLAIM" }),
      xacMinh: async (sdtChuan, code) => {
        const v = await verifyAndConsumeOtp({ target: sdtChuan, purpose: "DISC_CLAIM", code });
        return v.ok ? { ok: true } : { ok: false, error: v.error };
      },
    },
    taiKhoan: {
      tim: async (sdtChuan) => {
        // N11: tra theo MỌI dạng (84… lẫn 0… cũ) — nếu còn User lưu dạng cũ mà tra đúng-bằng thì sẽ tạo User thứ HAI cho cùng người.
        const u = await db.user.findFirst({
          where: { phone: { in: phoneVariants(sdtChuan) } },
          orderBy: { createdAt: "asc" },
          select: { id: true, accountStatus: true, deletedAt: true, role: true, roles: true },
        });
        if (!u || u.deletedAt) return null;
        const trangThai = u.accountStatus === "ACTIVE" ? "ACTIVE" : u.accountStatus === "PENDING_ACTIVATION" ? "PENDING_ACTIVATION" : "KHAC";
        return { id: u.id, trangThai, laPhuHuynh: u.role === "PARENT" && u.roles.every((r) => r === "PARENT") };
      },
      taoPhuHuynh: async ({ phoneKey, matKhauHash, now: t }) => {
        // Đua hai lượt cùng SĐT ⇒ unique(phone) ném: lượt thua KHÔNG được ghi đè mật khẩu của lượt thắng.
        return db.user.create({
          data: { phone: phoneKey, phoneVerifiedAt: t, password: matKhauHash, role: "PARENT", roles: ["PARENT"], accountStatus: "ACTIVE", isActive: true },
          select: { id: true },
        });
      },
      kichHoat: async ({ userId, matKhauHash, now: t }) => {
        // Điều kiện nằm trong phép ghi: chỉ kích hoạt khi VẪN còn PENDING_ACTIVATION (đua với /kich-hoat).
        const r = await db.user.updateMany({
          where: { id: userId, accountStatus: "PENDING_ACTIVATION" },
          data: { password: matKhauHash, accountStatus: "ACTIVE", isActive: true, phoneVerifiedAt: t },
        });
        if (r.count !== 1) throw new Error("DISC: tài khoản không còn ở trạng thái chờ kích hoạt");
      },
      huyTaoMoi: async (userId) => {
        // Chỉ xoá tài khoản VỪA tạo, chưa từng đăng nhập, chưa có liên kết nào.
        await db.user.deleteMany({ where: { id: userId, lastLoginAt: null, accountStatus: "ACTIVE", role: "PARENT" } });
      },
    },
    bamMatKhau: (m) => bcrypt.hash(m, 10),
    // Chủ số đã qua OTP + nhận bài ⇒ bây giờ mới được bật đồng ý tiếp thị trên lead (F-09).
    // Mỗi bước độc lập và không ném: thiếu một bước còn hơn làm hỏng việc nhận. Referral/email chỉ ghi Ở ĐÂY (sau OTP + mã), không lúc lưu (N4).
    sauKhiNhan: async (p) => {
      await Promise.allSettled([xacNhanTiepThiSauNhan(p), ghiReferralSauNhan({ submissionId: p.submissionId, sdtChuan: p.sdtChuan }), gatEmailDaXacMinhChoLead(p.submissionId), dongBoThongTinSauNhan({ submissionId: p.submissionId })]);
    },
  };
}
