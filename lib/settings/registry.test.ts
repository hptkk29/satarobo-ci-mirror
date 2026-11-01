/**
 * R6-A — Unit test registry + resolve (thuần, không DB).
 * Phủ: T1 (resolve precedence), T2 (validation), T3 (boundary), T12 (default an toàn).
 */
import { describe, it, expect } from "vitest";
import {
  SETTINGS,
  SETTING_KEYS,
  getSettingDef,
  validateSettingValue,
} from "@/lib/settings/registry";
import { resolveSettingValue } from "@/lib/settings/resolve";
import { TIEN_TO_MAC_DINH } from "@/lib/push/allowlist";

describe("[R6-A] registry — validate giá trị (US-R6A-1 AC4)", () => {
  it("[R6-A-T2-01] key không có schema → từ chối", () => {
    const r = validateSettingValue("khong.ton.tai", 1);
    expect(r.ok).toBe(false);
  });

  it("[R6-A-T2-02] sai kiểu (string cho key số) → từ chối", () => {
    const r = validateSettingValue("student.nearEndThreshold", "abc");
    expect(r.ok).toBe(false);
  });

  it("[R6-A-T3-01] vượt khoảng (sĩ số 0 < min 1) → từ chối", () => {
    expect(validateSettingValue("class.minStudents.default", 0).ok).toBe(false);
    expect(validateSettingValue("class.maxStudents.default", 101).ok).toBe(false);
  });

  it("[R6-A-T3-02] đúng biên (=1, =50) → chấp nhận", () => {
    expect(validateSettingValue("student.nearEndThreshold", 1).ok).toBe(true);
    expect(validateSettingValue("student.nearEndThreshold", 50).ok).toBe(true);
  });

  it("[R6-A-T2-03] proposalWindow fromDay > toDay → từ chối", () => {
    const r = validateSettingValue("shift.proposalWindow", { fromDay: 28, toDay: 25 });
    expect(r.ok).toBe(false);
  });

  it("[R6-A-T2-04] email sai định dạng → từ chối", () => {
    const r = validateSettingValue("contact.emails", { primary: "not-email", recruitment: "a@b.vn" });
    expect(r.ok).toBe(false);
  });

  it("[R6-A-T1-01] giá trị hợp lệ → ok + trả về value đã parse", () => {
    const r = validateSettingValue("shift.toleranceMinutes", 10);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
  });

  it("[R6-A-T12-01] mọi default trong registry tự thỏa schema của nó", () => {
    for (const key of SETTING_KEYS) {
      const d = getSettingDef(key)!;
      const r = d.schema.safeParse(d.default);
      expect(r.success, `default của ${key} phải hợp lệ`).toBe(true);
    }
  });
});

describe("[R6-A] resolve — Center → Global → default (US-R6A-2)", () => {
  const numDef = SETTINGS["class.maxStudents.default"]; // centerOverridable=true
  const globalOnly = SETTINGS["enrollment.suspendMaxMonths"]; // centerOverridable=false

  it("[R6-A-T1-02] không có row → trả default", () => {
    expect(resolveSettingValue({ def: numDef })).toBe(20);
  });

  it("[R6-A-T1-03] chỉ có global → trả global", () => {
    expect(resolveSettingValue({ def: numDef, globalRow: { valueJson: 24 } })).toBe(24);
  });

  it("[R6-A-T1-04] có center override → center thắng global", () => {
    expect(
      resolveSettingValue({
        def: numDef,
        globalRow: { valueJson: 24 },
        centerRow: { valueJson: 12 },
      }),
    ).toBe(12);
  });

  it("[R6-A-T1-05] key KHÔNG centerOverridable → bỏ qua center row, dùng global", () => {
    expect(
      resolveSettingValue({
        def: globalOnly,
        globalRow: { valueJson: 9 },
        centerRow: { valueJson: 3 },
      }),
    ).toBe(9);
  });

  it("[R6-A-T8-01] center row hỏng schema → fallback global (không sập)", () => {
    expect(
      resolveSettingValue({
        def: numDef,
        globalRow: { valueJson: 24 },
        centerRow: { valueJson: "hỏng" },
      }),
    ).toBe(24);
  });

  it("[R6-A-T8-02] global row hỏng schema → fallback default", () => {
    expect(resolveSettingValue({ def: numDef, globalRow: { valueJson: 999999 } })).toBe(20);
    // 999999 > max 100 → invalid → default
  });
});

describe("[PUSH-D7-T22] push.tienToDuocDay — chặn khoá gõ sai ngay ở tầng validate", () => {
  it("mặc định NEO vào `TIEN_TO_MAC_DINH`, không phải danh sách gõ lại ở đây", () => {
    // Bản cũ của ca này gõ lại `["lead.moi:"]`, tức nó là bản chép tay THỨ BA của cùng một
    // danh sách (hằng · `default` của registry · ca test này). Ba bản thì cái nào cũng có
    // thể lệch, và lệch ở đây là lệch CÂM: `docTienToDuocDay()` đọc `default` của registry,
    // nên ca chép tay sẽ đỏ vì lý do SAI (nó tưởng đang canh hành vi, thực ra đang canh một
    // con số nó tự giữ).
    //
    // Nay ca này canh đúng thứ đáng canh: `default` PHẢI LÀ chính cái hằng (`toBe` — so địa
    // chỉ, nên chép lại một mảng bằng nhau vẫn đỏ). Nội dung của hằng do
    // `lib/push/allowlist.test.ts` ghim, kèm chú thích giải thích từng tiền tố.
    expect(SETTINGS["push.tienToDuocDay"].default).toBe(TIEN_TO_MAC_DINH);
  });

  it("nhận danh sách gồm các tiền tố CÓ THẬT", () => {
    expect(validateSettingValue("push.tienToDuocDay", ["lead.moi:", "sla:"]).ok).toBe(true);
  });

  it("nhận danh sách RỖNG — 'tắt hết' là một lựa chọn hợp lệ", () => {
    expect(validateSettingValue("push.tienToDuocDay", []).ok).toBe(true);
  });

  it("⚠️ TỪ CHỐI khoá thiếu dấu hai chấm — nó khớp LẤN sang loại sinh sau", () => {
    // `lead.moi` (không có dấu hai chấm) khớp cả `lead.moi_gi_do:` ra đời sau đó. Dấu hai chấm
    // là luật khớp dùng chung với `lib/notifications/catalog.ts`; hai bảng cùng đọc một khoá mà
    // luật khớp lệch nhau là loại lệch không ai nhìn thấy cho tới lúc gửi nhầm.
    expect(validateSettingValue("push.tienToDuocDay", ["lead.moi"]).ok).toBe(false);
    expect(validateSettingValue("push.tienToDuocDay", ["lead.moi:", "sai"]).ok).toBe(false);
  });

  it("tầng này KHÔNG đối chiếu danh mục — đó là việc của đường ghi", () => {
    // ⚠️ Ca này khoá một sự ĐÁNH ĐỔI CÓ CHỦ ĐÍCH, không phải một lỗ hổng bị bỏ quên.
    //
    // Đặt phép đối chiếu danh mục ở đây cần `import catalogPrefixes`, và `lint:boundaries` bắt
    // được 11 vòng import khi thử: registry → notifications/catalog → notifications/pending-sync
    // → pending-tasks → settings/service · auth/actor → … → registry. Nới luật `no-circular`
    // chung của repo để hợp thức hoá một tính năng là đổi rào cho cả repo — không làm.
    //
    // Phép đối chiếu nằm ở `luuLoaiDuocDayAction` và có ca test riêng. Ai dời nó về đây thì ca
    // này đỏ, và buộc đọc lý do trước khi sửa.
    expect(validateSettingValue("push.tienToDuocDay", ["khong_ton_tai:"]).ok).toBe(true);
  });

  it("TỪ CHỐI chuỗi rỗng — nó khớp MỌI khoá, tức biến danh sách trắng thành 'đẩy tất'", () => {
    expect(validateSettingValue("push.tienToDuocDay", [""]).ok).toBe(false);
    expect(validateSettingValue("push.tienToDuocDay", ["lead.moi:", ""]).ok).toBe(false);
  });

  it("chuỗi rỗng báo ĐÚNG lý do của nó, không phải lý do 'thiếu dấu hai chấm'", () => {
    // ⚠️ Ca này sinh ra từ một phép CẤY LỖI XANH GIẢ: gỡ hẳn nhánh kiểm chuỗi rỗng thì không
    // ca nào đỏ, vì `"".endsWith(":")` cũng false nên nhánh dấu hai chấm bắt thay. Tức là ca
    // trên KHÔNG chứng minh được nhánh chuỗi rỗng còn sống.
    //
    // Thứ nhánh đó thật sự đóng góp là CÂU BÁO LỖI. "Phải kết thúc bằng dấu hai chấm" nói sai
    // bản chất cho một ô trống, và người vận hành sẽ đi thêm dấu hai chấm vào một chuỗi rỗng.
    const r = validateSettingValue("push.tienToDuocDay", [""]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("rỗng");
  });

  it("TỪ CHỐI khoá khai hai lần", () => {
    expect(validateSettingValue("push.tienToDuocDay", ["lead.moi:", "lead.moi:"]).ok).toBe(false);
  });

  it("TỪ CHỐI thứ không phải mảng chuỗi", () => {
    for (const v of ["lead.moi:", 1, null, { a: 1 }, [1, 2], [null]]) {
      expect(validateSettingValue("push.tienToDuocDay", v).ok, JSON.stringify(v)).toBe(false);
    }
  });

  it("KHÔNG cho override theo cơ sở", () => {
    // Một cơ sở tự tắt một loại thì nhân viên cơ sở đó im lặng mà Hội sở không biết — đúng
    // loại lỗi câm mà cả module này sinh ra để tránh.
    expect(SETTINGS["push.tienToDuocDay"].centerOverridable).toBe(false);
  });
});

describe("[TRIAL-GV-T01] hai nút vặn của luật xếp giáo viên buổi học thử", () => {
  it("cờ lọc mặc định TẮT — ngày deploy không có gì đổi", () => {
    // Đây là điều kiện để đưa luật mới lên mà không ai nhận ra: dropdown giáo viên hôm sau
    // vẫn đúng như hôm trước, và người vận hành tự bật khi đã xem bảng ca của tháng.
    //
    // Cũng là NÚT RÚT DÂY: nếu bản lọc làm dropdown rỗng trên prod (đúng hình dạng sự cố
    // 28/08/2026) thì tắt cờ là mọi giáo viên hiện lại ngay, không cần deploy.
    expect(SETTINGS["trial.locGvTheoCaLamViec"].default).toBe(false);
  });

  it("cờ lọc chỉ nhận bật/tắt", () => {
    expect(validateSettingValue("trial.locGvTheoCaLamViec", true).ok).toBe(true);
    expect(validateSettingValue("trial.locGvTheoCaLamViec", false).ok).toBe(true);
    for (const v of ["true", 1, null, [], {}]) {
      expect(validateSettingValue("trial.locGvTheoCaLamViec", v).ok, JSON.stringify(v)).toBe(
        false,
      );
    }
  });

  it("danh sách miễn trừ mặc định RỖNG — không ai được miễn khi DB trống", () => {
    expect(SETTINGS["trial.gvMienLocTheoCa"].default).toEqual([]);
  });

  it("nhận danh sách mã người dùng, và nhận cả danh sách RỖNG", () => {
    expect(validateSettingValue("trial.gvMienLocTheoCa", ["u_kiet", "u_toai"]).ok).toBe(true);
    expect(validateSettingValue("trial.gvMienLocTheoCa", []).ok).toBe(true);
  });

  it("TỪ CHỐI dòng trống — nó không khớp được ai mà vẫn làm lệch con số đếm", () => {
    // Một dòng rỗng nằm trong danh sách ngoại lệ là thứ không đọc ra được bằng mắt: màn hình
    // báo "3 người được miễn" trong khi chỉ có 2 người thật.
    const r = validateSettingValue("trial.gvMienLocTheoCa", ["u_kiet", "   "]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("trống");
    expect(validateSettingValue("trial.gvMienLocTheoCa", [""]).ok).toBe(false);
  });

  it("TỪ CHỐI mã khai hai lần", () => {
    expect(validateSettingValue("trial.gvMienLocTheoCa", ["u_kiet", "u_kiet"]).ok).toBe(false);
  });

  it("TỪ CHỐI quá 50 người", () => {
    const nhieu = Array.from({ length: 51 }, (_, i) => `u_${i}`);
    expect(validateSettingValue("trial.gvMienLocTheoCa", nhieu).ok).toBe(false);
    expect(validateSettingValue("trial.gvMienLocTheoCa", nhieu.slice(0, 50)).ok).toBe(true);
  });

  it("TỪ CHỐI thứ không phải mảng chuỗi", () => {
    for (const v of ["u_kiet", 1, null, { a: 1 }, [1, 2], [null]]) {
      expect(validateSettingValue("trial.gvMienLocTheoCa", v).ok, JSON.stringify(v)).toBe(false);
    }
  });

  it("tầng này KHÔNG đối chiếu danh sách giáo viên — đó là việc của đường ghi", () => {
    // ⚠️ Ca này khoá một ĐÁNH ĐỔI CÓ CHỦ ĐÍCH, không phải lỗ hổng bị bỏ quên. Đối chiếu ở đây
    // cần `import { getAssignableTeachers }` → `lib/db`, tức registry (tầng thấp nhất) kéo cả
    // Prisma vào; `lint:boundaries` chặn cứng, và đó cũng chính là lý do `push.tienToDuocDay`
    // phải dời phép đối chiếu của nó xuống action.
    //
    // Phép đối chiếu nằm ở `luuGvMienTruAction` và có ca test riêng. Ai dời nó về đây thì ca
    // này đỏ, và buộc đọc lý do trước khi sửa.
    expect(validateSettingValue("trial.gvMienLocTheoCa", ["khong_ton_tai"]).ok).toBe(true);
  });

  it("KHÔNG cho override theo cơ sở — luật xếp người phải giống nhau toàn hệ", () => {
    // Lệch giữa các cơ sở là cùng một người chọn được ở đây mà không chọn được ở kia, và
    // không ai giải thích nổi vì sao.
    expect(SETTINGS["trial.locGvTheoCaLamViec"].centerOverridable).toBe(false);
    expect(SETTINGS["trial.gvMienLocTheoCa"].centerOverridable).toBe(false);
  });
});
