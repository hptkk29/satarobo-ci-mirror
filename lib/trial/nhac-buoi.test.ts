/**
 * NHẮC GIÁO VIÊN TRƯỚC GIỜ DẠY TRẢI NGHIỆM (V2-d, chủ dự án chốt 17/09/2026).
 *
 * ── VÌ SAO BỘ NÀY RA ĐỜI ─────────────────────────────────────────────────────────────────
 * Cron `trial-reminder` trước đợt này chỉ nhắc SALE, và thân của nó nằm thẳng trong
 * `route.ts` mở màn bằng `const now = new Date()` — tức KHÔNG ca test nào chạm được vào
 * phần rẽ mốc. Thêm một nhánh người nhận vào một vùng không có test là cách chắc chắn nhất
 * để Sale ăn thêm chuông lạ mà không ai biết.
 *
 * Bốn thứ bộ này canh, theo đúng thứ tự dễ hỏng:
 *   1. MỘT BUỔI = MỘT CHUÔNG cho giáo viên. Nhánh Sale nhắc theo CA (mỗi ca một phụ huynh
 *      phải gọi); bê nguyên vòng lặp đó sang là buổi 5 bé thành 5 lần rung máy.
 *   2. Hai nhánh KHÔNG rò sang nhau: mốc GV không gửi Sale, mốc Sale không gửi GV.
 *   3. Buổi tới mốc mà chưa ai dạy ⇒ leo thang Đào tạo bằng khoá RIÊNG (trùng khoá cũ là
 *      ĐÈ mất tin gốc lúc tạo buổi).
 *   4. Body của chuông GV KHÔNG chứa PII. Chuông này đi tiếp ra Web Push, hiện trên MÀN HÌNH
 *      KHOÁ — không `can()` nào gác được (xem `lib/push/payload.ts`).
 *
 * ⚠️ Luật 19: mọi mốc thời gian ở đây là TUYỆT ĐỐI và `now` được TRUYỀN vào. Không ca nào
 * đọc đồng hồ thật, nên bộ này không có ngày hết hạn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const trangThai = {
    buoi: [
      {
        id: "ts1",
        date: new Date("2026-09-20T00:00:00.000Z"),
        startTime: "18:00",
        seq: 2,
        teacherId: "u_gv" as string | null,
        trialClassId: "tc1",
        trialClass: { name: "Lớp trải nghiệm T7", centerId: "cs1" } as {
          name: string;
          centerId: string | null;
        } | null,
      },
    ],
    // BA ca trong CÙNG một buổi, ba Sale khác nhau — đúng hình dạng làm lộ lỗi "5 bé, 5 chuông".
    cas: [
      caHocThu("te1", "Bé An", "u_sale_1"),
      caHocThu("te2", "Bé Bình", "u_sale_2"),
      caHocThu("te3", "Bé Chi", "u_sale_3"),
    ],
    nguoiDaoTao: [{ id: "u_daotao" }] as { id: string }[],
  };

  /**
   * ⚠️ `scheduledSessionId` MẶC ĐỊNH `null` vì đó là HÌNH DẠNG THẬT trên prod, không phải
   * cho tiện. Từ 28/08 cả hai màn xếp chỗ bên admin đều cố ý không truyền `sessionId`, nên
   * `lib/trial/service.ts:381` ghi null, và null ở bảng này nghĩa là **học TOÀN BỘ buổi của
   * lớp** chứ không phải "chưa xếp buổi".
   *
   * Fixture cũ KHÔNG có hai cột này, và mock thì bỏ qua `where` — cộng lại thành một bộ test
   * xanh 12/12 trong khi mã sản xuất không nhắc nổi một ai. Dữ liệu tròn trịa trong test là
   * dữ liệu không kiểm được gì.
   */
  function caHocThu(
    id: string,
    ten: string,
    saleId: string,
    ghim: {
      scheduledSessionId?: string | null;
      trialClassId?: string;
      /** Lớp chứa ca là lớp THEO KHUNG? Mặc định lớp slot CŨ — hình dạng thật trên prod. */
      theoKhung?: boolean;
    } = {},
  ) {
    return {
      id,
      scheduledSessionId: ghim.scheduledSessionId ?? null,
      trialClassId: ghim.trialClassId ?? "tc1",
      // 23/09 — câu truy vấn thật lọc nhánh "học cả lớp" theo LOẠI LỚP
      // (`trialClass: LOP_CU_WHERE`), nên fixture phải mang khung của lớp. Thiếu cột này
      // thì mock không khớp được gì và cả bộ đỏ vì fixture, không vì mã.
      trialClass: { theoKhung: ghim.theoKhung ?? false },
      leadChild: {
        fullName: ten,
        lead: {
          id: `lead_${id}`,
          parentName: `Phụ huynh ${ten}`,
          phone: "0905123456",
          assignedToId: saleId,
          adminId: null as string | null,
        },
      },
    };
  }

  /**
   * ⚠️ Mock TÔN TRỌNG `select` — không trả nguyên bản ghi.
   *
   * Đo thật 17/09: bản mock đầu tiên trả thẳng `trangThai.buoi`, và khi CẤY LỖI bằng cách
   * xoá dòng `teacherId: true` khỏi câu truy vấn thì cả 12 ca VẪN XANH. Mock rộng hơn truy
   * vấn thật thì nó tự vá giúp mã đang hỏng — đúng lớp lỗi "quên `select` cột nguồn" mà luật
   * 7 nói tới, và là loại chỉ lộ ra trên PROD (Prisma trả `undefined`, nhánh GV im lặng rơi
   * hết sang leo thang Đào tạo).
   *
   * Phép chiếu cố ý THÔ: chỉ đủ để cột không khai trong `select` biến mất.
   */
  function chieuTheoSelect(
    row: Record<string, unknown>,
    select?: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!select) return row;
    const out: Record<string, unknown> = {};
    for (const [khoa, gia] of Object.entries(select)) {
      if (!gia) continue;
      const val = row[khoa];
      const conSelect =
        typeof gia === "object" && gia !== null
          ? (gia as { select?: Record<string, unknown> }).select
          : undefined;
      out[khoa] =
        conSelect && val && typeof val === "object"
          ? chieuTheoSelect(val as Record<string, unknown>, conSelect)
          : val;
    }
    return out;
  }

  type ThamSoTruyVan = { select?: Record<string, unknown>; where?: Record<string, unknown> } | undefined;

  /**
   * Mock của `trialEnrollment.findMany` phải TÔN TRỌNG `where`.
   *
   * ⚠️ Đây là bản vá của một bộ test MÙ (17/09/2026). Bản cũ trả thẳng cả ba ca bất kể
   * `where`, nên nó khẳng định "giáo viên được nhắc" trong khi câu truy vấn thật lọc
   * `scheduledSessionId: s.id` — không bao giờ khớp `null` — và trên prod thì KHÔNG AI được
   * nhắc, cả Sale lẫn giáo viên, im lặng từ 28/08. Mock rộng hơn truy vấn thật thì nó tự vá
   * giúp mã đang hỏng.
   *
   * Chỉ hiểu đúng hình dạng `where` mà mã sản xuất dùng: `status` + `OR[]` của hai vế bằng.
   * Cố ý KHÔNG dựng một bộ máy so khớp tổng quát — bộ máy đó sẽ lại rộng hơn truy vấn thật.
   */
  function khopWhere(row: Record<string, unknown>, where?: Record<string, unknown>): boolean {
    if (!where) return true;
    for (const [khoa, dieu] of Object.entries(where)) {
      if (khoa === "OR") {
        const nhanh = dieu as Record<string, unknown>[];
        if (!nhanh.some((n) => khopWhere(row, n))) return false;
        continue;
      }
      // Bộ lọc LỒNG của một quan hệ (`trialClass: { OR: [...] }`) — đệ quy vào đúng
      // object con của dòng. Chỉ nhận object thường; mọi thứ khác vẫn là phép so bằng.
      if (dieu !== null && typeof dieu === "object" && !Array.isArray(dieu)) {
        const con = row[khoa];
        if (con === null || typeof con !== "object") return false;
        if (!khopWhere(con as Record<string, unknown>, dieu as Record<string, unknown>)) return false;
        continue;
      }
      if (row[khoa] !== dieu) return false;
    }
    return true;
  }

  /**
   * MỌI tin đã gửi trong lượt chạy, theo thứ tự, gộp CẢ HAI cửa ghi.
   *
   * ⚠️ Vì sao phải gộp (17/09/2026): nhánh GV nay đi qua `notifyStaffChiTiet` (nó cần
   * `canRung` để biết có THẬT SỰ gửi hay không), nhánh Sale và nhánh leo thang Đào tạo
   * vẫn đi `notifyStaff`. Đếm theo MỘT mock là đếm sót: ca "đúng một chuông cho một buổi"
   * sẽ xanh vì nhìn nhầm cửa, chứ không phải vì mã đúng.
   */
  const daGui: Record<string, unknown>[] = [];
  /** Kết quả `ghiThongBaoNhanSu` mà cửa chi tiết trả về — ca nào cần thì sửa tại chỗ. */
  const ketQuaGhi = { soNguoi: 1, canRung: ["u_gv"] as string[] };

  const notifyStaff = vi.fn(async (p: Record<string, unknown>) => {
    daGui.push(p);
    return 1;
  });
  const notifyStaffChiTiet = vi.fn(async (p: Record<string, unknown>) => {
    daGui.push(p);
    return { soNguoi: ketQuaGhi.soNguoi, canRung: [...ketQuaGhi.canRung] };
  });
  const mockDb = {
    trialClassSession: {
      findMany: vi.fn(async (a: ThamSoTruyVan) =>
        trangThai.buoi.map((r) => chieuTheoSelect(r as unknown as Record<string, unknown>, a?.select)),
      ),
    },
    trialEnrollment: {
      findMany: vi.fn(async (a: ThamSoTruyVan) =>
        trangThai.cas
          .filter((r) => khopWhere({ ...(r as unknown as Record<string, unknown>), status: "ACTIVE" }, a?.where))
          .map((r) => chieuTheoSelect(r as unknown as Record<string, unknown>, a?.select)),
      ),
    },
    user: {
      findMany: vi.fn(async (a: ThamSoTruyVan) =>
        trangThai.nguoiDaoTao.map((r) => chieuTheoSelect(r as unknown as Record<string, unknown>, a?.select)),
      ),
    },
  };
  return { trangThai, caHocThu, notifyStaff, notifyStaffChiTiet, daGui, ketQuaGhi, mockDb };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/notifications/notify", () => ({
  notifyStaff: h.notifyStaff,
  notifyStaffChiTiet: h.notifyStaffChiTiet,
}));

import { chayNhacTrial } from "./nhac-buoi";

// Buổi 18:00 giờ VN ngày 20/09/2026. Cột `@db.Date` ⇒ Prisma trả UTC-midnight của ngày VN,
// nên mốc bắt đầu THẬT = 2026-09-20T11:00:00.000Z (18:00 − 7h).
const BAT_DAU = new Date("2026-09-20T11:00:00.000Z");
/** Còn đúng 1,0h ⇒ rơi vào cửa sổ "1-gio" [0.4, 1.5) — mốc của GIÁO VIÊN. */
const NOW_MOC_GV = new Date("2026-09-20T10:00:00.000Z");
/** Còn đúng 2,0h ⇒ rơi vào cửa sổ "2-gio" [1.5, 2.5) — mốc của SALE. */
const NOW_MOC_SALE = new Date("2026-09-20T09:00:00.000Z");

/** Mọi tham số đã truyền cho CỬA GHI (cả hai cửa), theo đúng thứ tự gọi. */
function moiTin(): Record<string, unknown>[] {
  return h.daGui;
}

/** Số chuông đã gửi trong lượt chạy — gộp cả hai cửa ghi. */
function soTin(): number {
  return h.daGui.length;
}

function khoa(): string[] {
  return moiTin().map((t) => String(t.dedupeKey));
}

/** Mọi userId đã nhận chuông, gộp lại. */
function moiNguoiNhan(): string[] {
  return moiTin().flatMap((t) => (t.userIds as string[]) ?? []);
}

beforeEach(() => {
  vi.clearAllMocks();
  // `vi.clearAllMocks()` KHÔNG đụng tới mảng dùng chung — quên dòng này là ca sau đọc
  // được tin của ca trước và cả bộ chỉ xanh nhờ thứ tự chạy hiện tại (luật 18).
  h.daGui.length = 0;
  h.ketQuaGhi.soNguoi = 1;
  h.ketQuaGhi.canRung = ["u_gv"];
  // Dựng lại TOÀN BỘ trạng thái ở mỗi ca (luật 18: mỗi ca phải xanh khi chạy MỘT MÌNH).
  // `h.trangThai.*` là đối tượng dùng chung giữa các ca, nên thiếu chỗ này là ca sau mượn
  // trạng thái ca trước và cả bộ chỉ xanh nhờ thứ tự chạy hiện tại.
  h.trangThai.buoi[0]!.teacherId = "u_gv";
  h.trangThai.buoi[0]!.startTime = "18:00";
  h.trangThai.buoi[0]!.trialClass = { name: "Lớp trải nghiệm T7", centerId: "cs1" };
  h.trangThai.cas = [
    h.caHocThu("te1", "Bé An", "u_sale_1"),
    h.caHocThu("te2", "Bé Bình", "u_sale_2"),
    h.caHocThu("te3", "Bé Chi", "u_sale_3"),
  ];
  h.trangThai.nguoiDaoTao = [{ id: "u_daotao" }];
  // ⚠️ KHÔNG `h.notifyStaff.mockResolvedValue(1)` ở đây nữa. `mockResolvedValue` THAY
  // hiện thực của mock, tức xoá luôn dòng `daGui.push(p)` — và `vi.clearAllMocks()` chỉ
  // xoá lịch sử gọi chứ không phục hồi hiện thực gốc, nên lượt sau vẫn dùng bản đã thay.
  // Đo thật: để lại dòng đó thì ca leo thang Đào tạo và ca mốc 2 tiếng đọc được danh sách
  // tin RỖNG (2 ĐỎ) — một bộ test mù đúng kiểu, vì mã sản xuất vẫn gửi đủ.
  h.trangThai.buoi[0]!.date = new Date("2026-09-20T00:00:00.000Z");
});

describe("[TRIAL-T50] mốc 1 tiếng — nhắc GIÁO VIÊN", () => {
  it("⚠️ ĐÚNG MỘT chuông cho MỘT BUỔI, dù buổi có 3 ca", async () => {
    // Đây là ca quan trọng nhất của bộ. Nhánh Sale nhắc theo CA; bê nguyên vòng lặp đó sang
    // nhánh GV là 3 lần rung máy cho cùng một việc dạy, và `dedupeKey` không cứu được vì
    // mỗi ca sinh một khoá khác nhau.
    const kq = await chayNhacTrial({ now: NOW_MOC_GV });

    expect(soTin()).toBe(1);
    expect(khoa()).toEqual(["trial.reminder-gv:1-gio:ts1:2026-09-20"]);
    expect(moiTin()[0]!.userIds).toEqual(["u_gv"]);
    expect(kq.daNhacGv).toBe(1);
    expect(kq.daNhac).toBe(0);
  });

  it("nội dung nói rõ GIỜ và LỚP — thiếu thì người nhận phải mở app ra mới biết dạy gì", async () => {
    await chayNhacTrial({ now: NOW_MOC_GV });
    const tin = moiTin()[0]!;
    expect(String(tin.title)).toContain("18:00");
    expect(String(tin.title)).toContain("20/09");
    expect(String(tin.body)).toContain("Lớp trải nghiệm T7");
  });

  it("⚠️ KHÔNG có PII trong chuông GV — nó hiện trên MÀN HÌNH KHOÁ qua Web Push", async () => {
    await chayNhacTrial({ now: NOW_MOC_GV });
    const chu = `${moiTin()[0]!.title} ${moiTin()[0]!.body}`;
    expect(chu).not.toContain("0905123456");
    expect(chu).not.toContain("Phụ huynh");
    expect(chu).not.toContain("Bé An");
  });

  it("buổi CHƯA CÓ giáo viên ⇒ leo thang Đào tạo bằng khoá RIÊNG, không đè tin gốc", async () => {
    h.trangThai.buoi[0]!.teacherId = null;
    const kq = await chayNhacTrial({ now: NOW_MOC_GV });

    expect(khoa()).toEqual(["trial.cho-phan-cong-gap:ts1"]);
    // KHÔNG được là `trial.cho-phan-cong:ts1` — khoá đó thuộc tin lúc TẠO buổi, và
    // `@@unique([userId, dedupeKey])` nghĩa là trùng khoá thì lượt sau ĐÈ lên bản ghi cũ.
    expect(khoa()).not.toContain("trial.cho-phan-cong:ts1");
    expect(moiTin()[0]!.userIds).toEqual(["u_daotao"]);
    expect(kq.leoThang).toBe(1);
    expect(kq.daNhacGv).toBe(0);
  });

  it("chưa có giáo viên VÀ không ai thuộc Đào tạo ⇒ im, đếm vào boQua", async () => {
    h.trangThai.buoi[0]!.teacherId = null;
    h.trangThai.nguoiDaoTao = [];
    const kq = await chayNhacTrial({ now: NOW_MOC_GV });

    expect(soTin()).toBe(0);
    expect(kq.boQua).toBe(1);
  });

  it("buổi KHÔNG còn ca ACTIVE nào ⇒ IM HẲN (buổi rỗng là bình thường, slot tái sử dụng)", async () => {
    h.trangThai.cas = [];
    const kq = await chayNhacTrial({ now: NOW_MOC_GV });

    expect(soTin()).toBe(0);
    expect(kq.daNhacGv).toBe(0);
    expect(kq.leoThang).toBe(0);
  });
});

describe("[TRIAL-T51] hai nhánh KHÔNG rò sang nhau", () => {
  it("mốc 1 tiếng: KHÔNG một chuông nào tới Sale", async () => {
    await chayNhacTrial({ now: NOW_MOC_GV });

    expect(khoa().filter((k) => k.startsWith("trial.reminder:"))).toEqual([]);
    for (const sale of ["u_sale_1", "u_sale_2", "u_sale_3"]) {
      expect(moiNguoiNhan()).not.toContain(sale);
    }
  });

  it("mốc 2 tiếng: nhắc ĐỦ 3 Sale và KHÔNG chuông nào tới giáo viên", async () => {
    const kq = await chayNhacTrial({ now: NOW_MOC_SALE });

    expect(khoa()).toEqual([
      "trial.reminder:2-gio:te1:ts1",
      "trial.reminder:2-gio:te2:ts1",
      "trial.reminder:2-gio:te3:ts1",
    ]);
    expect(moiNguoiNhan()).toEqual(["u_sale_1", "u_sale_2", "u_sale_3"]);
    expect(moiNguoiNhan()).not.toContain("u_gv");
    expect(kq.daNhac).toBe(3);
    expect(kq.daNhacGv).toBe(0);
  });

  it("mốc 2 tiếng mà buổi chưa có giáo viên ⇒ KHÔNG leo thang (leo thang chỉ ở mốc GV)", async () => {
    // Còn 2 tiếng thì việc phân công vẫn theo đường thường; leo thang sớm là làm nhiễu.
    h.trangThai.buoi[0]!.teacherId = null;
    const kq = await chayNhacTrial({ now: NOW_MOC_SALE });

    expect(khoa().some((k) => k.startsWith("trial.cho-phan-cong-gap:"))).toBe(false);
    expect(kq.leoThang).toBe(0);
    expect(kq.daNhac).toBe(3);
  });
});

describe("[TRIAL-T55] lớp THEO KHUNG — bé NULL là \"chưa xếp case\", KHÔNG nhắc theo case", () => {
  // 23/09/2026. Ở lớp theo khung (mô hình case), NULL không còn là "học cả lớp"
  // (`lib/trial/nghia-null.ts`). Bản trước đếm bé NULL vào MỌI case của lớp: Sale nhận
  // N chuông với N giờ khác nhau cho cùng một bé mà màn admin nói là chưa có case, và
  // case không có bé nào của nó vẫn nhắc giáo viên (hoặc leo thang Đào tạo).


  it("mốc 2 tiếng: bé NULL ở lớp theo khung KHÔNG sinh chuông Sale nào", async () => {
    h.trangThai.cas = [
      h.caHocThu("te1", "Bé An", "u_sale_1", { theoKhung: true }),
      h.caHocThu("te2", "Bé Bình", "u_sale_2", { theoKhung: true }),
    ];
    await chayNhacTrial({ now: NOW_MOC_SALE });
    expect(soTin()).toBe(0);
  });

  it("mốc 1 tiếng: case chỉ có bé NULL (lớp theo khung) ⇒ KHÔNG nhắc giáo viên", async () => {
    h.trangThai.cas = [h.caHocThu("te1", "Bé An", "u_sale_1", { theoKhung: true })];
    await chayNhacTrial({ now: NOW_MOC_GV });
    expect(soTin()).toBe(0);
  });

  it("bé GHIM đúng case ở lớp theo khung thì VẪN được nhắc — cổng không nuốt ca thật", async () => {
    h.trangThai.cas = [
      h.caHocThu("te1", "Bé An", "u_sale_1", { theoKhung: true, scheduledSessionId: "ts1" }),
    ];
    await chayNhacTrial({ now: NOW_MOC_SALE });
    expect(soTin()).toBe(1);
  });
});

describe("[TRIAL-T52] ngoài mọi cửa sổ", () => {
  it("còn 6 tiếng ⇒ không mốc nào khớp ⇒ im", async () => {
    const kq = await chayNhacTrial({ now: new Date(BAT_DAU.getTime() - 6 * 3_600_000) });
    expect(soTin()).toBe(0);
    expect(kq.buoiQuet).toBe(1);
  });

  it("còn 20 phút ⇒ đã TRƯỢT mép dưới của mốc GV (0,4h) ⇒ im", async () => {
    // Hệ quả đã biết và đã ghi trong `_moc.ts`: buổi tạo muộn hơn ~24 phút trước giờ dạy
    // KHÔNG BAO GIỜ nhận chuông của mốc này.
    const kq = await chayNhacTrial({ now: new Date(BAT_DAU.getTime() - 20 * 60_000) });
    expect(soTin()).toBe(0);
    expect(kq.daNhacGv).toBe(0);
  });

  it("giờ bắt đầu hỏng ⇒ bỏ qua buổi, không đoán, không ném", async () => {
    h.trangThai.buoi[0]!.startTime = "18h00";
    const kq = await chayNhacTrial({ now: NOW_MOC_GV });
    expect(soTin()).toBe(0);
    expect(kq.boQua).toBe(1);
    // Không dọn ở đây: `beforeEach` mới là chỗ dựng lại trạng thái. Dọn ở cuối ca thì
    // một assertion ném là ca sau thừa hưởng dữ liệu hỏng (luật 18).
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// VÁ 17/09/2026 — DỜI BUỔI SAU KHI CHUÔNG ĐÃ PHÁT
//
// `dedupeKey` có `@@unique([userId, dedupeKey])`, nên khoá `<mocTen>:<sessionId>` là khoá
// VĨNH VIỄN cho cặp (giáo viên, buổi). Đường hỏng: buổi 14/11 18:00 đã bắn chuông; Sale
// dời sang 15/11 18:00 (status vẫn SCHEDULED, `sessionId` KHÔNG đổi); hôm sau lượt cron
// tới mốc dựng lại ĐÚNG khoá đó ⇒ `ghiThongBaoNhanSu` chỉ `update` nội dung, `canRung`
// rỗng ⇒ KHÔNG broadcast, KHÔNG Web Push, `readAt` giữ nguyên "đã đọc". Giáo viên không
// được nhắc cho NGÀY MỚI, và `stats.daNhacGv` vẫn đếm 1 nên nhật ký cron báo "đã nhắc".
//
// Hai vế của bản vá, canh riêng:
//   1. khoá mang MỐC NGÀY ⇒ dời sang ngày khác là một việc nhắc KHÁC;
//   2. `daNhacGv` chỉ tăng khi `canRung` KHÔNG rỗng ⇒ con số trên nhật ký kiểm được.
//
// ── CẤY LẠI LỖI (luật 15) — đã chạy THẬT ────────────────────────────────────────────
//   · bỏ `:${vnYmd(batDau)}` khỏi khoá                      → **4 ĐỎ / 17**
//   · đổi lại thành `stats.daNhacGv++` vô điều kiện         → **1 ĐỎ / 17**
// ═════════════════════════════════════════════════════════════════════════════════════

describe("[TRIAL-T53] dời buổi ⇒ chuông MỚI, không chạm lại khoá cũ", () => {
  /** Cùng buổi `ts1`, nhưng lịch đã dời sang 21/09. Mốc GV = 1 tiếng trước 18:00 VN. */
  const NGAY_MOI = new Date("2026-09-21T00:00:00.000Z");
  const NOW_MOC_GV_NGAY_MOI = new Date("2026-09-21T10:00:00.000Z");

  // ⭐ CA KHOÁ: hai lượt chạy, cùng `sessionId`, hai khoá KHÁC NHAU.
  it("dời từ 20/09 sang 21/09 ⇒ khoá đổi theo NGÀY, không đè lên chuông đã đọc", async () => {
    await chayNhacTrial({ now: NOW_MOC_GV });
    const khoaCu = khoa();

    // Sale dời lịch: chỉ cột `date` đổi, `id` và `status` giữ nguyên — đúng hình dạng
    // mà `updateLopTrialSessionAction` ghi xuống.
    h.daGui.length = 0;
    h.trangThai.buoi[0]!.date = NGAY_MOI;
    await chayNhacTrial({ now: NOW_MOC_GV_NGAY_MOI });

    expect(khoaCu).toEqual(["trial.reminder-gv:1-gio:ts1:2026-09-20"]);
    expect(khoa()).toEqual(["trial.reminder-gv:1-gio:ts1:2026-09-21"]);
    expect(khoa()[0]).not.toBe(khoaCu[0]);
  });

  it("khoá và TIÊU ĐỀ không bao giờ nói hai ngày khác nhau", () => {
    // Cả hai cùng sinh từ `batDau`, nên ca này canh việc không ai tách chúng ra sau này.
    return chayNhacTrial({ now: NOW_MOC_GV }).then(() => {
      const tin = moiTin()[0]!;
      expect(String(tin.dedupeKey)).toContain("2026-09-20");
      expect(String(tin.title)).toContain("20/09");
    });
  });

  it("chạy LẠI đúng buổi đó trong cùng cửa sổ ⇒ vẫn đúng MỘT khoá (không đẻ chuông mới)", async () => {
    // Mốc "1-gio" rộng 1,1 giờ nên một buổi lọt vào nhiều lượt cron liên tiếp. Ngày không
    // đổi ⇒ khoá không đổi ⇒ `dedupeKey` làm đúng việc của nó. Vế này phải giữ, nếu không
    // bản vá biến thành "mỗi lượt cron một chuông".
    await chayNhacTrial({ now: NOW_MOC_GV });
    await chayNhacTrial({ now: new Date(BAT_DAU.getTime() - 30 * 60_000) });
    expect(new Set(khoa())).toEqual(new Set(["trial.reminder-gv:1-gio:ts1:2026-09-20"]));
  });
});

describe("[TRIAL-T54] daNhacGv đếm CHUÔNG ĐÃ GỬI, không đếm lượt quét", () => {
  // ⭐ CA KHOÁ: cửa ghi nhận đúng một người nhận nhưng KHÔNG ai được đánh động (bản ghi y
  // nguyên từ lượt trước) ⇒ con số phải là 0. Đây là hình dạng của mọi lượt cron thứ hai
  // trở đi trong cùng cửa sổ 1,1 giờ.
  it("canRung RỖNG (bản ghi y nguyên) ⇒ daNhacGv = 0, dù vẫn gọi cửa ghi", async () => {
    h.ketQuaGhi.canRung = [];
    const kq = await chayNhacTrial({ now: NOW_MOC_GV });

    expect(soTin()).toBe(1); // vẫn gọi — `dedupeKey` là thứ quyết định gửi hay không
    expect(kq.daNhacGv).toBe(0);
  });

  it("canRung có người ⇒ daNhacGv = 1", async () => {
    const kq = await chayNhacTrial({ now: NOW_MOC_GV });
    expect(kq.daNhacGv).toBe(1);
  });
});
