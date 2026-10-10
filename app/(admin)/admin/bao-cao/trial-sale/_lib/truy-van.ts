// Truy vấn cho màn "Thống kê case trải nghiệm theo Sale".
//
// ⚠️ MỘT LƯỢT TRA, MỘT MẢNG CASE. Con số trên bảng và danh sách bung ra khi bấm vào nó
// đều suy từ CHÍNH mảng này (xem `lib/reports/trial-sale.ts`). Đếm bằng `groupBy` rồi
// tra danh sách bằng một câu `findMany` khác là dựng hai nguồn cho một câu trả lời, và
// hai nguồn thì lệch vào đúng ngày ai đó sửa một bên.
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getSubtreeCenterIds } from "@/lib/org/org-service";
import {
  phamViCoSo,
  saleCuaCase,
  type CaseTrial,
  type TrangThaiCase,
} from "@/lib/reports/trial-sale";

/** Trần số case đọc một lượt. Vượt trần thì màn hình PHẢI nói ra, không cắt im lặng. */
export const TRAN_CASE = 5000;

export type BoLoc = {
  /** "YYYY-MM-DD" — lọc theo NGÀY TẠO case. */
  tu: string;
  den: string;
  centerId: string | null;
  /** `OrgUnit.id` của khu vực. Có khu vực thì lấy mọi cơ sở trong cây con. */
  khuVucId: string | null;
};

export type KetQua = { cases: CaseTrial[]; batTran: boolean };

/** "YYYY-MM-DD" → mốc UTC 00:00 của ngày VN (khớp cách repo lưu cột `@db.Date`). */
function dauNgayVn(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export async function layCaseTrial(actor: Actor, loc: BoLoc): Promise<KetQua> {
  const sdb = scopedDb(actor);

  const tu = dauNgayVn(loc.tu);
  const den = dauNgayVn(loc.den);
  if (!tu || !den) return { cases: [], batTran: false };
  // `createdAt` là Timestamptz, còn `den` là 00:00 của ngày cuối ⇒ phải cộng một ngày,
  // nếu không thì case tạo lúc 09:00 ngày cuối cùng rơi ra ngoài và người dùng thấy
  // thiếu đúng những case hôm nay.
  const denHet = new Date(den.getTime() + 24 * 60 * 60 * 1000);

  // Cách ly cơ sở đi qua LỚP: `TrialEnrollment` không nằm trong `SCOPED_MODELS`, nên
  // `sdb.trialEnrollment` KHÔNG tự chèn `centerId`. Lọc theo `trialClass` — và
  // `trialClass` thì có auto-scope (`TrialClassV2` ∈ SCOPED_MODELS).
  // Phép giao KHU VỰC × CƠ SỞ nằm ở hàm THUẦN `phamViCoSo` (có test hành vi). Viết
  // thẳng ở đây thì chỉ còn lưới ghim mã nguồn canh, mà lưới ấy đã XANH GIẢ một lần với
  // đúng ca "khu vực rỗng bị bỏ qua" — xem chú thích ở `lib/reports/trial-sale.ts`.
  const centerIds = phamViCoSo({
    coSoCuaKhuVuc: loc.khuVucId ? await getSubtreeCenterIds(loc.khuVucId) : null,
    centerId: loc.centerId,
  });
  // `[]` = KHÔNG CÒN cơ sở nào hợp lệ. Để nó chạy tiếp thành `in: []` thì Prisma trả rỗng
  // đúng như mong muốn, nhưng vẫn tốn một lượt tra — và quan trọng hơn, ý định phải đọc
  // được ra ở đây chứ không nằm trong hành vi ngầm của `in: []`.
  if (centerIds !== null && centerIds.length === 0) return { cases: [], batTran: false };

  const rows = await sdb.trialEnrollment.findMany({
    where: {
      createdAt: { gte: tu, lt: denHet },
      trialClass: centerIds ? { centerId: { in: centerIds } } : {},
    },
    orderBy: { createdAt: "desc" },
    take: TRAN_CASE + 1,
    select: {
      id: true,
      status: true,
      createdAt: true,
      leadChildId: true,
      gvPhanCongId: true,
      leadChild: {
        select: {
          fullName: true,
          lead: {
            select: {
              parentName: true,
              // 26/09 — case tính cho Sale PHỤ TRÁCH LEAD, không cho người bấm thêm
              // (`saleCuaCase`). Tên tra kèm luôn ở đây, không cần lượt tra người riêng.
              assignedToId: true,
              assignedTo: { select: { name: true } },
            },
          },
        },
      },
      trialClass: { select: { id: true, name: true, startDate: true } },
      attendances: { select: { status: true } },
      // `scheduledSessionId` là CỘT TRẦN, không có quan hệ khai trong schema ⇒ không
      // `select` kèm được. Tra buổi riêng một lượt cho cả trang ở dưới.
      scheduledSessionId: true,
    },
  });

  const batTran = rows.length > TRAN_CASE;
  const cat = batTran ? rows.slice(0, TRAN_CASE) : rows;

  // ── Tra thêm HAI thứ, mỗi thứ MỘT lượt cho cả trang (không N+1) ─────────────────────
  const idCon = [...new Set(cat.map((r) => r.leadChildId))];

  // Giáo viên của buổi đã xếp — chỉ cần khi case chưa có GV phân công.
  const idBuoi = [
    ...new Set(
      cat
        .filter((r) => !r.gvPhanCongId && r.scheduledSessionId)
        .map((r) => r.scheduledSessionId!)
    ),
  ];
  const buoi = idBuoi.length
    ? await sdb.trialClassSession.findMany({
        where: { id: { in: idBuoi } },
        select: { id: true, teacherId: true, status: true },
      })
    : [];
  // Case ĐÃ HUỶ không dạy ai — bé trỏ vào đó là "chưa xếp case" (lib/trial/nghia-null.ts),
  // nên cột giáo viên phải về "chưa xếp" chứ không in người của buổi không diễn ra.
  const gvTheoBuoi = new Map(
    buoi.filter((b) => b.status !== "CANCELLED").map((b) => [b.id, b.teacherId]),
  );
  const idGv = [
    ...new Set(
      cat
        .map((r) => r.gvPhanCongId ?? (r.scheduledSessionId ? gvTheoBuoi.get(r.scheduledSessionId) ?? null : null))
        .filter((x): x is string => !!x),
    ),
  ];

  const [nguoi, ghiDanh] = await Promise.all([
    idGv.length > 0
      ? sdb.user.findMany({
          where: { id: { in: idGv } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string | null }[]),
    // "ĐÃ CHỐT" = con này đã có ghi danh chính thức sinh ra SAU khi case được tạo.
    //
    // ⚠️ Tín hiệu là `Enrollment.leadChildId`, KHÔNG phải `LeadTrialHistory.outcome` —
    // cột đó chỉ bật `ENROLLED` cho đúng cặp (con × lớp đã điểm danh) và chỉ khi dòng
    // lịch sử đang PENDING; nó sinh ra để tính hoa hồng giáo viên dạy Trial.
    //
    // Mốc `createdAt` cần thiết để không đếm em VỐN ĐÃ là học viên trước khi đi thử.
    idCon.length > 0
      ? sdb.enrollment.findMany({
          where: { leadChildId: { in: idCon } },
          select: { leadChildId: true, createdAt: true },
        })
      : Promise.resolve([] as { leadChildId: string | null; createdAt: Date }[]),
  ]);

  const tenTheoId = new Map(nguoi.map((u) => [u.id, u.name ?? null]));
  const chotTheoCon = new Map<string, Date[]>();
  for (const e of ghiDanh) {
    if (!e.leadChildId) continue;
    const ds = chotTheoCon.get(e.leadChildId);
    if (ds) ds.push(e.createdAt);
    else chotTheoCon.set(e.leadChildId, [e.createdAt]);
  }

  const cases: CaseTrial[] = cat.map((r) => {
    const gvId =
      r.gvPhanCongId ??
      (r.scheduledSessionId ? (gvTheoBuoi.get(r.scheduledSessionId) ?? null) : null);
    const diemDanh = r.attendances;
    return {
      id: r.id,
      ...saleCuaCase(r.leadChild?.lead ?? null),
      status: r.status as TrangThaiCase,
      daChot: (chotTheoCon.get(r.leadChildId) ?? []).some(
        (d) => d.getTime() >= r.createdAt.getTime(),
      ),
      // "Không đến" = CÓ điểm danh và MỌI lượt đều vắng. Case chưa điểm danh lượt nào
      // thì chưa biết, không phải vắng — đếm nó vào đây là phạt người chưa tới buổi học.
      vangHoanToan: diemDanh.length > 0 && diemDanh.every((a) => a.status === "ABSENT"),
      tenCon: r.leadChild?.fullName ?? "(không rõ tên)",
      tenPhuHuynh: r.leadChild?.lead?.parentName ?? null,
      tenLop: r.trialClass?.name ?? "(không rõ lớp)",
      trialClassId: r.trialClass?.id ?? "",
      ngayLop: r.trialClass?.startDate
        ? r.trialClass.startDate.toISOString().slice(0, 10)
        : null,
      tenGiaoVien: gvId ? (tenTheoId.get(gvId) ?? null) : null,
    };
  });

  return { cases, batTran };
}
