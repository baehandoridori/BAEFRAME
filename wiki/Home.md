<p align="center">
  <img src="https://raw.githubusercontent.com/baehandoridori/BAEFRAME/main/BFRAME_PNG.png" alt="BAEFRAME Logo" width="400"/>
</p>

<h1 align="center">BAEFRAME</h1>

<p align="center">
  <strong>애니메이션 스튜디오를 위한 비디오 리뷰 & 피드백 도구</strong><br/>
  <em>Frame.io의 핵심 기능을 로컬 환경에서, 우리 팀에 딱 맞게</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-28.0.0-47848F?style=for-the-badge&logo=electron&logoColor=white"/>
  <img src="https://img.shields.io/badge/mpv-Player-6C50FF?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/Status-Production-brightgreen?style=for-the-badge"/>
</p>

<p align="center">
  <a href="https://baeframe.vercel.app">Web Viewer</a> ·
  <a href="https://github.com/baehandoridori/BAEFRAME/wiki/Getting-Started">시작하기</a> ·
  <a href="https://github.com/baehandoridori/BAEFRAME/wiki/Features">기능 상세</a>
</p>

---

## BAEFRAME이란?

**BAEFRAME**은 [스튜디오 장삐쭈](https://www.youtube.com/@Jangbbijju)에서 자체 개발한 **영상 리뷰 전용 도구**입니다.

> *"자리에서 일어나지 않아도, 화면을 직접 보여주며 설명하는 것처럼"*

### 해결하는 문제

| 기존 방식 | BAEFRAME |
|-----------|----------|
| 자리까지 가서 말로 설명 → 집중도 끊김 | **화면에 직접 그리며 설명** |
| Frame.io 등 유료 도구의 높은 비용 | **자체 개발로 무료** |
| 범용 도구의 불편한 워크플로우 | **우리 팀에 최적화** |
| 피드백 위치를 텍스트로 설명 | **타임라인 마커로 정확한 위치** |

---

## 핵심 기능

### ◆ 타임라인 마커

영상의 특정 프레임에 마커를 찍고 코멘트를 남깁니다.

```
▶ ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
         ●      ●           ●    ●
      00:05:12  00:12:30   00:28:45  00:35:20
```

### ◆ 화면 위 스케치

영상 위에 직접 그림을 그려 수정 포인트를 명확하게 전달합니다.

- **펜 도구**: 자유 드로잉
- **화살표**: 방향 표시
- **색상 팔레트**: 빨강, 노랑, 초록, 파랑, 흰색

### ◆ 원클릭 공유

`baeframe://` 프로토콜로 Slack에서 링크 클릭만으로 바로 해당 영상으로 이동합니다.

```
📎 EP01_shot_015_v2 피드백 요청
   baeframe://G:/프로젝트/EP01/shot_015_v2.mp4

   → 클릭하면 BAEFRAME이 자동 실행!
```

### ◆ 웹 뷰어 & 모바일

앱 설치 없이 브라우저에서 바로 확인 가능합니다.

**[baeframe.vercel.app](https://baeframe.vercel.app)** → Google Drive 연동

---

## 빠른 시작

### 데스크톱 앱

```bash
git clone https://github.com/baehandoridori/BAEFRAME.git
cd BAEFRAME
npm install
npm start
```

### 웹 뷰어

1. [baeframe.vercel.app](https://baeframe.vercel.app) 접속
2. Google Drive 영상 URL 입력
3. 리뷰 시작

---

## 워크플로우

### 원격 피드백

```
애니메이터                         감독
    │                               │
    │  영상 출력 완료                │
    │  BAEFRAME으로 열기             │
    │  "웹 링크 복사"                │
    │                               │
    │ ──────── Slack 공유 ────────▶ │
    │                               │
    │                         링크 클릭
    │                    웹/앱에서 영상 확인
    │                    마커 + 스케치로 피드백
    │                               │
    │ ◀─────── Slack 알림 ───────── │
    │                               │
    │  피드백 확인                   │
    │  수정 작업                     │
```

### 현장 피드백

1. 영상 재생하며 확인
2. 문제 지점에서 일시정지
3. `D` 키로 그리기 모드
4. 화면에 직접 마킹하며 설명
5. 자동 저장 → 이후에도 참조 가능

---

## 비교

| 항목 | Frame.io | SyncSketch | BAEFRAME |
|------|:--------:|:----------:|:--------:|
| 가격 | 유료 | 유료 | **무료** |
| 커스터마이징 | 불가 | 불가 | **자유롭게 확장** |
| 로컬 파일 | 업로드 필요 | 업로드 필요 | **로컬에서 바로** |
| 대용량 파일 | 업로드 시간 | 업로드 시간 | **즉시 재생** |
| Slack 연동 | 제한적 | 제한적 | **원클릭 공유** |

### BAEFRAME만의 강점

- **실제 검증**: 스튜디오 장삐쭈 15~20명이 실사용 중
- **지속적 개선**: 팀 피드백을 바로 반영
- **서버리스**: Google Drive 기반으로 별도 서버 불필요
- **모바일 지원**: 웹 뷰어로 어디서든 확인

---

## 기술 스택

| 구성 요소 | 기술 |
|-----------|------|
| 앱 프레임워크 | Electron 28+ |
| 비디오 플레이어 | mpv (MOV/PNG 시퀀스 지원) |
| UI | Vanilla JS + Canvas API |
| 데이터 저장 | `.bframe` JSON |
| 클라우드 | Google Drive API |
| 웹 뷰어 | Vercel |

---

## 문서

| 페이지 | 설명 |
|--------|------|
| [**시작하기**](Getting-Started) | 설치 방법, 기본 사용법, 단축키 |
| [**기능 상세**](Features) | 모든 기능 상세 설명 |
| [**웹 뷰어**](Web-Viewer) | 웹 뷰어 사용법, Google Drive 연동 |
| [**아키텍처**](Architecture) | 기술 스택, 동작 원리, 폴더 구조 |

---

## 만든 사람들

<p align="center">
  <strong>스튜디오 장삐쭈</strong><br/>
  애니메이션 제작 팀 내부 도구로 개발
</p>

---

<p align="center">
  <em>더 나은 애니메이션 제작을 위해, BAEFRAME과 함께하세요.</em>
</p>
