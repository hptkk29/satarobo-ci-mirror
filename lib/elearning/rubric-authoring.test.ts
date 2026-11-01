// @vitest-environment node
/**
 * EL-15b — dựng khung chấm.
 *
 * Ranh giới nháp / đã-kích-hoạt là thứ phải giữ chặt nhất ở đây, y hệt đề thi và
 * cùng lý do: sửa tiêu chí của một khung đã chấm bài làm LỆCH ĐIỂM của mọi bài đã
 * chấm, im lặng — và điểm đó nằm trong hồ sơ nhân sự.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActionError } from "@/lib/actions/factory";
import {
  cauHinhTaoKhung,
  cauHinhSuaKhung,
  cauHinhThemTieuChi,
  cauHinhSuaTieuChi,
  cauHinhXoaTieuChi,
  cauHinhSapXepTieuChi,
  cauHinhKichHoatKhung,
  taoKhungSchema,
} from "@/lib/elearning/rubric-authoring";

const h = vi.hoisted(() => ({
  orgUnitId: vi.fn<(c: string | null) => Promise<string | null>>(async () => "ou1"),
  // Lượt kiểm TRÙNG MÃ đi qua `scopedDb(actor, { bypass: true })` — cố ý, vì
  // `code` là `@unique` toàn hệ thống nên phép kiểm phải nhìn được cả bản ghi
  // ngoài tầm của actor. Mock riêng nó để test soi được đúng lượt đọc đó.
  timTrungMa: vi.fn<() => Promise<unknown>>(async () => null),
}));
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: h.orgUnitId }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({ trnRubric: { findFirst: h.timTrungMa } }),
}));

/**
 * Dựng một dòng quyền cho Actor GIẢ.
 *
 * ⚠️ Đi qua hàm thay vì viết thẳng khoá vào ô `action` là CÓ CHỦ ĐÍCH: guard
 * `registry/elearning.test.ts` quét đúng hình dạng đó để chặn việc KHAI BÁO khoá
 * quyền rải rác ngoài `registry` và `seed-roles.ts`. Đây là fixture, không phải một
 * lời khai báo — nhưng nó trùng hình dạng, và làm guard đỏ vì một fixture là cách
 * chắc chắn để ai đó tắt guard đi.
 */
const quyen = (action: string, centerScope: "ALL" | string[]) => ({
  action,
  centerScope,
});

const MUC = (...diem: number[]) =>
  diem.map((p, i) => ({ label: `Mức ${i + 1}`, points: p }));

const KHUNG_NEN = {
  code: "TU-VAN-L1",
  title: "Quy trình tư vấn — bậc 1",
  totalPoints: 100,
  passPoints: 80,
};

type Ban = {
  khung: unknown;
  trungMa: unknown;
  tieuChi: unknown;
  dsTieuChi: unknown[];
  cuoi: { orderIndex: number } | null;
  createKhung: ReturnType<typeof vi.fn<(a: unknown) => Promise<{ id: string }>>>;
  updateKhung: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
  createTc: ReturnType<typeof vi.fn<(a: unknown) => Promise<{ id: string }>>>;
  updateTc: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
  delTc: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
};
let b: Ban;

const dbGia = () => {
  const tcApi = {
    findFirst: vi.fn(async (a: { orderBy?: unknown }) =>
      a?.orderBy ? b.cuoi : b.tieuChi,
    ),
    findMany: vi.fn(async () => b.dsTieuChi),
    create: b.createTc,
    update: b.updateTc,
    delete: b.delTc,
  };
  const api = {
    trnRubric: {
      // Lượt đọc thứ nhất là `napKhung`; các lượt sau là kiểm trùng mã.
      findFirst: vi.fn(async (a: { where?: { code?: string } }) =>
        a?.where?.code ? b.trungMa : b.khung,
      ),
      create: b.createKhung,
      update: b.updateKhung,
    },
    trnRubricCriterion: tcApi,
  };
  return {
    ...api,
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(api),
  } as never;
};

const actorHO = { userId: "u1", isHoLevel: true, visibleCenterIds: [] } as never;

async function batLoi(p: Promise<unknown>): Promise<ActionError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ActionError) return e;
    throw e;
  }
  throw new Error("phải ném ActionError");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.orgUnitId.mockResolvedValue("ou1");
  h.timTrungMa.mockResolvedValue(null);
  b = {
    khung: {
      id: "k1",
      code: "TU-VAN-L1",
      title: "Quy trình tư vấn — bậc 1",
      status: "DRAFT",
      totalPoints: 100,
      passPoints: 80,
      centerId: "cs1",
    },
    trungMa: null,
    tieuChi: { id: "tc1", rubricId: "k1", label: "Mở đầu", orderIndex: 0, weight: 60 },
    dsTieuChi: [
      { id: "tc1", levelsJson: MUC(0, 30, 60) },
      { id: "tc2", levelsJson: MUC(0, 20, 40) },
    ],
    cuoi: { orderIndex: 1 },
    createKhung: vi.fn(async (_a: unknown) => ({ id: "k1" })),
    updateKhung: vi.fn(async (_a: unknown) => ({})),
    createTc: vi.fn(async (_a: unknown) => ({ id: "tc9" })),
    updateTc: vi.fn(async (_a: unknown) => ({})),
    delTc: vi.fn(async (_a: unknown) => ({})),
  };
});

// ── 1. Tạo khung ───────────────────────────────────────────────────────────

describe("tạo khung chấm", () => {
  const tao = (input: Record<string, unknown> = {}) =>
    cauHinhTaoKhung.handler({
      db: dbGia(),
      actor: actorHO,
      input: { ...KHUNG_NEN, ...input },
    } as never);

  it("ghi khung ở trạng thái NHÁP", async () => {
    await tao();
    const arg = b.createKhung.mock.calls[0]![0] as { data: { status: string } };
    expect(arg.data.status).toBe("DRAFT");
  });

  it("🔴 gọi `orgUnitIdForCenter` TƯỜNG MINH, kể cả khi cơ sở là `null`", async () => {
    // Dual-write cố ý không đoán khi `centerId` là `null`, mà ở bảng này `null` là
    // giá trị THẬT (khung dùng chung). Trông chờ nó thì khung chung có `orgUnitId`
    // bỏ trống, và không ai để ý cho tới lúc báo cáo theo đơn vị thiếu mất nó.
    await tao();
    expect(h.orgUnitId).toHaveBeenCalledWith(null);
    const arg = b.createKhung.mock.calls[0]![0] as {
      data: { centerId: string | null; orgUnitId: string | null };
    };
    expect(arg.data.centerId).toBeNull();
    expect(arg.data.orgUnitId).toBe("ou1");
  });

  it("🔴 ngưỡng đạt VƯỢT thang ⇒ từ chối ngay lúc tạo", async () => {
    // Chặn ở đây chứ không đợi lúc kích hoạt: người soạn vừa gõ hai con số đó
    // xong, họ sửa được ngay.
    const e = await batLoi(tao({ passPoints: 200 }));
    expect(e.code).toBe("NGUONG_VUOT_THANG");
    expect(b.createKhung).not.toHaveBeenCalled();
  });

  it("🔴 TRÙNG MÃ ⇒ báo rõ, không để `P2002` bay lên", async () => {
    // `code` là `@unique` TOÀN HỆ THỐNG: người ở CS1 đụng mã của khung CS2 mà họ
    // không có quyền nhìn thấy. Thông báo nói "mã đã dùng", không nói khung nào.
    h.timTrungMa.mockResolvedValue({ id: "k-khac" });
    const e = await batLoi(tao());
    expect(e.code).toBe("MA_DA_DUNG");
    expect(e.message).not.toContain("k-khac");
    expect(b.createKhung).not.toHaveBeenCalled();
  });

  it("mã sai khuôn bị Zod chặn", () => {
    for (const code of ["tu-van", "TU VAN", "TU_VAN", "AB"]) {
      expect(taoKhungSchema.safeParse({ ...KHUNG_NEN, code }).success, code).toBe(
        false,
      );
    }
    expect(taoKhungSchema.safeParse(KHUNG_NEN).success).toBe(true);
  });
});

// ── 2. Sửa khung ───────────────────────────────────────────────────────────

describe("sửa khung còn NHÁP", () => {
  const sua = (input: Record<string, unknown> = {}) =>
    cauHinhSuaKhung.handler({
      db: dbGia(),
      actor: actorHO,
      input: { rubricId: "k1", ...KHUNG_NEN, ...input },
    } as never);

  it("đổi được thang điểm và ngưỡng", async () => {
    await sua({ totalPoints: 50, passPoints: 40 });
    const arg = b.updateKhung.mock.calls[0]![0] as {
      data: { totalPoints: number; passPoints: number };
    };
    expect(arg.data.totalPoints).toBe(50);
    expect(arg.data.passPoints).toBe(40);
  });

  it("🔴 khung ĐÃ KÍCH HOẠT ⇒ từ chối", async () => {
    b.khung = { ...(b.khung as object), status: "ACTIVE" };
    const e = await batLoi(sua());
    expect(e.code).toBe("KHUNG_DA_KICH_HOAT");
    expect(b.updateKhung).not.toHaveBeenCalled();
  });

  it("giữ NGUYÊN mã thì không đi kiểm trùng", async () => {
    // Kiểm trùng với chính mình sẽ luôn thấy một dòng và chặn nhầm mọi lần sửa.
    h.timTrungMa.mockResolvedValue({ id: "k1" });
    await sua();
    expect(b.updateKhung).toHaveBeenCalledTimes(1);
  });
});

// ── 3. Tiêu chí ────────────────────────────────────────────────────────────

describe("thêm tiêu chí", () => {
  const them = (input: Record<string, unknown> = {}) =>
    cauHinhThemTieuChi.handler({
      db: dbGia(),
      actor: actorHO,
      input: {
        rubricId: "k1",
        label: "Xử lý phản đối",
        levels: MUC(0, 20, 40),
        ...input,
      },
    } as never);

  it("nối vào CUỐI danh sách", async () => {
    await them();
    const arg = b.createTc.mock.calls[0]![0] as { data: { orderIndex: number } };
    expect(arg.data.orderIndex).toBe(2);
  });

  it("khung rỗng ⇒ tiêu chí đầu tiên có `orderIndex` 0", async () => {
    b.cuoi = null;
    await them();
    const arg = b.createTc.mock.calls[0]![0] as { data: { orderIndex: number } };
    expect(arg.data.orderIndex).toBe(0);
  });

  it("`weight` suy từ mức CAO NHẤT, không phải mức cuối mảng", async () => {
    await them({ levels: MUC(40, 10) });
    const arg = b.createTc.mock.calls[0]![0] as { data: { weight: number } };
    expect(arg.data.weight).toBe(40);
  });

  it("🔴 khung ĐÃ KÍCH HOẠT ⇒ từ chối", async () => {
    b.khung = { ...(b.khung as object), status: "ACTIVE" };
    const e = await batLoi(them());
    expect(e.code).toBe("KHUNG_DA_KICH_HOAT");
    expect(b.createTc).not.toHaveBeenCalled();
  });

  it("🔴 luật MỨC nằm ở SCHEMA của action, không phải ở màn hình", async () => {
    // Gọi thẳng `handler` là bỏ qua tầng Zod của `defineAction`, nên phải kiểm
    // chính `schema` — nếu không thì test này xanh trong khi đường chạy thật không
    // chặn gì, đúng kiểu "luật viết ra mà không ai thi hành".
    const xau = {
      rubricId: "k1",
      label: "Xử lý phản đối",
      levels: MUC(0, 40, 20),
    };
    expect(cauHinhThemTieuChi.schema.safeParse(xau).success).toBe(false);
    expect(
      cauHinhThemTieuChi.schema.safeParse({ ...xau, levels: MUC(0, 20, 40) })
        .success,
    ).toBe(true);
    // Và một tiêu chí MỘT mức cũng không lọt: nó là điểm cộng vô điều kiện.
    expect(
      cauHinhThemTieuChi.schema.safeParse({ ...xau, levels: MUC(10) }).success,
    ).toBe(false);
  });
});

describe("sửa và xoá tiêu chí", () => {
  it("🔴 cổng cách ly nằm ở bảng CHA, không ở tiêu chí", async () => {
    // `TrnRubricCriterion` KHÔNG mang cột đơn vị (đúng thiết kế), nên `scopedDb`
    // không lọc gì trên nó. Khung không đọc được ⇒ phải NOT_FOUND, không được sửa.
    b.khung = null;
    const e = await batLoi(
      cauHinhSuaTieuChi.handler({
        db: dbGia(),
        actor: actorHO,
        input: { criterionId: "tc1", label: "Đổi tên", levels: MUC(0, 10) },
      } as never),
    );
    expect(e.code).toBe("NOT_FOUND");
    expect(b.updateTc).not.toHaveBeenCalled();
  });

  it("xoá được khi còn nháp", async () => {
    await cauHinhXoaTieuChi.handler({
      db: dbGia(),
      actor: actorHO,
      input: { criterionId: "tc1" },
    } as never);
    expect(b.delTc).toHaveBeenCalledTimes(1);
  });

  it("🔴 khung đã kích hoạt ⇒ KHÔNG xoá được tiêu chí", async () => {
    // `TrnRubricScore` trỏ `criterionId`: xoá một tiêu chí là cắt đường về của
    // những điểm đã chấm.
    b.khung = { ...(b.khung as object), status: "ACTIVE" };
    const e = await batLoi(
      cauHinhXoaTieuChi.handler({
        db: dbGia(),
        actor: actorHO,
        input: { criterionId: "tc1" },
      } as never),
    );
    expect(e.code).toBe("KHUNG_DA_KICH_HOAT");
    expect(b.delTc).not.toHaveBeenCalled();
  });
});

describe("sắp xếp tiêu chí", () => {
  const xep = (thuTu: string[]) =>
    cauHinhSapXepTieuChi.handler({
      db: dbGia(),
      actor: actorHO,
      input: { rubricId: "k1", thuTu },
    } as never);

  it("ghi HAI PHA — pha âm trước, pha thật sau", async () => {
    // `@@unique([rubricId, orderIndex])` đụng nhau nếu ghi thẳng số mới đè số cũ.
    await xep(["tc2", "tc1"]);
    const thuTuGhi = b.updateTc.mock.calls.map(
      (c) => (c[0] as { data: { orderIndex: number } }).data.orderIndex,
    );
    expect(thuTuGhi).toEqual([-1, -2, 0, 1]);
  });

  it("🔴 danh sách THIẾU một id ⇒ từ chối", async () => {
    // Thiếu thì tiêu chí đó giữ `orderIndex` cũ và chen vào giữa các số mới — thứ
    // tự trên màn hình khác thứ tự trong DB, và không gì báo.
    const e = await batLoi(xep(["tc1"]));
    expect(e.code).toBe("THU_TU_KHONG_KHOP");
    expect(b.updateTc).not.toHaveBeenCalled();
  });

  it("🔴 danh sách có id LẠ ⇒ từ chối", async () => {
    const e = await batLoi(xep(["tc1", "tc-la"]));
    expect(e.code).toBe("THU_TU_KHONG_KHOP");
  });

  it("🔴 danh sách có id TRÙNG ⇒ từ chối", async () => {
    const e = await batLoi(xep(["tc1", "tc1"]));
    expect(e.code).toBe("THU_TU_KHONG_KHOP");
  });
});

// ── 3b. Khung DÙNG CHUNG toàn công ty ──────────────────────────────────────

describe("🔴 khung TOÀN CÔNG TY: đọc được KHÔNG có nghĩa là ghi được", () => {
  // `TrnRubric` ∈ `NULL_IS_GLOBAL_MODELS` nên `scopedDb` CỐ Ý cho mọi cơ sở đọc
  // khung `centerId = null` — kho chung không được tàng hình. Nhưng `scopedDb`
  // không che đường ghi, nên mượn lượt đọc đó làm cổng ghi là để người cấp cơ sở
  // sửa thước đo của cả công ty. Đã dựng lại được trên Postgres thật với đề thi.
  const actorCS1 = {
    userId: "u-cs1",
    isSuperAdmin: false,
    isHoLevel: false,
    visibleCenterIds: ["cs1"],
    permissions: [quyen("elearning:content:author", ["cs1"])],
    grantsAllow: new Set<string>(),
  } as never;

  beforeEach(() => {
    b.khung = { ...(b.khung as object), centerId: null };
  });

  const goi = (fn: () => Promise<unknown>) => batLoi(fn());

  it("người cấp cơ sở KHÔNG sửa được thông số", async () => {
    const e = await goi(() =>
      cauHinhSuaKhung.handler({
        db: dbGia(),
        actor: actorCS1,
        input: { rubricId: "k1", ...KHUNG_NEN },
      } as never),
    );
    expect(e.code).toBe("BAN_GHI_DUNG_CHUNG");
    expect(b.updateKhung).not.toHaveBeenCalled();
  });

  it("KHÔNG thêm được tiêu chí", async () => {
    const e = await goi(() =>
      cauHinhThemTieuChi.handler({
        db: dbGia(),
        actor: actorCS1,
        input: { rubricId: "k1", label: "Chen vao", levels: MUC(0, 10) },
      } as never),
    );
    expect(e.code).toBe("BAN_GHI_DUNG_CHUNG");
    expect(b.createTc).not.toHaveBeenCalled();
  });

  it("KHÔNG xoá được tiêu chí", async () => {
    const e = await goi(() =>
      cauHinhXoaTieuChi.handler({
        db: dbGia(),
        actor: actorCS1,
        input: { criterionId: "tc1" },
      } as never),
    );
    expect(e.code).toBe("BAN_GHI_DUNG_CHUNG");
    expect(b.delTc).not.toHaveBeenCalled();
  });

  it("KHÔNG sắp xếp lại được", async () => {
    const e = await goi(() =>
      cauHinhSapXepTieuChi.handler({
        db: dbGia(),
        actor: actorCS1,
        input: { rubricId: "k1", thuTu: ["tc2", "tc1"] },
      } as never),
    );
    expect(e.code).toBe("BAN_GHI_DUNG_CHUNG");
    expect(b.updateTc).not.toHaveBeenCalled();
  });

  it("🔴 và KHÔNG kích hoạt được — kích hoạt là ĐÓNG BĂNG, không đảo lại được", async () => {
    // Đây là lượt ghi nguy hiểm nhất: sau nó không đường nào trong ứng dụng đưa
    // khung về `DRAFT`, nên một lượt kích hoạt nhầm trên khung dùng chung chỉ gỡ
    // được bằng tay trên DB — trong khi mọi cơ sở đã chấm bằng nó.
    const e = await goi(() =>
      cauHinhKichHoatKhung.handler({
        db: dbGia(),
        actor: {
          ...(actorCS1 as object),
          permissions: [
            quyen("elearning:content:publish", ["cs1"]),
          ],
        } as never,
        input: { rubricId: "k1" },
      } as never),
    );
    expect(e.code).toBe("BAN_GHI_DUNG_CHUNG");
    expect(b.updateKhung).not.toHaveBeenCalled();
  });

  it("người có quyền phạm vi ALL thì VẪN sửa được — đừng chặn nhầm Hội sở", async () => {
    // Chặn quá tay ở đây làm chính người dựng khung chung không sửa nổi nó, và cả
    // module đứng lại.
    await cauHinhSuaKhung.handler({
      db: dbGia(),
      actor: {
        ...(actorCS1 as object),
        permissions: [quyen("elearning:content:author", "ALL")],
      } as never,
      input: { rubricId: "k1", ...KHUNG_NEN },
    } as never);
    expect(b.updateKhung).toHaveBeenCalledTimes(1);
  });

  it("khung CÓ cơ sở thì không chặn gì thêm", async () => {
    b.khung = { ...(b.khung as object), centerId: "cs1" };
    await cauHinhSuaKhung.handler({
      db: dbGia(),
      actor: actorCS1,
      input: { rubricId: "k1", ...KHUNG_NEN },
    } as never);
    expect(b.updateKhung).toHaveBeenCalledTimes(1);
  });
});

// ── 4. Kích hoạt ───────────────────────────────────────────────────────────

describe("kích hoạt khung", () => {
  const bat = () =>
    cauHinhKichHoatKhung.handler({
      db: dbGia(),
      actor: actorHO,
      input: { rubricId: "k1" },
    } as never);

  it("khung hợp lệ ⇒ chuyển ACTIVE", async () => {
    const r = (await bat()) as { data: { soTieuChi: number; totalPoints: number } };
    expect(r.data.soTieuChi).toBe(2);
    const arg = b.updateKhung.mock.calls[0]![0] as { data: { status: string } };
    expect(arg.data.status).toBe("ACTIVE");
  });

  it("🔴 tổng điểm tiêu chí LỆCH thang ⇒ từ chối", async () => {
    b.dsTieuChi = [{ id: "tc1", levelsJson: MUC(0, 30) }];
    const e = await batLoi(bat());
    expect(e.code).toBe("TONG_DIEM_LECH");
    expect(b.updateKhung).not.toHaveBeenCalled();
  });

  it("🔴 khung RỖNG ⇒ từ chối", async () => {
    b.dsTieuChi = [];
    const e = await batLoi(bat());
    expect(e.code).toBe("KHONG_CO_TIEU_CHI");
  });

  it("🔴 `levelsJson` HỎNG khuôn ⇒ chặn tại cổng, gọi tên số tiêu chí", async () => {
    // Cùng bài học với câu thi hỏng nội dung ở EL-14e: một tiêu chí mà màn chấm
    // không dựng nổi ô nhập sẽ để bài nộp treo lại, và sau khi kích hoạt thì bộ
    // tiêu chí đóng băng — hết đường sửa.
    b.dsTieuChi = [
      { id: "tc1", levelsJson: MUC(0, 30, 60) },
      { id: "tc2", levelsJson: { rac: true } },
    ];
    const e = await batLoi(bat());
    expect(e.code).toBe("TIEU_CHI_HONG");
    expect(e.message).toContain("2");
    expect(b.updateKhung).not.toHaveBeenCalled();
  });

  it("🔴 nhiều lỗi ⇒ nói HẾT trong một lượt", async () => {
    // Bấm kích hoạt ba lần để lộ ra ba lỗi là cách chắc chắn khiến người soạn bỏ dở.
    b.khung = { ...(b.khung as object), totalPoints: 120, passPoints: 200 };
    const e = await batLoi(bat());
    expect(e.message).toContain("100");
    expect(e.message).toContain("200");
  });

  it("khung đã ACTIVE ⇒ từ chối, không bật hai lần", async () => {
    b.khung = { ...(b.khung as object), status: "ACTIVE" };
    const e = await batLoi(bat());
    expect(e.code).toBe("KHUNG_DA_KICH_HOAT");
  });

  it("dùng quyền XUẤT BẢN, không phải quyền soạn", () => {
    expect(cauHinhKichHoatKhung.permission).toBe("elearning:content:publish");
    expect(cauHinhTaoKhung.permission).toBe("elearning:content:author");
  });

  it("🔴 KHÔNG đẻ khoá quyền thứ 18", () => {
    // Module chốt đúng 17 khoá. Một khoá mới phải qua `seed-prod-roles.yml` và
    // ma trận vai — đẻ thêm ở đây là dựng một quyền không ai được cấp.
    for (const c of [
      cauHinhTaoKhung,
      cauHinhSuaKhung,
      cauHinhThemTieuChi,
      cauHinhSuaTieuChi,
      cauHinhXoaTieuChi,
      cauHinhSapXepTieuChi,
      cauHinhKichHoatKhung,
    ]) {
      expect(
        ["elearning:content:author", "elearning:content:publish"],
        c.name,
      ).toContain(c.permission);
    }
  });
});
