/**
 * What a question is about, as words. H-MEM ranks memories by a hybrid score whose semantic part comes from a hash embedder, and on short notes that score is small for a
 * question that plainly asks about them and as large for one that has nothing to do with them (a question about the weather in Paris scored 0.20 against a note about a billing
 * module, and a question about landed work scored 0.18 against a note defining landed). No threshold on that score separates the two. So the Desk keeps the engine's ranking
 * and adds a plain condition: a note answers a question only if the two share a topic word. Words that only frame a question to a memory ("what did I tell you about") are not topics.
 */
const FRAME = new Set([
  "what", "which", "who", "when", "where", "why", "how", "did", "do", "does", "have", "has", "had", "is", "are", "was", "were", "be", "been",
  "i", "me", "my", "mine", "we", "our", "you", "your", "us", "it", "its", "they", "them", "their", "he", "she", "this", "that", "these", "those",
  "tell", "told", "say", "said", "mention", "mentioned", "remember", "remembered", "recall", "know", "knew", "note", "notes", "earlier", "before", "already", "ever", "again",
  "about", "regarding", "concerning", "on", "of", "in", "at", "to", "for", "from", "with", "by", "the", "a", "an", "and", "or", "but", "not", "no", "any", "all", "some", "anything", "something",
  "can", "could", "would", "should", "will", "shall", "may", "might", "please", "give", "show", "list", "there", "here", "if", "so", "as", "than", "then", "up", "out",
]);

/** A word reduced to a stem that matches its plain inflections: landed, lands and landing share `land`. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  for (const suffix of ["ing", "ed", "es", "s", "ly"]) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  if (w.length >= 5 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** The topic stems of a text, without the words that only frame a question to a memory. */
export function topicStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9$.]+/)) {
    const word = raw.replace(/^[.$]+|[.]+$/g, "");
    if (word.length < 2 || FRAME.has(word)) continue;
    out.add(stem(word));
  }
  return out;
}

/** Whether a question and a note share a topic word. */
export function sharesTopic(question: ReadonlySet<string>, note: string): boolean {
  const mine = topicStems(note);
  for (const t of question) if (mine.has(t)) return true;
  return false;
}
