/**
 * lib/affiliate/doi-tac-phu-huynh.ts — PHỤ HUYNH TỰ THAM GIA chương trình giới thiệu ở cổng phụ huynh (`/portal/gioi-thieu`).
 *
 * ── Vì sao có (chủ dự án chốt 25/11/2026) ─────────────────────────────────────────────────────────────────────────────────────────
 * *"cả PH và nhân sự đều phải đồng ý quy định chứ, và bất kỳ ai đều được tự lấy link để aff chứ không phải cần admin thêm làm đối tác thì mới lấy được link aff nữa"*.
 * Trước đó phụ huynh chỉ vào được khi Admin tạo hồ sơ đối tác + nối tài khoản + ghi danh + duyệt; người chưa là đối tác gặp 404. Nay: phụ huynh đọc quy định ⇒ «Tôi đã đọc và
 * đồng ý» ⇒ vào ngay, KHÔNG CÓ BƯỚC DUYỆT (cùng luật với nhân sự — `doi-tac-nhan-su.ts`), kể cả khi loại đối tác đặt «cần duyệt». Chỉ TẠM NGỪNG / KẾT THÚC của người quản lý mới chặn.
 *
 * ── Không có đường ghi thứ hai ─────────────────────────────────────────────────────────────────────────────────────────────────
 * «Tôi đồng ý» = `taoDoiTac` + `doiTrangThaiDoiTac` + `lienKetUser` + `themMembership` + `doiTrangThaiMembership` (CÙNG các hàm của màn quản trị — khoá lạc quan, cổng chuyển trạng thái,
 * nhật ký), người thực hiện = chính phụ huynh. Chạy lại bao nhiêu lần cũng hội tụ: hồ sơ tự tạo nhận ra bằng `Affiliate.createdById = userId` (phụ huynh không có đường nào khác để tạo hồ sơ).
 *
 * ── Chương trình nào ──────────────────────────────────────────────────────────────────────────────────────────────────────────
 * KHÔNG gõ cứng mã, KHÔNG thêm setting: suy từ DỮ LIỆU theo nguồn kiểu «phụ huynh giới thiệu» (`LeadSourceGroup.referrerRequirement = PARENT`) — loại đối tác ĐANG BẬT có nguồn mặc định
 * là nguồn đó, và campaign ĐANG CHẠY có nguồn mặc định là nguồn đó. Phải ra ĐÚNG MỘT mỗi thứ; 0 hay nhiều ⇒ không mở (không đoán). Đo prod 25/11/2026: nguồn PARENT_REFERRAL, loại
 * PH_GIOITHIEU có sẵn, CHƯA có campaign nào ⇒ Admin phải tạo + kích hoạt một campaign có nguồn mặc định «Phụ huynh giới thiệu» thì phụ huynh mới thấy mục «Giới thiệu».
 *
 * ── Ai ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Tài khoản phụ huynh (trang gác PARENT; lõi gác thêm bằng `kiemUserLienKetDuoc` — tài khoản nhân viên bị từ chối TRƯỚC khi tạo gì). Phụ huynh đã là đối tác (Admin thêm từ trước) giữ
 * nguyên như cũ, không phải đồng ý lại (giống nhân sự đã tham gia từ trước).
 *
 * ⚠️ Giới hạn đã biết: hai lượt bấm ĐỒNG THỜI của cùng một người (hai tab) có thể tạo hai hồ sơ — các hàm ghi tái dùng tự mở transaction riêng nên không khoá chung được. Nút khoá khi đang gửi;
 * nếu xảy ra, Admin kết thúc hồ sơ thừa ở màn đối tác.
 */
import { randomInt } from "node:crypto";

import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";

import { MODULE_AUDIT_AFFILIATE, aud, type NguoiGhi } from "./chung";
import { docGioiThieuCuaToi } from "./doc-cua-toi";
import type { GioiThieuCuaToi } from "./cua-toi";
import { hopCoAffiliate, laAffiliateBatTho } from "./feature";
import { doiTrangThaiDoiTac, taoDoiTac } from "./ghi-doi-tac";
import { doiTrangThaiMembership, themMembership } from "./ghi-membership";
import { PHIEN_BAN_QUY_DINH_PHU_HUYNH, type QuyDinhChuongTrinh } from "./quy-dinh-nhan-su";
import { partyIdsVaoDuoc } from "./tai-khoan-truy-cap";
import { kiemUserLienKetDuoc } from "./tai-khoan-truy-cap-dau-vao";
import { lienKetUser } from "./tai-khoan-truy-cap-ghi";
import { laQuanLyNguonBat } from "@/lib/nguon/feature";

/** Cờ Affiliate hiệu lực (AND cờ nguồn) — cùng phép với `doc-cua-toi.ts`. Đọc hỏng ⇒ tắt. */
async function affiliateBat(): Promise<boolean> {
  const [nguon, affiliate] = await Promise.all([laQuanLyNguonBat().catch(() => false), laAffiliateBatTho().catch(() => false)]);
  return hopCoAffiliate({ nguon, affiliate });
}

export const LOI_CHUA_CAU_HINH_PH = "Chương trình giới thiệu cho phụ huynh chưa mở — liên hệ trung tâm.";
export const LY_DO_PH_BI_CHAN = "Tài khoản giới thiệu của bạn đang tạm ngừng hoặc đã kết thúc. Liên hệ trung tâm để được hỗ trợ.";
const LY_DO_TU_THAM_GIA = "Phụ huynh đồng ý quy định và tự tham gia chương trình giới thiệu (không cần duyệt — chủ dự án chốt 25/11/2026).";

type CauHinhPhuHuynh = { typeId: string; campaignId: string };

/** Loại đối tác + campaign dành cho phụ huynh — ĐÚNG MỘT mỗi thứ, hoặc null (đầu tệp). */
export async function docCauHinhPhuHuynh(): Promise<CauHinhPhuHuynh | null> {
  const nguon = await db.leadSourceGroup.findMany({ where: { referrerRequirement: "PARENT" }, select: { id: true } });
  if (nguon.length === 0) return null;
  const ids = nguon.map((n) => n.id);
  const [loai, camp] = await Promise.all([
    db.affiliateType.findMany({ where: { isActive: true, defaultSourceGroupId: { in: ids } }, select: { id: true }, take: 2 }),
    db.affiliateCampaign.findMany({ where: { status: "ACTIVE", defaultSourceGroupId: { in: ids } }, select: { id: true }, take: 2 }),
  ]);
  if (loai.length !== 1 || camp.length !== 1) return null;
  return { typeId: loai[0]!.id, campaignId: camp[0]!.id };
}

async function docQuyDinh(campaignId: string): Promise<QuyDinhChuongTrinh | null> {
  const c = await db.affiliateCampaign.findUnique({ where: { id: campaignId }, select: { name: true, cookieWindowDays: true, protectWindowDays: true, allowSelfReferral: true } });
  return c ? { campaignTen: c.name, nhoKhachNgay: c.cookieWindowDays, baoVeNgay: c.protectWindowDays, choTuGioiThieu: c.allowSelfReferral } : null;
}

/** Hồ sơ do CHÍNH tài khoản này tự tạo (lượt đồng ý trước), cũ nhất trước. */
function hoSoTuTao(userId: string) {
  return db.affiliate.findFirst({ where: { createdById: userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, status: true, updatedAt: true } });
}

/** Người quản lý đã chặn tài khoản này chưa: cổng bị TẠM NGỪNG, hoặc hồ sơ tự tạo bị tạm ngừng / kết thúc, hoặc tài khoản đã bị GỠ khỏi chính hồ sơ tự tạo. */
async function biChan(userId: string): Promise<boolean> {
  const [cong, ho] = await Promise.all([db.affiliatePartyUser.count({ where: { userId, status: "SUSPENDED" } }), hoSoTuTao(userId)]);
  if (cong > 0) return true;
  if (!ho) return false;
  if (ho.status === "SUSPENDED" || ho.status === "ENDED") return true;
  const dong = await db.affiliatePartyUser.findUnique({ where: { partyId_userId: { partyId: ho.id, userId } }, select: { status: true } });
  return dong !== null && dong.status !== "ACTIVE";
}

/**
 * Mục «Giới thiệu» trên menu cổng: cờ BẬT ∧ (đã là đối tác ∨ chương trình phụ huynh đang mở). Menu hiện mà trang 404 là lời hứa suông (luật 12) — trang đi qua cùng hai vế
 * (`docTrangGioiThieuPhuHuynh`). Cờ kiểm TRƯỚC; câu cấu hình chỉ chạy khi chưa là đối tác.
 */
export async function coMucGioiThieu(userId: string): Promise<boolean> {
  if (!(await affiliateBat())) return false;
  if ((await partyIdsVaoDuoc(userId)).length > 0) return true;
  return (await docCauHinhPhuHuynh()) !== null;
}

export type TrangGioiThieuPhuHuynh =
  | { loai: "KHONG_CO" }
  | { loai: "DOI_TAC"; data: GioiThieuCuaToi }
  | { loai: "CHUA_THAM_GIA"; quyDinh: QuyDinhChuongTrinh }
  | { loai: "BI_CHAN"; lyDo: string };

/** Dữ liệu trang `/portal/gioi-thieu`. `KHONG_CO` ⇒ 404 (cờ tắt, hoặc chưa là đối tác mà chương trình phụ huynh chưa mở). */
export async function docTrangGioiThieuPhuHuynh(userId: string, now: Date): Promise<TrangGioiThieuPhuHuynh> {
  const data = await docGioiThieuCuaToi(userId, now);
  if (data !== null) return { loai: "DOI_TAC", data };
  if (!(await affiliateBat())) return { loai: "KHONG_CO" };
  const cauHinh = await docCauHinhPhuHuynh();
  if (!cauHinh) return { loai: "KHONG_CO" };
  if (await biChan(userId)) return { loai: "BI_CHAN", lyDo: LY_DO_PH_BI_CHAN };
  const quyDinh = await docQuyDinh(cauHinh.campaignId);
  return quyDinh ? { loai: "CHUA_THAM_GIA", quyDinh } : { loai: "KHONG_CO" };
}

export type KetQuaThamGiaPhuHuynh = { ok: true } | { ok: false; loi: string };

/** Bảng chữ của mã: bỏ 0/O/1/I/L cho dễ đọc khi đọc mã qua điện thoại. */
const CHU_MA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function maNgauNhien(): string {
  let s = "PH";
  for (let i = 0; i < 6; i++) s += CHU_MA[randomInt(CHU_MA.length)];
  return s;
}

/**
 * «Tôi đã đọc và đồng ý» của phụ huynh — tạo (hoặc dùng lại) hồ sơ giới thiệu của chính mình, nối tài khoản làm NGƯỜI ĐẠI DIỆN, đưa hồ sơ + tư cách tham gia campaign phụ huynh về
 * ĐANG HOẠT ĐỘNG, rồi ghi dấu đồng ý (AuditLog kèm phiên bản văn bản). Không có bước duyệt.
 */
export async function thamGiaGioiThieuPhuHuynh(p: { nguoi: NguoiGhi; now: Date }): Promise<KetQuaThamGiaPhuHuynh> {
  const userId = p.nguoi.userId;
  if (!(await affiliateBat())) return { ok: false, loi: "Chương trình giới thiệu đang tắt." };
  if ((await partyIdsVaoDuoc(userId)).length > 0) return { ok: true }; // đã là đối tác — không đụng gì
  const cauHinh = await docCauHinhPhuHuynh();
  if (!cauHinh) return { ok: false, loi: LOI_CHUA_CAU_HINH_PH };
  if (await biChan(userId)) return { ok: false, loi: LY_DO_PH_BI_CHAN };

  // Chỉ tài khoản phụ huynh: tài khoản nhân viên bị từ chối TRƯỚC khi tạo hồ sơ (không để lại hồ sơ mồ côi).
  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, phone: true, isActive: true, deletedAt: true, accountStatus: true, role: true, roles: true } });
  const cong = kiemUserLienKetDuoc(user);
  if (!cong.ok) return { ok: false, loi: cong.loi };

  // 1) Hồ sơ giới thiệu — có sẵn (lượt trước dở dang) thì dùng, không thì tạo với mã ngẫu nhiên (KHÔNG suy từ SĐT: mã nằm trong link gửi đi).
  let dt = await hoSoTuTao(userId);
  if (!dt) {
    const ten = (user!.name ?? "").trim();
    const so = (user!.phone ?? "").replace(/\D/g, "");
    for (let lan = 0; lan < 5 && !dt; lan++) {
      const tao = await taoDoiTac({
        nguoi: p.nguoi,
        vao: {
          partyKind: "PERSON",
          name: ten.length >= 2 ? ten.slice(0, 120) : "Phụ huynh",
          typeId: cauHinh.typeId,
          tagIds: [],
          code: maNgauNhien(),
          phone: so.length >= 8 && so.length <= 15 ? so : null,
          email: null,
          note: "Phụ huynh tự tham gia ở cổng phụ huynh («Giới thiệu bạn bè»).",
          centerId: null,
          commissionPercent: null,
          employeeId: null,
          parentPartyId: null,
        },
      });
      if (!tao.ok && tao.truong !== "code") return { ok: false, loi: tao.loi };
      if (tao.ok) dt = await hoSoTuTao(userId);
    }
    if (!dt) return { ok: false, loi: "Chưa tạo được hồ sơ giới thiệu — thử lại sau ít giây." };
  }

  // 2) Nháp → chờ duyệt → hoạt động bằng chính hàm chuyển trạng thái của màn quản trị (loại «cần duyệt» không cho nháp nhảy thẳng sang hoạt động).
  for (const den of ["PENDING", "ACTIVE"] as const) {
    if (dt.status === "ACTIVE") break;
    if (dt.status !== "DRAFT" && dt.status !== "PENDING") return { ok: false, loi: LY_DO_PH_BI_CHAN };
    if (dt.status === "PENDING" && den === "PENDING") continue;
    const doi = await doiTrangThaiDoiTac({ nguoi: p.nguoi, id: dt.id, updatedAtDaThay: dt.updatedAt, den, lyDo: LY_DO_TU_THAM_GIA, now: p.now });
    if (!doi.ok) return { ok: false, loi: doi.loi };
    dt = { id: dt.id, status: den, updatedAt: new Date(doi.capNhatLuc) };
  }
  const partyId = dt.id;

  // 3) Nối tài khoản làm người đại diện (chưa nối thì nối; đã nối mà không ACTIVE thì `biChan` ở trên đã chặn).
  const dong = await db.affiliatePartyUser.findUnique({ where: { partyId_userId: { partyId, userId } }, select: { status: true } });
  if (!dong) {
    const noi = await lienKetUser({ nguoi: p.nguoi, vao: { partyId, userId, vai: "REPRESENTATIVE" }, now: p.now });
    if (!noi.ok) return { ok: false, loi: noi.loi };
  }

  // 4) Tư cách tham gia campaign phụ huynh.
  const timTv = () =>
    db.affiliateMembership.findUnique({ where: { partyId_campaignId: { partyId, campaignId: cauHinh.campaignId } }, select: { id: true, status: true, updatedAt: true } });
  let tv = await timTv();
  if (tv?.status === "SUSPENDED") return { ok: false, loi: LY_DO_PH_BI_CHAN };
  if (!tv || tv.status === "ENDED") {
    const them = await themMembership({ nguoi: p.nguoi, campaignId: cauHinh.campaignId, vao: { partyId, groupLabel: null, effectiveFrom: null, effectiveTo: null }, now: p.now });
    if (!them.ok) return { ok: false, loi: them.loi };
    tv = await timTv();
    if (!tv) return { ok: false, loi: "Không đọc lại được tư cách tham gia vừa tạo — thử lại." };
  }
  if (tv.status === "PENDING") {
    const doi = await doiTrangThaiMembership({ nguoi: p.nguoi, id: tv.id, updatedAtDaThay: tv.updatedAt, den: "ACTIVE", lyDo: LY_DO_TU_THAM_GIA, now: p.now });
    if (!doi.ok) return { ok: false, loi: doi.loi };
  }

  // 5) Dấu đồng ý quy định (phiên bản văn bản).
  await writeAudit({
    actor: aud(p.nguoi),
    module: MODULE_AUDIT_AFFILIATE,
    entityType: "Affiliate",
    entityId: partyId,
    action: "AFFILIATE_PHU_HUYNH_DONG_Y_QUY_DINH",
    newValues: { phienBanQuyDinh: PHIEN_BAN_QUY_DINH_PHU_HUYNH, campaignId: cauHinh.campaignId, userId },
    reason: `Phụ huynh đồng ý quy định chương trình giới thiệu (bản ${PHIEN_BAN_QUY_DINH_PHU_HUYNH})`,
  });
  return { ok: true };
}
