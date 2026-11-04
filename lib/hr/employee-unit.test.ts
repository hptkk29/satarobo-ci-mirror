// @vitest-environment node
/**
 * Suy CƠ SỞ từ ĐƠN VỊ LÀM VIỆC khi lưu hồ sơ nhân sự.
 *
 * Bài này pin cái lỗi đã xảy ra thật: form gửi `orgUnitId`, server không suy ra
 * `centerId`, và vì lưu vẫn báo THÀNH CÔNG nên không ai biết. Trên prod 20/08/2026
 * đo được **4 người có đơn vị / 1 người có cơ sở**; hệ quả nặng hơn cột trống là
 * `Employee` ∈ `SCOPED_MODELS` ⇒ `centerId = NULL` làm người đó vô hình với mọi
 * actor cấp cơ sở.
 *
 * Ba trạng thái của `orgUnitId` phải tách bạch, và đây là chỗ dễ sai nhất:
 *   `undefined` → lời gọi không đụng tới đơn vị  → GIỮ NGUYÊN cơ sở
 *   `null`      → người dùng chủ ý xoá đơn vị     → xoá cơ sở
 *   `"..."`     → chọn đơn vị                     → suy cơ sở từ khoá ngoại
 * Gộp `undefined` với `null` là âm thầm xoá cơ sở của người ta ở mọi lần lưu.
 */
import { describe, it, expect, vi } from "vitest";
import { suyCoSoTuDonVi } from "./employee-unit";

/** Cầu giả: CS1 → center-1, HO → null (đơn vị Hội sở không trỏ Center nào). */
const traGia = vi.fn(async (id: string) =>
  id === "ou-cs1" ? "center-1" : id === "ou-cs2" ? "center-2" : null,
);

describe("suyCoSoTuDonVi", () => {
  it("chọn đơn vị cơ sở → suy đúng Center của đơn vị đó", async () => {
    await expect(suyCoSoTuDonVi({ orgUnitId: "ou-cs1" }, traGia)).resolves.toEqual({
      centerId: "center-1",
    });
    await expect(suyCoSoTuDonVi({ orgUnitId: "ou-cs2" }, traGia)).resolves.toEqual({
      centerId: "center-2",
    });
  });

  it("đơn vị KHÔNG trỏ Center nào (phòng ban dưới HO) → cơ sở null, không ném lỗi", async () => {
    await expect(
      suyCoSoTuDonVi({ orgUnitId: "ou-phong-dao-tao" }, traGia),
    ).resolves.toEqual({ centerId: null });
  });

  it("orgUnitId undefined → trả null = GIỮ NGUYÊN cơ sở, và KHÔNG tra cứu", async () => {
    traGia.mockClear();
    await expect(suyCoSoTuDonVi({}, traGia)).resolves.toBeNull();
    expect(traGia).not.toHaveBeenCalled();
  });

  it("orgUnitId null → người dùng chủ ý xoá đơn vị ⇒ cơ sở null", async () => {
    await expect(suyCoSoTuDonVi({ orgUnitId: null }, traGia)).resolves.toEqual({
      centerId: null,
    });
  });

  it("nhân sự Hội sở → cơ sở null, kể cả khi form lỡ gửi kèm một đơn vị", async () => {
    traGia.mockClear();
    await expect(
      suyCoSoTuDonVi({ isHO: true, orgUnitId: "ou-cs1" }, traGia),
    ).resolves.toEqual({ centerId: null });
    // Không được tra cứu: quyết định "Hội sở ⇒ không thuộc cơ sở nào" thắng tuyệt đối.
    expect(traGia).not.toHaveBeenCalled();
  });

  it("isHO false không tự ý xoá gì — vẫn đi theo orgUnitId", async () => {
    await expect(
      suyCoSoTuDonVi({ isHO: false, orgUnitId: "ou-cs2" }, traGia),
    ).resolves.toEqual({ centerId: "center-2" });
  });
});

describe("màn nhân sự phải GỌI cầu này (chống tái diễn)", () => {
  it("actions.ts của nhân sự có gọi suyCoSoTuDonVi", async () => {
    // Guard nguồn, vì lỗi gốc là "quên gọi" chứ không phải "gọi sai": mọi test hành
    // vi của hàm trên vẫn xanh nguyên trong suốt thời gian màn nhân sự không gọi nó.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "app/(admin)/admin/nhan-su/actions.ts"),
      "utf8",
    );
    expect(src).toContain("suyCoSoTuDonVi");
    // Cả hai đường ghi, không chỉ đường sửa: tạo mới cũng nhận orgUnitId từ form.
    expect((src.match(/suyCoSoTuDonVi\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
