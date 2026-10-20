/**
 * lib/export/bao-cao.test.ts — năm tệp báo cáo phải đọc SỐ CỦA MÀN, không dựng lại (luật 12b).
 *
 * Lưới chính ở đây chặn một lỗi mà không lưới nào khác thấy: tệp công nợ gọi `getDebtRows`
 * với **phạm vi SAI**. Màn /cong-no cố ý gọi hàm đó HAI lần với hai phạm vi khác nhau, và
 * bảng đối soát dùng phạm vi RỘNG (`keCaChuaChotGia: true`, không lọc `debt > 0`). Gọi phạm
 * vi hẹp thì tệp vẫn mở được, vẫn đúng định dạng, chỉ **thiếu đúng những dòng cần soát** —
 * nhóm chưa chốt giá và nhóm đã đóng đủ.
 *
 * Đo được: cấy lỗi đó vào (bỏ `keCaChuaChotGia`) thì 53 ca của `lib/export` VẪN XANH. Đó là
 * lý do file này tồn tại.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Ghi lại đối số mà `napCongNo` truyền cho `getDebtRows`. */
const goiVoi: unknown[] = [];

vi.mock("@/lib/finance/debt", () => ({
  getDebtRows: (...args: unknown[]) => {
    goiVoi.push(args[1]);
    return Promise.resolve([]);
  },
  overdueBucket: () => "none",
}));

// `listRoles` chạm DB thật — chặn ở đây để bộ này không cần Postgres.
vi.mock("@/lib/auth/rbac-service", () => ({ listRoles: () => Promise.resolve([]) }));

const sdbGia = new Proxy(
  {},
  { get: () => ({ findMany: async () => [] as never[] }) },
) as never;

describe("[BC] tệp báo cáo đọc số của màn", () => {
  beforeEach(() => {
    goiVoi.length = 0;
  });

  it("🔒 công nợ gọi `getDebtRows` với PHẠM VI RỘNG (kể cả chưa chốt giá)", async () => {
    const { BO_NAP_BAO_CAO } = await import("./bao-cao");
    await BO_NAP_BAO_CAO["cong-no"]!(sdbGia);
    // Lượt đầu là lượt dựng dòng. Phải mang `keCaChuaChotGia: true`.
    expect(goiVoi[0]).toMatchObject({ keCaChuaChotGia: true });
  });

  it("công nợ KHÔNG tự tính lại — mọi số đến từ `getDebtRows`", async () => {
    // `getDebtRows` trả rỗng ⇒ tệp phải rỗng. Nếu có dòng nào hiện ra thì nó được dựng từ
    // một truy vấn KHÁC, tức tệp đang tự tính công nợ song song với màn.
    const { BO_NAP_BAO_CAO } = await import("./bao-cao");
    const { dong } = await BO_NAP_BAO_CAO["cong-no"]!(sdbGia);
    expect(dong).toEqual([]);
  });

  it("công nợ có sheet phụ nhóm tuổi nợ, đủ bốn nhóm", async () => {
    // Nhóm tuổi nợ ở BẢNG PHỤ chứ không phải một cột trên mỗi dòng: hạn nằm trên TỪNG ĐỢT
    // trả góp, nên một nhóm cho cả dòng ghi danh là bịa (`Enrollment` không có cột hạn nào).
    const { BO_NAP_BAO_CAO } = await import("./bao-cao");
    const { bangPhu } = await BO_NAP_BAO_CAO["cong-no"]!(sdbGia);
    expect(bangPhu).toHaveLength(1);
    expect(bangPhu![0]!.dong).toHaveLength(4);
  });

  it("ma trận vai×quyền đọc `listRoles` (DB), KHÔNG đọc file seed", async () => {
    // Đọc `seed-roles.ts` là đọc Ý ĐỊNH; `RoleDef`/`RolePermission` trong DB là thứ RBAC v2
    // THỰC SỰ dùng để chặn trên prod. Hai nguồn đã lệch nhau thật (đo 24/09: 14 vs 15 vai).
    const { BO_NAP_BAO_CAO } = await import("./bao-cao");
    const { dong } = await BO_NAP_BAO_CAO["quyen-vai"]!(sdbGia);
    expect(dong).toEqual([]); // listRoles bị chặn trả rỗng ⇒ không có nguồn thứ hai
  });

  it("năm mã báo cáo đều nạp được và trả cột không rỗng", async () => {
    const { BO_NAP_BAO_CAO, MA_BAO_CAO } = await import("./bao-cao");
    for (const ma of MA_BAO_CAO) {
      const { cot } = await BO_NAP_BAO_CAO[ma]!(sdbGia);
      expect(cot.length, ma).toBeGreaterThan(3);
      // Tiêu đề phải là NHÃN tiếng Việt có nghĩa, không phải khoá máy.
      for (const x of cot) expect(x.nhan.trim().length, `${ma}/${x.khoa}`).toBeGreaterThan(2);
    }
  });
});
