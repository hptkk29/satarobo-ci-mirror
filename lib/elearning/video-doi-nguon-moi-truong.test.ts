// @vitest-environment node
/**
 * [MTR] Chốt môi trường của kịch bản đối soát/phục hồi video. Mỗi ô của bảng (cờ × tên DB) có ca riêng; ca đối chứng dương
 * cho từng cờ đảm bảo "bị từ chối" không phải do hàm từ chối tất cả.
 */
import { describe, it, expect } from "vitest";
import { chotMoiTruong, DB_LOCAL, DB_PROD, DB_TEST } from "@/lib/elearning/video-doi-nguon-moi-truong";

describe("[MTR-01] bắt buộc khai tường minh, không có mặc định", () => {
  it("thiếu / rỗng / giá trị lạ ⇒ từ chối, dù DB là DB test", () => {
    for (const x of [null, undefined, "", "prod", "TEST", "production", "all"]) {
      expect(chotMoiTruong(x, DB_TEST), String(x)).toMatchObject({ ok: false });
    }
  });
});

describe("[MTR-02] --moi-truong=test chỉ chạy trên satarobo_test (lệnh UAT TEST)", () => {
  it("ĐÚNG satarobo_test ⇒ qua", () => expect(chotMoiTruong("test", DB_TEST)).toEqual({ ok: true, moiTruong: "test" }));
  it("🔴 khai test nhưng DB đang đọc là DB máy dev / ci_test / tên lạ ⇒ TỪ CHỐI (host giống nhau qua đường hầm, tên DB mới quyết định)", () => {
    for (const ten of [...DB_LOCAL, "satarobo_test2", "Satarobo_test", "postgres"]) {
      expect(chotMoiTruong("test", ten), ten).toMatchObject({ ok: false });
    }
  });
});

describe("[MTR-03] --moi-truong=local chỉ chạy trên DB máy dev", () => {
  it("mỗi DB làm việc/thử ⇒ qua", () => {
    for (const ten of DB_LOCAL) expect(chotMoiTruong("local", ten), ten).toEqual({ ok: true, moiTruong: "local" });
  });
  it("🔴 khai local nhưng DB là satarobo_test (UAT) ⇒ TỪ CHỐI: không dùng cờ local để lách chốt của TEST", () => {
    expect(chotMoiTruong("local", DB_TEST)).toMatchObject({ ok: false });
  });
});

describe("[MTR-04] PROD không bao giờ", () => {
  it("🔴 DB PROD bị từ chối với MỌI cờ, và lời từ chối nói rõ đó là PROD", () => {
    for (const co of ["test", "local"]) {
      const r = chotMoiTruong(co, DB_PROD);
      expect(r, co).toMatchObject({ ok: false });
      if (!r.ok) expect(r.thongBao).toContain("PROD");
    }
  });
  it("tên rỗng / không đọc được ⇒ từ chối (fail-closed)", () => {
    for (const ten of ["", "   ", null, undefined]) expect(chotMoiTruong("test", ten as never), String(ten)).toMatchObject({ ok: false });
  });
  it("hằng số khớp bảng chốt trong tài liệu: DB test và DB prod khác nhau, và không DB local nào trùng tên DB prod/test", () => {
    expect(DB_TEST).not.toBe(DB_PROD);
    expect((DB_LOCAL as readonly string[]).includes(DB_PROD)).toBe(false);
    expect((DB_LOCAL as readonly string[]).includes(DB_TEST)).toBe(false);
  });
});
