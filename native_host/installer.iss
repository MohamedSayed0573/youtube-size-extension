; Inno Setup script to install the YouTube Size Native Messaging host for Chrome/Edge/Chromium/Firefox
; Build prerequisites:
; - Place this .iss file in the native_host/ directory.
; - Ensure ytdlp_host.exe and yt-dlp.exe are present (build via build_host.ps1).
; - Set the StoreID and DevIDs below before compiling.

#define MyAppName "YouTube Size Native Host"
#define MyAppVersion "1.0.0"
#define InstallDirName "YouTubeSizeNative"

; TODO: Set your published Chrome Web Store extension ID here
#define StoreID "YOUR_STORE_ID"
; Optional: comma-separated dev IDs for unpacked/testing builds
#define DevIDs ""

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={localappdata}\{#InstallDirName}
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir=.
OutputBaseFilename=YouTubeSizeNative-Installer
ArchitecturesInstallIn64BitMode=x64
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=lowest

[Files]
; Core host launcher and binaries (include if present)
Source: "ytdlp_host.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "ytdlp_host.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "ytdlp_host.py"; DestDir: "{app}"; Flags: ignoreversion
Source: "yt-dlp.exe"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
; Register Chrome/Edge/Chromium native host JSON (written at install time in [Code])
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\com.ytdlp.sizer"; ValueType: string; ValueName: ""; ValueData: "{app}\com.ytdlp.sizer.json"; Flags: uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\Microsoft\Edge\NativeMessagingHosts\com.ytdlp.sizer"; ValueType: string; ValueName: ""; ValueData: "{app}\com.ytdlp.sizer.json"; Flags: uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\Chromium\NativeMessagingHosts\com.ytdlp.sizer"; ValueType: string; ValueName: ""; ValueData: "{app}\com.ytdlp.sizer.json"; Flags: uninsdeletekeyifempty

; Register Firefox native host JSON
Root: HKCU; Subkey: "Software\Mozilla\NativeMessagingHosts\com.ytdlp.sizer"; ValueType: string; ValueName: ""; ValueData: "{app}\com.ytdlp.sizer.firefox.json"; Flags: uninsdeletekeyifempty

[Code]
function Split(const S, Delim: string): TArrayOfString;
var
  P, Start, DelPos: Integer;
begin
  SetArrayLength(Result, 0);
  P := 1;
  Start := 1;
  while P <= Length(S) do begin
    if Copy(S, P, Length(Delim)) = Delim then begin
      DelPos := P;
      SetArrayLength(Result, GetArrayLength(Result) + 1);
      Result[GetArrayLength(Result) - 1] := Copy(S, Start, DelPos - Start);
      P := P + Length(Delim);
      Start := P;
    end else
      P := P + 1;
  end;
  SetArrayLength(Result, GetArrayLength(Result) + 1);
  Result[GetArrayLength(Result) - 1] := Copy(S, Start, MaxInt);
end;

function Trim(const S: string): string;
begin
  Result := S;
  while (Length(Result) > 0) and (Result[1] <= ' ') do Delete(Result, 1, 1);
  while (Length(Result) > 0) and (Result[Length(Result)] <= ' ') do Delete(Result, Length(Result), 1);
end;

function JsonEscape(const S: string): string;
var
  i: Integer;
begin
  Result := '';
  for i := 1 to Length(S) do begin
    case S[i] of
      '"': Result := Result + '\\"';
      '\\': Result := Result + '\\\\';
      #8: Result := Result + '\\b';
      #9: Result := Result + '\\t';
      #10: Result := Result + '\\n';
      #12: Result := Result + '\\f';
      #13: Result := Result + '\\r';
    else
      Result := Result + S[i];
    end;
  end;
end;

procedure WriteHostJsons;
var
  appDir, hostCmd, chromeJson, ffJson: string;
  allowedOrigins, devs: TArrayOfString;
  i: Integer;
  ao: string;
  chromeContent, ffContent: string;
begin
  appDir := ExpandConstant('{app}');
  hostCmd := appDir + '\\ytdlp_host.cmd';
  chromeJson := appDir + '\\com.ytdlp.sizer.json';
  ffJson := appDir + '\\com.ytdlp.sizer.firefox.json';

  ; Build allowed_origins array
  SetArrayLength(allowedOrigins, 0);
  if '{#StoreID}' <> '' then begin
    SetArrayLength(allowedOrigins, 1);
    allowedOrigins[0] := 'chrome-extension://{#StoreID}/';
  end;

  if '{#DevIDs}' <> '' then begin
    devs := Split('{#DevIDs}', ',');
    for i := 0 to GetArrayLength(devs) - 1 do begin
      devs[i] := Trim(devs[i]);
      if devs[i] <> '' then begin
        SetArrayLength(allowedOrigins, GetArrayLength(allowedOrigins) + 1);
        allowedOrigins[GetArrayLength(allowedOrigins) - 1] := 'chrome-extension://' + devs[i] + '/';
      end;
    end;
  end;

  ao := '';
  for i := 0 to GetArrayLength(allowedOrigins) - 1 do begin
    if i > 0 then ao := ao + ',';
    ao := ao + '"' + JsonEscape(allowedOrigins[i]) + '"';
  end;

  chromeContent := '{' +
    '"name":"com.ytdlp.sizer",' +
    '"description":"Native host to run yt-dlp and return video sizes.",' +
    '"path":"' + JsonEscape(hostCmd) + '",' +
    '"type":"stdio",' +
    '"allowed_origins":[' + ao + ']'+
  '}';

  ffContent := '{' +
    '"name":"com.ytdlp.sizer",' +
    '"description":"Native host to run yt-dlp and return video sizes.",' +
    '"path":"' + JsonEscape(hostCmd) + '",' +
    '"type":"stdio",' +
    '"allowed_extensions":["ytdlp-sizer@example.com"]'+
  '}';

  SaveStringToFile(chromeJson, chromeContent, False);
  SaveStringToFile(ffJson, ffContent, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then begin
    WriteHostJsons;
  end;
end;

[UninstallDelete]
Type: files; Name: "{app}\\com.ytdlp.sizer.json"
Type: files; Name: "{app}\\com.ytdlp.sizer.firefox.json"
Type: dirifempty; Name: "{app}"
