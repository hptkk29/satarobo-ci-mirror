/**
 * lib/affiliate/doi-tac-nhan-su.ts — «LINK GIỚI THIỆU CỦA TÔI» cho NHÂN SỰ (yêu cầu BGĐ 20/11/2026: mọi nhân sự tự tạo link giới thiệu của mình).
 *
 * ── Quyền = DỮ LIỆU SỞ HỮU, không phải khoá RBAC ───────────────────────────────────────────────────────────────────────────────
 * Cùng mô hình với cổng đối tác của phụ huynh (`/portal/gioi-thieu`): người dùng chỉ chạm đối tác CỦA CHÍNH MÌNH. Ở đây «của mình» = `Affiliate.employeeId` = hồ sơ nhân sự
 * gắn với tài khoản đang đăng nhập (`User.employeeId`), hồ sơ còn làm việc (ACTIVE · ON_LEAVE). `userId` LẤY TỪ PHIÊN ở nơi gọi; không hàm nào ở đây nhận `partyId`/`employeeId` từ client.
 * Đối tác nhân sự trên prod gắn theo HỒ SƠ NHÂN SỰ chứ không theo tài khoản (đo 21/11/2026: 8/8 đối tác nhân sự `employeeId` có, `userId` trống, 0 dòng `AffiliatePartyUser`) —
 * nên KHÔNG dùng `partyIdsVaoDuoc` (cổng phụ huynh) ở đây, và cũng KHÔNG sửa hàm đó.
 *
 * ── Không có đường ghi thứ hai ─────────────────────────────────────────────────────────────────────────────────────────────────
 *  · Tạo link: `tuTaoLinkTrongDoiTac` → `phatLink` (CÙNG lõi với cổng phụ huynh và tab Link của Admin — khoá, `kiemChuoiLink`, hạn mức, nhật ký).
 *  · «Tôi đồng ý» (`thamGiaLinkGioiThieu`): `taoDoiTac` + `doiTrangThaiDoiTac` + `themMembership` + `doiTrangThaiMembership` (CÙNG các hàm của màn quản trị). KHÔNG CÓ BƯỚC DUYỆT
 *    [chủ dự án chốt 21/11/2026 — đảo bản 20/11 «membership chờ duyệt»]: đọc quy định, đồng ý là vào luôn; chỉ TẠM NGỪNG của người quản lý mới chặn.
 *  · Loại đối tác + campaign KHÔNG gõ cứng mã: chọn từ DỮ LIỆU theo nhóm nguồn nhân sự mặc định (`nguon.nhomNhanSuMacDinh`) — loại đang bật có nguồn mặc định là nhóm đó, và campaign ĐANG CHẠY
 *    có nguồn mặc định là nhóm đó. Phải ra ĐÚNG MỘT; 0 hay nhiều ⇒ từ chối, không đoán (đo 21/11/2026: prod NHANVIEN + AFF_QUATANG, test NHANSU + AFF_2111_NHANSU — mỗi bên đúng một).
 */
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { laQuanLyNguonBat, layNhomNhanSuMacDinh } from "@/lib/nguon/feature";
import type { LinkCuaToi, TaoLinkCuaToi } from "./cua-toi";
import { MODULE_AUDIT_AFFILIATE, aud, type NguoiGhi } from "./chung";
import { docDanhSachLink, docLinkChoQrTrongDoiTac, docTuyChonPhatLink } from "./doc-link";
import { chuanHoaMaDoiTac } from "./ghi-doi-tac-dau-vao";
import { hopCoAffiliate, laAffiliateBatTho } from "./feature";
import { doiTrangThaiDoiTac, taoDoiTac } from "./ghi-doi-tac";
import { thuHoiLink, type KetQuaPhatLink, type KetQuaThuHoiLink } from "./ghi-link";
import type { TrangThaiLink } from "./ghi-link-dau-vao";
import { doiTrangThaiMembership, themMembership } from "./ghi-membership";
import { gocCongKhai } from "./goc-cong-khai";
import { PHIEN_BAN_QUY_DINH_NHAN_SU, type QuyDinhChuongTrinh } from "./quy-dinh-nhan-su";
import { tuTaoLinkTrongDoiTac } from "./tu-tao-link";

/** Cờ module Affiliate hiệu lực (AND cờ nguồn) — CÙNG phép với cổng phụ huynh (`doc-cua-toi.ts`). Đọc hỏng ⇒ tắt. Màn, action đọc/ghi cùng hỏi hàm này. */
export async function linkGioiThieuBat(): Promise<boolean> {
  const [nguon, affiliate] = await Promise.all([laQuanLyNguonBat().catch(() => false), laAffiliateBatTho().catch(() => false)]);
  return hopCoAffiliate({ nguon, affiliate });
}

/** Trần số link đọc lên màn (mỗi đối tác) — cùng cỡ với cổng phụ huynh. */
const TOI_DA_LINK = 100;

export type NhanSuCuaToi = { employeeId: string; ten: string; maNv: string };

/** Hồ sơ nhân sự CÒN LÀM VIỆC gắn với tài khoản, hoặc null. */
export async function docNhanSuCuaToi(userId: string): Promise<NhanSuCuaToi | null> {
  const u = await db.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { employee: { select: { id: true, fullName: true, employeeCode: true, status: true } } },
  });
  const e = u?.employee;
  if (!e || (e.status !== "ACTIVE" && e.status !== "ON_LEAVE")) return null;
  return { employeeId: e.id, ten: e.fullName, maNv: e.employeeCode };
}

/** Đối tác (chưa kết thúc) của hồ sơ nhân sự gắn với tài khoản. Mỗi nhân sự tối đa MỘT đối tác chưa kết thúc (`kiemNhanVien` ở `ghi-doi-tac.ts`). */
export async function partyIdsCuaNhanSu(userId: string): Promise<string[]> {
  const nv = await docNhanSuCuaToi(userId);
  if (!nv) return [];
  const ds = await db.affiliate.findMany({ where: { employeeId: nv.employeeId, status: { not: "ENDED" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  return ds.map((d) => d.id);
}

// ── Cấu hình suy từ dữ liệu ──────────────────────────────────────────────────────────────────────────────────────

export const LOI_CHUA_CAU_HINH = "Chương trình link giới thiệu cho nhân sự chưa được cấu hình đúng — liên hệ Marketing hoặc Quản trị hệ thống.";

type CauHinhNhanSu = { typeId: string; campaignId: string; campaignTen: string };

/** Loại đối tác + campaign dành cho nhân sự — ĐÚNG MỘT mỗi thứ, hoặc null (đầu tệp). */
export async function docCauHinhNhanSu(): Promise<CauHinhNhanSu | null> {
  const maNhom = await layNhomNhanSuMacDinh();
  const nhom = await db.leadSourceGroup.findUnique({ where: { code: maNhom }, select: { id: true } });
  if (!nhom) return null;
  const [loai, camp] = await Promise.all([
    db.affiliateType.findMany({ where: { isActive: true, defaultSourceGroupId: nhom.id }, select: { id: true }, take: 2 }),
    db.affiliateCampaign.findMany({ where: { status: "ACTIVE", defaultSourceGroupId: nhom.id }, select: { id: true, name: true }, take: 2 }),
  ]);
  if (loai.length !== 1 || camp.length !== 1) return null;
  return { typeId: loai[0]!.id, campaignId: camp[0]!.id, campaignTen: camp[0]!.name };
}

// ── ĐỌC — dữ liệu của màn ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Bốn trạng thái của màn. KHÔNG còn trạng thái «chờ duyệt»: chủ dự án chốt 21/11/2026 — nhân sự đọc quy định, bấm «Tôi đồng ý» là vào luôn, không ai phải duyệt.
 *  · `CHUA_THAM_GIA`: chưa có hồ sơ, hồ sơ nháp/chờ duyệt (dữ liệu của luồng cũ), hoặc chưa ở trong / đã rời campaign nhân sự ⇒ vẽ quy định + nút «Tôi đồng ý».
 *    `quyDinh = null` ⇒ cấu hình (loại + campaign nhân sự) không ra ĐÚNG MỘT: không vẽ nút (máy chủ sẽ từ chối).
 *  · `BI_CHAN`: Marketing/Quản trị đã TẠM NGỪNG hồ sơ hoặc tư cách tham gia — đó là lệnh dừng của người quản lý, không phải hàng chờ duyệt; «Tôi đồng ý» KHÔNG mở lại.
 *  · `DA_THAM_GIA`: hồ sơ + tư cách tham gia đều đang hoạt động ⇒ hai tab (link theo trang đích · khách mang về).
 */
export type LinkGioiThieuCuaToi =
  | { loai: "KHONG_NHAN_SU" }
  | { loai: "CHUA_THAM_GIA"; nhanSu: NhanSuCuaToi; quyDinh: QuyDinhChuongTrinh | null }
  | { loai: "BI_CHAN"; nhanSu: NhanSuCuaToi; doiTac: { ten: string; ma: string }; lyDo: string }
  | { loai: "DA_THAM_GIA"; nhanSu: NhanSuCuaToi; doiTac: { ten: string; ma: string }; link: LinkCuaToi[]; taoLink: TaoLinkCuaToi };

export const LY_DO_HO_SO_TAM_NGUNG = "Hồ sơ giới thiệu của bạn đang bị tạm ngừng. Liên hệ Marketing hoặc Quản trị hệ thống.";
export const LY_DO_THAM_GIA_TAM_NGUNG = "Bạn đang bị tạm ngừng trong chương trình link giới thiệu. Liên hệ Marketing hoặc Quản trị hệ thống.";

async function docCampaignQuyDinh(campaignId: string): Promise<QuyDinhChuongTrinh | null> {
  const c = await db.affiliateCampaign.findUnique({ where: { id: campaignId }, select: { name: true, cookieWindowDays: true, protectWindowDays: true, allowSelfReferral: true } });
  return c ? { campaignTen: c.name, nhoKhachNgay: c.cookieWindowDays, baoVeNgay: c.protectWindowDays, choTuGioiThieu: c.allowSelfReferral } : null;
}

export async function docLinkGioiThieuCuaToi(userId: string, now: Date): Promise<LinkGioiThieuCuaToi> {
  const nhanSu = await docNhanSuCuaToi(userId);
  if (!nhanSu) return { loai: "KHONG_NHAN_SU" };
  const [dt, cauHinh] = await Promise.all([
    db.affiliate.findFirst({ where: { employeeId: nhanSu.employeeId, status: { not: "ENDED" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, code: true, status: true } }),
    docCauHinhNhanSu(),
  ]);
  const chuaThamGia = async (): Promise<LinkGioiThieuCuaToi> => ({ loai: "CHUA_THAM_GIA", nhanSu, quyDinh: cauHinh ? await docCampaignQuyDinh(cauHinh.campaignId) : null });
  if (!dt || dt.status === "DRAFT" || dt.status === "PENDING") return chuaThamGia();
  const doiTac = { ten: dt.name, ma: dt.code };
  if (dt.status !== "ACTIVE") return { loai: "BI_CHAN", nhanSu, doiTac, lyDo: LY_DO_HO_SO_TAM_NGUNG };
  if (!cauHinh) return chuaThamGia();
  const tv = await db.affiliateMembership.findUnique({ where: { partyId_campaignId: { partyId: dt.id, campaignId: cauHinh.campaignId } }, select: { status: true } });
  if (tv?.status === "SUSPENDED") return { loai: "BI_CHAN", nhanSu, doiTac, lyDo: LY_DO_THAM_GIA_TAM_NGUNG };
  if (tv?.status !== "ACTIVE") return chuaThamGia();

  const gocLinkNgan = gocCongKhai(process.env);
  const [ds, tuyChon] = await Promise.all([
    docDanhSachLink({ trang: 1, kichThuoc: TOI_DA_LINK, trangThai: null, campaignMa: null, doiTacMa: dt.code, coTheXemDayDu: true, gocLinkNgan, gocNhinDoiTac: true, now }),
    docTuyChonPhatLink(now, { partyIds: [dt.id], chiTrangChinhXac: true }),
  ]);
  const link: LinkCuaToi[] = ds.dong.map((l) => ({
    id: l.id,
    campaign: l.campaign.ten,
    website: l.website.host,
    trangDich: l.landingPath,
    loai: l.loai,
    nhan: l.nhan,
    hoatDong: l.trangThai === "ACTIVE",
    lyDoKhongDung: l.lyDoKhongDung,
    soLuotBam: l.soLuotBam,
    soLuotBamLoi: l.soLuotBamLoi,
    soReferral: l.soReferral,
    lienKetNgan: l.lienKetNgan,
    lienKetTrucTiep: l.lienKetTrucTiep,
    urlCuoi: l.urlCuoi,
  }));
  return { loai: "DA_THAM_GIA", nhanSu, doiTac, link, taoLink: { chuongTrinh: tuyChon.doiTac.flatMap((d) => d.chuongTrinh), coGocLinkNgan: gocLinkNgan !== null } };
}

// ── GHI ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const LOI_KHONG_NHAN_SU = "Tài khoản này chưa gắn với hồ sơ nhân sự đang làm việc.";

export type KetQuaThamGia = { ok: true } | { ok: false; loi: string };

const LY_DO_TU_THAM_GIA = "Nhân sự đồng ý quy định link giới thiệu và tự tham gia (không cần duyệt — chủ dự án chốt 21/11/2026).";

/**
 * «Tôi đồng ý» — đưa hồ sơ giới thiệu + tư cách tham gia campaign nhân sự về ĐANG HOẠT ĐỘNG, KHÔNG qua duyệt (chủ dự án chốt 21/11/2026: *"đồng ý thì cho vào luôn chứ không
 * cần duyệt gì cả"*). Chạy lại bao nhiêu lần cũng hội tụ về cùng một trạng thái, nên nó cũng chữa các hồ sơ kẹt «chờ duyệt» của luồng cũ.
 *
 * Mọi phép ghi đi qua hàm SẴN CÓ của màn quản trị (`taoDoiTac` · `doiTrangThaiDoiTac` · `themMembership` · `doiTrangThaiMembership`) — giữ khoá lạc quan, cổng chuyển trạng thái và
 * nhật ký; ở đây chỉ GỌI chúng với người thực hiện là chính nhân sự. `themMembership` vẫn tạo PENDING (màn quản trị/cổng phụ huynh cần thế) rồi được chuyển ngay sang ACTIVE.
 * TẠM NGỪNG (hồ sơ hoặc tư cách) là lệnh dừng của người quản lý ⇒ từ chối, không tự mở lại.
 * Cuối cùng ghi một dòng AuditLog «đã đồng ý quy định» kèm phiên bản văn bản (`PHIEN_BAN_QUY_DINH_NHAN_SU`).
 */
export async function thamGiaLinkGioiThieu(p: { nguoi: NguoiGhi; now: Date }): Promise<KetQuaThamGia> {
  const nhanSu = await docNhanSuCuaToi(p.nguoi.userId);
  if (!nhanSu) return { ok: false, loi: LOI_KHONG_NHAN_SU };
  const cauHinh = await docCauHinhNhanSu();
  if (!cauHinh) return { ok: false, loi: LOI_CHUA_CAU_HINH };

  // 1) Hồ sơ giới thiệu (đối tác) — có sẵn thì dùng, không thì tạo (mã = mã nhân sự chuẩn hoá).
  const timDoiTac = () =>
    db.affiliate.findFirst({ where: { employeeId: nhanSu.employeeId, status: { not: "ENDED" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, status: true, updatedAt: true } });
  let dt = await timDoiTac();
  if (!dt) {
    const ma = chuanHoaMaDoiTac(nhanSu.maNv);
    if (!ma.ok) return { ok: false, loi: `Mã nhân sự «${nhanSu.maNv}» không dùng làm mã giới thiệu được — liên hệ Quản trị hệ thống.` };
    const tao = await taoDoiTac({
      nguoi: p.nguoi,
      vao: {
        partyKind: "PERSON",
        name: nhanSu.ten,
        typeId: cauHinh.typeId,
        tagIds: [],
        code: ma.ma,
        phone: null,
        email: null,
        note: "Nhân sự tự tham gia ở màn «Link giới thiệu của tôi».",
        centerId: null,
        commissionPercent: null,
        employeeId: nhanSu.employeeId,
        parentPartyId: null,
      },
    });
    if (!tao.ok) return { ok: false, loi: tao.loi };
    dt = await timDoiTac();
    if (!dt) return { ok: false, loi: "Không đọc lại được hồ sơ giới thiệu vừa tạo — thử lại." };
  }
  // Nháp → chờ duyệt → hoạt động (loại «cần duyệt» không cho nháp nhảy thẳng sang hoạt động). Mỗi bước là chính hàm chuyển trạng thái của màn quản trị.
  for (const den of ["PENDING", "ACTIVE"] as const) {
    if (dt.status === "ACTIVE") break;
    if (dt.status !== "DRAFT" && dt.status !== "PENDING") return { ok: false, loi: LY_DO_HO_SO_TAM_NGUNG };
    if (dt.status === "PENDING" && den === "PENDING") continue;
    const doi = await doiTrangThaiDoiTac({ nguoi: p.nguoi, id: dt.id, updatedAtDaThay: dt.updatedAt, den, lyDo: LY_DO_TU_THAM_GIA, now: p.now });
    if (!doi.ok) return { ok: false, loi: doi.loi };
    dt = { id: dt.id, status: den, updatedAt: new Date(doi.capNhatLuc) };
  }
  if (dt.status !== "ACTIVE") return { ok: false, loi: LY_DO_HO_SO_TAM_NGUNG };
  const partyId = dt.id;

  // 2) Tư cách tham gia campaign nhân sự.
  const timTv = () =>
    db.affiliateMembership.findUnique({ where: { partyId_campaignId: { partyId, campaignId: cauHinh.campaignId } }, select: { id: true, status: true, updatedAt: true } });
  let tv = await timTv();
  if (tv?.status === "SUSPENDED") return { ok: false, loi: LY_DO_THAM_GIA_TAM_NGUNG };
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

  // 3) Dấu đồng ý quy định (phiên bản văn bản) — bằng chứng nhân sự đã đọc + đồng ý trước khi tham gia.
  await writeAudit({
    actor: aud(p.nguoi),
    module: MODULE_AUDIT_AFFILIATE,
    entityType: "Affiliate",
    entityId: partyId,
    action: "AFFILIATE_NHAN_SU_DONG_Y_QUY_DINH",
    newValues: { phienBanQuyDinh: PHIEN_BAN_QUY_DINH_NHAN_SU, campaignId: cauHinh.campaignId, employeeId: nhanSu.employeeId },
    reason: `Nhân sự «${nhanSu.ten}» đồng ý quy định link giới thiệu (bản ${PHIEN_BAN_QUY_DINH_NHAN_SU})`,
  });
  return { ok: true };
}

/** Tạo link cho đối tác CỦA CHÍNH nhân sự đang đăng nhập (lõi chung với cổng phụ huynh). */
export async function taoLinkNhanSu(p: { nguoi: NguoiGhi; vao: unknown; now: Date }): Promise<KetQuaPhatLink> {
  return tuTaoLinkTrongDoiTac({ ...p, duocVao: await partyIdsCuaNhanSu(p.nguoi.userId) });
}

/**
 * Nhân sự TỰ thu hồi link CỦA CHÍNH MÌNH (chủ dự án 21/11/2026: thẻ trang đích có nút «Thu hồi», thu hồi xong thì «Cấp link mới»). Sở hữu kiểm TRONG truy vấn
 * (`partyIdsCuaNhanSu` từ phiên) — id của người khác ra cùng câu với id không tồn tại. Phép ghi là CHÍNH `thuHoiLink` của màn quản trị (khoá, cổng trạng thái, nhật ký);
 * lý do ghi sẵn vì nhân sự thu hồi link của mình không cần giải trình.
 */
export async function thuHoiLinkNhanSu(p: { nguoi: NguoiGhi; id: string; now: Date }): Promise<KetQuaThuHoiLink> {
  const duocVao = await partyIdsCuaNhanSu(p.nguoi.userId);
  const link = duocVao.length === 0 ? null : await db.affiliateTrackingAsset.findFirst({ where: { id: p.id, partyId: { in: duocVao } }, select: { id: true, updatedAt: true } });
  if (!link) return { ok: false, loi: "Không tìm thấy link này.", truong: "id" };
  return thuHoiLink({ nguoi: p.nguoi, id: link.id, updatedAtDaThay: link.updatedAt, lyDo: LY_DO_TU_THU_HOI, now: p.now });
}

const LY_DO_TU_THU_HOI = "Nhân sự tự thu hồi ở màn «Link giới thiệu của tôi».";

/** Link để xin QR — CHỈ khi thuộc đối tác của chính nhân sự đang đăng nhập. */
export async function docLinkChoQrNhanSu(userId: string, id: string): Promise<{ token: string; status: TrangThaiLink } | null> {
  return docLinkChoQrTrongDoiTac(await partyIdsCuaNhanSu(userId), id);
}
