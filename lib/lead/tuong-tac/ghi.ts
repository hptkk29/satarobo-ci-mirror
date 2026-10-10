/**
 * GHI một dòng vào LỊCH SỬ TƯƠNG TÁC của lead, và LẦN RA `leadId` từ các đối tượng
 * mà Sale thao tác (con lead · đơn · ghi danh · học viên).
 *
 * ── HAI CỬA, CHỌN CÓ CHỦ Ý (luật 7: không mặc định nguy hiểm) ──────────────────────────
 *   · `ghiTuongTacLead(kho, p)` — NÉM nếu ghi thất bại. Dùng khi lịch sử phải đi CÙNG
 *     nghiệp vụ (trong `$transaction`), và caller chấp nhận nghiệp vụ bị cuộn lại.
 *   · `ghiTuongTacLeadBoQuaLoi(p)` — nuốt lỗi + `console.error`. Dùng khi phép ghi CHÍNH
 *     đã xong rồi: các đường chạm tiền (đơn hàng, ghi danh) sau khi transaction commit,
 *     và những đường ghi trần không có transaction nào để mà bám vào. Ở đó nếu lịch sử
 *     ném thì người dùng nhận thông báo lỗi cho một lượt lưu ĐÃ THÀNH CÔNG — họ sẽ bấm
 *     lưu lại, và lượt sau mới là lượt sinh dữ liệu sai.
 *
 * Vì sao phải có cửa thứ hai: theo luật rollback của repo, `throw` trong callback
 * `$transaction` **cuộn lại mọi phép ghi**. Nếu nhét dòng lịch sử vào cùng transaction tạo
 * đơn, thì một lỗi của LỊCH SỬ (thứ phụ) sẽ xoá mất cái ĐƠN (thứ chính). Lịch sử không
 * bao giờ được quyền giết nghiệp vụ tiền.
 *
 * ── VÌ SAO KHÔNG THÊM GIÁ TRỊ VÀO `LeadActivityType` ──────────────────────────────────
 * Chủ dự án chọn **dùng lại `NOTE`**. Đo trên DB dev: `NOTE` đã là nhóm lớn nhất
 * (140/257 dòng) nên không cần migration, và panel đã có nhánh fallback render `content`.
 * Thứ phân biệt dòng-hệ-thống với ghi chú người gõ tay là `metadata.viec` — panel đọc nó
 * để đổi nhãn và biểu tượng, nên dòng tự động KHÔNG đội lốt "Ghi chú" (luật 12: nhãn phải
 * nói thật).
 *
 * ⚠️ KHÔNG set `metadata.text`: panel có nhánh `type === "NOTE" && meta.text` render
 * THẲNG `meta.text` và bỏ qua `content`. Đặt `text` vào là câu mô tả biến mất.
 *
 * ── ⚠️⚠️ VÌ SAO MARKER LÀ `heThong`, KHÔNG PHẢI `system` (QUYẾT ĐỊNH, KHÔNG PHẢI THÓI QUEN)
 * Repo ĐÃ CÓ marker `metadata.system = true` (`lib/lead/auto-assign.ts:45`) cho dòng do
 * MÁY tự sinh, và `hasSaleInteraction()` cùng tệp **cố ý LOẠI** đúng những dòng ấy:
 *
 *     { AND: [{ type: "NOTE" }, { NOT: { metadata: { path: ["system"], equals: true } } }] }
 *
 * Hàm đó gác việc AUTO-CHIA LẠI lead ("lead đã có tương tác của sale ⇒ không chia lại").
 * Nếu dòng ở đây cũng mang `system: true` thì một lead mà Sale đã xếp con vào lớp trải
 * nghiệm, đã tạo đơn, sẽ vẫn bị đếm là "chưa ai tương tác" và **bị máy chia sang Sale
 * khác** — mất đúng công của người đang theo khách.
 *
 * Hai marker trông giống nhau nhưng nói hai việc khác nhau:
 *   · `system: true`   — MÁY làm (auto-chia). Không phải công của Sale.
 *   · `heThong: true`  — SALE làm, hệ thống chỉ chép lại hộ. LÀ công của Sale.
 *
 * Nên đừng "dọn dẹp" bằng cách gộp hai marker về một. Muốn gộp thì phải sửa
 * `hasSaleInteraction` trước, và đó là quyết định về việc chia lead, không phải về đặt tên.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { moTaTuongTac, type SuKienLead } from "./su-kien";

/**
 * Bề mặt tối thiểu mà hàm ghi cần — nhận được cả `db` lẫn `tx` của `$transaction`.
 * Khai hẹp thế này để không ai truyền vào một client có phạm vi rộng hơn mức cần.
 */
export type KhoGhiTuongTac = {
  leadActivity: { create: (args: { data: Prisma.LeadActivityUncheckedCreateInput }) => unknown };
  lead: {
    update: (args: {
      where: { id: string };
      data: { lastActivityAt: Date };
    }) => unknown;
  };
};

export type ThamSoGhi = {
  leadId: string;
  actorId: string | null;
  actorName: string;
  sk: SuKienLead;
  /** Mốc ghi — truyền vào để test không phụ thuộc đồng hồ thật (luật 19). */
  moc: Date;
};

/**
 * Ghi một dòng lịch sử + đẩy `lastActivityAt`.
 *
 * `lastActivityAt` là đồng hồ SLA "bao lâu rồi không ai chạm lead này" — màn
 * `/lead-nguoi` lọc theo nó. Một hành động THẬT của Sale mà không đẩy đồng hồ ấy thì lead
 * vẫn bị đếm là bỏ rơi 90 ngày dù Sale vừa xếp con vào lớp trải nghiệm hôm qua.
 */
export async function ghiTuongTacLead(kho: KhoGhiTuongTac, p: ThamSoGhi): Promise<void> {
  const { viec, ...chiTiet } = p.sk;
  await kho.leadActivity.create({
    data: {
      leadId: p.leadId,
      actorId: p.actorId,
      actorName: p.actorName,
      type: "NOTE",
      content: moTaTuongTac(p.sk),
      // `heThong` để đọc lại được "dòng này do hệ thống ghi" mà không phải suy từ `viec`.
      metadata: { heThong: true, viec, ...phang(chiTiet) } as Prisma.InputJsonValue,
    },
  });
  await kho.lead.update({ where: { id: p.leadId }, data: { lastActivityAt: p.moc } });
}

/**
 * Bản BỎ QUA LỖI — dùng SAU commit trên đường chạm tiền.
 *
 * Nuốt lỗi là có chủ đích, nhưng KHÔNG im lặng: `console.error` để lỗi còn dấu vết trong
 * log Vercel. Không có `tx` ở đây — cố tình, để không ai gọi bản này bên trong transaction
 * rồi tưởng mình đã an toàn (nuốt lỗi trong tx vẫn bỏ lại một transaction đã hỏng).
 */
export async function ghiTuongTacLeadBoQuaLoi(p: ThamSoGhi): Promise<void> {
  try {
    await ghiTuongTacLead(db, p);
  } catch (e) {
    console.error("[lich-su-tuong-tac] khong ghi duoc", { leadId: p.leadId, viec: p.sk.viec }, e);
  }
}

/** `Date` trong metadata → chuỗi ISO, để `Prisma.InputJsonValue` nhận được. */
function phang(o: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    r[k] = v instanceof Date ? v.toISOString() : v;
  }
  return r;
}

// ── LẦN RA `leadId` ───────────────────────────────────────────────────────────────────
// Bốn đường dưới đây là TOÀN BỘ những gì schema cho phép. Đo 18/09/2026:
//   · `LeadChild.leadId`            — trực tiếp.
//   · `Order.leadId`                — trực tiếp (9/507 đơn trên DB dev có giá trị: đúng
//                                     số đơn sinh từ convert; đơn tạo tay không có lead).
//   · `Enrollment.leadChildId`      — gián tiếp qua `LeadChild` (9/531).
//   · `Student`                     — KHÔNG có cột nào trỏ về lead, và `LeadChild` cũng
//                                     KHÔNG có `studentId`. Chỉ lần ra được khi học viên
//                                     ấy có MỘT ghi danh cũ mang `leadChildId`.
//
// ⚠️ TUYỆT ĐỐI KHÔNG "vá" khoảng trống trên bằng cách set `leadChildId` cho ghi danh MỚI.
// Cột đó là đầu vào của báo cáo trial cũ (`/bao-cao/trial`, gỡ 23/09/2026) và của hoa hồng giáo viên dạy
// Trial (`lib/crm/trial-teacher-commission.ts` tính trên TỪNG ghi danh). Gán thêm là thổi
// phồng báo cáo và trả hoa hồng cho một ghi danh thứ hai. Ở đây chỉ ĐỌC.

/**
 * Ngữ cảnh một lượt ghi danh: lead nào, con nào, lớp nào.
 *
 * Bốn đường ghi của `/enrollments` chỉ cầm `enrollmentId`, và cả bốn đều cần đúng ba thứ
 * này để dựng câu — nên tra MỘT chỗ.
 *
 * ⚠️ Dùng `db` TRẦN, KHÔNG qua `scopedDb` — có chủ đích. `Enrollment` thuộc
 * `SCOPED_MODELS`, nên tra qua `scopedDb` trả `null` cho đúng những ca cần tra: ghi danh
 * cũ mang `leadChildId` có thể ở cơ sở khác với người đang thao tác. Mà `null` ở đây
 * KHÔNG báo lỗi — nó chỉ làm dòng lịch sử biến mất trong im lặng.
 *
 * An toàn vì `leadId` không bao giờ ra tới câu trả lời của action: nó chỉ dùng để chọn hồ
 * sơ lead mà ghi vào. Quyền thao tác trên ghi danh đã được gác ở chính action gọi vào đây.
 */
export async function layNguCanhGhiDanh(enrollmentId: string): Promise<{
  leadId: string;
  tenCon: string;
  tenLop: string;
} | null> {
  try {
    const e = await db.enrollment.findUnique({
      where: { id: enrollmentId },
      select: {
        studentId: true,
        leadChild: { select: { leadId: true } },
        student: { select: { name: true } },
        class: { select: { name: true } },
      },
    });
    if (!e) return null;
    // Ghi danh do convert sinh ra mang `leadChildId`. Ghi danh tạo ở màn /enrollments thì
    // KHÔNG — nên rơi về tra theo học viên (ghi danh CŨ nào của em ấy còn mang cột đó).
    const leadId = e.leadChild?.leadId ?? (await timLeadTuHocVien(e.studentId));
    if (!leadId) return null;
    return {
      leadId,
      tenCon: e.student?.name ?? "(không rõ tên)",
      tenLop: e.class?.name ?? "(không rõ lớp)",
    };
  } catch (err) {
    console.error("[lich-su-tuong-tac] khong doc duoc ngu canh ghi danh", enrollmentId, err);
    return null;
  }
}

/**
 * Ghi lịch sử cho MỘT con lead — tự tra lead cha và TÊN con.
 *
 * Sáu đường ghi của lớp trải nghiệm đều cầm `leadChildId` chứ không cầm `leadId`, và đều
 * cần tên con để dựng câu. Gom vào đây để không có sáu bản sao của cùng một lượt tra —
 * bản thứ hai của một phép tra là bản sẽ lệch.
 *
 * `sk` nhận tên con vì câu chữ cần nó, mà tên thì chỉ biết được SAU khi tra.
 * Con không còn (vừa bị xoá) ⇒ không ghi gì, không ném: lịch sử không được quyền làm
 * đổ nghiệp vụ đã xong.
 */
export async function ghiTuongTacTheoConLead(p: {
  leadChildId: string;
  actorId: string | null;
  actorName: string;
  moc: Date;
  sk: (tenCon: string) => SuKienLead;
}): Promise<void> {
  try {
    const con = await db.leadChild.findUnique({
      where: { id: p.leadChildId },
      select: { leadId: true, fullName: true },
    });
    if (!con) return;
    await ghiTuongTacLead(db, {
      leadId: con.leadId,
      actorId: p.actorId,
      actorName: p.actorName,
      moc: p.moc,
      sk: p.sk(con.fullName),
    });
  } catch (e) {
    console.error("[lich-su-tuong-tac] khong ghi duoc theo con", p.leadChildId, e);
  }
}

/**
 * `trialEnrollmentId` → con lead (lead cha + tên con).
 *
 * Điểm danh nhận vào danh sách `trialEnrollmentId` chứ không phải `leadChildId`, nên cần
 * một lượt tra. Tra MỘT lượt cho cả buổi thay vì một lượt mỗi học viên: một lớp 12 con là
 * 12 vòng gọi DB cho đúng một thông tin.
 */
export async function layConTheoGhiDanhTrial(
  trialEnrollmentIds: readonly string[],
): Promise<Map<string, { leadId: string; tenCon: string }>> {
  const ra = new Map<string, { leadId: string; tenCon: string }>();
  if (trialEnrollmentIds.length === 0) return ra;
  try {
    const ds = await db.trialEnrollment.findMany({
      where: { id: { in: [...trialEnrollmentIds] } },
      select: { id: true, leadChild: { select: { leadId: true, fullName: true } } },
    });
    for (const e of ds) {
      if (e.leadChild) ra.set(e.id, { leadId: e.leadChild.leadId, tenCon: e.leadChild.fullName });
    }
  } catch (e) {
    console.error("[lich-su-tuong-tac] khong tra duoc con theo ghi danh trial", e);
  }
  return ra;
}

/**
 * Các lead đang có con học ở một lớp trải nghiệm.
 *
 * ⚠️ PHẢI GỌI **TRƯỚC** KHI ĐỔI TRẠNG THÁI, và đó là lý do việc này là một hàm riêng thay
 * vì nằm gọn trong hàm ghi: huỷ lớp đẩy mọi `TrialEnrollment` sang CANCELLED, nên gọi sau
 * thì danh sách ACTIVE ra **rỗng** và không lead nào được ghi — một lỗ im lặng hoàn hảo
 * (không lỗi, không dòng nào, panel vẫn hiện bình thường). Gói cả đọc lẫn ghi vào một hàm
 * là chôn đúng cái bẫy đó xuống dưới một cái tên nghe vô hại.
 */
export async function layLeadTrongLopTrial(trialClassId: string): Promise<string[]> {
  try {
    const ds = await db.trialEnrollment.findMany({
      where: { trialClassId, status: "ACTIVE" },
      select: { leadChild: { select: { leadId: true } } },
    });
    return [...new Set(ds.map((e) => e.leadChild?.leadId).filter((x): x is string => !!x))];
  } catch (e) {
    console.error("[lich-su-tuong-tac] khong doc duoc lead cua lop trial", trialClassId, e);
    return [];
  }
}

/**
 * Lead có bé TRONG MỘT CASE — dùng cho việc ở cấp CASE (đổi giờ case, huỷ case).
 *
 * 23/09/2026 — tách khỏi `layLeadTrongLopTrial`: một lớp trải nghiệm nay chứa nhiều case
 * của nhiều Sale, nên ghi "đổi lịch" của MỘT case vào hồ sơ của CẢ LỚP là báo giờ mới
 * cho phụ huynh ở case khác. "Bé trong case" theo đúng `thuocCase` của
 * `lib/trial/nghia-null.ts`: ở lớp CŨ, bé NULL học cả lớp nên cũng thuộc case này.
 *
 * `lopTheoKhung` KHÔNG có mặc định (luật 7): mặc định sai về phía nào cũng là ghi lịch
 * sử nhầm người mà không ai thấy.
 */
export async function layLeadTrongCaseTrial(opts: {
  sessionId: string;
  trialClassId: string;
  lopTheoKhung: boolean;
}): Promise<string[]> {
  try {
    const ds = await db.trialEnrollment.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { scheduledSessionId: opts.sessionId },
          ...(opts.lopTheoKhung
            ? []
            : [{ scheduledSessionId: null, trialClassId: opts.trialClassId }]),
        ],
      },
      select: { leadChild: { select: { leadId: true } } },
    });
    return [...new Set(ds.map((e) => e.leadChild?.leadId).filter((x): x is string => !!x))];
  } catch (e) {
    console.error("[lich-su-tuong-tac] khong doc duoc lead cua case trial", opts.sessionId, e);
    return [];
  }
}

/**
 * Ghi CÙNG MỘT dòng cho nhiều lead — dùng cho việc ở cấp LỚP (huỷ lớp, đổi lịch, huỷ buổi).
 *
 * Một lớp chứa con của nhiều lead, và huỷ lớp thì TẤT CẢ những lead đó đều bị ảnh hưởng.
 * Ghi cho riêng một lead là để những lead còn lại không biết vì sao con mình rơi khỏi lớp.
 * Mỗi lead đúng MỘT dòng dù có hai con trong lớp — dòng này nói về LỚP, không nói về con.
 */
export async function ghiTuongTacNhieuLead(p: {
  leadIds: readonly string[];
  actorId: string | null;
  actorName: string;
  moc: Date;
  sk: SuKienLead;
}): Promise<number> {
  let n = 0;
  for (const leadId of p.leadIds) {
    try {
      await ghiTuongTacLead(db, {
        leadId,
        actorId: p.actorId,
        actorName: p.actorName,
        moc: p.moc,
        sk: p.sk,
      });
      n += 1;
    } catch (e) {
      // Một lead lỗi KHÔNG được làm mất dòng của các lead còn lại.
      console.error("[lich-su-tuong-tac] khong ghi duoc cho lead", leadId, e);
    }
  }
  return n;
}

/**
 * Học viên → lead, qua ghi danh CŨ nào còn mang `leadChildId`.
 *
 * Trả `null` cho học viên chưa từng đi qua convert — đó là câu trả lời ĐÚNG, không phải
 * lỗi: không có lead nào để ghi vào.
 */
export async function timLeadTuHocVien(studentId: string): Promise<string | null> {
  const e = await db.enrollment.findFirst({
    where: { studentId, leadChildId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { leadChild: { select: { leadId: true } } },
  });
  return e?.leadChild?.leadId ?? null;
}
