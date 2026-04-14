#!/usr/bin/env python3
"""
Prompter Logs Parser - 最简版本
提取 Claude Code 和 Codex 日志中的用户输入，存入 SQLite
"""

import json
import os
import sqlite3
from pathlib import Path
from datetime import datetime
import re

# 配置
CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"
CODEX_SESSIONS_DIR = Path.home() / ".codex" / "sessions"
DB_PATH = Path.home() / "prompter" / "logs.db"


def init_db():
    """初始化数据库"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS prompts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,  -- 'claude_code' 或 'codex'
            session_id TEXT,
            project TEXT,          -- 项目路径（Claude Code）
            user_input TEXT NOT NULL,
            created_at TIMESTAMP,
            status TEXT DEFAULT 'running',  -- 'running', 'completed'
            just_completed INTEGER DEFAULT 0,  -- 是否刚完成（1=是，0=否）
            raw_file TEXT          -- 原始日志文件路径
        )
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_source ON prompts(source)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_created_at ON prompts(created_at)
    """)

    conn.commit()
    conn.close()
    print(f"数据库初始化完成: {DB_PATH}")


# 过滤掉的系统消息特征
SKIP_PATTERNS = [
    "[Request interrupted by user",  # 匹配所有变体：[..by user] 和 [..by user for tool use] 等
    "Base directory for this skill",
    "Continue from where you left off",
    "<SUBAGENT-STOP>",
    "<EXTREMELY-IMPORTANT>",
]


def should_skip(text: str) -> bool:
    """判断是否应该跳过这条消息"""
    for pattern in SKIP_PATTERNS:
        if pattern in text:
            return True
    return False


def extract_claude_prompts(file_path: Path) -> list:
    """从 Claude Code 日志提取用户输入"""
    prompts = []

    # 从文件路径提取 session_id 和 project
    session_id = file_path.stem
    project = file_path.parent.name

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue

                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue

                # 只提取用户输入（userType 为 external 的才是真正的用户输入）
                if event.get("type") == "user" and event.get("userType") == "external":
                    message = event.get("message", {})
                    content = message.get("content", [])

                    # 从 content 数组提取文本
                    texts = []
                    for item in content:
                        if isinstance(item, dict) and item.get("type") == "text":
                            texts.append(item.get("text", ""))

                    user_input = "\n".join(texts).strip()
                    if user_input and not should_skip(user_input):
                        timestamp = event.get("timestamp")
                        prompts.append({
                            "source": "claude_code",
                            "session_id": session_id,
                            "project": project,
                            "user_input": user_input,
                            "created_at": timestamp,
                            "raw_file": str(file_path)
                        })
    except Exception as e:
        print(f"解析文件失败 {file_path}: {e}")

    return prompts


def extract_codex_prompts(file_path: Path) -> list:
    """从 Codex 日志提取用户输入"""
    prompts = []
    session_id = file_path.stem

    # 尝试从路径提取日期
    try:
        # 路径格式: ~/.codex/sessions/2026/04/08/filename.jsonl
        parts = file_path.parts
        if len(parts) >= 4:
            date_str = f"{parts[-4]}-{parts[-3]}-{parts[-2]}"
        else:
            date_str = None
    except:
        date_str = None

    def extract_user_text(text: str) -> str:
        """提取 Codex 用户输入（去除 IDE 上下文）"""
        marker = "## My request for Codex:"
        idx = text.find(marker)
        if idx != -1:
            return text[idx + len(marker):].strip().lstrip(":").strip()

        marker2 = "## My request for Codex"
        idx2 = text.find(marker2)
        if idx2 != -1:
            after = text[idx2 + len(marker2):]
            return after.lstrip(":").strip()

        return text.strip()

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue

                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue

                event_type = event.get("type")
                payload = event.get("payload", {})

                # 旧格式: event_msg with user_message
                if event_type == "event_msg" and payload.get("type") == "user_message":
                    msg = payload.get("message", "")
                    user_input = extract_user_text(msg)
                    if user_input:
                        timestamp = event.get("timestamp") or date_str
                        prompts.append({
                            "source": "codex",
                            "session_id": session_id,
                            "project": None,
                            "user_input": user_input,
                            "created_at": timestamp,
                            "raw_file": str(file_path)
                        })

                # 新格式: item.completed with message
                elif event_type == "item.completed":
                    item = event.get("item", {})
                    if item.get("type") == "message" and item.get("role") == "user":
                        content = item.get("content", [])
                        if isinstance(content, list):
                            texts = []
                            for c in content:
                                if c.get("type") == "input_text":
                                    texts.append(c.get("text", ""))
                            raw_text = "\n".join(texts)
                            user_input = extract_user_text(raw_text)
                            if user_input:
                                timestamp = event.get("timestamp") or date_str
                                prompts.append({
                                    "source": "codex",
                                    "session_id": session_id,
                                    "project": None,
                                    "user_input": user_input,
                                    "created_at": timestamp,
                                    "raw_file": str(file_path)
                                })

    except Exception as e:
        print(f"解析文件失败 {file_path}: {e}")

    return prompts


def scan_claude_logs():
    """扫描 Claude Code 日志"""
    if not CLAUDE_PROJECTS_DIR.exists():
        print(f"Claude Code 日志目录不存在: {CLAUDE_PROJECTS_DIR}")
        return []

    all_prompts = []
    for project_dir in CLAUDE_PROJECTS_DIR.iterdir():
        if not project_dir.is_dir():
            continue

        for log_file in project_dir.glob("*.jsonl"):
            print(f"扫描: {log_file}")
            prompts = extract_claude_prompts(log_file)
            all_prompts.extend(prompts)
            print(f"  提取 {len(prompts)} 条 prompt")

    return all_prompts


def scan_codex_logs():
    """扫描 Codex 日志"""
    if not CODEX_SESSIONS_DIR.exists():
        print(f"Codex 日志目录不存在: {CODEX_SESSIONS_DIR}")
        return []

    all_prompts = []

    # 递归扫描所有子目录
    for log_file in CODEX_SESSIONS_DIR.rglob("*.jsonl"):
        print(f"扫描: {log_file}")
        prompts = extract_codex_prompts(log_file)
        all_prompts.extend(prompts)
        print(f"  提取 {len(prompts)} 条 prompt")

    return all_prompts


def normalize_timestamp(ts):
    """标准化时间戳，只保留到毫秒级"""
    if not ts:
        return None
    # 处理 ISO 8601 格式，如 "2026-04-09T03:31:59.043Z"
    if isinstance(ts, str):
        # 去掉末尾的 Z，保留到毫秒
        ts = ts.rstrip('Z')
        # 如果有微秒部分，截断到毫秒
        if '.' in ts:
            parts = ts.split('.')
            # 保留毫秒（3位）
            ms = parts[1][:3] if len(parts[1]) > 3 else parts[1]
            ts = f"{parts[0]}.{ms}"
        return ts
    return str(ts)


def save_to_db(prompts: list):
    """保存到数据库，根据 (source, session_id, user_input, normalized_timestamp) 去重"""
    if not prompts:
        print("没有数据需要保存")
        return

    running_sessions = get_running_sessions()

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 查询当前数据库中 running 状态的 session_id 集合
    cursor.execute("""
        SELECT DISTINCT session_id FROM prompts
        WHERE source = 'claude_code' AND status = 'running'
    """)
    previously_running = set(row[0] for row in cursor.fetchall())

    # 找出刚完成的 sessions（之前 running，现在不再 running）
    just_completed_sessions = previously_running - running_sessions

    # 先查询已存在的记录，用于去重（比较 source, session_id, user_input, normalized_timestamp）
    cursor.execute("SELECT source, session_id, user_input, created_at FROM prompts")
    existing_raw = cursor.fetchall()
    existing = set()
    for source, session_id, user_input, created_at in existing_raw:
        key = (source, session_id, user_input, normalize_timestamp(created_at))
        existing.add(key)

    inserted = 0
    skipped = 0

    for p in prompts:
        # 使用 (source, session_id, user_input, normalized_timestamp) 作为唯一键
        key = (p["source"], p["session_id"], p["user_input"], normalize_timestamp(p["created_at"]))
        if key in existing:
            skipped += 1
            continue

        # 判断运行状态
        status = "running" if p["session_id"] in running_sessions else "completed"

        cursor.execute("""
            INSERT INTO prompts (source, session_id, project, user_input, created_at, status, raw_file)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (p["source"], p["session_id"], p["project"], p["user_input"], p["created_at"], status, p["raw_file"]))
        existing.add(key)
        inserted += 1

    # 标记刚完成的 sessions
    if just_completed_sessions:
        placeholders = ",".join("?" * len(just_completed_sessions))
        cursor.execute(f"""
            UPDATE prompts
            SET just_completed = 1
            WHERE session_id IN ({placeholders}) AND just_completed = 0
        """, tuple(just_completed_sessions))
        print(f"检测到 {len(just_completed_sessions)} 个 session 刚完成: {just_completed_sessions}")

    # 更新所有不再 running 的 session 状态为 completed
    if running_sessions:
        placeholders = ",".join("?" * len(running_sessions))
        cursor.execute(f"""
            UPDATE prompts
            SET status = 'completed'
            WHERE session_id NOT IN ({placeholders}) AND status = 'running'
        """, tuple(running_sessions))

    conn.commit()
    conn.close()
    print(f"保存 {inserted} 条 prompt 到数据库 (跳过 {skipped} 条重复)")


def get_running_sessions() -> set:
    """获取当前正在运行的 session ID 集合"""
    session_env_dir = Path.home() / ".claude" / "session-env"
    if not session_env_dir.exists():
        return set()
    running = set()
    for f in session_env_dir.glob("*.json"):
        # 文件名是 pid，如 34460.json
        running.add(f.stem)
    return running


def query_prompts(source=None, limit=20):
    """查询 prompt"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    if source:
        cursor.execute("""
            SELECT session_id, source, created_at, status, just_completed, user_input FROM prompts
            WHERE source = ?
            ORDER BY created_at DESC
            LIMIT ?
        """, (source, limit))
    else:
        cursor.execute("""
            SELECT session_id, source, created_at, status, just_completed, user_input FROM prompts
            ORDER BY created_at DESC
            LIMIT ?
        """, (limit,))

    rows = cursor.fetchall()
    conn.close()

    running_sessions = get_running_sessions()

    print(f"\n最近 {len(rows)} 条 prompt:\n")
    print("-" * 80)
    for session_id, source, created_at, _status, just_completed, user_input in rows:
        # 实时检查运行状态并更新
        current_status = "running" if session_id in running_sessions else "completed"
        # just_completed: 数据库标记 > 实时状态
        if just_completed:
            status_display = "[just_completed]"
        else:
            status_display = f"[{current_status}]"
        print(f"[{source}] [{session_id}] {status_display} {created_at}")
        # 截断显示
        display_text = user_input[:200] + "..." if len(user_input) > 200 else user_input
        print(display_text)
        print("-" * 80)


def show_stats():
    """显示统计信息"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM prompts")
    total = cursor.fetchone()[0]

    cursor.execute("SELECT source, COUNT(*) FROM prompts GROUP BY source")
    by_source = cursor.fetchall()

    cursor.execute("SELECT status, COUNT(*) FROM prompts GROUP BY status")
    by_status = cursor.fetchall()

    cursor.execute("SELECT COUNT(*) FROM prompts WHERE just_completed = 1")
    just_completed_count = cursor.fetchone()[0]

    conn.close()

    print(f"\n总计: {total} 条 prompt")
    print("按来源:")
    for source, count in by_source:
        print(f"  {source}: {count}")
    print("按状态:")
    for status, count in by_status:
        print(f"  {status}: {count}")
    if just_completed_count > 0:
        print(f"刚完成: {just_completed_count} 条")


def clear_just_completed():
    """清除 just_completed 标记"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM prompts WHERE just_completed = 1")
    count = cursor.fetchone()[0]

    cursor.execute("UPDATE prompts SET just_completed = 0 WHERE just_completed = 1")
    conn.commit()
    conn.close()

    print(f"已清除 {count} 条 just_completed 标记")


def export_json():
    """导出所有 prompt 为 JSON（供插件调用）"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT source, session_id, project, user_input, created_at, status
        FROM prompts
        ORDER BY created_at DESC
    """)

    rows = cursor.fetchall()
    conn.close()

    prompts = []
    for source, session_id, project, user_input, created_at, status in rows:
        prompts.append({
            "source": source,
            "sessionId": session_id,
            "project": project,
            "userInput": user_input,
            "createdAt": created_at,
            "status": status
        })

    print(json.dumps(prompts, ensure_ascii=False))


def main():
    import sys

    if len(sys.argv) < 2:
        print("用法:")
        print("  python log_parser.py init                 # 初始化数据库")
        print("  python log_parser.py scan               # 扫描所有日志")
        print("  python log_parser.py scan-claude        # 只扫描 Claude Code")
        print("  python log_parser.py scan-codex         # 只扫描 Codex")
        print("  python log_parser.py query              # 查询最近 20 条")
        print("  python log_parser.py query-codex        # 查询 Codex 日志")
        print("  python log_parser.py query-claude       # 查询 Claude Code 日志")
        print("  python log_parser.py stats              # 显示统计")
        print("  python log_parser.py clear-just-completed  # 清除刚完成标记")
        print("  python log_parser.py export-json        # 导出 JSON（供插件调用）")
        return

    cmd = sys.argv[1]

    if cmd == "init":
        init_db()

    elif cmd == "scan":
        init_db()
        prompts = []
        prompts.extend(scan_claude_logs())
        prompts.extend(scan_codex_logs())
        save_to_db(prompts)
        print(f"\n总计提取 {len(prompts)} 条 prompt")

    elif cmd == "scan-claude":
        init_db()
        prompts = scan_claude_logs()
        save_to_db(prompts)

    elif cmd == "scan-codex":
        init_db()
        prompts = scan_codex_logs()
        save_to_db(prompts)

    elif cmd == "query":
        query_prompts()

    elif cmd == "query-codex":
        query_prompts(source="codex")

    elif cmd == "query-claude":
        query_prompts(source="claude_code")

    elif cmd == "stats":
        show_stats()

    elif cmd == "clear-just-completed":
        clear_just_completed()

    elif cmd == "export-json":
        export_json()

    else:
        print(f"未知命令: {cmd}")


if __name__ == "__main__":
    main()
