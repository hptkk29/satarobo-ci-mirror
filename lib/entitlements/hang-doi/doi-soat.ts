import "server-only";
// lib/entitlements/hang-doi/doi-soat.ts — CRON ĐỐI SOÁT QUYỀN HỌC (`quyen-hoc-doi-soat`). DB.
//
// 🔴 CRON NÀY KHÔNG BAO GIỜ CẤP / SỬA / THU HỒI QUYỀN HỌC. Nó chỉ TẠO hoặc CẬP NHẬT dòng hàng đợi (`StudyEntitlementXuLy`) và ĐẾM.
//
// Cấu trúc (xem docs/thu-hoc-phi-pham-vi/HANG-DOI-VAN-HANH.md):
//   1. Theo CƠ SỞ: cờ phạm vi (theo cơ sở) TẮT (hoặc chưa ánh xạ OrgUnit) ⇒ BỎ QUA, không đọc đơn nào, không ghi gì — chỉ ghi vào báo cáo.
//   2. Theo ĐƠN có dấu SCOPE (trần `gioiHanDonMoiCoSo` mỗi cơ sở/lượt): chạy hàm xét cấp quyền (`xetCapQuyenHocChoDon`) ở chế độ "CHI_GHI_NHAN" — CÙNG hàm, cùng định nghĩa "đủ tiền",
//      cùng khoá, cùng vòng đời dòng xử lý với đường tiền hích; khác duy nhất ở chỗ gọi `capQuyenHocTrongTx` thì ghi THIEU_QUYEN_HOC rồi đi tiếp. Từ đó ra:
//        #1 tiền đủ mà không có quyền lẫn dòng chờ        → THIEU_QUYEN_HOC (đã biết học viên) / CHO_CHUYEN_DOI (chưa biết)
//        #3 quyền còn sống mà tiền đảo / huỷ / hoàn       → CAN_THU_HOI (chưa tiêu thụ) / TREO_DUYET_TAY (đã tiêu thụ)
//   3. Cùng đơn đó: `doiSoatLechMotDon` — phát hiện lệch QUAN HỆ giữa dòng đơn ↔ quyền học ↔ ghi danh ↔ học viên (#4 #6 và tiền không gắn được dòng) → LECH_DU_LIEU.
//   4. Chỉ ĐẾM, không ghi: #2 dòng đang mở quá hạn (NGUONG_QUA_HAN_MS) và #5 quyền học đã đóng / hết hạn mà ghi danh còn học (nghĩa vận hành chưa chốt).
//
// IDEMPOTENT: khoá dòng là (orderItemId, loai) — chạy lại không tạo dòng thứ hai; điều kiện không đổi ⇒ không ghi gì (`updatedAt` đứng yên). Dòng người đã quyết
// (da-quyet.ts) không bị mở lại khi điều kiện y nguyên. Dòng đã đóng bởi máy mà điều kiện quay lại ⇒ MỞ LẠI chính dòng đó (khoá duy nhất là chỉ mục đầy đủ).
// `now` BẮT BUỘC (luật 19). Trần đơn BẮT BUỘC (luật 7).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { docConLeadTuMetadata } from "@/lib/orders/hoc-vien-dong-don";
import { docPhamViDong, tienThucDongPhamVi } from "@/lib/orders/pham-vi/doc-dong";
import { docDauVanDaQuyet } from "../da-quyet";
import { laThuHocPhiTheoPhamViBat } from "../feature";
import { xetCapQuyenHocCoKetQua } from "../hich";
import {
  keHoachLechMotDong,
  phatHienLech,
  quyenDongConGhiDanhMo,
  type DongLechVao,
  type GhiDanhLech,
  type PhatHienLech,
} from "./doi-soat-lech";
import { thiHanhHanhDongCho } from "./ghi-dong";
import { LOAI_HANG_DOI, NGUONG_QUA_HAN_MS, type LoaiHangDoi } from "./loai";

type Client = Prisma.TransactionClient | typeof db;

const DON_DA_HUY = ["CANCELLED", "REFUNDED"] as const;
const LOAI_GIAI_THICH = ["CHO_CHUYEN_DOI", "CHO_XEP_LOP", "THIEU_QUYEN_HOC"] as const;

// ═══ ĐỌC DỮ LIỆU LỆCH CỦA MỘT ĐƠN (nhận `db` hoặc `tx`) ═════════════════════════════════════════════════════════════════════════════════════════════════

interface DongMat {
  readonly vao: DongLechVao;
  readonly hienCo: { readonly id: string; readonly trangThai: "OPEN" | "DA_XU_LY" | "HUY"; readonly lyDo: string; readonly payload: unknown } | null;
  readonly nc: { readonly courseId: string | null; readonly leadChildId: string | null; readonly studentId: string | null; readonly entitlementId: string | null };
}
interface DonMat {
  readonly orderId: string;
  readonly centerId: string;
  readonly dong: readonly DongMat[];
}

const laGhiDanh = (g: { id: string; studentId: string; courseId: string; status: string; deletedAt: Date | null } | null | undefined): GhiDanhLech | null =>
  g ? { id: g.id, studentId: g.studentId, courseId: g.courseId, status: g.status, deletedAt: g.deletedAt } : null;

export async function docMatLech(client: Client, orderId: string, tienMoHo: ReadonlySet<string>): Promise<DonMat | null> {
  const don = await client.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      centerId: true,
      items: {
        select: {
          id: true,
          type: true,
          status: true,
          // Tiền THẬT của dòng [20/10/2026]: dòng SCOPE nay có thể mang khoản giảm Sale thêm, nên "thành tiền" đem so với quyền học phải là
          // giá chính sách − khoản thêm (`tienThucDongPhamVi`). Thiếu các cột này thì phép so rơi về giá chính sách và báo QUYEN_LECH_SO_TIEN OAN.
          unitPrice: true,
          quantity: true,
          totalPrice: true,
          discountAmount: true,
          metadata: true,
          studentId: true,
          enrollmentId: true,
          enrollment: { select: { id: true, studentId: true, courseId: true, status: true, deletedAt: true } },
        },
      },
    },
  });
  if (!don || !don.centerId) return null;
  const scope = don.items.filter((d) => d.type === "COURSE_ENROLLMENT" && docPhamViDong(d.metadata) !== null);
  if (scope.length === 0) return null;
  const ids = scope.map((d) => d.id);

  const [quyenTho, xuLyTho] = await Promise.all([
    client.studyEntitlement.findMany({
      where: { orderItemId: { in: ids } },
      select: {
        id: true,
        orderItemId: true,
        status: true,
        studentId: true,
        courseId: true,
        orderId: true,
        centerId: true,
        enrollmentId: true,
        netAmount: true,
        purchaseSessions: true,
        graceSessionsGranted: true,
        graceSessionsUsed: true,
      },
    }),
    client.studyEntitlementXuLy.findMany({
      where: { orderItemId: { in: ids } },
      select: { id: true, orderItemId: true, loai: true, trangThai: true, lyDo: true, payload: true },
    }),
  ]);
  const song = quyenTho.filter((q) => q.status !== "VOIDED");
  const hvIds = [...new Set(song.map((q) => q.studentId))];
  const gdIds = [...new Set(song.map((q) => q.enrollmentId).filter((x): x is string => Boolean(x)))];
  const [hocVien, ghiDanhQ] = await Promise.all([
    hvIds.length === 0 ? Promise.resolve([]) : client.student.findMany({ where: { id: { in: hvIds } }, select: { id: true, leadChildId: true } }),
    gdIds.length === 0
      ? Promise.resolve([])
      : client.enrollment.findMany({ where: { id: { in: gdIds } }, select: { id: true, studentId: true, courseId: true, status: true, deletedAt: true } }),
  ]);

  const donConHieuLuc = !(DON_DA_HUY as readonly string[]).includes(don.status);
  const dong: DongMat[] = scope.map((d) => {
    const pv = docPhamViDong(d.metadata)!;
    const hinhThuc = docHinhThucLop(d.metadata);
    const cuaDong = quyenTho.filter((q) => q.orderItemId === d.id);
    const q = cuaDong.find((x) => x.status !== "VOIDED") ?? null;
    const xuLyCuaDong = xuLyTho.filter((x) => x.orderItemId === d.id);
    const lech = xuLyCuaDong.find((x) => x.loai === "LECH_DU_LIEU") ?? null;
    const giaiThich = xuLyCuaDong.some(
      (x) => (LOAI_GIAI_THICH as readonly string[]).includes(x.loai) && (x.trangThai === "OPEN" || docDauVanDaQuyet(x.payload) !== null),
    );
    const leadChildId = docConLeadTuMetadata(d.metadata);
    const hv = q ? hocVien.find((h) => h.id === q.studentId) : undefined;
    const vao: DongLechVao = {
      orderItemId: d.id,
      orderId: don.id,
      donCenterId: don.centerId,
      courseIdDong: hinhThuc.courseId,
      leadChildIdDong: leadChildId,
      dongStudentId: d.studentId,
      dongEnrollmentId: d.enrollmentId,
      ghiDanhCuaDong: laGhiDanh(d.enrollment),
      thanhTien: tienThucDongPhamVi(pv, d)?.thanhTienThuc ?? pv.thanhTien,
      soBuoiMua: pv.soBuoiMua,
      quyen: q
        ? {
            id: q.id,
            status: q.status,
            studentId: q.studentId,
            courseId: q.courseId,
            orderId: q.orderId,
            centerId: q.centerId,
            enrollmentId: q.enrollmentId,
            netAmount: q.netAmount,
            purchaseSessions: q.purchaseSessions,
            graceSessionsGranted: q.graceSessionsGranted,
            graceSessionsUsed: q.graceSessionsUsed,
          }
        : null,
      chiCoQuyenDaHuy: cuaDong.length > 0 && !q,
      hocVienCuaQuyenLeadChildId: hv?.leadChildId ?? null,
      ghiDanhCuaQuyen: q?.enrollmentId ? laGhiDanh(ghiDanhQ.find((g) => g.id === q.enrollmentId)) : null,
      coDongGiaiThich: giaiThich,
      tienMoHo: tienMoHo.has(d.id),
      conHieuLuc: donConHieuLuc && d.status === "ACTIVE",
    };
    return {
      vao,
      hienCo: lech ? { id: lech.id, trangThai: lech.trangThai, lyDo: lech.lyDo, payload: lech.payload } : null,
      nc: { courseId: hinhThuc.courseId, leadChildId, studentId: q?.studentId ?? null, entitlementId: q?.id ?? null },
    };
  });
  return { orderId: don.id, centerId: don.centerId, dong };
}

// ═══ ĐỐI SOÁT LỆCH CHO MỘT ĐƠN ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export interface KetQuaLechMotDon {
  readonly moi: number;
  readonly daDong: number;
  readonly giuNguyen: number;
  readonly phatHien: readonly { readonly orderItemId: string; readonly ma: readonly string[] }[];
}

const RONG_LECH: KetQuaLechMotDon = { moi: 0, daDong: 0, giuNguyen: 0, phatHien: [] };

const chiTietPayload = (ph: readonly PhatHienLech[]): Prisma.InputJsonValue => ({ chiTiet: ph.map((p) => ({ ma: p.ma, moTa: p.moTa })) });

/**
 * Phát hiện lệch + ghi/đóng dòng LECH_DU_LIEU cho MỘT đơn. Đọc NGOÀI transaction để biết có việc gì không; chỉ khi có việc mới mở transaction, giữ khoá đơn,
 * ĐỌC LẠI dưới khoá rồi mới ghi (cap-tu-don / xep-lop-tu-don cũng đọc-quyết-ghi dòng xử lý dưới đúng khoá này).
 */
export async function doiSoatLechMotDon(orderId: string, now: Date, tienMoHo: ReadonlySet<string>): Promise<KetQuaLechMotDon> {
  const truoc = await docMatLech(db, orderId, tienMoHo);
  if (!truoc) return RONG_LECH;
  // Tự kiểm cờ phạm vi của CƠ SỞ CỦA ĐƠN (phòng thủ chiều sâu: chỗ gọi nào — cron, "Thử cấp lại" — cũng không ghi LECH_DU_LIEU cho cơ sở TẮT cờ).
  const orgUnitId = await orgUnitIdForCenter(truoc.centerId);
  const coBat = orgUnitId ? await laThuHocPhiTheoPhamViBat(orgUnitId) : false;
  if (!orgUnitId || !coBat) return RONG_LECH;
  const lapKeHoach = (mat: DonMat) =>
    mat.dong.map((d) => {
      const ph = phatHienLech(d.vao);
      const hienCo = d.hienCo ? { trangThai: d.hienCo.trangThai, lyDo: d.hienCo.lyDo, daQuyetDauVan: docDauVanDaQuyet(d.hienCo.payload) } : null;
      return { d, ph, ...keHoachLechMotDong(ph, hienCo) };
    });
  const keHoachTruoc = lapKeHoach(truoc);
  if (!keHoachTruoc.some((k) => k.viec.viec !== "KHONG_LAM_GI")) {
    return { ...RONG_LECH, giuNguyen: keHoachTruoc.filter((k) => k.d.hienCo?.trangThai === "OPEN" && k.lyDo !== null).length };
  }

  // `orgUnitId` đã tính TRƯỚC transaction ([DVU-PIN-07]: không có `db.` trong tx).
  return db.$transaction(
    async (tx): Promise<KetQuaLechMotDon> => {
      await khoaDonTrongTx(tx, orderId);
      const mat = await docMatLech(tx, orderId, tienMoHo);
      if (!mat) return RONG_LECH;
      let moi = 0;
      let daDong = 0;
      let giuNguyen = 0;
      const phatHien: { orderItemId: string; ma: readonly string[] }[] = [];
      for (const k of lapKeHoach(mat)) {
        if (k.ph.length > 0) phatHien.push({ orderItemId: k.d.vao.orderItemId, ma: k.ph.map((p) => p.ma) });
        const kq = await thiHanhHanhDongCho(
          tx,
          "LECH_DU_LIEU",
          k.viec,
          k.d.hienCo,
          { orderId, orderItemId: k.d.vao.orderItemId, centerId: mat.centerId, orgUnitId, ...k.d.nc },
          chiTietPayload(k.ph),
          now,
        );
        if (kq === "TAO" || kq === "MO_LAI" || kq === "DOI_LY_DO") moi++;
        else if (kq === "DONG_DA_XU_LY" || kq === "DONG_HUY") daDong++;
        else if (k.d.hienCo?.trangThai === "OPEN" && k.lyDo !== null) giuNguyen++;
      }
      return { moi, daDong, giuNguyen, phatHien };
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
}

// ═══ CRON ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export type DemTheoLoai = Record<LoaiHangDoi, number>;
const khong = (): DemTheoLoai => Object.fromEntries(LOAI_HANG_DOI.map((l) => [l, 0])) as DemTheoLoai;

export interface BaoCaoCoSo {
  readonly centerId: string;
  readonly ten: string;
  /** `null` = đã quét. */
  readonly boQua: "CO_TAT" | "KHONG_CO_ORGUNIT" | null;
  readonly soDonQuet: number;
  /** Còn đơn SCOPE chưa quét vì chạm trần `gioiHanDonMoiCoSo`. */
  readonly catGon: boolean;
}

export interface BaoCaoDoiSoat {
  readonly chayLuc: string;
  readonly soCoSoQuet: number;
  readonly soCoSoBoQua: number;
  readonly coSo: readonly BaoCaoCoSo[];
  readonly soDonQuet: number;
  readonly soDonLoi: number;
  readonly catGon: boolean;
  /** Dòng vừa TẠO / MỞ LẠI / ĐỔI LÝ DO ở lượt này, theo loại. */
  readonly moiTheoLoai: DemTheoLoai;
  /** Dòng vừa ĐÓNG ở lượt này (điều kiện hết), theo loại. */
  readonly daDongTheoLoai: DemTheoLoai;
  /** Dòng ĐÃ CÓ (đang mở, điều kiện như cũ) — bỏ qua, không trùng. */
  readonly giuNguyenTheoLoai: DemTheoLoai;
  /** Tổng dòng ĐANG MỞ cuối lượt (các cơ sở bật cờ). */
  readonly dangMoTheoLoai: DemTheoLoai;
  /** #2 — dòng đang mở quá `NGUONG_QUA_HAN_MS`. CHỈ ĐẾM. */
  readonly quaHan: { readonly tong: number; readonly theoLoai: DemTheoLoai; readonly mau: readonly { readonly id: string; readonly loai: LoaiHangDoi; readonly orderId: string }[] };
  /** #5 — quyền học đã đóng / hết hạn mà ghi danh còn học. CHỈ ĐẾM (nghĩa vận hành chưa chốt). */
  readonly quyenDongConGhiDanh: { readonly tong: number; readonly catGon: boolean; readonly mau: readonly { readonly quyenHocId: string; readonly status: string }[] };
  readonly loi: readonly { readonly orderId: string; readonly thongBao: string }[];
}

export interface DauVaoDoiSoat {
  readonly now: Date;
  /** BẮT BUỘC (luật 7): trần số đơn SCOPE quét MỖI CƠ SỞ MỖI LƯỢT. */
  readonly gioiHanDonMoiCoSo: number;
}

/** Trần số đơn SCOPE quét mỗi cơ sở mỗi lượt cron. Vượt trần ⇒ báo cáo `catGon: true` (đơn mới nhất quét trước). */
export const GIOI_HAN_DON_MOI_CO_SO = 300;

const TRAN_MAU = 20;
const TRAN_QUYEN_DONG = 500;

function cong(a: DemTheoLoai, loai: LoaiHangDoi, n = 1): void {
  a[loai] += n;
}

export async function chayDoiSoatQuyenHoc(vao: DauVaoDoiSoat): Promise<BaoCaoDoiSoat> {
  const { now, gioiHanDonMoiCoSo } = vao;
  const moiTheoLoai = khong();
  const daDongTheoLoai = khong();
  const giuNguyenTheoLoai = khong();
  const coSoBaoCao: BaoCaoCoSo[] = [];
  const loi: { orderId: string; thongBao: string }[] = [];
  const coSoQuet: string[] = [];
  let soDonQuet = 0;
  let soDonLoi = 0;

  const coSo = await db.center.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } });
  for (const c of coSo) {
    const orgUnitId = await orgUnitIdForCenter(c.id);
    if (!orgUnitId) {
      coSoBaoCao.push({ centerId: c.id, ten: c.name, boQua: "KHONG_CO_ORGUNIT", soDonQuet: 0, catGon: false });
      continue;
    }
    if (!(await laThuHocPhiTheoPhamViBat(orgUnitId))) {
      coSoBaoCao.push({ centerId: c.id, ten: c.name, boQua: "CO_TAT", soDonQuet: 0, catGon: false });
      continue;
    }
    // Đơn có ít nhất một dòng mang dấu SCOPE. `jsonb_exists` thay cho toán tử `?` (Prisma dùng `?` làm dấu tham số). Mới nhất trước; vượt trần ⇒ báo `catGon`.
    const don = await db.$queryRaw<{ id: string }[]>`
      SELECT o."id"
        FROM "Order" o
       WHERE o."centerId" = ${c.id}
         AND o."deletedAt" IS NULL
         AND EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o."id" AND jsonb_exists(oi."metadata"::jsonb, 'phamVi'))
       ORDER BY o."createdAt" DESC, o."id" ASC
       LIMIT ${gioiHanDonMoiCoSo + 1}`;
    const catGon = don.length > gioiHanDonMoiCoSo;
    const quet = don.slice(0, gioiHanDonMoiCoSo);
    coSoQuet.push(c.id);
    for (const { id: orderId } of quet) {
      soDonQuet++;
      try {
        const kq = await xetCapQuyenHocCoKetQua(orderId, "DOI_SOAT_DEM", now, "CHI_GHI_NHAN");
        cong(moiTheoLoai, "CHO_CHUYEN_DOI", kq.choChuyenDoi.length);
        cong(moiTheoLoai, "THIEU_QUYEN_HOC", kq.thieuQuyen.length);
        for (const x of kq.chieuNguoc) cong(moiTheoLoai, x.loai);
        cong(daDongTheoLoai, "CHO_CHUYEN_DOI", kq.daDongCho.length);
        cong(daDongTheoLoai, "THIEU_QUYEN_HOC", kq.daDongThieuQuyen.length);
        for (const x of kq.daDongChieuNguoc) cong(daDongTheoLoai, x.loai);
        for (const x of kq.giuNguyen) cong(giuNguyenTheoLoai, x.loai);
        const lech = await doiSoatLechMotDon(orderId, now, new Set(kq.chuaXacDinhDuocDong));
        cong(moiTheoLoai, "LECH_DU_LIEU", lech.moi);
        cong(daDongTheoLoai, "LECH_DU_LIEU", lech.daDong);
        cong(giuNguyenTheoLoai, "LECH_DU_LIEU", lech.giuNguyen);
      } catch (err) {
        soDonLoi++;
        if (loi.length < TRAN_MAU) loi.push({ orderId, thongBao: err instanceof Error ? err.message : String(err) });
        console.error(`[quyen-hoc-doi-soat] đơn ${orderId}`, err);
      }
    }
    coSoBaoCao.push({ centerId: c.id, ten: c.name, boQua: null, soDonQuet: quet.length, catGon });
  }

  // ── CHỈ ĐẾM ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const dangMoTheoLoai = khong();
  const quaHanTheoLoai = khong();
  let quaHanTong = 0;
  let quaHanMau: { id: string; loai: LoaiHangDoi; orderId: string }[] = [];
  let quyenDongTong = 0;
  const quyenDongMau: { quyenHocId: string; status: string }[] = [];
  let quyenDongCatGon = false;
  if (coSoQuet.length > 0) {
    const dangMo = await db.studyEntitlementXuLy.groupBy({ by: ["loai"], where: { trangThai: "OPEN", centerId: { in: coSoQuet } }, _count: { _all: true } });
    for (const g of dangMo) dangMoTheoLoai[g.loai] = g._count._all;
    const mocQuaHan = new Date(now.getTime() - NGUONG_QUA_HAN_MS);
    const quaHan = await db.studyEntitlementXuLy.groupBy({
      by: ["loai"],
      where: { trangThai: "OPEN", centerId: { in: coSoQuet }, updatedAt: { lte: mocQuaHan } },
      _count: { _all: true },
    });
    for (const g of quaHan) {
      quaHanTheoLoai[g.loai] = g._count._all;
      quaHanTong += g._count._all;
    }
    if (quaHanTong > 0) {
      const mau = await db.studyEntitlementXuLy.findMany({
        where: { trangThai: "OPEN", centerId: { in: coSoQuet }, updatedAt: { lte: mocQuaHan } },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: TRAN_MAU,
        select: { id: true, loai: true, orderId: true },
      });
      quaHanMau = mau.map((m) => ({ id: m.id, loai: m.loai, orderId: m.orderId }));
    }

    // #5 — đọc ghi danh của các quyền học đã đóng / hết hạn; hàm thuần quyết "ghi danh còn học".
    const quyenDong = await db.studyEntitlement.findMany({
      where: { centerId: { in: coSoQuet }, enrollmentId: { not: null }, status: { in: ["EXPIRED", "STOPPED", "SEAT_HOLD", "EXHAUSTED"] } },
      orderBy: { id: "asc" },
      take: TRAN_QUYEN_DONG + 1,
      select: { id: true, status: true, enrollmentId: true, graceSessionsGranted: true, graceSessionsUsed: true },
    });
    quyenDongCatGon = quyenDong.length > TRAN_QUYEN_DONG;
    const xet = quyenDong.slice(0, TRAN_QUYEN_DONG);
    const gd = await db.enrollment.findMany({
      where: { id: { in: xet.map((q) => q.enrollmentId).filter((x): x is string => Boolean(x)) } },
      select: { id: true, studentId: true, courseId: true, status: true, deletedAt: true },
    });
    for (const q of xet) {
      const g = gd.find((x) => x.id === q.enrollmentId) ?? null;
      const co = quyenDongConGhiDanhMo({ quyenId: q.id, status: q.status, graceSessionsGranted: q.graceSessionsGranted, graceSessionsUsed: q.graceSessionsUsed, ghiDanh: laGhiDanh(g) });
      if (!co) continue;
      quyenDongTong++;
      if (quyenDongMau.length < TRAN_MAU) quyenDongMau.push({ quyenHocId: q.id, status: q.status });
    }
  }

  return {
    chayLuc: now.toISOString(),
    soCoSoQuet: coSoQuet.length,
    soCoSoBoQua: coSoBaoCao.filter((c) => c.boQua !== null).length,
    coSo: coSoBaoCao,
    soDonQuet,
    soDonLoi,
    catGon: coSoBaoCao.some((c) => c.catGon),
    moiTheoLoai,
    daDongTheoLoai,
    giuNguyenTheoLoai,
    dangMoTheoLoai,
    quaHan: { tong: quaHanTong, theoLoai: quaHanTheoLoai, mau: quaHanMau },
    quyenDongConGhiDanh: { tong: quyenDongTong, catGon: quyenDongCatGon, mau: quyenDongMau },
    loi,
  };
}
