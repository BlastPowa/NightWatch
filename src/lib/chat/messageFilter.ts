import {
  RegExpMatcher,
  TextCensor,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity';
import { settingsStore } from '@/lib/settings';

const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});
const profanityCensor = new TextCensor();

/** Apply the sender's local message-filter preference before any transport. */
export function prepareOutgoingMessage(text: string, maxLength: number): string {
  const trimmed = text.trim().slice(0, maxLength);
  return settingsStore.get().chatFilterEnabled
    ? profanityCensor.applyTo(trimmed, profanityMatcher.getAllMatches(trimmed))
    : trimmed;
}
