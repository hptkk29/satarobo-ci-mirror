// @vitest-environment node
/**
 * EL-12a — hợp đồng nhịp xem video.
 *
 * Tệp này khoá HAI ĐẦU khỏi trôi khỏi nhau: trình phát (EL-11) tiêu thụ hợp đồng,
 * đường ghi (EL-12b) sinh ra nó. Nếu hai đầu hiểu khác nhau về một mã lỗi thì
 * trình phát hoặc thử lại mãi một lỗi không thể tự khỏi, hoặc bỏ cuộc trên một
 * lỗi chỉ cần trả lời một câu hỏi.
 */
import { describe, it, expect } from "vitest";
import {
  nhipXemSchema,
  HTTP_CUA_LOI,
  THONG_BAO_LOI,
  coTheThuLai,
  chanTuaToi,
  vuotTranTocDo,
  quyetDinhKhoaPhat,
  nhipDenMuon,
  TOC_DO_TOI_DA,
  type MaLoiNhip,
} from "@/lib/elearning/video-heartbeat-contract";

const MOI_MA: MaLoiNhip[] = [
  "TICKET_INVALID",
  "SEEK_BLOCKED",
  "RATE_TOO_HIGH",
  "SESSION_SUPERSEDED",
  "PAUSED_ATTENTION",
  "DUE_PASSED",
  "POLICY_NOT_ACCEPTED",
  "REVOKED",
];

const NHIP = {
  ve: "abc.def",
  enrollmentId: "en1",
  lessonId: "les1",
  tuSec: 0,
  denSec: 10,
  seq: 1,
  tocDo: 1,
  tabHien: true,
  viTriSec: 10,
};

describe("thân yêu cầu — chặn đầu vào vô lý ngay ở tầng nhập", () => {
  it("nhịp hợp lệ đi qua", () => {
    expect(nhipXemSchema.safeParse(NHIP).success).toBe(true);
  });

  it("khoá lạ bị từ chối (`.strict()`)", () => {
    // Nhận khoá lạ là để trình phát gửi trường mà server không hiểu, rồi hai bên
    // tưởng đã thoả thuận một thứ chưa ai làm.
    expect(nhipXemSchema.safeParse({ ...NHIP, laLung: 1 }).success).toBe(false);
  });

  it("tốc độ ngoài khoảng, thời gian âm, seq lẻ ⇒ từ chối", () => {
    for (const o of [
      { tocDo: 0 },
      { tocDo: 99 },
      { tuSec: -1 },
      { viTriSec: -5 },
      { seq: 1.5 },
    ]) {
      expect(nhipXemSchema.safeParse({ ...NHIP, ...o }).success, JSON.stringify(o)).toBe(
        false,
      );
    }
  });

  it("`tabHien` là trường BẮT BUỘC", () => {
    // Cơ chế "tự dừng khi rời tab" đứng trên nó; để tuỳ chọn là để client im lặng
    // bỏ qua cả cơ chế.
    const { tabHien: _bo, ...thieu } = NHIP;
    expect(nhipXemSchema.safeParse(thieu).success).toBe(false);
  });
});

describe("ánh xạ mã lỗi sang HTTP — khai đủ, không gộp", () => {
  it("MỌI mã đều có mã HTTP và câu tiếng Việt", () => {
    for (const m of MOI_MA) {
      expect(HTTP_CUA_LOI[m], m).toBeGreaterThan(0);
      expect(THONG_BAO_LOI[m], m).toBeTruthy();
      expect(THONG_BAO_LOI[m].length, m).toBeGreaterThan(15);
    }
  });

  it("không mã nào rơi vào 400 chung chung", () => {
    for (const m of MOI_MA) expect(HTTP_CUA_LOI[m], m).not.toBe(400);
  });

  it("403 = dừng hẳn, 409 = xử xong rồi thử lại", () => {
    // Gộp lại thì trình phát hoặc thử lại mãi một lỗi không thể tự khỏi, hoặc bỏ
    // cuộc trên một lỗi chỉ cần trả lời một câu hỏi.
    expect(coTheThuLai("PAUSED_ATTENTION")).toBe(true);
    expect(coTheThuLai("SEEK_BLOCKED")).toBe(true);
    expect(coTheThuLai("TICKET_INVALID")).toBe(false);
    expect(coTheThuLai("POLICY_NOT_ACCEPTED")).toBe(false);
  });

  it("quá hạn là 409, không phải 403", () => {
    // Người học được gia hạn rồi thử lại là đường bình thường; 403 nói với trình
    // phát rằng chuyện này không cứu được.
    expect(HTTP_CUA_LOI.DUE_PASSED).toBe(409);
  });
});

describe("cơ chế CHẶN TUA TỚI", () => {
  const tua = (o: Partial<Parameters<typeof chanTuaToi>[0]>) =>
    chanTuaToi({ batDauSec: 0, maxDaXemSec: 100, chanTua: true, ...o });

  it("nhảy tới vùng CHƯA xem ⇒ chặn", () => {
    expect(tua({ batDauSec: 500 })).toBe(true);
  });

  it("tua LÙI luôn được — xem lại là hành vi học bình thường", () => {
    expect(tua({ batDauSec: 10 })).toBe(false);
  });

  it("tua tới trong vùng ĐÃ xem cũng được", () => {
    // Không ai gian lận bằng cách nhảy tới chỗ mình đã xem rồi.
    expect(tua({ batDauSec: 99 })).toBe(false);
  });

  it("có dung sai — lệch vài giây là bình thường", () => {
    // Trình phát báo vị trí lệch vài trăm mili giây; chặn sát quá là chặn nhầm
    // người xem thật, liên tục.
    expect(tua({ batDauSec: 101 })).toBe(false);
    expect(tua({ batDauSec: 110 })).toBe(true);
  });

  it("khoá KHÔNG bật chặn tua ⇒ không chặn gì", () => {
    expect(tua({ batDauSec: 9999, chanTua: false })).toBe(false);
  });
});

describe("cơ chế TRẦN TỐC ĐỘ — kiểm ở SERVER", () => {
  it("vượt 1.5x thì chặn", () => {
    expect(vuotTranTocDo(2)).toBe(true);
    expect(vuotTranTocDo(4)).toBe(true);
  });

  it("đúng 1.5x thì cho", () => {
    expect(vuotTranTocDo(TOC_DO_TOI_DA)).toBe(false);
  });

  it("dung sai cho số thực của trình duyệt", () => {
    // `1.5000000000000002` là chuyện thường; chặn nó là chặn người dùng hợp lệ.
    expect(vuotTranTocDo(1.5000000000000002)).toBe(false);
  });

  it("chậm hơn bình thường thì không sao", () => {
    expect(vuotTranTocDo(0.5)).toBe(false);
  });
});

describe("cơ chế CHỐNG XEM SONG SONG — Redis chết thì VẪN CHO HỌC", () => {
  it("khoá của người khác đang giữ ⇒ chặn", () => {
    const r = quyetDinhKhoaPhat({ backend: "upstash", khoaThuocNguoiKhac: true });
    expect(r.cho).toBe(false);
    if (r.cho) return;
    expect(r.ma).toBe("SESSION_SUPERSEDED");
  });

  it("khoá của chính mình ⇒ cho", () => {
    expect(quyetDinhKhoaPhat({ backend: "upstash", khoaThuocNguoiKhac: false }).cho).toBe(
      true,
    );
  });

  it("🔴 backend KHÔNG phải upstash ⇒ VẪN CHO HỌC (chốt 24/08)", () => {
    // Một sự cố hạ tầng không được biến thành cả công ty ngừng học, nhất là khi
    // khoá tuân thủ có hạn chót cứng và người học bị tính quá hạn vì lỗi không
    // phải của họ.
    for (const b of ["memory", "none", ""]) {
      const r = quyetDinhKhoaPhat({ backend: b, khoaThuocNguoiKhac: true });
      expect(r.cho, b).toBe(true);
    }
  });

  it("trả về `backend` để đường gọi ĐẾM ĐƯỢC, không nuốt im lặng", () => {
    // Cái giá của fail-open là một cửa sổ gian lận; nó phải nhìn thấy được.
    const r = quyetDinhKhoaPhat({ backend: "memory", khoaThuocNguoiKhac: true });
    expect(r.cho && r.backend).toBe("memory");
  });
});

describe("nhịp đến MUỘN thì bỏ qua", () => {
  it("seq nhỏ hơn hoặc bằng seq đã ghi ⇒ bỏ", () => {
    // Mạng chậm làm nhịp tới không đúng thứ tự; xử nhịp cũ sau nhịp mới là ghi
    // đè vị trí bằng dữ liệu quá khứ, và tiến độ nhảy lùi trên màn hình.
    expect(nhipDenMuon(3, 5)).toBe(true);
    expect(nhipDenMuon(5, 5)).toBe(true);
  });

  it("seq mới hơn thì nhận", () => {
    expect(nhipDenMuon(6, 5)).toBe(false);
  });
});
