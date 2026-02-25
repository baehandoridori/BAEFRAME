# BAEFRAME Real-time Collaboration Refactoring Guide

## 1. Context & Goal
- **Environment:** 모든 팀원이 동일한 로컬 네트워크(LAN) 및 같은 물리적 공간에 있음.
- **Storage:** 동일한 구글 드라이브 로컬 동기화 폴더를 절대 경로로 공유하여 사용.
- **Security:** 완전한 내부망이므로 인증, WSS(TLS) 등 보안 로직은 전혀 필요 없음. 가장 가벼운 Raw 통신 권장.
- **Goal:** Figma 스타일의 실시간 협업 기능 구현.
  1. 실시간 다중 마우스 커서 (부드러운 움직임 유지)
  2. 상단 바 접속자 표시 (Presence)
  3. 실시간 드로잉 및 파일 수정 동기화

## 2. Problem Diagnosis
현재 `.collab` 파일을 이용한 파일 기반 실시간 동기화는 구글 드라이브 동기화 딜레이와 디스크 I/O 충돌을 유발하여 실시간 커서 구현이 불가능함. 또한 mDNS를 통한 Peer 탐색은 Windows 방화벽 및 라우터 설정 등으로 인해 실패 확률이 높아 매우 불안정함.

## 3. Target Architecture: "IP Drop" + LAN WebSocket
mDNS와 파일 기반 실시간 폴링을 전면 폐기하고, 구글 드라이브를 활용한 "IP Drop" 방식과 "WebSocket" 기반 인메모리 동기화로 아키텍처를 완전히 변경한다.

### Step 1: Host-Client Discovery (Bypass mDNS)
- **Host (방장):** 특정 프로젝트를 처음 여는 사용자가 Host가 됨. Electron `main` 프로세스에서 `ws` 패키지를 사용해 WebSocket 서버(예: 포트 12345)를 구동함.
- **IP Drop:** Host는 자신의 실제 물리적 로컬 IPv4 주소를 찾은 뒤(가상 어댑터 필터링 필수), 구글 드라이브 공유 폴더 프로젝트 경로에 `[프로젝트명].session.json` 파일을 생성하여 `{ "hostIp": "192.168.X.X", "port": 12345 }`를 기록함.
- **Client (참여자):** 다른 사용자가 프로젝트를 열 때 `session.json`이 존재하면, 해당 파일에 적힌 IP와 포트로 WebSocket Client 연결을 시도함. 연결에 실패하거나 파일이 없으면 본인이 Host가 됨.

### Step 2: Real-time Communication (Remove File Syncing)
- 기존의 파일 읽기/쓰기를 통한 실시간 동기화 로직(`chokidar` 등 파일 감시 로직 포함)을 **과감히 완전히 삭제**함.
- 휘발성 데이터(커서, 접속자) 및 편집 상태(드로잉, 코멘트)는 **오직 WebSocket 메시지(JSON)**로만 Pub/Sub 형태로 브로드캐스트함.
  - `JOIN` / `LEAVE`: 접속자 UI 업데이트.
  - `CURSOR_MOVE`: 마우스 좌표.
  - `STATE_UPDATE`: 드로잉, 코멘트, 파일 수정 등.

### Step 3: UI Implementation in Renderer
- **Presence:** `JOIN/LEAVE` 메시지를 수신하여 상단 바에 현재 접속 중인 유저의 아바타(`assets/avatars/`)와 이름을 렌더링.
- **Cursors:** 
  - `mousemove` 이벤트를 Throttling(예: 30ms, 약 30fps)하여 좌표를 전송. (화면 크기 차이를 대비해 기준 영역(예: Video Player)에 대한 상대 비율 `0.0 ~ 1.0` 좌표 사용)
  - 타인의 커서는 `position: absolute` DOM 오버레이 요소로 렌더링하며, `transition: transform 0.1s linear` CSS를 적용해 부드럽게 움직이도록 함.

### Step 4: Data Persistence (파일 저장 주체 일원화)
- 여러 명이 동시에 구글 드라이브 파일(`.collab` 등)에 쓰기를 하면 충돌 파일이 생성됨.
- 따라서 **구글 드라이브의 프로젝트 데이터 파일 저장(Write)은 오직 Host 1명만 수행**하도록 역할을 분리함.
- 클라이언트의 상태 변경은 WebSocket을 통해 즉시 화면에 반영(인메모리 업데이트)되며, Host가 이를 모아 Debounce를 적용하거나 사용자의 명시적 '저장' 시에만 파일 I/O를 발생시킴.

## 4. Execution Rules for Claude
1. `main/p2p-service.js`, `main/lan-discovery.js`, `renderer/scripts/modules/collaboration-manager.js` 등 관련 코드를 깊이 분석하라.
2. 위 아키텍처에 맞게 불필요한 mDNS 로직과 파일 폴링 로직을 지우고, Step 1부터 순차적으로 구현하라. (`ws` 패키지가 없다면 설치)
3. 한 번에 모든 코드를 출력하지 말고, Step별로 리팩토링을 진행한 뒤 사용자에게 테스트를 요청하고 통과하면 다음 Step으로 넘어가라.