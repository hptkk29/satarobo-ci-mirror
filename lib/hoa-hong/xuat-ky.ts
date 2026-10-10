// lib/hoa-hong/xuat-ky.ts — XUẤT bảng chi (xlsx) + ĐÁNH DẤU ĐÃ CHI, và KẾT CHUYỂN SỔ ÂM.
//
// Nguồn: docs/source-commission/04 §13 (chi trả), 05 §4 (audit).
//
//   · Nội bộ (`beneficiaryEmployeeId` có giá trị) → xlsx BẢNG LƯƠNG tháng M: gom mọi kỳ `LOCKED` của tháng M ở MỌI cơ sở, MỘT dòng/người,
//     kèm sheet chi tiết dòng sổ. Chưa có module lương (`lib/cham-cong/cong-day.ts:15-16`) nên xuất xlsx; chi trong kỳ lương tháng M+1.
//   · Ngoài (Affiliate, PH giới thiệu không phải nhân viên) → lô QUYẾT TOÁN riêng, KHÔNG vào lương. Thuế khấu trừ là cấu hình theo
//     loại đối tượng; engine KHÔNG cài số (`PENDING_REGULATION`) ⇒ chỉ xuất GỘP.
//   · SỔ ÂM RÒNG theo người × tháng (`PENDING_REGULATION`, Q19): KHÔNG xuất số âm. Người có Σ tháng < 0 ⇒ xuất 0 và phần âm KẾT CHUYỂN sang
//     tháng kế (trừ dần vào số dương), mỗi lần kết chuyển là một hàng chờ mềm `NEGATIVE_BALANCE` (KHÔNG chặn khoá kỳ). Người đã nghỉ /
//     người ngoài có số âm ⇒ CÙNG hàng chờ đó, mang cờ `detail.canXemTay` (HR/BLĐ quyết thu hồi ngoài hệ thống hay xoá nợ). Chỉ người CÓ DÒNG trong lô
//     mới bị trừ nợ / bị đóng hàng chờ; nợ của người chưa có dòng giữ nguyên cho tới lô có dòng của họ. holdKey mang id lô.
//   · Phép kết chuyển nằm ở bước XUẤT; dòng sổ không đổi — sổ vẫn là nguồn sự thật.
//
// Xuất lương chỉ sau LOCKED: kỳ chưa khoá KHÔNG vào lô (xuất khi còn cơ sở chưa khoá ⇒ chỉ phần đã khoá, báo số kỳ còn thiếu).
import ExcelJS from "exceljs";
import { type Prisma, type PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";

import { HoaHongError } from "./kieu";
import { kiemChuyenTrangThaiKy } from "./ky-hoa-hong";
import { khoaKy } from "./ky-db";
import { batLyDoToiThieu, batPhamViKy, type NguoiThaoTacKy } from "./ky-service";

const MODULE_AUDIT = "hoa-hong";
const actorAudit = (a: NguoiThaoTacKy) => ({ id: a.userId, name: a.ten });

// ── Thuần: kết chuyển số âm ───────────────────────────────────────────────────────────────────

/**
 * Kết chuyển âm (04 §13). `tongThang` = Σ ròng tháng của từng người (USER id). `amKetChuyen` = số âm còn nợ từ các tháng trước (≤ 0).
 * Trả số XUẤT (không bao giờ âm) và số âm MỚI còn lại để chuyển tiếp.
 *
 *   hiệu = tongThang + amKetChuyen
 *   hiệu ≥ 0 ⇒ xuất hiệu, hết nợ        hiệu < 0 ⇒ xuất 0, nợ = hiệu
 */
export function ketChuyenAm(input: {
  tongThang: ReadonlyMap<string, number>;
  amKetChuyen: ReadonlyMap<string, number>;
}): { xuat: Map<string, number>; amMoi: Map<string, number> } {
  const xuat = new Map<string, number>();
  const amMoi = new Map<string, number>();
  const nguoi = new Set([...input.tongThang.keys(), ...input.amKetChuyen.keys()]);
  for (const id of [...nguoi].sort()) {
    const no = Math.min(0, input.amKetChuyen.get(id) ?? 0);
    const hieu = (input.tongThang.get(id) ?? 0) + no;
    xuat.set(id, Math.max(0, hieu));
    if (hieu < 0) amMoi.set(id, hieu);
  }
  return { xuat, amMoi };
}

export type DongBangChi = { nguoi: string; tenNguoi: string; maNhanVien: string | null; soTienKyNay: number; amKetChuyenTruoc: number; soTienChi: number; amKetChuyenSau: number };

export function dungBangChi(input: {
  tongThang: ReadonlyMap<string, number>;
  amKetChuyen: ReadonlyMap<string, number>;
  ten: ReadonlyMap<string, { ten: string; maNhanVien: string | null }>;
}): { dong: DongBangChi[]; tong: number } {
  const kc = ketChuyenAm({ tongThang: input.tongThang, amKetChuyen: input.amKetChuyen });
  const dong: DongBangChi[] = [...kc.xuat.entries()].map(([nguoi, soTienChi]) => ({
    nguoi,
    tenNguoi: input.ten.get(nguoi)?.ten ?? nguoi,
    maNhanVien: input.ten.get(nguoi)?.maNhanVien ?? null,
    soTienKyNay: input.tongThang.get(nguoi) ?? 0,
    amKetChuyenTruoc: Math.min(0, input.amKetChuyen.get(nguoi) ?? 0),
    soTienChi,
    amKetChuyenSau: kc.amMoi.get(nguoi) ?? 0,
  }));
  return { dong, tong: dong.reduce((s, d) => s + d.soTienChi, 0) };
}

export type DongChiTietXuat = { ky: string; coSo: string; nguoi: string; vai: string; loai: string; khoan: string | null; soTien: number; lyDo: string };

/** Dựng xlsx (2 sheet: bảng chi theo người · chi tiết dòng sổ). */
export async function taoXlsxBangChi(input: { thang: string; kind: "PAYROLL" | "EXTERNAL_SETTLEMENT"; bangChi: DongBangChi[]; chiTiet: DongChiTietXuat[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet(input.kind === "PAYROLL" ? `Bảng lương ${input.thang}` : `Quyết toán ${input.thang}`);
  s1.columns = [
    { header: "Người nhận", key: "ten", width: 32 },
    { header: "Mã nhân viên", key: "ma", width: 16 },
    { header: "Hoa hồng kỳ này", key: "ky", width: 18 },
    { header: "Âm kết chuyển trước", key: "truoc", width: 20 },
    { header: "Số chi", key: "chi", width: 16 },
    { header: "Âm kết chuyển sau", key: "sau", width: 20 },
  ];
  for (const d of input.bangChi) {
    s1.addRow({ ten: d.tenNguoi, ma: d.maNhanVien ?? "", ky: d.soTienKyNay, truoc: d.amKetChuyenTruoc, chi: d.soTienChi, sau: d.amKetChuyenSau });
  }
  s1.addRow({ ten: "TỔNG", ky: input.bangChi.reduce((s, d) => s + d.soTienKyNay, 0), chi: input.bangChi.reduce((s, d) => s + d.soTienChi, 0) });
  s1.getRow(1).font = { bold: true };

  const s2 = wb.addWorksheet("Chi tiết dòng sổ");
  s2.columns = [
    { header: "Kỳ", key: "ky", width: 10 },
    { header: "Cơ sở", key: "co", width: 14 },
    { header: "Người nhận", key: "nguoi", width: 32 },
    { header: "Vai", key: "vai", width: 18 },
    { header: "Loại dòng", key: "loai", width: 18 },
    { header: "Khoản thu", key: "khoan", width: 30 },
    { header: "Số tiền", key: "tien", width: 14 },
    { header: "Lý do", key: "ly", width: 70 },
  ];
  for (const c of input.chiTiet) s2.addRow({ ky: c.ky, co: c.coSo, nguoi: c.nguoi, vai: c.vai, loai: c.loai, khoan: c.khoan ?? "", tien: c.soTien, ly: c.lyDo });
  s2.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ── Xuất & đánh dấu đã chi ────────────────────────────────────────────────────────────────────

export type KetQuaXuat = {
  batchId: string;
  kind: "PAYROLL" | "EXTERNAL_SETTLEMENT";
  soDong: number;
  tongChi: number;
  soKyDaKhoa: number;
  /** Số kỳ của tháng CHƯA khoá nên không vào lô — cảnh báo "còn cơ sở chưa khoá". */
  soKyChuaKhoa: number;
  /** Số kỳ của tháng thuộc cơ sở NGOÀI phạm vi người xuất — không vào lô, không hiển thị gì thêm. */
  soKyNgoaiPhamVi: number;
  amKetChuyen: { nguoi: string; so: number }[];
  xlsx: Buffer;
};

/**
 * XUẤT bảng chi tháng `thang` cho MỘT loại lô. Gom MỌI kỳ LOCKED của tháng ở mọi cơ sở, dòng USER có `employeeId` (PAYROLL) hoặc còn lại
 * (EXTERNAL_SETTLEMENT). Mọi kỳ đã vào lô chuyển LOCKED → EXPORTED; dòng sổ → `EXPORTED` + `payoutBatchId` (trigger: chỉ tiến, ghi một lần).
 *
 * Trong cùng transaction: khoá kỳ → nạp lại dòng → tính kết chuyển → tạo lô → gắn dòng → đổi kỳ → hàng chờ NEGATIVE_BALANCE → audit.
 */
export async function xuatBangChi(
  client: PrismaClient,
  input: { thang: string; kind: "PAYROLL" | "EXTERNAL_SETTLEMENT"; actor: NguoiThaoTacKy; now: Date; lyDo: string },
): Promise<KetQuaXuat> {
  const lyDo = batLyDoToiThieu(input.lyDo, "Xuất bảng chi");
  const kyThangTatCa = await client.commissionPeriod.findMany({ where: { period: input.thang }, select: { id: true, status: true, period: true, centerId: true } });
  // PHẠM VI GHI: chỉ kỳ của cơ sở mà người xuất được phép (HO ⇒ mọi cơ sở). Kỳ ngoài phạm vi KHÔNG bị gom vào lô của họ — xuất nhầm kỳ cơ sở khác
  // là phát bảng chi cho người họ không quản lý. Không có kỳ nào trong phạm vi mà vẫn có kỳ ở cơ sở khác ⇒ NGOAI_PHAM_VI (không giả vờ "chưa khoá").
  const kyThang = kyThangTatCa.filter((k) => {
    try {
      batPhamViKy(k, input.actor);
      return true;
    } catch {
      return false;
    }
  });
  if (kyThang.length === 0 && kyThangTatCa.length > 0) throw new HoaHongError("NGOAI_PHAM_VI", `Các kỳ tháng ${input.thang} thuộc cơ sở ngoài phạm vi của bạn.`);
  // LOCKED (lô đầu tiên) hoặc EXPORTED (lô còn lại của tháng — nội bộ và quyết toán ngoài xuất RIÊNG, cùng một kỳ).
  const khoa = kyThang.filter((k) => k.status === "LOCKED" || k.status === "EXPORTED");
  if (khoa.length === 0) throw new HoaHongError("CHUA_CO_KY_KHOA", `Tháng ${input.thang} chưa có kỳ nào đã khoá — xuất chi chỉ sau LOCKED.`);

  return client.$transaction(
    async (tx) => {
      const trangThai = await khoaKy(tx, khoa.map((k) => k.id));
      const kyDung = khoa.filter((k) => ["LOCKED", "EXPORTED"].includes(trangThai.get(k.id)?.status ?? ""));
      if (kyDung.length !== khoa.length) throw new HoaHongError("TRANG_THAI_DA_DOI", "Có kỳ vừa đổi trạng thái trong lúc xuất — thử lại.");
      // Cổng (trước phép ghi đầu tiên): kỳ còn LOCKED phải đi được sang EXPORTED theo bảng chuyển trạng thái.
      for (const k of kyDung) {
        if (trangThai.get(k.id)!.status !== "LOCKED") continue;
        const loi = kiemChuyenTrangThaiKy({ tu: "LOCKED", den: "EXPORTED", soHangChoChan: 0, lastCalculatedAt: null, dauVaoMoiNhat: null });
        if (loi) throw new HoaHongError("KY_CHUYEN_KHONG_HOP_LE", loi);
      }
      const ids = kyDung.map((k) => k.id);

      const dong = await tx.commissionTransaction.findMany({
        where: { periodId: { in: ids }, payoutBatchId: null, payoutStatus: "APPROVED" },
        include: { period: { select: { period: true, center: { select: { name: true } } } }, beneficiaryUser: { select: { name: true, employee: { select: { employeeCode: true, status: true } } } }, beneficiaryAffiliate: { select: { name: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const noiBo = (d: (typeof dong)[number]) => d.beneficiaryKind === "USER" && d.beneficiaryEmployeeId !== null;
      const cua = dong.filter((d) => (input.kind === "PAYROLL" ? noiBo(d) : !noiBo(d)));
      // Cổng (trước phép ghi đầu tiên): lô RỖNG chỉ có nghĩa khi nó còn kỳ LOCKED để chuyển sang EXPORTED. Bấm "Xuất" lần hai (hoặc double-click) trên tháng đã xuất hết
      // không được đẻ thêm một lô 0 dòng + một audit EXPORT: lô rác làm danh sách lô khó đọc và audit nói dối rằng có một lần xuất mới.
      if (cua.length === 0 && !kyDung.some((k) => trangThai.get(k.id)!.status === "LOCKED")) {
        throw new HoaHongError("KHONG_CO_DONG_DE_XUAT", `Tháng ${input.thang} không còn dòng nào chưa vào lô ${input.kind === "PAYROLL" ? "bảng lương" : "quyết toán"}.`);
      }

      const khoaNguoi = (d: (typeof dong)[number]) => (d.beneficiaryKind === "USER" ? `U:${d.beneficiaryUserId}` : `A:${d.beneficiaryAffiliateId}`);
      const tongThang = new Map<string, number>();
      for (const d of cua) tongThang.set(khoaNguoi(d), (tongThang.get(khoaNguoi(d)) ?? 0) + d.amount);

      // Âm kết chuyển từ các tháng trước (hàng chờ NEGATIVE_BALANCE đang mở của đúng loại lô) — CHỈ của người CÓ DÒNG trong lô này.
      // Hàng chờ không mang cơ sở, nên nạp toàn cục là cuốn nợ của người cơ sở KHÁC vào lô của QLCS này (lộ trong xlsx, bị đóng "đã tiêu thụ" ở lô không phải của họ).
      // Người có nợ mà chưa có dòng nào trong lô thì nợ GIỮ NGUYÊN (hàng chờ cũ còn mở) cho tới lô có dòng của họ.
      const nguoiTrongLo = new Set(cua.map(khoaNguoi));
      const holdCu = (await tx.commissionHold.findMany({ where: { code: "NEGATIVE_BALANCE", status: "OPEN" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).filter((h) => {
        const dt = h.detail as { nguoi?: string; kind?: string };
        return dt.kind === input.kind && !!dt.nguoi && nguoiTrongLo.has(dt.nguoi);
      });
      const amKetChuyen = new Map<string, number>();
      for (const h of holdCu) {
        const dt = h.detail as { nguoi: string; so?: number };
        amKetChuyen.set(dt.nguoi, (amKetChuyen.get(dt.nguoi) ?? 0) + Math.min(0, dt.so ?? 0)); // CỘNG: nhiều hàng chờ mở của cùng người đều là nợ
      }

      const ten = new Map<string, { ten: string; maNhanVien: string | null }>();
      for (const d of cua) {
        ten.set(khoaNguoi(d), { ten: d.beneficiaryUser?.name ?? d.beneficiaryAffiliate?.name ?? d.beneficiaryName, maNhanVien: d.beneficiaryUser?.employee?.employeeCode ?? null });
      }
      const bang = dungBangChi({ tongThang, amKetChuyen, ten });
      const amMoi = bang.dong.filter((d) => d.amKetChuyenSau < 0).map((d) => ({ nguoi: d.nguoi, so: d.amKetChuyenSau }));

      const lo = await tx.commissionPayoutBatch.create({
        data: { kind: input.kind, month: input.thang, status: "EXPORTED", lineCount: cua.length, totalAmount: bang.tong, createdById: input.actor.userId ?? "he-thong", note: lyDo },
        select: { id: true },
      });
      if (cua.length > 0) {
        await tx.commissionTransaction.updateMany({ where: { id: { in: cua.map((d) => d.id) }, payoutBatchId: null }, data: { payoutBatchId: lo.id, payoutStatus: "EXPORTED", payoutStatusAt: input.now } });
      }

      // Hàng chờ kết chuyển: đóng cái cũ đã được tiêu thụ, mở cái mới cho phần âm còn lại. Mềm, KHÔNG chặn khoá kỳ.
      for (const h of holdCu) {
        await tx.commissionHold.update({ where: { id: h.id }, data: { status: "RESOLVED", resolvedAt: input.now, resolutionNote: `Đã tiêu thụ ở lô ${lo.id} (tháng ${input.thang}).` } });
      }
      // 04 §13 / Q19: người đã nghỉ (không còn lương để trừ) hoặc người ngoài (lô quyết toán) mang âm ⇒ cùng hàng chờ, ĐÁNH DẤU `canXemTay` (kiểu MANUAL_REVIEW_REQUIRED): thu hồi ngoài
      // hệ thống hay xoá nợ là quyết định của HR/BLĐ, hệ thống chỉ giữ số. Hàng chờ vẫn MỀM — không chặn khoá kỳ nào.
      const xemTay = (nguoi: string): { canXemTay: true; lyDoXemTay: "NGUOI_NGOAI" | "NGUOI_DA_NGHI" } | { canXemTay: false } => {
        if (input.kind === "EXTERNAL_SETTLEMENT") return { canXemTay: true, lyDoXemTay: "NGUOI_NGOAI" };
        const tt = cua.find((d) => khoaNguoi(d) === nguoi)?.beneficiaryUser?.employee?.status;
        return tt === "RESIGNED" || tt === "TERMINATED" ? { canXemTay: true, lyDoXemTay: "NGUOI_DA_NGHI" } : { canXemTay: false };
      };
      for (const a of amMoi) {
        await tx.commissionHold.create({
          data: {
            // Có LÔ trong khoá: cùng người xuất nhiều lô trong một tháng (nhiều cơ sở) vẫn còn âm thì mỗi lô một hàng chờ — hàng chờ cũ đã RESOLVED vẫn nằm trong bảng, khoá cũ sẽ đụng UNIQUE.
            holdKey: `NEGATIVE_BALANCE:${input.kind}:${input.thang}:${lo.id}:${a.nguoi}`,
            code: "NEGATIVE_BALANCE",
            severity: "SOFT",
            status: "OPEN",
            detail: { lyDo: "Sổ âm ròng theo người × tháng: xuất 0 và kết chuyển sang tháng kế (PENDING_REGULATION, 04 §13).", nguoi: a.nguoi, so: a.so, kind: input.kind, thang: input.thang, loLenh: lo.id, ...xemTay(a.nguoi) } as Prisma.InputJsonValue,
          },
        });
      }

      // Kỳ vào lô → EXPORTED (chỉ khi có dòng thuộc kỳ trong lô này; lô nội bộ & lô ngoài cùng đánh dấu — kỳ EXPORTED khi lô ĐẦU TIÊN xuất).
      await tx.commissionPeriod.updateMany({
        where: { id: { in: ids }, status: "LOCKED" },
        data: { status: "EXPORTED", exportedAt: input.now, exportedById: input.actor.userId },
      });
      for (const k of kyDung) {
        await writeAudit({
          actor: actorAudit(input.actor),
          module: MODULE_AUDIT,
          entityType: "CommissionPeriod",
          entityId: k.id,
          action: "EXPORT",
          newValues: { status: "EXPORTED", lo: lo.id, kind: input.kind },
          reason: lyDo,
          tx,
        });
      }

      const chiTiet: DongChiTietXuat[] = cua.map((d) => ({
        ky: d.period.period,
        coSo: d.period.center.name,
        nguoi: d.beneficiaryUser?.name ?? d.beneficiaryAffiliate?.name ?? d.beneficiaryName,
        vai: d.roleCode,
        loai: d.entryKind,
        khoan: d.paymentId,
        soTien: d.amount,
        lyDo: d.reason,
      }));
      const xlsx = await taoXlsxBangChi({ thang: input.thang, kind: input.kind, bangChi: bang.dong, chiTiet });
      return {
        batchId: lo.id,
        kind: input.kind,
        soDong: cua.length,
        tongChi: bang.tong,
        soKyDaKhoa: kyDung.length,
        soKyChuaKhoa: kyThang.length - kyDung.length,
        soKyNgoaiPhamVi: kyThangTatCa.length - kyThang.length,
        amKetChuyen: amMoi,
        xlsx,
      };
    },
    { maxWait: 20_000, timeout: 120_000 },
  );
}

/** ĐÁNH DẤU ĐÃ CHI: lô EXPORTED → PAID, dòng → PAID, kỳ EXPORTED → PAID khi MỌI dòng của kỳ đã PAID. Xác nhận nguy hiểm ⇒ lý do bắt buộc. */
export async function danhDauDaChi(
  client: PrismaClient,
  input: { batchId: string; actor: NguoiThaoTacKy; now: Date; lyDo: string },
): Promise<{ soDong: number; soKyPaid: number }> {
  const lyDo = batLyDoToiThieu(input.lyDo, "Đánh dấu đã chi");
  return client.$transaction(async (tx) => {
    const lo = await tx.commissionPayoutBatch.findUnique({ where: { id: input.batchId } });
    if (!lo) throw new HoaHongError("LO_KHONG_TON_TAI", `Lô ${input.batchId} không tồn tại.`);
    if (lo.status !== "EXPORTED") throw new HoaHongError("LO_DA_CHI", `Lô ${input.batchId} đang ${lo.status} — chỉ lô EXPORTED mới đánh dấu đã chi.`);
    const dong = await tx.commissionTransaction.findMany({ where: { payoutBatchId: lo.id }, select: { id: true, periodId: true } });
    const kyIds = [...new Set(dong.map((d) => d.periodId))];
    // Cổng phạm vi (trước phép ghi đầu tiên): MỌI kỳ của lô phải nằm trong phạm vi người đánh dấu.
    for (const k of await tx.commissionPeriod.findMany({ where: { id: { in: kyIds } }, select: { period: true, centerId: true } })) batPhamViKy(k, input.actor);
    const trangThai = await khoaKy(tx, kyIds);
    for (const id of kyIds) {
      const loi = kiemChuyenTrangThaiKy({ tu: trangThai.get(id)?.status ?? "OPEN", den: "PAID", soHangChoChan: 0, lastCalculatedAt: null, dauVaoMoiNhat: null });
      if (loi) throw new HoaHongError("KY_CHUYEN_KHONG_HOP_LE", loi);
    }
    await tx.commissionTransaction.updateMany({ where: { payoutBatchId: lo.id, payoutStatus: "EXPORTED" }, data: { payoutStatus: "PAID", payoutStatusAt: input.now } });
    await tx.commissionPayoutBatch.update({ where: { id: lo.id }, data: { status: "PAID", paidAt: input.now, paidById: input.actor.userId } });

    // Kỳ sang PAID khi KHÔNG còn dòng nào của kỳ chưa PAID (lô nội bộ và lô ngoài có thể cùng một kỳ).
    let soKyPaid = 0;
    for (const id of kyIds) {
      const con = await tx.commissionTransaction.count({ where: { periodId: id, payoutStatus: { not: "PAID" } } });
      if (con === 0) {
        await tx.commissionPeriod.update({ where: { id }, data: { status: "PAID", paidAt: input.now, paidById: input.actor.userId } });
        soKyPaid += 1;
      }
    }
    await writeAudit({
      actor: actorAudit(input.actor),
      module: MODULE_AUDIT,
      entityType: "CommissionPayoutBatch",
      entityId: lo.id,
      action: "MARK_PAID",
      newValues: { status: "PAID", soDong: dong.length, soKyPaid },
      reason: lyDo,
      tx,
    });
    return { soDong: dong.length, soKyPaid };
  });
}
