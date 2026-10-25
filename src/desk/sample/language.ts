import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A ledger of prompts in several scripts with the surcharge planted, so that the truth is known before the Desk measures it (DF-043). Every task is a person's prompt followed by the call
 * that read it, written as the logs Claude Code writes, so it goes through the same reader as any other ledger. Each task's tokens are the planted tokens per character for its
 * script and model times its length, plus 180 tokens of harness text that is the same whatever the language, with a little noise.
 *
 * The cells are planted to show each answer the Desk can give: shown with a large surcharge, shown with a small one on a model whose tokenizer is kinder, a cell with too few tasks,
 * a language whose English baseline on that model has too few tasks, and English itself.
 */
export const LANGUAGE_SEED = 20261031;
export const LANGUAGE_FROM = "2026-10-01T00:00:00.000Z";
export const LANGUAGE_TO = "2026-10-31T23:59:59.999Z";
export const HARNESS_TOKENS = 180;

const SONNET = "claude-sonnet-5-5";
const OPUS = "claude-opus-5";
const HAIKU = "claude-haiku-5-5";

export interface PlantedCell {
  script: "en" | "japanese" | "devanagari" | "cyrillic" | "arabic" | "thai";
  model: string;
  tasks: number;
  /** Tokens per character of the prompt, before the harness text. */
  rate: number;
}

export const PLANTED_CELLS: readonly PlantedCell[] = [
  { script: "en", model: SONNET, tasks: 60, rate: 0.25 },
  { script: "japanese", model: SONNET, tasks: 40, rate: 0.8 },
  { script: "devanagari", model: SONNET, tasks: 30, rate: 1.4 },
  { script: "cyrillic", model: SONNET, tasks: 25, rate: 0.5 },
  { script: "arabic", model: SONNET, tasks: 22, rate: 0.6 },
  { script: "thai", model: SONNET, tasks: 9, rate: 0.9 },
  { script: "en", model: OPUS, tasks: 45, rate: 0.27 },
  { script: "japanese", model: OPUS, tasks: 30, rate: 0.54 },
  { script: "devanagari", model: OPUS, tasks: 8, rate: 1.1 },
  { script: "en", model: HAIKU, tasks: 6, rate: 0.25 },
  { script: "japanese", model: HAIKU, tasks: 24, rate: 0.7 },
];

const SENTENCES: Record<PlantedCell["script"], string[]> = {
  en: [
    "Please look at the failing test in the payments module and tell me why the retry logic does not stop after the third attempt.",
    "The build breaks on the CI machine but passes locally, so check which environment variable the config loader reads and what it falls back to.",
    "Rename the helper that parses the invoice header to something clearer, update every caller, and run the whole suite again before you report back.",
    "I would like the error messages from the importer to say which row failed and why, instead of the generic message it prints at the moment.",
    "Can you go through the dependencies of this package and remove the ones nothing imports, then explain what you removed and what you left alone.",
    "The dashboard is slow when a customer has more than ten thousand sessions, so find the query that does it and suggest an index that would help.",
    "Write a short description of how the cache is invalidated when a price changes, and point to the lines where each step happens in the code.",
    "After the last change the report totals are off by a few cents for some currencies, so look at how the amounts are rounded and where.",
  ],
  japanese: [
    "この関数にバグがあります。原因を調べて修正し、同じ問題が起きないようにテストも追加してください。",
    "テストが失敗しているので、ログを確認してなぜ失敗するのか教えてください。必要なら設定も見直してください。",
    "リトライの処理が三回目で止まらない理由を調べて、止まるように直してください。変更点は短く説明してください。",
    "変数の名前をもっとわかりやすいものに変更して、すべての呼び出し元を更新し、テストをもう一度実行してください。",
    "設定ファイルを読み込む部分をリファクタリングして、エラー処理を追加し、失敗したときのメッセージを改善してください。",
    "このモジュールの依存関係を整理して、使われていないものを削除してください。削除したものの一覧も教えてください。",
  ],
  devanagari: [
    "इस फ़ंक्शन में एक त्रुटि है, कृपया कारण खोजें और इसे ठीक करें, और वही समस्या दोबारा न हो इसके लिए परीक्षण भी जोड़ें।",
    "परीक्षण विफल हो रहा है, कृपया लॉग देखें और बताएं कि यह क्यों विफल हो रहा है। यदि आवश्यक हो तो सेटिंग भी जांचें।",
    "पुनः प्रयास का तर्क तीसरी कोशिश के बाद क्यों नहीं रुकता, इसकी जांच करें और इसे रुकने के लिए सुधारें।",
    "चर का नाम बदलकर अधिक स्पष्ट करें, सभी कॉल करने वाली जगहों को अपडेट करें और परीक्षण फिर से चलाएं।",
    "कॉन्फ़िगरेशन फ़ाइल पढ़ने वाले हिस्से को सुधारें, त्रुटि प्रबंधन जोड़ें और विफल होने पर संदेश बेहतर बनाएं।",
    "इस मॉड्यूल की निर्भरताओं को व्यवस्थित करें और जो उपयोग में नहीं हैं उन्हें हटा दें, फिर बताएं कि क्या हटाया।",
  ],
  cyrillic: [
    "В этой функции есть ошибка, найдите причину и исправьте её, а затем добавьте тест, чтобы эта проблема не повторилась.",
    "Тест не проходит, посмотрите журнал и объясните, почему он не проходит. При необходимости проверьте и настройки.",
    "Выясните, почему логика повторных попыток не останавливается после третьей попытки, и исправьте это.",
    "Переименуйте переменную понятнее, обновите все места вызова и запустите тесты ещё раз до отчёта.",
    "Улучшите чтение файла конфигурации, добавьте обработку ошибок и сделайте сообщение при сбое понятнее.",
    "Приведите в порядок зависимости модуля и удалите ненужные, а потом перечислите, что именно вы удалили.",
  ],
  arabic: [
    "هناك خطأ في هذه الدالة، ابحث عن السبب وأصلحه، ثم أضف اختبارا حتى لا تتكرر المشكلة نفسها مرة أخرى.",
    "الاختبار يفشل، راجع السجل وأخبرني لماذا يفشل. وإذا لزم الأمر فراجع الإعدادات أيضا قبل أن تجيب.",
    "اكتشف لماذا لا يتوقف منطق إعادة المحاولة بعد المحاولة الثالثة، ثم أصلحه ليتوقف في الوقت المناسب.",
    "أعد تسمية المتغير ليكون أوضح، وحدّث كل الأماكن التي تستدعيه، ثم شغل الاختبارات مرة أخرى.",
    "حسّن قراءة ملف الإعدادات وأضف معالجة للأخطاء وحسّن الرسالة التي تظهر عند الفشل.",
    "رتب اعتماديات هذه الوحدة واحذف ما لا حاجة إليه، ثم اذكر لي ما حذفته بالضبط.",
  ],
  thai: [
    "ฟังก์ชันนี้มีข้อผิดพลาด กรุณาหาสาเหตุและแก้ไข แล้วเพิ่มการทดสอบเพื่อไม่ให้ปัญหาเดิมเกิดขึ้นอีก",
    "การทดสอบล้มเหลว กรุณาดูบันทึกและบอกว่าทำไมจึงล้มเหลว ถ้าจำเป็นให้ตรวจการตั้งค่าด้วย",
    "ตรวจสอบว่าทำไมตรรกะการลองใหม่จึงไม่หยุดหลังจากครั้งที่สาม และแก้ไขให้หยุด",
    "เปลี่ยนชื่อตัวแปรให้ชัดเจนขึ้น อัปเดตทุกที่ที่เรียกใช้ และรันการทดสอบอีกครั้งก่อนรายงาน",
  ],
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


function promptText(script: PlantedCell["script"], chars: number, rand: () => number): string {
  const pool = SENTENCES[script];
  let out = "";
  while ([...out].length < chars) out += (out === "" ? "" : " ") + (pool[Math.floor(rand() * pool.length)] as string);
  return out;
}

function userLine(o: { id: string; session: string; ts: string; text: string }): string {
  return JSON.stringify({ parentUuid: null, isSidechain: false, type: "user", uuid: o.id, timestamp: o.ts, sessionId: o.session, cwd: "/work/ledger-language", gitBranch: "main", version: "lang-1", message: { role: "user", content: o.text } });
}

function assistantLine(o: { id: string; session: string; ts: string; model: string; fresh: number; read: number }): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: "assistant",
    uuid: `${o.id}-0`,
    timestamp: o.ts,
    sessionId: o.session,
    requestId: `req_${o.id}`,
    apiBlockIndex: 0,
    cwd: "/work/ledger-language",
    gitBranch: "main",
    version: "lang-1",
    message: {
      id: o.id,
      type: "message",
      role: "assistant",
      model: o.model,
      stop_reason: "end_turn",
      content: [{ type: "text", text: "" }],
      usage: { input_tokens: 4, cache_creation_input_tokens: o.fresh, cache_read_input_tokens: o.read, output_tokens: 600, service_tier: "standard", speed: "standard", cache_creation: { ephemeral_5m_input_tokens: o.fresh, ephemeral_1h_input_tokens: 0 } },
    },
  });
}

/**
 * Write the sessions into `dir` and return the files. Tasks are dealt out to sessions of up to eight prompts each, in one script and on one model; the first prompt of every session is
 * an English one whose call also writes the harness's whole system prompt to the cache, which the Desk must not read as a prompt's tokens.
 */
export function writeLanguageLogs(dir: string, seed: number = LANGUAGE_SEED): string[] {
  mkdirSync(dir, { recursive: true });
  const rand = rng(seed);
  const files: string[] = [];
  let serial = 0;
  for (const cell of PLANTED_CELLS) {
    const lines: string[] = [];
    let left = cell.tasks;
    while (left > 0) {
      serial += 1;
      const n = Math.min(left, 8);
      left -= n;
      const session = `lang-${serial}`;
      const day = 1 + Math.floor(rand() * 28);
      let t = Date.UTC(2026, 9, day, 8 + Math.floor(rand() * 9), Math.floor(rand() * 40));
      const iso = (ms: number): string => new Date(ms).toISOString();
      lines.push(userLine({ id: `${session}-p0`, session, ts: iso(t), text: promptText("en", 160, rand) }));
      lines.push(assistantLine({ id: `${session}-c0`, session, ts: iso(t + 4_000), model: cell.model, fresh: 18_000, read: 0 }));
      t += 120_000;
      for (let i = 1; i <= n; i += 1) {
        const chars = 100 + Math.floor(rand() * 600);
        const text = promptText(cell.script, chars, rand);
        const written = [...text].length;
        const tokens = Math.round(cell.rate * written * (0.94 + rand() * 0.12) + HARNESS_TOKENS);
        lines.push(userLine({ id: `${session}-p${i}`, session, ts: iso(t), text }));
        lines.push(assistantLine({ id: `${session}-c${i}`, session, ts: iso(t + 5_000), model: cell.model, fresh: tokens - 4, read: 18_000 + i * 900 }));
        t += 150_000;
      }
    }
    const file = join(dir, `lang-${cell.model}-${cell.script}.jsonl`);
    writeFileSync(file, `${lines.join("\n")}\n`);
    files.push(file);
  }
  return files;
}
