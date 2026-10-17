// Ca [QCS-*] — CỬA HẸP vào Cấu hình vận hành cho Quản lý cơ sở.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chủ dự án chốt 22/09/2026: trần số đợt / số ưu đãi thì QLCS tự chỉnh được ở Cấu hình
// vận hành. Nhưng màn đó có 100+ khoá gồm OTP, mẫu tin ZNS, khoá VAPID, trần hoa hồng —
// nới `settings:view` là chữa một vấn đề bằng cách mở một vấn đề lớn hơn (bài học
// `audit-logs:view` đã ghi trong CLAUDE.md).
//
// ⚠️ Và việc GỠ `settings:view` khỏi Quản lý cơ sở là QUYẾT ĐỊNH CÓ CHỮ KÝ ngày 03/08/2026
// (`lib/auth/rbac-intentional.ts`). Quyền hẹp `settings:view-center` KHÔNG đảo quyết định
// ấy — nó mở một cửa khác, hẹp hơn, bên cạnh. Ca [QCS-01] khoá lại đúng điều đó: nếu ai đó
// "tiện tay" cấp luôn `settings:view` cho CENTER_MANAGER thì ca này đỏ.
//
// ⚠️ VÌ SAO PHẦN SEED LÀ LƯỚI GHIM MÃ NGUỒN: `prisma/seed-roles.ts` là DỮ LIỆU khai báo,
// không phải hàm — không có đầu vào nào để gọi. Và RBAC v2 đọc quyền từ DB chứ không từ
// tệp, nên một test hành vi ở đây sẽ kiểm DB của máy chạy test, không kiểm điều cần khẳng
// định là "tệp seed khai đúng".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { SETTINGS } from "@/lib/settings/registry";

function doc(duong: string): string {
  return readFileSync(resolve(process.cwd(), duong), "utf8");
}

/**
 * Các dòng KHÔNG phải chú thích của một tệp.
 *
 * ⚠️ KHÔNG bóc chú thích bằng regex rồi soi cả văn bản, và lý do là một phép đo chứ không
 * phải đề phòng: dòng 461 của `seed-roles.ts` có chuỗi `` `lop-trial/**` `` nằm TRONG một
 * chú thích `//`. Bóc khối trước (đúng thứ tự mà lưới `[NTT-03]` cần) thì cái `/**` ấy mở
 * một khối GIẢ và nuốt luôn hàng trăm dòng khai quyền phía sau — lưới đỏ vì một dấu sao ở
 * chỗ khác, và thông báo lỗi không chỉ về phía đó.
 *
 * Đảo thứ tự cũng không an toàn: block comment chứa `https://…` sẽ mất đuôi. Nên bỏ hẳn
 * phép bóc — thứ cần soi là DÒNG KHAI, mà dòng khai không bao giờ bắt đầu bằng `//`.
 */
function dongKhai(duong: string): string[] {
  return doc(duong)
    .split(/\r?\n/)
    .filter((d) => !d.trim().startsWith("//"));
}

describe("[QCS-01] ma trận v1 — quyền HẸP có, quyền RỘNG vẫn không", () => {
  it("CENTER_MANAGER có `settings:view-center`", () => {
    expect(PERMISSIONS["settings:view-center"]).toContain("CENTER_MANAGER");
  });

  it("CENTER_MANAGER VẪN KHÔNG có `settings:view` — quyết định 03/08 còn nguyên", () => {
    expect(
      PERMISSIONS["settings:view"],
      "ai đó vừa nới settings:view cho Quản lý cơ sở — đó là đảo quyết định ký 03/08/2026, " +
        "và nó mở luôn OTP/ZNS/VAPID/trần hoa hồng",
    ).not.toContain("CENTER_MANAGER");
  });

  it("CENTER_MANAGER KHÔNG có `settings:edit` — chế độ hẹp không sửa giá trị toàn cục", () => {
    expect(PERMISSIONS["settings:edit"]).not.toContain("CENTER_MANAGER");
  });
});

describe("[QCS-02] seed v2 khai KHỚP v1 — prod đọc v2, local đọc v1", () => {
  // Hai bộ lệch nhau là ca "xanh ở máy, 403 trên prod" mà repo đã dính nhiều lần.
  const seed = dongKhai("prisma/seed-roles.ts");

  it("`settings:view-center` được khai ĐÚNG MỘT lần", () => {
    expect(seed.filter((d) => d.includes('action: "settings:view-center"'))).toHaveLength(1);
  });

  it("seed `scopeType: GLOBAL`, KHÔNG phải CENTER", () => {
    // ⚠️ Bẫy đã ghi trong memory: quyền cổng TRANG phải seed GLOBAL. Seed CENTER thì
    // `checkPermission("settings:view-center")` gọi KHÔNG kèm target trả false trên prod
    // (RBAC v2) và khoá nhầm cửa chính — trong khi local chạy v1 nên vẫn xanh.
    //
    // Cách ly cơ sở KHÔNG dựa vào scopeType ở đây mà dựa vào `setCenterSetting` — xem [QCS-03].
    const dong = seed.find((d) => d.includes('action: "settings:view-center"'));
    expect(dong, "không thấy dòng khai — lưới đang soi nhầm chỗ").toBeTruthy();
    expect(dong).toContain('scopeType: "GLOBAL"');
  });

  it("seed KHÔNG khai `settings:view` cho bất kỳ vai nào", () => {
    // Đo 23/09: `settings:view` chưa từng được seed — trên prod chỉ Quản trị tối cao mở
    // được màn đó (qua nhánh bypass SUPER_ADMIN của `can()` v2). Ca này giữ nguyên hiện
    // trạng ấy: cấp nó cho một vai là quyết định phải có chữ ký, không phải một dòng thêm
    // vào lúc tiện tay.
    expect(seed.filter((d) => /action:\s*"settings:view"/.test(d))).toEqual([]);
  });
});

describe("[QCS-03] cách ly cơ sở nằm ở ĐƯỜNG GHI, không ở cổng trang", () => {
  const service = doc("lib/settings/service.ts");

  it("CẢ HAI đường ghi theo cơ sở đều đi qua `laQuanLyCoSo`", () => {
    // Cổng này mới là thứ chặn QLCS cơ sở 1 sửa cấu hình cơ sở 2. Gỡ nó thì cổng trang
    // (`settings:view-center`, scope GLOBAL) KHÔNG đỡ được — nó chỉ mở cửa, không phân vùng.
    //
    // ⚠️ Đếm SỐ LẦN, không chỉ "có xuất hiện": hai hàm `setCenterSetting` và
    // `clearCenterSetting` cùng cần cổng, và trước 24/09 chúng chép tay hai bản. Một bản vá
    // chỉ sửa một hàm là hở đúng đường GỠ — gỡ mức riêng của cơ sở khác vẫn là sửa cấu hình
    // của họ, chỉ khác chiều. Ca `[CRC-08]` đo hành vi ấy trên Postgres thật.
    expect(service.match(/laQuanLyCoSo\(actor, params\.orgUnitId\)/g) ?? []).toHaveLength(2);
  });

  it("phép kiểm ấy KHÔNG còn bản chép tay nào trong `service.ts`", () => {
    // Nếu ai đó "tiện tay" viết lại điều kiện tại chỗ thì màn Cấu hình vận hành (dùng
    // `coSoSuaDuoc` cùng tệp) và cổng ghi bắt đầu lệch — và lệch theo chiều màn bày THỪA
    // thì không ai thấy cho tới lúc bấm Lưu.
    expect(service).not.toContain("MANAGER_ROLE_CODES");
    expect(service).not.toMatch(/r\.orgUnitId === params\.orgUnitId/);
  });

  it("`setCenterSetting` từ chối khoá KHÔNG `centerOverridable`", () => {
    // Chế độ hẹp lọc danh sách BÀY RA, nhưng lọc giao diện không phải cổng. Gọi thẳng
    // server action với một khoá toàn cục vẫn phải bị từ chối.
    expect(service).toMatch(/if \(!def\.centerOverridable\)/);
  });
});

describe("[QCS-04] hai trần của đợt này PHẢI cài riêng được theo cơ sở", () => {
  // Đổi một trong hai thành `centerOverridable: false` thì chế độ hẹp lọc nó đi, và QLCS
  // mở màn ra KHÔNG THẤY thứ chủ dự án bảo họ tự chỉnh — im lặng, không lỗi nào báo.
  const KHOA = ["orders.maxInstallments", "orders.maxDiscountItems"] as const;

  for (const key of KHOA) {
    it(`\`${key}\` khai centerOverridable`, () => {
      const def = SETTINGS[key] as { centerOverridable?: boolean } | undefined;
      expect(def, `khoá ${key} không còn trong registry`).toBeTruthy();
      expect(def?.centerOverridable).toBe(true);
    });
  }
});

describe("[QCS-05] nối dây ở `page.tsx` — quyền mới phải TỚI được khối cài riêng", () => {
  // ⚠️ ĐÂY LÀ LƯỚI GHIM MÃ NGUỒN, loại mong manh nhất (luật 11) — dùng vì `page.tsx` là một
  // Server Component gọi `auth()` + `checkPermission()` + 5 câu đọc DB: test hành vi cho nó
  // là dựng một rừng mock, và rừng mock ấy chính là thứ đã làm đỏ giả 5 ca hôm 18/09.
  //
  // Phần HÀNH VI — prop nào điều khiển ô nào — đo thật ở
  // `app/(admin)/admin/cau-hinh-van-hanh/_components/hai-cua-sua.test.tsx` ([HCS-*]).
  // Lưới này chỉ canh MỘT điều còn lại: trang truyền ĐÚNG cờ xuống.
  const trang = dongKhai("app/(admin)/admin/cau-hinh-van-hanh/page.tsx");

  it("truyền `choSuaCoSo={suaDuocCoSo}`, KHÔNG phải `{canEditGlobal}`", () => {
    // Nối vào `canEditGlobal` là tái lập đúng lỗi vừa vá: Quản lý cơ sở vào được màn mà mọi
    // ô đều khoá. Nó không ném lỗi và không làm ca nào khác đỏ.
    expect(trang.filter((d) => d.includes("choSuaCoSo={suaDuocCoSo}"))).toHaveLength(1);
    expect(trang.filter((d) => d.includes("choSuaCoSo={canEditGlobal}"))).toEqual([]);
  });

  it("`suaDuocCoSo` mở bằng CHÍNH quyền hẹp của đợt này", () => {
    // Đổi sang một quyền khác (hoặc bỏ vế `cheDoCoSo`) thì cửa vẫn mở được bằng
    // `settings:view-center` — người dùng vào được màn — nhưng khối cài riêng đóng lại, và
    // triệu chứng lại là "không lỗi nào báo".
    const dinhNghia = trang.filter((d) => d.includes("const cheDoCoSo"));
    expect(dinhNghia, "không thấy `cheDoCoSo` — lưới đang soi nhầm chỗ").toHaveLength(1);
    expect(dinhNghia[0]).toContain('checkPermission("settings:view-center")');
    expect(trang.filter((d) => d.includes("const suaDuocCoSo"))).toHaveLength(1);
  });
});
