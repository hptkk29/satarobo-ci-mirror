// lib/entitlements/xep-lop-tu-don.ts — DÒNG ĐƠN SCOPE ĐÃ CÓ GHI DANH + QUYỀN HỌC ⇒ CHỐT BÀI BẮT ĐẦU, BÀI BỎ QUA, NHU CẦU HỌC VƯỢT. DB thật.
//
// 🔴 MỘT điểm vào duy nhất: `xetXepLopChoDon(orderId, nguon, now)`. Chỉ `lib/entitlements/hich.ts` (vỏ KHÔNG BAO GIỜ NÉM) gọi nó, NGAY SAU lời gọi
// cấp quyền học — nên MỌI đường tiền / Chuyển đổi đã nối vào `hich` tự được xếp lớp, không đường nào phải thêm lời gọi.
//
// HÀM TỰ TÍNH LẠI MỌI THỨ như `cap-tu-don.ts`: sự kiện chỉ là cái hích, "đủ điều kiện xếp chưa" luôn đọc lại DƯỚI KHOÁ ĐƠN. Gọi bao nhiêu lần, từ
// đâu, theo thứ tự nào cũng ra cùng kết quả: quyền học đã chốt phạm vi (ACTIVE / có `enrollmentId`) thì BỎ QUA, không tạo trùng nhu cầu học vượt.
//
// ── VÌ SAO TRANSACTION RIÊNG, SAU TRANSACTION CẤP QUYỀN (và không trong transaction convert) ──────────────────────────────────────────────
//   · Quyền học của khách mới chỉ ra đời SAU commit convert (cần Student), hoặc khi tiền xác nhận về — thứ tự hai việc đảo tuỳ đường. Neo xếp lớp
//     vào "quyền học đang AWAITING_PLACEMENT và dòng đã có ghi danh" thì cả hai thứ tự cùng hội tụ về một chỗ.
//   · Một dòng KHÔNG xếp được (lớp hết buổi, chưa ghim giáo trình, phạm vi vượt giáo trình) KHÔNG được làm hỏng việc CẤP quyền của các dòng khác.
//     Cấp quyền đã commit trước; ở đây mỗi lỗi đã đoán trước được biến thành một dòng CHỜ, KHÔNG ném.
//   · Thứ tự khoá: ĐƠN trước (`khoaDonTrongTx`), rồi quyền học (`FOR UPDATE` trong `xepLopTrongTx`). Đừng đảo.
//
// ── THỨ TỰ CỔNG ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   NGOÀI transaction (kết nối gốc, CHỈ ĐỌC): đơn có dấu SCOPE? → cơ sở → OrgUnit → cờ → quyền học + ghi danh của từng dòng → bài kế tiếp của lớp →
//   phép tính thuần → buổi đã dạy cho bài học vượt → cài đặt. Cờ TẮT hoặc đơn thường ⇒ DỪNG ngay, không ghi gì.
//   TRONG `db.$transaction` (chỉ `tx`, KHÔNG `db.` — [DVU-PIN-07]): khoá đơn → đọc lại quyền học → chốt phạm vi → nhu cầu học vượt → dòng chờ.
//
// ── "ĐÃ BIẾT" vs "ĐOÁN" ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   Không suy được bài kế tiếp của lớp, hoặc phạm vi vượt giáo trình, hoặc ghi danh mơ hồ ⇒ KHÔNG xếp, quyền học GIỮ AWAITING_PLACEMENT, ghi MỘT
//   dòng CHO_XEP_LOP kèm lý do. Không tiêu thụ buổi nào ở đây (`StudyEntitlementUsage` không bao giờ có dòng mới từ file này).
import "server-only";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { syncConversationMembership } from "@/lib/chat/sync-membership";
import { mocThoiGianGhiDanhMoi, trangThaiGhiDanhMoi } from "@/lib/enrollments/trang-thai-ghi-danh-moi";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { taoDongHocBu } from "@/lib/hoc-bu/dong-service";
import { NGUON_BU_HOC_VUOT } from "@/lib/hoc-bu/xep-case";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { tranHocVuotCuaKhoa } from "@/lib/lms/xep-lop-theo-buoi-bat-dau";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { docConLeadTuMetadata } from "@/lib/orders/hoc-vien-dong-don";
import { docPhamViDong, laDonPhamVi } from "@/lib/orders/pham-vi/doc-dong";
import { docBaiKeTiepCuaLop, docBuoiDaDayTheoBai } from "./bai-ke-tiep-db";
import { tinhBatDauKhiXepLop, type KetQuaXepLop } from "./bat-dau-khi-xep-lop";
import type { NguonCapQuyenHoc } from "./cap-tu-don";
import { hanhDongChoXepLop, type HanhDongChoXepLop, type TinhHuongXepLop } from "./cho-xep-lop";
import { docDauVanDaQuyet, payloadSauMoLai } from "./da-quyet";
import { xepLopTrongTx } from "./dich-vu";
import { docBaiMoiBuoiHocVuot, docCauHinhPhamViKemRoRang, laThuHocPhiTheoPhamViBat } from "./feature";
import { chonGhiDanhChoDong, TRANG_THAI_GHI_DANH_SONG, type GhiDanhUngVien, type KetQuaGhiDanhCuaDong } from "./ghi-danh-cua-dong";
import { LoiPhamVi, type CauHinhPhamVi } from "./pham-vi-hoc";

export type LyDoBoQuaXepLop = "KHONG_CO_DON" | "KHONG_PHAI_DON_PHAM_VI" | "DON_DA_HUY" | "KHONG_CO_CO_SO" | "CO_SO_DOI" | "CO_TAT";

export interface DongDaXep {
  readonly orderItemId: string;
  readonly quyenHocId: string;
  readonly enrollmentId: string;
  readonly classId: string;
  readonly startLesson: number;
  readonly endLesson: number;
  readonly catchupMode: KetQuaXepLop["catchupMode"];
  /** Số dòng `MakeupNeed` (ORDER_CONVERSION) vừa tạo — bài học vượt đã gắn được vào buổi đã dạy. */
  readonly soNhuCauHocVuot: number;
  /** Bài học vượt KHÔNG gắn được vào buổi đã dạy nào của lớp ⇒ đã mở dòng CHỜ. */
  readonly baiChuaGanDuoc: readonly number[];
}

export interface KetQuaXepLopTuDon {
  readonly nguon: NguonCapQuyenHoc;
  readonly boQua: LyDoBoQuaXepLop | null;
  readonly daXep: readonly DongDaXep[];
  /** Quyền học đã chốt phạm vi từ trước (ACTIVE / có `enrollmentId`) — không ghi gì. */
  readonly daXepTruoc: readonly string[];
  /** Dòng CHỜ vừa tạo / mở lại / đổi lý do ở lượt này (gọi lại không đổi gì ⇒ không có mặt). */
  readonly cho: readonly { readonly orderItemId: string; readonly lyDo: string }[];
  /** Ghi danh vừa được kích hoạt PENDING → STUDYING/CONFIRMED vì quyền học đã chốt phạm vi (quyết định 3: quyền học TRƯỚC, ghi danh active SAU). */
  readonly daKichHoat: readonly { readonly enrollmentId: string; readonly tu: "PENDING"; readonly den: string }[];
  readonly daDongCho: readonly { readonly orderItemId: string; readonly trangThai: "DA_XU_LY" | "HUY" }[];
}

const RONG = (nguon: NguonCapQuyenHoc, boQua: LyDoBoQuaXepLop | null): KetQuaXepLopTuDon => ({ nguon, boQua, daXep: [], daXepTruoc: [], cho: [], daKichHoat: [], daDongCho: [] });

const DON_DA_HUY = ["CANCELLED", "REFUNDED"] as const;

/** Loại chiều ngược còn MỞ trên dòng này ⇒ quyền học đang bị đánh dấu thu hồi / treo duyệt tay ⇒ KHÔNG chốt phạm vi cho nó. */
const LOAI_CHIEU_NGUOC = ["CAN_THU_HOI", "TREO_DUYET_TAY"] as const;

const LY_DO_CHUA_CO_QUYEN = "Đã có ghi danh nhưng dòng chưa có quyền học hợp lệ (tiền xác nhận chưa đủ, hoặc chưa xác định được học viên) — đủ điều kiện thì hệ thống tự cấp và chốt phạm vi bài.";
const LY_DO_CHIEU_NGUOC = "Quyền học đang bị đánh dấu thu hồi / treo duyệt tay (tiền bị đảo, huỷ hoặc hoàn) — không chốt phạm vi bài cho tới khi người có quyền xử lý.";
const LY_DO_LOP_KHONG_SUY_DUOC =
  "Không suy được bài kế tiếp của lớp (lớp không còn buổi chưa huỷ, hoặc buổi sớm nhất chưa ghim giáo trình) — KHÔNG xếp theo đoán; ghim giáo trình / xếp lớp khác rồi hệ thống tự chốt.";

interface KeHoachDong {
  readonly orderItemId: string;
  readonly studentId: string | null;
  readonly quyen: { id: string; status: string; enrollmentId: string | null; studentId: string } | null;
  readonly coQuyenDaHuy: boolean;
  readonly ghiDanh: KetQuaGhiDanhCuaDong;
  /** Đã tính xong ngoài transaction khi quyền AWAITING_PLACEMENT và ghi danh rõ ràng. */
  readonly xep: { classId: string; baiKeTiepCuaLop: number; ketQua: KetQuaXepLop; buoiDaDay: Map<number, string>; orgUnitIdLop: string | null } | null;
  /** Khác `null` ⇒ không xếp được lượt này: lý do cho người đọc. */
  readonly lyDoCho: string | null;
  /** Cấu hình của RIÊNG khoá này: `catchUpMaxSessions` = mức riêng của khoá nếu có (`Course.catchUpMaxSessions`), không thì mức cơ sở. */
  readonly cauHinh: CauHinhPhamVi;
}

export async function xetXepLopChoDon(orderId: string, nguon: NguonCapQuyenHoc, now: Date): Promise<KetQuaXepLopTuDon> {
  // ── 1 · DẤU SCOPE ────────────────────────────────────────────────────────────────────────────────────────────────
  const don = await db.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      centerId: true,
      items: { select: { id: true, type: true, metadata: true, studentId: true, enrollmentId: true } },
    },
  });
  if (!don) return RONG(nguon, "KHONG_CO_DON");
  if (!laDonPhamVi(don.items)) return RONG(nguon, "KHONG_PHAI_DON_PHAM_VI");
  if ((DON_DA_HUY as readonly string[]).includes(don.status)) return RONG(nguon, "DON_DA_HUY");

  // ── 2 · CƠ SỞ → ORGUNIT, 3 · CỜ (cùng luật cap-tu-don.ts) ──────────────────────────────────────────────────────
  const centerId = don.centerId;
  if (!centerId) return RONG(nguon, "KHONG_CO_CO_SO");
  const orgUnitId = await orgUnitIdForCenter(centerId);
  if (!orgUnitId) return RONG(nguon, "KHONG_CO_CO_SO");
  if (!(await laThuHocPhiTheoPhamViBat(orgUnitId))) return RONG(nguon, "CO_TAT");

  // ── 4 · ĐỌC (ngoài transaction) ──────────────────────────────────────────────────────────────────────────────────
  const dongScope = don.items.filter((d) => d.type === "COURSE_ENROLLMENT" && docPhamViDong(d.metadata) !== null);
  const dongIds = dongScope.map((d) => d.id);
  const [quyenTho, ghiDanhCuaDongTho, cauHinhDoc, baiMoiBuoiHocVuot, khoaTho] = await Promise.all([
    db.studyEntitlement.findMany({
      where: { orderItemId: { in: dongIds } },
      select: { id: true, orderItemId: true, status: true, enrollmentId: true, studentId: true, courseId: true, purchaseKind: true, purchaseSessions: true },
    }),
    db.enrollment.findMany({
      where: { id: { in: dongScope.map((d) => d.enrollmentId).filter((x): x is string => Boolean(x)) } },
      select: { id: true, studentId: true, courseId: true, classId: true, status: true, deletedAt: true, buoiBatDau: true, class: { select: { centerId: true } } },
    }),
    docCauHinhPhamViKemRoRang(orgUnitId),
    docBaiMoiBuoiHocVuot(orgUnitId),
    db.course.findMany({
      where: { id: { in: [...new Set(dongScope.map((d) => docHinhThucLop(d.metadata).courseId).filter((c): c is string => c !== null))] } },
      select: { id: true, catchUpMaxSessions: true },
    }),
  ]);
  const cauHinhCoSo = cauHinhDoc.cauHinh;
  const mucKhoa = new Map(khoaTho.map((k) => [k.id, k.catchUpMaxSessions]));
  /** Trần học vượt riêng của khoá thắng mức cơ sở [28/10/2026]. */
  const cauHinhCuaKhoa = (courseId: string): CauHinhPhamVi => ({ ...cauHinhCoSo, catchUpMaxSessions: tranHocVuotCuaKhoa(mucKhoa.get(courseId) ?? null, cauHinhCoSo.catchUpMaxSessions) });
  const conIds = [...new Set(dongScope.map((d) => docConLeadTuMetadata(d.metadata)).filter((x): x is string => Boolean(x)))];
  const ghiDanhCuaConTho =
    conIds.length === 0
      ? []
      : await db.enrollment.findMany({
          where: { leadChildId: { in: conIds }, deletedAt: null, status: { in: [...TRANG_THAI_GHI_DANH_SONG] } },
          select: { id: true, studentId: true, courseId: true, classId: true, status: true, deletedAt: true, buoiBatDau: true, leadChildId: true, class: { select: { centerId: true } } },
        });
  const lopTheoGhiDanh = new Map<string, string | null>([...ghiDanhCuaDongTho, ...ghiDanhCuaConTho].map((g) => [g.id, g.class.centerId]));
  // Buổi bắt đầu SALE CHỌN ở màn Chuyển đổi — chỉ tin khi ghi danh còn PENDING (trạng thái màn Chuyển đổi để lại cho dòng SCOPE; `convertLeadV2` để NULL cho dòng SCOPE).
  const batDauChonCuaGhiDanh = new Map<string, number | null>([...ghiDanhCuaDongTho, ...ghiDanhCuaConTho].map((g) => [g.id, g.status === "PENDING" ? g.buoiBatDau : null]));
  const uv = (g: (typeof ghiDanhCuaDongTho)[number]): GhiDanhUngVien => ({
    id: g.id,
    studentId: g.studentId,
    courseId: g.courseId,
    classId: g.classId,
    status: g.status,
    deletedAt: g.deletedAt,
  });

  const keHoach: KeHoachDong[] = [];
  for (const d of dongScope) {
    const cuaDong = quyenTho.filter((q) => q.orderItemId === d.id);
    const quyen = cuaDong.find((q) => q.status !== "VOIDED") ?? null;
    const hinhThuc = docHinhThucLop(d.metadata);
    const courseId = quyen?.courseId ?? hinhThuc.courseId;
    const leadChildId = docConLeadTuMetadata(d.metadata);
    if (!courseId) {
      keHoach.push({ orderItemId: d.id, studentId: quyen?.studentId ?? null, quyen, coQuyenDaHuy: cuaDong.length > 0 && !quyen, ghiDanh: { kieu: "CHUA_CO", canXem: true, lyDo: "Dòng đơn không xác định được khoá học." }, xep: null, lyDoCho: null, cauHinh: cauHinhCoSo });
      continue;
    }
    const cauHinh = cauHinhCuaKhoa(courseId);
    const ghiDanh = chonGhiDanhChoDong({
      courseId,
      studentId: quyen?.studentId ?? null,
      enrollmentIdCuaDong: d.enrollmentId,
      ghiDanhCuaDong: d.enrollmentId ? (ghiDanhCuaDongTho.map(uv).find((g) => g.id === d.enrollmentId) ?? null) : null,
      leadChildId,
      ghiDanhCuaCon: ghiDanhCuaConTho.filter((g) => g.leadChildId === leadChildId).map(uv),
    });

    let xep: KeHoachDong["xep"] = null;
    let lyDoCho: string | null = null;
    if (quyen && quyen.status === "AWAITING_PLACEMENT" && quyen.enrollmentId === null) {
      if (ghiDanh.kieu === "MO_HO") lyDoCho = ghiDanh.lyDo;
      else if (ghiDanh.kieu === "CHUA_CO") lyDoCho = ghiDanh.canXem ? ghiDanh.lyDo : null; // chưa có ghi danh = chờ BÌNH THƯỜNG, không mở hàng đợi
      else {
        const classId = ghiDanh.ghiDanh.classId;
        const baiKeTiep = await docBaiKeTiepCuaLop(db, classId, now);
        if (baiKeTiep === null) lyDoCho = LY_DO_LOP_KHONG_SUY_DUOC;
        else {
          try {
            const ketQua = tinhBatDauKhiXepLop({
              loai: quyen.purchaseKind,
              soBuoi: quyen.purchaseSessions,
              baiKeTiepCuaLop: baiKeTiep,
              cauHinh,
              baiMoiBuoiHocVuot,
              batDauChon: batDauChonCuaGhiDanh.get(ghiDanh.ghiDanh.id) ?? null,
            });
            const centerLop = lopTheoGhiDanh.get(ghiDanh.ghiDanh.id) ?? null;
            xep = {
              classId,
              baiKeTiepCuaLop: baiKeTiep,
              ketQua,
              buoiDaDay: await docBuoiDaDayTheoBai(db, classId, now, ketQua.requiredCatchupLessons),
              orgUnitIdLop: centerLop ? await orgUnitIdForCenter(centerLop) : null,
            };
          } catch (e) {
            if (!(e instanceof LoiPhamVi)) throw e;
            lyDoCho = `Không chốt được phạm vi bài: ${e.message} — KHÔNG xếp theo đoán; đổi lớp hoặc xem lại số buổi đã mua.`;
          }
        }
      }
    } else if (!quyen && ghiDanh.kieu === "CO") {
      lyDoCho = LY_DO_CHUA_CO_QUYEN;
    }
    keHoach.push({ orderItemId: d.id, studentId: quyen?.studentId ?? null, quyen, coQuyenDaHuy: cuaDong.length > 0 && !quyen, ghiDanh, xep, lyDoCho, cauHinh });
  }

  // ── 5 · TRONG TRANSACTION, DƯỚI KHOÁ ĐƠN ─────────────────────────────────────────────────────────────────────────
  const actor = { id: null, name: `Hệ thống — xếp lớp theo quyền học (${nguon})` };
  return db.$transaction(
    async (tx): Promise<KetQuaXepLopTuDon> => {
      await khoaDonTrongTx(tx, orderId);
      const hienTai = await tx.order.findUnique({ where: { id: orderId }, select: { status: true, centerId: true } });
      if (!hienTai) return RONG(nguon, "KHONG_CO_DON");
      if (hienTai.centerId !== centerId) return RONG(nguon, "CO_SO_DOI");
      if ((DON_DA_HUY as readonly string[]).includes(hienTai.status)) return RONG(nguon, "DON_DA_HUY");

      const xuLyCu = await tx.studyEntitlementXuLy.findMany({
        where: { orderItemId: { in: dongIds } },
        select: { id: true, orderItemId: true, loai: true, trangThai: true, lyDo: true, payload: true },
      });
      // Quyền học ĐỌC LẠI dưới khoá: giữa lúc đọc ngoài và lúc có khoá, một lượt hích khác có thể đã xếp xong.
      const quyenMoi = await tx.studyEntitlement.findMany({
        where: { orderItemId: { in: dongIds }, status: { not: "VOIDED" } },
        select: { id: true, orderItemId: true, status: true, enrollmentId: true },
      });

      const daXep: DongDaXep[] = [];
      const daXepTruoc: string[] = [];
      const cho: { orderItemId: string; lyDo: string }[] = [];
            const daKichHoat: { enrollmentId: string; tu: "PENDING"; den: string }[] = [];
      const daDongCho: { orderItemId: string; trangThai: "DA_XU_LY" | "HUY" }[] = [];

      const xuLyCho = async (k: KeHoachDong, tinhHuong: TinhHuongXepLop, nguCanh: { entitlementId?: string | null }): Promise<void> => {
        const hienCo = xuLyCu.find((c) => c.orderItemId === k.orderItemId && c.loai === "CHO_XEP_LOP") ?? null;
        // `daQuyetDauVan`: người xử lý đã đóng dòng này ở ĐÚNG điều kiện này ⇒ không mở lại (da-quyet.ts).
        const viec: HanhDongChoXepLop = hanhDongChoXepLop(
          hienCo ? { trangThai: hienCo.trangThai, lyDo: hienCo.lyDo, daQuyetDauVan: docDauVanDaQuyet(hienCo.payload) } : null,
          tinhHuong,
        );
        if (viec.viec === "KHONG_LAM_GI") return;
        const goc = dongScope.find((d) => d.id === k.orderItemId)!;
        if (viec.viec === "TAO_MOI") {
          await tx.studyEntitlementXuLy.create({
            data: {
              loai: "CHO_XEP_LOP",
              trangThai: "OPEN",
              orderId,
              orderItemId: k.orderItemId,
              courseId: docHinhThucLop(goc.metadata).courseId,
              leadChildId: docConLeadTuMetadata(goc.metadata),
              studentId: k.studentId,
              entitlementId: nguCanh.entitlementId ?? null,
              centerId,
              orgUnitId,
              lyDo: viec.lyDo,
            },
          });
          cho.push({ orderItemId: k.orderItemId, lyDo: viec.lyDo });
          return;
        }
        if (!hienCo) return; // các việc còn lại đều có dòng hiện có (hàm thuần bảo đảm); chặn kiểu cho tsc
        if (viec.viec === "MO_LAI") {
          await tx.studyEntitlementXuLy.update({
            where: { id: hienCo.id },
            data: { trangThai: "OPEN", lyDo: viec.lyDo, resolvedAt: null, resolvedNote: null, studentId: k.studentId, entitlementId: nguCanh.entitlementId ?? null, ...payloadSauMoLai(hienCo.payload) },
          });
          cho.push({ orderItemId: k.orderItemId, lyDo: viec.lyDo });
        } else if (viec.viec === "CAP_NHAT_LY_DO") {
          await tx.studyEntitlementXuLy.update({ where: { id: hienCo.id }, data: { lyDo: viec.lyDo } });
          cho.push({ orderItemId: k.orderItemId, lyDo: viec.lyDo });
        } else {
          await tx.studyEntitlementXuLy.update({
            where: { id: hienCo.id },
            data: { trangThai: viec.trangThai, resolvedAt: now, resolvedNote: viec.lyDo, studentId: k.studentId, entitlementId: nguCanh.entitlementId ?? null },
          });
          daDongCho.push({ orderItemId: k.orderItemId, trangThai: viec.trangThai });
        }
      };

      for (const k of keHoach) {
        const q = quyenMoi.find((x) => x.orderItemId === k.orderItemId) ?? null;
        const nguCanh = { entitlementId: q?.id ?? null };

        if (k.coQuyenDaHuy) {
          await xuLyCho(k, { kieu: "KHONG_CON_HOP_LE", lyDo: "Quyền học của dòng đã bị huỷ — không còn gì để xếp." }, nguCanh);
          continue;
        }
        // Đã chốt phạm vi (lượt hích khác, hoặc đường khác) ⇒ KHÔNG ghi gì, kể cả dòng chờ: dòng còn MỞ ở trạng thái này chỉ có thể là dòng
        // "bài học vượt chưa gắn được buổi" do chính lượt xếp lớp để lại — đóng nó ở đây là xoá lời báo của người vận hành.
        if (q && (q.status !== "AWAITING_PLACEMENT" || q.enrollmentId !== null)) {
          daXepTruoc.push(k.orderItemId);
          continue;
        }
        if (!q) {
          // Chưa có quyền học: có ghi danh rõ ràng ⇒ dòng chờ "chờ tiền / học viên"; còn lại ⇒ cap-tu-don lo (CHO_CHUYEN_DOI), ở đây chỉ đóng dòng cũ.
          if (k.lyDoCho) await xuLyCho(k, { kieu: "PHAI_CHO", lyDo: k.lyDoCho }, nguCanh);
          else await xuLyCho(k, { kieu: "KHONG_CON_HOP_LE", lyDo: "Không còn ghi danh rõ ràng cho dòng — không còn gì để xếp." }, nguCanh);
          continue;
        }
        if (xuLyCu.some((c) => c.orderItemId === k.orderItemId && c.trangThai === "OPEN" && (LOAI_CHIEU_NGUOC as readonly string[]).includes(c.loai))) {
          await xuLyCho(k, { kieu: "PHAI_CHO", lyDo: LY_DO_CHIEU_NGUOC }, nguCanh);
          continue;
        }
        if (!k.xep || k.ghiDanh.kieu !== "CO") {
          if (k.lyDoCho) await xuLyCho(k, { kieu: "PHAI_CHO", lyDo: k.lyDoCho }, nguCanh);
          else await xuLyCho(k, { kieu: "KHONG_CON_HOP_LE", lyDo: "Dòng chưa có ghi danh rõ ràng để xếp — chờ xếp lớp, không còn gì phải xem." }, nguCanh);
          continue;
        }

        // ── CHỐT PHẠM VI ──────────────────────────────────────────────────────────────────────────────────────────
        const gd = k.ghiDanh.ghiDanh;
        // Ghi danh đọc NGOÀI khoá đơn; rút / đổi lớp không đi qua khoá đơn nên đọc lại ở đây — không chốt phạm vi theo bài kế tiếp của lớp CŨ.
        const gdMoi = await tx.enrollment.findUnique({ where: { id: gd.id }, select: { classId: true, status: true, deletedAt: true, buoiBatDau: true, class: { select: { status: true } } } });
        if (!gdMoi || gdMoi.deletedAt !== null || gdMoi.classId !== gd.classId || !(TRANG_THAI_GHI_DANH_SONG as readonly string[]).includes(gdMoi.status)) {
          await xuLyCho(
            k,
            { kieu: "PHAI_CHO", lyDo: "Ghi danh vừa đổi (rút / đổi lớp / xoá) giữa lúc đọc và lúc chốt — không chốt phạm vi theo dữ liệu đã cũ; lượt hích kế tiếp sẽ chốt lại." },
            nguCanh,
          );
          continue;
        }
        const { phamVi } = await xepLopTrongTx(
          tx,
          {
            entitlementId: q.id,
            enrollmentId: gd.id,
            classId: gd.classId,
            baiKeTiepCuaLop: k.xep.baiKeTiepCuaLop,
            cauHinh: k.cauHinh,
            baiMoiBuoiHocVuot,
            // Đọc LẠI dưới khoá (không dùng giá trị đọc ngoài khoá): cùng quy tắc "chỉ tin khi PENDING" với lúc lập kế hoạch.
            batDauChon: gdMoi.status !== "PENDING" ? null : gdMoi.buoiBatDau,
            actor,
            now,
          },
          { centerId, bat: true },
        );

        // Bản sao CHO CÁC ĐƯỜNG ĐỌC CŨ (`buoi-duoc-hoc.ts` ← `lib/attendance/roster.ts`, `panel-gv.ts`; cổng phụ huynh KHÔNG đọc cột này): bài trước start không hiện trên bảng điểm danh. Quyền học là nguồn;
        // cột này chỉ là cache cho nơi chưa đọc quyền học. start = 1 ⇒ NULL (đủ khoá — cùng quy ước convertLeadV2).
        await tx.enrollment.update({ where: { id: gd.id }, data: { buoiBatDau: phamVi.startLesson > 1 ? phamVi.startLesson : null } });

        // ── KÍCH HOẠT GHI DANH (quyết định 3) ─────────────────────────────────────────────────────────────────────────────────────────────────
        // Ghi danh của dòng SCOPE (cờ BẬT) ra đời ở trạng thái PENDING "Chờ xếp lớp" (convertLeadV2 / chuyenDoiDonAction): chưa có quyền học thì CHƯA được vào roster, điểm danh,
        // nhóm chat. Quyền học vừa chốt phạm vi ⇒ đến đây mới kích hoạt, theo ĐÚNG luật 11/10 (`trangThaiGhiDanhMoi`: lớp đang chạy ⇒ STUDYING, chưa khai giảng ⇒ CONFIRMED). CHỈ
        // đụng ghi danh đang PENDING — STUDYING / ACTIVE / PAUSED… (đường cũ, ghi danh thủ công) giữ nguyên chữ. PENDING → STUDYING không có trong ENROLLMENT_TRANSITIONS (máy
        // trạng thái người dùng); đây là bước HỆ THỐNG, ghi `EnrollmentAuditLog` + AuditLog để truy được. Nhóm chat đồng bộ CÙNG transaction (chat law 5).
        if (gdMoi.status === "PENDING") {
          const den = trangThaiGhiDanhMoi(gdMoi.class.status, "CONFIRMED");
          await tx.enrollment.update({ where: { id: gd.id }, data: { status: den, ...mocThoiGianGhiDanhMoi(den, now) } });
          await tx.enrollmentAuditLog.create({
            data: {
              enrollmentId: gd.id,
              fromStatus: "PENDING",
              toStatus: den,
              changedByUserId: null,
              changedByName: actor.name,
              reason: "Quyền học đã chốt phạm vi bài — kích hoạt ghi danh (quyền học trước, ghi danh active sau).",
              extraData: { nguon, entitlementId: q.id, startLesson: phamVi.startLesson, endLesson: phamVi.endLesson },
            },
          });
          await writeAudit({
            actor,
            module: "enrollment",
            entityType: "Enrollment",
            entityId: gd.id,
            action: "STATUS_CHANGE",
            oldValues: { status: "PENDING" },
            newValues: { status: den, entitlementId: q.id },
            changedFields: ["status"],
            reason: "Quyền học đã chốt phạm vi bài",
            orgUnitId: centerId,
            tx,
          });
          await syncConversationMembership(tx, gd.classId);
          daKichHoat.push({ enrollmentId: gd.id, tu: "PENDING", den });
        }

        // ── NHU CẦU HỌC VƯỢT: một MakeupNeed (ORDER_CONVERSION, miễn phí) cho mỗi bài phải học vượt có buổi đã dạy ──────────
        const baiChuaGan: number[] = [];
        let soNhuCau = 0;
        for (const bai of phamVi.requiredCatchupLessons) {
          const buoiId = k.xep.buoiDaDay.get(bai);
          if (!buoiId) {
            baiChuaGan.push(bai);
            continue;
          }
          const r = await taoDongHocBu(tx, { studentId: gd.studentId, missedSessionId: buoiId, nguon: "ORDER_CONVERSION", nguonBaoLuu: NGUON_BU_HOC_VUOT, createdById: null, orgUnitId: k.xep.orgUnitIdLop });
          if (r.ket === "TAO") soNhuCau++;
        }

        // ── HỌC VƯỢT KHÔNG CÒN XIN DUYỆT [chủ dự án chốt 21/10/2026] ──────────────────────────────────────────────────────────────────────────
        // Vượt n buổi (n = `enrollment.catchUpMaxSessions`) ⇒ `tinhBatDauKhiXepLop` bỏ qua mọi bài đã qua, vào từ buổi kế tiếp, KHÔNG bù, KHÔNG chờ ai.
        // Muốn bù thì phụ huynh yêu cầu và QLCS tạo case. Dòng CHO_DUYET_HOC_VUOT ĐÃ MỞ từ trước vẫn duyệt được (`hang-doi/hanh-dong.ts`); đường này không tạo thêm.

        daXep.push({
          orderItemId: k.orderItemId,
          quyenHocId: q.id,
          enrollmentId: gd.id,
          classId: gd.classId,
          startLesson: phamVi.startLesson,
          endLesson: phamVi.endLesson,
          catchupMode: phamVi.catchupMode,
          soNhuCauHocVuot: soNhuCau,
          baiChuaGanDuoc: baiChuaGan,
        });
        if (baiChuaGan.length > 0) {
          await xuLyCho(
            k,
            { kieu: "PHAI_CHO", lyDo: `Đã chốt phạm vi bài ${phamVi.startLesson}–${phamVi.endLesson} nhưng ${baiChuaGan.length} bài học vượt (${baiChuaGan.join(", ")}) không gắn được vào buổi đã dạy nào của lớp — Đào tạo xếp buổi học vượt bằng tay.` },
            nguCanh,
          );
        } else {
          await xuLyCho(k, { kieu: "DA_XEP_XONG" }, nguCanh);
        }
      }

      return { nguon, boQua: null, daXep, daXepTruoc, cho, daKichHoat, daDongCho };
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
}

