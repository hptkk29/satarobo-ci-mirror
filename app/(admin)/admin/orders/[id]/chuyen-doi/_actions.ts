"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { canonicalPhone } from "@/lib/phone";
import { findExistingStudent, findParentMatch } from "@/lib/crm/dedupe";
import {
  cauChanGhiDanhCu,
  goGhiDanhCuDaKetThuc,
  SELECT_GHI_DANH_CU,
  whereGhiDanhCu,
  xetGhiDanhCu,
} from "@/lib/enrollments/ghi-danh-cu-trong-lop";
import { genStudentCodeV2 } from "@/lib/codegen";
import { docDuLieuChuyenDoi } from "@/lib/orders/chuyen-doi-don";
import { duocXep } from "@/lib/lms/xep-vao-lop";
import {
  duocChuyenDoi,
  lyDoChuaChuyenDoiDuoc,
  tienWebhookCuaDon,
} from "@/lib/payments/tien-webhook-vao-don";

// app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts — chốt chuyển đổi: tạo học viên và
// xếp vào lớp, THEO TỪNG DÒNG ĐƠN.
//
// Chủ dự án: *"mỗi con xếp riêng để có thể chọn 2 lớp riêng cho 2 con hoặc 1 con học 1
// con nghỉ"*. Nên đầu vào là một mảng dòng được CHỌN; dòng không chọn thì không đụng tới,
// và bấm lại lần sau vẫn xếp được.

const DongSchema = z.object({
  orderItemId: z.string().min(1),
  /** Tên bé. Bắt buộc — không có tên thì không tạo được hồ sơ học viên. */
  tenBe: z.string().trim().min(2, "Tên học viên tối thiểu 2 ký tự").max(120),
  /** `yyyy-MM-dd`; bỏ trống được. */
  ngaySinh: z.string().trim().optional().nullable(),
  classId: z.string().min(1, "Chưa chọn lớp"),
});

const Schema = z.object({
  orderId: z.string().min(1),
  dong: z.array(DongSchema).min(1, "Chưa chọn con nào để xếp lớp").max(20),
});

export type KetQuaChuyenDoi =
  | { ok: true; soCon: number; soPhieuHocBu: number }
  | { ok: false; error: string };

export async function chuyenDoiDonAction(input: unknown): Promise<KetQuaChuyenDoi> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  // Cổng quyền: tạo ghi danh — CÙNG quyền mà `enrollStudent` đòi. Đẻ một quyền riêng cho
  // màn này là mở một đường ghi danh thứ hai đi qua một cổng khác.
  if (!(await checkPermission("enrollments:create"))) {
    return { ok: false, error: "Không có quyền xếp học viên vào lớp" };
  }
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { orderId, dong } = parsed.data;

  const uid = session.user.id;
  const actor = await resolveActor(uid);
  const sdb = scopedDb(actor);
  // Quản trị tối cao vượt được luật TIẾN ĐỘ lớp (chủ dự án: *"chỉ admin vẫn toàn quyền
  // thêm được cho tất cả các trường hợp"*). KHÔNG vượt được sĩ số — xem dưới.
  const laAdmin = await checkPermission("enrollments:override-progress");

  // Đơn phải thuộc tầm nhìn cơ sở của actor. `findFirst` qua `scopedDb` là cổng IDOR:
  // id đơn của cơ sở khác trả `null`, không trả dữ liệu.
  const donTrongTam = await sdb.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, code: true, centerId: true },
  });
  if (!donTrongTam) return { ok: false, error: "Không tìm thấy đơn" };

  // ── CỔNG TIỀN ──────────────────────────────────────────────────────────────
  const tien = await tienWebhookCuaDon(orderId);
  if (!duocChuyenDoi(tien)) {
    return { ok: false, error: lyDoChuaChuyenDoiDuoc(tien) ?? "Đơn chưa đủ điều kiện" };
  }

  // ── MỌI CỔNG ĐỨNG TRƯỚC PHÉP GHI ĐẦU TIÊN ──────────────────────────────────
  // Luật rollback của repo: trong callback `$transaction`, `return` KHÔNG rollback. Nên
  // mọi phép TỪ CHỐI phải xong TRƯỚC khi mở transaction — kiểm giữa chừng rồi `return` là
  // để lại một nửa lượt chuyển đổi kèm thông báo "không thành công".
  const bayGio = new Date();
  const duLieu = await docDuLieuChuyenDoi(orderId, bayGio);
  if (!duLieu) return { ok: false, error: "Không đọc được dữ liệu đơn" };

  const theoDong = new Map(duLieu.dong.map((d) => [d.orderItemId, d]));
  type KeHoach = {
    orderItemId: string;
    tenBe: string;
    ngaySinh: Date | null;
    classId: string;
    courseId: string;
    buoiBatDau: number | null;
    /** Buổi bé phải học bù (chỉ ca `hoc_vuot`). */
    soBuoiHocVuot: number;
  };
  const keHoach: KeHoach[] = [];

  for (const d of dong) {
    const goc = theoDong.get(d.orderItemId);
    if (!goc) return { ok: false, error: "Dòng đơn không thuộc đơn này" };
    if (goc.enrollmentId) {
      return { ok: false, error: `"${goc.tenDong}" đã được chuyển đổi trước đó.` };
    }
    if (!goc.courseId) {
      return { ok: false, error: `"${goc.tenDong}" không phải dòng khoá học — không xếp lớp được.` };
    }
    const lop = goc.lop.find((l) => l.id === d.classId);
    if (!lop) {
      return { ok: false, error: `Lớp đã chọn không hợp lệ cho "${goc.tenDong}".` };
    }
    // Sĩ số: KHÔNG ai vượt được, kể cả Quản trị tối cao — `enrollStudent` từ chối
    // `CLASS_FULL` vô điều kiện, và ở đây cũng vậy để hai đường nói cùng một câu.
    if (lop.daDay) {
      return { ok: false, error: `Lớp "${lop.ten}" đã đủ ${lop.siSoToiDa} chỗ.` };
    }
    if (!duocXep(lop.xet, laAdmin)) {
      return { ok: false, error: `${lop.ten} — ${lop.xet.cau}` };
    }
    keHoach.push({
      orderItemId: d.orderItemId,
      tenBe: d.tenBe,
      ngaySinh: d.ngaySinh ? new Date(`${d.ngaySinh}T00:00:00.000Z`) : null,
      classId: d.classId,
      courseId: goc.courseId,
      buoiBatDau: lop.xet.buoiBatDau && lop.xet.buoiBatDau > 1 ? lop.xet.buoiBatDau : null,
      soBuoiHocVuot: lop.xet.soBuoiHocVuot,
    });
  }

  // Phụ huynh: tra TRƯỚC transaction (chỉ đọc), tạo BÊN TRONG nếu chưa có.
  const sdtChuan = canonicalPhone(duLieu.phuHuynh.sdt) ?? duLieu.phuHuynh.sdt;
  const khop = await findParentMatch({
    email: duLieu.phuHuynh.email,
    phone: duLieu.phuHuynh.sdt,
  });
  // Ba nhánh khử trùng phụ huynh (SRS §8.4, `classifyParentMatch`):
  //   none    → tạo tài khoản mới trong transaction;
  //   reuse   → dùng lại hồ sơ đã có;
  //   conflict→ email thuộc phụ huynh A, SĐT thuộc phụ huynh B ⇒ CHẶN, người thật phải
  //             gộp hai hồ sơ trước. Tự chọn một bên là gắn con vào nhầm gia đình, và
  //             `convertLeadV2` cũng chặn đúng ca này.
  if (khop.kind === "conflict") {
    return {
      ok: false,
      error:
        "Email và số điện thoại của đơn đang thuộc HAI hồ sơ phụ huynh khác nhau — " +
        "gộp hai hồ sơ đó trước rồi chuyển đổi lại.",
    };
  }
  const parentUserIdCu = khop.kind === "reuse" ? khop.userId : null;

  // Buổi đã qua của từng lớp — để sinh phiếu học bù đúng buổi nào. Đọc trước transaction
  // (chỉ đọc, và giữ transaction ngắn: trần tương tác của Prisma là 5 giây).
  const classIds = [...new Set(keHoach.filter((k) => k.soBuoiHocVuot > 0).map((k) => k.classId))];
  const buoiDaQuaTheoLop = new Map<string, { id: string; lessonId: string | null }[]>();
  if (classIds.length > 0) {
    const rows = await sdb.classSession.findMany({
      where: { classId: { in: classIds }, date: { lte: bayGio } },
      select: { id: true, classId: true, lessonId: true },
      orderBy: { date: "asc" },
    });
    for (const r of rows) {
      const ds = buoiDaQuaTheoLop.get(r.classId) ?? [];
      ds.push({ id: r.id, lessonId: r.lessonId });
      buoiDaQuaTheoLop.set(r.classId, ds);
    }
  }

  const { actorId, actorName } = getAuditActor(session);
  let soPhieuHocBu = 0;

  try {
    await sdb.$transaction(async (txRaw) => {
      // A0-04 — `tx` từ extended client của `scopedDb` KHÔNG structurally-assignable vào
      // `Prisma.TransactionClient`. Ép kiểu là TIỀN LỆ của repo (xem `orders/_actions.ts`,
      // `students`, `classes`); cấu trúc transaction giữ nguyên.
      const tx = txRaw as unknown as Prisma.TransactionClient;
      let parentUserId = parentUserIdCu;
      if (!parentUserId) {
        const u = await tx.user.create({
          data: {
            name: duLieu.phuHuynh.ten || "Phụ huynh",
            email: duLieu.phuHuynh.email,
            phone: sdtChuan,
            role: "PARENT",
            roles: ["PARENT"],
            centerId: duLieu.centerId,
            isActive: true,
          },
          select: { id: true },
        });
        parentUserId = u.id;
      }

      for (const k of keHoach) {
        // Dùng lại học viên cũ của CÙNG phụ huynh nếu trùng tên + ngày sinh — cùng phép
        // khử trùng mà `convertLeadV2` dùng, không chế bản thứ hai.
        const cu = await findExistingStudent(
          { parentUserId, name: k.tenBe, dob: k.ngaySinh },
          tx,
        );
        const studentId =
          cu ??
          (
            await tx.student.create({
              data: {
                name: k.tenBe,
                studentCode: await genStudentCodeV2(duLieu.centerId ?? "", tx),
                dateOfBirth: k.ngaySinh,
                parentUserId,
                centerId: duLieu.centerId,
                parentName: duLieu.phuHuynh.ten || null,
                parentPhone: sdtChuan,
                parentEmail: duLieu.phuHuynh.email,
              },
              select: { id: true },
            })
          ).id;

        // 09/10/2026 — học viên CŨ có thể đã có một dòng ở chính lớp này ("Xoá khỏi lớp" để lại
        // dòng Đã huỷ / Đã rút, chưa xoá mềm). Trước đây `enrollment.create` nổ P2002 thô ở chỉ
        // mục duy nhất. Nay hỏi cùng luật với `enrollStudent`: sạch ⇒ gỡ; còn lại ⇒ ném (rollback).
        if (cu) {
          const ghiDanhCu = xetGhiDanhCu(
            await tx.enrollment.findFirst({
              where: whereGhiDanhCu(studentId, k.classId),
              select: SELECT_GHI_DANH_CU,
            }),
          );
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
            status: "STUDYING",
            // Phạm vi buổi đã mua — cổng điểm danh (`buoi-duoc-hoc.ts`) đọc cột này.
            buoiBatDau: k.buoiBatDau,
            enrolledAt: bayGio,
          },
          select: { id: true },
        });

        // DẤU "dòng này đã chuyển đổi" — cột có sẵn, ở đúng cấp DÒNG.
        await tx.orderItem.update({
          where: { id: k.orderItemId },
          data: { enrollmentId: gd.id, studentId },
        });

        // ── HỌC VƯỢT ⇒ PHIẾU HỌC BÙ ──────────────────────────────────────────
        // Chủ dự án chọn "tự sinh phiếu học bù". `@@unique([studentId, missedSessionId])`
        // chống trùng, nên chạy lại không nhân đôi.
        if (k.soBuoiHocVuot > 0) {
          const buoi = (buoiDaQuaTheoLop.get(k.classId) ?? []).slice(0, k.soBuoiHocVuot);
          for (const b of buoi) {
            await tx.makeupNeed.create({
              data: {
                studentId,
                classId: k.classId,
                centerId: duLieu.centerId,
                missedSessionId: b.id,
                missedLessonId: b.lessonId,
                status: "PENDING",
                note: `Học vượt — vào lớp sau khi lớp đã học ${k.soBuoiHocVuot} buổi (đơn ${duLieu.maDon}).`,
                createdById: actorId,
              },
            });
            soPhieuHocBu++;
          }
        }
      }

      await writeAudit({
        tx,
        actor: { id: actorId, name: actorName },
        module: "orders",
        entityType: "Order",
        entityId: orderId,
        action: "CONVERT",
        newValues: {
          maDon: duLieu.maDon,
          soCon: keHoach.length,
          soPhieuHocBu,
          dong: keHoach.map((k) => ({
            orderItemId: k.orderItemId,
            tenBe: k.tenBe,
            classId: k.classId,
            buoiBatDau: k.buoiBatDau,
            soBuoiHocVuot: k.soBuoiHocVuot,
          })),
        },
      });
    });
  } catch (e) {
    return {
      ok: false,
      error: `Không chuyển đổi được: ${e instanceof Error ? e.message : "lỗi không rõ"}`,
    };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/chuyen-doi`);
  revalidatePath("/enrollments");
  return { ok: true, soCon: keHoach.length, soPhieuHocBu };
}
