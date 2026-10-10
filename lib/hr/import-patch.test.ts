import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { ANH_XA_COT, cotCoMat, dungPatchNhanSu } from "./import-patch";

const GOC = join(__dirname, "..", "..");
const doc = (p: string) => readFileSync(join(GOC, p), "utf8");

/** Hồ sơ ĐỦ DỮ LIỆU đã chuẩn hoá — giống `base` mà route dựng. */
const DAY_DU = {
  fullName: "Nguyễn Văn A",
  jobTitle: "Giáo viên",
  department: "DAO_TAO",
  status: "RESIGNED",
  isActive: false,
  phone: "0900000000",
  email: "a@x.test",
  dateOfBirth: new Date("1995-05-05T00:00:00Z"),
  gender: "MALE",
  nationalId: "0123",
  contractType: "FULL_TIME",
  centerId: "cs1",
  orgUnitId: "ou-cs1",
  managerId: "mgr",
  joinedAt: new Date("2024-01-02T00:00:00Z"),
  endDate: null,
  address: "Đà Nẵng",
  subjects: ["Robotics"],
  certifications: ["ABC"],
  bio: "…",
  emergencyContact: "0911111111",
  notes: "ghi chú",
} as const;

describe("dungPatchNhanSu — cột không có trong file thì KHÔNG ĐỤNG TỚI", () => {
  // ⚠️ CA BẮT BUỘC 1: file chỉ có employeeCode + centerSlug, hồ sơ đích đủ dữ liệu.
  it("file 2 cột (employeeCode + centerSlug) chỉ ghi cơ sở, mọi trường khác GIỮ NGUYÊN", () => {
    const patch = dungPatchNhanSu(
      DAY_DU,
      new Set(["employeeCode", "centerSlug"]),
    );
    expect(patch).toEqual({ centerId: "cs1", orgUnitId: "ou-cs1" });

    // Nói thẳng từng thứ đã suýt bị xoá, để lần đọc sau thấy được cái giá.
    for (const k of [
      "phone",
      "email",
      "dateOfBirth",
      "joinedAt",
      "endDate",
      "nationalId",
      "address",
      "bio",
      "notes",
      "emergencyContact",
      "gender",
      "contractType",
      "subjects",
      "certifications",
      "managerId",
      "fullName",
      "jobTitle",
      "department",
    ]) {
      expect(Object.hasOwn(patch, k), `${k} KHÔNG được nằm trong patch`).toBe(
        false,
      );
    }
  });

  // ⚠️ CA BẮT BUỘC 2: hồ sơ đã nghỉ + file thiếu cột status ⇒ vẫn nghỉ.
  it("hồ sơ RESIGNED + file THIẾU cột status ⇒ status và isActive không bị đụng", () => {
    const patch = dungPatchNhanSu(
      DAY_DU,
      new Set(["employeeCode", "centerSlug"]),
    );
    expect(Object.hasOwn(patch, "status")).toBe(false);
    expect(Object.hasOwn(patch, "isActive")).toBe(false);
  });

  it("có cột status thì MỚI ghi status, và isActive đi kèm", () => {
    const patch = dungPatchNhanSu(DAY_DU, new Set(["status"]));
    expect(patch).toEqual({ status: "RESIGNED", isActive: false });
  });

  it("isActive KHÔNG bao giờ tự đi một mình — nó suy từ status", () => {
    // Không có cột `isActive` trong file; nó chỉ tới cùng `status`.
    expect(
      Object.values(ANH_XA_COT)
        .flat()
        .filter((t) => t === "isActive"),
    ).toEqual(["isActive"]);
    expect(ANH_XA_COT.status).toContain("isActive");
    expect(Object.hasOwn(ANH_XA_COT, "isActive")).toBe(false);
  });

  it("centerSlug kéo theo CẢ orgUnitId (ghi kép 2 pha)", () => {
    expect(dungPatchNhanSu(DAY_DU, new Set(["centerSlug"]))).toEqual({
      centerId: "cs1",
      orgUnitId: "ou-cs1",
    });
  });

  it("file không có cột nào ghi được ⇒ patch RỖNG (caller phải bỏ qua, đừng gọi update)", () => {
    // `update` với data rỗng vẫn đụng `updatedAt`, làm hỏng chính phép truy vết
    // "sửa mà không có audit" đã dùng để điều tra endpoint này.
    expect(dungPatchNhanSu(DAY_DU, new Set(["employeeCode"]))).toEqual({});
  });
});

describe("route nhập nhân sự cắm đúng luật", () => {
  const F = "app/api/admin/import/employees/route.ts";

  it("đường CẬP NHẬT dùng patch, KHÔNG ghi trọn `base`", () => {
    const src = doc(F);
    expect(src).toContain("dungPatchNhanSu(");
    expect(src).not.toContain("update: base");
  });

  it("patch rỗng thì KHÔNG gọi update", () => {
    expect(doc(F)).toContain("Object.keys(patch).length > 0");
  });

  it('`.default("ACTIVE")` KHÔNG còn ở schema — mặc định chuyển xuống nhánh TẠO MỚI', () => {
    const src = doc(F);
    // Ở schema, mặc định này áp cho CẢ đường cập nhật ⇒ im lặng cho người đã nghỉ đi
    // làm lại. Ở nhánh tạo mới thì nó hợp lý.
    expect(src).not.toContain('EmploymentStatusEnum.default("ACTIVE")');
    expect(src).toContain('base.status ?? "ACTIVE"');
  });

  it("tạo mới vẫn ĐÒI ĐỦ ba trường bắt buộc", () => {
    const src = doc(F);
    expect(src).toContain("Tạo mới nhân sự");
    for (const k of ["fullName", "jobTitle", "department"])
      expect(src).toContain(`base.${k}`);
  });
});

// ── Việc 8 (08/09/2026): lượt nhập phải để lại DẤU ────────────────────────────
//
// Kết quả đo tự nói ra vấn đề lớn hơn bản vá: một endpoint ghi HÀNG LOẠT mà không có
// dòng audit nào, trong khi đường sửa từng người ghi 9 chỗ. Nên câu "prod sạch" chỉ là
// "không thấy dấu", không phải "không xảy ra".
describe("nhập nhân sự ghi AuditLog", () => {
  const F = "app/api/admin/import/employees/route.ts";

  it("có audit cho CẢ cập nhật lẫn tạo mới", () => {
    const src = doc(F);
    expect(src).toContain("IMPORT_UPDATE");
    expect(src).toContain("IMPORT_CREATE");
  });

  it("audit nằm TRONG transaction — ghi ngoài là audit sống sót khi ghi hỏng", () => {
    expect(doc(F)).toContain(
      "tx: tx as unknown as Parameters<typeof writeAudit>[0]",
    );
  });

  it("KHÔNG ghi audit cho hồ sơ không đổi gì", () => {
    const src = doc(F);
    // Hai cổng: patch rỗng thì không vào nhánh ghi; và trong nhánh ghi, chỉ ghi khi có
    // trường THỰC SỰ đổi. Nhập lại cùng một file không được đẻ audit rỗng.
    expect(src).toContain("Object.keys(patch).length > 0");
    expect(src).toContain("Object.keys(moi).length > 0");
  });

  it("audit chỉ mang đúng tập trường mà import được phép ghi", () => {
    // Ảnh before đọc theo `IMPORT_AUDIT_SELECT` dựng TỪ `ANH_XA_COT`, nên không có
    // đường nào để một trường ngoài tập đó lọt vào sổ audit.
    expect(doc(F)).toContain("Object.values(ANH_XA_COT).flat()");
  });

  it("ghi rõ cột nào có trong file — để đọc lại biết vì sao trường khác không đổi", () => {
    expect(doc(F)).toContain("cột có trong file");
  });
});

// ── Việc 9 (08/09/2026): cảnh báo phải ở NGAY TRÊN MÀN ────────────────────────
//
// Quy ước "ô trống = giữ nguyên" là chiều AN TOÀN nhưng PHẢN TRỰC GIÁC: người dùng sẽ
// để trống một ô mong xoá dữ liệu, và không có gì xảy ra. Docs không đến được tay người
// dán file Excel.
describe("màn nhập nhân sự nói rõ quy ước", () => {
  const UI = "app/(admin)/admin/nhan-su/import/page.tsx";

  it("nói thẳng: ô để trống là GIỮ NGUYÊN, không phải xoá", () => {
    const src = doc(UI);
    expect(src).toContain("GIỮ NGUYÊN, không phải xoá");
    expect(src).toContain("sửa ở màn hồ sơ nhân sự");
  });

  it("nói riêng về `status` — thiếu cột thì người đã nghỉ không bị cho đi làm lại", () => {
    expect(doc(UI)).toContain("người đã nghỉ không bị cho đi làm lại");
  });

  it("mô tả cũ 'centerSlug rỗng = không gắn cơ sở' đã sửa — nó nói ngược quy ước mới", () => {
    const src = doc(UI);
    expect(src).not.toContain("rỗng = nhân viên không gắn cơ sở");
    expect(src).toContain("THIẾU CỘT = giữ nguyên cơ sở hiện tại");
  });

  it("nói rõ ba trường chỉ bắt buộc KHI TẠO MỚI", () => {
    expect(doc(UI)).toContain("bắt buộc KHI TẠO MỚI");
  });
});

// ── SỰ CỐ PROD 08/09/2026 — ô trống XOÁ TRẮNG ba cột ngày ────────────────────
//
// VÌ SAO BỘ TEST CŨ KHÔNG BẮT ĐƯỢC (ghi lại để đừng lặp):
//
//   Ca cũ gọi `dungPatchNhanSu(DAY_DU, new Set(["employeeCode", "centerSlug"]))` —
//   nó GÕ TAY `coMat`. Mà `coMat` là thứ DUY NHẤT quyết định patch gồm gì, và trong đời
//   thật nó do route dựng từ payload của client. Tức là tôi gõ tay đúng cái biến chứa
//   lỗi rồi khẳng định hàm nhận nó chạy đúng. Test xanh, và nó xanh CHÍNH XÁC — nó đo
//   hàm dựng patch, không đo đường dẫn dữ liệu tới hàm đó.
//
//   Phụ thêm: fixture cũ KHÔNG set và KHÔNG assert `endDate`, nên riêng cột đó "bị xoá"
//   và "vốn trống" nhìn giống hệt nhau (luật 4). Nhưng kể cả đã set, test vẫn xanh —
//   lỗi nằm ngoài tầm với của nó.
//
// HÌNH DẠNG THẬT của payload (đo từ mã, xác nhận bằng audit prod):
//   1. `ExcelImporter` đọc sheet với `{ defval: null }` ⇒ ô trống thành `null`;
//   2. màn nhập cho `dateOfBirth`/`joinedAt`/`endDate` đi thẳng, mọi cột khác qua
//      `asString()` → `undefined`;
//   3. `JSON.stringify` RỤNG `undefined` nhưng GIỮ `null`.
//   ⇒ tới route: ba cột ngày = `null` (CÓ MẶT), các cột khác = VẮNG MẶT.
//
// Bằng chứng đối chứng có thật trong audit prod cùng ngày: một lượt nhập có 6 cột trống
// kiểu `asString` (department, email, fullName, jobTitle, status…) chỉ đổi mỗi `phone`.

/** Đúng thứ route nhận: object client dựng, đã đi qua JSON. */
const quaJson = (o: Record<string, unknown>) =>
  JSON.parse(JSON.stringify(o)) as Record<string, unknown>;

/**
 * Hồ sơ đích có giá trị THẬT và KHÁC NHAU ở cả ba cột ngày — để "bị xoá" không thể
 * trông giống "vốn đã trống", và để nhầm cột này sang cột kia thì lộ ra.
 */
const HO_SO_DU_NGAY = {
  ...DAY_DU,
  dateOfBirth: new Date("1985-07-18T00:00:00Z"), // SR.NV.001 thật
  joinedAt: new Date("2025-11-24T00:00:00Z"), // SR.NV.005 thật
  endDate: new Date("2030-12-31T00:00:00Z"), // SR.NV.001 thật
} as const;

describe("cotCoMat — ô trống là GIỮ NGUYÊN, không phải xoá", () => {
  // ⚠️ CA TÁI HIỆN SỰ CỐ. File 9 cột, ba cột ngày ĐỂ TRỐNG.
  it("file có header cột ngày nhưng ô TRỐNG ⇒ ba cột ngày KHÔNG vào patch", () => {
    // Client dựng đủ khoá; `asString` biến ô trống thành undefined, ba cột ngày (trước
    // bản vá) giữ null. Đây là payload đúng như prod đã nhận.
    const payload = quaJson({
      employeeCode: "SR.NV.001",
      centerSlug: "co-so-hoang-dieu",
      fullName: undefined,
      jobTitle: undefined,
      department: undefined,
      status: undefined,
      dateOfBirth: null,
      joinedAt: null,
      endDate: null,
    });

    // Chính đường route đi: dựng coMat TỪ payload, không gõ tay.
    const patch = dungPatchNhanSu(HO_SO_DU_NGAY, cotCoMat(payload));

    expect(patch).toEqual({ centerId: "cs1", orgUnitId: "ou-cs1" });
    for (const k of ["dateOfBirth", "joinedAt", "endDate"]) {
      expect(Object.hasOwn(patch, k), k + " KHÔNG được nằm trong patch").toBe(
        false,
      );
    }
  });

  it("ô ngày CÓ giá trị thì VẪN ghi — cổng không được nuốt luôn dữ liệu thật", () => {
    // Anti-vacuity: nếu cổng chặn tuốt thì ca trên xanh mà tính năng chết.
    const payload = quaJson({
      employeeCode: "SR.NV.001",
      joinedAt: "2026-08-16",
      dateOfBirth: null,
    });
    const patch = dungPatchNhanSu(
      { ...HO_SO_DU_NGAY, joinedAt: new Date("2026-08-16T00:00:00Z") },
      cotCoMat(payload),
    );
    expect(patch).toEqual({ joinedAt: new Date("2026-08-16T00:00:00Z") });
    expect(Object.hasOwn(patch, "dateOfBirth")).toBe(false);
  });

  // ── ĐỪNG VÁ BA CỘT NGÀY RỒI TUYÊN BỐ KÍN ───────────────────────────────────
  //
  // Cổng theo GIÁ TRỊ nên nó kín cho MỌI họ cột. Ca này rà từng họ một, vì bẫy không
  // thuộc về "ngày" — nó thuộc về "cột nào lọt được `null` vào payload".
  it("MỌI họ cột: enum · quan hệ · JSON · chuỗi — ô trống đều KHÔNG vào patch", () => {
    const payload = quaJson({
      employeeCode: "SR.NV.001",
      // enum
      status: null,
      gender: null,
      contractType: null,
      department: null,
      // quan hệ
      centerSlug: null,
      managerCode: null,
      // JSON (mảng)
      subjects: null,
      certifications: null,
      // chuỗi
      phone: null,
      email: null,
      nationalId: null,
      address: null,
      bio: null,
      notes: null,
      emergencyContact: null,
      fullName: null,
      jobTitle: null,
      // ngày
      dateOfBirth: null,
      joinedAt: null,
      endDate: null,
    });
    expect(dungPatchNhanSu(HO_SO_DU_NGAY, cotCoMat(payload))).toEqual({});
  });

  it("chuỗi rỗng và chuỗi toàn khoảng trắng cũng là Ô TRỐNG", () => {
    const payload = quaJson({ employeeCode: "X", phone: "", address: "   " });
    expect(dungPatchNhanSu(HO_SO_DU_NGAY, cotCoMat(payload))).toEqual({});
  });

  it('số 0, chuỗi "0" và false KHÔNG phải ô trống', () => {
    // Falsy-check ngây thơ (`if (!v)`) nuốt cả ba. Cổng phải so ĐÍCH DANH null/rỗng.
    expect([...cotCoMat({ a: 0, b: "0", c: false })].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("status có giá trị thì vẫn kéo theo isActive — cổng không làm hỏng đường ghi", () => {
    const payload = quaJson({ employeeCode: "X", status: "RESIGNED" });
    expect(dungPatchNhanSu(HO_SO_DU_NGAY, cotCoMat(payload))).toEqual({
      status: "RESIGNED",
      isActive: false,
    });
  });
});

describe("route + màn nhập cắm đúng cổng", () => {
  it("route dựng coMat bằng cotCoMat, KHÔNG bằng Object.keys", () => {
    const src = doc("app/api/admin/import/employees/route.ts");
    expect(src).toContain("cotCoMat(");
    // Đây chính là dòng đã ghi NULL lên 9 hồ sơ prod.
    expect(src).not.toContain("new Set(Object.keys(");
  });

  it("màn nhập KHÔNG cho cột ngày nào đi thẳng nữa", () => {
    const src = doc("app/(admin)/admin/nhan-su/import/page.tsx");
    for (const f of ["dateOfBirth", "joinedAt", "endDate"]) {
      expect(src, f + " phải qua asDate()").toContain(
        f + ": asDate(row." + f + ")",
      );
      expect(src).not.toContain(
        f + ": row." + f + " as string | number | Date | undefined",
      );
    }
  });
});

// ── CHẠY THỬ (08/09/2026) ────────────────────────────────────────────────────
//
// Bản vá "ô trống = giữ nguyên" đã một lần được tuyên bố kín rồi vẫn xoá trắng ba cột
// ngày trên 9 hồ sơ PROD. Thứ DUY NHẤT phát hiện ra là ảnh chụp trước/sau của người vận
// hành — chạy thử biến việc chụp đó thành một bước của chính công cụ.
describe("importer có CHẠY THỬ", () => {
  const R = "app/api/admin/import/employees/route.ts";
  const UI = "app/(admin)/admin/nhan-su/import/page.tsx";

  it("route nhận cờ dryRun và TRẢ VỀ TRƯỚC KHI mở transaction", () => {
    const src = doc(R);
    const iDry = src.indexOf("if (dryRun) {");
    const iTx = src.indexOf("await sdb.$transaction(");
    expect(iDry).toBeGreaterThan(-1);
    expect(iTx).toBeGreaterThan(-1);
    expect(iDry, "nhánh chạy thử phải nằm TRƯỚC transaction").toBeLessThan(iTx);
  });

  it("chạy thử và ghi thật dùng CHUNG một kế hoạch — không tính hai đường", () => {
    // Tính hai đường thì bản xem trước trả lời "cái tôi TƯỞNG sẽ ghi".
    const src = doc(R);
    expect(src).toContain("const keHoach = validRows.map(");
    expect(src).toContain("of keHoach");
    // Goi DUNG MOT LAN trong route (dong import khong co dau ngoac nen khong tinh).
    // Hai lan = hai duong tinh patch = ban xem truoc khong con la bang chung.

    expect(src.split("dungPatchNhanSu(").length - 1).toBe(1);
  });

  it("mặc định của ENDPOINT là ghi thật — chỉ MÀN mới mặc định chạy thử", () => {
    // Nếu endpoint mặc định chạy thử, một client cũ sẽ im lặng không ghi gì mà báo OK.
    expect(doc(R)).toContain("?.dryRun === true");
    expect(doc(UI)).toContain("goiApi(rows, true)");
    expect(doc(UI)).toContain("goiApi(rowsChoGhi, false)");
  });

  it("bảng xem trước chỉ đích danh ô sắp MẤT DỮ LIỆU", () => {
    expect(doc(UI)).toContain("MẤT DỮ LIỆU");
  });
});

// ── Sổ audit phải nói THẬT, kể cả ở nhánh TẠO MỚI (08/09/2026) ───────────────
//
// Nhánh tạo mới ghi TRỌN `base` nhưng trước đây audit `patch` — mà `patch` chỉ gồm cột
// CÓ TRONG FILE. Sổ audit của một lượt tạo mới vì thế báo thiếu đúng những trường được
// điền bằng mặc định: `status`/`isActive` khi file không có cột `status`, và mảng rỗng
// của `subjects`/`certifications`.
//
// Đáng sửa dù nhỏ: chính sổ audit là thứ đã đo ra gốc sự cố xoá trắng ba cột ngày cùng
// ngày. Công cụ chẩn đoán nói thiếu sẽ dẫn lạc đúng lúc cần nó nhất.
describe("audit của lượt TẠO MỚI khớp đúng thứ đã ghi", () => {
  const R = "app/api/admin/import/employees/route.ts";

  it("ghi và audit CÙNG một object — không dựng lại, không tóm tắt", () => {
    const src = doc(R);
    expect(src).toContain("const duLieuTao = {");
    expect(src).toContain("data: duLieuTao,");
    expect(src).toContain("newValues: duLieuTao,");
  });

  it("KHÔNG còn audit `patch` ở nhánh tạo mới", () => {
    // `patch` là tập cột CÓ TRONG FILE; tạo mới ghi nhiều hơn thế.
    expect(doc(R)).not.toContain(
      "newValues: { employeeCode: r.data.employeeCode, ...patch }",
    );
  });

  it("có changedFields — sổ audit không để trống cột 'đổi gì'", () => {
    expect(doc(R)).toContain("changedFields: Object.keys(duLieuTao)");
  });

  it("lượt tạo mới cũng ghi rõ cột nào có trong file", () => {
    // Cùng thông tin với nhánh cập nhật: đọc lại mới biết vì sao trường kia mang mặc định.
    const src = doc(R);
    // Dem CHUOI NOI SUY, khong dem van ban tran — binh luan cung chua cum tu do.
    expect(src.split("cột có trong file: ${[...r.coMat]").length - 1).toBe(2);
  });
});
