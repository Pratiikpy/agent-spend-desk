import { describe, expect, it } from "vitest";

import { classify, ENGLISH_MIN_WORDS, LABEL_NAME, looksEnglish, stripWrappers, type Label } from "../../src/desk/lang/script.ts";

const CASES: [string, Label, string][] = [
  ["There is a bug in this function, please fix it and add a test for the empty case", "en", "English prose"],
  ["इस फ़ंक्शन में एक त्रुटि है, कृपया इसे ठीक करें और खाली मामले के लिए एक परीक्षण जोड़ें", "devanagari", "Hindi"],
  ["この関数にバグがあります。直して、空の場合のテストを追加してください", "japanese", "Japanese with kana and kanji"],
  ["这个函数有一个错误，请修复它并为空的情况添加测试", "han", "Chinese, Han characters only"],
  ["이 함수에 버그가 있습니다. 고쳐 주시고 빈 경우에 대한 테스트를 추가해 주세요", "korean", "Korean"],
  ["В этой функции есть ошибка, пожалуйста, исправьте её и добавьте тест для пустого случая", "cyrillic", "Russian"],
  ["هناك خطأ في هذه الدالة، من فضلك أصلحها وأضف اختبارا للحالة الفارغة", "arabic", "Arabic"],
  ["Υπάρχει ένα σφάλμα σε αυτή τη συνάρτηση, παρακαλώ διορθώστε το και προσθέστε ένα τεστ", "greek", "Greek"],
  ["มีข้อผิดพลาดในฟังก์ชันนี้ กรุณาแก้ไขและเพิ่มการทดสอบสำหรับกรณีที่ว่างเปล่า", "thai", "Thai"],
  ["இந்த செயல்பாட்டில் ஒரு பிழை உள்ளது, தயவுசெய்து அதை சரிசெய்யவும்", "tamil", "Tamil"],
  ["Il y a une erreur dans cette fonction, corrigez-la et ajoutez un test pour le cas vide", "latin", "French is Latin script and is not called English"],
  ["npm run build && git status", "latin", "a command"],
  ["fix it", "latin", "too short to be shown to be English"],
  ["1234 5678 !!! ???", "none", "no letters"],
];

describe("the script a prompt is written in", () => {
  it.each(CASES)("labels %j as %s (%s)", (text, label) => {
    expect(classify(text).label).toBe(label);
  });

  it("counts the characters the person wrote and the letters among them", () => {
    const f = classify("Fix the bug, now!");
    expect(f.chars).toBe(17);
    expect(f.letters).toBe(12);
    expect(classify("日本語です").chars).toBe(5);
  });

  it("counts code points, not UTF-16 units, so an emoji is one character", () => {
    expect(classify("fix 🙂 it").chars).toBe(8);
  });

  it("labels by the non-Latin script when the Latin letters are only identifiers inside it", () => {
    expect(classify("この関数 getUserName が null を返します。修正してください").label).toBe("japanese");
    expect(classify("इस function में getUserName null लौटाता है, कृपया इसे ठीक करें").label).toBe("devanagari");
  });

  it("calls English with a little foreign text still English, and a mostly foreign text by its script", () => {
    expect(classify("Please rename the variable to 名前 in this function and run the tests again").label).toBe("en");
    expect(classify("これは日本語の文章です。 fix it").label).toBe("japanese");
  });

  it("calls a text in two non-Latin scripts, neither carrying it, mixed", () => {
    expect(classify("Привет мир こんにちは世界 Привет мир こんにちは世界").label).toBe("mixed");
  });

  it("takes the harness's own wrappers out before counting, and leaves what the person wrote", () => {
    const text = "<system-reminder>Be careful with files and run the tests before you finish the job please.</system-reminder>fix the build";
    expect(stripWrappers(text).trim()).toBe("fix the build");
    expect(classify(text).chars).toBe(13);
    expect(classify("<ide_opened_file>The user opened a.ts in the IDE</ide_opened_file> rename x to y please now").label).toBe("en");
  });

  it("needs English function words, enough of them in enough words, to call Latin text English", () => {
    expect(looksEnglish("one two three four five")).toBe(false);
    expect(ENGLISH_MIN_WORDS).toBeGreaterThan(3);
    expect(looksEnglish("the result of the run is not what you would expect from the code")).toBe(true);
    expect(looksEnglish("function handleRequest(req, res) { return res.send(req.body.value) }")).toBe(false);
  });

  it("names every label a reader may see", () => {
    for (const [, label] of CASES) expect(LABEL_NAME[label].length).toBeGreaterThan(2);
    expect(LABEL_NAME.latin).toMatch(/not shown to be English/);
  });

  it("gives the same answer for the same text, and does not read past text it was given", () => {
    for (const [t] of CASES) expect(classify(t)).toEqual(classify(t));
    expect(classify("")).toEqual({ label: "none", chars: 0, letters: 0, share: 0 });
  });
});
