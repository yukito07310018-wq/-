/**
 * Real interview answers, used to test the extraction boundary against the text
 * users actually write rather than against tidy synthetic strings.
 *
 * Kept verbatim, including the 「」 quoting that appears in nearly every answer.
 */

export const realUtterances = {
  letterpress:
    "活版印刷って「製本の前に完全に版を組み終わらないといけない」って誰も言わないんですけど、実際にやってみたら別にそうじゃないなって。途中で紙質に合わせて型を調整するほうが、仕上がりが全然違う。",
  countdown:
    "ほぼ決めずに始めます。でも締切の逆算表は初日に絶対つくる。矛盾してますね（笑）。",
  negativeSpace:
    "建築の「負の空間を読む」という考え方を持ち込んでます。ページの余白の使い方が変わりました。ただ、自分で意識して持ち込んだのか、単に本をいっぱい読んでたから自然に染み込んだのか、今となっては判別つかないですね。",
  industryStandard:
    "製本の順序について「これが業界標準」って言われたことあるけど、無視して自分の流れでやってます。",
} as const;

export const allUtterances = Object.values(realUtterances);

/**
 * Spans an analyst would plausibly cite from the answers above.
 * Every one of these is a contiguous, verbatim substring of its source.
 */
export const verbatimQuotes: { utterance: string; quote: string; note: string }[] = [
  {
    utterance: realUtterances.letterpress,
    quote: "実際にやってみたら別にそうじゃないなって",
    note: "既成の前提を自分で検証した部分",
  },
  {
    utterance: realUtterances.letterpress,
    quote: "「製本の前に完全に版を組み終わらないといけない」って誰も言わないんですけど",
    note: "内側の鉤括弧をまたぐ引用",
  },
  {
    utterance: realUtterances.letterpress,
    quote: "途中で紙質に合わせて型を調整するほうが、仕上がりが全然違う",
    note: "読点をまたぐ引用",
  },
  {
    utterance: realUtterances.countdown,
    quote: "ほぼ決めずに始めます",
    note: "ちょうど10字",
  },
  {
    utterance: realUtterances.countdown,
    quote: "でも締切の逆算表は初日に絶対つくる",
    note: "句点で区切られた一文",
  },
  {
    utterance: realUtterances.countdown,
    quote: "ほぼ決めずに始めます。でも締切の逆算表は初日に絶対つくる",
    note: "句点をまたいで二文を結合",
  },
  {
    utterance: realUtterances.negativeSpace,
    quote: "建築の「負の空間を読む」という考え方を持ち込んでます",
    note: "鉤括弧を内包した一文",
  },
  {
    utterance: realUtterances.negativeSpace,
    quote: "自分で意識して持ち込んだのか、単に本をいっぱい読んでたから自然に染み込んだのか",
    note: "長めの自己言及",
  },
  {
    utterance: realUtterances.industryStandard,
    quote: "「これが業界標準」って言われたことあるけど、無視して自分の流れでやってます",
    note: "鉤括弧＋読点をまたぐ",
  },
  {
    utterance: realUtterances.industryStandard,
    quote: "無視して自分の流れでやってます",
    note: "短い行動記述",
  },
];

/** Short but meaningful spans — the kind an analyst naturally reaches for. */
export const shortMeaningfulQuotes: { utterance: string; quote: string }[] = [
  { utterance: realUtterances.letterpress, quote: "別にそうじゃないな" },
  { utterance: realUtterances.countdown, quote: "矛盾してますね" },
  { utterance: realUtterances.countdown, quote: "ほぼ決めずに始めます" },
  { utterance: realUtterances.negativeSpace, quote: "負の空間を読む" },
  { utterance: realUtterances.industryStandard, quote: "これが業界標準" },
  { utterance: realUtterances.letterpress, quote: "誰も言わない" },
];
