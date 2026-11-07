// Ca [NZ-*] — LƯỚI GHIM MÃ NGUỒN cho bảng giao nick Zalo.
//
// 🔴 LỖI SINH RA FILE NÀY, chụp được trên prod 24/09: ô chọn hiện chuỗi `__chua-giao__`
// cho người dùng đọc. Đó là mã nội bộ của chính tôi rò ra giao diện.
//
// Nguyên nhân: `<SelectValue placeholder="…" />` KHÔNG CÓ CON sẽ render GIÁ TRỊ khi nó
// không khớp nhãn của một `SelectItem` nào — và sentinel thì không khớp, vì nhãn của
// mục ấy là một câu tiếng Việt.
//
// ⚠️ Cách sửa KHÔNG phải đổi chuỗi sentinel cho dễ nhìn: chuỗi nào cũng sai, vì nó là mã
// nội bộ. Phải cho `SelectValue` một CON, để nhãn luôn do mình quyết.
//
// Là lưới GHIM MÃ NGUỒN chứ không phải test hành vi vì thứ cần khẳng định là "tệp này
// không để đường rơi về giá trị thô" — không đầu vào nào chứng minh được điều đó.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEP = "app/(admin)/admin/cau-hinh-van-hanh/_components/tab-nick-zalo-bang.tsx";

/** Bóc chú thích — lưới phải soi MÃ, không soi lời kể về mã (luật 11). Chính khối chú
 *  thích đầu tệp ấy có nhắc sentinel để giải thích, nên không bóc là đỏ vì lời kể. */
function docMa(): string {
  return readFileSync(resolve(process.cwd(), TEP), "utf8")
    .split(/\r?\n/)
    .map((d) => d.replace(/\/\/[^\n]*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

describe("[NZ-01] mã nội bộ KHÔNG rò ra ô chọn", () => {
  const src = docMa();

  it("`SelectValue` có CON — không để rơi về giá trị thô", () => {
    // Dạng tự đóng `<SelectValue ... />` là đúng dạng đã sinh ra lỗi.
    const tuDong = [...src.matchAll(/<SelectValue\b[^>]*\/>/g)].map((m) => m[0]);
    expect(tuDong, `SelectValue tự đóng sẽ hiện giá trị thô: ${tuDong.join(", ")}`).toEqual([]);
    // MỌI `SelectValue` phải có con, không chỉ một cái — đếm hai đầu và so.
    const moThe = [...src.matchAll(/<SelectValue\b/g)].length;
    const coCon = [...src.matchAll(/<SelectValue>[\s\S]{1,400}?<\/SelectValue>/g)].length;
    expect(coCon, `${moThe} thẻ SelectValue nhưng chỉ ${coCon} thẻ có con`).toBe(moThe);
  });

  it("KHÔNG còn giá trị nội bộ nào trong ô chọn — gỡ bằng NÚT, không bằng sentinel", () => {
    // 24/09 (lượt sau): luồng đổi sang "thêm người rồi mới phân quyền", nên ô chọn chỉ
    // còn ba mức thật và việc gỡ là một nút riêng. Không còn chuỗi `__…__` nào để rò.
    //
    // Đây KHÔNG phải nới lỏng ca cũ: nó chặt hơn. Ca cũ canh "sentinel có nhãn đẹp";
    // ca này canh "không có sentinel". Quay lại lối cũ (thêm một mục `__khong-giao__`
    // vào `MUC_QUYEN.map`) sẽ làm ca này đỏ.
    const noiBo = [...src.matchAll(/"__[a-z0-9-]+__"/g)].map((m) => m[0]);
    expect(noiBo, `còn mã nội bộ trong tệp: ${noiBo.join(", ")}`).toEqual([]);

    // Và mục của ô chọn phải dựng TỪ `MUC_QUYEN`, không liệt kê tay (xem [NZ-04]).
    const mucItem = [...src.matchAll(/<SelectItem\b/g)].length;
    expect(mucItem, "đúng một `SelectItem`, sinh trong `MUC_QUYEN.map`").toBe(1);
  });
});

describe("[NZ-02] mật độ và token theo DESIGN.md", () => {
  const src = docMa();

  it("dùng `adminTh`/`adminTd`/`adminTr`, không tự chế lớp bảng", () => {
    for (const k of ["adminTh", "adminTd", "adminTr"]) expect(src).toContain(k);
  });

  it("KHÔNG hex rời — mọi màu đi qua token", () => {
    // Luật §1 của DESIGN.md. Vi phạm dễ thấy nhất: `bg-[#...]`, `text-[#...]`.
    const hex = [...src.matchAll(/(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/g)].map((m) => m[0]);
    expect(hex, `hex rời: ${hex.join(", ")}`).toEqual([]);
  });

  it("trạng thái đi qua `StatusPill` (thang ngữ nghĩa), không tự tô màu", () => {
    // ⚠️ Neo vào LỜI GỌI TRONG JSX, không vào cái TÊN. Bản đầu của ca này dùng
    // `toContain("StatusPill")` và ĐÃ CHẾT — đo được bằng phép cấy 24/09: thay hẳn
    // `<StatusPill …>` bằng `<span>{r.status}</span>` mà 13/13 ca vẫn XANH, vì chuỗi
    // "StatusPill" còn nằm ở dòng `import` và tên hằng nhãn thì vẫn được khai.
    // Cùng lớp với S-1 trong luật 14 — lần thứ ba nó cắn trong repo này.
    expect(src, "StatusPill phải được DÙNG trong JSX, không chỉ được import").toMatch(
      /<StatusPill\b[^>]*>/,
    );
    expect(src).toMatch(/tone=\{tt\.tone\}/);

    // Và không đường nào in thẳng mã trạng thái ra màn.
    const tho = [...src.matchAll(/\{\s*r\.status\s*\}/g)].map((m) => m[0]);
    expect(tho, `mã trạng thái in thô: ${tho.join(", ")}`).toEqual([]);
  });

  it("KHÔNG in trạng thái thô ra màn — mọi mã đều có nhãn tiếng Việt", () => {
    // `UNKNOWN` từng hiện nguyên xi trên prod.
    for (const ma of ["CONNECTED", "DISCONNECTED", "UNKNOWN"]) {
      expect(src, `thiếu nhãn cho ${ma}`).toMatch(new RegExp(`${ma}:\\s*\\{ chu:`));
    }
  });
});

describe("[NZ-03] ô chọn có nhãn cho trình đọc màn hình", () => {
  const src = docMa();

  it("MỌI `SelectTrigger` mang `aria-label`", () => {
    // Ô chọn không có nhãn nhìn thấy được — tên người nằm ở cột bên trái, mà trình đọc
    // màn hình không tự nối nó vào từng ô. Đếm HAI ĐẦU: một `SelectTrigger` mới thêm mà
    // quên nhãn thì ca này phải đỏ, chứ không phải "đã có một cái đúng là xong".
    const tong = [...src.matchAll(/<SelectTrigger\b/g)].length;
    const coNhan = [...src.matchAll(/<SelectTrigger\b[^>]*\baria-label=/g)].length;
    expect(tong, "tệp không còn ô chọn nào — lưới này mất răng").toBeGreaterThan(0);
    expect(coNhan, `${tong} ô chọn nhưng chỉ ${coNhan} ô có aria-label`).toBe(tong);
  });
});

describe("[NZ-04] nhãn mức lấy từ `NHAN_MUC`, không gõ tay", () => {
  const src = docMa();

  it("không chuỗi nào tự chế nhãn mức", () => {
    // Gõ tay "Chỉ xem"/"Quản lý nick" ở đây là tạo bản thứ hai của cùng một nhãn — rồi
    // sửa `NHAN_MUC` mà màn vẫn in bản cũ, và không ai thấy vì cả hai đều đọc xuôi tai.
    //
    // ⚠️ Bản đầu của ca này neo `>${chu}<` (nhãn nằm giữa hai thẻ) và ĐÃ CHẾT — đo bằng
    // phép cấy 24/09: thay `{NHAN_MUC[m]}` bằng
    // `{m === "read" ? "Chỉ xem" : …}` thì 0 ca đỏ, vì trong một biểu thức JSX nhãn nằm
    // giữa hai DẤU NHÁY, không giữa hai thẻ. Neo vào CHÍNH CHUỖI, không vào chỗ nó đứng.
    // (Chú thích đã được bóc trước khi soi, nên dòng này không tự làm mình đỏ.)
    for (const chu of ["Chỉ xem", "Xem và nhắn tin", "Quản lý nick"]) {
      expect(src, `nhãn mức gõ tay: ${chu}`).not.toContain(chu);
    }
    expect(src, "phải đọc nhãn từ NHAN_MUC").toMatch(/NHAN_MUC\[/);
  });

  it("ba mức dựng từ `MUC_QUYEN`, không liệt kê tay", () => {
    // Thêm mức thứ tư mà quên thêm `SelectItem` là hỏng CÂM: ô chọn thiếu một mức, không
    // lỗi nào báo, và người dùng chỉ thấy "không có cách chọn mức đó".
    expect(src).toMatch(/MUC_QUYEN\.map\(/);
  });
});

describe("[NZ-07] người thêm được nhưng vai CHƯA mở được ZaloCRM phải được NÓI RA", () => {
  const src = docMa();

  it("có nhánh cảnh báo dựa trên `dungDuocZalocrm`", () => {
    // 🔴 Từ 24/09 thêm được MỌI nhân sự của cơ sở — kể cả người mà vai của họ không có
    // vé SSO sang ZaloCRM. Dòng giao ấy lưu được nhưng KHÔNG có tác dụng gì: bên kia
    // chưa có tài khoản mang `externalId` đó, lượt đối soát đếm vào `chuaCoTaiKhoan`
    // rồi bỏ qua. Giấu chuyện đó là dựng một nút bấm xong không có gì xảy ra (luật 12).
    expect(src, "màn phải đọc cờ `dungDuocZalocrm`").toMatch(/dungDuocZalocrm/);
    expect(src, "phải có câu giải thích cho người dùng").toMatch(
      /chưa mở được Zalo CRM/,
    );
  });

  it("cảnh báo dùng token trạng thái, không phải màu thương hiệu", () => {
    // DESIGN.md §1: thang ngữ nghĩa riêng cho cảnh báo. `text-primary` ở đây là CAM
    // thương hiệu — đọc như một nhãn quảng cáo, không như một cảnh báo.
    expect(src).toMatch(/text-state-warning-ink/);
  });
});

describe("[NZ-05] trạng thái 'chưa giao ai' nói ĐÚNG hành vi", () => {
  const src = docMa();

  it("in 'Cả cơ sở dùng chung', không phải 'chưa giao' hay gạch ngang", () => {
    // Danh sách rỗng KHÔNG có nghĩa "còn bỏ dở" — nó có nghĩa cả cơ sở dùng được
    // (`nguoiDuocDungMotNick` nhánh ③). Nói sai chỗ này là người vận hành đi "sửa" một
    // thứ đang đúng, và cách họ sửa là giao bừa cho ai đó — tức siết quyền ngoài ý muốn.
    expect(src).toMatch(/Cả cơ sở dùng chung/);
  });
});

describe("[NZ-06] lỗi lưu KHÔNG được đóng hộp thoại", () => {
  const src = docMa();

  it("`dong()` chỉ gọi trong nhánh thành công", () => {
    // Đóng khi lỗi là xoá sạch thứ người dùng vừa chọn; họ phải dựng lại từ đầu để thử
    // tiếp, và phần lớn sẽ bỏ cuộc rồi tưởng là đã lưu.
    // Cắt ĐÚNG thân `luu()`, dừng trước JSX: `onOpenChange` của `Dialog` cũng gọi
    // `dong()` một cách hợp lệ, và lọt vào lát cắt là ca này đỏ vì lý do sai. (Đã xảy ra
    // ở bản đầu — lát cắt cũ chạy tới `</Dialog>`.)
    const dau = src.indexOf("function luu(");
    const ketThucLuu = src.indexOf("return (", dau);
    expect(dau, "không thấy hàm luu()").toBeGreaterThan(-1);
    expect(ketThucLuu, "không thấy JSX sau luu()").toBeGreaterThan(dau);
    const than = src.slice(dau, ketThucLuu);
    const nhanh = than.slice(than.indexOf("if (kq.ok)"));
    const truoc = nhanh.slice(0, nhanh.indexOf("} else {"));
    const sau = nhanh.slice(nhanh.indexOf("} else {"));
    expect(truoc, "nhánh thành công phải đóng hộp thoại").toMatch(/\bdong\(\)/);
    expect(sau, "nhánh lỗi KHÔNG được đóng hộp thoại").not.toMatch(/\bdong\(\)/);
  });
});

describe("[NZ-08] quản lý cơ sở là một DÒNG như mọi người (đảo 24/09)", () => {
  const src = docMa();

  it("KHÔNG còn danh sách tách riêng cho quản lý", () => {
    // Bản trước lọc `nguoi.filter((n) => !n.laQuanLy)` để dựng danh sách thêm được, và
    // hiện quản lý ở một khối ghi chú xám "không gỡ ở đây được". Chủ dự án đảo: phân
    // quyền của quản lý cũng sửa ngay trên màn. Lọc lại là khoá nút gỡ một cách âm thầm.
    const loc = [...src.matchAll(/filter\(\([a-z]+\) => !\s*[a-z]+\.laQuanLy\)/g)].map(
      (m) => m[0],
    );
    expect(loc, `còn lọc quản lý ra khỏi danh sách: ${loc.join(", ")}`).toEqual([]);
  });

  it("CẢNH BÁO khi quản lý không có trong danh sách — không im lặng", () => {
    // Đây là chỗ affordance phải nói thật (luật 12): danh sách có người mà quản lý
    // không có tên nghĩa là họ MẤT tầm nhìn nick, và điều đó phải hiện ra NGAY lúc sắp
    // xảy ra — không phải để người ta phát hiện lúc sếp hỏi.
    expect(src, "thiếu phép tính 'quản lý chưa được thêm'").toMatch(/quanLyChuaThem/);
    expect(src, "thiếu câu cảnh báo").toMatch(/sẽ không đọc được/);
  });

  it("nhãn 'quản lý cơ sở' vẫn hiện — để người bấm biết mình đang gỡ ai", () => {
    // Gỡ nhãn đi thì hai người trùng tên là một câu đố, và người bấm không biết dòng
    // nào là sếp mình.
    expect(src).toMatch(/laQuanLy \? \(/);
    expect(src).toMatch(/quản lý cơ sở/);
  });
});
