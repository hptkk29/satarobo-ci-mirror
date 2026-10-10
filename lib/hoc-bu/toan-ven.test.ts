// [TV-*] — luật kiểm toàn vẹn học bù (T01). THUẦN: không Postgres, đồng hồ TRUYỀN VÀO (luật 19).
//
// ⚠️ CÁCH ĐỌC FILE NÀY: mọi ca đều xuất phát từ `sach()` — một thế giới KHÔNG có lỗi — rồi bẻ đúng
// MỘT chỗ. Hai việc làm bắt buộc kèm theo:
//   · `[TV-00]` khẳng định thế giới sạch ra ĐÚNG 0 phát hiện. Thiếu ca này thì một luật quá rộng
//     (báo mọi thứ) trông y hệt một luật đúng ở mọi ca "có lỗi → có phát hiện".
//   · Mỗi luật có ca ÂM (dữ liệu gần giống lỗi nhưng hợp lệ → KHÔNG báo). Luật chỉ có ca dương là
//     luật chưa được thử trên dữ liệu thật — dữ liệu thật hợp lệ nhiều hơn dữ liệu lỗi hàng chục lần.
import { describe, expect, it } from "vitest";
import {
  LUAT,
  LUAT_HOAN,
  chayToanVen,
  dungBaoCao,
  type CaseRow,
  type Finding,
  type MaLuat,
  type NeedRow,
  type Snapshot,
} from "@/lib/hoc-bu/toan-ven";
import { vnDateAt } from "@/lib/time/vn";

// ─── Đồng hồ cố định ─────────────────────────────────────────────────────────────────────────
/** 10:00 sáng 07/10/2026 giờ VN. */
const NOW = new Date("2026-10-07T03:00:00.000Z");
const TU_NGAY = "2026-09-20";
const O = { now: NOW, tuNgayYmd: TU_NGAY };

// ─── Nhà máy dữ liệu ─────────────────────────────────────────────────────────────────────────
const ngayCase = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

function need(p: Partial<NeedRow> & { id: string }): NeedRow {
  return {
    studentId: "hv-a",
    studentName: "Bé A",
    classId: "lop-1",
    className: "Lớp 1",
    courseId: "khoa-1",
    choPhepHocBu: true,
    lopDaXoa: false,
    lopDaHuy: false,
    centerId: "cs-1",
    missedSessionId: `bg-${p.id}`,
    missedLessonId: "bai-1",
    status: "PENDING",
    makeupSessionId: null,
    usedQuota: false,
    waivedAt: null,
    feeOrderItemId: null,
    freeApprovedAt: null,
    nguon: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    completedAt: null,
    // T05 — mặc định là dòng đời mới sinh từ điểm danh vắng, đã liên kết bản ghi điểm danh `att-<id>` của `sach()`.
    sourceType: "ABSENCE",
    originalAttendanceId: `att-${p.id}`,
    courseIdCuaDong: "khoa-1",
    ...p,
  };
}

function ca(p: Partial<CaseRow> & { id: string }): CaseRow {
  return {
    centerId: "cs-1",
    courseId: "khoa-1",
    lessonId: "bai-1",
    date: ngayCase("2026-10-15"),
    startTime: "18:00",
    endTime: "19:30",
    roomId: "phong-1",
    teacherId: "gv-1",
    status: "SCHEDULED",
    students: [],
    ...p,
  };
}

/**
 * Thế giới SẠCH — ba dòng ở ba trạng thái, mỗi dòng nhất quán với mọi bản ghi quanh nó:
 *   · N-CHO  PENDING, chưa vào case, điểm danh gốc "cần bù"
 *   · N-XEP  SCHEDULED, đang chờ trong case tương lai
 *   · N-XONG COMPLETED, có mặt ở case đã dạy, điểm danh gốc VẪN LÀ "vắng có phép" + đã bù
 */
function sach(): Snapshot {
  const nCho = need({ id: "n-cho", studentId: "hv-1", studentName: "Bé Một" });
  const nXep = need({
    id: "n-xep",
    studentId: "hv-2",
    studentName: "Bé Hai",
    status: "SCHEDULED",
  });
  const nXong = need({
    id: "n-xong",
    studentId: "hv-3",
    studentName: "Bé Ba",
    status: "COMPLETED",
    usedQuota: true,
    completedAt: new Date("2026-10-02T12:00:00.000Z"),
  });
  const buoi = (n: NeedRow) => ({
    id: n.missedSessionId,
    classId: n.classId,
    date: new Date("2026-09-25T11:00:00.000Z"),
    lessonId: "bai-1",
    status: "COMPLETED",
  });
  return {
    needs: [nCho, nXep, nXong],
    cases: [
      // T07: case đã nâng lên mô hình nhiều bài — có bộ bài, bé tham gia, mục nối bé và mang kết quả tầng 2.
      ca({
        id: "case-sap",
        lessonIds: ["bai-1"],
        participants: [{ id: "be-xep", studentId: "hv-2", attendanceStatus: "PENDING" }],
        students: [{ id: "sv-xep", makeupNeedId: "n-xep", status: "PLACED", dungLuot: true, participantId: "be-xep", result: "PLANNED", lessonId: "bai-1" }],
      }),
      ca({
        id: "case-xong",
        date: ngayCase("2026-10-02"),
        status: "COMPLETED",
        lessonIds: ["bai-1"],
        participants: [{ id: "be-xong", studentId: "hv-3", attendanceStatus: "PRESENT" }],
        students: [{ id: "sv-xong", makeupNeedId: "n-xong", status: "PRESENT", dungLuot: true, participantId: "be-xong", result: "COMPLETED", lessonId: "bai-1" }],
      }),
    ],
    buoiGoc: [buoi(nCho), buoi(nXep), buoi(nXong)],
    lessonIdsConTon: new Set(["bai-1"]),
    roomIdsConTon: new Set(["phong-1"]),
    courseIdsConTon: new Set(["khoa-1"]),
    gvHoatDong: new Map([["gv-1", true]]),
    diemDanh: [
      { id: "att-n-cho", sessionId: "bg-n-cho", studentId: "hv-1", status: "ABSENT", makeupStatus: "NEEDS_MAKEUP" },
      { id: "att-n-xep", sessionId: "bg-n-xep", studentId: "hv-2", status: "ABSENT", makeupStatus: "NEEDS_MAKEUP" },
      { id: "att-n-xong", sessionId: "bg-n-xong", studentId: "hv-3", status: "ABSENT_EXCUSED", makeupStatus: "MADE_UP" },
    ],
    vangChuaCoDong: [],
    donPhi: [],
    donPhiMoCoi: [],
    donPh: [],
    buoiTrung: [],
    buoiTrungNgay: [],
    slotBuoi: [],
    lopCuaHocVien: new Map(),
    bangChungVangGoc: new Map(),
    // T06 — sổ khớp thế giới: hv-2 đang GIỮ 1 lượt (mục case PLACED bằng lượt), hv-3 đã TIÊU 1 (dòng usedQuota).
    soLuot: [
      { id: "tk-2", studentId: "hv-2", studentName: "Bé Hai", courseId: "khoa-1", granted: 2, held: 1, consumed: 0, tongBut: { granted: 2, held: 1, consumed: 0 } },
      { id: "tk-3", studentId: "hv-3", studentName: "Bé Ba", courseId: "khoa-1", granted: 2, held: 0, consumed: 1, tongBut: { granted: 2, held: 0, consumed: 1 } },
    ],
    // T12 — mặc định: chưa có kỳ nào chốt.
    // T14 — thế giới sạch: cả ba học viên còn ghi danh hiệu lực.
    ghiDanhHieuLuc: new Set(["hv-1|khoa-1", "hv-2|khoa-1", "hv-3|khoa-1"]),
    kyDaChot: [],
  };
}

/** Bẻ một chỗ của thế giới sạch. `structuredClone` giữ Map / Set / Date. */
function be(fn: (s: Snapshot) => void): Snapshot {
  const s = structuredClone(sach());
  fn(s);
  return s;
}

const chay = (s: Snapshot, o = O) => chayToanVen(s, o);
const ma = (r: { findings: Finding[] }) => [...new Set(r.findings.map((f) => f.luat))].sort();
const cua = (r: { findings: Finding[] }, m: MaLuat) => r.findings.filter((f) => f.luat === m);
const n = (s: Snapshot, id: string) => s.needs.find((x) => x.id === id)!;
const cs = (s: Snapshot, id: string) => s.cases.find((x) => x.id === id)!;

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-00] thế giới sạch", () => {
  it("ra ĐÚNG 0 phát hiện, và mọi luật đều có mặt trong bảng đếm", () => {
    const r = chay(sach());
    expect(r.findings, JSON.stringify(r.findings, null, 1)).toEqual([]);
    expect(Object.keys(r.demTheoLuat).sort()).toEqual(Object.keys(LUAT).sort());
    expect(Object.values(r.demTheoLuat).every((x) => x === 0)).toBe(true);
  });

  it("fixture CÓ đủ ba trạng thái dòng, hai case, ba điểm danh — nếu không, các ca dưới xanh vì không có gì để bẻ", () => {
    const s = sach();
    expect(s.needs.map((x) => x.status).sort()).toEqual(["COMPLETED", "PENDING", "SCHEDULED"]);
    expect(s.cases).toHaveLength(2);
    expect(s.diemDanh).toHaveLength(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-01..03] buổi gốc và bài", () => {
  it("[TV-01] buổi gốc bị xoá ⇒ HIGH INVALID, chỉ dòng đó", () => {
    const r = chay(be((s) => (s.buoiGoc = s.buoiGoc.filter((b) => b.id !== "bg-n-cho"))));
    const f = cua(r, "TV-01");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: "n-cho", nghiemTrong: "HIGH", phanLoai: "INVALID", thucThe: "MakeupNeed" });
    expect(ma(r)).toEqual(["TV-01"]);
  });

  it("[TV-02] bài của dòng không còn ⇒ HIGH; dòng CANCELLED thì bỏ qua", () => {
    const r = chay(be((s) => (n(s, "n-cho").missedLessonId = "bai-ma")));
    expect(cua(r, "TV-02")).toHaveLength(1);
    expect(cua(r, "TV-02")[0]).toMatchObject({ id: "n-cho", nghiemTrong: "HIGH", phanLoai: "NEEDS_MANUAL_REVIEW" });
    const huy = chay(
      be((s) => {
        n(s, "n-cho").missedLessonId = "bai-ma";
        n(s, "n-cho").status = "CANCELLED";
        n(s, "n-cho").waivedAt = new Date("2026-10-02T00:00:00Z");
      }),
    );
    expect(cua(huy, "TV-02")).toEqual([]);
  });

  it("[TV-03a] dòng thiếu bài nhưng buổi gốc có bài còn sống ⇒ AUTO_FIXABLE, đề xuất ĐIỀN CHỖ TRỐNG", () => {
    const r = chay(be((s) => (n(s, "n-cho").missedLessonId = null)));
    const f = cua(r, "TV-03");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ phanLoai: "AUTO_FIXABLE", nghiemTrong: "MEDIUM" });
    expect(f[0]!.deXuat).toContain("bai-1");
    expect(f[0]!.deXuat).toContain("không đổi giá trị đã có");
  });

  it("[TV-03b] cả dòng lẫn buổi gốc đều không có bài ⇒ NEEDS_MANUAL_REVIEW (không đoán bài)", () => {
    const r = chay(
      be((s) => {
        n(s, "n-cho").missedLessonId = null;
        s.buoiGoc.find((b) => b.id === "bg-n-cho")!.lessonId = null;
      }),
    );
    expect(cua(r, "TV-03")[0]).toMatchObject({ phanLoai: "NEEDS_MANUAL_REVIEW" });
  });

  it("[TV-03c] bài của dòng khác bài hiện tại của buổi ⇒ NEEDS_MANUAL_REVIEW, KHÔNG tự đồng bộ", () => {
    const r = chay(
      be((s) => {
        s.lessonIdsConTon.add("bai-2");
        s.buoiGoc.find((b) => b.id === "bg-n-cho")!.lessonId = "bai-2";
      }),
    );
    const f = cua(r, "TV-03");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ phanLoai: "NEEDS_MANUAL_REVIEW" });
    expect(f[0]!.lyDo).toContain("bai-1");
    expect(f[0]!.lyDo).toContain("bai-2");
  });

  it("[TV-03d] buổi gốc CHƯA có bài nhưng dòng có bài ⇒ không báo (dòng đúng, buổi chưa gán)", () => {
    const r = chay(be((s) => (s.buoiGoc.find((b) => b.id === "bg-n-cho")!.lessonId = null)));
    expect(cua(r, "TV-03")).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-04..07] phí", () => {
  /** Bé được xếp BẰNG PHÍ (không dùng lượt) — thế giới sạch xếp bằng lượt nên phải bẻ cờ này. */
  const xepBangPhi = (s: Snapshot, needId: string) => {
    for (const c of s.cases) for (const sv of c.students) if (sv.makeupNeedId === needId) sv.dungLuot = false;
  };
  const don = (p: Partial<Snapshot["donPhi"][number]> = {}) => ({
    itemId: "oi-1",
    orderId: "od-1",
    orderCode: "ORD-1",
    orderStatus: "PENDING_PAYMENT",
    orderDaXoa: false,
    tongTien: 1_980_000,
    daThu: 0,
    ...p,
  });

  it("[TV-04] trỏ đơn phí không còn ⇒ HIGH INVALID", () => {
    const r = chay(be((s) => (n(s, "n-cho").feeOrderItemId = "oi-ma")));
    expect(cua(r, "TV-04")).toHaveLength(1);
    expect(cua(r, "TV-04")[0]).toMatchObject({ id: "n-cho", phanLoai: "INVALID", nghiemTrong: "HIGH" });
  });

  it("[TV-05] đơn đã huỷ + dòng SCHEDULED ⇒ HIGH và đề xuất GỠ BÉ (quyết định 07/10), không tự sửa", () => {
    const r = chay(
      be((s) => {
        n(s, "n-xep").feeOrderItemId = "oi-1";
        xepBangPhi(s, "n-xep");
        s.donPhi = [don({ orderStatus: "CANCELLED" })];
      }),
    );
    const f = cua(r, "TV-05");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ nghiemTrong: "HIGH", phanLoai: "NEEDS_MANUAL_REVIEW", id: "n-xep" });
    expect(f[0]!.deXuat).toContain("gỡ khỏi case");
  });

  it("[TV-05] đơn hoàn tiền + dòng COMPLETED ⇒ HIGH và đề xuất KHÔNG đảo kết quả học", () => {
    const r = chay(
      be((s) => {
        n(s, "n-xong").feeOrderItemId = "oi-1";
        xepBangPhi(s, "n-xong");
        s.donPhi = [don({ orderStatus: "REFUNDED", daThu: 1_980_000 })];
      }),
    );
    const f = cua(r, "TV-05");
    expect(f[0]).toMatchObject({ nghiemTrong: "HIGH", id: "n-xong" });
    expect(f[0]!.lyDo).toContain("hoàn tiền");
    expect(f[0]!.deXuat).toContain("không đảo kết quả");
  });

  it("[TV-05] đơn bị XOÁ mềm cũng tính là chết", () => {
    const r = chay(
      be((s) => {
        n(s, "n-xep").feeOrderItemId = "oi-1";
        xepBangPhi(s, "n-xep");
        s.donPhi = [don({ orderDaXoa: true })];
      }),
    );
    expect(cua(r, "TV-05")[0]!.lyDo).toContain("bị xoá");
  });

  it("[TV-05] đơn đã huỷ nhưng dòng còn PENDING ⇒ LOW SAFE (tự lành, không phải việc)", () => {
    const r = chay(
      be((s) => {
        n(s, "n-cho").feeOrderItemId = "oi-1";
        s.donPhi = [don({ orderStatus: "CANCELLED" })];
      }),
    );
    expect(cua(r, "TV-05")[0]).toMatchObject({ nghiemTrong: "LOW", phanLoai: "SAFE" });
  });

  it("[TV-05] ÂM: đơn còn sống + dòng SCHEDULED ⇒ không báo", () => {
    const r = chay(
      be((s) => {
        n(s, "n-xep").feeOrderItemId = "oi-1";
        s.donPhi = [don({ daThu: 1_980_000 })];
      }),
    );
    expect(ma(r)).toEqual([]);
  });

  it("[TV-06] miễn phí + đơn phí sống chưa thu đủ ⇒ MEDIUM; thu đủ thì không báo", () => {
    const mien = (s: Snapshot, daThu: number) => {
      n(s, "n-cho").feeOrderItemId = "oi-1";
      n(s, "n-cho").freeApprovedAt = new Date("2026-10-03T00:00:00Z");
      s.donPhi = [don({ daThu })];
    };
    expect(cua(chay(be((s) => mien(s, 500_000))), "TV-06")).toHaveLength(1);
    expect(cua(chay(be((s) => mien(s, 1_980_000))), "TV-06")).toEqual([]);
  });

  it("[TV-07] đơn phí mồ côi còn sống ⇒ HIGH; nói rõ nếu ĐÃ THU tiền", () => {
    const moCoi = { ...don({ itemId: "oi-thua", orderId: "od-thua", orderCode: "ORD-THUA", daThu: 1_980_000 }), hocVienId: "hv-1", tenDong: "Phí học bù" };
    const r = chay(be((s) => (s.donPhiMoCoi = [moCoi])));
    const f = cua(r, "TV-07");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ nghiemTrong: "HIGH", thucThe: "OrderItem", id: "oi-thua" });
    expect(f[0]!.lyDo).toContain("ĐÃ THU");
  });

  it("[TV-07] ÂM: đơn có dòng trỏ tới, hoặc đã huỷ ⇒ không báo", () => {
    const moCoi = { ...don({ itemId: "oi-1" }), hocVienId: "hv-1", tenDong: "Phí học bù" };
    const duocTro = chay(
      be((s) => {
        n(s, "n-cho").feeOrderItemId = "oi-1";
        s.donPhi = [don()];
        s.donPhiMoCoi = [moCoi];
      }),
    );
    expect(cua(duocTro, "TV-07")).toEqual([]);
    const huy = chay(be((s) => (s.donPhiMoCoi = [{ ...moCoi, itemId: "oi-khac", orderStatus: "CANCELLED" }])));
    expect(cua(huy, "TV-07")).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-08..09] buổi vắng chưa có dòng, khoá tắt", () => {
  const vang = (p: Partial<Snapshot["vangChuaCoDong"][number]> = {}) => ({
    sessionId: "bg-moi",
    studentId: "hv-9",
    studentName: "Bé Chín",
    className: "Lớp 1",
    status: "ABSENT_EXCUSED",
    makeupStatus: "NEEDS_MAKEUP" as const,
    ngayVn: "2026-10-01",
    choPhepHocBu: true,
    lopDaXoa: false,
    ...p,
  });

  it("[TV-08] vắng CÓ PHÉP, chưa có dòng ⇒ MEDIUM AUTO_FIXABLE (chốt 02/10: mọi loại vắng đều cần bù)", () => {
    const r = chay(be((s) => (s.vangChuaCoDong = [vang()])));
    const f = cua(r, "TV-08");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ phanLoai: "AUTO_FIXABLE", nghiemTrong: "MEDIUM", thucThe: "Attendance" });
    expect(f[0]!.deXuat).toContain("bu-vang-tu-ngay");
  });

  it("[TV-08] ÂM: đã có dòng / khoá tắt học bù / lớp đã xoá ⇒ không báo", () => {
    expect(cua(chay(be((s) => (s.vangChuaCoDong = [vang({ sessionId: "bg-n-cho", studentId: "hv-1" })]))), "TV-08")).toEqual([]);
    expect(cua(chay(be((s) => (s.vangChuaCoDong = [vang({ choPhepHocBu: false })]))), "TV-08")).toEqual([]);
    expect(cua(chay(be((s) => (s.vangChuaCoDong = [vang({ lopDaXoa: true })]))), "TV-08")).toEqual([]);
  });

  it("[TV-09] dòng PENDING của khoá tắt học bù ⇒ LOW SAFE; lớp đã xoá thì không báo", () => {
    expect(cua(chay(be((s) => (n(s, "n-cho").choPhepHocBu = false))), "TV-09")[0]).toMatchObject({ nghiemTrong: "LOW", phanLoai: "SAFE" });
    expect(
      cua(
        chay(
          be((s) => {
            n(s, "n-cho").choPhepHocBu = false;
            n(s, "n-cho").lopDaXoa = true;
          }),
        ),
        "TV-09",
      ),
    ).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-10..13] vòng đời case", () => {
  it("[TV-10] case SCHEDULED không còn bé ⇒ HIGH AUTO_FIXABLE", () => {
    const r = chay(
      be((s) => {
        cs(s, "case-sap").students = [];
      }),
    );
    expect(cua(r, "TV-10")).toHaveLength(1);
    expect(cua(r, "TV-10")[0]).toMatchObject({ id: "case-sap", nghiemTrong: "HIGH", phanLoai: "AUTO_FIXABLE" });
    // Case rỗng là TV-10, KHÔNG phải "kẹt" (TV-11) — hai việc khác nhau, hai cách xử lý.
    expect(cua(r, "TV-11")).toEqual([]);
  });

  it("[TV-10] ÂM: case CANCELLED hoặc COMPLETED rỗng không bị báo", () => {
    for (const st of ["CANCELLED", "COMPLETED"] as const) {
      const r = chay(
        be((s) => {
          cs(s, "case-sap").students = [];
          cs(s, "case-sap").status = st;
        }),
      );
      expect(cua(r, "TV-10")).toEqual([]);
    }
  });

  it("[TV-11] mọi bé đã điểm danh mà case vẫn SCHEDULED ⇒ CRITICAL; có mặt thì đề xuất COMPLETED", () => {
    const r = chay(
      be((s) => {
        cs(s, "case-sap").students[0]!.status = "PRESENT";
        n(s, "n-xep").status = "COMPLETED"; // giữ TV-15 yên
        n(s, "n-xep").usedQuota = true;
      }),
    );
    const f = cua(r, "TV-11");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ nghiemTrong: "CRITICAL", phanLoai: "AUTO_FIXABLE" });
    expect(f[0]!.deXuat).toContain("COMPLETED");
  });

  it("[TV-11] toàn bé vắng ⇒ đề xuất CANCELLED; còn bé PLACED ⇒ không báo", () => {
    const toanVang = chay(
      be((s) => {
        cs(s, "case-sap").students[0]!.status = "ABSENT";
        n(s, "n-xep").status = "PENDING";
      }),
    );
    expect(cua(toanVang, "TV-11")[0]!.deXuat).toContain("CANCELLED");
    expect(cua(chay(sach()), "TV-11")).toEqual([]);
  });

  it("[TV-12] case ở tương lai mà đã có bé điểm danh ⇒ HIGH; chỉ có bé PLACED thì không", () => {
    const r = chay(
      be((s) => {
        cs(s, "case-sap").students.push({ id: "sv-2", makeupNeedId: "n-cho", status: "PRESENT", dungLuot: true });
        n(s, "n-cho").status = "COMPLETED";
        n(s, "n-cho").usedQuota = true;
        s.diemDanh[0]!.makeupStatus = "MADE_UP";
        s.diemDanh[0]!.status = "ABSENT";
      }),
    );
    expect(cua(r, "TV-12")).toHaveLength(1);
    expect(cua(r, "TV-12")[0]).toMatchObject({ id: "case-sap", nghiemTrong: "HIGH" });
    expect(cua(chay(sach()), "TV-12")).toEqual([]);
  });

  it("[TV-12] ranh giới: case HÔM NAY đã điểm danh không bị coi là tương lai", () => {
    const r = chay(
      be((s) => {
        cs(s, "case-sap").date = ngayCase("2026-10-07");
        cs(s, "case-sap").students[0]!.status = "PRESENT";
        n(s, "n-xep").status = "COMPLETED";
        n(s, "n-xep").usedQuota = true;
      }),
    );
    expect(cua(r, "TV-12")).toEqual([]);
  });

  it("[TV-13] case quá giờ còn bé PLACED ⇒ MEDIUM; chưa tới giờ kết thúc hôm nay thì không", () => {
    const qua = chay(be((s) => (cs(s, "case-sap").date = ngayCase("2026-10-01"))));
    expect(cua(qua, "TV-13")).toHaveLength(1);
    expect(cua(qua, "TV-13")[0]).toMatchObject({ nghiemTrong: "MEDIUM", phanLoai: "NEEDS_MANUAL_REVIEW" });
    // NOW = 10:00 VN. Case hôm nay 18:00–19:30 chưa tới giờ ⇒ không báo; case 08:00–09:30 đã qua ⇒ báo.
    const chuaToi = chay(be((s) => (cs(s, "case-sap").date = ngayCase("2026-10-07"))));
    expect(cua(chuaToi, "TV-13")).toEqual([]);
    const daQua = chay(
      be((s) => {
        cs(s, "case-sap").date = ngayCase("2026-10-07");
        cs(s, "case-sap").startTime = "08:00";
        cs(s, "case-sap").endTime = "09:30";
      }),
    );
    expect(cua(daQua, "TV-13")).toHaveLength(1);
  });

  it("[TV-13] ÂM: case quá giờ mà KHÔNG còn bé chờ thì là việc của TV-10/TV-11, không báo thêm TV-13", () => {
    const r = chay(
      be((s) => {
        cs(s, "case-sap").date = ngayCase("2026-10-01");
        cs(s, "case-sap").students = [];
      }),
    );
    expect(cua(r, "TV-10")).toHaveLength(1);
    expect(cua(r, "TV-13")).toEqual([]);
  });

  it("[TV-13] ranh giới giờ: kết thúc ĐÚNG bây giờ thì chưa tính là quá hạn", () => {
    const r = chay(
      be((s) => {
        cs(s, "case-sap").date = ngayCase("2026-10-07");
        cs(s, "case-sap").startTime = "09:00";
        cs(s, "case-sap").endTime = "10:00"; // NOW = 10:00 VN
      }),
    );
    expect(cua(r, "TV-13")).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-14..19] bé trong case", () => {
  it("[TV-14] cơ sở / khoá / bài lệch ⇒ HIGH, nêu ĐÚNG vế lệch", () => {
    const cuaVe = (fn: (s: Snapshot) => void) => cua(chay(be(fn)), "TV-14");
    const cu = cuaVe((s) => (n(s, "n-xep").centerId = "cs-2"));
    expect(cu).toHaveLength(1);
    expect(cu[0]!.lyDo).toContain("cơ sở");
    expect(cu[0]!.lyDo).not.toContain("khoá");
    expect(cuaVe((s) => (n(s, "n-xep").courseId = "khoa-2"))[0]!.lyDo).toContain("khoá");
    const b = cuaVe((s) => (n(s, "n-xep").missedLessonId = "bai-9"));
    expect(b[0]!.lyDo).toContain("bài");
    expect(b[0]).toMatchObject({ thucThe: "MakeupCaseStudent", id: "sv-xep", nghiemTrong: "HIGH" });
  });

  it("[TV-14] ÂM: case CANCELLED không bị soi", () => {
    const r = chay(
      be((s) => {
        n(s, "n-xep").centerId = "cs-2";
        cs(s, "case-sap").status = "CANCELLED";
      }),
    );
    expect(cua(r, "TV-14")).toEqual([]);
  });

  it("[TV-15a] bé PLACED mà dòng không SCHEDULED ⇒ CRITICAL INVALID; cả PENDING lẫn CANCELLED", () => {
    for (const st of ["PENDING", "CANCELLED"] as const) {
      const r = chay(be((s) => (n(s, "n-xep").status = st)));
      const f = cua(r, "TV-15").filter((x) => x.thucThe === "MakeupCaseStudent");
      expect(f, st).toHaveLength(1);
      expect(f[0]).toMatchObject({ nghiemTrong: "CRITICAL", phanLoai: "INVALID" });
    }
  });

  it("[TV-15b] dòng SCHEDULED không còn bé PLACED ⇒ AUTO_FIXABLE về PENDING; đã có người CÓ MẶT thì NEEDS_MANUAL_REVIEW", () => {
    const moCoi = chay(be((s) => (cs(s, "case-sap").students = [])));
    const f = cua(moCoi, "TV-15").filter((x) => x.thucThe === "MakeupNeed");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ phanLoai: "AUTO_FIXABLE", id: "n-xep" });
    const coMat = chay(be((s) => (cs(s, "case-sap").students[0]!.status = "PRESENT")));
    expect(cua(coMat, "TV-15").find((x) => x.thucThe === "MakeupNeed")).toMatchObject({ phanLoai: "NEEDS_MANUAL_REVIEW" });
  });

  it("[TV-15c] dòng SCHEDULED của luồng CŨ (có makeupSessionId) bị bỏ qua và ĐƯỢC ĐẾM, không im lặng", () => {
    const r = chay(
      be((s) => {
        cs(s, "case-sap").students = [];
        n(s, "n-xep").makeupSessionId = "buoi-bu-cu";
      }),
    );
    expect(cua(r, "TV-15")).toEqual([]);
    expect(r.boQuaLuongCu).toBe(1);
    expect(dungBaoCao(r, { db: "x", nhanh: "y", luc: "z", tuNgayYmd: TU_NGAY })).toContain("luồng học bù CŨ");
  });

  it("[TV-16] COMPLETED không có buổi bù có mặt ⇒ MEDIUM; luồng cũ thì bỏ qua", () => {
    const r = chay(be((s) => (cs(s, "case-xong").students[0]!.status = "ABSENT")));
    expect(cua(r, "TV-16")).toHaveLength(1);
    expect(cua(r, "TV-16")[0]).toMatchObject({ id: "n-xong", nghiemTrong: "MEDIUM", phanLoai: "NEEDS_MANUAL_REVIEW" });
    const cu = chay(
      be((s) => {
        cs(s, "case-xong").students = [];
        n(s, "n-xong").makeupSessionId = "buoi-bu-cu";
      }),
    );
    expect(cua(cu, "TV-16")).toEqual([]);
  });

  it("[TV-17a] usedQuota mà dòng chưa COMPLETED ⇒ HIGH (mất lượt mà chưa học)", () => {
    const r = chay(be((s) => (n(s, "n-cho").usedQuota = true)));
    expect(cua(r, "TV-17")).toHaveLength(1);
    expect(cua(r, "TV-17")[0]).toMatchObject({ id: "n-cho", nghiemTrong: "HIGH", phanLoai: "NEEDS_MANUAL_REVIEW" });
  });

  it("[TV-17b] học bù bằng lượt mà usedQuota=false ⇒ AUTO_FIXABLE; học bằng phí/miễn phí (dungLuot=false) thì KHÔNG báo", () => {
    const quen = chay(be((s) => (n(s, "n-xong").usedQuota = false)));
    expect(cua(quen, "TV-17")[0]).toMatchObject({ phanLoai: "AUTO_FIXABLE", nghiemTrong: "MEDIUM" });
    const traPhi = chay(
      be((s) => {
        n(s, "n-xong").usedQuota = false;
        cs(s, "case-xong").students[0]!.dungLuot = false;
      }),
    );
    expect(cua(traPhi, "TV-17")).toEqual([]);
  });

  it("[TV-18] case trỏ giáo viên / phòng / bài / khoá không còn", () => {
    const loi = (fn: (s: Snapshot) => void) => cua(chay(be(fn)), "TV-18");
    const gvMat = loi((s) => s.gvHoatDong.delete("gv-1"));
    expect(gvMat.map((f) => f.id)).toEqual(["case-sap", "case-xong"]);
    expect(gvMat[0]).toMatchObject({ nghiemTrong: "HIGH" });
    expect(loi((s) => s.gvHoatDong.set("gv-1", false))[0]).toMatchObject({ nghiemTrong: "MEDIUM" });
    expect(loi((s) => s.roomIdsConTon.clear())[0]!.lyDo).toContain("phòng");
    expect(loi((s) => s.courseIdsConTon.clear())[0]!.lyDo).toContain("khoá");
    // Bài biến mất làm hỏng TV-02/TV-14 của dòng; ở case nó vẫn phải được nêu.
    expect(loi((s) => s.lessonIdsConTon.delete("bai-1"))[0]!.lyDo).toContain("bài");
  });

  it("[TV-18] ÂM: case CANCELLED không bị soi (đã huỷ thì giáo viên / phòng không còn là việc); case không phòng thì không đòi phòng", () => {
    const huy = chay(
      be((s) => {
        s.gvHoatDong.set("gv-1", false);
        s.roomIdsConTon.clear();
        cs(s, "case-sap").status = "CANCELLED";
        cs(s, "case-xong").status = "CANCELLED";
      }),
    );
    expect(cua(huy, "TV-18")).toEqual([]);
    expect(cua(chay(be((s) => (cs(s, "case-sap").roomId = null))), "TV-18")).toEqual([]);
  });

  it("[TV-19] bé PLACED thuộc lớp đã huỷ hoặc xoá ⇒ HIGH và KHÔNG đề xuất huỷ mù", () => {
    for (const cot of ["lopDaHuy", "lopDaXoa"] as const) {
      const r = chay(be((s) => (n(s, "n-xep")[cot] = true)));
      const f = cua(r, "TV-19");
      expect(f, cot).toHaveLength(1);
      expect(f[0]).toMatchObject({ nghiemTrong: "HIGH", phanLoai: "NEEDS_MANUAL_REVIEW" });
      expect(f[0]!.deXuat).toContain("KHÔNG huỷ mù");
    }
  });

  it("[TV-19] ÂM: lớp bình thường ⇒ không báo; dòng đã CANCELLED + PLACED thuộc TV-15, không báo hai lần", () => {
    expect(cua(chay(sach()), "TV-19")).toEqual([]);
    const r = chay(
      be((s) => {
        n(s, "n-xep").status = "CANCELLED";
        n(s, "n-xep").lopDaHuy = true;
      }),
    );
    expect(cua(r, "TV-19")).toEqual([]);
    expect(cua(r, "TV-15").length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-20..22] buổi gốc", () => {
  const ghiDe = (s: Snapshot) => {
    s.diemDanh.find((a) => a.studentId === "hv-3")!.status = "PRESENT";
  };

  it("[TV-20] bù xong mà buổi gốc là PRESENT ⇒ HIGH NEEDS_MANUAL_REVIEW khi KHÔNG có bằng chứng — không đoán có phép hay không", () => {
    const r = chay(be(ghiDe));
    const f = cua(r, "TV-20");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ nghiemTrong: "HIGH", phanLoai: "NEEDS_MANUAL_REVIEW", thucThe: "Attendance" });
    expect(f[0]!.lyDo).toContain("Không có nhật ký audit");
    expect(f[0]!.deXuat).toContain("KHÔNG ĐOÁN");
  });

  it("[TV-20] có bằng chứng audit về trạng thái vắng ⇒ AUTO_FIXABLE, và đề xuất ĐÚNG trạng thái ghi trong nhật ký", () => {
    for (const goc of ["ABSENT_EXCUSED", "ABSENT_UNEXCUSED"]) {
      const r = chay(
        be((s) => {
          ghiDe(s);
          s.bangChungVangGoc.set("bg-n-xong|hv-3", [{ luc: new Date("2026-10-01T00:00:00Z"), cu: goc, moi: goc }]);
        }),
      );
      const f = cua(r, "TV-20");
      expect(f[0]).toMatchObject({ phanLoai: "AUTO_FIXABLE" });
      expect(f[0]!.deXuat).toContain(`status=${goc}`);
    }
  });

  it("[TV-20] bằng chứng cho thấy trạng thái cũ là CÓ MẶT ⇒ vẫn NEEDS_MANUAL_REVIEW (không phải bằng chứng của vắng)", () => {
    const r = chay(
      be((s) => {
        ghiDe(s);
        s.bangChungVangGoc.set("bg-n-xong|hv-3", [{ luc: new Date("2026-10-01T00:00:00Z"), cu: "PRESENT", moi: "PRESENT" }]);
      }),
    );
    expect(cua(r, "TV-20")[0]).toMatchObject({ phanLoai: "NEEDS_MANUAL_REVIEW" });
  });

  it("[TV-20] cả makeupStatus=NONE (mã cũ ghi đè luôn cờ) cũng là ghi đè; và không sinh TV-21 lặp", () => {
    const r = chay(
      be((s) => {
        ghiDe(s);
        s.diemDanh.find((a) => a.studentId === "hv-3")!.makeupStatus = "NONE";
      }),
    );
    expect(cua(r, "TV-20")).toHaveLength(1);
    expect(cua(r, "TV-21")).toEqual([]);
  });

  it("[TV-20] buổi gốc ghi đè + nhãn còn NEEDS_MAKEUP (cờ lệch) ⇒ chỉ MỘT phát hiện (TV-20), không báo lặp ở TV-21", () => {
    const r = chay(
      be((s) => {
        ghiDe(s);
        s.diemDanh.find((a) => a.studentId === "hv-3")!.makeupStatus = "NEEDS_MAKEUP";
      }),
    );
    expect(cua(r, "TV-20")).toHaveLength(1);
    expect(cua(r, "TV-21")).toEqual([]);
  });

  it("[TV-20] ÂM: dòng COMPLETED nhưng buổi gốc vẫn vắng ⇒ không báo (đúng như thiết kế đích)", () => {
    expect(cua(chay(sach()), "TV-20")).toEqual([]);
  });

  it("[TV-21] nhãn buổi gốc lệch dòng", () => {
    const dd = (s: Snapshot, hv: string) => s.diemDanh.find((a) => a.studentId === hv)!;
    const choXong = chay(be((s) => (dd(s, "hv-3").makeupStatus = "NEEDS_MAKEUP")));
    expect(cua(choXong, "TV-21")[0]).toMatchObject({ nghiemTrong: "HIGH", phanLoai: "NEEDS_MANUAL_REVIEW" });
    const daBuChuaXong = chay(be((s) => (dd(s, "hv-1").makeupStatus = "MADE_UP")));
    expect(cua(daBuChuaXong, "TV-21")[0]).toMatchObject({ nghiemTrong: "HIGH" });
    const huy = chay(
      be((s) => {
        n(s, "n-cho").status = "CANCELLED";
        n(s, "n-cho").waivedAt = new Date("2026-10-02T00:00:00Z");
      }),
    );
    expect(cua(huy, "TV-21")[0]).toMatchObject({ nghiemTrong: "LOW", phanLoai: "SAFE" });
  });

  it("[TV-21] dòng bị TỰ huỷ (không waivedAt) mà buổi gốc lại ghi 'cần bù' ⇒ HIGH — bé biến khỏi màn Học bù (chuỗi vắng→có mặt→vắng)", () => {
    const r = chay(
      be((s) => {
        n(s, "n-cho").status = "CANCELLED"; // huỷ tự động: KHÔNG có waivedAt
      }),
    );
    const f = cua(r, "TV-21");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ nghiemTrong: "HIGH", phanLoai: "NEEDS_MANUAL_REVIEW", id: "bg-n-cho|hv-1" });
    expect(f[0]!.lyDo).toContain("TỰ huỷ");
  });

  it("[TV-21] ÂM: huỷ do SỬA ĐIỂM DANH (không có waivedAt) thì không phải lệch nhãn", () => {
    const r = chay(
      be((s) => {
        n(s, "n-cho").status = "CANCELLED";
        s.diemDanh.find((a) => a.studentId === "hv-1")!.makeupStatus = "NONE";
      }),
    );
    expect(cua(r, "TV-21")).toEqual([]);
  });

  it("[TV-22] bù xong mà buổi gốc không có điểm danh ⇒ HIGH; luồng cũ thì không", () => {
    const r = chay(be((s) => (s.diemDanh = s.diemDanh.filter((a) => a.studentId !== "hv-3"))));
    expect(cua(r, "TV-22")).toHaveLength(1);
    expect(cua(r, "TV-22")[0]).toMatchObject({ id: "n-xong", nghiemTrong: "HIGH" });
    const cu = chay(
      be((s) => {
        s.diemDanh = s.diemDanh.filter((a) => a.studentId !== "hv-3");
        n(s, "n-xong").makeupSessionId = "buoi-bu-cu";
      }),
    );
    expect(cua(cu, "TV-22")).toEqual([]);
  });

  it("[TV-22] T05: nguồn ORDER_CONVERSION (học vượt) KHÔNG có điểm danh gốc theo thiết kế ⇒ không báo; nguồn khác vẫn báo; SYSTEM_MIGRATION báo kèm lời khuyên phân loại ở T15", () => {
    const bo = (cb: (s: Snapshot) => void) => be((s) => {
      s.diemDanh = s.diemDanh.filter((a) => a.studentId !== "hv-3");
      cb(s);
    });
    expect(cua(chay(bo((s) => (n(s, "n-xong").sourceType = "ORDER_CONVERSION"))), "TV-22")).toEqual([]);
    for (const nguon of ["ABSENCE", "MANUAL", "OTHER"] as const) {
      expect(cua(chay(bo((s) => (n(s, "n-xong").sourceType = nguon))), "TV-22"), nguon).toHaveLength(1);
    }
    const cu = cua(chay(bo((s) => (n(s, "n-xong").sourceType = "SYSTEM_MIGRATION"))), "TV-22")[0]!;
    expect(cu.deXuat).toContain("T15");
  });

  it("[TV-22] Bảo lưu P6: nguon = PHUC_HOC (phục học vào lớp đi trước) KHÔNG có điểm danh gốc theo thiết kế ⇒ không báo; đối chứng dương: bỏ nhãn thì báo", () => {
    const bo = (cb: (s: Snapshot) => void) => be((s) => {
      s.diemDanh = s.diemDanh.filter((a) => a.studentId !== "hv-3");
      cb(s);
    });
    expect(cua(chay(bo((s) => { n(s, "n-xong").sourceType = "OTHER"; n(s, "n-xong").nguon = "PHUC_HOC"; })), "TV-22")).toEqual([]);
    expect(cua(chay(bo((s) => { n(s, "n-xong").sourceType = "OTHER"; n(s, "n-xong").nguon = null; })), "TV-22")).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-30..31] chuẩn hoá dòng cần bù (T05)", () => {
  it("[TV-30] khoá lưu trên dòng lệch khoá của lớp ⇒ MEDIUM, NEEDS_MANUAL_REVIEW; đúng khoá thì không báo", () => {
    expect(cua(chay(sach()), "TV-30")).toEqual([]);
    const r = chay(be((s) => (n(s, "n-cho").courseIdCuaDong = "khoa-khac")));
    const f = cua(r, "TV-30");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: "n-cho", nghiemTrong: "MEDIUM", phanLoai: "NEEDS_MANUAL_REVIEW" });
    expect(f[0]!.lyDo).toContain("khoa-khac");
  });

  it("[TV-31] dòng ABSENCE không liên kết điểm danh gốc (hoặc trỏ bản ghi khác) dù buổi gốc CÓ điểm danh ⇒ AUTO_FIXABLE, đề xuất đúng id", () => {
    const thieu = cua(chay(be((s) => (n(s, "n-cho").originalAttendanceId = null))), "TV-31");
    expect(thieu).toHaveLength(1);
    expect(thieu[0]).toMatchObject({ id: "n-cho", phanLoai: "AUTO_FIXABLE", nghiemTrong: "LOW" });
    expect(thieu[0]!.deXuat).toContain("att-n-cho");
    expect(thieu[0]!.lyDo).toContain("chưa liên kết");
    const lech = cua(chay(be((s) => (n(s, "n-cho").originalAttendanceId = "att-la"))), "TV-31");
    expect(lech).toHaveLength(1);
    expect(lech[0]!.lyDo).toContain("KHÁC");
  });

  it("[TV-31] ÂM: dòng liên kết đúng ⇒ không báo; SYSTEM_MIGRATION (trước T05) / ORDER_CONVERSION / MANUAL không xét; buổi gốc không có điểm danh ⇒ không có gì để liên kết", () => {
    expect(cua(chay(sach()), "TV-31")).toEqual([]);
    for (const nguon of ["SYSTEM_MIGRATION", "ORDER_CONVERSION", "MANUAL", "OTHER"] as const) {
      const r = chay(be((s) => {
        n(s, "n-cho").sourceType = nguon;
        n(s, "n-cho").originalAttendanceId = null;
      }));
      expect(cua(r, "TV-31"), nguon).toEqual([]);
    }
    const khongDd = chay(be((s) => {
      n(s, "n-cho").originalAttendanceId = null;
      s.diemDanh = s.diemDanh.filter((a) => a.studentId !== "hv-1");
    }));
    expect(cua(khongDd, "TV-31")).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-32..35] sổ lượt học bù (T06)", () => {
  const tk = (s: Snapshot, id: string) => s.soLuot.find((x) => x.id === id)!;

  it("[TV-32..35] ĐỐI CHỨNG: thế giới sạch có sổ khớp ⇒ cả bốn luật ra 0 (thiếu vế này thì các ca dưới xanh vì không thấy gì)", () => {
    const r = chay(sach());
    for (const m of ["TV-32", "TV-33", "TV-34", "TV-35"] as const) expect(cua(r, m), m).toEqual([]);
  });

  it("[TV-32] số tài khoản ≠ tổng bút toán ⇒ CRITICAL; chỉ cần MỘT trong ba số lệch", () => {
    for (const cot of ["granted", "held", "consumed"] as const) {
      const r = chay(be((s) => (tk(s, "tk-2").tongBut[cot] += 1)));
      const f = cua(r, "TV-32");
      expect(f, cot).toHaveLength(1);
      expect(f[0]).toMatchObject({ id: "tk-2", nghiemTrong: "CRITICAL", thucThe: "MakeupCreditAccount" });
    }
  });

  it("[TV-33] lượt đang giữ lệch số mục case PLACED bằng lượt ⇒ HIGH; cả hai chiều (giữ thừa / thiếu)", () => {
    const thua = cua(chay(be((s) => { tk(s, "tk-2").held = 2; tk(s, "tk-2").tongBut.held = 2; })), "TV-33");
    expect(thua).toHaveLength(1);
    expect(thua[0]!.deXuat).toContain("Nhả");
    const thieu = cua(chay(be((s) => { tk(s, "tk-2").held = 0; tk(s, "tk-2").tongBut.held = 0; })), "TV-33");
    expect(thieu).toHaveLength(1);
    expect(thieu[0]!.deXuat).toContain("HOLD");
  });

  it("[TV-33] mục case xếp bằng PHÍ (dungLuot=false) hoặc đã điểm danh KHÔNG tính là đang giữ", () => {
    const phi = chay(be((s) => { s.cases[0]!.students[0]!.dungLuot = false; }));
    expect(cua(phi, "TV-33")).toHaveLength(1); // sổ giữ 1, mục case không còn xếp bằng lượt ⇒ lệch
    const daDd = chay(be((s) => { s.cases[0]!.students[0]!.status = "ABSENT"; }));
    expect(cua(daDd, "TV-33")).toHaveLength(1);
  });

  it("[TV-34] lượt đã tiêu lệch số dòng usedQuota ⇒ HIGH", () => {
    const f = cua(chay(be((s) => { tk(s, "tk-3").consumed = 2; tk(s, "tk-3").tongBut.consumed = 2; })), "TV-34");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: "tk-3", nghiemTrong: "HIGH" });
    const thieu = cua(chay(be((s) => { n(s, "n-cho").usedQuota = true; })), "TV-34");
    expect(thieu).toHaveLength(0); // hv-1 chưa có tài khoản: đó là TV-35, không phải TV-34
  });

  it("[TV-35] có lượt đang giữ/đã tiêu mà chưa có tài khoản ⇒ LOW, AUTO_FIXABLE (dữ liệu trước T06); có tài khoản thì không báo", () => {
    const r = chay(be((s) => { s.soLuot = []; }));
    const f = cua(r, "TV-35");
    expect(f.map((x) => x.id).sort()).toEqual(["hv-2|khoa-1", "hv-3|khoa-1"]);
    expect(f[0]).toMatchObject({ nghiemTrong: "LOW", phanLoai: "AUTO_FIXABLE" });
    expect(f[0]!.deXuat).toContain("so-luot-khoi-tao");
    expect(cua(chay(be((s) => { n(s, "n-cho").usedQuota = true; })), "TV-35").map((x) => x.id)).toEqual(["hv-1|khoa-1"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-23..24] buổi lớp trùng", () => {
  const luc = "2026-10-08T11:00:00.000Z";
  const buoi = (
    id: string,
    soDiemDanh: number,
    soNhanXet: number,
    taoLuc: string,
    them: { soThamChieu?: number; trangThai?: string } = {},
  ) => ({
    id,
    soDiemDanh,
    soNhanXet,
    soThamChieu: them.soThamChieu ?? 0,
    trangThai: them.trangThai ?? "SCHEDULED",
    taoLuc: new Date(taoLuc),
  });

  it("[TV-23] chỉ MỘT buổi mang dữ liệu ⇒ AUTO_FIXABLE, giữ đúng buổi đó", () => {
    const r = chay(
      be((s) => {
        s.buoiTrung = [{ classId: "lop-1", luc, buoi: [buoi("b1", 0, 0, "2026-09-01T00:00:00Z"), buoi("b2", 12, 3, "2026-09-02T00:00:00Z")] }];
      }),
    );
    const f = cua(r, "TV-23");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ phanLoai: "AUTO_FIXABLE", nghiemTrong: "HIGH", thucThe: "ClassSession" });
    expect(f[0]!.lienQuan).toMatchObject({ giu: "b2" });
  });

  it("[TV-23] không buổi nào có dữ liệu ⇒ AUTO_FIXABLE, giữ buổi TẠO SỚM NHẤT (không phụ thuộc thứ tự đầu vào)", () => {
    const r = chay(
      be((s) => {
        s.buoiTrung = [{ classId: "lop-1", luc, buoi: [buoi("muon", 0, 0, "2026-09-05T00:00:00Z"), buoi("som", 0, 0, "2026-09-01T00:00:00Z")] }];
      }),
    );
    expect(cua(r, "TV-23")[0]!.lienQuan).toMatchObject({ giu: "som" });
  });

  it("[TV-23] ≥ 2 buổi cùng có dữ liệu ⇒ NEEDS_MANUAL_REVIEW (phải gộp tay, không xoá)", () => {
    const r = chay(
      be((s) => {
        s.buoiTrung = [{ classId: "lop-1", luc, buoi: [buoi("b1", 5, 0, "2026-09-01T00:00:00Z"), buoi("b2", 0, 4, "2026-09-02T00:00:00Z")] }];
      }),
    );
    expect(cua(r, "TV-23")[0]).toMatchObject({ phanLoai: "NEEDS_MANUAL_REVIEW" });
  });

  it("[TV-24] hai buổi một ngày khác giờ ⇒ MEDIUM NEEDS_MANUAL_REVIEW (có thể là học dồn hợp lệ)", () => {
    const r = chay(be((s) => (s.buoiTrungNgay = [{ classId: "lop-1", ngayVn: "2026-10-08", buoiIds: ["b1", "b2"] }])));
    expect(cua(r, "TV-24")[0]).toMatchObject({ nghiemTrong: "MEDIUM", phanLoai: "NEEDS_MANUAL_REVIEW" });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-25..27] trùng lịch của case", () => {
  /** Buổi lớp trùng đúng khung 18:00–19:30 ngày 15/10 — đúng ngày/giờ của `case-sap`. */
  const slot = (p: { id?: string; classId?: string; teacherId?: string | null; roomId?: string | null; tu?: [number, number]; den?: [number, number] }) => ({
    id: p.id ?? "bl-1",
    classId: p.classId ?? "lop-khac",
    teacherId: p.teacherId === undefined ? null : p.teacherId,
    roomId: p.roomId === undefined ? null : p.roomId,
    startAt: vnDateAt(2026, 9, 15, ...(p.tu ?? [18, 0])),
    endAt: vnDateAt(2026, 9, 15, ...(p.den ?? [19, 30])),
  });

  it("[TV-25] giáo viên có buổi lớp trùng giờ ⇒ HIGH, nêu buổi trùng", () => {
    const r = chay(be((s) => (s.slotBuoi = [slot({ teacherId: "gv-1" })])));
    const f = cua(r, "TV-25");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: "case-sap", nghiemTrong: "HIGH", phanLoai: "NEEDS_MANUAL_REVIEW" });
    expect(f[0]!.lienQuan).toMatchObject({ buoiLop: "bl-1" });
  });

  it("[TV-25] ranh giới: buổi lớp kết thúc ĐÚNG lúc case bắt đầu ⇒ KHÔNG trùng; lệch một phút ⇒ trùng", () => {
    const sat = chay(be((s) => (s.slotBuoi = [slot({ teacherId: "gv-1", tu: [16, 30], den: [18, 0] })])));
    expect(cua(sat, "TV-25")).toEqual([]);
    const lech = chay(be((s) => (s.slotBuoi = [slot({ teacherId: "gv-1", tu: [16, 30], den: [18, 1] })])));
    expect(cua(lech, "TV-25")).toHaveLength(1);
  });

  it("[TV-25] ÂM: giáo viên khác ⇒ không báo", () => {
    expect(cua(chay(be((s) => (s.slotBuoi = [slot({ teacherId: "gv-2" })]))), "TV-25")).toEqual([]);
  });

  it("[TV-26] phòng trùng buổi lớp ⇒ HIGH; case không có phòng thì không thể trùng phòng", () => {
    const r = chay(be((s) => (s.slotBuoi = [slot({ roomId: "phong-1" })])));
    expect(cua(r, "TV-26")).toHaveLength(1);
    const khongPhong = chay(
      be((s) => {
        cs(s, "case-sap").roomId = null;
        s.slotBuoi = [slot({ roomId: null })];
      }),
    );
    expect(cua(khongPhong, "TV-26")).toEqual([]);
  });

  it("[TV-25/26] hai case trùng giờ cùng giáo viên và phòng ⇒ MỖI cặp báo ĐÚNG MỘT lần", () => {
    const r = chay(
      be((s) => {
        s.cases.push(
          ca({
            id: "case-khac",
            students: [{ id: "sv-k", makeupNeedId: "n-cho", status: "PLACED", dungLuot: true }],
          }),
        );
        n(s, "n-cho").status = "SCHEDULED";
        s.diemDanh[0]!.makeupStatus = "NEEDS_MAKEUP";
      }),
    );
    expect(cua(r, "TV-25")).toHaveLength(1);
    expect(cua(r, "TV-26")).toHaveLength(1);
  });

  it("[TV-25] case đã CANCELLED hoặc trước mốc không bị xét", () => {
    const huy = chay(
      be((s) => {
        cs(s, "case-sap").status = "CANCELLED";
        s.slotBuoi = [slot({ teacherId: "gv-1" })];
      }),
    );
    expect(cua(huy, "TV-25")).toEqual([]);
    const cu = chay(
      be((s) => {
        cs(s, "case-sap").date = ngayCase("2026-09-01");
        s.slotBuoi = [{ ...slot({ teacherId: "gv-1" }), startAt: vnDateAt(2026, 8, 1, 18, 0), endAt: vnDateAt(2026, 8, 1, 19, 30) }];
      }),
    );
    expect(cua(cu, "TV-25")).toEqual([]);
  });

  it("[TV-27] học viên đang có buổi lớp trùng giờ case ⇒ MEDIUM; lớp khác của học viên khác thì không", () => {
    const co = chay(
      be((s) => {
        s.slotBuoi = [slot({ classId: "lop-cua-hv2" })];
        s.lopCuaHocVien.set("hv-2", ["lop-cua-hv2"]);
      }),
    );
    const f = cua(co, "TV-27");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ nghiemTrong: "MEDIUM", thucThe: "MakeupCaseStudent", id: "sv-xep" });
    const khac = chay(
      be((s) => {
        s.slotBuoi = [slot({ classId: "lop-cua-hv2" })];
        s.lopCuaHocVien.set("hv-9", ["lop-cua-hv2"]);
      }),
    );
    expect(cua(khac, "TV-27")).toEqual([]);
  });

  it("[TV-27] bé đã VẮNG buổi bù thì không còn xung đột", () => {
    const r = chay(
      be((s) => {
        cs(s, "case-sap").students[0]!.status = "ABSENT";
        n(s, "n-xep").status = "PENDING";
        s.slotBuoi = [slot({ classId: "lop-cua-hv2" })];
        s.lopCuaHocVien.set("hv-2", ["lop-cua-hv2"]);
      }),
    );
    expect(cua(r, "TV-27")).toEqual([]);
  });

  it("[TV-27] cùng một bé nằm trong hai case trùng giờ ⇒ báo", () => {
    const r = chay(
      be((s) => {
        s.cases.push(
          ca({
            id: "case-aa",
            teacherId: "gv-2",
            roomId: "phong-2",
            students: [{ id: "sv-aa", makeupNeedId: "n-xep", status: "PLACED", dungLuot: true }],
          }),
        );
      }),
    );
    // Mỗi cặp case báo ĐÚNG MỘT lần: nếu cả hai chiều cùng báo thì người đọc thấy hai việc cho một lỗi.
    expect(cua(r, "TV-27")).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-28] đơn xin bù của phụ huynh", () => {
  const don = (p: Partial<Snapshot["donPh"][number]> = {}) => ({ id: "dh-1", studentId: "hv-2", sessionId: "bg-n-xep", status: "PENDING", ...p });

  it("[TV-28] đơn mở mà dòng đã xếp case ⇒ MEDIUM; dòng còn chờ thì hợp lệ", () => {
    expect(cua(chay(be((s) => (s.donPh = [don()]))), "TV-28")).toHaveLength(1);
    expect(cua(chay(be((s) => (s.donPh = [don({ studentId: "hv-1", sessionId: "bg-n-cho" })]))), "TV-28")).toEqual([]);
  });

  it("[TV-28] đơn mở trỏ buổi không có dòng ⇒ báo; đơn chưa chỉ buổi thì không (không có gì để đối chiếu)", () => {
    expect(cua(chay(be((s) => (s.donPh = [don({ sessionId: "bg-ma" })]))), "TV-28")).toHaveLength(1);
    expect(cua(chay(be((s) => (s.donPh = [don({ sessionId: null })]))), "TV-28")).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-R] kết quả và báo cáo", () => {
  it("sắp theo mức nghiêm trọng rồi mã luật — CRITICAL luôn đứng đầu", () => {
    const r = chay(
      be((s) => {
        n(s, "n-xep").status = "PENDING"; // CRITICAL TV-15
        n(s, "n-cho").choPhepHocBu = false; // LOW TV-09
        s.buoiTrungNgay = [{ classId: "lop-1", ngayVn: "2026-10-08", buoiIds: ["b1", "b2"] }]; // MEDIUM
      }),
    );
    const mucs = r.findings.map((f) => f.nghiemTrong);
    expect(mucs[0]).toBe("CRITICAL");
    expect(mucs[mucs.length - 1]).toBe("LOW");
  });

  it("bảng đếm theo luật khớp danh sách phát hiện (không đếm 0 khi có phát hiện)", () => {
    const r = chay(
      be((s) => {
        n(s, "n-xep").status = "PENDING";
        n(s, "n-cho").choPhepHocBu = false;
      }),
    );
    expect(r.findings.length).toBeGreaterThan(0);
    for (const m of Object.keys(LUAT) as MaLuat[]) {
      expect(r.demTheoLuat[m], m).toBe(r.findings.filter((f) => f.luat === m).length);
    }
    expect(Object.values(r.demTheoLuat).reduce((a, b) => a + b, 0)).toBe(r.findings.length);
  });

  it("kết quả không phụ thuộc thứ tự bản ghi đầu vào", () => {
    const xuoi = be((s) => {
      n(s, "n-xep").status = "PENDING";
      n(s, "n-xong").usedQuota = false;
    });
    const nguoc = structuredClone(xuoi);
    nguoc.needs.reverse();
    nguoc.cases.reverse();
    expect(chay(nguoc).findings).toEqual(chay(xuoi).findings);
  });

  const meta = { db: "satarobo_x", nhanh: "test", luc: "2026-10-07T03:00:00.000Z", tuNgayYmd: TU_NGAY };

  it("báo cáo liệt kê MỌI luật đã chạy kể cả luật ra 0, và nêu rõ luật CHƯA chạy kèm task", () => {
    const md = dungBaoCao(chay(sach()), meta);
    for (const m of Object.keys(LUAT)) expect(md).toContain(`| ${m} |`);
    for (const h of LUAT_HOAN) {
      expect(md).toContain(`| ${h.ma} |`);
      expect(md).toContain(h.task);
    }
    expect(md).toContain("Luật CHƯA chạy");
  });

  it("câu kết luận đổi theo dữ liệu: sạch vs có CRITICAL/HIGH", () => {
    expect(dungBaoCao(chay(sach()), meta)).toContain("KHÔNG có phát hiện CRITICAL/HIGH");
    const loi = chay(be((s) => (n(s, "n-xep").status = "PENDING")));
    expect(dungBaoCao(loi, meta)).toMatch(/CẦN XỬ LÝ — \d+ phát hiện CRITICAL\/HIGH/);
  });

  it("bảng mức × phân loại cộng đúng bằng tổng số phát hiện", () => {
    const r = chay(
      be((s) => {
        n(s, "n-xep").status = "PENDING";
        n(s, "n-cho").choPhepHocBu = false;
        s.buoiTrungNgay = [{ classId: "lop-1", ngayVn: "2026-10-08", buoiIds: ["b1", "b2"] }];
      }),
    );
    const md = dungBaoCao(r, meta);
    const tong = [...md.matchAll(/^\| (CRITICAL|HIGH|MEDIUM|LOW) \|.*\| (\d+) \|$/gm)].reduce((a, m) => a + Number(m[2]), 0);
    expect(tong).toBe(r.findings.length);
  });

  it("mỗi luật chỉ in tối đa N dòng nhưng nói rõ còn bao nhiêu", () => {
    const nhieu = chay(
      be((s) => {
        for (let i = 0; i < 7; i++) s.buoiTrungNgay.push({ classId: `l${i}`, ngayVn: "2026-10-08", buoiIds: [`a${i}`, `b${i}`] });
      }),
    );
    const md = dungBaoCao(nhieu, meta, 3);
    expect(md).toContain("và 4 phát hiện nữa");
    expect(md.match(/\*\*MEDIUM · NEEDS_MANUAL_REVIEW\*\* · ClassSession/g)).toHaveLength(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// [TVP] — ca thêm sau PHẢN BIỆN ĐỐI KHÁNG 07/10 (4 reviewer + 1 skeptic mỗi phát hiện; 34 xác nhận).
// Mỗi ca dưới đây khoá một chỗ mà bản đầu của luật sai hoặc mà phép cấy lỗi sống sót.
describe("[TVP] sau phản biện đối kháng", () => {
  const BS = String.fromCharCode(92);
  const lan = (iso: string, cu: string | null, moi: string | null) => ({ luc: new Date(iso), cu, moi });
  const diemDanhCua = (s: Snapshot, hv: string) => s.diemDanh.find((a) => a.studentId === hv)!;
  /** Đúng thứ `diemDanhBu` ĐỜI CŨ để lại: buổi gốc thành PRESENT nhưng giữ dấu MADE_UP. */
  const ghiDeNhuMaCu = (s: Snapshot) => {
    diemDanhCua(s, "hv-3").status = "PRESENT";
  };
  const donPhi = (p: Partial<Snapshot["donPhi"][number]> = {}) => ({
    itemId: "oi-1",
    orderId: "od-1",
    orderCode: "ORD-1",
    orderStatus: "PENDING_PAYMENT",
    orderDaXoa: false,
    tongTien: 1_980_000,
    daThu: 0,
    ...p,
  });

  // ── TV-20: bằng chứng audit ─────────────────────────────────────────────────────────────
  it("[TVP-01] PRESENT + MADE_UP (đúng output của điểm danh bù đời cũ) vẫn là TV-20 — đây là dữ liệu bị đảo quyết định 07/10, không phải 'hợp lệ'", () => {
    const r = chay(be(ghiDeNhuMaCu));
    expect(diemDanhCua(be(ghiDeNhuMaCu), "hv-3")).toMatchObject({ status: "PRESENT", makeupStatus: "MADE_UP" });
    const f = cua(r, "TV-20");
    expect(f).toHaveLength(1);
    expect(f[0]!.lyDo).toContain("ĐỜI CŨ");
    expect(f[0]!.lyDo).toContain("07/10");
    expect(cua(r, "TV-21")).toEqual([]);
  });

  it("[TVP-02] nhật ký SAU lúc dòng chốt COMPLETED mang trạng thái đã bị ghi đè ⇒ KHÔNG được làm bằng chứng", () => {
    const r = chay(
      be((s) => {
        ghiDeNhuMaCu(s);
        // completedAt = 02/10 12:00Z; nhật ký ngày 03/10 nói ABSENT_UNEXCUSED — đứng SAU nên không nói được gì về TRƯỚC khi bị ghi đè.
        s.bangChungVangGoc.set("bg-n-xong|hv-3", [lan("2026-10-03T00:00:00Z", "ABSENT_UNEXCUSED", "ABSENT_UNEXCUSED")]);
      }),
    );
    expect(cua(r, "TV-20")[0]).toMatchObject({ phanLoai: "NEEDS_MANUAL_REVIEW" });
    expect(cua(r, "TV-20")[0]!.lyDo).toContain("Không có nhật ký audit");
  });

  it("[TVP-03] hai trạng thái vắng KHÁC NHAU trước lúc chốt (admin sửa không phép → có phép) ⇒ NEEDS_MANUAL_REVIEW, nêu cả hai, không đoán", () => {
    const r = chay(
      be((s) => {
        ghiDeNhuMaCu(s);
        s.bangChungVangGoc.set("bg-n-xong|hv-3", [lan("2026-09-26T00:00:00Z", "ABSENT_UNEXCUSED", "ABSENT_EXCUSED")]);
      }),
    );
    const f = cua(r, "TV-20")[0]!;
    expect(f.phanLoai).toBe("NEEDS_MANUAL_REVIEW");
    expect(f.lyDo).toContain("NHIỀU trạng thái");
    expect(f.lyDo).toContain("ABSENT_UNEXCUSED");
    expect(f.lyDo).toContain("ABSENT_EXCUSED");
  });

  it("[TVP-04] biên: nhật ký đúng lúc chốt TÍNH, nhật ký sau 1ms thì KHÔNG; thiếu completedAt ⇒ không có bằng chứng", () => {
    const dung = chay(
      be((s) => {
        ghiDeNhuMaCu(s);
        s.bangChungVangGoc.set("bg-n-xong|hv-3", [lan("2026-10-02T12:00:00.000Z", "ABSENT_EXCUSED", "ABSENT_EXCUSED")]);
      }),
    );
    expect(cua(dung, "TV-20")[0]).toMatchObject({ phanLoai: "AUTO_FIXABLE" });
    const sau = chay(
      be((s) => {
        ghiDeNhuMaCu(s);
        s.bangChungVangGoc.set("bg-n-xong|hv-3", [lan("2026-10-02T12:00:00.001Z", "ABSENT_EXCUSED", "ABSENT_EXCUSED")]);
      }),
    );
    expect(cua(sau, "TV-20")[0]).toMatchObject({ phanLoai: "NEEDS_MANUAL_REVIEW" });
    const khongMoc = chay(
      be((s) => {
        ghiDeNhuMaCu(s);
        n(s, "n-xong").completedAt = null;
        s.bangChungVangGoc.set("bg-n-xong|hv-3", [lan("2026-09-26T00:00:00Z", "ABSENT_EXCUSED", "ABSENT_EXCUSED")]);
      }),
    );
    expect(cua(khongMoc, "TV-20")[0]).toMatchObject({ phanLoai: "NEEDS_MANUAL_REVIEW" });
  });

  it("[TVP-05] bé có trong nhật ký chỉ ở vế SAU (admin thêm bé vào ảnh chụp) vẫn là một trạng thái duy nhất ⇒ AUTO_FIXABLE", () => {
    const r = chay(
      be((s) => {
        ghiDeNhuMaCu(s);
        s.bangChungVangGoc.set("bg-n-xong|hv-3", [lan("2026-09-26T00:00:00Z", null, "ABSENT_EXCUSED")]);
      }),
    );
    expect(cua(r, "TV-20")[0]).toMatchObject({ phanLoai: "AUTO_FIXABLE" });
    expect(cua(r, "TV-20")[0]!.deXuat).toContain("status=ABSENT_EXCUSED");
  });

  it("[TVP-06] buổi gốc là LATE (đi muộn) sau khi bù xong cũng là ghi đè — LATE không phải trạng thái vắng", () => {
    const r = chay(be((s) => (diemDanhCua(s, "hv-3").status = "LATE")));
    expect(cua(r, "TV-20")).toHaveLength(1);
  });

  // ── TV-21: huỷ hàng loạt khi lớp huỷ ────────────────────────────────────────────────────
  it("[TVP-07] dòng bị huỷ HÀNG LOẠT khi lớp huỷ/xoá mà nhãn còn 'cần bù' ⇒ MEDIUM và trỏ T10; nếu KHÔNG do lớp huỷ thì vẫn HIGH", () => {
    const huyLop = (cot: "lopDaHuy" | "lopDaXoa") =>
      chay(
        be((s) => {
          n(s, "n-cho").status = "CANCELLED";
          n(s, "n-cho")[cot] = true;
        }),
      );
    for (const cot of ["lopDaHuy", "lopDaXoa"] as const) {
      const f = cua(huyLop(cot), "TV-21");
      expect(f, cot).toHaveLength(1);
      expect(f[0]).toMatchObject({ nghiemTrong: "MEDIUM", phanLoai: "NEEDS_MANUAL_REVIEW" });
      expect(f[0]!.lyDo).toContain("HÀNG LOẠT");
      expect(f[0]!.deXuat).toContain("T10");
    }
    const tuHuy = chay(be((s) => (n(s, "n-cho").status = "CANCELLED")));
    expect(cua(tuHuy, "TV-21")[0]).toMatchObject({ nghiemTrong: "HIGH" });
    expect(cua(tuHuy, "TV-21")[0]!.lyDo).toContain("TỰ huỷ");
  });

  // ── TV-08 ───────────────────────────────────────────────────────────────────────────────
  it("[TVP-08] TV-08 bỏ qua buổi vắng đã đánh dấu MADE_UP (hợp lệ, cùng định nghĩa với script vá); NEEDS_MAKEUP / NONE vẫn báo", () => {
    const vang = (makeupStatus: "NONE" | "NEEDS_MAKEUP" | "MADE_UP") => ({
      sessionId: "bg-moi",
      studentId: "hv-9",
      studentName: "Bé Chín",
      className: "Lớp 1",
      status: "ABSENT_EXCUSED",
      makeupStatus,
      ngayVn: "2026-10-01",
      choPhepHocBu: true,
      lopDaXoa: false,
    });
    expect(cua(chay(be((s) => (s.vangChuaCoDong = [vang("MADE_UP")]))), "TV-08")).toEqual([]);
    expect(cua(chay(be((s) => (s.vangChuaCoDong = [vang("NEEDS_MAKEUP")]))), "TV-08")).toHaveLength(1);
    expect(cua(chay(be((s) => (s.vangChuaCoDong = [vang("NONE")]))), "TV-08")).toHaveLength(1);
  });

  // ── TV-02 / TV-03 ───────────────────────────────────────────────────────────────────────
  it("[TVP-09] TV-03 không áp cho dòng đã COMPLETED hay dòng luồng cũ (không bao giờ vào bước gom case); TV-02 thì vẫn áp", () => {
    const xong = chay(be((s) => (n(s, "n-xong").missedLessonId = null)));
    expect(cua(xong, "TV-03")).toEqual([]);
    const cu = chay(
      be((s) => {
        n(s, "n-cho").missedLessonId = null;
        n(s, "n-cho").makeupSessionId = "buoi-bu-cu";
      }),
    );
    expect(cua(cu, "TV-03")).toEqual([]);
    const traBaiChet = chay(be((s) => (n(s, "n-xong").missedLessonId = "bai-chet")));
    expect(cua(traBaiChet, "TV-02").map((f) => f.id)).toEqual(["n-xong"]);
  });

  it("[TVP-10] TV-02 chạy một mình (không kéo theo TV-03) và bỏ qua dòng CANCELLED; TV-03 với bài buổi gốc đã chết ⇒ KHÔNG đề xuất điền", () => {
    expect(ma(chay(be((s) => (n(s, "n-cho").missedLessonId = "bai-ma"))))).toEqual(["TV-02"]);
    expect(cua(chay(be((s) => ((n(s, "n-cho").missedLessonId = "bai-ma"), (n(s, "n-cho").status = "CANCELLED")))), "TV-02")).toEqual([]);
    const baiChet = chay(
      be((s) => {
        n(s, "n-cho").missedLessonId = null;
        s.buoiGoc.find((b) => b.id === "bg-n-cho")!.lessonId = "bai-chet";
      }),
    );
    const f = cua(baiChet, "TV-03");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ phanLoai: "NEEDS_MANUAL_REVIEW" });
    expect(f[0]!.deXuat).not.toContain("Điền missedLessonId");
  });

  // ── TV-05 / TV-06 / TV-07 ──────────────────────────────────────────────────────────────
  it("[TVP-11] TV-05: đơn phí chết nhưng bé vào case BẰNG LƯỢT hoặc được MIỄN PHÍ ⇒ LOW SAFE (con trỏ cũ vô hại), không bắt gỡ bé", () => {
    // thế giới sạch xếp bé bằng lượt (dungLuot=true)
    const bangLuot = chay(
      be((s) => {
        n(s, "n-xep").feeOrderItemId = "oi-1";
        s.donPhi = [donPhi({ orderStatus: "CANCELLED" })];
      }),
    );
    expect(cua(bangLuot, "TV-05")[0]).toMatchObject({ nghiemTrong: "LOW", phanLoai: "SAFE" });
    expect(cua(bangLuot, "TV-05")[0]!.lyDo).toContain("bằng lượt");
    const mienPhi = chay(
      be((s) => {
        n(s, "n-xep").feeOrderItemId = "oi-1";
        n(s, "n-xep").freeApprovedAt = new Date("2026-10-03T00:00:00Z");
        cs(s, "case-sap").students[0]!.dungLuot = false;
        s.donPhi = [donPhi({ orderStatus: "CANCELLED", daThu: 1_980_000 })];
      }),
    );
    expect(cua(mienPhi, "TV-05")[0]).toMatchObject({ nghiemTrong: "LOW", phanLoai: "SAFE" });
    expect(cua(mienPhi, "TV-05")[0]!.lyDo).toContain("miễn phí");
  });

  it("[TVP-12] ÂM của TV-06/07: dòng KHÔNG miễn phí + đơn sống chưa thu; miễn phí + đơn đã huỷ; thu vượt; đơn chỉ được dòng COMPLETED trỏ tới", () => {
    expect(
      cua(
        chay(
          be((s) => {
            n(s, "n-cho").feeOrderItemId = "oi-1";
            s.donPhi = [donPhi()];
          }),
        ),
        "TV-06",
      ),
    ).toEqual([]);
    expect(
      cua(
        chay(
          be((s) => {
            n(s, "n-cho").feeOrderItemId = "oi-1";
            n(s, "n-cho").freeApprovedAt = new Date("2026-10-03T00:00:00Z");
            s.donPhi = [donPhi({ orderStatus: "CANCELLED" })];
          }),
        ),
        "TV-06",
      ),
    ).toEqual([]);
    expect(
      cua(
        chay(
          be((s) => {
            n(s, "n-cho").feeOrderItemId = "oi-1";
            n(s, "n-cho").freeApprovedAt = new Date("2026-10-03T00:00:00Z");
            s.donPhi = [donPhi({ daThu: 2_500_000 })];
          }),
        ),
        "TV-06",
      ),
    ).toEqual([]);
    const moCoi = { ...donPhi(), hocVienId: "hv-3", tenDong: "Phí học bù" };
    const chiCompleted = chay(
      be((s) => {
        n(s, "n-xong").feeOrderItemId = "oi-1";
        s.donPhi = [donPhi()];
        s.donPhiMoCoi = [moCoi];
      }),
    );
    expect(cua(chiCompleted, "TV-07")).toEqual([]);
  });

  // ── TV-11 / TV-12 / TV-13 / TV-15 / TV-18 ───────────────────────────────────────────────
  it("[TVP-13] TV-11 chọn COMPLETED khi có ÍT NHẤT MỘT bé có mặt (case nhiều bé), CANCELLED khi không ai có mặt", () => {
    const hon = chay(
      be((s) => {
        cs(s, "case-sap").students = [
          { id: "sv-a", makeupNeedId: "n-xep", status: "PRESENT", dungLuot: true },
          { id: "sv-b", makeupNeedId: "n-cho", status: "ABSENT", dungLuot: true },
        ];
      }),
    );
    const f = cua(hon, "TV-11");
    expect(f).toHaveLength(1);
    expect(f[0]!.deXuat).toContain("COMPLETED");
    expect(f[0]!.deXuat).not.toContain("CANCELLED");
    const toanVang = chay(be((s) => (cs(s, "case-sap").students[0]!.status = "ABSENT")));
    expect(cua(toanVang, "TV-11")[0]!.deXuat).toContain("CANCELLED");
  });

  it("[TVP-14] TV-12 theo NGÀY VN, không theo ngày UTC: 23:59 VN hôm 07/10 → case 08/10 là TƯƠNG LAI; 00:00 VN 08/10 → đã là HÔM NAY", () => {
    const caseNgay8 = (s: Snapshot) => (cs(s, "case-xong").date = ngayCase("2026-10-08"));
    const truocNuaDem = chay(be(caseNgay8), { now: new Date("2026-10-07T16:59:00.000Z"), tuNgayYmd: TU_NGAY });
    expect(cua(truocNuaDem, "TV-12")).toHaveLength(1);
    // 17:00Z = 00:00 VN ngày 08/10 nhưng NGÀY UTC vẫn là 07/10 — cắt theo UTC sẽ báo nhầm.
    const sauNuaDem = chay(be(caseNgay8), { now: new Date("2026-10-07T17:00:00.000Z"), tuNgayYmd: TU_NGAY });
    expect(cua(sauNuaDem, "TV-12")).toEqual([]);
  });

  it("[TVP-15] TV-13 theo GIỜ KẾT THÚC của case (có cả phút): 19:29 VN chưa quá giờ, 19:31 VN thì quá", () => {
    const ngay15 = (iso: string) => ({ now: new Date(iso), tuNgayYmd: TU_NGAY });
    // case-sap: 15/10 18:00–19:30 VN = 11:00Z–12:30Z
    expect(cua(chay(sach(), ngay15("2026-10-15T12:29:00.000Z")), "TV-13")).toEqual([]);
    expect(cua(chay(sach(), ngay15("2026-10-15T12:31:00.000Z")), "TV-13")).toHaveLength(1);
  });

  it("[TVP-16] TV-15: bé 'chờ' trong case đã CHỐT hoặc HUỶ ⇒ CRITICAL (không giáo viên nào điểm danh nữa); case đang dạy thì không", () => {
    for (const st of ["COMPLETED", "CANCELLED"] as const) {
      const r = chay(be((s) => (cs(s, "case-sap").status = st)));
      const f = cua(r, "TV-15").filter((x) => x.thucThe === "MakeupCaseStudent");
      expect(f, st).toHaveLength(1);
      expect(f[0]).toMatchObject({ nghiemTrong: "CRITICAL", phanLoai: "INVALID", id: "sv-xep" });
      expect(f[0]!.lyDo).toContain("không ai điểm danh");
    }
    expect(cua(chay(sach()), "TV-15")).toEqual([]);
  });

  it("[TVP-17] TV-15: MỘT dòng đang chờ ở HAI case đang dạy ⇒ CRITICAL (chỉ mục chống trùng có thể đã mất); lịch sử ABSENT ở case khác thì không", () => {
    const them = (st: "PLACED" | "ABSENT", trangThaiCase: "SCHEDULED" | "CANCELLED") =>
      chay(
        be((s) => {
          s.cases.push(
            ca({
              id: "case-2",
              status: trangThaiCase,
              date: ngayCase("2026-10-16"),
              students: [{ id: "sv-2", makeupNeedId: "n-xep", status: st, dungLuot: true }],
            }),
          );
        }),
      );
    const hai = cua(them("PLACED", "SCHEDULED"), "TV-15").filter((x) => x.thucThe === "MakeupNeed");
    expect(hai).toHaveLength(1);
    expect(hai[0]).toMatchObject({ id: "n-xep", nghiemTrong: "CRITICAL", phanLoai: "INVALID" });
    expect(hai[0]!.lyDo).toContain("2 case");
    expect(cua(them("ABSENT", "SCHEDULED"), "TV-15").filter((x) => x.thucThe === "MakeupNeed")).toEqual([]);
    // một bản ghi PLACED ở case ĐÃ HUỶ không phải "chờ ở hai case đang dạy" (nó là TV-15 mức bản ghi, ca [TVP-16])
    expect(cua(them("PLACED", "CANCELLED"), "TV-15").filter((x) => x.thucThe === "MakeupNeed")).toEqual([]);
  });

  it("[TVP-18] TV-18: giáo viên ngừng hoạt động chỉ là lỗi với case ĐANG CHỜ dạy; case đã chốt là lịch sử; user biến mất thì vẫn HIGH ở mọi case", () => {
    const nghi = chay(be((s) => s.gvHoatDong.set("gv-1", false)));
    expect(cua(nghi, "TV-18").map((f) => f.id)).toEqual(["case-sap"]);
    const mat = chay(be((s) => s.gvHoatDong.delete("gv-1")));
    const f = cua(mat, "TV-18");
    expect(f.map((x) => x.id)).toEqual(["case-sap", "case-xong"]);
    expect(f.find((x) => x.id === "case-xong")!.deXuat).toContain("KHÔNG đổi");
    expect(f.find((x) => x.id === "case-sap")!.deXuat).toContain("T07");
  });

  // ── TV-14: cơ sở thiếu ─────────────────────────────────────────────────────────────────
  it("[TVP-19] TV-14: dòng không có cơ sở mà case có ⇒ báo, và nêu rõ chỗ trống (nửa đọc đã điền cơ sở của lớp nên chỉ lớp không cơ sở mới tới đây)", () => {
    const r = chay(be((s) => (n(s, "n-xep").centerId = null)));
    const f = cua(r, "TV-14");
    expect(f).toHaveLength(1);
    expect(f[0]!.lyDo).toContain("dòng —");
  });

  // ── TV-23 ───────────────────────────────────────────────────────────────────────────────
  it("[TVP-20] TV-23: 'mang dữ liệu' gồm cả bản ghi khác trỏ vào buổi và buổi đã bắt đầu/hoàn tất — không chỉ điểm danh và nhận xét", () => {
    const luc = "2026-10-01T11:00:00.000Z";
    const b = (id: string, tao: string, them: { soThamChieu?: number; trangThai?: string } = {}) => ({
      id,
      soDiemDanh: 0,
      soNhanXet: 0,
      soThamChieu: them.soThamChieu ?? 0,
      trangThai: them.trangThai ?? "SCHEDULED",
      taoLuc: new Date(tao),
    });
    const mot = chay(be((s) => (s.buoiTrung = [{ classId: "lop-1", luc, buoi: [b("rong", "2026-09-01T00:00:00Z"), b("co-bai-tap", "2026-09-02T00:00:00Z", { soThamChieu: 2 })] }])));
    expect(cua(mot, "TV-23")[0]).toMatchObject({ phanLoai: "AUTO_FIXABLE" });
    expect(cua(mot, "TV-23")[0]!.lienQuan).toMatchObject({ giu: "co-bai-tap" });
    const hoanTat = chay(be((s) => (s.buoiTrung = [{ classId: "lop-1", luc, buoi: [b("xong", "2026-09-01T00:00:00Z", { trangThai: "COMPLETED" }), b("rong", "2026-09-02T00:00:00Z")] }])));
    expect(cua(hoanTat, "TV-23")[0]!.lienQuan).toMatchObject({ giu: "xong" });
    const hai = chay(be((s) => (s.buoiTrung = [{ classId: "lop-1", luc, buoi: [b("a", "2026-09-01T00:00:00Z", { soThamChieu: 1 }), b("b", "2026-09-02T00:00:00Z", { trangThai: "COMPLETED" })] }])));
    expect(cua(hai, "TV-23")[0]).toMatchObject({ phanLoai: "NEEDS_MANUAL_REVIEW" });
  });

  // ── TV-25 / TV-26: tách điều kiện giáo viên và phòng ───────────────────────────────────
  it("[TVP-21] TV-25 và TV-26 độc lập: cùng phòng khác GV chỉ ra TV-26; cùng GV khác phòng chỉ ra TV-25; cả hai không phòng thì không có TV-26", () => {
    const them = (p: { teacherId?: string; roomId?: string | null }) =>
      chay(
        be((s) => {
          s.cases.push(
            ca({
              id: "case-2",
              students: [{ id: "sv-2", makeupNeedId: "n-cho", status: "PLACED", dungLuot: true }],
              teacherId: p.teacherId ?? "gv-1",
              roomId: p.roomId === undefined ? "phong-1" : p.roomId,
            }),
          );
          s.gvHoatDong.set("gv-2", true);
          s.roomIdsConTon.add("phong-2");
        }),
      );
    const cungPhong = them({ teacherId: "gv-2" });
    expect(cua(cungPhong, "TV-26")).toHaveLength(1);
    expect(cua(cungPhong, "TV-25")).toEqual([]);
    const cungGv = them({ roomId: "phong-2" });
    expect(cua(cungGv, "TV-25")).toHaveLength(1);
    expect(cua(cungGv, "TV-26")).toEqual([]);
    const khongPhong = chay(
      be((s) => {
        cs(s, "case-sap").roomId = null;
        s.cases.push(
          ca({
            id: "case-2",
            students: [{ id: "sv-2", makeupNeedId: "n-cho", status: "PLACED", dungLuot: true }],
            teacherId: "gv-2",
            roomId: null,
          }),
        );
        s.gvHoatDong.set("gv-2", true);
      }),
    );
    expect(cua(khongPhong, "TV-26")).toEqual([]);
  });

  it("[TVP-22] TV-26: buổi lớp ở phòng KHÁC thì không trùng phòng; TV-25 tính cả MÉP CUỐI và phút bắt đầu của case", () => {
    const slot = (p: { teacherId?: string | null; roomId?: string | null; tu: [number, number]; den: [number, number] }) => ({
      id: "bl-1",
      classId: "lop-khac",
      teacherId: p.teacherId ?? null,
      roomId: p.roomId ?? null,
      startAt: vnDateAt(2026, 9, 15, ...p.tu),
      endAt: vnDateAt(2026, 9, 15, ...p.den),
    });
    expect(cua(chay(be((s) => (s.slotBuoi = [slot({ roomId: "phong-2", tu: [18, 0], den: [19, 30] })]))), "TV-26")).toEqual([]);
    // mép CUỐI của case (18:00–19:30): buổi lớp 19:15–19:45 chồng, 19:30–20:00 chỉ chạm
    expect(cua(chay(be((s) => (s.slotBuoi = [slot({ teacherId: "gv-1", tu: [19, 15], den: [19, 45] })]))), "TV-25")).toHaveLength(1);
    expect(cua(chay(be((s) => (s.slotBuoi = [slot({ teacherId: "gv-1", tu: [19, 30], den: [20, 0] })]))), "TV-25")).toEqual([]);
    // phút BẮT ĐẦU của case: case 18:30–19:30, buổi lớp 17:00–18:15 không chạm, 17:00–18:31 chạm
    const caseTre = (den: [number, number]) =>
      chay(
        be((s) => {
          cs(s, "case-sap").startTime = "18:30";
          s.slotBuoi = [slot({ teacherId: "gv-1", tu: [17, 0], den })];
        }),
      );
    expect(cua(caseTre([18, 15]), "TV-25")).toEqual([]);
    expect(cua(caseTre([18, 31]), "TV-25")).toHaveLength(1);
  });

  // ── TV-28 ───────────────────────────────────────────────────────────────────────────────
  it("[TVP-23] TV-28: đơn đã DUYỆT (APPROVED) là cuối đời bình thường — không báo dù dòng đã xếp/bù/huỷ; đơn còn PENDING mà dòng đã bù xong thì báo", () => {
    const don = (status: string, hv: string, buoi: string) => ({ id: "dh-1", studentId: hv, sessionId: buoi, status });
    expect(cua(chay(be((s) => (s.donPh = [don("APPROVED", "hv-3", "bg-n-xong")]))), "TV-28")).toEqual([]);
    expect(cua(chay(be((s) => (s.donPh = [don("APPROVED", "hv-2", "bg-n-xep")]))), "TV-28")).toEqual([]);
    expect(cua(chay(be((s) => (s.donPh = [don("PENDING", "hv-3", "bg-n-xong")]))), "TV-28")).toHaveLength(1);
  });

  // ── Kết quả và báo cáo ─────────────────────────────────────────────────────────────────
  it("[TVP-24] thứ tự: đủ bốn mức, hai luật khác nhau cùng mức, hai phát hiện cùng luật khác id — và đầu vào xáo ngược cho ra ĐÚNG cùng thứ tự", () => {
    const mau = be((s) => {
      n(s, "n-xep").status = "PENDING"; // CRITICAL TV-15 (trên dòng bé trong case)
      s.buoiGoc = s.buoiGoc.filter((b) => b.id !== "bg-n-cho"); // HIGH TV-01 (n-cho)
      s.buoiGoc = s.buoiGoc.filter((b) => b.id !== "bg-n-xong"); // HIGH TV-01 (n-xong)
      s.buoiTrungNgay = [
        { classId: "lop-2", ngayVn: "2026-10-08", buoiIds: ["z1", "z2"] },
        { classId: "lop-1", ngayVn: "2026-10-08", buoiIds: ["a1", "a2"] },
      ]; // MEDIUM TV-24 × 2
      n(s, "n-cho").choPhepHocBu = false; // LOW TV-09
      // HIGH TV-18 (id "case-…" đứng TRƯỚC "n-…" theo bảng chữ cái) — cùng mức HIGH với TV-01: chỉ phép sắp theo
      // MÃ LUẬT rồi mới theo id mới ra TV-01 trước TV-18; sắp theo id thuần sẽ đảo.
      s.gvHoatDong.delete("gv-1");
    });
    const nguoc = structuredClone(mau);
    nguoc.needs.reverse();
    nguoc.cases.reverse();
    nguoc.buoiTrungNgay.reverse();
    const xuoi = chay(mau).findings;
    expect(chay(nguoc).findings.map((f) => `${f.luat}|${f.id}`)).toEqual(xuoi.map((f) => `${f.luat}|${f.id}`));
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
    expect(new Set(xuoi.map((f) => f.nghiemTrong))).toEqual(new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW"]));
    for (let i = 1; i < xuoi.length; i++) {
      const a = xuoi[i - 1]!;
      const b = xuoi[i]!;
      const ka = [rank[a.nghiemTrong], a.luat, a.id] as const;
      const kb = [rank[b.nghiemTrong], b.luat, b.id] as const;
      const dung = ka[0] < kb[0] || (ka[0] === kb[0] && (ka[1] < kb[1] || (ka[1] === kb[1] && ka[2] <= kb[2])));
      expect(dung, `${ka.join("|")} phải đứng trước ${kb.join("|")}`).toBe(true);
    }
    expect(xuoi.filter((f) => f.luat === "TV-01").map((f) => f.id)).toEqual(["n-cho", "n-xong"]);
  });

  const meta = { db: "satarobo_x", nhanh: "test", luc: "2026-10-07T03:00:00.000Z", tuNgayYmd: TU_NGAY };

  it("[TVP-25] kết luận đếm cả HIGH (không chỉ CRITICAL); biên đúng N phát hiện thì KHÔNG in 'phát hiện nữa'", () => {
    const chiHigh = chay(be((s) => (n(s, "n-cho").missedLessonId = "bai-ma")));
    expect(chiHigh.findings.map((f) => f.nghiemTrong)).toEqual(["HIGH"]);
    const md = dungBaoCao(chiHigh, meta);
    expect(md).toContain("CẦN XỬ LÝ — 1 phát hiện CRITICAL/HIGH");
    expect(md).not.toContain("KHÔNG có phát hiện");
    const ba = chay(
      be((s) => {
        for (let i = 0; i < 3; i++) s.buoiTrungNgay.push({ classId: `l${i}`, ngayVn: "2026-10-08", buoiIds: [`a${i}`, `b${i}`] });
      }),
    );
    const dungBa = dungBaoCao(ba, meta, 3);
    expect(dungBa).not.toContain("phát hiện nữa");
    expect(dungBa.match(/\*\*MEDIUM · NEEDS_MANUAL_REVIEW\*\* · ClassSession/g)).toHaveLength(3);
  });

  it("[TVP-26] chuỗi từ DB vào markdown bị vô hiệu: không còn liên kết / ảnh / thẻ HTML sống, và xuống dòng không xé bản ghi", () => {
    const xau = `Bé${String.fromCharCode(10)}![x](https://evil.example/a.png) [Đăng nhập](https://evil.example) <img src=x onerror=alert(1)>`;
    const r = chay(be((s) => ((n(s, "n-cho").missedLessonId = "bai-ma"), (n(s, "n-cho").studentName = xau))));
    const md = dungBaoCao(r, meta);
    const dong = md.split(String.fromCharCode(10));
    const i = dong.findIndex((d) => d.startsWith("- **HIGH · NEEDS_MANUAL_REVIEW** · MakeupNeed"));
    expect(i).toBeGreaterThan(-1);
    expect(dong[i + 1]!.startsWith("  - ")).toBe(true); // xuống dòng của tên không xé bản ghi
    expect(dong[i]).toContain(`${BS}[x${BS}]`);
    expect(dong[i]).toContain(`${BS}[Đăng nhập${BS}]`);
    expect(dong[i]).toContain(`${BS}<img`);
    expect(dong[i]).not.toMatch(/(^|[^\\])\[Đăng nhập\]\(/);
  });

  it("[TVP-27] dòng đầu báo cáo tự khai user + quyền GHI (như các báo cáo anh em); không khai thì không in", () => {
    const co = dungBaoCao(chay(sach()), { ...meta, nguoiDung: "nguoi_doc_ro", coQuyenGhi: false });
    expect(co).toContain("user `nguoi_doc_ro`");
    expect(co).toContain("ghi được: KHÔNG");
    expect(dungBaoCao(chay(sach()), { ...meta, nguoiDung: "postgres", coQuyenGhi: true })).toContain("ghi được: CÓ");
    const khong = dungBaoCao(chay(sach()), meta);
    expect(khong).not.toContain("ghi được");
    expect(khong).not.toContain("user `");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T07 — case nhiều bài + điểm danh hai tầng (TV-40..43) và hai luật cũ đọc bộ bài (TV-14, TV-18).
describe("[TV-40..43] mô hình case nhiều bài", () => {
  const sap = (s: Snapshot) => cs(s, "case-sap");
  const mucSap = (s: Snapshot) => sap(s).students[0]!;
  const beSap = (s: Snapshot) => sap(s).participants![0]!;

  it("[TV-40a] case đời cũ (chưa bộ bài / bé tham gia / mục chưa nối) ⇒ ĐÚNG MỘT TV-40 mức LOW AUTO_FIXABLE, không luật nào khác", () => {
    const r = chay(
      be((s) => {
        sap(s).lessonIds = undefined;
        sap(s).participants = undefined;
        mucSap(s).participantId = null;
        mucSap(s).result = undefined;
      }),
    );
    expect(ma(r)).toEqual(["TV-40"]);
    expect(cua(r, "TV-40")[0]).toMatchObject({ id: "case-sap", nghiemTrong: "LOW", phanLoai: "AUTO_FIXABLE", thucThe: "MakeupCase" });
  });

  it("[TV-40b] chỉ MỘT mục chưa nối bé trên case đã nâng ⇒ vẫn TV-40, nói rõ số mục; ÂM: case CANCELLED không bé không báo", () => {
    const r = chay(be((s) => (mucSap(s).participantId = null)));
    expect(cua(r, "TV-40")).toHaveLength(1);
    expect(cua(r, "TV-40")[0]!.lyDo).toContain("1 mục chưa nối bé");
    const huy = chay(
      be((s) => {
        sap(s).status = "CANCELLED";
        sap(s).students = [];
        sap(s).participants = [];
        sap(s).lessonIds = undefined;
      }),
    );
    expect(cua(huy, "TV-40")).toEqual([]);
  });

  it("[TV-41] hai tầng lệch ⇒ CRITICAL INVALID cho đúng mục; các cặp HỢP LỆ không bị báo", () => {
    const bad: [string, string, string][] = [
      ["PENDING", "COMPLETED", "bé chờ điểm danh nhưng mục đã là COMPLETED"],
      ["PENDING", "RELEASED", "bé chờ điểm danh nhưng mục đã là RELEASED"],
      ["PRESENT", "PLANNED", "bé có mặt nhưng mục còn chờ kết quả"],
      ["ABSENT", "COMPLETED", "bé vắng buổi bù nhưng mục còn COMPLETED"],
      ["ABSENT", "PLANNED", "bé vắng buổi bù nhưng mục còn PLANNED"],
      ["REMOVED", "PLANNED", "bé đã bị gỡ nhưng mục còn PLANNED"],
    ];
    for (const [tang1, ketQua, lyDo] of bad) {
      const r = chay(
        be((s) => {
          beSap(s).attendanceStatus = tang1 as never;
          mucSap(s).result = ketQua as never;
        }),
      );
      const f = cua(r, "TV-41");
      expect(f, `${tang1}/${ketQua}`).toHaveLength(1);
      expect(f[0]).toMatchObject({ id: "sv-xep", nghiemTrong: "CRITICAL", phanLoai: "INVALID", thucThe: "MakeupCaseStudent" });
      expect(f[0]!.lyDo).toContain(lyDo);
    }
    const tot: [string, string][] = [["PENDING", "PLANNED"], ["PRESENT", "COMPLETED"], ["PRESENT", "NOT_COMPLETED"], ["ABSENT", "RELEASED"], ["REMOVED", "RELEASED"]];
    for (const [tang1, ketQua] of tot) {
      const r = chay(
        be((s) => {
          beSap(s).attendanceStatus = tang1 as never;
          mucSap(s).result = ketQua as never;
        }),
      );
      expect(cua(r, "TV-41"), `${tang1}/${ketQua}`).toEqual([]);
    }
  });

  it("[TV-42] bộ bài sai luật ⇒ HIGH: quá 3 bài · bài chính không phải bài đầu · mục mang bài ngoài bộ; 1–3 bài đúng thì không báo", () => {
    expect(cua(chay(be((s) => (sap(s).lessonIds = ["bai-1", "b2", "b3"]))), "TV-42")).toEqual([]);
    const bon = cua(chay(be((s) => (sap(s).lessonIds = ["bai-1", "b2", "b3", "b4"]))), "TV-42");
    expect(bon).toHaveLength(1);
    expect(bon[0]!.lyDo).toContain("4 bài (tối đa 3)");
    expect(bon[0]).toMatchObject({ nghiemTrong: "HIGH", phanLoai: "NEEDS_MANUAL_REVIEW" });
    const chinh = cua(chay(be((s) => (sap(s).lessonIds = ["b2", "bai-1"]))), "TV-42");
    expect(chinh).toHaveLength(1);
    expect(chinh[0]!.lyDo).toContain("không phải bài đầu bộ");
    const ngoai = cua(chay(be((s) => (mucSap(s).lessonId = "b9"))), "TV-42");
    expect(ngoai).toHaveLength(1);
    expect(ngoai[0]!.lyDo).toContain("ngoài bộ bài");
  });

  it("[TV-43] trạng thái case không khớp trạng thái chốt suy từ các bé; các cặp khớp thì không báo", () => {
    const bad: [CaseRow["status"], ("PENDING" | "PRESENT" | "ABSENT" | "REMOVED")[], string][] = [
      ["COMPLETED", ["ABSENT"], "phải là NO_SHOW"],
      ["NO_SHOW", ["PRESENT"], "phải là COMPLETED"],
      ["SCHEDULED", ["PRESENT"], "phải là COMPLETED"],
      ["SCHEDULED", ["REMOVED"], "phải là CANCELLED"],
      ["COMPLETED", ["PENDING", "PRESENT"], "phải là SCHEDULED"],
      ["CANCELLED", ["PENDING"], "phải là SCHEDULED"],
    ];
    const ap = (st: CaseRow["status"], bes: string[]) =>
      be((s) => {
        sap(s).status = st;
        sap(s).participants = bes.map((a, i) => ({ id: `be-${i}`, studentId: `hv-x${i}`, attendanceStatus: a as never }));
        // Mục nối bé đầu tiên và để kết quả khớp tầng 1 — chỉ TV-43 là thứ đang bị bẻ.
        mucSap(s).participantId = "be-0";
        mucSap(s).result = bes[0] === "PRESENT" ? "COMPLETED" : bes[0] === "PENDING" ? "PLANNED" : "RELEASED";
        mucSap(s).status = bes[0] === "PENDING" ? "PLACED" : bes[0] === "PRESENT" ? "PRESENT" : "ABSENT";
      });
    for (const [st, bes, lyDo] of bad) {
      const f = cua(chay(ap(st, bes)), "TV-43");
      expect(f, `${st}/${bes.join(",")}`).toHaveLength(1);
      expect(f[0]!.lyDo).toContain(lyDo);
      expect(f[0]).toMatchObject({ id: "case-sap", thucThe: "MakeupCase" });
    }
    const tot: [CaseRow["status"], string[]][] = [
      ["SCHEDULED", ["PENDING"]],
      ["SCHEDULED", ["PENDING", "PRESENT"]],
      ["COMPLETED", ["PRESENT", "ABSENT"]],
      ["NO_SHOW", ["ABSENT", "REMOVED"]],
      ["CANCELLED", ["REMOVED"]],
    ];
    for (const [st, bes] of tot) expect(cua(chay(ap(st, bes)), "TV-43"), `${st}/${bes.join(",")}`).toEqual([]);
  });

  it("[TV-14/18 nhiều bài] bài của bé nằm TRONG bộ bài (dù khác bài chính) thì không lệch; ngoài bộ ⇒ TV-14; một bài trong bộ không còn ⇒ TV-18", () => {
    const trong = chay(
      be((s) => {
        sap(s).lessonIds = ["bai-1", "bai-2"];
        s.lessonIdsConTon.add("bai-2");
        n(s, "n-xep").missedLessonId = "bai-2";
        mucSap(s).lessonId = "bai-2";
      }),
    );
    expect(cua(trong, "TV-14")).toEqual([]);
    expect(cua(trong, "TV-42")).toEqual([]);
    const ngoai = chay(be((s) => (n(s, "n-xep").missedLessonId = "bai-3")));
    expect(cua(ngoai, "TV-14")).toHaveLength(1);
    const mat = chay(be((s) => (sap(s).lessonIds = ["bai-1", "bai-ma"])));
    expect(cua(mat, "TV-18").some((f) => f.lyDo.includes("bài bai-ma không còn"))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T12 — công dạy bù ngoài bản chốt kỳ công
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-93] công dạy bù ngoài bản chốt kỳ công", () => {
  const buoiXong = { caseId: "case-xong", teacherId: "gv-1", ymd: "2026-10-02", phut: 90, status: "COMPLETED" as const };
  const chot = (s: Snapshot, banChotBuoiBu: Snapshot["kyDaChot"][number]["banChotBuoiBu"]) =>
    s.kyDaChot.push({ centerId: "cs-1", periodKey: "2026-10", banChotBuoiBu });

  it("[TV-93a] bản chốt có đúng buổi bù của kỳ ⇒ sạch; kỳ KHÁC cơ sở / KHÁC tháng thì không liên quan", () => {
    expect(cua(chay(be((s) => chot(s, [buoiXong]))), "TV-93")).toEqual([]);
    expect(chay(be((s) => s.kyDaChot.push({ centerId: "cs-2", periodKey: "2026-10", banChotBuoiBu: [] }))).findings).toEqual([]);
    expect(chay(be((s) => s.kyDaChot.push({ centerId: "cs-1", periodKey: "2026-09", banChotBuoiBu: [] }))).findings).toEqual([]);
  });

  it("[TV-93b] case đã dạy mà bản chốt (có trường, rỗng) không ghi ⇒ HIGH NEEDS_MANUAL_REVIEW, nêu giáo viên + ngày + kỳ", () => {
    const f = cua(chay(be((s) => chot(s, []))), "TV-93");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: "case-xong", nghiemTrong: "HIGH", phanLoai: "NEEDS_MANUAL_REVIEW", thucThe: "MakeupCase" });
    expect(f[0]!.lienQuan).toMatchObject({ giaoVien: "gv-1", ngay: "2026-10-02", ky: "2026-10", loai: "NGOAI_BAN_CHOT" });
  });

  it("[TV-93c] bản chốt CŨ (không có trường) ⇒ MEDIUM, nói rõ là không đối chiếu được — KHÔNG kết luận là sót công", () => {
    const f = cua(chay(be((s) => chot(s, undefined))), "TV-93");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ nghiemTrong: "MEDIUM", phanLoai: "NEEDS_MANUAL_REVIEW" });
    expect(f[0]!.lyDo).toContain("không đối chiếu được");
    expect(f[0]!.lienQuan).toMatchObject({ loai: "BAN_CHOT_TRUOC_T12" });
  });

  it("[TV-93d] case trong bản chốt nhưng đổi giáo viên / trạng thái / giờ SAU chốt ⇒ HIGH", () => {
    for (const doi of [{ teacherId: "gv-9" }, { status: "NO_SHOW" as const }, { phut: 60 }]) {
      const f = cua(chay(be((s) => chot(s, [{ ...buoiXong, ...doi }]))), "TV-93");
      expect(f, JSON.stringify(doi)).toHaveLength(1);
      expect(f[0]!.lienQuan).toMatchObject({ loai: "DOI_SAU_CHOT" });
    }
  });

  it("[TV-93e] bản chốt có buổi mà hiện case đã huỷ / không còn ⇒ HIGH MAT_SAU_CHOT", () => {
    const huy = cua(chay(be((s) => { cs(s, "case-xong").status = "CANCELLED"; chot(s, [buoiXong]); })), "TV-93");
    expect(huy.map((x) => x.lienQuan?.loai)).toEqual(["MAT_SAU_CHOT"]);
    const mat = cua(chay(be((s) => chot(s, [{ ...buoiXong, caseId: "case-da-xoa" }]))), "TV-93");
    expect(mat.map((x) => x.id)).toEqual(["case-xong", "case-da-xoa"].sort());
  });

  it("[TV-93f] case SCHEDULED / CANCELLED trong kỳ đã chốt KHÔNG có công ⇒ không bị đòi phải nằm trong bản chốt", () => {
    const f = chay(be((s) => { chot(s, [buoiXong]); cs(s, "case-sap").date = ngayCase("2026-10-20"); }));
    expect(cua(f, "TV-93")).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T14 — phí đã thu bị hoàn MỘT PHẦN
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-50] suất bằng phí mà phí thu thiếu", () => {
  const xepBangPhi = (s: Snapshot, needId: string) => {
    for (const c of s.cases) for (const sv of c.students) if (sv.makeupNeedId === needId) sv.dungLuot = false;
  };
  const don = (p: Partial<Snapshot["donPhi"][number]> = {}) => ({
    itemId: "oi-1",
    orderId: "od-1",
    orderCode: "ORD-1",
    orderStatus: "CONFIRMED",
    orderDaXoa: false,
    tongTien: 1_980_000,
    daThu: 1_980_000,
    ...p,
  });
  const thiet = (needId: string, d: Partial<Snapshot["donPhi"][number]>, them?: (s: Snapshot) => void) =>
    be((s) => {
      n(s, needId).feeOrderItemId = "oi-1";
      xepBangPhi(s, needId);
      s.donPhi = [don(d)];
      them?.(s);
    });

  it("[TV-50a] đã thu ĐỦ ⇒ sạch; thu thiếu + dòng SCHEDULED ⇒ HIGH AUTO_FIXABLE; thu thiếu + COMPLETED ⇒ MEDIUM NEEDS_MANUAL_REVIEW", () => {
    expect(cua(chay(thiet("n-xep", {})), "TV-50")).toEqual([]);
    const chuaHoc = cua(chay(thiet("n-xep", { daThu: 1_320_000 })), "TV-50");
    expect(chuaHoc).toHaveLength(1);
    expect(chuaHoc[0]).toMatchObject({ id: "n-xep", nghiemTrong: "HIGH", phanLoai: "AUTO_FIXABLE" });
    expect(chuaHoc[0]!.lyDo).toContain("1.320.000đ / 1.980.000đ");
    const daHoc = cua(chay(thiet("n-xong", { daThu: 990_000 })), "TV-50");
    expect(daHoc[0]).toMatchObject({ id: "n-xong", nghiemTrong: "MEDIUM", phanLoai: "NEEDS_MANUAL_REVIEW" });
    expect(daHoc[0]!.deXuat).toContain("không đảo kết quả");
  });

  it("[TV-50b] KHÔNG báo khi suất không dựa vào tiền (miễn phí / vào case bằng lượt), hay đơn đã chết (đó là việc của TV-05), hay dòng chưa vào case", () => {
    expect(cua(chay(thiet("n-xep", { daThu: 100 }, (s) => (n(s, "n-xep").freeApprovedAt = new Date("2026-10-03T00:00:00Z")))), "TV-50")).toEqual([]);
    expect(cua(chay(be((s) => { n(s, "n-xep").feeOrderItemId = "oi-1"; s.donPhi = [don({ daThu: 100 })]; })), "TV-50")).toEqual([]); // vào case bằng LƯỢT
    expect(cua(chay(thiet("n-xep", { daThu: 100, orderStatus: "CANCELLED" })), "TV-50")).toEqual([]);
    expect(cua(chay(be((s) => { n(s, "n-cho").feeOrderItemId = "oi-1"; s.donPhi = [don({ daThu: 100 })]; })), "TV-50")).toEqual([]); // PENDING
  });

  it("[TV-50c] biên: thu ĐÚNG bằng tổng thì đủ; thiếu 1 đồng thì báo", () => {
    expect(cua(chay(thiet("n-xep", { daThu: 1_980_000 })), "TV-50")).toEqual([]);
    expect(cua(chay(thiet("n-xep", { daThu: 1_979_999 })), "TV-50")).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T14 — học viên rời khoá mà còn nợ buổi bù
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("[TV-51] học viên không còn ghi danh hiệu lực mà còn nợ buổi bù", () => {
  it("[TV-51a] thế giới sạch ⇒ không báo; bỏ ghi danh của học viên có dòng PENDING ⇒ LOW; có dòng SCHEDULED ⇒ MEDIUM; đều NEEDS_MANUAL_REVIEW, không tự sửa", () => {
    expect(cua(chay(sach()), "TV-51")).toEqual([]);
    const cho = cua(chay(be((s) => s.ghiDanhHieuLuc.delete("hv-1|khoa-1"))), "TV-51");
    expect(cho).toHaveLength(1);
    expect(cho[0]).toMatchObject({ id: "n-cho", nghiemTrong: "LOW", phanLoai: "NEEDS_MANUAL_REVIEW" });
    expect(cho[0]!.deXuat).toContain("KHÔNG tự huỷ");
    const xep = cua(chay(be((s) => s.ghiDanhHieuLuc.delete("hv-2|khoa-1"))), "TV-51");
    expect(xep[0]).toMatchObject({ id: "n-xep", nghiemTrong: "MEDIUM", phanLoai: "NEEDS_MANUAL_REVIEW" });
    expect(xep[0]!.deXuat).toContain("KHÔNG tự gỡ");
  });

  it("[TV-51b] dòng ĐÃ BÙ XONG hay đã huỷ thì không nêu (lịch sử, không còn nợ); khác khoá thì không lẫn", () => {
    expect(cua(chay(be((s) => s.ghiDanhHieuLuc.delete("hv-3|khoa-1"))), "TV-51")).toEqual([]); // n-xong COMPLETED
    expect(cua(chay(be((s) => { n(s, "n-cho").status = "CANCELLED"; s.ghiDanhHieuLuc.delete("hv-1|khoa-1"); })), "TV-51")).toEqual([]);
    // Ghi danh còn ở khoá KHÁC không cứu dòng của khoá này.
    expect(cua(chay(be((s) => { s.ghiDanhHieuLuc.delete("hv-1|khoa-1"); s.ghiDanhHieuLuc.add("hv-1|khoa-khac"); })), "TV-51")).toHaveLength(1);
  });
});
