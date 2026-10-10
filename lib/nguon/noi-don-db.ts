// lib/nguon/noi-don-db.ts — TẦNG DB của PR0 "Nối Order.leadId cho đơn cũ" (D8).
//
// Tách khỏi script để ca DB (`tests/finance/noi-don-ve-lead.test.ts`) gọi ĐÚNG hàm mà script gọi —
// script chỉ còn đọc tham số dòng lệnh + in. Đặc tả: docs/source-commission/07-dac-ta-thi-cong-pr0-pr1.md §1.4.
//
// ─────────────────────────────────────────────────────────────────────────────
// QUY ƯỚC
//
//   · Mọi hàm nhận client làm tham số BẮT BUỘC (`PrismaClient` hoặc `Prisma.TransactionClient`),
//     KHÔNG import `db` để dùng ngầm (luật 7: `tsc` liệt kê chỗ gọi). Script truyền `scriptDb()`, test
//     truyền client của test.
//   · Số câu tra CỐ ĐỊNH, không theo số đơn (bài học `goiYDon`/P2028 — CLAUDE.md).
//   · `docKeHoachNoiDon` nhận PHẠM VI BẮT BUỘC, không mặc định: thiếu thì ca DB sẽ lập kế hoạch trên
//     MỌI đơn `leadId NULL` của DB và có thể GẮN lead cho đơn của bộ test khác ([PB-10]).
//   · Ba bộ lọc/công thức của hoa hồng lấy từ TỆP GỐC (`WHERE_THUC_THU`, `SELECT_HOA_HONG`,
//     `mapButToanHoaHong`, `tinhHoaHongTheoKy`) — không chép lại. Dự báo "sau" mà tự tính khác
//     `chotKyHoaHong` là dự báo sai, và người duyệt tin nó.
//
// ⚠️ `mapButToanHoaHong(rows, phanCong)` — LUÔN truyền sổ phân công. Mặc định `[]` của nó là bẫy câm:
//    quên thì QC/QL_TT treo hết và "sau" lệch "đang lưu" mà không lỗi nào báo.
import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { pickEffectiveRates } from "@/lib/crm/commission-config";
import {
  SELECT_HOA_HONG,
  SELECT_PHAN_CONG,
  mapButToanHoaHong,
  thongKe,
} from "@/lib/crm/commission-run";
import { khoangKy, tinhHoaHongTheoKy } from "@/lib/crm/commission-thuc-thu";
import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";
import { expandPhoneVariants } from "@/lib/phone";
import {
  kyBiAnhHuong,
  lapKeHoachNoiDon,
  quyetDinhGhiNoiDon,
  soBaCot,
  vaLeadTrongBoNho,
  type DongBaCot,
  type KeHoachNoiDon,
  type TrangThaiKyGhi,
  type UngVienLead,
} from "@/lib/nguon/noi-don";

export type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Phạm vi BẮT BUỘC (luật 7). Script truyền `"TAT_CA"`; ca test truyền đúng id đơn fixture.
 */
export type PhamViNoiDon = "TAT_CA" | { orderIds: readonly string[] };

const loc = (phamVi: PhamViNoiDon): Prisma.OrderWhereInput =>
  phamVi === "TAT_CA" ? {} : { id: { in: [...phamVi.orderIds] } };

/** Actor cố định của script (khuôn `scripts/noi-hoc-vien-voi-lead.ts`). */
export const ACTOR_NOI_DON = { id: null, name: "Script nối đơn về lead (noi-don-ve-lead)" } as const;

export async function docKeHoachNoiDon(
  c: Client,
  phamVi: PhamViNoiDon,
): Promise<{ keHoach: KeHoachNoiDon; tongDon: number; donThieuLead: number }> {
  const tongDon = await c.order.count({ where: { deletedAt: null, ...loc(phamVi) } });
  const dons = await c.order.findMany({
    where: { deletedAt: null, leadId: null, ...loc(phamVi) },
    select: { id: true, code: true, customerPhone: true, centerId: true },
    orderBy: { code: "asc" },
  });

  let leads: UngVienLead[] = [];
  if (dons.length > 0) {
    // MỘT câu cho cả lô: lead lưu `0…` hay `84…` đều lọt; `lapKeHoachNoiDon` gom theo `phoneKey`.
    const rows = await c.lead.findMany({
      where: { deletedAt: null, phone: { in: expandPhoneVariants(dons.map((d) => d.customerPhone)) } },
      select: { id: true, phone: true, deletedAt: true, convertedById: true, adminId: true, centerId: true },
    });
    leads = rows.map((r) => ({
      leadId: r.id,
      phone: r.phone,
      deletedAt: r.deletedAt,
      convertedById: r.convertedById,
      adminId: r.adminId,
      centerId: r.centerId,
    }));
  }

  const keHoach = lapKeHoachNoiDon(
    dons.map((d) => ({ orderId: d.id, code: d.code, customerPhone: d.customerPhone, centerId: d.centerId })),
    leads,
  );
  return { keHoach, tongDon, donThieuLead: dons.length };
}

/**
 * [PB-8] Đầu vào DUY NHẤT của `kyBiAnhHuong` — cho cả `tinhBaCot` lẫn `ghiNoiDon`. MỘT câu, KHÔNG theo
 * kỳ: mọi bút toán thực thu của các đơn đó ở mọi kỳ. Đọc theo từng kỳ DRAFT/REOPENED thì kỳ APPROVED
 * chứa tiền của đơn sắp nối không bao giờ lọt vào phép kiểm, và cổng APPROVED câm đúng ca nó chặn.
 */
export async function docButToanCuaDon(
  c: Client,
  orderIds: readonly string[],
): Promise<{ orderId: string; paidDate: Date }[]> {
  if (orderIds.length === 0) return [];
  return c.payment.findMany({
    where: { ...WHERE_THUC_THU, orderId: { in: [...orderIds] } },
    select: { orderId: true, paidDate: true },
  });
}

/** Trạng thái các kỳ (một câu). Kỳ không có dòng nào thì KHÔNG có trong kết quả (⇒ CHƯA CÓ bảng kê). */
export async function docTrangThaiKy(c: Client, ky: readonly string[]): Promise<TrangThaiKyGhi[]> {
  if (ky.length === 0) return [];
  return c.commissionStatement.findMany({
    where: { period: { in: [...ky] } },
    select: { period: true, status: true },
    orderBy: { period: "asc" },
  });
}

export type KyBaCot = {
  period: string;
  status: "DRAFT" | "APPROVED" | "REOPENED" | "CHUA_CO";
  /** Kỳ này có bút toán của đơn sắp nối không (kỳ APPROVED bị ảnh hưởng ⇒ `--ghi` sẽ DỪNG). */
  biAnhHuong: boolean;
  dong: DongBaCot[];
  trialTeacherDangLuu: number;
  thucThuKhongCoLead: { truoc: number; sau: number };
  chuaCoNguoiHuong: { truoc: Record<string, number>; sau: Record<string, number> };
};

/**
 * Ba cột (a) đang lưu · (b) tính lại hôm nay · (c) tính lại sau khi vá `leadId` trong bộ nhớ, cho mọi kỳ
 * còn sửa được (DRAFT/REOPENED) VÀ mọi kỳ có tiền của đơn sắp nối (kể cả APPROVED — để người duyệt thấy).
 */
export async function tinhBaCot(c: Client, keHoach: KeHoachNoiDon): Promise<{ ky: KyBaCot[] }> {
  const orderIds = keHoach.mot.map((m) => m.orderId);
  const butToanDon = await docButToanCuaDon(c, orderIds);
  const kyAnhHuong = kyBiAnhHuong(butToanDon, new Set(orderIds));

  // Một câu: mọi kỳ còn sửa được ∪ kỳ bị ảnh hưởng.
  const bangKe = await c.commissionStatement.findMany({
    where: {
      OR: [{ status: { in: ["DRAFT", "REOPENED"] } }, { period: { in: kyAnhHuong } }],
    },
    select: { period: true, status: true },
  });
  const trangThai = new Map(bangKe.map((b) => [b.period, b.status] as const));
  const kyCanIn = [...new Set([...trangThai.keys(), ...kyAnhHuong])].sort();
  if (kyCanIn.length === 0) return { ky: [] };

  // Đọc MỘT lần cho mọi kỳ — giống `chotKyHoaHong`: tỉ lệ + TOÀN BỘ sổ phân công (không lọc theo kỳ).
  const rateRows = await c.commissionRateConfig.findMany({
    select: { tier: true, rate: true, effectiveFrom: true, effectiveTo: true },
  });
  const phanCong = await c.centerCommissionAssignee.findMany({ select: SELECT_PHAN_CONG });
  const ratesAt = (at: Date) => pickEffectiveRates(rateRows, at);
  const va = new Map<string, UngVienLead>(keHoach.mot.map((m) => [m.orderId, m.lead]));
  const kyAnhHuongSet = new Set(kyAnhHuong);

  const ky: KyBaCot[] = [];
  for (const period of kyCanIn) {
    const { start, end } = khoangKy(period);
    const rows = await c.payment.findMany({
      where: { ...WHERE_THUC_THU, paidDate: { gte: start, lt: end } },
      select: { ...SELECT_HOA_HONG, orderId: true },
      orderBy: { id: "asc" },
    });
    const butToanTruoc = mapButToanHoaHong(rows, phanCong);
    const butToanSau = mapButToanHoaHong(vaLeadTrongBoNho(rows, va), phanCong);
    const truoc = tinhHoaHongTheoKy({ period, butToan: butToanTruoc, ratesAt });
    const sau = tinhHoaHongTheoKy({ period, butToan: butToanSau, ratesAt });
    const thongKeTruoc = thongKe(period, butToanTruoc, truoc, ratesAt);
    const thongKeSau = thongKe(period, butToanSau, sau, ratesAt);

    const dangLuu = await c.commissionLine.findMany({
      where: { statement: { period } },
      select: { tier: true, recipientId: true, amount: true },
    });
    const { dong, trialTeacherDangLuu } = soBaCot(dangLuu, truoc, sau);

    ky.push({
      period,
      status: trangThai.get(period) ?? "CHUA_CO",
      biAnhHuong: kyAnhHuongSet.has(period),
      dong,
      trialTeacherDangLuu,
      thucThuKhongCoLead: {
        truoc: thongKeTruoc.thucThuKhongCoLead,
        sau: thongKeSau.thucThuKhongCoLead,
      },
      chuaCoNguoiHuong: {
        truoc: { ...thongKeTruoc.chuaCoNguoiHuong },
        sau: { ...thongKeSau.chuaCoNguoiHuong },
      },
    });
  }
  return { ky };
}

export type DauVaoGhiNoiDon = {
  keHoach: KeHoachNoiDon;
  /** `null` = không truyền `--expect`. */
  soDuyet: number | null;
  /** `has_table_privilege(…"Order"…, 'UPDATE')`; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
};

/**
 * GHI — trước transaction chỉ để BÁO SỚM; cổng chặn thật nằm TRONG transaction (`ghiNoiDonTrongTx`).
 *
 * MỘT transaction cho cả lượt ([CHỌN Ở 07] — không chia lô): chia lô thì kỳ được duyệt giữa hai lô là
 * nối nửa vời. Ngân sách thời gian: mỗi đơn tới ~4 lượt đi-về (`updateMany` · `auditLog.create` · 1–2
 * câu đọc ẩn của `writeAudit` khi `orgUnitId: null`), 101 đơn ⇒ ~404 lượt; ở 20–50 ms/lượt qua tunnel là
 * ~8–20 giây, dưới trần 120 giây (SUY — CHƯA ĐO trên tunnel thật; script in thời gian chạy lượt ghi).
 */
export async function ghiNoiDon(
  c: PrismaClient,
  input: DauVaoGhiNoiDon,
): Promise<{ daNoi: number; boQua: number }> {
  const orderIds = input.keHoach.mot.map((m) => m.orderId);
  const butToanDon = await docButToanCuaDon(c, orderIds);
  const kyAnhHuong = kyBiAnhHuong(butToanDon, new Set(orderIds));
  const truoc = quyetDinhGhiNoiDon({
    soDuyet: input.soDuyet,
    keHoach: input.keHoach.mot.length,
    ghiDuoc: input.ghiDuoc,
    trangThaiKy: await docTrangThaiKy(c, kyAnhHuong),
  });
  if (!truoc.ok) throw new Error(truoc.loi);

  return c.$transaction((tx) => ghiNoiDonTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

/**
 * [PB-18] Phần TRONG transaction, export riêng để ca `[NHH-D8-DB-02]` gọi THẲNG (không đi qua lượt kiểm
 * trước tx). Thiếu tách này thì cổng trong tx — cổng chống đua thật sự — không có ca nào canh.
 *
 * Mọi cổng đứng TRƯỚC phép ghi đầu tiên, và từ chối là `throw` (luật rollback — `return` KHÔNG rollback).
 */
export async function ghiNoiDonTrongTx(
  tx: Prisma.TransactionClient,
  input: DauVaoGhiNoiDon,
): Promise<{ daNoi: number; boQua: number }> {
  const mot = input.keHoach.mot;
  const orderIds = mot.map((m) => m.orderId);

  // 1) Đọc LẠI bút toán TRONG tx: một khoản mới vào kỳ đã duyệt giữa lượt kiểm trước và lượt này vẫn
  //    bị thấy.
  const butToanDon = await docButToanCuaDon(tx, orderIds);
  const kyBiAnhHuongMang = kyBiAnhHuong(butToanDon, new Set(orderIds));

  // 2) Khoá + đọc lại trạng thái kỳ. `FOR SHARE` chặn `approveStatement` cập nhật dòng đó cho tới khi
  //    lượt này commit. (Kỳ CHƯA có bảng kê thì không có dòng để khoá — và cũng chưa duyệt được gì.)
  const trangThaiKy =
    kyBiAnhHuongMang.length === 0
      ? []
      : await tx.$queryRaw<TrangThaiKyGhi[]>`
          SELECT "period", "status"::text AS status FROM "CommissionStatement"
          WHERE "period" = ANY(${kyBiAnhHuongMang}::text[]) FOR SHARE`;
  const quyetDinh = quyetDinhGhiNoiDon({
    soDuyet: input.soDuyet,
    keHoach: mot.length,
    ghiDuoc: input.ghiDuoc,
    trangThaiKy,
  });
  if (!quyetDinh.ok) throw new Error(quyetDinh.loi);

  // 2b) [F8] Lead ĐÍCH còn đúng như lúc lập kế hoạch? Kế hoạch (lượt chạy thử, hoặc `docKeHoachNoiDon` ngay trước
  //     `ghiNoiDon`) đọc NGOÀI transaction; giữa lúc đọc và lúc ghi có thể có người xoá mềm / gộp lead đích, hoặc
  //     nhập một lead THỨ HAI cùng SĐT — khi đó đơn không còn "MỘT lead duy nhất" và nối theo kế hoạch cũ là nối
  //     SAI NGƯỜI (hoa hồng đi theo `Order.leadId`). Lập lại kế hoạch của CHÍNH các đơn này bằng đúng phép phân
  //     loại cũ (`docKeHoachNoiDon` → `lapKeHoachNoiDon`) và đòi từng đơn vẫn rơi vào MOT với CÙNG lead.
  //     Lệch ⇒ `throw` (cả lượt lùi, 0 đơn nào được ghi — một giao dịch duy nhất, [CHỌN Ở 07]); KHÔNG `return`.
  //     Đơn đã bị gắn tay `leadId` / xoá mềm thì KHÔNG nằm trong kế hoạch mới và đi tiếp tới `updateMany` có điều
  //     kiện (0 dòng ⇒ `boQua`, FIX-H9) — đó là đường đã có, không phải "kế hoạch cũ".
  //     (Còn một khe nhỏ giữa câu đọc này và `updateMany` ở dưới; muốn đóng hẳn phải khoá `Lead` — không làm: kịch
  //     bản chạy tay, một người, sau khi đã duyệt `--expect`.)
  if (mot.length > 0) {
    const moi = await docKeHoachNoiDon(tx, { orderIds });
    const leadMoi = new Map(moi.keHoach.mot.map((m) => [m.orderId, m.lead.leadId] as const));
    const conTrongKeHoach = new Set(
      [...moi.keHoach.mot, ...moi.keHoach.nhieu, ...moi.keHoach.khong].map((d) => d.orderId),
    );
    const lech = mot.filter((m) => conTrongKeHoach.has(m.orderId) && leadMoi.get(m.orderId) !== m.lead.leadId);
    if (lech.length > 0) {
      throw new Error(
        `Kế hoạch nối đã CŨ: lead đích của ${lech.length} đơn (${lech.map((m) => m.code).join(", ")}) không còn là ` +
          `lead DUY NHẤT của SĐT (bị xoá/gộp hoặc có thêm lead cùng SĐT). Không ghi gì — chạy lại bản chạy thử để duyệt kế hoạch mới.`,
      );
    }
  }

  // 3) Ghi. `updateMany` CÓ ĐIỀU KIỆN: ai vừa gắn tay `leadId` thì 0 dòng đổi, commit vô hại (FIX-H9).
  let daNoi = 0;
  let boQua = 0;
  for (const m of mot) {
    const r = await tx.order.updateMany({
      where: { id: m.orderId, leadId: null, deletedAt: null },
      data: { leadId: m.lead.leadId },
    });
    if (r.count !== 1) {
      boQua++;
      continue;
    }
    daNoi++;
    await writeAudit({
      actor: input.actor,
      module: "nguon-hoa-hong",
      entityType: "Order",
      entityId: m.orderId,
      action: "NOI_LEAD",
      oldValues: { leadId: null },
      newValues: { leadId: m.lead.leadId, khoa: "canonicalPhone" },
      changedFields: ["leadId"],
      reason: "Nối đơn về lead theo SĐT chuẩn hoá (D8, scripts/nguon/noi-don-ve-lead.ts)",
      // `null` để `writeAudit` TỰ SUY từ chính `Order` (đơn vị của đơn) — không phải "đơn không thuộc đơn vị nào".
      orgUnitId: null,
      tx,
    });
  }
  return { daNoi, boQua };
}
