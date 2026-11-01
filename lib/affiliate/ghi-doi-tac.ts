/**
 * lib/affiliate/ghi-doi-tac.ts — MỘT NƠI GHI ĐỐI TÁC AFFILIATE (`Affiliate` = AffiliateParty): `taoDoiTac` · `suaDoiTac` · `doiTrangThaiDoiTac` (AFF-P0b, docs/source-commission/12).
 * Luật ĐƯỢC/KHÔNG ĐƯỢC ở `ghi-doi-tac-dau-vao.ts` (thuần); tệp này đọc DB rồi ghi.
 *
 * ── Khuôn (chép `lib/nguon/danh-muc-ghi.ts`) ───────────────────────────────────────────────────────────────────
 *  · Quyền (`affiliates:manage`) và cờ (`affiliate.enabled`) do NƠI GỌI kiểm ở Server Action. Hàm này không biết ai đang bấm ngoài `nguoi` để ghi nhật ký.
 *  · KHOÁ LẠC QUAN theo `updatedAt` mà người sửa ĐÃ THẤY — nhưng KHÔNG bằng `updateMany({ where: { updatedAt } })` (độ chính xác micro- vs mili-giây ⇒ điều kiện không bao giờ khớp):
 *    khoá hàng (`FOR UPDATE`) → so `getTime()` trong JS → ghi. `updatedAtDaThay` BẮT BUỘC, không mặc định (luật 7).
 *  · MỌI cổng đứng TRƯỚC phép ghi đầu tiên; từ chối trong transaction là `throw LoiGhiAffiliate` (luật rollback: `return` KHÔNG rollback), nơi ngoài bắt và dịch ra `KetQuaGhi`.
 *  · `writeAudit` CÙNG transaction. Nhật ký KHÔNG chép SĐT/email/ghi chú (chỉ ghi «đổi ô nào»): nhật ký đọc được rộng hơn trang quản lý đối tác.
 *  · Không xoá cứng — không có hàm xoá ở đây. Kết thúc đối tác KHÔNG đụng lead / attribution / sổ.
 *
 * ── `isActive` ≡ (status = ACTIVE) ────────────────────────────────────────────────────────────────────────────
 *  `cotTrangThai` là cách DUY NHẤT ghi hai cột này (tạo và đổi trạng thái đều đi qua nó); lưới `[GDT-W1]` đếm. `suaDoiTac` KHÔNG ghi `status`/`isActive` — đổi trạng thái là việc có cổng riêng.
 *  ⚠️ Màn cũ `/affiliates` (`app/(admin)/admin/affiliates/_actions.ts`) vẫn ghi `isActive` mà không đụng `status` — nó phải chuyển hướng về đây trước khi bật cờ affiliate.
 *
 * ── Chỗ DB không canh được, tầng ứng dụng phải canh ────────────────────────────────────────────────────────
 *  · «Một nhân viên chỉ gắn với MỘT đối tác chưa kết thúc»: KHÔNG có ràng buộc ở DB ⇒ khoá advisory theo nhân viên rồi mới kiểm (hai người cùng gắn một nhân viên một lúc không cùng qua được).
 *  · Cha phải là TỔ CHỨC chưa kết thúc; tổ chức đang có thành viên không đổi thành cá nhân; Postgres chỉ chặn «tổ chức có cha» và «tự làm cha».
 *  · Mã `?ref=` KHOÁ khi đối tác đã có lead (`timDoiTacDaCoLead`, không scope): đổi mã là làm chết link đã in.
 */
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { MODULE_AUDIT_AFFILIATE, LoiGhiAffiliate, aud, laLoiTrungKhoa, type KetQuaGhi, type NguoiGhi } from "./chung";
import { timDoiTacDaCoLead } from "./doc-doi-tac";
import {
  LY_DO_TOI_THIEU_DOI_TAC,
  chuanHoaMaDoiTac,
  kiemDoiTrangThaiDoiTac,
  laDangHoatDong,
  suaDoiTacSchema,
  taoDoiTacSchema,
  trangThaiKhiTao,
  type TrangThaiDoiTac,
} from "./ghi-doi-tac-dau-vao";

type Tx = Prisma.TransactionClient;

const ENTITY_AUDIT = "Affiliate";

export type KetQuaTaoDoiTac = KetQuaGhi<{ id: string; ma: string; trangThai: TrangThaiDoiTac; capNhatLuc: string }>;
export type KetQuaSuaDoiTac = KetQuaGhi<{ doi: boolean; truongDoi: string[]; capNhatLuc: string }>;
export type KetQuaDoiTrangThaiDoiTac = KetQuaGhi<{ den: TrangThaiDoiTac; capNhatLuc: string }>;

/** Hai cột trạng thái, ghi CÙNG NHAU. Mọi chỗ ghi `status` của đối tác phải spread kết quả của hàm này. */
export function cotTrangThai(trangThai: TrangThaiDoiTac): { status: TrangThaiDoiTac; isActive: boolean } {
  return { status: trangThai, isActive: laDangHoatDong(trangThai) };
}

const khongTimThay = (): LoiGhiAffiliate => new LoiGhiAffiliate("Không tìm thấy đối tác này.", "khongTimThay");
const vuaDoi = (): LoiGhiAffiliate => new LoiGhiAffiliate("Đối tác vừa được người khác thay đổi — hãy tải lại rồi thử lại.", "vuaDoi");

function loiTuZod(e: { issues: readonly { path: PropertyKey[]; message: string }[] }): { ok: false; loi: string; truong: string } {
  const i = e.issues[0];
  return { ok: false, loi: i?.message ?? "Dữ liệu không hợp lệ.", truong: typeof i?.path[0] === "string" ? i.path[0] : "chung" };
}

/** Khoá hàng để so sánh + ghi an toàn: người ghi khác phải chờ ta xong. */
async function khoaHang(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Affiliate" WHERE "id" = ${id} FOR UPDATE`;
}

/** Khoá advisory theo nhân viên — `$executeRaw`, KHÔNG `$queryRaw`: `pg_advisory_xact_lock` trả `void`, Prisma không đọc được cột kiểu đó. */
async function khoaNhanVien(tx: Tx, employeeId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`aff-emp:${employeeId}`}))`;
}

// ── Kiểm tham chiếu (trong transaction, trước phép ghi) ────────────────────────────────────────────────

async function kiemLoai(tx: Tx, typeId: string): Promise<{ requiresApproval: boolean }> {
  const l = await tx.affiliateType.findUnique({ where: { id: typeId }, select: { isActive: true, requiresApproval: true } });
  if (!l) throw new LoiGhiAffiliate("Không tìm thấy loại đối tác này.", "typeId");
  if (!l.isActive) throw new LoiGhiAffiliate("Loại đối tác này đã ngừng — chọn loại khác.", "typeId");
  return l;
}

/** Nhãn MỚI thêm phải tồn tại và đang hoạt động; nhãn đối tác đang giữ mà đã ngừng thì GIỮ NGUYÊN (không kiểm). */
async function kiemNhanMoi(tx: Tx, tagIds: readonly string[]): Promise<void> {
  if (tagIds.length === 0) return;
  const co = await tx.affiliateTag.findMany({ where: { id: { in: [...tagIds] } }, select: { id: true, name: true, isActive: true } });
  if (co.length !== tagIds.length) throw new LoiGhiAffiliate("Có nhãn không tồn tại.", "tagIds");
  const ngung = co.find((t) => !t.isActive);
  if (ngung) throw new LoiGhiAffiliate(`Nhãn «${ngung.name}» đã ngừng — bỏ nhãn này hoặc bật lại ở mục Loại & nhãn.`, "tagIds");
}

async function kiemCoSo(tx: Tx, centerId: string): Promise<void> {
  const c = await tx.center.findUnique({ where: { id: centerId }, select: { isActive: true } });
  if (!c) throw new LoiGhiAffiliate("Không tìm thấy cơ sở này.", "centerId");
  if (!c.isActive) throw new LoiGhiAffiliate("Cơ sở này đã ngừng hoạt động — chọn cơ sở khác.", "centerId");
}

/** Cha phải là TỔ CHỨC chưa kết thúc (và không phải chính đối tác đang sửa). */
async function kiemToChucCha(tx: Tx, parentId: string, chinhNo: string | null): Promise<void> {
  if (chinhNo !== null && parentId === chinhNo) throw new LoiGhiAffiliate("Đối tác không thể thuộc chính nó.", "parentPartyId");
  const p = await tx.affiliate.findUnique({ where: { id: parentId }, select: { partyKind: true, status: true, name: true } });
  if (!p) throw new LoiGhiAffiliate("Không tìm thấy tổ chức này.", "parentPartyId");
  if (p.partyKind !== "ORGANIZATION") throw new LoiGhiAffiliate(`«${p.name}» là cá nhân — chỉ tổ chức mới có thành viên.`, "parentPartyId");
  if (p.status === "ENDED") throw new LoiGhiAffiliate(`Tổ chức «${p.name}» đã kết thúc — không thêm thành viên mới được.`, "parentPartyId");
}

/**
 * Nhân viên phải còn làm việc, và chưa gắn với đối tác nào KHÁC chưa kết thúc. Gọi SAU `khoaNhanVien`.
 * Chỉ gọi khi nhân viên THẬT SỰ đổi: người đã nghỉ không được chặn việc sửa ghi chú của đối tác cũ.
 */
async function kiemNhanVien(tx: Tx, employeeId: string, chinhNo: string | null): Promise<void> {
  const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { status: true } });
  if (!e) throw new LoiGhiAffiliate("Không tìm thấy nhân viên này.", "employeeId");
  if (e.status !== "ACTIVE" && e.status !== "ON_LEAVE") throw new LoiGhiAffiliate("Nhân viên này đã nghỉ việc — chọn người khác.", "employeeId");
  const da = await tx.affiliate.findFirst({
    where: { employeeId, status: { not: "ENDED" }, ...(chinhNo ? { id: { not: chinhNo } } : {}) },
    select: { name: true, code: true },
  });
  if (da) throw new LoiGhiAffiliate(`Nhân viên này đã gắn với đối tác «${da.name}» (${da.code}). Mỗi nhân viên chỉ gắn với một đối tác chưa kết thúc.`, "employeeId");
}

async function kiemMaChuaCo(tx: Tx, ma: string, chinhNo: string | null): Promise<void> {
  const da = await tx.affiliate.findFirst({ where: { code: ma, ...(chinhNo ? { id: { not: chinhNo } } : {}) }, select: { id: true } });
  if (da) throw new LoiGhiAffiliate(`Mã «${ma}» đã có.`, "code");
}

// ── TẠO ─────────────────────────────────────────────────────────────────────────────────────────────

export async function taoDoiTac(p: { nguoi: NguoiGhi; vao: unknown }): Promise<KetQuaTaoDoiTac> {
  const kq = taoDoiTacSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  const m = chuanHoaMaDoiTac(v.code);
  if (!m.ok) return { ok: false, loi: m.loi, truong: "code" };
  const ma = m.ma;
  try {
    const r = await db.$transaction(async (tx) => {
      if (v.employeeId) await khoaNhanVien(tx, v.employeeId);
      const loai = await kiemLoai(tx, v.typeId);
      await kiemNhanMoi(tx, v.tagIds);
      if (v.centerId) await kiemCoSo(tx, v.centerId);
      if (v.parentPartyId) await kiemToChucCha(tx, v.parentPartyId, null);
      if (v.employeeId) await kiemNhanVien(tx, v.employeeId, null);
      await kiemMaChuaCo(tx, ma, null);

      const trangThai = trangThaiKhiTao(loai.requiresApproval);
      const tao = await tx.affiliate.create({
        data: {
          code: ma,
          name: v.name,
          partyKind: v.partyKind,
          typeId: v.typeId,
          phone: v.phone,
          email: v.email,
          note: v.note,
          centerId: v.centerId,
          commissionPercent: v.commissionPercent,
          employeeId: v.employeeId,
          parentPartyId: v.parentPartyId,
          createdById: p.nguoi.userId,
          ...cotTrangThai(trangThai),
          tags: { create: v.tagIds.map((tagId) => ({ tagId })) },
        },
        select: { id: true, code: true, status: true, updatedAt: true },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_AUDIT,
        entityId: tao.id,
        action: "AFFILIATE_TAO",
        newValues: {
          code: ma,
          name: v.name,
          partyKind: v.partyKind,
          status: trangThai,
          typeId: v.typeId,
          tagIds: v.tagIds,
          centerId: v.centerId,
          employeeId: v.employeeId,
          parentPartyId: v.parentPartyId,
        },
        reason: `Tạo đối tác «${v.name}» (${ma})`,
      });
      return tao;
    });
    return { ok: true, id: r.id, ma: r.code, trangThai: r.status, capNhatLuc: r.updatedAt.toISOString() };
  } catch (e) {
    if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
    // Đua tạo cùng mã: người sau nhận P2002 — cũng là «mã đã có», không phải lỗi 500. (Pre-check bắt ca không đua; đây là lưới cho ca đua.)
    if (laLoiTrungKhoa(e)) return { ok: false, loi: `Mã «${ma}» đã có.`, truong: "code" };
    throw e;
  }
}

// ── SỬA ─────────────────────────────────────────────────────────────────────────────────────────────

export async function suaDoiTac(p: {
  nguoi: NguoiGhi;
  id: string;
  /** `updatedAt` mà người sửa ĐÃ THẤY. BẮT BUỘC (luật 7): bỏ qua là bản sửa nào cũng đè được bản kia. */
  updatedAtDaThay: Date;
  vao: unknown;
  /** Lý do — bắt buộc khi ĐỔI MÃ `?ref=` của đối tác đã rời nháp. */
  lyDo: string | null;
}): Promise<KetQuaSuaDoiTac> {
  const kq = suaDoiTacSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  const m = chuanHoaMaDoiTac(v.code);
  if (!m.ok) return { ok: false, loi: m.loi, truong: "code" };
  const maMoi = m.ma;
  try {
    const ra = await db.$transaction(async (tx) => {
      // Khoá nhân viên TRƯỚC khoá hàng, và theo MỘT thứ tự: nhân viên → hàng. Hai người cùng gắn một nhân viên cho hai đối tác khác nhau sẽ tuần tự chứ không đan chéo.
      if (v.employeeId) await khoaNhanVien(tx, v.employeeId);
      await khoaHang(tx, p.id);
      const dong = await tx.affiliate.findUnique({
        where: { id: p.id },
        select: {
          code: true,
          name: true,
          partyKind: true,
          status: true,
          typeId: true,
          phone: true,
          email: true,
          note: true,
          centerId: true,
          commissionPercent: true,
          employeeId: true,
          parentPartyId: true,
          updatedAt: true,
          tags: { select: { tagId: true } },
        },
      });
      if (!dong) throw khongTimThay();
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi();
      // Đối tác ĐÃ KẾT THÚC là hồ sơ đóng: không sửa nữa (kết thúc là cuối, nên mọi liên kết — nhân viên, tổ chức — cũng đã được giải phóng theo nghĩa «chưa kết thúc»).
      if (dong.status === "ENDED") throw new LoiGhiAffiliate("Đối tác đã kết thúc — không sửa được.", "trangThai");

      const truongDoi: string[] = [];
      const doi = <K extends string>(ten: K, cu: unknown, moi: unknown): boolean => {
        if (cu === moi) return false;
        truongDoi.push(ten);
        return true;
      };
      const maDoi = doi("code", dong.code, maMoi);
      doi("name", dong.name, v.name);
      const kieuDoi = doi("partyKind", dong.partyKind, v.partyKind);
      const loaiDoi = doi("typeId", dong.typeId, v.typeId);
      doi("phone", dong.phone, v.phone);
      doi("email", dong.email, v.email);
      doi("note", dong.note, v.note);
      const coSoDoi = doi("centerId", dong.centerId, v.centerId);
      doi("commissionPercent", dong.commissionPercent, v.commissionPercent);
      const nvDoi = doi("employeeId", dong.employeeId, v.employeeId);
      const chaDoi = doi("parentPartyId", dong.parentPartyId, v.parentPartyId);
      const dangGiu = new Set(dong.tags.map((t) => t.tagId));
      const muonGiu = new Set(v.tagIds);
      const them = v.tagIds.filter((t) => !dangGiu.has(t));
      const go = [...dangGiu].filter((t) => !muonGiu.has(t));
      if (them.length > 0 || go.length > 0) truongDoi.push("tagIds");
      if (truongDoi.length === 0) return { doi: false as const, capNhatLuc: dong.updatedAt, truongDoi };

      // ── Cổng: chỉ kiểm cái THẬT SỰ đổi (biểu mẫu gửi lại mọi ô; loại/nhãn/nhân viên đã ngừng không được chặn việc sửa tên) ──────────────
      if (loaiDoi) await kiemLoai(tx, v.typeId);
      await kiemNhanMoi(tx, them);
      if (coSoDoi && v.centerId) await kiemCoSo(tx, v.centerId);
      if (chaDoi && v.parentPartyId) await kiemToChucCha(tx, v.parentPartyId, p.id);
      if (nvDoi && v.employeeId) await kiemNhanVien(tx, v.employeeId, p.id);
      if (kieuDoi && dong.partyKind === "ORGANIZATION") {
        const soThanhVien = await tx.affiliate.count({ where: { parentPartyId: p.id } });
        if (soThanhVien > 0) {
          throw new LoiGhiAffiliate(`Tổ chức đang có ${soThanhVien} cá nhân thuộc về — bỏ liên kết của họ trước khi đổi sang cá nhân.`, "partyKind");
        }
      }
      if (maDoi) {
        if ((await timDoiTacDaCoLead(tx, [p.id])).has(p.id)) {
          throw new LoiGhiAffiliate("Mã này đã có lead — đổi mã sẽ làm chết các link ?ref= đã in. Tạo đối tác mới nếu cần mã khác.", "code");
        }
        await kiemMaChuaCo(tx, maMoi, p.id);
        if (dong.status !== "DRAFT" && (p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_DOI_TAC) {
          throw new LoiGhiAffiliate(`Đổi mã giới thiệu cần lý do từ ${LY_DO_TOI_THIEU_DOI_TAC} ký tự.`, "lyDo");
        }
      }

      const capNhat = await tx.affiliate.update({
        where: { id: p.id },
        data: {
          code: maMoi,
          name: v.name,
          partyKind: v.partyKind,
          typeId: v.typeId,
          phone: v.phone,
          email: v.email,
          note: v.note,
          centerId: v.centerId,
          commissionPercent: v.commissionPercent,
          employeeId: v.employeeId,
          parentPartyId: v.parentPartyId,
          // KHÔNG ghi `status` / `isActive` ở đây — đổi trạng thái có cổng riêng (`doiTrangThaiDoiTac`).
          // Luôn có ít nhất một cột scalar ở trên ⇒ `updatedAt` luôn nhích, kể cả khi chỉ đổi nhãn: nhãn nằm ở bảng nối, không có nó thì khoá lạc quan mất lượt sửa nhãn.
          ...(go.length > 0 || them.length > 0
            ? { tags: { ...(go.length > 0 ? { deleteMany: { tagId: { in: go } } } : {}), ...(them.length > 0 ? { create: them.map((tagId) => ({ tagId })) } : {}) } }
            : {}),
        },
        select: { updatedAt: true },
      });
      // Nhật ký: ô nhạy cảm (SĐT · email · ghi chú) CỐ Ý không có trong `giaTri` ⇒ chỉ ghi «đã đổi», không chép giá trị (nhật ký đọc được rộng hơn trang quản lý). Thêm một ô nhạy cảm
      // mới vào form thì KHÔNG thêm vào bảng này; ca [ADT-DB-07] canh điều đó.
      const cu: Record<string, unknown> = {};
      const moi: Record<string, unknown> = {};
      const giaTri: Record<string, readonly [unknown, unknown]> = {
        code: [dong.code, maMoi],
        name: [dong.name, v.name],
        partyKind: [dong.partyKind, v.partyKind],
        typeId: [dong.typeId, v.typeId],
        centerId: [dong.centerId, v.centerId],
        commissionPercent: [dong.commissionPercent, v.commissionPercent],
        employeeId: [dong.employeeId, v.employeeId],
        parentPartyId: [dong.parentPartyId, v.parentPartyId],
        tagIds: [[...dangGiu].sort(), [...muonGiu].sort()],
      };
      for (const t of truongDoi) {
        const gt = giaTri[t];
        if (!gt) {
          moi[t] = "đã đổi";
        } else {
          cu[t] = gt[0];
          moi[t] = gt[1];
        }
      }
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_AUDIT,
        entityId: p.id,
        action: "AFFILIATE_SUA",
        oldValues: cu,
        newValues: moi,
        changedFields: truongDoi,
        reason: (p.lyDo ?? "").trim() || `Sửa đối tác «${v.name}»`,
      });
      return { doi: true as const, capNhatLuc: capNhat.updatedAt, truongDoi };
    });
    return { ok: true, doi: ra.doi, truongDoi: ra.truongDoi, capNhatLuc: ra.capNhatLuc.toISOString() };
  } catch (e) {
    if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
    if (laLoiTrungKhoa(e)) return { ok: false, loi: `Mã «${maMoi}» đã có.`, truong: "code" };
    throw e;
  }
}

// ── ĐỔI TRẠNG THÁI ──────────────────────────────────────────────────────────────────────────────────

export async function doiTrangThaiDoiTac(p: {
  nguoi: NguoiGhi;
  id: string;
  /** `updatedAt` mà người bấm ĐÃ THẤY. BẮT BUỘC. */
  updatedAtDaThay: Date;
  den: TrangThaiDoiTac;
  lyDo: string | null;
  /** Đồng hồ — ghi `approvedAt` khi duyệt. BẮT BUỘC (luật 19). */
  now: Date;
}): Promise<KetQuaDoiTrangThaiDoiTac> {
  try {
    const ra = await db.$transaction(async (tx) => {
      await khoaHang(tx, p.id);
      const dong = await tx.affiliate.findUnique({
        where: { id: p.id },
        select: { status: true, name: true, code: true, updatedAt: true, type: { select: { requiresApproval: true } } },
      });
      if (!dong) throw khongTimThay();
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi();
      const kiem = kiemDoiTrangThaiDoiTac({ tu: dong.status, den: p.den, lyDo: p.lyDo, loaiCanDuyet: dong.type ? dong.type.requiresApproval : null });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, kiem.truong);

      const duyet = dong.status === "PENDING" && p.den === "ACTIVE";
      const capNhat = await tx.affiliate.update({
        where: { id: p.id },
        data: { ...cotTrangThai(p.den), ...(duyet ? { approvedById: p.nguoi.userId, approvedAt: p.now } : {}) },
        select: { updatedAt: true },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_AUDIT,
        entityId: p.id,
        action: "AFFILIATE_DOI_TRANG_THAI",
        oldValues: { status: dong.status },
        newValues: { status: p.den, ...(duyet ? { approvedById: p.nguoi.userId } : {}) },
        reason: (p.lyDo ?? "").trim() || `Đổi trạng thái đối tác «${dong.name}» (${dong.code})`,
      });
      return capNhat.updatedAt;
    });
    return { ok: true, den: p.den, capNhatLuc: ra.toISOString() };
  } catch (e) {
    if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
    throw e;
  }
}
