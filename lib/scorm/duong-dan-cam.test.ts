import { describe, expect, it } from "vitest";
import { laDuongDanNoiBo } from "@/lib/scorm/duong-dan-cam";

describe("[DDC] đường dẫn nội bộ của gói SCORM không được phục vụ", () => {
  it("[DDC-01] zip gốc ở gốc gói bị chặn, mọi cách viết", () => {
    for (const rel of [["source.zip"], ["Source.ZIP"], ["source.zip."], ["source.zip "], ["%73ource.zip"], ["source%2ezip"], ["package.zip"]]) {
      expect(laDuongDanNoiBo(rel), JSON.stringify(rel)).toBe(true);
    }
  });
  it("[DDC-02] thư mục _src của đường presign mới bị chặn ở mọi độ sâu", () => {
    expect(laDuongDanNoiBo(["_src", "package.zip"])).toBe(true);
    expect(laDuongDanNoiBo(["res", "_SRC", "x.js"])).toBe(true);
  });
  it("[DDC-03] tệp phục vụ bình thường KHÔNG bị chặn (đối chứng dương)", () => {
    for (const rel of [["res", "index.html"], ["res", "data", "video1.mp4"], ["res", "data", "player.js"], ["imsmanifest.xml"], ["res", "data", "img1.png"]]) {
      expect(laDuongDanNoiBo(rel), JSON.stringify(rel)).toBe(false);
    }
  });
  it("[DDC-04] rel rỗng không ném", () => {
    expect(laDuongDanNoiBo([])).toBe(false);
  });

  it("[DDC-05] mã hoá phần trăm CHỒNG (kép, ba lớp) vẫn bị chặn", () => {
    for (const rel of [["%2573ource.zip"], ["%252573ource.zip"], ["source%252ezip"], ["%255fsrc", "package.zip"], ["res", "%255Fsrc", "x.js"]]) {
      expect(laDuongDanNoiBo(rel), JSON.stringify(rel)).toBe(true);
    }
  });
  it("[DDC-06] Unicode độ rộng-đầy-đủ, ký tự vô hình, NUL, dấu chấm/khoảng trắng cuối đều bị chuẩn hoá về cùng một tên", () => {
    for (const rel of [
      ["ｓｏｕｒｃｅ．ｚｉｐ"], // NFKC → source.zip
      ["so​urce.zip"], // zero-width space
      ["﻿source.zip"], // BOM
      ["source.zip\0"],
      ["source.zip..."],
      ["source.zip \t"],
      ["source.zip%20"],
      ["source.zip%00"],
      ["_src​", "x"],
      ["＿ｓｒｃ", "x"], // _src dạng đầy đủ
    ]) {
      expect(laDuongDanNoiBo(rel), JSON.stringify(rel)).toBe(true);
    }
  });
  it("[DDC-07] một segment mang dấu phân cách (%2F, %5C đã giải mã) được tách thành nhiều segment", () => {
    // Next giải mã %2F thành "/" TRONG một segment: `["_src/package.zip"]` hay `["res/../source.zip"]` phải bị chặn như nhiều segment.
    for (const rel of [["_src/package.zip"], ["_src\\other.bin"], ["res/_src/x.js"], ["res%2F..%2Fsource.zip"], ["..%5Csource.zip"], ["a/./b.js"]]) {
      expect(laDuongDanNoiBo(rel), JSON.stringify(rel)).toBe(true);
    }
  });
  it("[DDC-08] dot-segment, segment rỗng, đường tuyệt đối ⇒ chặn (fail-closed)", () => {
    for (const rel of [[".."], ["."], ["res", "..", "source.zip"], ["res", ""], ["/source.zip"], ["..."]]) {
      expect(laDuongDanNoiBo(rel), JSON.stringify(rel)).toBe(true);
    }
  });
  it("[DDC-09] mã hoá chồng quá sâu (cố lách) ⇒ chặn luôn", () => {
    let v = "a b.js";
    for (let i = 0; i < 8; i++) v = encodeURIComponent(v);
    expect(laDuongDanNoiBo(["res", v])).toBe(true);
  });
  it("[DDC-10] đối chứng dương trên TÊN THẬT của gói: không chặn nhầm", () => {
    for (const rel of [
      ["res", "index.html"],
      ["res", "data", "video1.mp4"],
      ["res", "data", "player.js"],
      ["res", "data", "img12.png"],
      ["imsmanifest.xml"],
      ["adlcp_rootv1p2.xsd"],
      ["res", "schemas", "ims_xml.xsd"],
      ["res", "schemas", "imscp_v1p1.dtd"],
      ["source.pdf"], // giáo án PDF: CHÍNH nội dung phát, không phải bản nguồn để chặn
      ["res", "data", "bài 1 – Giới thiệu.png"], // tên có dấu + khoảng trắng + gạch dài
      ["res", "data", "100%.png"], // % lẻ không phải mã hoá
      ["res", "data", ".htaccess-giong-ten"],
      ["res", "tai-ve", "bai-tap.zip"], // zip học liệu nằm SÂU trong gói là hợp lệ (chỉ zip ở GỐC bị chặn)
      ["res", "src", "app.js"], // `src` không phải `_src`
      ["res", "_source", "a.js"], // chỉ khớp ĐÚNG `_src`
      ["resources", "zip", "a.js"],
    ]) {
      expect(laDuongDanNoiBo(rel), JSON.stringify(rel)).toBe(false);
    }
  });
  it("[DDC-11] tên hợp lệ mã hoá HAI lớp (ổn định sau 2 lần giải mã) KHÔNG bị chặn nhầm; chỉ chồng quá sâu mới bị chặn", () => {
    expect(laDuongDanNoiBo(["res", "data", "a%2520b.js"])).toBe(false); // a%2520b → a%20b → "a b"
    expect(laDuongDanNoiBo(["res", "data", "a%20b.png"])).toBe(false);
    expect(laDuongDanNoiBo(["res", "data", "%E1%BA%A3nh.png"])).toBe(false); // "ảnh.png" đã mã hoá UTF-8
  });
});
