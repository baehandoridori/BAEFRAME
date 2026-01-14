<div align="center">

<img src="renderer/assets/logo/baeframe.png" alt="BAEFRAME Logo" width="120" />

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

<!-- 메인 스크린샷 위치 -->
<!-- ![BAEFRAME 메인 화면](screenshots/main.png) -->

---

## 🎬 이게 뭔데?

**BAEFRAME**은 [스튜디오 장삐쭈](https://www.youtube.com/@Jangbbijju) 팀 내부에서 사용하는 영상 리뷰 도구입니다.

> **BF** = **B**ae**F**rame = **B**est **F**riend
> 작업자들의 베스트 프렌드가 되고 싶은 마음으로 만들었습니다.

[Monday.com](https://monday.com)의 버전 관리 + [SyncSketch](https://syncsketch.com)의 프레임 스케치 + [Frame.io](https://frame.io)의 리뷰 시스템을 합쳐서,
**"씨바 까짓거 그냥 내가 만들고만다"** 라는 마음으로 3주 만에 뚝딱 만들었습니다.

---

## 🤯 왜 만들었냐면

### 기존의 고통

```
😵 슬랙에서 리뷰할 때...

1. 영상 업로드
2. 스레드에 타임코드 적기
3. 스크린샷 찍어서 붙이기
4. 그림판에서 표시하고 다시 붙이기
5. "이 장면 어디요?" "무슨 의도였죠?"
6. 자리에서 일어나서 직접 가서 설명
7. 반복...

📁 스레드 지옥
├── 영상1_v1 스레드
│   └── 피드백 50개 (섞여있음)
├── 영상1_v2 스레드
│   └── 피드백 30개 (또 섞여있음)
└── 어제 올린 영상 스레드 (어딨더라...)
```

### 이제는

```
✨ BAEFRAME으로 리뷰할 때

1. 영상 열기
2. 프레임에서 바로 댓글 + 그림
3. 링크 복사 → 슬랙에 붙여넣기
4. 끝!

📄 단일 .bframe 파일
└── 모든 리뷰 데이터가 여기에
    ├── 댓글 + 답글
    ├── 그리기 레이어
    ├── 하이라이트 구간
    └── Google Drive에서 자동 동기화
```

**리뷰 왕복 시간: 수 시간 → 수 분**

---

## ✨ 주요 기능

### 🎯 프레임 정밀 탐색

mpv 플레이어 기반으로 **정확한 프레임 단위** 탐색이 가능합니다.

| 키 | 동작 |
|:--:|------|
| `Space` | 재생/일시정지 |
| `←` `→` | 1프레임 이동 |
| `Shift+←` `→` | 10프레임 이동 |
| `Home` / `End` | 처음/끝으로 |

#### 구간 반복 (Loop)

| 키 | 동작 |
|:--:|------|
| `I` | 시작점(In) 설정 |
| `O` | 종료점(Out) 설정 |
| `L` | 구간 반복 토글 |

---

### 💬 댓글 & 마커

영상 위 원하는 위치에 **댓글 마커**를 찍어 피드백을 남깁니다.

<!-- 댓글 기능 스크린샷 위치 -->
<!-- ![댓글 & 마커](screenshots/comments.png) -->

#### 마커로 할 수 있는 것들

| 기능 | 설명 |
|------|------|
| **마커 찍기** | `C` 키 → 영상 클릭 → 댓글 입력 |
| **이미지 첨부** | 댓글에 스크린샷/이미지 붙여넣기 |
| **마커 이동** | 드래그해서 위치 변경 |
| **구간 늘리기** | 마커 양 끝을 드래그 |
| **스냅** | `Shift` 누르면서 드래그 → 재생바/시작점/끝점에 스냅 |
| **답글 달기** | 마커 더블클릭 → 스레드 팝업 |
| **완료 표시** | 체크 버튼 → 초록색으로 변경 + 취소선 |

#### 댓글 네비게이션

| 키 | 동작 |
|:--:|------|
| `Shift+←` | 이전 댓글로 이동 |
| `Shift+→` | 다음 댓글로 이동 |

---

### ✏️ 그리기 도구

프레임 위에 직접 그려서 피드백합니다. **"여기 이렇게 해주세요"**를 그림으로 바로 보여줄 수 있습니다.

<!-- 그리기 기능 스크린샷 위치 -->
<!-- ![그리기 도구](screenshots/drawing.png) -->

#### 도구 종류

| 도구 | 설명 |
|------|------|
| 🖊️ **펜** | 자유롭게 그리기 |
| ➡️ **화살표** | 방향/위치 표시 |
| 🧹 **지우개** | 부분 삭제 |

#### 그리기 설정

- **색상**: 빨강 / 노랑 / 초록 / 파랑 / 회색 / 흰색
- **굵기**: 1~50px
- **불투명도**: 0~100%

#### 레이어 & 키프레임

| 기능 | 단축키 | 설명 |
|------|:------:|------|
| 키프레임 추가 | `F7` | 현재 프레임에 빈 키프레임 |
| 키프레임 복사 | `F6` | 이전 내용 복사해서 추가 |
| 키프레임 삭제 | `Shift+3` | 현재 키프레임 삭제 |
| 이전 키프레임 | `A` | 이전 키프레임으로 점프 |
| 다음 키프레임 | `D` | 다음 키프레임으로 점프 |

#### 어니언 스킨 (Onion Skin)

애니메이터라면 익숙한 그 기능! 이전/다음 프레임이 반투명하게 보입니다.

| 키 | 동작 |
|:--:|------|
| `1` | 어니언 스킨 토글 |

- 이전 프레임 2개 + 다음 프레임 1개 (기본값)
- 투명도 조절 가능

---

### 🎨 하이라이트

특정 구간을 색상으로 표시합니다. "여기 중요!", "여기 수정 필요" 등을 한눈에.

| 키 | 동작 |
|:--:|------|
| `H` | 현재 위치에 하이라이트 추가 |
| `Alt+←` | 이전 하이라이트로 이동 |
| `Alt+→` | 다음 하이라이트로 이동 |

- 6가지 색상 (빨강/노랑/초록/파랑/회색/흰색)
- 드래그로 구간 조정
- `Shift` + 드래그로 스냅

---

### 📊 타임라인

<!-- 타임라인 스크린샷 위치 -->
<!-- ![타임라인](screenshots/timeline.png) -->

| 기능 | 조작 |
|------|------|
| **줌 인/아웃** | `Ctrl+휠` 또는 줌 슬라이더 |
| **가로 스크롤** | `Shift+휠` |
| **전체 보기** | `\` 키 |
| **플레이헤드 드래그** | 가장자리에서 자동 스크롤 |

타임라인에서 한눈에 확인:
- 📍 댓글 마커 위치
- 🎨 그리기 키프레임
- 🟡 하이라이트 구간
- 🔁 구간 반복 범위

---

### 🔀 스플릿 뷰 (Split View)

두 영상을 나란히 비교합니다. 버전 비교할 때 유용!

- 동기화 재생 가능
- 각각 독립적인 마커/그리기

---

### 📁 버전 관리

같은 폴더의 버전 파일들을 자동으로 인식합니다.

```
shot_001_v1.mp4  ← 자동 감지
shot_001_v2.mp4  ← 자동 감지
shot_001_v3.mp4  ← 현재 열린 파일
```

드롭다운에서 버전 선택하면 바로 전환!

---

### 🔗 링크 공유

**Google Drive를 서버처럼 사용**합니다. 별도 서버 없이!

```
1. "링크 복사" 버튼 클릭
2. 슬랙에 붙여넣기
3. 팀원이 클릭하면 → 앱 자동 실행 + 파일 로드
```

#### baeframe:// 프로토콜

Windows에 자동 등록되어 슬랙에서 링크 클릭 → 앱으로 바로 열립니다.

#### 웹 뷰어

앱 설치 없이 브라우저에서 바로 확인: [baeframe.vercel.app](https://baeframe.vercel.app)

---

### 🎭 사용자별 테마

로그인한 사용자 이름에 따라 **테마 색상**이 바뀝니다.

| 사용자 | 테마 |
|--------|------|
| 윤성원 | 💙 파란색 |
| 허혜원/모몽가 | 💗 핑크 |
| 한솔 | ❤️ 빨간색 |
| 기본 | 💛 노란색 |

특정 사용자는 **고유 캐릭터 아바타**도 표시됩니다!

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

## 🧠 기술적인 잔머리들

### Google Drive = 서버

별도 서버 구축 없이 **Google Drive를 동기화 스토리지**로 활용합니다.

```
팀원 A의 PC                    팀원 B의 PC
    │                              │
    └── G:\공유폴더\              └── G:\공유폴더\
        └── shot_001.bframe ←────→ └── shot_001.bframe
                    │
                    └── Google Drive 동기화
```

- `.bframe` 파일이 Google Drive 폴더에 있으면 자동 동기화
- 별도 로그인 없이 팀 전체가 같은 데이터 공유
- 오프라인에서도 로컬 파일로 작업 가능

### baeframe:// 프로토콜

Windows 레지스트리에 자동 등록되어 **원클릭 실행**이 가능합니다.

```
슬랙에서 링크 클릭
    ↓
baeframe://G:/프로젝트/shot_001.mp4
    ↓
앱 자동 실행 + 파일 로드
```

### Slack 사용자 자동 감지

Windows 레지스트리에서 **Slack 로그인 정보**를 읽어와 자동으로 사용자 이름을 설정합니다.

```
우선순위:
1. 저장된 설정
2. Slack 정보 (레지스트리)
3. Windows 사용자 이름
4. 수동 입력
```

### 자동 저장

- 댓글/그리기/하이라이트 변경 시 **자동 저장**
- 마커 위치 이동해도 자동 저장
- 별도 저장 버튼 안 눌러도 됨

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
