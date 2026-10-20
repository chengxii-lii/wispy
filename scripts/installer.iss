; wispy's Windows installer (Inno Setup 6). Built by scripts\make-installer.ps1 from dist\ after `npm run pack`.
; Per-user: no admin rights, installs to %LOCALAPPDATA%\Programs\wispy, adds a Start Menu shortcut and,
; if you leave the box ticked, launch at sign-in. The uninstaller gives the Windows taskbar back.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{B8E5F2A1-6C3D-4E7A-9F10-2D5A7C9E4B31}
AppName=wispy
AppVersion={#AppVersion}
AppPublisher=ThinkTrout
AppPublisherURL=https://github.com/chengxii-lii/wispy
AppSupportURL=https://github.com/chengxii-lii/wispy/issues
AppUpdatesURL=https://github.com/chengxii-lii/wispy/releases
DefaultDirName={localappdata}\Programs\wispy
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\wispy.exe
OutputDir=..\release
OutputBaseFilename=wispy-setup
Compression=lzma2/max
SolidCompression=yes
CloseApplications=no

[Tasks]
Name: "startup"; Description: "Start wispy when I sign in"

[Files]
Source: "..\dist\wispy-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "restore-taskbar.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\wispy"; Filename: "{app}\wispy.exe"; Comment: "wispy: a home bar that replaces the taskbar"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "com.thinktrout.wispy"; ValueData: """{app}\wispy.exe"""; Flags: uninsdeletevalue; Tasks: startup

[Run]
Filename: "{app}\wispy.exe"; Description: "Launch wispy"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\restore-taskbar.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RestoreTaskbar"

[Code]
procedure StopWispy;
var
  rc: Integer;
begin
  Exec('taskkill.exe', '/F /IM wispy.exe /IM wispy-helper.exe', '', SW_HIDE, ewWaitUntilTerminated, rc);
  Sleep(600);
end;

// Replacing a running copy: stop it, then put the taskbar back before the files are swapped.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  rc: Integer;
  restore: String;
begin
  StopWispy;
  restore := ExpandConstant('{app}\restore-taskbar.ps1');
  if FileExists(restore) then
    Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + restore + '"', '', SW_HIDE, ewWaitUntilTerminated, rc);
  Result := '';
end;

function InitializeUninstall: Boolean;
begin
  StopWispy;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) then
    if MsgBox('Also delete your wispy settings and notification history?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{userappdata}\wispy'), True, True, True);
end;
