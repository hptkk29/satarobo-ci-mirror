// lib/khuyen-mai/chinh-sach.ts — nghiệp vụ Chính sách khuyến mãi (26/09/2026).
//
// Chủ dự án: "chính sách mới thì BLĐ up lên là nhận luôn và gửi về cho Sale tra cứu, sau này
// sẽ add voucher vào quy trình thanh toán". Nên:
//   · BAN HÀNH = có hiệu lực theo ngày NGAY, không qua bước duyệt thứ hai (văn bản đã ký giấy
//     trước khi lên hệ thống — hệ thống chỉ là nơi phát hành);
//   · ban hành xong BÁO NGAY cho người tra cứu trong phạm vi áp dụng (Sale, QLCS, kế toán…);
//   · thu hồi sớm cũng báo — Sale phải thôi hứa một ưu đãi vừa bị rút;
//   · mã voucher là CON của chính sách, hiệu lực của mã = hiệu lực chính sách.
//
// ⚠️ Hôm nay KHÔNG chạm đơn hàng: không có đường nào trừ tiền theo voucher. Khi nối thanh toán
// (việc sau) thì đường ghi đơn đọc `Voucher` + `trangThaiTai()` — đừng viết lại điều kiện
// hiệu lực ở đó.
//
// Quyền KHÔNG kiểm ở đây — Server Action gác `promotions:manage` trước khi gọi. Bảng không thuộc cơ sở nào nên dùng `db` thẳng (không qua scopedDb
// là đúng nghĩa, không phải đường vòng — xem chú thích model `PromotionPolicy`).
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { notifyStaff } from "@/lib/notifications/notify";
import { dauNgayTuChuoi, ngayVN } from "@/lib/format/thoi-gian-vn";
import { getPublicUrl } from "@/lib/storage/r2-client";
import type { ChinhSachInput, VoucherInput } from "@/lib/validators/khuyen-mai";
import { daTungHieuLuc, ngayBatDau, ngayKetThuc, trangThaiTai } from "./hieu-luc";
import { moTaUuDaiMa } from "./mo-ta";
import { baoTrum } from "./pham-vi";

export type NguoiThaoTac = { userId: string; ten: string };

export type MaLoiKhuyenMai = "KHONG_TIM_THAY" | "TRUNG_MA" | "SAI_TRANG_THAI" | "DU_LIEU_SAI";

export class LoiKhuyenMai extends Error {
  constructor(
    readonly ma: MaLoiKhuyenMai,
    message: string,
  ) {
    super(message);
    this.name = "LoiKhuyenMai";
  }
}

const MODULE = "promotions";

/** Cột `@db.Date` từ "YYYY-MM-DD". */
function cotNgay(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

/** Hiệu lực của MÃ voucher (cột Timestamptz) theo ngày của chính sách, giờ VN. */
function hieuLucMa(tuNgay: string, denNgay: string): { validFrom: Date; validUntil: Date } {
  return { validFrom: dauNgayTuChuoi(tuNgay), validUntil: new Date(`${denNgay}T23:59:59.999+07:00`) };
}

/** Kiểm cơ sở + khoá được chọn có thật — chọn nhầm id lạ là chính sách áp vào "không đâu cả". */
async function kiemPhamVi(coSo: readonly string[], khoaHoc: readonly string[]): Promise<void> {
  const [donVi, khoa] = await Promise.all([
    coSo.length === 0
      ? Promise.resolve(0)
      : db.orgUnit.count({ where: { id: { in: [...coSo] }, deletedAt: null, type: "CENTER" } }),
    khoaHoc.length === 0 ? Promise.resolve(0) : db.course.count({ where: { id: { in: [...khoaHoc] } } }),
  ]);
  if (donVi !== new Set(coSo).size) throw new LoiKhuyenMai("DU_LIEU_SAI", "Có cơ sở không tồn tại hoặc đã ngừng.");
  if (khoa !== new Set(khoaHoc).size) throw new LoiKhuyenMai("DU_LIEU_SAI", "Có khoá học không tồn tại.");
}

/** Ba cột tệp — URL dựng từ KHOÁ ở server, không lấy URL client gửi (KM-01). */
function cotTep(tep: ChinhSachInput["tep"]): { fileKey: string | null; fileName: string | null; fileUrl: string | null } {
  if (!tep) return { fileKey: null, fileName: null, fileUrl: null };
  return { fileKey: tep.key, fileName: tep.ten, fileUrl: getPublicUrl(tep.key) };
}

function laTrungMa(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// ─── Người nhận thông báo ────────────────────────────────────────────────────────────

/**
 * Ai được báo khi một chính sách ban hành/thu hồi: người đang giữ (qua vai v2 còn hiệu lực)
 * quyền `promotions:view`, neo ở đơn vị BAO TRÙM ít nhất một cơ sở được áp — neo Hội sở/khối
 * thì bao trùm mọi cơ sở bên dưới. Chính sách toàn hệ thống ⇒ mọi người giữ quyền.
 *
 * Bỏ: người vừa thao tác (họ biết rồi), tài khoản đã khoá.
 * Phép so đường dẫn cây ở `pham-vi.ts` (thuần, có test).
 */
export async function nguoiNhanBao(orgUnitIds: readonly string[], boQua: string | null, now: Date): Promise<string[]> {
  const [vai, dich] = await Promise.all([
    db.userOrgRole.findMany({
      where: {
        status: "ACTIVE",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        role: { isActive: true, permissions: { some: { action: "promotions:view" } } },
      },
      select: { userId: true, orgUnitId: true },
    }),
    orgUnitIds.length === 0
      ? Promise.resolve([])
      : db.orgUnit.findMany({ where: { id: { in: [...orgUnitIds] } }, select: { path: true } }),
  ]);
  let userIds: string[];
  if (orgUnitIds.length === 0) {
    userIds = vai.map((v) => v.userId);
  } else {
    const neo = await db.orgUnit.findMany({
      where: { id: { in: [...new Set(vai.map((v) => v.orgUnitId))] } },
      select: { id: true, path: true },
    });
    const duongDan = new Map(neo.map((n) => [n.id, n.path]));
    // `path` cho phép trống (migration additive P1). Không có đường dẫn thì không chứng minh
    // được "bao trùm" ⇒ không báo — thà sót một người còn hơn báo nhầm cơ sở khác.
    const dichPaths = dich.map((d) => d.path).filter((x): x is string => !!x);
    userIds = vai
      .filter((v) => {
        const p = duongDan.get(v.orgUnitId);
        return typeof p === "string" && p.length > 0 && baoTrum(p, dichPaths);
      })
      .map((v) => v.userId);
  }
  const ids = [...new Set(userIds)].filter((id) => id !== boQua);
  if (ids.length === 0) return [];
  const conSong = await db.user.findMany({
    where: { id: { in: ids }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  return conSong.map((u) => u.id);
}

/** Báo KHÔNG được làm hỏng thao tác đã ghi — lỗi báo chỉ ghi log. */
async function baoNguoiTraCuu(
  loai: "ban-hanh" | "thu-hoi",
  cs: { id: string; documentCode: string; name: string; orgUnitIds: string[]; validFrom: Date; validUntil: Date },
  nguoi: NguoiThaoTac,
  lyDo: string | null,
  now: Date,
): Promise<number> {
  try {
    const nhan = await nguoiNhanBao(cs.orgUnitIds, nguoi.userId, now);
    if (nhan.length === 0) return 0;
    const hieuLuc = `${ngayBatDau({ ...cs, revokedAt: null })} → ${ngayKetThuc({ ...cs, revokedAt: null })}`;
    return await notifyStaff({
      userIds: nhan,
      dedupeKey: `khuyen-mai.${loai}:${cs.id}`,
      category: "khuyen-mai",
      title:
        loai === "ban-hanh"
          ? `Khuyến mãi mới: ${cs.documentCode} — ${cs.name}`
          : `Đã thu hồi khuyến mãi ${cs.documentCode}`,
      body:
        loai === "ban-hanh"
          ? `Áp dụng ${hieuLuc}. Mở để xem ưu đãi, điều kiện và mã voucher trước khi tư vấn.`
          : `${cs.name} không còn áp dụng từ hôm nay. Lý do: ${lyDo ?? "—"}. Đừng hứa ưu đãi này với khách.`,
      href: `/khuyen-mai/${cs.id}`,
      entityId: cs.id,
    });
  } catch (e) {
    console.error("[khuyen-mai] báo người tra cứu lỗi", { id: cs.id, loai, loi: e instanceof Error ? e.name : "?" });
    return 0;
  }
}

// ─── Ghi ─────────────────────────────────────────────────────────────────────────────

export async function banHanhChinhSach(
  nguoi: NguoiThaoTac,
  input: ChinhSachInput,
  now: Date,
): Promise<{ id: string; soNguoiDuocBao: number }> {
  await kiemPhamVi(input.coSo, input.khoaHoc);
  let cs;
  try {
    cs = await db.$transaction(async (tx) => {
      const tao = await tx.promotionPolicy.create({
        data: {
          documentCode: input.maVanBan,
          name: input.ten,
          benefitText: input.noiDungUuDai,
          conditionText: input.dieuKien,
          validFrom: cotNgay(input.tuNgay),
          validUntil: cotNgay(input.denNgay),
          orgUnitIds: [...new Set(input.coSo)],
          courseIds: [...new Set(input.khoaHoc)],
          ...cotTep(input.tep),
          createdById: nguoi.userId,
          updatedById: nguoi.userId,
        },
      });
      await writeAudit({
        tx,
        actor: { id: nguoi.userId, name: nguoi.ten },
        module: MODULE,
        entityType: "PromotionPolicy",
        entityId: tao.id,
        action: "CREATE",
        newValues: {
          maVanBan: tao.documentCode,
          ten: tao.name,
          tuNgay: input.tuNgay,
          denNgay: input.denNgay,
          coSo: tao.orgUnitIds,
          khoaHoc: tao.courseIds,
          coTep: !!tao.fileKey,
        },
      });
      return tao;
    });
  } catch (e) {
    if (laTrungMa(e)) throw new LoiKhuyenMai("TRUNG_MA", `Mã văn bản ${input.maVanBan} đã có trên hệ thống.`);
    throw e;
  }
  const soNguoiDuocBao = await baoNguoiTraCuu("ban-hanh", cs, nguoi, null, now);
  return { id: cs.id, soNguoiDuocBao };
}

export async function suaChinhSach(
  nguoi: NguoiThaoTac,
  input: ChinhSachInput & { id: string },
  now: Date,
): Promise<void> {
  const cu = await db.promotionPolicy.findUnique({ where: { id: input.id } });
  if (!cu) throw new LoiKhuyenMai("KHONG_TIM_THAY", "Không tìm thấy chính sách.");
  if (cu.revokedAt) throw new LoiKhuyenMai("SAI_TRANG_THAI", "Chính sách đã thu hồi — không sửa được. Ban hành văn bản mới.");
  // Rà 26/09 (AGT-05, KM-R3): lùi ngày kết thúc về TRƯỚC hôm nay là dừng chính sách giữa chừng —
  // đúng việc của "Thu hồi" (bắt lý do, báo Sale, tắt mã). Cho sửa ở đây là một đường thu hồi
  // câm: Sale không được báo, mã vẫn "Đang bật". Giữ nguyên ngày cũ (sửa lỗi chính tả) thì được.
  const homNay = ngayVN(now);
  const denNgayCu = ngayKetThuc({ ...cu, revokedAt: null });
  if (input.denNgay !== denNgayCu && input.denNgay < homNay) {
    throw new LoiKhuyenMai(
      "DU_LIEU_SAI",
      "Không lùi ngày kết thúc về trước hôm nay — muốn dừng chính sách sớm hãy dùng Thu hồi (có lý do, báo Sale).",
    );
  }
  await kiemPhamVi(input.coSo, input.khoaHoc);
  const ma = hieuLucMa(input.tuNgay, input.denNgay);
  try {
    await db.$transaction(async (tx) => {
      // Ghi CÓ ĐIỀU KIỆN `revokedAt: null` (rà 26/09, KM-R1): kiểm ở trên là đọc rời — một lượt
      // thu hồi commit giữa lúc đó thì `update` trần sẽ ghi đè lên chính sách vừa bị thu hồi.
      const up = await tx.promotionPolicy.updateMany({
        where: { id: cu.id, revokedAt: null },
        data: {
          documentCode: input.maVanBan,
          name: input.ten,
          benefitText: input.noiDungUuDai,
          conditionText: input.dieuKien,
          validFrom: cotNgay(input.tuNgay),
          validUntil: cotNgay(input.denNgay),
          orgUnitIds: [...new Set(input.coSo)],
          courseIds: [...new Set(input.khoaHoc)],
          ...cotTep(input.tep),
          updatedById: nguoi.userId,
        },
      });
      // THROW (không return) — luật rollback: phép ghi phía dưới không được chạy.
      if (up.count !== 1) throw new LoiKhuyenMai("SAI_TRANG_THAI", "Chính sách vừa bị thu hồi — không sửa được.");
      const moi = await tx.promotionPolicy.findUniqueOrThrow({ where: { id: cu.id } });
      // Hiệu lực của mã = hiệu lực chính sách — đồng bộ trong CÙNG transaction.
      await tx.voucher.updateMany({ where: { policyId: cu.id }, data: ma });
      await writeAudit({
        tx,
        actor: { id: nguoi.userId, name: nguoi.ten },
        module: MODULE,
        entityType: "PromotionPolicy",
        entityId: cu.id,
        action: "UPDATE",
        oldValues: {
          maVanBan: cu.documentCode,
          ten: cu.name,
          noiDungUuDai: cu.benefitText,
          dieuKien: cu.conditionText,
          tuNgay: ngayBatDau(cu),
          denNgay: ngayKetThuc({ ...cu, revokedAt: null }),
          coSo: cu.orgUnitIds,
          khoaHoc: cu.courseIds,
          tep: cu.fileName,
        },
        newValues: {
          maVanBan: moi.documentCode,
          ten: moi.name,
          noiDungUuDai: moi.benefitText,
          dieuKien: moi.conditionText,
          tuNgay: input.tuNgay,
          denNgay: input.denNgay,
          coSo: moi.orgUnitIds,
          khoaHoc: moi.courseIds,
          tep: moi.fileName,
        },
      });
    });
  } catch (e) {
    if (laTrungMa(e)) throw new LoiKhuyenMai("TRUNG_MA", `Mã văn bản ${input.maVanBan} đã có trên hệ thống.`);
    throw e;
  }
}

export async function thuHoiChinhSach(
  nguoi: NguoiThaoTac,
  input: { id: string; lyDo: string },
  now: Date,
): Promise<{ soNguoiDuocBao: number }> {
  const cs = await db.$transaction(async (tx) => {
    // `updateMany` có điều kiện — hai người bấm thu hồi cùng lúc thì chỉ một lượt ghi.
    const up = await tx.promotionPolicy.updateMany({
      where: { id: input.id, revokedAt: null },
      data: { revokedAt: now, revokedById: nguoi.userId, revokeReason: input.lyDo, updatedById: nguoi.userId },
    });
    if (up.count !== 1) throw new LoiKhuyenMai("SAI_TRANG_THAI", "Chính sách không tồn tại hoặc đã thu hồi.");
    await tx.voucher.updateMany({ where: { policyId: input.id }, data: { isActive: false } });
    await writeAudit({
      tx,
      actor: { id: nguoi.userId, name: nguoi.ten },
      module: MODULE,
      entityType: "PromotionPolicy",
      entityId: input.id,
      action: "REVOKE",
      newValues: { thuHoiLuc: now.toISOString() },
      reason: input.lyDo,
    });
    return tx.promotionPolicy.findUniqueOrThrow({ where: { id: input.id } });
  });
  const soNguoiDuocBao = await baoNguoiTraCuu("thu-hoi", cs, nguoi, input.lyDo, now);
  return { soNguoiDuocBao };
}

export async function themVoucher(nguoi: NguoiThaoTac, input: VoucherInput, now: Date): Promise<{ id: string }> {
  const cs = await db.promotionPolicy.findUnique({ where: { id: input.chinhSachId } });
  if (!cs) throw new LoiKhuyenMai("KHONG_TIM_THAY", "Không tìm thấy chính sách.");
  const tt = trangThaiTai(cs, ngayVN(now));
  if (tt === "da_thu_hoi" || tt === "het_han") {
    throw new LoiKhuyenMai("SAI_TRANG_THAI", "Chính sách đã hết hiệu lực — không thêm mã được.");
  }
  const laPhanTram = input.kieu === "PERCENT";
  try {
    return await db.$transaction(async (tx) => {
      const v = await tx.voucher.create({
        data: {
          code: input.ma,
          name: `${cs.documentCode} · ${input.ma}`,
          description: input.ghiChu,
          type: "COURSE",
          discountKind: input.kieu,
          discountPercent: laPhanTram ? input.phanTram : null,
          discountAmount: laPhanTram ? null : input.soTien,
          maxDiscount: laPhanTram ? input.giamToiDa : null,
          minOrderValue: input.donToiThieu,
          quantity: input.soLuong,
          ...hieuLucMa(ngayBatDau(cs), ngayKetThuc({ ...cs, revokedAt: null })),
          isActive: true,
          createdByUserId: nguoi.userId,
          policyId: cs.id,
        },
        select: { id: true },
      });
      await writeAudit({
        tx,
        actor: { id: nguoi.userId, name: nguoi.ten },
        module: MODULE,
        entityType: "Voucher",
        entityId: v.id,
        action: "CREATE",
        newValues: {
          ma: input.ma,
          chinhSach: cs.documentCode,
          kieu: input.kieu,
          phanTram: laPhanTram ? input.phanTram : null,
          soTien: laPhanTram ? null : input.soTien,
          soLuong: input.soLuong,
        },
      });
      return v;
    });
  } catch (e) {
    if (laTrungMa(e)) throw new LoiKhuyenMai("TRUNG_MA", `Mã ${input.ma} đã được dùng cho một voucher khác.`);
    throw e;
  }
}

export async function batTatVoucher(
  nguoi: NguoiThaoTac,
  input: { id: string; bat: boolean },
  now: Date,
): Promise<void> {
  const v = await db.voucher.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      code: true,
      isActive: true,
      policy: { select: { validFrom: true, validUntil: true, revokedAt: true } },
    },
  });
  if (!v || !v.policy) throw new LoiKhuyenMai("KHONG_TIM_THAY", "Không tìm thấy mã voucher.");
  if (input.bat) {
    // Cùng luật với `themVoucher`: văn bản đã thu hồi/hết hạn thì không có mã nào sống lại.
    const tt = trangThaiTai(v.policy, ngayVN(now));
    if (tt === "da_thu_hoi" || tt === "het_han") {
      throw new LoiKhuyenMai("SAI_TRANG_THAI", "Chính sách đã hết hiệu lực — không bật lại mã được.");
    }
  }
  if (v.isActive === input.bat) return;
  await db.$transaction(async (tx) => {
    // Bật lại: ghi CÓ ĐIỀU KIỆN chính sách chưa thu hồi (rà 26/09, KM-R2) — kiểm ở trên là đọc
    // rời, một lượt thu hồi chen vào sẽ bị lượt bật này làm mã SỐNG LẠI. Tắt thì không cần điều kiện.
    const up = await tx.voucher.updateMany({
      where: input.bat ? { id: v.id, policy: { is: { revokedAt: null } } } : { id: v.id },
      data: { isActive: input.bat },
    });
    if (up.count !== 1) throw new LoiKhuyenMai("SAI_TRANG_THAI", "Chính sách vừa bị thu hồi — không bật lại mã được.");
    await writeAudit({
      tx,
      actor: { id: nguoi.userId, name: nguoi.ten },
      module: MODULE,
      entityType: "Voucher",
      entityId: v.id,
      action: input.bat ? "ENABLE" : "DISABLE",
      oldValues: { dangBat: v.isActive },
      newValues: { dangBat: input.bat },
    });
  });
}

// ─── Đọc ─────────────────────────────────────────────────────────────────────────────

export type VoucherView = {
  id: string;
  ma: string;
  uuDai: string;
  donToiThieu: number;
  soLuong: number | null;
  /// Đã dùng bao nhiêu lượt. Có nghĩa TỪ 28/09/2026 — trước đó không đường ghi nào.
  daDung: number;
  dangBat: boolean;
  ghiChu: string | null;
};

export type ChinhSachView = {
  id: string;
  maVanBan: string;
  ten: string;
  noiDungUuDai: string;
  dieuKien: string | null;
  tuNgay: string;
  denNgay: string;
  /** Ngày cuối thật sự (đã tính thu hồi). */
  ketThuc: string;
  daTungHieuLuc: boolean;
  /**
   * Áp toàn hệ thống? Đọc từ CỘT GỐC (`orgUnitIds` rỗng), KHÔNG suy từ `coSo.length === 0`:
   * cơ sở được chọn mà sau đó bị xoá khỏi cây thì `coSo` rỗng — suy ngược ra "toàn hệ thống"
   * là mở rộng phạm vi một chính sách mà BLĐ không hề ban hành (fail-open).
   */
  toanHeThong: boolean;
  coSo: { id: string; ma: string; ten: string }[];
  /** Mọi khoá? — cùng lý do như `toanHeThong`. */
  moiKhoa: boolean;
  khoaHoc: { id: string; ma: string; ten: string }[];
  tep: { key: string; ten: string; url: string } | null;
  thuHoiLuc: Date | null;
  lyDoThuHoi: string | null;
  vouchers: VoucherView[];
  taoLuc: Date;
  capNhatLuc: Date;
  validFrom: Date;
  validUntil: Date;
  revokedAt: Date | null;
};

const CHON = {
  id: true,
  documentCode: true,
  name: true,
  benefitText: true,
  conditionText: true,
  validFrom: true,
  validUntil: true,
  orgUnitIds: true,
  courseIds: true,
  fileKey: true,
  fileName: true,
  fileUrl: true,
  revokedAt: true,
  revokeReason: true,
  createdAt: true,
  updatedAt: true,
  vouchers: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      code: true,
      discountKind: true,
      discountPercent: true,
      discountAmount: true,
      maxDiscount: true,
      minOrderValue: true,
      quantity: true,
      usedCount: true,
      isActive: true,
      description: true,
    },
  },
} satisfies Prisma.PromotionPolicySelect;

type DongDb = Prisma.PromotionPolicyGetPayload<{ select: typeof CHON }>;

async function dungView(rows: DongDb[]): Promise<ChinhSachView[]> {
  const donViIds = [...new Set(rows.flatMap((r) => r.orgUnitIds))];
  const khoaIds = [...new Set(rows.flatMap((r) => r.courseIds))];
  const [donVi, khoa] = await Promise.all([
    donViIds.length === 0
      ? []
      : db.orgUnit.findMany({ where: { id: { in: donViIds } }, select: { id: true, code: true, name: true } }),
    khoaIds.length === 0
      ? []
      : db.course.findMany({ where: { id: { in: khoaIds } }, select: { id: true, code: true, slug: true, name: true } }),
  ]);
  const dv = new Map(donVi.map((d) => [d.id, d]));
  const kh = new Map(khoa.map((k) => [k.id, k]));
  return rows.map((r) => ({
    id: r.id,
    maVanBan: r.documentCode,
    ten: r.name,
    noiDungUuDai: r.benefitText,
    dieuKien: r.conditionText,
    tuNgay: ngayBatDau(r),
    denNgay: ngayKetThuc({ ...r, revokedAt: null }),
    ketThuc: ngayKetThuc(r),
    daTungHieuLuc: daTungHieuLuc(r),
    toanHeThong: r.orgUnitIds.length === 0,
    moiKhoa: r.courseIds.length === 0,
    coSo: r.orgUnitIds.flatMap((id) => {
      const d = dv.get(id);
      return d ? [{ id, ma: d.code, ten: d.name }] : [];
    }),
    khoaHoc: r.courseIds.flatMap((id) => {
      const k = kh.get(id);
      return k ? [{ id, ma: k.code?.trim() || k.slug, ten: k.name }] : [];
    }),
    tep: r.fileUrl && r.fileKey ? { key: r.fileKey, ten: r.fileName ?? "Văn bản gốc", url: r.fileUrl } : null,
    thuHoiLuc: r.revokedAt,
    lyDoThuHoi: r.revokeReason,
    vouchers: r.vouchers.map((v) => ({
      id: v.id,
      ma: v.code,
      uuDai: moTaUuDaiMa(v),
      donToiThieu: v.minOrderValue,
      soLuong: v.quantity,
      daDung: v.usedCount,
      dangBat: v.isActive,
      ghiChu: v.description,
    })),
    taoLuc: r.createdAt,
    capNhatLuc: r.updatedAt,
    validFrom: r.validFrom,
    validUntil: r.validUntil,
    revokedAt: r.revokedAt,
  }));
}

/** Mọi chính sách, mới ban hành trước. Danh mục nhỏ (vài chục văn bản/năm) — không phân trang ở DB. */
export async function docDanhSachChinhSach(): Promise<ChinhSachView[]> {
  const rows = await db.promotionPolicy.findMany({ orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }], select: CHON });
  return dungView(rows);
}

export async function docChinhSach(id: string): Promise<ChinhSachView | null> {
  const r = await db.promotionPolicy.findUnique({ where: { id }, select: CHON });
  if (!r) return null;
  return (await dungView([r]))[0] ?? null;
}

/** Lựa chọn phạm vi cho form ban hành: cơ sở đang hoạt động + khoá đang dạy (cùng bộ lọc màn Tra cứu). */
export async function docLuaChonPhamVi(): Promise<{
  coSo: { id: string; ma: string; ten: string }[];
  khoaHoc: { id: string; ma: string; ten: string }[];
}> {
  const [coSo, khoaHoc] = await Promise.all([
    db.orgUnit.findMany({
      where: { deletedAt: null, isActive: true, type: "CENTER" },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    db.course.findMany({
      where: { isTeachable: true, isActive: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, code: true, slug: true, name: true },
    }),
  ]);
  return {
    coSo: coSo.map((c) => ({ id: c.id, ma: c.code, ten: c.name })),
    khoaHoc: khoaHoc.map((k) => ({ id: k.id, ma: k.code?.trim() || k.slug, ten: k.name })),
  };
}
