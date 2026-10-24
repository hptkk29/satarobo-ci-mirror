/**
 * TS-12 (phần THUẦN) — US-11: hồ sơ nhân sự → Vị trí + Phân công.
 *
 * Thứ đáng test ở đây KHÔNG phải "có ghi được vào DB không" mà là **luật không đoán**:
 * ai vào danh sách chờ xử lý tay, ai không, và vì sao. Đó là logic thuần, nên test thuần.
 */
import { describe, it, expect } from "vitest";
import {
  chuanHoaChucDanh,
  inBanDoiChieu,
  khoaViTri,
  lapKeHoach,
  type HoSoNhanSu,
} from "@/lib/org/position-backfill";

const NGAY_CHAY = new Date("2026-08-11T00:00:00.000Z");
const ORG = new Set(["cs1", "cs2", "dt"]);
const CENTER_TO_ORG = new Map([
  ["co-so-nguyen-huu-tho", "cs1"],
  ["co-so-hoang-dieu", "cs2"],
]);

function ns(over: Partial<HoSoNhanSu> & { employeeCode: string }): HoSoNhanSu {
  return {
    id: `id-${over.employeeCode}`,
    fullName: `Người ${over.employeeCode}`,
    jobTitle: "Giáo viên",
    orgUnitId: "cs1",
    centerId: null,
    joinedAt: new Date("2025-03-01T00:00:00.000Z"),
    userId: `u-${over.employeeCode}`,
    taiKhoanOrgUnitId: null,
    ...over,
  };
}

const lap = (
  nhanSu: HoSoNhanSu[],
  extra: Partial<Parameters<typeof lapKeHoach>[0]> = {},
) =>
  lapKeHoach({
    nhanSu,
    orgUnitIds: ORG,
    centerToOrg: CENTER_TO_ORG,
    ngayChay: NGAY_CHAY,
    ...extra,
  });

describe("[US-11] lapKeHoach — đường thuận", () => {
  it("hai người CÙNG chức danh + CÙNG đơn vị ⇒ MỘT vị trí, hai phân công", () => {
    const kh = lap([ns({ employeeCode: "A1" }), ns({ employeeCode: "A2" })]);
    expect(kh.viTri).toHaveLength(1);
    expect(kh.viTri[0].nguoiGiu).toEqual(["A1", "A2"]);
    expect(kh.phanCong).toHaveLength(2);
    expect(kh.choXuLyTay).toEqual([]);
  });

  it("cùng chức danh nhưng KHÁC đơn vị ⇒ HAI vị trí (vị trí thuộc về đơn vị)", () => {
    const kh = lap([
      ns({ employeeCode: "A1", orgUnitId: "cs1" }),
      ns({ employeeCode: "A2", orgUnitId: "cs2" }),
    ]);
    expect(kh.viTri).toHaveLength(2);
  });

  it("chức danh lệch khoảng trắng/hoa-thường ⇒ vẫn là MỘT vị trí", () => {
    const kh = lap([
      ns({ employeeCode: "A1", jobTitle: "Giáo viên" }),
      ns({ employeeCode: "A2", jobTitle: "  giáo   VIÊN " }),
    ]);
    expect(kh.viTri).toHaveLength(1);
    // Tên hiển thị lấy bản gặp TRƯỚC (đã sắp theo mã NS) — không phải bản viết hoa lung tung.
    expect(kh.viTri[0].title).toBe("Giáo viên");
  });

  it("hồ sơ chỉ có centerId ⇒ bắc cầu sang OrgUnit, KHÔNG vào danh sách chờ", () => {
    const kh = lap([
      ns({ employeeCode: "A1", orgUnitId: null, centerId: "co-so-hoang-dieu" }),
    ]);
    expect(kh.choXuLyTay).toEqual([]);
    expect(kh.viTri[0].orgUnitId).toBe("cs2");
  });

  it("bản kế hoạch ỔN ĐỊNH giữa hai lần chạy (người duyệt so được hai bản)", () => {
    const a = lap([ns({ employeeCode: "B2" }), ns({ employeeCode: "A1" })]);
    const b = lap([ns({ employeeCode: "A1" }), ns({ employeeCode: "B2" })]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("[US-11 AC3] KHÔNG ĐOÁN — ai rơi vào danh sách chờ xử lý tay", () => {
  it("không cơ sở, không đơn vị ⇒ chờ tay, và KHÔNG bị nhét vào đơn vị nào", () => {
    const kh = lap([
      ns({ employeeCode: "A1", orgUnitId: null, centerId: null }),
    ]);
    expect(kh.choXuLyTay).toHaveLength(1);
    expect(kh.choXuLyTay[0].lyDo).toBe("THIEU_DON_VI");
    expect(kh.viTri).toEqual([]);
    expect(kh.phanCong).toEqual([]);
  });

  it("centerId không ánh xạ được ⇒ chờ tay, nêu ĐÚNG mã center không khớp", () => {
    const kh = lap([
      ns({ employeeCode: "A1", orgUnitId: null, centerId: "co-so-la" }),
    ]);
    expect(kh.choXuLyTay[0].lyDo).toBe("THIEU_DON_VI");
    expect(kh.choXuLyTay[0].chiTiet).toContain("co-so-la");
  });

  it("orgUnitId trỏ đơn vị đã xoá ⇒ chờ tay (KHÁC với thiếu đơn vị — lý do riêng)", () => {
    const kh = lap([ns({ employeeCode: "A1", orgUnitId: "da-xoa" })]);
    expect(kh.choXuLyTay[0].lyDo).toBe("DON_VI_KHONG_TON_TAI");
  });

  it("chức danh rỗng / chỉ khoảng trắng ⇒ chờ tay, không lấy phòng ban làm tên vị trí", () => {
    for (const jobTitle of ["", "   ", null]) {
      const kh = lap([ns({ employeeCode: "A1", jobTitle })]);
      expect(kh.choXuLyTay[0].lyDo).toBe("THIEU_CHUC_DANH");
      expect(kh.viTri).toEqual([]);
    }
  });

  it("chưa có tài khoản ⇒ VỊ TRÍ vẫn tạo, PHÂN CÔNG thì không (không có ai để gán)", () => {
    const kh = lap([ns({ employeeCode: "A1", userId: null })]);
    expect(kh.viTri).toHaveLength(1);
    expect(kh.phanCong).toEqual([]);
    expect(kh.choXuLyTay[0].lyDo).toBe("THIEU_TAI_KHOAN");
  });
});

describe("[US-11] ngày hiệu lực", () => {
  it("joinedAt hợp lệ ⇒ dùng đúng ngày đó", () => {
    const kh = lap([
      ns({
        employeeCode: "A1",
        joinedAt: new Date("2025-03-01T00:00:00.000Z"),
      }),
    ]);
    expect(kh.phanCong[0].effectiveFrom.toISOString().slice(0, 10)).toBe(
      "2025-03-01",
    );
    expect(kh.phanCong[0].ngayVaoLamKhongDungDuoc).toBe(false);
  });

  it("joinedAt = epoch 1970 (rác import cũ) ⇒ lấy ngày chạy VÀ đánh cờ để bản đối chiếu nói ra", () => {
    // Dữ liệu thật có hồ sơ mang 1970-01-01. Ghi thẳng vào sổ tổ chức là bịa một sự thật.
    const kh = lap([
      ns({
        employeeCode: "A1",
        joinedAt: new Date("1970-01-01T00:00:00.000Z"),
      }),
    ]);
    expect(kh.phanCong[0].effectiveFrom).toEqual(NGAY_CHAY);
    expect(kh.phanCong[0].ngayVaoLamKhongDungDuoc).toBe(true);
  });

  it("joinedAt trống hoặc ở TƯƠNG LAI ⇒ cũng lấy ngày chạy", () => {
    for (const joinedAt of [null, new Date("2030-01-01T00:00:00.000Z")]) {
      const kh = lap([ns({ employeeCode: "A1", joinedAt })]);
      expect(kh.phanCong[0].effectiveFrom).toEqual(NGAY_CHAY);
      expect(kh.phanCong[0].ngayVaoLamKhongDungDuoc).toBe(true);
    }
  });
});

describe("[US-11] bộ vai — backfill KHÔNG được tự phát quyền", () => {
  const vaiDangGiu = [
    {
      userId: "u-A1",
      orgUnitId: "cs1",
      roleId: "r-teacher",
      roleCode: "TEACHER",
    },
    // Vai ở đơn vị KHÁC — không được kéo theo.
    {
      userId: "u-A1",
      orgUnitId: "cs2",
      roleId: "r-cm",
      roleCode: "CENTER_MANAGER",
    },
  ];

  it("mặc định: vị trí KHÔNG mang vai nào", () => {
    const kh = lap([ns({ employeeCode: "A1" })], { vaiDangGiu });
    expect(kh.viTri[0].roleIds).toEqual([]);
  });

  it("--gan-vai: chỉ lấy vai người đó ĐANG giữ TẠI CHÍNH đơn vị đó (giao, không phải hợp)", () => {
    const kh = lap([ns({ employeeCode: "A1", orgUnitId: "cs1" })], {
      vaiDangGiu,
      ganVai: true,
    });
    expect(kh.viTri[0].roleIds).toEqual(["r-teacher"]);
  });

  it("--gan-vai: hai người cùng vị trí ⇒ bộ vai là HỢP của họ, không nhân bản", () => {
    const kh = lap([ns({ employeeCode: "A1" }), ns({ employeeCode: "A2" })], {
      ganVai: true,
      vaiDangGiu: [
        {
          userId: "u-A1",
          orgUnitId: "cs1",
          roleId: "r-teacher",
          roleCode: "TEACHER",
        },
        {
          userId: "u-A2",
          orgUnitId: "cs1",
          roleId: "r-teacher",
          roleCode: "TEACHER",
        },
        {
          userId: "u-A2",
          orgUnitId: "cs1",
          roleId: "r-train",
          roleCode: "TRAINING",
        },
      ],
    });
    expect(kh.viTri[0].roleIds.sort()).toEqual(["r-teacher", "r-train"]);
  });
});

describe("[US-11 AC2] bản đối chiếu — duyệt được bằng mắt", () => {
  const kh = lap([
    ns({ employeeCode: "A1" }),
    ns({ employeeCode: "A2", orgUnitId: null, centerId: null }),
    ns({ employeeCode: "A3", joinedAt: new Date("1970-01-01T00:00:00.000Z") }),
  ]);
  const md = inBanDoiChieu(kh, {
    tenDonVi: new Map([["cs1", "CS1 · Cơ sở 1"]]),
    ganVai: false,
  });

  it("liệt kê TỪNG NGƯỜI, không chỉ số tổng", () => {
    expect(md).toContain("A1");
    expect(md).toContain("A2");
    expect(md).toContain("A3");
    expect(md).toContain("CS1 · Cơ sở 1");
  });

  it("người thiếu dữ liệu nằm ở mục riêng, kèm lý do", () => {
    expect(md).toContain("Chờ xử lý tay");
    expect(md).toContain("Thiếu đơn vị");
  });

  it("cảnh báo ngày vào làm không dùng được hiện ra ngay trên dòng đó", () => {
    const dong = md.split("\n").find((l) => l.startsWith("| A3 "));
    expect(dong).toContain("⚠️");
  });

  it("nói rõ có gắn vai hay không — người duyệt phải biết bản này có phát quyền không", () => {
    expect(md).toContain("**KHÔNG gắn**");
    expect(inBanDoiChieu(kh, { tenDonVi: new Map(), ganVai: true })).toContain(
      "**CÓ gắn**",
    );
  });
});

describe("[US-11] tiện ích", () => {
  it("chuanHoaChucDanh gộp khoảng trắng + trim", () => {
    expect(chuanHoaChucDanh("  Giáo   viên \n robot ")).toBe("Giáo viên robot");
    expect(chuanHoaChucDanh(null)).toBe("");
  });

  it("khoaViTri không phân biệt hoa/thường", () => {
    expect(khoaViTri("cs1", "Giáo Viên")).toBe(khoaViTri("cs1", "giáo viên"));
  });
});

describe("[US-11] hồ sơ ≠ tài khoản — nói ra chỗ lệch, không tự chọn hộ", () => {
  it("thiếu đơn vị ở hồ sơ nhưng TÀI KHOẢN có ⇒ vẫn chờ tay, và CHỈ ĐƯỜNG tới chỗ sửa", () => {
    // Ca thật đo 11/08/2026: người vận hành gán cơ sở ở màn TÀI KHOẢN, còn script đọc
    // HỒ SƠ NHÂN SỰ ⇒ tưởng script hỏng. Bản đối chiếu phải nói thẳng ra.
    const kh = lap([
      ns({
        employeeCode: "A1",
        orgUnitId: null,
        centerId: null,
        taiKhoanOrgUnitId: "cs2",
      }),
    ]);
    expect(kh.choXuLyTay[0].lyDo).toBe("THIEU_DON_VI");
    expect(kh.choXuLyTay[0].chiTiet).toContain("TÀI KHOẢN");
    expect(kh.choXuLyTay[0].chiTiet).toContain("cs2");
    // và KHÔNG tự lấy đơn vị của tài khoản làm vị trí.
    expect(kh.viTri).toEqual([]);
  });

  it("hồ sơ và tài khoản trỏ HAI đơn vị khác nhau ⇒ vẫn backfill theo hồ sơ, nhưng báo lệch", () => {
    const kh = lap([
      ns({ employeeCode: "A1", orgUnitId: "cs1", taiKhoanOrgUnitId: "cs2" }),
    ]);
    expect(kh.viTri[0].orgUnitId).toBe("cs1");
    expect(kh.lechDonVi).toEqual([
      {
        employeeCode: "A1",
        fullName: "Người A1",
        donViHoSo: "cs1",
        donViTaiKhoan: "cs2",
      },
    ]);
  });

  it("hai bên KHỚP nhau ⇒ không báo lệch (đừng kêu sói)", () => {
    const kh = lap([
      ns({ employeeCode: "A1", orgUnitId: "cs1", taiKhoanOrgUnitId: "cs1" }),
    ]);
    expect(kh.lechDonVi).toEqual([]);
  });

  it("bản đối chiếu có mục 4 và đổi id đơn vị thành tên đọc được", () => {
    const kh = lap([
      ns({ employeeCode: "A1", orgUnitId: "cs1", taiKhoanOrgUnitId: "cs2" }),
      ns({
        employeeCode: "A2",
        orgUnitId: null,
        centerId: null,
        taiKhoanOrgUnitId: "cs2",
      }),
    ]);
    const md = inBanDoiChieu(kh, {
      tenDonVi: new Map([
        ["cs1", "CS1 · Cơ sở 1"],
        ["cs2", "CS2 · Cơ sở 2"],
      ]),
      ganVai: false,
    });
    expect(md).toContain("## 4.");
    expect(md).toContain("| A1 | Người A1 | CS1 · Cơ sở 1 | CS2 · Cơ sở 2 |");
    // Dòng chờ tay cũng phải hiện TÊN, không hiện id thô.
    const dongChoTay = md.split("\n").find((l) => l.startsWith("| A2 "));
    expect(dongChoTay).toContain("CS2 · Cơ sở 2");
    expect(dongChoTay).not.toContain('"cs2"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [vá 12/08] NHÂN SỰ HỘI SỞ — đơn vị nằm ở `EmployeeOrgAssignment`, không ở Employee
//
// Chạy dry-run trên PROD 12/08: 8/14 nhân sự vào "chờ xử lý tay" vì thiếu đơn vị —
// gồm TGĐ, Trưởng phòng Marketing, Trưởng phòng Công nghệ, Kế toán tổng hợp và 4
// giáo viên parttime. Đo lại thì CẢ TÁM đều có `EmployeeOrgAssignment` PRIMARY tại
// HO. Tức dữ liệu KHÔNG thiếu — script bỏ sót một nguồn hợp lệ.
//
// VÌ SAO DỮ LIỆU NẰM Ở ĐÓ. Luật V7 cấm đơn vị HO mang `centerId`, nên form nhân sự
// cố ý set `Employee.centerId = null` cho người Hội sở rồi tạo dòng assignment neo
// vào OrgUnit HO (`syncHoAssignment` — app/(admin)/admin/nhan-su/actions.ts:63).
// Đây là đường ghi CHÍNH THỨC của repo, không phải dữ liệu rác.
//
// ⚠️ Đây KHÔNG phải nới lỏng luật "không đoán" (AC3): assignment là một khai báo
// TƯỜNG MINH do người dùng tạo qua form, khác hẳn việc suy đơn vị từ tài khoản
// (`taiKhoanOrgUnitId` vẫn CHỈ để hiển thị, tuyệt đối không dùng để suy).
describe("[vá 12/08] đơn vị từ EmployeeOrgAssignment (nhân sự Hội sở)", () => {
  it("hồ sơ trống nhưng có assignment PRIMARY ⇒ dùng đơn vị đó, KHÔNG vào chờ tay", () => {
    const kh = lap([
      ns({
        employeeCode: "HO1",
        jobTitle: "Tổng Giám đốc",
        orgUnitId: null,
        centerId: null,
        donViPhanCong: "dt",
      }),
    ]);
    expect(kh.choXuLyTay).toEqual([]);
    expect(kh.phanCong).toHaveLength(1);
    expect(kh.viTri[0].orgUnitId).toBe("dt");
  });

  it("hồ sơ CÓ đơn vị thì hồ sơ THẮNG — assignment không ghi đè", () => {
    // Employee là nguồn chính (AC1 "đọc bảng nhân sự"); assignment chỉ lấp chỗ trống.
    const kh = lap([
      ns({ employeeCode: "A1", orgUnitId: "cs1", donViPhanCong: "cs2" }),
    ]);
    expect(kh.viTri[0].orgUnitId).toBe("cs1");
  });

  it("assignment trỏ đơn vị đã xoá ⇒ chờ tay với lý do RIÊNG, KHÔNG bịa", () => {
    // `DON_VI_KHONG_TON_TAI` chứ không phải `THIEU_DON_VI`: hai ca cần hai cách xử
    // lý khác nhau — "chưa khai đơn vị" thì điền vào, còn "khai vào đơn vị đã xoá"
    // thì phải chọn đơn vị khác. Gộp một lý do là bắt người vận hành tự đoán.
    const kh = lap([
      ns({
        employeeCode: "A1",
        orgUnitId: null,
        centerId: null,
        donViPhanCong: "da-xoa",
      }),
    ]);
    expect(kh.choXuLyTay[0].lyDo).toBe("DON_VI_KHONG_TON_TAI");
  });

  it("không hồ sơ, không assignment ⇒ vẫn chờ tay như cũ", () => {
    const kh = lap([
      ns({ employeeCode: "A1", orgUnitId: null, centerId: null }),
    ]);
    expect(kh.choXuLyTay[0].lyDo).toBe("THIEU_DON_VI");
  });
});
