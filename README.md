# UsageScope GNOME

GNOME 상단바에서 ChatGPT·Claude의 **구독 등급과 한도 잔여율**을 확인합니다.

- ChatGPT 막대는 파랑, Claude 막대는 주황입니다.
- 막대는 남은 양이며, 옆에 잔여율과 사용률을 함께 표시합니다.
- 잔여 **30% 이하는 빨강**, **30% 아래로 내려가면 알림**이 한 번 발생합니다.
- AI 모델명이 아닌 Plus / Pro / Max 등의 구독 등급을 표시합니다. 확인되지 않으면 추측하지 않고 구독 미확인으로 표시합니다.
- 자체 백엔드·모델 호출·브라우저 쿠키 수집은 없습니다. Node는 개발·빌드에만 필요합니다.

## 지금 설치하거나 업데이트하기

**아래 경로에 프로젝트가 이미 있고 개발 의존성을 설치한 경우** 그대로 복사하세요. 어느 디렉터리에서 실행해도 됩니다.

### 1. 최신 ZIP을 만들고 설치

```bash
npm --prefix "$HOME/Projects/utility/usagescope-gnome" run pack
gnome-extensions install --force "$HOME/Projects/utility/usagescope-gnome/dist/usagescope-gnome@ijustsea.github.io.shell-extension.zip"
```

### 2. 작업을 저장하고 로그아웃 → 다시 로그인

Wayland에서 새 코드가 반영되도록 **GNOME 로그아웃 후 다시 로그인**하세요.

오른쪽 위 시스템 메뉴 → 전원 메뉴 → 로그아웃.

**로그아웃 없이 반영되는 것:** 모니터링 설정·조회 간격·새 수신값은 현재 세션에서 갱신됩니다. 이미 로드된 JavaScript 코드를 업데이트할 때는 껐다 켜기만으로 새 모듈을 읽는다고 보장할 수 없습니다. Wayland의 Shell 코드 교체는 위의 로그아웃·로그인 절차를 사용합니다. [GNOME 개발 안내](https://gjs.guide/extensions/development/debugging.html)

### 3. 다시 로그인한 뒤 켜기

```bash
gnome-extensions enable usagescope-gnome@ijustsea.github.io
gnome-extensions info usagescope-gnome@ijustsea.github.io
```

### 4. 상단바 UsageScope → 설정 → 모니터링 켜기

- **ChatGPT 모니터링**: 공식 Codex CLI의 기존 로그인으로 한도를 조회합니다.
- **Claude 모니터링**: 아래 Claude 전달 설정 후 보고된 값을 표시합니다.

카드의 **로그인 / 가입**은 공식 웹사이트를 열기만 합니다. 웹사이트 로그인과 로컬 CLI 인증은 별개입니다.

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

## ChatGPT 사용량이 안 보일 때

### 1. 공식 CLI 로그인

```bash
codex login
```

또는 UsageScope의 **설정 → CLI 연결 및 설정 → Codex CLI 로그인 연결**을 사용합니다.

### 2. CLI 경로 확인

```bash
command -v codex
```

출력된 절대 경로를 **설정 → CLI 연결 및 설정 → CLI 경로**에 넣고 저장하세요.
예: `/home/safe/.local/bin/codex`. 명령 인자나 셸 표현식은 넣지 않습니다.

### 3. 사용량 새로 확인

UsageScope의 **설정 → 사용량 새로 확인**을 선택합니다.

## Claude 연결하기

### 1. 공식 CLI 로그인

```bash
claude auth login
```

### 2. 변경 내용 미리 확인

```bash
gjs -m "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/usagescope-gnome@ijustsea.github.io/claude/setup.js" --preview
```

### 3. 미리보기를 검토한 뒤 적용

```bash
gjs -m "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/usagescope-gnome@ijustsea.github.io/claude/setup.js" --apply
```

Claude Code의 상태줄이 다음에 실행되고 사용량이 보고되면 카드가 갱신됩니다.
여러 세션이 있으면 **설정 → CLI 연결 및 설정 → Claude 세션 선택**에서 하나를 고릅니다.

구독 등급은 설정 도구가 지정한 공식 CLI의 `auth status --json` 결과에서 읽고 프로필별로 최대 5분 캐시합니다. 이메일·조직·토큰은 저장하지 않습니다. 구버전 연결에는 구독 조회 경로가 없을 수 있으므로 기존 설정을 복원한 뒤 미리보기·적용을 다시 진행하세요.

### 4. 원래 Claude 설정으로 되돌리기

```bash
gjs -m "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/usagescope-gnome@ijustsea.github.io/claude/setup.js" --restore
```

기존 설정이나 백업이 변경됐다면 복원을 거부합니다. 복원 중 생긴 편집도 덮어쓰지 않도록 현재 설정을 먼저 비공개 복구 폴더로 옮겨 검증합니다. 충돌 시 편집 내용과 기존 상태줄 실행 경로를 보존합니다.

복원 후에도 Claude 설정 디렉터리의 **`.usagescope-recovery-*`** 폴더에 캡처한 설정을 남깁니다. 성공 시 이전 연결 백업도 그곳에 보관하므로 다시 적용할 수 있습니다. 최대 16개이며 가득 차면 먼저 검토하도록 복원을 거부합니다. 복구 자료를 자동 삭제하지 않습니다. 백업·복구 자료에는 원래 설정의 민감값이 포함될 수 있어 사용자 전용 권한으로 보관하며 업로드하지 않습니다.
기존 상태줄이 단일 절대 실행 파일이면 출력을 보존합니다. 임의 셸 명령은 자동으로 감싸지 않고 거부합니다.

## 자주 나오는 오류

| 메시지 | 해결 |
| --- | --- |
| `/home/safe/package.json`을 찾지 못함 | 위의 `npm --prefix "$HOME/Projects/utility/usagescope-gnome" ...` 명령을 사용 |
| `Extension ... does not exist` | ZIP 설치 후 GNOME 로그아웃·재로그인, 그다음 enable |
| 이미 설치되어 있음 | 위의 `gnome-extensions install --force ...`로 업데이트 |
| 구독 미확인 | CLI가 구독 정보를 보고하지 않거나 Claude 구버전 전달 설정일 수 있음. AI 모델명·한도 모양으로 추정하지 않음 |
| Claude 수신 대기 | Claude 전달 설정과 세션 선택 확인. Claude가 종료돼 있으면 독립 재조회하지 않음 |

## 화면과 알림의 의미

- 잔여율은 메시지 수·토큰 수·API 잔액이 아닙니다.
- 잔여 30%는 빨강이지만, 알림은 30% **아래**로 내려갈 때 발생합니다.
- 최초 수신·반복 수신·만료된 값은 새 알림을 만들지 않습니다. 35% 이상으로 회복된 새 보고 뒤 다시 알림을 허용합니다.
- Claude 알림은 **마지막 보고값** 기준이며 서버 최신성을 보장하지 않습니다.
- 다음 초기화 시각이 지났다고 자동으로 100%로 바꾸지 않습니다.
- 웹사이트 버튼은 로컬 계정 인증·모니터링을 자동 완료하지 않습니다.
- 모니터링 해제는 공식 CLI 계정을 로그아웃하지 않습니다.
- 로그아웃하면 런타임 스냅샷·구독 캐시는 사라집니다.

## 개발·검증

```bash
npm --prefix "$HOME/Projects/utility/usagescope-gnome" run check
npm --prefix "$HOME/Projects/utility/usagescope-gnome" run test:shell
```

`test:shell`은 별도 D-Bus·설정·런타임 디렉터리의 headless GNOME에서 실제 팝업 크기와 막대 배치를 검사합니다. 기본 데스크톱을 바꾸지 않습니다.

구조: `src/core` 검증·상태 → `src/codex`와 `src/claude` 수집 → `src/ui` 표시. 설정은 GSettings, 임시 데이터는 XDG_RUNTIME_DIR을 사용합니다. Codex 프로세스는 조회 후 종료하고 로그인 중에만 유지합니다.

[보안 경계와 한계](SECURITY.md) · [실제 검증 기록](docs/implementation-progress.md)

[구조·동작 원리·기술 선택 학습자료](docs/learning/UsageScope_설계와_기술선택_학습자료.md)

## 근거

- [GNOME TypeScript](https://gjs.guide/extensions/development/typescript.html)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Claude statusline](https://code.claude.com/docs/en/statusline)
- [Claude CLI 명령](https://code.claude.com/docs/en/cli-reference)
- [XDG runtime directory](https://specifications.freedesktop.org/basedir/latest/)

MIT. 참고 프로젝트의 아이디어를 조사했으며 현재 코드는 독립 구현입니다.
