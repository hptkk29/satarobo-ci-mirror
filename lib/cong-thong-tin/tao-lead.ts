import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { findRecentDuplicate, logDuplicateAttempt } from "@/lib/lead/dedup";
import { autoAssignNewLead } from "@/lib/lead/auto-assign";
import { chuanBiQuyNguon, ghiNguonDenSauChoLeadCu, ghiQuyNguonLeadMoi } from "@/lib/nguon/noi-day";
import { KHONG_CO_TIN_HIEU_NGUON } from "@/lib/nguon/tin-hieu";
import { maLoiAnToan } from "@/lib/disc/crm";
import { logLeadAudit } from "@/lib/audit/log";
import { CHON_PH_LEAD, type PhLead } from "@/lib/students/dong-bo-lead";
import { dongBoTuLead } from "@/lib/students/dong-bo-lead-db";
import { chuanBiGioiThieuKhiGui, ghiSauKhiGui } from "@/lib/affiliate/gioi-thieu-bieu-mau";
import { coSoNhanLeadTheoMa, giaoLeadChoSaleGioiThieu } from "@/lib/lead/giao-lead-sale-gioi-thieu";
import type { PhieuHopLe } from "./phieu";

/**
 * Tạo / gộp LEAD từ phiếu «để lại thông tin» của Tủ sách + Sức khỏe (07/11/2026). Đi đúng khuôn của `lib/disc/crm-that.ts`:
 * chuẩn bị quy nguồn TRƯỚC giao dịch → lead + nguồn cùng MỘT giao dịch → chia lead SAU commit (chia theo phường/xã nằm trong `autoAssignNewLead`).
 *
 * Luật giữ nguyên từ DISC (F-09/F-13/F-15):
 *  - `consentMarketing` luôn FALSE: người gõ SĐT chưa chứng minh là chủ số; ô «nhận thông tin chương trình học» chỉ ghi vào ghi chú cho Sale biết ý muốn;
 *  - KHÔNG gọi Meta CAPI / GA4 / `lib/tracking`;
 *  - ghi chú lead KHÔNG chứa dữ liệu sức khỏe — chỉ nói «để lại thông tin để tải sách / xem kết quả»;
 *  - log chỉ ghi MÃ lỗi (`maLoiAnToan`), không bao giờ đối tượng lỗi (lỗi Prisma hay mang giá trị cột: SĐT, tên).
 *
 * Địa chỉ nơi ở ghi vào `Lead.city/ward/addressLine` — đúng các cột mà chia lead theo phường đọc.
 */

export type KetQuaTaoLead = { leadId: string; laLeadMoi: boolean };

const TRAN_DAU_VET_TRUNG_MOI_NGAY = 5;

const NHAN_NGUON = {
  "tu-sach": { trang: "/tu-sach", ghiChu: "Tủ sách gia đình — để lại thông tin để tải sách" },
  "suc-khoe": { trang: "/suc-khoe", ghiChu: "Sức khỏe cả nhà — để lại thông tin để nhận kết quả" },
} as const;

/** Cùng SĐT + cùng nguồn + cùng ngày VN ⇒ cùng eventId ⇒ bấm gửi hai lần không sinh hai lead. */
export function eventIdCongThongTin(nguon: PhieuHopLe["nguon"], soDienThoai: string, bayGio: Date): string {
  const ngayVn = new Date(bayGio.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  const dau = createHash("sha256").update(`${soDienThoai}|${nguon}|${ngayVn}`).digest("hex").slice(0, 20);
  return `ctt:${nguon}:${dau}`;
}

export function ghiChuLead(p: PhieuHopLe): string {
  const nhan = NHAN_NGUON[p.nguon];
  const ngCanh = p.nguCanh ? ` (${p.nguCanh})` : "";
  const tiepThi = p.tiepThi ? " Người gõ có tích ô nhận thông tin chương trình học (chưa xác thực chủ số)." : "";
  return `${nhan.ghiChu}${ngCanh}.${tiepThi}`;
}

/**
 * Tín hiệu GIỚI THIỆU của lượt gửi (link `/r/<token>` của nhân sự / đối tác): cookie `sr_aff` + header `Origin`. BẮT BUỘC khai (luật 7):
 * hộp công khai truyền từ request; đường cổng phụ huynh (đã đăng nhập, `lib/portal/tu-sach.ts`) truyền `null` tường minh.
 * Chủ dự án 20/11/2026: gửi là ghi nhận ngay, không đợi xác thực (xem `lib/affiliate/gioi-thieu-bieu-mau.ts`).
 */
export type TinHieuGioiThieuGui = { cookieGioiThieu: string | null; origin: string | null } | null;

export async function taoLeadTuCong(p: PhieuHopLe, tinHieuGioiThieu: TinHieuGioiThieuGui, bayGio: () => Date = () => new Date()): Promise<KetQuaTaoLead> {
  const eventId = eventIdCongThongTin(p.nguon, p.soDienThoai, bayGio());
  const gioiThieu = tinHieuGioiThieu
    ? await chuanBiGioiThieuKhiGui({
        cookieGioiThieu: tinHieuGioiThieu.cookieGioiThieu,
        origin: tinHieuGioiThieu.origin,
        phone: p.soDienThoai,
        idempotencyKey: eventId,
        now: bayGio(),
        nhanLog: "cong-thong-tin",
      })
    : null;

  const trung = await findRecentDuplicate(p.soDienThoai);
  if (trung) {
    await ghiLeadTrung(trung.id, p, bayGio);
    // Khách đã có hồ sơ ⇒ người ghi nhận đầu tiên giữ công (REJECTED_DUPLICATE trỏ về lead cũ).
    await ghiSauKhiGui({ gioiThieu, leadId: trung.id, laLeadMoi: false, centerId: null, now: bayGio(), nhanLog: "cong-thong-tin" });
    return { leadId: trung.id, laLeadMoi: false };
  }

  const [nguon] = await chuanBiQuyNguon(db, [
    {
      bayGio: bayGio(),
      duongVao: "web",
      conversionEntry: p.nguon,
      nhanKhai: null,
      laNhapExcel: false,
      sdtKhach: p.soDienThoai,
      maNvNguoiNhap: null,
      nguoiNhapUserId: null,
      nhanSuGioiThieuEmployeeId: null,
      phuHuynhGioiThieu: null,
      affiliate: gioiThieu?.tinHieu ?? null,
      ref: null,
      refSau: [],
      quangCao: { ...KHONG_CO_TIN_HIEU_NGUON.quangCao },
      utm: { ...KHONG_CO_TIN_HIEU_NGUON.utm }, // KHÔNG đặt utm: tín hiệu utm sẽ đẩy lead sang nhóm quảng cáo
      pageId: null,
      orgUnitId: null,
      centerId: null,
    },
  ]);

  const nhan = NHAN_NGUON[p.nguon];
  let leadId: string;
  let centerId: string | null;
  let laLeadMoi = true;
  try {
    const lead = await db.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          parentName: p.hoTen,
          phone: p.soDienThoai,
          lastInboundAt: bayGio(),
          source: "web",
          status: "MOI",
          landingPage: nhan.trang,
          eventId,
          consentMarketing: false,
          note: ghiChuLead(p),
          city: p.diaChi.thanhPho,
          ward: p.diaChi.phuong,
          addressLine: p.diaChi.soNha ?? undefined,
        },
      });
      await ghiQuyNguonLeadMoi(tx, created.id, nguon!, null);
      return created;
    });
    leadId = lead.id;
    centerId = lead.centerId ?? null;
  } catch (err) {
    // Hai lượt đua cùng eventId: lượt thua lấy lead của lượt thắng, KHÔNG tạo lead thứ hai.
    if ((err as { code?: unknown }).code !== "P2002") throw err;
    const co = await db.lead.findUnique({ where: { eventId }, select: { id: true, centerId: true } });
    if (!co) throw err;
    leadId = co.id;
    centerId = co.centerId ?? null;
    laLeadMoi = false;
  }

  // Lead mang eventId của CHÍNH lượt gửi này ⇒ trạng thái theo luật quy nguồn đã thắng. Lượt đua thua (P2002): cùng eventId = cùng idempotencyKey ⇒ không đẻ dòng thứ hai.
  await ghiSauKhiGui({ gioiThieu, leadId, laLeadMoi: true, centerId, now: bayGio(), nhanLog: "cong-thong-tin" });

  // Link của SALE ⇒ giao thẳng cho Sale đó, không tiêu lượt (20/11/2026). Không phải ⇒ chia như cũ (theo phường rồi chia đều).
  const daGiaoChoSale =
    laLeadMoi &&
    (await giaoLeadChoSaleGioiThieu({
      leadId,
      coSoKhachChon: await coSoNhanLeadTheoMa(p.diaChi.coSoGanNha).catch(() => null),
      nguoiGioiThieu: gioiThieu?.nguoiNhanLead ?? null,
      nhanLog: "cong-thong-tin",
    }));
  if (laLeadMoi && !daGiaoChoSale) {
    await autoAssignNewLead(leadId, { actorId: null, actorName: `Hệ thống (${p.nguon})` }).catch((e: unknown) => {
      const ma = maLoiAnToan(e);
      console.error("[cong-thong-tin] auto-assign:", ma);
    });
  }
  return { leadId, laLeadMoi };
}

/** SĐT đã là lead còn sống: KHÔNG tạo lead thứ hai; ghi dấu «nhập lại» (có trần mỗi ngày) và bổ sung địa chỉ nếu phiếu cũ chưa có. */
async function ghiLeadTrung(leadId: string, p: PhieuHopLe, bayGio: () => Date): Promise<void> {
  try {
    const cho = await rateLimit({ key: `ctt-dup:${leadId}`, max: TRAN_DAU_VET_TRUNG_MOI_NGAY, windowMs: 86_400_000 });
    if (cho.success) {
      await logDuplicateAttempt(leadId, p.soDienThoai, "web", { kieu: "gop" });
      await ghiNguonDenSauChoLeadCu(
        db,
        leadId,
        {
          kind: "NHAP_LAI",
          conversionEntry: p.nguon,
          nhanKhai: null,
          ref: null,
          quangCao: { ...KHONG_CO_TIN_HIEU_NGUON.quangCao },
          utm: { ...KHONG_CO_TIN_HIEU_NGUON.utm },
          pageId: null,
          nguoiGioiThieu: null,
        },
        null,
        p.nguon,
      );
    }
    // Chỉ ĐIỀN CHỖ TRỐNG: phiếu lạ không được ghi đè địa chỉ đã có.
    await boSungDiaChiLead(leadId, p.diaChi, p.nguon, bayGio());
  } catch (err) {
    const ma = maLoiAnToan(err);
    console.error("[cong-thong-tin] ghi lead trùng:", ma);
  }
}

const NGUOI_DONG_BO = { id: null, name: "Hệ thống (cổng để lại thông tin)" } as const;

/**
 * Bổ sung phường/xã (và tỉnh, số nhà nếu đang trống) cho một lead ĐÃ CÓ — chỉ điền chỗ trống, không bao giờ ghi đè.
 * ĐỊA CHỈ là ô chung giữa học viên ↔ phiếu lead ("đổi 1 nơi thì đổi hết", `lib/students/dong-bo-lead.ts`): ghi lead mà không dội sang học viên đang nối
 * thì hai bên lệch nhau, nên phép ghi + vết kiểm toán + `dongBoTuLead` nằm trong CÙNG một giao dịch.
 * Trả `true` khi đã điền.
 */
export async function boSungDiaChiLead(
  leadId: string,
  diaChi: PhieuHopLe["diaChi"],
  /** Nơi khai: «tu-sach» · «suc-khoe» · «disc» — chỉ để ghi vào lý do nhật ký. */
  nguon: PhieuHopLe["nguon"] | "disc",
  bayGio: Date,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const truoc = await tx.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: CHON_PH_LEAD });
    if (!truoc) return false;
    const trong = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";
    if (!trong(truoc.ward)) return false; // đã có phường/xã ⇒ không đụng
    const sau: Partial<PhLead> = { ward: diaChi.phuong };
    if (trong(truoc.city)) sau.city = diaChi.thanhPho;
    if (diaChi.soNha && trong(truoc.addressLine)) sau.addressLine = diaChi.soNha;
    // Điều kiện còn nằm TRONG phép ghi: hai lượt đua nhau thì chỉ một lượt điền được.
    const ghi = await tx.lead.updateMany({
      where: { id: leadId, OR: [{ ward: null }, { ward: "" }] },
      data: { ...sau, lastInboundAt: bayGio },
    });
    if (ghi.count === 0) return false;
    await logLeadAudit({
      leadId,
      action: "UPDATE",
      actorId: NGUOI_DONG_BO.id,
      actorName: NGUOI_DONG_BO.name,
      oldValues: Object.fromEntries(Object.keys(sau).map((k) => [k, (truoc as Record<string, unknown>)[k] ?? null])),
      newValues: { ...sau },
      changedFields: Object.keys(sau),
      reason: `Bổ sung phường/xã từ cổng để lại thông tin (${nguon})`,
      tx,
    });
    await dongBoTuLead({ tx, leadId, truoc: truoc as PhLead, sau, actor: NGUOI_DONG_BO });
    return true;
  });
}
