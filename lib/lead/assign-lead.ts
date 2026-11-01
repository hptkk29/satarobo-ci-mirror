import "server-only";
// lib/lead/assign-lead.ts — CỬA DUY NHẤT TIÊU LƯỢT của vòng chia lead.
//
// Ba hàm, ba việc rời nhau:
//   · `chiaChoLead(leadId, …)`  — chia chủ cho một lead ĐÃ TỒN TẠI. Đây là cửa duy
//     nhất đụng vào bộ đếm lượt; mọi đường vào đều đổ về đây.
//   · `ghiNhanNhapLai(…)`       — lead trùng SĐT: nâng mốc lần nhập, ghi sổ, báo chủ.
//   · `assignLead(…)`           — gói "tạo lead rồi chia" cho người gọi TRỰC TIẾP
//     (test, script). Đường vào thật đi qua `ingestIntakeLead`.
//
// ═══════════════════════════════════════════════════════════════════════════════
// VÌ SAO "TẠO LEAD TRƯỚC, CHIA SAU"
//
// Hai kiểu hỏng không cân nhau:
//   · tiêu lượt mà lead không có ⇒ bộ đếm nói dối vĩnh viễn, chỉ sửa được bằng tay;
//   · lead có mà chưa ai nhận   ⇒ hiện ngay trên màn "Chưa phân công", giao tay được.
// Đặt rủi ro về phía cái nhìn thấy được và tự sửa được.
//
// Bên trong `chiaChoLead` thì việc lấy lượt và việc ghi chủ PHẢI cùng một transaction
// dưới một advisory lock: đọc pool ngoài transaction là hai lead vào cùng lúc đọc
// chung một trạng thái rồi chọn trúng một người.
//
// KHOÁ THEO ĐƠN VỊ, KHÔNG KHOÁ BẢNG — CS1 và CS2 chia song song được. Dùng CHUNG
// KHOÁ với `rotation.ts` (`lead_rotation:<orgUnitId>`): đặt khoá khác là hai đường
// ghi cùng một bộ đếm mà không loại trừ nhau.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { canonicalPhone, phoneVariants } from "@/lib/phone";
import { resolveAssignment, type LeadEntryPoint, type AffiliateActor } from "./assign-resolve";
import type { LeadAssignSource } from "@prisma/client";
import { layPoolDangBat, anhChupPool, orgUnitIdCuaCoSo } from "./pool";
import { takeRotationTurnsTx } from "./rotation";
import {
  notifyStaff,
  thuHoiThongBao,
  broadcastNotificationBump,
} from "@/lib/notifications/notify";

export type AssignLeadInput = {
  /** Cơ sở KHÁCH chọn. Đích của mọi quyết định — không phải cơ sở người nhập. */
  targetCenterId: string;
  createdById: string | null;
  entryPoint: LeadEntryPoint;
  /** SĐT đã chuẩn hoá `84…`; hàm tự chuẩn hoá lại cho chắc. */
  phone: string;
  parentName: string;
  childName?: string | null;
  source?: string | null;
  note?: string | null;
  courseId?: string | null;
  /** Cột sale trong Excel / người quản lý chọn khi giao tay. Đã tra ra tài khoản thật. */
  explicitOwnerId?: string | null;
  /** Mã affiliate đã tra ra người. Chỉ có nghĩa khi `entryPoint = "LANDING"`. */
  aff?: AffiliateActor | null;
};

export type AssignLeadResult = {
  ok: boolean;
  leadId?: string;
  assignedToId: string | null;
  /** `true` = trùng SĐT, không tạo lead mới. */
  duplicate: boolean;
  consumedTurn: boolean;
  error?: string;
};

/**
 * Người cần biết khi pool rỗng: quản lý cơ sở của đơn vị đó + quản trị hệ thống.
 *
 * Lead "Chưa phân công" nằm im không ai hay chính là kiểu hỏng đắt nhất của cả
 * module này — có lead, có khách chờ, mà không ai được giao.
 */
export async function baoPoolRong(
  centerId: string,
  leadId: string | null,
  parentName: string,
): Promise<void> {
  // Bọc CẢ thân hàm, không chỉ `notifyStaff`: từ 08/09 hàm này nằm trên đường SAU COMMIT của
  // `transferLead`, nên một lỗi DB ở câu đọc dưới đây sẽ ném ngược lên và báo "chuyển lead thất
  // bại" trong khi lead ĐÃ chuyển xong. Chuông hỏng không được cuốn theo lượt nghiệp vụ.
  try {
  const nguoi = await db.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      OR: [
        { centerId, roles: { hasSome: ["CENTER_MANAGER"] } },
        { roles: { hasSome: ["SUPER_ADMIN"] } },
      ],
    },
    select: { id: true },
  });
  if (nguoi.length === 0) return;
  await notifyStaff({
    userIds: nguoi.map((u) => u.id),
    // Khoá theo LEAD chứ không theo cơ sở: gom theo cơ sở thì phiếu thứ hai trở đi
    // bị nuốt, mà mỗi phiếu là một khách đang chờ.
    dedupeKey: `lead.pool_rong:${leadId ?? parentName}`,
    title: "Lead chưa được phân công",
    body: `Không còn ai đang nhận lead ở cơ sở này — phiếu "${parentName}" đang nằm chờ. Bật lại người trong pool hoặc giao tay.`,
    href: leadId ? `/leads/${leadId}` : "/quan-ly-chia-lead",
    entityId: leadId,
  }).catch((err) => console.error("[assign-lead] không gửi được thông báo pool rỗng:", err));
  } catch (err) {
    console.error("[assign-lead] lỗi khi báo pool rỗng:", err);
  }
}

/** Đầu vào của việc chia — dùng chung cho lead mới tạo lẫn lead đã có. */
export type ChiaChoLeadInput = {
  targetCenterId: string;
  createdById: string | null;
  entryPoint: LeadEntryPoint;
  explicitOwnerId?: string | null;
  aff?: AffiliateActor | null;
  /**
   * true = KHÔNG bắn chuông "Bạn có lead mới" cho chủ mới; nơi gọi tự lo phần báo.
   *
   * Sinh ra cho đường NHẬP HÀNG LOẠT (import Excel): nhập 40 dòng mà mỗi dòng một cái chuông
   * là 40 lần rung điện thoại liên tiếp — đúng "bão push" mà `lib/push/allowlist.ts` nói là
   * cái giá không lấy lại được (người dùng tắt quyền thông báo ở CẤP TRÌNH DUYỆT). Nơi gọi
   * gộp lại thành MỘT tin "Bạn có N lead mới".
   *
   * ⚠️ Cờ này CHỈ tắt nửa BÁO. Nửa THU HỒI chuông chủ cũ vẫn chạy vô điều kiện — đó là phép
   * sửa đúng đắn trong mọi ca, và tắt nó đi là dựng lại sự cố 15/09/2026.
   */
  imLangChuong?: boolean;
};

/** Nạp thông tin người nhập rồi hỏi ma trận. Dùng chung hai nhánh có/không đơn vị. */
async function quyetDinhChuLead(
  dbc: typeof db | Parameters<typeof layPoolDangBat>[2],
  input: ChiaChoLeadInput,
) {
  const nguoiNhap = input.createdById
    ? await (dbc as typeof db).user.findUnique({
        where: { id: input.createdById },
        select: { centerId: true, roles: true },
      })
    : null;
  return resolveAssignment({
    targetCenterId: input.targetCenterId,
    createdById: input.createdById,
    createdByCenterId: nguoiNhap?.centerId ?? null,
    createdByIsSale: !!nguoiNhap?.roles.includes("SALES_CSM"),
    entryPoint: input.entryPoint,
    explicitOwnerId: input.explicitOwnerId ?? null,
    aff: input.aff ?? null,
    duplicateOf: null, // trùng đã được caller xử trước khi tạo lead
  });
}

/**
 * CHIA CHỦ cho một lead ĐÃ TỒN TẠI — cửa duy nhất tiêu lượt của vòng.
 *
 * Thứ tự "tạo lead trước, chia sau" là CÓ CHỦ ĐÍCH. Hai kiểu hỏng không cân nhau:
 *   · tiêu lượt mà lead không có ⇒ bộ đếm nói dối vĩnh viễn, chỉ sửa được bằng tay;
 *   · lead có mà chưa ai nhận ⇒ hiện ngay trên màn "Chưa phân công", quản lý giao tay.
 * Cái sau nhìn thấy được và tự sửa được, nên đặt rủi ro về phía đó.
 */
export async function chiaChoLead(
  leadId: string,
  input: ChiaChoLeadInput,
  now: Date = new Date(),
): Promise<{ ok: boolean; assignedToId: string | null; consumedTurn: boolean; error?: string }> {
  const orgUnitId = await orgUnitIdCuaCoSo(input.targetCenterId);
  if (!orgUnitId) {
    // KHÔNG có đơn vị ⇒ không có sổ lượt để ghi ⇒ KHÔNG chia tự động được: thà để
    // CHƯA PHÂN còn hơn chia bằng đường khác rồi lệch sổ mà không ai biết.
    //
    // NHƯNG chủ lead đã BIẾT SẴN (sale tự nhập, mã NV trên phiếu, cột sale trong
    // Excel, quản lý giao tay) thì không cần sổ lượt nào cả — người ta đã chỉ đích
    // danh. Chặn cả nhánh này là làm hỏng một hành vi đang chạy đúng ở mọi cơ sở
    // chưa gắn vào cây tổ chức, mà lại hỏng IM LẶNG: phiếu vẫn tạo, chỉ là không
    // ai nhận. (Đúng ca `mã NV có thật ⇒ gán thẳng cho người đó` trong bộ
    // tests/lead-intake — nó đỏ ngay lượt chạy đầu.)
    const quyet = await quyetDinhChuLead(db, input);
    if (quyet.kind === "OWNER") {
      // Chủ TRƯỚC lượt ghi này — chỉ dùng để thu hồi chuông cũ. Đọc sát trước khi ghi.
      const chuCu =
        (await db.lead.findUnique({ where: { id: leadId }, select: { assignedToId: true } }))
          ?.assignedToId ?? null;
      await db.lead.update({
        where: { id: leadId },
        data: {
          assignedToId: quyet.ownerId,
          assignedAt: now,
          assignedById: quyet.source === "MANAGER" ? input.createdById : null,
          assignmentSource: quyet.source,
        },
      });
      const l = await db.lead.findUnique({ where: { id: leadId }, select: { parentName: true } });
      await baoSaleCoLeadMoi({
        ownerId: quyet.ownerId,
        leadId,
        parentName: l?.parentName ?? "(không tên)",
        source: quyet.source,
      });
      await thuHoiChuongLeadCu({ chuCuId: chuCu, chuMoiId: quyet.ownerId, leadId });
      return { ok: true, assignedToId: quyet.ownerId, consumedTurn: false };
    }
    console.warn(
      `[assign-lead] Cơ sở ${input.targetCenterId} chưa gắn đơn vị — lead ${leadId} để CHƯA PHÂN.`,
    );
    return { ok: true, assignedToId: null, consumedTurn: false };
  }

  const ketQua = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lead_rotation:${orgUnitId}`}))`;

      const quyet = await quyetDinhChuLead(tx, input);

      let ownerId: string | null = quyet.kind === "OWNER" ? quyet.ownerId : null;
      let poolSnapshot: ReturnType<typeof anhChupPool> | null = null;
      let turnCountAfter: number | null = null;
      let consumedTurn = false;
      let poolRong = false;

      if (quyet.kind === "AUTO") {
        const pool = await layPoolDangBat(orgUnitId, input.targetCenterId, tx);
        poolSnapshot = anhChupPool(pool);
        if (pool.length === 0) {
          // KHÔNG xếp hàng đợi gán bù: khi có người bật lại, quản lý giao tay, và
          // lượt giao tay đó không tiêu lượt (ca 4 của ma trận).
          poolRong = true;
        } else {
          const [chon] = await takeRotationTurnsTx(
            tx,
            orgUnitId,
            pool.map((m) => m.userId),
            1,
            now,
          );
          ownerId = chon ?? null;
          consumedTurn = !!chon;
          if (chon) {
            const sau = await tx.leadRotationTurn.findUnique({
              where: { orgUnitId_userId: { orgUnitId, userId: chon } },
              select: { turns: true },
            });
            turnCountAfter = sau?.turns ?? null;
          }
        }
      }

      // Chủ TRƯỚC lượt ghi — đọc TRONG transaction, tức DƯỚI advisory lock. Đọc ngoài thì hai
      // lượt chia song song (bấm "Chia lại" hai lần, hoặc lô import chạy cùng lúc) cùng thấy
      // chủ A đã lỗi thời, và lượt sau sẽ thu hồi chuông của người ĐANG giữ lead.
      const chuCu =
        (await tx.lead.findUnique({ where: { id: leadId }, select: { assignedToId: true } }))
          ?.assignedToId ?? null;

      await tx.lead.update({
        where: { id: leadId },
        data: {
          assignedToId: ownerId,
          assignedAt: ownerId ? now : null,
          // Người THAO TÁC gán — chỉ có ở nhánh giao tay; máy chia thì để trống.
          assignedById: quyet.source === "MANAGER" ? input.createdById : null,
          assignmentSource: quyet.source,
        },
      });

      await tx.leadAssignmentLog.create({
        data: {
          leadId,
          orgUnitId,
          assignedToId: ownerId,
          createdById: input.createdById,
          source: quyet.source,
          consumedTurn,
          turnCountAfter,
          poolSnapshot: poolSnapshot ?? undefined,
          note: poolRong ? "Pool rỗng — để CHƯA PHÂN CÔNG." : null,
        },
      });

      return { ownerId, consumedTurn, poolRong, source: quyet.source, chuCu };
    },
    { maxWait: 5_000, timeout: 15_000 },
  );

  if (ketQua.poolRong) {
    const l = await db.lead.findUnique({ where: { id: leadId }, select: { parentName: true } });
    await baoPoolRong(input.targetCenterId, leadId, l?.parentName ?? "(không tên)");
    // Pool rỗng KHÔNG có nghĩa là chủ cũ giữ nguyên lead: transaction ở trên ghi
    // `assignedToId: ownerId` VÔ ĐIỀU KIỆN, mà ở ca này `ownerId` là null ⇒ chủ cũ MẤT lead
    // ngay lập tức. Không thu hồi ở đây là để lại đúng cái chuông mồ côi mà bản vá này dẹp.
    await thuHoiChuongLeadCu({ chuCuId: ketQua.chuCu, chuMoiId: null, leadId });
  } else if (ketQua.ownerId) {
    if (!input.imLangChuong) {
      const l = await db.lead.findUnique({ where: { id: leadId }, select: { parentName: true } });
      await baoSaleCoLeadMoi({
        ownerId: ketQua.ownerId,
        leadId,
        parentName: l?.parentName ?? "(không tên)",
        source: ketQua.source,
      });
    }
    // Thu hồi chạy CẢ KHI im chuông: chủ cũ giữ lại một cái chuông trỏ tới lead họ không còn
    // giữ là lỗi trong mọi ca, không liên quan tới việc có báo chủ mới hay không.
    await thuHoiChuongLeadCu({ chuCuId: ketQua.chuCu, chuMoiId: ketQua.ownerId, leadId });
  }

  return { ok: true, assignedToId: ketQua.ownerId, consumedTurn: ketQua.consumedTurn };
}

/**
 * BÁO CHO SALE VỪA ĐƯỢC CHIA LEAD.
 *
 * Trước 30/08 không có đường nào báo: sale chỉ biết mình có lead mới khi tự mở danh
 * sách ra xem. Lead nóng nhất là lead vừa để lại số, mà đúng lúc đó thì không ai
 * được đánh động — cam kết phản hồi trôi vì một cái chuông không kêu.
 *
 * `href` trỏ THẲNG trang chi tiết lead (chủ dự án chốt), không phải danh sách: bấm
 * chuông là đọc được ngay số điện thoại và ghi được hoạt động, không phải đi tìm.
 *
 * Gửi NGOÀI transaction và nuốt lỗi: chuông hỏng thì lead vẫn phải được chia. Ngược
 * lại — để lỗi mạng của một cái chuông cuốn theo cả lượt chia — mới là hỏng nặng.
 *
 * ⚠️ EXPORT (08/09/2026): nay là CỬA DÙNG CHUNG cho mọi đường đổi chủ lead, không riêng
 * `chiaChoLead`. Đường gán tay (`manualAssignLead`) gọi nó sau khi transaction của mình đã
 * commit. Thêm đường mới thì gọi hàm NÀY, đừng tự dựng lời gọi `notifyStaff` thứ hai —
 * `dedupeKey` phải giữ nguyên byte `lead.moi:<leadId>` vì `lib/notifications/catalog.ts:155`
 * phân loại theo tiền tố đó, và khoá lệch là thông báo rơi xuống nhóm "Hệ thống/P3".
 *
 * ⚠️ Gọi SAU COMMIT, không truyền `tx`: `notifyStaff` cố ý không nhận `tx` (notify.ts:18).
 */
export async function baoSaleCoLeadMoi(params: {
  ownerId: string;
  leadId: string;
  parentName: string;
  /** Nguồn gán. `DUPLICATE` không bao giờ tới đây — lead trùng không đổi chủ. */
  source: LeadAssignSource;
}): Promise<void> {
  // Sale TỰ NHẬP phiếu của mình thì không cần chuông báo chính việc mình vừa làm.
  if (params.source === "SELF") return;
  await notifyStaff({
    userIds: [params.ownerId],
    // Một lead chia đúng một lần ⇒ khoá theo lead là đủ, và chặn được lượt gán lại
    // cùng người không đẻ chuông thứ hai.
    dedupeKey: `lead.moi:${params.leadId}`,
    title: "Bạn có lead mới",
    body: `Lead "${params.parentName}" vừa được chia cho bạn. Gọi sớm giúp tăng tỉ lệ chốt.`,
    href: `/leads/${params.leadId}`,
    entityId: params.leadId,
  }).catch((err) => console.error("[assign-lead] không gửi được thông báo lead mới:", err));
}

/**
 * ĐÂU LÀ MỘT "LÔ" LEAD, VÀ VÌ SAO NÓ CẦN TÊN RIÊNG.
 *
 * Ba đường dưới đây đều chia nhiều lead cùng một lúc, nhưng hình dạng khác nhau:
 *   · nhập danh sách  — nhiều lead, nhiều người nhận, không có "người bàn giao";
 *   · bàn giao        — nhiều lead, ĐÚNG MỘT người nhận, có người bàn giao rõ tên;
 *   · sale nghỉ       — nhiều lead của một người, chia vòng cho NHIỀU người nhận.
 *
 * Người nhận cần biết lead ở đâu ra thì mới biết phải làm gì: lead bàn giao là lead ĐANG chạy
 * dở, có lịch sử trao đổi, gọi tới phải biết mà xin lỗi vì đổi người. Lead nhập mới thì chưa ai
 * chạm tới. Một câu "Bạn có 12 lead mới" giống hệt nhau cho cả ba ca là một affordance nói dối
 * (luật 12).
 */
export type NguonLoLead =
  | { kieu: "nhap_danh_sach" }
  | { kieu: "ban_giao"; tuNguoi: string }
  | { kieu: "sale_nghi"; tuNguoi: string };

/** Nguồn gán tương ứng, cho ca chỉ có MỘT lead (chuông thường cần giá trị enum thật). */
export function nguonGanCuaLo(nguon: NguonLoLead): LeadAssignSource {
  switch (nguon.kieu) {
    case "nhap_danh_sach":
      return "IMPORT";
    case "ban_giao":
      // Người bấm nút bàn giao là quản lý — cùng loại với giao tay trên màn chi tiết.
      return "MANAGER";
    case "sale_nghi":
      // `reassignOpenLeads` chia bằng `takeRotationTurns`, tức máy chia theo sổ lượt.
      return "AUTO";
  }
}

/** Câu mô tả trong tin GỘP. Tách ra để test đọc được, và để ba ca không lẫn vào nhau. */
export function moTaLoLead(nguon: NguonLoLead, soLead: number): string {
  switch (nguon.kieu) {
    case "nhap_danh_sach":
      return `${soLead} lead vừa được chia cho bạn từ một lượt nhập danh sách. Gọi sớm giúp tăng tỉ lệ chốt.`;
    case "ban_giao":
      return `${soLead} lead đang theo dõi của ${nguon.tuNguoi} vừa được bàn giao cho bạn. Xem lại lịch sử trao đổi trước khi gọi.`;
    case "sale_nghi":
      return `${soLead} lead của ${nguon.tuNguoi} vừa được chia lại cho bạn. Xem lại lịch sử trao đổi trước khi gọi.`;
  }
}

/**
 * BÁO GỘP: "Bạn có N lead mới".
 *
 * ── VÌ SAO GỘP, KHÔNG BẮN TỪNG CÁI ──────────────────────────────────────────────────────
 * Chủ dự án chốt 15/09/2026: "phần lead này khi nhập nhiều thì báo là có bao nhiêu lead mới
 * chứ không gửi nhiều thông báo có lead mới".
 *
 * Đó cũng là điều đúng về mặt kỹ thuật: nhập 40 dòng mà mỗi dòng một chuông là 40 lần rung
 * điện thoại liên tiếp. Cái giá của một đợt push rác không phải tiền — người dùng tắt quyền
 * thông báo ở CẤP TRÌNH DUYỆT và code không có cách nào xin lại (xem `lib/push/allowlist.ts`).
 *
 * ⚠️ CHỈ gọi khi một người nhận TỪ HAI lead trở lên. Đúng một lead thì `baoSaleCoLeadMoi`
 * tốt hơn hẳn: nó trỏ thẳng trang chi tiết lead, bấm là đọc được số điện thoại ngay.
 * `baoLoLeadMoi` bên dưới tự chọn giùm — đừng gọi thẳng hàm này từ nơi khác.
 *
 * ⚠️ `dedupeKey` CÓ mốc thời gian — cố ý, và ngược với luật chung.
 * Khối chú thích ở `lib/push/allowlist.ts` nêu `lead.nhap_lai:` làm ví dụ mìn đúng vì nó nhét
 * `Date.now()` vào khoá: khách điền form 10 lần là 10 chuông. Ở đây khác về BẢN CHẤT TẦN SUẤT:
 * mỗi lượt là một thao tác do QUẢN LÝ chủ động làm, vài lần một tháng, và mỗi lượt sinh đúng
 * MỘT chuông cho mỗi người nhận. Không có mốc thời gian thì lượt thứ hai trong ngày bị
 * `@@unique([userId, dedupeKey])` nuốt mất và sale không biết mình vừa nhận thêm lead.
 */
export async function baoSaleNhieuLeadMoi(params: {
  ownerId: string;
  soLead: number;
  /** Mốc của lượt chia — mọi người nhận trong CÙNG lượt phải dùng chung một giá trị. */
  mocLuot: number;
  /** ⚠️ BẮT BUỘC, cố ý không có mặc định: ba ca đọc ra ba câu khác nhau. */
  nguon: NguonLoLead;
}): Promise<void> {
  if (params.soLead < 2) return;
  await notifyStaff({
    userIds: [params.ownerId],
    dedupeKey: `lead.moi_nhieu:${params.ownerId}:${params.mocLuot}`,
    title: `Bạn có ${params.soLead} lead mới`,
    body: moTaLoLead(params.nguon, params.soLead),
    href: "/leads",
    entityId: null,
  }).catch((err) => console.error("[assign-lead] không gửi được thông báo gộp lead mới:", err));
}

/** Một tin cần gửi sau một lượt chia nhiều lead. */
export type TinBaoLoLead =
  | { kieu: "mot"; ownerId: string; leadId: string }
  | { kieu: "gop"; ownerId: string; soLead: number };

/**
 * LÊN KẾ HOẠCH BÁO cho một lô lead vừa chia — hàm THUẦN, không chạm DB.
 *
 * Tách ra khỏi nơi gọi vì đây là chỗ nằm TOÀN BỘ quyết định vận hành của bản vá 15/09: gộp
 * theo NGƯỜI NHẬN, và ngưỡng gộp là hai. Để inline trong route handler thì không có chỗ nào
 * cấy lỗi được — handler cần auth + phân tích tệp xlsx mới chạy tới đây, nên mọi cách gom sai
 * (một tin chung cho cả lượt, gộp cả người chỉ nhận một lead, đếm trùng lead) đều đi qua CI
 * im lặng. Đây là luật 12b áp cho đường ghi.
 *
 * `boQuaNguoi` là NGƯỜI THAO TÁC: quản lý tự bàn giao lead về cho chính mình thì không cần
 * chuông báo lại việc mình vừa bấm — cùng luật với nhánh `source === "SELF"` của
 * `baoSaleCoLeadMoi`. Cố ý KHÔNG có mặc định để `tsc` liệt kê đủ nơi gọi (luật 7).
 *
 * Thứ tự trả về bám thứ tự NGƯỜI NHẬN xuất hiện lần đầu — để nhật ký của hai lượt giống nhau
 * đọc ra giống nhau.
 */
export function lenKeHoachBaoLoLead(
  daChia: readonly { leadId: string; ownerId: string }[],
  boQuaNguoi: string | null,
): TinBaoLoLead[] {
  const theoChu = new Map<string, string[]>();
  for (const { leadId, ownerId } of daChia) {
    if (!ownerId || !leadId) continue;
    if (boQuaNguoi && ownerId === boQuaNguoi) continue;
    const ds = theoChu.get(ownerId);
    // Cùng một lead lọt vào hai lần thì đếm một — con số trong tin là thứ người nhận sẽ đối
    // chiếu với danh sách của họ, lệch một cái là mất tin vào cả cơ chế.
    if (ds) {
      if (!ds.includes(leadId)) ds.push(leadId);
    } else theoChu.set(ownerId, [leadId]);
  }

  const ra: TinBaoLoLead[] = [];
  for (const [ownerId, leadIds] of theoChu) {
    if (leadIds.length === 1) ra.push({ kieu: "mot", ownerId, leadId: leadIds[0]! });
    else ra.push({ kieu: "gop", ownerId, soLead: leadIds.length });
  }
  return ra;
}

/**
 * GỬI chuông cho cả một lô lead vừa chia — đường DUY NHẤT cho mọi thao tác hàng loạt.
 *
 * Ba nơi gọi: nhập danh sách (`app/api/admin/import/leads`), bàn giao
 * (`lib/lead-handover/service.ts`), và chia lại khi sale nghỉ (`lib/lead/assign.ts`). Trước
 * 15/09 hai đường sau KHÔNG báo gì cho người nhận — họ nhận lead mà không ai đánh động, phải
 * tự mở danh sách ra mới biết mình có việc.
 *
 * Gom vào MỘT hàm thay vì chép vòng lặp ba lần vì lần trước lỗi đúng kiểu đó: bốn đường đổi
 * chủ ra đời ở bốn thời điểm, mỗi đường quên cùng một bước.
 *
 * Nuốt lỗi: chuông hỏng không được làm hỏng việc chia lead.
 */
export async function baoLoLeadMoi(params: {
  daChia: readonly { leadId: string; ownerId: string }[];
  nguon: NguonLoLead;
  /** Mốc dùng chung cho cả lượt — xem `baoSaleNhieuLeadMoi`. */
  mocLuot: number;
  /** Người thao tác; không tự báo cho chính họ. `null` = máy chạy, không ai để bỏ qua. */
  boQuaNguoi: string | null;
}): Promise<void> {
  for (const tin of lenKeHoachBaoLoLead(params.daChia, params.boQuaNguoi)) {
    if (tin.kieu === "mot") {
      const l = await db.lead
        .findUnique({ where: { id: tin.leadId }, select: { parentName: true } })
        .catch(() => null);
      await baoSaleCoLeadMoi({
        ownerId: tin.ownerId,
        leadId: tin.leadId,
        parentName: l?.parentName ?? "(không tên)",
        source: nguonGanCuaLo(params.nguon),
      });
    } else {
      await baoSaleNhieuLeadMoi({
        ownerId: tin.ownerId,
        soLead: tin.soLead,
        mocLuot: params.mocLuot,
        nguon: params.nguon,
      });
    }
  }
}

/**
 * THU HỒI chuông "Bạn có lead mới" của CHỦ CŨ khi lead đổi tay.
 *
 * Vì sao cần: repo không có cơ chế thu hồi thông báo nào, nên trước bản vá này mỗi lượt đổi chủ
 * để lại ở người cũ một dòng "Bạn có lead mới" trỏ tới lead họ KHÔNG còn giữ. Chưa đọc thì nó
 * còn đếm vào badge. Và nếu là đổi chủ XUYÊN CƠ SỞ thì tệ hơn: `Lead` nằm trong
 * `SCOPED_MODELS` nên `scopedDb` lọc mất, người cũ bấm chuông ra trang "không tồn tại".
 *
 * Gọi từ MỌI đường đổi chủ có chuông — `chiaChoLead`, `manualAssignLead`, `transferLead`.
 *
 * Điều kiện là "quyền sở hữu RỜI KHỎI chủ cũ", KHÔNG phải "có chủ mới". `chuMoiId = null` VẪN
 * thu hồi — vì mọi đường gọi tới đây đều đã ghi `Lead.assignedToId` trước đó, kể cả ca pool rỗng
 * (transaction ghi `assignedToId: ownerId` vô điều kiện, mà `ownerId` là null) và ca chuyển sang
 * cơ sở không còn ai nhận. Chỉ thoát khi KHÔNG có chủ cũ, hoặc chủ cũ chính là chủ mới.
 *
 * Bắn `notification.bumped` CHỈ KHI thật sự có dòng bị thu hồi: badge của người cũ đang treo một
 * số ma, mà vòng poll của chuông là 5 PHÚT. Thu hồi là sự kiện hiếm (mỗi lượt đổi chủ một lần) nên
 * không có nguy cơ lặp lại bão broadcast 05/09.
 *
 * Nuốt lỗi như `baoSaleCoLeadMoi`: thu hồi hỏng thì lượt chia vẫn phải thành công.
 */
export async function thuHoiChuongLeadCu(params: {
  chuCuId: string | null | undefined;
  chuMoiId: string | null | undefined;
  leadId: string;
}): Promise<void> {
  const { chuCuId, chuMoiId, leadId } = params;
  if (!chuCuId || chuCuId === chuMoiId) return;
  try {
    const soDong = await thuHoiThongBao({
      userIds: [chuCuId],
      dedupeKey: `lead.moi:${leadId}`,
    });
    if (soDong > 0) await broadcastNotificationBump([chuCuId]);
  } catch (err) {
    console.error("[assign-lead] không thu hồi được chuông của chủ cũ:", err);
  }
}

/**
 * GHI NHẬN LẦN NHẬP LẠI của một lead đã có (trùng SĐT).
 *
 * Ba việc, không được thiếu việc nào:
 *   · nâng `lastInboundAt` + `inboundCount` — nếu không, phiếu vừa gọi lại trông y
 *     hệt phiếu nguội ba tháng và Sale không có cách nào biết để gọi trước;
 *   · ghi `LeadAssignmentLog` nguồn DUPLICATE, `consumedTurn = false`;
 *   · báo cho người ĐANG GIỮ lead — họ là người phải gọi lại.
 *
 * KHÔNG đụng chủ lead: đổi chủ ở đây là gõ lại số của khách thì cướp được phiếu.
 */
export async function ghiNhanNhapLai(params: {
  leadId: string;
  centerId: string | null;
  source: string | null;
  createdById: string | null;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  const lead = await db.lead.update({
    where: { id: params.leadId },
    data: { lastInboundAt: now, inboundCount: { increment: 1 } },
    select: { assignedToId: true, parentName: true, orgUnitId: true },
  });

  const orgUnitId =
    lead.orgUnitId ?? (params.centerId ? await orgUnitIdCuaCoSo(params.centerId) : null);
  if (orgUnitId) {
    await db.leadAssignmentLog.create({
      data: {
        leadId: params.leadId,
        orgUnitId,
        assignedToId: lead.assignedToId,
        createdById: params.createdById,
        source: "DUPLICATE",
        consumedTurn: false,
        note: `Nhập lại phiếu đã có (nguồn: ${params.source ?? "không rõ"}).`,
      },
    });
  }

  if (lead.assignedToId) {
    await notifyStaff({
      userIds: [lead.assignedToId],
      // Khoá theo MỐC: mỗi lần khách quay lại là một lần đáng gọi, gom lại là nuốt.
      dedupeKey: `lead.nhap_lai:${params.leadId}:${now.getTime()}`,
      title: "Khách vừa để lại thông tin lần nữa",
      body: `Lead "${lead.parentName}" vừa được nhập lại từ ${params.source ?? "nguồn không rõ"}.`,
      href: `/leads/${params.leadId}`,
      entityId: params.leadId,
    }).catch((err) => console.error("[assign-lead] không gửi được thông báo nhập lại:", err));
  }
}

/**
 * Tạo lead + chia chủ, hoặc ghi nhận trùng. Đường DÙNG TRỰC TIẾP (test, script).
 *
 * Các đường vào thật (`/nhap-khach-hang`, webhook, import) đi qua `ingestIntakeLead`
 * — nó là cửa TẠO LEAD duy nhất (dedupe, LeadChild, UTM, ghi kép orgUnitId) và nó
 * gọi `chiaChoLead` ở cuối. Hàm này chỉ gói hai bước đó lại cho người gọi trực tiếp.
 */
export async function assignLead(
  input: AssignLeadInput,
  now: Date = new Date(),
): Promise<AssignLeadResult> {
  const phone = canonicalPhone(input.phone) ?? input.phone.trim();
  const orgUnitId = await orgUnitIdCuaCoSo(input.targetCenterId);
  if (!orgUnitId) {
    return {
      ok: false,
      assignedToId: null,
      duplicate: false,
      consumedTurn: false,
      error: "Cơ sở này chưa gắn đơn vị trong cây tổ chức — không chia lead được.",
    };
  }

  // ── Trùng SĐT — trước mọi thứ ─────────────────────────────────────────────
  const bienThe = phoneVariants(phone);
  const trung = bienThe.length
    ? await db.lead.findFirst({
        where: { phone: { in: bienThe }, deletedAt: null },
        select: { id: true, assignedToId: true },
        orderBy: { createdAt: "asc" },
      })
    : null;
  if (trung) {
    await db.leadDuplicate.create({
      data: { primaryLeadId: trung.id, duplicatePhone: phone, source: input.source ?? null },
    });
    await ghiNhanNhapLai({
      leadId: trung.id,
      centerId: input.targetCenterId,
      source: input.source ?? null,
      createdById: input.createdById,
      now,
    });
    return {
      ok: true,
      leadId: trung.id,
      assignedToId: trung.assignedToId,
      duplicate: true,
      consumedTurn: false,
    };
  }

  const lead = await db.lead.create({
    data: {
      parentName: input.parentName,
      phone,
      childName: input.childName ?? null,
      centerId: input.targetCenterId,
      orgUnitId,
      courseId: input.courseId ?? null,
      source: input.source ?? null,
      note: input.note ?? null,
      createdById: input.createdById,
      lastInboundAt: now,
      inboundCount: 1,
    },
    select: { id: true },
  });

  const chia = await chiaChoLead(
    lead.id,
    {
      targetCenterId: input.targetCenterId,
      createdById: input.createdById,
      entryPoint: input.entryPoint,
      explicitOwnerId: input.explicitOwnerId ?? null,
      aff: input.aff ?? null,
    },
    now,
  );

  return {
    ok: true,
    leadId: lead.id,
    assignedToId: chia.assignedToId,
    duplicate: false,
    consumedTurn: chia.consumedTurn,
  };
}
