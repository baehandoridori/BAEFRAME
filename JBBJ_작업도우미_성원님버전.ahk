; =================================================================================================
;  JBBJ 작업도우미 스크립트 (성원님 버전 - 간소화)
;  - 자동 한영전환, 파일주석시스템, AlwaysOnTop 기능 제거
;  - 목적: 파일공유, 타임트래커 등 핵심 기능만 제공
;  - 작성자: 
;  - 개요:
;    1) 메인 GUI / 각종 기능 구현
;    2) alias.ini 연동 (프로세스 별칭)
;    3) 상위 5개 사용 프로세스 목록 표시
;    4) 추가 실행 스크립트 (예: 익명칭찬, 피드백, 스네이크게임 등)
;
; =================================================================================================


; 1_8 업데이트 내역
; 숫자야구 게임 추가
; 파일공유 시스템 안정화 버전 체크
; 타임트래거 파일별로 저장


#Persistent
#NoEnv
#SingleInstance, Force
SendMode Input
SetWorkingDir %A_ScriptDir%
CoordMode, Mouse, Screen
SetBatchLines, -1

; 작업도우미 스크립트 예시
global g_WorkerFullPath
g_WorkerFullPath := A_ScriptFullPath

; =================================================================================================
; [ 전역 변수 선언 - 메인 기능용 + 타임 트래커용 ]
; =================================================================================================

; 마우스 툴팁 추가 - 
; 1. global 전역번수 H.. 선언
; 2. gui 컨트롤에 hwndH... 옵션 추가
; 3. WM_MOUSEMOVE 함수에 else if 추가, 마지막 선언부분 추가


; --- 메인 스크립트용 전역 ---
global fileSharePID := 0     ; 파일공유_JBBJ 체크박스용 PID (외부 스크립트 실행 시 PID)

global isMouseHookOn := false ; 자리비움 상태일때 마우스 훅을 키고 해제되면 끄는 방식을 위한 전역변수

; --- 추가: 옵션 토글을 위한 전역 체크박스 상태 ---
global FileShareChecked := 1     ; 파일공유_JBBJ 토글 (기본 On)
global checkPathToLink := 1      ; 경로→링크 자동변환 토글 (기본 On)
global isConvertingClipboard := false  ; 클립보드 변환 중 플래그 (무한루프 방지)
global g_LastOriginalPath := ""  ; Slack 하이퍼링크용 원본 경로
global g_LastJbbjLink := ""      ; Slack 하이퍼링크용 jbbj:// 링크
global g_LastWebUrl := ""        ; Slack 붙여넣기용 웹 뷰어 URL


; --- 추가: 툴팁용 전역 핸들 변수 (각 버튼에 대한 hWnd) ---
global HFileShare, HSvg, Hfeedback, HColor, HAp, Hsnake, H2048, Hmenuchcun, Hfortune, Hcutnumber, Hhelp, Hsetup, HPathToLink

; --- 타임 트래커(ProgressBar)용 전역 ---
global totalUsage := 0           ; 전체 누적 사용 시간(초)
global lastCheck := A_TickCount  ; 마지막 체크 시각(밀리초)
global lastActiveProcess := ""   ; 직전에 활성화되었던 프로세스명(소문자, .exe 제거)
global usageTimes := {}          ; 프로세스별 사용 시간 (딕셔너리)

global lastUserInputTick := A_TickCount  ; 마지막 사용자 입력 발생 시각(밀리초)
global lastMouseX := 0
global lastMouseY := 0
; AFK 판정 임계값(2분=120,000ms)
global AFK_THRESHOLD := 120000

; --- 별칭 매핑 딕셔너리 ---
global processAliases := {}      ; alias.ini에서 key=value를 읽어와 저장


; BS_PUSHLIKE(=0x1000) : 버튼을 "눌림 상태"로 표현할 수 있는 AHK 스타일
BS_PUSHLIKE := 0x1000

; =================================================================================================
; [ 경로 관련 전역 변수 - settings.ini에서 로드됨 ]
; =================================================================================================
global g_RootDir := ""           ; 스크립트 루트 폴더 (소스, 유틸, 게임 등의 부모)
global g_SettingsDir := ""       ; 설정 폴더 경로
global g_UtilsDir := ""          ; 유틸 폴더 경로
global g_GamesDir := ""          ; 게임 폴더 경로
global g_LibDir := ""            ; 라이브러리 폴더 경로

; settings.ini에서 읽어올 외부 경로들
global g_JBBJLibrary := ""       ; JBBJ 자료실 경로
global g_InstallFiles := ""      ; 설치 파일 경로
global g_SVGConverter := ""      ; SVG 변환기 경로
global g_AHKv2Path := ""         ; AutoHotkey v2 경로
global g_UserGuideURL := ""      ; 사용설명서 URL

; 경로 초기화
InitializePaths()

; 환경 변수 설정 (탐색기에서 %자료실% 등으로 접근 가능)
SetDrivePathVariables()

; jbbj:// 프로토콜 등록 확인 및 자동 등록
CheckAndRegisterProtocol()

; baeframe:// 프로토콜은 Electron 앱에서 직접 등록함 (app.setAsDefaultProtocolClient)
; 아래 함수는 더 이상 호출하지 않음 - Electron 내장 기능 사용
; CheckAndRegisterBaeframeProtocol()

; 클립보드 변환 핸들러 등록 (G:\ 경로 → jbbj:// 또는 baeframe:// 링크)
OnClipboardChange("ClipboardPathConverter")

; 종료 시 관련 스크립트도 함께 종료되도록 등록
OnExit("CleanupOnExit")

; =================================================================================================
; [트레이 아이콘 설정] - 메인 스크립트 로직 유지
; =================================================================================================

Menu, Tray, NoStandard
Menu, Tray, Add, 메인 창 열기, ShowMainGUI
Menu, Tray, Add, SVG 실행기, LaunchSVGConverter
Menu, Tray, Add, 컬러 픽커, LaunchColorPicker
Menu, Tray, Add, JBBJ 자료실, Setuphelp
Menu, Tray, Add, 익명으로 칭찬하기,Anonymous_praise
Menu, Tray, Add, 파일 리로드, ReloadDriveFiles
Menu, Tray, Add, 종료, ExitScript
Menu, Tray, Default, 메인 창 열기
Menu, Tray, Icon, Shell32.dll, 283
; =================================================================================================
; [GUI 생성 - 메인]
; =================================================================================================

; ┌────────────────────────────────────────────────────────────────────────────┐
; │ [Font 설정]                                                                │
; │   - Gui, Font, [옵션], [폰트이름]                                           │
; │   - 주요 옵션 예시:                                                         │
; │       S10    : 글씨 크기를 10pt 로 설정                                     │
; │       cRed   : 글씨 색상을 빨간색 (Hex 색상도 가능)                          │
; │       Italic : 글씨 이탤릭체 적용                                           │
; │       Bold   : 글씨를 굵게                                                  │
; │     예)  Gui, Font, S10 cBlue Italic, Verdana                              │
; │          -> 글씨 크기 10pt, 파란색, 이탤릭체, 폰트는 Verdana                  │
; │                                                                            │
; │ 참고로, “Gui, Font” 명령어는 이후에 추가되는 GUI 컨트롤(텍스트, 버튼 등)에     │
; │ 해당 폰트 스타일을 적용합니다.                                               │
; └────────────────────────────────────────────────────────────────────────────┘
Gui, Font, S14 CDefault, Verdana
Gui, Add, Text, x152 y9 w150 h20 , JBBJ 작업 도우미

Gui, Font, S8 cgray italic, Verdana
Gui, Add, Text, x302 y12 w100 h20 , (성원님 버전ㅋ)

Gui, Font, S9 cgray italic, Verdana
Gui, Add, Text, x12 y40 w340 h20 , 만든놈 = 한솔배



; ---------------------------------------------------------------------------------
; [새로운 GUI (탭 형태)]
; ---------------------------------------------------------------------------------
Gui, Font, S11 CDefault norm, Verdana
Gui, Add, Tab, x12 y69 w330 h160 vBasicTab, 파일공유JBBJ

; ---------------------------------------------------------------------------------
; [첫 번째 탭: 파일공유JBBJ]
; ---------------------------------------------------------------------------------
Gui, Tab, 1


Gui, Font, S8 CDefault norm, Verdana
Gui, Add, Text, x22 y130 w310 h40 , 공유할 파일을 선택한 후, Alt+F12 키를 누르면 뜨는 창에 공유 대상/채널을 선택합니다.`n복수의 파일을 선택하고 기능을 실행할 수 있습니다.
Gui, Font, S13 Cgreen Bold, Verdana
Gui, Add, Text, x22 y100 w150 h30 , 파일공유 JBBJ





; 탭 컨트롤 종료 (이후 나오는 컨트롤은 탭 영역 밖에 위치)
Gui, Tab



; --------------------------------------------------------------------------
; [★ 추가: "기능 토글"용 버튼(박스형) 그룹박스 및 버튼들 ]
; --------------------------------------------------------------------------
Gui, Font, S10 CDefault norm, Verdana
Gui, Add, GroupBox, x350 y69 w100 h75 , 기능 토글  ; 새 그룹박스
Gui, Font, cGreen

Gui, Font, S7, Verdana
; - [파일공유_JBBJ] 버튼
Gui, Add, Button, x360 y85 w80 h22 hwndHFileShare vBtnFileShare gToggleFileShare +%BS_PUSHLIKE%, 파일공유_JBBJ
; - [경로→링크] 버튼
Gui, Add, Button, x360 y110 w80 h22 hwndHPathToLink vBtnPathToLink gTogglePathToLink +%BS_PUSHLIKE%, 경로→링크


; --------------------------------------------------------------------------
; [시작 프로그램 고정 버튼]
; --------------------------------------------------------------------------
gui, font, S7, verdana
; - [시작 프로그램 고정 버튼]
gui, add, button, x12 y10 w110 h22 gLaunchVerupdate, 시작 프로그램으로 설정

; --------------------------------------------------------------------------
; [디버그 모드 버튼]
; --------------------------------------------------------------------------

gui, font, S7, verdana
; - [디버그 모드] 버튼
gui, add, button, x360 y15 w80 h22 gLaunchDebugMode, 디버그 모드

; --------------------------------------------------------------------------
; [아래 버튼들: 피드백 전송, 창 닫기, SVG변환기, 딴짓하기 ...]
; --------------------------------------------------------------------------
Gui, Font, S10, verdana

; ===========================================================================
; [하단 2개 버튼]
; ===========================================================================
Gui, Add, Button, x12 y589 w140 h40 hwndHfeedback gShowFeedbackWindow, 피드백 전송
Gui, Add, Button, x302 y589 w140 h40 gGuiClose, 창 닫기

; ===========================================================================
; [중단 3개 버튼]
; ===========================================================================
Gui, Add, Button, x12 y240 w130 h40 hwndHSvg gLaunchSVGConverter, SVG변환기
Gui, Add, Button, x162 y240 w130 h40 hwndHColor gLaunchColorPicker, 컬러 픽커
Gui, Add, Button, x312 y240 w130 h40 hwndHsetup gsetuphelp, JBBJ자료실


; ===========================================================================
; [중단 4개 버튼]
; ===========================================================================
Gui, Add, Button, x12 y280 w90 h40 , 개발중
Gui, Add, Button, x232 y280 w90 h40 hwndHcutnumber gCutnumberinsert, 컷넘버 기재
Gui, Add, Button, x332 y280 w110 h40 hwndHhelp gOpenUserGuide, 사용설명서
Gui, Add, Button, x112 y280 w110 h40 hwndHAp gAnonymous_praise , 익명으로 칭찬하기

; ===========================================================================
; [하단 그룹]
; ===========================================================================
Gui, Add, GroupBox, x12 y330 w140 h150 , 딴짓거리
Gui, Add, Button, x22 y350 w60 h40 hwndHsnake gPlaySnakeGame, 딴짓하기
Gui, Add, Button, x84 y350 w60 h40 hwndH2048 gPlaynumbergame, 딴짓하기2
Gui, Add, Button, x22 y390 w120 h40 hwndHmenuchcun gMenuchcun, 저녁메뉴 추천
Gui, Add, Button, x22 y430 w120 h40 hwndHfortune gShowFortune, 오늘의 운세

; ===========================================================================
; [버전표기 및 워터마크]
; ===========================================================================
Gui, Font, S8 CGRAY Italic, Verdana
Gui, Add, Text, x182 y634 w260 h20 +Right, Powered by__Bae

Gui, Font, S7 Cgray, Verdana
Gui, Add, Text, x400 y39 w90 h30 , ver_2_0

; =============================================================================
; [GUI 추가: 오늘 작업 시간 (Progress + Label + 상위 5프로그램)]
; =============================================================================
; -- 기존 너비: w280 -> 약간 줄임(w210)하여 오른쪽에 버튼 2개 배치 가능하게 조정 --
Gui, Add, GroupBox, x162 y330 w210 h150 , 오늘 작업 시간
; -- ProgressBar, Label 너비도 w260 -> w190으로 살짝 축소 --
Gui, Add, Progress, x172 y359 w190 h20 vTimeTrackerProgress Range0-28800
Gui, Add, Text,     x172 y380 w190 h20 vTimeTrackerLabel, 0:00:00 / 8:00:00
Gui, Add, Text,     x172 y400 w190 h60 vTopProgramLabel

; ★ 추가: '시간 초기화' 버튼, '그만 추적해' 버튼
;    - 그룹박스 오른쪽( x=372 )에 배치
;    - 높이는 30, 아래로 세로 간격 조금씩
Gui, Font, S8, Verdana
Gui, Add, Button, x372 y389 w70 h30 gResetTimeTracker, 시간 초기화
; ▼ 아래 버튼을 vBtnStopOrResumeTime / gToggleTrackingTime 으로 바꿉니다
Gui, Add, Button, x372 y429 w70 h30 vBtnStopOrResumeTime gToggleTrackingTime, 그만 추적해


; 메인 GUI 표시
Gui, Show, x572 y418 h664 w456, JBBJ 작업 도우미
Gui, Submit, NoHide

; GUI Show 직후에 추가
OnMessage(0x200, "WM_MOUSEMOVE")  ; 툴팁용 (WM_MOUSEMOVE)

; 경로→링크 버튼 초기 상태 설정 (기본 ON)
if (checkPathToLink = 1) {
    GuiControl, +Background00FF00, BtnPathToLink
    GuiControl,, BtnPathToLink, ON 경로→링크
}





; =====================================================================
; [ 추가 ] 구글 드라이브 로딩창 + 파일 체크
; =====================================================================
FakeLoadingDriveCheck()


; --------------------------------------------------------------------------
; [추가] 구글 드라이브 로딩 + 파일 존재 체크 (3~6초 랜덤)
; --------------------------------------------------------------------------
FakeLoadingDriveCheck() {
    global g_SettingsDir, LoadingPB, LoadingPercentText  ; GUI 컨트롤 변수는 global 선언 필요
    aliasFile := g_SettingsDir . "\alias.ini"
    classFile := g_SettingsDir . "\program_classes.txt"

    Random, randomDelay, 3000, 6000
    startTick := A_TickCount

    Gui, 99: New
    Gui, 99: -Caption +ToolWindow +AlwaysOnTop
    Gui, 99: Font, s9, Arial
    Gui, 99: Add, Text, x10 y10 w180 h20, 구글 드라이브 로딩중...
    Gui, 99: Add, Progress, x10 y35 w180 h15 vLoadingPB Range0-100
    Gui, 99: Add, Text, x10 y55 w180 h20 vLoadingPercentText Center, 0`%
    Gui, 99: Show, w200 h80, 로딩중

    Loop
        {
            elapsed := A_TickCount - startTick
    
            if (FileExist(aliasFile) && FileExist(classFile)) {
                GuiControl, 99:, LoadingPB, 100
                GuiControl, 99:, LoadingPercentText, 100`%
                Sleep, 300
                break  ; 로딩 성공 -> 루프 탈출
            }

            progress := Floor(elapsed / randomDelay * 100)
            if (progress > 100)
                progress := 100

            GuiControl, 99:, LoadingPB, %progress%
            GuiControl, 99:, LoadingPercentText, %progress%`%
    
            if (elapsed >= randomDelay) {
                MsgBox, 262192, 로딩 실패,
                (
                    구글 드라이브가 연결되어 있지 않습니다. 
                    `n구글 드라이브 연결 상태를 확인 후 스크립트를 재실행 해주세요.
                )
                fail := true
                break
            }
            Sleep, 200
        }
        Gui, 99: Destroy
    
        if (fail) {
            ExitApp
        }
    }



; =============================================================================
; (1) 별칭 로드: alias.ini
; =============================================================================
LoadAliases()


; 체크 상태 초기 반영(파일공유_JBBJ 스크립트 실행 등)
if (FileShareChecked = 1) {
    fileShareScript := A_ScriptDir . "\경로공유_UIA최종_수정1.ahk"
    Run, "%g_AHKv2Path%" "%fileShareScript%",, fileSharePID
}


; =============================================================================
; (2) 1초마다 작업 시간 누적 & 상위 4개 표시
; =============================================================================
SetTimer, TrackTime, 1000


; 스크립트 시작(자동 실행) 부분에 추가
; 스크립트 시작(자동 실행) 부분에 추가
SetTimer, CheckMouseMovement, 1000  ; 0.2초마다 좌표 확인
return



; --------------------------------------------------------------------------
; ★ 추가/수정: 각 토글 버튼(label) 클릭 시 기능 ON/OFF
; --------------------------------------------------------------------------

ToggleFileShare:
{
    global FileShareChecked, fileSharePID, g_AHKv2Path
    ; "FileShareChecked" 변수를 ! 연산(토글)
    FileShareChecked := !FileShareChecked

    if (FileShareChecked) {
        GuiControl, +Background00FF00, BtnFileShare
        GuiControl,, BtnFileShare, ON 파일공유
        fileShareScript := A_ScriptDir . "\경로공유_UIA최종_수정1.ahk"
        Run, "%g_AHKv2Path%" "%fileShareScript%",, fileSharePID
    } else {
        GuiControl, +BackgroundFF0000, BtnFileShare
        GuiControl,, BtnFileShare, OFF 파일공유
        ; 실행 중인 "경로공유_최종.ahk" 스크립트를 종료
        DetectHiddenWindows, On
        WinGet, AHKList, List, ahk_class AutoHotkey
        Loop %AHKList% {
            WinGetTitle, title, % "ahk_id " AHKList%A_Index%
            if (InStr(title, "경로공유_UIA최종_수정1.ahk")) {
                WinClose, %title%
                WinKill, %title%
            }
        }
        DetectHiddenWindows, Off
        fileSharePID := 0
    }
}
return



; --------------------------------------------------------------------------
; [경로→링크 변환 토글]
; --------------------------------------------------------------------------
TogglePathToLink:
{
    global checkPathToLink
    checkPathToLink := !checkPathToLink

    if (checkPathToLink) {
        GuiControl, +Background00FF00, BtnPathToLink
        GuiControl,, BtnPathToLink, ON 경로→링크
        ToolTip, 경로→링크 변환 활성화`nG:\경로 복사 시 jbbj:// 링크로 변환됩니다
    } else {
        GuiControl, +BackgroundFF0000, BtnPathToLink
        GuiControl,, BtnPathToLink, OFF 경로→링크
        ToolTip, 경로→링크 변환 비활성화
    }
    SetTimer, RemoveToolTip, -2000
}
return

; --------------------------------------------------------------------------
; [ 메인 스크립트 서브루틴들 ]
; --------------------------------------------------------------------------
ShowMainGUI:
    Gui, Show
return

LaunchVerupdate:
    ; 버전 업데이트 실행 (현재 미사용 - 백업에 있음)
    MsgBox, 48, 알림, 버전 업데이트 기능은 현재 준비 중입니다.
Return

playnumbergame:
    ; 숫자게임 실행
    Run, % g_GamesDir . "\숫자게임.ahk"
Return

Anonymous_praise:
    ; 익명 칭찬 스크립트 실행
    Run, % g_UtilsDir . "\익명_칭찬합시다.ahk"
return

Setuphelp:
    ; JBBJ 자료실 설치도우미 실행
    Run, % A_ScriptDir . "\JBBJ_설치도우미_1_4.ahk"
Return

OpenUserGuide:
    ; 사용설명서 HTML 파일 열기 (브라우저에서 GitHub 스타일로 표시)
    userGuideFile := A_ScriptDir . "\사용설명서.html"
    if FileExist(userGuideFile)
        Run, %userGuideFile%
    else
        Run, % g_UserGuideURL  ; HTML 파일 없으면 기존 URL 사용
return

Cutnumberinsert:
    ; 컷넘버입력기 실행
    Run, % g_UtilsDir . "\컷넘버입력기.ahk"
Return

LaunchColorPicker:
    ; 컬러픽커 스크립트 실행
    Run, % g_UtilsDir . "\마우스컬러_V1_4.ahk"
return

Menuchcun:
    ; 저녁메뉴 추천 스크립트 실행
    Run, % g_UtilsDir . "\저녁메뉴추천.ahk"
Return

LaunchSVGConverter:
    ; SVG 변환기 실행
    if (g_SVGConverter != "" && FileExist(g_SVGConverter)) {
        Run, % g_SVGConverter
    } else {
        MsgBox, 48, 알림, SVG 변환기 경로가 설정되지 않았거나 파일이 없습니다.`n설정/settings.ini 파일을 확인해주세요.
    }
return

PlaySnakeGame:
    ; 스네이크 게임 실행
    Run, % g_GamesDir . "\스네이크게임.ahk"
return

ShowFortune:
    ; 오늘의 운세 보기
    Run, % g_UtilsDir . "\오늘의운세.ahk"
return

ShowFeedbackWindow:
    ; 피드백 창 실행
    Run, % g_UtilsDir . "\피드백.ahk"
return

LaunchDebugMode:
    ; 디버그 모드 스크립트 실행
    Run, % g_UtilsDir . "\디버그.ahk"
return

ReloadDriveFiles:
{
    FakeLoadingDriveCheck()
    LoadAliases()
    return
}


; --------------------------------------------------------------------------
; [툴팁 표기 함수 수정버전]
; --------------------------------------------------------------------------
WM_MOUSEMOVE(wParam, lParam, msg, hwnd) {
    static prevHwnd := 0
    
    if (hwnd != prevHwnd) {
        prevHwnd := hwnd
        
        if (hwnd = HFileShare)
            ToolTip, 단축키: "Alt + F12"
        else if (hwnd = Hfeedback)
            ToolTip,  익명으로 스크립트에 대한 피드백을 전송합니다.
        else if (hwnd = HSvg)
            ToolTip,  SVG 변환기를 실행합니다.
        else if (hwnd = HColor)
            ToolTip, 컬러 픽커를 실행합니다.
        else If (hwnd = Hsetup)
            ToolTip, JBBJ 자료실 설치 도우미를 실행합니다.
        else if (hwnd = Hcutnumber)
            ToolTip, 컷넘버 매크로 입력기를 실행합니다.
        else if (hwnd = Hhelp)
            ToolTip, slack 캔버스로 사용설명서를 엽니다.
        else if (hwnd = HAp)
            ToolTip, 스장의 멋쟁이들을 몰래 칭찬합니다.
        else if (hwnd = Hsnake)
            ToolTip, 뱀이 됩니다.
        else if (hwnd = H2048)
            ToolTip, 시간을 좀 때웁니다.
        else if (hwnd = Hmenuchcun)
            ToolTip, 저녁 메뉴를 고릅니다.
        else if (hwnd = Hfortune)
            ToolTip, 오늘의 운세를 확인합니다.
        else
            ToolTip  ; 다른 컨트롤 위에서는 툴팁 제거
        
        if (hwnd = HFileShare || hwnd = Hsvg || hwnd = Hfeedback || hwnd = HColor || hwnd = Hsetup || hwnd = Hcutnumber || hwnd = Hhelp || hwnd = HAp || hwnd = Hsnake || hwnd = H2048 || hwnd = Hmenuchcun || hwnd = Hfortune)
            SetTimer, RemoveToolTip, -3000
    }
}

RemoveToolTip:
ToolTip
return


; --------------------------------------------------------------------------
; [스크립트 종료 함수]
; --------------------------------------------------------------------------
ExitScript:
    ; 작업마법사 종료 시 관련 스크립트들도 함께 종료
    CloseRelatedScripts()
    ExitApp
return

; --------------------------------------------------------------------------
; [OnExit 콜백 - 종료 시 정리 작업]
; --------------------------------------------------------------------------
CleanupOnExit(ExitReason, ExitCode) {
    ; Reload나 정상 종료 시 관련 스크립트 닫기
    CloseRelatedScripts()
    return 0  ; 종료 허용
}

; --------------------------------------------------------------------------
; [관련 스크립트 종료 함수]
; --------------------------------------------------------------------------
CloseRelatedScripts() {
    global fileSharePID

    ; 종료할 스크립트 목록 (작업마법사가 실행한 것들)
    scriptsToClose := ["경로공유_UIA최종_수정1.ahk"
                     , "숫자게임.ahk"
                     , "스네이크게임.ahk"
                     , "숫자야구게임"
                     , "익명_칭찬합시다.ahk"
                     , "first_setup.ahk"
                     , "컷넘버입력기.ahk"
                     , "마우스컬러"
                     , "저녁메뉴추천.ahk"
                     , "오늘의운세.ahk"
                     , "피드백.ahk"
                     , "디버그.ahk"
                     , "jbbj_protocol_handler.ahk"]

    ; 숨겨진 창도 검색
    DetectHiddenWindows, On

    ; 모든 AutoHotkey 창 검색
    WinGet, AHKList, List, ahk_class AutoHotkey

    Loop %AHKList%
    {
        thisHwnd := AHKList%A_Index%
        WinGetTitle, title, ahk_id %thisHwnd%

        ; 자기 자신은 건너뛰기
        if (title = A_ScriptFullPath)
            continue

        ; 목록에 있는 스크립트면 종료
        for idx, scriptName in scriptsToClose
        {
            if (InStr(title, scriptName))
            {
                WinClose, ahk_id %thisHwnd%
                Sleep, 50
                ; 안 닫히면 강제 종료
                if WinExist("ahk_id " . thisHwnd)
                    WinKill, ahk_id %thisHwnd%
                break
            }
        }
    }

    DetectHiddenWindows, Off

    ; PID로 추적 중인 프로세스도 종료
    if (fileSharePID > 0) {
        Process, Close, %fileSharePID%
    }
}

; --------------------------------------------------------------------------
; [GUI 닫기 처리]
; --------------------------------------------------------------------------
GuiClose:
GuiEscape:
    Gui, Hide
return

; --------------------------------------------------------------------------
; [파일 탐색기 주소창에서 % 자동완성]
; %를 입력하면 %%가 입력되고 커서가 가운데로 이동
; 환경 변수 입력을 편리하게 해줌 (예: %자료실%)
; --------------------------------------------------------------------------
#IfWinActive ahk_class CabinetWClass  ; 파일 탐색기에서만

$%::
{
    ; %% 입력 후 커서를 가운데로
    SendInput, `%`%
    Sleep, 50
    SendInput, {Left}
}
return

#IfWinActive  ; 컨텍스트 해제

; --------------------------------------------------------------------------
; [Slack 하이퍼링크 붙여넣기] (Ctrl+Shift+V) - Slack 창에서만 동작
; G:\ 경로 복사 후 Slack에서 Ctrl+Shift+V 누르면 자동으로 하이퍼링크 생성
; --------------------------------------------------------------------------

#IfWinActive ahk_exe slack.exe

^+v::
    global g_LastOriginalPath, g_LastJbbjLink, g_LastWebUrl, isConvertingClipboard

    ; ─────────────────────────────────────────────
    ; [디버그] 어떤 값이 저장되어 있는지 확인
    ; 문제 해결 후 이 줄을 주석 처리하세요
    ; ─────────────────────────────────────────────
    ; MsgBox, 64, 디버그, 텍스트: %g_LastOriginalPath%`n`n링크: %g_LastJbbjLink%`n`n웹: %g_LastWebUrl%

    ; 저장된 경로가 없으면 일반 붙여넣기
    if (g_LastOriginalPath = "" || g_LastJbbjLink = "")
    {
        Send, ^v
        return
    }

    ; ★ 클립보드 변환 방지 (이 핫키 실행 중에는 ClipboardPathConverter가 덮어쓰지 않도록)
    isConvertingClipboard := true

    ; 웹 URL 미리 저장 (클립보드 변경 전에)
    savedWebUrl := g_LastWebUrl

    ; 클립보드 백업
    savedClip := ClipboardAll

    ; 1. 하이퍼링크 다이얼로그 열기 (Ctrl+Shift+U)
    Send, ^+u
    Sleep, 300

    ; 2. 텍스트 필드에 원본 경로 붙여넣기
    ; (.bframe과 .bplaylist 모두 앱에서 여러 줄로 복사하므로 Slack 자동완성 방지됨)
    Clipboard := g_LastOriginalPath
    ClipWait, 1
    Send, ^v
    Sleep, 100

    ; 3. Tab으로 링크 필드로 이동
    Send, {Tab}
    Sleep, 100

    ; 4. 링크 필드에 baeframe:// 링크 붙여넣기
    Clipboard := g_LastJbbjLink
    ClipWait, 1
    Send, ^v
    Sleep, 50

    ; 5. 엔터로 확인
    Send, {Enter}
    Sleep, 100

    ; ─────────────────────────────────────────────
    ; 6. 웹 뷰어 URL이 있으면 새 줄에 하이퍼링크로 추가
    ; ─────────────────────────────────────────────
    if (savedWebUrl != "")
    {
        ; 새 줄로 이동
        Send, {Enter}
        Sleep, 100

        ; 웹 URL도 하이퍼링크로 만들기 (Ctrl+Shift+U)
        Send, ^+u
        Sleep, 300

        ; 텍스트 필드에 표시 텍스트 입력
        Clipboard := "📱 웹/모바일 뷰어"
        ClipWait, 1
        Send, ^v
        Sleep, 100

        ; Tab으로 링크 필드로 이동
        Send, {Tab}
        Sleep, 100

        ; 링크 필드에 웹 URL 붙여넣기
        Clipboard := savedWebUrl
        ClipWait, 1
        Send, ^v
        Sleep, 50

        ; 엔터로 확인
        Send, {Enter}
    }

    ; 클립보드 복원
    Clipboard := savedClip
    savedClip := ""

    ; ★ 클립보드 변환 다시 활성화
    isConvertingClipboard := false

    if (savedWebUrl != "") {
        ToolTip, 하이퍼링크 + 웹링크 생성 완료
    } else {
        ToolTip, 하이퍼링크 생성 완료
    }
    SetTimer, RemoveToolTip, -1500
return

#IfWinActive  ; 컨텍스트 해제


; =============================================================================
; [ 타임 트래커: TrackTime 서브루틴 & 함수들 ]
; =============================================================================
CheckMouseMovement:
    global lastUserInputTick, lastMouseX, lastMouseY
    MouseGetPos, nowX, nowY
    if (nowX != lastMouseX || nowY != lastMouseY) {
        lastUserInputTick := A_TickCount
        lastMouseX := nowX
        lastMouseY := nowY
    }
return

TrackTime:
global totalUsage, lastCheck, lastActiveProcess, usageTimes
global lastUserInputTick, AFK_THRESHOLD

{
    currentTick := A_TickCount
    diff := currentTick - lastCheck
    lastCheck := currentTick
    if (diff < 0)
        return

    deltaSec := diff / 1000.0

    ; (A) 직전 활성 프로세스 시간 누적
    if (lastActiveProcess != "")
    {
        if (!usageTimes.HasKey(lastActiveProcess))
            usageTimes[lastActiveProcess] := 0
        usageTimes[lastActiveProcess] += deltaSec
    }

    ; (B) "우리만의 idle" 계산
    idleTime := currentTick - lastUserInputTick

    if (idleTime >= AFK_THRESHOLD) { 
        currentProcess := "afk"
    } else {
        ; 현재 활성 창 프로세스명 구하기
        WinGet, currentHwnd, ID, A
        WinGet, currentProcess, ProcessName, ahk_id %currentHwnd%
        if (currentProcess = "")
            currentProcess := "UnknownProcess"
        currentProcess := RegExReplace(currentProcess, "\.exe$", "", 1)
        StringLower, currentProcess, currentProcess
    }

    lastActiveProcess := currentProcess

    ; (C) 전체 사용 시간 누적
    totalUsage += deltaSec

    ; (D) ProgressBar
    progressValue := (totalUsage > 28800) ? 28800 : totalUsage
    GuiControl,, TimeTrackerProgress, % Floor(progressValue)

    ; (E) 라벨
    formatted := FormatSeconds(totalUsage) " / 8:00:00"
    GuiControl,, TimeTrackerLabel, % formatted

    ; (F) 상위 N 프로세스
    top5 := GetTopN(usageTimes, 5)
    displayText := ""
    Loop % top5.Count()
    {
        idx := A_Index
        item := top5[idx]
        aliasName := GetAliasOrName(item.proc)
        displayText .= idx "위: " aliasName " - " FormatSeconds(item.time) "`n"
    }
    GuiControl,, TopProgramLabel, % displayText
}
return




GetTopN(usageMap, N) {
    arr := []
    for proc, sec in usageMap {
        arr.Push({ "proc": proc, "time": sec })
    }

    result := []
    Loop, % N {
        maxIndex := 0
        maxTime := -1
        for i, obj in arr {
            if (obj.time > maxTime) {
                maxTime := obj.time
                maxIndex := i
            }
        }
        if (maxIndex = 0)
            break
        result.Push(arr[maxIndex])
        arr.RemoveAt(maxIndex)
    }
    return result
}

; GetAliasOrName 함수도 수정
GetAliasOrName(procKey) {
    global processAliases
    if (processAliases.HasKey(procKey)) {
        return processAliases[procKey]
    } else {
        return procKey
    }
}

FormatSeconds(sec) {
    h := Floor(sec / 3600)
    m := Floor(Mod(sec, 3600) / 60)
    s := Floor(Mod(sec, 60))
    return Format("{:02}:{:02}:{:02}", h, m, s)
}

; =================================================================================================
; [ 경로 초기화 함수 ]
; =================================================================================================
InitializePaths() {
    global g_RootDir, g_SettingsDir, g_UtilsDir, g_GamesDir, g_LibDir
    global g_JBBJLibrary, g_InstallFiles, g_SVGConverter
    global g_AHKv2Path, g_UserGuideURL

    ; 스크립트가 루트 폴더에 직접 위치 (옵션 B: 소스 폴더 없음)
    g_RootDir := A_ScriptDir
    g_SettingsDir := g_RootDir . "\설정"
    g_UtilsDir := g_RootDir . "\유틸"
    g_GamesDir := g_RootDir . "\게임"
    g_LibDir := g_RootDir . "\라이브러리"

    ; settings.ini 파일 읽기
    settingsFile := g_SettingsDir . "\settings.ini"

    if FileExist(settingsFile) {
        IniRead, g_JBBJLibrary, %settingsFile%, 경로, 자료실
        IniRead, g_InstallFiles, %settingsFile%, 경로, 설치파일
        IniRead, g_SVGConverter, %settingsFile%, 경로, SVG변환기
        IniRead, g_AHKv2Path, %settingsFile%, AutoHotkey, AHKv2
        IniRead, g_UserGuideURL, %settingsFile%, 기타, 사용설명서URL
    } else {
        ; 기본값 사용 (settings.ini 없을 경우)
        g_JBBJLibrary := "G:\공유 드라이브\JBBJ 자료실"
        g_InstallFiles := g_JBBJLibrary . "\PC 설치 자료들"
        g_SVGConverter := ""
        g_AHKv2Path := "C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe"
        g_UserGuideURL := "https://studio-jbbj.slack.com/docs/T03HKE9MNCV/F086ZGRSBB4"
    }
}

; =================================================================================================
; [ 환경 변수 설정 함수 ]
; settings.ini의 경로를 Windows 환경 변수로 등록
; 파일 탐색기에서 %자료실%, %설치파일% 등으로 접근 가능
; =================================================================================================
SetDrivePathVariables() {
    global g_SettingsDir

    settingsFile := g_SettingsDir . "\settings.ini"
    if !FileExist(settingsFile)
        return

    ; 환경 변수 변경 여부 추적
    changedVars := []
    inPathSection := false

    ; UTF-8 인코딩으로 파일 읽기 설정
    FileEncoding, UTF-8

    ; 파일을 직접 읽어서 [경로] 섹션 파싱
    Loop, Read, %settingsFile%
    {
        line := Trim(A_LoopReadLine)

        ; 빈 줄이나 주석은 스킵
        if (line = "" || SubStr(line, 1, 1) = ";")
            continue

        ; 섹션 헤더 확인
        if (SubStr(line, 1, 1) = "[") {
            ; [경로] 섹션인지 확인
            if (InStr(line, "[경로]") || InStr(line, "[경로]"))
                inPathSection := true
            else
                inPathSection := false
            continue
        }

        ; [경로] 섹션 내의 key=value만 처리
        if (inPathSection) {
            pos := InStr(line, "=")
            if (pos) {
                varName := Trim(SubStr(line, 1, pos-1))
                varValue := Trim(SubStr(line, pos+1))

                ; 빈 값이면 스킵
                if (varValue = "" || varValue = "ERROR")
                    continue

                ; 현재 등록된 값 확인
                RegRead, existingValue, HKEY_CURRENT_USER\Environment, %varName%

                ; 값이 다를 때만 업데이트
                if (ErrorLevel || existingValue != varValue) {
                    ; 레지스트리에 환경 변수 등록
                    RegWrite, REG_EXPAND_SZ, HKEY_CURRENT_USER\Environment, %varName%, %varValue%
                    if (!ErrorLevel)
                        changedVars.Push(varName)
                }
            }
        }
    }

    ; 환경 변수가 변경되었으면 시스템에 알림
    if (changedVars.Length() > 0) {
        ; WM_SETTINGCHANGE 메시지 전송 (탐색기가 환경 변수 변경을 인식)
        ; HWND_BROADCAST = 0xFFFF, WM_SETTINGCHANGE = 0x001A
        EnvUpdate  ; 환경 변수 갱신 알림

        ; 등록된 변수 목록 만들기
        varList := ""
        for idx, name in changedVars
        {
            if (idx <= 5)  ; 최대 5개만 표시
                varList .= "%" . name . "%`n"
        }
        if (changedVars.Length() > 5)
            varList .= "... 외 " . (changedVars.Length() - 5) . "개"

        TrayTip, JBBJ 작업도우미, 탐색기 환경 변수 등록됨:`n%varList%, 2, 1
    }
}

; --------------------------------------------------------------------------
; [jbbj:// 프로토콜 등록 확인 및 자동 등록/갱신]
; 경로가 변경되었을 경우 자동으로 새 경로로 재등록
; --------------------------------------------------------------------------
CheckAndRegisterProtocol() {
    global g_RootDir

    ; 프로토콜 핸들러 경로 (루트 폴더에 위치)
    handlerPath := g_RootDir . "\jbbj_protocol_handler.ahk"

    ; 핸들러 파일 존재 확인
    if !FileExist(handlerPath) {
        return  ; 핸들러 없으면 조용히 스킵
    }

    ; AutoHotkey 실행 파일 경로 찾기
    ahkExePath := A_AhkPath
    if (ahkExePath = "") {
        ahkExePath := "C:\Program Files\AutoHotkey\AutoHotkey.exe"
    }

    ; 새로 등록할 명령어 값
    newCommandValue := """" . ahkExePath . """ """ . handlerPath . """ ""%1"""

    ; 기존 등록된 명령어 확인
    RegRead, existingCommand, HKEY_CLASSES_ROOT, jbbj\shell\open\command
    if (!ErrorLevel && existingCommand = newCommandValue) {
        return  ; 이미 올바른 경로로 등록되어 있으면 스킵
    }

    ; HKEY_CURRENT_USER도 확인
    RegRead, existingCommandUser, HKEY_CURRENT_USER\Software\Classes\jbbj\shell\open\command
    if (!ErrorLevel && existingCommandUser = newCommandValue) {
        return  ; 이미 올바른 경로로 등록되어 있으면 스킵
    }

    ; 레지스트리 등록/갱신 시도 (관리자 권한 필요할 수 있음)
    try {
        ; HKEY_CLASSES_ROOT\jbbj 키 생성/갱신
        RegWrite, REG_SZ, HKEY_CLASSES_ROOT, jbbj,, URL:JBBJ Protocol
        RegWrite, REG_SZ, HKEY_CLASSES_ROOT, jbbj, URL Protocol,

        ; shell\open\command 키 생성/갱신
        RegWrite, REG_SZ, HKEY_CLASSES_ROOT, jbbj\shell\open\command,, %newCommandValue%

        ; 경로 갱신 시 알림
        TrayTip, JBBJ 작업도우미, jbbj:// 프로토콜 경로가 갱신되었습니다., 2, 1
    } catch {
        ; 관리자 권한이 없으면 HKEY_CURRENT_USER에 등록 시도
        try {
            RegWrite, REG_SZ, HKEY_CURRENT_USER\Software\Classes\jbbj,, URL:JBBJ Protocol
            RegWrite, REG_SZ, HKEY_CURRENT_USER\Software\Classes\jbbj, URL Protocol,

            RegWrite, REG_SZ, HKEY_CURRENT_USER\Software\Classes\jbbj\shell\open\command,, %newCommandValue%

            TrayTip, JBBJ 작업도우미, jbbj:// 프로토콜 경로가 갱신되었습니다., 2, 1
        }
    }
}

; =================================================================================================
; ██████╗  █████╗ ███████╗███████╗██████╗  █████╗ ███╗   ███╗███████╗
; ██╔══██╗██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝
; ██████╔╝███████║█████╗  █████╗  ██████╔╝███████║██╔████╔██║█████╗
; ██╔══██╗██╔══██║██╔══╝  ██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝
; ██████╔╝██║  ██║███████╗██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗
; ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝
; =================================================================================================
; [BAEFRAME 연동 기능]
;
; 기능 설명:
;   - baeframe:// 프로토콜 자동 등록 (Windows 레지스트리)
;   - .bframe 파일 경로 복사 시 자동 감지
;   - Slack에서 Ctrl+Shift+V로 하이퍼링크 붙여넣기 지원
;
; 작동 방식:
;   1. BAEFRAME 앱에서 "링크 복사" 클릭 → 클립보드에 G:\...\파일.bframe 복사됨
;   2. 이 스크립트가 클립보드 감지 → .bframe 확장자면 baeframe:// 링크 생성
;   3. Slack에서 Ctrl+Shift+V → 하이퍼링크 다이얼로그에 자동 입력
;
; 필요 파일:
;   - EX_baeframe_protocol_handler.ahk (G:\공유 자료실\BAEFRAME\ 에 위치)
;
; =================================================================================================

; --------------------------------------------------------------------------
; [baeframe:// 프로토콜 등록 확인 및 자동 등록]
;
; 이 함수는 스크립트 시작 시 한 번 호출됨
; baeframe:// 링크 클릭 시 BAEFRAME 앱이 열리도록 Windows에 등록
; --------------------------------------------------------------------------
CheckAndRegisterBaeframeProtocol() {
    ; ─────────────────────────────────────────────
    ; 1단계: 이미 등록되어 있는지 확인
    ; ─────────────────────────────────────────────
    RegRead, existingValue, HKEY_CLASSES_ROOT, baeframe, URL Protocol
    if (!ErrorLevel) {
        return  ; 이미 등록됨 → 스킵
    }

    ; ─────────────────────────────────────────────
    ; 2단계: 프로토콜 핸들러 파일 경로 설정
    ; ※ 이 경로를 실제 BAEFRAME 폴더 위치에 맞게 수정하세요
    ; ─────────────────────────────────────────────
    handlerPath := "G:\공유 자료실\BAEFRAME\EX_baeframe_protocol_handler.ahk"

    ; 핸들러 파일이 없으면 조용히 스킵
    if !FileExist(handlerPath) {
        return
    }

    ; ─────────────────────────────────────────────
    ; 3단계: AutoHotkey 실행 파일 경로 찾기
    ; ─────────────────────────────────────────────
    ahkExePath := A_AhkPath
    if (ahkExePath = "") {
        ahkExePath := "C:\Program Files\AutoHotkey\AutoHotkey.exe"
    }

    ; ─────────────────────────────────────────────
    ; 4단계: Windows 레지스트리에 프로토콜 등록
    ; ─────────────────────────────────────────────
    try {
        ; HKEY_CLASSES_ROOT에 등록 시도 (관리자 권한 필요)
        RegWrite, REG_SZ, HKEY_CLASSES_ROOT, baeframe,, URL:BAEFRAME Protocol
        RegWrite, REG_SZ, HKEY_CLASSES_ROOT, baeframe, URL Protocol,
        commandValue := """" . ahkExePath . """ """ . handlerPath . """ ""%1"""
        RegWrite, REG_SZ, HKEY_CLASSES_ROOT, baeframe\shell\open\command,, %commandValue%
        TrayTip, BAEFRAME, baeframe:// 프로토콜이 등록되었습니다., 2, 1
    } catch {
        ; 관리자 권한 없으면 HKEY_CURRENT_USER에 등록
        try {
            RegWrite, REG_SZ, HKEY_CURRENT_USER\Software\Classes, baeframe,, URL:BAEFRAME Protocol
            RegWrite, REG_SZ, HKEY_CURRENT_USER\Software\Classes, baeframe, URL Protocol,
            commandValue := """" . ahkExePath . """ """ . handlerPath . """ ""%1"""
            RegWrite, REG_SZ, HKEY_CURRENT_USER\Software\Classes\baeframe\shell\open\command,, %commandValue%
            TrayTip, BAEFRAME, baeframe:// 프로토콜이 등록되었습니다., 2, 1
        }
    }
}

; --------------------------------------------------------------------------
; [클립보드 경로 → 프로토콜 링크 자동 변환]
;
; G:\~Z:\ 드라이브 경로를 클립보드에 복사하면:
;   - .bframe 파일 → baeframe:// 링크 생성 (BAEFRAME 앱용)
;   - 그 외 파일/폴더 → jbbj://open/ 링크 생성
;
; 생성된 링크는 g_LastJbbjLink에 저장되어 Ctrl+Shift+V로 사용
; --------------------------------------------------------------------------
ClipboardPathConverter(clipType) {
    global checkPathToLink, isConvertingClipboard, g_LastOriginalPath, g_LastJbbjLink, g_LastWebUrl

    ; 비활성화 상태면 스킵
    if (checkPathToLink != 1)
        return

    ; 이미 변환 중이면 스킵 (무한루프 방지)
    if (isConvertingClipboard)
        return

    ; 텍스트 클립보드만 처리
    if (clipType != 1)
        return

    clipText := Clipboard

    ; 비어있으면 스킵
    if (clipText = "")
        return

    ; 이미 jbbj:// 링크면 스킵
    if (SubStr(clipText, 1, 7) = "jbbj://")
        return

    ; G:\ ~ Z:\ 드라이브 경로인지 확인 (공유 드라이브 포함)
    if RegExMatch(clipText, "i)^[G-Z]:\\")
    {
        ; BAEFRAME 새 형식: 경로\n웹URL\n파일명 (줄바꿈 구분)
        ; 첫 줄(경로), 둘째 줄(웹URL) 추출
        cleanPath := Trim(clipText)
        webUrl := ""
        if (InStr(cleanPath, "`n")) {
            StringSplit, lines, cleanPath, `n
            cleanPath := Trim(lines1)  ; 첫 번째 줄 = 파일 경로
            webUrl := Trim(lines2)     ; 두 번째 줄 = 웹 뷰어 URL
        }
        cleanPath := RegExReplace(cleanPath, "[\r\n]+$", "")
        cleanPath := RegExReplace(cleanPath, "^[\r\n]+", "")

        ; 백슬래시를 슬래시로 변환 (URL용)
        urlPath := StrReplace(cleanPath, "\", "/")

        ; ─────────────────────────────────────────────────────────────────
        ; [BAEFRAME 연동] .bframe/.bplaylist 파일 감지 시 baeframe:// 링크 생성
        ; ─────────────────────────────────────────────────────────────────
        SplitPath, cleanPath,,, ext
        if (ext = "bframe" || ext = "bplaylist")
        {
            ; baeframe:// 링크 생성 (.bframe과 .bplaylist 동일한 형식)
            ; G:/ → G/ 로 변환 (Slack이 G:를 보면 file:///로 변환하는 문제 방지)
            ; 예: G:\공유\파일.bframe → baeframe://G/공유/파일.bframe
            ; 예: G:\공유\재생목록.bplaylist → baeframe://G/공유/재생목록.bplaylist
            urlPathNoColon := RegExReplace(urlPath, "^([A-Za-z]):", "$1")
            protocolLink := "baeframe://" . urlPathNoColon

            ; 전역 변수에 저장 (Slack Ctrl+Shift+V용)
            ; g_LastOriginalPath = 표시 텍스트 (G:\...\파일.bframe)
            ; g_LastJbbjLink = 하이퍼링크 URL (baeframe://...)
            ; g_LastWebUrl = 웹 뷰어 URL (https://baeframe.vercel.app/...)
            g_LastOriginalPath := cleanPath
            g_LastJbbjLink := protocolLink
            g_LastWebUrl := webUrl  ; 웹 뷰어 URL 저장

            ; 사용자에게 감지됨 알림
            if (ext = "bplaylist") {
                ToolTip, 📋 BAEFRAME 재생목록 감지됨`nSlack: Ctrl+Shift+V로 하이퍼링크 붙여넣기
            } else if (webUrl != "") {
                ToolTip, 🎬 BAEFRAME 경로 감지됨`nSlack: Ctrl+Shift+V로 하이퍼링크 + 웹링크 붙여넣기
            } else {
                ToolTip, 🎬 BAEFRAME 경로 감지됨`nSlack: Ctrl+Shift+V로 하이퍼링크 붙여넣기
            }
            SetTimer, RemoveToolTip, -2500
        }
        ; ─────────────────────────────────────────────────────────────────
        else
        {
            ; jbbj://open/ 링크 생성 (일반 파일/폴더용)
            jbbjLink := "jbbj://open/" . urlPath

            ; 전역 변수에 저장 (Slack 하이퍼링크용)
            g_LastOriginalPath := cleanPath
            g_LastJbbjLink := jbbjLink

            ; 클립보드는 원본 경로 유지 (변환하지 않음)
            ToolTip, 📎 경로 감지됨`nSlack: Ctrl+Shift+V로 하이퍼링크 붙여넣기
            SetTimer, RemoveToolTip, -2500
        }
    }
}

; ==================== 위치변경==============================
LoadAliases() {
    global processAliases, g_SettingsDir

    aliasFile := g_SettingsDir . "\alias.ini"
    if !FileExist(aliasFile) {
        MsgBox, 48, 알림, alias.ini 파일이 없습니다. 기본 alias만 사용합니다.
        processAliases["chrome"]    := "크롬"
        processAliases["explorer"]  := "파일 탐색기"
        processAliases["afterfx"]   := "애프터이펙트"
        processAliases["photoshop"] := "포토샵"
        processAliases["clipstudiopaint"] := "클립스튜디오"
        processAliases["slack"]     := "슬랙"
        processAliases["moho"]      := "모호"
        processAliases["animate"]   := "애니메이트"
        processAliases["explorer.exe"] := "파일 탐색기"
        processAliases["afk"]       := "자리비움"
        return
    }

    content := ""
    IniRead, content, %aliasFile%, Alias
    if (ErrorLevel) {
        MsgBox, 16, 에러, alias.ini 파일에서 [Alias] 섹션을 읽을 수 없습니다.
        return
    }

    loop, parse, content, `n, `r
    {
        line := Trim(A_LoopField)
        if (line = "")
            continue

        pos := InStr(line, "=")
        if (pos) {
            k := SubStr(line, 1, pos-1)
            v := SubStr(line, pos+1)
            StringLower, k, k
            processAliases[Trim(k)] := Trim(v)
        }
    }

    if (!processAliases.HasKey("afk")) {
        processAliases["afk"] := "자리비움"
    }
}



; --------------------------------------------------------------------------
; [★ 추가: 타임 트래커 시간 초기화 버튼 라벨]
; --------------------------------------------------------------------------
ResetTimeTracker:
{
    global totalUsage, lastActiveProcess, usageTimes
    global stopTracking

    totalUsage := 0
    usageTimes := {}
    lastActiveProcess := ""
    
    GuiControl,, TimeTrackerProgress, 0
    GuiControl,, TimeTrackerLabel, 0:00:00 / 8:00:00
    GuiControl,, TopProgramLabel,

    stopTracking := false

    ; ▼ 추가 코드
    SetTimer, TrackTime, On    ; 타임 트래커를 다시 켜서 추적을 재시작

    MsgBox, 64, 알림, 타임 트래커 정보가 초기화되었습니다. 다시 추적을 시작합니다!
}
return

; --------------------------------------------------------------------------
; [★ 추가: 타임 트래커 중단 버튼 라벨]
; --------------------------------------------------------------------------
; StopTrackingTime:
; {
;     global stopTracking
;     stopTracking := true
;     GuiControl,, TopProgramLabel, 스토킹을 멈췄습니다
;     SetTimer, TrackTime, Off
; }
; return
ToggleTrackingTime:
{
    global stopTracking, lastCheck

    ; stopTracking = false(추적 중)이었다면 => 이제 추적을 끔
    if (!stopTracking) {
        stopTracking := true
        GuiControl,, TopProgramLabel, 스토킹을 멈췄습니다
        ; 버튼 텍스트를 "다시 추적해"로 변경
        GuiControl,, BtnStopOrResumeTime, 다시 추적해
        SetTimer, TrackTime, Off
    }
    else {
        ; stopTracking = true(추적 중단 상태)이었다면 => 다시 추적 시작
        stopTracking := false
        ; 일시정지 동안 흐른 시간을 무시하기 위해 lastCheck 재설정
        lastCheck := A_TickCount
        
        ; 버튼 텍스트를 "그만 추적해"로 변경
        GuiControl,, BtnStopOrResumeTime, 그만 추적해
        SetTimer, TrackTime, On
    }
}
return

; --------------------------------------------------------------------------
; [바로가기 클립보드 생성 - Ctrl+CapsLock] - 현재 미사용 (주석처리)
; --------------------------------------------------------------------------
/*
#IfWinActive ahk_class CabinetWClass
^CapsLock::
{
    ; 현재 선택된 파일 경로 가져오기
    Clipboard := ""
    Send, ^c
    ClipWait, 0.5

    if (Clipboard != "")
    {
        selectedFile := Trim(Clipboard)

        if FileExist(selectedFile)
        {
            ; 파일명 추출
            SplitPath, selectedFile, fileName

            ; 임시 폴더 생성
            tempDir := A_Temp . "\TempShortcuts"
            FileCreateDir, %tempDir%

            ; 기존 파일 삭제
            FileDelete, %tempDir%\*.lnk

            ; 바로가기 생성
            shortcutPath := tempDir . "\" . fileName . " - 바로 가기.lnk"
            FileCreateShortcut, %selectedFile%, %shortcutPath%

            ; Shell COM 객체 사용
            shell := ComObjCreate("Shell.Application")
            folder := shell.Namespace(tempDir)
            item := folder.ParseName(fileName . " - 바로 가기.lnk")

            ; 잘라내기 동작 수행
            item.InvokeVerb("cut")

            ToolTip, 바로가기가 잘라내기 되었습니다`n원하는 위치에 Ctrl+V로 붙여넣으세요
            SetTimer, RemoveToolTip, -2000
        }
    }
}
return
#IfWinActive
*/


; --------------------------------------------------------------------------
; [바로가기 원본 경로 열기 - Alt+i] - 현재 미사용 (주석처리)
; --------------------------------------------------------------------------
/*
!i::
{
    ; 현재 선택된 파일이 바로가기(.lnk)인지 확인
    ClipSaved := ClipboardAll
    Clipboard := ""
    Send, ^c
    ClipWait, 0.5

    if !ErrorLevel
    {
        selectedFile := Clipboard
        selectedFile := Trim(selectedFile)

        ; .lnk 파일인지 확인
        if (SubStr(selectedFile, -3) = ".lnk" && FileExist(selectedFile))
        {
            ; 바로가기의 대상 경로 가져오기
            FileGetShortcut, %selectedFile%, targetPath

            if (targetPath != "")
            {
                ; 파일인 경우 해당 폴더를, 폴더인 경우 그대로 열기
                if (InStr(FileExist(targetPath), "D"))
                {
                    ; 폴더인 경우
                    Run, explorer.exe "%targetPath%"
                }
                else
                {
                    ; 파일인 경우 해당 파일이 있는 폴더 열기
                    SplitPath, targetPath,, targetDir
                    Run, explorer.exe /select`,"%targetPath%"
                }
            }
            else
            {
                MsgBox, 48, 오류, 바로가기의 대상을 찾을 수 없습니다.
            }
        }
        else
        {
            MsgBox, 48, 알림, 선택한 파일이 바로가기(.lnk)가 아닙니다.
        }
    }

    Clipboard := ClipSaved
}
return
*/
; (삭제됨: 중복된 ^CapsLock 핫키 - 위의 #IfWinActive 버전만 사용)
