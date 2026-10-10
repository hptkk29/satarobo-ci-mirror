// @vitest-environment node
/**
 * EL-13 — bộ luật gắn cờ.
 *
 * Bộ test này viết ngược với mọi bộ khác trong module: phần lớn case ở đây hỏi
 * **"có gắn cờ NHẦM không"**, không hỏi "có bắt được kẻ gian không".
 *
 * Vì hậu quả bất đối xứng. Bỏ sót một người đối phó = mất một lượt học hình thức.
 * Gắn cờ nhầm một người học thật = một cáo buộc về hành vi người lao động, có tên
 * người xử, có hồ sơ, và người bị gắn phải đi khiếu nại để gỡ. Một bên là lãng
 * phí; bên kia là tổn hại.
 */
import { describe, it, expect } from "vitest";
import {
  xetCo,
  hanKhieuNai,
  hanTraLoi,
  chuyenTrangThaiCo,
  hetCuaSoKhieuNai,
  CAU_LUAT,
  CUA_SO_KHIEU_NAI_NGAY,
  type SoLieuXet,
  type MaLuatCo,
} from "@/lib/elearning/watch-flag-rules";

/** Một người học THẬT, xem một bài 10 phút trong 11 phút đồng hồ. */
const THAT: SoLieuXet = {
  coveredSec: 600,
  contentSec: 600,
  totalWatchSec: 600,
  wallSec: 660,
  blockedSeekCount: 0,
  seekCount: 4,
  soNhip: 44,
  tranTocDo: 1.5,
};

const ma = (r: ReturnType<typeof xetCo>) => r.map((x) => x.ruleCode);

describe("KHÔNG gắn cờ người học thật", () => {
  it("xem một mạch, đúng tốc độ ⇒ không cờ nào", () => {
    expect(xetCo(THAT)).toEqual([]);
  });

  it("xem ở TRẦN tốc độ 1.5x ⇒ vẫn không cờ", () => {
    // Trần là mức ĐƯỢC PHÉP. Gắn cờ người dùng đúng quyền của họ là biến một
    // tính năng thành cái bẫy.
    expect(xetCo({ ...THAT, totalWatchSec: 600, coveredSec: 600, wallSec: 400 })).toEqual(
      [],
    );
  });

  it("tua LÙI nhiều lần để xem lại ⇒ không cờ", () => {
    // Luật đếm lượt BỊ CHẶN, không đếm lượt tua. Đếm lượt tua là phạt đúng người
    // chịu khó xem lại nhất.
    expect(xetCo({ ...THAT, seekCount: 60, blockedSeekCount: 0 })).toEqual([]);
  });

  it("mạng chậm làm nhịp cuối tới muộn ⇒ vẫn trong dung sai", () => {
    // `wallSec` đo tới nhịp cuối, mà nhịp cuối đi bằng `sendBeacon` và có thể tới
    // muộn. Đo chặt là gắn cờ người có mạng chậm.
    expect(xetCo({ ...THAT, wallSec: 430 })).toEqual([]);
  });

  it("phiên NGẮN không bị xét — mẫu số quá nhỏ", () => {
    // Mở bài rồi đóng ngay là chuyện thường ngày; mọi tỉ lệ trên 20 giây đều loạn.
    expect(xetCo({ ...THAT, wallSec: 20, totalWatchSec: 600 })).toEqual([]);
  });

  it("phiên ngắn cũng KHÔNG bị coi là dấu hiệu đáng ngờ", () => {
    // Trả mảng rỗng, không phải trả một cờ "không đủ dữ liệu".
    expect(xetCo({ ...THAT, wallSec: 5, soNhip: 0, coveredSec: 0 })).toEqual([]);
  });

  it("chưa xem gì ⇒ không cờ, không chia cho 0", () => {
    const r = xetCo({
      ...THAT,
      coveredSec: 0,
      totalWatchSec: 0,
      soNhip: 0,
      wallSec: 300,
    });
    expect(r).toEqual([]);
  });
});

describe("bắt được bất khả thi vật lý", () => {
  it("khai xem 10 phút nội dung trong 1 phút đồng hồ", () => {
    // Kể cả phát ở trần suốt phiên cũng không đi qua ngần đó nội dung.
    const r = xetCo({ ...THAT, totalWatchSec: 600, coveredSec: 600, wallSec: 61 });
    expect(ma(r)).toContain("WATCH_TIME_TOO_LOW");
  });

  it("phần phủ MỚI tăng nhanh hơn trần", () => {
    // Khác luật trên: người tua qua tua lại có thể có tổng giờ bình thường mà
    // phần phủ mới vẫn tăng vọt.
    const r = xetCo({ ...THAT, coveredSec: 600, totalWatchSec: 150, wallSec: 150 });
    expect(ma(r)).toContain("TOO_FAST");
  });

  it("nhịp dày gấp nhiều lần chu kỳ chuẩn", () => {
    // Trình phát gửi mỗi 15 giây; dày hơn nhiều nghĩa là nhịp không đến từ nó.
    const r = xetCo({ ...THAT, soNhip: 900, wallSec: 660 });
    expect(ma(r)).toContain("HEARTBEAT_FLOOD");
  });

  it("tua tới bị chặn liên tục", () => {
    const r = xetCo({ ...THAT, blockedSeekCount: 40 });
    expect(ma(r)).toContain("SEEK_ABUSE");
  });
});

describe("bằng chứng CHỈ chứa số — luật chống rò tầng 2 sang tầng 1", () => {
  it("mọi giá trị trong `evidenceJson` đều là số", () => {
    // `evidenceJson` KHÔNG bị dọn sau 90 ngày. Nhét bitmap thô hay nhật ký phiên
    // vào đây là vô hiệu hoá chính hạn dọn đó — bằng cách chép dữ liệu thô sang
    // một bảng không ai dọn.
    const r = xetCo({ ...THAT, totalWatchSec: 900, wallSec: 61, blockedSeekCount: 40 });
    expect(r.length).toBeGreaterThan(0);
    for (const c of r) {
      for (const [k, v] of Object.entries(c.evidenceJson)) {
        expect(typeof v, `${c.ruleCode}.${k}`).toBe("number");
        expect(Number.isFinite(v), `${c.ruleCode}.${k}`).toBe(true);
      }
    }
  });

  it("bằng chứng nói cả CON SỐ ĐO và NGƯỠNG", () => {
    // Chỉ ghi con số đo thì người khiếu nại không biết mình vượt cái gì, và người
    // xử phải đi tra lại luật của phiên bản code lúc đó.
    const r = xetCo({ ...THAT, blockedSeekCount: 40 });
    const e = r.find((x) => x.ruleCode === "SEEK_ABUSE")!.evidenceJson;
    expect(e.blockedSeekCount).toBe(40);
    expect(e.nguong).toBeGreaterThan(0);
  });

  it("mọi mã luật đều có câu tiếng Việt", () => {
    const moi: MaLuatCo[] = [
      "WATCH_TIME_TOO_LOW",
      "SEEK_ABUSE",
      "TOO_FAST",
      "HEARTBEAT_FLOOD",
    ];
    for (const m of moi) expect(CAU_LUAT[m], m).toBeTruthy();
  });
});

describe("hạn khiếu nại và hạn trả lời", () => {
  it("cửa sổ khiếu nại là 14 ngày lịch", () => {
    const mo = new Date("2026-08-25T10:00:00.000Z");
    const h = hanKhieuNai(mo);
    expect((h.getTime() - mo.getTime()) / 86_400_000).toBe(CUA_SO_KHIEU_NAI_NGAY);
  });

  it("🔴 hạn trả lời tính bằng NGÀY LÀM VIỆC, không phải ngày lịch", () => {
    // Khiếu nại gửi chiều thứ Sáu: cộng 5 ngày lịch ra thứ Tư, tức người xử chỉ
    // có 3 ngày làm việc thật. Và mỗi lần rơi vào cuối tuần lại ra một con số
    // khác — họ trễ hạn vì cách tính, không phải vì chậm.
    const thuSau = new Date("2026-08-28T10:00:00.000Z");
    expect(thuSau.getUTCDay()).toBe(5);
    const h = hanTraLoi(thuSau);
    // Thứ Sáu + 5 ngày làm việc = thứ Sáu tuần sau.
    expect(h.getUTCDay()).toBe(5);
    expect((h.getTime() - thuSau.getTime()) / 86_400_000).toBe(7);
  });

  it("khiếu nại thứ Hai ⇒ hạn thứ Hai tuần sau", () => {
    const thuHai = new Date("2026-08-24T10:00:00.000Z");
    expect(thuHai.getUTCDay()).toBe(1);
    const h = hanTraLoi(thuHai);
    expect(h.getUTCDay()).toBe(1);
  });

  it("hạn KHÔNG bao giờ rơi vào thứ Bảy hay Chủ nhật", () => {
    for (let i = 0; i < 14; i += 1) {
      const d = new Date(Date.UTC(2026, 7, 20 + i, 9));
      const thu = hanTraLoi(d).getUTCDay();
      expect(thu, d.toISOString()).not.toBe(0);
      expect(thu, d.toISOString()).not.toBe(6);
    }
  });

  it("hết cửa sổ thì nhận ra", () => {
    const han = new Date("2026-09-08T10:00:00.000Z");
    expect(hetCuaSoKhieuNai({ appealDeadline: han, now: new Date("2026-09-07T00:00:00Z") })).toBe(
      false,
    );
    expect(hetCuaSoKhieuNai({ appealDeadline: han, now: new Date("2026-09-09T00:00:00Z") })).toBe(
      true,
    );
  });
});

describe("máy trạng thái cờ", () => {
  const di = (hienTai: Parameters<typeof chuyenTrangThaiCo>[0]["hienTai"], hanhDong: Parameters<typeof chuyenTrangThaiCo>[0]["hanhDong"], lyDo?: string) =>
    chuyenTrangThaiCo({ hienTai, hanhDong, lyDo });

  it("OPEN → khiếu nại → APPEALED", () => {
    const r = di("OPEN", "KHIEU_NAI");
    expect(r.ok && r.status).toBe("APPEALED");
  });

  it("khiếu nại HAI LẦN thì lần sau bị từ chối", () => {
    expect(di("APPEALED", "KHIEU_NAI").ok).toBe(false);
  });

  it("gỡ cờ BẮT BUỘC có lý do", () => {
    // Gỡ mà không nói vì sao thì lần sau không ai biết luật sai ở đâu, và cùng
    // con số đó sẽ lại sinh ra cùng cái cờ đó.
    const thieu = di("APPEALED", "GO_CO");
    expect(thieu.ok).toBe(false);
    if (thieu.ok) return;
    expect(thieu.code).toBe("REASON_REQUIRED");
    expect(di("APPEALED", "GO_CO", "  ").ok).toBe(false);
    expect(di("APPEALED", "GO_CO", "Đo nhầm do đổi tệp video").ok).toBe(true);
  });

  it("cờ ĐÃ có quyết định thì không đổi được nữa", () => {
    for (const t of ["UPHELD", "REVOKED"] as const) {
      for (const h of ["KHIEU_NAI", "GIU_CO", "GO_CO", "CHOT_HET_HAN"] as const) {
        expect(di(t, h, "co ly do").ok, `${t}/${h}`).toBe(false);
      }
    }
  });

  it("🔴 chốt tự động CHỈ áp cho cờ chưa khiếu nại", () => {
    // Người đã khiếu nại thì đang chờ NGƯỜI XỬ. Chốt tự động ở đó là phạt họ vì
    // sự chậm trễ của phía bên kia.
    expect(di("OPEN", "CHOT_HET_HAN").ok).toBe(true);
    const daKn = di("APPEALED", "CHOT_HET_HAN");
    expect(daKn.ok).toBe(false);
    if (daKn.ok) return;
    expect(daKn.code).toBe("NOT_AUTO_CLOSABLE");
  });
});
