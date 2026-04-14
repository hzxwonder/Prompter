const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PROMPTER_DIR = path.join(os.homedir(), 'prompter');
const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');

function normalizeTimestamp(ts) {
  if (!ts) return '';
  const raw = String(ts).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    const date = new Date(raw.length >= 13 ? numeric : numeric * 1000);
    return Number.isNaN(date.getTime()) ? raw : date.toISOString();
  }
  return raw.endsWith('Z') ? raw : `${raw}Z`;
}

function timestampsRoughlyMatch(left, right) {
  const leftMs = new Date(normalizeTimestamp(left)).getTime();
  const rightMs = new Date(normalizeTimestamp(right)).getTime();
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return normalizeTimestamp(left) === normalizeTimestamp(right);
  }
  return Math.abs(leftMs - rightMs) <= 2000;
}

function extractUserText(text) {
  const markers = ['## My request for Codex:', '## My request for Codex'];
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx !== -1) {
      return text.slice(idx + marker.length).trim().replace(/^:?\s*/, '');
    }
  }
  return text.trim();
}

function scanDir(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }
  return files;
}

function readSessionMeta(lines, sessionId) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const payload = event.payload || {};
    if (event.type !== 'session_meta' || typeof payload.id !== 'string') {
      continue;
    }
    if (!sessionId.endsWith(payload.id)) {
      continue;
    }
    return {
      ownId: payload.id,
      forkedFromId: typeof payload.forked_from_id === 'string' ? payload.forked_from_id : null
    };
  }
  return { ownId: null, forkedFromId: null };
}

function extractTurnId(sourceRef, sessionId) {
  const prefix = `${sessionId}:`;
  if (!String(sourceRef || '').startsWith(prefix)) {
    return null;
  }
  return String(sourceRef).slice(prefix.length) || null;
}

function parseCodexRecords(lines, sessionId, ignoredTurnIds = new Set()) {
  const prompts = [];
  const turnStartById = new Map();
  const completedAtByTurnId = new Map();
  let activeTurnId = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const payload = event.payload || {};
    if (event.type === 'event_msg' && payload.type === 'task_started' && payload.turn_id) {
      const turnId = String(payload.turn_id);
      if (ignoredTurnIds.has(turnId)) {
        activeTurnId = null;
        continue;
      }
      activeTurnId = turnId;
      turnStartById.set(activeTurnId, normalizeTimestamp(event.timestamp));
      continue;
    }
    if (event.type === 'event_msg' && payload.type === 'task_complete' && payload.turn_id) {
      const turnId = String(payload.turn_id);
      if (ignoredTurnIds.has(turnId)) {
        continue;
      }
      completedAtByTurnId.set(turnId, normalizeTimestamp(event.timestamp));
      continue;
    }
    if (event.type === 'event_msg' && payload.type === 'user_message' && activeTurnId) {
      const userInput = extractUserText(payload.message || '');
      if (!userInput) continue;
      prompts.push({
        sessionId,
        sourceRef: `${sessionId}:${activeTurnId}`,
        userInput,
        createdAt: turnStartById.get(activeTurnId) || normalizeTimestamp(event.timestamp),
        completedAt: completedAtByTurnId.get(activeTurnId)
      });
      continue;
    }
    if (event.type === 'item.completed') {
      const item = event.item || {};
      if (item.type === 'message' && item.role === 'user') {
        const texts = Array.isArray(item.content)
          ? item.content.filter((c) => c && c.type === 'input_text').map((c) => c.text || '')
          : [];
        const userInput = extractUserText(texts.join('\n'));
        if (!userInput) continue;
        const turnId = item.turn_id || item.id || activeTurnId || `message-${prompts.length + 1}`;
        if (ignoredTurnIds.has(turnId)) continue;
        prompts.push({
          sessionId,
          sourceRef: `${sessionId}:${turnId}`,
          userInput,
          createdAt: normalizeTimestamp(event.timestamp) || turnStartById.get(turnId),
          completedAt: completedAtByTurnId.get(turnId)
        });
      }
    }
  }

  return prompts.map((prompt) => {
    const turnId = prompt.sourceRef.slice(sessionId.length + 1);
    return { ...prompt, completedAt: completedAtByTurnId.get(turnId) || prompt.completedAt };
  });
}

function parseCodexFile(filePath, sessionFileById, visitedSessionIds = new Set()) {
  const sessionId = path.basename(filePath, '.jsonl');
  if (visitedSessionIds.has(sessionId)) {
    return [];
  }
  visitedSessionIds.add(sessionId);

  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const { ownId, forkedFromId } = readSessionMeta(lines, sessionId);
  if (ownId) {
    sessionFileById.set(ownId, filePath);
  }

  const ignoredTurnIds = new Set();
  if (forkedFromId) {
    const parentPath = sessionFileById.get(forkedFromId);
    if (parentPath && parentPath !== filePath) {
      const parentPrompts = parseCodexFile(parentPath, sessionFileById, visitedSessionIds);
      for (const prompt of parentPrompts) {
        const turnId = extractTurnId(prompt.sourceRef, prompt.sessionId);
        if (turnId) {
          ignoredTurnIds.add(turnId);
        }
      }
    }
  }

  return parseCodexRecords(lines, sessionId, ignoredTurnIds);
}

function buildPromptIndex(prompts) {
  const bySession = new Map();
  const latestIncompleteBySession = new Map();
  for (const prompt of prompts) {
    const bucket = bySession.get(prompt.sessionId) || [];
    bucket.push(prompt);
    bySession.set(prompt.sessionId, bucket);
    if (!prompt.completedAt) {
      const prev = latestIncompleteBySession.get(prompt.sessionId);
      if (!prev || prev.createdAt <= prompt.createdAt) {
        latestIncompleteBySession.set(prompt.sessionId, prompt);
      }
    }
  }
  return { bySession, latestIncompleteBySession };
}

function rebuildDailyStats(cards) {
  const byDate = new Map();
  for (const card of cards) {
    const date = String(card.createdAt).slice(0, 10);
    if (!byDate.has(date)) {
      byDate.set(date, { date, usedCount: 0, unusedCount: 0, completedCount: 0, totalCount: 0 });
    }
    const entry = byDate.get(date);
    entry.totalCount += 1;
    if (card.status === 'unused') entry.unusedCount += 1;
    if (card.status === 'active' || card.status === 'completed') entry.usedCount += 1;
    if (card.status === 'completed') entry.completedCount += 1;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function main() {
  const logStatePath = path.join(PROMPTER_DIR, 'logs-state.json');
  const cardsPath = path.join(PROMPTER_DIR, 'cards.json');
  const dailyStatsPath = path.join(PROMPTER_DIR, 'daily-stats.json');
  const logState = JSON.parse(fs.readFileSync(logStatePath, 'utf8'));
  const cards = JSON.parse(fs.readFileSync(cardsPath, 'utf8'));
  const codexFiles = scanDir(CODEX_SESSIONS_DIR);
  const sessionFileById = new Map();
  for (const filePath of codexFiles) {
    const sessionId = path.basename(filePath, '.jsonl');
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const { ownId } = readSessionMeta(lines, sessionId);
    if (ownId) {
      sessionFileById.set(ownId, filePath);
    }
  }
  const scannedPrompts = codexFiles.flatMap((filePath) => parseCodexFile(filePath, sessionFileById, new Set()));
  const { bySession, latestIncompleteBySession } = buildPromptIndex(scannedPrompts);
  const findMatch = (sessionId, userInput, createdAt) => {
    const candidates = bySession.get(sessionId) || [];
    return candidates.find((prompt) =>
      prompt.userInput === userInput && timestampsRoughlyMatch(prompt.createdAt, createdAt)
    );
  };

  let migratedLogPrompts = 0;
  let prunedLogPrompts = 0;
  const migratedPrompts = logState.prompts.flatMap((row) => {
    if (row.source !== 'codex') return row;
    const match = findMatch(row.sessionId, row.userInput, row.createdAt);
    if (!match) {
      prunedLogPrompts += 1;
      return [];
    }
    if (row.sourceRef !== match.sourceRef || row.completedAt !== match.completedAt) {
      migratedLogPrompts += 1;
    }
    const isRunning = latestIncompleteBySession.get(match.sessionId)?.sourceRef === match.sourceRef;
    return {
      ...row,
      sourceRef: match.sourceRef,
      project: match.sessionId,
      createdAt: match.createdAt,
      completedAt: match.completedAt,
      status: isRunning ? 'running' : 'completed',
      justCompleted: false
    };
  });
  const promptSeen = new Set();
  logState.prompts = migratedPrompts.filter((row) => {
    const key = `${row.source}|${row.sourceRef}|${row.userInput}|${normalizeTimestamp(row.createdAt)}`;
    if (promptSeen.has(key)) return false;
    promptSeen.add(key);
    return true;
  });

  let migratedCards = 0;
  let prunedCards = 0;
  const nextCards = cards.flatMap((card) => {
    if (card.sourceType !== 'codex') return card;
    const sessionId = card.groupName || card.sourceRef;
    const match = findMatch(sessionId, card.content, card.createdAt);
    if (!match) {
      prunedCards += 1;
      return [];
    }
    migratedCards += 1;
    const isRunning = latestIncompleteBySession.get(match.sessionId)?.sourceRef === match.sourceRef;
    return {
      ...card,
      sourceRef: match.sourceRef,
      groupId: `codex:${match.sessionId}`,
      groupName: match.sessionId,
      createdAt: match.createdAt,
      status: isRunning ? 'active' : 'completed',
      runtimeState: isRunning ? 'running' : 'finished',
      completedAt: isRunning ? undefined : (match.completedAt || card.completedAt),
      justCompleted: false
    };
  });
  const cardSeen = new Set();
  const dedupedCards = nextCards
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .filter((card) => {
      const key = `${card.sourceType}|${card.sourceRef}|${card.content}|${normalizeTimestamp(card.createdAt)}`;
      if (cardSeen.has(key)) return false;
      cardSeen.add(key);
      return true;
    });

  const backupSuffix = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(logStatePath, `${logStatePath}.${backupSuffix}.bak`);
  fs.copyFileSync(cardsPath, `${cardsPath}.${backupSuffix}.bak`);
  if (fs.existsSync(dailyStatsPath)) {
    fs.copyFileSync(dailyStatsPath, `${dailyStatsPath}.${backupSuffix}.bak`);
  }

  fs.writeFileSync(logStatePath, JSON.stringify(logState, null, 2));
  fs.writeFileSync(cardsPath, JSON.stringify(dedupedCards, null, 2));
  fs.writeFileSync(dailyStatsPath, JSON.stringify(rebuildDailyStats(dedupedCards), null, 2));

  console.log(JSON.stringify({
    migratedLogPrompts,
    prunedLogPrompts,
    migratedCards,
    prunedCards,
    codexCards: dedupedCards.filter((card) => card.sourceType === 'codex').length,
    codexActive: dedupedCards.filter((card) => card.sourceType === 'codex' && card.status === 'active').length,
    codexCompleted: dedupedCards.filter((card) => card.sourceType === 'codex' && card.status === 'completed').length
  }, null, 2));
}

main();
