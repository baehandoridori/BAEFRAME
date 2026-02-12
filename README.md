<div align="center">

<img src="renderer/assets/logo/baeframe.png" alt="BAEFRAME Logo" width="480" />

# BAEFRAME

**애니메이션 스튜디오를 위한 비디오 리뷰 & 피드백 도구**

*프레임 단위로 정확하게. 그림으로 직관적으로. 링크 하나로 간편하게.*

[![Electron](https://img.shields.io/badge/Electron-28.0-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white)](https://github.com/baehandoridori/BAEFRAME)
[![License](https://img.shields.io/badge/License-Internal-orange?style=flat-square)](https://github.com/baehandoridori/BAEFRAME)
[![Commits](https://img.shields.io/badge/Commits-255+-brightgreen?style=flat-square)](https://github.com/baehandoridori/BAEFRAME/commits)

[**웹 뷰어**](https://baeframe.vercel.app) · [**Wiki**](https://github.com/baehandoridori/BAEFRAME/wiki) · [**Issues**](https://github.com/baehandoridori/BAEFRAME/issues)

</div>

---

<div align="center">
<img src="mockups/screenshots/01-main-overview.png" alt="BAEFRAME 메인 화면" width="900" />

*메인 인터페이스: 비디오 뷰어 + 타임라인 + 댓글 패널*
</div>

---

## 🎬 이게 뭔데?

**BAEFRAME**은 [스튜디오 장삐쭈](https://www.youtube.com/@Jangbbijju) 팀 내부에서 사용하는 영상 리뷰 도구입니다.

> **BF** = **B**ae**F**rame = **B**est **F**riend
> 작업자들의 베스트 프렌드가 되고 싶은 마음으로 만들었습니다.

[Monday.com](https://monday.com)의 버전 관리 + [SyncSketch](https://syncsketch.com)의 프레임 스케치 + [Frame.io](https://frame.io)의 리뷰 시스템을 합쳐서,
**"씨바 까짓거 그냥 내가 만들고만다"** 라는 마음으로 3주 만에 뚝딱 만들었습니다.

---

## 🤯 왜 만들었냐면

<table>
<tr>
<td width="50%" valign="top">

### 😵 기존의 고통

```mermaid
flowchart TD
    A[🎬 영상 업로드] --> B[💬 스레드에 타임코드 적기]
    B --> C[📸 스크린샷 찍기]
    C --> D[🎨 그림판에서 표시]
    D --> E[📋 다시 붙여넣기]
    E --> F{이해됨?}
    F -->|❌| G[🚶 자리에서 일어남]
    G --> H[🗣️ 직접 가서 설명]
    H --> F
    F -->|✅| I[다음 피드백...]
    I --> B

    style A fill:#ff6b6b,color:#fff
    style G fill:#ff6b6b,color:#fff
    style H fill:#ff6b6b,color:#fff
```

**슬랙 스레드 지옥** 🔥
- 영상1_v1 스레드 → 피드백 50개 (섞여있음)
- 영상1_v2 스레드 → 피드백 30개 (또 섞여있음)
- 어제 올린 영상 스레드 → 어딨더라...?

</td>
<td width="50%" valign="top">

### ✨ 이제는

```mermaid
flowchart TD
    A[🎬 영상 열기] --> B[💬 프레임에서 바로 댓글 + 그림]
    B --> C[🔗 링크 복사]
    C --> D[📤 슬랙에 붙여넣기]
    D --> E[✅ 끝!]

    style A fill:#51cf66,color:#fff
    style B fill:#51cf66,color:#fff
    style C fill:#51cf66,color:#fff
    style D fill:#51cf66,color:#fff
    style E fill:#51cf66,color:#fff
```

**단일 `.bframe` 파일** 📄
- ✅ 댓글 + 답글
- ✅ 그리기 레이어
- ✅ 하이라이트 구간
- ✅ Google Drive 자동 동기화

</td>
</tr>
</table>

<div align="center">

### ⏱️ 리뷰 왕복 시간

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'pie1': '#ff6b6b', 'pie2': '#51cf66'}}}%%
pie showData
    "기존 (수 시간)" : 180
    "BAEFRAME (수 분)" : 10
```

| | 기존 방식 | BAEFRAME |
|:--:|:--:|:--:|
| **시간** | 😵 수 시간 | ✨ 수 분 |
| **앱 전환** | 슬랙 ↔ 그림판 ↔ 캡처도구 | 하나로 끝 |
| **자리 이탈** | 설명하러 직접 이동 | 링크 하나로 공유 |
| **피드백 찾기** | 스레드 뒤지기 | 타임라인에서 한눈에 |

</div>

---

## ✨ 주요 기능

<!-- 기능 한눈에 보기 -->
<div align="center">

| 🎬 재생 | 💬 댓글 | ✏️ 그리기 | 🎨 하이라이트 |
|:--:|:--:|:--:|:--:|
| 프레임 단위 탐색 | 마커로 피드백 | 영상 위에 직접 그리기 | 구간 색상 표시 |
| 구간 반복 (I/O/L) | 이미지 첨부 | 어니언 스킨 | 드래그로 조정 |
| mpv 기반 정밀 제어 | 스레드 답글 | 다중 레이어 | Shift로 스냅 |

| 📊 타임라인 | 🔀 스플릿 뷰 | 📁 버전 관리 | 🔗 공유 |
|:--:|:--:|:--:|:--:|
| 줌/스크롤 | 두 영상 비교 | 자동 버전 감지 | 링크 복사 → 슬랙 |
| 마커/키프레임 표시 | 동기화 재생 | 드롭다운 전환 | 웹 뷰어 지원 |
| 플레이헤드 드래그 | 독립 마커/그리기 | _v1, _v2, _re... | baeframe:// 프로토콜 |

</div>

---

<details>
<summary><b>🎬 재생 & 탐색</b> - 프레임 단위 정밀 제어</summary>

mpv 플레이어 기반으로 **정확한 프레임 단위** 탐색이 가능합니다.

| 키 | 동작 |
|:--:|------|
| `Space` | 재생/일시정지 |
| `←` `→` | 1프레임 이동 |
| `Shift+←` `→` | 10프레임 이동 |
| `Home` / `End` | 처음/끝으로 |
| `I` | 시작점(In) 설정 |
| `O` | 종료점(Out) 설정 |
| `L` | 구간 반복 토글 |

</details>

<details>
<summary><b>💬 댓글 & 마커</b> - 프레임에 피드백 남기기</summary>

영상 위 원하는 위치에 **댓글 마커**를 찍어 피드백을 남깁니다.

| 기능 | 설명 |
|------|------|
| **마커 찍기** | `C` 키 → 영상 클릭 → 댓글 입력 |
| **이미지 첨부** | 댓글에 스크린샷/이미지 붙여넣기 (Ctrl+V) |
| **마커 이동** | 드래그해서 위치 변경 |
| **구간 조정** | 마커 양 끝을 드래그 (시작/끝 프레임) |
| **스냅** | `Shift` + 드래그 → 재생바/시작점/끝점/하이라이트에 스냅 |
| **답글 달기** | 마커 더블클릭 → 스레드 팝업 |
| **완료 표시** | 체크 버튼 → 초록색 + 취소선 |
| **네비게이션** | `Shift+←/→` 이전/다음 댓글로 이동 |

<div align="center">
<img src="mockups/screenshots/02-comment-resolved.png" alt="댓글 해결 상태" width="700" />

*미해결(주황) vs 해결됨(초록) 상태 비교*
</div>

</details>

<details>
<summary><b>✏️ 그리기 도구</b> - 영상 위에 직접 스케치</summary>

프레임 위에 직접 그려서 피드백합니다. **"여기 이렇게 해주세요"**를 그림으로!

**도구**: 🖊️ 펜 · ➡️ 화살표 · 🧹 지우개

**설정**: 색상 6가지 · 굵기 1~50px · 불투명도 0~100%

| 기능 | 단축키 |
|------|:------:|
| 그리기 모드 | `D` |
| 어니언 스킨 | `1` |
| 키프레임 추가 | `F7` (빈) / `F6` (복사) |
| 키프레임 삭제 | `Shift+3` |
| 키프레임 이동 | `A` / `D` |
| 실행취소/다시 | `Ctrl+Z` / `Ctrl+Y` |

**어니언 스킨**: 이전 2프레임 + 다음 1프레임 반투명 표시

</details>

<details>
<summary><b>🎨 하이라이트</b> - 구간 색상 표시</summary>

특정 구간을 색상으로 표시합니다. "여기 중요!", "여기 수정 필요"

| 키 | 동작 |
|:--:|------|
| `H` | 현재 위치에 하이라이트 추가 |
| `Alt+←` | 이전 하이라이트로 이동 |
| `Alt+→` | 다음 하이라이트로 이동 |

- 6가지 색상 (빨강/노랑/초록/파랑/회색/흰색)
- 드래그로 구간 조정
- `Shift` + 드래그로 스냅

<div align="center">
<img src="mockups/screenshots/03-highlight.png" alt="하이라이트 기능" width="700" />

*타임라인에서 색상별 구간 표시 + 드래그로 조정*
</div>

</details>

<details>
<summary><b>📊 타임라인 & 기타</b></summary>

**타임라인**
| 기능 | 조작 |
|------|------|
| 줌 | `Ctrl+휠` 또는 슬라이더 |
| 가로 스크롤 | `Shift+휠` |
| 전체 보기 | `\` 키 |

**스플릿 뷰**: 두 영상 나란히 비교, 동기화 재생

**버전 관리**: 같은 폴더의 `_v1`, `_v2`, `_re` 등 자동 감지 → 드롭다운 전환

**사용자 테마**: 이름별 테마 색상 + 고유 아바타
| 사용자 | 테마 |
|--------|------|
| 윤성원 | 💙 파란색 |
| 허혜원/모몽가 | 💗 핑크 |
| 한솔 | ❤️ 빨간색 |
| 기본 | 💛 노란색 |

</details>

---

## 🛠️ 설치

### 요구사항

- Windows 10/11
- Node.js 18+
- Git

### 설치 방법

```bash
# 1. 저장소 클론
git clone https://github.com/baehandoridori/BAEFRAME.git
cd BAEFRAME

# 2. 의존성 설치
npm install

# 3. 실행
npm start
```

### 개발 모드

```bash
npm run dev  # DevTools 자동 열림
```

### 빌드

```bash
npm run build:installer  # Windows 설치 파일 생성
```

### Windows 11 우클릭 통합 (이슈 #88)

BAEFRAME를 영상 파일 우클릭으로 바로 열려면 통합 설치를 실행해야 합니다.

가장 쉬운 방법(프로그램처럼 실행):

```powershell
.\integration\installer\BAEFRAME-Integration-Setup.cmd
```

기본 정책은 **Win11 1차 우클릭(sparse) 우선**이며, 실패 시 자동으로 legacy(2차 메뉴)를 만들지 않습니다.

사내 인증서+정책까지 포함해 설치하려면(관리자 PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File .\integration\installer\run-integration-setup.ps1 -Provision
```

또는 CMD 런처 인자로 실행:

```cmd
.\integration\installer\BAEFRAME-Integration-Setup.cmd -Provision -UseSharePath -CertPath "\\server\share\certs\StudioJBBJ.BAEFRAME.Integration.cer"
```

공유 드라이브 프로필로 실행하려면:

```powershell
powershell -ExecutionPolicy Bypass -File .\integration\installer\run-integration-setup.ps1 -Provision -UseSharePath -CertPath "\\server\share\certs\StudioJBBJ.BAEFRAME.Integration.cer"
```

수동 실행:

```powershell
# 설치 (sparse-only 기본)
powershell -ExecutionPolicy Bypass -File .\integration\installer\install-integration.ps1 -AppPath "C:\BAEframe\BAEFRAME\dist\win-unpacked\BFRAME_alpha_v2.exe"

# 상태 확인
powershell -ExecutionPolicy Bypass -File .\integration\installer\detect-integration.ps1

# 제거
powershell -ExecutionPolicy Bypass -File .\integration\installer\uninstall-integration.ps1
```

legacy를 정말 써야 할 때만 fallback 허용:

```powershell
powershell -ExecutionPolicy Bypass -File .\integration\installer\install-integration.ps1 -AppPath "C:\path\to\BFRAME_alpha_v2.exe" -Mode Auto -EnableLegacyFallback
```

팀 전체 자동 적용은 개별 CMD 실행이 아니라 GPO/Intune/SCCM으로 위 프로비저닝 명령을 배포하는 방식을 권장합니다.

앱 내부에서는 설정 메뉴의 `Windows 통합 진단/복구` 버튼으로 동일한 설치기를 실행할 수 있습니다.

---

## ⌨️ 단축키 총정리

<details>
<summary><b>📹 재생 제어</b></summary>

| 키 | 기능 |
|:--:|------|
| `Space` | 재생/일시정지 |
| `←` `→` | 1프레임 이동 |
| `Shift+←` `→` | 10프레임 이동 |
| `Home` | 처음으로 |
| `End` | 끝으로 |
| `I` | 시작점 설정 |
| `O` | 종료점 설정 |
| `L` | 구간 반복 토글 |

</details>

<details>
<summary><b>💬 댓글 & 마커</b></summary>

| 키 | 기능 |
|:--:|------|
| `C` | 댓글 모드 토글 |
| `Shift+←` | 이전 댓글로 이동 |
| `Shift+→` | 다음 댓글로 이동 |

</details>

<details>
<summary><b>✏️ 그리기</b></summary>

| 키 | 기능 |
|:--:|------|
| `D` | 그리기 모드 토글 |
| `1` | 어니언 스킨 토글 |
| `F6` | 키프레임 추가 (복사) |
| `F7` | 빈 키프레임 추가 |
| `Shift+3` | 키프레임 삭제 |
| `A` / `D` | 이전/다음 키프레임 |
| `Ctrl+Z` | 실행 취소 |
| `Ctrl+Y` | 다시 실행 |

</details>

<details>
<summary><b>🎨 하이라이트</b></summary>

| 키 | 기능 |
|:--:|------|
| `H` | 하이라이트 추가 |
| `Alt+←` | 이전 하이라이트 |
| `Alt+→` | 다음 하이라이트 |

</details>

<details>
<summary><b>📊 타임라인 & 뷰</b></summary>

| 키 | 기능 |
|:--:|------|
| `Ctrl+휠` | 타임라인 줌 |
| `Shift+휠` | 가로 스크롤 |
| `\` | 전체 보기 |
| `F` | 전체화면 |
| `Shift+?` | 단축키 도움말 |

</details>

<details>
<summary><b>💾 파일</b></summary>

| 키 | 기능 |
|:--:|------|
| `Ctrl+O` | 파일 열기 |
| `Ctrl+S` | 저장 |
| `Ctrl+Shift+C` | 링크 복사 |

</details>

---

## 🧠 초천재 미스터배의 개쩌는 잔머리들

### 💡 Google Drive = 서버

서버 구축? 그런 거 없음. **Google Drive가 서버**입니다.

```mermaid
flowchart LR
    A[👨‍💻 팀원 A] --> D[(📁 Google Drive)]
    B[👩‍💻 팀원 B] --> D
    C[👨‍🎨 팀원 C] --> D
    D --> E[shot_001.bframe]

    style D fill:#4285f4,color:#fff
    style E fill:#34a853,color:#fff
```

- `.bframe` 파일이 Google Drive 폴더에 있으면 **자동 동기화**
- 별도 로그인/서버 비용 **제로**
- 오프라인에서도 로컬 파일로 작업 가능

### 🔗 baeframe:// 프로토콜

슬랙에서 **링크 클릭 한 번**이면 앱이 열립니다.

```mermaid
flowchart LR
    A[🔗 슬랙 링크 클릭] --> B[baeframe://경로/파일.mp4]
    B --> C[🚀 앱 자동 실행]
    C --> D[📂 파일 자동 로드]

    style A fill:#4a154b,color:#fff
    style D fill:#51cf66,color:#fff
```

Windows 레지스트리에 자동 등록 → 설정 필요 없음

### 💾 자동 저장

저장 버튼? 그런 거 안 눌러도 됩니다.

- 댓글 작성 → **자동 저장**
- 그리기 완료 → **자동 저장**
- 마커 이동 → **자동 저장**
- 하이라이트 추가 → **자동 저장**

---

## 🗂️ .bframe 파일 구조

```javascript
{
  bframeVersion: "2.0",
  videoFile: "shot_001.mp4",
  fps: 24,

  comments: {
    layers: [{
      markers: [{
        x: 0.5, y: 0.3,        // 영상 내 위치 (0~1)
        startFrame: 120,
        endFrame: 216,          // 4초 구간
        text: "손 위치 확인",
        author: "윤성원",
        resolved: false,
        replies: [...]
      }]
    }]
  },

  drawings: {
    layers: [{
      color: "#ff4757",
      keyframes: [...]
    }]
  },

  highlights: [{
    startTime: 5.2,
    endTime: 10.2,
    colorKey: "yellow"
  }]
}
```

---

## 🚀 향후 계획

- [ ] 📹 **영상 렌더링** - 댓글/그리기 포함된 영상 출력
- [ ] 💬 **Slack 내 재생** - 슬랙에서 바로 .bframe 영상 재생
- [ ] 🎨 **테마 커스터마이징** - 더 다양한 테마와 인터랙션
- [ ] ⚡ **성능 최적화** - 대용량 영상/많은 댓글 처리 개선

---

## 📊 개발 현황

| 항목 | 수치 |
|------|------|
| 개발 기간 | 2024.12.23 ~ (진행 중) |
| 커밋 수 | **255+** |
| 일일 평균 커밋 | **12개** |
| 개발자 | 1명 (배한솔) |

> 코딩 배우면서 만들었습니다.
> AHK로 자동화 스크립트 만들다가 "이거 앱으로 만들면 되겠는데?" 싶어서 시작.

---

## 👨‍💻 만든 사람

<table>
<tr>
<td align="center" width="150">
<img src="renderer/assets/avatars/hansol.png" width="80" alt="hansol" /><br />
<b>배한솔</b><br />
<sub>애니메이터 & 개발자</sub><br />
<sub>스튜디오 장삐쭈</sub>
</td>
</tr>
</table>

---

## 🙏 감사합니다

**스튜디오 장삐쭈** 팀원들에게 감사드립니다.

> 훌륭한 팀은 훌륭한 도구를 사용해야 합니다.

---

<div align="center">

**BAEFRAME** - 작업자들의 베스트 프렌드 🎬

[웹 뷰어](https://baeframe.vercel.app) · [GitHub](https://github.com/baehandoridori/BAEFRAME)

</div>




