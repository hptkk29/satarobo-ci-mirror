/**
 * lib/lead/gop-lead.ts — GỘP HAI LEAD CỦA CÙNG MỘT GIA ĐÌNH (lead phụ → lead chính).
 *
 * Sinh ra từ sự cố prod 26/09/2026 (0368829724): luật chống trùng cũ coi hồ sơ ĐÃ ĐĂNG KÝ
 * là "đã đóng" nên phiếu của bé thứ hai đẻ lead thứ hai, rồi đơn thứ hai. Luật đã vá
 * (`lib/lead/dedup.ts`), còn cặp đã sinh ra thì dọn bằng hàm này. Chủ dự án chốt:
 * **gộp hai lead, GIỮ NGUYÊN các đơn** — đơn không bị gộp, không bị sửa tiền, chỉ đổi
 * `Order.leadId` sang lead chính.
 *
 * ── Hàm này KHÔNG đụng ─────────────────────────────────────────────────────────────
 * Tiền, phiếu thu, QR, kế hoạch trả góp: không bảng nào trong số đó trỏ vào lead. Đơn giữ
 * nguyên mã, số tiền, phiếu; chỉ đổi hồ sơ mà nó thuộc về.
 *
 * ── Luật với BÉ TRÙNG TÊN ở hai lead (so tên đã bỏ dấu, `isSameChildName`) ─────────
 *   · bản ở lead chính KHÔNG có gì trỏ tới (Sale thêm tay — đúng ca prod) ⇒ xoá bản rỗng đó,
 *     DỜI nguyên bản ghi bé ở lead phụ sang: mọi đơn/lịch học thử trỏ vào nó giữ nguyên id.
 *   · cả hai bản đều có liên kết ⇒ giữ bản ở lead chính, dời liên kết của bản kia sang, bù
 *     ô trống của bản giữ từ bản kia, rồi xoá bản kia (khi đã hết liên kết).
 *   `LeadChild` không có xoá mềm và xoá nó KÉO THEO lịch sử học thử (Cascade) ⇒ chỉ xoá
 *   một bản sau khi đã đếm lại được 0 liên kết; còn thì ném lỗi, cả giao dịch lùi.
 *
 * ── Chạy thử = chạy thật rồi LÙI ───────────────────────────────────────────────────
 * `apply: false` đi CÙNG một đường ghi trong transaction rồi ném mốc để rollback — con số
 * in ra là con số của phép ghi thật, không phải một phép đếm song song có thể lệch.
 *
 * ── Bảng lạ ⇒ DỪNG ────────────────────────────────────────────────────────────────
 * Danh sách bảng trỏ vào lead viết TAY ở dưới. Trước khi ghi, hàm hỏi `information_schema`
 * mọi cột tên `leadId`/`primaryLeadId`/`leadChildId`/`inheritedFromLeadId`; có cột nào ngoài danh sách ⇒ ném lỗi.
 * Thêm bảng mới mà quên khai ở đây thì hàm từ chối chạy, chứ không bỏ sót dữ liệu im lặng.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { SYSTEM_ACTIVITY_META } from "./activity-clock";
import { recordLeadActivity } from "./activity-write";
import { thuHoiChuongLeadCu } from "./assign-lead";
import { doiLeadChoDanhTinh } from "@/lib/inbox/gop-lead";
import { isSameChildName } from "./intake/normalize";
import { coDauVaoTaiChinh, docDauVaoTaiChinh } from "@/lib/nguon/dau-vao-tai-chinh";
import { gopNguonLead } from "@/lib/nguon/ghi-nguon";
import { CongGhiTuChoi } from "@/lib/security/cong-ghi-wave1";
import { tinhDigestDauRa } from "@/lib/security/phe-duyet-ghi";

export type CachGopCon = "chuyen" | "thay-ban-trung-rong" | "gop-vao-con-co-san";

export type KeHoachGop = {
  daGhi: boolean;
  phu: { id: string; parentName: string; assignedToId: string | null };
  chinh: { id: string; parentName: string };
  /** Số dòng đổi `leadId` theo từng bảng. */
  bangDoi: Record<string, number>;
  /** Nguồn lead (07 §2.6.5): cách xử lý quy nguồn + mã nhóm của lead chính trước/sau. */
  nguon: {
    cach: "KHONG_CO" | "DOI_DONG_PHU" | "CHINH_GIU" | "PHU_THANG";
    truoc: string | null;
    sau: string | null;
  };
  con: { ten: string; cach: CachGopCon }[];
};

type Tx = Prisma.TransactionClient;

/** Cột trỏ vào lead/bé mà hàm này XỬ LÝ. Ngoài tập này ⇒ dừng. */
const COT_DA_BIET = new Set([
  // AFF-P1 — referral Affiliate gắn lead: dời theo lead chính (lịch sử «ai giới thiệu khách này» không được mồ côi). `AffiliateReferral.idempotencyKey` đã chống gửi lặp nên dời không đụng khoá duy nhất.
  "AffiliateReferral.leadId",
  "CommissionLine.leadId",
  "ConvertConflict.leadId",
  "InboxIdentity.leadId",
  "LeadActivity.leadId",
  "LeadAssignmentHistory.leadId",
  "LeadAssignmentLog.leadId",
  "LeadAuditLog.leadId",
  "LeadStatusHistory.leadId",
  "LeadTask.leadId",
  "LeadTransfer.leadId",
  "MessengerConversation.leadId",
  "Note.leadId",
  "Order.leadId",
  "TrialClass.leadId",
  "ZaloCrmThread.leadId",
  "LeadDuplicate.primaryLeadId",
  "LeadChild.leadId",
  "Order.leadChildId",
  "Enrollment.leadChildId",
  "TrialEnrollment.leadChildId",
  "LeadTrialHistory.leadChildId",
  // 08/10/2026 — nguồn lead (docs/source-commission/07 §2.6.4). KHÔNG `updateMany` mù:
  // `LeadAttribution.leadId` là @unique ⇒ đi qua `gopNguonLead` ở lib/nguon/ghi-nguon.ts.
  "LeadAttribution.leadId",
  "LeadTouchpoint.leadId",
  // [F1] Cột trỏ vào Lead mà tên KHÔNG có "leadId" — nên phải nằm trong mẫu quét ở `cotTroVaoLead` VÀ ở đây.
  // Xử lý bằng `gopNguonLead` (→ `doiThamChieuKeThua`), KHÔNG `updateMany` mù. (`LeadTouchpoint.leadDuplicateId`
  // KHÔNG phải cột trỏ Lead: nó trỏ `LeadDuplicate.id`, không FK — không thuộc lưới này.)
  "LeadAttribution.inheritedFromLeadId",
  // SỔ HOA HỒNG (PR5a). KHAI nhưng KHÔNG ĐỔI: `CommissionTransaction.leadId` là ẢNH CHỤP lúc tính (lịch sử),
  // trigger `hoa_hong_so_bat_bien` cũng chặn UPDATE. Khác `CommissionLine.leadId` ở trên — dòng cũ còn bị `updateMany`.
  "CommissionTransaction.leadId",
  // ĐỀ XUẤT ĐIỀU CHỈNH (hướng B+C): `leadId` là ẢNH CHỤP của đề xuất đổi nguồn, KHÔNG có khoá ngoại; lead phụ chỉ bị xoá MỀM nên vẫn đọc được. KHAI nhưng KHÔNG đổi (như dòng trên).
  "CommissionAdjustmentRequest.leadId",
  // Có trên `test` (PR #408), chưa có trên `main` — xử lý bằng SQL tĩnh, chỉ khi cột tồn tại.
  "Student.leadId",
  "Student.leadChildId",
  // Bảng chờ của quyền học (PR nối đường tiền): dòng CHO_CHUYEN_DOI giữ `leadChildId` để hook sau Chuyển đổi
  // tìm đúng học viên ⇒ gộp bé phải dời theo, kẻo dòng chờ trỏ vào bé đã xoá và không bao giờ đóng được.
  "StudyEntitlementXuLy.leadChildId",
]);

/** Cột chỉ xử lý khi bảng tồn tại: bảng thêm bằng migration tay, prod có thể chưa chạy. */
type CoBang = { student: boolean; xuLy: boolean };

const MOC_LUI = "__GOP_LEAD_CHAY_THU__";

function khoaSdt(p: string): string {
  return p.replace(/\D/g, "").slice(-9);
}

async function cotTroVaoLead(tx: Tx): Promise<Set<string>> {
  const rows = await tx.$queryRaw<{ t: string; c: string }[]>`
    SELECT table_name AS t, column_name AS c
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('leadId', 'primaryLeadId', 'leadChildId', 'inheritedFromLeadId')
  `;
  return new Set(rows.map((r) => `${r.t}.${r.c}`));
}

/** Số liên kết đang trỏ vào một bé. */
async function demLienKetCon(tx: Tx, childId: string, co: CoBang): Promise<number> {
  const [a, b, c, d] = await Promise.all([
    tx.order.count({ where: { leadChildId: childId } }),
    tx.enrollment.count({ where: { leadChildId: childId } }),
    tx.trialEnrollment.count({ where: { leadChildId: childId } }),
    tx.leadTrialHistory.count({ where: { leadChildId: childId } }),
  ]);
  let s = 0;
  if (co.student) {
    const r = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "Student" WHERE "leadChildId" = ${childId}
    `;
    s = Number(r[0]?.n ?? 0);
  }
  if (co.xuLy) {
    const r = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "StudyEntitlementXuLy" WHERE "leadChildId" = ${childId}
    `;
    s += Number(r[0]?.n ?? 0);
  }
  return a + b + c + d + s;
}

/** Dời mọi liên kết từ bé `tu` sang bé `vao`. */
async function doiLienKetCon(tx: Tx, tu: string, vao: string, co: CoBang): Promise<void> {
  // `LeadTrialHistory` khoá (leadChildId, trialClassId): cùng một lớp học thử ở cả hai bản
  // thì không dời được mà không mất một dòng ⇒ dừng cho người xem.
  const [lopTu, lopVao] = await Promise.all([
    tx.leadTrialHistory.findMany({ where: { leadChildId: tu }, select: { trialClassId: true } }),
    tx.leadTrialHistory.findMany({ where: { leadChildId: vao }, select: { trialClassId: true } }),
  ]);
  const daCo = new Set(lopVao.map((l) => l.trialClassId));
  if (lopTu.some((l) => daCo.has(l.trialClassId))) {
    throw new Error("Hai bản của cùng một bé đều có lịch sử ở CÙNG một lớp học thử — cần xem tay.");
  }
  await tx.order.updateMany({ where: { leadChildId: tu }, data: { leadChildId: vao } });
  await tx.enrollment.updateMany({ where: { leadChildId: tu }, data: { leadChildId: vao } });
  await tx.trialEnrollment.updateMany({ where: { leadChildId: tu }, data: { leadChildId: vao } });
  await tx.leadTrialHistory.updateMany({ where: { leadChildId: tu }, data: { leadChildId: vao } });
  if (co.student) {
    await tx.$executeRaw`UPDATE "Student" SET "leadChildId" = ${vao} WHERE "leadChildId" = ${tu}`;
  }
  if (co.xuLy) {
    // Khoá duy nhất là (orderItemId, loai) — không gồm `leadChildId`, nên dời không bao giờ va khoá.
    await tx.$executeRaw`UPDATE "StudyEntitlementXuLy" SET "leadChildId" = ${vao} WHERE "leadChildId" = ${tu}`;
  }
}

/** Ô trống của bé giữ lại được bù từ bé bị gộp — không mất dữ liệu đã khai. */
const O_BU_CON = [
  "dob",
  "ageYears",
  "gender",
  "schoolName",
  "gradeLevel",
  "interestedCourseId",
  "interestedCenterId",
  "classId",
  "note",
] as const;

async function xoaConKhiRong(tx: Tx, childId: string, co: CoBang): Promise<void> {
  const conLai = await demLienKetCon(tx, childId, co);
  if (conLai > 0) {
    throw new Error(`Bé ${childId} còn ${conLai} liên kết — không xoá (xoá sẽ kéo theo lịch sử học thử).`);
  }
  await tx.leadChild.delete({ where: { id: childId } });
}

async function gopTrongGiaoDich(
  tx: Tx,
  input: { phuId: string; chinhId: string; actorName: string; actorUserId: string | null },
): Promise<Omit<KeHoachGop, "daGhi">> {
  const { phuId, chinhId, actorName, actorUserId } = input;
  if (phuId === chinhId) throw new Error("Không gộp một lead vào chính nó.");

  const [phu, chinh] = await Promise.all([
    tx.lead.findFirst({ where: { id: phuId, deletedAt: null } }),
    tx.lead.findFirst({ where: { id: chinhId, deletedAt: null } }),
  ]);
  if (!phu) throw new Error(`Không thấy lead phụ ${phuId} (hoặc đã xoá).`);
  if (!chinh) throw new Error(`Không thấy lead chính ${chinhId} (hoặc đã xoá).`);
  if (khoaSdt(phu.phone) === "" || khoaSdt(phu.phone) !== khoaSdt(chinh.phone)) {
    throw new Error("Hai lead khác số điện thoại — không phải cùng một gia đình, từ chối gộp.");
  }

  const cot = await cotTroVaoLead(tx);
  const la = [...cot].filter((c) => !COT_DA_BIET.has(c));
  if (la.length > 0) {
    throw new Error(`Có cột trỏ vào lead mà hàm gộp chưa biết: ${la.join(", ")}. Khai vào COT_DA_BIET rồi chạy lại.`);
  }
  const co: CoBang = {
    student: cot.has("Student.leadChildId"),
    xuLy: cot.has("StudyEntitlementXuLy.leadChildId"),
  };

  // ── 1. Các bé ─────────────────────────────────────────────────────────────────
  const [conPhu, conChinh] = await Promise.all([
    tx.leadChild.findMany({ where: { leadId: phuId }, orderBy: { createdAt: "asc" } }),
    tx.leadChild.findMany({ where: { leadId: chinhId }, orderBy: { createdAt: "asc" } }),
  ]);
  const con: KeHoachGop["con"] = [];
  const daGhep = new Set<string>();
  for (const be of conPhu) {
    const trung = conChinh.find((c) => !daGhep.has(c.id) && isSameChildName(c.fullName, be.fullName));
    if (!trung) {
      await tx.leadChild.update({ where: { id: be.id }, data: { leadId: chinhId } });
      con.push({ ten: be.fullName, cach: "chuyen" });
      continue;
    }
    daGhep.add(trung.id);
    if ((await demLienKetCon(tx, trung.id, co)) === 0) {
      // Ca prod: bản ở lead chính là bản Sale gõ tay, rỗng ⇒ bản ở lead phụ là bản thật.
      const bu: Record<string, unknown> = {};
      for (const k of O_BU_CON) if (be[k] == null && trung[k] != null) bu[k] = trung[k];
      await xoaConKhiRong(tx, trung.id, co);
      await tx.leadChild.update({
        where: { id: be.id },
        data: { leadId: chinhId, ...(bu as Prisma.LeadChildUncheckedUpdateInput) },
      });
      con.push({ ten: be.fullName, cach: "thay-ban-trung-rong" });
    } else {
      await doiLienKetCon(tx, be.id, trung.id, co);
      const bu: Record<string, unknown> = {};
      for (const k of O_BU_CON) if (trung[k] == null && be[k] != null) bu[k] = be[k];
      if (Object.keys(bu).length > 0) {
        await tx.leadChild.update({
          where: { id: trung.id },
          data: bu as Prisma.LeadChildUncheckedUpdateInput,
        });
      }
      await xoaConKhiRong(tx, be.id, co);
      con.push({ ten: be.fullName, cach: "gop-vao-con-co-san" });
    }
  }

  // ── 2. Mọi bảng trỏ vào lead ──────────────────────────────────────────────────
  // Lead phụ có khoản thu THỰC không? Đo TRƯỚC khi đơn dời sang lead chính: sau đó không còn phân biệt được khoản của bên nào. Dùng cho cổng duyệt đổi nguồn sau thu (`gopNguonLead`).
  // «Có tiền» = thực thu HOẶC đã có sổ hoa hồng (khoản đang tạm rời thực thu vẫn để lại tiền trong sổ) — cùng định nghĩa với `doiNguonLead`.
  const phuCoTienThuc = coDauVaoTaiChinh(await docDauVaoTaiChinh(tx, phuId));
  const w = { where: { leadId: phuId }, data: { leadId: chinhId } };
  const bangDoi: Record<string, number> = {
    AffiliateReferral: (await tx.affiliateReferral.updateMany(w)).count,
    CommissionLine: (await tx.commissionLine.updateMany(w)).count,
    ConvertConflict: (await tx.convertConflict.updateMany(w)).count,
    InboxIdentity: await doiLeadChoDanhTinh(tx, phuId, chinhId),
    LeadActivity: (await tx.leadActivity.updateMany(w)).count,
    LeadAssignmentHistory: (await tx.leadAssignmentHistory.updateMany(w)).count,
    LeadAssignmentLog: (await tx.leadAssignmentLog.updateMany(w)).count,
    LeadAuditLog: (await tx.leadAuditLog.updateMany(w)).count,
    LeadStatusHistory: (await tx.leadStatusHistory.updateMany(w)).count,
    LeadTask: (await tx.leadTask.updateMany(w)).count,
    LeadTransfer: (await tx.leadTransfer.updateMany(w)).count,
    MessengerConversation: (await tx.messengerConversation.updateMany(w)).count,
    Note: (await tx.note.updateMany(w)).count,
    Order: (await tx.order.updateMany(w)).count,
    TrialClass: (await tx.trialClass.updateMany(w)).count,
    ZaloCrmThread: (await tx.zaloCrmThread.updateMany(w)).count,
    LeadDuplicate: (
      await tx.leadDuplicate.updateMany({
        where: { primaryLeadId: phuId },
        data: { primaryLeadId: chinhId },
      })
    ).count,
  };
  if (cot.has("Student.leadId")) {
    bangDoi.Student = await tx.$executeRaw`UPDATE "Student" SET "leadId" = ${chinhId} WHERE "leadId" = ${phuId}`;
  }
  // Nguồn lead: touchpoint dời hết sang lead chính; quy nguồn theo first-claim (không `updateMany` mù).
  const nguon = await gopNguonLead(tx, { phuId, chinhId, actorName, actorId: actorUserId, phuCoTienThuc });
  bangDoi.LeadTouchpoint = nguon.touchpointDoi;
  bangDoi.LeadAttribution = nguon.cach === "DOI_DONG_PHU" || nguon.cach === "PHU_THANG" ? 1 : 0;
  // [F1] Dòng quy nguồn của lead KHÁC đang trỏ `inheritedFromLeadId` vào lead phụ ⇒ trỏ sang lead chính.
  bangDoi.LeadAttributionKeThua = nguon.keThuaDoi;

  // ── 3. Ghi dấu trên lead chính. Xoá mềm lead phụ nằm ở `gopLead`, cạnh bước thu hồi
  //       chuông — luật B (`doi-chu-phai-dong-bo-chuong.test.ts`) soi theo từng hàm.
  const tomTat = Object.entries(bangDoi)
    .filter(([, n]) => n > 0)
    .map(([b, n]) => `${b} ${n}`)
    .join(", ");
  const dongCon = con.map((c) => `${c.ten} (${c.cach})`).join(", ");
  await recordLeadActivity({
    tx,
    leadId: chinhId,
    actorName,
    type: "NOTE",
    content:
      `[Gộp lead] Đã gộp lead "${phu.parentName}" (${phuId}, tạo ${phu.createdAt.toISOString().slice(0, 10)}) vào lead này.` +
      ` Dời: ${tomTat || "không có dòng nào"}.` +
      (dongCon ? ` Con: ${dongCon}.` : "") +
      (phu.note ? `\nGhi chú của lead cũ:\n${phu.note}` : ""),
    metadata: SYSTEM_ACTIVITY_META,
  });

  return {
    phu: { id: phu.id, parentName: phu.parentName, assignedToId: phu.assignedToId },
    chinh: { id: chinh.id, parentName: chinh.parentName },
    bangDoi,
    nguon: { cach: nguon.cach, truoc: nguon.truoc, sau: nguon.sau },
    con,
  };
}

/**
 * Gộp lead `phuId` vào lead `chinhId`. `apply: false` = chạy thử (ghi rồi lùi toàn bộ).
 * `actorUserId` BẮT BUỘC (luật 7): `User.id` của NGƯỜI ĐỀ XUẤT khi gộp làm đổi cách tính hoa hồng của lead đã thu tiền (cổng duyệt đổi nguồn sau thu cần một người để tách
 * nhiệm); `null` = không có User (script) và CHỈ hợp lệ khi lượt gộp không làm đổi tiền của khoản đã thu — ngược lại NÉM (cả lượt lùi, kể cả chạy thử): sự kiện không có người đề xuất sẽ
 * FAILED mà vẫn giữ cổng "Áp dụng", không đường thoát (xem `baoDoiNguonKhiGop` ở `ghi-nguon.ts`).
 * Ném lỗi ⇒ không có gì đổi (một giao dịch duy nhất).
 */
/**
 * ĐẦU RA CHO OWNER KÝ (cổng ghi Wave 1, `lib/security/cong-ghi-wave1.ts`, tài liệu 15): kế hoạch gộp tách thành các dòng cố định — lead phụ → chính, số dòng dời theo từng bảng, cách xử lý nguồn, số bé theo cách gộp.
 * KHÔNG có tên phụ huynh/bé, SĐT, email (chỉ id, tên bảng, số đếm, mã cách). Chạy thử (`apply:false`) dựng dòng từ kế hoạch ghi-rồi-lùi; lệnh ghi dựng LẠI từ kế hoạch TRONG transaction ghi và so digest trước khi commit.
 */
export function dongDauRaGopLead(kh: Omit<KeHoachGop, "daGhi">): string[] {
  const dong = [`gop-lead/v1|lead|${kh.phu.id}|${kh.chinh.id}`];
  for (const [bang, n] of Object.entries(kh.bangDoi).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (n > 0) dong.push(`gop-lead/v1|bang|${bang}|${n}`);
  }
  dong.push(`gop-lead/v1|nguon|${kh.nguon.cach}|${kh.nguon.truoc ?? ""}|${kh.nguon.sau ?? ""}`);
  const demCon = new Map<string, number>();
  for (const c of kh.con) demCon.set(c.cach, (demCon.get(c.cach) ?? 0) + 1);
  for (const [cach, n] of [...demCon.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) dong.push(`gop-lead/v1|con|${cach}|${n}`);
  return dong;
}

/** Cổng Wave 1 cho `gopLead` — CHỈ có nghĩa khi `apply: true`. `claim` = câu ghi ĐẦU TIÊN của transaction (INSERT `wg:<nonce>`); `dongDaDuyet` = các dòng owner đã ký ở lượt chạy thử. */
export type CongGhiGopLead = {
  claim: (tx: Tx) => Promise<void>;
  dongDaDuyet: readonly string[];
};

export async function gopLead(
  db: PrismaClient,
  input: {
    phuId: string;
    chinhId: string;
    apply: boolean;
    actorName: string;
    actorUserId: string | null;
    /** Script GHI luôn truyền (lưới `[WGB-W*]`); test lõi gộp không đi qua script nên không truyền. KHÔNG dùng ở nơi nào khác. */
    congGhi?: CongGhiGopLead;
  },
): Promise<KeHoachGop> {
  let keHoach: Omit<KeHoachGop, "daGhi"> | null = null;
  try {
    await db.$transaction(
      async (tx) => {
        // Cổng Wave 1: claim là PHÉP GHI ĐẦU TIÊN (trước cả các câu ghi của kế hoạch). Trùng nonce ⇒ NÉM ⇒ lùi cả giao dịch.
        if (input.apply && input.congGhi) await input.congGhi.claim(tx);
        keHoach = await gopTrongGiaoDich(tx, input);
        // Kế hoạch dựng TRONG transaction ghi phải KHỚP đúng các dòng owner đã ký — dữ liệu trôi giữa chạy thử và ghi ⇒ NÉM (lùi), không commit cái chưa ai duyệt.
        if (input.apply && input.congGhi) {
          const that = tinhDigestDauRa(dongDauRaGopLead(keHoach));
          const daDuyet = tinhDigestDauRa(input.congGhi.dongDaDuyet);
          if (that.digest !== daDuyet.digest || that.rowCount !== daDuyet.rowCount) {
            throw new CongGhiTuChoi("LECH_DIGEST", "kế hoạch gộp lúc ghi KHÁC bản owner đã ký (dữ liệu đã đổi sau lượt chạy thử) — transaction lùi, KHÔNG ghi gì.");
          }
        }
        await tx.lead.update({ where: { id: input.phuId }, data: { deletedAt: new Date() } });
        if (!input.apply) throw new Error(MOC_LUI);
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  } catch (e) {
    if (!(e instanceof Error && e.message === MOC_LUI)) throw e;
  }
  if (!keHoach) throw new Error("Gộp lead không trả kế hoạch.");
  const kh: Omit<KeHoachGop, "daGhi"> = keHoach;
  // Lead phụ đã xoá ⇒ chuông "bạn có lead mới" của người đang giữ nó phải thu hồi (luật B).
  // Chỉ SAU khi giao dịch đã lưu — chạy thử mà thu hồi là xoá thông báo thật cho một lần gộp
  // không hề xảy ra.
  if (input.apply) {
    await thuHoiChuongLeadCu({ chuCuId: kh.phu.assignedToId, chuMoiId: null, leadId: input.phuId });
  }
  return { ...kh, daGhi: input.apply };
}
