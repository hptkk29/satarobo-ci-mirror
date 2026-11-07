// Thu hồi đăng ký push phía server khi phiên kết thúc. Không chạm Postgres — `@/lib/db` mock.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const updateMany = vi.fn(
    async (_a: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({ count: 0 }),
  );
  const userFindUnique = vi.fn(
    async (_a: unknown) => null as { isActive: boolean; deletedAt: Date | null } | null,
  );
  return {
    updateMany,
    userFindUnique,
    mockDb: {
      webPushSubscription: { updateMany },
      user: { findUnique: userFindUnique },
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));

import {
  CHO_SIGNOUT_MS,
  thuHoiKhiAuthSignOut,
  thuHoiMoiThietBiCuaNguoi,
  thuHoiNeuTaiKhoanChet,
} from "./thu-hoi";

const NOW = new Date("2026-09-13T03:00:00.000Z");

/** Tham số của lần `updateMany` gần nhất. */
function goi(): { where: Record<string, unknown>; data: Record<string, unknown> } {
  const c = h.updateMany.mock.calls.at(-1)?.[0];
  if (!c) throw new Error("updateMany chưa được gọi lần nào");
  return c;
}

beforeEach(() => {
  h.updateMany.mockReset().mockResolvedValue({ count: 2 });
  h.userFindUnique.mockReset().mockResolvedValue({ isActive: true, deletedAt: null });
});

describe("[PUSH-D5-T01] thu hồi MỌI thiết bị của một người", () => {
  it("lọc đúng người + chỉ dòng ACTIVE, ghi mốc và lý do", async () => {
    const n = await thuHoiMoiThietBiCuaNguoi({
      userId: "usr_a",
      lyDo: "bi-vo-hieu-hoa",
      now: NOW,
    });
    expect(n).toBe(2);
    expect(goi().where).toEqual({ userId: "usr_a", status: "ACTIVE" });
    expect(goi().data).toMatchObject({ status: "REVOKED", revokedAt: NOW });
    expect(String(goi().data.revokedReason)).toContain("vô hiệu hoá");
  });

  it("chỉ chạm dòng ACTIVE — mốc và lý do của lần thu hồi TRƯỚC là bằng chứng", async () => {
    // Ghi lại lên dòng đã chốt là xoá mất `revokedAt` thật của lần trước; sổ vận hành mất khả
    // năng trả lời "thiết bị này chết lúc nào, vì sao". Bất biến này cũng được `_push-actions.ts`
    // tôn trọng ở nhánh chuyển chủ (nó cũng lọc `status: "ACTIVE"`) — hai mảnh của cùng một đợt
    // phải nói cùng một điều.
    await thuHoiMoiThietBiCuaNguoi({ userId: "usr_a", lyDo: "da-xoa", now: NOW });
    expect(goi().where.status).toBe("ACTIVE");
    expect(goi().data).not.toHaveProperty("userId");
  });

  it("hai lý do ghi hai câu KHÁC nhau — người trực đọc sổ phải phân biệt được", async () => {
    const cau = new Set<string>();
    for (const l of ["da-xoa", "bi-vo-hieu-hoa"] as const) {
      await thuHoiMoiThietBiCuaNguoi({ userId: "usr_a", lyDo: l, now: NOW });
      cau.add(String(goi().data.revokedReason));
    }
    expect(cau.size).toBe(2);
  });

  it("userId rỗng ⇒ KHÔNG gọi DB (một câu thiếu vế where là thu hồi cả bảng)", async () => {
    expect(await thuHoiMoiThietBiCuaNguoi({ userId: "", lyDo: "bi-vo-hieu-hoa" })).toBe(0);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("bảng chưa tồn tại (migration chưa chạy) ⇒ nuốt lỗi, trả 0, KHÔNG ném", async () => {
    // Hàm này nằm trên đường ĐĂNG XUẤT — mà route `/dang-xuat` tồn tại chính để cứu người khỏi
    // vòng lặp ERR_TOO_MANY_REDIRECTS. Một lỗi lọt ra ngoài sẽ giam họ lại trong đúng vòng lặp
    // đó. Và ca này đang chờ sẵn: migration hai bảng push CHƯA chạy ở môi trường nào.
    h.updateMany.mockRejectedValue(
      Object.assign(new Error("The table `public.WebPushSubscription` does not exist"), {
        code: "P2021",
      }),
    );
    await expect(
      thuHoiMoiThietBiCuaNguoi({ userId: "usr_a", lyDo: "bi-vo-hieu-hoa" }),
    ).resolves.toBe(0);
  });
});

describe("[PUSH-D5-T14] CHỈ thu hồi khi tài khoản THẬT SỰ chết", () => {
  it("tài khoản bị XOÁ (deletedAt) ⇒ thu hồi, lý do 'đã bị xoá'", async () => {
    h.userFindUnique.mockResolvedValue({ isActive: true, deletedAt: NOW });
    const kq = await thuHoiNeuTaiKhoanChet({ userId: "usr_a", now: NOW });
    expect(kq).toEqual({ chet: true, soDong: 2 });
    expect(String(goi().data.revokedReason)).toContain("xoá");
  });

  it("tài khoản bị VÔ HIỆU HOÁ ⇒ thu hồi, lý do 'bị vô hiệu hoá'", async () => {
    h.userFindUnique.mockResolvedValue({ isActive: false, deletedAt: null });
    const kq = await thuHoiNeuTaiKhoanChet({ userId: "usr_a", now: NOW });
    expect(kq.chet).toBe(true);
    expect(String(goi().data.revokedReason)).toContain("vô hiệu hoá");
  });

  it("không tìm thấy bản ghi (xoá cứng) ⇒ coi là chết", async () => {
    h.userFindUnique.mockResolvedValue(null);
    expect((await thuHoiNeuTaiKhoanChet({ userId: "usr_a" })).chet).toBe(true);
  });

  it("⚠️ TÀI KHOẢN CÒN SỐNG ⇒ TUYỆT ĐỐI không thu hồi, dù đang trên đường đăng xuất", async () => {
    // CA QUAN TRỌNG NHẤT CỦA TỆP. Bản trước của Đợt 5 dùng `checkSessionLiveness`, mà hàm đó
    // trả CÙNG nhãn `session-invalidated` cho "tài khoản bị xoá" và cho "`tokenVersion` lệch".
    // Bump `tokenVersion` là thao tác THƯỜNG NGÀY — đo được 9 nơi trong repo: đổi vai, cấp/thu
    // quyền per-user (3 nơi), force logout, tự đặt lại mật khẩu. Hệ quả của bản trước: SUPER_ADMIN
    // cấp thêm một quyền cho một Sale ⇒ lượt tải trang kế bị layout đá qua
    // `/dang-xuat?reason=session-invalidated` ⇒ gỡ sạch push trên MỌI máy của họ, im lặng.
    h.userFindUnique.mockResolvedValue({ isActive: true, deletedAt: null });
    const kq = await thuHoiNeuTaiKhoanChet({ userId: "usr_a" });
    expect(kq).toEqual({ chet: false, soDong: 0 });
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("chỉ đọc hai cột NÓI VỀ SỰ SỐNG — không đọc tokenVersion", async () => {
    // Đọc `tokenVersion` ở đây là mở lại đúng cửa vừa đóng: nó không nói gì về việc tài khoản
    // còn sống hay không.
    await thuHoiNeuTaiKhoanChet({ userId: "usr_a" });
    const w = h.userFindUnique.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      select: Record<string, true>;
    };
    expect(w.where).toEqual({ id: "usr_a" });
    expect(Object.keys(w.select).sort()).toEqual(["deletedAt", "isActive"]);
  });

  it("userId rỗng ⇒ không đọc DB, không thu hồi", async () => {
    expect(await thuHoiNeuTaiKhoanChet({ userId: "" })).toEqual({ chet: false, soDong: 0 });
    expect(h.userFindUnique).not.toHaveBeenCalled();
  });

  it("đọc DB mà NÉM ⇒ KHÔNG thu hồi, KHÔNG ném ra ngoài", async () => {
    // Fail-safe đúng chiều: không đọc được tình trạng thì đừng gỡ gì. Gỡ khi không chắc là
    // biến một sự cố DB thành mất push hàng loạt.
    h.userFindUnique.mockRejectedValue(new Error("pooler chập"));
    await expect(thuHoiNeuTaiKhoanChet({ userId: "usr_a" })).resolves.toEqual({
      chet: false,
      soDong: 0,
    });
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});

describe("[PUSH-D6-T10] lưới THỨ BA: `events.signOut` của Auth.js", () => {
  it("token.id + tài khoản đã chết ⇒ thu hồi đúng người đó", async () => {
    h.userFindUnique.mockResolvedValue({ isActive: false, deletedAt: null });
    await thuHoiKhiAuthSignOut({ token: { id: "usr_a" } });
    expect(h.userFindUnique.mock.calls[0]?.[0]).toMatchObject({ where: { id: "usr_a" } });
    expect(goi().where).toMatchObject({ userId: "usr_a", status: "ACTIVE" });
  });

  it("chỉ có `sub` (mặc định của Auth.js) ⇒ vẫn nhận ra người", async () => {
    h.userFindUnique.mockResolvedValue({ isActive: false, deletedAt: null });
    await thuHoiKhiAuthSignOut({ token: { sub: "usr_b" } });
    expect(goi().where).toMatchObject({ userId: "usr_b" });
  });

  it("có CẢ HAI ⇒ `id` thắng (đúng thứ tự mà `callbacks.session` đang dùng)", async () => {
    // Đọc khác thứ tự là lấy đúng một userId KHÁC: `callbacks.jwt` của repo đặt `token.id`, còn
    // `token.sub` là của Auth.js — hai giá trị có thể lệch nhau sau khi đổi tài khoản.
    h.userFindUnique.mockResolvedValue({ isActive: false, deletedAt: null });
    await thuHoiKhiAuthSignOut({ token: { id: "usr_a", sub: "usr_khac" } });
    expect(goi().where).toMatchObject({ userId: "usr_a" });
  });

  it("⚠️ TÀI KHOẢN CÒN SỐNG ⇒ KHÔNG gỡ gì — event này phát ở MỌI lượt đăng xuất", async () => {
    // CA QUAN TRỌNG NHẤT CỦA KHỐI NÀY. Cắm `thuHoiMoiThietBiCuaNguoi` vào đây là đảo ngược
    // quyết định vận hành đã chốt: đăng xuất ở máy công ty buổi tối thành MẤT push trên điện
    // thoại riêng, im lặng, không màn nào báo. "Gỡ tất cả" chỉ đúng khi tài khoản đã chết.
    h.userFindUnique.mockResolvedValue({ isActive: true, deletedAt: null });
    await thuHoiKhiAuthSignOut({ token: { id: "usr_a" } });
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["token null (phiên không có JWT)", { token: null }],
    ["nhánh `session` của union", { session: { sessionToken: "x" } }],
    ["token không có id lẫn sub", { token: { email: "a@b.c" } }],
    ["id không phải chuỗi", { token: { id: 123, sub: null } }],
    ["undefined", undefined],
    ["chuỗi", "usr_a"],
  ])("%s ⇒ không đọc DB, không thu hồi, không ném", async (_ten, msg) => {
    await expect(thuHoiKhiAuthSignOut(msg)).resolves.toBeUndefined();
    expect(h.userFindUnique).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("đọc `message.token` mà NÉM ⇒ nuốt, không ném ra ngoài", async () => {
    // `@auth/core` có bọc try/catch quanh lời gọi, nhưng không dựa vào điều đó: một thư viện đổi
    // hành vi ở bản sau là giam người dùng trong một phiên không thoát được.
    const acQuy = {
      get token(): unknown {
        throw new Error("message hỏng");
      },
    };
    await expect(thuHoiKhiAuthSignOut(acQuy)).resolves.toBeUndefined();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("DB TREO ⇒ trả về sau đúng trần chờ, KHÔNG treo lọi gọi đăng xuất", async () => {
    // `@auth/core` gọi `await events.signOut?.({ token })` KHÔNG có timeout nào (đã đọc mã ở
    // `lib/actions/signout.js`). Handler chậm là ĐĂNG XUẤT TREO đúng bằng thực thời gian đó, mà hàm
    // này chạm DB hai lượt trên Supabase.
    const noi = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      h.userFindUnique.mockImplementation(() => new Promise(() => {}));
      let xong = false;
      const p = thuHoiKhiAuthSignOut({ token: { id: "usr_a" } }).then(() => {
        xong = true;
      });
      await vi.advanceTimersByTimeAsync(CHO_SIGNOUT_MS - 1);
      expect(xong).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(xong).toBe(true);
      expect(h.updateMany).not.toHaveBeenCalled();
      // ⚠️ VÀ PHẢI NÓI RA. Vế thua của `Promise.race` không bao giờ settle, nên `catch` của hàm
      // KHÔNG chạy và `console.warn` của `thuHoiMoiThietBiCuaNguoi` cũng không chạy — không một
      // dòng nào nói rằng việc thu hồi đã bị BỎ. Lỗ ở đây không phải "chậm" mà là "IM LẬNG":
      // trước bản vá này, ca test cũ thực chất đang PHÊ CHUẨN sự bỏ qua im lặng đó.
      expect(noi).toHaveBeenCalledTimes(1);
      expect(String(noi.mock.calls[0]?.[0])).toContain("BỎ QUA thu hồi");
      expect(String(noi.mock.calls[0]?.[0])).toContain("usr_a");
    } finally {
      vi.useRealTimers();
      noi.mockRestore();
    }
  });

  it("ca THƯỜNG (DB trả kịp) ⇒ không log gì, và KHÔNG để lại timer còn cắm", async () => {
    // `clearTimeout` ở `finally`: nếu không dọn, mỗi lượt đăng xuất để lại một timer 1,5s. Trên
    // serverless gần như vô hại, nhưng nó là một open handle làm khó chẩn đoán một treo THẬT sau
    // này, và nó hiện ra ngay trong bộ test chạy fake timers.
    const noi = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      h.userFindUnique.mockResolvedValue({ isActive: false, deletedAt: null });
      await thuHoiKhiAuthSignOut({ token: { id: "usr_a" } });
      expect(h.updateMany).toHaveBeenCalledTimes(1);
      expect(noi).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      noi.mockRestore();
    }
  });

  it("⚠️ TRẦN CHỜ phải nằm trong khoảng dùng được — ca trên đo BẰNG CHÍNH hằng nó canh", () => {
    // Không có vế này thì đổi `CHO_SIGNOUT_MS` thành `120_000` vẫn xanh, mà mỗi lượt đăng xuất có
    // thể treo hai phút khi pooler chập. Vế dưới chống ai đó hạ về 0 "cho test nhanh" — lúc đó
    // lưới thứ ba không bao giờ kịp làm gì.
    expect(CHO_SIGNOUT_MS).toBeGreaterThanOrEqual(500);
    expect(CHO_SIGNOUT_MS).toBeLessThanOrEqual(2_000);
  });
});


describe("[PUSH-D6-T11] `lib/auth.ts` phải CẮM lưới này, cắm ĐÚNG hàm, và cắm THẬT", () => {
  // Pin ở tầng NGUỒN chứ không tầng hành vi — `lib/auth.ts` KHÔNG import được trong Vitest
  // (`next-auth/lib/env.js` đòi `next/server`; đã đo: "Cannot find module …/next/server"). Nói
  // rõ giới hạn đó thay vì để người sau tưởng đây là ca tích hợp.
  //
  // ⚠️ NHƯNG PHẢI PIN BẰNG AST, KHÔNG BẰNG `toContain`. Lăng kính Đợt 6 chứng minh bản `toContain`
  // lách được bằng ĐÚNG MỘT DẤU `//`: chú thích cũng là text, `@typescript-eslint/no-unused-vars`
  // chỉ ở mức `warn` và `pnpm lint` không có `--max-warnings`, nên lưới thứ ba chết hoàn toàn mà
  // cả bộ test vẫn xanh. Nó còn ĐỎ GIẢ theo chiều ngược lại: Prettier xuống dòng, hay thêm một
  // event thứ hai, là đỏ dù hành vi y nguyên.
  //
  // `typescript` đã có sẵn trong repo (`devDependencies`) nên cách này KHÔNG thêm dependency.
  type TS = typeof import("typescript");
  type Obj = import("typescript").ObjectLiteralExpression;
  type Prop = import("typescript").PropertyAssignment;

  const docCauHinh = async (): Promise<{ ts: TS; src: string; cauHinh: Obj | null }> => {
    const ts = (await import("typescript")) as TS;
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/auth.ts", "utf8");
    const sf = ts.createSourceFile("lib/auth.ts", src, ts.ScriptTarget.Latest, true);

    let cauHinh: Obj | null = null;
    const di = (nut: import("typescript").Node): void => {
      if (
        cauHinh === null &&
        ts.isCallExpression(nut) &&
        ts.isIdentifier(nut.expression) &&
        nut.expression.text === "NextAuth" &&
        nut.arguments.length > 0 &&
        ts.isObjectLiteralExpression(nut.arguments[0]!)
      ) {
        cauHinh = nut.arguments[0] as Obj;
        return;
      }
      ts.forEachChild(nut, di);
    };
    di(sf);
    return { ts, src, cauHinh };
  };

  /** Các khoá cấp một tên `ten` trong object truyền cho `NextAuth({...})`. */
  const layKhoa = async (ten: string): Promise<{ ts: TS; gap: Prop[] }> => {
    const { ts, cauHinh } = await docCauHinh();
    if (!cauHinh) throw new Error("không tìm thấy lời gọi NextAuth({...}) trong lib/auth.ts");
    // Repo CÓ một spread hợp lệ ở cấp này (`...(authCookieDomain && envSlug ? { cookies } : {})`
    // — F2/SSO đa subdomain), nên không thể cấm spread nói chung. Nhưng một spread MANG THEO
    // `events` sẽ đè lên khoá của ta và pin dưới đây thành vô nghĩa ⇒ chặn đúng chừng đó.
    for (const x of cauHinh.properties) {
      if (ts.isSpreadAssignment(x)) expect(x.getText()).not.toContain("events");
    }
    const gap = cauHinh.properties.filter(
      (x): x is Prop => ts.isPropertyAssignment(x) && x.name.getText() === ten,
    );
    return { ts, gap };
  };

  const laySignOut = async (): Promise<{ ts: TS; so: Prop }> => {
    const { ts, gap } = await layKhoa("events");
    // Đúng MỘT khoá `events`: hai khoá thì khoá sau thắng và pin nói về khoá sai.
    expect(gap).toHaveLength(1);
    const ev = gap[0]!.initializer;
    expect(ts.isObjectLiteralExpression(ev)).toBe(true);
    const so = (ev as Obj).properties.filter(
      (x): x is Prop => ts.isPropertyAssignment(x) && x.name.getText() === "signOut",
    );
    expect(so).toHaveLength(1);
    return { ts, so: so[0]! };
  };

  it("`events.signOut` trỏ ĐÚNG `thuHoiKhiAuthSignOut`, là mã SỐNG (không chú thích, không cờ)", async () => {
    const { ts, so } = await laySignOut();
    // Phải là một ĐỊNH DANH trần, không phải biểu thức điều kiện hay lời gọi bọc cờ: repo bọc mọi
    // thứ sau cờ, nên "bật dần bằng một cờ để sai" là đường hỏng gần nhất.
    expect(ts.isIdentifier(so.initializer)).toBe(true);
    expect(so.initializer.getText()).toBe("thuHoiKhiAuthSignOut");
  });

  it("⚠️ `session.strategy` phải là jwt — lưới thứ ba đọc nhánh `token`", async () => {
    // Repo CÓ `adapter: PrismaAdapter(db)`, nên mặc định của `@auth/core` là chiến lược
    // database; nó ra jwt chỉ vì `lib/auth.ts` khai tường minh. Ai đó "dọn" dòng đó (nó trông như
    // mặc định dư thừa, do `adapter` nằm ngay trên) thì `@auth/core` bắn
    // `events.signOut?.({ session })` chứ không `({ token })`, cổng `!("token" in message)` thoát
    // sớm, và lưới thứ ba TẮT IM LẶNG. Pin đặt CẠNH pin `events` để hai thứ cùng đỏ cùng xanh.
    const { ts, gap } = await layKhoa("session");
    expect(gap).toHaveLength(1);
    const ss = gap[0]!.initializer;
    expect(ts.isObjectLiteralExpression(ss)).toBe(true);
    const st = (ss as Obj).properties.find(
      (x): x is Prop => ts.isPropertyAssignment(x) && x.name.getText() === "strategy",
    );
    expect(st?.initializer.getText().replace(/["']/g, "")).toBe("jwt");
  });

  it("`lib/auth.ts` import lưới này từ `@/lib/push/thu-hoi`", async () => {
    const { src } = await docCauHinh();
    expect(src).toContain('from "@/lib/push/thu-hoi"');
  });

  it("⚠️ KHÔNG cắm `thuHoiMoiThietBiCuaNguoi` làm `events.signOut`", async () => {
    // Cắm hàm đó ở đây là đảo ngược quyết định vận hành: đăng xuất ở máy công ty buổi tối thành
    // MẤT push trên điện thoại riêng, im lặng, không màn nào báo.
    //
    // Bản đầu của ca này cấm sự XUẤT HIỆN của tên hàm trong CẢ TỆP — ĐỎ GIẢ, vì repo viết chú
    // thích dài giải thích "đừng làm X" và nêu tên hàm bị cấm là đủ làm test đỏ mà hành vi y
    // nguyên. Nay chỉ xét đúng biểu thức được cắm.
    const { so } = await laySignOut();
    expect(so.initializer.getText()).not.toContain("thuHoiMoiThietBiCuaNguoi");
  });
});
