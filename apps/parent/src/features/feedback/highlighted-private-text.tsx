import type {
  FeedbackPrivacyFinding,
  FeedbackPrivacyFindingKind,
} from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { StyleSheet, Text, View } from 'react-native';

type MergedFinding = {
  start: number;
  end: number;
  kinds: FeedbackPrivacyFindingKind[];
};

const privacyLabels = {
  KNOWN_PRIVATE_TERM: 'Possible family name',
  EMAIL: 'Possible email address',
  IP_ADDRESS: 'Possible IP address',
  HOSTNAME: 'Possible hostname',
  UUID: 'Possible identifier',
  CREDENTIAL: 'Possible credential',
  LINK: 'Possible link',
} as const satisfies Record<FeedbackPrivacyFindingKind, string>;

export function HighlightedPrivateText({
  text,
  findings,
}: {
  text: string;
  findings: readonly FeedbackPrivacyFinding[];
}) {
  const merged = mergeFindings(text, findings);
  const segments: Array<{
    text: string;
    finding?: MergedFinding;
  }> = [];
  let cursor = 0;
  for (const finding of merged) {
    if (finding.start > cursor) {
      segments.push({ text: text.slice(cursor, finding.start) });
    }
    segments.push({
      text: text.slice(finding.start, finding.end),
      finding,
    });
    cursor = finding.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  if (segments.length === 0) segments.push({ text });

  return (
    <View style={styles.line}>
      {segments.map((segment, index) =>
        segment.finding ? (
          <Text
            key={`${segment.finding.start}-${segment.finding.end}`}
            accessibilityLabel={segment.finding.kinds
              .map((kind) => privacyLabels[kind])
              .join('; ')}
            accessibilityRole="text"
            style={styles.warning}
          >
            {segment.text}
          </Text>
        ) : (
          <Text key={`plain-${index}`} style={styles.plain}>
            {segment.text}
          </Text>
        ),
      )}
    </View>
  );
}

function mergeFindings(
  text: string,
  findings: readonly FeedbackPrivacyFinding[],
): MergedFinding[] {
  const sorted = findings
    .map((finding) => ({
      start: Math.max(0, Math.min(text.length, finding.start)),
      end: Math.max(0, Math.min(text.length, finding.end)),
      kind: finding.kind,
    }))
    .filter((finding) => finding.start < finding.end)
    .sort(
      (left, right) =>
        left.start - right.start ||
        right.end - left.end ||
        privacyLabels[left.kind].localeCompare(privacyLabels[right.kind]),
    );
  const merged: MergedFinding[] = [];
  for (const finding of sorted) {
    const previous = merged.at(-1);
    if (!previous || finding.start >= previous.end) {
      merged.push({
        start: finding.start,
        end: finding.end,
        kinds: [finding.kind],
      });
      continue;
    }
    previous.end = Math.max(previous.end, finding.end);
    if (!previous.kinds.includes(finding.kind)) {
      previous.kinds.push(finding.kind);
    }
  }
  return merged;
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', flexWrap: 'wrap' },
  plain: { color: familyTokens.color.ink, fontSize: 15, lineHeight: 22 },
  warning: {
    backgroundColor: '#FFF0C2',
    color: familyTokens.color.danger,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 22,
  },
});
