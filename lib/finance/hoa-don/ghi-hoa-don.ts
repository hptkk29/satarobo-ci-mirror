import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { nguoiMuaChoDon } from "./nguoi-mua";
import { bamNguoiMua } from "./bam-nguoi-mua";
import type { PhapNhan } from "./phap-nhan";
import type { OSoHoaDon } from "./o-so-hoa-don";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { chonHoaDonDuocThay } from "./thay-the";
import { TOI_THIEU_LY_DO_HOA_DON } from "./trang-thai-hoa-don";
import type { TepDangGiu } from "./trung-tep";

// lib/finance/hoa-don/ghi-hoa-don.ts — phép GHI trên BẢNG HOÁ ĐƠN (docs/ke-toan-hoa-don/PLAN.md §4).
//
// Bốn việc, KHÔNG việc nào chạm sổ tiền (Payment · PaymentRequest · Receipt): tạo hoá đơn NHÁP khi kế
// toán tải tệp lên (④) · đánh dấu KHÔNG XUẤT · gỡ bản nháp / gỡ "không xuất" · HUỶ bản đã xác nhận
// (GĐ 8). Xác nhận (⑤ — cấp RCP, xác nhận khoản) là việc của GĐ 5 và đi qua lõi riêng trong
// `lib/finance/payment.ts`.
//
// Người gọi (action) đã: kiểm quyền kế toán ĐÚNG cơ sở · dựng lại lần thu bằng loader của màn (tập
// khoản + số ròng không đến từ client) · xác minh byte tệp trong kho. Ở đây chỉ còn phần phải
// NGUYÊN TỬ.
//
// ⚠️ Hai kế toán cùng bấm trên MỘT lần thu: không kiểm-rồi-ghi ở tầng ứng dụng. Khoá thật là hai
// chỉ mục từng phần ở DB (`HoaDonKhoan_paymentId_hieuLuc_key`, `HoaDonDienTu_soHoaDon_conSong_key`);
// P2002 được dịch thành câu người đọc được.
// ⚠️ Từ chối trong transaction = `throw` (luật rollback — `return` không rollback).

export type MaLoiGhiHoaDon = "DA_CO_NGUOI_XU_LY" | "TRUNG_SO" | "DA_DOI" | "THIEU_LY_DO" | "TEP_TRUNG";

const THONG_DIEP: Record<MaLoiGhiHoaDon, string> = {
  DA_CO_NGUOI_XU_LY: "Lần thu này vừa được người khác tải hoá đơn hoặc đánh dấu — tải lại màn",
  TRUNG_SO: "Số hoá đơn này (cùng ký hiệu, cùng pháp nhân) đã gắn cho một lần thu khác",
  DA_DOI: "Hoá đơn vừa bị người khác sửa hoặc gỡ — tải lại màn",
  THIEU_LY_DO: `Ghi rõ lý do huỷ hoá đơn (ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự)`,
  // Câu chung — action có phạm vi người xem thì dựng câu cụ thể bằng `thongDiepTepTrung` (trung-tep.ts).
  TEP_TRUNG: "Tệp PDF này đã gắn cho một hoá đơn khác còn hiệu lực — kiểm lại tệp",
};

export class LoiGhiHoaDon extends Error {
  constructor(
    readonly ma: MaLoiGhiHoaDon,
    /** `TEP_TRUNG` — hoá đơn đang giữ tệp (để action dựng câu theo phạm vi người xem). */
    readonly chiTiet: TepDangGiu | null = null,
  ) {
    super(THONG_DIEP[ma]);
    this.name = "LoiGhiHoaDon";
  }
}

type DbHoacTx = Prisma.TransactionClient | typeof db;

/**
 * GĐ 8 bước 13 — xếp hàng hai lượt lưu CÙNG một tệp PDF (cùng SHA-256), kể cả trên hai đơn khác nhau:
 * không có khoá này thì hai lượt cùng "kiểm thấy trống" rồi cùng ghi. CHỖ DUY NHẤT viết khoá này.
 */
async function khoaVanTayPdfTrongTx(tx: Prisma.TransactionClient, sha256: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hoa-don-pdf:${sha256}`})::bigint)`;
}

/**
 * Hoá đơn CÒN SỐNG (NHÁP / ĐÃ XÁC NHẬN) đang giữ tệp PDF có SHA-256 này, trừ `truHoaDonId` (chính bản
 * nháp đang sửa). KHÔNG SCOPE — cổng chặn tra qua `scopedDb` thì tờ đang nằm ở cơ sở khác bị lọc mất và
 * cổng mở toang đúng ca cần chặn (cùng bài học `lib/payments/method-lookup.ts`). Bản ĐÃ HUỶ (THAY_THE)
 * cố ý KHÔNG tính: huỷ xong tải lại đúng tờ ấy cho lần thu đúng là đường thường. KHONG_XUAT không có tệp.
 * `truHoaDonId` BẮT BUỘC khai (luật 7): sửa nháp mà quên truyền là tự chặn chính mình.
 */
export async function hoaDonDangGiuTepPdf(
  client: DbHoacTx,
  sha256: string,
  truHoaDonId: string | null,
): Promise<TepDangGiu | null> {
  const h = await client.hoaDonDienTu.findFirst({
    where: {
      tepPdfSha256: sha256,
      trangThai: { in: ["NHAP", "DA_XAC_NHAN"] },
      ...(truHoaDonId ? { id: { not: truHoaDonId } } : {}),
    },
    select: {
      id: true,
      orderId: true,
      centerId: true,
      kyHieu: true,
      soHoaDon: true,
      trangThai: true,
      order: { select: { code: true } },
    },
  });
  return h
    ? { id: h.id, orderId: h.orderId, centerId: h.centerId, kyHieu: h.kyHieu, soHoaDon: h.soHoaDon, trangThai: h.trangThai, maDon: h.order.code }
    : null;
}

/** Bản cho action kiểm SỚM ngay sau khi xác minh tệp (app/ không import `@/lib/db`). Chỉ báo sớm — cổng thật nằm trong transaction ghi. */
export function timHoaDonDangGiuTepPdf(sha256: string, truHoaDonId: string | null): Promise<TepDangGiu | null> {
  return hoaDonDangGiuTepPdf(db, sha256, truHoaDonId);
}

/** Câu cho người dùng nếu `e` là lỗi đã biết của tầng này; `null` ⇒ lỗi lạ, người gọi ném tiếp. */
export function thongDiepLoiGhiHoaDon(e: unknown): string | null {
  return e instanceof LoiGhiHoaDon ? e.message : null;
}

/** P2002 của một trong hai khoá từng phần ⇒ lỗi nghiệp vụ; lỗi khác ném nguyên. */
function dichTrung(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    // Chỉ mục viết tay nên `meta.target` có thể là TÊN chỉ mục hoặc danh sách cột — cả hai đều
    // mang chữ "soHoaDon" khi đụng khoá số.
    throw new LoiGhiHoaDon(JSON.stringify(e.meta?.target ?? "").includes("soHoaDon") ? "TRUNG_SO" : "DA_CO_NGUOI_XU_LY");
  }
  throw e;
}

export type TepMoi = { khoa: string; ten: string; co: number; sha256: string };
type NguoiGhi = { id: string; name: string };

export const COT_NGUOI_MUA = {
  customerName: true,
  customerPhone: true,
  customerEmail: true,
  customerAddress: true,
  customerWard: true,
  customerCity: true,
  customerCccd: true,
  invoiceBuyerName: true,
  invoiceCompanyName: true,
  invoiceTaxCode: true,
  invoiceEmail: true,
} satisfies Prisma.OrderSelect;

export async function taoHoaDonChoLanThu(input: {
  nguoiGhi: NguoiGhi;
  orderId: string;
  centerId: string;
  lanThuKey: string;
  khoan: readonly { id: string; soTien: number }[];
  loai:
    | {
        trangThai: "NHAP";
        phapNhan: PhapNhan;
        so: OSoHoaDon;
        guiEmailKhach: boolean;
        pdf: TepMoi;
        xml: TepMoi | null;
        /**
         * GĐ 8 (Q-mở 1) — lần thu THIẾU vẫn xuất "theo số đã thu" (phụ huynh không trả nốt). BẮT BUỘC
         * khai (kể cả `null`): action là chỗ DUY NHẤT biết lần thu đang thiếu — mặc định là quên nó.
         */
        theoSoDaThu: { lyDo: string; thieu: number; nhanDot: string | null } | null;
        /**
         * Q-mở 4 — phần dung sai làm tròn được THA của lần thu (`LanThu.tienTha`, dòng LOADER dựng lại).
         * Hoá đơn ghi số thu THẬT (`tongTien`), phần tha hiện RIÊNG ở cột này. BẮT BUỘC (luật 7): bỏ
         * trống là cột nằm 0 mãi mà không ai biết — đúng tình trạng trước bản vá.
         */
        tienTha: number;
      }
    | { trangThai: "KHONG_XUAT"; lyDo: string };
}): Promise<{ id: string }> {
  if (input.khoan.length === 0) throw new LoiGhiHoaDon("DA_DOI");
  const tongTien = input.khoan.reduce((s, k) => s + k.soTien, 0);
  try {
    return await db.$transaction(async (tx) => {
      const don = await tx.order.findUnique({ where: { id: input.orderId }, select: COT_NGUOI_MUA });
      if (!don) throw new LoiGhiHoaDon("DA_DOI");

      let rieng: Prisma.HoaDonDienTuUncheckedCreateInput | Record<string, never> = {};
      const l = input.loai;
      if (l.trangThai === "NHAP") {
        const nm = nguoiMuaChoDon(don);
        // Dấu người mua LÚC TẢI PHIẾU CHỜ (route phiếu chờ ghi vào audit) — đó là thông tin kế toán
        // đã mang sang MISA. Chưa tải phiếu chờ (hoá đơn làm từ trước khi có màn này) ⇒ dấu hiện tại.
        const lanIn = await tx.auditLog.findFirst({
          where: {
            entityType: "Order",
            entityId: input.orderId,
            action: "TAI_PHIEU_CHO",
            newValues: { path: ["lanThuKey"], equals: input.lanThuKey },
          },
          orderBy: { createdAt: "desc" },
          select: { newValues: true },
        });
        const dauLucIn = (lanIn?.newValues as { nguoiMuaHash?: unknown } | null)?.nguoiMuaHash;
        rieng = {
          kyHieu: l.so.kyHieu,
          soHoaDon: l.so.soHoaDon,
          ngayPhatHanh: l.so.ngayPhatHanh,
          phapNhanMa: l.phapNhan.ma,
          phapNhanTen: l.phapNhan.ten,
          phapNhanMst: l.phapNhan.maSoThue,
          nguoiMuaTen: nm.hoTen || null,
          nguoiMuaDonVi: nm.tenDonVi,
          nguoiMuaMst: nm.maSoThue,
          nguoiMuaDiaChi: nm.diaChi,
          emailNhan: nm.email,
          nguoiMuaHashLucIn: typeof dauLucIn === "string" ? dauLucIn : bamNguoiMua(nm),
          guiEmailKhach: l.guiEmailKhach,
          tepPdfKey: l.pdf.khoa,
          tepPdfTen: l.pdf.ten,
          tepPdfCo: l.pdf.co,
          tepPdfSha256: l.pdf.sha256,
          tepXmlKey: l.xml?.khoa ?? null,
          tepXmlTen: l.xml?.ten ?? null,
          tepXmlCo: l.xml?.co ?? null,
          xuatTheoSoDaThu: l.theoSoDaThu != null,
          xuatTheoSoDaThuLyDo: l.theoSoDaThu?.lyDo ?? null,
          tienThaLamTron: l.tienTha,
        } as Prisma.HoaDonDienTuUncheckedCreateInput;
      }

      // GĐ 8 (quyết định (1) 27/09): khoản từng nằm trong hoá đơn ĐÃ HUỶ ⇒ bản này thay cho bản đó.
      // Đọc TỪ DB trong chính transaction — không bao giờ nhận id từ client.
      const daHuy = await tx.hoaDonDienTu.findMany({
        where: {
          orderId: input.orderId,
          trangThai: "THAY_THE",
          khoan: { some: { paymentId: { in: input.khoan.map((k) => k.id) } } },
        },
        select: { id: true, huyLuc: true, khoan: { select: { paymentId: true } } },
      });
      const thayTheChoId = chonHoaDonDuocThay(
        daHuy.map((h) => ({ id: h.id, huyLuc: h.huyLuc, paymentIds: h.khoan.map((k) => k.paymentId) })),
        input.khoan.map((k) => k.id),
      );

      // GĐ 8 bước 13 — một tờ hoá đơn chỉ gắn cho MỘT hoá đơn còn sống. Khoá vân tay TRƯỚC khi kiểm, kiểm
      // TRƯỚC phép ghi đầu tiên; trùng ⇒ throw (rollback).
      if (l.trangThai === "NHAP") {
        await khoaVanTayPdfTrongTx(tx, l.pdf.sha256);
        const giu = await hoaDonDangGiuTepPdf(tx, l.pdf.sha256, null);
        if (giu) {
          // Hai kế toán cùng tải ĐÚNG tờ ấy cho CÙNG lần thu ⇒ đó là "người khác vừa xử lý", không phải
          // "tệp gắn cho lần thu khác" — câu sau sẽ nói sai sự thật với người thua.
          const cungLanThu = await tx.hoaDonKhoan.count({
            where: { hoaDonId: giu.id, hieuLuc: true, paymentId: { in: input.khoan.map((k) => k.id) } },
          });
          throw cungLanThu > 0 ? new LoiGhiHoaDon("DA_CO_NGUOI_XU_LY") : new LoiGhiHoaDon("TEP_TRUNG", giu);
        }
      }

      const hd = await tx.hoaDonDienTu.create({
        data: {
          ...rieng,
          orderId: input.orderId,
          centerId: input.centerId,
          trangThai: l.trangThai,
          tongTien,
          lyDo: l.trangThai === "KHONG_XUAT" ? l.lyDo : null,
          thayTheChoId,
          taoBoiId: input.nguoiGhi.id,
          khoan: { create: input.khoan.map((k) => ({ paymentId: k.id, soTien: k.soTien })) },
        },
        select: { id: true },
      });

      await writeAudit({
        tx,
        actor: input.nguoiGhi,
        module: "finance",
        entityType: "HoaDonDienTu",
        entityId: hd.id,
        action: l.trangThai === "NHAP" ? "TAO_HOA_DON_NHAP" : "DANH_DAU_KHONG_XUAT",
        newValues: {
          orderId: input.orderId,
          lanThuKey: input.lanThuKey,
          khoanIds: input.khoan.map((k) => k.id),
          tongTien,
          thayTheChoId,
          ...(l.trangThai === "NHAP"
            ? {
                kyHieu: l.so.kyHieu,
                soHoaDon: l.so.soHoaDon,
                tepPdfTen: l.pdf.ten,
                coXml: Boolean(l.xml),
                tienThaLamTron: l.tienTha,
                xuatTheoSoDaThu: l.theoSoDaThu != null,
                ...(l.theoSoDaThu ? { thieu: l.theoSoDaThu.thieu, nhanDot: l.theoSoDaThu.nhanDot } : {}),
              }
            : {}),
        },
        reason: l.trangThai === "KHONG_XUAT" ? l.lyDo : l.theoSoDaThu?.lyDo,
        orgUnitId: input.centerId,
      });
      return hd;
    });
  } catch (e) {
    if (e instanceof LoiGhiHoaDon) throw e;
    return dichTrung(e);
  }
}

export async function capNhatHoaDonNhap(input: {
  nguoiGhi: NguoiGhi;
  orderId: string;
  hoaDonId: string;
  so: OSoHoaDon;
  guiEmailKhach: boolean;
  /** `undefined` = giữ tệp cũ. */
  pdf?: TepMoi;
  /** `undefined` = giữ · `null` = gỡ XML. */
  xml?: TepMoi | null;
  /** GĐ 8 — BẮT BUỘC: sửa bản nháp là khai lại cả lựa chọn "xuất theo số đã thu" (`null` = không). */
  theoSoDaThu: { lyDo: string } | null;
  /** Q-mở 4 — tiền tha làm tròn của lần thu LÚC SỬA (dòng loader dựng lại). BẮT BUỘC (luật 7). */
  tienTha: number;
}): Promise<{ tepCanXoa: string[] }> {
  try {
    return await db.$transaction(async (tx) => {
      const cu = await tx.hoaDonDienTu.findFirst({
        where: { id: input.hoaDonId, orderId: input.orderId, trangThai: "NHAP" },
        select: {
          updatedAt: true,
          centerId: true,
          tepPdfKey: true,
          tepXmlKey: true,
          kyHieu: true,
          soHoaDon: true,
          xuatTheoSoDaThu: true,
          xuatTheoSoDaThuLyDo: true,
          tienThaLamTron: true,
        },
      });
      if (!cu) throw new LoiGhiHoaDon("DA_DOI");

      const data: Prisma.HoaDonDienTuUpdateManyMutationInput = {
        kyHieu: input.so.kyHieu,
        soHoaDon: input.so.soHoaDon,
        ngayPhatHanh: input.so.ngayPhatHanh,
        guiEmailKhach: input.guiEmailKhach,
        xuatTheoSoDaThu: input.theoSoDaThu != null,
        xuatTheoSoDaThuLyDo: input.theoSoDaThu?.lyDo ?? null,
        tienThaLamTron: input.tienTha,
      };
      const tepCanXoa: string[] = [];
      if (input.pdf) {
        Object.assign(data, { tepPdfKey: input.pdf.khoa, tepPdfTen: input.pdf.ten, tepPdfCo: input.pdf.co, tepPdfSha256: input.pdf.sha256 });
        if (cu.tepPdfKey && cu.tepPdfKey !== input.pdf.khoa) tepCanXoa.push(cu.tepPdfKey);
      }
      if (input.xml !== undefined) {
        Object.assign(data, { tepXmlKey: input.xml?.khoa ?? null, tepXmlTen: input.xml?.ten ?? null, tepXmlCo: input.xml?.co ?? null });
        if (cu.tepXmlKey && cu.tepXmlKey !== input.xml?.khoa) tepCanXoa.push(cu.tepXmlKey);
      }

      // GĐ 8 bước 13 — thay tệp PDF: cùng cổng "một tờ một hoá đơn", trừ CHÍNH bản nháp này.
      if (input.pdf) {
        await khoaVanTayPdfTrongTx(tx, input.pdf.sha256);
        const giu = await hoaDonDangGiuTepPdf(tx, input.pdf.sha256, input.hoaDonId);
        if (giu) throw new LoiGhiHoaDon("TEP_TRUNG", giu);
      }

      // Chống bấm đôi / sửa chồng: ghi có điều kiện theo `updatedAt` đã đọc (khuôn FIX-H9).
      const upd = await tx.hoaDonDienTu.updateMany({
        where: { id: input.hoaDonId, trangThai: "NHAP", updatedAt: cu.updatedAt },
        data,
      });
      if (upd.count !== 1) throw new LoiGhiHoaDon("DA_DOI");

      await writeAudit({
        tx,
        actor: input.nguoiGhi,
        module: "finance",
        entityType: "HoaDonDienTu",
        entityId: input.hoaDonId,
        action: "SUA_HOA_DON_NHAP",
        oldValues: {
          kyHieu: cu.kyHieu,
          soHoaDon: cu.soHoaDon,
          xuatTheoSoDaThu: cu.xuatTheoSoDaThu,
          xuatTheoSoDaThuLyDo: cu.xuatTheoSoDaThuLyDo,
          tienThaLamTron: cu.tienThaLamTron,
        },
        newValues: {
          kyHieu: input.so.kyHieu,
          soHoaDon: input.so.soHoaDon,
          doiPdf: Boolean(input.pdf),
          doiXml: input.xml !== undefined,
          xuatTheoSoDaThu: input.theoSoDaThu != null,
          xuatTheoSoDaThuLyDo: input.theoSoDaThu?.lyDo ?? null,
          tienThaLamTron: input.tienTha,
        },
        orgUnitId: cu.centerId,
      });
      return { tepCanXoa };
    });
  } catch (e) {
    if (e instanceof LoiGhiHoaDon) throw e;
    return dichTrung(e);
  }
}

/** Gỡ bản NHÁP (tải nhầm) hoặc gỡ dấu KHÔNG XUẤT — nhả khoản về hàng chờ. Bản đã xác nhận không gỡ được. */
export async function goHoaDonChuaChot(input: {
  nguoiGhi: NguoiGhi;
  orderId: string;
  hoaDonId: string;
}): Promise<{ tepCanXoa: string[] }> {
  return db.$transaction(async (tx) => {
    const cu = await tx.hoaDonDienTu.findFirst({
      where: { id: input.hoaDonId, orderId: input.orderId, trangThai: { in: ["NHAP", "KHONG_XUAT"] } },
      select: {
        trangThai: true,
        centerId: true,
        updatedAt: true,
        tepPdfKey: true,
        tepXmlKey: true,
        kyHieu: true,
        soHoaDon: true,
        lyDo: true,
        khoan: { select: { paymentId: true } },
      },
    });
    if (!cu) throw new LoiGhiHoaDon("DA_DOI");

    // Nhật ký trước: sau khi xoá, `writeAudit` không còn suy được đơn vị từ thực thể.
    await writeAudit({
      tx,
      actor: input.nguoiGhi,
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: input.hoaDonId,
      action: cu.trangThai === "NHAP" ? "GO_HOA_DON_NHAP" : "GO_KHONG_XUAT",
      oldValues: {
        orderId: input.orderId,
        trangThai: cu.trangThai,
        kyHieu: cu.kyHieu,
        soHoaDon: cu.soHoaDon,
        lyDo: cu.lyDo,
        khoanIds: cu.khoan.map((k) => k.paymentId),
      },
      orgUnitId: cu.centerId,
    });
    // `HoaDonKhoan` xoá theo (Cascade) ⇒ khoản về lại hàng chờ. Có điều kiện `updatedAt`: ai vừa
    // sửa / xác nhận giữa chừng thì 0 dòng ⇒ ném ⇒ rollback cả nhật ký.
    const del = await tx.hoaDonDienTu.deleteMany({
      where: { id: input.hoaDonId, trangThai: cu.trangThai, updatedAt: cu.updatedAt },
    });
    if (del.count !== 1) throw new LoiGhiHoaDon("DA_DOI");
    return { tepCanXoa: [cu.tepPdfKey, cu.tepXmlKey].filter((k): k is string => Boolean(k)) };
  });
}

/**
 * HUỶ hoá đơn ĐÃ XÁC NHẬN (quyết định (1) 27/09): bản cũ → THAY_THE kèm ai / lúc nào / vì sao, dòng nối
 * `hieuLuc = false` ⇒ khoản TRỞ LẠI hàng chờ để tải hoá đơn đúng theo luồng thường (bản kế tiếp tự nối
 * `thayTheChoId` về đây — `taoHoaDonChoLanThu`).
 *
 * KHÔNG chạm: Payment (vẫn CONFIRMED), Receipt (RCP giữ nguyên), PaymentRequest, HoaDonGuiEmail,
 * EmailQueue, tệp trong kho. Thư đang chờ gửi của bản này tự dừng: handler (`giuLuotGuiHoaDon`) và
 * worker (`chuanBiGuiHoaDon`) đều đọc LẠI trạng thái hoá đơn và chỉ gửi bản DA_XAC_NHAN.
 * ⚠️ KHÔNG đóng lượt gửi CHO/DANG_GUI ở đây: `ghiKetQuaGuiHoaDon` chỉ chuyển từ CHO/DANG_GUI — đóng
 * sớm thì một lượt đang bay mà gửi được sẽ không bao giờ được ghi là đã gửi.
 *
 * Mọi từ chối trong transaction là `throw` và đứng TRƯỚC phép ghi đầu tiên (luật rollback).
 */
export async function huyHoaDonDaXacNhan(input: {
  nguoiHuy: NguoiGhi;
  orderId: string;
  hoaDonId: string;
  lyDo: string;
  now: Date;
}): Promise<{ paymentIds: string[]; so: string }> {
  const lyDo = input.lyDo.trim();
  if (lyDo.length < TOI_THIEU_LY_DO_HOA_DON) throw new LoiGhiHoaDon("THIEU_LY_DO");

  return db.$transaction(async (tx) => {
    // Xếp hàng với chốt / gửi lại / ghi tiền trên CÙNG đơn — cùng khoá với `chotHoaDon`.
    await khoaDonTrongTx(tx, input.orderId);
    const cu = await tx.hoaDonDienTu.findFirst({
      where: { id: input.hoaDonId, orderId: input.orderId, trangThai: "DA_XAC_NHAN" },
      select: {
        centerId: true,
        kyHieu: true,
        soHoaDon: true,
        tongTien: true,
        xacNhanLuc: true,
        khoan: { where: { hieuLuc: true }, select: { paymentId: true } },
      },
    });
    if (!cu) throw new LoiGhiHoaDon("DA_DOI");
    const paymentIds = cu.khoan.map((k) => k.paymentId);
    const so = [cu.kyHieu, cu.soHoaDon].filter(Boolean).join("-");

    // Ghi #1 — có điều kiện trạng thái: hai người cùng huỷ ⇒ người sau đổi 0 dòng ⇒ ném ⇒ rollback.
    const upd = await tx.hoaDonDienTu.updateMany({
      where: { id: input.hoaDonId, trangThai: "DA_XAC_NHAN" },
      data: { trangThai: "THAY_THE", huyLyDo: lyDo, huyBoiId: input.nguoiHuy.id, huyLuc: input.now },
    });
    if (upd.count !== 1) throw new LoiGhiHoaDon("DA_DOI");
    await tx.hoaDonKhoan.updateMany({ where: { hoaDonId: input.hoaDonId, hieuLuc: true }, data: { hieuLuc: false } });

    await writeAudit({
      tx,
      actor: input.nguoiHuy,
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: input.hoaDonId,
      action: "HUY_HOA_DON",
      oldValues: {
        orderId: input.orderId,
        trangThai: "DA_XAC_NHAN",
        kyHieu: cu.kyHieu,
        soHoaDon: cu.soHoaDon,
        tongTien: cu.tongTien,
        xacNhanLuc: cu.xacNhanLuc?.toISOString() ?? null,
        khoanIds: paymentIds,
      },
      newValues: { trangThai: "THAY_THE", khoanTraVeHangCho: paymentIds },
      reason: lyDo,
      orgUnitId: cu.centerId,
    });
    return { paymentIds, so };
  });
}

/**
 * GĐ 8 (quyết định (2) 27/09) — kế toán đối chiếu và ghi "KHÔNG TRÙNG — vẫn xuất" lên bản NHÁP của
 * lần thu nghi trùng. Ghi CÓ ĐIỀU KIỆN theo phiên bản bản nháp người dùng đã thấy (`phienBan`) và chỉ
 * khi chưa ghi — bấm đôi hay sửa chồng ⇒ 0 dòng ⇒ ném. `nhatKy` do action lấy từ dòng LOADER dựng lại,
 * không từ client. Từ chối trong transaction = `throw`, đứng trước phép ghi.
 */
export async function ghiKhongTrung(input: {
  nguoiGhi: NguoiGhi;
  orderId: string;
  hoaDonId: string;
  phienBan: Date;
  lyDo: string;
  /** Từ dòng LOADER dựng lại: khoá lần thu, khoản, số tiền, và câu bằng chứng nghi trùng đã in cho kế toán. */
  nhatKy: { lanThuKey: string; khoanIds: readonly string[]; soTien: number; bangChung: string };
  now: Date;
}): Promise<void> {
  const lyDo = input.lyDo.trim();
  if (lyDo.length < TOI_THIEU_LY_DO_HOA_DON) throw new LoiGhiHoaDon("THIEU_LY_DO");
  await db.$transaction(async (tx) => {
    const cu = await tx.hoaDonDienTu.findFirst({
      where: { id: input.hoaDonId, orderId: input.orderId, trangThai: "NHAP" },
      select: { updatedAt: true, centerId: true, khongTrungLyDo: true },
    });
    if (!cu || cu.updatedAt.getTime() !== input.phienBan.getTime() || cu.khongTrungLyDo != null) {
      throw new LoiGhiHoaDon("DA_DOI");
    }
    const upd = await tx.hoaDonDienTu.updateMany({
      where: { id: input.hoaDonId, orderId: input.orderId, trangThai: "NHAP", updatedAt: input.phienBan, khongTrungLyDo: null },
      data: { khongTrungLyDo: lyDo, khongTrungBoiId: input.nguoiGhi.id, khongTrungLuc: input.now },
    });
    if (upd.count !== 1) throw new LoiGhiHoaDon("DA_DOI");
    await writeAudit({
      tx,
      actor: input.nguoiGhi,
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: input.hoaDonId,
      action: "XAC_NHAN_KHONG_TRUNG",
      newValues: {
        orderId: input.orderId,
        lanThuKey: input.nhatKy.lanThuKey,
        khoanIds: [...input.nhatKy.khoanIds],
        soTien: input.nhatKy.soTien,
        bangChung: input.nhatKy.bangChung,
      },
      reason: lyDo,
      orgUnitId: cu.centerId,
    });
  });
}
