// Ca [LPV-*] — ô lọc phạm vi của màn Đơn hàng. Thuần, không DB.
//
// 🔴 Chủ dự án 25/09/2026: *"thiết kế để quản lý cho nhiều cơ sở, nhiều role khác nhau,
// ví dụ sale thì không có phần lọc cơ sở, qlcs thì không có phần lọc của khu vực"*.
//
// Bộ này khoá hai thứ, và thứ hai mới là thứ đắt:
//   · ô lọc chỉ bày khi cho ≥2 lựa chọn (affordance nói thật — luật 12);
//   · lựa chọn của client bị KẸP về tầm nhìn (cổng bảo mật, không phải dọn dẹp).
import { describe, it, expect } from "vitest";
import {
  oLocPhamVi,
  kepCoSoTheoTamNhin,
  coSoTrongKhuVuc,
  type CoSoCoKhuVuc,
} from "./loc-pham-vi";

const DANANG = "kv-danang";
const HANOI = "kv-hanoi";

/** Hình dạng THẬT đo trên `satarobo_local` 25/09/2026: 1 khu vực, 2 cơ sở. */
const HOM_NAY: CoSoCoKhuVuc[] = [
  { id: "cs1", ten: "Cơ sở 1", khuVucId: DANANG },
  { id: "cs2", ten: "Cơ sở 2", khuVucId: DANANG },
];
const KHU_VUC_HOM_NAY = [{ id: DANANG, ten: "Khối Đà Nẵng" }];

describe("[LPV-01] Sale / QLCS một cơ sở — KHÔNG có ô nào", () => {
  it("một cơ sở, một khu vực ⇒ giấu cả hai", () => {
    // Đây là ca chủ dự án mô tả bằng chữ "sale thì không có phần lọc cơ sở". Nó ra đúng
    // như thế mà KHÔNG cần biết người đó là sale — chỉ cần biết họ thấy mấy cơ sở.
    expect(
      oLocPhamVi({ khuVuc: KHU_VUC_HOM_NAY, coSo: [HOM_NAY[0]!] }),
    ).toEqual({ hienKhuVuc: false, hienCoSo: false });
  });

  it("KHÔNG cơ sở nào (dữ liệu lạ) cũng giấu, không nổ", () => {
    expect(oLocPhamVi({ khuVuc: [], coSo: [] })).toEqual({
      hienKhuVuc: false,
      hienCoSo: false,
    });
  });
});

describe("[LPV-02] QLCS kiêm hai cơ sở — có ô Cơ sở, KHÔNG ô Khu vực", () => {
  it("hai cơ sở cùng một khối", () => {
    // Vế thứ hai của câu chủ dự án: "qlcs thì không có phần lọc của khu vực".
    expect(oLocPhamVi({ khuVuc: KHU_VUC_HOM_NAY, coSo: HOM_NAY })).toEqual({
      hienKhuVuc: false,
      hienCoSo: true,
    });
  });
});

describe("[LPV-03] Hội sở — ô Khu vực TỰ BẬT khi có khối thứ hai", () => {
  it("hôm nay (1 khối) vẫn giấu — đúng, lọc theo khối duy nhất bằng không lọc", () => {
    expect(oLocPhamVi({ khuVuc: KHU_VUC_HOM_NAY, coSo: HOM_NAY }).hienKhuVuc).toBe(false);
  });

  it("mở Khối Hà Nội ⇒ hiện, KHÔNG ai phải sửa dòng mã nào", () => {
    // Ca này là bằng chứng luật suy-từ-dữ-liệu hoạt động. Nếu nó đỏ thì ai đó đã thay
    // bằng một danh sách vai, và tổ chức lớn lên sẽ phải sửa mã.
    const mai = [...KHU_VUC_HOM_NAY, { id: HANOI, ten: "Khối Hà Nội" }];
    const coSoMai = [...HOM_NAY, { id: "cs3", ten: "Cơ sở 3", khuVucId: HANOI }];
    expect(oLocPhamVi({ khuVuc: mai, coSo: coSoMai })).toEqual({
      hienKhuVuc: true,
      hienCoSo: true,
    });
  });
});

describe("[LPV-04] KẸP theo tầm nhìn — cổng bảo mật", () => {
  it("bỏ id NGOÀI tầm nhìn, giữ id hợp lệ", () => {
    // Sale gõ tay `?coSo=cs2` trong khi chỉ thấy cs1.
    expect(kepCoSoTheoTamNhin(["cs1", "cs2"], ["cs1"])).toEqual(["cs1"]);
  });

  it("xin TOÀN id lạ ⇒ mảng rỗng (bỏ điều kiện, KHÔNG phải chặn sạch)", () => {
    // ⚠️ Ngữ nghĩa này phải giữ đúng: `[]` = "không thêm điều kiện cơ sở". Tầng chặn thật
    // là `scopedDb`. Đổi `[]` thành "chặn sạch" ở đây là làm màn trắng trơn khi ai đó
    // dán một URL cũ có id cơ sở đã xoá.
    expect(kepCoSoTheoTamNhin(["ma-gia"], ["cs1", "cs2"])).toEqual([]);
  });

  it("không xin gì ⇒ rỗng", () => {
    expect(kepCoSoTheoTamNhin(undefined, ["cs1"])).toEqual([]);
    expect(kepCoSoTheoTamNhin([], ["cs1"])).toEqual([]);
  });

  it("id lặp chỉ còn một", () => {
    expect(kepCoSoTheoTamNhin(["cs1", "cs1"], ["cs1"])).toEqual(["cs1"]);
  });
});

describe("[LPV-05] Khu vực → danh sách cơ sở", () => {
  it("trả đúng các cơ sở thuộc khối", () => {
    const coSo = [...HOM_NAY, { id: "cs3", ten: "Cơ sở 3", khuVucId: HANOI }];
    expect(coSoTrongKhuVuc(DANANG, coSo)).toEqual(["cs1", "cs2"]);
    expect(coSoTrongKhuVuc(HANOI, coSo)).toEqual(["cs3"]);
  });

  it("cơ sở CHƯA gắn cây (`khuVucId` null) không thuộc khối nào", () => {
    // `Center("hoi-so")` là bản ghi mồ côi đã biết (CLAUDE.md) — nó không được lọt vào
    // bất kỳ khối nào, kể cả khi ai đó truyền `null` làm khoá.
    const coSo: CoSoCoKhuVuc[] = [{ id: "mo-coi", ten: "Hội sở", khuVucId: null }];
    expect(coSoTrongKhuVuc(DANANG, coSo)).toEqual([]);
  });

  it("khối rỗng trả `[]` — KHÁC nghĩa `[]` của phép kẹp", () => {
    // Hai hàm cố ý không gộp: `[]` ở đây nghĩa "không cơ sở nào khớp", `[]` ở
    // `kepCoSoTheoTamNhin` nghĩa "không lọc". Gộp lại là một ngày nào đó lọc theo khối
    // rỗng biến thành "xem tất cả".
    expect(coSoTrongKhuVuc("kv-khong-co", HOM_NAY)).toEqual([]);
  });
});
