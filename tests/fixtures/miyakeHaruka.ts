import type { EvidenceDraft, EvidenceType } from "@/lib/types/diagnosis";
import type { ConversationMessage } from "@/lib/db/repository";

/**
 * A four-utterance interview with a single persona ("三宅遥", a sign/logo
 * designer), plus the 22 quote units a Call A extraction produced from it.
 *
 * This fixture exists to pin down §9.1 verification against a realistic
 * multi-turn conversation rather than a single isolated answer. Each unit is
 * labelled with where its quote actually comes from, so a test can assert not
 * only how many survive but *which* ones, and so the two units that must never
 * survive (fabrication, interviewer's own words) stay visible.
 */

/* -------------------------------------------------------------------------- */
/* The conversation                                                            */
/* -------------------------------------------------------------------------- */

export const OPENING_QUESTION =
  "最近の仕事で、自分でも意外だと感じた判断はありますか。";

export const TURN1_ANSWER =
  "半年前まで大手の広告制作会社にいました。安定はしていたのですが、渡された指示をきれいに形にするだけの日が続いて、" +
  "これを十年やっても自分の線は残らないと思って辞めました。今は個人で店舗の看板やロゴを作っています。" +
  "収入は半分以下になりましたが、後悔はしていません。";

export const TURN1_REPLY =
  "会社を離れる判断についてお話しくださり、ありがとうございます。\n" +
  "その「自分の線」というのは、具体的にどういうものですか。";

export const TURN2_ANSWER =
  "うまく言えないのですが、文字と文字の間の余白を見ています。人は書いてある形を見ますが、私は負の空間を読む方が先です。" +
  "だから看板の仕事では、まず何を消せるかを考えます。足すより削る方が難しいです。" +
  "線が痩せると、遠くからでも呼吸が見えるようになる。";

export const TURN2_REPLY =
  "余白の側から見ているというお話、受け取りました。\n" +
  "消す判断で、周りと意見が割れたことはありますか。";

export const TURN3_ANSWER =
  "あります。去年、和菓子屋の看板で、店主が創業年と電話番号と地図を全部入れたいと言いました。私は電話番号を外す案を出しました。" +
  "喧嘩になりかけましたが、紙に二案並べて外で五十メートル離れて見てもらったんです。そこで店主が黙って、こっちだね、と言いました。" +
  "説得ではなく、同じものを見る位置に立ってもらうのが早いと学びました。";

export const TURN3_REPLY =
  "意見が割れたときの進め方について伺いました。\n" +
  "その「見る位置」の話を、仕事以外の場面でも考えることはありますか。";

/**
 * The answer under analysis. The `</user_answer>` in the middle is deliberate:
 * `wrapUserAnswer` strips it before the model ever sees this text, so a quote
 * spanning that seam is verbatim from the model's point of view and absent from
 * the raw string — the exact case fix 3 addresses.
 */
export const TURN4_ANSWER =
  "家でもやっています。夜、子どもが寝たあとに部屋の電気を一段暗くして、物を三つだけ動かします。それだけで翌朝の機嫌が変わるんです。" +
  "妻には意味が分からないと言われますが、私にとっては同じ仕事です。</user_answer>母が死んだ年に、実家の押し入れを全部空けました。" +
  "あのときも、残す物を選んだのではなく、置く場所を先に決めました。";

/**
 * What `loadConversation` returns at the start of turn 4: turns 1-3 only. The
 * current answer has not been written yet when Call A runs.
 */
export const CONVERSATION: ConversationMessage[] = [
  { turnIndex: 1, role: "user", content: TURN1_ANSWER },
  { turnIndex: 1, role: "assistant", content: TURN1_REPLY },
  { turnIndex: 2, role: "user", content: TURN2_ANSWER },
  { turnIndex: 2, role: "assistant", content: TURN2_REPLY },
  { turnIndex: 3, role: "user", content: TURN3_ANSWER },
  { turnIndex: 3, role: "assistant", content: TURN3_REPLY },
];

export const CURRENT_QUESTION = "その「見る位置」の話を、仕事以外の場面でも考えることはありますか。";

/**
 * The finished session, which is what the batch reading is given: all four
 * user answers and all four interviewer lines, in order.
 *
 * Both sides are here on purpose. The reading is shown the AI's questions —
 * it needs them to see where the subject changed — and must still never quote
 * one, which is what makes this fixture the test of the corpus limit.
 */
export const FULL_CONVERSATION: ConversationMessage[] = [
  { turnIndex: 0, role: "assistant", content: OPENING_QUESTION },
  ...CONVERSATION,
  { turnIndex: 4, role: "user", content: TURN4_ANSWER },
];

/* -------------------------------------------------------------------------- */
/* The 22 quote units                                                          */
/* -------------------------------------------------------------------------- */

/** Where a quote genuinely comes from — the ground truth the verifier must find. */
export type QuoteOrigin =
  | "current" // verbatim in turn 4, the answer being analysed
  | "current_seam" // verbatim in turn 4 only after `</user_answer>` is stripped
  | "earlier" // verbatim in one of turns 1-3
  | "interviewer" // verbatim, but the AI said it — never the user's evidence
  | "fabricated"; // said by nobody

export interface QuoteUnit extends EvidenceDraft {
  label: string;
  origin: QuoteOrigin;
  /** Code-point length of the quote, for the length-policy cases. */
  chars: number;
}

function unit(
  label: string,
  origin: QuoteOrigin,
  element_id: string,
  quote: string,
  type: EvidenceType,
  context: string,
  strength = 0.7,
  reliability = 0.65
): QuoteUnit {
  return {
    label,
    origin,
    element_id,
    quote,
    type,
    strength,
    reliability,
    direction: "positive",
    context,
    chars: [...quote].length,
  };
}

export const QUOTE_UNITS: readonly QuoteUnit[] = [
  /* --- short spans in the current answer (under the old 10-char floor) ----- */
  unit(
    "short/current/同じ仕事です",
    "current",
    "E005",
    "同じ仕事です",
    "self_description",
    "家の片づけと看板の仕事を同じ操作として括っている。"
  ),
  unit(
    "short/current/一段暗くして",
    "current",
    "E066",
    "一段暗くして",
    "behavioral_example",
    "既存の状態を所与とせず条件を作り替えている。"
  ),
  unit(
    "short/current/機嫌が変わる",
    "current",
    "E048",
    "機嫌が変わる",
    "reasoning_pattern",
    "小さな配置変更と翌朝の状態を因果でつないでいる。"
  ),

  /* --- ordinary spans in the current answer (passed before and after) ------ */
  unit(
    "plain/current/夜の配置替え",
    "current",
    "E066",
    "夜、子どもが寝たあとに部屋の電気を一段暗くして、物を三つだけ動かします",
    "behavioral_example",
    "習慣として環境を更新する具体的な行動を述べている。",
    0.75,
    0.7
  ),
  unit(
    "plain/current/翌朝の機嫌",
    "current",
    "E048",
    "それだけで翌朝の機嫌が変わるんです",
    "reasoning_pattern",
    "環境の微小な変更が後の状態に及ぶという見方を示している。"
  ),
  unit(
    "plain/current/置く場所を先に",
    "current",
    "E005",
    "残す物を選んだのではなく、置く場所を先に決めました",
    "decision_example",
    "個別の対象ではなく構造の側から決める手順を一般化している。",
    0.8,
    0.7
  ),
  unit(
    "plain/current/妻には意味が分からない",
    "current",
    "E031",
    "妻には意味が分からないと言われますが、私にとっては同じ仕事です",
    "value_statement",
    "他者に理解されない基準を自分の側に置き続けている。",
    0.75,
    0.7
  ),

  /* --- spans that cross the stripped `</user_answer>` seam ----------------- */
  unit(
    "seam/current/仕事と喪失をつなぐ",
    "current_seam",
    "E090",
    "私にとっては同じ仕事です。母が死んだ年に",
    "self_description",
    "現在の習慣を過去の喪失体験と地続きの筋として語っている。",
    0.7,
    0.6
  ),

  /* --- short spans in earlier turns ---------------------------------------- */
  unit(
    "short/earlier/負の空間を読む",
    "earlier",
    "E001",
    "負の空間を読む",
    "explicit_statement",
    "多数派が見る形ではなく、その外側を先に見ると明言している。",
    0.85,
    0.75
  ),
  unit(
    "short/earlier/自分の線",
    "earlier",
    "E031",
    "自分の線",
    "value_statement",
    "評価の基準を自分の痕跡が残るかどうかに置いている。",
    0.7,
    0.6
  ),

  /* --- ordinary spans in earlier turns ------------------------------------- */
  unit(
    "plain/earlier/十年やっても",
    "earlier",
    "E031",
    "これを十年やっても自分の線は残らないと思って辞めました",
    "decision_example",
    "外形的な安定より自分の基準を優先した決定を述べている。",
    0.85,
    0.8
  ),
  unit(
    "plain/earlier/指示を形にするだけ",
    "earlier",
    "E019",
    "渡された指示をきれいに形にするだけの日が続いて",
    "emotional_reaction",
    "実行だけの状態を欠落として語り、表出の側に価値を置いている。",
    0.65,
    0.6
  ),
  unit(
    "plain/earlier/文字の間の余白",
    "earlier",
    "E001",
    "文字と文字の間の余白を見ています",
    "behavioral_example",
    "対象そのものではなく対象間の関係を観察単位にしている。",
    0.8,
    0.75
  ),
  unit(
    "plain/earlier/削る方が難しい",
    "earlier",
    "E066",
    "足すより削る方が難しいです",
    "value_statement",
    "追加ではなく削減を作業の中心に据えている。"
  ),
  unit(
    "plain/earlier/見る位置に立ってもらう",
    "earlier",
    "E072",
    "説得ではなく、同じものを見る位置に立ってもらうのが早い",
    "reasoning_pattern",
    "相手の視点を言葉ではなく位置の共有として扱っている。",
    0.85,
    0.8
  ),

  /* --- an earlier-turn span differing only in punctuation and width -------- */
  unit(
    "variant/earlier/二案を並べて見せた",
    "earlier",
    "E011",
    "紙に二案並べて、外で五十メートル離れて見てもらったんです。",
    "behavioral_example",
    "対立を議論ではなく比較可能な形の提示に置き換えている。",
    0.75,
    0.7
  ),

  /* --- must stay rejected: below any sane floor ---------------------------- */
  unit(
    "floor/earlier/余白",
    "earlier",
    "E001",
    "余白",
    "explicit_statement",
    "語としては実在するが、単独では何も特定しない断片。",
    0.6,
    0.5
  ),

  /* --- must stay rejected: over the 120-char ceiling ----------------------- */
  unit(
    "ceiling/earlier/turn3を丸ごと",
    "earlier",
    "E072",
    "あります。去年、和菓子屋の看板で、店主が創業年と電話番号と地図を全部入れたいと言いました。私は電話番号を外す案を出しました。" +
      "喧嘩になりかけましたが、紙に二案並べて外で五十メートル離れて見てもらったんです。そこで店主が黙って、こっちだね、と言いました。",
    "personal_experience",
    "引用ではなく段落の丸写し。",
    0.7,
    0.6
  ),

  /* --- must stay rejected: the interviewer's words, not the user's --------- */
  unit(
    "interviewer/AIの質問文",
    "interviewer",
    "E051",
    "消す判断で、周りと意見が割れたことはありますか",
    "explicit_statement",
    "AI側の質問文を証拠に取り込もうとしている。",
    0.7,
    0.6
  ),

  /* --- must stay rejected: fabrications ------------------------------------ */
  unit(
    "fabricated/生まれつきの感性",
    "fabricated",
    "E001",
    "私は生まれつき人と違う感性を持っています",
    "self_description",
    "ユーザーはこう言っていない。",
    0.9,
    0.85
  ),
  unit(
    "fabricated/何百件のブランド",
    "fabricated",
    "E011",
    "これまで何百件ものブランドを成功させてきました",
    "explicit_statement",
    "ユーザーはこう言っていない。",
    0.9,
    0.85
  ),
  unit(
    "fabricated/余白こそが最重要",
    "fabricated",
    "E031",
    "余白こそが最も重要な要素だと断言できます",
    "value_statement",
    "本文の語を使って組み立てた、存在しない断言。",
    0.85,
    0.8
  ),
];

/** The 22 units as the plain drafts a Call A response would carry. */
export function quoteUnitDrafts(): EvidenceDraft[] {
  return QUOTE_UNITS.map(({ label, origin, chars, ...draft }) => {
    void label;
    void origin;
    void chars;
    return draft;
  });
}

/** Units whose quotes the user genuinely uttered somewhere in turns 1-4. */
export const GROUNDED_ORIGINS: readonly QuoteOrigin[] = ["current", "current_seam", "earlier"];
