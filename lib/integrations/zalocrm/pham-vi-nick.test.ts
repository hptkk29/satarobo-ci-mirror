// Ca [PVN-*] — AI ĐƯỢC DÙNG MỘT NICK, VÀ Ở MỨC NÀO. Luật thuần, không DB, không mạng.
//
// Cổng này có hậu quả thật: sai một nhánh là người ngoài đọc được chat khách, hoặc
// người trong không đọc được chat của chính mình. Nên nó đo CẢ HAI ĐẦU của mỗi nhánh,
// không chỉ đầu "đúng" (bài học `canSearchPhone` — luật 14).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  nguoiDuocDungMotNick,
  MUC_QUYEN,
  VAI_QUAN_LY_CO_SO,
  MUC_MAC_DINH_CHUA_GIAO,
  type GiaoTay,
} from "./pham-vi-nick";

/**
 * Thân hàm `nguoiDuocDungMotNick`, đã BÓC CHÚ THÍCH.
 *
 * Bóc là bắt buộc (luật 11): chính chú thích trong hàm nhắc `VAI_QUAN_LY_CO_SO` để giải
 * thích vì sao nhánh cũ bị gỡ — không bóc thì lưới đỏ vì lời kể, không phải vì mã.
 * `process.cwd()` chứ không `import.meta.url`: cấu hình vitest của repo này không cho
 * `fileURLToPath` (xem mẫu LƯỚI GHIM MÃ NGUỒN trong CLAUDE.md).
 */
function thanHamChinhSach(): string {
  const src = readFileSync(
    resolve(process.cwd(), "lib/integrations/zalocrm/pham-vi-nick.ts"),
    "utf8",
  );
  const dau = src.indexOf("export function nguoiDuocDungMotNick(");
  if (dau < 0) throw new Error("không thấy `nguoiDuocDungMotNick` — lưới mất neo");
  return src
    .slice(dau)
    .split(/\r?\n/)
    .map((d) => d.replace(/\/\/.*$/, ""))
    .join("\n");
}

const TRANG = "u-trang"; // quản lý cơ sở CS1 (+CS2)
const LOC = "u-loc"; // sale CS1
const DIEU = "u-dieu"; // sale CS1
const HA = "u-ha"; // 🔴 GIÁO VIÊN CS1 — nhân sự của cơ sở, KHÔNG thuộc tập mặc định

/** MỌI nhân sự của cơ sở — tập GIAO TAY hợp lệ (rộng, từ 24/09). */
const CA_CO_SO = [TRANG, LOC, DIEU, HA] as const;
/** Tập CON được dùng nick MẶC ĐỊNH khi nick chưa giao ai (hẹp). Cô Hà KHÔNG có mặt. */
const MAC_DINH = [TRANG, LOC, DIEU] as const;
const KHONG_GIAO: GiaoTay[] = [];

describe("[PVN-01] nick CHƯA GIAO AI → tập MẶC ĐỊNH, mức mặc định", () => {
  it("chỉ người của tập mặc định có mặt — KHÔNG phải cả cơ sở", () => {
    const ra = nguoiDuocDungMotNick({
      giaoTay: KHONG_GIAO,
      nguoiCuaCoSo: CA_CO_SO,
      macDinhDungDuoc: MAC_DINH,
    });
    expect(ra.map((x) => x.sataUserId)).toEqual([TRANG, LOC, DIEU]);
    expect(new Set(ra.map((x) => x.mucQuyen))).toEqual(new Set([MUC_MAC_DINH_CHUA_GIAO]));
    // ĐỐI CHỨNG ÂM — giáo viên của cơ sở KHÔNG tự động đọc được nick chưa giao.
    expect(ra.map((x) => x.sataUserId), "nới quyền mặc định ra cả cơ sở").not.toContain(HA);
  });

  it("cơ sở rỗng → rỗng, không ném", () => {
    expect(
      nguoiDuocDungMotNick({ giaoTay: KHONG_GIAO, nguoiCuaCoSo: [], macDinhDungDuoc: [] }),
    ).toEqual([]);
  });
});

describe("[PVN-02] 🔴 QUẢN LÝ CƠ SỞ KHÔNG còn là ngoại lệ (đảo 24/09)", () => {
  // Chủ dự án: *"quản lý phân quyền của QLCS ở đây luôn chứ"* — tức thêm/gỡ/đổi mức cho
  // quản lý cơ sở ngay trên màn. Hệ quả ĐÃ ĐƯỢC CÂN NHẮC: gỡ họ khỏi một nick thì họ
  // mất tầm nhìn nick đó. Bản giữa ngày 24/09 cho họ `admin` tự động; nhánh ấy đã gỡ.

  it("nick ĐÃ giao cho người khác ⇒ quản lý KHÔNG tự động có mặt", () => {
    const ra = nguoiDuocDungMotNick({
      giaoTay: [{ sataUserId: LOC, mucQuyen: "chat" }],
      nguoiCuaCoSo: CA_CO_SO,
      macDinhDungDuoc: MAC_DINH,
    });
    expect(ra).toEqual([{ sataUserId: LOC, mucQuyen: "chat" }]);
    expect(ra.map((x) => x.sataUserId), "nhánh admin-tự-động quay lại").not.toContain(TRANG);
  });

  it("muốn quản lý có quyền thì GIAO TAY — và mức đúng thứ được giao", () => {
    // ĐỐI CHỨNG DƯƠNG của ca trên. Thiếu vế này thì một hàm luôn trả rỗng cũng xanh.
    const ra = nguoiDuocDungMotNick({
      giaoTay: [
        { sataUserId: TRANG, mucQuyen: "admin" },
        { sataUserId: LOC, mucQuyen: "chat" },
      ],
      nguoiCuaCoSo: CA_CO_SO,
      macDinhDungDuoc: MAC_DINH,
    });
    expect(ra).toEqual([
      { sataUserId: TRANG, mucQuyen: "admin" },
      { sataUserId: LOC, mucQuyen: "chat" },
    ]);
  });

  it("giao quản lý ở mức HẸP ⇒ đúng mức hẹp, KHÔNG bị nâng lên admin", () => {
    // Đây là ca mà nhánh cũ làm sai: `rongHon(admin, read)` kéo mọi mức về `admin`, nên
    // "hạ quyền quản lý xuống chỉ-xem" là một câu nói dối trên màn.
    const ra = nguoiDuocDungMotNick({
      giaoTay: [{ sataUserId: TRANG, mucQuyen: "read" }],
      nguoiCuaCoSo: CA_CO_SO,
      macDinhDungDuoc: MAC_DINH,
    });
    expect(ra).toEqual([{ sataUserId: TRANG, mucQuyen: "read" }]);
  });

  it("nick CHƯA giao ai ⇒ quản lý vẫn thấy, nhưng ở mức MẶC ĐỊNH chứ không admin", () => {
    const ra = nguoiDuocDungMotNick({
      giaoTay: KHONG_GIAO,
      nguoiCuaCoSo: CA_CO_SO,
      macDinhDungDuoc: MAC_DINH,
    });
    expect(ra.find((x) => x.sataUserId === TRANG)?.mucQuyen).toBe(MUC_MAC_DINH_CHUA_GIAO);
  });
});

describe("[PVN-03] giao tay NHIỀU người, mỗi người một mức", () => {
  it("giữ đúng mức của từng người", () => {
    const ra = nguoiDuocDungMotNick({
      giaoTay: [
        { sataUserId: LOC, mucQuyen: "chat" },
        { sataUserId: DIEU, mucQuyen: "read" },
      ],
      nguoiCuaCoSo: CA_CO_SO,
      macDinhDungDuoc: MAC_DINH,
    });
    expect(ra).toEqual([
      { sataUserId: LOC, mucQuyen: "chat" },
      { sataUserId: DIEU, mucQuyen: "read" },
    ]);
  });

  it("giao cho một người mức `admin` → đúng admin, không hạ xuống chat", () => {
    const ra = nguoiDuocDungMotNick({
      giaoTay: [{ sataUserId: DIEU, mucQuyen: "admin" }],
      nguoiCuaCoSo: CA_CO_SO,
      macDinhDungDuoc: MAC_DINH,
    });
    expect(ra).toEqual([{ sataUserId: DIEU, mucQuyen: "admin" }]);
  });

  it("một người xuất hiện hai lần ⇒ mức RỘNG thắng, không phải dòng cuối", () => {
    // Đường ghi đã chặn trùng (`TRUNG_NGUOI`), nhưng dữ liệu cũ / ghi tay vẫn có thể
    // sinh ra. Lấy "dòng cuối" là kết quả đổi theo thứ tự trả về của Postgres.
    const ra = nguoiDuocDungMotNick({
      giaoTay: [
        { sataUserId: LOC, mucQuyen: "read" },
        { sataUserId: LOC, mucQuyen: "admin" },
      ],
      nguoiCuaCoSo: CA_CO_SO,
      macDinhDungDuoc: MAC_DINH,
    });
    expect(ra).toEqual([{ sataUserId: LOC, mucQuyen: "admin" }]);
  });
});

describe("[PVN-04] dòng giao CŨ không được nới quyền", () => {
  it("người được giao đã rời cơ sở → bị loại, và nick coi như CHƯA GIAO", () => {
    // Loại xong mà danh sách giao rỗng ⇒ rơi về tập MẶC ĐỊNH, KHÔNG về rỗng: rỗng nghĩa
    // là hộp thư khách không ai đọc được, và không dòng lỗi nào báo.
    const ra = nguoiDuocDungMotNick({
      giaoTay: [{ sataUserId: "u-da-nghi-viec", mucQuyen: "admin" }],
      nguoiCuaCoSo: CA_CO_SO,
      macDinhDungDuoc: MAC_DINH,
    });
    expect(ra.map((x) => x.sataUserId)).toEqual([TRANG, LOC, DIEU]);
    expect(ra.map((x) => x.sataUserId)).not.toContain("u-da-nghi-viec");
  });

  it("quản lý đã rời cơ sở → dòng giao của họ rụng như mọi người", () => {
    const ra = nguoiDuocDungMotNick({
      giaoTay: [
        { sataUserId: LOC, mucQuyen: "chat" },
        { sataUserId: "u-quanly-cu", mucQuyen: "admin" },
      ],
      nguoiCuaCoSo: [LOC, DIEU],
      macDinhDungDuoc: [LOC, DIEU],
    });
    expect(ra).toEqual([{ sataUserId: LOC, mucQuyen: "chat" }]);
  });
});

describe("[PVN-05] hằng số — đổi ở đây là đổi CHÍNH SÁCH, phải có chủ đích", () => {
  it("ba mức, đúng thứ tự hẹp → rộng", () => {
    // `rongHon` dựa vào CHÍNH thứ tự này. Xáo nó là đảo luật mà không ai thấy.
    expect([...MUC_QUYEN]).toEqual(["read", "chat", "admin"]);
  });

  it("`VAI_QUAN_LY_CO_SO` là NHÃN — không được xuất hiện trong luật quyền", () => {
    expect([...VAI_QUAN_LY_CO_SO]).toEqual(["CENTER_MANAGER"]);

    // 🔴 LƯỚI GHIM MÃ NGUỒN. Thứ cần khẳng định là "hàm chính sách KHÔNG đụng tới hằng
    // nhãn" — không đầu vào nào chứng minh được điều đó, vì hàm không nhận tham số
    // `quanLyCoSo` nữa; một nhánh mới đọc hằng trực tiếp sẽ không ca nào thấy.
    //
    // Nhánh "quản lý cơ sở admin tự động" đã bị chủ dự án gỡ 24/09. Thêm lại là đảo một
    // quyết định đã ký, VÀ làm nút "gỡ" trên màn thành lời hứa suông: bấm gỡ xong quản
    // lý vẫn thấy nick.
    const than = thanHamChinhSach();
    expect(than, "hàm chính sách đọc hằng NHÃN ⇒ nhánh tự-động đã quay lại").not.toContain(
      "VAI_QUAN_LY_CO_SO",
    );
    expect(than, "tham số `quanLyCoSo` đã bị gỡ khỏi hợp đồng hàm").not.toContain(
      "quanLyCoSo",
    );
    // Đối chứng: lưới còn NEO ĐÚNG CHỖ (bóc chú thích không làm rỗng thân hàm).
    expect(than).toContain("macDinhDungDuoc");

    // ⚠️ GIỚI HẠN ĐÃ ĐO, đừng tin quá: ca này chỉ bắt dạng "đọc thẳng hằng nhãn". Cấy
    // 24/09 cho thấy một bản tái tạo nhánh bằng `t.macDinhDungDuoc` (không nhắc hằng)
    // đi lọt qua đây — và bị 13 ca HÀNH VI ở trên bắt, trong đó có `[PVN-02]`. Lưới
    // hành vi là lưới gánh; ca này chỉ là chốt phụ cho một lối viết cụ thể.
  });

  it("nick chưa giao → mức `chat`, không phải `admin`", () => {
    expect(MUC_MAC_DINH_CHUA_GIAO).toBe("chat");
  });
});

describe("[PVN-06] thứ tự ỔN ĐỊNH — hai lượt liên tiếp ra cùng payload", () => {
  it("theo thứ tự `nguoiCuaCoSo`", () => {
    const t = {
      giaoTay: [
        { sataUserId: DIEU, mucQuyen: "read" as const },
        { sataUserId: TRANG, mucQuyen: "admin" as const },
      ],
      nguoiCuaCoSo: [DIEU, LOC, TRANG],
      macDinhDungDuoc: [DIEU, LOC, TRANG],
    };
    expect(nguoiDuocDungMotNick(t).map((x) => x.sataUserId)).toEqual([DIEU, TRANG]);
    expect(nguoiDuocDungMotNick(t)).toEqual(nguoiDuocDungMotNick(t));
  });
});

describe("[PVN-07] GIAO TAY ĐƯỢC ≠ MẶC ĐỊNH DÙNG ĐƯỢC — hai tập, hai nghĩa", () => {
  // 🔴 Chủ dự án chốt mở rộng tập GIAO TAY ra mọi nhân sự của cơ sở. Nhỡ mở luôn tập
  // MẶC ĐỊNH thì mọi giáo viên, kế toán… của cơ sở đọc được MỌI nick chưa giao — một
  // lượt nới quyền im lặng, không ai bấm nút nào, không triệu chứng nào.

  it("giáo viên GIAO TAY ĐƯỢC — dòng giao của họ có hiệu lực", () => {
    const ra = nguoiDuocDungMotNick({
      giaoTay: [{ sataUserId: HA, mucQuyen: "chat" }],
      nguoiCuaCoSo: CA_CO_SO,
      macDinhDungDuoc: MAC_DINH,
    });
    expect(ra).toEqual([{ sataUserId: HA, mucQuyen: "chat" }]);
  });

  it("nhưng KHÔNG tự động có mặt khi nick chưa giao ai", () => {
    // ĐỐI CHỨNG ÂM của ca ngay trên. Hai ca phải đi cùng nhau: ca trên một mình thì gỡ
    // hẳn `macDinhDungDuoc` (lặp trên `nguoiCuaCoSo`) vẫn xanh.
    const ra = nguoiDuocDungMotNick({
      giaoTay: KHONG_GIAO,
      nguoiCuaCoSo: CA_CO_SO,
      macDinhDungDuoc: MAC_DINH,
    });
    expect(ra.map((x) => x.sataUserId)).not.toContain(HA);
  });

  it("người trong tập MẶC ĐỊNH mà KHÔNG còn là nhân sự của cơ sở ⇒ rụng", () => {
    // Vế GỠ vẫn đo bằng `nguoiCuaCoSo`. Một tập mặc định cũ (tính từ lượt trước, hoặc
    // do người gọi truyền nhầm) không được phép hồi sinh người đã rời cơ sở.
    const ra = nguoiDuocDungMotNick({
      giaoTay: KHONG_GIAO,
      nguoiCuaCoSo: [LOC],
      macDinhDungDuoc: [LOC, "u-da-chuyen-co-so"],
    });
    expect(ra).toEqual([{ sataUserId: LOC, mucQuyen: "chat" }]);
  });
});
