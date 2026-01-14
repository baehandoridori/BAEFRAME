' BAEFRAME Protocol Launcher
' Windows의 %XX 환경변수 해석 문제를 우회하기 위한 VBScript 래퍼
'
' 문제: Windows 레지스트리에서 "%1" 파라미터를 확장할 때
'       URL의 %EA%, %B3% 같은 percent-encoding을 환경변수로 해석하여
'       한글 경로가 있는 URL이 잘림
'
' 해결: VBScript는 %XX를 환경변수로 해석하지 않으므로
'       URL이 그대로 앱으로 전달됨

Option Explicit

Dim args, url, exePath, shell, fso, scriptDir, cmd

' 인자 확인
Set args = WScript.Arguments
If args.Count = 0 Then
    WScript.Quit 0
End If

' URL 가져오기
url = args(0)

' 스크립트 디렉토리에서 exe 경로 찾기
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' exe 경로 결정 (빌드된 버전 또는 개발 버전)
If fso.FileExists(scriptDir & "\dist\win-unpacked\BFRAME_alpha_v2.exe") Then
    exePath = scriptDir & "\dist\win-unpacked\BFRAME_alpha_v2.exe"
ElseIf fso.FileExists(scriptDir & "\BFRAME_alpha_v2.exe") Then
    exePath = scriptDir & "\BFRAME_alpha_v2.exe"
Else
    ' 개발 모드: npm start 사용
    Set shell = CreateObject("WScript.Shell")
    shell.CurrentDirectory = scriptDir
    shell.Run "cmd /c npm start -- """ & url & """", 0, False
    WScript.Quit 0
End If

' 앱 실행
Set shell = CreateObject("WScript.Shell")
cmd = """" & exePath & """ """ & url & """"
shell.Run cmd, 1, False

WScript.Quit 0
