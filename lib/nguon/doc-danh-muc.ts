/**
 * lib/nguon/doc-danh-muc.ts — ĐỌC danh mục nguồn ("Tất cả nguồn") và chi tiết MỘT nguồn (docs/source-commission
 * 06 §5.1). CHỈ ĐỌC; đường ghi (thêm/sửa/đổi trạng thái, đổi nguồn lead) là PR2/PR7.
 *
 * ── Hôm nay có gì để đọc ───────────────────────────────────────────────────────────────────────
 * Danh mục = `LeadSourceGroup` (11 nhóm + UNKNOWN, toàn hệ thống, KHÔNG có cơ sở/hiệu lực/chủ phụ trách).
 * Nguồn con (`LeadSource`: chiến dịch, tài sản, sự kiện) có từ PR7 — chưa có thì KHÔNG dựng cây giả.
 * "Có hoa hồng" là giá trị TÍNH từ chính sách hiệu lực (02 §1 bỏ cột `commissionEnabled`) — engine chính sách
 * (PR4) chưa có, nên cột đó CHƯA hiện: in số giả là nói dối, in "không" là kết luận chưa ai tính.
 *
 * ── Cách ly cơ sở ──────────────────────────────────────────────────────────────────────────────
 * Danh mục là dữ liệu chung (không scope). MỌI con số đếm lead đi qua `scopedDb(actor).lead` (đúng ca `[NCL-03]`:
 * bộ lọc lồng `attribution: { is: … }` không rò dòng cơ sở khác) — QLCS CS1 không bao giờ đếm lead của CS2.
 * Không đọc thẳng bảng attribution (lưới `[QN-W11]`/`[QN-W11b]`).
 *
 * Đồng hồ `now` BẮT BUỘC truyền (không đọc `new Date()` trong hàm đọc — test cố định được; luật 19).
 */
import type { LeadSourceType, Prisma, SourceReferrerRequirement, SourceStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { dinhTienCuaNguon, docDinhTienNguon, ruleChuChayChoNguon } from "./dinh-tien-nguon";
import { layBangNguonTheoPage, layCuaSoGhiCongNgay } from "./feature";
import { LY_DO_HANG_CHO, dieuKienLyDo, type LyDoHangCho } from "./doc-hang-cho";
import { nguonChonDuoc } from "./hieu-luc-nguon";

const NGAY_MS = 24 * 60 * 60 * 1000;
const truNgay = (now: Date, n: number) => new Date(now.getTime() - n * NGAY_MS);

export type DongDanhMucNguon = {
  id: string;
  code: string;
  documentNo: number | null;
  name: string;
  description: string | null;
  referrerRequirement: SourceReferrerRequirement;
  requiresNote: boolean;
  selectable: boolean;
  isSystem: boolean;
  sortOrder: number;
  status: SourceStatus;
  /** Lead vào trong 30 ngày qua, TRONG tầm nhìn của người xem. */
  soLead30Ngay: number;
  /** Mọi lead (chưa xoá) mang nhóm này, TRONG tầm nhìn của người xem. */
  soLeadTong: number;
};

/**
 * Dòng danh mục cho bảng CÓ THAO TÁC (tạo / sửa / đổi trạng thái ngay từ danh sách). Tách khỏi `DongDanhMucNguon` để `ChiTietNguon.nguon` (Omit của dòng gốc) không phải đổi.
 */
export type DongDanhMucNguonMo = DongDanhMucNguon & {
  /** Nhóm cấp cao (lọc / báo cáo): REFERRAL · MARKETING · … · SYSTEM. */
  sourceType: LeadSourceType;
  /** Nguồn có tham gia hoa hồng THEO NGUỒN không (engine bỏ qua chính sách phạm vi nguồn nếu false). */
  commissionEnabled: boolean;
  /** Cửa sổ ghi công RIÊNG (ngày); null = dùng mặc định chung (`KetQuaDanhMucNguon.cuaSoGhiCongNgay`). */
  attributionWindowDays: number | null;
  /** Khoảng hiệu lực (ISO); null = không giới hạn đầu đó. */
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** Lead MỚI chọn được nguồn này lúc `now` không (ACTIVE ∧ selectable ∧ trong hiệu lực) — dòng ACTIVE mà false là «hết hạn / chưa mở». */
  chonDuoc: boolean;
  /** `updatedAt` ISO — mốc khoá lạc quan khi đổi trạng thái ngay từ danh sách. */
  capNhatLuc: string;
  /** `Employee.id` người phụ trách; null = chưa khai. Để NÚT TRẠNG THÁI nói thật («Kích hoạt» nguồn chưa có chủ khi rule chủ-nguồn đang chạy sẽ bị từ chối). */
  ownerEmployeeId: string | null;
  /** Có chính sách RIÊNG đang ACTIVE (`docDinhTienNguon`) — ngừng/lưu trữ nguồn này đòi quyền kích hoạt. */
  chinhSachRieng: boolean;
  /** Rule vai SOURCE_OWNER CHẠY trên nguồn này (rule chung hoặc rule riêng của nó). */
  ruleChuChay: boolean;
};

export type KetQuaDanhMucNguon = {
  dong: DongDanhMucNguonMo[];
  /** Cửa sổ ghi công MẶC ĐỊNH (ngày; `nguon.cuaSoGhiCongNgay`, toàn hệ) — nguồn có `attributionWindowDays` riêng thì dùng cửa sổ riêng (`cuaSoHieuLuc`). */
  cuaSoGhiCongNgay: number;
};

/**
 * `where` lead của MỘT nhóm: lead chưa xoá, attribution thuộc nhóm (hiện hành, không phải nhóm GỐC).
 * `coSoId` BẮT BUỘC, không mặc định (luật 7): quên truyền là chip cơ sở ở trang thành lời hứa suông (bấm chip sáng,
 * số không đổi) mà không lỗi nào báo. `null` = mọi cơ sở trong tầm nhìn; một id = chỉ cơ sở đó (scopedDb cắt lại, nên
 * id NGOÀI tầm nhìn ra 0 chứ không bao giờ lộ cơ sở khác). Cùng nghĩa với `whereHangCho`.
 */
function whereLeadCuaNhom(
  groupId: string,
  coSoId: string | null,
  them: Prisma.LeadAttributionWhereInput = {},
): Prisma.LeadWhereInput {
  return { deletedAt: null, ...(coSoId ? { centerId: coSoId } : {}), attribution: { is: { groupId, ...them } } };
}

export async function docDanhMucNguon(
  actor: Actor,
  p: {
    now: Date;
    trangThai: SourceStatus | null;
    /** Lọc theo nhóm nguồn (`sourceType`); bỏ qua/`null` = mọi nhóm. */
    loai?: LeadSourceType | null;
    /** Chip cơ sở đang chọn (`null` = tất cả cơ sở trong tầm nhìn). BẮT BUỘC — xem `whereLeadCuaNhom`. */
    coSoId: string | null;
  },
): Promise<KetQuaDanhMucNguon> {
  const sdb = scopedDb(actor);
  const tu30 = truNgay(p.now, 30);
  const nhom = await db.leadSourceGroup.findMany({
    where: { ...(p.trangThai ? { status: p.trangThai } : {}), ...(p.loai ? { sourceType: p.loai } : {}) },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  const [cuaSo, dt, dem] = await Promise.all([
    layCuaSoGhiCongNgay(),
    // MỘT lượt cho cả danh sách (3 truy vấn, không phụ thuộc số nguồn) — cùng hàm với cổng ghi.
    docDinhTienNguon(db, nhom.map((g) => g.id)),
    Promise.all(
      nhom.map(async (g) => {
        const [tong, ba30] = await Promise.all([
          sdb.lead.count({ where: whereLeadCuaNhom(g.id, p.coSoId) }),
          sdb.lead.count({ where: { ...whereLeadCuaNhom(g.id, p.coSoId), createdAt: { gte: tu30 } } }),
        ]);
        return { tong, ba30 };
      }),
    ),
  ]);
  return {
    cuaSoGhiCongNgay: cuaSo,
    dong: nhom.map((g, i) => ({
      id: g.id,
      code: g.code,
      documentNo: g.documentNo,
      name: g.name,
      description: g.description,
      referrerRequirement: g.referrerRequirement,
      requiresNote: g.requiresNote,
      selectable: g.selectable,
      isSystem: g.isSystem,
      sortOrder: g.sortOrder,
      status: g.status,
      sourceType: g.sourceType,
      commissionEnabled: g.commissionEnabled,
      attributionWindowDays: g.attributionWindowDays,
      effectiveFrom: g.effectiveFrom?.toISOString() ?? null,
      effectiveTo: g.effectiveTo?.toISOString() ?? null,
      chonDuoc: nguonChonDuoc(g, p.now),
      capNhatLuc: g.updatedAt.toISOString(),
      soLead30Ngay: dem[i]!.ba30,
      soLeadTong: dem[i]!.tong,
      ownerEmployeeId: g.ownerEmployeeId,
      chinhSachRieng: dinhTienCuaNguon(dt, g.id).chinhSachRieng,
      ruleChuChay: ruleChuChayChoNguon(dt, g.id),
    })),
  };
}

export type ChiTietNguon = {
  nguon: Omit<DongDanhMucNguon, "soLead30Ngay" | "soLeadTong">;
  /** Cửa sổ MẶC ĐỊNH toàn hệ. */
  cuaSoGhiCongNgay: number;
  /** Cửa sổ RIÊNG của nguồn này (`LeadSourceGroup.attributionWindowDays`); null ⇒ dùng mặc định. */
  cuaSoRiengNgay: number | null;
  /** Page đã map về nhóm này trong `nguon.bangNguonTheoPage` (tạm thời, tới PR7). */
  pageDaMap: { pageId: string; campaignCode: string | null }[];
  thongKe: {
    tong: number;
    ba30: number;
    bay7: number;
    /** Có người giới thiệu / chưa có (chỉ có nghĩa với nhóm cần người). */
    coNguoiGioiThieu: number;
    thieuNguoi: number;
    theoTrangThaiLead: { trangThai: string; so: number }[];
    /** Đường vào (`Lead.source` cũ) của các lead mang nhóm này — 10 đường nhiều nhất. */
    theoDuongVao: { duongVao: string; so: number }[];
    hangChoTheoLyDo: Record<LyDoHangCho, number>;
  };
};

export async function docChiTietNguon(
  actor: Actor,
  code: string,
  now: Date,
): Promise<ChiTietNguon | null> {
  const g = await db.leadSourceGroup.findUnique({ where: { code } });
  if (!g) return null;
  const sdb = scopedDb(actor);
  // Chi tiết một nguồn không có chip cơ sở ⇒ mọi cơ sở trong tầm nhìn (null là CHỦ ĐÍCH, không phải quên).
  const goc = whereLeadCuaNhom(g.id, null);

  const [cuaSo, bang, tong, ba30, bay7, coNguoi, thieuNguoi, theoTrangThai, theoDuongVao, hangCho] = await Promise.all([
    layCuaSoGhiCongNgay(),
    layBangNguonTheoPage(),
    sdb.lead.count({ where: goc }),
    sdb.lead.count({ where: { ...goc, createdAt: { gte: truNgay(now, 30) } } }),
    sdb.lead.count({ where: { ...goc, createdAt: { gte: truNgay(now, 7) } } }),
    sdb.lead.count({ where: whereLeadCuaNhom(g.id, null, { referrerKind: { not: null } }) }),
    sdb.lead.count({ where: whereLeadCuaNhom(g.id, null, { referrerMissing: true }) }),
    sdb.lead.groupBy({ by: ["status"], where: goc, _count: { _all: true }, orderBy: { status: "asc" } }),
    sdb.lead.groupBy({
      by: ["source"],
      where: goc,
      _count: { _all: true },
      orderBy: { _count: { source: "desc" } },
      take: 10,
    }),
    Promise.all(
      LY_DO_HANG_CHO.map((l) => sdb.lead.count({ where: whereLeadCuaNhom(g.id, null, dieuKienLyDo(l)) })),
    ),
  ]);

  return {
    nguon: {
      id: g.id,
      code: g.code,
      documentNo: g.documentNo,
      name: g.name,
      description: g.description,
      referrerRequirement: g.referrerRequirement,
      requiresNote: g.requiresNote,
      selectable: g.selectable,
      isSystem: g.isSystem,
      sortOrder: g.sortOrder,
      status: g.status,
    },
    cuaSoGhiCongNgay: cuaSo,
    cuaSoRiengNgay: g.attributionWindowDays,
    pageDaMap: Object.entries(bang)
      .filter(([, v]) => v.groupCode === g.code)
      .map(([pageId, v]) => ({ pageId, campaignCode: v.campaignCode ?? null }))
      .sort((a, b) => a.pageId.localeCompare(b.pageId)),
    thongKe: {
      tong,
      ba30,
      bay7,
      coNguoiGioiThieu: coNguoi,
      thieuNguoi,
      theoTrangThaiLead: theoTrangThai.map((r) => ({ trangThai: r.status, so: r._count._all })),
      theoDuongVao: theoDuongVao.map((r) => ({ duongVao: r.source ?? "(không ghi)", so: r._count._all })),
      hangChoTheoLyDo: Object.fromEntries(LY_DO_HANG_CHO.map((l, i) => [l, hangCho[i]!])) as Record<LyDoHangCho, number>,
    },
  };
}
