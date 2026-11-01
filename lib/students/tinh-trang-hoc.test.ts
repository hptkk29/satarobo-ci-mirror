// lib/students/tinh-trang-hoc.test.ts — THUẦN, không DB.
import { describe, expect, it } from "vitest";
import type { EnrollmentStatus } from "@prisma/client";
import { buildLifecycleWhere } from "./lifecycle";
import { tinhTinhTrangHoc } from "./tinh-trang-hoc";

const active = (enrollmentStatuses: EnrollmentStatus[]) =>
  tinhTinhTrangHoc({ status: "ACTIVE", enrollmentStatuses });

describe("[TTH] tình trạng học suy từ ghi danh", () => {
  it("[TTH-01] còn lớp đang học → Đang học", () => {
    expect(active(["STUDYING"]).key).toBe("dang-hoc");
    // `ACTIVE` là giá trị MẶC ĐỊNH của schema và là thứ hai đường convert lead sinh ra
    // ⇒ phần lớn ghi danh THẬT mang nó. Bỏ sót là cả trung tâm hiện "Chờ xếp lớp".
    expect(active(["ACTIVE"]).key).toBe("dang-hoc");
  });

  it("[TTH-02] xong khoá, không còn lớp, chưa đăng ký mới → Hoàn thành khoá", () => {
    const r = active(["COMPLETED"]);
    expect(r.key).toBe("vua-hoan-thanh");
    expect(r.label).toBe("Hoàn thành khoá");
  });

  // ⚠️ Ca GIỮ THỨ TỰ XÉT. Em học Sata 2 song song, vừa xong Sata 1 ⇒ vẫn ĐANG HỌC.
  // Đảo hai nhánh trong `tinhTinhTrangHoc` là em đang ngồi lớp bị gắn "đã xong".
  it("[TTH-03] vừa xong một khoá nhưng CÒN lớp khác → vẫn Đang học", () => {
    expect(active(["COMPLETED", "STUDYING"]).key).toBe("dang-hoc");
  });

  it("[TTH-04] xong khoá nhưng ĐÃ đăng ký khoá tiếp → Chờ xếp lớp (việc là xếp, không phải bán)", () => {
    expect(active(["COMPLETED", "CONFIRMED"]).key).toBe("cho-xep-lop");
    expect(active(["COMPLETED", "PENDING"]).key).toBe("cho-xep-lop");
  });

  it("[TTH-05] chưa từng có ghi danh nào → Chờ xếp lớp", () => {
    expect(active([]).key).toBe("cho-xep-lop");
  });

  it("[TTH-06] bị gỡ khỏi lớp (WITHDREW) mà chưa từng xong khoá → Chờ xếp lớp", () => {
    expect(active(["WITHDREW"]).key).toBe("cho-xep-lop");
  });

  it("[TTH-07] KHÔNG suy diễn đè lên quyết định của người vận hành", () => {
    expect(tinhTinhTrangHoc({ status: "PAUSED", enrollmentStatuses: ["COMPLETED"] }).key).toBe("bao-luu");
    expect(tinhTinhTrangHoc({ status: "INACTIVE", enrollmentStatuses: ["STUDYING"] }).key).toBe("nghi-hoc");
    expect(tinhTinhTrangHoc({ status: "GRADUATED", enrollmentStatuses: [] }).label).toBe("Hoàn thành");
  });
});

// ── Lưới chống LỆCH giữa badge và tab ────────────────────────────────────────
//
// Badge (hàm thuần trên) và tab (`buildLifecycleWhere`, chạy bằng where-clause Prisma)
// là HAI hiện thực của cùng một câu hỏi. Không hợp nhất được — một bên nhận mảng trong
// bộ nhớ, một bên phải dịch ra SQL. Nên phải có lưới canh: chúng chỉ đúng khi cùng dùng
// một bộ trạng thái. Ca dưới đọc chính where-clause và đối chiếu với hằng của file này.
describe("[TTH] badge và tab phải nói cùng một thứ", () => {
  it("[TTH-08] tab 'vua-hoan-thanh' lọc đúng bộ mà badge dùng", () => {
    const w = JSON.stringify(buildLifecycleWhere("vua-hoan-thanh"));
    // đòi có ghi danh COMPLETED
    expect(w).toContain('"COMPLETED"');
    // loại em còn lớp đang học
    expect(w).toContain('"STUDYING"');
    // loại em đã đăng ký khoá tiếp
    expect(w).toContain('"PENDING"');
    expect(w).toContain('"CONFIRMED"');
    // nhánh suy-từ-ghi-danh chỉ xét học viên còn ACTIVE
    expect(w).toContain('"ACTIVE"');
  });

  // ⚠️ 24/09 — ca GIỮ NHÁNH (A). Chủ dự án đánh dấu hoàn thành bằng CẢ HAI đường; bản
  // đầu của tab chỉ nhận nhánh suy-từ-ghi-danh, nên nhóm đặt tay `GRADUATED` rơi khỏi
  // MỌI tab (`active`/`waiting` đòi ACTIVE · `reserved` đòi PAUSED · `withdrawn` đòi
  // INACTIVE) và chỉ còn thấy ở "Tất cả". Gỡ nhánh này ra là tái hiện đúng lỗi đó —
  // và nó hỏng CÂM: không lỗi, không ca nào khác đỏ, chỉ là học viên biến mất.
  it("[TTH-10] tab 'vua-hoan-thanh' NHẬN cả hồ sơ đặt tay GRADUATED", () => {
    const w = JSON.stringify(buildLifecycleWhere("vua-hoan-thanh"));
    expect(w).toContain('"GRADUATED"');
    // và nhận VÔ ĐIỀU KIỆN — không kèm ràng buộc ghi danh, vì 5/16 em GRADUATED trên
    // DB local không có ghi danh COMPLETED nào (hồ sơ cũ). Đòi kèm là loại đúng họ.
    expect(w).toContain('{"status":"GRADUATED"}');
  });

  // ⚠️ Hai tab KHÔNG ĐƯỢC chồng nhau: trước bản vá, em vừa xong khoá rơi vào
  // "Chờ xếp lớp" (điều kiện `none in-class` khớp vì COMPLETED không thuộc bộ in-class).
  // Đếm đôi thì tổng các tab > số học viên, và người dùng gọi điện hai lần cho một em.
  it("[TTH-09] tab 'waiting' LOẠI nhóm vừa hoàn thành ra", () => {
    const w = JSON.stringify(buildLifecycleWhere("waiting"));
    expect(w).toContain("NOT");
    expect(w).toContain('"COMPLETED"');
  });
});
