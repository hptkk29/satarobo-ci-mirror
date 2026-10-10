/**
 * lib/export/quyen-xuat.test.ts — cổng "ai được xuất dữ liệu gì".
 *
 * Hỏng ở đây nghĩa là một vai tải được tệp không thuộc phần việc của họ, và tệp đã rời khỏi
 * hệ thống thì không thu hồi được. Không có lỗi nào được ném ra: tệp vẫn mở được, vẫn đúng
 * định dạng, chỉ là đến tay người không nên có nó.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_SEED } from "@/prisma/seed-roles";
import { SETTINGS } from "@/lib/settings/registry";
import { TAB_CAU_HINH, QUYEN_TAB } from "@/lib/settings/nhan-van-hanh";
import { MAN_XUAT, timManXuat, manXuatTheoNhom, NHAN_NHOM } from "./danh-muc-xuat";
import { vaiDuocXuat, vaiKhopDanhSach, KHOA_VAI_XUAT, MOI_MA_XUAT } from "./quyen-xuat-thuan";
import { MA_NHAP_LAI } from "./nhap-lai";
import { MA_BAO_CAO } from "./bao-cao";
import { BO_XUAT, MOI_MA_CO_ROUTE } from "./bo-xuat";

const man = (ma: string) => {
  const m = timManXuat(ma);
  if (!m) throw new Error(`test sai: không có màn "${ma}"`);
  return m;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('vaiDuocXuat — "vắng mặt" KHÁC "rỗng"', () => {
  it("màn VẮNG MẶT trong cấu hình ⇒ theo vai mặc định của màn", () => {
    // Đây là câu giữ cho đợt siết quyền không hoá thành sự cố vận hành: 14 đường xuất đang
    // chạy trên prod vẫn chạy khi bảng cấu hình còn trống.
    const m = man("nhan-su");
    expect(vaiDuocXuat(m, {})).toEqual(m.vaiMacDinh);
    expect(vaiDuocXuat(m, null)).toEqual(m.vaiMacDinh);
    expect(vaiDuocXuat(m, undefined)).toEqual(m.vaiMacDinh);
    expect(vaiDuocXuat(m, { "mot-man-khac": ["HO_HR"] })).toEqual(m.vaiMacDinh);
  });

  it("🔒 màn có mặt với mảng RỖNG ⇒ RỖNG, KHÔNG rơi về mặc định", () => {
    // Ca dễ hỏng nhất của cả cơ chế. Coi rỗng như vắng mặt thì admin bỏ hết ô tích để siết
    // lại, hệ thống lặng lẽ trả về mặc định, và màn hình vẫn vẽ "chưa giao vai nào".
    const m = man("nhan-su");
    expect(m.vaiMacDinh.length).toBeGreaterThan(0); // để ca này có ý nghĩa
    expect(vaiDuocXuat(m, { "nhan-su": [] })).toEqual([]);
  });

  it("màn có mặt với danh sách ⇒ đúng danh sách đó, không hợp nhất với mặc định", () => {
    const m = man("nhan-su");
    expect(vaiDuocXuat(m, { "nhan-su": ["CENTER_MANAGER"] })).toEqual(["CENTER_MANAGER"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("vaiKhopDanhSach", () => {
  it("quản trị tối cao xuất được mọi màn, kể cả danh sách rỗng", () => {
    expect(vaiKhopDanhSach([], [], true)).toBe(true);
    expect(vaiKhopDanhSach(["SUPER_ADMIN"], [], true)).toBe(true);
  });

  it('🔒 danh sách RỖNG ⇒ mọi vai khác bị từ chối ("chưa phân quyền thì chỉ admin")', () => {
    expect(vaiKhopDanhSach(["CENTER_MANAGER"], [], false)).toBe(false);
    expect(vaiKhopDanhSach(["HO_HR", "CENTER_HR"], [], false)).toBe(false);
  });

  it("khớp MỘT vai là đủ — người nhiều vai lấy hợp của quyền", () => {
    expect(vaiKhopDanhSach(["TEACHER", "CENTER_HR"], ["CENTER_HR"], false)).toBe(true);
  });

  it("không vai nào khớp ⇒ từ chối", () => {
    expect(vaiKhopDanhSach(["TEACHER"], ["CENTER_HR", "HO_HR"], false)).toBe(false);
  });

  it("người không có vai nào ⇒ từ chối, không ném", () => {
    expect(vaiKhopDanhSach([], ["CENTER_HR"], false)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("danh mục màn xuất — tính toàn vẹn", () => {
  it("mã màn không trùng nhau", () => {
    // Mã là khoá lưu trong `SystemSetting`; hai màn cùng mã là hai màn dùng chung một dòng
    // cấu hình, và người phân quyền cho màn này lại mở luôn màn kia.
    expect(new Set(MOI_MA_XUAT).size).toBe(MOI_MA_XUAT.length);
  });

  it("mã màn chỉ gồm chữ thường, số và dấu gạch ngang", () => {
    for (const ma of MOI_MA_XUAT) expect(ma).toMatch(/^[a-z0-9-]+$/);
  });

  it("mọi màn đều có tên, đường dẫn màn và ít nhất một dòng nói tệp chứa gì", () => {
    // `noiDung` là thứ người phân quyền dựa vào để quyết. Một màn không mô tả gì là một ô
    // tích mù.
    for (const m of MAN_XUAT) {
      expect(m.ten.trim().length, m.ma).toBeGreaterThan(3);
      expect(m.man, m.ma).toMatch(/^\/admin\//);
      expect(m.noiDung.length, m.ma).toBeGreaterThan(0);
      for (const d of m.noiDung) expect(d.trim().length, `${m.ma}: ${d}`).toBeGreaterThan(10);
    }
  });

  it("🔒 mọi mã vai trong `vaiMacDinh` PHẢI có thật trong ROLE_SEED", () => {
    // Một mã gõ sai trông hệt một vai đã bị xoá: không ai khớp, không lỗi nào ném, và cả
    // đường xuất lặng lẽ thành "chỉ admin".
    const that = new Set(ROLE_SEED.map((r) => r.code));
    for (const m of MAN_XUAT) {
      for (const v of m.vaiMacDinh) expect(that.has(v), `${m.ma} → ${v}`).toBe(true);
    }
  });

  it("`vaiMacDinh` không trùng lặp và không chứa SUPER_ADMIN", () => {
    // SUPER_ADMIN thắng ở nhánh riêng (`vaiKhopDanhSach`), nên khai thêm vào danh sách chỉ
    // làm màn hình vẽ một ô tích không có tác dụng gỡ.
    for (const m of MAN_XUAT) {
      expect(new Set(m.vaiMacDinh).size, m.ma).toBe(m.vaiMacDinh.length);
      expect(m.vaiMacDinh, m.ma).not.toContain("SUPER_ADMIN");
    }
  });

  it("🔒 màn khai `quyenGoc: null` phải NÓI RÕ vì sao (trừ khi thật sự không có cổng đọc)", () => {
    // Hai ca `null` khác nhau hoàn toàn: "route tự kiểm bằng logic phức hợp" và "không có
    // cổng đọc nào". Màn cấu hình in hai câu khác nhau, nên ca thứ nhất bắt buộc có ghi chú.
    const phucHop = ["lop-hoc", "cham-cong-thang"];
    for (const ma of phucHop) {
      const m = man(ma);
      expect(m.quyenGoc, ma).toBeNull();
      expect(m.quyenGocGhiChu?.trim().length ?? 0, ma).toBeGreaterThan(20);
    }
  });

  it("mọi nhóm đều có nhãn, và mọi màn đều thuộc một nhóm được vẽ", () => {
    const veRa = manXuatTheoNhom().flatMap((g) => g.man.map((m) => m.ma));
    expect(new Set(veRa)).toEqual(new Set(MOI_MA_XUAT));
    for (const m of MAN_XUAT) expect(NHAN_NHOM[m.nhom], m.ma).toBeTruthy();
  });

  it("mã lạ ⇒ `timManXuat` trả undefined (để cổng fail-closed)", () => {
    expect(timManXuat("khong-ton-tai")).toBeUndefined();
    expect(timManXuat("")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("gắn vào Cấu hình vận hành", () => {
  it("khoá cấu hình có trong registry, không cho cài riêng theo cơ sở", () => {
    const d = SETTINGS[KHOA_VAI_XUAT as keyof typeof SETTINGS];
    expect(d).toBeDefined();
    // Cài riêng theo cơ sở là để cùng một vai xuất được ở CS1 mà không ở CS2 — đúng vấn đề
    // cơ chế này sinh ra để đóng.
    expect(d.centerOverridable).toBe(false);
    expect(d.default).toEqual({});
  });

  it("schema nhận bảng hợp lệ và TỪ CHỐI giá trị sai hình dạng", () => {
    const sc = SETTINGS[KHOA_VAI_XUAT as keyof typeof SETTINGS].schema;
    expect(sc.safeParse({ "nhan-su": ["HO_HR"] }).success).toBe(true);
    expect(sc.safeParse({ "nhan-su": [] }).success).toBe(true); // rỗng là hợp lệ: "chỉ admin"
    expect(sc.safeParse({ "nhan-su": "HO_HR" }).success).toBe(false);
    expect(sc.safeParse({ "nhan-su": [""] }).success).toBe(false);
    expect(sc.safeParse(null).success).toBe(false);
  });

  it("🔒 tab phân quyền đặt sau `settings:view` — quyền KHÔNG vai nào được cấp", () => {
    // Chốt của chủ dự án: chỉ quản trị tối cao được phân quyền xuất. Cách thi hành là quyền
    // `settings:view`, mà `seed-roles.ts` không cấp cho vai nào ⇒ chỉ SUPER_ADMIN mở được
    // qua nhánh bypass của `can()` v2. Nới quyền đó là nới luôn ai được quyết việc này.
    expect(TAB_CAU_HINH.map((t) => t.id)).toContain("quyen-xuat");
    expect(QUYEN_TAB["quyen-xuat"]).toBe("settings:view");
    const aiCo = ROLE_SEED.filter((r) =>
      r.perms.some((p) => p.action === "settings:view"),
    ).map((r) => r.code);
    expect(aiCo).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * LƯỚI BAO PHỦ — chặn đường xuất thứ 15 ra đời mà không có cổng.
 *
 * Đây là test ĐỌC MÃ NGUỒN, loại mong manh nhất (luật 11). Ba việc bắt buộc theo luật đó,
 * đã làm đủ: neo chuỗi HẸP (`chanXuat(` / `duocXuat(`), khẳng định cả SỐ LẦN khớp cho
 * `chanXuatVai` (chú thích giải thích bản vá có chứa đúng chuỗi đang tìm — đã dính ba lần
 * trong repo này), và ĐÃ cấy lại lỗi để thấy nó đỏ (ghi trong commit).
 *
 * Vì sao vẫn phải grep: thứ cần canh là "route CÓ GỌI cổng hay không". Test hành vi cần
 * dựng request + session + DB cho từng route; còn một route MỚI thì không có ca test nào
 * cả — đúng ca cần bắt.
 */
describe("[XUAT-COV] mọi đường xuất phải đi qua cổng", () => {
  const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  /** Route → mã màn tương ứng. Thêm đường xuất mới thì thêm vào đây. */
  const ROUTE: Record<string, string> = {
    "app/api/admin/nhan-su/export/route.ts": "nhan-su",
    "app/api/admin/cham-cong/export/route.ts": "cham-cong-ky",
    "app/api/admin/cham-cong/bang-cong-thang/export/route.ts": "cham-cong-thang",
    "app/api/admin/cham-cong/phan-ca/export/route.ts": "phan-ca-thang",
    "app/api/admin/classes/export/route.ts": "lop-hoc",
    "app/api/admin/crm/commission-export/route.ts": "hoa-hong",
    "app/api/admin/crm/so-chia-lead-export/route.ts": "so-chia-lead",
    "app/api/admin/dashboard-qlcs/lead-chuyen-doi-export/route.ts": "lead-chuyen-doi",
    "app/api/admin/leads/export/route.ts": "lead",
    "app/api/admin/reports/student-progress/route.ts": "tien-do-hoc-vien",
    "app/api/admin/templates/leads/route.ts": "mau-nhap-lead",
    "app/api/elearning/bao-cao-r1/route.ts": "elearning-tuan-thu",
  };

  it("mỗi route gọi cổng, kèm ĐÚNG mã màn của nó", () => {
    for (const [p, ma] of Object.entries(ROUTE)) {
      const src = doc(p);
      const goi = new RegExp(`(?:chanXuat|chanXuatVai|duocXuat)\\(\\s*"${ma}"`);
      expect(goi.test(src), `${p} chưa gọi cổng với mã "${ma}"`).toBe(true);
    }
  });

  it("route dùng `chanXuatVai` ĐÚNG là ba route có cổng đọc phức hợp", () => {
    // Khẳng định cả SỐ LƯỢNG: `chanXuatVai` bỏ qua cổng đọc, nên một route dùng nó sai chỗ
    // là mất một cổng. Hàm cũng tự ném khi màn khai `quyenGoc`, nhưng lưới này bắt sớm hơn.
    const dung = Object.keys(ROUTE).filter((p) => /chanXuatVai\(\s*"/.test(doc(p)));
    expect(dung.sort()).toEqual([
      "app/api/admin/cham-cong/bang-cong-thang/export/route.ts",
      // 07/10/2026: lưới phân ca — cổng đọc = assign HOẶC view theo khối, cả hai scope CENTER.
      "app/api/admin/cham-cong/phan-ca/export/route.ts",
      "app/api/admin/classes/export/route.ts",
    ]);
  });

  it("ba nút xuất dựng ở trình duyệt đều nhận cờ từ trang", () => {
    // Chúng không có route để gác nên cổng nằm ở trang. Quên truyền cờ thì `xuatDuoc` là
    // `undefined`, nút biến mất — hỏng theo chiều AN TOÀN, nhưng vẫn là hỏng.
    const cap: [string, string][] = [
      ["app/(admin)/admin/audit-log/page.tsx", "audit-log"],
      ["app/(admin)/admin/bao-cao/trial-sale/page.tsx", "bao-cao-trial-sale"],
      ["app/(admin)/admin/students/tai-khoan/page.tsx", "tai-khoan-phu-huynh"],
    ];
    for (const [p, ma] of cap) {
      expect(
        new RegExp(`duocXuatCuaPhienHienTai\\(\\s*['"]${ma}['"]`).test(doc(p)),
        `${p} chưa truyền cờ xuất cho "${ma}"`,
      ).toBe(true);
    }
  });

  it("mọi mã trong danh mục đều có nơi dùng — không có mục chết", () => {
    // Một mã khai mà không route/trang nào gọi là một ô tích không điều khiển gì: người
    // phân quyền tích vào, tưởng đã giao, thực tế chẳng đổi gì.
    //
    // Ba nguồn dùng mã: route tĩnh (bảng `ROUTE`), ba trang có nút dựng ở trình duyệt, và
    // route ĐỘNG `/api/admin/xuat/[ma]` phục vụ bảy màn nhập-lại-được — mã của nhóm cuối là
    // khoá của `BO_NAP`, nên lấy từ đó chứ không gõ lại (gõ lại là bản sao sẽ trôi).
    const dung = new Set<string>([
      ...Object.values(ROUTE),
      "audit-log",
      "bao-cao-trial-sale",
      "tai-khoan-phu-huynh",
      ...MOI_MA_CO_ROUTE,
    ]);
    expect([...MOI_MA_XUAT].filter((m) => !dung.has(m))).toEqual([]);
  });

  it("route động tồn tại và đọc từ sổ đăng ký gộp", () => {
    // `MOI_MA_CO_ROUTE` ở trên chỉ chứng minh "mã có trong sổ", chưa chứng minh có route nào
    // phục vụ chúng. Không có ca này thì xoá route động đi bộ test vẫn xanh.
    const src = doc("app/api/admin/xuat/[ma]/route.ts");
    expect(/BO_XUAT\[ma\]/.test(src)).toBe(true);
    expect(MA_NHAP_LAI).toHaveLength(7);
    expect(MA_BAO_CAO).toHaveLength(5);
    expect(MOI_MA_CO_ROUTE).toHaveLength(12);
  });

  it("🔒 CỜ `tieuDeLaKhoa` đúng cho từng họ tệp", () => {
    // Bật sai chiều là hỏng IM LẶNG theo hai cách khác nhau: bật cho tệp báo cáo thì người
    // đọc phải tự dịch `choXacNhan`; tắt cho tệp nhập-lại-được thì tiêu đề thành tiếng Việt
    // và màn nhập đọc ra MỌI CỘT RỖNG mà không báo lỗi gì.
    for (const ma of MA_NHAP_LAI) expect(BO_XUAT[ma]!.tieuDeLaKhoa, ma).toBe(true);
    for (const ma of MA_BAO_CAO) expect(BO_XUAT[ma]!.tieuDeLaKhoa, ma).toBe(false);
  });

  it("năm màn báo cáo đều mặc định CHỈ quản trị tối cao, và khai quyền đọc", () => {
    for (const ma of MA_BAO_CAO) {
      const m = timManXuat(ma);
      expect(m, ma).toBeDefined();
      expect(m!.vaiMacDinh, ma).toEqual([]);
      expect(m!.quyenGoc, `${ma} phải khai quyenGoc`).toBeTruthy();
    }
  });

  it("năm nút báo cáo đều được cắm vào màn tương ứng", () => {
    // `NutXuat` tự gác nên không cần prop, nhưng nếu không ai CẮM nó thì đường xuất thành vô
    // hình — đúng loại hỏng mà không test nào khác bắt được.
    const cap: [string, string][] = [
      ["app/(admin)/admin/cong-no/page.tsx", "cong-no"],
      ["app/(admin)/admin/enrollments/page.tsx", "ghi-danh"],
      ["app/(admin)/admin/users/page.tsx", "tai-khoan"],
      ["app/(admin)/admin/roles/page.tsx", "quyen-vai"],
      ["app/(admin)/admin/sessions/page.tsx", "buoi-hoc"],
    ];
    for (const [p, ma] of cap) {
      expect(
        new RegExp(`<NutXuat ma="${ma}" />`).test(doc(p)),
        `${p} chưa cắm <NutXuat ma="${ma}" />`,
      ).toBe(true);
    }
  });

  it("bảy nút nhập-lại-được cũng đều được cắm", () => {
    const cap: [string, string][] = [
      ["app/(admin)/admin/centers/page.tsx", "co-so"],
      ["app/(admin)/admin/rooms/page.tsx", "phong-hoc"],
      ["app/(admin)/admin/holidays/page.tsx", "lich-nghi"],
      ["app/(admin)/admin/inventory/items/page.tsx", "hoc-cu"],
      ["app/(admin)/admin/questions/page.tsx", "cau-hoi"],
      ["app/(admin)/admin/students/page.tsx", "hoc-vien"],
      ["app/(admin)/admin/lop-trial/page.tsx", "lop-trial"],
    ];
    for (const [p, ma] of cap) {
      expect(new RegExp(`<NutXuat ma="${ma}" />`).test(doc(p)), `${p} thiếu nút "${ma}"`).toBe(true);
    }
  });
});
