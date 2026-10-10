// prisma/seed-uat/02-crm.ts — CRM: lead, con của lead, dòng thời gian, việc cần làm.
//
// Màn được nuôi: /leads · /crm · /ban-giao-lead · /leads/bao-cao-chuyen ·
// /leads/so-luot · /marketing · /bao-cao/lead · /affiliates · /convert-conflicts
//
// CÁCH LY CƠ SỞ là trục chính: lead của CS1 gán cho `uat.sale1`, lead CS2 gán cho
// `uat.sale2`. `uat.saleho` (HO_SALE) xem được cả hai nhưng KHÔNG sửa; `uat.admin`
// thấy tất. Vì thế mỗi sale cơ sở mở /leads là thấy đúng phần của mình.
import {
  db, buoc, xong, chance, int, makeRng, ngay, pick, saleCua, sdt, shuffle,
  taoThieu, tenNguoi, uid, MOI_CO_SO, TI_LE_CA_BIEN,
  type CoId, type CoSo, type Uat,
} from "./_common";
import type { Prisma } from "@prisma/client";

/** Phễu SR.QD.217: phần lớn lead nằm giữa phễu, ít lead ở hai đầu.
 *
 * Trọng số đã CỘNG DỒN khi hai bậc cũ rơi vào cùng một bậc mới, để phân bố dữ liệu
 * mẫu không đổi so với trước (tổng vẫn 100):
 *  - MOI 16      = NEW 8 + ASSIGNED 8      — "đã phân công" nay đọc ở `assignedToId`,
 *                                            không còn là một bậc của phễu.
 *  - DA_LIEN_HE 18 = CONTACTED 12 + NO_ANSWER 6 — "không nghe máy" là kết quả của MỘT
 *                                            lần gọi, nay nằm ở LeadActivity chứ không
 *                                            phải trạng thái của lead. Dữ liệu mẫu vì
 *                                            thế MẤT dấu "gọi không ai bắt máy".
 *  - DA_MAT 8    = LOST 8                  — DUPLICATE không có trong phễu này.
 *
 * Bậc DANG_HOC_THU (mới) cố ý KHÔNG có mặt: phễu cũ không sinh TRIAL_IN_PROGRESS bao
 * giờ, thêm vào đây là tự chế phân bố mới. Xem ghi chú bàn giao.
 */
const PHEU = [
  { s: "MOI" as const, w: 16 },
  { s: "DA_LIEN_HE" as const, w: 18 },
  { s: "DANG_TU_VAN" as const, w: 14 },
  { s: "DA_HEN_HOC_THU" as const, w: 10 },
  { s: "DA_HOC_THU" as const, w: 8 },
  { s: "CHO_QUYET_DINH" as const, w: 6 },
  { s: "DA_DANG_KY" as const, w: 12 },
  { s: "DANG_NUOI_DUONG" as const, w: 8 },
  { s: "DA_MAT" as const, w: 8 },
];
const TONG_W = PHEU.reduce((a, b) => a + b.w, 0);

function trangThai(r: number) {
  let x = r * TONG_W;
  for (const p of PHEU) {
    x -= p.w;
    if (x <= 0) return p.s;
  }
  return "MOI" as const;
}

const NGUON = ["Facebook Ads", "Messenger Page HO", "Giới thiệu", "Vãng lai", "Google",
  "Zalo OA", "Sự kiện trường học", "Website", "Tờ rơi", "Quà tặng"];
const UTM_SRC = ["facebook", "google", "zalo", "direct", "referral"];
const GHI_CHU = [
  "Phụ huynh quan tâm lớp cuối tuần, con đang học lớp 3.",
  "Hỏi học phí và lịch khai giảng gần nhất.",
  "Đã gửi brochure qua Zalo, hẹn gọi lại cuối tuần.",
  "Nhà gần cơ sở, muốn cho con học thử trước.",
  "Con từng học Scratch, muốn nâng lên robot.",
  "Bận, hẹn liên hệ lại sau 19h.",
  "So sánh với trung tâm khác, cần tư vấn kỹ về lộ trình.",
  "Hai bé sinh đôi, hỏi ưu đãi anh chị em.",
  "Quan tâm lớp luyện thi RoboSim.",
  "Đã đóng cọc giữ chỗ, chờ xếp lớp.",
];
const VIEC = [
  "Gọi lại tư vấn lộ trình", "Gửi báo giá qua Zalo", "Mời tham gia buổi học thử",
  "Nhắc lịch học thử", "Chốt đơn sau học thử", "Chăm sóc lại sau 2 tuần",
];

export async function seedCrm(
  coSo: CoSo[],
  uat: Uat,
  /**
   * Khoá học của bộ nền — để gán `interestedCourseId` cho từng con.
   *
   * Thiếu nó thì cột "Khoá học" ở bảng Trial của site giáo viên rỗng 100% dòng, và QA
   * vòng 1 đọc ra thành "cột chưa nối API" (BUG-038) rồi đề nghị ẩn đi. Cột ĐÃ nối
   * đúng (`leadChild.interestedCourseId` → lib/lms/teacher-schedule.ts); thứ thiếu là
   * dữ liệu seed.
   */
  khoaHoc: { id: string }[] = [],
) {
  const rng = makeRng(2002);
  const SO_LEAD = MOI_CO_SO;

  buoc("Lead + con + dòng thời gian + việc cần làm");

  const leads: CoId<Prisma.LeadCreateManyInput>[] = [];
  const children: CoId<Prisma.LeadChildCreateManyInput>[] = [];
  const acts: CoId<Prisma.LeadActivityCreateManyInput>[] = [];
  const tasks: CoId<Prisma.LeadTaskCreateManyInput>[] = [];

  let stt = 0;
  for (const cs of coSo) {
    const sale = saleCua(uat, cs);
    for (let i = 1; i <= SO_LEAD; i++) {
      stt += 1;
      const id = uid("lead", cs.code, i);
      const st = trangThai(rng());
      const caBien = chance(rng, TI_LE_CA_BIEN);

      // Lead càng ở cuối phễu thì càng "già" — để màn báo cáo có dải thời gian thật.
      const tuoiNgay = int(rng, 0, 120);
      const taoLuc = ngay(-tuoiNgay);
      const gt = chance(rng, 0.5) ? "MALE" : "FEMALE";
      const tenPh = tenNguoi(rng, chance(rng, 0.7) ? "FEMALE" : "MALE");
      const soCon = chance(rng, 0.15) ? 2 : 1;

      // Ca biên: lead CHƯA GÁN AI (nằm ở hàng chờ bàn giao) và lead DÙNG CHUNG.
      const chuaGan = caBien && chance(rng, 0.4);
      const dungChung = caBien && !chuaGan && chance(rng, 0.5);

      // Danh sách cũ liệt kê "mọi bậc trừ NEW và ASSIGNED"; hai bậc đó nay gộp thành MOI
      // nên viết thẳng thành phép so sánh — vừa đúng y như cũ, vừa được tsc canh (mảng
      // chuỗi + .includes() không báo lỗi khi enum đổi, sẽ âm thầm cho ra false).
      const daLienHe = st !== "MOI";

      leads.push({
        id,
        parentName: tenPh,
        // SĐT chuẩn `84…` — đừng đổi sang `0…`, `lib/phone.ts` chuẩn hoá về 84.
        phone: sdt(10_000_000 + stt),
        email: chance(rng, 0.45) ? `ph.uat${stt}@example.com` : null,
        childName: null, // tên con nằm ở LeadChild (nguồn thật); cột này là bản sao cũ
        childAge: int(rng, 6, 14),
        centerId: cs.centerId,
        courseId: null,
        assignedToId: chuaGan ? null : sale.id,
        assignedAt: chuaGan ? null : ngay(-tuoiNgay + 1),
        firstContactAt: daLienHe ? ngay(-tuoiNgay + 2) : null,
        qualifiedAt: daLienHe ? ngay(-tuoiNgay + 2) : null,
        status: st,
        source: pick(rng, NGUON),
        utmSource: pick(rng, UTM_SRC),
        utmMedium: chance(rng, 0.5) ? "cpc" : "organic",
        utmCampaign: chance(rng, 0.4) ? `khaigiang-t${int(rng, 1, 12)}` : null,
        note: pick(rng, GHI_CHU),
        consentMarketing: chance(rng, 0.8),
        isSharedWithTeam: dungChung,
        sharedAt: dungChung ? ngay(-tuoiNgay + 3) : null,
        sharedById: dungChung ? sale.id : null,
        lastActivityAt: ngay(-int(rng, 0, Math.max(1, tuoiNgay))),
        createdAt: taoLuc,
        // ENROLLED và REGISTERED nay chung một bậc DA_DANG_KY; thứ phân biệt "đã chốt
        // hẳn" với "mới ghi đăng ký" là convertedAt. Phễu này chỉ sinh lead đã chốt nên
        // mọi DA_DANG_KY đều có convertedAt.
        convertedAt: st === "DA_DANG_KY" ? ngay(-int(rng, 0, Math.max(1, tuoiNgay - 3))) : null,
        convertedById: st === "DA_DANG_KY" ? sale.id : null,
      });

      for (let c = 0; c < soCon; c++) {
        children.push({
          id: uid("leadchild", cs.code, i, c),
          leadId: id,
          fullName: tenNguoi(rng, gt),
          ageYears: int(rng, 6, 14),
          gender: gt,
          gradeLevel: `Lớp ${int(rng, 1, 9)}`,
          interestedCenterId: cs.centerId,
          interestedCourseId: khoaHoc.length ? pick(rng, khoaHoc).id : null,
        });
      }

      // Dòng thời gian: lead đã liên hệ thì có 2–4 hoạt động, lead mới có 1.
      const soAct = daLienHe ? int(rng, 2, 4) : 1;
      for (let a = 0; a < soAct; a++) {
        acts.push({
          id: uid("leadact", cs.code, i, a),
          leadId: id,
          actorName: chuaGan ? "Hệ thống" : (sale.name ?? sale.email ?? "Sale"),
          type: a === 0 ? "NOTE" : pick(rng, ["CALL", "MESSAGE", "NOTE", "STATUS_CHANGE"] as const),
          content: a === 0 ? "Lead vào hệ thống." : pick(rng, GHI_CHU),
          createdAt: ngay(-tuoiNgay + a),
        });
      }

      // Việc cần làm: 1/3 số lead, một phần CỐ Ý quá hạn để màn nhắc việc có màu đỏ.
      if (chance(rng, 0.34)) {
        const quaHan = chance(rng, 0.35);
        tasks.push({
          id: uid("leadtask", cs.code, i),
          leadId: id,
          title: pick(rng, VIEC),
          dueAt: quaHan ? ngay(-int(rng, 1, 10)) : ngay(int(rng, 1, 14)),
          status: !quaHan && chance(rng, 0.3) ? "DONE" : "OPEN",
          completedAt: null,
          assignedToId: chuaGan ? null : sale.id,
          assignedToName: chuaGan ? null : (sale.name ?? sale.email ?? "Sale"),
          createdAt: ngay(-tuoiNgay + 1),
        });
      }
    }
  }

  const nLead = await taoThieu(
    leads,
    (ids) => db.lead.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.lead.createMany({ data, skipDuplicates: true }),
  );
  const nChild = await taoThieu(
    children,
    (ids) => db.leadChild.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.leadChild.createMany({ data, skipDuplicates: true }),
  );
  const nAct = await taoThieu(
    acts,
    (ids) => db.leadActivity.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.leadActivity.createMany({ data, skipDuplicates: true }),
  );
  const nTask = await taoThieu(
    tasks,
    (ids) => db.leadTask.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.leadTask.createMany({ data, skipDuplicates: true }),
  );
  xong("CRM", { lead: nLead, con: nChild, hoạt_động: nAct, việc: nTask });

  // ── Nguồn giới thiệu (affiliate) ───────────────────────────────────────────
  buoc("Nguồn giới thiệu");
  const affs: CoId<Prisma.AffiliateCreateManyInput>[] = [];
  for (const cs of coSo) {
    for (let i = 1; i <= 12; i++) {
      affs.push({
        id: uid("aff", cs.code, i),
        code: `AF${cs.code}${String(i).padStart(3, "0")}`,
        name: tenNguoi(rng, chance(rng, 0.5) ? "MALE" : "FEMALE"),
        phone: sdt(20_000_000 + (cs.key === "CS1" ? 0 : 100) + i),
        centerId: cs.centerId,
        isActive: !chance(rng, 0.15),
        note: pick(rng, ["Phụ huynh giới thiệu", "Cộng tác viên", "Giáo viên trường liên kết"]),
      });
    }
  }
  const nAff = await taoThieu(
    affs,
    (ids) => db.affiliate.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.affiliate.createMany({ data, skipDuplicates: true }),
  );
  xong("Nguồn giới thiệu", nAff);

  // Trả về lead ĐÃ CHỐT để bước học vụ dựng học viên bám đúng nguồn lead.
  // Lọc theo convertedAt chứ không theo bậc phễu: DA_DANG_KY gộp cả ENROLLED lẫn
  // REGISTERED, mà "đã chốt" là ENROLLED cũ — dấu duy nhất còn phân biệt được là
  // convertedAt. Ở bộ seed này hai cách lọc cho cùng kết quả.
  const daChot = leads
    .filter((l) => l.convertedAt != null)
    .map((l) => ({ id: String(l.id), centerId: String(l.centerId), phone: String(l.phone), parentName: String(l.parentName) }));
  return { daChot, tongLead: leads.length, shuffle: (xs: string[]) => shuffle(rng, xs) };
}
