; ==========================================================================
; BAEFRAME Protocol Handler
; baeframe:// 프로토콜 및 .bframe 파일을 BAEFRAME 앱으로 여는 스크립트
;
; 사용법:
; 1. 이 스크립트를 BAEFRAME 폴더에 배치
; 2. 작업도우미가 처음 실행될 때 레지스트리에 등록됨
; 3. baeframe://... 링크 클릭 시 이 스크립트가 실행됨
; ==========================================================================
#NoEnv
#SingleInstance Force
SetWorkingDir %A_ScriptDir%

; 명령줄 인자 받기 (baeframe://G:/경로/파일.bframe 또는 G:\경로\파일.bframe)
fullArg := A_Args[1]

; ─────────────────────────────────────────────
; [디버그] 핸들러가 어떤 인자를 받았는지 확인
; 문제 해결 후 이 줄을 주석 처리하세요
; ─────────────────────────────────────────────
; MsgBox, 64, BAEFRAME 디버그, 받은 인자: %fullArg%`n`n스크립트 위치: %A_ScriptDir%

if (fullArg = "")
{
    MsgBox, 48, BAEFRAME, 파일 경로가 전달되지 않았습니다.
    ExitApp
}

; baeframe:// 프로토콜 제거
path := fullArg
path := RegExReplace(path, "^baeframe://", "")

; URL 디코딩 (슬랙이 인코딩한 한글/공백 복원)
path := UrlDecode(path)

; 슬래시를 백슬래시로 변환
path := StrReplace(path, "/", "\")

; 앞뒤 공백 제거
path := Trim(path)

; BAEFRAME 앱 경로 확인 (이 스크립트와 같은 폴더)
baeframeDir := A_ScriptDir

; 1순위: BAEFRAME.exe (빌드된 앱)
baeframeExe := baeframeDir . "\BAEFRAME.exe"

if FileExist(baeframeExe)
{
    ; 빌드된 exe가 있으면 실행
    Run, "%baeframeExe%" "%path%"
    ExitApp
}

; 2순위: 개발 모드 (npm start)
packageJson := baeframeDir . "\package.json"

if FileExist(packageJson)
{
    ; 개발 모드로 실행 (npm start)
    ; cmd 창을 숨기고 실행
    Run, cmd /c "cd /d "%baeframeDir%" && npm start -- "%path%"",, Hide
    ExitApp
}

; 둘 다 없으면 에러
MsgBox, 48, BAEFRAME, BAEFRAME 앱을 찾을 수 없습니다.`n`n경로: %baeframeDir%`n`nBAEFRAME.exe 또는 package.json이 필요합니다.
ExitApp

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
