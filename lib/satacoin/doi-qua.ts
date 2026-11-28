import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { orgUnitIdForCenter } from "@/lib/org/org-service";

/**
 * WP8 — ĐỔI QUÀ SATACOIN (OD-02, HS2-D4). MỘT nơi chứa luật; API di động và các màn nhân sự đều gọi vào đây (không có luật thứ hai).
 *
 * Mô hình (xem chú thích ở prisma/schema.prisma):
 *   · Ví = sổ cái BẤT BIẾN `SataCoinTransaction` (không đổi). KHÔNG có đường cộng coin tự động.
 *   · GIỮ coin = một `SataCoinRedemption` đang REQUESTED/APPROVED. Khả dụng = Σ sổ cái − Σ coinCost đang giữ.
 *   · Hoàn tất (DELIVERED) = trừ coin THẬT: MỘT dòng SPEND ghi cùng transaction với trạng thái DELIVERED.
 *   · Huỷ / từ chối ⇒ hoàn: chỉ cần đổi trạng thái (coin chưa từng rời sổ cái) + hoàn tồn kho giữ chỗ.
 *
 * Bất biến được khoá bằng test Postgres thật (`tests/satacoin/doi-qua.spec.ts`):
 *   (1) hai yêu cầu đồng thời vượt số dư ⇒ ĐÚNG MỘT thắng — nhờ khoá hàng học viên `SELECT … FOR UPDATE`;
 *   (2) không bán quá tồn kho — trừ CÓ ĐIỀU KIỆN (`quantity >= 1`) + CHECK >= 0 ở DB;
 *   (3) cùng `idempotencyKey` gửi lại ⇒ trả yêu cầu cũ, không giữ thêm;
 *   (4) cổng đứng TRƯỚC phép ghi đầu tiên và từ chối = `throw` (callback `$transaction` KHÔNG rollback bằng `return` — CLAUDE.md luật 7).
 */

export type MaLoiDoiQua =
  | "KHONG_TIM_THAY_HOC_VIEN"
  | "KHONG_CO_CO_SO"
  | "KHONG_TIM_THAY_QUA"
  | "KHONG_TIM_THAY_YEU_CAU"
  | "KHONG_DU_COIN"
  | "HET_QUA"
  | "SAI_TRANG_THAI"
  | "KHOA_GUI_LAI_KHAC_QUA";

export class LoiDoiQua extends Error {
  constructor(
    public readonly ma: MaLoiDoiQua,
    message: string,
  ) {
    super(message);
    this.name = "LoiDoiQua";
  }
}

type Tx = Prisma.TransactionClient;

/** Trạng thái đang GIỮ coin + giữ chỗ quà. */
export const TRANG_THAI_DANG_GIU = ["REQUESTED", "APPROVED"] as const;

/** Khoá hàng học viên: mọi thay đổi ví/giữ coin của MỘT học viên chạy tuần tự (Postgres `FOR UPDATE`). */
export async function khoaHocVien(tx: Tx, studentId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Student" WHERE "id" = ${studentId} FOR UPDATE`;
  if (rows.length === 0) throw new LoiDoiQua("KHONG_TIM_THAY_HOC_VIEN", "Không tìm thấy học viên");
}

export type SoDuVi = { soDu: number; dangGiu: number; khaDung: number };

/** Số dư sổ cái, phần đang giữ và phần khả dụng. PHẢI gọi trong transaction đã `khoaHocVien` khi dùng để ra quyết định ghi. */
export async function soDuVi(tx: Tx | typeof db, studentId: string): Promise<SoDuVi> {
  const [vi, giu] = await Promise.all([
    tx.sataCoinTransaction.aggregate({ where: { studentId }, _sum: { amount: true } }),
    tx.sataCoinRedemption.aggregate({ where: { studentId, status: { in: [...TRANG_THAI_DANG_GIU] } }, _sum: { coinCost: true } }),
  ]);
  const soDu = vi._sum.amount ?? 0;
  const dangGiu = giu._sum.coinCost ?? 0;
  return { soDu, dangGiu, khaDung: soDu - dangGiu };
}

export type YeuCauDoiQua = {
  id: string;
  studentId: string;
  giftId: string;
  coinCost: number;
  status: "REQUESTED" | "APPROVED" | "DELIVERED" | "REJECTED" | "CANCELLED";
  createdAt: Date;
};

const CHON_YEU_CAU = { id: true, studentId: true, giftId: true, coinCost: true, status: true, createdAt: true } as const;

/** Gửi yêu cầu đổi quà: GIỮ coin + giữ chỗ tồn kho. Gửi lại cùng `idempotencyKey` ⇒ trả bản cũ (`trungLap`). */
export async function taoYeuCauDoiQua(params: { studentId: string; giftId: string; requestedByUserId: string; idempotencyKey: string }): Promise<{ yeuCau: YeuCauDoiQua; trungLap: boolean }> {
  // Tra OrgUnit ngoài transaction (chỉ đọc, không cần khoá).
  const sv = await db.student.findFirst({ where: { id: params.studentId, deletedAt: null }, select: { centerId: true } });
  if (!sv) throw new LoiDoiQua("KHONG_TIM_THAY_HOC_VIEN", "Không tìm thấy học viên");
  if (!sv.centerId) throw new LoiDoiQua("KHONG_CO_CO_SO", "Học viên chưa thuộc cơ sở nào nên chưa đổi quà được");
  const centerId = sv.centerId;
  const orgUnitId = await orgUnitIdForCenter(centerId);

  return db.$transaction(async (tx) => {
    await khoaHocVien(tx, params.studentId);

    // Gửi lại: cùng khoá ⇒ bản cũ (sau khoá hàng ⇒ hai lượt đồng thời cùng khoá không thể cùng tạo).
    const cu = await tx.sataCoinRedemption.findUnique({ where: { studentId_idempotencyKey: { studentId: params.studentId, idempotencyKey: params.idempotencyKey } }, select: { ...CHON_YEU_CAU } });
    if (cu) {
      if (cu.giftId !== params.giftId) throw new LoiDoiQua("KHOA_GUI_LAI_KHAC_QUA", "Khoá gửi lại đã dùng cho một món quà khác");
      return { yeuCau: cu, trungLap: true };
    }

    // ── CÁC CỔNG (đều TRƯỚC phép ghi đầu tiên) ──
    const qua = await tx.sataCoinGift.findFirst({ where: { id: params.giftId, isActive: true }, select: { id: true, coinCost: true } });
    if (!qua) throw new LoiDoiQua("KHONG_TIM_THAY_QUA", "Món quà không tồn tại hoặc đã ngừng");
    const vi = await soDuVi(tx, params.studentId);
    if (vi.khaDung < qua.coinCost) throw new LoiDoiQua("KHONG_DU_COIN", `Chưa đủ coin (khả dụng ${vi.khaDung}, cần ${qua.coinCost})`);

    // ── GHI ──
    // Giữ chỗ tồn kho bằng phép trừ CÓ ĐIỀU KIỆN: hai người cùng lấy chiếc cuối ⇒ chỉ một người có `count = 1`.
    const tru = await tx.sataCoinGiftStock.updateMany({ where: { giftId: qua.id, centerId, quantity: { gte: 1 } }, data: { quantity: { decrement: 1 } } });
    if (tru.count === 0) throw new LoiDoiQua("HET_QUA", "Quà này đã hết ở cơ sở của bé"); // throw ⇒ không còn phép ghi nào để rollback
    const yeuCau = await tx.sataCoinRedemption.create({
      data: { studentId: params.studentId, giftId: qua.id, centerId, orgUnitId, coinCost: qua.coinCost, requestedByUserId: params.requestedByUserId, idempotencyKey: params.idempotencyKey },
      select: { ...CHON_YEU_CAU },
    });
    return { yeuCau, trungLap: false };
  });
}

async function hoanTonKho(tx: Tx, giftId: string, centerId: string) {
  await tx.sataCoinGiftStock.updateMany({ where: { giftId, centerId }, data: { quantity: { increment: 1 } } });
}

/** Phụ huynh huỷ yêu cầu CHƯA duyệt ⇒ hoàn coin (chỉ cần đổi trạng thái) + hoàn tồn kho. */
export async function huyYeuCauDoiQua(params: { studentId: string; redemptionId: string }): Promise<YeuCauDoiQua> {
  return db.$transaction(async (tx) => {
    await khoaHocVien(tx, params.studentId);
    const yc = await tx.sataCoinRedemption.findFirst({ where: { id: params.redemptionId, studentId: params.studentId }, select: { id: true, giftId: true, centerId: true, status: true } });
    if (!yc) throw new LoiDoiQua("KHONG_TIM_THAY_YEU_CAU", "Không tìm thấy yêu cầu đổi quà");
    if (yc.status !== "REQUESTED") throw new LoiDoiQua("SAI_TRANG_THAI", "Yêu cầu đã được xử lý, ba mẹ không huỷ được nữa");
    const cap = await tx.sataCoinRedemption.updateMany({ where: { id: yc.id, status: "REQUESTED" }, data: { status: "CANCELLED", decidedAt: new Date() } });
    if (cap.count !== 1) throw new LoiDoiQua("SAI_TRANG_THAI", "Yêu cầu đã được xử lý, ba mẹ không huỷ được nữa");
    await hoanTonKho(tx, yc.giftId, yc.centerId);
    return tx.sataCoinRedemption.findUniqueOrThrow({ where: { id: yc.id }, select: { ...CHON_YEU_CAU } });
  });
}

export type HanhDongNhanVien = "DUYET" | "TU_CHOI" | "HOAN_TAT";

/**
 * Nhân viên (QLCS / Admin) xử lý yêu cầu. `actorUserId` do tầng gọi gắn từ phiên và đã kiểm QUYỀN (`can()` ở server action) — hàm này không kiểm quyền.
 *   DUYET: REQUESTED → APPROVED (vẫn giữ) · TU_CHOI: REQUESTED/APPROVED → REJECTED (hoàn) · HOAN_TAT: APPROVED → DELIVERED + MỘT dòng SPEND.
 */
export async function xuLyYeuCauDoiQua(params: { redemptionId: string; actorUserId: string; hanhDong: HanhDongNhanVien; ghiChu?: string | null }): Promise<YeuCauDoiQua> {
  const goc = await db.sataCoinRedemption.findUnique({ where: { id: params.redemptionId }, select: { studentId: true } });
  if (!goc) throw new LoiDoiQua("KHONG_TIM_THAY_YEU_CAU", "Không tìm thấy yêu cầu đổi quà");
  return db.$transaction(async (tx) => {
    await khoaHocVien(tx, goc.studentId);
    // Đọc LẠI dưới khoá: trạng thái ở lượt đọc ngoài khoá có thể đã cũ.
    const yc = await tx.sataCoinRedemption.findUnique({ where: { id: params.redemptionId }, select: { id: true, studentId: true, giftId: true, centerId: true, orgUnitId: true, coinCost: true, status: true, gift: { select: { name: true } } } });
    if (!yc) throw new LoiDoiQua("KHONG_TIM_THAY_YEU_CAU", "Không tìm thấy yêu cầu đổi quà");
    const bayGio = new Date();

    if (params.hanhDong === "DUYET") {
      if (yc.status !== "REQUESTED") throw new LoiDoiQua("SAI_TRANG_THAI", "Chỉ duyệt được yêu cầu đang chờ");
      await tx.sataCoinRedemption.updateMany({ where: { id: yc.id, status: "REQUESTED" }, data: { status: "APPROVED", decidedById: params.actorUserId, decidedAt: bayGio, decisionNote: params.ghiChu ?? null } });
    } else if (params.hanhDong === "TU_CHOI") {
      if (yc.status !== "REQUESTED" && yc.status !== "APPROVED") throw new LoiDoiQua("SAI_TRANG_THAI", "Chỉ từ chối được yêu cầu đang giữ");
      const cap = await tx.sataCoinRedemption.updateMany({ where: { id: yc.id, status: { in: ["REQUESTED", "APPROVED"] } }, data: { status: "REJECTED", decidedById: params.actorUserId, decidedAt: bayGio, decisionNote: params.ghiChu ?? null } });
      if (cap.count !== 1) throw new LoiDoiQua("SAI_TRANG_THAI", "Yêu cầu đã được xử lý");
      await hoanTonKho(tx, yc.giftId, yc.centerId);
    } else {
      if (yc.status !== "APPROVED") throw new LoiDoiQua("SAI_TRANG_THAI", "Chỉ hoàn tất được yêu cầu đã duyệt");
      // Cổng TRƯỚC phép ghi: sổ cái phải còn đủ coin (khác `khaDung`: phần giữ của CHÍNH yêu cầu này đang nằm trong `dangGiu`).
      const vi = await soDuVi(tx, yc.studentId);
      if (vi.soDu < yc.coinCost) throw new LoiDoiQua("KHONG_DU_COIN", `Sổ cái chỉ còn ${vi.soDu} coin, không đủ trừ ${yc.coinCost}`);
      const cap = await tx.sataCoinRedemption.updateMany({ where: { id: yc.id, status: "APPROVED" }, data: { status: "DELIVERED", deliveredAt: bayGio, decidedById: params.actorUserId, decisionNote: params.ghiChu ?? null } });
      if (cap.count !== 1) throw new LoiDoiQua("SAI_TRANG_THAI", "Yêu cầu đã được xử lý");
      const gd = await tx.sataCoinTransaction.create({
        data: {
          studentId: yc.studentId,
          amount: -yc.coinCost,
          type: "SPEND",
          reason: "REDEEM_GIFT",
          note: `Đổi quà «${yc.gift.name}» (yêu cầu ${yc.id})`,
          centerId: yc.centerId,
          orgUnitId: yc.orgUnitId,
          createdById: params.actorUserId,
          // Lớp chặn trừ-hai-lần THỨ HAI ở DB (sau khoá hàng + điều kiện trạng thái): mỗi yêu cầu chỉ có MỘT dòng SPEND, chỉ mục duy nhất (studentId, eventKey) từ chối dòng thứ hai.
          eventKey: `doi-qua:${yc.id}`,
        },
        select: { id: true },
      });
      await tx.sataCoinRedemption.update({ where: { id: yc.id }, data: { spendTxId: gd.id } });
    }
    // V8.24 (BR-COIN-01): báo phụ huynh khi yêu cầu được duyệt / từ chối / trao — CÙNG transaction (xử lý xong mà không báo là không xảy ra). Nội dung KHÔNG có ghi chú của nhân viên.
    const trangThaiMoi = params.hanhDong === "DUYET" ? "APPROVED" : params.hanhDong === "TU_CHOI" ? "REJECTED" : "DELIVERED";
    await publishEvent("coin.redemption", { redemptionId: yc.id, status: trangThaiMoi }, { tx, dedupeKey: `coin.redemption:${yc.id}:${trangThaiMoi}` });
    return tx.sataCoinRedemption.findUniqueOrThrow({ where: { id: yc.id }, select: { ...CHON_YEU_CAU } });
  });
}

/** Danh mục quà đang bán cho một học viên: chỉ quà đang mở, kèm `conHang` theo tồn kho CƠ SỞ của bé (không lộ số lượng). */
export async function danhMucQuaChoHocVien(studentId: string): Promise<Array<{ id: string; ten: string; moTa: string | null; coin: number; conHang: boolean }>> {
  const sv = await db.student.findFirst({ where: { id: studentId, deletedAt: null }, select: { centerId: true } });
  const ds = await db.sataCoinGift.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { coinCost: "asc" }],
    select: { id: true, name: true, description: true, coinCost: true, stocks: { where: { centerId: sv?.centerId ?? "-" }, select: { quantity: true } } },
  });
  return ds.map((g) => ({ id: g.id, ten: g.name, moTa: g.description, coin: g.coinCost, conHang: (g.stocks[0]?.quantity ?? 0) > 0 }));
}
