// tests/fixtures/hai-truc-tien.ts — dữ liệu cho các ca "chênh lệch HAI TRỤC cộng tiền".
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao KHÔNG dùng seed
//
// Seed UAT đặt **toàn bộ** `Payment.saleStatus = COLLECT_CONFIRMED` (đo 07/09 trên cả
// local lẫn dev/test: Σ `saleStatus = RECORDED` = **0 đ**). Nghĩa là trục B — mã QR ·
// webhook SePay · tin ZNS học phí · cổng chốt lead — KHÔNG có một đồng nào để cộng.
//
// Nếu bộ test Bước 6 dựa vào seed thì ca "chênh lệch hai trục được bảo toàn" sẽ so
// **0 với 0** và xanh mà chẳng chứng minh điều gì. Đó là xanh giả, đúng loại nguy hiểm
// nhất. Nên fixture này tự dựng dữ liệu, độc lập hoàn toàn với seed.
//
// ─────────────────────────────────────────────────────────────────────────────
// Hai hình dạng BẮT BUỘC phải có, vì chúng là chỗ hai trục tách nhau
//
//   ① khoản RECORDED **chưa** CONFIRMED
//      → trục B cộng, trục A không. Đây chính là "tiền đã về nhưng kế toán chưa đối
//        soát". Chênh lệch giữa hai trục là tín hiệu phát hiện webhook hỏng — gộp hai
//        hàm là mất tín hiệu đó.
//
//   ② khoản `enrollmentId = null`
//      → `payos-ingest.ts:1044` (tiền về qua cổng thanh toán) KHÔNG BAO GIỜ set
//        `enrollmentId`. Ép trục B khoá theo `enrollmentId` là nuốt mất khoản này.
//        Trục A không bao giờ gặp hình dạng đó — `confirmPayment:400` từ chối xác nhận
//        khoản chưa gắn ghi danh — nên nó là bằng chứng sống cho việc hai trục phải
//        giữ hai khoá khác nhau.
//
// ─────────────────────────────────────────────────────────────────────────────
// Cách dùng
//
//   const fx = await dungFixtureHaiTruc();
//   // … chạy phép cộng …
//   await donFixtureHaiTruc();
//
// Idempotent: gọi lại thì dọn rồi dựng lại, không đẻ bản trùng. Mọi id mang tiền tố
// `FX_TIEN` nên `donFixtureHaiTruc()` xoá đúng phần của mình, không đụng dữ liệu khác
// trong DB — fixture này CHẠY ĐƯỢC trên DB đang có dữ liệu, không cần `resetDb()`.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "@/lib/db";

/** Tiền tố id — mọi bản ghi của fixture đều mang, để dọn cho chính xác. */
export const FX_TIEN = "fx-hai-truc";

const id = (s: string) => `${FX_TIEN}-${s}`;

export const FX_IDS = {
  center: id("center"),
  course: id("course"),
  class: id("class"),
  student: id("student"),
  enrollment: id("enrollment"),
  order: id("order"),
  /** ① CONFIRMED — cả hai trục đều cộng. */
  khoanDaXacNhan: id("pay-confirmed"),
  /** ② RECORDED chưa CONFIRMED — CHỈ trục B cộng. */
  khoanChuaXacNhan: id("pay-recorded"),
  /** ③ RECORDED, `enrollmentId = null` — cổng thanh toán; trục B cộng, trục A không có khoá. */
  khoanKhongGhiDanh: id("pay-no-enrollment"),
} as const;

/** Số tiền — đặt lệch nhau để mọi tổng sai đều lộ ra, không trùng số ngẫu nhiên. */
export const FX_TIEN_SO = {
  hocPhi: 10_000_000,
  daXacNhan: 4_000_000,
  chuaXacNhan: 3_000_000,
  khongGhiDanh: 500_000,
} as const;

/**
 * Tổng KỲ VỌNG của từng trục — viết sẵn ở đây để ca test khỏi tự cộng nhẩm
 * (tự cộng nhẩm trong test là chép lại đúng phép tính đang muốn kiểm).
 */
export const FX_KY_VONG = {
  /** Trục A theo ghi danh: chỉ khoản CONFIRMED. */
  sumConfirmedTheoGhiDanh: FX_TIEN_SO.daXacNhan,
  /** Trục B theo đơn: mọi khoản RECORDED, kể cả khoản không gắn ghi danh. */
  sumRecordedTheoDon:
    FX_TIEN_SO.daXacNhan + FX_TIEN_SO.chuaXacNhan + FX_TIEN_SO.khongGhiDanh,
  /** Chênh lệch hai trục — con số phải được BẢO TOÀN qua mọi thay đổi. */
  chenhLech: FX_TIEN_SO.chuaXacNhan + FX_TIEN_SO.khongGhiDanh,
} as const;

export type FixtureHaiTruc = typeof FX_IDS;

/** Dựng dữ liệu. Tự dọn trước nên gọi bao nhiêu lần cũng ra cùng một trạng thái. */
export async function dungFixtureHaiTruc(): Promise<FixtureHaiTruc> {
  await donFixtureHaiTruc();

  await db.center.create({
    data: {
      id: FX_IDS.center,
      name: "FX Cơ sở hai trục",
      slug: id("center-slug"),
      address: "Không có thật",
    },
  });
  await db.course.create({
    data: { id: FX_IDS.course, name: "FX Khoá hai trục", slug: id("course-slug") },
  });
  await db.class.create({
    data: {
      id: FX_IDS.class,
      name: "FX Lớp hai trục",
      classCode: id("class-code"),
      courseId: FX_IDS.course,
      centerId: FX_IDS.center,
    },
  });
  await db.student.create({
    data: { id: FX_IDS.student, name: "FX Học viên", centerId: FX_IDS.center },
  });
  await db.enrollment.create({
    data: {
      id: FX_IDS.enrollment,
      studentId: FX_IDS.student,
      classId: FX_IDS.class,
      courseId: FX_IDS.course,
      status: "ACTIVE",
      // Trần chặn của Bước 3 đọc `finalPrice ?? tuition` — đặt rõ để ca "chạm trần" có mốc.
      finalPrice: FX_TIEN_SO.hocPhi,
      centerId: FX_IDS.center,
    },
  });
  await db.order.create({
    data: {
      id: FX_IDS.order,
      code: id("ORD"),
      customerName: "FX Phụ huynh",
      customerPhone: "0900000000",
      studentId: FX_IDS.student,
      type: "COURSE",
      totalAmount: FX_TIEN_SO.hocPhi,
      centerId: FX_IDS.center,
    },
  });

  const chung = {
    orderId: FX_IDS.order,
    method: "CASH",
    paidDate: new Date("2026-09-01T03:00:00.000Z"),
    centerId: FX_IDS.center,
  };

  await db.payment.createMany({
    data: [
      // ① Cả hai trục cùng cộng.
      {
        ...chung,
        id: FX_IDS.khoanDaXacNhan,
        enrollmentId: FX_IDS.enrollment,
        amount: FX_TIEN_SO.daXacNhan,
        saleStatus: "RECORDED",
        accountantStatus: "CONFIRMED",
      },
      // ② Tiền đã về, kế toán CHƯA đối soát — chỉ trục B thấy.
      {
        ...chung,
        id: FX_IDS.khoanChuaXacNhan,
        enrollmentId: FX_IDS.enrollment,
        amount: FX_TIEN_SO.chuaXacNhan,
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
      },
      // ③ Cổng thanh toán: KHÔNG có `enrollmentId`. Trục A không có khoá để cộng nó.
      {
        ...chung,
        id: FX_IDS.khoanKhongGhiDanh,
        enrollmentId: null,
        amount: FX_TIEN_SO.khongGhiDanh,
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
      },
    ],
  });

  return FX_IDS;
}

/** Xoá đúng phần của fixture. Thứ tự ngược chiều khoá ngoại. */
export async function donFixtureHaiTruc(): Promise<void> {
  await db.payment.deleteMany({ where: { orderId: FX_IDS.order } });
  await db.order.deleteMany({ where: { id: FX_IDS.order } });
  await db.enrollment.deleteMany({ where: { id: FX_IDS.enrollment } });
  await db.student.deleteMany({ where: { id: FX_IDS.student } });
  await db.class.deleteMany({ where: { id: FX_IDS.class } });
  await db.course.deleteMany({ where: { id: FX_IDS.course } });
  await db.center.deleteMany({ where: { id: FX_IDS.center } });
}
