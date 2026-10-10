import "server-only";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { laBaoLuuBat, LOI_BAO_LUU_TAT } from "@/lib/bao-luu/feature";
import { taoPolicySnapshot } from "@/lib/bao-luu/hoso";
import { chuyenTrangThai, datPausedKhiBatDau, taoHoSoCho } from "@/lib/bao-luu/chuyen-trang-thai";
import { coHoSoMoChoGhiDanh, docChinhSach } from "@/lib/bao-luu/ngu-canh-db";
import { dungAnhChupKhiBatDau } from "@/lib/bao-luu/anh-chup-db";
import { dich, LoiNhieu, type KetQua, type NguoiLam } from "@/lib/bao-luu/dich-vu";

// lib/bao-luu/tam-dung-lop.ts — TRUNG TÂM TẠM DỪNG CẢ LỚP (loại CENTER, BR-23). PHIÊN 6.
//
// MỘT giao dịch cho CẢ lớp: học viên thứ N hỏng ⇒ cuộn ngược TẤT CẢ (TC-16 — "tạm dừng lớp 12 HV hỏng ở HV thứ 7 → rollback cả 12"). Không bao giờ để một nửa
// lớp bị tạm dừng còn nửa kia thì không. Mọi học viên đủ điều kiện nhận một hồ sơ riêng loại CENTER, đi thẳng PENDING → APPROVED → ACTIVE (không đơn, không
// maker–checker: người giữ `bao-luu:center-pause` chính là Quản lý cơ sở / Admin — K11), có ảnh chụp quyền lợi tại START như hồ sơ thường.
//
// Học viên KHÔNG đủ điều kiện (đã có hồ sơ mở; ghi danh không đang học) bị BỎ QUA và LIỆT KÊ ra — không âm thầm, không làm hỏng cả lô.
// Khoá `allowPause = false` thì từ chối cả lớp (fail-closed; xem K11).
//
// ⚠️ KHÔNG đổi trạng thái lớp và KHÔNG huỷ buổi: lịch lớp là việc của công cụ quản lý lớp. Hồ sơ chỉ nói "học viên nghỉ vì Trung tâm" (BR-23).

const TX = { timeout: 120_000, maxWait: 10_000 } as const;
const TRANG_THAI_DANG_HOC = ["ACTIVE", "STUDYING"] as const;

export type KetQuaTamDungLop = {
  soHocVien: number;
  reserveIds: string[];
  boQua: { studentId: string; ten: string; lyDo: string }[];
};

export async function tamDungLop(
  input: { classId: string; ngayMoLai: Date | null; lyDo: string },
  nguoi: NguoiLam,
  now: Date,
): Promise<KetQua<KetQuaTamDungLop>> {
  const lyDo = input.lyDo.trim();
  if (lyDo.length < 5) return { ok: false, loi: ["Ghi lý do tạm dừng lớp (ít nhất 5 ký tự)."] };
  if (input.ngayMoLai && input.ngayMoLai.getTime() <= now.getTime()) return { ok: false, loi: ["Ngày dự kiến mở lại phải sau hôm nay."] };
  try {
    return await db.$transaction(async (tx) => {
      const lop = await tx.class.findFirst({
        where: { id: input.classId, deletedAt: null },
        select: { id: true, name: true, centerId: true, orgUnitId: true, course: { select: { allowPause: true, name: true } } },
      });
      if (!lop) throw new LoiNhieu(["Không tìm thấy lớp."]);
      if (!lop.centerId) throw new LoiNhieu(["Lớp chưa thuộc cơ sở nào."]);
      const donVi = lop.orgUnitId ?? (await orgUnitIdForCenter(lop.centerId));
      if (!(await laBaoLuuBat(donVi))) throw new LoiNhieu([LOI_BAO_LUU_TAT]);
      if (!lop.course.allowPause) throw new LoiNhieu([`Khoá "${lop.course.name}" không áp dụng bảo lưu.`]);

      const cs = await docChinhSach(donVi);
      const gd = await tx.enrollment.findMany({
        where: { classId: lop.id, deletedAt: null, status: { in: [...TRANG_THAI_DANG_HOC] }, student: { deletedAt: null } },
        select: { id: true, studentId: true, student: { select: { name: true } } },
        orderBy: { student: { name: "asc" } },
      });
      if (gd.length === 0) throw new LoiNhieu(["Lớp không có học viên đang học để tạm dừng."]);

      const ids: string[] = [];
      const boQua: KetQuaTamDungLop["boQua"] = [];
      for (const g of gd) {
        if (await coHoSoMoChoGhiDanh(tx, { enrollmentId: g.id, studentId: g.studentId, now })) {
          boQua.push({ studentId: g.studentId, ten: g.student.name, lyDo: "Đã có hồ sơ bảo lưu đang mở" });
          continue;
        }
        const r = await taoHoSoCho(tx, {
          actor: nguoi, now, note: lyDo,
          data: {
            studentId: g.studentId, enrollmentId: g.id, centerId: lop.centerId, type: "CENTER", reason: lyDo, reasonCode: "OTHER", reasonNote: lyDo,
            startedAt: now, expectedEndAt: input.ngayMoLai, createdByUserId: nguoi.id, createdByName: nguoi.name,
          },
        });
        // PENDING → APPROVED
        await chuyenTrangThai(tx, {
          reserveId: r.id, den: "APPROVED", actor: nguoi, now, kind: "APPROVE", note: "Trung tâm tạm dừng lớp",
          patch: { approvedAt: now, approvedById: nguoi.id, startedAt: now, standardEndDate: input.ngayMoLai, policySnapshot: taoPolicySnapshot(cs, now, donVi) },
        });
        // APPROVED → ACTIVE (+ PAUSED + chat) với ảnh chụp quyền lợi.
        const pc = await datPausedKhiBatDau(tx, {
          hoSo: { id: r.id, studentId: g.studentId, enrollmentId: g.id, centerId: lop.centerId, orgUnitId: donVi },
          actor: nguoi, now, lyDo: `Trung tâm tạm dừng lớp: ${lyDo}`,
        });
        await chuyenTrangThai(tx, {
          reserveId: r.id, den: "ACTIVE", actor: nguoi, now, kind: "START",
          patch: await dungAnhChupKhiBatDau(tx, { enrollmentId: g.id, studentId: g.studentId, startedAt: now }),
          sauThem: { enrollmentStatusTruoc: pc.enrollmentTruoc, tamDungLop: lop.id },
        });
        ids.push(r.id);
      }
      if (ids.length === 0) throw new LoiNhieu(["Không có học viên nào đủ điều kiện (tất cả đã có hồ sơ bảo lưu đang mở)."]);

      await publishEvent(
        "bao-luu.tam-dung-lop",
        { classId: lop.id, centerId: lop.centerId, soHocVien: ids.length, reserveIds: ids },
        { tx, dedupeKey: `bao-luu.tam-dung-lop:${lop.id}:${now.toISOString()}` },
      );
      return { ok: true as const, data: { soHocVien: ids.length, reserveIds: ids, boQua } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}
