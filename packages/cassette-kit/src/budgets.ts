/**
 * The copy budgets (the design system's W2), in one place for every part that holds words: a title, a card's one line,
 * a Tip's one short sentence, a field's placeholder, and an account card's words in all. The parts say so in development
 * when words run over; the tests hold the named sentences to them. They move into the system's tokens in wave 3.
 */
export const BUDGET = {
  /** a page's or a card's title */
  title: 40,
  /** a card's one line: one sentence */
  line: 90,
  /** a Tip: one short sentence */
  tip: 90,
  /** a field's placeholder */
  placeholder: 32,
  /** every word an account card shows, keys and links included */
  cardWords: 40,
} as const;
