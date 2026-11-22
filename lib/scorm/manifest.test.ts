import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseManifest } from "./manifest";

/** Dựng zip in-memory bằng JSZip rồi lấy nội dung imsmanifest.xml dạng string. */
async function manifestFromZip(xml: string): Promise<string> {
  const zip = new JSZip();
  zip.file("imsmanifest.xml", xml);
  zip.file("index.html", "<html></html>");
  const file = zip.file("imsmanifest.xml");
  if (!file) throw new Error("manifest missing in zip");
  return file.async("string");
}

const SCORM_12 = `<?xml version="1.0"?>
<manifest identifier="MAN-1" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Bai giang 1</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>SCO 1</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;

const SCORM_2004 = `<?xml version="1.0"?>
<manifest identifier="MAN-2" version="1.0"
  xmlns:imsmd="http://ltsc.ieee.org/xsd/LOM">
  <metadata>
    <schema>ADL SCORM</schema>
    <imsmd:schemaversion>2004 3rd Edition</imsmd:schemaversion>
  </metadata>
  <organizations default="ORG-A">
    <organization identifier="ORG-A">
      <item identifier="I1" identifierref="R1">
        <title>Intro</title>
        <item identifier="I2" identifierref="R2"/>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="R1" type="webcontent" href="content/start.html"/>
    <resource identifier="R2" type="webcontent" href="content/page2.html"/>
  </resources>
</manifest>`;

const MULTI_ORG = `<?xml version="1.0"?>
<manifest identifier="MAN-3">
  <metadata><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG-2">
    <organization identifier="ORG-1">
      <item identifier="X1" identifierref="RX1"/>
    </organization>
    <organization identifier="ORG-2">
      <item identifier="X2" identifierref="RX2"/>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RX1" href="wrong.html"/>
    <resource identifier="RX2" href="right.html"/>
  </resources>
</manifest>`;

describe("parseManifest", () => {
  it("đọc SCORM 1.2 → version + launchUrl", async () => {
    const xml = await manifestFromZip(SCORM_12);
    const r = parseManifest(xml);
    expect(r.version).toBe("SCORM_12");
    expect(r.launchUrl).toBe("index.html");
    expect(r.error).toBeUndefined();
  });

  it("đọc SCORM 2004 (namespace prefix + item lồng) → 2004 + href item đầu", async () => {
    const xml = await manifestFromZip(SCORM_2004);
    const r = parseManifest(xml);
    expect(r.version).toBe("SCORM_2004");
    expect(r.launchUrl).toBe("content/start.html");
  });

  it("nhận diện 'CAM 1.3' là SCORM_2004", () => {
    const r = parseManifest(
      SCORM_2004.replace("2004 3rd Edition", "CAM 1.3"),
    );
    expect(r.version).toBe("SCORM_2004");
  });

  it("nhiều organization → lấy default", async () => {
    const xml = await manifestFromZip(MULTI_ORG);
    const r = parseManifest(xml);
    expect(r.version).toBe("SCORM_12");
    expect(r.launchUrl).toBe("right.html");
  });

  it("thiếu manifest (xml rỗng) → error", () => {
    const r = parseManifest("");
    expect(r.version).toBeNull();
    expect(r.launchUrl).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it("không có thẻ <manifest> → error rõ", () => {
    const r = parseManifest("<html>not a manifest</html>");
    expect(r.version).toBeNull();
    expect(r.error).toContain("<manifest>");
  });

  it("schemaversion lạ → version null + error", () => {
    const r = parseManifest(
      SCORM_12.replace("<schemaversion>1.2</schemaversion>", "<schemaversion>9.9</schemaversion>"),
    );
    expect(r.version).toBeNull();
    expect(r.error).toContain("schemaversion");
  });

  it("resource không có href → launchUrl null + error", () => {
    const broken = SCORM_12.replace(' href="index.html"', "");
    const r = parseManifest(broken);
    expect(r.version).toBe("SCORM_12");
    expect(r.launchUrl).toBeNull();
    expect(r.error).toBeTruthy();
  });
});
