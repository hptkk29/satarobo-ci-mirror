/**
 * [GDT] GẮN DANH TÍNH CHO DÒNG ĐƠN SAU KHI CHỐT LEAD — luật thuần.
 *
 * Bộ này canh những chỗ mà một bản "hợp lý" rất dễ gắn NHẦM (và gắn nhầm danh tính trên một đơn tiền là thứ
 * lộ ra muộn nhất, lúc hoàn tiền hoặc khi phụ huynh hỏi):
 *   · anh/chị em cùng phụ huynh, cùng khoá — mỗi dòng về ĐÚNG bé của nó;
 *   · đơn nhiều dòng / nhiều bé — không gắn chéo, `Order.studentId` để NULL;
 *   · ghi danh không duy nhất ⇒ KHÔNG đoán;
 *   · không bao giờ ĐÈ liên kết có sẵn;
 *   · chạy lại không đổi gì.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  lapKeHoachGanDanhTinh,
  type DongCanXet,
  type GhiDanhUngVien,
} from "./gan-danh-tinh-dong-don";

const CS1 = "center_1";
const CS2 = "center_2";
const SATA3 = "course_sata3";
const SATA4 = "course_sata4";
const BE_A = "lc_a";
const BE_B = "lc_b";

const dong = (over: Partial<DongCanXet> = {}): DongCanXet => ({
  itemId: "it1",
  orderId: "od1",
  orderCenterId: CS1,
  orderLeadChildId: null,
  soDongCuaDon: 1,
  soDongKhongPhaiKhoa: 0,
  leadChildId: BE_A,
  courseId: SATA3,
  studentId: null,
  enrollmentId: null,
  orderStudentId: null,
  ...over,
});

const gd = (over: Partial<GhiDanhUngVien> = {}): GhiDanhUngVien => ({
  enrollmentId: "en_a",
  studentId: "st_a",
  leadChildId: BE_A,
  courseId: SATA3,
  centerId: CS1,
  status: "ACTIVE",
  dongKhacDangGiu: new Set<string>(),
  donCoKhoanThu: new Set<string>(),
  dongDongCapChuaGan: new Set<string>(),
  ...over,
});

/** Đường CONVERT: chỉ cầu nối bé (luật cũ [GDT-*] giữ nguyên). */
const lapConvert = (d: readonly DongCanXet[], g: readonly GhiDanhUngVien[]) => lapKeHoachGanDanhTinh(d, g, { cauNoiHocVien: false });
/** Đường TẠO ĐƠN TAY / ghi danh sinh sau: thêm cầu nối theo học viên + hai lưới. */
const lapTay = (d: readonly DongCanXet[], g: readonly GhiDanhUngVien[]) => lapKeHoachGanDanhTinh(d, g, { cauNoiHocVien: true });

describe("[GDT] gắn danh tính dòng đơn", () => {
  it("[GDT-01] một bé, một dòng, một ghi danh ⇒ gắn đủ ba cột (dòng: học viên + ghi danh; đơn: học viên)", () => {
    const kh = lapConvert([dong()], [gd()]);
    expect(kh.dong).toEqual([{ itemId: "it1", orderId: "od1", studentId: "st_a", enrollmentId: "en_a" }]);
    expect(kh.don).toEqual([{ orderId: "od1", studentId: "st_a" }]);
    expect(kh.boQua).toEqual([]);
  });

  it("[GDT-02] ANH/CHỊ/EM cùng phụ huynh, cùng khoá: mỗi đơn về ĐÚNG bé của nó, không gắn chéo", () => {
    const d = [
      dong({ itemId: "it_a", orderId: "od_a", leadChildId: BE_A }),
      dong({ itemId: "it_b", orderId: "od_b", leadChildId: BE_B }),
    ];
    const g = [
      gd({ enrollmentId: "en_a", studentId: "st_a", leadChildId: BE_A }),
      gd({ enrollmentId: "en_b", studentId: "st_b", leadChildId: BE_B }),
    ];
    const kh = lapConvert(d, g);
    expect(kh.dong).toEqual([
      { itemId: "it_a", orderId: "od_a", studentId: "st_a", enrollmentId: "en_a" },
      { itemId: "it_b", orderId: "od_b", studentId: "st_b", enrollmentId: "en_b" },
    ]);
    expect(kh.don).toEqual([
      { orderId: "od_a", studentId: "st_a" },
      { orderId: "od_b", studentId: "st_b" },
    ]);
  });

  it("[GDT-03] ĐƠN HAI BÉ trong một đơn: mỗi dòng về đúng bé, nhưng `Order.studentId` để NULL (như `studentIdChoDon`)", () => {
    const d = [
      dong({ itemId: "it_a", soDongCuaDon: 2, leadChildId: BE_A }),
      dong({ itemId: "it_b", soDongCuaDon: 2, leadChildId: BE_B }),
    ];
    const g = [
      gd({ enrollmentId: "en_a", studentId: "st_a", leadChildId: BE_A }),
      gd({ enrollmentId: "en_b", studentId: "st_b", leadChildId: BE_B }),
    ];
    const kh = lapConvert(d, g);
    expect(kh.dong.map((p) => [p.itemId, p.studentId, p.enrollmentId])).toEqual([
      ["it_a", "st_a", "en_a"],
      ["it_b", "st_b", "en_b"],
    ]);
    expect(kh.don).toEqual([]);
  });

  it("[GDT-04] đơn hai dòng mà CHỈ MỘT bé đã có ghi danh ⇒ gắn dòng đó, dòng kia bỏ qua, đơn KHÔNG có học viên", () => {
    const d = [
      dong({ itemId: "it_a", soDongCuaDon: 2, leadChildId: BE_A }),
      dong({ itemId: "it_b", soDongCuaDon: 2, leadChildId: BE_B }),
    ];
    const kh = lapConvert(d, [gd()]);
    expect(kh.dong.map((p) => p.itemId)).toEqual(["it_a"]);
    expect(kh.boQua).toEqual([{ itemId: "it_b", ma: "CHUA_CO_GHI_DANH" }]);
    expect(kh.don).toEqual([]);
  });

  it("[GDT-05] ghi danh KHÔNG duy nhất (bé có hai ghi danh còn hiệu lực cùng khoá) ⇒ FAIL CLOSED, không đoán", () => {
    const kh = lapConvert(
      [dong()],
      [gd({ enrollmentId: "en_1" }), gd({ enrollmentId: "en_2" })],
    );
    expect(kh.dong).toEqual([]);
    expect(kh.don).toEqual([]);
    expect(kh.boQua).toEqual([{ itemId: "it1", ma: "NHIEU_GHI_DANH" }]);
  });

  it("[GDT-06] dòng KHÔNG khai khoá mà bé có ghi danh ở hai khoá ⇒ mơ hồ, không gắn", () => {
    const kh = lapConvert(
      [dong({ courseId: null })],
      [gd({ enrollmentId: "en_3", courseId: SATA3 }), gd({ enrollmentId: "en_4", courseId: SATA4 })],
    );
    expect(kh.dong).toEqual([]);
    expect(kh.boQua).toEqual([{ itemId: "it1", ma: "NHIEU_GHI_DANH" }]);
  });

  it("[GDT-07] đúng KHOÁ: ghi danh khoá khác của cùng bé không được nhận dòng này", () => {
    const kh = lapConvert([dong({ courseId: SATA3 })], [gd({ courseId: SATA4 })]);
    expect(kh.dong).toEqual([]);
    expect(kh.boQua).toEqual([{ itemId: "it1", ma: "CHUA_CO_GHI_DANH" }]);
  });

  it("[GDT-08] ghi danh đã CANCELLED / WITHDREW / TRANSFERRED không còn là suất hiện hành; còn một ghi danh sống thì chọn nó", () => {
    for (const st of ["CANCELLED", "WITHDREW", "TRANSFERRED"]) {
      const chiCu = lapConvert([dong()], [gd({ status: st })]);
      expect(chiCu.dong, st).toEqual([]);
      expect(chiCu.boQua, st).toEqual([{ itemId: "it1", ma: "CHUA_CO_GHI_DANH" }]);
    }
    const coMoi = lapConvert(
      [dong()],
      [gd({ enrollmentId: "en_cu", status: "TRANSFERRED" }), gd({ enrollmentId: "en_moi", status: "STUDYING" })],
    );
    expect(coMoi.dong[0]?.enrollmentId).toBe("en_moi");
  });

  it("[GDT-09] khác CƠ SỞ với đơn ⇒ không gắn; đơn không có cơ sở ⇒ cũng không gắn (không chứng minh được thì từ chối)", () => {
    expect(lapConvert([dong()], [gd({ centerId: CS2 })]).boQua).toEqual([
      { itemId: "it1", ma: "KHAC_CO_SO" },
    ]);
    expect(lapConvert([dong({ orderCenterId: null })], [gd()]).boQua).toEqual([
      { itemId: "it1", ma: "KHAC_CO_SO" },
    ]);
    expect(lapConvert([dong()], [gd({ centerId: null })]).boQua).toEqual([
      { itemId: "it1", ma: "KHAC_CO_SO" },
    ]);
  });

  it("[GDT-10] ghi danh đã thuộc DÒNG ĐƠN KHÁC ⇒ không gắn thêm; chính dòng này đang giữ thì không tính là 'khác'", () => {
    const khac = lapConvert([dong()], [gd({ dongKhacDangGiu: new Set(["it_khac"]) })]);
    expect(khac.dong).toEqual([]);
    expect(khac.boQua).toEqual([{ itemId: "it1", ma: "GHI_DANH_DA_GAN_DONG_KHAC" }]);
    const chinhNo = lapConvert([dong()], [gd({ dongKhacDangGiu: new Set(["it1"]) })]);
    expect(chinhNo.dong).toHaveLength(1);
  });

  it("[GDT-11] HAI dòng cùng nhắm một ghi danh (hai đơn cho một bé một khoá) ⇒ CẢ HAI bỏ qua", () => {
    const d = [
      dong({ itemId: "it_1", orderId: "od_1" }),
      dong({ itemId: "it_2", orderId: "od_2" }),
    ];
    const kh = lapConvert(d, [gd()]);
    expect(kh.dong).toEqual([]);
    expect(kh.don).toEqual([]);
    expect(kh.boQua.map((b) => [b.itemId, b.ma]).sort()).toEqual([
      ["it_1", "TRUNG_DONG"],
      ["it_2", "TRUNG_DONG"],
    ]);
  });

  it("[GDT-12] KHÔNG ĐÈ liên kết có sẵn: học viên/ghi danh khác với ứng viên ⇒ XUNG_DOT_LIEN_KET, không ghi gì", () => {
    expect(lapConvert([dong({ studentId: "st_khac" })], [gd()]).boQua).toEqual([
      { itemId: "it1", ma: "XUNG_DOT_LIEN_KET" },
    ]);
    expect(lapConvert([dong({ enrollmentId: "en_khac" })], [gd()]).boQua).toEqual([
      { itemId: "it1", ma: "XUNG_DOT_LIEN_KET" },
    ]);
  });

  it("[GDT-13] chỉ thiếu MỘT cột và cột còn lại ĐÚNG ⇒ chỉ ghi cột thiếu", () => {
    const a = lapConvert([dong({ studentId: "st_a" })], [gd()]);
    expect(a.dong).toEqual([{ itemId: "it1", orderId: "od1", enrollmentId: "en_a" }]);
    const b = lapConvert([dong({ enrollmentId: "en_a" })], [gd()]);
    expect(b.dong).toEqual([{ itemId: "it1", orderId: "od1", studentId: "st_a" }]);
  });

  it("[GDT-14] IDEMPOTENT: dòng đã đủ hai cột ⇒ không kế hoạch, không 'bỏ qua', và không ghi lại Order.studentId", () => {
    const kh = lapConvert(
      [dong({ studentId: "st_a", enrollmentId: "en_a", orderStudentId: "st_a" })],
      [gd({ dongKhacDangGiu: new Set(["it1"]) })],
    );
    expect(kh).toEqual({ dong: [], don: [], boQua: [] });
  });

  it("[GDT-15] không có cầu nối bé ⇒ KHÔNG khớp theo tên/thứ tự; `Order.leadChildId` chỉ dùng khi đơn có ĐÚNG MỘT dòng", () => {
    const khong = lapConvert([dong({ leadChildId: null })], [gd()]);
    expect(khong.dong).toEqual([]);
    expect(khong.boQua).toEqual([{ itemId: "it1", ma: "KHONG_CAU_NOI_BE" }]);

    const mot = lapConvert([dong({ leadChildId: null, orderLeadChildId: BE_A })], [gd()]);
    expect(mot.dong).toHaveLength(1);

    const hai = lapConvert(
      [dong({ leadChildId: null, orderLeadChildId: BE_A, soDongCuaDon: 2 })],
      [gd()],
    );
    expect(hai.dong).toEqual([]);
    expect(hai.boQua).toEqual([{ itemId: "it1", ma: "KHONG_CAU_NOI_BE" }]);
  });

  it("[GDT-16] bé KHÁC (anh/em) có ghi danh cùng khoá không được nhận dòng của bé này", () => {
    const kh = lapConvert(
      [dong({ leadChildId: BE_A })],
      [gd({ enrollmentId: "en_b", studentId: "st_b", leadChildId: BE_B })],
    );
    expect(kh.dong).toEqual([]);
    expect(kh.boQua).toEqual([{ itemId: "it1", ma: "CHUA_CO_GHI_DANH" }]);
  });

  it("[GDT-17] `Order.studentId`: đơn có dòng KHÔNG PHẢI khoá học ⇒ không suy; đã có giá trị ⇒ không đụng", () => {
    expect(lapConvert([dong({ soDongKhongPhaiKhoa: 1, soDongCuaDon: 2 })], [gd()]).don).toEqual([]);
    const coSan = lapConvert([dong({ orderStudentId: "st_la" })], [gd()]);
    expect(coSan.don).toEqual([]);
    expect(coSan.dong).toHaveLength(1);
  });

  it("[GDT-18] khoảng trắng trong mã bé/khoá không làm hỏng phép khớp", () => {
    const kh = lapConvert([dong({ leadChildId: ` ${BE_A} `, courseId: ` ${SATA3} ` })], [gd()]);
    expect(kh.dong).toHaveLength(1);
  });
});

// ── ĐƯỜNG TẠO ĐƠN TAY + GHI DANH SINH SAU (26/10/2026) ───────────────────────────────────────
// Ca owner yêu cầu cho `createOrderManualAction`: ghi danh có sẵn · ghi danh mới · anh/chị/em · nhiều dòng · ghi danh mơ hồ · renewal.
const dongTay = (over: Partial<DongCanXet> = {}): DongCanXet => dong({ leadChildId: null, studentId: "st_a", ...over });

describe("[GDM] gắn danh tính — đường TẠO ĐƠN TAY (cầu nối theo học viên + hai lưới)", () => {
  it("[GDM-01] GHI DANH CÓ SẴN: học viên đã chọn trên dòng + đúng một ghi danh cùng khoá/cơ sở ⇒ gắn `enrollmentId` (học viên giữ nguyên), `Order.studentId` điền khi còn NULL", () => {
    const kh = lapTay([dongTay()], [gd()]);
    expect(kh.dong).toEqual([{ itemId: "it1", orderId: "od1", enrollmentId: "en_a" }]);
    expect(kh.don).toEqual([{ orderId: "od1", studentId: "st_a" }]);
    expect(kh.boQua).toEqual([]);
  });

  it("[GDM-02] GHI DANH MỚI / chưa có: học viên chưa có ghi danh cùng khoá ⇒ CHUA_CO_GHI_DANH, KHÔNG ghi gì (đường 2 sẽ gắn khi ghi danh sinh ra)", () => {
    // `Order.studentId` đã được `createOrderManualAction` điền lúc tạo (studentIdChoDon) — mô hình đúng thực tế: orderStudentId đã có.
    const kh = lapTay([dongTay({ orderStudentId: "st_a" })], []);
    expect(kh.dong).toEqual([]);
    expect(kh.don).toEqual([]);
    expect(kh.boQua).toEqual([{ itemId: "it1", ma: "CHUA_CO_GHI_DANH" }]);
  });

  it("[GDM-03] ANH/CHỊ/EM trong MỘT đơn (hai dòng, hai học viên, cùng khoá): mỗi dòng về ghi danh của ĐÚNG học viên của nó, `Order.studentId` để NULL", () => {
    const d = [
      dongTay({ itemId: "it_a", soDongCuaDon: 2, studentId: "st_a" }),
      dongTay({ itemId: "it_b", soDongCuaDon: 2, studentId: "st_b" }),
    ];
    const g = [gd({ enrollmentId: "en_a", studentId: "st_a" }), gd({ enrollmentId: "en_b", studentId: "st_b" })];
    const kh = lapTay(d, g);
    expect(kh.dong).toEqual([
      { itemId: "it_a", orderId: "od1", enrollmentId: "en_a" },
      { itemId: "it_b", orderId: "od1", enrollmentId: "en_b" },
    ]);
    expect(kh.don).toEqual([]);
  });

  it("[GDM-04] NHIỀU DÒNG cùng một học viên: khác khoá ⇒ mỗi dòng về đúng khoá; CÙNG khoá hai dòng ⇒ TRUNG_DONG cả hai (không biết dòng nào là suất thật)", () => {
    const khacKhoa = lapTay(
      [
        dongTay({ itemId: "it_3", soDongCuaDon: 2, courseId: SATA3 }),
        dongTay({ itemId: "it_4", soDongCuaDon: 2, courseId: SATA4 }),
      ],
      [gd({ enrollmentId: "en_3", courseId: SATA3 }), gd({ enrollmentId: "en_4", courseId: SATA4 })],
    );
    expect(khacKhoa.dong.map((p) => [p.itemId, p.enrollmentId])).toEqual([["it_3", "en_3"], ["it_4", "en_4"]]);
    const cungKhoa = lapTay(
      [dongTay({ itemId: "it_1", soDongCuaDon: 2 }), dongTay({ itemId: "it_2", soDongCuaDon: 2 })],
      [gd()],
    );
    expect(cungKhoa.dong).toEqual([]);
    expect(cungKhoa.boQua.map((b) => [b.itemId, b.ma]).sort()).toEqual([["it_1", "TRUNG_DONG"], ["it_2", "TRUNG_DONG"]]);
  });

  it("[GDM-05] GHI DANH MƠ HỒ: học viên có HAI ghi danh còn hiệu lực cùng khoá ⇒ NHIEU_GHI_DANH, không ghi", () => {
    const kh = lapTay([dongTay()], [gd({ enrollmentId: "en_1" }), gd({ enrollmentId: "en_2" })]);
    expect(kh.dong).toEqual([]);
    expect(kh.boQua).toEqual([{ itemId: "it1", ma: "NHIEU_GHI_DANH" }]);
  });

  it("[GDM-06] RENEWAL: ghi danh COMPLETED không nhận lần MUA MỚI cùng khoá (đường tay); COMPLETED + ghi danh mới ⇒ chọn cái mới; ghi danh đang do dòng khác giữ ⇒ bỏ qua", () => {
    const chiCu = lapTay([dongTay()], [gd({ enrollmentId: "en_cu", status: "COMPLETED" })]);
    expect(chiCu.dong).toEqual([]);
    expect(chiCu.boQua).toEqual([{ itemId: "it1", ma: "CHUA_CO_GHI_DANH" }]);
    const coMoi = lapTay([dongTay()], [gd({ enrollmentId: "en_cu", status: "COMPLETED" }), gd({ enrollmentId: "en_moi", status: "PENDING" })]);
    expect(coMoi.dong[0]?.enrollmentId).toBe("en_moi");
    const biGiu = lapTay([dongTay()], [gd({ dongKhacDangGiu: new Set(["it_khac"]) })]);
    expect(biGiu.boQua).toEqual([{ itemId: "it1", ma: "GHI_DANH_DA_GAN_DONG_KHAC" }]);
    // đối chứng: đường CONVERT giữ hành vi cũ — COMPLETED vẫn là ứng viên (luật [GDT-08] không đổi)
    expect(lapConvert([dong()], [gd({ status: "COMPLETED" })]).dong).toHaveLength(1);
  });

  it("[GDM-07] khác CƠ SỞ / đơn không cơ sở ⇒ KHAC_CO_SO; dòng đã mang ghi danh KHÁC ⇒ XUNG_DOT_LIEN_KET (không đè); dòng đã đủ hai cột ⇒ idempotent", () => {
    expect(lapTay([dongTay()], [gd({ centerId: CS2 })]).boQua).toEqual([{ itemId: "it1", ma: "KHAC_CO_SO" }]);
    expect(lapTay([dongTay({ orderCenterId: null })], [gd()]).boQua).toEqual([{ itemId: "it1", ma: "KHAC_CO_SO" }]);
    // (dòng đã đủ CẢ HAI cột thì không bao giờ bị đụng; xung đột chỉ xảy ra khi thiếu một cột — ở đây: có ghi danh khác, chưa có học viên, nối qua bé)
    expect(lapTay([dong({ leadChildId: BE_A, enrollmentId: "en_khac" })], [gd()]).boQua).toEqual([{ itemId: "it1", ma: "XUNG_DOT_LIEN_KET" }]);
    expect(lapTay([dongTay({ enrollmentId: "en_a" })], [gd()]).dong).toEqual([]);
    expect(lapTay([dongTay({ enrollmentId: "en_a", orderStudentId: "st_a" })], [gd()])).toEqual({ dong: [], don: [], boQua: [] });
  });

  it("[GDM-08] CONVERT KHÔNG dùng cầu nối học viên: dòng chỉ có `studentId` (không bé) ⇒ KHONG_CAU_NOI_BE — giữ [GDT-15]/[CVG-09] nguyên", () => {
    const kh = lapConvert([dongTay()], [gd()]);
    expect(kh.dong).toEqual([]);
    expect(kh.boQua).toEqual([{ itemId: "it1", ma: "KHONG_CAU_NOI_BE" }]);
  });

  it("[GDM-09] LƯỚI 1 — ghi danh duy nhất của học viên đã có KHOẢN THU của đơn KHÁC ⇒ bỏ qua dù `dongKhacDangGiu` rỗng; khoản của CHÍNH đơn này thì vẫn gắn", () => {
    const khac = lapTay([dongTay()], [gd({ donCoKhoanThu: new Set(["od_cu"]) })]);
    expect(khac.dong).toEqual([]);
    expect(khac.boQua).toEqual([{ itemId: "it1", ma: "GHI_DANH_CO_KHOAN_DON_KHAC" }]);
    expect(lapTay([dongTay()], [gd({ donCoKhoanThu: new Set(["od1"]) })]).dong).toHaveLength(1);
  });

  it("[GDM-10] LƯỚI 2 — còn dòng ĐỒNG CẤP chưa gắn ở đơn khác (đơn cũ chưa từng được gắn) ⇒ dòng mới KHÔNG chiếm ghi danh; chính dòng này trong tập thì không tính", () => {
    const khac = lapTay([dongTay()], [gd({ dongDongCapChuaGan: new Set(["it_cu"]) })]);
    expect(khac.dong).toEqual([]);
    expect(khac.boQua).toEqual([{ itemId: "it1", ma: "DONG_DONG_CAP_CHUA_GAN" }]);
    expect(lapTay([dongTay()], [gd({ dongDongCapChuaGan: new Set(["it1"]) })]).dong).toHaveLength(1);
    expect(lapTay([dongTay()], [gd()]).dong).toHaveLength(1);
  });

  it("[GDM-11] hai lưới CHỈ áp ở đường tay: cùng dữ liệu đường CONVERT vẫn gắn (hành vi convert KHÔNG đổi)", () => {
    const g = gd({ donCoKhoanThu: new Set(["od_cu"]), dongDongCapChuaGan: new Set(["it_cu"]) });
    expect(lapConvert([dong()], [g]).dong).toHaveLength(1);
    expect(lapTay([dong()], [g]).dong).toEqual([]);
  });

  it("[GDM-13] cầu nối HỌC VIÊN mà dòng KHÔNG khai khoá ⇒ KHONG_RO_KHOA: không gắn vào ghi danh duy nhất của học viên (có thể là khoá khác); khai khoá đúng thì gắn (đối chứng dương). Đường convert (cầu nối bé) không đổi (review độc lập 26/10)", () => {
    const khongKhoa = lapTay([dong({ leadChildId: null, studentId: "st_a", courseId: null })], [gd({ courseId: "k4-khac" })]);
    expect(khongKhoa.dong).toEqual([]);
    expect(khongKhoa.boQua).toEqual([{ itemId: "it1", ma: "KHONG_RO_KHOA" }]);
    expect(lapTay([dong({ leadChildId: null, studentId: "st_a", courseId: SATA3 })], [gd()]).dong).toHaveLength(1); // có khoá, đúng khoá ⇒ gắn
    expect(lapTay([dong({ leadChildId: null, studentId: "st_a", courseId: SATA3 })], [gd({ courseId: "k4-khac" })]).dong).toEqual([]); // có khoá, sai khoá ⇒ không gắn
    // đường convert: dòng có bé mà không khai khoá vẫn gắn như cũ (hành vi của #971 giữ nguyên)
    expect(lapConvert([dong({ courseId: null })], [gd()]).dong).toHaveLength(1);
  });
  it("[GDM-12] dòng có BÉ (con của lead) vẫn gắn được ở đường tay; dòng có cả học viên A lẫn bé của B ⇒ XUNG_DOT_LIEN_KET, không đè", () => {
    expect(lapTay([dong({ leadChildId: BE_A })], [gd()]).dong).toHaveLength(1);
    const chong = lapTay([dong({ leadChildId: BE_B, studentId: "st_a" })], [gd({ enrollmentId: "en_b", studentId: "st_b", leadChildId: BE_B })]);
    expect(chong.dong).toEqual([]);
    expect(chong.boQua).toEqual([{ itemId: "it1", ma: "XUNG_DOT_LIEN_KET" }]);
  });
});

// ── DÂY NỐI ─────────────────────────────────────────────────────────────────────────────────
// Luật thuần xanh không chứng minh `convertLeadV2` GỌI nó, hay gọi ở ĐÚNG chỗ. Neo vào LỜI GỌI và THỨ TỰ,
// không neo vào chữ (mẫu "lưới ghim mã nguồn" trong CLAUDE.md).
const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .split(/\r?\n/)
    .filter((d) => !/^\s*(\/\/|\/\*|\*)/.test(d))
    .join("\n");

describe("[GDTW] dây nối trong convert", () => {
  const convert = doc("lib/crm/convert-lead-v2.ts");

  it("[GDTW-1] convertLeadV2 gọi ganDanhTinhDongDonCuaLead đúng MỘT lần, truyền `tx` (cùng transaction)", () => {
    expect(convert.split("ganDanhTinhDongDonCuaLead(tx,").length - 1).toBe(1);
  });

  it("[GDTW-2] lời gọi đứng SAU khi tạo Enrollment và TRƯỚC linkRecordedPaymentsToEnrollments (để phép chia tiền thấy học viên trên dòng)", () => {
    const viTriTaoGhiDanh = convert.indexOf("tx.enrollment.create(");
    const viTriGan = convert.indexOf("ganDanhTinhDongDonCuaLead(tx,");
    const viTriLink = convert.indexOf("linkRecordedPaymentsToEnrollments(tx,");
    const viTriChot = convert.indexOf("resolveClosedLeadChildIds(");
    expect(viTriTaoGhiDanh).toBeGreaterThan(0);
    expect(viTriGan).toBeGreaterThan(viTriTaoGhiDanh);
    expect(viTriLink).toBeGreaterThan(viTriGan);
    expect(viTriChot).toBeGreaterThan(viTriLink);
  });

  it("[GDTW-3] phần DB CHỈ ghi ba cột danh tính: không chạm Payment · ghi danh · Receipt · hoa hồng · giá", () => {
    const db = doc("lib/orders/gan-danh-tinh-dong-don-db.ts");
    expect(db).not.toMatch(/tx\.payment\b/);
    expect(db).not.toMatch(/tx\.enrollment\.(create|update|updateMany|delete|upsert)/);
    expect(db).not.toMatch(/tx\.receipt\b|issueReceipt|commission|Commission/);
    expect(db).not.toMatch(/listPrice|finalPrice|tuition|discount/);
    // Hai bảng được ghi, và cả ba lời ghi đều có điều kiện "đang NULL" trong where.
    expect(db.match(/tx\.orderItem\.updateMany\(/g)?.length).toBe(2);
    expect(db.match(/tx\.order\.updateMany\(/g)?.length).toBe(1);
    expect(db).toMatch(/where: \{ id: p\.itemId, studentId: null \}/);
    expect(db).toMatch(/where: \{ id: p\.itemId, enrollmentId: null \}/);
    expect(db).toMatch(/where: \{ id: o\.id, studentId: null \}/);
  });

  it("[GDTW-4] bé trên dòng đơn chỉ được tin khi THUỘC lead (leadChild.leadId) — metadata do client gửi", () => {
    const db = doc("lib/orders/gan-danh-tinh-dong-don-db.ts");
    expect(db).toMatch(/tx\.leadChild\.findMany\(\{ where: \{ id: \{ in: beUng \}, leadId \}/);
  });
});

describe("[GDMW] dây nối đường TẠO ĐƠN TAY + GHI DANH SINH SAU", () => {
  const donTay = doc("app/(admin)/admin/orders/_actions.ts");
  const ghiDanh = doc("app/(admin)/admin/enrollments/_actions.ts");
  const nhomLop = doc("app/(admin)/admin/class-groups/_actions.ts");
  const dbTay = doc("lib/orders/gan-danh-tinh-don-tay-db.ts");
  const dbConvert = doc("lib/orders/gan-danh-tinh-dong-don-db.ts");

  it("[GDMW-1] createOrderManualAction gọi ganDanhTinhDonMoiTao đúng MỘT lần, truyền `tx`, SAU tx.order.create + ensureFullOrderRequest và TRƯỚC khối khuyến mãi + audit CREATE; CHỈ khi loại đơn là COURSE", () => {
    expect(donTay.split("ganDanhTinhDonMoiTao(tx,").length - 1).toBe(1);
    const taoDon = donTay.indexOf("tx.order.create(");
    const phieu = donTay.indexOf("ensureFullOrderRequest(tx,");
    const goi = donTay.indexOf("ganDanhTinhDonMoiTao(tx,");
    const khuyenMai = donTay.indexOf("tx.voucherRedemption.create(");
    const auditTao = donTay.indexOf('action: "CREATE",', goi);
    expect(taoDon).toBeGreaterThan(0);
    expect(phieu).toBeGreaterThan(taoDon);
    expect(goi).toBeGreaterThan(phieu);
    expect(khuyenMai).toBeGreaterThan(goi);
    expect(auditTao).toBeGreaterThan(goi);
    expect(donTay).toMatch(/if \(data\.type === "COURSE"\) \{\s*await ganDanhTinhDonMoiTao\(tx, \{ orderId: order\.id, actor: \{ id: actorId, name: actorName \} \}\);\s*\}/);
  });

  it("[GDMW-2] ghi danh sinh SAU: enrollStudent + createEnrollment gọi ganDongDonMoCoiChoGhiDanh(tx, …) NGAY SAU khi tạo ghi danh (cùng transaction); class-groups cũng vậy", () => {
    expect(ghiDanh.split("ganDongDonMoCoiChoGhiDanh(tx,").length - 1).toBe(2);
    expect(nhomLop.split("ganDongDonMoCoiChoGhiDanh(tx,").length - 1).toBe(1);
    // enrollStudent: sau syncConversationMembership(tx, classId), trước `return created.id`
    const a = ghiDanh.indexOf("await syncConversationMembership(tx, classId);");
    const b = ghiDanh.indexOf("ganDongDonMoCoiChoGhiDanh(tx, { enrollmentId: created.id");
    const c = ghiDanh.indexOf("return created.id;");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    // createEnrollment (legacy): lấy id từ chính lời tạo
    expect(ghiDanh).toMatch(/const taoMoi = await tx\.enrollment\.create\(\{ data, select: \{ id: true \} \}\);[\s\S]*?ganDongDonMoCoiChoGhiDanh\(tx, \{ enrollmentId: taoMoi\.id/);
    expect(nhomLop).toMatch(/const taoMoi = await tx\.enrollment\.create\([\s\S]*?ganDongDonMoCoiChoGhiDanh\(tx, \{ enrollmentId: taoMoi\.id/);
  });

  it("[GDMW-3] phần DB của đường tay KHÔNG tự ghi gì ngoài phần ghi dùng chung (`ghiKeHoachGanDanhTinh`): không update/create/delete trên Order · OrderItem · Payment · Enrollment · Receipt · hoa hồng; chỉ ĐỌC Payment", () => {
    expect(dbTay).not.toMatch(/tx\.(order|orderItem|payment|enrollment|student|receipt|commission\w*|paymentAllocation|bankTransaction)\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/);
    expect(dbTay).not.toMatch(/\$executeRaw/);
    expect(dbTay).toMatch(/tx\.payment\.findMany\(/);
    expect(dbTay.split("ghiKeHoachGanDanhTinh(tx,").length - 1).toBe(2);
    expect(dbTay).not.toMatch(/listPrice|finalPrice|tuition|discount/);
  });

  it("[GDMW-4] mỗi đường khai RÕ cầu nối: đường tay truyền `cauNoiHocVien: true` đúng 2 lần; convert truyền `false` đúng 1 lần (không bật ngầm cầu nối học viên cho convert)", () => {
    expect(dbTay.split("{ cauNoiHocVien: true }").length - 1).toBe(2);
    expect(dbTay).not.toMatch(/cauNoiHocVien: false/);
    expect(dbConvert.split("{ cauNoiHocVien: false }").length - 1).toBe(1);
    expect(dbConvert).not.toMatch(/cauNoiHocVien: true/);
  });

  it("[GDMW-5] đường 2 có CỔNG RIÊNG trước khi lập kế hoạch: học viên đã có ghi danh KHÁC cùng khoá (có thể là học lại) ⇒ dừng; nối theo bé chỉ khi đơn cùng lead với học viên", () => {
    const tuHam = dbTay.slice(dbTay.indexOf("export async function ganDongDonMoCoiChoGhiDanh"));
    const cong = tuHam.indexOf("DA_CO_GHI_DANH_KHAC_CUNG_KHOA");
    const lap = tuHam.indexOf("lapKeHoachGanDanhTinh(");
    expect(cong).toBeGreaterThan(0);
    expect(lap).toBeGreaterThan(cong);
    expect(tuHam).toMatch(/order: \{ leadId: leadHocVien \}/);
    expect(tuHam).toMatch(/order: \{ leadChildId: be, leadId: leadHocVien \}/);
  });
});