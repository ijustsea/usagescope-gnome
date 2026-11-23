# UsageScope GNOME

GNOME 상단바에서 ChatGPT·Claude의 **구독 등급과 한도 잔여율**을 확인합니다.

- ChatGPT 막대는 파랑, Claude 막대는 주황입니다.
- 막대는 남은 양이며, 옆에 잔여율과 사용률을 함께 표시합니다. 한도 이름 옆의 `· 4h 30m 후`는 다음 초기화까지 남은 시간입니다.
- 잔여 **30% 이하는 빨강**, **30% 이하로 내려가면 알림**이 한 번 발생합니다.
- AI 모델명이 아닌 Plus / Pro / Max / Team 등의 구독 등급을 표시합니다. 확인되지 않으면 추측하지 않고 구독 미확인으로 표시합니다.
- 두 서비스 모두 **공식 CLI에 이미 로그인된 상태**에서 사용량만 읽습니다. 모델 호출(토큰 사용)·브라우저 자동 실행·CLI 설정 변경은 하지 않습니다.
- 자체 백엔드·브라우저 쿠키 수집은 없습니다. Node는 개발·빌드에만 필요합니다.

## 지금 설치하거나 업데이트하기

> 이전 버전에서 **Claude 상태줄 연결**(`setup.js --apply`)을 적용했다면, 업데이트 **전에** 아래 [이전 상태줄 연결 되돌리기](#이전-상태줄-연결-되돌리기)를 먼저 진행하세요.
>
> 0.4.0부터 **Claude 모니터링**은 Claude CLI 조회를 뜻합니다. 이전 버전에서 Claude 모니터링을 켜 두었다면(상태줄 수신 방식) 업데이트 직후 별도 설정 없이 CLI 조회(기본 1분 간격)가 시작됩니다. 원치 않으면 설정에서 Claude 모니터링을 끄세요.

**아래 경로에 프로젝트가 이미 있고 개발 의존성을 설치한 경우** 그대로 복사하세요. 어느 디렉터리에서 실행해도 됩니다.

### 1. 최신 ZIP을 만들고 설치

```bash
npm --prefix "$HOME/Projects/utility/usagescope-gnome" run pack
gnome-extensions install --force "$HOME/Projects/utility/usagescope-gnome/dist/usagescope-gnome@ijustsea.github.io.shell-extension.zip"
```

### 2. 작업을 저장하고 로그아웃 → 다시 로그인

Wayland에서 새 코드가 반영되도록 **GNOME 로그아웃 후 다시 로그인**하세요.

오른쪽 위 시스템 메뉴 → 전원 메뉴 → 로그아웃.

**로그아웃 없이 반영되는 것:** 모니터링 설정·조회 간격·새 조회값은 현재 세션에서 갱신됩니다. 이미 로드된 JavaScript 코드를 업데이트할 때는 껐다 켜기만으로 새 모듈을 읽는다고 보장할 수 없습니다. Wayland의 Shell 코드 교체는 위의 로그아웃·로그인 절차를 사용합니다. [GNOME 개발 안내](https://gjs.guide/extensions/development/debugging.html)

### 3. 다시 로그인한 뒤 켜기

```bash
gnome-extensions enable usagescope-gnome@ijustsea.github.io
gnome-extensions info usagescope-gnome@ijustsea.github.io
```

### 4. 상단바 UsageScope → 설정 → 모니터링 켜기

- **ChatGPT 모니터링**: 공식 Codex CLI의 기존 로그인으로 한도를 조회합니다.
- **Claude 모니터링**: 공식 Claude CLI의 기존 로그인으로 한도를 조회합니다.

카드의 **로그인 / 가입 ↗**은 누를 때만 공식 웹사이트를 기본 브라우저로 엽니다. 웹사이트 로그인과 로컬 CLI 로그인은 별개입니다.

## 처음 소스를 받는 경우

요구 사항: GNOME Shell 51, GJS 1.90+, Node 22+, npm, GLib schema compiler, zip/unzip.

### 1. 저장소 받기

```bash
mkdir -p "$HOME/Projects/utility"
git clone https://github.com/ijustsea/usagescope-gnome.git "$HOME/Projects/utility/usagescope-gnome"
```

이미 저장소가 있으면 clone을 반복하지 마세요. 최신 커밋을 받을 때는 먼저 로컬 변경을 확인합니다.

```bash
git -C "$HOME/Projects/utility/usagescope-gnome" status --short
git -C "$HOME/Projects/utility/usagescope-gnome" pull --ff-only
```

### 2. 개발 의존성 설치

```bash
npm --prefix "$HOME/Projects/utility/usagescope-gnome" ci --ignore-scripts
```

### 3. 위의 설치 단계 1 → 2 → 3 → 4 진행

빌드 출력은 `dist/usagescope-gnome@ijustsea.github.io.shell-extension.zip`과 SHA256 파일입니다.
실행 ZIP에는 node_modules·테스트·인증 파일·네이티브 실행 파일을 포함하지 않습니다.

## 사용량이 안 보일 때

### 1. 공식 CLI 로그인

일반 터미널에서 실행합니다. UsageScope는 로그인을 시작하지 않습니다.

```bash
codex login
claude auth login
```

로그인 후 **설정 → Refresh**를 누르면 바로 다시 조회합니다. 누르지 않아도 로그아웃 상태에서는 실패 횟수에 따라 30초부터 약 15분까지 늘어나는 간격으로 자동 재조회합니다.

### 2. CLI 경로 확인

UsageScope는 두 CLI를 같은 순서로 찾습니다: GNOME Shell의 PATH → 공식 기본 설치 위치 `~/.local/bin/codex`, `~/.local/bin/claude`.

```bash
command -v codex
command -v claude
```

다른 위치에 설치했다면 출력된 절대 경로를 지정합니다. 명령 인자나 셸 표현식은 넣지 않습니다. 지정한 경로가 없으면 다른 위치로 대체하지 않고 `공식 CLI를 찾을 수 없음`으로 표시합니다.

```bash
SCHEMA="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/usagescope-gnome@ijustsea.github.io/schemas"
gsettings --schemadir "$SCHEMA" set org.gnome.shell.extensions.usagescope codex-path '/absolute/path/to/codex'
gsettings --schemadir "$SCHEMA" set org.gnome.shell.extensions.usagescope claude-path '/absolute/path/to/claude'
```

자동 검색으로 되돌리려면 값을 `''`로 설정합니다.

## Claude 사용량 조회 방식

공식 CLI의 읽기 전용 `get_usage` 제어 요청으로 구독 등급과 5시간·7일 한도를 조회합니다. Team 계정과 Claude Code 2.1.323에서 실제 한도 응답을 확인했습니다. 다른 계정·버전·조직 정책에서 제공되지 않으면 `한도 정보 미제공` 또는 오류로 표시합니다. 초기값을 100%로 추정하지 않습니다.

이 인터페이스는 공식 SDK에서 **실험용**으로 표시됩니다. UsageScope는 `initialize`와 `get_usage(skip_behaviors=true)`만 보내며, 모델 프롬프트·`/usage` 텍스트를 보내지 않습니다. CLI의 도구·MCP·훅·스킬·세션 저장을 끄고, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`로 텔레메트리·오류 보고 같은 비필수 통신도 끈 뒤 조회하고 프로세스를 종료합니다. 별도 서버나 Agent SDK 실행 의존성을 추가하지 않습니다. [검토한 공식 SDK 0.3.323](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk/v/0.3.323) · [Claude Code 환경 변수](https://code.claude.com/docs/en/env-vars)

## 조회 간격

기본 조회 간격은 **1분**입니다. **설정 → 조회 간격**의 `15초 · 1분 · 3분 · 5분 · 15분 · 1시간` 중 하나를 누르면 바로 적용되고, 현재 값이 파랗게 표시됩니다. 기존에 저장한 간격은 유지하며 `Refresh`는 즉시 한 번 조회합니다.

15초는 CLI 실행·통신이 더 자주 일어나므로 빠른 확인이 필요할 때만 선택하세요. 조회가 끝난 후 선택한 간격만큼 기다리는 방식이며, 처리 시간과 공급자 반영 지연은 별도입니다. 진행 중 조회는 공유하고, 실패 시에는 선택한 간격 대신 30초부터 약 15분까지 재시도 간격을 늘립니다. 공급자 반영 지연이나 CLI 캐시까지 없애는 실시간 보장은 아닙니다.

## 사용자 환경에 주는 영향

- **토큰**: 모델 메시지를 보내지 않습니다. Codex는 `account/rateLimits/read`, Claude는 `get_usage`만 호출하며, Claude 응답의 세션 비용은 0·모델 사용 내역은 비어 있음을 확인했습니다.
- **브라우저**: 자동으로 열거나 새로고침을 요구하지 않습니다. 카드의 로그인 / 가입 버튼을 누를 때만 공식 페이지를 엽니다.
- **설정 파일**: Codex·Claude 설정을 바꾸지 않습니다. 다만 Claude CLI는 실행될 때마다 자체 캐시 파일 하나(`~/.claude/plugins/store/` 아래)를 갱신하는 것이 관측됐습니다. 이는 CLI 자체 동작입니다.
- **프로세스**: 조회 때만 공식 CLI를 잠깐 실행하고 종료합니다. 조회 사이에 상주하는 CLI 프로세스는 없습니다. 이 개발 PC에서 1회 조회는 Claude 약 0.3–0.4초(최대 메모리 약 196MB), Codex 약 0.6초(약 119MB)였습니다. 환경마다 다르며 성능 보장은 아닙니다.

## 이전 상태줄 연결 되돌리기

0.4.0부터 상태줄 수신 모드와 설정 도구(`setup.js`)를 제거했습니다. 이전 버전에서 상태줄 연결을 적용했다면 Claude Code 상태줄이 더 이상 없는 파일을 가리키게 되므로 되돌려야 합니다.

**새 버전 설치 전(권장)**: 아직 설치된 이전 버전으로 복원합니다.

```bash
gjs -m "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/usagescope-gnome@ijustsea.github.io/claude/setup.js" --restore
```

**이미 업데이트했다면**: Claude 설정 디렉터리(기본 `~/.claude`)의 `.usagescope-setup/original.json`이 적용 전 `settings.json` 원본입니다. 파일이 없다면 적용 전에는 `settings.json`이 없었습니다. 내용을 검토한 뒤 `settings.json`의 `statusLine` 항목을 직접 되돌리세요. 백업·복구 폴더(`.usagescope-setup`, `.usagescope-recovery-*`)에는 원래 설정의 민감값이 있을 수 있으니 업로드하지 말고, 확인 후 직접 정리하세요. 0.4.0은 이 폴더를 읽거나 지우지 않습니다.

## 자주 나오는 오류

| 메시지 | 해결 |
| --- | --- |
| `/home/safe/package.json`을 찾지 못함 | 위의 `npm --prefix "$HOME/Projects/utility/usagescope-gnome" ...` 명령을 사용 |
| `Extension ... does not exist` | ZIP 설치 후 GNOME 로그아웃·재로그인, 그다음 enable |
| 이미 설치되어 있음 | 위의 `gnome-extensions install --force ...`로 업데이트 |
| 터미널에서 CLI 로그인 필요 · CLI 로그인 필요 · N분 전 | `codex login` 또는 `claude auth login` 실행. 이전 값이 있으면 언제 값인지 함께 표시 |
| 공식 CLI를 찾을 수 없음 | CLI 설치 확인, 다른 위치라면 위의 gsettings로 절대 경로 지정. 이 상태는 자동 재시도하지 않으므로 설치 후 Refresh |
| 조회 실패 · CLI 로그인 확인 | 로그인 상태·네트워크·CLI 버전 확인. 자동 재시도 중에도 Refresh로 즉시 확인 가능 |
| 구독 미확인 | CLI가 구독 정보를 보고하지 않음. AI 모델명·한도 모양으로 추정하지 않음 |
| 한도 정보 미제공 | CLI가 해당 계정의 한도 필드를 제공하지 않음. 로그인·조직 정책·CLI 버전을 확인 |

## 화면과 알림의 의미

- 잔여율은 메시지 수·토큰 수·API 잔액이 아닙니다.
- 잔여 30% 이하는 빨강이며, 새 조회값이 30% **이하**로 내려갈 때 알림이 발생합니다.
- 최초 조회·반복 조회·만료된 값은 새 알림을 만들지 않습니다. 35% 이상으로 회복된 새 조회 뒤 다시 알림을 허용합니다.
- 새 조회가 끝나기 전(조회 중·실패)이거나 6분 넘게 갱신되지 않은 값은 카드를 흐리게, 상단바에는 `~`를 붙여 이전 값임을 표시합니다.
- `5시간 · 4h 30m 후`처럼 한도 이름 옆에 다음 초기화까지 남은 시간을 내림해 표시합니다(1분 미만은 `<1m`). 메뉴가 열려 있는 동안 30초마다 갱신되고, CLI가 초기화 시각을 보고하지 않은 한도에는 표시하지 않습니다.
- 다음 초기화 시각이 지났다고 자동으로 100%로 바꾸지 않습니다.
- 웹사이트 버튼은 로컬 CLI 인증·모니터링을 자동 완료하지 않습니다.
- 모니터링 해제는 공식 CLI 계정을 로그아웃하지 않습니다.

## 개발·검증

```bash
npm --prefix "$HOME/Projects/utility/usagescope-gnome" run check
npm --prefix "$HOME/Projects/utility/usagescope-gnome" run test:shell
```

`test:shell`은 별도 D-Bus·설정·런타임 디렉터리의 headless GNOME에서 실제 팝업 크기와 막대 배치를 검사합니다. 기본 데스크톱을 바꾸지 않습니다. `USAGESCOPE_TEST_MONITOR=1024x480`으로 작은 화면도 검사할 수 있습니다.

구조: `src/core` 검증·상태 → `src/codex`와 `src/claude` 조회 → `src/ui` 표시. 설정은 GSettings를 사용합니다. 조회 응답은 메모리에만 보관하고 CLI 프로세스를 종료합니다.

[보안 경계와 한계](SECURITY.md) · [실제 검증 기록](docs/implementation-progress.md)

[구조·동작 원리·기술 선택 학습자료 — 0.2.1 기준](docs/learning/UsageScope_설계와_기술선택_학습자료.md). 0.2.1 이후 바뀐 조회 방식은 위의 설명과 [검증 기록](docs/implementation-progress.md)을 참고하세요.

## 근거

- [GNOME TypeScript](https://gjs.guide/extensions/development/typescript.html)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Claude Code 환경 변수](https://code.claude.com/docs/en/env-vars)
