// E-01 — "Buổi học & đánh giá còn thiếu". Test viết TRƯỚC hiện thực (luật cứng #5).
//
// BỐN LỖI ĐÃ ĐO ĐƯỢC trên con số đang chạy (`sessionIncomplete`, `lib/pending-tasks.ts:235`)
// — mỗi lỗi có ít nhất một ca đỏ ở đây, vì cả bốn đều là hỏng CÂM (ra số, không ra lỗi):
//
//  1. ĐO SAI VIỆC. Nó đếm `status != "COMPLETED"` (`:241`) — tức "chưa ai bấm nút Hoàn
//     tất buổi". Buổi điểm danh đủ, nhận xét đủ, ảnh đủ mà quên bấm nút vẫn bị đếm là
//     "còn thiếu"; ngược lại một buổi ĐÃ bấm COMPLETED nhưng chưa ai nhận xét thì biến
//     mất khỏi con số. E-01 hỏi "chưa điểm danh / chưa đánh giá", không hỏi "chưa bấm nút".
//  2. KHÔNG CÓ KHOẢNG NGÀY. Điều kiện cứng `date < startOfToday` (`:240`) ⇒ đổi bộ lọc
//     ngày trên dashboard thì con số đứng im.
//  3. TRẦN 50. `take: 50` (`:245`) rồi `count: rows.length` (`:254`) ⇒ cơ sở nợ 200 buổi
//     vẫn hiện đúng "50", mãi mãi.
//  4. ĐƠN TRỊ CƠ SỞ. `centerScope = user.centerId` (`:114`) ⇒ QLCS giữ 2 cơ sở chỉ thấy 1.
//
// Và một bất biến của chính E-01 (AC E-01-3): CON SỐ PHẢI KHỚP DANH SÁCH — hai đường đi
// qua đúng một lần quét, nếu tách ra thì sớm muộn lệch.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Module đụng DB qua `scopedDb`. Chặn cả cụm ở cửa để test chạy không cần Postgres —
// cùng cách `lib/chat/pilot-stats.test.ts` đang làm.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: vi.fn(() => fakeDb) }));

import type { Actor } from "@/lib/auth/actor";
import type { ScopeFilters } from "@/lib/reports/scope-filters";
import {
  buildSessionGapRows,
  countSessionGaps,
  emptySessionGapCounts,
  listSessionGaps,
  paginateSessionGaps,
  SESSION_GAP_LIST_PHASES,
  SESSION_GAP_PAGE_SIZE,
  SESSION_GAP_SCAN_MAX,
  splitSessionGapsByCenter,
  tallySessionGaps,
  type SessionGapRow,
  type SessionGapScanRow,
} from "@/lib/dashboard/tuong-tac/session-gaps";

// ─── Bàn thử: một Prisma giả ghi lại mọi `where` được truyền vào ────────────────────

type Call = { model: string; args: Record<string, unknown> };

const calls: Call[] = [];
const data = {
  /** Buổi trong CỬA SỔ ngày (truy vấn có `where.date`). */
  windowSessions: [] as unknown[],
  /** Toàn bộ buổi của các lớp liên quan (để đánh số buổi) — truy vấn KHÔNG có `where.date`. */
  allClassSessions: [] as unknown[],
  enrollment: [] as unknown[],
  attendance: [] as unknown[],
  feedback: [] as unknown[],
  media: [] as unknown[],
  user: [] as unknown[],
  center: [] as unknown[],
};

function record(model: string, args: unknown) {
  calls.push({ model, args: (args ?? {}) as Record<string, unknown> });
}

const fakeDb = {
  classSession: {
    findMany: vi.fn(async (args: Record<string, unknown>) => {
      record("classSession", args);
      const where = (args?.where ?? {}) as Record<string, unknown>;
      return "date" in where ? data.windowSessions : data.allClassSessions;
    }),
  },
  enrollment: {
    findMany: vi.fn(async (args: unknown) => (record("enrollment", args), data.enrollment)),
  },
  attendance: {
    findMany: vi.fn(async (args: unknown) => (record("attendance", args), data.attendance)),
  },
  studentSessionFeedback: {
    findMany: vi.fn(async (args: unknown) => (record("feedback", args), data.feedback)),
  },
  classSessionMedia: {
    findMany: vi.fn(async (args: unknown) => (record("media", args), data.media)),
  },
  user: { findMany: vi.fn(async (args: unknown) => (record("user", args), data.user)) },
  center: { findMany: vi.fn(async (args: unknown) => (record("center", args), data.center)) },
};

function callOf(model: string, index = 0): Call | undefined {
  return calls.filter((c) => c.model === model)[index];
}

beforeEach(() => {
  calls.length = 0;
  data.windowSessions = [];
  data.allClassSessions = [];
  data.enrollment = [];
  data.attendance = [];
  data.feedback = [];
  data.media = [];
  data.user = [];
  data.center = [];
});

// ─── Dữ liệu mẫu ────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-20T05:00:00.000Z"); // 12:00 giờ VN, thứ Năm

const actor = {
  userId: "u1",
  isSuperAdmin: false,
  isHoLevel: false,
  visibleCenterIds: ["cs1", "cs2"],
} as unknown as Actor;

function filters(over: Partial<ScopeFilters> = {}): ScopeFilters {
  return {
    centerIds: ["cs1", "cs2"],
    isAllCenters: true,
    dateFrom: new Date("2026-08-01T17:00:00.000Z"),
    dateTo: new Date("2026-08-20T16:59:59.999Z"),
    groupByCenter: false,
    ...over,
  };
}

let seq = 0;
function scanRow(over: Partial<SessionGapScanRow> = {}): SessionGapScanRow {
  seq += 1;
  return {
    id: `s${seq}`,
    classId: "c1",
    centerId: "cs1",
    date: new Date("2026-08-10T10:00:00.000Z"),
    status: "SCHEDULED",
    topic: null,
    substituteTeacherId: null,
    actualTeacherId: null,
    plan: null,
    lesson: null,
    class: { name: "Sata 1 — T3T5", classCode: "S1-01", teacherId: "gv1" },
    ...over,
  };
}

/** Ráp `buildSessionGapRows` với mặc định "lớp có 1 học viên, chưa ai làm gì". */
function build(
  sessions: SessionGapScanRow[],
  over: Partial<Parameters<typeof buildSessionGapRows>[0]> = {},
): SessionGapRow[] {
  const rosterOf = new Map<string, ReadonlySet<string>>();
  for (const s of sessions) rosterOf.set(s.classId, new Set(["hv1"]));
  return buildSessionGapRows({
    sessions,
    numberOf: new Map(sessions.map((s, i) => [s.id, i + 1])),
    rosterOf,
    attendanceOf: new Map(),
    feedbackOf: new Map(),
    mediaOf: new Map(),
    teacherNameOf: new Map([["gv1", "Cô Lan"]]),
    now: NOW,
    ...over,
  });
}

// ════════════════════════════════════════════════════════════════════════════════════
// (1) ĐO ĐÚNG VIỆC — không đo "đã bấm nút Hoàn tất buổi"
// ════════════════════════════════════════════════════════════════════════════════════

describe("[E-01] đếm ĐÚNG hai việc: chưa điểm danh · chưa đánh giá", () => {
  it("🔴 buổi ĐÃ bấm COMPLETED nhưng chưa ai nhận xét VẪN là buổi còn thiếu", () => {
    // Ca này chính là thứ `sessionIncomplete` bỏ sót: nó chỉ nhìn `status`.
    const s = scanRow({ status: "COMPLETED" });
    const rows = build([s], {
      attendanceOf: new Map([[s.id, [{ studentId: "hv1", status: "PRESENT" }]]]),
      mediaOf: new Map([[s.id, { classWide: true, tagged: new Set<string>() }]]),
    });
    expect(rows[0]!.attendanceDone).toBe(true);
    expect(rows[0]!.feedbackDone).toBe(false);
    expect(rows[0]!.phase).toBe("PENDING");

    const c = tallySessionGaps(rows);
    expect(c.pending).toBe(1);
    expect(c.missingAttendance).toBe(0);
    expect(c.missingFeedback).toBe(1);
  });

  it("🔴 buổi đủ CẢ BA việc mà quên bấm nút KHÔNG bị đếm là còn thiếu", () => {
    const s = scanRow({ status: "SCHEDULED" });
    const rows = build([s], {
      attendanceOf: new Map([[s.id, [{ studentId: "hv1", status: "PRESENT" }]]]),
      feedbackOf: new Map([[s.id, ["hv1"]]]),
      mediaOf: new Map([[s.id, { classWide: true, tagged: new Set<string>() }]]),
    });
    expect(rows[0]!.phase).toBe("DONE");
    expect(tallySessionGaps(rows).pending).toBe(0);
  });

  it("điểm danh THIẾU một em vẫn là 'chưa điểm danh' (so danh sách, không so số)", () => {
    const s = scanRow();
    const rows = build([s], {
      rosterOf: new Map([["c1", new Set(["hv1", "hv2"])]]),
      // học viên học bù từ lớp khác cũng sinh bản ghi → 2 dòng nhưng thiếu hv2
      attendanceOf: new Map([
        [
          s.id,
          [
            { studentId: "hv1", status: "PRESENT" },
            { studentId: "hv-bu", status: "PRESENT" },
          ],
        ],
      ]),
    });
    expect(rows[0]!.attendanceDone).toBe(false);
    expect(tallySessionGaps(rows).missingAttendance).toBe(1);
  });

  it("em VẮNG không cần nhận xét — buổi cả lớp đi trừ một em vắng vẫn xong được", () => {
    const s = scanRow();
    const rows = build([s], {
      rosterOf: new Map([["c1", new Set(["hv1", "hv2"])]]),
      attendanceOf: new Map([
        [
          s.id,
          [
            { studentId: "hv1", status: "PRESENT" },
            { studentId: "hv2", status: "ABSENT" },
          ],
        ],
      ]),
      feedbackOf: new Map([[s.id, ["hv1"]]]),
      mediaOf: new Map([[s.id, { classWide: true, tagged: new Set<string>() }]]),
    });
    expect(rows[0]!.phase).toBe("DONE");
  });

  it("buổi CHƯA TỚI GIỜ không bị tính là 'chưa điểm danh'", () => {
    // Nếu đếm mọi buổi thiếu việc thì mỗi buổi tương lai đều 'thiếu' cả ba —
    // con số phồng lên theo lịch đã xếp, vô nghĩa.
    const rows = build([
      scanRow({ date: new Date("2026-08-25T10:00:00.000Z") }), // UPCOMING
      scanRow({ date: new Date("2026-08-20T11:00:00.000Z") }), // TODAY (18h VN)
    ]);
    const c = tallySessionGaps(rows);
    expect(c.pending).toBe(0);
    expect(c.missingAttendance).toBe(0);
    expect(c.missingFeedback).toBe(0);
    expect(c.upcoming).toBe(2);
  });

  it("buổi ĐÃ HUỶ và lớp KHÔNG CÒN HỌC VIÊN không phải việc còn nợ", () => {
    const rows = build([
      scanRow({ status: "CANCELLED" }),
      scanRow({ classId: "c-trong" }),
    ], {
      rosterOf: new Map([["c1", new Set(["hv1"])], ["c-trong", new Set<string>()]]),
    });
    const c = tallySessionGaps(rows);
    expect(c.pending).toBe(0);
    expect(c.cancelled).toBe(1);
    expect(c.noRoster).toBe(1);
    expect(c.scanned).toBe(2);
  });

  it("một buổi thiếu cả ba việc chỉ cộng 1 vào `pending` nhưng 1 vào từng chip", () => {
    const rows = build([scanRow()]);
    const c = tallySessionGaps(rows);
    expect(c).toMatchObject({
      pending: 1,
      missingAttendance: 1,
      missingFeedback: 1,
      missingMedia: 1,
    });
  });

  it("bảng đếm rỗng có đủ mọi khoá (không undefined rơi vào phép cộng)", () => {
    expect(tallySessionGaps([])).toEqual(emptySessionGapCounts());
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
// (2) CỘT GIÁO VIÊN PHỤ TRÁCH
// ════════════════════════════════════════════════════════════════════════════════════

describe("[E-01] cột giáo viên phụ trách", () => {
  it("dạy thay THẮNG giáo viên của lớp, và tên tra được", () => {
    const rows = build([scanRow({ substituteTeacherId: "gv2" })], {
      teacherNameOf: new Map([
        ["gv1", "Cô Lan"],
        ["gv2", "Thầy Bình"],
      ]),
    });
    expect(rows[0]!.teacherId).toBe("gv2");
    expect(rows[0]!.teacherName).toBe("Thầy Bình");
    expect(rows[0]!.teacherSource).toBe("SUBSTITUTE");
  });

  it("lớp chưa phân công giáo viên → tên rỗng, KHÔNG ném lỗi", () => {
    const rows = build([
      scanRow({ class: { name: "Lớp mới", classCode: null, teacherId: null } }),
    ]);
    expect(rows[0]!.teacherId).toBe(null);
    expect(rows[0]!.teacherName).toBe("");
    expect(rows[0]!.teacherSource).toBe("NONE");
  });

  it("có teacherId mà không tra được tên → giữ id, tên rỗng (không hiện 'undefined')", () => {
    const rows = build([scanRow({ actualTeacherId: "gv-la" })], {
      teacherNameOf: new Map(),
    });
    expect(rows[0]!.teacherId).toBe("gv-la");
    expect(rows[0]!.teacherName).toBe("");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
// (3) THỨ TỰ + PHÂN TRANG (bỏ trần 50)
// ════════════════════════════════════════════════════════════════════════════════════

describe("[E-01] thứ tự và phân trang", () => {
  it("việc còn nợ lên trước buổi sắp tới (dùng chung thứ tự của attendance-queue)", () => {
    const rows = build([
      scanRow({ date: new Date("2026-08-25T10:00:00.000Z") }),
      scanRow({ date: new Date("2026-08-10T10:00:00.000Z") }),
    ]);
    expect(rows.map((r) => r.phase)).toEqual(["PENDING", "UPCOMING"]);
  });

  it("cắt trang không đổi thứ tự, và trang 3 lấy đúng dòng 101-150", () => {
    const rows = Array.from({ length: 260 }, (_, i) => ({ id: `r${i}` }));
    const p = paginateSessionGaps(rows, 3, 50);
    expect(p.rows[0]!.id).toBe("r100");
    expect(p.rows).toHaveLength(50);
    expect(p.page).toBe(3);
    expect(p.pageCount).toBe(6);
    expect(p.total).toBe(260);
  });

  it("trang vượt biên bị kẹp về trang cuối — không trả bảng trắng", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}` }));
    expect(paginateSessionGaps(rows, 99, 5).page).toBe(3);
    expect(paginateSessionGaps(rows, 0, 5).page).toBe(1);
    expect(paginateSessionGaps(rows, Number.NaN, 5).page).toBe(1);
  });

  it("danh sách rỗng vẫn có pageCount 1 (không chia cho 0)", () => {
    const p = paginateSessionGaps([], 1, 50);
    expect(p.pageCount).toBe(1);
    expect(p.total).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
// (4) TẦNG DB — phạm vi, khoảng ngày, không trần 50, tách theo cơ sở
// ════════════════════════════════════════════════════════════════════════════════════

/** 120 buổi PENDING ở cs1 + 30 ở cs2, tất cả trong khoảng ngày. */
function seedManyPendingSessions() {
  const sessions: SessionGapScanRow[] = [];
  for (let i = 0; i < 120; i++) {
    sessions.push(
      scanRow({ classId: "c1", centerId: "cs1", date: new Date("2026-08-10T10:00:00.000Z") }),
    );
  }
  for (let i = 0; i < 30; i++) {
    sessions.push(
      scanRow({ classId: "c2", centerId: "cs2", date: new Date("2026-08-11T10:00:00.000Z") }),
    );
  }
  data.windowSessions = sessions;
  data.allClassSessions = sessions.map((s) => ({
    id: s.id,
    classId: s.classId,
    date: s.date,
  }));
  data.enrollment = [
    { classId: "c1", studentId: "hv1" },
    { classId: "c2", studentId: "hv2" },
  ];
  data.center = [
    { id: "cs1", name: "CS1" },
    { id: "cs2", name: "CS2" },
  ];
  data.user = [{ id: "gv1", name: "Cô Lan" }];
  return sessions;
}

describe("[E-01] tầng DB", () => {
  it("🔴 lọc theo KHOẢNG NGÀY của bộ lọc, KHÔNG phải `date < hôm nay`", async () => {
    const f = filters();
    await countSessionGaps(actor, f, { now: NOW });
    const where = callOf("classSession")!.args.where as Record<string, unknown>;
    expect(where.date).toEqual({ gte: f.dateFrom, lte: f.dateTo });
  });

  it("🔴 lọc ĐA CƠ SỞ bằng `centerId IN`, không đọc một centerId đơn trị", async () => {
    await countSessionGaps(actor, filters({ centerIds: ["cs1", "cs2"] }), { now: NOW });
    const where = callOf("classSession")!.args.where as Record<string, unknown>;
    expect(where.centerId).toEqual({ in: ["cs1", "cs2"] });
  });

  it("🔴 KHÔNG có trần 50: đếm ra 150 dù chỉ hiện 50 dòng mỗi trang", async () => {
    seedManyPendingSessions();
    const r = await listSessionGaps(actor, filters(), { now: NOW });
    expect(r.counts.pending).toBe(150);
    expect(r.total).toBe(150);
    expect(r.rows).toHaveLength(SESSION_GAP_PAGE_SIZE);
    expect(r.pageCount).toBe(3);
    // và truy vấn nguồn không được cầm `take: 50`
    expect(callOf("classSession")!.args.take).toBeGreaterThan(SESSION_GAP_PAGE_SIZE);
  });

  it("phạm vi RỖNG → trả 0 mà KHÔNG chạm DB (fail-closed, không quét toàn hệ)", async () => {
    const r = await countSessionGaps(actor, filters({ centerIds: [] }), { now: NOW });
    expect(r.counts).toEqual(emptySessionGapCounts());
    expect(calls).toHaveLength(0);
  });

  it("`groupByCenter` bật → có bảng tách theo cơ sở; tắt → null", async () => {
    seedManyPendingSessions();
    const gop = await countSessionGaps(actor, filters({ groupByCenter: false }), { now: NOW });
    expect(gop.byCenter).toBe(null);

    calls.length = 0;
    const tach = await countSessionGaps(actor, filters({ groupByCenter: true }), { now: NOW });
    expect(tach.byCenter).toEqual([
      { centerId: "cs1", centerName: "CS1", counts: expect.objectContaining({ pending: 120 }) },
      { centerId: "cs2", centerName: "CS2", counts: expect.objectContaining({ pending: 30 }) },
    ]);
    // Tổng vẫn là tổng — tách không được làm đổi con số chung.
    expect(tach.counts.pending).toBe(150);
  });

  it("🔴 AC E-01-3 — con số của thẻ KHỚP tổng của danh sách khi bấm vào", async () => {
    seedManyPendingSessions();
    const dem = await countSessionGaps(actor, filters(), { now: NOW });
    calls.length = 0;
    const ds = await listSessionGaps(actor, filters(), { now: NOW, page: 2 });
    expect(ds.total).toBe(dem.counts.pending + dem.counts.upcoming);
    expect(ds.counts).toEqual(dem.counts);
  });

  it("danh sách chỉ bày 3 bậc spec đòi: còn nợ việc + hôm nay + sắp tới", async () => {
    data.windowSessions = [
      scanRow({ date: new Date("2026-08-10T10:00:00.000Z") }), // PENDING
      scanRow({ date: new Date("2026-08-20T11:00:00.000Z") }), // TODAY
      scanRow({ date: new Date("2026-08-25T10:00:00.000Z") }), // UPCOMING
      scanRow({ status: "CANCELLED" }), // CANCELLED — không bày
    ];
    data.allClassSessions = data.windowSessions;
    data.enrollment = [{ classId: "c1", studentId: "hv1" }];
    const r = await listSessionGaps(actor, filters(), { now: NOW });
    expect(r.rows.map((x) => x.phase)).toEqual(SESSION_GAP_LIST_PHASES);
  });

  it("số buổi tra trên TOÀN BỘ buổi của lớp, không chỉ buổi lọt cửa sổ ngày", async () => {
    // Buổi ngày 10/08 là buổi thứ 3 của lớp; cửa sổ chỉ chứa mình nó.
    const s = scanRow({ date: new Date("2026-08-10T10:00:00.000Z") });
    data.windowSessions = [s];
    data.allClassSessions = [
      { id: "cu1", classId: "c1", date: new Date("2026-07-01T10:00:00.000Z") },
      { id: "cu2", classId: "c1", date: new Date("2026-07-08T10:00:00.000Z") },
      { id: s.id, classId: "c1", date: s.date },
    ];
    data.enrollment = [{ classId: "c1", studentId: "hv1" }];
    const r = await listSessionGaps(actor, filters(), { now: NOW });
    expect(r.rows[0]!.number).toBe(3);
    // truy vấn đánh số phải lọc theo classId, KHÔNG kèm điều kiện ngày
    const soBuoi = callOf("classSession", 1)!.args.where as Record<string, unknown>;
    expect(soBuoi).not.toHaveProperty("date");
    expect(soBuoi.classId).toEqual({ in: ["c1"] });
  });

  it("quét chạm trần an toàn → báo `truncated`, không im lặng cắt số", async () => {
    data.windowSessions = Array.from({ length: SESSION_GAP_SCAN_MAX + 1 }, () => scanRow());
    data.allClassSessions = [];
    data.enrollment = [{ classId: "c1", studentId: "hv1" }];
    const r = await countSessionGaps(actor, filters(), { now: NOW });
    expect(r.truncated).toBe(true);
    expect(r.counts.scanned).toBe(SESSION_GAP_SCAN_MAX);
  });

  it("ảnh BỊ TỪ CHỐI không được tính là đã có ảnh", async () => {
    seedManyPendingSessions();
    await countSessionGaps(actor, filters(), { now: NOW });
    const where = callOf("media")!.args.where as Record<string, unknown>;
    expect(where.status).toEqual({ not: "REJECTED" });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
// (5) Tách theo cơ sở — phần THUẦN
// ════════════════════════════════════════════════════════════════════════════════════

describe("[E-01] splitSessionGapsByCenter", () => {
  it("giữ NGUYÊN thứ tự cơ sở của bộ lọc và giữ cả cơ sở 0 buổi", () => {
    const rows = build([scanRow({ centerId: "cs2" })]);
    const g = splitSessionGapsByCenter(rows, ["cs1", "cs2"], { cs1: "CS1", cs2: "CS2" });
    expect(g.map((x) => x.centerId)).toEqual(["cs1", "cs2"]);
    expect(g[0]!.counts.scanned).toBe(0);
    expect(g[1]!.counts.scanned).toBe(1);
  });

  it("thiếu tên cơ sở → dùng id, không hiện 'undefined'", () => {
    const g = splitSessionGapsByCenter([], ["cs9"], {});
    expect(g[0]!.centerName).toBe("cs9");
  });
});
