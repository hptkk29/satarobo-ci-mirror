// [CCT-*] — LƯỚI GHIM MÃ NGUỒN: dòng "Chờ convert" phải GIỮ nút Từ chối / Sửa.
//
// ── VÌ SAO CÓ LƯỚI NÀY (sự cố 02/10/2026) ────────────────────────────────────────────
// Nhánh `thieuGhiDanh` của bảng Thanh toán trước đây thay CẢ cụm nút bằng mỗi dòng chữ
// "Chờ convert". Chú thích tại chỗ chỉ biện minh được cho việc giấu nút XÁC NHẬN
// ("chưa gắn ghi danh → confirm sẽ lỗi"), nhưng nó giấu luôn hai đường mà server KHÔNG
// hề đòi ghi danh:
//   · `rejectPayment`        — chỉ chặn khi đã REJECTED, hoặc khoản bị khoá bởi hoá đơn;
//   · `updatePendingPayment` — chỉ đòi `accountantStatus === "PENDING"`.
// Hệ quả thật: đợt nhập học phí từ file Excel sinh khoản TRÙNG; khoản trùng nào chưa gắn
// ghi danh thì KHÔNG có đường nào gỡ khỏi sổ trên giao diện — phải nhờ kỹ thuật vào DB.
//
// ── VÌ SAO LÀ LƯỚI ĐỌC MÃ, KHÔNG PHẢI TEST HÀNH VI ───────────────────────────────────
// Thứ cần khoá là "cụm nút CÓ ĐƯỢC VẼ không" ở một nhánh JSX nằm sâu trong bảng, phụ
// thuộc `p.thieuGhiDanh` do server tính. Dựng được cảnh đó trong jsdom thì phải giả lập
// nguyên trang + Server Action; test ấy sẽ đỏ vì mọi lý do khác trước khi đỏ vì lý do
// này. Mẫu "lưới ghim mã nguồn" của repo (CLAUDE.md) sinh ra đúng cho ca này.
//
// ⚠️ Lưới ghim mã nguồn là loại MONG MANH NHẤT (luật 11). Nên ở đây:
//   · BỎ CHÚ THÍCH trước khi quét — chính khối chú thích phía trên chứa đủ mọi chuỗi
//     đang cấm/đang tìm, không bỏ thì lưới tự khớp vào lời giải thích của chính nó;
//   · neo vào BIỂU THỨC (`anXacNhan`, `<RowActions`) chứ không neo vào chỗ xuống dòng;
//   · khẳng định cả SỐ LẦN khớp, không chỉ "có xuất hiện".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `import.meta.url` trong cấu hình vitest của repo này KHÔNG phải URL `file://`
// (fileURLToPath ném) — dùng `process.cwd()`, đúng như mẫu trong CLAUDE.md.
const DUONG_DAN = "app/(admin)/admin/payments/_components/payments-client.tsx";

/**
 * Bỏ chú thích khối và chú thích dòng, giữ nguyên phần mã còn lại.
 *
 * ⚠️ THỨ TỰ CÓ NGHĨA, đừng đảo [02/10/2026]. Bỏ khối `/* *` + `/` TRƯỚC là sai: một dấu
 * mở khối nằm bên trong một chú thích `//` sẽ mở ra một khối GIẢ và nuốt mã thật tới tận
 * dấu đóng kế tiếp — đo được trên `payments/_actions.ts`: **4.771 ký tự** biến mất, gồm
 * cả một khai báo hằng mà một lưới khác đang soi. Lưới khi đó không "đỏ oan"; nó lặng lẽ
 * soi một bản mã THIẾU, tức YẾU ĐI mà vẫn xanh — đúng chế độ hỏng luật 14 cảnh báo.
 * Bỏ chú thích DÒNG trước (neo `^` nên `https://` giữa dòng không hề hấn), rồi mới khối.
 */
function boChuThich(s: string): string {
  return s.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const MA = boChuThich(readFileSync(resolve(process.cwd(), DUONG_DAN), "utf8"));

/**
 * Mọi khối `{!anXacNhan && ( … )}`, cắt bằng ĐẾM NGOẶC `{`/`}`.
 *
 * ⚠️ Không dùng `indexOf(")}")`: nút Xác nhận chứa ternary `{pending ? (…) : (…)}`,
 * nên dấu `)}` đầu tiên là của TERNARY, không phải của khối bọc. Bản đầu của lưới này
 * mắc đúng lỗi đó và "xanh" mà chưa kiểm được gì (phép cấy 02/10 phơi ra).
 */
function khoiAnXacNhan(ma: string): string[] {
  const ra: string[] = [];
  for (let i = ma.indexOf("{!anXacNhan"); i !== -1; i = ma.indexOf("{!anXacNhan", i + 1)) {
    let sau = 0;
    let j = i;
    for (; j < ma.length; j++) {
      if (ma[j] === "{") sau++;
      else if (ma[j] === "}") {
        sau--;
        if (sau === 0) break;
      }
    }
    ra.push(ma.slice(i, j + 1));
  }
  return ra;
}

describe("[CCT] dòng 'Chờ convert' vẫn từ chối / sửa được", () => {
  it("[CCT-01] nhánh Chờ convert có vẽ <RowActions>", () => {
    // Bản TRƯỚC bản vá: khối `<span>…Chờ convert…</span>` không chứa RowActions nào.
    const i = MA.indexOf("Chờ convert");
    expect(i, "không còn chuỗi 'Chờ convert' — nhánh đã bị viết lại, đọc lại lưới này").toBeGreaterThan(-1);
    const ketThuc = MA.indexOf("</span>", i);
    expect(ketThuc).toBeGreaterThan(i);
    const khoi = MA.slice(i, ketThuc);
    expect(khoi, "nhánh 'Chờ convert' phải vẽ <RowActions> — nếu không, khoản nhập trùng chưa gắn ghi danh không có đường gỡ").toContain("<RowActions");
  });

  it("[CCT-02] và nó truyền anXacNhan (giấu ĐÚNG nút sẽ lỗi, không giấu cả cụm)", () => {
    const i = MA.indexOf("Chờ convert");
    const khoi = MA.slice(i, MA.indexOf("</span>", i));
    expect(khoi).toContain("anXacNhan");
    // KHÔNG được giấu bằng cách tắt luôn Từ chối/Sửa: hai prop đó không tồn tại, và
    // nếu ai đó thêm thì lưới này phải đỏ để buộc đọc lại lý do.
    expect(khoi).not.toContain("anTuChoi");
    expect(khoi).not.toContain("anSua");
  });

  it("[CCT-03] RowActions chỉ bọc nút Xác nhận trong cờ anXacNhan — đúng MỘT chỗ", () => {
    // Neo vào biểu thức điều kiện, không neo vào vị trí dòng.
    const soLan = MA.match(/\{!anXacNhan\s*&&/g)?.length ?? 0;
    expect(soLan, "phải có ĐÚNG 1 chỗ dùng `{!anXacNhan &&` — nhiều hơn nghĩa là có người bọc thêm nút khác vào cùng cờ").toBe(1);
  });

  it("[CCT-04] nút Từ chối và Sửa KHÔNG nằm trong BẤT KỲ khối anXacNhan nào", () => {
    // ⚠️ HAI lỗi trong bản đầu của chính ca này, cả hai do PHÉP CẤY tìm ra (02/10):
    //  (1) chỉ soi khối `{!anXacNhan` ĐẦU TIÊN ⇒ thêm khối bọc THỨ HAI quanh nút Từ chối
    //      thì ca vẫn XANH;
    //  (2) cắt khối bằng `indexOf(")}")` ⇒ dừng ở dấu đóng của **ternary bên trong nút
    //      Xác nhận** (`{pending ? (…) : (…)}`), chứ không phải dấu đóng của khối bọc.
    //      Hệ quả: vùng soi chỉ dài vài dòng và không bao giờ chạm tới nút nào khác —
    //      ca "xanh" mà chưa từng kiểm được điều nó tuyên bố.
    // Nay cắt khối bằng ĐẾM NGOẶC thật, và duyệt MỌI khối.
    const khoi = khoiAnXacNhan(MA);
    expect(khoi.length, "không tìm thấy khối `{!anXacNhan` nào").toBeGreaterThan(0);

    const gop = khoi.join("\n");
    expect(gop, "phải có nút Xác nhận bên trong cờ").toContain('title="Xác nhận"');
    expect(gop, "nút Từ chối bị kéo vào cờ anXacNhan ⇒ khoản chưa gắn ghi danh lại mất đường gỡ").not.toContain('title="Từ chối"');
    expect(gop, "nút Sửa bị kéo vào cờ anXacNhan").not.toContain('title="Sửa khoản chờ duyệt"');
  });

  it("[CCT-05] ba nút vẫn còn đủ trong RowActions", () => {
    expect(MA.match(/title="Xác nhận"/g)?.length ?? 0).toBe(1);
    expect(MA.match(/title="Từ chối"/g)?.length ?? 0).toBe(1);
    expect(MA.match(/title="Sửa khoản chờ duyệt"/g)?.length ?? 0).toBe(1);
  });
});
