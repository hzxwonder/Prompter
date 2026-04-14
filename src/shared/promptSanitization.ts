const SYSTEM_MESSAGE_PATTERNS = [
  '[Request interrupted by user',
  'Base directory for this skill',
  'Continue from where you left off',
  '<SUBAGENT-STOP>',
  '<EXTREMELY-IMPORTANT>'
];

const SKILL_DOC_MARKERS = [
  '## Overview',
  '## The Iron Law',
  '## The Process',
  '## Integration',
  '## Red Flags',
  '## When to Use',
  'superpowers:',
  'Required workflow skills',
  'Alternative workflow'
] as const;

function stripSystemPatternFromLine(line: string): string {
  for (const pattern of SYSTEM_MESSAGE_PATTERNS) {
    if (line.includes(pattern)) {
      return '';
    }
  }
  return line.trim();
}

export function sanitizeImportedPromptContent(content: string): string {
  return content
    .split(/\r?\n/)
    .map(stripSystemPatternFromLine)
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizePromptForMatching(content: string): string {
  return sanitizeImportedPromptContent(content)
    .replace(/\r\n/g, '\n')
    .trim();
}

export function isInjectedSkillDocument(content: string): boolean {
  const trimmed = sanitizeImportedPromptContent(content);
  if (!trimmed.startsWith('# ')) {
    return false;
  }

  let score = 0;
  for (const marker of SKILL_DOC_MARKERS) {
    if (trimmed.includes(marker)) {
      score += marker === 'superpowers:' ? 2 : 1;
    }
  }

  return score >= 3;
}

export function isSystemMessageCard(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  return SYSTEM_MESSAGE_PATTERNS.some(
    (pattern) => trimmed.startsWith(pattern) && trimmed.length < pattern.length + 50
  );
}

export function shouldDiscardImportedPromptContent(content: string): boolean {
  const sanitized = sanitizeImportedPromptContent(content);
  return !sanitized || isSystemMessageCard(content) || isInjectedSkillDocument(sanitized);
}
