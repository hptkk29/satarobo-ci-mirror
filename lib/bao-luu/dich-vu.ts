import "server-only";
import type { Prisma, StudentReserveReason } from "@prisma/client";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { hanToiDaBaoLuu } from "@/lib/bao-luu/tran-bao-luu";
import { laBaoLuuBat, LOI_BAO_LUU_TAT } from "@/lib/bao-luu/feature";
import { vnStartOfDay } from "@/lib/time/vn";
import {
  chanDuyetSom,
  chanDuyetVeNo,
  chanTuDuyet,
  kiemLapHoSo,
  taoPolicySnapshot,
  tinhNgayBatDau,
  type ChinhSach,
} from "@/lib/bao-luu/hoso";
import {
  chuyenTrangThai,
  datPausedKhiBatDau,
  LoiBaoLuu,
  taoHoSoCho,
} from "@/lib/bao-luu/chuyen-trang-thai";
import { khoBaoLuuDaCauHinh, xacMinhTepBaoLuu } from "@/lib/bao-luu/kho-tep";
import { docChinhSach, demBuoiTuNgay, demLanDaDung, docKhoanDenHan, coHoSoMoChoGhiDanh } from "@/lib/bao-luu/ngu-canh-db";
import { laKhoaTepBaoLuu, TRAN_SO_MINH_CHUNG, type LoaiTepBaoLuu } from "@/lib/bao-luu/tep";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { dungAnhChupKhiBatDau } from "@/lib/bao-luu/anh-chup-db";
import { chuyenTrangThaiDong } from "@/lib/hoc-bu/dong-service";

// =============================================================================
// DỊCH VỤ BẢO LƯU — LẬP · DUYỆT · TỪ CHỐI · HUỶ (Phiên 3). Không biết gì về session/HTTP: người gọi (server action)
// ĐÃ kiểm đăng nhập + quyền + tầm nhìn cơ sở; hàm ở đây kiểm CÔNG TẮC `pause.enabled`, maker–checker và mọi luật nghiệp
// vụ BR-xx rồi ghi TRONG MỘT GIAO DỊCH. Mọi cổng đứng TRƯỚC phép ghi đầu tiên; từ chối = `throw` (rollback trọn).
//
// `now` là THAM SỐ (luật 19). Không hàm nào ghi dòng tiền — phần tiền của bảo lưu là Phiên 6.
// =============================================================================

export type NguoiLam = { id: string; name: string };

export type KetQua<T> = { ok: true; data: T } | { ok: false; loi: string[]; ma?: string };

/** Nhiều lỗi nghiệp vụ một lượt — nổi lên để rollback, rồi biến thành `{ ok:false, loi }`. */
export class LoiNhieu extends Error {
  constructor(public readonly loi: string[]) {
    super(loi.join(" | "));
  }
}

export type PhuThuoc = {
  /** Xác minh tệp trong kho (HEAD + vân tay). Tiêm được để test không cần R2. */
  xacMinhTep: (khoa: string) => Promise<{ ok: true } | { ok: false; thongDiep: string }>;
  khoDaCauHinh: () => boolean;
};

const loaiTuKhoa = (khoa: string): LoaiTepBaoLuu => khoa.split(".").pop() as LoaiTepBaoLuu;

export const PHU_THUOC_MAC_DINH: PhuThuoc = {
  xacMinhTep: async (khoa) => {
    const r = await xacMinhTepBaoLuu({ khoa, loai: loaiTuKhoa(khoa) });
    return r.ok ? { ok: true } : { ok: false, thongDiep: r.thongDiep };
  },
  khoDaCauHinh: khoBaoLuuDaCauHinh,
};

export function dich<T>(err: unknown): KetQua<T> {
  if (err instanceof LoiNhieu) return { ok: false, loi: err.loi };
  if (err instanceof LoiBaoLuu) return { ok: false, loi: [err.message], ma: err.ma };
  // Trùng chỉ mục duy nhất "một ghi danh một hồ sơ mở" (đua giữa hai người lập cùng lúc).
  if (typeof err === "object" && err && "code" in err && (err as { code?: string }).code === "P2002") {
    return { ok: false, loi: ["Ghi danh này vừa có hồ sơ bảo lưu khác được lập — tải lại trang."], ma: "DA_THAY_DOI" };
  }
  throw err;
}

async function donViCuaHocVien(s: { orgUnitId: string | null; centerId: string | null }): Promise<string | null> {
  return s.orgUnitId ?? (s.centerId ? await orgUnitIdForCenter(s.centerId) : null);
}

// ─────────────────────────────────────────────────────────────────────────────
// LẬP
// ─────────────────────────────────────────────────────────────────────────────

export type LapInput = {
  studentId: string;
  /** Mỗi ghi danh MỘT hồ sơ — "bảo lưu cả học viên" trên UI = nhiều ghi danh trong một giao dịch. */
  enrollmentIds: string[];
  reasonCode: StudentReserveReason | null;
  reasonNote: string;
  expectedReturnDate: Date | null;
  firstAbsentDate: Date | null;
  /** Ngày bắt đầu HẸN TRƯỚC (tương lai) — `kiemLapHoSo` quyết hợp lệ; duyệt sớm hơn ngày này bị chặn (`chanDuyetSom`). `null` = bắt đầu khi duyệt. */
  ngayBatDau?: Date | null;
  applicationFileKey: string | null;
  evidenceFileKeys: string[];
  /** Chỉ người có `bao-luu:exception`; người gọi PHẢI đã kiểm quyền trước khi truyền. */
  vuotTran: { lyDo: string } | null;
  /**
   * C12 (vòng 2 nghiệm thu): hồ sơ được lập TỪ yêu cầu "Bảo lưu" của phụ huynh ở cổng PH. Cùng giao dịch: yêu cầu chuyển 'Đã xử lý' (`APPROVED`), gắn `reserveId`
   * (hồ sơ đầu tiên nếu lập nhiều khoá) và ghi người xử lý. Yêu cầu phải thuộc ĐÚNG học viên, loại `RESERVE`, còn `PENDING` — id đến từ trình duyệt.
   */
  parentRequestId?: string | null;
};

export async function lapHoSo(
  input: LapInput,
  nguoi: NguoiLam,
  now: Date,
  deps: PhuThuoc = PHU_THUOC_MAC_DINH,
): Promise<KetQua<{ reserveIds: string[]; canhBao: string[] }>> {
  const loiHinhThuc: string[] = [];
  if (input.enrollmentIds.length === 0) loiHinhThuc.push("Chọn ít nhất một ghi danh để bảo lưu.");
  if (new Set(input.enrollmentIds).size !== input.enrollmentIds.length) loiHinhThuc.push("Có ghi danh bị chọn trùng.");
  if (input.evidenceFileKeys.length > TRAN_SO_MINH_CHUNG) loiHinhThuc.push(`Tối đa ${TRAN_SO_MINH_CHUNG} tệp minh chứng.`);
  const caKhoa = [input.applicationFileKey, ...input.evidenceFileKeys].filter((k): k is string => !!k);
  if (caKhoa.some((k) => !laKhoaTepBaoLuu(k))) loiHinhThuc.push("Tệp đính kèm không hợp lệ — hãy tải lại bằng nút chọn tệp.");
  if (new Set(caKhoa).size !== caKhoa.length) loiHinhThuc.push("Một tệp bị đính kèm hai lần.");
  if (loiHinhThuc.length > 0) return { ok: false, loi: loiHinhThuc };

  // A1b (nghiệm thu vòng 2): CỜ đứng TRƯỚC kho tệp. Trước đây cổng kho (và bước HEAD R2 cho từng khoá) chạy trước cổng cờ trong giao dịch, nên cờ TẮT mà kho chưa
  // cấu hình thì người gọi nhận "Kho tệp chưa cấu hình" thay vì "chưa được bật", và khi kho đã cấu hình thì một khoá tệp giả vẫn đi tới bước gọi R2 trước khi gặp cờ.
  // Đây chỉ là cổng SỚM cho lời từ chối đúng chỗ + không tốn I/O; cổng cờ trong giao dịch giữ nguyên (nơi quyết định cuối).
  if (caKhoa.length > 0) {
    const hvSom = await db.student.findFirst({ where: { id: input.studentId, deletedAt: null }, select: { orgUnitId: true, centerId: true } });
    if (!hvSom) return { ok: false, loi: ["Không tìm thấy học viên."] };
    if (!(await laBaoLuuBat(await donViCuaHocVien(hvSom)))) return { ok: false, loi: [LOI_BAO_LUU_TAT] };
  }

  // Kho/R2 là I/O chậm — làm TRƯỚC giao dịch để không giữ khoá lâu. Kết quả chỉ là cổng, không phải phép ghi.
  if (caKhoa.length > 0) {
    if (!deps.khoDaCauHinh()) return { ok: false, loi: ["Kho tệp bảo lưu chưa cấu hình — báo người vận hành."] };
    for (const k of caKhoa) {
      const r = await deps.xacMinhTep(k);
      if (!r.ok) return { ok: false, loi: [r.thongDiep] };
    }
  }

  try {
    return await db.$transaction(
      async (tx) => {
        const hv = await tx.student.findFirst({
          where: { id: input.studentId, deletedAt: null },
          select: { id: true, name: true, centerId: true, orgUnitId: true },
        });
        if (!hv) throw new LoiNhieu(["Không tìm thấy học viên."]);
        if (!hv.centerId) throw new LoiNhieu(["Học viên chưa thuộc cơ sở nào — gán cơ sở rồi lập bảo lưu."]);
        const donVi = await donViCuaHocVien(hv);
        if (!(await laBaoLuuBat(donVi))) throw new LoiNhieu([LOI_BAO_LUU_TAT]);

        // C12: yêu cầu của phụ huynh (nếu lập từ nó) — cổng đứng TRƯỚC phép ghi đầu tiên.
        if (input.parentRequestId) {
          const yc = await tx.parentRequest.findUnique({ where: { id: input.parentRequestId }, select: { studentId: true, type: true, status: true } });
          if (!yc || yc.studentId !== hv.id) throw new LoiNhieu(["Không tìm thấy yêu cầu của phụ huynh cho học viên này."]);
          if (yc.type !== "RESERVE") throw new LoiNhieu(["Đây không phải yêu cầu bảo lưu của phụ huynh."]);
          if (yc.status !== "PENDING") throw new LoiNhieu(["Yêu cầu của phụ huynh này đã được xử lý."]);
        }

        const cs: ChinhSach = await docChinhSach(donVi);
        const gd = await tx.enrollment.findMany({
          where: { id: { in: input.enrollmentIds } },
          select: {
            id: true, studentId: true, status: true, deletedAt: true,
            course: { select: { name: true, allowPause: true } },
            class: { select: { name: true } },
          },
        });
        const loi: string[] = [];
        const canhBao: string[] = [];
        const bangGd = new Map(gd.map((g) => [g.id, g]));
        for (const id of input.enrollmentIds) {
          const g = bangGd.get(id);
          // IDOR: ghi danh PHẢI thuộc đúng học viên đang lập — id đến từ trình duyệt.
          if (!g || g.studentId !== hv.id) {
            loi.push("Có ghi danh không thuộc học viên này.");
            continue;
          }
          const ten = `${g.course.name} — ${g.class.name}`;
          const kq = kiemLapHoSo(
            {
              reasonCode: input.reasonCode,
              reasonNote: input.reasonNote,
              expectedReturnDate: input.expectedReturnDate,
              firstAbsentDate: input.firstAbsentDate,
              ngayBatDau: input.ngayBatDau ?? null,
              coDon: !!input.applicationFileKey,
              soMinhChung: input.evidenceFileKeys.length,
              vuotTran: input.vuotTran,
            },
            {
              now,
              khoaChoPhep: g.course.allowPause,
              trangThaiGhiDanh: g.status,
              daXoa: !!g.deletedAt,
              soLanDaDung: await demLanDaDung(tx, g.id),
              coHoSoMo: await coHoSoMoChoGhiDanh(tx, { enrollmentId: g.id, studentId: hv.id, now }),
              chinhSach: cs,
            },
          );
          if (!kq.ok) loi.push(...kq.loi.map((l) => (input.enrollmentIds.length > 1 ? `${ten}: ${l}` : l)));
          else canhBao.push(...kq.canhBao);
          // TODO(bao-luu Q-debt-at-create): nợ quá hạn chỉ CẢNH BÁO lúc lập, CHẶN cứng lúc duyệt (BR-06 nói "chặn duyệt").
          // Chặn ngay lúc lập thì phụ huynh nộp đơn xong mới biết — và Sale không còn chỗ ghi nhận đơn đã nhận.
          const noLuc = chanDuyetVeNo(await docKhoanDenHan(tx, { enrollmentId: g.id, studentId: hv.id, now }), cs.maxOverdueDebtDays, now);
          if (noLuc) canhBao.push(`${ten}: ${noLuc} Quản lý sẽ chưa duyệt được cho tới khi thu đủ.`);
        }
        // ── HẾT CỔNG. Từ đây là phép ghi. ───────────────────────────────────────
        if (loi.length > 0) throw new LoiNhieu([...new Set(loi)]);

        const ids: string[] = [];
        for (const id of input.enrollmentIds) {
          const r = await taoHoSoCho(tx, {
            actor: nguoi,
            now,
            note: input.reasonNote.trim() || null,
            data: {
              studentId: hv.id,
              enrollmentId: id,
              centerId: hv.centerId,
              type: "PARENT",
              reason: input.reasonNote.trim() || (input.reasonCode ?? "OTHER"),
              reasonCode: input.reasonCode,
              reasonNote: input.reasonNote.trim() || null,
              // Hẹn trước (tương lai) ⇒ PENDING mang ngày đó; còn lại như cũ (= lúc lập). Duyệt sẽ ghi lại ngày bắt đầu THẬT.
              startedAt: input.ngayBatDau && vnStartOfDay(input.ngayBatDau).getTime() > vnStartOfDay(now).getTime() ? vnStartOfDay(input.ngayBatDau) : now,
              expectedEndAt: input.expectedReturnDate,
              firstAbsentDate: input.firstAbsentDate,
              applicationFileKey: input.applicationFileKey,
              evidenceFileKeys: input.evidenceFileKeys,
              createdByUserId: nguoi.id,
              createdByName: nguoi.name,
            },
          });
          ids.push(r.id);
        }
        if (input.parentRequestId) {
          // `updateMany` CÓ ĐIỀU KIỆN `PENDING`: hai người cùng lập từ một yêu cầu ⇒ người sau đổi 0 dòng ⇒ throw ⇒ cuộn ngược hồ sơ vừa tạo (không để hai hồ sơ
          // cho một yêu cầu).
          const chuyen = await tx.parentRequest.updateMany({
            where: { id: input.parentRequestId, status: "PENDING" },
            data: {
              status: "APPROVED",
              reserveId: ids[0],
              response: "Cơ sở đã tiếp nhận yêu cầu bảo lưu của bạn và lập hồ sơ — đang chờ Quản lý cơ sở duyệt. Học viên vẫn học bình thường cho tới khi hồ sơ được duyệt.",
              handledById: nguoi.id,
              handledByName: nguoi.name,
              handledAt: now,
            },
          });
          if (chuyen.count === 0) throw new LoiNhieu(["Yêu cầu của phụ huynh vừa được người khác xử lý — tải lại trang."]);
        }
        return { ok: true as const, data: { reserveIds: ids, canhBao } };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (err) {
    return dich(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DUYỆT
// ─────────────────────────────────────────────────────────────────────────────

export type DuyetInput = {
  reserveId: string;
  /** Duyệt KÈM lùi ngày bắt đầu về buổi nghỉ đầu tiên (BR-09). `false` = bắt đầu từ ngày duyệt. */
  lui: boolean;
  ghiChu?: string | null;
};

export type KetQuaDuyet = { reserveId: string; startedAt: Date; standardEndDate: Date; soBuoiLui: number; classId: string | null };

export async function duyetHoSo(input: DuyetInput, nguoi: NguoiLam, now: Date): Promise<KetQua<KetQuaDuyet>> {
  try {
    return await db.$transaction(
      async (tx) => {
        const hs = await tx.studentReserve.findUnique({
          where: { id: input.reserveId },
          select: {
            id: true, status: true, type: true, studentId: true, enrollmentId: true, centerId: true, orgUnitId: true,
            createdByUserId: true, applicationFileKey: true, firstAbsentDate: true, startedAt: true,
            enrollment: {
              select: {
                id: true, status: true, classId: true, deletedAt: true,
                course: { select: { allowPause: true } },
              },
            },
          },
        });
        if (!hs) throw new LoiNhieu(["Không tìm thấy hồ sơ bảo lưu."]);
        if (!(await laBaoLuuBat(hs.orgUnitId))) throw new LoiNhieu([LOI_BAO_LUU_TAT]);
        if (hs.status !== "PENDING") throw new LoiNhieu(["Hồ sơ không còn ở trạng thái chờ duyệt."]);

        // ── CỔNG ───────────────────────────────────────────────────────────────
        const mc = chanTuDuyet(nguoi.id, hs.createdByUserId);
        if (mc) throw new LoiNhieu([mc]);
        // C7c: hồ sơ hẹn ngày bắt đầu tương lai thì chưa duyệt được trước ngày đó (không có trạng thái "đã duyệt, chờ ngày").
        const som = chanDuyetSom(hs.startedAt, now);
        if (som) throw new LoiNhieu([som]);
        if (!hs.enrollmentId || !hs.enrollment || hs.enrollment.deletedAt) throw new LoiNhieu(["Ghi danh của hồ sơ không còn."]);
        const loi: string[] = [];
        if (!hs.enrollment.course.allowPause) loi.push("Khoá học này không còn áp dụng bảo lưu.");
        if (hs.enrollment.status !== "ACTIVE" && hs.enrollment.status !== "STUDYING") {
          loi.push("Ghi danh không còn đang học — không duyệt bảo lưu được.");
        }
        // BR-07: đơn đã ký bắt buộc (CENTER không cần — Phiên 6).
        if (hs.type !== "CENTER" && !hs.applicationFileKey) loi.push("Hồ sơ chưa có đơn bảo lưu đã ký.");

        const cs = await docChinhSach(hs.orgUnitId);
        // BR-06 — kiểm LẠI tại lúc duyệt (không tin lúc lập).
        const noQuaHan = chanDuyetVeNo(await docKhoanDenHan(tx, { enrollmentId: hs.enrollmentId, studentId: hs.studentId, now }), cs.maxOverdueDebtDays, now);
        if (noQuaHan) loi.push(noQuaHan);

        // BR-09 — ngày bắt đầu.
        if (input.lui && !hs.firstAbsentDate) loi.push("Hồ sơ không khai buổi nghỉ đầu tiên nên không lùi ngày được.");
        const soBuoi = input.lui && hs.firstAbsentDate
          ? await demBuoiTuNgay(tx, { classId: hs.enrollment.classId, tuNgay: hs.firstAbsentDate, now })
          : 0;
        const ngay = tinhNgayBatDau({
          now,
          firstAbsentDate: input.lui ? hs.firstAbsentDate : null,
          soBuoiTuNgayDauDenNay: soBuoi,
          backdateMaxSessions: cs.backdateMaxSessions,
        });
        if (!ngay.ok) loi.push(ngay.loi);
        if (loi.length > 0 || !ngay.ok) throw new LoiNhieu(loi);

        // ── HẾT CỔNG. Từ đây là phép ghi. ──────────────────────────────────────
        const standardEndDate = hanToiDaBaoLuu(ngay.startedAt, cs.maxMonths);
        await chuyenTrangThai(tx, {
          reserveId: hs.id,
          den: "APPROVED",
          actor: nguoi,
          now,
          kind: "APPROVE",
          note: input.ghiChu ?? null,
          patch: {
            approvedAt: now,
            approvedById: nguoi.id,
            startedAt: ngay.startedAt,
            standardEndDate,
            policySnapshot: taoPolicySnapshot(cs, now, hs.orgUnitId) as Prisma.InputJsonValue,
          },
          sauThem: { startedAt: ngay.startedAt.toISOString(), soBuoiLui: ngay.soBuoiLui },
        });
        // Ngày bắt đầu = ngày duyệt hoặc đã lùi về QUÁ KHỨ ⇒ không có gì phải chờ: START ngay trong cùng giao dịch.
        // (Cron Phiên 5 vẫn quét APPROVED có startDate ≤ hôm nay làm lưới an toàn.)
        const pc = await datPausedKhiBatDau(tx, {
          hoSo: { id: hs.id, studentId: hs.studentId, enrollmentId: hs.enrollmentId, centerId: hs.centerId, orgUnitId: hs.orgUnitId },
          actor: nguoi,
          now,
          lyDo: "Bắt đầu bảo lưu",
        });
        // BR-09: các buổi trong khoảng LÙI NGÀY "không tính vắng, không trừ hạn mức bù" — nhu cầu bù PENDING đã sinh cho chúng
        // phải thu hồi (CHỈ PENDING: đã hẹn buổi bù / đã học bù thì giữ nguyên, người xếp bù tự xử lý). Sau này không sinh thêm:
        // `createMakeupNeed` tự bỏ qua buổi nằm trong khoảng bảo lưu.
        let needDaHuy = 0;
        if (ngay.soBuoiLui > 0) {
          const buoiLui = await tx.classSession.findMany({
            where: { classId: hs.enrollment.classId, date: { gte: ngay.startedAt, lte: now } },
            select: { id: true },
          });
          if (buoiLui.length > 0) {
            // T05: mọi chuyển trạng thái dòng cần bù đi qua MỘT hàm (bảng cạnh hợp lệ + điều kiện trạng thái). `chiNeuCo`: hàng đổi giữa chừng
            // (vừa được xếp case) thì bỏ qua hàng đó, không làm hỏng cả lần duyệt.
            const dongPending = await tx.makeupNeed.findMany({
              where: { studentId: hs.studentId, missedSessionId: { in: buoiLui.map((b) => b.id) }, status: "PENDING" },
              select: { id: true },
            });
            needDaHuy = await chuyenTrangThaiDong(tx, {
              ids: dongPending.map((d) => d.id),
              tu: "PENDING",
              sang: "CANCELLED",
              lyDo: "BAO_LUU_LUI_NGAY",
              chiNeuCo: true,
            });
          }
        }
        await chuyenTrangThai(tx, {
          reserveId: hs.id,
          den: "ACTIVE",
          actor: nguoi,
          now,
          kind: "START",
          // BR-14: ảnh chụp quyền lợi tại START, CÙNG giao dịch với chuyển trạng thái.
          patch: await dungAnhChupKhiBatDau(tx, { enrollmentId: hs.enrollmentId, studentId: hs.studentId, startedAt: ngay.startedAt }),
          sauThem: { enrollmentStatusTruoc: pc.enrollmentTruoc, makeupNeedDaHuy: needDaHuy },
        });
        // ĐIỂM MÓC ZNS "đã duyệt bảo lưu" (spec §G) — mẫu ZNS chờ Zalo duyệt nên chưa ai nghe; cố ý phát trong cùng giao dịch để consumer
        // sau này chỉ phải thêm một dòng on(...). Mỗi hồ sơ được duyệt đúng một lần ⇒ dedupeKey theo hồ sơ.
        await publishEvent(
          "bao-luu.da-duyet",
          { reserveId: hs.id, studentId: hs.studentId, enrollmentId: hs.enrollmentId, centerId: hs.centerId, startedAt: ngay.startedAt.toISOString(), standardEndDate: standardEndDate.toISOString() },
          { tx, dedupeKey: `bao-luu.approve:${hs.id}` },
        );
        return {
          ok: true as const,
          data: { reserveId: hs.id, startedAt: ngay.startedAt, standardEndDate, soBuoiLui: ngay.soBuoiLui, classId: pc.classId },
        };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (err) {
    return dich(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TỪ CHỐI · HUỶ
// ─────────────────────────────────────────────────────────────────────────────

export async function tuChoiHoSo(
  input: { reserveId: string; lyDo: string },
  nguoi: NguoiLam,
  now: Date,
): Promise<KetQua<{ reserveId: string }>> {
  const lyDo = input.lyDo.trim();
  if (lyDo.length < 5) return { ok: false, loi: ["Ghi lý do từ chối (ít nhất 5 ký tự)."] };
  try {
    return await db.$transaction(async (tx) => {
      const hs = await tx.studentReserve.findUnique({
        where: { id: input.reserveId },
        select: { id: true, status: true, orgUnitId: true, createdByUserId: true },
      });
      if (!hs) throw new LoiNhieu(["Không tìm thấy hồ sơ bảo lưu."]);
      if (!(await laBaoLuuBat(hs.orgUnitId))) throw new LoiNhieu([LOI_BAO_LUU_TAT]);
      if (hs.status !== "PENDING") throw new LoiNhieu(["Hồ sơ không còn ở trạng thái chờ duyệt."]);
      // Người lập muốn rút hồ sơ thì dùng HUỶ, không phải từ chối chính mình (maker–checker).
      const mc = chanTuDuyet(nguoi.id, hs.createdByUserId);
      if (mc) throw new LoiNhieu([mc.replace("duyệt", "từ chối") + " Muốn rút hồ sơ thì bấm Huỷ."]);
      await chuyenTrangThai(tx, { reserveId: hs.id, den: "REJECTED", actor: nguoi, now, kind: "REJECT", note: lyDo, patch: { endReason: lyDo } });
      return { ok: true as const, data: { reserveId: hs.id } };
    });
  } catch (err) {
    return dich(err);
  }
}

/** Rút hồ sơ CHƯA BẮT ĐẦU (PENDING hoặc APPROVED). Đã sang ACTIVE thì không huỷ — phải phục học. */
export async function huyHoSo(
  input: { reserveId: string; lyDo: string },
  nguoi: NguoiLam,
  now: Date,
): Promise<KetQua<{ reserveId: string }>> {
  const lyDo = input.lyDo.trim();
  if (lyDo.length < 5) return { ok: false, loi: ["Ghi lý do huỷ (ít nhất 5 ký tự)."] };
  try {
    return await db.$transaction(async (tx) => {
      const hs = await tx.studentReserve.findUnique({
        where: { id: input.reserveId },
        select: { id: true, status: true, orgUnitId: true },
      });
      if (!hs) throw new LoiNhieu(["Không tìm thấy hồ sơ bảo lưu."]);
      if (!(await laBaoLuuBat(hs.orgUnitId))) throw new LoiNhieu([LOI_BAO_LUU_TAT]);
      if (hs.status !== "PENDING" && hs.status !== "APPROVED") {
        throw new LoiNhieu(["Chỉ huỷ được hồ sơ chưa bắt đầu. Hồ sơ đã bắt đầu thì làm thủ tục phục học."]);
      }
      await chuyenTrangThai(tx, { reserveId: hs.id, den: "CANCELLED", actor: nguoi, now, kind: "CANCEL", note: lyDo, patch: { endReason: lyDo } });
      // KHÔNG gỡ PAUSED ở đây: hồ sơ PENDING/APPROVED chưa bao giờ đặt PAUSED (START chạy ngay trong lúc duyệt, cùng
      // giao dịch). Gỡ "cho sạch" sẽ kéo nhầm một ghi danh PAUSED mồ côi không liên quan về đang học.
      return { ok: true as const, data: { reserveId: hs.id } };
    });
  } catch (err) {
    return dich(err);
  }
}
