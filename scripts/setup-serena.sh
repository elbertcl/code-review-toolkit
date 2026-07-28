#!/usr/bin/env bash
set -euo pipefail

revision="${1:-}"
if [[ ! "$revision" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "Serena revision must be an exact 40-character commit SHA" >&2
  exit 2
fi

serena_home="${SERENA_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/code-review-toolkit/serena}"
mkdir -p "$serena_home/bin" "$serena_home/cache"

cat >"$serena_home/serena_config.yml" <<EOF
language_backend: LSP
gui_log_window: false
web_dashboard: false
web_dashboard_open_on_launch: false
log_level: 30
trace_lsp_communication: false
tool_timeout: 20
base_modes: []
default_modes: []
fixed_tools:
  - get_symbols_overview
  - find_symbol
  - find_referencing_symbols
  - search_for_pattern
  - find_declaration
  - find_implementations
  - get_diagnostics_for_file
project_serena_folder_location: "$serena_home/projects/\$projectFolderName"
trusted_project_path_patterns: []
projects: []
EOF

cat >"$serena_home/project.yml" <<'YAML'
project_name: review-target
ignored_paths:
  - "**/generated/**"
  - "**/vendor/**"
  - "**/mocks/**"
  - "**/mock/**"
  - "**/node_modules/**"
read_only: true
fixed_tools:
  - get_symbols_overview
  - find_symbol
  - find_referencing_symbols
  - search_for_pattern
  - find_file
  - list_dir
  - read_file
YAML

cat >"$serena_home/read-only-context.yml" <<'YAML'
description: Read-only symbolic retrieval for the review POC.
prompt: Use symbolic retrieval only. Do not edit files, execute commands, or access memories.
excluded_tools:
  - create_text_file
  - read_file
  - execute_shell_command
  - replace_content
  - find_file
  - list_dir
  - read_memory
  - write_memory
  - edit_memory
  - delete_memory
  - list_memories
included_optional_tools: []
tool_description_overrides: {}
single_project: true
structured_tool_output: true
YAML

cat >"$serena_home/bin/serena-readonly" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export XDG_CACHE_HOME="\${SERENA_HOME:-$serena_home}/cache"
exec env -i HOME="\${SERENA_HOME:-$serena_home}" PATH="\$PATH" SERENA_HOME="\${SERENA_HOME:-$serena_home}" XDG_CACHE_HOME="\${SERENA_HOME:-$serena_home}/cache" uvx --from "git+https://github.com/oraios/serena.git@$revision" serena start-mcp-server \
  --transport stdio --context "$serena_home/read-only-context.yml" --mode planning --project "\${1:?project path required}" \
  --enable-web-dashboard false --open-web-dashboard false --enable-gui-log-window false --tool-timeout "\${SERENA_TOOL_TIMEOUT_SECONDS:-20}"
EOF
chmod 0700 "$serena_home/bin/serena-readonly"
printf '%s\n' "$revision" >"$serena_home/revision"
