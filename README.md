# UsageScope GNOME

Claude·Codex 한도 잔여율을 표시하는 GNOME 51 확장입니다. 초기 대상은 Fedora / Wayland입니다. 사용량 조회만 수행하며 모델 프롬프트, thread/turn 생성, 크레딧 구매·소비를 수행하지 않습니다.

## 구조

- TypeScript → 읽기 쉬운 JavaScript → GJS. Node는 빌드·테스트에만 사용합니다.
- Codex: 공식 CLI App Server와 stdio로 연결하고 CLI가 로그인·인증 갱신을 관리합니다.
- Claude: 공식 statusline JSON에서 필요한 두 한도만 추출해 사용자 전용 런타임 파일로 전달합니다.
- UI: GNOME St/Clutter, 설정: GSettings. 자체 백엔드·HTTP 서버·브라우저 쿠키 수집·자동 업데이트는 없습니다.
- Codex 프로세스는 조회·로그인 중에만 실행하고 일반 조회가 끝나면 종료합니다. 로그인 중에는 공식 CLI의 임시 localhost 콜백이 완료·취소될 때까지 유지됩니다.

## 빌드와 검증

개발 요구 사항: Node 22+, npm, GJS 1.90+, GLib schema compiler, zip/unzip. 실행 대상은 GNOME Shell 51입니다.

```sh
npm ci --ignore-scripts
npm run check
npm run pack
```

출력: `dist/usagescope-gnome@ijustsea.github.io.shell-extension.zip` 및 SHA256.
빌드 의존성은 lockfile에 고정됩니다. npm lifecycle scripts는 설치 과정에서 실행하지 않습니다. ZIP에는 node_modules·테스트·토큰·네이티브 실행 파일을 넣지 않습니다.

## 설치와 사용

```sh
npm run install:extension
gnome-extensions enable usagescope-gnome@ijustsea.github.io
```

설치는 현재 사용자에게만 적용하며 자동 활성화하지 않습니다. Wayland에서는 설치 후 로그아웃/로그인이 필요할 수 있습니다. 업데이트 설치는 기존 설치 상태를 확인한 후 `gnome-extensions install --force <zip>`을 명시적으로 실행하세요.

처음에는 공급자 모니터링이 모두 꺼져 있습니다.

1. 상단바 UsageScope 메뉴에서 원하는 공급자를 켭니다.
2. Codex가 발견되지 않으면 Monitoring settings에서 공식 CLI의 절대 경로를 지정합니다. 셸 명령이나 인자를 넣지 않습니다.
3. Connect Codex는 공식 인증 URL을 기본 브라우저로 열고, 실제 조회 결과로 연결 상태를 확인합니다. Cancel은 로그인 대기를 취소합니다.
4. Claude 로그인은 공식 `claude auth login`으로 수행하고 아래 전달 설정을 적용합니다.
5. 모니터링 해제는 수집만 멈추며 공식 CLI 계정을 로그아웃하지 않습니다.

## Claude 전달 설정

설치된 확장 경로를 사용합니다. XDG_DATA_HOME을 설정했다면 기본 ~/.local/share 대신 해당 경로입니다.

```sh
gjs -m ~/.local/share/gnome-shell/extensions/usagescope-gnome@ijustsea.github.io/claude/setup.js --preview
gjs -m ~/.local/share/gnome-shell/extensions/usagescope-gnome@ijustsea.github.io/claude/setup.js --apply
```

미리보기를 확인한 뒤 적용하세요. 설정 파일의 변경·백업·복원 정책은 helper의 `--help`로 확인할 수 있습니다.

백업에는 기존 설정의 민감값이 포함될 수 있으므로 사용자 전용 디렉터리·파일 권한으로 보관합니다. 업로드하거나 패키지에 포함하지 않습니다.

```sh
gjs -m ~/.local/share/gnome-shell/extensions/usagescope-gnome@ijustsea.github.io/claude/setup.js --restore
```

임의의 기존 셸 명령을 자동으로 감싸지 않습니다. 기존 명령이 단일 절대 실행 파일인 경우만 안전하게 argv로 연결하며, 그 외에는 자동 적용을 거부하고 수동 통합 안내를 제공합니다. 전달 실패가 기존 렌더러 stdout을 바꾸지 않게 합니다. 기존 렌더러에는 출력 크기와 실행 기한 제한이 적용됩니다.

상태줄이 실행되고 사용량이 보고된 후 값이 나타납니다. 여러 세션이 있으면 메뉴에서 하나를 선택합니다. 세션 ID는 계정 ID가 아니며 여러 세션 사용률을 합산하지 않습니다.

## 표시 의미와 한계

- 잔여율은 메시지 수·토큰 수·API 잔액이 아닙니다.
- ~ 표시는 과거값 또는 서버 최신성이 미확인인 값입니다.
- 마지막 수신 시각은 서버 측정 시각이 아닙니다. Claude를 종료하면 독립 재조회하지 않습니다.
- 만료된 창은 자동으로 100%로 바꾸지 않고 새 확인을 요구합니다.
- 실패 시 과거 정상값을 보존하지만 현재값으로 표시하지 않습니다.
- Claude 계정 식별 정보는 statusline에 없어 계정 변경의 자동 검출을 보장하지 않습니다.
- Codex App Server 계약은 실험적이며 지원 버전별 검증이 필요합니다.
- Claude desktop 알림 및 추정 초기화 알림은 제공하지 않습니다. Codex만 새 정상 조회의 임계값 통과에 알림을 제공합니다.
- 로그아웃 후 런타임 스냅샷은 사라집니다.
- 전체 메모리·CPU·전력에서 원본보다 가볍다는 비교 성능 주장은 아직 하지 않습니다.

## 추가 검증

```sh
npm run test:shell
gjs -m scripts/probe-codex.mjs /absolute/path/to/codex
```

첫 명령은 별도 D-Bus·설정·런타임 디렉터리의 headless GNOME에서 패키지를 검사합니다. 두 번째는 명시적으로 실제 계정의 한도만 읽습니다. 로그인·모델 작업을 생성하지 않지만 CLI가 자신의 인증을 갱신할 수 있고 공급자 조회 요청은 발생합니다.

보안 경계와 실제 검사 결과는 [SECURITY.md](SECURITY.md), 작업 기록은 [docs/implementation-progress.md](docs/implementation-progress.md)를 참고하세요.

## 근거

- [GNOME TypeScript](https://gjs.guide/extensions/development/typescript.html)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Claude statusline](https://code.claude.com/docs/en/statusline)
- [XDG runtime directory](https://specifications.freedesktop.org/basedir/latest/)

MIT. 참고 프로젝트의 아이디어를 조사했으며 현재 코드는 독립 구현입니다.
