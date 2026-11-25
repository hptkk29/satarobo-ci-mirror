// @vitest-environment node
/**
 * 🔴 LỐI VÀO của khu đào tạo nội bộ — hợp đồng.
 *
 * Tệp này tồn tại vì một bản kiểm đối chiếu mã thật (27/08/2026) cho ra kết quả
 * khó chịu: module gần đủ mã, 5992 test xanh, mà **chưa ai đi hết được một vòng
 * nào**. Không phải vì logic sai, mà vì thiếu đường đi:
 *
 *  · trang chủ khu là khung tạm 16 dòng với ĐÚNG 0 link, và mục menu "Học tập nội
 *    bộ" dẫn thẳng vào đó;
 *  · `/elearning/hoc/{enrollmentId}` chưa bao giờ có tệp, trong khi BA chỗ sinh
 *    thông báo trỏ vào nó — "được giao khoá", "quá hạn", và chuông;
 *  · `/elearning/soan-khoa` là link chết, nằm ngay dưới dòng bình luận "Trang không
 *    có lối vào thì chỉ người viết nó biết đường tới";
 *  · năm action khai xong rồi để đó, 0 màn nào gọi.
 *
 * Mỗi ca dưới đây khoá một mảnh của đường đi đó. Chúng rẻ, và chúng bắt được đúng
 * loại hỏng mà 5992 test kia không thấy: mã chạy đúng, nhưng không ai tới được.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const co = (p: string) => existsSync(join(ROOT, p));
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Thanh điều hướng nay nằm ở ba tệp: layout (HỎI quyền bằng `can()`), `menu.ts` (dựng mục — hàm thuần, có bảng
// test riêng ở menu-dieu-huong.test.ts) và `sidebar.tsx` (vẽ `<nav>`). Các ca dưới ghim LÝ LẼ — lối vào tồn tại
// và gác theo quyền — nên đọc cả ba, không ghim chỗ đặt chữ.
const navNguon = () =>
  [
    "app/(elearning)/elearning/layout.tsx",
    "app/(elearning)/elearning/_components/menu.ts",
    "app/(elearning)/elearning/_components/sidebar.tsx",
  ]
    .map(doc)
    .join("\n");

const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("🔴 ba route ĐÍCH phải tồn tại", () => {
  it("`/elearning/hoc/[enrollmentId]` — đích của ba thông báo", () => {
    // Thiếu nó thì bấm thông báo "được giao khoá" hay "quá hạn" = 404, và người học
    // không có đường nào vào bài trừ gõ tay URL hai đoạn — mà họ không biết
    // `lessonId`.
    expect(co("app/(elearning)/elearning/hoc/[enrollmentId]/page.tsx")).toBe(true);
  });

  it("`/elearning/soan-khoa` — đích của link trên màn chương trình", () => {
    expect(co("app/(elearning)/elearning/soan-khoa/page.tsx")).toBe(true);
  });

  it("và ba nơi sinh link vẫn trỏ đúng địa chỉ đó", () => {
    // Nếu ai đó đổi đường dẫn ở một bên mà quên bên kia, ca này đỏ.
    const notify = doc("lib/elearning/_handlers/notify.ts");
    const pending = doc("lib/pending-tasks.ts");
    expect(chiMa(notify)).toContain("/elearning/hoc/");
    // ⚠️ `pending-tasks` ghép URL qua `elearningHomeUrl()` vì chuông chạy CHÉO HOST
    // (từ khu admin sang khu e-learning), nên đường dẫn tuyệt đối là bắt buộc —
    // chuỗi `/elearning/hoc/` không xuất hiện nguyên vẹn ở đó. Canh phần đuôi.
    expect(chiMa(pending)).toContain("/hoc/${");
    expect(chiMa(doc("app/(elearning)/elearning/chuong-trinh/page.tsx"))).toContain(
      '"/elearning/soan-khoa"',
    );
  });
});

describe("🔴 trang chủ khu KHÔNG còn là khung tạm", () => {
  const home = doc("app/(elearning)/elearning/page.tsx");

  it("có dẫn đi đâu đó", () => {
    // Đích của mục menu "Học tập nội bộ". 0 link ở đây nghĩa là mọi màn đã dựng —
    // kho câu hỏi, đề thi, khung chấm, hàng đợi chấm, báo cáo — không ai tới được.
    expect(chiMa(home)).toContain("Link");
    expect(chiMa(home)).toContain("/elearning/hoc/");
  });

  it("KHÔNG còn câu 'đang được xây dựng'", () => {
    expect(home).not.toContain("đang được xây dựng");
  });

  it("dẫn tới màn dữ liệu cá nhân — nơi khiếu nại cờ xem video", () => {
    // Trước đó grep toàn kho ra 0 <Link> nào trỏ `/elearning/du-lieu-cua-toi`: cửa
    // sổ khiếu nại 14 ngày chạy im lặng rồi cron đêm tự chốt, trong khi người bị
    // gắn cờ không có đường nào tới chỗ khiếu nại.
    expect(chiMa(home)).toContain("/elearning/du-lieu-cua-toi");
  });
});

describe("🔴 layout có thanh điều hướng, và nó GÁC THEO QUYỀN", () => {
  const layout = navNguon();

  it("có thanh điều hướng", () => {
    expect(chiMa(layout)).toContain("<nav");
  });

  it("gác từng mục theo quyền, không hiện hết cho mọi người", () => {
    // Người học thuần thấy mục "Chấm bài" là thấy một cánh cửa họ mở ra sẽ bị từ
    // chối — và họ sẽ nghĩ mình mất quyền, chứ không nghĩ mục đó không dành cho mình.
    expect(chiMa(layout)).toContain('can(actor, "elearning:exam:grade")');
    expect(chiMa(layout)).toContain('can(actor, "elearning:content:author")');
    expect(chiMa(layout)).toContain('can(actor, "elearning:progress:view-all")');
  });
});

describe("🔴 năm action KHÔNG còn mồ côi", () => {
  const tsx = [
    "app/(elearning)/elearning/giao-bai/_components/assignment-list.tsx",
    "app/(elearning)/elearning/soan/_components/attendance-panel.tsx",
    "app/(elearning)/elearning/soan-khoa/_components/equivalence-panel.tsx",
  ].map(doc).join("\n");

  it.each([
    ["giaHanLuotGiaoAction", "người vận hành không có nút gia hạn"],
    ["thuHoiLuotGiaoAction", "không có nút thu hồi"],
    ["ghiNhanSuCoAction", "vai trực hỗ trợ QĐ-CDA-15 không có công cụ nào"],
    ["diemDanhBuoiAction", "bài LIVE_SESSION không bao giờ xong ⇒ khoá kết hợp kẹt"],
    ["congNhanTuongDuongAction", "số công nhận tương đương vĩnh viễn bằng 0"],
  ])("%s có màn hình gọi — nếu không: %s", (ten) => {
    expect(tsx).toContain(ten);
  });
});

describe("🔴 điểm danh buổi phải CUỘN lên cấp khoá", () => {
  it("`cauHinhDiemDanhBuoi` gọi `cuonKhoaSauKhiXongBai`", () => {
    // Ba đường ghi tiến độ khác đều gọi; đường điểm danh thì không. Hệ quả: tick
    // "đã dự" cho bài bắt buộc CUỐI vẫn để lượt ghi danh đứng ở `IN_PROGRESS` —
    // khoá không bao giờ hoàn thành, chứng nhận không có gì để cấp, và không ai tự
    // nhận ra: người tick thấy ô đã tích, người học thấy bài đã xong.
    expect(chiMa(doc("lib/elearning/equivalence.ts"))).toContain(
      "cuonKhoaSauKhiXongBai",
    );
  });
});

describe("🔴 cron nhắc phải GỬI THẬT, không chỉ ghi sổ", () => {
  const cron = doc("lib/elearning/cron-reminders.ts");

  it("có gọi đường gửi thông báo", () => {
    // Bản trước chỉ `update` dòng nhắc thành `SENT` rồi return. Cách hỏng của nó im
    // lặng và KHÔNG TỰ SỬA: sổ đã `SENT` nên lần quét sau bỏ qua — người học không
    // nhận một lời nhắc nào cho cả bảy mốc, còn báo cáo vận hành thấy "đã gửi" đủ.
    expect(chiMa(cron)).toContain("notifyStaff");
  });

  it("KHÔNG ghi cứng kênh EMAIL khi không gửi email", () => {
    // Một dòng sổ nói dối về việc đã làm — và nó là dòng người vận hành mở ra khi
    // người học báo "tôi không nhận được gì".
    expect(chiMa(cron)).not.toContain('["IN_APP", "EMAIL"]');
  });

  it("gửi được cho 0 người thì KHÔNG đánh dấu đã gửi", () => {
    expect(chiMa(cron)).toContain('kenh.length > 0 ? "SENT" : "PENDING"');
  });
});

describe("🔴 lời TỪ CHỐI phải kèm ĐƯỜNG ĐI", () => {
  const bai = doc("app/(elearning)/elearning/hoc/[enrollmentId]/[lessonId]/page.tsx");

  it("cổng đồng ý dẫn thẳng tới chỗ xác nhận", () => {
    // Bản trước: "Vào mục Dữ liệu của tôi để… rồi xác nhận" — và trang chỉ có đúng
    // một nút về trang chủ. Người mới được giao khoá bị chặn ở MỌI bài, đọc một câu
    // bảo đi đâu đó, rồi tự đi tìm; thanh điều hướng của người học thuần cũng không
    // có mục ấy. E2E `vong-hoc.spec.ts` chết ngay ca đầu vì chuyện này.
    expect(chiMa(bai)).toContain('href: "/elearning/du-lieu-cua-toi"');
  });

  it("bài buổi trực tiếp dẫn về đề cương — nơi thấy mình đã được điểm danh chưa", () => {
    expect(chiMa(bai)).toContain("Về đề cương khoá");
  });
});

describe("🔴 xác nhận xong thì màn hình phải THÔI nói là chưa", () => {
  const nut = doc(
    "app/(elearning)/elearning/du-lieu-cua-toi/_components/accept-policy-button.tsx",
  );

  it("gọi `router.refresh()` sau khi xác nhận", () => {
    // Không refresh thì đoạn văn phía trên — do máy chủ dựng — vẫn giữ nguyên câu
    // "Bạn chưa xác nhận bản nào", ngay trên dòng "✓ Đã xác nhận". Màn hình tự cãi
    // nhau, và người dùng được bảo tự tải lại trang.
    expect(chiMa(nut)).toContain("router.refresh()");
  });

  it("KHÔNG còn bắt người dùng tự tải lại trang", () => {
    expect(nut).not.toContain("Tải lại trang để xem mốc thời gian");
  });
});

describe("🔴 e2e của khu phải THẬT SỰ mở trang", () => {
  it("không còn `test.fixme` trong bộ e2e e-learning", () => {
    // Hai spec duy nhất của khu (`employee-gate`, `host-routing`) từng đều là
    // `fixme`: job CI `e2e-elearning` chạy mỗi lần, XANH mỗi lần, và chưa từng mở
    // một trang e-learning nào. Một job xanh không kiểm gì tệ hơn không có job, vì
    // nó phát ra tín hiệu an toàn.
    for (const f of [
      "tests/e2e/elearning/employee-gate.spec.ts",
      "tests/e2e/elearning/host-routing.spec.ts",
      "tests/e2e/elearning/vong-hoc.spec.ts",
    ]) {
      expect(co(f), f).toBe(true);
      expect(chiMa(doc(f)), f).not.toContain("test.fixme");
    }
  });
});

describe("🔴 EL-17 — yêu cầu đào tạo và ma trận phải CÓ CỬA", () => {
  it("khoá `requirement:manage` KHÔNG còn mồ côi", () => {
    // Trước EL-17: khoá quyền có từ EL-02, `trnRequirementCreateSchema` viết xong ở
    // EL-03, và không action nào gọi — tức mẫu số của toàn bộ North Star Metric chỉ
    // khai được bằng seed hoặc SQL tay.
    expect(chiMa(doc("lib/elearning/requirement-authoring.ts"))).toContain(
      '"elearning:requirement:manage"',
    );
    expect(
      chiMa(doc("app/(elearning)/elearning/yeu-cau/_components/requirement-form.tsx")),
    ).toContain("khaiYeuCauAction");
  });

  it("hai màn tồn tại và nối vào thanh điều hướng", () => {
    expect(co("app/(elearning)/elearning/yeu-cau/page.tsx")).toBe(true);
    expect(co("app/(elearning)/elearning/ma-tran/page.tsx")).toBe(true);
    const layout = chiMa(navNguon());
    expect(layout).toContain('"/elearning/yeu-cau"');
    expect(layout).toContain('"/elearning/ma-tran"');
  });

  it("🔴 biểu mẫu KHÔNG mời chọn phạm vi `POSITION`", () => {
    // Bảng `Position` rỗng trên prod ⇒ yêu cầu khai theo vị trí áp cho 0 người và
    // KHÔNG báo lỗi: ma trận chỉ hiện một hàng ô lạ, người khai tưởng đã xong việc.
    // Kế hoạch chốt "lựa chọn POSITION bị vô hiệu hoá CÓ LÝ DO" (EL-03 AC14).
    const form = chiMa(
      doc("app/(elearning)/elearning/yeu-cau/_components/requirement-form.tsx"),
    );
    expect(form).not.toContain('ma: "POSITION"');
    // Và phải NÓI vì sao không có — người đi tìm nó sẽ báo là hệ thống thiếu chức năng.
    expect(form).toContain("theo vị trí");
  });

  it("ma trận vẽ ĐỦ BỐN trạng thái, không gộp xám với 'chưa đối chiếu được'", () => {
    // Ô xám là một CÂU TRẢ LỜI (yêu cầu không phải của người này); ô "chưa đối chiếu
    // được" thì ngược lại. Vẽ cùng màu là biến khoảng trống dữ liệu thành kết luận
    // về một con người.
    const mt = chiMa(doc("app/(elearning)/elearning/ma-tran/page.tsx"));
    for (const k of ["DAT", "CHUA_DAT", "KHONG_AP_DUNG", "CHUA_DOI_CHIEU_DUOC"]) {
      expect(mt, k).toContain(k);
    }
  });

  it("ma trận in ngưỡng bằng NGƯỜI, không bằng phần trăm", () => {
    // Ở mẫu số 15, mỗi người là 6,7 điểm phần trăm — ngưỡng viết bằng phần trăm chỉ
    // tạo ảo giác chính xác.
    const mt = chiMa(doc("app/(elearning)/elearning/ma-tran/page.tsx"));
    expect(mt).toContain("12/15 người");
    expect(mt).toContain("nsmNguoi.cau");
  });

  it("chứng cứ 'đã đạt' lọc theo `validUntil`, KHÔNG theo cột `status`", () => {
    // Cột `status` là bộ nhớ đệm do cron cập nhật mỗi ngày; đọc nó là để ma trận vẽ
    // ĐẠT cho một chứng nhận đã hết hạn từ sáng nay.
    const q = chiMa(doc("lib/elearning/matrix-query.ts"));
    expect(q).toContain("validUntil: { gt: now }");
    expect(q).not.toContain('status: "VALID"');
  });
});

describe("🔴 EL-17 R4/R5 — hai báo cáo phải có lối vào", () => {
  it("hai màn tồn tại và nối vào thanh điều hướng", () => {
    // Không nối vào nav thì chúng chỉ tới được bằng cách gõ tay địa chỉ.
    expect(co("app/(elearning)/elearning/bao-cao-r4/page.tsx")).toBe(true);
    expect(co("app/(elearning)/elearning/bao-cao-r5/page.tsx")).toBe(true);
    const layout = chiMa(navNguon());
    expect(layout).toContain('"/elearning/bao-cao-r4"');
    expect(layout).toContain('"/elearning/bao-cao-r5"');
  });

  it("R4 gộp nhóm nhỏ, và NÓI vì sao gộp", () => {
    // Phép gộp nằm ở tầng đọc dữ liệu, không ở màn hình — màn chỉ vẽ.
    expect(chiMa(doc("lib/elearning/report-r45-query.ts"))).toContain("gopNhomNho");
    const r4 = doc("app/(elearning)/elearning/bao-cao-r4/page.tsx");
    // Không giải thích thì người đọc tưởng báo cáo thiếu phòng.
    expect(r4).toContain("Khối hỗ trợ");
  });

  it("R4 nói thẳng M5 là số XẤP XỈ", () => {
    // Một con số chính xác giả còn tệ hơn một con số kèm chú thích — người đọc sẽ ra
    // quyết định dựa trên nó.
    expect(doc("app/(elearning)/elearning/bao-cao-r4/page.tsx")).toContain("XẤP XỈ");
  });

  it("R5 tách 'chưa đủ dữ liệu' khỏi 'không có vấn đề'", () => {
    // Gộp hai cái là để người soạn đề tin rằng những câu chưa ai làm đã được kiểm.
    const r5 = doc("app/(elearning)/elearning/bao-cao-r5/page.tsx");
    expect(chiMa(r5)).toContain("canRaLai === null");
    expect(r5).toContain("chỉ là chưa đo được");
  });
});

describe("🔴 EL-21 — mức gắn đánh giá có cửa, và KHÔNG mở khoá thứ 18", () => {
  it("màn tồn tại, gọi action, và nối vào thanh điều hướng", () => {
    expect(co("app/(elearning)/elearning/muc-danh-gia/page.tsx")).toBe(true);
    expect(
      chiMa(doc("app/(elearning)/elearning/muc-danh-gia/_components/eval-link-form.tsx")),
    ).toContain("datMucGanDanhGiaAction");
    expect(chiMa(navNguon())).toContain(
      '"/elearning/muc-danh-gia"',
    );
  });

  it("dùng `program:manage`, KHÔNG khai khoá quyền mới", () => {
    // Bộ khoá `elearning:*` giữ đúng 17. Guard `registry/elearning.test.ts` bắt số
    // này, nhưng ca ở đây nói rõ Ý ĐỊNH — kiểm soát nằm ở hai chữ ký trong bản ghi.
    const el = chiMa(doc("lib/elearning/eval-link.ts"));
    expect(el).toContain('"elearning:program:manage"');
    expect(el).not.toContain("elearning:eval");
  });

  it("biểu mẫu liệt kê SÁU điều kiện TRƯỚC khi bấm, không giấu trong lỗi", () => {
    // Người bấm cần biết mình đang thiếu gì trước khi bấm, thay vì bấm rồi bị từ
    // chối và đoán.
    const form = chiMa(
      doc("app/(elearning)/elearning/muc-danh-gia/_components/eval-link-form.tsx"),
    );
    expect(form).toContain("Còn thiếu:");
    expect(form).toContain("tổng trọng số phải bằng 100");
  });

  it("màn nói rõ 'chỉ báo cáo' KHÔNG có nghĩa là im lặng", () => {
    // Người vận hành hay hiểu nhầm rằng bật chế độ này là tắt luôn nhắc nhở.
    const p = doc("app/(elearning)/elearning/muc-danh-gia/page.tsx");
    expect(p).toContain("vẫn");
    expect(p).toContain("không leo thang kỷ luật");
  });
});

describe("🔴 EL-21 — cổng cờ ELEARNING_EVAL_LINK_ENABLED phải có ở CẢ BA chỗ", () => {
  // Đặc tả: OFF ⇒ ẩn màn + chặn action. Thiếu một chỗ là một cửa hở: menu hiện mà trang
  // 404, hoặc trang ẩn mà action vẫn ghi được qua POST trực tiếp.
  it("menu, trang và action đều hỏi cờ", () => {
    const hoi = (p: string) => chiMa(doc(p)).includes("isElearningEvalLinkEnabled()");
    expect(hoi("app/(elearning)/elearning/layout.tsx"), "menu").toBe(true);
    expect(hoi("app/(elearning)/elearning/muc-danh-gia/page.tsx"), "trang").toBe(true);
    expect(hoi("lib/elearning/eval-link.ts"), "action").toBe(true);

  });
});

describe("🔴 EL-16 — chứng nhận phải có LỐI VÀO, cả hai phía", () => {
  it("người HỌC thấy chứng nhận của mình trên màn đề cương", () => {
    // Chứng nhận cấp TỰ ĐỘNG qua hàng đợi sự kiện. Không hiện ở đâu thì người học
    // không biết mình đã có, và đường tải PDF thành một cổng không cửa.
    const de = doc("app/(elearning)/elearning/hoc/[enrollmentId]/page.tsx");
    expect(chiMa(de)).toContain("/api/elearning/chung-nhan?id=");
    expect(chiMa(de)).toContain("kh.chungNhan");
  });

  it("có màn QUẢN LÝ chứng nhận, và nó gọi action thu hồi", () => {
    // `thuHoiChungNhanAction` đòi quyền `elearning:certificate:revoke`; không màn
    // nào gọi thì cái quyền ấy chỉ là một dòng trong bảng phân quyền — đúng cảnh
    // năm action mồ côi của EL-09.
    expect(co("app/(elearning)/elearning/chung-nhan/page.tsx")).toBe(true);
    expect(
      chiMa(doc("app/(elearning)/elearning/chung-nhan/_components/revoke-button.tsx")),
    ).toContain("thuHoiChungNhanAction");
  });

  it("thanh điều hướng có mục dẫn tới màn đó", () => {
    expect(chiMa(navNguon())).toContain(
      '"/elearning/chung-nhan"',
    );
  });

  it("nút thu hồi truyền `reason` ở THAM SỐ THỨ HAI, không nhét vào input", () => {
    // Schema là `.strict()`; nhét `reason` vào input sẽ bị zod bác ngay — và lỗi ấy
    // chỉ lộ khi có người bấm thật.
    expect(
      chiMa(doc("app/(elearning)/elearning/chung-nhan/_components/revoke-button.tsx")),
    ).toContain("{ reason: lyDo.trim() }");
  });

  it("trang xác minh CÔNG KHAI tồn tại và nằm NGOÀI segment gác đăng nhập", () => {
    // Đặt trong `elearning/` là dựng một trang công khai rồi khoá nó lại: mọi thứ
    // dưới đó đi qua layout đòi `auth()` + hồ sơ nhân sự.
    expect(co("app/(elearning)/xac-thuc/[token]/page.tsx")).toBe(true);
    expect(co("app/(elearning)/elearning/xac-thuc/[token]/page.tsx")).toBe(false);
  });

  it("trang xác minh KHÔNG cho lập chỉ mục", () => {
    // Địa chỉ mang token bí mật; để Google lập chỉ mục là biến "chỉ ai cầm QR mới
    // tra được" thành "tra Google là ra".
    expect(chiMa(doc("app/(elearning)/xac-thuc/[token]/page.tsx"))).toContain(
      "index: false",
    );
  });
});

describe("🔴 EL-16 — ba lỗ tự rà ra, mỗi lỗ một chốt", () => {
  it("cửa sổ quét của nhánh giao lại phải DRAIN — lọc `recertAssignedAt`", () => {
    // `status = EXPIRED` đúng vĩnh viễn. Không lọc thì sau khi tích đủ `LO` bản đã
    // xử lý xong, chúng chiếm trọn mỗi lượt quét và bản vừa hết hạn KHÔNG BAO GIỜ
    // tới lượt — cron vẫn chạy, vẫn báo 0 lỗi. Đúng lỗi đã xảy ra ở EL-15d.
    const cron = chiMa(doc("lib/elearning/cron-cert-expiry.ts"));
    expect(cron).toContain("recertAssignedAt: null");
    // Và phải đánh dấu cả nhánh KHÔNG giao lại, nếu không chúng nằm lại mãi.
    expect(
      (cron.match(/recertAssignedAt: now/g) ?? []).length,
      "phải đánh dấu ở cả ba nhánh: giao lại, đã có lượt vòng sau, thiếu cột đơn vị",
    ).toBeGreaterThanOrEqual(3);
  });

  it("số hiệu chứng nhận suy từ số LỚN NHẤT, không từ `count()`", () => {
    // Số hiệu chứng từ phải liên tục — kiểm toán hỏi "số 42 đâu" là câu hỏi thật.
    // `count()` cộng biến vòng lặp tạo lỗ mỗi lần đụng độ.
    const h = chiMa(doc("lib/elearning/_handlers/issue-certificate.ts"));
    expect(h).toContain('orderBy: { certCode: "desc" }');
    expect(h).not.toContain("const soTrongNam = await db.trnCertificate.count(");
  });

  it("khoá `certificate:issue` KHÔNG còn mồ côi, và có màn gọi", () => {
    expect(chiMa(doc("lib/elearning/certificate-issue-manual.ts"))).toContain(
      '"elearning:certificate:issue"',
    );
    expect(
      chiMa(doc("app/(elearning)/elearning/chung-nhan/_components/issue-button.tsx")),
    ).toContain("capChungNhanTayAction");
    // Và màn phải LIỆT KÊ được lượt chưa cấp, nếu không nút ấy không có chỗ bấm.
    expect(chiMa(doc("app/(elearning)/elearning/chung-nhan/page.tsx"))).toContain(
      "certificate: { is: null }",
    );
  });

  it("cấp tay ĐÓNG DẤU verifiedAt theo `completedAt`, không theo hôm nay", () => {
    // Lấy hôm nay làm mốc là đẩy hạn tái chứng nhận đi xa thêm đúng khoảng thời gian
    // hệ thống chậm trễ.
    const m = chiMa(doc("lib/elearning/certificate-issue-manual.ts"));
    expect(m).toContain("verifiedAt: gd.completedAt");
    expect(m).not.toContain("verifiedAt: new Date()");
  });
});

describe("🔴 EL-18 — cỗ máy tự động hoá phải NỐI ĐỦ, không có luật chết", () => {
  it("bốn kích hoạt đều CÓ NGUỒN PHÁT sự kiện", () => {
    // Một kích hoạt không ai phát sự kiện cho là một luật CHẾT: người vận hành khai
    // được, bật được, và nó không bao giờ chạy — không lỗi nào, chỉ im lặng.
    const h = chiMa(doc("lib/elearning/_handlers/automation-run.ts"));
    for (const ev of [
      "elearning.enrollment.completed",
      "elearning.certificate.expired",
      "elearning.requirement.applied",
      "elearning.employee.new",
    ]) {
      expect(h, ev).toContain(ev);
    }
    // …và mỗi sự kiện có một nơi PHÁT nó ra.
    expect(chiMa(doc("lib/elearning/rollup.ts"))).toContain(
      "elearning.enrollment.completed",
    );
    expect(chiMa(doc("lib/elearning/cron-cert-expiry.ts"))).toContain(
      "elearning.certificate.expired",
    );
    expect(chiMa(doc("lib/elearning/requirement-authoring.ts"))).toContain(
      "elearning.requirement.applied",
    );
    expect(chiMa(doc("lib/elearning/cron-nhan-su-moi.ts"))).toContain(
      "elearning.employee.new",
    );
  });

  it("handler ĐƯỢC ĐĂNG KÝ — không thì cả cỗ máy nằm im", () => {
    expect(chiMa(doc("lib/events/register.ts"))).toContain(
      "registerElearningAutomationHandlers()",
    );
  });

  it("quét nhân sự mới nằm trong khe cron ĐÃ CÓ, không xin khe thứ ba", () => {
    // Ngân sách module là đúng 2 khe (`vercel.json` giữ 25 tổng).
    expect(chiMa(doc("lib/elearning/cron-dem.ts"))).toContain("quetNhanSuMoi");
  });

  it("màn tồn tại, gọi action bật/tắt, và nối vào thanh điều hướng", () => {
    expect(co("app/(elearning)/elearning/tu-dong-hoa/page.tsx")).toBe(true);
    expect(
      chiMa(doc("app/(elearning)/elearning/tu-dong-hoa/_components/rule-toggle.tsx")),
    ).toContain("batTatLuatAction");
    expect(chiMa(navNguon())).toContain(
      '"/elearning/tu-dong-hoa"',
    );
  });

  it("luật LUÔN tạo ở trạng thái TẮT, bất kể người khai gửi gì", () => {
    // Không để một luật vừa gõ xong đã bắt đầu giao việc cho cả công ty ngay trong
    // request tạo nó.
    const a = chiMa(doc("lib/elearning/automation-authoring.ts"));
    expect(a).toContain("enabled: false");
  });

  it("nhật ký ghi CẢ những lần bỏ qua", () => {
    // Một cỗ máy chỉ ghi lúc nó làm gì đó không giải thích được vì sao nó KHÔNG làm.
    const h = chiMa(doc("lib/elearning/_handlers/automation-run.ts"));
    expect(h).toContain('outcome: "SKIPPED"');
    expect(h).toContain('outcome: "FAILED"');
  });
});

describe("🔴 EL-20 — R7 và ảnh chụp chỉ số", () => {
  it("màn R7 tồn tại và nối vào thanh điều hướng", () => {
    expect(co("app/(elearning)/elearning/bao-cao-r7/page.tsx")).toBe(true);
    expect(chiMa(navNguon())).toContain(
      '"/elearning/bao-cao-r7"',
    );
  });

  it("việc chốt ảnh chụp nằm trong khe cron ĐÃ CÓ", () => {
    // Ngân sách module là đúng 2 khe; `vercel.json` không được thêm tuyến nào.
    expect(chiMa(doc("lib/elearning/cron-dem.ts"))).toContain("chotAnhChup");
  });

  it("🔴 chạy lại KHÔNG ghi đè ảnh chụp cũ", () => {
    // Ảnh chụp là bất biến: số liệu quá khứ đổi (một lượt được gia hạn, một người
    // nghỉ) cũng không viết lại bản đã chụp. Ghi đè là đúng cái cả bảng này sinh ra
    // để tránh.
    const r = chiMa(doc("lib/elearning/metrics/snapshot-run.ts"));
    expect(r).toContain('"P2002"');
    expect(r).not.toContain("upsert");
  });

  it("R7 in DÒNG CHỮ khi chưa khai ngân sách, không in số 0", () => {
    expect(doc("app/(elearning)/elearning/bao-cao-r7/page.tsx")).toContain(
      "Chưa khai ngân sách",
    );
  });

  it("R7 có đủ HAI dòng chú thích chi phí bắt buộc", () => {
    expect(chiMa(doc("app/(elearning)/elearning/bao-cao-r7/page.tsx"))).toContain(
      "CHU_THICH_CHI_PHI",
    );
  });

  it("chiều tách nhóm dùng CHỨC DANH, không dùng vị trí", () => {
    // `Position` rỗng trên prod — tách theo vị trí cho ra đúng một nhóm rỗng và một
    // báo cáo trông như hỏng.
    const r = chiMa(doc("lib/elearning/metrics/snapshot-run.ts"));
    expect(r).toContain("snapJobTitle");
    expect(r).not.toContain("snapPositionId");
  });
});

describe("🔴 EL-18 — luật và lộ trình phải CÓ CỬA SOẠN, không chỉ có công tắc", () => {
  // `khaiLuatAction` và `soanLoTrinhAction` từng được export mà 0 màn gọi: cỗ máy có nút Bật/Tắt nhưng
  // không có cách khai luật nào ngoài SQL tay. Ticket "xong" mà người dùng không dùng được.
  it("trang tự động hoá dựng form khai luật và form soạn lộ trình cho người có quyền", () => {
    const p = chiMa(doc("app/(elearning)/elearning/tu-dong-hoa/page.tsx"));
    expect(p).toContain("<RuleForm");
    expect(p).toContain("<PathForm");
  });

  it("form khai luật gọi khaiLuatAction, form lộ trình gọi soanLoTrinhAction", () => {
    expect(
      chiMa(doc("app/(elearning)/elearning/tu-dong-hoa/_components/rule-form.tsx")),
    ).toContain("khaiLuatAction(");
    expect(
      chiMa(doc("app/(elearning)/elearning/tu-dong-hoa/_components/path-form.tsx")),
    ).toContain("soanLoTrinhAction(");
  });

  it("cả hai truyền `reason` ở THAM SỐ THỨ HAI (schema .strict()) và bắt ≥ 10 ký tự trước khi bấm", () => {
    for (const f of ["rule-form.tsx", "path-form.tsx"]) {
      const m = chiMa(doc(`app/(elearning)/elearning/tu-dong-hoa/_components/${f}`));
      expect(m, f).toContain("{ reason: lyDo.trim() }");
      expect(m, f).toContain("lyDo.trim().length < 10");
    }
  });

  it("form khai luật KHÔNG có ô nhập biểu thức tự do và KHÔNG có hành động chế tài", () => {
    const m = chiMa(doc("app/(elearning)/elearning/tu-dong-hoa/_components/rule-form.tsx"));
    for (const cam of ["GAN_CO_HO_SO", "TRU_DIEM_DANH_GIA", "BAO_KY_LUAT", "LEO_THANG", "eval(", "new Function"]) {
      expect(m, cam).not.toContain(cam);
    }
  });
});

describe("🔴 EL-05 — cờ tập ĐỘNG phải chặn cả CỬA lẫn ĐƯỜNG GHI", () => {
  // Cờ trước đây chỉ chặn đồng bộ đêm; wizard vẫn mời chọn "Động" và action vẫn sinh ghi danh ngay.
  it("trang giao bài truyền cờ vào wizard, wizard ẩn lựa chọn Động khi cờ tắt", () => {
    expect(chiMa(doc("app/(elearning)/elearning/giao-bai/page.tsx"))).toContain(
      "tapDongBat={isElearningDynamicAssignEnabled()}",
    );
    const w = chiMa(doc("app/(elearning)/elearning/giao-bai/_components/assign-wizard.tsx"));
    expect(w).toContain("props.tapDongBat");
    expect(w).toContain('value="DYNAMIC"');
  });

  it("action tạo lượt giao hỏi cờ TRƯỚC khi đọc / ghi", () => {
    const a = chiMa(doc("lib/elearning/assignment-create.ts"));
    expect(a).toContain("isElearningDynamicAssignEnabled()");
    expect(a.indexOf("isElearningDynamicAssignEnabled()")).toBeLessThan(a.indexOf("noNoiDung(db"));
  });
});
