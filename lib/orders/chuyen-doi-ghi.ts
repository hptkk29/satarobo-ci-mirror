import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { genStudentCodeV2 } from "@/lib/codegen";
import { findExistingStudent } from "@/lib/crm/dedupe";
import {
  cauChanGhiDanhCu,
  goGhiDanhCuDaKetThuc,
  SELECT_GHI_DANH_CU,
  whereGhiDanhCu,
  xetGhiDanhCu,
} from "@/lib/enrollments/ghi-danh-cu-trong-lop";
import { ganKhoanSauChuyenDoi } from "@/lib/finance/gan-khoan-sau-chuyen-doi";
import { dongBoTuHocVien } from "@/lib/students/dong-bo-lead-db";
import { CHON_CON_HOC_VIEN, CHON_PH_HOC_VIEN, type ConHocVien, type PhHocVien } from "@/lib/students/dong-bo-lead";
import type { GioiTinh } from "@/lib/students/gioi-tinh";
import type { DuLieuChuyenDoi } from "@/lib/orders/chuyen-doi-don";
import { duyetYeuCauHocVuot, taoYeuCauHocVuot } from "@/lib/orders/hoc-vuot-chuyen-doi";

// lib/orders/chuyen-doi-ghi.ts — PHÉP GHI của màn Chuyển đổi: tạo học viên, ghi danh, đồng ý hình ảnh, yêu cầu học vượt bù. MỘT giao dịch.
//
// Tách khỏi server action vì phải dùng `db.$transaction` KHÔNG scope: `dongBoTuHocVien` (đồng bộ HV ↔ lead, luật "đổi 1 nơi đổi hết") đọc phiếu lead và
// anh/chị/em ở MỌI cơ sở — qua `scopedDb` chúng bị bỏ qua IM LẶNG. Quyền + tầm nhìn cơ sở đã kiểm ở action (`scopedDb(actor).order.findFirst`) TRƯỚC khi gọi đây.
//
// ⚠️ Mọi cổng TỪ CHỐI đứng ở action, TRƯỚC giao dịch (luật rollback: `return` trong callback không rollback). Trong đây chỉ `throw` khi dữ kiện sai bất ngờ.

type Tx = Prisma.TransactionClient;

export type KeHoachDong = {
  orderItemId: string;
  tenBe: string;
  ngaySinh: Date | null;
  gioiTinh: GioiTinh | null;
  lopTruong: number | null;
  truong: string | null;
  classId: string;
  courseId: string;
  /** `LeadChild.id` của dòng — nối Student về đứa trẻ trong phiếu lead. */
  leadChildId: string | null;
  /** Buổi bắt đầu lưu vào `Enrollment.buoiBatDau` (`null` = buổi 1 / dòng SCOPE). */
  buoiBatDauLuu: number | null;
  /** Dòng SCOPE khi cờ phạm vi BẬT: ghi danh PENDING chờ quyền học. */
  phamVi: boolean;
  dongYHinhAnh: boolean;
  /** Chỉ dòng ĐƠN THƯỜNG khi lớp đòi học vượt: số buổi bé phải bù (v), số buổi bù Sale khai (b), buổi bắt đầu (S). */
  hocVuot: { buoiBatDau: number; canBu: number; soBuoiBu: number } | null;
};

export type PhuHuynhGhi = {
  ten: string;
  email: string | null;
  quanHe: string | null;
  gioiTinh: GioiTinh | null;
  ngaySinh: Date | null;
  facebook: string | null;
  diaChi: string | null;
  tinh: string | null;
  phuong: string | null;
};

export type KetQuaGhi = {
  soCon: number;
  /** Số dòng cần bù đã sinh NGAY (QLCS / Quản trị tối cao tự duyệt). */
  soDongBu: number;
  /** Yêu cầu học vượt đang chờ QLCS duyệt — báo chuông sau commit. */
  choDuyet: { requestId: string; tenBe: string; soBuoiBu: number; centerId: string }[];
  ganKhoan: unknown;
};

const chuoi = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

const PH_VA_CON_CHON = { ...CHON_PH_HOC_VIEN, ...CHON_CON_HOC_VIEN } as const;

export async function ghiChuyenDoi(p: {
  duLieu: DuLieuChuyenDoi;
  keHoach: readonly KeHoachDong[];
  ph: PhuHuynhGhi;
  sdtChuan: string;
  parentUserIdCu: string | null;
  orgUnitId: string | null;
  actor: { id: string | null; name: string };
  bayGio: Date;
  /** QLCS / Quản trị tối cao: yêu cầu học vượt được duyệt ngay. */
  tuDuyet: boolean;
}): Promise<KetQuaGhi> {
  const { duLieu, keHoach, ph, actor, bayGio } = p;
  const choDuyet: KetQuaGhi["choDuyet"] = [];
  let soDongBu = 0;

  const ganKhoan = await db.$transaction(async (tx) => {
    let parentUserId = p.parentUserIdCu;
    if (!parentUserId) {
      const u = await tx.user.create({
        data: {
          name: ph.ten || duLieu.phuHuynh.ten || "Phụ huynh",
          email: ph.email,
          phone: p.sdtChuan,
          role: "PARENT",
          roles: ["PARENT"],
          centerId: duLieu.centerId,
          isActive: true,
        },
        select: { id: true },
      });
      parentUserId = u.id;
    }

    // Ô phụ huynh nhập ở màn này — chỉ ô CÓ GIÁ TRỊ mới ghi (ô để trống không xoá dữ liệu đang có).
    const phGhi = {
      parentName: chuoi(ph.ten),
      parentEmail: chuoi(ph.email),
      parentRelation: chuoi(ph.quanHe),
      parentGender: ph.gioiTinh,
      parentDob: ph.ngaySinh,
      parentFacebookUrl: chuoi(ph.facebook),
      address: chuoi(ph.diaChi),
      city: chuoi(ph.tinh),
      ward: chuoi(ph.phuong),
    };
    const phCoGiaTri = Object.fromEntries(Object.entries(phGhi).filter(([, v]) => v !== null && v !== undefined));

    for (const k of keHoach) {
      const cu = await findExistingStudent({ parentUserId, name: k.tenBe, dob: k.ngaySinh }, tx);
      // Con khai trong phiếu lead phải CÒN và thuộc đúng lead của đơn — metadata dòng đơn là dữ liệu cũ, có thể trỏ vào con đã xoá (FK sẽ làm rollback cả lượt).
      const conCuaLead =
        duLieu.leadId && k.leadChildId
          ? await tx.leadChild.findFirst({ where: { id: k.leadChildId, leadId: duLieu.leadId }, select: { id: true } })
          : null;

      const conGhi = {
        dateOfBirth: k.ngaySinh,
        gender: k.gioiTinh,
        currentGrade: k.lopTruong,
        school: chuoi(k.truong),
      };
      const conCoGiaTri = Object.fromEntries(Object.entries(conGhi).filter(([, v]) => v !== null && v !== undefined));

      // Ảnh chụp TRƯỚC lượt ghi để `dongBoTuHocVien` biết ô nào ĐÃ ĐỔI (chỉ dội ô đã đổi sang phiếu lead và anh/chị/em).
      const truocRow = cu ? await tx.student.findUnique({ where: { id: cu }, select: PH_VA_CON_CHON }) : null;
      const truoc = (truocRow ?? Object.fromEntries(Object.keys(PH_VA_CON_CHON).map((x) => [x, null]))) as PhHocVien & ConHocVien;

      let studentId: string;
      if (cu) {
        studentId = cu;
        await tx.student.update({ where: { id: cu }, data: { ...phCoGiaTri, ...conCoGiaTri } });
      } else {
        const moi = await tx.student.create({
          data: {
            name: k.tenBe,
            studentCode: await genStudentCodeV2(duLieu.centerId ?? "", tx),
            parentUserId,
            centerId: duLieu.centerId,
            parentName: phGhi.parentName ?? (duLieu.phuHuynh.ten || null),
            parentPhone: p.sdtChuan,
            parentEmail: phGhi.parentEmail ?? duLieu.phuHuynh.email ?? null,
            ...phCoGiaTri,
            ...conCoGiaTri,
            // Lead GỐC của học viên (liên kết HV ↔ CRM). `hocVienCuaSale` đọc `lead.assignedToId` qua cột này.
            leadId: duLieu.leadId,
            leadChildId: conCuaLead?.id ?? null,
          },
          select: { id: true },
        });
        studentId = moi.id;
      }

      // Học viên CŨ chưa nối lead nào ⇒ nối vào lead của đơn này. Đã có lead gốc thì GIỮ (lượt convert sau không đè — schema `Student.leadId`).
      if (cu && duLieu.leadId) {
        await tx.student.updateMany({
          where: { id: studentId, leadId: null },
          data: { leadId: duLieu.leadId, leadChildId: conCuaLead?.id ?? null },
        });
      }

      // "Đổi 1 nơi thì đổi hết" (CLAUDE.md, 26/09/2026): hồ sơ vừa ghi ⇒ dội ô đã đổi sang phiếu lead nguồn + anh/chị/em. Cùng `tx`, `tx` KHÔNG scope.
      const hs = await tx.student.findUnique({ where: { id: studentId }, select: { leadId: true, leadChildId: true, ...PH_VA_CON_CHON } });
      if (hs?.leadId) {
        const { leadId, leadChildId, ...sau } = hs;
        await dongBoTuHocVien({ tx, studentId, leadId, leadChildId, truoc, sau: sau as PhHocVien & ConHocVien, actor });
      }

      // 09/10/2026 — học viên CŨ có thể đã có một dòng ở chính lớp này ("Xoá khỏi lớp" để lại dòng Đã huỷ / Đã rút). Hỏi cùng luật với `enrollStudent`.
      if (cu) {
        const ghiDanhCu = xetGhiDanhCu(await tx.enrollment.findFirst({ where: whereGhiDanhCu(studentId, k.classId), select: SELECT_GHI_DANH_CU }));
        const cauChan = cauChanGhiDanhCu(ghiDanhCu);
        if (cauChan) throw new Error(`${k.tenBe}: ${cauChan}`);
        if (ghiDanhCu.loai === "GO_DUOC") await goGhiDanhCuDaKetThuc(tx, ghiDanhCu.id, bayGio);
      }

      const gd = await tx.enrollment.create({
        data: {
          studentId,
          classId: k.classId,
          courseId: k.courseId,
          centerId: duLieu.centerId,
          // SALE PHỤ TRÁCH = người chăm LEAD của đơn (không phải người bấm chốt). Đơn không có lead ⇒ để trống.
          saleId: duLieu.saleId,
          // Dòng SCOPE (cờ BẬT): quyền học TRƯỚC, ghi danh active SAU ⇒ PENDING "Chờ xếp lớp" cho tới khi `hichCapQuyenHocChoDon` chốt phạm vi. Đơn thường: STUDYING.
          status: k.phamVi ? "PENDING" : "STUDYING",
          // Phạm vi buổi đã mua — cổng điểm danh (`buoi-duoc-hoc.ts`) đọc cột này. SALE NHẬP [27/10/2026]; buổi 1 ⇒ null.
          buoiBatDau: k.buoiBatDauLuu,
          enrolledAt: bayGio,
        },
        select: { id: true },
      });

      // DẤU "dòng này đã chuyển đổi" — cột có sẵn, ở đúng cấp DÒNG.
      await tx.orderItem.update({ where: { id: k.orderItemId }, data: { enrollmentId: gd.id, studentId } });

      // ── ĐỒNG Ý HÌNH ẢNH / VIDEO (NĐ 13/2023) — chuyển từ màn chốt lead cũ [27/10/2026] ──────────────────────────────────
      // ⚠️ KHÔNG lật consent đã THU HỒI: phụ huynh rút trên cổng PH thì dính cho tới khi có luồng cấp lại riêng (C6.4) — tick ở đây không phải lời re-grant.
      if (k.dongYHinhAnh) {
        const co = await tx.studentConsent.findUnique({
          where: { studentId_type: { studentId, type: "CLASS_MEDIA" } },
          select: { status: true },
        });
        if (co?.status !== "REVOKED") {
          await tx.studentConsent.upsert({
            where: { studentId_type: { studentId, type: "CLASS_MEDIA" } },
            create: { studentId, type: "CLASS_MEDIA", status: "GRANTED" },
            update: { status: "GRANTED", revokedAt: null },
          });
          await writeAudit({
            tx,
            actor,
            module: "enrollment",
            entityType: "StudentConsent",
            entityId: studentId,
            action: "CONSENT_GRANTED_AT_CONVERT",
            newValues: { type: "CLASS_MEDIA", grantedBy: actor.id, orderId: duLieu.orderId },
            orgUnitId: p.orgUnitId,
          });
        }
      }

      // ── HỌC VƯỢT BÙ [27/10/2026] — thay cho việc tự sinh phiếu học bù không qua duyệt ────────────────────────────────
      if (k.hocVuot && duLieu.centerId) {
        const yc = await taoYeuCauHocVuot(
          tx,
          {
            orderId: duLieu.orderId,
            orderItemId: k.orderItemId,
            enrollmentId: gd.id,
            studentId,
            classId: k.classId,
            courseId: k.courseId,
            centerId: duLieu.centerId,
            orgUnitId: p.orgUnitId,
            startLesson: k.hocVuot.buoiBatDau,
            sessionsToCatchUp: k.hocVuot.canBu,
            makeupSessions: k.hocVuot.soBuoiBu,
            proposedById: actor.id ?? "he-thong",
          },
          actor,
          bayGio,
        );
        if (p.tuDuyet) {
          const kq = await duyetYeuCauHocVuot(tx, yc.id, actor, bayGio, "Tự duyệt khi chuyển đổi (Quản lý cơ sở / Quản trị tối cao)");
          if (!kq.ok) throw new Error(kq.error);
          soDongBu += kq.soDongBu;
        } else {
          choDuyet.push({ requestId: yc.id, tenBe: k.tenBe, soBuoiBu: k.hocVuot.soBuoiBu, centerId: duLieu.centerId });
        }
      }
    }

    // ── GẮN KHOẢN ĐÃ THU VÀO GHI DANH [#666] ────────────────────────────────────────────────────────────────────────
    // Thiếu bước này, khoản ghi nhận có sẵn mãi `enrollmentId = NULL`. CÙNG transaction để lượt chuyển đổi và việc gắn tiền cùng thành hoặc cùng rollback.
    const gk = await ganKhoanSauChuyenDoi(tx, { orderId: duLieu.orderId, actor });

    await writeAudit({
      tx,
      actor,
      module: "orders",
      entityType: "Order",
      entityId: duLieu.orderId,
      action: "CONVERT",
      newValues: {
        maDon: duLieu.maDon,
        soCon: keHoach.length,
        saleId: duLieu.saleId,
        soDongBu,
        choDuyetHocVuot: choDuyet.length,
        ganKhoan: gk,
        dong: keHoach.map((k) => ({
          orderItemId: k.orderItemId,
          tenBe: k.tenBe,
          classId: k.classId,
          buoiBatDau: k.buoiBatDauLuu ?? 1,
          hocVuot: k.hocVuot,
          dongYHinhAnh: k.dongYHinhAnh,
        })),
      },
    });
    return gk;
  });

  return { soCon: keHoach.length, soDongBu, choDuyet, ganKhoan };
}
