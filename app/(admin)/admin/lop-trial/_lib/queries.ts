// app/(admin)/admin/lop-trial/_lib/queries.ts — GĐ2.
//
// Mọi truy vấn ĐỌC của màn "Lớp Trial". Tất cả đi qua `scopedDb(actor)` để cách ly
// cơ sở (CS1 không thấy lớp CS2). Hai hàm dựng `where` nằm ở ./filters — tách ra để
// test được bằng vitest mà không phải nạp Prisma Client.
// 🔴 S-1 — tên phụ huynh + SĐT lấy từ `lead` phải qua `maskLeadPiiFields` NGAY Ở ĐÂY,
// không che ở JSX: tầng này còn phục vụ chỗ khác, che ở giao diện là che một chỗ và hở
// mọi chỗ còn lại. `canViewPii` do TRANG GỌI truyền xuống (đã hỏi `canViewLeadPii()`),
// tầng truy vấn không tự hỏi quyền.
// (Cấy lại khi hợp nhất `main` → `test` ngày 16/09/2026 — nhánh `main` chưa có chốt S-1.)
import { maskLeadPiiFields } from "@/lib/lead/pii";
import { scopedDb } from "@/lib/db-scope";
import { getCenterOptions } from "@/lib/org/center-options";
import type { Actor } from "@/lib/auth/actor";
// Module soát trùng DUY NHẤT của LỚP CHÍNH (T4.2). Dùng lại `rowsToSlots` thay vì tự
// suy `substitute ?? actual ?? class.teacherId` — bản thứ hai của một luật là bản sẽ lệch.
import { rowsToSlots } from "@/lib/lms/schedule-conflict";
import type { BuoiBanCuaGv } from "@/lib/trial/gv-kha-dung";
import { vnAddDays, vnParts, vnStartOfDay, vnYmd } from "@/lib/time/vn";
import { toVnInput } from "./schemas";
import { buildClassListWhere, buildBookingListWhere, docLocLop, ngayVnSangUtc } from "./filters";
import { trangThaiLop } from "@/lib/trial/trang-thai-lop";
import { suySaleCuaLop } from "./sale-cua-lop";
import {
  LY_DO_DA_HOC_XONG,
  quyenDoiGioCase,
  quyenChuyenCase,
  quyenDiemDanhCase,
  quyenGoHocVien,
  quyenSuaCase,
  quyenXoaCase,
} from "@/lib/trial/quyen-case";
import { laLopTheoKhung, thuocCase } from "@/lib/trial/nghia-null";
import { khoaHieuLucCuaBe } from "@/lib/lead/khoa-quan-tam";
import { layGvVangChoCase } from "@/lib/trial/gv-vang-case-db";
import type {
  BookingRow,
  ClassRow,
  EnrollmentRow,
  KhoaHocOption,
  Option,
  RoomOption,
  SessionRow,
  TrialClassStatusV2,
} from "./types";

// ─── Truy vấn thật ───────────────────────────────────────────────────────────

/** Mốc UTC-midnight của NGÀY hôm nay theo lịch VN — khớp cột `@db.Date`. */
function vnTodayUtc(now = new Date()): Date {
  const p = vnParts(now);
  return new Date(Date.UTC(p.year, p.month, p.day));
}

/** Danh sách lớp trải nghiệm cho trang chính. */
export async function layDanhSachLop(
  actor: Actor,
  status: string | undefined,
  q: string | undefined,
): Promise<ClassRow[]> {
  const sdb = scopedDb(actor);
  const rows = await sdb.trialClassV2.findMany({
    where: buildClassListWhere(status, q, vnTodayUtc()),
    // 23/09 — xếp theo NGÀY lớp (Sale tìm lớp theo ngày hẹn khách): "Đã đóng" mới nhất
    // trước, các chế độ khác ngày gần nhất trước. Lớp cũ không ngày xuống cuối.
    orderBy: [
      { startDate: { sort: docLocLop(status) === "da-dong" ? "desc" : "asc", nulls: "last" } },
      { startTime: "asc" },
      { createdAt: "desc" },
    ],
    take: 200,
    include: {
      config: { select: { name: true, sessionCount: true } },
      enrollments: {
        where: { status: "ACTIVE" },
        // Thứ tự xếp vào — để cột "Học viên" và cột "Sale" cùng ổn định giữa hai lần tải.
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          // 18/09 — cột "Học viên" + nhánh SUY "Sale của lớp" cho lớp cũ chưa có
          // `createdById`. `lead.assignedTo` là Sale đang CHĂM lead (khác
          // `createdById` của lead là người NHẬP phiếu).
          leadChild: {
            select: {
              fullName: true,
              lead: { select: { assignedTo: { select: { name: true } } } },
            },
          },
        },
      },
      sessions: {
        select: { date: true, status: true, startTime: true, endTime: true, createdById: true },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      },
    },
  });

  // Tên người tạo lớp: tra RIÊNG một lượt cho cả trang, vì `createdById` cố ý KHÔNG ràng
  // FK sang `User` (giống `teacherId`/`assistantId` cùng bảng) nên không `include` được.
  // `User` không thuộc SCOPED_MODELS ⇒ `sdb.user` chỉ là đường đi qua, không bị chèn
  // `where` — nhưng vẫn đi qua `sdb` để không phá luật cấm import `@/lib/db` trần ở
  // `app/(admin)/**`.
  // 23/09 — kèm NGƯỜI MỞ CASE (cột "Sale có case trial"), cùng một lượt tra.
  const idNguoiTao = [
    ...new Set(
      rows
        .flatMap((r) => [r.createdById, ...r.sessions.map((s) => s.createdById)])
        .filter((x): x is string => !!x),
    ),
  ];
  const tenTheoId = new Map<string, string>();
  if (idNguoiTao.length > 0) {
    const us = await sdb.user.findMany({
      where: { id: { in: idNguoiTao } },
      select: { id: true, name: true },
    });
    for (const u of us) if (u.name) tenTheoId.set(u.id, u.name);
  }

  const today = vnTodayUtc();
  const homNay = vnYmd(today);
  return rows.map((r) => {
    const next = r.sessions.find(
      (s) => s.status === "SCHEDULED" && s.date.getTime() >= today.getTime(),
    );
    const caseSong = r.sessions.filter((s) => s.status !== "CANCELLED");
    const saleCase = [
      ...new Set(
        caseSong
          .map((s) => (s.createdById ? tenTheoId.get(s.createdById) : undefined))
          .filter((x): x is string => !!x),
      ),
    ];
    const ngayLop = r.startDate ? r.startDate.toISOString().slice(0, 10) : null;
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status as TrialClassStatusV2,
      startTime: r.startTime,
      endTime: r.endTime,
      hocVien: r.enrollments.map((e) => e.leadChild?.fullName ?? "(không rõ tên)"),
      // `startDate` là `@db.Date` ⇒ đọc ra UTC 00:00 của ngày VN; `toISOString().slice(0,10)`
      // lấy đúng ngày đó. Đừng đổi sang `toLocaleDateString` — hàm đó đọc múi giờ tiến trình.
      // 23/09 — CHỈ lớp theo khung mới có "ngày mở" + "khung giờ" theo nghĩa mới. Lớp tạo
      // trước 28/08 cũng mang ngày/giờ cấp lớp, nhưng đó là giờ của lịch slot cũ; in nó
      // vào cột "Khung giờ" là bảo Sale đó là khung hẹn khách — sai.
      ngayMo: r.theoKhung && r.startDate ? r.startDate.toISOString().slice(0, 10) : null,
      khungGio: r.theoKhung && r.startTime && r.endTime ? `${r.startTime}–${r.endTime}` : null,
      // 23/09 — lớp THEO KHUNG do Quản lý mở: người tạo lớp KHÔNG phải Sale, nên không
      // suy "Sale" từ đó. Cột "Sale có case trial" đọc `saleCase`; nhánh suy chỉ còn cho
      // lớp cũ (case không lưu người mở).
      sale: r.theoKhung ? null : suySaleCuaLop({
        tenNguoiTao: r.createdById ? (tenTheoId.get(r.createdById) ?? null) : null,
        saleTheoCon: r.enrollments.map((e) => e.leadChild?.lead?.assignedTo?.name ?? null),
      }),
      saleCase,
      soCase: caseSong.length,
      caseKeTiep: next
        ? { ngay: next.date.toISOString().slice(0, 10), gio: `${next.startTime}–${next.endTime}` }
        : null,
      trangThai: trangThaiLop({ status: r.status, theoKhung: r.theoKhung, ngayLop, homNay }),
    };
  });
}

/** Cơ sở + phòng để đổ vào form tạo lớp. */
export async function layLuaChonTaoLop(
  actor: Actor,
): Promise<{
  centers: (Option & { code: string | null })[];
  courses: (Option & { slug: string })[];
}> {
  const sdb = scopedDb(actor);
  const [centers, courses] = await Promise.all([
    // 03/09 — dùng helper chung: bản cũ (`center.findMany` trần) bày cả Hội sở, các
    // dòng Center mồ côi (`ITLI_*`), và không cắt theo tầm nhìn actor nên người dùng
    // chọn được cơ sở mình không quản. Helper vẫn trả `code` mà form cần để xem trước
    // tên lớp ("CS2-sata4-Lớp trial …").
    getCenterOptions(actor),
    // Khoá trải nghiệm = khoá quan tâm. `Course` không thuộc SCOPED_MODELS (danh mục
    // dùng chung toàn hệ) nên `sdb` chỉ pass-through.
    sdb.course.findMany({
      where: { isActive: true },
      // 29/08 — `slug` là phần MÃ KHOÁ trong tên lớp; form cần nó để xem trước.
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { centers, courses };
}

export type ChiTietLop = {
  id: string;
  code: string;
  name: string;
  status: TrialClassStatusV2;
  centerId: string;
  /**
   * ~~28/08 — giờ/sĩ số ở CẤP LỚP đã thôi dùng.~~ **[ĐẢO 22/09/2026]** Lớp nay LÀ một
   * ngày × một khung giờ, và khung đó là ràng buộc của mọi case bên trong. `null` với
   * lớp tạo trước 22/09 — đường đọc phải chịu được null, đừng bịa một khung cho nó.
   */
  startTime: string | null;
  endTime: string | null;
  /** NGÀY lớp mở. `null` với lớp cũ. Case phải cùng ngày này (cổng ở `_actions.ts`). */
  startDate: Date | null;
  /**
   * Lớp theo khung hay lớp cũ — đọc CỘT, đừng suy từ `startTime`/`endTime`: lớp tạo trước
   * 28/08 vẫn mang giờ ở cấp lớp (xem `lib/trial/nghia-null.ts`).
   */
  theoKhung: boolean;
  /** `null` = không giới hạn sĩ số. */
  capacity: number | null;
  sessionCount: number;
  configName: string | null;
  teacherId: string | null;
  /** Khoá cho ô chọn khoá của bé (khoá đang mở, cộng khoá bé đang mang dù đã ngừng). */
  khoaHocOptions: KhoaHocOption[];
  sessions: SessionRow[];
  enrollments: EnrollmentRow[];
};

// ─── Lịch đã kín của giáo viên — nguồn của note ĐỎ "trùng lịch" (chốt V2-b) ────
//
// ĐÚNG HAI NGUỒN, không hơn: buổi của lớp TRIAL khác + buổi LỚP CHÍNH (`ClassSession`).
//
// ⛔ KHÔNG tính trùng với ca làm trong lưới chấm công. Chủ dự án 17/09 nói thẳng:
// "ca hành chính của Kiệt và Toại thì cả 2 người đều trial bình thường, không cần note
// đỏ." Ca làm trả lời câu "người này CÓ MẶT không" (luật PHỦ TRỌN, ở
// `lib/trial/gv-kha-dung.ts`); trùng lịch trả lời câu "người này ĐÃ NHẬN việc khác
// chưa". Trộn hai câu là biến mọi người đang đi làm thành người bận.

/**
 * Nhãn CHUNG, cố ý không mang tên lớp / tên học viên.
 *
 * ⚠️ ĐÂY LÀ MỘT CỔNG, không phải lười đặt tên. Hai truy vấn dưới **cố ý bỏ khoá
 * `centerId`** (giáo viên là nguồn lực chung từ 06/08 — người của CS2 được điều sang dạy
 * CS1, và phép soát trùng phải thấy cả hai phía), nên dòng trả về có thể thuộc cơ sở mà
 * người đang xem KHÔNG được đọc dữ liệu. In tên lớp ra là rò rỉ đúng thứ `scopedDb` sinh
 * ra để chặn: người CS1 đọc được tên lớp CS2 qua một cái note đỏ.
 *
 * Giờ + nguồn là đủ để người xếp lịch quyết định ("18:00–19:30 đã có buổi lớp chính");
 * muốn biết lớp nào thì hỏi người phụ trách cơ sở đó — đúng quy trình.
 */
const NHAN_TRIAL = "buổi lớp trải nghiệm" as const;
const NHAN_LOP_CHINH = "buổi lớp chính" as const;

/**
 * `BuoiBanCuaGv` (hợp đồng dùng chung) KHÔNG mang `teacherId` — ở đó nó đã được gom
 * theo người rồi. Hai hàm truy vấn dưới trả danh sách PHẲNG nên phải kèm khoá người,
 * và `layLichBanGiaoVien` mới là chỗ gom lại đúng hình dạng hợp đồng.
 */
type BuoiBanKemGv = BuoiBanCuaGv & { teacherId: string };

/** "HH:mm" theo đồng hồ VN của một mốc thời gian THẬT. */
function gioVn(d: Date): string {
  const p = vnParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Buổi trial khác đã chiếm chỗ của giáo viên trong NGÀY `ymd`. */
async function buoiTrialDaChiem(
  actor: Actor,
  opts: { ymd: string; excludeSessionId: string | null },
): Promise<BuoiBanKemGv[]> {
  const sdb = scopedDb(actor);
  const ngay = ngayVnSangUtc(opts.ymd);
  if (!ngay) return [];

  const rows = await sdb.trialClassSession.findMany({
    where: {
      status: "SCHEDULED",
      teacherId: { not: null },
      // Cột `@db.Date` — so BẰNG với nửa đêm UTC của ngày VN. KHÔNG dùng khoảng
      // `gte/lt` như `ClassSession` ngay dưới: cột này không mang giờ.
      date: ngay,
      // 17/09 — BỎ khoá `centerId`. `TrialClassSession` KHÔNG thuộc `SCOPED_MODELS`
      // (xem `_lib/guards.ts`) nên không có lưới nào chèn lại — đó chính là lý do nhãn
      // phải là chuỗi chung ở trên.
      trialClass: { status: { not: "CANCELLED" } },
      // Sửa một buổi thì phải LOẠI chính nó, nếu không đổi mỗi ô ghi chú cũng tự báo
      // "trùng lịch" với bản thân và người dùng học cách bỏ qua note đỏ.
      ...(opts.excludeSessionId ? { id: { not: opts.excludeSessionId } } : {}),
    },
    select: { teacherId: true, startTime: true, endTime: true },
    take: 500,
  });

  const out: BuoiBanKemGv[] = [];
  for (const r of rows) {
    if (!r.teacherId) continue;
    out.push({
      teacherId: r.teacherId,
      ymd: opts.ymd,
      startTime: r.startTime,
      endTime: r.endTime,
      nhan: NHAN_TRIAL,
      nguon: "TRIAL",
    });
  }
  return out;
}

/**
 * Buổi LỚP CHÍNH đã chiếm chỗ của giáo viên trong NGÀY `ymd`.
 *
 * ⚠️ HAI CỘT `date` CÙNG TÊN, KHÁC NGHĨA — khớp theo tên cột ở đây là sai:
 *   · `TrialClassSession.date` là `@db.Date` — nửa đêm UTC, KHÔNG mang giờ.
 *   · `ClassSession.date`      là `@db.Timestamptz(6)` — MANG GIỜ THẬT của buổi.
 * Nên ngày của lớp chính phải lọc bằng KHOẢNG `[00:00 VN, 00:00 VN hôm sau)`, quy đổi
 * tường minh qua `lib/time/vn.ts`. Lọc bằng một mốc UTC-midnight sẽ khớp đúng các buổi
 * 07:00 giờ VN và bỏ sót tất cả buổi còn lại.
 *
 * ⚠️ Người dạy KHÔNG tự suy — `substitute ?? actual ?? class.teacherId` là luật của
 * `lib/lms/schedule-conflict.ts`, module soát trùng DUY NHẤT của lớp chính. Chép lại
 * luật đó ở đây là đẻ bản thứ hai, và bản thứ hai sẽ trôi lệch (đó đúng là lý do bản cũ
 * `findScheduleConflicts` đã bị gỡ bỏ).
 */
async function buoiLopChinhDaChiem(
  actor: Actor,
  opts: { ymd: string },
): Promise<BuoiBanKemGv[]> {
  const sdb = scopedDb(actor);
  const moc = ngayVnSangUtc(opts.ymd);
  if (!moc) return [];
  const dauNgay = vnStartOfDay(moc);
  const cuoiNgay = vnAddDays(dauNgay, 1);

  // `ClassSession` ∈ SCOPED_MODELS ⇒ `scopedDb` tự chèn `centerId IN visibleCenterIds`.
  // GIỚI HẠN ĐÃ BIẾT, cố ý giữ: với người cấp cơ sở, buổi lớp chính ở cơ sở ngoài tầm
  // nhìn KHÔNG sinh note đỏ (fail-closed — thà thiếu cảnh báo còn hơn rò dữ liệu, và
  // gỡ lưới ở đây là mở một đường đọc `ClassSession` liên cơ sở không ai gác).
  const rows = await sdb.classSession.findMany({
    where: {
      status: { not: "CANCELLED" },
      date: { gte: dauNgay, lt: cuoiNgay },
      class: { deletedAt: null },
    },
    // ĐÚNG bộ cột mà `rowsToSlots` đọc — thiếu một cột là nó suy sai người dạy hoặc
    // sai khung giờ, im lặng. Giữ nguyên hình dạng, đừng rút gọn.
    select: {
      id: true,
      date: true,
      roomId: true,
      actualRoomId: true,
      actualTeacherId: true,
      substituteRoomId: true,
      substituteTeacherId: true,
      class: {
        select: { roomId: true, teacherId: true, startTime: true, endTime: true },
      },
    },
    take: 500,
  });

  const out: BuoiBanKemGv[] = [];
  for (const slot of rowsToSlots(rows)) {
    if (!slot.teacherId) continue;
    out.push({
      teacherId: slot.teacherId,
      // Ngày lấy từ CHÍNH mốc bắt đầu của buổi (đã quy về đồng hồ VN), không lấy lại
      // `opts.ymd`: một buổi 23:30–01:00 nằm vắt qua nửa đêm thì hai giá trị khác nhau,
      // và hàm lọc trùng so khớp theo `ymd`.
      ymd: vnYmd(slot.startAt),
      startTime: gioVn(slot.startAt),
      endTime: gioVn(slot.endAt),
      nhan: NHAN_LOP_CHINH,
      nguon: "LOP_CHINH",
    });
  }
  return out;
}

/**
 * Lịch đã kín của TỪNG giáo viên trong một ngày — gom cả hai nguồn, gom theo `teacherId`.
 *
 * Trả về đúng hình dạng `banTheoGv` mà `locGiaoVienChoBuoi` ăn vào. Người gọi KHÔNG phải
 * biết có mấy nguồn.
 */
export async function layLichBanGiaoVien(
  actor: Actor,
  opts: { ymd: string; excludeSessionId: string | null },
): Promise<Record<string, BuoiBanCuaGv[]>> {
  const [trial, lopChinh] = await Promise.all([
    buoiTrialDaChiem(actor, opts),
    buoiLopChinhDaChiem(actor, { ymd: opts.ymd }),
  ]);

  const out: Record<string, BuoiBanCuaGv[]> = {};
  for (const b of [...trial, ...lopChinh]) {
    (out[b.teacherId] ??= []).push(b);
  }
  // Sắp theo giờ bắt đầu: note đỏ chỉ in buổi ĐẦU TIÊN khớp (xem `timTrungLich`), nên
  // không sắp thì người dùng thấy buổi nào là do thứ tự DB trả về — đổi giữa hai lần bấm.
  for (const ds of Object.values(out)) {
    ds.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }
  return out;
}

/** Phòng học ĐANG DÙNG của một cơ sở. `Room.centerId` là NOT NULL nên không có phòng
 *  dùng chung — đừng thêm nhánh `centerId: null`, nó không bao giờ khớp dòng nào. */
export async function layPhongTheoCoSo(
  actor: Actor,
  centerId: string,
): Promise<RoomOption[]> {
  const sdb = scopedDb(actor);
  const rooms = await sdb.room.findMany({
    where: { status: "ACTIVE", centerId },
    select: { id: true, name: true, centerId: true },
    orderBy: { displayOrder: "asc" },
  });
  return rooms;
}

/**
 * Chi tiết một lớp. Trả null nếu ngoài tầm nhìn của actor (chống IDOR).
 *
 * ⚠️ `nguoiXem` KHÔNG có mặc định, và đó là chủ đích (luật 7): ba giá trị trong đó
 * quyết định người dùng thấy nút nào sáng. Một mặc định kiểu `laQuanLy = false` sẽ
 * khoá nhầm nút của Quản lý ở bất kỳ chỗ gọi nào quên truyền — im lặng, không lỗi.
 * Bắt buộc ⇒ `tsc` liệt kê mọi chỗ gọi.
 */
export async function layChiTietLop(
  actor: Actor,
  id: string,
  nguoiXem: {
    userId: string;
    /** Có `trials:create-class` — quyết định sửa/xoá được case của người khác. */
    laQuanLyLop: boolean;
    /** Có `leads:view-all` — quyết định gỡ được học viên của Sale khác. */
    laQuanLyLead: boolean;
  },
  /** Được xem SĐT/tên phụ huynh đầy đủ (`canViewLeadPii()` — trang gọi hỏi sẵn). */
  canViewPii: boolean,
): Promise<ChiTietLop | null> {
  const sdb = scopedDb(actor);
  const cls = await sdb.trialClassV2.findUnique({
    where: { id },
    include: {
      config: { select: { name: true, sessionCount: true } },
      sessions: {
        orderBy: { seq: "asc" },
        include: {
          attendances: {
            select: { trialEnrollmentId: true, status: true, note: true },
          },
        },
      },
      enrollments: {
        orderBy: { createdAt: "asc" },
        include: {
          leadChild: {
            select: {
              id: true,
              fullName: true,
              // 26/09 — khoá của bé trong lớp theo khung (`lib/trial/khoa-truoc-case.ts`).
              interestedCourseId: true,
              lead: {
                select: {
                  id: true,
                  parentName: true,
                  phone: true,
                  // 23/09 — ba cột NÀY là đầu vào của `laLeadCuaToi`. Thiếu một cột
                  // là phép hỏi quyền lặng lẽ trả sai; `tsc` bắt được vì `quyenGo`
                  // là trường BẮT BUỘC của `EnrollmentRow`.
                  assignedToId: true,
                  createdById: true,
                  isSharedWithTeam: true,
                  assignedTo: { select: { name: true } },
                  // 26/09 — khoá quan tâm cấp lead: nguồn lùi của `khoaHieuLucCuaBe`.
                  courseId: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!cls) return null;

  // Phiếu rubric đã chấm, gom theo (buổi × ca) — nguồn cho nút "Xuất PDF" trên dòng
  // điểm danh. Chỉ lấy hai cột khoá: ở đây chỉ cần biết CÓ hay KHÔNG, nội dung phiếu
  // do route PDF đọc lại khi người dùng bấm.
  //
  // `trialRubricEval` không thuộc SCOPED_MODELS (bảng không có centerId) nên `sdb` chỉ
  // pass-through — cách ly cơ sở ở đây đến từ chỗ khác: `enrollmentIds` lấy từ chính
  // lớp vừa qua `sdb.trialClassV2.findUnique`, tức đã lọc theo tầm nhìn của actor.
  const enrollmentIds = cls.enrollments.map((e) => e.id);
  const phieuDaCham = enrollmentIds.length
    ? await sdb.trialRubricEval.findMany({
        where: { trialEnrollmentId: { in: enrollmentIds } },
        select: { trialEnrollmentId: true, trialClassSessionId: true },
      })
    : [];
  const phieuTheoBuoi = new Map<string, Record<string, true>>();
  for (const p of phieuDaCham) {
    // Phiếu KHÔNG gắn buổi là dữ liệu trước GĐ4 — bỏ qua thay vì gán bừa vào một buổi.
    if (!p.trialClassSessionId) continue;
    const m = phieuTheoBuoi.get(p.trialClassSessionId) ?? {};
    m[p.trialEnrollmentId] = true;
    phieuTheoBuoi.set(p.trialClassSessionId, m);
  }

  // Tên người tạo CASE — tra riêng một lượt cho cả trang, vì `TrialClassSession.
  // createdById` cố ý không ràng FK sang `User` (xem migration 20260923100000) nên
  // không `include` được. `User` ∉ SCOPED_MODELS ⇒ `sdb.user` chỉ là đường đi qua,
  // nhưng vẫn đi qua `sdb` để không phá luật cấm import `@/lib/db` trần ở `app/**`.
  const idTaoCase = [
    ...new Set(cls.sessions.map((x) => x.createdById).filter((x): x is string => !!x)),
  ];
  const tenTaoCase = new Map<string, string>();
  if (idTaoCase.length > 0) {
    const us = await sdb.user.findMany({
      where: { id: { in: idTaoCase } },
      select: { id: true, name: true },
    });
    for (const u of us) if (u.name) tenTaoCase.set(u.id, u.name);
  }

  // Quyền GỠ của từng ca — tính MỘT lần ở đây rồi dùng lại cho cổng xoá case bên dưới.
  // Đếm "học viên của người khác" bằng CHÍNH kết quả này, không bằng một luật thứ hai:
  // hai phép đếm khác nhau cho cùng một câu hỏi là chỗ mà cổng xoá sẽ lệch cổng gỡ.
  const quyenGoTheoCa = new Map<string, ReturnType<typeof quyenGoHocVien>>();
  for (const e of cls.enrollments) {
    const ld = e.leadChild?.lead ?? null;
    // Chỉ ghi danh ACTIVE mới gỡ được (server tìm đúng `status: "ACTIVE"`). Bé đã học
    // xong mà nút vẫn sáng thì bấm vào là nhận "không tìm thấy ghi danh" — nút hứa suông.
    if (e.status !== "ACTIVE") {
      quyenGoTheoCa.set(e.id, { duoc: false, lyDo: LY_DO_DA_HOC_XONG });
      continue;
    }
    quyenGoTheoCa.set(
      e.id,
      quyenGoHocVien({
        lead: ld
          ? {
              assignedToId: ld.assignedToId,
              createdById: ld.createdById,
              isSharedWithTeam: ld.isSharedWithTeam,
            }
          : null,
        userId: nguoiXem.userId,
        laQuanLy: nguoiXem.laQuanLyLead,
        tenSale: ld?.assignedTo?.name ?? null,
      }),
    );
  }

  const lopTheoKhung = laLopTheoKhung(cls);

  // Khoá học: danh sách cho ô chọn + tên để hiển thị. Gồm khoá đang MỞ và mọi khoá mà
  // bé/lớp đang mang (kể cả đã ngừng) — thiếu vế sau thì bé mang khoá đã ngừng hiện ô chọn
  // TRỐNG, trông như "chưa chọn" trong khi dữ liệu có. `Course` ∉ SCOPED_MODELS nên `sdb`
  // chỉ là đường đi qua.
  const idKhoaDangMang = [
    ...new Set(
      [
        cls.courseId,
        ...cls.enrollments.map((e) => (e.leadChild ? khoaHieuLucCuaBe(e.leadChild) : null)),
      ].filter(
        (x): x is string => !!x,
      ),
    ),
  ];
  const cacKhoa = await sdb.course.findMany({
    where: { OR: [{ isActive: true }, { id: { in: idKhoaDangMang } }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const tenKhoa = new Map(cacKhoa.map((k) => [k.id, k.name]));

  // 29/09 — case có giáo viên vắng vì đơn nghỉ / đổi ca đã duyệt. Qua `sdb` như mọi câu
  // đọc khác của màn này; một lượt cho cả trang.
  const gvVangTheoCase = await layGvVangChoCase(
    sdb,
    cls.sessions.map((s) => ({
      id: s.id,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      teacherId: s.teacherId,
      status: s.status,
    })),
  );

  return {
    id: cls.id,
    code: cls.code,
    name: cls.name,
    status: cls.status as TrialClassStatusV2,
    centerId: cls.centerId,
    startTime: cls.startTime,
    endTime: cls.endTime,
    startDate: cls.startDate,
    theoKhung: cls.theoKhung,
    capacity: cls.capacity,
    sessionCount: cls.sessionCount,
    configName: cls.config?.name ?? null,
    teacherId: cls.teacherId,
    khoaHocOptions: cacKhoa,
    sessions: cls.sessions.map((s) => ({
      id: s.id,
      seq: s.seq,
      date: s.date.toISOString(),
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status as SessionRow["status"],
      teacherId: s.teacherId,
      roomId: s.roomId,
      createdById: s.createdById,
      nguoiTao: s.createdById ? (tenTaoCase.get(s.createdById) ?? null) : null,
      ...(() => {
        const sua = quyenSuaCase({
          nguoiTaoId: s.createdById,
          userId: nguoiXem.userId,
          laQuanLy: nguoiXem.laQuanLyLop,
        });
        // "Bé trong case" theo `thuocCase` — ĐÚNG tập mà server đếm ở
        // `demHocVienNguoiKhac`. Lệch tập là nút khoá ở đây mà server cho qua (hay
        // ngược lại): ở lớp CŨ, bé NULL học cả lớp nên cũng thuộc case này.
        const soKhac = cls.enrollments.filter(
          (e) =>
            e.status === "ACTIVE" &&
            thuocCase(e, s.id, lopTheoKhung) &&
            quyenGoTheoCa.get(e.id)?.duoc === false,
        ).length;
        return {
          quyenSua: sua,
          quyenXoa: quyenXoaCase({
            nguoiTaoId: s.createdById,
            userId: nguoiXem.userId,
            laQuanLy: nguoiXem.laQuanLyLop,
            soHocVienNguoiKhac: soKhac,
          }),
          quyenDoiGio: quyenDoiGioCase({ sua, soHocVienNguoiKhac: soKhac }),
          quyenDiemDanh: quyenDiemDanhCase({
            theoKhung: lopTheoKhung,
            nguoiTaoId: s.createdById,
            userId: nguoiXem.userId,
            laQuanLy: nguoiXem.laQuanLyLop,
          }),
        };
      })(),
      attendance: Object.fromEntries(
        s.attendances.map((a) => [
          a.trialEnrollmentId,
          { status: a.status as "PRESENT" | "ABSENT", note: a.note },
        ]),
      ),
      danhGia: phieuTheoBuoi.get(s.id) ?? {},
      gvVang: gvVangTheoCase.has(s.id) ? { lyDo: gvVangTheoCase.get(s.id)!.lyDo } : null,
    })),
    enrollments: cls.enrollments.map((e) => {
      const che = maskLeadPiiFields(
        {
          parentName: e.leadChild?.lead?.parentName ?? null,
          phone: e.leadChild?.lead?.phone ?? null,
        },
        canViewPii,
      );
      return {
      id: e.id,
      leadChildId: e.leadChild?.id ?? null,
      childName: e.leadChild?.fullName ?? "(không rõ)",
      parentName: che.parentName ?? null,
      phone: che.phone ?? null,
      leadId: e.leadChild?.lead?.id ?? null,
      status: e.status as EnrollmentRow["status"],
      scheduledSessionId: e.scheduledSessionId,
      gvDeXuatId: e.gvDeXuatId,
      gvPhanCongId: e.gvPhanCongId,
      rescheduleCount: e.rescheduleCount,
      saleTen: e.leadChild?.lead?.assignedTo?.name ?? null,
      // Không tính lại — dùng đúng bản đồ đã dựng ở trên, cùng bản mà cổng xoá case đọc.
      quyenGo: quyenGoTheoCa.get(e.id) ?? {
        duoc: false,
        lyDo: "Không tra được quyền gỡ của ca này — tải lại trang.",
      },
      quyenChuyen: quyenChuyenCase({
        lead: e.leadChild?.lead
          ? {
              assignedToId: e.leadChild.lead.assignedToId,
              createdById: e.leadChild.lead.createdById,
              isSharedWithTeam: e.leadChild.lead.isSharedWithTeam,
            }
          : null,
        userId: nguoiXem.userId,
        laQuanLy: nguoiXem.laQuanLyLead,
        tenSale: e.leadChild?.lead?.assignedTo?.name ?? null,
      }),
      ...(() => {
        // Khoá HIỆU LỰC (khoá của bé, trống thì khoá của lead) — cùng định nghĩa với site
        // giáo viên và với cổng xếp case, nên ba nơi không thể lệch nhau.
        const id = e.leadChild ? khoaHieuLucCuaBe(e.leadChild) : null;
        return {
          khoaHocId: id,
          khoaTuLead: !!id && !e.leadChild?.interestedCourseId,
          khoaHocTen:
            (id ? tenKhoa.get(id) : null) ??
            (cls.courseId ? tenKhoa.get(cls.courseId) : null) ??
            null,
        };
      })(),
      };
    }),
  };
}

// 28/08 — `layDanhSachHen` ĐÃ GỠ cùng tab "Lịch hẹn học thử".
export async function layDanhSachHen(
  actor: Actor,
  status: string | undefined,
  // `canViewPii` cai QUẢN CẢ HAI việc: che cột hiển thị VÀ cho phép ô tìm quét cột
  // SĐT. Hai việc đó phải cùng một cờ — che cột mà vẫn cho tìm là vẫn dò ra số.
  opts: { ownTeacherId?: string | null; q?: string; canViewPii: boolean },
): Promise<{ bookings: BookingRow[]; rooms: RoomOption[]; classes: Option[] }> {
  const sdb = scopedDb(actor);
  const [rows, rooms, classes] = await Promise.all([
    sdb.trialClass.findMany({
      where: buildBookingListWhere(status, { ...opts, canSearchPhone: opts.canViewPii }),
      orderBy: [{ status: "asc" }, { scheduledAt: "asc" }],
      take: 200,
      include: {
        lead: {
          select: {
            id: true,
            parentName: true,
            phone: true,
            childName: true,
            children: { select: { fullName: true } },
          },
        },
        center: { select: { name: true } },
        teacher: { select: { id: true, name: true } },
      },
    }),
    sdb.room.findMany({
      where: { status: "ACTIVE" },
      // `centerId` là bắt buộc, không phải trang trí: dropdown phòng ở màn buổi hẹn
      // lọc theo cơ sở CỦA TỪNG BUỔI, nên client phải biết phòng thuộc cơ sở nào.
      select: { id: true, name: true, centerId: true },
      orderBy: { displayOrder: "asc" },
    }),
    sdb.class.findMany({
      where: { status: { in: ["PLANNED", "ACTIVE"] } },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const bookings: BookingRow[] = rows.map((t) => {
    const che = maskLeadPiiFields(
      { parentName: t.lead?.parentName ?? null, phone: t.lead?.phone ?? null },
      opts.canViewPii,
    );
    return {
    id: t.id,
    leadId: t.leadId,
    parentName: che.parentName ?? null,
    phone: che.phone ?? null,
    childName: t.lead?.children[0]?.fullName ?? t.lead?.childName ?? null,
    centerId: t.centerId,
    centerName: t.center?.name ?? null,
    status: t.status as BookingRow["status"],
    // Server quy đổi sang đồng hồ VN — client KHÔNG tự tính (xem ghi chú ở types.ts).
    scheduledAtVn: t.scheduledAt ? toVnInput(t.scheduledAt) : "",
    teacherId: t.teacherId,
    teacherName: t.teacher?.name ?? null,
    roomId: t.roomId,
    classId: t.classId,
    notes: t.notes,
    };
  });

  return { bookings, rooms, classes };
}
