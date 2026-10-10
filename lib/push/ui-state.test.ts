import { describe, it, expect } from "vitest";
import { trangThaiManHinh, NHAN, BUOC_CAI_IOS, laThietBiIOS, nhanHost, type BoiCanhThietBi } from "./ui-state";

function bc(ghiDe: Partial<BoiCanhThietBi> = {}): BoiCanhThietBi {
  return {
    hoTroPush: true,
    quyen: "default",
    laIOS: false,
    dangStandalone: false,
    daDangKy: false,
    ...ghiDe,
  };
}

describe("[PUSH-D3-T01] iPhone chưa cài — ca quyết định cả phạm vi module", () => {
  it("iOS + chưa standalone → HƯỚNG DẪN, kể cả khi trình duyệt báo KHÔNG hỗ trợ push", async () => {
    // Đây là ca thật, không phải giả định: trên iOS Safari chưa "Thêm vào màn hình chính",
    // `window.PushManager` KHÔNG tồn tại ⇒ `hoTroPush = false`. Nếu hỏi `hoTroPush` trước thì
    // mọi iPhone chưa cài nhận câu "trình duyệt không hỗ trợ" — câu SAI, và là câu tệ nhất:
    // nó bảo người dùng bỏ cuộc trong khi họ chỉ còn cách đúng một thao tác.
    expect(trangThaiManHinh(bc({ laIOS: true, dangStandalone: false, hoTroPush: false }))).toBe(
      "IOS_CHUA_CAI",
    );
  });

  it("iOS + ĐÃ standalone → đi tiếp như mọi thiết bị khác", () => {
    expect(trangThaiManHinh(bc({ laIOS: true, dangStandalone: true }))).toBe("CO_THE_BAT");
    expect(
      trangThaiManHinh(bc({ laIOS: true, dangStandalone: true, quyen: "granted", daDangKy: true })),
    ).toBe("DA_BAT");
  });

  it("KHÔNG phải iOS thì chưa standalone cũng không sao — Chrome/Edge không đòi cài", () => {
    expect(trangThaiManHinh(bc({ laIOS: false, dangStandalone: false }))).toBe("CO_THE_BAT");
  });

  it("có đủ 5 bước hướng dẫn, và bước đầu nhắc phải dùng Safari", () => {
    // Chrome trên iPhone KHÔNG thêm được vào màn hình chính — thiếu câu này là người dùng
    // làm đúng mọi bước trên trình duyệt sai rồi kết luận hệ thống hỏng.
    expect(BUOC_CAI_IOS.length).toBe(5);
    expect(BUOC_CAI_IOS[0]).toContain("Safari");
  });
});

describe("[PUSH-D3-T02] các trạng thái còn lại", () => {
  it("quyền bị CHẶN → nói rõ là bị chặn, không nói 'không hỗ trợ'", () => {
    // `Notification.permission` vẫn đọc được cả khi `PushManager` vắng mặt. "Bạn đã chặn" là
    // thông tin dùng được (có đường sửa), "không hỗ trợ" thì không.
    expect(trangThaiManHinh(bc({ quyen: "denied" }))).toBe("BI_CHAN");
    expect(trangThaiManHinh(bc({ quyen: "denied", hoTroPush: false }))).toBe("BI_CHAN");
  });

  it("không hỗ trợ (và không phải ca iOS) → KHONG_HO_TRO", () => {
    expect(trangThaiManHinh(bc({ hoTroPush: false }))).toBe("KHONG_HO_TRO");
  });

  it("đã cho quyền nhưng máy này CHƯA đăng ký → vẫn hiện nút", () => {
    // Ca có thật: người dùng đã bật ở máy khác, hoặc vừa gỡ thiết bị này khỏi danh sách.
    expect(trangThaiManHinh(bc({ quyen: "granted", daDangKy: false }))).toBe("CO_THE_BAT");
  });

  it("đã cho quyền VÀ đã đăng ký → DA_BAT", () => {
    expect(trangThaiManHinh(bc({ quyen: "granted", daDangKy: true }))).toBe("DA_BAT");
  });
});

describe("[PUSH-D3-T03] nhãn", () => {
  it("mọi trạng thái đều có tiêu đề và mô tả không rỗng", () => {
    for (const k of Object.keys(NHAN) as (keyof typeof NHAN)[]) {
      expect(NHAN[k].tieuDe.length).toBeGreaterThan(0);
      expect(NHAN[k].moTa.length).toBeGreaterThan(0);
    }
  });

  it("nhãn phủ ĐÚNG tập trạng thái mà hàm có thể trả về", () => {
    // Thiếu một khoá là màn hình trắng ở đúng nhánh hiếm nhất.
    const moiCa: BoiCanhThietBi[] = [
      bc({ laIOS: true }),
      bc({ quyen: "denied" }),
      bc({ hoTroPush: false }),
      bc({ quyen: "granted", daDangKy: true }),
      bc(),
    ];
    for (const c of moiCa) expect(NHAN[trangThaiManHinh(c)]).toBeDefined();
  });
});

describe("[PUSH-D3-T08] nhận diện iOS", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const IPAD_OS13 =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  const MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36";

  it("iPhone → true", () => {
    expect(laThietBiIOS({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
  });

  it("iPad iPadOS 13+ tự khai là Macintosh → VẪN true (phân biệt bằng maxTouchPoints)", () => {
    // Chỉ soi iPhone|iPad|iPod là mọi iPad rơi vào nhánh "không hỗ trợ" thay vì nhánh hướng dẫn.
    expect(laThietBiIOS({ userAgent: IPAD_OS13, maxTouchPoints: 5 })).toBe(true);
  });

  it("Mac THẬT (maxTouchPoints = 0) → false, không bị nhận nhầm thành iPad", () => {
    expect(laThietBiIOS({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false);
    expect(laThietBiIOS({ userAgent: IPAD_OS13, maxTouchPoints: 0 })).toBe(false);
  });

  it("Android → false", () => {
    expect(laThietBiIOS({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe(false);
  });
});

describe("[PUSH-D3-T13] nhãn host trong danh sách thiết bị", () => {
  it("mỗi host nhân viên có nhãn người đọc được", () => {
    // Một người kiêm nhiệm có HAI dòng cho cùng một điện thoại (worker khoá theo origin, và
    // Đợt 3 mount ở cả admin lẫn site GV). Hiện URL thô thì hai dòng trông như trùng lặp và
    // người dùng bấm Gỡ nhầm, tắt push ở host kia mà không có dấu hiệu gì.
    expect(nhanHost("https://admin.satarobo.vn")).toBe("Trang quản trị");
    expect(nhanHost("https://giaovien.satarobo.vn")).toBe("Trang giáo viên");
    expect(nhanHost("https://e-learning.satarobo.vn")).toBe("Khu đào tạo nội bộ");
    expect(nhanHost("https://sale.satarobo.vn")).toBe("Trang Sale");
  });

  it("host lạ (localhost, test.satarobo.vn) giữ nguyên URL — không bịa nhãn", () => {
    expect(nhanHost("http://localhost:3000")).toBe("http://localhost:3000");
    expect(nhanHost("https://test.satarobo.vn")).toBe("https://test.satarobo.vn");
  });
});

/**
 * NGOẠI LỆ CÓ CHỮ KÝ cho `lib/push/*` ở bốn nhóm route bị cấm.
 *
 * Danh sách này tồn tại vì "nới cổng" đôi khi là hành động ĐÚNG, nhưng nó không được phép im
 * lặng: một import hợp lệ và một import làm lộ push sang origin phụ huynh trông giống hệt nhau
 * trong mã. Khai ở đây biến cái thứ nhất thành một quyết định có chữ ký.
 *
 * ⚠️ `components/push/*` KHÔNG CÓ NGOẠI LỆ NÀO và đừng thêm — đó mới đúng là thứ nguy hiểm:
 * `service-worker-register.tsx` cài worker lên origin đang phục vụ, `bat-thong-bao.tsx` xin
 * quyền thông báo.
 *
 * ⚠️ VÀ TỪ ĐỢT 6, CÂU "`lib/push/*` chỉ nguy hiểm khi nó kéo được mã client theo" KHÔNG CÒN
 * ĐÚNG CHO CẢ THƯ MỤC (lăng kính Đợt 6 sửa chỗ này). `lib/push` nay có HAI module CLIENT tự mình
 * nguy hiểm: `tu-dang-ky-lai.ts` (TẠO đăng ký push + gọi Server Action ghi DB) và `bo-nho-may.ts`.
 * Cấp ngoại lệ cho hai tên đó là ngang với cấp cho `components/push/*` — đừng cấp. Lý lẽ
 * `server-only` chỉ còn đúng cho những module ĐÃ KHAI trong danh sách dưới đây, và ca test thứ ba
 * pin đúng chừng đó chứ không pin cho phần còn lại của thư mục.
 */
const NGOAI_LE_LIB_PUSH: Record<string, { module: string; lyDo: string }> = {
  "app/(auth)/dang-xuat/route.ts": {
    module: "@/lib/push/thu-hoi",
    lyDo:
      "Đợt 5 (13/09/2026) — NGƯỢC CHIỀU với thứ cổng này canh: nó THU HỒI đăng ký, không tạo. " +
      "Route chạy phía server và là chỗ DUY NHẤT với tới được ba ca 'tài khoản chết' (bốn layout " +
      "redirect sang đây kèm ?reason=), vì ở đó client không bao giờ chạy. Module được miễn trừ " +
      "mang `import \"server-only\"` nên không thể lọt vào bundle client — ca test dưới pin lại.",
  },
};

describe("[PUSH-D3-T14] ràng buộc phạm vi: KHÔNG có mã push nào ở host phụ huynh/công khai", () => {
  const quetNhomCam = async (): Promise<{ duong: string; src: string }[]> => {
    const { readdirSync, readFileSync, statSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const quet = (thuMuc: string): string[] => {
      const ra: string[] = [];
      for (const t of readdirSync(thuMuc)) {
        const d = join(thuMuc, t);
        if (statSync(d).isDirectory()) ra.push(...quet(d));
        // Bỏ tệp test: nó không bao giờ được phục vụ cho trình duyệt nào, nên một lời nhắc
        // `lib/push` trong `vi.mock` không phải vi phạm. Giữ nó trong danh sách chỉ đẻ nhiễu.
        else if (/\.(ts|tsx)$/.test(t) && !/\.test\.(ts|tsx)$/.test(t)) ra.push(d);
      }
      return ra;
    };
    // ⚠️ Danh sách này TỪNG chỉ có 4 route group, và lăng kính lượt 2 chỉ ra hai đường lách
    // ngay cạnh: `app/layout.tsx` là layout GỐC — nó phục vụ trên CẢ SÁU host kể cả
    // `hocvien.satarobo.vn`, nên mount `<ServiceWorkerRegister/>` ở đó là cài worker lên origin
    // phụ huynh mà cổng vẫn xanh (đúng "cái bẫy nặng nhất" ca test này tự nêu, chỉ ở một tầng
    // cao hơn). Và `components/portal/**` là vỏ portal thật (~20 tệp) cũng nằm ngoài.
    const cam = [
      "app/(portal)",
      "app/(public)",
      "app/(legacy)",
      "app/(auth)",
      "components/portal",
    ];
    const tepCam = ["app/layout.tsx", "app/not-found.tsx"];
    const ra: { duong: string; src: string }[] = [];
    for (const g of cam) {
      for (const f of quet(g)) {
        ra.push({ duong: f.replace(/\\/g, "/"), src: readFileSync(f, "utf8") });
      }
    }
    for (const f of tepCam) {
      if (existsSync(f)) ra.push({ duong: f, src: readFileSync(f, "utf8") });
    }
    return ra;
  };

  it("bốn nhóm route của phụ huynh/công khai KHÔNG import gì từ components/push", async () => {
    // Đây là ràng buộc cứng nhất của module (push CHỈ cho nhân viên) và trước ca này nó chỉ do
    // mắt người giữ. `app/(auth)/layout.tsx` là cái bẫy nặng nhất: nó được phục vụ trên CẢ SÁU
    // host, gồm /login của cổng phụ huynh — mount ở đó là cài service worker lên origin của họ.
    // KHÔNG có ngoại lệ nào cho nhánh này.
    const pham = (await quetNhomCam())
      .filter((f) => f.src.includes("components/push/"))
      .map((f) => f.duong);
    expect(pham).toEqual([]);
  });

  it("…và chỉ import `lib/push/*` ở những chỗ ĐÃ KHAI ngoại lệ, đúng module đã khai", async () => {
    const pham: string[] = [];
    for (const f of await quetNhomCam()) {
      const nhac = [...f.src.matchAll(/(?:@\/)?lib\/push\/[a-zA-Z0-9._-]+/g)].map((m) => m[0]);
      if (nhac.length === 0) continue;
      const duoc = NGOAI_LE_LIB_PUSH[f.duong];
      // Không khai ngoại lệ ⇒ vi phạm. Khai rồi nhưng import module KHÁC ⇒ cũng vi phạm:
      // ngoại lệ cấp cho MỘT module cụ thể vì module đó `server-only`, không cấp cho cả thư mục.
      if (!duoc || nhac.some((x) => x.replace(/^@\//, "") !== duoc.module.replace(/^@\//, ""))) {
        pham.push(`${f.duong} → ${nhac.join(", ")}`);
      }
    }
    expect(pham).toEqual([]);
  });

  it("mọi ngoại lệ phải CÒN ĐÚNG: tệp có thật, còn dùng, và module được miễn là `server-only`", async () => {
    // Chống danh sách mục ruỗng theo cả ba chiều — cùng lý do `KHONG_LICH_CO_CHU_DICH` của
    // `lib/cron/dang-ky-cron.test.ts` tồn tại. Vế thứ ba là vế QUAN TRỌNG NHẤT: ngoại lệ trên
    // an toàn CHỈ VÌ module kia không thể vào bundle client. Ngày ai đó gỡ `import "server-only"`
    // khỏi nó, ngoại lệ này lặng lẽ trở thành một đường đưa mã push sang origin phụ huynh.
    const { readFileSync, existsSync } = await import("node:fs");
    const loi: string[] = [];
    for (const [tep, { module }] of Object.entries(NGOAI_LE_LIB_PUSH)) {
      if (!existsSync(tep)) {
        loi.push(`ngoại lệ trỏ tệp không tồn tại: ${tep}`);
        continue;
      }
      if (!readFileSync(tep, "utf8").includes(module)) {
        loi.push(`ngoại lệ đã hết dùng, XOÁ khỏi danh sách: ${tep} → ${module}`);
      }
      const duongModule = `${module.replace(/^@\//, "")}.ts`;
      if (!existsSync(duongModule)) {
        loi.push(`module được miễn trừ không tồn tại: ${duongModule}`);
        continue;
      }
      if (!readFileSync(duongModule, "utf8").includes('import "server-only"')) {
        loi.push(`module được miễn trừ KHÔNG còn server-only: ${duongModule}`);
      }
    }
    expect(loi).toEqual([]);
  });
});
