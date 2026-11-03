/**
 * lib/export/nhap-lai.test.ts — bảy tệp xuất PHẢI nhập lại được.
 *
 * Lưới chính ở đây so khoá cột của tệp xuất với `columnHints` ĐỌC THẲNG TỪ MÃ NGUỒN màn
 * nhập. Vì sao không assert một danh sách gõ tay: gõ tay là bản sao thứ hai của cùng một
 * sự thật, và khi màn nhập đổi cột thì bản sao đó vẫn xanh — đúng lúc tệp xuất thành vô
 * dụng. Đọc từ nguồn thì đổi một bên là đỏ ngay.
 *
 * Hỏng ở đây không ném lỗi và không làm tệp sai: tệp vẫn mở được, vẫn đủ dữ liệu. Nó chỉ
 * không nhập lại được — mà đó chính là lý do người ta bấm xuất.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAN_XUAT, timManXuat } from "./danh-muc-xuat";
import { BO_NAP, MA_NHAP_LAI, ngayNhapLai, gopTag, co } from "./nhap-lai";

/** Mã màn xuất → màn nhập tương ứng. Thêm một cặp là thêm một dòng ở đây. */
const CAP: Record<string, string> = {
  "co-so": "app/(admin)/admin/centers/import/page.tsx",
  "phong-hoc": "app/(admin)/admin/rooms/import/page.tsx",
  "lich-nghi": "app/(admin)/admin/holidays/import/page.tsx",
  "hoc-cu": "app/(admin)/admin/inventory/items/import/page.tsx",
  "cau-hoi": "app/(admin)/admin/questions/import/page.tsx",
  "hoc-vien": "app/(admin)/admin/students/import/page.tsx",
  "lop-trial": "app/(admin)/admin/lop-trial/import/page.tsx",
};

/**
 * Khoá cột mà màn nhập chờ, đọc từ `columnHints` trong mã nguồn.
 *
 * Neo HẸP (`columnHints={[` … `]}`) và khẳng định tìm được ít nhất 4 khoá: một regex hỏng
 * trả về mảng rỗng, và `expect([]).toEqual([])` thì xanh vĩnh viễn trong khi chẳng kiểm gì —
 * đúng cái bẫy luật 11 nói.
 */
function khoaManNhap(duong: string): string[] {
  const src = readFileSync(resolve(process.cwd(), duong), "utf8");
  const m = /columnHints=\{\[([\s\S]*?)\]\}/.exec(src);
  if (!m) throw new Error(`${duong}: không tìm được columnHints`);
  const khoa = [...m[1]!.matchAll(/\bkey:\s*"([^"]+)"/g)].map((x) => x[1]!);
  if (khoa.length < 4) throw new Error(`${duong}: chỉ đọc được ${khoa.length} khoá — regex hỏng?`);
  return khoa;
}

/**
 * Khoá cột của tệp xuất — lấy bằng cách GỌI THẬT hàm nạp với một `sdb` giả.
 *
 * Bản đầu của lưới này đọc mã nguồn bằng regex, và nó SAI: 8 khoá lựa chọn của ngân hàng câu
 * hỏi sinh bằng template string (`` `choice${n}` ``), nên regex trả về đúng chuỗi
 * `"choice${n}"` — hai ca đỏ, và nếu vô tình khớp thì sẽ xanh giả mãi. Gọi thật thì đọc được
 * cột NHƯ NÓ RA TRONG TỆP, và không phải đoán gì về cú pháp.
 *
 * Gọi được vì `nhap-lai.ts` chỉ có `import type` — không kéo Prisma hay DB vào lúc chạy.
 */
const sdbGia = new Proxy(
  {},
  {
    get: () => ({ findMany: async () => [] as never[] }),
  },
) as never;

const actorGia = {
  isSuperAdmin: true,
  isHoLevel: true,
  visibleCenterIds: [] as string[],
} as never;

async function khoaTepXuat(ma: string): Promise<string[]> {
  const { cot } = await BO_NAP[ma]!(sdbGia, actorGia);
  return cot.map((x) => x.khoa);
}

describe("[NL] tệp xuất phải nhập lại được", () => {
  it("bảy mã đều có trong `BO_NAP`, trong danh mục, và có màn nhập ghép cặp", () => {
    expect(MA_NHAP_LAI.sort()).toEqual(Object.keys(CAP).sort());
    for (const ma of MA_NHAP_LAI) expect(timManXuat(ma), ma).toBeDefined();
  });

  for (const [ma, duong] of Object.entries(CAP)) {
    it(`[${ma}] khoá cột KHỚP KHÍT columnHints của màn nhập`, async () => {
      const chờ = khoaManNhap(duong);
      const có = await khoaTepXuat(ma);

      // So theo TẬP HỢP: thứ tự cột không ảnh hưởng việc nhập lại, thiếu/thừa khoá thì có.
      const thieu = chờ.filter((k) => !có.includes(k));
      const thua = có.filter((k) => !chờ.includes(k));
      expect(thieu, `${ma}: tệp xuất THIẾU cột màn nhập cần`).toEqual([]);
      expect(thua, `${ma}: tệp xuất có cột màn nhập KHÔNG hiểu`).toEqual([]);
    });
  }

  it("[cau-hoi] sinh đủ 8 khoá lựa chọn A–D", async () => {
    // Canh riêng vì 8 cột này là nơi ĐÁP ÁN ĐÚNG nằm, và chúng sinh bằng vòng lặp.
    const có = await khoaTepXuat("cau-hoi");
    for (const n of [1, 2, 3, 4]) {
      expect(có, `choice${n}`).toContain(`choice${n}`);
      expect(có, `choice${n}_correct`).toContain(`choice${n}_correct`);
    }
  });

  it("🔒 KHÔNG xuất CCCD phụ huynh trong tệp học viên", async () => {
    // Màn nhập cũng không nhận cột này. Cùng luật với hồ sơ nhân sự: tệp rời khỏi hệ thống.
    const có = await khoaTepXuat("hoc-vien");
    expect(có.some((k) => /nationalId|cccd|cmnd/i.test(k))).toBe(false);
  });

  it("bảy màn mới đều mặc định CHỈ quản trị tối cao", () => {
    // Đường xuất MỚI thì không có hành vi cũ nào để giữ, và tệp nhập-lại-được là tệp sửa
    // hàng loạt được ⇒ giao cho ai phải là quyết định có chủ đích.
    for (const ma of MA_NHAP_LAI) expect(timManXuat(ma)!.vaiMacDinh, ma).toEqual([]);
  });

  it("mỗi màn mới khai quyền đọc, và quyền đó có thật trong ma trận tĩnh", () => {
    const perm = readFileSync(resolve(process.cwd(), "lib/auth/permissions.ts"), "utf8");
    for (const ma of MA_NHAP_LAI) {
      const q = timManXuat(ma)!.quyenGoc;
      expect(q, `${ma} phải khai quyenGoc`).toBeTruthy();
      expect(perm.includes(`"${q}"`), `${ma}: quyền "${q}" không có trong permissions.ts`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[NL] định dạng ô phải đúng thứ màn nhập đọc lại được", () => {
  it("ngày in dd/mm/yyyy và ĐỌC THEO UTC (cột @db.Date là nửa đêm ngày VN)", () => {
    // Cộng 7 giờ ở đây sẽ đẩy 01/09 thành 02/09 — lệch một ngày, loại bug im lặng nhất.
    expect(ngayNhapLai(new Date("2026-09-01T00:00:00Z"))).toBe("01/09/2026");
    expect(ngayNhapLai(new Date("2026-12-31T00:00:00Z"))).toBe("31/12/2026");
    expect(ngayNhapLai(null)).toBe("");
    expect(ngayNhapLai(undefined)).toBe("");
  });

  it("danh sách gộp bằng dấu phẩy + cách — đúng dạng màn nhập tách lại", () => {
    expect(gopTag(["Robot", "Cảm biến"])).toBe("Robot, Cảm biến");
    expect(gopTag([])).toBe("");
    expect(gopTag(null)).toBe("");
  });

  it("boolean in TRUE/FALSE", () => {
    expect(co(true)).toBe("TRUE");
    expect(co(false)).toBe("FALSE");
    expect(co(null)).toBe("FALSE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[NL] route dùng chung", () => {
  const src = readFileSync(resolve(process.cwd(), "app/api/admin/xuat/[ma]/route.ts"), "utf8");

  it("gác bằng `chanXuat` với mã lấy từ đường dẫn", () => {
    expect(/const chan = await chanXuat\(ma, session\)/.test(src)).toBe(true);
  });

  it("mã lạ trả 404 chứ không 403", () => {
    // Hai câu trả lời cho hai vấn đề khác nhau. 403 cho mã sai là để người sửa đi xin quyền
    // cho một đường không tồn tại.
    //
    // ⚠️ Neo HAI mảnh rời thay vì một câu dài: bản trước neo nguyên cả dòng
    // `if (!nap || !man) return NextResponse.json({...}, { status: 404 })`, và nó ĐỎ ngay lượt
    // đổi `nap` thành `spec` — một đổi tên biến vô hại. Lưới vỡ vì cách viết, không vì hành vi
    // sai, là lưới sẽ bị ai đó gỡ đi. Neo cái KHÔNG đổi theo tên biến: có nhánh "không tìm
    // được spec" và nó trả 404.
    expect(/if \(!spec \|\| !man\)/.test(src)).toBe(true);
    expect(/status: 404/.test(src)).toBe(true);
    // Và KHÔNG được trả 403 ở nhánh đó.
    expect(/!man\) return NextResponse\.json\([^)]*403/.test(src)).toBe(false);
  });

  it("dòng tiêu đề chọn theo CỜ, không cứng một kiểu", () => {
    // `ExcelImporter` đọc cột theo khoá, nên tệp nhập-lại-được phải in khoá; tệp báo cáo thì
    // phải in nhãn tiếng Việt. Route phân nhánh bằng `spec.tieuDeLaKhoa`.
    //
    // Giá trị của cờ cho từng mã được khẳng định ở `quyen-xuat.test.ts` (`🔒 CỜ tieuDeLaKhoa
    // đúng cho từng họ tệp`) — đó là khẳng định HÀNH VI, còn ca này chỉ canh route có đọc cờ.
    expect(/spec\.tieuDeLaKhoa \? x\.khoa : x\.nhan/.test(src)).toBe(true);
    // Sheet chú giải chỉ dựng cho tệp nhập-lại-được.
    expect(/chuGiai: spec\.tieuDeLaKhoa \?/.test(src)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[NL] danh mục sau khi thêm bảy màn", () => {
  it("mã không trùng nhau, và danh mục không rỗng", () => {
    // ⚠️ KHÔNG khẳng định con số tổng nữa. Bản trước ghi `toBe(21)` và nó đỏ ngay lượt thêm
    // năm màn báo cáo — một ca đỏ mà chẳng chỉ ra lỗi nào, chỉ buộc người thêm màn phải sửa
    // một con số. Thứ đáng canh là KHÔNG TRÙNG MÃ (trùng là hai màn dùng chung một dòng
    // cấu hình quyền), không phải đếm đủ.
    expect(MAN_XUAT.length).toBeGreaterThanOrEqual(21);
    expect(new Set(MAN_XUAT.map((x) => x.ma)).size).toBe(MAN_XUAT.length);
  });

  it("mọi màn nhập-lại-được đều nói rõ trong `noiDung` là nhập lại được", () => {
    // Người vận hành không đoán ra điều đó từ tên màn, và đây là giá trị chính của bảy tệp.
    for (const ma of MA_NHAP_LAI) {
      const m = timManXuat(ma)!;
      expect(m.noiDung.some((d) => /nhập lại được/i.test(d)), ma).toBe(true);
    }
  });
});
