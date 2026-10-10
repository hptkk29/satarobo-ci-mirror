// @vitest-environment node
/**
 * EL-10 — chuẩn nộp tệp media.
 *
 * Case đáng giá nhất là case CUỐI: khẳng định bảng chuẩn của e-learning CHẶT HƠN
 * trần chung `UPLOAD_CONFIG.video`. Nó bắt được ngày ai đó "hợp nhất hai bảng cho
 * gọn" — một việc trông như dọn dẹp nhưng thực chất là nới trần video đào tạo lên
 * gấp 2,5 lần.
 */
import { describe, it, expect } from "vitest";
import {
  kiemChuanNopVideo,
  kiemChuanNopPhuDe,
  khoaMedia,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SEC,
  VIDEO_MIN_SEC,
  VIDEO_MIME,
  VIDEO_BYTE_MOI_GIAY,
  VIDEO_MAX_CANH_DAI,
  VIDEO_MAX_CANH_NGAN,
} from "@/lib/elearning/media-rules";
import { UPLOAD_CONFIG } from "@/lib/storage/upload-config";

const nop = (o: Partial<Parameters<typeof kiemChuanNopVideo>[0]> = {}) =>
  kiemChuanNopVideo({
    filename: "bai-1.mp4",
    mime: "video/mp4",
    sizeBytes: 50 * 1024 * 1024,
    durationSec: 300,
    rong: 1280,
    cao: 720,
    ...o,
  });

const MB = 1024 * 1024;

describe("định dạng — chỉ MP4, không nới", () => {
  it("mp4 hợp lệ thì cho qua", () => {
    expect(nop().ok).toBe(true);
  });

  it("`.mov` / `.webm` / `.mkv` đều bị từ chối", () => {
    // Mỗi định dạng thêm vào là một tổ hợp trình duyệt × hệ điều hành nữa phải
    // thử — và người phát hiện tổ hợp hỏng sẽ là người học, giữa buổi học.
    for (const [ten, mime] of [
      ["a.mov", "video/quicktime"],
      ["a.webm", "video/webm"],
      ["a.mkv", "video/x-matroska"],
    ] as const) {
      const r = nop({ filename: ten, mime });
      expect(r.ok, ten).toBe(false);
    }
  });

  it("mime đúng nhưng đuôi tệp lệch ⇒ từ chối", () => {
    const r = nop({ filename: "bai-1.mov" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SAI_DUOI_TEP");
  });

  it("đuôi viết HOA vẫn nhận", () => {
    // Người soạn tải từ điện thoại hay gặp `.MP4`. Từ chối vì chữ hoa là một
    // thông báo lỗi mà họ không hiểu nổi vì sao.
    expect(nop({ filename: "BAI-1.MP4" }).ok).toBe(true);
  });
});

describe("dung lượng — biên phải chính xác", () => {
  it("đúng bằng trần thì CÒN nhận", () => {
    // ⚠️ Phải kèm thời lượng đủ 15 phút: 200MB CHỈ đạt chuẩn ở đúng độ dài tối
    // đa. 200MB cho 5 phút là 40MB/phút — lọt trần dung lượng nhưng vỡ trần
    // MB/phút, và đó là chủ ý.
    expect(nop({ sizeBytes: VIDEO_MAX_BYTES, durationSec: VIDEO_MAX_SEC }).ok).toBe(true);
  });

  it("hơn trần đúng 1 byte thì từ chối", () => {
    const r = nop({ sizeBytes: VIDEO_MAX_BYTES + 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("QUA_LON");
  });

  it("thông báo nói SỐ MB và bảo phải làm gì", () => {
    // "Tệp quá lớn" không giúp gì; người soạn cần biết còn thiếu bao nhiêu và
    // cách xử.
    const r = nop({ sizeBytes: 300 * 1024 * 1024 });
    if (r.ok) return;
    expect(r.message).toContain("300MB");
    expect(r.message).toMatch(/nén|cắt/);
  });

  it("tệp rỗng bị từ chối", () => {
    expect(nop({ sizeBytes: 0 }).ok).toBe(false);
  });
});

describe("thời lượng", () => {
  it("đúng bằng trần thì CÒN nhận, hơn 1 giây thì không", () => {
    expect(nop({ durationSec: VIDEO_MAX_SEC }).ok).toBe(true);
    expect(nop({ durationSec: VIDEO_MAX_SEC + 1 }).ok).toBe(false);
  });

  it("đúng bằng sàn thì CÒN nhận, dưới 1 giây thì không", () => {
    // Đoạn 5 giây thì dung lượng phải nhỏ theo — 50MB cho 5 giây vỡ trần MB/phút.
    expect(nop({ durationSec: VIDEO_MIN_SEC, sizeBytes: 2 * MB }).ok).toBe(true);
    expect(nop({ durationSec: VIDEO_MIN_SEC - 1, sizeBytes: 2 * MB }).ok).toBe(false);
  });

  it("KHÔNG đọc được thời lượng ⇒ từ chối, không bỏ qua", () => {
    // Bỏ qua nghĩa là chuẩn "bài ngắn" chỉ áp cho ai trình duyệt đọc được thời
    // lượng — tức nó không còn là chuẩn.
    for (const v of [null, undefined]) {
      const r = nop({ durationSec: v });
      expect(r.ok, String(v)).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe("THIEU_THOI_LUONG");
    }
  });
});

describe("tốc độ bit — trần MB/phút", () => {
  it("60 giây nặng 200MB LỌT hai trần cũ nhưng bị trần MB/phút chặn", () => {
    // Đây chính là lỗ mà hai trần cũ để lại: dưới 200MB, dưới 15 phút, nhưng là
    // 200MB dữ liệu di động cho MỘT phút nội dung.
    const r = nop({ durationSec: 60, sizeBytes: 200 * MB });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("QUA_NANG");
  });

  it("thông báo nói con số của tệp VÀ con số trần", () => {
    // "Nén lại" suông thì người soạn đoán, và tải lại nhiều lượt.
    const r = nop({ durationSec: 600, sizeBytes: 150 * MB });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("15.0MB/phút");
    expect(r.message).toContain("13.3MB/phút");
  });

  it("150MB cho 10 phút bị chặn, 60MB cho 10 phút thì không", () => {
    // Con số của chính đặc tả: 150MB/10 phút = 15MB/phút, tức bản 360p cho mạng
    // di động lại NẶNG HƠN bản gốc 720p — vô lý về bản chất.
    expect(nop({ durationSec: 600, sizeBytes: 150 * MB }).ok).toBe(false);
    expect(nop({ durationSec: 600, sizeBytes: 60 * MB }).ok).toBe(true);
  });

  it("miễn cho đoạn ngắn: tính như thể video dài tối thiểu một phút", () => {
    // Không có mức miễn này thì đoạn 5 giây chỉ được nặng 1,1MB — trong khi đoạn
    // mở đầu 720p 5 giây nặng 2MB là chuyện thường.
    expect(nop({ durationSec: 5, sizeBytes: 2 * MB }).ok).toBe(true);
    // Nhưng mức miễn là MỘT phút, không phải vô hạn.
    expect(nop({ durationSec: 5, sizeBytes: 30 * MB }).ok).toBe(false);
  });

  it("trần MB/phút SUY RA từ hai trần đã có, không viết tay", () => {
    // Viết tay con số 13,3 là mở đường cho ba con số trôi khỏi nhau, và lúc đó
    // không ai biết con nào là chuẩn nộp thật.
    expect(VIDEO_BYTE_MOI_GIAY * VIDEO_MAX_SEC).toBe(VIDEO_MAX_BYTES);
  });
});

describe("độ phân giải — 720p là TRẦN, không phải sàn", () => {
  it("đúng 720p thì nhận, 1080p thì không", () => {
    expect(nop({ rong: 1280, cao: 720 }).ok).toBe(true);
    const r = nop({ rong: 1920, cao: 1080, sizeBytes: 10 * MB });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("QUA_NET");
  });

  it("NHỎ hơn 720p vẫn nhận — bản ghi màn hình 960×540 nhẹ hơn, chặn nó là chặn nhầm", () => {
    expect(nop({ rong: 960, cao: 540 }).ok).toBe(true);
    expect(nop({ rong: 640, cao: 360 }).ok).toBe(true);
  });

  it("video DỰNG DỌC bằng điện thoại (720×1280) vẫn nhận", () => {
    // So theo chiều rộng thì 720×1280 trông như "rộng 720, đạt" còn 1080×1920
    // trông như "rộng 1080, vượt" — nhưng so theo cạnh dài/cạnh ngắn mới đúng.
    expect(nop({ rong: 720, cao: 1280 }).ok).toBe(true);
    expect(nop({ rong: 1080, cao: 1920, sizeBytes: 10 * MB }).ok).toBe(false);
  });

  it("vượt ở CẠNH NÀO cũng bị chặn", () => {
    expect(nop({ rong: VIDEO_MAX_CANH_DAI + 1, cao: VIDEO_MAX_CANH_NGAN }).ok).toBe(false);
    expect(nop({ rong: VIDEO_MAX_CANH_DAI, cao: VIDEO_MAX_CANH_NGAN + 1 }).ok).toBe(false);
  });

  it("KHÔNG đọc được kích thước ⇒ từ chối, không bỏ qua", () => {
    // Cùng lý do với thời lượng: cho qua khi không đọc được nghĩa là ai muốn
    // lách chỉ cần nộp tệp mà bộ đọc không hiểu.
    for (const o of [{ rong: null }, { cao: null }]) {
      const r = nop(o);
      expect(r.ok, JSON.stringify(o)).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe("THIEU_DO_PHAN_GIAI");
    }
  });

  it("thông báo nói kích thước THẬT của tệp và nói rõ hệ KHÔNG hạ cỡ hộ", () => {
    const r = nop({ rong: 1920, cao: 1080, sizeBytes: 10 * MB });
    if (r.ok) return;
    expect(r.message).toContain("1920×1080");
    expect(r.message).toContain("KHÔNG hạ cỡ hộ");
  });
});

describe("phụ đề", () => {
  it("nhận `.vtt` và `.srt`", () => {
    for (const t of ["a.vtt", "a.srt", "A.VTT"]) {
      expect(kiemChuanNopPhuDe({ filename: t, sizeBytes: 1024 }).ok, t).toBe(true);
    }
  });

  it("đuôi khác bị từ chối", () => {
    expect(kiemChuanNopPhuDe({ filename: "a.txt", sizeBytes: 1024 }).ok).toBe(false);
  });

  it("tệp phụ đề quá lớn bị từ chối", () => {
    expect(
      kiemChuanNopPhuDe({ filename: "a.vtt", sizeBytes: 10 * 1024 * 1024 }).ok,
    ).toBe(false);
  });
});

describe("khoá lưu trên R2 KHÔNG mang tên tệp gốc", () => {
  it("khoá chỉ gồm loại, id bài và uuid", () => {
    // Tên tệp người soạn đặt có thể mang tên khách hàng, tên nhân sự, hay số
    // hiệu văn bản nội bộ — và khoá thì đi vào log, vào URL, vào mọi chỗ khó xoá.
    const k = khoaMedia({ lessonId: "les1", loai: "master", uuid: "u-1" });
    expect(k).toBe("elearning/master/les1/u-1.mp4");
    expect(k).not.toContain("bai-1");
  });

  it("ba loại tệp ra ba nhánh khoá khác nhau", () => {
    const ds = (["master", "caption", "audio"] as const).map((loai) =>
      khoaMedia({ lessonId: "l", loai, uuid: "u" }),
    );
    expect(new Set(ds).size).toBe(3);
  });

  it("mọi khoá nằm dưới tiền tố `elearning/`", () => {
    // Tiền tố là thứ cho phép đặt luật vòng đời và quét đối soát trên đúng phạm
    // vi của module, không đụng tệp của module khác trong cùng bucket.
    for (const loai of ["master", "caption", "audio"] as const) {
      expect(khoaMedia({ lessonId: "l", loai, uuid: "u" }).startsWith("elearning/")).toBe(
        true,
      );
    }
  });
});

describe("chuẩn e-learning phải CHẶT HƠN trần chung", () => {
  it("trần dung lượng nhỏ hơn `UPLOAD_CONFIG.video`", () => {
    // ⚠️ Case này canh việc "hợp nhất hai bảng cho gọn" — một việc trông như dọn
    // dẹp nhưng thực chất nới trần video đào tạo lên gấp 2,5 lần (500MB → 200MB
    // là con số thật đang chạy).
    expect(VIDEO_MAX_BYTES).toBeLessThan(UPLOAD_CONFIG.video.maxSize);
  });

  it("nhận ÍT định dạng hơn trần chung", () => {
    // Trần chung nhận mp4/webm/mov/avi; e-learning nhận đúng MỘT.
    expect(UPLOAD_CONFIG.video.allowedMimes.length).toBeGreaterThan(1);
    expect(UPLOAD_CONFIG.video.allowedMimes).toContain(VIDEO_MIME);
    for (const m of ["video/webm", "video/quicktime"]) {
      expect(
        kiemChuanNopVideo({
          filename: "a.mp4",
          mime: m,
          sizeBytes: 1024,
          durationSec: 60,
          rong: 1280,
          cao: 720,
        }).ok,
        m,
      ).toBe(false);
    }
  });

  it("trần chung KHÔNG có giới hạn thời lượng, e-learning có", () => {
    // Đây là chiều siết mà bảng chung không diễn tả được: nó chỉ biết byte và
    // mime, không biết video dài bao lâu.
    expect("maxDurationSec" in UPLOAD_CONFIG.video).toBe(false);
    expect(VIDEO_MAX_SEC).toBeGreaterThan(0);
  });
});
