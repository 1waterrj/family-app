import { isIP } from 'node:net';

import { decodeHTMLStrict } from 'entities';
import { parseFragment } from 'parse5';
import {
  FeedbackAppVersionSchema,
  FeedbackDiagnosticEventSchema,
  FeedbackPublicPreviewRequestSchema,
  FeedbackPublicPreviewSchema,
  FeedbackRepositoryUrlSchema,
  type FeedbackCategory,
  type FeedbackPrivacyFinding,
  type FeedbackPrivacyFindingKind,
  type FeedbackPublicPreview,
  type FeedbackPublicPreviewRequest,
  type FeedbackSource,
} from '@family/contracts';

const MAX_PUBLIC_TITLE_LENGTH = 160;
const MAX_PUBLIC_BODY_LENGTH = 6_000;
const MAX_PUBLIC_DIAGNOSTIC_EVENTS = 40;

const privacyKindOrder = [
  'KNOWN_PRIVATE_TERM',
  'EMAIL',
  'IP_ADDRESS',
  'HOSTNAME',
  'UUID',
  'CREDENTIAL',
  'LINK',
] as const satisfies readonly FeedbackPrivacyFindingKind[];

const replacementByKind = {
  KNOWN_PRIVATE_TERM: '<family-member>',
  EMAIL: '<email>',
  IP_ADDRESS: '<local-server>',
  HOSTNAME: '<local-server>',
  UUID: '<identifier>',
  CREDENTIAL: '<credential>',
  LINK: '<link>',
} as const satisfies Record<FeedbackPrivacyFindingKind, string>;

const sourceLabels = {
  PARENT_IOS: ['feedback', 'app:parent', 'platform:ios'],
  PARENT_ANDROID: ['feedback', 'app:parent', 'platform:android'],
  DASHBOARD: ['feedback', 'app:dashboard', 'platform:raspberry-pi'],
} as const satisfies Record<FeedbackSource, readonly string[]>;

const categoryLabels = {
  BROKEN: 'type:bug',
  CONFUSING: 'type:confusing',
  IDEA: 'type:idea',
} as const satisfies Record<FeedbackCategory, string>;

const emailPattern =
  /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/giu;
const ipv4Pattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;
const ipv6CandidatePattern =
  /(?<![0-9A-Fa-f:])[0-9A-Fa-f:]*:[0-9A-Fa-f:]+(?:%[A-Za-z0-9_.-]+)?(?![0-9A-Fa-f:])/gu;
const hostnamePattern =
  /\b(?:localhost|(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)\.)+(?:[A-Z]{2,63}|local|lan|home|internal|test))\b/giu;
const singleLabelLanHostnamePattern =
  /\b(?:raspberrypi|homeassistant|openhab|pihole|[A-Z0-9]+-(?:server|host|router|gateway|nas|pi)(?:-[A-Z0-9]+)*|(?:server|host|router|gateway|nas|pi)-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/giu;
const contextualSingleLabelHostnamePatterns = [
  /\bconnect(?:ed|ing)?\s+to\s+([A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)\s+via\s+([A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)\b/giu,
  /\b(?:ssh|sftp|telnet|traceroute|nslookup)\s+(?:[A-Z0-9._-]+@)?([A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)\b/giu,
  /(?:^|[;\n]\s*)(?:ping|dig)\s+([A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)\b/giu,
  /\b(?:host|hostname)\s*=\s*([A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)\b/giu,
  /\b(?:try|connect(?:ed|ing)?(?:\s+to)?|endpoint(?:\s+is|\s*[:=])?)\s+([A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)(?=:\d{1,5}(?:[/\s,.;!?)]|$))/giu,
  /\b([A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9]))(?=:[/\\])/giu,
  /\b(?:ssh|sftp|telnet):\/\/([A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)\b/giu,
] as const;
const uuidPattern =
  /\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\b/giu;
const markdownLinkPattern = /\[[^\]\r\n]{0,500}\]\([^\r\n)]{1,2048}\)/giu;
const angleLinkPattern = /<(?:https?:\/\/|www\.)[^<>\s]+>/giu;
const rawLinkPattern = /(?:https?:\/\/|www\.)[^\s<>{}\\^`|"]+/giu;
const githubFineGrainedTokenPattern = new RegExp(
  `\\b${['github', '_pat_'].join('')}[A-Z0-9_]{20,}\\b`,
  'giu',
);
const credentialPatterns = [
  /\bBearer\s+[A-Z0-9._~+/=-]+/giu,
  /\bBasic\s+[A-Z0-9+/]+={0,2}(?=$|[\s"',;.!?)\]])/giu,
  githubFineGrainedTokenPattern,
  /\bgh[pousr]_[A-Z0-9]{20,}\b/giu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\beyJ[A-Z0-9_-]+\.[A-Z0-9_-]+\.[A-Z0-9_-]+\b/giu,
  /\b(?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]\s*["']?[^\s"',;]{4,}["']?/giu,
] as const;

export interface PrivacyTextFinding {
  kind: FeedbackPrivacyFindingKind;
  start: number;
  end: number;
}

interface PublicPreviewReport {
  appVersion: string;
  category: FeedbackCategory;
  source: FeedbackSource;
  diagnosticSnapshot: { events: readonly unknown[] };
}

interface MappedText {
  text: string;
  starts: number[];
  ends: number[];
}

interface HtmlSourceRange {
  startOffset: number;
  endOffset: number;
}

const graphemeSegmenter = new Intl.Segmenter('und', {
  granularity: 'grapheme',
});

export interface BuildPublicFeedbackPreviewInput {
  report: PublicPreviewReport;
  input: FeedbackPublicPreviewRequest;
  knownTerms: readonly string[];
  repository: string;
}

export function findPrivacyFindings(
  text: string,
  knownTerms: readonly string[],
): PrivacyTextFinding[] {
  const canonical = canonicalizeForScan(text);
  const candidates: PrivacyTextFinding[] = [];

  for (const term of normalizedKnownTerms(knownTerms)) {
    addKnownTermCandidates(candidates, canonical.text, term);
  }
  addPatternCandidates(candidates, canonical.text, markdownLinkPattern, 'LINK');
  addPatternCandidates(candidates, canonical.text, angleLinkPattern, 'LINK');
  addPatternCandidates(candidates, canonical.text, rawLinkPattern, 'LINK');
  for (const pattern of credentialPatterns) {
    addPatternCandidates(candidates, canonical.text, pattern, 'CREDENTIAL');
  }
  addPatternCandidates(candidates, canonical.text, emailPattern, 'EMAIL');
  addValidatedCandidates(
    candidates,
    canonical.text,
    ipv4Pattern,
    'IP_ADDRESS',
    (value) => isIP(value) === 4,
  );
  addValidatedCandidates(
    candidates,
    canonical.text,
    ipv6CandidatePattern,
    'IP_ADDRESS',
    (value) => isIP(value.replace(/%.*$/u, '')) === 6,
  );
  addPatternCandidates(candidates, canonical.text, hostnamePattern, 'HOSTNAME');
  addPatternCandidates(
    candidates,
    canonical.text,
    singleLabelLanHostnamePattern,
    'HOSTNAME',
  );
  for (const pattern of contextualSingleLabelHostnamePatterns) {
    addCapturedHostnameCandidates(candidates, canonical.text, pattern);
  }
  addPatternCandidates(candidates, canonical.text, uuidPattern, 'UUID');

  const mappedCandidates = candidates.map((candidate) =>
    mapFindingToOriginal(candidate, canonical),
  );

  mappedCandidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - left.end ||
      privacyKindOrder.indexOf(left.kind) -
        privacyKindOrder.indexOf(right.kind),
  );

  const findings: PrivacyTextFinding[] = [];
  for (const candidate of mappedCandidates) {
    const previous = findings.at(-1);
    if (!previous || candidate.start >= previous.end) {
      findings.push(candidate);
    } else if (candidate.end > previous.end) {
      previous.end = candidate.end;
    }
  }
  return findings;
}

export function findingsForFeedbackField(
  field: FeedbackPrivacyFinding['field'],
  text: string,
  knownTerms: readonly string[],
): FeedbackPrivacyFinding[] {
  return findPrivacyFindings(text, knownTerms).map((finding) => ({
    field,
    ...finding,
  }));
}

export function buildPublicFeedbackPreview(
  raw: BuildPublicFeedbackPreviewInput,
): FeedbackPublicPreview {
  const input = FeedbackPublicPreviewRequestSchema.parse(raw.input);
  const repositoryUrl = FeedbackRepositoryUrlSchema.parse(raw.repository);
  const appVersion = FeedbackAppVersionSchema.parse(raw.report.appVersion);
  const appVersionResult = sanitizeText(appVersion, raw.knownTerms);
  const titleResult = sanitizeText(input.publicTitle, raw.knownTerms);
  const descriptionResult = sanitizeText(
    input.publicDescription,
    raw.knownTerms,
  );
  const title = normalizeTitle(titleResult.text).slice(
    0,
    MAX_PUBLIC_TITLE_LENGTH,
  );
  const publicDescription = normalizeBodyText(descriptionResult.text);
  const redactionKinds = new Set<FeedbackPrivacyFindingKind>([
    ...titleResult.kinds,
    ...descriptionResult.kinds,
    ...appVersionResult.kinds,
  ]);
  const sections = [
    `## Description\n\n${publicDescription || '_No public description provided._'}`,
    `## App metadata\n\n- App version: ${appVersionResult.text}`,
  ];

  if (input.includeDiagnostics) {
    const diagnostics = buildDiagnosticTimeline(
      raw.report.diagnosticSnapshot.events,
    );
    if (diagnostics) {
      sections.push(`## Diagnostics\n\n${diagnostics.body}`);
      for (const kind of diagnostics.redactions) redactionKinds.add(kind);
    }
  }

  const body = sections.join('\n\n').slice(0, MAX_PUBLIC_BODY_LENGTH).trim();
  const redactions = privacyKindOrder.filter((kind) =>
    redactionKinds.has(kind),
  );

  return FeedbackPublicPreviewSchema.parse({
    repositoryUrl,
    title: title || '<redacted>',
    body,
    labels: [
      ...sourceLabels[raw.report.source],
      categoryLabels[raw.report.category],
    ],
    redactions,
  });
}

function sanitizeText(
  text: string,
  knownTerms: readonly string[],
): { text: string; kinds: Set<FeedbackPrivacyFindingKind> } {
  const canonical = canonicalizeForPublicOutput(text);
  const findings = findPrivacyFindings(canonical, knownTerms);
  const kinds = new Set(findings.map(({ kind }) => kind));
  let sanitized = canonical;
  for (const finding of [...findings].sort(
    (left, right) => right.start - left.start,
  )) {
    sanitized = `${sanitized.slice(0, finding.start)}${replacementByKind[finding.kind]}${sanitized.slice(finding.end)}`;
  }
  sanitized = neutralizeUnsafeMarkdown(sanitized);
  const residualFindings = findPrivacyFindings(sanitized, knownTerms);
  for (const finding of [...residualFindings].sort(
    (left, right) => right.start - left.start,
  )) {
    sanitized = `${sanitized.slice(0, finding.start)}${replacementByKind[finding.kind]}${sanitized.slice(finding.end)}`;
    kinds.add(finding.kind);
  }
  return {
    text: sanitized,
    kinds,
  };
}

function buildDiagnosticTimeline(events: readonly unknown[]):
  | {
      body: string;
      redactions: Set<FeedbackPrivacyFindingKind>;
    }
  | undefined {
  const parsed = FeedbackDiagnosticEventSchema.array().safeParse(events);
  if (!parsed.success) return undefined;

  const requestAliases = new Map<string, string>();
  const redactions = new Set<FeedbackPrivacyFindingKind>();
  const lines = parsed.data
    .slice(-MAX_PUBLIC_DIAGNOSTIC_EVENTS)
    .map((event) => {
      if (event.kind === 'SCREEN') {
        return `- ${event.at} · screen ${event.screen}`;
      }
      if (event.kind === 'NETWORK') {
        return `- ${event.at} · network ${event.state}`;
      }

      let request = '';
      if (event.requestId) {
        let alias = requestAliases.get(event.requestId);
        if (!alias) {
          alias = `<request-${requestAliases.size + 1}>`;
          requestAliases.set(event.requestId, alias);
        }
        redactions.add('UUID');
        request = ` · request ${alias}`;
      }
      return `- ${event.at} · API ${event.operation} · ${event.outcome} · status ${event.status ?? 'none'} · error ${event.errorCode ?? 'none'} · duration ${event.durationBucket}${request}`;
    });
  if (lines.length === 0) return undefined;
  return { body: lines.join('\n'), redactions };
}

function normalizedKnownTerms(knownTerms: readonly string[]): string[] {
  return [
    ...new Set(
      knownTerms
        .map((term) => canonicalizeForScan(term).text.trim())
        .filter(Boolean),
    ),
  ].sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  );
}

function addKnownTermCandidates(
  candidates: PrivacyTextFinding[],
  text: string,
  term: string,
): void {
  const pattern = new RegExp(escapeRegExp(term), 'giu');
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (
      (isWordCharacter(term[0]) && isWordCharacter(text[start - 1])) ||
      (isWordCharacter(term.at(-1)) && isWordCharacter(text[end]))
    ) {
      continue;
    }
    candidates.push({ kind: 'KNOWN_PRIVATE_TERM', start, end });
  }
}

function addPatternCandidates(
  candidates: PrivacyTextFinding[],
  text: string,
  pattern: RegExp,
  kind: FeedbackPrivacyFindingKind,
): void {
  addValidatedCandidates(candidates, text, pattern, kind, () => true);
}

function addValidatedCandidates(
  candidates: PrivacyTextFinding[],
  text: string,
  pattern: RegExp,
  kind: FeedbackPrivacyFindingKind,
  validate: (value: string) => boolean,
): void {
  for (const match of text.matchAll(pattern)) {
    if (validate(match[0])) {
      candidates.push({
        kind,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
}

function addCapturedHostnameCandidates(
  candidates: PrivacyTextFinding[],
  text: string,
  pattern: RegExp,
): void {
  for (const match of text.matchAll(pattern)) {
    let relativeStart = 0;
    for (const hostname of match.slice(1)) {
      if (!hostname || !/[A-Z]/iu.test(hostname)) continue;
      relativeStart = match[0].indexOf(hostname, relativeStart);
      if (relativeStart === -1) continue;
      const start = match.index + relativeStart;
      candidates.push({
        kind: 'HOSTNAME',
        start,
        end: start + hostname.length,
      });
      relativeStart += hostname.length;
    }
  }
}

function normalizeTitle(text: string): string {
  return normalizeBodyText(text).replace(/\s+/gu, ' ').trim();
}

function normalizeBodyText(text: string): string {
  return Array.from(text.replace(/\r\n?/gu, '\n'))
    .map((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 9 ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127
        ? ' '
        : character;
    })
    .join('')
    .trim();
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function canonicalizeForScan(text: string): MappedText {
  return canonicalizeMappedText(text, false);
}

function canonicalizeForPublicOutput(text: string): string {
  return canonicalizeMappedText(text, true).text;
}

function canonicalizeMappedText(
  text: string,
  preserveEmojiFormatting: boolean,
): MappedText {
  let mapped = mappedFromOriginal(text);
  for (let pass = 0; pass < 4; pass += 1) {
    const previous = mapped.text;
    mapped = normalizeCompatibility(mapped);
    mapped = decodeHtmlEntities(mapped);
    mapped = removeInvisibleControls(mapped, preserveEmojiFormatting);
    mapped = removeRawHtml(mapped);
    if (mapped.text === previous) break;
  }
  return removeInvisibleControls(mapped, preserveEmojiFormatting);
}

function removeRawHtml(mapped: MappedText): MappedText {
  const fragment = parseFragment(mapped.text, {
    sourceCodeLocationInfo: true,
  });
  const ranges = fragment.childNodes
    .filter((node) => node.nodeName !== '#text' && node.sourceCodeLocation)
    .map(({ sourceCodeLocation }) => ({
      startOffset: sourceCodeLocation!.startOffset,
      endOffset: sourceCodeLocation!.endOffset,
    }));
  const withoutStructuredHtml = removeMappedRanges(mapped, ranges);

  // parse5 intentionally treats a few context-invalid tags as text. Apply the
  // same fail-closed rule to any residual opening tag so raw HTML can never
  // publish its inner text merely because the fragment context ignored it.
  const visible = emptyMappedText();
  let cursor = 0;
  while (cursor < withoutStructuredHtml.text.length) {
    if (withoutStructuredHtml.text.startsWith('<!--', cursor)) {
      const close = withoutStructuredHtml.text.indexOf('-->', cursor + 4);
      cursor = close === -1 ? withoutStructuredHtml.text.length : close + 3;
      continue;
    }
    if (withoutStructuredHtml.text[cursor] === '<') {
      const opening = withoutStructuredHtml.text
        .slice(cursor)
        .match(/^<([A-Za-z][A-Za-z0-9:-]*)\b/iu);
      const tagEnd = opening
        ? htmlTagEnd(withoutStructuredHtml.text, cursor)
        : undefined;
      if (opening && tagEnd !== undefined) {
        const tagName = opening[1]!.toLowerCase();
        cursor = htmlElementEnd(
          withoutStructuredHtml.text,
          cursor,
          tagEnd,
          tagName,
        );
        continue;
      }
      const closingEnd = htmlTagEnd(withoutStructuredHtml.text, cursor);
      if (closingEnd !== undefined) {
        cursor = closingEnd;
        continue;
      }
    }
    appendMappedSlice(visible, withoutStructuredHtml, cursor, cursor + 1);
    cursor += 1;
  }
  return visible;
}

function removeMappedRanges(
  mapped: MappedText,
  rawRanges: readonly HtmlSourceRange[],
): MappedText {
  const ranges = [...rawRanges].sort(
    (left, right) =>
      left.startOffset - right.startOffset || right.endOffset - left.endOffset,
  );
  const visible = emptyMappedText();
  let cursor = 0;
  for (const range of ranges) {
    if (range.endOffset <= cursor) continue;
    appendMappedSlice(visible, mapped, cursor, range.startOffset);
    cursor = range.endOffset;
  }
  appendMappedSlice(visible, mapped, cursor, mapped.text.length);
  return visible;
}

function htmlElementEnd(
  text: string,
  openingStart: number,
  openingEnd: number,
  tagName: string,
): number {
  const openingTag = text.slice(openingStart, openingEnd);
  if (/\/\s*>$/u.test(openingTag)) return openingEnd;

  let depth = 1;
  const tagPattern = /<\/?([A-Za-z][A-Za-z0-9:-]*)\b/giu;
  tagPattern.lastIndex = openingEnd;
  for (const match of text.matchAll(tagPattern)) {
    if (match[1]!.toLowerCase() !== tagName) continue;
    const end = htmlTagEnd(text, match.index);
    if (end === undefined) continue;
    if (text[match.index + 1] === '/') {
      depth -= 1;
      if (depth === 0) return end;
    } else if (!/\/\s*>$/u.test(text.slice(match.index, end))) {
      depth += 1;
    }
  }
  return text.length;
}

function mappedFromOriginal(text: string): MappedText {
  const mapped = emptyMappedText();
  for (let start = 0; start < text.length;) {
    const codePoint = text.codePointAt(start)!;
    const character = String.fromCodePoint(codePoint);
    const end = start + character.length;
    appendMapped(mapped, character, start, end);
    start = end;
  }
  return mapped;
}

function normalizeCompatibility(mapped: MappedText): MappedText {
  const normalized = emptyMappedText();
  for (const segment of graphemeSegmenter.segment(mapped.text)) {
    const start = segment.index;
    const end = start + segment.segment.length;
    appendMapped(
      normalized,
      segment.segment.normalize('NFKC'),
      mapped.starts[start]!,
      mapped.ends[end - 1]!,
    );
  }
  return normalized;
}

function decodeHtmlEntities(mapped: MappedText): MappedText {
  const decoded = emptyMappedText();
  const pattern =
    /&(?:#[xX][0-9A-Fa-f]{1,8}|#[0-9]{1,8}|[A-Za-z][A-Za-z0-9]{1,31});/gu;
  let cursor = 0;
  for (const match of mapped.text.matchAll(pattern)) {
    appendMappedSlice(decoded, mapped, cursor, match.index);
    const value = decodeHTMLStrict(match[0]);
    if (value === match[0]) {
      appendMappedSlice(
        decoded,
        mapped,
        match.index,
        match.index + match[0].length,
      );
    } else {
      appendMapped(
        decoded,
        value,
        mapped.starts[match.index]!,
        mapped.ends[match.index + match[0].length - 1]!,
      );
    }
    cursor = match.index + match[0].length;
  }
  appendMappedSlice(decoded, mapped, cursor, mapped.text.length);
  return decoded;
}

function htmlTagEnd(text: string, start: number): number | undefined {
  const opening = text.slice(start).match(/^<\/?[A-Za-z][A-Za-z0-9:-]*/u)?.[0];
  const declaration = text.slice(start).match(/^<![A-Za-z]/u)?.[0];
  const processing = text.startsWith('<?', start);
  if (!opening && !declaration && !processing) return undefined;
  if (opening) {
    const next = text[start + opening.length];
    if (next !== undefined && !/[\s/>]/u.test(next)) return undefined;
  }

  let quote: '"' | "'" | undefined;
  for (let index = start + 2; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return text.length;
}

function removeInvisibleControls(
  mapped: MappedText,
  preserveEmojiFormatting: boolean,
): MappedText {
  const visible = emptyMappedText();
  for (let index = 0; index < mapped.text.length;) {
    const codePoint = mapped.text.codePointAt(index)!;
    const character = String.fromCodePoint(codePoint);
    const end = index + character.length;
    if (/\p{Default_Ignorable_Code_Point}/u.test(character)) {
      if (
        preserveEmojiFormatting &&
        isPreservedEmojiFormatting(mapped.text, index, character)
      ) {
        appendMappedSlice(visible, mapped, index, end);
      }
      index = end;
      continue;
    }
    if (/\p{Cc}/u.test(character)) {
      appendMapped(
        visible,
        character === '\n' || character === '\t' ? character : ' ',
        mapped.starts[index]!,
        mapped.ends[end - 1]!,
      );
      index = end;
      continue;
    }
    appendMappedSlice(visible, mapped, index, end);
    index = end;
  }
  return visible;
}

function isPreservedEmojiFormatting(
  text: string,
  index: number,
  character: string,
): boolean {
  if (character === '\uFE0E' || character === '\uFE0F') {
    return /\p{Extended_Pictographic}/u.test(previousCodePoint(text, index));
  }
  if (character !== '\u200D') return false;
  return (
    /\p{Extended_Pictographic}/u.test(previousCodePoint(text, index)) &&
    /\p{Extended_Pictographic}/u.test(nextCodePoint(text, index + 1))
  );
}

function previousCodePoint(text: string, index: number): string {
  const points = Array.from(text.slice(0, index));
  while (points.at(-1) === '\uFE0E' || points.at(-1) === '\uFE0F') points.pop();
  return points.at(-1) ?? '';
}

function nextCodePoint(text: string, index: number): string {
  const points = Array.from(text.slice(index));
  while (points[0] === '\uFE0E' || points[0] === '\uFE0F') points.shift();
  return points[0] ?? '';
}

function mapFindingToOriginal(
  finding: PrivacyTextFinding,
  mapped: MappedText,
): PrivacyTextFinding {
  return {
    kind: finding.kind,
    start: mapped.starts[finding.start]!,
    end: mapped.ends[finding.end - 1]!,
  };
}

function neutralizeUnsafeMarkdown(text: string): string {
  const replacements = Object.values(replacementByKind);
  const tokens = replacements.map((_, index) => `\uE000${index}\uE001`);
  let neutral = text;
  replacements.forEach((replacement, index) => {
    neutral = neutral.replaceAll(replacement, tokens[index]!);
  });
  neutral = neutral
    .replace(/([\\`*_[\]{}<>])/gu, '\\$1')
    .replace(/^(\s*)([#>+]|-(?=\s)|\d+[.)](?=\s))/gmu, '$1\\$2');
  tokens.forEach((token, index) => {
    neutral = neutral.replaceAll(token, replacements[index]!);
  });
  return neutral;
}

function emptyMappedText(): MappedText {
  return { text: '', starts: [], ends: [] };
}

function appendMapped(
  target: MappedText,
  value: string,
  start: number,
  end: number,
): void {
  target.text += value;
  for (let index = 0; index < value.length; index += 1) {
    target.starts.push(start);
    target.ends.push(end);
  }
}

function appendMappedSlice(
  target: MappedText,
  source: MappedText,
  start: number,
  end: number,
): void {
  target.text += source.text.slice(start, end);
  target.starts.push(...source.starts.slice(start, end));
  target.ends.push(...source.ends.slice(start, end));
}
