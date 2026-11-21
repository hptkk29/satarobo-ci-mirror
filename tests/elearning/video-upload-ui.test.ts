// @vitest-environment node
/**
 * EL-10 — màn tải video + đường xác minh sau khi tải.
 *
 * Đây là mảnh nối trọn chuỗi EL-10. Ba thứ canh ở đây đều là "hỏng im lặng, tốn
 * tiền" hoặc "chặn nhầm người dùng".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

const UP = doc("app/(elearning)/elearning/soan/_components/video-uploader.tsx");
const XM = doc("app/api/elearning/media/xac-minh/route.ts");
const TRANG_SOAN = doc("app/(elearning)/elearning/soan/[lessonId]/page.tsx");
const TRANG_HOC = doc("app/(elearning)/elearning/hoc/[enrollmentId]/[lessonId]/page.tsx");

const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("lượt tải dở phải huỷ được, và có tiến độ", () => {
  it("có nút huỷ, và luồng huỷ đọc REF chứ không đọc state", () => {
    // `tai()` chạy trọn trong MỘT lượt kết xuất. `setDangHuy(...)` chỉ xếp lịch
    // cho lượt SAU, không đổi biến đã đóng gói trong chính lượt gọi này — nên
    // `if (dangHuy)` ở nhánh `catch` LUÔN thấy `null`, và lệnh huỷ không bao giờ
    // chạy. Không ai thấy bằng mắt: các phần đã tải nằm lại R2 và R2 TÍNH TIỀN
    // chúng, tới khi cron đêm dọn sau 24 giờ.
    expect(UP).toContain("Huỷ lượt tải");
    expect(chiMa(UP)).toContain('buoc: "huy"');
    expect(chiMa(UP)).toContain("if (luotTaiRef.current) await huy();");
    expect(chiMa(UP)).not.toContain("if (dangHuy) await huy();");

    // ⚠️ Bản trước của case này đòi mã nguồn chứa đúng chuỗi
    // `if (dangHuy) await huy()` — và nó XANH suốt trong khi hành vi thật là mã
    // CHẾT. Guard so chuỗi chứng minh CÓ VIẾT, không chứng minh CÓ CHẠY; bốn
    // dòng trên vẫn chỉ là so chuỗi, nên hành vi thật được canh bằng case
    // bấm-thật ở `_components/video-uploader.test.tsx` (dựng lượt tải hỏng giữa
    // chừng rồi soi lệnh đã gửi lên mạng).
  });

  it("có thanh tiến độ đếm theo SỐ PHẦN", () => {
    // Tệp 200MB qua mạng chậm kéo dài nhiều phút; không có tiến độ thì người soạn
    // không biết nó còn chạy hay đã treo, và họ sẽ bấm lại — tạo lượt tải thứ hai.
    expect(UP).toContain('role="progressbar"');
    expect(UP).toContain("Đang tải phần");
  });

  it("thanh tiến độ có thuộc tính cho trình đọc màn hình", () => {
    for (const a of ["aria-valuenow", "aria-valuemin", "aria-valuemax"]) {
      expect(UP, a).toContain(a);
    }
  });
});

describe("tải TUẦN TỰ, không mở 25 kết nối cùng lúc", () => {
  it("vòng lặp `for` tuần tự, không `Promise.all` trên các phần", () => {
    // Mạng của người soạn thường là mạng văn phòng dùng chung; mở 25 kết nối cùng
    // lúc làm chậm cả phòng.
    expect(chiMa(UP)).toContain("for (const l of ky.links)");
    expect(chiMa(UP)).not.toMatch(/Promise\.all\([\s\S]{0,80}links/);
  });

  it("thiếu ETag của một phần ⇒ báo lỗi, không hoàn tất", () => {
    // Hoàn tất với ETag rỗng là để R2 ghép một tệp thiếu phần.
    expect(UP).toContain("không nhận được mã xác nhận");
  });
});

describe("xác minh SAU khi tải là bước riêng, đọc từ TỆP", () => {
  it("màn tải gọi đường xác minh trước khi lưu bài", () => {
    const iXm = chiMa(UP).indexOf("/api/elearning/media/xac-minh");
    const iLuu = chiMa(UP).indexOf("luuBaiVideoAction(");
    expect(iXm).toBeGreaterThan(0);
    expect(iLuu).toBeGreaterThan(iXm);
  });

  it("thời lượng lưu vào bài là con số TỪ TỆP, không phải từ trình duyệt", () => {
    // Con số client khai có thể sai, hoặc bị sửa. Nó chỉ dùng chặn sớm.
    expect(chiMa(UP)).toContain("durationSec: Math.round(xm.data.durationSec)");
    // ⚠️ Canh HÀNH VI, không canh câu chữ trong chú thích: bản trước của case này
    // đòi mã nguồn chứa đúng một câu tiếng Việt, và nó đỏ ngay lần đầu ai đó viết
    // lại câu đó — báo động giả về một tệp không hề đổi hành vi.
    //
    // Điều thật sự phải giữ: con số trình duyệt khai (`tam?.giay`) chỉ đi vào
    // bước MỞ lượt tải để chặn sớm, tuyệt đối không đi vào lượt LƯU bài.
    const iLuuGoi = chiMa(UP).indexOf("luuBaiVideoAction({");
    const thanLuu = chiMa(UP).slice(iLuuGoi, iLuuGoi + 400);
    expect(thanLuu).not.toContain("tam?.giay");
    expect(thanLuu).not.toContain("tam.giay");
  });

  it("đường xác minh dùng bộ đọc mp4 đã test, có TRẦN lượt đọc", () => {
    // Một tệp dị dạng không được làm hàm chạy mãi.
    expect(XM).toContain("docMp4");
    expect(XM).toContain("TRAN_LUOT_DOC");
  });

  it("đối chiếu LẠI chuẩn nộp bằng con số thật", () => {
    expect(XM).toContain("kiemChuanNopVideo");
  });

  it("khoá phải thuộc đúng bài đang soạn", () => {
    expect(XM).toContain("elearning/master/${lessonId}/");
    expect(XM).toContain('khoa.includes("..")');
  });

  it("`transformToByteArray` ở đây là CHẤP NHẬN ĐƯỢC — có ghi lý do", () => {
    // Khác đường phát: mỗi lượt chỉ đọc vài chục KB đến 4MB, có trần, và không
    // nằm trên đường người học xem.
    expect(XM).toContain("transformToByteArray");
    expect(XM).toContain("ĐƯỢC dùng ở ĐÂY, khác đường phát");
  });
});

describe("chặn SỚM: trần 720p và trần MB/phút không đợi tải xong", () => {
  const TAI_LEN = doc("app/api/elearning/media/upload/route.ts");

  it("màn tải khai kích thước khung ngay ở bước MỞ lượt tải", () => {
    // Một tệp 1080p bị từ chối SAU khi tải xong nghĩa là người soạn đã trả giá cả
    // lượt tải 200MB qua mạng văn phòng chỉ để biết tệp không đạt chuẩn.
    expect(chiMa(UP)).toContain("v.videoWidth");
    expect(chiMa(UP)).toContain("rong: tam?.rong ?? null");
    expect(chiMa(UP)).toContain("cao: tam?.cao ?? null");
  });

  it("đường mở lượt tải truyền kích thước vào bảng chuẩn nộp", () => {
    expect(chiMa(TAI_LEN)).toContain("kiemChuanNopVideo");
    expect(chiMa(TAI_LEN)).toContain("rong: input.rong ?? null");
  });

  it("đường xác minh truyền kích thước ĐỌC TỪ TỆP, không truyền `null` cho xong", () => {
    // Truyền `null` ở đó là bỏ qua trần 720p — mà trần đó tồn tại vì hệ KHÔNG hạ
    // cỡ hộ: tệp nộp lên chính là tệp người học tải về.
    expect(chiMa(XM)).toContain("rong: kq.rong");
    expect(chiMa(XM)).toContain("cao: kq.cao");
  });

  it("màn soạn nói trần cho người soạn biết TRƯỚC khi chọn tệp", () => {
    expect(UP).toContain("720p");
    expect(UP).toContain("13,3MB");
  });
});

describe("mở màn SOẠN cho video KHÔNG mở màn HỌC", () => {
  it("màn soạn nhận bài `VIDEO`", () => {
    expect(TRANG_SOAN).toContain('lesson.kind === "VIDEO"');
    expect(TRANG_SOAN).toContain("VideoUploader");
  });

  it("trang HỌC vẫn chặn bài khác READ cho tới khi EL-11 có trình phát", () => {
    // Gỡ chặn sớm là đưa người học tới một trang trắng.
    expect(TRANG_HOC).toContain('lesson.kind !== "READ"');
  });

  it("màn soạn nói rõ trình phát thuộc ticket sau", () => {
    // Người soạn tải tệp xong mà người học chưa xem được thì phải biết vì sao,
    // không thì họ báo lỗi.
    expect(TRANG_SOAN).toContain("EL-11");
  });
});

describe("tuân luật route e-learning", () => {
  it("đường xác minh không `NextResponse.json` trần", () => {
    expect(chiMa(XM)).not.toContain("NextResponse.json");
    expect(XM).toContain('from "@/lib/api/response"');
  });

  it("gác quyền soạn nội dung", () => {
    expect(XM).toContain('can(actor, "elearning:content:author")');
  });
});
