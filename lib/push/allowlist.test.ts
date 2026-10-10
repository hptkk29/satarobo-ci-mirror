// Luật khớp "loại thông báo nào được rung điện thoại nhân viên". THUẦN, không DB.
//
// 13/09/2026 — danh sách chuyển từ HẰNG SỐ sang tham số vận hành (`push.tienToDuocDay`), nên
// bộ này đổi vai: nó không còn chốt "đang bật loại nào" (câu đó nay do người vận hành trả lời
// ở `/admin/cau-hinh-van-hanh`), mà chốt LUẬT KHỚP — thứ vẫn nằm trong mã và vẫn phải
// đúng dù danh sách có đổi thế nào. Phần kiểm giá trị mặc định vẫn giữ, xem ca đầu.

import { describe, expect, it } from "vitest";
import { duocDayPush, TIEN_TO_MAC_DINH } from "./allowlist";
import { SETTINGS } from "@/lib/settings/registry";

/** Danh sách dùng cho phần lớn ca dưới — đúng giá trị mặc định của hệ. */
const CHI_LEAD_MOI = ["lead.moi:"];

describe("[PUSH-D4-T10] luật khớp tiền tố", () => {
  it("mặc định của hệ đúng HAI tiền tố: lead.moi: và don.cho_duyet:", () => {
    // Ca này là một cái CHỐT, không phải phép lặp lại hằng số. `TIEN_TO_MAC_DINH` là thứ áp
    // dụng khi DB chưa có ai cấu hình gì — tức là ở MỌI môi trường mới dựng. Đổi nó là đổi
    // hành vi mặc định của cả hệ thống, nên phải làm đỏ một test và buộc người sửa đọc chú
    // thích ở `allowlist.ts` trước.
    //
    // 28/09/2026 — thêm `don.cho_duyet:` theo chốt của chủ dự án. Chú thích ở `allowlist.ts`
    // trả lời hai câu hỏi bắt buộc (tần suất / độ gấp); đọc nó trước khi đổi tiếp.
    expect(TIEN_TO_MAC_DINH).toEqual(["lead.moi:", "don.cho_duyet:"]);
  });

  it("registry `push.tienToDuocDay.default` NEO vào chính hằng này — không phải bản chép tay", () => {
    // 🔴 VÌ SAO CÓ CA NÀY [28/09/2026]: trước hôm nay danh sách tồn tại ở HAI nơi —
    // `TIEN_TO_MAC_DINH` (ca trên ghim) và `default:` trong `lib/settings/registry.ts`
    // (KHÔNG ai ghim). Đường chạy thật đọc cái THỨ HAI: `docTienToDuocDay()` gọi
    // `getGlobalSetting("push.tienToDuocDay")`, và khi DB trống thì giá trị trả về là
    // `default` của registry, KHÔNG phải cái hằng.
    //
    // Nên lệch hai bản là lệch CÂM đúng loại tệ nhất: ca trên vẫn xanh, chú thích vẫn đọc
    // như thật, mà hệ lại đẩy theo danh sách khác. Nay `default` là chính hằng này
    // (`toBe`, so ĐỊA CHỈ chứ không so nội dung — chép tay một mảng bằng nhau vẫn đỏ).
    expect(SETTINGS["push.tienToDuocDay"].default).toBe(TIEN_TO_MAC_DINH);
  });

  it("lead.moi:<id> ⇒ được đẩy", () => {
    expect(duocDayPush("lead.moi:clx123", CHI_LEAD_MOI)).toBe(true);
  });

  it("lead.nhap_lai: ⇒ KHÔNG — khoá của nó có Date.now(), 10 lần điền form là 10 lần rung máy", () => {
    expect(duocDayPush("lead.nhap_lai:clx123:1757325600000", CHI_LEAD_MOI)).toBe(false);
  });

  it("lead.pool_rong: ⇒ KHÔNG, dù cùng họ `lead.`", () => {
    // Khớp phải theo TIỀN TỐ đầy đủ. Nếu ai đó nới thành `startsWith("lead.")` thì cả ba loại
    // lead cùng lọt, gồm loại không có trần ở trên.
    expect(duocDayPush("lead.pool_rong:cs1", CHI_LEAD_MOI)).toBe(false);
  });

  it("dấu hai chấm là BẮT BUỘC — `lead.moi_gi_do` không được lọt", () => {
    // Bỏ dấu hai chấm là khớp cả những khoá chỉ tình cờ bắt đầu giống nhau, và luật khớp sẽ
    // lệch với `lib/notifications/catalog.ts` (cũng khoá theo tiền tố CÓ dấu hai chấm) — hai
    // bảng cùng đọc một khoá mà luật khớp khác nhau là loại lệch không ai nhìn thấy.
    expect(duocDayPush("lead.moi_gi_do:x", CHI_LEAD_MOI)).toBe(false);
    expect(duocDayPush("lead.moi", CHI_LEAD_MOI)).toBe(false);
  });

  it("mọi loại khác ⇒ KHÔNG khi chỉ bật lead.moi:", () => {
    for (const k of [
      "sla:SLA-1:lead1",
      "shift.brief:u1:2026-09-08",
      "conversation.message_posted:c1",
      "attendance.edited:s1",
      "trial.assigned:t1",
      "session.close-reminder:s1",
      "el.done:e1",
      "parent_request.created:p1",
    ]) {
      expect(duocDayPush(k, CHI_LEAD_MOI), k).toBe(false);
    }
  });

  it("chuỗi rỗng ⇒ KHÔNG, không ném", () => {
    expect(duocDayPush("", CHI_LEAD_MOI)).toBe(false);
  });
});

describe("[PUSH-D7-T20] danh sách đến từ cấu hình — luật khớp phải đúng với MỌI danh sách", () => {
  it("bật thêm một loại thì loại đó lọt, loại khác vẫn không", () => {
    const ds = ["lead.moi:", "sla:"];
    expect(duocDayPush("sla:SLA-1:lead1", ds)).toBe(true);
    expect(duocDayPush("lead.moi:x", ds)).toBe(true);
    expect(duocDayPush("shift.brief:u1:2026-09-08", ds)).toBe(false);
  });

  it("DANH SÁCH RỖNG ⇒ KHÔNG đẩy gì — rỗng là 'tắt hết', tuyệt đối không phải 'bật hết'", () => {
    // Đây là bất biến sống còn của cả module. Nếu ai đó viết `tienTo.length === 0 ? true : …`
    // (nghe rất hợp lý: "chưa cấu hình thì cứ gửi") thì lần đầu tiên có người bấm bỏ chọn hết
    // trên màn cấu hình, hệ thống sẽ đẩy TOÀN BỘ 51 loại thông báo vào điện thoại mọi nhân
    // viên. Không có nút hoàn tác cho việc đó.
    for (const k of ["lead.moi:x", "sla:y", "conversation.message_posted:c1", "request.decided:r1"]) {
      expect(duocDayPush(k, []), k).toBe(false);
    }
  });

  it("phần tử RỖNG trong danh sách KHÔNG được biến thành 'khớp tất'", () => {
    // `"".startsWith` luôn đúng ⇒ một chuỗi rỗng lọt vào danh sách là mở toang mọi loại. Nó
    // vào được bằng nhiều đường: dòng cũ trong DB ghi trước khi schema siết, hay một lần sửa
    // JSON bằng tay ở màn Cấu hình vận hành. Chặn ở CẢ hai tầng — tầng đọc (`cau-hinh-allowlist`)
    // lọc bỏ, và ngay tại luật khớp này.
    expect(duocDayPush("sla:y", [""])).toBe(false);
    expect(duocDayPush("sla:y", ["", "lead.moi:"])).toBe(false);
    expect(duocDayPush("lead.moi:x", ["", "lead.moi:"])).toBe(true);
  });

  it("khớp theo tiền tố DÀI hơn vẫn đúng khi bật loại con", () => {
    // `payment-reconcile:` có hai loại con. Bật đúng một con thì con kia không được lọt.
    const ds = ["payment-reconcile:unmatched:"];
    expect(duocDayPush("payment-reconcile:unmatched:p1", ds)).toBe(true);
    expect(duocDayPush("payment-reconcile:overdue-partial:p1", ds)).toBe(false);
  });
});
