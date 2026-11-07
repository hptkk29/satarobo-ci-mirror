import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { phoneVariants } from "@/lib/phone";
import { rateLimit } from "@/lib/rate-limit";
import { findRecentDuplicate, logDuplicateAttempt } from "@/lib/lead/dedup";
import { autoAssignNewLead } from "@/lib/lead/auto-assign";
import { chiaChoLead } from "@/lib/lead/assign-lead";
import { layCoSoNhanLead } from "@/lib/lead/chia-theo-phuong-ghi";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { chuanBiReferral, ghiReferralChoLeadCu, ghiReferralSauKhiTaoLead } from "@/lib/affiliate/nhan-referral";
import { COOKIE_GIOI_THIEU, docCoTheoDoi } from "@/lib/affiliate/theo-doi-cong-khai";
import { chuanBiQuyNguon, ghiNguonDenSauChoLeadCu, ghiQuyNguonLeadMoi, type NguonDaChuanBi } from "@/lib/nguon/noi-day";
import { KHONG_CO_TIN_HIEU_NGUON } from "@/lib/nguon/tin-hieu";
import type { CongCrm } from "./luu";
import { eventIdCuaBai, maLoiAnToan, taoCongCrm, taoGhiReferralSauNhan, taoXacNhanTiepThi, type CrmPorts } from "./crm";

/**
 * Nối `crm.ts` với lõi lead/nguồn/affiliate THẬT. Đi đúng thứ tự của `app/api/leads/route.ts`
 * (chuẩn bị TRƯỚC giao dịch → lead + nguồn cùng một giao dịch → referral/chia lead SAU commit) nhưng
 * gọi lõi trực tiếp, không gọi vòng HTTP. Không có mã giới thiệu hợp lệ ⇒ đường vào `web` không tín hiệu
 * ⇒ lõi quy nguồn tự chọn nguồn theo cấu hình động hiện hành.
 *
 * KHÔNG gọi Meta CAPI / GA4 Measurement Protocol / `lib/tracking` ở đây (F-15): đường DISC chưa có đồng ý tiếp thị
 * của CHỦ SỐ lúc tạo lead. Lưới [DISC-CRM-07] ghim.
 *
 * LOG: chỉ ghi MÃ lỗi (`maLoiAnToan`), không bao giờ đối tượng lỗi — lỗi Prisma/Postgres hay mang giá trị cột (SĐT, email) (F-14/H-1).
 * Mỗi chỗ ghi log viết `const ma = …; console.error("…", ma)` để lưới [DISC-QA-PII-01] (danh sách trắng) xanh.
 */

type Chuan = { nguon: NguonDaChuanBi };
type GhiReferralDaChuanBi = Extract<Awaited<ReturnType<typeof chuanBiReferral>>, { ok: true }>;

const TRAN_DAU_VET_TRUNG_MOI_NGAY = 5;

/** `now` được TIÊM (H-2): mọi dấu thời gian của lead/referral/nguồn đi qua đây để test được thứ tự thời gian. */
function taoPorts(now: () => Date): CrmPorts<Chuan> {
  return {
    timLeadTheoEventId: (eventId) => db.lead.findUnique({ where: { eventId }, select: { id: true } }),

    timLeadTrung: (phone) => findRecentDuplicate(phone),

    // N4: lúc lưu KHÔNG có tín hiệu affiliate — người gõ SĐT chưa chứng minh là chủ số. Referral ghi sau khi nhận bài.
    async chuanBi({ phone }) {
      const [nguon] = await chuanBiQuyNguon(db, [
        {
          bayGio: now(),
          duongVao: "web",
          conversionEntry: "disc",
          nhanKhai: null,
          laNhapExcel: false,
          sdtKhach: phone,
          maNvNguoiNhap: null,
          nguoiNhapUserId: null,
          nhanSuGioiThieuEmployeeId: null,
          phuHuynhGioiThieu: null,
          affiliate: null,
          ref: null,
          refSau: [],
          quangCao: { ...KHONG_CO_TIN_HIEU_NGUON.quangCao },
          utm: { ...KHONG_CO_TIN_HIEU_NGUON.utm }, // KHÔNG đặt utm: tín hiệu utm sẽ đẩy lead sang nhóm quảng cáo
          pageId: null,
          orgUnitId: null,
          centerId: null,
        },
      ]);
      return { nguon: nguon! };
    },

    async taoLeadMoi({ eventId, data, chuanBi }) {
      // Khách TỰ chọn «cơ sở gần nhà»: thắng mọi quy tắc chia, nhưng chỉ khi cơ sở đó còn NHẬN LEAD (đang hoạt động, không phải Hội sở…).
      // Mã lạ / cơ sở đã đóng ⇒ bỏ qua êm (lead vẫn tạo, rơi vào chia theo phường rồi chia đều).
      const coSoChon = await coSoNhanLeadTheoMa(data.coSoMongMuon);
      const orgUnitChon = coSoChon ? await orgUnitIdForCenter(coSoChon).catch(() => null) : null;
      try {
        const lead = await db.$transaction(async (tx) => {
          const created = await tx.lead.create({
            data: {
              parentName: data.parentName,
              phone: data.phone,
              email: data.email ?? undefined,
              lastInboundAt: now(),
              source: data.source,
              status: "MOI",
              landingPage: data.landingPage,
              eventId,
              consentMarketing: data.consentMarketing,
              note: data.note,
              // Địa chỉ nơi ở của PHỤ HUYNH (không phải của con) — để chia lead về cơ sở gần nhà (lib/lead/chia-theo-phuong.ts).
              city: data.city ?? undefined,
              ward: data.ward ?? undefined,
              addressLine: data.addressLine ?? undefined,
              ...(coSoChon ? { centerId: coSoChon, ...(orgUnitChon ? { orgUnitId: orgUnitChon } : {}) } : {}),
            },
          });
          await ghiQuyNguonLeadMoi(tx, created.id, chuanBi.nguon, null);
          return created;
        });
        return { leadId: lead.id, centerId: lead.centerId ?? null };
      } catch (err) {
        // Hai lượt đua cùng eventId: lượt thua lấy lead của lượt thắng, KHÔNG tạo lead thứ hai.
        if ((err as { code?: unknown }).code === "P2002") {
          const co = await db.lead.findUnique({ where: { eventId }, select: { id: true, centerId: true } });
          if (co) return { leadId: co.id, centerId: co.centerId ?? null };
        }
        throw err;
      }
    },

    async ghiLeadTrung({ leadId, nhan }) {
      const cho = await rateLimit({ key: `disc-dup:${leadId}`, max: TRAN_DAU_VET_TRUNG_MOI_NGAY, windowMs: 86_400_000 });
      if (cho.success) {
        const lead = await db.lead.findUnique({ where: { id: leadId }, select: { phone: true } });
        if (lead) await logDuplicateAttempt(leadId, lead.phone, "web", { kieu: "gop" });
        await ghiNguonDenSauChoLeadCu(
          db,
          leadId,
          {
            kind: "NHAP_LAI",
            conversionEntry: nhan,
            nhanKhai: null,
            ref: null,
            quangCao: { ...KHONG_CO_TIN_HIEU_NGUON.quangCao },
            utm: { ...KHONG_CO_TIN_HIEU_NGUON.utm },
            pageId: null,
            nguoiGioiThieu: null,
          },
          null,
          "disc",
        );
      }
    },

    async hoanTatLeadMoi({ leadId, centerId }) {
      if (centerId) {
        await chiaChoLead(leadId, { targetCenterId: centerId, createdById: null, entryPoint: "LANDING", aff: null }).catch((e: unknown) => {
          const ma = maLoiAnToan(e);
          console.error("[disc:crm] chia lead:", ma);
        });
      } else {
        await autoAssignNewLead(leadId, { actorId: null, actorName: "Hệ thống (DISC)" }).catch((e: unknown) => {
          const ma = maLoiAnToan(e);
          console.error("[disc:crm] auto-assign:", ma);
        });
      }
    },

    async datLeadChoBai(submissionId, leadId) {
      // Chỉ ghi khi chưa có — lead đầu tiên của bài là lead giữ.
      await db.discSubmission.updateMany({ where: { id: submissionId, leadId: null }, data: { leadId } });
    },
  };
}

/** Dựng cổng CRM với đồng hồ tiêm vào (test truyền giờ cố định). */
export function taoCongCrmThat(now: () => Date = () => new Date()): CongCrm {
  return taoCongCrm(taoPorts(now));
}

export const congCrmThat: CongCrm = taoCongCrmThat();

/**
 * Bật đồng ý tiếp thị trên lead SAU KHI chủ số đã qua OTP và nhận bài (F-09/N7). Điều kiện (lead đúng SĐT vừa xác thực,
 * đang chưa bật, và — với ô tích của NGƯỜI GÕ — lead do CHÍNH bài này tạo) nằm TRONG phép ghi `updateMany`.
 */
export const xacNhanTiepThiSauNhan = taoXacNhanTiepThi({
  docBai: (id) => db.discSubmission.findUnique({ where: { id }, select: { consentMarketing: true, leadId: true } }),
  datTiepThiChoLead: async (leadId, sdtChuan, rangBuoc) => {
    const r = await db.lead.updateMany({
      where: { id: leadId, phone: { in: phoneVariants(sdtChuan) }, consentMarketing: false, ...(rangBuoc.chiLeadCuaBai ? { eventId: rangBuoc.chiLeadCuaBai } : {}) },
      data: { consentMarketing: true },
    });
    return r.count === 1;
  },
});

/**
 * Ghi referral/affiliate SAU KHI chủ số đã qua OTP + mã nhận (N4/M-2). Đọc cookie `sr_aff` của request nhận (trình duyệt
 * của chủ số). `now` được tiêm cho test.
 */
export function taoGhiReferralSauNhanThat(now: () => Date = () => new Date()) {
  return taoGhiReferralSauNhan<GhiReferralDaChuanBi>({
    async docRefCookie() {
      try {
        if (!(await docCoTheoDoi())) return null;
        return (await cookies()).get(COOKIE_GIOI_THIEU)?.value ?? null;
      } catch {
        return null; // ngoài ngữ cảnh request ⇒ không có cookie
      }
    },
    async docLeadCuaBai(submissionId) {
      const bai = await db.discSubmission.findUnique({ where: { id: submissionId }, select: { leadId: true } });
      if (!bai?.leadId) return null;
      const lead = await db.lead.findUnique({ where: { id: bai.leadId }, select: { id: true, centerId: true, eventId: true } });
      if (!lead) return null;
      return { leadId: lead.id, centerId: lead.centerId ?? null, doBaiTao: lead.eventId === eventIdCuaBai(submissionId) };
    },
    async chuanBi({ token, phone, eventId }) {
      try {
        // clickId/origin: không có tín hiệu nào đọc được hợp lệ ở server action ⇒ luôn XEM_TAY (không tự ghi công). Email: KHÔNG truyền (chưa xác minh).
        const cb = await chuanBiReferral({ token, clickId: null, khach: { phone, email: null }, origin: null, idempotencyKey: eventId, now: now() });
        return cb.ok ? cb : null;
      } catch (err) {
        const ma = maLoiAnToan(err);
        console.error("[disc:crm] chuẩn bị referral:", ma);
        return null;
      }
    },
    async ghiChoLeadMoi({ ghi, leadId, centerId }) {
      await ghiReferralSauKhiTaoLead({ ghi: ghi.ghi, leadId, centerId, now: now() });
    },
    async ghiChoLeadCu({ ghi, leadId }) {
      await ghiReferralChoLeadCu({ ghi: ghi.ghi, leadId, now: now() });
    },
  });
}

export const ghiReferralSauNhan = taoGhiReferralSauNhanThat();

/** Mã cơ sở khách chọn tay («CS1»…) → `Center.id`, CHỈ khi cơ sở đó đang nhận lead mới; ngược lại null. */
async function coSoNhanLeadTheoMa(ma: string | null): Promise<string | null> {
  if (!ma) return null;
  const [co, nhanLead] = await Promise.all([db.center.findFirst({ where: { code: ma, isActive: true }, select: { id: true } }), layCoSoNhanLead()]);
  return co && nhanLead.some((c) => c.id === co.id) ? co.id : null;
}
