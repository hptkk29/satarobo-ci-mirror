// tests/hoa-hong/_nguon-dong.ts — ĐỒ DÙNG CHUNG của bộ ca nghiệm thu NGUỒN ĐỘNG (`nguon-dong-*.spec.ts`). KHÔNG phải spec.
//
// Vì sao có tệp này: ca nghiệm thu «admin tạo nguồn mới, kích hoạt chính sách, tiền về, sổ ghi đúng» phải đi qua guardrail kích hoạt THẬT — mà guardrail đọc
// TOÀN tập chính sách ACTIVE và MỌI cơ sở (OrgUnit CENTER) của DB. Một kịch bản khác (hoặc bộ chạy trước) để lại chính sách còn sống / cơ sở chưa có người phụ
// trách thì kích hoạt báo `VUOT_TRAN` / `THIEU_NGUOI_PHU_TRACH` vì lý do chẳng liên quan tới thứ đang kiểm. Nên:
//   · `lamSachChinhSach()` — tiền điều kiện CỐ Ý của ca kích hoạt thật: không còn phiên bản sống nào ngoài thứ ca tự dựng sau đó;
//   · `baoDamNguoiPhuTrach()` — mọi cơ sở trong DB có QL_TT + QC hiệu lực (gắn nhãn để dọn).
import { db } from "../../lib/db";
import type { RuleInput } from "../../lib/hoa-hong/chinh-sach-dau-vao";
import { kichHoat, taoChinhSach, taoVanBan } from "../../lib/hoa-hong/chinh-sach-service";
import { HoaHongError } from "../../lib/hoa-hong/kieu";
import { chuanBiQuyNguon, ghiQuyNguonLeadMoi, type DauVaoNoiDay } from "../../lib/nguon/noi-day";
import { KHONG_CO_TIN_HIEU_NGUON } from "../../lib/nguon/tin-hieu";
import { clearSettingsCache } from "../../lib/settings/service";
import { seedUser } from "../e2e/_helpers/seed";
import type { KichBan } from "./_kich-ban";

/** Đồng hồ của dịch vụ chính sách (soạn/kích hoạt). Văn bản công bố 02/03/2026 ⇒ hiệu lực sớm nhất 23/03/2026 VN. */
export const NOW_CS = new Date("2026-10-08T03:00:00.000Z");
export const HIEU_LUC_CS = new Date("2026-03-22T17:00:00.000Z");
const NGUOI_CS = { userId: null, ten: "Admin fixture dyn" };

export const rule = (roleCode: string, rate: number, p: Partial<RuleInput> = {}): RuleInput => ({
  transactionTypeCode: "NEW",
  roleCode,
  revenueComponent: "TUITION",
  calcKind: "PERCENT",
  rate,
  fixedAmount: null,
  tierTable: null,
  note: null,
  ...p,
});

/** Vô hiệu hoá MỌI phiên bản còn sống (ACTIVE/DRAFT). Gọi TRƯỚC `dungKichBan` của ca kích hoạt thật. */
export async function lamSachChinhSach(): Promise<void> {
  await db.commissionPolicyVersion.updateMany({ where: { status: { in: ["ACTIVE", "DRAFT"] } }, data: { status: "CANCELLED" } });
}

/** Mọi OrgUnit CENTER chưa xoá có người phụ trách QL_TT + QC hiệu lực — thiếu thì guardrail chặn `THIEU_NGUOI_PHU_TRACH`. */
export async function baoDamNguoiPhuTrach(nhan: string): Promise<void> {
  const coSo = await db.orgUnit.findMany({ where: { type: "CENTER", deletedAt: null, centerId: { not: null } }, select: { centerId: true } });
  const nguoi = await seedUser({ email: `${nhan}-pt@ci.test`, role: "SALES_CSM", name: `${nhan}-pt`, phone: null });
  for (const c of coSo) {
    for (const role of ["QL_TT", "QC"] as const) {
      const co = await db.centerCommissionAssignee.count({ where: { centerId: c.centerId!, role, effectiveTo: null } });
      if (co === 0) {
        await db.centerCommissionAssignee.create({ data: { centerId: c.centerId!, role, userId: nguoi.id, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), note: nhan } });
      }
    }
  }
}

export async function donNguoiPhuTrach(nhan: string): Promise<void> {
  await db.centerCommissionAssignee.deleteMany({ where: { note: nhan } });
}

/** Đặt trần tổng tỉ lệ (`crm.commissionMaxTotalRate`); `null` = về mặc định. Trả hàm khôi phục. */
export async function datTranHoaHong(tran: number | null): Promise<void> {
  const KEY = "crm.commissionMaxTotalRate";
  await db.systemSetting.deleteMany({ where: { key: KEY } });
  if (tran !== null) await db.systemSetting.create({ data: { key: KEY, valueJson: tran } });
  clearSettingsCache();
}

/** Chính sách phạm vi NGUỒN, tạo bằng DỊCH VỤ THẬT (văn bản → chính sách → bản nháp). Chưa kích hoạt. Tự ghi mã vào `k.chinhSachThem` để dọn. */
export async function chinhSachNguonQuaService(
  k: KichBan,
  /** `sourceGroupId = null` ⇒ chính sách phạm vi CHUNG (GLOBAL) — áp cho mọi nguồn. */
  p: { hau: string; sourceGroupId: string | null; rules: RuleInput[] },
): Promise<{ policyId: string; versionId: string; policyCode: string; documentCode: string }> {
  const documentCode = `${k.ma}-vb-${p.hau}`;
  const vb = await taoVanBan({
    documentCode,
    title: "Quy định hoa hồng theo nguồn (fixture)",
    kind: "COMMISSION_POLICY",
    issuedOn: "2026-02-20",
    publishedOn: "2026-03-02",
    effectiveOn: "2026-03-23",
    approvedByName: "Hồ Đắc Phúc",
    approvedById: null,
    fileKey: "documents/fx-dyn.pdf",
    fileName: "fx-dyn.pdf",
    fileUrl: "https://example.test/fx-dyn.pdf",
    ownerOrgUnitId: null,
    actor: NGUOI_CS,
    now: NOW_CS,
  });
  const policyCode = `${k.ma}-src-${p.hau}`;
  const cs = await taoChinhSach({
    policyCode,
    name: `Chính sách nguồn ${p.hau}`,
    description: null,
    ownerOrgUnitId: null,
    phamVi: p.sourceGroupId === null ? { loai: "GLOBAL" } : { loai: "SOURCE_GROUP", sourceGroupId: p.sourceGroupId },
    effectiveFrom: HIEU_LUC_CS,
    effectiveTo: null,
    reason: "SR.QD.fixture dyn",
    documentId: vb.id,
    rules: p.rules,
    actor: NGUOI_CS,
    now: NOW_CS,
  });
  k.chinhSachThem.push(policyCode);
  return { policyId: cs.policyId, versionId: cs.versionId, policyCode, documentCode };
}

/** Kích hoạt qua guardrail THẬT. Trả danh sách mã lỗi chặn (rỗng = đã ACTIVE). Cảnh báo (nếu có) được xác nhận bằng lý do. */
export async function thuKichHoat(versionId: string): Promise<string[]> {
  try {
    await kichHoat({ versionId, actor: NGUOI_CS, now: NOW_CS, xacNhanCanhBao: { lyDo: "fx-dyn xác nhận cảnh báo hàng rào" } });
  } catch (e) {
    if (e instanceof HoaHongError && e.ma === "KICH_HOAT_BI_CHAN") return (e.chiTiet as { ma: string }[]).map((x) => x.ma).sort();
    throw e;
  }
  return [];
}

/** Như `thuKichHoat` nhưng trả NGUYÊN lỗi chặn (mã · thông báo · hướng xử lý) — để ca đo thứ guardrail THẬT nói với người kích hoạt. */
export async function chiTietChanKichHoat(versionId: string): Promise<{ ma: string; thongBao: string; huongXuLy?: Record<string, unknown> }[]> {
  try {
    await kichHoat({ versionId, actor: NGUOI_CS, now: NOW_CS, xacNhanCanhBao: { lyDo: "fx-dyn xác nhận cảnh báo hàng rào" } });
  } catch (e) {
    if (e instanceof HoaHongError && e.ma === "KICH_HOAT_BI_CHAN") return e.chiTiet as { ma: string; thongBao: string; huongXuLy?: Record<string, unknown> }[];
    throw e;
  }
  return [];
}

export const trangThaiPhienBan = async (versionId: string) => (await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId }, select: { status: true } })).status;

// ── Ghi nguồn cho lead của kịch bản bằng ĐƯỜNG THẬT (luật 9: cổng phải được cho ăn bằng thứ đường THẬT cho nó ăn) ───────────────
// `chuanBiQuyNguon` (thu thập tín hiệu + ảnh chụp người giới thiệu + quy nguồn) → `ghiQuyNguonLeadMoi`. Khác `ganNguon` của `_kich-ban.ts`, hàm này KHÔNG nhận
// `saleUserId` / `vai` từ ca: chúng do chính đường nhập tính ra, nên cấy lỗi vào bước chụp là đỏ ở đây.

/** Thời điểm «bây giờ» của dòng nhập (vai của người giới thiệu tính TẠI mốc này). Tuyệt đối (luật 19). */
export const BAY_GIO_NHAP = new Date("2026-10-01T03:00:00.000Z");

export function dongNhap(k: Pick<KichBan, "ouId" | "centerId">, ghi: Partial<DauVaoNoiDay> = {}): DauVaoNoiDay {
  return {
    bayGio: BAY_GIO_NHAP,
    duongVao: "nhap-tay",
    conversionEntry: null,
    nhanKhai: null,
    laNhapExcel: false,
    sdtKhach: null,
    maNvNguoiNhap: null,
    nguoiNhapUserId: null,
    nhanSuGioiThieuEmployeeId: null,
    phuHuynhGioiThieu: null,
    ref: null,
    refSau: [],
    quangCao: KHONG_CO_TIN_HIEU_NGUON.quangCao,
    utm: KHONG_CO_TIN_HIEU_NGUON.utm,
    pageId: null,
    orgUnitId: k.ouId,
    centerId: k.centerId,
    ...ghi,
  };
}

/**
 * Ghi `LeadAttribution` cho lead của kịch bản qua đường nhập thật; rồi GHIM `attributedAt` sang ngày tuyệt đối (DB đặt `now()` — đồng hồ thật — cho dòng mới;
 * khoản thu của ca mang ngày tuyệt đối nên mốc ghi nhận cũng phải tuyệt đối. Đó là sửa dấu thời gian của fixture, không đổi logic nào).
 */
export async function ghiNguonQuaDuongThat(k: KichBan, ghi: Partial<DauVaoNoiDay>, attributedAt: Date, leadId?: string) {
  const id = leadId ?? k.lead?.id;
  if (!id) throw new Error("ghiNguonQuaDuongThat cần lead");
  const [cb] = await chuanBiQuyNguon(db, [dongNhap(k, ghi)]);
  if (!cb || !cb.bat) throw new Error(`chuanBiQuyNguon không bật: ${cb && "loi" in cb ? cb.loi : "cờ nguồn đang tắt?"}`);
  if (cb.chanNhap) throw new Error(`đường nhập chặn: ${cb.chanNhap}`);
  await db.$transaction((tx) => ghiQuyNguonLeadMoi(tx, id, cb, null));
  await db.leadAttribution.update({ where: { leadId: id }, data: { attributedAt } });
  return db.leadAttribution.findUniqueOrThrow({ where: { leadId: id }, include: { group: { select: { code: true } } } });
}

/** Thêm một lead nữa vào kịch bản (cùng cơ sở, cùng Sale chốt) — trả bản sao kịch bản trỏ vào lead đó, để `dungBe`/`tienVe` dùng được. */
export async function themLead(k: KichBan, hau: string, p: { convertedById?: string } = {}): Promise<KichBan> {
  const lead = await db.lead.create({
    data: {
      parentName: `${k.ma}-${hau}`,
      phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      status: "DA_DANG_KY",
      convertedById: p.convertedById ?? k.sale.id,
      adminId: k.saleAdmin.id,
      centerId: k.centerId,
    },
  });
  return { ...k, lead };
}

// ── Bọc `suaNguon` / `doiTrangThaiNguon` cho ca KHÔNG đo cổng quyền / đồng hồ ────────────────────────────────
// Hai hàm ghi nhận `coQuyenKichHoat` + `now` BẮT BUỘC (luật 7). Phần lớn ca chỉ đo việc KHÁC (khoá lạc quan, nguồn đã dùng, hiệu lực…) nên gọi qua bọc này với người có ĐỦ quyền kích hoạt
// và đồng hồ cố định; ca đo CỔNG QUYỀN ([DYN-GATE-*]) gọi thẳng hàm thật với `coQuyenKichHoat: false`.
import { doiTrangThaiNguon as doiTrangThaiNguonThat, suaNguon as suaNguonThat, taoNguon as taoNguonThat } from "../../lib/nguon/danh-muc-ghi";
import { luuNguonCuaPage as luuNguonCuaPageThat } from "../../lib/nguon/bang-nguon-theo-page";

/** Đồng hồ cố định của bọc (luật 19). */
export const NOW_GHI_NGUON = new Date("2026-10-09T03:00:00.000Z");

export const suaNguon = (p: Omit<Parameters<typeof suaNguonThat>[0], "coQuyenKichHoat" | "now"> & { coQuyenKichHoat?: boolean; now?: Date }) =>
  suaNguonThat({ coQuyenKichHoat: true, now: NOW_GHI_NGUON, ...p });

export const doiTrangThaiNguon = (p: Omit<Parameters<typeof doiTrangThaiNguonThat>[0], "coQuyenKichHoat" | "now"> & { coQuyenKichHoat?: boolean; now?: Date }) =>
  doiTrangThaiNguonThat({ coQuyenKichHoat: true, now: NOW_GHI_NGUON, ...p });

export const taoNguon = (p: Omit<Parameters<typeof taoNguonThat>[0], "coQuyenKichHoat"> & { coQuyenKichHoat?: boolean }) => taoNguonThat({ coQuyenKichHoat: true, ...p });

/** Lý do mặc định của bọc Page (≥ 10 ký tự) — ca đo cổng lý do/quyền gọi thẳng hàm thật. */
export const LY_DO_PAGE_MAC_DINH = "Chủ dự án chốt ngày 10/10/2026";
export const luuNguonCuaPage = (p: Omit<Parameters<typeof luuNguonCuaPageThat>[0], "coQuyenKichHoat" | "lyDo" | "now"> & { coQuyenKichHoat?: boolean; lyDo?: string | null; now?: Date }) =>
  luuNguonCuaPageThat({ coQuyenKichHoat: true, lyDo: LY_DO_PAGE_MAC_DINH, now: NOW_GHI_NGUON, ...p });
