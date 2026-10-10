// lib/integrations/zalocrm/compose-url.test.ts — S2 (nút "Nhắn Zalo" trên phiếu lead).
//
// VÌ SAO BỘ NÀY TỒN TẠI RIÊNG. Đường đi của một cú bấm nút là:
//   phiếu lead → `/zalo-crm?compose=…` → `duongDanNhungZaloCrm` (sso.ts) → fork ZaloCRM.
// Chặng giữa lọc `compose` bằng `/^84\d{8,10}$/` và **BỎ HẲN tham số** nếu sai khuôn
// (`lib/integrations/zalocrm/sso.ts`, ca [ZC-SSO-13]). Nghĩa là mọi cách dựng sai —
// `0912…`, `+84912…`, chuỗi rỗng, bản SĐT đã che — đều KHÔNG báo lỗi ở đâu cả: hộp
// soạn tin chỉ mở TRỐNG, và người dùng tưởng ZaloCRM không tìm ra khách.
// Hỏng câm thì phải khoá bằng test, không khoá được bằng cách "nhìn thấy lúc chạy thử".
//
// Module dưới test là THUẦN (không DB, không env, không `server-only`) đúng để bộ này
// chạy được trong `vitest` mặc định — glob `lib/**` của `vitest.config.ts` phủ sẵn.
import { describe, it, expect } from "vitest";
import {
  KHUON_COMPOSE_ZALOCRM,
  duongDanNhanZalo,
  orgCodeCuaCoSo,
} from "@/lib/integrations/zalocrm/compose-url";
import { canonicalPhone } from "@/lib/phone";
import { maskPhone } from "@/lib/utils";

const LEAD = "clx0lead000000000000";

/** Lấy giá trị một tham số trên đường dẫn TƯƠNG ĐỐI (cần một gốc giả để `URL` nhận). */
function thamSo(url: string, ten: string): string | null {
  return new URL(url, "https://admin.satarobo.vn").searchParams.get(ten);
}

describe("duongDanNhanZalo — dựng địa chỉ soạn tin từ phiếu lead", () => {
  it("[ZC-CU-01] SĐT '0912345678' ⇒ /zalo-crm?compose=84912345678&lead=<id>", () => {
    expect(duongDanNhanZalo("0912345678", LEAD)).toBe(
      `/zalo-crm?compose=84912345678&lead=${LEAD}`,
    );
  });

  it("[ZC-CU-02] mọi dạng cùng một số cho CÙNG kết quả (DB đang có cả '0…' lẫn '84…')", () => {
    // Đo trên DEV 03/08: 99 bản ghi dạng `0…` / 8 bản dạng `84…`. Nút phải làm việc
    // như nhau với cả hai, cộng các dạng người dùng gõ tay vào ô sửa phiếu.
    const dang = [
      "0912345678",
      "84912345678",
      "+84912345678",
      "+84 912 345 678",
      "0912.345.678",
      "(091) 234-5678",
      "912345678", // Excel lưu kiểu number ⇒ nuốt mất số 0 đầu
    ];
    for (const d of dang) {
      expect(duongDanNhanZalo(d, LEAD), `dạng "${d}"`).toBe(
        `/zalo-crm?compose=84912345678&lead=${LEAD}`,
      );
    }
  });

  it("[ZC-CU-03] Lead.phone chuỗi RỖNG ⇒ null (không dựng URL, nút không hiện)", () => {
    // `Lead.phone` là cột NOT NULL nhưng ĐƯỢC PHÉP RỖNG: lead quảng cáo Facebook chỉ
    // có link FB, chưa xin được số. Dựng URL ở đây = ZaloCRM ăn một lượt tra số chắc
    // chắn không ra ai, tính vào hạn mức Zalo của công ty.
    expect(duongDanNhanZalo("", LEAD)).toBeNull();
    expect(duongDanNhanZalo("   ", LEAD)).toBeNull();
    expect(duongDanNhanZalo(null, LEAD)).toBeNull();
    expect(duongDanNhanZalo(undefined, LEAD)).toBeNull();
  });

  it("[ZC-CU-04] số cố định / rác ⇒ null", () => {
    for (const rac of [
      "02363123456", // số bàn cơ sở — `canonicalPhone` chỉ nhận di động 3/5/7/8/9
      "123",
      "khong co so",
      "0912345678, 0987654321", // ô SĐT bị nhập hai số
      "091234567890123",
      "<script>alert(1)</script>",
    ]) {
      expect(duongDanNhanZalo(rac, LEAD), `rác "${rac}"`).toBeNull();
    }
  });

  it("[ZC-CU-05] SĐT ĐÃ CHE ⇒ null — không bao giờ gửi bản mặt nạ đi tra", () => {
    // Bản che của repo là `090xxxx456`. Gửi nó đi thì ZaloCRM tra ra rỗng, KHÔNG lỗi:
    // đúng kiểu hỏng câm mà [S-1] đã bắt ở các màn chốt đơn.
    const daChe = maskPhone("0912345678");
    expect(daChe).not.toBe("0912345678"); // bản che thật sự có che
    expect(duongDanNhanZalo(daChe, LEAD)).toBeNull();
  });

  it("[ZC-CU-06] mọi URL dựng ra đều lọt CỔNG của ZaloCRM (/^84\\d{8,10}$/)", () => {
    // Đây là lưới nối hai đầu: `sso.ts` bỏ hẳn tham số `compose` khi sai khuôn. Nếu
    // `canonicalPhone` đổi định dạng đầu ra mai này, ca này đỏ TRƯỚC khi hộp soạn tin
    // âm thầm mở trống trên prod.
    for (const so of ["0912345678", "0387654321", "0512345678", "0787654321", "0855555555"]) {
      const url = duongDanNhanZalo(so, LEAD);
      expect(url, so).not.toBeNull();
      const compose = thamSo(url as string, "compose");
      expect(compose, so).toBe(canonicalPhone(so));
      expect(KHUON_COMPOSE_ZALOCRM.test(compose as string), `${so} → ${compose}`).toBe(true);
    }
  });

  it("[ZC-CU-07] thiếu leadId ⇒ vẫn dựng URL nhưng KHÔNG kèm tham số lead rỗng", () => {
    // `&lead=` rỗng làm phía nhận phải đoán; thà không có tham số.
    const url = duongDanNhanZalo("0912345678", "");
    expect(url).toBe("/zalo-crm?compose=84912345678");
    expect(thamSo(url as string, "lead")).toBeNull();
    expect(duongDanNhanZalo("0912345678", null)).toBe("/zalo-crm?compose=84912345678");
  });

  it("[ZC-CU-08] leadId được mã hoá — không gãy URL, không chèn thêm tham số", () => {
    const url = duongDanNhanZalo("0912345678", "a b&compose=84999999999");
    expect(thamSo(url as string, "lead")).toBe("a b&compose=84999999999");
    expect(thamSo(url as string, "compose")).toBe("84912345678");
  });

  it("[ZC-CU-09] đường dẫn TƯƠNG ĐỐI tới host admin, không phải /admin/zalo-crm", () => {
    // Host admin phục vụ route group `(admin)` ở GỐC: `/zalo-crm`. Ghi `/admin/zalo-crm`
    // là 404 trên chính host đang dùng (cùng quy ước với `href` của sidebar).
    const url = duongDanNhanZalo("0912345678", LEAD) as string;
    expect(url.startsWith("/zalo-crm?")).toBe(true);
    expect(url).not.toContain("/admin/zalo-crm");
    expect(url).not.toMatch(/^https?:/);
  });
});

describe("?org= — nút phải mang CƠ SỞ CỦA PHIẾU, không để màn nhúng đoán", () => {
  // Nợ #2 của bản bàn giao, vá 13/09/2026. Không có `?org=` thì màn nhúng mở cơ sở đầu
  // bảng chữ cái ⇒ Sale kiêm CS1+CS2 bấm từ phiếu CS2 sẽ nhắn bằng nick CS1, và dòng
  // "đặt trước" bị từ chối vì lệch cơ sở ⇒ hội thoại KHÔNG tự nối vào phiếu.
  const ANH_XA = { CS1: "cs1", CS2: "cs2" };

  it("[ZC-CU-10] có orgCode ⇒ URL mang đủ ba tham số", () => {
    const url = duongDanNhanZalo("0912345678", LEAD, "cs2") as string;
    expect(thamSo(url, "compose")).toBe("84912345678");
    expect(thamSo(url, "lead")).toBe(LEAD);
    expect(thamSo(url, "org")).toBe("cs2");
  });

  it("[ZC-CU-11] thiếu orgCode ⇒ vẫn có nút, chỉ là KHÔNG kèm tham số org", () => {
    // Lối lùi có chủ đích: bảng ánh xạ thiếu một dòng không được làm biến mất cái nút.
    for (const v of [undefined, null, ""]) {
      const url = duongDanNhanZalo("0912345678", LEAD, v) as string;
      expect(url, `orgCode = ${JSON.stringify(v)}`).toBe(
        `/zalo-crm?compose=84912345678&lead=${LEAD}`,
      );
      expect(thamSo(url, "org")).toBeNull();
    }
  });

  it("[ZC-CU-12] orgCode sai khuôn ⇒ BỎ tham số, không trả null và không chèn nguyên văn", () => {
    for (const xau of ["CS2", "cs 2", "cs2&lead=khac", "../cs2", "a".repeat(33)]) {
      const url = duongDanNhanZalo("0912345678", LEAD, xau) as string;
      expect(url, `orgCode = ${xau}`).not.toBeNull();
      expect(thamSo(url, "org"), `orgCode = ${xau}`).toBeNull();
      expect(thamSo(url, "lead"), `orgCode = ${xau}`).toBe(LEAD);
    }
  });

  it("[ZC-CU-13] orgCodeCuaCoSo tra đúng theo Center.code", () => {
    expect(orgCodeCuaCoSo("CS2", ANH_XA)).toBe("cs2");
    expect(orgCodeCuaCoSo("CS1", ANH_XA)).toBe("cs1");
  });

  it("[ZC-CU-14] orgCodeCuaCoSo trả null cho mọi lối hỏng, không ném", () => {
    expect(orgCodeCuaCoSo(null, ANH_XA), "phiếu chưa gắn cơ sở").toBeNull();
    expect(orgCodeCuaCoSo(undefined, ANH_XA), "cơ sở chưa đặt Center.code").toBeNull();
    expect(orgCodeCuaCoSo("", ANH_XA), "mã cơ sở rỗng").toBeNull();
    expect(orgCodeCuaCoSo("CS9", ANH_XA), "cơ sở chưa ánh xạ").toBeNull();
    expect(orgCodeCuaCoSo("CS1", null), "chưa khai tham số vận hành").toBeNull();
    expect(orgCodeCuaCoSo("CS1", {}), "bảng ánh xạ rỗng").toBeNull();
    expect(orgCodeCuaCoSo("CS1", { CS1: "CS1" }), "giá trị sai khuôn").toBeNull();
  });

  it("[ZC-CU-15] khớp trọn vòng: tra ánh xạ rồi dựng URL", () => {
    const url = duongDanNhanZalo("0912345678", LEAD, orgCodeCuaCoSo("CS2", ANH_XA)) as string;
    expect(thamSo(url, "org")).toBe("cs2");
  });
});
