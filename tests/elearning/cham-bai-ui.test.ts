// @vitest-environment node
/**
 * EL-14e — màn chấm tay.
 *
 * Màn này là LỐI RA của `PENDING_GRADE`. Nếu nó không tồn tại, hoặc không ai tìm ra
 * đường tới nó, thì mọi lượt thi có câu tự luận treo vĩnh viễn — và đó chính là lý
 * do câu chấm tay từng bị chặn không cho vào đề.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

const HANG_CHO = doc("app/(elearning)/elearning/cham-bai/page.tsx");
const MOT_LUOT = doc("app/(elearning)/elearning/cham-bai/[attemptId]/page.tsx");
const FORM = doc("app/(elearning)/elearning/cham-bai/_components/grading-form.tsx");
const ACTIONS = doc("app/(elearning)/elearning/cham-bai/_actions.ts");
const DE_THI = doc("app/(elearning)/elearning/de-thi/page.tsx");
const SOAN_DE = doc("lib/elearning/exam-authoring.ts");

const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("🔴 cổng và cửa cùng PR — câu chấm tay chỉ mở khi đã có LỐI RA", () => {
  it("màn chấm tồn tại và gọi đúng đường ghi", () => {
    expect(chiMa(ACTIONS)).toContain("cauHinhChamLuotThi");
    expect(chiMa(FORM)).toContain("chamLuotThiAction");
  });

  it("và soạn đề KHÔNG còn chặn loại chấm tay", () => {
    // Chặn là đúng khi chưa có màn chấm; giữ nguyên khi đã có là khoá một tính năng
    // đã dựng xong. Hai chiều đi cùng nhau, không lệch pha.
    expect(chiMa(SOAN_DE)).not.toContain("CHUA_CO_DUONG_CHAM_TAY");
  });
});

describe("gác cửa bằng quyền RIÊNG của việc chấm", () => {
  it("cả hai trang gọi `elearning:exam:grade`", () => {
    for (const [ten, src] of [
      ["hàng chờ", HANG_CHO],
      ["một lượt", MOT_LUOT],
    ] as const) {
      expect(chiMa(src), ten).toContain('can(actor, "elearning:exam:grade")');
    }
  });

  it("đọc qua `scopedDb` — không `db` trần", () => {
    // Chấm bài của cơ sở khác là can thiệp vào hồ sơ nhân sự của họ, và không ai ở
    // đó biết. Cổng cách ly chính là lượt đọc.
    for (const src of [HANG_CHO, MOT_LUOT]) {
      expect(chiMa(src)).toContain("scopedDb(actor)");
      expect(chiMa(src)).not.toMatch(/from "@\/lib\/db"/);
    }
  });
});

describe("màn chấm không đẻ ra trạng thái nửa vời", () => {
  it("KHÔNG có nút lưu nháp", () => {
    // "Đã chấm một nửa" là trạng thái không cột nào mô tả được, và không ai biết
    // lượt đó còn chờ ai.
    expect(chiMa(FORM)).not.toMatch(/lưu nháp|luu nhap/i);
  });

  it("chặn nút chốt khi còn câu chưa cho điểm, và nói TRƯỚC", () => {
    expect(chiMa(FORM)).toContain("soTrong > 0");
    expect(FORM).toContain("chấm đủ rồi mới chốt được");
  });

  it("ô điểm trống KHÁC điểm 0 — không tự điền 0", () => {
    // Trống = chưa đọc; `0` = đã đọc và không cho điểm. Gộp hai thứ đó là chốt
    // trượt cho người chưa được ai đọc bài.
    expect(chiMa(FORM)).toContain('[c.examQuestionId, ""]');
  });
});

describe("câu chấm MÁY chỉ để đọc", () => {
  it("không dựng ô nhập điểm cho câu ĐÃ CÓ ĐIỂM", () => {
    // Cho sửa ở đây là mở một đường ghi đè im lặng lên một con số đã chốt, và hai
    // lượt cùng đề sẽ được chấm bằng hai thang.
    expect(chiMa(FORM)).toContain("c.daCoDiem ?");
  });

  it("🔴 lọc theo ĐIỂM, không theo LOẠI câu", () => {
    // Lọc theo loại thì câu trắc nghiệm hỏng nội dung không có ô nhập nào — màn
    // chấm rỗng, nút vẫn bật, và lượt thi kẹt vĩnh viễn.
    expect(chiMa(FORM)).toContain("filter((c) => !c.daCoDiem)");
    expect(chiMa(FORM)).not.toContain("mayCham)");
  });

  it("không còn ô nào để nhập ⇒ khoá nút và nói rõ, không dẫn vào ngõ cụt", () => {
    expect(chiMa(FORM)).toContain("canCham.length === 0");
    expect(FORM).toContain("báo kỹ");
  });

  it("chỉ gửi lên phần chấm tay", () => {
    expect(chiMa(FORM)).toContain("diem: canCham.map");
  });
});

describe("màn mới phải có LỐI VÀO", () => {
  it("màn đề thi dẫn tới hàng chờ chấm", () => {
    // Khu e-learning không có thanh điều hướng chung: trang không được trang nào
    // dẫn tới thì chỉ người viết nó biết đường.
    expect(chiMa(DE_THI)).toContain('href="/elearning/cham-bai"');
  });

  it("và nói luôn còn bao nhiêu bài chờ", () => {
    expect(chiMa(DE_THI)).toContain("demChoCham");
    expect(chiMa(DE_THI)).toContain('status: "PENDING_GRADE"');
  });

  it("hàng chờ có đường quay lại, không phải ngõ cụt", () => {
    expect(chiMa(HANG_CHO)).toContain('href="/elearning/de-thi"');
    expect(chiMa(MOT_LUOT)).toContain('href="/elearning/cham-bai"');
  });
});

describe("🔴 cổng CHẶN câu máy không đọc được, đặt ở lần cuối còn sửa", () => {
  it("kích hoạt đề soi được nội dung từng câu chấm máy", () => {
    // Sau khi kích hoạt, bộ câu đóng băng — không gỡ câu hỏng ra được nữa, mà mọi
    // lượt của mọi người trên đề đó sẽ treo ở `PENDING_GRADE`.
    expect(chiMa(SOAN_DE)).toContain("CAU_MAY_KHONG_DOC_DUOC");
  });

  it("và màn chấm nói cho người chấm biết câu nào rơi vào ca đó", () => {
    expect(chiMa(FORM)).toContain("mayKhongDocDuoc");
    expect(FORM).toContain("không đọc được nội dung câu này");
  });
});

describe("danh sách bị cắt thì nói ra", () => {
  it("hàng chờ báo khi còn bài ngoài danh sách", () => {
    expect(chiMa(HANG_CHO)).toContain("conNua");
  });

  it("huy hiệu ở màn đề thi đếm chặn ở đúng trần của hàng chờ", () => {
    // Đếm không giới hạn rồi hiện "247 bài" trong khi hàng chờ liệt kê 200 là hai
    // con số lệch nhau mà không ai giải thích được.
    expect(chiMa(DE_THI)).toContain("TRAN_HANG_CHO");
  });
});

describe("nói thật với người chấm", () => {
  it("hàng chờ rỗng ⇒ nói rõ, không để trang trắng", () => {
    expect(HANG_CHO).toContain("Không có bài nào đang chờ chấm");
  });

  it("mở một lượt đã bị người khác chấm ⇒ nói rõ, không trang trắng", () => {
    // Hai người cùng mở hàng chờ là chuyện thường; người tới sau phải hiểu vì sao.
    expect(MOT_LUOT).toContain("đã có người chấm xong");
  });

  it("báo trước rằng chốt là KHÔNG sửa lại được ở đây", () => {
    expect(FORM).toContain("Sửa lại cần một đường riêng");
  });
});
