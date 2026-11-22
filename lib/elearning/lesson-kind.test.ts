// @vitest-environment node
/**
 * Loại bài đã mở / chưa mở.
 *
 * Bộ test này canh MỘT bất biến: mọi giá trị của `TrnLessonKind` phải nằm ở đúng
 * một phía — đã mở, hoặc chưa mở kèm lý do. Thêm một loại vào enum mà quên khai ở
 * đây thì nó rơi vào khoảng trống: trình soạn không cho chọn (đúng), nhưng câu giải
 * thích cho người học là câu chung chung không nói được chờ ai.
 */
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  LOAI_BAI_DA_MO,
  LOAI_BAI_CHUA_MO,
  NHAN_LOAI_BAI,
  laLoaiBaiDaMo,
  loaiBaiChoTrinhSoan,
  vaySaoChuaMo,
  coManChoNguoiHoc,
  VI_SAO_KHONG_CO_MAN,
} from "@/lib/elearning/lesson-kind";

const MOI_LOAI = (
  Prisma.dmmf.datamodel.enums.find((e) => e.name === "TrnLessonKind")?.values ?? []
).map((v) => v.name);

describe("phân loại phủ trọn enum", () => {
  it("enum có giá trị (đọc từ DMMF, không chép tay)", () => {
    expect(MOI_LOAI.length).toBeGreaterThan(0);
  });

  it("MỌI loại nằm ở đúng MỘT phía", () => {
    for (const k of MOI_LOAI) {
      const mo = (LOAI_BAI_DA_MO as readonly string[]).includes(k);
      const dong = k in LOAI_BAI_CHUA_MO;
      expect(mo !== dong, `${k}: mở=${mo} đóng=${dong}`).toBe(true);
    }
  });

  it("mọi loại có nhãn tiếng Việt", () => {
    // Bài loại đã đóng (tạo từ trước) vẫn phải hiện nhãn đúng trên trình soạn —
    // hiện mã thô là để người soạn không nhận ra bài của mình.
    for (const k of MOI_LOAI) expect(NHAN_LOAI_BAI[k], k).toBeTruthy();
  });

  it("loại CHƯA mở phải nói CHỜ AI, không nói suông 'sắp có'", () => {
    // Người đọc cần biết chờ ticket nào; và khi ticket đó xong, người làm nó tìm
    // được đúng chỗ phải sửa.
    for (const [k, ly] of Object.entries(LOAI_BAI_CHUA_MO)) {
      expect(ly.length, k).toBeGreaterThan(10);
      expect(ly.toLowerCase(), k).not.toContain("sắp có");
    }
  });
});

describe("trình soạn chỉ thấy loại đã mở", () => {
  it("danh sách chọn KHÔNG chứa loại chưa có đường đi", () => {
    // Đây là con bẫy đã có thật: người soạn tạo bài "Bài kiểm tra", cổng xuất bản
    // không kiểm loại đó, khoá xuất bản trót lọt, và NGƯỜI HỌC là người phát hiện.
    const ds = loaiBaiChoTrinhSoan().map((x) => x.ma as string);
    for (const k of Object.keys(LOAI_BAI_CHUA_MO)) {
      expect(ds, k).not.toContain(k);
    }
  });

  it("và vẫn có ít nhất ba loại dùng được — không khoá sạch", () => {
    // Khoá quá tay thì trình soạn thành vô dụng; đây là vế "đừng chặn nhầm".
    expect(loaiBaiChoTrinhSoan().length).toBeGreaterThanOrEqual(3);
    expect(laLoaiBaiDaMo("READ")).toBe(true);
    expect(laLoaiBaiDaMo("VIDEO")).toBe(true);
  });

  it("`QUIZ` (EL-14d) và `TASK` (EL-15c) ĐÃ MỞ — mỗi cái đúng PR có đủ hai đầu", () => {
    // `QUIZ` mở ở PR có đường làm bài, không mở sớm ở PR chỉ dựng được đề.
    // `TASK` mở ở PR có ĐỦ BỐN mảnh: gắn khung · nộp · chấm · BÙ hạn khi chấm trễ.
    expect(laLoaiBaiDaMo("QUIZ")).toBe(true);
    expect(laLoaiBaiDaMo("TASK")).toBe(true);
    expect(LOAI_BAI_CHUA_MO.TASK).toBeUndefined();
  });

  it("🔴 `SCORM` VẪN đóng, và vẫn ghi rõ vì sao", () => {
    // Danh sách "chưa mở" không được rỗng đi một cách âm thầm: nó là chỗ người
    // soạn đọc để biết chờ ai.
    expect(laLoaiBaiDaMo("SCORM")).toBe(false);
    expect(LOAI_BAI_CHUA_MO.SCORM).toBeTruthy();
  });
});

describe("câu giải thích cho người học", () => {
  it("nói rõ loại nào và chờ ai", () => {
    const s = vaySaoChuaMo("SCORM");
    expect(s).toContain("SCORM");
    expect(s).toContain("chưa mở");
  });

  it("loại lạ vẫn ra câu đọc được, không ném", () => {
    expect(vaySaoChuaMo("LOAI_KHONG_CO")).toContain("chưa mở");
  });
});

/**
 * 🔴 "Module xử lý được loại này" ≠ "người HỌC có gì để mở".
 *
 * Hai khái niệm này từng là một, và cái giá đã trả: đề cương khoá dựng link cho
 * `LIVE_SESSION` theo `laLoaiBaiDaMo()`, người học bấm vào rồi nhận đúng một câu
 * "không có nội dung để xem ở đây" — trong khi dòng bình luận ngay chỗ dựng link nói
 * rõ là để tránh chuyện đó. E2E `vong-hoc.spec.ts` bắt được; 6009 test đơn vị thì
 * không, vì chúng kiểm hàm chứ không kiểm việc bấm vào rồi tới đâu.
 */
describe("loại nào có màn cho NGƯỜI HỌC", () => {
  it("mọi loại đã mở phải khai rõ: có màn, hoặc có lý do vì sao không", () => {
    // Đây là cái bẫy thật sự: thêm một loại bài mới, nhớ khai vào `LOAI_BAI_DA_MO`
    // (vì trình soạn cần), rồi quên khai ở đây ⇒ đề cương lặng lẽ dựng thêm một link
    // dẫn vào ngõ cụt. Ca này đỏ ngay lúc đó.
    for (const k of LOAI_BAI_DA_MO) {
      const coMan = coManChoNguoiHoc(k);
      const coLyDo = k in VI_SAO_KHONG_CO_MAN;
      expect(coMan !== coLyDo, `${k}: cóMàn=${coMan} cóLýDo=${coLyDo}`).toBe(true);
    }
  });

  it("LIVE_SESSION: module xử lý ĐỦ, nhưng người học không có gì để mở", () => {
    expect((LOAI_BAI_DA_MO as readonly string[]).includes("LIVE_SESSION")).toBe(true);
    expect(coManChoNguoiHoc("LIVE_SESSION")).toBe(false);
    // Lý do phải nói ai làm thay, không phải "chưa hỗ trợ" — người học đọc câu đó
    // trên đề cương và cần biết mình KHÔNG phải làm gì cả.
    expect(VI_SAO_KHONG_CO_MAN.LIVE_SESSION).toContain("giảng viên");
  });

  it("bài ĐỌC / VIDEO / KIỂM TRA / BÀI TẬP thì người học mở được", () => {
    for (const k of ["READ", "VIDEO", "QUIZ", "TASK"]) {
      expect(coManChoNguoiHoc(k), k).toBe(true);
    }
  });

  it("loại CHƯA mở thì đương nhiên không có màn cho người học", () => {
    for (const k of Object.keys(LOAI_BAI_CHUA_MO)) {
      expect(coManChoNguoiHoc(k), k).toBe(false);
    }
  });
});
