; ==========================================================================
; JBBJ Protocol Handler
; jbbj:// 프로토콜을 받아서 파일 탐색기로 경로를 여는 스크립트
; ==========================================================================
#NoEnv
#SingleInstance Force
SetWorkingDir %A_ScriptDir%

; 명령줄 인자 받기 (jbbj://open/G:/경로/...)
fullUrl := A_Args[1]

if (fullUrl = "")
{
    MsgBox, 48, JBBJ Protocol Handler, 경로가 전달되지 않았습니다.
    ExitApp
}

; jbbj://open/ 제거하고 경로 추출
path := fullUrl
path := RegExReplace(path, "^jbbj://open/", "")
path := RegExReplace(path, "^jbbj://", "")

; URL 디코딩 (Slack이 인코딩한 한글/공백 복원)
path := UrlDecode(path)

; 슬래시를 백슬래시로 변환
path := StrReplace(path, "/", "\")

; 앞뒤 공백 제거
path := Trim(path)

; 경로 존재 확인 후 열기
if FileExist(path)
{
    ; 파일인지 폴더인지 확인
    FileGetAttrib, attr, %path%
    if InStr(attr, "D")
    {
        ; 폴더면 그냥 열기
        Run, explorer "%path%"
    }
    else
    {
        ; ─────────────────────────────────────────────
        ; .bframe 파일이면 BAEFRAME 앱으로 열기
        ; ─────────────────────────────────────────────
        SplitPath, path,,, ext
        if (ext = "bframe")
        {
            ; BAEFRAME 앱 경로 (이 스크립트와 같은 폴더)
            baeframeExe := A_ScriptDir . "\BAEFRAME.exe"

            ; 앱이 존재하면 실행, 아니면 파일 탐색기로 열기
            if FileExist(baeframeExe)
            {
                Run, "%baeframeExe%" "%path%"
            }
            else
            {
                ; 앱을 찾을 수 없으면 파일 선택해서 열기
                MsgBox, 48, BAEFRAME, BAEFRAME 앱을 찾을 수 없습니다:`n%baeframeExe%`n`n파일 탐색기로 엽니다.
                Run, explorer /select`,"%path%"
            }
        }
        else
        {
            ; 일반 파일이면 해당 파일 선택해서 열기
            Run, explorer /select`,"%path%"
        }
    }
}
else
{
    MsgBox, 48, JBBJ Protocol Handler, 경로를 찾을 수 없습니다:`n`n%path%
}

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
