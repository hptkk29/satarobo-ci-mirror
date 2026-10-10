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
 * mọi cột tên `leadId`/`primaryLeadId`/`leadChildId`; có cột nào ngoài danh sách ⇒ ném lỗi.
 * Thêm bảng mới mà quên khai ở đây thì hàm từ chối chạy, chứ không bỏ sót dữ liệu im lặng.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { SYSTEM_ACTIVITY_META } from "./activity-clock";
import { recordLeadActivity } from "./activity-write";
import { thuHoiChuongLeadCu } from "./assign-lead";
import { doiLeadChoDanhTinh } from "@/lib/inbox/gop-lead";
import { isSameChildName } from "./intake/normalize";

export type CachGopCon = "chuyen" | "thay-ban-trung-rong" | "gop-vao-con-co-san";

export type KeHoachGop = {
  daGhi: boolean;
  phu: { id: string; parentName: string; assignedToId: string | null };
  chinh: { id: string; parentName: string };
  /** Số dòng đổi `leadId` theo từng bảng. */
  bangDoi: Record<string, number>;
  con: { ten: string; cach: CachGopCon }[];
};

type Tx = Prisma.TransactionClient;

/** Cột trỏ vào lead/bé mà hàm này XỬ LÝ. Ngoài tập này ⇒ dừng. */
const COT_DA_BIET = new Set([
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
  // Có trên `test` (PR #408), chưa có trên `main` — xử lý bằng SQL tĩnh, chỉ khi cột tồn tại.
  "Student.leadId",
  "Student.leadChildId",
]);

const MOC_LUI = "__GOP_LEAD_CHAY_THU__";

function khoaSdt(p: string): string {
  return p.replace(/\D/g, "").slice(-9);
}

async function cotTroVaoLead(tx: Tx): Promise<Set<string>> {
  const rows = await tx.$queryRaw<{ t: string; c: string }[]>`
    SELECT table_name AS t, column_name AS c
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('leadId', 'primaryLeadId', 'leadChildId')
  `;
  return new Set(rows.map((r) => `${r.t}.${r.c}`));
}

/** Số liên kết đang trỏ vào một bé. */
async function demLienKetCon(tx: Tx, childId: string, coStudent: boolean): Promise<number> {
  const [a, b, c, d] = await Promise.all([
    tx.order.count({ where: { leadChildId: childId } }),
    tx.enrollment.count({ where: { leadChildId: childId } }),
    tx.trialEnrollment.count({ where: { leadChildId: childId } }),
    tx.leadTrialHistory.count({ where: { leadChildId: childId } }),
  ]);
  let s = 0;
  if (coStudent) {
    const r = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "Student" WHERE "leadChildId" = ${childId}
    `;
    s = Number(r[0]?.n ?? 0);
  }
  return a + b + c + d + s;
}

/** Dời mọi liên kết từ bé `tu` sang bé `vao`. */
async function doiLienKetCon(tx: Tx, tu: string, vao: string, coStudent: boolean): Promise<void> {
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
  if (coStudent) {
    await tx.$executeRaw`UPDATE "Student" SET "leadChildId" = ${vao} WHERE "leadChildId" = ${tu}`;
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

async function xoaConKhiRong(tx: Tx, childId: string, coStudent: boolean): Promise<void> {
  const conLai = await demLienKetCon(tx, childId, coStudent);
  if (conLai > 0) {
    throw new Error(`Bé ${childId} còn ${conLai} liên kết — không xoá (xoá sẽ kéo theo lịch sử học thử).`);
  }
  await tx.leadChild.delete({ where: { id: childId } });
}

async function gopTrongGiaoDich(
  tx: Tx,
  input: { phuId: string; chinhId: string; actorName: string },
): Promise<Omit<KeHoachGop, "daGhi">> {
  const { phuId, chinhId, actorName } = input;
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
  const coStudent = cot.has("Student.leadChildId");

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
    if ((await demLienKetCon(tx, trung.id, coStudent)) === 0) {
      // Ca prod: bản ở lead chính là bản Sale gõ tay, rỗng ⇒ bản ở lead phụ là bản thật.
      const bu: Record<string, unknown> = {};
      for (const k of O_BU_CON) if (be[k] == null && trung[k] != null) bu[k] = trung[k];
      await xoaConKhiRong(tx, trung.id, coStudent);
      await tx.leadChild.update({
        where: { id: be.id },
        data: { leadId: chinhId, ...(bu as Prisma.LeadChildUncheckedUpdateInput) },
      });
      con.push({ ten: be.fullName, cach: "thay-ban-trung-rong" });
    } else {
      await doiLienKetCon(tx, be.id, trung.id, coStudent);
      const bu: Record<string, unknown> = {};
      for (const k of O_BU_CON) if (trung[k] == null && be[k] != null) bu[k] = be[k];
      if (Object.keys(bu).length > 0) {
        await tx.leadChild.update({
          where: { id: trung.id },
          data: bu as Prisma.LeadChildUncheckedUpdateInput,
        });
      }
      await xoaConKhiRong(tx, be.id, coStudent);
      con.push({ ten: be.fullName, cach: "gop-vao-con-co-san" });
    }
  }

  // ── 2. Mọi bảng trỏ vào lead ──────────────────────────────────────────────────
  const w = { where: { leadId: phuId }, data: { leadId: chinhId } };
  const bangDoi: Record<string, number> = {
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
    con,
  };
}

/**
 * Gộp lead `phuId` vào lead `chinhId`. `apply: false` = chạy thử (ghi rồi lùi toàn bộ).
 * Ném lỗi ⇒ không có gì đổi (một giao dịch duy nhất).
 */
export async function gopLead(
  db: PrismaClient,
  input: { phuId: string; chinhId: string; apply: boolean; actorName: string },
): Promise<KeHoachGop> {
  let keHoach: Omit<KeHoachGop, "daGhi"> | null = null;
  try {
    await db.$transaction(
      async (tx) => {
        keHoach = await gopTrongGiaoDich(tx, input);
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
