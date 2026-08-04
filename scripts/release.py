#!/usr/bin/env python3
"""
Скрипт публикации релиза VS Code LLM Assistant.

Поток:
1. Читает версию из package.json
2. Создаёт/пересоздаёт git-тэг v{version} и пушит его
3. Ждёт запуска workflow "Publish" в GitHub Actions
4. Следит за ходом (запуски → jobs → steps), пишет лог
5. При успехе проверяет расширение в Marketplace API
6. Пишет отчёт reports/release-{version}-{дата}.md
7. Выводит отчёт в stdout (доставляется в чат)

Запуск: по команде пользователя через cronjob (вручную, durable).
Выход: 0 = успех, 1 = ошибка (сообщение в stderr).
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

PROJECT_DIR = "/opt/data/projects/vscode-llm-assistant"
REPO = "alekseyber/vscode-llm-assistant"
PUBLISHER = "alekseyber"
EXTENSION_NAME = "vscode-llm-assistant"
WORKFLOW_NAME = "Publish"
POLL_INTERVAL = 15  # секунд между опросами GitHub Actions
MAX_WAIT = 600      # максимум ожидания workflow (10 минут)


def get_token():
    """Читает GITHUB_TOKEN из s6-окружения контейнера."""
    for path in ("/run/s6/container_environment/GITHUB_TOKEN",):
        try:
            with open(path) as f:
                v = f.read().strip()
                if v:
                    return v
        except OSError:
            pass
    return os.environ.get("GITHUB_TOKEN")


def api(url, token, method="GET", data=None):
    """Универсальный запрос к GitHub API."""
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(data).encode()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def run(cmd, cwd=PROJECT_DIR):
    """Запускает shell-команду, возвращает (rc, stdout, stderr)."""
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def read_version():
    """Читает версию из package.json."""
    with open(os.path.join(PROJECT_DIR, "package.json")) as f:
        pkg = json.load(f)
    return pkg["version"]


def ensure_tag(version):
    """Создаёт тэг v{version} и пушит его (пересоздаёт, если есть)."""
    tag = f"v{version}"
    rc, _, err = run(f"git tag -f {tag} && git push origin --delete {tag} 2>/dev/null; git push origin {tag}")
    if rc != 0:
        raise RuntimeError(f"Не удалось запушить тэг {tag}: {err}")
    return tag


def find_publish_run(token, sha):
    """Ищет запуск workflow Publish для указанного коммита."""
    url = f"https://api.github.com/repos/{REPO}/actions/runs?per_page=20"
    _, data = api(url, token)
    runs = data.get("workflow_runs", [])
    for r in runs:
        if r.get("name") == WORKFLOW_NAME and r.get("head_sha") == sha:
            return r
    return None


def wait_for_run(token, sha):
    """Ждёт завершения workflow, возвращает (run, log_lines)."""
    log_lines = []
    start = time.time()
    run = find_publish_run(token, sha)
    if not run:
        # Ждём появления запуска
        while time.time() - start < 60:
            time.sleep(5)
            run = find_publish_run(token, sha)
            if run:
                break
    if not run:
        raise RuntimeError("Workflow Publish не запустился в течение 60 секунд")

    run_id = run["id"]
    log_lines.append(f"Workflow #{run_id} ({run['status']}): {run['html_url']}")

    while time.time() - start < MAX_WAIT:
        _, data = api(f"https://api.github.com/repos/{REPO}/actions/runs/{run_id}", token)
        status = data.get("status")
        conclusion = data.get("conclusion")
        if status == "completed":
            log_lines.append(f"Завершён: {conclusion}")
            # Логи шагов
            _, jobs = api(f"https://api.github.com/repos/{REPO}/actions/runs/{run_id}/jobs", token)
            for j in jobs.get("jobs", []):
                log_lines.append(f"  Job {j['name']}: {j.get('conclusion', 'running')}")
                for s in j.get("steps", []):
                    log_lines.append(f"    - {s['name']}: {s.get('conclusion', 'running')}")
            return run_id, conclusion, log_lines
        time.sleep(POLL_INTERVAL)
        log_lines.append(f"[{int(time.time()-start)}s] status={status}")

    raise RuntimeError("Таймаут ожидания workflow (10 минут)")


def check_marketplace(token):
    """Проверяет наличие расширения в Marketplace API."""
    url = (
        f"https://marketplace.visualstudio.com/_apis/public/gallery/publishers/"
        f"{PUBLISHER}/vsextensions/{EXTENSION_NAME}?api-version=3.0-preview.1"
    )
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            version = data.get("versions", [{}])[0].get("version", "?")
            return True, version
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, str(e)


def write_report(version, run_id, conclusion, log_lines, ok, mp_version, tag):
    """Пишет отчёт в reports/release-{version}-{дата}.md."""
    os.makedirs(os.path.join(PROJECT_DIR, "reports"), exist_ok=True)
    date = datetime.now().strftime("%Y-%m-%d_%H-%M")
    path = os.path.join(PROJECT_DIR, "reports", f"release-{version}-{date}.md")
    lines = [
        f"# Отчёт о релизе v{version}",
        "",
        f"**Дата:** {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"**Тэг:** `{tag}`",
        f"**Workflow:** #{run_id}",
        f"**Результат:** {'✅ успех' if ok else '❌ ошибка'}",
        f"**Workflow conclusion:** {conclusion}",
        f"**Marketplace:** {mp_version}",
        "",
        "## Лог GitHub Actions",
        "```",
    ]
    lines.extend(log_lines)
    lines.extend(["```", ""])
    with open(path, "w") as f:
        f.write("\n".join(lines))
    os.chmod(path, 0o644)
    return path


def main():
    token = get_token()
    if not token:
        print("ОШИБКА: GITHUB_TOKEN не найден", file=sys.stderr)
        return 1

    version = read_version()
    tag = f"v{version}"
    print(f"🚀 Релиз {tag}")
    print(f"Версия из package.json: {version}")

    # 1. Тэг
    print("\n[1/4] Создание тэга...")
    tag = ensure_tag(version)
    print(f"✅ Тэг {tag} запушен")

    # 2. Коммит-ша для поиска запуска
    _, sha, _ = run("git rev-parse HEAD")

    # 3. Ожидание и логи
    print("\n[2/4] Ожидание GitHub Actions...")
    run_id, conclusion, log_lines = wait_for_run(token, sha)
    print("\n".join(log_lines))

    # 4. Проверка Marketplace
    print("\n[3/4] Проверка Marketplace...")
    ok, mp_version = check_marketplace(token)
    if ok:
        print(f"✅ Расширение в Marketplace, версия: {mp_version}")
    else:
        print(f"⚠️ Marketplace пока не вернул расширение: {mp_version}")

    success = conclusion == "success"
    print(f"\n[4/4] Результат: {'✅ успех' if success else '❌ ошибка'}")

    path = write_report(version, run_id, conclusion, log_lines, success, mp_version, tag)
    print(f"\nОтчёт: {path}")
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
