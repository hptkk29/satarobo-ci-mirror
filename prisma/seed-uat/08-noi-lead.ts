// prisma/seed-uat/08-noi-lead.ts — mỗi học viên UAT ĐẾN TỪ một phiếu lead (26/09/2026).
//
// Chủ dự án 26/09: "data test thì seed data lại cho đúng". Bộ seed cũ dựng lead (02-crm) và học
// viên (03-hoc-vu) HOÀN TOÀN RỜI nhau — SĐT khác dải, không vết chốt, không `Student.leadId` —
// nên cả 250 hồ sơ trên test.satarobo.vn hiện "Chưa nối lead", và script nối HV cũ (chỉ đi theo
// bằng chứng) không nối được em nào. Ngoài đời thì ngược lại: học viên là phiếu lead đã chốt.
//
// Bước này dựng lại đúng hình dạng ấy, KHÔNG xoá gì:
//   · mỗi gia đình (anh chị em dùng chung SĐT phụ huynh) một phiếu lead ĐÃ CHỐT, mỗi em một
//     `LeadChild` mang đúng tên / ngày sinh / giới tính / trường / lớp của hồ sơ;
//   · `Student.leadId` + `leadChildId` trỏ về đó; ghi danh SỚM NHẤT của em mang `leadChildId`
//     (vết chốt — thứ mà báo cáo chuyển đổi và script nối HV cũ đọc);
//   · địa chỉ seed cũ ("Đà Nẵng" + quận cũ) đổi sang danh mục MỚI (Tp Đà Nẵng + phường/xã sau
//     01/07/2025) — cùng lúc cho hồ sơ và phiếu, để hai bên khớp nhau ngay từ đầu.
//
// ⚠️ D1 (docs/hoc-vien-lien-ket-lead.md) CẤM backfill `Enrollment.leadChildId` trên dữ liệu THẬT
// (nó là tín hiệu "đã chốt" của báo cáo chuyển đổi). Ở đây là dữ liệu GIẢ, và bước này dựng lại
// ĐÚNG thứ lượt chốt lead thật ghi — không phải suy ngược. ĐỪNG chép phần ghi vết chốt sang một
// script chạy trên prod.
//
// Idempotent: id tất định (`uid`), chỉ tạo phiếu còn thiếu, chỉ nối HV đang `leadId IS NULL`,
// chỉ đổi địa chỉ đang mang đúng giá trị seed cũ. Chạy lại bao nhiêu lần cũng ra cùng một bộ.
//
// Chạy riêng (DB đang có người nghiệm thu — không đụng bước nào khác):
//   UAT_SEED=1 UAT_ONLY=noilead pnpm db:seed:uat
import { getWardsByProvince, provinces } from "vietnam-address-data";
import type { Prisma } from "@prisma/client";
import { canonicalPhone } from "../../lib/phone";
import { maTinhMoi } from "../../lib/address/vn-address";
import { NHAN_GIOI_TINH } from "../../lib/students/gioi-tinh";
import {
  buoc, db, makeRng, pick, saleCua, taoThieu, uid, xong, MOI_CO_SO,
  type CoId, type CoSo, type Uat,
} from "./_common";

const NGUON = ["Facebook Ads", "Messenger Page HO", "Giới thiệu", "Zalo OA", "Website", "Sự kiện trường học"];
/** Giá trị địa chỉ mà bộ seed CŨ ghi (03-hoc-vu trước 26/09) — chỉ những hồ sơ này bị đổi. */
const TINH_SEED_CU = "Đà Nẵng";

export async function seedNoiLead(coSo: CoSo[], uat: Uat) {
  const rng = makeRng(8008);
  const SO_HV = Math.round(MOI_CO_SO * 2.5); // = 03-hoc-vu

  const maDaNang = maTinhMoi(provinces, "Đà Nẵng");
  if (!maDaNang) throw new Error("Danh mục tỉnh không có Đà Nẵng — gói vietnam-address-data đổi?");
  const tenDaNang = provinces.find((p) => p.id === maDaNang)!.name;
  const phuongDaNang = getWardsByProvince(maDaNang).map((w) => w.name);

  buoc("Nối học viên ↔ lead nguồn");

  const leads: CoId<Prisma.LeadCreateManyInput>[] = [];
  const children: CoId<Prisma.LeadChildCreateManyInput>[] = [];
  type NoiHv = {
    studentId: string;
    leadId: string;
    leadChildId: string;
    doiDiaChi: { city: string; ward: string; district: null } | null;
  };
  const noi: NoiHv[] = [];

  for (const cs of coSo) {
    const sale = saleCua(uat, cs);
    const ids = Array.from({ length: SO_HV }, (_, k) => uid("hv", cs.code, k + 1));
    const hvs = await db.student.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, name: true, dateOfBirth: true, gender: true, currentGrade: true, school: true,
        parentName: true, parentPhone: true, parentEmail: true, parentGender: true,
        parentFacebookUrl: true, parentDob: true,
        city: true, ward: true, address: true, district: true,
        centerId: true, createdAt: true, leadId: true,
      },
    });
    const theoId = new Map(hvs.map((h) => [h.id, h]));

    // Gia đình = cùng SĐT phụ huynh (03-hoc-vu: cứ 8 em thì một em dùng chung PH với em trước).
    const phieuCuaSdt = new Map<string, string>();
    for (let i = 1; i <= SO_HV; i++) {
      const hv = theoId.get(uid("hv", cs.code, i));
      if (!hv) continue;
      const sdt = canonicalPhone(hv.parentPhone);
      if (!sdt) continue;

      // Địa chỉ: chỉ hồ sơ còn mang đúng giá trị seed cũ mới bị đổi (dữ liệu người nghiệm thu
      // đã sửa tay thì để yên).
      const laSeedCu = hv.city === TINH_SEED_CU;
      const ward = laSeedCu ? pick(rng, phuongDaNang) : hv.ward;
      const city = laSeedCu ? tenDaNang : hv.city;

      let leadId = phieuCuaSdt.get(sdt);
      if (!leadId) {
        leadId = uid("lead-hv", cs.code, i);
        phieuCuaSdt.set(sdt, leadId);
        const chot = new Date(hv.createdAt.getTime() - 2 * 86_400_000);
        leads.push({
          id: leadId,
          parentName: hv.parentName ?? "Phụ huynh",
          phone: sdt,
          email: hv.parentEmail,
          parentGender: hv.parentGender,
          parentDob: hv.parentDob,
          facebookUrl: hv.parentFacebookUrl,
          city,
          ward,
          addressLine: hv.address,
          childName: null,
          centerId: hv.centerId,
          assignedToId: sale.id,
          assignedAt: new Date(chot.getTime() - 12 * 86_400_000),
          firstContactAt: new Date(chot.getTime() - 11 * 86_400_000),
          qualifiedAt: new Date(chot.getTime() - 11 * 86_400_000),
          status: "DA_DANG_KY",
          source: pick(rng, NGUON),
          consentMarketing: true,
          convertedAt: chot,
          convertedById: sale.id,
          lastActivityAt: chot,
          createdAt: new Date(chot.getTime() - 14 * 86_400_000),
        });
      }

      const leadChildId = uid("leadchild-hv", cs.code, i);
      children.push({
        id: leadChildId,
        leadId,
        fullName: hv.name,
        dob: hv.dateOfBirth,
        gender: hv.gender ? NHAN_GIOI_TINH[hv.gender] : null,
        schoolName: hv.school,
        gradeLevel: hv.currentGrade ? `Lớp ${hv.currentGrade}` : null,
        interestedCenterId: hv.centerId,
        status: "ENROLLED",
        closedAt: hv.createdAt,
      });

      if (hv.leadId === null) {
        noi.push({
          studentId: hv.id,
          leadId,
          leadChildId,
          doiDiaChi: laSeedCu ? { city: tenDaNang, ward: ward ?? "", district: null } : null,
        });
      }
    }
  }

  const nLead = await taoThieu(
    leads,
    (ids) => db.lead.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.lead.createMany({ data, skipDuplicates: true }),
  );
  const nCon = await taoThieu(
    children,
    (ids) => db.leadChild.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.leadChild.createMany({ data, skipDuplicates: true }),
  );

  // Nối + vết chốt: từng em một transaction ngắn (qua pooler; lô lớn dễ chạm trần 5 giây).
  let nNoi = 0;
  let nVet = 0;
  for (const n of noi) {
    await db.$transaction(async (tx) => {
      const r = await tx.student.updateMany({
        // `leadId: null` trong where: không đè liên kết người nghiệm thu vừa gắn tay.
        where: { id: n.studentId, leadId: null },
        data: { leadId: n.leadId, leadChildId: n.leadChildId, ...(n.doiDiaChi ?? {}) },
      });
      nNoi += r.count;
      if (r.count === 0) return;
      const dau = await tx.enrollment.findFirst({
        where: { studentId: n.studentId, leadChildId: null },
        orderBy: { enrolledAt: "asc" },
        select: { id: true },
      });
      if (dau) {
        await tx.enrollment.update({ where: { id: dau.id }, data: { leadChildId: n.leadChildId } });
        nVet++;
      }
    });
  }

  xong("Nối học viên ↔ lead nguồn", {
    phiếu_lead_mới: nLead,
    bé_trong_phiếu: nCon,
    học_viên_nối: nNoi,
    vết_chốt_ghi_danh: nVet,
  });
}
