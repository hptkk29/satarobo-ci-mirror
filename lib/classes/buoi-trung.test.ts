// [BT-*] — `phanLoaiNhomTrung`: dọn buổi trùng không bao giờ xoá và không bao giờ đoán giữa hai bên đều mang dữ liệu.
import { describe, expect, it } from "vitest";
import { mangDuLieu, phanLoaiNhomTrung, type BuoiTrung } from "@/lib/classes/buoi-trung";

const b = (id: string, extra: Partial<BuoiTrung> = {}): BuoiTrung => ({
  id,
  status: "SCHEDULED",
  soDiemDanh: 0,
  soNhanXet: 0,
  soThamChieu: 0,
  taoLuc: new Date("2026-09-01T00:00:00Z"),
  ...extra,
});

describe("[BT] phanLoaiNhomTrung", () => {
  it("[BT-01] cả hai trống ⇒ TỰ SỬA, giữ buổi TẠO SỚM NHẤT, huỷ buổi kia", () => {
    const r = phanLoaiNhomTrung([b("b", { taoLuc: new Date("2026-09-02T00:00:00Z") }), b("a", { taoLuc: new Date("2026-09-01T00:00:00Z") })]);
    expect(r).toEqual({ loai: "TU_SUA", giu: "a", huy: ["b"], lyDoGiu: "TAO_SOM_NHAT" });
  });

  it("[BT-02] đồng giờ tạo: phân xử ổn định theo id (cùng đầu vào, cùng kết quả)", () => {
    const r1 = phanLoaiNhomTrung([b("y"), b("x")]);
    const r2 = phanLoaiNhomTrung([b("x"), b("y")]);
    expect(r1).toEqual(r2);
    expect(r1).toMatchObject({ giu: "x" });
  });

  it("[BT-03] đúng MỘT buổi mang dữ liệu ⇒ giữ nó dù nó tạo MUỘN hơn; huỷ các buổi trống", () => {
    const r = phanLoaiNhomTrung([
      b("sớm", { taoLuc: new Date("2026-09-01T00:00:00Z") }),
      b("muộn", { taoLuc: new Date("2026-09-05T00:00:00Z"), soDiemDanh: 3 }),
      b("giữa", { taoLuc: new Date("2026-09-03T00:00:00Z") }),
    ]);
    expect(r).toEqual({ loai: "TU_SUA", giu: "muộn", huy: ["giữa", "sớm"].sort(), lyDoGiu: "CO_DU_LIEU" });
  });

  it("[BT-04] mỗi loại 'dữ liệu' đều đủ để buổi được coi là mang dữ liệu — kể cả COMPLETED/IN_PROGRESS không có bản ghi nào", () => {
    expect(mangDuLieu(b("x", { status: "COMPLETED" }))).toBe(true);
    expect(mangDuLieu(b("x", { status: "IN_PROGRESS" }))).toBe(true);
    expect(mangDuLieu(b("x", { soDiemDanh: 1 }))).toBe(true);
    expect(mangDuLieu(b("x", { soNhanXet: 1 }))).toBe(true);
    expect(mangDuLieu(b("x", { soThamChieu: 1 }))).toBe(true);
    expect(mangDuLieu(b("x"))).toBe(false);
  });

  it("[BT-05] HAI buổi mang dữ liệu ⇒ XEM TAY, nêu đúng hai id; KHÔNG đề xuất huỷ buổi nào", () => {
    const r = phanLoaiNhomTrung([b("a", { soDiemDanh: 2 }), b("b", { soNhanXet: 1 }), b("c")]);
    expect(r.loai).toBe("XEM_TAY");
    if (r.loai !== "XEM_TAY") return;
    expect(r.ids).toEqual(["a", "b"]);
    expect("huy" in r).toBe(false);
  });

  it("[BT-06] một buổi COMPLETED + một buổi trống ⇒ giữ COMPLETED (công dạy tính theo trạng thái)", () => {
    const r = phanLoaiNhomTrung([b("trống", { taoLuc: new Date("2026-09-01T00:00:00Z") }), b("xong", { status: "COMPLETED", taoLuc: new Date("2026-09-09T00:00:00Z") })]);
    expect(r).toMatchObject({ loai: "TU_SUA", giu: "xong", huy: ["trống"] });
  });

  it("[BT-07] nhóm dưới hai buổi không phải nhóm trùng ⇒ ném lỗi (đừng im lặng trả kết quả vô nghĩa)", () => {
    expect(() => phanLoaiNhomTrung([b("a")])).toThrow();
    expect(() => phanLoaiNhomTrung([])).toThrow();
  });
});
