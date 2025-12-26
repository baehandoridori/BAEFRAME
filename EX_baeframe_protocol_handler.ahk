; ==========================================================================
; BAEFRAME Protocol Handler
; baeframe:// 프로토콜 및 .bframe 파일을 BAEFRAME 앱으로 여는 스크립트
;
; 사용법:
; 1. 이 스크립트를 더블클릭하면 baeframe:// 프로토콜이 자동 등록됩니다
; 2. 등록 후 baeframe://... 링크 클릭 시 BAEFRAME 앱이 열립니다
; ==========================================================================
#NoEnv
#SingleInstance Off  ; 여러 인스턴스 허용 (링크 여러 번 클릭 가능)
#NoTrayIcon          ; 트레이 아이콘 생성 안 함 (빠른 종료)
SetWorkingDir %A_ScriptDir%
SetBatchLines, -1    ; 최대 속도로 실행

; ╔═══════════════════════════════════════════════════════════════════════════╗
; ║  ★★★ BAEFRAME 앱 경로 설정 ★★★                                          ║
; ║                                                                           ║
; ║  아래 경로들을 실제 BAEFRAME 앱이 설치된 경로로 변경하세요!                ║
; ║  여러 경로를 설정하면 순서대로 확인하여 먼저 찾은 경로를 사용합니다.       ║
; ╚═══════════════════════════════════════════════════════════════════════════╝
global BAEFRAME_PATHS := []
BAEFRAME_PATHS.Push("C:\BAEframe\BAEFRAME")                              ; 테스트용 경로
BAEFRAME_PATHS.Push("G:\공유 드라이브\개인작업일지 배한솔\BAEFRAME")      ; 실제 배포 경로
; BAEFRAME_PATHS.Push("여기에 추가 경로...")                              ; 필요시 추가

; 명령줄 인자 받기 (baeframe://G:/경로/파일.bframe 또는 G:\경로\파일.bframe)
fullArg := A_Args[1]

; ═══════════════════════════════════════════════════════════════════════════
; 인자가 없으면 → 프로토콜 자가 등록 모드
; ═══════════════════════════════════════════════════════════════════════════
if (fullArg = "")
{
    RegisterBaeframeProtocol()
    ExitApp
}

; ─────────────────────────────────────────────
; [디버그] 핸들러가 어떤 인자를 받았는지 확인
; 문제 해결 후 이 줄을 주석 처리하세요
; ─────────────────────────────────────────────
; MsgBox, 64, BAEFRAME 디버그, 받은 인자: %fullArg%`n`n스크립트 위치: %A_ScriptDir%

; baeframe:// 프로토콜 제거
path := fullArg
path := RegExReplace(path, "^baeframe://", "")

; URL 디코딩 (슬랙이 인코딩한 한글/공백 복원)
path := UrlDecode(path)

; ─────────────────────────────────────────────
; 드라이브 문자 뒤에 콜론이 없으면 추가
; Slack이 "G:/" → "G/" 로 변환하는 문제 수정
; 예: "G/공유" → "G:/공유"
; ─────────────────────────────────────────────
if RegExMatch(path, "^([A-Za-z])/", match)
{
    path := SubStr(path, 1, 1) . ":/" . SubStr(path, 3)
}

; 슬래시를 백슬래시로 변환
path := StrReplace(path, "/", "\")

; 앞뒤 공백 제거
path := Trim(path)

; ─────────────────────────────────────────────
; BAEFRAME 앱 경로 탐색 (설정된 경로들을 순서대로 확인)
; ─────────────────────────────────────────────
baeframeDir := ""

for index, tryPath in BAEFRAME_PATHS
{
    ; 1순위: BAEFRAME.exe (빌드된 앱)
    if FileExist(tryPath . "\BAEFRAME.exe")
    {
        baeframeDir := tryPath
        break
    }
    ; 2순위: package.json (개발 모드)
    if FileExist(tryPath . "\package.json")
    {
        baeframeDir := tryPath
        break
    }
}

; 어느 경로에서도 못 찾으면 에러
if (baeframeDir = "")
{
    pathList := ""
    for index, p in BAEFRAME_PATHS
        pathList .= "- " . p . "`n"

    MsgBox, 48, BAEFRAME, BAEFRAME 앱을 찾을 수 없습니다.`n`n확인한 경로들:`n%pathList%`nBAEFRAME.exe 또는 package.json이 필요합니다.
    ExitApp
}

; BAEFRAME 실행
baeframeExe := baeframeDir . "\BAEFRAME.exe"

if FileExist(baeframeExe)
{
    ; 빌드된 exe가 있으면 실행
    Run, "%baeframeExe%" "%path%",, UseErrorLevel
    if (ErrorLevel = "ERROR")
        MsgBox, 48, BAEFRAME, BAEFRAME.exe 실행 실패`n`n경로: %baeframeExe%
    ExitApp
}

; 개발 모드 (npm start)
packageJson := baeframeDir . "\package.json"

if FileExist(packageJson)
{
    ; 개발 모드로 실행 (npm start)
    Run, cmd /c "cd /d "%baeframeDir%" && npm start -- "%path%"",, Hide UseErrorLevel
    if (ErrorLevel = "ERROR")
        MsgBox, 48, BAEFRAME, npm start 실행 실패`n`n경로: %baeframeDir%
    ExitApp
}

; ==========================================================================
; URL 디코딩 함수
; %XX 형식의 URL 인코딩된 문자를 원래 문자로 변환
; ==========================================================================
UrlDecode(str) {
    ; + 를 공백으로 변환
    str := StrReplace(str, "+", " ")

    ; %XX 패턴을 찾아서 디코딩
    while (pos := InStr(str, "%"))
    {
        ; %XX에서 XX 추출
        hex := SubStr(str, pos + 1, 2)

        ; 유효한 hex인지 확인
        if RegExMatch(hex, "^[0-9A-Fa-f]{2}$")
        {
            ; hex를 숫자로 변환
            SetFormat, IntegerFast, D
            charCode := "0x" . hex
            charCode += 0

            ; 단일 바이트 문자인 경우 (ASCII)
            if (charCode < 128)
            {
                char := Chr(charCode)
                str := SubStr(str, 1, pos - 1) . char . SubStr(str, pos + 3)
            }
            ; UTF-8 멀티바이트 문자인 경우
            else
            {
                ; UTF-8 바이트 시퀀스 수집
                bytes := []
                tempPos := pos

                while (SubStr(str, tempPos, 1) = "%")
                {
                    tempHex := SubStr(str, tempPos + 1, 2)
                    if RegExMatch(tempHex, "^[0-9A-Fa-f]{2}$")
                    {
                        tempCode := "0x" . tempHex
                        tempCode += 0
                        bytes.Push(tempCode)
                        tempPos += 3
                    }
                    else
                        break

                    ; UTF-8 시퀀스 완료 확인
                    if (bytes.Length() >= 1)
                    {
                        firstByte := bytes[1]
                        if (firstByte < 128)
                            break
                        else if (firstByte >= 192 && firstByte < 224 && bytes.Length() >= 2)
                            break
                        else if (firstByte >= 224 && firstByte < 240 && bytes.Length() >= 3)
                            break
                        else if (firstByte >= 240 && bytes.Length() >= 4)
                            break
                    }
                }

                ; 바이트를 UTF-8 문자로 변환
                char := Utf8BytesToChar(bytes)
                bytesLen := bytes.Length() * 3
                str := SubStr(str, 1, pos - 1) . char . SubStr(str, pos + bytesLen)
            }
        }
        else
        {
            ; 유효하지 않은 % 시퀀스는 건너뛰기
            break
        }
    }

    return str
}

; UTF-8 바이트 배열을 문자로 변환
Utf8BytesToChar(bytes) {
    if (bytes.Length() = 0)
        return ""

    ; VarSetCapacity로 버퍼 생성
    VarSetCapacity(utf8Buf, bytes.Length(), 0)

    for i, b in bytes
        NumPut(b, utf8Buf, i - 1, "UChar")

    ; UTF-8을 UTF-16으로 변환
    len := bytes.Length()
    reqLen := DllCall("MultiByteToWideChar", "UInt", 65001, "UInt", 0
        , "Ptr", &utf8Buf, "Int", len, "Ptr", 0, "Int", 0)

    if (reqLen > 0)
    {
        VarSetCapacity(utf16Buf, reqLen * 2, 0)
        DllCall("MultiByteToWideChar", "UInt", 65001, "UInt", 0
            , "Ptr", &utf8Buf, "Int", len, "Ptr", &utf16Buf, "Int", reqLen)
        return StrGet(&utf16Buf, reqLen, "UTF-16")
    }

    return ""
}

; ==========================================================================
; baeframe:// 프로토콜 자가 등록 함수
; 이 스크립트를 더블클릭하면 실행됨
; ==========================================================================
RegisterBaeframeProtocol() {
    ; 이 스크립트 자체의 경로
    handlerPath := A_ScriptFullPath

    ; AutoHotkey 실행 파일 경로
    ahkExePath := A_AhkPath
    if (ahkExePath = "") {
        ahkExePath := "C:\Program Files\AutoHotkey\AutoHotkey.exe"
    }

    ; 레지스트리 등록
    try {
        ; HKEY_CURRENT_USER에 등록 (관리자 권한 불필요)
        RegWrite, REG_SZ, HKEY_CURRENT_USER\Software\Classes\baeframe,, URL:BAEFRAME Protocol
        RegWrite, REG_SZ, HKEY_CURRENT_USER\Software\Classes\baeframe, URL Protocol,

        commandValue := """" . ahkExePath . """ """ . handlerPath . """ ""%1"""
        RegWrite, REG_SZ, HKEY_CURRENT_USER\Software\Classes\baeframe\shell\open\command,, %commandValue%

        MsgBox, 64, BAEFRAME, baeframe:// 프로토콜이 등록되었습니다!`n`n이제 Slack에서 baeframe:// 링크를 클릭하면 BAEFRAME이 열립니다.`n`n핸들러 경로:`n%handlerPath%
    } catch e {
        MsgBox, 48, BAEFRAME, 프로토콜 등록 실패`n`n오류: %e%
    }
}
