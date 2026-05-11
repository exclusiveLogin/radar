---
name: radar-mcp-context
description: >-
  Настройка MCP Context7 и lean-ctx для монорепо Radar под Windows/Cursor и
  сценарии использования. Вызывается при настройке окружения, проблемах с MCP или
  вопросах «как подключить context7 / lean-ctx».
disable-model-invocation: true
---

# Radar — Context7 и lean-ctx

## ✅ Что уже в репозитории

- Файл `/.cursor/mcp.json` добавляет серверы `context7` и `lean-ctx`. После изменений перезапусти Cursor.
- Правило `/.cursor/rules/radar-mcp-tooling.mdc` напоминает агенту вызывать эти MCP по назначению.

## ✅ Установка lean-ctx (локально на машину)

Под Windows удобнее всего npm:

```powershell
npm install -g lean-ctx-bin
lean-ctx --version
lean-ctx doctor
```

Опционально полная автонастройка (шелл + редакторы, в том число Cursor):

```powershell
lean-ctx setup
```

Только генерация конфигурации Cursor без `setup`:

```powershell
lean-ctx init --agent cursor
```

Ручное подключение в Cursor совпадает с `/.cursor/mcp.json`: `"command": "lean-ctx"`. Если MCP не находит бинарник, укажи полный путь к исполняемому файлу (часто `%APPDATA%\npm\lean-ctx.cmd`).

## ✅ Context7 (без установки отдельного пакета)

Сервер тянется через `npx -y @upstash/context7-mcp@latest` (уже прописано в `/.cursor/mcp.json`).

- Ключ необязателен для базового режима; для лимитов и приватных репозиториев получи ключ на [context7.com/dashboard](https://context7.com/dashboard) и в Cursor → MCP → редактировать сервер `context7` → добавь переменную окружения `CONTEXT7_API_KEY` **или** аргумент `--api-key` (не коммить в git).
- Альтернатива один раз для пользователя:

```powershell
npx ctx7 setup --cursor
```

## ⚠️ Windows: если MCP Context7 не стартует

В документации `@upstash/context7-mcp` рекомендуют явный вызов `npx`/Node и нужные переменные окружения. В `mcp.json` для сервера `context7` можно заменить `command` на полный путь к `npx.cmd` из `where npx`.

## 📌 Когда что использовать

| Задача | Инструмент |
|--------|------------|
| Документация npm-пакета, актуальный API пример | Context7 MCP |
| Карта модулей, сжатые повторные чтения по репо | lean-ctx MCP |
| Коммиты только по запросу пользователя | По правилам репозитория — git не автоматизировать |
