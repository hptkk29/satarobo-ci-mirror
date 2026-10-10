/**
 * lib/nguon/danh-muc-ghi.ts — MỘT NƠI GHI danh mục nguồn (`LeadSourceGroup`): `taoNguon` · `suaNguon` · `doiTrangThaiNguon`
 * (SPEC "nguồn động" 09/10/2026 §4). Luật ĐƯỢC/KHÔNG ĐƯỢC ở `danh-muc-ghi-dau-vao.ts` (thuần); tệp này đọc DB rồi ghi.
 *
 * ── Khuôn (chép `bang-nguon-theo-page.ts`) ─────────────────────────────────────────────────────────────
 *  · Quyền do NƠI GỌI kiểm (`sources:manage` ở Server Action). Danh mục là dữ liệu CHUNG (không cơ sở) nên hàm này không có phạm vi cơ sở.
 *  · KHOÁ LẠC QUAN theo `updatedAt` mà người sửa ĐÃ THẤY — nhưng KHÔNG bằng `updateMany({ where: { updatedAt } })`: 9 dòng gốc do migration chèn
 *    bằng `CURRENT_TIMESTAMP` nên mang `updatedAt` ở độ chính xác MICRO-giây, Prisma đọc về MILI-giây ⇒ điều kiện `updatedAt = …` không bao giờ khớp
 *    và MỌI lần sửa nguồn hệ thống báo «vừa được người khác đổi». Nên: khoá hàng (`FOR UPDATE`) → so `getTime()` trong JS → ghi (mẫu của `kichHoat`).
 *    `updatedAtDaThay` BẮT BUỘC, không mặc định (luật 7): bỏ qua là bản sửa nào cũng đè được bản kia.
 *  · MỌI cổng đứng TRƯỚC phép ghi đầu tiên; từ chối trong transaction là `throw LoiGhiNguon` (luật rollback), nơi ngoài bắt và dịch ra kết quả.
 *  · KHOÁ (W2): cả ba hàm mở transaction bằng khoá advisory chính sách (`khoaTapChinhSach`) rồi mới khoá hàng nguồn; cấu hình đọc BẰNG `tx` sau khoá (`docBoiCanhTrongTx`). Thứ tự toàn module: advisory → hàng nguồn → cài đặt.
 *  · CỔNG «ĐỤNG TIỀN» (W2): MỘT hàm `canQuyenKichHoat` cho tạo · sửa · đổi trạng thái (Page: `canQuyenKichHoatGanPage`, `bang-nguon-theo-page.ts`); dữ liệu «nguồn này dính rule nào» đọc ở MỘT chỗ (`dinh-tien-nguon.ts`), màn hình dùng chung.
 *  · `writeAudit` CÙNG transaction, mang `reason` và đúng các trường đổi (cũ → mới).
 *  · Không xoá cứng — không có hàm xoá ở đây, và lưới `[DMG-W*]` đếm: 0 `leadSourceGroup.delete` trong cả cây.
 *
 * ── «Đã dùng» (`docDaDung`) ────────────────────────────────────────────────────────────────────────────
 *  Một nguồn ĐÃ DÙNG nếu BẤT KỲ thứ nào sau còn tham chiếu nó: attribution (hiện hành HOẶC nguồn gốc) · touchpoint · phiên bản chính sách phạm vi
 *  nguồn · dòng sổ hoa hồng (theo id HOẶC mã chụp) · bảng Page→nguồn (tham chiếu theo MÃ — đổi mã là mồ côi hoá Page) · setting nhóm nhân sự mặc định
 *  (cũng theo MÃ). Hàm đọc này là MỘT chỗ duy nhất: màn hình vẽ ô khoá bằng đúng nó (luật 12).
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { khoaChinhSach as khoaTapChinhSach, kiemChinhSachKhiBatHoaHongNguon, vanTayTapChinhSachActive } from "@/lib/hoa-hong/chinh-sach-service";
import { getSettingDef, type SettingDef } from "@/lib/settings/registry";
import { resolveSettingValue } from "@/lib/settings/resolve";
import { dinhTienCuaNguon, docDinhTienNguon, ruleChuChayChoNguon } from "./dinh-tien-nguon";
import { layBangNguonTheoPage, layNhomNhanSuMacDinh } from "./feature";
import { KHOA_NGUON } from "./khoa-setting";
import { maDichMacDinh } from "./quy-nguon";
import {
  CAU_THIEU_QUYEN_KICH_HOAT,
  canQuyenKichHoat,
  chanBoChuNguon,
  chanNguonHoatDongKhongChu,
  chanTatHoaHongNguon,
  nguonDangDinhTienTheoRule,
  kiemCode,
  kiemDoiTrangThai,
  kiemSuaNguon,
  lamHongDichMacDinh,
  suaNguonSchema,
  taoNguonSchema,
  tenHanhDongSua,
  tenHanhDongTrangThai,
  type GiaTriNguon,
  type TrangThaiNguon,
  type TruongSua,
} from "./danh-muc-ghi-dau-vao";

type Tx = Prisma.TransactionClient;
type Khach = PrismaClient | Tx;

export type NguoiGhiNguon = { userId: string; ten: string };

const MODULE_AUDIT = "nguon-hoa-hong";
const ENTITY_AUDIT = "LeadSourceGroup";

/** Ô mà lỗi gắn vào: tên trường sửa được, hoặc ô phụ của biểu mẫu. */
export type OLoiNguon = TruongSua | "lyDo" | "trangThai" | "vuaDoi" | "khongTimThay" | "chung" | "name" | "quyen";

export type ThatBaiNguon = { ok: false; loi: string; truong: OLoiNguon };

class LoiGhiNguon extends Error {
  constructor(
    readonly truong: OLoiNguon,
    message: string,
  ) {
    super(message);
    this.name = "LoiGhiNguon";
  }
}

const khongTimThay = (): LoiGhiNguon => new LoiGhiNguon("khongTimThay", "Không tìm thấy nguồn này.");
const vuaDoi = (): LoiGhiNguon => new LoiGhiNguon("vuaDoi", "Nguồn vừa được người khác thay đổi — hãy tải lại rồi thử lại.");

// ── Đã dùng ──────────────────────────────────────────────────────────────────────────────────

export type NguonDaDung = {
  attribution: boolean;
  touchpoint: boolean;
  phienBanChinhSach: boolean;
  so: boolean;
  page: boolean;
  nhomNhanSuMacDinh: boolean;
  /** Bất kỳ thứ gì ở trên. */
  daDung: boolean;
};

/**
 * Nguồn này đã được dùng chưa. ĐỌC. Mỗi nguồn 4 câu tồn tại (`findFirst … select id`) + hai setting; không đếm.
 * `bangPage` / `nhomMacDinh` truyền vào để một danh sách nhiều nguồn chỉ đọc setting MỘT lần.
 */
export async function docDaDung(
  client: Khach,
  g: { id: string; code: string },
  boiCanh: { bangPage: Readonly<Record<string, { groupCode: string }>>; nhomMacDinh: string },
): Promise<NguonDaDung> {
  const [attribution, touchpoint, phienBan, so] = await Promise.all([
    client.leadAttribution.findFirst({ where: { OR: [{ groupId: g.id }, { originalGroupId: g.id }] }, select: { id: true } }),
    client.leadTouchpoint.findFirst({ where: { claimedGroupId: g.id }, select: { id: true } }),
    client.commissionPolicyVersion.findFirst({ where: { scopeSourceGroupId: g.id }, select: { id: true } }),
    client.commissionTransaction.findFirst({ where: { OR: [{ sourceGroupId: g.id }, { sourceGroupCode: g.code }] }, select: { id: true } }),
  ]);
  const page = Object.values(boiCanh.bangPage).some((m) => m.groupCode === g.code);
  const macDinh = boiCanh.nhomMacDinh === g.code;
  const r = {
    attribution: attribution !== null,
    touchpoint: touchpoint !== null,
    phienBanChinhSach: phienBan !== null,
    so: so !== null,
    page,
    nhomNhanSuMacDinh: macDinh,
  };
  return { ...r, daDung: Object.values(r).some(Boolean) };
}

type BoiCanhDaDung = { bangPage: Readonly<Record<string, { groupCode: string }>>; nhomMacDinh: string };

/** Bối cảnh ĐỌC cho màn hình (qua cache cài đặt, trễ tối đa vài phút — đủ cho việc VẼ; KHÔNG dùng cho cổng ghi, xem `docBoiCanhTrongTx`). */
async function docBoiCanhDaDung(): Promise<BoiCanhDaDung> {
  const [bangPage, nhomMacDinh] = await Promise.all([layBangNguonTheoPage(), layNhomNhanSuMacDinh()]);
  return { bangPage, nhomMacDinh };
}

/**
 * Bối cảnh cho CỔNG GHI: đọc THẲNG `SystemSetting` bằng `tx`, KHÔNG qua `getSetting`. Hai lý do (W2, res3 R3-M5): (1) `getSetting` đi qua cache liên-request nên một lượt đọc «trong transaction» vẫn có thể thấy
 * bảng Page→nguồn / nhóm nhân sự mặc định CŨ — đúng cái cổng `lamHongDichMacDinh` cần chốt; (2) đọc ngoài transaction cho phép `luuNguonCuaPage` gán Page vào nguồn trong lúc ta ngừng/đổi mã nguồn ấy
 * ⇒ Page mồ côi, lead rơi UNKNOWN, không lỗi nào báo. Gọi SAU khi đã lấy khoá advisory + khoá hàng: người ghi bảng Page (cũng giữ khoá advisory) phải chờ ta xong. Giá trị hỏng/thiếu ⇒ mặc định
 * của registry (cùng `resolveSettingValue` với đường đọc).
 */
async function docBoiCanhTrongTx(tx: Tx): Promise<BoiCanhDaDung> {
  const rows = await tx.systemSetting.findMany({ where: { key: { in: [KHOA_NGUON.bangNguonTheoPage, KHOA_NGUON.nhomNhanSuMacDinh] } }, select: { key: true, valueJson: true } });
  const lay = <T,>(key: string): T => {
    const def = getSettingDef(key) as SettingDef<T> | undefined;
    if (!def) throw new Error(`Unknown setting key: ${key}`);
    return resolveSettingValue({ def, globalRow: rows.find((r) => r.key === key) ?? null });
  };
  return { bangPage: lay<BoiCanhDaDung["bangPage"]>(KHOA_NGUON.bangNguonTheoPage), nhomMacDinh: lay<string>(KHOA_NGUON.nhomNhanSuMacDinh) };
}

/** Một hàm đọc cho cả lệnh sửa lẫn màn hình: nguồn + trạng thái «đã dùng». */
export async function docNguonVaDaDung(code: string): Promise<{ nguon: Prisma.LeadSourceGroupGetPayload<Record<string, never>>; daDung: NguonDaDung } | null> {
  const nguon = await db.leadSourceGroup.findUnique({ where: { code } });
  if (!nguon) return null;
  return { nguon, daDung: await docDaDung(db, nguon, await docBoiCanhDaDung()) };
}

// ── Kiểm tra tham chiếu ngoài ─────────────────────────────────────────────────────────────────

/** Người phụ trách phải là nhân sự CÒN LÀM VIỆC; trả cảnh báo (không chặn) nếu chưa có tài khoản — engine sẽ TREO phần của họ. */
async function kiemNguoiPhuTrach(client: Khach, employeeId: string): Promise<string[]> {
  const e = await client.employee.findUnique({ where: { id: employeeId }, select: { status: true, userAccount: { select: { id: true } } } });
  if (!e) throw new LoiGhiNguon("ownerEmployeeId", "Không tìm thấy nhân sự phụ trách.");
  if (e.status !== "ACTIVE" && e.status !== "ON_LEAVE") throw new LoiGhiNguon("ownerEmployeeId", "Nhân sự này đã nghỉ việc — chọn người khác.");
  return e.userAccount ? [] : ["NGUOI_PHU_TRACH_CHUA_CO_TAI_KHOAN"];
}

async function kiemDonVi(client: Khach, orgUnitId: string): Promise<void> {
  const o = await client.orgUnit.findFirst({ where: { id: orgUnitId, deletedAt: null }, select: { id: true } });
  if (!o) throw new LoiGhiNguon("ownerOrgUnitId", "Không tìm thấy đơn vị sở hữu nguồn.");
}

/** Mã đã có (KHÔNG phân biệt hoa/thường) — loại trừ chính dòng đang sửa. */
async function maDaCo(client: Khach, code: string, tru?: string): Promise<boolean> {
  const r = await client.leadSourceGroup.findFirst({
    where: { code: { equals: code, mode: "insensitive" }, ...(tru ? { id: { not: tru } } : {}) },
    select: { id: true },
  });
  return r !== null;
}

const laLoiTrungMa = (e: unknown): boolean => {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const dich = (e.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(dich) ? dich.includes("code") : typeof dich === "string" && dich.includes("code");
};

function loiTuZod(e: { issues: readonly { path: PropertyKey[]; message: string }[] }): ThatBaiNguon {
  const i = e.issues[0];
  const truong = (typeof i?.path[0] === "string" ? i.path[0] : "chung") as OLoiNguon;
  return { ok: false, loi: i?.message ?? "Dữ liệu không hợp lệ.", truong };
}

const aud = (n: NguoiGhiNguon) => ({ id: n.userId, name: n.ten });

/** Khoá hàng để so sánh + ghi an toàn. `FOR UPDATE` chặn người ghi khác VÀ chặn chèn attribution mới (FK KEY SHARE) cho tới khi ta xong. */
async function khoaHangNguon(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "LeadSourceGroup" WHERE "id" = ${id} FOR UPDATE`;
}

const anhChup = (g: GiaTriNguon): Record<string, unknown> => ({
  code: g.code,
  name: g.name,
  description: g.description,
  sourceType: g.sourceType,
  referrerRequirement: g.referrerRequirement,
  requiresNote: g.requiresNote,
  selectable: g.selectable,
  sortOrder: g.sortOrder,
  attributionWindowDays: g.attributionWindowDays,
  commissionEnabled: g.commissionEnabled,
  ownerOrgUnitId: g.ownerOrgUnitId,
  ownerEmployeeId: g.ownerEmployeeId,
  effectiveFrom: g.effectiveFrom?.toISOString() ?? null,
  effectiveTo: g.effectiveTo?.toISOString() ?? null,
});

type DongNguon = Prisma.LeadSourceGroupGetPayload<Record<string, never>>;
const giaTriTuDong = (r: DongNguon): GiaTriNguon => ({
  code: r.code,
  name: r.name,
  description: r.description,
  sourceType: r.sourceType,
  referrerRequirement: r.referrerRequirement,
  requiresNote: r.requiresNote,
  selectable: r.selectable,
  sortOrder: r.sortOrder,
  attributionWindowDays: r.attributionWindowDays,
  commissionEnabled: r.commissionEnabled,
  ownerOrgUnitId: r.ownerOrgUnitId,
  ownerEmployeeId: r.ownerEmployeeId,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
});

// ── TẠO ──────────────────────────────────────────────────────────────────────────────────────

export type KetQuaTaoNguon = { ok: true; id: string; code: string; updatedAt: string; canhBao: string[] } | ThatBaiNguon;

export async function taoNguon(p: {
  nguoi: NguoiGhiNguon;
  vao: unknown;
  /**
   * Người tạo có `commission_policies:activate` không (action hỏi `checkPermission`, KHÔNG phải hàm này). BẮT BUỘC, không mặc định (luật 7): tạo nguồn HOẠT ĐỘNG có người phụ trách khi rule SOURCE_OWNER đang
   * chạy là bắt đầu trả tiền cho người đó ngay từ lead đầu tiên — cùng cổng «đụng tiền» với sửa / đổi trạng thái (`canQuyenKichHoat`). Tạo bản NHÁP thì không đòi: tiền chưa chảy; lúc KÍCH HOẠT sẽ đòi.
   */
  coQuyenKichHoat: boolean;
}): Promise<KetQuaTaoNguon> {
  const kq = taoNguonSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  try {
    // Cổng đọc — ngoài transaction, đứng trước phép ghi duy nhất.
    const loiMa = kiemCode(v.code);
    if (loiMa) throw new LoiGhiNguon("code", loiMa);
    if (await maDaCo(db, v.code)) throw new LoiGhiNguon("code", `Mã «${v.code}» đã có (mã không phân biệt hoa/thường).`);
    const canhBao: string[] = [];
    if (v.ownerEmployeeId) canhBao.push(...(await kiemNguoiPhuTrach(db, v.ownerEmployeeId)));
    if (v.ownerOrgUnitId) await kiemDonVi(db, v.ownerOrgUnitId);

    const tao = await db.$transaction(async (tx) => {
      // Khoá advisory CHUNG với kích hoạt chính sách (`kichHoat`) và mọi lệnh ghi nguồn: «rule SOURCE_OWNER có đang chạy không» đọc dưới đây phải thấy kết quả ĐÃ COMMIT của người kích hoạt, và người kích hoạt
      // đến sau thấy nguồn ta tạo. Thứ tự khoá toàn module: advisory → hàng nguồn → cài đặt (08 §14 mục 5).
      await khoaTapChinhSach(tx);
      const dt = await docDinhTienNguon(tx, []);
      const ruleChuChay = ruleChuChayChoNguon(dt, null);
      // Cổng trước phép ghi đầu tiên: nguồn Hoạt động không người phụ trách khi rule SOURCE_OWNER (phạm vi chung) đang chạy ⇒ hold vĩnh viễn ngay từ lead đầu tiên.
      const chanChu = chanNguonHoatDongKhongChu({ viec: "tao", trangThaiSau: v.trangThai, ownerSau: v.ownerEmployeeId, ruleChuNguonDangChay: ruleChuChay });
      if (chanChu) throw new LoiGhiNguon(chanChu.truong, chanChu.loi);
      // Cổng QUYỀN «đụng tiền»: nguồn ACTIVE có chủ + rule chủ-nguồn đang chạy ⇒ người này nhận tiền ngay. Nháp thì chưa (xem `canQuyenKichHoat`).
      const dangDinhTien = nguonDangDinhTienTheoRule({ chinhSachRieng: false, coChu: v.ownerEmployeeId !== null, ruleChuChay });
      if (canQuyenKichHoat({ truongDoi: v.trangThai === "ACTIVE" ? ["status"] : [], chinhSachDangChay: false, daCoDongSo: false, dangDinhTienTheoRule: dangDinhTien }) && !p.coQuyenKichHoat) {
        throw new LoiGhiNguon("quyen", CAU_THIEU_QUYEN_KICH_HOAT);
      }
      const r = await tx.leadSourceGroup.create({
        data: {
          code: v.code,
          name: v.name,
          description: v.description,
          sourceType: v.sourceType,
          referrerRequirement: v.referrerRequirement,
          requiresNote: v.requiresNote,
          selectable: v.selectable,
          isSystem: false,
          sortOrder: v.sortOrder,
          status: v.trangThai,
          attributionWindowDays: v.attributionWindowDays,
          commissionEnabled: v.commissionEnabled,
          ownerOrgUnitId: v.ownerOrgUnitId,
          ownerEmployeeId: v.ownerEmployeeId,
          effectiveFrom: v.effectiveFrom,
          effectiveTo: v.effectiveTo,
          createdById: p.nguoi.userId,
          updatedById: p.nguoi.userId,
        },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT,
        entityType: ENTITY_AUDIT,
        entityId: r.id,
        action: "NGUON_TAO",
        newValues: { ...anhChup(giaTriTuDong(r)), status: r.status },
        reason: `Tạo nguồn «${r.name}» (${r.code})`,
      });
      return r;
    });
    return { ok: true, id: tao.id, code: tao.code, updatedAt: tao.updatedAt.toISOString(), canhBao };
  } catch (e) {
    if (e instanceof LoiGhiNguon) return { ok: false, loi: e.message, truong: e.truong };
    // Đua tạo cùng mã: người sau nhận P2002 — cũng là «mã đã có», không phải lỗi 500. (Pre-check bắt ca không đua; đây là lưới cho ca đua.)
    if (laLoiTrungMa(e)) return { ok: false, loi: `Mã «${v.code}» đã có.`, truong: "code" };
    throw e;
  }
}

// ── SỬA ──────────────────────────────────────────────────────────────────────────────────────

export type KetQuaSuaNguon = { ok: true; doi: boolean; truongDoi: TruongSua[]; updatedAt: string; canhBao: string[] } | ThatBaiNguon;

export async function suaNguon(p: {
  nguoi: NguoiGhiNguon;
  id: string;
  /** `updatedAt` mà người sửa ĐÃ THẤY. BẮT BUỘC. */
  updatedAtDaThay: Date;
  vao: unknown;
  lyDo: string | null;
  /**
   * Người sửa có `commission_policies:activate` không (action hỏi `checkPermission`, KHÔNG phải hàm này — quyền là việc của nơi gọi). BẮT BUỘC, không mặc định (luật 7): đổi người
   * phụ trách / tham gia hoa hồng / cửa sổ ghi công / trạng thái hiển thị của nguồn ĐANG DÍNH TIỀN cần quyền này ngoài `sources:manage` (res4 HIGH-1; W2 mở rộng sang khả năng nhận lead).
   */
  coQuyenKichHoat: boolean;
  /** Đồng hồ — BẮT BUỘC (luật 19): nguồn là đích mặc định không đặt được hiệu lực có hạn. */
  now: Date;
}): Promise<KetQuaSuaNguon> {
  const kq = suaNguonSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const patch = kq.data;
  try {
    const canhBao: string[] = [];

    // BẬT LẠI `commissionEnabled` (false → true): chính sách phạm vi nguồn đang ACTIVE mà bị bỏ qua vì cờ tắt sẽ chạy lại NGAY — kiểm trần/chồng lấn bằng CHÍNH guardrail kích hoạt
    // (`kiemChinhSachKhiBatHoaHongNguon`) TRƯỚC khi ghi. Lưới ngữ cảnh nặng nên chạy NGOÀI transaction (trần 5 giây của Prisma), rồi trong transaction lấy khoá advisory của tập chính sách
    // và so lại dấu vân tay — cùng khuôn `kichHoat` (res3 MEDIUM-4).
    const truocDoi = await db.leadSourceGroup.findUnique({ where: { id: p.id }, select: { commissionEnabled: true } });
    const canKiemKhiBat = patch.commissionEnabled === true && truocDoi?.commissionEnabled === false;
    const kiemKhiBat = canKiemKhiBat ? await kiemChinhSachKhiBatHoaHongNguon(db, { groupId: p.id, now: p.now }) : null;
    if (kiemKhiBat && kiemKhiBat.loi.length > 0) {
      throw new LoiGhiNguon("commissionEnabled", `Không bật «tham gia hoa hồng» được: ${kiemKhiBat.loi.map((l) => l.thongBao).join(" | ")}`);
    }

    const ra = await db.$transaction(async (tx) => {
      // Thứ tự khoá TOÀN module (08 §14 mục 5): advisory → hàng nguồn → cài đặt. Advisory luôn lấy (không chỉ khi bật cờ): các cổng dưới đọc «chính sách / rule nào đang ACTIVE» và bảng Page→nguồn, và
      // phải đọc chúng khi không ai khác đang kích hoạt chính sách hay gán Page (cả hai cũng giữ khoá này).
      await khoaTapChinhSach(tx);
      await khoaHangNguon(tx, p.id);
      const dong = await tx.leadSourceGroup.findUnique({ where: { id: p.id } });
      if (!dong) throw khongTimThay();
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi();

      // Bảng Page→nguồn và nhóm nhân sự mặc định đọc LẠI trong transaction, SAU khoá — đọc trước khoá là đọc bản cũ của người gán Page đang chạy song song (R3-M5).
      const boiCanh = await docBoiCanhTrongTx(tx);
      const hienTai = giaTriTuDong(dong);
      const daDung = await docDaDung(tx, dong, boiCanh);
      const kiem = kiemSuaNguon({
        nguon: { code: dong.code, isSystem: dong.isSystem, daDung: daDung.daDung, status: dong.status },
        hienTai,
        patch,
        lyDo: p.lyDo,
      });
      if (!kiem.ok) throw new LoiGhiNguon(kiem.truong, kiem.loi);
      if (kiem.truongDoi.length === 0) return { doi: false as const, row: dong, truongDoi: [] as TruongSua[] };

      // Cổng QUYỀN theo mức dính tiền (res4 HIGH-1): đọc LẠI trong transaction, trước phép ghi đầu tiên. MỘT lần đọc cho mọi câu hỏi «nguồn này dính rule nào» (`docDinhTienNguon`).
      const dt = await docDinhTienNguon(tx, [dong.id]);
      const dtNguon = dinhTienCuaNguon(dt, dong.id);
      const ruleChuChay = ruleChuChayChoNguon(dt, dong.id);
      const doiChu = kiem.truongDoi.includes("ownerEmployeeId");
      // Chặn tuyệt đối (kể cả người có đủ quyền kích hoạt): bỏ trống chủ khi rule SOURCE_OWNER đang chạy là TẠO hold vĩnh viễn, không phải việc cần thêm quyền.
      const chanChu = chanBoChuNguon({ truongDoi: kiem.truongDoi, ownerMoi: patch.ownerEmployeeId ?? null, ruleChuNguonDangChay: ruleChuChay });
      if (chanChu) throw new LoiGhiNguon(chanChu.truong, chanChu.loi);
      // Chặn tuyệt đối: TẮT cờ khi chính sách riêng có dòng thu hút ⇒ tiền biến mất không báo (R1-M1).
      const chanTat = chanTatHoaHongNguon({ truongDoi: kiem.truongDoi, commissionEnabledMoi: patch.commissionEnabled, coDongThuHutRieng: dtNguon.coDongThuHutRieng });
      if (chanTat) throw new LoiGhiNguon(chanTat.truong, chanTat.loi);
      const dangDinhTien = nguonDangDinhTienTheoRule({ chinhSachRieng: dtNguon.chinhSachRieng, coChu: dong.ownerEmployeeId !== null, ruleChuChay });
      if (
        canQuyenKichHoat({
          truongDoi: kiem.truongDoi,
          // Rule vai SOURCE_OWNER ở phạm vi CHUNG cũng trả cho chủ của MỌI nguồn ⇒ đổi chủ một nguồn là đổi người nhận tiền ở đó, nên với `ownerEmployeeId` nhìn rule ở BẤT KỲ phạm vi nào.
          chinhSachDangChay: dtNguon.chinhSachRieng || (doiChu && dt.ruleChuBatKy),
          daCoDongSo: daDung.so,
          dangDinhTienTheoRule: dangDinhTien,
        }) &&
        !p.coQuyenKichHoat
      ) {
        throw new LoiGhiNguon("quyen", CAU_THIEU_QUYEN_KICH_HOAT);
      }

      // Chỉ kiểm tham chiếu ngoài khi nó THẬT SỰ đổi: biểu mẫu gửi lại mọi ô, người phụ trách đã nghỉ không được chặn việc sửa tên nguồn.
      if (kiem.truongDoi.includes("ownerEmployeeId") && patch.ownerEmployeeId) canhBao.push(...(await kiemNguoiPhuTrach(tx, patch.ownerEmployeeId)));
      if (kiem.truongDoi.includes("ownerOrgUnitId") && patch.ownerOrgUnitId) await kiemDonVi(tx, patch.ownerOrgUnitId);
      if (patch.code !== undefined && kiem.truongDoi.includes("code") && (await maDaCo(tx, patch.code, dong.id))) {
        throw new LoiGhiNguon("code", `Mã «${patch.code}» đã có (mã không phân biệt hoa/thường).`);
      }
      const hongDich = lamHongDichMacDinh({
        code: dong.code,
        dichMacDinh: maDichMacDinh({ nhomNhanSuMacDinh: boiCanh.nhomMacDinh, bangPage: boiCanh.bangPage }),
        now: p.now,
        selectableMoi: kiem.truongDoi.includes("selectable") ? patch.selectable : undefined,
        hieuLucMoi:
          kiem.truongDoi.includes("effectiveFrom") || kiem.truongDoi.includes("effectiveTo")
            ? { effectiveFrom: patch.effectiveFrom !== undefined ? patch.effectiveFrom : dong.effectiveFrom, effectiveTo: patch.effectiveTo !== undefined ? patch.effectiveTo : dong.effectiveTo }
            : undefined,
      });
      if (hongDich) throw new LoiGhiNguon(hongDich.truong, hongDich.loi);

      if (canKiemKhiBat || (kiem.truongDoi.includes("commissionEnabled") && patch.commissionEnabled === true)) {
        // Cờ đổi false→true trong transaction mà bản kiểm ngoài transaction không phải của đúng lượt này, hoặc tập chính sách đã đổi từ lúc kiểm ⇒ kết quả kiểm đã cũ.
        if (!kiemKhiBat || (await vanTayTapChinhSachActive(tx)) !== kiemKhiBat.vanTay) {
          throw new LoiGhiNguon("commissionEnabled", "Tập chính sách hoa hồng vừa thay đổi trong lúc kiểm trần — thử lại.");
        }
      }

      const data: Prisma.LeadSourceGroupUncheckedUpdateInput = { updatedById: p.nguoi.userId };
      for (const k of kiem.truongDoi) (data as Record<string, unknown>)[k] = patch[k];
      const moi = await tx.leadSourceGroup.update({ where: { id: dong.id }, data });

      const cu: Record<string, unknown> = {};
      const nay: Record<string, unknown> = {};
      const motCu = anhChup(hienTai);
      const motMoi = anhChup(giaTriTuDong(moi));
      for (const k of kiem.truongDoi) {
        cu[k] = motCu[k];
        nay[k] = motMoi[k];
      }
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT,
        entityType: ENTITY_AUDIT,
        entityId: dong.id,
        action: tenHanhDongSua(kiem.truongDoi),
        oldValues: cu,
        newValues: nay,
        changedFields: [...kiem.truongDoi],
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `Sửa nguồn «${dong.name}»`,
      });
      return { doi: true as const, row: moi, truongDoi: kiem.truongDoi };
    });
    return { ok: true, doi: ra.doi, truongDoi: ra.truongDoi, updatedAt: ra.row.updatedAt.toISOString(), canhBao };
  } catch (e) {
    if (e instanceof LoiGhiNguon) return { ok: false, loi: e.message, truong: e.truong };
    if (laLoiTrungMa(e)) return { ok: false, loi: "Mã nguồn đã có.", truong: "code" };
    throw e;
  }
}

// ── ĐỔI TRẠNG THÁI ───────────────────────────────────────────────────────────────────────────

export type KetQuaDoiTrangThai = { ok: true; tu: TrangThaiNguon; den: TrangThaiNguon; updatedAt: string } | ThatBaiNguon;

export async function doiTrangThaiNguon(p: {
  nguoi: NguoiGhiNguon;
  id: string;
  updatedAtDaThay: Date;
  den: TrangThaiNguon;
  lyDo: string | null;
  /**
   * Người đổi có `commission_policies:activate` không (action hỏi `checkPermission`). BẮT BUỘC, không mặc định (luật 7): kích hoạt / ngừng / lưu trữ / khôi phục một nguồn đang có chính sách ACTIVE hoặc có
   * chủ-hưởng-theo-rule là đổi mọi lead MỚI được trả theo chính sách nào (W2, res3 R3-M3) — cùng cổng `canQuyenKichHoat` với sửa nguồn.
   */
  coQuyenKichHoat: boolean;
  /** Đồng hồ — BẮT BUỘC (luật 19). */
  now: Date;
}): Promise<KetQuaDoiTrangThai> {
  try {
    const ra = await db.$transaction(async (tx) => {
      await khoaTapChinhSach(tx); // advisory → hàng nguồn → cài đặt: cùng thứ tự với mọi lệnh ghi nguồn / chính sách / Page
      await khoaHangNguon(tx, p.id);
      const dong = await tx.leadSourceGroup.findUnique({ where: { id: p.id } });
      if (!dong) throw khongTimThay();
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi();

      const kiem = kiemDoiTrangThai({ nguon: { code: dong.code, isSystem: dong.isSystem, status: dong.status }, den: p.den, lyDo: p.lyDo });
      if (!kiem.ok) throw new LoiGhiNguon(kiem.truong, kiem.loi);
      const boiCanh = await docBoiCanhTrongTx(tx); // SAU khoá: bảng Page→nguồn không đổi dưới chân cổng đích-mặc-định
      const hongDich = lamHongDichMacDinh({
        code: dong.code,
        dichMacDinh: maDichMacDinh({ nhomNhanSuMacDinh: boiCanh.nhomMacDinh, bangPage: boiCanh.bangPage }),
        now: p.now,
        den: p.den,
      });
      if (hongDich) throw new LoiGhiNguon(hongDich.truong, hongDich.loi);
      const dt = await docDinhTienNguon(tx, [dong.id]);
      const ruleChuChay = ruleChuChayChoNguon(dt, dong.id);
      // Kích hoạt nguồn chưa có người phụ trách khi rule SOURCE_OWNER đang chạy (của chính nguồn hoặc phạm vi chung) ⇒ chặn trước phép ghi.
      const chanChu = chanNguonHoatDongKhongChu({ viec: "kich-hoat", trangThaiSau: p.den, ownerSau: dong.ownerEmployeeId, ruleChuNguonDangChay: ruleChuChay });
      if (chanChu) throw new LoiGhiNguon(chanChu.truong, chanChu.loi);
      // Cổng QUYỀN «đụng tiền»: trạng thái là khả năng nhận lead — đòi quyền khi nguồn có chính sách riêng ACTIVE, hoặc có chủ mà rule chủ-nguồn đang chạy.
      const dangDinhTien = nguonDangDinhTienTheoRule({ chinhSachRieng: dinhTienCuaNguon(dt, dong.id).chinhSachRieng, coChu: dong.ownerEmployeeId !== null, ruleChuChay });
      if (canQuyenKichHoat({ truongDoi: ["status"], chinhSachDangChay: false, daCoDongSo: false, dangDinhTienTheoRule: dangDinhTien }) && !p.coQuyenKichHoat) {
        throw new LoiGhiNguon("quyen", CAU_THIEU_QUYEN_KICH_HOAT);
      }

      const moi = await tx.leadSourceGroup.update({ where: { id: dong.id }, data: { status: p.den, updatedById: p.nguoi.userId } });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT,
        entityType: ENTITY_AUDIT,
        entityId: dong.id,
        action: tenHanhDongTrangThai(dong.status, p.den),
        oldValues: { status: dong.status },
        newValues: { status: moi.status },
        changedFields: ["status"],
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `Kích hoạt nguồn «${dong.name}»`,
      });
      return { tu: dong.status, row: moi };
    });
    return { ok: true, tu: ra.tu, den: p.den, updatedAt: ra.row.updatedAt.toISOString() };
  } catch (e) {
    if (e instanceof LoiGhiNguon) return { ok: false, loi: e.message, truong: e.truong };
    throw e;
  }
}
