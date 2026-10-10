/**
 * `luuLoaiDuocDayAction` — đường ghi DUY NHẤT của danh sách loại thông báo được đẩy.
 *
 * ── VÌ SAO BỘ NÀY TỒN TẠI ────────────────────────────────────────────────────────────────
 * Phép đối chiếu "khoá này có thật trong danh mục không" vốn nằm ở schema Zod trong
 * `lib/settings/registry.ts` — đúng chỗ theo thiết kế của repo ("schema là source-of-truth
 * validate"). Nhưng nó cần `import catalogPrefixes`, và `lint:boundaries` bắt được **11 vòng
 * import**:
 *
 *     registry → notifications/catalog → notifications/pending-sync → pending-tasks
 *     → settings/service · auth/actor · auth/permission-eval → … → registry
 *
 * `pending-sync` chỉ `import type` từ `pending-tasks` nên vòng ấy không tồn tại lúc chạy,
 * nhưng luật `no-circular` của repo không loại trừ import kiểu. Nới luật chung để hợp thức
 * hoá một tính năng là đổi rào cho cả repo — nên phép kiểm dời xuống đây.
 *
 * Dời xuống thì nó KHÔNG còn được schema bảo vệ nữa, và đây là bộ test thay chỗ đó.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { id: "u_admin", name: "Quản trị", email: "a@b.vn" } })),
  resolveActor: vi.fn(async (_id: string) => ({ userId: "u_admin", isSuperAdmin: true })),
  setGlobalSetting: vi.fn(async (_a: unknown, _p: { key: string; value: unknown; reason: string }) => ({
    ok: true as const,
  })),
  setCenterSetting: vi.fn(async () => ({ ok: true as const })),
  revalidatePath: vi.fn(),
  // ── Dùng cho `luuGvMienTruAction` ──────────────────────────────────────────────────────
  // Khai KIỂU THAM SỐ chứ không để `vi.fn()` trần: không có nó thì `mock.calls[0]` mang tuple
  // rỗng và mọi phép khẳng định về đối số phải ép kiểu — tức tự bịt mắt đúng chỗ cần nhìn.
  checkPermission: vi.fn(async (_action: string) => true),
  getAssignableTeachers: vi.fn(
    async (_opts?: { includeIds?: (string | null | undefined)[] }) =>
      [] as { id: string; name: string | null; role: string; centerId: string | null }[],
  ),
}));

vi.mock("next/cache", () => ({
  // 16/09/2026 — bản `main` của `actions.ts` dùng `unstable_cache`; mock thiếu nó là
  // cả tệp test chết ngay lúc nạp, không phải một ca đỏ.
  unstable_cache: <T,>(fn: T) => fn, revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/settings/service", () => ({
  setGlobalSetting: h.setGlobalSetting,
  setCenterSetting: h.setCenterSetting,
}));
// Mock CẢ HAI module này là bắt buộc, không phải cho gọn: `@/lib/teachers/assignable` import
// `@/lib/db` ở dòng đầu, nên không mock là bộ test kéo Prisma vào và cần một Postgres thật —
// đúng thứ `pnpm test:unit` cấm (xem `.claude/rules/prisma-db.md`).
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/teachers/assignable", () => ({ getAssignableTeachers: h.getAssignableTeachers }));

import { luuGvMienTruAction, luuLoaiDuocDayAction } from "./actions";

/** Giá trị `value` của lần ghi gần nhất. */
function daGhi(): string[] {
  const c = h.setGlobalSetting.mock.calls.at(-1)?.[1];
  if (!c) throw new Error("setGlobalSetting chưa được gọi lần nào");
  return c.value as string[];
}

/** Danh sách giáo viên "thật" mà `getAssignableTeachers` trả về trong bộ này. */
const GIAO_VIEN = [
  { id: "u_kiet", name: "Kiệt", role: "TEACHER", centerId: "c1" },
  { id: "u_toai", name: "Toại", role: "TEACHER", centerId: "c2" },
  { id: "u_lan", name: "Lan", role: "TEACHER", centerId: "c1" },
];

/**
 * ⚠️ Luật 18 — mỗi ca phải XANH khi chạy MỘT MÌNH.
 *
 * Mọi mock được đặt lại ĐẦY ĐỦ ở đây, kể cả những cái mà ca trước không đụng tới: `vi.fn(impl)`
 * giữ nguyên implementation qua `clearAllMocks`, nên một ca gọi `mockResolvedValue` để dựng
 * hoàn cảnh riêng (không đủ quyền, chưa đăng nhập) sẽ để lại hoàn cảnh đó cho ca sau và bộ chỉ
 * xanh nhờ thứ tự chạy hiện tại.
 */
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u_admin", name: "Quản trị", email: "a@b.vn" } });
  h.setGlobalSetting.mockResolvedValue({ ok: true });
  h.checkPermission.mockResolvedValue(true);
  h.getAssignableTeachers.mockResolvedValue(GIAO_VIEN);
});

describe("[PUSH-D7-T30] đối chiếu danh mục — cổng đã dời từ registry xuống đây", () => {
  it("khoá CÓ THẬT ⇒ ghi xuống", async () => {
    const kq = await luuLoaiDuocDayAction({ tienTo: ["lead.moi:", "sla:"], reason: "BGĐ duyệt" });
    expect(kq.ok).toBe(true);
    expect(daGhi()).toEqual(["lead.moi:", "sla:"]);
  });

  it("⚠️ khoá KHÔNG có trong danh mục ⇒ TỪ CHỐI, và KHÔNG ghi gì", async () => {
    // Đây là ca mà schema Zod từng gác. Mất nó thì một khoá gõ sai nằm im trong DB: danh sách
    // trông như đã bật mà `startsWith` không khớp gì — không lỗi, không cảnh báo, và cách duy
    // nhất phát hiện là có người báo "tôi không nhận được thông báo".
    const kq = await luuLoaiDuocDayAction({ tienTo: ["khong_ton_tai:"], reason: "x" });
    expect(kq.ok).toBe(false);
    expect(h.setGlobalSetting).not.toHaveBeenCalled();
  });

  it("TỪ CHỐI chứ không lặng lẽ lọc bỏ", async () => {
    // Lọc bỏ thì người dùng bấm Lưu, thấy báo thành công, rồi loại họ vừa chọn biến mất không
    // dấu vết. Một khoá lạ tới được đây nghĩa là giao diện và danh mục đã lệch nhau — thứ phải
    // nổ ra, không phải thứ để dọn dẹp im lặng.
    const kq = await luuLoaiDuocDayAction({ tienTo: ["lead.moi:", "bia_ra:"], reason: "x" });
    expect(kq.ok).toBe(false);
    expect(h.setGlobalSetting).not.toHaveBeenCalled();
  });

  it("⚠️ TỪ CHỐI loại KHÔNG ĐẨY ĐƯỢC, dù nó có thật trong danh mục chuông", async () => {
    // `class_no_teacher:` và `timesheet_adjust:` là thông báo CÓ THẬT — chúng hiện trong chuông
    // hằng ngày. Nhưng chúng do vòng quét việc tồn ghi thẳng `db.staffNotification.upsert`,
    // không đi qua `notifyStaff`, nên KHÔNG BAO GIỜ đẩy được (ranh giới cố ý, xem
    // `lib/notifications/notify.ts`).
    //
    // Lưu chúng vào cấu hình đẩy là để lại một công tắc không nối vào đâu — chủ dự án đã bật
    // thật cả hai ngày 13/09 rồi ngồi chờ. Đường ghi phải kiểm theo danh sách HẸP.
    for (const t of ["class_no_teacher:", "timesheet_adjust:", "renewal:", "student_risk:"]) {
      const kq = await luuLoaiDuocDayAction({ tienTo: ["lead.moi:", t], reason: "x" });
      expect(kq.ok, t).toBe(false);
    }
    expect(h.setGlobalSetting).not.toHaveBeenCalled();
  });

  it("thông báo lỗi NÓI RÕ mã nào sai", async () => {
    const kq = await luuLoaiDuocDayAction({ tienTo: ["bia_ra:"], reason: "x" });
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.error.message).toContain("bia_ra:");
  });
});

describe("[PUSH-D7-T31] chuẩn hoá trước khi ghi", () => {
  it("bỏ trùng và chuỗi rỗng", async () => {
    // Chuỗi rỗng khớp MỌI khoá (`"x".startsWith("")` luôn đúng) — lọt vào là biến danh sách
    // trắng thành "đẩy tất cả 51 loại".
    await luuLoaiDuocDayAction({ tienTo: ["lead.moi:", "lead.moi:", ""], reason: "x" });
    expect(daGhi()).toEqual(["lead.moi:"]);
  });

  it("thứ tự ỔN ĐỊNH, không chạy theo thứ tự người dùng bấm", async () => {
    // Giá trị này nằm trong `oldValues`/`newValues` của nhật ký kiểm toán. Thứ tự chạy theo
    // thao tác thì hai lần lưu CÙNG một lựa chọn vẫn ra hai JSON khác nhau, và người đọc nhật
    // ký sẽ đi tìm một thay đổi không tồn tại.
    await luuLoaiDuocDayAction({ tienTo: ["sla:", "lead.moi:"], reason: "x" });
    const lan1 = daGhi();
    vi.clearAllMocks();
    h.setGlobalSetting.mockResolvedValue({ ok: true });
    await luuLoaiDuocDayAction({ tienTo: ["lead.moi:", "sla:"], reason: "x" });
    expect(daGhi()).toEqual(lan1);
  });

  it("danh sách RỖNG là lựa chọn hợp lệ — 'tắt hết'", async () => {
    const kq = await luuLoaiDuocDayAction({ tienTo: [], reason: "tạm dừng kênh" });
    expect(kq.ok).toBe(true);
    expect(daGhi()).toEqual([]);
  });
});

describe("[PUSH-D7-T32] cổng quyền nằm ở tầng dưới, không lặp lại ở đây", () => {
  it("chưa đăng nhập ⇒ từ chối trước khi chạm gì", async () => {
    h.auth.mockResolvedValue(null as never);
    const kq = await luuLoaiDuocDayAction({ tienTo: ["lead.moi:"], reason: "x" });
    expect(kq.ok).toBe(false);
    expect(h.setGlobalSetting).not.toHaveBeenCalled();
  });

  it("quyền SUPER_ADMIN do `setGlobalSetting` gác — action chỉ chuyển tiếp lý do", async () => {
    // Lặp lại cổng quyền ở đây là tạo hai nguồn sự thật cho cùng một câu hỏi, và nguồn ở tầng
    // dưới mới là nguồn thật.
    h.setGlobalSetting.mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "Chỉ SUPER_ADMIN được sửa cấu hình toàn hệ thống" },
    } as never);
    const kq = await luuLoaiDuocDayAction({ tienTo: ["lead.moi:"], reason: "x" });
    expect(kq.ok).toBe(false);
    expect(h.setGlobalSetting.mock.calls[0]![1].reason).toBe("x");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// `luuGvMienTruAction` — đường ghi DUY NHẤT của danh sách giáo viên LUÔN HIỆN khi xếp buổi
// học thử (`trial.gvMienLocTheoCa`).
//
// Cùng lý do tồn tại như bộ ở trên: phép đối chiếu "mã này có phải giáo viên không" KHÔNG đặt
// được ở schema Zod trong registry (registry là tầng thấp nhất, kéo `lib/teachers/assignable`
// → `lib/db` vào đó là đẻ vòng import mà `lint:boundaries` chặn cứng). Dời xuống action thì nó
// mất lớp bảo vệ của schema — và đây là bộ test thay chỗ đó.
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Giá trị `value` của lần ghi gần nhất, ép kiểu về danh sách mã người dùng. */
function daGhiGv(): string[] {
  const c = h.setGlobalSetting.mock.calls.at(-1)?.[1];
  if (!c) throw new Error("setGlobalSetting chưa được gọi lần nào");
  return c.value as string[];
}

describe("[TRIAL-GV-T10] đối chiếu với danh sách giáo viên THẬT", () => {
  it("mã CÓ THẬT ⇒ ghi xuống đúng khoá", async () => {
    const kq = await luuGvMienTruAction({ userIds: ["u_kiet", "u_toai"], reason: "BGĐ duyệt" });
    expect(kq.ok).toBe(true);
    expect(h.setGlobalSetting.mock.calls[0]![1].key).toBe("trial.gvMienLocTheoCa");
    expect(daGhiGv()).toEqual(["u_kiet", "u_toai"]);
  });

  it("⚠️ mã KHÔNG phải giáo viên ⇒ TỪ CHỐI, và KHÔNG ghi gì", async () => {
    // Lọc bỏ im lặng thì người dùng bấm Lưu, thấy báo thành công, rồi người họ vừa chọn biến
    // mất không dấu vết. Một mã lạ tới được đây nghĩa là giao diện và dữ liệu đã lệch nhau —
    // thứ phải nổ ra, không phải thứ để dọn dẹp im lặng.
    const kq = await luuGvMienTruAction({ userIds: ["u_nguoi_la"], reason: "x" });
    expect(kq.ok).toBe(false);
    expect(h.setGlobalSetting).not.toHaveBeenCalled();
  });

  it("một mã lạ lẫn giữa các mã thật vẫn chặn CẢ lần lưu", async () => {
    const kq = await luuGvMienTruAction({ userIds: ["u_kiet", "u_nguoi_la"], reason: "x" });
    expect(kq.ok).toBe(false);
    expect(h.setGlobalSetting).not.toHaveBeenCalled();
  });

  it("thông báo lỗi NÓI RÕ mã nào sai", async () => {
    const kq = await luuGvMienTruAction({ userIds: ["u_nguoi_la"], reason: "x" });
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.error.message).toContain("u_nguoi_la");
  });

  it("KHÔNG lọc theo cơ sở của người đang xem — cấu hình này là toàn hệ thống", async () => {
    // Truyền `centerIds` thì hai quản trị viên mở cùng màn sẽ thấy hai danh sách khác nhau cho
    // cùng một giá trị, và người ở cơ sở 1 lưu là xoá mất lựa chọn của cơ sở 2.
    await luuGvMienTruAction({ userIds: ["u_toai"], reason: "x" });
    expect(h.getAssignableTeachers.mock.calls[0]![0]).toEqual({});
  });
});

describe("[TRIAL-GV-T11] chuẩn hoá trước khi ghi", () => {
  it("bỏ trùng — công tắc không sinh ra được hai lần cùng một người", async () => {
    const kq = await luuGvMienTruAction({ userIds: ["u_kiet", "u_kiet"], reason: "x" });
    expect(kq.ok).toBe(true);
    expect(daGhiGv()).toEqual(["u_kiet"]);
  });

  it("thứ tự ỔN ĐỊNH, không chạy theo thứ tự người dùng bấm", async () => {
    // Giá trị này nằm trong `oldValues`/`newValues` của nhật ký kiểm toán. Thứ tự chạy theo
    // thao tác thì hai lần lưu CÙNG một lựa chọn vẫn ra hai JSON khác nhau, và người đọc nhật
    // ký sẽ đi tìm một thay đổi không tồn tại.
    await luuGvMienTruAction({ userIds: ["u_toai", "u_kiet", "u_lan"], reason: "x" });
    const lan1 = daGhiGv();
    vi.clearAllMocks();
    h.auth.mockResolvedValue({ user: { id: "u_admin", name: "Quản trị", email: "a@b.vn" } });
    h.setGlobalSetting.mockResolvedValue({ ok: true });
    h.checkPermission.mockResolvedValue(true);
    h.getAssignableTeachers.mockResolvedValue(GIAO_VIEN);
    await luuGvMienTruAction({ userIds: ["u_lan", "u_toai", "u_kiet"], reason: "x" });
    expect(daGhiGv()).toEqual(lan1);
  });

  it("danh sách RỖNG là lựa chọn hợp lệ — 'không ai được miễn'", async () => {
    const kq = await luuGvMienTruAction({ userIds: [], reason: "bỏ hết ngoại lệ" });
    expect(kq.ok).toBe(true);
    expect(daGhiGv()).toEqual([]);
  });

  it("dòng TRỐNG bị báo đúng lý do của nó, không phải 'không có giáo viên nào mang mã '", async () => {
    // Nếu để dòng trống rơi xuống phép đối chiếu bên dưới thì câu báo lỗi là một câu cụt,
    // kết thúc bằng khoảng trắng, và người đọc không biết phải sửa gì.
    const kq = await luuGvMienTruAction({ userIds: ["u_kiet", "   "], reason: "x" });
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.error.message).toContain("trống");
    expect(h.setGlobalSetting).not.toHaveBeenCalled();
  });

  it("quá 50 người ⇒ TỪ CHỐI, khớp trần khai trong registry", async () => {
    const nhieu = Array.from({ length: 51 }, (_, i) => `u_${i}`);
    const kq = await luuGvMienTruAction({ userIds: nhieu, reason: "x" });
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.error.message).toContain("50");
    // Chặn TRƯỚC khi hỏi DB: 51 mã lạ không đáng một truy vấn.
    expect(h.getAssignableTeachers).not.toHaveBeenCalled();
  });
});

describe("[TRIAL-GV-T12] lý do bắt buộc + cổng quyền", () => {
  it("thiếu lý do ⇒ TỪ CHỐI, không ghi gì", async () => {
    for (const reason of ["", "   "]) {
      const kq = await luuGvMienTruAction({ userIds: ["u_kiet"], reason });
      expect(kq.ok, JSON.stringify(reason)).toBe(false);
    }
    expect(h.setGlobalSetting).not.toHaveBeenCalled();
  });

  it("lý do được chuyển nguyên xuống tầng ghi (nhật ký kiểm toán đọc nó)", async () => {
    await luuGvMienTruAction({ userIds: ["u_kiet"], reason: "Kiệt phụ trách đào tạo" });
    expect(h.setGlobalSetting.mock.calls[0]![1].reason).toBe("Kiệt phụ trách đào tạo");
  });

  it("chưa đăng nhập ⇒ từ chối trước khi chạm gì", async () => {
    h.auth.mockResolvedValue(null as never);
    const kq = await luuGvMienTruAction({ userIds: ["u_kiet"], reason: "x" });
    expect(kq.ok).toBe(false);
    expect(h.checkPermission).not.toHaveBeenCalled();
    expect(h.setGlobalSetting).not.toHaveBeenCalled();
  });

  it("⚠️ không đủ quyền ⇒ chặn TRƯỚC khi hỏi DB, không chỉ trước khi ghi", async () => {
    // Đây là lý do action này có cổng quyền riêng trong khi `luuLoaiDuocDayAction` thì không:
    // nó đi hỏi DB bằng chính mã người dùng gửi lên, rồi trả lời "mã này không phải giáo
    // viên". Gác sau thì bất kỳ ai đăng nhập cũng dò được danh sách người qua thông báo lỗi,
    // và mỗi lần dò là một truy vấn.
    h.checkPermission.mockResolvedValue(false);
    const kq = await luuGvMienTruAction({ userIds: ["u_kiet"], reason: "x" });
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.error.code).toBe("FORBIDDEN");
    expect(h.getAssignableTeachers).not.toHaveBeenCalled();
    expect(h.setGlobalSetting).not.toHaveBeenCalled();
  });

  it("quyền hỏi bằng đúng khoá `settings:edit`, không so vai tại chỗ", async () => {
    await luuGvMienTruAction({ userIds: ["u_kiet"], reason: "x" });
    expect(h.checkPermission).toHaveBeenCalledWith("settings:edit");
  });

  it("cổng ở tầng dưới VẪN nguyên — lỗi của nó được chuyển thẳng ra", async () => {
    // Lớp thứ hai không phải bản sao của luật: `setGlobalSetting` vẫn kiểm `isSuperAdmin`, và
    // câu trả lời của nó là thứ người dùng nhìn thấy.
    h.setGlobalSetting.mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "Chỉ SUPER_ADMIN được sửa cấu hình toàn hệ thống" },
    } as never);
    const kq = await luuGvMienTruAction({ userIds: ["u_kiet"], reason: "x" });
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.error.message).toContain("SUPER_ADMIN");
  });
});
