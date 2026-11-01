// Đọc lưới ca cho NHIỀU case trial một lượt, rồi hỏi luật `gvVangTaiCase`.
//
// Dùng chung cho HAI nơi, và hai nơi phải nói cùng một điều:
//   · màn chi tiết lớp trial (đánh dấu case + khoá "Xếp vào case") — gọi với `scopedDb`;
//   · bước báo tin sau khi duyệt đơn nghỉ/đổi ca — gọi với `db` (hệ thống đi báo, không
//     phải người dùng đi xem, nên không có phạm vi nhìn để cắt).
//
// MỘT câu `findMany` cho cả trang (không N+1): khoá là cặp (giáo viên × ngày), cột
// `workDate` và `TrialClassSession.date` cùng là `@db.Date` (nửa đêm UTC của ngày VN) nên
// so thẳng được, không đổi múi giờ.

import type { Prisma } from "@prisma/client";
import { epSegments } from "@/lib/trial/gv-kha-dung-db";
import type { LoaiMaCa } from "@/lib/cham-cong/nhan-ca";
import { gvVangTaiCase, type GvVangCase, type NguonOCa } from "@/lib/trial/gv-vang-case";

/** Đủ cho hàm này: chỉ cần đọc `shiftAssignment`. `db` và `scopedDb(actor)` đều thoả. */
export type KhoLuoiCa = {
  shiftAssignment: {
    findMany(args: {
      where: Prisma.ShiftAssignmentWhereInput;
      select: {
        userId: true;
        workDate: true;
        source: true;
        templateCode: true;
        centerId: true;
        segments: true;
        template: { select: { kind: true } };
      };
    }): Promise<
      {
        userId: string;
        workDate: Date;
        source: NguonOCa;
        templateCode: string;
        centerId: string;
        segments: Prisma.JsonValue;
        template: { kind: LoaiMaCa };
      }[]
    >;
  };
};

export type CaseCanXet = {
  id: string;
  /** `@db.Date` — nửa đêm UTC của ngày VN. */
  date: Date;
  startTime: string;
  endTime: string;
  teacherId: string | null;
  status: string;
};

const khoa = (userId: string, ngay: Date) => `${userId}|${ngay.toISOString().slice(0, 10)}`;

/**
 * Case nào có giáo viên vắng vì đơn nghỉ / đổi ca đã duyệt. Chỉ xét case còn `SCHEDULED`
 * và đã có giáo viên — case huỷ/đã xong không còn gì để làm, case chưa có GV thì đã có
 * luồng báo "chưa có giáo viên" riêng.
 */
export async function layGvVangChoCase(
  kho: KhoLuoiCa,
  cases: readonly CaseCanXet[],
): Promise<Map<string, Extract<GvVangCase, { vang: true }>>> {
  const canXet = cases.filter((c) => c.status === "SCHEDULED" && c.teacherId);
  const ra = new Map<string, Extract<GvVangCase, { vang: true }>>();
  if (canXet.length === 0) return ra;

  const oCa = await kho.shiftAssignment.findMany({
    where: {
      status: "ACTIVE",
      userId: { in: [...new Set(canXet.map((c) => c.teacherId!))] },
      workDate: { in: [...new Set(canXet.map((c) => c.date.getTime()))].map((t) => new Date(t)) },
    },
    select: {
      userId: true,
      workDate: true,
      source: true,
      templateCode: true,
      centerId: true,
      segments: true,
      template: { select: { kind: true } },
    },
  });
  const theoKhoa = new Map(oCa.map((o) => [khoa(o.userId, o.workDate), o]));

  for (const c of canXet) {
    const o = theoKhoa.get(khoa(c.teacherId!, c.date));
    const kq = gvVangTaiCase({
      o: o
        ? {
            nguon: o.source,
            ca: {
              ma: o.templateCode,
              kind: o.template.kind,
              centerId: o.centerId,
              segments: epSegments(o.segments),
            },
          }
        : null,
      khung: { startTime: c.startTime, endTime: c.endTime },
    });
    if (kq.vang) ra.set(c.id, kq);
  }
  return ra;
}
